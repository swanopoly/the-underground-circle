// mastery.ts — Mastery level thresholds, titles, spirit mapping

export interface MasteryLevel {
  level: number;
  title: string;
  xpRequired: number;
}

export const MASTERY_LEVELS: MasteryLevel[] = [
  { level: 1, title: 'Novice', xpRequired: 0 },
  { level: 2, title: 'Capable', xpRequired: 75 },
  { level: 3, title: 'Skilled', xpRequired: 200 },
  { level: 4, title: 'Expert', xpRequired: 450 },
  { level: 5, title: 'Specialist', xpRequired: 900 },
  { level: 6, title: 'Elite', xpRequired: 1600 },
  { level: 7, title: 'Master', xpRequired: 2600 },
];

export interface BondLevel {
  level: number;
  title: string;
  xpRequired: number;
}

export const BOND_LEVELS: BondLevel[] = [
  { level: 1, title: 'Acquaintance', xpRequired: 0 },
  { level: 2, title: 'Familiar', xpRequired: 100 },
  { level: 3, title: 'Trusted', xpRequired: 300 },
  { level: 4, title: 'Companion', xpRequired: 600 },
  { level: 5, title: 'Partner', xpRequired: 1000 },
  { level: 6, title: 'Soulmate', xpRequired: 1500 },
  { level: 7, title: 'Legendary', xpRequired: 2500 },
  { level: 8, title: 'Mythic', xpRequired: 4000 },
  { level: 9, title: 'Transcendent', xpRequired: 6000 },
  { level: 10, title: 'Eternal', xpRequired: 10000 },
];

export type QualityTier = 'low' | 'normal' | 'high' | 'exceptional';

export const QUALITY_MULTIPLIERS: Record<QualityTier, number> = {
  low: 0.75,
  normal: 1.0,
  high: 1.25,
  exceptional: 1.5,
};

export const BOND_XP_AMOUNTS: Record<string, number> = {
  session_started: 5,
  message_sent: 2,
  meaningful_reply: 4,
  task_completed: 12,
  user_feedback_positive: 10,
  long_session: 15,
  customization_saved: 12,
  name_given: 25,
  daily_interaction: 8,
  streak_day: 5,
  trust_escalation: 18,
  milestone_reached: 40,
};

export const MASTERY_XP_AMOUNTS: Record<string, number> = {
  successful_turn: 3,
  successful_task: 15,
  user_accepted_output: 10,
  user_reused_artifact: 12,
  high_quality_rating: 15,
  streak_same_spirit_day: 8,
  challenge_completed: 25,
  role_promotion: 40,
};

export const BOND_UNLOCKS: Record<number, { kind: string; label: string }> = {
  2: { kind: 'greeting_pack', label: 'Personalized Greeting Pack' },
  3: { kind: 'memory_basic', label: 'Basic Memory Depth' },
  4: { kind: 'aura_tier1', label: 'Aura Tier 1' },
  5: { kind: 'trait_reveal', label: 'Trait Reveal + Cosmetic Choice' },
  6: { kind: 'memory_contextual', label: 'Contextual Memory' },
  7: { kind: 'pet_upgrade', label: 'Pet Upgrade / Visual Mutation' },
  8: { kind: 'initiative_suggestive', label: 'Suggestive Initiative Mode' },
  9: { kind: 'workflow_pack', label: 'Personalized Workflow Pack' },
  10: { kind: 'signature_role', label: 'Signature Role Title + Appearance' },
};

export function getMasteryLevel(xp: number): MasteryLevel {
  for (let i = MASTERY_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= MASTERY_LEVELS[i].xpRequired) return MASTERY_LEVELS[i];
  }
  return MASTERY_LEVELS[0];
}

export function getBondLevel(xp: number): BondLevel {
  for (let i = BOND_LEVELS.length - 1; i >= 0; i--) {
    if (xp >= BOND_LEVELS[i].xpRequired) return BOND_LEVELS[i];
  }
  return BOND_LEVELS[0];
}

export function getMasteryProgress(xp: number): { current: MasteryLevel; next: MasteryLevel | null; progress: number } {
  const current = getMasteryLevel(xp);
  const nextIdx = MASTERY_LEVELS.findIndex(l => l.level === current.level) + 1;
  const next = nextIdx < MASTERY_LEVELS.length ? MASTERY_LEVELS[nextIdx] : null;
  if (!next) return { current, next: null, progress: 1 };
  const range = next.xpRequired - current.xpRequired;
  const into = xp - current.xpRequired;
  return { current, next, progress: range > 0 ? Math.min(into / range, 1) : 1 };
}

export function getBondProgress(xp: number): { current: BondLevel; next: BondLevel | null; progress: number } {
  const current = getBondLevel(xp);
  const nextIdx = BOND_LEVELS.findIndex(l => l.level === current.level) + 1;
  const next = nextIdx < BOND_LEVELS.length ? BOND_LEVELS[nextIdx] : null;
  if (!next) return { current, next: null, progress: 1 };
  const range = next.xpRequired - current.xpRequired;
  const into = xp - current.xpRequired;
  return { current, next, progress: range > 0 ? Math.min(into / range, 1) : 1 };
}
