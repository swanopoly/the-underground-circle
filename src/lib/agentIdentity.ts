// Agent Identity System - Persistent agent data based on sessionKey
// This ensures agents keep their identity even when connections change.
//
// Dual-persisted (as of 2026-04-30): localStorage stays as the fast cache,
// agent_identities table is the durable source of truth across browser
// clears + devices. saveAgentIdentities writes to both. loadAgentIdentities
// reads localStorage first then asynchronously refreshes from DB.
//
// See migration 20260430_agent_identities.sql.

import { storage } from './storage';
import { supabase } from './supabase';
import { OfficeAgent } from './officeAgents';
import { DEFAULT_APPEARANCE, type AgentAppearance } from './officeConfig';

const STORAGE_KEY_AGENT_IDENTITY = '@agent_identity_store';

export interface AgentIdentity {
  sessionKey: string; // The stable identifier (e.g., "rapid-slug")

  // Persistent identity
  customName?: string;
  customColor?: string;
  appearance?: AgentAppearance;
  spiritId?: string | null;
  spiritEmoji?: string | null;
  soulPrompt?: string | null;
  customProfileId?: string | null;
  customProfileName?: string | null;

  // Historical data
  totalCostAllTime: number;
  totalTokensAllTime: number;
  totalSessionsAllTime: number;
  firstSeen: number; // timestamp
  lastSeen: number; // timestamp

  // Activity tracking
  totalMessages: number;
  totalTurns: number;

  // Floor assignment
  assignedFloorId?: string;
  deskIndex?: number;

  // Metadata
  mostUsedModel?: string;
  tags?: string[]; // Quick access to common tags

  // Bonding (local cache of server-side bond state)
  bondId?: string;             // UUID from agent_bonds table
  bondLevel?: number;          // 1-10
  bondXP?: number;             // XP toward next level
  isPrimary?: boolean;         // Is this the user's primary agent?
  isCustomized?: boolean;      // Has the user customized this agent?
  boundAiProvider?: string;    // 'claude' | 'gemini' | 'blackswan'
  boundModel?: string;         // Specific model this agent uses
  soulTraits?: Record<string, number>; // Trait strengths (local cache)
}

type AgentIdentityLike = Pick<OfficeAgent, 'id' | 'name'> & { sessionKey?: string } & Partial<OfficeAgent>;

export function getAgentIdentityKey(agent: AgentIdentityLike | null | undefined): string {
  if (!agent) return '';
  if (agent.sessionKey?.trim()) return agent.sessionKey.trim();
  if (typeof agent.id === 'string' && agent.id.trim()) {
    if (agent.id.startsWith('provider-main::')) {
      return `provider-main:${agent.id.split('::')[1] || agent.id}`;
    }
    if (agent.id.includes('::')) {
      return agent.id.split('::')[1] || agent.id;
    }
    return agent.id;
  }
  return agent.name?.trim() || '';
}

export function getAgentIdentityByAgent(
  identities: Map<string, AgentIdentity>,
  agent: AgentIdentityLike | null | undefined,
): AgentIdentity | null {
  const key = getAgentIdentityKey(agent);
  if (!key) return null;
  return identities.get(key) || null;
}

export function applyIdentityToAgent(agent: OfficeAgent, identity?: AgentIdentity | null): OfficeAgent {
  if (!identity) return agent;

  const next: OfficeAgent = {
    ...agent,
    name: identity.customName || agent.name,
    color: identity.customColor || agent.color,
    costToday: Math.max(agent.costToday, identity.totalCostAllTime),
    tokensUsed: Math.max(agent.tokensUsed, identity.totalTokensAllTime),
    messagesProcessed: Math.max(agent.messagesProcessed, identity.totalMessages),
    spirit: identity.spiritId || agent.spirit,
  };

  if (identity.boundModel && (!agent.model || agent.model === 'unknown')) {
    next.model = identity.boundModel;
  }

  return next;
}

// ─── Load/Save Identity Store ──────────────────────────────

export async function loadAgentIdentities(): Promise<Map<string, AgentIdentity>> {
  try {
    const raw = await storage.getItem(STORAGE_KEY_AGENT_IDENTITY);
    if (!raw) return new Map();
    
    const data = JSON.parse(raw);
    return new Map(Object.entries(data));
  } catch (error) {
    console.error('Failed to load agent identities:', error);
    return new Map();
  }
}

