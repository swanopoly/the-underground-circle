/**
 * chat-lane-health-smoketest — verifies the X7 (P48) per-lane quality
 * registry in `src/lib/chatLaneHealthRegistry.ts`.
 *
 * Covers:
 *   - record/snapshot counts (completed/failed/interrupted/neutral/fallbacks)
 *   - trailing failure streak (success clears; neutral skips)
 *   - degradation thresholds (streak floor; rate floor with min window)
 *   - the postmortem primitive: lane_isolated vs multi_lane vs none,
 *     staleness-aware (old failures don't cry wolf)
 *   - WARN-only hint semantics (healthy/unrecorded/stale → null)
 *   - archive tags (lane_degraded, streak, degradation scope)
 *   - report formatting (empty state + populated), bounds/eviction, reset
 *
 * Run: npm run smoke:chat-lane-health
 */

import {
  recordChatLaneTerminal,
  recordChatLaneOutcome,
  getChatLaneHealthSnapshot,
  assessChatLaneDegradation,
  getChatLaneHealthHint,
  buildChatLaneHealthTags,
  buildChatLaneHealthStripModel,
  formatChatLaneHealthReport,
  resetChatLaneHealth,
  MAX_LANES,
  MAX_EVENTS_PER_LANE,
  LANE_HEALTH_STALENESS_MS,
  DEGRADED_STREAK_FLOOR,
} from '../src/lib/chatLaneHealthRegistry';
import type { ChatLaneOutcome } from '../src/lib/chatLaneOutcome';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

const T0 = 1_000_000;

