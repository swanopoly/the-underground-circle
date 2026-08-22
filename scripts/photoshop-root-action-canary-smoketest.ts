/**
 * Source-level rollout and ordering guard for the first executable universal
 * root/action canary. The atomic gateway and bridge have their own behavioral
 * fault-injection suites; this smoke prevents runtime wiring from widening the
 * canary to launch/focus/browser actions or moving the bridge call ahead of
 * durable start authority.
 *
 * Run: npx tsx scripts/photoshop-root-action-canary-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const runtime = readFileSync(`${repoRoot}/src/lib/computerTaskRuntime.ts`, 'utf8');

function sliceBetween(startMarker: string, endMarker: string): string {
  const start = runtime.indexOf(startMarker);
  const end = runtime.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0, `missing runtime marker: ${startMarker}`);
  assert(end > start, `missing or reordered runtime marker: ${endMarker}`);
  return runtime.slice(start, end);
}

function ordered(source: string, markers: readonly string[]): void {
  let prior = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker);
    assert(index >= 0, `missing canary step: ${marker}`);
    assert(index > prior, `canary step is out of order: ${marker}`);
    prior = index;
  }
}

const flagBlock = sliceBetween(
  'function isPhotoshopRootActionCanaryRequested()',
  'function exactPhotoshopTargetGuardMatches(',
);
assert.match(
  flagBlock,
  /EXPO_PUBLIC_PHOTOSHOP_ROOT_ACTION_CANARY_V1\s*===\s*'true'/,
  'Photoshop canary requires an explicit exact-true flag',
);
assert.match(
  flagBlock,
  /isComputerTaskRootActionGatewayRolloutEnabled\(\)/,
  'Photoshop canary is subordinate to durable root/action gateway rollout',
);
assert.doesNotMatch(flagBlock, /\|\||!==\s*'false'|toLowerCase/);

const canary = sliceBetween(
  'async function executeFrontmostPhotoshopRootActionCanary(',
  '/**\n * Execute a compiler-owned, dispatcher-authorized Photoshop creation program',
);
const authorizedWrapper = sliceBetween(
  'async function executeAuthorizedPhotoshopCreateDocument(',
  '/**\n * First universal-root mutation canary.',
);

for (const forbidden of [
  '.launchApp(',
  '.focusApp(',
  '.manageWindow(',
  '.getWindowState(',
  'desktop.launch_app',
  'desktop.focus_app',
  'browser.',
]) {
  assert.equal(
    canary.includes(forbidden),
    false,
    `frontmost create canary must not contain ${forbidden}`,
  );
}
assert.equal(
  Array.from(canary.matchAll(/\.photoshopCreateDocument\s*\(/g)).length,
  0,
  'canary orchestration cannot call the bridge outside its authority wrapper',
);
assert.equal(
  Array.from(authorizedWrapper.matchAll(/\.photoshopCreateDocument\s*\(/g)).length,
  1,
  'authority wrapper contains the sole bridge mutation call site',
);
assert.match(canary, /projectionBranch\s*!==\s*'app_frontmost'/);
assert.match(canary, /actionRequirements\.length\s*!==\s*1/);
assert.match(canary, /requiredDispatchRequirements\.length\s*!==\s*1/);
assert.match(canary, /rootBinding\.durability\s*!==\s*'database'/);
assert.match(canary, /const beforeClaimBlocked = input\.rootBinding\.root\.acceptance/);
assert.match(canary, /if \(!rootBinding\.root\.acceptance\)/);
assert.match(canary, /const existingAcceptance = rootBinding\.root\.acceptance/);
assert.match(canary, /if \(!rootAction\.dispatchBinding\)/);
assert.match(canary, /const existingDispatch = rootAction\.dispatchBinding/);
assert.match(canary, /existingLease\?\.status === 'active'/);
assert.match(canary, /const refreshSameActionLease = existingLease\.targetFingerprint !== targetFingerprint/);
assert.match(canary, /type: 'release_foreground_lease'/);

ordered(canary, [
  "desktop.observeApp({ appName: 'Photoshop' })",
  "desktop.photoshopDocumentStatus({ appName: 'Photoshop' })",
  "type: 'bind_acceptance'",
  "type: 'bind_action_dispatch'",
  "type: 'bind_foreground_lease'",
  'const claim = await gateway.claim({',
  "freshTarget = await desktop.observeApp({ appName: 'Photoshop' })",
  'const started = await gateway.start({',
  'const attempted = await executeAuthorizedPhotoshopCreateDocument({',
  'const finalStatus = await observeExactPhotoshopFinalStatus({',
  "finalTarget = await desktop.observeApp({ appName: 'Photoshop' })",
  "finalState: 'verified'",
  "terminalTransition: { type: 'complete', proofFingerprint }",
]);

ordered(authorizedWrapper, [
  'const recomputedToolArgsFingerprint = await buildComputerAppToolArgsFingerprintAsync({',
  'consumeComputerTaskRootActionHandlerAuthority(',
  "if (input.signal?.aborted)",
  'result: await input.desktop.photoshopCreateDocument({',
]);
for (const exactBinding of [
  'binding: input.binding',
  'actionId: input.actionId',
  "tool: 'desktop.photoshop_create_document'",
  'toolArgsFingerprint: input.toolArgsFingerprint',
  'targetFingerprint: input.targetFingerprint',
]) {
  assert(
    authorizedWrapper.includes(exactBinding),
    `handler authority consumption binds ${exactBinding}`,
  );
}

const createCall = authorizedWrapper.slice(
  authorizedWrapper.indexOf('result: await input.desktop.photoshopCreateDocument({'),
  authorizedWrapper.indexOf(
    '});',
    authorizedWrapper.indexOf('result: await input.desktop.photoshopCreateDocument({'),
  ) + 3,
);
for (const exactArg of [
  "appName: 'Photoshop'",
  'widthPx: input.widthPx',
  'heightPx: input.heightPx',
  'targetGuard: input.targetGuard',
]) {
  assert(createCall.includes(exactArg), `guarded create call binds ${exactArg}`);
}

assert.match(canary, /receipt\.documentCountBefore\s*!==\s*baseline\.data!\.documentCount/);
assert.match(canary, /receipt\.documentCountAfter\s*!==\s*baseline\.data!\.documentCount\s*\+\s*1/);
assert.match(canary, /expectedDocumentId:\s*receipt\.createdDocumentId/);
assert.match(canary, /expectedDocumentCount:\s*receipt\.documentCountAfter/);
assert.match(canary, /replayPolicy:\s*'never_after_dispatch'/);
assert.match(canary, /finalState:\s*'outcome_unknown'/);
assert.match(canary, /Automatic replay is disabled after durable start/);
for (const requirementField of [
  'callIdentityRequirementFingerprint',
  'policyBindingRequirementFingerprint',
  'verifierBindingRequirementFingerprint',
  'replayBindingRequirementFingerprint',
]) {
  assert(
    canary.includes(`dispatchRequirement.${requirementField}`),
    `runtime binding realizes ${requirementField}`,
  );
}

const postDocumentProof = canary.slice(
  canary.indexOf('let finalTargetMatched = false;'),
  canary.indexOf("const proofFingerprint = await fingerprint("),
);
assert.match(postDocumentProof, /let finalTargetMatched = false/);
assert.match(postDocumentProof, /Foreground changed after verified creation; OpenSwan did not refocus Photoshop/);
assert.equal(
  postDocumentProof.includes('return sealOutcomeUnknown('),
  false,
  'post-proof foreground telemetry cannot downgrade exact document proof',
);
const verifiedProofInput = canary.slice(
  canary.indexOf("'photoshop_root_action_canary_verified_proof'"),
  canary.indexOf('if (!EXACT_SEQUENCE_SHA256_RE.test(proofFingerprint))'),
);
assert.equal(
  verifiedProofInput.includes('finalTargetMatched'),
  false,
  'post-action foreground telemetry is not part of the authoritative document proof digest',
);

const postStartExecution = canary.slice(
  canary.indexOf('rootBinding = started.binding;'),
  canary.indexOf('const finalStatus = await observeExactPhotoshopFinalStatus({'),
);
assert.equal(
  postStartExecution.includes('settleBeforeHandlerFailure('),
  false,
  'post-start exits cannot attempt the forbidden dispatched-to-failed transition',
);
assert.match(postStartExecution, /sealOutcomeUnknown\([\s\S]*?false,/);

const exactBranch = sliceBetween(
  'if (sequenceProgram && exactSequenceAuthorized) {',
  'if (args.deterministicLifecycleReadProgram) {',
);
const canaryBranch = exactBranch.indexOf('if (isPhotoshopRootActionCanaryRequested()) {');
const childRoot = exactBranch.indexOf('const root = await createExactSequenceRootRun({');
assert.match(exactBranch, /const resumableCompilerAttempt = isPhotoshopRootActionCanaryRequested\(\)/);
assert.match(exactBranch, /attempt\.state === 'active' && attempt\.kind === 'compiler'/);
assert.match(exactBranch, /persistedCanaryAction\.state === 'dispatched'/);
assert.match(exactBranch, /persistedCanaryAction\.state === 'outcome_unknown'/);
assert.match(exactBranch, /already durably completed/);
assert.match(exactBranch, /did not replay any app action/);
assert(canaryBranch >= 0, 'exact sequence branch checks the canary request flag');
assert(childRoot > canaryBranch, 'canary wins before legacy child-run creation');
assert(
  exactBranch.slice(canaryBranch, childRoot).includes(
    'executeFrontmostPhotoshopRootActionCanary({',
  ),
  'requested canary dispatches only through the frontmost root/action helper',
);
assert(
  exactBranch.slice(canaryBranch, childRoot).includes('return canaryResult;'),
  'requested canary fails closed instead of falling through to legacy launch/focus/create',
);

const preRoutingFence = sliceBetween(
  'const sequenceProgram = compileComputerSequenceProgram(args.task);',
  '// Selection is read-only.',
);
assert.match(preRoutingFence, /const rootRequiresExactResume =/);
assert.match(preRoutingFence, /const rootHasActiveAttempt =/);
assert.match(preRoutingFence, /const unacceptedRootIsSafelyRestartable =/);
assert.match(preRoutingFence, /persistedRootAction\?\.tool === 'desktop\.photoshop_create_document'/);
assert.match(preRoutingFence, /const exactRootResumeAdapterAvailable =/);
assert.match(preRoutingFence, /will not replay it through the generic tool loop/);
assert.match(preRoutingFence, /stopped before the generic tool loop/);

console.log('photoshop root/action canary smoke: PASS');
