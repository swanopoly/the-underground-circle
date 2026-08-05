/**
 * Source-contract smoke for the OpenSwan durable action-call integration.
 *
 * This pins the runtime boundary that composes:
 *   computerAppGrounding authorization/sealing
 *     -> durable claim/start
 *     -> browser handler
 *     -> fresh proof
 *     -> durable verified/outcome_unknown finish.
 *
 * Run:
 *   npx tsx scripts/agent-action-runtime-wiring-smoketest.ts
 */

import { readFileSync } from 'node:fs';

let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
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

const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');

const leaseSource = section(
  runtimeSource,
  'type DurableAgentActionLease = {',
  'type DurableComputerAppDispatchResult',
  'durable action lease',
);
const claimSource = section(
  runtimeSource,
  'async function claimDurableAgentAction(',
  'async function finishDurableAgentAction(',
  'durable claim helper',
);
const finishSource = section(
  runtimeSource,
  'async function finishDurableAgentAction(',
  'async function dispatchDurableComputerAppMutation',
  'durable finish helper',
);
const dispatchSource = section(
  runtimeSource,
  'async function dispatchDurableComputerAppMutation',
  'async function executeGuardedBrowserFill(',
  'durable dispatch wrapper',
);
const fillSource = section(
  runtimeSource,
  'async function executeGuardedBrowserFill(',
  'async function executeGuardedBrowserToggle(',
  'guarded browser fill',
);
const toggleSource = section(
  runtimeSource,
  'async function executeGuardedBrowserToggle(',
  'async function executeGuardedBrowserSelect(',
  'guarded browser toggle',
);
const selectSource = section(
  runtimeSource,
  'async function executeGuardedBrowserSelect(',
  'function hasExactOpenSwanRuntimeCallIdentity(',
  'guarded browser select',
);

const compactLease = compact(leaseSource);
const compactClaim = compact(claimSource);
const compactFinish = compact(finishSource);
const compactDispatch = compact(dispatchSource);

assert(
  compactClaim.includes(
    'buildAgentActionCallIdentity( { userId: context.userId, circleId: context.circleId, runId: String(context.runId || \'\'), toolUseId: String(context.toolUseId || \'\'), action, authorization, }, { fingerprintContractBinding: buildComputerAppToolArgsFingerprintAsync }, )',
  ),
  'durable identity binds the authenticated user/circle/run/provider-call/action/authorization and hashes the exact contract binding',
);
assert(
  compactClaim.includes('const store = createAgentActionCallStore( supabase as unknown as AgentActionCallsRpcClient, )'),
  'runtime creates the durable store over the authenticated Supabase RPC client',
);
assert(
  compactClaim.includes('identity: identityResult.value')
    && compactClaim.includes('ttlSeconds: 120')
    && compactClaim.includes("source: 'openswan_tool_runtime'"),
  'claim uses the parsed exact identity, a bounded handler-entry lease, and bounded audit metadata',
);

const duplicateBranch = compactClaim.indexOf(
  "if (claim.ok && claim.disposition === 'duplicate')",
);
const acceptedClaimBranch = compactClaim.indexOf(
  "(claim.disposition !== 'claimed' && claim.disposition !== 'already_claimed')",
);
assert(
  duplicateBranch >= 0 && acceptedClaimBranch > duplicateBranch,
  'a durable duplicate is returned before any claim can be accepted for dispatch',
);
assert(
  compactClaim.includes('priorState: claim.call.state')
    && compactClaim.includes('it was not executed again'),
  'duplicate claims preserve the prior durable state and explicitly refuse re-execution',
);
assert(
  compactClaim.includes("claim.call.state !== 'claimed'")
    && compactClaim.includes('!claim.call.claimToken'),
  'only a claimed row carrying its claim token can become a runtime lease',
);

assert(
  compactFinish.includes('identity: lease.identity')
    && compactFinish.includes('claimToken: lease.claimToken')
    && compactFinish.includes('finalState'),
  'finish is bound to the exact durable identity, worker token, and requested terminal state',
);
assert(
  compactFinish.includes("finished.disposition === 'finished'")
    && compactFinish.includes("finished.disposition === 'already_finished'")
    && compactFinish.includes('finished.call.state === finalState'),
  'finish acknowledgement is accepted only for an exact matching terminal state',
);
assert(
  compactLease.includes("kind: 'duplicate'")
    && compactLease.includes("priorState: Exclude<AgentActionCallState, 'claimed'>")
    && compactFinish.includes('function durableStartDuplicateResult<T>('),
  'handler-entry duplicates have a typed non-claimed prior-state outcome',
);
assert(
  compactFinish.includes("duplicate.priorState === 'dispatched'")
    && compactFinish.includes("duplicate.priorState === 'outcome_unknown'")
    && compactFinish.includes("duplicate.priorState === 'verified'")
    && compactFinish.includes("duplicate.priorState === 'failed'")
    && compactFinish.includes('priorState: duplicate.priorState'),
  'typed start duplicates preserve genuine durable state and classify terminal sealing exactly',
);

