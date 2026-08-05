/**
 * swanbotContinuationBudgetCore — the SINGLE source of truth for "may the v2
 * SwanBot loop start ANOTHER client-tool CONTINUATION round?", shared by BOTH
 * the app client and the Deno edge function so the two can no longer drift.
 *
 * WHY THIS EXISTS
 * ---------------
 * The v2 client-tool continuation cap was expressed twice, inconsistently:
 *
 *   • CLIENT  src/lib/swanbot.ts :: callSwanBotV2 — `MAX_CONTINUATIONS = 6`,
 *     looped as `for (i = 0; i < 6; i++)` (allows 6 rounds).
 *   • EDGE    supabase/functions/swanbot-v2-ai/index.ts — REUSES the per-turn
 *     tool-loop budget `MAX_ITERATIONS = 5` for continuations too:
 *       `continuationCount = (resumeFrom?.continuationCount || 0) + 1;
 *        if (continuationCount > MAX_ITERATIONS) …stop`  (allows only 5).
 *
 * Two defects live in that gap:
 *   (1) OFF-BY-ONE — the client is willing to make a 6th continuation the edge
 *       then rejects with "Too many client-side continuation rounds", so the
 *       6th round always dead-ends instead of running.
 *   (2) CONFLATION — the edge borrows MAX_ITERATIONS (the per-TURN tool-loop
 *       budget) as the per-RUN continuation budget, so touching one silently
 *       moves the other.
 *
 * This core replaces both with one dedicated-constant decision, documented
 * with CONSISTENT `<` / `>=` semantics:
 *
 *     completedRounds <  ceiling  → shouldContinue (roundsLeft > 0)
 *     completedRounds >= ceiling  → atCap, STOP    (roundsLeft = 0)
 *
 * `continuationCount` MEANS "continuation rounds already COMPLETED" (0-based),
 * which is exactly what the smoke pins (0..5 continue at base, 6 caps). Wiring
 * BOTH sides to this closes the off-by-one — they now cap at the SAME ceiling —
 * and frees the edge's MAX_ITERATIONS to mean only the per-turn budget again.
 *
 * PURITY (load-bearing — the DENO edge imports this the same way it imports
 * src/lib/v2ToolSelectionCore.ts / src/lib/toolInputExamples.ts): zero runtime
 * imports, no Date.now()/random anywhere, every export TOTAL (null/undefined/
 * wrong-type/huge/hostile/throwing-getter input → safe neutral STOP, never
 * throws), bounded output, secret-free.
 *
 * WIRING
 *   • CLIENT swanbot.ts (~1049): drive the loop with a completed-rounds counter
 *       let completed = 0;
 *       while (response.pending) {
 *         if (!nextContinuationDecision({ continuationCount: completed, isCodingTask }).shouldContinue) break;
 *         …execute client tools + invoke continuation…; completed++;
 *       }
 *     (delete the `MAX_CONTINUATIONS = 6` literal).
 *   • EDGE index.ts (~2676-2684): pass the PRE-increment completed count —
 *       const completed = resumeFrom?.continuationCount || 0;
 *       if (!nextContinuationDecision({ continuationCount: completed, isCodingTask }).shouldContinue) {
 *         return terminalRunLoopError("Too many client-side continuation rounds.", …);
 *       }
 *       const continuationCount = completed + 1; // still what we PERSIST
 *     (delete the `> MAX_ITERATIONS` comparison; MAX_ITERATIONS stays the
 *     per-turn budget only).
 */

// ─── Public constants ────────────────────────────────────────────────────────

/** Continuation-round ceiling for ordinary (non-coding) v2 runs. A run may
 *  complete rounds 0..(BASE-1) and stops once BASE rounds are done. */
export const SWANBOT_CONTINUATION_BASE_MAX = 6;

/** Deeper ceiling for coding tasks: edit→shell→git→verify chains legitimately
 *  need more client round-trips than a plain chat answer. */
export const SWANBOT_CONTINUATION_CODING_MAX = 10;

/** Absolute clamp for an explicit `maxOverride`, so a bad/hostile override can
 *  never blow the loop budget wide open. Overrides are clamped to
 *  [OVERRIDE_MIN, HARD_MAX]. */
