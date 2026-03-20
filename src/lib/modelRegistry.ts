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
}

// ─── Cache ──────────────────────────────────────────────────────────────────

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let cachedModels: RegisteredModel[] | null = null;
let cacheTimestamp = 0;

// ─── Hardcoded Defaults (fallback when DB is empty) ─────────────────────────

const DEFAULT_MODELS: RegisteredModel[] = [
  // ── OpenAI ────────────────────────────────────────────────────────────────
  { provider: 'openai', model_id: 'gpt-4.1', label: 'GPT-4.1', category: 'chat', tier: 'mid', input_cost_per_m: 2.00, output_cost_per_m: 8.00, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', category: 'chat', tier: 'budget', input_cost_per_m: 0.40, output_cost_per_m: 1.60, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano', category: 'chat', tier: 'budget', input_cost_per_m: 0.10, output_cost_per_m: 0.40, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-4o', label: 'GPT-4o', category: 'chat', tier: 'mid', input_cost_per_m: 2.50, output_cost_per_m: 10.00, context_window: 128000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'gpt-4o-mini', label: 'GPT-4o Mini', category: 'chat', tier: 'budget', input_cost_per_m: 0.15, output_cost_per_m: 0.60, context_window: 128000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'o3', label: 'O3', category: 'reasoning', tier: 'frontier', input_cost_per_m: 10.00, output_cost_per_m: 40.00, context_window: 200000, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'o3-mini', label: 'O3 Mini', category: 'reasoning', tier: 'mid', input_cost_per_m: 1.10, output_cost_per_m: 4.40, context_window: 200000, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'openai', model_id: 'o4-mini', label: 'O4 Mini', category: 'reasoning', tier: 'mid', input_cost_per_m: 1.10, output_cost_per_m: 4.40, context_window: 200000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },

  // ── Google Gemini ─────────────────────────────────────────────────────────
  { provider: 'google', model_id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', category: 'chat', tier: 'frontier', input_cost_per_m: 1.25, output_cost_per_m: 10.00, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'google', last_verified_at: '' },
  { provider: 'google', model_id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', category: 'chat', tier: 'mid', input_cost_per_m: 0.15, output_cost_per_m: 0.60, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'google', last_verified_at: '' },
  { provider: 'google', model_id: 'gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash-Lite', category: 'chat', tier: 'budget', input_cost_per_m: 0.04, output_cost_per_m: 0.15, context_window: 1000000, supports_vision: true, supports_tools: true, is_active: true, api_compatible: 'google', last_verified_at: '' },

  // ── HuggingFace / Open Models ─────────────────────────────────────────────
  { provider: 'huggingface', model_id: 'Qwen/Qwen3-235B-A22B', label: 'Qwen 3 235B MoE', category: 'chat', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'Qwen/Qwen3-32B', label: 'Qwen 3 32B', category: 'chat', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'Qwen/Qwen2.5-72B-Instruct', label: 'Qwen 2.5 72B', category: 'chat', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'meta-llama/Llama-3.3-70B-Instruct', label: 'Llama 3.3 70B', category: 'chat', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'deepseek-ai/DeepSeek-R1', label: 'DeepSeek R1', category: 'reasoning', tier: 'frontier', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
  { provider: 'huggingface', model_id: 'mistralai/Mistral-Large-2411', label: 'Mistral Large', category: 'chat', tier: 'mid', input_cost_per_m: 0, output_cost_per_m: 0, context_window: 131072, supports_vision: false, supports_tools: true, is_active: true, api_compatible: 'openai', last_verified_at: '' },
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
    return data as RegisteredModel[];
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
