/** Adversarial proof for the runtime-private bounded workflow-review lease. */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import {
  buildChatPlanApprovalIntentFingerprint,
  buildChatRequestIdentityFingerprint,
  dispatchChatAutomationPlan,
  isIssuedChatPlanApprovalAuthority,
  type ChatPlanApprovalAuthority,
  type ChatTransportContext,
} from '../src/lib/runChatAutomationPlan';
import {
  buildComputerSequenceProgramManifest,
  compileComputerSequenceProgram,
} from '../src/lib/computerSequenceProgramCore';
import { buildComputerAppToolArgsFingerprintAsync } from '../src/lib/computerAppGrounding';
import {
  buildChatPlanToolActionManifestV1,
  buildChatPlanPolicyBindingDigestV1,
  buildOpenSwanToolApprovalDigest,
  buildOpenSwanWorkflowTargetBindingDigestV1,
  consumeOpenSwanWorkflowReviewActionV1,
  inspectOpenSwanWorkflowReviewActionV1,
  issueOpenSwanWorkflowReviewAuthorityV1,
  revokeOpenSwanWorkflowReviewAuthorityV1,
  validateChatPlanToolActionManifestV1,
  type ChatPlanToolActionManifestInputV1,
  type ChatPlanToolPolicySensitivityInputV1,
  type OpenSwanWorkflowReviewAuthorityV1,
} from '../src/lib/openswanToolApprovals';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const circleId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const threadId = '33333333-3333-4333-8333-333333333333';
const approvalId = '44444444-4444-4444-8444-444444444444';
const sourceRunId = '55555555-5555-4555-8555-555555555555';
const sourceMessageId = '66666666-6666-4666-8666-666666666666';
const requestIdentity = 'user-1720000000000-workflow-review';
const task = 'Open Photoshop and create a new document 5000 x 4000';
const multiActionLedgerReference = Object.freeze({
  schemaVersion: 1,
  ledgerId: 'process-private-workflow-ledger',
});

const plan = buildChatAutomationPlan({ message: task });
const program = compileComputerSequenceProgram(task);
assert(program && program.authorization.mode === 'chat_plan_approval');

const baseContext: ChatTransportContext = {
  circleId,
  userId,
  threadId,
  requestIdentity,
  chatMode: 'act',
};

async function mintClaimedPlanAuthority(): Promise<ChatPlanApprovalAuthority> {
  const approvalIntentFingerprint = await buildChatPlanApprovalIntentFingerprint(plan, baseContext);
  let captured: ChatPlanApprovalAuthority | undefined;
  const outcome = await dispatchChatAutomationPlan(plan, {
    ctx: baseContext,
    approvalGate: async () => ({
      pass: true,
      approvalId,
      authority: {
        schemaVersion: 1,
        kind: 'claimed_approval_row',
        approvalId,
        approvalIntentFingerprint,
      },
    }),
    handlers: {
      run_computer_task: async (_plan, context) => {
        captured = context.planApprovalAuthority;
        return {
          executionKind: 'run_computer_task',
          status: 'completed',
          message: 'captured',
        };
      },
    },
  });
  assert.equal(outcome.status, 'completed');
  assert(captured);
  return captured;
}

function policy(
  effectClass: 'reversible_non_secret' | 'send',
  floorCategory: null | 'send' = null,
): ChatPlanToolPolicySensitivityInputV1 {
  return {
    policyFamily: effectClass === 'send' ? 'coordination' : 'browser',
    approvalMode: 'ask',
    mutatesState: true,
    externalSideEffect: effectClass === 'send',
    mutationClassification: 'classified_mutation',
    floorCategory,
    effectClass,
    mutationAuthority: 'action_ledger',
    policyRevision: 1,
  };
}

const actionInputs: readonly ChatPlanToolActionManifestInputV1[] = [
  {
    actionIndex: 0,
    actionId: 'field.title',
    toolName: 'browser.fill_field',
    args: { pageId: 'page-1', targetFingerprint: 'target-title', valueHash: 'value-a' },
    policySensitivity: policy('reversible_non_secret'),
  },
  {
    actionIndex: 1,
    actionId: 'toggle.feature',
    toolName: 'browser.set_toggle',
    args: { pageId: 'page-1', targetFingerprint: 'target-toggle', desiredState: true },
    policySensitivity: policy('reversible_non_secret'),
  },
  {
    actionIndex: 2,
    actionId: 'send.notice',
    toolName: 'gmail.write',
    args: { draftFingerprint: 'draft-1', recipientCount: 1 },
    policySensitivity: policy('send', 'send'),
  },
];

