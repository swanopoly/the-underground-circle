/**
 * llmProviders.ts — BYO API Key Management + Model Catalogs
 *
 * Manages user-provided LLM API keys (stored encrypted in Supabase)
 * and provides model catalogs per provider. Calls the llm-proxy edge function.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from './supabase';
import { getStrictLocalAiModeMessage, shouldBlockExternalAiProvider } from './privacyMode';

// ─── Types ──────────────────────────────────────────────────────────────────

export type LLMProvider = 'openai' | 'anthropic' | 'openrouter' | 'groq' | 'ollama' | 'replicate' | 'github-models' | 'huggingface';

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

// ─── Model catalogs per provider ────────────────────────────────────────────

export const PROVIDER_MODELS: Record<LLMProvider, ProviderModel[]> = {
  openai: [
    { id: 'gpt-4.1',      label: 'GPT-4.1',      provider: 'openai', contextWindow: 1047576, costTier: 'mid' },
    { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', contextWindow: 1047576, costTier: 'cheap' },
    { id: 'gpt-4o',       label: 'GPT-4o',        provider: 'openai', contextWindow: 128000,  costTier: 'mid' },
    { id: 'gpt-4o-mini',  label: 'GPT-4o Mini',   provider: 'openai', contextWindow: 128000,  costTier: 'cheap' },
    { id: 'o4-mini',      label: 'O4 Mini',       provider: 'openai', contextWindow: 200000,  costTier: 'mid' },
    { id: 'o3-mini',      label: 'O3 Mini',       provider: 'openai', contextWindow: 200000,  costTier: 'mid' },
  ],
  anthropic: [
    { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'anthropic', contextWindow: 200000, costTier: 'mid' },
    { id: 'claude-haiku-4-5',  label: 'Claude Haiku 4.5',  provider: 'anthropic', contextWindow: 200000, costTier: 'cheap' },
    { id: 'claude-opus-4-6',   label: 'Claude Opus 4.6',   provider: 'anthropic', contextWindow: 200000, costTier: 'expensive' },
  ],
  openrouter: [
    { id: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'openrouter', contextWindow: 200000,  costTier: 'mid' },
    { id: 'openai/gpt-4o',              label: 'GPT-4o',             provider: 'openrouter', contextWindow: 128000,  costTier: 'mid' },
    { id: 'google/gemini-2.5-pro',      label: 'Gemini 2.5 Pro',     provider: 'openrouter', contextWindow: 1048576, costTier: 'mid' },
    { id: 'google/gemini-2.5-flash',    label: 'Gemini 2.5 Flash',   provider: 'openrouter', contextWindow: 1048576, costTier: 'cheap' },
    { id: 'meta-llama/llama-3.3-70b',   label: 'Llama 3.3 70B',      provider: 'openrouter', contextWindow: 131072, costTier: 'cheap' },
    { id: 'Qwen/Qwen3-235B-A22B',      label: 'Qwen 3 235B MoE',    provider: 'openrouter', contextWindow: 131072, costTier: 'mid' },
  ],
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B',  provider: 'groq', contextWindow: 128000, costTier: 'cheap' },
    { id: 'mixtral-8x7b-32768',      label: 'Mixtral 8x7B',   provider: 'groq', contextWindow: 32768,  costTier: 'cheap' },
  ],
  ollama: [
    { id: 'blackswan',   label: 'BlackSwan (Local)', provider: 'ollama', contextWindow: 4096,  costTier: 'free' },
    { id: 'llama3.2',    label: 'Llama 3.2',         provider: 'ollama', contextWindow: 131072, costTier: 'free' },
    { id: 'qwen3',       label: 'Qwen 3',            provider: 'ollama', contextWindow: 40960,  costTier: 'free' },
    { id: 'qwen2.5',     label: 'Qwen 2.5',          provider: 'ollama', contextWindow: 32768,  costTier: 'free' },
    { id: 'mistral',     label: 'Mistral',            provider: 'ollama', contextWindow: 32768,  costTier: 'free' },
  ],
  replicate: [
    { id: 'flux-schnell', label: 'Flux Schnell (fast)', provider: 'replicate', contextWindow: 0, costTier: 'cheap' },
    { id: 'flux-dev',     label: 'Flux Dev (quality)',   provider: 'replicate', contextWindow: 0, costTier: 'mid' },
    { id: 'stable-diffusion-xl', label: 'Stable Diffusion XL', provider: 'replicate', contextWindow: 0, costTier: 'cheap' },
    { id: 'stable-diffusion',    label: 'Stable Diffusion',    provider: 'replicate', contextWindow: 0, costTier: 'cheap' },
  ],
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
};

// ─── Provider help text ─────────────────────────────────────────────────────

export const PROVIDER_HELP: Record<LLMProvider, { url: string; hint: string }> = {
  openai:     { url: 'https://platform.openai.com/api-keys',         hint: 'Get your API key from OpenAI Platform' },
  anthropic:  { url: 'https://console.anthropic.com/settings/keys',  hint: 'Get your API key from Anthropic Console' },
  openrouter: { url: 'https://openrouter.ai/keys',                   hint: 'Get your API key from OpenRouter — access 2000+ models' },
  groq:       { url: 'https://console.groq.com/keys',                hint: 'Get your API key from Groq — ultra-fast inference' },
  ollama:     { url: 'https://ollama.com/download',                   hint: 'Install Ollama locally — free, runs on your machine' },
  replicate:      { url: 'https://replicate.com/account/api-tokens',     hint: 'Get your API token from Replicate — AI image generation' },
  'github-models': { url: 'https://github.com/settings/tokens',            hint: 'Use a GitHub PAT with models scope — free tier with rate limits' },
  huggingface:     { url: 'https://huggingface.co/settings/tokens',          hint: 'Get your HF token — free tier available, PRO ($9/mo) gets 20x credits' },
};

// ─── API Key CRUD ───────────────────────────────────────────────────────────

export async function storeApiKey(
  provider: LLMProvider,
  apiKey: string,
  label?: string,
  endpoint?: string,
): Promise<{ id?: string; error?: string }> {
  const { data, error } = await supabase.rpc('store_user_api_key', {
    p_provider: provider,
    p_api_key: apiKey,
    p_label: label || 'default',
    p_endpoint: endpoint || null,
  });

  if (error) return { error: error.message };
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
  return error ? { error: error.message } : {};
}

/** Test an API key by making a minimal API call */
export async function testApiKey(
  provider: LLMProvider,
  apiKey: string,
): Promise<{ success: boolean; error?: string }> {
  if (shouldBlockExternalAiProvider(provider)) {
    return { success: false, error: getStrictLocalAiModeMessage(provider) };
  }
  try {
    const { data, error } = await supabase.functions.invoke('llm-proxy', {
      body: {
        provider,
        model: getDefaultModel(provider),
        messages: [{ role: 'user', content: 'Say "ok" in one word.' }],
        max_tokens: 5,
        api_key: apiKey,
      },
    });

    if (error) return { success: false, error: error.message };
    if (data?.error) return { success: false, error: data.error };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
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
    },
  });

  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data as LLMProxyResponse;
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
