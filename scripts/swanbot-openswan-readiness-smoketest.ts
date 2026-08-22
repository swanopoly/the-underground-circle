import { readFileSync } from 'fs';
import { join } from 'path';
import {
  SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  SWANBOT_OPENSWAN_REQUIRED_SMOKES,
  buildSwanBotOpenSwanTelemetryInputFromAgentRunRows,
  buildSwanBotOpenSwanReadinessSnapshot,
  deriveSwanbotV2ToolParityFromSource,
  formatSwanBotOpenSwanReadinessPromptBlock,
  loadSwanBotOpenSwanAgentRunTelemetry,
  type SwanBotOpenSwanProductionContractCheck,
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

assert(
  SWANBOT_OPENSWAN_REQUIRED_SMOKES.some(smoke => smoke.id === 'swanbot-v2-stop-reason'),
  'required readiness smokes should include the v2 stop-reason/token persistence guard',
);
for (const requiredRuntimeSmoke of [
  'openswan-runtime-approval',
  'openswan-generic-native-ui-runtime',
  'browser-dom-snapshot-privacy',
  'swanbot-v2-terminal-integrity',
  'chat-approval-single-use',
  'event-bound-core',
  'swanbot-v2-continuation-crypto',
  'desktop-action-summary-replay',
  'computer-task-runtime-context',
  'computer-app-open-path-runtime',
  'automation-executor-mutation-guard',
  'scheduled-action-mutation-guard',
  'office-terminal-broadcast-authority',
  'database-authority-guards',
  'direct-local-file-runtime',
  'direct-image-conversion-runtime',
  'computer-app-action-contract',
  'browser-locator-actionability',
  'browser-wait-scroll-reachability',
  'browser-fill-mutation-gateway',
  'browser-toggle-mutation-gateway',
  'browser-toggle-runtime-gateway',
  'browser-select-mutation-gateway',
  'browser-select-runtime-gateway',
  'computer-use-select-handoff',
  'computer-use-mutation-handoff',
  'computer-use-cloud-policy',
  'computer-app-launch-focus-proof',
  'swanbot-v2-client-result-persistence',
  'swanbot-v2-batch-policy',
  'swanbot-v2-edge-fill-schema',
  'agent-action-calls',
  'agent-action-runtime-wiring',
  'computer-app-semantic-action-proof',
  'computer-app-semantic-action-runtime',
]) {
  const readinessEntries = SWANBOT_OPENSWAN_REQUIRED_SMOKES.filter(
    smoke => smoke.id === requiredRuntimeSmoke,
  );
  assert(
    readinessEntries.length === 1,
    `required readiness smokes should include ${requiredRuntimeSmoke} exactly once (found ${readinessEntries.length})`,
  );
}

type PackageScripts = Record<string, string>;

const packageJson = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
) as { scripts?: PackageScripts };
const packageScripts = packageJson.scripts ?? {};
const releaseWorkflowSource = readFileSync(
  join(process.cwd(), '.github/workflows/openswan-release.yml'),
  'utf8',
);

