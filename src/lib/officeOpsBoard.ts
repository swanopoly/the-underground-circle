/**
 * officeOpsBoard — pure model layer for the Office dashboard "ops board".
 *
 * D6 pattern (see computerTaskStateModel.ts): pure builders that turn raw
 * rows into bounded, render-ready card models. The UI layer (OfficeTab)
 * only maps these models to components.
 *
 * Rules for this module (smoke-testable via tsx):
 *   - ZERO runtime imports. `import type` only — no supabase, no react-native.
 *   - No Date.now() / clocks in builders: callers pass `nowMs`.
 *   - Every output list is bounded with explicit overflow counts.
 *   - Partial / missing inputs must never throw.
 */

import type { AgentRun } from './agentRunSystem';
import type { OfficeAgent } from './officeAgents';

// ── Structural input types (duck-typed; real rows must remain assignable) ───

export interface AgentRunLike {
  id: string;
  title?: string | null;
  status: string;
  surface?: string | null;
  parent_run_id?: string | null;
  delegated_to?: string | null;
  started_at?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cached_tokens?: number | null;
  estimated_cost?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface ClaudeUsageSummaryLike {
  total_cost?: number | null;
  total_input?: number | null;
  total_output?: number | null;
  total_cache_creation?: number | null;
  total_cache_read?: number | null;
  request_count?: number | null;
  cache_hit_rate?: number | null;
}

export interface ClaudeUsageModelRowLike {
  model?: string | null;
  total_cost?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read?: number | null;
  cache_creation?: number | null;
  request_count?: number | null;
}

export interface OfficeAgentLike {
  currentToolName?: string | null;
  currentToolFile?: string | null;
  recentToolCalls?: Array<{ tool: string; file?: string | null; ts?: string | null }> | null;
  activeFiles?: string[] | null;
  uptime?: string | null;
  lastActive?: string | null;
  subagentCount?: number | null;
}

// Compile-time compatibility guards: the real rows must satisfy the Like
// types. These are erased at runtime (type-only), so the module stays pure.
type AssertAssignable<T extends U, U> = T;
type _AgentRunIsRunLike = AssertAssignable<AgentRun, AgentRunLike>;
type _OfficeAgentIsAgentLike = AssertAssignable<OfficeAgent, OfficeAgentLike>;

// ── Output models ────────────────────────────────────────────────────────────

export interface OfficeRunTokens {
  input: number;
  output: number;
  cached: number;
}

export interface OfficeRunNode {
  runId: string;
  title: string;
  /** delegated_to role (prettified) or surface/title-derived agent label. */
  agentName: string;
  status: string;
  isSubagent: boolean;
  parentRunId?: string;
  /** metadata.delegationDepth when present, else tree depth (orphans ≥ 1). */
  depth: number;
  startedAt?: string;
  /** Computed from the caller-supplied nowMs (finished runs use completed_at). */
  durationMs: number;
  /** Latest step/tool hint from metadata.runtimeToolActions or provided hints. */
  stepHint?: string;
  tokens?: OfficeRunTokens;
  costUsd?: number;
  children: OfficeRunNode[];
  /** How many building children were cut by the per-root bound. */
  childOverflow: number;
}

export interface OfficeBuildingBoardCounts {
  activeRoots: number;
  activeSubagents: number;
  waitingApproval: number;
  queued: number;
}

export interface OfficeBuildingBoard {
  /** Building roots (nested children), bounded by maxRoots. */
  building: OfficeRunNode[];
  counts: OfficeBuildingBoardCounts;
  /** Completed/failed within the recent window, newest first, ≤ 5. */
  recentlyFinished: OfficeRunNode[];
  /** How many building roots were cut by the maxRoots bound. */
  overflowRoots: number;
}

export interface OfficeTokenTrackerTopModel {
  model: string;
  costUsd: number;
  sharePct: number;
}

export interface OfficeTokenTrackerCard {
  spendTodayUsd?: number;
  spendWeekUsd?: number;
  tokens?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  cacheHitPct?: number;
  topModels: OfficeTokenTrackerTopModel[];
  liveBurn?: { activeRuns: number; tokensInFlight: number; costInFlightUsd: number };
  updatedAtMs: number;
}

export interface OfficeAgentLiveOps {
  /** e.g. "Now: browser.find src/lib/foo.ts" */
  statusLine?: string;
  /** ≤ 3 deduped recent tool names. */
  recentTools: string[];
  activeFile?: string;
  uptimeLabel?: string;
  lastActiveLabel?: string;
  subagents: { active: number; label?: string };
}

// ── Bounds & constants ───────────────────────────────────────────────────────

export const OFFICE_BOARD_MAX_ROOTS = 8;
export const OFFICE_BOARD_MAX_CHILDREN_PER_ROOT = 6;
export const OFFICE_BOARD_MAX_RECENTLY_FINISHED = 5;
export const OFFICE_BOARD_RECENT_FINISHED_WINDOW_MS = 10 * 60_000;

export const OFFICE_BOARD_BUILDING_STATUSES = [
  'queued',
  'planning',
  'running',
  'waiting_approval',
  'paused',
] as const;

const BUILDING_STATUS_SET = new Set<string>(OFFICE_BOARD_BUILDING_STATUSES);
const FINISHED_STATUS_SET = new Set<string>(['completed', 'failed']);

// Deterministic ordering: most "live" status first, then newest start first.
const STATUS_ORDER: Record<string, number> = {
  running: 0,
  waiting_approval: 1,
  planning: 2,
  paused: 3,
  queued: 4,
};

const SURFACE_AGENT_LABELS: Record<string, string> = {
  main_chat: 'Chat agent',
  floating_chat: 'Chat agent',
  room_chat: 'Room agent',
  feed_task: 'Feed agent',
  office_terminal: 'Office terminal',
  scheduled: 'Scheduled agent',
  api: 'API agent',
};

// ── Pure helpers ─────────────────────────────────────────────────────────────

function toFiniteNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function parseTimestampMs(iso: string | null | undefined): number | null {
  if (!iso || typeof iso !== 'string') return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function clampBound(value: number | undefined, fallback: number, hardMax: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback;
  return Math.min(Math.floor(value), hardMax);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clampPct(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function baseName(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, '');
  const segments = trimmed.split(/[\\/]/).filter(Boolean);
  return segments.length > 0 ? segments[segments.length - 1] : trimmed;
}

/** Format a token count with k/M suffixes: 950 → "950", 1234 → "1.2k", 3.4M. */
export function formatTokenCount(count: number): string {
  const n = Number.isFinite(count) ? Math.max(0, count) : 0;
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Pure relative-time label from an elapsed duration in ms. */
export function formatRelativeTime(elapsedMs: number): string {
  const ms = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  if (ms < 45_000) return 'just now';
  if (ms < 90_000) return '1m ago';
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))}h ago`;
  return `${Math.round(ms / (24 * 60 * 60_000))}d ago`;
}

function deriveAgentName(run: AgentRunLike): string {
  const delegated = typeof run.delegated_to === 'string' ? run.delegated_to.trim() : '';
  if (delegated) return titleCaseWords(delegated.replace(/[_\-.]+/g, ' '));
  const title = typeof run.title === 'string' ? run.title.trim() : '';
  const prefixed = title.match(/^([A-Za-z][A-Za-z0-9 ._-]{0,30}?):\s/);
  if (prefixed) return prefixed[1].trim();
  const surface = typeof run.surface === 'string' ? run.surface : '';
  return SURFACE_AGENT_LABELS[surface] || 'Agent';
}

function deriveStepHint(
  run: AgentRunLike,
  providedHints?: Record<string, string>,
): string | undefined {
  const provided = providedHints?.[run.id];
  if (typeof provided === 'string' && provided.trim()) return truncateText(provided.trim(), 80);
  const actions = run.metadata?.runtimeToolActions;
  if (Array.isArray(actions) && actions.length > 0) {
    const last = actions[actions.length - 1] as Record<string, unknown> | null;
    if (last && typeof last === 'object') {
      const hint = last.title ?? last.tool ?? last.tool_name;
      if (typeof hint === 'string' && hint.trim()) return truncateText(hint.trim(), 80);
    }
  }
  return undefined;
}

function deriveDeclaredDepth(run: AgentRunLike): number | null {
  const depth = run.metadata?.delegationDepth;
  if (typeof depth === 'number' && Number.isFinite(depth) && depth >= 0) return Math.floor(depth);
  return null;
}

function isSubagentRun(run: AgentRunLike): boolean {
  return Boolean(run.parent_run_id || (typeof run.delegated_to === 'string' && run.delegated_to.trim()));
}

// ── 1. Building-now board ────────────────────────────────────────────────────

export function buildOfficeBuildingBoard(
  runs: AgentRunLike[],
  opts: { nowMs: number; maxRoots?: number; maxChildrenPerRoot?: number; stepHints?: Record<string, string> },
): OfficeBuildingBoard {
  const nowMs = Number.isFinite(opts?.nowMs) ? opts.nowMs : 0;
  const maxRoots = clampBound(opts?.maxRoots, OFFICE_BOARD_MAX_ROOTS, OFFICE_BOARD_MAX_ROOTS);
  const maxChildren = clampBound(
    opts?.maxChildrenPerRoot,
    OFFICE_BOARD_MAX_CHILDREN_PER_ROOT,
    OFFICE_BOARD_MAX_CHILDREN_PER_ROOT,
  );

  // Dedupe by id (first occurrence wins) and drop malformed rows.
  const seenIds = new Set<string>();
  const all: AgentRunLike[] = [];
  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || typeof run.id !== 'string' || !run.id || seenIds.has(run.id)) continue;
    seenIds.add(run.id);
    all.push(run);
  }

  const building = all.filter((run) => BUILDING_STATUS_SET.has(run.status));
  const buildingIds = new Set(building.map((run) => run.id));

  const childrenByParent = new Map<string, AgentRunLike[]>();
  for (const run of building) {
    if (run.parent_run_id && buildingIds.has(run.parent_run_id)) {
      const siblings = childrenByParent.get(run.parent_run_id) || [];
      siblings.push(run);
      childrenByParent.set(run.parent_run_id, siblings);
    }
  }

  // Roots: no parent, or parent missing from the building set (orphans).
  const rootRuns = building.filter(
    (run) => !run.parent_run_id || !buildingIds.has(run.parent_run_id),
  );

  const startMsOf = (run: AgentRunLike): number =>
    parseTimestampMs(run.started_at) ?? parseTimestampMs(run.created_at) ?? 0;

  const compareRuns = (a: AgentRunLike, b: AgentRunLike): number => {
    const rankA = STATUS_ORDER[a.status] ?? 5;
    const rankB = STATUS_ORDER[b.status] ?? 5;
    if (rankA !== rankB) return rankA - rankB;
    const startDelta = startMsOf(b) - startMsOf(a); // newest start first
    if (startDelta !== 0) return startDelta;
    return a.id.localeCompare(b.id);
  };

  const toNode = (run: AgentRunLike, treeDepth: number, visited: Set<string>): OfficeRunNode => {
    const startMs = parseTimestampMs(run.started_at) ?? parseTimestampMs(run.created_at);
    const completedMs = parseTimestampMs(run.completed_at);
    const isFinished = FINISHED_STATUS_SET.has(run.status);
    const endMs = isFinished && completedMs != null ? completedMs : nowMs;
    const durationMs = startMs == null ? 0 : Math.max(0, endMs - startMs);

    const input = toFiniteNumber(run.input_tokens);
    const output = toFiniteNumber(run.output_tokens);
    const cached = toFiniteNumber(run.cached_tokens);
    const cost = toFiniteNumber(run.estimated_cost);

    const isSubagent = isSubagentRun(run);
    const declaredDepth = deriveDeclaredDepth(run);
    const depth = declaredDepth ?? (isSubagent && treeDepth === 0 ? 1 : treeDepth);

    const nextVisited = new Set(visited);
    nextVisited.add(run.id);
    const childRuns = (childrenByParent.get(run.id) || [])
      .filter((child) => !nextVisited.has(child.id)) // cycle guard
      .sort(compareRuns);
    const children = childRuns
      .slice(0, maxChildren)
      .map((child) => toNode(child, treeDepth + 1, nextVisited));

    const title = (typeof run.title === 'string' && run.title.trim()) || 'Untitled run';
    const startedAt = run.started_at || run.created_at || undefined;

    return {
      runId: run.id,
      title: truncateText(title, 120),
      agentName: deriveAgentName(run),
      status: run.status,
      isSubagent,
      parentRunId: run.parent_run_id || undefined,
      depth,
      startedAt: startedAt || undefined,
      durationMs,
      stepHint: deriveStepHint(run, opts?.stepHints),
      tokens: input + output + cached > 0 ? { input, output, cached } : undefined,
      costUsd: cost > 0 ? round4(cost) : undefined,
      children,
      childOverflow: Math.max(0, childRuns.length - children.length),
    };
  };

  const sortedRoots = [...rootRuns].sort(compareRuns);
  const buildingNodes = sortedRoots
    .slice(0, maxRoots)
    .map((run) => toNode(run, 0, new Set<string>()));

  const counts: OfficeBuildingBoardCounts = {
    activeRoots: building.filter((run) => !isSubagentRun(run)).length,
    activeSubagents: building.filter((run) => isSubagentRun(run)).length,
    waitingApproval: building.filter((run) => run.status === 'waiting_approval').length,
    queued: building.filter((run) => run.status === 'queued').length,
  };

  const recentlyFinished = all
    .filter((run) => FINISHED_STATUS_SET.has(run.status))
    .map((run) => ({ run, completedMs: parseTimestampMs(run.completed_at) }))
    .filter(
      (entry): entry is { run: AgentRunLike; completedMs: number } =>
        entry.completedMs != null && nowMs - entry.completedMs <= OFFICE_BOARD_RECENT_FINISHED_WINDOW_MS,
    )
    .sort((a, b) => (b.completedMs - a.completedMs) || a.run.id.localeCompare(b.run.id))
    .slice(0, OFFICE_BOARD_MAX_RECENTLY_FINISHED)
    .map((entry) => toNode(entry.run, isSubagentRun(entry.run) ? 1 : 0, new Set([entry.run.id])));

  return {
    building: buildingNodes,
    counts,
    recentlyFinished,
    overflowRoots: Math.max(0, sortedRoots.length - buildingNodes.length),
  };
}

// ── 2. Token tracker ─────────────────────────────────────────────────────────

function deriveCacheHitPct(summary: ClaudeUsageSummaryLike | undefined): number | undefined {
  if (!summary) return undefined;
  const cacheRead = toFiniteNumber(summary.total_cache_read);
  const input = toFiniteNumber(summary.total_input);
  if (cacheRead + input > 0) return clampPct((cacheRead / (cacheRead + input)) * 100);
  const rate = summary.cache_hit_rate;
  if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
    // RPC may report a fraction (0..1) or a percent (0..100); normalize both.
    return clampPct(rate <= 1 ? rate * 100 : rate);
  }
  return undefined;
}

export function buildOfficeTokenTracker(input: {
  summary?: ClaudeUsageSummaryLike;
  byModel?: ClaudeUsageModelRowLike[];
  liveRuns?: AgentRunLike[];
  periodCosts?: { today?: number; week?: number };
  nowMs: number;
}): OfficeTokenTrackerCard {
  const nowMs = Number.isFinite(input?.nowMs) ? input.nowMs : 0;
  const summary = input?.summary;
  const periodCosts = input?.periodCosts;

  const spendTodayUsd =
    typeof periodCosts?.today === 'number' && Number.isFinite(periodCosts.today)
      ? round2(Math.max(0, periodCosts.today))
      : undefined;

  const weekSource =
    typeof periodCosts?.week === 'number' && Number.isFinite(periodCosts.week)
      ? periodCosts.week
      : summary
        ? toFiniteNumber(summary.total_cost)
        : undefined;
  const spendWeekUsd = typeof weekSource === 'number' ? round2(Math.max(0, weekSource)) : undefined;

  const tokens = summary
    ? {
        input: toFiniteNumber(summary.total_input),
        output: toFiniteNumber(summary.total_output),
        cacheRead: toFiniteNumber(summary.total_cache_read),
        cacheWrite: toFiniteNumber(summary.total_cache_creation),
      }
    : undefined;

  const modelRows = Array.isArray(input?.byModel) ? input.byModel : [];
  const totalModelCost = modelRows.reduce((sum, row) => sum + Math.max(0, toFiniteNumber(row?.total_cost)), 0);
  const topModels: OfficeTokenTrackerTopModel[] = [...modelRows]
    .filter((row) => row && typeof row === 'object')
    .sort((a, b) => {
      const delta = toFiniteNumber(b.total_cost) - toFiniteNumber(a.total_cost);
      if (delta !== 0) return delta;
      return String(a.model || '').localeCompare(String(b.model || ''));
    })
    .slice(0, 3)
    .map((row) => {
      const costUsd = Math.max(0, toFiniteNumber(row.total_cost));
      return {
        model: (typeof row.model === 'string' && row.model.trim()) || 'unknown',
        costUsd: round2(costUsd),
        sharePct: totalModelCost > 0 ? clampPct((costUsd / totalModelCost) * 100) : 0,
      };
    });

  let liveBurn: OfficeTokenTrackerCard['liveBurn'];
  if (Array.isArray(input?.liveRuns)) {
    const active = input.liveRuns.filter(
      (run) => run && BUILDING_STATUS_SET.has(run.status),
    );
    liveBurn = {
      activeRuns: active.length,
      tokensInFlight: active.reduce(
        (sum, run) =>
          sum +
          toFiniteNumber(run.input_tokens) +
          toFiniteNumber(run.output_tokens) +
          toFiniteNumber(run.cached_tokens),
        0,
      ),
      costInFlightUsd: round2(active.reduce((sum, run) => sum + Math.max(0, toFiniteNumber(run.estimated_cost)), 0)),
    };
  }

  return {
    spendTodayUsd,
    spendWeekUsd,
    tokens,
    cacheHitPct: deriveCacheHitPct(summary),
    topModels,
    liveBurn,
    updatedAtMs: nowMs,
  };
}

// ── 3. Per-agent live ops ────────────────────────────────────────────────────

export function buildAgentLiveOps(
  agent: OfficeAgentLike,
  runsForAgent: OfficeRunNode[],
  nowMs: number,
): OfficeAgentLiveOps {
  const safeAgent = agent || {};
  const now = Number.isFinite(nowMs) ? nowMs : 0;

  let statusLine: string | undefined;
  const toolName = typeof safeAgent.currentToolName === 'string' ? safeAgent.currentToolName.trim() : '';
  if (toolName) {
    const toolFile = typeof safeAgent.currentToolFile === 'string' ? safeAgent.currentToolFile.trim() : '';
    statusLine = truncateText(`Now: ${toolName}${toolFile ? ` ${baseName(toolFile)}` : ''}`, 64);
  }

  const recentTools: string[] = [];
  for (const call of Array.isArray(safeAgent.recentToolCalls) ? safeAgent.recentToolCalls : []) {
    const tool = typeof call?.tool === 'string' ? call.tool.trim() : '';
    if (!tool || recentTools.includes(tool)) continue;
    recentTools.push(tool);
    if (recentTools.length >= 3) break;
  }

  const firstActiveFile = Array.isArray(safeAgent.activeFiles)
    ? safeAgent.activeFiles.find((file) => typeof file === 'string' && file.trim())
    : undefined;
  const activeFile = firstActiveFile ? truncateText(baseName(firstActiveFile), 48) : undefined;

  const uptime = typeof safeAgent.uptime === 'string' ? safeAgent.uptime.trim() : '';
  const uptimeLabel = uptime || undefined;

  let lastActiveLabel: string | undefined;
  const lastActiveMs = parseTimestampMs(safeAgent.lastActive);
  if (lastActiveMs != null) lastActiveLabel = formatRelativeTime(now - lastActiveMs);

  const runs = Array.isArray(runsForAgent) ? runsForAgent : [];
  const activeFromRuns = runs.filter(
    (node) => node && node.isSubagent && BUILDING_STATUS_SET.has(node.status),
  ).length;
  const fallbackCount =
    typeof safeAgent.subagentCount === 'number' && Number.isFinite(safeAgent.subagentCount)
      ? Math.max(0, Math.floor(safeAgent.subagentCount))
      : 0;
  const activeSubagents = activeFromRuns > 0 ? activeFromRuns : fallbackCount;

  return {
    statusLine,
    recentTools,
    activeFile,
    uptimeLabel,
    lastActiveLabel,
    subagents: {
      active: activeSubagents,
      label:
        activeSubagents > 0
          ? `${activeSubagents} subagent${activeSubagents === 1 ? '' : 's'} active`
          : undefined,
    },
  };
}

// ─── Per-agent accountability rollup (O1, P38) ───────────────────────────────
// "What did this agent actually do lately, and did it work?" — the last
// finished outcome + 24h completed/failed counts + 24h cost, keyed by the SAME
// case-insensitive agent-name seam the building board uses
// (deriveAgentName → opsRunNodesByAgent in OfficeTab). Same limitation applies:
// runs without an explicit agent label attach to a generic surface label, not a
// roster agent. Pure — caller supplies nowMs.

export const OFFICE_ACCOUNTABILITY_WINDOW_MS = 24 * 60 * 60 * 1000;
const ACCOUNTABILITY_TITLE_MAX = 48;

export interface OfficeAgentAccountability {
  /** "✅ Fixed login flow · 2h ago" / "❌ Deploy failed · 20m ago". */
  lastLine: string;
  /** Tone for the line: good = last finished run completed, danger = failed. */
  tone: 'good' | 'danger';
  completed24h: number;
  failed24h: number;
  /** Sum of estimated_cost over the window's finished runs (2dp). */
  costUsd24h: number;
}

/**
 * Index finished runs (completed/failed within `windowMs` of `nowMs`) by the
 * board's derived agent-name key (lowercased). Building/queued runs are the
 * live board's job and are ignored here. Returns an empty map for no input.
 */
export function buildOfficeAgentAccountabilityIndex(
  runs: AgentRunLike[] | null | undefined,
  opts: { nowMs: number; windowMs?: number },
): Map<string, OfficeAgentAccountability> {
  const map = new Map<string, OfficeAgentAccountability & { lastMs: number }>();
  const nowMs = Number.isFinite(opts?.nowMs) ? opts.nowMs : 0;
  const windowMs = Number.isFinite(opts?.windowMs) && (opts.windowMs as number) > 0
    ? (opts.windowMs as number)
    : OFFICE_ACCOUNTABILITY_WINDOW_MS;

  for (const run of Array.isArray(runs) ? runs : []) {
    if (!run || !FINISHED_STATUS_SET.has(run.status)) continue;
    const endedMs = parseTimestampMs(run.completed_at) ?? parseTimestampMs(run.created_at);
    if (endedMs == null || endedMs > nowMs || nowMs - endedMs > windowMs) continue;

    const key = deriveAgentName(run).trim().toLowerCase();
    if (!key) continue;

    const failed = run.status === 'failed';
    const entry = map.get(key) || {
      lastLine: '',
      tone: 'good' as const,
      completed24h: 0,
      failed24h: 0,
      costUsd24h: 0,
      lastMs: -1,
    };
    if (failed) entry.failed24h += 1; else entry.completed24h += 1;
    entry.costUsd24h += toFiniteNumber(run.estimated_cost);

    if (endedMs > entry.lastMs) {
      entry.lastMs = endedMs;
      const title = truncateText(
        (typeof run.title === 'string' && run.title.trim()) || 'Untitled run',
        ACCOUNTABILITY_TITLE_MAX,
      );
      entry.lastLine = `${failed ? '❌' : '✅'} ${title} · ${formatRelativeTime(nowMs - endedMs)}`;
      entry.tone = failed ? 'danger' : 'good';
    }
    map.set(key, entry);
  }

  const out = new Map<string, OfficeAgentAccountability>();
  for (const [key, entry] of map) {
    out.set(key, {
      lastLine: entry.lastLine,
      tone: entry.tone,
      completed24h: entry.completed24h,
      failed24h: entry.failed24h,
      costUsd24h: round2(entry.costUsd24h),
    });
  }
  return out;
}

/** Compact chip suffix for the desktop quick bar: "✓3 ✗1" (empty when nothing). */
export function formatAccountabilityCounts(entry: OfficeAgentAccountability | null | undefined): string {
  if (!entry) return '';
  const parts: string[] = [];
  if (entry.completed24h > 0) parts.push(`✓${entry.completed24h}`);
  if (entry.failed24h > 0) parts.push(`✗${entry.failed24h}`);
  return parts.join(' ');
}
