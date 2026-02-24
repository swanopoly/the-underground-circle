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
  lastActive: string;
  recentActions: string[];
  costToday: number;
  costWeek: number;
  tokensUsed: number;
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
const AGENT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f472b6', '#fb923c', '#dc2626', '#84cc16', '#38bdf8',
  '#a855f7', '#22d3ee', '#e879f9', '#facc15',
];

// Empty default — no mock data
export const OFFICE_AGENTS: OfficeAgent[] = [];

// Cost estimation per 1M tokens by model (updated Feb 2026)
// Source: https://platform.claude.com/docs/en/about-claude/pricing
function estimateCost(model: string | undefined, inputTokens: number, outputTokens: number): number {
  if (!model || (inputTokens === 0 && outputTokens === 0)) return 0;
  const m = (model || '').toLowerCase();
  let inPer1M = 3;   // default $/1M input tokens (sonnet-tier)
  let outPer1M = 15;  // default $/1M output tokens

  // Claude Opus 4.6 / 4.5: $5 in / $25 out
  if (m.includes('opus') && (m.includes('4.6') || m.includes('4.5') || m.includes('4-6') || m.includes('4-5'))) {
    inPer1M = 5; outPer1M = 25;
  }
  // Claude Opus 4.1 / 4.0 / 3: $15 in / $75 out
  else if (m.includes('opus')) { inPer1M = 15; outPer1M = 75; }
  // Claude Sonnet (all versions): $3 in / $15 out
  else if (m.includes('sonnet')) { inPer1M = 3; outPer1M = 15; }
  // Claude Haiku 4.5: $1 in / $5 out
  else if (m.includes('haiku') && (m.includes('4.5') || m.includes('4-5'))) { inPer1M = 1; outPer1M = 5; }
  // Claude Haiku 3.5: $0.80 in / $4 out
  else if (m.includes('haiku') && (m.includes('3.5') || m.includes('3-5'))) { inPer1M = 0.80; outPer1M = 4; }
  // Claude Haiku 3: $0.25 in / $1.25 out
  else if (m.includes('haiku')) { inPer1M = 0.25; outPer1M = 1.25; }
  // Gemini Flash
  else if (m.includes('gemini') && m.includes('flash')) { inPer1M = 0.075; outPer1M = 0.3; }
  // Gemini Pro
  else if (m.includes('gemini') && m.includes('pro')) { inPer1M = 1.25; outPer1M = 5; }
  // GPT-4o
  else if (m.includes('gpt-4o') && !m.includes('mini')) { inPer1M = 2.5; outPer1M = 10; }
  // GPT-4o-mini
  else if (m.includes('gpt-4o-mini')) { inPer1M = 0.15; outPer1M = 0.6; }

  return (inputTokens * inPer1M + outputTokens * outPer1M) / 1_000_000;
}

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
    messagesProcessed: s.messageCount || 0,
    uptimeHours: 0,
    lastActive: s.lastActivity || 'unknown',
    recentActions: extractRecentActions(s),
    costToday: s.totalCost || estimateCost(s.model, s.totalInputTokens || 0, s.totalOutputTokens || 0),
    costWeek: 0,
    tokensUsed: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
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

export type WhiteboardMode = 'status' | 'activity' | 'metrics' | 'tasks' | 'history' | 'cron';

export const WHITEBOARD_MODES: { key: WhiteboardMode; icon: string; label: string }[] = [
  { key: 'status', icon: '👥', label: 'TEAM STATUS' },
  { key: 'activity', icon: '📡', label: 'ACTIVITY FEED' },
  { key: 'metrics', icon: '📊', label: 'METRICS' },
  { key: 'tasks', icon: '📋', label: 'TASK BOARD' },
  { key: 'history', icon: '⏳', label: 'STATUS HISTORY' },
  { key: 'cron', icon: '⏰', label: 'CRON JOBS' },
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