for (const currentPinnedAction of [
  'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1',
  'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0',
  'denoland/setup-deno@22d081ff2d3a40755e97629de92e3bcbfa7cf2ed # v2.0.5',
]) {
  assert(
    releaseWorkflowSource.includes(currentPinnedAction),
    `OpenSwan release workflow should pin current official action ${currentPinnedAction}`,
  );
}
assert(
  releaseWorkflowSource.includes('ref: ${{ github.event.pull_request.head.sha || github.sha }}')
    && releaseWorkflowSource.includes('persist-credentials: false'),
  'OpenSwan release workflow should inspect the exact event commit without persisting GitHub credentials',
);
assert(
  releaseWorkflowSource.includes('pull_request)')
    && releaseWorkflowSource.includes('workflow_dispatch)')
    && releaseWorkflowSource.includes('git check-ref-format "$base_candidate"')
    && releaseWorkflowSource.includes('git rev-parse --verify --end-of-options')
    && releaseWorkflowSource.includes('git merge-base "$resolved_base" "$head_commit"'),
  'OpenSwan release workflow should fail closed while resolving PR and manual-dispatch merge bases',
);
assert(
  releaseWorkflowSource.includes('--base-ref "$OPENSWAN_MERGE_BASE"')
    && releaseWorkflowSource.includes('git diff --check "$OPENSWAN_MERGE_BASE" "$OPENSWAN_HEAD_COMMIT" --'),
  'OpenSwan release workflow should scope review and whitespace checks to merge-base..committed HEAD',
);
assert(
  !releaseWorkflowSource.includes('pull_request_target:')
    && !releaseWorkflowSource.includes('${{ secrets.'),
  'OpenSwan release workflow should not run privileged PR code or interpolate repository secrets',
);
for (const releaseBoundaryPath of [
  "'supabase/migrations/**'",
  "'netlify.toml'",
  "'AGENTS.md'",
  "'AGENT.md'",
  "'CLAUDE.md'",
  "'Gemini.md'",
]) {
  assert(
    releaseWorkflowSource.includes(releaseBoundaryPath),
    `OpenSwan release workflow should run when ${releaseBoundaryPath} changes`,
  );
}

function commandSegments(scriptName: string): string[] {
  const command = packageScripts[scriptName];
  assert(typeof command === 'string' && command.length > 0, `package.json should define ${scriptName}`);
  return command.split(/\s*&&\s*/u).map(segment => segment.trim());
}

function assertExecutesOnce(scriptName: string, smokeName: string): void {
  const command = packageScripts[scriptName];
  if (scriptName === 'smoke:all' && command?.includes('scripts/run-smokes.mjs')) {
    assert(
      typeof packageScripts[smokeName] === 'string' && packageScripts[smokeName].length > 0,
      `${scriptName} should dynamically discover registered ${smokeName}`,
    );
    return;
  }
  const expected = `npm run ${smokeName}`;
  const count = commandSegments(scriptName).filter(segment => segment === expected).length;
  assert(
    count === 1,
    `${scriptName} should execute ${smokeName} exactly once (found ${count})`,
  );
}

const crossChainSafetySmokes = [
  'smoke:openswan-generic-native-ui-runtime',
  'smoke:browser-dom-snapshot-privacy',
  'smoke:swanbot-v2-terminal-integrity',
];
for (const chainName of [
  'check:swanbot-v2:daily',
  'check:swanbot-v2:release',
  'check:swanbot-chat:daily',
  'check:swanbot-chat:release',
  'smoke:all',
]) {
  for (const smokeName of crossChainSafetySmokes) assertExecutesOnce(chainName, smokeName);
}

for (const smoke of SWANBOT_OPENSWAN_REQUIRED_SMOKES) {
  const smokeName = smoke.command.replace(/^npm run /u, '');
  assert(
    smokeName !== smoke.command && typeof packageScripts[smokeName] === 'string',
    `required readiness smoke ${smoke.id} should resolve to a package.json script`,
  );
}

assertExecutesOnce('smoke:swanbot-openswan-readiness', 'smoke:chat-file-permission-demand');
assertExecutesOnce('smoke:swanbot-v2-edge-fill-schema', 'smoke:browser-credential-schema-parity');
assertExecutesOnce('smoke:computer-app-launch-focus-proof', 'smoke:computer-foreground-ownership');
assertExecutesOnce('smoke:openswan-runtime-approval', 'smoke:chat-plan-tool-manifest');

