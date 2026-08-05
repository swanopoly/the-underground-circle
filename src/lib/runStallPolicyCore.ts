/**
 * runStallPolicyCore — pure run-stall / zombie-liveness policy for agent runs.
 *
 * Session-runtime expansion v6. A crashed or abandoned agent process leaves its
 * `agent_runs` row stuck at status `'running'` forever: nothing marks it failed,
 * and live introspection keeps reporting it as active. This core turns the
 * heartbeat column (`updated_at`, bumped by the tool loop) into a truthful
 * liveness signal so a background reaper can mark dead runs failed and callers
 * can tell "really live" from "zombie".
 *
 * Model (reaper-oriented — 'live' means "not a zombie / do not touch"):
 *   - Only a `'running'` run is reapable. Terminal states (completed/failed/
 *     cancelled) and legitimate idle states (queued/planning/waiting_approval/
 *     paused — a human or scheduler is expected, not a heartbeat) are always
 *     'live'.
 *   - For a `'running'` run, age = nowMs - lastHeartbeat, where lastHeartbeat is
 *     `updated_at` (the heartbeat) or, if absent, `started_at`.
 *       age >= RUN_STALL_DEAD_MS  → 'dead'  (reap → status 'failed')
 *       age >= RUN_STALL_STALE_MS → 'stale' (flag; heartbeat aging)
 *       else / can't compute      → 'live'
 *
 * Purity: `nowMs` is always an INPUT — this module never reads the clock, so it
 * is deterministic and safe under tsx/esbuild (no runtime imports). Every export
 * is TOTAL: null / undefined / wrong-type / hostile / huge input yields a safe
 * neutral ('live' / empty plan), never a throw. Fail-safe bias: whenever a run
 * cannot be confidently classified, it is 'live' so the reaper never kills a
 * genuinely active run.
 *
 * WIRING: a background reaper queries recent runs (raw rows, incl. updated_at)
 * and calls `planRunReap(recentRuns, Date.now())`; it marks `toReap` ids failed
 * and may surface `stale` ids as a warning. The tool loop must bump a heartbeat
 * column (`updated_at`) on progress — NOT via `updateRunStatus`, which resets
 * `started_at` when status is 'running' (see agentRunSystem.ts).
 */

export type RunLiveness = 'live' | 'stale' | 'dead';

/** Output of {@link planRunReap}: disjoint id buckets. */
export interface RunReapPlan {
  /** Dead 'running' run ids the reaper should mark failed. */
  toReap: string[];
  /** Stale (aging heartbeat) 'running' run ids to flag but not yet reap. */
  stale: string[];
}

/** A running run is 'stale' once its heartbeat is older than this (2 min). */
export const RUN_STALL_STALE_MS = 2 * 60_000;

/** A running run is 'dead' (reapable → failed) past this (5 min). */
export const RUN_STALL_DEAD_MS = 5 * 60_000;

/** Upper bound on rows scanned by planRunReap so hostile input stays bounded. */
const MAX_RUNS = 5000;

/** Upper bound on an accepted run id (uuids are 36 chars). */
const MAX_ID_LEN = 200;

function toFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Coerce a timestamp-ish value to epoch milliseconds, or null if unusable.
 * Accepts a finite number (already epoch ms), a parseable string (ISO from
 * Postgres), or a Date. Deterministic — parsing does not read the clock.
 */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

/** True only for the reapable in-flight status ('running', case/space tolerant). */
function isRunningStatus(status: unknown): boolean {
  return typeof status === 'string' && status.trim().toLowerCase() === 'running';
}

/**
 * Classify one run's liveness from the reaper's perspective. Totally defensive:
 * any malformed input (including a non-object, invalid nowMs, or unparseable
 * timestamps) resolves to 'live' so nothing gets falsely reaped.
 */
export function classifyRunLiveness(input: {
  status: unknown;
  startedAt: unknown;
  updatedAt: unknown;
  nowMs: number;
}): RunLiveness {
  if (!input || typeof input !== 'object') return 'live';

  const nowMs = toFiniteNumber((input as { nowMs?: unknown }).nowMs);
  if (nowMs === null) return 'live'; // no trustworthy "now" → cannot classify

  if (!isRunningStatus((input as { status?: unknown }).status)) return 'live';

  // Heartbeat is updated_at; fall back to started_at when the row lacks one.
  const lastBeat =
    toEpochMs((input as { updatedAt?: unknown }).updatedAt) ??
    toEpochMs((input as { startedAt?: unknown }).startedAt);
  if (lastBeat === null) return 'live'; // no heartbeat signal → don't reap

  const age = nowMs - lastBeat;
  if (!Number.isFinite(age)) return 'live';
  // Future heartbeat (clock skew) → negative age → 'live' via the < STALE path.
  if (age >= RUN_STALL_DEAD_MS) return 'dead';
  if (age >= RUN_STALL_STALE_MS) return 'stale';
  return 'live';
}

/** Extract a usable, bounded run id from a row, or null. */
function readRunId(row: Record<string, unknown>): string | null {
  const id = row.id;
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_ID_LEN) return null;
  return trimmed;
}

/**
 * Plan a reap pass over a list of run rows: the dead run ids to mark failed
 * (`toReap`) and the stale ids to flag (`stale`). Reads snake_case
 * (`updated_at` / `started_at`) or camelCase timestamps. Ids are de-duplicated
 * and the two buckets are disjoint. Totally defensive: non-array input, invalid
 * `nowMs`, garbage rows, and huge inputs all yield a bounded, safe plan without
 * throwing.
 */
export function planRunReap(runs: unknown, nowMs: number): RunReapPlan {
  const plan: RunReapPlan = { toReap: [], stale: [] };
  if (!Array.isArray(runs)) return plan;

  const now = toFiniteNumber(nowMs);
  if (now === null) return plan;

  const seenReap = new Set<string>();
  const seenStale = new Set<string>();
  const limit = Math.min(runs.length, MAX_RUNS);

  for (let i = 0; i < limit; i += 1) {
    const raw = runs[i];
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;

    const id = readRunId(row);
    if (id === null) continue;
    if (seenReap.has(id) || seenStale.has(id)) continue; // already bucketed

    const liveness = classifyRunLiveness({
      status: row.status,
      startedAt: row.started_at ?? row.startedAt,
      updatedAt: row.updated_at ?? row.updatedAt,
      nowMs: now,
    });

    if (liveness === 'dead') {
      seenReap.add(id);
      plan.toReap.push(id);
    } else if (liveness === 'stale') {
      seenStale.add(id);
      plan.stale.push(id);
    }
  }

  return plan;
}
