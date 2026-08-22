import assert from 'node:assert/strict';
import {
  admitComputerTaskRoot,
  canActivateComputerTaskRoot,
  computerTaskRootRequiresExactResume,
  hydrateComputerTaskRoot,
  serializeComputerTaskRoot,
  transitionComputerTaskRoot,
  type ComputerTaskActionAuthorizationCategory,
  type ComputerTaskActionDispatchSource,
  type ComputerTaskActionMutationAuthority,
  type ComputerTaskRootV1,
} from '../src/lib/computerTaskRoot';

const fp = (hex: string) => `args-v2:sha256:${hex.repeat(64)}`;
const ARGS_A = fp('a');
const ARGS_B = fp('b');
const AUTH_A = fp('c');
const AUTH_B = fp('d');
const PREDICATE = fp('e');
const PROOF_A = fp('f');
const PROOF_B = fp('1');
const TARGET = fp('2');
const CALL_IDENTITY = fp('3');
const POLICY_BINDING = fp('4');
const VERIFIER_BINDING = fp('5');
const REPLAY_BINDING = fp('6');

function iso(second: number): string {
  return new Date(Date.UTC(2026, 7, 6, 12, 0, second)).toISOString();
}

function hourIso(hour: number, second: number): string {
  return new Date(Date.UTC(2026, 7, 6, hour, 0, second)).toISOString();
}

async function mustAdmit(input: Parameters<typeof admitComputerTaskRoot>[0]) {
  const result = await admitComputerTaskRoot(input);
  assert.equal(result.ok, true, result.ok ? '' : `${result.code}: ${result.message}`);
  if (!result.ok) throw new Error(result.message);
  return result;
}

async function mustTransition(
  root: ComputerTaskRootV1,
  transition: Parameters<typeof transitionComputerTaskRoot>[2],
): Promise<ComputerTaskRootV1> {
  const result = await transitionComputerTaskRoot(root, root.revision, transition);
  assert.equal(result.ok, true, result.ok ? '' : `${result.code}: ${result.message}`);
  if (!result.ok) throw new Error(result.message);
  assert.equal(result.previousRevision, root.revision);
  assert.equal(result.root.revision, root.revision + 1);
  assert(Object.isFrozen(result.root));
  return result.root;
}

async function mustBindDispatch(
  root: ComputerTaskRootV1,
  input: Readonly<{
    actionId: string;
    source: ComputerTaskActionDispatchSource;
    authorizationCategory: ComputerTaskActionAuthorizationCategory;
    mutationAuthority: ComputerTaskActionMutationAuthority;
    at: string;
  }>,
): Promise<ComputerTaskRootV1> {
  return mustTransition(root, {
    type: 'bind_action_dispatch',
    actionId: input.actionId,
    source: input.source,
    callIdentityFingerprint: CALL_IDENTITY,
    authorizationCategory: input.authorizationCategory,
    mutationAuthority: input.mutationAuthority,
    policyBindingFingerprint: POLICY_BINDING,
    verifierBindingFingerprint: VERIFIER_BINDING,
    replayBindingFingerprint: REPLAY_BINDING,
    at: input.at,
  });
}

