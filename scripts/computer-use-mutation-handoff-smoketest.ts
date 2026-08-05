/**
 * Source/behavior smoke for the sealed typed-tool handoff boundary in legacy
 * Computer Use. The production module imports React Native surfaces and cannot
 * be loaded directly under plain tsx, so this test parses the production-owned
 * action/tool table and exercises its complete mapping while pinning execution
 * ordering and zero raw mutation reachability in source.
 *
 * Run:
 *   /Users/cswanson/.npm/_npx/fd45a72a545557e9/node_modules/.bin/tsx \
 *     scripts/computer-use-mutation-handoff-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function section(
  source: string,
  startMarker: string,
  endMarker: string,
  label: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(start >= 0, `${label} start marker exists`);
  check(end > start, `${label} end marker follows its start`);
  return source.slice(start, end);
}

function count(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const source = readFileSync('src/lib/computerUse.ts', 'utf8');
const expectedTools = {
  navigate: 'browser.open_url',
  click: 'browser.click_role',
  fill: 'browser.fill_field',
  select: 'browser.select_option',
  press_key: 'browser.press_key',
  scroll: 'browser.press_key',
} as const;

const mappingSource = section(
  source,
  'const LEGACY_MUTATION_TOOL_BY_ACTION',
  'const LEGACY_MUTATION_MESSAGE_BY_ACTION',
  'mutation action/tool mapping',
);
const parsedMappings = Object.fromEntries(
  Array.from(
    mappingSource.matchAll(
      /^\s*(navigate|click|fill|select|press_key|scroll):\s*'([^']+)'/gm,
    ),
    (match) => [match[1], match[2]],
  ),
);
check(
  JSON.stringify(parsedMappings) === JSON.stringify(expectedTools),
  'all six legacy mutations map behaviorally to their exact canonical typed tools',
);

const handoffSource = section(
  source,
  'export function buildComputerUseMutationRuntimeHandoff(',
  '/** Compatibility wrapper for the original select-only handoff API. */',
  'general mutation handoff builder',
);
for (const [actionType, tool] of Object.entries(expectedTools)) {
  check(
    parsedMappings[actionType] === tool,
    `${actionType} proposes exact canonical tool ${tool}`,
  );
}
check(
  handoffSource.includes("kind: 'openswan_typed_tool'")
    && handoffSource.includes('legacyActionType: actionType')
    && handoffSource.includes('executable: false')
    && handoffSource.includes('carriesRawInput: false')
    && handoffSource.includes('requiredContext: [...LEGACY_MUTATION_REQUIRED_CONTEXT]'),
  'handoffs are typed, non-executable, carry no raw input, and declare missing sealed context',
);
for (const fabricatedField of [
  'userId:',
  'circleId:',
  'runId:',
  'toolUseId:',
  'iteration:',
  'approvalId:',
]) {
  check(
    !handoffSource.includes(fabricatedField),
    `handoff builder does not fabricate ${fabricatedField.slice(0, -1)}`,
  );
}
check(
  handoffSource.includes("credentialTool: 'browser.fill_credential_field'")
    && source.includes('this handoff carries no raw value'),
  'fill handoff explicitly identifies the vault-backed credential path without carrying a value',
);

const normalizationSource = section(
  source,
  'function withoutPersistedMutationInput(',
  'export async function createSessionFromBrowserPlan(',
  'plan normalization and input redaction',
);
check(
  normalizationSource.includes('if (!isComputerUseMutationActionType(action.type)) return action')
    && normalizationSource.includes('value: undefined')
    && normalizationSource.includes("const isTerminallyBlocked = action.status === 'rejected' || !!action.blockedReason")
    && normalizationSource.includes('runtimeHandoff: isTerminallyBlocked')
    && normalizationSource.includes('? undefined')
    && normalizationSource.includes(': buildComputerUseMutationRuntimeHandoff(action.type)'),
  'every mutation loses raw input; active markers get a fresh handoff while rejected markers prepare none',
);
check(
  normalizationSource.includes('const value = isComputerUseMutationActionType(actionType)')
    && normalizationSource.includes('? undefined')
    && normalizationSource.includes("status: blockedReason ? 'rejected' : 'pending'"),
  'planner normalization makes mutation markers rejected and strips model-authored values',
);

