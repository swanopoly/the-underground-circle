/**
 * billingPriority — single source of truth for "which connected
 * provider gets billed when the user invokes model X." Drives the
 * marketplace's billing-priority preview and the cross-provider
 * router's preference order.
 *
 * Why a separate module: two surfaces need the same logic — the
 * marketplace card footers (what to TELL the user about billing)
 * and the cross-provider router (how to actually route). Keeping
 * the rules in one place avoids drift between what we say and what
 * we do.
 */

import type { LLMProvider } from './llmProviders';
import type { ProviderRoute } from './crossProviderRouter';

/** Per-user preference for how to order providers when multiple keys
 *  are connected. Default `cheapest` keeps surprise Anthropic spend
 *  down by preferring local/free/low-cost connected providers first. */
export type ProviderRoutingMode = 'prefer_direct' | 'prefer_openrouter' | 'cheapest';

const STORAGE_KEY = 'uc_provider_routing_mode_v1';

export function getProviderRoutingMode(): ProviderRoutingMode {
  if (typeof window === 'undefined' || !window.localStorage) return 'cheapest';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'prefer_openrouter' || raw === 'cheapest' || raw === 'prefer_direct') return raw;
  } catch {}
  return 'cheapest';
}

export function setProviderRoutingMode(mode: ProviderRoutingMode): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.setItem(STORAGE_KEY, mode); } catch {}
}

/** Translate a routing mode into the preference array consumed by
 *  `resolveProviderRoutes`. Pure — no I/O. */
export function preferenceForMode(mode: ProviderRoutingMode): Array<ProviderRoute['provider']> {
  if (mode === 'prefer_openrouter') {
    return ['openrouter', 'openai_compatible', 'anthropic-direct', 'openai', 'google_ai', 'deepseek', 'groq', 'mistral_ai', 'cohere', 'perplexity', 'together_ai', 'fireworks_ai', 'zai', 'minimax', 'huggingface', 'ollama', 'openswan'];
  }
  if (mode === 'cheapest') {
    // Free tier first, then OR (which has cheap routing across
    // providers), then direct (often cheaper than OR for cached
    // requests but not for first-time hits).
    return ['ollama', 'openai_compatible', 'huggingface', 'groq', 'openrouter', 'deepseek', 'google_ai', 'mistral_ai', 'anthropic-direct', 'openai', 'together_ai', 'fireworks_ai', 'zai', 'minimax', 'cohere', 'perplexity', 'openswan'];
  }
  // prefer_direct (default): native passthrough first, then OR
  // broad fallback, then HF.
  return ['openai_compatible', 'anthropic-direct', 'openai', 'google_ai', 'deepseek', 'groq', 'mistral_ai', 'cohere', 'perplexity', 'together_ai', 'fireworks_ai', 'zai', 'minimax', 'openrouter', 'huggingface', 'ollama', 'openswan'];
}

/** What appears in the marketplace as the "billing priority" preview
 *  for a single provider. */
export interface BillingRouteEntry {
  provider: LLMProvider | 'openswan';
  label: string;
  /** True when this is the FIRST place a relevant model would be
   *  billed (highest priority). Drives the green "primary" pill in
   *  the marketplace. */
  isPrimary: boolean;
  /** Human-readable scope of what this provider is used FOR. */
  scope: string;
  /** Why it sits where it does — surfaced as small grey text. */
  reason: string;
}

const PROVIDER_DISPLAY: Record<string, { label: string; scope: string }> = {
  'anthropic':       { label: 'Anthropic',     scope: 'Claude Opus / Sonnet / Haiku' },
  'openai':          { label: 'OpenAI',        scope: 'GPT-4o / 4.1 / o-series' },
  'openai_compatible': { label: 'Business Model', scope: 'Custom OpenAI-compatible endpoints' },
  'groq':            { label: 'Groq',          scope: 'Llama / Mixtral (fast)' },
  'openrouter':      { label: 'OpenRouter',    scope: 'Anything else + web search' },
  'google_ai':       { label: 'Google AI',     scope: 'Gemini long-context + browser planning' },
  'mistral_ai':      { label: 'Mistral AI',    scope: 'Mistral + Codestral' },
  'cohere':          { label: 'Cohere',        scope: 'Command R / retrieval-heavy chat' },
  'perplexity':      { label: 'Perplexity',    scope: 'Search-grounded Sonar models' },
  'together_ai':     { label: 'Together AI',   scope: 'Hosted open-source models' },
  'fireworks_ai':    { label: 'Fireworks AI',  scope: 'Low-latency OSS inference' },
  'deepseek':        { label: 'DeepSeek',      scope: 'Reasoning + code models' },
  'huggingface':     { label: 'Hugging Face',  scope: 'Open-source models + free tier' },
  'replicate':       { label: 'Replicate',     scope: 'Image / video / audio gen' },
  'ollama':          { label: 'Ollama (Local)',scope: 'Self-hosted models' },
  'zai':             { label: 'Z.AI / GLM',    scope: 'GLM family' },
  'minimax':         { label: 'MiniMax',       scope: 'MiniMax family' },
  'github-models':   { label: 'GitHub Models', scope: 'GitHub PAT inference' },
  'openswan':        { label: 'OpenSwan',      scope: 'Local agent runtime' },
};

