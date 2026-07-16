/**
 * v2PreflightAbortCore — a pure, Deno-importable PRE-ROUND guard that decides
 * whether the NEXT swanbot-v2-ai model round-trip is structurally DOOMED
 * (cannot make progress) and should be short-circuited to a clean terminal
 * INSTEAD of spending a wasted Anthropic call.
 *
 * WHY THIS EXISTS
 * ---------------
 * supabase/functions/swanbot-v2-ai/index.ts :: runLoop calls `anthropicTurn`
 * once per iteration (up to MAX_ITERATIONS = 5, ~2627-2632). Some of those calls
 * are structurally doomed BEFORE they are made — spending them only burns a
 * round-trip, tokens, and latency to arrive at the same dead end:
 *
 *   • model_unsupported     — the v2 typed loop only runs anthropic claude-* ids
 *     (MODEL_MAP / /^claude-/). A non-claude model is rejected at entry with
 *     "model_unsupported_on_v2" (index.ts ~2917-2920). If a resume/continuation
 *     snapshot ever carries an unsupported model, every remaining round dead-ends
 *     the same way.
 *   • no_tools_for_request  — a tool_use turn can name a tool that is NOT in the
 *     frozen `activeTools` set (selectToolsForTurn / resolveToolsByName). A `use`
 *     whose name is absent falls through to executeEdgeToolUse with def=undefined
 *     → an error tool_result → the model re-requests the SAME absent tool next
 *     round → the loop burns iterations making zero progress.
 *   • stalled_no_progress   — consecutive rounds that produce NEITHER a usable
 *     tool call NOR text keep the loop spinning to MAX_ITERATIONS with nothing to
 *     show for the spent calls.
 *   • budget_exhausted      — the shared continuation budget
 *     (swanbotContinuationBudgetCore) is already at/over cap; the next round would
 *     only dead-end at the cap check (index.ts ~2681-2688).
 *
 * This core is the SINGLE pre-round doom test the edge can consult BEFORE it
 * spends the next model call. It COMPLEMENTS (does not duplicate)
 * swanbotContinuationBudgetCore.nextContinuationDecision: that core answers
 * "are we ALLOWED another CONTINUATION round (cap/off-by-one)?"; this core answers
 * "given the pre-round state, is the next MODEL round-trip DOOMED?". The budget
 * signal crosses the seam as a plain `budgetRemaining` number (feed it
 * nextContinuationDecision(...).roundsLeft) so the two stay strictly disjoint.
 *
 * FAIL-OPEN, NOT FAIL-CLOSED (a DELIBERATE inversion of the budget core):
 * wrongly killing a LIVE turn is worse than one wasted round, so on ANY ambiguous
 * / unreadable / hostile input this core PROCEEDS. It aborts ONLY on a DEFINITE
 * doom that is positively readable from the input. Junk in → proceed. The four
 * dooms above are the only paths to `proceed:false`.
 *
 * PRECEDENCE (documented + smoke-pinned): when several dooms co-occur the FIRST
 * matching one wins, in the order the loop meets them structurally —
 *   model_unsupported → no_tools_for_request → stalled_no_progress →
 *   budget_exhausted → (none) ok.
 *
 * `toolsAvailableCount` CORROBORATES the tool doom (it is folded into the reason)
 * but does NOT independently abort: a genuinely zero-tool round can still end in a
 * clean text terminal, so aborting on "0 tools" alone would violate fail-open.
 * `lastRoundProducedToolCallOrText` is a fail-open GUARD on the stall doom: if the
 * most recent round positively produced output the streak is contradicted and we
 * proceed rather than kill a turn that just moved.
 *
 * PURITY (load-bearing — the Deno edge imports src/lib/*Core the same way it
 * imports swanbotContinuationBudgetCore / v2ToolSelectionCore): zero runtime
 * imports, no Date.now()/Math.random() anywhere, every export TOTAL
 * (null/undefined/wrong-type/huge/hostile/throwing-getter/cyclic input → a safe
 * PROCEED, never throws), bounded secret-free output.
 *
 * WIRING
 *   • EDGE index.ts runLoop, INSIDE `for (let iter…)`, immediately BEFORE
 *     `const turn = await anthropicTurn({…})` (~2632):
 *       const pre = decideV2Preflight({
 *         modelSupported: !!(MODEL_MAP[model] || /^claude-/.test(model)),
 *         toolsAvailableCount: activeTools.length,
 *         requestedToolMissing: prevTurnNamedAnAbsentTool,      // from last turn's uses
 *         lastRoundProducedToolCallOrText: prevRoundMadeProgress,
 *         consecutiveNoProgressRounds: noProgressStreak,
 *         budgetRemaining: nextContinuationDecision({ continuationCount }).roundsLeft,
 *       });
 *       if (!pre.proceed) {
 *         return terminalRunLoopError(pre.abortReason ?? "v2 preflight abort", iter, toolCalls, usageTotal);
 *       }
 *     A doom short-circuits to a clean terminal instead of a wasted round-trip.
 */