async function main(): Promise<void> {
const baseAdmission = {
  schemaVersion: 1 as const,
  requestIdentity: 'message-600x600-001',
  userId: 'user-001',
  circleId: 'circle-001',
  threadId: 'thread-001',
  source: 'chat',
  normalizedTask: 'Open Photoshop and create a 600 x 600 blank document',
  admittedAt: iso(0),
};

// Stable admission identity and refresh-safe duplicate handling.
const admitted = await mustAdmit(baseAdmission);
assert.equal(admitted.disposition, 'created');
const initial = admitted.root;
assert.match(initial.rootFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
assert.match(initial.requestIdentityFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
assert.match(initial.taskFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
assert.match(initial.rootId, /^computer_task_[0-9a-f]{64}$/);
assert.equal(initial.revision, 0);
assert.equal(initial.state, 'admitted');
assert.equal(canActivateComputerTaskRoot(initial), true);
assert.equal(computerTaskRootRequiresExactResume(initial), false);
assert(Object.isFrozen(initial.request));
assert(Object.isFrozen(initial.attempts));

const waitingWithoutAttempt = await mustTransition(initial, {
  type: 'set_waiting',
  state: 'waiting_approval',
  at: iso(1),
});
assert.equal(waitingWithoutAttempt.attempts.length, 0);
assert.equal(computerTaskRootRequiresExactResume(waitingWithoutAttempt), true);

const initialSerialized = await serializeComputerTaskRoot(initial);
assert.equal(initialSerialized.ok, true);
if (!initialSerialized.ok) throw new Error(initialSerialized.message);
assert(!initialSerialized.serialized.includes('Open Photoshop'));
assert(!initialSerialized.serialized.includes('600 x 600'));
assert(!Object.prototype.hasOwnProperty.call(initial, 'normalizedTask'));

const refreshed = await mustAdmit({
  ...baseAdmission,
  normalizedTask: '  Open   Photoshop and create a 600 x 600 blank document  ',
  admittedAt: iso(45),
  existing: initialSerialized.serialized,
});
assert.equal(refreshed.disposition, 'duplicate');
assert.equal(refreshed.root.rootFingerprint, initial.rootFingerprint);
assert.equal(refreshed.root.request.admittedAt, iso(0));
assert.equal(refreshed.root.revision, 0);

const duplicateObject = await mustAdmit({ ...baseAdmission, existing: initial });
assert.equal(duplicateObject.disposition, 'duplicate');
assert.equal(duplicateObject.root.rootId, initial.rootId);

const maxRevisionSnapshot = JSON.parse(initialSerialized.serialized) as Record<string, unknown>;
maxRevisionSnapshot.revision = 2_147_483_647;
const maxRevisionHydrated = await hydrateComputerTaskRoot(maxRevisionSnapshot);
assert.equal(maxRevisionHydrated.ok, true);
if (!maxRevisionHydrated.ok) throw new Error(maxRevisionHydrated.message);
const maxRevisionTransition = await transitionComputerTaskRoot(
  maxRevisionHydrated.root,
  maxRevisionHydrated.root.revision,
  {
    type: 'begin_attempt',
    kind: 'compiler',
    parentAttemptId: null,
    at: iso(1),
  },
);
assert.equal(maxRevisionTransition.ok, false);
if (!maxRevisionTransition.ok) assert.equal(maxRevisionTransition.code, 'capacity_exceeded');

const taskDrift = await admitComputerTaskRoot({
  ...baseAdmission,
  normalizedTask: 'Open Photoshop and delete every open document',
  existing: initial,
});
assert.equal(taskDrift.ok, false);
if (!taskDrift.ok) assert.equal(taskDrift.code, 'admission_drift');

const scopeDrift = await admitComputerTaskRoot({
  ...baseAdmission,
  userId: 'user-002',
  existing: initial,
});
assert.equal(scopeDrift.ok, false);
if (!scopeDrift.ok) assert.equal(scopeDrift.code, 'admission_drift');

// Attempt/checkpoint state, stale CAS, deterministic acceptance and child actions.
let root = await mustTransition(initial, {
  type: 'begin_attempt',
  kind: 'compiler',
  parentAttemptId: null,
  at: iso(1),
});
assert.equal(root.state, 'running');
assert.equal(root.attempts.length, 1);
assert.equal(computerTaskRootRequiresExactResume(root), true);
assert.match(root.attempts[0].attemptId, /^computer_attempt_[0-9a-f]{64}$/);

const staleCas = await transitionComputerTaskRoot(root, 0, {
  type: 'append_checkpoint',
  checkpointId: 'checkpoint-stale',
  attemptId: root.attempts[0].attemptId,
  kind: 'plan',
  evidenceFingerprint: null,
  at: iso(2),
});
assert.equal(staleCas.ok, false);
if (!staleCas.ok) assert.equal(staleCas.code, 'stale_revision');
assert.equal(root.checkpoints.length, 0);

root = await mustTransition(root, {
  type: 'append_checkpoint',
  checkpointId: 'checkpoint-plan-001',
  attemptId: root.attempts[0].attemptId,
  kind: 'plan',
  evidenceFingerprint: PREDICATE,
  at: iso(2),
});
assert.equal(root.checkpoints[0].sequence, 1);
assert.equal(root.checkpoints[0].rootState, 'running');

root = await mustTransition(root, {
  type: 'bind_acceptance',
  attemptId: root.attempts[0].attemptId,
  actions: [
    {
      tool: 'desktop.photoshop_document_status',
      toolArgsFingerprint: ARGS_A,
      authorizationFingerprint: AUTH_A,
      mutatesState: false,
      requiresForegroundLease: false,
    },
    {
      tool: 'desktop.photoshop_create_document',
      toolArgsFingerprint: ARGS_B,
      authorizationFingerprint: AUTH_B,
      mutatesState: true,
      requiresForegroundLease: true,
    },
  ],
  predicateFingerprints: [PREDICATE],
  at: iso(3),
});
assert(root.acceptance);
assert.match(root.acceptance.acceptanceFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
assert.equal(root.acceptance.actions.length, 2);
assert.notEqual(root.acceptance.actions[0].actionId, root.acceptance.actions[1].actionId);
for (const action of root.acceptance.actions) {
  assert.match(action.actionId, /^computer_action_[0-9a-f]{64}$/);
  assert.match(action.acceptanceBindingFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
  assert.match(action.idempotencyKey, /^computer-task\.[0-9a-f]{64}$/);
  assert.equal(action.dispatchBinding, null);
}

// Dispatch policy binds later without changing acceptance or action identity.
const initialAcceptanceFingerprint = root.acceptance.acceptanceFingerprint;
const observationActionId = root.acceptance.actions[0].actionId;
const mutationActionId = root.acceptance.actions[1].actionId;
const claimBeforeBinding = await transitionComputerTaskRoot(root, root.revision, {
  type: 'record_action_state',
  actionId: observationActionId,
  nextState: 'claimed',
  proofFingerprint: null,
  at: iso(4),
});
assert.equal(claimBeforeBinding.ok, false);
if (!claimBeforeBinding.ok) assert.equal(claimBeforeBinding.code, 'invalid_transition');

const bindingWithUnknownField = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: observationActionId,
  source: 'compiler',
  callIdentityFingerprint: CALL_IDENTITY,
  authorizationCategory: 'read_only',
  mutationAuthority: 'read_only',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
  unknownPolicyValue: 'raw-secret',
} as any);
assert.equal(bindingWithUnknownField.ok, false);
if (!bindingWithUnknownField.ok) assert.equal(bindingWithUnknownField.code, 'invalid_input');

const bindingWithUnknownCategory = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: observationActionId,
  source: 'compiler',
  callIdentityFingerprint: CALL_IDENTITY,
  authorizationCategory: 'ambient_authority',
  mutationAuthority: 'read_only',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
});
assert.equal(bindingWithUnknownCategory.ok, false);
if (!bindingWithUnknownCategory.ok) assert.equal(bindingWithUnknownCategory.code, 'invalid_input');

const bindingWithUnknownSource = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: observationActionId,
  source: 'ambient',
  callIdentityFingerprint: CALL_IDENTITY,
  authorizationCategory: 'read_only',
  mutationAuthority: 'read_only',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
});
assert.equal(bindingWithUnknownSource.ok, false);
if (!bindingWithUnknownSource.ok) assert.equal(bindingWithUnknownSource.code, 'invalid_input');

