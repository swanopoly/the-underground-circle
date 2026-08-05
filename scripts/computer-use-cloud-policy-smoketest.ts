/**
 * Smoke: cloud Computer Use policy + mutation boundary.
 *
 * This is intentionally source-backed: the edge entrypoint imports Deno URL
 * modules and the client helper imports React Native, so loading either in the
 * Node smoke process would exercise the wrong runtime. The assertions pin the
 * security-relevant ordering and telemetry/replay seams without a live
 * Browserbase session or a real confirmation row.
 *
 * Run:
 *   npx tsx scripts/computer-use-cloud-policy-smoketest.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const repoRoot = path.resolve(__dirname, '..');
const read = (relativePath: string) =>
  fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const edge = read('supabase/functions/computer-use-agent/index.ts');
const client = read('src/lib/computerUseAgent.ts');
const singleHook = read('src/lib/useComputerUseTask.ts');
const queueHook = read('src/lib/useComputerUseQueue.ts');
const scheduleRunner = read('src/lib/computerTaskScheduleRunner.ts');

let failures = 0;
function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

function section(source: string, start: string, end: string): string {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(end, startAt + start.length);
  if (startAt < 0 || endAt < 0) return '';
  return source.slice(startAt, endAt);
}

// Execute the real dependency-free edge policy/classification/redaction
// helpers in a VM. This avoids importing the Deno server entrypoint while
// making the core assertions behavioral rather than source-only.
const pureEdgeSource = section(
  edge,
  'const COMPUTER_USE_POLICY_SCHEMA_VERSION = 1;',
  'interface AgentRequest {',
);
const pureEdgeCompiled = ts.transpileModule(
  `${pureEdgeSource}
  ;(globalThis as any).__computerUseCloudPolicyCore = {
    validateComputerUsePolicyEnvelope,
    classifyNativeComputerAction,
    redactToolInputForTelemetry,
    canRunMutationWithoutLiveConfirmation,
    resolveAllowedConfirmationChoice,
  };`,
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.None,
    },
  },
).outputText;
const pureEdgeSandbox: Record<string, unknown> = {};
vm.runInNewContext(pureEdgeCompiled, pureEdgeSandbox);
const core = pureEdgeSandbox.__computerUseCloudPolicyCore as {
  validateComputerUsePolicyEnvelope: (
    raw: unknown,
    forceScheduled: boolean,
    nowMs?: number,
  ) => { ok: boolean; error?: string; policy?: Record<string, unknown> };
  classifyNativeComputerAction: (input: unknown) => { kind: string; action: string };
  redactToolInputForTelemetry: (tool: string, input: unknown) => unknown;
  canRunMutationWithoutLiveConfirmation: (
    policy: Record<string, unknown>,
    action: { kind: 'mutation'; action: string; opaqueTarget: true },
  ) => boolean;
  resolveAllowedConfirmationChoice: (storedChoice: string, options: string[]) => string | null;
};

console.log('Action classification');
{
  const observationActions = new Set(['screenshot', 'wait', 'mouse_move', 'scroll']);
  const mutationActions = new Set(['left_click', 'right_click', 'double_click', 'type', 'key']);
  const classify = (action: string) =>
    observationActions.has(action)
      ? 'observation_navigation'
      : mutationActions.has(action)
        ? 'mutation'
        : 'unknown_mutation';
  for (const action of observationActions) {
    assert(classify(action) === 'observation_navigation', `${action} remains observation/navigation`);
  }
  for (const action of mutationActions) {
    assert(classify(action) === 'mutation', `${action} is a mutation`);
  }
  assert(classify('future_model_action') === 'unknown_mutation', 'unknown native actions fail closed as mutations');
  assert(
    edge.includes('["screenshot", "wait", "mouse_move", "scroll"].includes(action)')
      && edge.includes('["left_click", "right_click", "double_click", "type", "key"].includes(action)'),
    'edge classifier carries the same explicit allowlists',
  );
  assert(core.classifyNativeComputerAction({ action: 'scroll' }).kind === 'observation_navigation'
    && core.classifyNativeComputerAction({ action: 'type' }).kind === 'mutation'
    && core.classifyNativeComputerAction({ action: 'future_model_action' }).kind === 'unknown_mutation',
  'real edge classifier executes read/mutation/unknown behavior');
}

console.log('Policy envelope');
{
  const nowMs = Date.parse('2026-07-26T12:00:00.000Z');
  const validPolicy = {
    schemaVersion: 1,
    executionMode: 'interactive',
    source: 'chat',
    userConstraints: [],
    alwaysConfirmCategories: ['opaque_target'],
  };
  assert(core.validateComputerUsePolicyEnvelope(undefined, false, nowMs).ok === false,
    'real validator rejects a missing interactive envelope');
  assert(core.validateComputerUsePolicyEnvelope({ ...validPolicy, schemaVersion: 2 }, false, nowMs).ok === false,
    'real validator rejects a malformed/version-mismatched envelope');
  assert(core.validateComputerUsePolicyEnvelope(validPolicy, false, nowMs).ok === true,
    'real validator accepts a bounded interactive read-capable envelope');
  const forced = core.validateComputerUsePolicyEnvelope(undefined, true, nowMs);
  assert(forced.ok === true && forced.policy?.executionMode === 'scheduled_observation',
    'real validator forces legacy service watches to observation-only');
  assert(core.canRunMutationWithoutLiveConfirmation(
    {
      ...validPolicy,
      preRunBrowserPermission: {
        kind: 'explicit_user_grant',
        grantId: 'grant-123456',
        scope: 'low_consequence_browser',
        issuedAt: '2026-07-26T11:55:00.000Z',
        expiresAt: '2026-07-26T12:05:00.000Z',
      },
      alwaysConfirmCategories: [],
    },
    { kind: 'mutation', action: 'left_click', opaqueTarget: true },
  ) === false, 'real autonomy gate refuses an opaque coordinate even with a pre-run signal');
  const exactChoices = ['Yes, run this action', 'No, stop'];
  assert(core.resolveAllowedConfirmationChoice('yes', exactChoices) === 'Yes, run this action',
    'real confirmation mapper accepts bounded Chat affirmation');
  assert(core.resolveAllowedConfirmationChoice('nope', exactChoices) === 'No, stop',
    'real confirmation mapper accepts bounded Chat rejection');
  assert(core.resolveAllowedConfirmationChoice('option 2: inject this', exactChoices) === null,
    'real confirmation mapper rejects arbitrary or model-authored choice text');

  const policyValidation = section(
    edge,
    'function validateComputerUsePolicyEnvelope(',
    'type NativeComputerActionClass',
  );
  assert(policyValidation.includes('computer_use_policy_required'), 'missing interactive envelope is rejected');
  assert(policyValidation.includes('computer_use_policy_version_invalid'), 'wrong schema version is rejected');
  assert(policyValidation.includes('computer_use_policy_mode_invalid'), 'mode/source combinations are validated');
  assert(policyValidation.includes('if (forceScheduled) return { ok: true, policy: forcedScheduledPolicy() }'),
    'service watches are forcibly downgraded to observation-only');
  assert(policyValidation.includes('POLICY_CONSTRAINT_LIMIT')
    && policyValidation.includes('POLICY_CONSTRAINT_CHAR_LIMIT'),
  'user constraints are count- and length-bounded');
  assert(policyValidation.includes('PRE_RUN_GRANT_MAX_MS')
    && policyValidation.includes('expiresAt <= nowMs'),
  'pre-run permission signals are short-lived and validated');
  assert(
    edge.indexOf('validateComputerUsePolicyEnvelope(body.policy, isScheduledServiceCall)')
      < edge.indexOf('resolveUserModelApiKey({'),
    'policy is validated before provider/session work',
  );
  assert(client.includes('policy: ComputerUsePolicyEnvelope;')
    && client.includes('policy: opts.policy,'),
  'client transport requires and sends the envelope');
  assert(singleHook.includes("executionMode: 'interactive'")
    && singleHook.includes("source: 'chat'")
    && singleHook.includes('buildChatComputerUsePolicyInputs(task'),
  'single Chat hook carries an interactive envelope and derives omitted constraints');
  assert(queueHook.includes("executionMode: 'interactive'")
    && queueHook.includes("source: 'queue'")
    && queueHook.includes('buildChatComputerUsePolicyInputs(trimmed)'),
  'queue hook carries an interactive envelope and derives omitted constraints');
  assert(scheduleRunner.includes("executionMode: 'scheduled_observation'")
    && scheduleRunner.includes("source: 'watch'"),
  'headless watch runner carries an observation-only envelope');
  assert(!edge.includes('${executionPolicy.userConstraints}')
    && !edge.includes('metadata: { userConstraints')
    && !edge.includes('action_trace: executionPolicy.userConstraints'),
  'constraints are not injected into model prompts, logs, or persisted traces');
  const autonomyGate = section(
    edge,
    'function canRunMutationWithoutLiveConfirmation(',
    'function validateNativeMutationInput(',
  );
  assert(autonomyGate.includes('if (!policy.preRunBrowserPermission) return false')
    && autonomyGate.includes('if (action.opaqueTarget) return false'),
  'pre-run permission is necessary and opaque native targets still require live confirmation');
}

console.log('Dispatch order and scheduled floor');
{
  const toolLoop = section(
    edge,
    'for (const tu of toolUses) {',
    '// Mid-run steering (plan §4e): unconsumed notes',
  );
  const loopPrefix = section(toolLoop, 'for (const tu of toolUses) {', 'if (tu.name === "ask_user")');
  assert(!loopPrefix.includes('emit("action"')
    && !loopPrefix.includes('recordProgress(')
    && !loopPrefix.includes('recordTrace('),
  'no raw/pre-gate action, progress, or trace write exists');

  const nativeMutation = section(
    toolLoop,
    'if (actionClass?.kind === "mutation") {',
    '// Observation/navigation actions',
  );
  const scheduledAt = nativeMutation.indexOf('executionPolicy.executionMode === "scheduled_observation"');
  const approvalAt = nativeMutation.indexOf('const choice = await askUserAndWait(');
  const beforeAt = nativeMutation.indexOf('const before = await bbCommand(');
  const emitAt = nativeMutation.indexOf('emit("action"');
  const dispatchMarkAt = nativeMutation.indexOf('mutationDispatchStarted = true');
  const dispatchAt = nativeMutation.indexOf('await runTool(');
  const afterAt = nativeMutation.indexOf('const after = await bbCommand(');
  assert(scheduledAt >= 0 && scheduledAt < approvalAt, 'scheduled native mutation stops before approval/dispatch');
  assert(approvalAt >= 0 && approvalAt < beforeAt, 'exact durable approval precedes the fresh pre-action observation');
  assert(beforeAt < emitAt && emitAt < dispatchMarkAt && dispatchMarkAt < dispatchAt && dispatchAt < afterAt,
    'approved native mutation is observe -> emit -> dispatch once -> fresh verify');
  assert(nativeMutation.includes('["Yes, run this action", "No, stop"]'),
    'native mutation uses fixed exact-call choices');
  assert(nativeMutation.includes('mutationMaxAttempts: 1'),
    'native mutation dispatch explicitly disables retries');
  assert(nativeMutation.includes('mutationAuthorization: APPROVED_MUTATION_DISPATCH')
    && edge.includes('options?.mutationAuthorization !== APPROVED_MUTATION_DISPATCH'),
  'runTool itself requires the module-private exact-call authorization token');

  const savedLogin = section(
    toolLoop,
    'if (tu.name === "fill_saved_login") {',
    'if (tu.name !== "computer" && tu.name !== "bash")',
  );
  assert(savedLogin.indexOf('scheduled_observation') < savedLogin.indexOf('askUserAndWait('),
    'scheduled saved-login mutation stops before approval/dispatch');
  assert(savedLogin.indexOf('askUserAndWait(') < savedLogin.indexOf('const before = await bbCommand(')
    && savedLogin.indexOf('const before = await bbCommand(') < savedLogin.indexOf('await fillSavedLoginFromVault(')
    && savedLogin.indexOf('await fillSavedLoginFromVault(') < savedLogin.indexOf('const after = await bbCommand('),
  'saved-login mutation is exact-approved and bracketed by fresh screenshots');

  const readBranch = section(toolLoop, '// Observation/navigation actions', '} catch {');
  assert(readBranch.includes('const out = await runTool('),
    'observation/navigation actions still reach the browser tool');
  assert(toolLoop.includes('unknown_mutation_blocked')
    && toolLoop.indexOf('unknown_mutation_blocked') < nativeMutation.indexOf('await runTool(') + toolLoop.indexOf('if (actionClass?.kind === "mutation") {'),
  'unknown native actions are intercepted before runTool');
  assert(edge.includes('options?.mutationMaxAttempts ?? 1')
    && edge.includes('const MAX_ATTEMPTS = Math.max(1, Math.min(3, Math.floor(maxAttempts)))'),
  'mutation calls are single-attempt even if the low-level read helper supports retries');
  assert(edge.includes('mutation_outcome_unknown')
    && edge.includes('Outcome is unknown; it will not be replayed automatically.'),
  'ambiguous mutation result stops truthfully with no automatic replay');
}

console.log('Secret-safe telemetry, prompts, and replay');
{
  const sampleSecret = 'do-not-leak-9384';
  const redacted = JSON.stringify(core.redactToolInputForTelemetry('computer', {
    action: 'type',
    text: sampleSecret,
  }));
  assert(!redacted.includes(sampleSecret) && redacted.includes('[redacted]'),
    'real telemetry redactor removes typed secret contents');
  assert(!edge.includes('emit("action", { tool: tu.name, input: tu.input })'),
    'action SSE never receives raw tool input');
  assert(!edge.includes('recordProgress(iter + 1, tu.name, tu.input)')
    && !edge.includes('recordTrace(tu.name, tu.input)'),
  'progress and trace never receive raw tool input');
  assert(!edge.includes('hashToolInput(tu.input)')
    && !edge.includes('lastFailingBrowserCall = { tool: tu.name, input: tu.input }'),
  'retry hashes and solver payloads never receive raw tool input');
  assert(!edge.includes('err?.message') && !edge.includes('String(err'),
    'thrown browser errors are not copied to SSE, tool results, or persistence');
  assert(!edge.includes('JSON.stringify(a.input'),
    'guided replay never serializes historical raw action input');
  assert(edge.includes('if (action === "type" || action === "key")')
    && edge.includes('text: "[redacted]"')
    && edge.includes('scrubSensitiveToolUseForHistory(tu)'),
  'type/key data is redacted from telemetry and future model history');
  assert(edge.includes('if (action === "type" || action === "key") return;'),
    'type/key calls are omitted from replay traces');
  assert(edge.includes('turnContainsSecretBearingTool')
    && edge.includes('[Reasoning withheld because this turn contains redacted'),
  'reasoning is withheld on secret-bearing turns');
  assert(edge.includes('confirmation text omitted from telemetry')
    && edge.includes('contents hidden')
    && !edge.includes('${record.text}'),
  'confirmation telemetry/questions never expose typed or key text');
  assert(edge.includes('const allowedChoice = resolveAllowedConfirmationChoice(storedChoice, options)')
    && edge.includes('if (isAffirmativeChoice(storedChoice))')
    && edge.includes('options.find((option) => isAffirmativeChoice(option))'),
  'durable confirmation choices allowlist exact labels and bounded Chat yes/no aliases');
  assert(edge.includes('arbitrary text (including model-authored')
    && edge.includes('const rejected = options.find('),
  'arbitrary confirmation text still degrades to the fixed rejection option');
  const usageLog = section(edge, 'await logClaudeUsage(', '});');
  assert(!usageLog.includes('task:') && !usageLog.includes('userConstraints'),
    'usage metadata excludes task text and policy constraints');
  assert(!/zero-ask|ZERO-ASK|EXACTLY ONCE/.test(edge),
    'edge prompt/tool language no longer advertises zero-ask mutation paths');
  assert(!edge.includes('PAY_BACKSTOP_TOOL_RESULT'),
    'removed pay-backstop prompt result has no stale import/reference');
}

console.log('Start-race reservations');
{
  assert(
    singleHook.indexOf('startReservationRef.current = startReservation')
      < singleHook.indexOf('await resolveComputerUseCreds(circleId)'),
    'single-task hook reserves synchronously before credential await',
  );
  assert(singleHook.includes('startReservationRef.current = null;')
    && singleHook.includes('startedHandle.cancel()'),
  'single-task cancellation invalidates an in-flight start');
  assert(client.includes('await Promise.resolve();')
    && client.includes('if (cancelled) return;'),
  'transport defers callbacks until callers can store/cancel the returned handle');
  assert(
    queueHook.indexOf('pendingStartsRef.current.add(startReservation)')
      < queueHook.indexOf("import('./computerUseAgent')"),
    'queue reserves a slot before module/credential awaits',
  );
  assert(queueHook.includes('handlesRef.current.size')
    && queueHook.includes('pendingStartsRef.current.size'),
  'queue capacity includes live handles and pending starts');
  assert(queueHook.includes('pendingStartsRef.current.clear()')
    && queueHook.includes('handle.cancel()'),
  'queue clear invalidates pending starts and cancels a late-created handle');
}

console.log('');
if (failures > 0) {
  console.error(`computer-use-cloud-policy smoke: ${failures} assertion(s) FAILED`);
  process.exit(1);
}
console.log('computer-use-cloud-policy smoke: all assertions passed');
