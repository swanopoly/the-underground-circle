import { buildComputerAppToolArgsFingerprintAsync } from './computerAppGrounding';

/**
 * Authoritative terminal outcome for native, file, and hybrid computer tasks.
 *
 * Keep this contract independent from chat transport status. The chat
 * dispatcher currently has a coarser status union, so callers must preserve
 * this value in metadata even when adapting it for that outer envelope.
 */
export type ComputerTaskOutcomeStatus =
  | 'completed'
  | 'partial'
  | 'blocked'
  | 'needs_input'
  | 'waiting_approval'
  | 'failed'
  | 'cancelled';

/**
 * Mutation replay authority is independent from terminal status. A task can
 * be `partial` because post-change proof was lost after the mutation crossed
 * the bridge; that must never be converted into a generic retry.
 */
export type ComputerTaskReplayPolicy = 'normal' | 'manual_verify_only';

export type AgentTaskCompletionExpectation = 'response' | 'verified_task';

/**
 * Transport success and task completion are deliberately separate.
 *
 * `inconclusive` means the model returned a response, but the active runtime
 * did not expose structured evidence that the requested mutation completed.
 */
export type AgentTaskTerminalOutcomeStatus =
  | 'completed'
  | 'inconclusive'
  | 'failed'
  | 'cancelled';

export interface AgentTaskTerminalOutcome {
  status: AgentTaskTerminalOutcomeStatus;
  source: 'response_received' | 'structured_runtime' | 'transport_error';
  reason: string;
}

/**
 * Value-free terminal proof carried from the typed SwanBot tool loop back to
 * the parent agent runtime. The model never authors this object: it is derived
 * from runtime-owned dispatch and verification receipts after handlers return.
 *
 * `inconclusive` remains the conservative default. Matching dispatch and
 * verification receipts prove the integrity of individual mutations; they do
 * NOT prove that the outer user request and all of its acceptance criteria were
 * satisfied. Task completion therefore stays closed until a future
 * request-bound task-completion receipt is supplied by the parent runtime.
 * This still lets Chat retain real action proof without treating a prose
 * answer, raw click acknowledgement, or a verified subset of the task as
 * completion.
 */
export interface ComputerTaskTurnEvidenceSummary {
  schemaVersion: 1;
  status: AgentTaskTerminalOutcomeStatus;
  cleanTerminal: boolean;
  /** True only when a runtime-owned outer acceptance receipt exists. */
  taskCompletionVerified: boolean;
  /** Bounded integrity verdict for the mutations observed in this turn. */
  mutationIntegrity:
    | 'not_applicable'
    | 'verified'
    | 'inconclusive'
    | 'failed'
    | 'cancelled';
  /** Bounded read-only follow-up tools inferred from canonical tool families. */
  verificationOnlyTools: string[];
  toolResultCount: number;
  dispatchedMutationCount: number;
  verifiedMutationCount: number;
  failedToolCount: number;
  outcomeUnknownCount: number;
  reasonCode:
    | 'actions_verified_task_proof_missing'
    | 'task_completion_verified'
    | 'no_dispatched_mutation_proof'
    | 'mutation_verification_incomplete'
    | 'tool_failure_present'
    | 'terminal_boundary_incomplete'
    | 'runtime_failed_after_mutation'
    | 'runtime_failed'
    | 'cancelled';
}

/**
 * Closed-world task predicates that the runtime knows how to evaluate from
 * typed app observations. A model-authored sentence is never a predicate and
 * cannot be converted into one at this boundary.
 */
export type ComputerTaskAcceptancePredicateV1 =
  | {
      predicateId: 'photoshop.active_document_dimensions_exact';
      widthPx: number;
      heightPx: number;
    }
  | {
      predicateId: 'desktop.named_app_frontmost';
      appIdentity: string;
    };

export interface ComputerTaskAcceptanceActionContractV1 {
  actionId: string;
  tool: string;
  mutatesState: boolean;
  /** Digest of the exact app/window/document/object target, never raw target data. */
  targetFingerprint: string;
  /** Cryptographic digest of exact normalized tool arguments, never raw args. */
  toolArgsFingerprint: string;
}

export interface ComputerTaskAcceptanceContractDraftV1 {
  schemaVersion: 1;
  rootRequestFingerprint: string;
  orderedActions: ReadonlyArray<ComputerTaskAcceptanceActionContractV1>;
  predicates: ReadonlyArray<ComputerTaskAcceptancePredicateV1>;
}

/**
 * Exact, immutable outer-task acceptance contract. The fingerprint covers the
 * request identity, ordered action manifest, and typed predicate parameters.
 */
export interface ComputerTaskAcceptanceContractV1
  extends ComputerTaskAcceptanceContractDraftV1 {
  acceptanceContractFingerprint: string;
}

export type ComputerTaskAcceptanceActionTerminalStatusV1 =
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'outcome_unknown';

export interface ComputerTaskAcceptanceMutationDispatchReceiptInputV1 {
  schemaVersion: 1;
  actionId: string;
  tool: string;
  epochId: string;
  contractBinding: string;
  policyBinding: string;
  /** Root + acceptance-contract + exact-action binding stamped at dispatch. */
  acceptanceActionBindingFingerprint: string;
  authorizedAt: string;
  dispatchedAt: string;
}

export interface ComputerTaskAcceptanceMutationVerificationReceiptInputV1 {
  schemaVersion: 1;
  actionId: string;
  beforeEpochId: string;
  afterEpochId: string | null;
  status: 'verified' | 'failed' | 'inconclusive';
  predicate: string;
  evidenceIds: ReadonlyArray<string>;
  checkedAt: string;
  blockers: ReadonlyArray<string>;
  canComplete: boolean;
}

/**
 * Ephemeral authority to report exactly one planned action. The visible
 * fields are routing hints only: authority comes from the exact in-process
 * object identity registered by the runtime below. Persisted copies, JSON
 * clones, and copied binding fingerprints are inert.
 */
export interface ComputerTaskAcceptanceActionClaimV1 {
  schemaVersion: 1;
  claimKind: 'computer_task_acceptance_action';
  acceptanceContractFingerprint: string;
  actionIndex: number;
  actionId: string;
  tool: string;
  mutatesState: boolean;
  targetFingerprint: string;
  /** Supplied to the trusted dispatch envelope; never authority by itself. */
  acceptanceActionBindingFingerprint: string;
}

export interface ComputerTaskAcceptanceActionEvidenceInputV1 {
  schemaVersion: 1;
  contract: ComputerTaskAcceptanceContractV1;
  /** Exact, runtime-issued, single-use claim for the next ordered action. */
  claim: ComputerTaskAcceptanceActionClaimV1;
  terminalStatus: ComputerTaskAcceptanceActionTerminalStatusV1;
  startedAt: string;
  completedAt: string;
  mutationDispatchReceipt?: ComputerTaskAcceptanceMutationDispatchReceiptInputV1 | null;
  mutationVerificationReceipt?: ComputerTaskAcceptanceMutationVerificationReceiptInputV1 | null;
}

/**
 * Privacy-safe action evidence. Raw arguments, paths, content, contract JSON,
 * and policy JSON are deliberately replaced by one cryptographic binding.
 */
export interface ComputerTaskAcceptanceActionEvidenceV1 {
  schemaVersion: 1;
  acceptanceContractFingerprint: string;
  actionId: string;
  tool: string;
  mutatesState: boolean;
  targetFingerprint: string;
  terminalStatus: ComputerTaskAcceptanceActionTerminalStatusV1;
  startedAt: string;
  completedAt: string;
  mutation?: {
    dispatchEpochId: string;
    afterEpochId: string | null;
    authorizedAt: string;
    dispatchedAt: string;
    checkedAt: string;
    status: 'verified' | 'failed' | 'inconclusive';
    canComplete: boolean;
    evidenceIds: ReadonlyArray<string>;
    blockerCount: number;
    dispatchBindingFingerprint: string;
  };
}

export type ComputerTaskAcceptancePredicateEvaluationInputV1 =
  | {
      schemaVersion: 1;
      contract: ComputerTaskAcceptanceContractV1;
      predicateId: 'photoshop.active_document_dimensions_exact';
      sourceTool: 'desktop.photoshop_document_status';
      evidenceId: string;
      observationEpochId: string;
      observedAt: string;
      expiresAt: string;
      appRunning: boolean;
      hasActiveDocument: boolean;
      widthPx: number;
      heightPx: number;
    }
  | {
      schemaVersion: 1;
      contract: ComputerTaskAcceptanceContractV1;
      predicateId: 'desktop.named_app_frontmost';
      sourceTool: 'desktop.observe_app';
      evidenceId: string;
      observationEpochId: string;
      observedAt: string;
      expiresAt: string;
      frontmostAppIdentity: string;
    };

/** Value-free proof emitted only by the closed-world structured evaluator. */
export interface ComputerTaskAcceptancePredicateEvidenceV1 {
  schemaVersion: 1;
  acceptanceContractFingerprint: string;
  predicateId: ComputerTaskAcceptancePredicateV1['predicateId'];
  sourceTool: 'desktop.photoshop_document_status' | 'desktop.observe_app';
  evidenceId: string;
  observationEpochId: string;
  observedAt: string;
  expiresAt: string;
  evaluationFingerprint: string;
}

/**
 * Durable, value-free outer acceptance receipt. No raw tool arguments, file
 * paths, observed labels, document content, or model prose are retained.
 */
export interface ComputerTaskAcceptanceReceiptV1 {
  schemaVersion: 1;
  receiptKind: 'computer_task_acceptance';
  rootRequestFingerprint: string;
  acceptanceContractFingerprint: string;
  /** Non-null only when the request-level adapter bound an admitted persisted root. */
  requestAdmissionFingerprint: string | null;
  turnEvidenceFingerprint: string;
  orderedActionSetFingerprint: string;
  orderedEvidenceSetFingerprint: string;
  receiptFingerprint: string;
  actionCount: number;
  mutationCount: number;
  predicateIds: ReadonlyArray<ComputerTaskAcceptancePredicateV1['predicateId']>;
  lastMutationDispatchedAt: string | null;
  finalEvidenceObservedAt: string;
  issuedAt: string;
}

export interface ComputerTaskAcceptanceIssueResultV1 {
  receipt: ComputerTaskAcceptanceReceiptV1;
  evidenceSummary: ComputerTaskTurnEvidenceSummary;
}

/**
 * Persisted-root identity that the future computer-task runtime must validate
 * before calling `admitComputerTaskAcceptanceRequestV1`. This pure module does
 * not query Supabase and therefore never treats a caller-shaped row as proof;
 * the returned in-process object is the only admission capability accepted by
 * the request adapter.
 */
export interface ComputerTaskAcceptanceRequestAdmissionInputV1 {
  schemaVersion: 1;
  contract: ComputerTaskAcceptanceContractV1;
  rootRunId: string;
  userId: string;
  circleId: string;
  requestIdentityFingerprint: string;
  rootRequestFingerprint: string;
}

export interface ComputerTaskAcceptanceRequestAdmissionV1 {
  schemaVersion: 1;
  admissionKind: 'computer_task_acceptance_request';
  rootRunId: string;
  rootScopeFingerprint: string;
  requestIdentityFingerprint: string;
  rootRequestFingerprint: string;
  acceptanceContractFingerprint: string;
  requestAdmissionFingerprint: string;
}

/**
 * Request-scoped typed action receipt projected only from an existing branded
 * action-evidence object. The target and action fingerprints are independently
 * recomputed by the final adapter; copying the visible fields is inert.
 */
export interface ComputerTaskAcceptanceTypedActionReceiptV1 {
  schemaVersion: 1;
  receiptKind: 'computer_task_acceptance_typed_action';
  requestAdmissionFingerprint: string;
  acceptanceContractFingerprint: string;
  actionIndex: number;
  actionId: string;
  tool: string;
  targetFingerprint: string;
  toolArgsFingerprint: string;
  actionFingerprint: string;
  actionEvidence: ComputerTaskAcceptanceActionEvidenceV1;
}

export type ComputerTaskAcceptanceRequestTerminalStatusV1 =
  | 'succeeded'
  | 'partial'
  | 'blocked'
  | 'failed'
  | 'cancelled'
  | 'outcome_unknown';

