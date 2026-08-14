/**
 * Pure resolver for an owner-private Office agent -> OpenSwan session binding.
 *
 * The binding's database identities, the local connection identity, and the
 * provider session identity remain separate. Resolution is deliberately exact:
 * it never falls back to an agent name, provider, another connection, or a
 * similarly named/cased session.
 */

export const OFFICE_AGENT_SESSION_BINDING_LIMITS = Object.freeze({
  connectionId: 160,
  sessionKey: 160,
  endpoint: 2_048,
  token: 4_096,
  connections: 256,
  sessionsPerConnection: 512,
} as const);

export interface OfficeAgentSessionBinding {
  readonly id: string;
  readonly officeAgentId: string;
  readonly agentBotId: string;
  readonly sessionKey: string;
}

export interface OfficeAgentBindingLocalConnection {
  readonly id: string;
  readonly remoteId: string;
  readonly provider: string;
  readonly status: string;
  readonly enabled: boolean;
  readonly endpoint: string;
  readonly token: string;
}

export interface OfficeAgentBindingSession {
  readonly sessionKey: string;
}

/**
 * Non-secret identity captured alongside a structured OpenSwan session list.
 * It prevents a session list loaded from one bridge from being reused after a
 * connection row is replaced in place with the same local id.
 */
export interface OpenSwanConnectionFingerprint {
  readonly connectionId: string;
  readonly agentBotId: string | null;
  readonly normalizedEndpoint: string;
}

export type OfficeAgentSessionsByConnection = Readonly<
  Record<string, readonly OfficeAgentBindingSession[] | undefined>
>;

export interface ResolveOfficeAgentSessionBindingInput {
  /** Exact Office row UUID selected by the caller. */
  readonly officeAgentId?: unknown;
  /** Owner-scoped canonical binding row read from durable storage. */
  readonly binding?: unknown;
  /** Current local connection inventory, including hydrated local secrets. */
  readonly connections?: unknown;
  /** Current structured sessions keyed only by local connection id. */
  readonly sessionsByConnection?: unknown;
  /** Non-secret identity captured when each structured session list arrived. */
  readonly sessionFingerprintsByConnection?: unknown;
}

export type OfficeAgentSessionBindingFailureReason =
  | 'invalid_input'
  | 'invalid_office_agent_id'
  | 'invalid_binding_id'
  | 'invalid_binding_office_agent_id'
  | 'invalid_binding_agent_bot_id'
  | 'invalid_binding_session_key'
  | 'binding_office_agent_mismatch'
  | 'invalid_connections'
  | 'connection_not_found'
  | 'connection_ambiguous'
  | 'invalid_connection_id'
  | 'connection_provider_mismatch'
  | 'connection_disabled'
  | 'connection_not_connected'
  | 'connection_endpoint_invalid'
  | 'connection_token_missing'
  | 'invalid_session_fingerprints'
  | 'session_connection_fingerprint_not_found'
  | 'session_connection_stale'
  | 'invalid_sessions_by_connection'
  | 'session_list_not_found'
  | 'session_list_invalid'
  | 'session_not_found'
  | 'session_ambiguous';

export interface ResolvedOfficeAgentSessionTarget {
  readonly bindingId: string;
  readonly officeAgentId: string;
  readonly agentBotId: string;
  readonly connectionId: string;
  readonly provider: 'openswan';
  readonly sessionKey: string;
  /** Exact legacy Office runtime target: local connection id + provider session. */
  readonly compositeAgentId: string;
  /** Ephemeral dispatch config. Callers must never persist the token. */
  readonly config: Readonly<{
    endpoint: string;
    token: string;
  }>;
}

export type OfficeAgentSessionBindingResolution =
  | Readonly<{
    ok: true;
    target: ResolvedOfficeAgentSessionTarget;
  }>
  | Readonly<{
    ok: false;
    reason: OfficeAgentSessionBindingFailureReason;
  }>;

const EXACT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXACT_CONNECTION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const EXACT_SESSION_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const UNSAFE_CONTROL_RE = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const TOKEN_PLACEHOLDERS = new Set([
  '***',
  '__local_secret__',
  '[redacted]',
  '<redacted>',
  'redacted',
  'placeholder',
  'none',
  'null',
  'undefined',
  'your-token-here',
  'changeme',
]);

const READ_FAILED = Symbol('office-agent-binding-read-failed');

function fail(
  reason: OfficeAgentSessionBindingFailureReason,
): OfficeAgentSessionBindingResolution {
  return Object.freeze({ ok: false as const, reason });
}

