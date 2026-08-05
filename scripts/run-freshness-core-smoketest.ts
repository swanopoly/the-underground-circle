/**
 * run-freshness-core-smoketest — guards the PURE shared run-freshness core
 * (src/lib/runFreshnessCore.ts), the one place Chat/Office/Feed agree on
 * "is this run alive right now?" and "what do we show when there are no runs?"
 *
 * Covers (numbered groups):
 *   1  exports + shared thresholds are ordered
 *   2  classify: 'live' band (fresh active statuses + boundary)
 *   3  classify: 'recent' band
 *   4  classify: 'idle' band (running + 10min -> idle)
 *   5  classify: 'stale' band (running + 2h -> stale)
 *   6  classify: terminal statuses -> 'done' (+ labels, spelling variant)
 *   7  classify: active status but NO usable timestamp -> 'recent'/Active
 *   8  classify: unknown / missing status -> 'unknown'
 *   9  classify: ageMs math, future-skew clamp, partial timestamps
 *   10 classify: hostile inputs never throw
 *   11 runEmptyStateModel: data-first precedence
 *   12 runEmptyStateModel: empty vs loading vs error (the three states)
 *   13 runEmptyStateModel: hasRuns count-awareness (EMPTY array is not data)
 *   14 runEmptyStateModel: error text extraction / bounded / secret-safe
 *   15 runEmptyStateModel: hostile inputs never throw
 *   16 freshnessRank: order + hostile keys
 *   17 determinism (identical serialization for identical input)
 *
 * Imports the REAL module (pure, zero runtime imports).
 * Run: npx tsx scripts/run-freshness-core-smoketest.ts
 */

import {
  classifyRunFreshness,
  runEmptyStateModel,
  freshnessRank,
  LIVE_WINDOW_MS,
  RECENT_WINDOW_MS,
  IDLE_WINDOW_MS,
  type RunFreshness,
  type RunFreshnessResult,
} from '../src/lib/runFreshnessCore';

