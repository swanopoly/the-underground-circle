/**
 * Owner-private durable binding between one published Office agent and one
 * exact live OpenSwan session. Public CircleOfficeAgent rows never carry
 * provider session identities or local connection secrets.
 */

import { getSupabaseClientForAccessToken, supabase } from './supabase';
import type {
  AgentConnection,
  OfficeConnectionAuthorityFence,
  OfficeConnectionExactAuthority,
} from './connectionManager';
import {
  parseOfficeAgentSessionBindingMutationReceipt,
  resolveOfficeAgentSessionBinding as resolveOfficeAgentSessionBindingCore,
  type OfficeAgentSessionBinding,
  type OfficeAgentSessionBindingMutationReceipt,
  type OfficeAgentSessionBindingMutationRequest,
  type OfficeAgentSessionBindingResolution,
  type OfficeAgentSessionsByConnection,
  type OpenSwanConnectionFingerprint,
  type ResolveOfficeAgentSessionBindingInput,
} from './officeAgentSessionBindingCore';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SESSION_KEY_LIMIT = 160;
const BATCH_READ_LIMIT = 100;

export interface OfficeAgentSessionBindingRecord extends OfficeAgentSessionBinding {
  readonly createdAt?: string;
  readonly updatedAt: string;
}

/**
 * Optional caller-captured bearer for panel/runtime reads and mutations.
 * Supplying this authority never falls back to the mutable global auth
 * session: malformed bearer material fails closed before a request is made.
 */
export type OfficeAgentSessionBindingAuthority = Readonly<{
  accessToken: string;
}>;

function bindingAccessToken(
  authority: OfficeAgentSessionBindingAuthority | null | undefined,
): string | null | undefined {
  if (authority == null) return undefined;
  const accessToken = String(authority.accessToken || '').trim();
  return accessToken && accessToken.length <= 16_384 ? accessToken : null;
}

function bindCapturedBearer<T extends { setHeader(name: string, value: string): T }>(
  query: T,
  authority: OfficeAgentSessionBindingAuthority | null | undefined,
): T | null {
  const accessToken = bindingAccessToken(authority);
  if (accessToken === null) return null;
  return accessToken === undefined
    ? query
    : query.setHeader('Authorization', `Bearer ${accessToken}`);
}

export interface OfficeSessionSnapshot {
  readonly connections: readonly AgentConnection[];
  readonly sessionsByConnection: OfficeAgentSessionsByConnection;
  readonly sessionFingerprintsByConnection: Readonly<Record<string, OpenSwanConnectionFingerprint | undefined>>;
}

export type OfficeAgentSessionBindingBatchReadFailureReason =
  | 'invalid_input'
  | 'schema_unavailable'
  | 'transient_transport'
  | 'query_failed'
  | 'invalid_response';

export type OfficeAgentSessionBindingBatchReadResult =
  | {
      readonly ok: true;
      readonly bindings: ReadonlyMap<string, OfficeAgentSessionBindingRecord>;
      readonly requestedOfficeAgentIds: readonly string[];
    }
  | {
      readonly ok: false;
      readonly reason: OfficeAgentSessionBindingBatchReadFailureReason;
      readonly error: string;
      readonly code?: string;
      readonly status?: number;
    };

export type OfficeAgentSessionBindingMutationFailureReason =
  | 'invalid_request'
  | 'authority_retired'
  | 'schema_unavailable'
  | 'request_rejected'
  | 'outcome_unknown'
  | 'invalid_response'
  | 'conflict'
  | 'target_conflict';

export type OfficeAgentSessionBindingMutationResult =
  | Readonly<{
      ok: true;
      receipt: OfficeAgentSessionBindingMutationReceipt;
    }>
  | Readonly<{
      ok: false;
      reason: 'conflict' | 'target_conflict';
      error: string;
      receipt: OfficeAgentSessionBindingMutationReceipt;
    }>
  | Readonly<{
      ok: false;
      reason: Exclude<OfficeAgentSessionBindingMutationFailureReason, 'conflict' | 'target_conflict'>;
      error: string;
    }>;

