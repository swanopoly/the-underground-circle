/**
 * runHistoryFilterCore — pure search/filter/stats core for the Run History
 * drawer sidebar (RunHistoryDrawer.tsx).
 *
 * Three responsibilities, all pure and total:
 *
 *  1. bucketRunStatus(status) — collapse the app's RunStatus vocabulary
 *     ('queued' | 'planning' | 'running' | 'waiting_approval' | 'paused' |
 *     'completed' | 'failed' | 'cancelled', plus legacy/edge variants) into
 *     four compatibility buckets: 'running' (the broad in-flight family), 'succeeded'
 *     (completed), 'failed' (failed/error + the isWastedRunStatus family:
 *     max-iteration, timeout), 'other' (cancelled + anything unrecognized).
 *
 *  2. filterAndStatRuns(runs, {query, statusFilter, nowMs}) — client-side
 *     text search over the run-row display fields the drawer actually renders
 *     (title, goal, mode, agent_id, model, provider, delegated_to, status)
 *     plus time-aware bucket filtering, and a stats header composing the REAL
 *     rollupRunCosts + isWastedRunStatus from runCostRollupCore:
 *     {count, succeeded, failed, running, other, successPct, totalUsd,
 *     todayUsd, wastedUsd}. With a valid `nowMs`, the UI's Active bucket is
 *     deliberately narrower than the compatibility family: only fresh
 *     `planning`/`running` rows qualify; queued/paused/waiting rows are Other.
 *     Stats are computed over the FULL input list
 *     (the header is a rollup of loaded history; the filter only narrows the
 *     visible list). With no query and statusFilter 'all', `visible` is the
 *     input rows in the input order (object rows only), so the drawer's
 *     default render is unchanged.
 *
 *  3. classifyStaleRunCancelReceipt(rows, expected) — validate the exact
 *     one-row PostgREST receipt for an explicit stale-run cancellation. A
 *     zero-row compare-and-set is a conflict, never success.
 *
 *  4. classify/aggregate Realtime state — fail closed unless both selected-run
 *     channels report subscribed.
 *
 *  5. formatRunHistoryStatsLine(stats) — the exact compact header line
 *     ('12 runs · 9✓ 3✗ (75%) · $4.21 today · $0.90 wasted') so the smoke can
 *     pin it and the bar component stays presentation-only.
 *
 * Purity: imports only the pure runCostRollupCore. Loads under tsx for the
 * smoke. Every export is total — null / undefined / wrong-type / hostile
 * input yields a safe neutral value and never throws.
 */

import { isWastedRunStatus, rollupRunCosts } from './runCostRollupCore';
import { classifyRunFreshness } from './runFreshnessCore';

// ── Types ────────────────────────────────────────────────────────────────────

export type RunStatusBucket = 'running' | 'succeeded' | 'failed' | 'other';
export type RunStatusFilter = RunStatusBucket | 'all';
export type RunHistoryRealtimeState = 'connecting' | 'live' | 'unavailable';

/** Fail-closed projection of Supabase Realtime's channel status callback. */
export function classifyRunHistoryRealtimeStatus(status: unknown): RunHistoryRealtimeState {
  return status === 'SUBSCRIBED' ? 'live' : 'unavailable';
}

/** Both selected-run channels must be subscribed before the snapshot is live. */
export function aggregateRunHistoryRealtimeState(
  runState: RunHistoryRealtimeState,
  stepState: RunHistoryRealtimeState,
): RunHistoryRealtimeState {
  if (runState === 'unavailable' || stepState === 'unavailable') return 'unavailable';
  return runState === 'live' && stepState === 'live' ? 'live' : 'connecting';
}

/**
 * Structural subset of agentRunSystem's AgentRun that this core reads.
 * Kept structural (not imported) so the core stays pure/tsx-loadable —
 * agentRunSystem pulls in the Supabase client.
 */
export interface RunHistoryRunLike {
  id?: string;
  title?: string;
  goal?: string;
  mode?: string;
  status?: string;
  agent_id?: string;
  model?: string;
  provider?: string;
  delegated_to?: string;
  surface?: string;
  estimated_cost?: number;
  created_at?: string;
  started_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}

export interface RunHistoryStats {
  /** Number of valid (object) run rows in the full input list. */
  count: number;
  succeeded: number;
  failed: number;
  running: number;
  other: number;
  /**
   * Success percentage over TERMINAL runs only (succeeded + failed), rounded
   * to a whole number; 0 when there are no terminal runs. In-flight and
   * cancelled runs neither help nor hurt the percentage.
   */
  successPct: number;
  /** Total estimated spend (rollupRunCosts.totalUsd) across the full list. */
  totalUsd: number;
  /** Spend on runs created "today" per nowMs (UTC calendar day). */
  todayUsd: number;
  /** Spend on failed/max-iteration/timeout runs (rollupRunCosts.wastedUsd). */
  wastedUsd: number;
}

