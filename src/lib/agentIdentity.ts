// Agent Identity System - Persistent agent data based on sessionKey
// This ensures agents keep their identity even when connections change

import { storage } from './storage';
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
  try {
    const obj = Object.fromEntries(identities.entries());
    await storage.setItem(STORAGE_KEY_AGENT_IDENTITY, JSON.stringify(obj));
  } catch (error) {
    console.error('Failed to save agent identities:', error);
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
