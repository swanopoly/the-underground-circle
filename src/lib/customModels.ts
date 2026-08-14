/**
 * customModels.ts — Manage user-added Hugging Face models
 * Users can add any HF model to use in chat and assign to custom agents.
 */

import { storage } from './storage';

const STORAGE_KEY = '@custom_hf_models';

export interface CustomModel {
  id: string;           // HF model ID (e.g., "meta-llama/Llama-4-Scout-17B-16E-Instruct")
  label: string;        // Display name (e.g., "Llama 4 Scout")
  desc: string;         // Short description
  color: string;        // Accent color for UI
  icon: string;         // 1-2 char icon
  provider: 'huggingface' | 'ollama' | 'openrouter' | 'custom';
  endpoint?: string;    // Custom API endpoint if not using HF Inference
  apiKey?: string;      // HF API token (stored locally, never sent to our server)
  addedAt: string;      // ISO date
}

// Default color palette for custom models
const CUSTOM_COLORS = ['#f472b6', '#a78bfa', '#67e8f9', '#fbbf24', '#34d399', '#fb923c', '#c084fc', '#38bdf8'];

export async function loadCustomModels(): Promise<CustomModel[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveCustomModels(models: CustomModel[]): Promise<void> {
  await storage.setItem(STORAGE_KEY, JSON.stringify(models));
}

export async function addCustomModel(model: Omit<CustomModel, 'addedAt'>): Promise<CustomModel> {
  const models = await loadCustomModels();
  const existing = models.find(m => m.id === model.id);
  if (existing) return existing; // Already added

  const newModel: CustomModel = {
    ...model,
    color: model.color || CUSTOM_COLORS[models.length % CUSTOM_COLORS.length],
    addedAt: new Date().toISOString(),
  };
  models.push(newModel);
  await saveCustomModels(models);
  return newModel;
}

export async function removeCustomModel(modelId: string): Promise<void> {
  const models = await loadCustomModels();
  await saveCustomModels(models.filter(m => m.id !== modelId));
}

/**
 * Search Hugging Face Hub for models.
 * Uses the public HF API — no auth required for search.
 */
export interface HFModelResult {
  id: string;
  modelId: string;
  author: string;
  downloads: number;
  likes: number;
  pipeline_tag?: string;
  lastModified?: string;
}

export type HFCategory = 'text-generation' | 'text2text-generation' | 'image-to-text' | 'visual-question-answering' | 'text-to-image' | 'translation' | 'summarization' | 'all';

export const HF_CATEGORIES: { key: HFCategory; label: string; icon: string; color: string }[] = [
  { key: 'text-generation', label: 'Chat / LLM', icon: '..', color: '#22c55e' },
  { key: 'text2text-generation', label: 'Text-to-Text', icon: 'T', color: '#6366f1' },
  { key: 'text-to-image', label: 'Image Gen', icon: 'I', color: '#ec4899' },
  { key: 'image-to-text', label: 'Vision', icon: 'V', color: '#f59e0b' },
  { key: 'translation', label: 'Translation', icon: 'Tr', color: '#6366f1' },
  { key: 'summarization', label: 'Summarize', icon: 'S', color: '#a855f7' },
  { key: 'all', label: 'All Types', icon: '*', color: '#a0a0b0' },
];

export async function searchHuggingFaceModels(
  query: string,
  category: HFCategory = 'text-generation',
  limit: number = 20,
): Promise<HFModelResult[]> {
  try {
    const filter = category !== 'all' ? `&filter=${category}` : '';
    const searchParam = query && query.length >= 2 ? `&search=${encodeURIComponent(query)}` : '';
    const res = await fetch(
      `https://huggingface.co/api/models?sort=downloads&direction=-1&limit=${limit}${filter}${searchParam}`,
      { headers: { Accept: 'application/json' } },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).map((m: any) => ({
      id: m.id || m.modelId,
      modelId: m.modelId || m.id,
      author: m.author || m.id?.split('/')[0] || '',
      downloads: m.downloads || 0,
      likes: m.likes || 0,
      pipeline_tag: m.pipeline_tag,
      lastModified: m.lastModified,
    }));
  } catch {
    return [];
  }
}

/** Fetch trending/popular models for browse view */
export async function fetchTrendingModels(category: HFCategory = 'text-generation'): Promise<HFModelResult[]> {
  return searchHuggingFaceModels('', category, 20);
}

/**
 * Format a HF model for the chat model selector.
 */
export function customModelToChatModel(model: CustomModel): {
  id: string; label: string; desc: string; color: string; icon: string;
} {
  return {
    id: `hf:${model.id}`,
    label: model.label,
    desc: model.desc,
    color: model.color,
    icon: model.icon,
  };
}
