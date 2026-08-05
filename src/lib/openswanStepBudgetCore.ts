// openswanStepBudgetCore — the PURE per-RUN STEP BUDGET guard. A long agent turn
// runs a bounded model/tool loop: agentExecutionCore.runAgent loops up to
// `maxIterations` model rounds (default 25), and openswanSessionRuntime clamps
// each turn to `maxRounds = Math.max(1, Math.min(MAX_TOOL_ROUNDS, …))` where
// MAX_TOOL_ROUNDS = 5. Each such round is a "step". Without a live budget guard
// a run that keeps calling tools (e.g. a model re-planning around a blocker)
// eats the whole cap and then dies at `max_iterations_exceeded` with no graceful
// stop — the comment in agentExecutionCore says it plainly: "raising the
// iteration cap would only make a runaway more expensive." This core turns the
// current step/tool-call counts into a graceful decision EACH ROUND:
//
//     evaluateStepBudget({ stepsUsed, maxSteps, toolCallsUsed, maxToolCalls,
//                          progressStalled })
//        -> { action: 'continue' | 'checkpoint' | 'stop', remaining, reason }
//
//   - 'continue'   : comfortably under budget and not stalled — run the round.
//   - 'checkpoint' : nearing a ceiling — persist a resumable checkpoint NOW
//                    (the same incomplete+checkpoint shape openswanSessionRuntime
//                    already stores on cap exhaustion) and start wrapping up,
//                    so nothing is lost when the hard stop lands next round.
//   - 'stop'       : a ceiling is reached, or progress is CONFIRMED stalled —
//                    do not start another round; finalize and end.
//
// This is DISTINCT from spend budgets (sessionCapabilityBudgetCore / budgetMath /
// runCostRollupCore / swanbotContinuationBudgetCore count dollars & tokens); this
// counts *steps* — the shape of the loop, not its cost. It is also distinct from
// runStallPolicyCore (a background reaper that decides whether an `agent_runs`
// row is a zombie); this is a live in-loop guard the turn consults itself.
//
// PURITY: ZERO runtime imports (type-free), tsx-loadable. No clock, no
// Date.now()/Math.random() — counts are always INPUTS. Every export is TOTAL:
// null / undefined / wrong-type / NaN / Infinity / negative / hostile
// (throwing-getter) input never throws; it degrades to a CONSERVATIVE result.
//
// FAIL-SAFE BIAS (the only safe direction): the dangerous failure is a *silent
// runaway*, and the second-worst is halting a healthy run on a broken budget
// config. So an unknown/degenerate budget yields 'continue' with a WARNING
// reason (observable, never silent) — while an ALWAYS-ON absolute backstop
// (STEP_BUDGET_ABSOLUTE_MAX_STEPS / _TOOL_CALLS) guarantees even a run with no
// configured budget still stops eventually, so "conservative continue" can never
// become an infinite loop. A stall only stops on the STRICT `=== true` signal,
// so ambiguous input can never trigger a spurious stop.

// ── Tunables (exported so the loop wiring shares the exact same policy) ─────────

/** Persist a checkpoint once the binding ceiling is within this many steps.
 *  1 ⇒ the round BEFORE the ceiling gets a graceful checkpoint (e.g. at 4/5). */
export const STEP_BUDGET_CHECKPOINT_MARGIN = 1;

/** …or once this fraction of the binding budget is consumed — catches large
 *  budgets early (e.g. 20/25 ⇒ 0.8) where a margin of 1 would fire too late. */
export const STEP_BUDGET_CHECKPOINT_RATIO = 0.8;

/** Always-on safety backstop on STEPS. Even with no configured `maxSteps`, a run
 *  that reaches this many rounds is a runaway and is stopped — this is what makes
 *  "conservative continue" bounded rather than silent. Deliberately far above any
 *  real per-turn cap (MAX_TOOL_ROUNDS = 5, runAgent default maxIterations = 25)
 *  so it only ever catches genuine pathology, never a legitimate long run. */
export const STEP_BUDGET_ABSOLUTE_MAX_STEPS = 1000;

/** Always-on safety backstop on TOOL CALLS (a run can issue several per step). */
export const STEP_BUDGET_ABSOLUTE_MAX_TOOL_CALLS = 5000;

/** Bound on the returned `reason` string (secret-safe: reasons are built only
 *  from the numeric counts this core is given, never from user content). */
const MAX_REASON_LEN = 200;

// ── Types ───────────────────────────────────────────────────────────────────────

