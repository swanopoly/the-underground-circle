import {
  APPROVAL_EFFECTS,
  classifyAlwaysExactApprovalEffect,
  type ApprovalEffect,
  type AlwaysExactApprovalEffect,
} from './approvalEffectPolicyCore.ts';
import {
  isIssuedChatPlanApprovalAuthorityObject,
  type ChatPlanApprovalAuthorityCore,
} from './chatPlanApprovalAuthorityCore.ts';

type ChatPlanApprovalAuthority = ChatPlanApprovalAuthorityCore<string, string>;

export type OpenSwanRuntimeApprovalStatus =
  | 'pending'
  | 'approved'
  | 'auto_approved'
  | 'rejected'
  | 'expired'
  | string;

export type OpenSwanRuntimeApprovalRow = {
  id?: string | null;
  run_id?: string | null;
  circle_id?: string | null;
  requested_by?: string | null;
  requested_at?: string | null;
  resolved_at?: string | null;
  timeout_seconds?: number | null;
  status?: OpenSwanRuntimeApprovalStatus | null;
  payload?: Record<string, unknown> | null;
};

export type OpenSwanRuntimeApprovalReceiptStatus = 'approved' | 'auto_approved';
export type OpenSwanRuntimeApprovalReceiptSource =
  | 'run_scoped'
  | 'cross_run'
  | 'category_auto'
  | 'workflow_review';

export type OpenSwanRuntimeApprovalCallIdentity = {
  userId: string;
  circleId: string;
  runId: string;
  toolName: string;
  toolUseId: string;
  iteration: number;
};

/**
 * Runtime-only proof that one durable approval authority was atomically
 * consumed for one authenticated provider tool call. `approvalKey` is the
 * ephemeral canonical tool+args value used by the guarded mutation adapters;
 * it is never persisted or exposed in tool output. `approvalDigest` and
 * `authorityBindingDigest` are SHA-256 bindings safe for durable metadata.
 */
export type OpenSwanRuntimeApprovalReceipt = {
  schemaVersion: 2;
  approvalId: string;
  approvalKey: string;
  approvalDigest: string;
  authorityBindingDigest: string;
  status: OpenSwanRuntimeApprovalReceiptStatus;
  source: OpenSwanRuntimeApprovalReceiptSource;
  consumedAt: string;
  userId: string;
  circleId: string;
  /** Persisted run that owns the durable approval row. */
  approvalRunId: string;
  /** Current persisted run dispatching the provider tool call. */
  runId: string;
  toolName: string;
  toolUseId: string;
  iteration: number;
};

export type OpenSwanRuntimeApprovalAuthority = {
  approvalId: string;
  approvalDigest: string;
  status: OpenSwanRuntimeApprovalReceiptStatus;
  row: OpenSwanRuntimeApprovalRow;
};

export type OpenSwanRuntimeApprovalDecision =
  | {
      kind: 'pass';
      approvalId: string;
      authority: OpenSwanRuntimeApprovalAuthority;
      message: string;
    }
  | { kind: 'defer'; approvalId: string; message: string }
  | { kind: 'block'; approvalId: string; message: string }
  | { kind: 'new' };

/**
 * Runtime-private authority narrowing for one user-approved Chat continuation.
 *
 * This value is deliberately structural and value-free: it may identify the
 * exact durable approval rows and their SHA-256 tool bindings, but it must
 * never carry canonical approval keys, raw tool arguments, commands, paths,
 * credentials, or other mutation values. It is transient turn context, not
 * persisted approval metadata and not model-visible prompt content.
 */
export type OpenSwanApprovalResumeItemV1 = Readonly<{
  approvalId: string;
  toolName: string;
  toolApprovalDigest: string;
}>;

export type OpenSwanApprovalResumeBindingV1 = Readonly<{
  schemaVersion: 1;
  sourceRunId: string;
  userId: string;
  circleId: string;
  threadId: string;
  approvals: readonly OpenSwanApprovalResumeItemV1[];
}>;

export type BuildOpenSwanApprovalResumeBindingV1Input = Readonly<{
  sourceRunId: string;
  userId: string;
  circleId: string;
  threadId: string;
  approvals: readonly Readonly<{
    approvalId: string;
    toolName: string;
    toolApprovalDigest: string;
  }>[];
}>;

export type FindOpenSwanApprovalResumeItemInput = Readonly<{
  /** Omit only when tool + digest identify exactly one item in the binding. */
  approvalId?: string | null;
  sourceRunId: string;
  toolName: string;
  digest: string;
  userId: string;
  circleId: string;
  threadId: string;
}>;

export type ProjectOpenSwanApprovalResumeItemV1Scope = Readonly<{
  /** Optional caller-held id; when present it must equal the row id exactly. */
  approvalId?: string | null;
  sourceRunId: string;
  userId: string;
  circleId: string;
}>;

export const OPEN_SWAN_APPROVAL_RESUME_MAX_ITEMS = 8;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const APPROVAL_DIGEST_RE = /^approval-v2:sha256:[0-9a-f]{64}$/;
const AUTHORITY_DIGEST_RE = /^authority-v2:sha256:[0-9a-f]{64}$/;

const APPROVAL_RESUME_BINDING_KEYS = new Set([
  'schemaVersion',
  'sourceRunId',
  'userId',
  'circleId',
  'threadId',
  'approvals',
]);
const APPROVAL_RESUME_ITEM_KEYS = new Set([
  'approvalId',
  'toolName',
  'toolApprovalDigest',
]);

/** Read an exact data-only record without invoking accessor properties. */
function readExactApprovalResumeRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return null;
    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== allowedKeys.size
      || keys.some((key) => typeof key !== 'string' || !allowedKeys.has(key))
    ) return null;
    const out: Record<string, unknown> = {};
    for (const key of allowedKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      out[key] = descriptor.value;
    }
    return out;
  } catch {
    return null;
  }
}

function readExactApprovalResumeItems(value: unknown): unknown[] | null {
  try {
    if (!Array.isArray(value)) return null;
    if (value.length < 1 || value.length > OPEN_SWAN_APPROVAL_RESUME_MAX_ITEMS) return null;
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => {
      if (key === 'length') return false;
      if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key)) return true;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= value.length;
    })) return null;
    const out: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return null;
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      out.push(descriptor.value);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Strictly project an unknown value into the only accepted resume-binding
 * schema. Extra/accessor/symbol fields, sparse arrays, duplicate approval ids,
 * non-canonical identities, and raw-argument lookalikes are rejected. The
 * returned clone is deeply frozen so later callers cannot widen its scope.
 */
export function normalizeOpenSwanApprovalResumeBindingV1(
  value: unknown,
): OpenSwanApprovalResumeBindingV1 | null {
  const record = readExactApprovalResumeRecord(value, APPROVAL_RESUME_BINDING_KEYS);
  if (!record || record.schemaVersion !== 1) return null;
  const sourceRunId = typeof record.sourceRunId === 'string' ? record.sourceRunId : '';
  const userId = typeof record.userId === 'string' ? record.userId : '';
  const circleId = typeof record.circleId === 'string' ? record.circleId : '';
  const threadId = typeof record.threadId === 'string' ? record.threadId : '';
  if (
    !UUID_RE.test(sourceRunId)
    || !UUID_RE.test(userId)
    || !UUID_RE.test(circleId)
    || !UUID_RE.test(threadId)
  ) return null;

  const rawItems = readExactApprovalResumeItems(record.approvals);
  if (!rawItems) return null;
  const seenApprovalIds = new Set<string>();
  const approvals: OpenSwanApprovalResumeItemV1[] = [];
  for (const rawItem of rawItems) {
    const item = readExactApprovalResumeRecord(rawItem, APPROVAL_RESUME_ITEM_KEYS);
    if (!item) return null;
    const approvalId = typeof item.approvalId === 'string' ? item.approvalId : '';
    const toolName = typeof item.toolName === 'string' ? item.toolName : '';
    const toolApprovalDigest = typeof item.toolApprovalDigest === 'string'
      ? item.toolApprovalDigest
      : '';
    if (
      !UUID_RE.test(approvalId)
      || seenApprovalIds.has(approvalId)
      || !CALL_ID_RE.test(toolName)
      || !APPROVAL_DIGEST_RE.test(toolApprovalDigest)
    ) return null;
    seenApprovalIds.add(approvalId);
    approvals.push(Object.freeze({ approvalId, toolName, toolApprovalDigest }));
  }

  return Object.freeze({
    schemaVersion: 1 as const,
    sourceRunId,
    userId,
    circleId,
    threadId,
    approvals: Object.freeze(approvals),
  });
}

