/** Behavioral smoke for exact Chat plan authority issuance and transposition. */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { buildComputerAppToolArgsFingerprintAsync } from '../src/lib/computerAppGrounding';
import {
  buildComputerSequenceDurableContractFingerprint,
  buildComputerSequenceProgramManifest,
  compileComputerSequenceProgram,
} from '../src/lib/computerSequenceProgramCore';
import {
  buildChatPlanApprovalIntentFingerprint,
  buildChatRequestIdentityFingerprint,
  dispatchChatAutomationPlan,
  isIssuedChatPlanApprovalAuthority,
  type ChatPlanApprovalAuthority,
  type ChatTransportContext,
} from '../src/lib/runChatAutomationPlan';
import {
  compactExactPlanApprovalCorrelation,
  exactPlanApprovalCorrelationMatchesScope,
  reconcileExactPlanApprovalRow,
  type ExactPlanApprovalExpectedScope,
} from '../src/lib/exactPlanApprovalContinuityCore';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const circleId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const threadId = '33333333-3333-4333-8333-333333333333';
const approvalId = '44444444-4444-4444-8444-444444444444';
const requestIdentity = 'user-1720000000000-exact-a';
const task = 'Open Photoshop and create a new document 5000 x 4000';
const plan = buildChatAutomationPlan({ message: task });
const program = compileComputerSequenceProgram(task);
assert(program && program.authorization.mode === 'chat_plan_approval');
assert.equal(plan.execution.kind, 'run_computer_task');
assert.equal(plan.execution.routeId, null, 'exact native program strips the legacy browser route');
const productionApprovalActionType = `chat.${plan.execution.kind}${
  plan.execution.routeId ? `.${plan.execution.routeId}` : ''
}`;
assert.equal(productionApprovalActionType, 'chat.run_computer_task');

const baseContext: ChatTransportContext = {
  circleId,
  userId,
  threadId,
  requestIdentity,
  chatMode: 'act',
};

async function dispatchWithGate(gate: Parameters<typeof dispatchChatAutomationPlan>[1]['approvalGate']) {
  let captured: ChatPlanApprovalAuthority | undefined;
  const outcome = await dispatchChatAutomationPlan(plan, {
    ctx: baseContext,
    approvalGate: gate,
    handlers: {
      run_computer_task: async (_plan, ctx) => {
        captured = ctx.planApprovalAuthority;
        return { executionKind: 'run_computer_task', status: 'completed', message: 'captured' };
      },
    },
  });
  assert.equal(outcome.status, 'completed');
  return captured;
}

