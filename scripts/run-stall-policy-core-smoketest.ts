/**
 * run-stall-policy-core-smoketest — the pure run-stall / zombie-liveness policy
 * (src/lib/runStallPolicyCore.ts) behind session-runtime expansion v6: detect
 * `agent_runs` rows stuck at 'running' after a crash so a background reaper can
 * mark them failed and live introspection gets a truthful liveness signal.
 * Load-bearing assertions:
 *
 *   THRESHOLDS: STALE=2min, DEAD=5min; DEAD > STALE.
 *
 *   CLASSIFY: a 'running' run with a fresh heartbeat (updatedAt) is 'live';
 *   >=2min heartbeat age is 'stale'; >=5min is 'dead' (reap → failed). Boundaries
 *   are inclusive. Only 'running' is reapable — completed/failed/cancelled/queued/
 *   planning/waiting_approval/paused are ALWAYS 'live' even with an ancient
 *   timestamp. updatedAt is the heartbeat (started_at is a fallback only). Future
 *   heartbeats (clock skew) stay 'live'. Status match is case/space tolerant.
 *
 *   REAP PLAN: planRunReap buckets dead ids into toReap and stale ids into stale,
 *   disjoint and de-duplicated; live/terminal runs land in neither.
 *
 *   TOTALITY: nowMs is always an INPUT (deterministic); null/undefined/wrong-type/
 *   hostile/huge input yields a safe neutral ('live' / empty plan), never a throw.
 *
 * Pure — loads under tsx (runStallPolicyCore has zero imports).
 */

import {
  RUN_STALL_STALE_MS,
  RUN_STALL_DEAD_MS,
  classifyRunLiveness,
  planRunReap,
  type RunLiveness,
  type RunReapPlan,
} from '../src/lib/runStallPolicyCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq<T>(a: T, b: T, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Fixed synthetic clock (no Date.now anywhere) — deterministic.
const NOW = 1_700_000_000_000;
const MIN = 60_000;
const iso = (epochMs: number): string => new Date(epochMs).toISOString();

// Helpers to classify a 'running' run whose heartbeat is `ageMs` old.
function livenessAt(ageMs: number, updatedAt: unknown = iso(NOW - ageMs)): RunLiveness {
  return classifyRunLiveness({ status: 'running', startedAt: iso(NOW - ageMs), updatedAt, nowMs: NOW });
}
function runRow(id: string, status: unknown, ageMs: number, extra?: Record<string, unknown>) {
  return { id, status, updated_at: iso(NOW - ageMs), started_at: iso(NOW - ageMs), ...(extra || {}) };
}