export async function saveAgentIdentities(identities: Map<string, AgentIdentity>): Promise<void> {
  // 1. Local cache — always wins for read latency.
  try {
    const obj = Object.fromEntries(identities.entries());
    await storage.setItem(STORAGE_KEY_AGENT_IDENTITY, JSON.stringify(obj));
  } catch (error) {
    console.error('Failed to save agent identities to localStorage:', error);
  }

  // 2. Durable Supabase upsert — fire-and-forget. Skips silently when
  // the migration hasn't been applied yet (PGRST205) so the UI keeps
  // working until the user runs the SQL.
  void persistIdentitiesToServer(identities);
}

/**
 * Refresh local identities from the agent_identities table. Returns the
 * merged map (server entries win when both exist with different
 * last_seen). Caller should call saveAgentIdentities-without-server-push
 * to write the merge back to localStorage. Used on app boot / sign-in
 * to backfill a fresh device or post-cache-clear browser.
 */
export async function syncAgentIdentitiesFromServer(): Promise<Map<string, AgentIdentity>> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Map();
    const { data, error } = await supabase
      .from('agent_identities')
      .select('*')
      .eq('user_id', user.id);
    if (error || !data) return new Map();
    const merged = new Map<string, AgentIdentity>();
    for (const row of data as any[]) {
      merged.set(row.session_key, rowToIdentity(row));
    }
    return merged;
  } catch {
    return new Map();
  }
}

function rowToIdentity(row: any): AgentIdentity {
  return {
    sessionKey: row.session_key,
    customName: row.custom_name || undefined,
    customColor: row.custom_color || undefined,
    appearance: row.appearance && Object.keys(row.appearance).length > 0 ? row.appearance : undefined,
    spiritId: row.spirit_id ?? null,
    spiritEmoji: row.spirit_emoji ?? null,
    soulPrompt: row.soul_prompt ?? null,
    customProfileId: row.custom_profile_id ?? null,
    customProfileName: row.custom_profile_name ?? null,
    totalCostAllTime: Number(row.total_cost_all_time || 0),
    totalTokensAllTime: Number(row.total_tokens_all_time || 0),
    totalSessionsAllTime: Number(row.total_sessions_all_time || 0),
    firstSeen: row.first_seen ? new Date(row.first_seen).getTime() : Date.now(),
    lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : Date.now(),
    totalMessages: Number(row.total_messages || 0),
    totalTurns: Number(row.total_turns || 0),
    assignedFloorId: row.assigned_floor_id || undefined,
    deskIndex: typeof row.desk_index === 'number' ? row.desk_index : undefined,
    mostUsedModel: row.most_used_model || undefined,
    tags: Array.isArray(row.tags) ? row.tags : undefined,
    bondId: row.bond_id || undefined,
    bondLevel: typeof row.bond_level === 'number' ? row.bond_level : undefined,
    bondXP: typeof row.bond_xp === 'number' ? row.bond_xp : undefined,
    isPrimary: !!row.is_primary,
    isCustomized: !!row.is_customized,
    boundAiProvider: row.bound_ai_provider || undefined,
    boundModel: row.bound_model || undefined,
  };
}

function identityToRow(userId: string, identity: AgentIdentity) {
  return {
    user_id: userId,
    session_key: identity.sessionKey,
    custom_name: identity.customName ?? null,
    custom_color: identity.customColor ?? null,
    spirit_id: identity.spiritId ?? null,
    spirit_emoji: identity.spiritEmoji ?? null,
    soul_prompt: identity.soulPrompt ?? null,
    custom_profile_id: identity.customProfileId ?? null,
    custom_profile_name: identity.customProfileName ?? null,
    appearance: identity.appearance || {},
    assigned_floor_id: identity.assignedFloorId ?? null,
    desk_index: typeof identity.deskIndex === 'number' ? identity.deskIndex : null,
    bond_id: identity.bondId ?? null,
    bond_level: typeof identity.bondLevel === 'number' ? identity.bondLevel : null,
    bond_xp: typeof identity.bondXP === 'number' ? identity.bondXP : null,
    is_primary: !!identity.isPrimary,
    is_customized: !!identity.isCustomized,
    bound_ai_provider: identity.boundAiProvider ?? null,
    bound_model: identity.boundModel ?? null,
    most_used_model: identity.mostUsedModel ?? null,
    tags: Array.isArray(identity.tags) ? identity.tags : [],
    total_messages: identity.totalMessages || 0,
    total_turns: identity.totalTurns || 0,
    total_cost_all_time: identity.totalCostAllTime || 0,
    total_tokens_all_time: identity.totalTokensAllTime || 0,
    total_sessions_all_time: identity.totalSessionsAllTime || 0,
    first_seen: new Date(identity.firstSeen).toISOString(),
    last_seen: new Date(identity.lastSeen).toISOString(),
  };
}

