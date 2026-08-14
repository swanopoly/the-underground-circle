import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  admitComputerTaskAcceptanceRequestV1,
  applyComputerTaskAcceptanceReceiptV1,
  buildComputerTaskAcceptanceContractV1,
  claimComputerTaskAcceptanceActionV1,
  deriveAgentTaskTerminalOutcome,
  deriveComputerTaskTurnReplayGuard,
  deriveComputerTaskAdapterOutcomeStatus,
  deriveComputerTaskAgentOutcomeStatus,
  evaluateComputerTaskAcceptancePredicateV1,
  hasTerminalDesktopSequenceCompletionProof,
  issueComputerTaskAcceptanceReceiptV1,
  issueComputerTaskAcceptanceTypedActionReceiptV1,
  issueComputerTaskRequestAcceptanceV1,
  mapComputerTaskOutcomeToChatStatus,
  normalizeComputerTaskOutcomeStatus,
  sealComputerTaskAcceptanceActionEvidenceV1,
  structuredAgentTaskStatusFromTurnEvidence,
  summarizeComputerTaskTurnEvidence,
} from '../src/lib/computerTaskOutcome';

async function main(): Promise<void> {
const verifiedMutationMetadata = {
  mutationDispatchReceipt: {
    schemaVersion: 1,
    actionId: 'run:tool-1',
    tool: 'desktop.click_element',
    epochId: 'before-epoch',
    authorizedAt: '2026-08-05T12:00:00.000Z',
    dispatchedAt: '2026-08-05T12:00:01.000Z',
  },
  computerAppVerificationReceipt: {
    schemaVersion: 1,
    actionId: 'run:tool-1',
    beforeEpochId: 'before-epoch',
    afterEpochId: 'after-epoch',
    status: 'verified',
    canComplete: true,
    evidenceCount: 1,
    blockerCount: 0,
    checkedAt: '2026-08-05T12:00:02.000Z',
  },
};

const verifiedTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [{
    toolName: 'desktop.click_element',
    toolUseId: 'tool-1',
    dispatched: true,
    result: { ok: true, data: {}, metadata: verifiedMutationMetadata },
  }],
});
assert.equal(verifiedTurn.status, 'inconclusive', 'action proof alone cannot complete the outer user task');
assert.equal(verifiedTurn.verifiedMutationCount, 1, 'verified receipt pair is counted exactly once');
assert.equal(verifiedTurn.mutationIntegrity, 'verified', 'matched action receipts retain a verified mutation-integrity verdict');
assert.equal(verifiedTurn.taskCompletionVerified, false, 'action receipts never mint outer task acceptance');
assert.equal(verifiedTurn.reasonCode, 'actions_verified_task_proof_missing', 'summary names the missing task-level proof boundary');
assert.equal(structuredAgentTaskStatusFromTurnEvidence(verifiedTurn), null, 'action integrity cannot promote task completion in agentRuntime');
assert.deepEqual(
  deriveComputerTaskTurnReplayGuard({ evidence: verifiedTurn, taskKind: 'app_task' }),
  {
    manualVerifyOnly: true,
    mutationDispatched: true,
    verificationOnlyTools: ['desktop.observe_app'],
  },
  'a verified subset without outer task acceptance seals the original app task against replay',
);

const acceptanceRequestFingerprint = `args-v2:sha256:${'a'.repeat(64)}`;
const acceptanceStatusTargetFingerprint = `args-v2:sha256:${'1'.repeat(64)}`;
const acceptanceCreateTargetFingerprint = `args-v2:sha256:${'2'.repeat(64)}`;
const acceptanceStatusArgsFingerprint = `args-v2:sha256:${'d'.repeat(64)}`;
const acceptanceCreateArgsFingerprint = `args-v2:sha256:${'e'.repeat(64)}`;
const acceptanceContract = await buildComputerTaskAcceptanceContractV1({
  schemaVersion: 1,
  rootRequestFingerprint: acceptanceRequestFingerprint,
  orderedActions: [
    {
      actionId: 'compiler.photoshop.status.before.1',
      tool: 'desktop.photoshop_document_status',
      mutatesState: false,
      targetFingerprint: acceptanceStatusTargetFingerprint,
      toolArgsFingerprint: acceptanceStatusArgsFingerprint,
    },
    {
      actionId: 'compiler.photoshop.create.1',
      tool: 'desktop.photoshop_create_document',
      mutatesState: true,
      targetFingerprint: acceptanceCreateTargetFingerprint,
      toolArgsFingerprint: acceptanceCreateArgsFingerprint,
    },
  ],
  predicates: [
    {
      predicateId: 'photoshop.active_document_dimensions_exact',
      widthPx: 600,
      heightPx: 600,
    },
    {
      predicateId: 'desktop.named_app_frontmost',
      appIdentity: 'Adobe Photoshop',
    },
  ],
});
assert(acceptanceContract, 'a supported typed acceptance contract is compiled');
assert.match(
  acceptanceContract.acceptanceContractFingerprint,
  /^args-v2:sha256:[0-9a-f]{64}$/,
  'acceptance contract is bound by the existing cryptographic fingerprint helper',
);
assert(Object.isFrozen(acceptanceContract), 'acceptance contract is immutable');
assert(Object.isFrozen(acceptanceContract.orderedActions), 'ordered action contract is deeply frozen');
assert(Object.isFrozen(acceptanceContract.predicates), 'predicate contract is deeply frozen');
assert.throws(
  () => (acceptanceContract.orderedActions as Array<unknown>).push({}),
  'a contract cannot drift after its fingerprint is issued',
);

assert.equal(
  await buildComputerTaskAcceptanceContractV1({
    schemaVersion: 1,
    rootRequestFingerprint: acceptanceRequestFingerprint,
    orderedActions: [{
      actionId: 'one',
      tool: 'desktop.observe_app',
      mutatesState: false,
      targetFingerprint: acceptanceStatusTargetFingerprint,
      toolArgsFingerprint: acceptanceStatusArgsFingerprint,
    }],
    predicates: [{ predicateId: 'model.said_done' } as never],
  }),
  null,
  'unknown/model-authored predicates are outside the closed evaluator registry',
);
assert.equal(
  await buildComputerTaskAcceptanceContractV1({
    schemaVersion: 1,
    rootRequestFingerprint: acceptanceRequestFingerprint,
    orderedActions: [
      {
        actionId: 'duplicate',
        tool: 'desktop.observe_app',
        mutatesState: false,
        targetFingerprint: acceptanceStatusTargetFingerprint,
        toolArgsFingerprint: acceptanceStatusArgsFingerprint,
      },
      {
        actionId: 'duplicate',
        tool: 'desktop.observe_app',
        mutatesState: false,
        targetFingerprint: acceptanceStatusTargetFingerprint,
        toolArgsFingerprint: acceptanceStatusArgsFingerprint,
      },
    ],
    predicates: [{ predicateId: 'desktop.named_app_frontmost', appIdentity: 'Photoshop' }],
  }),
  null,
  'duplicate action identities are rejected at contract compilation',
);
assert.equal(
  await buildComputerTaskAcceptanceContractV1({
    schemaVersion: 1,
    rootRequestFingerprint: acceptanceRequestFingerprint,
    orderedActions: [{
      actionId: 'misclassified-create',
      tool: 'desktop.photoshop_create_document',
      mutatesState: false,
      targetFingerprint: acceptanceCreateTargetFingerprint,
      toolArgsFingerprint: acceptanceCreateArgsFingerprint,
    }],
    predicates: [{
      predicateId: 'photoshop.active_document_dimensions_exact',
      widthPx: 600,
      heightPx: 600,
    }],
  }),
  null,
  'caller-supplied mutation classification cannot downgrade a registered mutating tool',
);
assert.equal(
  await buildComputerTaskAcceptanceContractV1({
    schemaVersion: 1,
    rootRequestFingerprint: acceptanceRequestFingerprint,
    orderedActions: Array.from({ length: 65 }, (_, index) => ({
      actionId: `overflow.${index}`,
      tool: 'desktop.observe_app',
      mutatesState: false,
      targetFingerprint: acceptanceStatusTargetFingerprint,
      toolArgsFingerprint: acceptanceStatusArgsFingerprint,
    })),
    predicates: [{ predicateId: 'desktop.named_app_frontmost', appIdentity: 'Photoshop' }],
  }),
  null,
  'oversized action contracts fail closed',
);

