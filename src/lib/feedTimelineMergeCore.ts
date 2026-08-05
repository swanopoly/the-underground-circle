/**
 * feedTimelineMergeCore — pure merge/dedupe/retry math for the Feed
 * ActivityFeedPanel timeline.
 *
 * ─── Why this exists ────────────────────────────────────────────────
 * ActivityFeedPanel historically rendered its four Supabase lanes
 * (task_runs, automation_runs, agent_activity, proof_of_work) as four
 * STACKED blocks, not one chronological feed. A single completed run
 * therefore appeared up to three times (task_runs row + agent_activity
 * 'task_completed' row + proof_of_work card), and the proof card — the
 * richest rendering — sat at the very bottom below up to 60 activity rows.
 *
 * `buildFeedTimeline` merges the four lanes into ONE bounded, time-desc
 * list and dedupes items that share a run identity, with the richest
 * representation winning: proof > activity > task_run.
 *
 * ─── Dedupe key design ──────────────────────────────────────────────
 * Each row is probed for a run identity:
 *   - task_runs        → `openswan_run_id`,   `task_id`
 *   - proof_of_work    → `detail.run_id`,     `detail.task_id`
 *   - agent_activity   → `metadata.run_id`,   `metadata.task_id`
 *   - automation_runs  → none (a separate system; never cross-merged)
 *
 * Strong key: `run:<run_id>` — exact match collapses across lanes.
 * Weak key:   `task:<task_id>` — collapses ONLY when the two rows are
 * within TASK_PROXIMITY_MS (5 min) of each other, because one task can
 * legitimately have many runs over time. Rows of the SAME kind never
 * dedupe against each other, and when identity is absent or ambiguous we
 * keep both rather than over-merge.
 *
 * ─── Lane retry policy ──────────────────────────────────────────────
 * The panel used to latch `laneSupportedRef.current = false` on ANY query
 * error, so one transient network blip permanently killed a lane for the
 * session. `decideFeedLaneRetry` is the pure replacement: only
 * schema-permanent errors (Postgres 42P01 undefined_table / 42703
 * undefined_column, PostgREST schema-cache misses, or an equivalent
 * message) disable a lane forever; anything else gets a bounded backoff
 * (2s / 8s / 30s, max 3 scheduled retries) and then stays ENABLED but
 * idle until the next poll / manual refresh. Mirrors the spirit of
 * providerBackoffCore: transient ≠ dead.
 *
 * ─── Purity ─────────────────────────────────────────────────────────
 * No imports, no I/O, no Date.now(). Every export is TOTAL: null /
 * malformed / cyclic rows collapse to safe neutrals (missing timestamps
 * sort to the tail at epoch 0) and never throw.
 */

// ─── Types ───────────────────────────────────────────────────────────

export type FeedTimelineKind = 'proof' | 'activity' | 'task_run' | 'automation_run';

export interface FeedTimelineItem<T = unknown> {
  /** Epoch ms of the row's own timestamp; 0 when missing/unparseable. */
  ts: number;
  kind: FeedTimelineKind;
  /** Identity used for dedupe: `run:<id>` > `task:<id>` > `<kind>:<row id>`.
   *  Descriptive, not guaranteed unique among SURVIVING items (two runs of
   *  one task may both survive) — use kind + row id for React keys. */
  dedupeKey: string;
  /** The original lane row, untouched. */
  row: T;
}

export interface FeedTimelineInput<A, R, T, P> {
  activity?: readonly A[] | null;
  automationRuns?: readonly R[] | null;
  taskRuns?: readonly T[] | null;
  proofs?: readonly P[] | null;
}

export interface FeedTimelineResult<A, R, T, P> {
  items: Array<FeedTimelineItem<A | R | T | P>>;
  /** Items dropped by the total bound (NOT by dedupe). */
  truncatedCount: number;
  /** Items collapsed away because a richer lane already covers the run. */
  dedupedCount: number;
}

export interface FeedLaneRetryDecision {
  /** True only for schema-permanent errors (missing table / column). */
  disableForever: boolean;
  /** Backoff before the next automatic retry; null = no auto retry
   *  scheduled (lane stays enabled and rides the next normal refresh). */
  retryInMs: number | null;
}

// ─── Tunables ────────────────────────────────────────────────────────

/** Default total-item bound for the merged timeline. */
export const FEED_TIMELINE_MAX_ITEMS = 80;

/** Weak-key (task_id) correlation window: two lanes referencing the same
 *  task merge only when their timestamps are within this window. */
export const FEED_TIMELINE_TASK_PROXIMITY_MS = 5 * 60_000;

/** Bounded lane-retry backoff schedule (attempt 1, 2, 3). */
export const FEED_LANE_RETRY_SCHEDULE_MS: readonly number[] = [2_000, 8_000, 30_000];

