// evalGateCore — the PURE decision layer behind the eval CI merge-gate
// (ADD #1 in docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md). The scorer
// (src/lib/agentEvals.ts scoreEvalRun) turns a transcript into an EvalScore;
// the observed-eval aggregator (src/lib/openswanObservedEvals.ts) rolls prod
// runs into dashboards. This core is the last mile the *runner* needs: it
// takes the raw per-case results, summarizes them, diffs them against a
// checked-in baseline to catch REGRESSIONS, and turns that into a single
// pass/fail CI exit code plus one compact human log line.
//
// scripts/run-evals.ts (written next) drives each golden case through the real
// agentExecutionCore.runAgent, collects an EvalCaseResult[] (structurally
// compatible with agentEvals' EvalScore: { caseId, passed, score }), then:
//   const summary = summarizeEvalRun(results);
//   const comparison = compareToBaseline(results, loadBaseline('evals/baseline.json'));
//   console.log(formatGateReport(summary, comparison));
//   process.exit(evalRunExitCode(summary, comparison));
//
// FAIL-CLOSED is the governing principle: an unparseable summary, a run with
// zero cases, or any internal throw yields a NON-zero exit (block the merge)
// rather than a false green. A REGRESSION (a case that passed in the baseline
// but fails now) also blocks by default.
//
// Deterministic: same input → same output, always (all listed id arrays are
// sorted; dedupe is last-wins). Every export is TOTAL — null / undefined /
// wrong-type / huge / hostile (throwing getters) / cyclic input yields a safe
// neutral result and never throws. Bounded (every scan and every emitted list
// is capped). Secret-safe (only counts and case ids flow out; formatGateReport
// emits counts only — never a case id, detail string, or transcript).
//
// PURITY: zero runtime imports, tsx-loadable (smoke: eval-gate-core). Never
// touches the filesystem or network — the runner owns baseline IO and exit.

/** One case's outcome. Compatible with agentEvals.EvalScore (caseId/passed/score). */
export interface EvalCaseResult {
  caseId: string;
  /** Optional grouping (e.g. 'safety', 'routing'); absent → the 'default' bucket. */
  suite?: string;
  passed: boolean;
  /** Optional 0..1 fractional score from the scorer. Informational only — the
   *  gate keys off `passed`, never the score. */
  score?: number;
  detail?: string;
}

/** Rolled-up view of one eval run. */
export interface EvalRunSummary {
  total: number;
  passed: number;
  failed: number;
  /** passed/total in 0..1 (4dp), or 0 when total is 0. */
  passRate: number;
  /** Ids of failing cases, sorted, capped at MAX_FAILED_IDS. */
  failedIds: string[];
  /** Per-suite {total, passed}. Cases with no suite land in 'default'. */
  bySuite: Record<string, { total: number; passed: number }>;
}

/** Diff of a run against a prior baseline. */
export interface BaselineComparison {
  /** Passed in baseline, fails now — the merge-blocking set. Sorted. */
  regressions: string[];
  /** Failed in baseline, passes now — progress. Sorted. */
  fixes: string[];
  /** Ids present now, absent from baseline. Sorted. */
  newCases: string[];
  /** Ids present in baseline, absent now. Sorted. */
  droppedCases: string[];
  /** True iff regressions.length > 0. */
  regressed: boolean;
}

/** Upper bound on how many array entries / object keys we scan (DoS guard). */
const MAX_RESULTS_SCANNED = 100_000;
/** Cap on EvalRunSummary.failedIds. */
const MAX_FAILED_IDS = 200;
/** Cap on each BaselineComparison id list. */
const MAX_LISTED_IDS = 500;
/** Cap on a single case-id / suite string length. */
const MAX_ID_LEN = 512;
/** Cap on distinct suite buckets; overflow folds into OVERFLOW_SUITE. */
const MAX_SUITES = 2_000;
/** Cap on the formatGateReport line length. */
const MAX_REPORT_LEN = 300;
/** Bucket for cases with no (usable) suite. */
const DEFAULT_SUITE = 'default';
/** Bucket for suites beyond MAX_SUITES. */
const OVERFLOW_SUITE = '__overflow__';

const EMPTY_SUMMARY: EvalRunSummary = {
  total: 0,
  passed: 0,
  failed: 0,
  passRate: 0,
  failedIds: [],
  bySuite: {},
};

const EMPTY_COMPARISON: BaselineComparison = {
  regressions: [],
  fixes: [],
  newCases: [],
  droppedCases: [],
  regressed: false,
};

/** Read one property off an unknown value without traversing or throwing. */
function readProp(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    // Hostile getter — treat as absent.
    return undefined;
  }
}

/** Coerce a case id: trimmed non-empty string, truncated to MAX_ID_LEN, else null. */
function coerceCaseId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > MAX_ID_LEN ? trimmed.slice(0, MAX_ID_LEN) : trimmed;
}

/** Coerce a suite label; missing/blank/non-string → DEFAULT_SUITE. */
function coerceSuite(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_SUITE;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_SUITE;
  return trimmed.length > MAX_ID_LEN ? trimmed.slice(0, MAX_ID_LEN) : trimmed;
}