assert.equal(
  await claimComputerTaskAcceptanceActionV1({
    contract: acceptanceContract,
    actionId: 'compiler.photoshop.create.1',
  }),
  null,
  'the runtime cannot claim actions out of manifest order',
);
const acceptanceObserveClaim = await claimComputerTaskAcceptanceActionV1({
  contract: acceptanceContract,
  actionId: 'compiler.photoshop.status.before.1',
});
assert(acceptanceObserveClaim, 'the runtime claims the first exact action');
assert(Object.isFrozen(acceptanceObserveClaim), 'an action claim is immutable');
assert.match(
  acceptanceObserveClaim.acceptanceActionBindingFingerprint,
  /^args-v2:sha256:[0-9a-f]{64}$/,
);

const acceptanceObserveSealInput = {
  schemaVersion: 1,
  contract: acceptanceContract,
  claim: acceptanceObserveClaim,
  terminalStatus: 'succeeded' as const,
  startedAt: '2026-08-06T12:00:00.100Z',
  completedAt: '2026-08-06T12:00:00.500Z',
};
assert.equal(
  await sealComputerTaskAcceptanceActionEvidenceV1({
    schemaVersion: 1,
    contract: acceptanceContract,
    acceptanceActionBindingFingerprint:
      acceptanceObserveClaim.acceptanceActionBindingFingerprint,
    actionId: acceptanceObserveClaim.actionId,
    tool: acceptanceObserveClaim.tool,
    mutatesState: acceptanceObserveClaim.mutatesState,
    terminalStatus: 'succeeded',
    startedAt: '2026-08-06T12:00:00.100Z',
    completedAt: '2026-08-06T12:00:00.500Z',
  } as never),
  null,
  'the legacy caller-shaped binding-string API cannot authorize evidence',
);
assert.equal(
  await sealComputerTaskAcceptanceActionEvidenceV1({
    ...acceptanceObserveSealInput,
    claim: { ...acceptanceObserveClaim },
  }),
  null,
  'a plain structural claim copy has no runtime authority',
);
assert.equal(
  await sealComputerTaskAcceptanceActionEvidenceV1({
    ...acceptanceObserveSealInput,
    claim: JSON.parse(JSON.stringify(acceptanceObserveClaim)),
  }),
  null,
  'a persisted JSON claim clone has no runtime authority',
);

const alternateAcceptanceContract = await buildComputerTaskAcceptanceContractV1({
  schemaVersion: 1,
  rootRequestFingerprint: `args-v2:sha256:${'c'.repeat(64)}`,
  orderedActions: acceptanceContract.orderedActions,
  predicates: acceptanceContract.predicates,
});
assert(alternateAcceptanceContract);
assert.equal(
  await sealComputerTaskAcceptanceActionEvidenceV1({
    ...acceptanceObserveSealInput,
    contract: alternateAcceptanceContract,
  }),
  null,
  'an exact action claim cannot cross its runtime-issued contract boundary',
);

const acceptanceObserveAction = await sealComputerTaskAcceptanceActionEvidenceV1({
  ...acceptanceObserveSealInput,
});
assert(acceptanceObserveAction, 'read-only action evidence is sealed');
assert.equal(
  await sealComputerTaskAcceptanceActionEvidenceV1(acceptanceObserveSealInput),
  null,
  'a successfully consumed action claim cannot be reused',
);

const acceptanceCreateClaim = await claimComputerTaskAcceptanceActionV1({
  contract: acceptanceContract,
  actionId: 'compiler.photoshop.create.1',
});
assert(acceptanceCreateClaim, 'the next action becomes claimable only after the prior seal');
assert.match(
  acceptanceCreateClaim.acceptanceActionBindingFingerprint,
  /^args-v2:sha256:[0-9a-f]{64}$/,
);

const acceptanceDispatchReceipt = {
  schemaVersion: 1 as const,
  actionId: 'compiler.photoshop.create.1',
  tool: 'desktop.photoshop_create_document',
  epochId: 'photoshop-before-epoch',
  contractBinding: JSON.stringify({
    schemaVersion: 1,
    actionId: 'compiler.photoshop.create.1',
    tool: 'desktop.photoshop_create_document',
    targetFingerprint: acceptanceCreateTargetFingerprint,
    toolArgsFingerprint: acceptanceCreateArgsFingerprint,
    privateValue: 'private-contract-binding-sentinel',
  }),
  policyBinding: 'private-policy-binding-sentinel',
  acceptanceActionBindingFingerprint: acceptanceCreateClaim.acceptanceActionBindingFingerprint,
  authorizedAt: '2026-08-06T12:00:00.750Z',
  dispatchedAt: '2026-08-06T12:00:01.000Z',
};
const acceptanceVerificationReceipt = {
  schemaVersion: 1 as const,
  actionId: 'compiler.photoshop.create.1',
  beforeEpochId: 'photoshop-before-epoch',
  afterEpochId: 'photoshop-after-epoch',
  status: 'verified' as const,
  predicate: 'runtime-owned action predicate; not outer task acceptance prose',
  evidenceIds: ['photoshop-after-evidence'],
  checkedAt: '2026-08-06T12:00:02.000Z',
  blockers: [],
  canComplete: true,
};
assert.equal(
  await sealComputerTaskAcceptanceActionEvidenceV1({
    schemaVersion: 1,
    contract: acceptanceContract,
    acceptanceActionBindingFingerprint:
      acceptanceCreateClaim.acceptanceActionBindingFingerprint,
    actionId: acceptanceCreateClaim.actionId,
    tool: acceptanceCreateClaim.tool,
    mutatesState: acceptanceCreateClaim.mutatesState,
    terminalStatus: 'succeeded',
    startedAt: '2026-08-06T12:00:00.750Z',
    completedAt: '2026-08-06T12:00:02.250Z',
    mutationDispatchReceipt: acceptanceDispatchReceipt,
    mutationVerificationReceipt: acceptanceVerificationReceipt,
  } as never),
  null,
  'copied binding strings and production-shaped mutation receipts are inert without the exact claim',
);
const acceptanceCreateAction = await sealComputerTaskAcceptanceActionEvidenceV1({
  schemaVersion: 1,
  contract: acceptanceContract,
  claim: acceptanceCreateClaim,
  terminalStatus: 'succeeded',
  startedAt: '2026-08-06T12:00:00.750Z',
  completedAt: '2026-08-06T12:00:02.250Z',
  mutationDispatchReceipt: acceptanceDispatchReceipt,
  mutationVerificationReceipt: acceptanceVerificationReceipt,
});
assert(acceptanceCreateAction, 'coherent dispatch/verification evidence is sealed');
assert(Object.isFrozen(acceptanceCreateAction), 'action evidence is immutable');
assert.doesNotMatch(
  JSON.stringify(acceptanceCreateAction),
  /private-(?:contract|policy)-binding-sentinel|claimKind|acceptanceActionBindingFingerprint/,
  'raw bindings and the ephemeral claim stay out of action evidence',
);
assert.equal(
  await sealComputerTaskAcceptanceActionEvidenceV1({
    schemaVersion: 1,
    contract: acceptanceContract,
    claim: acceptanceCreateClaim,
    terminalStatus: 'succeeded',
    startedAt: '2026-08-06T12:00:00.750Z',
    completedAt: '2026-08-06T12:00:02.250Z',
    mutationDispatchReceipt: acceptanceDispatchReceipt,
    mutationVerificationReceipt: acceptanceVerificationReceipt,
  }),
  null,
  'a consumed mutating action claim cannot be reused with copied receipt bindings',
);

const acceptanceTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [
    {
      toolName: 'desktop.photoshop_document_status',
      toolUseId: 'status-before',
      mutatesState: false,
      dispatched: true,
      result: { ok: true, data: {} },
    },
    {
      toolName: 'desktop.photoshop_create_document',
      toolUseId: 'create',
      mutatesState: true,
      dispatched: true,
      result: {
        ok: true,
        data: {},
        metadata: {
          mutationDispatchReceipt: acceptanceDispatchReceipt,
          computerAppVerificationReceipt: acceptanceVerificationReceipt,
        },
      },
    },
  ],
});
assert.equal(acceptanceTurn.taskCompletionVerified, false, 'base summarizer stays incapable of minting acceptance');
assert.equal(acceptanceTurn.status, 'inconclusive', 'supported evidence is still inconclusive before receipt issuance');

const dimensionsEvidence = await evaluateComputerTaskAcceptancePredicateV1({
  schemaVersion: 1,
  contract: acceptanceContract,
  predicateId: 'photoshop.active_document_dimensions_exact',
  sourceTool: 'desktop.photoshop_document_status',
  evidenceId: 'final-photoshop-document-status',
  observationEpochId: 'final-photoshop-status-epoch',
  observedAt: '2026-08-06T12:00:03.000Z',
  expiresAt: '2026-08-06T12:01:03.000Z',
  appRunning: true,
  hasActiveDocument: true,
  widthPx: 600,
  heightPx: 600,
});
const frontmostEvidence = await evaluateComputerTaskAcceptancePredicateV1({
  schemaVersion: 1,
  contract: acceptanceContract,
  predicateId: 'desktop.named_app_frontmost',
  sourceTool: 'desktop.observe_app',
  evidenceId: 'final-frontmost-observation',
  observationEpochId: 'final-frontmost-epoch',
  observedAt: '2026-08-06T12:00:03.100Z',
  expiresAt: '2026-08-06T12:01:03.100Z',
  frontmostAppIdentity: 'Adobe Photoshop',
});
assert(dimensionsEvidence && frontmostEvidence, 'trusted structured evaluators issue both requested predicate proofs');
assert(Object.isFrozen(dimensionsEvidence), 'predicate evidence is immutable');
assert.equal(
  await evaluateComputerTaskAcceptancePredicateV1({
    schemaVersion: 1,
    contract: acceptanceContract,
    predicateId: 'photoshop.active_document_dimensions_exact',
    sourceTool: 'desktop.photoshop_document_status',
    evidenceId: 'wrong-size',
    observationEpochId: 'wrong-size-epoch',
    observedAt: '2026-08-06T12:00:03.000Z',
    expiresAt: '2026-08-06T12:01:03.000Z',
    appRunning: true,
    hasActiveDocument: true,
    widthPx: 601,
    heightPx: 600,
  }),
  null,
  'a typed observation that does not satisfy the exact dimensions emits no proof',
);

const acceptanceIssueInput = {
  contract: acceptanceContract,
  rootRequestFingerprint: acceptanceRequestFingerprint,
  orderedActions: [acceptanceObserveAction, acceptanceCreateAction],
  orderedPredicateEvidence: [dimensionsEvidence, frontmostEvidence],
  evidenceSummary: acceptanceTurn,
  issuedAt: '2026-08-06T12:00:04.000Z',
} as const;

assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    rootRequestFingerprint: `args-v2:sha256:${'b'.repeat(64)}`,
  }),
  null,
  'root request drift is rejected',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    contract: {
      ...acceptanceContract,
      orderedActions: acceptanceContract.orderedActions.map((action) => ({ ...action })),
      predicates: acceptanceContract.predicates.map((predicate) => ({ ...predicate })),
    },
  }),
  null,
  'a JSON-shaped contract copy cannot forge runtime contract authority',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedActions: [{ ...acceptanceObserveAction }, acceptanceCreateAction],
  }),
  null,
  'a JSON-shaped action receipt copy cannot forge runtime evidence',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedPredicateEvidence: [{ ...dimensionsEvidence }, frontmostEvidence],
  }),
  null,
  'a JSON-shaped evaluator receipt copy cannot forge runtime evidence',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedActions: [acceptanceCreateAction, acceptanceObserveAction],
  }),
  null,
  'reordered action evidence is rejected',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedActions: [acceptanceObserveAction],
  }),
  null,
  'missing action evidence is rejected',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedActions: [acceptanceObserveAction, acceptanceCreateAction, acceptanceObserveAction],
  }),
  null,
  'extra action evidence is rejected',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedActions: [acceptanceObserveAction, acceptanceObserveAction],
  }),
  null,
  'duplicate action evidence is rejected',
);
const concurrentSealContract = await buildComputerTaskAcceptanceContractV1({
  schemaVersion: 1,
  rootRequestFingerprint: `args-v2:sha256:${'f'.repeat(64)}`,
  orderedActions: [{
    actionId: 'concurrent.observe.1',
    tool: 'desktop.observe_app',
    mutatesState: false,
    targetFingerprint: acceptanceStatusTargetFingerprint,
    toolArgsFingerprint: acceptanceStatusArgsFingerprint,
  }],
  predicates: [{ predicateId: 'desktop.named_app_frontmost', appIdentity: 'Photoshop' }],
});
assert(concurrentSealContract);
const concurrentSealClaim = await claimComputerTaskAcceptanceActionV1({
  contract: concurrentSealContract,
  actionId: 'concurrent.observe.1',
});
assert(concurrentSealClaim);
const concurrentSealInput = {
  schemaVersion: 1 as const,
  contract: concurrentSealContract,
  claim: concurrentSealClaim,
  terminalStatus: 'succeeded' as const,
  startedAt: '2026-08-06T12:00:00.100Z',
  completedAt: '2026-08-06T12:00:00.500Z',
};
const concurrentSealResults = await Promise.all([
  sealComputerTaskAcceptanceActionEvidenceV1(concurrentSealInput),
  sealComputerTaskAcceptanceActionEvidenceV1(concurrentSealInput),
]);
assert.equal(
  concurrentSealResults.filter(Boolean).length,
  1,
  'synchronous reservation gives concurrent double sealing exactly one winner',
);
assert.equal(
  await sealComputerTaskAcceptanceActionEvidenceV1(concurrentSealInput),
  null,
  'the concurrent winner consumes the claim permanently',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedPredicateEvidence: [frontmostEvidence, dimensionsEvidence],
  }),
  null,
  'reordered final evidence is rejected',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedPredicateEvidence: [dimensionsEvidence],
  }),
  null,
  'missing final evidence is rejected',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedPredicateEvidence: [dimensionsEvidence, frontmostEvidence, dimensionsEvidence],
  }),
  null,
  'extra/reused final evidence is rejected',
);

for (const terminalStatus of ['failed', 'cancelled', 'outcome_unknown'] as const) {
  const terminalContract = await buildComputerTaskAcceptanceContractV1({
    schemaVersion: 1,
    rootRequestFingerprint: `args-v2:sha256:${'b'.repeat(64)}`,
    orderedActions: [{
      actionId: `terminal.${terminalStatus}.1`,
      tool: 'desktop.observe_app',
      mutatesState: false,
      targetFingerprint: acceptanceStatusTargetFingerprint,
      toolArgsFingerprint: acceptanceStatusArgsFingerprint,
    }],
    predicates: [{ predicateId: 'desktop.named_app_frontmost', appIdentity: 'Photoshop' }],
  });
  assert(terminalContract);
  const terminalClaim = await claimComputerTaskAcceptanceActionV1({
    contract: terminalContract,
    actionId: `terminal.${terminalStatus}.1`,
  });
  assert(terminalClaim);
  const nonSuccessfulAction = await sealComputerTaskAcceptanceActionEvidenceV1({
    schemaVersion: 1,
    contract: terminalContract,
    claim: terminalClaim,
    terminalStatus,
    startedAt: '2026-08-06T12:00:00.100Z',
    completedAt: '2026-08-06T12:00:00.500Z',
  });
  assert(nonSuccessfulAction, `${terminalStatus} action evidence remains representable for fail-closed evaluation`);
  const terminalPredicate = await evaluateComputerTaskAcceptancePredicateV1({
    schemaVersion: 1,
    contract: terminalContract,
    predicateId: 'desktop.named_app_frontmost',
    sourceTool: 'desktop.observe_app',
    evidenceId: `terminal-${terminalStatus}-proof`,
    observationEpochId: `terminal-${terminalStatus}-epoch`,
    observedAt: '2026-08-06T12:00:01.000Z',
    expiresAt: '2026-08-06T12:01:01.000Z',
    frontmostAppIdentity: 'Photoshop',
  });
  assert(terminalPredicate);
  const terminalSummary = summarizeComputerTaskTurnEvidence({
    cleanTerminal: true,
    toolEvidence: [{
      toolName: 'desktop.observe_app',
      mutatesState: false,
      dispatched: true,
      result: { ok: true, data: {} },
    }],
  });
  assert.equal(
    await issueComputerTaskAcceptanceReceiptV1({
      contract: terminalContract,
      rootRequestFingerprint: terminalContract.rootRequestFingerprint,
      orderedActions: [nonSuccessfulAction],
      orderedPredicateEvidence: [terminalPredicate],
      evidenceSummary: terminalSummary,
      issuedAt: '2026-08-06T12:00:02.000Z',
    }),
    null,
    `${terminalStatus} terminal action cannot mint outer acceptance`,
  );
}

