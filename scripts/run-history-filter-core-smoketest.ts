/**
 * run-history-filter-core-smoketest — the pure search/filter/stats core
 * (src/lib/runHistoryFilterCore.ts) behind the Run History drawer upgrade.
 * Load-bearing assertions:
 *
 *   BUCKETS: every app RunStatus ('queued'|'planning'|'running'|
 *   'waiting_approval'|'paused'|'completed'|'failed'|'cancelled') maps to the
 *   right 4-way bucket; the failed bucket agrees with isWastedRunStatus
 *   (error/max-iteration/timeout join it); cancelled/unknown/non-string →
 *   'other'.
 *
 *   DEFAULT IDENTITY: with no query and 'all', `visible` is the SAME rows in
 *   the SAME order (referential equality) — the drawer's default render is
 *   unchanged.
 *
 *   SEARCH: case-insensitive substring over title/goal/mode/agent_id/model/
 *   provider/delegated_to/status; multi-token queries AND; whitespace-only
 *   query is a no-op.
 *
 *   STATS: computed over the FULL list even when the filter narrows; dollars
 *   come from the REAL rollupRunCosts (exact pinned totals incl. todayUsd via
 *   nowMs UTC day and wastedUsd via isWastedRunStatus); successPct is over
 *   terminal runs only.
 *
 *   FORMAT: formatRunHistoryStatsLine pins the exact header line
 *   '12 runs · 9✓ 3✗ (75%) · $4.21 today · $0.90 wasted'.
 *
 *   And: every export is total — degenerate/hostile/cyclic input never throws.
 *
 * Pure — loads under tsx (imports only runCostRollupCore).
 */

import {
  bucketRunStatus,
  filterAndStatRuns,
  formatRunHistoryStatsLine,
  EMPTY_RUN_HISTORY_STATS,
  type RunHistoryRunLike,
} from '../src/lib/runHistoryFilterCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(actual: unknown, expected: unknown, msg: string): void {
  assert(actual === expected, msg, `got ${JSON.stringify(actual)} want ${JSON.stringify(expected)}`);
}

function run(over: Partial<RunHistoryRunLike>): RunHistoryRunLike {
  return {
    id: 'r-' + Math.random().toString(36).slice(2),
    title: 'Fix the build',
    goal: 'make it green',
    mode: 'general',
    status: 'completed',
    agent_id: 'openswan:main_chat',
    model: 'claude-sonnet-4',
    provider: 'anthropic',
    surface: 'chat',
    estimated_cost: 0,
    created_at: '2026-07-31T10:00:00.000Z',
    ...over,
  };
}

