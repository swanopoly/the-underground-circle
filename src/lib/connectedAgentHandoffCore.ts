/**
 * Pure connected-agent handoff contract.
 *
 * A bridge/session acknowledgement proves only that another runtime accepted a
 * task. It never proves the task completed. This module keeps that boundary
 * bounded and portable across Chat persistence, Office run projection, and the
 * provider dispatch adapters without importing React Native or Supabase.
 */

export type ConnectedAgentHandoffStatus = 'accepted' | 'drafted' | 'failed' | 'unknown';

export const CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS = Object.freeze({
  provider: 64,
  actor: 96,
  sessionId: 160,
  providerRunId: 160,
  connectionId: 160,
  message: 1_200,
  task: 1_200,
  threadId: 160,
  title: 180,
} as const);

export interface ConnectedAgentHandoffReceiptInput {
  status?: unknown;
  provider?: unknown;
  actor?: unknown;
  sessionId?: unknown;
  /** Provider-owned lifecycle id. Never confused with the local agent_runs UUID. */
  providerRunId?: unknown;
  /** Only a caller-supplied, canonical UUID is retained. Never synthesized. */
  runId?: unknown;
  message?: unknown;
}

export interface ConnectedAgentHandoffReceipt {
  status: ConnectedAgentHandoffStatus;
  provider: string | null;
  actor: string;
  sessionId: string | null;
  providerRunId: string | null;
  runId: string | null;
  message: string;
  /** Acceptance and draft output are not proof that the delegated task finished. */
  completionVerified: false;
}

/** Compact durable form; the visible message already owns the human copy. */
export type ConnectedAgentHandoffSnapshot = Omit<ConnectedAgentHandoffReceipt, 'message'>;

export type ConnectedAgentAcceptedRunSurface = 'main_chat' | 'office_terminal' | 'feed_task';
export type ConnectedAgentExternalDispatchKind = 'sessions_send' | 'sessions_spawn';

export type ExactOpenSwanConnectionFailureReason =
  | 'invalid_connections'
  | 'invalid_connection_id'
  | 'connection_not_found'
  | 'connection_ambiguous'
  | 'connection_unavailable';

export type ExactOpenSwanConnectionResolution = Readonly<{
  ok: true;
  connectionId: string;
  config: Readonly<{ endpoint: string; token: string }>;
}> | Readonly<{
  ok: false;
  reason: ExactOpenSwanConnectionFailureReason;
}>;

export interface ConnectedAgentAcceptedRunProjectionInput {
  receipt?: unknown;
  task?: unknown;
  threadId?: unknown;
  surface?: unknown;
  externalDispatchKind?: unknown;
  externalConnectionId?: unknown;
}

/** Persistence-safe draft consumed by agentRunSystem.createRun. */
export interface ConnectedAgentAcceptedRunProjection {
  surface: ConnectedAgentAcceptedRunSurface;
  title: string;
  goal: string;
  mode: 'execute';
  provider?: string;
  delegatedTo: string;
  metadata: {
    connectedAgentHandoff: ConnectedAgentHandoffSnapshot;
    handoffStatus: 'accepted';
    completionVerified: false;
    externalLifecycle: 'awaiting_typed_result';
    externalSessionId?: string;
    externalProviderRunId?: string;
    externalDispatchKind?: ConnectedAgentExternalDispatchKind;
    externalConnectionId?: string;
    threadId?: string;
  };
}