export interface ComputerTaskRequestAcceptanceIssueInputV1 {
  schemaVersion: 1;
  admission: ComputerTaskAcceptanceRequestAdmissionV1;
  contract: ComputerTaskAcceptanceContractV1;
  rootRunId: string;
  requestIdentityFingerprint: string;
  acceptanceContractFingerprint: string;
  terminalStatus: ComputerTaskAcceptanceRequestTerminalStatusV1;
  orderedActionReceipts: ReadonlyArray<ComputerTaskAcceptanceTypedActionReceiptV1>;
  finalPredicateEvidence: ReadonlyArray<ComputerTaskAcceptancePredicateEvidenceV1>;
  evidenceSummary: ComputerTaskTurnEvidenceSummary;
  issuedAt?: string | number;
}

export interface ComputerTaskRequestAcceptanceReceiptV1
  extends ComputerTaskAcceptanceReceiptV1 {
  requestAdmissionFingerprint: string;
}

export interface ComputerTaskRequestAcceptanceIssueResultV1 {
  receipt: ComputerTaskRequestAcceptanceReceiptV1;
  evidenceSummary: ComputerTaskTurnEvidenceSummary;
}

export interface ComputerTaskToolEvidenceInput {
  toolName?: unknown;
  toolUseId?: unknown;
  /** Canonical catalog verdict captured by the trusted runtime. */
  mutatesState?: unknown;
  dispatched?: unknown;
  result?: unknown;
}

type UnknownRecord = Record<string, unknown>;

function outcomeRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

const COMPUTER_TASK_ACCEPTANCE_SHA256_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const COMPUTER_TASK_ACCEPTANCE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const COMPUTER_TASK_ACCEPTANCE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const COMPUTER_TASK_ACCEPTANCE_TOOL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const COMPUTER_TASK_ACCEPTANCE_APP_RE = /^[A-Za-z0-9][A-Za-z0-9 ._()'-]{0,79}$/;
const COMPUTER_TASK_ACCEPTANCE_MAX_ACTIONS = 64;
const COMPUTER_TASK_ACCEPTANCE_MAX_PREDICATES = 8;
const COMPUTER_TASK_ACCEPTANCE_MAX_EVIDENCE_IDS = 20;
const COMPUTER_TASK_ACCEPTANCE_MAX_FRESHNESS_MS = 120_000;

/**
 * Closed-world mutation truth for task families supported by the V1 issuer.
 * The contract compiler, not its caller, owns this classification. Unknown
 * tools stay unsupported instead of inheriting a caller-supplied boolean.
 */
const COMPUTER_TASK_ACCEPTANCE_ACTION_MUTATION_REGISTRY = new Map<string, boolean>([
  ['desktop.observe_app', false],
  ['desktop.wait_for_app', false],
  ['desktop.photoshop_document_status', false],
  ['desktop.launch_app', true],
  ['desktop.focus_app', true],
  ['desktop.photoshop_create_document', true],
]);

const issuedComputerTaskAcceptanceContracts = new WeakSet<object>();
const issuedComputerTaskAcceptanceActionClaims = new WeakSet<object>();
const issuedComputerTaskAcceptanceActions = new WeakSet<object>();
const issuedComputerTaskAcceptancePredicateEvidence = new WeakSet<object>();
const issuedComputerTaskAcceptanceReceipts = new WeakSet<object>();
const issuedComputerTaskAcceptanceRequestAdmissions = new WeakSet<object>();
const issuedComputerTaskAcceptanceTypedActionReceipts = new WeakSet<object>();
const issuedComputerTaskAcceptanceTypedActionEvidence = new WeakSet<object>();
const reservedComputerTaskAcceptanceContracts = new WeakSet<object>();
const reservedComputerTaskAcceptanceActions = new WeakSet<object>();
const reservedComputerTaskAcceptancePredicateEvidence = new WeakSet<object>();
const consumedComputerTaskAcceptanceContracts = new WeakSet<object>();
const consumedComputerTaskAcceptanceActions = new WeakSet<object>();
const consumedComputerTaskAcceptancePredicateEvidence = new WeakSet<object>();
const reservedComputerTaskAcceptanceTypedActionEvidence = new WeakSet<object>();
const consumedComputerTaskAcceptanceTypedActionReceipts = new WeakSet<object>();

type ComputerTaskAcceptanceActionClaimStatus = 'issued' | 'sealing' | 'consumed';

interface ComputerTaskAcceptanceContractActionState {
  nextActionIndex: number;
  claimIssuancePending: boolean;
  activeClaim: ComputerTaskAcceptanceActionClaimV1 | null;
  requestAdmissionIssuancePending: boolean;
  requestAdmission: ComputerTaskAcceptanceRequestAdmissionV1 | null;
}

interface ComputerTaskAcceptanceActionClaimState {
  contract: ComputerTaskAcceptanceContractV1;
  actionIndex: number;
  action: ComputerTaskAcceptanceActionContractV1;
  actionBindingFingerprint: string;
  status: ComputerTaskAcceptanceActionClaimStatus;
}

type ComputerTaskAcceptanceRequestAdmissionStatus = 'issued' | 'accepting' | 'consumed';

interface ComputerTaskAcceptanceRequestAdmissionState {
  contract: ComputerTaskAcceptanceContractV1;
  status: ComputerTaskAcceptanceRequestAdmissionStatus;
}

interface ComputerTaskAcceptanceTypedActionReceiptState {
  admission: ComputerTaskAcceptanceRequestAdmissionV1;
  contract: ComputerTaskAcceptanceContractV1;
  actionIndex: number;
  actionEvidence: ComputerTaskAcceptanceActionEvidenceV1;
}

const computerTaskAcceptanceContractActionStates = new WeakMap<
  object,
  ComputerTaskAcceptanceContractActionState
>();
const computerTaskAcceptanceActionClaimStates = new WeakMap<
  object,
  ComputerTaskAcceptanceActionClaimState
>();
const computerTaskAcceptanceRequestAdmissionStates = new WeakMap<
  object,
  ComputerTaskAcceptanceRequestAdmissionState
>();
const computerTaskAcceptanceTypedActionReceiptStates = new WeakMap<
  object,
  ComputerTaskAcceptanceTypedActionReceiptState
>();

function acceptanceHasOnlyKeys(
  value: UnknownRecord,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function acceptanceFingerprint(value: unknown): string | null {
  return typeof value === 'string' && COMPUTER_TASK_ACCEPTANCE_SHA256_RE.test(value)
    ? value
    : null;
}

function acceptanceIdentity(value: unknown, pattern = COMPUTER_TASK_ACCEPTANCE_ID_RE): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return pattern.test(text) ? text : null;
}

function acceptanceUuid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  return COMPUTER_TASK_ACCEPTANCE_UUID_RE.test(text) ? text : null;
}

function acceptanceTimestamp(value: unknown): { iso: string; ms: number } | null {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  try {
    return { iso: new Date(ms).toISOString(), ms };
  } catch {
    return null;
  }
}

function acceptanceClock(value: string | number | undefined): { iso: string; ms: number } | null {
  const ms = value === undefined
    ? Date.now()
    : typeof value === 'number'
      ? value
      : Date.parse(value);
  if (!Number.isSafeInteger(ms) || ms < 0) return null;
  try {
    return { iso: new Date(ms).toISOString(), ms };
  } catch {
    return null;
  }
}

function deepFreezeComputerTaskAcceptanceValue<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeComputerTaskAcceptanceValue(child);
  }
  return Object.freeze(value);
}

function normalizedAcceptanceAppIdentity(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim().toLowerCase();
  return COMPUTER_TASK_ACCEPTANCE_APP_RE.test(normalized) ? normalized : null;
}

function normalizedAcceptancePredicate(
  value: unknown,
): ComputerTaskAcceptancePredicateV1 | null {
  const record = outcomeRecord(value);
  if (!record || typeof record.predicateId !== 'string') return null;
  if (record.predicateId === 'photoshop.active_document_dimensions_exact') {
    if (!acceptanceHasOnlyKeys(record, new Set(['predicateId', 'widthPx', 'heightPx']))) return null;
    const widthPx = Number(record.widthPx);
    const heightPx = Number(record.heightPx);
    if (
      !Number.isSafeInteger(widthPx)
      || !Number.isSafeInteger(heightPx)
      || widthPx < 1
      || heightPx < 1
      || widthPx > 100_000
      || heightPx > 100_000
    ) return null;
    return { predicateId: record.predicateId, widthPx, heightPx };
  }
  if (record.predicateId === 'desktop.named_app_frontmost') {
    if (!acceptanceHasOnlyKeys(record, new Set(['predicateId', 'appIdentity']))) return null;
    const appIdentity = normalizedAcceptanceAppIdentity(record.appIdentity);
    return appIdentity ? { predicateId: record.predicateId, appIdentity } : null;
  }
  return null;
}

function computerTaskAcceptanceContractManifest(
  contract: Pick<
    ComputerTaskAcceptanceContractV1,
    'schemaVersion' | 'rootRequestFingerprint' | 'orderedActions' | 'predicates'
  >,
): ComputerTaskAcceptanceContractDraftV1 {
  return {
    schemaVersion: 1,
    rootRequestFingerprint: contract.rootRequestFingerprint,
    orderedActions: contract.orderedActions.map((action) => ({ ...action })),
    predicates: contract.predicates.map((predicate) => ({ ...predicate })),
  };
}

/**
 * Compile an immutable V1 acceptance contract. Unsupported predicates and
 * unknown fields fail closed; callers cannot smuggle raw arguments or prose
 * into the contract fingerprint.
 */
export async function buildComputerTaskAcceptanceContractV1(
  input: ComputerTaskAcceptanceContractDraftV1,
): Promise<ComputerTaskAcceptanceContractV1 | null> {
  const inputRecord = outcomeRecord(input);
  if (
    !inputRecord
    || !acceptanceHasOnlyKeys(
      inputRecord,
      new Set(['schemaVersion', 'rootRequestFingerprint', 'orderedActions', 'predicates']),
    )
    || input.schemaVersion !== 1
    || !acceptanceFingerprint(input.rootRequestFingerprint)
    || !Array.isArray(input.orderedActions)
    || input.orderedActions.length < 1
    || input.orderedActions.length > COMPUTER_TASK_ACCEPTANCE_MAX_ACTIONS
    || !Array.isArray(input.predicates)
    || input.predicates.length < 1
    || input.predicates.length > COMPUTER_TASK_ACCEPTANCE_MAX_PREDICATES
  ) return null;

  const orderedActions: ComputerTaskAcceptanceActionContractV1[] = [];
  const actionIds = new Set<string>();
  for (const candidate of input.orderedActions) {
    const record = outcomeRecord(candidate);
    if (
      !record
      || !acceptanceHasOnlyKeys(
        record,
        new Set(['actionId', 'tool', 'mutatesState', 'targetFingerprint', 'toolArgsFingerprint']),
      )
      || typeof candidate.mutatesState !== 'boolean'
    ) return null;
    const actionId = acceptanceIdentity(candidate.actionId);
    const tool = acceptanceIdentity(candidate.tool, COMPUTER_TASK_ACCEPTANCE_TOOL_RE);
    const registeredMutationVerdict = tool === null
      ? undefined
      : COMPUTER_TASK_ACCEPTANCE_ACTION_MUTATION_REGISTRY.get(tool);
    const targetFingerprint = acceptanceFingerprint(candidate.targetFingerprint);
    const toolArgsFingerprint = acceptanceFingerprint(candidate.toolArgsFingerprint);
    if (
      !actionId
      || !tool
      || registeredMutationVerdict === undefined
      || candidate.mutatesState !== registeredMutationVerdict
      || !targetFingerprint
      || !toolArgsFingerprint
      || actionIds.has(actionId)
    ) return null;
    actionIds.add(actionId);
    orderedActions.push({
      actionId,
      tool,
      mutatesState: candidate.mutatesState,
      targetFingerprint,
      toolArgsFingerprint,
    });
  }

  const predicates: ComputerTaskAcceptancePredicateV1[] = [];
  const predicateIds = new Set<string>();
  for (const candidate of input.predicates) {
    const predicate = normalizedAcceptancePredicate(candidate);
    if (!predicate || predicateIds.has(predicate.predicateId)) return null;
    predicateIds.add(predicate.predicateId);
    predicates.push(predicate);
  }

  const manifest: ComputerTaskAcceptanceContractDraftV1 = {
    schemaVersion: 1,
    rootRequestFingerprint: input.rootRequestFingerprint,
    orderedActions,
    predicates,
  };
  const acceptanceContractFingerprint = await buildComputerAppToolArgsFingerprintAsync(manifest);
  if (!acceptanceFingerprint(acceptanceContractFingerprint)) return null;
  const contract = deepFreezeComputerTaskAcceptanceValue({
    ...manifest,
    acceptanceContractFingerprint,
  });
  issuedComputerTaskAcceptanceContracts.add(contract);
  computerTaskAcceptanceContractActionStates.set(contract, {
    nextActionIndex: 0,
    claimIssuancePending: false,
    activeClaim: null,
    requestAdmissionIssuancePending: false,
    requestAdmission: null,
  });
  return contract;
}

