/**
 * llmProviders.ts — BYO API Key Management + Model Catalogs
 *
 * Manages user-provided LLM API keys (stored encrypted in Supabase)
 * and provides model catalogs per provider. Calls the llm-proxy edge function.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from './supabase';
import { getStrictLocalAiModeMessage, shouldBlockExternalAiProvider } from './privacyMode';
import {
  LLMProxyInvocationError,
  normalizeLLMProxyErrorPayload,
  readLLMProxyInvokeError,
} from './llmProxyErrorCore';
import { resolvePlainChatModelRoute } from './crossProviderRouter';
import { safeGetUserForAccessToken } from './authSession';
import type {
  ProviderModelCatalogFailureCode,
  ProviderModelCatalogStatus,
} from './modelCatalogReadinessCore';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LLMProvider =
  | 'openai'
  | 'openai_compatible'
  | 'anthropic'
  | 'openrouter'
  | 'groq'
  | 'ollama'
  | 'replicate'
  | 'github-models'
  | 'huggingface'
  | 'zai'
  | 'minimax'
  | 'google_ai'
  | 'mistral_ai'
  | 'cohere'
  | 'perplexity'
  | 'together_ai'
  | 'fireworks_ai'
  | 'deepseek';

export interface ProviderKey {
  id: string;
  provider: LLMProvider;
  label: string | null;
  endpoint: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Immutable Office authority captured before a provider-key operation starts.
 * `circleId` and `generation` are lifecycle fences even though provider keys
 * themselves are user-global: a response from an old Office/circle must never
 * hydrate or mutate the newly active Customize surface.
 */
export type ProviderKeysExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type ProviderKeysAuthorityGuard = (
  authority: ProviderKeysExactAuthority,
) => boolean;

export type ProviderKeysExactError =
  | 'invalid_authority'
  | 'authority_retired'
  | 'authority_mismatch'
  | 'invalid_request'
  | 'invalid_response'
  | 'request_failed'
  | 'aborted';

export type ProviderKeysExactListResult = Readonly<{
  ok: boolean;
  keys: ProviderKey[];
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: ProviderKeysExactError | string;
}>;

export type ProviderKeyExactMutationResult = Readonly<{
  ok: boolean;
  id?: string;
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: ProviderKeysExactError | string;
}>;

export type ProviderKeyExactTestResult = Readonly<{
  success: boolean;
  userId: string | null;
  circleId: string | null;
  generation: number | null;
  error?: ProviderKeysExactError | string;
}>;

export interface ProviderModel {
  id: string;
  label: string;
  provider: LLMProvider;
  contextWindow: number;
  costTier: 'free' | 'cheap' | 'mid' | 'expensive';
  /** Provider-advertised maximum output when it is available. This is
   * informational; execution still applies its own bounded token budget. */
  maxOutputTokens?: number;
  /** Curated rows are the offline/site-wide fallback. Live rows come from the
   * authenticated provider account and are merged into connected pickers. */
  source?: 'curated' | 'provider';
}

export interface ProviderModelCatalogResponse {
  provider: LLMProvider;
  models: ProviderModel[];
  fetchedAt: string;
}

export interface ProviderModelCatalogSnapshot {
  provider: LLMProvider;
  status: ProviderModelCatalogStatus;
  models: ProviderModel[];
  fetchedAt: string | null;
  failureCode?: ProviderModelCatalogFailureCode;
}

export interface LLMProxyResponse {
  response: string;
  /** Present when the provider returned tool calls and the request sent
   *  tools through llm-proxy. Callers that can execute tools should treat
   *  this as an escalation trigger instead of rendering `response`. */
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage: {
    model: string;
    provider: string;
    input_tokens: number;
    output_tokens: number;
    cache_creation_tokens: number;
    cache_read_tokens: number;
    total_tokens: number;
    estimated_cost: number;
  };
}

export type ThinkingLevel = 'fast' | 'balanced' | 'deep';

const userApiKeyChangeListeners = new Set<() => void>();

/** Subscribe to same-runtime Marketplace key changes (web and native). */
export function subscribeUserApiKeyChanges(listener: () => void): () => void {
  userApiKeyChangeListeners.add(listener);
  return () => { userApiKeyChangeListeners.delete(listener); };
}

export function notifyUserApiKeyChanges(): void {
  invalidateProviderModelCatalog();
  for (const listener of userApiKeyChangeListeners) {
    try { listener(); } catch { /* observers must not break credential writes */ }
  }
}

// ─── Model catalogs per provider ────────────────────────────────────────────

