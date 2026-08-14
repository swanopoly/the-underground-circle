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
import {
  publishAgentToCircle,
  PROVIDER_DISPLAY,
  type CircleOfficeAuthScope,
} from './circleOffice';
import { getSupabaseClientForAccessToken, supabase } from './supabase';
import { saveAgentSessionsToMemory, type AgentSessionForMemory } from './agentSessionMemory';
import { isBenignAuthAbort } from './authSession';

import {
  bridgeAuthHeaders,
  cacheBridgeToken,
  ensureBridgeToken,
  fetchBridgeAuthenticated,
  requestBridgePairToken,
} from './bridgeAuth';
import { getBridgeUrl } from './bridgeEnvironment';

const BRIDGE_PORT = 7780;

function getGeminiBridgeUrl(): string | null {
  return getBridgeUrl(BRIDGE_PORT);
}

async function pairGeminiBridge(bridgeUrl: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    try {
      const paired = await requestBridgePairToken(`${bridgeUrl}/pair`, controller.signal);
      if (!paired.ok || !paired.token) return null;
      cacheBridgeToken(paired.token);
      return paired.token;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

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
  displayName?: string;
  prompt?: string;
  launchId?: string;
  launchedAt?: string;
  terminal?: string;
  terminalPid?: number;
  terminalTitle?: string;
  manageable?: boolean;
  launchError?: string;
}

// Blue tones to match Google/Gemini branding
const GEMINI_COLORS = [
  '#4285f4', '#1a73e8', '#5e97f6', '#1967d2', '#669df6',
  '#174ea6', '#185abc', '#4484f3', '#1b66c9', '#3c78d8',
];

// ── Detection ────────────────────────────────────────────────────────────────

export async function detectGeminiCliBridge(): Promise<boolean> {
  const bridgeUrl = getGeminiBridgeUrl();
  if (!bridgeUrl) return false;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    // Check sessions endpoint — only detect if actual sessions exist
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/sessions`, { signal: controller.signal });
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
  const bridgeUrl = getGeminiBridgeUrl();
  if (!bridgeUrl) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/sessions`, { signal: controller.signal });
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
  const bridgeUrl = getGeminiBridgeUrl();
  if (!bridgeUrl) return { ok: false, error: 'Bridge unavailable in this environment' };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 35000);
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/send`, {
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

function geminiDisplayName(session: GeminiCliSession, index: number, total: number): string {
  if (session.displayName?.trim()) return session.displayName.trim();
  return total > 1 ? `Gemini CLI #${index + 1}` : GEMINI_CLI_AGENT_NAME;
}