async function computerTaskAcceptanceContractIsCurrent(
  contract: ComputerTaskAcceptanceContractV1,
): Promise<boolean> {
  if (
    !issuedComputerTaskAcceptanceContracts.has(contract)
    || !Object.isFrozen(contract)
    || !acceptanceFingerprint(contract.rootRequestFingerprint)
    || !acceptanceFingerprint(contract.acceptanceContractFingerprint)
  ) return false;
  const recomputed = await buildComputerAppToolArgsFingerprintAsync(
    computerTaskAcceptanceContractManifest(contract),
  );
  return recomputed === contract.acceptanceContractFingerprint;
}

/**
 * Bind an already authenticated persisted root to one admitted request and
 * acceptance contract. The future runtime integration must first validate the
 * root row and actor scope; this function then makes that decision immutable,
 * digest-bound, and non-forgeable inside this process.
 */
export async function admitComputerTaskAcceptanceRequestV1(
  input: ComputerTaskAcceptanceRequestAdmissionInputV1,
): Promise<ComputerTaskAcceptanceRequestAdmissionV1 | null> {
  const record = outcomeRecord(input);
  const contractState = computerTaskAcceptanceContractActionStates.get(input?.contract);
  if (
    !record
    || !acceptanceHasOnlyKeys(record, new Set([
      'schemaVersion',
      'contract',
      'rootRunId',
      'userId',
      'circleId',
      'requestIdentityFingerprint',
      'rootRequestFingerprint',
    ]))
    || input.schemaVersion !== 1
    || !issuedComputerTaskAcceptanceContracts.has(input.contract)
    || !contractState
    || contractState.requestAdmissionIssuancePending
    || contractState.requestAdmission !== null
    || contractState.claimIssuancePending
    || contractState.activeClaim !== null
    || contractState.nextActionIndex !== 0
    || reservedComputerTaskAcceptanceContracts.has(input.contract)
    || consumedComputerTaskAcceptanceContracts.has(input.contract)
  ) return null;
  const rootRunId = acceptanceUuid(input.rootRunId);
  const userId = acceptanceUuid(input.userId);
  const circleId = acceptanceUuid(input.circleId);
  const requestIdentityFingerprint = acceptanceFingerprint(input.requestIdentityFingerprint);
  const rootRequestFingerprint = acceptanceFingerprint(input.rootRequestFingerprint);
  if (
    !rootRunId
    || !userId
    || !circleId
    || !requestIdentityFingerprint
    || !rootRequestFingerprint
    || requestIdentityFingerprint !== rootRequestFingerprint
    || rootRequestFingerprint !== input.contract.rootRequestFingerprint
  ) return null;

  contractState.requestAdmissionIssuancePending = true;
  try {
    if (!await computerTaskAcceptanceContractIsCurrent(input.contract)) return null;
    if (contractState.requestAdmission !== null) return null;
    const rootScopeFingerprint = await buildComputerAppToolArgsFingerprintAsync({
      schemaVersion: 1,
      namespace: 'computer_task_acceptance_root_scope',
      rootRunId,
      userId,
      circleId,
    });
    const requestAdmissionFingerprint = await buildComputerAppToolArgsFingerprintAsync({
      schemaVersion: 1,
      namespace: 'computer_task_acceptance_request_admission',
      rootRunId,
      rootScopeFingerprint,
      requestIdentityFingerprint,
      rootRequestFingerprint,
      acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
    });
    if (
      !acceptanceFingerprint(rootScopeFingerprint)
      || !acceptanceFingerprint(requestAdmissionFingerprint)
      || contractState.requestAdmission !== null
    ) return null;
    const admission = deepFreezeComputerTaskAcceptanceValue({
      schemaVersion: 1 as const,
      admissionKind: 'computer_task_acceptance_request' as const,
      rootRunId,
      rootScopeFingerprint,
      requestIdentityFingerprint,
      rootRequestFingerprint,
      acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
      requestAdmissionFingerprint,
    });
    issuedComputerTaskAcceptanceRequestAdmissions.add(admission);
    computerTaskAcceptanceRequestAdmissionStates.set(admission, {
      contract: input.contract,
      status: 'issued',
    });
    contractState.requestAdmission = admission;
    return admission;
  } catch {
    return null;
  } finally {
    contractState.requestAdmissionIssuancePending = false;
  }
}

async function computerTaskAcceptanceActionBindingFingerprintV1(input: {
  contract: ComputerTaskAcceptanceContractV1;
  actionIndex: number;
}): Promise<string> {
  const action = input.contract.orderedActions[input.actionIndex];
  if (!action) return '';
  const fingerprint = await buildComputerAppToolArgsFingerprintAsync({
    schemaVersion: 1,
    namespace: 'computer_task_acceptance_action',
    rootRequestFingerprint: input.contract.rootRequestFingerprint,
    acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
    action,
  });
  return acceptanceFingerprint(fingerprint) || '';
}

/**
 * Claim the next exact action in a runtime-issued acceptance contract.
 *
 * The returned object is an ephemeral, WeakSet-branded capability. Its
 * visible fingerprint may be stamped into the trusted mutation dispatch
 * envelope, but neither that string nor a structural copy can authorize
 * evidence sealing. Claims are issued in manifest order, one at a time.
 */
export async function claimComputerTaskAcceptanceActionV1(input: {
  contract: ComputerTaskAcceptanceContractV1;
  actionId: string;
}): Promise<ComputerTaskAcceptanceActionClaimV1 | null> {
  const inputRecord = outcomeRecord(input);
  const contractState = computerTaskAcceptanceContractActionStates.get(input.contract);
  const actionId = acceptanceIdentity(input.actionId);
  const actionIndex = contractState?.nextActionIndex ?? -1;
  const action = actionIndex >= 0 ? input.contract?.orderedActions?.[actionIndex] : undefined;
  if (
    !inputRecord
    || !acceptanceHasOnlyKeys(inputRecord, new Set(['contract', 'actionId']))
    || !issuedComputerTaskAcceptanceContracts.has(input.contract)
    || reservedComputerTaskAcceptanceContracts.has(input.contract)
    || consumedComputerTaskAcceptanceContracts.has(input.contract)
    || !contractState
    || contractState.claimIssuancePending
    || contractState.activeClaim !== null
    || !actionId
    || !action
    || action.actionId !== actionId
  ) return null;

  // Reserve synchronously before computing the digest. Parallel callers can
  // never receive two capabilities for the same ordered action.
  contractState.claimIssuancePending = true;
  try {
    if (!await computerTaskAcceptanceContractIsCurrent(input.contract)) return null;
    if (
      contractState.activeClaim !== null
      || contractState.nextActionIndex !== actionIndex
      || input.contract.orderedActions[actionIndex] !== action
    ) return null;
    const actionBindingFingerprint = await computerTaskAcceptanceActionBindingFingerprintV1({
      contract: input.contract,
      actionIndex,
    });
    if (
      !acceptanceFingerprint(actionBindingFingerprint)
      || contractState.activeClaim !== null
      || contractState.nextActionIndex !== actionIndex
    ) return null;
    const claim = deepFreezeComputerTaskAcceptanceValue({
      schemaVersion: 1 as const,
      claimKind: 'computer_task_acceptance_action' as const,
      acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
      actionIndex,
      actionId: action.actionId,
      tool: action.tool,
      mutatesState: action.mutatesState,
      targetFingerprint: action.targetFingerprint,
      acceptanceActionBindingFingerprint: actionBindingFingerprint,
    });
    issuedComputerTaskAcceptanceActionClaims.add(claim);
    computerTaskAcceptanceActionClaimStates.set(claim, {
      contract: input.contract,
      actionIndex,
      action,
      actionBindingFingerprint,
      status: 'issued',
    });
    contractState.activeClaim = claim;
    return claim;
  } catch {
    return null;
  } finally {
    contractState.claimIssuancePending = false;
  }
}

function acceptanceStringArray(
  value: unknown,
  maxItems: number,
): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const output: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const item = acceptanceIdentity(candidate);
    if (!item || seen.has(item)) return null;
    seen.add(item);
    output.push(item);
  }
  return output;
}

async function projectComputerTaskAcceptanceActionEvidenceV1(
  input: ComputerTaskAcceptanceActionEvidenceInputV1,
  claimState: ComputerTaskAcceptanceActionClaimState,
): Promise<ComputerTaskAcceptanceActionEvidenceV1 | null> {
  if (!await computerTaskAcceptanceContractIsCurrent(claimState.contract)) return null;
  const { action, actionBindingFingerprint } = claimState;
  const startedAt = acceptanceTimestamp(input.startedAt);
  const completedAt = acceptanceTimestamp(input.completedAt);
  if (!startedAt || !completedAt || startedAt.ms > completedAt.ms) return null;

  if (!action.mutatesState) {
    if (input.mutationDispatchReceipt != null || input.mutationVerificationReceipt != null) return null;
    return deepFreezeComputerTaskAcceptanceValue({
      schemaVersion: 1 as const,
      acceptanceContractFingerprint: claimState.contract.acceptanceContractFingerprint,
      actionId: action.actionId,
      tool: action.tool,
      mutatesState: false,
      targetFingerprint: action.targetFingerprint,
      terminalStatus: input.terminalStatus,
      startedAt: startedAt.iso,
      completedAt: completedAt.iso,
    });
  }

  const dispatch = outcomeRecord(input.mutationDispatchReceipt);
  const verification = outcomeRecord(input.mutationVerificationReceipt);
  if (
    !dispatch
    || !verification
    || !acceptanceHasOnlyKeys(dispatch, new Set([
      'schemaVersion', 'actionId', 'tool', 'epochId', 'contractBinding',
      'policyBinding', 'acceptanceActionBindingFingerprint', 'authorizedAt', 'dispatchedAt',
    ]))
    || !acceptanceHasOnlyKeys(verification, new Set([
      'schemaVersion', 'actionId', 'beforeEpochId', 'afterEpochId', 'status',
      'predicate', 'evidenceIds', 'checkedAt', 'blockers', 'canComplete',
    ]))
    || dispatch.schemaVersion !== 1
    || verification.schemaVersion !== 1
  ) return null;
  const dispatchActionId = acceptanceIdentity(dispatch.actionId);
  const dispatchTool = acceptanceIdentity(dispatch.tool, COMPUTER_TASK_ACCEPTANCE_TOOL_RE);
  const dispatchEpochId = acceptanceIdentity(dispatch.epochId);
  const verificationActionId = acceptanceIdentity(verification.actionId);
  const beforeEpochId = acceptanceIdentity(verification.beforeEpochId);
  const afterEpochId = verification.afterEpochId === null
    ? null
    : acceptanceIdentity(verification.afterEpochId);
  const authorizedAt = acceptanceTimestamp(dispatch.authorizedAt);
  const dispatchedAt = acceptanceTimestamp(dispatch.dispatchedAt);
  const checkedAt = acceptanceTimestamp(verification.checkedAt);
  const evidenceIds = acceptanceStringArray(
    verification.evidenceIds,
    COMPUTER_TASK_ACCEPTANCE_MAX_EVIDENCE_IDS,
  );
  const blockers = Array.isArray(verification.blockers)
    && verification.blockers.length <= COMPUTER_TASK_ACCEPTANCE_MAX_EVIDENCE_IDS
    && verification.blockers.every((blocker) => typeof blocker === 'string' && blocker.length <= 500)
    ? verification.blockers
    : null;
  if (
    dispatchActionId !== action.actionId
    || verificationActionId !== action.actionId
    || dispatchTool !== action.tool
    || dispatch.acceptanceActionBindingFingerprint !== actionBindingFingerprint
    || !dispatchEpochId
    || beforeEpochId !== dispatchEpochId
    || (verification.afterEpochId !== null && !afterEpochId)
    || !authorizedAt
    || !dispatchedAt
    || !checkedAt
    || startedAt.ms > dispatchedAt.ms
    || authorizedAt.ms > dispatchedAt.ms
    || dispatchedAt.ms > checkedAt.ms
    || checkedAt.ms > completedAt.ms
    || !evidenceIds
    || !blockers
    || !['verified', 'failed', 'inconclusive'].includes(String(verification.status))
    || typeof verification.canComplete !== 'boolean'
    || typeof verification.predicate !== 'string'
    || verification.predicate.length < 1
    || verification.predicate.length > 500
    || typeof dispatch.contractBinding !== 'string'
    || dispatch.contractBinding.length < 1
    || dispatch.contractBinding.length > 12_000
    || typeof dispatch.policyBinding !== 'string'
    || dispatch.policyBinding.length < 1
    || dispatch.policyBinding.length > 12_000
  ) return null;
  let dispatchContractBinding: UnknownRecord | null = null;
  try {
    dispatchContractBinding = outcomeRecord(JSON.parse(dispatch.contractBinding));
  } catch {
    return null;
  }
  if (
    !dispatchContractBinding
    || dispatchContractBinding.actionId !== action.actionId
    || dispatchContractBinding.tool !== action.tool
    || dispatchContractBinding.targetFingerprint !== action.targetFingerprint
    || dispatchContractBinding.toolArgsFingerprint !== action.toolArgsFingerprint
  ) return null;
  const dispatchBindingFingerprint = await buildComputerAppToolArgsFingerprintAsync({
    contractBinding: dispatch.contractBinding,
    policyBinding: dispatch.policyBinding,
  });
  if (!acceptanceFingerprint(dispatchBindingFingerprint)) return null;
  return deepFreezeComputerTaskAcceptanceValue({
    schemaVersion: 1 as const,
    acceptanceContractFingerprint: claimState.contract.acceptanceContractFingerprint,
    actionId: action.actionId,
    tool: action.tool,
    mutatesState: true,
    targetFingerprint: action.targetFingerprint,
    terminalStatus: input.terminalStatus,
    startedAt: startedAt.iso,
    completedAt: completedAt.iso,
    mutation: {
      dispatchEpochId,
      afterEpochId,
      authorizedAt: authorizedAt.iso,
      dispatchedAt: dispatchedAt.iso,
      checkedAt: checkedAt.iso,
      status: verification.status as 'verified' | 'failed' | 'inconclusive',
      canComplete: verification.canComplete,
      evidenceIds,
      blockerCount: blockers.length,
      dispatchBindingFingerprint,
    },
  });
}