export type OfficeAgentSessionBindingMutationOptions = Readonly<{
  authority: OfficeConnectionExactAuthority;
  isAuthorityCurrent: OfficeConnectionAuthorityFence;
}>;

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isSessionKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= SESSION_KEY_LIMIT
    && SESSION_KEY_RE.test(value);
}

function isExactTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 64
    && Number.isFinite(Date.parse(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function firstRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) return asRecord(value[0]);
  return asRecord(value);
}

function parseBindingRow(value: unknown): OfficeAgentSessionBindingRecord | null {
  const row = firstRow(value);
  if (!row) return null;
  const id = row.id ?? row.binding_id;
  const officeAgentId = row.office_agent_id ?? row.officeAgentId;
  const agentBotId = row.agent_bot_id ?? row.binding_agent_bot_id ?? row.agentBotId;
  const sessionKey = row.session_key ?? row.binding_session_key ?? row.sessionKey;
  const updatedAt = row.updated_at ?? row.updatedAt;
  if (
    !isUuid(id)
    || !isUuid(officeAgentId)
    || !isUuid(agentBotId)
    || !isSessionKey(sessionKey)
    || !isExactTimestamp(updatedAt)
  ) {
    return null;
  }
  const createdAt = row.created_at ?? row.createdAt;
  if (createdAt != null && !isExactTimestamp(createdAt)) return null;
  return Object.freeze({
    id,
    officeAgentId,
    agentBotId,
    sessionKey,
    ...(typeof createdAt === 'string' ? { createdAt } : {}),
    updatedAt,
  });
}

export function isOfficeAgentSessionBindingSchemaUnavailable(error: unknown): boolean {
  const record = asRecord(error);
  const code = String(record?.code || '');
  const status = Number(record?.status || 0);
  const message = String(record?.message || record?.details || '').toLowerCase();
  return code === '42P01'
    || code === '42883'
    || code === 'PGRST202'
    || code === 'PGRST204'
    || status === 404
    || message.includes('office_agent_session_bindings')
    || message.includes('set_office_agent_session_binding')
    || message.includes('clear_office_agent_session_binding')
    || message.includes('compare_and_set_office_agent_session_binding_v1')
    || message.includes('invoke_agent_v2')
    || message.includes('schema cache')
    || message.includes('could not find the function');
}

/**
 * Narrow pre-execution classifier for the versioned claim fallback. A generic
 * HTTP 404 or table/schema error is not enough to authorize a second RPC.
 */
export function isInvokeAgentV2Unavailable(error: unknown): boolean {
  const record = asRecord(error);
  const code = String(record?.code || '');
  const status = Number(record?.status || 0);
  const message = String(record?.message || record?.details || '').toLowerCase();
  if (code === 'PGRST202' || code === '42883') return true;
  return status === 404
    && message.includes('invoke_agent_v2')
    && (message.includes('schema cache') || message.includes('could not find the function'));
}

function bindingReadFailure(
  error: unknown,
  thrown = false,
): Extract<OfficeAgentSessionBindingBatchReadResult, { ok: false }> {
  const record = asRecord(error);
  const context = asRecord(record?.context);
  const code = String(record?.code || '');
  const rawStatus = Number(record?.status || context?.status || 0);
  const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599
    ? rawStatus
    : undefined;
  const message = String(record?.message || record?.details || '').toLowerCase();
  if (isOfficeAgentSessionBindingSchemaUnavailable(error)) {
    return Object.freeze({
      ok: false,
      reason: 'schema_unavailable',
      error: 'Office session binding storage is unavailable.',
      ...(code ? { code } : {}),
      ...(status ? { status } : {}),
    });
  }
  const transient = thrown
    || (status != null && status >= 500)
    || code === 'PGRST000'
    || code === 'PGRST001'
    || code === 'PGRST002'
    || message.includes('failed to fetch')
    || message.includes('network')
    || message.includes('connection')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('load failed');
  return Object.freeze({
    ok: false,
    reason: transient ? 'transient_transport' : 'query_failed',
    error: transient
      ? 'Office session bindings could not be refreshed because the connection closed.'
      : 'Office session bindings could not be loaded.',
    ...(code ? { code } : {}),
    ...(status ? { status } : {}),
  });
}

