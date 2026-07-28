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
  timeout_seconds?: number | null;
  status?: OpenSwanRuntimeApprovalStatus | null;
  payload?: Record<string, unknown> | null;
};

export type OpenSwanRuntimeApprovalReceiptStatus = 'approved' | 'auto_approved';
export type OpenSwanRuntimeApprovalReceiptSource = 'run_scoped' | 'cross_run' | 'category_auto';

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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const APPROVAL_DIGEST_RE = /^approval-v2:sha256:[0-9a-f]{64}$/;
const AUTHORITY_DIGEST_RE = /^authority-v2:sha256:[0-9a-f]{64}$/;

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
