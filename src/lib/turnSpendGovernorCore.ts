// turnSpendGovernorCore — the PURE in-flight per-TURN DOLLAR governor. A long
// agent turn runs a bounded model/tool loop, and each round costs real money.
// openswanSessionRuntime already accumulates per-round token usage (usageAcc)
// and already prices the total with estimateRunCostUsd — but only ONCE, at run
// completion, to write the audit-only `estimated_cost` column. Mid-turn, that
// accrued cost drives NOTHING. This core is the missing in-flight governor: it
// consumes the dollars ALREADY BURNED this turn (the loop's own priced
// telemetry) plus the circle's budget state and the task's importance, and
// picks the CHEAPEST GRACEFUL ECONOMIC LEVER for the next round:
//
//     evaluateTurnSpend({ accruedTurnUsd, roundsCompleted, circleSpentUsd,
//                         circleCapUsd, perTurnSoftCapUsd, alreadyDownshifted,
//                         alreadySummarized, taskValue })
//        -> { action: 'continue' | 'downshift' | 'summarize-and-continue'
//                     | 'stop-and-ask', ... }
//
//   - 'continue'               : comfortably under this turn's dollar cap.
//   - 'downshift'              : warm — swap to a cheaper model for the next
//                                rounds (the caller pipes this into
//                                budgetModelDownshiftCore.downshiftForBudget for
//                                the concrete id; this core never picks a model).
//   - 'summarize-and-continue' : hot — pay a ONE-TIME context compaction to cut
//                                the recurring per-round context cost (a lever
//                                that exists nowhere else as a decision).
//   - 'stop-and-ask'           : the per-turn cap (or the absolute backstop) is
//                                reached, or both cheap levers are already spent
//                                and it is still hot — hand back to a human.
//
// WHY THIS AXIS IS DISTINCT (no duplication):
//   * budgetModelDownshiftCore maps CIRCLE-CUMULATIVE spend -> level and swaps a
//     MODEL id. This watches THIS-TURN accrued dollars and emits the ABSTRACT
//     lever 'downshift' — it never names a model. Different scope, different out.
//   * openswanStepBudgetCore counts STEPS/tool-calls (loop shape, "not its
//     cost"). This counts DOLLARS. The loop consults BOTH each round and takes
//     the more conservative.
//   * agentCostForecastCore forecasts a STATIC PLAN pre-run. This governs an
//     ALREADY-RUNNING turn from OBSERVED accrued burn, projecting the next round
//     from measured $/round.
//   * runCostRollupCore PRICES tokens->USD + aggregates completed runs (post-hoc).
//     This CONSUMES an already-priced accrued USD and decides live — zero pricing.
//   * swanbotContinuationBudgetCore counts continuation ROUNDS. Orthogonal.
//   * budgetAlerts/budgetMath are PERIOD (daily/weekly/monthly) gates AROUND a
//     turn. This is the in-flight layer DURING a turn, with graceful levers.
//
// NEW math this core alone owns: (1) the effective-per-turn-cap COMPOSITION =
// min(soft cap, DEFAULT_TURN_CAP_FRACTION x remaining-circle-budget), value-
// modulated; (2) marginal next-round affordability projected from OBSERVED
// $/round; (3) the cheapest-lever-first ladder culminating in the entirely-new
// 'summarize-and-continue' economic action.
//
// PURITY: ZERO imports (not even type-only), tsx-loadable like
// budgetModelDownshiftCore / openswanStepBudgetCore. DETERMINISTIC: no Date.now
// / Math.random / argless `new Date` — the accrued dollars are always an INPUT.
// TOTAL: every export coerces its own inputs and never throws (null / undefined
// / wrong-type / NaN / +-Infinity / negative / huge / bigint / cyclic /
// throwing-getter input all degrade to a safe conservative decision). BOUNDED:
// exported MAX_* caps clamp the cap, ratio, projection, and reason length.
// SECRET-SAFE: reasons are built ONLY from this core's own numbers + fixed enum
// labels (the accrued-$ input is the loop's own trusted telemetry, never user
// content); a final sanitizer strips any control / line-separator char anyway.
//
// FAIL-SAFE BIAS: the last-resort catch returns 'continue' with a WARNING reason
// (matching openswanStepBudgetCore's fail-open-with-warning posture). That is
// bounded because (a) rule 1 checks the absolute accrued backstop FIRST and (b)
// the STEP cap (openswanStepBudgetCore) + iteration cap independently bound the
// loop length — so a fail-open 'continue' can never be an unbounded spend loop.