function main() {
  // ─── Case 1: counts + streak + rate ─────────────────────────────────────
  {
    resetChatLaneHealth();
    recordChatLaneTerminal({ lane: 'stream', status: 'completed' }, T0);
    recordChatLaneTerminal({ lane: 'stream', status: 'failed', reason: 'provider_5xx' }, T0 + 1000);
    recordChatLaneTerminal({ lane: 'stream', status: 'interrupted', reason: 'stream_broken_pipe' }, T0 + 2000);
    recordChatLaneTerminal({ lane: 'stream', status: 'deferred' }, T0 + 3000);
    const [health] = getChatLaneHealthSnapshot();
    assert(health.lane === 'stream' && health.total === 4, 'case1: totals recorded');
    assert(health.completed === 1 && health.failed === 1 && health.interrupted === 1 && health.neutral === 1,
      'case1: status buckets counted');
    assert(health.consecutiveFailures === 2,
      'case1: streak counts failed+interrupted, skips trailing neutral', `got ${health.consecutiveFailures}`);
    assert(Math.abs(health.failureRate - 2 / 3) < 1e-9,
      'case1: failure rate over non-neutral outcomes only');
    assert(health.lastStatus === 'deferred' && health.lastReason === null, 'case1: last terminal captured');
    recordChatLaneTerminal({ lane: 'stream', status: 'completed' }, T0 + 4000);
    assert(getChatLaneHealthSnapshot()[0].consecutiveFailures === 0, 'case1: success clears the streak');
  }

  // ─── Case 2: degradation thresholds ─────────────────────────────────────
  {
    resetChatLaneHealth();
    for (let i = 0; i < DEGRADED_STREAK_FLOOR - 1; i += 1) {
      recordChatLaneTerminal({ lane: 'batch', status: 'failed' }, T0 + i);
    }
    assert(!getChatLaneHealthSnapshot()[0].degraded, 'case2: below streak floor → not degraded');
    recordChatLaneTerminal({ lane: 'batch', status: 'failed' }, T0 + 10);
    assert(getChatLaneHealthSnapshot()[0].degraded, 'case2: streak floor reached → degraded');

    resetChatLaneHealth();
    // 2 fail / 2 ok = 50% rate at min window (4 non-neutral) → degraded.
    recordChatLaneTerminal({ lane: 'batch', status: 'failed' }, T0);
    recordChatLaneTerminal({ lane: 'batch', status: 'completed' }, T0 + 1);
    recordChatLaneTerminal({ lane: 'batch', status: 'failed' }, T0 + 2);
    recordChatLaneTerminal({ lane: 'batch', status: 'completed' }, T0 + 3);
    assert(getChatLaneHealthSnapshot()[0].degraded, 'case2: 50% failure rate at min window → degraded');
    resetChatLaneHealth();
    // 1 fail / 2 ok = 33% — healthy.
    recordChatLaneTerminal({ lane: 'batch', status: 'failed' }, T0);
    recordChatLaneTerminal({ lane: 'batch', status: 'completed' }, T0 + 1);
    recordChatLaneTerminal({ lane: 'batch', status: 'completed' }, T0 + 2);
    assert(!getChatLaneHealthSnapshot()[0].degraded, 'case2: minority failures → healthy');
  }

  // ─── Case 3: the postmortem primitive — isolated vs multi vs none ───────
  {
    resetChatLaneHealth();
    assert(assessChatLaneDegradation(T0).scope === 'none', 'case3: empty registry → none');

    // One degraded lane + two healthy lanes = lane_isolated.
    for (let i = 0; i < 3; i += 1) recordChatLaneTerminal({ lane: 'openswan_v2', status: 'failed', reason: 'provider_5xx' }, T0 + i);
    recordChatLaneTerminal({ lane: 'stream', status: 'completed' }, T0 + 10);
    recordChatLaneTerminal({ lane: 'computer_task', status: 'completed' }, T0 + 11);
    const isolated = assessChatLaneDegradation(T0 + 20);
    assert(isolated.scope === 'lane_isolated' && isolated.degradedLanes.join(',') === 'openswan_v2',
      'case3: one bad lane + healthy baseline → lane_isolated');
    assert(isolated.summary.includes('openswan_v2') && isolated.summary.includes('not global'),
      'case3: isolated summary names the lane and says not-global');

    // Degrade a second lane → multi_lane.
    for (let i = 0; i < 3; i += 1) recordChatLaneTerminal({ lane: 'stream', status: 'failed', reason: 'timeout' }, T0 + 30 + i);
    const multi = assessChatLaneDegradation(T0 + 40);
    assert(multi.scope === 'multi_lane' && multi.degradedLanes.length === 2,
      'case3: two bad lanes → multi_lane (systemic)');
    assert(multi.summary.includes('systemic'), 'case3: multi summary says systemic');

    // Staleness: same registry assessed far in the future → none (no crying wolf).
    const later = assessChatLaneDegradation(T0 + LANE_HEALTH_STALENESS_MS + 60_000);
    assert(later.scope === 'none', 'case3: stale failures ignored by assessment');
  }

  // ─── Case 4: hint semantics (WARN-only) ─────────────────────────────────
  {
    resetChatLaneHealth();
    assert(getChatLaneHealthHint('stream', T0) === null, 'case4: unrecorded lane → null hint');
    recordChatLaneTerminal({ lane: 'stream', status: 'completed' }, T0);
    assert(getChatLaneHealthHint('stream', T0 + 1) === null, 'case4: healthy lane → null hint (no noise)');
    for (let i = 0; i < 3; i += 1) recordChatLaneTerminal({ lane: 'stream', status: 'failed', reason: 'rate_limited' }, T0 + 10 + i);
    const hint = getChatLaneHealthHint('stream', T0 + 20);
    assert(!!hint && hint.includes('⚠️') && hint.includes('3 consecutive') && hint.includes('rate_limited'),
      'case4: degraded lane → warn hint with streak + reason', hint || 'null');
    assert(getChatLaneHealthHint('stream', T0 + LANE_HEALTH_STALENESS_MS + 60_000) === null,
      'case4: stale degradation → null hint');
  }

  // ─── Case 5: archive tags ────────────────────────────────────────────────
  {
    resetChatLaneHealth();
    recordChatLaneTerminal({ lane: 'computer_task', status: 'failed' }, T0);
    assert(buildChatLaneHealthTags('computer_task', T0 + 1).length === 0,
      'case5: single failure below both floors → NO tags (no noise)');
    for (let i = 0; i < 2; i += 1) recordChatLaneTerminal({ lane: 'computer_task', status: 'failed' }, T0 + 2 + i);
    const tags = buildChatLaneHealthTags('computer_task', T0 + 10);
    assert(tags.includes('lane_degraded:yes') && tags.includes('lane_failure_streak:3'),
      'case5: degraded lane tags carry streak', tags.join('|'));
    assert(tags.includes('lane_degradation_scope:lane_isolated'),
      'case5: degradation scope tag present once the floor is crossed', tags.join('|'));
  }

  // ─── Case 6: outcome-envelope adapter + fallback counting ───────────────
  {
    resetChatLaneHealth();
    const outcome: ChatLaneOutcome = {
      lane: 'batch',
      status: 'completed',
      message: 'hi',
      recoveryOptions: [],
      servedBy: { model: 'claude-sonnet-4-6', transport: 'swanbot', fallback: true },
    };
    recordChatLaneOutcome(outcome, T0);
    const [health] = getChatLaneHealthSnapshot();
    assert(health.fallbacks === 1, 'case6: visible fallback counted from the envelope');
    const failedOutcome: ChatLaneOutcome = {
      lane: 'batch', status: 'failed', message: 'x', recoveryOptions: [],
      recovery: { recoverableBy: 'system', retrySideEffectSafe: true, reason: 'provider_overloaded' },
    };
    recordChatLaneOutcome(failedOutcome, T0 + 1);
    assert(getChatLaneHealthSnapshot()[0].lastReason === 'provider_overloaded',
      'case6: classification reason carried from the envelope');
  }

  // ─── Case 7: report formatting ──────────────────────────────────────────
  {
    resetChatLaneHealth();
    assert(formatChatLaneHealthReport(T0).includes('no chat lane terminals recorded'),
      'case7: empty state is plain-language, not an error');
    recordChatLaneTerminal({ lane: 'stream', status: 'completed' }, T0);
    recordChatLaneTerminal({ lane: 'openswan_v2', status: 'failed', reason: 'provider_5xx' }, T0 + 1000);
    recordChatLaneTerminal({ lane: 'openswan_v2', status: 'failed', reason: 'provider_5xx' }, T0 + 2000);
    recordChatLaneTerminal({ lane: 'openswan_v2', status: 'failed', reason: 'provider_5xx' }, T0 + 3000);
    const report = formatChatLaneHealthReport(T0 + 10_000);
    assert(report.includes('Lane health'), 'case7: report has heading');
    assert(report.includes('✅ stream') && report.includes('⚠️ openswan_v2'),
      'case7: healthy vs degraded flags per lane');
    assert(report.includes('Lane-isolated degradation'), 'case7: classification line leads the report');
    assert(report.includes('provider_5xx'), 'case7: last failure reason visible');
  }

  // ─── Case 8: bounds, eviction, junk input, reset ────────────────────────
  {
    resetChatLaneHealth();
    for (let i = 0; i < MAX_EVENTS_PER_LANE + 25; i += 1) {
      recordChatLaneTerminal({ lane: 'stream', status: 'completed' }, T0 + i);
    }
    assert(getChatLaneHealthSnapshot()[0].total === MAX_EVENTS_PER_LANE,
      'case8: per-lane ring bounded');
    for (let i = 0; i < MAX_LANES + 4; i += 1) {
      recordChatLaneTerminal({ lane: `lane_${i}`, status: 'completed' }, T0 + 1000 + i);
    }
    assert(getChatLaneHealthSnapshot().length <= MAX_LANES, 'case8: lane count bounded (stalest evicted)');
    recordChatLaneTerminal({ lane: '', status: 'completed' }, T0);
    recordChatLaneTerminal(null as any, T0);
    pass('case8: junk input never throws');
    resetChatLaneHealth();
    assert(getChatLaneHealthSnapshot().length === 0, 'case8: reset clears everything');
  }

  // ─── Case 9: Office strip model (X7 tail / P53) ─────────────────────────
  {
    resetChatLaneHealth();
    assert(buildChatLaneHealthStripModel(T0) === null, 'case9: empty registry → null (strip renders nothing)');
    recordChatLaneTerminal({ lane: 'stream', status: 'completed' }, T0);
    assert(buildChatLaneHealthStripModel(T0 + 1) === null, 'case9: healthy lanes → null (silent when healthy)');

    for (let i = 0; i < 3; i += 1) recordChatLaneTerminal({ lane: 'openswan_v2', status: 'failed', reason: 'provider_5xx' }, T0 + 10 + i);
    const isolated = buildChatLaneHealthStripModel(T0 + 20)!;
    assert(isolated.tone === 'warn', 'case9: lane-isolated → warn tone');
    assert(isolated.headline.includes('openswan_v2') && isolated.headline.includes('3 fail')
      && isolated.headline.includes('provider_5xx'),
      'case9: headline carries lane + streak + reason', isolated.headline);
    assert(isolated.detail.includes('/lanes'), 'case9: detail points at the /lanes report');

    for (let i = 0; i < 3; i += 1) recordChatLaneTerminal({ lane: 'stream', status: 'failed', reason: 'timeout' }, T0 + 30 + i);
    const systemic = buildChatLaneHealthStripModel(T0 + 40)!;
    assert(systemic.tone === 'danger', 'case9: multi-lane → danger tone');
    assert(systemic.headline.startsWith('LANES DEGRADED'), 'case9: multi-lane headline names the pattern');

    assert(buildChatLaneHealthStripModel(T0 + LANE_HEALTH_STALENESS_MS + 60_000) === null,
      'case9: stale degradation → null (no crying wolf on the Office view)');
    assert(isolated.headline.length <= 120 && isolated.detail.length <= 220, 'case9: strip text bounded');
  }

  console.log(failures === 0 ? '\nchat-lane-health smoke: ALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
