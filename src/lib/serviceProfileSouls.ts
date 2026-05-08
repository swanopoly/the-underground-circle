/**
 * serviceProfileSouls — Phase C3 of the OpenSwan/Chat Architecture Plan.
 *
 * Single source of truth that maps the OpenSwan service menu's
 * `sessionProfile` (Build/Review/Debug/Arch) to SOUL spirit IDs and
 * preferred models. Every file that cares about "which SOUL is active"
 * imports from here instead of guessing.
 */

import type { SessionCodingProfile } from './chatSessionProfile';
import {
  BLACKSWAN_ENDPOINT_MODEL_ID,
  shouldUseBlackSwanForAuto,
} from './blackswanRouting';

export const PROFILE_SOUL_MAP: Record<SessionCodingProfile, string> = {
  auto:      'sr-engineer',
  senior:    'sr-engineer',
  review:    'code-reviewer',
  debug:     'sr-engineer',     // debug shares the engineer SOUL; no distinct debugger spirit yet
  architect: 'architect',
  research:  'ai-researcher',
  design:    'designer',
  support:   'civil-engineer',
};

export function soulKeyForProfile(profile: SessionCodingProfile): string {
  return `soul:${PROFILE_SOUL_MAP[profile] || 'sr-engineer'}`;
}

export function spiritIdForProfile(profile: SessionCodingProfile): string {
  return PROFILE_SOUL_MAP[profile] || 'sr-engineer';
}

export function resolveModelForProfile(
  profile: SessionCodingProfile,
  userModelPick: string | null | undefined,
  intent?: import('./agenticCodingProfile').MessageIntent,
  connectedProviders?: ConnectedProviderSet,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
): string {
  return resolveModelForSoul(
    spiritIdForProfile(profile),
    userModelPick,
    intent,
    complexity,
    /* buildConverging */ undefined,
    /* buildExploring */ undefined,
    connectedProviders,
  );
}

// Per-SOUL model preferences. User's explicit model pick always wins;
// this is the fallback when the user has "auto" selected.
//
// Defaults to Haiku across the board — the explicit-architect /
// explicit-research / heavy-complexity branches in the intent table
// below escalate to Opus / Sonnet on their own when the message
// actually needs more reasoning. Pinning Sonnet as the SOUL default
// meant chris was paying Sonnet rates for "thanks" and "got it" turns
// just because he's signed in as the sr-engineer SOUL.
const SOUL_MODEL_DEFAULTS: Record<string, string> = {
  'sr-engineer':   'claude-haiku-4-5',
  'code-reviewer': 'claude-haiku-4-5',
  architect:       'claude-haiku-4-5',
  'civil-engineer':'claude-haiku-4-5',
  debugger:        'claude-haiku-4-5',
  designer:        'claude-haiku-4-5',
  writer:          'claude-haiku-4-5',
  'ml-engineer':   'claude-haiku-4-5',
  'ai-researcher': 'claude-haiku-4-5',
};

const DEFAULT_MODEL = 'claude-haiku-4-5';

/**
 * Resolve the model to use for a given SOUL + user preference.
 *
 * Priority:
 *   1. User's explicit dropdown pick (when not `auto`) — always wins.
 *   2. Intent × complexity table below — routes between Haiku, Sonnet,
 *      and Opus 4.7 based on how much reasoning the message needs.
 *   3. SOUL defaults.
 *   4. Haiku fallback.
 *
 * Adding Opus 4.7 to the ladder (was Haiku/Sonnet only) means complex
 * planning, architecture, and converging build conversations get the
 * reasoning depth they actually need. Lightweight chat stays on Haiku
 * so Anthropic spend doesn't balloon.
 */
/**
 * Connected marketplace providers used to bias the Auto router. OpenRouter
 * still gets first preference when present because it can route across
 * multiple vendors. Direct BYOK providers then let Auto use each user's own
 * stored key through llm-proxy instead of falling back to platform keys.
 */
export type ConnectedProviderSet = ReadonlySet<string>;

