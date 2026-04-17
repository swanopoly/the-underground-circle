/**
 * Agent Bonding System
 *
 * Users bond with their custom Pixel Agents through interaction.
 * Custom agents are always prioritized over defaults.
 * When an agent is assigned a Claude session, it stays bound to that session.
 * The SOUL evolves through interaction — personality traits, communication style,
 * and strengths develop over time based on the bond level.
 */

import { supabase } from './supabase';
import { OfficeAgent } from './officeAgents';
import { AgentIdentity, getAgentIdentityKey, loadAgentIdentities, saveAgentIdentities } from './agentIdentity';

// ─── Bond Level Thresholds ──────────────────────────────────────────────────

export const BOND_LEVEL_THRESHOLDS = [
  { level: 1, xp: 0, title: 'Acquaintance' },
  { level: 2, xp: 100, title: 'Familiar' },
  { level: 3, xp: 300, title: 'Trusted' },
  { level: 4, xp: 600, title: 'Companion' },
  { level: 5, xp: 1000, title: 'Partner' },
  { level: 6, xp: 1500, title: 'Soulmate' },
  { level: 7, xp: 2500, title: 'Legendary' },
  { level: 8, xp: 4000, title: 'Mythic' },
  { level: 9, xp: 6000, title: 'Transcendent' },
  { level: 10, xp: 10000, title: 'Eternal' },
] as const;

export function getBondTitle(level: number): string {
  return BOND_LEVEL_THRESHOLDS.find(t => t.level === level)?.title || 'Unknown';
}

export function getLevelForXP(xp: number): number {
  for (let i = BOND_LEVEL_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= BOND_LEVEL_THRESHOLDS[i].xp) return BOND_LEVEL_THRESHOLDS[i].level;
  }
  return 1;
}

export function getXPToNextLevel(currentXP: number): { needed: number; total: number } | null {
  const currentLevel = getLevelForXP(currentXP);
  const next = BOND_LEVEL_THRESHOLDS.find(t => t.level === currentLevel + 1);
  if (!next) return null; // max level
  return { needed: next.xp - currentXP, total: next.xp };
}

// ─── XP Awards ──────────────────────────────────────────────────────────────

export const BOND_XP_ACTIONS = {
  message_sent: 2,           // user sends message to agent
  task_completed: 10,        // agent completes a task
  session_started: 5,        // new session started with agent
  customization_saved: 15,   // user customizes agent appearance
  name_given: 25,            // user gives agent a custom name
  soul_trait_learned: 20,    // agent learns a new trait
  daily_interaction: 8,      // first interaction of the day
  long_session: 15,          // session > 30 minutes
  milestone_reached: 50,     // agent hits a token/cost milestone
} as const;

// ─── Bond Types ─────────────────────────────────────────────────────────────

export interface AgentBond {
  id: string;
  userId: string;
  circleId: string;
  agentSessionKey: string;
  agentName: string;
  bondLevel: number;
  bondXP: number;
  interactionCount: number;
  totalTokensTogether: number;
  totalSessionsTogether: number;
  soulTraits: Record<string, number>;  // trait -> strength (0-100)
  favoriteTopics: string[];
  communicationStyle: string | null;
  strengths: string[];
  boundAiProvider: string | null;
  boundModel: string | null;
  isPrimary: boolean;
  appearanceSnapshot: Record<string, any> | null;
  firstBondedAt: string;
  lastInteractionAt: string;
}

// ─── Load/Create Bond ───────────────────────────────────────────────────────

export async function getOrCreateBond(
  userId: string,
  circleId: string,
  agent: OfficeAgent,
): Promise<AgentBond | null> {
  const sessionKey = getAgentIdentityKey(agent);

  // Try to load existing bond
  const { data: existing } = await supabase
    .from('agent_bonds')
    .select('*')
    .eq('user_id', userId)
    .eq('circle_id', circleId)
    .eq('agent_session_key', sessionKey)
    .single();

  if (existing) return dbRowToBond(existing);

  // Create new bond
  const { data: created, error } = await supabase
    .from('agent_bonds')
    .insert({
      user_id: userId,
      circle_id: circleId,
      agent_session_key: sessionKey,
      agent_name: agent.name,
      bound_ai_provider: agent.model?.includes('claude') ? 'claude' : agent.model?.includes('gemini') ? 'gemini' : null,
      bound_model: agent.model || null,
    })
    .select()
    .single();

  if (error) {
    console.warn('[AgentBonding] Failed to create bond:', error.message);
    return null;
  }
  return created ? dbRowToBond(created) : null;
}

