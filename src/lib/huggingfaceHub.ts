/**
 * huggingfaceHub.ts — Hugging Face Hub API utilities
 *
 * Fetch trending models, search models, and get model details
 * from the public HF Hub API (no auth required for read-only access).
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HFModel {
  /** Full model ID, e.g. "meta-llama/Llama-3.3-70B-Instruct" */
  id: string;
  /** Model ID without author prefix */
  modelId: string;
  /** Author / org name, e.g. "meta-llama" */
  author?: string;
  /** Total downloads (all time) */
  downloads: number;
  /** Total likes / stars */
  likes: number;
  /** Trending score (when sorted by trending) */
  trendingScore?: number;
  /** Pipeline tag, e.g. "text-generation" */
  pipeline_tag?: string;
  /** Tags array, e.g. ["pytorch", "llama", "text-generation"] */
  tags: string[];
  /** Last modified ISO date */
  lastModified: string;
  /** Whether the model is private */
  private: boolean;
  /** SHA of latest commit */
  sha?: string;
}

export interface HFModelDetail extends HFModel {
  /** Siblings = list of files in the repo */
  siblings?: Array<{ rfilename: string }>;
  /** Card data parsed from README */
  cardData?: Record<string, any>;
  /** Model description (README content) */
  description?: string;
  /** Safetensors info with parameter count */
  safetensors?: {
    total?: number;
    parameters?: Record<string, number>;
  };
  /** Spaces using this model */
  spaces?: string[];
  /** Created at ISO date */
  createdAt?: string;
}

// ─── API Functions ────────────────────────────────────────────────────────────

const HF_API_BASE = 'https://huggingface.co/api';

/**
 * Fetch trending models from HF Hub (no auth needed).
 * Defaults to text-generation pipeline filter.
 */
export async function fetchTrendingModels(limit = 20): Promise<HFModel[]> {
  const url = `${HF_API_BASE}/models?sort=trending&limit=${limit}&filter=text-generation`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HF API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return normalizeModels(data);
}

/**
 * Search models by query string.
 */
export async function searchModels(query: string, limit = 10): Promise<HFModel[]> {
  const url = `${HF_API_BASE}/models?search=${encodeURIComponent(query)}&sort=trending&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HF API error: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return normalizeModels(data);
}

/**
 * Fetch full details for a single model.
 */
export async function fetchModelDetails(modelId: string): Promise<HFModelDetail> {
  const url = `${HF_API_BASE}/models/${modelId}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HF API error: ${res.status} ${res.statusText}`);
  }
  const raw = await res.json();
  return {
    ...normalizeModel(raw),
    siblings: raw.siblings,
    cardData: raw.cardData,
    description: raw.description,
    safetensors: raw.safetensors,
    spaces: raw.spaces,
    createdAt: raw.createdAt || raw.created_at,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizeModel(raw: any): HFModel {
  const id: string = raw.id || raw.modelId || '';
  const parts = id.split('/');
  return {
    id,
    modelId: parts.length > 1 ? parts.slice(1).join('/') : id,
    author: parts.length > 1 ? parts[0] : undefined,
    downloads: raw.downloads ?? 0,
    likes: raw.likes ?? 0,
    trendingScore: raw.trendingScore ?? raw.trending_score ?? undefined,
    pipeline_tag: raw.pipeline_tag ?? undefined,
    tags: raw.tags ?? [],
    lastModified: raw.lastModified ?? raw.last_modified ?? '',
    private: raw.private ?? false,
    sha: raw.sha,
  };
}

function normalizeModels(data: any[]): HFModel[] {
  if (!Array.isArray(data)) return [];
  return data.map(normalizeModel);
}

// ─── Formatting Helpers ───────────────────────────────────────────────────────

/** Format a large number with K/M/B suffix */
export function formatCount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Extract a short display name from a full model ID */
export function shortModelName(id: string): string {
  const parts = id.split('/');
  return parts.length > 1 ? parts[1] : id;
}