function main(): void {
  // ── 1. Thresholds ─────────────────────────────────────────────────────────
  assertEq(RUN_STALL_STALE_MS, 120000, 'STALE = 2min');
  assertEq(RUN_STALL_DEAD_MS, 300000, 'DEAD = 5min');
  assert(RUN_STALL_DEAD_MS > RUN_STALL_STALE_MS, 'DEAD > STALE');
  assertEq(RUN_STALL_STALE_MS, 2 * MIN, 'STALE arithmetic');
  assertEq(RUN_STALL_DEAD_MS, 5 * MIN, 'DEAD arithmetic');

  // ── 2. running + fresh heartbeat → live ───────────────────────────────────
  assertEq(livenessAt(0), 'live', 'age 0 → live');
  assertEq(livenessAt(10_000), 'live', 'age 10s → live');
  assertEq(livenessAt(60_000), 'live', 'age 1min → live');
  assertEq(livenessAt(RUN_STALL_STALE_MS - 1), 'live', 'just under stale → live');
  assertEq(livenessAt(1), 'live', 'age 1ms → live');

  // ── 3. running + stale window → stale ─────────────────────────────────────
  assertEq(livenessAt(RUN_STALL_STALE_MS), 'stale', 'exactly stale boundary → stale (inclusive)');
  assertEq(livenessAt(RUN_STALL_STALE_MS + 1), 'stale', 'just over stale → stale');
  assertEq(livenessAt(3 * MIN), 'stale', '3min → stale');
  assertEq(livenessAt(4 * MIN), 'stale', '4min → stale');
  assertEq(livenessAt(RUN_STALL_DEAD_MS - 1), 'stale', 'just under dead → stale');

  // ── 4. running + dead window → dead (reap) ────────────────────────────────
  assertEq(livenessAt(RUN_STALL_DEAD_MS), 'dead', 'exactly dead boundary → dead (inclusive)');
  assertEq(livenessAt(RUN_STALL_DEAD_MS + 1), 'dead', 'just over dead → dead');
  assertEq(livenessAt(10 * MIN), 'dead', '10min → dead');
  assertEq(livenessAt(60 * MIN), 'dead', '1hr → dead');
  assertEq(livenessAt(24 * 60 * MIN), 'dead', '1 day → dead');

  // ── 5. non-running statuses → always live (never reaped) ──────────────────
  const ancient = 60 * MIN; // way past DEAD
  for (const st of ['completed', 'failed', 'cancelled', 'queued', 'planning', 'waiting_approval', 'paused']) {
    assertEq(
      classifyRunLiveness({ status: st, startedAt: iso(NOW - ancient), updatedAt: iso(NOW - ancient), nowMs: NOW }),
      'live',
      `status ${st} + ancient heartbeat → live (never reaped)`,
    );
  }

  // ── 6. heartbeat source + fallback semantics ──────────────────────────────
  // updatedAt is THE heartbeat: fresh updatedAt beats an ancient started_at.
  assertEq(
    classifyRunLiveness({ status: 'running', startedAt: iso(NOW - ancient), updatedAt: iso(NOW - 1000), nowMs: NOW }),
    'live',
    'fresh updatedAt wins over ancient started_at → live',
  );
  // Ancient updatedAt is dead even if started_at looks fresh.
  assertEq(
    classifyRunLiveness({ status: 'running', startedAt: iso(NOW - 1000), updatedAt: iso(NOW - ancient), nowMs: NOW }),
    'dead',
    'ancient updatedAt → dead even with fresh started_at',
  );
  // No updatedAt → fall back to started_at (fresh → live).
  assertEq(
    classifyRunLiveness({ status: 'running', startedAt: iso(NOW - 1000), updatedAt: undefined, nowMs: NOW }),
    'live',
    'no updatedAt, fresh started_at → live (fallback)',
  );
  // No updatedAt → fall back to started_at (ancient → dead).
  assertEq(
    classifyRunLiveness({ status: 'running', startedAt: iso(NOW - ancient), updatedAt: null, nowMs: NOW }),
    'dead',
    'no updatedAt, ancient started_at → dead (fallback)',
  );
  // Neither timestamp → cannot classify → live.
  assertEq(
    classifyRunLiveness({ status: 'running', startedAt: undefined, updatedAt: undefined, nowMs: NOW }),
    'live',
    'no heartbeat signal at all → live',
  );

  // ── 7. timestamp value forms (ISO string / epoch number / Date) ───────────
  assertEq(livenessAt(3 * MIN, iso(NOW - 3 * MIN)), 'stale', 'ISO string heartbeat → stale');
  assertEq(livenessAt(10 * MIN, NOW - 10 * MIN), 'dead', 'epoch-number heartbeat → dead');
  assertEq(livenessAt(0, new Date(NOW - 5000)), 'live', 'Date heartbeat fresh → live');
  assertEq(livenessAt(6 * MIN, new Date(NOW - 6 * MIN)), 'dead', 'Date heartbeat ancient → dead');

  // ── 8. status normalization (case / whitespace tolerant) ──────────────────
  assertEq(
    classifyRunLiveness({ status: 'RUNNING', startedAt: iso(NOW - ancient), updatedAt: iso(NOW - ancient), nowMs: NOW }),
    'dead',
    'uppercase RUNNING classifies',
  );
  assertEq(
    classifyRunLiveness({ status: '  running  ', startedAt: iso(NOW - ancient), updatedAt: iso(NOW - ancient), nowMs: NOW }),
    'dead',
    'padded running classifies',
  );
  assertEq(
    classifyRunLiveness({ status: 'Running', startedAt: iso(NOW - ancient), updatedAt: iso(NOW - 3 * MIN), nowMs: NOW }),
    'stale',
    'mixed-case Running classifies stale',
  );
  assertEq(
    classifyRunLiveness({ status: 'run', startedAt: iso(NOW - ancient), updatedAt: iso(NOW - ancient), nowMs: NOW }),
    'live',
    'partial "run" is NOT running → live',
  );

  // ── 9. clock skew — heartbeat in the future → live (negative age) ─────────
  assertEq(
    classifyRunLiveness({ status: 'running', startedAt: iso(NOW), updatedAt: iso(NOW + 60_000), nowMs: NOW }),
    'live',
    'future heartbeat (skew) → live',
  );
  assertEq(
    classifyRunLiveness({ status: 'running', startedAt: iso(NOW), updatedAt: iso(NOW + 24 * 60 * MIN), nowMs: NOW }),
    'live',
    'far-future heartbeat → live',
  );

  // ── 10. planRunReap — mixed batch ─────────────────────────────────────────
  const batch = [
    runRow('live-1', 'running', 30_000), // live
    runRow('stale-1', 'running', 3 * MIN), // stale
    runRow('stale-2', 'running', 4 * MIN), // stale
    runRow('dead-1', 'running', 6 * MIN), // dead
    runRow('dead-2', 'running', 20 * MIN), // dead
    runRow('done-1', 'completed', 60 * MIN), // terminal → neither
    runRow('fail-1', 'failed', 60 * MIN), // terminal → neither
    runRow('wait-1', 'waiting_approval', 60 * MIN), // idle → neither
  ];
  const plan = planRunReap(batch, NOW);
  assertEq(plan.toReap.length, 2, 'toReap has 2 dead ids');
  assert(plan.toReap.includes('dead-1') && plan.toReap.includes('dead-2'), 'toReap = the dead ids');
  assertEq(plan.stale.length, 2, 'stale has 2 stale ids');
  assert(plan.stale.includes('stale-1') && plan.stale.includes('stale-2'), 'stale = the stale ids');
  assert(!plan.toReap.includes('live-1') && !plan.stale.includes('live-1'), 'live run in neither bucket');
  assert(!plan.toReap.includes('done-1') && !plan.stale.includes('done-1'), 'completed run never reaped');
  assert(!plan.toReap.includes('wait-1') && !plan.stale.includes('wait-1'), 'waiting_approval never reaped');
  // Buckets disjoint.
  assert(plan.toReap.every((id) => !plan.stale.includes(id)), 'toReap ∩ stale = ∅');

  // ── 11. planRunReap — camelCase rows + de-dup ─────────────────────────────
  const camel = [
    { id: 'c-dead', status: 'running', updatedAt: iso(NOW - 10 * MIN), startedAt: iso(NOW - 10 * MIN) },
    { id: 'c-stale', status: 'running', updatedAt: iso(NOW - 3 * MIN), startedAt: iso(NOW - 3 * MIN) },
  ];
  const camelPlan = planRunReap(camel, NOW);
  assert(camelPlan.toReap.includes('c-dead'), 'camelCase updatedAt read → dead');
  assert(camelPlan.stale.includes('c-stale'), 'camelCase updatedAt read → stale');

  // Duplicate ids de-duplicated (first classification wins the bucket).
  const dupPlan = planRunReap(
    [runRow('dup', 'running', 10 * MIN), runRow('dup', 'running', 10 * MIN)],
    NOW,
  );
  assertEq(dupPlan.toReap.length, 1, 'duplicate dead id de-duped');
  assertEq(dupPlan.toReap[0], 'dup', 'de-duped id preserved');

  // Rows missing / invalid ids are skipped.
  const skipPlan = planRunReap(
    [
      { status: 'running', updated_at: iso(NOW - 10 * MIN) }, // no id
      { id: '', status: 'running', updated_at: iso(NOW - 10 * MIN) }, // empty id
      { id: 42, status: 'running', updated_at: iso(NOW - 10 * MIN) }, // non-string id
      runRow('ok-dead', 'running', 10 * MIN),
    ],
    NOW,
  );
  assertEq(skipPlan.toReap.length, 1, 'only the valid-id dead row survives');
  assertEq(skipPlan.toReap[0], 'ok-dead', 'valid dead id kept');

  // Empty list → empty plan.
  const emptyPlan = planRunReap([], NOW);
  assertEq(emptyPlan.toReap.length, 0, 'empty list → no reap');
  assertEq(emptyPlan.stale.length, 0, 'empty list → no stale');

  // ── 12. planRunReap — huge input stays bounded ────────────────────────────
  const huge = new Array(20000).fill(0).map((_, i) => runRow('h' + i, 'running', 10 * MIN));
  const hugePlan = planRunReap(huge, NOW);
  assert(hugePlan.toReap.length <= 5000, 'huge input bounded to MAX_RUNS');
  assert(hugePlan.toReap.length > 0, 'huge input still produces some reap ids');

  // ── 13. HOSTILE / DEGENERATE — no throw, safe neutral ─────────────────────
  // classifyRunLiveness on junk → 'live'.
  const junkInputs: unknown[] = [
    null, undefined, 0, 1, -1, NaN, Infinity, '', 'x', true, false, [], {}, () => 0, Symbol('s'),
  ];
  for (const j of junkInputs) {
    let out: RunLiveness = 'dead';
    let threw = false;
    try {
      out = classifyRunLiveness(j as any);
    } catch {
      threw = true;
    }
    assert(!threw, 'classifyRunLiveness no throw on junk: ' + String(j));
    assertEq(out, 'live', 'classifyRunLiveness junk → live: ' + String(j));
  }

  // Invalid nowMs → live (cannot compute age).
  for (const bad of [NaN, Infinity, -Infinity, '123' as any, null as any, undefined as any, {} as any]) {
    assertEq(
      classifyRunLiveness({ status: 'running', startedAt: iso(NOW - ancient), updatedAt: iso(NOW - ancient), nowMs: bad }),
      'live',
      'invalid nowMs → live: ' + String(bad),
    );
  }

  // Garbage status / timestamps individually → live (no throw).
  assertEq(classifyRunLiveness({ status: null, startedAt: null, updatedAt: null, nowMs: NOW }), 'live', 'all-null fields → live');
  assertEq(classifyRunLiveness({ status: 123 as any, startedAt: {}, updatedAt: [], nowMs: NOW }), 'live', 'garbage-typed fields → live');
  assertEq(
    classifyRunLiveness({ status: 'running', startedAt: 'not-a-date', updatedAt: 'also-bad', nowMs: NOW }),
    'live',
    'unparseable timestamps → live (no signal)',
  );

  // planRunReap on non-array / hostile → empty plan, no throw.
  const badRuns: unknown[] = [null, undefined, 0, 1, NaN, 'string', true, {}, () => 0, Symbol('x')];
  for (const b of badRuns) {
    let plan2: RunReapPlan = { toReap: ['x'], stale: ['y'] };
    let threw = false;
    try {
      plan2 = planRunReap(b, NOW);
    } catch {
      threw = true;
    }
    assert(!threw, 'planRunReap no throw on non-array: ' + String(b));
    assertEq(plan2.toReap.length, 0, 'planRunReap non-array → empty toReap: ' + String(b));
    assertEq(plan2.stale.length, 0, 'planRunReap non-array → empty stale: ' + String(b));
  }

  // planRunReap with invalid nowMs → empty plan.
  const nowBadPlan = planRunReap([runRow('d', 'running', 10 * MIN)], NaN as any);
  assertEq(nowBadPlan.toReap.length, 0, 'planRunReap invalid nowMs → empty');

  // planRunReap over an array of pure garbage entries → empty (no valid rows).
  const garbagePlan = planRunReap([null, undefined, 1, 'x', true, [], () => 0], NOW);
  assertEq(garbagePlan.toReap.length, 0, 'garbage entries → no reap');
  assertEq(garbagePlan.stale.length, 0, 'garbage entries → no stale');

  // Oversized id rejected (bounded output guard).
  const bigId = 'z'.repeat(5000);
  const bigIdPlan = planRunReap([{ id: bigId, status: 'running', updated_at: iso(NOW - 10 * MIN) }], NOW);
  assertEq(bigIdPlan.toReap.length, 0, 'oversized id rejected');

  // Whitespace id trimmed then classified.
  const trimPlan = planRunReap([{ id: '  trim-me  ', status: 'running', updated_at: iso(NOW - 10 * MIN) }], NOW);
  assert(trimPlan.toReap.includes('trim-me'), 'whitespace id trimmed and reaped');

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll run-stall-policy smoke cases passed (' + passes + ' passed).');
}
main();
