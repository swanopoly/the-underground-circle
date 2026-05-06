/**
 * Codex Agent Detector
 * Auto-detects OpenAI Codex sessions via the local bridge script (localhost:7779).
 * Mirrors the Claude Code bridge pattern — if the bridge is running, agents appear.
 */

import { OfficeAgent, AgentStatus, deriveSessionStatus, clampToDbStatus } from './officeAgents';
import { ProviderType } from './connectionManager';
import { publishAgentToCircle, PROVIDER_DISPLAY } from './circleOffice';
import { supabase } from './supabase';
import { saveAgentSessionsToMemory, type AgentSessionForMemory } from './agentSessionMemory';

import { ensureBridgeToken, bridgeAuthHeaders } from './bridgeAuth';
import { getBridgeUrl } from './bridgeEnvironment';

const BRIDGE_PORT = 7779;

function getCodexBridgeUrl(): string | null {
  return getBridgeUrl(BRIDGE_PORT);
}

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

function codexTaskLabel(status: AgentStatus, session: CodexSession): string {
  const project = session.projectDir.split('/').pop() || 'project';
  if (status === 'active') return session.task ? `Active: ${session.task}` : `Researching ${project}`;
  if (status === 'building') return session.task ? `Building: ${session.task}` : `Drafting ${project}`;
  if (status === 'idle') return `Open on ${project}`;
  return `Session ended on ${project}`;
}

// ── Detection ────────────────────────────────────────────────────────────────

export async function detectCodexBridge(): Promise<boolean> {
  const bridgeUrl = getCodexBridgeUrl();
  if (!bridgeUrl) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    // Check sessions endpoint, not just health — only detect if actual sessions exist
    const token = await ensureBridgeToken();
    const res = await fetch(`${bridgeUrl}/sessions`, { signal: controller.signal, headers: bridgeAuthHeaders(token) });
    clearTimeout(timeout);
    if (!res.ok) return false;
    const data = await res.json();
    const sessions = data?.sessions || [];
    return sessions.length > 0; // Only "detected" when real sessions exist
  } catch {
    return false;
  }
}

export async function fetchCodexSessions(): Promise<CodexSession[]> {
  const bridgeUrl = getCodexBridgeUrl();
  if (!bridgeUrl) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const token = await ensureBridgeToken();
    const res = await fetch(`${bridgeUrl}/sessions`, { signal: controller.signal, headers: bridgeAuthHeaders(token) });
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
  // Trust bridge-reported status first
  if (s.status === 'active') return 'active';
  if (s.status === 'idle') return 'idle';
  if (!s.lastActivity) return 'idle';
  const age = Date.now() - new Date(s.lastActivity).getTime();
  if (age < 120_000) return 'active';
  return 'idle'; // Never go offline from client — let sweeper handle it
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
  return sessions.map((s, i) => {
    // Give each session a unique name when multiple exist
    const name = sessions.length > 1
      ? `Codex #${i + 1}`
      : 'Codex';

    // Estimate tokens from Codex's typical usage if bridge reports 0
    // Codex uses ~50K input + ~5K output per task on average
    const inputTokens = s.totalInputTokens || (s.status === 'active' ? 50000 : 0);
    const outputTokens = s.totalOutputTokens || (s.status === 'active' ? 5000 : 0);
    const msgCount = s.messageCount || (s.status === 'active' ? 1 : 0);

    // Codex pricing: $0.50/M input, $2.00/M output (Codex-mini default)
    const costEstimate = (inputTokens * 0.5 + outputTokens * 2.0) / 1_000_000;

    return {
      id: `codex::${s.sessionId}`,
      name,
      role: 'Deep Research',
      status: inferStatus(s),
      color: CODEX_COLORS[i % CODEX_COLORS.length],
      deskIndex: i,
      activity: inferActivity(s),
      messagesProcessed: msgCount,
      uptimeHours: 0,
      uptime: '',
      lastActive: s.lastActivity || '',
      recentActions: s.recentActions || [],
      recentMessages: [],
      costToday: costEstimate,
      costTotal: costEstimate,
      costWeek: 0,
      tokensUsed: inputTokens + outputTokens,
      inputTokens,
      outputTokens,
      cachedTokens: 0,
      newTokens: inputTokens,
      turns: msgCount,
      sessionKey: s.sessionId,
      model: s.model || 'codex',
      connectionId: 'codex-auto',
      connectionName: 'Codex (Local)',
      providerType: 'codex' as ProviderType,
    };
  });
}