const bindingWithWrongAttemptSource = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: observationActionId,
  source: 'provider',
  callIdentityFingerprint: CALL_IDENTITY,
  authorizationCategory: 'read_only',
  mutationAuthority: 'read_only',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
});
assert.equal(bindingWithWrongAttemptSource.ok, false);
if (!bindingWithWrongAttemptSource.ok) {
  assert.equal(bindingWithWrongAttemptSource.code, 'invalid_transition');
}

const bindingWithForgedFingerprint = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: observationActionId,
  source: 'compiler',
  callIdentityFingerprint: 'sha256:not-canonical',
  authorizationCategory: 'read_only',
  mutationAuthority: 'read_only',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
});
assert.equal(bindingWithForgedFingerprint.ok, false);
if (!bindingWithForgedFingerprint.ok) assert.equal(bindingWithForgedFingerprint.code, 'invalid_input');

const readActionWithMutationAuthority = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: observationActionId,
  source: 'compiler',
  callIdentityFingerprint: CALL_IDENTITY,
  authorizationCategory: 'read_only',
  mutationAuthority: 'action_ledger',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
});
assert.equal(readActionWithMutationAuthority.ok, false);
if (!readActionWithMutationAuthority.ok) assert.equal(readActionWithMutationAuthority.code, 'invalid_transition');

const readActionWithMutationAuthorization = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: observationActionId,
  source: 'compiler',
  callIdentityFingerprint: CALL_IDENTITY,
  authorizationCategory: 'direct_request',
  mutationAuthority: 'read_only',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
});
assert.equal(readActionWithMutationAuthorization.ok, false);
if (!readActionWithMutationAuthorization.ok) assert.equal(readActionWithMutationAuthorization.code, 'invalid_transition');

const mutationWithReadOnlyAuthority = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: mutationActionId,
  source: 'compiler',
  callIdentityFingerprint: CALL_IDENTITY,
  authorizationCategory: 'plan_approval',
  mutationAuthority: 'read_only',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
});
assert.equal(mutationWithReadOnlyAuthority.ok, false);
if (!mutationWithReadOnlyAuthority.ok) assert.equal(mutationWithReadOnlyAuthority.code, 'invalid_transition');

const mutationWithReadOnlyAuthorization = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: mutationActionId,
  source: 'compiler',
  callIdentityFingerprint: CALL_IDENTITY,
  authorizationCategory: 'read_only',
  mutationAuthority: 'action_ledger',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
});
assert.equal(mutationWithReadOnlyAuthorization.ok, false);
if (!mutationWithReadOnlyAuthorization.ok) assert.equal(mutationWithReadOnlyAuthorization.code, 'invalid_transition');

root = await mustBindDispatch(root, {
  actionId: observationActionId,
  source: 'compiler',
  authorizationCategory: 'read_only',
  mutationAuthority: 'read_only',
  at: iso(4),
});
assert(root.acceptance?.actions[0].dispatchBinding);
assert(Object.isFrozen(root.acceptance.actions[0].dispatchBinding));
assert.equal(root.acceptance.actions[0].updatedAt, iso(4));
const rebound = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_action_dispatch',
  actionId: observationActionId,
  source: 'compiler',
  callIdentityFingerprint: CALL_IDENTITY,
  authorizationCategory: 'read_only',
  mutationAuthority: 'read_only',
  policyBindingFingerprint: POLICY_BINDING,
  verifierBindingFingerprint: VERIFIER_BINDING,
  replayBindingFingerprint: REPLAY_BINDING,
  at: iso(4),
});
assert.equal(rebound.ok, false);
if (!rebound.ok) assert.equal(rebound.code, 'identity_conflict');

root = await mustTransition(root, {
  type: 'set_waiting',
  state: 'waiting_approval',
  at: iso(4),
});
assert.equal(root.state, 'waiting_approval');

root = await mustBindDispatch(root, {
  actionId: mutationActionId,
  source: 'compiler',
  authorizationCategory: 'plan_approval',
  mutationAuthority: 'action_ledger',
  at: iso(4),
});
assert.equal(root.state, 'running');
assert.equal(root.acceptance?.acceptanceFingerprint, initialAcceptanceFingerprint);
assert.equal(root.acceptance.actions[0].actionId, observationActionId);
assert.equal(root.acceptance.actions[1].actionId, mutationActionId);

const finishBoundAttempt = await transitionComputerTaskRoot(root, root.revision, {
  type: 'finish_attempt',
  attemptId: root.attempts[0].attemptId,
  outcome: 'failed',
  at: iso(5),
});
assert.equal(finishBoundAttempt.ok, false);
if (!finishBoundAttempt.ok) assert.equal(finishBoundAttempt.code, 'invalid_transition');

const acceptanceSnapshot = await serializeComputerTaskRoot(root);
assert.equal(acceptanceSnapshot.ok, true);
if (!acceptanceSnapshot.ok) throw new Error(acceptanceSnapshot.message);
assert(!acceptanceSnapshot.serialized.includes('raw-secret'));
const acceptanceHydrated = await hydrateComputerTaskRoot(acceptanceSnapshot.serialized);
assert.equal(acceptanceHydrated.ok, true);
if (!acceptanceHydrated.ok) throw new Error(acceptanceHydrated.message);
assert.equal(
  acceptanceHydrated.root.acceptance?.acceptanceFingerprint,
  root.acceptance.acceptanceFingerprint,
);
assert.deepEqual(
  acceptanceHydrated.root.acceptance?.actions[0].dispatchBinding,
  root.acceptance.actions[0].dispatchBinding,
);
assert.notEqual(
  acceptanceHydrated.root.acceptance?.actions[0].dispatchBinding,
  root.acceptance.actions[0].dispatchBinding,
);
assert(Object.isFrozen(acceptanceHydrated.root.acceptance?.actions[0].dispatchBinding));

