/**
 * crossProviderRouter — make OpenRouter, HuggingFace, and OpenSwan
 * cooperate as one logical inference layer.
 *
 * Why this exists: today each gateway lives behind its own client lib
 * (`invokeLLMProxy` for OR/OpenAI/etc., `invokeHfInference` for HF,
 * `sendMessageToSession` for OpenSwan). A user with all three connected
 * still gets siloed surfaces — chat picks one, no fallback when one
 * provider rate-limits or goes offline. The router collapses them into
 * one decision point:
 *
 *   1. Take a logical model id (e.g. `meta-llama/Llama-3.3-70B-Instruct`).
 *   2. Look up its aliases on each provider via MODEL_ALIASES.
 *   3. Order providers by user preference + connected keys.
 *   4. Caller invokes them in order via withCrossProviderFallback,
 *      falling through on 429 / 5xx / network errors.
 *
 * The router is gateway-agnostic — it doesn't actually call any
 * provider. It returns a plan the caller executes. That keeps the
 * router pure / smoke-testable and lets `universalInvoke.ts` apply
 * different invocation rules per surface (chat vs. agent tool vs.
 * automation).
 */

import type { LLMProvider } from './llmProviders';
import { excludeCoolingProviders } from './providerHealthRegistry';

/**
 * Logical model IDs map across providers. Each entry lists the
 * provider-specific id strings for the same underlying model. When a
 * model is missing on a provider, leave the field undefined — the
 * router will skip that provider for that model.
 *
 * Example: Llama 3.3 70B is on Hugging Face, OpenRouter, and Groq.
 * The HF / OR ids differ in casing / suffix; this table lets the
 * caller invoke any one transparently.
 */
export interface ProviderModelAliases {
  /** HuggingFace inference router id (`org/model` exact case). */
  huggingface?: string;
  /** OpenRouter id (`provider/model[:variant]`). */
  openrouter?: string;
  /** OpenAI native id (when the model is OpenAI's). */
  openai?: string;
  /** Business/self-hosted OpenAI-compatible route id. */
  openai_compatible?: string;
  /** Anthropic native id (when the model is Anthropic's). */
  anthropic?: string;
  /** Groq id (Llama / Mixtral / Mistral). */
  groq?: string;
  /** Google AI Studio direct (when wired). */
  google_ai?: string;
  mistral_ai?: string;
  cohere?: string;
  perplexity?: string;
  together_ai?: string;
  fireworks_ai?: string;
  deepseek?: string;
  zai?: string;
  minimax?: string;
  ollama?: string;
  /** OpenSwan agent / runtime id when this maps to a local agent. */
  openswan?: string;
  /** Free-tier marker — when set, the router will use this id for
   *  free-tier requests on the matching provider. Useful for routing
   *  cost-sensitive workloads to the right :free variant on OR. */
  openrouterFree?: string;
}

