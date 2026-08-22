// Session Tagging & Attribution System
// Track which sessions belong to which projects/clients/teams

import { storage } from './storage';

export interface SessionTag {
  key: string;    // e.g., "project:website-redesign", "client:acme", "priority:high"
  label: string;  // Display name
  color: string;  // Hex color for UI
}

export interface SessionTags {
  sessionKey: string;
  tags: SessionTag[];
  timestamp: string;
}

/**
 * Exact authenticated owner boundary for Office-private local state.
 *
 * New Office callers must always supply this scope. The optional parameters on
 * the public functions below exist only so older, non-migrated surfaces keep
 * their historical ownerless namespace until they can be moved deliberately.
 * A scoped read never falls back to, copies, or imports that legacy data.
 */
export interface OfficeSessionStorageScope {
  userId: string;
  circleId: string;
}

// Common tag categories
export const TAG_CATEGORIES = {
  project: { label: 'Project', color: '#3b82f6', icon: '📁' },
  client: { label: 'Client', color: '#8b5cf6', icon: '🏢' },
  team: { label: 'Team', color: '#ec4899', icon: '👥' },
  priority: { label: 'Priority', color: '#f59e0b', icon: '⚡' },
  status: { label: 'Status', color: '#10b981', icon: '📊' },
  custom: { label: 'Custom', color: '#6b7280', icon: '🏷️' },
} as const;

export type TagCategory = keyof typeof TAG_CATEGORIES;

const STORAGE_KEY_SESSION_TAGS = '@office_session_tags';
const STORAGE_KEY_TAG_SUGGESTIONS = '@office_tag_suggestions';
export const OFFICE_SESSION_TAGS_SCOPED_PREFIX = '@office_session_tags_v2:';
export const OFFICE_TAG_SUGGESTIONS_SCOPED_PREFIX = '@office_tag_suggestions_v2:';

const OFFICE_SESSION_STORAGE_SCHEMA_VERSION = 2 as const;
const OFFICE_SESSION_STORAGE_MAX_BYTES = 1_000_000;
const OFFICE_SESSION_STORAGE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ScopedOfficeSessionEnvelope<T> {
  schemaVersion: typeof OFFICE_SESSION_STORAGE_SCHEMA_VERSION;
  userId: string;
  circleId: string;
  value: T;
}

function normalizeOfficeSessionStorageScope(
  scope: OfficeSessionStorageScope | undefined,
): OfficeSessionStorageScope | null {
  if (!scope || typeof scope !== 'object') return null;
  const userId = typeof scope.userId === 'string' ? scope.userId.trim().toLowerCase() : '';
  const circleId = typeof scope.circleId === 'string' ? scope.circleId.trim().toLowerCase() : '';
  if (!OFFICE_SESSION_STORAGE_UUID_RE.test(userId) || !OFFICE_SESSION_STORAGE_UUID_RE.test(circleId)) {
    return null;
  }
  return { userId, circleId };
}

export function isValidOfficeSessionStorageScope(
  scope: OfficeSessionStorageScope | null | undefined,
): scope is OfficeSessionStorageScope {
  return normalizeOfficeSessionStorageScope(scope || undefined) !== null;
}

function scopedStorageKey(
  prefix: string,
  scope: OfficeSessionStorageScope | undefined,
): string | null {
  if (scope === undefined) return null;
  const normalized = normalizeOfficeSessionStorageScope(scope);
  if (!normalized) return null;
  return `${prefix}${normalized.userId}:${normalized.circleId}`;
}

export function officeSessionTagsStorageKey(scope: OfficeSessionStorageScope): string | null {
  return scopedStorageKey(OFFICE_SESSION_TAGS_SCOPED_PREFIX, scope);
}

export function officeTagSuggestionsStorageKey(scope: OfficeSessionStorageScope): string | null {
  return scopedStorageKey(OFFICE_TAG_SUGGESTIONS_SCOPED_PREFIX, scope);
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sanitizedTag(value: unknown): SessionTag | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const key = boundedString(candidate.key, 200);
  const label = boundedString(candidate.label, 200);
  const color = boundedString(candidate.color, 16);
  if (!key || !label || !/^#[0-9a-f]{3,8}$/i.test(color)) return null;
  return { key, label, color };
}

function sanitizedTags(value: unknown): SessionTag[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, SessionTag>();
  for (const item of value.slice(0, 64)) {
    const tag = sanitizedTag(item);
    if (tag && !unique.has(tag.key)) unique.set(tag.key, tag);
  }
  return Array.from(unique.values());
}

function decodeSessionTags(value: unknown): Map<string, SessionTag[]> {
  if (!Array.isArray(value)) return new Map();
  const result = new Map<string, SessionTag[]>();
  for (const item of value.slice(0, 2_000)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    const sessionKey = boundedString(candidate.sessionKey, 500);
    const tags = sanitizedTags(candidate.tags);
    if (sessionKey && tags.length > 0) result.set(sessionKey, tags);
  }
  return result;
}

function readScopedEnvelope<T>(
  raw: string,
  expectedScope: OfficeSessionStorageScope,
): T | null {
  if (!raw || raw.length > OFFICE_SESSION_STORAGE_MAX_BYTES) return null;
  const normalized = normalizeOfficeSessionStorageScope(expectedScope);
  if (!normalized) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<ScopedOfficeSessionEnvelope<T>>;
    if (
      !candidate
      || typeof candidate !== 'object'
      || Array.isArray(candidate)
      || candidate.schemaVersion !== OFFICE_SESSION_STORAGE_SCHEMA_VERSION
      || candidate.userId !== normalized.userId
      || candidate.circleId !== normalized.circleId
    ) return null;
    return candidate.value as T;
  } catch {
    return null;
  }
}