/**
 * Consume one exact runtime claim and project its trusted action receipts into
 * bounded, value-free evidence. Reservation happens synchronously before any
 * digest await, so concurrent sealing has at most one winner. A failed
 * projection releases the reservation; a successful projection consumes the
 * claim forever and advances the contract to its next ordered action.
 */
export async function sealComputerTaskAcceptanceActionEvidenceV1(
  input: ComputerTaskAcceptanceActionEvidenceInputV1,
): Promise<ComputerTaskAcceptanceActionEvidenceV1 | null> {
  const record = outcomeRecord(input);
  const claimRecord = outcomeRecord(input?.claim);
  const claimState = claimRecord
    ? computerTaskAcceptanceActionClaimStates.get(input.claim)
    : undefined;
  const contractState = computerTaskAcceptanceContractActionStates.get(input?.contract);
  if (
    !record
    || !acceptanceHasOnlyKeys(record, new Set([
      'schemaVersion', 'contract', 'claim', 'terminalStatus', 'startedAt', 'completedAt',
      'mutationDispatchReceipt', 'mutationVerificationReceipt',
    ]))
    || input.schemaVersion !== 1
    || !['succeeded', 'failed', 'cancelled', 'outcome_unknown'].includes(input.terminalStatus)
    || !claimRecord
    || !acceptanceHasOnlyKeys(claimRecord, new Set([
      'schemaVersion', 'claimKind', 'acceptanceContractFingerprint', 'actionIndex',
      'actionId', 'tool', 'mutatesState', 'targetFingerprint', 'acceptanceActionBindingFingerprint',
    ]))
    || !issuedComputerTaskAcceptanceActionClaims.has(input.claim)
    || !Object.isFrozen(input.claim)
    || !claimState
    || claimState.status !== 'issued'
    || claimState.contract !== input.contract
    || !contractState
    || contractState.claimIssuancePending
    || contractState.activeClaim !== input.claim
    || contractState.nextActionIndex !== claimState.actionIndex
    || reservedComputerTaskAcceptanceContracts.has(input.contract)
    || consumedComputerTaskAcceptanceContracts.has(input.contract)
    || input.claim.schemaVersion !== 1
    || input.claim.claimKind !== 'computer_task_acceptance_action'
    || input.claim.acceptanceContractFingerprint !== input.contract.acceptanceContractFingerprint
    || input.claim.actionIndex !== claimState.actionIndex
    || input.claim.actionId !== claimState.action.actionId
    || input.claim.tool !== claimState.action.tool
    || input.claim.mutatesState !== claimState.action.mutatesState
    || input.claim.targetFingerprint !== claimState.action.targetFingerprint
    || !acceptanceFingerprint(input.claim.targetFingerprint)
    || input.claim.acceptanceActionBindingFingerprint !== claimState.actionBindingFingerprint
    || !acceptanceFingerprint(input.claim.acceptanceActionBindingFingerprint)
  ) return null;

  // Atomic single-use reservation. Another invocation with the same exact
  // claim observes `sealing` before this function reaches its first await.
  claimState.status = 'sealing';
  try {
    const evidence = await projectComputerTaskAcceptanceActionEvidenceV1(input, claimState);
    if (
      !evidence
      || claimState.status !== 'sealing'
      || contractState.activeClaim !== input.claim
      || contractState.nextActionIndex !== claimState.actionIndex
    ) return null;
    issuedComputerTaskAcceptanceActions.add(evidence);
    claimState.status = 'consumed';
    contractState.activeClaim = null;
    contractState.nextActionIndex += 1;
    return evidence;
  } catch {
    return null;
  } finally {
    if (claimState.status === 'sealing') claimState.status = 'issued';
  }
}

async function computerTaskAcceptanceTypedActionFingerprintV1(input: {
  admission: ComputerTaskAcceptanceRequestAdmissionV1;
  contract: ComputerTaskAcceptanceContractV1;
  actionIndex: number;
  actionEvidence: ComputerTaskAcceptanceActionEvidenceV1;
}): Promise<string> {
  const action = input.contract.orderedActions[input.actionIndex];
  if (!action) return '';
  const fingerprint = await buildComputerAppToolArgsFingerprintAsync({
    schemaVersion: 1,
    namespace: 'computer_task_acceptance_typed_action',
    rootRunId: input.admission.rootRunId,
    requestIdentityFingerprint: input.admission.requestIdentityFingerprint,
    requestAdmissionFingerprint: input.admission.requestAdmissionFingerprint,
    acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
    actionIndex: input.actionIndex,
    action,
    actionEvidence: input.actionEvidence,
  });
  return acceptanceFingerprint(fingerprint) || '';
}

/**
 * Project one already sealed, runtime-branded action result into the typed
 * request-adapter receipt expected by `issueComputerTaskRequestAcceptanceV1`.
 * This adds no dispatch authority and cannot manufacture action evidence.
 */
export async function issueComputerTaskAcceptanceTypedActionReceiptV1(input: {
  schemaVersion: 1;
  admission: ComputerTaskAcceptanceRequestAdmissionV1;
  contract: ComputerTaskAcceptanceContractV1;
  actionIndex: number;
  actionEvidence: ComputerTaskAcceptanceActionEvidenceV1;
}): Promise<ComputerTaskAcceptanceTypedActionReceiptV1 | null> {
  const record = outcomeRecord(input);
  const admissionState = computerTaskAcceptanceRequestAdmissionStates.get(input?.admission);
  const contractState = computerTaskAcceptanceContractActionStates.get(input?.contract);
  const action = Number.isSafeInteger(input?.actionIndex)
    ? input.contract?.orderedActions?.[input.actionIndex]
    : undefined;
  if (
    !record
    || !acceptanceHasOnlyKeys(record, new Set([
      'schemaVersion', 'admission', 'contract', 'actionIndex', 'actionEvidence',
    ]))
    || input.schemaVersion !== 1
    || !issuedComputerTaskAcceptanceRequestAdmissions.has(input.admission)
    || !Object.isFrozen(input.admission)
    || !admissionState
    || admissionState.status !== 'issued'
    || admissionState.contract !== input.contract
    || !issuedComputerTaskAcceptanceContracts.has(input.contract)
    || !contractState
    || contractState.requestAdmission !== input.admission
    || !action
    || input.actionIndex < 0
    || input.actionIndex >= input.contract.orderedActions.length
    || !issuedComputerTaskAcceptanceActions.has(input.actionEvidence)
    || !Object.isFrozen(input.actionEvidence)
    || reservedComputerTaskAcceptanceActions.has(input.actionEvidence)
    || consumedComputerTaskAcceptanceActions.has(input.actionEvidence)
    || reservedComputerTaskAcceptanceTypedActionEvidence.has(input.actionEvidence)
    || issuedComputerTaskAcceptanceTypedActionEvidence.has(input.actionEvidence)
    || input.actionEvidence.schemaVersion !== 1
    || input.actionEvidence.acceptanceContractFingerprint
      !== input.contract.acceptanceContractFingerprint
    || input.actionEvidence.actionId !== action.actionId
    || input.actionEvidence.tool !== action.tool
    || input.actionEvidence.mutatesState !== action.mutatesState
    || input.actionEvidence.targetFingerprint !== action.targetFingerprint
  ) return null;

  reservedComputerTaskAcceptanceTypedActionEvidence.add(input.actionEvidence);
  try {
    if (!await computerTaskAcceptanceContractIsCurrent(input.contract)) return null;
    const actionFingerprint = await computerTaskAcceptanceTypedActionFingerprintV1({
      admission: input.admission,
      contract: input.contract,
      actionIndex: input.actionIndex,
      actionEvidence: input.actionEvidence,
    });
    if (!acceptanceFingerprint(actionFingerprint)) return null;
    const receipt = deepFreezeComputerTaskAcceptanceValue({
      schemaVersion: 1 as const,
      receiptKind: 'computer_task_acceptance_typed_action' as const,
      requestAdmissionFingerprint: input.admission.requestAdmissionFingerprint,
      acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
      actionIndex: input.actionIndex,
      actionId: action.actionId,
      tool: action.tool,
      targetFingerprint: action.targetFingerprint,
      toolArgsFingerprint: action.toolArgsFingerprint,
      actionFingerprint,
      actionEvidence: input.actionEvidence,
    });
    issuedComputerTaskAcceptanceTypedActionReceipts.add(receipt);
    issuedComputerTaskAcceptanceTypedActionEvidence.add(input.actionEvidence);
    computerTaskAcceptanceTypedActionReceiptStates.set(receipt, {
      admission: input.admission,
      contract: input.contract,
      actionIndex: input.actionIndex,
      actionEvidence: input.actionEvidence,
    });
    return receipt;
  } catch {
    return null;
  } finally {
    reservedComputerTaskAcceptanceTypedActionEvidence.delete(input.actionEvidence);
  }
}

function computerTaskAcceptancePredicateForContract(
  contract: ComputerTaskAcceptanceContractV1,
  predicateId: ComputerTaskAcceptancePredicateV1['predicateId'],
): ComputerTaskAcceptancePredicateV1 | null {
  return contract.predicates.find((predicate) => predicate.predicateId === predicateId) || null;
}

/**
 * Evaluate one closed-world predicate from structured app-native values. Only
 * satisfied predicates mint branded evidence; free-form text is not accepted.
 */