export const MODEL_ALIASES: Record<string, ProviderModelAliases> = {
  // ── Llama 3.3 70B ─ on HF, OR, Groq ───────────────────────────────
  'llama-3.3-70b': {
    huggingface: 'meta-llama/Llama-3.3-70B-Instruct',
    openrouter: 'meta-llama/llama-3.3-70b-instruct',
    openrouterFree: 'meta-llama/llama-3.3-70b-instruct:free',
    groq: 'llama-3.3-70b-versatile',
  },
  // ── Llama 3.1 8B ─ HF + Groq + OR free ────────────────────────────
  'llama-3.1-8b': {
    huggingface: 'meta-llama/Llama-3.1-8B-Instruct',
    openrouter: 'meta-llama/llama-3.1-8b-instruct',
    openrouterFree: 'meta-llama/llama-3.1-8b-instruct:free',
    groq: 'llama-3.1-8b-instant',
  },
  // ── Mistral Large ─ HF + OR ───────────────────────────────────────
  'mistral-large': {
    huggingface: 'mistralai/Mistral-Large-2411',
    openrouter: 'mistralai/mistral-large-2411',
    mistral_ai: 'mistral-large-latest',
  },
  // ── Mistral Small (free tier on OR + Mistral 7B free on HF) ──────
  'mistral-small-free': {
    huggingface: 'mistralai/Mistral-7B-Instruct-v0.3',
    openrouterFree: 'mistralai/mistral-small-3.1-24b-instruct:free',
  },
  // ── Qwen 3 235B MoE ─ HF + OR ─────────────────────────────────────
  'qwen-3-235b': {
    huggingface: 'Qwen/Qwen3-235B-A22B',
    openrouter: 'qwen/qwen3-235b-a22b',
    together_ai: 'Qwen/Qwen3-235B-A22B-fp8-tput',
  },
  // ── DeepSeek R1 ─ HF + OR ─────────────────────────────────────────
  'deepseek-r1': {
    huggingface: 'deepseek-ai/DeepSeek-R1',
    openrouter: 'deepseek/deepseek-r1',
    fireworks_ai: 'accounts/fireworks/models/deepseek-r1',
  },
  // ── Claude Sonnet 4.6 ─ Anthropic native + OR passthrough ─────────
  'claude-sonnet-4-6': {
    anthropic: 'claude-sonnet-4-6',
    openrouter: 'anthropic/claude-sonnet-4-6',
  },
  // ── Claude Fable / Opus current tier ─ Anthropic native + OR ──────
  'claude-fable-5': {
    anthropic: 'claude-fable-5',
    openrouter: 'anthropic/claude-fable-5',
  },
  'claude-opus-4-8': {
    anthropic: 'claude-opus-4-8',
    openrouter: 'anthropic/claude-opus-4-8',
  },
  'claude-opus-4-7': {
    anthropic: 'claude-opus-4-7',
    openrouter: 'anthropic/claude-opus-4-7',
  },
  // ── Claude Opus 4.6 ─ Anthropic native + OR ───────────────────────
  'claude-opus-4-6': {
    anthropic: 'claude-opus-4-6',
    openrouter: 'anthropic/claude-opus-4-6',
  },
  // ── Claude Haiku 4.5 ─ Anthropic native + OR ──────────────────────
  'claude-haiku-4-5': {
    anthropic: 'claude-haiku-4-5-20251001',
    openrouter: 'anthropic/claude-haiku-4-5',
  },
  // ── GPT-4o ─ OpenAI native + OR passthrough ───────────────────────
  'gpt-5.5-pro': {
    openai: 'gpt-5.5-pro',
    openrouter: 'openai/gpt-5.5-pro',
  },
  'gpt-5.5': {
    openai: 'gpt-5.5',
    openrouter: 'openai/gpt-5.5',
  },
  'gpt-5.4': {
    openai: 'gpt-5.4',
    openrouter: 'openai/gpt-5.4',
  },
  'gpt-5.4-mini': {
    openai: 'gpt-5.4-mini',
    openrouter: 'openai/gpt-5.4-mini',
  },
  'gpt-5.4-nano': {
    openai: 'gpt-5.4-nano',
    openrouter: 'openai/gpt-5.4-nano',
  },
  'gpt-4o': {
    openai: 'gpt-4o',
    openrouter: 'openai/gpt-4o',
  },
  'gpt-4.1': {
    openai: 'gpt-4.1',
    openrouter: 'openai/gpt-4.1',
  },
  'gpt-4.1-mini': {
    openai: 'gpt-4.1-mini',
    openrouter: 'openai/gpt-4.1-mini',
  },
  'gpt-4.1-nano': {
    openai: 'gpt-4.1-nano',
    openrouter: 'openai/gpt-4.1-nano',
  },
  // ── Gemini 2.5 Pro ─ OR-only today (no native Google in llm-proxy) ─
  'gemini-3.5-flash': {
    openrouter: 'google/gemini-3.5-flash',
    google_ai: 'gemini-3.5-flash',
  },
  'gemini-3.1-pro-preview': {
    openrouter: 'google/gemini-3.1-pro-preview',
    google_ai: 'gemini-3.1-pro-preview',
  },
  'gemini-3.1-flash-lite': {
    openrouter: 'google/gemini-3.1-flash-lite',
    google_ai: 'gemini-3.1-flash-lite',
  },
  'gemini-2.5-pro': {
    openrouter: 'google/gemini-2.5-pro',
    google_ai: 'gemini-2.5-pro',
  },
  // ── Gemini 2.5 Flash (cheap) ──────────────────────────────────────
  'gemini-2.5-flash': {
    openrouter: 'google/gemini-2.5-flash',
    google_ai: 'gemini-2.5-flash',
  },
  'gemini-2.5-flash-lite': {
    openrouter: 'google/gemini-2.5-flash-lite',
    google_ai: 'gemini-2.5-flash-lite',
  },
  'deepseek-reasoner': {
    deepseek: 'deepseek-reasoner',
    openrouter: 'deepseek/deepseek-r1',
    fireworks_ai: 'accounts/fireworks/models/deepseek-r1',
  },
  'command-r-plus': {
    cohere: 'command-r-plus',
    openrouter: 'cohere/command-r-plus',
  },
  'sonar-deep-research': {
    perplexity: 'sonar-deep-research',
    openrouter: 'perplexity/sonar-deep-research',
  },
  'sonar-reasoning-pro': {
    perplexity: 'sonar-reasoning-pro',
    openrouter: 'perplexity/sonar-reasoning-pro',
  },
  'sonar-pro': {
    perplexity: 'sonar-pro',
    openrouter: 'perplexity/sonar-pro',
  },
  'sonar': {
    perplexity: 'sonar',
    openrouter: 'perplexity/sonar',
  },
  // ── OpenRouter auto-router (OR-only by definition) ────────────────
  'openrouter-auto': {
    openrouter: 'openrouter/auto',
  },
  'business-default': {
    openai_compatible: 'business-default',
  },
};