export function geminiSessionsToAgents(sessions: GeminiCliSession[]): OfficeAgent[] {
  return sessions.map((s, i) => ({
    id: `gemini::${s.sessionId}`,
    name: geminiDisplayName(s, i, sessions.length),
    role: 'Gemini CLI',
    status: inferStatus(s),
    color: GEMINI_COLORS[i % GEMINI_COLORS.length],
    deskIndex: i,
    activity: inferActivity(s),
    messagesProcessed: s.messageCount || 0,
    uptimeHours: 0,
    uptime: '',
    lastActive: s.lastActivity || '',
    recentActions: [
      ...(s.launchError ? [`Launch error: ${s.launchError}`] : []),
      ...(s.recentActions || []),
    ],
    recentMessages: [],
    costToday: 0, // Gemini CLI is free-tier or API-key based
    costTotal: 0,
    costWeek: 0,
    tokensUsed: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
    inputTokens: s.totalInputTokens || 0,
    outputTokens: s.totalOutputTokens || 0,
    cachedTokens: 0,
    newTokens: s.totalInputTokens || 0,
    turns: s.messageCount || 0,
    sessionKey: s.sessionId,
    model: s.model || 'gemini-3.6-flash',
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
  sessions?: GeminiCliSession[],
  capturedScope?: CircleOfficeAuthScope,
): Promise<{ agentId?: string; error?: string }> {
  const display = PROVIDER_DISPLAY['gemini'];
  const db = capturedScope
    ? getSupabaseClientForAccessToken(capturedScope.accessToken)
    : supabase;

  if (sessions && sessions.length > 1) {
    const ownerId = capturedScope?.userId
      || (await supabase.auth.getUser()).data.user?.id;
    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i];
      const name = geminiDisplayName(session, i, sessions.length);
      await publishAgentToCircle({
        circleId,
        provider: 'gemini',
        name,
        color: GEMINI_COLORS[i % GEMINI_COLORS.length],
        toolIcon: display?.icon || '♊',
        gatewayUrl: getGeminiBridgeUrl() || 'http://localhost:7780',
        isPublic: false,
      }, capturedScope);
      let update = db.from('circle_office_agents')
        .update({
          status: session.status === 'active' ? 'building' : 'idle',
          current_task: session.task || 'Gemini CLI terminal session',
          last_active_at: session.lastActivity || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('circle_id', circleId)
        .eq('name', name);
      if (ownerId) update = update.eq('owner_id', ownerId);
      if (capturedScope) {
        update = update.setHeader('Authorization', `Bearer ${capturedScope.accessToken}`);
      }
      await update;
    }
    return {};
  }

  const result = await publishAgentToCircle({
    circleId,
    provider: 'gemini',
    name: GEMINI_CLI_AGENT_NAME,
    color: display?.color || '#4285f4',
    toolIcon: display?.icon || '♊',
    gatewayUrl: getGeminiBridgeUrl() || 'http://localhost:7780',
    isPublic: false,
  }, capturedScope);

  if (result.error) {
    if (!isBenignAuthAbort(result.error)) {
      console.error('[geminiCliDetector] Failed to publish agent:', result.error);
    }
    return { error: result.error };
  }

  if (result.agent) {
    let update = db
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
    if (capturedScope) {
      update = update.setHeader('Authorization', `Bearer ${capturedScope.accessToken}`);
    }
    await update;
  }

  return { agentId: result.agent?.id };
}

export async function updateGeminiCliAgentStatus(
  circleId: string,
  sessions: GeminiCliSession[],
  capturedScope?: CircleOfficeAuthScope,
): Promise<void> {
  try {
    const db = capturedScope
      ? getSupabaseClientForAccessToken(capturedScope.accessToken)
      : supabase;
    const ownerId = capturedScope?.userId
      || (await supabase.auth.getUser()).data.user?.id;
    if (!ownerId) return;

    if (sessions.length > 1) {
      for (let i = 0; i < sessions.length; i++) {
        const session = sessions[i];
        const name = geminiDisplayName(session, i, sessions.length);
        let update = db.from('circle_office_agents')
          .update({
            status: session.status === 'active' ? 'building' : 'idle',
            current_task: session.task || 'Gemini CLI terminal session',
            last_active_at: session.lastActivity || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('circle_id', circleId)
          .eq('owner_id', ownerId)
          .eq('name', name);
        if (capturedScope) {
          update = update.setHeader('Authorization', `Bearer ${capturedScope.accessToken}`);
        }
        await update;
      }
      return;
    }

    const activeSessions = sessions.filter(s => s.status === 'active');
    const status = activeSessions.length > 0 ? 'building' : 'idle';
    const currentTask = activeSessions.length > 0
      ? activeSessions[0].task || `Working on ${activeSessions[0].projectDir.split('/').pop() || 'project'}`
      : sessions.length > 0
        ? `${sessions.length} session(s) idle`
        : 'Bridge connected — no active sessions';

    // Token syncing is centralized in OfficeTab's 30s sync loop via syncAgentTokenSnapshot()
    let update = db
      .from('circle_office_agents')
      .update({
        status,
        current_task: currentTask,
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('circle_id', circleId)
      .eq('owner_id', ownerId)
      .eq('name', GEMINI_CLI_AGENT_NAME);
    if (capturedScope) {
      update = update.setHeader('Authorization', `Bearer ${capturedScope.accessToken}`);
    }
    await update;
  } catch {}
}

// ── Launch local Gemini CLI terminal sessions ───────────────────────────────

export interface GeminiCliLaunchRequest {
  count: number;
  prompts?: string[];
  prompt?: string;
  names?: string[];
  cwd?: string;
  projectDir?: string;
  model?: string;
  yolo?: boolean;
  /** Launch each session in its own git worktree (fail-open to the shared cwd). */
  useWorktree?: boolean;
  circleId?: string;
  userId?: string;
}

export interface GeminiCliLaunchResult {
  ok: boolean;
  transportAccepted: boolean | null;
  launchId?: string;
  sessions: GeminiCliSession[];
  launched: number;
  failed: Array<{ sessionId?: string; displayName?: string; error: string }>;
  projectDir?: string;
  error?: string;
}

export async function launchGeminiCliSessions(input: GeminiCliLaunchRequest): Promise<GeminiCliLaunchResult> {
  const bridgeUrl = getGeminiBridgeUrl();
  if (!bridgeUrl) {
    return {
      ok: false,
      transportAccepted: false,
      sessions: [],
      launched: 0,
      failed: [{ error: 'Gemini CLI bridge URL is unavailable in this runtime.' }],
      error: 'Gemini CLI bridge URL is unavailable in this runtime.',
    };
  }

  try {
    const body = JSON.stringify({
      count: input.count,
      prompts: input.prompts,
      prompt: input.prompt,
      names: input.names,
      cwd: input.cwd,
      projectDir: input.projectDir,
      model: input.model,
      yolo: input.yolo,
      useWorktree: input.useWorktree,
    });
    const postLaunch = async (token: string | null) => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60_000);
      try {
        return await fetchBridgeAuthenticated(`${bridgeUrl}/launch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...bridgeAuthHeaders(token) },
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    let token = await ensureBridgeToken();
    let res = await postLaunch(token);
    if (res.status === 401) {
      token = await pairGeminiBridge(bridgeUrl);
      if (token) res = await postLaunch(token);
    }

    const data = await res.json().catch(() => null) as Partial<GeminiCliLaunchResult> | null;
    if (!res.ok || !data) {
      const error = data?.error || `Gemini CLI bridge launch failed with HTTP ${res.status}`;
      const transportAccepted = res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 409
        ? false
        : null;
      return { ok: false, transportAccepted, sessions: [], launched: 0, failed: [{ error }], error };
    }

    const sessions = Array.isArray(data.sessions) ? data.sessions : [];
    const launched = typeof data.launched === 'number' ? data.launched : sessions.length;
    const accepted = data.ok === true || launched > 0;
    if (input.circleId && sessions.length > 0) {
      await publishGeminiCliAgent(input.circleId, sessions.length, sessions);
      await updateGeminiCliAgentStatus(input.circleId, sessions);
      const userId = input.userId || (await supabase.auth.getUser()).data.user?.id;
      if (userId) {
        void saveGeminiSessionsToMemory(input.circleId, userId, sessions).catch(() => {});
      }
    }

    return {
      ok: accepted,
      transportAccepted: accepted ? true : data.ok === false ? false : null,
      launchId: data.launchId,
      sessions,
      launched,
      failed: Array.isArray(data.failed) ? data.failed : [],
      projectDir: data.projectDir,
      error: data.error,
    };
  } catch (err) {
    const message = err instanceof Error && err.name === 'AbortError'
      ? 'Gemini CLI bridge launch timed out.'
      : err instanceof Error ? err.message : String(err);
    return { ok: false, transportAccepted: null, sessions: [], launched: 0, failed: [{ error: message }], error: message };
  }
}

// ── Session Memory Persistence ──────────────────────────────────────────────

export async function saveGeminiSessionsToMemory(
  circleId: string,
  userId: string,
  sessions: GeminiCliSession[],
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
  return saveAgentSessionsToMemory('gemini', circleId, userId, mapped);
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
