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
  /** Anthropic native id (when the model is Anthropic's). */
  anthropic?: string;
  /** Groq id (Llama / Mixtral / Mistral). */
  groq?: string;
  /** Google AI Studio direct (when wired). */
  google?: string;
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
  },
  // ── DeepSeek R1 ─ HF + OR ─────────────────────────────────────────
  'deepseek-r1': {
    huggingface: 'deepseek-ai/DeepSeek-R1',
    openrouter: 'deepseek/deepseek-r1',
  },
  // ── Claude Sonnet 4.6 ─ Anthropic native + OR passthrough ─────────
  'claude-sonnet-4-6': {
    anthropic: 'claude-sonnet-4-6',
    openrouter: 'anthropic/claude-sonnet-4-6',
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
  'gpt-4o': {
    openai: 'gpt-4o',
    openrouter: 'openai/gpt-4o',
  },
  // ── Gemini 2.5 Pro ─ OR-only today (no native Google in llm-proxy) ─
  'gemini-2.5-pro': {
    openrouter: 'google/gemini-2.5-pro',
  },
  // ── Gemini 2.5 Flash (cheap) ──────────────────────────────────────
  'gemini-2.5-flash': {
    openrouter: 'google/gemini-2.5-flash',
  },
  // ── OpenRouter auto-router (OR-only by definition) ────────────────
  'openrouter-auto': {
    openrouter: 'openrouter/auto',
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
  if (norm === 'claude-opus-4-6')           return 'claude-opus-4-6';
  if (norm === 'claude-sonnet-4-6')         return 'claude-sonnet-4-6';
  if (norm.startsWith('claude-haiku'))      return 'claude-haiku-4-5';
  if (norm.startsWith('gpt-4o'))            return 'gpt-4o';
  if (norm.includes('gemini') && norm.includes('flash')) return 'gemini-2.5-flash';
  if (norm.includes('gemini') && norm.includes('pro'))   return 'gemini-2.5-pro';
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
  available: Set<'openrouter' | 'huggingface' | 'anthropic' | 'openai' | 'groq' | 'openswan'>;
  /** Preferred provider order. Defaults to a sensible cost / quality
   *  tradeoff: native first (cheaper passthrough), then OR (broad
   *  fallback), then HF (free tier). */
  prefer?: Array<ProviderRoute['provider']>;
  /** When true, prefer the free-tier identifier over the paid one
   *  even when both are available. Useful for free-tier users. */
  preferFree?: boolean;
}

const DEFAULT_PREFERENCE: Array<ProviderRoute['provider']> = [
  'anthropic-direct',
  'openai',
  'groq',
  'openrouter',
  'huggingface',
  'openswan',
];

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
 */
export function resolveProviderRoutes(
  modelId: string,
  opts: RouteResolutionOptions,
): ProviderRoute[] {
  const aliasKey = findAliasKey(modelId);
  const aliases = aliasKey ? MODEL_ALIASES[aliasKey] : null;
  const routes: ProviderRoute[] = [];
  const preference = opts.prefer || DEFAULT_PREFERENCE;

  // Without an alias entry we fall back to direct routing — assume
  // the caller passed a provider-native id and try OR as a hopeful
  // fallback (it routes most things).
  if (!aliases) {
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
    } else if (provider === 'groq' && aliases.groq && opts.available.has('groq')) {
      routes.push({ provider: 'groq', modelId: aliases.groq, label: `groq:${aliases.groq}` });
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