// ── DB publishing ────────────────────────────────────────────────────────────

export const CODEX_AGENT_NAME = 'Codex';

export async function publishCodexAgent(
  circleId: string,
  sessionCount: number,
  sessions?: CodexSession[],
): Promise<{ agentId?: string; error?: string }> {
  const display = PROVIDER_DISPLAY['codex'];

  // Multiple sessions — publish each with unique name
  if (sessions && sessions.length > 1) {
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const name = `Codex #${i + 1}`;
      const status = deriveSessionStatus({ lastActivityIso: session.lastActivity });
      await publishAgentToCircle({
        circleId, provider: 'codex', name,
        color: CODEX_COLORS[i % CODEX_COLORS.length],
        toolIcon: display?.icon || '🧠',
        gatewayUrl: getCodexBridgeUrl() || 'http://localhost:7779', isPublic: false,
      });
      await supabase.from('circle_office_agents')
        .update({
          status: clampToDbStatus(status),
          current_task: codexTaskLabel(status, session),
          last_active_at: session.lastActivity || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('circle_id', circleId).eq('name', name);
    }
    return {};
  }

  // Single session — use standard name
  const result = await publishAgentToCircle({
    circleId, provider: 'codex',
    name: CODEX_AGENT_NAME,
    color: display?.color || '#10a37f',
    toolIcon: display?.icon || '🧠',
    gatewayUrl: getCodexBridgeUrl() || 'http://localhost:7779', isPublic: false,
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

    if (sessions.length > 1) {
      // Multiple sessions — update each named agent
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const name = `Codex #${i + 1}`;
        const status = deriveSessionStatus({ lastActivityIso: session.lastActivity });
        await supabase.from('circle_office_agents')
          .update({
            status: clampToDbStatus(status),
            current_task: codexTaskLabel(status, session),
            last_active_at: session.lastActivity || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('circle_id', circleId)
          .eq('owner_id', auth.user.id)
          .eq('name', name);
      }
      return;
    }

    // Single session — pick most recent and derive status from its mtime
    const newest = [...sessions].sort((a, b) => {
      const at = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bt = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bt - at;
    })[0];
    const status: AgentStatus = newest
      ? deriveSessionStatus({ lastActivityIso: newest.lastActivity })
      : 'idle';
    const currentTask = newest
      ? codexTaskLabel(status, newest)
      : 'Bridge connected';

    await supabase
      .from('circle_office_agents')
      .update({
        status: clampToDbStatus(status),
        current_task: currentTask,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', auth.user.id)
      .eq('name', CODEX_AGENT_NAME);
  } catch {}
}

// ── Session Memory Persistence ──────────────────────────────────────────────

export async function saveCodexSessionsToMemory(
  circleId: string,
  userId: string,
  sessions: CodexSession[],
): Promise<{ saved: number; skipped: number }> {
  const mapped: AgentSessionForMemory[] = sessions.map(s => ({
    sessionId: s.sessionId,
    projectDir: s.projectDir,
    model: s.model,
    status: s.status,
    task: s.task,
    lastActivity: s.lastActivity,
    messageCount: s.messageCount,
    totalInputTokens: s.totalInputTokens,
    totalOutputTokens: s.totalOutputTokens,
    recentActions: s.recentActions,
  }));
  return saveAgentSessionsToMemory('codex', circleId, userId, mapped);
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
