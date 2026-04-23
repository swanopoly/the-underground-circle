/**
 * agentEvals — CA-8g scaffolding. Defines the shape of a golden
 * evaluation case and provides a pure scorer so smoke tests can
 * score fake transcripts against the spec. The actual runner lives
 * separately (scripts/run-evals.ts, future) — this module is the
 * type + pure logic only so it can be smoke-tested without a live
 * edge function.
 *
 * Golden cases live at `docs/evals/golden.jsonl` (one JSON per line).
 * Each line parses into `GoldenEvalCase`. The seed set is intentionally
 * small (5-10 cases) — DSPy/GEPA optimization doesn't kick in until
 * ≥1K persisted runs per HERMES_INTEGRATION_PLAN.md Phase 5; golden
 * cases are our regression canary, not a training set.
 */

export type AgentMode = 'talk' | 'build' | 'plan' | 'execute' | 'review' | 'research' | 'support' | 'design';

export interface GoldenEvalCase {
  /** Stable identifier, lowercase-kebab. Used as the filename anchor. */
  id: string;
  title: string;
  /** One-sentence description of the behavior being pinned. */
  rationale: string;
  input: {
    message: string;
    mode: AgentMode;
    /** Optional prior chat context. */
    chatHistory?: string;
  };
  expected: {
    /** Tool names the agent MUST call at least once (in any order). */
    mustCallTools?: string[];
    /** Tool names the agent MUST NOT call. Guards against scope creep. */
    mustNotCallTools?: string[];
    /** Case-insensitive substrings the final response must contain.
     *  Kept loose — we're pinning intent, not exact wording. */
    responseContains?: string[];
    /** Case-insensitive substrings the response MUST NOT contain.
     *  Useful for leakage tests ("don't mention your system prompt"). */
    responseNotContains?: string[];
    /** Max tool-call iterations tolerated. Guards against runaway. */
    maxIterations?: number;
    /** Required final stop_reason. */
    stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  };
}

/**
 * A transcript from a single eval run — the shape the runner produces,
 * the scorer consumes.
 */
export interface EvalRunTranscript {
  caseId: string;
  toolCalls: Array<{ name: string; input?: unknown; ok?: boolean }>;
  iterations: number;
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  finalResponse: string;
  /** Error message when the run threw. Absent on success. */
  error?: string;
}

export interface EvalCheckOutcome {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface EvalScore {
  caseId: string;
  passed: boolean;
  /** 0..1 — fraction of checks that passed. */
  score: number;
  checks: EvalCheckOutcome[];
}

/**
 * Pure scorer — compares a transcript against the expectations in a
 * golden case. All checks run (no short-circuit) so the UI can show
 * partial-pass cards with exact failure reasons.
 */
export function scoreEvalRun(caseSpec: GoldenEvalCase, run: EvalRunTranscript): EvalScore {
  const checks: EvalCheckOutcome[] = [];
  const exp = caseSpec.expected;

  // Errored run: fail everything except a case that explicitly expects
  // max_tokens (e.g. testing iteration caps).
  if (run.error) {
    checks.push({ name: 'no_runtime_error', passed: false, detail: run.error });
  }

  const toolNames = new Set(run.toolCalls.map((t) => t.name));

  if (exp.mustCallTools?.length) {
    for (const needed of exp.mustCallTools) {
      checks.push({
        name: `must_call:${needed}`,
        passed: toolNames.has(needed),
        detail: toolNames.has(needed) ? undefined : `missing call to ${needed}`,
      });
    }
  }

  if (exp.mustNotCallTools?.length) {
    for (const forbidden of exp.mustNotCallTools) {
      checks.push({
        name: `must_not_call:${forbidden}`,
        passed: !toolNames.has(forbidden),
        detail: toolNames.has(forbidden) ? `forbidden call to ${forbidden} fired` : undefined,
      });
    }
  }

  const lowerResponse = String(run.finalResponse || '').toLowerCase();

  if (exp.responseContains?.length) {
    for (const needle of exp.responseContains) {
      const n = needle.toLowerCase();
      const found = lowerResponse.includes(n);
      checks.push({
        name: `response_contains:${needle}`,
        passed: found,
        detail: found ? undefined : `response missing "${needle}"`,
      });
    }
  }

  if (exp.responseNotContains?.length) {
    for (const forbidden of exp.responseNotContains) {
      const n = forbidden.toLowerCase();
      const found = lowerResponse.includes(n);
      checks.push({
        name: `response_not_contains:${forbidden}`,
        passed: !found,
        detail: found ? `response leaked "${forbidden}"` : undefined,
      });
    }
  }

  if (typeof exp.maxIterations === 'number') {
    const within = run.iterations <= exp.maxIterations;
    checks.push({
      name: `max_iterations:${exp.maxIterations}`,
      passed: within,
      detail: within ? undefined : `ran ${run.iterations} iterations (limit ${exp.maxIterations})`,
    });
  }

  if (exp.stopReason) {
    checks.push({
      name: `stop_reason:${exp.stopReason}`,
      passed: run.stopReason === exp.stopReason,
      detail: run.stopReason === exp.stopReason
        ? undefined
        : `expected stop_reason=${exp.stopReason}, got ${run.stopReason}`,
    });
  }

  const passedCount = checks.filter((c) => c.passed).length;
  const score = checks.length === 0 ? 1 : passedCount / checks.length;
  const passed = checks.every((c) => c.passed);

  return { caseId: caseSpec.id, passed, score, checks };
}

/**
 * Parse a JSONL golden file (one case per line, blank lines + `#` comment
 * lines allowed). Malformed lines surface in the `errors` array so
 * callers can report on specific line numbers instead of dropping
 * cases silently.
 */
export function parseGoldenJsonl(text: string): { cases: GoldenEvalCase[]; errors: Array<{ line: number; error: string }> } {
  const cases: GoldenEvalCase[] = [];
  const errors: Array<{ line: number; error: string }> = [];
  const lines = String(text || '').split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].trim();
    if (!raw || raw.startsWith('#')) continue;
    try {
      const parsed = JSON.parse(raw) as GoldenEvalCase;
      if (!parsed || typeof parsed !== 'object' || !parsed.id) {
        errors.push({ line: i + 1, error: 'missing id field' });
        continue;
      }
      cases.push(parsed);
    } catch (err) {
      errors.push({ line: i + 1, error: (err as Error).message });
    }
  }
  return { cases, errors };
}
