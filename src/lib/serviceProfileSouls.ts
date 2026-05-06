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
): string {
  return resolveModelForSoul(
    spiritIdForProfile(profile),
    userModelPick,
    intent,
    /* complexity */ undefined,
    /* buildConverging */ undefined,
    /* buildExploring */ undefined,
    connectedProviders,
  );
}

// Per-SOUL model preferences. User's explicit model pick always wins;
// this is the fallback when the user has "auto" selected.
// Canonical short IDs only (no date suffixes) — matches the rest of the app.
const SOUL_MODEL_DEFAULTS: Record<string, string> = {
  'sr-engineer':  'claude-sonnet-4-6',
  'code-reviewer': 'claude-haiku-4-5',
  architect:      'claude-sonnet-4-6',
  'civil-engineer': 'claude-sonnet-4-6',
  debugger:       'claude-sonnet-4-6',
  designer:       'claude-sonnet-4-6',
  writer:         'claude-sonnet-4-6',
  'ml-engineer':  'claude-sonnet-4-6',
  'ai-researcher':'claude-sonnet-4-6',
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
 * Connected marketplace providers used to bias the Auto router. Today
 * only the OpenRouter route is fully wired in the edge function; when
 * the rest of the Wave 2 native providers (OpenAI / Google AI / Groq /
 * etc.) get their own edge-function handlers, this set will widen and
 * the routing table below can prefer them directly.
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

  const OR_OPUS = 'openrouter/anthropic/claude-opus-4';
  const OR_SONNET = 'openrouter/anthropic/claude-sonnet-4';
  const OR_FAST = 'openrouter/openai/gpt-5-mini';
  const OR_LONG = 'openrouter/google/gemini-2.5-pro';

  // Exploring phase: ask one focused question — Haiku is plenty, ~2-3x
  // faster than Sonnet. User-visible latency drops hard here because
  // discovery turns are the most latency-sensitive part of the flow
  // (each one gates the next user action).
  if (buildExploring) return orConnected ? OR_FAST : HAIKU;

  // Build-converging phase always gets Opus — the model is about to commit
  // to a brief, and this is where reasoning depth matters most.
  if (buildConverging) return orConnected ? OR_OPUS : OPUS;

  if (intent) {
    const isLight = complexity === 'trivial' || complexity === 'simple';
    const isHeavy = complexity === 'complex';

    // Always-Haiku intents regardless of complexity — low signal, low cost.
    if (intent === 'casual' || intent === 'social' || intent === 'status' || intent === 'memory') {
      return orConnected ? OR_FAST : HAIKU;
    }

    // Questions: Haiku for simple factual, Sonnet when they ask "compare" /
    // "tradeoffs" / "which is better" (caught as moderate+ complexity).
    if (intent === 'question') {
      if (orConnected) return isLight ? OR_FAST : OR_SONNET;
      return isLight ? HAIKU : SONNET;
    }

    // Research + architect ALWAYS reach for Opus. These are the scenarios
    // where the model has to hold multiple threads in its head. Long-form
    // research benefits from Gemini's 2M context when the team has it
    // routed through OR.
    if (intent === 'research') {
      return orConnected ? OR_LONG : OPUS;
    }
    if (intent === 'architect') {
      return orConnected ? OR_OPUS : OPUS;
    }

    // Coding intents scale with complexity.
    if (intent === 'build' || intent === 'debug' || intent === 'review') {
      if (orConnected) return isHeavy ? OR_OPUS : OR_SONNET;
      if (isHeavy) return OPUS;
      return SONNET;
    }

    // Remaining intents (task_mgmt, creative, design, support, browser).
    if (intent === 'design' || intent === 'creative') {
      return orConnected ? OR_SONNET : SONNET;
    }
    if (intent === 'task_mgmt' || intent === 'support' || intent === 'browser') {
      if (orConnected) return isLight ? OR_FAST : OR_SONNET;
      return isLight ? HAIKU : SONNET;
    }
  }

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
