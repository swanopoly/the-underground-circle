// openswanQualityAggregateCore — quality-opt v6
//
// ONE hardened run-quality aggregator shared by the two divergent quality-aggregate
// passes (RunHistoryDrawer + AgentRunsPanel). The legacy rollup in
// `openswanObservedEvals.ts` (buildOpenSwanObservedEvalAggregate, ~L505-515)
// dereferences `summary.verification.coverageRatio`, `summary.score`, and
// `summary.outcome` directly and can throw when a row is missing `verification`
// (undefined) or carries NaN/hostile field values.
//
// This module provides a TOTAL normalizer (`normalizeObservedEval`) that defaults
// every field the rollup touches, plus a single bounded aggregation pass
// (`aggregateRunQuality`). Every export is total: null / undefined / wrong-type /
// huge / hostile / cyclic input collapses to a safe neutral value and NEVER throws
// (throwing property getters and hostile array proxies are guarded too). Results
// are always finite — never NaN, never undefined, never Infinity.
//
// PURITY: zero runtime imports; no Date.now()/Math.random() at module scope. Safe
// to load under tsx for smoke testing.

/**
 * The loose shape of a persisted observed-eval / run-quality row. Every field is
 * optional + `unknown` because rows arrive from run metadata and may be partial,
 * mistyped, or hostile. Callers should type inputs as this and let the normalizer
 * harden them.
 */
export interface ObservedEvalLike {
  score?: unknown;
  outcome?: unknown;
  verification?: unknown;
  durationMs?: unknown;
  costUsd?: unknown;
}

/** Fully-defaulted, always-finite view of a single row. */
export interface NormalizedObservedEval {
  score: number;
  outcome: string;
  verification: { coverageRatio: number };
  durationMs: number;
  costUsd: number;
}

/** Bounded roll-up over a batch of normalized rows. */
export interface RunQualityAggregate {
  count: number;
  avgScore: number;
  avgCoverage: number;
  byOutcome: Record<string, number>;
  totalCostUsd: number;
  avgDurationMs: number;
}

// The four outcomes the domain (and the OpenSwanQualityAggregate component) knows
// about. Anything else collapses to the neutral 'partial' bucket so byOutcome
// stays bounded to exactly these keys and consumers reading .strong/.blocked/
// .failed never hit an undefined value.
const KNOWN_OUTCOMES: readonly string[] = ['strong', 'partial', 'blocked', 'failed'];
const DEFAULT_OUTCOME = 'partial';

// Per-row caps keep sums finite even under hostile huge-but-finite inputs, and
// keep the aggregate bounded. Real durations/costs never approach these.
const DURATION_CAP = 1e12; // ~31 years in ms — never reached by real runs
const COST_CAP = 1e9; // $1B — never reached by real runs
// Upper bound on rows processed in a single pass, so a hostile giant array can
// never make the aggregate unbounded.
const MAX_ROWS = 100000;

/** Read a property without letting a throwing getter escape. */
function safeGet(obj: Record<string, unknown>, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

/** Coerce unknown to a finite number, or `fallback`. Never returns NaN/Infinity. */
function toFiniteNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

/** Round to `decimals` places, guarding against non-finite intermediate scale. */
function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0;
  const places = Math.max(0, Math.min(12, Math.floor(decimals)));
  const factor = Math.pow(10, places);
  const scaled = value * factor;
  if (!Number.isFinite(scaled)) return value; // already finite; just skip rounding
  return Math.round(scaled) / factor;
}

/** 0..100 integer score. NaN/huge/negative/wrong-type → clamped safe value. */
function clampScore(value: unknown): number {
  const num = toFiniteNumber(value, 0);
  return Math.max(0, Math.min(100, Math.round(num)));
}

/** 0..1 coverage ratio. NaN/huge/negative/wrong-type → clamped safe value. */
function clampRatio(value: unknown): number {
  const num = toFiniteNumber(value, 0);
  if (num <= 0) return 0;
  return num > 1 ? 1 : num;
}