const dailyGuardSmokes = [
  'smoke:swanbot-v2-batch-policy',
  'smoke:swanbot-v2-client-result-persistence',
  'smoke:swanbot-v2-edge-fill-schema',
  'smoke:browser-locator-actionability',
  'smoke:browser-fill-mutation-gateway',
  'smoke:browser-toggle-runtime-gateway',
  'smoke:browser-select-runtime-gateway',
  'smoke:computer-app-launch-focus-proof',
  'smoke:agent-action-runtime-wiring',
  'smoke:computer-app-semantic-action-runtime',
];
const releaseGuardSmokes = [
  'smoke:event-bound-core',
  'smoke:swanbot-v2-continuation-crypto',
  'smoke:desktop-action-summary-replay',
  'smoke:swanbot-v2-batch-policy',
  'smoke:swanbot-v2-client-result-persistence',
  'smoke:swanbot-v2-edge-fill-schema',
  'smoke:swanbot-v2-thread-identity',
  'smoke:browser-locator-actionability',
  'smoke:browser-wait-scroll-reachability',
  'smoke:browser-fill-mutation-gateway',
  'smoke:browser-toggle-mutation-gateway',
  'smoke:browser-toggle-runtime-gateway',
  'smoke:browser-select-mutation-gateway',
  'smoke:browser-select-runtime-gateway',
  'smoke:computer-app-action-contract',
  'smoke:computer-app-launch-focus-proof',
  'smoke:agent-action-calls',
  'smoke:agent-action-runtime-wiring',
  'smoke:computer-app-semantic-action-proof',
  'smoke:computer-app-semantic-action-runtime',
  'smoke:computer-task-truthful-outcome',
];

for (const chainName of ['check:swanbot-v2:daily', 'check:swanbot-chat:daily']) {
  for (const smokeName of dailyGuardSmokes) assertExecutesOnce(chainName, smokeName);
}
for (const chainName of ['check:swanbot-v2:release', 'check:swanbot-chat:release']) {
  for (const smokeName of releaseGuardSmokes) assertExecutesOnce(chainName, smokeName);
}
assertExecutesOnce('check:swanbot-chat:release', 'smoke:chat-failure-recovery');
assertExecutesOnce('check:swanbot-chat:release', 'smoke:thinking-label-hook-order');
assertExecutesOnce('check:swanbot-chat:release', 'smoke:exact-program-authority');
const authoritySafetySmokes = [
  'smoke:chat-approval-single-use',
  'smoke:openswan-runtime-approval',
  'smoke:computer-app-open-path-runtime',
  'smoke:automation-executor-mutation-guard',
  'smoke:scheduled-action-mutation-guard',
  'smoke:office-terminal-broadcast-authority',
  'smoke:database-authority-guards',
  'smoke:direct-local-file-runtime',
  'smoke:direct-image-conversion-runtime',
  'smoke:computer-task-runtime-context',
];
for (const chainName of [
  'check:swanbot-v2:daily',
  'check:swanbot-v2:release',
  'check:swanbot-chat:daily',
  'check:swanbot-chat:release',
]) {
  for (const smokeName of authoritySafetySmokes) assertExecutesOnce(chainName, smokeName);
}
const chatComputerPolicySmokes = [
  'smoke:computer-task-runtime-context',
  'smoke:computer-use-select-handoff',
  'smoke:computer-use-mutation-handoff',
  'smoke:computer-use-cloud-policy',
];
for (const chainName of ['check:swanbot-chat:daily', 'check:swanbot-chat:release']) {
  for (const smokeName of chatComputerPolicySmokes) assertExecutesOnce(chainName, smokeName);
}
for (const smokeName of new Set([
  ...releaseGuardSmokes,
  ...chatComputerPolicySmokes,
  ...authoritySafetySmokes,
  'smoke:chat-failure-recovery',
])) {
  assertExecutesOnce('smoke:all', smokeName);
}

