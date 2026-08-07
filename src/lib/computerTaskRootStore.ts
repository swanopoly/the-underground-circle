import {
  admitComputerTaskRoot,
  hydrateComputerTaskRoot,
  serializeComputerTaskRoot,
  transitionComputerTaskRoot,
  type AdmitComputerTaskRootInput,
  type ComputerTaskRootState,
  type ComputerTaskRootTransition,
  type ComputerTaskRootV1,
} from './computerTaskRoot';
import {
  parseAgentActionCallIdentity,
  parseAgentActionCallRpcResponse,
  sanitizeAgentActionCallMetadata,
  type AgentActionCallFinalState,
  type AgentActionCallIdentity,
  type AgentActionCallRecord,
} from './agentActionCalls';

/**
 * Authenticated persistence adapter for the universal computer-task root.
 *
 * Database rows and JSON returned by PostgREST are untrusted transport data.
 * Every snapshot is rehydrated by the pure coordinator, and every successful
 * transition must byte-match the exact canonical snapshot produced locally
 * before it is allowed back into the runtime.
 */

export interface ComputerTaskRootRpcClient {
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error?: unknown }>;
}

export type DurableComputerTaskRootRecord = Readonly<{
  schemaVersion: 1;
  rootRowId: string;
  runId: string;
  root: ComputerTaskRootV1;
}>;

export type ComputerTaskRootPointerV1 = Readonly<{
  schemaVersion: 1;
  rootRowId: string;
  runId: string;
  rootId: string;
  rootFingerprint: string;
  requestIdentityFingerprint: string;
  taskFingerprint: string;
}>;

export type ComputerTaskRootStoreErrorCode =
  | 'invalid_input'
  | 'not_authenticated'
  | 'scope_denied'
  | 'identity_conflict'
  | 'state_conflict'
  | 'invalid_transition'
  | 'not_found'
  | 'run_identity_mismatch'
  | 'claim_not_found'
  | 'claim_token_mismatch'
  | 'claim_expired'
  | 'proof_required'
  | 'proof_mismatch'
  | 'rpc_error'
  | 'malformed_response';

export type ComputerTaskRootStoreFailure = Readonly<{
  ok: false;
  code: ComputerTaskRootStoreErrorCode;
  message: string;
  retryable: false;
  current?: DurableComputerTaskRootRecord;
}>;

export type ComputerTaskRootAdmissionSuccess = Readonly<{
  ok: true;
  disposition: 'created' | 'duplicate';
  record: DurableComputerTaskRootRecord;
}>;

export type ComputerTaskRootTransitionSuccess = Readonly<{
  ok: true;
  disposition: 'transitioned';
  record: DurableComputerTaskRootRecord;
}>;

export type ComputerTaskRootAdmissionStoreResult =
  | ComputerTaskRootAdmissionSuccess
  | ComputerTaskRootStoreFailure;

export type ComputerTaskRootTransitionStoreResult =
  | ComputerTaskRootTransitionSuccess
  | ComputerTaskRootStoreFailure;

export interface ComputerTaskRootStore {
  admit: (
    input: Omit<AdmitComputerTaskRootInput, 'existing'>,
  ) => Promise<ComputerTaskRootAdmissionStoreResult>;
  read: (
    pointer: ComputerTaskRootPointerV1,
  ) => Promise<ComputerTaskRootAdmissionStoreResult>;
  transition: (input: Readonly<{
    record: DurableComputerTaskRootRecord;
    expectedRevision: number;
    transition: ComputerTaskRootTransition;
  }>) => Promise<ComputerTaskRootTransitionStoreResult>;
}

export type ComputerTaskRuntimeRootBinding = Readonly<{
  schemaVersion: 1;
  durability: 'memory' | 'database';
  root: ComputerTaskRootV1;
  durableRecord: DurableComputerTaskRootRecord | null;
}>;

export type ComputerTaskRuntimeRootAdmissionResult =
  | Readonly<{
      ok: true;
      disposition: 'created' | 'duplicate';
      binding: ComputerTaskRuntimeRootBinding;
    }>
  | ComputerTaskRootStoreFailure;

export type ComputerTaskRuntimeRootAdmissionOptions = Readonly<{
  /** Explicit in tests and staged rollout. Production defaults to the Expo flag. */
  requireDurable?: boolean;
  client?: ComputerTaskRootRpcClient;
}>;

export type ComputerTaskRuntimeRootTransitionResult =
  | Readonly<{
      ok: true;
      disposition: 'transitioned';
      binding: ComputerTaskRuntimeRootBinding;
    }>
  | ComputerTaskRootStoreFailure;

export type ComputerTaskRuntimeRootTransitionOptions = Readonly<{
  /** Injected only for database bindings. Memory bindings never touch it. */
  client?: ComputerTaskRootRpcClient;
}>;

export type ComputerTaskRootActionTerminalTransition =
  | Readonly<{ type: 'complete'; proofFingerprint: string }>
  | Readonly<{ type: 'fail' }>;

export type ComputerTaskRootActionHandlerAuthority = Readonly<{
  schemaVersion: 1;
  kind: 'computer_task_root_action_handler';
  rootRowId: string;
  runId: string;
  rootId: string;
  rootFingerprint: string;
  rootRevision: number;
  actionId: string;
  actionCallId: string;
  actionCallStateVersion: number;
  claimToken: string;
  tool: string;
  toolArgsFingerprint: string;
  authorizationFingerprint: string;
  acceptanceFingerprint: string;
  acceptanceBindingFingerprint: string;
  idempotencyKey: string;
  dispatchCallIdentityFingerprint: string;
  dispatchPolicyBindingFingerprint: string;
  dispatchVerifierBindingFingerprint: string;
  dispatchReplayBindingFingerprint: string;
  foregroundLeaseId: string | null;
  targetFingerprint: string | null;
}>;

export type ComputerTaskRootActionHandlerExpectation = Readonly<{
  /** Must be the exact database binding returned beside this authority by `start`. */
  binding: ComputerTaskRuntimeRootBinding;
  actionId: string;
  tool: string;
  toolArgsFingerprint: string;
  /** Exact active foreground target, or null only when the action has no active lease. */
  targetFingerprint: string | null;
}>;

export type ComputerTaskRootActionClaimResult =
  | Readonly<{
      ok: true;
      disposition: 'claimed' | 'recovered';
      binding: ComputerTaskRuntimeRootBinding;
      identity: AgentActionCallIdentity;
      actionCall: AgentActionCallRecord;
      claimToken: string;
    }>
  | ComputerTaskRootStoreFailure;

export type ComputerTaskRootActionStartResult =
  | Readonly<{
      ok: true;
      disposition: 'started';
      binding: ComputerTaskRuntimeRootBinding;
      identity: AgentActionCallIdentity;
      actionCall: AgentActionCallRecord;
      handlerAuthority: ComputerTaskRootActionHandlerAuthority;
    }>
  | ComputerTaskRootStoreFailure;

export type ComputerTaskRootActionSettleDisposition =
  | 'settled'
  | 'reconciled'
  | 'completed'
  | 'failed';

export type ComputerTaskRootActionSettleResult =
  | Readonly<{
      ok: true;
      disposition: ComputerTaskRootActionSettleDisposition;
      binding: ComputerTaskRuntimeRootBinding;
      identity: AgentActionCallIdentity;
      actionCall: AgentActionCallRecord;
    }>
  | ComputerTaskRootStoreFailure;

