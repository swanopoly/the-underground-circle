/**
 * llmProviders.ts — BYO API Key Management + Model Catalogs
 *
 * Manages user-provided LLM API keys (stored encrypted in Supabase)
 * and provides model catalogs per provider. Calls the llm-proxy edge function.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { getStrictLocalAiModeMessage, shouldBlockExternalAiProvider } from './privacyMode';
import {
  LLMProxyInvocationError,
  normalizeLLMProxyErrorPayload,
  readLLMProxyInvokeError,
} from './llmProxyErrorCore';
import { resolvePlainChatModelRoute } from './crossProviderRouter';

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

export interface ProviderModel {
  id: string;
  label: string;
  provider: LLMProvider;
  contextWindow: number;
  costTier: 'free' | 'cheap' | 'mid' | 'expensive';
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
  for (const listener of userApiKeyChangeListeners) {
    try { listener(); } catch { /* observers must not break credential writes */ }
  }
}

// ─── Model catalogs per provider ────────────────────────────────────────────

export const PROVIDER_MODELS: Record<LLMProvider, ProviderModel[]> = {
  openai: [
    { id: 'gpt-5.5',      label: 'GPT-5.5',      provider: 'openai', contextWindow: 1050000, costTier: 'expensive' },
    { id: 'gpt-5.5-pro',  label: 'GPT-5.5 Pro',  provider: 'openai', contextWindow: 1050000, costTier: 'expensive' },
    { id: 'gpt-5.4',      label: 'GPT-5.4',      provider: 'openai', contextWindow: 1050000, costTier: 'mid' },
    { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', provider: 'openai', contextWindow: 1050000, costTier: 'cheap' },
    { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', provider: 'openai', contextWindow: 1050000, costTier: 'cheap' },
    { id: 'gpt-4.1',      label: 'GPT-4.1',      provider: 'openai', contextWindow: 1047576, costTier: 'mid' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', contextWindow: 1047576, costTier: 'cheap' },
    { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', provider: 'openai', contextWindow: 1047576, costTier: 'cheap' },
    { id: 'gpt-4o',       label: 'GPT-4o',        provider: 'openai', contextWindow: 128000,  costTier: 'mid' },
    { id: 'gpt-4o-mini',  label: 'GPT-4o Mini',   provider: 'openai', contextWindow: 128000,  costTier: 'cheap' },
  ],
  openai_compatible: [
    { id: 'business-default', label: 'Business Default', provider: 'openai_compatible', contextWindow: 128000, costTier: 'mid' },
    { id: 'company-chat', label: 'Company Chat', provider: 'openai_compatible', contextWindow: 128000, costTier: 'mid' },
    { id: 'company-agent', label: 'Company Agent', provider: 'openai_compatible', contextWindow: 128000, costTier: 'mid' },
    { id: 'company-code', label: 'Company Code', provider: 'openai_compatible', contextWindow: 128000, costTier: 'mid' },
  ],
  anthropic: [
    { id: 'claude-fable-5',    label: 'Claude Fable 5',    provider: 'anthropic', contextWindow: 1000000, costTier: 'expensive' },
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
    { id: 'openai/gpt-4o',              label: 'GPT-4o',             provider: 'openrouter', contextWindow: 128000,  costTier: 'mid' },
    { id: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro',  provider: 'openrouter', contextWindow: 1000000, costTier: 'mid' },
    { id: 'google/gemini-2.5-pro',      label: 'Gemini 2.5 Pro',     provider: 'openrouter', contextWindow: 1048576, costTier: 'mid' },
    { id: 'google/gemini-2.5-flash',    label: 'Gemini 2.5 Flash',   provider: 'openrouter', contextWindow: 1048576, costTier: 'cheap' },
    { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'openrouter', contextWindow: 1048576, costTier: 'cheap' },
    { id: 'perplexity/sonar-deep-research', label: 'Sonar Deep Research', provider: 'openrouter', contextWindow: 200000, costTier: 'mid' },
    { id: 'meta-llama/llama-3.3-70b',   label: 'Llama 3.3 70B',      provider: 'openrouter', contextWindow: 131072, costTier: 'cheap' },
    { id: 'Qwen/Qwen3-235B-A22B',      label: 'Qwen 3 235B MoE',    provider: 'openrouter', contextWindow: 131072, costTier: 'mid' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B',  provider: 'groq', contextWindow: 128000, costTier: 'cheap' },
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
    { id: 'gpt-4.1',                      label: 'GPT-4.1',         provider: 'github-models', contextWindow: 1047576, costTier: 'free' },
    { id: 'gpt-4.1-mini',                 label: 'GPT-4.1 Mini',    provider: 'github-models', contextWindow: 1047576, costTier: 'free' },
    { id: 'gpt-4o',                       label: 'GPT-4o',          provider: 'github-models', contextWindow: 128000,  costTier: 'free' },
    { id: 'gpt-4o-mini',                  label: 'GPT-4o Mini',     provider: 'github-models', contextWindow: 128000,  costTier: 'free' },
    { id: 'Meta-Llama-3.1-405B-Instruct', label: 'Llama 3.1 405B',  provider: 'github-models', contextWindow: 128000,  costTier: 'free' },
    { id: 'Meta-Llama-3.1-70B-Instruct',  label: 'Llama 3.1 70B',   provider: 'github-models', contextWindow: 128000,  costTier: 'free' },
    { id: 'Mistral-Large-2411',            label: 'Mistral Large',    provider: 'github-models', contextWindow: 128000,  costTier: 'free' },
    { id: 'Phi-4',                         label: 'Phi-4',            provider: 'github-models', contextWindow: 16384,   costTier: 'free' },
    { id: 'cohere-command-r-plus',         label: 'Command R+',       provider: 'github-models', contextWindow: 128000,  costTier: 'free' },
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
    { id: 'glm-5',       label: 'GLM-5',       provider: 'zai', contextWindow: 131072, costTier: 'mid' },
    { id: 'glm-4-plus',  label: 'GLM-4 Plus',  provider: 'zai', contextWindow: 131072, costTier: 'mid' },
    { id: 'glm-4-air',   label: 'GLM-4 Air',   provider: 'zai', contextWindow: 131072, costTier: 'cheap' },
    { id: 'glm-4-flash', label: 'GLM-4 Flash', provider: 'zai', contextWindow: 128000, costTier: 'free' },
  ],
  minimax: [
    { id: 'MiniMax-M1',      label: 'MiniMax M1',      provider: 'minimax', contextWindow: 1000000, costTier: 'mid' },
    { id: 'MiniMax-Text-01', label: 'MiniMax Text 01', provider: 'minimax', contextWindow: 1000000, costTier: 'cheap' },
  ],
  google_ai: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', provider: 'google_ai', contextWindow: 1000000, costTier: 'mid' },
    { id: 'gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro Preview', provider: 'google_ai', contextWindow: 1000000, costTier: 'mid' },
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', provider: 'google_ai', contextWindow: 1000000, costTier: 'cheap' },
    { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'google_ai', contextWindow: 1000000, costTier: 'mid' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'google_ai', contextWindow: 1000000, costTier: 'cheap' },
    { id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', provider: 'google_ai', contextWindow: 1000000, costTier: 'cheap' },
  ],
  mistral_ai: [
    { id: 'mistral-large-latest', label: 'Mistral Large', provider: 'mistral_ai', contextWindow: 128000, costTier: 'mid' },
    { id: 'mistral-small-latest', label: 'Mistral Small', provider: 'mistral_ai', contextWindow: 128000, costTier: 'cheap' },
    { id: 'codestral-latest', label: 'Codestral', provider: 'mistral_ai', contextWindow: 32000, costTier: 'mid' },
  ],
  cohere: [
    { id: 'command-r-plus', label: 'Command R+', provider: 'cohere', contextWindow: 128000, costTier: 'mid' },
    { id: 'command-r', label: 'Command R', provider: 'cohere', contextWindow: 128000, costTier: 'cheap' },
  ],
  perplexity: [
    { id: 'sonar-deep-research', label: 'Sonar Deep Research', provider: 'perplexity', contextWindow: 200000, costTier: 'mid' },
    { id: 'sonar-reasoning-pro', label: 'Sonar Reasoning Pro', provider: 'perplexity', contextWindow: 200000, costTier: 'mid' },
    { id: 'sonar-pro', label: 'Sonar Pro', provider: 'perplexity', contextWindow: 200000, costTier: 'mid' },
    { id: 'sonar', label: 'Sonar', provider: 'perplexity', contextWindow: 128000, costTier: 'cheap' },
  ],
  together_ai: [
    { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Llama 3.3 70B Turbo', provider: 'together_ai', contextWindow: 131072, costTier: 'cheap' },
    { id: 'Qwen/Qwen3-235B-A22B-fp8-tput', label: 'Qwen 3 235B', provider: 'together_ai', contextWindow: 131072, costTier: 'mid' },
  ],
  fireworks_ai: [
    { id: 'accounts/fireworks/models/llama-v3p1-405b-instruct', label: 'Llama 3.1 405B', provider: 'fireworks_ai', contextWindow: 131072, costTier: 'mid' },
    { id: 'accounts/fireworks/models/deepseek-r1', label: 'DeepSeek R1', provider: 'fireworks_ai', contextWindow: 160000, costTier: 'mid' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', contextWindow: 128000, costTier: 'cheap' },
    { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'deepseek', contextWindow: 128000, costTier: 'mid' },
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
  return models?.[0]?.id || 'gpt-4o-mini';
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

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const data = await listApiKeys();
    setKeys(data);
    setIsLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

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