/**
 * Read the current owner's visible bindings in one bounded RLS-scoped query.
 *
 * This is a presentation/hydration reader only. Execution continues to use
 * `readOfficeAgentSessionBinding` for one exact fresh authority read. A
 * structured transient failure lets UI callers retain their last verified
 * snapshot without turning a dropped HTTP connection into an apparent
 * unbinding.
 */
export async function readOfficeAgentSessionBindingsBatch(
  officeAgentIds: readonly string[],
  authority?: OfficeAgentSessionBindingAuthority | null,
): Promise<OfficeAgentSessionBindingBatchReadResult> {
  if (!Array.isArray(officeAgentIds)) {
    return Object.freeze({
      ok: false,
      reason: 'invalid_input',
      error: 'Office session binding batch input is invalid.',
    });
  }
  const uniqueIds = Array.from(new Set(officeAgentIds));
  if (
    uniqueIds.length > BATCH_READ_LIMIT
    || uniqueIds.some((officeAgentId) => !isUuid(officeAgentId))
  ) {
    return Object.freeze({
      ok: false,
      reason: 'invalid_input',
      error: 'Office session binding batch input is invalid or too large.',
    });
  }
  const requestedOfficeAgentIds = Object.freeze([...uniqueIds].sort());
  if (requestedOfficeAgentIds.length === 0) {
    return Object.freeze({
      ok: true,
      bindings: new Map<string, OfficeAgentSessionBindingRecord>(),
      requestedOfficeAgentIds,
    });
  }

  try {
    const accessToken = bindingAccessToken(authority);
    if (accessToken === null) {
      return Object.freeze({
        ok: false,
        reason: 'invalid_input',
        error: 'The captured Office session authority is invalid.',
      });
    }
    const client = accessToken === undefined
      ? supabase
      : getSupabaseClientForAccessToken(accessToken);
    const query = client
      .from('office_agent_session_bindings')
      .select('id, office_agent_id, agent_bot_id, session_key, created_at, updated_at')
      .in('office_agent_id', requestedOfficeAgentIds);
    const { data, error } = await query;
    if (error) return bindingReadFailure(error);
    if (!Array.isArray(data) || data.length > requestedOfficeAgentIds.length) {
      return Object.freeze({
        ok: false,
        reason: 'invalid_response',
        error: 'Office session binding storage returned an invalid batch.',
      });
    }

    const requested = new Set(requestedOfficeAgentIds);
    const bindings = new Map<string, OfficeAgentSessionBindingRecord>();
    for (const value of data) {
      const binding = parseBindingRow(value);
      if (!binding || !requested.has(binding.officeAgentId) || bindings.has(binding.officeAgentId)) {
        return Object.freeze({
          ok: false,
          reason: 'invalid_response',
          error: 'Office session binding storage returned an invalid row.',
        });
      }
      bindings.set(binding.officeAgentId, binding);
    }
    return Object.freeze({
      ok: true,
      bindings,
      requestedOfficeAgentIds,
    });
  } catch (error) {
    return bindingReadFailure(error, true);
  }
}

/** Read one owner-scoped binding. Missing schema and missing binding both fail closed. */
export async function readOfficeAgentSessionBinding(
  officeAgentId: string,
  authority?: OfficeAgentSessionBindingAuthority | null,
): Promise<OfficeAgentSessionBindingRecord | null> {
  if (!isUuid(officeAgentId)) return null;
  try {
    const query = bindCapturedBearer(supabase
      .from('office_agent_session_bindings')
      .select('id, office_agent_id, agent_bot_id, session_key, created_at, updated_at')
      .eq('office_agent_id', officeAgentId)
      .maybeSingle(), authority);
    if (!query) return null;
    const { data, error } = await query;
    if (error || !data) return null;
    return parseBindingRow(data);
  } catch {
    return null;
  }
}