async function main() {
  const approvalIntentFingerprint = await buildChatPlanApprovalIntentFingerprint(plan, baseContext);
  const requestIdentityFingerprint = await buildChatRequestIdentityFingerprint({
    circleId,
    userId,
    threadId,
    requestIdentity,
  });
  const programFingerprint = await buildComputerAppToolArgsFingerprintAsync(
    buildComputerSequenceProgramManifest(program),
  );

  const claimed = await dispatchWithGate(async () => ({
    pass: true,
    approvalId,
    authority: {
      schemaVersion: 1,
      kind: 'claimed_approval_row',
      approvalId,
      approvalIntentFingerprint,
    },
  }));
  assert(claimed, 'claimed row mints authority');
  assert.equal(claimed.authorizationSource, 'claimed_approval_row');
  assert.equal(claimed.approvalId, approvalId);
  assert(isIssuedChatPlanApprovalAuthority(claimed, {
    circleId,
    userId,
    threadId,
    executionKind: 'run_computer_task',
    approvalIntentFingerprint,
    requestIdentityFingerprint,
    programId: program.id,
    programFingerprint,
  }));

  const changedProgram = compileComputerSequenceProgram(
    'Open Photoshop and create a new document 5001 x 4000',
  );
  assert(changedProgram);
  const changedProgramFingerprint = await buildComputerAppToolArgsFingerprintAsync(
    buildComputerSequenceProgramManifest(changedProgram),
  );
  assert.equal(isIssuedChatPlanApprovalAuthority(claimed, {
    circleId,
    userId,
    threadId,
    executionKind: 'run_computer_task',
    approvalIntentFingerprint,
    requestIdentityFingerprint,
    programId: changedProgram.id,
    programFingerprint: changedProgramFingerprint,
  }), false, 'authority cannot transpose to different exact args/program');

  const otherRequestFingerprint = await buildChatRequestIdentityFingerprint({
    circleId,
    userId,
    threadId,
    requestIdentity: 'user-1720000000000-exact-b',
  });
  assert.equal(isIssuedChatPlanApprovalAuthority(claimed, {
    circleId,
    userId,
    threadId,
    executionKind: 'run_computer_task',
    approvalIntentFingerprint,
    requestIdentityFingerprint: otherRequestFingerprint,
    programId: program.id,
    programFingerprint,
  }), false, 'authority cannot transpose to a different submitted request');

  const policy = await dispatchWithGate(async () => ({
    pass: true,
    authority: {
      schemaVersion: 1,
      kind: 'policy_auto_waiver',
      approvalIntentFingerprint,
      policyCategory: 'desktop_action',
    },
  }));
  assert(policy, 'explicit standing policy waiver mints authority');
  assert.equal(policy.authorizationSource, 'policy_auto_waiver');
  assert.equal(policy.approvalId, null, 'policy waiver does not fabricate an approval row');
  assert.equal(policy.policyCategory, 'desktop_action');

  const claimedDurableContract = await buildComputerSequenceDurableContractFingerprint({
    program,
    requestIdentityFingerprint,
    approvalIntentFingerprint: claimed.approvalIntentFingerprint,
    fingerprint: buildComputerAppToolArgsFingerprintAsync,
  });
  const policyDurableContract = await buildComputerSequenceDurableContractFingerprint({
    program,
    requestIdentityFingerprint,
    approvalIntentFingerprint: policy.approvalIntentFingerprint,
    fingerprint: buildComputerAppToolArgsFingerprintAsync,
  });
  assert.equal(
    claimedDurableContract,
    policyDurableContract,
    'durable action identity survives a replacement approval row or policy source for the same exact request',
  );
  const changedIntentDurableContract = await buildComputerSequenceDurableContractFingerprint({
    program,
    requestIdentityFingerprint,
    approvalIntentFingerprint: otherRequestFingerprint,
    fingerprint: buildComputerAppToolArgsFingerprintAsync,
  });
  assert.notEqual(
    claimedDurableContract,
    changedIntentDurableContract,
    'durable action identity still rejects a different approval intent',
  );
  const changedProgramDurableContract = await buildComputerSequenceDurableContractFingerprint({
    program: changedProgram,
    requestIdentityFingerprint,
    approvalIntentFingerprint,
    fingerprint: buildComputerAppToolArgsFingerprintAsync,
  });
  assert.notEqual(
    claimedDurableContract,
    changedProgramDurableContract,
    'durable action identity still rejects different exact program arguments',
  );
  const changedRequestDurableContract = await buildComputerSequenceDurableContractFingerprint({
    program,
    requestIdentityFingerprint: otherRequestFingerprint,
    approvalIntentFingerprint,
    fingerprint: buildComputerAppToolArgsFingerprintAsync,
  });
  assert.notEqual(
    claimedDurableContract,
    changedRequestDurableContract,
    'durable action identity still rejects a different submitted request',
  );

  // A reload persists only bounded correlation values. It never persists raw
  // task text, approval payloads, credentials, or tokens, and the value is not
  // authority: the normal gate above still re-fingerprints + claims the row.
  const requestedAtMs = Date.parse('2026-08-06T16:00:00.000Z');
  const expiresAtMs = requestedAtMs + 15 * 60 * 1000;
  const expectedScope: ExactPlanApprovalExpectedScope = {
    circleId,
    threadId,
    userId,
    sessionKey: `chat::${threadId}`,
    actionType: productionApprovalActionType,
    programId: program.id,
    programFingerprint,
    requestIdentity,
    requestIdentityFingerprint,
    approvalIntentFingerprint,
  };
  const correlation = compactExactPlanApprovalCorrelation({
    schemaVersion: 1,
    approvalId,
    ...expectedScope,
    expiresAtMs,
    apiKey: 'must-not-survive',
    accessToken: 'must-not-survive',
    rawTask: task,
    payload: { secret: 'must-not-survive' },
  });
  assert(correlation, 'strict durable approval correlation accepts the complete exact binding');
  assert.deepEqual(
    Object.keys(correlation).sort(),
    [
      'actionType',
      'approvalId',
      'approvalIntentFingerprint',
      'circleId',
      'expiresAtMs',
      'programFingerprint',
      'programId',
      'requestIdentity',
      'requestIdentityFingerprint',
      'schemaVersion',
      'sessionKey',
      'threadId',
      'userId',
    ].sort(),
    'correlation projection drops credentials, raw task text, payloads, and unknown keys',
  );
  assert(exactPlanApprovalCorrelationMatchesScope(correlation, expectedScope));

  const baseRow = {
    id: approvalId,
    circle_id: circleId,
    session_key: `chat::${threadId}`,
    action_type: productionApprovalActionType,
    status: 'pending',
    requested_at: new Date(requestedAtMs).toISOString(),
    timeout_seconds: 15 * 60,
    resolved_at: null,
    resolved_by: null,
    applied_at: null,
    payload: {
      approvalSchemaVersion: 2,
      approvalIntentFingerprint,
      userId,
      threadId,
      redacted: true,
    },
  };
  assert.equal(
    reconcileExactPlanApprovalRow({
      correlation,
      expected: expectedScope,
      row: baseRow,
      nowMs: requestedAtMs + 1_000,
    }).kind,
    'pending',
    'fresh exact pending row remains waiting after hydration',
  );
  assert.equal(
    reconcileExactPlanApprovalRow({
      correlation,
      expected: expectedScope,
      row: {
        ...baseRow,
        status: 'approved',
        resolved_at: new Date(requestedAtMs + 2_000).toISOString(),
        // Another authenticated circle member may approve; requester identity
        // stays bound in payload/correlation and must not be replaced by approver.
        resolved_by: '66666666-6666-4666-8666-666666666666',
      },
      nowMs: requestedAtMs + 3_000,
    }).kind,
    'approved',
    'approval by another client/member reconciles through the exact requester-bound row',
  );
  assert.equal(
    reconcileExactPlanApprovalRow({
      correlation,
      expected: expectedScope,
      row: { ...baseRow, status: 'rejected' },
      nowMs: requestedAtMs + 3_000,
    }).kind,
    'rejected',
    'rejected exact row terminalizes instead of resuming',
  );
  assert.equal(
    reconcileExactPlanApprovalRow({
      correlation,
      expected: expectedScope,
      row: baseRow,
      nowMs: expiresAtMs,
    }).kind,
    'expired',
    'stale exact row terminalizes at the earliest bound expiry',
  );

  const adversarialDecisions = [
    reconcileExactPlanApprovalRow({
      correlation: { ...correlation, schemaVersion: 0 },
      expected: expectedScope,
      row: baseRow,
      nowMs: requestedAtMs + 1_000,
    }),
    reconcileExactPlanApprovalRow({
      correlation,
      expected: { ...expectedScope, threadId: '77777777-7777-4777-8777-777777777777' },
      row: baseRow,
      nowMs: requestedAtMs + 1_000,
    }),
    reconcileExactPlanApprovalRow({
      correlation,
      expected: { ...expectedScope, programFingerprint: changedProgramFingerprint },
      row: baseRow,
      nowMs: requestedAtMs + 1_000,
    }),
    reconcileExactPlanApprovalRow({
      correlation,
      expected: { ...expectedScope, requestIdentity: 'user-1720000000000-exact-b' },
      row: baseRow,
      nowMs: requestedAtMs + 1_000,
    }),
    reconcileExactPlanApprovalRow({
      correlation,
      expected: expectedScope,
      row: { ...baseRow, payload: { ...baseRow.payload, userId: '88888888-8888-4888-8888-888888888888' } },
      nowMs: requestedAtMs + 1_000,
    }),
    reconcileExactPlanApprovalRow({
      correlation,
      expected: expectedScope,
      row: {
        ...baseRow,
        status: 'approved',
        resolved_at: new Date(requestedAtMs + 500).toISOString(),
        resolved_by: '66666666-6666-4666-8666-666666666666',
        applied_at: new Date(requestedAtMs + 700).toISOString(),
      },
      nowMs: requestedAtMs + 1_000,
    }),
    reconcileExactPlanApprovalRow({
      correlation,
      expected: expectedScope,
      row: null,
      nowMs: requestedAtMs + 1_000,
    }),
  ];
  assert(
    adversarialDecisions.every((decision) => decision.kind === 'invalid'),
    'legacy, cross-thread, changed-program, changed-request, cross-user, consumed, and missing rows all fail closed',
  );

  const directProgram = compileComputerSequenceProgram(
    'Open Photoshop and create a new document 600 x 600',
  );
  assert(directProgram && directProgram.authorization.mode === 'direct_user_request');
  const stableDirectContract = await buildComputerSequenceDurableContractFingerprint({
    program: directProgram,
    requestIdentityFingerprint,
    fingerprint: buildComputerAppToolArgsFingerprintAsync,
  });
  const legacyDirectContract = await buildComputerAppToolArgsFingerprintAsync({
    schemaVersion: 1,
    source: 'compiler_exact_sequence',
    program: buildComputerSequenceProgramManifest(directProgram),
    authorization: {
      mode: 'direct_user_request',
      requestIdentityFingerprint,
    },
  });
  assert.equal(
    stableDirectContract,
    legacyDirectContract,
    'bounded direct-request ledger identity remains backward-compatible',
  );

  const ordinaryPass = await dispatchWithGate(async () => ({ pass: true }));
  assert.equal(ordinaryPass, undefined, 'ordinary no-approval pass cannot authorize an exact approval program');

  const mismatchedClaimIds = await dispatchWithGate(async () => ({
    pass: true,
    approvalId,
    authority: {
      schemaVersion: 1,
      kind: 'claimed_approval_row',
      approvalId: '55555555-5555-4555-8555-555555555555',
      approvalIntentFingerprint,
    },
  }));
  assert.equal(mismatchedClaimIds, undefined, 'display/authority approval-row mismatch fails closed');

  const mismatchedGrant = await dispatchWithGate(async () => ({
    pass: true,
    authority: {
      schemaVersion: 1,
      kind: 'policy_auto_waiver',
      approvalIntentFingerprint: `${approvalIntentFingerprint.slice(0, -1)}${approvalIntentFingerprint.endsWith('0') ? '1' : '0'}`,
      policyCategory: 'desktop_action',
    },
  }));
  assert.equal(mismatchedGrant, undefined, 'mismatched plan fingerprint fails closed');

  console.log('exact-program-authority smoke: all assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
