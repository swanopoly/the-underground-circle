// taskPriorityScoreCore — the PURE scoring brain that ranks tasks for the Feed /
// mission board. Given a task's due date, importance, how many other tasks it
// blocks, its effort, and its age, it produces a single 0..100 priority score
// (plus a breakdown of every contributing factor) and a deterministic ranking.
//
// This is what decides "what should the team / agents work on next" ordering in
// the Feed and on the mission board. It is intentionally a dependency-free,
// deterministic function so the same task list always sorts the same way and so
// it can be reasoned about, smoke-tested, and reused across surfaces.
//
// PURITY: zero imports, tsx-loadable (smoke: task-priority-score-core). Every
// function takes `now` (epoch ms) from the caller so it stays deterministic; it
// never reads the clock, never calls Math.random, never does I/O, and NEVER
// throws. Missing / malformed fields fall back to neutral defaults.

export interface ScorableTask {
  id: string;
  /** Epoch ms the task is due. Absent → treated as "no deadline" (neutral/low). */
  dueAt?: number;
  /** Estimated effort in minutes. Shorter → a small "quick win" boost. */
  effortMinutes?: number;
  /** How many OTHER tasks are blocked by (depend on) this one. */
  blocking?: number;
  /** Epoch ms the task was created. Older → a small aging boost. */
  createdAt?: number;
  importance?: 'low' | 'medium' | 'high';
  /** Free-form status; terminal values ('done'|'completed'|'cancelled') → score 0. */
  status?: string;
}

export interface TaskScore {
  id: string;
  /** Final priority, clamped to [0, MAX_SCORE]. Higher = do sooner. */
  score: number;
  /** Every normalized factor (each in [0,1]) plus the final `score`, for UI/debug. */
  factors: Record<string, number>;
}

// ── Tunable constants (all documented; safe to adjust) ────────────────────────

/** Final score is clamped to [0, MAX_SCORE]. */
export const MAX_SCORE = 100;

/**
 * Factor weights. Each raw factor is normalized to [0,1] first, then multiplied
 * by its weight; the weighted sum is normalized by the total weight and scaled
 * to MAX_SCORE. Relative size is what matters, not the absolute numbers.
 */
export const FACTOR_WEIGHTS = {
  urgency: 0.35, // due-date pressure — the dominant driver
  importance: 0.25, // explicit priority label
  blocking: 0.22, // unblocking other work is high-leverage
  effort: 0.1, // quick-win nudge (kept small so it can't dominate)
  age: 0.08, // gentle anti-staleness so old tasks surface
} as const;

/**
 * Urgency horizon: a task due this many ms from `now` scores ~0 urgency; as the
 * deadline approaches urgency ramps toward 1, and anything overdue pins at 1.
 * 7 days — a due date a week out barely registers; due "today" is near-max.
 */
export const URGENCY_HORIZON_MS = 7 * 24 * 60 * 60 * 1000;
/** Urgency for a task with no due date at all (neutral-low). */
export const URGENCY_NO_DUE = 0.15;

/** Blocking normalization: `blocking` count that already earns ~max blocking
 *  factor. We use a log-ish curve so 0→1 matters a lot and 8→16 barely differs. */
export const BLOCKING_SATURATION = 8;

/** Effort quick-win curve: a task at/under this many minutes gets ~max quick-win
 *  boost; longer tasks taper toward 0. Unknown effort → neutral (0.5). */
export const EFFORT_QUICK_WIN_MINUTES = 30;
/** Effort at/above this many minutes gets ~0 quick-win boost. */
export const EFFORT_SLOW_MINUTES = 8 * 60;
/** Effort factor when effortMinutes is missing/invalid (neutral, no opinion). */
export const EFFORT_NEUTRAL = 0.5;

/** Age normalization: a task this old (ms) earns ~max aging boost. 14 days. */
export const AGE_SATURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** Statuses that mean "this task is out of the running" → score 0. */
export const TERMINAL_STATUSES = new Set(['done', 'completed', 'cancelled', 'canceled']);

// ── Guards ────────────────────────────────────────────────────────────────────

/** Finite number or `fallback`. Non-numbers, NaN, ±Infinity → fallback. */
function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Clamp x into [lo, hi]; NaN → lo. */
function clamp(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x)) return lo;
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function isTerminal(status: unknown): boolean {
  return typeof status === 'string' && TERMINAL_STATUSES.has(status.trim().toLowerCase());
}

// ── Individual factor calculations (each returns a value in [0,1]) ────────────

/** Urgency: 1 when overdue, ramping down to ~0 as the due date recedes past the
 *  horizon. No due date → a fixed neutral-low value. */
function urgencyFactor(dueAt: unknown, now: number): number {
  if (typeof dueAt !== 'number' || !Number.isFinite(dueAt)) return URGENCY_NO_DUE;
  const msUntilDue = dueAt - now;
  if (msUntilDue <= 0) return 1; // due or overdue → maximum urgency
  // Linear ramp from 1 (due now) down to 0 (a full horizon away or further).
  const fraction = 1 - msUntilDue / URGENCY_HORIZON_MS;
  return clamp(fraction, 0, 1);
}