const claimCallIndex = compactDispatch.indexOf('const claimed = await claimDurableAgentAction(');
const claimFailureIndex = compactDispatch.indexOf('if (!claimed.ok)');
const groundingDispatchIndex = compactDispatch.indexOf(
  'const dispatched = await dispatchAuthorizedComputerAppMutation({',
);
assert(
  claimCallIndex >= 0
    && claimFailureIndex > claimCallIndex
    && groundingDispatchIndex > claimFailureIndex,
  'durable claim succeeds before the grounding dispatcher can enter its sealed handler',
);
assert(
  compactDispatch.includes(
    "const outcomeUnknown = claimed.priorState === 'dispatched' || claimed.priorState === 'outcome_unknown'",
  ),
  'duplicate dispatched/outcome_unknown rows remain globally outcome-unknown and non-replayable',
);
assert(
  compactDispatch.includes("claimed.priorState === 'verified'")
    && compactDispatch.includes("claimed.priorState === 'failed'")
    && compactDispatch.includes("claimed.priorState === 'outcome_unknown'"),
  'terminal duplicate states are surfaced as already durably sealed',
);

const startAttemptedIndex = compactDispatch.indexOf('lease.startAttempted = true');
const startCallIndex = compactDispatch.indexOf('const started = await lease.store.start({');
const exactStartCheckIndex = compactDispatch.indexOf(
  "!started.ok || started.disposition !== 'started' || started.call.state !== 'dispatched'",
);
const startedIndex = compactDispatch.indexOf('lease.started = true');
const appHandlerIndex = compactDispatch.indexOf('return input.handler(sealedArgs)');
assert(
  startAttemptedIndex >= 0
    && startCallIndex > startAttemptedIndex
    && compactDispatch.indexOf("started.disposition === 'duplicate'", startCallIndex) > startCallIndex
    && exactStartCheckIndex > startCallIndex
    && startedIndex > exactStartCheckIndex
    && appHandlerIndex > startedIndex,
  'start is marked attempted, atomically confirmed, then marked started before the app handler is invoked',
);
assert(
  compactDispatch.includes('lease.startDuplicate = { kind: \'duplicate\', priorState: started.call.state')
    && compactDispatch.includes('The genuine prior state was preserved and the app handler was not invoked.'),
  'a duplicate returned by start is captured before throwing out of the sealed handler callback',
);
assert(
  compactDispatch.includes('identity: lease.identity, claimToken: lease.claimToken'),
  'start uses the exact claim identity and token',
);
assert(
  count(dispatchSource, 'input.handler(sealedArgs)') === 1,
  'the app handler has exactly one entry point behind durable start confirmation',
);
assert(
  compactDispatch.includes('The app handler was not invoked and this call must not be replayed automatically.'),
  'an unconfirmed or duplicate start refuses the app handler and automatic replay',
);

const dispatchedFailureSource = section(
  dispatchSource,
  'if (!dispatched.ok) {',
  'return {\n      ok: true,',
  'grounding handler failure branch',
);
const compactDispatchedFailure = compact(dispatchedFailureSource);
assert(
  compactDispatchedFailure.indexOf('if (lease.startDuplicate)')
    < compactDispatchedFailure.indexOf('const durableStateSealed = lease.started'),
  'the normal dispatcher failure path returns the typed duplicate before any terminal rewrite',
);
assert(
  compactDispatchedFailure.includes(
    "const durableStateSealed = lease.started ? await finishDurableAgentAction(lease, 'outcome_unknown'",
  ),
  'a confirmed handler-entry error seals only outcome_unknown',
);
assert(
  compactDispatchedFailure.includes(': false')
    && !compactDispatchedFailure.includes("'failed'"),
  'a start ambiguity does not call finish-failed or rewrite another worker state',
);
assert(
  compactDispatchedFailure.includes('outcomeUnknown: true'),
  'grounding handler failure always returns a do-not-replay unknown outcome',
);