export function buildOpenSwanApprovalResumeBindingV1(
  input: BuildOpenSwanApprovalResumeBindingV1Input,
): OpenSwanApprovalResumeBindingV1 | null {
  try {
    return normalizeOpenSwanApprovalResumeBindingV1({
      schemaVersion: 1,
      sourceRunId: input?.sourceRunId,
      userId: input?.userId,
      circleId: input?.circleId,
      threadId: input?.threadId,
      approvals: input?.approvals,
    });
  } catch {
    return null;
  }
}

/**
 * Match one runtime call against an immutable Chat resume binding. When no
 * approval id is supplied, ambiguity fails closed: tool + digest must identify
 * exactly one bound row. Supplying an id always requires that exact listed row.
 */
export function findOpenSwanApprovalResumeItem(
  bindingValue: unknown,
  input: FindOpenSwanApprovalResumeItemInput,
): OpenSwanApprovalResumeItemV1 | null {
  try {
    const binding = normalizeOpenSwanApprovalResumeBindingV1(bindingValue);
    if (!binding) return null;
    const approvalId = input?.approvalId == null ? null : input.approvalId;
    if (
      (approvalId !== null && (typeof approvalId !== 'string' || !UUID_RE.test(approvalId)))
      || typeof input?.sourceRunId !== 'string'
      || typeof input?.toolName !== 'string'
      || typeof input?.digest !== 'string'
      || typeof input?.userId !== 'string'
      || typeof input?.circleId !== 'string'
      || typeof input?.threadId !== 'string'
      || binding.sourceRunId !== input.sourceRunId
      || binding.userId !== input.userId
      || binding.circleId !== input.circleId
      || binding.threadId !== input.threadId
      || !CALL_ID_RE.test(input.toolName)
      || !APPROVAL_DIGEST_RE.test(input.digest)
    ) return null;
    const matches = binding.approvals.filter((item) => (
      (approvalId === null || item.approvalId === approvalId)
      && item.toolName === input.toolName
      && item.toolApprovalDigest === input.digest
    ));
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

function stableValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === undefined) return null;
  if (
    value == null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value as object)) throw new Error('Approval arguments must not be cyclic.');
  seen.add(value as object);
  try {
    if (Array.isArray(value)) return value.map((entry) => stableValue(entry, seen));
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = stableValue((value as Record<string, unknown>)[key], seen);
    }
    return out;
  } finally {
    seen.delete(value as object);
  }
}

export function stableApprovalJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

/**
 * Ephemeral canonical value retained for guarded mutation adapter equality
 * checks. Never place this value in `agent_run_approvals`.
 */
export function buildOpenSwanToolApprovalKey(
  tool: string,
  args: Record<string, unknown> | null | undefined,
): string {
  return stableApprovalJson({
    version: 2,
    tool: String(tool || ''),
    args: args || {},
  });
}

async function sha256Hex(value: string): Promise<string> {
  if (
    typeof value !== 'string'
    || value.length > 1_000_000
    || typeof globalThis.crypto?.subtle?.digest !== 'function'
    || typeof TextEncoder !== 'function'
  ) {
    return '';
  }
  try {
    const digest = await globalThis.crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(value),
    );
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return hex.length === 64 ? hex : '';
  } catch {
    return '';
  }
}

/**
 * Cryptographic binding for the complete exact tool+args intent. A one-byte
 * change anywhere in long-tail nested arguments produces a different digest.
 */
export async function buildOpenSwanToolApprovalDigest(
  tool: string,
  args: Record<string, unknown> | null | undefined,
): Promise<string> {
  let canonical = '';
  try {
    canonical = buildOpenSwanToolApprovalKey(tool, args);
  } catch {
    return '';
  }
  const hex = await sha256Hex(canonical);
  return hex ? `approval-v2:sha256:${hex}` : '';
}

export async function buildOpenSwanApprovalAuthorityBindingDigest(input: {
  approvalId: string;
  approvalRunId?: string;
  approvalDigest: string;
  status: OpenSwanRuntimeApprovalReceiptStatus;
  source: OpenSwanRuntimeApprovalReceiptSource;
  identity: OpenSwanRuntimeApprovalCallIdentity;
}): Promise<string> {
  const approvalRunId = String(input.approvalRunId || input.identity.runId);
  if (!UUID_RE.test(approvalRunId)) return '';
  const hex = await sha256Hex(stableApprovalJson({
    schemaVersion: 2,
    approvalId: input.approvalId,
    approvalRunId,
    approvalDigest: input.approvalDigest,
    status: input.status,
    source: input.source,
    userId: input.identity.userId,
    circleId: input.identity.circleId,
    runId: input.identity.runId,
    toolName: input.identity.toolName,
    toolUseId: input.identity.toolUseId,
    iteration: input.identity.iteration,
  }));
  return hex ? `authority-v2:sha256:${hex}` : '';
}

export function isOpenSwanRuntimeApprovalCallIdentity(
  identity: OpenSwanRuntimeApprovalCallIdentity,
): boolean {
  return (
    UUID_RE.test(identity.userId)
    && UUID_RE.test(identity.circleId)
    && UUID_RE.test(identity.runId)
    && CALL_ID_RE.test(identity.toolName)
    && CALL_ID_RE.test(identity.toolUseId)
    && Number.isInteger(identity.iteration)
    && identity.iteration >= 1
    && identity.iteration <= 1_000
  );
}

export function createOpenSwanRuntimeApprovalReceipt(input: {
  approvalId: unknown;
  approvalRunId?: unknown;
  approvalKey: unknown;
  approvalDigest: unknown;
  authorityBindingDigest: unknown;
  status: unknown;
  source: unknown;
  consumedAt: unknown;
  identity: OpenSwanRuntimeApprovalCallIdentity;
}): OpenSwanRuntimeApprovalReceipt | null {
  const approvalId = typeof input.approvalId === 'string' ? input.approvalId.trim() : '';
  const approvalRunId = typeof input.approvalRunId === 'string'
    ? input.approvalRunId.trim()
    : input.identity.runId;
  const approvalKey = typeof input.approvalKey === 'string' ? input.approvalKey : '';
  const approvalDigest = typeof input.approvalDigest === 'string' ? input.approvalDigest : '';
  const authorityBindingDigest = typeof input.authorityBindingDigest === 'string'
    ? input.authorityBindingDigest
    : '';
  const status = input.status === 'approved' || input.status === 'auto_approved'
    ? input.status
    : null;
  const source = input.source === 'run_scoped'
    || input.source === 'cross_run'
    || input.source === 'category_auto'
    || input.source === 'workflow_review'
    ? input.source
    : null;
  const consumedAt = typeof input.consumedAt === 'string' ? input.consumedAt : '';
  const consumedAtMs = Date.parse(consumedAt);
  if (
    !UUID_RE.test(approvalId)
    || !UUID_RE.test(approvalRunId)
    || !approvalKey
    || !APPROVAL_DIGEST_RE.test(approvalDigest)
    || !AUTHORITY_DIGEST_RE.test(authorityBindingDigest)
    || !status
    || !source
    || !Number.isFinite(consumedAtMs)
    || !isOpenSwanRuntimeApprovalCallIdentity(input.identity)
  ) {
    return null;
  }
  return {
    schemaVersion: 2,
    approvalId,
    approvalRunId,
    approvalKey,
    approvalDigest,
    authorityBindingDigest,
    status,
    source,
    consumedAt: new Date(consumedAtMs).toISOString(),
    ...input.identity,
  };
}

