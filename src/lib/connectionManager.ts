import { storage } from './storage';
import { safeGetUserForAccessToken } from './authSession';
import { getSupabaseClientForAccessToken, supabase } from './supabase';
import { Platform } from 'react-native';
import {
  deleteLocalSecret,
  deleteVerifiedLocalSecret,
  readLocalSecret,
  readVerifiedLocalSecret,
  writeLocalSecret,
  writeVerifiedLocalSecret,
} from './localSecrets';
import { getBridgeUrl } from './bridgeEnvironment';

export type ProviderType =
  | 'openswan' | 'claude-code' | 'generic-agent' | 'codex' | 'gemini' | 'cursor' | 'opencode'
  | 'aider' | 'cline' | 'windsurf' | 'copilot' | 'continue' | 'amp' | 'blackswan-local'
  | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'ollama' | 'replicate' | 'figma' | 'zai' | 'minimax'
  | 'github-models' | 'huggingface';

export interface AgentConnection {
  id: string;
  name: string;
  provider: ProviderType;
  endpoint: string;
  token: string;
  enabled: boolean;
  status: 'connected' | 'connecting' | 'disconnected' | 'error';
  error?: string;
  lastConnected?: string;
  sessionCount?: number;
  agentIds?: string[];
  color: string;
  /** Supabase row id (UUID) — set after first cloud sync */
  remoteId?: string;
}

export const PROVIDER_META: Record<ProviderType, { icon: string; label: string; color: string; defaultEndpoint: string; isLLM?: boolean }> = {
  // ── Local agents / bridges ──
  'openswan':       { icon: '🐾', label: 'OpenSwan',       color: '#6366f1', defaultEndpoint: 'http://localhost:18789' },
  'claude-code':    { icon: '🤖', label: 'Claude Code',    color: '#f59e0b', defaultEndpoint: 'http://localhost:8080' },
  'generic-agent':  { icon: '⚡', label: 'Generic Agent',  color: '#10b981', defaultEndpoint: 'https://' },
  'cursor':         { icon: '🎯', label: 'Cursor',         color: '#8b5cf6', defaultEndpoint: 'http://localhost:2087' },
  'opencode':       { icon: 'OC', label: 'OpenCode',       color: '#38bdf8', defaultEndpoint: 'https://' },
  'aider':          { icon: 'AI', label: 'Aider',          color: '#f97316', defaultEndpoint: 'https://' },
  'cline':          { icon: 'CL', label: 'Cline',          color: '#ec4899', defaultEndpoint: 'https://' },
  'windsurf':       { icon: 'WS', label: 'Windsurf',       color: '#06b6d4', defaultEndpoint: 'https://' },
  'copilot':        { icon: 'CP', label: 'Copilot',        color: '#1f6feb', defaultEndpoint: 'https://' },
  'continue':       { icon: 'CN', label: 'Continue',       color: '#22c55e', defaultEndpoint: 'https://' },
  'amp':            { icon: 'AM', label: 'Amp',            color: '#a78bfa', defaultEndpoint: 'https://' },
  'blackswan-local':{ icon: '🦢', label: 'BlackSwan LLM',  color: '#6366f1', defaultEndpoint: 'http://localhost:7779' },
  // ── BYO LLM API providers ──
  'openai':         { icon: '🟢', label: 'OpenAI',         color: '#10a37f', defaultEndpoint: 'https://api.openai.com/v1',      isLLM: true },
  'anthropic':      { icon: '🟠', label: 'Anthropic',      color: '#d97706', defaultEndpoint: 'https://api.anthropic.com/v1',   isLLM: true },
  'openrouter':     { icon: '🔀', label: 'OpenRouter',     color: '#6d28d9', defaultEndpoint: 'https://openrouter.ai/api/v1',   isLLM: true },
  'groq':           { icon: '⚡', label: 'Groq',           color: '#f97316', defaultEndpoint: 'https://api.groq.com/openai/v1', isLLM: true },
  'ollama':         { icon: '🦙', label: 'Ollama',         color: '#0ea5e9', defaultEndpoint: 'http://localhost:11434',          isLLM: true },
  'codex':          { icon: '🧠', label: 'OpenAI Codex',   color: '#10a37f', defaultEndpoint: 'https://api.openai.com/v1',      isLLM: true },
  'gemini':         { icon: '♊', label: 'Google Gemini',   color: '#4285f4', defaultEndpoint: 'http://localhost:7780' },
  // ── Creative tools ──
  'replicate':      { icon: '🎨', label: 'Replicate',      color: '#ec4899', defaultEndpoint: 'https://api.replicate.com/v1',   isLLM: true },
  'zai':            { icon: '🧩', label: 'z.ai',           color: '#6366f1', defaultEndpoint: 'https://api.z.ai/api/paas/v4',   isLLM: true },
  'minimax':        { icon: '🧬', label: 'MiniMax',        color: '#fb7185', defaultEndpoint: 'https://api.minimax.io/v1',      isLLM: true },
  'figma':          { icon: '🎨', label: 'Figma',          color: '#a259ff', defaultEndpoint: 'https://api.figma.com' },
  'github-models':  { icon: '🐙', label: 'GitHub Models',  color: '#6e40c9', defaultEndpoint: 'https://models.github.ai/inference', isLLM: true },
  'huggingface':    { icon: '🤗', label: 'Hugging Face',   color: '#ffbd45', defaultEndpoint: 'https://router.huggingface.co/v1',    isLLM: true },
};