/**
 * Build the priority list a user sees in the marketplace, given the
 * providers they have connected. Returns entries in billing order —
 * primary first, fallbacks after. Reasons are computed from the
 * user's mode + which native+OR pairs they have.
 */
export function buildBillingPreview(
  connectedProviders: Set<LLMProvider | 'openswan'>,
  mode: ProviderRoutingMode = 'cheapest',
): BillingRouteEntry[] {
  const order: Array<LLMProvider | 'openswan'> = [];
  const preference = preferenceForMode(mode);
  // Map preference (which uses ProviderRoute identifiers) onto the
  // user-facing connected provider names. anthropic-direct → anthropic.
  for (const p of preference) {
    if (p === 'anthropic-direct' && connectedProviders.has('anthropic')) order.push('anthropic');
    else if (p === 'openai' && connectedProviders.has('openai')) order.push('openai');
    else if (p === 'openai_compatible' && connectedProviders.has('openai_compatible')) order.push('openai_compatible');
    else if (p === 'google_ai' && connectedProviders.has('google_ai')) order.push('google_ai');
    else if (p === 'deepseek' && connectedProviders.has('deepseek')) order.push('deepseek');
    else if (p === 'groq' && connectedProviders.has('groq')) order.push('groq');
    else if (p === 'mistral_ai' && connectedProviders.has('mistral_ai')) order.push('mistral_ai');
    else if (p === 'cohere' && connectedProviders.has('cohere')) order.push('cohere');
    else if (p === 'perplexity' && connectedProviders.has('perplexity')) order.push('perplexity');
    else if (p === 'together_ai' && connectedProviders.has('together_ai')) order.push('together_ai');
    else if (p === 'fireworks_ai' && connectedProviders.has('fireworks_ai')) order.push('fireworks_ai');
    else if (p === 'zai' && connectedProviders.has('zai')) order.push('zai');
    else if (p === 'minimax' && connectedProviders.has('minimax')) order.push('minimax');
    else if (p === 'openrouter' && connectedProviders.has('openrouter')) order.push('openrouter');
    else if (p === 'huggingface' && connectedProviders.has('huggingface')) order.push('huggingface');
    else if (p === 'ollama' && connectedProviders.has('ollama')) order.push('ollama');
    else if (p === 'openswan' && connectedProviders.has('openswan')) order.push('openswan');
  }

  return order.map((provider, idx) => {
    const display = PROVIDER_DISPLAY[provider] || { label: provider, scope: '' };
    const isPrimary = idx === 0;
    let reason: string;
    if (mode === 'prefer_direct') {
      if (provider === 'openrouter' && connectedProviders.size > 1) {
        reason = 'Used as fallback for non-native models, web search, and when direct providers are overloaded.';
      } else if (isPrimary) {
        reason = 'Direct billing — your key handles this provider\'s native models with no markup.';
      } else {
        reason = 'Direct billing for its native models.';
      }
    } else if (mode === 'prefer_openrouter') {
      reason = isPrimary
        ? 'Routed through OpenRouter for unified billing and 300+ models behind one key.'
        : 'Used when OpenRouter is overloaded or doesn\'t carry the requested model.';
    } else {
      reason = isPrimary ? 'Cheapest available for most models.' : 'Used when cheaper provider doesn\'t carry the model.';
    }
    return { provider, label: display.label, isPrimary, scope: display.scope, reason };
  });
}