// ─── Public constants ────────────────────────────────────────────────────────

/**
 * Consecutive no-progress rounds that make the NEXT round presumed doomed.
 * Kept small (the loop only gets MAX_ITERATIONS = 5 total) so a real stall is
 * caught before it eats the whole budget; the `lastRoundProducedToolCallOrText`
 * guard prevents a single hiccup at/above the threshold from a false abort.
 */
export const V2_PREFLIGHT_STALL_THRESHOLD = 2;

/** Hard cap on any emitted `abortReason` length (bounded, secret-free output). */
export const V2_PREFLIGHT_REASON_MAX = 72;

// ─── Public types ────────────────────────────────────────────────────────────

/** Why (if at all) the next v2 model round-trip must NOT be spent. */
export type V2PreflightClassification =
  | 'ok'
  | 'model_unsupported'
  | 'no_tools_for_request'
  | 'stalled_no_progress'
  | 'budget_exhausted';

/**
 * Pre-round state snapshot. Every field is optional + `unknown` because the
 * caller assembles it from loosely-typed edge/resume state; the decision is
 * TOTAL over any shape.
 */
export interface V2PreflightInput {
  /** Whether the resolved model is runnable on the v2 typed loop (claude-* only). */
  modelSupported?: unknown;
  /** Size of the frozen `activeTools` set for this run (corroborates tool doom). */
  toolsAvailableCount?: unknown;
  /** The model is (repeatedly) naming a tool that is not in `activeTools`. */
  requestedToolMissing?: unknown;
  /** The most recent round produced a usable tool call or text (progress). */
  lastRoundProducedToolCallOrText?: unknown;
  /** Consecutive rounds that produced neither a tool call nor text. */
  consecutiveNoProgressRounds?: unknown;
  /** Continuation rounds still permitted (e.g. nextContinuationDecision.roundsLeft). */
  budgetRemaining?: unknown;
}

export interface V2PreflightDecision {
  /** True iff the next model round-trip should be spent. */
  proceed: boolean;
  /** Bounded, deterministic, secret-free abort reason; null iff `proceed`. */
  abortReason: string | null;
  /** Structural classification; 'ok' iff `proceed`. */
  classification: V2PreflightClassification;
}

// ─── Internal helpers (all TOTAL — never throw) ───────────────────────────────

/** Read one property without ever throwing (guards throwing getters / non-objects). */
function safeGet(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** number | numeric-string → finite number; everything else (incl. NaN/±Infinity) → null. */
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

/** → non-negative integer, or null for hostile/negative/non-numeric input. */
function toNonNegInt(v: unknown): number | null {
  const n = toFiniteNumber(v);
  if (n === null) return null;
  if (n < 0) return null;
  return Math.floor(n);
}

/**
 * Strictly boolean read: true | false | null(=unknown). Only UNAMBIGUOUS
 * boolean tokens resolve; anything else (undefined/null/NaN/objects/other
 * strings) → null so the caller can fail OPEN on it.
 */
function readTriBool(v: unknown): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  if (typeof v === 'number') {
    if (v === 1) return true;
    if (v === 0) return false;
    return null;
  }
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'true' || t === '1' || t === 'yes' || t === 'y' || t === 'on') return true;
    if (t === 'false' || t === '0' || t === 'no' || t === 'n' || t === 'off') return false;
    return null;
  }
  return null;
}