const callBindings = actionInputs.map((action, index) => ({
  actionIndex: index,
  sourceToolUseId: `tool-use-${index + 1}`,
  sourceIteration: 1,
  sourceCallOrdinal: index + 1,
  effectClass: action.policySensitivity.effectClass as 'reversible_non_secret' | 'send',
  args: action.args,
  policySensitivity: action.policySensitivity,
  targetBinding: action.args,
}));

async function mintWorkflowAuthority(): Promise<OpenSwanWorkflowReviewAuthorityV1> {
  const planAuthority = await mintClaimedPlanAuthority();
  const requestIdentityFingerprint = await buildChatRequestIdentityFingerprint({
    circleId,
    userId,
    threadId,
    requestIdentity,
  });
  const programFingerprint = await buildComputerAppToolArgsFingerprintAsync(
    buildComputerSequenceProgramManifest(program),
  );
  const manifest = await buildChatPlanToolActionManifestV1({
    rootRunId: sourceRunId,
    requestIdentityFingerprint,
    orderedActions: actionInputs,
  });
  assert(manifest);
  assert(await validateChatPlanToolActionManifestV1(manifest), 'manifest validates immediately before issuance');
  assert(isIssuedChatPlanApprovalAuthority(planAuthority, {
    circleId,
    userId,
    threadId,
    executionKind: 'run_computer_task',
    approvalIntentFingerprint: planAuthority.approvalIntentFingerprint,
    requestIdentityFingerprint,
    programId: program.id,
    programFingerprint,
  }), 'source plan authority remains branded and exact');
  for (let index = 0; index < actionInputs.length; index += 1) {
    const action = actionInputs[index]!;
    assert.equal(await buildOpenSwanToolApprovalDigest(action.toolName, action.args), manifest.orderedActions[index]!.toolApprovalDigest);
    assert.equal(await buildChatPlanPolicyBindingDigestV1(action.toolName, action.policySensitivity), manifest.orderedActions[index]!.policyBindingDigest);
    assert.match(await buildOpenSwanWorkflowTargetBindingDigestV1(action.toolName, action.args), /^target-v1:sha256:[0-9a-f]{64}$/);
  }
  const authority = await issueOpenSwanWorkflowReviewAuthorityV1({
    planApprovalAuthority: planAuthority,
    planApprovalExpected: {
      executionKind: 'run_computer_task',
      approvalIntentFingerprint: planAuthority.approvalIntentFingerprint,
      programId: program.id,
      programFingerprint,
    },
    sourceRunId,
    sourceMessageId,
    userId,
    circleId,
    threadId,
    manifest,
    multiActionLedgerReference,
    orderedActionBindings: callBindings,
    expiresAtMs: Date.now() + 5 * 60_000,
  });
  assert(authority);
  return authority;
}

function identity(index: number) {
  return {
    sourceRunId,
    sourceMessageId,
    userId,
    circleId,
    threadId,
    toolName: actionInputs[index]!.toolName,
    toolUseId: callBindings[index]!.sourceToolUseId,
    iteration: callBindings[index]!.sourceIteration,
    sourceCallOrdinal: callBindings[index]!.sourceCallOrdinal,
    multiActionLedgerReference,
  };
}

async function consume(
  authority: OpenSwanWorkflowReviewAuthorityV1,
  index: number,
  overrides: Partial<Parameters<typeof consumeOpenSwanWorkflowReviewActionV1>[1]> = {},
) {
  const action = actionInputs[index]!;
  return consumeOpenSwanWorkflowReviewActionV1(authority, {
    ...identity(index),
    args: action.args,
    policySensitivity: action.policySensitivity,
    targetBinding: action.args,
    ...overrides,
  });
}

