import { buildComputerAppToolArgsFingerprintAsync } from './computerAppGrounding';

/**
 * Pure V1 root-task coordinator for universal computer work.
 *
 * This module deliberately owns no database, network, timer, bridge, or UI
 * behavior. Callers supply authenticated identity, canonical timestamps, and
 * durable snapshots. The module supplies deterministic cryptographic identity,
 * immutable snapshots, strict hydration, and compare-and-set state changes.
 * A returned object is data, never dispatch authority by itself.
 */

export const COMPUTER_TASK_ROOT_SCHEMA_VERSION = 1 as const;
export const COMPUTER_TASK_ROOT_MAX_SNAPSHOT_CHARS = 256_000;
export const COMPUTER_TASK_ROOT_MAX_ATTEMPTS = 64;
export const COMPUTER_TASK_ROOT_MAX_CHECKPOINTS = 256;
export const COMPUTER_TASK_ROOT_MAX_ACTIONS = 128;
export const COMPUTER_TASK_ROOT_MAX_PREDICATES = 64;

export type ComputerTaskRootSource =
  | 'chat'
  | 'office'
  | 'automation'
  | 'api'
  | 'connected_agent'
  | 'system';

export type ComputerTaskRootState =
  | 'admitted'
  | 'running'
  | 'waiting_approval'
  | 'waiting_input'
  | 'paused'
  | 'verification_only'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ComputerTaskRootReplayPolicy = 'normal' | 'verification_only' | 'terminal';

export type ComputerTaskAttemptKind =
  | 'deterministic'
  | 'provider'
  | 'compiler'
  | 'connected_agent'
  | 'capability_buildout'
  | 'recovery';

export type ComputerTaskAttemptState = 'active' | 'completed' | 'failed' | 'cancelled';

export type ComputerTaskCheckpointKind =
  | 'plan'
  | 'observation'
  | 'approval'
  | 'action'
  | 'verification'
  | 'recovery'
  | 'terminal';

export type ComputerTaskRootActionState =
  | 'planned'
  | 'claimed'
  | 'dispatched'
  | 'verified'
  | 'failed'
  | 'outcome_unknown';

export type ComputerTaskActionDispatchSource =
  | 'compiler'
  | 'provider'
  | 'deterministic'
  | 'connected_agent'
  | 'capability_buildout'
  | 'recovery';

export type ComputerTaskActionAuthorizationCategory =
  | 'read_only'
  | 'direct_request'
  | 'plan_approval'
  | 'per_action_approval'
  | 'provider_native'
  | 'proposal_only'
  | 'unsupported';

export type ComputerTaskActionMutationAuthority =
  | 'read_only'
  | 'action_ledger'
  | 'provider_idempotency'
  | 'proposal_only'
  | 'unsupported';

export type ComputerTaskRootFailureCode =
  | 'invalid_input'
  | 'malformed_snapshot'
  | 'fingerprint_unavailable'
  | 'fingerprint_mismatch'
  | 'admission_drift'
  | 'stale_revision'
  | 'terminal_root'
  | 'interrupted_root'
  | 'invalid_transition'
  | 'identity_conflict'
  | 'capacity_exceeded';

export type ComputerTaskRootFailure = Readonly<{
  ok: false;
  code: ComputerTaskRootFailureCode;
  message: string;
  retryable: false;
}>;

export type ComputerTaskAdmittedRequestV1 = Readonly<{
  schemaVersion: 1;
  requestIdentity: string;
  userId: string;
  circleId: string;
  threadId: string | null;
  source: ComputerTaskRootSource;
  admittedAt: string;
}>;

export type ComputerTaskRootInterruptLatchV1 = Readonly<{
  kind: 'stop_requested' | 'human_foreground_override';
  latchedAt: string;
  revision: number;
}>;

export type ComputerTaskAttemptV1 = Readonly<{
  attemptId: string;
  index: number;
  kind: ComputerTaskAttemptKind;
  parentAttemptId: string | null;
  state: ComputerTaskAttemptState;
  startedAt: string;
  finishedAt: string | null;
}>;

export type ComputerTaskCheckpointV1 = Readonly<{
  checkpointId: string;
  sequence: number;
  attemptId: string | null;
  kind: ComputerTaskCheckpointKind;
  rootState: ComputerTaskRootState;
  recordedAt: string;
  evidenceFingerprint: string | null;
}>;

export type ComputerTaskForegroundLeaseV1 = Readonly<{
  leaseId: string;
  actionId: string;
  targetFingerprint: string;
  acquiredAt: string;
  expiresAt: string;
  status: 'active' | 'released' | 'revoked';
  releasedAt: string | null;
}>;

export type ComputerTaskActionDispatchBindingV1 = Readonly<{
  schemaVersion: 1;
  source: ComputerTaskActionDispatchSource;
  callIdentityFingerprint: string;
  authorizationCategory: ComputerTaskActionAuthorizationCategory;
  mutationAuthority: ComputerTaskActionMutationAuthority;
  policyBindingFingerprint: string;
  verifierBindingFingerprint: string;
  replayBindingFingerprint: string;
  boundAt: string;
}>;

export type ComputerTaskRootActionV1 = Readonly<{
  actionId: string;
  index: number;
  attemptId: string;
  tool: string;
  toolArgsFingerprint: string;
  authorizationFingerprint: string;
  idempotencyKey: string;
  mutatesState: boolean;
  requiresForegroundLease: boolean;
  acceptanceBindingFingerprint: string;
  dispatchBinding: ComputerTaskActionDispatchBindingV1 | null;
  state: ComputerTaskRootActionState;
  proofFingerprint: string | null;
  updatedAt: string;
}>;

export type ComputerTaskRootAcceptanceV1 = Readonly<{
  schemaVersion: 1;
  acceptanceFingerprint: string;
  attemptId: string;
  boundAt: string;
  predicateFingerprints: ReadonlyArray<string>;
  actions: ReadonlyArray<ComputerTaskRootActionV1>;
}>;

export type ComputerTaskRootV1 = Readonly<{
  schemaVersion: 1;
  rootId: string;
  rootFingerprint: string;
  requestIdentityFingerprint: string;
  taskFingerprint: string;
  request: ComputerTaskAdmittedRequestV1;
  revision: number;
  state: ComputerTaskRootState;
  replayPolicy: ComputerTaskRootReplayPolicy;
  interruptLatch: ComputerTaskRootInterruptLatchV1 | null;
  attempts: ReadonlyArray<ComputerTaskAttemptV1>;
  checkpoints: ReadonlyArray<ComputerTaskCheckpointV1>;
  foregroundLease: ComputerTaskForegroundLeaseV1 | null;
  acceptance: ComputerTaskRootAcceptanceV1 | null;
  completionProofFingerprint: string | null;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
}>;

export type AdmitComputerTaskRootInput = Readonly<{
  schemaVersion: 1;
  requestIdentity: unknown;
  userId: unknown;
  circleId: unknown;
  threadId?: unknown;
  source: unknown;
  /** Raw task text is normalized and hashed; it is never retained in the root. */
  normalizedTask: unknown;
  admittedAt: unknown;
  /** Exact prior snapshot when admission may be a refresh/retry. */
  existing?: string | unknown;
}>;

export type AdmitComputerTaskRootResult =
  | Readonly<{
      ok: true;
      disposition: 'created' | 'duplicate';
      root: ComputerTaskRootV1;
    }>
  | ComputerTaskRootFailure;

export type ComputerTaskRootActionDraft = Readonly<{
  tool: unknown;
  toolArgsFingerprint: unknown;
  authorizationFingerprint: unknown;
  mutatesState: unknown;
  requiresForegroundLease: unknown;
}>;

export type ComputerTaskRootTransition =
  | Readonly<{
      type: 'begin_attempt';
      kind: unknown;
      parentAttemptId: unknown;
      at: unknown;
    }>
  | Readonly<{
      type: 'finish_attempt';
      attemptId: unknown;
      outcome: unknown;
      at: unknown;
    }>
  | Readonly<{
      type: 'bind_acceptance';
      attemptId: unknown;
      actions: ReadonlyArray<ComputerTaskRootActionDraft>;
      predicateFingerprints: ReadonlyArray<unknown>;
      at: unknown;
    }>
  | Readonly<{
      type: 'bind_action_dispatch';
      actionId: unknown;
      source: unknown;
      callIdentityFingerprint: unknown;
      authorizationCategory: unknown;
      mutationAuthority: unknown;
      policyBindingFingerprint: unknown;
      verifierBindingFingerprint: unknown;
      replayBindingFingerprint: unknown;
      at: unknown;
    }>
  | Readonly<{
      type: 'record_action_state';
      actionId: unknown;
      nextState: unknown;
      proofFingerprint: unknown;
      at: unknown;
    }>
  | Readonly<{
      type: 'append_checkpoint';
      checkpointId: unknown;
      attemptId: unknown;
      kind: unknown;
      evidenceFingerprint: unknown;
      at: unknown;
    }>
  | Readonly<{
      type: 'bind_foreground_lease';
      leaseId: unknown;
      actionId: unknown;
      targetFingerprint: unknown;
      expiresAt: unknown;
      at: unknown;
    }>
  | Readonly<{
      type: 'release_foreground_lease';
      leaseId: unknown;
      at: unknown;
    }>
  | Readonly<{
      type: 'set_waiting';
      state: 'waiting_approval' | 'waiting_input' | 'paused';
      at: unknown;
    }>
  | Readonly<{ type: 'stop_requested'; at: unknown }>
  | Readonly<{ type: 'human_foreground_override'; at: unknown }>
  | Readonly<{
      type: 'complete';
      acceptanceFingerprint: unknown;
      proofFingerprint: unknown;
      at: unknown;
    }>
  | Readonly<{ type: 'fail'; at: unknown }>;

export type ComputerTaskRootTransitionResult =
  | Readonly<{
      ok: true;
      disposition: 'applied';
      previousRevision: number;
      root: ComputerTaskRootV1;
    }>
  | ComputerTaskRootFailure;

export type ComputerTaskRootHydrationResult =
  | Readonly<{ ok: true; root: ComputerTaskRootV1 }>
  | ComputerTaskRootFailure;

export type ComputerTaskRootSerializationResult =
  | Readonly<{ ok: true; serialized: string; root: ComputerTaskRootV1 }>
  | ComputerTaskRootFailure;

/**
 * Whether this canonical request already owns execution history that must be
 * resumed by an exact adapter. A caller must never route such a root through
 * a generic planner after compiler/feature drift, because that could replay a
 * mutation outside the immutable acceptance and action ledger.
 */