const outOfOrderClaimedSnapshot = JSON.parse(acceptanceSnapshot.serialized) as any;
outOfOrderClaimedSnapshot.acceptance.actions[1].state = 'claimed';
const outOfOrderClaimedHydration = await hydrateComputerTaskRoot(outOfOrderClaimedSnapshot);
assert.equal(outOfOrderClaimedHydration.ok, false);

const dualClaimedSnapshot = JSON.parse(acceptanceSnapshot.serialized) as any;
dualClaimedSnapshot.acceptance.actions[0].state = 'claimed';
dualClaimedSnapshot.acceptance.actions[1].state = 'claimed';
const dualClaimedHydration = await hydrateComputerTaskRoot(dualClaimedSnapshot);
assert.equal(dualClaimedHydration.ok, false);

const closedAcceptanceOwnerSnapshot = JSON.parse(acceptanceSnapshot.serialized) as any;
closedAcceptanceOwnerSnapshot.attempts[0].state = 'failed';
closedAcceptanceOwnerSnapshot.attempts[0].finishedAt = closedAcceptanceOwnerSnapshot.updatedAt;
const closedAcceptanceOwnerHydration = await hydrateComputerTaskRoot(closedAcceptanceOwnerSnapshot);
assert.equal(closedAcceptanceOwnerHydration.ok, false);

const activeLeaseOnReadSnapshot = JSON.parse(acceptanceSnapshot.serialized) as any;
activeLeaseOnReadSnapshot.foregroundLease = {
  leaseId: 'forged-read-lease',
  actionId: observationActionId,
  targetFingerprint: TARGET,
  acquiredAt: activeLeaseOnReadSnapshot.updatedAt,
  expiresAt: iso(30),
  status: 'active',
  releasedAt: null,
};
const activeLeaseOnReadHydration = await hydrateComputerTaskRoot(activeLeaseOnReadSnapshot);
assert.equal(activeLeaseOnReadHydration.ok, false);

const waitingWithActiveLeaseSnapshot = JSON.parse(acceptanceSnapshot.serialized) as any;
waitingWithActiveLeaseSnapshot.state = 'waiting_approval';
waitingWithActiveLeaseSnapshot.foregroundLease = {
  leaseId: 'forged-waiting-lease',
  actionId: mutationActionId,
  targetFingerprint: TARGET,
  acquiredAt: waitingWithActiveLeaseSnapshot.updatedAt,
  expiresAt: iso(30),
  status: 'active',
  releasedAt: null,
};
const waitingWithActiveLeaseHydration = await hydrateComputerTaskRoot(waitingWithActiveLeaseSnapshot);
assert.equal(waitingWithActiveLeaseHydration.ok, false);

const activeLeaseOnVerifiedSnapshot = JSON.parse(acceptanceSnapshot.serialized) as any;
activeLeaseOnVerifiedSnapshot.acceptance.actions[0].state = 'verified';
activeLeaseOnVerifiedSnapshot.acceptance.actions[0].proofFingerprint = PROOF_A;
activeLeaseOnVerifiedSnapshot.acceptance.actions[1].state = 'verified';
activeLeaseOnVerifiedSnapshot.acceptance.actions[1].proofFingerprint = PROOF_B;
activeLeaseOnVerifiedSnapshot.foregroundLease = {
  leaseId: 'forged-verified-lease',
  actionId: mutationActionId,
  targetFingerprint: TARGET,
  acquiredAt: activeLeaseOnVerifiedSnapshot.updatedAt,
  expiresAt: iso(30),
  status: 'active',
  releasedAt: null,
};
const activeLeaseOnVerifiedHydration = await hydrateComputerTaskRoot(activeLeaseOnVerifiedSnapshot);
assert.equal(activeLeaseOnVerifiedHydration.ok, false);

// Action order, foreground lease binding, proof, and exact completion binding.
const outOfOrderClaim = await transitionComputerTaskRoot(root, root.revision, {
  type: 'record_action_state',
  actionId: mutationActionId,
  nextState: 'claimed',
  proofFingerprint: null,
  at: iso(4),
});
assert.equal(outOfOrderClaim.ok, false);
if (!outOfOrderClaim.ok) assert.equal(outOfOrderClaim.code, 'invalid_transition');
const prematureFutureLease = await transitionComputerTaskRoot(root, root.revision, {
  type: 'bind_foreground_lease',
  leaseId: 'lease-future-action',
  actionId: mutationActionId,
  targetFingerprint: TARGET,
  expiresAt: iso(50),
  at: iso(4),
});
assert.equal(prematureFutureLease.ok, false);
if (!prematureFutureLease.ok) assert.equal(prematureFutureLease.code, 'invalid_transition');
root = await mustTransition(root, {
  type: 'record_action_state',
  actionId: observationActionId,
  nextState: 'claimed',
  proofFingerprint: null,
  at: iso(4),
});
root = await mustTransition(root, {
  type: 'record_action_state',
  actionId: observationActionId,
  nextState: 'dispatched',
  proofFingerprint: null,
  at: iso(5),
});
assert.equal(root.state, 'verification_only');
assert.equal(root.replayPolicy, 'verification_only');
assert.equal(canActivateComputerTaskRoot(root), false);
root = await mustTransition(root, {
  type: 'record_action_state',
  actionId: observationActionId,
  nextState: 'verified',
  proofFingerprint: PROOF_A,
  at: iso(6),
});
assert.equal(root.state, 'running');
assert.equal(root.replayPolicy, 'normal');
root = await mustTransition(root, {
  type: 'record_action_state',
  actionId: mutationActionId,
  nextState: 'claimed',
  proofFingerprint: null,
  at: iso(7),
});

const dispatchWithoutLease = await transitionComputerTaskRoot(root, root.revision, {
  type: 'record_action_state',
  actionId: mutationActionId,
  nextState: 'dispatched',
  proofFingerprint: null,
  at: iso(8),
});
assert.equal(dispatchWithoutLease.ok, false);
if (!dispatchWithoutLease.ok) assert.equal(dispatchWithoutLease.code, 'invalid_transition');