// ── R16: live tool parity, derived from the actual edge-function source ──
// The expected constants must match the REAL swanbot-v2-ai TOOLS array
// exactly (both directions) so the readiness snapshot can never report
// parity against a stale expectation.
const v2Source = readFileSync(
  join(process.cwd(), 'supabase/functions/swanbot-v2-ai/index.ts'),
  'utf8',
);
const v1Source = readFileSync(
  join(process.cwd(), 'supabase/functions/swanbot-ai/index.ts'),
  'utf8',
);
const derived = deriveSwanbotV2ToolParityFromSource(v2Source);
const migrationPlan = readFileSync(
  join(process.cwd(), 'docs/SWANBOT_V2_MIGRATION_PLAN.md'),
  'utf8',
);
const readinessReportSource = readFileSync(
  join(process.cwd(), 'scripts/swanbot-openswan-readiness-report.ts'),
  'utf8',
);
const productionContractMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260805_openswan_production_readiness_contract.sql'),
  'utf8',
).trim();
const consolidatedAgentSql = readFileSync(
  join(process.cwd(), 'docs/RUN_THIS_SQL.sql'),
  'utf8',
);
const supabaseConfig = readFileSync(
  join(process.cwd(), 'supabase/config.toml'),
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
assert(
  readinessReportSource.includes('telemetryCompleteness: productionTelemetry.completeness'),
  'production readiness report should pass completeness into the shared snapshot',
);
assert(
  readinessReportSource.includes('can_flip_default:'),
  'production readiness report should use the same can_flip_default label as prompt/docs handoff',
);
assert(
  !readinessReportSource.includes('if (!schema.ok) process.exit(2);'),
  'plain production readiness report should stay informational unless fail flags are used',
);
assert(
  readinessReportSource.includes('information_schema type check unavailable'),
  'production readiness report should disclose degraded schema type checks',
);
for (const requiredProductionMarker of [
  "client.rpc('openswan_production_readiness_contract')",
  'buildManagementProductionChecks',
  'buildNetworkProductionChecks',
  'productionContract: {',
  'required: true',
  'values were not read or printed',
  'resolveServiceRoleKey',
  "'--reveal'",
]) {
  assert(
    readinessReportSource.includes(requiredProductionMarker),
    `production readiness report should include ${requiredProductionMarker}`,
  );
}
assert(
  !/console\.(?:log|error|warn)\([^\n]*(?:serviceKey|api_key)/u.test(readinessReportSource),
  'production readiness report must never print a retrieved service-role key',
);
assert(
  consolidatedAgentSql.includes(productionContractMigration),
  'RUN_THIS_SQL.sql section 32 should contain the byte-identical production readiness migration',
);
assert(
  /\[functions\.swanbot-v2-ai\][\s\S]*?verify_jwt\s*=\s*true[\s\S]*?entrypoint\s*=\s*"\.\/functions\/swanbot-v2-ai\/index\.ts"/u.test(supabaseConfig),
  'supabase/config.toml should explicitly pin the SwanBot v2 hosted JWT mode',
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

for (const requiredV1Marker of [
  'async function createSwanBotV1Run',
  'async function completeSwanBotV1Run',
  'async function failSwanBotV1Run',
  'swanBotV1RunId = await createSwanBotV1Run',
  'await completeSwanBotV1Run',
  'await failSwanBotV1Run',
  'version: "swanbot-ai"',
  'final_stop_reason: args.finalStopReason',
  'status = args.finalStopReason === "end_turn" ? "completed" : "failed"',
  'input_tokens: args.usage.input_tokens || 0',
  'cached_tokens: (args.usage.cache_creation_tokens || 0) + (args.usage.cache_read_tokens || 0)',
  'input_tokens: 0',
  'output_tokens: 0',
  'cached_tokens: 0',
  'tool_calls: []',
  'iteration_count: 1',
]) {
  assert(v1Source.includes(requiredV1Marker), `swanbot-ai v1 telemetry baseline is missing marker: ${requiredV1Marker}`);
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
assert(!ready.productionContract.required, 'source-only snapshot should not require live production checks');
assert(!ready.productionContract.checked, 'source-only snapshot should disclose that production was not checked');

const passingProductionChecks: SwanBotOpenSwanProductionContractCheck[] = [
  { id: 'database.contract', label: 'database contract', status: 'pass' },
  { id: 'function.swanbot-ai', label: 'SwanBot v1 deployment', status: 'pass' },
  { id: 'cors.swanbot-ai', label: 'SwanBot v1 CORS', status: 'pass' },
  { id: 'secret.continuation', label: 'continuation secret names', status: 'pass' },
];
const productionReady = buildSwanBotOpenSwanReadinessSnapshot({
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
  productionContract: { required: true, checks: passingProductionChecks },
});
assert(productionReady.status === 'ready', 'passing live production contract should preserve readiness');
assert(productionReady.productionContract.ok, 'passing live production contract should report ok');
assert(productionReady.productionContract.passed === 4, 'production contract should count passed checks');

const productionUnknown = buildSwanBotOpenSwanReadinessSnapshot({
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
  productionContract: {
    required: true,
    checks: [
      ...passingProductionChecks,
      {
        id: 'function.swanbot-v2-ai',
        label: 'SwanBot v2 deployment',
        status: 'unknown',
        recovery: 'Authenticate Supabase CLI and retry.',
      },
    ],
  },
});
assert(productionUnknown.status === 'blocked', 'unknown required production evidence should fail closed');
assert(!productionUnknown.canFlipDefault, 'unknown required production evidence should block default flip');
assert(
  productionUnknown.blockers.some(blocker => blocker.includes('SwanBot v2 deployment') && blocker.includes('no fresh evidence')),
  'unknown production evidence should name the missing live check',
);
assert(
  productionUnknown.nextActions.includes('Authenticate Supabase CLI and retry.'),
  'production blocker should surface its bounded recovery action',
);

const productionNotSupplied = buildSwanBotOpenSwanReadinessSnapshot({
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
  productionContract: { required: true },
});
assert(productionNotSupplied.status === 'blocked', 'required production contract without checks should block');
assert(
  productionNotSupplied.nextActions.some(action => action.includes('authenticated Supabase database and management access')),
  'missing production contract should name the exact evidence recovery',
);

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
assert(watch.warnings.some(warning => warning.includes('Telemetry needs 50 v1 and v2 runs') && warning.includes('v1=120, v2=8')), 'watch should explain telemetry sample gap');

const v1InsufficientTelemetry = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  serverToolCount: EXPECTED_SERVER,
  clientDelegatedToolCount: SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  requiredSmokes: passingSmokes(),
  telemetry: {
    v1RunCount: 4,
    v2RunCount: 90,
    minRuns: 50,
    v1EndTurnRate: 0.91,
    v2EndTurnRate: 0.95,
  },
});

assert(v1InsufficientTelemetry.status === 'watch', 'insufficient v1 baseline should watch, not flip');
assert(!v1InsufficientTelemetry.canFlipDefault, 'insufficient v1 baseline should block default flip');
assert(v1InsufficientTelemetry.telemetry.v1EnoughSamples === false, 'v1 baseline should expose sample readiness');
assert(v1InsufficientTelemetry.telemetry.v2EnoughSamples === true, 'v2 candidate should expose sample readiness');
assert(v1InsufficientTelemetry.warnings.some(warning => warning.includes('v1=4, v2=90')), 'v1 sample gap should name both cohorts');

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

const productionTelemetry = buildSwanBotOpenSwanTelemetryInputFromAgentRunRows([
  { id: 'v1-a', surface: 'main_chat', final_stop_reason: 'end_turn', metadata: { version: 'swanbot-ai' } },
  { id: 'v1-b', surface: 'main_chat', final_stop_reason: 'end_turn', metadata: { version: 'swanbot-ai' } },
  { id: 'v1-c', surface: 'main_chat', final_stop_reason: 'max_tokens', metadata: { version: 'swanbot-ai' } },
  { id: 'v2-a', surface: 'main_chat', final_stop_reason: 'end_turn', metadata: { version: 'swanbot-v2-ai' } },
  { id: 'v2-b', surface: 'main_chat', final_stop_reason: 'max_tokens', metadata: { version: 'swanbot-v2-ai' } },
  { id: 'v2-c', surface: 'main_chat', final_stop_reason: '', metadata: { version: 'swanbot-v2-ai' } },
  { id: 'other-version', surface: 'main_chat', final_stop_reason: 'end_turn', metadata: { version: 'openswan-runtime' } },
  { id: 'other-surface', surface: 'office', final_stop_reason: 'end_turn', metadata: { version: 'swanbot-v2-ai' } },
], { minRuns: 2 });

assert(productionTelemetry.rowsScanned === 8, 'production telemetry should report scanned rows');
assert(productionTelemetry.ignoredRows === 2, 'production telemetry should ignore unrelated version/surface rows');
assert(productionTelemetry.missingFinalStopReason.v1 === 0, 'production telemetry should count missing v1 reasons');
assert(productionTelemetry.missingFinalStopReason.v2 === 1, 'production telemetry should count missing v2 reasons');
assert(productionTelemetry.completeness.v1.missingTokenFields === 3, 'production telemetry should count missing v1 token fields');
assert(productionTelemetry.completeness.v2.missingTokenFields === 3, 'production telemetry should count missing v2 token fields');

const productionSnapshot = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  serverToolCount: EXPECTED_SERVER,
  clientDelegatedToolCount: SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  requiredSmokes: passingSmokes(),
  telemetry: productionTelemetry.telemetry,
  telemetryCompleteness: productionTelemetry.completeness,
});