export const PROVIDER_MODELS: Record<LLMProvider, ProviderModel[]> = {
  openai: [
    { id: 'gpt-5.6-sol',   label: 'GPT-5.6 Sol',   provider: 'openai', contextWindow: 1050000, costTier: 'expensive' },
    { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', provider: 'openai', contextWindow: 1050000, costTier: 'mid' },
    { id: 'gpt-5.6-luna',  label: 'GPT-5.6 Luna',  provider: 'openai', contextWindow: 1050000, costTier: 'cheap' },
    { id: 'gpt-5.5',      label: 'GPT-5.5',      provider: 'openai', contextWindow: 1050000, costTier: 'expensive' },
    { id: 'gpt-5.5-pro',  label: 'GPT-5.5 Pro',  provider: 'openai', contextWindow: 1050000, costTier: 'expensive' },
    { id: 'gpt-5.4',      label: 'GPT-5.4',      provider: 'openai', contextWindow: 1050000, costTier: 'mid' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai', contextWindow: 1050000, costTier: 'cheap' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', provider: 'openai', contextWindow: 1050000, costTier: 'cheap' },
    { id: 'gpt-4.1',      label: 'GPT-4.1',      provider: 'openai', contextWindow: 1047576, costTier: 'mid' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', contextWindow: 1047576, costTier: 'cheap' },
    { id: 'o3-pro',       label: 'o3 Pro',       provider: 'openai', contextWindow: 200000, costTier: 'expensive' },
    { id: 'o3',           label: 'o3',           provider: 'openai', contextWindow: 200000, costTier: 'expensive' },
  ],
  openai_compatible: [
    { id: 'business-default', label: 'Business Default', provider: 'openai_compatible', contextWindow: 128000, costTier: 'mid' },
    { id: 'company-chat', label: 'Company Chat', provider: 'openai_compatible', contextWindow: 128000, costTier: 'mid' },
    { id: 'company-agent', label: 'Company Agent', provider: 'openai_compatible', contextWindow: 128000, costTier: 'mid' },
    { id: 'company-code', label: 'Company Code', provider: 'openai_compatible', contextWindow: 128000, costTier: 'mid' },
  ],
  anthropic: [
    { id: 'claude-fable-5',    label: 'Claude Fable 5',    provider: 'anthropic', contextWindow: 1000000, costTier: 'expensive' },
    { id: 'claude-opus-5',     label: 'Claude Opus 5',     provider: 'anthropic', contextWindow: 1000000, costTier: 'expensive' },
    { id: 'claude-sonnet-5',   label: 'Claude Sonnet 5',   provider: 'anthropic', contextWindow: 1000000, costTier: 'mid' },
    { id: 'claude-opus-4-8',   label: 'Claude Opus 4.8',   provider: 'anthropic', contextWindow: 1000000, costTier: 'expensive' },
    { id: 'claude-opus-4-7',   label: 'Claude Opus 4.7',   provider: 'anthropic', contextWindow: 1000000, costTier: 'expensive' },
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', contextWindow: 200000, costTier: 'mid' },
    { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  provider: 'anthropic', contextWindow: 200000, costTier: 'cheap' },
    { id: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   provider: 'anthropic', contextWindow: 1000000, costTier: 'expensive' },
  ],
  openrouter: [
    // Phase 0 quick wins: surface OpenRouter's unique routing variants
    // ahead of the static model list. `openrouter/auto` is a sensible
    // default for users who haven't picked a model yet — OR routes
    // each prompt to the best-fit model. `:nitro` and `:floor` are
    // shortcuts for "fastest provider" and "cheapest provider"
    // respectively. `:free` variants are zero-cost (rate-limited)
    // models — perfect for users who haven't connected paid keys yet.
    { id: 'openrouter/auto',                              label: 'Smart (Auto-route)',  provider: 'openrouter', contextWindow: 128000,  costTier: 'mid' },
    { id: 'openai/gpt-5.6-sol',                           label: 'GPT-5.6 Sol',          provider: 'openrouter', contextWindow: 1050000, costTier: 'expensive' },
    { id: 'openai/gpt-5.6-terra',                         label: 'GPT-5.6 Terra',        provider: 'openrouter', contextWindow: 1050000, costTier: 'mid' },
    { id: 'openai/gpt-5.6-luna',                          label: 'GPT-5.6 Luna',         provider: 'openrouter', contextWindow: 1050000, costTier: 'cheap' },
    { id: 'anthropic/claude-opus-5',                      label: 'Claude Opus 5',        provider: 'openrouter', contextWindow: 1000000, costTier: 'expensive' },
    { id: 'anthropic/claude-sonnet-5',                    label: 'Claude Sonnet 5',      provider: 'openrouter', contextWindow: 1000000, costTier: 'mid' },
    { id: 'google/gemini-3.6-flash',                      label: 'Gemini 3.6 Flash',     provider: 'openrouter', contextWindow: 1048576, costTier: 'mid' },
    { id: 'google/gemini-3.5-flash-lite',                 label: 'Gemini 3.5 Flash-Lite', provider: 'openrouter', contextWindow: 1048576, costTier: 'cheap' },
    { id: 'openai/gpt-5.5',                               label: 'GPT-5.5',             provider: 'openrouter', contextWindow: 1050000, costTier: 'expensive' },
    { id: 'openai/gpt-5.4-mini',                          label: 'GPT-5.4 Mini',        provider: 'openrouter', contextWindow: 1050000, costTier: 'cheap' },
    { id: 'anthropic/claude-fable-5',                     label: 'Claude Fable 5',      provider: 'openrouter', contextWindow: 1000000, costTier: 'expensive' },
    { id: 'anthropic/claude-opus-4-8',                    label: 'Claude Opus 4.8',     provider: 'openrouter', contextWindow: 1000000, costTier: 'expensive' },
    { id: 'google/gemini-3.5-flash',                      label: 'Gemini 3.5 Flash',    provider: 'openrouter', contextWindow: 1000000, costTier: 'mid' },
    { id: 'google/gemini-3.1-flash-lite',                 label: 'Gemini 3.1 Flash-Lite', provider: 'openrouter', contextWindow: 1000000, costTier: 'cheap' },
    { id: 'meta-llama/llama-3.3-70b-instruct:nitro',     label: 'Llama 3.3 70B (Fast)', provider: 'openrouter', contextWindow: 131072,  costTier: 'cheap' },
    { id: 'meta-llama/llama-3.3-70b-instruct:floor',     label: 'Llama 3.3 70B (Cheap)',provider: 'openrouter', contextWindow: 131072,  costTier: 'cheap' },
    { id: 'meta-llama/llama-3.3-70b-instruct:free',      label: 'Llama 3.3 70B (Free)', provider: 'openrouter', contextWindow: 131072,  costTier: 'free'  },
    { id: 'mistralai/mistral-small-3.1-24b-instruct:free', label: 'Mistral Small (Free)', provider: 'openrouter', contextWindow: 131072,  costTier: 'free'  },
    { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'openrouter', contextWindow: 200000,  costTier: 'mid' },
    { id: 'deepseek/deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'openrouter', contextWindow: 1000000, costTier: 'mid' },
    { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'openrouter', contextWindow: 1000000, costTier: 'cheap' },
    { id: 'minimax/minimax-m2.7', label: 'MiniMax M2.7', provider: 'openrouter', contextWindow: 204800, costTier: 'mid' },
    { id: 'z-ai/glm-5.1', label: 'GLM 5.1', provider: 'openrouter', contextWindow: 200000, costTier: 'mid' },
    { id: 'perplexity/sonar-deep-research', label: 'Sonar Deep Research', provider: 'openrouter', contextWindow: 200000, costTier: 'mid' },
    { id: 'meta-llama/llama-3.3-70b',   label: 'Llama 3.3 70B',      provider: 'openrouter', contextWindow: 131072, costTier: 'cheap' },
    { id: 'Qwen/Qwen3-235B-A22B',      label: 'Qwen 3 235B MoE',    provider: 'openrouter', contextWindow: 131072, costTier: 'mid' },
  ],
  groq: [
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'groq', contextWindow: 131072, maxOutputTokens: 65536, costTier: 'cheap' },
    { id: 'openai/gpt-oss-20b', label: 'GPT-OSS 20B', provider: 'groq', contextWindow: 131072, maxOutputTokens: 65536, costTier: 'cheap' },
    { id: 'groq/compound', label: 'Groq Compound', provider: 'groq', contextWindow: 131072, maxOutputTokens: 8192, costTier: 'cheap' },
    { id: 'groq/compound-mini', label: 'Groq Compound Mini', provider: 'groq', contextWindow: 131072, maxOutputTokens: 8192, costTier: 'cheap' },
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B',  provider: 'groq', contextWindow: 131072, costTier: 'cheap' },
    { id: 'llama-3.1-8b-instant',    label: 'Llama 3.1 8B Instant', provider: 'groq', contextWindow: 131072, costTier: 'cheap' },
  ],
  ollama: [
    // 'blackswan' (local Ollama weight) intentionally REMOVED (P8): the one
    // and only BlackSwan is cswan801/BlackSwan-v5 on the circle's dedicated
    // HF Inference Endpoint (the `blackswan` integration). Stale persisted
    // local picks normalize to it in serviceProfileSouls / ChatTab.
    { id: 'llama3.2',    label: 'Llama 3.2',         provider: 'ollama', contextWindow: 131072, costTier: 'free' },
    { id: 'qwen3',       label: 'Qwen 3',            provider: 'ollama', contextWindow: 40960,  costTier: 'free' },
    { id: 'qwen2.5',     label: 'Qwen 2.5',          provider: 'ollama', contextWindow: 32768,  costTier: 'free' },
    { id: 'mistral',     label: 'Mistral',            provider: 'ollama', contextWindow: 32768,  costTier: 'free' },
  ],
  // Replicate is intentionally empty: the llm-proxy edge function does not
  // support a `replicate` provider, so listing models here would make them
  // selectable but fail at runtime (provider drift). Re-add the models below
  // only after llm-proxy (supabase/functions/llm-proxy/index.ts) gains
  // Replicate support. Keys can still be stored for image-gen surfaces.
  // { id: 'flux-schnell', label: 'Flux Schnell (fast)', provider: 'replicate', contextWindow: 0, costTier: 'cheap' },
  // { id: 'flux-dev',     label: 'Flux Dev (quality)',   provider: 'replicate', contextWindow: 0, costTier: 'mid' },
  // { id: 'stable-diffusion-xl', label: 'Stable Diffusion XL', provider: 'replicate', contextWindow: 0, costTier: 'cheap' },
  // { id: 'stable-diffusion',    label: 'Stable Diffusion',    provider: 'replicate', contextWindow: 0, costTier: 'cheap' },
  replicate: [],
  'github-models': [
    // GitHub's current REST inference API uses publisher-qualified catalog IDs.
    { id: 'openai/gpt-4.1', label: 'GPT-4.1', provider: 'github-models', contextWindow: 1047576, costTier: 'free' },
    { id: 'openai/gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'github-models', contextWindow: 1047576, costTier: 'free' },
    { id: 'meta/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', provider: 'github-models', contextWindow: 131072, costTier: 'free' },
    { id: 'microsoft/Phi-4', label: 'Phi-4', provider: 'github-models', contextWindow: 16384, costTier: 'free' },
    { id: 'mistral-ai/Mistral-Large-2411', label: 'Mistral Large 2411', provider: 'github-models', contextWindow: 128000, costTier: 'free' },
  ],
  huggingface: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct',     label: 'Llama 3.3 70B',   provider: 'huggingface', contextWindow: 131072, costTier: 'mid' },
    { id: 'mistralai/Mistral-Large-2411',           label: 'Mistral Large',    provider: 'huggingface', contextWindow: 128000, costTier: 'mid' },
    { id: 'Qwen/Qwen3-235B-A22B',                   label: 'Qwen 3 235B MoE', provider: 'huggingface', contextWindow: 131072, costTier: 'mid' },
    { id: 'Qwen/Qwen3-32B',                         label: 'Qwen 3 32B',      provider: 'huggingface', contextWindow: 131072, costTier: 'mid' },
    { id: 'deepseek-ai/DeepSeek-R1',               label: 'DeepSeek R1',      provider: 'huggingface', contextWindow: 131072, costTier: 'mid' },
    { id: 'google/gemma-2-27b-it',                  label: 'Gemma 2 27B',      provider: 'huggingface', contextWindow: 8192,   costTier: 'cheap' },
    { id: 'meta-llama/Llama-3.1-8B-Instruct',      label: 'Llama 3.1 8B',    provider: 'huggingface', contextWindow: 131072, costTier: 'free' },
    { id: 'mistralai/Mistral-7B-Instruct-v0.3',    label: 'Mistral 7B',       provider: 'huggingface', contextWindow: 32768,  costTier: 'free' },
  ],
  zai: [
    { id: 'glm-5.1', label: 'GLM-5.1', provider: 'zai', contextWindow: 200000, maxOutputTokens: 128000, costTier: 'mid' },
    { id: 'glm-5', label: 'GLM-5', provider: 'zai', contextWindow: 200000, costTier: 'mid' },
  ],
  minimax: [
    { id: 'MiniMax-M2.7', label: 'MiniMax M2.7', provider: 'minimax', contextWindow: 204800, costTier: 'mid' },
    { id: 'MiniMax-M2.7-highspeed', label: 'MiniMax M2.7 Highspeed', provider: 'minimax', contextWindow: 204800, costTier: 'mid' },
    { id: 'MiniMax-M2.5', label: 'MiniMax M2.5', provider: 'minimax', contextWindow: 204800, costTier: 'cheap' },
    { id: 'MiniMax-M2.5-highspeed', label: 'MiniMax M2.5 Highspeed', provider: 'minimax', contextWindow: 204800, costTier: 'cheap' },
    { id: 'MiniMax-M2.1', label: 'MiniMax M2.1', provider: 'minimax', contextWindow: 204800, costTier: 'cheap' },
    { id: 'MiniMax-M2.1-highspeed', label: 'MiniMax M2.1 Highspeed', provider: 'minimax', contextWindow: 204800, costTier: 'cheap' },
    { id: 'MiniMax-M2', label: 'MiniMax M2', provider: 'minimax', contextWindow: 204800, costTier: 'cheap' },
  ],
  google_ai: [
    { id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', provider: 'google_ai', contextWindow: 1048576, costTier: 'mid' },
    { id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', provider: 'google_ai', contextWindow: 1048576, costTier: 'cheap' },
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'google_ai', contextWindow: 1000000, costTier: 'mid' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', provider: 'google_ai', contextWindow: 1000000, costTier: 'cheap' },
  ],
  mistral_ai: [
    { id: 'mistral-medium-3-5', label: 'Mistral Medium 3.5', provider: 'mistral_ai', contextWindow: 256000, costTier: 'mid' },
    { id: 'mistral-large-2512', label: 'Mistral Large 3', provider: 'mistral_ai', contextWindow: 256000, costTier: 'mid' },
    { id: 'mistral-small-2603', label: 'Mistral Small 4', provider: 'mistral_ai', contextWindow: 256000, costTier: 'cheap' },
    { id: 'codestral-2508', label: 'Codestral 2508', provider: 'mistral_ai', contextWindow: 128000, costTier: 'cheap' },
    { id: 'ministral-14b-2512', label: 'Ministral 14B', provider: 'mistral_ai', contextWindow: 256000, costTier: 'cheap' },
    { id: 'ministral-8b-2512', label: 'Ministral 8B', provider: 'mistral_ai', contextWindow: 256000, costTier: 'cheap' },
    { id: 'ministral-3b-2512', label: 'Ministral 3B', provider: 'mistral_ai', contextWindow: 256000, costTier: 'cheap' },
  ],
  cohere: [
    { id: 'command-a-plus-05-2026', label: 'Command A Plus', provider: 'cohere', contextWindow: 128000, maxOutputTokens: 64000, costTier: 'mid' },
    { id: 'command-a-reasoning-08-2025', label: 'Command A Reasoning', provider: 'cohere', contextWindow: 128000, costTier: 'mid' },
    { id: 'command-a-03-2025', label: 'Command A', provider: 'cohere', contextWindow: 128000, costTier: 'mid' },
    { id: 'command-r7b-12-2024', label: 'Command R7B', provider: 'cohere', contextWindow: 128000, costTier: 'cheap' },
  ],
  perplexity: [
    { id: 'sonar-deep-research', label: 'Sonar Deep Research', provider: 'perplexity', contextWindow: 200000, costTier: 'mid' },
    { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro', provider: 'perplexity', contextWindow: 200000, costTier: 'mid' },
    { id: 'sonar-pro', label: 'Sonar Pro', provider: 'perplexity', contextWindow: 200000, costTier: 'mid' },
    { id: 'sonar', label: 'Sonar', provider: 'perplexity', contextWindow: 128000, costTier: 'cheap' },
  ],
  together_ai: [
    { id: 'MiniMaxAI/MiniMax-M2.7', label: 'MiniMax M2.7', provider: 'together_ai', contextWindow: 202752, costTier: 'mid' },
    { id: 'Qwen/Qwen3.7-Max', label: 'Qwen 3.7 Max', provider: 'together_ai', contextWindow: 262144, costTier: 'mid' },
    { id: 'Qwen/Qwen3.5-397B-A17B', label: 'Qwen 3.5 397B A17B', provider: 'together_ai', contextWindow: 262144, costTier: 'mid' },
    { id: 'Qwen/Qwen3.6-Plus', label: 'Qwen 3.6 Plus', provider: 'together_ai', contextWindow: 1000000, costTier: 'mid' },
    { id: 'moonshotai/Kimi-K2.6', label: 'Kimi K2.6', provider: 'together_ai', contextWindow: 262144, costTier: 'mid' },
    { id: 'zai-org/GLM-5.1', label: 'GLM 5.1', provider: 'together_ai', contextWindow: 200000, costTier: 'mid' },
    { id: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'together_ai', contextWindow: 131072, costTier: 'cheap' },
    { id: 'deepseek-ai/DeepSeek-V4-Pro', label: 'DeepSeek V4 Pro', provider: 'together_ai', contextWindow: 512000, costTier: 'mid' },
    { id: 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput', label: 'Qwen 3 235B Instruct', provider: 'together_ai', contextWindow: 262144, costTier: 'mid' },
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo', provider: 'together_ai', contextWindow: 131072, costTier: 'cheap' },
  ],
  fireworks_ai: [
    { id: 'accounts/fireworks/models/deepseek-v3p1', label: 'DeepSeek V3.1', provider: 'fireworks_ai', contextWindow: 163840, costTier: 'mid' },
    { id: 'accounts/fireworks/models/kimi-k2-instruct-0905', label: 'Kimi K2 Instruct', provider: 'fireworks_ai', contextWindow: 262144, costTier: 'mid' },
    { id: 'accounts/fireworks/models/gpt-oss-120b', label: 'GPT-OSS 120B', provider: 'fireworks_ai', contextWindow: 131072, costTier: 'cheap' },
    { id: 'accounts/fireworks/models/deepseek-r1-0528', label: 'DeepSeek R1 0528', provider: 'fireworks_ai', contextWindow: 163840, costTier: 'mid' },
  ],
  deepseek: [
    { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', provider: 'deepseek', contextWindow: 1000000, maxOutputTokens: 384000, costTier: 'mid' },
    { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', provider: 'deepseek', contextWindow: 1000000, maxOutputTokens: 384000, costTier: 'cheap' },
  ],
};

// ─── Provider help text ─────────────────────────────────────────────────────

export const PROVIDER_HELP: Record<LLMProvider, { url: string; hint: string }> = {
  openai:     { url: 'https://platform.openai.com/api-keys',         hint: 'Get your API key from OpenAI Platform' },
  openai_compatible: { url: 'https://platform.openai.com/docs/api-reference/chat', hint: 'Paste a business/self-hosted OpenAI-compatible endpoint and key. Supports vLLM, LiteLLM, internal gateways, and compatible managed endpoints.' },
  anthropic:  { url: 'https://console.anthropic.com/settings/keys',  hint: 'Get your API key from Anthropic Console' },
  openrouter: { url: 'https://openrouter.ai/keys',                   hint: 'Get your API key from OpenRouter — access 2000+ models' },
  groq:       { url: 'https://console.groq.com/keys',                hint: 'Get your API key from Groq — ultra-fast inference' },
  ollama:     { url: 'https://ollama.com/download',                   hint: 'Install Ollama locally — free, runs on your machine' },
  replicate:      { url: 'https://replicate.com/account/api-tokens',     hint: 'Get your API token from Replicate — AI image generation' },
  'github-models': { url: 'https://github.com/settings/tokens',            hint: 'Use a GitHub PAT with models scope — free tier with rate limits' },
  huggingface:     { url: 'https://huggingface.co/settings/tokens',          hint: 'Get your HF token — free tier available, PRO ($9/mo) gets 20x credits' },
  zai:             { url: 'https://bigmodel.cn/usercenter/apikeys',          hint: 'Get your z.ai / GLM API key for GLM models' },
  minimax:         { url: 'https://www.minimax.io/platform/user-center/basic-information/interface-key', hint: 'Get your MiniMax API key for MiniMax models' },
  google_ai:       { url: 'https://aistudio.google.com/app/apikey',          hint: 'Get your Google AI Studio key for Gemini models' },
  mistral_ai:      { url: 'https://console.mistral.ai/api-keys',             hint: 'Get your Mistral API key' },
  cohere:          { url: 'https://dashboard.cohere.com/api-keys',           hint: 'Get your Cohere API key' },
  perplexity:      { url: 'https://www.perplexity.ai/settings/api',          hint: 'Get your Perplexity API key for Sonar search models' },
  together_ai:     { url: 'https://api.together.ai/settings/api-keys',       hint: 'Get your Together AI API key' },
  fireworks_ai:    { url: 'https://fireworks.ai/account/api-keys',           hint: 'Get your Fireworks AI API key' },
  deepseek:        { url: 'https://platform.deepseek.com/api_keys',          hint: 'Get your DeepSeek API key' },
};

// ─── API Key CRUD ───────────────────────────────────────────────────────────

const MAX_EXACT_SCOPE_PART_LENGTH = 240;
const MAX_EXACT_ACCESS_TOKEN_LENGTH = 16_384;
const MAX_PROVIDER_API_KEY_LENGTH = 64 * 1024;
const MAX_PROVIDER_ENDPOINT_LENGTH = 2_048;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeProviderKeysExactAuthority(
  input: ProviderKeysExactAuthority | null | undefined,
): ProviderKeysExactAuthority | null {
  const userId = typeof input?.userId === 'string' ? input.userId.trim() : '';
  const circleId = typeof input?.circleId === 'string' ? input.circleId.trim() : '';
  const accessToken = typeof input?.accessToken === 'string' ? input.accessToken.trim() : '';
  const generation = input?.generation;
  if (
    !userId
    || !circleId
    || userId.length > MAX_EXACT_SCOPE_PART_LENGTH
    || circleId.length > MAX_EXACT_SCOPE_PART_LENGTH
    || !accessToken
    || accessToken.length > MAX_EXACT_ACCESS_TOKEN_LENGTH
    || !Number.isSafeInteger(generation)
    || Number(generation) <= 0
  ) return null;
  return Object.freeze({ userId, circleId, accessToken, generation: Number(generation) });
}

function providerKeysAuthorityIsCurrent(
  authority: ProviderKeysExactAuthority,
  isCurrent: ProviderKeysAuthorityGuard | null | undefined,
): boolean {
  if (!isCurrent) return false;
  try {
    return isCurrent(authority) === true;
  } catch {
    return false;
  }
}

async function resolveProviderKeysExactAuthority(
  input: ProviderKeysExactAuthority | null | undefined,
  isCurrent: ProviderKeysAuthorityGuard | null | undefined,
  signal?: AbortSignal,
): Promise<
  | { ok: true; authority: ProviderKeysExactAuthority }
  | { ok: false; authority: ProviderKeysExactAuthority | null; error: ProviderKeysExactError }
> {
  const authority = normalizeProviderKeysExactAuthority(input);
  if (!authority) return { ok: false, authority: null, error: 'invalid_authority' };
  if (signal?.aborted) return { ok: false, authority, error: 'aborted' };
  if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  if (signal?.aborted) return { ok: false, authority, error: 'aborted' };
  if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
    return { ok: false, authority, error: 'authority_retired' };
  }
  if (verifiedUser?.id !== authority.userId) {
    return { ok: false, authority, error: 'authority_mismatch' };
  }
  return { ok: true, authority };
}

function exactProviderListFailure(
  authority: ProviderKeysExactAuthority | null,
  error: ProviderKeysExactError | string,
): ProviderKeysExactListResult {
  return {
    ok: false,
    keys: [],
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

function exactProviderMutationFailure(
  authority: ProviderKeysExactAuthority | null,
  error: ProviderKeysExactError | string,
): ProviderKeyExactMutationResult {
  return {
    ok: false,
    userId: authority?.userId || null,
    circleId: authority?.circleId || null,
    generation: authority?.generation || null,
    error,
  };
}

function isKnownProvider(value: unknown): value is LLMProvider {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(PROVIDER_MODELS, value);
}

function parseProviderKeyRow(row: unknown): ProviderKey | null {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const value = row as Record<string, unknown>;
  if (
    typeof value.id !== 'string'
    || !UUID_RE.test(value.id)
    || !isKnownProvider(value.provider)
    || (value.label !== null && typeof value.label !== 'string')
    || (value.endpoint !== null && typeof value.endpoint !== 'string')
    || typeof value.is_active !== 'boolean'
    || typeof value.created_at !== 'string'
    || typeof value.updated_at !== 'string'
  ) return null;
  const label = value.label as string | null;
  const endpoint = value.endpoint as string | null;
  if ((label?.length || 0) > 240 || (endpoint?.length || 0) > MAX_PROVIDER_ENDPOINT_LENGTH) return null;
  return {
    id: value.id,
    provider: value.provider,
    label,
    endpoint,
    isActive: value.is_active,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
  };
}

function isAbortedError(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'name' in error
    && (error as { name?: unknown }).name === 'AbortError'
  );
}

export async function storeApiKey(
  provider: LLMProvider,
  apiKey: string,
  label?: string,
  endpoint?: string,
  options: { notify?: boolean } = {},
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.rpc('store_user_api_key', {
    p_provider: provider,
    p_api_key: apiKey,
    p_label: label || 'default',
    p_endpoint: endpoint || null,
  });

  if (error) return { error: error.message };
  if (options.notify !== false) notifyUserApiKeyChanges();
  return { id: data };
}

export async function listApiKeys(): Promise<ProviderKey[]> {
  const { data, error } = await supabase.rpc('list_user_api_keys');
  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    provider: row.provider as LLMProvider,
    label: row.label,
    endpoint: row.endpoint,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function deleteApiKey(keyId: string): Promise<{ error?: string }> {
  const { error } = await supabase.rpc('delete_user_api_key', { p_key_id: keyId });
  if (!error) notifyUserApiKeyChanges();
  return error ? { error: error.message } : {};
}

/**
 * Read provider-key metadata for one captured Office authority. This exact
 * path never asks the mutable global auth session who owns the response.
 */
export async function listApiKeysExact(
  capturedAuthority: ProviderKeysExactAuthority,
  isCurrent: ProviderKeysAuthorityGuard,
  signal?: AbortSignal,
): Promise<ProviderKeysExactListResult> {
  const resolved = await resolveProviderKeysExactAuthority(capturedAuthority, isCurrent, signal);
  if (!resolved.ok) return exactProviderListFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
    return exactProviderListFailure(authority, 'authority_retired');
  }

  try {
    let request = supabase
      .rpc('list_user_api_keys')
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (signal) request = request.abortSignal(signal);
    const { data, error } = await request;
    if (signal?.aborted) return exactProviderListFailure(authority, 'aborted');
    if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
      return exactProviderListFailure(authority, 'authority_retired');
    }
    if (error) return exactProviderListFailure(authority, error.message || 'request_failed');
    if (!Array.isArray(data) || data.length > 100) {
      return exactProviderListFailure(authority, 'invalid_response');
    }
    const keys: ProviderKey[] = [];
    for (const row of data) {
      const parsed = parseProviderKeyRow(row);
      if (!parsed) return exactProviderListFailure(authority, 'invalid_response');
      keys.push(parsed);
    }
    return {
      ok: true,
      keys,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch (error) {
    return exactProviderListFailure(authority, isAbortedError(error) || signal?.aborted
      ? 'aborted'
      : 'request_failed');
  }
}

/** Store one user provider key using only the caller-captured bearer. */
export async function storeApiKeyExact(
  provider: LLMProvider,
  apiKey: string,
  label: string | undefined,
  endpoint: string | undefined,
  capturedAuthority: ProviderKeysExactAuthority,
  isCurrent: ProviderKeysAuthorityGuard,
  options: { notify?: boolean; signal?: AbortSignal } = {},
): Promise<ProviderKeyExactMutationResult> {
  const resolved = await resolveProviderKeysExactAuthority(
    capturedAuthority,
    isCurrent,
    options.signal,
  );
  if (!resolved.ok) return exactProviderMutationFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const normalizedLabel = typeof label === 'string' ? label.trim() : '';
  const normalizedEndpoint = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (
    !isKnownProvider(provider)
    || !normalizedKey
    || normalizedKey.length > MAX_PROVIDER_API_KEY_LENGTH
    || normalizedLabel.length > 240
    || normalizedEndpoint.length > MAX_PROVIDER_ENDPOINT_LENGTH
  ) return exactProviderMutationFailure(authority, 'invalid_request');
  if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
    return exactProviderMutationFailure(authority, 'authority_retired');
  }

  try {
    let request = supabase
      .rpc('store_user_api_key', {
        p_provider: provider,
        p_api_key: normalizedKey,
        p_label: normalizedLabel || 'default',
        p_endpoint: normalizedEndpoint || null,
      })
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (options.signal) request = request.abortSignal(options.signal);
    const { data, error } = await request;
    if (options.signal?.aborted) return exactProviderMutationFailure(authority, 'aborted');
    if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
      return exactProviderMutationFailure(authority, 'authority_retired');
    }
    if (error) return exactProviderMutationFailure(authority, error.message || 'request_failed');
    if (typeof data !== 'string' || !UUID_RE.test(data)) {
      return exactProviderMutationFailure(authority, 'invalid_response');
    }
    if (options.notify !== false) notifyUserApiKeyChanges();
    return {
      ok: true,
      id: data,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch (error) {
    return exactProviderMutationFailure(authority, isAbortedError(error) || options.signal?.aborted
      ? 'aborted'
      : 'request_failed');
  }
}

/** Delete one key and prove it is absent from this same captured account. */
export async function deleteApiKeyExact(
  keyId: string,
  capturedAuthority: ProviderKeysExactAuthority,
  isCurrent: ProviderKeysAuthorityGuard,
  signal?: AbortSignal,
): Promise<ProviderKeyExactMutationResult> {
  const resolved = await resolveProviderKeysExactAuthority(capturedAuthority, isCurrent, signal);
  if (!resolved.ok) return exactProviderMutationFailure(resolved.authority, resolved.error);
  const { authority } = resolved;
  const normalizedKeyId = typeof keyId === 'string' ? keyId.trim() : '';
  if (!UUID_RE.test(normalizedKeyId)) return exactProviderMutationFailure(authority, 'invalid_request');
  if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
    return exactProviderMutationFailure(authority, 'authority_retired');
  }

  try {
    let request = supabase
      .rpc('delete_user_api_key', { p_key_id: normalizedKeyId })
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (signal) request = request.abortSignal(signal);
    const { error } = await request;
    if (signal?.aborted) return exactProviderMutationFailure(authority, 'aborted');
    if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
      return exactProviderMutationFailure(authority, 'authority_retired');
    }
    if (error) return exactProviderMutationFailure(authority, error.message || 'request_failed');

    const proof = await listApiKeysExact(authority, isCurrent, signal);
    if (!proof.ok) return exactProviderMutationFailure(authority, proof.error || 'request_failed');
    if (proof.keys.some((key) => key.id === normalizedKeyId)) {
      return exactProviderMutationFailure(authority, 'invalid_response');
    }
    notifyUserApiKeyChanges();
    return {
      ok: true,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
    };
  } catch (error) {
    return exactProviderMutationFailure(authority, isAbortedError(error) || signal?.aborted
      ? 'aborted'
      : 'request_failed');
  }
}

/** Test an API key by making a minimal API call */
export async function testApiKey(
  provider: LLMProvider,
  apiKey: string,
  endpoint?: string,
  modelOverride?: string,
): Promise<{ success: boolean; error?: string }> {
  if (shouldBlockExternalAiProvider(provider)) {
    return { success: false, error: getStrictLocalAiModeMessage(provider) };
  }
  try {
    const { data, error } = await supabase.functions.invoke('llm-proxy', {
      body: {
        provider,
        model: modelOverride || getDefaultModel(provider),
        messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
        max_tokens: 5,
        api_key: apiKey,
        endpoint,
      },
    });

    if (error) return { success: false, error: error.message };
    if (data?.error) return { success: false, error: data.error };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/** Test a plaintext key without allowing a retired Office lifecycle to commit. */
export async function testApiKeyExact(
  provider: LLMProvider,
  apiKey: string,
  endpoint: string | undefined,
  modelOverride: string | undefined,
  capturedAuthority: ProviderKeysExactAuthority,
  isCurrent: ProviderKeysAuthorityGuard,
  signal?: AbortSignal,
): Promise<ProviderKeyExactTestResult> {
  const resolved = await resolveProviderKeysExactAuthority(capturedAuthority, isCurrent, signal);
  if (!resolved.ok) {
    return {
      success: false,
      userId: resolved.authority?.userId || null,
      circleId: resolved.authority?.circleId || null,
      generation: resolved.authority?.generation || null,
      error: resolved.error,
    };
  }
  const { authority } = resolved;
  const normalizedKey = typeof apiKey === 'string' ? apiKey.trim() : '';
  const normalizedEndpoint = typeof endpoint === 'string' ? endpoint.trim() : '';
  if (
    !isKnownProvider(provider)
    || !normalizedKey
    || normalizedKey.length > MAX_PROVIDER_API_KEY_LENGTH
    || normalizedEndpoint.length > MAX_PROVIDER_ENDPOINT_LENGTH
  ) {
    return {
      success: false,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
      error: 'invalid_request',
    };
  }
  if (shouldBlockExternalAiProvider(provider)) {
    return {
      success: false,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
      error: getStrictLocalAiModeMessage(provider),
    };
  }
  if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
    return {
      success: false,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
      error: 'authority_retired',
    };
  }

  try {
    const { data, error } = await supabase.functions.invoke('llm-proxy', {
      headers: { Authorization: `Bearer ${authority.accessToken}` },
      signal,
      body: {
        provider,
        model: modelOverride || getDefaultModel(provider),
        messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
        max_tokens: 5,
        api_key: normalizedKey,
        endpoint: normalizedEndpoint || undefined,
      },
    });
    if (signal?.aborted) {
      return { success: false, userId: authority.userId, circleId: authority.circleId, generation: authority.generation, error: 'aborted' };
    }
    if (!providerKeysAuthorityIsCurrent(authority, isCurrent)) {
      return { success: false, userId: authority.userId, circleId: authority.circleId, generation: authority.generation, error: 'authority_retired' };
    }
    if (error) {
      return { success: false, userId: authority.userId, circleId: authority.circleId, generation: authority.generation, error: error.message };
    }
    if (data?.error) {
      return { success: false, userId: authority.userId, circleId: authority.circleId, generation: authority.generation, error: String(data.error) };
    }
    return { success: true, userId: authority.userId, circleId: authority.circleId, generation: authority.generation };
  } catch (error) {
    return {
      success: false,
      userId: authority.userId,
      circleId: authority.circleId,
      generation: authority.generation,
      error: isAbortedError(error) || signal?.aborted
        ? 'aborted'
        : (error instanceof Error ? error.message : 'request_failed'),
    };
  }
}

/**
 * Verify the credential after it has been stored, without sending the raw key
 * again. This exercises the same authenticated user-key lookup and decryption
 * boundary that Chat uses, so Marketplace cannot call a key "Connected" only
 * because the provider accepted the pre-save probe.
 */
export async function testStoredApiKey(
  provider: LLMProvider,
  modelOverride?: string,
  circleId?: string,
): Promise<{ success: boolean; error?: string }> {
  if (shouldBlockExternalAiProvider(provider)) {
    return { success: false, error: getStrictLocalAiModeMessage(provider) };
  }
  try {
    await invokeLLMProxy({
      provider,
      model: modelOverride || getDefaultModel(provider),
      messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
      circleId,
      maxTokens: 5,
    });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Stored credential validation failed.',
    };
  }
}

function getDefaultModel(provider: LLMProvider): string {
  const models = PROVIDER_MODELS[provider];
  return models?.[0]?.id || 'gpt-5.6-luna';
}

// ─── Authenticated live provider catalogs ──────────────────────────────────

const PROVIDER_MODEL_CATALOG_TTL_MS = 10 * 60_000;
const PROVIDER_MODEL_CATALOG_FAILURE_TTL_MS = 30_000;
const LLM_PROXY_CAPABILITY_TTL_MS = 5 * 60_000;
const LLM_PROXY_CAPABILITY_TIMEOUT_MS = 2_500;
let llmProxyCapabilityCache: { modelCatalog: boolean; expiresAtMs: number } | null = null;
let llmProxyCapabilityInFlight: Promise<boolean> | null = null;

/**
 * Feature-negotiate the deployed Edge function before issuing `list_models`.
 * Older healthy llm-proxy deployments support Chat but return HTTP 400 for an
 * unknown action; their GET health payload has no capabilities array. Treat
 * that as a curated-catalog fallback instead of fanning one noisy 400 out per
 * connected provider during Chat startup.
 */
async function llmProxySupportsModelCatalog(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && llmProxyCapabilityCache && now < llmProxyCapabilityCache.expiresAtMs) {
    return llmProxyCapabilityCache.modelCatalog;
  }
  if (llmProxyCapabilityInFlight) return llmProxyCapabilityInFlight;

  const run = (async () => {
    const baseUrl = String(process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(baseUrl)) return false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), LLM_PROXY_CAPABILITY_TIMEOUT_MS);
    try {
      const response = await fetch(`${baseUrl}/functions/v1/llm-proxy`, {
        method: 'GET',
        signal: controller.signal,
      });
      if (!response.ok) return false;
      const payload = await response.json().catch(() => null) as { capabilities?: unknown } | null;
      return Array.isArray(payload?.capabilities) && payload.capabilities.includes('list_models');
    } catch {
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  })();

  llmProxyCapabilityInFlight = run;
  try {
    const modelCatalog = await run;
    llmProxyCapabilityCache = {
      modelCatalog,
      expiresAtMs: Date.now() + LLM_PROXY_CAPABILITY_TTL_MS,
    };
    return modelCatalog;
  } finally {
    if (llmProxyCapabilityInFlight === run) llmProxyCapabilityInFlight = null;
  }
}
const providerModelCatalogCache = new Map<
  string,
  { expiresAt: number; snapshot: ProviderModelCatalogSnapshot }
>();
let providerModelCatalogCacheEpoch = 0;
const providerModelCatalogRequestGeneration = new Map<string, number>();

const RETIRED_LIVE_MODELS: Partial<Record<LLMProvider, ReadonlySet<string>>> = {
  openai: new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-nano', 'o3-mini', 'o4-mini']),
  google_ai: new Set(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview']),
  deepseek: new Set(['deepseek-chat', 'deepseek-reasoner']),
};

/** Providers whose fixed, first-party models endpoint is supported by the
 * hosted proxy. Local/custom endpoints stay on the local OpenSwan bridge, and
 * providers without a documented list API use the curated fallback above. */
export const LIVE_MODEL_CATALOG_PROVIDERS: ReadonlySet<LLMProvider> = new Set([
  'openai',
  'anthropic',
  'openrouter',
  'groq',
  'github-models',
  'huggingface',
  'zai',
  'minimax',
  'google_ai',
  'mistral_ai',
  'cohere',
  'together_ai',
  'fireworks_ai',
  'deepseek',
]);

function readLiveProviderModel(provider: LLMProvider, value: unknown): ProviderModel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const label = typeof row.label === 'string' ? row.label.trim() : '';
  if (!/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(id)) return null;
  if (RETIRED_LIVE_MODELS[provider]?.has(id.toLowerCase())) return null;
  if (!label || label.length > 160) return null;
  const rawContext = typeof row.contextWindow === 'number' ? row.contextWindow : 0;
  const contextWindow = Number.isFinite(rawContext) && rawContext > 0
    ? Math.min(10_000_000, Math.floor(rawContext))
    : 128_000;
  const rawOutput = typeof row.maxOutputTokens === 'number' ? row.maxOutputTokens : 0;
  const maxOutputTokens = Number.isFinite(rawOutput) && rawOutput > 0
    ? Math.min(1_000_000, Math.floor(rawOutput))
    : undefined;
  const tier = row.costTier;
  const costTier: ProviderModel['costTier'] =
    tier === 'free' || tier === 'cheap' || tier === 'mid' || tier === 'expensive'
      ? tier
      : 'mid';
  return Object.freeze({
    id,
    label,
    provider,
    contextWindow,
    costTier,
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
    source: 'provider' as const,
  });
}

/** Merge a provider's offline fallback with its live account catalog. Curated
 * rows stay first (stable useful defaults); exact live IDs then fill out every
 * additional model the authenticated account can actually call. */
export function mergeProviderModelCatalog(
  provider: LLMProvider,
  liveModels: readonly ProviderModel[] = [],
): ProviderModel[] {
  const merged: ProviderModel[] = [];
  const seen = new Set<string>();
  for (const model of [...(PROVIDER_MODELS[provider] || []), ...liveModels]) {
    if (!model?.id || model.provider !== provider || seen.has(model.id)) continue;
    seen.add(model.id);
    merged.push(model);
  }
  return merged;
}

export function createProviderModelCatalogFallback(
  provider: LLMProvider,
  failureCode: ProviderModelCatalogFailureCode,
): ProviderModelCatalogSnapshot {
  return {
    provider,
    status: LIVE_MODEL_CATALOG_PROVIDERS.has(provider) ? 'fallback' : 'unsupported',
    models: [],
    fetchedAt: null,
    failureCode,
  };
}

/** Load the account catalog while preserving whether it was verified, failed,
 * or is unsupported. Callers must not infer those states from array length. */
export async function loadProviderModelCatalogSnapshot(
  provider: LLMProvider,
  circleId?: string | null,
  options: { force?: boolean } = {},
): Promise<ProviderModelCatalogSnapshot> {
  if (!LIVE_MODEL_CATALOG_PROVIDERS.has(provider)) {
    return {
      provider,
      status: 'unsupported',
      models: [],
      fetchedAt: null,
      failureCode: 'unsupported_provider',
    };
  }

  let userId = '';
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    userId = sessionData.session?.user?.id || '';
  } catch {
    return createProviderModelCatalogFallback(provider, 'auth_unavailable');
  }
  if (!userId) return createProviderModelCatalogFallback(provider, 'auth_unavailable');

  // Never reuse one signed-in user's account catalog for another user in the
  // same long-lived web/native runtime. Anonymous/auth-loading calls stay
  // uncached and the hosted proxy will fail closed if no JWT is available.
  const cacheKey = userId ? `${userId}:${provider}` : '';
  const now = Date.now();
  const cached = cacheKey ? providerModelCatalogCache.get(cacheKey) : undefined;
  if (!options.force && cached && now < cached.expiresAt) {
    return cached.snapshot;
  }
  const cacheEpoch = providerModelCatalogCacheEpoch;
  const requestGeneration = cacheKey
    ? (providerModelCatalogRequestGeneration.get(cacheKey) || 0) + 1
    : 0;
  if (cacheKey) providerModelCatalogRequestGeneration.set(cacheKey, requestGeneration);
  const mayPublishCache = () => cacheKey
    && cacheEpoch === providerModelCatalogCacheEpoch
    && providerModelCatalogRequestGeneration.get(cacheKey) === requestGeneration;

  if (!(await llmProxySupportsModelCatalog(options.force === true))) {
    const fallback = createProviderModelCatalogFallback(provider, 'request_failed');
    if (mayPublishCache()) {
      providerModelCatalogCache.set(cacheKey, {
        expiresAt: now + PROVIDER_MODEL_CATALOG_FAILURE_TTL_MS,
        snapshot: fallback,
      });
    }
    return fallback;
  }

  let snapshot: ProviderModelCatalogSnapshot;
  try {
    const { data, error } = await supabase.functions.invoke('llm-proxy', {
      body: {
        action: 'list_models',
        provider,
        ...(circleId ? { circleId } : {}),
      },
    });
    if (error) {
      const details = await readLLMProxyInvokeError(error, provider);
      snapshot = createProviderModelCatalogFallback(
        provider,
        details.code || 'request_failed',
      );
    } else if (data?.error) {
      const details = normalizeLLMProxyErrorPayload(data, data.error, undefined, provider);
      snapshot = createProviderModelCatalogFallback(
        provider,
        details.code || 'request_failed',
      );
    } else if (!Array.isArray(data?.models)) {
      snapshot = createProviderModelCatalogFallback(provider, 'invalid_response');
    } else {
      const models: ProviderModel[] = [];
      const seen = new Set<string>();
      for (const value of data.models.slice(0, 1000)) {
        const model = readLiveProviderModel(provider, value);
        if (!model || seen.has(model.id)) continue;
        seen.add(model.id);
        models.push(model);
      }
      snapshot = {
        provider,
        status: 'verified',
        models,
        fetchedAt: new Date(now).toISOString(),
      };
    }
  } catch {
    snapshot = createProviderModelCatalogFallback(provider, 'request_failed');
  }

  if (mayPublishCache()) {
    providerModelCatalogCache.set(cacheKey, {
      expiresAt: now + (snapshot.status === 'verified'
        ? PROVIDER_MODEL_CATALOG_TTL_MS
        : PROVIDER_MODEL_CATALOG_FAILURE_TTL_MS),
      snapshot,
    });
  }
  return snapshot;
}

/** Load the exact model inventory exposed to this user's stored provider key.
 * Fail-soft by design: picker callers retain the curated catalog if the
 * provider is offline, rate-limited, or has no listing endpoint. */
export async function listAvailableProviderModels(
  provider: LLMProvider,
  circleId?: string | null,
  options: { force?: boolean } = {},
): Promise<ProviderModel[]> {
  const snapshot = await loadProviderModelCatalogSnapshot(provider, circleId, options);
  return snapshot.models;
}

export function invalidateProviderModelCatalog(provider?: LLMProvider): void {
  providerModelCatalogCacheEpoch += 1;
  if (!provider) {
    providerModelCatalogCache.clear();
    providerModelCatalogRequestGeneration.clear();
    return;
  }
  for (const key of providerModelCatalogCache.keys()) {
    if (key.endsWith(`:${provider}`)) providerModelCatalogCache.delete(key);
  }
  for (const key of providerModelCatalogRequestGeneration.keys()) {
    if (key.endsWith(`:${provider}`)) providerModelCatalogRequestGeneration.delete(key);
  }
}

// ─── LLM Proxy invocation ───────────────────────────────────────────────────

export async function invokeLLMProxy(params: {
  provider: LLMProvider;
  model: string;
  messages: Array<{ role: string; content: string }>;
  circleId?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingLevel?: ThinkingLevel;
  // Phase 0: pass through server-tool / plugin specs so the chat
  // composer's "Web Search" toggle can attach
  // `[{type: 'openrouter:web_search'}]` to a turn. Edge function
  // forwards verbatim to OpenRouter (and to native function-calling
  // for OpenAI / Groq when present).
  tools?: Array<Record<string, unknown>>;
  plugins?: Array<Record<string, unknown>>;
}): Promise<LLMProxyResponse> {
  if (shouldBlockExternalAiProvider(params.provider)) {
    throw new Error(getStrictLocalAiModeMessage(params.provider));
  }
  const { data, error } = await supabase.functions.invoke('llm-proxy', {
    body: {
      provider: params.provider,
      model: params.model,
      messages: params.messages,
      circleId: params.circleId,
      temperature: params.temperature,
      max_tokens: params.maxTokens,
      thinkingLevel: params.thinkingLevel,
      tools: params.tools,
      plugins: params.plugins,
    },
  });

  if (error) throw new LLMProxyInvocationError(await readLLMProxyInvokeError(error, params.provider));
  if (data?.error) {
    throw new LLMProxyInvocationError(
      normalizeLLMProxyErrorPayload(data, data.error, undefined, params.provider),
    );
  }
  return data as LLMProxyResponse;
}

/**
 * Invoke a single selected model as text-only Chat. No tools, plugins,
 * OpenSwan sessions, agent runs, or cross-provider fallback are permitted.
 */
export async function invokePlainChatModel(params: {
  modelId: string | null | undefined;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  circleId?: string;
  maxTokens?: number;
}): Promise<LLMProxyResponse> {
  const route = resolvePlainChatModelRoute(params.modelId);
  if (!route) {
    throw new Error(`The selected model ${String(params.modelId || 'unknown')} has no text-only Chat route.`);
  }
  const result = await invokeLLMProxy({
    provider: route.provider,
    model: route.model,
    messages: params.messages,
    circleId: params.circleId,
    maxTokens: params.maxTokens ?? 512,
  });
  if (!result?.response?.trim()) {
    throw new Error(`The selected model ${route.model} returned no text.`);
  }
  return result;
}

/**
 * Convenience wrapper — answers a question using OpenRouter's server-
 * side web search. Routes through `invokeLLMProxy` with the
 * `openrouter:web_search` tool attached. Returns the assistant text.
 *
 * Throws if the user has no OpenRouter key configured (caller surfaces
 * the message — typically pointing at Marketplace → OpenRouter).
 *
 * Used by the chat composer's Web Search toggle (Phase 0). Also
 * available as a primitive that any other surface (automations,
 * computer-use planner, doc generator) can reach for when it needs
 * fresh facts.
 */
export async function webSearchViaOpenRouter(args: {
  query: string;
  /** OpenRouter model id. Defaults to `openrouter/auto` so the
   *  cheapest viable web-search-capable model is picked. */
  model?: string;
  circleId?: string;
  /** Extra system / user context to set up the search. The query
   *  itself is appended as the final user message. */
  systemPrompt?: string;
  conversation?: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  maxTokens?: number;
}): Promise<LLMProxyResponse> {
  const messages: Array<{ role: string; content: string }> = [];
  if (args.systemPrompt) messages.push({ role: 'system', content: args.systemPrompt });
  if (args.conversation && args.conversation.length > 0) {
    for (const m of args.conversation) messages.push({ role: m.role, content: m.content });
  }
  messages.push({ role: 'user', content: args.query });

  return invokeLLMProxy({
    provider: 'openrouter',
    model: args.model || 'openrouter/auto',
    messages,
    circleId: args.circleId,
    maxTokens: args.maxTokens || 1024,
    tools: [{ type: 'openrouter:web_search' }],
  });
}

// ─── React Hooks ────────────────────────────────────────────────────────────

export function useUserApiKeys() {
  const [keys, setKeys] = useState<ProviderKey[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const mountedRef = useRef(true);
  const refreshSequenceRef = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++refreshSequenceRef.current;
    if (mountedRef.current) setIsLoading(true);
    const data = await listApiKeys().catch(() => []);
    if (!mountedRef.current || sequence !== refreshSequenceRef.current) return;
    setKeys(data);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    const unsubscribe = subscribeUserApiKeyChanges(() => { void refresh(); });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, [refresh]);

  /** Check if user has a key for a given provider */
  const hasProvider = useCallback(
    (provider: LLMProvider) => keys.some((k) => k.provider === provider && k.isActive),
    [keys],
  );

  /** Get available models for providers the user has keys for */
  const availableModels = keys
    .filter((k) => k.isActive)
    .flatMap((k) => PROVIDER_MODELS[k.provider] || []);

  return { keys, isLoading, refresh, hasProvider, availableModels };
}

/**
 * Office-only provider-key hook. Its visible snapshot is tagged with the exact
 * user/circle/generation that produced it, so an account switch renders an
 * empty list immediately, before the replacement request even begins.
 */
export function useUserApiKeysExact(
  capturedAuthority: ProviderKeysExactAuthority | null | undefined,
  isCurrent: ProviderKeysAuthorityGuard,
) {
  const normalizedAuthority = normalizeProviderKeysExactAuthority(capturedAuthority);
  const scopeKey = normalizedAuthority
    ? `${normalizedAuthority.userId}\u0000${normalizedAuthority.circleId}\u0000${normalizedAuthority.generation}`
    : '';
  const [snapshot, setSnapshot] = useState<{
    scopeKey: string;
    keys: ProviderKey[];
    isLoading: boolean;
    error?: string;
  }>({ scopeKey: '', keys: [], isLoading: false });
  const mountedRef = useRef(true);
  const sequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    const authority = normalizeProviderKeysExactAuthority(capturedAuthority);
    const sequence = ++sequenceRef.current;
    abortRef.current?.abort();
    abortRef.current = null;
    if (!authority || !providerKeysAuthorityIsCurrent(authority, isCurrent)) {
      if (mountedRef.current) setSnapshot({ scopeKey: '', keys: [], isLoading: false });
      return;
    }
    const requestScopeKey = `${authority.userId}\u0000${authority.circleId}\u0000${authority.generation}`;
    const controller = new AbortController();
    abortRef.current = controller;
    if (mountedRef.current) {
      setSnapshot({ scopeKey: requestScopeKey, keys: [], isLoading: true });
    }
    const result = await listApiKeysExact(authority, isCurrent, controller.signal);
    if (
      !mountedRef.current
      || controller.signal.aborted
      || sequence !== sequenceRef.current
      || !providerKeysAuthorityIsCurrent(authority, isCurrent)
    ) return;
    abortRef.current = null;
    setSnapshot({
      scopeKey: requestScopeKey,
      keys: result.ok ? result.keys : [],
      isLoading: false,
      ...(result.error ? { error: result.error } : {}),
    });
  }, [
    capturedAuthority?.accessToken,
    capturedAuthority?.circleId,
    capturedAuthority?.generation,
    capturedAuthority?.userId,
    isCurrent,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    sequenceRef.current += 1;
    abortRef.current?.abort();
    setSnapshot({ scopeKey, keys: [], isLoading: Boolean(normalizedAuthority) });
    if (normalizedAuthority) void refresh();
    const unsubscribe = subscribeUserApiKeyChanges(() => { void refresh(); });
    return () => {
      mountedRef.current = false;
      sequenceRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      unsubscribe();
    };
  }, [refresh, scopeKey]);

  const snapshotIsCurrent = Boolean(
    normalizedAuthority
    && snapshot.scopeKey === scopeKey
    && providerKeysAuthorityIsCurrent(normalizedAuthority, isCurrent)
  );
  const keys = snapshotIsCurrent ? snapshot.keys : [];
  const hasProvider = useCallback(
    (provider: LLMProvider) => keys.some((key) => key.provider === provider && key.isActive),
    [keys],
  );
  const availableModels = keys
    .filter((key) => key.isActive)
    .flatMap((key) => PROVIDER_MODELS[key.provider] || []);

  return {
    keys,
    isLoading: snapshotIsCurrent ? snapshot.isLoading : Boolean(normalizedAuthority),
    error: snapshotIsCurrent ? snapshot.error : undefined,
    refresh,
    hasProvider,
    availableModels,
  };
}