export interface RunHistoryFilterResult {
  visible: RunHistoryRunLike[];
  stats: RunHistoryStats;
}

export type StaleRunCancelReceiptExpectation = Readonly<{
  runId: string;
  circleId: string;
  userId: string;
  cancelledAt: string;
}>;

export type StaleRunCancelReceipt =
  | Readonly<{ ok: true; row: Record<string, unknown> }>
  | Readonly<{ ok: false; reason: 'no_match' | 'invalid_response' }>;

export type ExactRunMutationAuthorityLike = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export const EMPTY_RUN_HISTORY_STATS: RunHistoryStats = Object.freeze({
  count: 0,
  succeeded: 0,
  failed: 0,
  running: 0,
  other: 0,
  successPct: 0,
  totalUsd: 0,
  todayUsd: 0,
  wastedUsd: 0,
});

/**
 * Accept a stale-run cancellation receipt only when PostgREST returned exactly
 * the row and terminal timestamps the guarded UPDATE requested. In particular,
 * `[]` means the compare-and-set lost (status/liveness/scope changed) and must
 * remain a visible failure in the drawer.
 */
export function classifyStaleRunCancelReceipt(
  rows: unknown,
  expected: StaleRunCancelReceiptExpectation | null | undefined,
): StaleRunCancelReceipt {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected)) {
    return { ok: false, reason: 'invalid_response' };
  }
  if (!Array.isArray(rows)) return { ok: false, reason: 'invalid_response' };
  if (rows.length === 0) return { ok: false, reason: 'no_match' };
  if (rows.length !== 1) return { ok: false, reason: 'invalid_response' };
  const row = rows[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { ok: false, reason: 'invalid_response' };
  }
  const record = row as Record<string, unknown>;
  const expectedCancelledAtMs = typeof expected.cancelledAt === 'string'
    ? Date.parse(expected.cancelledAt)
    : Number.NaN;
  const updatedAtMs = typeof record.updated_at === 'string' ? Date.parse(record.updated_at) : Number.NaN;
  const completedAtMs = typeof record.completed_at === 'string' ? Date.parse(record.completed_at) : Number.NaN;
  if (
    record.id !== expected.runId
    || record.circle_id !== expected.circleId
    || record.user_id !== expected.userId
    || record.status !== 'cancelled'
    || !Number.isFinite(expectedCancelledAtMs)
    || !Number.isFinite(updatedAtMs)
    || !Number.isFinite(completedAtMs)
    || updatedAtMs !== expectedCancelledAtMs
    || completedAtMs !== expectedCancelledAtMs
  ) {
    return { ok: false, reason: 'invalid_response' };
  }
  return { ok: true, row: record };
}

/** Pure value fence used by the mounted auth hook before its live scope checks. */
export function isExactRunMutationAuthorityCurrent(
  captured: ExactRunMutationAuthorityLike | null | undefined,
  current: ExactRunMutationAuthorityLike | null | undefined,
): boolean {
  const boundedPart = (value: unknown, max: number): value is string => (
    typeof value === 'string'
    && value.length > 0
    && value.length <= max
    && value.trim() === value
  );
  return Boolean(
    captured
    && current
    && boundedPart(captured.userId, 240)
    && boundedPart(captured.circleId, 240)
    && boundedPart(captured.accessToken, 16_384)
    && captured.userId === current.userId
    && captured.circleId === current.circleId
    && captured.accessToken === current.accessToken
    && Number.isSafeInteger(captured.generation)
    && captured.generation > 0
    && captured.generation === current.generation
  );
}

// ── Status buckets ───────────────────────────────────────────────────────────

const RUNNING_STATUSES = new Set(['queued', 'planning', 'running', 'waiting_approval', 'paused']);
const PROCESSING_HISTORY_STATUSES = new Set(['planning', 'running']);

