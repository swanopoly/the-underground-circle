/**
 * v2-memory-payload-builder-smoketest — the PURE client half of P2
 * (`docs/MEMORY_V2_INTEGRATION_PLAN.md`): `src/lib/v2MemoryPayloadBuilder.ts`.
 *
 * This module decides what memory leaves the device on the DEFAULT SwanBot v2
 * lane. Four of its properties are load-bearing, and each has a specific,
 * already-shipped-once failure mode behind it:
 *
 *   1. ALLOWLISTED KEYS ONLY, derived not restated. `memory_floor` is the
 *      server's own fallback key; a client that claims it is rejected as
 *      `unauthorized_key` and the section is silently lost. The derivation from
 *      `V2_MEMORY_SECTION_KEYS` / `SERVER_ONLY_SECTION_KEYS` /
 *      `V2_MEMORY_EMIT_ORDER` is pinned here so a core change cannot ship a key
 *      the edge will refuse.
 *   2. RAW, UNFENCED TEXT. The edge fences every section itself. The two
 *      obvious sources to reach for are ALREADY fenced
 *      (`retrieveForTurn().formatted`, `formatSoulWisdomBlock()`), so this is a
 *      live hazard, not a theoretical one — asserted here against the REAL
 *      `wrapUntrusted` and the REAL `buildV2MemoryBlock`, by counting fences in
 *      the assembled block.
 *   3. OMIT, DON'T EMPTY. `{sections: []}` is NOT falsy on the edge (`hasPayload`
 *      tests `!== undefined && !== null`), so an empty payload would SUPPRESS
 *      the server-side floor — strictly worse than sending nothing.
 *   4. PRIORITY SURVIVAL. The plan's P2 gate is "confirm the relevant section
 *      survives clipping": `turn_retrieval` must still be in the assembled block
 *      under a tight budget.
 *
 * Pure — loads under tsx. Every module it touches is import-free or type-only:
 *   v2MemoryPayloadBuilder → v2MemoryInjectionCore (import-free)
 *   untrustedContent (0 imports), promptSectionPriorityCore (1 type import)
 *
 *   npx tsx scripts/v2-memory-payload-builder-smoketest.ts
 */

import {
  buildV2MemoryPayload,
  formatTurnRetrievalText,
  isV2MemoryClientSectionKey,
  MAX_RETRIEVAL_ROWS_RENDERED,
  MAX_RETRIEVAL_ROW_CHARS,
  V2_MEMORY_BUILD_DEADLINE_MS,
  V2_MEMORY_CLIENT_SECTION_KEYS,
  V2_MEMORY_STORE_LIMIT,
  V2_MEMORY_TURN_RETRIEVAL_BUDGET_CHARS,
  V2_MEMORY_TURN_RETRIEVAL_COUNT,
  V2_MEMORY_WIRE_BUDGET_CHARS,
  V2_MEMORY_WIRE_CLIP_MARKER,
  V2_MEMORY_WIRE_SECTION_MAX_CHARS,
  type V2MemoryClientSectionKey,
} from '../src/lib/v2MemoryPayloadBuilder';
import {
  buildV2MemoryBlock,
  normalizeV2MemoryPayload,
  SERVER_ONLY_SECTION_KEYS,
  V2_MEMORY_BUDGET_CHARS,
  V2_MEMORY_EMIT_ORDER,
  V2_MEMORY_SECTION_KEYS,
  v2MemorySectionPriority,
} from '../src/lib/v2MemoryInjectionCore';
import { UNTRUSTED_CLOSE, UNTRUSTED_OPEN, wrapUntrusted } from '../src/lib/untrustedContent';
import { planSectionFit } from '../src/lib/promptSectionPriorityCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// ── call wrappers (keep hostile fixtures cast-free at the call sites) ─────────
function build(input?: unknown) {
  return buildV2MemoryPayload(input);
}
function retrievalText(rows?: unknown): string {
  return formatTurnRetrievalText(rows);
}
function keysOf(result: ReturnType<typeof buildV2MemoryPayload>): string[] {
  return (result.payload?.sections || []).map((s) => s.key);
}
function textFor(result: ReturnType<typeof buildV2MemoryPayload>, key: string): string | undefined {
  return (result.payload?.sections || []).find((s) => s.key === key)?.text;
}
function rep(ch: string, n: number): string {
  return new Array(n + 1).join(ch);
}
/** A long body with word breaks, so the clipper's back-off has somewhere to go. */
function filler(n: number, word = 'alpha'): string {
  let out = '';
  while (out.length < n) out += `${word} `;
  return out.slice(0, n);
}
function countOccurrences(haystack: string, needle: string): number {
  let n = 0;
  let i = haystack.indexOf(needle);
  while (i !== -1) { n += 1; i = haystack.indexOf(needle, i + needle.length); }
  return n;
}

