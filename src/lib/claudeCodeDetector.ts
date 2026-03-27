/**
 * Claude Code Bridge Detector
 * Auto-detects Claude Code sessions via the local bridge script (localhost:7778).
 * No manual configuration needed — if the bridge is running, agents appear.
 */

import { OfficeAgent, AgentStatus } from './officeAgents';
import { ProviderType } from './connectionManager';
import { estimateCostWithCache } from './modelPricing';
import { publishAgentToCircle, PROVIDER_DISPLAY } from './circleOffice';
import { supabase } from './supabase';

const BRIDGE_URL = 'http://localhost:7778';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClaudeCodeSession {
  sessionId: string;
  projectDir: string;
  projectHash: string;
  model: string;
  status: 'active' | 'idle';
  kind: 'main' | 'subagent';
  parentSessionId: string | null;
  slug: string;
  lastActivity: string;
  version: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  cachedTokens: number;
  newTokens: number;
  messageCount: number;
  recentActions: string[];
  subagentCount: number;
}

// Colors for auto-detected agents (amber/gold tones to match Claude Code branding)
const CC_COLORS = [
  '#f59e0b', '#fb923c', '#fbbf24', '#f97316', '#eab308',
  '#d97706', '#b45309', '#ca8a04', '#a16207', '#92400e',
];

// ── Detection ────────────────────────────────────────────────────────────────

export async function detectClaudeCodeBridge(): Promise<boolean> {
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

export async function fetchClaudeCodeSessions(): Promise<ClaudeCodeSession[]> {
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

// ── Poller (mirrors OpenClawPoller pattern) ──────────────────────────────────

export class ClaudeCodePoller {
  private interval: ReturnType<typeof setInterval> | null = null;
  private onUpdate: (sessions: ClaudeCodeSession[]) => void;

  constructor(onUpdate: (sessions: ClaudeCodeSession[]) => void) {
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
    const sessions = await fetchClaudeCodeSessions();
    this.onUpdate(sessions);
  }
}

// ── Execute shell command via bridge ─────────────────────────────────────────

export async function execBridgeCommand(
  command: string,
): Promise<{ ok: boolean; stdout?: string; stderr?: string; code?: number; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    const res = await fetch(`${BRIDGE_URL}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
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

function inferBridgeStatus(s: ClaudeCodeSession): AgentStatus {
  if (!s.lastActivity) return 'idle';
  const age = Date.now() - new Date(s.lastActivity).getTime();
  if (age < 30_000) return 'active';
  if (age < 3_600_000) return 'idle';   // Stay idle for up to 1 hour
  return 'offline';
}

function inferBridgeActivity(s: ClaudeCodeSession): string {
  if (s.recentActions.length > 0) {
    return `Using ${s.recentActions[s.recentActions.length - 1]}`;
  }
  if (s.kind === 'subagent') return 'Background task';
  const dirName = s.projectDir.split('/').pop() || s.projectHash;
  const status = inferBridgeStatus(s);
  if (status === 'active') return `Working on ${dirName}`;
  return 'Idle';
}

function friendlyName(s: ClaudeCodeSession): string {
  if (s.slug) {
    // Convert slug like "sequential-whistling-taco" to "Whistling Taco"
    const parts = s.slug.split('-');
    if (parts.length >= 2) {
      return parts.slice(-2).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    return s.slug;
  }
  // Fall back to project dir name
  const dirName = s.projectDir.split('/').pop() || '';
  if (dirName) return dirName;
  return s.sessionId.slice(0, 8);
}

export function bridgeSessionsToAgents(sessions: ClaudeCodeSession[]): OfficeAgent[] {
  return sessions.map((s, i) => ({
    id: `cc::${s.sessionId}`,
    name: friendlyName(s),
    role: s.kind === 'main' ? 'Claude Code' : 'Sub-Agent',
    status: inferBridgeStatus(s),
    color: CC_COLORS[i % CC_COLORS.length],
    deskIndex: i,
    activity: inferBridgeActivity(s),
    messagesProcessed: s.messageCount || 0,
    uptimeHours: 0,
    uptime: '',
    lastActive: s.lastActivity || '',
    recentActions: s.recentActions || [],
    recentMessages: [],
    costToday: estimateCostWithCache(
      s.model,
      s.cachedTokens || 0,
      s.newTokens || 0,
      s.totalOutputTokens || 0,
    ),
    costTotal: 0, // populated from DB via enrichment
    costWeek: 0,
    tokensUsed: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
    inputTokens: s.totalInputTokens || 0,
    outputTokens: s.totalOutputTokens || 0,
    cachedTokens: s.cachedTokens || 0,
    newTokens: s.newTokens || 0,
    turns: s.messageCount || 0,
    sessionKey: s.sessionId,
    model: s.model || 'unknown',
    connectionId: 'claude-code-auto',
    connectionName: 'Claude Code (Local)',
    providerType: 'claude-code' as ProviderType,
  }));
}

// ── DB publishing: Auto-publish Claude Code agent to circle_office_agents ────

export const CLAUDE_CODE_AGENT_NAME = 'Claude Code';
const CLAUDE_CODE_BRIDGE_URL = 'http://localhost:7778';

/**
 * Publish a single "Claude Code" agent to circle_office_agents.
 * Upsert on (circle_id, owner_id, name) — safe to call multiple times.
 */
export async function publishClaudeCodeAgent(
  circleId: string,
  sessionCount: number,
): Promise<{ agentId?: string; error?: string }> {
  const display = PROVIDER_DISPLAY['claude-code'];
  const result = await publishAgentToCircle({
    circleId,
    provider: 'claude-code',
    name: CLAUDE_CODE_AGENT_NAME,
    color: display?.color || '#6366f1',
    toolIcon: display?.icon || '💻',
    gatewayUrl: CLAUDE_CODE_BRIDGE_URL,
    isPublic: false,
  });

  if (result.error) {
    console.error('[claudeCodeDetector] Failed to publish agent:', result.error);
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

/**
 * Update the Claude Code agent's live status based on session data.
 */
export async function updateClaudeCodeAgentStatus(
  circleId: string,
  sessions: ClaudeCodeSession[],
): Promise<void> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;

    const activeSessions = sessions.filter(s => s.status === 'active');
    const status = activeSessions.length > 0
      ? 'building'
      : 'idle';    // Always idle, never immediately offline
    const currentTask = activeSessions.length > 0
      ? `Working on ${activeSessions[0].projectDir.split('/').pop() || 'project'}`
      : sessions.length > 0
        ? `${sessions.length} session(s) idle`
        : 'Session ended — idling';

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
      .eq('name', CLAUDE_CODE_AGENT_NAME);
  } catch (err) {
    console.warn('[claudeCodeDetector] Failed to update agent status:', err);
  }
}

/**
 * Mark the Claude Code agent as idle (not offline) when bridge disconnects.
 * The agent stays visible for 1 hour before transitioning to offline.
 */
export async function markClaudeCodeAgentIdle(circleId: string): Promise<void> {
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
      .eq('name', CLAUDE_CODE_AGENT_NAME);
  } catch (err) {
    console.warn('[claudeCodeDetector] Failed to mark agent idle:', err);
  }
}

// Keep the old name as an alias for backward compat
export const markClaudeCodeAgentOffline = markClaudeCodeAgentIdle;