// ── Action vocabulary ─────────────────────────────────────────────────────────

export type SpendGovernorAction =
  | 'continue'
  | 'downshift'
  | 'summarize-and-continue'
  | 'stop-and-ask';

// ── Exported policy constants (single source of truth; the loop shares them) ──

/** spendRatio at/above which the warm band starts (cheapest lever: downshift). */
export const SPEND_GOVERNOR_DOWNSHIFT_RATIO = 0.6;
/** spendRatio at/above which the hot band starts (pay a one-time summarize). */
export const SPEND_GOVERNOR_SUMMARIZE_RATIO = 0.85;
/** spendRatio at/above which the per-turn cap is considered reached -> stop. */
export const SPEND_GOVERNOR_STOP_RATIO = 1.0;

/** A single turn should cost <= this fraction of what's LEFT in the circle
 *  budget period (the derived-cap basis). */
export const DEFAULT_TURN_CAP_FRACTION = 0.25;

/** Hard per-turn backstop. A normal turn is cents to low single dollars; $50 in
 *  one turn is pathological, so it ALWAYS stops — even when otherwise uncapped. */
export const ABSOLUTE_MAX_TURN_USD = 50;

/** Floor on a composed cap, so an already-started turn can still finish >= 1
 *  round even on a near-exhausted circle budget. */
export const MIN_TURN_CAP_USD = 0.02;

/** Ceiling on any REAL (composed) cap. Kept <= ABSOLUTE_MAX_TURN_USD. */
export const MAX_TURN_CAP_USD = 25;

/** Task-value multiplier band. value 0 -> MIN (tightest runway), value 1 -> MAX
 *  (loosest). value 0.5 -> multiplier 1.0 (identity — no surprise by default). */
export const MIN_VALUE_MULT = 0.6;
export const MAX_VALUE_MULT = 1.4;
/** Neutral task value when none is supplied (multiplier 1.0). */
export const DEFAULT_TASK_VALUE = 0.5;

/** Bound on accrued (and projected) dollars this core will ever carry. */
export const MAX_ACCRUED_USD = 1e9;
/** Bound on the reported spendRatio (accrued/cap can be huge on a tiny cap). */
export const MAX_RATIO = 1e6;
/** Bound on the returned `reason` string (secret-safe: numbers + fixed labels). */
export const MAX_REASON_LEN = 200;

// ── Types (all fields `unknown` — this core is the fail-safe boundary and
//    coerces every input itself, so callers may pass raw runtime values) ────────

export interface TurnSpendState {
  /** USD burned so far THIS turn (caller: estimateRunCostUsd of the usage
   *  accumulated so far). Garbage / negative / NaN -> 0; clamped <= MAX_ACCRUED_USD. */
  accruedTurnUsd?: unknown;
  /** Model rounds already completed this turn (>= 0 int). 0 -> no projection. */
  roundsCompleted?: unknown;
  /** USD the circle already spent this budget period. */
  circleSpentUsd?: unknown;
  /** Circle period cap (<= 0 / absent -> uncapped on this axis). */
  circleCapUsd?: unknown;
  /** Optional explicit per-turn cap; else derived from remaining circle budget. */
  perTurnSoftCapUsd?: unknown;
  /** Caller carries this true once it has acted on a prior 'downshift'. */
  alreadyDownshifted?: unknown;
  /** Caller carries this true once it has acted on a prior 'summarize-and-continue'. */
  alreadySummarized?: unknown;
  /** Task-shape importance 0..1; higher -> more runway; missing -> DEFAULT_TASK_VALUE. */
  taskValue?: unknown;
}

export interface SpendGovernorDecision {
  action: SpendGovernorAction;
  /** Composed cap the decision used (>= 0, bounded). */
  effectiveTurnCapUsd: number;
  /** accrued / effectiveCap, clamped 0..MAX_RATIO. */
  spendRatio: number;
  /** roundsCompleted > 0 ? accrued/roundsCompleted : null  (avg $/round burn). */
  projectedNextRoundUsd: number | null;
  /** projected != null && accrued + projected > effectiveCap. */
  nextRoundBreaches: boolean;
  /** false when fully uncapped (the absolute backstop is the only ceiling). */
  capped: boolean;
  /** Bounded, deterministic, secret-free explanation (never empty). */
  reason: string;
}

