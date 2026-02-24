// Session Cache - Persistent storage for agent session data
import { getItem, setItem } from './storage';
import { OfficeAgent } from './officeAgents';

const STORAGE_KEY_SESSION_CACHE = '@office_session_cache';
const STORAGE_KEY_DAILY_COSTS = '@office_daily_costs';

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
}

export interface DailyCostSnapshot {
  date: string; // YYYY-MM-DD
  costs: Record<string, number>; // agentId -> total cost for that day
  tokens: Record<string, number>; // agentId -> total tokens for that day
}

// ─── Session Cache Functions ───────────────────────────────

export async function loadSessionCache(): Promise<Map<string, CachedSession>> {
  try {
    const raw = await getItem(STORAGE_KEY_SESSION_CACHE);
    if (!raw) return new Map();
    const data = JSON.parse(raw);
    return new Map(Object.entries(data));
  } catch (error) {
    console.error('Failed to load session cache:', error);
    return new Map();
  }
}

export async function saveSessionCache(cache: Map<string, CachedSession>): Promise<void> {
  try {
    const obj = Object.fromEntries(cache.entries());
    await setItem(STORAGE_KEY_SESSION_CACHE, JSON.stringify(obj));
  } catch (error) {
    console.error('Failed to save session cache:', error);
  }
}

export async function updateSessionCache(sessions: CachedSession[]): Promise<void> {
  const cache = await loadSessionCache();
  
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

  await saveSessionCache(cache);
}

export async function getCachedSession(sessionKey: string): Promise<CachedSession | null> {
  const cache = await loadSessionCache();
  return cache.get(sessionKey) || null;
}

export async function clearSessionCache(): Promise<void> {
  await setItem(STORAGE_KEY_SESSION_CACHE, JSON.stringify({}));
}

// ─── Daily Cost Tracking ───────────────────────────────────

export async function loadDailyCosts(): Promise<DailyCostSnapshot[]> {
  try {
    const raw = await getItem(STORAGE_KEY_DAILY_COSTS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (error) {
    console.error('Failed to load daily costs:', error);
    return [];
  }
}

export async function saveDailyCosts(snapshots: DailyCostSnapshot[]): Promise<void> {
  try {
    // Keep only last 90 days
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 90);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    
    const filtered = snapshots.filter(s => s.date >= cutoffStr);
    await setItem(STORAGE_KEY_DAILY_COSTS, JSON.stringify(filtered));
  } catch (error) {
    console.error('Failed to save daily costs:', error);
  }
}

export async function recordDailyCosts(agents: OfficeAgent[]): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const snapshots = await loadDailyCosts();
  
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

  await saveDailyCosts(snapshots);
}

export async function getDailyCost(date: string, agentId?: string): Promise<number> {
  const snapshots = await loadDailyCosts();
  const snapshot = snapshots.find(s => s.date === date);
  
  if (!snapshot) return 0;
  
  if (agentId) {
    return snapshot.costs[agentId] || 0;
  }
  
  // Sum all agents for this day
  return Object.values(snapshot.costs).reduce((sum, cost) => sum + cost, 0);
}

export async function getWeeklyCost(agentId?: string): Promise<number> {
  const snapshots = await loadDailyCosts();
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

export async function getMonthlyCost(agentId?: string): Promise<number> {
  const snapshots = await loadDailyCosts();
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

export async function enrichAgentsWithCache(agents: OfficeAgent[]): Promise<OfficeAgent[]> {
  const cache = await loadSessionCache();
  const dailyCosts = await loadDailyCosts();
  const today = new Date().toISOString().split('T')[0];
  const todaySnapshot = dailyCosts.find(s => s.date === today);

  return agents.map(agent => {
    const cached = cache.get(agent.id);
    
    if (cached) {
      // Restore cached data
      return {
        ...agent,
        costToday: todaySnapshot?.costs[agent.id] || cached.totalCost || agent.costToday,
        tokensUsed: todaySnapshot?.tokens[agent.id] || cached.totalTokens || agent.tokensUsed,
        // Keep fresh API data for status, model, etc.
      };
    }
    
    return agent;
  });
}

// ─── Periodic Snapshot ─────────────────────────────────────

export async function takeSnapshot(agents: OfficeAgent[]): Promise<void> {
  // Save current agent states to cache
  const sessions: CachedSession[] = agents.map(agent => ({
    sessionKey: agent.id,
    agentId: agent.id,
    connectionId: agent.connectionId,
    lastUpdate: Date.now(),
    totalCost: agent.costToday,
    totalTokens: agent.tokensUsed,
    inputTokens: 0, // Would need to track this separately
    outputTokens: 0,
    turns: 0,
    model: agent.model,
    status: agent.status,
  }));

  await updateSessionCache(sessions);
  await recordDailyCosts(agents);
}