const catchSource = section(
  dispatchSource,
  '} catch (error) {',
  '\n  }\n}',
  'durable wrapper catch',
);
const compactCatch = compact(catchSource);
assert(
  compactCatch.indexOf('if (lease.startDuplicate)')
    < compactCatch.indexOf('let durableStateSealed = false'),
  'the thrown-dispatch path also returns the typed duplicate before generic outcome handling',
);
assert(
  compactCatch.includes(
    "if (lease.started) { durableStateSealed = await finishDurableAgentAction(lease, 'outcome_unknown'",
  ),
  'any throw after confirmed durable start is terminalized as outcome_unknown',
);
assert(
  !compactCatch.includes("finishDurableAgentAction(lease, 'failed'")
    && compactCatch.includes(
      'else if (!lease.startAttempted) {'
        + ' // Do not finalize the shared durable row here.'
    )
    && compactCatch.includes('durableStateSealed = false'),
  'a pre-handler grounding throw leaves the claimed lease unfinalized and reclaimable instead of racing another worker with finish-failed',
);
assert(
  compactCatch.includes('outcomeUnknown: lease.startAttempted'),
  'the wrapper reports unknown exactly when durable handler entry may have been attempted',
);

type Canary = {
  label: string;
  source: string;
  tool: string;
  bridgeMutation: string;
};

const canaries: Canary[] = [
  {
    label: 'fill',
    source: fillSource,
    tool: 'browser.fill_field',
    bridgeMutation: 'fillGuardedNonSecretField({ ...sealedArgs })',
  },
  {
    label: 'toggle',
    source: toggleSource,
    tool: 'browser.set_toggle',
    bridgeMutation: 'setGuardedBrowserToggleState({ ...sealedArgs })',
  },
  {
    label: 'select',
    source: selectSource,
    tool: 'browser.select_option',
    bridgeMutation: 'setGuardedBrowserSelectOption({ ...sealedArgs })',
  },
];

for (const canary of canaries) {
  const source = compact(canary.source);
  const authorizationCheck = source.indexOf('if (!authorization.allowed)');
  const wrapperCall = source.indexOf('const dispatched = await dispatchDurableComputerAppMutation({');
  const bridgeCall = source.indexOf(canary.bridgeMutation);
  assert(
    source.includes(`tool: '${canary.tool}'`)
      && authorizationCheck >= 0
      && wrapperCall > authorizationCheck
      && bridgeCall > wrapperCall,
    `${canary.label} authorizes first, uses the durable wrapper, then reaches its sealed bridge mutation`,
  );
  assert(
    source.includes('action, authorization, approvalId: approvalReceipt.approvalId, context, normalizedArgs: prepared.dispatchArgs'),
    `${canary.label} passes the exact action, authorization, approval, call context, and transient args into the wrapper`,
  );
  assert(
    !canary.source.includes('dispatchAuthorizedComputerAppMutation({'),
    `${canary.label} cannot bypass the shared durable wrapper with a direct grounding dispatch`,
  );
  assert(
    source.includes(
      "const durableState = verificationReceipt.canComplete ? 'verified' : 'outcome_unknown'",
    ),
    `${canary.label} maps canonical proof only to verified or outcome_unknown`,
  );
  assert(
    source.includes('const durableWarning = durableStateSealed')
      && source.includes('the exact call remains replay-blocked and must not be submitted again.'),
    `${canary.label} reports an unacknowledged finish without inviting replay`,
  );
  assert(
    source.includes(`const result: OpenSwanToolExecutionResultMap['${canary.tool}'] = verificationReceipt.canComplete ? { ok: true`)
      && !source.includes('= !durableStateSealed ? { ok: false'),
    `${canary.label} preserves canonical verified success when durable finish acknowledgement is unavailable`,
  );
  assert(
    source.includes('dispatchReceipt: dispatched.dispatchReceipt')
      || source.includes('dispatched.dispatchReceipt'),
    `${canary.label} retains the grounding dispatch receipt for verification and hidden audit metadata`,
  );
  assert(
    source.includes('verificationReceipt')
      && source.includes('attachComputerAppMutationMetadata'),
    `${canary.label} attaches the canonical verification receipt to trusted runtime metadata`,
  );
}

assert(
  count(
    runtimeSource.slice(
      runtimeSource.indexOf('async function executeGuardedBrowserFill('),
      runtimeSource.indexOf('function hasExactOpenSwanRuntimeCallIdentity('),
    ),
    'dispatchDurableComputerAppMutation({',
  ) === 3,
  'fill, toggle, and select each use the durable wrapper exactly once',
);

console.log(`agent-action-runtime-wiring smoke: ${assertions} assertions passed`);