/** Resolves a chat-picker / pick-list id to one of the canonical
 *  alias keys above, or returns null when the id is already a
 *  provider-specific id (in which case the router falls back to
 *  treating it as direct). */
export function findAliasKey(modelId: string): string | null {
  const id = (modelId || '').trim();
  if (!id) return null;
  if (MODEL_ALIASES[id]) return id;

  // Soft mapping — the chat composer sometimes uses friendlier ids.
  const norm = id.toLowerCase();
  if (norm === 'claude-fable-5' || norm === 'claude-fable') return 'claude-fable-5';
  if (norm === 'claude-opus-4-8')           return 'claude-opus-4-8';
  if (norm === 'claude-opus-4-7')           return 'claude-opus-4-7';
  if (norm === 'claude-opus-4-6')           return 'claude-opus-4-6';
  if (norm === 'claude-sonnet-4-6')         return 'claude-sonnet-4-6';
  if (norm.startsWith('claude-haiku'))      return 'claude-haiku-4-5';
  if (norm === 'gpt-5.5-pro')               return 'gpt-5.5-pro';
  if (norm === 'gpt-5.5')                   return 'gpt-5.5';
  if (norm === 'gpt-5.4')                   return 'gpt-5.4';
  if (norm === 'gpt-5.4-mini')              return 'gpt-5.4-mini';
  if (norm === 'gpt-5.4-nano')              return 'gpt-5.4-nano';
  if (norm === 'gpt-4.1')                   return 'gpt-4.1';
  if (norm === 'gpt-4.1-mini')              return 'gpt-4.1-mini';
  if (norm === 'gpt-4.1-nano')              return 'gpt-4.1-nano';
  if (norm.startsWith('gpt-4o'))            return 'gpt-4o';
  if (norm === 'gemini-3.5-flash') return 'gemini-3.5-flash';
  if (norm === 'gemini-3.1-pro' || norm === 'gemini-3.1-pro-preview') return 'gemini-3.1-pro-preview';
  if (norm === 'gemini-3.1-flash-lite') return 'gemini-3.1-flash-lite';
  if (norm === 'gemini-2.5-flash-lite') return 'gemini-2.5-flash-lite';
  if (norm.includes('gemini') && norm.includes('flash-lite')) return norm.includes('3.1') ? 'gemini-3.1-flash-lite' : 'gemini-2.5-flash-lite';
  if (norm.includes('gemini') && norm.includes('flash')) return norm.includes('3.5') ? 'gemini-3.5-flash' : 'gemini-2.5-flash';
  if (norm.includes('gemini') && norm.includes('pro'))   return 'gemini-2.5-pro';
  if (norm === 'sonar-deep-research')       return 'sonar-deep-research';
  if (norm === 'sonar-reasoning-pro')       return 'sonar-reasoning-pro';
  if (norm === 'sonar-pro')                 return 'sonar-pro';
  if (norm === 'sonar')                     return 'sonar';
  if (norm.includes('llama-3.3') && norm.includes('70b')) return 'llama-3.3-70b';
  if (norm.includes('llama-3.1') && norm.includes('8b'))  return 'llama-3.1-8b';
  if (norm.includes('mistral-large'))        return 'mistral-large';
  if (norm.startsWith('qwen3-235b') || norm.startsWith('qwen-3-235b')) return 'qwen-3-235b';
  if (norm.includes('deepseek-r1'))          return 'deepseek-r1';

  return null;
}

