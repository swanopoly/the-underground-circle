// Halo-inspired badge definitions
// Tiers: Recruit → Legend — escalating point thresholds

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'platinum' | 'legendary';

export interface Badge {
  id: string;
  name: string;
  description: string;
  lore: string;            // Halo-style flavor text
  pointsRequired: number;
  tier: BadgeTier;
  icon: string;            // emoji for the center glyph
  shape: 'hexagon' | 'shield' | 'star' | 'diamond' | 'circle';
  color: string;           // primary accent color
}

export const BADGES: Badge[] = [
  // ─── BRONZE TIER ─────────────────────────────────────────────────────────
  {
    id: 'recruit',
    name: 'Recruit',
    description: 'First steps into the Underground',
    lore: '"Every legend starts somewhere. Yours starts here."',
    pointsRequired: 10,
    tier: 'bronze',
    icon: '⚡',
    shape: 'hexagon',
    color: '#cd7f32',
  },
  {
    id: 'private',
    name: 'Private',
    description: 'Survived the first week',
    lore: '"You answered the call. Now the real work begins."',
    pointsRequired: 50,
    tier: 'bronze',
    icon: '🛡',
    shape: 'hexagon',
    color: '#cd7f32',
  },
  {
    id: 'corporal',
    name: 'Corporal',
    description: 'Learning the field',
    lore: '"Two steps ahead. You\'re beginning to understand the mission."',
    pointsRequired: 150,
    tier: 'bronze',
    icon: '🎯',
    shape: 'hexagon',
    color: '#cd7f32',
  },
  {
    id: 'sergeant',
    name: 'Sergeant',
    description: 'Proven under fire',
    lore: '"Your agents move with purpose. The Circle takes notice."',
    pointsRequired: 400,
    tier: 'bronze',
    icon: '⚔️',
    shape: 'shield',
    color: '#cd7f32',
  },
  // ─── SILVER TIER ─────────────────────────────────────────────────────────
  {
    id: 'staff_sergeant',
    name: 'Staff Sergeant',
    description: 'Commanding the field',
    lore: '"You\'ve earned the right to lead. Don\'t waste it."',
    pointsRequired: 1000,
    tier: 'silver',
    icon: '🔱',
    shape: 'shield',
    color: '#c0c0c0',
  },
  {
    id: 'gunnery_sergeant',
    name: 'Gunnery Sergeant',
    description: 'Master of sustained operations',
    lore: '"Relentless. Precise. The machines answer to you now."',
    pointsRequired: 2500,
    tier: 'silver',
    icon: '💠',
    shape: 'shield',
    color: '#c0c0c0',
  },
  {
    id: 'master_sergeant',
    name: 'Master Sergeant',
    description: 'Elite operator',
    lore: '"The Underground speaks your name in hushed tones."',
    pointsRequired: 5000,
    tier: 'silver',
    icon: '🌀',
    shape: 'star',
    color: '#c0c0c0',
  },
  // ─── GOLD TIER ───────────────────────────────────────────────────────────
  {
    id: 'warrant_officer',
    name: 'Warrant Officer',
    description: 'Technical supremacy',
    lore: '"Beyond rank. Beyond title. Your work speaks for itself."',
    pointsRequired: 10000,
    tier: 'gold',
    icon: '👁',
    shape: 'star',
    color: '#ffd700',
  },
  {
    id: 'lieutenant',
    name: 'Lieutenant',
    description: 'Commanding the digital battlefield',
    lore: '"You don\'t just use AI. You direct it. Shape it. Weaponize it."',
    pointsRequired: 25000,
    tier: 'gold',
    icon: '🔥',
    shape: 'star',
    color: '#ffd700',
  },
  {
    id: 'commander',
    name: 'Commander',
    description: 'Architect of the machine',
    lore: '"They said it couldn\'t be done at this scale. They were wrong."',
    pointsRequired: 50000,
    tier: 'gold',
    icon: '⚜️',
    shape: 'diamond',
    color: '#ffd700',
  },
  // ─── PLATINUM TIER ───────────────────────────────────────────────────────
  {
    id: 'captain',
    name: 'Captain',
    description: 'Leading the vanguard',
    lore: '"The future bends to operators like you."',
    pointsRequired: 100000,
    tier: 'platinum',
    icon: '🌟',
    shape: 'diamond',
    color: '#e5e4e2',
  },
  {
    id: 'major',
    name: 'Major',
    description: 'Strategic dominance',
    lore: '"Your circle is a force multiplier. The old world has no answer for this."',
    pointsRequired: 250000,
    tier: 'platinum',
    icon: '💫',
    shape: 'diamond',
    color: '#e5e4e2',
  },
  // ─── LEGENDARY TIER ──────────────────────────────────────────────────────
  {
    id: 'spartan',
    name: 'Spartan',
    description: 'Chosen. Augmented. Unstoppable.',
    lore: '"There are builders. There are operators. And then there is you."',
    pointsRequired: 500000,
    tier: 'legendary',
    icon: '🏆',
    shape: 'circle',
    color: '#00FF9C',
  },
  {
    id: 'demon',
    name: 'Demon',
    description: 'They fear what you\'ve become',
    lore: '"The Covenant called the Master Chief \'Demon\'. Now they call you the same."',
    pointsRequired: 1000000,
    tier: 'legendary',
    icon: '👾',
    shape: 'circle',
    color: '#00FF9C',
  },
];

export const TIER_COLORS: Record<BadgeTier, { bg: string; border: string; glow: string; label: string }> = {
  bronze:    { bg: '#2a1a0a', border: '#cd7f32', glow: '#cd7f3260', label: 'BRONZE' },
  silver:    { bg: '#0f1520', border: '#c0c0c0', glow: '#c0c0c060', label: 'SILVER' },
  gold:      { bg: '#1a1500', border: '#ffd700', glow: '#ffd70060', label: 'GOLD' },
  platinum:  { bg: '#1a1a2e', border: '#e5e4e2', glow: '#e5e4e260', label: 'PLATINUM' },
  legendary: { bg: '#001a0f', border: '#00FF9C', glow: '#00FF9C80', label: 'LEGENDARY' },
};

export function getBadgeById(id: string): Badge | undefined {
  return BADGES.find(b => b.id === id);
}

export function getNextBadge(currentPoints: number): Badge | undefined {
  return BADGES.find(b => b.pointsRequired > currentPoints);
}

export function getEarnedBadges(currentPoints: number): Badge[] {
  return BADGES.filter(b => b.pointsRequired <= currentPoints);
}

// Points earned per model tier per turn
export function getPointsForModel(model: string): number {
  const m = model.toLowerCase();
  if (m.includes('opus') || m.includes('gpt-4') || m.includes('gemini-ultra')) return 10;
  if (m.includes('sonnet') || m.includes('gpt-4o') || m.includes('claude-3-5')) return 5;
  if (m.includes('haiku') || m.includes('flash') || m.includes('mini')) return 2;
  return 3; // default
}

export function formatPoints(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}
