import {
  SWANBOT_OPENSWAN_REQUIRED_SMOKES,
  buildSwanBotOpenSwanReadinessSnapshot,
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

const ready = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: 45,
  serverToolCount: 23,
  clientDelegatedToolCount: 22,
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
  v2ToolCatalogCount: 45,
  serverToolCount: 23,
  clientDelegatedToolCount: 22,
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
  v2ToolCatalogCount: 45,
  serverToolCount: 23,
  clientDelegatedToolCount: 22,
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
  v2ToolCatalogCount: 45,
  serverToolCount: 23,
  clientDelegatedToolCount: 22,
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

const promptBlock = formatSwanBotOpenSwanReadinessPromptBlock(ready);

assert(promptBlock.includes('SwanBot/OpenSwan Readiness'), 'prompt block should have readiness heading');
assert(promptBlock.includes('can_flip_default: yes'), 'prompt block should expose can_flip_default');
assert(promptBlock.includes('next_actions:'), 'prompt block should include next actions');

console.log('swanbot-openswan-readiness smoke passed');