const pauseWithActiveAttempt = await transitionComputerTaskRoot(root, root.revision, {
  type: 'set_waiting',
  state: 'paused',
  at: iso(8),
});
assert.equal(pauseWithActiveAttempt.ok, false);
if (!pauseWithActiveAttempt.ok) assert.equal(pauseWithActiveAttempt.code, 'invalid_transition');

root = await mustTransition(root, {
  type: 'bind_foreground_lease',
  leaseId: 'foreground-lease-001',
  actionId: mutationActionId,
  targetFingerprint: TARGET,
  expiresAt: iso(30),
  at: iso(8),
});
assert.equal(root.foregroundLease?.status, 'active');
const wrongLeaseRelease = await transitionComputerTaskRoot(root, root.revision, {
  type: 'release_foreground_lease',
  leaseId: 'foreground-lease-wrong',
  at: iso(8),
});
assert.equal(wrongLeaseRelease.ok, false);
if (!wrongLeaseRelease.ok) assert.equal(wrongLeaseRelease.code, 'invalid_transition');
const waitingWithLease = await transitionComputerTaskRoot(root, root.revision, {
  type: 'set_waiting',
  state: 'waiting_approval',
  at: iso(8),
});
assert.equal(waitingWithLease.ok, false);
if (!waitingWithLease.ok) assert.equal(waitingWithLease.code, 'invalid_transition');
const expiredLeaseCheckpoint = await transitionComputerTaskRoot(root, root.revision, {
  type: 'append_checkpoint',
  checkpointId: 'checkpoint-after-expired-lease',
  attemptId: root.attempts[0].attemptId,
  kind: 'action',
  evidenceFingerprint: null,
  at: iso(31),
});
assert.equal(expiredLeaseCheckpoint.ok, false);
if (!expiredLeaseCheckpoint.ok) assert.equal(expiredLeaseCheckpoint.code, 'invalid_transition');
root = await mustTransition(root, {
  type: 'record_action_state',
  actionId: mutationActionId,
  nextState: 'dispatched',
  proofFingerprint: null,
  at: iso(9),
});
assert.equal(root.state, 'verification_only');
assert.equal(root.replayPolicy, 'verification_only');
root = await mustTransition(root, {
  type: 'release_foreground_lease',
  leaseId: 'foreground-lease-001',
  at: iso(31),
});
assert.equal(root.state, 'verification_only');
assert.equal(root.foregroundLease?.status, 'released');
const doubleLeaseRelease = await transitionComputerTaskRoot(root, root.revision, {
  type: 'release_foreground_lease',
  leaseId: 'foreground-lease-001',
  at: iso(31),
});
assert.equal(doubleLeaseRelease.ok, false);
if (!doubleLeaseRelease.ok) assert.equal(doubleLeaseRelease.code, 'invalid_transition');
root = await mustTransition(root, {
  type: 'record_action_state',
  actionId: mutationActionId,
  nextState: 'verified',
  proofFingerprint: PROOF_B,
  at: iso(32),
});
assert.equal(root.foregroundLease?.status, 'released');

const wrongAcceptance = await transitionComputerTaskRoot(root, root.revision, {
  type: 'complete',
  acceptanceFingerprint: ARGS_A,
  proofFingerprint: PROOF_B,
  at: iso(33),
});
assert.equal(wrongAcceptance.ok, false);
if (!wrongAcceptance.ok) assert.equal(wrongAcceptance.code, 'invalid_transition');

root = await mustTransition(root, {
  type: 'complete',
  acceptanceFingerprint: root.acceptance!.acceptanceFingerprint,
  proofFingerprint: PROOF_B,
  at: iso(33),
});
assert.equal(root.state, 'completed');
assert.equal(root.replayPolicy, 'terminal');
assert.equal(canActivateComputerTaskRoot(root), false);
assert.equal(root.attempts[0].state, 'completed');

const terminalReactivation = await transitionComputerTaskRoot(root, root.revision, {
  type: 'begin_attempt',
  kind: 'recovery',
  parentAttemptId: root.attempts[0].attemptId,
  at: iso(34),
});
assert.equal(terminalReactivation.ok, false);
if (!terminalReactivation.ok) assert.equal(terminalReactivation.code, 'terminal_root');

// Before acceptance exists, a finished attempt may hand off to one explicit recovery attempt.
const recoveryAdmission = await mustAdmit({
  ...baseAdmission,
  requestIdentity: 'message-pre-acceptance-recovery-001',
  admittedAt: hourIso(12, 40),
});
let recoveryRoot = await mustTransition(recoveryAdmission.root, {
  type: 'begin_attempt',
  kind: 'deterministic',
  parentAttemptId: null,
  at: hourIso(12, 41),
});
const firstRecoveryParentId = recoveryRoot.attempts[0].attemptId;
recoveryRoot = await mustTransition(recoveryRoot, {
  type: 'finish_attempt',
  attemptId: firstRecoveryParentId,
  outcome: 'failed',
  at: hourIso(12, 42),
});
recoveryRoot = await mustTransition(recoveryRoot, {
  type: 'begin_attempt',
  kind: 'recovery',
  parentAttemptId: firstRecoveryParentId,
  at: hourIso(12, 43),
});
assert.equal(recoveryRoot.attempts[0].state, 'failed');
assert.equal(recoveryRoot.attempts[1].state, 'active');
assert.equal(recoveryRoot.attempts[1].parentAttemptId, firstRecoveryParentId);