const HANDOFF_SAFE_TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const HANDOFF_RUN_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HANDOFF_UNSAFE_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g;
const HANDOFF_HAS_UNSAFE_CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const OPENSWAN_CONNECTION_LIMIT = 256;
const OPENSWAN_ENDPOINT_LIMIT = 2_048;
const OPENSWAN_TOKEN_LIMIT = 4_096;
const OPENSWAN_TOKEN_PLACEHOLDERS = new Set([
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

function readHandoffField(input: object, key: string): unknown {
  try {
    return (input as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function readOwnHandoffField(input: object, key: string): unknown {
  try {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return undefined;
    return (input as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

function clampHandoffText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
}

function normalizeHandoffProvider(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const provider = value.trim().toLowerCase().replace(/\s+/g, '-');
  if (
    !provider
    || provider.length > CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.provider
    || !HANDOFF_SAFE_TOKEN_RE.test(provider)
  ) return null;
  return provider;
}

function normalizeHandoffActor(value: unknown): string {
  if (typeof value !== 'string') return '';
  const actor = value
    .replace(HANDOFF_UNSAFE_CONTROL_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clampHandoffText(actor, CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.actor);
}

function normalizeHandoffToken(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string') return null;
  const token = value.trim();
  if (!token || token.length > maxChars || !HANDOFF_SAFE_TOKEN_RE.test(token)) return null;
  return token;
}

function normalizeHandoffSessionId(value: unknown): string | null {
  return normalizeHandoffToken(value, CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.sessionId);
}

function isExactOpenSwanConnectionId(value: unknown): value is string {
  return typeof value === 'string'
    && value === value.trim()
    && value.length > 0
    && value.length <= CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.connectionId
    && HANDOFF_SAFE_TOKEN_RE.test(value);
}

function readUsableOpenSwanEndpoint(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || value.length === 0
    || value.length > OPENSWAN_ENDPOINT_LIMIT
    || HANDOFF_HAS_UNSAFE_CONTROL_RE.test(value)
  ) return null;
  try {
    const endpoint = new URL(value);
    if (
      (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:')
      || !endpoint.hostname
      || endpoint.username
      || endpoint.password
    ) return null;
    return value;
  } catch {
    return null;
  }
}

function readUsableOpenSwanToken(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value !== value.trim()
    || value.length === 0
    || value.length > OPENSWAN_TOKEN_LIMIT
    || HANDOFF_HAS_UNSAFE_CONTROL_RE.test(value)
    || OPENSWAN_TOKEN_PLACEHOLDERS.has(value.toLowerCase())
  ) return null;
  return value;
}

type ExactOpenSwanConnectionCandidate = Readonly<{
  connectionId: string;
  endpoint: string;
  token: string;
}>;

function readExactOpenSwanConnectionCandidate(value: unknown): ExactOpenSwanConnectionCandidate | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const connectionId = readOwnHandoffField(value, 'id');
  if (!isExactOpenSwanConnectionId(connectionId)) return null;
  if (readOwnHandoffField(value, 'provider') !== 'openswan') return null;
  if (readOwnHandoffField(value, 'enabled') !== true) return null;
  if (readOwnHandoffField(value, 'status') !== 'connected') return null;
  const endpoint = readUsableOpenSwanEndpoint(readOwnHandoffField(value, 'endpoint'));
  const token = readUsableOpenSwanToken(readOwnHandoffField(value, 'token'));
  if (!endpoint || !token) return null;
  return Object.freeze({ connectionId, endpoint, token });
}

/**
 * Resolve Chat's OpenSwan transport without a first-connection fallback.
 * A live-session target must retain its exact local connection id. A target
 * without one may use a connection only when exactly one eligible runtime is
 * present, so multiple bridges can never be silently conflated.
 */
export function resolveExactOpenSwanConnection(
  connections?: unknown,
  requestedConnectionId?: unknown,
): ExactOpenSwanConnectionResolution {
  const fail = (reason: ExactOpenSwanConnectionFailureReason): ExactOpenSwanConnectionResolution => (
    Object.freeze({ ok: false as const, reason })
  );
  try {
    if (!Array.isArray(connections) || connections.length > OPENSWAN_CONNECTION_LIMIT) {
      return fail('invalid_connections');
    }
    const hasRequestedId = requestedConnectionId !== undefined && requestedConnectionId !== null;
    if (hasRequestedId && !isExactOpenSwanConnectionId(requestedConnectionId)) {
      return fail('invalid_connection_id');
    }

    const exactRows = hasRequestedId
      ? connections.filter((connection) => (
          connection !== null
          && typeof connection === 'object'
          && !Array.isArray(connection)
          && readOwnHandoffField(connection, 'id') === requestedConnectionId
        ))
      : connections;
    if (hasRequestedId && exactRows.length === 0) return fail('connection_not_found');
    if (hasRequestedId && exactRows.length !== 1) return fail('connection_ambiguous');

    const eligible = exactRows
      .map(readExactOpenSwanConnectionCandidate)
      .filter((candidate): candidate is ExactOpenSwanConnectionCandidate => candidate !== null);
    if (hasRequestedId && eligible.length === 0) return fail('connection_unavailable');
    if (!hasRequestedId && eligible.length === 0) return fail('connection_not_found');
    if (eligible.length !== 1) return fail('connection_ambiguous');

    const selected = eligible[0];
    if (!hasRequestedId) {
      const rowsWithSelectedId = connections.filter((connection) => (
        connection !== null
        && typeof connection === 'object'
        && !Array.isArray(connection)
        && readOwnHandoffField(connection, 'id') === selected.connectionId
      ));
      if (rowsWithSelectedId.length !== 1) return fail('connection_ambiguous');
    }

    const config = Object.freeze({ endpoint: selected.endpoint, token: selected.token });
    return Object.freeze({
      ok: true as const,
      connectionId: selected.connectionId,
      config,
    });
  } catch {
    return fail('invalid_connections');
  }
}

function normalizeHandoffRunId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const runId = value.trim();
  return HANDOFF_RUN_UUID_RE.test(runId) ? runId.toLowerCase() : null;
}

function normalizeHandoffMessage(value: unknown, fallback: string, maxChars = CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.message): string {
  if (typeof value !== 'string') return fallback;
  const message = value
    .replace(/\r\n?/g, '\n')
    .replace(HANDOFF_UNSAFE_CONTROL_RE, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trimEnd())
    .join('\n')
    .trim();
  return message ? clampHandoffText(message, maxChars) : fallback;
}

/**
 * Build a bounded, persistence-safe receipt for a connected-agent handoff.
 * Unknown statuses fail closed to `failed`; run ids are never inferred.
 */
export function buildConnectedAgentHandoffReceipt(input?: unknown): ConnectedAgentHandoffReceipt {
  const source = input && typeof input === 'object' ? input : null;
  const rawStatus = source ? readHandoffField(source, 'status') : undefined;
  const status: ConnectedAgentHandoffStatus = rawStatus === 'accepted'
    || rawStatus === 'drafted'
    || rawStatus === 'failed'
    || rawStatus === 'unknown'
    ? rawStatus
    : 'failed';
  const provider = normalizeHandoffProvider(source ? readHandoffField(source, 'provider') : undefined);
  const actor = normalizeHandoffActor(source ? readHandoffField(source, 'actor') : undefined)
    || provider
    || 'Connected agent';
  const defaultMessage = status === 'accepted'
    ? `Task accepted by ${actor}.`
    : status === 'drafted'
      ? `${actor} returned a draft.`
      : status === 'unknown'
        ? `The dispatch outcome for ${actor} is unknown.`
      : 'The connected-agent handoff failed.';

  return {
    status,
    provider,
    actor,
    sessionId: normalizeHandoffSessionId(source ? readHandoffField(source, 'sessionId') : undefined),
    providerRunId: normalizeHandoffToken(
      source ? readHandoffField(source, 'providerRunId') : undefined,
      CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.providerRunId,
    ),
    runId: normalizeHandoffRunId(source ? readHandoffField(source, 'runId') : undefined),
    message: normalizeHandoffMessage(source ? readHandoffField(source, 'message') : undefined, defaultMessage),
    completionVerified: false,
  };
}

/** Strict reader for untrusted persisted metadata. Invalid shapes disappear. */
export function readConnectedAgentHandoffReceipt(input?: unknown): ConnectedAgentHandoffReceipt | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const rawStatus = readHandoffField(input, 'status');
  if (
    rawStatus !== 'accepted'
    && rawStatus !== 'drafted'
    && rawStatus !== 'failed'
    && rawStatus !== 'unknown'
  ) return null;
  if (readHandoffField(input, 'completionVerified') !== false) return null;
  const actor = normalizeHandoffActor(readHandoffField(input, 'actor'));
  if (!actor) return null;
  return buildConnectedAgentHandoffReceipt({
    status: rawStatus,
    provider: readHandoffField(input, 'provider'),
    actor,
    sessionId: readHandoffField(input, 'sessionId'),
    providerRunId: readHandoffField(input, 'providerRunId'),
    runId: readHandoffField(input, 'runId'),
    message: readHandoffField(input, 'message'),
  });
}

/** Strip visible response copy before a receipt enters durable metadata. */
export function projectConnectedAgentHandoffSnapshot(input?: unknown): ConnectedAgentHandoffSnapshot | null {
  const receipt = readConnectedAgentHandoffReceipt(input);
  if (!receipt) return null;
  return {
    status: receipt.status,
    provider: receipt.provider,
    actor: receipt.actor,
    sessionId: receipt.sessionId,
    providerRunId: receipt.providerRunId,
    runId: receipt.runId,
    completionVerified: false,
  };
}

/**
 * Project an accepted receipt into a canonical queued-run draft. Drafted and
 * failed handoffs produce no run; an already-linked receipt also produces no
 * second run. The external session id remains metadata and can never become the
 * UUID run identity.
 */
export function buildConnectedAgentAcceptedRunProjection(
  input?: unknown,
): ConnectedAgentAcceptedRunProjection | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const receipt = readConnectedAgentHandoffReceipt(readHandoffField(input, 'receipt'));
  if (!receipt || receipt.status !== 'accepted' || receipt.runId !== null) return null;
  const snapshot = projectConnectedAgentHandoffSnapshot(receipt);
  if (!snapshot) return null;

  const task = normalizeHandoffMessage(
    readHandoffField(input, 'task'),
    'Connected-agent task',
    CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.task,
  );
  const threadId = normalizeHandoffToken(
    readHandoffField(input, 'threadId'),
    CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.threadId,
  );
  const rawSurface = readHandoffField(input, 'surface');
  const surface: ConnectedAgentAcceptedRunSurface | null = rawSurface === undefined || rawSurface === null
    ? 'main_chat'
    : rawSurface === 'main_chat' || rawSurface === 'office_terminal' || rawSurface === 'feed_task'
      ? rawSurface
      : null;
  if (!surface) return null;
  const rawDispatchKind = readHandoffField(input, 'externalDispatchKind');
  const externalDispatchKind: ConnectedAgentExternalDispatchKind | null = rawDispatchKind === 'sessions_send'
    || rawDispatchKind === 'sessions_spawn'
    ? rawDispatchKind
    : null;
  const externalConnectionId = normalizeHandoffToken(
    readHandoffField(input, 'externalConnectionId'),
    CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.connectionId,
  );
  const title = clampHandoffText(
    `Delegated to ${receipt.actor}: ${task.split('\n')[0] || 'Task'}`,
    CONNECTED_AGENT_HANDOFF_RECEIPT_LIMITS.title,
  );

  return {
    surface,
    title,
    goal: task,
    mode: 'execute',
    ...(receipt.provider ? { provider: receipt.provider } : {}),
    delegatedTo: receipt.actor,
    metadata: {
      connectedAgentHandoff: snapshot,
      handoffStatus: 'accepted',
      completionVerified: false,
      externalLifecycle: 'awaiting_typed_result',
      ...(receipt.sessionId ? { externalSessionId: receipt.sessionId } : {}),
      ...(receipt.providerRunId ? { externalProviderRunId: receipt.providerRunId } : {}),
      ...(externalDispatchKind ? { externalDispatchKind } : {}),
      ...(externalConnectionId ? { externalConnectionId } : {}),
      ...(threadId ? { threadId } : {}),
    },
  };
}