export interface ComputerTaskRootActionGateway {
  claim: (input: Readonly<{
    binding: ComputerTaskRuntimeRootBinding;
    actionId: string;
    at: string;
    metadata?: unknown;
    ttlSeconds?: number;
  }>) => Promise<ComputerTaskRootActionClaimResult>;
  start: (input: Readonly<{
    binding: ComputerTaskRuntimeRootBinding;
    actionId: string;
    claimToken: string;
    at: string;
  }>) => Promise<ComputerTaskRootActionStartResult>;
  settle: (input: Readonly<{
    binding: ComputerTaskRuntimeRootBinding;
    actionId: string;
    claimToken: string;
    finalState: AgentActionCallFinalState;
    proofFingerprint?: string | null;
    terminalTransition?: ComputerTaskRootActionTerminalTransition | null;
    at: string;
    metadata?: unknown;
  }>) => Promise<ComputerTaskRootActionSettleResult>;
  reconcileOutcomeUnknown: (input: Readonly<{
    binding: ComputerTaskRuntimeRootBinding;
    actionId: string;
    proofFingerprint: string;
    terminalTransition?: Extract<ComputerTaskRootActionTerminalTransition, { type: 'complete' }> | null;
    at: string;
    metadata?: unknown;
  }>) => Promise<ComputerTaskRootActionSettleResult>;
}

type UnknownRecord = Record<string, unknown>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
const DATABASE_ERROR_CODES = new Set<ComputerTaskRootStoreErrorCode>([
  'invalid_input',
  'not_authenticated',
  'scope_denied',
  'identity_conflict',
  'state_conflict',
  'invalid_transition',
  'not_found',
  'run_identity_mismatch',
  'claim_not_found',
  'claim_token_mismatch',
  'claim_expired',
  'proof_required',
  'proof_mismatch',
  'rpc_error',
]);
const SUCCESS_KEYS = new Set([
  'schemaVersion',
  'ok',
  'disposition',
  'rootRowId',
  'runId',
  'revision',
  'state',
  'rootSnapshot',
]);
const FAILURE_KEYS = new Set([
  'schemaVersion',
  'ok',
  'code',
  'message',
  'currentRevision',
  'rootRowId',
  'runId',
  'rootSnapshot',
]);
const ACTION_GATEWAY_SUCCESS_KEYS = new Set([
  'schemaVersion',
  'ok',
  'disposition',
  'rootRowId',
  'runId',
  'revision',
  'state',
  'rootSnapshot',
  'actionCall',
]);
const VOLATILE_ROOT_LIMIT = 256;
const volatileRoots = new Map<string, ComputerTaskRootV1>();
const issuedDurableRecords = new WeakSet<object>();
const issuedRuntimeBindings = new WeakSet<object>();
const issuedHandlerAuthorities = new WeakMap<object, Readonly<{
  binding: ComputerTaskRuntimeRootBinding;
  actionCallId: string;
  actionCallStateVersion: number;
  claimToken: string;
}>>();

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyKeys(value: UnknownRecord, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function parseUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value) ? value.toLowerCase() : null;
}

function boundedMessage(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 240);
  return normalized || fallback;
}

function fail(
  code: ComputerTaskRootStoreErrorCode,
  message: string,
  current?: DurableComputerTaskRootRecord,
): ComputerTaskRootStoreFailure {
  return Object.freeze({
    ok: false,
    code,
    message: boundedMessage(message, 'Computer-task root storage failed closed.'),
    retryable: false,
    ...(current ? { current } : {}),
  });
}

function rpcFailure(): ComputerTaskRootStoreFailure {
  return fail(
    'rpc_error',
    'The authenticated computer-task root service was unavailable. Nothing was dispatched.',
  );
}

function sameDurableIdentity(
  root: ComputerTaskRootV1,
  expected: ComputerTaskRootV1,
): boolean {
  return root.rootId === expected.rootId
    && root.rootFingerprint === expected.rootFingerprint
    && root.requestIdentityFingerprint === expected.requestIdentityFingerprint
    && root.taskFingerprint === expected.taskFingerprint
    && root.request.userId === expected.request.userId
    && root.request.circleId === expected.request.circleId
    && root.request.threadId === expected.request.threadId
    && root.request.source === expected.request.source
    && root.request.requestIdentity === expected.request.requestIdentity;
}

function issueRuntimeBinding(input: {
  durability: 'memory' | 'database';
  root: ComputerTaskRootV1;
  durableRecord: DurableComputerTaskRootRecord | null;
}): ComputerTaskRuntimeRootBinding {
  const binding = Object.freeze({
    schemaVersion: 1 as const,
    durability: input.durability,
    root: input.root,
    durableRecord: input.durableRecord,
  });
  issuedRuntimeBindings.add(binding);
  return binding;
}

function transitionFailureCode(
  code: string,
): ComputerTaskRootStoreErrorCode {
  if (code === 'stale_revision') return 'state_conflict';
  if (
    code === 'terminal_root'
    || code === 'interrupted_root'
    || code === 'invalid_transition'
  ) return 'invalid_transition';
  if (code === 'identity_conflict') return 'identity_conflict';
  return 'invalid_input';
}

async function makeRecord(input: {
  rootRowId: unknown;
  runId: unknown;
  snapshot: unknown;
  expectedIdentity: ComputerTaskRootV1;
}): Promise<DurableComputerTaskRootRecord | null> {
  const rootRowId = parseUuid(input.rootRowId);
  const runId = parseUuid(input.runId);
  if (!rootRowId || !runId) return null;
  const hydrated = await hydrateComputerTaskRoot(input.snapshot);
  if (!hydrated.ok || !sameDurableIdentity(hydrated.root, input.expectedIdentity)) return null;
  const record = Object.freeze({
    schemaVersion: 1,
    rootRowId,
    runId,
    root: hydrated.root,
  });
  issuedDurableRecords.add(record);
  return record;
}

async function parseConflictCurrent(
  value: UnknownRecord,
  prior: DurableComputerTaskRootRecord,
): Promise<DurableComputerTaskRootRecord | undefined> {
  if (
    !('rootSnapshot' in value)
    || value.rootRowId !== undefined && parseUuid(value.rootRowId) !== prior.rootRowId
    || value.runId !== undefined && parseUuid(value.runId) !== prior.runId
  ) return undefined;
  const hydrated = await hydrateComputerTaskRoot(value.rootSnapshot);
  if (!hydrated.ok || !sameDurableIdentity(hydrated.root, prior.root)) return undefined;
  if (
    typeof value.currentRevision === 'number'
    && value.currentRevision !== hydrated.root.revision
  ) return undefined;
  const current = Object.freeze({ ...prior, root: hydrated.root });
  issuedDurableRecords.add(current);
  return current;
}