export async function evaluateComputerTaskAcceptancePredicateV1(
  input: ComputerTaskAcceptancePredicateEvaluationInputV1,
): Promise<ComputerTaskAcceptancePredicateEvidenceV1 | null> {
  const record = outcomeRecord(input);
  if (!record || input.schemaVersion !== 1) return null;
  const commonKeys = [
    'schemaVersion', 'contract', 'predicateId', 'sourceTool', 'evidenceId',
    'observationEpochId', 'observedAt', 'expiresAt',
  ];
  const expectedKeys = input.predicateId === 'photoshop.active_document_dimensions_exact'
    ? new Set([...commonKeys, 'appRunning', 'hasActiveDocument', 'widthPx', 'heightPx'])
    : input.predicateId === 'desktop.named_app_frontmost'
      ? new Set([...commonKeys, 'frontmostAppIdentity'])
      : null;
  if (!expectedKeys || !acceptanceHasOnlyKeys(record, expectedKeys)) return null;
  if (!await computerTaskAcceptanceContractIsCurrent(input.contract)) return null;
  const predicate = computerTaskAcceptancePredicateForContract(input.contract, input.predicateId);
  const evidenceId = acceptanceIdentity(input.evidenceId);
  const observationEpochId = acceptanceIdentity(input.observationEpochId);
  const observedAt = acceptanceTimestamp(input.observedAt);
  const expiresAt = acceptanceTimestamp(input.expiresAt);
  if (
    !predicate
    || !evidenceId
    || !observationEpochId
    || !observedAt
    || !expiresAt
    || expiresAt.ms <= observedAt.ms
    || expiresAt.ms - observedAt.ms > COMPUTER_TASK_ACCEPTANCE_MAX_FRESHNESS_MS
  ) return null;

  let observedValue: Record<string, unknown>;
  if (
    input.predicateId === 'photoshop.active_document_dimensions_exact'
    && predicate.predicateId === input.predicateId
  ) {
    if (
      input.sourceTool !== 'desktop.photoshop_document_status'
      || input.appRunning !== true
      || input.hasActiveDocument !== true
      || !Number.isSafeInteger(input.widthPx)
      || !Number.isSafeInteger(input.heightPx)
      || input.widthPx !== predicate.widthPx
      || input.heightPx !== predicate.heightPx
    ) return null;
    observedValue = {
      appRunning: true,
      hasActiveDocument: true,
      widthPx: input.widthPx,
      heightPx: input.heightPx,
    };
  } else if (
    input.predicateId === 'desktop.named_app_frontmost'
    && predicate.predicateId === input.predicateId
  ) {
    const observedAppIdentity = normalizedAcceptanceAppIdentity(input.frontmostAppIdentity);
    if (
      input.sourceTool !== 'desktop.observe_app'
      || !observedAppIdentity
      || observedAppIdentity !== predicate.appIdentity
    ) return null;
    observedValue = { frontmostAppIdentity: observedAppIdentity };
  } else {
    return null;
  }

  const evaluationFingerprint = await buildComputerAppToolArgsFingerprintAsync({
    schemaVersion: 1,
    acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
    predicateId: input.predicateId,
    sourceTool: input.sourceTool,
    evidenceId,
    observationEpochId,
    observedAt: observedAt.iso,
    expiresAt: expiresAt.iso,
    observedValue,
  });
  if (!acceptanceFingerprint(evaluationFingerprint)) return null;
  const evidence = deepFreezeComputerTaskAcceptanceValue({
    schemaVersion: 1 as const,
    acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
    predicateId: input.predicateId,
    sourceTool: input.sourceTool,
    evidenceId,
    observationEpochId,
    observedAt: observedAt.iso,
    expiresAt: expiresAt.iso,
    evaluationFingerprint,
  });
  issuedComputerTaskAcceptancePredicateEvidence.add(evidence);
  return evidence;
}

const COMPUTER_TASK_ACCEPTANCE_SUMMARY_KEYS = new Set([
  'schemaVersion',
  'status',
  'cleanTerminal',
  'taskCompletionVerified',
  'mutationIntegrity',
  'verificationOnlyTools',
  'toolResultCount',
  'dispatchedMutationCount',
  'verifiedMutationCount',
  'failedToolCount',
  'outcomeUnknownCount',
  'reasonCode',
]);

const COMPUTER_TASK_ACCEPTANCE_VERIFICATION_TOOLS = new Set([
  'browser.dom_snapshot',
  'desktop.observe_app',
  'desktop.photoshop_document_status',
  'desktop.file_stat',
]);

function normalizedComputerTaskAcceptanceSummary(
  value: unknown,
): ComputerTaskTurnEvidenceSummary | null {
  const summary = outcomeRecord(value);
  if (
    !summary
    || !acceptanceHasOnlyKeys(summary, COMPUTER_TASK_ACCEPTANCE_SUMMARY_KEYS)
    || summary.schemaVersion !== 1
    || summary.status !== 'inconclusive'
    || summary.cleanTerminal !== true
    || summary.taskCompletionVerified !== false
    || !['not_applicable', 'verified', 'inconclusive', 'failed', 'cancelled'].includes(
      String(summary.mutationIntegrity),
    )
    || !Array.isArray(summary.verificationOnlyTools)
    || summary.verificationOnlyTools.length > 4
  ) return null;
  const verificationOnlyTools: string[] = [];
  const seenTools = new Set<string>();
  for (const candidate of summary.verificationOnlyTools) {
    if (
      typeof candidate !== 'string'
      || !COMPUTER_TASK_ACCEPTANCE_VERIFICATION_TOOLS.has(candidate)
      || seenTools.has(candidate)
    ) return null;
    seenTools.add(candidate);
    verificationOnlyTools.push(candidate);
  }
  const countKeys = [
    'toolResultCount',
    'dispatchedMutationCount',
    'verifiedMutationCount',
    'failedToolCount',
    'outcomeUnknownCount',
  ] as const;
  for (const key of countKeys) {
    if (
      !Number.isSafeInteger(summary[key])
      || Number(summary[key]) < 0
      || Number(summary[key]) > COMPUTER_TASK_ACCEPTANCE_MAX_ACTIONS
    ) return null;
  }
  if (![
    'actions_verified_task_proof_missing',
    'task_completion_verified',
    'no_dispatched_mutation_proof',
    'mutation_verification_incomplete',
    'tool_failure_present',
    'terminal_boundary_incomplete',
    'runtime_failed_after_mutation',
    'runtime_failed',
    'cancelled',
  ].includes(String(summary.reasonCode))) return null;
  return {
    schemaVersion: 1,
    status: 'inconclusive',
    cleanTerminal: true,
    taskCompletionVerified: false,
    mutationIntegrity: summary.mutationIntegrity as ComputerTaskTurnEvidenceSummary['mutationIntegrity'],
    verificationOnlyTools,
    toolResultCount: Number(summary.toolResultCount),
    dispatchedMutationCount: Number(summary.dispatchedMutationCount),
    verifiedMutationCount: Number(summary.verifiedMutationCount),
    failedToolCount: Number(summary.failedToolCount),
    outcomeUnknownCount: Number(summary.outcomeUnknownCount),
    reasonCode: summary.reasonCode as ComputerTaskTurnEvidenceSummary['reasonCode'],
  };
}

function computerTaskAcceptanceSummaryMatchesActions(
  summary: ComputerTaskTurnEvidenceSummary,
  actionCount: number,
  mutationCount: number,
): boolean {
  return summary.toolResultCount === actionCount
    && summary.dispatchedMutationCount === mutationCount
    && summary.verifiedMutationCount === mutationCount
    && summary.failedToolCount === 0
    && summary.outcomeUnknownCount === 0
    && summary.mutationIntegrity === (mutationCount > 0 ? 'verified' : 'not_applicable')
    && summary.reasonCode === (
      mutationCount > 0
        ? 'actions_verified_task_proof_missing'
        : 'no_dispatched_mutation_proof'
    );
}

function computerTaskAcceptanceActionIsVerified(
  evidence: ComputerTaskAcceptanceActionEvidenceV1,
  contractAction: ComputerTaskAcceptanceActionContractV1,
  acceptanceContractFingerprint: string,
  issuedAtMs: number,
): boolean {
  if (
    !issuedComputerTaskAcceptanceActions.has(evidence)
    || !Object.isFrozen(evidence)
    || evidence.schemaVersion !== 1
    || evidence.acceptanceContractFingerprint !== acceptanceContractFingerprint
    || evidence.actionId !== contractAction.actionId
    || evidence.tool !== contractAction.tool
    || evidence.mutatesState !== contractAction.mutatesState
    || evidence.targetFingerprint !== contractAction.targetFingerprint
    || !acceptanceFingerprint(evidence.targetFingerprint)
    || evidence.terminalStatus !== 'succeeded'
  ) return false;
  const completedAt = acceptanceTimestamp(evidence.completedAt);
  const startedAt = acceptanceTimestamp(evidence.startedAt);
  if (
    !startedAt
    || !completedAt
    || startedAt.ms > completedAt.ms
    || completedAt.ms > issuedAtMs
  ) return false;
  if (!contractAction.mutatesState) return evidence.mutation === undefined;
  const mutation = evidence.mutation;
  if (!mutation || !Object.isFrozen(mutation)) return false;
  const authorizedAt = acceptanceTimestamp(mutation.authorizedAt);
  const dispatchedAt = acceptanceTimestamp(mutation.dispatchedAt);
  const checkedAt = acceptanceTimestamp(mutation.checkedAt);
  const evidenceIds = acceptanceStringArray(
    mutation.evidenceIds,
    COMPUTER_TASK_ACCEPTANCE_MAX_EVIDENCE_IDS,
  );
  return Boolean(
    acceptanceIdentity(mutation.dispatchEpochId)
    && acceptanceIdentity(mutation.afterEpochId)
    && mutation.afterEpochId !== mutation.dispatchEpochId
    && authorizedAt
    && dispatchedAt
    && checkedAt
    && authorizedAt.ms <= dispatchedAt.ms
    && startedAt.ms <= dispatchedAt.ms
    && dispatchedAt.ms <= checkedAt.ms
    && checkedAt.ms <= completedAt.ms
    && completedAt.ms <= issuedAtMs
    && mutation.status === 'verified'
    && mutation.canComplete === true
    && evidenceIds
    && evidenceIds.length > 0
    && mutation.blockerCount === 0
    && acceptanceFingerprint(mutation.dispatchBindingFingerprint)
  );
}

function computerTaskAcceptancePredicateSourceMatches(
  evidence: ComputerTaskAcceptancePredicateEvidenceV1,
): boolean {
  return evidence.predicateId === 'photoshop.active_document_dimensions_exact'
    ? evidence.sourceTool === 'desktop.photoshop_document_status'
    : evidence.predicateId === 'desktop.named_app_frontmost'
      ? evidence.sourceTool === 'desktop.observe_app'
      : false;
}

/**
 * Apply only an in-process runtime-issued receipt to the exact inconclusive
 * summary it covered. This exported seam deliberately rejects a JSON-shaped
 * receipt copy, even when every visible field is identical.
 */
export async function applyComputerTaskAcceptanceReceiptV1(input: {
  receipt: ComputerTaskAcceptanceReceiptV1;
  rootRequestFingerprint: string;
  acceptanceContractFingerprint: string;
  requestAdmissionFingerprint?: string | null;
  evidenceSummary: ComputerTaskTurnEvidenceSummary;
}): Promise<ComputerTaskTurnEvidenceSummary | null> {
  if (
    !issuedComputerTaskAcceptanceReceipts.has(input.receipt)
    || !Object.isFrozen(input.receipt)
    || input.receipt.schemaVersion !== 1
    || input.receipt.receiptKind !== 'computer_task_acceptance'
    || input.rootRequestFingerprint !== input.receipt.rootRequestFingerprint
    || input.acceptanceContractFingerprint !== input.receipt.acceptanceContractFingerprint
    || (input.receipt.requestAdmissionFingerprint === null
      ? input.requestAdmissionFingerprint != null
      : input.requestAdmissionFingerprint !== input.receipt.requestAdmissionFingerprint)
  ) return null;
  const summary = normalizedComputerTaskAcceptanceSummary(input.evidenceSummary);
  if (!summary) return null;
  const fingerprint = await buildComputerAppToolArgsFingerprintAsync(summary);
  if (fingerprint !== input.receipt.turnEvidenceFingerprint) return null;
  return deepFreezeComputerTaskAcceptanceValue({
    ...summary,
    status: 'completed' as const,
    taskCompletionVerified: true,
    reasonCode: 'task_completion_verified' as const,
  });
}

/**
 * Mint one runtime-owned outer acceptance receipt and upgrade only the exact
 * matching turn summary. This function intentionally is not wired to generic
 * Chat completion: the parent runtime must first compile an accepted task
 * family into this closed contract and pass branded action/evaluator evidence.
 *
 * `issuedAt` is a deterministic-test clock. Production callers must omit it.
 */
