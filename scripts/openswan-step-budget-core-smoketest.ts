/**
 * openswan-step-budget-core-smoketest — the pure per-RUN STEP BUDGET guard
 * (src/lib/openswanStepBudgetCore.ts). openswanSessionRuntime consults
 * evaluateStepBudget each round so a long run CHECKPOINTS instead of running
 * away, distinct from spend budgets (dollars/tokens). Load-bearing assertions:
 *
 *   UNDER BUDGET + PROGRESS → 'continue'; NEARING a ceiling (within margin, or
 *   past the ratio) → 'checkpoint' while a round still remains; AT a ceiling or
 *   on a CONFIRMED stall (`progressStalled === true`, strict) → 'stop'.
 *
 *   FAIL-SAFE: an unknown/degenerate budget never halts a healthy run — it
 *   'continue's with a WARNING reason (never silent) — while an always-on
 *   absolute backstop still stops a genuine no-budget runaway, so "continue"
 *   can never become infinite. A stall only fires on strict `true`, so
 *   ambiguous input can never trigger a spurious stop.
 *
 *   TOTAL: null / undefined / wrong-type / NaN / Infinity / negative / huge /
 *   hostile (throwing getters) / cyclic input never throws.
 *
 * Pure — loads under tsx (openswanStepBudgetCore has zero imports).
 */

import {
  STEP_BUDGET_CHECKPOINT_MARGIN,
  STEP_BUDGET_CHECKPOINT_RATIO,
  STEP_BUDGET_ABSOLUTE_MAX_STEPS,
  STEP_BUDGET_ABSOLUTE_MAX_TOOL_CALLS,
  evaluateStepBudget,
  type StepBudgetDecision,
  type StepBudgetAction,
} from '../src/lib/openswanStepBudgetCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function assertIncludes(hay: string, needle: string, msg: string): void {
  assert(typeof hay === 'string' && hay.includes(needle), msg, `"${hay}" missing "${needle}"`);
}
const ACTIONS: ReadonlySet<StepBudgetAction> = new Set(['continue', 'checkpoint', 'stop']);
/** A decision is well-formed: valid action, finite integer remaining >= 0, bounded non-empty reason. */
function wellFormed(d: StepBudgetDecision): boolean {
  return (
    !!d && typeof d === 'object' &&
    ACTIONS.has(d.action) &&
    typeof d.remaining === 'number' && Number.isFinite(d.remaining) &&
    Number.isInteger(d.remaining) && d.remaining >= 0 &&
    typeof d.reason === 'string' && d.reason.length > 0 && d.reason.length <= 200
  );
}
/** Calls the guard on hostile input; records a failure (not a crash) on throw. */
function noThrow(label: string, fn: () => StepBudgetDecision): StepBudgetDecision {
  try {
    const d = fn();
    assert(wellFormed(d), `${label} → well-formed decision`, JSON.stringify(d));
    return d;
  } catch (err) {
    assert(false, `${label} → must not throw`, String(err));
    return { action: 'stop', remaining: 0, reason: 'threw' };
  }
}