/** Dedupe precedence: lower = richer = wins. */
const KIND_PRECEDENCE: Record<FeedTimelineKind, number> = {
  proof: 0,
  activity: 1,
  task_run: 2,
  automation_run: 3,
};

// ─── Safe field helpers (total) ──────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === 'object';
}

function safeString(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/** Epoch ms from an ISO-ish string / number; 0 for anything unparseable. */
function toEpochMs(v: unknown): number {
  try {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    if (typeof v === 'string' && v.length > 0) {
      const ms = new Date(v).getTime();
      if (Number.isFinite(ms) && ms > 0) return ms;
    }
  } catch {
    // fall through
  }
  return 0;
}

interface NormalizedItem<T> {
  ts: number;
  kind: FeedTimelineKind;
  runId: string | null;
  taskId: string | null;
  rowId: string;
  dedupeKey: string;
  row: T;
}

/** Extract {runId, taskId, ts, rowId} for one row of a given lane. Total. */
function normalizeRow<T>(kind: FeedTimelineKind, row: T, index: number): NormalizedItem<T> | null {
  if (!isRecord(row)) return null;
  const r = row as Record<string, unknown>;

  let runId: string | null = null;
  let taskId: string | null = null;
  let ts = 0;

  try {
    switch (kind) {
      case 'task_run':
        runId = safeString(r.openswan_run_id);
        taskId = safeString(r.task_id);
        ts = toEpochMs(r.started_at);
        break;
      case 'automation_run':
        // Separate system — deliberately no cross-lane identity.
        ts = toEpochMs(r.started_at);
        break;
      case 'activity': {
        const meta = isRecord(r.metadata) ? r.metadata : null;
        runId = meta ? safeString(meta.run_id) : null;
        taskId = meta ? safeString(meta.task_id) : null;
        ts = toEpochMs(r.created_at);
        break;
      }
      case 'proof': {
        const detail = isRecord(r.detail) ? r.detail : null;
        runId = detail ? safeString(detail.run_id) : null;
        taskId = detail ? safeString(detail.task_id) : null;
        ts = toEpochMs(r.created_at);
        break;
      }
    }
  } catch {
    runId = null;
    taskId = null;
  }

  const rowId = safeString(r.id) || `#${index}`;
  const dedupeKey = runId
    ? `run:${runId}`
    : taskId
      ? `task:${taskId}`
      : `${kind}:${rowId}`;

  return { ts, kind, runId, taskId, rowId, dedupeKey, row };
}

// ─── Merge ───────────────────────────────────────────────────────────

/**
 * Merge the four Feed lanes into one bounded, time-desc, deduped timeline.
 * TOTAL: hostile / malformed / null inputs never throw; malformed rows are
 * skipped, rows without a parseable timestamp sort to the tail (epoch 0).
 */
export function buildFeedTimeline<A, R, T, P>(
  input: FeedTimelineInput<A, R, T, P> | null | undefined,
  opts?: { maxItems?: number; taskProximityMs?: number },
): FeedTimelineResult<A, R, T, P> {
  try {
    const maxItems =
      typeof opts?.maxItems === 'number' && Number.isFinite(opts.maxItems) && opts.maxItems > 0
        ? Math.floor(opts.maxItems)
        : FEED_TIMELINE_MAX_ITEMS;
    const proximityMs =
      typeof opts?.taskProximityMs === 'number' && Number.isFinite(opts.taskProximityMs) && opts.taskProximityMs >= 0
        ? opts.taskProximityMs
        : FEED_TIMELINE_TASK_PROXIMITY_MS;

    const lanes: Array<[FeedTimelineKind, readonly unknown[] | null | undefined]> = [
      ['proof', input?.proofs],
      ['activity', input?.activity],
      ['task_run', input?.taskRuns],
      ['automation_run', input?.automationRuns],
    ];

    // Normalize every row (lanes visited in precedence order so richer
    // representations claim identities first).
    const normalized: Array<NormalizedItem<A | R | T | P>> = [];
    for (const [kind, rows] of lanes) {
      if (!Array.isArray(rows)) continue;
      for (let i = 0; i < rows.length; i++) {
        const item = normalizeRow(kind, rows[i] as A | R | T | P, i);
        if (item) normalized.push(item);
      }
    }

    // Dedupe pass. Strong: exact run_id. Weak: same task_id within the
    // proximity window. Same-kind rows never dedupe each other; when in
    // doubt (no identity) keep both.
    const claimedRuns = new Map<string, FeedTimelineKind>();
    const claimedTasks: Array<{
      taskId: string;
      ts: number;
      kind: FeedTimelineKind;
      runId: string | null;
    }> = [];
    const kept: Array<NormalizedItem<A | R | T | P>> = [];
    let dedupedCount = 0;

    for (const item of normalized) {
      let superseded = false;

      if (item.runId) {
        const claimer = claimedRuns.get(item.runId);
        if (claimer !== undefined && claimer !== item.kind) superseded = true;
      }
      if (!superseded && item.taskId) {
        for (const claim of claimedTasks) {
          // Provably-different runs (both sides carry a run id and they
          // differ) must NOT weak-merge — keep both rather than over-merge.
          const provablyDifferentRun =
            item.runId != null && claim.runId != null && item.runId !== claim.runId;
          if (
            claim.taskId === item.taskId &&
            claim.kind !== item.kind &&
            !provablyDifferentRun &&
            Math.abs(claim.ts - item.ts) <= proximityMs
          ) {
            superseded = true;
            break;
          }
        }
      }

      if (superseded) {
        dedupedCount++;
        continue;
      }
      if (item.runId && !claimedRuns.has(item.runId)) claimedRuns.set(item.runId, item.kind);
      if (item.taskId) {
        claimedTasks.push({ taskId: item.taskId, ts: item.ts, kind: item.kind, runId: item.runId });
      }
      kept.push(item);
    }

    // Time-desc sort; deterministic tie-break by kind precedence then row id.
    kept.sort((a, b) => {
      if (b.ts !== a.ts) return b.ts - a.ts;
      const p = KIND_PRECEDENCE[a.kind] - KIND_PRECEDENCE[b.kind];
      if (p !== 0) return p;
      return a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0;
    });

    const truncatedCount = kept.length > maxItems ? kept.length - maxItems : 0;
    const bounded = truncatedCount > 0 ? kept.slice(0, maxItems) : kept;

    return {
      items: bounded.map((n) => ({ ts: n.ts, kind: n.kind, dedupeKey: n.dedupeKey, row: n.row })),
      truncatedCount,
      dedupedCount,
    };
  } catch {
    return { items: [], truncatedCount: 0, dedupedCount: 0 };
  }
}

// ─── Lane retry policy ───────────────────────────────────────────────

/** Postgres error codes that mean the schema genuinely lacks the lane. */
const SCHEMA_PERMANENT_CODES = new Set(['42P01', '42703']);

/** Message shapes that mean the same thing (PostgREST wraps the code away). */
const SCHEMA_PERMANENT_MESSAGE_PATTERNS: readonly RegExp[] = [
  /relation\s+"[^"]*"\s+does not exist/i,
  /column\s+.*\s+does not exist/i,
  /could not find the\s+(table|column)/i, // PostgREST schema-cache miss
  /schema cache/i,
];