for (const invalidSummary of [
  { ...acceptanceTurn, cleanTerminal: false },
  { ...acceptanceTurn, status: 'failed' as const },
  { ...acceptanceTurn, outcomeUnknownCount: 1 },
  { ...acceptanceTurn, failedToolCount: 1 },
]) {
  assert.equal(
    await issueComputerTaskAcceptanceReceiptV1({
      ...acceptanceIssueInput,
      evidenceSummary: invalidSummary,
    }),
    null,
    'unclean, failed, or outcome-unknown terminal summaries fail closed',
  );
}

const preDispatchEvidence = await evaluateComputerTaskAcceptancePredicateV1({
  schemaVersion: 1,
  contract: acceptanceContract,
  predicateId: 'photoshop.active_document_dimensions_exact',
  sourceTool: 'desktop.photoshop_document_status',
  evidenceId: 'pre-dispatch-proof',
  observationEpochId: 'pre-dispatch-epoch',
  observedAt: '2026-08-06T12:00:00.900Z',
  expiresAt: '2026-08-06T12:01:00.900Z',
  appRunning: true,
  hasActiveDocument: true,
  widthPx: 600,
  heightPx: 600,
});
assert(preDispatchEvidence);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedPredicateEvidence: [preDispatchEvidence, frontmostEvidence],
  }),
  null,
  'proof captured before the final dispatch is rejected',
);

const staleEvidence = await evaluateComputerTaskAcceptancePredicateV1({
  schemaVersion: 1,
  contract: acceptanceContract,
  predicateId: 'photoshop.active_document_dimensions_exact',
  sourceTool: 'desktop.photoshop_document_status',
  evidenceId: 'stale-final-proof',
  observationEpochId: 'stale-final-epoch',
  observedAt: '2026-08-06T12:00:03.000Z',
  expiresAt: '2026-08-06T12:00:03.500Z',
  appRunning: true,
  hasActiveDocument: true,
  widthPx: 600,
  heightPx: 600,
});
assert(staleEvidence);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedPredicateEvidence: [staleEvidence, frontmostEvidence],
  }),
  null,
  'expired final proof is rejected',
);

const futureEvidence = await evaluateComputerTaskAcceptancePredicateV1({
  schemaVersion: 1,
  contract: acceptanceContract,
  predicateId: 'photoshop.active_document_dimensions_exact',
  sourceTool: 'desktop.photoshop_document_status',
  evidenceId: 'future-final-proof',
  observationEpochId: 'future-final-epoch',
  observedAt: '2026-08-06T12:00:05.000Z',
  expiresAt: '2026-08-06T12:01:05.000Z',
  appRunning: true,
  hasActiveDocument: true,
  widthPx: 600,
  heightPx: 600,
});
assert(futureEvidence);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    ...acceptanceIssueInput,
    orderedPredicateEvidence: [futureEvidence, frontmostEvidence],
  }),
  null,
  'future-dated final proof is rejected',
);