/** Collapse any run status value into one of the four sidebar filter buckets. */
export function bucketRunStatus(status: unknown): RunStatusBucket {
  if (typeof status !== 'string') return 'other';
  const s = status.toLowerCase().trim();
  if (!s) return 'other';
  if (RUNNING_STATUSES.has(s)) return 'running';
  if (s === 'completed' || s === 'succeeded' || s === 'success') return 'succeeded';
  // failed / error / errored / max-iteration / timeout family — reuse the
  // real waste predicate so the failed bucket and wastedUsd agree.
  if (isWastedRunStatus(s)) return 'failed';
  return 'other'; // cancelled + unknown statuses
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * History-aware bucket: only fresh processing work (`planning`/`running`) is
 * ACTIVE. Queued, paused, approval-waiting, timestamp-less, and stale rows
 * belong in OTHER. `bucketRunStatus` remains the broad status-only
 * compatibility helper for callers that do not possess timestamps.
 */
export function bucketRunForHistory(run: unknown, nowMs: unknown): RunStatusBucket {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return 'other';
  const row = run as RunHistoryRunLike;
  const statusBucket = bucketRunStatus(row.status);
  if (statusBucket !== 'running') return statusBucket;
  if (typeof nowMs !== 'number' || !Number.isFinite(nowMs)) return statusBucket;
  const status = typeof row.status === 'string' ? row.status.toLowerCase().trim() : '';
  // The status-only compatibility bucket above treats every in-flight state as
  // one family. The actual Office ACTIVE view is intentionally stricter:
  // queued work has not started, while paused/waiting work is not processing.
  if (!PROCESSING_HISTORY_STATUSES.has(status)) return 'other';
  const updatedAtMs = timestampMs(row.updated_at)
    ?? timestampMs(row.started_at)
    ?? timestampMs(row.created_at);
  if (updatedAtMs === null) return 'other';
  const freshness = classifyRunFreshness({ status: row.status, updatedAtMs, nowMs });
  return freshness.freshness === 'stale' ? 'other' : 'running';
}

export function describeRunHistoryStatus(run: unknown, nowMs: unknown): {
  bucket: RunStatusBucket;
  label: string;
  stale: boolean;
} {
  if (!run || typeof run !== 'object' || Array.isArray(run)) {
    return { bucket: 'other', label: 'UNKNOWN', stale: false };
  }
  const row = run as RunHistoryRunLike;
  const bucket = bucketRunForHistory(row, nowMs);
  const rawStatus = typeof row.status === 'string' && row.status.trim()
    ? row.status.trim().toUpperCase()
    : 'UNKNOWN';
  if (bucket !== 'other' || bucketRunStatus(row.status) !== 'running') {
    return { bucket, label: rawStatus, stale: false };
  }
  const updatedAtMs = timestampMs(row.updated_at)
    ?? timestampMs(row.started_at)
    ?? timestampMs(row.created_at);
  const freshness = classifyRunFreshness({ status: row.status, updatedAtMs, nowMs });
  const normalizedStatus = typeof row.status === 'string' ? row.status.toLowerCase().trim() : '';
  if (freshness.freshness !== 'stale') {
    return {
      bucket,
      label: PROCESSING_HISTORY_STATUSES.has(normalizedStatus) && updatedAtMs === null
        ? `${rawStatus} · FRESHNESS UNKNOWN · NOT ACTIVE`
        : `${rawStatus} · NOT ACTIVE`,
      stale: false,
    };
  }
  return {
    bucket,
    label: `${freshness.label.toUpperCase()} · NOT ACTIVE`,
    stale: true,
  };
}

// ── Search ───────────────────────────────────────────────────────────────────

const SEARCH_FIELDS: ReadonlyArray<keyof RunHistoryRunLike> = [
  'title', 'goal', 'mode', 'status', 'agent_id', 'model', 'provider', 'delegated_to',
];
const MAX_QUERY_LEN = 200;

function buildHaystack(run: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const field of SEARCH_FIELDS) {
    const value = run[field as string];
    if (typeof value === 'string' && value) parts.push(value.toLowerCase());
  }
  return parts.join(' ');
}

/** Normalize a query into lowercase AND-tokens; hostile input → no tokens. */
function queryTokens(query: unknown): string[] {
  if (typeof query !== 'string') return [];
  const trimmed = query.trim().slice(0, MAX_QUERY_LEN).toLowerCase();
  if (!trimmed) return [];
  return trimmed.split(/\s+/).filter(Boolean);
}

// ── Day keys (UTC calendar day, matching ISO created_at strings) ─────────────

function dayKeyFromCreatedAt(createdAt: unknown): string | undefined {
  if (typeof createdAt !== 'string') return undefined;
  const key = createdAt.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : undefined;
}

