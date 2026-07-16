// runFreshnessCore — the PURE, SHARED "is this run alive right now?" brain.
//
// FINDING 2 (docs/CHAT_OFFICE_FEED_NEXT_GAPS.md): a single `agent_runs` row is
// read by Chat, Office, and Feed on three independent cadences, so the SAME live
// run shows THREE different freshnesses ("realtime-fresh in Office, up-to-10s
// stale in Feed, up-to-60s stale for Office's blocked strip"). Worse, Feed's
// `ActiveRunsWidget` returns `null` when the set is empty (`FeedTab.tsx`
// `if (runs.length === 0) return null`), so a run that just finished — or a
// momentary poll gap — simply VANISHES with no affordance.
//
// This core is the one place all three surfaces agree on two questions:
//   1. HOW FRESH is this run? — `classifyRunFreshness` buckets one run into
//      live → recent → idle → stale → done → unknown from its status + last
//      update time, so every surface paints the identical dot/label from one DB
//      row (no more contradictory "what's happening right now").
//   2. WHAT DO WE SHOW when there are no runs (yet)? — `runEmptyStateModel`
//      returns an explicit loading / empty / error / has_data state + copy so a
//      surface renders a real "no active runs" affordance instead of `null`.
//
// GROUNDING: statuses mirror `RunStatus` in `src/lib/agentRunSystem.ts`
// ('queued'|'planning'|'running'|'waiting_approval'|'paused'|'completed'|'failed'
// |'cancelled'); `updatedAtMs` is `Date.parse(agent_runs.updated_at)` (that
// column is stamped on every status/metadata write — agentRunSystem.ts:193,220).
//
// PURITY: zero imports, tsx-loadable (smoke: run-freshness-core). No `Date.now`
// / `Math.random` anywhere — the caller injects `nowMs` so classification is
// deterministic. Every export is TOTAL: any null / undefined / wrong-typed /
// huge / hostile / cyclic input degrades to a documented safe neutral and NEVER
// throws. Every string it emits is bounded. It leaks no secrets (it only ever
// reflects a bounded, control-char-stripped error *message*, never object guts).

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * One shared liveness bucket for a run, ordered most-alive → over → unknowable:
 *  - 'live'    — active status, updated within the last ~90s (pulsing now).
 *  - 'recent'  — active status, updated within the last ~5m (moving, not pulsing).
 *  - 'idle'    — active status, quiet for ~5–30m (probably waiting/wedged).
 *  - 'stale'   — active status, quiet >30m (almost certainly orphaned/dead).
 *  - 'done'    — terminal status (completed | failed | cancelled): the run is over.
 *  - 'unknown' — status is missing/unrecognized: liveness cannot be asserted.
 */
export type RunFreshness = 'live' | 'recent' | 'idle' | 'stale' | 'done' | 'unknown';

export interface RunFreshnessResult {
  /** The shared bucket every surface should paint from. */
  freshness: RunFreshness;
  /** Short, bounded, human label (e.g. 'Live', 'Idle · 10m', 'Done', 'Failed'). */
  label: string;
  /** ms since the last update (`nowMs - updatedAtMs`, clamped ≥ 0); null if uncomputable. */
  ageMs: number | null;
}

export interface RunEmptyState {
  kind: 'loading' | 'empty' | 'error' | 'has_data';
  /** Bounded copy to render (empty string for 'has_data' — the caller shows the list). */
  message: string;
}

// ── Shared thresholds (one source of truth for all three surfaces) ─────────────
// Exported so Chat/Office/Feed classify AND colour/sort from identical numbers.

/** ≤ this since last update ⇒ 'live' (Feed polls ~10s; Office is realtime). */
export const LIVE_WINDOW_MS = 90_000; // 90s
/** ≤ this ⇒ 'recent' (active, updated within a few minutes). */
export const RECENT_WINDOW_MS = 300_000; // 5m
/** ≤ this ⇒ 'idle'; beyond it an active-status run is 'stale' (likely orphaned). */
export const IDLE_WINDOW_MS = 1_800_000; // 30m