function isExpectedBinding(
  value: OfficeAgentSessionBindingRecord | null,
  officeAgentId: string,
): value is OfficeAgentSessionBindingRecord | null {
  return value === null || (
    isUuid(value.id)
    && value.officeAgentId === officeAgentId
    && isUuid(value.agentBotId)
    && isSessionKey(value.sessionKey)
    && isExactTimestamp(value.updatedAt)
  );
}

function normalizeMutationAuthority(
  options: OfficeAgentSessionBindingMutationOptions | null | undefined,
): OfficeConnectionExactAuthority | null {
  const authority = options?.authority;
  if (
    !authority
    || !isUuid(authority.userId)
    || !isUuid(authority.circleId)
    || typeof authority.accessToken !== 'string'
    || !authority.accessToken.trim()
    || authority.accessToken !== authority.accessToken.trim()
    || authority.accessToken.length > 16_384
    || !Number.isSafeInteger(authority.generation)
    || authority.generation <= 0
    || typeof options?.isAuthorityCurrent !== 'function'
  ) return null;
  return authority;
}

function mutationAuthorityIsCurrent(
  authority: OfficeConnectionExactAuthority,
  fence: OfficeConnectionAuthorityFence,
): boolean {
  try {
    return fence(authority) === true;
  } catch {
    return false;
  }
}

function mutationFailureFromError(error: unknown): Exclude<
  OfficeAgentSessionBindingMutationResult,
  { ok: true } | { receipt: OfficeAgentSessionBindingMutationReceipt }
> {
  if (isOfficeAgentSessionBindingSchemaUnavailable(error)) {
    return Object.freeze({
      ok: false,
      reason: 'schema_unavailable',
      error: 'Exact Office session route updates are not installed yet. Apply database section 49, then reload.',
    });
  }
  const record = asRecord(error);
  const code = String(record?.code || '');
  if (code === '22023' || code === '42501') {
    return Object.freeze({
      ok: false,
      reason: 'request_rejected',
      error: 'The database rejected this Office session route update.',
    });
  }
  return Object.freeze({
    ok: false,
    reason: 'outcome_unknown',
    error: 'The Office session route update outcome could not be verified. Refresh before retrying.',
  });
}

async function compareAndSetOfficeAgentSessionBinding(
  request: OfficeAgentSessionBindingMutationRequest,
  options: OfficeAgentSessionBindingMutationOptions,
): Promise<OfficeAgentSessionBindingMutationResult> {
  const authority = normalizeMutationAuthority(options);
  if (
    !authority
    || !isUuid(request.officeAgentId)
    || !isExpectedBinding(request.expectedBinding, request.officeAgentId)
    || (
      request.nextBinding !== null
      && (!isUuid(request.nextBinding.agentBotId) || !isSessionKey(request.nextBinding.sessionKey))
    )
  ) {
    return Object.freeze({
      ok: false,
      reason: 'invalid_request',
      error: 'The exact Office session route request is invalid.',
    });
  }
  if (!mutationAuthorityIsCurrent(authority, options.isAuthorityCurrent)) {
    return Object.freeze({
      ok: false,
      reason: 'authority_retired',
      error: 'The Office session authority changed. Refresh before updating this route.',
    });
  }

  const rpcArgs = {
    p_office_agent_id: request.officeAgentId,
    p_circle_id: authority.circleId,
    p_expected_binding_id: request.expectedBinding?.id ?? null,
    p_expected_agent_bot_id: request.expectedBinding?.agentBotId ?? null,
    p_expected_session_key: request.expectedBinding?.sessionKey ?? null,
    p_expected_updated_at: request.expectedBinding?.updatedAt ?? null,
    p_next_agent_bot_id: request.nextBinding?.agentBotId ?? null,
    p_next_session_key: request.nextBinding?.sessionKey ?? null,
  };

  try {
    const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
    const { data, error } = await exactClient.rpc(
      'compare_and_set_office_agent_session_binding_v1',
      rpcArgs,
    );
    if (!mutationAuthorityIsCurrent(authority, options.isAuthorityCurrent)) {
      return Object.freeze({
        ok: false,
        reason: 'authority_retired',
        error: 'The Office session authority changed while the route was updating. Refresh to verify its current state.',
      });
    }
    if (error) return mutationFailureFromError(error);
    const receipt = parseOfficeAgentSessionBindingMutationReceipt(data, request);
    if (!receipt) {
      return Object.freeze({
        ok: false,
        reason: 'invalid_response',
        error: 'The Office session route update returned an invalid receipt. Refresh before retrying.',
      });
    }
    if (receipt.disposition === 'conflict' || receipt.disposition === 'target_conflict') {
      return Object.freeze({
        ok: false,
        reason: receipt.disposition,
        error: receipt.disposition === 'conflict'
          ? 'This Office session route changed before the update committed.'
          : 'This exact OpenSwan session is already linked to another Office agent.',
        receipt,
      });
    }
    return Object.freeze({ ok: true, receipt });
  } catch {
    return Object.freeze({
      ok: false,
      reason: 'outcome_unknown',
      error: 'The Office session route update outcome could not be verified. Refresh before retrying.',
    });
  }
}

