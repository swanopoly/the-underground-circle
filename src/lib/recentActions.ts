/**
 * recentActions — tracks the most-recent quick actions the user fired,
 * surfaced as a "Recent" row in the SearchModal omnibar when the query is
 * empty. Backed by a single localStorage key; capped at 5 entries.
 *
 * Platform: web-only for now (localStorage). Native returns empty lists
 * silently so calling code doesn't have to guard.
 */

import type { QuickActionItem } from "./chatActions";

const STORAGE_KEY = "uc_recent_actions";
const MAX_RECENT = 5;

export function recordRecentAction(action: QuickActionItem) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const prev: QuickActionItem[] = raw ? JSON.parse(raw) : [];
    // Drop any previous entry with the same `text`, then prepend the new one.
    // Keeps the list ordered newest-first with no dupes.
    const next = [action, ...prev.filter((a) => a.text !== action.text)].slice(0, MAX_RECENT);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Full disk quota, serialization error, or private-mode refusal — ignore.
  }
}

export function getRecentActions(): QuickActionItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

export function clearRecentActions() {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch {}
}