export function computerTaskRootRequiresExactResume(root: ComputerTaskRootV1): boolean {
  return root.state !== 'admitted'
    || root.attempts.length > 0
    || root.acceptance !== null
    || root.replayPolicy !== 'normal';
}

type UnknownRecord = Record<string, unknown>;

const FINGERPRINT_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const OPAQUE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@-]{0,239}$/;
const TOOL_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const DERIVED_ID_RE = /^computer_(?:task|attempt|action)_[0-9a-f]{64}$/;
const IDEMPOTENCY_KEY_RE = /^computer-task\.[0-9a-f]{64}$/;
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const MAX_TASK_CHARS = 16_000;
const MAX_LEASE_MS = 15 * 60 * 1_000;
const MAX_REVISION = 2_147_483_647;

const SOURCES = new Set<ComputerTaskRootSource>([
  'chat',
  'office',
  'automation',
  'api',
  'connected_agent',
  'system',
]);
const ROOT_STATES = new Set<ComputerTaskRootState>([
  'admitted',
  'running',
  'waiting_approval',
  'waiting_input',
  'paused',
  'verification_only',
  'completed',
  'failed',
  'cancelled',
]);
const TERMINAL_STATES = new Set<ComputerTaskRootState>(['completed', 'failed', 'cancelled']);
const REPLAY_POLICIES = new Set<ComputerTaskRootReplayPolicy>([
  'normal',
  'verification_only',
  'terminal',
]);
const ATTEMPT_KINDS = new Set<ComputerTaskAttemptKind>([
  'deterministic',
  'provider',
  'compiler',
  'connected_agent',
  'capability_buildout',
  'recovery',
]);
const ATTEMPT_STATES = new Set<ComputerTaskAttemptState>([
  'active',
  'completed',
  'failed',
  'cancelled',
]);
const CHECKPOINT_KINDS = new Set<ComputerTaskCheckpointKind>([
  'plan',
  'observation',
  'approval',
  'action',
  'verification',
  'recovery',
  'terminal',
]);
const ACTION_STATES = new Set<ComputerTaskRootActionState>([
  'planned',
  'claimed',
  'dispatched',
  'verified',
  'failed',
  'outcome_unknown',
]);
const ACTION_DISPATCH_SOURCES = new Set<ComputerTaskActionDispatchSource>([
  'compiler',
  'provider',
  'deterministic',
  'connected_agent',
  'capability_buildout',
  'recovery',
]);
const ACTION_AUTHORIZATION_CATEGORIES = new Set<ComputerTaskActionAuthorizationCategory>([
  'read_only',
  'direct_request',
  'plan_approval',
  'per_action_approval',
  'provider_native',
  'proposal_only',
  'unsupported',
]);
const ACTION_MUTATION_AUTHORITIES = new Set<ComputerTaskActionMutationAuthority>([
  'read_only',
  'action_ledger',
  'provider_idempotency',
  'proposal_only',
  'unsupported',
]);

const ROOT_KEYS = new Set([
  'schemaVersion',
  'rootId',
  'rootFingerprint',
  'requestIdentityFingerprint',
  'taskFingerprint',
  'request',
  'revision',
  'state',
  'replayPolicy',
  'interruptLatch',
  'attempts',
  'checkpoints',
  'foregroundLease',
  'acceptance',
  'completionProofFingerprint',
  'createdAt',
  'updatedAt',
  'terminalAt',
]);
const REQUEST_KEYS = new Set([
  'schemaVersion',
  'requestIdentity',
  'userId',
  'circleId',
  'threadId',
  'source',
  'admittedAt',
]);
const LATCH_KEYS = new Set(['kind', 'latchedAt', 'revision']);
const ATTEMPT_KEYS = new Set([
  'attemptId',
  'index',
  'kind',
  'parentAttemptId',
  'state',
  'startedAt',
  'finishedAt',
]);
const CHECKPOINT_KEYS = new Set([
  'checkpointId',
  'sequence',
  'attemptId',
  'kind',
  'rootState',
  'recordedAt',
  'evidenceFingerprint',
]);
const LEASE_KEYS = new Set([
  'leaseId',
  'actionId',
  'targetFingerprint',
  'acquiredAt',
  'expiresAt',
  'status',
  'releasedAt',
]);
const ACCEPTANCE_KEYS = new Set([
  'schemaVersion',
  'acceptanceFingerprint',
  'attemptId',
  'boundAt',
  'predicateFingerprints',
  'actions',
]);
const ACTION_KEYS = new Set([
  'actionId',
  'index',
  'attemptId',
  'tool',
  'toolArgsFingerprint',
  'authorizationFingerprint',
  'idempotencyKey',
  'mutatesState',
  'requiresForegroundLease',
  'acceptanceBindingFingerprint',
  'dispatchBinding',
  'state',
  'proofFingerprint',
  'updatedAt',
]);
const ACTION_DISPATCH_BINDING_KEYS = new Set([
  'schemaVersion',
  'source',
  'callIdentityFingerprint',
  'authorizationCategory',
  'mutationAuthority',
  'policyBindingFingerprint',
  'verifierBindingFingerprint',
  'replayBindingFingerprint',
  'boundAt',
]);
const ADMISSION_KEYS = new Set([
  'schemaVersion',
  'requestIdentity',
  'userId',
  'circleId',
  'threadId',
  'source',
  'normalizedTask',
  'admittedAt',
  'existing',
]);

function failure(
  code: ComputerTaskRootFailureCode,
  message: string,
): ComputerTaskRootFailure {
  return Object.freeze({ ok: false, code, message: message.slice(0, 240), retryable: false });
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: UnknownRecord, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function parseOpaqueId(value: unknown): string | null {
  return typeof value === 'string'
    && value.length <= 240
    && value.trim() === value
    && OPAQUE_ID_RE.test(value)
    ? value
    : null;
}

function parseTool(value: unknown): string | null {
  return typeof value === 'string'
    && value.trim() === value
    && TOOL_RE.test(value)
    ? value
    : null;
}

function parseFingerprint(value: unknown): string | null {
  return typeof value === 'string' && FINGERPRINT_RE.test(value) ? value : null;
}

function parseDerivedId(value: unknown, namespace: 'task' | 'attempt' | 'action'): string | null {
  return typeof value === 'string'
    && DERIVED_ID_RE.test(value)
    && value.startsWith(`computer_${namespace}_`)
    ? value
    : null;
}

function parseCanonicalTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 20 || value.length > 40) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  try {
    const canonical = new Date(ms).toISOString();
    return canonical === value ? value : null;
  } catch {
    return null;
  }
}

function normalizeInputTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 10 || value.length > 64) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

function parseRevision(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_REVISION
    ? value
    : null;
}

function normalizeTaskText(value: unknown): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > MAX_TASK_CHARS) return null;
  if (CONTROL_RE.test(value)) return null;
  let normalized = '';
  try {
    normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  } catch {
    return null;
  }
  return normalized && normalized.length <= MAX_TASK_CHARS ? normalized : null;
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as UnknownRecord)) deepFreeze(child);
  return Object.freeze(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function isSafeJsonTree(
  value: unknown,
  seen: Set<object>,
  budget: { nodes: number; chars: number },
  depth = 0,
): boolean {
  budget.nodes += 1;
  if (budget.nodes > 8_192 || depth > 24) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    budget.chars += value.length;
    return budget.chars <= COMPUTER_TASK_ROOT_MAX_SNAPSHOT_CHARS;
  }
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype || value.length > COMPUTER_TASK_ROOT_MAX_CHECKPOINTS) return false;
  } else if (proto !== Object.prototype && proto !== null) {
    return false;
  }
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string')) return false;
  if (keys.length > 512) return false;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, String(index))) return false;
    }
  }
  for (const key of keys as string[]) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = descriptors[key];
    if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set) return false;
    budget.chars += key.length;
    if (budget.chars > COMPUTER_TASK_ROOT_MAX_SNAPSHOT_CHARS) return false;
    if (!isSafeJsonTree(descriptor.value, seen, budget, depth + 1)) return false;
  }
  seen.delete(value);
  return true;
}

async function digest(value: unknown): Promise<string | null> {
  const result = await buildComputerAppToolArgsFingerprintAsync(value);
  return parseFingerprint(result);
}

function fingerprintHex(value: string): string {
  return value.slice('args-v2:sha256:'.length);
}

async function buildRequestIdentityFingerprint(
  request: ComputerTaskAdmittedRequestV1,
): Promise<string | null> {
  return digest({
    schemaVersion: 1,
    namespace: 'computer_task_request_identity',
    requestIdentity: request.requestIdentity,
    userId: request.userId,
    circleId: request.circleId,
    threadId: request.threadId,
    source: request.source,
  });
}

async function buildTaskFingerprint(normalizedTask: string): Promise<string | null> {
  return digest({
    schemaVersion: 1,
    namespace: 'computer_task',
    normalizedTask,
  });
}

async function buildRootFingerprint(input: {
  requestIdentityFingerprint: string;
  taskFingerprint: string;
  source: ComputerTaskRootSource;
}): Promise<string | null> {
  return digest({
    schemaVersion: 1,
    namespace: 'computer_task_root',
    requestIdentityFingerprint: input.requestIdentityFingerprint,
    taskFingerprint: input.taskFingerprint,
    source: input.source,
  });
}

async function buildAttemptId(input: {
  rootFingerprint: string;
  index: number;
  kind: ComputerTaskAttemptKind;
  parentAttemptId: string | null;
}): Promise<string | null> {
  const fingerprint = await digest({
    schemaVersion: 1,
    namespace: 'computer_task_attempt',
    rootFingerprint: input.rootFingerprint,
    index: input.index,
    kind: input.kind,
    parentAttemptId: input.parentAttemptId,
  });
  return fingerprint ? `computer_attempt_${fingerprintHex(fingerprint)}` : null;
}

async function buildActionId(input: {
  rootFingerprint: string;
  attemptId: string;
  index: number;
  tool: string;
  toolArgsFingerprint: string;
  authorizationFingerprint: string;
}): Promise<string | null> {
  const fingerprint = await digest({
    schemaVersion: 1,
    namespace: 'computer_task_child_action',
    rootFingerprint: input.rootFingerprint,
    attemptId: input.attemptId,
    index: input.index,
    tool: input.tool,
    toolArgsFingerprint: input.toolArgsFingerprint,
    authorizationFingerprint: input.authorizationFingerprint,
  });
  return fingerprint ? `computer_action_${fingerprintHex(fingerprint)}` : null;
}