function readField(source: object, key: string): unknown | typeof READ_FAILED {
  try {
    if (!Object.prototype.hasOwnProperty.call(source, key)) return undefined;
    return (source as Record<string, unknown>)[key];
  } catch {
    return READ_FAILED;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isExactUuid(value: unknown): value is string {
  return typeof value === 'string' && EXACT_UUID_RE.test(value);
}

function isExactConnectionId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= OFFICE_AGENT_SESSION_BINDING_LIMITS.connectionId
    && EXACT_CONNECTION_ID_RE.test(value);
}

function isExactSessionKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= OFFICE_AGENT_SESSION_BINDING_LIMITS.sessionKey
    && EXACT_SESSION_KEY_RE.test(value);
}

function isUsableEndpoint(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || value.length === 0
    || value.length > OFFICE_AGENT_SESSION_BINDING_LIMITS.endpoint
    || UNSAFE_CONTROL_RE.test(value)
  ) return false;

  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && parsed.hostname.length > 0
      && parsed.username.length === 0
      && parsed.password.length === 0;
  } catch {
    return false;
  }
}

function normalizeUsableEndpoint(value: unknown): string | null {
  if (!isUsableEndpoint(value)) return null;
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

function isRealToken(value: unknown): value is string {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || value.length === 0
    || value.length > OFFICE_AGENT_SESSION_BINDING_LIMITS.token
    || UNSAFE_CONTROL_RE.test(value)
  ) return false;
  return !TOKEN_PLACEHOLDERS.has(value.toLowerCase());
}

function readOwnSessionList(
  sessionsByConnection: Record<string, unknown>,
  connectionId: string,
): unknown | typeof READ_FAILED {
  try {
    if (!Object.prototype.hasOwnProperty.call(sessionsByConnection, connectionId)) {
      return undefined;
    }
    return sessionsByConnection[connectionId];
  } catch {
    return READ_FAILED;
  }
}

function resolveOfficeAgentSessionBindingInternal(
  input: ResolveOfficeAgentSessionBindingInput,
): OfficeAgentSessionBindingResolution {
  const officeAgentId = input.officeAgentId;
  if (!isExactUuid(officeAgentId)) return fail('invalid_office_agent_id');

  const binding = input.binding;
  if (!isRecord(binding)) return fail('invalid_binding_id');

  const bindingId = readField(binding, 'id');
  if (!isExactUuid(bindingId)) return fail('invalid_binding_id');

  const boundOfficeAgentId = readField(binding, 'officeAgentId');
  if (!isExactUuid(boundOfficeAgentId)) return fail('invalid_binding_office_agent_id');

  const agentBotId = readField(binding, 'agentBotId');
  if (!isExactUuid(agentBotId)) return fail('invalid_binding_agent_bot_id');

  const sessionKey = readField(binding, 'sessionKey');
  if (!isExactSessionKey(sessionKey)) return fail('invalid_binding_session_key');

  if (boundOfficeAgentId !== officeAgentId) {
    return fail('binding_office_agent_mismatch');
  }

  const connections = input.connections;
  if (
    !Array.isArray(connections)
    || connections.length > OFFICE_AGENT_SESSION_BINDING_LIMITS.connections
  ) return fail('invalid_connections');

  const localConnectionIds = new Set<string>();
  for (let index = 0; index < connections.length; index += 1) {
    const connection = connections[index];
    if (!isRecord(connection)) return fail('invalid_connections');
    const candidateId = readField(connection, 'id');
    if (candidateId === READ_FAILED) return fail('invalid_connections');
    if (!isExactConnectionId(candidateId)) continue;
    if (localConnectionIds.has(candidateId)) return fail('connection_ambiguous');
    localConnectionIds.add(candidateId);
  }

  const candidates: Record<string, unknown>[] = [];
  for (let index = 0; index < connections.length; index += 1) {
    const connection = connections[index];
    if (!isRecord(connection)) return fail('invalid_connections');
    const remoteId = readField(connection, 'remoteId');
    if (remoteId === READ_FAILED) return fail('invalid_connections');
    if (remoteId === agentBotId) candidates.push(connection);
  }

  if (candidates.length === 0) return fail('connection_not_found');
  if (candidates.length !== 1) return fail('connection_ambiguous');

  const connection = candidates[0];
  const connectionId = readField(connection, 'id');
  if (!isExactConnectionId(connectionId)) return fail('invalid_connection_id');

  if (readField(connection, 'provider') !== 'openswan') {
    return fail('connection_provider_mismatch');
  }
  if (readField(connection, 'enabled') !== true) return fail('connection_disabled');
  if (readField(connection, 'status') !== 'connected') {
    return fail('connection_not_connected');
  }

  const endpoint = readField(connection, 'endpoint');
  if (!isUsableEndpoint(endpoint)) return fail('connection_endpoint_invalid');

  const token = readField(connection, 'token');
  if (!isRealToken(token)) return fail('connection_token_missing');

  const sessionFingerprintsByConnection = input.sessionFingerprintsByConnection;
  if (!isRecord(sessionFingerprintsByConnection)) return fail('invalid_session_fingerprints');
  const sessionFingerprint = readOwnSessionList(sessionFingerprintsByConnection, connectionId);
  if (sessionFingerprint === READ_FAILED) return fail('invalid_session_fingerprints');
  if (sessionFingerprint === undefined) return fail('session_connection_fingerprint_not_found');
  if (!matchesOpenSwanConnectionFingerprint(sessionFingerprint, connection)) {
    return fail('session_connection_stale');
  }

  const sessionsByConnection = input.sessionsByConnection;
  if (!isRecord(sessionsByConnection)) return fail('invalid_sessions_by_connection');

  const sessions = readOwnSessionList(sessionsByConnection, connectionId);
  if (sessions === READ_FAILED) return fail('invalid_sessions_by_connection');
  if (sessions === undefined) return fail('session_list_not_found');
  if (
    !Array.isArray(sessions)
    || sessions.length > OFFICE_AGENT_SESSION_BINDING_LIMITS.sessionsPerConnection
  ) return fail('session_list_invalid');

  let matches = 0;
  for (let index = 0; index < sessions.length; index += 1) {
    const session = sessions[index];
    if (!isRecord(session)) return fail('session_list_invalid');
    const candidateKey = readField(session, 'sessionKey');
    if (!isExactSessionKey(candidateKey)) return fail('session_list_invalid');
    if (candidateKey === sessionKey) matches += 1;
  }

  if (matches === 0) return fail('session_not_found');
  if (matches !== 1) return fail('session_ambiguous');

  const config = Object.freeze({ endpoint, token });
  const target: ResolvedOfficeAgentSessionTarget = Object.freeze({
    bindingId,
    officeAgentId,
    agentBotId,
    connectionId,
    provider: 'openswan' as const,
    sessionKey,
    compositeAgentId: `${connectionId}::${sessionKey}`,
    config,
  });
  return Object.freeze({ ok: true as const, target });
}