assert(productionSnapshot.telemetry.v1RunCount === 3, 'production rows: derives v1 run count');
assert(productionSnapshot.telemetry.v2RunCount === 3, 'production rows: derives v2 run count');
assert(productionSnapshot.telemetry.v1EndTurnRate === 2 / 3, 'production rows: derives v1 end-turn rate');
assert(productionSnapshot.telemetry.v2EndTurnRate === 1 / 3, 'production rows: derives v2 end-turn rate');
assert(productionSnapshot.telemetry.v2StopReasons.topNonEndTurnReason === 'max_tokens', 'production rows: preserves top v2 stop reason');
assert(productionSnapshot.telemetry.v2StopReasons.breakdown.some(entry => entry.reason === 'unknown' && entry.count === 1), 'production rows: normalizes empty reason');
assert(productionSnapshot.status === 'blocked', 'production rows: below-baseline v2 stop rate blocks');
assert(productionSnapshot.blockers.some(blocker => blocker.includes('missing final_stop_reason')), 'production rows: missing stop reasons block readiness once');
assert(productionSnapshot.blockers.some(blocker => blocker.includes('missing token fields')), 'production rows: missing token fields block readiness');

const pendingTelemetry = buildSwanBotOpenSwanTelemetryInputFromAgentRunRows([
  {
    id: 'v2-active-pending',
    status: 'running',
    surface: 'main_chat',
    final_stop_reason: 'client_pending',
    metadata: { version: 'swanbot-v2-ai' },
  },
  {
    id: 'v2-active-dispatching',
    status: 'running',
    surface: 'main_chat',
    final_stop_reason: 'client_dispatching',
    metadata: { version: 'swanbot-v2-ai' },
  },
  {
    id: 'v2-active-resuming',
    status: 'running',
    surface: 'main_chat',
    final_stop_reason: 'client_resuming',
    metadata: { version: 'swanbot-v2-ai' },
  },
  {
    id: 'v2-terminal',
    status: 'completed',
    surface: 'main_chat',
    final_stop_reason: 'end_turn',
    tool_calls: [],
    iteration_count: 1,
    input_tokens: 10,
    output_tokens: 2,
    cached_tokens: 0,
    metadata: { version: 'swanbot-v2-ai' },
  },
], { minRuns: 1 });
const pendingV2StopReasons = pendingTelemetry.telemetry.v2StopReasons as Record<string, number>;
assert(pendingTelemetry.rowsScanned === 4, 'pending telemetry should still report scanned rows');
assert(pendingTelemetry.ignoredRows === 3, 'pending telemetry should ignore active pending, dispatch, and claimed-resume rows');
assert(pendingV2StopReasons.end_turn === 1, 'pending telemetry should count only terminal v2 rows');
assert(!pendingV2StopReasons.client_pending, 'pending telemetry should not count active client_pending as terminal readiness evidence');
assert(!pendingV2StopReasons.client_dispatching, 'pending telemetry should not count an active pre-dispatch claim as terminal readiness evidence');
assert(!pendingV2StopReasons.client_resuming, 'pending telemetry should not count an active single-consumer resume claim as terminal evidence');
assert(
  pendingTelemetry.warnings.some(warning => warning.includes('active client_pending')),
  'pending telemetry should warn that active client-pending rows were ignored',
);
assert(
  pendingTelemetry.warnings.some(warning => warning.includes('active client_dispatching')),
  'pending telemetry should warn that active pre-dispatch claims were ignored',
);
assert(
  pendingTelemetry.warnings.some(warning => warning.includes('active client_resuming')),
  'pending telemetry should warn that active continuation claims were ignored',
);

