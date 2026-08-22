/**
 * customModels.ts — Manage user-added Hugging Face models
 * Users can add any HF model to use in chat and assign to custom agents.
 */

import { storage } from './storage';
import { safeGetUserId } from './authSession';

const LEGACY_OWNERLESS_STORAGE_KEY = '@custom_hf_models';
const STORAGE_KEY_PREFIX = '@custom_hf_models_v2:';

export interface CustomModel {
  id: string;           // HF model ID (e.g., "meta-llama/Llama-4-Scout-17B-16E-Instruct")
  label: string;        // Display name (e.g., "Llama 4 Scout")
  desc: string;         // Short description
  color: string;        // Accent color for UI
  icon: string;         // 1-2 char icon
  provider: 'huggingface' | 'ollama' | 'openrouter' | 'custom';
  endpoint?: string;    // Custom API endpoint if not using HF Inference
  addedAt: string;      // ISO date
}

function normalizeOwnerId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized && normalized.length <= 200 ? normalized : null;
}

function customModelsStorageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(userId)}`;
}

async function resolveOwnerId(userId?: string | null): Promise<string | null> {
  const captured = normalizeOwnerId(userId);
  if (captured) return captured;
  return normalizeOwnerId(await safeGetUserId());
}

function withoutPersistedSecret(value: unknown): CustomModel | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = typeof candidate.id === 'string' ? candidate.id.trim().slice(0, 300) : '';
  const label = typeof candidate.label === 'string' ? candidate.label.trim().slice(0, 160) : '';
  const provider = candidate.provider;
  if (
    !id
    || !label
    || !['huggingface', 'ollama', 'openrouter', 'custom'].includes(String(provider || ''))
  ) return null;
  const endpoint = typeof candidate.endpoint === 'string'
    ? candidate.endpoint.trim().slice(0, 2_048)
    : '';
  return {
    id,
    label,
    desc: typeof candidate.desc === 'string' ? candidate.desc.slice(0, 500) : '',
    color: typeof candidate.color === 'string' ? candidate.color.slice(0, 40) : '',
    icon: typeof candidate.icon === 'string' ? candidate.icon.slice(0, 8) : '',
    provider: provider as CustomModel['provider'],
    ...(endpoint ? { endpoint } : {}),
    addedAt: typeof candidate.addedAt === 'string' ? candidate.addedAt.slice(0, 80) : '',
  };
}

// Default color palette for custom models
const CUSTOM_COLORS = ['#f472b6', '#a78bfa', '#67e8f9', '#fbbf24', '#34d399', '#fb923c', '#c084fc', '#38bdf8'];

export async function loadCustomModels(userId?: string | null): Promise<CustomModel[]> {
  try {
    // Ownerless rows may contain historical custom endpoints or API tokens.
    // They cannot be attributed safely, so never import them into an account.
    await storage.removeItem(LEGACY_OWNERLESS_STORAGE_KEY);
    const ownerId = await resolveOwnerId(userId);
    if (!ownerId) return [];
    const raw = await storage.getItem(customModelsStorageKey(ownerId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map(withoutPersistedSecret).filter((model): model is CustomModel => !!model)
      : [];
  } catch {
    return [];
  }
}

export async function saveCustomModels(models: CustomModel[], userId?: string | null): Promise<void> {
  await storage.removeItem(LEGACY_OWNERLESS_STORAGE_KEY);
  const ownerId = await resolveOwnerId(userId);
  if (!ownerId) throw new Error('A signed-in user is required to save custom models.');
  const safeModels = models
    .map(withoutPersistedSecret)
    .filter((model): model is CustomModel => !!model);
  await storage.setItem(customModelsStorageKey(ownerId), JSON.stringify(safeModels));
}

export async function addCustomModel(
  model: Omit<CustomModel, 'addedAt'>,
  userId?: string | null,
): Promise<CustomModel> {
  const ownerId = await resolveOwnerId(userId);
  if (!ownerId) throw new Error('A signed-in user is required to add a custom model.');
  const models = await loadCustomModels(ownerId);
  const existing = models.find(m => m.id === model.id);
  if (existing) return existing; // Already added

  const newModel: CustomModel = {
    ...model,
    color: model.color || CUSTOM_COLORS[models.length % CUSTOM_COLORS.length],
    addedAt: new Date().toISOString(),
  };
  models.push(newModel);
  await saveCustomModels(models, ownerId);
  return newModel;
}

export async function removeCustomModel(modelId: string, userId?: string | null): Promise<void> {
  const ownerId = await resolveOwnerId(userId);
  if (!ownerId) return;
  const models = await loadCustomModels(ownerId);
  await saveCustomModels(models.filter(m => m.id !== modelId), ownerId);
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
