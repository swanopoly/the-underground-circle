/**
 * Cursor AI Detector
 * Auto-detects Cursor agent sessions via the local bridge script (localhost:7781).
 * Reads agent transcripts from ~/.cursor/projects/ to track what Cursor is doing.
 *
 * The Cursor bridge (scripts/cursor-bridge.js) scans:
 *   ~/.cursor/projects/{project}/agent-transcripts/*.jsonl
 *   ~/.cursor/projects/{project}/terminals/*.txt
 */

import { OfficeAgent, AgentStatus } from './officeAgents';
import { ProviderType } from './connectionManager';
import { publishAgentToCircle, PROVIDER_DISPLAY } from './circleOffice';
import { supabase } from './supabase';

const BRIDGE_URL = 'http://localhost:7781';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CursorSession {
  sessionId: string;
  projectDir: string;
  projectHash: string;
  model: string;
  status: 'active' | 'idle';
  kind: string;
  task: string;
  lastActivity: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  messageCount: number;
  userMessages: number;
  assistantMessages: number;
  recentActions: string[];
}

// Purple tones to match Cursor branding
const CURSOR_COLORS = [
  '#8b5cf6', '#7c3aed', '#6d28d9', '#a78bfa', '#c4b5fd',
  '#5b21b6', '#4c1d95', '#9333ea', '#7e22ce', '#6b21a8',
];

// ── Detection ────────────────────────────────────────────────────────────────

export async function detectCursorBridge(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${BRIDGE_URL}/sessions`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    const sessions = data?.sessions || [];
    return sessions.length > 0;
  } catch {
    return false;
  }
}

export async function fetchCursorSessions(): Promise<CursorSession[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${BRIDGE_URL}/sessions`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json();
    return data?.sessions ?? [];
  } catch {
    return [];
  }
}

// ── Poller ────────────────────────────────────────────────────────────────────

export class CursorPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private onUpdate: (sessions: CursorSession[]) => void;

  constructor(onUpdate: (sessions: CursorSession[]) => void) {
    this.onUpdate = onUpdate;
  }

  start(intervalMs = 10000) {
    this.poll();
    this.interval = setInterval(() => this.poll(), intervalMs);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async poll() {
    const sessions = await fetchCursorSessions();
    this.onUpdate(sessions);
  }
}

// ── Convert sessions to OfficeAgent[] ────────────────────────────────────────

function inferStatus(s: CursorSession): AgentStatus {
  if (!s.lastActivity) return 'idle';
  const age = Date.now() - new Date(s.lastActivity).getTime();
  if (age < 300_000) return 'active';    // 5 min — Cursor sessions persist longer
  if (age < 86_400_000) return 'idle';   // 24h
  return 'offline';
}

function inferActivity(s: CursorSession): string {
  if (s.task && s.task !== 'Cursor agent session') return s.task;
  if (s.recentActions.length > 0) return s.recentActions.join(', ');
  const dirName = s.projectDir?.split('/').pop() || 'project';
  return inferStatus(s) === 'active' ? `Working in ${dirName}` : 'Idle';
}

export function cursorSessionsToAgents(sessions: CursorSession[]): OfficeAgent[] {
  return sessions.map((s, i) => ({
    id: `cursor::${s.sessionId}`,
    name: 'Cursor',
    role: 'AI Code Editor',
    status: inferStatus(s),
    color: CURSOR_COLORS[i % CURSOR_COLORS.length],
    deskIndex: i,
    activity: inferActivity(s),
    messagesProcessed: s.messageCount || 0,
    uptimeHours: 0,
    uptime: '',
    lastActive: s.lastActivity || '',
    recentActions: s.recentActions || [],
    recentMessages: [],
    costToday: 0,
    costWeek: 0,
    tokensUsed: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
    inputTokens: s.totalInputTokens || 0,
    outputTokens: s.totalOutputTokens || 0,
    cachedTokens: 0,
    newTokens: s.totalInputTokens || 0,
    turns: s.messageCount || 0,
    sessionKey: s.sessionId,
    model: s.model || 'cursor',
    connectionId: 'cursor-auto',
    connectionName: 'Cursor (Local)',
    providerType: 'cursor' as ProviderType,
  }));
}

// ── DB publishing ────────────────────────────────────────────────────────────

export const CURSOR_AGENT_NAME = 'Cursor';

export async function publishCursorAgent(
  circleId: string,
  sessionCount: number,
): Promise<{ agentId?: string; error?: string }> {
  const display = PROVIDER_DISPLAY['cursor'] || { color: '#8b5cf6', icon: '🎯' };
  const result = await publishAgentToCircle({
    circleId,
    provider: 'cursor',
    name: CURSOR_AGENT_NAME,
    color: display.color || '#8b5cf6',
    toolIcon: display.icon || '🎯',
    gatewayUrl: BRIDGE_URL,
    isPublic: false,
  });

  if (result.error) {
    console.error('[cursorDetector] Failed to publish agent:', result.error);
    return { error: result.error };
  }

  if (result.agent) {
    await supabase
      .from('circle_office_agents')
      .update({
        status: sessionCount > 0 ? 'building' : 'idle',
        current_task: sessionCount > 0
          ? `${sessionCount} agent session${sessionCount > 1 ? 's' : ''} active`
          : 'Bridge connected',
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', result.agent.id);
  }

  return { agentId: result.agent?.id };
}

export async function updateCursorAgentStatus(
  circleId: string,
  sessions: CursorSession[],
): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const activeSessions = sessions.filter(s => inferStatus(s) === 'active');
    const status = activeSessions.length > 0 ? 'building' : 'idle';
    const currentTask = activeSessions.length > 0
      ? activeSessions[0].task || `Working in ${activeSessions[0].projectDir?.split('/').pop() || 'project'}`
      : sessions.length > 0
        ? `${sessions.length} session${sessions.length > 1 ? 's' : ''} — ${sessions[0].task || 'idle'}`
        : 'Bridge connected — no active sessions';

    // Token syncing is centralized in OfficeTab's 30s sync loop via syncAgentTokenSnapshot()
    await supabase
      .from('circle_office_agents')
      .update({
        status,
        current_task: currentTask,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id)
      .eq('name', CURSOR_AGENT_NAME);
  } catch {}
}

export async function markCursorAgentOffline(circleId: string): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    await supabase
      .from('circle_office_agents')
      .update({
        status: 'offline',
        current_task: 'Bridge disconnected',
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id)
      .eq('name', CURSOR_AGENT_NAME);
  } catch {}
}