function extractErrorCode(error: unknown): string | null {
  if (!isRecord(error)) return null;
  return safeString((error as Record<string, unknown>).code);
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (isRecord(error)) {
    const m = (error as Record<string, unknown>).message;
    if (typeof m === 'string') return m;
    const d = (error as Record<string, unknown>).details;
    if (typeof d === 'string') return d;
  }
  return '';
}

/**
 * Decide what a Feed lane does after a query error.
 *
 * - Schema-permanent (42P01 / 42703 / schema-cache message) →
 *   `{ disableForever: true, retryInMs: null }` — the table/column really
 *   isn't there; the lane's disabled fallback is correct.
 * - Anything else is treated as transient: attempts 1..3 get the bounded
 *   backoff schedule (2s / 8s / 30s); past the cap the lane stays ENABLED
 *   but schedules nothing (`retryInMs: null`) until the next poll/manual
 *   refresh. A blip must never kill a lane for the session.
 *
 * `attempt` is the 1-based count of consecutive failures INCLUDING this
 * one. TOTAL: hostile error/attempt values collapse to the transient
 * first-attempt decision; never throws.
 */
export function decideFeedLaneRetry(error: unknown, attempt: unknown): FeedLaneRetryDecision {
  try {
    const code = extractErrorCode(error);
    if (code && SCHEMA_PERMANENT_CODES.has(code)) {
      return { disableForever: true, retryInMs: null };
    }
    const message = extractErrorMessage(error);
    if (message) {
      for (const pattern of SCHEMA_PERMANENT_MESSAGE_PATTERNS) {
        if (pattern.test(message)) return { disableForever: true, retryInMs: null };
      }
    }

    let n = 1;
    if (typeof attempt === 'number' && Number.isFinite(attempt) && attempt >= 1) {
      n = Math.floor(attempt);
    }
    if (n > FEED_LANE_RETRY_SCHEDULE_MS.length) {
      return { disableForever: false, retryInMs: null };
    }
    return { disableForever: false, retryInMs: FEED_LANE_RETRY_SCHEDULE_MS[n - 1] };
  } catch {
    return { disableForever: false, retryInMs: FEED_LANE_RETRY_SCHEDULE_MS[0] };
  }
}
