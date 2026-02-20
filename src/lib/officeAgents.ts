// Office Agent Types — real data comes from OpenClaw sessions
import { OpenClawSession } from './openclawService';

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

// Convert OpenClaw sessions to OfficeAgents
export function sessionsToAgents(sessions: OpenClawSession[]): OfficeAgent[] {
  return sessions.map((s, i) => ({
    id: s.sessionKey,
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
    costToday: 0,   // updated via session_status calls
    costWeek: 0,
    tokensUsed: 0,
    model: s.model || 'unknown',
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

export type WhiteboardMode = 'status' | 'activity' | 'metrics' | 'tasks';

export const WHITEBOARD_MODES: { key: WhiteboardMode; icon: string; label: string }[] = [
  { key: 'status', icon: '👥', label: 'TEAM STATUS' },
  { key: 'activity', icon: '📡', label: 'ACTIVITY FEED' },
  { key: 'metrics', icon: '📊', label: 'METRICS' },
  { key: 'tasks', icon: '📋', label: 'TASK BOARD' },
];