const STORAGE_KEY = '@office_connections';
const EXACT_STORAGE_KEY_PREFIX = '@office_connections_v2';
const EXACT_SECRET_NAMESPACE = 'office_connection_v2';
const EXACT_STORAGE_SCHEMA_VERSION = 2;
const LEGACY_PROVIDER = `open${'claw'}`;
const SECRET_PLACEHOLDER = '__local_secret__';
const MAX_EXACT_CONNECTIONS = 500;
const MAX_EXACT_SCOPE_PART_LENGTH = 200;
const MAX_EXACT_TOKEN_LENGTH = 16_384;
const MAX_EXACT_METADATA_BYTES = 2 * 1024 * 1024;
const exactSaveTails = new Map<string, Promise<void>>();

export type OfficeConnectionExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

type NormalizedOfficeConnectionExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type OfficeConnectionAuthorityFence = (
  authority: OfficeConnectionExactAuthority,
) => boolean;

export type OfficeConnectionExactError =
  | 'invalid_authority'
  | 'authority_mismatch'
  | 'authority_retired'
  | 'invalid_local_data'
  | 'invalid_remote_data'
  | 'invalid_connections'
  | 'secret_unavailable'
  | 'local_write_failed'
  | 'remote_unavailable';

export type OfficeConnectionSecretWriteFailure = Readonly<{
  connectionId: string;
  operation: 'write' | 'delete';
  reason: OfficeConnectionExactError;
}>;

export type OfficeConnectionExactLoadResult = Readonly<{
  ok: boolean;
  connections: AgentConnection[];
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  localLoaded: boolean;
  remoteLoaded: boolean;
  missingSecretCount: number;
  error?: OfficeConnectionExactError;
}>;

export type OfficeConnectionExactSaveResult = Readonly<{
  ok: boolean;
  connections: AgentConnection[];
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  localSaved: boolean;
  remoteSaved: boolean;
  secretFailures: OfficeConnectionSecretWriteFailure[];
  error?: OfficeConnectionExactError;
}>;

type OfficeConnectionExactEnvelope = Readonly<{
  schemaVersion: typeof EXACT_STORAGE_SCHEMA_VERSION;
  userId: string;
  circleId: string;
  connections: AgentConnection[];
}>;

function normalizeProvider(provider: string | null | undefined): ProviderType {
  if (provider === LEGACY_PROVIDER) return 'openswan';
  return (provider as ProviderType) || 'generic-agent';
}

function normalizeExactScopePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_EXACT_SCOPE_PART_LENGTH) return null;
  return normalized;
}

function normalizeOfficeConnectionExactAuthority(
  input: OfficeConnectionExactAuthority | null | undefined,
): NormalizedOfficeConnectionExactAuthority | null {
  if (!input || typeof input !== 'object') return null;
  const userId = normalizeExactScopePart(input.userId);
  const circleId = normalizeExactScopePart(input.circleId);
  const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
  const generation = input.generation;
  if (
    !userId
    || !circleId
    || !accessToken
    || accessToken.length > MAX_EXACT_TOKEN_LENGTH
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return { userId, circleId, accessToken, generation };
}

function isExactAuthorityCurrent(
  authority: NormalizedOfficeConnectionExactAuthority,
  fence: OfficeConnectionAuthorityFence,
): boolean {
  try {
    return fence(authority);
  } catch {
    return false;
  }
}

/** Exact user/circle metadata key. Bearer material and generation never enter storage keys. */
export function officeConnectionExactStorageKey(
  authority: OfficeConnectionExactAuthority | null | undefined,
): string | null {
  const normalized = normalizeOfficeConnectionExactAuthority(authority);
  if (!normalized) return null;
  return `${EXACT_STORAGE_KEY_PREFIX}:user:${encodeURIComponent(normalized.userId)}:circle:${encodeURIComponent(normalized.circleId)}`;
}

/** Exact protected-secret identifier for one connection in one user/circle lane. */
export function officeConnectionExactSecretId(
  authority: OfficeConnectionExactAuthority | null | undefined,
  connectionId: string,
): string | null {
  const normalized = normalizeOfficeConnectionExactAuthority(authority);
  const normalizedConnectionId = normalizeExactScopePart(connectionId);
  if (!normalized || !normalizedConnectionId) return null;
  return [normalized.userId, normalized.circleId, normalizedConnectionId]
    .map(part => encodeURIComponent(part))
    .join(':');
}

function sanitizeExactConnection(
  value: unknown,
  allowToken: boolean,
): AgentConnection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<AgentConnection>;
  const id = normalizeExactScopePart(raw.id);
  const name = normalizeExactScopePart(raw.name);
  const provider = typeof raw.provider === 'string' && Object.prototype.hasOwnProperty.call(PROVIDER_META, raw.provider)
    ? raw.provider as ProviderType
    : null;
  const endpoint = typeof raw.endpoint === 'string' ? raw.endpoint.trim() : '';
  const token = typeof raw.token === 'string' ? raw.token : '';
  if (
    !id
    || !name
    || !provider
    || !endpoint
    || endpoint.length > 2_048
    || !isSafeExactConnectionEndpoint(endpoint)
    || typeof raw.enabled !== 'boolean'
    || (!allowToken && token !== '')
    || token.length > MAX_EXACT_TOKEN_LENGTH
  ) return null;
  const remoteId = raw.remoteId === undefined
    ? undefined
    : normalizeExactScopePart(raw.remoteId);
  if (raw.remoteId !== undefined && !remoteId) return null;
  const color = typeof raw.color === 'string' && raw.color.trim() && raw.color.length <= 100
    ? raw.color.trim()
    : PROVIDER_META[provider].color;
  const lastConnected = typeof raw.lastConnected === 'string' && Number.isFinite(Date.parse(raw.lastConnected))
    ? raw.lastConnected
    : undefined;
  return {
    id,
    name,
    provider,
    endpoint,
    token: allowToken ? token : '',
    enabled: raw.enabled,
    status: 'disconnected',
    color,
    ...(lastConnected ? { lastConnected } : {}),
    ...(remoteId ? { remoteId } : {}),
  };
}

function isSafeExactConnectionEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    // Exact Office endpoints are durable configuration, not one-time signed
    // URLs. Reject every query string so opaque presigned values, JWTs, sigs,
    // and future credential parameter names can never enter storage or sync.
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:')
      || url.username
      || url.password
      || url.hash
      || url.search
    ) return false;
    return true;
  } catch {
    return false;
  }
}

function sanitizeExactConnections(
  values: unknown,
  allowToken: boolean,
): AgentConnection[] | null {
  if (!Array.isArray(values) || values.length > MAX_EXACT_CONNECTIONS) return null;
  const connections: AgentConnection[] = [];
  const ids = new Set<string>();
  const remoteIds = new Set<string>();
  for (const value of values) {
    const connection = sanitizeExactConnection(value, allowToken);
    if (!connection || ids.has(connection.id) || (connection.remoteId && remoteIds.has(connection.remoteId))) return null;
    ids.add(connection.id);
    if (connection.remoteId) remoteIds.add(connection.remoteId);
    connections.push(connection);
  }
  return connections;
}

function parseExactEnvelope(
  raw: string | null,
  authority: NormalizedOfficeConnectionExactAuthority,
): OfficeConnectionExactEnvelope | null {
  if (raw === null) {
    return {
      schemaVersion: EXACT_STORAGE_SCHEMA_VERSION,
      userId: authority.userId,
      circleId: authority.circleId,
      connections: [],
    };
  }
  if (raw.length > MAX_EXACT_METADATA_BYTES) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OfficeConnectionExactEnvelope>;
    if (
      !parsed
      || parsed.schemaVersion !== EXACT_STORAGE_SCHEMA_VERSION
      || parsed.userId !== authority.userId
      || parsed.circleId !== authority.circleId
    ) return null;
    const connections = sanitizeExactConnections(parsed.connections, false);
    return connections ? {
      schemaVersion: EXACT_STORAGE_SCHEMA_VERSION,
      userId: authority.userId,
      circleId: authority.circleId,
      connections,
    } : null;
  } catch {
    return null;
  }
}

