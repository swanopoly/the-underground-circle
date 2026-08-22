/**
 * modelRegistry.ts — Auto-updating model registry
 *
 * Fetches the latest available models from the model_registry table
 * (populated by the model-registry edge function that polls OpenAI,
 * Google, and HuggingFace APIs). Falls back to hardcoded defaults.
 *
 * Usage:
 *   const models = await getAvailableModels('openai');
 *   const chatModels = await getChatModels();
 *   await refreshModelRegistry();  // trigger server-side refresh
 */

import { supabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RegisteredModel {
  provider: string;
  model_id: string;
  label: string;
  category: 'chat' | 'reasoning' | 'code' | 'image' | 'embedding' | 'audio' | 'other';
  tier: 'frontier' | 'mid' | 'budget' | 'free';
  input_cost_per_m: number;
  output_cost_per_m: number;
  context_window: number;
  supports_vision: boolean;
  supports_tools: boolean;
  is_active: boolean;
  api_compatible: string;
  last_verified_at: string;
  released_at?: string | null;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cachedModels: RegisteredModel[] | null = null;
let cacheTimestamp = 0;

const RETIRED_REGISTERED_MODELS: Partial<Record<string, ReadonlySet<string>>> = {
  openai: new Set(['gpt-4o', 'gpt-4o-mini', 'gpt-4.1-nano', 'o3-mini', 'o4-mini']),
  google: new Set(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview']),
  google_ai: new Set(['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-3.1-pro-preview']),
  deepseek: new Set(['deepseek-chat', 'deepseek-reasoner']),
};

function isSelectableRegisteredModel(model: RegisteredModel): boolean {
  return !RETIRED_REGISTERED_MODELS[model.provider]?.has(model.model_id.toLowerCase());
}

// ─── Hardcoded Defaults (fallback when DB is empty) ─────────────────────────

const DEFAULT_MODELS: RegisteredModel[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  { provider: 'openai', model_id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', category: 'reasoning', tier: 'frontier', input_cost_per_m: 5.00, output_cost_per_m: 30.00, context_window: 1050000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', category: 'chat', tier: 'frontier', input_cost_per_m: 2.50, output_cost_per_m: 15.00, context_window: 1050000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', category: 'chat', tier: 'budget', input_cost_per_m: 1.00, output_cost_per_m: 6.00, context_window: 1050000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-5.5', label: 'GPT-5.5', category: 'chat', tier: 'frontier', input_cost_per_m: 5.00, output_cost_per_m: 30.00, context_window: 1050000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-5.5-pro', label: 'GPT-5.5 Pro', category: 'reasoning', tier: 'frontier', input_cost_per_m: 30.00, output_cost_per_m: 180.00, context_window: 1050000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-5.4', label: 'GPT-5.4', category: 'chat', tier: 'frontier', input_cost_per_m: 2.50, output_cost_per_m: 15.00, context_window: 1050000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', category: 'chat', tier: 'budget', input_cost_per_m: 0.75, output_cost_per_m: 4.50, context_window: 1050000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', category: 'chat', tier: 'budget', input_cost_per_m: 0.20, output_cost_per_m: 1.20, context_window: 1050000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-4.1', label: 'GPT-4.1', category: 'chat', tier: 'mid', input_cost_per_m: 2.00, output_cost_per_m: 8.00, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', category: 'chat', tier: 'budget', input_cost_per_m: 0.40, output_cost_per_m: 1.60, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'o3', label: 'O3', category: 'reasoning', tier: 'frontier', input_cost_per_m: 10.00, output_cost_per_m: 40.00, context_window: 200000, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'o3-pro', label: 'O3 Pro', category: 'reasoning', tier: 'frontier', input_cost_per_m: 20.00, output_cost_per_m: 80.00, context_window: 200000, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },

  // ── Anthropic Claude ──────────────────────────────────────────────────────
  { provider: 'anthropic', model_id: 'claude-fable-5', label: 'Claude Fable 5', category: 'reasoning', tier: 'frontier', input_cost_per_m: 10.00, output_cost_per_m: 50.00, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'anthropic', last_verified_at: '' },
  { provider: 'anthropic', model_id: 'claude-opus-5', label: 'Claude Opus 5', category: 'reasoning', tier: 'frontier', input_cost_per_m: 5.00, output_cost_per_m: 25.00, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'anthropic', last_verified_at: '' },
  { provider: 'anthropic', model_id: 'claude-sonnet-5', label: 'Claude Sonnet 5', category: 'chat', tier: 'frontier', input_cost_per_m: 3.00, output_cost_per_m: 15.00, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'anthropic', last_verified_at: '' },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  { provider: 'google', model_id: 'gemini-3.6-flash', label: 'Gemini 3.6 Flash', category: 'chat', tier: 'frontier', input_cost_per_m: 1.50, output_cost_per_m: 7.50, context_window: 1048576, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'google', last_verified_at: '' },
  { provider: 'google', model_id: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite', category: 'chat', tier: 'budget', input_cost_per_m: 0.30, output_cost_per_m: 2.50, context_window: 1048576, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'google', last_verified_at: '' },
  { provider: 'google', model_id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash', category: 'chat', tier: 'mid', input_cost_per_m: 1.50, output_cost_per_m: 9.00, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'google', last_verified_at: '' },
  { provider: 'google', model_id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash-Lite', category: 'chat', tier: 'budget', input_cost_per_m: 0.04, output_cost_per_m: 0.15, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'google', last_verified_at: '' },

  // ── HuggingFace / Open Models ─────────────────────────────────────────────
  { provider: 'huggingface', model_id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen 3 235B MoE', category: 'chat', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'Qwen/Qwen3-32B', label: 'Qwen 3 32B', category: 'chat', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B', category: 'chat', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', category: 'chat', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', category: 'reasoning', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'mistralai/Mistral-Large-2411', label: 'Mistral Large', category: 'chat', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },

  // ── New Frontier / Open Models (2025-2026) ──────────────────────────────
  { provider: 'huggingface', model_id: 'Qwen/Qwen3.5-72B-Instruct', label: 'Qwen 3.5 72B', category: 'chat', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'Qwen/Qwen3.5-27B-Instruct', label: 'Qwen 3.5 27B', category: 'chat', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'Qwen/Qwen3-Coder-Next', label: 'Qwen 3 Coder Next', category: 'code', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'nvidia/Nemotron-3-8B-Instruct', label: 'NVIDIA Nemotron 3', category: 'chat', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 8192, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'MiniMaxAI/MiniMax-M2.5', label: 'MiniMax M2.5', category: 'chat', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'THUDM/GLM-4.7-Flash', label: 'GLM 4.7 Flash', category: 'chat', tier: 'budget', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'moonshotai/Kimi-K2.5', label: 'Kimi K2.5', category: 'chat', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'THUDM/GLM-5', label: 'GLM 5', category: 'chat', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'gpt-oss/gpt-oss-20B', label: 'gpt-oss 20B', category: 'chat', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 32768, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'gpt-oss/gpt-oss-120B', label: 'gpt-oss 120B', category: 'chat', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 32768, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
];

// ─── Fetch from DB ──────────────────────────────────────────────────────────

async function fetchFromDB(): Promise<RegisteredModel[]> {
  try {
    const { data, error } = await supabase
      .from('model_registry')
      .select('*')
      .eq('is_active', true)
      .order('provider')
      .order('tier');

    if (error || !data || data.length === 0) return [];
    return (data as RegisteredModel[]).filter(isSelectableRegisteredModel);
  } catch {
    return [];
  }
}

// ─── Public API ─────────────────────────────────────────────────────────────

/** Get all available models (cached, falls back to defaults) */
export async function getAllModels(): Promise<RegisteredModel[]> {
  const now = Date.now();
  if (cachedModels && now - cacheTimestamp < CACHE_TTL) {
    return cachedModels;
  }

  const dbModels = await fetchFromDB();
  if (dbModels.length > 0) {
    cachedModels = dbModels;
    cacheTimestamp = now;
    return dbModels;
  }

  // Fallback to defaults
  cachedModels = DEFAULT_MODELS;
  cacheTimestamp = now;
  return DEFAULT_MODELS;
}

/** Get models for a specific provider */
export async function getModelsByProvider(provider: string): Promise<RegisteredModel[]> {
  const all = await getAllModels();
  return all.filter(m => m.provider === provider);
}

/** Get only chat + reasoning models (what most selectors need) */
export async function getChatModels(): Promise<RegisteredModel[]> {
  const all = await getAllModels();
  return all.filter(m => m.category === 'chat' || m.category === 'reasoning');
}

/** Get models by tier */
export async function getModelsByTier(tier: RegisteredModel['tier']): Promise<RegisteredModel[]> {
  const all = await getAllModels();
  return all.filter(m => m.tier === tier);
}

/** Get frontier models across all providers */
export async function getFrontierModels(): Promise<RegisteredModel[]> {
  const all = await getAllModels();
  return all.filter(m => m.tier === 'frontier');
}

/** Trigger server-side refresh of the model registry */
export async function refreshModelRegistry(provider?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('model-registry', {
      method: 'POST',
      body: { action: 'refresh', ...(provider ? { provider } : {}) },
    });

    if (error) return { ok: false, error: error.message };

    // Invalidate cache so next call fetches fresh data
    cachedModels = null;
    cacheTimestamp = 0;

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Failed to refresh' };
  }
}

/** Invalidate the cache (forces next call to re-fetch from DB) */
export function invalidateModelCache(): void {
  cachedModels = null;
  cacheTimestamp = 0;
}

/** Format model for display in selectors */
export function formatModelOption(model: RegisteredModel): {
  id: string;
  label: string;
  provider: string;
  icon: string;
  color: string;
  tier: string;
} {
  const icons: Record<string, string> = {
    openai: '✨',
    google: '♊',
    huggingface: '🤗',
    anthropic: '🎯',
  };
  const colors: Record<string, string> = {
    openai: '#10b981',
    google: '#4285f4',
    huggingface: '#ff9d00',
    anthropic: '#8b5cf6',
  };
  const tierLabels: Record<string, string> = {
    frontier: '⬥',
    mid: '◆',
    budget: '◇',
    free: '○',
  };

  return {
    id: model.model_id,
    label: `${model.label}${model.tier === 'frontier' ? ' ⬥' : ''}`,
    provider: model.provider,
    icon: icons[model.provider] || '🤖',
    color: colors[model.provider] || '#6366f1',
    tier: tierLabels[model.tier] || '',
  };
}