// ─── Award Bond XP ──────────────────────────────────────────────────────────

export async function awardBondXP(
  bondId: string,
  action: keyof typeof BOND_XP_ACTIONS,
  extraXP: number = 0,
): Promise<{ newLevel: number; leveledUp: boolean } | null> {
  const xp = BOND_XP_ACTIONS[action] + extraXP;

  const { data: bond } = await supabase
    .from('agent_bonds')
    .select('bond_xp, bond_level')
    .eq('id', bondId)
    .single();

  if (!bond) return null;

  const newXP = bond.bond_xp + xp;
  const newLevel = getLevelForXP(newXP);
  const leveledUp = newLevel > bond.bond_level;

  await supabase
    .from('agent_bonds')
    .update({
      bond_xp: newXP,
      bond_level: newLevel,
      interaction_count: bond.bond_xp === 0 ? 1 : undefined, // increment handled below
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', bondId);

  // Increment interaction count
  await supabase.rpc('increment_bond_interaction', { bond_id_param: bondId });

  return { newLevel, leveledUp };
}

// ─── Record Interaction ─────────────────────────────────────────────────────

export async function recordBondInteraction(
  bondId: string,
  tokensUsed: number = 0,
): Promise<void> {
  await supabase
    .from('agent_bonds')
    .update({
      interaction_count: undefined, // handled by RPC
      total_tokens_together: undefined,
      last_interaction_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', bondId);
}

// ─── Bind AI Session to Agent ───────────────────────────────────────────────

/**
 * When a Claude/AI session is assigned to an agent, bind it so the session
 * stays with that agent across reconnects.
 */
export async function bindAISession(
  bondId: string,
  provider: string,
  model: string,
): Promise<void> {
  await supabase
    .from('agent_bonds')
    .update({
      bound_ai_provider: provider,
      bound_model: model,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bondId);
}

// ─── Set Primary Agent ──────────────────────────────────────────────────────

export async function setPrimaryAgent(
  userId: string,
  circleId: string,
  bondId: string,
): Promise<void> {
  // Clear existing primary
  await supabase
    .from('agent_bonds')
    .update({ is_primary: false })
    .eq('user_id', userId)
    .eq('circle_id', circleId);

  // Set new primary
  await supabase
    .from('agent_bonds')
    .update({ is_primary: true, updated_at: new Date().toISOString() })
    .eq('id', bondId);
}

// ─── Get User's Bonds (sorted: primary first, then by bond level) ───────────

export async function getUserBonds(
  userId: string,
  circleId: string,
): Promise<AgentBond[]> {
  const { data } = await supabase
    .from('agent_bonds')
    .select('*')
    .eq('user_id', userId)
    .eq('circle_id', circleId)
    .order('is_primary', { ascending: false })
    .order('bond_level', { ascending: false })
    .order('last_interaction_at', { ascending: false });

  return (data || []).map(dbRowToBond);
}

// ─── SOUL Trait Evolution ───────────────────────────────────────────────────

/**
 * Evolve the agent's SOUL traits based on interactions.
 * Traits strengthen with use and fade without it.
 */
export async function evolveSoulTraits(
  bondId: string,
  observedTraits: Record<string, number>,
): Promise<void> {
  const { data: bond } = await supabase
    .from('agent_bonds')
    .select('soul_traits')
    .eq('id', bondId)
    .single();

  if (!bond) return;

  const traits: Record<string, number> = bond.soul_traits || {};

  // Strengthen observed traits (cap at 100)
  for (const [trait, strength] of Object.entries(observedTraits)) {
    traits[trait] = Math.min(100, (traits[trait] || 0) + strength);
  }

  // Slight decay on unused traits (keeps SOUL dynamic)
  for (const trait of Object.keys(traits)) {
    if (!(trait in observedTraits)) {
      traits[trait] = Math.max(0, traits[trait] - 0.5);
    }
    // Remove dead traits
    if (traits[trait] <= 0) delete traits[trait];
  }

  await supabase
    .from('agent_bonds')
    .update({ soul_traits: traits, updated_at: new Date().toISOString() })
    .eq('id', bondId);
}

// ─── Save Conversation to Bond History ──────────────────────────────────────

export async function saveConversationMessage(
  bondId: string,
  circleId: string,
  role: 'user' | 'assistant' | 'system',
  content: string,
  modelUsed?: string,
  tokensUsed?: number,
): Promise<void> {
  await supabase.from('agent_conversation_history').insert({
    bond_id: bondId,
    circle_id: circleId,
    role,
    content,
    model_used: modelUsed || null,
    tokens_used: tokensUsed || 0,
  });
}

// ─── Load Recent Conversation History ───────────────────────────────────────

export async function loadConversationHistory(
  bondId: string,
  limit: number = 20,
): Promise<Array<{ role: string; content: string; createdAt: string }>> {
  const { data } = await supabase
    .from('agent_conversation_history')
    .select('role, content, created_at')
    .eq('bond_id', bondId)
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || []).reverse().map(row => ({
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  }));
}

// ─── Agent Memory (SOUL long-term context) ──────────────────────────────────

export async function addAgentMemory(
  bondId: string,
  memoryType: 'fact' | 'preference' | 'goal' | 'skill' | 'personality',
  content: string,
  importance: number = 5,
  source?: string,
): Promise<void> {
  await supabase.from('agent_memory').insert({
    bond_id: bondId,
    memory_type: memoryType,
    content,
    importance: Math.min(10, Math.max(1, importance)),
    source: source || null,
  });
}

export async function getAgentMemories(
  bondId: string,
  limit: number = 20,
): Promise<Array<{ type: string; content: string; importance: number }>> {
  const { data } = await supabase
    .from('agent_memory')
    .select('memory_type, content, importance')
    .eq('bond_id', bondId)
    .order('importance', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit);

  return (data || []).map(row => ({
    type: row.memory_type,
    content: row.content,
    importance: row.importance,
  }));
}

// ─── Prioritize Custom Agents ───────────────────────────────────────────────

/**
 * Sort agents so custom/bonded agents appear first, with the primary agent
 * at position 0. Agents with higher bond levels get priority.
 * Agents with bound AI sessions keep their session assignment.
 */
export function prioritizeAgents(
  agents: OfficeAgent[],
  bonds: AgentBond[],
): OfficeAgent[] {
  const bondMap = new Map(bonds.map(b => [b.agentSessionKey, b]));

  return [...agents].sort((a, b) => {
    const keyA = getAgentIdentityKey(a);
    const keyB = getAgentIdentityKey(b);
    const bondA = bondMap.get(keyA);
    const bondB = bondMap.get(keyB);

    // Primary agent always first
    if (bondA?.isPrimary && !bondB?.isPrimary) return -1;
    if (!bondA?.isPrimary && bondB?.isPrimary) return 1;

    // Bonded agents before unbonded
    if (bondA && !bondB) return -1;
    if (!bondA && bondB) return 1;

    // Higher bond level first
    if (bondA && bondB) {
      if (bondA.bondLevel !== bondB.bondLevel) return bondB.bondLevel - bondA.bondLevel;
      // More XP first at same level
      return bondB.bondXP - bondA.bondXP;
    }

    // Default: active agents first, then by name
    if (a.status !== b.status) {
      const rank = { active: 0, building: 1, idle: 2, error: 3, offline: 4 };
      return (rank[a.status] ?? 4) - (rank[b.status] ?? 4);
    }
    return a.name.localeCompare(b.name);
  });
}

/**
 * Check if an agent has a bound AI session. If so, restore its provider/model
 * so the session sticks with the agent.
 */
export function restoreBoundSession(
  agent: OfficeAgent,
  bond: AgentBond | undefined,
): OfficeAgent {
  if (!bond?.boundAiProvider || !bond?.boundModel) return agent;

  // Only override if the agent doesn't already have an active model
  if (!agent.model || agent.model === 'unknown') {
    return {
      ...agent,
      model: bond.boundModel,
    };
  }
  return agent;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function dbRowToBond(row: any): AgentBond {
  return {
    id: row.id,
    userId: row.user_id,
    circleId: row.circle_id,
    agentSessionKey: row.agent_session_key,
    agentName: row.agent_name,
    bondLevel: row.bond_level,
    bondXP: row.bond_xp,
    interactionCount: row.interaction_count,
    totalTokensTogether: row.total_tokens_together,
    totalSessionsTogether: row.total_sessions_together,
    soulTraits: row.soul_traits || {},
    favoriteTopics: row.favorite_topics || [],
    communicationStyle: row.communication_style,
    strengths: row.strengths || [],
    boundAiProvider: row.bound_ai_provider,
    boundModel: row.bound_model,
    isPrimary: row.is_primary,
    appearanceSnapshot: row.appearance_snapshot,
    firstBondedAt: row.first_bonded_at,
    lastInteractionAt: row.last_interaction_at,
  };
}
