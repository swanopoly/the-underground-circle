/**
 * computerUseUserTemplates — localStorage-backed library of user-saved
 * task templates. Each entry is just the task text the user originally
 * ran; tapping it in the Browser Task modal fills the input so the user
 * can tweak and run again.
 *
 * Not in the DB intentionally — these are inherently personal preferences
 * (not a circle-wide artifact), and localStorage is the right fidelity
 * for "my saved starting points" on this device. Can graduate to a
 * `user_computer_use_templates` table if users demand sync.
 */

import { Platform } from 'react-native';

const LEGACY_OWNERLESS_STORAGE_KEY = 'uc_saved_cu_templates_v1';
const STORAGE_KEY_PREFIX = 'uc_saved_cu_templates_v2:';
const MAX_TEMPLATES = 30;

export interface SavedTemplate {
  /** Stable-ish id (hash of task + timestamp) so dedupe works. */
  id: string;
  task: string;
  createdAt: string;
}

function storageKeyForUser(userId: string | null | undefined): string | null {
  const normalized = typeof userId === 'string' ? userId.trim().toLowerCase() : '';
  return normalized && normalized.length <= 200
    ? `${STORAGE_KEY_PREFIX}${encodeURIComponent(normalized)}`
    : null;
}

function retireOwnerlessTemplates(): void {
  try { window.localStorage.removeItem(LEGACY_OWNERLESS_STORAGE_KEY); } catch {}
}

export function loadSavedTemplates(userId?: string | null): SavedTemplate[] {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return [];
  try {
    retireOwnerlessTemplates();
    const storageKey = storageKeyForUser(userId);
    if (!storageKey) return [];
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x) => x && typeof x.task === 'string') as SavedTemplate[];
  } catch {
    return [];
  }
}

export function saveTemplate(
  task: string,
  userId?: string | null,
): { saved: boolean; alreadyExisted?: boolean } {
  const cleaned = task.trim();
  if (!cleaned || Platform.OS !== 'web' || typeof window === 'undefined') {
    return { saved: false };
  }
  try {
    retireOwnerlessTemplates();
    const storageKey = storageKeyForUser(userId);
    if (!storageKey) return { saved: false };
    const existing = loadSavedTemplates(userId);
    // Dedupe case-insensitively.
    const match = existing.find((t) => t.task.toLowerCase() === cleaned.toLowerCase());
    if (match) return { saved: false, alreadyExisted: true };

    const fresh: SavedTemplate = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      task: cleaned,
      createdAt: new Date().toISOString(),
    };
    const next = [fresh, ...existing].slice(0, MAX_TEMPLATES);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
    return { saved: true };
  } catch {
    return { saved: false };
  }
}

export function deleteSavedTemplate(id: string, userId?: string | null): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    retireOwnerlessTemplates();
    const storageKey = storageKeyForUser(userId);
    if (!storageKey) return;
    const existing = loadSavedTemplates(userId);
    const next = existing.filter((t) => t.id !== id);
    window.localStorage.setItem(storageKey, JSON.stringify(next));
  } catch {}
}
