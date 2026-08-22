/**
 * Per-thread image library for the Chat Live Builder
 *
 * A user pool of image URLs the agent should use when building the next
 * page. Images carry an optional role hint (hero / feature / logo / etc.)
 * so the model picks the right one for each slot. Everything is stored in
 * localStorage per-thread — no DB writes, no uploads. Phase 1 of the image
 * story; phase 2 adds Supabase Storage uploads and HF generation.
 */

import { storage } from './storage';
import {
  chatPersonalThreadStorageKey,
  type ChatPersonalStorageScope,
} from './chatSessionStatePersistence';

export const BUILDER_IMAGES_STORAGE_KEY = 'uc_builder_images';

export type ImageRole =
  | 'hero'
  | 'feature'
  | 'logo'
  | 'background'
  | 'avatar'
  | 'product'
  | 'gallery'
  | 'other';

export const IMAGE_ROLE_LABELS: Record<ImageRole, string> = {
  hero: 'Hero / header',
  feature: 'Feature / benefit',
  logo: 'Logo',
  background: 'Background',
  avatar: 'Avatar / profile',
  product: 'Product shot',
  gallery: 'Gallery / grid',
  other: 'Other',
};

export interface BuilderImage {
  id: string;
  url: string;
  role: ImageRole;
  alt?: string;
  addedAt: string;
}

export type BuilderImagesStorageScope = ChatPersonalStorageScope & {
  threadId: string | null | undefined;
};

function legacyImagesKey(threadId: string): string {
  return `${BUILDER_IMAGES_STORAGE_KEY}_${threadId}`;
}

function imagesKey(scope: BuilderImagesStorageScope): string | null {
  return chatPersonalThreadStorageKey('builder_images', scope, scope.threadId);
}

export async function loadBuilderImages(scope: BuilderImagesStorageScope): Promise<BuilderImage[]> {
  const key = imagesKey(scope);
  if (!key || !scope.threadId) return [];
  try {
    // URLs and alt text are user-authored scratch data. Never import the old
    // thread-only envelope on a shared-browser/shared-Circle login.
    await storage.removeItem(legacyImagesKey(scope.threadId));
    const raw = await storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((img: unknown): img is BuilderImage => {
      if (!img || typeof img !== 'object') return false;
      const i = img as Partial<BuilderImage>;
      return typeof i.id === 'string' && typeof i.url === 'string' && i.url.trim().length > 0;
    });
  } catch {
    return [];
  }
}

export async function addBuilderImage(
  scope: BuilderImagesStorageScope,
  input: { url: string; role?: ImageRole; alt?: string },
): Promise<BuilderImage[]> {
  const key = imagesKey(scope);
  if (!key) return [];
  const url = input.url.trim();
  if (!url) return loadBuilderImages(scope);
  const existing = await loadBuilderImages(scope);
  const dedup = existing.find(e => e.url === url);
  if (dedup) return existing;
  const next: BuilderImage[] = [
    ...existing,
    {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      url,
      role: input.role || 'other',
      alt: input.alt?.trim() || undefined,
      addedAt: new Date().toISOString(),
    },
  ].slice(-20); // cap at 20 per thread to avoid prompt bloat
  try { await storage.setItem(key, JSON.stringify(next)); } catch {}
  return next;
}

export async function removeBuilderImage(
  scope: BuilderImagesStorageScope,
  id: string,
): Promise<BuilderImage[]> {
  const key = imagesKey(scope);
  if (!key) return [];
  const existing = await loadBuilderImages(scope);
  const next = existing.filter(i => i.id !== id);
  try { await storage.setItem(key, JSON.stringify(next)); } catch {}
  return next;
}

export async function updateBuilderImage(
  scope: BuilderImagesStorageScope,
  id: string,
  patch: Partial<Pick<BuilderImage, 'role' | 'alt'>>,
): Promise<BuilderImage[]> {
  const key = imagesKey(scope);
  if (!key) return [];
  const existing = await loadBuilderImages(scope);
  const next = existing.map(i => i.id === id ? { ...i, ...patch } : i);
  try { await storage.setItem(key, JSON.stringify(next)); } catch {}
  return next;
}

/**
 * Turn the image list into a `system_extra` fragment. Returns null when
 * the list is empty so callers don't append empty-block garbage to every
 * build prompt.
 */
export function buildImagesPromptPrefix(images: BuilderImage[]): string | null {
  if (!images || images.length === 0) return null;
  const lines = images.map(img => {
    const role = IMAGE_ROLE_LABELS[img.role];
    const alt = img.alt ? ` — alt: ${img.alt}` : '';
    return `- [${role}] ${img.url}${alt}`;
  });
  return `IMAGE LIBRARY — use these exact URLs where the role fits. Do NOT
fabricate image URLs; if a slot has no matching image, use a CSS gradient or
SVG placeholder instead.

${lines.join('\n')}`;
}