/** Bind or move only if the database row still equals the caller's exact snapshot. */
export async function setOfficeAgentSessionBinding(
  officeAgentId: string,
  agentBotId: string,
  sessionKey: string,
  expectedBinding: OfficeAgentSessionBindingRecord | null,
  options: OfficeAgentSessionBindingMutationOptions,
): Promise<OfficeAgentSessionBindingMutationResult> {
  return compareAndSetOfficeAgentSessionBinding({
    officeAgentId,
    expectedBinding,
    nextBinding: { agentBotId, sessionKey },
  }, options);
}

/** Clear only if the database row still equals the caller's exact snapshot. */
export async function clearOfficeAgentSessionBinding(
  officeAgentId: string,
  expectedBinding: OfficeAgentSessionBindingRecord,
  options: OfficeAgentSessionBindingMutationOptions,
): Promise<OfficeAgentSessionBindingMutationResult> {
  return compareAndSetOfficeAgentSessionBinding({
    officeAgentId,
    expectedBinding,
    nextBinding: null,
  }, options);
}

/** Convert the runtime Map into the exact own-property shape accepted by the core. */
export function buildOfficeSessionSnapshot(
  connections: readonly AgentConnection[],
  sessions: ReadonlyMap<string, readonly unknown[]>,
  sessionFingerprints: ReadonlyMap<string, OpenSwanConnectionFingerprint>,
): OfficeSessionSnapshot {
  const sessionsByConnection: Record<string, Array<{ sessionKey: string }>> = Object.create(null);
  const sessionFingerprintsByConnection: Record<string, OpenSwanConnectionFingerprint> = Object.create(null);
  for (const connection of connections) {
    const rows = sessions.get(connection.id);
    const fingerprint = sessionFingerprints.get(connection.id);
    if (!Array.isArray(rows) || !fingerprint) continue;
    sessionsByConnection[connection.id] = rows.map((row) => {
      const record = asRecord(row);
      return { sessionKey: typeof record?.sessionKey === 'string' ? record.sessionKey : '' };
    });
    sessionFingerprintsByConnection[connection.id] = fingerprint;
  }
  return {
    connections: connections.map((connection) => ({ ...connection })),
    sessionsByConnection,
    sessionFingerprintsByConnection,
  };
}

export function resolveOfficeAgentSessionBinding(
  input: ResolveOfficeAgentSessionBindingInput,
): OfficeAgentSessionBindingResolution {
  return resolveOfficeAgentSessionBindingCore(input);
}
