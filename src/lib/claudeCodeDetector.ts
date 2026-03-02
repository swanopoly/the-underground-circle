/**
 * Claude Code Bridge Detector
 * Auto-detects Claude Code sessions via the local bridge script (localhost:7778).
 * No manual configuration needed — if the bridge is running, agents appear.
 */

import { OfficeAgent, AgentStatus } from './officeAgents';
import { ProviderType } from './connectionManager';
import { estimateCostWithCache } from './modelPricing';

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
  if (!s.lastActivity) return 'offline';
  const age = Date.now() - new Date(s.lastActivity).getTime();
  if (age < 30_000) return 'active';
  if (age < 300_000) return 'idle';
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