// Grounded in RunStatus (agentRunSystem.ts:18). 'canceled' is accepted as a
// spelling variant of 'cancelled'; nothing else is invented.
const ACTIVE_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'planning',
  'running',
  'waiting_approval',
  'paused',
]);
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'cancelled',
  'canceled',
]);

// Fixed sort/emphasis order shared across surfaces (lower = more alive/urgent).
const FRESHNESS_RANK: Readonly<Record<RunFreshness, number>> = {
  live: 0,
  recent: 1,
  idle: 2,
  stale: 3,
  done: 4,
  unknown: 5,
};

// ── Internal guards (total, no throw) ──────────────────────────────────────────

/** A real finite number, or null. Strings/booleans/Dates are NOT coerced. */
function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Lower-cased, trimmed status token; '' for any non-string. */
function normStatus(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().toLowerCase();
}

/**
 * Deliberately coarse age phrasing for a label ('now', '45s', '10m', '2h',
 * '3d'). Bounded output (caps at '999d') — this is a status hint, not a clock.
 */
function coarseAge(ms: number): string {
  const m = Math.max(0, Math.floor(typeof ms === 'number' && Number.isFinite(ms) ? ms : 0));
  if (m < 1_000) return 'now';
  const sec = Math.round(m / 1_000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(m / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.round(m / 3_600_000);
  if (hr < 48) return `${hr}h`;
  const day = Math.round(m / 86_400_000);
  return `${day > 999 ? 999 : day}d`;
}

// ── classifyRunFreshness ────────────────────────────────────────────────────────

/**
 * Bucket ONE run into the shared freshness scale so every surface agrees.
 *
 * Rules:
 *  - terminal status (completed | failed | cancelled) → 'done' (age optional).
 *  - active status + fresh update  → 'live' / 'recent' / 'idle' / 'stale' by age.
 *  - active status but no usable timestamp → 'recent' ("active, freshness
 *    unknown") — non-alarming and does not over-claim 'live'.
 *  - unrecognized/missing status → 'unknown'.
 *
 * `ageMs` = `nowMs - updatedAtMs`, clamped ≥ 0 (future skew ⇒ 0), or null when
 * either timestamp is missing/invalid. Total: never throws.
 */
export function classifyRunFreshness(input: {
  status?: unknown;
  updatedAtMs?: unknown;
  nowMs?: unknown;
}): RunFreshnessResult {
  try {
    const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    const status = normStatus(src.status);
    const now = finiteOrNull(src.nowMs);
    const upd = finiteOrNull(src.updatedAtMs);

    // Age is only meaningful when BOTH timestamps are real numbers.
    const ageMs: number | null =
      now !== null && upd !== null ? Math.max(0, now - upd) : null;

    // Terminal: the run is over regardless of how long ago.
    if (TERMINAL_STATUSES.has(status)) {
      const label = status === 'failed' ? 'Failed' : status === 'completed' ? 'Done' : 'Cancelled';
      return { freshness: 'done', label, ageMs };
    }

    // Active but recognized status → bucket by age.
    if (ACTIVE_STATUSES.has(status)) {
      if (ageMs === null) {
        // Known-active, but we cannot measure freshness → safe, present-tense neutral.
        return { freshness: 'recent', label: 'Active', ageMs: null };
      }
      if (ageMs <= LIVE_WINDOW_MS) return { freshness: 'live', label: 'Live', ageMs };
      if (ageMs <= RECENT_WINDOW_MS) return { freshness: 'recent', label: 'Active', ageMs };
      if (ageMs <= IDLE_WINDOW_MS) return { freshness: 'idle', label: `Idle · ${coarseAge(ageMs)}`, ageMs };
      return { freshness: 'stale', label: `Stale · ${coarseAge(ageMs)}`, ageMs };
    }

    // Unrecognized / missing status: liveness genuinely cannot be asserted.
    return { freshness: 'unknown', label: 'Unknown', ageMs };
  } catch {
    return { freshness: 'unknown', label: 'Unknown', ageMs: null };
  }
}

// ── runEmptyStateModel ──────────────────────────────────────────────────────────

const MAX_ERR_LEN = 120;

/**
 * Extract a bounded, control-char-stripped error *message* for display. Reads
 * only a string error or `.message` (never object internals), caps length, and
 * degrades to '' on anything unusable — so it can't dump secrets or throw on a
 * hostile getter / cyclic object.
 */
function safeErrorText(err: unknown): string {
  try {
    let raw = '';
    if (typeof err === 'string') {
      raw = err;
    } else if (err && typeof err === 'object') {
      const m = (err as Record<string, unknown>).message;
      if (typeof m === 'string') raw = m;
    }
    if (!raw) return '';
    let cleaned = '';
    for (let i = 0; i < raw.length && cleaned.length <= MAX_ERR_LEN; i += 1) {
      const c = raw.charCodeAt(i);
      cleaned += c < 32 || c === 127 ? ' ' : raw[i];
    }
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    if (cleaned.length > MAX_ERR_LEN) cleaned = `${cleaned.slice(0, MAX_ERR_LEN - 1).trimEnd()}…`;
    return cleaned;
  } catch {
    return '';
  }
}

/**
 * True only when we can POSITIVELY confirm the run set is non-empty. Count-aware
 * so an EMPTY array (truthy in JS!) is correctly treated as "no data".
 *  - array  → length > 0
 *  - number → finite && > 0 (a count)
 *  - boolean→ itself
 *  - string → non-blank (a count string)
 *  - else   → false (cannot confirm ⇒ fail toward empty/loading, never fake data)
 */
function hasDataFlag(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'number') return Number.isFinite(v) && v > 0;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.trim().length > 0;
  return false;
}

/** Generic "is this flag/error present?" truthiness (0, '', 'false' ⇒ absent). */
function presentFlag(v: unknown): boolean {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) && v !== 0;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    return !(s === '' || s === 'false' || s === '0' || s === 'no' || s === 'null' || s === 'undefined');
  }
  return true; // Error objects, arrays, other non-null values are "present".
}

