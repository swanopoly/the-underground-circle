/**
 * serviceProfileSouls — Phase C3 of the OpenSwan/Chat Architecture Plan.
 *
 * Single source of truth that maps the OpenSwan service menu's
 * `sessionProfile` (Build/Review/Debug/Arch) to SOUL spirit IDs and
 * preferred models. Every file that cares about "which SOUL is active"
 * imports from here instead of guessing.
 */

import type { SessionCodingProfile } from './chatSessionProfile';

export const PROFILE_SOUL_MAP: Record<SessionCodingProfile, string> = {
  auto:      'sr-engineer',
  senior:    'sr-engineer',
  review:    'code-reviewer',
  debug:     'sr-engineer',     // debug shares the engineer SOUL; no distinct debugger spirit yet
  architect: 'architect',
};

export function soulKeyForProfile(profile: SessionCodingProfile): string {
  return `soul:${PROFILE_SOUL_MAP[profile] || 'sr-engineer'}`;
}

export function spiritIdForProfile(profile: SessionCodingProfile): string {
  return PROFILE_SOUL_MAP[profile] || 'sr-engineer';
}

// Per-SOUL model preferences. User's explicit model pick always wins;
// this is the fallback when the user has "auto" selected.
const SOUL_MODEL_DEFAULTS: Record<string, string> = {
  'sr-engineer':  'claude-sonnet-4-6',
  'code-reviewer': 'claude-haiku-4-5-20251001',
  architect:      'claude-sonnet-4-6',
  'civil-engineer': 'claude-sonnet-4-6',
  debugger:       'claude-sonnet-4-6',
  designer:       'claude-sonnet-4-6',
  writer:         'claude-sonnet-4-6',
  'ml-engineer':  'claude-sonnet-4-6',
  'ai-researcher':'claude-sonnet-4-6',
};

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Resolve the model to use for a given SOUL + user preference.
 * User's explicit pick always wins. 'auto' defers to the SOUL's
 * preferred model. Unknown SOULs fall back to Haiku.
 */
export function resolveModelForSoul(
  spiritId: string | null | undefined,
  userModelPick: string | null | undefined,
): string {
  if (userModelPick && userModelPick !== 'auto') return userModelPick;
  if (!spiritId) return DEFAULT_MODEL;
  return SOUL_MODEL_DEFAULTS[spiritId] || DEFAULT_MODEL;
}

// BlackSwan failover chain: if primary model fails (rate limit,
// billing, auth), automatically try the next model in the chain.
const MODEL_FAILOVER: Record<string, string[]> = {
  'claude-sonnet-4-6':          ['claude-haiku-4-5-20251001', 'gemini-2.5-flash'],
  'claude-opus-4-6':            ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'claude-haiku-4-5-20251001':  ['gemini-2.5-flash'],
  'gemini-2.5-pro':             ['claude-sonnet-4-6'],
  'gemini-2.5-flash':           ['claude-haiku-4-5-20251001'],
};

export function getModelFailoverChain(model: string): string[] {
  return MODEL_FAILOVER[model] || [DEFAULT_MODEL];
}