const acceptanceResult = await issueComputerTaskAcceptanceReceiptV1(acceptanceIssueInput);
assert(acceptanceResult, 'the exact complete action set and fresh typed evidence mint acceptance once');
assert.equal(acceptanceResult.evidenceSummary.status, 'completed');
assert.equal(acceptanceResult.evidenceSummary.taskCompletionVerified, true);
assert.equal(acceptanceResult.evidenceSummary.reasonCode, 'task_completion_verified');
assert.equal(acceptanceTurn.status, 'inconclusive', 'issuer upgrades a copy and never mutates the source summary');
assert.equal(acceptanceTurn.taskCompletionVerified, false, 'source summary remains fail-closed');
assert(Object.isFrozen(acceptanceResult.receipt), 'acceptance receipt is deeply immutable');
assert(Object.isFrozen(acceptanceResult.receipt.predicateIds), 'receipt predicate list is immutable');
assert.equal(
  acceptanceResult.receipt.requestAdmissionFingerprint,
  null,
  'the low-level issuer does not invent a persisted-root admission binding',
);
assert.match(acceptanceResult.receipt.orderedActionSetFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
assert.match(acceptanceResult.receipt.orderedEvidenceSetFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
assert.match(acceptanceResult.receipt.receiptFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
assert.doesNotMatch(
  JSON.stringify(acceptanceResult.receipt),
  /private-(?:contract|policy)-binding-sentinel|claimKind|acceptanceActionBindingFingerprint|"(?:rawArgs|path|content|widthPx|heightPx|appIdentity)"/i,
  'durable receipt contains only value-free digests, counts, IDs, and timestamps',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1(acceptanceIssueInput),
  null,
  'a contract/action/evidence set is single-use and cannot mint a second receipt',
);

const appliedAcceptance = await applyComputerTaskAcceptanceReceiptV1({
  receipt: acceptanceResult.receipt,
  rootRequestFingerprint: acceptanceRequestFingerprint,
  acceptanceContractFingerprint: acceptanceContract.acceptanceContractFingerprint,
  evidenceSummary: { ...acceptanceTurn },
});
assert.equal(appliedAcceptance?.status, 'completed', 'issued receipt applies to a matching summary copy');
assert.equal(
  await applyComputerTaskAcceptanceReceiptV1({
    receipt: { ...acceptanceResult.receipt },
    rootRequestFingerprint: acceptanceRequestFingerprint,
    acceptanceContractFingerprint: acceptanceContract.acceptanceContractFingerprint,
    evidenceSummary: acceptanceTurn,
  }),
  null,
  'a JSON-shaped receipt copy cannot forge completion authority',
);
assert.equal(
  await applyComputerTaskAcceptanceReceiptV1({
    receipt: acceptanceResult.receipt,
    rootRequestFingerprint: acceptanceRequestFingerprint,
    acceptanceContractFingerprint: acceptanceContract.acceptanceContractFingerprint,
    evidenceSummary: { ...acceptanceTurn, toolResultCount: 1 },
  }),
  null,
  'an issued receipt cannot be reused against a drifted summary',
);

const adapterRequestFingerprint = `args-v2:sha256:${'3'.repeat(64)}`;
const adapterTargetFingerprint = `args-v2:sha256:${'4'.repeat(64)}`;
const adapterObserveArgsFingerprint = `args-v2:sha256:${'6'.repeat(64)}`;
const adapterWaitArgsFingerprint = `args-v2:sha256:${'7'.repeat(64)}`;
const adapterRootRunId = '44444444-4444-4444-8444-444444444444';
const adapterUserId = '55555555-5555-4555-8555-555555555555';
const adapterCircleId = '66666666-6666-4666-8666-666666666666';
const adapterContract = await buildComputerTaskAcceptanceContractV1({
  schemaVersion: 1,
  rootRequestFingerprint: adapterRequestFingerprint,
  orderedActions: [
    {
      actionId: 'adapter.observe.1',
      tool: 'desktop.observe_app',
      mutatesState: false,
      targetFingerprint: adapterTargetFingerprint,
      toolArgsFingerprint: adapterObserveArgsFingerprint,
    },
    {
      actionId: 'adapter.wait.2',
      tool: 'desktop.wait_for_app',
      mutatesState: false,
      targetFingerprint: adapterTargetFingerprint,
      toolArgsFingerprint: adapterWaitArgsFingerprint,
    },
  ],
  predicates: [{
    predicateId: 'desktop.named_app_frontmost',
    appIdentity: 'Adobe Photoshop',
  }],
});
assert(adapterContract, 'request adapter starts from the existing closed-world contract compiler');

assert.equal(
  await admitComputerTaskAcceptanceRequestV1({
    schemaVersion: 1,
    contract: adapterContract,
    rootRunId: adapterRootRunId,
    userId: adapterUserId,
    circleId: adapterCircleId,
    requestIdentityFingerprint: `args-v2:sha256:${'8'.repeat(64)}`,
    rootRequestFingerprint: adapterRequestFingerprint,
  }),
  null,
  'request/root fingerprint drift cannot be admitted',
);
assert.equal(
  await admitComputerTaskAcceptanceRequestV1({
    schemaVersion: 1,
    contract: adapterContract,
    rootRunId: 'not-a-root-run',
    userId: adapterUserId,
    circleId: adapterCircleId,
    requestIdentityFingerprint: adapterRequestFingerprint,
    rootRequestFingerprint: adapterRequestFingerprint,
  }),
  null,
  'an invalid persisted-root identity fails closed',
);
const adapterAdmission = await admitComputerTaskAcceptanceRequestV1({
  schemaVersion: 1,
  contract: adapterContract,
  rootRunId: adapterRootRunId,
  userId: adapterUserId,
  circleId: adapterCircleId,
  requestIdentityFingerprint: adapterRequestFingerprint,
  rootRequestFingerprint: adapterRequestFingerprint,
});
assert(adapterAdmission, 'an authenticated root/request identity is bound to the exact contract');
assert(Object.isFrozen(adapterAdmission), 'request admission is immutable');
assert.match(adapterAdmission.requestAdmissionFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
assert.equal(
  await admitComputerTaskAcceptanceRequestV1({
    schemaVersion: 1,
    contract: adapterContract,
    rootRunId: adapterRootRunId,
    userId: adapterUserId,
    circleId: adapterCircleId,
    requestIdentityFingerprint: adapterRequestFingerprint,
    rootRequestFingerprint: adapterRequestFingerprint,
  }),
  null,
  'one contract cannot receive a second root/request admission',
);

const adapterObserveClaim = await claimComputerTaskAcceptanceActionV1({
  contract: adapterContract,
  actionId: 'adapter.observe.1',
});
assert(adapterObserveClaim);
const adapterObserveEvidence = await sealComputerTaskAcceptanceActionEvidenceV1({
  schemaVersion: 1,
  contract: adapterContract,
  claim: adapterObserveClaim,
  terminalStatus: 'succeeded',
  startedAt: '2026-08-06T13:00:00.000Z',
  completedAt: '2026-08-06T13:00:00.400Z',
});
assert(adapterObserveEvidence);
const adapterWaitClaim = await claimComputerTaskAcceptanceActionV1({
  contract: adapterContract,
  actionId: 'adapter.wait.2',
});
assert(adapterWaitClaim);
const adapterWaitEvidence = await sealComputerTaskAcceptanceActionEvidenceV1({
  schemaVersion: 1,
  contract: adapterContract,
  claim: adapterWaitClaim,
  terminalStatus: 'succeeded',
  startedAt: '2026-08-06T13:00:00.500Z',
  completedAt: '2026-08-06T13:00:01.000Z',
});
assert(adapterWaitEvidence);

const adapterObserveReceipt = await issueComputerTaskAcceptanceTypedActionReceiptV1({
  schemaVersion: 1,
  admission: adapterAdmission,
  contract: adapterContract,
  actionIndex: 0,
  actionEvidence: adapterObserveEvidence,
});
const adapterWaitReceipt = await issueComputerTaskAcceptanceTypedActionReceiptV1({
  schemaVersion: 1,
  admission: adapterAdmission,
  contract: adapterContract,
  actionIndex: 1,
  actionEvidence: adapterWaitEvidence,
});
assert(adapterObserveReceipt && adapterWaitReceipt, 'trusted action evidence becomes ordered typed receipts');
assert.equal(adapterObserveReceipt.targetFingerprint, adapterTargetFingerprint);
assert.match(adapterObserveReceipt.actionFingerprint, /^args-v2:sha256:[0-9a-f]{64}$/);
assert(Object.isFrozen(adapterObserveReceipt), 'typed action receipt is immutable');
assert.equal(
  await issueComputerTaskAcceptanceTypedActionReceiptV1({
    schemaVersion: 1,
    admission: adapterAdmission,
    contract: adapterContract,
    actionIndex: 0,
    actionEvidence: adapterObserveEvidence,
  }),
  null,
  'one action-evidence object cannot mint a second typed receipt',
);

const adapterTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [
    {
      toolName: 'desktop.observe_app',
      mutatesState: false,
      dispatched: true,
      result: { ok: true, data: {} },
    },
    {
      toolName: 'desktop.wait_for_app',
      mutatesState: false,
      dispatched: true,
      result: { ok: true, data: {} },
    },
  ],
});
assert.equal(adapterTurn.status, 'inconclusive');
assert.equal(adapterTurn.taskCompletionVerified, false);

const adapterFinalPredicate = await evaluateComputerTaskAcceptancePredicateV1({
  schemaVersion: 1,
  contract: adapterContract,
  predicateId: 'desktop.named_app_frontmost',
  sourceTool: 'desktop.observe_app',
  evidenceId: 'adapter-final-frontmost',
  observationEpochId: 'adapter-final-epoch',
  observedAt: '2026-08-06T13:00:02.000Z',
  expiresAt: '2026-08-06T13:01:02.000Z',
  frontmostAppIdentity: 'Adobe Photoshop',
});
const adapterStalePredicate = await evaluateComputerTaskAcceptancePredicateV1({
  schemaVersion: 1,
  contract: adapterContract,
  predicateId: 'desktop.named_app_frontmost',
  sourceTool: 'desktop.observe_app',
  evidenceId: 'adapter-stale-frontmost',
  observationEpochId: 'adapter-stale-epoch',
  observedAt: '2026-08-06T13:00:02.000Z',
  expiresAt: '2026-08-06T13:00:02.500Z',
  frontmostAppIdentity: 'Adobe Photoshop',
});
assert(adapterFinalPredicate && adapterStalePredicate);

const adapterIssueInput = {
  schemaVersion: 1 as const,
  admission: adapterAdmission,
  contract: adapterContract,
  rootRunId: adapterRootRunId,
  requestIdentityFingerprint: adapterRequestFingerprint,
  acceptanceContractFingerprint: adapterContract.acceptanceContractFingerprint,
  terminalStatus: 'succeeded' as const,
  orderedActionReceipts: [adapterObserveReceipt, adapterWaitReceipt],
  finalPredicateEvidence: [adapterFinalPredicate],
  evidenceSummary: adapterTurn,
  issuedAt: '2026-08-06T13:00:03.000Z',
};

assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    finalPredicateEvidence: [],
  }),
  null,
  'action receipts alone cannot certify the user request',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    finalPredicateEvidence: [adapterStalePredicate],
  }),
  null,
  'expired final predicate proof fails closed while preserving verification-only recovery',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    finalPredicateEvidence: [{ ...adapterFinalPredicate }],
  }),
  null,
  'a plain structural predicate copy is untrusted proof',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    terminalStatus: 'partial',
  }),
  null,
  'partial task state cannot mint request acceptance',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    terminalStatus: 'outcome_unknown',
  }),
  null,
  'outcome_unknown cannot mint request acceptance',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    rootRunId: '77777777-7777-4777-8777-777777777777',
  }),
  null,
  'root-run drift is rejected',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    requestIdentityFingerprint: `args-v2:sha256:${'8'.repeat(64)}`,
  }),
  null,
  'request identity drift is rejected',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    contract: {
      ...adapterContract,
      orderedActions: adapterContract.orderedActions.map((action) => ({ ...action })),
      predicates: adapterContract.predicates.map((predicate) => ({ ...predicate })),
    },
  }),
  null,
  'contract drift cannot cross the admitted root boundary',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    orderedActionReceipts: [adapterWaitReceipt, adapterObserveReceipt],
  }),
  null,
  'typed action receipts must remain in exact admitted order',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    orderedActionReceipts: [{
      ...adapterObserveReceipt,
      targetFingerprint: `args-v2:sha256:${'8'.repeat(64)}`,
      actionFingerprint: `args-v2:sha256:${'9'.repeat(64)}`,
    }, adapterWaitReceipt],
  }),
  null,
  'caller-shaped target/action digest drift is untrusted and rejected',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1({
    ...adapterIssueInput,
    evidenceSummary: { ...adapterTurn, outcomeUnknownCount: 1 },
  }),
  null,
  'an outcome-unknown turn summary cannot be accepted',
);
assert.equal(
  await issueComputerTaskAcceptanceReceiptV1({
    contract: adapterContract,
    rootRequestFingerprint: adapterRequestFingerprint,
    orderedActions: [adapterObserveEvidence, adapterWaitEvidence],
    orderedPredicateEvidence: [adapterFinalPredicate],
    evidenceSummary: adapterTurn,
    issuedAt: '2026-08-06T13:00:03.000Z',
  }),
  null,
  'an admitted contract cannot bypass the request-level adapter through the low-level issuer',
);

