/**
 * Focused executable + source smoke for the SwanBot v2 typed batch policy seam.
 *
 * The runtime module is React-Native/Supabase-tainted, so this smoke pins the
 * integration source without importing it. The zero-dependency flag module is
 * loaded normally to prove the rollout default remains OFF.
 *
 * Run:
 *   npx tsx scripts/swanbot-v2-batch-policy-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  normalizeClientLoopFlagValue,
  isSwanbotV2ClientLoopEnabled,
} from '../src/lib/swanbotV2ClientLoopFlag';
import {
  authorizeSwanbotV2EdgeClientToolCall,
  createSwanbotV2BatchToolResultStopGuard,
  createSwanbotV2BatchToolConstraintGuard,
  detectSwanbotV2BatchStopCondition,
  didSwanbotV2BatchEnterToolHandler,
  mergeSwanbotV2BatchUserConstraints,
} from '../src/lib/swanbotV2BatchPolicy';
import type { AgentEvent, AgentRoundToolResult } from '../src/lib/agentExecutionCore';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const batchSource = readFileSync(
  join(repoRoot, 'src/lib/swanbotV2BatchRuntime.ts'),
  'utf8',
);
const policySource = readFileSync(
  join(repoRoot, 'src/lib/swanbotV2BatchPolicy.ts'),
  'utf8',
);
const swanbotSource = readFileSync(join(repoRoot, 'src/lib/swanbot.ts'), 'utf8');
const flagSource = readFileSync(
  join(repoRoot, 'src/lib/swanbotV2ClientLoopFlag.ts'),
  'utf8',
);

let passes = 0;
let failures = 0;

function assert(condition: unknown, label: string): void {
  if (condition) {
    passes += 1;
    return;
  }
  failures += 1;
  console.error(`FAIL: ${label}`);
}

function includes(source: string, fragment: string, label: string): void {
  assert(source.includes(fragment), label);
}

// ── Universal constraint/floor guard ────────────────────────────────────────
includes(
  policySource,
  'export function createSwanbotV2BatchToolConstraintGuard',
  'pure policy module exports the focused typed-core constraint guard',
);
includes(
  policySource,
  'constraintBlocksToolCall(context.userConstraints, toolName, input)',
  'guard checks user-forbidden constraints against every requested tool call',
);
includes(
  policySource,
  'forbidden: context.userConstraints.approvalBefore',
  'ask-before categories are converted into a step matcher',
);
includes(
  policySource,
  'requireApproval: true',
  'ask-before and always-confirm matches fail closed without an approval gate',
);
includes(
  policySource,
  'context.runtimeApprovalToolNames?.has(toolName) === true',
  'always-confirm floor can defer only to a named canonical runtime approval boundary',
);
includes(
  policySource,
  'isSwanbotV2DeferredFloorClientMutation(toolName)',
  'turn-level floors guard opaque client mutations even when their arguments are bland',
);
includes(
  batchSource,
  'const parsedConstraintInputs = resolveChatComputerConstraintInputs(message)',
  'runtime derives policy inputs from the original turn itself',
);
includes(
  batchSource,
  'runWithTransientRetry<unknown>',
  'typed batch relay retries transient 5xx/network failures before ending the tool loop',
);
includes(
  batchSource,
  'retryable: isRetryableInvokeError(res.error)',
  'typed batch relay distinguishes transient failures from structural failures',
);
includes(
  batchSource,
  "filter((toolName) => toolParallelPolicyProvider(toolName)?.approvalMode === 'ask')",
  'runtime approval deferral is derived from the canonical catalog policy',
);
includes(
  swanbotSource,
  'if (forceClientToolLoop || isSwanbotV2ClientLoopEnabled())',
  'computer tasks can require the canonical client tool loop independent of the rollout flag',
);
includes(
  swanbotSource,
  'isSwanbotV2Enabled() || forceClientToolLoop',
  'required computer tool turns cannot be routed around by the v2 preference flag',
);
includes(
  swanbotSource,
  'It was not replayed through the text-only fallback.',
  'required computer tool turns fail visibly instead of replaying through v1 text chat',
);
includes(
  batchSource,
  'const userConstraints = mergeSwanbotV2BatchUserConstraints(',
  'upstream policy context is unioned instead of replacing parsed constraints',
);
includes(
  batchSource,
  '...(extra.alwaysConfirmFloor || [])',
  'upstream always-confirm categories are preserved alongside parsed floor',
);
includes(
  batchSource,
  'userConstraints,',
  'merged constraints propagate into the canonical OpenSwan tool context',
);

// Execute the actual pure guard. Source presence alone cannot prove that
// forbidden/ask-before/floor branches return the intended core verdict.
const parsedConstraints = {
  forbidden: ['submit'] as const,
  approvalBefore: ['delete'] as const,
  stopConditions: ['captcha'],
  sourcePhrases: ['do not submit', 'ask before deleting'],
};
const suppliedConstraints = {
  forbidden: ['publish'] as const,
  approvalBefore: ['pay'] as const,
  stopConditions: ['mfa'],
  sourcePhrases: ['never publish', 'ask before paying'],
};
const merged = mergeSwanbotV2BatchUserConstraints(
  parsedConstraints as any,
  suppliedConstraints as any,
);
assert(
  merged?.forbidden.join(',') === 'submit,publish'
    && merged.approvalBefore.join(',') === 'delete,pay',
  'constraint merge is additive and deterministic',
);
assert(
  merged?.stopConditions.join(',') === 'captcha,mfa',
  'constraint merge preserves upstream and turn-derived stop conditions',
);

// A handler-entry bit, not request intent, controls whether falling back to v1
// could duplicate an outcome-unknown side effect.
const resultEvent = (
  dispatched: boolean | undefined,
  toolUseId: string,
): AgentEvent => ({
  kind: 'tool_call_result',
  iteration: 1,
  toolName: 'desktop.click',
  toolUseId,
  result: { ok: false, error: 'blocked' },
  durationMs: 0,
  ...(dispatched === undefined ? {} : { dispatched }),
});
assert(
  didSwanbotV2BatchEnterToolHandler({
    kind: 'tool_call_start',
    iteration: 1,
    toolName: 'desktop.click',
    toolUseId: 'requested',
    input: {},
  }) === false,
  'tool_call_start does not prove handler entry',
);
assert(
  didSwanbotV2BatchEnterToolHandler(resultEvent(false, 'rejected')) === false,
  'policy-rejected result does not suppress harmless v1 fallback',
);
assert(
  didSwanbotV2BatchEnterToolHandler(resultEvent(undefined, 'legacy')) === false,
  'legacy result without an authoritative dispatch bit does not suppress fallback',
);
assert(
  didSwanbotV2BatchEnterToolHandler(resultEvent(true, 'entered')) === true,
  'literal dispatched=true proves handler entry and suppresses duplicate fallback',
);

// Merged stop conditions are executable against each metadata-stripped tool
// result before the next same-turn handler, not merely copied into prompt.
const roundResult = (resultText: string, toolUseId = 'observe-1'): AgentRoundToolResult => ({
  toolName: 'browser.dom_snapshot',
  toolUseId,
  ok: true,
  resultText,
  input: {},
});
assert(
  detectSwanbotV2BatchStopCondition(
    merged?.stopConditions || [],
    [roundResult('Page state: CAPTCHA challenge requires human verification.')],
  )?.condition === 'captcha',
  'captcha evidence matches the merged user stop condition',
);
assert(
  detectSwanbotV2BatchStopCondition(
    merged?.stopConditions || [],
    [roundResult('Authentication status: two-factor authentication required.')],
  )?.condition === 'mfa',
  'two-factor evidence matches the normalized MFA stop condition',
);
assert(
  detectSwanbotV2BatchStopCondition(
    merged?.stopConditions || [],
    [roundResult('No captcha is present; MFA required: false.')],
  ) === null,
  'explicit negative evidence does not trigger a false stop',
);
assert(
  detectSwanbotV2BatchStopCondition(
    ['captcha'],
    [{
      ...roundResult('summarized head and tail without the middle signal'),
      enforcementText: `${'safe '.repeat(6_000)}CAPTCHA challenge detected${' safe'.repeat(6_000)}`,
    }],
  )?.condition === 'captcha',
  'pre-summary enforcement text prevents oversized middle-content bypass',
);
assert(
  detectSwanbotV2BatchStopCondition(
    ['error'],
    [{ ...roundResult('ERROR — bridge request failed.'), ok: false }],
  )?.condition === 'error',
  'a user stop-on-error constraint matches a failed tool result',
);
const matchedResult = roundResult('CAPTCHA detected');
const stopGuard = createSwanbotV2BatchToolResultStopGuard(merged?.stopConditions);
const stopVerdict = stopGuard?.({
  iteration: 1,
  maxIterations: 5,
  latestToolResult: matchedResult,
  completedToolResults: [matchedResult],
});
assert(
  !stopVerdict || typeof (stopVerdict as Promise<unknown>).then !== 'function',
  'batch stop guard returns synchronously',
);
assert(
  !!stopVerdict
    && (stopVerdict as Exclude<typeof stopVerdict, Promise<unknown>>)?.stop === true
    && (stopVerdict as Exclude<typeof stopVerdict, Promise<unknown>> & { responseText?: string }).responseText?.includes('did not continue') === true,
  'per-result guard returns an explicit user-facing stop verdict',
);
assert(
  createSwanbotV2BatchToolResultStopGuard([]) === undefined,
  'no user stop conditions preserves legacy loop behavior with no hook',
);

const callGuard = (
  hasApprovalGate: boolean,
  toolName: string,
  input: unknown,
  runtimeApprovalToolNames?: ReadonlySet<string>,
) => {
  const verdict = createSwanbotV2BatchToolConstraintGuard({
    userConstraints: merged,
    alwaysConfirmFloor: ['pay'],
    hasApprovalGate,
    runtimeApprovalToolNames,
  })({
    toolName,
    toolUseId: 'tool-use-1',
    input,
    iteration: 0,
  });
  assert(
    !verdict || typeof (verdict as Promise<unknown>).then !== 'function',
    'pure batch guard returns synchronously',
  );
  return verdict as Exclude<typeof verdict, Promise<unknown>>;
};

const forbidden = callGuard(false, 'browser.submit_form', {});
assert(forbidden?.block === true, 'forbidden action hard-blocks without a gate');
const forbiddenWithGate = callGuard(true, 'browser.submit_form', {});
assert(forbiddenWithGate?.block === true, 'forbidden action still hard-blocks with a gate');
const askBefore = callGuard(false, 'desktop.file_delete', { path: '/tmp/draft' });
assert(askBefore?.requireApproval === true, 'ask-before action fails closed without a gate');
const askBeforeWithGate = callGuard(true, 'desktop.file_delete', { path: '/tmp/draft' });
assert(askBeforeWithGate === undefined, 'ask-before action proceeds only to the live approval gate');
const floor = callGuard(false, 'browser.click_role', { name: 'Buy now' });
assert(floor?.requireApproval === true, 'always-confirm floor fails closed without a gate');
const floorWithGate = callGuard(true, 'browser.click_role', { name: 'Buy now' });
assert(floorWithGate === undefined, 'always-confirm floor proceeds only to the live approval gate');
const floorWithRuntimeBoundary = callGuard(
  false,
  'browser.click_role',
  { name: 'Buy now' },
  new Set(['browser.click_role']),
);
assert(
  floorWithRuntimeBoundary === undefined,
  'always-confirm floor can reach the canonical durable exact-call approval boundary',
);
const floorWithUnrelatedRuntimeBoundary = callGuard(
  false,
  'browser.click_role',
  { name: 'Buy now' },
  new Set(['desktop.launch_app']),
);
assert(
  floorWithUnrelatedRuntimeBoundary?.requireApproval === true,
  'an unrelated runtime approval tool cannot widen the current call',
);
const forbiddenWithRuntimeBoundary = callGuard(
  false,
  'browser.submit_form',
  {},
  new Set(['browser.submit_form']),
);
assert(
  forbiddenWithRuntimeBoundary?.block === true,
  'hard prohibition still wins over a canonical runtime approval boundary',
);
const blandFloor = callGuard(false, 'browser.press_key', { combo: 'Enter' });
assert(
  blandFloor?.requireApproval === true,
  'turn-level pay floor fails closed for a bland Enter mutation without a gate',
);
const blandFloorWithGate = callGuard(true, 'browser.press_key', { combo: 'Enter' });
assert(
  blandFloorWithGate === undefined,
  'bland Enter mutation proceeds only to a genuine exact-call review gate',
);
const futureOpaqueMutation = callGuard(false, 'browser.future_mutation', {});
assert(
  futureOpaqueMutation?.requireApproval === true,
  'unknown future browser mutations fail closed under an existing turn floor',
);
const neutral = callGuard(false, 'browser.dom_snapshot', {});
assert(neutral === undefined, 'neutral read remains allowed without an approval gate');
const neutralPlanner = callGuard(false, 'browser.plan_task', {});
assert(neutralPlanner === undefined, 'read-only browser planning remains available under a turn floor');

// The default edge continuation consumes the same policy through an executable
// helper, including the real async review callback and fail-closed exceptions.
const edgeAuthorizationAssertions = (async () => {
const edgeCall = {
  toolName: 'browser.dom_snapshot',
  toolUseId: 'edge-tool-1',
  input: {},
  iteration: 1,
};
const edgeNeutral = await authorizeSwanbotV2EdgeClientToolCall(
  { userConstraints: null, alwaysConfirmFloor: [] },
  edgeCall,
);
assert(edgeNeutral.allowed === true, 'default edge helper permits a neutral read without a review gate');

const edgeFloor = await authorizeSwanbotV2EdgeClientToolCall(
  { userConstraints: null, alwaysConfirmFloor: ['pay'] },
  { ...edgeCall, toolName: 'browser.click_role', input: { name: 'Buy now' } },
);
assert(
  edgeFloor.allowed === false && edgeFloor.kind === 'approval_required',
  'default edge helper fails closed on an always-confirm call without a review gate',
);

const edgeBlandFloor = await authorizeSwanbotV2EdgeClientToolCall(
  { userConstraints: null, alwaysConfirmFloor: ['pay'] },
  { ...edgeCall, toolName: 'browser.press_key', input: { combo: 'Enter' } },
);
assert(
  edgeBlandFloor.allowed === false && edgeBlandFloor.kind === 'approval_required',
  'default edge helper blocks pay plus bland Enter before handler entry when no gate exists',
);

let exactFloorReviewCalls = 0;
const edgeBlandFloorApproved = await authorizeSwanbotV2EdgeClientToolCall(
  {
    userConstraints: null,
    alwaysConfirmFloor: ['pay'],
    toolApprovalGate: async ({ name, input }) => {
      exactFloorReviewCalls += 1;
      return name === 'browser.press_key'
        && (input as { combo?: string }).combo === 'Enter'
        ? 'approve'
        : 'reject';
    },
  },
  { ...edgeCall, toolName: 'browser.press_key', input: { combo: 'Enter' } },
);
assert(
  edgeBlandFloorApproved.allowed === true && exactFloorReviewCalls === 1,
  'genuine exact review can admit the intended bland floor call without fabricating approval',
);

let edgeGateCalls = 0;
const edgeForbidden = await authorizeSwanbotV2EdgeClientToolCall(
  {
    userConstraints: merged,
    alwaysConfirmFloor: [],
    toolApprovalGate: async () => {
      edgeGateCalls += 1;
      return 'approve';
    },
  },
  { ...edgeCall, toolName: 'browser.submit_form' },
);
assert(
  edgeForbidden.allowed === false && edgeForbidden.kind === 'constraint' && edgeGateCalls === 0,
  'hard constraints block before the default edge review callback is invoked',
);

const edgeApproved = await authorizeSwanbotV2EdgeClientToolCall(
  {
    userConstraints: null,
    alwaysConfirmFloor: [],
    toolApprovalGate: async ({ name, input }) => {
      edgeGateCalls += 1;
      return name === 'browser.fill_field' && (input as { text?: string }).text === 'draft'
        ? 'approve'
        : 'reject';
    },
  },
  { ...edgeCall, toolName: 'browser.fill_field', input: { text: 'draft' } },
);
assert(edgeApproved.allowed === true && edgeGateCalls === 1, 'exact approved edge call reaches the handler seam once');

const edgeRejected = await authorizeSwanbotV2EdgeClientToolCall(
  {
    userConstraints: null,
    alwaysConfirmFloor: [],
    toolApprovalGate: async () => 'reject',
  },
  edgeCall,
);
assert(
  edgeRejected.allowed === false && edgeRejected.kind === 'rejected',
  'default edge review rejection is non-dispatching',
);

const edgeGateError = await authorizeSwanbotV2EdgeClientToolCall(
  {
    userConstraints: null,
    alwaysConfirmFloor: [],
    toolApprovalGate: async () => {
      throw new Error('review UI closed');
    },
  },
  edgeCall,
);
assert(
  edgeGateError.allowed === false && edgeGateError.kind === 'rejected',
  'default edge review callback exceptions fail closed',
);
})();

// ── runAgent approval/policy/context seam ───────────────────────────────────
const runAgentStart = batchSource.indexOf('const runResult = await runAgent({');
const runAgentEnd = batchSource.indexOf('\n    });', runAgentStart);
const runAgentBlock =
  runAgentStart >= 0 && runAgentEnd > runAgentStart
    ? batchSource.slice(runAgentStart, runAgentEnd)
    : '';
assert(runAgentBlock.length > 0, 'found the typed batch runAgent call');
includes(
  runAgentBlock,
  'toolConstraintGuard,',
  'runAgent receives the universal constraint guard',
);
includes(
  runAgentBlock,
  'toolApprovalGate,',
  'runAgent receives the explicit approval gate seam',
);
includes(
  runAgentBlock,
  'toolResultStopGuard,',
  'runAgent receives executable inter-call stop-condition enforcement',
);
includes(
  runAgentBlock,
  'session: {',
  'runAgent receives explicit circle/run/thread session context',
);
assert(
  runAgentBlock.indexOf('toolConstraintGuard,') <
    runAgentBlock.indexOf('toolApprovalGate,'),
  'source mirrors core ordering: constraint guard before approval gate',
);
includes(
  batchSource,
  'createLegacyApprovalGateAdapter(extra.toolApprovalGate)',
  'legacy review gate is adapted through the existing fail-closed adapter',
);
includes(
  batchSource,
  'createSwanbotV2BatchToolResultStopGuard(',
  'runtime builds the per-result guard from merged user constraints',
);
includes(
  batchSource,
  'userConstraints?.stopConditions',
  'runtime supplies the merged stop-condition list to the per-result guard',
);
includes(
  batchSource,
  'const catalog = getOpenSwanToolsForSurface(V2_BATCH_RUN_SURFACE, toolCtx, { mode })',
  'guarded tool set comes from the complete canonical main-chat catalog',
);

// Focused fallback wiring: only the pure literal-dispatch predicate may set the
// side-effect latch. Request-start telemetry is intentionally insufficient.
includes(
  batchSource,
  'if (didSwanbotV2BatchEnterToolHandler(event))',
  'batch fallback suppression is wired to authoritative handler-entry semantics',
);
assert(
  !/event\.kind\s*===\s*['"]tool_call_start['"][^{]{0,80}anyToolExecuted\s*=\s*true/s.test(batchSource),
  'tool_call_start cannot suppress v1 fallback',
);
includes(
  batchSource,
  'Math.min(\n    V2_BATCH_MAX_ITERATIONS,',
  'caller iteration overrides are capped at the canonical edge budget',
);
includes(
  batchSource,
  'Number.isFinite(extra.maxIterations)',
  'invalid or infinite iteration overrides fall back to the canonical budget',
);

// ── SwanBot call-site propagation ───────────────────────────────────────────
for (const field of [
  'threadId',
  'activePluginIds',
  'signal',
  'toolApprovalGate',
  'userConstraints',
  'alwaysConfirmFloor',
]) {
  includes(
    swanbotSource,
    field === 'userConstraints'
      ? 'userConstraints: mergedUserConstraints'
      : field === 'alwaysConfirmFloor'
        ? 'alwaysConfirmFloor: mergedAlwaysConfirmFloor'
        : `${field}: clientLoopContext?.${field}`,
    `callSwanBotV2 forwards ${field} into the batch runtime`,
  );
  includes(
    swanbotSource,
    `${field}: enrichedContext.${field}`,
    `SwanBot context forwards ${field} into callSwanBotAI`,
  );
}
includes(
  swanbotSource,
  'onActivity: (row) => emitSwanBotActivity(row.label)',
  'typed loop activity is propagated to the existing Chat progress sink',
);

// ── Default edge continuation parity ────────────────────────────────────────
includes(
  swanbotSource,
  'const mergedUserConstraints = mergeSwanbotV2BatchUserConstraints(',
  'default and typed v2 paths share non-erasable merged user constraints',
);
includes(
  swanbotSource,
  'toolApprovalGate: clientLoopContext?.toolApprovalGate,',
  'default edge continuation receives the live exact-call approval callback',
);
includes(
  swanbotSource,
  'userConstraints: mergedUserConstraints,',
  'default edge continuation receives merged user constraints',
);
includes(
  swanbotSource,
  'alwaysConfirmFloor: mergedAlwaysConfirmFloor,',
  'default edge continuation receives the merged always-confirm floor',
);

const clientDispatchStart = swanbotSource.indexOf('async function executeClientToolCalls(');
const clientDispatchEnd = swanbotSource.indexOf('type SwanBotClientToolReceiptPrimitive', clientDispatchStart);
const clientDispatchSource = swanbotSource.slice(clientDispatchStart, clientDispatchEnd);
const authorizationIndex = clientDispatchSource.indexOf(
  'const authorization = await authorizeSwanbotV2EdgeClientToolCall(',
);
const handlerEntryIndex = clientDispatchSource.indexOf('const result = await dispatchOneClientTool(');
assert(clientDispatchStart >= 0 && clientDispatchEnd > clientDispatchStart, 'default edge client dispatcher source is bounded');
assert(
  authorizationIndex >= 0 && handlerEntryIndex > authorizationIndex,
  'executable hard-constraint/review authorization runs before client handler entry',
);
includes(
  policySource,
  'This tool call was not performed because the pre-dispatch policy check failed closed.',
  'default edge constraint exceptions fail closed',
);
includes(
  policySource,
  'User declined this exact tool call. It was not performed.',
  'default edge approval rejection is explicit and non-dispatching',
);
const edgePolicyStart = policySource.indexOf('export async function authorizeSwanbotV2EdgeClientToolCall(');
const edgePolicySource = policySource.slice(edgePolicyStart);
assert(
  edgePolicySource.indexOf('verdict = await guard(call)')
    < edgePolicySource.indexOf('decision = await context.toolApprovalGate({'),
  'default edge authorization evaluates hard policy before asking for exact-call review',
);
includes(
  clientDispatchSource,
  'partition.groups.flat().map((call) => [call])',
  'live approval prompts force sequential exact-call dispatch',
);

const oneClientToolStart = swanbotSource.indexOf('async function dispatchOneClientTool(');
const codingClientToolStart = swanbotSource.indexOf('async function dispatchCodingClientTool(');
const codingClientToolEnd = swanbotSource.indexOf(
  'function chunkSwanBotClientToolText(',
  codingClientToolStart,
);
const codingClientToolSource = swanbotSource.slice(
  codingClientToolStart,
  codingClientToolEnd,
);
includes(
  codingClientToolSource,
  'userConstraints: context?.userConstraints || null,',
  'sealed client mutations preserve hard user constraints at the OpenSwan runtime chokepoint',
);
includes(
  codingClientToolSource,
  'alwaysConfirmFloor: context?.alwaysConfirmFloor || [],',
  'sealed client mutations preserve the turn-level floor at the OpenSwan runtime chokepoint',
);
const rawDesktopFallback = swanbotSource.indexOf(
  'const desktopResult = await dispatchSwanBotDesktopClientTool',
  oneClientToolStart,
);
const sealedClientGatewaySource = swanbotSource.slice(oneClientToolStart, rawDesktopFallback);
for (const toolName of [
  'browser.open_url',
  'browser.fill_field',
  'browser.fill_credential_field',
  'browser.set_toggle',
  'browser.select_option',
  'browser.click_role',
  'browser.press_key',
  'desktop.launch_app',
  'desktop.focus_app',
  'desktop.type_text',
  'desktop.paste_text',
  'desktop.press_keys',
  'desktop.menu_click',
  'desktop.run_applescript',
  'desktop.convert_image',
  'desktop.open_url',
  'desktop.open_path',
  'desktop.click_at',
  'desktop.mouse_move',
  'desktop.mouse_click',
  'desktop.mouse_down',
  'desktop.mouse_up',
  'desktop.mouse_drag',
  'desktop.mouse_scroll',
  'desktop.click_element',
  'desktop.set_element_value',
]) {
  includes(
    sealedClientGatewaySource,
    `case '${toolName}':`,
    `${toolName} enters the canonical OpenSwan runtime before any raw bridge fallback`,
  );
}

// ── Telemetry-gated rollout default ─────────────────────────────────────────
assert(normalizeClientLoopFlagValue(null) === false, 'absent flag defaults OFF');
assert(normalizeClientLoopFlagValue('false') === false, 'explicit false stays OFF');
assert(normalizeClientLoopFlagValue('true') === true, 'exact canary opt-in stays available');

const previousStorage = (globalThis as { localStorage?: Storage }).localStorage;
try {
  delete (globalThis as { localStorage?: Storage }).localStorage;
  assert(
    isSwanbotV2ClientLoopEnabled() === false,
    'runtime without localStorage routes to the edge by default',
  );
} finally {
  if (previousStorage) {
    (globalThis as { localStorage?: Storage }).localStorage = previousStorage;
  }
}
includes(
  flagSource,
  'production telemetry/readiness gate explicitly authorizes a later default',
  'flag source documents telemetry as the global default-flip gate',
);
assert(
  !/return\s+raw\s*!==\s*['"]false['"]/.test(flagSource),
  'client-loop flag did not drift to an opt-out/default-on normalizer',
);

void edgeAuthorizationAssertions
  .then(() => {
    console.log(
      `swanbot-v2 batch policy smoke: ${passes} passed, ${failures} failed`,
    );
    if (failures > 0) process.exit(1);
  })
  .catch((error) => {
    console.error('FAIL: executable default-edge authorization assertions threw', error);
    process.exit(1);
  });