async function issueComputerTaskAcceptanceReceiptV1Internal(input: {
  contract: ComputerTaskAcceptanceContractV1;
  rootRequestFingerprint: string;
  orderedActions: ReadonlyArray<ComputerTaskAcceptanceActionEvidenceV1>;
  orderedPredicateEvidence: ReadonlyArray<ComputerTaskAcceptancePredicateEvidenceV1>;
  evidenceSummary: ComputerTaskTurnEvidenceSummary;
  issuedAt?: string | number;
}, requestAdmissionFingerprint: string | null): Promise<ComputerTaskAcceptanceIssueResultV1 | null> {
  const contractObject = outcomeRecord(input.contract);
  const contractActionState = computerTaskAcceptanceContractActionStates.get(input.contract);
  if (
    !contractObject
    || !issuedComputerTaskAcceptanceContracts.has(input.contract)
    || reservedComputerTaskAcceptanceContracts.has(input.contract)
    || consumedComputerTaskAcceptanceContracts.has(input.contract)
    || (requestAdmissionFingerprint !== null
      && !acceptanceFingerprint(requestAdmissionFingerprint))
    || input.rootRequestFingerprint !== input.contract.rootRequestFingerprint
    || !acceptanceFingerprint(input.rootRequestFingerprint)
    || !Array.isArray(input.orderedActions)
    || input.orderedActions.length !== input.contract.orderedActions.length
    || input.orderedActions.length < 1
    || input.orderedActions.length > COMPUTER_TASK_ACCEPTANCE_MAX_ACTIONS
    || !Array.isArray(input.orderedPredicateEvidence)
    || input.orderedPredicateEvidence.length !== input.contract.predicates.length
    || input.orderedPredicateEvidence.length < 1
    || input.orderedPredicateEvidence.length > COMPUTER_TASK_ACCEPTANCE_MAX_PREDICATES
    || !contractActionState
    || (requestAdmissionFingerprint === null
      ? contractActionState.requestAdmission !== null
      : contractActionState.requestAdmission?.requestAdmissionFingerprint
        !== requestAdmissionFingerprint)
    || contractActionState.claimIssuancePending
    || contractActionState.activeClaim !== null
    || contractActionState.nextActionIndex !== input.contract.orderedActions.length
  ) return null;
  const actionObjects = input.orderedActions as ReadonlyArray<object>;
  const predicateObjects = input.orderedPredicateEvidence as ReadonlyArray<object>;
  if (actionObjects.some((evidence) => (
    !issuedComputerTaskAcceptanceActions.has(evidence)
    || reservedComputerTaskAcceptanceActions.has(evidence)
    || consumedComputerTaskAcceptanceActions.has(evidence)
  ))) return null;
  if (predicateObjects.some((evidence) => (
    !issuedComputerTaskAcceptancePredicateEvidence.has(evidence)
    || reservedComputerTaskAcceptancePredicateEvidence.has(evidence)
    || consumedComputerTaskAcceptancePredicateEvidence.has(evidence)
  ))) return null;

  // Reserve synchronously before the first digest await. Two concurrent calls
  // cannot mint duplicate receipts from one task's evidence set.
  reservedComputerTaskAcceptanceContracts.add(input.contract);
  actionObjects.forEach((evidence) => reservedComputerTaskAcceptanceActions.add(evidence));
  predicateObjects.forEach((evidence) => reservedComputerTaskAcceptancePredicateEvidence.add(evidence));
  let committed = false;
  const releaseReservations = () => {
    reservedComputerTaskAcceptanceContracts.delete(input.contract);
    actionObjects.forEach((evidence) => reservedComputerTaskAcceptanceActions.delete(evidence));
    predicateObjects.forEach((evidence) => reservedComputerTaskAcceptancePredicateEvidence.delete(evidence));
  };
  const reject = (): null => {
    if (!committed) releaseReservations();
    return null;
  };

  try {
    const issuedAt = acceptanceClock(input.issuedAt);
    if (!issuedAt || !await computerTaskAcceptanceContractIsCurrent(input.contract)) return reject();
    const mutationCount = input.contract.orderedActions.filter((action) => action.mutatesState).length;
    const summary = normalizedComputerTaskAcceptanceSummary(input.evidenceSummary);
    if (!summary || !computerTaskAcceptanceSummaryMatchesActions(
      summary,
      input.orderedActions.length,
      mutationCount,
    )) return reject();

    const actionIds = new Set<string>();
    let lastMutationDispatchedAtMs: number | null = null;
    let lastMutationDispatchedAt: string | null = null;
    let lastMutationCheckedAtMs = 0;
    let lastActionCompletedAtMs = 0;
    let previousActionCompletedAtMs = 0;
    for (let index = 0; index < input.orderedActions.length; index += 1) {
      const evidence = input.orderedActions[index];
      const contractAction = input.contract.orderedActions[index];
      if (
        actionIds.has(evidence.actionId)
        || !computerTaskAcceptanceActionIsVerified(
          evidence,
          contractAction,
          input.contract.acceptanceContractFingerprint,
          issuedAt.ms,
        )
      ) return reject();
      actionIds.add(evidence.actionId);
      const completedAt = acceptanceTimestamp(evidence.completedAt);
      const startedAt = acceptanceTimestamp(evidence.startedAt);
      if (
        !startedAt
        || !completedAt
        || startedAt.ms < previousActionCompletedAtMs
        || completedAt.ms < previousActionCompletedAtMs
      ) return reject();
      previousActionCompletedAtMs = completedAt.ms;
      lastActionCompletedAtMs = Math.max(lastActionCompletedAtMs, completedAt.ms);
      if (evidence.mutation) {
        const dispatchedAt = acceptanceTimestamp(evidence.mutation.dispatchedAt);
        const checkedAt = acceptanceTimestamp(evidence.mutation.checkedAt);
        if (!dispatchedAt || !checkedAt) return reject();
        lastMutationCheckedAtMs = Math.max(lastMutationCheckedAtMs, checkedAt.ms);
        if (lastMutationDispatchedAtMs === null || dispatchedAt.ms > lastMutationDispatchedAtMs) {
          lastMutationDispatchedAtMs = dispatchedAt.ms;
          lastMutationDispatchedAt = dispatchedAt.iso;
        }
      }
    }

    const evidenceIds = new Set<string>();
    const observationEpochIds = new Set<string>();
    const evaluationFingerprints = new Set<string>();
    let finalEvidenceObservedAtMs = 0;
    let finalEvidenceObservedAt = '';
    // Final acceptance is a distinct observation after every planned action
    // has returned and every mutation verification has finished. Dispatch-time
    // freshness alone could otherwise let an intermediate observation prove a
    // task whose later read/action had not completed yet.
    const finalProofBoundaryMs = Math.max(
      lastActionCompletedAtMs,
      lastMutationCheckedAtMs,
      lastMutationDispatchedAtMs ?? 0,
    );
    for (let index = 0; index < input.orderedPredicateEvidence.length; index += 1) {
      const evidence = input.orderedPredicateEvidence[index];
      const predicate = input.contract.predicates[index];
      if (
        !issuedComputerTaskAcceptancePredicateEvidence.has(evidence)
        || !Object.isFrozen(evidence)
        || evidence.schemaVersion !== 1
        || evidence.acceptanceContractFingerprint !== input.contract.acceptanceContractFingerprint
        || evidence.predicateId !== predicate.predicateId
        || !computerTaskAcceptancePredicateSourceMatches(evidence)
        || !acceptanceIdentity(evidence.evidenceId)
        || !acceptanceIdentity(evidence.observationEpochId)
        || !acceptanceFingerprint(evidence.evaluationFingerprint)
        || evidenceIds.has(evidence.evidenceId)
        || observationEpochIds.has(evidence.observationEpochId)
        || evaluationFingerprints.has(evidence.evaluationFingerprint)
      ) return reject();
      const observedAt = acceptanceTimestamp(evidence.observedAt);
      const expiresAt = acceptanceTimestamp(evidence.expiresAt);
      if (
        !observedAt
        || !expiresAt
        || observedAt.ms <= finalProofBoundaryMs
        || observedAt.ms > issuedAt.ms
        || expiresAt.ms <= observedAt.ms
        || expiresAt.ms - observedAt.ms > COMPUTER_TASK_ACCEPTANCE_MAX_FRESHNESS_MS
        || issuedAt.ms > expiresAt.ms
        || issuedAt.ms - observedAt.ms > COMPUTER_TASK_ACCEPTANCE_MAX_FRESHNESS_MS
      ) return reject();
      evidenceIds.add(evidence.evidenceId);
      observationEpochIds.add(evidence.observationEpochId);
      evaluationFingerprints.add(evidence.evaluationFingerprint);
      if (observedAt.ms > finalEvidenceObservedAtMs) {
        finalEvidenceObservedAtMs = observedAt.ms;
        finalEvidenceObservedAt = observedAt.iso;
      }
    }
    if (!finalEvidenceObservedAt) return reject();

    const turnEvidenceFingerprint = await buildComputerAppToolArgsFingerprintAsync(summary);
    const orderedActionSetFingerprint = await buildComputerAppToolArgsFingerprintAsync({
      schemaVersion: 1,
      rootRequestFingerprint: input.rootRequestFingerprint,
      acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
      orderedActions: input.orderedActions,
    });
    const orderedEvidenceSetFingerprint = await buildComputerAppToolArgsFingerprintAsync({
      schemaVersion: 1,
      rootRequestFingerprint: input.rootRequestFingerprint,
      acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
      orderedPredicateEvidence: input.orderedPredicateEvidence,
    });
    if (
      !acceptanceFingerprint(turnEvidenceFingerprint)
      || !acceptanceFingerprint(orderedActionSetFingerprint)
      || !acceptanceFingerprint(orderedEvidenceSetFingerprint)
    ) return reject();

    const receiptFields = {
      schemaVersion: 1 as const,
      receiptKind: 'computer_task_acceptance' as const,
      rootRequestFingerprint: input.rootRequestFingerprint,
      acceptanceContractFingerprint: input.contract.acceptanceContractFingerprint,
      requestAdmissionFingerprint,
      turnEvidenceFingerprint,
      orderedActionSetFingerprint,
      orderedEvidenceSetFingerprint,
      actionCount: input.orderedActions.length,
      mutationCount,
      predicateIds: input.contract.predicates.map((predicate) => predicate.predicateId),
      lastMutationDispatchedAt,
      finalEvidenceObservedAt,
      issuedAt: issuedAt.iso,
    };
    const receiptFingerprint = await buildComputerAppToolArgsFingerprintAsync(receiptFields);
    if (!acceptanceFingerprint(receiptFingerprint)) return reject();
    const receipt = deepFreezeComputerTaskAcceptanceValue({
      ...receiptFields,
      receiptFingerprint,
    });

    // The receipt must be immutable and runtime-issued before its matching
    // summary copy can cross the task-completion boundary.
    issuedComputerTaskAcceptanceReceipts.add(receipt);
    const evidenceSummary = deepFreezeComputerTaskAcceptanceValue({
      ...summary,
      status: 'completed' as const,
      taskCompletionVerified: true,
      reasonCode: 'task_completion_verified' as const,
    });
    consumedComputerTaskAcceptanceContracts.add(input.contract);
    actionObjects.forEach((evidence) => consumedComputerTaskAcceptanceActions.add(evidence));
    predicateObjects.forEach((evidence) => consumedComputerTaskAcceptancePredicateEvidence.add(evidence));
    committed = true;
    releaseReservations();
    return { receipt, evidenceSummary };
  } catch {
    return reject();
  }
}

/**
 * Low-level issuer retained for focused compiler/evaluator use. Production
 * computer-task integration should call `issueComputerTaskRequestAcceptanceV1`
 * so the receipt is additionally bound to an admitted persisted root.
 */
export async function issueComputerTaskAcceptanceReceiptV1(input: {
  contract: ComputerTaskAcceptanceContractV1;
  rootRequestFingerprint: string;
  orderedActions: ReadonlyArray<ComputerTaskAcceptanceActionEvidenceV1>;
  orderedPredicateEvidence: ReadonlyArray<ComputerTaskAcceptancePredicateEvidenceV1>;
  evidenceSummary: ComputerTaskTurnEvidenceSummary;
  issuedAt?: string | number;
}): Promise<ComputerTaskAcceptanceIssueResultV1 | null> {
  return issueComputerTaskAcceptanceReceiptV1Internal(input, null);
}

/**
 * Request-level acceptance adapter for future `computerTaskRuntime` wiring.
 *
 * It accepts only the exact in-process admission and typed action-receipt
 * objects issued above, revalidates their root/request/contract/target/action
 * digests in manifest order, and delegates final freshness/terminal checks to
 * the existing outer issuer. Ordinary action summaries and model prose never
 * enter this boundary. One successful call consumes the admission, contract,
 * action receipts, action evidence, and predicate evidence permanently.
 */