export function generateId(): string {
  return `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Local storage helpers ──────────────────────────────

async function loadLocal(): Promise<AgentConnection[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as AgentConnection[]).map(c => ({
      ...c,
      provider: normalizeProvider(c.provider),
      status: 'disconnected' as const,
      error: undefined,
    }));
  } catch { return []; }
}

async function saveLocal(connections: AgentConnection[]): Promise<void> {
  // Strip secrets (tokens) from local storage — only save metadata needed for reconnection
  const toSave = connections.map(({ status, error, sessionCount, agentIds, token, ...rest }) => ({
    ...rest,
    token: token ? '***' : undefined, // Redact — tokens are recovered from secure local storage on load
  }));
  await storage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

async function readSecret(id: string): Promise<string> {
  return readLocalSecret('office_connection', id);
}

async function writeSecret(id: string, token: string): Promise<void> {
  await writeLocalSecret('office_connection', id, token);
}

async function persistSecrets(connections: AgentConnection[]): Promise<void> {
  await Promise.all(connections.map(conn => writeSecret(conn.id, conn.token || '')));
}

async function hydrateConnectionsWithSecrets(connections: AgentConnection[]): Promise<AgentConnection[]> {
  return Promise.all(connections.map(async (conn) => {
    const secureToken = await readSecret(conn.id);
    return {
      ...conn,
      token: secureToken || conn.token || '',
    };
  }));
}

// ─── Supabase ↔ AgentConnection mapping ──────────────────────────────

function toSupabaseRow(conn: AgentConnection, userId: string) {
  return {
    ...(conn.remoteId ? { id: conn.remoteId } : {}),
    owner_id: userId,
    name: conn.name,
    api_endpoint: conn.endpoint,
    api_key_hash: SECRET_PLACEHOLDER,
    type: conn.provider === 'openswan' ? 'assistant'
        : conn.provider === 'claude-code' ? 'assistant'
        : conn.provider === 'codex' ? 'assistant'
        : conn.provider === 'gemini' ? 'assistant'
        : conn.provider === 'cursor' ? 'assistant'
        : conn.provider === 'blackswan-local' ? 'assistant'
        : 'custom',
    is_active: conn.enabled,
    metadata: {
      provider: conn.provider,
      color: conn.color,
      localId: conn.id,
      lastConnected: conn.lastConnected,
      hasLocalToken: !!conn.token,
      secretStorage: 'local_only',
    },
  };
}

function fromSupabaseRow(row: any): AgentConnection {
  const meta = row.metadata || {};
  const legacyRemoteToken = typeof row.api_key_hash === 'string' && row.api_key_hash !== SECRET_PLACEHOLDER
    ? row.api_key_hash
    : '';
  return {
    id: meta.localId || `conn_${row.id.slice(0, 8)}`,
    name: row.name,
    provider: normalizeProvider(meta.provider),
    endpoint: row.api_endpoint,
    token: legacyRemoteToken,
    enabled: row.is_active,
    color: meta.color || '#6366f1',
    lastConnected: meta.lastConnected,
    remoteId: row.id,
    status: 'disconnected',
  };
}

function toSupabaseRowExact(
  conn: AgentConnection,
  authority: NormalizedOfficeConnectionExactAuthority,
) {
  return {
    ...(conn.remoteId ? { id: conn.remoteId } : {}),
    owner_id: authority.userId,
    name: conn.name,
    api_endpoint: conn.endpoint,
    api_key_hash: SECRET_PLACEHOLDER,
    type: ['openswan', 'claude-code', 'codex', 'gemini', 'cursor', 'blackswan-local'].includes(conn.provider)
      ? 'assistant'
      : 'custom',
    is_active: conn.enabled,
    metadata: {
      officeScopeVersion: EXACT_STORAGE_SCHEMA_VERSION,
      officeCircleId: authority.circleId,
      provider: conn.provider,
      color: conn.color,
      localId: conn.id,
      lastConnected: conn.lastConnected,
      hasLocalToken: !!conn.token,
      secretStorage: 'local_only_exact_scope',
    },
  };
}

function fromSupabaseRowExact(
  value: unknown,
  authority: NormalizedOfficeConnectionExactAuthority,
): AgentConnection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, any>;
  const metadata = row.metadata;
  if (
    row.owner_id !== authority.userId
    || typeof row.id !== 'string'
    || !normalizeExactScopePart(row.id)
    || row.api_key_hash !== SECRET_PLACEHOLDER
    || !metadata
    || typeof metadata !== 'object'
    || Array.isArray(metadata)
    || metadata.officeScopeVersion !== EXACT_STORAGE_SCHEMA_VERSION
    || metadata.officeCircleId !== authority.circleId
    || metadata.secretStorage !== 'local_only_exact_scope'
  ) return null;
  return sanitizeExactConnection({
    id: metadata.localId,
    name: row.name,
    provider: metadata.provider,
    endpoint: row.api_endpoint,
    token: '',
    enabled: row.is_active,
    status: 'disconnected',
    color: metadata.color,
    lastConnected: metadata.lastConnected,
    remoteId: row.id,
  }, false);
}

// ─── Cloud sync ──────────────────────────────

async function getUser(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data?.user?.id ?? null;
  } catch { return null; }
}

async function loadRemote(userId: string): Promise<AgentConnection[]> {
  try {
    const { data, error } = await supabase
      .from('agents_bots')
      .select('*')
      .eq('owner_id', userId)
      .order('created_at', { ascending: true });
    if (error || !data) return [];
    return data.map(fromSupabaseRow);
  } catch { return []; }
}

async function upsertRemote(conn: AgentConnection, userId: string): Promise<string | null> {
  try {
    const row = toSupabaseRow(conn, userId);
    const { data, error } = await supabase
      .from('agents_bots')
      .upsert(row, { onConflict: 'id' })
      .select('id')
      .single();
    if (error || !data) {
      // If upsert failed (no id yet), try insert
      if (!conn.remoteId) {
        const { id: _, ...insertRow } = row as any;
        const { data: inserted, error: insertErr } = await supabase
          .from('agents_bots')
          .insert(insertRow)
          .select('id')
          .single();
        if (!insertErr && inserted) return inserted.id;
      }
      return null;
    }
    return data.id;
  } catch { return null; }
}

async function deleteRemote(remoteId: string): Promise<void> {
  try {
    await supabase.from('agents_bots').delete().eq('id', remoteId);
  } catch {}
}

async function verifyOfficeConnectionExactAuthority(
  input: OfficeConnectionExactAuthority,
): Promise<NormalizedOfficeConnectionExactAuthority | null> {
  const authority = normalizeOfficeConnectionExactAuthority(input);
  if (!authority) return null;
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  return verifiedUser?.id === authority.userId ? authority : null;
}

async function loadRemoteExact(
  authority: NormalizedOfficeConnectionExactAuthority,
): Promise<{ ok: boolean; connections: AgentConnection[]; invalid: boolean }> {
  try {
    const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
    const { data, error } = await exactClient
      .from('agents_bots')
      .select('*')
      .eq('owner_id', authority.userId)
      .contains('metadata', {
        officeScopeVersion: EXACT_STORAGE_SCHEMA_VERSION,
        officeCircleId: authority.circleId,
      })
      .order('created_at', { ascending: true });
    if (error || !Array.isArray(data)) return { ok: false, connections: [], invalid: false };
    if (data.length > MAX_EXACT_CONNECTIONS) return { ok: false, connections: [], invalid: true };
    const connections: AgentConnection[] = [];
    const ids = new Set<string>();
    const remoteIds = new Set<string>();
    for (const row of data) {
      const connection = fromSupabaseRowExact(row, authority);
      if (!connection || ids.has(connection.id) || !connection.remoteId || remoteIds.has(connection.remoteId)) {
        return { ok: false, connections: [], invalid: true };
      }
      ids.add(connection.id);
      remoteIds.add(connection.remoteId);
      connections.push(connection);
    }
    return { ok: true, connections, invalid: false };
  } catch {
    return { ok: false, connections: [], invalid: false };
  }
}

async function upsertRemoteExact(
  connection: AgentConnection,
  authority: NormalizedOfficeConnectionExactAuthority,
): Promise<string | null> {
  try {
    const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
    const { data, error } = await exactClient
      .from('agents_bots')
      .upsert(toSupabaseRowExact(connection, authority), { onConflict: 'id' })
      .select('id')
      .single();
    const remoteId = normalizeExactScopePart(data?.id);
    if (error || !remoteId || (connection.remoteId && connection.remoteId !== remoteId)) return null;
    return remoteId;
  } catch {
    return null;
  }
}

async function deleteRemoteExact(
  remoteId: string,
  authority: NormalizedOfficeConnectionExactAuthority,
): Promise<boolean> {
  try {
    const exactClient = getSupabaseClientForAccessToken(authority.accessToken);
    const { error } = await exactClient
      .from('agents_bots')
      .delete()
      .eq('id', remoteId)
      .eq('owner_id', authority.userId)
      .contains('metadata', {
        officeScopeVersion: EXACT_STORAGE_SCHEMA_VERSION,
        officeCircleId: authority.circleId,
      });
    return !error;
  } catch {
    return false;
  }
}

// ─── Merge logic ──────────────────────────────

function mergeConnections(local: AgentConnection[], remote: AgentConnection[]): AgentConnection[] {
  const merged = new Map<string, AgentConnection>();

  // Index remote by localId and remoteId
  const remoteByLocalId = new Map<string, AgentConnection>();
  for (const r of remote) {
    remoteByLocalId.set(r.id, r);
    if (r.remoteId) merged.set(r.remoteId, r);
  }

  // Process local connections
  for (const l of local) {
    const match = remoteByLocalId.get(l.id) || (l.remoteId ? merged.get(l.remoteId) : undefined);
    if (match) {
      // Merge: keep local id/status fields, adopt remoteId, prefer newer data
      const localTime = l.lastConnected ? new Date(l.lastConnected).getTime() : 0;
      const remoteTime = match.lastConnected ? new Date(match.lastConnected).getTime() : 0;
      const base = remoteTime > localTime ? match : l;
      merged.set(match.remoteId || l.id, {
        ...base,
        id: l.id, // keep local id stable
        remoteId: match.remoteId,
        status: 'disconnected',
      });
      remoteByLocalId.delete(l.id);
    } else {
      merged.set(l.id, { ...l, status: 'disconnected' });
    }
  }

  // Add remote-only connections (from another device)
  for (const r of remoteByLocalId.values()) {
    if (!Array.from(merged.values()).some(m => m.remoteId === r.remoteId)) {
      merged.set(r.remoteId || r.id, r);
    }
  }

  return Array.from(merged.values());
}

function exactLoadFailure(
  authority: NormalizedOfficeConnectionExactAuthority | null,
  error: OfficeConnectionExactError,
): OfficeConnectionExactLoadResult {
  return {
    ok: false,
    connections: [],
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    localLoaded: false,
    remoteLoaded: false,
    missingSecretCount: 0,
    error,
  };
}

function exactSaveFailure(
  authority: NormalizedOfficeConnectionExactAuthority | null,
  error: OfficeConnectionExactError,
  connections: AgentConnection[] = [],
  localSaved = false,
  remoteSaved = false,
): OfficeConnectionExactSaveResult {
  return {
    ok: false,
    connections,
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    localSaved,
    remoteSaved,
    secretFailures: [],
    error,
  };
}

async function readExactEnvelope(
  authority: NormalizedOfficeConnectionExactAuthority,
): Promise<{ ok: boolean; envelope: OfficeConnectionExactEnvelope | null }> {
  const key = officeConnectionExactStorageKey(authority);
  if (!key) return { ok: false, envelope: null };
  try {
    const raw = await storage.getItem(key);
    const envelope = parseExactEnvelope(raw, authority);
    return { ok: !!envelope, envelope };
  } catch {
    return { ok: false, envelope: null };
  }
}

async function writeExactEnvelope(
  authority: NormalizedOfficeConnectionExactAuthority,
  connections: AgentConnection[],
): Promise<boolean> {
  const key = officeConnectionExactStorageKey(authority);
  if (!key) return false;
  const metadataConnections = connections.map(connection => ({
    ...connection,
    token: '',
    status: 'disconnected' as const,
    error: undefined,
    sessionCount: undefined,
    agentIds: undefined,
  }));
  const envelope: OfficeConnectionExactEnvelope = {
    schemaVersion: EXACT_STORAGE_SCHEMA_VERSION,
    userId: authority.userId,
    circleId: authority.circleId,
    connections: metadataConnections,
  };
  try {
    const serialized = JSON.stringify(envelope);
    if (serialized.length > MAX_EXACT_METADATA_BYTES || !parseExactEnvelope(serialized, authority)) return false;
    await storage.setItem(key, serialized);
    return await storage.getItem(key) === serialized;
  } catch {
    return false;
  }
}

async function hydrateExactSecrets(
  connections: AgentConnection[],
  authority: NormalizedOfficeConnectionExactAuthority,
  fence: OfficeConnectionAuthorityFence,
): Promise<{
  ok: boolean;
  connections: AgentConnection[];
  missingSecretCount: number;
  unavailable: boolean;
}> {
  const hydrated: AgentConnection[] = [];
  let missingSecretCount = 0;
  let unavailable = false;
  for (const connection of connections) {
    if (!isExactAuthorityCurrent(authority, fence)) {
      return { ok: false, connections: [], missingSecretCount: 0, unavailable: false };
    }
    const secretId = officeConnectionExactSecretId(authority, connection.id);
    if (!secretId) return { ok: false, connections: [], missingSecretCount: 0, unavailable: false };
    const secret = await readVerifiedLocalSecret(EXACT_SECRET_NAMESPACE, secretId);
    if (!isExactAuthorityCurrent(authority, fence)) {
      return { ok: false, connections: [], missingSecretCount: 0, unavailable: false };
    }
    if (secret.status === 'found') {
      if (secret.value.length > MAX_EXACT_TOKEN_LENGTH) {
        return { ok: false, connections: [], missingSecretCount: 0, unavailable: true };
      }
      hydrated.push({ ...connection, token: secret.value });
    } else {
      missingSecretCount += 1;
      unavailable ||= secret.status === 'unavailable' || secret.status === 'invalid';
      hydrated.push({ ...connection, token: '' });
    }
  }
  return { ok: true, connections: hydrated, missingSecretCount, unavailable };
}

/**
 * Load only the captured Office user/circle lane. This exact path never reads
 * the ownerless legacy metadata key, legacy secret namespace, global session,
 * or historical remote api_key_hash credential values.
 */
export async function loadOfficeConnectionsExact(
  capturedAuthority: OfficeConnectionExactAuthority,
  fence: OfficeConnectionAuthorityFence,
): Promise<OfficeConnectionExactLoadResult> {
  const syntacticAuthority = normalizeOfficeConnectionExactAuthority(capturedAuthority);
  if (!syntacticAuthority || typeof fence !== 'function') {
    return exactLoadFailure(syntacticAuthority, 'invalid_authority');
  }
  if (!isExactAuthorityCurrent(syntacticAuthority, fence)) {
    return exactLoadFailure(syntacticAuthority, 'authority_retired');
  }
  const authority = await verifyOfficeConnectionExactAuthority(syntacticAuthority);
  if (!authority) return exactLoadFailure(syntacticAuthority, 'authority_mismatch');
  if (!isExactAuthorityCurrent(authority, fence)) return exactLoadFailure(authority, 'authority_retired');

  const localResult = await readExactEnvelope(authority);
  if (!isExactAuthorityCurrent(authority, fence)) return exactLoadFailure(authority, 'authority_retired');
  if (!localResult.ok || !localResult.envelope) return exactLoadFailure(authority, 'invalid_local_data');

  const remoteResult = await loadRemoteExact(authority);
  if (!isExactAuthorityCurrent(authority, fence)) return exactLoadFailure(authority, 'authority_retired');
  if (remoteResult.invalid) return exactLoadFailure(authority, 'invalid_remote_data');

  const merged = remoteResult.ok
    ? mergeConnections(localResult.envelope.connections, remoteResult.connections)
    : localResult.envelope.connections;
  const sanitizedMerged = sanitizeExactConnections(merged, false);
  if (!sanitizedMerged) return exactLoadFailure(authority, 'invalid_remote_data');
  const hydrated = await hydrateExactSecrets(sanitizedMerged, authority, fence);
  if (!hydrated.ok || !isExactAuthorityCurrent(authority, fence)) {
    return exactLoadFailure(authority, 'authority_retired');
  }
  if (hydrated.unavailable) return exactLoadFailure(authority, 'secret_unavailable');

  // Cache remote metadata for offline use only while this exact authority is current.
  if (!await writeExactEnvelope(authority, hydrated.connections)) {
    return exactLoadFailure(authority, 'local_write_failed');
  }
  if (!isExactAuthorityCurrent(authority, fence)) return exactLoadFailure(authority, 'authority_retired');
  return {
    ok: true,
    connections: hydrated.connections,
    userId: authority.userId,
    circleId: authority.circleId,
    generation: authority.generation,
    localLoaded: true,
    remoteLoaded: remoteResult.ok,
    missingSecretCount: hydrated.missingSecretCount,
  };
}

/**
 * Save one exact Office lane with verified protected-secret readback and
 * captured-bearer server writes. Local success is retained when the remote is
 * unavailable; the receipt exposes that state without replaying through a
 * mutable global session.
 */
async function saveOfficeConnectionsExactImpl(
  values: AgentConnection[],
  capturedAuthority: OfficeConnectionExactAuthority,
  fence: OfficeConnectionAuthorityFence,
): Promise<OfficeConnectionExactSaveResult> {
  const syntacticAuthority = normalizeOfficeConnectionExactAuthority(capturedAuthority);
  if (!syntacticAuthority || typeof fence !== 'function') {
    return exactSaveFailure(syntacticAuthority, 'invalid_authority');
  }
  const requestedConnections = sanitizeExactConnections(values, true);
  if (!requestedConnections) return exactSaveFailure(syntacticAuthority, 'invalid_connections');
  if (!isExactAuthorityCurrent(syntacticAuthority, fence)) {
    return exactSaveFailure(syntacticAuthority, 'authority_retired');
  }
  const authority = await verifyOfficeConnectionExactAuthority(syntacticAuthority);
  if (!authority) return exactSaveFailure(syntacticAuthority, 'authority_mismatch');
  if (!isExactAuthorityCurrent(authority, fence)) return exactSaveFailure(authority, 'authority_retired');

  const priorLocal = await readExactEnvelope(authority);
  if (!isExactAuthorityCurrent(authority, fence)) return exactSaveFailure(authority, 'authority_retired');
  if (!priorLocal.ok || !priorLocal.envelope) return exactSaveFailure(authority, 'invalid_local_data');

  // A remote id is trusted only when it was already committed inside this
  // exact user/circle envelope for the same local connection. This strips ids
  // supplied by the legacy owner-global connection path instead of converting
  // those rows into a circle-private row by accident.
  const priorRemoteIdByLocalId = new Map(
    priorLocal.envelope.connections
      .filter(connection => !!connection.remoteId)
      .map(connection => [connection.id, connection.remoteId!] as const),
  );
  const connections = requestedConnections.map(connection => {
    const trustedRemoteId = priorRemoteIdByLocalId.get(connection.id);
    return trustedRemoteId
      ? { ...connection, remoteId: trustedRemoteId }
      : { ...connection, remoteId: undefined };
  });

  const nextIds = new Set(connections.map(connection => connection.id));
  const secretFailures: OfficeConnectionSecretWriteFailure[] = [];
  for (const connection of connections) {
    if (!isExactAuthorityCurrent(authority, fence)) return exactSaveFailure(authority, 'authority_retired');
    const secretId = officeConnectionExactSecretId(authority, connection.id);
    if (!secretId) return exactSaveFailure(authority, 'invalid_connections');
    const saved = connection.token
      ? await writeVerifiedLocalSecret(EXACT_SECRET_NAMESPACE, secretId, connection.token)
      : await deleteVerifiedLocalSecret(EXACT_SECRET_NAMESPACE, secretId);
    if (!saved) {
      secretFailures.push({
        connectionId: connection.id,
        operation: connection.token ? 'write' : 'delete',
        reason: 'secret_unavailable',
      });
      return {
        ...exactSaveFailure(authority, 'secret_unavailable'),
        secretFailures,
      };
    }
    if (!isExactAuthorityCurrent(authority, fence)) return exactSaveFailure(authority, 'authority_retired');
  }
  for (const removed of priorLocal.envelope.connections) {
    if (nextIds.has(removed.id)) continue;
    if (!isExactAuthorityCurrent(authority, fence)) return exactSaveFailure(authority, 'authority_retired');
    const secretId = officeConnectionExactSecretId(authority, removed.id);
    if (!secretId || !await deleteVerifiedLocalSecret(EXACT_SECRET_NAMESPACE, secretId)) {
      secretFailures.push({
        connectionId: removed.id,
        operation: 'delete',
        reason: 'secret_unavailable',
      });
      return {
        ...exactSaveFailure(authority, 'secret_unavailable'),
        secretFailures,
      };
    }
  }

  if (!await writeExactEnvelope(authority, connections)) {
    return exactSaveFailure(authority, 'local_write_failed');
  }
  if (!isExactAuthorityCurrent(authority, fence)) {
    return exactSaveFailure(authority, 'authority_retired', [], true);
  }

  const remoteResult = await loadRemoteExact(authority);
  if (!isExactAuthorityCurrent(authority, fence)) {
    return exactSaveFailure(authority, 'authority_retired', [], true);
  }
  if (!remoteResult.ok) {
    return {
      ok: true,
      connections,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
      localSaved: true,
      remoteSaved: false,
      secretFailures,
      error: remoteResult.invalid ? 'invalid_remote_data' : 'remote_unavailable',
    };
  }

  const existingRemoteByLocalId = new Map(
    remoteResult.connections
      .filter(connection => !!connection.remoteId)
      .map(connection => [connection.id, connection.remoteId!] as const),
  );
  const withRemoteIds = connections.map(connection => ({
    ...connection,
    remoteId: connection.remoteId || existingRemoteByLocalId.get(connection.id),
  }));
  let remoteSaved = true;
  for (const connection of withRemoteIds) {
    if (!isExactAuthorityCurrent(authority, fence)) {
      return exactSaveFailure(authority, 'authority_retired', [], true);
    }
    const remoteId = await upsertRemoteExact(connection, authority);
    if (!remoteId) {
      remoteSaved = false;
      break;
    }
    connection.remoteId = remoteId;
  }

  if (remoteSaved) {
    const retainedRemoteIds = new Set(withRemoteIds.map(connection => connection.remoteId).filter(Boolean));
    for (const remote of remoteResult.connections) {
      if (!remote.remoteId || retainedRemoteIds.has(remote.remoteId)) continue;
      if (!isExactAuthorityCurrent(authority, fence)) {
        return exactSaveFailure(authority, 'authority_retired', [], true);
      }
      if (!await deleteRemoteExact(remote.remoteId, authority)) remoteSaved = false;
    }
  }
  if (!isExactAuthorityCurrent(authority, fence)) {
    return exactSaveFailure(authority, 'authority_retired', [], true, remoteSaved);
  }
  const finalLocalSaved = await writeExactEnvelope(authority, withRemoteIds);
  if (!finalLocalSaved) {
    return exactSaveFailure(authority, 'local_write_failed', withRemoteIds, false, remoteSaved);
  }
  return remoteSaved
    ? {
      ok: true,
      connections: withRemoteIds,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
      localSaved: true,
      remoteSaved: true,
      secretFailures,
    }
    : {
      ok: true,
      connections: withRemoteIds,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
      localSaved: true,
      remoteSaved: false,
      secretFailures,
      error: 'remote_unavailable',
    };
}

/**
 * Serialize exact saves per user/circle so an older async write cannot finish
 * after and erase a newer snapshot. Other accounts and circles remain fully
 * independent lanes.
 */
export async function saveOfficeConnectionsExact(
  values: AgentConnection[],
  capturedAuthority: OfficeConnectionExactAuthority,
  fence: OfficeConnectionAuthorityFence,
): Promise<OfficeConnectionExactSaveResult> {
  const authority = normalizeOfficeConnectionExactAuthority(capturedAuthority);
  if (!authority || typeof fence !== 'function') {
    return exactSaveFailure(authority, 'invalid_authority');
  }
  const capturedConnections = sanitizeExactConnections(values, true);
  if (!capturedConnections) return exactSaveFailure(authority, 'invalid_connections');
  const laneKey = `${encodeURIComponent(authority.userId)}\u0000${encodeURIComponent(authority.circleId)}`;
  const previous = exactSaveTails.get(laneKey) || Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(() => saveOfficeConnectionsExactImpl(capturedConnections, authority, fence));
  const tail = run.then(() => undefined, () => undefined);
  exactSaveTails.set(laneKey, tail);
  try {
    return await run;
  } finally {
    if (exactSaveTails.get(laneKey) === tail) exactSaveTails.delete(laneKey);
  }
}

// ─── Public API ──────────────────────────────

export async function loadConnections(): Promise<AgentConnection[]> {
  const local = await loadLocal();
  const userId = await getUser();

  if (!userId) return hydrateConnectionsWithSecrets(local); // Not logged in — local only

  const remote = await loadRemote(userId);
  const merged = mergeConnections(local, remote);
  const hydrated = await hydrateConnectionsWithSecrets(merged);

  let needsSecretMigration = false;
  for (const conn of hydrated) {
    const hasLegacyRemoteSecret = !!remote.find(r => r.id === conn.id && r.token);
    const hasSecureLocalSecret = !!(await readSecret(conn.id));
    if (!hasSecureLocalSecret && hasLegacyRemoteSecret && conn.token) {
      await writeSecret(conn.id, conn.token);
      needsSecretMigration = true;
    }
  }
  const finalConnections = await hydrateConnectionsWithSecrets(hydrated);

  // Persist merged result locally (so offline has latest)
  await saveLocal(finalConnections);
  if (needsSecretMigration) {
    void saveConnections(finalConnections);
  }

  return finalConnections;
}

/**
 * Connected-agent bearer tokens are device-local and the legacy storage keys
 * are not user-scoped. Remove them on logout so another account using the same
 * browser/device cannot inherit a prior account's execution bridge.
 */
export async function clearLocalAgentConnectionsForLogout(): Promise<number> {
  const local = await loadLocal();
  await Promise.allSettled(local.map((connection) => (
    deleteLocalSecret('office_connection', connection.id)
  )));
  await storage.removeItem(STORAGE_KEY);
  return local.length;
}

export async function saveConnections(connections: AgentConnection[]): Promise<void> {
  // Always save locally first (fast, offline-safe)
  await persistSecrets(connections);
  await saveLocal(connections);

  // Then sync to cloud in background
  const userId = await getUser();
  if (!userId) return;

  // Get current remote set to detect deletions
  const remote = await loadRemote(userId);
  const remoteIds = new Set(remote.map(r => r.remoteId).filter(Boolean));
  const localRemoteIds = new Set(connections.map(c => c.remoteId).filter(Boolean));

  // Upsert each connection
  for (const conn of connections) {
    const remoteId = await upsertRemote(conn, userId);
    if (remoteId && !conn.remoteId) {
      // First sync — store remoteId back
      conn.remoteId = remoteId;
    }
  }

  // Delete remote connections that were removed locally
  for (const rid of remoteIds) {
    if (rid && !localRemoteIds.has(rid)) {
      await deleteRemote(rid);
    }
  }

  // Re-save locally with updated remoteIds
  await persistSecrets(connections);
  await saveLocal(connections);
}

// ─── Auto-Discovery ──────────────────────────────

/**
 * Browser traffic must use the CORS/auth proxy. Native runtimes may reach the
 * direct gateway first and retain the proxy as a fallback. Explicit bridge
 * environment URLs are resolved by the shared bridge-environment owner.
 */
export function getLocalOpenSwanDiscoveryEndpoints(
  platform: string = Platform.OS,
): string[] {
  const proxyEndpoint = getBridgeUrl(18790);
  const directEndpoint = getBridgeUrl(18789);
  const ordered = platform === 'web'
    ? [proxyEndpoint]
    : [directEndpoint, proxyEndpoint];
  return Array.from(new Set(ordered.filter((value): value is string => !!value)));
}

/**
 * Probe localhost for a running OpenSwan gateway.
 * If found, auto-creates a connection entry (or returns existing).
 * Works on both localhost dev and the live site — browser fetch to
 * localhost reaches the user's own machine.
 */
export async function autoDiscoverLocalAgents(
  existing: AgentConnection[],
): Promise<{ discovered: AgentConnection | null; endpoint?: string }> {
  // Skip if user already has an OpenSwan connection (enabled or not)
  const hasOpenclaw = existing.some(
    c => c.provider === 'openswan' && c.endpoint.includes('localhost'),
  );
  if (hasOpenclaw) {
    // Return the existing one for auto-reconnect
    const conn = existing.find(c => c.provider === 'openswan' && c.endpoint.includes('localhost'));
    return { discovered: null, endpoint: conn?.endpoint };
  }

  for (const endpoint of getLocalOpenSwanDiscoveryEndpoints()) {
    if (await probeEndpointHealth(endpoint)) {
      const conn: AgentConnection = {
        id: generateId(),
        name: 'OpenSwan',
        provider: 'openswan',
        endpoint,
        token: '', // Will be filled from saved data or user input
        enabled: true,
        status: 'disconnected',
        color: PROVIDER_META.openswan.color,
      };
      return { discovered: conn, endpoint };
    }
  }

  return { discovered: null };
}

/** Validate that an endpoint URL is safe to connect to (http/https only, no file:/javascript: etc) */
export function isValidEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Probe an endpoint's health without auth.
 * Returns true if the gateway is reachable and healthy.
 */
export async function probeEndpointHealth(endpoint: string): Promise<boolean> {
  if (!isValidEndpoint(endpoint)) return false;
  if (Platform.OS === 'web' && /localhost:18789(?:\/|$)/.test(endpoint)) return false;
  try {
    const normalized = endpoint.replace(/\/$/, '');
    const res = await fetch(`${normalized}/health`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return false;
    const data = await res.json().catch(() => null);
    return data?.ok === true || data?.status === 'live';
  } catch {
    return false;
  }
}

/**
 * Get the first connected OpenSwan connection's endpoint,
 * or fall back to the first enabled one.
 */
export function getOpenSwanEndpoint(connections: AgentConnection[]): string | null {
  const connected = connections.find(
    c => c.provider === 'openswan' && c.status === 'connected',
  );
  if (connected) return connected.endpoint;
  const enabled = connections.find(
    c => c.provider === 'openswan' && c.enabled,
  );
  return enabled?.endpoint || null;
}