async function buildActionIdempotencyKey(input: {
  rootFingerprint: string;
  actionId: string;
}): Promise<string | null> {
  const fingerprint = await digest({
    schemaVersion: 1,
    namespace: 'computer_task_action_idempotency',
    rootFingerprint: input.rootFingerprint,
    actionId: input.actionId,
  });
  return fingerprint ? `computer-task.${fingerprintHex(fingerprint)}` : null;
}

type ActionManifest = Readonly<{
  actionId: string;
  index: number;
  attemptId: string;
  tool: string;
  toolArgsFingerprint: string;
  authorizationFingerprint: string;
  idempotencyKey: string;
  mutatesState: boolean;
  requiresForegroundLease: boolean;
}>;

function actionManifest(action: ComputerTaskRootActionV1): ActionManifest {
  return {
    actionId: action.actionId,
    index: action.index,
    attemptId: action.attemptId,
    tool: action.tool,
    toolArgsFingerprint: action.toolArgsFingerprint,
    authorizationFingerprint: action.authorizationFingerprint,
    idempotencyKey: action.idempotencyKey,
    mutatesState: action.mutatesState,
    requiresForegroundLease: action.requiresForegroundLease,
  };
}

async function buildAcceptanceFingerprint(input: {
  rootFingerprint: string;
  attemptId: string;
  predicateFingerprints: ReadonlyArray<string>;
  actions: ReadonlyArray<ActionManifest>;
}): Promise<string | null> {
  return digest({
    schemaVersion: 1,
    namespace: 'computer_task_acceptance',
    rootFingerprint: input.rootFingerprint,
    attemptId: input.attemptId,
    predicateFingerprints: input.predicateFingerprints,
    actions: input.actions,
  });
}

async function buildActionAcceptanceBinding(input: {
  rootFingerprint: string;
  acceptanceFingerprint: string;
  action: ActionManifest;
}): Promise<string | null> {
  return digest({
    schemaVersion: 1,
    namespace: 'computer_task_action_acceptance_binding',
    rootFingerprint: input.rootFingerprint,
    acceptanceFingerprint: input.acceptanceFingerprint,
    action: input.action,
  });
}

function requestMatches(a: ComputerTaskAdmittedRequestV1, b: ComputerTaskAdmittedRequestV1): boolean {
  return a.requestIdentity === b.requestIdentity
    && a.userId === b.userId
    && a.circleId === b.circleId
    && a.threadId === b.threadId
    && a.source === b.source;
}

function isTerminal(state: ComputerTaskRootState): boolean {
  return TERMINAL_STATES.has(state);
}

/** Only valid for a root returned by admit/hydrate/transition. */
export function canActivateComputerTaskRoot(root: ComputerTaskRootV1): boolean {
  return root.schemaVersion === 1
    && root.replayPolicy === 'normal'
    && root.interruptLatch === null
    && !isTerminal(root.state);
}

function cloneRoot(root: ComputerTaskRootV1): ComputerTaskRootV1 {
  return {
    ...root,
    request: { ...root.request },
    interruptLatch: root.interruptLatch ? { ...root.interruptLatch } : null,
    attempts: root.attempts.map((attempt) => ({ ...attempt })),
    checkpoints: root.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    foregroundLease: root.foregroundLease ? { ...root.foregroundLease } : null,
    acceptance: root.acceptance
      ? {
          ...root.acceptance,
          predicateFingerprints: [...root.acceptance.predicateFingerprints],
          actions: root.acceptance.actions.map((action) => ({
            ...action,
            dispatchBinding: action.dispatchBinding ? { ...action.dispatchBinding } : null,
          })),
        }
      : null,
  };
}

async function parseRequest(value: unknown): Promise<{
  request: ComputerTaskAdmittedRequestV1;
  requestIdentityFingerprint: string;
} | null> {
  if (!isRecord(value) || !hasExactKeys(value, REQUEST_KEYS) || value.schemaVersion !== 1) return null;
  const requestIdentity = parseOpaqueId(value.requestIdentity);
  const userId = parseOpaqueId(value.userId);
  const circleId = parseOpaqueId(value.circleId);
  const threadId = value.threadId === null ? null : parseOpaqueId(value.threadId);
  const source = typeof value.source === 'string' && SOURCES.has(value.source as ComputerTaskRootSource)
    ? value.source as ComputerTaskRootSource
    : null;
  const admittedAt = parseCanonicalTimestamp(value.admittedAt);
  if (!requestIdentity || !userId || !circleId || value.threadId !== null && !threadId || !source || !admittedAt) {
    return null;
  }
  const request: ComputerTaskAdmittedRequestV1 = {
    schemaVersion: 1,
    requestIdentity,
    userId,
    circleId,
    threadId,
    source,
    admittedAt,
  };
  const requestIdentityFingerprint = await buildRequestIdentityFingerprint(request);
  return requestIdentityFingerprint ? { request, requestIdentityFingerprint } : null;
}

async function parseAttempts(
  value: unknown,
  rootFingerprint: string,
  createdAtMs: number,
  updatedAtMs: number,
): Promise<ComputerTaskAttemptV1[] | null> {
  if (!Array.isArray(value) || value.length > COMPUTER_TASK_ROOT_MAX_ATTEMPTS) return null;
  const output: ComputerTaskAttemptV1[] = [];
  const priorIds = new Set<string>();
  let activeCount = 0;
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry) || !hasExactKeys(entry, ATTEMPT_KEYS)) return null;
    const attemptId = parseDerivedId(entry.attemptId, 'attempt');
    const storedIndex = parseRevision(entry.index);
    const kind = typeof entry.kind === 'string' && ATTEMPT_KINDS.has(entry.kind as ComputerTaskAttemptKind)
      ? entry.kind as ComputerTaskAttemptKind
      : null;
    const parentAttemptId = entry.parentAttemptId === null
      ? null
      : parseDerivedId(entry.parentAttemptId, 'attempt');
    const state = typeof entry.state === 'string' && ATTEMPT_STATES.has(entry.state as ComputerTaskAttemptState)
      ? entry.state as ComputerTaskAttemptState
      : null;
    const startedAt = parseCanonicalTimestamp(entry.startedAt);
    const finishedAt = entry.finishedAt === null ? null : parseCanonicalTimestamp(entry.finishedAt);
    if (
      !attemptId
      || storedIndex !== index
      || !kind
      || entry.parentAttemptId !== null && !parentAttemptId
      || parentAttemptId !== null && !priorIds.has(parentAttemptId)
      || !state
      || !startedAt
      || state === 'active' && finishedAt !== null
      || state !== 'active' && finishedAt === null
    ) return null;
    const startedAtMs = Date.parse(startedAt);
    const finishedAtMs = finishedAt ? Date.parse(finishedAt) : null;
    if (
      startedAtMs < createdAtMs
      || startedAtMs > updatedAtMs
      || finishedAtMs !== null && (finishedAtMs < startedAtMs || finishedAtMs > updatedAtMs)
    ) return null;
    const expectedId = await buildAttemptId({ rootFingerprint, index, kind, parentAttemptId });
    if (!expectedId || attemptId !== expectedId || priorIds.has(attemptId)) return null;
    if (state === 'active') activeCount += 1;
    if (activeCount > 1) return null;
    priorIds.add(attemptId);
    output.push({ attemptId, index, kind, parentAttemptId, state, startedAt, finishedAt });
  }
  return output;
}

function parseCheckpoints(
  value: unknown,
  attempts: ReadonlyArray<ComputerTaskAttemptV1>,
  createdAtMs: number,
  updatedAtMs: number,
): ComputerTaskCheckpointV1[] | null {
  if (!Array.isArray(value) || value.length > COMPUTER_TASK_ROOT_MAX_CHECKPOINTS) return null;
  const attemptIds = new Set(attempts.map((attempt) => attempt.attemptId));
  const checkpointIds = new Set<string>();
  const output: ComputerTaskCheckpointV1[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entry = value[index];
    if (!isRecord(entry) || !hasExactKeys(entry, CHECKPOINT_KEYS)) return null;
    const checkpointId = parseOpaqueId(entry.checkpointId);
    const sequence = parseRevision(entry.sequence);
    const attemptId = entry.attemptId === null ? null : parseDerivedId(entry.attemptId, 'attempt');
    const kind = typeof entry.kind === 'string' && CHECKPOINT_KINDS.has(entry.kind as ComputerTaskCheckpointKind)
      ? entry.kind as ComputerTaskCheckpointKind
      : null;
    const rootState = typeof entry.rootState === 'string' && ROOT_STATES.has(entry.rootState as ComputerTaskRootState)
      ? entry.rootState as ComputerTaskRootState
      : null;
    const recordedAt = parseCanonicalTimestamp(entry.recordedAt);
    const evidenceFingerprint = entry.evidenceFingerprint === null
      ? null
      : parseFingerprint(entry.evidenceFingerprint);
    if (
      !checkpointId
      || checkpointIds.has(checkpointId)
      || sequence !== index + 1
      || entry.attemptId !== null && (!attemptId || !attemptIds.has(attemptId))
      || !kind
      || !rootState
      || !recordedAt
      || entry.evidenceFingerprint !== null && !evidenceFingerprint
    ) return null;
    const recordedAtMs = Date.parse(recordedAt);
    if (recordedAtMs < createdAtMs || recordedAtMs > updatedAtMs) return null;
    if (index > 0 && recordedAtMs < Date.parse(output[index - 1].recordedAt)) return null;
    checkpointIds.add(checkpointId);
    output.push({
      checkpointId,
      sequence,
      attemptId,
      kind,
      rootState,
      recordedAt,
      evidenceFingerprint,
    });
  }
  return output;
}

function parseLease(
  value: unknown,
  createdAtMs: number,
  updatedAtMs: number,
): ComputerTaskForegroundLeaseV1 | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, LEASE_KEYS)) return undefined;
  const leaseId = parseOpaqueId(value.leaseId);
  const actionId = parseDerivedId(value.actionId, 'action');
  const targetFingerprint = parseFingerprint(value.targetFingerprint);
  const acquiredAt = parseCanonicalTimestamp(value.acquiredAt);
  const expiresAt = parseCanonicalTimestamp(value.expiresAt);
  const status = value.status === 'active' || value.status === 'released' || value.status === 'revoked'
    ? value.status
    : null;
  const releasedAt = value.releasedAt === null ? null : parseCanonicalTimestamp(value.releasedAt);
  if (
    !leaseId
    || !actionId
    || !targetFingerprint
    || !acquiredAt
    || !expiresAt
    || !status
    || status === 'active' && releasedAt !== null
    || status !== 'active' && releasedAt === null
  ) return undefined;
  const acquiredAtMs = Date.parse(acquiredAt);
  const expiresAtMs = Date.parse(expiresAt);
  const releasedAtMs = releasedAt ? Date.parse(releasedAt) : null;
  if (
    acquiredAtMs < createdAtMs
    || acquiredAtMs > updatedAtMs
    || expiresAtMs <= acquiredAtMs
    || expiresAtMs - acquiredAtMs > MAX_LEASE_MS
    || releasedAtMs !== null && (releasedAtMs < acquiredAtMs || releasedAtMs > updatedAtMs)
  ) return undefined;
  return { leaseId, actionId, targetFingerprint, acquiredAt, expiresAt, status, releasedAt };
}