function main(): void {
  // ─── (1) tunable constants ────────────────────────────────────────────────
  assertEq(STEP_BUDGET_CHECKPOINT_MARGIN, 1, '(1) checkpoint margin = 1');
  assertEq(STEP_BUDGET_CHECKPOINT_RATIO, 0.8, '(1) checkpoint ratio = 0.8');
  assertEq(STEP_BUDGET_ABSOLUTE_MAX_STEPS, 1000, '(1) absolute step backstop = 1000');
  assertEq(STEP_BUDGET_ABSOLUTE_MAX_TOOL_CALLS, 5000, '(1) absolute tool-call backstop = 5000');
  assert(STEP_BUDGET_ABSOLUTE_MAX_STEPS > 25, '(1) backstop is well above runAgent maxIterations (25)');

  // ─── (2) under budget + progress → continue ───────────────────────────────
  const c1 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 25 });
  assertEq(c1.action, 'continue', '(2) 2/25 steps → continue');
  assertEq(c1.remaining, 23, '(2) 2/25 → 23 remaining');
  assertIncludes(c1.reason, 'continue:', '(2) reason marks continue');
  assertIncludes(c1.reason, 'within step budget', '(2) healthy continue wording');
  assert(!c1.reason.includes('WARNING'), '(2) a configured budget does NOT warn');

  const c2 = evaluateStepBudget({ stepsUsed: 0, maxSteps: 5 });
  assertEq(c2.action, 'continue', '(2) fresh run 0/5 → continue');
  assertEq(c2.remaining, 5, '(2) 0/5 → 5 remaining');

  const c3 = evaluateStepBudget({ stepsUsed: 19, maxSteps: 25 });
  assertEq(c3.action, 'continue', '(2) 19/25 (ratio 0.76) → still continue');
  assertEq(c3.remaining, 6, '(2) 19/25 → 6 remaining');

  const c4 = evaluateStepBudget({ stepsUsed: 1, maxSteps: 5, toolCallsUsed: 3, maxToolCalls: 40 });
  assertEq(c4.action, 'continue', '(2) both dims healthy → continue');
  assertEq(c4.remaining, 4, '(2) binding = steps (4) < tool remaining (37)');

  // ─── (3) nearing the ceiling (margin) → checkpoint ────────────────────────
  const k1 = evaluateStepBudget({ stepsUsed: 4, maxSteps: 5 });
  assertEq(k1.action, 'checkpoint', '(3) 4/5 (1 left) → checkpoint');
  assertEq(k1.remaining, 1, '(3) 4/5 → 1 remaining');
  assertIncludes(k1.reason, 'checkpoint:', '(3) reason marks checkpoint');
  assertIncludes(k1.reason, 'nearing step budget', '(3) near wording');

  const k2 = evaluateStepBudget({ stepsUsed: 1, maxSteps: 2 });
  assertEq(k2.action, 'checkpoint', '(3) 1/2 (1 left) → checkpoint');
  assertEq(k2.remaining, 1, '(3) 1/2 → 1 remaining');

  // ─── (4) nearing the ceiling (ratio, large budget) → checkpoint ───────────
  const k3 = evaluateStepBudget({ stepsUsed: 20, maxSteps: 25 });
  assertEq(k3.action, 'checkpoint', '(4) 20/25 (ratio 0.8) → checkpoint');
  assertEq(k3.remaining, 5, '(4) 20/25 → 5 remaining (ratio path, margin=1 would miss)');
  const k4 = evaluateStepBudget({ stepsUsed: 8, maxSteps: 10 });
  assertEq(k4.action, 'checkpoint', '(4) 8/10 (ratio 0.8) → checkpoint');

  // ─── (5) at the ceiling → stop ────────────────────────────────────────────
  const s1 = evaluateStepBudget({ stepsUsed: 5, maxSteps: 5 });
  assertEq(s1.action, 'stop', '(5) 5/5 → stop');
  assertEq(s1.remaining, 0, '(5) 5/5 → 0 remaining');
  assertIncludes(s1.reason, 'stop:', '(5) reason marks stop');
  assertIncludes(s1.reason, 'step budget exhausted', '(5) exhausted wording');
  assert(!s1.reason.includes('WARNING'), '(5) a real budget exhaustion is not a WARNING');

  const s2 = evaluateStepBudget({ stepsUsed: 9, maxSteps: 5 });
  assertEq(s2.action, 'stop', '(5) over ceiling (9/5) → stop');
  assertEq(s2.remaining, 0, '(5) over ceiling → remaining clamps to 0');

  // ─── (6) tool-call dimension: binds, exhausts, near ───────────────────────
  const t1 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 25, toolCallsUsed: 40, maxToolCalls: 40 });
  assertEq(t1.action, 'stop', '(6) tool calls 40/40 → stop even with steps left');
  assertEq(t1.remaining, 0, '(6) tool exhaustion → 0 remaining');
  assertIncludes(t1.reason, 'tool-call budget exhausted', '(6) tool exhaustion wording');

  const t2 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 25, toolCallsUsed: 38, maxToolCalls: 40 });
  assertEq(t2.action, 'checkpoint', '(6) tool calls 38/40 (ratio 0.95) → checkpoint');
  assertEq(t2.remaining, 2, '(6) binding = tool calls (2) < steps (23)');
  assertIncludes(t2.reason, 'tool-call', '(6) near reason cites the binding tool-call dim');

  const t3 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 25, toolCallsUsed: 10, maxToolCalls: 40 });
  assertEq(t3.action, 'continue', '(6) both dims healthy → continue');
  assertEq(t3.remaining, 23, '(6) binding = steps (23) < tool remaining (30)');

  // ─── (7) confirmed stall → stop (strict === true only) ────────────────────
  const st1 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 25, progressStalled: true });
  assertEq(st1.action, 'stop', '(7) confirmed stall → stop even with budget left');
  assertEq(st1.remaining, 23, '(7) stall reports remaining budget honestly');
  assertIncludes(st1.reason, 'stalled', '(7) stall reason names the stall');

  const st2 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 25, progressStalled: 'yes' as unknown });
  assertEq(st2.action, 'continue', "(7) truthy-but-not-true ('yes') is NOT a confirmed stall");
  const st3 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 25, progressStalled: 1 as unknown });
  assertEq(st3.action, 'continue', '(7) numeric 1 is NOT a confirmed stall');
  const st4 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 25, progressStalled: false });
  assertEq(st4.action, 'continue', '(7) explicit false → continue');
  // A stall on a fresh run still stops (progress is what matters, not budget).
  const st5 = evaluateStepBudget({ stepsUsed: 0, maxSteps: 25, progressStalled: true });
  assertEq(st5.action, 'stop', '(7) stall at step 0 → stop');

  // ─── (8) fail-safe: unknown budget → continue with a WARNING (never silent) ─
  const u1 = evaluateStepBudget({});
  assertEq(u1.action, 'continue', '(8) no budget at all → conservative continue');
  assertEq(u1.remaining, STEP_BUDGET_ABSOLUTE_MAX_STEPS, '(8) remaining falls back to the step backstop');
  assertIncludes(u1.reason, 'WARNING', '(8) unknown budget is flagged, not silent');
  assertIncludes(u1.reason, 'absolute backstop', '(8) says the backstop is guarding');

  const u2 = evaluateStepBudget({ stepsUsed: 3 });
  assertEq(u2.action, 'continue', '(8) used steps but no ceiling → continue');
  assertEq(u2.remaining, STEP_BUDGET_ABSOLUTE_MAX_STEPS - 3, '(8) remaining = backstop - used');
  assertIncludes(u2.reason, 'WARNING', '(8) still warns with a used count present');

  const u3 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 0 });
  assertEq(u3.action, 'continue', '(8) degenerate maxSteps=0 treated as unconfigured, not instant-stop');
  assertIncludes(u3.reason, 'WARNING', '(8) maxSteps=0 warns');
  const u4 = evaluateStepBudget({ stepsUsed: 2, maxSteps: -3 });
  assertEq(u4.action, 'continue', '(8) negative maxSteps → unconfigured → continue');
  const u5 = evaluateStepBudget({ stepsUsed: 2, maxSteps: Number.NaN });
  assertEq(u5.action, 'continue', '(8) NaN maxSteps → unconfigured → continue');
  const u6 = evaluateStepBudget({ stepsUsed: 2, maxSteps: Infinity });
  assertEq(u6.action, 'continue', '(8) Infinity maxSteps → unconfigured → continue');
  // Configured STEP budget but unconfigured TOOL budget stays healthy (no warn):
  const u7 = evaluateStepBudget({ stepsUsed: 2, maxSteps: 5 });
  assertEq(u7.action, 'continue', '(8) step budget set, tool budget absent → continue');
  assert(!u7.reason.includes('WARNING'), '(8) a set step budget suppresses the warning');

  // ─── (9) absolute backstop bounds a no-budget runaway (never infinite) ────
  const b1 = evaluateStepBudget({ stepsUsed: STEP_BUDGET_ABSOLUTE_MAX_STEPS });
  assertEq(b1.action, 'stop', '(9) reaching the absolute step backstop → stop');
  assertEq(b1.remaining, 0, '(9) backstop reached → 0 remaining');
  assertIncludes(b1.reason, 'WARNING', '(9) backstop stop warns no budget was configured');
  assertIncludes(b1.reason, 'backstop', '(9) backstop stop names the backstop');

  const b2 = evaluateStepBudget({ stepsUsed: 1_000_000 });
  assertEq(b2.action, 'stop', '(9) runaway far past the backstop → stop');
  assertEq(b2.remaining, 0, '(9) far past backstop → remaining clamps to 0');

  const b3 = evaluateStepBudget({ toolCallsUsed: STEP_BUDGET_ABSOLUTE_MAX_TOOL_CALLS });
  assertEq(b3.action, 'stop', '(9) reaching the absolute tool-call backstop → stop');

  // A real budget looser than the backstop is still bounded by the backstop:
  const b4 = evaluateStepBudget({ stepsUsed: 1500, maxSteps: 1_000_000_000 });
  assertEq(b4.action, 'stop', '(9) huge real budget still bounded by the backstop');
  assertEq(b4.remaining, 0, '(9) used(1500) past backstop(1000) → stop, 0 remaining');
  assertIncludes(b4.reason, 'WARNING', '(9) looser-than-backstop real budget warns at the backstop');

  // ─── (10) remaining invariants & binding = min(active ceilings) ───────────
  const grid: Array<{ stepsUsed: number; maxSteps: number; toolCallsUsed: number; maxToolCalls: number }> = [
    { stepsUsed: 0, maxSteps: 5, toolCallsUsed: 0, maxToolCalls: 10 },
    { stepsUsed: 3, maxSteps: 5, toolCallsUsed: 7, maxToolCalls: 10 },
    { stepsUsed: 4, maxSteps: 5, toolCallsUsed: 2, maxToolCalls: 10 },
    { stepsUsed: 2, maxSteps: 8, toolCallsUsed: 9, maxToolCalls: 10 },
  ];
  for (const g of grid) {
    const d = evaluateStepBudget(g);
    assert(wellFormed(d), '(10) grid decision well-formed', JSON.stringify({ g, d }));
    const stepRem = Math.max(0, Math.min(g.maxSteps, STEP_BUDGET_ABSOLUTE_MAX_STEPS) - g.stepsUsed);
    const toolRem = Math.max(0, Math.min(g.maxToolCalls, STEP_BUDGET_ABSOLUTE_MAX_TOOL_CALLS) - g.toolCallsUsed);
    assertEq(d.remaining, Math.min(stepRem, toolRem), '(10) remaining = min(step, tool) remaining');
  }

  // ─── (11) coercion: NaN / Infinity / negative / float used counts ─────────
  assertEq(evaluateStepBudget({ stepsUsed: 3.9, maxSteps: 5 }).remaining, 2, '(11) float used floors (3.9→3)');
  assertEq(evaluateStepBudget({ stepsUsed: -5, maxSteps: 5 }).remaining, 5, '(11) negative used floors to 0');
  const inf = evaluateStepBudget({ stepsUsed: Infinity, maxSteps: 5 });
  assert(ACTIONS.has(inf.action), '(11) Infinity used → valid action (coerced to 0)');
  assertEq(inf.remaining, 5, '(11) Infinity used coerces to 0 → 5 remaining');
  const nanUsed = evaluateStepBudget({ stepsUsed: Number.NaN, maxSteps: 5 });
  assertEq(nanUsed.remaining, 5, '(11) NaN used coerces to 0');
  assertEq(evaluateStepBudget({ stepsUsed: 4.2, maxSteps: 5 }).action, 'checkpoint', '(11) 4.2→4, 4/5 → checkpoint');
  assertEq(evaluateStepBudget({ toolCallsUsed: 3, maxToolCalls: 4.9 }).action, 'checkpoint', '(11) tool ceiling floors (4.9→4): 3/4 (1 left) → checkpoint');
  assertEq(evaluateStepBudget({ toolCallsUsed: 4, maxToolCalls: 4.9 }).action, 'stop', '(11) tool ceiling floors (4.9→4): 4/4 → stop');

  // ─── (12) HOSTILE — must never throw, always well-formed ──────────────────
  noThrow('(12) null input', () => evaluateStepBudget(null as unknown as Record<string, never>));
  noThrow('(12) undefined input', () => evaluateStepBudget(undefined as unknown as Record<string, never>));
  noThrow('(12) number input', () => evaluateStepBudget(123 as unknown as Record<string, never>));
  noThrow('(12) string input', () => evaluateStepBudget('nope' as unknown as Record<string, never>));
  noThrow('(12) array input', () => evaluateStepBudget([] as unknown as Record<string, never>));
  noThrow('(12) boolean input', () => evaluateStepBudget(true as unknown as Record<string, never>));
  noThrow('(12) symbol fields', () => evaluateStepBudget({ stepsUsed: Symbol('x') as unknown, maxSteps: Symbol('y') as unknown }));
  noThrow('(12) bigint fields', () => evaluateStepBudget({ stepsUsed: 10n as unknown, maxSteps: 5n as unknown }));
  noThrow('(12) object fields', () => evaluateStepBudget({ stepsUsed: { valueOf() { throw new Error('no'); } } as unknown, maxSteps: {} as unknown }));
  noThrow('(12) function fields', () => evaluateStepBudget({ stepsUsed: (() => 3) as unknown, maxSteps: (() => 5) as unknown }));
  noThrow('(12) huge safe-int budget', () => evaluateStepBudget({ stepsUsed: Number.MAX_SAFE_INTEGER, maxSteps: Number.MAX_SAFE_INTEGER }));
  noThrow('(12) -Infinity budget', () => evaluateStepBudget({ stepsUsed: -Infinity, maxSteps: -Infinity }));

  // Throwing getters on EVERY field — the classic hostile object.
  const throwing: Record<string, unknown> = {};
  for (const key of ['stepsUsed', 'maxSteps', 'toolCallsUsed', 'maxToolCalls', 'progressStalled']) {
    Object.defineProperty(throwing, key, { get() { throw new Error(`boom:${key}`); }, enumerable: true });
  }
  const hg = noThrow('(12) throwing getters', () => evaluateStepBudget(throwing as Record<string, never>));
  assertEq(hg.action, 'continue', '(12) all-throwing input degrades to conservative continue');
  assertIncludes(hg.reason, 'WARNING', '(12) degraded decision is flagged, not silent');

  // Cyclic object with real fields mixed in.
  const cyclic: Record<string, unknown> = { stepsUsed: 3, maxSteps: 5 };
  cyclic.self = cyclic;
  const cy = noThrow('(12) cyclic input', () => evaluateStepBudget(cyclic as Record<string, never>));
  assertEq(cy.remaining, 2, '(12) cyclic object still reads its real fields (3/5 → 2 left)');

  // Hostile progressStalled getter that throws must not force a stop.
  const stallThrows: Record<string, unknown> = { stepsUsed: 2, maxSteps: 25 };
  Object.defineProperty(stallThrows, 'progressStalled', { get() { throw new Error('x'); }, enumerable: true });
  const stx = noThrow('(12) throwing progressStalled', () => evaluateStepBudget(stallThrows as Record<string, never>));
  assertEq(stx.action, 'continue', '(12) a throwing stall signal is treated as not-stalled');

  // Every reason across a broad sweep stays bounded & non-empty.
  const sweep = [u1, u2, u3, c1, c2, c3, k1, k3, s1, t1, t2, st1, b1, b4, hg, cy, stx];
  for (const d of sweep) {
    assert(d.reason.length > 0 && d.reason.length <= 200, '(12) reason bounded & non-empty', JSON.stringify(d.reason));
  }
}

main();

if (failures > 0) {
  console.error(`\nopenswanStepBudgetCore smoke: ${failures} FAILED, ${passes} passed`);
  process.exit(1);
}
console.log(`\nAll ${passes} assertions passed — openswanStepBudgetCore is sound.`);
