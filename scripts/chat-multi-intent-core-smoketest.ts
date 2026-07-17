/**
 * chat-multi-intent-core-smoketest — the PURE, high-precision multi-intent
 * (compound) chat-turn segmenter (src/lib/chatMultiIntentCore.ts). It enumerates
 * the distinct top-level ACTIONABLE requests packed into one user turn so the
 * app can seed a per-ask TODO, verify all N were addressed, and route each to a
 * possibly-different lane instead of silently dropping later asks. Load-bearing
 * assertions:
 *
 *   segmentChatIntents(msg): a MultiIntentResult whose segments are ordered
 *   IntentSegment[] —
 *     • HIGH-PRECISION: a boundary is kept only when BOTH adjacent clauses lead
 *       with a curated imperative ACTION VERB. Coordinated objects ("fix the
 *       header and footer"), narrative "and" ("I opened it and it crashed"), and
 *       pure questions collapse to ONE 'lead' segment.
 *     • connectives: enumerated > newline > semicolon > then (sequential) > also
 *       (additive); first segment is always 'lead'.
 *     • sequential is forward-looking: seg[i].sequential is true iff seg[i+1]
 *       arrived via a 'then'-class boundary (the last segment is always false).
 *     • reason: 'empty' | 'single-*' | 'multi-sequential' | 'multi-additive' |
 *       'multi-enumerated' | 'capped' | 'error'.
 *     • BOUNDED: scan capped at MAX_INTENT_INPUT_CHARS, ≤ MAX_INTENT_SEGMENTS
 *       segments (overflow tail folded into the last, reason 'capped'), each
 *       text ≤ MAX_SEGMENT_CHARS.
 *     • SECRET-SAFE: segment text is a cleaned substring of the user's own turn —
 *       control / line-separator / prompt-fence chars neutralized, secret-shaped
 *       tokens redacted.
 *
 *   isCompoundRequest(msg) === segmentChatIntents(msg).isMultiIntent.
 *
 *   And: every export is TOTAL — a non-string / empty / huge / cyclic / hostile
 *   input yields isMultiIntent:false with exactly one 'lead' segment and never
 *   throws; identical input yields identical output (deterministic).
 *
 * Pure — loads under tsx (chatMultiIntentCore has zero runtime imports).
 */

