import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  SWANBOT_OPENSWAN_REQUIRED_SMOKES,
  buildSwanBotOpenSwanReadinessSnapshot,
  deriveSwanbotV2ToolParityFromSource,
  formatSwanBotOpenSwanReadinessPromptBlock,
  type SwanBotOpenSwanSmokeCheck,
} from '../src/lib/swanbotOpenSwanReadiness';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function passingSmokes(): SwanBotOpenSwanSmokeCheck[] {
  return SWANBOT_OPENSWAN_REQUIRED_SMOKES.map(smoke => ({ ...smoke, status: 'pass' }));
}

// ── R16: live tool parity, derived from the actual edge-function source ──
// The expected constants must match the REAL swanbot-v2-ai TOOLS array
// exactly (both directions) so the readiness snapshot can never report
// parity against a stale expectation.
const v2Source = readFileSync(
  join(process.cwd(), 'supabase/functions/swanbot-v2-ai/index.ts'),
  'utf8',
);
const derived = deriveSwanbotV2ToolParityFromSource(v2Source);
const migrationPlan = readFileSync(
  join(process.cwd(), 'docs/SWANBOT_V2_MIGRATION_PLAN.md'),
  'utf8',
);
const nextPlan = readFileSync(
  join(process.cwd(), 'docs/SWANBOT_OPENSWAN_CHAT_NEXT_PLAN_2026-06-08.md'),
  'utf8',
);

assert(derived.total > 0 && derived.clientDelegated > 0 && derived.server > 0, 'derived parity counts should all be positive');
assert(
  derived.total === SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  `v2 tool total drifted: source has ${derived.total}, expected constant is ${SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL} — re-pin SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL`,
);
assert(
  derived.clientDelegated === SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  `v2 client-delegated count drifted: source has ${derived.clientDelegated}, expected constant is ${SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS} — re-pin SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS`,
);
assert(
  migrationPlan.includes(`${SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL} tools`) && migrationPlan.includes(`${SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS} client-delegated`),
  'SWANBOT_V2_MIGRATION_PLAN should name the current source-derived v2 tool parity counts',
);
assert(
  nextPlan.includes(`${SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL} source-derived tools`) && nextPlan.includes(`${SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS} client-delegated`),
  'SWANBOT_OPENSWAN_CHAT_NEXT_PLAN should name the current source-derived v2 tool parity counts',
);
for (const stalePhrase of [
  'All 11 desktop tools',
  'live 45-tool catalog',
  '45-tool v2 catalog',
  '22 client-delegated tools',
  '23 server-side + 22 client-delegated = 45 tools',
  '66 total / 41 client-delegated',
]) {
  assert(!migrationPlan.includes(stalePhrase), `SWANBOT_V2_MIGRATION_PLAN still contains stale phrase: ${stalePhrase}`);
  assert(!nextPlan.includes(stalePhrase), `SWANBOT_OPENSWAN_CHAT_NEXT_PLAN still contains stale phrase: ${stalePhrase}`);
}

const liveParity = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: derived.total,
  serverToolCount: derived.server,
  clientDelegatedToolCount: derived.clientDelegated,
  requiredSmokes: passingSmokes(),
  telemetry: {
    v1RunCount: 120,
    v2RunCount: 90,
    minRuns: 50,
    v1EndTurnRate: 0.91,
    v2EndTurnRate: 0.94,
  },
});

assert(liveParity.toolParity.ok, `live-derived parity should satisfy the snapshot: ${liveParity.toolParity.summary}`);

const EXPECTED_SERVER = SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL - SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS;

const ready = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  serverToolCount: EXPECTED_SERVER,
  clientDelegatedToolCount: SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  requiredSmokes: passingSmokes(),
  telemetry: {
    v1RunCount: 120,
    v2RunCount: 90,
    minRuns: 50,
    v1EndTurnRate: 0.91,
    v2EndTurnRate: 0.94,
  },
});

assert(ready.status === 'ready', 'clean parity, smokes, and telemetry should be ready');
assert(ready.canFlipDefault, 'ready snapshot should allow default flip');
assert(ready.score === 100, 'ready snapshot should score 100');
assert(ready.nextActions.some(action => action.includes('Flip the v2 default')), 'ready snapshot should name flip action');

const watch = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  serverToolCount: EXPECTED_SERVER,
  clientDelegatedToolCount: SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  requiredSmokes: passingSmokes(),
  telemetry: {
    v1RunCount: 120,
    v2RunCount: 8,
    minRuns: 50,
    v1EndTurnRate: 0.91,
    v2EndTurnRate: 0.95,
  },
});

assert(watch.status === 'watch', 'insufficient telemetry should watch, not block');
assert(!watch.canFlipDefault, 'watch snapshot should not flip default');
assert(watch.warnings.some(warning => warning.includes('Telemetry needs 50 v2 runs')), 'watch should explain telemetry sample gap');

