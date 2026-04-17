import { storage } from './storage';
import { supabase } from './supabase';
import { Platform } from 'react-native';
import { readLocalSecret, writeLocalSecret } from './localSecrets';

export type ProviderType =
  | 'openswan' | 'claude-code' | 'generic-agent' | 'codex' | 'gemini' | 'cursor' | 'blackswan-local'
  | 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'ollama' | 'replicate' | 'figma'
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
  'openswan':       { icon: '🐾', label: 'OpenSwan',       color: '#6366f1', defaultEndpoint: 'http://localhost:18790' },
  'claude-code':    { icon: '🤖', label: 'Claude Code',    color: '#f59e0b', defaultEndpoint: 'http://localhost:8080' },
  'generic-agent':  { icon: '⚡', label: 'Generic Agent',  color: '#10b981', defaultEndpoint: 'https://' },
  'cursor':         { icon: '🎯', label: 'Cursor',         color: '#8b5cf6', defaultEndpoint: 'http://localhost:2087' },
  'blackswan-local':{ icon: '🦢', label: 'BlackSwan LLM',  color: '#22d3ee', defaultEndpoint: 'http://localhost:7779' },
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
  'figma':          { icon: '🎨', label: 'Figma',          color: '#a259ff', defaultEndpoint: 'https://api.figma.com' },
  'github-models':  { icon: '🐙', label: 'GitHub Models',  color: '#6e40c9', defaultEndpoint: 'https://models.inference.ai.azure.com', isLLM: true },
  'huggingface':    { icon: '🤗', label: 'Hugging Face',   color: '#ffbd45', defaultEndpoint: 'https://router.huggingface.co/v1',    isLLM: true },
};

const STORAGE_KEY = '@office_connections';
const LEGACY_PROVIDER = `open${'claw'}`;
const SECRET_PLACEHOLDER = '__local_secret__';

function normalizeProvider(provider: string | null | undefined): ProviderType {
  if (provider === LEGACY_PROVIDER) return 'openswan';
  return (provider as ProviderType) || 'generic-agent';
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

const LOCAL_OPENCLAW_ENDPOINTS = [
  'http://localhost:18790', // CORS proxy (preferred)
  'http://localhost:18789', // Direct gateway
];

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

  for (const endpoint of LOCAL_OPENCLAW_ENDPOINTS) {
    try {
      const res = await fetch(`${endpoint}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.ok || data?.status === 'live') {
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
    } catch {
      // Endpoint not reachable — try next
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