/** DEFINITELY unsupported (boolean-false or a clear "unsupported" word). Else false → fail open. */
function readModelUnsupported(v: unknown): boolean {
  if (readTriBool(v) === false) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'unsupported' || t === 'not_supported' || t === 'not-supported' || t === 'unavailable') {
      return true;
    }
  }
  return false;
}

/** DEFINITELY missing (boolean-true or a clear "missing" word). Else false → fail open. */
function readToolMissing(v: unknown): boolean {
  if (readTriBool(v) === true) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (t === 'missing' || t === 'absent' || t === 'unavailable' || t === 'not_found' || t === 'not-found') {
      return true;
    }
  }
  return false;
}

/** DEFINITELY produced output (only a clear boolean-true). Anything else → false. */
function readProducedOutput(v: unknown): boolean {
  return readTriBool(v) === true;
}

/** Bound a reason string to a safe, secret-free length. */
function boundReason(s: string): string {
  return s.length > V2_PREFLIGHT_REASON_MAX ? s.slice(0, V2_PREFLIGHT_REASON_MAX) : s;
}

function abort(
  classification: Exclude<V2PreflightClassification, 'ok'>,
  reason: string,
): V2PreflightDecision {
  return { proceed: false, abortReason: boundReason(reason), classification };
}

const PROCEED: V2PreflightDecision = { proceed: true, abortReason: null, classification: 'ok' };

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Decide whether the NEXT swanbot-v2-ai model round-trip is DOOMED and must be
 * short-circuited to a clean terminal instead of spent.
 *
 * TOTAL: never throws; on ANY ambiguous/unreadable/hostile input it PROCEEDS
 * (fail-open) so a live turn is never wrongly killed. It aborts ONLY on a
 * definite, positively-readable doom, in the precedence documented above.
 */
export function decideV2Preflight(input: V2PreflightInput): V2PreflightDecision {
  // 1. model_unsupported — the v2 typed loop cannot run this model at all; every
  //    remaining round would dead-end the same way. Most structural doom → first.
  if (readModelUnsupported(safeGet(input, 'modelSupported'))) {
    return abort('model_unsupported', 'model_unsupported:v2-loop-cannot-run-model');
  }

  // 2. no_tools_for_request — the model keeps naming a tool absent from the frozen
  //    active set; another round only re-errors on the same missing tool. The tool
  //    count (never independently aborting) is folded in as corroboration.
  if (readToolMissing(safeGet(input, 'requestedToolMissing'))) {
    const n = toNonNegInt(safeGet(input, 'toolsAvailableCount'));
    const tag = n === null ? '' : '(tools=' + n + ')';
    return abort('no_tools_for_request', 'no_tools_for_request:model-wants-absent-tool' + tag);
  }

  // 3. stalled_no_progress — N consecutive rounds produced neither a usable tool
  //    call nor text. GUARD (fail-open): if the LAST round positively produced
  //    output the streak is contradicted → do NOT kill a turn that just moved.
  const streak = toNonNegInt(safeGet(input, 'consecutiveNoProgressRounds'));
  if (
    streak !== null &&
    streak >= V2_PREFLIGHT_STALL_THRESHOLD &&
    !readProducedOutput(safeGet(input, 'lastRoundProducedToolCallOrText'))
  ) {
    return abort(
      'stalled_no_progress',
      'stalled_no_progress:' + streak + '>=' + V2_PREFLIGHT_STALL_THRESHOLD + '-rounds',
    );
  }

  // 4. budget_exhausted — the shared continuation budget is spent; the next round
  //    would only dead-end at the cap. Only a DEFINITE finite <= 0 aborts;
  //    unreadable/non-finite budget fails open.
  const budget = toFiniteNumber(safeGet(input, 'budgetRemaining'));
  if (budget !== null && budget <= 0) {
    return abort('budget_exhausted', 'budget_exhausted:remaining<=0(' + budget + ')');
  }

  // No DEFINITE doom readable → proceed (fail open).
  return PROCEED;
}