// STOP is permanent across serialization and duplicate admission.
const stopAdmission = await mustAdmit({
  ...baseAdmission,
  requestIdentity: 'message-stop-001',
  admittedAt: hourIso(13, 0),
});
let stopped = await mustTransition(stopAdmission.root, {
  type: 'begin_attempt',
  kind: 'provider',
  parentAttemptId: null,
  at: hourIso(13, 1),
});
stopped = await mustTransition(stopped, { type: 'stop_requested', at: hourIso(13, 2) });
assert.equal(stopped.state, 'cancelled');
assert.equal(stopped.interruptLatch?.kind, 'stop_requested');
assert.equal(stopped.attempts[0].state, 'cancelled');
assert.equal(canActivateComputerTaskRoot(stopped), false);
const stoppedSerialized = await serializeComputerTaskRoot(stopped);
assert.equal(stoppedSerialized.ok, true);
if (!stoppedSerialized.ok) throw new Error(stoppedSerialized.message);
const stoppedDuplicate = await mustAdmit({
  ...baseAdmission,
  requestIdentity: 'message-stop-001',
  admittedAt: hourIso(13, 59),
  existing: stoppedSerialized.serialized,
});
assert.equal(stoppedDuplicate.disposition, 'duplicate');
assert.equal(stoppedDuplicate.root.state, 'cancelled');
assert.equal(stoppedDuplicate.root.revision, stopped.revision);
const stoppedRetry = await transitionComputerTaskRoot(stoppedDuplicate.root, stoppedDuplicate.root.revision, {
  type: 'begin_attempt',
  kind: 'recovery',
  parentAttemptId: stoppedDuplicate.root.attempts[0].attemptId,
  at: hourIso(13, 3),
});
assert.equal(stoppedRetry.ok, false);
if (!stoppedRetry.ok) assert.equal(stoppedRetry.code, 'terminal_root');

// Human foreground override revokes focus and can only settle already-dispatched proof.
const overrideAdmission = await mustAdmit({
  ...baseAdmission,
  requestIdentity: 'message-override-001',
  admittedAt: hourIso(14, 0),
});
let overridden = await mustTransition(overrideAdmission.root, {
  type: 'begin_attempt',
  kind: 'deterministic',
  parentAttemptId: null,
  at: hourIso(14, 1),
});
overridden = await mustTransition(overridden, {
  type: 'bind_acceptance',
  attemptId: overridden.attempts[0].attemptId,
  actions: [{
    tool: 'desktop.focus_app',
    toolArgsFingerprint: ARGS_A,
    authorizationFingerprint: AUTH_A,
    mutatesState: true,
    requiresForegroundLease: true,
  }],
  predicateFingerprints: [PREDICATE],
  at: hourIso(14, 2),
});
const overrideActionId = overridden.acceptance!.actions[0].actionId;
overridden = await mustBindDispatch(overridden, {
  actionId: overrideActionId,
  source: 'deterministic',
  authorizationCategory: 'direct_request',
  mutationAuthority: 'action_ledger',
  at: hourIso(14, 3),
});
overridden = await mustTransition(overridden, {
  type: 'record_action_state',
  actionId: overrideActionId,
  nextState: 'claimed',
  proofFingerprint: null,
  at: hourIso(14, 3),
});
const stopWhileClaimed = await transitionComputerTaskRoot(overridden, overridden.revision, {
  type: 'stop_requested',
  at: hourIso(14, 4),
});
assert.equal(stopWhileClaimed.ok, false);
if (!stopWhileClaimed.ok) assert.equal(stopWhileClaimed.code, 'invalid_transition');
const overrideWhileClaimed = await transitionComputerTaskRoot(overridden, overridden.revision, {
  type: 'human_foreground_override',
  at: hourIso(14, 4),
});
assert.equal(overrideWhileClaimed.ok, false);
if (!overrideWhileClaimed.ok) assert.equal(overrideWhileClaimed.code, 'invalid_transition');
overridden = await mustTransition(overridden, {
  type: 'bind_foreground_lease',
  leaseId: 'foreground-lease-override',
  actionId: overrideActionId,
  targetFingerprint: TARGET,
  expiresAt: hourIso(14, 30),
  at: hourIso(14, 4),
});
overridden = await mustTransition(overridden, {
  type: 'record_action_state',
  actionId: overrideActionId,
  nextState: 'dispatched',
  proofFingerprint: null,
  at: hourIso(14, 5),
});
const stopWhileDispatched = await transitionComputerTaskRoot(overridden, overridden.revision, {
  type: 'stop_requested',
  at: hourIso(14, 6),
});
assert.equal(stopWhileDispatched.ok, false);
if (!stopWhileDispatched.ok) assert.equal(stopWhileDispatched.code, 'invalid_transition');
overridden = await mustTransition(overridden, {
  type: 'human_foreground_override',
  at: hourIso(14, 6),
});
assert.equal(overridden.state, 'verification_only');
assert.equal(overridden.replayPolicy, 'verification_only');
assert.equal(overridden.interruptLatch?.kind, 'human_foreground_override');
assert.equal(overridden.foregroundLease?.status, 'revoked');
assert.equal(canActivateComputerTaskRoot(overridden), false);

const overrideReactivation = await transitionComputerTaskRoot(overridden, overridden.revision, {
  type: 'begin_attempt',
  kind: 'recovery',
  parentAttemptId: overridden.attempts[0].attemptId,
  at: hourIso(14, 7),
});
assert.equal(overrideReactivation.ok, false);
if (!overrideReactivation.ok) assert.equal(overrideReactivation.code, 'interrupted_root');

overridden = await mustTransition(overridden, {
  type: 'record_action_state',
  actionId: overrideActionId,
  nextState: 'verified',
  proofFingerprint: PROOF_A,
  at: hourIso(14, 7),
});
const overrideCompletion = await transitionComputerTaskRoot(overridden, overridden.revision, {
  type: 'complete',
  acceptanceFingerprint: overridden.acceptance!.acceptanceFingerprint,
  proofFingerprint: PROOF_A,
  at: hourIso(14, 8),
});
assert.equal(overrideCompletion.ok, false);
if (!overrideCompletion.ok) assert.equal(overrideCompletion.code, 'interrupted_root');
overridden = await mustTransition(overridden, { type: 'stop_requested', at: hourIso(14, 9) });
assert.equal(overridden.state, 'cancelled');
assert.equal(overridden.interruptLatch?.kind, 'stop_requested');