const IMPORTANCE_FACTOR: Record<'low' | 'medium' | 'high', number> = {
  low: 0.2,
  medium: 0.5,
  high: 1,
};

/** Importance: high/medium/low → fixed points; anything else → medium. */
function importanceFactor(importance: unknown): number {
  if (importance === 'low' || importance === 'medium' || importance === 'high') {
    return IMPORTANCE_FACTOR[importance];
  }
  return IMPORTANCE_FACTOR.medium; // default
}

/** Blocking: log-ish saturating curve so the first few blocked tasks matter most.
 *  0 blocked → 0; >= saturation → ~1. Negative / invalid → 0. */
function blockingFactor(blocking: unknown): number {
  const n = Math.max(0, Math.floor(finiteOr(blocking, 0)));
  if (n <= 0) return 0;
  // log1p(n) / log1p(saturation) gives a diminishing-returns curve capped at 1.
  return clamp(Math.log1p(n) / Math.log1p(BLOCKING_SATURATION), 0, 1);
}

/** Effort quick-win: short tasks → ~1, long tasks → ~0, unknown → neutral. */
function effortFactor(effortMinutes: unknown): number {
  if (typeof effortMinutes !== 'number' || !Number.isFinite(effortMinutes)) return EFFORT_NEUTRAL;
  const minutes = Math.max(0, effortMinutes);
  if (minutes <= EFFORT_QUICK_WIN_MINUTES) return 1;
  if (minutes >= EFFORT_SLOW_MINUTES) return 0;
  // Linear taper between the quick-win threshold and the slow threshold.
  const span = EFFORT_SLOW_MINUTES - EFFORT_QUICK_WIN_MINUTES;
  return clamp(1 - (minutes - EFFORT_QUICK_WIN_MINUTES) / span, 0, 1);
}

/** Age: older tasks earn a gentle boost, saturating at AGE_SATURATION_MS. A
 *  createdAt in the future (clock skew) or missing → 0. */
function ageFactor(createdAt: unknown, now: number): number {
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return 0;
  const ageMs = now - createdAt;
  if (ageMs <= 0) return 0;
  return clamp(ageMs / AGE_SATURATION_MS, 0, 1);
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Sum of all factor weights (denominator for normalization). */
const TOTAL_WEIGHT =
  FACTOR_WEIGHTS.urgency +
  FACTOR_WEIGHTS.importance +
  FACTOR_WEIGHTS.blocking +
  FACTOR_WEIGHTS.effort +
  FACTOR_WEIGHTS.age;

function zeroFactors(): Record<string, number> {
  return { urgency: 0, importance: 0, blocking: 0, effort: 0, age: 0, score: 0 };
}

/**
 * Score a single task in [0, MAX_SCORE]. Terminal statuses short-circuit to 0
 * with all factors zeroed. Never throws — a `null`/`undefined`/garbage task
 * yields a safe neutral score built from defaults. Deterministic in `now`.
 */
export function scoreTask(taskRaw: ScorableTask, nowRaw: number): TaskScore {
  const task = (taskRaw ?? {}) as ScorableTask;
  const id = typeof task.id === 'string' ? task.id : String((task as any)?.id ?? '');
  const now = finiteOr(nowRaw, 0);

  if (isTerminal(task.status)) {
    return { id, score: 0, factors: zeroFactors() };
  }

  const urgency = urgencyFactor(task.dueAt, now);
  const importance = importanceFactor(task.importance);
  const blocking = blockingFactor(task.blocking);
  const effort = effortFactor(task.effortMinutes);
  const age = ageFactor(task.createdAt, now);

  const weighted =
    urgency * FACTOR_WEIGHTS.urgency +
    importance * FACTOR_WEIGHTS.importance +
    blocking * FACTOR_WEIGHTS.blocking +
    effort * FACTOR_WEIGHTS.effort +
    age * FACTOR_WEIGHTS.age;

  // Normalize by total weight (→ [0,1]) then scale + clamp to [0, MAX_SCORE].
  const normalized = TOTAL_WEIGHT > 0 ? weighted / TOTAL_WEIGHT : 0;
  const score = clamp(normalized * MAX_SCORE, 0, MAX_SCORE);

  return {
    id,
    score,
    factors: {
      urgency: clamp(urgency, 0, 1),
      importance: clamp(importance, 0, 1),
      blocking: clamp(blocking, 0, 1),
      effort: clamp(effort, 0, 1),
      age: clamp(age, 0, 1),
      score,
    },
  };
}

/**
 * Score every task and return them ranked. Ordering: descending by `score`;
 * ties broken by `id` ascending (localeCompare) so the sort is stable and fully
 * deterministic regardless of input order. Never throws — a non-array input, or
 * individual garbage entries, are handled defensively.
 */
export function rankTasks(tasksRaw: ScorableTask[], nowRaw: number): TaskScore[] {
  const now = finiteOr(nowRaw, 0);
  const list = Array.isArray(tasksRaw) ? tasksRaw : [];
  const scored = list.map((t) => scoreTask(t, now));
  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score; // higher score first
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; // tie-break: id ascending
  });
}
