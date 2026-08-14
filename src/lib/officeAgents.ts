// Office Agent Types — real data comes from OpenSwan sessions
import { OpenSwanSession } from './openswanService';
import { ProviderType } from './connectionManager';

export type AgentStatus = 'active' | 'idle' | 'building' | 'error' | 'offline';

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
  uptime: string;           // human-readable uptime from session_status (e.g. "3h ago")
  lastActive: string;
  recentActions: string[];
  recentMessages: Array<{ role: string; content: string; timestamp?: string }>;
  costToday: number;
  sessionCostToday?: number;
  costTotal: number;
  costWeek: number;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  newTokens: number;
  turns: number;
  sessionKey: string;
  model: string;
  connectionId: string;
  connectionName: string;
  providerType: ProviderType;
  spirit?: string;  // Agent spirit ID from agentSpirits.ts (e.g. 'sr-engineer', 'trader')
  // Live work context — updated every bridge poll
  lastUserMessage?: string;
  lastAssistantText?: string;
  recentToolCalls?: Array<{ tool: string; file: string; ts: string }>;
  activeFiles?: string[];
  currentToolName?: string;
  currentToolFile?: string;
  projectDir?: string;
  subagentCount?: number;
  version?: string;
  slug?: string;
  runtimeKind?: string;
  parentSessionKey?: string;
  isSynthetic?: boolean;
  isProviderMain?: boolean;
  /** Fail-visible status annotation (e.g. "bridge offline — status stale").
   *  Set by reconcileAgentStatusWithConnection; never hides, only explains. */
  statusNote?: string;
}

/**
 * Durable cost fields published with a Circle Office agent. The database row
 * owns calendar-day and lifetime totals; live bridge sessions own only their
 * cumulative session meter. Keeping those meanings separate prevents a login,
 * bridge restart, or local-cache restore from changing a value labelled
 * "today".
 */
export interface DurableOfficeAgentCostLike {
  id?: string | null;
  name?: string | null;
  provider?: string | null;
  estimated_cost_today?: number | string | null;
  estimated_cost_total?: number | string | null;
}