const hydrationSource = section(
  source,
  'export async function createSessionFromBrowserPlan(',
  'export async function planActions(',
  'saved-plan hydration',
);
check(
  hydrationSource.includes('normalizeComputerUsePlannedAction(action, index, plan.intent)')
    && !hydrationSource.includes('action.runtimeHandoff ||')
    && !hydrationSource.includes('value: action.value'),
  'saved plans rebuild handoffs and never trust persisted handoff or value fields',
);

const plannerSource = section(
  source,
  'export async function planActions(',
  'export async function callPlaywrightMCP(',
  'legacy planner',
);
check(
  plannerSource.includes('Valid executable read-only types: observe, extract, screenshot, wait')
    && plannerSource.includes(
      'Valid NON-EXECUTABLE mutation handoff markers: navigate, click, fill, select, press_key, scroll',
    ),
  'planner labels only observe/extract/screenshot/wait executable',
);
check(
  plannerSource.includes('Never include passwords, tokens, credentials, or text-to-enter')
    && plannerSource.includes('typed runtime must re-derive exact arguments')
    && !plannerSource.includes('"value":"user@test.com"'),
  'planner forbids secret-bearing mutation markers and examples',
);
check(
  plannerSource.includes('const planningUserId = optionalPlanText(opts?.userId)')
    && plannerSource.includes('if (planningUserId) {')
    && plannerSource.includes('userId: planningUserId')
    && !plannerSource.includes('00000000-0000-0000-0000-000000000000'),
  'planner uses a real supplied user identity or deterministic fallback planning, never a fabricated user id',
);
check(
  count(plannerSource, 'normalizeComputerUsePlannedAction(') === 2
    && plannerSource.includes('buildPureFallbackBrowserActions(task, analyzedIntent)')
    && plannerSource.includes('.map((action, index) =>'),
  'AI plans and deterministic fallback plans both cross the same handoff normalizer',
);

const executeSource = section(
  source,
  'export async function executeAction(',
  'export function checkPermission(',
  'legacy action executor',
);
const mutationGuard = executeSource.indexOf(
  'if (isComputerUseMutationActionType(action.type))',
);
check(mutationGuard >= 0, 'executeAction has a first-boundary mutation guard');
for (const ioBoundary of [
  'takeScreenshot(session)',
  "session?.backend === 'browserbase_stagehand'",
  'runStagehandSessionCommand(',
  'runLocalBrowserReadAction(',
  'runPlaywrightReadAction(',
]) {
  check(
    mutationGuard < executeSource.indexOf(ioBoundary),
    `executeAction blocks mutations before ${ioBoundary}`,
  );
}
for (const actionType of Object.keys(expectedTools)) {
  check(
    !executeSource.includes(`case '${actionType}':`),
    `executeAction has no raw ${actionType} dispatch case`,
  );
}

