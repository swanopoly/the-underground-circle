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
// Sonnet is the baseline across all souls — casual/social/status turns
// are still routed to Haiku below, but any task with real intent
// (build, review, question, research) gets at least Sonnet capability.
// This prevents "auto" from silently routing a non-trivial coding
// message to GPT-4.1 Mini or a nano-tier model just because a cheap
// provider is connected.
const SOUL_MODEL_DEFAULTS: Record<string, string> = {
  'sr-engineer':   'claude-sonnet-4-6',
  'code-reviewer': 'claude-sonnet-4-6',
  architect:       'claude-sonnet-4-6',
  'civil-engineer':'claude-sonnet-4-6',
  debugger:        'claude-sonnet-4-6',
  designer:        'claude-sonnet-4-6',
  writer:          'claude-sonnet-4-6',
  'ml-engineer':   'claude-sonnet-4-6',
  'ai-researcher': 'claude-sonnet-4-6',
};

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Resolve the model to use for a given SOUL + user preference.
 *
 * Priority:
 *   1. User's explicit dropdown pick (when not `auto`) — always wins.
 *   2. Intent × complexity table below — routes between Haiku, Sonnet,
 *      and stronger non-Anthropic connected providers based on how much
 *      reasoning the message needs.
 *   3. SOUL defaults.
 *   4. Haiku fallback.
 *
 * Opus and BlackSwan are intentionally not part of Auto. They remain
 * available as explicit picks, but Auto should not create surprise spend or
 * route tool/computer work through an app-grounding model that may fall back.
 */
/**
 * Connected marketplace providers used to bias the Auto router. OpenRouter
 * still gets first preference when present because it can route across
 * multiple vendors. Direct BYOK providers then let Auto use each user's own
 * stored key through llm-proxy instead of falling back to platform keys.
 */
export type ConnectedProviderSet = ReadonlySet<string>;

function hasProvider(providers: ConnectedProviderSet | undefined, provider: string): boolean {
  if (!providers) return false;
  if (providers.has(provider)) return true;
  if (provider === 'huggingface') return providers.has('hugging_face');
  if (provider === 'zai') return providers.has('z_ai');
  return false;
}

function firstConnected(
  providers: ConnectedProviderSet | undefined,
  candidates: Array<[provider: string, model: string | null]>,
): string | null {
  for (const [provider, model] of candidates) {
    if (model && hasProvider(providers, provider)) return model;
  }
  return null;
}

