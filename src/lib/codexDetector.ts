/**
 * Codex Agent Detector
 * Auto-detects OpenAI Codex sessions via the local bridge script (localhost:7779).
 * Mirrors the Claude Code bridge pattern — if the bridge is running, agents appear.
 */

import { OfficeAgent, AgentStatus } from './officeAgents';
import { ProviderType } from './connectionManager';
import { publishAgentToCircle, PROVIDER_DISPLAY } from './circleOffice';
import { supabase } from './supabase';

const BRIDGE_URL = 'http://localhost:7779';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CodexSession {
  sessionId: string;
  projectDir: string;
  model: string;
  status: 'active' | 'idle';
  task: string;             // Current research/task description
  lastActivity: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  messageCount: number;
  recentActions: string[];
  filesRead: number;
  filesWritten: number;
}

// Green tones to match OpenAI/Codex branding
const CODEX_COLORS = [
  '#10a37f', '#059669', '#34d399', '#0d9488', '#14b8a6',
  '#047857', '#065f46', '#0f766e', '#115e59', '#064e3b',
];

// ── Detection ────────────────────────────────────────────────────────────────

export async function detectCodexBridge(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    return data?.ok === true;
  } catch {
    return false;
  }
}

export async function fetchCodexSessions(): Promise<CodexSession[]> {
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

// ── Poller (mirrors ClaudeCodePoller pattern) ─────────────────────────────────

export class CodexPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private onUpdate: (sessions: CodexSession[]) => void;

  constructor(onUpdate: (sessions: CodexSession[]) => void) {
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
    const sessions = await fetchCodexSessions();
    this.onUpdate(sessions);
  }
}

// ── Convert sessions to OfficeAgent[] ────────────────────────────────────────

function inferStatus(s: CodexSession): AgentStatus {
  if (!s.lastActivity) return 'idle';
  const age = Date.now() - new Date(s.lastActivity).getTime();
  if (age < 30_000) return 'active';
  if (age < 3_600_000) return 'idle';
  return 'offline';
}

function inferActivity(s: CodexSession): string {
  if (s.task) return s.task;
  if (s.recentActions.length > 0) return s.recentActions[s.recentActions.length - 1];
  const dirName = s.projectDir.split('/').pop() || 'project';
  const status = inferStatus(s);
  if (status === 'active') return `Researching ${dirName}`;
  return 'Idle';
}

export function codexSessionsToAgents(sessions: CodexSession[]): OfficeAgent[] {
  return sessions.map((s, i) => ({
    id: `codex::${s.sessionId}`,
    name: 'Codex',
    role: 'Deep Research',
    status: inferStatus(s),
    color: CODEX_COLORS[i % CODEX_COLORS.length],
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
    model: s.model || 'codex',
    connectionId: 'codex-auto',
    connectionName: 'Codex (Local)',
    providerType: 'codex' as ProviderType,
  }));
}

// ── DB publishing ────────────────────────────────────────────────────────────

export const CODEX_AGENT_NAME = 'Codex';

export async function publishCodexAgent(
  circleId: string,
  sessionCount: number,
): Promise<{ agentId?: string; error?: string }> {
  const display = PROVIDER_DISPLAY['codex'];
  const result = await publishAgentToCircle({
    circleId,
    provider: 'codex',
    name: CODEX_AGENT_NAME,
    color: display?.color || '#10a37f',
    toolIcon: display?.icon || '🧠',
    gatewayUrl: BRIDGE_URL,
    isPublic: false,
  });

  if (result.error) {
    console.error('[codexDetector] Failed to publish agent:', result.error);
    return { error: result.error };
  }

  if (result.agent) {
    await supabase
      .from('circle_office_agents')
      .update({
        status: 'idle',
        current_task: sessionCount > 0
          ? `${sessionCount} session(s) — deep research`
          : 'Bridge connected',
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', result.agent.id);
  }

  return { agentId: result.agent?.id };
}

export async function updateCodexAgentStatus(
  circleId: string,
  sessions: CodexSession[],
): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const activeSessions = sessions.filter(s => s.status === 'active');
    const status = activeSessions.length > 0 ? 'building' : 'idle';
    const currentTask = activeSessions.length > 0
      ? activeSessions[0].task || `Researching ${activeSessions[0].projectDir.split('/').pop() || 'project'}`
      : sessions.length > 0
        ? `${sessions.length} session(s) idle`
        : 'Bridge connected — no active sessions';

    const totalTokens = sessions.reduce((sum, s) => sum + (s.totalInputTokens || 0) + (s.totalOutputTokens || 0), 0);
    const totalMessages = sessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);

    await supabase
      .from('circle_office_agents')
      .update({
        status,
        current_task: currentTask,
        token_usage_today: totalTokens,
        message_count_today: totalMessages,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id)
      .eq('name', CODEX_AGENT_NAME);
  } catch {}
}

export async function markCodexAgentOffline(circleId: string): Promise<void> {
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
      .eq('name', CODEX_AGENT_NAME);
  } catch {}
}