/**
 * Resolve one canonical Office binding without I/O, mutation, inference, or
 * fallback. Malformed and hostile inputs always return a typed failure.
 */
export function resolveOfficeAgentSessionBinding(
  input?: unknown,
): OfficeAgentSessionBindingResolution {
  try {
    if (!isRecord(input)) return fail('invalid_input');
    return resolveOfficeAgentSessionBindingInternal(
      input as unknown as ResolveOfficeAgentSessionBindingInput,
    );
  } catch {
    return fail('invalid_input');
  }
}

/**
 * Capture the exact non-secret connection identity that produced a session
 * inventory. A missing remote bot id is allowed for an unpublished local
 * cockpit, but any present id must be a canonical UUID.
 */
export function buildOpenSwanConnectionFingerprint(
  connection?: unknown,
): Readonly<OpenSwanConnectionFingerprint> | null {
  try {
    if (!isRecord(connection)) return null;

    const connectionId = readField(connection, 'id');
    if (!isExactConnectionId(connectionId)) return null;
    if (readField(connection, 'provider') !== 'openswan') return null;

    const rawAgentBotId = readField(connection, 'remoteId');
    const agentBotId = rawAgentBotId === undefined || rawAgentBotId === null || rawAgentBotId === ''
      ? null
      : isExactUuid(rawAgentBotId)
        ? rawAgentBotId
        : READ_FAILED;
    if (agentBotId === READ_FAILED) return null;

    const normalizedEndpoint = normalizeUsableEndpoint(readField(connection, 'endpoint'));
    if (!normalizedEndpoint) return null;

    return Object.freeze({
      connectionId,
      agentBotId,
      normalizedEndpoint,
    });
  } catch {
    return null;
  }
}

/** Match all captured bridge identity fields; local id equality alone is insufficient. */
export function matchesOpenSwanConnectionFingerprint(
  fingerprint: unknown,
  connection: unknown,
): boolean {
  try {
    if (!isRecord(fingerprint)) return false;
    const candidate = buildOpenSwanConnectionFingerprint(connection);
    if (!candidate) return false;
    return readField(fingerprint, 'connectionId') === candidate.connectionId
      && readField(fingerprint, 'agentBotId') === candidate.agentBotId
      && readField(fingerprint, 'normalizedEndpoint') === candidate.normalizedEndpoint;
  } catch {
    return false;
  }
}
