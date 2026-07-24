// deadlineSlaCore — the PURE deadline / SLA brain. It answers two questions the
// accountability loop keeps asking about a task or a recurring watch:
//   1. HOW DOES THIS STAND against its due time right now? — `evaluateSla`
//      buckets a deadline into ok → due_soon → overdue → breached and reports the
//      remaining / overdue milliseconds plus a short human reason.
//   2. WHEN IS THE NEXT RUN of a recurring schedule? — `nextDueAt` computes the
//      next tick strictly after `now`, catching up over any number of missed
//      intervals in O(1) via ceil math (no loop).
//
// PURITY: zero imports, tsx-loadable (smoke: deadline-sla-core). Every function
// takes `now` (epoch ms) from the caller so it stays deterministic — it never
// reads the clock (no Date.now) and never uses randomness. It NEVER throws:
// every NaN / undefined / negative input is guarded and degrades to a safe,
// documented default rather than an exception.

export type SlaLevel = 'ok' | 'due_soon' | 'overdue' | 'breached';

export interface SlaState {
  /** Bucket the deadline falls into right now. */
  level: SlaLevel;
  /** Milliseconds until the deadline (0 once past due). */
  msRemaining: number;
  /** Milliseconds past the deadline (0 while still on time). */
  msOverdue: number;
  /** Short human sentence naming the level + a rough time. */
  reason: string;
}

/** One hour: the default "due soon" lead window. */
export const DEFAULT_DUE_SOON_MS = 3_600_000;
/** No grace by default — a deadline is breached the moment it passes. */
export const DEFAULT_BREACH_GRACE_MS = 0;

// ── Numeric guards ────────────────────────────────────────────────────────────
// Coerce anything to a finite number, defaulting when it is NaN/undefined/±Inf.
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
// A non-negative duration (a window/grace can never be negative).
function finiteNonNeg(value: unknown, fallback: number): number {
  const n = finite(value, fallback);
  return n < 0 ? fallback : n;
}

// ── Rough, human-friendly duration phrasing ───────────────────────────────────
// Deliberately coarse ("~2h", "~3d") — this is a status reason, not a stopwatch.
function roughDuration(ms: number): string {
  const m = Math.max(0, Math.floor(finite(ms, 0)));
  if (m < 1_000) return `${m}ms`;
  const sec = Math.round(m / 1_000);
  if (sec < 90) return `~${sec}s`;
  const min = Math.round(m / 60_000);
  if (min < 90) return `~${min}m`;
  const hr = Math.round(m / 3_600_000);
  if (hr < 48) return `~${hr}h`;
  const day = Math.round(m / 86_400_000);
  return `~${day}d`;
}

/**
 * Classify a deadline against `now`.
 *
 *   now <= dueAt - dueSoonMs                 → 'ok'
 *   dueAt - dueSoonMs < now <= dueAt         → 'due_soon'
 *   dueAt < now <= dueAt + breachGraceMs     → 'overdue'
 *   now > dueAt + breachGraceMs              → 'breached'
 *
 * `msRemaining = max(0, dueAt - now)`, `msOverdue = max(0, now - dueAt)`. With
 * the default `breachGraceMs` of 0 there is no 'overdue' band: a deadline goes
 * straight from 'due_soon' to 'breached' the instant it passes. Never throws;
 * if `dueAt` or `now` is not a finite number the state degrades to a calm
 * 'ok' with zeroed timings (we cannot flag a breach we cannot measure).
 */
export function evaluateSla(args: {
  dueAt: number;
  now: number;
  dueSoonMs?: number;
  breachGraceMs?: number;
}): SlaState {
  const a = (args ?? {}) as {
    dueAt?: unknown;
    now?: unknown;
    dueSoonMs?: unknown;
    breachGraceMs?: unknown;
  };
  const dueAtOk = typeof a.dueAt === 'number' && Number.isFinite(a.dueAt);
  const nowOk = typeof a.now === 'number' && Number.isFinite(a.now);
  if (!dueAtOk || !nowOk) {
    return { level: 'ok', msRemaining: 0, msOverdue: 0, reason: 'no valid deadline set' };
  }

  const dueAt = a.dueAt as number;
  const now = a.now as number;
  const dueSoonMs = finiteNonNeg(a.dueSoonMs, DEFAULT_DUE_SOON_MS);
  const breachGraceMs = finiteNonNeg(a.breachGraceMs, DEFAULT_BREACH_GRACE_MS);

  const msRemaining = Math.max(0, dueAt - now);
  const msOverdue = Math.max(0, now - dueAt);

  let level: SlaLevel;
  let reason: string;
  if (now <= dueAt - dueSoonMs) {
    level = 'ok';
    reason = `on track — ${roughDuration(msRemaining)} until due`;
  } else if (now <= dueAt) {
    level = 'due_soon';
    reason = msRemaining === 0 ? 'due now' : `due soon — ${roughDuration(msRemaining)} left`;
  } else if (now <= dueAt + breachGraceMs) {
    level = 'overdue';
    reason = `overdue by ${roughDuration(msOverdue)} (within grace)`;
  } else {
    level = 'breached';
    reason = `breached — ${roughDuration(msOverdue)} past due`;
  }

  return { level, msRemaining, msOverdue, reason };
}

/**
 * Next scheduled tick STRICTLY after `now` for a schedule anchored at
 * `lastRunAt` repeating every `intervalMs`, catching up over any number of
 * missed intervals in O(1). We want the smallest integer `k >= 1` such that
 * `lastRunAt + k*intervalMs > now`, i.e. `k = floor((now - lastRunAt)/interval) + 1`,
 * which lands strictly past `now` whether or not `now` sits exactly on the grid.
 *
 * Edge behavior (never throws):
 *   - intervalMs <= 0 or non-finite → return `lastRunAt` (cannot advance).
 *   - lastRunAt non-finite          → return 0.
 *   - now non-finite                → treat as one interval after lastRunAt.
 *   - lastRunAt > now (future anchor)→ return `lastRunAt + intervalMs`.
 */
export function nextDueAt(lastRunAt: number, intervalMs: number, now: number): number {
  const anchor = finite(lastRunAt, NaN);
  if (!Number.isFinite(anchor)) return 0;

  const interval = finite(intervalMs, 0);
  if (interval <= 0) return anchor;

  const nowV = finite(now, NaN);
  // No usable clock → advance exactly one interval from the anchor.
  if (!Number.isFinite(nowV)) return anchor + interval;

  // Future anchor: it hasn't even fired once yet — the next tick after it.
  if (anchor > nowV) return anchor + interval;

  const k = Math.floor((nowV - anchor) / interval) + 1;
  return anchor + k * interval;
}

/** One-line human summary of an SlaState (mirrors `state.reason` but stands
 *  alone as a label). Never throws — a malformed state degrades to a note. */
export function describeSla(state: SlaState): string {
  const s = (state ?? {}) as Partial<SlaState>;
  const level: SlaLevel =
    s.level === 'due_soon' || s.level === 'overdue' || s.level === 'breached' || s.level === 'ok'
      ? s.level
      : 'ok';
  const reason = typeof s.reason === 'string' && s.reason.trim() ? s.reason.trim() : 'no detail';
  const label: Record<SlaLevel, string> = {
    ok: 'OK',
    due_soon: 'DUE SOON',
    overdue: 'OVERDUE',
    breached: 'BREACHED',
  };
  return `[${label[level]}] ${reason}`;
}