function main(): void {
  // ── Group 1: status buckets ────────────────────────────────────────────────
  assertEq(bucketRunStatus('queued'), 'running', '(1) queued → running');
  assertEq(bucketRunStatus('planning'), 'running', '(1) planning → running');
  assertEq(bucketRunStatus('running'), 'running', '(1) running → running');
  assertEq(bucketRunStatus('waiting_approval'), 'running', '(1) waiting_approval → running');
  assertEq(bucketRunStatus('paused'), 'running', '(1) paused → running');
  assertEq(bucketRunStatus('completed'), 'succeeded', '(1) completed → succeeded');
  assertEq(bucketRunStatus('Completed'), 'succeeded', '(1) case-insensitive');
  assertEq(bucketRunStatus('failed'), 'failed', '(1) failed → failed');
  assertEq(bucketRunStatus('error'), 'failed', '(1) error → failed (waste family)');
  assertEq(bucketRunStatus('errored'), 'failed', '(1) errored → failed');
  assertEq(bucketRunStatus('max_iterations'), 'failed', '(1) max_iterations → failed');
  assertEq(bucketRunStatus('timeout'), 'failed', '(1) timeout → failed');
  assertEq(bucketRunStatus('cancelled'), 'other', '(1) cancelled → other (deliberate stop)');
  assertEq(bucketRunStatus('weird_status'), 'other', '(1) unknown → other');
  assertEq(bucketRunStatus(''), 'other', '(1) empty → other');
  assertEq(bucketRunStatus(null), 'other', '(1) null → other');
  assertEq(bucketRunStatus(42), 'other', '(1) number → other');

  // ── Group 2: default no-filter identity ────────────────────────────────────
  {
    const rows = [run({ id: 'a' }), run({ id: 'b', status: 'failed' }), run({ id: 'c', status: 'running' })];
    const { visible } = filterAndStatRuns(rows, {});
    assertEq(visible.length, 3, '(2) default keeps every row');
    assert(visible[0] === rows[0] && visible[1] === rows[1] && visible[2] === rows[2],
      '(2) default is the same rows in the same order (referential)');
    const noOpts = filterAndStatRuns(rows);
    assertEq(noOpts.visible.length, 3, '(2) omitted options object is also identity');
  }

  // ── Group 3: text search over the display fields ───────────────────────────
  {
    const rows = [
      run({ id: 'a', title: 'Deploy the edge function' }),
      run({ id: 'b', title: 'x', goal: 'Refactor edge routing' }),
      run({ id: 'c', title: 'x', goal: 'y', mode: 'computer_task' }),
      run({ id: 'd', title: 'x', agent_id: 'openswan:designer' }),
      run({ id: 'e', title: 'x', agent_id: 'z', model: 'gpt-4o-mini' }),
      run({ id: 'f', title: 'x', model: 'm', provider: 'openrouter' }),
      run({ id: 'g', title: 'x', provider: 'p', delegated_to: 'codex' }),
      run({ id: 'h', title: 'x', status: 'waiting_approval' }),
    ];
    const ids = (query: string) =>
      filterAndStatRuns(rows, { query }).visible.map((r) => r.id).join(',');
    assertEq(ids('deploy'), 'a', '(3) matches title (case-insensitive)');
    assertEq(ids('refactor'), 'b', '(3) matches goal');
    assertEq(ids('computer_task'), 'c', '(3) matches mode');
    assertEq(ids('designer'), 'd', '(3) matches agent_id');
    assertEq(ids('4o-mini'), 'e', '(3) matches model');
    assertEq(ids('openrouter'), 'f', '(3) matches provider');
    assertEq(ids('codex'), 'g', '(3) matches delegated_to');
    assertEq(ids('waiting_approval'), 'h', '(3) matches status');
    assertEq(ids('EDGE'), 'a,b', '(3) case-insensitive across rows');
    assertEq(ids('edge function'), 'a', '(3) multi-token AND');
    assertEq(ids('edge nomatchtoken'), '', '(3) AND with a missing token → empty');
    assertEq(ids('   '), 'a,b,c,d,e,f,g,h', '(3) whitespace-only query is a no-op');
  }

  // ── Group 4: status-bucket filtering ───────────────────────────────────────
  {
    const rows = [
      run({ id: 'a', status: 'running' }),
      run({ id: 'b', status: 'queued' }),
      run({ id: 'c', status: 'completed' }),
      run({ id: 'd', status: 'failed' }),
      run({ id: 'e', status: 'timeout' }),
      run({ id: 'f', status: 'cancelled' }),
    ];
    const ids = (statusFilter: string) =>
      filterAndStatRuns(rows, { statusFilter }).visible.map((r) => r.id).join(',');
    assertEq(ids('running'), 'a,b', '(4) running bucket');
    assertEq(ids('succeeded'), 'c', '(4) succeeded bucket');
    assertEq(ids('failed'), 'd,e', '(4) failed bucket includes timeout');
    assertEq(ids('other'), 'f', '(4) other bucket = cancelled');
    assertEq(ids('all'), 'a,b,c,d,e,f', '(4) all keeps everything');
    assertEq(ids('nonsense'), 'a,b,c,d,e,f', '(4) unknown filter degrades to all');
  }

  // ── Group 5: query + status combined ───────────────────────────────────────
  {
    const rows = [
      run({ id: 'a', title: 'edge deploy', status: 'failed' }),
      run({ id: 'b', title: 'edge deploy', status: 'completed' }),
      run({ id: 'c', title: 'other thing', status: 'failed' }),
    ];
    const result = filterAndStatRuns(rows, { query: 'edge', statusFilter: 'failed' });
    assertEq(result.visible.map((r) => r.id).join(','), 'a', '(5) query AND status compose');
    assertEq(result.stats.count, 3, '(5) stats still cover the FULL list');
  }

  // ── Group 6: stats through the REAL rollup (pinned dollars) ────────────────
  {
    const nowMs = Date.UTC(2026, 6, 31, 12, 0, 0); // 2026-07-31
    const rows = [
      run({ id: 'a', status: 'completed', estimated_cost: 1.23, created_at: '2026-07-31T01:00:00.000Z' }),
      run({ id: 'b', status: 'completed', estimated_cost: 2.98, created_at: '2026-07-31T09:30:00.000Z' }),
      run({ id: 'c', status: 'failed', estimated_cost: 0.9, created_at: '2026-07-31T11:00:00.000Z' }),
      run({ id: 'd', status: 'completed', estimated_cost: 5, created_at: '2026-07-30T23:59:00.000Z' }),
      run({ id: 'e', status: 'running', estimated_cost: 0, created_at: '2026-07-31T11:30:00.000Z' }),
      run({ id: 'f', status: 'cancelled', estimated_cost: 0.5, created_at: '2026-07-29T10:00:00.000Z' }),
    ];
    const { stats } = filterAndStatRuns(rows, { nowMs });
    assertEq(stats.count, 6, '(6) count = all rows');
    assertEq(stats.succeeded, 3, '(6) succeeded count');
    assertEq(stats.failed, 1, '(6) failed count');
    assertEq(stats.running, 1, '(6) running count');
    assertEq(stats.other, 1, '(6) other count (cancelled)');
    assertEq(stats.successPct, 75, '(6) successPct over terminal runs only (3/4)');
    assertEq(stats.totalUsd, 10.61, '(6) EXACT totalUsd via real rollup (1.23+2.98+0.90+5.00+0.50)');
    assertEq(stats.todayUsd, 5.11, '(6) EXACT todayUsd (2026-07-31: 1.23+2.98+0.90)');
    assertEq(stats.wastedUsd, 0.9, '(6) EXACT wastedUsd (the failed run only; cancelled excluded)');
  }
  {
    // No terminal runs → successPct 0, not NaN.
    const { stats } = filterAndStatRuns([run({ status: 'running' }), run({ status: 'cancelled' })]);
    assertEq(stats.successPct, 0, '(6) no terminal runs → successPct 0');
  }

  // ── Group 7: todayUsd windowing ────────────────────────────────────────────
  {
    const rows = [run({ status: 'completed', estimated_cost: 3, created_at: '2026-07-31T10:00:00.000Z' })];
    assertEq(filterAndStatRuns(rows, { nowMs: Date.UTC(2026, 6, 31) }).stats.todayUsd, 3,
      '(7) same UTC day counts');
    assertEq(filterAndStatRuns(rows, { nowMs: Date.UTC(2026, 7, 1) }).stats.todayUsd, 0,
      '(7) different day → 0');
    assertEq(filterAndStatRuns(rows).stats.todayUsd, 0, '(7) missing nowMs → 0');
    assertEq(filterAndStatRuns(rows, { nowMs: Number.NaN }).stats.todayUsd, 0, '(7) NaN nowMs → 0');
    assertEq(filterAndStatRuns(rows, { nowMs: 1e18 }).stats.todayUsd, 0, '(7) out-of-range nowMs → 0');
    const malformed = [run({ status: 'completed', estimated_cost: 3, created_at: 'not a date' })];
    assertEq(filterAndStatRuns(malformed, { nowMs: Date.UTC(2026, 6, 31) }).stats.todayUsd, 0,
      '(7) malformed created_at never lands in the today bucket');
    assertEq(filterAndStatRuns(malformed, { nowMs: Date.UTC(2026, 6, 31) }).stats.totalUsd, 3,
      '(7) …but its cost still counts in total');
  }

  // ── Group 8: exact header-line format ──────────────────────────────────────
  assertEq(
    formatRunHistoryStatsLine({ count: 12, succeeded: 9, failed: 3, running: 0, other: 0, successPct: 75, totalUsd: 10, todayUsd: 4.21, wastedUsd: 0.9 }),
    '12 runs · 9✓ 3✗ (75%) · $4.21 today · $0.90 wasted',
    '(8) EXACT spec example line',
  );
  assertEq(
    formatRunHistoryStatsLine({ count: 1, succeeded: 1, failed: 0, successPct: 100, todayUsd: 0, wastedUsd: 0 }),
    '1 run · 1✓ 0✗ (100%) · $0.00 today',
    '(8) singular "run" + wasted segment omitted at $0',
  );
  assertEq(
    formatRunHistoryStatsLine({ count: 2, succeeded: 0, failed: 0, running: 2, successPct: 0, todayUsd: 0, wastedUsd: 0 }),
    '2 runs · $0.00 today',
    '(8) no terminal runs → ✓✗ segment omitted',
  );
  assertEq(formatRunHistoryStatsLine(EMPTY_RUN_HISTORY_STATS), '0 runs · $0.00 today', '(8) empty stats line');
  assertEq(typeof formatRunHistoryStatsLine(null), 'string', '(8) total on null');
  assertEq(typeof formatRunHistoryStatsLine({ count: Infinity, todayUsd: 'x' }), 'string', '(8) total on hostile stats');

  // ── Group 9: totality on hostile input ─────────────────────────────────────
  {
    for (const bad of [null, undefined, 42, 'runs', {}, true]) {
      const result = filterAndStatRuns(bad as never);
      assertEq(result.visible.length, 0, `(9) non-array ${String(bad)} → empty visible`);
      assertEq(result.stats.count, 0, `(9) non-array ${String(bad)} → zero stats`);
    }
    const cyclic: Record<string, unknown> = { title: 'cyclic', status: 'completed' };
    cyclic.self = cyclic;
    const hostileRows = [null, 5, 'x', [], cyclic, run({ id: 'ok' })];
    let threw = false;
    let result: ReturnType<typeof filterAndStatRuns> | null = null;
    try {
      result = filterAndStatRuns(hostileRows, { query: 123 as never, statusFilter: {} as never, nowMs: 'soon' as never });
    } catch {
      threw = true;
    }
    assert(!threw, '(9) hostile rows + hostile options never throw');
    assertEq(result?.visible.length, 2, '(9) only object rows survive (cyclic + ok); primitives/arrays skipped');
    assertEq(result?.stats.count, 2, '(9) stats count matches surviving object rows');
    assertEq(result?.stats.succeeded, 2, '(9) cyclic object with valid status still buckets');
  }

  console.log(`run-history-filter-core smoketest: ${passes} passed, ${failures} failed`);
  if (failures > 0) process.exit(1);
}

main();
