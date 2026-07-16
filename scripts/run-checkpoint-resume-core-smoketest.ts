/**
 * run-checkpoint-resume-core-smoketest — guards the PURE durable-checkpoint core
 * behind ADD #4 of docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md
 * ("Durable checkpoint-per-step resume"). The DB write/reload is the caller's;
 * this pins the serialize + resume-decision logic:
 *
 *   • buildRunCheckpoint — field coercion (runId/stepIndex/at), a BOUNDED
 *     cycle-safe messages snapshot (string cap + `…[+N]` marker, array/message/
 *     depth caps, JSON-serialisable), and the completed-tool ledger as the
 *     deduped UNION of `toolResults` ids and the snapshot's own `tool_result`
 *     ids — with pending `tool_use` (no result) NOT counted (idempotency =
 *     completed, not requested).
 *   • planResumeFromCheckpoint — resumable roundtrip (fromStep === stepIndex,
 *     skip === completedToolIds) and every not-resumable reason (missing run id,
 *     no completed step, empty snapshot, invalid/corrupt checkpoint).
 *   • isCheckpointStale — fresh/within/boundary/past, future-capture, and
 *     fail-closed on an unreadable clock / missing capture time; invalid
 *     maxAgeMs falls back to the default window.
 *   • hostile / cyclic / throwing-getter / degenerate input → NEVER throws, and
 *     determinism (identical serialization for identical input).
 *
 * Imports the REAL module (pure, zero runtime imports).
 *
 * Run: npx tsx scripts/run-checkpoint-resume-core-smoketest.ts
 */

import {
  buildRunCheckpoint,
  planResumeFromCheckpoint,
  isCheckpointStale,
  DEFAULT_CHECKPOINT_MAX_AGE_MS,
  MAX_SNAPSHOT_MESSAGES,
  MAX_SNAPSHOT_ARRAY_ITEMS,
  MAX_SNAPSHOT_STRING_CHARS,
  MAX_COMPLETED_TOOL_IDS,
  type RunCheckpoint,
  type ResumePlan,
} from '../src/lib/runCheckpointResumeCore';