async function main() {
  const authority = await mintWorkflowAuthority();
  assert(Object.isFrozen(authority));
  assert.equal(authority.actionCount, 3);
  assert.equal(authority.reviewApprovalId, approvalId);
  assert.match(
    String(authority.multiActionLedgerBindingDigest),
    /^target-v1:sha256:[0-9a-f]{64}$/,
  );
  assert(!JSON.stringify(authority).includes('value-a'), 'public authority contains no raw args');
  assert(
    !JSON.stringify(authority).includes('process-private-workflow-ledger'),
    'public authority contains only the ledger digest, never its process-private reference',
  );

  const forged = { ...authority } as OpenSwanWorkflowReviewAuthorityV1;
  assert.equal(
    inspectOpenSwanWorkflowReviewActionV1(forged, identity(0)),
    null,
    'a serialized/copied shape is not workflow authority',
  );

  assert.equal(
    inspectOpenSwanWorkflowReviewActionV1(authority, { ...identity(0), circleId: userId }),
    null,
    'actor/scope drift fails closed',
  );
  assert.equal(
    inspectOpenSwanWorkflowReviewActionV1(authority, {
      ...identity(0),
      multiActionLedgerReference: { ...multiActionLedgerReference },
    }),
    null,
    'a copied multi-action ledger cannot inherit the reviewed workflow',
  );
  assert.equal(
    inspectOpenSwanWorkflowReviewActionV1(authority, identity(1)),
    null,
    'reordered calls fail closed before consuming authority',
  );

  const targetDriftAuthority = await mintWorkflowAuthority();
  const targetDrift = await consume(targetDriftAuthority, 0, {
    targetBinding: { ...actionInputs[0]!.args, targetFingerprint: 'different-target' },
  });
  assert.equal(targetDrift.kind, 'blocked');
  assert(inspectOpenSwanWorkflowReviewActionV1(targetDriftAuthority, identity(0)),
    'target drift does not burn the expected action');

  const policyDriftAuthority = await mintWorkflowAuthority();
  const policyDrift = await consume(policyDriftAuthority, 0, {
    policySensitivity: { ...actionInputs[0]!.policySensitivity, policyRevision: 2 },
  });
  assert.equal(policyDrift.kind, 'blocked');

  const argsDriftAuthority = await mintWorkflowAuthority();
  const argsDrift = await consume(argsDriftAuthority, 0, {
    args: { ...actionInputs[0]!.args, valueHash: 'different-value' },
  });
  assert.equal(argsDrift.kind, 'blocked');

  const raceAuthority = await mintWorkflowAuthority();
  const race = await Promise.all([
    consume(raceAuthority, 0),
    consume(raceAuthority, 0),
  ]);
  assert.equal(race.filter((decision) => decision.kind === 'allowed').length, 1);
  assert.equal(race.filter((decision) => decision.kind === 'blocked').length, 1);
  assert(inspectOpenSwanWorkflowReviewActionV1(raceAuthority, identity(1)),
    'a competing consume cannot skip or double-consume the next action');

  const first = await consume(authority, 0);
  assert.equal(first.kind, 'allowed');
  assert(first.kind === 'allowed');
  assert.equal(first.receipt.source, 'workflow_review');
  assert.equal(first.receipt.approvalId, approvalId);
  assert.equal(first.receipt.toolName, 'browser.fill_field');

  const replay = await consume(authority, 0);
  assert.equal(replay.kind, 'blocked', 'one covered action cannot replay');

  const second = await consume(authority, 1);
  assert.equal(second.kind, 'allowed');
  const floor = await consume(authority, 2);
  assert.equal(floor.kind, 'exact_approval_required', 'external send remains a solo exact boundary');

  const expired = await mintWorkflowAuthority();
  assert.equal(
    inspectOpenSwanWorkflowReviewActionV1(expired, identity(0), Date.parse(expired.expiresAt)),
    null,
    'expiry is fail closed',
  );

  const revoked = await mintWorkflowAuthority();
  assert.equal(revokeOpenSwanWorkflowReviewAuthorityV1(revoked), true);
  assert.equal(inspectOpenSwanWorkflowReviewActionV1(revoked, identity(0)), null);
  assert.equal(revokeOpenSwanWorkflowReviewAuthorityV1(forged), false);

  console.log('openswan workflow review authority smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