const zeroTokenTelemetry = buildSwanBotOpenSwanTelemetryInputFromAgentRunRows([
  {
    id: 'v2-zero',
    surface: 'main_chat',
    final_stop_reason: 'end_turn',
    tool_calls: [],
    iteration_count: 1,
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    metadata: { version: 'swanbot-v2-ai' },
  },
], { minRuns: 1 });
assert(zeroTokenTelemetry.completeness.v2.zeroTokenRows === 1, 'production telemetry should count zero-token rows');

const completenessOnlyBlocker = buildSwanBotOpenSwanReadinessSnapshot({
  v2ToolCatalogCount: SWANBOT_OPENSWAN_EXPECTED_TOOL_TOTAL,
  serverToolCount: EXPECTED_SERVER,
  clientDelegatedToolCount: SWANBOT_OPENSWAN_EXPECTED_CLIENT_DELEGATED_TOOLS,
  requiredSmokes: passingSmokes(),
  telemetry: {
    minRuns: 1,
    v1StopReasons: { end_turn: 2 },
    v2StopReasons: { end_turn: 2 },
  },
  telemetryCompleteness: {
    v1: { rows: 2, missingTokenFields: 1 },
    v2: { rows: 2, zeroTokenRows: 1 },
  },
});
assert(completenessOnlyBlocker.status === 'blocked', 'readiness should block on incomplete production telemetry');
assert(completenessOnlyBlocker.blockers.some(blocker => blocker.includes('v1 agent_runs telemetry is missing token fields')), 'readiness should name incomplete production telemetry');
assert(completenessOnlyBlocker.warnings.some(warning => warning.includes('zero-token')), 'readiness should warn on zero-token rows');

