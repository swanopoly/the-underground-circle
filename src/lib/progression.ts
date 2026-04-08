// progression.ts — Core progression logic: award XP, evaluate thresholds, create unlocks

import { supabase } from './supabase';
import {
  BOND_XP_AMOUNTS,
  MASTERY_XP_AMOUNTS,
  QUALITY_MULTIPLIERS,
  BOND_UNLOCKS,
  QualityTier,
  getBondLevel,
  getMasteryLevel,
  BondLevel,
  MasteryLevel,
} from './mastery';
import { emitXPEvent } from './rpgEvents';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ProgressionEvent {
  id: string;
  circle_id: string;
  user_id: string;
  agent_id: string;
  event_kind: string;
  xp_type: 'bond' | 'mastery';
  base_amount: number;
  effective_amount: number;
  quality_multiplier: number;
  combo_bonus: number;
  combo_kind: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AgentMasteryEntry {
  id: string;
  circle_id: string;
  user_id: string;
  agent_id: string;
  spirit: string;
  mastery_xp: number;
  mastery_level: number;
  mastery_title: string;
}

export interface AgentEvolutionUnlock {
  id: string;
  circle_id: string;
  user_id: string;
  agent_id: string;
  bond_level: number;
  unlock_kind: string;
  unlock_data: Record<string, unknown>;
  unlocked_at: string;
}

export interface AgentProgression {
  bondXP: number;
  bondLevel: BondLevel;
  bondTitle: string;
  masteryEntries: AgentMasteryEntry[];
  unlocks: AgentEvolutionUnlock[];
}

// ─── Anti-Spam: Repeat Count ────────────────────────────────────────────────

async function getRepeatCount(userId: string, agentId: string, eventKind: string): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('progression_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .eq('event_kind', eventKind)
    .gte('created_at', since);

  if (error) {
    console.warn('[progression] getRepeatCount error:', error.message);
    return 0;
  }
  return count ?? 0;
}

// ─── Award Bond XP ─────────────────────────────────────────────────────────

export async function awardBondXP(
  circleId: string,
  userId: string,
  agentId: string,
  eventKind: string,
  quality: QualityTier = 'normal',
  comboKind?: string,
  comboBonus: number = 0,
  metadata: Record<string, unknown> = {},
): Promise<{ effectiveAmount: number; totalBondXP: number } | null> {
  const baseAmount = BOND_XP_AMOUNTS[eventKind];
  if (baseAmount === undefined) {
    console.warn(`[progression] Unknown bond event_kind: ${eventKind}`);
    return null;
  }

  const qualityMultiplier = QUALITY_MULTIPLIERS[quality];
  const repeatCount = await getRepeatCount(userId, agentId, eventKind);
  const diminishing = 1 / Math.sqrt(Math.max(1, repeatCount));
  const effectiveAmount = Math.round(baseAmount * qualityMultiplier * diminishing) + comboBonus;

  const { error: insertError } = await supabase.from('progression_events').insert({
    circle_id: circleId,
    user_id: userId,
    agent_id: agentId,
    event_kind: eventKind,
    xp_type: 'bond',
    base_amount: baseAmount,
    effective_amount: effectiveAmount,
    quality_multiplier: qualityMultiplier,
    combo_bonus: comboBonus,
    combo_kind: comboKind ?? null,
    metadata,
  });

  if (insertError) {
    console.error('[progression] awardBondXP insert error:', insertError.message);
    return null;
  }

  const totalBondXP = await getBondXP(userId, agentId);

  // Check for level-up and emit RPG event
  const prevBondLevel = getBondLevel(totalBondXP - effectiveAmount);
  const newBondLevel = getBondLevel(totalBondXP);
  const didLevelUp = newBondLevel.level > prevBondLevel.level;

  emitXPEvent({
    xpAmount: effectiveAmount,
    xpType: 'bond',
    source: eventKind,
    agentName: agentId.includes('::') ? agentId.split('::')[1] : agentId,
    levelUp: didLevelUp,
    newLevel: didLevelUp ? newBondLevel.level : undefined,
    newTitle: didLevelUp ? newBondLevel.title : undefined,
  });

  return { effectiveAmount, totalBondXP };
}

// ─── Award Mastery XP ───────────────────────────────────────────────────────

export async function awardMasteryXP(
  circleId: string,
  userId: string,
  agentId: string,
  spirit: string,
  eventKind: string,
  quality: QualityTier = 'normal',
  metadata: Record<string, unknown> = {},
): Promise<{ effectiveAmount: number; masteryXP: number; masteryLevel: MasteryLevel } | null> {
  const baseAmount = MASTERY_XP_AMOUNTS[eventKind];
  if (baseAmount === undefined) {
    console.warn(`[progression] Unknown mastery event_kind: ${eventKind}`);
    return null;
  }

  const qualityMultiplier = QUALITY_MULTIPLIERS[quality];
  const repeatCount = await getRepeatCount(userId, agentId, eventKind);
  const diminishing = 1 / Math.sqrt(Math.max(1, repeatCount));
  const effectiveAmount = Math.round(baseAmount * qualityMultiplier * diminishing);

  const { error: insertError } = await supabase.from('progression_events').insert({
    circle_id: circleId,
    user_id: userId,
    agent_id: agentId,
    event_kind: eventKind,
    xp_type: 'mastery',
    base_amount: baseAmount,
    effective_amount: effectiveAmount,
    quality_multiplier: qualityMultiplier,
    combo_bonus: 0,
    combo_kind: null,
    metadata: { ...metadata, spirit },
  });

  if (insertError) {
    console.error('[progression] awardMasteryXP insert error:', insertError.message);
    return null;
  }

  // Upsert agent_mastery row
  const { data: existing } = await supabase
    .from('agent_mastery')
    .select('id, mastery_xp')
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .eq('spirit', spirit)
    .single();

  const newXP = (existing?.mastery_xp ?? 0) + effectiveAmount;
  const newLevel = getMasteryLevel(newXP);

  if (existing) {
    await supabase
      .from('agent_mastery')
      .update({
        mastery_xp: newXP,
        mastery_level: newLevel.level,
        mastery_title: newLevel.title,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('agent_mastery').insert({
      circle_id: circleId,
      user_id: userId,
      agent_id: agentId,
      spirit,
      mastery_xp: newXP,
      mastery_level: newLevel.level,
      mastery_title: newLevel.title,
    });
  }

  // Check for mastery level-up and emit RPG event
  const prevMasteryLevel = getMasteryLevel((existing?.mastery_xp ?? 0));
  const didMasteryLevelUp = newLevel.level > prevMasteryLevel.level;

  emitXPEvent({
    xpAmount: effectiveAmount,
    xpType: 'mastery',
    source: eventKind,
    agentName: agentId.includes('::') ? agentId.split('::')[1] : agentId,
    levelUp: didMasteryLevelUp,
    newLevel: didMasteryLevelUp ? newLevel.level : undefined,
    newTitle: didMasteryLevelUp ? newLevel.title : undefined,
  });

  return { effectiveAmount, masteryXP: newXP, masteryLevel: newLevel };
}

// ─── Get Bond XP Total ──────────────────────────────────────────────────────

export async function getBondXP(userId: string, agentId: string): Promise<number> {
  const { data, error } = await supabase
    .from('progression_events')
    .select('effective_amount')
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .eq('xp_type', 'bond');

  if (error) {
    console.error('[progression] getBondXP error:', error.message);
    return 0;
  }

  return (data ?? []).reduce((sum, row) => sum + (row.effective_amount ?? 0), 0);
}

// ─── Evaluate Bond Unlocks ──────────────────────────────────────────────────

export async function evaluateBondUnlocks(
  circleId: string,
  userId: string,
  agentId: string,
  bondLevel: number,
): Promise<AgentEvolutionUnlock[]> {
  const newUnlocks: AgentEvolutionUnlock[] = [];

  for (const [levelStr, unlock] of Object.entries(BOND_UNLOCKS)) {
    const level = parseInt(levelStr, 10);
    if (level > bondLevel) continue;

    // Check if already unlocked
    const { data: existing } = await supabase
      .from('agent_evolution_unlocks')
      .select('id')
      .eq('user_id', userId)
      .eq('agent_id', agentId)
      .eq('unlock_kind', unlock.kind)
      .single();

    if (existing) continue;

    const { data: inserted, error } = await supabase
      .from('agent_evolution_unlocks')
      .insert({
        circle_id: circleId,
        user_id: userId,
        agent_id: agentId,
        bond_level: level,
        unlock_kind: unlock.kind,
        unlock_data: { label: unlock.label },
      })
      .select()
      .single();

    if (!error && inserted) {
      newUnlocks.push(inserted as AgentEvolutionUnlock);
    }
  }

  return newUnlocks;
}

// ─── Get Agent Progression ──────────────────────────────────────────────────

export async function getAgentProgression(
  userId: string,
  agentId: string,
): Promise<AgentProgression> {
  const bondXP = await getBondXP(userId, agentId);
  const bondLevel = getBondLevel(bondXP);

  const { data: masteryEntries } = await supabase
    .from('agent_mastery')
    .select('*')
    .eq('user_id', userId)
    .eq('agent_id', agentId);

  const { data: unlocks } = await supabase
    .from('agent_evolution_unlocks')
    .select('*')
    .eq('user_id', userId)
    .eq('agent_id', agentId);

  return {
    bondXP,
    bondLevel,
    bondTitle: bondLevel.title,
    masteryEntries: (masteryEntries ?? []) as AgentMasteryEntry[],
    unlocks: (unlocks ?? []) as AgentEvolutionUnlock[],
  };
}