import {
  segmentChatIntents,
  isCompoundRequest,
  MAX_INTENT_INPUT_CHARS,
  MAX_INTENT_SEGMENTS,
  MAX_SEGMENT_CHARS,
  type MultiIntentResult,
  type IntentConnective,
} from '../src/lib/chatMultiIntentCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertJson(a: unknown, b: unknown, msg: string): void {
  assert(JSON.stringify(a) === JSON.stringify(b), msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
/** Stringify a possibly-hostile value for an assert label without ever throwing. */
function safeLabel(v: unknown): string {
  try { return JSON.stringify(String(v).slice(0, 24)); } catch { return '<unstringifiable>'; }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function res(msg: unknown): MultiIntentResult { return segmentChatIntents(msg); }
function verbs(msg: unknown): Array<string | null> { return res(msg).segments.map((s) => s.verb); }
function cons(msg: unknown): IntentConnective[] { return res(msg).segments.map((s) => s.connective); }
function seqs(msg: unknown): boolean[] { return res(msg).segments.map((s) => s.sequential); }
function texts(msg: unknown): string[] { return res(msg).segments.map((s) => s.text); }
function count(msg: unknown): number { return res(msg).segments.length; }

const ALLOWED_CONNECTIVES = new Set(['lead', 'then', 'also', 'enumerated', 'newline', 'semicolon']);

/** Structural invariants any result must satisfy for any input. */
function invariantsHold(msg: unknown): boolean {
  const r = segmentChatIntents(msg);
  if (!r || typeof r.isMultiIntent !== 'boolean' || !Array.isArray(r.segments)) return false;
  if (typeof r.reason !== 'string' || r.reason.length === 0) return false;
  if (r.segments.length < 1 || r.segments.length > MAX_INTENT_SEGMENTS) return false;
  if (r.segments[0].connective !== 'lead') return false;
  // isMultiIntent iff there is more than one segment.
  if (r.isMultiIntent !== (r.segments.length > 1)) return false;
  for (let i = 0; i < r.segments.length; i += 1) {
    const s = r.segments[i];
    if (s.index !== i) return false;
    if (typeof s.text !== 'string' || s.text.length > MAX_SEGMENT_CHARS) return false;
    if (!(s.verb === null || typeof s.verb === 'string')) return false;
    if (!ALLOWED_CONNECTIVES.has(s.connective)) return false;
    if (typeof s.sequential !== 'boolean') return false;
    // last segment is never sequential; a sequential edge points at a 'then'.
    if (i === r.segments.length - 1 && s.sequential) return false;
    if (s.sequential && r.segments[i + 1].connective !== 'then') return false;
  }
  return true;
}

/** Never throws + returns a well-formed result for arbitrary input. */
function totalOn(msg: unknown): boolean {
  try {
    const r = segmentChatIntents(msg);
    return !!r && typeof r.isMultiIntent === 'boolean' && Array.isArray(r.segments)
      && r.segments.length >= 1 && typeof isCompoundRequest(msg) === 'boolean';
  } catch {
    return false;
  }
}

/** A single 'lead' segment result (the neutral shape). */
function isSingleLead(msg: unknown): boolean {
  const r = segmentChatIntents(msg);
  return r.isMultiIntent === false && r.segments.length === 1 && r.segments[0].connective === 'lead';
}

function main(): void {
  // ─── (1) exported bounds + basic shape ──────────────────────────────────────
  assertEq(MAX_INTENT_INPUT_CHARS, 4000, '(1) MAX_INTENT_INPUT_CHARS is 4000');
  assertEq(MAX_INTENT_SEGMENTS, 8, '(1) MAX_INTENT_SEGMENTS is 8');
  assertEq(MAX_SEGMENT_CHARS, 300, '(1) MAX_SEGMENT_CHARS is 300');
  assertEq(typeof segmentChatIntents, 'function', '(1) segmentChatIntents is a function');
  assertEq(typeof isCompoundRequest, 'function', '(1) isCompoundRequest is a function');
  {
    const r = segmentChatIntents('deploy');
    assert(Array.isArray(r.segments) && r.segments.length === 1, '(1) minimal turn → one segment');
    assertEq(r.segments[0].index, 0, '(1) first segment index 0');
    assertEq(r.segments[0].connective, 'lead', '(1) first connective is lead');
  }

  // ─── (2) the flagship compound turn (exact contract) ────────────────────────
  {
    const msg = 'fix the login bug, then update the changelog, and also open a PR';
    const r = segmentChatIntents(msg);
    assertEq(r.isMultiIntent, true, '(2) flagship is multi-intent');
    assertEq(r.segments.length, 3, '(2) flagship → 3 segments');
    assertJson(verbs(msg), ['fix', 'update', 'open'], '(2) verbs fix/update/open');
    assertJson(cons(msg), ['lead', 'then', 'also'], '(2) connectives lead/then/also');
    assertJson(seqs(msg), [true, false, false], '(2) sequential true/false/false (forward edge)');
    assertJson(texts(msg), ['fix the login bug', 'update the changelog', 'open a PR'], '(2) exact segment texts');
    assertEq(r.reason, 'multi-sequential', '(2) reason multi-sequential (a then edge present)');
    assertJson(r.segments.map((s) => s.index), [0, 1, 2], '(2) indices are 0,1,2');
  }

  // ─── (3) single-intent precision (bias to ONE) ──────────────────────────────
  assertEq(isCompoundRequest('fix the header and footer'), false, '(3) coordinated object → single');
  assertJson(verbs('fix the header and footer'), ['fix'], '(3) coordinated object keeps one verb');
  assertEq(res('fix the header and footer').reason, 'single-one-verb', '(3) reason single-one-verb');
  assertEq(isCompoundRequest('I opened the file and it crashed'), false, '(3) narrative and → single');
  assertEq(res('I opened the file and it crashed').reason, 'single-no-verb', '(3) narrative has no imperative');
  assertEq(isCompoundRequest("what's broken and how do I fix it?"), false, '(3) question → single');
  assertEq(res("what's broken and how do I fix it?").segments[0].verb, null, '(3) question verb null');
  assertEq(isCompoundRequest('deploy'), false, '(3) bare verb → single');
  assertEq(isCompoundRequest('the header is misaligned'), false, '(3) statement → single');
  assertJson(verbs('the header is misaligned'), [null], '(3) statement has no leading verb');
  assertEq(isCompoundRequest('update the readme and the changelog'), false, '(3) "and the changelog" is an object, not a predicate');
  assertJson(verbs('update the readme and the changelog'), ['update'], '(3) second object has no verb');
  assertEq(isCompoundRequest('review the PR and the issues'), false, '(3) coordinated objects after review → single');
  assertEq(isCompoundRequest('summarize the thread'), false, '(3) single safe verb → single');
  // "the fix is ready ..." — "fix" is a NOUN here; must not read as imperative.
  assertEq(isCompoundRequest('the fix is ready and the tests pass'), false, '(3) noun "fix" not mistaken for imperative');

  // ─── (4) multi — sequential ('then'-class) ──────────────────────────────────
  {
    const msg = 'open the file then run the tests';
    assertEq(isCompoundRequest(msg), true, '(4) then splits');
    assertJson(verbs(msg), ['open', 'run'], '(4) then verbs');
    assertJson(cons(msg), ['lead', 'then'], '(4) then connectives');
    assertJson(seqs(msg), [true, false], '(4) then makes the first segment sequential');
    assertEq(res(msg).reason, 'multi-sequential', '(4) reason multi-sequential');
  }
  assertJson(cons('add the endpoint. after that deploy it'), ['lead', 'then'], '(4) "after that" is a then edge');
  assertEq(isCompoundRequest('write the migration next run it'), true, '(4) "next" is a then edge');
  assertJson(seqs('build the api then deploy it then verify it'), [true, true, false], '(4) chained then edges');
  assertEq(res('build the api then deploy it then verify it').segments.length, 3, '(4) three sequential segments');

  // ─── (5) multi — additive ('also'-class + bare and) ─────────────────────────
  {
    const msg = 'update the readme and deploy the site';
    assertEq(isCompoundRequest(msg), true, '(5) bare and with new predicate splits');
    assertJson(cons(msg), ['lead', 'also'], '(5) bare and → also connective');
    assertJson(seqs(msg), [false, false], '(5) additive edges are not sequential');
    assertEq(res(msg).reason, 'multi-additive', '(5) reason multi-additive');
  }
  assertJson(cons('write the docs as well as test the code'), ['lead', 'also'], '(5) "as well as" is additive');
  assertJson(cons('fix the bug plus deploy the fix'), ['lead', 'also'], '(5) "plus" is additive');
  assertJson(cons('fix the bug and also deploy it'), ['lead', 'also'], '(5) "and also" is additive');
  assertEq(isCompoundRequest('review the PR and merge it'), true, '(5) review + merge → multi');

  // ─── (6) multi — structural (enumerated / newline / semicolon) ──────────────
  {
    const msg = '1. add tests\n2. run them\n3. commit the fix';
    assertEq(isCompoundRequest(msg), true, '(6) enumerated list splits');
    assertEq(res(msg).segments.length, 3, '(6) three enumerated items');
    assertJson(verbs(msg), ['add', 'run', 'commit'], '(6) enumerated verbs, markers stripped');
    assertJson(cons(msg), ['lead', 'enumerated', 'enumerated'], '(6) enumerated connectives');
    assertJson(texts(msg), ['add tests', 'run them', 'commit the fix'], '(6) enumerated item texts (no markers)');
    assertEq(res(msg).reason, 'multi-enumerated', '(6) reason multi-enumerated');
  }
  assertEq(isCompoundRequest('1. milk\n2. eggs\n3. bread'), false, '(6) enumerated list of NON-actions → single (high precision)');
  assertJson(cons('fix the bug\nupdate the docs'), ['lead', 'newline'], '(6) newline connective');
  assertEq(res('fix the bug\nupdate the docs').reason, 'multi-additive', '(6) newline defaults to additive flavor');
  assertJson(cons('fix the bug; deploy the site'), ['lead', 'semicolon'], '(6) semicolon connective');
  assertEq(isCompoundRequest('- fix the bug\n- deploy the site'), true, '(6) dash bullets split');
  assertJson(cons('- fix the bug\n- deploy the site'), ['lead', 'enumerated'], '(6) bullet markers are enumerated');

  // ─── (7) isCompoundRequest parity + verb/courtesy handling ──────────────────
  for (const m of [
    'fix the login bug, then update the changelog, and also open a PR',
    'fix the header and footer',
    'deploy',
    'what now?',
    '1. add tests\n2. run them',
    'update the readme and deploy the site',
  ]) {
    assertEq(isCompoundRequest(m), segmentChatIntents(m).isMultiIntent, `(7) isCompoundRequest parity :: ${m.slice(0, 30)}`);
  }
  // courtesy / filler stripped when reading a clause's leading verb.
  assertJson(verbs('please fix the bug and can you deploy it'), ['fix', 'deploy'], '(7) courtesy prefixes stripped for verb detection');
  assertEq(res('please fix the bug and can you deploy it').segments[0].text, 'please fix the bug', '(7) segment text keeps the user words');
  assertEq(segmentChatIntents('just quickly deploy it').segments[0].verb, 'deploy', '(7) leading adverbs stripped');

  // ─── (8) bounds — segment cap + tail fold ───────────────────────────────────
  {
    const many = 'fix a and deploy b and run c and open d and test e and build f and add g and send h and publish i and review j';
    const r = segmentChatIntents(many);
    assertEq(r.segments.length, MAX_INTENT_SEGMENTS, '(8) capped at MAX_INTENT_SEGMENTS');
    assertEq(r.reason, 'capped', '(8) reason capped');
    assertEq(r.isMultiIntent, true, '(8) capped is still multi-intent');
    const last = r.segments[r.segments.length - 1].text;
    assert(last.includes('send') && last.includes('publish') && last.includes('review'), '(8) overflow tail folded into last segment (nothing dropped)', last);
    assert(r.segments.every((s) => s.text.length <= MAX_SEGMENT_CHARS), '(8) every segment ≤ MAX_SEGMENT_CHARS');
    assert(invariantsHold(many), '(8) capped result satisfies invariants');
  }
  // ─── (8b) per-segment length cap ────────────────────────────────────────────
  {
    const longWords = `fix ${'the bug here '.repeat(40)} and deploy it`;
    const r = segmentChatIntents(longWords);
    assertEq(r.segments[0].text.length, MAX_SEGMENT_CHARS, '(8b) long segment truncated to MAX_SEGMENT_CHARS');
    assert(r.segments[0].text.endsWith('…'), '(8b) truncation marker appended');
    assert(invariantsHold(longWords), '(8b) long-segment result satisfies invariants');
  }
  // ─── (8c) input scan capped at MAX_INTENT_INPUT_CHARS ───────────────────────
  {
    const filler = 'z'.repeat(MAX_INTENT_INPUT_CHARS);
    assertEq(isCompoundRequest(`deploy the site ${filler} and fix the bug`), false, '(8c) boundary beyond scan cap is not seen');
    assertEq(isCompoundRequest(`deploy the site and fix the bug ${filler}`), true, '(8c) boundary within scan cap is seen');
  }

  // ─── (9) determinism (same input twice → identical) ─────────────────────────
  for (const m of [
    'fix the login bug, then update the changelog, and also open a PR',
    '1. add tests\n2. run them\n3. commit the fix',
    'the header is misaligned',
    'fix a and deploy b and run c and open d and test e and build f and add g and send h and publish i',
    null,
    { a: 1 },
  ] as unknown[]) {
    assertJson(segmentChatIntents(m), segmentChatIntents(m), `(9) deterministic :: ${String(m).slice(0, 24)}`);
    assertEq(isCompoundRequest(m), isCompoundRequest(m), `(9) isCompoundRequest deterministic :: ${String(m).slice(0, 24)}`);
  }

  // ─── (10) secret-safety + control-char cleaning ─────────────────────────────
  {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
    const sk = 'sk-ant-api03-ABCDEFGHIJKLMNOPqrstuvwxyz0123456789';
    const r = segmentChatIntents(`deploy the key ${sk} and fix the token ${jwt}`);
    const blob = JSON.stringify(r);
    assert(!blob.includes('sk-ant'), '(10) sk- key redacted out of segments');
    assert(!blob.includes('eyJ'), '(10) JWT redacted out of segments');
    assert(r.segments.every((s) => s.text.includes('[redacted]')), '(10) each secret-bearing segment shows [redacted]', blob);
    assertEq(r.isMultiIntent, true, '(10) redaction does not change segmentation');
    assertJson(verbs(`deploy the key ${sk} and fix the token ${jwt}`), ['deploy', 'fix'], '(10) verbs survive redaction');
  }
  {
    const NUL = String.fromCharCode(0);
    const LS = String.fromCharCode(0x2028); // line separator
    const ZW = String.fromCharCode(0x200b); // zero-width space
    const BIDI = String.fromCharCode(0x202e); // right-to-left override
    const msg = `deploy the${NUL} site and fix${LS} the${ZW} bug${BIDI}`;
    const r = segmentChatIntents(msg);
    const blob = r.segments.map((s) => s.text).join('|');
    assert(!blob.includes(NUL), '(10) NUL control char stripped');
    assert(!blob.includes(LS), '(10) line separator stripped');
    assert(!blob.includes(ZW), '(10) zero-width space stripped');
    assert(!blob.includes(BIDI), '(10) bidi override stripped');
    assertEq(r.isMultiIntent, true, '(10) control chars do not break segmentation');
  }
  {
    // prompt-fence run neutralized.
    const r = segmentChatIntents('deploy the site ``` and fix the bug');
    assert(!r.segments.some((s) => s.text.includes('```')), '(10) triple-backtick fence neutralized');
  }

  // ─── (11) hostile / degenerate inputs — never throw, neutral single lead ────
  try {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const throwing = {
      toString() { throw new Error('boom'); },
      valueOf() { throw new Error('boom'); },
    };
    const hostile: unknown[] = [
      null, undefined, 42, 0, -1, NaN, Infinity, -Infinity, true, false,
      {}, [], [1, 2, 3], () => 'x', Symbol('s'), 9n, cyclic, throwing,
      '', '   ', '\n\t\n', '🔥💥 deploy 🚀', new Date as unknown,
    ];
    for (const h of hostile) {
      assert(totalOn(h), '(11) total (no throw) on hostile input', safeLabel(h));
      assert(invariantsHold(h), '(11) invariants hold on hostile input', safeLabel(h));
    }
    // non-strings, empty, and whitespace collapse to the neutral 'empty' result.
    for (const n of [null, undefined, 42, NaN, Infinity, true, {}, [], cyclic, throwing, '', '   ', '\n\n']) {
      assert(isSingleLead(n), '(11) neutral single lead for non-actionable input', safeLabel(n));
    }
    assertEq(segmentChatIntents(null).reason, 'empty', '(11) non-string reason empty');
    assertEq(segmentChatIntents('   ').reason, 'empty', '(11) whitespace-only reason empty');
    assertEq(segmentChatIntents(null).segments[0].text, '', '(11) non-string emits empty text');
    assertEq(segmentChatIntents(null).segments[0].verb, null, '(11) non-string verb null');
    assertEq(isCompoundRequest(throwing), false, '(11) throwing toString → false, no throw');

    // huge inputs stay bounded + never throw.
    const hugeFlat = 'word '.repeat(900000); // ~4.5MB, no actionable boundary
    assert(isSingleLead(hugeFlat), '(11) huge flat string → single lead');
    assert(count(hugeFlat) === 1, '(11) huge flat string → one segment');
    const hugeMulti = `fix the bug and deploy the site ${'and run it '.repeat(400000)}`;
    const rHuge = segmentChatIntents(hugeMulti);
    assert(rHuge.segments.length <= MAX_INTENT_SEGMENTS, '(11) huge multi string stays ≤ MAX_INTENT_SEGMENTS');
    assert(rHuge.segments.every((s) => s.text.length <= MAX_SEGMENT_CHARS), '(11) huge multi string segments stay bounded');
    assert(invariantsHold(hugeMulti), '(11) huge multi string satisfies invariants');

    passes += 1; // reached end of the hostile group without throwing
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (11) hostile/degenerate inputs threw: ${(e as Error)?.message}`);
  }

  // ─── (12) structural invariants sweep over varied prose ─────────────────────
  for (const m of [
    'deploy',
    'fix the header and footer',
    'fix the login bug, then update the changelog, and also open a PR',
    '1. add tests\n2. run them\n3. commit the fix',
    'what should I do about the failing build?',
    'update the readme and deploy the site; then publish the release',
    'and then and then and then',
    ';;;;;',
    'also plus next finally',
    '\n\n\n- \n- \n',
    'refactor the parser and optimize the query and cache the results and log the timing',
  ]) {
    assert(invariantsHold(m), '(12) invariants hold', JSON.stringify(m.slice(0, 32)));
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chat-multi-intent-core smoke cases passed (${passes} passed).`);
}

main();
