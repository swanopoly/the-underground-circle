/**
 * Compatibility/source-contract smoke for the original Computer Use select
 * handoff after the lane was generalized to every legacy browser mutation.
 *
 * Run:
 *   /Users/cswanson/.npm/_npx/fd45a72a545557e9/node_modules/.bin/tsx \
 *     scripts/computer-use-select-handoff-smoketest.ts
 */

import { readFileSync } from 'node:fs';

let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function section(
  source: string,
  startMarker: string,
  endMarker: string,
  label: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0, `${label} start marker exists`);
  assert(end > start, `${label} end marker follows its start`);
  return source.slice(start, end);
}

const source = readFileSync('src/lib/computerUse.ts', 'utf8');
const handoffSource = section(
  source,
  'const LEGACY_MUTATION_ACTION_TYPES',
  'function generateId()',
  'general mutation handoff builders',
);

assert(
  handoffSource.includes("select: 'browser.select_option'")
    && handoffSource.includes("kind: 'openswan_typed_tool'")
    && handoffSource.includes("sourceLane: 'legacy_computer_use'")
    && handoffSource.includes("reasonCode: 'sealed_runtime_identity_required'")
    && handoffSource.includes('executable: false')
    && handoffSource.includes('carriesRawInput: false'),
  'select keeps the canonical typed tool in a non-executable, no-raw-input handoff',
);
for (const requirement of [
  'authenticated_user_id',
  'circle_id',
  'persisted_agent_run_id',
  'provider_tool_use_id',
  'tool_iteration',
  'exact_openswan_runtime_approval',
]) {
  assert(
    handoffSource.includes(`'${requirement}'`),
    `select handoff still declares missing sealed-runtime requirement: ${requirement}`,
  );
}
assert(
  handoffSource.includes(
    'export function buildComputerUseSelectRuntimeHandoff(): BrowserActionRuntimeHandoff',
  )
    && handoffSource.includes("return buildComputerUseMutationRuntimeHandoff('select')"),
  'the original select handoff API remains as a compatibility wrapper',
);

const safetySource = section(
  source,
  'function assessBrowserActionSafety(',
  'async function probeBridge()',
  'browser action safety gate',
);
assert(
  safetySource.indexOf('if (isComputerUseMutationActionType(action.type))')
    < safetySource.indexOf('detectAutomationVerificationGate('),
  'select and every mutation fail closed at the first safety boundary',
);
assert(
  safetySource.includes('buildComputerUseMutationRuntimeHandoff(action.type)')
    && safetySource.includes('requiresApproval: false')
    && safetySource.includes('blockedReason: runtimeHandoff.message'),
  'legacy approval cannot turn a select marker into an executable mutation',
);

const plannerSource = section(
  source,
  'export async function planActions(',
  'export async function callPlaywrightMCP(',
  'legacy planner',
);
assert(
  plannerSource.includes('Valid executable read-only types: observe, extract, screenshot, wait')
    && plannerSource.includes(
      'Valid NON-EXECUTABLE mutation handoff markers: navigate, click, fill, select, press_key, scroll',
    ),
  'select is a planner handoff marker and not an executable legacy action',
);
assert(
  plannerSource.includes('browser.select_option')
    && plannerSource.includes('Execution stops visibly at the first marker')
    && plannerSource.includes('normalizeComputerUsePlannedAction(item, index, analyzedIntent)'),
  'planner routes select through the generalized typed-tool handoff normalizer',
);

const hydrationSource = section(
  source,
  'export async function createSessionFromBrowserPlan(',
  'export async function planActions(',
  'saved-plan hydration',
);
assert(
  hydrationSource.includes('normalizeComputerUsePlannedAction(action, index, plan.intent)')
    && hydrationSource.includes('Persisted')
    && hydrationSource.includes('runtimeHandoff/value fields are never trusted or replayed')
    && !hydrationSource.includes('action.runtimeHandoff ||'),
  'saved select actions receive a fresh canonical handoff rather than trusting persisted metadata',
);

const executeSource = section(
  source,
  'export async function executeAction(',
  'export function checkPermission(',
  'legacy action executor',
);
const guardIndex = executeSource.indexOf(
  'if (isComputerUseMutationActionType(action.type))',
);
assert(guardIndex >= 0, 'executor has a generalized mutation entry guard');
for (const laterOperation of [
  'takeScreenshot(session)',
  "session?.backend === 'browserbase_stagehand'",
  'runStagehandSessionCommand(',
  'runLocalBrowserReadAction(',
]) {
  assert(
    guardIndex < executeSource.indexOf(laterOperation),
    `select guard runs before ${laterOperation}`,
  );
}
assert(
  executeSource.includes("status: 'failed'")
    && executeSource.includes('blockedReason: runtimeHandoff.message')
    && executeSource.includes('error: runtimeHandoff.message')
    && executeSource.includes(
      'buildComputerUseMutationRuntimeHandoff(action.type)',
    ),
  'a direct select execution attempt visibly fails with a freshly rebuilt handoff',
);
assert(
  !source.includes('selectOption as localBrowserSelectOption')
    && !source.includes('await localBrowserSelectOption(')
    && !executeSource.includes("case 'select':"),
  'no raw local or Stagehand select dispatch remains',
);

const cardSource = section(
  source,
  'export function toBrowserPlanCardData(',
  '\n}',
  'browser plan-card serialization',
);
assert(
  cardSource.includes('const safeAction = withoutPersistedMutationInput(action)')
    && cardSource.includes('runtimeHandoff: safeAction.runtimeHandoff'),
  'select plan-card serialization preserves only the fresh no-raw-input handoff',
);
assert(
  source.includes('Dropdown selection is blocked in this legacy plan.')
    && source.includes('do not retry it through Computer Use or a raw bridge.'),
  'select plan summary keeps its canonical-runtime recovery instruction',
);

console.log(`computer-use-select-handoff-smoketest: ${assertions} assertions passed`);
