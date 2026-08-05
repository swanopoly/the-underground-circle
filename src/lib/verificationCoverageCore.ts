/**
 * verificationCoverageCore — pure scoring for verification coverage (verification opt v7).
 *
 * Problem it fixes: src/lib/openswanObservedEvals.ts computes
 *   coverageRatio = executedVerification / plannedVerification.length
 * where plannedVerification is the metadata.verificationPlan array — i.e. EVERY
 * planned check, including manual-only kinds (manual_review / security_review /
 * performance_review / integration_review from OpenSwanVerificationKind in
 * openswanTaskPlanner.ts). Those kinds can never be machine-executed, so counting
 * them in the denominator permanently drags coverageRatio below 1 even when a run
 * fully verified every AUTO-verifiable check (typecheck / tests / lint / build /
 * preview). This module scores coverage ONLY against the auto-verifiable planned
 * checks, so a run that ran every machine check it could scores 1.0 regardless of
 * how many manual checks were also planned.
 *
 * Each verificationPlan item is stored as { label, kind, required } (see
 * openswanSessionRuntime.ts ~1321); this core reads only `.kind`.
 *
 * Purity: zero runtime imports (loads under tsx). No Date.now()/Math.random().
 * Every export is TOTAL — null / undefined / wrong-type / huge / hostile / cyclic
 * input yields a safe neutral result and never throws. Bounded (the planned-check
 * scan is capped). Secret-safe (no logging, no reflection of input into output).
 */

export type VerificationCoverageInput = {
  plannedChecks?: unknown;
  executedCount?: unknown;
};

export type VerificationCoverageResult = {
  /** executed / auto-verifiable-planned, clamped to 0..1 and rounded to 2 decimals. */
  coverageRatio: number;
  /** Count of planned checks whose kind is machine-checkable (the denominator). */
  autoVerifiablePlanned: number;
  /** True only when >=1 auto-verifiable check was planned and all of them ran. */
  fullyVerified: boolean;
};

/**
 * Machine-checkable verification kinds. These are the only kinds whose execution
 * can be automatically proven, so only they belong in the coverage denominator.
 * Mirrors the auto-verifiable subset of OpenSwanVerificationKind in
 * openswanTaskPlanner.ts; 'build' is included as a forward-compatible machine kind.
 * Manual kinds (manual_review / security_review / performance_review /
 * integration_review) are deliberately excluded.
 */
export const AUTO_VERIFIABLE_CHECK_KINDS: ReadonlySet<string> = new Set<string>([
  'typecheck',
  'tests',
  'lint',
  'build',
  'preview',
]);

/** Upper bound on planned-check scan work for a hostile/huge array. */
const MAX_PLANNED_CHECKS = 100_000;
/** Upper bound on the executed count so a huge value stays sane (ratio clamps anyway). */
const MAX_EXECUTED_COUNT = 10_000_000;

const NEUTRAL_RESULT: VerificationCoverageResult = {
  coverageRatio: 0,
  autoVerifiablePlanned: 0,
  fullyVerified: false,
};

/**
 * True only for machine-checkable kinds. Total: non-strings, empty/whitespace, and
 * unknown kinds → false. Normalizes case and surrounding whitespace so hostile
 * casing ('  TypeCheck  ') still resolves.
 */
export function isAutoVerifiable(kind: unknown): boolean {
  if (typeof kind !== 'string') return false;
  const normalized = kind.trim().toLowerCase();
  if (!normalized) return false;
  return AUTO_VERIFIABLE_CHECK_KINDS.has(normalized);
}

/** Pull a candidate kind off a planned-check entry without traversing/throwing. */
function extractCheckKind(item: unknown): unknown {
  if (typeof item === 'string') return item;
  if (!item || typeof item !== 'object') return undefined;
  try {
    return (item as { kind?: unknown }).kind;
  } catch {
    // Hostile getter — treat as no kind.
    return undefined;
  }
}

/** Count planned checks whose kind is auto-verifiable. Bounded and never throws. */
function countAutoVerifiablePlanned(plannedChecks: unknown): number {
  if (!Array.isArray(plannedChecks)) return 0;
  const length = plannedChecks.length;
  const limit = length > MAX_PLANNED_CHECKS ? MAX_PLANNED_CHECKS : length;
  let count = 0;
  for (let index = 0; index < limit; index += 1) {
    let item: unknown;
    try {
      item = plannedChecks[index];
    } catch {
      // Hostile indexed getter — skip this slot.
      continue;
    }
    if (isAutoVerifiable(extractCheckKind(item))) count += 1;
  }
  return count;
}

/** Coerce an executed count to a non-negative, finite, bounded integer. */
function toExecutedCount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  const floored = Math.floor(value);
  return floored > MAX_EXECUTED_COUNT ? MAX_EXECUTED_COUNT : floored;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Coverage scored against auto-verifiable planned checks only.
 *
 *   coverageRatio = clamp(executedCount / autoVerifiablePlanned, 0..1) rounded 2dp
 *
 * EXPLICIT zero guard: autoVerifiablePlanned === 0 → coverageRatio 0. This must be
 * a literal 0, never NaN: 0/0 is NaN and `NaN <= 0` is false, so a NaN ratio would
 * slip past a downstream `<= 0` guard and corrupt averages. fullyVerified is true
 * only when at least one auto-verifiable check was planned and every such check ran
 * (executedCount >= autoVerifiablePlanned); it is derived from the counts, not the
 * rounded ratio, so a near-1 rounding artifact can never report a false positive.
 */
export function computeVerificationCoverage(
  input: VerificationCoverageInput | null | undefined,
): VerificationCoverageResult {
  try {
    if (!input || typeof input !== 'object') return { ...NEUTRAL_RESULT };
    const source = input as VerificationCoverageInput;
    const autoVerifiablePlanned = countAutoVerifiablePlanned(source.plannedChecks);
    const executedCount = toExecutedCount(source.executedCount);

    // Explicit zero guard — return literal 0, never NaN from 0/0.
    if (autoVerifiablePlanned <= 0) {
      return { coverageRatio: 0, autoVerifiablePlanned: 0, fullyVerified: false };
    }

    const raw = executedCount / autoVerifiablePlanned;
    const clamped = raw < 0 ? 0 : raw > 1 ? 1 : raw;
    return {
      coverageRatio: round2(clamped),
      autoVerifiablePlanned,
      fullyVerified: executedCount >= autoVerifiablePlanned,
    };
  } catch {
    // Hostile input (throwing getters on `input` itself) — safe neutral.
    return { ...NEUTRAL_RESULT };
  }
}