/** Non-negative, capped numeric field (duration/cost). Never NaN/Infinity. */
function clampNonNegative(value: unknown, cap: number): number {
  const num = toFiniteNumber(value, 0);
  if (num <= 0) return 0;
  return num > cap ? cap : num;
}

function normalizeOutcome(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_OUTCOME;
  const normalized = value.trim().toLowerCase();
  return KNOWN_OUTCOMES.indexOf(normalized) >= 0 ? normalized : DEFAULT_OUTCOME;
}

function normalizeVerification(value: unknown): { coverageRatio: number } {
  if (value && typeof value === 'object') {
    return { coverageRatio: clampRatio(safeGet(value as Record<string, unknown>, 'coverageRatio')) };
  }
  return { coverageRatio: 0 };
}

function neutralNormalized(): NormalizedObservedEval {
  return {
    score: 0,
    outcome: DEFAULT_OUTCOME,
    verification: { coverageRatio: 0 },
    durationMs: 0,
    costUsd: 0,
  };
}

function emptyByOutcome(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of KNOWN_OUTCOMES) out[key] = 0;
  return out;
}

/**
 * Total normalizer: defaults every field the quality rollup dereferences.
 * - score        → 0..100 integer (missing/NaN/huge/negative → clamped)
 * - outcome      → one of the 4 known outcomes ('partial' for anything else)
 * - verification → { coverageRatio: 0..1 } (missing verification → coverageRatio 0)
 * - durationMs   → >= 0, capped (missing/negative/NaN → 0)
 * - costUsd      → >= 0, capped (missing/negative/NaN → 0)
 * Never returns NaN / undefined / Infinity. Never throws.
 */
export function normalizeObservedEval(raw: unknown): NormalizedObservedEval {
  if (!raw || typeof raw !== 'object') return neutralNormalized();
  const obj = raw as Record<string, unknown>;
  return {
    score: clampScore(safeGet(obj, 'score')),
    outcome: normalizeOutcome(safeGet(obj, 'outcome')),
    verification: normalizeVerification(safeGet(obj, 'verification')),
    durationMs: clampNonNegative(safeGet(obj, 'durationMs'), DURATION_CAP),
    costUsd: clampNonNegative(safeGet(obj, 'costUsd'), COST_CAP),
  };
}

/**
 * One hardened, bounded aggregation pass over a batch of run-quality rows.
 * Non-array input → an empty aggregate (count 0, zeros, byOutcome with the 4
 * known keys at 0). Never throws — hostile rows (throwing getters, cyclic
 * objects, proxies) collapse to neutral and the pass continues.
 */
export function aggregateRunQuality(rows: unknown): RunQualityAggregate {
  const byOutcome = emptyByOutcome();
  let count = 0;
  let totalScore = 0;
  let totalCoverage = 0;
  let totalCost = 0;
  let totalDuration = 0;

  try {
    const list = Array.isArray(rows) ? rows : [];
    const limit = Math.min(list.length, MAX_ROWS);
    for (let i = 0; i < limit; i++) {
      let norm: NormalizedObservedEval;
      try {
        norm = normalizeObservedEval(list[i]);
      } catch {
        norm = neutralNormalized();
      }
      count += 1;
      totalScore += norm.score;
      totalCoverage += norm.verification.coverageRatio;
      totalCost += norm.costUsd;
      totalDuration += norm.durationMs;
      byOutcome[norm.outcome] = (byOutcome[norm.outcome] || 0) + 1;
    }
  } catch {
    // Catastrophic (e.g. hostile array-like proxy throwing on length/index).
    // Return whatever was accumulated so far — still a valid aggregate.
  }

  return {
    count,
    avgScore: count ? roundTo(totalScore / count, 1) : 0,
    avgCoverage: count ? roundTo(totalCoverage / count, 2) : 0,
    byOutcome,
    totalCostUsd: roundTo(totalCost, 6),
    avgDurationMs: count ? roundTo(totalDuration / count, 0) : 0,
  };
}