function dayKeyFromNowMs(nowMs: unknown): string | undefined {
  const n = typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : NaN;
  if (!Number.isFinite(n)) return undefined;
  try {
    return new Date(n).toISOString().slice(0, 10);
  } catch {
    return undefined; // out-of-range date values throw in toISOString
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────

const MAX_RUNS = 10_000;

export interface RunHistoryFilterOptions {
  query?: unknown;
  statusFilter?: unknown;
  /** "Now" for the todayUsd window; defaults to no today window (todayUsd 0). */
  nowMs?: unknown;
}

/**
 * Filter the drawer's run list and compute the rollup-header stats.
 *
 * - `visible`: rows matching the query (case-insensitive AND over the display
 *   fields) and the status bucket. Default options (no query, 'all') return
 *   every object row in input order — pixel-identical default list.
 * - `stats`: computed over the FULL input list (not the filtered subset), so
 *   the header describes the loaded history regardless of active filters.
 *   Dollar figures come from the real rollupRunCosts over
 *   {surface, status, day(created_at), costUsd(estimated_cost)} projections.
 *
 * Total: non-array runs → empty result; non-object rows are skipped; bounded
 * by MAX_RUNS.
 */
export function filterAndStatRuns(
  runs: unknown,
  options?: RunHistoryFilterOptions,
): RunHistoryFilterResult {
  const opts: Record<string, unknown> =
    options && typeof options === 'object' ? (options as Record<string, unknown>) : {};

  if (!Array.isArray(runs)) {
    return { visible: [], stats: { ...EMPTY_RUN_HISTORY_STATS } };
  }

  const tokens = queryTokens(opts.query);
  const rawFilter = typeof opts.statusFilter === 'string' ? opts.statusFilter : 'all';
  const statusFilter: RunStatusFilter =
    rawFilter === 'running' || rawFilter === 'succeeded' || rawFilter === 'failed' || rawFilter === 'other'
      ? rawFilter
      : 'all';
  const todayKey = dayKeyFromNowMs(opts.nowMs);

  const visible: RunHistoryRunLike[] = [];
  const costRows: Array<{ surface?: string; status?: string; day?: string; costUsd?: number }> = [];
  let count = 0;
  let succeeded = 0;
  let failed = 0;
  let running = 0;
  let other = 0;

  const limit = Math.min(runs.length, MAX_RUNS);
  for (let i = 0; i < limit; i++) {
    const row = runs[i];
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const run = row as RunHistoryRunLike;

    // Stats over the FULL list.
    count += 1;
    const bucket = bucketRunForHistory(run, opts.nowMs);
    if (bucket === 'succeeded') succeeded += 1;
    else if (bucket === 'failed') failed += 1;
    else if (bucket === 'running') running += 1;
    else other += 1;

    costRows.push({
      surface: typeof run.surface === 'string' ? run.surface : undefined,
      status: typeof run.status === 'string' ? run.status : undefined,
      day: dayKeyFromCreatedAt(run.created_at),
      costUsd: typeof run.estimated_cost === 'number' ? run.estimated_cost : undefined,
    });

    // Visibility filter.
    if (statusFilter !== 'all' && bucket !== statusFilter) continue;
    if (tokens.length > 0) {
      const haystack = buildHaystack(run as Record<string, unknown>);
      let matches = true;
      for (const token of tokens) {
        if (!haystack.includes(token)) { matches = false; break; }
      }
      if (!matches) continue;
    }
    visible.push(run);
  }

  const rollup = rollupRunCosts(costRows);
  const terminal = succeeded + failed;
  const successPct = terminal > 0 ? Math.round((succeeded / terminal) * 100) : 0;
  const todayUsd = todayKey && Object.prototype.hasOwnProperty.call(rollup.byDay, todayKey)
    ? rollup.byDay[todayKey]
    : 0;

  return {
    visible,
    stats: {
      count,
      succeeded,
      failed,
      running,
      other,
      successPct,
      totalUsd: rollup.totalUsd,
      todayUsd,
      wastedUsd: rollup.wastedUsd,
    },
  };
}

// ── Header line formatting ───────────────────────────────────────────────────

function formatUsd(n: unknown): string {
  const v = typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0;
  return `$${v.toFixed(2)}`;
}

/**
 * Compact one-line stats summary for the filter bar, e.g.
 * '12 runs · 9✓ 3✗ (75%) · $4.21 today · $0.90 wasted'.
 * The wasted segment is omitted when wastedUsd is 0. Total on any input.
 */
export function formatRunHistoryStatsLine(stats: unknown): string {
  const s: Record<string, unknown> =
    stats && typeof stats === 'object' ? (stats as Record<string, unknown>) : {};
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  const count = Math.floor(num(s.count));
  const succeeded = Math.floor(num(s.succeeded));
  const failed = Math.floor(num(s.failed));
  const successPct = Math.floor(num(s.successPct));
  const wastedUsd = num(s.wastedUsd);

  const parts: string[] = [`${count} run${count === 1 ? '' : 's'}`];
  if (succeeded + failed > 0) parts.push(`${succeeded}✓ ${failed}✗ (${successPct}%)`);
  parts.push(`${formatUsd(s.todayUsd)} today`);
  if (wastedUsd > 0) parts.push(`${formatUsd(wastedUsd)} wasted`);
  return parts.join(' · ');
}