class FakeSwanBotTelemetryQuery {
  private rows: any[];
  public calls: Array<{ method: string; args: unknown[] }>;
  private filters: Record<string, unknown> = {};

  constructor(rows: any[], calls: Array<{ method: string; args: unknown[] }>) {
    this.rows = rows;
    this.calls = calls;
  }

  select(columns: string) {
    this.calls.push({ method: 'select', args: [columns] });
    return this;
  }

  eq(column: string, value: unknown) {
    this.calls.push({ method: 'eq', args: [column, value] });
    this.filters[column] = value;
    return this;
  }

  gte(column: string, value: unknown) {
    this.calls.push({ method: 'gte', args: [column, value] });
    return this;
  }

  lt(column: string, value: unknown) {
    this.calls.push({ method: 'lt', args: [column, value] });
    return this;
  }

  order(column: string, options?: Record<string, unknown>) {
    this.calls.push({ method: 'order', args: [column, options] });
    return this;
  }

  async range(from: number, to: number) {
    this.calls.push({ method: 'range', args: [from, to] });
    const version = this.filters['metadata->>version'];
    const page = this.rows
      .filter(row => row.metadata?.version === version)
      .slice(from, to + 1);
    return { data: page, error: null };
  }
}

const fakeTelemetryCalls: Array<{ method: string; args: unknown[] }> = [];
const fakeTelemetryRows = [
  {
    id: 'v1-live',
    surface: 'main_chat',
    final_stop_reason: 'end_turn',
    tool_calls: [],
    iteration_count: 1,
    input_tokens: 10,
    output_tokens: 2,
    cached_tokens: 0,
    metadata: { version: 'swanbot-ai' },
  },
  {
    id: 'v2-live',
    surface: 'main_chat',
    final_stop_reason: 'end_turn',
    tool_calls: [],
    iteration_count: 1,
    input_tokens: 11,
    output_tokens: 3,
    cached_tokens: 0,
    metadata: { version: 'swanbot-v2-ai' },
  },
];
const fakeTelemetryClient = {
  from(table: string) {
    fakeTelemetryCalls.push({ method: 'from', args: [table] });
    return new FakeSwanBotTelemetryQuery(fakeTelemetryRows, fakeTelemetryCalls);
  },
};