function serializeScopedEnvelope<T>(
  scope: OfficeSessionStorageScope,
  value: T,
): string | null {
  const normalized = normalizeOfficeSessionStorageScope(scope);
  if (!normalized) return null;
  try {
    const serialized = JSON.stringify({
      schemaVersion: OFFICE_SESSION_STORAGE_SCHEMA_VERSION,
      ...normalized,
      value,
    } satisfies ScopedOfficeSessionEnvelope<T>);
    return serialized.length <= OFFICE_SESSION_STORAGE_MAX_BYTES ? serialized : null;
  } catch {
    return null;
  }
}

// ─── Storage Functions ──────────────────────────────────

export async function loadSessionTags(
  scope?: OfficeSessionStorageScope,
): Promise<Map<string, SessionTag[]>> {
  try {
    const key = scope === undefined
      ? STORAGE_KEY_SESSION_TAGS
      : officeSessionTagsStorageKey(scope);
    if (!key) return new Map();
    const raw = await storage.getItem(key);
    if (!raw) return new Map();

    if (scope !== undefined) {
      return decodeSessionTags(readScopedEnvelope<SessionTags[]>(raw, scope));
    }
    return decodeSessionTags(JSON.parse(raw));
  } catch {
    return new Map();
  }
}

export async function saveSessionTags(
  tagsMap: Map<string, SessionTag[]>,
  scope?: OfficeSessionStorageScope,
): Promise<void> {
  try {
    const data: SessionTags[] = [];
    tagsMap.forEach((tags, sessionKey) => {
      const safeSessionKey = boundedString(sessionKey, 500);
      const safeTags = sanitizedTags(tags);
      if (safeSessionKey && safeTags.length > 0 && data.length < 2_000) {
        data.push({ sessionKey: safeSessionKey, tags: safeTags, timestamp: new Date().toISOString() });
      }
    });
    const key = scope === undefined
      ? STORAGE_KEY_SESSION_TAGS
      : officeSessionTagsStorageKey(scope);
    if (!key) return;
    const serialized = scope === undefined
      ? JSON.stringify(data)
      : serializeScopedEnvelope(scope, data);
    if (!serialized) return;
    await storage.setItem(key, serialized);
  } catch {
    console.error('Failed to save session tags');
  }
}

export async function addSessionTag(
  sessionKey: string,
  tag: SessionTag,
  existingTags: Map<string, SessionTag[]>,
  scope?: OfficeSessionStorageScope,
): Promise<Map<string, SessionTag[]>> {
  if (scope !== undefined && !normalizeOfficeSessionStorageScope(scope)) return existingTags;
  const safeSessionKey = boundedString(sessionKey, 500);
  const safeTag = sanitizedTag(tag);
  if (!safeSessionKey || !safeTag) return existingTags;
  const currentTags = existingTags.get(safeSessionKey) || [];
  
  // Don't add duplicate tags
  if (currentTags.some(t => t.key === safeTag.key)) {
    return existingTags;
  }
  
  const updated = new Map(existingTags);
  updated.set(safeSessionKey, [...currentTags, safeTag]);
  await saveSessionTags(updated, scope);
  
  // Add to suggestions for auto-complete
  await addTagSuggestion(safeTag, scope);
  
  return updated;
}

export async function removeSessionTag(
  sessionKey: string,
  tagKey: string,
  existingTags: Map<string, SessionTag[]>,
  scope?: OfficeSessionStorageScope,
): Promise<Map<string, SessionTag[]>> {
  if (scope !== undefined && !normalizeOfficeSessionStorageScope(scope)) return existingTags;
  const safeSessionKey = boundedString(sessionKey, 500);
  const safeTagKey = boundedString(tagKey, 200);
  if (!safeSessionKey || !safeTagKey) return existingTags;
  const currentTags = existingTags.get(safeSessionKey) || [];
  const filtered = currentTags.filter(t => t.key !== safeTagKey);
  
  const updated = new Map(existingTags);
  if (filtered.length === 0) {
    updated.delete(safeSessionKey);
  } else {
    updated.set(safeSessionKey, filtered);
  }
  
  await saveSessionTags(updated, scope);
  return updated;
}