function parseActionDispatchBinding(
  value: unknown,
  actionMutatesState: boolean,
  expectedSource: ComputerTaskAttemptKind,
  acceptanceBoundAtMs: number,
  actionUpdatedAtMs: number,
): ComputerTaskActionDispatchBindingV1 | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value)
    || !hasExactKeys(value, ACTION_DISPATCH_BINDING_KEYS)
    || value.schemaVersion !== 1
  ) return undefined;
  const source = typeof value.source === 'string'
    && ACTION_DISPATCH_SOURCES.has(value.source as ComputerTaskActionDispatchSource)
    ? value.source as ComputerTaskActionDispatchSource
    : null;
  const callIdentityFingerprint = parseFingerprint(value.callIdentityFingerprint);
  const authorizationCategory = typeof value.authorizationCategory === 'string'
    && ACTION_AUTHORIZATION_CATEGORIES.has(
      value.authorizationCategory as ComputerTaskActionAuthorizationCategory,
    )
    ? value.authorizationCategory as ComputerTaskActionAuthorizationCategory
    : null;
  const mutationAuthority = typeof value.mutationAuthority === 'string'
    && ACTION_MUTATION_AUTHORITIES.has(value.mutationAuthority as ComputerTaskActionMutationAuthority)
    ? value.mutationAuthority as ComputerTaskActionMutationAuthority
    : null;
  const policyBindingFingerprint = parseFingerprint(value.policyBindingFingerprint);
  const verifierBindingFingerprint = parseFingerprint(value.verifierBindingFingerprint);
  const replayBindingFingerprint = parseFingerprint(value.replayBindingFingerprint);
  const boundAt = parseCanonicalTimestamp(value.boundAt);
  if (
    !source
    || source !== expectedSource
    || !callIdentityFingerprint
    || !authorizationCategory
    || !mutationAuthority
    || !policyBindingFingerprint
    || !verifierBindingFingerprint
    || !replayBindingFingerprint
    || !boundAt
    || Date.parse(boundAt) < acceptanceBoundAtMs
    || Date.parse(boundAt) > actionUpdatedAtMs
    || !actionMutatesState
      && (authorizationCategory !== 'read_only' || mutationAuthority !== 'read_only')
    || actionMutatesState
      && (authorizationCategory === 'read_only' || mutationAuthority === 'read_only')
  ) return undefined;
  return {
    schemaVersion: 1,
    source,
    callIdentityFingerprint,
    authorizationCategory,
    mutationAuthority,
    policyBindingFingerprint,
    verifierBindingFingerprint,
    replayBindingFingerprint,
    boundAt,
  };
}

function actionDispatchBindingIsExecutable(
  binding: ComputerTaskActionDispatchBindingV1,
  mutatesState: boolean,
): boolean {
  if (
    binding.authorizationCategory === 'proposal_only'
    || binding.authorizationCategory === 'unsupported'
    || binding.mutationAuthority === 'proposal_only'
    || binding.mutationAuthority === 'unsupported'
  ) return false;
  return mutatesState
    ? binding.mutationAuthority === 'action_ledger'
      || binding.mutationAuthority === 'provider_idempotency'
    : binding.authorizationCategory === 'read_only'
      && binding.mutationAuthority === 'read_only';
}

async function parseAcceptance(
  value: unknown,
  rootFingerprint: string,
  attempts: ReadonlyArray<ComputerTaskAttemptV1>,
  createdAtMs: number,
  updatedAtMs: number,
): Promise<ComputerTaskRootAcceptanceV1 | null | undefined> {
  if (value === null) return null;
  if (!isRecord(value) || !hasExactKeys(value, ACCEPTANCE_KEYS) || value.schemaVersion !== 1) {
    return undefined;
  }
  const acceptanceFingerprint = parseFingerprint(value.acceptanceFingerprint);
  const attemptId = parseDerivedId(value.attemptId, 'attempt');
  const acceptanceAttempt = attemptId
    ? attempts.find((attempt) => attempt.attemptId === attemptId)
    : undefined;
  const boundAt = parseCanonicalTimestamp(value.boundAt);
  if (
    !acceptanceFingerprint
    || !attemptId
    || !acceptanceAttempt
    || !boundAt
    || Date.parse(boundAt) < createdAtMs
    || Date.parse(boundAt) > updatedAtMs
    || !Array.isArray(value.predicateFingerprints)
    || value.predicateFingerprints.length < 1
    || value.predicateFingerprints.length > COMPUTER_TASK_ROOT_MAX_PREDICATES
    || !Array.isArray(value.actions)
    || value.actions.length < 1
    || value.actions.length > COMPUTER_TASK_ROOT_MAX_ACTIONS
  ) return undefined;
  const predicateFingerprints: string[] = [];
  const predicateSet = new Set<string>();
  for (const candidate of value.predicateFingerprints) {
    const fingerprint = parseFingerprint(candidate);
    if (!fingerprint || predicateSet.has(fingerprint)) return undefined;
    predicateSet.add(fingerprint);
    predicateFingerprints.push(fingerprint);
  }
  const acceptanceBoundAtMs = Date.parse(boundAt);
  const actions: ComputerTaskRootActionV1[] = [];
  const actionIds = new Set<string>();
  let actionFrontierSeen = false;
  for (let index = 0; index < value.actions.length; index += 1) {
    const entry = value.actions[index];
    if (!isRecord(entry) || !hasExactKeys(entry, ACTION_KEYS)) return undefined;
    const actionId = parseDerivedId(entry.actionId, 'action');
    const storedIndex = parseRevision(entry.index);
    const storedAttemptId = parseDerivedId(entry.attemptId, 'attempt');
    const tool = parseTool(entry.tool);
    const toolArgsFingerprint = parseFingerprint(entry.toolArgsFingerprint);
    const authorizationFingerprint = parseFingerprint(entry.authorizationFingerprint);
    const idempotencyKey = typeof entry.idempotencyKey === 'string'
      && IDEMPOTENCY_KEY_RE.test(entry.idempotencyKey)
      ? entry.idempotencyKey
      : null;
    const acceptanceBindingFingerprint = parseFingerprint(entry.acceptanceBindingFingerprint);
    const state = typeof entry.state === 'string' && ACTION_STATES.has(entry.state as ComputerTaskRootActionState)
      ? entry.state as ComputerTaskRootActionState
      : null;
    const proofFingerprint = entry.proofFingerprint === null
      ? null
      : parseFingerprint(entry.proofFingerprint);
    const updatedAt = parseCanonicalTimestamp(entry.updatedAt);
    if (
      !actionId
      || actionIds.has(actionId)
      || storedIndex !== index
      || storedAttemptId !== attemptId
      || !tool
      || !toolArgsFingerprint
      || !authorizationFingerprint
      || !idempotencyKey
      || typeof entry.mutatesState !== 'boolean'
      || typeof entry.requiresForegroundLease !== 'boolean'
      || entry.requiresForegroundLease && !entry.mutatesState
      || !acceptanceBindingFingerprint
      || !state
      || entry.proofFingerprint !== null && !proofFingerprint
      || state === 'verified' && !proofFingerprint
      || state !== 'verified' && state !== 'outcome_unknown' && proofFingerprint !== null
      || !updatedAt
      || Date.parse(updatedAt) < Date.parse(boundAt)
      || Date.parse(updatedAt) > updatedAtMs
    ) return undefined;
    const dispatchBinding = parseActionDispatchBinding(
      entry.dispatchBinding,
      entry.mutatesState,
      acceptanceAttempt.kind,
      acceptanceBoundAtMs,
      Date.parse(updatedAt),
    );
    if (
      dispatchBinding === undefined
      || state !== 'planned' && dispatchBinding === null
      || state !== 'planned'
        && dispatchBinding !== null
        && !actionDispatchBindingIsExecutable(dispatchBinding, entry.mutatesState)
    ) return undefined;
    if (!actionFrontierSeen) {
      if (state !== 'verified') actionFrontierSeen = true;
    } else if (state !== 'planned') {
      return undefined;
    }
    const expectedActionId = await buildActionId({
      rootFingerprint,
      attemptId,
      index,
      tool,
      toolArgsFingerprint,
      authorizationFingerprint,
    });
    if (!expectedActionId || expectedActionId !== actionId) return undefined;
    const expectedIdempotencyKey = await buildActionIdempotencyKey({ rootFingerprint, actionId });
    if (!expectedIdempotencyKey || idempotencyKey !== expectedIdempotencyKey) return undefined;
    actionIds.add(actionId);
    actions.push({
      actionId,
      index,
      attemptId,
      tool,
      toolArgsFingerprint,
      authorizationFingerprint,
      idempotencyKey,
      mutatesState: entry.mutatesState,
      requiresForegroundLease: entry.requiresForegroundLease,
      acceptanceBindingFingerprint,
      dispatchBinding,
      state,
      proofFingerprint,
      updatedAt,
    });
  }
  const manifests = actions.map(actionManifest);
  const expectedAcceptance = await buildAcceptanceFingerprint({
    rootFingerprint,
    attemptId,
    predicateFingerprints,
    actions: manifests,
  });
  if (!expectedAcceptance || expectedAcceptance !== acceptanceFingerprint) return undefined;
  for (let index = 0; index < actions.length; index += 1) {
    const binding = await buildActionAcceptanceBinding({
      rootFingerprint,
      acceptanceFingerprint,
      action: manifests[index],
    });
    if (!binding || binding !== actions[index].acceptanceBindingFingerprint) return undefined;
  }
  return {
    schemaVersion: 1,
    acceptanceFingerprint,
    attemptId,
    boundAt,
    predicateFingerprints,
    actions,
  };
}