const AUDIT_PAYLOAD_KEYS = new Set([
  'approvalSchemaVersion',
  'toolName',
  'toolApprovalDigest',
  // Compatibility alias for existing approval-card readers. In schema v2 it
  // contains the same SHA-256 digest, never canonical args.
  'toolApprovalKey',
  'toolApprovalKeyVersion',
  'policyFamily',
  'approvalMode',
  'mutatesState',
  'externalSideEffect',
  'autoApproveCategory',
  'floorCategory',
  'dispatchReceiptSchemaVersion',
  'dispatchBindingDigest',
  'dispatchConsumedAt',
]);

export function buildOpenSwanApprovalAuditPayload(input: {
  toolName: string;
  approvalDigest: string;
  policyFamily: string;
  approvalMode: 'auto' | 'ask';
  mutatesState: boolean;
  externalSideEffect: boolean;
  autoApproveCategory?: string | null;
  floorCategory?: string | null;
  dispatchBindingDigest?: string | null;
  dispatchConsumedAt?: string | null;
}): Record<string, unknown> | null {
  if (
    !CALL_ID_RE.test(input.toolName)
    || !APPROVAL_DIGEST_RE.test(input.approvalDigest)
    || !CALL_ID_RE.test(input.policyFamily)
    || (input.approvalMode !== 'auto' && input.approvalMode !== 'ask')
  ) {
    return null;
  }
  const autoApproveCategory = String(input.autoApproveCategory || '').trim();
  const floorCategory = String(input.floorCategory || '').trim();
  const dispatchBindingDigest = String(input.dispatchBindingDigest || '').trim();
  const dispatchConsumedAt = String(input.dispatchConsumedAt || '').trim();
  if (
    (autoApproveCategory && !CALL_ID_RE.test(autoApproveCategory))
    || (floorCategory && !CALL_ID_RE.test(floorCategory))
    || (dispatchBindingDigest && !AUTHORITY_DIGEST_RE.test(dispatchBindingDigest))
    || (dispatchBindingDigest && !Number.isFinite(Date.parse(dispatchConsumedAt)))
    || (!dispatchBindingDigest && Boolean(dispatchConsumedAt))
  ) {
    return null;
  }
  return {
    approvalSchemaVersion: 2,
    toolName: input.toolName,
    toolApprovalDigest: input.approvalDigest,
    toolApprovalKey: input.approvalDigest,
    toolApprovalKeyVersion: 2,
    policyFamily: input.policyFamily,
    approvalMode: input.approvalMode,
    mutatesState: input.mutatesState === true,
    externalSideEffect: input.externalSideEffect === true,
    ...(autoApproveCategory ? { autoApproveCategory } : {}),
    ...(floorCategory ? { floorCategory } : {}),
    ...(dispatchBindingDigest
      ? {
          dispatchReceiptSchemaVersion: 2,
          dispatchBindingDigest,
          dispatchConsumedAt: new Date(Date.parse(dispatchConsumedAt)).toISOString(),
        }
      : {}),
  };
}

export function isOpenSwanApprovalAuditPayload(
  payload: Record<string, unknown> | null | undefined,
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  if (Object.keys(payload).some((key) => !AUDIT_PAYLOAD_KEYS.has(key))) return false;
  const rebuilt = buildOpenSwanApprovalAuditPayload({
    toolName: typeof payload.toolName === 'string' ? payload.toolName : '',
    approvalDigest: typeof payload.toolApprovalDigest === 'string'
      ? payload.toolApprovalDigest
      : '',
    policyFamily: typeof payload.policyFamily === 'string' ? payload.policyFamily : '',
    approvalMode: payload.approvalMode === 'auto' ? 'auto' : 'ask',
    mutatesState: payload.mutatesState === true,
    externalSideEffect: payload.externalSideEffect === true,
    autoApproveCategory: typeof payload.autoApproveCategory === 'string'
      ? payload.autoApproveCategory
      : null,
    floorCategory: typeof payload.floorCategory === 'string'
      ? payload.floorCategory
      : null,
    dispatchBindingDigest: typeof payload.dispatchBindingDigest === 'string'
      ? payload.dispatchBindingDigest
      : null,
    dispatchConsumedAt: typeof payload.dispatchConsumedAt === 'string'
      ? payload.dispatchConsumedAt
      : null,
  });
  if (!rebuilt) return false;
  let canonicalEnvelopeMatches = false;
  try {
    canonicalEnvelopeMatches = stableApprovalJson(rebuilt) === stableApprovalJson(payload);
  } catch {
    return false;
  }
  return (
    // Pin the complete canonical envelope, including optional-field types and
    // the consumed-receipt schema marker. Merely allowlisting a key is not
    // enough: a malformed optional value must never be silently discarded and
    // then treated as valid approval authority.
    canonicalEnvelopeMatches
    && payload.approvalSchemaVersion === 2
    && payload.toolApprovalKeyVersion === 2
    && payload.toolApprovalKey === payload.toolApprovalDigest
    && (payload.approvalMode === 'ask' || payload.approvalMode === 'auto')
    && typeof payload.mutatesState === 'boolean'
    && typeof payload.externalSideEffect === 'boolean'
  );
}

/**
 * Project one resolved `agent_run_approvals`-like row into the value-free item
 * accepted by an approval resume binding. The row remains durable authority;
 * this helper proves only exact identity/scope plus the canonical schema-v2
 * safe audit envelope. Status, liveness, and one-shot consumption are still
 * revalidated by the runtime immediately before dispatch.
 */
export function projectOpenSwanApprovalResumeItemV1(
  rowValue: unknown,
  expected: ProjectOpenSwanApprovalResumeItemV1Scope,
): OpenSwanApprovalResumeItemV1 | null {
  try {
    if (!rowValue || typeof rowValue !== 'object' || Array.isArray(rowValue)) return null;
    const proto = Object.getPrototypeOf(rowValue);
    if (proto !== Object.prototype && proto !== null) return null;
    const read = (key: string): unknown => {
      const descriptor = Object.getOwnPropertyDescriptor(rowValue, key);
      return descriptor && 'value' in descriptor ? descriptor.value : undefined;
    };
    const approvalId = read('id');
    const sourceRunId = read('run_id');
    const circleId = read('circle_id');
    const requestedBy = read('requested_by');
    const payload = read('payload');
    const expectedApprovalId = expected?.approvalId == null ? null : expected.approvalId;
    if (
      typeof approvalId !== 'string'
      || !UUID_RE.test(approvalId)
      || (expectedApprovalId !== null && approvalId !== expectedApprovalId)
      || typeof expected?.sourceRunId !== 'string'
      || !UUID_RE.test(expected.sourceRunId)
      || sourceRunId !== expected.sourceRunId
      || typeof expected?.circleId !== 'string'
      || !UUID_RE.test(expected.circleId)
      || circleId !== expected.circleId
      || typeof expected?.userId !== 'string'
      || !UUID_RE.test(expected.userId)
      || requestedBy !== expected.userId
      || !payload
      || typeof payload !== 'object'
      || Array.isArray(payload)
    ) return null;
    const payloadProto = Object.getPrototypeOf(payload);
    if (payloadProto !== Object.prototype && payloadProto !== null) return null;
    const safePayload: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(payload)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(payload, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      safePayload[key] = descriptor.value;
    }
    if (!isOpenSwanApprovalAuditPayload(safePayload)) return null;
    const toolName = safePayload.toolName;
    const toolApprovalDigest = safePayload.toolApprovalDigest;
    if (
      typeof toolName !== 'string'
      || !CALL_ID_RE.test(toolName)
      || typeof toolApprovalDigest !== 'string'
      || !APPROVAL_DIGEST_RE.test(toolApprovalDigest)
    ) return null;
    return Object.freeze({ approvalId, toolName, toolApprovalDigest });
  } catch {
    return null;
  }
}

/**
 * Read the tool identity from a durable approval payload without trusting an
 * arbitrary lookalike envelope. Schema-v2 rows use `toolName`; the bounded
 * `tool` fallback exists only for legacy approval producers.
 */