/** Strict pass: only boolean `true` counts. Non-booleans are conservatively
 *  treated as NOT passed (fail-closed for the pass count). */
function isPassed(value: unknown): boolean {
  return value === true;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Non-negative finite number, else null. */
function toFiniteNonNeg(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return value;
}

function round4(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 10000) / 10000;
}

/** Copy → lexicographic sort → cap. Deterministic regardless of input order. */
function sortCap(ids: string[], cap: number): string[] {
  const sorted = ids.slice().sort();
  return sorted.length > cap ? sorted.slice(0, cap) : sorted;
}

/**
 * Build a caseId → passed map. Arrays are read as EvalCaseResult[] (last write
 * wins on duplicate ids). When allowObjectMap, a plain object is read as a
 * { caseId: passed } map (values coerced with isPassed). Bounded and total.
 */
function buildPassedMap(input: unknown, allowObjectMap: boolean): Map<string, boolean> {
  const map = new Map<string, boolean>();
  if (Array.isArray(input)) {
    const limit = Math.min(input.length, MAX_RESULTS_SCANNED);
    for (let index = 0; index < limit; index += 1) {
      let item: unknown;
      try {
        item = input[index];
      } catch {
        continue;
      }
      const id = coerceCaseId(readProp(item, 'caseId'));
      if (id === null) continue;
      map.set(id, isPassed(readProp(item, 'passed'))); // last wins
    }
    return map;
  }
  if (allowObjectMap && input && typeof input === 'object') {
    let keys: string[] = [];
    try {
      keys = Object.keys(input as object);
    } catch {
      keys = [];
    }
    const limit = Math.min(keys.length, MAX_RESULTS_SCANNED);
    for (let index = 0; index < limit; index += 1) {
      const rawKey = keys[index];
      const id = coerceCaseId(rawKey);
      if (id === null) continue;
      map.set(id, isPassed(readProp(input, rawKey)));
    }
    return map;
  }
  return map;
}

/**
 * Summarize a run's per-case results. Total, dedupe by caseId (last wins),
 * bounded. passRate is passed/total in 0..1 (0 when total is 0). failedIds is
 * sorted + capped. bySuite buckets deduped cases by their suite ('default' when
 * absent). Total — any degenerate input yields the empty summary, never throws.
 */
export function summarizeEvalRun(results: unknown): EvalRunSummary {
  try {
    if (!Array.isArray(results)) return { ...EMPTY_SUMMARY, failedIds: [], bySuite: {} };
    const deduped = new Map<string, { passed: boolean; suite: string }>();
    const limit = Math.min(results.length, MAX_RESULTS_SCANNED);
    for (let index = 0; index < limit; index += 1) {
      let item: unknown;
      try {
        item = results[index];
      } catch {
        continue;
      }
      const id = coerceCaseId(readProp(item, 'caseId'));
      if (id === null) continue;
      deduped.set(id, {
        passed: isPassed(readProp(item, 'passed')),
        suite: coerceSuite(readProp(item, 'suite')),
      }); // last wins
    }

    let passed = 0;
    const failedIds: string[] = [];
    const suiteMap = new Map<string, { total: number; passed: number }>();
    for (const [id, entry] of deduped) {
      if (entry.passed) passed += 1;
      else failedIds.push(id);
      let suiteKey = entry.suite;
      if (!suiteMap.has(suiteKey) && suiteMap.size >= MAX_SUITES) suiteKey = OVERFLOW_SUITE;
      const bucket = suiteMap.get(suiteKey) || { total: 0, passed: 0 };
      bucket.total += 1;
      if (entry.passed) bucket.passed += 1;
      suiteMap.set(suiteKey, bucket);
    }

    const total = deduped.size;
    const bySuite: Record<string, { total: number; passed: number }> = {};
    for (const [key, value] of suiteMap) bySuite[key] = { total: value.total, passed: value.passed };

    return {
      total,
      passed,
      failed: total - passed,
      passRate: total === 0 ? 0 : round4(passed / total),
      failedIds: sortCap(failedIds, MAX_FAILED_IDS),
      bySuite,
    };
  } catch {
    return { total: 0, passed: 0, failed: 0, passRate: 0, failedIds: [], bySuite: {} };
  }
}

/**
 * Diff current results against a baseline. A REGRESSION is a case that passed
 * in baseline but fails now; a FIX is fail→pass; newCases/droppedCases are id
 * set diffs. `baseline` may be a prior EvalCaseResult[] or a { caseId: passed }
 * map. Deterministic (all lists sorted + capped) and total.
 */