/** A single resolution step — "use provider X with model id Y". */
export interface ProviderRoute {
  provider: LLMProvider | 'anthropic-direct' | 'openswan' | 'huggingface-task';
  modelId: string;
  /** Human-readable label for telemetry / logging. */
  label: string;
  /** True when this route uses a free-tier identifier and should be
   *  preferred when the user prefers free models. */
  isFree?: boolean;
}

export interface RouteResolutionOptions {
  /** Set of providers the user has connected. Routes to providers
   *  not in this set are skipped (we'd just 401 anyway). */
  available: Set<LLMProvider | 'anthropic' | 'openswan'>;
  /** Preferred provider order. Defaults to low/surprise-cost routing:
   *  free/local and cheap connected providers before direct Anthropic. */
  prefer?: Array<ProviderRoute['provider']>;
  /** When true, prefer the free-tier identifier over the paid one
   *  even when both are available. Useful for free-tier users. */
  preferFree?: boolean;
  /** PRE-SELECTION health awareness. When set, providers that recently
   *  failed with a health-class error (rate-limit / overload / transient)
   *  are pushed to the BACK of the try order for this turn via
   *  `providerHealthRegistry.excludeCoolingProviders`. This only changes
   *  ORDER — no provider is dropped and no error is suppressed
   *  (fail-visible; see the note on `resolveProviderRoutes`).
   *
   *  Inject `nowMs` for deterministic behavior in tests. Omit in
   *  production to disable health-aware reordering (routes resolve in
   *  the plain preference order, exactly as before). Pass `healthNowMs`
   *  to opt in; callers that want live behavior pass `Date.now()`. */
  healthNowMs?: number;
  /** Optional cooldown window override (ms) forwarded to the health
   *  registry. Defaults to the registry's 30s window. */
  healthCooldownMs?: number;
}

/** Re-export the health recorder so the router's runtime consumer
 *  (`universalInvoke.executeRouteChain`) can log per-route outcomes
 *  from one import site. Wiring is a single line at the observe point
 *  (see the fail-visible note on `resolveProviderRoutes`):
 *
 *    // on success:  recordProviderOutcomeNow(route.provider, { ok: true });
 *    // on failure:  recordProviderOutcomeNow(route.provider,
 *    //                { ok: false, errorClass: classifyProviderError(err) });
 *
 *  Recording never changes what the caller does with the error — the
 *  error is STILL surfaced. It only updates health for the NEXT turn. */
export {
  recordProviderOutcome,
  recordProviderOutcomeNow,
  classifyProviderError,
  isProviderCoolingDown,
  excludeCoolingProviders,
} from './providerHealthRegistry';
export type { ProviderErrorClass, ProviderOutcome } from './providerHealthRegistry';

const DEFAULT_PREFERENCE: Array<ProviderRoute['provider']> = [
  'ollama',
  'openai_compatible',
  'huggingface',
  'groq',
  'openrouter',
  'deepseek',
  'google_ai',
  'mistral_ai',
  'anthropic-direct',
  'openai',
  'together_ai',
  'fireworks_ai',
  'zai',
  'minimax',
  'cohere',
  'perplexity',
  'openswan',
];