// Crash-after-dispatch and outcome_unknown never reopen activation or ordinary failure/retry.
const unknownAdmission = await mustAdmit({
  ...baseAdmission,
  requestIdentity: 'message-unknown-001',
  admittedAt: hourIso(15, 0),
});
let unknown = await mustTransition(unknownAdmission.root, {
  type: 'begin_attempt',
  kind: 'provider',
  parentAttemptId: null,
  at: hourIso(15, 1),
});
unknown = await mustTransition(unknown, {
  type: 'bind_acceptance',
  attemptId: unknown.attempts[0].attemptId,
  actions: [{
    tool: 'browser.open_url',
    toolArgsFingerprint: ARGS_A,
    authorizationFingerprint: AUTH_A,
    mutatesState: true,
    requiresForegroundLease: false,
  }],
  predicateFingerprints: [PREDICATE],
  at: hourIso(15, 2),
});
const unknownActionId = unknown.acceptance!.actions[0].actionId;
unknown = await mustBindDispatch(unknown, {
  actionId: unknownActionId,
  source: 'provider',
  authorizationCategory: 'provider_native',
  mutationAuthority: 'provider_idempotency',
  at: hourIso(15, 3),
});
unknown = await mustTransition(unknown, {
  type: 'record_action_state',
  actionId: unknownActionId,
  nextState: 'claimed',
  proofFingerprint: null,
  at: hourIso(15, 3),
});
unknown = await mustTransition(unknown, {
  type: 'record_action_state',
  actionId: unknownActionId,
  nextState: 'dispatched',
  proofFingerprint: null,
  at: hourIso(15, 4),
});
assert.equal(unknown.state, 'verification_only');
const dispatchedSnapshot = await serializeComputerTaskRoot(unknown);
assert.equal(dispatchedSnapshot.ok, true);
if (!dispatchedSnapshot.ok) throw new Error(dispatchedSnapshot.message);
const dispatchedHydration = await hydrateComputerTaskRoot(dispatchedSnapshot.serialized);
assert.equal(dispatchedHydration.ok, true);
if (!dispatchedHydration.ok) throw new Error(dispatchedHydration.message);
assert.equal(canActivateComputerTaskRoot(dispatchedHydration.root), false);
const dispatchedRetry = await transitionComputerTaskRoot(unknown, unknown.revision, {
  type: 'begin_attempt',
  kind: 'recovery',
  parentAttemptId: unknown.attempts[0].attemptId,
  at: hourIso(15, 5),
});
assert.equal(dispatchedRetry.ok, false);
if (!dispatchedRetry.ok) assert.equal(dispatchedRetry.code, 'interrupted_root');
unknown = await mustTransition(unknown, {
  type: 'record_action_state',
  actionId: unknownActionId,
  nextState: 'outcome_unknown',
  proofFingerprint: null,
  at: hourIso(15, 5),
});
assert.equal(unknown.state, 'verification_only');
assert.equal(unknown.replayPolicy, 'verification_only');
const stopWhileOutcomeUnknown = await transitionComputerTaskRoot(unknown, unknown.revision, {
  type: 'stop_requested',
  at: hourIso(15, 6),
});
assert.equal(stopWhileOutcomeUnknown.ok, false);
if (!stopWhileOutcomeUnknown.ok) assert.equal(stopWhileOutcomeUnknown.code, 'invalid_transition');
const unknownFailure = await transitionComputerTaskRoot(unknown, unknown.revision, {
  type: 'fail',
  at: hourIso(15, 6),
});
assert.equal(unknownFailure.ok, false);
if (!unknownFailure.ok) assert.equal(unknownFailure.code, 'interrupted_root');
unknown = await mustTransition(unknown, {
  type: 'append_checkpoint',
  checkpointId: 'checkpoint-unknown-verification',
  attemptId: unknown.attempts[0].attemptId,
  kind: 'verification',
  evidenceFingerprint: null,
  at: hourIso(15, 6),
});
const unknownReplayClaim = await transitionComputerTaskRoot(unknown, unknown.revision, {
  type: 'record_action_state',
  actionId: unknownActionId,
  nextState: 'claimed',
  proofFingerprint: null,
  at: hourIso(15, 7),
});
assert.equal(unknownReplayClaim.ok, false);
if (!unknownReplayClaim.ok) assert.equal(unknownReplayClaim.code, 'invalid_transition');
unknown = await mustTransition(unknown, {
  type: 'record_action_state',
  actionId: unknownActionId,
  nextState: 'verified',
  proofFingerprint: PROOF_A,
  at: hourIso(15, 7),
});
assert.equal(unknown.state, 'running');
assert.equal(unknown.replayPolicy, 'normal');
unknown = await mustTransition(unknown, {
  type: 'complete',
  acceptanceFingerprint: unknown.acceptance!.acceptanceFingerprint,
  proofFingerprint: PROOF_A,
  at: hourIso(15, 8),
});
assert.equal(unknown.state, 'completed');