export function readOpenSwanApprovalAuditToolName(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (isOpenSwanApprovalAuditPayload(record)) {
    return typeof record.toolName === 'string' ? record.toolName : null;
  }
  const legacy = typeof record.tool === 'string' ? record.tool.trim() : '';
  return CALL_ID_RE.test(legacy) ? legacy : null;
}

function approvalExpired(
  row: OpenSwanRuntimeApprovalRow,
  nowMs: number,
): boolean {
  if (String(row.status || '').toLowerCase() === 'expired') return true;
  const requestedAtMs = Date.parse(String(row.requested_at || ''));
  const timeoutSeconds = Number(row.timeout_seconds);
  return (
    !Number.isFinite(requestedAtMs)
    || !Number.isFinite(timeoutSeconds)
    || timeoutSeconds < 1
    || timeoutSeconds > 86_400
    || requestedAtMs + timeoutSeconds * 1_000 <= nowMs
  );
}

/**
 * Resolve intent state only. A `pass` is not dispatch authority; the runtime
 * must still atomically consume the returned row and mint an exact-call
 * receipt immediately before entering a mutating handler.
 */
export function resolveOpenSwanRuntimeApprovalDecision(input: {
  tool: string;
  approvalDigest?: string;
  /**
   * Deprecated compatibility input. Raw args are never used to authorize a
   * v2 row; callers must migrate to `buildOpenSwanToolApprovalDigest`.
   */
  args?: Record<string, unknown>;
  rows: OpenSwanRuntimeApprovalRow[];
  nowMs?: number;
}): OpenSwanRuntimeApprovalDecision {
  const approvalDigest = String(input.approvalDigest || '');
  if (!CALL_ID_RE.test(input.tool) || !APPROVAL_DIGEST_RE.test(approvalDigest)) {
    return {
      kind: 'block',
      approvalId: '',
      message: `Approval binding for ${input.tool || 'the tool'} was malformed. Nothing was run.`,
    };
  }
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  for (const row of input.rows) {
    const status = String(row.status || '').toLowerCase();
    const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
      ? row.payload
      : null;

    if (!isOpenSwanApprovalAuditPayload(payload)) {
      // Rows are queried under this exact tool's structural title. Legacy or
      // malformed payloads are decisive but can never authorize a dispatch.
      return {
        kind: status === 'pending' ? 'defer' : 'block',
        approvalId: String(row.id || ''),
        message: `A legacy or malformed approval row exists for ${input.tool}; it cannot authorize this call. Nothing was run.`,
      };
    }
    const safePayload = payload as Record<string, unknown>;
    if (safePayload.toolName !== input.tool) continue;
    if (safePayload.toolApprovalDigest !== approvalDigest) continue;

    const approvalId = String(row.id || '');
    if (!UUID_RE.test(approvalId)) {
      return {
        kind: 'block',
        approvalId,
        message: `Approval identity for ${input.tool} was malformed. Nothing was run.`,
      };
    }
    if (approvalExpired(row, nowMs)) {
      return {
        kind: 'block',
        approvalId,
        message: `Approval for ${input.tool} expired before dispatch. Nothing was run; request a fresh approval.`,
      };
    }
    if (typeof safePayload.dispatchBindingDigest === 'string') {
      return {
        kind: 'block',
        approvalId,
        message: `Approval for ${input.tool} was already consumed by one provider tool call. It cannot be replayed.`,
      };
    }
    if (status === 'approved' || status === 'auto_approved') {
      return {
        kind: 'pass',
        approvalId,
        authority: {
          approvalId,
          approvalDigest,
          status,
          row,
        },
        message: `Approval is ready for one exact ${input.tool} provider call.`,
      };
    }
    if (status === 'pending') {
      return {
        kind: 'defer',
        approvalId,
        message: `Approval is still pending for ${input.tool} (id: ${approvalId.slice(0, 8)}).`,
      };
    }
    if (status === 'rejected') {
      return {
        kind: 'block',
        approvalId,
        message: `Approval for ${input.tool} was rejected. Nothing was run.`,
      };
    }
    return {
      kind: 'block',
      approvalId,
      message: `Approval for ${input.tool} is not dispatchable. Nothing was run.`,
    };
  }

  return { kind: 'new' };
}

/**
 * Persisted-safe description of how one action relates to a Chat plan
 * approval. This is metadata only: neither a built nor a validated manifest
 * is dispatch authority. The eventual runtime gateway must still compare the
 * current catalog policy and atomically consume independently issued
 * authority immediately before a mutating handler.
 */
export type OpenSwanPlanManifestCoverage = 'plan_covered' | 'final_confirmation';

export type OpenSwanPlanManifestHardFloor =
  | 'persistent_write'
  | 'credential'
  | 'login'
  | 'payment'
  | 'purchase'
  | 'checkout'
  | 'publish'
  | 'send'
  | 'post'
  | 'external_communication'
  | 'delete'
  | 'trash'
  | 'overwrite'
  | 'destructive'
  | 'permission'
  | 'security'
  | 'private_file'
  | 'ambiguous'
  | 'unknown';

export type ChatPlanToolPolicySensitivityInputV1 = {
  policyFamily: string;
  approvalMode: 'auto' | 'ask';
  mutatesState: boolean;
  externalSideEffect: boolean;
  /**
   * Must be explicit. A mutation is plan-coverable only when the current
   * catalog classifies it as a non-floor mutation.
   */
  mutationClassification: 'read_only' | 'classified_mutation' | 'unknown';
  floorCategory: OpenSwanPlanManifestHardFloor | null;
  /** Additional JSON policy fields are included in the exact digest. */
  [key: string]: unknown;
};

export type ChatPlanToolActionManifestInputV1 = {
  actionIndex: number;
  actionId: string;
  toolName: string;
  args: Record<string, unknown>;
  policySensitivity: ChatPlanToolPolicySensitivityInputV1;
};

export type ChatPlanToolActionManifestEntryV1 = Readonly<{
  actionIndex: number;
  actionId: string;
  toolName: string;
  /** Exact tool+args binding. Raw arguments are deliberately not persisted. */
  toolApprovalDigest: string;
  /** Exact catalog-policy binding. Raw policy values are not persisted. */
  policyBindingDigest: string;
  coverage: OpenSwanPlanManifestCoverage;
}>;

export type ChatPlanToolActionManifestV1 = Readonly<{
  schemaVersion: 1;
  rootRunId: string;
  requestIdentityFingerprint: string;
  orderedActions: readonly ChatPlanToolActionManifestEntryV1[];
  manifestFingerprint: string;
}>;

export type ChatPlanToolActionManifestBuildInputV1 = {
  rootRunId: string;
  requestIdentityFingerprint: string;
  orderedActions: readonly ChatPlanToolActionManifestInputV1[];
};

export const CHAT_PLAN_TOOL_ACTION_MANIFEST_MAX_ACTIONS = 32;

const CHAT_PLAN_REQUEST_FINGERPRINT_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const CHAT_PLAN_POLICY_BINDING_RE = /^policy-v1:sha256:[0-9a-f]{64}$/;
const CHAT_PLAN_MANIFEST_FINGERPRINT_RE = /^chat-plan-tools-v1:sha256:[0-9a-f]{64}$/;
const CHAT_PLAN_HARD_FLOORS = new Set<OpenSwanPlanManifestHardFloor>([
  'persistent_write',
  'credential',
  'login',
  'payment',
  'purchase',
  'checkout',
  'publish',
  'send',
  'post',
  'external_communication',
  'delete',
  'trash',
  'overwrite',
  'destructive',
  'permission',
  'security',
  'private_file',
  'ambiguous',
  'unknown',
]);
const CHAT_PLAN_ENTRY_KEYS = new Set([
  'actionIndex',
  'actionId',
  'toolName',
  'toolApprovalDigest',
  'policyBindingDigest',
  'coverage',
]);
const CHAT_PLAN_MANIFEST_KEYS = new Set([
  'schemaVersion',
  'rootRunId',
  'requestIdentityFingerprint',
  'orderedActions',
  'manifestFingerprint',
]);