export type StepBudgetAction = 'continue' | 'checkpoint' | 'stop';

/** All fields are `unknown` on purpose — this core is the fail-safe boundary and
 *  coerces every input itself, so a caller can pass raw runtime values. */
export interface StepBudgetInput {
  /** Model rounds consumed so far this RUN (agentExecutionCore `iteration`). */
  stepsUsed?: unknown;
  /** Ceiling on steps for this run (e.g. the turn's resolved maxRounds). */
  maxSteps?: unknown;
  /** Tool calls dispatched so far this run (a secondary, tighter dimension). */
  toolCallsUsed?: unknown;
  /** Ceiling on tool calls for this run. */
  maxToolCalls?: unknown;
  /** STRICT `true` only when the loop has CONFIRMED no forward progress
   *  (e.g. detectRepeatedToolFailure tripped / `loop_stopped_no_progress`). */
  progressStalled?: unknown;
}

export interface StepBudgetDecision {
  action: StepBudgetAction;
  /** Steps/tool-calls left before the TIGHTEST active ceiling (real budget or
   *  the absolute backstop). Always a finite integer >= 0 — never Infinity. */
  remaining: number;
  /** Deterministic, secret-safe explanation of the decision. */
  reason: string;
}

// ── Internal coercion (total) ────────────────────────────────────────────────────

/** Read one field off a possibly-hostile input without ever throwing. */
function safeRead(input: unknown, key: keyof StepBudgetInput): unknown {
  if (!input || typeof input !== 'object') return undefined;
  try {
    return (input as Record<string, unknown>)[key as string];
  } catch {
    return undefined; // hostile throwing getter → treat as absent
  }
}

/** A used-count: unknown / NaN / Infinity / negative ⇒ 0 (the safe floor —
 *  a run that reports no progress is treated as at its start), else floored. */
