import { storage } from './storage';
import { supabase } from './supabase';

export type ProviderType = 'openclaw' | 'claude-code' | 'generic-agent' | 'codex' | 'gemini' | 'cursor';

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

export const PROVIDER_META: Record<ProviderType, { icon: string; label: string; color: string; defaultEndpoint: string }> = {
  'openclaw': { icon: '🐾', label: 'OpenClaw', color: '#6366f1', defaultEndpoint: 'http://localhost:18790' },
  'claude-code': { icon: '🤖', label: 'Claude Code', color: '#f59e0b', defaultEndpoint: 'http://localhost:8080' },
  'generic-agent': { icon: '⚡', label: 'Generic Agent', color: '#10b981', defaultEndpoint: 'https://' },
  'codex': { icon: '🧠', label: 'OpenAI Codex', color: '#10a37f', defaultEndpoint: 'https://api.openai.com/v1' },
  'gemini': { icon: '♊', label: 'Google Gemini', color: '#4285f4', defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta' },
  'cursor': { icon: '🎯', label: 'Cursor', color: '#8b5cf6', defaultEndpoint: 'http://localhost:2087' },
};

const STORAGE_KEY = '@office_connections';

export function generateId(): string {
  return `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Local storage helpers ──────────────────────────────

async function loadLocal(): Promise<AgentConnection[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return (JSON.parse(raw) as AgentConnection[]).map(c => ({
      ...c, status: 'disconnected' as const, error: undefined,
    }));
  } catch { return []; }
}

async function saveLocal(connections: AgentConnection[]): Promise<void> {
  const toSave = connections.map(({ status, error, sessionCount, agentIds, ...rest }) => rest);
  await storage.setItem(STORAGE_KEY, JSON.stringify(toSave));
}

// ─── Supabase ↔ AgentConnection mapping ──────────────────────────────

function toSupabaseRow(conn: AgentConnection, userId: string) {
  return {
    ...(conn.remoteId ? { id: conn.remoteId } : {}),
    owner_id: userId,
    name: conn.name,
    api_endpoint: conn.endpoint,
    api_key_hash: conn.token, // stored as-is (RLS protects it per user)
    type: conn.provider === 'openclaw' ? 'assistant'
        : conn.provider === 'claude-code' ? 'assistant'
        : conn.provider === 'codex' ? 'assistant'
        : conn.provider === 'gemini' ? 'assistant'
        : conn.provider === 'cursor' ? 'assistant'
        : 'custom',
    is_active: conn.enabled,
    metadata: {
      provider: conn.provider,
      color: conn.color,
      localId: conn.id,
      lastConnected: conn.lastConnected,
    },
  };
}

function fromSupabaseRow(row: any): AgentConnection {
  const meta = row.metadata || {};
  return {
    id: meta.localId || `conn_${row.id.slice(0, 8)}`,
    name: row.name,
    provider: meta.provider || 'generic-agent',
    endpoint: row.api_endpoint,
    token: row.api_key_hash,
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

  if (!userId) return local; // Not logged in — local only

  const remote = await loadRemote(userId);
  const merged = mergeConnections(local, remote);

  // Persist merged result locally (so offline has latest)
  await saveLocal(merged);

  return merged;
}

export async function saveConnections(connections: AgentConnection[]): Promise<void> {
  // Always save locally first (fast, offline-safe)
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
  await saveLocal(connections);
}