async function validateRootSnapshot(value: unknown): Promise<ComputerTaskRootV1 | null> {
  if (!isRecord(value) || !hasExactKeys(value, ROOT_KEYS) || value.schemaVersion !== 1) return null;
  const rootId = parseDerivedId(value.rootId, 'task');
  const rootFingerprint = parseFingerprint(value.rootFingerprint);
  const requestIdentityFingerprint = parseFingerprint(value.requestIdentityFingerprint);
  const taskFingerprint = parseFingerprint(value.taskFingerprint);
  const revision = parseRevision(value.revision);
  const state = typeof value.state === 'string' && ROOT_STATES.has(value.state as ComputerTaskRootState)
    ? value.state as ComputerTaskRootState
    : null;
  const replayPolicy = typeof value.replayPolicy === 'string'
    && REPLAY_POLICIES.has(value.replayPolicy as ComputerTaskRootReplayPolicy)
    ? value.replayPolicy as ComputerTaskRootReplayPolicy
    : null;
  const createdAt = parseCanonicalTimestamp(value.createdAt);
  const updatedAt = parseCanonicalTimestamp(value.updatedAt);
  const terminalAt = value.terminalAt === null ? null : parseCanonicalTimestamp(value.terminalAt);
  const completionProofFingerprint = value.completionProofFingerprint === null
    ? null
    : parseFingerprint(value.completionProofFingerprint);
  if (
    !rootId
    || !rootFingerprint
    || !requestIdentityFingerprint
    || !taskFingerprint
    || revision === null
    || !state
    || !replayPolicy
    || !createdAt
    || !updatedAt
    || Date.parse(updatedAt) < Date.parse(createdAt)
    || value.terminalAt !== null && !terminalAt
    || value.completionProofFingerprint !== null && !completionProofFingerprint
  ) return null;
  const requestResult = await parseRequest(value.request);
  if (!requestResult || requestResult.requestIdentityFingerprint !== requestIdentityFingerprint) return null;
  const expectedRootFingerprint = await buildRootFingerprint({
    requestIdentityFingerprint,
    taskFingerprint,
    source: requestResult.request.source,
  });
  if (
    !expectedRootFingerprint
    || expectedRootFingerprint !== rootFingerprint
    || rootId !== `computer_task_${fingerprintHex(rootFingerprint)}`
    || createdAt !== requestResult.request.admittedAt
  ) return null;
  const createdAtMs = Date.parse(createdAt);
  const updatedAtMs = Date.parse(updatedAt);
  const attempts = await parseAttempts(value.attempts, rootFingerprint, createdAtMs, updatedAtMs);
  if (!attempts) return null;
  const checkpoints = parseCheckpoints(value.checkpoints, attempts, createdAtMs, updatedAtMs);
  if (!checkpoints) return null;
  const foregroundLease = parseLease(value.foregroundLease, createdAtMs, updatedAtMs);
  if (foregroundLease === undefined) return null;
  const acceptance = await parseAcceptance(
    value.acceptance,
    rootFingerprint,
    attempts,
    createdAtMs,
    updatedAtMs,
  );
  if (acceptance === undefined) return null;
  const leasedAction = foregroundLease && acceptance
    ? acceptance.actions.find((action) => action.actionId === foregroundLease.actionId)
    : undefined;
  if (foregroundLease && !leasedAction) {
    return null;
  }
  let interruptLatch: ComputerTaskRootInterruptLatchV1 | null = null;
  if (value.interruptLatch !== null) {
    if (!isRecord(value.interruptLatch) || !hasExactKeys(value.interruptLatch, LATCH_KEYS)) return null;
    const kind = value.interruptLatch.kind === 'stop_requested'
      || value.interruptLatch.kind === 'human_foreground_override'
      ? value.interruptLatch.kind
      : null;
    const latchedAt = parseCanonicalTimestamp(value.interruptLatch.latchedAt);
    const latchRevision = parseRevision(value.interruptLatch.revision);
    if (
      !kind
      || !latchedAt
      || latchRevision === null
      || latchRevision < 1
      || latchRevision > revision
      || Date.parse(latchedAt) < createdAtMs
      || Date.parse(latchedAt) > updatedAtMs
    ) return null;
    interruptLatch = { kind, latchedAt, revision: latchRevision };
  }
  const terminal = isTerminal(state);
  const ambiguousAction = acceptance?.actions.find((action) => (
    action.state === 'dispatched' || action.state === 'outcome_unknown'
  ));
  const humanOverride = interruptLatch?.kind === 'human_foreground_override';
  const verificationOnlyCause = humanOverride || Boolean(ambiguousAction);
  const acceptanceOwner = acceptance
    ? attempts.find((attempt) => attempt.attemptId === acceptance.attemptId)
    : undefined;
  const activeLeaseMatchesDispatchedAction = foregroundLease?.status === 'active'
    && acceptance?.actions.some((action) => (
      action.actionId === foregroundLease.actionId && action.state === 'dispatched'
    ));
  if (
    terminal !== Boolean(terminalAt)
    || state === 'completed' && !completionProofFingerprint
    || state !== 'completed' && completionProofFingerprint !== null
    || state === 'completed'
      && (!acceptance || acceptance.actions.some((action) => action.state !== 'verified'))
    || terminal && replayPolicy !== 'terminal'
    || !terminal && verificationOnlyCause && (state !== 'verification_only' || replayPolicy !== 'verification_only')
    || !terminal && !verificationOnlyCause && (state === 'verification_only' || replayPolicy !== 'normal')
    || interruptLatch?.kind === 'stop_requested' && (state !== 'cancelled' || replayPolicy !== 'terminal')
    || state === 'cancelled' && interruptLatch?.kind !== 'stop_requested'
    || humanOverride
      && (state !== 'verification_only' || replayPolicy !== 'verification_only' || terminalAt !== null)
    || acceptance && !terminal && !humanOverride && acceptanceOwner?.state !== 'active'
    || foregroundLease?.status === 'active'
      && (
        !leasedAction
        || !leasedAction.mutatesState
        || !leasedAction.requiresForegroundLease
        || leasedAction.state !== 'planned'
          && leasedAction.state !== 'claimed'
          && leasedAction.state !== 'dispatched'
        || (
          leasedAction.state === 'dispatched'
            ? state !== 'verification_only'
            : state !== 'running'
        )
        || !attempts.some((attempt) => (
          attempt.attemptId === leasedAction.attemptId && attempt.state === 'active'
        ))
        || Date.parse(foregroundLease.expiresAt) <= updatedAtMs
        || interruptLatch !== null
        || replayPolicy === 'terminal'
        || replayPolicy === 'verification_only' && !activeLeaseMatchesDispatchedAction
      )
    || attempts.some((attempt) => attempt.state === 'active') && (terminal || interruptLatch !== null)
  ) return null;
  return deepFreeze({
    schemaVersion: 1,
    rootId,
    rootFingerprint,
    requestIdentityFingerprint,
    taskFingerprint,
    request: requestResult.request,
    revision,
    state,
    replayPolicy,
    interruptLatch,
    attempts,
    checkpoints,
    foregroundLease,
    acceptance,
    completionProofFingerprint,
    createdAt,
    updatedAt,
    terminalAt,
  });
}

/** Strictly validate and freeze a serialized or object V1 root snapshot. */
export async function hydrateComputerTaskRoot(
  snapshot: string | unknown,
): Promise<ComputerTaskRootHydrationResult> {
  let value: unknown = snapshot;
  if (typeof snapshot === 'string') {
    if (snapshot.length < 2 || snapshot.length > COMPUTER_TASK_ROOT_MAX_SNAPSHOT_CHARS) {
      return failure('malformed_snapshot', 'Computer task root snapshot is empty or exceeds the V1 bound.');
    }
    try {
      value = JSON.parse(snapshot);
    } catch {
      return failure('malformed_snapshot', 'Computer task root snapshot is not valid JSON.');
    }
  }
  try {
    if (!isSafeJsonTree(value, new Set<object>(), { nodes: 0, chars: 0 })) {
      return failure('malformed_snapshot', 'Computer task root snapshot is not a bounded plain JSON tree.');
    }
    const root = await validateRootSnapshot(value);
    return root
      ? Object.freeze({ ok: true, root })
      : failure('malformed_snapshot', 'Computer task root snapshot failed V1 identity or state validation.');
  } catch {
    return failure('malformed_snapshot', 'Computer task root snapshot could not be validated safely.');
  }
}

/** Validate then serialize one canonical, key-sorted immutable snapshot. */
export async function serializeComputerTaskRoot(
  root: ComputerTaskRootV1,
): Promise<ComputerTaskRootSerializationResult> {
  const hydrated = await hydrateComputerTaskRoot(root);
  if (!hydrated.ok) return hydrated;
  const serialized = canonicalJson(hydrated.root);
  if (serialized.length > COMPUTER_TASK_ROOT_MAX_SNAPSHOT_CHARS) {
    return failure('capacity_exceeded', 'Computer task root snapshot exceeds the V1 serialized bound.');
  }
  return Object.freeze({ ok: true, serialized, root: hydrated.root });
}

/**
 * Admit one authenticated request. Supplying an exact prior snapshot makes a
 * refresh/retry idempotent. The same request identity with changed task/scope
 * is drift, never a second root.
 */
export async function admitComputerTaskRoot(
  input: AdmitComputerTaskRootInput,
): Promise<AdmitComputerTaskRootResult> {
  if (
    !isRecord(input)
    || input.schemaVersion !== 1
    || !Object.keys(input).every((key) => ADMISSION_KEYS.has(key))
    || !isSafeJsonTree(input, new Set<object>(), { nodes: 0, chars: 0 })
  ) {
    return failure('invalid_input', 'Computer task admission requires schemaVersion 1.');
  }
  const requestIdentity = parseOpaqueId(input.requestIdentity);
  const userId = parseOpaqueId(input.userId);
  const circleId = parseOpaqueId(input.circleId);
  const threadId = input.threadId == null ? null : parseOpaqueId(input.threadId);
  const source = typeof input.source === 'string' && SOURCES.has(input.source as ComputerTaskRootSource)
    ? input.source as ComputerTaskRootSource
    : null;
  const normalizedTask = normalizeTaskText(input.normalizedTask);
  const admittedAt = normalizeInputTimestamp(input.admittedAt);
  if (
    !requestIdentity
    || !userId
    || !circleId
    || input.threadId != null && !threadId
    || !source
    || !normalizedTask
    || !admittedAt
  ) return failure('invalid_input', 'Computer task admission identity, task, source, or timestamp is invalid.');
  const request: ComputerTaskAdmittedRequestV1 = {
    schemaVersion: 1,
    requestIdentity,
    userId,
    circleId,
    threadId,
    source,
    admittedAt,
  };
  const requestIdentityFingerprint = await buildRequestIdentityFingerprint(request);
  const taskFingerprint = await buildTaskFingerprint(normalizedTask);
  if (!requestIdentityFingerprint || !taskFingerprint) {
    return failure('fingerprint_unavailable', 'Cryptographic task identity is unavailable; admission failed closed.');
  }
  const rootFingerprint = await buildRootFingerprint({
    requestIdentityFingerprint,
    taskFingerprint,
    source,
  });
  if (!rootFingerprint) {
    return failure('fingerprint_unavailable', 'Cryptographic root identity is unavailable; admission failed closed.');
  }
  if (input.existing !== undefined) {
    const hydrated = await hydrateComputerTaskRoot(input.existing);
    if (!hydrated.ok) return hydrated;
    const existing = hydrated.root;
    if (
      existing.rootFingerprint !== rootFingerprint
      || existing.requestIdentityFingerprint !== requestIdentityFingerprint
      || existing.taskFingerprint !== taskFingerprint
      || !requestMatches(existing.request, request)
    ) {
      return failure('admission_drift', 'Existing root identity does not match this admitted request.');
    }
    return Object.freeze({ ok: true, disposition: 'duplicate', root: existing });
  }
  const root = deepFreeze<ComputerTaskRootV1>({
    schemaVersion: 1,
    rootId: `computer_task_${fingerprintHex(rootFingerprint)}`,
    rootFingerprint,
    requestIdentityFingerprint,
    taskFingerprint,
    request,
    revision: 0,
    state: 'admitted',
    replayPolicy: 'normal',
    interruptLatch: null,
    attempts: [],
    checkpoints: [],
    foregroundLease: null,
    acceptance: null,
    completionProofFingerprint: null,
    createdAt: admittedAt,
    updatedAt: admittedAt,
    terminalAt: null,
  });
  return Object.freeze({ ok: true, disposition: 'created', root });
}