function toCount(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

/** A ceiling: a finite POSITIVE number ⇒ floored; anything else (unknown / NaN /
 *  Infinity / <= 0) ⇒ null, meaning "no real budget configured for this axis". */
function toCeiling(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return Math.floor(v);
}

function clampReason(reason: string): string {
  return reason.length > MAX_REASON_LEN ? reason.slice(0, MAX_REASON_LEN) : reason;
}

// ── Per-dimension analysis ───────────────────────────────────────────────────────

interface DimensionState {
  label: 'step' | 'tool-call';
  plural: string;
  used: number;
  /** The configured budget, or null when none was supplied. */
  realCeiling: number | null;
  /** min(realCeiling ?? ∞, absoluteBackstop) — the ceiling actually enforced. */
  effectiveCeiling: number;
  /** True when the effective ceiling IS the absolute backstop (no real budget,
   *  or a real budget looser than the backstop) — drives the WARNING wording. */
  boundedByAbsolute: boolean;
  remaining: number;
  exhausted: boolean;
  near: boolean;
}

function analyzeDimension(
  label: 'step' | 'tool-call',
  plural: string,
  used: number,
  rawCeiling: unknown,
  absolute: number,
): DimensionState {
  const realCeiling = toCeiling(rawCeiling);
  const effectiveCeiling = realCeiling === null ? absolute : Math.min(realCeiling, absolute);
  const boundedByAbsolute = realCeiling === null || realCeiling > absolute;
  const remaining = Math.max(0, effectiveCeiling - used);
  const exhausted = used >= effectiveCeiling;
  const ratio = effectiveCeiling > 0 ? used / effectiveCeiling : 1;
  const near =
    !exhausted &&
    (remaining <= STEP_BUDGET_CHECKPOINT_MARGIN || ratio >= STEP_BUDGET_CHECKPOINT_RATIO);
  return {
    label,
    plural,
    used,
    realCeiling,
    effectiveCeiling,
    boundedByAbsolute,
    remaining,
    exhausted,
    near,
  };
}

/** Of two dimensions, the one with the least remaining budget (ties → steps). */
function bindingDimension(steps: DimensionState, tools: DimensionState): DimensionState {
  return tools.remaining < steps.remaining ? tools : steps;
}

// ── Main guard ───────────────────────────────────────────────────────────────────

/**
 * Decide whether a run should keep going, checkpoint, or stop, given how many
 * steps / tool calls it has used against its (optional) budgets. Consulted once
 * per round by openswanSessionRuntime. TOTAL — any input, including hostile
 * objects with throwing getters, yields a safe decision instead of a throw.
 *
 * Precedence (most-decisive first):
 *   1. CONFIRMED stall (`progressStalled === true`)        → stop
 *   2. any ceiling reached (real budget or absolute backstop) → stop
 *   3. binding ceiling within margin / ratio               → checkpoint
 *   4. otherwise                                           → continue
 *      (with a WARNING reason when no real budget bounds the run)
 */
export function evaluateStepBudget(input: StepBudgetInput): StepBudgetDecision {
  try {
    const stepsUsed = toCount(safeRead(input, 'stepsUsed'));
    const toolCallsUsed = toCount(safeRead(input, 'toolCallsUsed'));
    const progressStalled = safeRead(input, 'progressStalled') === true;

    const steps = analyzeDimension(
      'step', 'steps', stepsUsed, safeRead(input, 'maxSteps'), STEP_BUDGET_ABSOLUTE_MAX_STEPS,
    );
    const tools = analyzeDimension(
      'tool-call', 'tool calls', toolCallsUsed, safeRead(input, 'maxToolCalls'), STEP_BUDGET_ABSOLUTE_MAX_TOOL_CALLS,
    );

    const binding = bindingDimension(steps, tools);
    const remaining = binding.remaining;

    // (1) Confirmed stall — stop even with budget left. Mirrors the runtime's
    //     progress-based `loop_stopped_no_progress` exit: re-running with no
    //     forward progress only makes a runaway more expensive.
    if (progressStalled) {
      return {
        action: 'stop',
        remaining,
        reason: clampReason(
          `stop: progress confirmed stalled — halt to avoid a runaway (${steps.used}/${steps.effectiveCeiling} steps used)`,
        ),
      };
    }

    // (2) A ceiling reached — hard stop. Steps first (the primary dimension),
    //     then tool calls. When the binding ceiling is the absolute backstop the
    //     reason WARNS that no real budget was configured (never silent).
    if (steps.exhausted) {
      return { action: 'stop', remaining, reason: clampReason(exhaustionReason(steps)) };
    }
    if (tools.exhausted) {
      return { action: 'stop', remaining, reason: clampReason(exhaustionReason(tools)) };
    }

    // (3) Nearing a ceiling — checkpoint gracefully while a round still remains.
    if (steps.near || tools.near) {
      const near = tools.near && (!steps.near || tools.remaining < steps.remaining) ? tools : steps;
      return { action: 'checkpoint', remaining, reason: clampReason(nearReason(near)) };
    }

    // (4) Comfortably under budget — continue. If NO real budget bounds the
    //     binding dimension, continue but WARN so the missing budget is
    //     observable and the absolute backstop is doing the guarding.
    return {
      action: 'continue',
      remaining,
      reason: clampReason(continueReason(binding)),
    };
  } catch {
    // Absolute last-resort totality net: never throw. Conservative continue,
    // explicitly flagged so it is never a silent runaway.
    return {
      action: 'continue',
      remaining: STEP_BUDGET_ABSOLUTE_MAX_STEPS,
      reason:
        'continue: WARNING step-budget evaluation failed on malformed input — guarding with the absolute backstop',
    };
  }
}

// `boundedByAbsolute` covers BOTH "no budget configured" and "a real budget so
// loose the backstop binds first" — "no effective budget" reads true for both.
function exhaustionReason(dim: DimensionState): string {
  if (dim.boundedByAbsolute) {
    return `stop: WARNING absolute safety backstop reached (${dim.used}/${dim.effectiveCeiling} ${dim.plural}) — no effective ${dim.label} budget`;
  }
  return `stop: ${dim.label} budget exhausted (${dim.used}/${dim.effectiveCeiling} ${dim.plural})`;
}

function nearReason(dim: DimensionState): string {
  if (dim.boundedByAbsolute) {
    return `checkpoint: WARNING nearing absolute backstop (${dim.used}/${dim.effectiveCeiling} ${dim.plural}, ${dim.remaining} left) — no effective ${dim.label} budget`;
  }
  return `checkpoint: nearing ${dim.label} budget (${dim.used}/${dim.effectiveCeiling} ${dim.plural}, ${dim.remaining} left)`;
}

function continueReason(dim: DimensionState): string {
  if (dim.boundedByAbsolute) {
    return `continue: WARNING no effective ${dim.label} budget — guarding with absolute backstop (${dim.used}/${dim.effectiveCeiling} ${dim.plural})`;
  }
  return `continue: within ${dim.label} budget (${dim.used}/${dim.effectiveCeiling} ${dim.plural}, ${dim.remaining} left)`;
}