function finiteNonNegativeCost(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function normalizedCostIdentity(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/**
 * Resolve one durable cost row without order-dependent provider fallback.
 * Exact DB id/name wins. A provider-level fallback is allowed only when both
 * sides are singular; multiple same-provider sessions must not all inherit the
 * same aggregate or pick whichever DB row happened to load last.
 */
export function findDurableOfficeAgentCost<T extends DurableOfficeAgentCostLike>(
  agent: Pick<OfficeAgent, 'name' | 'providerType' | 'connectionId' | 'sessionKey'>,
  rows: readonly T[],
  options: { liveProviderAgentCount?: number } = {},
): T | null {
  const candidates = Array.isArray(rows) ? rows.filter(Boolean) : [];
  if (agent.connectionId === 'db-agent') {
    const exactId = candidates.filter((row) => String(row.id || '') === agent.sessionKey);
    if (exactId.length === 1) return exactId[0];
    if (exactId.length > 1) return null;
  }

  const agentName = normalizedCostIdentity(agent.name);
  if (agentName) {
    const exactName = candidates.filter((row) => normalizedCostIdentity(row.name) === agentName);
    if (exactName.length === 1) return exactName[0];
    if (exactName.length > 1) return null;
  }

  if (options.liveProviderAgentCount !== 1) return null;
  const provider = normalizedCostIdentity(agent.providerType);
  if (!provider) return null;
  const providerRows = candidates.filter((row) => normalizedCostIdentity(row.provider) === provider);
  return providerRows.length === 1 ? providerRows[0] : null;
}

/** Apply server-owned daily/lifetime totals while retaining session lineage. */
export function applyDurableOfficeAgentCost(
  agent: OfficeAgent,
  durable: DurableOfficeAgentCostLike | null | undefined,
): OfficeAgent {
  const sessionCost = finiteNonNegativeCost(agent.sessionCostToday ?? agent.costToday);
  if (!durable) {
    const costToday = finiteNonNegativeCost(agent.costToday);
    return {
      ...agent,
      costToday,
      sessionCostToday: sessionCost,
      costTotal: Math.max(costToday, finiteNonNegativeCost(agent.costTotal)),
    };
  }

  const costToday = finiteNonNegativeCost(durable.estimated_cost_today);
  return {
    ...agent,
    costToday,
    sessionCostToday: sessionCost,
    costTotal: Math.max(costToday, finiteNonNegativeCost(durable.estimated_cost_total)),
  };
}

export const STATUS_COLORS: Record<AgentStatus, string> = {
  active: '#22c55e',
  idle: '#22c55e',
  building: '#3b82f6',
  error: '#ef4444',
  offline: '#6b7280',
};

export function isConnectedOfficeStatus(status: AgentStatus | string | undefined): boolean {
  return status === 'active' || status === 'building' || status === 'idle';
}

export function getOfficeStatusColor(status: AgentStatus | string | undefined): string {
  if (status === 'error') return STATUS_COLORS.error;
  if (status === 'offline' || !status) return STATUS_COLORS.offline;
  return STATUS_COLORS.active;
}

export function getOfficeStatusLabel(status: AgentStatus | string | undefined): string {
  if (status === 'building') return 'Building';
  if (status === 'active') return 'Active';
  if (status === 'idle') return 'Connected';
  if (status === 'error') return 'Error';
  return 'Offline';
}

export function getOfficeStatusSortRank(status: AgentStatus | string | undefined): number {
  if (status === 'building') return 0;
  if (status === 'active') return 1;
  if (status === 'idle') return 2;
  if (status === 'error') return 3;
  return 4;
}

// ─── Unified status derivation for session-based agents ──────────────────────
// Strict thresholds so the badges actually mean something:
//   ACTIVE   = a tool/message is in flight RIGHT NOW (<15s mtime OR open tool)
//   BUILDING = working between turns (15s–3 min)
//   IDLE     = session open but quiet (3 min–1 h)
//   OFFLINE  = disconnected or no activity for ≥1 h
//
// `currentToolName` short-circuits to ACTIVE because it means the bridge saw
// an unfinished tool_use entry (no tool_result yet) — that IS a live action.

export const STATUS_THRESHOLD_ACTIVE_MS = 15_000;       // 15 seconds
export const STATUS_THRESHOLD_BUILDING_MS = 3 * 60_000; // 3 minutes
export const STATUS_THRESHOLD_IDLE_MS = 60 * 60_000;    // 1 hour

export function deriveSessionStatus(opts: {
  lastActivityIso?: string | null;
  currentToolName?: string | null;
  fallback?: AgentStatus;
}): AgentStatus {
  if (opts.currentToolName && opts.currentToolName.length > 0) return 'active';
  if (!opts.lastActivityIso) return opts.fallback ?? 'offline';
  const ts = new Date(opts.lastActivityIso).getTime();
  if (!Number.isFinite(ts)) return opts.fallback ?? 'offline';
  const age = Date.now() - ts;
  if (age < STATUS_THRESHOLD_ACTIVE_MS) return 'active';
  if (age < STATUS_THRESHOLD_BUILDING_MS) return 'building';
  if (age < STATUS_THRESHOLD_IDLE_MS) return 'idle';
  return 'offline';
}

// `circle_office_agents.status` has a CHECK constraint that only accepts
// `idle | building | offline`. Our in-memory state uses the richer
// `active | building | idle | offline` set; clamp before any DB write so
// PostgREST doesn't reject the row.
export type DbAgentStatus = 'idle' | 'building' | 'offline';
export function clampToDbStatus(status: AgentStatus | string | undefined): DbAgentStatus {
  if (status === 'building' || status === 'active') return 'building';
  if (status === 'idle') return 'idle';
  return 'offline';
}

// Heartbeat-based status for synthesized agents (OpenSwan default, bonded
// API-only providers without session files). Heartbeat publishers tick every
// 30s, so the active window is wider than for session-based agents.
export function deriveHeartbeatStatus(opts: {
  lastHeartbeatIso?: string | null;
  fallback?: AgentStatus;
}): AgentStatus {
  if (!opts.lastHeartbeatIso) return opts.fallback ?? 'offline';
  const ts = new Date(opts.lastHeartbeatIso).getTime();
  if (!Number.isFinite(ts)) return opts.fallback ?? 'offline';
  const age = Date.now() - ts;
  if (age < 60_000) return 'active';      // beat in last 60s
  if (age < 5 * 60_000) return 'idle';    // beat in last 5 min
  return 'offline';
}

// ─── Bridge-aware status reconcile (O2, P38) ─────────────────────────────────
// Session-derived status decays slowly (active → building → idle over up to an
// hour), so when an execution bridge dies an agent can read "Active/Building"
// with no working bridge behind it. This reconciles the agent's status with its
// OWN connection's live state. FAIL-VISIBLE: it only DEMOTES and ANNOTATES —
// it never upgrades a status, never hides an agent, and leaves agents without
// a connection (DB rows, synthetic pins) untouched. Pure — caller passes nowMs.

/** How stale lastActive must be before a disconnected bridge demotes the status. */
export const BRIDGE_RECONCILE_STALE_MS = 60_000;

export interface AgentStatusReconcileResult {
  status: AgentStatus;
  statusNote?: string;
}

export function reconcileAgentStatusWithConnection(
  agent: Pick<OfficeAgent, 'status' | 'lastActive' | 'connectionId'>,
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error' | null | undefined,
  nowMs: number,
): AgentStatusReconcileResult {
  const status = agent?.status;
  // No connection linkage, or the bridge is fine → untouched.
  if (!agent?.connectionId || !connectionStatus || connectionStatus === 'connected') {
    return { status };
  }
  // Only live-looking statuses can mislead; idle/offline/error stay as-is.
  if (status !== 'active' && status !== 'building') return { status };

  const lastMs = agent.lastActive ? new Date(agent.lastActive).getTime() : NaN;
  const fresh = Number.isFinite(lastMs) && nowMs - lastMs < BRIDGE_RECONCILE_STALE_MS;
  if (fresh) {
    // Genuine recent activity but the connection disagrees — keep the status,
    // but say so instead of silently trusting either side.
    return { status, statusNote: 'bridge disconnected' };
  }
  return { status: 'offline', statusNote: 'bridge offline — status stale' };
}

// Agent colors for assignment
export const AGENT_COLORS = [
  '#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
  '#14b8a6', '#f472b6', '#fb923c', '#dc2626', '#84cc16', '#38bdf8',
  '#a855f7', '#6366f1', '#e879f9', '#facc15',
];

// Empty default — no mock data
export const OFFICE_AGENTS: OfficeAgent[] = [];

// Default agent provided by the app — always present in the office.
// Display name is "OpenSwan" (the public-facing brand). Internal id, sessionKey
// and providerType keep the legacy "blackswan" tokens so routing, prompts, and
// historic data stay intact.
export const DEFAULT_AGENT: OfficeAgent = {
  id: 'default::blackswan',
  name: 'OpenSwan',
  role: 'Circle AI',
  status: 'active',
  color: '#ef4444',
  deskIndex: 0,
  activity: 'Watching the circle · HF tools ready',
  messagesProcessed: 0,
  uptimeHours: 0,
  uptime: 'always on',
  lastActive: new Date().toISOString(),
  recentActions: [],
  recentMessages: [],
  costToday: 0,
  costTotal: 0,
  costWeek: 0,
  tokensUsed: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  newTokens: 0,
  turns: 0,
  sessionKey: 'blackswan',
  model: 'blackswan-7b',
  connectionId: 'default',
  connectionName: 'OpenSwan',
  providerType: 'blackswan-local',
  runtimeKind: 'main',
  isSynthetic: true,
  isProviderMain: true,
};

// Second default agent — HuggingSwan, the HuggingFace inference proxy.
// Specializes in TASK execution: image generation, text-to-speech, code
// generation, summarization, translation. Routed through hf-proxy edge fn.
//
// Sits at desk index 1 (right after BlackSwan). Distinct yellow brand color
// from HF. Status='idle' since it's request-driven (no ambient activity);
// flips to 'building' transiently while a /imagine or /code is in flight
// (handled by the chat command path that updates `agent_activity`).
export const HUGGINGSWAN_AGENT: OfficeAgent = {
  id: 'default::huggingswan',
  name: 'HuggingSwan',
  role: 'HF Tools',
  status: 'idle',
  color: '#ffbd45',
  deskIndex: 1,
  activity: 'Ready: /imagine, /speak, /code, /summarize, /translate',
  messagesProcessed: 0,
  uptimeHours: 0,
  uptime: 'always on',
  lastActive: new Date().toISOString(),
  recentActions: [],
  recentMessages: [],
  costToday: 0,
  costTotal: 0,
  costWeek: 0,
  tokensUsed: 0,
  inputTokens: 0,
  outputTokens: 0,
  cachedTokens: 0,
  newTokens: 0,
  turns: 0,
  sessionKey: 'huggingswan',
  model: 'hf-router',
  connectionId: 'default',
  connectionName: 'HuggingSwan',
  providerType: 'huggingface',
  runtimeKind: 'main',
  isSynthetic: true,
  isProviderMain: true,
};

// Pricing is centralized in modelPricing.ts — single source of truth
import { MODEL_PRICING, estimateCost, estimateCostWithCache } from './modelPricing';
export { MODEL_PRICING } from './modelPricing';

// Convert OpenSwan sessions to OfficeAgents
export function sessionsToAgents(
  sessions: OpenSwanSession[],
  connectionId: string,
  connectionName: string,
  providerType: ProviderType,
): OfficeAgent[] {
  return sessions.map((s, i) => {
    const sessionCostToday = s.totalCost
      ?? (s.cachedTokens != null || s.newTokens != null
          ? estimateCostWithCache(s.model, s.cachedTokens ?? 0, s.newTokens ?? 0, s.totalOutputTokens ?? 0)
          : estimateCost(s.model, s.totalInputTokens ?? 0, s.totalOutputTokens ?? 0));
    return {
      id: `${connectionId}::${s.sessionKey}`,
      name: s.agentId || s.sessionKey.slice(0, 12),
      role: s.kind === 'main' ? 'Main Agent' : s.kind === 'subagent' ? 'Sub-Agent' : s.kind || 'Session',
      status: inferStatus(s),
      color: AGENT_COLORS[i % AGENT_COLORS.length],
      deskIndex: i,
      activity: inferActivity(s),
      messagesProcessed: s.turns || s.messageCount || 0,
      uptimeHours: 0,
      uptime: s.uptime || '',
      lastActive: s.lastActivity || '',
      recentActions: extractRecentActions(s),
      recentMessages: s.lastMessages || [],
      costToday: sessionCostToday,
      sessionCostToday,
      costTotal: 0, // enriched from DB
      costWeek: 0,
      tokensUsed: (s.totalInputTokens || 0) + (s.totalOutputTokens || 0),
      inputTokens: s.totalInputTokens || 0,
      outputTokens: s.totalOutputTokens || 0,
      cachedTokens: s.cachedTokens || 0,
      newTokens: s.newTokens || 0,
      turns: s.turns || s.messageCount || 0,
      sessionKey: s.sessionKey,
      model: s.model || 'unknown',
      connectionId,
      connectionName,
      providerType,
      runtimeKind: s.kind || (s.isSubagent ? 'subagent' : 'session'),
      parentSessionKey: s.parentSessionKey,
    };
  });
}

function inferStatus(s: OpenSwanSession): AgentStatus {
  if (!s.lastActivity) return 'offline';
  // If it has recent messages, likely active
  if (s.lastMessages && s.lastMessages.length > 0) return 'active';
  return 'idle';
}

function inferActivity(s: OpenSwanSession): string {
  if (s.lastMessages && s.lastMessages.length > 0) {
    const last = s.lastMessages[s.lastMessages.length - 1];
    if (last.content) return last.content.slice(0, 50) + (last.content.length > 50 ? '...' : '');
  }
  if (s.kind === 'main') return 'Main session';
  if (s.kind === 'subagent') return 'Background task';
  return 'Idle';
}

function extractRecentActions(s: OpenSwanSession): string[] {
  if (!s.lastMessages) return [];
  return s.lastMessages
    .filter(m => m.role === 'assistant' && m.content)
    .map(m => m.content.slice(0, 80))
    .slice(0, 5);
}

export type WhiteboardMode = 'overview' | 'activity' | 'ops' | 'agent_log';

export const WHITEBOARD_MODES: { key: WhiteboardMode; icon: string; label: string }[] = [
  { key: 'overview', icon: '📊', label: 'OVERVIEW' },
  { key: 'activity', icon: '📡', label: 'ACTIVITY' },
  { key: 'ops', icon: '⚙️', label: 'OPS' },
  { key: 'agent_log', icon: '📜', label: 'AGENT LOG' },
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