async function runProductionReaderSmoke(): Promise<void> {
  const loadedProductionTelemetry = await loadSwanBotOpenSwanAgentRunTelemetry({
    circleId: 'circle-1',
    since: '2026-06-01T00:00:00.000Z',
    until: '2026-07-01T00:00:00.000Z',
    pageSize: 10,
    minRuns: 1,
  }, fakeTelemetryClient);

  assert(loadedProductionTelemetry.telemetry.v1StopReasons && !Array.isArray(loadedProductionTelemetry.telemetry.v1StopReasons), 'reader should return v1 stop-reason counts');
  assert(loadedProductionTelemetry.telemetry.v2StopReasons && !Array.isArray(loadedProductionTelemetry.telemetry.v2StopReasons), 'reader should return v2 stop-reason counts');
  assert(loadedProductionTelemetry.completeness.v1.missingToolCalls === 0, 'reader should summarize v1 tool_call completeness');
  assert(loadedProductionTelemetry.completeness.v2.badIterationCount === 0, 'reader should summarize v2 iteration completeness');
  assert(fakeTelemetryCalls.some(call => call.method === 'from' && call.args[0] === 'agent_runs'), 'reader should query agent_runs');
  assert(fakeTelemetryCalls.some(call => call.method === 'select' && String(call.args[0]).includes('final_stop_reason') && String(call.args[0]).includes('metadata')), 'reader should select final_stop_reason and metadata');
  assert(fakeTelemetryCalls.some(call => call.method === 'select' && String(call.args[0]).includes('tool_calls') && String(call.args[0]).includes('iteration_count')), 'reader should select run-summary telemetry columns');
  assert(fakeTelemetryCalls.some(call => call.method === 'select' && String(call.args[0]).includes('input_tokens') && String(call.args[0]).includes('cached_tokens')), 'reader should select token telemetry columns');
  assert(fakeTelemetryCalls.some(call => call.method === 'eq' && call.args[0] === 'metadata->>version' && call.args[1] === 'swanbot-ai'), 'reader should filter v1 metadata version');
  assert(fakeTelemetryCalls.some(call => call.method === 'eq' && call.args[0] === 'metadata->>version' && call.args[1] === 'swanbot-v2-ai'), 'reader should filter v2 metadata version');
  assert(fakeTelemetryCalls.some(call => call.method === 'eq' && call.args[0] === 'surface' && call.args[1] === 'main_chat'), 'reader should filter main chat rows');
  assert(fakeTelemetryCalls.some(call => call.method === 'gte' && call.args[0] === 'started_at'), 'reader should apply since window');
  assert(fakeTelemetryCalls.some(call => call.method === 'lt' && call.args[0] === 'started_at'), 'reader should apply until window');
  assert(fakeTelemetryCalls.some(call => call.method === 'range' && call.args[0] === 0 && call.args[1] === 9), 'reader should paginate');
}

runProductionReaderSmoke()
  .then(() => {
    const promptBlock = formatSwanBotOpenSwanReadinessPromptBlock(ready);

    assert(promptBlock.includes('SwanBot/OpenSwan Readiness'), 'prompt block should have readiness heading');
    assert(promptBlock.includes('can_flip_default: yes'), 'prompt block should expose can_flip_default');
    assert(promptBlock.includes('next_actions:'), 'prompt block should include next actions');

    const diagnosticPromptBlock = formatSwanBotOpenSwanReadinessPromptBlock(stopReasonTelemetry);
    assert(diagnosticPromptBlock.includes('stop_reasons:'), 'prompt block should expose stop reason line');
    assert(diagnosticPromptBlock.includes('max_tokens:11'), 'prompt block should include top v2 stop reason');

    console.log('swanbot-openswan-readiness smoke passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