// Session-level kill switch. The first time the upsert fails because
// the table or one of its columns is missing from the schema cache
// (PGRST204 / PGRST205 / generic 404), we flip this and stop firing
// further requests for the rest of the page session. localStorage
// keeps working, so no data loss — just no spam in the network panel.
//
// Reset by reloading the page (after the migration is applied).
let _identitiesPersistDisabled = false;

async function persistIdentitiesToServer(identities: Map<string, AgentIdentity>): Promise<void> {
  if (_identitiesPersistDisabled) return;
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const rows = Array.from(identities.values()).map(id => identityToRow(user.id, id));
    if (rows.length === 0) return;
    // Batch upsert — single round-trip per save.
    const { error } = await supabase
      .from('agent_identities')
      .upsert(rows, { onConflict: 'user_id,session_key' });
    if (error) {
      // PGRST205 = table not in schema cache (migration not applied).
      // PGRST204 = column not in schema cache (older migration version).
      // 404      = generic schema/table miss from the REST gateway.
      const code = (error as any).code;
      const status = (error as any).status;
      if (code === 'PGRST205' || code === 'PGRST204' || status === 404) {
        _identitiesPersistDisabled = true;
        console.warn(
          '[agentIdentity] agent_identities table/column missing — falling back to localStorage only. ' +
          'Apply migration `supabase/migrations/20260430_agent_identities.sql` and reload to re-enable durable persistence.',
        );
        return;
      }
      console.warn('[agentIdentity] DB save failed:', error.message);
    }
  } catch (err) {
    console.warn('[agentIdentity] persist threw:', err);
  }
}

// ─── Update Agent Identity ─────────────────────────────────

export async function updateAgentIdentity(
  sessionKey: string,
  updates: Partial<AgentIdentity>
): Promise<void> {
  const identities = await loadAgentIdentities();
  const existing = identities.get(sessionKey);
  
  if (existing) {
    identities.set(sessionKey, {
      ...existing,
      ...updates,
      lastSeen: Date.now(),
    });
  } else {
    // New agent identity
    identities.set(sessionKey, {
      sessionKey,
      totalCostAllTime: 0,
      totalTokensAllTime: 0,
      totalSessionsAllTime: 0,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      totalMessages: 0,
      totalTurns: 0,
      ...updates,
    });
  }
  
  await saveAgentIdentities(identities);
}

// ─── Record Agent Activity ─────────────────────────────────

export async function recordAgentActivity(agent: OfficeAgent): Promise<void> {
  const sessionKey = getAgentIdentityKey(agent);
  const identities = await loadAgentIdentities();
  const existing = identities.get(sessionKey);
  
  if (existing) {
    // Update existing identity with cumulative data
    identities.set(sessionKey, {
      ...existing,
      totalCostAllTime: Math.max(existing.totalCostAllTime, agent.costToday),
      totalTokensAllTime: Math.max(existing.totalTokensAllTime, agent.tokensUsed),
      totalMessages: Math.max(existing.totalMessages, agent.messagesProcessed),
      mostUsedModel: agent.model,
      boundAiProvider: existing.boundAiProvider || agent.providerType,
      boundModel: agent.model || existing.boundModel,
      lastSeen: Date.now(),
    });
  } else {
    // New agent - create identity
    identities.set(sessionKey, {
      sessionKey,
      totalCostAllTime: agent.costToday,
      totalTokensAllTime: agent.tokensUsed,
      totalSessionsAllTime: 1,
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      totalMessages: agent.messagesProcessed,
      totalTurns: 0,
      mostUsedModel: agent.model,
      boundAiProvider: agent.providerType,
      boundModel: agent.model,
    });
  }
  
  await saveAgentIdentities(identities);
}

// ─── Restore Agent from Identity ──────────────────────────

export async function restoreAgentIdentity(agent: OfficeAgent): Promise<OfficeAgent> {
  const sessionKey = getAgentIdentityKey(agent);
  const identities = await loadAgentIdentities();
  const identity = identities.get(sessionKey);
  
  if (!identity) {
    return agent;
  }

  return applyIdentityToAgent(agent, identity);
}

// ─── Batch Restore Agents ──────────────────────────────────

