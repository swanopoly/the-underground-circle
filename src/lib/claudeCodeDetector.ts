/**
 * Claude Code Bridge Detector
 * Auto-detects Claude Code sessions via the local bridge script (localhost:7778).
 * No manual configuration needed — if the bridge is running, agents appear.
 */

import { OfficeAgent } from './officeAgents';
import { ProviderType } from './connectionManager';
import { estimateCostWithCache } from './modelPricing';
import { publishAgentToCircle, PROVIDER_DISPLAY } from './circleOffice';
import { supabase } from './supabase';
import { getCircleSessionMemoryMode } from './agentRunSystem';
import { promoteExternalAgentSessionKnowledge } from './memoryService';
import { deriveSessionStatus, clampToDbStatus, type AgentStatus } from './officeAgents';

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
  // Rich live context
  lastUserMessage?: string;
  lastAssistantText?: string;
  recentToolCalls?: Array<{ tool: string; file: string; ts: string }>;
  activeFiles?: string[];
  currentToolName?: string;
  currentToolFile?: string;
}

// Derive the strict office status for a Claude Code session. A subagent that
// is still firing tools also bumps the parent into 'active', so a session
// running a sub-task doesn't look idle.
function sessionToDerivedStatus(
  session: ClaudeCodeSession,
  subagents: ClaudeCodeSession[],
): AgentStatus {
  const subActive = subagents.some(s =>
    s.currentToolName ||
    (s.lastActivity && Date.now() - new Date(s.lastActivity).getTime() < 15_000)
  );
  if (subActive) return 'active';
  return deriveSessionStatus({
    lastActivityIso: session.lastActivity,
    currentToolName: session.currentToolName,
  });
}

function taskLabelForStatus(
  status: AgentStatus,
  project: string,
  session: ClaudeCodeSession,
  subagents: ClaudeCodeSession[],
): string {
  const sub = subagents.length > 0 ? ` (+${subagents.length} sub)` : '';
  if (status === 'active') {
    if (session.currentToolName) {
      const file = session.currentToolFile ? ` ${session.currentToolFile.split('/').pop()}` : '';
      return `Using ${session.currentToolName}${file}${sub}`;
    }
    return `Working on ${project}${sub}`;
  }
  // `building` used to produce "Building on <project>" — a transient
  // label that flashed and disappeared after every chat message as the
  // Claude Code bridge polled session state. Returning empty string
  // here suppresses the popup wherever `current_task` is rendered.
  if (status === 'building') return '';
  if (status === 'idle') return `Open on ${project}${sub}`;
  return `Session ended on ${project}`;
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

// ── Poller (mirrors OpenSwanPoller pattern) ──────────────────────────────────

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
  // Trust the bridge's reported status first — it knows if the session is alive
  if (s.status === 'active') return 'active';
  if (s.status === 'idle') return 'idle';
  // Fallback to activity-based inference only if bridge doesn't report status
  if (!s.lastActivity) return 'idle';
  const age = Date.now() - new Date(s.lastActivity).getTime();
  if (age < 120_000) return 'active';    // 2 min window (was 30s — too aggressive)
  if (age < 86_400_000) return 'idle';   // Stay idle for up to 24 hours (was 1h)
  return 'idle';                          // Never go offline from here — let sweeper handle it
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
    // Live work context
    lastUserMessage: s.lastUserMessage || '',
    lastAssistantText: s.lastAssistantText || '',
    recentToolCalls: s.recentToolCalls || [],
    activeFiles: s.activeFiles || [],
    currentToolName: s.currentToolName || '',
    currentToolFile: s.currentToolFile || '',
    projectDir: s.projectDir || '',
    subagentCount: s.subagentCount || 0,
    version: s.version || '',
    slug: s.slug || '',
  }));
}

// ── DB publishing: Auto-publish Claude Code agent to circle_office_agents ────

export const CLAUDE_CODE_AGENT_NAME = 'Claude Code';
const CLAUDE_CODE_BRIDGE_URL = 'http://localhost:7778';

/**
 * Publish pixel agents for all active Claude Code sessions.
 * Each main session gets its own persistent pixel agent via upsert on (circle_id, owner_id, name).
 * Subagents roll up into their parent session's agent.
 * When only one session exists, uses the name "Claude Code".
 * When multiple exist, uses the session's friendly name (e.g., "Whistling Taco").
 */