function withUpdatedRoot(
  root: ComputerTaskRootV1,
  expectedRevision: number,
  at: string,
  changes: Partial<ComputerTaskRootV1>,
): ComputerTaskRootV1 {
  return deepFreeze({
    ...cloneRoot(root),
    ...changes,
    revision: expectedRevision + 1,
    updatedAt: at,
  });
}

function activeAttempt(root: ComputerTaskRootV1): ComputerTaskAttemptV1 | null {
  return root.attempts.find((attempt) => attempt.state === 'active') || null;
}

function revokeLease(
  lease: ComputerTaskForegroundLeaseV1 | null,
  at: string,
): ComputerTaskForegroundLeaseV1 | null {
  return lease?.status === 'active'
    ? { ...lease, status: 'revoked', releasedAt: at }
    : lease;
}

function cancelActiveAttempts(
  attempts: ReadonlyArray<ComputerTaskAttemptV1>,
  at: string,
): ComputerTaskAttemptV1[] {
  return attempts.map((attempt) => attempt.state === 'active'
    ? { ...attempt, state: 'cancelled', finishedAt: at }
    : { ...attempt });
}

function transitionHasOnlyKeys(
  transition: UnknownRecord,
  keys: ReadonlyArray<string>,
): boolean {
  return hasExactKeys(transition, new Set(keys));
}

function actionStateTransitionAllowed(
  current: ComputerTaskRootActionState,
  next: ComputerTaskRootActionState,
): boolean {
  return current === 'planned' && next === 'claimed'
    || current === 'claimed' && (next === 'dispatched' || next === 'failed')
    || current === 'dispatched' && (next === 'verified' || next === 'outcome_unknown')
    || current === 'outcome_unknown' && next === 'verified';
}

/**
 * Apply one fail-closed compare-and-set transition. A stale revision, terminal
 * root, STOP latch, or human foreground override cannot reactivate execution.
 */