export function compareToBaseline(current: unknown, baseline: unknown): BaselineComparison {
  try {
    const currentMap = buildPassedMap(current, false);
    const baselineMap = buildPassedMap(baseline, true);
    const regressions: string[] = [];
    const fixes: string[] = [];
    const newCases: string[] = [];
    const droppedCases: string[] = [];

    for (const [id, passedNow] of currentMap) {
      if (baselineMap.has(id)) {
        const passedBefore = baselineMap.get(id) === true;
        if (passedBefore && !passedNow) regressions.push(id);
        else if (!passedBefore && passedNow) fixes.push(id);
      } else {
        newCases.push(id);
      }
    }
    for (const id of baselineMap.keys()) {
      if (!currentMap.has(id)) droppedCases.push(id);
    }

    return {
      regressions: sortCap(regressions, MAX_LISTED_IDS),
      fixes: sortCap(fixes, MAX_LISTED_IDS),
      newCases: sortCap(newCases, MAX_LISTED_IDS),
      droppedCases: sortCap(droppedCases, MAX_LISTED_IDS),
      regressed: regressions.length > 0,
    };
  } catch {
    return { ...EMPTY_COMPARISON, regressions: [], fixes: [], newCases: [], droppedCases: [] };
  }
}

/** Extract a pass rate from a summary, preferring recomputed counts over the
 *  stored field. Returns null when nothing usable is present (→ fail closed). */
function readPassRate(summary: unknown): number | null {
  if (!summary || typeof summary !== 'object') return null;
  const total = toFiniteNonNeg(readProp(summary, 'total'));
  const passed = toFiniteNonNeg(readProp(summary, 'passed'));
  if (total !== null) {
    if (total === 0) return 0;
    if (passed !== null) return clamp01(passed / total);
  }
  const stored = readProp(summary, 'passRate');
  if (typeof stored === 'number' && Number.isFinite(stored)) return clamp01(stored);
  return null;
}

/** True when a comparison object reports at least one regression. Total. */
function isRegressed(comparison: unknown): boolean {
  if (!comparison || typeof comparison !== 'object') return false;
  if (readProp(comparison, 'regressed') === true) return true;
  const regressions = readProp(comparison, 'regressions');
  return Array.isArray(regressions) && regressions.length > 0;
}

/**
 * The CI gate verdict. Exit 1 (block merge) when:
 *   - the summary is unparseable (fail closed), OR
 *   - failOnRegression (default true) and the comparison shows a regression, OR
 *   - passRate < minPassRate (default 1.0 — every case must pass).
 * Otherwise exit 0. Any internal throw → 1. minPassRate is clamped to 0..1.
 */
export function evalRunExitCode(
  summary: unknown,
  comparison?: unknown,
  opts?: { minPassRate?: number; failOnRegression?: boolean },
): 0 | 1 {
  try {
    const passRate = readPassRate(summary);
    if (passRate === null) return 1; // unparseable summary → fail closed

    let minPassRate = 1;
    let failOnRegression = true;
    if (opts && typeof opts === 'object') {
      const rawMin = readProp(opts, 'minPassRate');
      if (typeof rawMin === 'number' && Number.isFinite(rawMin)) minPassRate = clamp01(rawMin);
      const rawFail = readProp(opts, 'failOnRegression');
      if (typeof rawFail === 'boolean') failOnRegression = rawFail;
    }

    if (failOnRegression && isRegressed(comparison)) return 1;
    if (passRate < minPassRate) return 1;
    return 0;
  } catch {
    return 1;
  }
}

function capLen(line: string): string {
  return line.length > MAX_REPORT_LEN ? line.slice(0, MAX_REPORT_LEN) : line;
}

/** The `· N regression(s)` (+ `· N fixed`) suffix, or '' when no comparison. */
function regressionSuffix(comparison: unknown): string {
  if (!comparison || typeof comparison !== 'object') return '';
  const regressionsRaw = readProp(comparison, 'regressions');
  let regressions = Array.isArray(regressionsRaw)
    ? regressionsRaw.length
    : readProp(comparison, 'regressed') === true
      ? 1
      : 0;
  if (regressions > MAX_LISTED_IDS) regressions = MAX_LISTED_IDS;
  let suffix = ` · ${regressions} regression${regressions === 1 ? '' : 's'}`;
  const fixesRaw = readProp(comparison, 'fixes');
  const fixes = Array.isArray(fixesRaw) ? Math.min(fixesRaw.length, MAX_LISTED_IDS) : 0;
  if (fixes > 0) suffix += ` · ${fixes} fixed`;
  return suffix;
}

/**
 * One compact, bounded, secret-free line for CI logs — e.g.
 * `evals: 96/96 pass (100%) · 0 regressions`. Counts only; never a case id,
 * detail, or transcript. Total — degenerate input → a neutral placeholder line.
 */
export function formatGateReport(summary: unknown, comparison?: unknown): string {
  try {
    if (!summary || typeof summary !== 'object') return 'evals: (no results)';
    const total = toFiniteNonNeg(readProp(summary, 'total'));
    const passed = toFiniteNonNeg(readProp(summary, 'passed'));
    if (total === null || passed === null) {
      const rate = readPassRate(summary);
      if (rate === null) return 'evals: (no results)';
      return capLen(`evals: ${Math.round(rate * 100)}% pass${regressionSuffix(comparison)}`);
    }
    const pct = total > 0 ? Math.round(clamp01(passed / total) * 100) : 0;
    return capLen(`evals: ${passed}/${total} pass (${pct}%)${regressionSuffix(comparison)}`);
  } catch {
    return 'evals: (unavailable)';
  }
}
