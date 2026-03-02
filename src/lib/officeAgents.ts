// Office Agent Types — real data comes from OpenClaw sessions
import { OpenClawSession } from './openclawService';
import { ProviderType } from './connectionManager';

export type AgentStatus = 'active' | 'idle' | 'error' | 'offline';

export interface OfficeAgent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  color: string;
  deskIndex: number;
  activity: string;
  messagesProcessed: number;
  uptimeHours: number;
  uptime: string;           // human-readable uptime from session_status (e.g. "3h ago")
  lastActive: string;
  recentActions: string[];
  recentMessages: Array<{ role: string; content: string; timestamp?: string }>;
  costToday: number;
  costWeek: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  newTokens: number;
  turns: number;
  sessionKey: string;
  model: string;
  connectionId: string;
  connectionName: string;
  providerType: ProviderType;
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  active: '#22c55e',
  idle: '#eab308',
  error: '#ef4444',
  offline: '#6b7280',
};

// Agent colors for assignment
export const AGENT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f472b6', '#fb923c', '#dc2626', '#84cc16', '#38bdf8',
  '#a855f7', '#22d3ee', '#e879f9', '#facc15',
];

// Empty default — no mock data
export const OFFICE_AGENTS: OfficeAgent[] = [];

// Default agent provided by the app — always present in the office
export const DEFAULT_AGENT: OfficeAgent = {
  id: 'default::blackswan',
  name: 'BlackSwan',
  role: 'Circle AI',
  status: 'idle',
  color: '#a855f7',
  deskIndex: 0,
  activity: 'Watching the circle',
  messagesProcessed: 0,
  uptimeHours: 0,
  uptime: 'always on',
  lastActive: new Date().toISOString(),
  recentActions: [],
  recentMessages: [],
  costToday: 0,
  costWeek: 0,
  tokensUsed: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  newTokens: 0,
  turns: 0,
  sessionKey: 'blackswan',
  model: 'claude-haiku-4-5',
  connectionId: 'default',
  connectionName: 'The Underground Circle',
  providerType: 'generic-agent',
};

// Pricing is centralized in modelPricing.ts — single source of truth
import { MODEL_PRICING, estimateCost, estimateCostWithCache } from './modelPricing';
export { MODEL_PRICING } from './modelPricing';

// Convert OpenClaw sessions to OfficeAgents
export function sessionsToAgents(
  sessions: OpenClawSession[],
  connectionId: string,
  connectionName: string,
  providerType: ProviderType,
): OfficeAgent[] {
  return sessions.map((s, i) => ({
    id: `${connectionId}::${s.sessionKey}`,
    name: s.agentId || s.sessionKey.slice(0, 12),
    role: s.kind === 'main' ? 'Main Agent' : s.kind === 'subagent' ? 'Sub-Agent' : s.kind || 'Session',
    status: inferStatus(s),
    color: AGENT_COLORS[i % AGENT_COLORS.length],
    deskIndex: i,
    activity: inferActivity(s),
    messagesProcessed: s.turns || s.messageCount || 0,
    uptimeHours: 0,
    uptime: s.uptime || '',
    lastActive: s.lastActivity || '',
    recentActions: extractRecentActions(s),
    recentMessages: s.lastMessages || [],
    // Use explicit cost if provided, else cache-aware calculation, else simple estimate
    costToday: s.totalCost
      ?? (s.cachedTokens != null || s.newTokens != null
          ? estimateCostWithCache(s.model, s.cachedTokens ?? 0, s.newTokens ?? 0, s.totalOutputTokens ?? 0)
          : estimateCost(s.model, s.totalInputTokens ?? 0, s.totalOutputTokens ?? 0)),
    costWeek: 0,
    tokensUsed: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
    inputTokens: s.totalInputTokens || 0,
    outputTokens: s.totalOutputTokens || 0,
    cachedTokens: s.cachedTokens || 0,
    newTokens: s.newTokens || 0,
    turns: s.turns || s.messageCount || 0,
    sessionKey: s.sessionKey,
    model: s.model || 'unknown',
    connectionId,
    connectionName,
    providerType,
  }));
}

function inferStatus(s: OpenClawSession): AgentStatus {
  if (!s.lastActivity) return 'offline';
  // If it has recent messages, likely active
  if (s.lastMessages && s.lastMessages.length > 0) return 'active';
  return 'idle';
}

function inferActivity(s: OpenClawSession): string {
  if (s.lastMessages && s.lastMessages.length > 0) {
    const last = s.lastMessages[s.lastMessages.length - 1];
    if (last.content) return last.content.slice(0, 50) + (last.content.length > 50 ? '...' : '');
  }
  if (s.kind === 'main') return 'Main session';
  if (s.kind === 'subagent') return 'Background task';
  return 'Idle';
}

function extractRecentActions(s: OpenClawSession): string[] {
  if (!s.lastMessages) return [];
  return s.lastMessages
    .filter(m => m.role === 'assistant' && m.content)
    .map(m => m.content.slice(0, 80))
    .slice(0, 5);
}

export type WhiteboardMode = 'overview' | 'activity' | 'ops' | 'agent_log';

export const WHITEBOARD_MODES: { key: WhiteboardMode; icon: string; label: string }[] = [
  { key: 'overview', icon: '📊', label: 'OVERVIEW' },
  { key: 'activity', icon: '📡', label: 'ACTIVITY' },
  { key: 'ops', icon: '⚙️', label: 'OPS' },
  { key: 'agent_log', icon: '📜', label: 'AGENT LOG' },
];

/**
 * Calculate simple daily performance score for Agent of the Day
 * Score ranges from 0-100 based on status, messages, and cost efficiency
 */
export function calculateDailyScore(agent: OfficeAgent): number {
  let score = 0;
  
  // Points for being active (40 points max)
  if (agent.status === 'active') score += 40;
  else if (agent.status === 'idle') score += 20;
  
  // Points for messages processed (30 points max, capped at 15 messages)
  score += Math.min(30, agent.messagesProcessed * 2);
  
  // Points for cost efficiency (30 points max)
  // Lower cost = higher score. $0.50/day = 30 points, $5/day = 0 points
  const costScore = Math.max(0, 30 - (agent.costToday * 6));
  score += costScore;
  
  return Math.min(100, Math.round(score));
}