export const SWANBOT_CONTINUATION_HARD_MAX = 24;

/** Floor for an explicit `maxOverride` (a ceiling below 1 would be useless). */
export const SWANBOT_CONTINUATION_OVERRIDE_MIN = 1;

// ─── Public type ─────────────────────────────────────────────────────────────

export interface ContinuationDecision {
  /** True iff another continuation round is allowed to start. */
  shouldContinue: boolean;
  /** Rounds still permitted before the cap (>= 0; 0 when at/over cap). */
  roundsLeft: number;
  /** True iff the ceiling has been reached — the STOP-because-cap case. */
  atCap: boolean;
  /** Bounded, deterministic, secret-free diagnostic (never empty). */
  reason: string;
}

// ─── Internal helpers (all total — never throw) ───────────────────────────────

/** Read one property without ever throwing (guards throwing getters / non-objects). */
function safeGet(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** number | numeric-string → finite number; everything else → null. Never throws. */
function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Completed-rounds count → non-negative integer, or null for hostile input
 *  (NaN/Infinity/negative/non-numeric) so the caller fails closed (STOP). */
function toCompletedRounds(v: unknown): number | null {
  const n = toFiniteNumber(v);
  if (n === null) return null;
  if (n < 0) return null;
  return Math.floor(n);
}

function clampInt(n: number, lo: number, hi: number): number {
  const f = Math.floor(n);
  if (f < lo) return lo;
  if (f > hi) return hi;
  return f;
}

/** Lenient truthy read for the `isCodingTask` flag. Anything not clearly true
 *  → false (the tighter/safer base ceiling). */
function truthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes' || t === 'coding';
  }
  return false;
}

type CeilingSource = 'base' | 'coding' | 'override';

/** Resolve the active ceiling. Explicit override (clamped) wins over the
 *  coding flag, which wins over the base default. */
function resolveCeiling(
  isCodingTask: unknown,
  maxOverride: unknown,
): { ceiling: number; source: CeilingSource } {
  const ov = toFiniteNumber(maxOverride);
  if (ov !== null) {
    return {
      ceiling: clampInt(ov, SWANBOT_CONTINUATION_OVERRIDE_MIN, SWANBOT_CONTINUATION_HARD_MAX),
      source: 'override',
    };
  }
  if (truthyFlag(isCodingTask)) {
    return { ceiling: SWANBOT_CONTINUATION_CODING_MAX, source: 'coding' };
  }
  return { ceiling: SWANBOT_CONTINUATION_BASE_MAX, source: 'base' };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Decide whether the v2 loop may start ANOTHER client-tool continuation round.
 *
 * @param input.continuationCount  Continuation rounds ALREADY COMPLETED
 *   (0-based). Hostile / unparseable values fail closed to a STOP decision.
 * @param input.isCodingTask       When truthy, use the deeper coding ceiling.
 * @param input.maxOverride        Explicit ceiling; floored + clamped to
 *   [OVERRIDE_MIN, HARD_MAX]; takes precedence over isCodingTask.
 *
 * TOTAL: never throws; always returns a well-formed, bounded ContinuationDecision.
 */
export function nextContinuationDecision(input: {
  continuationCount: unknown;
  isCodingTask?: unknown;
  maxOverride?: unknown;
}): ContinuationDecision {
  const { ceiling, source } = resolveCeiling(
    safeGet(input, 'isCodingTask'),
    safeGet(input, 'maxOverride'),
  );

  const completed = toCompletedRounds(safeGet(input, 'continuationCount'));
  if (completed === null) {
    // Fail closed: an unreadable/hostile round count must never be treated as
    // "0 → keep going" (that risks an unbounded loop). STOP is the safe neutral.
    return {
      shouldContinue: false,
      roundsLeft: 0,
      atCap: true,
      reason: 'invalid-continuation-count:stop(' + source + ':' + ceiling + ')',
    };
  }

  const shouldContinue = completed < ceiling;
  const atCap = completed >= ceiling;
  const roundsLeft = atCap ? 0 : ceiling - completed;
  const reason =
    (shouldContinue ? 'continue:' : 'at-cap:') +
    completed +
    '/' +
    ceiling +
    '(' +
    source +
    ')';

  return { shouldContinue, roundsLeft, atCap, reason };
}