/**
 * Decide the loading / empty / error / has_data state for a runs list so a
 * surface renders a REAL state instead of `null` when idle (Finding 2's fix for
 * Feed's `ActiveRunsWidget`).
 *
 * Precedence is DATA-FIRST — once we have runs, keep showing them so a routine
 * background poll error/refresh can't blank a live widget:
 *   has_data  >  error  >  loading  >  empty
 *
 * Total: never throws; every message is bounded.
 */
export function runEmptyStateModel(input: {
  hasRuns?: unknown;
  loading?: unknown;
  error?: unknown;
}): RunEmptyState {
  try {
    const src = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    if (hasDataFlag(src.hasRuns)) return { kind: 'has_data', message: '' };
    if (presentFlag(src.error)) {
      const reason = safeErrorText(src.error);
      return { kind: 'error', message: reason ? `Couldn't load runs: ${reason}` : "Couldn't load runs." };
    }
    if (presentFlag(src.loading)) return { kind: 'loading', message: 'Loading runs…' };
    return { kind: 'empty', message: 'No active runs right now.' };
  } catch {
    return { kind: 'empty', message: 'No active runs right now.' };
  }
}

// ── freshnessRank ───────────────────────────────────────────────────────────────

/**
 * Stable sort/emphasis order shared by every surface (lower = more alive):
 * live(0) < recent(1) < idle(2) < stale(3) < done(4) < unknown(5). Any
 * unrecognized value ranks last (5). Uses own-property lookup so hostile keys
 * like 'toString' cannot leak an inherited value. Total: never throws.
 */
export function freshnessRank(freshness: unknown): number {
  if (typeof freshness === 'string' && Object.prototype.hasOwnProperty.call(FRESHNESS_RANK, freshness)) {
    return FRESHNESS_RANK[freshness as RunFreshness];
  }
  return 5;
}