/**
 * Strict JSON canonicalization for fingerprint inputs. It deliberately
 * rejects cycles, accessors, sparse arrays, non-finite numbers, custom
 * prototypes, symbols, undefined, functions, and other values whose runtime
 * identity cannot survive an exact JSON round trip.
 */
function strictCanonicalJson(value: unknown, seen = new WeakSet<object>(), depth = 0): string {
  if (depth > 64) throw new Error('Manifest fingerprint input is too deeply nested.');
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Manifest fingerprint numbers must be finite.');
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (typeof value !== 'object') {
    throw new Error('Manifest fingerprint input must contain JSON values only.');
  }

  const objectValue = value as object;
  if (seen.has(objectValue)) throw new Error('Manifest fingerprint input must not be cyclic.');
  seen.add(objectValue);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value);
      const expectedKeys = new Set(['length', ...value.map((_entry, index) => String(index))]);
      if (
        ownKeys.length !== expectedKeys.size
        || ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.has(key))
      ) {
        throw new Error('Manifest fingerprint arrays must be dense JSON arrays.');
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
          throw new Error('Manifest fingerprint arrays must contain plain data entries.');
        }
      }
      return `[${value.map((entry) => strictCanonicalJson(entry, seen, depth + 1)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Manifest fingerprint objects must be plain JSON objects.');
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key !== 'string')) {
      throw new Error('Manifest fingerprint objects must not contain symbol keys.');
    }
    const keys = (ownKeys as string[]).sort();
    const entries = keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || descriptor.enumerable !== true) {
        throw new Error('Manifest fingerprint objects must contain enumerable data properties only.');
      }
      return `${JSON.stringify(key)}:${strictCanonicalJson(descriptor.value, seen, depth + 1)}`;
    });
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(objectValue);
  }
}

async function digestStrictCanonicalJson(
  prefix: 'policy-v1:sha256:' | 'chat-plan-tools-v1:sha256:' | 'target-v1:sha256:',
  value: unknown,
): Promise<string> {
  let canonical = '';
  try {
    canonical = strictCanonicalJson(value);
  } catch {
    return '';
  }
  const hex = await sha256Hex(canonical);
  return hex ? `${prefix}${hex}` : '';
}

/** Domain-separated digest for one already-observed semantic target. */
export async function buildOpenSwanWorkflowTargetBindingDigestV1(
  toolName: string,
  targetBinding: unknown,
): Promise<string> {
  if (!CALL_ID_RE.test(toolName)) return '';
  return digestStrictCanonicalJson('target-v1:sha256:', {
    schemaVersion: 1,
    toolName,
    targetBinding,
  });
}

/**
 * Resolve coverage conservatively from the current catalog policy. Any
 * malformed, unknown, mismatched, hard-floor, or externally effectful policy
 * requires a final confirmation. External side effects intentionally start
 * on the hard side of this boundary.
 */
export function resolveOpenSwanPlanManifestCoverage(
  value: unknown,
): OpenSwanPlanManifestCoverage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'final_confirmation';
  const policy = value as Record<string, unknown>;
  if (
    !CALL_ID_RE.test(typeof policy.policyFamily === 'string' ? policy.policyFamily : '')
    || (policy.approvalMode !== 'auto' && policy.approvalMode !== 'ask')
    || typeof policy.mutatesState !== 'boolean'
    || typeof policy.externalSideEffect !== 'boolean'
  ) {
    return 'final_confirmation';
  }
  if (policy.externalSideEffect !== false) return 'final_confirmation';

  const floorCategory = policy.floorCategory;
  if (floorCategory !== null) {
    if (
      typeof floorCategory !== 'string'
      || !CHAT_PLAN_HARD_FLOORS.has(floorCategory as OpenSwanPlanManifestHardFloor)
    ) {
      // An unrecognized sensitivity label is itself unknown.
      return 'final_confirmation';
    }
    return 'final_confirmation';
  }

  if (policy.mutatesState === false) {
    return policy.mutationClassification === 'read_only'
      ? 'plan_covered'
      : 'final_confirmation';
  }
  return policy.mutationClassification === 'classified_mutation'
    ? 'plan_covered'
    : 'final_confirmation';
}

export async function buildChatPlanPolicyBindingDigestV1(
  toolName: string,
  policySensitivity: unknown,
): Promise<string> {
  return digestStrictCanonicalJson('policy-v1:sha256:', {
    schemaVersion: 1,
    toolName,
    policySensitivity,
  });
}

type ChatPlanToolActionManifestFingerprintInputV1 = Omit<
  ChatPlanToolActionManifestV1,
  'manifestFingerprint'
>;

/**
 * Fingerprint the complete ordered persisted envelope. This digest is an
 * integrity/equality binding, not a signature or runtime authority.
 */
export async function fingerprintChatPlanToolActionManifestV1(
  input: ChatPlanToolActionManifestFingerprintInputV1,
): Promise<string> {
  return digestStrictCanonicalJson('chat-plan-tools-v1:sha256:', input);
}

function freezeChatPlanToolActionManifestV1(
  input: ChatPlanToolActionManifestV1,
): ChatPlanToolActionManifestV1 {
  const orderedActions = input.orderedActions.map((entry) => Object.freeze({ ...entry }));
  return Object.freeze({ ...input, orderedActions: Object.freeze(orderedActions) });
}

/**
 * Build a credential-free, immutable, ordered manifest for at most 32 exact
 * tool calls. Raw root request text, tool args, and policy values are used
 * only to derive digests and are absent from the returned value.
 */
export async function buildChatPlanToolActionManifestV1(
  input: ChatPlanToolActionManifestBuildInputV1,
): Promise<ChatPlanToolActionManifestV1 | null> {
  if (
    !UUID_RE.test(input.rootRunId)
    || !CHAT_PLAN_REQUEST_FINGERPRINT_RE.test(input.requestIdentityFingerprint)
    || !Array.isArray(input.orderedActions)
    || input.orderedActions.length < 1
    || input.orderedActions.length > CHAT_PLAN_TOOL_ACTION_MANIFEST_MAX_ACTIONS
  ) {
    return null;
  }

  const actionIds = new Set<string>();
  const orderedActions: ChatPlanToolActionManifestEntryV1[] = [];
  let finalConfirmationReached = false;
  for (let position = 0; position < input.orderedActions.length; position += 1) {
    const action = input.orderedActions[position];
    if (
      !action
      || action.actionIndex !== position
      || !Number.isInteger(action.actionIndex)
      || !CALL_ID_RE.test(action.actionId)
      || actionIds.has(action.actionId)
      || !CALL_ID_RE.test(action.toolName)
      || !action.args
      || typeof action.args !== 'object'
      || Array.isArray(action.args)
    ) {
      return null;
    }

    // Preflight exact JSON compatibility before using the existing canonical
    // tool approval digest. This rejects values that stable string coercion
    // would otherwise make ambiguous across a serialization boundary.
    try {
      const strictArgs = strictCanonicalJson(action.args);
      const strictPolicy = strictCanonicalJson(action.policySensitivity);
      if (strictArgs.length > 1_000_000 || strictPolicy.length > 1_000_000) return null;
    } catch {
      return null;
    }

    const toolApprovalDigest = await buildOpenSwanToolApprovalDigest(
      action.toolName,
      action.args,
    );
    const policyBindingDigest = await buildChatPlanPolicyBindingDigestV1(
      action.toolName,
      action.policySensitivity,
    );
    if (
      !APPROVAL_DIGEST_RE.test(toolApprovalDigest)
      || !CHAT_PLAN_POLICY_BINDING_RE.test(policyBindingDigest)
    ) {
      return null;
    }

    const resolvedCoverage = resolveOpenSwanPlanManifestCoverage(action.policySensitivity);
    if (resolvedCoverage === 'final_confirmation') finalConfirmationReached = true;
    const coverage: OpenSwanPlanManifestCoverage = finalConfirmationReached
      ? 'final_confirmation'
      : 'plan_covered';
    actionIds.add(action.actionId);
    orderedActions.push({
      actionIndex: action.actionIndex,
      actionId: action.actionId,
      toolName: action.toolName,
      toolApprovalDigest,
      policyBindingDigest,
      coverage,
    });
  }

  const envelope: ChatPlanToolActionManifestFingerprintInputV1 = {
    schemaVersion: 1,
    rootRunId: input.rootRunId,
    requestIdentityFingerprint: input.requestIdentityFingerprint,
    orderedActions,
  };
  const manifestFingerprint = await fingerprintChatPlanToolActionManifestV1(envelope);
  if (!CHAT_PLAN_MANIFEST_FINGERPRINT_RE.test(manifestFingerprint)) return null;
  return freezeChatPlanToolActionManifestV1({ ...envelope, manifestFingerprint });
}

/**
 * Strict persisted-shape and digest validator. Successful validation means
 * only that the data is canonical and self-consistent; because the digest is
 * unkeyed and serialization strips runtime provenance, the result MUST NOT be
 * treated as approval or dispatch authority.
 */
export async function validateChatPlanToolActionManifestV1(
  value: unknown,
): Promise<ChatPlanToolActionManifestV1 | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const manifest = value as Record<string, unknown>;
  if (
    Object.keys(manifest).length !== CHAT_PLAN_MANIFEST_KEYS.size
    || Object.keys(manifest).some((key) => !CHAT_PLAN_MANIFEST_KEYS.has(key))
    || manifest.schemaVersion !== 1
    || !UUID_RE.test(typeof manifest.rootRunId === 'string' ? manifest.rootRunId : '')
    || !CHAT_PLAN_REQUEST_FINGERPRINT_RE.test(
      typeof manifest.requestIdentityFingerprint === 'string'
        ? manifest.requestIdentityFingerprint
        : '',
    )
    || !Array.isArray(manifest.orderedActions)
    || manifest.orderedActions.length < 1
    || manifest.orderedActions.length > CHAT_PLAN_TOOL_ACTION_MANIFEST_MAX_ACTIONS
    || !CHAT_PLAN_MANIFEST_FINGERPRINT_RE.test(
      typeof manifest.manifestFingerprint === 'string' ? manifest.manifestFingerprint : '',
    )
  ) {
    return null;
  }

  const actionIds = new Set<string>();
  const orderedActions: ChatPlanToolActionManifestEntryV1[] = [];
  let finalConfirmationReached = false;
  for (let position = 0; position < manifest.orderedActions.length; position += 1) {
    const rawEntry = manifest.orderedActions[position];
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) return null;
    const entry = rawEntry as Record<string, unknown>;
    const coverage = entry.coverage;
    if (
      Object.keys(entry).length !== CHAT_PLAN_ENTRY_KEYS.size
      || Object.keys(entry).some((key) => !CHAT_PLAN_ENTRY_KEYS.has(key))
      || entry.actionIndex !== position
      || !Number.isInteger(entry.actionIndex)
      || !CALL_ID_RE.test(typeof entry.actionId === 'string' ? entry.actionId : '')
      || actionIds.has(String(entry.actionId))
      || !CALL_ID_RE.test(typeof entry.toolName === 'string' ? entry.toolName : '')
      || !APPROVAL_DIGEST_RE.test(
        typeof entry.toolApprovalDigest === 'string' ? entry.toolApprovalDigest : '',
      )
      || !CHAT_PLAN_POLICY_BINDING_RE.test(
        typeof entry.policyBindingDigest === 'string' ? entry.policyBindingDigest : '',
      )
      || (coverage !== 'plan_covered' && coverage !== 'final_confirmation')
      || (finalConfirmationReached && coverage === 'plan_covered')
    ) {
      return null;
    }
    if (coverage === 'final_confirmation') finalConfirmationReached = true;
    actionIds.add(String(entry.actionId));
    orderedActions.push({
      actionIndex: position,
      actionId: String(entry.actionId),
      toolName: String(entry.toolName),
      toolApprovalDigest: String(entry.toolApprovalDigest),
      policyBindingDigest: String(entry.policyBindingDigest),
      coverage,
    });
  }

  const envelope: ChatPlanToolActionManifestFingerprintInputV1 = {
    schemaVersion: 1,
    rootRunId: String(manifest.rootRunId),
    requestIdentityFingerprint: String(manifest.requestIdentityFingerprint),
    orderedActions,
  };
  const expectedFingerprint = await fingerprintChatPlanToolActionManifestV1(envelope);
  if (expectedFingerprint !== manifest.manifestFingerprint) return null;
  return freezeChatPlanToolActionManifestV1({
    ...envelope,
    manifestFingerprint: expectedFingerprint,
  });
}

/**
 * Runtime-only capability minted after an existing branded Chat plan approval
 * has already won its one-shot durable claim. The public value is deliberately
 * value-free; the exact manifest, target digests, effect classes, ordering,
 * expiry, and consume cursor live only in the module-private WeakMap below.
 *
 * This is the first narrow workflow-review lane. It does not serialize or
 * survive a process restart. Losing it is a safe stop, never permission to
 * reconstruct consent from persisted manifest metadata.
 */
export type OpenSwanWorkflowReviewAuthorityV1 = Readonly<{
  schemaVersion: 1;
  kind: 'openswan_workflow_review';
  surface: 'main_chat';
  reviewApprovalId: string;
  sourceRunId: string;
  sourceMessageId: string;
  userId: string;
  circleId: string;
  threadId: string;
  requestIdentityFingerprint: string;
  multiActionLedgerBindingDigest: string | null;
  manifestFingerprint: string;
  actionCount: number;
  expiresAt: string;
}>;

export type OpenSwanWorkflowReviewActionIdentityV1 = Readonly<{
  sourceRunId: string;
  sourceMessageId: string;
  userId: string;
  circleId: string;
  threadId: string;
  toolName: string;
  toolUseId: string;
  iteration: number;
  sourceCallOrdinal: number;
  /** Exact process-private A-ledger object; object identity is authoritative. */
  multiActionLedgerReference?: unknown;
}>;

export type OpenSwanWorkflowReviewActionInspectionV1 = Readonly<{
  actionIndex: number;
  actionId: string;
  effectClass: ApprovalEffect;
  coverage: OpenSwanPlanManifestCoverage;
}>;

export type IssueOpenSwanWorkflowReviewAuthorityV1Input = Readonly<{
  /** Branded output of runChatAutomationPlan after the approval-row CAS. */
  planApprovalAuthority: ChatPlanApprovalAuthority;
  planApprovalExpected: Readonly<{
    executionKind: string;
    approvalIntentFingerprint: string;
    programId: string;
    programFingerprint: string;
  }>;
  sourceRunId: string;
  sourceMessageId: string;
  userId: string;
  circleId: string;
  threadId: string;
  manifest: unknown;
  /** Optional exact A-ledger reference from the originating Chat turn. */
  multiActionLedgerReference?: unknown;
  orderedActionBindings: readonly Readonly<{
    actionIndex: number;
    sourceToolUseId: string;
    sourceIteration: number;
    sourceCallOrdinal: number;
    effectClass: ApprovalEffect;
    /** Transient values used only to verify the persisted-safe digests. */
    args: Record<string, unknown>;
    policySensitivity: ChatPlanToolPolicySensitivityInputV1;
    targetBinding: unknown;
  }>[];
  expiresAtMs: number;
}>;

type OpenSwanWorkflowReviewActionBindingV1 = Readonly<{
  actionIndex: number;
  sourceToolUseId: string;
  sourceIteration: number;
  sourceCallOrdinal: number;
  effectClass: ApprovalEffect;
  targetBindingDigest: string;
}>;

type OpenSwanWorkflowReviewAuthorityStateV1 = {
  manifest: ChatPlanToolActionManifestV1;
  bindings: readonly OpenSwanWorkflowReviewActionBindingV1[];
  nextActionIndex: number;
  expiresAtMs: number;
  revoked: boolean;
  multiActionLedgerReference: object | null;
};

const WORKFLOW_TARGET_BINDING_RE = /^target-v1:sha256:[0-9a-f]{64}$/;
const WORKFLOW_REVIEW_MAX_LIFETIME_MS = 15 * 60_000;
const APPROVAL_EFFECT_SET = new Set<string>(APPROVAL_EFFECTS);
const workflowReviewAuthorityStates = new WeakMap<object, OpenSwanWorkflowReviewAuthorityStateV1>();
const workflowReviewSourceAuthorities = new WeakSet<object>();

function workflowReviewIdentityMatches(
  authority: OpenSwanWorkflowReviewAuthorityV1,
  binding: OpenSwanWorkflowReviewActionBindingV1,
  entry: ChatPlanToolActionManifestEntryV1,
  identity: OpenSwanWorkflowReviewActionIdentityV1,
): boolean {
  return authority.sourceRunId === identity.sourceRunId
    && authority.sourceMessageId === identity.sourceMessageId
    && authority.userId === identity.userId
    && authority.circleId === identity.circleId
    && authority.threadId === identity.threadId
    && entry.toolName === identity.toolName
    && binding.sourceToolUseId === identity.toolUseId
    && binding.sourceIteration === identity.iteration
    && binding.sourceCallOrdinal === identity.sourceCallOrdinal;
}

/**
 * Mint one non-serializable workflow capability. A persisted manifest alone,
 * a copied plan-authority shape, or a policy auto-waiver can never enter this
 * lane. Every transient raw value is discarded after its digest is checked.
 */
export async function issueOpenSwanWorkflowReviewAuthorityV1(
  input: IssueOpenSwanWorkflowReviewAuthorityV1Input,
): Promise<OpenSwanWorkflowReviewAuthorityV1 | null> {
  try {
    const issuedAtMs = Date.now();
    if (
      !Number.isSafeInteger(input.expiresAtMs)
      || input.expiresAtMs <= issuedAtMs
      || input.expiresAtMs > issuedAtMs + WORKFLOW_REVIEW_MAX_LIFETIME_MS
      || !UUID_RE.test(input.sourceRunId)
      || !UUID_RE.test(input.sourceMessageId)
      || !UUID_RE.test(input.userId)
      || !UUID_RE.test(input.circleId)
      || !UUID_RE.test(input.threadId)
      || !input.planApprovalAuthority
      || input.planApprovalAuthority.authorizationSource !== 'claimed_approval_row'
      || typeof input.planApprovalAuthority.approvalId !== 'string'
      || !UUID_RE.test(input.planApprovalAuthority.approvalId)
      || workflowReviewSourceAuthorities.has(input.planApprovalAuthority as object)
    ) return null;

    const manifest = await validateChatPlanToolActionManifestV1(input.manifest);
    const multiActionLedgerReference = input.multiActionLedgerReference == null
      ? null
      : input.multiActionLedgerReference;
    if (
      !manifest
      || manifest.rootRunId !== input.sourceRunId
      || !Array.isArray(input.orderedActionBindings)
      || input.orderedActionBindings.length !== manifest.orderedActions.length
      || (
        multiActionLedgerReference !== null
        && (
          typeof multiActionLedgerReference !== 'object'
          || Array.isArray(multiActionLedgerReference)
        )
      )
      || !isIssuedChatPlanApprovalAuthorityObject(input.planApprovalAuthority, {
        circleId: input.circleId,
        userId: input.userId,
        threadId: input.threadId,
        executionKind: input.planApprovalExpected.executionKind,
        approvalIntentFingerprint: input.planApprovalExpected.approvalIntentFingerprint,
        requestIdentityFingerprint: manifest.requestIdentityFingerprint,
        programId: input.planApprovalExpected.programId,
        programFingerprint: input.planApprovalExpected.programFingerprint,
      })
    ) return null;

    const multiActionLedgerBindingDigest = multiActionLedgerReference === null
      ? null
      : await buildOpenSwanWorkflowTargetBindingDigestV1(
          'run.multi_action_ledger',
          multiActionLedgerReference,
        );
    if (
      multiActionLedgerReference !== null
      && !WORKFLOW_TARGET_BINDING_RE.test(String(multiActionLedgerBindingDigest || ''))
    ) return null;

    const bindings: OpenSwanWorkflowReviewActionBindingV1[] = [];
    let previousIteration = 0;
    let previousOrdinal = 0;
    for (let index = 0; index < manifest.orderedActions.length; index += 1) {
      const entry = manifest.orderedActions[index]!;
      const binding = input.orderedActionBindings[index];
      if (
        !binding
        || binding.actionIndex !== index
        || !CALL_ID_RE.test(binding.sourceToolUseId)
        || !Number.isInteger(binding.sourceIteration)
        || binding.sourceIteration < 1
        || binding.sourceIteration > 1_000
        || !Number.isInteger(binding.sourceCallOrdinal)
        || binding.sourceCallOrdinal < 1
        || binding.sourceCallOrdinal > 1_000
        || !APPROVAL_EFFECT_SET.has(binding.effectClass)
        || binding.policySensitivity.effectClass !== binding.effectClass
        || (
          binding.sourceIteration < previousIteration
          || (
            binding.sourceIteration === previousIteration
            && binding.sourceCallOrdinal <= previousOrdinal
          )
        )
      ) return null;

      const [toolApprovalDigest, policyBindingDigest, targetBindingDigest] = await Promise.all([
        buildOpenSwanToolApprovalDigest(entry.toolName, binding.args),
        buildChatPlanPolicyBindingDigestV1(entry.toolName, binding.policySensitivity),
        buildOpenSwanWorkflowTargetBindingDigestV1(entry.toolName, binding.targetBinding),
      ]);
      if (
        toolApprovalDigest !== entry.toolApprovalDigest
        || policyBindingDigest !== entry.policyBindingDigest
        || !WORKFLOW_TARGET_BINDING_RE.test(targetBindingDigest)
        || (
          entry.coverage === 'plan_covered'
          && classifyAlwaysExactApprovalEffect({
            effect: binding.effectClass,
            tool: entry.toolName,
          }) !== null
        )
      ) return null;

      bindings.push(Object.freeze({
        actionIndex: index,
        sourceToolUseId: binding.sourceToolUseId,
        sourceIteration: binding.sourceIteration,
        sourceCallOrdinal: binding.sourceCallOrdinal,
        effectClass: binding.effectClass,
        targetBindingDigest,
      }));
      previousIteration = binding.sourceIteration;
      previousOrdinal = binding.sourceCallOrdinal;
    }

    const reviewApprovalId = input.planApprovalAuthority.approvalId;
    const authority = Object.freeze({
      schemaVersion: 1 as const,
      kind: 'openswan_workflow_review' as const,
      surface: 'main_chat' as const,
      reviewApprovalId,
      sourceRunId: input.sourceRunId,
      sourceMessageId: input.sourceMessageId,
      userId: input.userId,
      circleId: input.circleId,
      threadId: input.threadId,
      requestIdentityFingerprint: manifest.requestIdentityFingerprint,
      multiActionLedgerBindingDigest,
      manifestFingerprint: manifest.manifestFingerprint,
      actionCount: manifest.orderedActions.length,
      expiresAt: new Date(input.expiresAtMs).toISOString(),
    });
    workflowReviewAuthorityStates.set(authority, {
      manifest,
      bindings: Object.freeze(bindings),
      nextActionIndex: 0,
      expiresAtMs: input.expiresAtMs,
      revoked: false,
      multiActionLedgerReference: multiActionLedgerReference as object | null,
    });
    workflowReviewSourceAuthorities.add(input.planApprovalAuthority as object);
    return authority;
  } catch {
    return null;
  }
}

/** Read only the value-free next-action classification after exact scope/order checks. */
export function inspectOpenSwanWorkflowReviewActionV1(
  authority: OpenSwanWorkflowReviewAuthorityV1,
  identity: OpenSwanWorkflowReviewActionIdentityV1,
  nowMs = Date.now(),
): OpenSwanWorkflowReviewActionInspectionV1 | null {
  try {
    const state = authority && typeof authority === 'object'
      ? workflowReviewAuthorityStates.get(authority as object)
      : undefined;
    if (
      !state
      || state.revoked
      || !Number.isFinite(nowMs)
      || nowMs >= state.expiresAtMs
      || state.nextActionIndex < 0
      || state.nextActionIndex >= state.bindings.length
      || (identity.multiActionLedgerReference ?? null) !== state.multiActionLedgerReference
    ) return null;
    const binding = state.bindings[state.nextActionIndex]!;
    const entry = state.manifest.orderedActions[state.nextActionIndex]!;
    if (!workflowReviewIdentityMatches(authority, binding, entry, identity)) return null;
    return Object.freeze({
      actionIndex: entry.actionIndex,
      actionId: entry.actionId,
      effectClass: binding.effectClass,
      coverage: entry.coverage,
    });
  } catch {
    return null;
  }
}

export type OpenSwanWorkflowReviewConsumeDecisionV1 =
  | Readonly<{
      kind: 'allowed';
      actionIndex: number;
      actionId: string;
      receipt: OpenSwanRuntimeApprovalReceipt;
    }>
  | Readonly<{
      kind: 'exact_approval_required';
      actionIndex: number;
      actionId: string;
      floorCategory: AlwaysExactApprovalEffect | 'policy_floor';
    }>
  | Readonly<{
      kind: 'blocked';
      code: 'authority_unavailable' | 'call_drift' | 'binding_drift';
      message: string;
    }>;

async function buildOpenSwanWorkflowReviewActionAuthorityDigestV1(input: Readonly<{
  authority: OpenSwanWorkflowReviewAuthorityV1;
  entry: ChatPlanToolActionManifestEntryV1;
  binding: OpenSwanWorkflowReviewActionBindingV1;
  identity: OpenSwanWorkflowReviewActionIdentityV1;
  toolApprovalDigest: string;
}>): Promise<string> {
  const hex = await sha256Hex(stableApprovalJson({
    schemaVersion: 1,
    kind: 'openswan_workflow_review_action',
    reviewApprovalId: input.authority.reviewApprovalId,
    sourceRunId: input.authority.sourceRunId,
    sourceMessageId: input.authority.sourceMessageId,
    userId: input.authority.userId,
    circleId: input.authority.circleId,
    threadId: input.authority.threadId,
    requestIdentityFingerprint: input.authority.requestIdentityFingerprint,
    multiActionLedgerBindingDigest: input.authority.multiActionLedgerBindingDigest,
    manifestFingerprint: input.authority.manifestFingerprint,
    actionIndex: input.entry.actionIndex,
    actionId: input.entry.actionId,
    toolName: input.entry.toolName,
    toolUseId: input.identity.toolUseId,
    iteration: input.identity.iteration,
    sourceCallOrdinal: input.identity.sourceCallOrdinal,
    toolApprovalDigest: input.toolApprovalDigest,
    policyBindingDigest: input.entry.policyBindingDigest,
    targetBindingDigest: input.binding.targetBindingDigest,
  }));
  return hex ? `authority-v2:sha256:${hex}` : '';
}

/**
 * Consume the next reviewed action exactly once. Digests are recomputed from
 * the handler-entry values; no mismatch advances the cursor. Hard-floor
 * entries deliberately return `exact_approval_required` and mint no receipt.
 */
export async function consumeOpenSwanWorkflowReviewActionV1(
  authority: OpenSwanWorkflowReviewAuthorityV1,
  input: OpenSwanWorkflowReviewActionIdentityV1 & Readonly<{
    args: Record<string, unknown>;
    policySensitivity: ChatPlanToolPolicySensitivityInputV1;
    targetBinding: unknown;
  }>,
): Promise<OpenSwanWorkflowReviewConsumeDecisionV1> {
  const nowMs = Date.now();
  const inspection = inspectOpenSwanWorkflowReviewActionV1(authority, input, nowMs);
  if (!inspection) {
    return Object.freeze({
      kind: 'blocked' as const,
      code: 'call_drift' as const,
      message: 'The proposed call was not the next exact action in the reviewed workflow. Nothing was run.',
    });
  }
  const state = workflowReviewAuthorityStates.get(authority as object);
  if (!state || state.revoked) {
    return Object.freeze({
      kind: 'blocked' as const,
      code: 'authority_unavailable' as const,
      message: 'The workflow review authority is no longer available. Nothing was run.',
    });
  }
  const entry = state.manifest.orderedActions[inspection.actionIndex]!;
  const binding = state.bindings[inspection.actionIndex]!;
  const floor = classifyAlwaysExactApprovalEffect({
    effect: binding.effectClass,
    tool: entry.toolName,
  });
  if (entry.coverage === 'final_confirmation' || floor !== null) {
    return Object.freeze({
      kind: 'exact_approval_required' as const,
      actionIndex: entry.actionIndex,
      actionId: entry.actionId,
      floorCategory: floor || 'policy_floor',
    });
  }

  const [toolApprovalDigest, policyBindingDigest, targetBindingDigest] = await Promise.all([
    buildOpenSwanToolApprovalDigest(entry.toolName, input.args),
    buildChatPlanPolicyBindingDigestV1(entry.toolName, input.policySensitivity),
    buildOpenSwanWorkflowTargetBindingDigestV1(entry.toolName, input.targetBinding),
  ]);
  if (
    toolApprovalDigest !== entry.toolApprovalDigest
    || policyBindingDigest !== entry.policyBindingDigest
    || targetBindingDigest !== binding.targetBindingDigest
  ) {
    return Object.freeze({
      kind: 'blocked' as const,
      code: 'binding_drift' as const,
      message: 'The reviewed tool, arguments, policy, or target changed before dispatch. Nothing was run.',
    });
  }
  const authorityBindingDigest = await buildOpenSwanWorkflowReviewActionAuthorityDigestV1({
    authority,
    entry,
    binding,
    identity: input,
    toolApprovalDigest,
  });
  const receipt = createOpenSwanRuntimeApprovalReceipt({
    approvalId: authority.reviewApprovalId,
    approvalRunId: authority.sourceRunId,
    approvalKey: buildOpenSwanToolApprovalKey(entry.toolName, input.args),
    approvalDigest: toolApprovalDigest,
    authorityBindingDigest,
    status: 'approved',
    source: 'workflow_review',
    consumedAt: new Date(nowMs).toISOString(),
    identity: {
      userId: authority.userId,
      circleId: authority.circleId,
      runId: authority.sourceRunId,
      toolName: entry.toolName,
      toolUseId: input.toolUseId,
      iteration: input.iteration,
    },
  });
  // Recheck after every digest await. A competing call, expiry, STOP/revoke,
  // or cursor movement must lose without minting a second receipt.
  if (
    !receipt
    || state.revoked
    || nowMs >= state.expiresAtMs
    || state.nextActionIndex !== inspection.actionIndex
    || (input.multiActionLedgerReference ?? null) !== state.multiActionLedgerReference
    || !workflowReviewIdentityMatches(authority, binding, entry, input)
  ) {
    return Object.freeze({
      kind: 'blocked' as const,
      code: 'authority_unavailable' as const,
      message: 'The reviewed action authority changed or was consumed before handler entry. Nothing was run.',
    });
  }
  state.nextActionIndex += 1;
  return Object.freeze({
    kind: 'allowed' as const,
    actionIndex: entry.actionIndex,
    actionId: entry.actionId,
    receipt,
  });
}

/** Irreversibly retire one process-private workflow capability. */
export function revokeOpenSwanWorkflowReviewAuthorityV1(
  authority: OpenSwanWorkflowReviewAuthorityV1,
): boolean {
  try {
    const state = authority && typeof authority === 'object'
      ? workflowReviewAuthorityStates.get(authority as object)
      : undefined;
    if (!state || state.revoked) return false;
    state.revoked = true;
    workflowReviewAuthorityStates.delete(authority as object);
    return true;
  } catch {
    return false;
  }
}
