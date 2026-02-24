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

// ─── Storage Functions ──────────────────────────────────

export async function loadSessionTags(): Promise<Map<string, SessionTag[]>> {
  try {
    const raw = await storage.getItem(STORAGE_KEY_SESSION_TAGS);
    if (!raw) return new Map();
    
    const data = JSON.parse(raw) as SessionTags[];
    const map = new Map<string, SessionTag[]>();
    data.forEach(item => {
      map.set(item.sessionKey, item.tags);
    });
    return map;
  } catch {
    return new Map();
  }
}

export async function saveSessionTags(tagsMap: Map<string, SessionTag[]>): Promise<void> {
  try {
    const data: SessionTags[] = [];
    tagsMap.forEach((tags, sessionKey) => {
      if (tags.length > 0) {
        data.push({ sessionKey, tags, timestamp: new Date().toISOString() });
      }
    });
    await storage.setItem(STORAGE_KEY_SESSION_TAGS, JSON.stringify(data));
  } catch {
    console.error('Failed to save session tags');
  }
}

export async function addSessionTag(
  sessionKey: string,
  tag: SessionTag,
  existingTags: Map<string, SessionTag[]>
): Promise<Map<string, SessionTag[]>> {
  const currentTags = existingTags.get(sessionKey) || [];
  
  // Don't add duplicate tags
  if (currentTags.some(t => t.key === tag.key)) {
    return existingTags;
  }
  
  const updated = new Map(existingTags);
  updated.set(sessionKey, [...currentTags, tag]);
  await saveSessionTags(updated);
  
  // Add to suggestions for auto-complete
  await addTagSuggestion(tag);
  
  return updated;
}

export async function removeSessionTag(
  sessionKey: string,
  tagKey: string,
  existingTags: Map<string, SessionTag[]>
): Promise<Map<string, SessionTag[]>> {
  const currentTags = existingTags.get(sessionKey) || [];
  const filtered = currentTags.filter(t => t.key !== tagKey);
  
  const updated = new Map(existingTags);
  if (filtered.length === 0) {
    updated.delete(sessionKey);
  } else {
    updated.set(sessionKey, filtered);
  }
  
  await saveSessionTags(updated);
  return updated;
}

// ─── Tag Suggestions (for auto-complete) ──────────────────

export async function loadTagSuggestions(): Promise<SessionTag[]> {
  try {
    const raw = await storage.getItem(STORAGE_KEY_TAG_SUGGESTIONS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function addTagSuggestion(tag: SessionTag): Promise<void> {
  try {
    const suggestions = await loadTagSuggestions();
    
    // Don't add duplicates
    if (suggestions.some(s => s.key === tag.key)) return;
    
    const updated = [...suggestions, tag];
    await storage.setItem(STORAGE_KEY_TAG_SUGGESTIONS, JSON.stringify(updated));
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