let passes = 0, failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else { failures++; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function noThrow(fn: () => unknown, m: string): unknown {
  try { const v = fn(); passes++; return v; }
  catch (e) { failures++; console.error('FAIL: ' + m + ' :: threw ' + String(e)); return undefined; }
}

const T = 1_700_000_000_000; // fixed "now" (epoch ms)

function main(): void {
  // ─── (1) buildRunCheckpoint: field coercion + shape ─────────────────────────
  {
    const cp = buildRunCheckpoint({
      runId: '  run-1  ', stepIndex: 3, nowMs: T,
      messages: [{ role: 'user', content: 'go' }], toolResults: null,
    });
    assertEq(cp.runId, 'run-1', '(1) runId trimmed');
    assertEq(cp.stepIndex, 3, '(1) stepIndex passthrough');
    assertEq(cp.at, T, '(1) at = nowMs');
    assert(Array.isArray(cp.messagesSnapshot), '(1) messagesSnapshot is an array');
    assert(Array.isArray(cp.completedToolIds), '(1) completedToolIds is an array');

    // runId variants
    assertEq(buildRunCheckpoint({ runId: 42, stepIndex: 1, nowMs: T, messages: [], toolResults: [] }).runId, '42', '(1) numeric runId → string');
    assertEq(buildRunCheckpoint({ runId: {}, stepIndex: 1, nowMs: T, messages: [], toolResults: [] }).runId, '', '(1) object runId → empty');
    assertEq(buildRunCheckpoint({ runId: null, stepIndex: 1, nowMs: T, messages: [], toolResults: [] }).runId, '', '(1) null runId → empty');

    // stepIndex variants
    assertEq(buildRunCheckpoint({ runId: 'r', stepIndex: 4.9, nowMs: T, messages: [], toolResults: [] }).stepIndex, 4, '(1) float stepIndex floored');
    assertEq(buildRunCheckpoint({ runId: 'r', stepIndex: -7, nowMs: T, messages: [], toolResults: [] }).stepIndex, 0, '(1) negative stepIndex → 0');
    assertEq(buildRunCheckpoint({ runId: 'r', stepIndex: NaN, nowMs: T, messages: [], toolResults: [] }).stepIndex, 0, '(1) NaN stepIndex → 0');
    assertEq(buildRunCheckpoint({ runId: 'r', stepIndex: '5', nowMs: T, messages: [], toolResults: [] }).stepIndex, 5, '(1) numeric-string stepIndex → 5');
    assertEq(buildRunCheckpoint({ runId: 'r', stepIndex: 9e12, nowMs: T, messages: [], toolResults: [] }).stepIndex, 1_000_000, '(1) huge stepIndex clamped');

    // at variants
    assertEq(buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: -5, messages: [], toolResults: [] }).at, 0, '(1) negative nowMs → 0');
    assertEq(buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: Infinity, messages: [], toolResults: [] }).at, 0, '(1) Infinity nowMs → 0');
    assertEq(buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: 'abc', messages: [], toolResults: [] }).at, 0, '(1) non-numeric nowMs → 0');
  }

  // ─── (2) messages snapshot: bounded + JSON-safe ─────────────────────────────
  {
    // Non-array messages → empty snapshot.
    assertEq((buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: 'nope', toolResults: [] }).messagesSnapshot as unknown[]).length, 0, '(2) non-array messages → []');
    assertEq((buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: null, toolResults: [] }).messagesSnapshot as unknown[]).length, 0, '(2) null messages → []');

    // Long string is capped + marked, and the whole snapshot stays JSON-safe.
    const huge = 'x'.repeat(MAX_SNAPSHOT_STRING_CHARS + 5000);
    const cpBig = buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: [{ role: 'user', content: huge }], toolResults: [] });
    const snapStr = noThrow(() => JSON.stringify(cpBig.messagesSnapshot), '(2) snapshot with huge string JSON.stringify') as string;
    const clonedContent = (cpBig.messagesSnapshot as any[])[0].content as string;
    assert(clonedContent.length <= MAX_SNAPSHOT_STRING_CHARS + 20, '(2) long string capped');
    assert(clonedContent.includes('…[+'), '(2) capped string carries length marker');
    assert(!clonedContent.includes(huge) && clonedContent.length < huge.length, '(2) full oversized payload not persisted');
    assert(typeof snapStr === 'string' && snapStr.length > 0, '(2) snapshot serializes');

    // Wide array capped to MAX_SNAPSHOT_ARRAY_ITEMS.
    const wide = Array.from({ length: MAX_SNAPSHOT_ARRAY_ITEMS + 200 }, (_, i) => ({ type: 'text', text: 't' + i }));
    const cpWide = buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: [{ role: 'user', content: wide }], toolResults: [] });
    assertEq((cpWide.messagesSnapshot as any[])[0].content.length, MAX_SNAPSHOT_ARRAY_ITEMS, '(2) wide content array capped');

    // Too many messages capped to MAX_SNAPSHOT_MESSAGES.
    const many = Array.from({ length: MAX_SNAPSHOT_MESSAGES + 150 }, (_, i) => ({ role: 'user', content: 'm' + i }));
    const cpMany = buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: many, toolResults: [] });
    assertEq((cpMany.messagesSnapshot as unknown[]).length, MAX_SNAPSHOT_MESSAGES, '(2) message count capped');

    // Deep nesting collapses to a marker (no unbounded recursion).
    let deep: any = { v: 'leaf' };
    for (let i = 0; i < 30; i++) deep = { child: deep };
    const cpDeep = buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: [{ role: 'user', content: deep }], toolResults: [] });
    const deepStr = noThrow(() => JSON.stringify(cpDeep.messagesSnapshot), '(2) deep snapshot JSON.stringify') as string;
    assert(deepStr.includes('[omitted: too deep]'), '(2) over-depth subtree marked');

    // Non-finite numbers / functions / symbols → null (JSON-safe).
    const cpWeird = buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: [{ role: 'user', content: [{ n: NaN, inf: Infinity, fn: () => 1, sym: Symbol('s') }] }], toolResults: [] });
    const weird = (cpWeird.messagesSnapshot as any[])[0].content[0];
    assertEq(weird.n, null, '(2) NaN → null');
    assertEq(weird.inf, null, '(2) Infinity → null');
    assertEq(weird.fn, null, '(2) function → null');
    assertEq(weird.sym, null, '(2) symbol → null');
  }

  // ─── (3) completedToolIds: union + dedupe + pending excluded ────────────────
  const rich = buildRunCheckpoint({
    runId: 'run-1', stepIndex: 3, nowMs: T,
    messages: [
      { role: 'user', content: 'go' },
      { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'call_A', name: 'foo', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_A', content: 'done A' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_B', name: 'bar', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_B', content: 'done B' }] },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'call_PENDING', name: 'baz', input: {} }] },
    ],
    toolResults: [{ tool_use_id: 'call_A' }, { id: 'call_C' }, 'call_A'],
  });
  {
    // first-occurrence order: results (A, C) then message-only (B); dups removed.
    assertEq(JSON.stringify(rich.completedToolIds), '["call_A","call_C","call_B"]', '(3) union deduped, results-first order');
    assertEq(rich.completedToolIds.filter((x) => x === 'call_A').length, 1, '(3) duplicate id collapsed');
    assert(!rich.completedToolIds.includes('call_PENDING'), '(3) pending tool_use (no result) NOT counted');

    // toolResults accepts raw string ids and toolUseId alias.
    const cpAlias = buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: [], toolResults: ['raw1', { toolUseId: 'alias2' }, { tool_use_id: '  ' }] });
    assertEq(JSON.stringify(cpAlias.completedToolIds), '["raw1","alias2"]', '(3) string id + toolUseId alias; blank dropped');

    // ledger count-capped.
    const flood = Array.from({ length: MAX_COMPLETED_TOOL_IDS + 300 }, (_, i) => 'id_' + i);
    const cpFlood = buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: [], toolResults: flood });
    assertEq(cpFlood.completedToolIds.length, MAX_COMPLETED_TOOL_IDS, '(3) ledger count-capped');

    // no toolResults, ids sourced from messages alone.
    const cpMsgOnly = buildRunCheckpoint({ runId: 'r', stepIndex: 2, nowMs: T, messages: rich.messagesSnapshot, toolResults: undefined });
    assertEq(JSON.stringify(cpMsgOnly.completedToolIds), '["call_A","call_B"]', '(3) ids from messages when toolResults absent');
  }

  // ─── (4) planResumeFromCheckpoint: resumable roundtrip ──────────────────────
  {
    const plan: ResumePlan = planResumeFromCheckpoint(rich);
    assertEq(plan.canResume, true, '(4) rich checkpoint canResume');
    assertEq(plan.fromStep, 3, '(4) fromStep === stepIndex');
    assertEq(JSON.stringify(plan.skipCompletedToolIds), JSON.stringify(rich.completedToolIds), '(4) skip ids roundtrip the ledger');
    assert(plan.reason.includes('step 3'), '(4) reason names the step');
    assert(plan.reason.includes('3 completed tool id'), '(4) reason names the skip count');

    // determinism
    assertEq(JSON.stringify(planResumeFromCheckpoint(rich)), JSON.stringify(plan), '(4) planResume deterministic');
  }

  // ─── (5) planResumeFromCheckpoint: not-resumable reasons ────────────────────
  {
    const noRun = buildRunCheckpoint({ runId: {}, stepIndex: 2, nowMs: T, messages: [{ role: 'user', content: 'x' }], toolResults: [] });
    const pNoRun = planResumeFromCheckpoint(noRun);
    assertEq(pNoRun.canResume, false, '(5) missing runId → not resumable');
    assertEq(pNoRun.fromStep, 0, '(5) not-resumable fromStep 0');
    assertEq(pNoRun.skipCompletedToolIds.length, 0, '(5) not-resumable skip empty');
    assert(pNoRun.reason.includes('missing run id'), '(5) reason: missing run id');

    const noStep = buildRunCheckpoint({ runId: 'r', stepIndex: 0, nowMs: T, messages: [{ role: 'user', content: 'x' }], toolResults: [] });
    assert(planResumeFromCheckpoint(noStep).reason.includes('no completed step'), '(5) reason: no completed step');

    const emptySnap = buildRunCheckpoint({ runId: 'r', stepIndex: 2, nowMs: T, messages: 'garbage', toolResults: [] });
    assert(planResumeFromCheckpoint(emptySnap).reason.includes('empty message snapshot'), '(5) reason: empty snapshot');

    // fully invalid checkpoint values.
    for (const bad of [null, undefined, 'x', 42, true, []]) {
      const p = planResumeFromCheckpoint(bad as unknown);
      assertEq(p.canResume, false, '(5) invalid checkpoint not resumable: ' + JSON.stringify(bad));
    }
    assert(planResumeFromCheckpoint(null).reason.includes('invalid checkpoint'), '(5) reason: invalid checkpoint');

    // corrupt hand-built checkpoint: valid enough to resume, but a non-array
    // completedToolIds is defensively coerced to [] (never throws).
    const corrupt = planResumeFromCheckpoint({ runId: 'r', stepIndex: 2, messagesSnapshot: [{ role: 'user', content: 'hi' }], completedToolIds: 'not-an-array' } as unknown);
    assertEq(corrupt.canResume, true, '(5) hand-built checkpoint resumable');
    assertEq(corrupt.skipCompletedToolIds.length, 0, '(5) corrupt completedToolIds → []');
  }

  // ─── (6) isCheckpointStale ──────────────────────────────────────────────────
  {
    assertEq(DEFAULT_CHECKPOINT_MAX_AGE_MS, 86_400_000, '(6) default window is 24h');

    assertEq(isCheckpointStale({ at: T }, T), false, '(6) age 0 → fresh');
    assertEq(isCheckpointStale({ at: T - 1000 }, T), false, '(6) within default window → fresh');
    assertEq(isCheckpointStale({ at: T + 5000 }, T), false, '(6) future capture → fresh');

    // boundary at exactly maxAgeMs is fresh; one past is stale.
    assertEq(isCheckpointStale({ at: T - 1000 }, T, 1000), false, '(6) age === maxAgeMs → fresh (boundary)');
    assertEq(isCheckpointStale({ at: T - 1001 }, T, 1000), true, '(6) age === maxAgeMs+1 → stale');
    assertEq(isCheckpointStale({ at: T - 2000 }, T, 1000), true, '(6) custom small window → stale');

    // fail-closed: unreadable clock / missing capture time.
    assertEq(isCheckpointStale({}, T), true, '(6) missing at → stale (fail closed)');
    assertEq(isCheckpointStale({ at: 'nope' }, T), true, '(6) non-numeric at → stale');
    assertEq(isCheckpointStale({ at: T }, 'nope'), true, '(6) unreadable now → stale');
    assertEq(isCheckpointStale({ at: T }, null), true, '(6) null now → stale');
    assertEq(isCheckpointStale(null, T), true, '(6) null checkpoint → stale');

    // invalid maxAgeMs falls back to default.
    assertEq(isCheckpointStale({ at: T - 1000 }, T, NaN), false, '(6) NaN maxAgeMs → default window (fresh)');
    assertEq(isCheckpointStale({ at: T - 1000 }, T, -5), false, '(6) negative maxAgeMs → default window (fresh)');
    assertEq(isCheckpointStale({ at: T - (DEFAULT_CHECKPOINT_MAX_AGE_MS + 1) }, T, -5), true, '(6) beyond default window → stale');
  }

  // ─── (7) integration: build → freshness gate → plan ─────────────────────────
  {
    const cp = buildRunCheckpoint({ runId: 'run-9', stepIndex: 2, nowMs: T, messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'tool_use', id: 'z', name: 'n', input: {} }] }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'z', content: 'ok' }] }], toolResults: [{ tool_use_id: 'z' }] });
    assertEq(isCheckpointStale(cp, T + 1000), false, '(7) just-built checkpoint is fresh');
    assertEq(planResumeFromCheckpoint(cp).canResume, true, '(7) fresh checkpoint resumes');
    assertEq(JSON.stringify(planResumeFromCheckpoint(cp).skipCompletedToolIds), '["z"]', '(7) resume skips the completed tool');
    // aged out.
    assertEq(isCheckpointStale(cp, T + DEFAULT_CHECKPOINT_MAX_AGE_MS + 5000), true, '(7) aged checkpoint is stale');
  }

  // ─── (8) hostile / cyclic / degenerate → never throws + determinism ─────────
  {
    // cyclic object inside tool_result content.
    const cyc: any = { k: 'v' }; cyc.self = cyc;
    const cpCyc = noThrow(() => buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'cyc1', content: cyc }] }], toolResults: null }), '(8) cyclic content build') as RunCheckpoint;
    const cycStr = noThrow(() => JSON.stringify(cpCyc.messagesSnapshot), '(8) cyclic snapshot JSON.stringify') as string;
    assert(cycStr.includes('[omitted: circular]'), '(8) cycle replaced with marker');
    assert(cpCyc.completedToolIds.includes('cyc1'), '(8) id still collected past a cycle');

    // self-referential messages ARRAY.
    const arr: any = []; arr.push({ role: 'user', content: 'a' }); arr.push(arr);
    const cpArr = noThrow(() => buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: arr, toolResults: null }), '(8) cyclic messages array build') as RunCheckpoint;
    noThrow(() => JSON.stringify(cpArr), '(8) cyclic-array checkpoint JSON.stringify');

    // throwing getter on a message property.
    const evil: any = { role: 'user' };
    Object.defineProperty(evil, 'content', { enumerable: true, get() { throw new Error('boom'); } });
    const cpEvil = noThrow(() => buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: [evil], toolResults: null }), '(8) throwing-getter build') as RunCheckpoint;
    assertEq((cpEvil.messagesSnapshot as any[])[0].content, null, '(8) throwing getter → null');

    // throwing getter inside a toolResults entry.
    const evilResult: any = {};
    Object.defineProperty(evilResult, 'tool_use_id', { enumerable: true, get() { throw new Error('boom'); } });
    noThrow(() => buildRunCheckpoint({ runId: 'r', stepIndex: 1, nowMs: T, messages: [], toolResults: [evilResult] }), '(8) throwing-getter toolResults build');

    // buildRunCheckpoint with wholly degenerate top-level input.
    for (const bad of [null, undefined, 'x', 42, [], true]) {
      const cp = noThrow(() => buildRunCheckpoint(bad as any), '(8) degenerate build: ' + JSON.stringify(bad)) as RunCheckpoint;
      assertEq(cp.runId, '', '(8) degenerate build runId empty: ' + JSON.stringify(bad));
      assert(Array.isArray(cp.messagesSnapshot) && (cp.messagesSnapshot as unknown[]).length === 0, '(8) degenerate build empty snapshot: ' + JSON.stringify(bad));
      assert(Array.isArray(cp.completedToolIds), '(8) degenerate build has ledger array');
    }

    // planResume + isCheckpointStale over hostile input never throw.
    for (const bad of [null, undefined, 'x', 42, {}, [], { at: {} }]) {
      noThrow(() => planResumeFromCheckpoint(bad as unknown), '(8) planResume no-throw: ' + JSON.stringify(bad));
      const s = noThrow(() => isCheckpointStale(bad as unknown, T), '(8) isCheckpointStale no-throw: ' + JSON.stringify(bad));
      assert(typeof s === 'boolean', '(8) isCheckpointStale returns boolean: ' + JSON.stringify(bad));
    }

    // determinism: identical input → byte-identical checkpoint serialization.
    const mk = () => buildRunCheckpoint({ runId: 'r', stepIndex: 2, nowMs: T, messages: [{ role: 'user', content: 'x' }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'q', content: 'done' }] }], toolResults: [{ id: 'q' }] });
    assertEq(JSON.stringify(mk()), JSON.stringify(mk()), '(8) buildRunCheckpoint deterministic');
  }

  if (failures > 0) { console.error('\n' + failures + ' fail'); process.exit(1); }
  console.log('\nAll runCheckpointResume smoke cases passed (' + passes + ' passed).');
}

main();