const adapterConcurrentResults = await Promise.all([
  issueComputerTaskRequestAcceptanceV1(adapterIssueInput),
  issueComputerTaskRequestAcceptanceV1(adapterIssueInput),
]);
const adapterResult = adapterConcurrentResults.find((result) => result !== null) || null;
assert.equal(
  adapterConcurrentResults.filter((result) => result !== null).length,
  1,
  'concurrent request acceptance has exactly one winner',
);
assert(adapterResult);
assert.equal(adapterResult.evidenceSummary.status, 'completed');
assert.equal(adapterResult.evidenceSummary.taskCompletionVerified, true);
assert.equal(
  adapterResult.receipt.requestAdmissionFingerprint,
  adapterAdmission.requestAdmissionFingerprint,
  'the sole receipt is bound to the admitted persisted root/request',
);
assert.doesNotMatch(
  JSON.stringify(adapterResult.receipt),
  new RegExp([adapterRootRunId, adapterUserId, adapterCircleId].join('|')),
  'the durable request receipt stores only root/request digests, never raw actor IDs',
);
assert.equal(
  await issueComputerTaskRequestAcceptanceV1(adapterIssueInput),
  null,
  'a successful request acceptance cannot replay',
);
assert.equal(
  await applyComputerTaskAcceptanceReceiptV1({
    receipt: adapterResult.receipt,
    rootRequestFingerprint: adapterRequestFingerprint,
    acceptanceContractFingerprint: adapterContract.acceptanceContractFingerprint,
    evidenceSummary: adapterTurn,
  }),
  null,
  'an admission-bound receipt cannot apply without the matching request admission digest',
);
assert.equal(
  (await applyComputerTaskAcceptanceReceiptV1({
    receipt: adapterResult.receipt,
    rootRequestFingerprint: adapterRequestFingerprint,
    acceptanceContractFingerprint: adapterContract.acceptanceContractFingerprint,
    requestAdmissionFingerprint: adapterAdmission.requestAdmissionFingerprint,
    evidenceSummary: adapterTurn,
  }))?.status,
  'completed',
  'the exact request-bound receipt upgrades only its matching ordinary summary',
);
assert.equal(adapterTurn.taskCompletionVerified, false, 'ordinary summaries remain incapable of self-certifying');

assert.equal(
  structuredAgentTaskStatusFromTurnEvidence({
    ...verifiedTurn,
    status: 'completed',
    taskCompletionVerified: false,
  }),
  null,
  'a completed label without the task-acceptance bit fails closed',
);
assert.equal(
  structuredAgentTaskStatusFromTurnEvidence({
    ...verifiedTurn,
    status: 'completed',
    taskCompletionVerified: true,
    reasonCode: 'task_completion_verified',
  }),
  'completed',
  'a future runtime-owned task-acceptance receipt can promote completion',
);

const proseOnlyTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [],
});
assert.equal(proseOnlyTurn.status, 'inconclusive', 'a clean prose-only turn is not computer-task proof');
assert.equal(structuredAgentTaskStatusFromTurnEvidence(proseOnlyTurn), null, 'inconclusive proof never becomes a structured completion override');

const mismatchedReceiptTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [{
    toolName: 'desktop.click_element',
    result: {
      ok: true,
      data: {},
      metadata: {
        ...verifiedMutationMetadata,
        computerAppVerificationReceipt: {
          ...verifiedMutationMetadata.computerAppVerificationReceipt,
          actionId: 'different-action',
        },
      },
    },
  }],
});
assert.equal(mismatchedReceiptTurn.status, 'inconclusive', 'a verification receipt for another action fails closed');

const mismatchedEpochTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [{
    toolName: 'desktop.click_element',
    result: {
      ok: true,
      data: {},
      metadata: {
        ...verifiedMutationMetadata,
        computerAppVerificationReceipt: {
          ...verifiedMutationMetadata.computerAppVerificationReceipt,
          beforeEpochId: 'different-before-epoch',
        },
      },
    },
  }],
});
assert.equal(mismatchedEpochTurn.verifiedMutationCount, 0, 'verification from another before-state cannot cover the dispatch');
assert.equal(mismatchedEpochTurn.status, 'inconclusive', 'epoch-incoherent proof fails closed');

const staleAfterEpochTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [{
    toolName: 'desktop.click_element',
    result: {
      ok: true,
      data: {},
      metadata: {
        ...verifiedMutationMetadata,
        computerAppVerificationReceipt: {
          ...verifiedMutationMetadata.computerAppVerificationReceipt,
          afterEpochId: 'before-epoch',
        },
      },
    },
  }],
});
assert.equal(staleAfterEpochTurn.verifiedMutationCount, 0, 'a same-epoch observation is not fresh after-state proof');

const preDispatchVerificationTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [{
    toolName: 'desktop.click_element',
    result: {
      ok: true,
      data: {},
      metadata: {
        ...verifiedMutationMetadata,
        computerAppVerificationReceipt: {
          ...verifiedMutationMetadata.computerAppVerificationReceipt,
          checkedAt: '2026-08-05T12:00:00.500Z',
        },
      },
    },
  }],
});
assert.equal(preDispatchVerificationTurn.verifiedMutationCount, 0, 'verification captured before dispatch cannot prove the mutation');

const mismatchedToolTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [{
    toolName: 'desktop.type_text',
    result: { ok: true, data: {}, metadata: verifiedMutationMetadata },
  }],
});
assert.equal(mismatchedToolTurn.verifiedMutationCount, 0, 'a receipt issued for another tool cannot cover this result row');
assert.equal(mismatchedToolTurn.status, 'inconclusive', 'cross-tool receipt reuse fails closed');

const staleThenMutatedTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [
    { toolName: 'desktop.click_element', result: { ok: true, data: {}, metadata: verifiedMutationMetadata } },
    {
      toolName: 'desktop.type_text',
      result: {
        ok: true,
        data: { outcomeUnknown: true },
        metadata: {
          mutationDispatchReceipt: {
            ...verifiedMutationMetadata.mutationDispatchReceipt,
            actionId: 'run:tool-2',
          },
        },
      },
    },
  ],
});
assert.equal(staleThenMutatedTurn.status, 'inconclusive', 'an earlier proof cannot cover a later unverified mutation');
assert.equal(staleThenMutatedTurn.outcomeUnknownCount, 1, 'later outcome-unknown mutation is retained in the value-free summary');

const failedReadAfterVerifiedMutation = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [
    { toolName: 'desktop.click_element', result: { ok: true, data: {}, metadata: verifiedMutationMetadata } },
    { result: { ok: false, error: 'final observation failed' } },
  ],
});
assert.equal(failedReadAfterVerifiedMutation.status, 'inconclusive', 'a failed final observation cannot complete the task');
assert.equal(failedReadAfterVerifiedMutation.mutationIntegrity, 'verified', 'the failed read does not erase the exact mutation-integrity receipt');