function providerFromModelPrefix(modelId: string): LLMProvider | null {
  const slashIdx = modelId.indexOf('/');
  if (slashIdx <= 0) return null;
  const head = modelId.slice(0, slashIdx);
  if (head === 'huggingface' || head === 'huggingface_endpoint') return 'huggingface';
  if (head === 'z_ai') return 'zai';
  if ([
    'openai',
    'openai_compatible',
    'openrouter',
    'groq',
    'google_ai',
    'mistral_ai',
    'cohere',
    'perplexity',
    'together_ai',
    'fireworks_ai',
    'deepseek',
    'zai',
    'minimax',
    'ollama',
    'github-models',
  ].includes(head)) return head as LLMProvider;
  return null;
}

export interface PlainChatModelRoute {
  provider: LLMProvider;
  model: string;
}

// Only providers with a fixed, code-owned destination in llm-proxy belong in
// the browser's hosted text-only lane. Ollama and OpenAI-compatible endpoints
// are intentionally local-bridge concerns (the hosted edge rejects arbitrary
// destinations), while Replicate is not a chat provider there at all.
const HOSTED_PLAIN_CHAT_PROVIDERS: ReadonlySet<LLMProvider> = new Set([
  'anthropic',
  'openai',
  'openrouter',
  'groq',
  'github-models',
  'huggingface',
  'zai',
  'minimax',
  'google_ai',
  'mistral_ai',
  'cohere',
  'perplexity',
  'together_ai',
  'fireworks_ai',
  'deepseek',
]);

/**
 * Resolve one user-selected text model to exactly one no-tools provider route.
 * Unlike resolveProviderRoutes this never builds a fallback chain: a pinned
 * model stays pinned, and an unknown/local-only id fails visibly to its caller.
 */
export function resolvePlainChatModelRoute(
  modelId: string | null | undefined,
): PlainChatModelRoute | null {
  const normalized = String(modelId || '').trim();
  if (!normalized || normalized === 'auto') {
    return { provider: 'anthropic', model: 'claude-sonnet-4-6' };
  }

  if (/^claude-/i.test(normalized)) return { provider: 'anthropic', model: normalized };
  if (/^cswan801\/blackswan/i.test(normalized)) {
    return { provider: 'huggingface', model: normalized };
  }
  if (/^hf:/i.test(normalized)) {
    const huggingFaceModel = normalized.slice(3).trim();
    return huggingFaceModel
      ? { provider: 'huggingface', model: huggingFaceModel }
      : null;
  }

  const slashIndex = normalized.indexOf('/');
  if (slashIndex > 0) {
    const rawProvider = normalized.slice(0, slashIndex).toLowerCase();
    const provider = rawProvider === 'huggingface_endpoint' || rawProvider === 'hugging_face'
      ? 'huggingface'
      : rawProvider === 'z_ai'
        ? 'zai'
        : rawProvider;
    if (HOSTED_PLAIN_CHAT_PROVIDERS.has(provider as LLMProvider)) {
      return { provider: provider as LLMProvider, model: normalized };
    }
  }

  if (/^(?:gpt-|o[134]\b|chatgpt-)/i.test(normalized)) {
    return { provider: 'openai', model: normalized };
  }
  if (/^gemini[-_./]/i.test(normalized)) return { provider: 'google_ai', model: normalized };
  if (/^sonar(?:-|$)/i.test(normalized)) return { provider: 'perplexity', model: normalized };
  if (/^(?:mistral-|codestral-)/i.test(normalized)) return { provider: 'mistral_ai', model: normalized };
  if (/^deepseek-/i.test(normalized)) return { provider: 'deepseek', model: normalized };
  if (/^(?:glm-5|glm-)/i.test(normalized)) return { provider: 'zai', model: normalized };
  if (/^minimax-/i.test(normalized)) return { provider: 'minimax', model: normalized };
  if (/^(?:llama-3\.3-70b-versatile|mixtral-)/i.test(normalized)) {
    return { provider: 'groq', model: normalized };
  }
  return null;
}