// ─── Tag Suggestions (for auto-complete) ──────────────────

export async function loadTagSuggestions(
  scope?: OfficeSessionStorageScope,
): Promise<SessionTag[]> {
  try {
    const key = scope === undefined
      ? STORAGE_KEY_TAG_SUGGESTIONS
      : officeTagSuggestionsStorageKey(scope);
    if (!key) return [];
    const raw = await storage.getItem(key);
    if (!raw) return [];
    const decoded = scope === undefined
      ? JSON.parse(raw)
      : readScopedEnvelope<SessionTag[]>(raw, scope);
    return sanitizedTags(decoded).slice(0, 512);
  } catch {
    return [];
  }
}

export async function addTagSuggestion(
  tag: SessionTag,
  scope?: OfficeSessionStorageScope,
): Promise<void> {
  try {
    if (scope !== undefined && !normalizeOfficeSessionStorageScope(scope)) return;
    const safeTag = sanitizedTag(tag);
    if (!safeTag) return;
    const suggestions = await loadTagSuggestions(scope);
    
    // Don't add duplicates
    if (suggestions.some(s => s.key === safeTag.key)) return;
    
    const updated = [...suggestions, safeTag].slice(-512);
    const key = scope === undefined
      ? STORAGE_KEY_TAG_SUGGESTIONS
      : officeTagSuggestionsStorageKey(scope);
    if (!key) return;
    const serialized = scope === undefined
      ? JSON.stringify(updated)
      : serializeScopedEnvelope(scope, updated);
    if (!serialized) return;
    await storage.setItem(key, serialized);
  } catch {
    console.error('Failed to save tag suggestion');
  }
}

// ─── Tag Parsing & Validation ──────────────────────────

export function parseTagString(input: string): { category: TagCategory; value: string } | null {
  // Format: "category:value" or just "value" (defaults to custom)
  const parts = input.trim().split(':');
  
  if (parts.length === 1) {
    return { category: 'custom', value: parts[0].toLowerCase() };
  }
  
  if (parts.length === 2) {
    const category = parts[0].toLowerCase() as TagCategory;
    const value = parts[1].toLowerCase();
    
    if (category in TAG_CATEGORIES) {
      return { category, value };
    }
  }
  
  return null;
}

export function createTag(category: TagCategory, value: string): SessionTag {
  const meta = TAG_CATEGORIES[category];
  const key = `${category}:${value.toLowerCase().replace(/\s+/g, '-')}`;
  const label = value.charAt(0).toUpperCase() + value.slice(1);
  
  return { key, label, color: meta.color };
}

export function tagToString(tag: SessionTag): string {
  // Extract category and value from key
  const [category, ...valueParts] = tag.key.split(':');
  return `${category}:${valueParts.join(':')}`;
}

// ─── Tag Filtering ──────────────────────────────────────

export function filterSessionsByTags(
  sessionKeys: string[],
  tagsMap: Map<string, SessionTag[]>,
  filterTags: SessionTag[]
): string[] {
  if (filterTags.length === 0) return sessionKeys;
  
  return sessionKeys.filter(sessionKey => {
    const sessionTags = tagsMap.get(sessionKey) || [];
    
    // Session must have ALL filter tags (AND logic)
    return filterTags.every(filterTag => 
      sessionTags.some(sessionTag => sessionTag.key === filterTag.key)
    );
  });
}

// ─── Tag Analytics ──────────────────────────────────────

export interface TagCostBreakdown {
  tag: SessionTag;
  sessionCount: number;
  totalCost: number;
  percentage: number;
}

export function calculateTagCostBreakdown(
  sessions: Array<{ sessionKey: string; totalCost?: number }>,
  tagsMap: Map<string, SessionTag[]>
): TagCostBreakdown[] {
  const tagCosts = new Map<string, { tag: SessionTag; sessions: Set<string>; cost: number }>();
  const totalCost = sessions.reduce((sum, s) => sum + (s.totalCost || 0), 0);
  
  // Aggregate costs by tag
  sessions.forEach(session => {
    const tags = tagsMap.get(session.sessionKey) || [];
    const cost = session.totalCost || 0;
    
    tags.forEach(tag => {
      const existing = tagCosts.get(tag.key);
      if (existing) {
        existing.sessions.add(session.sessionKey);
        existing.cost += cost;
      } else {
        tagCosts.set(tag.key, {
          tag,
          sessions: new Set([session.sessionKey]),
          cost,
        });
      }
    });
  });
  
  // Convert to array and calculate percentages
  const breakdown: TagCostBreakdown[] = [];
  tagCosts.forEach(({ tag, sessions: sessionSet, cost }) => {
    breakdown.push({
      tag,
      sessionCount: sessionSet.size,
      totalCost: cost,
      percentage: totalCost > 0 ? (cost / totalCost) * 100 : 0,
    });
  });
  
  // Sort by cost (highest first)
  return breakdown.sort((a, b) => b.totalCost - a.totalCost);
}