const planExecutionSource = section(
  source,
  'export async function executePlan(',
  'export async function describeComputerUsePlan(',
  'plan executor',
);
const planMutationGuard = planExecutionSource.indexOf(
  'if (isComputerUseMutationActionType(action.type))',
);
check(
  planExecutionSource.indexOf(
    'session.actions = session.actions.map(withoutPersistedMutationInput)',
  ) >= 0
    && planExecutionSource.indexOf(
      'session.actions = session.actions.map(withoutPersistedMutationInput)',
    ) < planExecutionSource.indexOf('for (let i = 0; i < session.actions.length; i += 1)')
    && planExecutionSource.indexOf('const rejectedIndex = session.actions.findIndex') >= 0
    && planExecutionSource.indexOf('const rejectedIndex = session.actions.findIndex') < planMutationGuard
    && planMutationGuard >= 0
    && planMutationGuard < planExecutionSource.indexOf(
      "if (action.status === 'completed')",
    )
    && planMutationGuard < planExecutionSource.indexOf('checkPermission(session, action)'),
  'executePlan rejects blocked prerequisites before dispatch, then stops at active mutations even when legacy state says approved/completed',
);
check(
  planExecutionSource.includes('runtimeHandoff: undefined')
    && planExecutionSource.includes("reason: 'action_rejected'")
    && planExecutionSource.indexOf('const rejectedIndex = session.actions.findIndex')
      < planExecutionSource.indexOf('for (let i = 0; i < session.actions.length; i += 1)'),
  'rejected mutations become typed blocked outcomes before handoff preparation or any action callback',
);
check(
  planExecutionSource.includes('const halted = await executeAction(action, session)')
    && planExecutionSource.includes(
      'session.actions.slice(i + 1).map(withoutPersistedMutationInput)',
    )
    && planExecutionSource.includes('onActionComplete(halted, i)'),
  'executePlan exposes the failed handoff and redacts all later mutation values',
);

const stagehandPayloadSource = section(
  source,
  'interface StagehandRunnerPayload',
  'interface StagehandRunnerResponse',
  'Stagehand payload contract',
);
check(
  stagehandPayloadSource.includes(
    "type: Extract<BrowserReadOnlyActionType, 'observe' | 'extract'>",
  ),
  'Stagehand action payload is typed to observe/extract only',
);
const stagehandSource = section(
  source,
  'async function runStagehandSessionCommand(',
  'async function runPlaywrightReadAction(',
  'Stagehand session command',
);
const stagehandGuard = stagehandSource.indexOf("mode === 'action'");
check(
  stagehandGuard >= 0
    && stagehandSource.includes("action.type !== 'observe' && action.type !== 'extract'")
    && stagehandGuard < stagehandSource.indexOf('resolveComputerUseBackend(')
    && stagehandGuard < stagehandSource.indexOf('ensureStagehandSession(session)'),
  'Stagehand rejects mutation-shaped action mode before backend/session/network work',
);
check(
  executeSource.includes("case 'observe':")
    && executeSource.includes("case 'extract':")
    && executeSource.includes("case 'screenshot':")
    && executeSource.includes("case 'wait':"),
  'observe/extract/screenshot/wait behavior remains present',
);

for (const forbiddenRawApi of [
  'localBrowserOpenUrl',
  'localBrowserClickRole',
  'localBrowserFillField',
  'localBrowserPressKey',
  'selectOption as localBrowserSelectOption',
  'await localBrowserSelectOption(',
]) {
  check(
    !source.includes(forbiddenRawApi),
    `raw mutation API is unreachable: ${forbiddenRawApi}`,
  );
}
check(
  source.includes('domSnapshot as localBrowserDomSnapshot')
    && source.includes('screenshot as localBrowserScreenshot')
    && source.includes('mcp__playwright__browser_snapshot')
    && source.includes('mcp__playwright__browser_take_screenshot'),
  'read-only local/MCP observation paths remain available',
);

const persistenceSource = section(
  source,
  'export function toBrowserSessionRecord(',
  '\n}',
  'session persistence',
);
const cardSource = section(
  source,
  'export function toBrowserPlanCardData(',
  '\n}',
  'plan-card persistence',
);
check(
  persistenceSource.includes('actions: session.actions.map(withoutPersistedMutationInput)')
    && cardSource.includes('const safeAction = withoutPersistedMutationInput(action)')
    && cardSource.includes('value: safeAction.value'),
  'session and plan-card persistence both pass through mutation-value redaction',
);

console.log(`computer-use-mutation-handoff-smoketest: ${assertions} assertions passed`);
