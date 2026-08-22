// Session Cache - Persistent storage for agent session data
import { storage } from './storage';
import { getAgentIdentityKey } from './agentIdentity';
import { isValidOfficeSessionStorageScope, type OfficeSessionStorageScope } from './sessionTags';
import type { OfficeAgent } from './officeAgents';

const STORAGE_KEY_SESSION_CACHE = '@office_session_cache';
const STORAGE_KEY_DAILY_COSTS = '@office_daily_costs';
const STORAGE_KEY_TAGS = '@session_tags_backup';
export const OFFICE_SESSION_CACHE_SCOPED_PREFIX = '@office_session_cache_v2:';
export const OFFICE_DAILY_COSTS_SCOPED_PREFIX = '@office_daily_costs_v2:';
export const OFFICE_SESSION_TAG_BACKUP_SCOPED_PREFIX = '@session_tags_backup_v2:';

const OFFICE_SESSION_CACHE_SCHEMA_VERSION = 2 as const;
const OFFICE_SESSION_CACHE_MAX_BYTES = 2_000_000;

interface ScopedOfficeSessionCacheEnvelope<T> {
  schemaVersion: typeof OFFICE_SESSION_CACHE_SCHEMA_VERSION;
  userId: string;
  circleId: string;
  value: T;
}

function normalizedScope(scope: OfficeSessionStorageScope | undefined): OfficeSessionStorageScope | null {
  if (!scope || !isValidOfficeSessionStorageScope(scope)) return null;
  return {
    userId: scope.userId.trim().toLowerCase(),
    circleId: scope.circleId.trim().toLowerCase(),
  };
}

function scopedStorageKey(prefix: string, scope: OfficeSessionStorageScope): string | null {
  const normalized = normalizedScope(scope);
  return normalized ? `${prefix}${normalized.userId}:${normalized.circleId}` : null;
}

export function officeSessionCacheStorageKey(scope: OfficeSessionStorageScope): string | null {
  return scopedStorageKey(OFFICE_SESSION_CACHE_SCOPED_PREFIX, scope);
}

export function officeDailyCostsStorageKey(scope: OfficeSessionStorageScope): string | null {
  return scopedStorageKey(OFFICE_DAILY_COSTS_SCOPED_PREFIX, scope);
}

export function officeSessionTagBackupStorageKey(scope: OfficeSessionStorageScope): string | null {
  return scopedStorageKey(OFFICE_SESSION_TAG_BACKUP_SCOPED_PREFIX, scope);
}

function keyForScope(
  legacyKey: string,
  scopedPrefix: string,
  scope: OfficeSessionStorageScope | undefined,
): string | null {
  return scope === undefined ? legacyKey : scopedStorageKey(scopedPrefix, scope);
}

function serializeScopedValue<T>(scope: OfficeSessionStorageScope, value: T): string | null {
  const normalized = normalizedScope(scope);
  if (!normalized) return null;
  try {
    const serialized = JSON.stringify({
      schemaVersion: OFFICE_SESSION_CACHE_SCHEMA_VERSION,
      ...normalized,
      value,
    } satisfies ScopedOfficeSessionCacheEnvelope<T>);
    return serialized.length <= OFFICE_SESSION_CACHE_MAX_BYTES ? serialized : null;
  } catch {
    return null;
  }
}

function readScopedValue<T>(raw: string, scope: OfficeSessionStorageScope): T | null {
  const normalized = normalizedScope(scope);
  if (!normalized || !raw || raw.length > OFFICE_SESSION_CACHE_MAX_BYTES) return null;
  try {
    const candidate = JSON.parse(raw) as Partial<ScopedOfficeSessionCacheEnvelope<T>>;
    if (
      !candidate
      || typeof candidate !== 'object'
      || Array.isArray(candidate)
      || candidate.schemaVersion !== OFFICE_SESSION_CACHE_SCHEMA_VERSION
      || candidate.userId !== normalized.userId
      || candidate.circleId !== normalized.circleId
    ) return null;
    return candidate.value as T;
  } catch {
    return null;
  }
}

function finiteNonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function boundedString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

export interface CachedSession {
  sessionKey: string;
  agentId: string;
  connectionId: string;
  lastUpdate: number;
  totalCost: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  turns: number;
  model?: string;
  status?: string;
  lastActivity?: number;
  tags?: string[]; // Store tag keys
}

export interface DailyCostSnapshot {
  date: string; // YYYY-MM-DD
  costs: Record<string, number>; // agentId -> total cost for that day
  tokens: Record<string, number>; // agentId -> total tokens for that day
}

function decodeSessionCache(value: unknown): Map<string, CachedSession> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
  const cache = new Map<string, CachedSession>();
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 2_000)) {
    if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) continue;
    const candidate = rawValue as Record<string, unknown>;
    const key = boundedString(rawKey, 500);
    const sessionKey = boundedString(candidate.sessionKey, 500);
    const agentId = boundedString(candidate.agentId, 500);
    const connectionId = boundedString(candidate.connectionId, 500);
    if (!key || sessionKey !== key || !agentId || !connectionId) continue;
    const rawTags = Array.isArray(candidate.tags)
      ? candidate.tags
        .map((tag) => boundedString(tag, 200))
        .filter(Boolean)
        .slice(0, 64)
      : [];
    cache.set(key, {
      sessionKey,
      agentId,
      connectionId,
      lastUpdate: finiteNonNegative(candidate.lastUpdate),
      totalCost: finiteNonNegative(candidate.totalCost),
      totalTokens: finiteNonNegative(candidate.totalTokens),
      inputTokens: finiteNonNegative(candidate.inputTokens),
      outputTokens: finiteNonNegative(candidate.outputTokens),
      turns: finiteNonNegative(candidate.turns),
      model: boundedString(candidate.model, 200) || undefined,
      status: boundedString(candidate.status, 100) || undefined,
      lastActivity: finiteNonNegative(candidate.lastActivity) || undefined,
      tags: rawTags.length > 0 ? Array.from(new Set(rawTags)) : undefined,
    });
  }
  return cache;
}

function decodeDailyCosts(value: unknown): DailyCostSnapshot[] {
  if (!Array.isArray(value)) return [];
  const snapshots: DailyCostSnapshot[] = [];
  for (const rawSnapshot of value.slice(-366)) {
    if (!rawSnapshot || typeof rawSnapshot !== 'object' || Array.isArray(rawSnapshot)) continue;
    const candidate = rawSnapshot as Record<string, unknown>;
    const date = boundedString(candidate.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const safeRecord = (raw: unknown): Record<string, number> => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const result: Record<string, number> = {};
      for (const [rawId, rawAmount] of Object.entries(raw).slice(0, 2_000)) {
        const id = boundedString(rawId, 500);
        if (id) result[id] = finiteNonNegative(rawAmount);
      }
      return result;
    };
    snapshots.push({
      date,
      costs: safeRecord(candidate.costs),
      tokens: safeRecord(candidate.tokens),
    });
  }
  return snapshots;
}

function decodeTagBackup(value: unknown): Map<string, any[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return new Map();
  const result = new Map<string, any[]>();
  for (const [rawKey, rawTags] of Object.entries(value).slice(0, 2_000)) {
    const key = boundedString(rawKey, 500);
    if (key && Array.isArray(rawTags)) result.set(key, rawTags.slice(0, 64));
  }
  return result;
}

// ─── Session Cache Functions ───────────────────────────────

/**
 * Omitting `scope` retains the deprecated ownerless cache for compatibility.
 * Passing a scope is fail-closed and never falls back to that legacy key.
 */