// ── Internal helpers (all total — never throw) ────────────────────────────────

/** Read one property off a possibly-hostile input without ever throwing
 *  (guards non-objects and throwing getters). */
function safeGet(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined; // hostile throwing getter -> treat as absent
  }
}

/** number | numeric-string -> finite number; everything else (bigint / symbol /
 *  boolean / object / NaN / +-Infinity / empty string) -> null. Never throws. */
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

/** Clamp a number into [lo, hi]; a non-finite value collapses to lo (the safe,
 *  conservative floor). */
function clampNumber(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Deterministic round to `dp` decimals for reason strings. Non-finite -> 0. */
function round(n: number, dp: number): number {
  if (!Number.isFinite(n)) return 0;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

/** Strip any control / DEL / C1 / line-or-paragraph-separator char and bound the
 *  length. Reasons are already built from numbers + fixed labels, so this is
 *  defense-in-depth; it can never throw and never returns an over-length string. */
function sanitizeReason(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length && out.length < MAX_REASON_LEN; i += 1) {
    const code = raw.charCodeAt(i);
    if (
      code < 0x20 || // C0 controls (incl. NUL, TAB, LF, CR)
      code === 0x7f || // DEL
      (code >= 0x80 && code <= 0x9f) || // C1 controls
      code === 0x2028 || // line separator
      code === 0x2029 // paragraph separator
    ) {
      continue;
    }
    out += raw[i];
  }
  return out;
}

// ── Effective per-turn cap composition ────────────────────────────────────────

/**
 * Compose the effective dollar cap for a single turn.
 *
 *   softCap   = perTurnSoftCapUsd, when finite > 0, else null
 *   remaining = circleCapUsd - circleSpentUsd (>= 0), when circleCapUsd finite > 0
 *   derived   = remaining * DEFAULT_TURN_CAP_FRACTION, when remaining is known
 *   baseCap   = min of the NON-NULL of { softCap, derived }
 *
 * If BOTH softCap and derived are null the turn is fully UNCAPPED — the absolute
 * backstop is the only ceiling, and it is returned UNMODULATED (the backstop is
 * the safety net, not a value-tunable budget). Otherwise the base cap is
 * value-modulated (value 0 -> x0.6 tight, 1 -> x1.4 loose, 0.5 -> x1.0 identity)
 * and clamped into [MIN_TURN_CAP_USD, min(MAX_TURN_CAP_USD, ABSOLUTE_MAX_TURN_USD)].
 *
 * TOTAL: any input degrades to a safe cap; never throws. The returned cap is
 * always > 0, so callers can divide by it safely.
 */
export function resolveEffectiveTurnCap(input: {
  perTurnSoftCapUsd?: unknown;
  circleSpentUsd?: unknown;
  circleCapUsd?: unknown;
  taskValue?: unknown;
}): { cap: number; capped: boolean } {
  try {
    const softRaw = toFiniteNumber(safeGet(input, 'perTurnSoftCapUsd'));
    const softCap = softRaw !== null && softRaw > 0 ? softRaw : null;

    const capRaw = toFiniteNumber(safeGet(input, 'circleCapUsd'));
    let remaining: number | null = null;
    if (capRaw !== null && capRaw > 0) {
      const spentRaw = toFiniteNumber(safeGet(input, 'circleSpentUsd'));
      const spent = spentRaw !== null && spentRaw > 0 ? spentRaw : 0;
      remaining = Math.max(0, capRaw - spent);
    }
    const derived = remaining !== null ? remaining * DEFAULT_TURN_CAP_FRACTION : null;

    // min of the non-null of { softCap, derived }
    let baseCap: number | null;
    if (softCap !== null && derived !== null) baseCap = Math.min(softCap, derived);
    else if (softCap !== null) baseCap = softCap;
    else if (derived !== null) baseCap = derived;
    else baseCap = null;

    if (baseCap === null) {
      // Fully uncapped -> the absolute backstop is the only ceiling (unmodulated).
      return { cap: ABSOLUTE_MAX_TURN_USD, capped: false };
    }

    const vRaw = toFiniteNumber(safeGet(input, 'taskValue'));
    const v = vRaw === null ? DEFAULT_TASK_VALUE : clampNumber(vRaw, 0, 1);
    const mult = MIN_VALUE_MULT + v * (MAX_VALUE_MULT - MIN_VALUE_MULT);
    const ceiling = Math.min(MAX_TURN_CAP_USD, ABSOLUTE_MAX_TURN_USD);
    // baseCap >= 0 and mult ∈ [0.6, 1.4] > 0, so the only non-finite product is
    // +Infinity (overflow of a near-MAX_VALUE soft cap), which must map to the
    // ceiling — NOT clampNumber's conservative non-finite -> lo floor, which
    // would wrongly collapse a too-large cap to MIN. Finite products (incl. the
    // exhausted-budget product 0) pass through unchanged.
    const product = baseCap * mult;
    const cap = clampNumber(Number.isFinite(product) ? product : ceiling, MIN_TURN_CAP_USD, ceiling);
    return { cap, capped: true };
  } catch {
    // Last-resort totality net: treat as uncapped so the backstop guards.
    return { cap: ABSOLUTE_MAX_TURN_USD, capped: false };
  }
}

// ── Main governor ─────────────────────────────────────────────────────────────

/**
 * Decide the cheapest graceful economic lever for the next round of an
 * in-flight turn, from the dollars already burned this turn + the circle budget
 * state + the task shape. Consulted once per round by openswanSessionRuntime.
 *
 * Precedence (most-decisive first — cheapest lever first, escalate as levers are
 * spent). With D = alreadyDownshifted, S = alreadySummarized (strict === true):
 *   1. accrued >= ABSOLUTE_MAX_TURN_USD                              -> stop-and-ask
 *   2. spendRatio >= STOP_RATIO                                      -> stop-and-ask
 *   3. D && S && (spendRatio >= SUMMARIZE_RATIO || nextRoundBreaches)-> stop-and-ask
 *   4. spendRatio >= SUMMARIZE_RATIO (hot):
 *          !S -> summarize-and-continue ; else (S,!D) -> downshift
 *   5. spendRatio >= DOWNSHIFT_RATIO || nextRoundBreaches (warm / a pricey round):
 *          !D -> downshift ; else !S -> summarize-and-continue ; else -> continue
 *   6. otherwise                                                     -> continue
 *
 * Every branch is reachable and mutually consistent: rule 3 drains the D&&S
 * hot/breach cases before rules 4-5, so rule 4's `else` is exactly (S,!D) and
 * rule 5's final `continue` is exactly (D,S) with the next round proven to fit.
 *
 * TOTAL: the whole body is wrapped in a last-resort try/catch that fails OPEN to
 * 'continue' with a WARNING reason (bounded — see the module header).
 */
export function evaluateTurnSpend(state: TurnSpendState): SpendGovernorDecision {
  try {
    // Coerce accrued: garbage / negative / NaN -> 0; clamp <= MAX_ACCRUED_USD.
    let accrued = toFiniteNumber(safeGet(state, 'accruedTurnUsd'));
    if (accrued === null || accrued < 0) accrued = 0;
    if (accrued > MAX_ACCRUED_USD) accrued = MAX_ACCRUED_USD;

    // Coerce rounds: >= 0 integer; garbage -> 0.
    let rounds = toFiniteNumber(safeGet(state, 'roundsCompleted'));
    if (rounds === null || rounds < 0) rounds = 0;
    rounds = Math.floor(rounds);

    const { cap, capped } = resolveEffectiveTurnCap({
      perTurnSoftCapUsd: safeGet(state, 'perTurnSoftCapUsd'),
      circleSpentUsd: safeGet(state, 'circleSpentUsd'),
      circleCapUsd: safeGet(state, 'circleCapUsd'),
      taskValue: safeGet(state, 'taskValue'),
    });

    // cap is always > 0 (>= MIN_TURN_CAP_USD when capped, ABSOLUTE when not), so
    // this division can never be by zero.
    let spendRatio = accrued / cap;
    if (!Number.isFinite(spendRatio) || spendRatio < 0) spendRatio = 0;
    if (spendRatio > MAX_RATIO) spendRatio = MAX_RATIO;

    // Projected next-round burn = observed average $/round; null with no rounds.
    let projected: number | null = null;
    if (rounds > 0) {
      let p = accrued / rounds;
      if (!Number.isFinite(p) || p < 0) p = 0;
      if (p > MAX_ACCRUED_USD) p = MAX_ACCRUED_USD;
      projected = p;
    }
    const nextRoundBreaches = projected !== null && accrued + projected > cap;

    const D = safeGet(state, 'alreadyDownshifted') === true;
    const S = safeGet(state, 'alreadySummarized') === true;

    const r3 = round(spendRatio, 3);
    const aUsd = round(accrued, 4);
    const cUsd = round(cap, 4);
    const decide = (action: SpendGovernorAction, reason: string): SpendGovernorDecision => ({
      action,
      effectiveTurnCapUsd: cap,
      spendRatio,
      projectedNextRoundUsd: projected,
      nextRoundBreaches,
      capped,
      reason: sanitizeReason(reason),
    });

    // (1) Absolute per-turn backstop — fires even when otherwise uncapped.
    if (accrued >= ABSOLUTE_MAX_TURN_USD) {
      return decide(
        'stop-and-ask',
        `stop-and-ask: WARNING accrued $${aUsd} hit the absolute per-turn backstop $${ABSOLUTE_MAX_TURN_USD} — pausing for human review`,
      );
    }

    // (2) The composed per-turn cap is reached.
    if (spendRatio >= SPEND_GOVERNOR_STOP_RATIO) {
      return decide(
        'stop-and-ask',
        `stop-and-ask: turn spend cap reached (ratio ${r3}, $${aUsd}/$${cUsd}) — say continue to resume`,
      );
    }

    // (3) Both cheap levers already spent and still hot / would breach -> human.
    if (D && S && (spendRatio >= SPEND_GOVERNOR_SUMMARIZE_RATIO || nextRoundBreaches)) {
      return decide(
        'stop-and-ask',
        `stop-and-ask: both cost levers already spent and still hot (ratio ${r3}) — hand to human`,
      );
    }

    // (4) Hot band — pay a one-time summarize first, else (already summarized,
    //     not downshifted) drop to a cheaper model. D&&S is drained by rule 3.
    if (spendRatio >= SPEND_GOVERNOR_SUMMARIZE_RATIO) {
      if (!S) {
        return decide(
          'summarize-and-continue',
          `summarize-and-continue: hot spend (ratio ${r3}) — compact context to cut per-round cost`,
        );
      }
      return decide(
        'downshift',
        `downshift: hot spend (ratio ${r3}), already summarized — drop to a cheaper model`,
      );
    }

    // (5) Warm band, or one pricey round would breach the cap.
    if (spendRatio >= SPEND_GOVERNOR_DOWNSHIFT_RATIO || nextRoundBreaches) {
      const trigger =
        spendRatio >= SPEND_GOVERNOR_DOWNSHIFT_RATIO
          ? `warm spend (ratio ${r3})`
          : `projected next round $${round(projected || 0, 4)} would breach cap $${cUsd}`;
      if (!D) {
        return decide('downshift', `downshift: ${trigger} — drop to a cheaper model`);
      }
      if (!S) {
        return decide(
          'summarize-and-continue',
          `summarize-and-continue: ${trigger}, already downshifted — compact context`,
        );
      }
      // D && S here implies !nextRoundBreaches (rule 3 drained D&&S&&breach) and
      // the warm ratio triggered us — the next round fits, so continue.
      return decide(
        'continue',
        `continue: ${trigger} but both levers spent and next round fits (ratio ${r3})`,
      );
    }

    // (6) Comfortably under the turn's dollar cap.
    return decide(
      'continue',
      `continue: within turn spend budget (ratio ${r3}, $${aUsd}/$${cUsd})`,
    );
  } catch {
    // Absolute last-resort totality net: never throw. Fail OPEN to a conservative
    // continue, explicitly flagged so it is never a silent runaway (bounded by
    // rule 1's accrued backstop + the loop's independent step/iteration caps).
    return {
      action: 'continue',
      effectiveTurnCapUsd: ABSOLUTE_MAX_TURN_USD,
      spendRatio: 0,
      projectedNextRoundUsd: null,
      nextRoundBreaches: false,
      capped: false,
      reason:
        'continue: WARNING turn-spend evaluation failed on malformed input — guarding with the absolute backstop',
    };
  }
}
