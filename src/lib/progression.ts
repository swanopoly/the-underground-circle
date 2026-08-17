// progression.ts — Core progression logic: award XP, evaluate thresholds, create unlocks

import { supabase } from './supabase';
import { safeGetUserForAccessToken } from './authSession';
import type {
  OfficeConnectionAuthorityFence,
  OfficeConnectionExactAuthority,
} from './connectionManager';

// A missing migration may make high-frequency award hooks noisy, but a
// process-lifetime boolean turned a later migration into a permanent false
// zero. Non-strict background writers use only a short cooldown; strict panel
// reads always probe and surface unavailable storage as an error.
const MISSING_TABLE_RETRY_MS = 30_000;
let progressionEventsUnavailableUntil = 0;
let agentMasteryUnavailableUntil = 0;
const onMissingTableCooldown = (until: number) => until > Date.now();
const isTableMissing = (err: unknown, relation?: string) => {
  const error = err as any;
  const message = `${error?.message || ''} ${error?.details || ''} ${error?.hint || ''}`.toLowerCase();
  const normalizedRelation = String(relation || '').toLowerCase();
  const namedMissingSignature = !!normalizedRelation && (
    message.includes(`could not find the table 'public.${normalizedRelation}' in the schema cache`)
    || message.includes(`relation "public.${normalizedRelation}" does not exist`)
    || message.includes(`relation "${normalizedRelation}" does not exist`)
  );
  return error?.code === 'PGRST205'
    || error?.code === '42P01'
    || (error?.status === 404 && namedMissingSignature);
};
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

export type AgentProgressionReadOptions = Readonly<{
  authority: OfficeConnectionExactAuthority;
  isAuthorityCurrent: OfficeConnectionAuthorityFence;
  strict?: boolean;
}>;

type VerifiedProgressionRead = Readonly<{
  authority: OfficeConnectionExactAuthority;
  strict: boolean;
}>;

async function verifyProgressionRead(
  userId: string,
  circleId: string | undefined,
  options?: AgentProgressionReadOptions,
): Promise<VerifiedProgressionRead | null> {
  if (!options) return null;
  const authority = options.authority;
  const valid = !!authority
    && authority.userId === userId
    && !!circleId
    && authority.circleId === circleId
    && !!authority.accessToken
    && authority.accessToken.length <= 16_384
    && Number.isSafeInteger(authority.generation)
    && authority.generation > 0
    && typeof options.isAuthorityCurrent === 'function'
    && options.isAuthorityCurrent(authority);
  if (!valid) throw new Error('Progression is unavailable for this retired Office session.');
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (verifiedUser?.id !== userId || !options.isAuthorityCurrent(authority)) {
    throw new Error('Progression is unavailable because the Office account changed.');
  }
  return { authority, strict: options.strict === true };
}