export async function loadSessionCache(
  scope?: OfficeSessionStorageScope,
): Promise<Map<string, CachedSession>> {
  try {
    const key = keyForScope(STORAGE_KEY_SESSION_CACHE, OFFICE_SESSION_CACHE_SCOPED_PREFIX, scope);
    if (!key) return new Map();
    const raw = await storage.getItem(key);
    if (!raw) return new Map();
    const decoded = scope === undefined ? JSON.parse(raw) : readScopedValue(raw, scope);
    return decodeSessionCache(decoded);
  } catch (error) {
    console.error('Failed to load session cache:', error);
    return new Map();
  }
}

export async function saveSessionCache(
  cache: Map<string, CachedSession>,
  scope?: OfficeSessionStorageScope,
): Promise<void> {
  try {
    const obj = Object.fromEntries(decodeSessionCache(Object.fromEntries(cache.entries())).entries());
    const key = keyForScope(STORAGE_KEY_SESSION_CACHE, OFFICE_SESSION_CACHE_SCOPED_PREFIX, scope);
    if (!key) return;
    const serialized = scope === undefined
      ? JSON.stringify(obj)
      : serializeScopedValue(scope, obj);
    if (!serialized) return;
    await storage.setItem(key, serialized);
  } catch (error) {
    console.error('Failed to save session cache:', error);
  }
}

export async function updateSessionCache(
  sessions: CachedSession[],
  scope?: OfficeSessionStorageScope,
): Promise<void> {
  if (scope !== undefined && !normalizedScope(scope)) return;
  const cache = await loadSessionCache(scope);
  
  sessions.forEach(session => {
    const existing = cache.get(session.sessionKey);
    
    if (existing) {
      // Merge: keep cumulative costs but update current data
      cache.set(session.sessionKey, {
        ...session,
        totalCost: Math.max(existing.totalCost, session.totalCost),
        totalTokens: Math.max(existing.totalTokens, session.totalTokens),
        lastUpdate: Date.now(),
      });
    } else {
      // New session
      cache.set(session.sessionKey, {
        ...session,
        lastUpdate: Date.now(),
      });
    }
  });

  await saveSessionCache(cache, scope);
}

export async function getCachedSession(
  sessionKey: string,
  scope?: OfficeSessionStorageScope,
): Promise<CachedSession | null> {
  const cache = await loadSessionCache(scope);
  return cache.get(sessionKey) || null;
}

export async function clearSessionCache(scope?: OfficeSessionStorageScope): Promise<void> {
  const key = keyForScope(STORAGE_KEY_SESSION_CACHE, OFFICE_SESSION_CACHE_SCOPED_PREFIX, scope);
  if (!key) return;
  const serialized = scope === undefined
    ? JSON.stringify({})
    : serializeScopedValue(scope, {});
  if (!serialized) return;
  await storage.setItem(key, serialized);
}

// ─── Daily Cost Tracking ───────────────────────────────────

export async function loadDailyCosts(
  scope?: OfficeSessionStorageScope,
): Promise<DailyCostSnapshot[]> {
  try {
    const key = keyForScope(STORAGE_KEY_DAILY_COSTS, OFFICE_DAILY_COSTS_SCOPED_PREFIX, scope);
    if (!key) return [];
    const raw = await storage.getItem(key);
    if (!raw) return [];
    const decoded = scope === undefined ? JSON.parse(raw) : readScopedValue(raw, scope);
    return decodeDailyCosts(decoded);
  } catch (error) {
    console.error('Failed to load daily costs:', error);
    return [];
  }
}

export async function saveDailyCosts(
  snapshots: DailyCostSnapshot[],
  scope?: OfficeSessionStorageScope,
): Promise<void> {
  try {
    // Keep only last 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    const filtered = decodeDailyCosts(snapshots).filter(s => s.date >= cutoffStr);
    const key = keyForScope(STORAGE_KEY_DAILY_COSTS, OFFICE_DAILY_COSTS_SCOPED_PREFIX, scope);
    if (!key) return;
    const serialized = scope === undefined
      ? JSON.stringify(filtered)
      : serializeScopedValue(scope, filtered);
    if (!serialized) return;
    await storage.setItem(key, serialized);
  } catch (error) {
    console.error('Failed to save daily costs:', error);
  }
}