export async function transitionComputerTaskRoot(
  root: ComputerTaskRootV1,
  expectedRevision: number,
  transition: ComputerTaskRootTransition,
): Promise<ComputerTaskRootTransitionResult> {
  const hydrated = await hydrateComputerTaskRoot(root);
  if (!hydrated.ok) return hydrated;
  const current = hydrated.root;
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || expectedRevision > MAX_REVISION) {
    return failure('invalid_input', 'Expected computer task revision is invalid.');
  }
  if (current.revision !== expectedRevision) {
    return failure('stale_revision', 'Computer task root revision changed before this transition.');
  }
  if (current.revision >= MAX_REVISION) {
    return failure('capacity_exceeded', 'Computer task root revision capacity is exhausted.');
  }
  if (
    !isRecord(transition)
    || typeof transition.type !== 'string'
    || !isSafeJsonTree(transition, new Set<object>(), { nodes: 0, chars: 0 })
  ) {
    return failure('invalid_input', 'Computer task transition is malformed.');
  }
  if (isTerminal(current.state)) {
    return failure('terminal_root', 'A terminal computer task root cannot be reactivated or changed.');
  }
  const at = normalizeInputTimestamp(transition.at);
  if (!at || Date.parse(at) < Date.parse(current.updatedAt)) {
    return failure('invalid_input', 'Computer task transition timestamp is invalid or moves backward.');
  }
  const applied = async (next: ComputerTaskRootV1): Promise<ComputerTaskRootTransitionResult> => {
    let serialized = '';
    try {
      serialized = canonicalJson(next);
    } catch {
      return failure('invalid_transition', 'The constructed computer task root was not serializable.');
    }
    if (serialized.length > COMPUTER_TASK_ROOT_MAX_SNAPSHOT_CHARS) {
      return failure('capacity_exceeded', 'Computer task root snapshot capacity is exhausted.');
    }
    const validated = await hydrateComputerTaskRoot(next);
    if (!validated.ok) {
      return failure('invalid_transition', 'The constructed computer task root failed its strict state invariants.');
    }
    return Object.freeze({
      ok: true,
      disposition: 'applied',
      previousRevision: expectedRevision,
      root: validated.root,
    });
  };

  if (transition.type === 'stop_requested') {
    if (!transitionHasOnlyKeys(transition, ['type', 'at'])) {
      return failure('invalid_input', 'STOP transition contains unsupported fields.');
    }
    const hasUnsealedAction = current.acceptance?.actions.some(
      (action) => action.state === 'claimed'
        || action.state === 'dispatched'
        || action.state === 'outcome_unknown',
    ) === true;
    if (hasUnsealedAction) {
      return failure(
        'invalid_transition',
        'STOP cannot terminalize the task while an accepted action is claimed, dispatched, or awaiting verification.',
      );
    }
    const next = withUpdatedRoot(current, expectedRevision, at, {
      state: 'cancelled',
      replayPolicy: 'terminal',
      interruptLatch: {
        kind: 'stop_requested',
        latchedAt: at,
        revision: expectedRevision + 1,
      },
      attempts: cancelActiveAttempts(current.attempts, at),
      foregroundLease: revokeLease(current.foregroundLease, at),
      completionProofFingerprint: null,
      terminalAt: at,
    });
    return applied(next);
  }

  if (transition.type === 'human_foreground_override') {
    if (!transitionHasOnlyKeys(transition, ['type', 'at'])) {
      return failure('invalid_input', 'Foreground override transition contains unsupported fields.');
    }
    if (current.interruptLatch) {
      return failure('interrupted_root', 'A computer task interrupt is already latched.');
    }
    if (current.acceptance?.actions.some((action) => action.state === 'claimed')) {
      return failure(
        'invalid_transition',
        'Foreground override cannot strand an atomically claimed action before it is durably settled.',
      );
    }
    const next = withUpdatedRoot(current, expectedRevision, at, {
      state: 'verification_only',
      replayPolicy: 'verification_only',
      interruptLatch: {
        kind: 'human_foreground_override',
        latchedAt: at,
        revision: expectedRevision + 1,
      },
      attempts: cancelActiveAttempts(current.attempts, at),
      foregroundLease: revokeLease(current.foregroundLease, at),
    });
    return applied(next);
  }

  const activeLease = current.foregroundLease?.status === 'active'
    ? current.foregroundLease
    : null;
  if (activeLease && Date.parse(activeLease.expiresAt) <= Date.parse(at)) {
    const explicitlyReleasesLease = transition.type === 'release_foreground_lease'
      && transition.leaseId === activeLease.leaseId;
    const settlesLeasedAction = transition.type === 'record_action_state'
      && transition.actionId === activeLease.actionId
      && (
        transition.nextState === 'verified'
        || transition.nextState === 'failed'
        || transition.nextState === 'outcome_unknown'
      );
    if (!explicitlyReleasesLease && !settlesLeasedAction) {
      return failure('invalid_transition', 'An expired foreground lease must be released or terminally settled before any other transition.');
    }
  }

  const verificationOnly = current.replayPolicy === 'verification_only';
  if (current.interruptLatch?.kind === 'stop_requested') {
    return failure('interrupted_root', 'STOP is latched; this computer task root cannot change.');
  }

  if (transition.type === 'append_checkpoint') {
    if (!transitionHasOnlyKeys(transition, ['type', 'checkpointId', 'attemptId', 'kind', 'evidenceFingerprint', 'at'])) {
      return failure('invalid_input', 'Checkpoint transition has missing or unsupported fields.');
    }
    if (current.checkpoints.length >= COMPUTER_TASK_ROOT_MAX_CHECKPOINTS) {
      return failure('capacity_exceeded', 'Computer task checkpoint capacity is exhausted.');
    }
    const checkpointId = parseOpaqueId(transition.checkpointId);
    const attemptId = transition.attemptId == null ? null : parseDerivedId(transition.attemptId, 'attempt');
    const kind = typeof transition.kind === 'string'
      && CHECKPOINT_KINDS.has(transition.kind as ComputerTaskCheckpointKind)
      ? transition.kind as ComputerTaskCheckpointKind
      : null;
    const evidenceFingerprint = transition.evidenceFingerprint == null
      ? null
      : parseFingerprint(transition.evidenceFingerprint);
    if (
      !checkpointId
      || current.checkpoints.some((checkpoint) => checkpoint.checkpointId === checkpointId)
      || transition.attemptId != null && (!attemptId || !current.attempts.some((attempt) => attempt.attemptId === attemptId))
      || !kind
      || transition.evidenceFingerprint != null && !evidenceFingerprint
    ) return failure('invalid_input', 'Checkpoint identity, attempt, kind, or evidence is invalid.');
    const checkpoints = [
      ...current.checkpoints,
      {
        checkpointId,
        sequence: current.checkpoints.length + 1,
        attemptId,
        kind,
        rootState: current.state,
        recordedAt: at,
        evidenceFingerprint,
      },
    ];
    return applied(withUpdatedRoot(current, expectedRevision, at, { checkpoints }));
  }

  if (verificationOnly) {
    if (
      transition.type !== 'record_action_state'
      && transition.type !== 'release_foreground_lease'
    ) {
      return failure('interrupted_root', 'Verification-only replay permits proof bookkeeping but no new activation.');
    }
  } else if (!canActivateComputerTaskRoot(current)) {
    return failure('interrupted_root', 'Computer task activation is not permitted by the replay policy.');
  }

  if (transition.type === 'begin_attempt') {
    if (!transitionHasOnlyKeys(transition, ['type', 'kind', 'parentAttemptId', 'at'])) {
      return failure('invalid_input', 'Attempt transition has missing or unsupported fields.');
    }
    if (current.attempts.length >= COMPUTER_TASK_ROOT_MAX_ATTEMPTS) {
      return failure('capacity_exceeded', 'Computer task attempt capacity is exhausted.');
    }
    if (activeAttempt(current)) return failure('invalid_transition', 'Only one attempt may be active for a root.');
    const kind = typeof transition.kind === 'string'
      && ATTEMPT_KINDS.has(transition.kind as ComputerTaskAttemptKind)
      ? transition.kind as ComputerTaskAttemptKind
      : null;
    const parentAttemptId = transition.parentAttemptId == null
      ? null
      : parseDerivedId(transition.parentAttemptId, 'attempt');
    if (
      !kind
      || transition.parentAttemptId != null
        && (!parentAttemptId || !current.attempts.some((attempt) => attempt.attemptId === parentAttemptId))
    ) return failure('invalid_input', 'Attempt kind or parent identity is invalid.');
    const index = current.attempts.length;
    const attemptId = await buildAttemptId({
      rootFingerprint: current.rootFingerprint,
      index,
      kind,
      parentAttemptId,
    });
    if (!attemptId) return failure('fingerprint_unavailable', 'Attempt identity could not be derived.');
    const attempts = [
      ...current.attempts,
      { attemptId, index, kind, parentAttemptId, state: 'active' as const, startedAt: at, finishedAt: null },
    ];
    return applied(withUpdatedRoot(current, expectedRevision, at, { attempts, state: 'running' }));
  }

  if (transition.type === 'finish_attempt') {
    if (!transitionHasOnlyKeys(transition, ['type', 'attemptId', 'outcome', 'at'])) {
      return failure('invalid_input', 'Attempt finish transition contains unsupported fields.');
    }
    const attemptId = parseDerivedId(transition.attemptId, 'attempt');
    const outcome = transition.outcome === 'completed'
      || transition.outcome === 'failed'
      || transition.outcome === 'cancelled'
      ? transition.outcome
      : null;
    const attempt = current.attempts.find((candidate) => candidate.attemptId === attemptId);
    if (!attemptId || !outcome || !attempt || attempt.state !== 'active') {
      return failure('invalid_transition', 'Only the active attempt may be finished once.');
    }
    if (current.foregroundLease?.status === 'active') {
      return failure('invalid_transition', 'Release the foreground lease before finishing an attempt.');
    }
    if (current.acceptance?.attemptId === attemptId) {
      return failure('invalid_transition', 'An attempt with bound acceptance must settle through action or task state.');
    }
    const attempts: ComputerTaskAttemptV1[] = current.attempts.map((candidate) => candidate.attemptId === attemptId
      ? { ...candidate, state: outcome, finishedAt: at }
      : { ...candidate });
    return applied(withUpdatedRoot(current, expectedRevision, at, { attempts, state: 'paused' }));
  }

  if (transition.type === 'bind_acceptance') {
    if (!transitionHasOnlyKeys(transition, ['type', 'attemptId', 'actions', 'predicateFingerprints', 'at'])) {
      return failure('invalid_input', 'Acceptance transition contains unsupported fields.');
    }
    if (current.acceptance) return failure('identity_conflict', 'Acceptance is immutable once bound.');
    const attemptId = parseDerivedId(transition.attemptId, 'attempt');
    const attempt = current.attempts.find((candidate) => candidate.attemptId === attemptId);
    if (!attemptId || !attempt || attempt.state !== 'active') {
      return failure('invalid_transition', 'Acceptance must bind to the active attempt.');
    }
    if (
      !Array.isArray(transition.actions)
      || transition.actions.length < 1
      || transition.actions.length > COMPUTER_TASK_ROOT_MAX_ACTIONS
      || !Array.isArray(transition.predicateFingerprints)
      || transition.predicateFingerprints.length < 1
      || transition.predicateFingerprints.length > COMPUTER_TASK_ROOT_MAX_PREDICATES
    ) return failure('capacity_exceeded', 'Acceptance action or predicate count is outside the V1 bound.');
    const predicateFingerprints: string[] = [];
    const predicateSet = new Set<string>();
    for (const candidate of transition.predicateFingerprints) {
      const fingerprint = parseFingerprint(candidate);
      if (!fingerprint || predicateSet.has(fingerprint)) {
        return failure('invalid_input', 'Acceptance predicate fingerprints must be unique SHA-256 values.');
      }
      predicateSet.add(fingerprint);
      predicateFingerprints.push(fingerprint);
    }
    const manifests: ActionManifest[] = [];
    for (let index = 0; index < transition.actions.length; index += 1) {
      const candidate = transition.actions[index];
      if (!isRecord(candidate) || !transitionHasOnlyKeys(candidate, [
        'tool',
        'toolArgsFingerprint',
        'authorizationFingerprint',
        'mutatesState',
        'requiresForegroundLease',
      ])) return failure('invalid_input', 'Acceptance action contains unsupported fields.');
      const tool = parseTool(candidate.tool);
      const toolArgsFingerprint = parseFingerprint(candidate.toolArgsFingerprint);
      const authorizationFingerprint = parseFingerprint(candidate.authorizationFingerprint);
      if (
        !tool
        || !toolArgsFingerprint
        || !authorizationFingerprint
        || typeof candidate.mutatesState !== 'boolean'
        || typeof candidate.requiresForegroundLease !== 'boolean'
        || candidate.requiresForegroundLease && !candidate.mutatesState
      ) return failure('invalid_input', 'Acceptance action identity or policy binding is invalid.');
      const actionId = await buildActionId({
        rootFingerprint: current.rootFingerprint,
        attemptId,
        index,
        tool,
        toolArgsFingerprint,
        authorizationFingerprint,
      });
      if (!actionId) return failure('fingerprint_unavailable', 'Child action identity could not be derived.');
      const idempotencyKey = await buildActionIdempotencyKey({
        rootFingerprint: current.rootFingerprint,
        actionId,
      });
      if (!idempotencyKey) {
        return failure('fingerprint_unavailable', 'Child action idempotency identity could not be derived.');
      }
      manifests.push({
        actionId,
        index,
        attemptId,
        tool,
        toolArgsFingerprint,
        authorizationFingerprint,
        idempotencyKey,
        mutatesState: candidate.mutatesState,
        requiresForegroundLease: candidate.requiresForegroundLease,
      });
    }
    const acceptanceFingerprint = await buildAcceptanceFingerprint({
      rootFingerprint: current.rootFingerprint,
      attemptId,
      predicateFingerprints,
      actions: manifests,
    });
    if (!acceptanceFingerprint) {
      return failure('fingerprint_unavailable', 'Acceptance identity could not be derived.');
    }
    const actions: ComputerTaskRootActionV1[] = [];
    for (const manifest of manifests) {
      const acceptanceBindingFingerprint = await buildActionAcceptanceBinding({
        rootFingerprint: current.rootFingerprint,
        acceptanceFingerprint,
        action: manifest,
      });
      if (!acceptanceBindingFingerprint) {
        return failure('fingerprint_unavailable', 'Action acceptance binding could not be derived.');
      }
      actions.push({
        ...manifest,
        acceptanceBindingFingerprint,
        dispatchBinding: null,
        state: 'planned',
        proofFingerprint: null,
        updatedAt: at,
      });
    }
    const acceptance: ComputerTaskRootAcceptanceV1 = {
      schemaVersion: 1,
      acceptanceFingerprint,
      attemptId,
      boundAt: at,
      predicateFingerprints,
      actions,
    };
    return applied(withUpdatedRoot(current, expectedRevision, at, { acceptance, state: 'running' }));
  }

  if (transition.type === 'bind_action_dispatch') {
    if (!transitionHasOnlyKeys(transition, [
      'type',
      'actionId',
      'source',
      'callIdentityFingerprint',
      'authorizationCategory',
      'mutationAuthority',
      'policyBindingFingerprint',
      'verifierBindingFingerprint',
      'replayBindingFingerprint',
      'at',
    ])) return failure('invalid_input', 'Action dispatch binding contains unsupported fields.');
    const actionId = parseDerivedId(transition.actionId, 'action');
    const source = typeof transition.source === 'string'
      && ACTION_DISPATCH_SOURCES.has(transition.source as ComputerTaskActionDispatchSource)
      ? transition.source as ComputerTaskActionDispatchSource
      : null;
    const callIdentityFingerprint = parseFingerprint(transition.callIdentityFingerprint);
    const authorizationCategory = typeof transition.authorizationCategory === 'string'
      && ACTION_AUTHORIZATION_CATEGORIES.has(
        transition.authorizationCategory as ComputerTaskActionAuthorizationCategory,
      )
      ? transition.authorizationCategory as ComputerTaskActionAuthorizationCategory
      : null;
    const mutationAuthority = typeof transition.mutationAuthority === 'string'
      && ACTION_MUTATION_AUTHORITIES.has(transition.mutationAuthority as ComputerTaskActionMutationAuthority)
      ? transition.mutationAuthority as ComputerTaskActionMutationAuthority
      : null;
    const policyBindingFingerprint = parseFingerprint(transition.policyBindingFingerprint);
    const verifierBindingFingerprint = parseFingerprint(transition.verifierBindingFingerprint);
    const replayBindingFingerprint = parseFingerprint(transition.replayBindingFingerprint);
    if (
      !actionId
      || !source
      || !callIdentityFingerprint
      || !authorizationCategory
      || !mutationAuthority
      || !policyBindingFingerprint
      || !verifierBindingFingerprint
      || !replayBindingFingerprint
    ) return failure('invalid_input', 'Action dispatch binding identity, category, or fingerprint is invalid.');
    const action = current.acceptance?.actions.find((candidate) => candidate.actionId === actionId);
    const attempt = activeAttempt(current);
    if (
      !action
      || action.state !== 'planned'
      || !attempt
      || action.attemptId !== attempt.attemptId
      || source !== attempt.kind
    ) return failure('invalid_transition', 'Only a planned action owned by the active attempt may bind dispatch.');
    if (action.dispatchBinding) {
      return failure('identity_conflict', 'Action dispatch binding is immutable once bound.');
    }
    if (
      !action.mutatesState
        && (authorizationCategory !== 'read_only' || mutationAuthority !== 'read_only')
      || action.mutatesState
        && (authorizationCategory === 'read_only' || mutationAuthority === 'read_only')
    ) return failure('invalid_transition', 'Action mutation behavior does not match its dispatch authority.');
    const dispatchBinding: ComputerTaskActionDispatchBindingV1 = {
      schemaVersion: 1,
      source,
      callIdentityFingerprint,
      authorizationCategory,
      mutationAuthority,
      policyBindingFingerprint,
      verifierBindingFingerprint,
      replayBindingFingerprint,
      boundAt: at,
    };
    const actions = current.acceptance!.actions.map((candidate) => candidate.actionId === actionId
      ? { ...candidate, dispatchBinding, updatedAt: at }
      : { ...candidate });
    const acceptance: ComputerTaskRootAcceptanceV1 = {
      ...current.acceptance!,
      predicateFingerprints: [...current.acceptance!.predicateFingerprints],
      actions,
    };
    return applied(withUpdatedRoot(current, expectedRevision, at, {
      acceptance,
      state: 'running',
    }));
  }

  if (transition.type === 'bind_foreground_lease') {
    if (!transitionHasOnlyKeys(transition, ['type', 'leaseId', 'actionId', 'targetFingerprint', 'expiresAt', 'at'])) {
      return failure('invalid_input', 'Foreground lease transition contains unsupported fields.');
    }
    const leaseId = parseOpaqueId(transition.leaseId);
    const actionId = parseDerivedId(transition.actionId, 'action');
    const targetFingerprint = parseFingerprint(transition.targetFingerprint);
    const expiresAt = normalizeInputTimestamp(transition.expiresAt);
    const action = current.acceptance?.actions.find((candidate) => candidate.actionId === actionId);
    const attempt = activeAttempt(current);
    if (
      !leaseId
      || !actionId
      || !targetFingerprint
      || !expiresAt
      || Date.parse(expiresAt) <= Date.parse(at)
      || Date.parse(expiresAt) - Date.parse(at) > MAX_LEASE_MS
      || !action
      || !attempt
      || action.attemptId !== attempt.attemptId
      || !action.requiresForegroundLease
      || action.state !== 'planned' && action.state !== 'claimed'
      || current.foregroundLease?.status === 'active'
      || current.acceptance!.actions.some((candidate) => (
        candidate.index < action.index && candidate.state !== 'verified'
        || candidate.actionId !== action.actionId
          && (candidate.state === 'claimed' || candidate.state === 'dispatched')
      ))
    ) return failure('invalid_transition', 'Foreground lease identity, lifetime, or action binding is invalid.');
    const foregroundLease: ComputerTaskForegroundLeaseV1 = {
      leaseId,
      actionId,
      targetFingerprint,
      acquiredAt: at,
      expiresAt,
      status: 'active',
      releasedAt: null,
    };
    return applied(withUpdatedRoot(current, expectedRevision, at, { foregroundLease, state: 'running' }));
  }

  if (transition.type === 'release_foreground_lease') {
    if (!transitionHasOnlyKeys(transition, ['type', 'leaseId', 'at'])) {
      return failure('invalid_input', 'Foreground lease release contains unsupported fields.');
    }
    const leaseId = parseOpaqueId(transition.leaseId);
    if (!leaseId || current.foregroundLease?.status !== 'active' || current.foregroundLease.leaseId !== leaseId) {
      return failure('invalid_transition', 'Only the matching active foreground lease may be released.');
    }
    const foregroundLease: ComputerTaskForegroundLeaseV1 = {
      ...current.foregroundLease,
      status: 'released',
      releasedAt: at,
    };
    return applied(withUpdatedRoot(current, expectedRevision, at, { foregroundLease }));
  }

  if (transition.type === 'set_waiting') {
    if (!transitionHasOnlyKeys(transition, ['type', 'state', 'at'])) {
      return failure('invalid_input', 'Waiting transition contains unsupported fields.');
    }
    if (
      transition.state !== 'waiting_approval'
      && transition.state !== 'waiting_input'
      && transition.state !== 'paused'
    ) return failure('invalid_input', 'Waiting state is invalid.');
    if (current.foregroundLease?.status === 'active') {
      return failure('invalid_transition', 'Release the foreground lease before waiting.');
    }
    if (transition.state === 'paused' && activeAttempt(current)) {
      return failure('invalid_transition', 'Finish the active attempt before pausing the root.');
    }
    return applied(withUpdatedRoot(current, expectedRevision, at, { state: transition.state }));
  }

  if (transition.type === 'record_action_state') {
    if (!transitionHasOnlyKeys(transition, ['type', 'actionId', 'nextState', 'proofFingerprint', 'at'])) {
      return failure('invalid_input', 'Action-state transition has missing or unsupported fields.');
    }
    const actionId = parseDerivedId(transition.actionId, 'action');
    const nextState = typeof transition.nextState === 'string'
      && ACTION_STATES.has(transition.nextState as ComputerTaskRootActionState)
      ? transition.nextState as ComputerTaskRootActionState
      : null;
    const proofFingerprint = transition.proofFingerprint == null
      ? null
      : parseFingerprint(transition.proofFingerprint);
    const action = current.acceptance?.actions.find((candidate) => candidate.actionId === actionId);
    if (
      !actionId
      || !nextState
      || !action
      || !actionStateTransitionAllowed(action.state, nextState)
      || nextState === 'verified' && !proofFingerprint
      || nextState !== 'verified' && nextState !== 'outcome_unknown' && proofFingerprint !== null
      || transition.proofFingerprint != null && !proofFingerprint
    ) return failure('invalid_transition', 'Action state, proof, or action identity is invalid.');
    if (nextState === 'claimed') {
      const binding = action.dispatchBinding;
      const attempt = activeAttempt(current);
      if (
        !binding
        || !attempt
        || action.attemptId !== attempt.attemptId
        || !actionDispatchBindingIsExecutable(binding, action.mutatesState)
      ) return failure('invalid_transition', 'Action dispatch binding does not authorize execution.');
    }
    if (nextState === 'dispatched') {
      const attempt = activeAttempt(current);
      if (!attempt || action.attemptId !== attempt.attemptId) {
        return failure('invalid_transition', 'Only the active owning attempt may dispatch an action.');
      }
    }
    if (
      verificationOnly
      && !(action.state === 'dispatched' && (nextState === 'verified' || nextState === 'outcome_unknown'))
      && !(action.state === 'outcome_unknown' && nextState === 'verified')
    ) {
      return failure('interrupted_root', 'Verification-only replay cannot claim or dispatch another action.');
    }
    if (
      nextState === 'claimed'
      && current.acceptance!.actions.some((candidate) => (
        candidate.index < action.index && candidate.state !== 'verified'
        || candidate.actionId !== action.actionId
          && (candidate.state === 'claimed' || candidate.state === 'dispatched')
      ))
    ) return failure('invalid_transition', 'Acceptance actions must be claimed one at a time in manifest order.');
    if (nextState === 'dispatched' && action.requiresForegroundLease) {
      const lease = current.foregroundLease;
      if (
        !lease
        || lease.status !== 'active'
        || lease.actionId !== action.actionId
        || Date.parse(lease.expiresAt) <= Date.parse(at)
      ) return failure('invalid_transition', 'Dispatch requires the matching unexpired foreground lease.');
    }
    const actions = current.acceptance!.actions.map((candidate) => candidate.actionId === actionId
      ? { ...candidate, state: nextState!, proofFingerprint, updatedAt: at }
      : { ...candidate });
    const acceptance: ComputerTaskRootAcceptanceV1 = {
      ...current.acceptance!,
      predicateFingerprints: [...current.acceptance!.predicateFingerprints],
      actions,
    };
    const actionBecameTerminal = nextState === 'verified'
      || nextState === 'failed'
      || nextState === 'outcome_unknown';
    const foregroundLease = actionBecameTerminal
      && current.foregroundLease?.status === 'active'
      && current.foregroundLease.actionId === actionId
      ? { ...current.foregroundLease, status: 'released' as const, releasedAt: at }
      : current.foregroundLease;
    const ambiguousActionRemains = actions.some((candidate) => (
      candidate.state === 'dispatched' || candidate.state === 'outcome_unknown'
    ));
    const mustRemainVerificationOnly = current.interruptLatch?.kind === 'human_foreground_override'
      || ambiguousActionRemains;
    return applied(withUpdatedRoot(current, expectedRevision, at, {
      acceptance,
      foregroundLease,
      state: mustRemainVerificationOnly ? 'verification_only' : 'running',
      replayPolicy: mustRemainVerificationOnly ? 'verification_only' : 'normal',
    }));
  }

  if (transition.type === 'complete') {
    if (!transitionHasOnlyKeys(transition, ['type', 'acceptanceFingerprint', 'proofFingerprint', 'at'])) {
      return failure('invalid_input', 'Completion transition contains unsupported fields.');
    }
    const acceptanceFingerprint = parseFingerprint(transition.acceptanceFingerprint);
    const proofFingerprint = parseFingerprint(transition.proofFingerprint);
    if (
      !acceptanceFingerprint
      || !proofFingerprint
      || !current.acceptance
      || current.acceptance.acceptanceFingerprint !== acceptanceFingerprint
      || current.acceptance.actions.some((action) => action.state !== 'verified')
      || current.foregroundLease?.status === 'active'
    ) return failure('invalid_transition', 'Completion requires the exact acceptance binding and verified ordered actions.');
    const attempts = current.attempts.map((attempt) => attempt.state === 'active'
      ? { ...attempt, state: 'completed' as const, finishedAt: at }
      : { ...attempt });
    return applied(withUpdatedRoot(current, expectedRevision, at, {
      state: 'completed',
      replayPolicy: 'terminal',
      attempts,
      completionProofFingerprint: proofFingerprint,
      terminalAt: at,
    }));
  }

  if (transition.type === 'fail') {
    if (!transitionHasOnlyKeys(transition, ['type', 'at'])) {
      return failure('invalid_input', 'Failure transition contains unsupported fields.');
    }
    if (
      current.foregroundLease?.status === 'active'
      || current.acceptance?.actions.some((action) => (
        action.state === 'dispatched' || action.state === 'outcome_unknown'
      ))
    ) return failure('invalid_transition', 'Ambiguous dispatched work must enter outcome_unknown before task failure.');
    return applied(withUpdatedRoot(current, expectedRevision, at, {
      state: 'failed',
      replayPolicy: 'terminal',
      attempts: cancelActiveAttempts(current.attempts, at),
      terminalAt: at,
    }));
  }

  return failure('invalid_transition', 'Computer task transition type is not supported by V1.');
}