const uncoveredMutationAfterVerifiedMutation = summarizeComputerTaskTurnEvidence({
  cleanTerminal: true,
  toolEvidence: [
    { toolName: 'desktop.click_element', result: { ok: true, data: {}, metadata: verifiedMutationMetadata } },
    {
      mutatesState: true,
      dispatched: true,
      result: { ok: true, data: {} },
    },
  ],
});
assert.equal(uncoveredMutationAfterVerifiedMutation.status, 'inconclusive', 'a catalog mutation without a receipt cannot hide behind another verified action');

const interruptedVerifiedTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: false,
  toolEvidence: [{ toolName: 'desktop.click_element', result: { ok: true, data: {}, metadata: verifiedMutationMetadata } }],
});
assert.equal(interruptedVerifiedTurn.status, 'inconclusive', 'verified action receipts do not override an interrupted terminal boundary');
assert.equal(
  deriveComputerTaskTurnReplayGuard({ evidence: interruptedVerifiedTurn, taskKind: 'app_task' }).manualVerifyOnly,
  true,
  'continuation loss after a dispatched mutation becomes verify-only recovery',
);

const runtimeFailureAfterMutation = summarizeComputerTaskTurnEvidence({
  cleanTerminal: false,
  runtimeFailed: true,
  toolEvidence: [{
    toolName: 'desktop.click_element',
    result: { ok: true, data: {}, metadata: verifiedMutationMetadata },
  }],
});
assert.equal(runtimeFailureAfterMutation.status, 'inconclusive', 'runtime failure after dispatch is not mislabeled safe failure');
assert.equal(runtimeFailureAfterMutation.reasonCode, 'runtime_failed_after_mutation', 'post-dispatch runtime loss keeps its exact ambiguity reason');
assert.equal(structuredAgentTaskStatusFromTurnEvidence(runtimeFailureAfterMutation), null, 'post-dispatch runtime loss never emits a plain failed override');
assert.equal(
  deriveComputerTaskTurnReplayGuard({ evidence: runtimeFailureAfterMutation, taskKind: 'app_task' }).manualVerifyOnly,
  true,
  'runtime failure after dispatch seals the original mutation against retry',
);

const runtimeFailureBeforeTools = summarizeComputerTaskTurnEvidence({
  cleanTerminal: false,
  runtimeFailed: true,
  toolEvidence: [],
});
assert.equal(runtimeFailureBeforeTools.status, 'failed', 'runtime failure with zero tool dispatch remains an ordinary failure');
assert.equal(structuredAgentTaskStatusFromTurnEvidence(runtimeFailureBeforeTools), 'failed', 'pre-dispatch runtime failure stays structured failed');

assert.deepEqual(
  deriveComputerTaskTurnReplayGuard({ evidence: proseOnlyTurn, taskKind: 'app_task' }),
  { manualVerifyOnly: false, mutationDispatched: false, verificationOnlyTools: [] },
  'a prose-only failure with no dispatch proof does not fabricate a mutation latch',
);
assert.equal(
  deriveComputerTaskTurnReplayGuard({
    evidence: {
      ...verifiedTurn,
      status: 'completed',
      taskCompletionVerified: true,
      reasonCode: 'task_completion_verified',
    },
    taskKind: 'app_task',
  }).manualVerifyOnly,
  false,
  'a future outer task-acceptance receipt releases the replay guard after completion',
);

const cancelledTurn = summarizeComputerTaskTurnEvidence({
  cleanTerminal: false,
  cancelled: true,
  toolEvidence: [],
});
assert.equal(cancelledTurn.status, 'cancelled', 'runtime cancellation remains an authoritative structured terminal status');

assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: true, proofVerified: true }),
  'completed',
  'an explicitly proven successful deterministic adapter completes',
);
assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: true, proofVerified: false }),
  'partial',
  'a successful click/type sequence without after-state proof is only partial',
);
assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: true, proofVerified: true }),
  'completed',
  'a successful deterministic adapter with explicit after-state proof completes',
);
assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: false, proofVerified: false }),
  'failed',
  'a failed deterministic adapter is not completed',
);
assert.equal(
  deriveComputerTaskAdapterOutcomeStatus({ ok: false, proofVerified: false, blocked: true }),
  'blocked',
  'an adapter stop remains blocked',
);
assert.equal(
  hasTerminalDesktopSequenceCompletionProof([
    { kind: 'output_verification', ok: true },
  ]),
  true,
  'a successful terminal after-state verification proves the sequence',
);
assert.equal(
  hasTerminalDesktopSequenceCompletionProof([
    { kind: 'output_verification', ok: true },
    { kind: 'type_text', ok: true },
  ]),
  false,
  'a later mutation invalidates earlier sequence proof',
);
assert.equal(
  hasTerminalDesktopSequenceCompletionProof([
    { kind: 'type_text', ok: true },
    { kind: 'output_verification', ok: true },
  ]),
  true,
  'a successful after-state verification after the final mutation proves the sequence',
);

assert.equal(
  deriveAgentTaskTerminalOutcome({
    transportSuccess: true,
    expectation: 'verified_task',
  }).status,
  'inconclusive',
  'a prose response is not proof that a mutation completed',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    terminalOutcomeStatus: 'inconclusive',
  }),
  'blocked',
  'an unverified agent response without task progress fails closed',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    terminalOutcomeStatus: 'inconclusive',
    partialProgress: true,
  }),
  'partial',
  'an unverified agent response preserves known adapter progress',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    terminalOutcomeStatus: 'completed',
  }),
  'completed',
  'structured agent completion is authoritative',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({ success: false }),
  'failed',
  'AgentRunResult.success=false is authoritative even when a response exists',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({ success: false, partialProgress: true }),
  'partial',
  'a failed agent run after an adapter mutation is partial',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    capabilityBuildoutStatus: 'approval_required',
  }),
  'waiting_approval',
  'capability approval prevents completed',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    capabilityBuildoutStatus: 'requested',
  }),
  'blocked',
  'a requested buildout without task progress remains blocked',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    partialProgress: true,
    capabilityBuildoutStatus: 'requested',
  }),
  'partial',
  'a requested buildout preserves real partial progress',
);
assert.equal(
  deriveComputerTaskAgentOutcomeStatus({
    success: true,
    capabilityBuildoutStatus: 'failed',
  }),
  'failed',
  'a failed capability buildout prevents completed',
);

assert.equal(mapComputerTaskOutcomeToChatStatus('completed'), 'completed');
assert.equal(mapComputerTaskOutcomeToChatStatus('partial'), 'blocked');
assert.equal(mapComputerTaskOutcomeToChatStatus('waiting_approval'), 'deferred');
assert.equal(mapComputerTaskOutcomeToChatStatus('cancelled'), 'blocked');
assert.equal(normalizeComputerTaskOutcomeStatus('partial'), 'partial');
assert.equal(normalizeComputerTaskOutcomeStatus('made_up'), null);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const runtimeSource = readFileSync(`${repoRoot}/src/lib/computerTaskRuntime.ts`, 'utf8');
const agentRuntimeSource = readFileSync(`${repoRoot}/src/lib/agentRuntime.ts`, 'utf8');
const swanbotSource = readFileSync(`${repoRoot}/src/lib/swanbot.ts`, 'utf8');
const swanbotBatchSource = readFileSync(`${repoRoot}/src/lib/swanbotV2BatchRuntime.ts`, 'utf8');
const stateSource = readFileSync(`${repoRoot}/src/lib/computerTaskState.ts`, 'utf8');
const stateModelSource = readFileSync(`${repoRoot}/src/lib/computerTaskStateModel.ts`, 'utf8');
const chatSource = readFileSync(`${repoRoot}/src/screens/circles/tabs/ChatTab.tsx`, 'utf8');