function assertProgressionReadCurrent(
  read: VerifiedProgressionRead | null,
  options?: AgentProgressionReadOptions,
): void {
  if (read && (!options || !options.isAuthorityCurrent(read.authority))) {
    throw new Error('Progression is unavailable for this retired Office session.');
  }
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
  if (onMissingTableCooldown(progressionEventsUnavailableUntil)) return 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('progression_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .eq('event_kind', eventKind)
    .gte('created_at', since);

  if (error) {
    if (isTableMissing(error, 'progression_events')) {
      progressionEventsUnavailableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
      return 0;
    }
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
  if (onMissingTableCooldown(progressionEventsUnavailableUntil)) return null;
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
    if (isTableMissing(insertError, 'progression_events')) {
      progressionEventsUnavailableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
      return null;
    }
    console.error('[progression] awardBondXP insert error:', insertError.message);
    return null;
  }

  const totalBondXP = await getBondXP(userId, agentId, circleId);

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
  if (onMissingTableCooldown(progressionEventsUnavailableUntil) || onMissingTableCooldown(agentMasteryUnavailableUntil)) return null;
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
    if (isTableMissing(insertError, 'progression_events')) {
      progressionEventsUnavailableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
      return null;
    }
    console.error('[progression] awardMasteryXP insert error:', insertError.message);
    return null;
  }

  // Upsert agent_mastery row
  const { data: existing, error: existingError } = await supabase
    .from('agent_mastery')
    .select('id, mastery_xp')
    .eq('user_id', userId)
    .eq('agent_id', agentId)
    .eq('spirit', spirit)
    .single();
  if (isTableMissing(existingError, 'agent_mastery')) {
    agentMasteryUnavailableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
    return null;
  }

  const newXP = (existing?.mastery_xp ?? 0) + effectiveAmount;
  const newLevel = getMasteryLevel(newXP);

  if (existing) {
    const { error: updateError } = await supabase
      .from('agent_mastery')
      .update({
        mastery_xp: newXP,
        mastery_level: newLevel.level,
        mastery_title: newLevel.title,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
    if (isTableMissing(updateError, 'agent_mastery')) {
      agentMasteryUnavailableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
      return null;
    }
    // Any OTHER error (RLS denial, constraint) also means the XP was not
    // written. Falling through emitted a real LEVEL UP popup for a level the
    // user does not have and will not have next session.
    if (updateError) return null;
  } else {
    const { error: insertMasteryError } = await supabase.from('agent_mastery').insert({
      circle_id: circleId,
      user_id: userId,
      agent_id: agentId,
      spirit,
      mastery_xp: newXP,
      mastery_level: newLevel.level,
      mastery_title: newLevel.title,
    });
    if (isTableMissing(insertMasteryError, 'agent_mastery')) {
      agentMasteryUnavailableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
      return null;
    }
    if (insertMasteryError) return null;
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

export async function getBondXP(
  userId: string,
  agentId: string,
  circleId?: string,
  agentAliases: string[] = [],
  readOptions?: AgentProgressionReadOptions,
): Promise<number> {
  const read = await verifyProgressionRead(userId, circleId, readOptions);
  if (!read?.strict && onMissingTableCooldown(progressionEventsUnavailableUntil)) return 0;
  const agentIds = Array.from(new Set([agentId, ...agentAliases].map(value => String(value || '').trim()).filter(Boolean)));
  let query = supabase
    .from('progression_events')
    .select('effective_amount')
    .eq('user_id', userId)
    .eq('xp_type', 'bond');
  if (circleId) query = query.eq('circle_id', circleId);
  if (agentIds.length === 1) query = query.eq('agent_id', agentIds[0]);
  else if (agentIds.length > 1) query = query.in('agent_id', agentIds);
  if (read) query = query.setHeader('Authorization', `Bearer ${read.authority.accessToken}`);
  const { data, error } = await query;
  assertProgressionReadCurrent(read, readOptions);

  if (error) {
    if (isTableMissing(error, 'progression_events')) {
      if (read?.strict) throw new Error('Agent bond progression storage is unavailable.');
      progressionEventsUnavailableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
      return 0;
    }
    console.warn('[progression] getBondXP error:', error.message);
    if (read?.strict) throw new Error('Agent bond progression could not be loaded.');
    return 0;
  }

  progressionEventsUnavailableUntil = 0;

  if (read?.strict && (data || []).some(row => !Number.isFinite(Number(row?.effective_amount)))) {
    throw new Error('Agent bond progression returned an invalid response.');
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
  circleId?: string,
  agentAliases: string[] = [],
  readOptions?: AgentProgressionReadOptions,
): Promise<AgentProgression> {
  const read = await verifyProgressionRead(userId, circleId, readOptions);
  const agentIds = Array.from(new Set([agentId, ...agentAliases].map(value => String(value || '').trim()).filter(Boolean)));
  const bondXP = await getBondXP(userId, agentId, circleId, agentAliases, readOptions);
  assertProgressionReadCurrent(read, readOptions);
  const bondLevel = getBondLevel(bondXP);

  let masteryEntries: any[] = [];
  if (read?.strict || !onMissingTableCooldown(agentMasteryUnavailableUntil)) {
    let masteryQuery = supabase
      .from('agent_mastery')
      .select('*')
      .eq('user_id', userId);
    if (circleId) masteryQuery = masteryQuery.eq('circle_id', circleId);
    if (agentIds.length === 1) masteryQuery = masteryQuery.eq('agent_id', agentIds[0]);
    else if (agentIds.length > 1) masteryQuery = masteryQuery.in('agent_id', agentIds);
    if (read) masteryQuery = masteryQuery.setHeader('Authorization', `Bearer ${read.authority.accessToken}`);
    const { data, error } = await masteryQuery;
    assertProgressionReadCurrent(read, readOptions);
    if (isTableMissing(error, 'agent_mastery')) {
      if (read?.strict) throw new Error('Agent mastery progression storage is unavailable.');
      agentMasteryUnavailableUntil = Date.now() + MISSING_TABLE_RETRY_MS;
    } else if (error) {
      if (read?.strict) throw new Error('Agent mastery progression could not be loaded.');
    } else {
      agentMasteryUnavailableUntil = 0;
      masteryEntries = data ?? [];
    }
  }

  let unlockQuery = supabase
    .from('agent_evolution_unlocks')
    .select('*')
    .eq('user_id', userId);
  if (circleId) unlockQuery = unlockQuery.eq('circle_id', circleId);
  if (agentIds.length === 1) unlockQuery = unlockQuery.eq('agent_id', agentIds[0]);
  else if (agentIds.length > 1) unlockQuery = unlockQuery.in('agent_id', agentIds);
  if (read) unlockQuery = unlockQuery.setHeader('Authorization', `Bearer ${read.authority.accessToken}`);
  const { data: unlocks, error: unlockError } = await unlockQuery;
  assertProgressionReadCurrent(read, readOptions);
  if (unlockError && read?.strict) {
    throw new Error(isTableMissing(unlockError, 'agent_evolution_unlocks')
      ? 'Agent evolution unlock storage is unavailable.'
      : 'Agent evolution unlocks could not be loaded.');
  }
  if (read?.strict) {
    const rows = [...masteryEntries, ...(unlocks || [])];
    if (rows.some(row => (
      String(row?.user_id || '') !== userId
      || (!!circleId && String(row?.circle_id || '') !== circleId)
      || (agentIds.length > 0 && !agentIds.includes(String(row?.agent_id || '')))
    ))) throw new Error('Agent progression returned an invalid identity receipt.');
  }

  return {
    bondXP,
    bondLevel,
    bondTitle: bondLevel.title,
    masteryEntries: masteryEntries as AgentMasteryEntry[],
    unlocks: (unlocks ?? []) as AgentEvolutionUnlock[],
  };
}