export async function publishClaudeCodeAgent(
  circleId: string,
  sessionCount: number,
  sessions?: ClaudeCodeSession[],
): Promise<{ agentId?: string; error?: string }> {
  const display = PROVIDER_DISPLAY['claude-code'];

  // If we have session details and multiple main sessions, publish each separately
  const mainSessions = sessions?.filter(s => s.kind === 'main' || !s.kind) || [];

  if (mainSessions.length > 1) {
    // Multiple sessions — each gets its own pixel agent
    for (let i = 0; i < mainSessions.length; i++) {
      const session = mainSessions[i];
      const name = friendlyName(session);
      const subagents = sessions?.filter(s => s.kind === 'subagent' && s.parentSessionId === session.sessionId) || [];
      const status = sessionToDerivedStatus(session, subagents);
      const project = session.projectDir.split('/').pop() || 'project';

      await publishAgentToCircle({
        circleId,
        provider: 'claude-code',
        name,
        color: CC_COLORS[i % CC_COLORS.length],
        toolIcon: display?.icon || '💻',
        gatewayUrl: CLAUDE_CODE_BRIDGE_URL,
        isPublic: false,
      });

      await supabase
        .from('circle_office_agents')
        .update({
          status: clampToDbStatus(status),
          current_task: taskLabelForStatus(status, project, session, subagents),
          last_active_at: session.lastActivity || new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('circle_id', circleId)
        .eq('name', name);
    }
    return { agentId: undefined };
  }

  // Single session or no session details — use the standard "Claude Code" name
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

    const mainSessions = sessions.filter(s => s.kind === 'main' || !s.kind);

    if (mainSessions.length > 1) {
      // Multiple sessions — update each session's named agent individually
      for (const session of mainSessions) {
        const name = friendlyName(session);
        const subagents = sessions.filter(s => s.kind === 'subagent' && s.parentSessionId === session.sessionId);
        const status = sessionToDerivedStatus(session, subagents);
        const project = session.projectDir.split('/').pop() || 'project';

        await supabase
          .from('circle_office_agents')
          .update({
            status: clampToDbStatus(status),
            current_task: taskLabelForStatus(status, project, session, subagents),
            last_active_at: session.lastActivity || new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq('circle_id', circleId)
          .eq('owner_id', auth.user.id)
          .eq('name', name);
      }
      return;
    }

    // Single session — update the standard "Claude Code" agent. Pick the
    // most-recent main session as the representative for status derivation.
    const subagentSessions = sessions.filter(s => s.kind === 'subagent');
    const newestMain = [...mainSessions].sort((a, b) => {
      const at = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bt = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bt - at;
    })[0];
    const status: AgentStatus = newestMain
      ? sessionToDerivedStatus(newestMain, subagentSessions.filter(s => s.parentSessionId === newestMain.sessionId))
      : 'idle';

    let currentTask: string;
    if (newestMain && status !== 'offline') {
      const project = newestMain.projectDir.split('/').pop() || 'project';
      currentTask = taskLabelForStatus(
        status,
        project,
        newestMain,
        subagentSessions.filter(s => s.parentSessionId === newestMain.sessionId),
      );
    } else if (sessions.length > 0) {
      const parts: string[] = [];
      if (mainSessions.length > 0) parts.push(`${mainSessions.length} main`);
      if (subagentSessions.length > 0) parts.push(`${subagentSessions.length} sub`);
      currentTask = `${parts.join(' + ')} session(s) quiet`;
    } else {
      currentTask = 'Session ended — idling';
    }

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

// ── Cross-Session Context & Memory Persistence ─────────────────────────────

export interface CrossSessionContext {
  sessionCount: number;
  sessions: Array<{
    sessionId: string;
    slug: string;
    projectDir: string;
    model: string;
    status: string;
    lastUserMessage: string;
    lastAssistantText: string;
    activeFiles: string[];
    recentToolCalls: Array<{ tool: string; file: string; ts: string }>;
    currentToolName: string;
    currentToolFile: string;
    messageCount: number;
    lastActivity: string;
  }>;
  summary: string;
  timestamp: string;
}

/**
 * Fetch aggregated context from ALL Claude Code sessions via the bridge /context endpoint.
 */
export async function fetchCrossSessionContext(): Promise<CrossSessionContext | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${BRIDGE_URL}/context`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Track what we've already saved to avoid duplicate memory writes
const _savedContextHashes = new Map<string, string>(); // bucketId -> hash of last saved context

function contextHash(s: { lastUserMessage: string; lastAssistantText: string; messageCount: number }): string {
  return `${s.messageCount}:${s.lastUserMessage.slice(0, 50)}:${s.lastAssistantText.slice(0, 50)}`;
}

function normalizeProjectKey(projectDir: string): string {
  const project = projectDir.split('/').filter(Boolean).pop() || 'project';
  return project.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

/**
 * Save Claude Code session context to the app's memory system.
 * Called periodically by the poller — only writes when context has meaningfully changed.
 * All main Claude sessions for the same project are merged into one project-scoped memory entry.
 */
export async function saveSessionsToMemory(
  circleId: string,
  userId: string,
  sessions: ClaudeCodeSession[],
): Promise<{ saved: number; skipped: number }> {
  let saved = 0;
  let skipped = 0;

  // Verify auth session exists before attempting save
  const { data: authCheck } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  if (!authCheck?.user) {
    console.warn('[claudeCodeDetector] saveSessionsToMemory: no auth session, skipping');
    return { saved: 0, skipped: sessions.length };
  }

  const mainSessions = sessions.filter(s => s.kind === 'main' || !s.kind);
  const sessionMode = await getCircleSessionMemoryMode(circleId);
  const visibility = sessionMode === 'shared' ? 'circle_shared' : 'private';
  const grouped = new Map<string, ClaudeCodeSession[]>();

  for (const session of mainSessions) {
    if (!session.lastUserMessage && !session.lastAssistantText) {
      skipped++;
      continue;
    }

    const projectKey = normalizeProjectKey(session.projectDir);
    const bucket = grouped.get(projectKey) || [];
    bucket.push(session);
    grouped.set(projectKey, bucket);
  }

  for (const [projectKey, projectSessions] of grouped) {
    const sortedSessions = [...projectSessions].sort((a, b) => {
      const aTime = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const bTime = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return bTime - aTime;
    });
    const latest = sortedSessions[0];
    const project = latest.projectDir.split('/').filter(Boolean).pop() || 'project';
    const bucketId = sessionMode === 'shared'
      ? `claude-project:shared:${projectKey}`
      : `claude-project:private:${userId}:${projectKey}`;

    const combinedUser = sortedSessions
      .map(s => s.lastUserMessage || '')
      .filter(Boolean)
      .slice(0, 4)
      .join(' | ');
    const combinedAssistant = sortedSessions
      .map(s => s.lastAssistantText || '')
      .filter(Boolean)
      .slice(0, 4)
      .join(' | ');
    const messageCount = sortedSessions.reduce((sum, s) => sum + (s.messageCount || 0), 0);
    const activeFiles = Array.from(new Set(
      sortedSessions.flatMap(s => (s.activeFiles || []).slice(-5).map(f => f.split('/').pop() || f))
    )).slice(0, 8);
    const tools = Array.from(new Set(
      sortedSessions.map(s => s.currentToolName || '').filter(Boolean)
    )).slice(0, 5);

    const hash = contextHash({
      lastUserMessage: combinedUser,
      lastAssistantText: combinedAssistant,
      messageCount,
    });
    if (_savedContextHashes.get(bucketId) === hash) {
      skipped++;
      continue;
    }

    const content = [
      `Claude Code project memory for ${project}`,
      `Sessions merged: ${sortedSessions.length} | Total messages: ${messageCount}`,
      combinedUser ? `Recent requests: ${combinedUser.slice(0, 600)}` : '',
      combinedAssistant ? `Recent responses: ${combinedAssistant.slice(0, 600)}` : '',
      activeFiles.length > 0 ? `Active files: ${activeFiles.join(', ')}` : '',
      tools.length > 0 ? `Current tools: ${tools.join(', ')}` : '',
    ].filter(Boolean).join('\n');

    const title = `CC Project: ${project}`;
    try {
      // Look up by title + source_surface (not session_id which is UUID)
      let existingQuery = supabase
        .from('memory_entries')
        .select('id')
        .eq('circle_id', circleId)
        .eq('scope', 'session')
        .eq('memory_kind', 'context')
        .eq('source_surface', 'claude_code_bridge')
        .eq('title', title)
        .order('created_at', { ascending: false })
        .limit(1);

      existingQuery = sessionMode === 'shared'
        ? existingQuery.is('user_id', null)
        : existingQuery.eq('user_id', userId);
      const { data: existing, error: existingError } = await existingQuery.maybeSingle();
      if (existingError) throw existingError;

      if (existing) {
        const { error: updateError } = await supabase.from('memory_entries').update({
          content,
          title,
          visibility,
          updated_at: new Date().toISOString(),
          metadata: {
            bucketId,
            projectKey,
            projectDir: latest.projectDir,
            provider: 'claude-code',
            providerLabel: 'CC',
            latestTask: latest.lastUserMessage || null,
            recentTasks: sortedSessions.map(s => s.lastUserMessage || '').filter(Boolean).slice(0, 6),
            recentResponses: sortedSessions.map(s => s.lastAssistantText || '').filter(Boolean).slice(0, 4),
            activeFiles,
            currentTools: tools,
            latestStatus: latest.status || null,
            latestModel: latest.model || null,
            mergedSessionIds: sortedSessions.map(s => s.sessionId),
            sessionMemoryMode: sessionMode,
          },
        }).eq('id', existing.id);
        if (updateError) throw updateError;
      } else {
        const { saveMemory } = await import('./agentRunSystem');
        const savedMemory = await saveMemory({
          scope: 'session',
          circleId,
          userId: sessionMode === 'shared' ? undefined : userId,
          memoryKind: 'context',
          title,
          content,
          sourceSurface: 'claude_code_bridge',
          visibility,
          retrievalMode: 'startup',
          importance: 0.72,
          metadata: {
            bucketId,
            projectKey,
            projectDir: latest.projectDir,
            provider: 'claude-code',
            providerLabel: 'CC',
            latestTask: latest.lastUserMessage || null,
            recentTasks: sortedSessions.map(s => s.lastUserMessage || '').filter(Boolean).slice(0, 6),
            recentResponses: sortedSessions.map(s => s.lastAssistantText || '').filter(Boolean).slice(0, 4),
            activeFiles,
            currentTools: tools,
            latestStatus: latest.status || null,
            latestModel: latest.model || null,
            mergedSessionIds: sortedSessions.map(s => s.sessionId),
            sessionMemoryMode: sessionMode,
          },
        });
        if (!savedMemory) throw new Error('saveMemory returned null');
      }

      _savedContextHashes.set(bucketId, hash);
      saved++;

      void promoteExternalAgentSessionKnowledge({
        circleId,
        userId,
        provider: 'claude-code',
        sessions: sortedSessions.map((session) => ({
          sessionId: session.sessionId,
          projectDir: session.projectDir,
          model: session.model,
          status: session.status,
          task: session.lastUserMessage,
          lastActivity: session.lastActivity,
          messageCount: session.messageCount,
          recentActions: session.recentActions,
          lastUserMessage: session.lastUserMessage,
          lastAssistantText: session.lastAssistantText,
          activeFiles: session.activeFiles,
          currentToolName: session.currentToolName,
        })),
        shareWithCircle: sessionMode === 'shared',
      }).catch((err) => {
        console.warn('[claudeCodeDetector] Failed to promote Claude knowledge:', err);
      });
    } catch (err) {
      console.warn('[claudeCodeDetector] Failed to save session context:', err);
      skipped++;
    }
  }

  return { saved, skipped };
}

/**
 * Build a cross-session context string suitable for injection into agent system prompts.
 * Shows what ALL active Claude Code sessions are working on so any new session
 * can pick up where others left off.
 */
export async function buildCrossSessionPrompt(): Promise<string> {
  const ctx = await fetchCrossSessionContext();
  if (!ctx || ctx.sessionCount === 0) return '';

  return `## Active Claude Code Sessions (${ctx.sessionCount})\n${ctx.summary}`;
}