let passes = 0;
let failures = 0;
function assert(message: string, condition: unknown, detail?: string): void {
  if (condition) {
    passes += 1;
    console.log('pass:', message);
  } else {
    failures += 1;
    console.error('FAIL:', `${message}${detail ? ` -- ${detail}` : ''}`);
  }
}
function assertEq<T>(actual: T, expected: T, message: string): void {
  assert(message, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
/** Assert a call does not throw; returns its result (or undefined on throw). */
function noThrow<T>(message: string, fn: () => T): T | undefined {
  try {
    const r = fn();
    assert(message, true);
    return r;
  } catch (e) {
    assert(message, false, `threw: ${(e as Error)?.message}`);
    return undefined;
  }
}

const SEC = 1_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const NOW = 1_700_000_000_000; // fixed epoch anchor (no clock reads anywhere)

// helper: classify a status at a given age-since-update
function atAge(status: string, ageMs: number): RunFreshnessResult {
  return classifyRunFreshness({ status, updatedAtMs: NOW - ageMs, nowMs: NOW });
}

// == 1. exports + shared thresholds are ordered ================================
assertEq(typeof classifyRunFreshness, 'function', '(1) classifyRunFreshness is a function');
assertEq(typeof runEmptyStateModel, 'function', '(1) runEmptyStateModel is a function');
assertEq(typeof freshnessRank, 'function', '(1) freshnessRank is a function');
assertEq(LIVE_WINDOW_MS, 90 * SEC, '(1) LIVE window is 90s');
assertEq(RECENT_WINDOW_MS, 5 * MIN, '(1) RECENT window is 5m');
assertEq(IDLE_WINDOW_MS, 30 * MIN, '(1) IDLE window is 30m');
assert('(1) windows strictly increase live<recent<idle', LIVE_WINDOW_MS < RECENT_WINDOW_MS && RECENT_WINDOW_MS < IDLE_WINDOW_MS);

// == 2. classify: 'live' band =================================================
{
  const r = atAge('running', 20 * SEC);
  assertEq(r.freshness, 'live', '(2) running updated 20s ago -> live');
  assertEq(r.label, 'Live', '(2) live label is "Live"');
  assertEq(r.ageMs, 20 * SEC, '(2) ageMs reflects 20s');
}
assertEq(atAge('running', 0).freshness, 'live', '(2) running updated now -> live');
assertEq(atAge('planning', 5 * SEC).freshness, 'live', '(2) planning fresh -> live');
assertEq(atAge('queued', 1 * SEC).freshness, 'live', '(2) queued fresh -> live');
assertEq(atAge('waiting_approval', 10 * SEC).freshness, 'live', '(2) waiting_approval fresh -> live');
assertEq(atAge('paused', 30 * SEC).freshness, 'live', '(2) paused fresh -> live');
assertEq(atAge('running', LIVE_WINDOW_MS).freshness, 'live', '(2) age == LIVE window -> live (inclusive)');
assertEq(atAge('running', LIVE_WINDOW_MS + 1).freshness, 'recent', '(2) one ms past LIVE window -> recent');
assertEq(atAge('  RUNNING ', 5 * SEC).freshness, 'live', '(2) messy-cased status still classifies');

// == 3. classify: 'recent' band ===============================================
{
  const r = atAge('running', 3 * MIN);
  assertEq(r.freshness, 'recent', '(3) running updated 3min ago -> recent');
  assertEq(r.label, 'Active', '(3) recent label is "Active"');
}
assertEq(atAge('running', 2 * MIN).freshness, 'recent', '(3) 2min -> recent');
assertEq(atAge('running', RECENT_WINDOW_MS).freshness, 'recent', '(3) age == RECENT window -> recent (inclusive)');
assertEq(atAge('running', RECENT_WINDOW_MS + 1).freshness, 'idle', '(3) one ms past RECENT window -> idle');

// == 4. classify: 'idle' band (running + 10min -> idle) =======================
{
  const r = atAge('running', 10 * MIN);
  assertEq(r.freshness, 'idle', '(4) running updated 10min ago -> idle');
  assert('(4) idle label starts with "Idle"', r.label.startsWith('Idle'));
  assert('(4) idle label carries coarse age "10m"', r.label.includes('10m'));
  assertEq(r.ageMs, 10 * MIN, '(4) idle ageMs is 10min');
}
assertEq(atAge('running', 6 * MIN).freshness, 'idle', '(4) 6min -> idle');
assertEq(atAge('running', IDLE_WINDOW_MS).freshness, 'idle', '(4) age == IDLE window -> idle (inclusive)');
assertEq(atAge('waiting_approval', 15 * MIN).freshness, 'idle', '(4) waiting_approval 15min -> idle');

// == 5. classify: 'stale' band (running + 2h -> stale) ========================
{
  const r = atAge('running', 2 * HOUR);
  assertEq(r.freshness, 'stale', '(5) running updated 2h ago -> stale');
  assert('(5) stale label starts with "Stale"', r.label.startsWith('Stale'));
  assert('(5) stale label carries coarse age "2h"', r.label.includes('2h'));
}
assertEq(atAge('running', IDLE_WINDOW_MS + 1).freshness, 'stale', '(5) one ms past IDLE window -> stale');
assertEq(atAge('running', 40 * MIN).freshness, 'stale', '(5) 40min -> stale');
assertEq(atAge('queued', 5 * HOUR).freshness, 'stale', '(5) queued 5h -> stale (wedged in queue)');
assert('(5) very old stale caps age phrasing at 999d', atAge('running', 5000 * 24 * HOUR).label.includes('999d'));

// == 6. classify: terminal statuses -> 'done' =================================
{
  const r = classifyRunFreshness({ status: 'completed', updatedAtMs: NOW - 3 * HOUR, nowMs: NOW });
  assertEq(r.freshness, 'done', '(6) completed -> done regardless of age');
  assertEq(r.label, 'Done', '(6) completed label is "Done"');
  assertEq(r.ageMs, 3 * HOUR, '(6) done still reports ageMs when timestamps present');
}
{
  const r = classifyRunFreshness({ status: 'failed', updatedAtMs: NOW - 5 * SEC, nowMs: NOW });
  assertEq(r.freshness, 'done', '(6) failed -> done');
  assertEq(r.label, 'Failed', '(6) failed label is "Failed"');
}
{
  const r = classifyRunFreshness({ status: 'cancelled', updatedAtMs: NOW, nowMs: NOW });
  assertEq(r.freshness, 'done', '(6) cancelled -> done');
  assertEq(r.label, 'Cancelled', '(6) cancelled label is "Cancelled"');
}
assertEq(classifyRunFreshness({ status: 'canceled' }).freshness, 'done', '(6) US spelling "canceled" -> done');
assertEq(classifyRunFreshness({ status: 'completed' }).ageMs, null, '(6) done with no timestamps -> ageMs null');
assertEq(classifyRunFreshness({ status: 'completed', updatedAtMs: NOW, nowMs: NOW }).freshness, 'done', '(6) just-completed is done, not live');

// == 7. classify: active status but NO usable timestamp -> recent/Active ======
{
  const r = classifyRunFreshness({ status: 'running' });
  assertEq(r.freshness, 'recent', '(7) active + no timestamps -> recent (safe neutral)');
  assertEq(r.label, 'Active', '(7) active + no timestamps -> "Active"');
  assertEq(r.ageMs, null, '(7) active + no timestamps -> ageMs null');
}
assertEq(classifyRunFreshness({ status: 'running', nowMs: NOW }).freshness, 'recent', '(7) active + only nowMs -> recent');
assertEq(classifyRunFreshness({ status: 'running', updatedAtMs: NOW }).freshness, 'recent', '(7) active + only updatedAt -> recent');

// == 8. classify: unknown / missing status -> 'unknown' =======================
assertEq(classifyRunFreshness({ status: 'weird' }).freshness, 'unknown', '(8) unrecognized status -> unknown');
assertEq(classifyRunFreshness({ status: 'weird' }).label, 'Unknown', '(8) unknown label is "Unknown"');
assertEq(classifyRunFreshness({}).freshness, 'unknown', '(8) empty input -> unknown');
assertEq(classifyRunFreshness({ status: '' }).freshness, 'unknown', '(8) empty-string status -> unknown');
assertEq(classifyRunFreshness({ status: 42 }).freshness, 'unknown', '(8) numeric status -> unknown');
assertEq(classifyRunFreshness({ status: null }).freshness, 'unknown', '(8) null status -> unknown');
assertEq(classifyRunFreshness({ status: 'weird', updatedAtMs: NOW - 5 * MIN, nowMs: NOW }).ageMs, 5 * MIN, '(8) unknown status still computes ageMs');
assertEq(classifyRunFreshness({ status: 'blocked' }).freshness, 'unknown', '(8) non-run status "blocked" -> unknown');

// == 9. classify: ageMs math, future-skew clamp, partial timestamps ===========
assertEq(classifyRunFreshness({ status: 'running', updatedAtMs: NOW - 12345, nowMs: NOW }).ageMs, 12345, '(9) ageMs = now - updated');
{
  const r = classifyRunFreshness({ status: 'running', updatedAtMs: NOW + 10 * MIN, nowMs: NOW });
  assertEq(r.ageMs, 0, '(9) future updatedAt clamps ageMs to 0');
  assertEq(r.freshness, 'live', '(9) future-skew run reads as live, not stale');
}
assertEq(classifyRunFreshness({ status: 'running', updatedAtMs: NaN, nowMs: NOW }).ageMs, null, '(9) NaN updatedAt -> ageMs null');
assertEq(classifyRunFreshness({ status: 'running', updatedAtMs: Infinity, nowMs: NOW }).ageMs, null, '(9) Infinity updatedAt -> ageMs null');
assertEq(classifyRunFreshness({ status: 'running', updatedAtMs: '123', nowMs: NOW }).ageMs, null, '(9) string updatedAt not coerced -> ageMs null');
assertEq(classifyRunFreshness({ status: 'running', updatedAtMs: NOW - MIN, nowMs: NaN }).ageMs, null, '(9) NaN nowMs -> ageMs null');

// == 10. classify: hostile inputs never throw =================================
{
  const cyclic: Record<string, unknown> = { status: 'running', updatedAtMs: NOW - 3 * MIN, nowMs: NOW };
  cyclic.self = cyclic;
  const r = noThrow('(10) cyclic input does not throw', () => classifyRunFreshness(cyclic as any));
  assertEq(r?.freshness, 'recent', '(10) cyclic input still classifies by its real fields (3min -> recent)');
}
// @ts-expect-error - intentional: undefined arg must not throw
assertEq(noThrow('(10) undefined arg no throw', () => classifyRunFreshness(undefined))?.freshness, 'unknown', '(10) undefined -> unknown');
// @ts-expect-error - intentional: null arg must not throw
assertEq(noThrow('(10) null arg no throw', () => classifyRunFreshness(null))?.freshness, 'unknown', '(10) null -> unknown');
// @ts-expect-error - intentional: string arg must not throw
noThrow('(10) string arg no throw', () => classifyRunFreshness('nope'));
// @ts-expect-error - intentional: array arg must not throw
noThrow('(10) array arg no throw', () => classifyRunFreshness([1, 2, 3]));
// @ts-expect-error - intentional: number arg must not throw
noThrow('(10) number arg no throw', () => classifyRunFreshness(7));
noThrow('(10) status via throwing getter no throw', () =>
  classifyRunFreshness({ get status() { throw new Error('boom'); } } as any),
);
noThrow('(10) huge numbers no throw', () =>
  classifyRunFreshness({ status: 'running', updatedAtMs: -1e308, nowMs: 1e308 }),
);
{
  const r = classifyRunFreshness({ status: 'running', updatedAtMs: NOW - MIN, nowMs: NOW });
  assert('(10) result has freshness|label|ageMs keys', 'freshness' in r && 'label' in r && 'ageMs' in r);
  assert('(10) label is always a non-empty string', typeof r.label === 'string' && r.label.length > 0);
}

// == 11. runEmptyStateModel: data-first precedence ============================
assertEq(runEmptyStateModel({ hasRuns: true }).kind, 'has_data', '(11) hasRuns true -> has_data');
assertEq(runEmptyStateModel({ hasRuns: true }).message, '', '(11) has_data message is empty (caller renders list)');
assertEq(runEmptyStateModel({ hasRuns: true, loading: true }).kind, 'has_data', '(11) has_data beats loading (no spinner flicker)');
assertEq(runEmptyStateModel({ hasRuns: true, error: 'boom' }).kind, 'has_data', '(11) has_data beats a background error');
assertEq(runEmptyStateModel({ hasRuns: true, loading: true, error: 'boom' }).kind, 'has_data', '(11) has_data beats both');
assertEq(runEmptyStateModel({ hasRuns: false, loading: true, error: 'boom' }).kind, 'error', '(11) no data: error beats loading');

// == 12. runEmptyStateModel: empty vs loading vs error ========================
{
  const s = runEmptyStateModel({ hasRuns: false, loading: true });
  assertEq(s.kind, 'loading', '(12) loading with no data -> loading (NOT empty)');
  assert('(12) loading has copy', s.message.length > 0);
}
{
  const s = runEmptyStateModel({ hasRuns: false, loading: false });
  assertEq(s.kind, 'empty', '(12) settled + no runs + no error -> empty (Finding-2 fix, not null)');
  assert('(12) empty renders a real affordance', /no active runs/i.test(s.message));
}
{
  const s = runEmptyStateModel({ hasRuns: false, loading: false, error: 'network down' });
  assertEq(s.kind, 'error', '(12) error state');
  assert('(12) error copy includes reason', s.message.includes('network down'));
}
assertEq(runEmptyStateModel({}).kind, 'empty', '(12) empty input -> empty (never null)');

// == 13. runEmptyStateModel: hasRuns count-awareness ==========================
assertEq(runEmptyStateModel({ hasRuns: [] }).kind, 'empty', '(13) EMPTY array is NOT data (JS-truthy trap) -> empty');
assertEq(runEmptyStateModel({ hasRuns: [{ id: 'r1' }] }).kind, 'has_data', '(13) non-empty array -> has_data');
assertEq(runEmptyStateModel({ hasRuns: 0 }).kind, 'empty', '(13) count 0 -> empty');
assertEq(runEmptyStateModel({ hasRuns: 3 }).kind, 'has_data', '(13) count 3 -> has_data');
assertEq(runEmptyStateModel({ hasRuns: false }).kind, 'empty', '(13) boolean false -> empty');
assertEq(runEmptyStateModel({ hasRuns: '' }).kind, 'empty', '(13) blank string -> empty');
assertEq(runEmptyStateModel({ hasRuns: {} }).kind, 'empty', '(13) opaque object -> empty (cannot confirm data)');
assertEq(runEmptyStateModel({ hasRuns: [], loading: true }).kind, 'loading', '(13) empty array + loading -> loading');

// == 14. runEmptyStateModel: error text extraction / bounded / secret-safe ====
assertEq(runEmptyStateModel({ hasRuns: false, error: new Error('kaboom') }).message, "Couldn't load runs: kaboom", '(14) Error.message is surfaced');
assertEq(runEmptyStateModel({ hasRuns: false, error: true }).message, "Couldn't load runs.", '(14) boolean-true error -> generic copy (no reason)');
assertEq(runEmptyStateModel({ hasRuns: false, error: {} }).message, "Couldn't load runs.", '(14) messageless object error -> generic copy');
{
  const huge = 'x'.repeat(5000);
  const s = runEmptyStateModel({ hasRuns: false, error: huge });
  assert('(14) error copy is bounded (<200 chars)', s.message.length < 200);
  assert('(14) long error copy is ellipsized', s.message.indexOf('…') >= 0);
}
{
  // input carries a real newline, tab, NUL and ESC at runtime -> all stripped/collapsed
  const s = runEmptyStateModel({ hasRuns: false, error: 'line1\nline2\ttab\x00nul\x1besc' });
  assert('(14) no raw newline in copy', s.message.indexOf('\n') < 0);
  assert('(14) no raw tab in copy', s.message.indexOf('\t') < 0);
  assert('(14) no NUL in copy', s.message.indexOf('\x00') < 0);
  assert('(14) no ESC in copy', s.message.indexOf('\x1b') < 0);
  assertEq(s.message, "Couldn't load runs: line1 line2 tab nul esc", '(14) ctrl chars stripped + collapsed to one line');
}
assertEq(runEmptyStateModel({ hasRuns: false, error: 'false' }).kind, 'empty', '(14) literal "false" error string is not an error');
assertEq(runEmptyStateModel({ hasRuns: false, error: 0 }).kind, 'empty', '(14) numeric 0 error -> not an error');
assertEq(runEmptyStateModel({ hasRuns: false, error: null }).kind, 'empty', '(14) null error -> not an error');

// == 15. runEmptyStateModel: hostile inputs never throw =======================
// @ts-expect-error - intentional: undefined arg must not throw
assertEq(noThrow('(15) undefined arg no throw', () => runEmptyStateModel(undefined))?.kind, 'empty', '(15) undefined -> empty');
// @ts-expect-error - intentional: null arg must not throw
assertEq(noThrow('(15) null arg no throw', () => runEmptyStateModel(null))?.kind, 'empty', '(15) null -> empty');
// @ts-expect-error - intentional: string arg must not throw
noThrow('(15) string arg no throw', () => runEmptyStateModel('nope'));
noThrow('(15) throwing error getter no throw', () =>
  runEmptyStateModel({ hasRuns: false, get error() { throw new Error('boom'); } } as any),
);
noThrow('(15) throwing message getter no throw', () =>
  runEmptyStateModel({ hasRuns: false, error: { get message() { throw new Error('boom'); } } } as any),
);
{
  const cyclic: Record<string, unknown> = { hasRuns: false, loading: true };
  cyclic.self = cyclic;
  assertEq(noThrow('(15) cyclic input no throw', () => runEmptyStateModel(cyclic as any))?.kind, 'loading', '(15) cyclic still classifies');
}

// == 16. freshnessRank: order + hostile keys ==================================
{
  const order: RunFreshness[] = ['live', 'recent', 'idle', 'stale', 'done', 'unknown'];
  for (let i = 1; i < order.length; i += 1) {
    assert(`(16) rank(${order[i - 1]}) < rank(${order[i]})`, freshnessRank(order[i - 1]) < freshnessRank(order[i]));
  }
}
assertEq(freshnessRank('live'), 0, '(16) live ranks 0 (most alive)');
assertEq(freshnessRank('unknown'), 5, '(16) unknown ranks last');
assertEq(freshnessRank('nonsense'), 5, '(16) unrecognized value ranks last');
assertEq(freshnessRank('toString'), 5, '(16) prototype key "toString" -> 5 (own-property guard)');
assertEq(freshnessRank('hasOwnProperty'), 5, '(16) prototype key "hasOwnProperty" -> 5');
assertEq(freshnessRank('constructor'), 5, '(16) prototype key "constructor" -> 5');
// @ts-expect-error - intentional: non-string must not throw
assertEq(freshnessRank(undefined), 5, '(16) undefined -> 5');
// @ts-expect-error - intentional
assertEq(freshnessRank(null), 5, '(16) null -> 5');
// @ts-expect-error - intentional
assertEq(freshnessRank(3), 5, '(16) number -> 5');
// @ts-expect-error - intentional
assertEq(freshnessRank({}), 5, '(16) object -> 5');
assert('(16) every rank is a finite number', ['live', 'recent', 'idle', 'stale', 'done', 'unknown', 'x'].every((k) => Number.isFinite(freshnessRank(k))));
assert('(16) classify output is always rankable', Number.isFinite(freshnessRank(atAge('running', MIN).freshness)));

// == 17. determinism ==========================================================
{
  const a = JSON.stringify(classifyRunFreshness({ status: 'running', updatedAtMs: NOW - 7 * MIN, nowMs: NOW }));
  const b = JSON.stringify(classifyRunFreshness({ status: 'running', updatedAtMs: NOW - 7 * MIN, nowMs: NOW }));
  assertEq(a, b, '(17) classifyRunFreshness is deterministic');
}
{
  const a = JSON.stringify(runEmptyStateModel({ hasRuns: false, loading: false, error: 'x' }));
  const b = JSON.stringify(runEmptyStateModel({ hasRuns: false, loading: false, error: 'x' }));
  assertEq(a, b, '(17) runEmptyStateModel is deterministic');
}

// == summary ==================================================================
console.log(`\nrun-freshness-core smoke: ${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
console.log('run-freshness-core smoke: ALL PASSED');