export async function recordDailyCosts(
  agents: OfficeAgent[],
  scope?: OfficeSessionStorageScope,
): Promise<void> {
  if (scope !== undefined && !normalizedScope(scope)) return;
  const today = new Date().toISOString().split('T')[0];
  const snapshots = await loadDailyCosts(scope);
  
  // Find or create today's snapshot
  let todaySnapshot = snapshots.find(s => s.date === today);
  if (!todaySnapshot) {
    todaySnapshot = { date: today, costs: {}, tokens: {} };
    snapshots.push(todaySnapshot);
  }

  // Update with current agent data
  agents.forEach(agent => {
    todaySnapshot!.costs[agent.id] = agent.costToday;
    todaySnapshot!.tokens[agent.id] = agent.tokensUsed;
  });

  await saveDailyCosts(snapshots, scope);
}

export async function getDailyCost(
  date: string,
  agentId?: string,
  scope?: OfficeSessionStorageScope,
): Promise<number> {
  const snapshots = await loadDailyCosts(scope);
  const snapshot = snapshots.find(s => s.date === date);
  
  if (!snapshot) return 0;
  
  if (agentId) {
    return snapshot.costs[agentId] || 0;
  }
  
  // Sum all agents for this day
  return Object.values(snapshot.costs).reduce((sum, cost) => sum + cost, 0);
}

export async function getWeeklyCost(
  agentId?: string,
  scope?: OfficeSessionStorageScope,
): Promise<number> {
  const snapshots = await loadDailyCosts(scope);
  const today = new Date();
  let total = 0;

  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const snapshot = snapshots.find(s => s.date === dateStr);
    if (snapshot) {
      if (agentId) {
        total += snapshot.costs[agentId] || 0;
      } else {
        total += Object.values(snapshot.costs).reduce((sum, cost) => sum + cost, 0);
      }
    }
  }

  return total;
}

export async function getMonthlyCost(
  agentId?: string,
  scope?: OfficeSessionStorageScope,
): Promise<number> {
  const snapshots = await loadDailyCosts(scope);
  const today = new Date();
  let total = 0;

  for (let i = 0; i < 30; i++) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    const snapshot = snapshots.find(s => s.date === dateStr);
    if (snapshot) {
      if (agentId) {
        total += snapshot.costs[agentId] || 0;
      } else {
        total += Object.values(snapshot.costs).reduce((sum, cost) => sum + cost, 0);
      }
    }
  }

  return total;
}

// ─── Agent State Restoration ───────────────────────────────

export async function enrichAgentsWithCache(
  agents: OfficeAgent[],
  scope?: OfficeSessionStorageScope,
): Promise<OfficeAgent[]> {
  const cache = await loadSessionCache(scope);
  const dailyCosts = await loadDailyCosts(scope);
  const today = new Date().toISOString().split('T')[0];
  const todaySnapshot = dailyCosts.find(s => s.date === today);

  return agents.map(agent => {
    const sessionKey = getAgentIdentityKey(agent);
    const cached = cache.get(sessionKey);
    
    if (cached) {
      // The cache is a cumulative SESSION baseline, never a daily billing
      // source. Preserve the server/live `costToday` value and enrich only the
      // separate session meter so login hydration cannot rewrite today's cost.
      const cachedCost = cached.totalCost || 0;
      const freshSessionCost = agent.sessionCostToday ?? agent.costToday ?? 0;
      const maxSessionCost = Math.max(cachedCost, freshSessionCost);
      
      const cachedTokens = cached.totalTokens || 0;
      const freshTokens = agent.tokensUsed || 0;
      const snapshotTokens = todaySnapshot?.tokens[agent.id] || 0;
      const maxTokens = Math.max(cachedTokens, freshTokens, snapshotTokens);
      
      return {
        ...agent,
        sessionCostToday: maxSessionCost,
        tokensUsed: maxTokens,
        // Keep fresh API data for status, model, activity
      };
    }
    
    return agent;
  });
}