export function resolveModelForSoul(
  spiritId: string | null | undefined,
  userModelPick: string | null | undefined,
  intent?: import('./agenticCodingProfile').MessageIntent,
  complexity?: import('./agenticCodingProfile').MessageComplexity,
  /** When true (the Phase-1 `converging` state), use a stronger model
   *  than Haiku, but do not auto-escalate to Opus. */
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
  // Auto should prefer user-connected BYOK providers first, not the
  // platform Claude key. The ladders below model provider strengths:
  // cheap/local for low-value turns, search-grounded for research,
  // long-context for large reads, code-specialists for builds, and
  // browser-safe chat models for Stagehand/browser planning.
  const orConnected = hasProvider(connectedProviders, 'openrouter');
  const anthropicConnected = hasProvider(connectedProviders, 'anthropic');

  const directNano = firstConnected(connectedProviders, [
    ['ollama', 'ollama/llama3.2'],
    ['openai', 'openai/gpt-5.4-nano'],
    ['groq', 'groq/llama-3.3-70b-versatile'],
    ['google_ai', 'google_ai/gemini-3.1-flash-lite'],
    ['deepseek', 'deepseek/deepseek-chat'],
    ['mistral_ai', 'mistral_ai/mistral-small-latest'],
    ['zai', 'zai/glm-4-flash'],
    ['minimax', 'minimax/MiniMax-Text-01'],
  ]);
  const directFast = firstConnected(connectedProviders, [
    ['groq', 'groq/llama-3.3-70b-versatile'],
    ['google_ai', 'google_ai/gemini-3.5-flash'],
    ['openai', 'openai/gpt-5.4-mini'],
    ['deepseek', 'deepseek/deepseek-chat'],
    ['mistral_ai', 'mistral_ai/mistral-large-latest'],
    ['together_ai', 'together_ai/meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    ['fireworks_ai', 'fireworks_ai/accounts/fireworks/models/llama-v3p1-405b-instruct'],
    ['huggingface', 'huggingface/Qwen/Qwen3-32B'],
    ['zai', 'zai/glm-4-air'],
    ['minimax', 'minimax/MiniMax-Text-01'],
  ]);
  const directStrong = firstConnected(connectedProviders, [
    ['openai', 'openai/gpt-5.5'],
    ['google_ai', 'google_ai/gemini-3.5-flash'],
    ['google_ai', 'google_ai/gemini-2.5-pro'],
    ['deepseek', 'deepseek/deepseek-reasoner'],
    ['mistral_ai', 'mistral_ai/mistral-large-latest'],
    ['cohere', 'cohere/command-r-plus'],
    ['together_ai', 'together_ai/Qwen/Qwen3-235B-A22B-fp8-tput'],
    ['fireworks_ai', 'fireworks_ai/accounts/fireworks/models/deepseek-r1'],
    ['zai', 'zai/glm-5'],
    ['minimax', 'minimax/MiniMax-M1'],
    ['huggingface', 'huggingface/Qwen/Qwen3-235B-A22B'],
  ]);
  const directCode = firstConnected(connectedProviders, [
    ['openai', 'openai/gpt-5.5'],
    ['mistral_ai', 'mistral_ai/codestral-latest'],
    ['deepseek', 'deepseek/deepseek-chat'],
    ['together_ai', 'together_ai/Qwen/Qwen3-235B-A22B-fp8-tput'],
    ['fireworks_ai', 'fireworks_ai/accounts/fireworks/models/deepseek-r1'],
    ['zai', 'zai/glm-5'],
    ['huggingface', 'huggingface/Qwen/Qwen3-235B-A22B'],
  ]) || directStrong;
  const directReasoner = firstConnected(connectedProviders, [
    ['openai', 'openai/gpt-5.5'],
    ['deepseek', 'deepseek/deepseek-reasoner'],
    ['google_ai', 'google_ai/gemini-2.5-pro'],
    ['fireworks_ai', 'fireworks_ai/accounts/fireworks/models/deepseek-r1'],
    ['together_ai', 'together_ai/Qwen/Qwen3-235B-A22B-fp8-tput'],
  ]) || directStrong;
  const directResearch = firstConnected(connectedProviders, [
    ['perplexity', 'perplexity/sonar-deep-research'],
    ['perplexity', 'perplexity/sonar-reasoning-pro'],
    ['perplexity', 'perplexity/sonar-pro'],
    ['google_ai', 'google_ai/gemini-2.5-pro'],
    ['openai', 'openai/gpt-5.5'],
    ['cohere', 'cohere/command-r-plus'],
    ['deepseek', 'deepseek/deepseek-reasoner'],
  ]) || directReasoner || directStrong;
  const directBrowser = firstConnected(connectedProviders, [
    ['google_ai', 'google_ai/gemini-3.5-flash'],
    ['openai', 'openai/gpt-5.4-mini'],
    ['anthropic', SONNET],
    ['mistral_ai', 'mistral_ai/mistral-large-latest'],
    ['deepseek', 'deepseek/deepseek-chat'],
  ]) || directFast || directStrong;
  const directLong = firstConnected(connectedProviders, [
    ['google_ai', 'google_ai/gemini-3.5-flash'],
    ['google_ai', 'google_ai/gemini-2.5-pro'],
    ['minimax', 'minimax/MiniMax-M1'],
    ['cohere', 'cohere/command-r-plus'],
    ['openai', 'openai/gpt-5.5'],
  ]) || directStrong;

  const OR_SONNET = 'openrouter/anthropic/claude-sonnet-4-6';
  const OR_REASONER = 'openrouter/openai/gpt-5.5';
  const OR_FAST = 'openrouter/openai/gpt-5.4-mini';
  const OR_LONG = 'openrouter/google/gemini-3.5-flash';
  const OR_BROWSER = 'openrouter/google/gemini-3.5-flash';

  // Exploring phase: ask one focused question — Haiku is plenty, ~2-3x
  // faster than Sonnet. User-visible latency drops hard here because
  // discovery turns are the most latency-sensitive part of the flow
  // (each one gates the next user action).
  if (buildExploring) return directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);

  // Build-converging needs more reasoning than a clarifying question, but
  // Sonnet / connected reasoners are enough for the first brief. Opus stays
  // opt-in so Auto cannot create high-cost surprises.
  if (buildConverging) return directStrong || (orConnected ? OR_REASONER : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);

  if (intent) {
    const isLight = complexity === 'trivial' || complexity === 'simple';
    const isHeavy = complexity === 'complex';

    // Always-Haiku-class intents regardless of complexity — low
    // signal, low cost. When OpenAI is connected we lean on the
    // nano tier (gpt-4.1-nano) which is even cheaper than Haiku on
    // a per-token basis.
    if (intent === 'casual' || intent === 'social' || intent === 'status' || intent === 'memory') {
      return directNano || directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);
    }

    // Questions: Haiku is the new default. Only escalate when the
    // question is heavy (compare / tradeoffs / which-is-better caught
    // as `complex`) — and even then, only Sonnet, not Opus.
    if (intent === 'question') {
      if (isHeavy) {
        return directStrong || (orConnected ? OR_SONNET : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
      }
      return directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);
    }

    // Research + architect use strong connected providers first and only
    // fall back to Sonnet on Anthropic. Opus is explicit-pick only.
    if (intent === 'research') {
      return directResearch || directLong || (orConnected ? OR_LONG : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
    }
    if (intent === 'architect') {
      return directReasoner || directStrong || (orConnected ? OR_REASONER : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
    }

    // Coding intents — Sonnet minimum even for non-heavy turns.
    // Real code tasks need a capable model regardless of complexity
    // classification; routing a build message to a nano-tier model
    // because it looked "simple" produces bad diffs and missed context.
    if (intent === 'build' || intent === 'debug' || intent === 'review') {
      if (isHeavy) {
        return directCode || (orConnected ? OR_REASONER : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
      }
      return directFast || (orConnected ? OR_SONNET : null) || (anthropicConnected ? SONNET : DEFAULT_MODEL);
    }

    // Design / creative — directFast (now GPT-4.1 / Gemini Flash tier)
    // is plenty for one-shot variations and edits.
    if (intent === 'design' || intent === 'creative') {
      return directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);
    }

    // Browser / computer-use planning must use a chat-compatible model.
    // Dedicated CUA execution is handled by the browser/computer runtime
    // (computer-use-agent edge function) which always enforces Sonnet.
    if (intent === 'browser') {
      if (directBrowser) return directBrowser;
      if (orConnected) return OR_BROWSER;
      return anthropicConnected ? SONNET : DEFAULT_MODEL;
    }

    // Task management / support — directFast (GPT-4.1 / Flash) is
    // fine; these are mostly state lookups not deep reasoning turns.
    if (intent === 'task_mgmt' || intent === 'support') {
      return directFast || (orConnected ? OR_FAST : null) || (anthropicConnected ? HAIKU : DEFAULT_MODEL);
    }
  }

  // Unknown intent or empty input — use Sonnet as the safe default so
  // the user never sees a mini-tier model chosen before they've typed
  // anything meaningful.
  const soulDefault = spiritId ? (SOUL_MODEL_DEFAULTS[spiritId] || DEFAULT_MODEL) : DEFAULT_MODEL;
  return directFast || (orConnected ? OR_SONNET : null) || (anthropicConnected ? soulDefault : DEFAULT_MODEL);
}

// BlackSwan failover chain: if primary model fails (rate limit,
// billing, auth), automatically try the next model in the chain.
const MODEL_FAILOVER: Record<string, string[]> = {
  [BLACKSWAN_ENDPOINT_MODEL_ID]:     ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
  'claude-sonnet-4-6':          ['claude-haiku-4-5-20251001', 'gemini-2.5-flash'],
  'claude-fable-5':             ['claude-opus-4-8', 'claude-sonnet-4-6'],
  'claude-opus-4-8':            ['claude-opus-4-7', 'claude-sonnet-4-6'],
  'claude-opus-4-7':            ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'claude-opus-4-6':            ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001'],
  'gpt-5.5-pro':                ['gpt-5.5', 'gpt-5.4', 'claude-sonnet-4-6'],
  'gpt-5.5':                    ['gpt-5.4', 'gpt-5.4-mini', 'claude-sonnet-4-6'],
  'gpt-5.4':                    ['gpt-5.4-mini', 'gpt-4.1', 'claude-sonnet-4-6'],
  'gpt-5.4-mini':               ['gpt-4.1', 'gemini-3.1-flash-lite'],
  'claude-haiku-4-5-20251001':  ['gemini-2.5-flash'],
  'gemini-3.5-flash':           ['gemini-2.5-pro', 'gemini-2.5-flash'],
  'gemini-3.1-pro-preview':     ['gemini-2.5-pro', 'claude-sonnet-4-6'],
  'gemini-3.1-flash-lite':      ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
  'gemini-2.5-pro':             ['claude-haiku-4-5-20251001'],
  'gemini-2.5-flash':           ['claude-haiku-4-5-20251001'],
  'sonar-deep-research':        ['sonar-reasoning-pro', 'sonar-pro'],
  'sonar-reasoning-pro':        ['sonar-pro', 'sonar'],
};

export function getModelFailoverChain(model: string): string[] {
  return MODEL_FAILOVER[model] || [DEFAULT_MODEL];
}