assert.match(
  runtimeSource,
  /export interface ComputerTaskRuntimeResult\s*\{\s*\/\*\*[\s\S]*?status: ComputerTaskOutcomeStatus;/,
  'runtime result exposes an authoritative typed status',
);
assert.match(
  agentRuntimeSource,
  /taskTerminalOutcome: terminalOutcome/,
  'agent runs persist task proof separately from transport lifecycle',
);
assert.match(
  agentRuntimeSource,
  /getSwanBotTurnResult\(fullPrompt, swanContext\)/,
  'agentRuntime consumes the detailed SwanBot turn instead of collapsing verified receipts to text',
);
assert.match(
  agentRuntimeSource,
  /structuredStatus: structuredAgentTaskStatusFromTurnEvidence\(/,
  'runtime receipt evidence reaches the authoritative terminal outcome derivation',
);
assert.match(
  swanbotSource,
  /export async function getSwanBotTurnResult/,
  'SwanBot exposes one detailed orchestration result while retaining its text wrapper',
);
assert.match(
  swanbotSource,
  /executionSummary: summarizeComputerTaskTurnEvidence\(/,
  'edge continuation results preserve a value-free task evidence summary',
);
assert.match(
  swanbotBatchSource,
  /event\.kind === 'tool_call_result'[\s\S]{0,700}result: event\.result/,
  'typed batch loop collects hidden runtime tool receipts before text projection',
);
assert.match(
  swanbotBatchSource,
  /actions_verified_task_proof_missing|summarizeComputerTaskTurnEvidence/,
  'typed batch terminal return carries structured proof classification',
);
assert.match(
  agentRuntimeSource,
  /await updateRunStatus\(runId, 'completed'\)/,
  'a returned response completes transport without claiming task completion',
);
assert.match(
  runtimeSource,
  /terminalOutcomeStatus: retryResult\.terminalOutcome\.status/,
  'capability retry status comes from the typed task terminal outcome',
);
assert.match(
  runtimeSource,
  /terminalOutcomeStatus: result\.terminalOutcome\.status/,
  'main agent status comes from the typed task terminal outcome',
);
assert.match(runtimeSource, /completionExpectation: 'verified_task'/);
assert.match(
  runtimeSource,
  /else if \(result\.terminalOutcome\.status === 'completed'\)/,
  'inconclusive runs are not learned as successes',
);
assert.match(
  runtimeSource,
  /`inconclusive` is deliberately not learned as either success or/,
  'inconclusive runs are not learned as failures or capability-gap churn',
);
assert.equal(
  (runtimeSource.match(/retryAttempt\.terminalOutcomeStatus !== 'inconclusive'/g) || []).length,
  2,
  'both capability-buildout retry paths skip learning from inconclusive prose-only outcomes',
);
assert.match(
  runtimeSource,
  /isComputerTaskOutcomeComplete\(finalStatus\)/,
  'desktop traces only persist for authoritative completion',
);
assert.match(
  runtimeSource,
  /proofVerified: completionVerified/,
  'the remaining deterministic read-only file lane passes exact request-bound proof into outcome derivation',
);
assert(
  runtimeSource.includes('const requestedActionContract = buildChatComputerRequestedActionContract(args.task);')
    && /shouldRunDeterministicReadOnlyFileAdapter\s*=\s*[\s\S]{0,700}&& !requestedActionContract;/.test(runtimeSource),
  'the one-operation deterministic file adapter cannot consume a compound requested-action ledger',
);
assert.match(
  runtimeSource,
  /App, hybrid, open-path, conversion, and file-mutation tasks never execute[\s\S]{0,300}authenticated typed loop owns all mutations/,
  'app and mutation work no longer exits through the pre-agent deterministic lane',
);
assert.doesNotMatch(
  runtimeSource,
  /isCompletedDesktopSequence\) && !readyCapabilityBuildout\) \{[\s\S]{0,400}?status: 'completed'/,
  'desktop action sequence success is not stamped completed without proof',
);

const nativeHandlerStart = chatSource.indexOf('const result = await executeComputerTaskWithAgent({');
const nativeHandlerEnd = chatSource.indexOf('\n        onOutcome:', nativeHandlerStart);
assert(nativeHandlerStart >= 0 && nativeHandlerEnd > nativeHandlerStart, 'native computer handler source is present');
const nativeHandlerSource = chatSource.slice(nativeHandlerStart, nativeHandlerEnd);
assert.match(
  nativeHandlerSource,
  /status: mapComputerTaskOutcomeToChatStatus\(result\.status\)/,
  'Chat adapts the authoritative runtime status instead of stamping completed',
);

assert.match(
  chatSource,
  /const normalizedComputerTaskStatus = normalizeComputerTaskOutcomeStatus\(extra\?\.computerTaskStatus\)/,
  'rich status is normalized once at bot-message finalization',
);
assert.match(
  chatSource,
  /computerTaskStatus: normalizedComputerTaskStatus/,
  'rich status is copied into persisted bot-message metadata',
);
assert.match(
  chatSource,
  /const computerTaskOutcomeSignal = deriveComputerTaskChatOutcomeSignal\(normalizedComputerTaskStatus\)/,
  'authoritative computer status drives flywheel and cross-surface outcome truth',
);
assert.match(
  chatSource,
  /const browserPlanOutcomeSignal = deriveBrowserPlanChatOutcomeSignal\(extra\?\.browserPlans\)/,
  'browser plan lifecycle is classified instead of treating plan existence as completion',
);
assert.match(
  chatSource,
  /const stopMessageOutcomeSignal = deriveStopMessageChatOutcomeSignal\(content\)/,
  'runtime stop copy is classified before generic prose can stamp completion',
);
assert.match(stateModelSource, /outcomeStatus\?: ComputerTaskOutcomeStatus \| null/);
assert.match(stateSource, /outcomeStatus: normalizeComputerTaskOutcomeStatus\(parsed\.outcomeStatus\)/);
assert.doesNotMatch(
  stateSource,
  /outcomeStatus = sameTask \? previous\?\.outcomeStatus/,
  'a new active transition cannot inherit a stale terminal outcome',
);
assert.match(
  stateSource,
  /outcomeStatus: normalizeComputerTaskOutcomeStatus\(record\.outcomeStatus\)/,
  'task-state writes normalize only the outcome explicitly supplied by the caller',
);
assert.match(
  chatSource,
  /outcomeStatus: computerTaskStatus/,
  'rich status is copied into durable computer task state',
);
for (const match of chatSource.matchAll(/persistComputerTaskState\(\{/g)) {
  const callEnd = chatSource.indexOf('\n      });', match.index);
  const callSource = chatSource.slice(match.index, callEnd > match.index ? callEnd : match.index + 1600);
  assert.match(
    callSource,
    /outcomeStatus:/,
    `computer task state transition at source offset ${match.index} explicitly clears or sets the outcome`,
  );
}
assert.match(
  chatSource,
  /phase:\s*terminalStatus\s*===\s*'completed'\s*\?\s*'completed'\s*:\s*'blocked',\s*outcomeStatus:\s*terminalStatus/,
  'browser terminal writes completed only when coverage is verified and otherwise retains a blocked/partial task state',
);
assert.match(
  chatSource,
  /const terminalStatus:\s*ComputerTaskOutcomeStatus\s*=\s*outcomeStatus\s*===\s*'partial'[\s\S]{0,100}\?\s*'partial'[\s\S]{0,80}:\s*'completed'/,
  'compound cloud results cannot be promoted from end-turn to completed without outer task proof',
);
assert.match(
  chatSource,
  /phase: 'failed',\s*outcomeStatus: 'failed'/,
  'browser and exception failures write a failed terminal outcome',
);
assert.match(
  nativeHandlerSource,
  /computerTaskStatus: result\.status/,
  'Chat preserves the full authoritative status in outcome metadata',
);
assert.match(
  nativeHandlerSource,
  /taskCompletionVerified: result\.taskCompletionVerified === true/,
  'Chat preserves the separate runtime-owned outer task proof bit',
);
assert.doesNotMatch(
  nativeHandlerSource,
  /status:\s*['"]completed['"]/,
  'native/file/hybrid handler has no unconditional completed outcome',
);

console.log('computer task truthful outcome smoke passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