export async function issueComputerTaskRequestAcceptanceV1(
  input: ComputerTaskRequestAcceptanceIssueInputV1,
): Promise<ComputerTaskRequestAcceptanceIssueResultV1 | null> {
  const record = outcomeRecord(input);
  const admissionRecord = outcomeRecord(input?.admission);
  const admissionState = admissionRecord
    ? computerTaskAcceptanceRequestAdmissionStates.get(input.admission)
    : undefined;
  const contractState = computerTaskAcceptanceContractActionStates.get(input?.contract);
  if (
    !record
    || !acceptanceHasOnlyKeys(record, new Set([
      'schemaVersion',
      'admission',
      'contract',
      'rootRunId',
      'requestIdentityFingerprint',
      'acceptanceContractFingerprint',
      'terminalStatus',
      'orderedActionReceipts',
      'finalPredicateEvidence',
      'evidenceSummary',
      'issuedAt',
    ]))
    || input.schemaVersion !== 1
    || input.terminalStatus !== 'succeeded'
    || !admissionRecord
    || !acceptanceHasOnlyKeys(admissionRecord, new Set([
      'schemaVersion',
      'admissionKind',
      'rootRunId',
      'rootScopeFingerprint',
      'requestIdentityFingerprint',
      'rootRequestFingerprint',
      'acceptanceContractFingerprint',
      'requestAdmissionFingerprint',
    ]))
    || !issuedComputerTaskAcceptanceRequestAdmissions.has(input.admission)
    || !Object.isFrozen(input.admission)
    || !admissionState
    || admissionState.status !== 'issued'
    || admissionState.contract !== input.contract
    || input.admission.schemaVersion !== 1
    || input.admission.admissionKind !== 'computer_task_acceptance_request'
    || input.rootRunId !== input.admission.rootRunId
    || input.requestIdentityFingerprint !== input.admission.requestIdentityFingerprint
    || input.acceptanceContractFingerprint
      !== input.admission.acceptanceContractFingerprint
    || input.admission.rootRequestFingerprint !== input.contract.rootRequestFingerprint
    || input.admission.requestIdentityFingerprint !== input.contract.rootRequestFingerprint
    || !acceptanceUuid(input.rootRunId)
    || !acceptanceFingerprint(input.requestIdentityFingerprint)
    || !acceptanceFingerprint(input.acceptanceContractFingerprint)
    || !acceptanceFingerprint(input.admission.rootScopeFingerprint)
    || !acceptanceFingerprint(input.admission.requestAdmissionFingerprint)
    || !issuedComputerTaskAcceptanceContracts.has(input.contract)
    || !contractState
    || contractState.requestAdmission !== input.admission
    || contractState.requestAdmissionIssuancePending
    || reservedComputerTaskAcceptanceContracts.has(input.contract)
    || consumedComputerTaskAcceptanceContracts.has(input.contract)
    || !Array.isArray(input.orderedActionReceipts)
    || input.orderedActionReceipts.length !== input.contract.orderedActions.length
    || input.orderedActionReceipts.length < 1
    || input.orderedActionReceipts.length > COMPUTER_TASK_ACCEPTANCE_MAX_ACTIONS
    || !Array.isArray(input.finalPredicateEvidence)
    || input.finalPredicateEvidence.length !== input.contract.predicates.length
    || input.finalPredicateEvidence.length < 1
    || input.finalPredicateEvidence.length > COMPUTER_TASK_ACCEPTANCE_MAX_PREDICATES
  ) return null;

  const mutationCount = input.contract.orderedActions.filter((action) => action.mutatesState).length;
  const summary = normalizedComputerTaskAcceptanceSummary(input.evidenceSummary);
  if (
    !summary
    || !computerTaskAcceptanceSummaryMatchesActions(
      summary,
      input.orderedActionReceipts.length,
      mutationCount,
    )
  ) return null;

  const receiptObjects = input.orderedActionReceipts as ReadonlyArray<object>;
  const actionEvidenceObjects = new Set<object>();
  for (let index = 0; index < input.orderedActionReceipts.length; index += 1) {
    const receipt = input.orderedActionReceipts[index];
    const receiptRecord = outcomeRecord(receipt);
    const receiptState = receiptRecord
      ? computerTaskAcceptanceTypedActionReceiptStates.get(receipt)
      : undefined;
    const action = input.contract.orderedActions[index];
    if (
      !receiptRecord
      || !acceptanceHasOnlyKeys(receiptRecord, new Set([
        'schemaVersion',
        'receiptKind',
        'requestAdmissionFingerprint',
        'acceptanceContractFingerprint',
        'actionIndex',
        'actionId',
        'tool',
        'targetFingerprint',
        'toolArgsFingerprint',
        'actionFingerprint',
        'actionEvidence',
      ]))
      || !issuedComputerTaskAcceptanceTypedActionReceipts.has(receipt)
      || consumedComputerTaskAcceptanceTypedActionReceipts.has(receipt)
      || !Object.isFrozen(receipt)
      || !receiptState
      || receiptState.admission !== input.admission
      || receiptState.contract !== input.contract
      || receiptState.actionIndex !== index
      || receiptState.actionEvidence !== receipt.actionEvidence
      || receipt.schemaVersion !== 1
      || receipt.receiptKind !== 'computer_task_acceptance_typed_action'
      || receipt.requestAdmissionFingerprint !== input.admission.requestAdmissionFingerprint
      || receipt.acceptanceContractFingerprint !== input.contract.acceptanceContractFingerprint
      || receipt.actionIndex !== index
      || receipt.actionId !== action.actionId
      || receipt.tool !== action.tool
      || receipt.targetFingerprint !== action.targetFingerprint
      || receipt.toolArgsFingerprint !== action.toolArgsFingerprint
      || !acceptanceFingerprint(receipt.targetFingerprint)
      || !acceptanceFingerprint(receipt.toolArgsFingerprint)
      || !acceptanceFingerprint(receipt.actionFingerprint)
      || !issuedComputerTaskAcceptanceActions.has(receipt.actionEvidence)
      || reservedComputerTaskAcceptanceActions.has(receipt.actionEvidence)
      || consumedComputerTaskAcceptanceActions.has(receipt.actionEvidence)
      || actionEvidenceObjects.has(receipt.actionEvidence)
      || receipt.actionEvidence.terminalStatus !== 'succeeded'
      || receipt.actionEvidence.acceptanceContractFingerprint
        !== input.contract.acceptanceContractFingerprint
      || receipt.actionEvidence.actionId !== action.actionId
      || receipt.actionEvidence.tool !== action.tool
      || receipt.actionEvidence.targetFingerprint !== action.targetFingerprint
      || receipt.actionEvidence.mutatesState !== action.mutatesState
    ) return null;
    actionEvidenceObjects.add(receipt.actionEvidence);
  }

  const predicateObjects = input.finalPredicateEvidence as ReadonlyArray<object>;
  for (let index = 0; index < input.finalPredicateEvidence.length; index += 1) {
    const evidence = input.finalPredicateEvidence[index];
    const predicate = input.contract.predicates[index];
    if (
      !issuedComputerTaskAcceptancePredicateEvidence.has(evidence)
      || reservedComputerTaskAcceptancePredicateEvidence.has(evidence)
      || consumedComputerTaskAcceptancePredicateEvidence.has(evidence)
      || !Object.isFrozen(evidence)
      || evidence.acceptanceContractFingerprint
        !== input.contract.acceptanceContractFingerprint
      || evidence.predicateId !== predicate.predicateId
    ) return null;
  }

  // Admission reservation precedes every digest await. A concurrent duplicate
  // observes `accepting`; a successful issue permanently moves to `consumed`.
  admissionState.status = 'accepting';
  try {
    if (!await computerTaskAcceptanceContractIsCurrent(input.contract)) return null;
    const recomputedAdmissionFingerprint = await buildComputerAppToolArgsFingerprintAsync({
      schemaVersion: 1,
      namespace: 'computer_task_acceptance_request_admission',
      rootRunId: input.admission.rootRunId,
      rootScopeFingerprint: input.admission.rootScopeFingerprint,
      requestIdentityFingerprint: input.admission.requestIdentityFingerprint,
      rootRequestFingerprint: input.admission.rootRequestFingerprint,
      acceptanceContractFingerprint: input.admission.acceptanceContractFingerprint,
    });
    if (recomputedAdmissionFingerprint !== input.admission.requestAdmissionFingerprint) return null;

    for (let index = 0; index < input.orderedActionReceipts.length; index += 1) {
      const receipt = input.orderedActionReceipts[index];
      const recomputedActionFingerprint = await computerTaskAcceptanceTypedActionFingerprintV1({
        admission: input.admission,
        contract: input.contract,
        actionIndex: index,
        actionEvidence: receipt.actionEvidence,
      });
      if (recomputedActionFingerprint !== receipt.actionFingerprint) return null;
    }

    const result = await issueComputerTaskAcceptanceReceiptV1Internal({
      contract: input.contract,
      rootRequestFingerprint: input.admission.rootRequestFingerprint,
      orderedActions: input.orderedActionReceipts.map((receipt) => receipt.actionEvidence),
      orderedPredicateEvidence: input.finalPredicateEvidence,
      evidenceSummary: summary,
      issuedAt: input.issuedAt,
    }, input.admission.requestAdmissionFingerprint);
    if (
      !result
      || result.receipt.requestAdmissionFingerprint
        !== input.admission.requestAdmissionFingerprint
    ) return null;
    receiptObjects.forEach((receipt) => consumedComputerTaskAcceptanceTypedActionReceipts.add(receipt));
    admissionState.status = 'consumed';
    return {
      receipt: result.receipt as ComputerTaskRequestAcceptanceReceiptV1,
      evidenceSummary: result.evidenceSummary,
    };
  } catch {
    return null;
  } finally {
    if (admissionState.status === 'accepting') admissionState.status = 'issued';
  }
}

function receiptCount(value: unknown, fallbackArray: unknown): number {
  if (Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10_000) {
    return Number(value);
  }
  return Array.isArray(fallbackArray) ? Math.min(fallbackArray.length, 10_000) : 0;
}

function validReceiptIdentity(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= 180 ? text : null;
}

function validReceiptTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mutationReceiptPairIsVerified(
  metadata: UnknownRecord | null,
  rowToolName: unknown,
): boolean {
  if (!metadata) return false;
  const dispatch = outcomeRecord(metadata.mutationDispatchReceipt);
  const verification = outcomeRecord(metadata.computerAppVerificationReceipt);
  if (!dispatch || !verification) return false;
  const dispatchActionId = validReceiptIdentity(dispatch.actionId);
  const verificationActionId = validReceiptIdentity(verification.actionId);
  const dispatchTool = validReceiptIdentity(dispatch.tool);
  const observedTool = validReceiptIdentity(rowToolName);
  const dispatchEpochId = validReceiptIdentity(dispatch.epochId);
  const verificationBeforeEpochId = validReceiptIdentity(verification.beforeEpochId);
  const afterEpochId = validReceiptIdentity(verification.afterEpochId);
  const authorizedAt = validReceiptTimestamp(dispatch.authorizedAt);
  const dispatchedAt = validReceiptTimestamp(dispatch.dispatchedAt);
  const checkedAt = validReceiptTimestamp(verification.checkedAt);
  const evidenceCount = receiptCount(
    verification.evidenceCount,
    verification.evidenceIds,
  );
  const blockerCount = receiptCount(
    verification.blockerCount,
    verification.blockers,
  );
  return dispatch.schemaVersion === 1
    && verification.schemaVersion === 1
    && Boolean(dispatchActionId)
    && dispatchActionId === verificationActionId
    && Boolean(dispatchTool)
    && dispatchTool === observedTool
    && Boolean(dispatchEpochId)
    && dispatchEpochId === verificationBeforeEpochId
    && Boolean(afterEpochId)
    && afterEpochId !== verificationBeforeEpochId
    && authorizedAt !== null
    && dispatchedAt !== null
    && checkedAt !== null
    && authorizedAt <= dispatchedAt
    && dispatchedAt <= checkedAt
    && verification.status === 'verified'
    && verification.canComplete === true
    && evidenceCount > 0
    && blockerCount === 0;
}

function resultOutcomeUnknown(result: UnknownRecord | null): boolean {
  if (!result) return false;
  const data = outcomeRecord(result.data);
  const metadata = outcomeRecord(result.metadata);
  const verification = outcomeRecord(metadata?.computerAppVerificationReceipt);
  return data?.outcomeUnknown === true
    || metadata?.outcomeUnknown === true
    || verification?.status === 'inconclusive';
}