export async function restoreAllAgents(agents: OfficeAgent[]): Promise<OfficeAgent[]> {
  const identities = await loadAgentIdentities();

  const restored = agents.map(agent => {
    return applyIdentityToAgent(agent, getAgentIdentityByAgent(identities, agent));
  });

  // Sort: primary/bonded/customized agents first, then by bond level
  return restored.sort((a, b) => {
    const keyA = getAgentIdentityKey(a);
    const keyB = getAgentIdentityKey(b);
    const idA = identities.get(keyA);
    const idB = identities.get(keyB);

    // Primary agent always first
    if (idA?.isPrimary && !idB?.isPrimary) return -1;
    if (!idA?.isPrimary && idB?.isPrimary) return 1;

    // Customized agents before non-customized
    if (idA?.isCustomized && !idB?.isCustomized) return -1;
    if (!idA?.isCustomized && idB?.isCustomized) return 1;

    // Higher bond level first
    const levelA = idA?.bondLevel || 0;
    const levelB = idB?.bondLevel || 0;
    if (levelA !== levelB) return levelB - levelA;

    return 0; // preserve existing order otherwise
  });
}

// ─── Agent Statistics ──────────────────────────────────────

export async function getAgentStats(sessionKey: string): Promise<AgentIdentity | null> {
  const identities = await loadAgentIdentities();
  return identities.get(sessionKey) || null;
}

export async function getAllAgentStats(): Promise<AgentIdentity[]> {
  const identities = await loadAgentIdentities();
  return Array.from(identities.values());
}

// ─── Rename Agent ──────────────────────────────────────────

export async function renameAgent(sessionKey: string, newName: string): Promise<void> {
  await updateAgentIdentity(sessionKey, { customName: newName, isCustomized: true });
}

// ─── Set Main Agent for Provider ──────────────────────────

/**
 * Set one agent as the main pixel agent for its provider type.
 * Clears isPrimary from all other agents of the same provider.
 */
export async function setMainAgentForProvider(
  sessionKey: string,
  providerType: string,
): Promise<void> {
  const identities = await loadAgentIdentities();

  // Clear isPrimary from all agents of same provider
  for (const [key, identity] of identities) {
    if (identity.boundAiProvider === providerType && identity.isPrimary) {
      identities.set(key, { ...identity, isPrimary: false });
    }
  }

  // Set this agent as primary
  const existing = identities.get(sessionKey);
  if (existing) {
    identities.set(sessionKey, { ...existing, isPrimary: true, boundAiProvider: providerType });
  } else {
    identities.set(sessionKey, {
      sessionKey,
      totalCostAllTime: 0, totalTokensAllTime: 0, totalSessionsAllTime: 0,
      firstSeen: Date.now(), lastSeen: Date.now(), totalMessages: 0, totalTurns: 0,
      isPrimary: true, boundAiProvider: providerType,
    });
  }

  await saveAgentIdentities(identities);
}

// ─── Customize Agent Appearance ────────────────────────────

export async function customizeAgent(
  sessionKey: string,
  appearance: Partial<AgentAppearance>
): Promise<void> {
  const identities = await loadAgentIdentities();
  const existing = identities.get(sessionKey);
  await updateAgentIdentity(sessionKey, {
    appearance: {
      ...DEFAULT_APPEARANCE,
      ...(existing?.appearance || {}),
      ...appearance,
    },
  });
}

// ─── Get All Session Keys ──────────────────────────────────

export async function getAllKnownSessionKeys(): Promise<string[]> {
  const identities = await loadAgentIdentities();
  return Array.from(identities.keys());
}

// ─── Cleanup Old Agents ────────────────────────────────────

export async function cleanupOldAgents(daysOld: number = 90): Promise<number> {
  const identities = await loadAgentIdentities();
  const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
  
  let cleaned = 0;
  for (const [key, identity] of identities.entries()) {
    if (identity.lastSeen < cutoff) {
      identities.delete(key);
      cleaned++;
    }
  }
  
  await saveAgentIdentities(identities);
  return cleaned;
}

// ─── Export/Import ─────────────────────────────────────────

export async function exportAgentIdentities(): Promise<string> {
  const identities = await loadAgentIdentities();
  const data = Object.fromEntries(identities.entries());
  return JSON.stringify(data, null, 2);
}

export async function importAgentIdentities(jsonData: string): Promise<number> {
  try {
    const data = JSON.parse(jsonData) as Record<string, AgentIdentity>;
    const identities = new Map<string, AgentIdentity>(Object.entries(data));
    await saveAgentIdentities(identities);
    return identities.size;
  } catch (error) {
    console.error('Failed to import agent identities:', error);
    throw error;
  }
}