/**
 * Build an ordered fallback chain for a logical model id. Caller
 * walks the list, trying each route until one succeeds.
 *
 * Edge cases handled:
 *   - Empty result → caller should surface "no provider configured"
 *     and point at the marketplace.
 *   - Single result → no fallback; the call still benefits from the
 *     unified shape so the caller doesn't need branching code.
 *   - Free-tier preference → if `preferFree=true` and the alias has
 *     `openrouterFree`, that route is inserted first.
 *   - Health-aware PRE-selection → when `opts.healthNowMs` is set, a
 *     provider that recently failed with a health-class error (rate
 *     limit / overload / transient) is moved to the BACK of the try
 *     order for this turn. See the fail-visible note below.
 *
 * ─── FAIL-VISIBLE (house invariant) ─────────────────────────────────
 * The health reordering here is PRE-selection only: it picks a
 * healthier provider ORDER *before* the request goes out. It never
 * removes a provider (so the try list can't reach zero because of
 * health — worst case the order is unchanged) and it does NOT catch,
 * swallow, retry, or hide any error. The router's runtime consumer
 * (`universalInvoke.executeRouteChain`) still surfaces the last error
 * exactly as before; this only influences the ORDER it walks. Do NOT
 * turn this into silent mid-request failover.
 */
export function resolveProviderRoutes(
  modelId: string,
  opts: RouteResolutionOptions,
): ProviderRoute[] {
  const aliasKey = findAliasKey(modelId);
  const aliases = aliasKey ? MODEL_ALIASES[aliasKey] : null;
  const routes: ProviderRoute[] = [];
  const basePreference = opts.prefer || DEFAULT_PREFERENCE;
  // PRE-selection: if the caller opted in with a clock, push
  // cooling-down providers to the back of the preference order. This
  // reorders FUTURE attempts only — nothing is dropped, no error is
  // suppressed (fail-visible; see the note above).
  const preference = typeof opts.healthNowMs === 'number'
    ? excludeCoolingProviders(
        basePreference,
        opts.healthNowMs,
        { cooldownMs: opts.healthCooldownMs },
      ).ordered
    : basePreference;

  // Without an alias entry we fall back to direct routing — assume
  // the caller passed a provider-native id and try OR as a hopeful
  // fallback (it routes most things).
  if (!aliases) {
    const directProvider = providerFromModelPrefix(modelId);
    if (directProvider && opts.available.has(directProvider)) {
      routes.push({ provider: directProvider, modelId, label: `${directProvider}:${modelId}` });
      return routes;
    }
    if (opts.available.has('openrouter')) {
      routes.push({ provider: 'openrouter', modelId, label: `openrouter:${modelId}` });
    }
    return routes;
  }

  for (const provider of preference) {
    if (provider === 'anthropic-direct' && aliases.anthropic && opts.available.has('anthropic')) {
      routes.push({ provider: 'anthropic-direct', modelId: aliases.anthropic, label: `anthropic:${aliases.anthropic}` });
    } else if (provider === 'openai' && aliases.openai && opts.available.has('openai')) {
      routes.push({ provider: 'openai', modelId: aliases.openai, label: `openai:${aliases.openai}` });
    } else if (provider === 'openai_compatible' && aliases.openai_compatible && opts.available.has('openai_compatible')) {
      routes.push({ provider: 'openai_compatible', modelId: aliases.openai_compatible, label: `openai_compatible:${aliases.openai_compatible}` });
    } else if (provider === 'groq' && aliases.groq && opts.available.has('groq')) {
      routes.push({ provider: 'groq', modelId: aliases.groq, label: `groq:${aliases.groq}` });
    } else if (provider === 'google_ai' && aliases.google_ai && opts.available.has('google_ai')) {
      routes.push({ provider: 'google_ai', modelId: aliases.google_ai, label: `google_ai:${aliases.google_ai}` });
    } else if (provider === 'mistral_ai' && aliases.mistral_ai && opts.available.has('mistral_ai')) {
      routes.push({ provider: 'mistral_ai', modelId: aliases.mistral_ai, label: `mistral_ai:${aliases.mistral_ai}` });
    } else if (provider === 'cohere' && aliases.cohere && opts.available.has('cohere')) {
      routes.push({ provider: 'cohere', modelId: aliases.cohere, label: `cohere:${aliases.cohere}` });
    } else if (provider === 'perplexity' && aliases.perplexity && opts.available.has('perplexity')) {
      routes.push({ provider: 'perplexity', modelId: aliases.perplexity, label: `perplexity:${aliases.perplexity}` });
    } else if (provider === 'together_ai' && aliases.together_ai && opts.available.has('together_ai')) {
      routes.push({ provider: 'together_ai', modelId: aliases.together_ai, label: `together_ai:${aliases.together_ai}` });
    } else if (provider === 'fireworks_ai' && aliases.fireworks_ai && opts.available.has('fireworks_ai')) {
      routes.push({ provider: 'fireworks_ai', modelId: aliases.fireworks_ai, label: `fireworks_ai:${aliases.fireworks_ai}` });
    } else if (provider === 'deepseek' && aliases.deepseek && opts.available.has('deepseek')) {
      routes.push({ provider: 'deepseek', modelId: aliases.deepseek, label: `deepseek:${aliases.deepseek}` });
    } else if (provider === 'zai' && aliases.zai && opts.available.has('zai')) {
      routes.push({ provider: 'zai', modelId: aliases.zai, label: `zai:${aliases.zai}` });
    } else if (provider === 'minimax' && aliases.minimax && opts.available.has('minimax')) {
      routes.push({ provider: 'minimax', modelId: aliases.minimax, label: `minimax:${aliases.minimax}` });
    } else if (provider === 'ollama' && aliases.ollama && opts.available.has('ollama')) {
      routes.push({ provider: 'ollama', modelId: aliases.ollama, label: `ollama:${aliases.ollama}` });
    } else if (provider === 'openrouter' && opts.available.has('openrouter')) {
      // Prefer free variant when the caller asks for it.
      if (opts.preferFree && aliases.openrouterFree) {
        routes.push({ provider: 'openrouter', modelId: aliases.openrouterFree, label: `openrouter:${aliases.openrouterFree}`, isFree: true });
      }
      if (aliases.openrouter) {
        routes.push({ provider: 'openrouter', modelId: aliases.openrouter, label: `openrouter:${aliases.openrouter}` });
      }
      // Always include the free fallback at the end if not already
      // emitted — better to succeed cheaply than fail entirely.
      if (!opts.preferFree && aliases.openrouterFree) {
        routes.push({ provider: 'openrouter', modelId: aliases.openrouterFree, label: `openrouter:${aliases.openrouterFree}`, isFree: true });
      }
    } else if (provider === 'huggingface' && aliases.huggingface && opts.available.has('huggingface')) {
      routes.push({ provider: 'huggingface', modelId: aliases.huggingface, label: `huggingface:${aliases.huggingface}` });
    } else if (provider === 'openswan' && aliases.openswan && opts.available.has('openswan')) {
      routes.push({ provider: 'openswan', modelId: aliases.openswan, label: `openswan:${aliases.openswan}` });
    }
  }

  return routes;
}

/** Classify a provider-thrown error as transient (caller should fall
 *  through to the next route) vs. structural (caller should bubble).
 *  Mirrors the discipline in `agentProviders/fallbackChain.ts` so the
 *  semantics stay consistent across the codebase. */
export function isTransientProviderError(err: unknown): boolean {
  if (!err) return false;
  const anyErr = err as any;
  const status = typeof anyErr.status === 'number' ? anyErr.status
    : typeof anyErr.statusCode === 'number' ? anyErr.statusCode
    : undefined;
  if (typeof status === 'number') {
    if (status === 429 || status === 408) return true;
    if (status >= 500 && status <= 599) return true;
    return false;
  }
  const msg = String(anyErr.message || anyErr || '').toLowerCase();
  return [
    'overloaded', 'rate limit', 'rate_limit', 'service unavailable',
    'service_unavailable', 'timeout', 'etimedout', 'econnreset',
    'fetch failed', 'network', 'aborted',
  ].some((m) => msg.includes(m));
}