export function sanitizeComputerTaskRootPointer(
  value: unknown,
): ComputerTaskRootPointerV1 | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const pointerKeys = [
    'schemaVersion',
    'rootRowId',
    'runId',
    'rootId',
    'rootFingerprint',
    'requestIdentityFingerprint',
    'taskFingerprint',
    ] as const;
    const keys = new Set<string>(pointerKeys);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const ownKeys = Reflect.ownKeys(descriptors);
    if (
      ownKeys.length !== keys.size
      || ownKeys.some((key) => typeof key !== 'string' || !keys.has(key))
    ) {
      return null;
    }
    for (const key of pointerKeys) {
      const descriptor = descriptors[key];
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor) || descriptor.get || descriptor.set) {
        return null;
      }
    }
    const record = Object.fromEntries(pointerKeys.map((key) => (
      [key, descriptors[key].value]
    ))) as Record<(typeof pointerKeys)[number], unknown>;
    if (record.schemaVersion !== 1) return null;
    const rootRowId = parseUuid(record.rootRowId);
    const runId = parseUuid(record.runId);
    const fingerprint = /^args-v2:sha256:[0-9a-f]{64}$/;
    if (
      !rootRowId
      || !runId
      || typeof record.rootId !== 'string'
      || !/^computer_task_[0-9a-f]{64}$/.test(record.rootId)
      || typeof record.rootFingerprint !== 'string'
      || !fingerprint.test(record.rootFingerprint)
      || typeof record.requestIdentityFingerprint !== 'string'
      || !fingerprint.test(record.requestIdentityFingerprint)
      || typeof record.taskFingerprint !== 'string'
      || !fingerprint.test(record.taskFingerprint)
    ) return null;
    return Object.freeze({
      schemaVersion: 1,
      rootRowId,
      runId,
      rootId: record.rootId,
      rootFingerprint: record.rootFingerprint,
      requestIdentityFingerprint: record.requestIdentityFingerprint,
      taskFingerprint: record.taskFingerprint,
    });
  } catch {
    return null;
  }
}

function rootMatchesPointer(root: ComputerTaskRootV1, pointer: ComputerTaskRootPointerV1): boolean {
  return root.rootId === pointer.rootId
    && root.rootFingerprint === pointer.rootFingerprint
    && root.requestIdentityFingerprint === pointer.requestIdentityFingerprint
    && root.taskFingerprint === pointer.taskFingerprint;
}

export function toComputerTaskRootPointer(
  record: DurableComputerTaskRootRecord,
): ComputerTaskRootPointerV1 | null {
  if (!issuedDurableRecords.has(record as object)) return null;
  return Object.freeze({
    schemaVersion: 1,
    rootRowId: record.rootRowId,
    runId: record.runId,
    rootId: record.root.rootId,
    rootFingerprint: record.root.rootFingerprint,
    requestIdentityFingerprint: record.root.requestIdentityFingerprint,
    taskFingerprint: record.root.taskFingerprint,
  });
}

async function parseRpcFailure(
  data: UnknownRecord,
  prior?: DurableComputerTaskRootRecord,
): Promise<ComputerTaskRootStoreFailure> {
  if (
    data.schemaVersion !== 1
    || data.ok !== false
    || !hasOnlyKeys(data, FAILURE_KEYS)
    || typeof data.code !== 'string'
    || !DATABASE_ERROR_CODES.has(data.code as ComputerTaskRootStoreErrorCode)
  ) return fail('malformed_response', 'The computer-task root service returned an invalid failure envelope.');
  const code = data.code as ComputerTaskRootStoreErrorCode;
  const current = prior && code === 'state_conflict'
    ? await parseConflictCurrent(data, prior)
    : undefined;
  return fail(
    code,
    boundedMessage(data.message, 'The computer-task root transition was rejected.'),
    current,
  );
}