export function resolveModelForSoul(
  spiritId: string | null | undefined,
  userModelPick: string | null | undefined,
  intent?: import('./agenticCodingProfile').MessageIntent,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
  /** When true (the Phase-1 `converging` state), bump to Opus regardless
   *  of complexity — the bot needs to reason well to propose a brief. */
  buildConverging?: boolean,
  /** When true, the current message is in the `exploring` phase — the bot
   *  is just asking the next clarifying question. Haiku handles this at a
   *  fraction of the latency of Sonnet/Opus. */
  buildExploring?: boolean,
  /** Marketplace integrations the team has connected. Lets Auto bias
   *  toward the user's BYOK keys — e.g., when OpenRouter is connected,
   *  routes through OR-prefixed Anthropic / OpenAI models so the bill
   *  goes to their OR account instead of the platform key. */
  connectedProviders?: ConnectedProviderSet,
): string {
  if (userModelPick && userModelPick !== 'auto') return userModelPick;

  const HAIKU = 'claude-haiku-4-5';
  const SONNET = 'claude-sonnet-4-6';
  const OPUS = 'claude-opus-4-7';
  const blackSwanConnected = !!connectedProviders?.has('blackswan');

  // OpenRouter routing — when the team has the OR key wired, prefer
  // routing Auto through OR so the spend lands on their account. We
  // map the same intent ladder to OR-prefixed slugs that the edge
  // function knows how to dispatch (see callMarketplaceProvider in
  // swanbot-ai). Different intents map to different upstream providers
  // since OR aggregates them all behind one key:
  //   - heavy reasoning  → Anthropic Opus 4
  //   - code / general   → Anthropic Sonnet 4
  //   - light / chat     → OpenAI GPT-5 mini (cheap + fast)
  //   - long context     → Google Gemini 2.5 Pro
  const orConnected = !!connectedProviders?.has('openrouter');
  const directFast =
    connectedProviders?.has('groq') ? 'groq/llama-3.3-70b-versatile'
    : connectedProviders?.has('openai') ? 'openai/gpt-4.1-mini'
    : null;
  const directStrong =
    connectedProviders?.has('openai') ? 'openai/gpt-4.1'
    : connectedProviders?.has('google_ai') ? 'google_ai/gemini-2.5-pro'
    : connectedProviders?.has('deepseek') ? 'deepseek/deepseek-reasoner'
    : null;
  const directLong =
    connectedProviders?.has('google_ai') ? 'google_ai/gemini-2.5-pro'
    : directStrong;

  const OR_OPUS = 'openrouter/anthropic/claude-opus-4';
  const OR_SONNET = 'openrouter/anthropic/claude-sonnet-4';
  const OR_FAST = 'openrouter/openai/gpt-5-mini';
  const OR_LONG = 'openrouter/google/gemini-2.5-pro';

  // Exploring phase: ask one focused question — Haiku is plenty, ~2-3x
  // faster than Sonnet. User-visible latency drops hard here because
  // discovery turns are the most latency-sensitive part of the flow
  // (each one gates the next user action).
  if (buildExploring) return blackSwanConnected ? BLACKSWAN_ENDPOINT_MODEL_ID : (orConnected ? OR_FAST : (directFast || HAIKU));

  // Build-converging phase always gets Opus — the model is about to commit
  // to a brief, and this is where reasoning depth matters most.
  if (buildConverging) return orConnected ? OR_OPUS : (directStrong || OPUS);

  if (intent) {
    const isLight = complexity === 'trivial' || complexity === 'simple';
    const isHeavy = complexity === 'complex';

    // Always-Haiku intents regardless of complexity — low signal, low cost.
    if (intent === 'casual' || intent === 'social' || intent === 'status' || intent === 'memory') {
      if (blackSwanConnected && shouldUseBlackSwanForAuto(intent, complexity)) return BLACKSWAN_ENDPOINT_MODEL_ID;
      return orConnected ? OR_FAST : (directFast || HAIKU);
    }

    // Questions: Haiku is the new default. Only escalate when the
    // question is heavy (compare / tradeoffs / which-is-better caught
    // as `complex`) — and even then, only Sonnet, not Opus.
    if (intent === 'question') {
      if (blackSwanConnected && shouldUseBlackSwanForAuto(intent, complexity)) return BLACKSWAN_ENDPOINT_MODEL_ID;
      if (isHeavy) {
        if (orConnected) return OR_SONNET;
        return directStrong || SONNET;
      }
      if (orConnected) return OR_FAST;
      return directFast || HAIKU;
    }

    // Research + architect still ALWAYS reach for Opus — these are
    // the scenarios where Auto explicitly accepts the cost trade
    // because the model has to hold multiple threads in its head.
    // Long-form research benefits from Gemini's 2M context when the
    // team has it routed through OR.
    if (intent === 'research') {
      return orConnected ? OR_LONG : (directLong || OPUS);
    }
    if (intent === 'architect') {
      return orConnected ? OR_OPUS : (directStrong || OPUS);
    }

    // Coding intents — Haiku by default, escalate only when the
    // message itself signals heavy complexity. Used to default to
    // Sonnet which made every "fix this typo" + "rename var" turn
    // cost ~5x more than necessary.
    if (intent === 'build' || intent === 'debug' || intent === 'review') {
      if (isHeavy) {
        if (orConnected) return OR_OPUS;
        return directStrong || OPUS;
      }
      if (orConnected) return OR_FAST;
      return directFast || HAIKU;
    }

    // Design / creative — Haiku by default; one-shot variations and
    // edits don't need a frontier model to pull off.
    if (intent === 'design' || intent === 'creative') {
      if (orConnected) return OR_FAST;
      return directFast || HAIKU;
    }

    // Task management / support / browser — Haiku across the board.
    // These flows are mostly state lookups or routing, not reasoning.
    if (intent === 'task_mgmt' || intent === 'support' || intent === 'browser') {
      if (blackSwanConnected && shouldUseBlackSwanForAuto(intent, complexity)) return BLACKSWAN_ENDPOINT_MODEL_ID;
      if (orConnected) return OR_FAST;
      return directFast || HAIKU;
    }
  }

  if (!spiritId) return DEFAULT_MODEL;
  return SOUL_MODEL_DEFAULTS[spiritId] || DEFAULT_MODEL;
}

// BlackSwan failover chain: if primary model fails (rate limit,
// billing, auth), automatically try the next model in the chain.
const MODEL_FAILOVER: Record<string, string[]> = {
  [BLACKSWAN_ENDPOINT_MODEL_ID]:     ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'claude-sonnet-4-6':          ['claude-haiku-4-5-20251001', 'gemini-2.5-flash'],
  'claude-opus-4-6':            ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'claude-haiku-4-5-20251001':  ['gemini-2.5-flash'],
  'gemini-2.5-pro':             ['claude-sonnet-4-6'],
  'gemini-2.5-flash':           ['claude-haiku-4-5-20251001'],
};

export function getModelFailoverChain(model: string): string[] {
  return MODEL_FAILOVER[model] || [DEFAULT_MODEL];
}