function deriveTurnVerificationOnlyTools(
  rows: ReadonlyArray<ComputerTaskToolEvidenceInput>,
): string[] {
  const toolNames = new Set(
    rows
      .map((row) => validReceiptIdentity(row?.toolName))
      .filter((value): value is string => Boolean(value)),
  );
  const tools: string[] = [];
  if (Array.from(toolNames).some((tool) => tool.startsWith('desktop.photoshop_'))) {
    tools.push('desktop.photoshop_document_status');
  }
  if (Array.from(toolNames).some((tool) => tool.startsWith('browser.'))) {
    tools.push('browser.dom_snapshot');
  }
  if (
    Array.from(toolNames).some((tool) => tool.startsWith('desktop.'))
    && !tools.includes('desktop.observe_app')
  ) {
    tools.push('desktop.observe_app');
  }
  if (Array.from(toolNames).some((tool) => tool.startsWith('desktop.file_'))) {
    tools.push('desktop.file_stat');
  }
  return tools.slice(0, 4);
}

/**
 * Reduce ordered tool-call results to one bounded, value-free terminal proof.
 * A receipt is the strongest dispatch authority. A canonical mutating-tool
 * policy plus the core's handler-entry bit also counts as a dispatched
 * mutation, specifically so an older/uncovered handler cannot disappear next
 * to a later verified call and manufacture whole-task completion.
 */
export function summarizeComputerTaskTurnEvidence(input: {
  toolEvidence?: ReadonlyArray<ComputerTaskToolEvidenceInput> | null;
  cleanTerminal: boolean;
  cancelled?: boolean;
  runtimeFailed?: boolean;
}): ComputerTaskTurnEvidenceSummary {
  const rows = Array.isArray(input.toolEvidence)
    ? input.toolEvidence.slice(0, 2_000)
    : [];
  let dispatchedMutationCount = 0;
  let verifiedMutationCount = 0;
  let failedToolCount = 0;
  let outcomeUnknownCount = 0;

  for (const row of rows) {
    const result = outcomeRecord(row?.result);
    const metadata = outcomeRecord(result?.metadata);
    const dispatchReceipt = outcomeRecord(metadata?.mutationDispatchReceipt);
    const mutationDispatched = Boolean(dispatchReceipt)
      || (row?.mutatesState === true && row?.dispatched === true);
    if (result?.ok !== true) failedToolCount += 1;
    if (resultOutcomeUnknown(result)) outcomeUnknownCount += 1;
    if (!mutationDispatched) continue;
    dispatchedMutationCount += 1;
    if (result?.ok === true && mutationReceiptPairIsVerified(metadata, row?.toolName)) {
      verifiedMutationCount += 1;
    } else if (!resultOutcomeUnknown(result)) {
      outcomeUnknownCount += 1;
    }
  }

  const base = {
    schemaVersion: 1 as const,
    cleanTerminal: input.cleanTerminal === true,
    // Action receipts are deliberately insufficient for this field. The
    // outer task runtime will own the acceptance-bound issuer in the next
    // kernel phase; until then this value must remain false.
    taskCompletionVerified: false,
    verificationOnlyTools: deriveTurnVerificationOnlyTools(rows),
    toolResultCount: rows.length,
    dispatchedMutationCount,
    verifiedMutationCount,
    failedToolCount,
    outcomeUnknownCount,
  };
  if (input.cancelled) {
    return {
      ...base,
      status: 'cancelled',
      mutationIntegrity: 'cancelled',
      reasonCode: 'cancelled',
    };
  }
  if (input.runtimeFailed) {
    if (dispatchedMutationCount > 0) {
      return {
        ...base,
        status: 'inconclusive',
        mutationIntegrity: 'inconclusive',
        reasonCode: 'runtime_failed_after_mutation',
      };
    }
    return {
      ...base,
      status: 'failed',
      mutationIntegrity: 'failed',
      reasonCode: 'runtime_failed',
    };
  }
  if (!input.cleanTerminal) {
    return {
      ...base,
      status: 'inconclusive',
      mutationIntegrity: 'inconclusive',
      reasonCode: 'terminal_boundary_incomplete',
    };
  }
  if (dispatchedMutationCount === 0) {
    return {
      ...base,
      status: 'inconclusive',
      mutationIntegrity: failedToolCount > 0 ? 'failed' : 'not_applicable',
      reasonCode: failedToolCount > 0
        ? 'tool_failure_present'
        : 'no_dispatched_mutation_proof',
    };
  }
  if (
    verifiedMutationCount !== dispatchedMutationCount
    || outcomeUnknownCount > 0
  ) {
    return {
      ...base,
      status: 'inconclusive',
      mutationIntegrity: 'inconclusive',
      reasonCode: 'mutation_verification_incomplete',
    };
  }
  if (failedToolCount > 0) {
    return {
      ...base,
      status: 'inconclusive',
      mutationIntegrity: 'verified',
      reasonCode: 'tool_failure_present',
    };
  }
  return {
    ...base,
    status: 'inconclusive',
    mutationIntegrity: 'verified',
    reasonCode: 'actions_verified_task_proof_missing',
  };
}

export function structuredAgentTaskStatusFromTurnEvidence(
  summary: ComputerTaskTurnEvidenceSummary | null | undefined,
): Exclude<AgentTaskTerminalOutcomeStatus, 'inconclusive'> | null {
  if (!summary || summary.schemaVersion !== 1) return null;
  if (summary.status === 'cancelled' || summary.status === 'failed') {
    return summary.status;
  }
  // Backward/forgery guard: even a persisted or manually constructed summary
  // that says `completed` cannot promote the whole task without the explicit
  // task-level acceptance bit.
  if (summary.status === 'completed' && summary.taskCompletionVerified === true) {
    return 'completed';
  }
  return null;
}

export interface ComputerTaskTurnReplayGuard {
  manualVerifyOnly: boolean;
  mutationDispatched: boolean;
  verificationOnlyTools: string[];
}

/**
 * Convert value-free turn evidence into replay authority. If a mutation
 * crossed its dispatch boundary without an outer task-acceptance receipt, the
 * original prompt is no longer safe to replay. Recovery may only collect fresh
 * read-only state until a checkpoint-aware continuation exists.
 */
export function deriveComputerTaskTurnReplayGuard(input: {
  evidence?: ComputerTaskTurnEvidenceSummary | null;
  taskKind?: string | null;
}): ComputerTaskTurnReplayGuard {
  const evidence = input.evidence;
  const mutationDispatched = Boolean(
    evidence
    && evidence.schemaVersion === 1
    && Number.isInteger(evidence.dispatchedMutationCount)
    && evidence.dispatchedMutationCount > 0,
  );
  const taskCompletionVerified = evidence?.taskCompletionVerified === true
    && evidence?.status === 'completed';
  const manualVerifyOnly = mutationDispatched && !taskCompletionVerified;
  const runtimeHints = Array.isArray(evidence?.verificationOnlyTools)
    ? evidence.verificationOnlyTools.filter((tool) => [
        'browser.dom_snapshot',
        'desktop.observe_app',
        'desktop.photoshop_document_status',
        'desktop.file_stat',
      ].includes(tool)).slice(0, 4)
    : [];
  const verificationOnlyTools = !manualVerifyOnly
    ? []
    : runtimeHints.length > 0
      ? runtimeHints
      : input.taskKind === 'browser_task'
        ? ['browser.dom_snapshot']
        : input.taskKind === 'app_task' || input.taskKind === 'hybrid_task'
          ? ['desktop.observe_app']
          : [];
  return {
    manualVerifyOnly,
    mutationDispatched,
    verificationOnlyTools,
  };
}

export type ComputerTaskCapabilityBuildoutStatusLike =
  | 'approval_required'
  | 'requested'
  | 'ready_to_retry'
  | 'incomplete'
  | 'blocked'
  | 'failed'
  | null
  | undefined;

export type ChatComputerTaskOutcomeStatus =
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'deferred'
  | 'needs_input';

const COMPUTER_TASK_OUTCOME_STATUSES = new Set<ComputerTaskOutcomeStatus>([
  'completed',
  'partial',
  'blocked',
  'needs_input',
  'waiting_approval',
  'failed',
  'cancelled',
]);

export function normalizeComputerTaskOutcomeStatus(
  value: unknown,
): ComputerTaskOutcomeStatus | null {
  return typeof value === 'string' && COMPUTER_TASK_OUTCOME_STATUSES.has(value as ComputerTaskOutcomeStatus)
    ? value as ComputerTaskOutcomeStatus
    : null;
}

export function deriveAgentTaskTerminalOutcome(input: {
  transportSuccess: boolean;
  expectation?: AgentTaskCompletionExpectation;
  structuredStatus?: Exclude<AgentTaskTerminalOutcomeStatus, 'inconclusive'> | null;
}): AgentTaskTerminalOutcome {
  if (!input.transportSuccess) {
    return {
      status: input.structuredStatus === 'cancelled' ? 'cancelled' : 'failed',
      source: input.structuredStatus ? 'structured_runtime' : 'transport_error',
      reason: input.structuredStatus === 'cancelled'
        ? 'The runtime reported cancellation.'
        : 'The agent transport failed before a successful response was returned.',
    };
  }
  if (input.structuredStatus) {
    return {
      status: input.structuredStatus,
      source: 'structured_runtime',
      reason: `The runtime reported a structured ${input.structuredStatus} terminal outcome.`,
    };
  }
  if ((input.expectation || 'response') === 'verified_task') {
    return {
      status: 'inconclusive',
      source: 'response_received',
      reason: 'The model returned prose, but this runtime exposed no structured proof that the requested task completed.',
    };
  }
  return {
    status: 'completed',
    source: 'response_received',
    reason: 'The requested outcome was a model response and a response was returned.',
  };
}

export function deriveComputerTaskAdapterOutcomeStatus(input: {
  ok: boolean;
  /** Explicit after-state/predicate proof for a mutating adapter result. */
  proofVerified: boolean;
  blocked?: boolean;
  cancelled?: boolean;
}): ComputerTaskOutcomeStatus {
  if (input.cancelled) return 'cancelled';
  if (input.blocked) return 'blocked';
  if (!input.ok) return 'failed';
  return input.proofVerified ? 'completed' : 'partial';
}

/**
 * A desktop sequence is proven complete only when its final dispatched step is
 * a successful after-state verification. Proof collected earlier in a batch
 * becomes stale as soon as a later click, type, navigation, or other mutation
 * runs.
 */
export function hasTerminalDesktopSequenceCompletionProof(
  steps: ReadonlyArray<{ kind?: unknown; ok?: unknown }> | null | undefined,
): boolean {
  if (!steps?.length) return false;
  const terminalStep = steps[steps.length - 1];
  return terminalStep?.kind === 'output_verification' && terminalStep.ok === true;
}

export function deriveComputerTaskAgentOutcomeStatus(input: {
  success: boolean;
  terminalOutcomeStatus?: AgentTaskTerminalOutcomeStatus | null;
  partialProgress?: boolean;
  blocked?: boolean;
  cancelled?: boolean;
  capabilityBuildoutStatus?: ComputerTaskCapabilityBuildoutStatusLike;
}): ComputerTaskOutcomeStatus {
  if (input.cancelled) return 'cancelled';

  switch (input.capabilityBuildoutStatus) {
    case 'approval_required':
      return 'waiting_approval';
    case 'requested':
      return input.partialProgress ? 'partial' : 'blocked';
    case 'ready_to_retry':
    case 'incomplete':
    case 'blocked':
      return 'blocked';
    case 'failed':
      return 'failed';
    default:
      break;
  }

  if (input.blocked) return 'blocked';
  switch (input.terminalOutcomeStatus) {
    case 'completed':
      return 'completed';
    case 'cancelled':
      return 'cancelled';
    case 'inconclusive':
      return input.partialProgress ? 'partial' : 'blocked';
    case 'failed':
      return input.partialProgress ? 'partial' : 'failed';
    default:
      // Backward-compatible fallback for callers that have not adopted the
      // typed terminal seam yet. Computer-task callers always provide it.
      if (input.success) return 'completed';
      return input.partialProgress ? 'partial' : 'failed';
  }
}

/**
 * Temporary adapter for the coarser ChatAutomationOutcome union.
 *
 * Chat callers must also persist the original ComputerTaskOutcomeStatus in
 * `data.computerTaskStatus`; this mapping must never be used as the source of
 * truth for task completion.
 */
export function mapComputerTaskOutcomeToChatStatus(
  status: ComputerTaskOutcomeStatus,
): ChatComputerTaskOutcomeStatus {
  switch (status) {
    case 'completed':
      return 'completed';
    case 'needs_input':
      return 'needs_input';
    case 'waiting_approval':
      return 'deferred';
    case 'failed':
      return 'failed';
    case 'partial':
    case 'blocked':
    case 'cancelled':
      return 'blocked';
  }
}

export function isComputerTaskOutcomeComplete(
  status: ComputerTaskOutcomeStatus,
): boolean {
  return status === 'completed';
}
