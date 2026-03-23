/**
 * Gemini CLI Bridge Detector
 * Auto-detects Gemini CLI sessions via the local bridge script (localhost:7780).
 * Mirrors the Claude Code / Codex bridge pattern — if the bridge is running, agents appear.
 *
 * The Gemini CLI bridge exposes:
 *   GET  /health    → { ok: true, agent: 'gemini-cli' }
 *   GET  /sessions  → { sessions: GeminiCliSession[] }
 *   POST /send      → send a message to a session
 */

import { OfficeAgent, AgentStatus } from './officeAgents';
import { ProviderType } from './connectionManager';
import { publishAgentToCircle, PROVIDER_DISPLAY } from './circleOffice';
import { supabase } from './supabase';

const BRIDGE_URL = 'http://localhost:7780';

// ── Types ────────────────────────────────────────────────────────────────────

export interface GeminiCliSession {
  sessionId: string;
  projectDir: string;
  model: string;
  status: 'active' | 'idle';
  task: string;
  lastActivity: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  messageCount: number;
  recentActions: string[];
  thinkingEnabled: boolean;
}

// Blue tones to match Google/Gemini branding
const GEMINI_COLORS = [
  '#4285f4', '#1a73e8', '#5e97f6', '#1967d2', '#669df6',
  '#174ea6', '#185abc', '#4484f3', '#1b66c9', '#3c78d8',
];

// ── Detection ────────────────────────────────────────────────────────────────

export async function detectGeminiCliBridge(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    // Check sessions endpoint — only detect if actual sessions exist
    const res = await fetch(`${BRIDGE_URL}/sessions`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    const sessions = data?.sessions || [];
    return sessions.length > 0; // Only "detected" when real sessions exist
  } catch {
    return false;
  }
}

export async function fetchGeminiCliSessions(): Promise<GeminiCliSession[]> {
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

// ── Poller (mirrors ClaudeCodePoller pattern) ────────────────────────────────

export class GeminiCliPoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private onUpdate: (sessions: GeminiCliSession[]) => void;

  constructor(onUpdate: (sessions: GeminiCliSession[]) => void) {
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
    const sessions = await fetchGeminiCliSessions();
    this.onUpdate(sessions);
  }
}

// ── Execute command via bridge ───────────────────────────────────────────────

export async function execGeminiCliCommand(
  command: string,
  sessionId?: string,
): Promise<{ ok: boolean; response?: string; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    const res = await fetch(`${BRIDGE_URL}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, sessionId }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return await res.json();
  } catch (e: any) {
    if (e.name === 'AbortError') return { ok: false, error: 'Command timed out' };
    return { ok: false, error: e.message || 'Bridge not reachable' };
  }
}

// ── Convert bridge sessions to OfficeAgent[] ─────────────────────────────────

function inferStatus(s: GeminiCliSession): AgentStatus {
  if (!s.lastActivity) return 'idle';
  const age = Date.now() - new Date(s.lastActivity).getTime();
  if (age < 30_000) return 'active';
  if (age < 3_600_000) return 'idle';
  return 'offline';
}

function inferActivity(s: GeminiCliSession): string {
  if (s.task) return s.task;
  if (s.recentActions.length > 0) return s.recentActions[s.recentActions.length - 1];
  const dirName = s.projectDir.split('/').pop() || 'project';
  const status = inferStatus(s);
  if (status === 'active') return `Working on ${dirName}`;
  return 'Idle';
}

export function geminiSessionsToAgents(sessions: GeminiCliSession[]): OfficeAgent[] {
  return sessions.map((s, i) => ({
    id: `gemini::${s.sessionId}`,
    name: 'Gemini',
    role: 'Gemini CLI',
    status: inferStatus(s),
    color: GEMINI_COLORS[i % GEMINI_COLORS.length],
    deskIndex: i,
    activity: inferActivity(s),
    messagesProcessed: s.messageCount || 0,
    uptimeHours: 0,
    uptime: '',
    lastActive: s.lastActivity || '',
    recentActions: s.recentActions || [],
    recentMessages: [],
    costToday: 0, // Gemini CLI is free-tier or API-key based
    costWeek: 0,
    tokensUsed: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
    inputTokens: s.totalInputTokens || 0,
    outputTokens: s.totalOutputTokens || 0,
    cachedTokens: 0,
    newTokens: s.totalInputTokens || 0,
    turns: s.messageCount || 0,
    sessionKey: s.sessionId,
    model: s.model || 'gemini-2.5-pro',
    connectionId: 'gemini-cli-auto',
    connectionName: 'Gemini CLI (Local)',
    providerType: 'gemini' as ProviderType,
  }));
}

// ── DB publishing ────────────────────────────────────────────────────────────

export const GEMINI_CLI_AGENT_NAME = 'Gemini CLI';

export async function publishGeminiCliAgent(
  circleId: string,
  sessionCount: number,
): Promise<{ agentId?: string; error?: string }> {
  const display = PROVIDER_DISPLAY['gemini'];
  const result = await publishAgentToCircle({
    circleId,
    provider: 'gemini',
    name: GEMINI_CLI_AGENT_NAME,
    color: display?.color || '#4285f4',
    toolIcon: display?.icon || '♊',
    gatewayUrl: BRIDGE_URL,
    isPublic: false,
  });

  if (result.error) {
    console.error('[geminiCliDetector] Failed to publish agent:', result.error);
    return { error: result.error };
  }

  if (result.agent) {
    await supabase
      .from('circle_office_agents')
      .update({
        status: 'idle',
        current_task: sessionCount > 0
          ? `${sessionCount} session(s) active`
          : 'Bridge connected',
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', result.agent.id);
  }

  return { agentId: result.agent?.id };
}

export async function updateGeminiCliAgentStatus(
  circleId: string,
  sessions: GeminiCliSession[],
): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const activeSessions = sessions.filter(s => s.status === 'active');
    const status = activeSessions.length > 0 ? 'building' : 'idle';
    const currentTask = activeSessions.length > 0
      ? activeSessions[0].task || `Working on ${activeSessions[0].projectDir.split('/').pop() || 'project'}`
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
      .eq('name', GEMINI_CLI_AGENT_NAME);
  } catch {}
}

export async function markGeminiCliAgentOffline(circleId: string): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    await supabase
      .from('circle_office_agents')
      .update({
        status: 'idle',
        current_task: 'Session ended — idling',
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id)
      .eq('name', GEMINI_CLI_AGENT_NAME);
  } catch {}
}