// ─── Periodic Snapshot ─────────────────────────────────────

export async function takeSnapshot(
  agents: OfficeAgent[],
  sessionTags?: Map<string, any[]>,
  scope?: OfficeSessionStorageScope,
): Promise<void> {
  if (scope !== undefined && !normalizedScope(scope)) return;
  // Save current agent states to cache
  const sessions: CachedSession[] = agents.map(agent => {
    const sessionKey = getAgentIdentityKey(agent);
    const tags = sessionTags?.get(agent.id);
    const tagKeys = tags?.map((t: any) => t.key) || [];
    
    return {
      sessionKey, // Use extracted sessionKey as cache key
      agentId: agent.id,
      connectionId: agent.connectionId,
      lastUpdate: Date.now(),
      // Persist the cumulative session meter, not the server-owned daily
      // aggregate. The two reset on different boundaries.
      totalCost: agent.sessionCostToday ?? agent.costToday,
      totalTokens: agent.tokensUsed,
      inputTokens: 0, // Would need to track this separately
      outputTokens: 0,
      turns: 0,
      model: agent.model,
      status: agent.status,
      tags: tagKeys.length > 0 ? tagKeys : undefined,
    };
  });

  await updateSessionCache(sessions, scope);
  await recordDailyCosts(agents, scope);
  
  // Also save tags separately
  if (sessionTags) {
    await saveSessionTags(sessionTags, scope);
  }
}

// ─── Enrich OpenSwan Sessions ──────────────────────────────

export async function enrichSessionsWithCache(
  sessions: any[], // OpenSwanSession[] but avoiding circular import
  scope?: OfficeSessionStorageScope,
): Promise<any[]> {
  const cache = await loadSessionCache(scope);
  
  const enriched = sessions.map(session => {
    const cached = cache.get(session.sessionKey);
    
    if (!cached) {
      return session;
    }
    
    // CRITICAL: Always use MAX of cached vs fresh to prevent data loss
    const cachedCost = cached.totalCost || 0;
    const freshCost = session.totalCost || 0;
    const maxCost = Math.max(cachedCost, freshCost);
    
    return {
      ...session,
      totalCost: maxCost,
      totalInputTokens: Math.max(session.totalInputTokens || 0, cached.inputTokens),
      totalOutputTokens: Math.max(session.totalOutputTokens || 0, cached.outputTokens),
      turns: Math.max(session.turns || 0, cached.turns),
    };
  });
  
  return enriched;
}

// ─── Tag Management ────────────────────────────────────────

export async function saveSessionTags(
  tags: Map<string, any[]>,
  scope?: OfficeSessionStorageScope,
): Promise<void> {
  try {
    const obj: any = {};
    tags.forEach((tagList, sessionKey) => {
      if (tagList && tagList.length > 0) {
        obj[sessionKey] = tagList;
      }
    });
    const key = keyForScope(STORAGE_KEY_TAGS, OFFICE_SESSION_TAG_BACKUP_SCOPED_PREFIX, scope);
    if (!key) return;
    const serialized = scope === undefined
      ? JSON.stringify(obj)
      : serializeScopedValue(scope, obj);
    if (!serialized) return;
    await storage.setItem(key, serialized);
  } catch (error) {
    console.error('Failed to save session tags:', error);
  }
}

export async function loadSessionTags(
  scope?: OfficeSessionStorageScope,
): Promise<Map<string, any[]>> {
  try {
    const key = keyForScope(STORAGE_KEY_TAGS, OFFICE_SESSION_TAG_BACKUP_SCOPED_PREFIX, scope);
    if (!key) return new Map();
    const raw = await storage.getItem(key);
    if (!raw) return new Map();
    const decoded = scope === undefined ? JSON.parse(raw) : readScopedValue(raw, scope);
    return decodeTagBackup(decoded);
  } catch (error) {
    console.error('Failed to load session tags:', error);
    return new Map();
  }
}