const missingSmoke = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  serverToolCount: EXPECTED_SERVER,
  clientDelegatedToolCount: SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  requiredSmokes: passingSmokes().map(smoke => smoke.id === 'swanbot-v2-workspace'
    ? { ...smoke, status: 'missing' }
    : smoke),
  telemetry: {
    v1RunCount: 120,
    v2RunCount: 90,
    minRuns: 50,
    v1EndTurnRate: 0.91,
    v2EndTurnRate: 0.94,
  },
});

assert(missingSmoke.status === 'blocked', 'missing required smoke should block default flip');
assert(missingSmoke.blockers.some(blocker => blocker.includes('smoke:swanbot-v2-workspace')), 'missing smoke blocker should name command');

const lowToolCount = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: 42,
  serverToolCount: 23,
  clientDelegatedToolCount: 19,
  requiredSmokes: passingSmokes(),
  telemetry: {
    v1RunCount: 120,
    v2RunCount: 90,
    minRuns: 50,
    v1EndTurnRate: 0.91,
    v2EndTurnRate: 0.94,
  },
});

assert(lowToolCount.status === 'blocked', 'low v2 tool count should block default flip');
assert(lowToolCount.toolParity.summary.includes('Tool parity incomplete'), 'tool parity summary should explain low count');

const underperformingTelemetry = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  serverToolCount: EXPECTED_SERVER,
  clientDelegatedToolCount: SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  requiredSmokes: passingSmokes(),
  telemetry: {
    v1RunCount: 120,
    v2RunCount: 90,
    minRuns: 50,
    v1EndTurnRate: 0.94,
    v2EndTurnRate: 0.88,
  },
});

assert(underperformingTelemetry.status === 'blocked', 'v2 underperforming v1 should block default flip');
assert(underperformingTelemetry.nextActions.some(action => action.includes('highest-volume stop reason')), 'telemetry blocker should suggest trace repair');

const stopReasonTelemetry = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  serverToolCount: EXPECTED_SERVER,
  clientDelegatedToolCount: SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  requiredSmokes: passingSmokes(),
  telemetry: {
    minRuns: 50,
    v1StopReasons: {
      end_turn: 94,
      max_tokens: 3,
      tool_use: 3,
    },
    v2StopReasons: [
      { reason: 'end_turn', count: 78 },
      { reason: 'max_tokens', count: 9 },
      { reason: 'client_timeout', count: 7 },
      { reason: 'tool_use', count: 6 },
      { reason: 'max_tokens', count: 2 },
      { reason: null, count: 1 },
    ],
  },
});

assert(stopReasonTelemetry.telemetry.v1RunCount === 100, 'stop reasons: derives v1 run count');
assert(stopReasonTelemetry.telemetry.v2RunCount === 103, 'stop reasons: derives v2 run count');
assert(stopReasonTelemetry.telemetry.v1EndTurnRate === 0.94, 'stop reasons: derives v1 end_turn rate');
assert(stopReasonTelemetry.telemetry.v2EndTurnRate === 78 / 103, 'stop reasons: derives v2 end_turn rate');
assert(stopReasonTelemetry.telemetry.v2StopReasons.topNonEndTurnReason === 'max_tokens', 'stop reasons: top v2 non-end_turn reason');
assert(stopReasonTelemetry.telemetry.v2StopReasons.topNonEndTurnCount === 11, 'stop reasons: merges duplicate reasons');
assert(stopReasonTelemetry.telemetry.v2StopReasons.breakdown.some(entry => entry.reason === 'unknown' && entry.count === 1), 'stop reasons: normalizes empty reason');
assert(stopReasonTelemetry.status === 'blocked', 'stop reasons: underperforming derived telemetry blocks');
assert(
  stopReasonTelemetry.nextActions.some(action => action.includes('final_stop_reason="max_tokens"') && action.includes('11/103')),
  'stop reasons: next action names highest-volume repair target',
);

const promptBlock = formatSwanBotOpenSwanReadinessPromptBlock(ready);

assert(promptBlock.includes('SwanBot/OpenSwan Readiness'), 'prompt block should have readiness heading');
assert(promptBlock.includes('can_flip_default: yes'), 'prompt block should expose can_flip_default');
assert(promptBlock.includes('next_actions:'), 'prompt block should include next actions');

const diagnosticPromptBlock = formatSwanBotOpenSwanReadinessPromptBlock(stopReasonTelemetry);
assert(diagnosticPromptBlock.includes('stop_reasons:'), 'prompt block should expose stop reason line');
assert(diagnosticPromptBlock.includes('max_tokens:11'), 'prompt block should include top v2 stop reason');

console.log('swanbot-openswan-readiness smoke passed');
