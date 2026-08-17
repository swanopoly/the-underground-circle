/**
 * Owner-private durable binding between one published Office agent and one
 * exact live OpenSwan session. Public CircleOfficeAgent rows never carry
 * provider session identities or local connection secrets.
 */

import { supabase } from './supabase';
import type { AgentConnection } from './connectionManager';
import {
  resolveOfficeAgentSessionBinding as resolveOfficeAgentSessionBindingCore,
  type OfficeAgentSessionBinding,
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
  readonly updatedAt?: string;
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

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isSessionKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= SESSION_KEY_LIMIT
    && SESSION_KEY_RE.test(value);
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
  if (!isUuid(id) || !isUuid(officeAgentId) || !isUuid(agentBotId) || !isSessionKey(sessionKey)) {
    return null;
  }
  return Object.freeze({
    id,
    officeAgentId,
    agentBotId,
    sessionKey,
    ...(typeof row.created_at === 'string' ? { createdAt: row.created_at } : {}),
    ...(typeof row.updated_at === 'string' ? { updatedAt: row.updated_at } : {}),
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
    const query = bindCapturedBearer(supabase
      .from('office_agent_session_bindings')
      .select('id, office_agent_id, agent_bot_id, session_key, created_at, updated_at')
      .in('office_agent_id', requestedOfficeAgentIds), authority);
    if (!query) {
      return Object.freeze({
        ok: false,
        reason: 'invalid_input',
        error: 'The captured Office session authority is invalid.',
      });
    }
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

/**
 * Bind a published owner-owned OpenSwan agent to an owner-owned private bot
 * plus exact session key. The database RPC performs the authority checks.
 */
export async function setOfficeAgentSessionBinding(
  officeAgentId: string,
  agentBotId: string,
  sessionKey: string,
  authority?: OfficeAgentSessionBindingAuthority | null,
): Promise<OfficeAgentSessionBindingRecord> {
  if (!isUuid(officeAgentId) || !isUuid(agentBotId) || !isSessionKey(sessionKey)) {
    throw new Error('Invalid Office agent session binding.');
  }
  const query = bindCapturedBearer(supabase.rpc('set_office_agent_session_binding', {
    p_office_agent_id: officeAgentId,
    p_agent_bot_id: agentBotId,
    p_session_key: sessionKey,
  }), authority);
  if (!query) throw new Error('The captured Office session authority is invalid.');
  const { data, error } = await query;
  if (error) {
    throw new Error(isOfficeAgentSessionBindingSchemaUnavailable(error)
      ? 'Office session binding is not installed yet. Apply database section 36, then reload.'
      : 'Office session binding could not be saved.');
  }
  const returnedId = isUuid(data)
    ? data
    : (Array.isArray(data) && isUuid(data[0]) ? data[0] : null);
  const binding = returnedId
    ? Object.freeze({
        id: returnedId,
        officeAgentId,
        agentBotId,
        sessionKey,
      })
    : parseBindingRow(data) || await readOfficeAgentSessionBinding(officeAgentId, authority);
  if (!binding) throw new Error('Office session binding could not be verified after saving.');
  return binding;
}

export async function clearOfficeAgentSessionBinding(
  officeAgentId: string,
  authority?: OfficeAgentSessionBindingAuthority | null,
): Promise<boolean> {
  if (!isUuid(officeAgentId)) return false;
  const query = bindCapturedBearer(supabase.rpc('clear_office_agent_session_binding', {
    p_office_agent_id: officeAgentId,
  }), authority);
  if (!query) return false;
  const { data, error } = await query;
  if (error) {
    throw new Error(isOfficeAgentSessionBindingSchemaUnavailable(error)
      ? 'Office session binding is not installed yet. Apply database section 36, then reload.'
      : 'Office session binding could not be cleared.');
  }
  return data === true || (Array.isArray(data) && data[0] === true);
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