// Proposal-only and unsupported bindings may be recorded for audit, but never claimed.
const nonExecutableBindings: ReadonlyArray<Readonly<{
  authorizationCategory: ComputerTaskActionAuthorizationCategory;
  mutationAuthority: ComputerTaskActionMutationAuthority;
}>> = [
  { authorizationCategory: 'direct_request', mutationAuthority: 'proposal_only' },
  { authorizationCategory: 'direct_request', mutationAuthority: 'unsupported' },
  { authorizationCategory: 'proposal_only', mutationAuthority: 'action_ledger' },
  { authorizationCategory: 'unsupported', mutationAuthority: 'action_ledger' },
];
for (let index = 0; index < nonExecutableBindings.length; index += 1) {
  const admission = await mustAdmit({
    ...baseAdmission,
    requestIdentity: `message-non-executable-${index}`,
    admittedAt: hourIso(16 + index, 0),
  });
  let denied = await mustTransition(admission.root, {
    type: 'begin_attempt',
    kind: 'capability_buildout',
    parentAttemptId: null,
    at: hourIso(16 + index, 1),
  });
  denied = await mustTransition(denied, {
    type: 'bind_acceptance',
    attemptId: denied.attempts[0].attemptId,
    actions: [{
      tool: 'desktop.unavailable_mutation',
      toolArgsFingerprint: ARGS_A,
      authorizationFingerprint: AUTH_A,
      mutatesState: true,
      requiresForegroundLease: false,
    }],
    predicateFingerprints: [PREDICATE],
    at: hourIso(16 + index, 2),
  });
  const deniedActionId = denied.acceptance!.actions[0].actionId;
  denied = await mustBindDispatch(denied, {
    actionId: deniedActionId,
    source: 'capability_buildout',
    authorizationCategory: nonExecutableBindings[index].authorizationCategory,
    mutationAuthority: nonExecutableBindings[index].mutationAuthority,
    at: hourIso(16 + index, 3),
  });
  if (index === 0) {
    const plannedAuditBinding = await serializeComputerTaskRoot(denied);
    assert.equal(plannedAuditBinding.ok, true);
    if (!plannedAuditBinding.ok) throw new Error(plannedAuditBinding.message);
    const forgedClaimedAuditBinding = JSON.parse(plannedAuditBinding.serialized) as any;
    forgedClaimedAuditBinding.acceptance.actions[0].state = 'claimed';
    assert.equal((await hydrateComputerTaskRoot(forgedClaimedAuditBinding)).ok, false);
  }
  const deniedClaim = await transitionComputerTaskRoot(denied, denied.revision, {
    type: 'record_action_state',
    actionId: deniedActionId,
    nextState: 'claimed',
    proofFingerprint: null,
    at: hourIso(16 + index, 4),
  });
  assert.equal(deniedClaim.ok, false);
  if (!deniedClaim.ok) assert.equal(deniedClaim.code, 'invalid_transition');
}

// Strict malformed hydration: exact keys, nested keys, action binding, accessors and cycles.
const rootJson = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
const extraTopLevel = { ...rootJson, surprise: true };
assert.equal((await hydrateComputerTaskRoot(extraTopLevel)).ok, false);

const extraRequest = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
extraRequest.request.rawTask = 'must never persist';
assert.equal((await hydrateComputerTaskRoot(extraRequest)).ok, false);

const tamperedTask = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
tamperedTask.taskFingerprint = fp('9');
assert.equal((await hydrateComputerTaskRoot(tamperedTask)).ok, false);

const tamperedAction = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
tamperedAction.acceptance.actions[0].toolArgsFingerprint = fp('8');
assert.equal((await hydrateComputerTaskRoot(tamperedAction)).ok, false);

const extraDispatchBindingField = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
extraDispatchBindingField.acceptance.actions[0].dispatchBinding.rawAuthorization = 'approve everything';
assert.equal((await hydrateComputerTaskRoot(extraDispatchBindingField)).ok, false);

const unknownDispatchCategory = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
unknownDispatchCategory.acceptance.actions[0].dispatchBinding.authorizationCategory = 'ambient_authority';
assert.equal((await hydrateComputerTaskRoot(unknownDispatchCategory)).ok, false);

const forgedDispatchFingerprint = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
forgedDispatchFingerprint.acceptance.actions[0].dispatchBinding.policyBindingFingerprint = 'sha256:forged';
assert.equal((await hydrateComputerTaskRoot(forgedDispatchFingerprint)).ok, false);

const missingClaimedDispatchBinding = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
missingClaimedDispatchBinding.acceptance.actions[0].dispatchBinding = null;
missingClaimedDispatchBinding.acceptance.actions[0].state = 'claimed';
assert.equal((await hydrateComputerTaskRoot(missingClaimedDispatchBinding)).ok, false);

const duplicateAction = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
duplicateAction.acceptance.actions[1] = { ...duplicateAction.acceptance.actions[0], index: 1 };
assert.equal((await hydrateComputerTaskRoot(duplicateAction)).ok, false);

const accessorRoot = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
Object.defineProperty(accessorRoot, 'rootId', { enumerable: true, get: () => rootJson.rootId });
assert.equal((await hydrateComputerTaskRoot(accessorRoot)).ok, false);

const cyclicRoot = JSON.parse(acceptanceSnapshot.serialized) as Record<string, any>;
cyclicRoot.request.threadId = cyclicRoot;
assert.equal((await hydrateComputerTaskRoot(cyclicRoot)).ok, false);

assert.equal((await hydrateComputerTaskRoot('{not json')).ok, false);
assert.equal((await hydrateComputerTaskRoot('{}')).ok, false);
assert.equal((await hydrateComputerTaskRoot({ ...rootJson, schemaVersion: 2 })).ok, false);

console.log('computer-task-root smoke: PASS');
console.log(JSON.stringify({
  refreshIdentity: true,
  duplicateAdmission: true,
  driftRejected: true,
  staleCasRejected: true,
  stopAndOverrideLatched: true,
  terminalReactivationRejected: true,
  crashAfterDispatchVerificationOnly: true,
  outcomeUnknownNoReplay: true,
  foregroundLeaseBound: true,
  orderedActionsEnforced: true,
  actionAcceptanceBound: true,
  actionDispatchBoundOnce: true,
  claimRequiresExecutableDispatchBinding: true,
  dispatchMutationParityEnforced: true,
  dispatchBindingHydratesWithoutSharedReference: true,
  malformedHydrationRejected: true,
  rawTaskPersisted: false,
}));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