async function invokeRpc(
  client: ComputerTaskRootRpcClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown | ComputerTaskRootStoreFailure> {
  try {
    const response = await client.rpc(functionName, args);
    if (!response || response.error) return rpcFailure();
    return response.data;
  } catch {
    return rpcFailure();
  }
}

async function invokeRootActionRpc(
  client: ComputerTaskRootRpcClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<unknown | ComputerTaskRootStoreFailure> {
  try {
    const response = await client.rpc(functionName, args);
    if (response && !response.error) return response.data;
  } catch {
    // The request may have committed before transport failed. Fall through to
    // an explicitly ambiguous, non-retryable result.
  }
  return fail(
    'rpc_error',
    'The atomic root/action response was unavailable; durable state may have changed. Refresh the exact root and action before any retry.',
  );
}

export function createComputerTaskRootStore(
  client: ComputerTaskRootRpcClient,
): ComputerTaskRootStore {
  return {
    async admit(input) {
      const admitted = await admitComputerTaskRoot(input);
      if (!admitted.ok) return fail('invalid_input', admitted.message);
      const serialized = await serializeComputerTaskRoot(admitted.root);
      if (!serialized.ok) return fail('invalid_input', serialized.message);
      const data = await invokeRpc(client, 'admit_computer_task_root_v1', {
        p_circle_id: admitted.root.request.circleId,
        p_thread_id: admitted.root.request.threadId,
        p_request_identity_fingerprint: admitted.root.requestIdentityFingerprint,
        p_task_fingerprint: admitted.root.taskFingerprint,
        p_root_fingerprint: admitted.root.rootFingerprint,
        p_root_snapshot: JSON.parse(serialized.serialized),
      });
      if (isStoreFailure(data)) return data;
      if (!isRecord(data)) {
        return fail('malformed_response', 'The computer-task admission service returned no exact envelope.');
      }
      if (data.ok === false) return parseRpcFailure(data);
      if (
        data.schemaVersion !== 1
        || data.ok !== true
        || !hasOnlyKeys(data, SUCCESS_KEYS)
        || data.disposition !== 'created' && data.disposition !== 'duplicate'
        || !Number.isSafeInteger(data.revision)
        || typeof data.state !== 'string'
        || !ROOT_STATES.has(data.state as ComputerTaskRootState)
      ) return fail('malformed_response', 'The computer-task admission envelope was malformed.');
      const record = await makeRecord({
        rootRowId: data.rootRowId,
        runId: data.runId,
        snapshot: data.rootSnapshot,
        expectedIdentity: admitted.root,
      });
      if (
        !record
        || record.root.revision !== data.revision
        || record.root.state !== data.state
      ) return fail('malformed_response', 'The admitted root did not match its authenticated response envelope.');
      const duplicateProof = await admitComputerTaskRoot({
        ...input,
        existing: record.root,
      });
      if (!duplicateProof.ok || duplicateProof.disposition !== 'duplicate') {
        return fail('malformed_response', 'The admitted root could not be reauthenticated against the request.');
      }
      if (data.disposition === 'created' && record.root.revision !== 0) {
        return fail('malformed_response', 'A newly created computer-task root must begin at revision zero.');
      }
      return Object.freeze({
        ok: true,
        disposition: data.disposition,
        record,
      });
    },

    async read(rawPointer) {
      const pointer = sanitizeComputerTaskRootPointer(rawPointer);
      if (!pointer) return fail('invalid_input', 'A valid bounded computer-task root pointer is required.');
      const data = await invokeRpc(client, 'read_computer_task_root_v1', {
        p_root_row_id: pointer.rootRowId,
      });
      if (isStoreFailure(data)) return data;
      if (!isRecord(data)) {
        return fail('malformed_response', 'The computer-task root read returned no exact envelope.');
      }
      if (data.ok === false) return parseRpcFailure(data);
      if (
        data.schemaVersion !== 1
        || data.ok !== true
        || !hasOnlyKeys(data, SUCCESS_KEYS)
        || data.disposition !== 'read'
        || data.rootRowId !== pointer.rootRowId
        || data.runId !== pointer.runId
        || !Number.isSafeInteger(data.revision)
        || typeof data.state !== 'string'
        || !ROOT_STATES.has(data.state as ComputerTaskRootState)
      ) return fail('malformed_response', 'The computer-task root read envelope was malformed.');
      const hydrated = await hydrateComputerTaskRoot(data.rootSnapshot);
      if (
        !hydrated.ok
        || !rootMatchesPointer(hydrated.root, pointer)
        || hydrated.root.revision !== data.revision
        || hydrated.root.state !== data.state
      ) return fail('malformed_response', 'The computer-task root read did not match its durable pointer.');
      const record = await makeRecord({
        rootRowId: data.rootRowId,
        runId: data.runId,
        snapshot: hydrated.root,
        expectedIdentity: hydrated.root,
      });
      if (!record) return fail('malformed_response', 'The computer-task root read could not be reauthenticated.');
      return Object.freeze({ ok: true, disposition: 'duplicate', record });
    },

    async transition(input) {
      if (
        !isRecord(input)
        || !isRecord(input.record)
        || input.record.schemaVersion !== 1
        || !issuedDurableRecords.has(input.record as object)
        || parseUuid(input.record.rootRowId) !== input.record.rootRowId.toLowerCase()
        || parseUuid(input.record.runId) !== input.record.runId.toLowerCase()
      ) return fail('invalid_input', 'A validated durable computer-task root record is required.');
      const prior = await hydrateComputerTaskRoot(input.record.root);
      if (!prior.ok || !sameDurableIdentity(prior.root, input.record.root)) {
        return fail('invalid_input', 'The durable computer-task root record failed rehydration.');
      }
      const transitioned = await transitionComputerTaskRoot(
        prior.root,
        input.expectedRevision,
        input.transition,
      );
      if (!transitioned.ok) {
        return fail(transitionFailureCode(transitioned.code), transitioned.message);
      }
      const serialized = await serializeComputerTaskRoot(transitioned.root);
      if (!serialized.ok) return fail('invalid_input', serialized.message);
      const data = await invokeRpc(client, 'transition_computer_task_root_v1', {
        p_root_row_id: input.record.rootRowId,
        p_expected_revision: input.expectedRevision,
        p_transition_type: input.transition.type,
        p_root_snapshot: JSON.parse(serialized.serialized),
      });
      if (isStoreFailure(data)) return data;
      if (!isRecord(data)) {
        return fail('malformed_response', 'The computer-task transition service returned no exact envelope.');
      }
      if (data.ok === false) return parseRpcFailure(data, input.record);
      if (
        data.schemaVersion !== 1
        || data.ok !== true
        || !hasOnlyKeys(data, SUCCESS_KEYS)
        || data.disposition !== 'transitioned'
        || data.rootRowId !== input.record.rootRowId
        || data.runId !== input.record.runId
        || data.revision !== transitioned.root.revision
        || data.state !== transitioned.root.state
      ) return fail('malformed_response', 'The computer-task transition envelope was malformed.');
      const record = await makeRecord({
        rootRowId: data.rootRowId,
        runId: data.runId,
        snapshot: data.rootSnapshot,
        expectedIdentity: prior.root,
      });
      if (!record) {
        return fail('malformed_response', 'The transitioned root did not match its durable identity.');
      }
      const returned = await serializeComputerTaskRoot(record.root);
      if (!returned.ok || returned.serialized !== serialized.serialized) {
        return fail('malformed_response', 'The durable root transition drifted from the locally authorized state.');
      }
      return Object.freeze({ ok: true, disposition: 'transitioned', record });
    },
  };
}

function isStoreFailure(value: unknown): value is ComputerTaskRootStoreFailure {
  return isRecord(value)
    && value.ok === false
    && typeof value.code === 'string'
    && (value.code === 'rpc_error' || value.code === 'malformed_response')
    && value.retryable === false;
}

function isRootStoreFailure(value: unknown): value is ComputerTaskRootStoreFailure {
  return isRecord(value) && value.ok === false && typeof value.code === 'string';
}

async function loadDefaultRpcClient(): Promise<ComputerTaskRootRpcClient> {
  const mod = await import('./supabase');
  return mod.supabase as unknown as ComputerTaskRootRpcClient;
}

export async function createDefaultComputerTaskRootStore(): Promise<ComputerTaskRootStore> {
  return createComputerTaskRootStore(await loadDefaultRpcClient());
}

export function isDurableComputerTaskRootRolloutEnabled(): boolean {
  return process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1 === 'true';
}

function rememberVolatileRoot(root: ComputerTaskRootV1): void {
  volatileRoots.delete(root.requestIdentityFingerprint);
  volatileRoots.set(root.requestIdentityFingerprint, root);
  while (volatileRoots.size > VOLATILE_ROOT_LIMIT) {
    const oldest = volatileRoots.keys().next().value;
    if (typeof oldest !== 'string') break;
    volatileRoots.delete(oldest);
  }
}

/**
 * Admit the root before planning. The memory coordinator is the safe rollout
 * baseline; setting EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_V1=true upgrades
 * admission to authenticated database CAS and fails closed if that authority
 * is unavailable. There is no silent database-to-memory downgrade.
 */
export async function admitComputerTaskRuntimeRoot(
  input: Omit<AdmitComputerTaskRootInput, 'existing'>,
  options?: ComputerTaskRuntimeRootAdmissionOptions,
): Promise<ComputerTaskRuntimeRootAdmissionResult> {
  const draft = await admitComputerTaskRoot(input);
  if (!draft.ok) return fail('invalid_input', draft.message);
  const requireDurable = options?.requireDurable
    ?? isDurableComputerTaskRootRolloutEnabled();
  if (requireDurable) {
    try {
      const store = options?.client
        ? createComputerTaskRootStore(options.client)
        : await createDefaultComputerTaskRootStore();
      const persisted = await store.admit(input);
      if (!persisted.ok) return persisted;
      return Object.freeze({
        ok: true,
        disposition: persisted.disposition,
        binding: issueRuntimeBinding({
          durability: 'database',
          root: persisted.record.root,
          durableRecord: persisted.record,
        }),
      });
    } catch {
      return rpcFailure();
    }
  }
  const existing = volatileRoots.get(draft.root.requestIdentityFingerprint);
  const admitted = existing
    ? await admitComputerTaskRoot({ ...input, existing })
    : draft;
  if (!admitted.ok) return fail('identity_conflict', admitted.message);
  rememberVolatileRoot(admitted.root);
  return Object.freeze({
    ok: true,
    disposition: admitted.disposition,
    binding: issueRuntimeBinding({
      durability: 'memory',
      root: admitted.root,
      durableRecord: null,
    }),
  });
}

/** Reauthenticate a runtime binding against the exact current Chat request. */
export async function validateComputerTaskRuntimeRootBinding(
  binding: ComputerTaskRuntimeRootBinding,
  input: Omit<AdmitComputerTaskRootInput, 'existing'>,
): Promise<ComputerTaskRuntimeRootAdmissionResult> {
  if (
    !binding
    || typeof binding !== 'object'
    || !issuedRuntimeBindings.has(binding as object)
    || binding.schemaVersion !== 1
  ) {
    return fail('invalid_input', 'The computer-task root binding was missing or malformed.');
  }
  if (binding.durability !== 'memory' && binding.durability !== 'database') {
    return fail('invalid_input', 'The computer-task root durability mode was invalid.');
  }
  const admitted = await admitComputerTaskRoot({ ...input, existing: binding.root });
  if (!admitted.ok) return fail('identity_conflict', admitted.message);
  if (binding.durability === 'database') {
    if (
      !binding.durableRecord
      || !issuedDurableRecords.has(binding.durableRecord as object)
      || binding.root !== binding.durableRecord.root
      || !sameDurableIdentity(binding.durableRecord.root, admitted.root)
    ) return fail('identity_conflict', 'The durable computer-task root binding drifted before execution.');
    return Object.freeze({
      ok: true,
      disposition: 'duplicate',
      binding: issueRuntimeBinding({
        durability: 'database',
        root: binding.durableRecord.root,
        durableRecord: binding.durableRecord,
      }),
    });
  }
  if (binding.durableRecord !== null) {
    return fail('identity_conflict', 'A memory computer-task root cannot carry durable authority.');
  }
  const canonical = volatileRoots.get(admitted.root.requestIdentityFingerprint);
  if (!canonical) {
    return fail('not_found', 'The canonical memory computer-task root is no longer available.');
  }
  const reconciled = await admitComputerTaskRoot({ ...input, existing: canonical });
  if (
    !reconciled.ok
    || !sameDurableIdentity(reconciled.root, admitted.root)
  ) return fail('identity_conflict', 'The canonical memory computer-task root drifted before execution.');
  return Object.freeze({
    ok: true,
    disposition: 'duplicate',
    binding: issueRuntimeBinding({
      durability: 'memory',
      root: reconciled.root,
      durableRecord: null,
    }),
  });
}

/**
 * Reauthenticate one issued runtime binding, then transition only the
 * canonical owner. Memory mode uses an in-process optimistic CAS; database
 * mode delegates the same transition through the authenticated store CAS.
 */
export async function transitionComputerTaskRuntimeRoot(
  binding: ComputerTaskRuntimeRootBinding,
  input: Omit<AdmitComputerTaskRootInput, 'existing'>,
  transition: ComputerTaskRootTransition,
  options?: ComputerTaskRuntimeRootTransitionOptions,
): Promise<ComputerTaskRuntimeRootTransitionResult> {
  const validated = await validateComputerTaskRuntimeRootBinding(binding, input);
  if (!validated.ok) return validated;
  if (validated.binding.durability === 'database') {
    const record = validated.binding.durableRecord;
    if (!record || !issuedDurableRecords.has(record as object)) {
      return fail('identity_conflict', 'Durable computer-task transition authority was missing.');
    }
    try {
      const store = options?.client
        ? createComputerTaskRootStore(options.client)
        : await createDefaultComputerTaskRootStore();
      const transitioned = await store.transition({
        record,
        expectedRevision: record.root.revision,
        transition,
      });
      if (!transitioned.ok) return transitioned;
      return Object.freeze({
        ok: true,
        disposition: 'transitioned',
        binding: issueRuntimeBinding({
          durability: 'database',
          root: transitioned.record.root,
          durableRecord: transitioned.record,
        }),
      });
    } catch {
      return rpcFailure();
    }
  }

  const fingerprint = validated.binding.root.requestIdentityFingerprint;
  const canonical = volatileRoots.get(fingerprint);
  if (!canonical) {
    return fail('not_found', 'The canonical memory computer-task root is no longer available.');
  }
  const reauthenticated = await admitComputerTaskRoot({ ...input, existing: canonical });
  if (
    !reauthenticated.ok
    || !sameDurableIdentity(reauthenticated.root, validated.binding.root)
  ) return fail('identity_conflict', 'The canonical memory computer-task root drifted before transition.');
  const expectedRevision = canonical.revision;
  const transitioned = await transitionComputerTaskRoot(
    canonical,
    expectedRevision,
    transition,
  );
  if (!transitioned.ok) {
    return fail(transitionFailureCode(transitioned.code), transitioned.message);
  }
  const currentOwner = volatileRoots.get(fingerprint);
  if (currentOwner !== canonical || currentOwner.revision !== expectedRevision) {
    return fail('state_conflict', 'The canonical memory computer-task root changed before commit.');
  }
  rememberVolatileRoot(transitioned.root);
  return Object.freeze({
    ok: true,
    disposition: 'transitioned',
    binding: issueRuntimeBinding({
      durability: 'memory',
      root: transitioned.root,
      durableRecord: null,
    }),
  });
}

type PreparedRootAction = Readonly<{
  record: DurableComputerTaskRootRecord;
  actionId: string;
  identity: AgentActionCallIdentity;
}>;

type PreparedRootSnapshot = Readonly<{
  root: ComputerTaskRootV1;
  serialized: string;
  snapshot: unknown;
}>;

type ParsedRootActionGatewaySuccess = Readonly<{
  disposition: ComputerTaskRootActionSettleDisposition | 'claimed' | 'started';
  binding: ComputerTaskRuntimeRootBinding;
  actionCall: AgentActionCallRecord;
}>;

type ComputerTaskRootActionSettleInternalInput = Omit<
  Parameters<ComputerTaskRootActionGateway['settle']>[0],
  'claimToken'
> & Readonly<{ claimToken: string | null }>;

function prepareDatabaseRootAction(
  binding: ComputerTaskRuntimeRootBinding,
  actionId: string,
): PreparedRootAction | ComputerTaskRootStoreFailure {
  if (
    !binding
    || typeof binding !== 'object'
    || !issuedRuntimeBindings.has(binding as object)
    || binding.schemaVersion !== 1
    || binding.durability !== 'database'
    || !binding.durableRecord
    || !issuedDurableRecords.has(binding.durableRecord as object)
    || binding.root !== binding.durableRecord.root
    || parseUuid(binding.durableRecord.rootRowId) !== binding.durableRecord.rootRowId
    || parseUuid(binding.durableRecord.runId) !== binding.durableRecord.runId
  ) {
    return fail(
      'invalid_input',
      'Atomic root/action execution requires the exact issued database binding; memory bindings and clones have no authority.',
    );
  }
  const action = binding.root.acceptance?.actions.find((candidate) => candidate.actionId === actionId);
  if (
    !action
    || !action.dispatchBinding
    || !action.mutatesState
    || action.dispatchBinding.mutationAuthority !== 'action_ledger'
  ) {
    return fail(
      'invalid_transition',
      'The bound root action is missing exact durable action-ledger mutation authority.',
    );
  }
  const identity = parseAgentActionCallIdentity({
    schemaVersion: 1,
    userId: binding.root.request.userId,
    circleId: binding.root.request.circleId,
    runId: binding.durableRecord.runId,
    tool: action.tool,
    toolUseId: action.actionId,
    actionId: action.actionId,
    toolArgsFingerprint: action.toolArgsFingerprint,
    contractFingerprint: action.acceptanceBindingFingerprint,
    idempotencyKey: action.idempotencyKey,
  });
  if (!identity.ok) {
    return fail('identity_conflict', 'The bound root action could not derive an exact durable action-call identity.');
  }
  return Object.freeze({
    record: binding.durableRecord,
    actionId: action.actionId,
    identity: identity.value,
  });
}

async function prepareRootSnapshot(
  prior: DurableComputerTaskRootRecord,
  transition: ComputerTaskRootTransition,
): Promise<PreparedRootSnapshot | ComputerTaskRootStoreFailure> {
  const transitioned = await transitionComputerTaskRoot(
    prior.root,
    prior.root.revision,
    transition,
  );
  if (!transitioned.ok) {
    return fail(transitionFailureCode(transitioned.code), transitioned.message);
  }
  const serialized = await serializeComputerTaskRoot(transitioned.root);
  if (!serialized.ok) return fail('invalid_input', serialized.message);
  return Object.freeze({
    root: transitioned.root,
    serialized: serialized.serialized,
    snapshot: JSON.parse(serialized.serialized),
  });
}

async function prepareCurrentRootSnapshot(
  current: DurableComputerTaskRootRecord,
): Promise<PreparedRootSnapshot | ComputerTaskRootStoreFailure> {
  const serialized = await serializeComputerTaskRoot(current.root);
  if (!serialized.ok) return fail('invalid_input', serialized.message);
  return Object.freeze({
    root: current.root,
    serialized: serialized.serialized,
    snapshot: JSON.parse(serialized.serialized),
  });
}

async function parseRootActionGatewaySuccess(input: Readonly<{
  data: unknown;
  prior: DurableComputerTaskRootRecord;
  expectedRoot: PreparedRootSnapshot;
  expectedIdentity: AgentActionCallIdentity;
  operation: 'claim' | 'start' | 'finish';
  allowedOuterDispositions: ReadonlySet<string>;
  expectedActionState: AgentActionCallFinalState | 'claimed' | 'dispatched';
}>): Promise<ParsedRootActionGatewaySuccess | ComputerTaskRootStoreFailure> {
  if (isStoreFailure(input.data)) return input.data;
  if (!isRecord(input.data)) {
    return fail('malformed_response', 'The atomic root/action service returned no exact envelope.');
  }
  if (input.data.ok === false) return parseRpcFailure(input.data, input.prior);
  if (
    input.data.schemaVersion !== 1
    || input.data.ok !== true
    || !hasOnlyKeys(input.data, ACTION_GATEWAY_SUCCESS_KEYS)
    || typeof input.data.disposition !== 'string'
    || input.data.rootRowId !== input.prior.rootRowId
    || input.data.runId !== input.prior.runId
  ) {
    return fail('malformed_response', 'The atomic root/action response envelope was malformed or miscorrelated.');
  }
  const actionCall = parseAgentActionCallRpcResponse(
    input.data.actionCall,
    input.expectedIdentity,
    input.operation,
  );
  if (!actionCall.ok) {
    return fail(
      actionCall.code as ComputerTaskRootStoreErrorCode,
      actionCall.message,
    );
  }
  const nestedDispositionAccepted = input.operation === 'claim'
    ? actionCall.disposition === 'claimed'
      || actionCall.disposition === 'already_claimed'
      || actionCall.disposition === 'duplicate'
    : input.operation === 'start'
      ? actionCall.disposition === 'started' || actionCall.disposition === 'duplicate'
      : actionCall.disposition === 'finished' || actionCall.disposition === 'already_finished';
  if (!nestedDispositionAccepted) {
    return fail('malformed_response', 'The nested durable action-call did not prove the requested atomic transition.');
  }
  const record = await makeRecord({
    rootRowId: input.data.rootRowId,
    runId: input.data.runId,
    snapshot: input.data.rootSnapshot,
    expectedIdentity: input.prior.root,
  });
  if (!record) {
    return fail('malformed_response', 'The atomic root/action snapshot did not match its durable root identity.');
  }
  const returned = await serializeComputerTaskRoot(record.root);
  const outerDisposition = input.data.disposition;
  const dispositionsCorrelate = (
    outerDisposition === 'claimed' && actionCall.disposition === 'claimed'
    || outerDisposition === 'already_claimed' && actionCall.disposition === 'already_claimed'
    || outerDisposition === 'started' && actionCall.disposition === 'started'
    || outerDisposition === 'already_finished' && actionCall.disposition === 'already_finished'
    || outerDisposition === 'duplicate' && actionCall.disposition === 'duplicate'
    || (
      outerDisposition === 'settled'
        || outerDisposition === 'completed'
        || outerDisposition === 'failed'
        || outerDisposition === 'reconciled'
    ) && actionCall.disposition === 'finished'
  );
  if (!dispositionsCorrelate) {
    return fail('malformed_response', 'The root and nested action dispositions did not exactly correlate.');
  }
  const authorizesRequestedTransition = input.allowedOuterDispositions.has(outerDisposition)
    && actionCall.disposition !== 'duplicate'
    && actionCall.disposition !== 'already_finished';
  const current = await prepareCurrentRootSnapshot(input.prior);
  if (isRootStoreFailure(current)) return current;
  const acceptedRootSnapshots = authorizesRequestedTransition
    ? new Set([input.expectedRoot.serialized])
    : new Set([current.serialized, input.expectedRoot.serialized]);
  if (
    !returned.ok
    || !acceptedRootSnapshots.has(returned.serialized)
    || input.data.revision !== record.root.revision
    || input.data.state !== record.root.state
  ) {
    return fail('malformed_response', 'The atomic root/action snapshot drifted from the locally authorized or current durable state.');
  }
  if (!authorizesRequestedTransition) {
    return fail(
      'state_conflict',
      'The atomic root/action service returned a non-authorizing prior disposition; refresh exact durable state before retry.',
      record,
    );
  }
  if (actionCall.call.state !== input.expectedActionState) {
    return fail('malformed_response', 'The nested durable action-call did not enter the exact requested state.');
  }
  return Object.freeze({
    disposition: outerDisposition as ParsedRootActionGatewaySuccess['disposition'],
    binding: issueRuntimeBinding({
      durability: 'database',
      root: record.root,
      durableRecord: record,
    }),
    actionCall: Object.freeze({ ...actionCall.call }),
  });
}

function issueHandlerAuthority(input: Readonly<{
  binding: ComputerTaskRuntimeRootBinding;
  actionId: string;
  actionCall: AgentActionCallRecord;
  claimToken: string;
}>): ComputerTaskRootActionHandlerAuthority | ComputerTaskRootStoreFailure {
  const record = input.binding.durableRecord;
  const acceptance = input.binding.root.acceptance;
  const action = acceptance?.actions.find((candidate) => candidate.actionId === input.actionId);
  const dispatch = action?.dispatchBinding;
  const lease = input.binding.root.foregroundLease?.status === 'active'
    && input.binding.root.foregroundLease.actionId === input.actionId
    ? input.binding.root.foregroundLease
    : null;
  if (
    input.binding.durability !== 'database'
    || !issuedRuntimeBindings.has(input.binding as object)
    || !record
    || !issuedDurableRecords.has(record as object)
    || input.binding.root !== record.root
    || !acceptance
    || !action
    || !dispatch
    || action.state !== 'dispatched'
    || action.requiresForegroundLease && !lease
    || input.actionCall.state !== 'dispatched'
    || input.actionCall.id !== parseUuid(input.actionCall.id)
    || input.actionCall.runId !== record.runId
    || input.actionCall.tool !== action.tool
    || input.actionCall.toolUseId !== action.actionId
    || input.actionCall.actionId !== action.actionId
    || input.actionCall.toolArgsFingerprint !== action.toolArgsFingerprint
    || input.actionCall.contractFingerprint !== action.acceptanceBindingFingerprint
    || input.actionCall.idempotencyKey !== action.idempotencyKey
    || parseUuid(input.claimToken) !== input.claimToken
    || input.actionCall.claimToken !== undefined
      && input.actionCall.claimToken !== input.claimToken
  ) {
    return fail(
      'malformed_response',
      'The exact started root, action-call, dispatch, or foreground binding could not issue handler authority.',
    );
  }
  const authority = Object.freeze({
    schemaVersion: 1 as const,
    kind: 'computer_task_root_action_handler' as const,
    rootRowId: record.rootRowId,
    runId: record.runId,
    rootId: record.root.rootId,
    rootFingerprint: record.root.rootFingerprint,
    rootRevision: record.root.revision,
    actionId: input.actionId,
    actionCallId: input.actionCall.id,
    actionCallStateVersion: input.actionCall.stateVersion,
    claimToken: input.claimToken,
    tool: action.tool,
    toolArgsFingerprint: action.toolArgsFingerprint,
    authorizationFingerprint: action.authorizationFingerprint,
    acceptanceFingerprint: acceptance.acceptanceFingerprint,
    acceptanceBindingFingerprint: action.acceptanceBindingFingerprint,
    idempotencyKey: action.idempotencyKey,
    dispatchCallIdentityFingerprint: dispatch.callIdentityFingerprint,
    dispatchPolicyBindingFingerprint: dispatch.policyBindingFingerprint,
    dispatchVerifierBindingFingerprint: dispatch.verifierBindingFingerprint,
    dispatchReplayBindingFingerprint: dispatch.replayBindingFingerprint,
    foregroundLeaseId: lease?.leaseId ?? null,
    targetFingerprint: lease?.targetFingerprint ?? null,
  });
  issuedHandlerAuthorities.set(authority, Object.freeze({
    binding: input.binding,
    actionCallId: input.actionCall.id,
    actionCallStateVersion: input.actionCall.stateVersion,
    claimToken: input.claimToken,
  }));
  return authority;
}

/**
 * Consume the one-shot authority emitted only by an exact `started` response.
 *
 * Object provenance alone is insufficient: the caller must present the exact
 * database binding returned with the authority and independently expected
 * action/tool/arguments/foreground target. A mismatch does not burn the valid
 * authority, allowing the intended handler to fail closed and report it.
 */
export function consumeComputerTaskRootActionHandlerAuthority(
  authority: ComputerTaskRootActionHandlerAuthority,
  expectation: ComputerTaskRootActionHandlerExpectation,
): boolean {
  if (!authority || typeof authority !== 'object' || !expectation || typeof expectation !== 'object') {
    return false;
  }
  const issued = issuedHandlerAuthorities.get(authority as object);
  if (!issued || expectation.binding !== issued.binding) return false;
  const binding = expectation.binding;
  const record = binding.durableRecord;
  const acceptance = binding.root.acceptance;
  const action = acceptance?.actions.find((candidate) => candidate.actionId === expectation.actionId);
  const dispatch = action?.dispatchBinding;
  const lease = binding.root.foregroundLease?.status === 'active'
    && binding.root.foregroundLease.actionId === expectation.actionId
    ? binding.root.foregroundLease
    : null;
  if (
    binding.durability !== 'database'
    || !issuedRuntimeBindings.has(binding as object)
    || !record
    || !issuedDurableRecords.has(record as object)
    || binding.root !== record.root
    || !acceptance
    || !action
    || !dispatch
    || action.state !== 'dispatched'
    || action.requiresForegroundLease && !lease
    || expectation.actionId !== authority.actionId
    || expectation.tool !== authority.tool
    || expectation.toolArgsFingerprint !== authority.toolArgsFingerprint
    || expectation.targetFingerprint !== authority.targetFingerprint
    || record.rootRowId !== authority.rootRowId
    || record.runId !== authority.runId
    || record.root.rootId !== authority.rootId
    || record.root.rootFingerprint !== authority.rootFingerprint
    || record.root.revision !== authority.rootRevision
    || action.actionId !== authority.actionId
    || action.tool !== authority.tool
    || action.toolArgsFingerprint !== authority.toolArgsFingerprint
    || action.authorizationFingerprint !== authority.authorizationFingerprint
    || acceptance.acceptanceFingerprint !== authority.acceptanceFingerprint
    || action.acceptanceBindingFingerprint !== authority.acceptanceBindingFingerprint
    || action.idempotencyKey !== authority.idempotencyKey
    || dispatch.callIdentityFingerprint !== authority.dispatchCallIdentityFingerprint
    || dispatch.policyBindingFingerprint !== authority.dispatchPolicyBindingFingerprint
    || dispatch.verifierBindingFingerprint !== authority.dispatchVerifierBindingFingerprint
    || dispatch.replayBindingFingerprint !== authority.dispatchReplayBindingFingerprint
    || (lease?.leaseId ?? null) !== authority.foregroundLeaseId
    || (lease?.targetFingerprint ?? null) !== authority.targetFingerprint
    || authority.actionCallId !== issued.actionCallId
    || authority.actionCallStateVersion !== issued.actionCallStateVersion
    || authority.claimToken !== issued.claimToken
    || parseUuid(authority.actionCallId) !== authority.actionCallId
    || !Number.isSafeInteger(authority.actionCallStateVersion)
    || authority.actionCallStateVersion < 1
    || parseUuid(authority.claimToken) !== authority.claimToken
  ) return false;
  issuedHandlerAuthorities.delete(authority as object);
  return true;
}

/** Feature-off rollout flag; no runtime caller is wired while this remains false. */
export function isComputerTaskRootActionGatewayRolloutEnabled(): boolean {
  return isDurableComputerTaskRootRolloutEnabled()
    && process.env.EXPO_PUBLIC_UNIVERSAL_COMPUTER_TASK_ROOT_ACTION_GATEWAY_V1 === 'true';
}

export function createComputerTaskRootActionGateway(
  client: ComputerTaskRootRpcClient,
): ComputerTaskRootActionGateway {
  const settle = async (
    input: ComputerTaskRootActionSettleInternalInput,
    reconcileOutcomeUnknown: boolean,
  ): Promise<ComputerTaskRootActionSettleResult> => {
    const prepared = prepareDatabaseRootAction(input?.binding, input?.actionId);
    if (isRootStoreFailure(prepared)) return prepared;
    const claimToken = reconcileOutcomeUnknown ? null : parseUuid(input.claimToken);
    if (!reconcileOutcomeUnknown && !claimToken) {
      return fail('invalid_input', 'A valid durable action-call claim token is required.');
    }
    if (!['verified', 'failed', 'outcome_unknown'].includes(input.finalState)) {
      return fail('invalid_input', 'Final state must be verified, failed, or outcome_unknown.');
    }
    const currentAction = prepared.record.root.acceptance?.actions.find(
      (candidate) => candidate.actionId === prepared.actionId,
    );
    if (
      reconcileOutcomeUnknown
      && (input.finalState !== 'verified'
        || currentAction?.state !== 'outcome_unknown'
        || prepared.record.root.replayPolicy !== 'verification_only')
    ) {
      return fail('invalid_transition', 'Reconciliation is limited to outcome_unknown becoming verified.');
    }
    const actionSnapshot = await prepareRootSnapshot(prepared.record, {
      type: 'record_action_state',
      actionId: prepared.actionId,
      nextState: input.finalState,
      proofFingerprint: input.proofFingerprint ?? null,
      at: input.at,
    });
    if (isRootStoreFailure(actionSnapshot)) return actionSnapshot;
    let terminalSnapshot: PreparedRootSnapshot | null = null;
    if (input.terminalTransition) {
      if (
        input.terminalTransition.type === 'complete' && input.finalState !== 'verified'
        || input.terminalTransition.type === 'fail' && input.finalState !== 'failed'
      ) {
        return fail('invalid_transition', 'Task completion requires verified action state; task failure requires failed action state.');
      }
      const terminal = input.terminalTransition.type === 'complete'
        ? {
            type: 'complete' as const,
            acceptanceFingerprint: actionSnapshot.root.acceptance?.acceptanceFingerprint,
            proofFingerprint: input.terminalTransition.proofFingerprint,
            at: input.at,
          }
        : { type: 'fail' as const, at: input.at };
      const preparedTerminal = await prepareRootSnapshot(
        Object.freeze({ ...prepared.record, root: actionSnapshot.root }),
        terminal,
      );
      if (isRootStoreFailure(preparedTerminal)) return preparedTerminal;
      terminalSnapshot = preparedTerminal;
    }
    const expectedRoot = terminalSnapshot ?? actionSnapshot;
    const data = await invokeRootActionRpc(client, 'settle_computer_task_root_action_v1', {
      p_root_row_id: prepared.record.rootRowId,
      p_expected_revision: prepared.record.root.revision,
      p_action_id: prepared.actionId,
      p_claim_token: claimToken,
      p_final_state: input.finalState,
      p_proof_fingerprint: input.proofFingerprint ?? null,
      p_root_snapshot: actionSnapshot.snapshot,
      p_terminal_transition: input.terminalTransition?.type ?? null,
      p_terminal_root_snapshot: terminalSnapshot?.snapshot ?? null,
      p_metadata: sanitizeAgentActionCallMetadata(input.metadata),
    });
    const parsed = await parseRootActionGatewaySuccess({
      data,
      prior: prepared.record,
      expectedRoot,
      expectedIdentity: prepared.identity,
      operation: 'finish',
      allowedOuterDispositions: reconcileOutcomeUnknown
        ? new Set(['reconciled', 'completed'])
        : input.terminalTransition?.type === 'complete'
          ? new Set(['completed'])
          : input.terminalTransition?.type === 'fail'
            ? new Set(['failed'])
            : new Set(['settled']),
      expectedActionState: input.finalState,
    });
    if (isRootStoreFailure(parsed)) return parsed;
    return Object.freeze({
      ok: true,
      disposition: parsed.disposition as ComputerTaskRootActionSettleDisposition,
      binding: parsed.binding,
      identity: prepared.identity,
      actionCall: parsed.actionCall,
    });
  };

  const gateway: ComputerTaskRootActionGateway = {
    async claim(input) {
      const prepared = prepareDatabaseRootAction(input?.binding, input?.actionId);
      if (isRootStoreFailure(prepared)) return prepared;
      const action = prepared.record.root.acceptance?.actions.find(
        (candidate) => candidate.actionId === prepared.actionId,
      );
      const recovering = action?.state === 'claimed';
      if (action?.state !== 'planned' && !recovering) {
        return fail(
          'invalid_transition',
          'Only a planned action may claim, or an exact refreshed claimed action may recover its pre-dispatch lease.',
        );
      }
      if (recovering) {
        const owner = prepared.record.root.attempts.find(
          (attempt) => attempt.attemptId === action.attemptId,
        );
        if (
          prepared.record.root.state !== 'running'
          || prepared.record.root.replayPolicy !== 'normal'
          || prepared.record.root.interruptLatch !== null
          || owner?.state !== 'active'
        ) {
          return fail(
            'invalid_transition',
            'A claimed action lease can be recovered only while its exact root and owning attempt remain executable.',
          );
        }
      }
      const next = recovering
        ? await prepareCurrentRootSnapshot(prepared.record)
        : await prepareRootSnapshot(prepared.record, {
            type: 'record_action_state',
            actionId: prepared.actionId,
            nextState: 'claimed',
            proofFingerprint: null,
            at: input.at,
          });
      if (isRootStoreFailure(next)) return next;
      const requestedTtl = Number(input.ttlSeconds ?? 120);
      const ttlSeconds = Number.isFinite(requestedTtl)
        ? Math.max(15, Math.min(900, Math.floor(requestedTtl)))
        : 120;
      const data = await invokeRootActionRpc(client, 'claim_computer_task_root_action_v1', {
        p_root_row_id: prepared.record.rootRowId,
        p_expected_revision: prepared.record.root.revision,
        p_action_id: prepared.actionId,
        p_root_snapshot: next.snapshot,
        p_metadata: sanitizeAgentActionCallMetadata(input.metadata),
        p_ttl_seconds: ttlSeconds,
      });
      const parsed = await parseRootActionGatewaySuccess({
        data,
        prior: prepared.record,
        expectedRoot: next,
        expectedIdentity: prepared.identity,
        operation: 'claim',
        allowedOuterDispositions: recovering
          ? new Set(['claimed', 'already_claimed'])
          : new Set(['claimed']),
        expectedActionState: 'claimed',
      });
      if (isRootStoreFailure(parsed)) return parsed;
      const claimToken = parsed.actionCall.claimToken;
      if (!claimToken) return fail('malformed_response', 'Atomic claim did not return its exact claim token.');
      return Object.freeze({
        ok: true,
        disposition: recovering ? 'recovered' : 'claimed',
        binding: parsed.binding,
        identity: prepared.identity,
        actionCall: parsed.actionCall,
        claimToken,
      });
    },

    async start(input) {
      const prepared = prepareDatabaseRootAction(input?.binding, input?.actionId);
      if (isRootStoreFailure(prepared)) return prepared;
      const claimToken = parseUuid(input.claimToken);
      if (!claimToken) return fail('invalid_input', 'A valid durable action-call claim token is required.');
      const next = await prepareRootSnapshot(prepared.record, {
        type: 'record_action_state',
        actionId: prepared.actionId,
        nextState: 'dispatched',
        proofFingerprint: null,
        at: input.at,
      });
      if (isRootStoreFailure(next)) return next;
      const data = await invokeRootActionRpc(client, 'start_computer_task_root_action_v1', {
        p_root_row_id: prepared.record.rootRowId,
        p_expected_revision: prepared.record.root.revision,
        p_action_id: prepared.actionId,
        p_claim_token: claimToken,
        p_root_snapshot: next.snapshot,
      });
      const parsed = await parseRootActionGatewaySuccess({
        data,
        prior: prepared.record,
        expectedRoot: next,
        expectedIdentity: prepared.identity,
        operation: 'start',
        allowedOuterDispositions: new Set(['started']),
        expectedActionState: 'dispatched',
      });
      if (isRootStoreFailure(parsed)) return parsed;
      const handlerAuthority = issueHandlerAuthority({
        binding: parsed.binding,
        actionId: prepared.actionId,
        actionCall: parsed.actionCall,
        claimToken,
      });
      if (isRootStoreFailure(handlerAuthority)) return handlerAuthority;
      return Object.freeze({
        ok: true,
        disposition: 'started',
        binding: parsed.binding,
        identity: prepared.identity,
        actionCall: parsed.actionCall,
        handlerAuthority,
      });
    },

    settle(input) {
      return settle(input, false);
    },

    reconcileOutcomeUnknown(input) {
      return settle({
        ...input,
        claimToken: null,
        finalState: 'verified',
      }, true);
    },
  };
  return Object.freeze(gateway);
}
