/**
 * office-ops-board-smoketest — exercises the pure ops-board model in
 * src/lib/officeOpsBoard.ts. No stubs needed: the module has zero runtime
 * imports (import type only), so tsx loads it directly.
 *
 * Covers:
 *   1. Building board nesting, orphans, ordering, bounds + overflow counts
 *   2. building vs recentlyFinished cutoffs (10-min window, ≤5)
 *   3. durationMs computed from caller nowMs (no Date.now in pure fns)
 *   4. Token tracker with full / partial / empty inputs + cache-hit math
 *   5. formatTokenCount k/M formatting + formatRelativeTime labels
 *   6. Per-agent live ops bounds, dedupe, relative time, subagent counts
 *   7. Determinism: identical output for identical inputs + nowMs
 *   8. O8 synthetic pinned-agent live status: evidence → upgrade, no evidence
 *      → untouched, finished/stale runs → no upgrade, bounds, determinism
 *
 * Usage:
 *   npm run smoke:office-ops-board
 */

import {
  buildOfficeBuildingBoard,
  buildOfficeTokenTracker,
  buildAgentLiveOps,
  buildOfficeAgentAccountabilityIndex,
  applySyntheticAgentStatusUpgrade,
  deriveSyntheticAgentStatusFromRuns,
  formatAccountabilityCounts,
  formatTokenCount,
  formatRelativeTime,
  HUGGINGSWAN_RUN_NAME_KEYS,
  OPENSWAN_RUN_NAME_KEYS,
  OFFICE_ACCOUNTABILITY_WINDOW_MS,
  OFFICE_BOARD_MAX_ROOTS,
  OFFICE_BOARD_MAX_CHILDREN_PER_ROOT,
  OFFICE_BOARD_MAX_RECENTLY_FINISHED,
  SYNTHETIC_STATUS_RUN_MAX_AGE_MS,
  type AgentRunLike,
} from '../src/lib/officeOpsBoard';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const NOW = Date.parse('2026-06-10T12:00:00.000Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

function run(partial: Partial<AgentRunLike> & { id: string }): AgentRunLike {
  return {
    status: 'running',
    title: `Run ${partial.id}`,
    created_at: iso(-5 * 60_000),
    ...partial,
  };
}

// ─── 1. Board nesting / orphans / ordering ──────────────────────────────────

console.log('\n[1] building board — nesting, orphans, ordering');
{
  const runs: AgentRunLike[] = [
    run({ id: 'root-1', status: 'running', started_at: iso(-90_000), title: 'Build the dashboard' }),
    run({
      id: 'child-1a',
      status: 'running',
      parent_run_id: 'root-1',
      delegated_to: 'coder',
      started_at: iso(-60_000),
      metadata: {
        delegationDepth: 1,
        runtimeToolActions: [{ tool: 'fs.read', title: 'fs > read', status: 'completed' }],
        agentSubjectKey: 'office::coder',
        agentDisplayName: 'Coder Agent',
        agentDbId: 'agent-db-coder',
        agentSessionKey: 'session::coder',
        legacyAgentIds: ['coder', 'office::coder', 'legacy::coder'],
      },
    }),
    run({ id: 'child-1b', status: 'queued', parent_run_id: 'root-1', delegated_to: 'reviewer', started_at: iso(-30_000) }),
    run({ id: 'orphan-1', status: 'running', parent_run_id: 'missing-parent', delegated_to: 'tester', started_at: iso(-20_000) }),
    run({ id: 'root-2', status: 'queued', started_at: iso(-10_000), title: 'Queued job' }),
    run({ id: 'old-done', status: 'completed', started_at: iso(-20 * 60_000), completed_at: iso(-15 * 60_000) }),
  ];
  const board = buildOfficeBuildingBoard(runs, { nowMs: NOW });

  check('root count', board.building.length === 3, `got ${board.building.length}`);
  const root1 = board.building.find((n) => n.runId === 'root-1');
  check('root-1 present with 2 children', root1?.children.length === 2);
  check('root-1 not a subagent', root1?.isSubagent === false);
  check('child running before child queued', root1?.children[0]?.runId === 'child-1a');
  check('child depth from metadata', root1?.children[0]?.depth === 1);
  check('child agentName from delegated_to', root1?.children[0]?.agentName === 'Coder');
  check('child stepHint from runtimeToolActions', root1?.children[0]?.stepHint === 'fs > read');
  check('child subjectKey from metadata', root1?.children[0]?.subjectKey === 'office::coder');
  check('child subject display from metadata', root1?.children[0]?.subjectDisplayName === 'Coder Agent');
  check('child subject db id from metadata', root1?.children[0]?.subjectDbId === 'agent-db-coder');
  check(
    'child subject aliases dedupe subject key',
    JSON.stringify(root1?.children[0]?.subjectAliases) === JSON.stringify(['agent-db-coder', 'session::coder', 'coder', 'legacy::coder']),
    JSON.stringify(root1?.children[0]?.subjectAliases),
  );
  const orphan = board.building.find((n) => n.runId === 'orphan-1');
  check('orphan renders as root', !!orphan);
  check('orphan flagged subagent', orphan?.isSubagent === true);
  check('orphan keeps parentRunId', orphan?.parentRunId === 'missing-parent');
  check('orphan depth ≥ 1', (orphan?.depth ?? 0) >= 1);
  // active (running) first, then queued — and among running, newest start first
  check('ordering: running roots before queued root', board.building[2]?.runId === 'root-2');
  check('ordering: newest running root first', board.building[0]?.runId === 'orphan-1');
  check(
    'counts',
    board.counts.activeRoots === 2 &&
      board.counts.activeSubagents === 3 &&
      board.counts.waitingApproval === 0 &&
      board.counts.queued === 2,
    JSON.stringify(board.counts),
  );
  check('old finished run excluded everywhere', board.recentlyFinished.length === 0);
  check('overflowRoots zero', board.overflowRoots === 0);
}

// ─── 2. Bounds + overflow counts ────────────────────────────────────────────

console.log('\n[2] bounds + overflow');
{
  const runs: AgentRunLike[] = [];
  for (let i = 0; i < 12; i += 1) {
    runs.push(run({ id: `root-${i}`, status: 'running', started_at: iso(-i * 1000) }));
  }
  for (let i = 0; i < 9; i += 1) {
    runs.push(run({ id: `kid-${i}`, status: 'running', parent_run_id: 'root-0', delegated_to: 'coder', started_at: iso(-i * 500) }));
  }
  const board = buildOfficeBuildingBoard(runs, { nowMs: NOW });
  check(`roots bounded to ${OFFICE_BOARD_MAX_ROOTS}`, board.building.length === OFFICE_BOARD_MAX_ROOTS);
  check('overflowRoots = 4', board.overflowRoots === 4, `got ${board.overflowRoots}`);
  const root0 = board.building.find((n) => n.runId === 'root-0');
  check(`children bounded to ${OFFICE_BOARD_MAX_CHILDREN_PER_ROOT}`, root0?.children.length === OFFICE_BOARD_MAX_CHILDREN_PER_ROOT);
  check('childOverflow = 3', root0?.childOverflow === 3, `got ${root0?.childOverflow}`);

  const smaller = buildOfficeBuildingBoard(runs, { nowMs: NOW, maxRoots: 3, maxChildrenPerRoot: 2 });
  check('custom maxRoots respected', smaller.building.length === 3 && smaller.overflowRoots === 9);
  const smallRoot0 = smaller.building.find((n) => n.runId === 'root-0');
  check('custom maxChildren respected', smallRoot0?.children.length === 2 && smallRoot0?.childOverflow === 7);

  const oversized = buildOfficeBuildingBoard(runs, { nowMs: NOW, maxRoots: 99, maxChildrenPerRoot: 99 });
  check('oversized opts clamped to hard caps', oversized.building.length === OFFICE_BOARD_MAX_ROOTS);
}

// ─── 3. building vs recentlyFinished cutoffs + duration ─────────────────────

console.log('\n[3] recentlyFinished cutoffs + durations');
{
  const runs: AgentRunLike[] = [
    run({ id: 'live-1', status: 'running', started_at: iso(-90_000) }),
    run({ id: 'done-recent', status: 'completed', started_at: iso(-8 * 60_000), completed_at: iso(-5 * 60_000) }),
    run({ id: 'fail-recent', status: 'failed', started_at: iso(-4 * 60_000), completed_at: iso(-2 * 60_000) }),
    run({ id: 'done-old', status: 'completed', started_at: iso(-30 * 60_000), completed_at: iso(-11 * 60_000) }),
    run({ id: 'cancelled-1', status: 'cancelled', completed_at: iso(-1 * 60_000) }),
  ];
  for (let i = 0; i < 7; i += 1) {
    runs.push(run({ id: `done-${i}`, status: 'completed', started_at: iso(-9 * 60_000), completed_at: iso(-(i + 1) * 30_000) }));
  }
  const board = buildOfficeBuildingBoard(runs, { nowMs: NOW });

  check('running run on building board only', board.building.length === 1 && board.building[0].runId === 'live-1');
  check('running durationMs from nowMs', board.building[0].durationMs === 90_000, `got ${board.building[0].durationMs}`);
  check(
    `recentlyFinished bounded to ${OFFICE_BOARD_MAX_RECENTLY_FINISHED}`,
    board.recentlyFinished.length === OFFICE_BOARD_MAX_RECENTLY_FINISHED,
    `got ${board.recentlyFinished.length}`,
  );
  check('newest finished first', board.recentlyFinished[0]?.runId === 'done-0');
  const ids = board.recentlyFinished.map((n) => n.runId);
  check('11-min-old completion excluded', !ids.includes('done-old'));
  check('cancelled excluded', !ids.includes('cancelled-1'));
  const finishedDurations = buildOfficeBuildingBoard(
    [run({ id: 'done-recent', status: 'completed', started_at: iso(-8 * 60_000), completed_at: iso(-5 * 60_000) })],
    { nowMs: NOW },
  );
  check(
    'finished durationMs = completed - started',
    finishedDurations.recentlyFinished[0]?.durationMs === 3 * 60_000,
    `got ${finishedDurations.recentlyFinished[0]?.durationMs}`,
  );
}

// ─── 4. Token tracker — full / partial / empty ──────────────────────────────

console.log('\n[4] token tracker');
{
  const full = buildOfficeTokenTracker({
    summary: {
      total_cost: 12.3456,
      total_input: 250_000,
      total_output: 80_000,
      total_cache_creation: 40_000,
      total_cache_read: 750_000,
      request_count: 321,
      cache_hit_rate: 0.42, // tokens-derived math should win over this
    },
    byModel: [
      { model: 'claude-haiku-4-5', total_cost: 2, input_tokens: 1, output_tokens: 1 },
      { model: 'claude-sonnet-4-6', total_cost: 6, input_tokens: 1, output_tokens: 1 },
      { model: 'claude-opus-4-5', total_cost: 1.5, input_tokens: 1, output_tokens: 1 },
      { model: 'gpt-5', total_cost: 0.5, input_tokens: 1, output_tokens: 1 },
    ],
    liveRuns: [
      run({ id: 'a', status: 'running', input_tokens: 1000, output_tokens: 500, cached_tokens: 200, estimated_cost: 0.05 }),
      run({ id: 'b', status: 'waiting_approval', input_tokens: 300, output_tokens: 0, cached_tokens: 0, estimated_cost: 0.011 }),
      run({ id: 'c', status: 'completed', input_tokens: 9999, output_tokens: 9999, estimated_cost: 99 }),
    ],
    periodCosts: { today: 3.14159, week: 12.3456 },
    nowMs: NOW,
  });
  check('spendTodayUsd 2dp', full.spendTodayUsd === 3.14);
  check('spendWeekUsd 2dp', full.spendWeekUsd === 12.35);
  check('tokens carried', full.tokens?.input === 250_000 && full.tokens?.cacheRead === 750_000 && full.tokens?.cacheWrite === 40_000);
  check('cacheHitPct = 750k/(750k+250k) = 75', full.cacheHitPct === 75, `got ${full.cacheHitPct}`);
  check('topModels ≤ 3', full.topModels.length === 3);
  check('topModels sorted by cost', full.topModels[0].model === 'claude-sonnet-4-6' && full.topModels[2].model === 'claude-opus-4-5');
  check('sharePct ints sum sensibly', full.topModels[0].sharePct === 60 && full.topModels[1].sharePct === 20 && full.topModels[2].sharePct === 15);
  check('liveBurn counts only building runs', full.liveBurn?.activeRuns === 2);
  check('liveBurn tokensInFlight', full.liveBurn?.tokensInFlight === 2000, `got ${full.liveBurn?.tokensInFlight}`);
  check('liveBurn cost 2dp', full.liveBurn?.costInFlightUsd === 0.06, `got ${full.liveBurn?.costInFlightUsd}`);
  check('updatedAtMs = nowMs', full.updatedAtMs === NOW);

  const partial = buildOfficeTokenTracker({
    summary: { total_cost: 5, cache_hit_rate: 0.5 },
    nowMs: NOW,
  });
  check('partial: week falls back to summary.total_cost', partial.spendWeekUsd === 5);
  check('partial: no today spend', partial.spendTodayUsd === undefined);
  check('partial: fraction cache rate normalized to 50', partial.cacheHitPct === 50, `got ${partial.cacheHitPct}`);
  check('partial: no liveBurn without liveRuns', partial.liveBurn === undefined);
  check('partial: topModels empty array', Array.isArray(partial.topModels) && partial.topModels.length === 0);

  const pctRate = buildOfficeTokenTracker({ summary: { cache_hit_rate: 62 }, nowMs: NOW });
  check('percent-style cache rate passes through', pctRate.cacheHitPct === 62);

  const empty = buildOfficeTokenTracker({ nowMs: NOW });
  check(
    'empty input does not crash and stays optional',
    empty.spendTodayUsd === undefined &&
      empty.spendWeekUsd === undefined &&
      empty.tokens === undefined &&
      empty.cacheHitPct === undefined &&
      empty.liveBurn === undefined &&
      empty.topModels.length === 0 &&
      empty.updatedAtMs === NOW,
  );
}

// ─── 5. Formatting helpers ──────────────────────────────────────────────────

console.log('\n[5] formatting helpers');
{
  check('formatTokenCount 0', formatTokenCount(0) === '0');
  check('formatTokenCount 950', formatTokenCount(950) === '950');
  check('formatTokenCount 1234 → 1.2k', formatTokenCount(1234) === '1.2k', formatTokenCount(1234));
  check('formatTokenCount 12000 → 12k', formatTokenCount(12_000) === '12k', formatTokenCount(12_000));
  check('formatTokenCount 3.4M', formatTokenCount(3_400_000) === '3.4M', formatTokenCount(3_400_000));
  check('formatTokenCount negative clamps to 0', formatTokenCount(-50) === '0');

  check('relative: 10s → just now', formatRelativeTime(10_000) === 'just now');
  check('relative: 60s → 1m ago', formatRelativeTime(60_000) === '1m ago');
  check('relative: 5m', formatRelativeTime(5 * 60_000) === '5m ago');
  check('relative: 2h', formatRelativeTime(2 * 60 * 60_000) === '2h ago');
  check('relative: 3d', formatRelativeTime(3 * 24 * 60 * 60_000) === '3d ago');
  check('relative: negative → just now', formatRelativeTime(-5000) === 'just now');
}

// ─── 6. Per-agent live ops ──────────────────────────────────────────────────

console.log('\n[6] per-agent live ops');
{
  const board = buildOfficeBuildingBoard(
    [
      run({ id: 'p', status: 'running', started_at: iso(-60_000) }),
      run({ id: 'k1', status: 'running', parent_run_id: 'p', delegated_to: 'coder', started_at: iso(-30_000) }),
      run({ id: 'k2', status: 'queued', parent_run_id: 'p', delegated_to: 'tester', started_at: iso(-20_000) }),
    ],
    { nowMs: NOW },
  );
  const flatNodes = [...board.building, ...board.building.flatMap((n) => n.children)];

  const ops = buildAgentLiveOps(
    {
      currentToolName: 'browser.find',
      currentToolFile: '/Users/x/repo/src/lib/officeOpsBoard.ts',
      recentToolCalls: [
        { tool: 'fs.read', file: 'a.ts', ts: iso(-1000) },
        { tool: 'fs.read', file: 'b.ts', ts: iso(-2000) },
        { tool: 'bash.run', file: '', ts: iso(-3000) },
        { tool: 'browser.find', file: '', ts: iso(-4000) },
        { tool: 'fs.write', file: 'c.ts', ts: iso(-5000) },
      ],
      activeFiles: ['/Users/x/repo/src/screens/circles/tabs/OfficeTab.tsx'],
      uptime: '3h',
      lastActive: iso(-5 * 60_000),
      subagentCount: 9,
    },
    flatNodes,
    NOW,
  );
  check('statusLine built', ops.statusLine === 'Now: browser.find officeOpsBoard.ts', ops.statusLine);
  check('recentTools deduped + ≤3', ops.recentTools.length === 3 && JSON.stringify(ops.recentTools) === JSON.stringify(['fs.read', 'bash.run', 'browser.find']));
  check('activeFile basename', ops.activeFile === 'OfficeTab.tsx');
  check('uptimeLabel passthrough', ops.uptimeLabel === '3h');
  check('lastActiveLabel relative', ops.lastActiveLabel === '5m ago', ops.lastActiveLabel);
  check('subagents counted from runs (not fallback)', ops.subagents.active === 2 && ops.subagents.label === '2 subagents active');

  const sparse = buildAgentLiveOps({ subagentCount: 4 }, [], NOW);
  check('sparse agent: all optional fields absent', sparse.statusLine === undefined && sparse.activeFile === undefined && sparse.uptimeLabel === undefined && sparse.lastActiveLabel === undefined);
  check('sparse agent: subagent fallback count', sparse.subagents.active === 4 && sparse.subagents.label === '4 subagents active');
  check('sparse agent: recentTools empty', sparse.recentTools.length === 0);

  const idle = buildAgentLiveOps({}, [], NOW);
  check('idle agent: zero subagents, no label', idle.subagents.active === 0 && idle.subagents.label === undefined);
}

// ─── 7. Determinism (no Date.now in pure fns) ───────────────────────────────

console.log('\n[7] determinism');
{
  const runs: AgentRunLike[] = [
    run({ id: 'r1', status: 'running', started_at: iso(-90_000), input_tokens: 10, output_tokens: 5 }),
    run({ id: 'r2', status: 'queued', parent_run_id: 'r1', delegated_to: 'coder' }),
    run({ id: 'r3', status: 'completed', started_at: iso(-6 * 60_000), completed_at: iso(-60_000) }),
  ];
  const a = buildOfficeBuildingBoard(runs, { nowMs: NOW });
  const b = buildOfficeBuildingBoard(runs, { nowMs: NOW });
  check('board deterministic for same nowMs', JSON.stringify(a) === JSON.stringify(b));

  const t1 = buildOfficeTokenTracker({ summary: { total_cost: 1 }, liveRuns: runs, nowMs: NOW });
  const t2 = buildOfficeTokenTracker({ summary: { total_cost: 1 }, liveRuns: runs, nowMs: NOW });
  check('tracker deterministic for same nowMs', JSON.stringify(t1) === JSON.stringify(t2));

  const o1 = buildAgentLiveOps({ lastActive: iso(-60_000) }, a.building, NOW);
  const o2 = buildAgentLiveOps({ lastActive: iso(-60_000) }, b.building, NOW);
  check('live ops deterministic for same nowMs', JSON.stringify(o1) === JSON.stringify(o2));
}

// ─── Per-agent accountability index (O1, P38) ───────────────────────────────

console.log('\n[A] accountability index — outcomes, window, keying, cost');
{
  const runs: AgentRunLike[] = [
    // Research Agent: one success 2h ago, one FAILURE 20m ago (newer → lastLine)
    run({
      id: 'r1',
      status: 'completed',
      title: 'Summarize docs',
      delegated_to: 'research_agent',
      completed_at: iso(-2 * 60 * 60 * 1000),
      estimated_cost: 0.12,
      metadata: {
        agentSubjectKey: 'office::researcher',
        agentDisplayName: 'Research Agent',
        legacyAgentIds: ['research_agent', 'legacy::research'],
      },
    }),
    run({
      id: 'r2',
      status: 'failed',
      title: 'Fetch external corpus',
      delegated_to: 'research_agent',
      completed_at: iso(-20 * 60_000),
      estimated_cost: 0.031,
      metadata: {
        agentSubjectKey: 'office::researcher',
        agentDisplayName: 'Research Agent',
        legacyAgentIds: ['research_agent', 'legacy::research'],
      },
    }),
    // Coder: one success 5m ago
    run({ id: 'r3', status: 'completed', title: 'Fix login flow', delegated_to: 'coder', completed_at: iso(-5 * 60_000), estimated_cost: 0.5 }),
    // Outside the 24h window — excluded
    run({ id: 'r4', status: 'completed', title: 'Old work', delegated_to: 'coder', completed_at: iso(-25 * 60 * 60 * 1000), estimated_cost: 9 }),
    // Future-dated — excluded
    run({ id: 'r5', status: 'completed', title: 'Clock skew', delegated_to: 'coder', completed_at: iso(60_000) }),
    // Still building — ignored (live board's job)
    run({ id: 'r6', status: 'running', title: 'In flight', delegated_to: 'coder' }),
  ];
  const index = buildOfficeAgentAccountabilityIndex(runs, { nowMs: NOW });

  const research = index.get('research agent');
  check('delegated_to keys by prettified lowercased name', !!research);
  check('subject key also indexes accountability', index.get('office::researcher')?.failed24h === 1);
  check('legacy alias also indexes accountability', index.get('legacy::research')?.completed24h === 1);
  check('newest finished run wins the line (failure)', !!research && research.lastLine.startsWith('❌ Fetch external corpus'));
  check('failure tone is danger', research?.tone === 'danger');
  check('counts: 1 completed + 1 failed', research?.completed24h === 1 && research?.failed24h === 1);
  check('cost sums + rounds to 2dp', research?.costUsd24h === 0.15, String(research?.costUsd24h));
  check('line carries relative time', !!research && /ago/.test(research.lastLine));

  const coder = index.get('coder');
  check('success line has ✅ + title', !!coder && coder.lastLine.startsWith('✅ Fix login flow'));
  check('success tone is good', coder?.tone === 'good');
  check('out-of-window + future + building excluded', coder?.completed24h === 1 && coder?.failed24h === 0);
  check('excluded old run cost not summed', coder?.costUsd24h === 0.5);

  check('counts chip formats "✓1 ✗1"', formatAccountabilityCounts(research) === '✓1 ✗1');
  check('counts chip formats "✓1"', formatAccountabilityCounts(coder) === '✓1');
  check('counts chip empty for null', formatAccountabilityCounts(null) === '');

  // Window override + determinism + degenerates
  const narrow = buildOfficeAgentAccountabilityIndex(runs, { nowMs: NOW, windowMs: 10 * 60_000 });
  check('custom window excludes older finishes', !narrow.get('research agent') || narrow.get('research agent')!.completed24h === 0);
  const again = buildOfficeAgentAccountabilityIndex(runs, { nowMs: NOW });
  check('deterministic for same nowMs', JSON.stringify([...again.entries()]) === JSON.stringify([...index.entries()]));
  check('null runs → empty map', buildOfficeAgentAccountabilityIndex(null, { nowMs: NOW }).size === 0);
  check('window constant is 24h', OFFICE_ACCOUNTABILITY_WINDOW_MS === 24 * 60 * 60 * 1000);

  // Long titles stay bounded inside the line
  const long = buildOfficeAgentAccountabilityIndex(
    [run({ id: 'r7', status: 'completed', title: 'x'.repeat(200), delegated_to: 'coder', completed_at: iso(-1000) })],
    { nowMs: NOW },
  ).get('coder');
  check('title bounded in line', !!long && long.lastLine.length < 90, String(long?.lastLine.length));
}

// ─── Synthetic pinned-agent live status (O8) ────────────────────────────────

console.log('\n[O8] synthetic live status — evidence, mapping, staleness');
{
  const boardNodes = (runs: AgentRunLike[]) => buildOfficeBuildingBoard(runs, { nowMs: NOW }).building;

  // Name-key contract: the OfficeTab mapping decisions are pinned here.
  check('OpenSwan keys cover brand + legacy + chat surface',
    OPENSWAN_RUN_NAME_KEYS.includes('openswan') && OPENSWAN_RUN_NAME_KEYS.includes('blackswan') && OPENSWAN_RUN_NAME_KEYS.includes('chat agent'));
  check('OpenSwan keys do NOT claim room/feed surfaces',
    !OPENSWAN_RUN_NAME_KEYS.includes('room agent') && !OPENSWAN_RUN_NAME_KEYS.includes('feed agent'));
  check('HuggingSwan keys', HUGGINGSWAN_RUN_NAME_KEYS.includes('huggingswan'));

  // Evidence: running chat-surface run (no delegated_to → agentName 'Chat agent') → active.
  const chatRun = run({
    id: 'chat-1', status: 'running', surface: 'main_chat',
    title: 'Fix the login flow for beta members', started_at: iso(-60_000),
  });
  const active = deriveSyntheticAgentStatusFromRuns(OPENSWAN_RUN_NAME_KEYS, boardNodes([chatRun]), NOW);
  check('chat-surface running run → active', active?.status === 'active', JSON.stringify(active));
  check('activity = "Working: <title>"', active?.activity === 'Working: Fix the login flow for beta members', active?.activity);
  check('runId carried', active?.runId === 'chat-1');

  // delegated_to variants land on the same agent.
  const viaDelegated = deriveSyntheticAgentStatusFromRuns(
    OPENSWAN_RUN_NAME_KEYS,
    boardNodes([run({ id: 'bs-1', status: 'running', delegated_to: 'black_swan', started_at: iso(-30_000) })]),
    NOW,
  );
  check('delegated_to black_swan → "black swan" key matches', viaDelegated?.status === 'active');
  const hsLive = deriveSyntheticAgentStatusFromRuns(
    HUGGINGSWAN_RUN_NAME_KEYS,
    boardNodes([run({ id: 'hs-1', status: 'running', delegated_to: 'huggingswan', started_at: iso(-30_000) })]),
    NOW,
  );
  check('huggingswan delegated run matches HuggingSwan keys', hsLive?.status === 'active' && hsLive.runId === 'hs-1');

  // Conservative mapping: queued/planning/paused/waiting_approval → building.
  const waiting = deriveSyntheticAgentStatusFromRuns(
    OPENSWAN_RUN_NAME_KEYS,
    boardNodes([run({ id: 'os-w', status: 'waiting_approval', delegated_to: 'openswan', title: 'Deploy docs site', started_at: iso(-120_000) })]),
    NOW,
  );
  check('waiting_approval → building', waiting?.status === 'building');
  check('building-tier label wording', waiting?.activity === 'Waiting for approval: Deploy docs site', waiting?.activity);
  const queued = deriveSyntheticAgentStatusFromRuns(
    OPENSWAN_RUN_NAME_KEYS,
    boardNodes([run({ id: 'os-q', status: 'queued', delegated_to: 'openswan', started_at: iso(-120_000) })]),
    NOW,
  );
  check('queued → building', queued?.status === 'building');

  // Selection: running beats queued even when queued is newer; deterministic tie-break.
  const mixed = deriveSyntheticAgentStatusFromRuns(
    OPENSWAN_RUN_NAME_KEYS,
    boardNodes([
      run({ id: 'os-q2', status: 'queued', delegated_to: 'openswan', started_at: iso(-5_000) }),
      run({ id: 'os-r2', status: 'running', delegated_to: 'openswan', started_at: iso(-90_000) }),
    ]),
    NOW,
  );
  check('running beats newer queued', mixed?.status === 'active' && mixed.runId === 'os-r2');

  // Tree walk: matching child under a non-matching root still counts.
  const treeLive = deriveSyntheticAgentStatusFromRuns(
    OPENSWAN_RUN_NAME_KEYS,
    boardNodes([
      run({ id: 'root-x', status: 'running', delegated_to: 'coder', started_at: iso(-60_000) }),
      run({ id: 'kid-os', status: 'running', parent_run_id: 'root-x', delegated_to: 'openswan', started_at: iso(-30_000) }),
    ]),
    NOW,
  );
  check('matching child found via tree walk', treeLive?.runId === 'kid-os');

  // No evidence: name mismatch, finished runs, stale runs, malformed future runs.
  check('name mismatch → null', deriveSyntheticAgentStatusFromRuns(
    OPENSWAN_RUN_NAME_KEYS,
    boardNodes([run({ id: 'c-1', status: 'running', delegated_to: 'coder', started_at: iso(-30_000) })]),
    NOW,
  ) === null);
  const finishedNodes = buildOfficeBuildingBoard(
    [
      run({ id: 'os-done', status: 'completed', surface: 'main_chat', started_at: iso(-8 * 60_000), completed_at: iso(-60_000) }),
      run({ id: 'os-fail', status: 'failed', surface: 'main_chat', started_at: iso(-8 * 60_000), completed_at: iso(-30_000) }),
    ],
    { nowMs: NOW },
  ).recentlyFinished;
  check('finished runs are not evidence', finishedNodes.length === 2
    && deriveSyntheticAgentStatusFromRuns(OPENSWAN_RUN_NAME_KEYS, finishedNodes, NOW) === null);
  check('stale running run (> max age) → null', deriveSyntheticAgentStatusFromRuns(
    OPENSWAN_RUN_NAME_KEYS,
    boardNodes([run({ id: 'os-stale', status: 'running', delegated_to: 'openswan', started_at: iso(-SYNTHETIC_STATUS_RUN_MAX_AGE_MS - 60_000) })]),
    NOW,
  ) === null);
  check('far-future startedAt → null', deriveSyntheticAgentStatusFromRuns(
    OPENSWAN_RUN_NAME_KEYS,
    boardNodes([run({ id: 'os-fut', status: 'running', delegated_to: 'openswan', started_at: iso(10 * 60_000), created_at: iso(10 * 60_000) })]),
    NOW,
  ) === null);
  check('empty keys → null', deriveSyntheticAgentStatusFromRuns([], boardNodes([chatRun]), NOW) === null);
  check('null nodes → null', deriveSyntheticAgentStatusFromRuns(OPENSWAN_RUN_NAME_KEYS, null, NOW) === null);

  // Bounds: long titles stay clipped inside the activity line.
  const longLive = deriveSyntheticAgentStatusFromRuns(
    OPENSWAN_RUN_NAME_KEYS,
    boardNodes([run({ id: 'os-long', status: 'running', delegated_to: 'openswan', title: 'x'.repeat(300), started_at: iso(-30_000) })]),
    NOW,
  );
  check('activity bounded (≤ 72 chars)', !!longLive && longLive.activity.length <= 72, String(longLive?.activity.length));

  // Determinism: same inputs + nowMs → identical output.
  const detRuns = [
    run({ id: 'd-1', status: 'running', delegated_to: 'openswan', started_at: iso(-45_000) }),
    run({ id: 'd-2', status: 'queued', surface: 'main_chat', started_at: iso(-15_000) }),
  ];
  check('deterministic for same nowMs', JSON.stringify(
    deriveSyntheticAgentStatusFromRuns(OPENSWAN_RUN_NAME_KEYS, boardNodes(detRuns), NOW),
  ) === JSON.stringify(
    deriveSyntheticAgentStatusFromRuns(OPENSWAN_RUN_NAME_KEYS, boardNodes(detRuns), NOW),
  ));

  // Upgrade ladder: upgrade-only, offline/error untouched, never demote.
  const activeEv = active!;
  const buildingEv = waiting!;
  const up1 = applySyntheticAgentStatusUpgrade('idle', activeEv);
  check('idle + active evidence → active + activity', up1.changed && up1.status === 'active' && up1.activity === activeEv.activity);
  const up2 = applySyntheticAgentStatusUpgrade('idle', buildingEv);
  check('idle + building evidence → building', up2.changed && up2.status === 'building');
  const up3 = applySyntheticAgentStatusUpgrade('building', activeEv);
  check('building + active evidence → active', up3.changed && up3.status === 'active');
  const up4 = applySyntheticAgentStatusUpgrade('building', buildingEv);
  check('building + building evidence → status kept, activity refreshed', up4.changed && up4.status === 'building' && up4.activity === buildingEv.activity);
  const up5 = applySyntheticAgentStatusUpgrade('active', buildingEv);
  check('active never demoted by building evidence', up5.changed && up5.status === 'active');
  const up6 = applySyntheticAgentStatusUpgrade('offline', activeEv);
  check('offline untouched (O2 demotions win)', !up6.changed && up6.status === 'offline' && up6.activity === undefined);
  const up7 = applySyntheticAgentStatusUpgrade('error', activeEv);
  check('error untouched', !up7.changed && up7.status === 'error');
  const up8 = applySyntheticAgentStatusUpgrade('idle', null);
  check('no evidence → untouched', !up8.changed && up8.status === 'idle' && up8.activity === undefined);
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\noffice-ops-board smoketest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