const STORES = {
  userNotes: '## User Notes\nChris prefers terse answers and hates emoji.',
  userProfile: '## User Profile\n- [preference] Ships small, reviewable diffs.',
  runtimeMemory: '## Runtime Memory\nLast run: agent-core smoke, green.',
  workingMemory: '## Working Memory\nMid-task: wiring the v2 memory payload.',
  combined: 'ignored',
  references: [],
};

const RETRIEVAL_ROWS = [
  { id: 'm1', memory_kind: 'decision', title: 'Block 2 only', content: 'Memory never goes in the cached block.', reason: 'semantic' },
  { id: 'm2', memory_kind: 'fact', title: 'Edge fences', content: 'wrapUntrusted runs server side.', reason: null },
];

function main(): void {
  // ── 1. Key allowlist: derived from the core, never restated ──────────────
  const serverOnly = new Set<string>(SERVER_ONLY_SECTION_KEYS);
  const expectedClientKeys = V2_MEMORY_SECTION_KEYS.filter((k) => !serverOnly.has(k));
  assertEq(V2_MEMORY_CLIENT_SECTION_KEYS.length, expectedClientKeys.length, '[keys] client key count == allowlist minus server-only');
  assert(
    expectedClientKeys.every((k) => (V2_MEMORY_CLIENT_SECTION_KEYS as readonly string[]).includes(k)),
    '[keys] every non-server-only allowlist key is client-sendable',
  );
  assert(
    V2_MEMORY_CLIENT_SECTION_KEYS.every((k) => (V2_MEMORY_SECTION_KEYS as readonly string[]).includes(k)),
    '[keys] every client key is in the core allowlist',
  );
  assert(
    !(V2_MEMORY_CLIENT_SECTION_KEYS as readonly string[]).includes('memory_floor'),
    '[keys] memory_floor is NEVER client-sendable (edge rejects it as unauthorized_key)',
  );
  assertEq(isV2MemoryClientSectionKey('memory_floor'), false, '[keys] predicate refuses the server-only key');
  assertEq(isV2MemoryClientSectionKey('turn_retrieval'), true, '[keys] predicate accepts a real key');
  // Order must be the core's EMIT order (priority descending), minus server-only.
  const expectedOrder = V2_MEMORY_EMIT_ORDER.filter((k) => !serverOnly.has(k));
  assertEq(
    V2_MEMORY_CLIENT_SECTION_KEYS.join(','), expectedOrder.join(','),
    '[keys] client key ORDER == core emit order minus server-only',
  );
  // ...and that order really is priority-descending, so budget spend == priority.
  let descending = true;
  for (let i = 1; i < V2_MEMORY_CLIENT_SECTION_KEYS.length; i += 1) {
    if (v2MemorySectionPriority(V2_MEMORY_CLIENT_SECTION_KEYS[i]) > v2MemorySectionPriority(V2_MEMORY_CLIENT_SECTION_KEYS[i - 1])) descending = false;
  }
  assert(descending, '[keys] client key order is priority-descending');
  for (const junk of [null, undefined, 0, {}, [], 'nope', 'runtime_bundle', ' turn_retrieval']) {
    assertEq(isV2MemoryClientSectionKey(junk), false, `[keys] predicate refuses junk ${JSON.stringify(junk)}`);
  }

  // ── 2. Happy path shape ──────────────────────────────────────────────────
  const happy = build({ stores: STORES, retrievalMemories: RETRIEVAL_ROWS });
  assert(happy.payload !== null, '[happy] a payload is produced');
  assertEq(keysOf(happy).length, 5, '[happy] five sections (four stores + retrieval; no soul wisdom supplied)');
  assertEq(keysOf(happy).join(','), 'turn_retrieval,memory_user_notes,memory_user_profile,memory_working,memory_runtime', '[happy] sections are in emit order');
  assert(
    (happy.payload?.sections || []).every((s) => {
      const k = Object.keys(s).sort().join(',');
      return k === 'key,text';
    }),
    '[happy] a wire section carries EXACTLY {key,text} — no authority fields, no priority hint',
  );
  assert(
    (happy.payload?.sections || []).every((s) => typeof s.text === 'string' && s.text.length > 0),
    '[happy] every section text is a non-empty string',
  );
  assertEq(
    happy.totalChars,
    (happy.payload?.sections || []).reduce((n, s) => n + s.text.length, 0),
    '[happy] totalChars == sum of section lengths',
  );
  assert(happy.totalChars <= happy.budgetChars, '[happy] totalChars within budget');
  assertEq(happy.dropped.length, 0, '[happy] nothing dropped at default budget');
  assert(happy.emitted.every((e) => !e.clipped && !e.fenceStripped), '[happy] nothing clipped, nothing was pre-fenced');
  // A section that is simply ABSENT is not "dropped" — nothing was lost.
  assert(!happy.dropped.includes('soul_wisdom' as V2MemoryClientSectionKey), '[happy] an absent section is not reported as dropped');

  // ── 3. The wire contract, round-tripped through the REAL edge normalizer ─
  const norm = normalizeV2MemoryPayload(happy.payload);
  assertEq(norm.ok, true, '[contract] the edge normalizer accepts our payload');
  assertEq(norm.sections.length, keysOf(happy).length, '[contract] every section survives normalization');
  assertEq(norm.rejected.length, 0, '[contract] the edge rejects NOTHING we send');
  assertEq(norm.ignoredAuthorityFields.length, 0, '[contract] we assert NO authority fields');
  assertEq(norm.truncatedInput, false, '[contract] we never trip the edge input limits');
  assertEq(
    norm.sections.map((s) => `${s.key}:${s.text.length}`).join('|'),
    (happy.payload?.sections || []).map((s) => `${s.key}:${s.text.length}`).join('|'),
    '[contract] text survives the edge sanitizer byte-for-byte (already normalized client-side)',
  );
  assert(
    norm.sections.every((s) => s.priority === v2MemorySectionPriority(s.key)),
    '[contract] the edge assigns full server priority (we sent no lowering hint)',
  );

  // ── 4. Empty ⇒ NO payload (field omitted, not an empty object) ───────────
  for (const [label, input] of [
    ['no input', undefined],
    ['empty object', {}],
    ['empty stores', { stores: {} }],
    ['blank stores', { stores: { userNotes: '   ', userProfile: '\n\n', runtimeMemory: '', workingMemory: '\t' } }],
    ['empty retrieval rows', { retrievalMemories: [] }],
    ['rows with no content', { retrievalMemories: [{ id: 'x', memory_kind: 'fact', title: '', content: '' }] }],
    ['only fence markers', { stores: { userNotes: `${UNTRUSTED_OPEN}${UNTRUSTED_CLOSE}` } }],
  ] as Array<[string, unknown]>) {
    const r = build(input);
    assertEq(r.payload, null, `[omit] ${label} ⇒ payload is null`);
  }
  // The call-site contract: `...(memory ? { memory } : {})` must omit the KEY.
  const omitted = { ...(build({}).payload ? { memory: build({}).payload } : {}) };
  assertEq(JSON.stringify(omitted), '{}', '[omit] a null payload omits the `memory` field entirely');
  const present = { ...(happy.payload ? { memory: happy.payload } : {}) };
  assert(Object.prototype.hasOwnProperty.call(present, 'memory'), '[omit] a real payload sets the `memory` field');
  // And prove WHY it matters, against the real assembler. The edge's gate is
  // `hasPayload = memoryPayload !== undefined && memoryPayload !== null`, so an
  // EMPTY payload passes it, the floor read is SKIPPED (`floorRows` stays null),
  // and the block then has neither source — LESS memory than sending nothing.
  const ctx = { userId: 'u1', circleId: 'c1' };
  const floorRow = {
    id: 'f1', title: 'Circle norm', content: 'Ship small reviewable diffs.', memory_kind: 'fact',
    importance: 0.9, scope: 'circle', visibility: 'circle_shared', user_id: 'other-member',
    circle_id: 'c1', is_active: true, status: 'active', updated_at: '2026-07-01T00:00:00.000Z',
  };
  const suppressed = buildV2MemoryBlock({ payload: { sections: [] }, floorRows: null, ctx, fence: wrapUntrusted, planSectionFit });
  assertEq(suppressed.source, 'none', '[omit] an EMPTY payload leaves the turn with NO memory (floor read was skipped)');
  const withFloor = buildV2MemoryBlock({ payload: undefined, floorRows: [floorRow], ctx, fence: wrapUntrusted, planSectionFit });
  assertEq(withFloor.source, 'server_floor', '[omit] OMITTING the field lets the server floor serve the turn');
  assert(withFloor.ok && withFloor.text.includes('Ship small reviewable diffs.'), '[omit] the floor really carries content');

  // ── 5. RAW / unfenced, and the pre-fenced-input strip ───────────────────
  const noFence = (s: string) => !s.includes('untrusted_quoted');
  assert((happy.payload?.sections || []).every((s) => noFence(s.text)), '[raw] no fence marker in any emitted text');
  // The exact hazard: somebody passes `retrieveForTurn().formatted`.
  const alreadyFenced = wrapUntrusted('recalled thing', { heading: '## Relevant memory' });
  assert(alreadyFenced.includes(UNTRUSTED_OPEN), '[raw] fixture really is pre-fenced');
  const stripped = build({ stores: { userNotes: alreadyFenced } });
  assert(stripped.payload !== null, '[raw] pre-fenced input still yields a payload (strip, do not drop)');
  assert(noFence(textFor(stripped, 'memory_user_notes') || 'untrusted_quoted'), '[raw] the fence marker is removed');
  assert(textFor(stripped, 'memory_user_notes')?.includes('recalled thing'), '[raw] the CONTENT is preserved by the strip');
  assertEq(stripped.emitted[0]?.fenceStripped, true, '[raw] fenceStripped is reported (it is a wiring bug worth logging)');
  // Cased / spaced variants, several in one string — and run it TWICE, because a
  // shared /g regex would carry lastIndex and skip matches on alternate calls.
  const nasty = `a${UNTRUSTED_OPEN}b</ UNTRUSTED_QUOTED >c< untrusted_quoted >d${UNTRUSTED_CLOSE}e`;
  for (const pass of [1, 2]) {
    const r = build({ stores: { userNotes: nasty } });
    assert(noFence(textFor(r, 'memory_user_notes') || 'untrusted_quoted'), `[raw] all marker variants stripped (pass ${pass})`);
    assertEq(textFor(r, 'memory_user_notes'), 'abcde', `[raw] strip is exact, content intact (pass ${pass})`);
  }
  const clean = build({ stores: { userNotes: 'plain note' } });
  assertEq(clean.emitted[0]?.fenceStripped, false, '[raw] clean input does not report a strip');
  // CRLF normalizes so char accounting matches what the edge counts.
  const crlf = build({ stores: { userNotes: 'line one\r\nline two\rline three' } });
  assertEq(textFor(crlf, 'memory_user_notes'), 'line one\nline two\nline three', '[raw] CRLF/CR normalize to LF');

  // ── 6. Bounds ────────────────────────────────────────────────────────────
  const huge = filler(V2_MEMORY_WIRE_SECTION_MAX_CHARS + 5000);
  const clipped = build({ stores: { userNotes: huge } });
  const clippedText = textFor(clipped, 'memory_user_notes') || '';
  assert(clippedText.length <= V2_MEMORY_WIRE_SECTION_MAX_CHARS, '[bounds] section clipped to the per-section cap');
  assert(clippedText.length > V2_MEMORY_WIRE_SECTION_MAX_CHARS * 0.5, '[bounds] the clip keeps most of the cap (break back-off is bounded)');
  assertEq(clipped.emitted[0]?.clipped, true, '[bounds] the clip is reported');
  assert(clippedText.endsWith(V2_MEMORY_WIRE_CLIP_MARKER), '[bounds] a clipped section is marked');

  // Wire budget: several max-size sections cannot all fit.
  const big = build({
    stores: {
      userNotes: filler(3800, 'notes'),
      userProfile: filler(3800, 'profile'),
      runtimeMemory: filler(3800, 'runtime'),
      workingMemory: filler(3800, 'working'),
    },
    retrievalMemories: RETRIEVAL_ROWS,
  });
  assert(big.totalChars <= V2_MEMORY_WIRE_BUDGET_CHARS, '[bounds] total stays inside the wire budget');
  assert(big.dropped.length > 0, '[bounds] over-budget sections are dropped, not squeezed');
  // Budget is spent strictly in priority order: retrieval (82) then notes (80)
  // fit inside 6 000; profile (76) / working (71) / runtime (70) do not.
  assertEq(keysOf(big).join(','), 'turn_retrieval,memory_user_notes', '[bounds] the two highest-priority sections are kept');
  assertEq(big.dropped.join(','), 'memory_user_profile,memory_working,memory_runtime', '[bounds] the low-priority tail loses first, in priority order');
  // Priority order under a TIGHT budget: turn_retrieval survives, soul_wisdom does not.
  const tight = build({
    stores: STORES,
    retrievalMemories: RETRIEVAL_ROWS,
    soulWisdomBody: filler(300, 'wisdom'),
    budgetChars: 200,
  });
  assert(keysOf(tight).includes('turn_retrieval'), '[bounds] tight budget keeps turn_retrieval');
  assert(!keysOf(tight).includes('soul_wisdom'), '[bounds] tight budget drops soul_wisdom (priority 44)');
  // Greedy with CONTINUE, not BREAK: a small low-priority section still rides
  // along after a big higher-priority one was refused. Mirrors the edge's own
  // ceiling pass, so the client never makes a drop the edge would not have made.
  const rideAlong = build({
    stores: { userNotes: filler(900, 'big'), runtimeMemory: 'tiny runtime note' },
    budgetChars: 500,
  });
  assert(!keysOf(rideAlong).includes('memory_user_notes'), '[bounds] the oversized higher-priority section is refused');
  assert(keysOf(rideAlong).includes('memory_runtime'), '[bounds] a smaller lower-priority section still fits (continue, not break)');
  assert(rideAlong.dropped.includes('memory_user_notes' as V2MemoryClientSectionKey), '[bounds] the refusal is reported as dropped');

  // Budget/cap sanitization.
  for (const [label, budget] of [
    ['NaN', Number.NaN], ['-1', -1], ['Infinity', Number.POSITIVE_INFINITY],
    ['huge', 10_000_000], ['string', '250'], ['object', {}], ['null', null],
  ] as Array<[string, unknown]>) {
    const r = build({ stores: STORES, budgetChars: budget });
    assert(r.budgetChars >= 0 && r.budgetChars <= V2_MEMORY_WIRE_BUDGET_CHARS, `[bounds] budget ${label} clamps into range`, String(r.budgetChars));
    assert(r.totalChars <= r.budgetChars, `[bounds] budget ${label} is respected`);
  }
  assertEq(build({ stores: STORES, budgetChars: 0 }).payload, null, '[bounds] a zero budget yields no payload');
  const capped = build({ stores: { userNotes: filler(2000) }, sectionMaxChars: 100 });
  assert((textFor(capped, 'memory_user_notes') || '').length <= 100, '[bounds] sectionMaxChars is honoured');
  const capOverride = build({ stores: { userNotes: filler(50_000) }, sectionMaxChars: 999_999 });
  assert((textFor(capOverride, 'memory_user_notes') || '').length <= V2_MEMORY_WIRE_SECTION_MAX_CHARS, '[bounds] sectionMaxChars cannot be raised past the hard cap');
  // Megabyte input: bounded and fast.
  const mega = build({ stores: { userNotes: rep('x', 1_200_000) } });
  assert((textFor(mega, 'memory_user_notes') || '').length <= V2_MEMORY_WIRE_SECTION_MAX_CHARS, '[bounds] a megabyte store body is bounded');

  // ── 7. Determinism ───────────────────────────────────────────────────────
  const d1 = build({ stores: STORES, retrievalMemories: RETRIEVAL_ROWS, soulWisdomBody: 'be terse' });
  const d2 = build({ stores: STORES, retrievalMemories: RETRIEVAL_ROWS, soulWisdomBody: 'be terse' });
  assertEq(JSON.stringify(d1.payload), JSON.stringify(d2.payload), '[determinism] identical input ⇒ byte-identical payload');
  // Property order of the caller's `stores` object must not matter — we read by name.
  const shuffled = { workingMemory: STORES.workingMemory, runtimeMemory: STORES.runtimeMemory, userProfile: STORES.userProfile, userNotes: STORES.userNotes };
  assertEq(
    JSON.stringify(build({ stores: shuffled, retrievalMemories: RETRIEVAL_ROWS }).payload),
    JSON.stringify(build({ stores: STORES, retrievalMemories: RETRIEVAL_ROWS }).payload),
    '[determinism] caller property order does not change the payload',
  );
  const clip1 = build({ stores: { userNotes: filler(9000) } });
  const clip2 = build({ stores: { userNotes: filler(9000) } });
  assertEq(textFor(clip1, 'memory_user_notes'), textFor(clip2, 'memory_user_notes'), '[determinism] clipping is deterministic');

  // ── 8. formatTurnRetrievalText — the RAW rebuild ─────────────────────────
  // Byte-identical to the line `retrieveForTurn` fences (memoryService:1243-46).
  assertEq(
    retrievalText(RETRIEVAL_ROWS),
    '- [decision] Block 2 only: Memory never goes in the cached block. (semantic)\n- [fact] Edge fences: wrapUntrusted runs server side.',
    '[retrieval] line format matches memoryService byte-for-byte',
  );
  assertEq(retrievalText([{ title: 't', content: 'c' }]), '- [fact] t: c', '[retrieval] missing kind defaults to fact');
  assertEq(retrievalText([{ memory_kind: 'k', title: 't', content: 'c', reason: '   ' }]), '- [k] t: c', '[retrieval] a blank reason is omitted');
  assertEq(retrievalText([{ memory_kind: 'k', title: '', content: '' }]), '', '[retrieval] an empty row is skipped');
  const manyRows = new Array(MAX_RETRIEVAL_ROWS_RENDERED + 20).fill(0).map((_, i) => ({ memory_kind: 'f', title: `t${i}`, content: 'c' }));
  assertEq(retrievalText(manyRows).split('\n').length, MAX_RETRIEVAL_ROWS_RENDERED, '[retrieval] row count is capped');
  const longRow = retrievalText([{ memory_kind: 'f', title: 'T', content: rep('z', 5000) }]);
  assert(longRow.length <= MAX_RETRIEVAL_ROW_CHARS, '[retrieval] a long row is clamped');
  assert(longRow.endsWith('…'), '[retrieval] a clamped row is marked');
  for (const junk of [null, undefined, 0, 'rows', {}, [null], [undefined], [0], ['x'], [[]]]) {
    assert(typeof retrievalText(junk) === 'string', `[retrieval] junk ${JSON.stringify(junk)} yields a string`);
  }
  // `.formatted` is the trap — if someone passes it as retrievalText, it is a
  // string and must still land unfenced.
  const trap = build({ retrievalText: wrapUntrusted('- [fact] a: b', { heading: '## Relevant memory' }) });
  assert(noFence(textFor(trap, 'turn_retrieval') || 'untrusted_quoted'), '[retrieval] a pre-fenced `.formatted` fallback is stripped, not forwarded');
  // rows win over the text fallback, and passing BOTH is safe.
  const bothSources = build({ retrievalMemories: RETRIEVAL_ROWS, retrievalText: 'IGNORED FALLBACK' });
  assert(!(textFor(bothSources, 'turn_retrieval') || '').includes('IGNORED FALLBACK'), '[retrieval] raw rows take precedence over the text fallback');

  // ── 9. Hostile / degenerate sweep — never throws ─────────────────────────
  const cyclic: Record<string, unknown> = { userNotes: 'ok' };
  cyclic.self = cyclic;
  const thrower = {
    get userNotes(): string { throw new Error('boom'); },
    get userProfile(): string { return 'survivor'; },
  };
  const proxy = new Proxy({}, { get() { throw new Error('proxy boom'); }, ownKeys() { throw new Error('keys boom'); } });
  const hostile: unknown[] = [
    null, undefined, 0, 1, -1, Number.NaN, '', 'str', true, false, [], [1, 2], {},
    { stores: null }, { stores: 0 }, { stores: 'x' }, { stores: [] }, { stores: cyclic },
    { stores: thrower }, { stores: proxy },
    { stores: { userNotes: 123 } }, { stores: { userNotes: {} } }, { stores: { userNotes: [] } },
    { stores: { userNotes: { toString: () => 'sneaky' } } },
    { retrievalMemories: 'not-an-array' }, { retrievalMemories: proxy },
    { retrievalMemories: [{ get title(): string { throw new Error('row boom'); } }] },
    { soulWisdomBody: {} }, { soulWisdomBody: 42 },
    { budgetChars: {}, sectionMaxChars: [] },
    Object.create(null),
    new Map(), new Set(), Symbol('s') as unknown,
  ];
  let threw = 0;
  for (const input of hostile) {
    try {
      const r = build(input);
      assert(r.payload === null || Array.isArray(r.payload.sections), `[hostile] ${String(typeof input)} returns a valid result`);
      if (r.payload) {
        assert(r.payload.sections.every((s) => isV2MemoryClientSectionKey(s.key)), '[hostile] only allowlisted keys ever escape');
        assert(r.payload.sections.every((s) => typeof s.text === 'string' && s.text.length > 0), '[hostile] only non-empty string text escapes');
      }
    } catch (e) {
      threw += 1;
      failures += 1;
      console.error(`FAIL: [hostile] threw on ${JSON.stringify(String(input))}: ${(e as Error)?.message}`);
    }
  }
  assertEq(threw, 0, '[hostile] nothing in the sweep threw');
  // A throwing getter must lose only ITS section.
  const survived = build({ stores: thrower });
  assertEq(textFor(survived, 'memory_user_profile'), 'survivor', '[hostile] a throwing getter costs only its own section');

  // ── 10. End-to-end into the REAL edge assembler ─────────────────────────
  // Proves (a) no double fencing, (b) the P2 gate: turn_retrieval survives.
  const e2ePayload = build({ stores: STORES, retrievalMemories: RETRIEVAL_ROWS, soulWisdomBody: 'be terse' }).payload;
  const block = buildV2MemoryBlock({ payload: e2ePayload, fence: wrapUntrusted, planSectionFit });
  assertEq(block.ok, true, '[e2e] the edge assembles a block from our payload');
  assertEq(block.source, 'client_payload', '[e2e] the client payload wins over the server floor');
  assertEq(block.failClosed, false, '[e2e] no fail-closed fence anomaly');
  assert(block.emitted.some((e) => e.key === 'turn_retrieval'), '[e2e] P2 GATE: turn_retrieval survives clipping');
  assertEq(
    countOccurrences(block.text, UNTRUSTED_OPEN), block.emitted.length,
    '[e2e] NO DOUBLE FENCING: exactly one opening fence per emitted section',
  );
  assertEq(
    countOccurrences(block.text, UNTRUSTED_CLOSE), block.emitted.length,
    '[e2e] one closing fence per emitted section',
  );
  assertEq(block.dropped.length, 0, '[e2e] a normal turn fits the edge budget whole');
  assertEq(block.fenceCalls, block.emitted.length, '[e2e] every emitted section went through the fence exactly once');
  assert(block.blockChars <= 4200, '[e2e] the assembled block respects the edge ceiling');
  // Same payload, pre-fenced sources: the block must look IDENTICAL in fence count.
  const prefencedPayload = build({
    stores: {
      userNotes: wrapUntrusted(STORES.userNotes),
      userProfile: wrapUntrusted(STORES.userProfile),
      runtimeMemory: wrapUntrusted(STORES.runtimeMemory),
      workingMemory: wrapUntrusted(STORES.workingMemory),
    },
    retrievalMemories: RETRIEVAL_ROWS,
    soulWisdomBody: wrapUntrusted('be terse'),
  }).payload;
  const prefencedBlock = buildV2MemoryBlock({ payload: prefencedPayload, fence: wrapUntrusted, planSectionFit });
  assertEq(
    countOccurrences(prefencedBlock.text, UNTRUSTED_OPEN), prefencedBlock.emitted.length,
    '[e2e] pre-fenced SOURCES still yield exactly one fence per section',
  );

  // ── 11. Constant sanity (the documented invariants) ─────────────────────
  assert(V2_MEMORY_WIRE_SECTION_MAX_CHARS > V2_MEMORY_BUDGET_CHARS, '[constants] the per-section cap sits ABOVE the edge budget, so it never pre-empts the edge clip');
  assertEq(V2_MEMORY_WIRE_BUDGET_CHARS, 2 * V2_MEMORY_BUDGET_CHARS, '[constants] the wire budget is 2x the edge budget');
  assert(V2_MEMORY_WIRE_BUDGET_CHARS > V2_MEMORY_BUDGET_CHARS, '[constants] the wire carries slack so the EDGE makes the choice');
  assert(V2_MEMORY_TURN_RETRIEVAL_BUDGET_CHARS < V2_MEMORY_BUDGET_CHARS, '[constants] retrieval alone cannot consume the whole edge budget');
  assert(V2_MEMORY_BUILD_DEADLINE_MS > 0 && V2_MEMORY_BUILD_DEADLINE_MS <= 3000, '[constants] the build deadline is bounded');
  assert(V2_MEMORY_TURN_RETRIEVAL_COUNT > 0 && V2_MEMORY_STORE_LIMIT > 0, '[constants] loader limits are positive');
  assert(V2_MEMORY_WIRE_CLIP_MARKER.length > 0, '[constants] the clip marker is non-empty');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll v2-memory-payload-builder smoke cases passed (${passes} passed).`);
}

main();
