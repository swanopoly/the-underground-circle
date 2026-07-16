/**
 * run-evals.ts — the eval CI gate (strategic plan ADD #1).
 *
 * Tier 1 (always on, no API keys): the deterministic pure-core regression
 * corpus in `evals/coreGoldenCorpus.ts`. Every golden case pins a load-bearing
 * behavior of a pure core built for the chat/agent stack; if any core drifts,
 * a case flips and this gate exits non-zero.
 *
 * The verdict layer is `src/lib/evalGateCore.ts` (summarize → baseline-compare →
 * exit code). A prior run's results can be frozen as `evals/baseline.json`; a
 * later run that turns a baseline-passing case red is a REGRESSION and fails the
 * gate even if the absolute pass-rate floor is met.
 *
 * Usage:
 *   npx tsx scripts/run-evals.ts                 # run the gate, exit 0/1
 *   npx tsx scripts/run-evals.ts --update-baseline   # run, then freeze results as the new baseline
 *   npx tsx scripts/run-evals.ts --json          # machine-readable summary on stdout
 *   npx tsx scripts/run-evals.ts --no-fail-on-regression   # report regressions but don't fail on them alone
 *
 * A future live-model tier (driving agentExecutionCore.runAgent against golden
 * prompts) plugs in beside tier 1 as a separate, key-gated suite; its rows use
 * the same EvalCaseResult shape and merge into the same summary.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  summarizeEvalRun,
  compareToBaseline,
  evalRunExitCode,
  formatGateReport,
  type EvalCaseResult,
} from '../src/lib/evalGateCore';
import { runCoreGoldenCorpus, runCoreGoldenCase } from '../evals/coreGoldenCorpus';
import { EXTENDED_CASES } from '../evals/corpus/index';

const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(REPO_ROOT, 'evals', 'baseline.json');

const argv = new Set(process.argv.slice(2));
const UPDATE_BASELINE = argv.has('--update-baseline');
const JSON_OUT = argv.has('--json');
const FAIL_ON_REGRESSION = !argv.has('--no-fail-on-regression');

function loadBaseline(): EvalCaseResult[] | null {
  try {
    if (!fs.existsSync(BASELINE_PATH)) return null;
    const raw = fs.readFileSync(BASELINE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as EvalCaseResult[];
    // Tolerate a { caseId: passed } map form too — compareToBaseline accepts it,
    // but normalize to the array shape for a stable in-memory type.
    if (parsed && typeof parsed === 'object') {
      return Object.entries(parsed).map(([caseId, passed]) => ({
        caseId,
        passed: passed === true,
      }));
    }
    return null;
  } catch (err) {
    console.warn(`[run-evals] could not read baseline (${BASELINE_PATH}): ${String(err)}`);
    return null;
  }
}

function writeBaseline(results: EvalCaseResult[]): void {
  try {
    fs.mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    fs.writeFileSync(BASELINE_PATH, JSON.stringify(results, null, 2) + '\n', 'utf8');
    console.log(`[run-evals] baseline frozen → evals/baseline.json (${results.length} cases)`);
  } catch (err) {
    console.error(`[run-evals] FAILED to write baseline: ${String(err)}`);
    process.exit(1);
  }
}

function main(): void {
  // ── Tier 1: deterministic pure-core corpus (no keys) ──────────────────────
  // Base corpus (coreGoldenCorpus.ts) + the extended group modules (evals/corpus/*).
  const tier1 = [
    ...runCoreGoldenCorpus(),
    ...EXTENDED_CASES.map(runCoreGoldenCase),
  ];
  const results: EvalCaseResult[] = tier1.map((r) => ({
    caseId: r.caseId,
    suite: r.suite,
    passed: r.passed === true,
    detail: r.detail,
  }));

  const baseline = loadBaseline();
  const summary = summarizeEvalRun(results);
  const comparison = baseline ? compareToBaseline(results, baseline) : undefined;

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, comparison: comparison ?? null }, null, 2));
  } else {
    console.log(formatGateReport(summary, comparison));
    // Surface the specific failures/regressions so CI logs are actionable.
    if (summary.failed > 0) {
      console.log('\nFailed cases:');
      for (const r of results.filter((x) => !x.passed)) {
        console.log(`  ✗ [${r.suite ?? '?'}] ${r.caseId}${r.detail ? ` — ${r.detail}` : ''}`);
      }
    }
    if (comparison && comparison.regressions.length > 0) {
      console.log('\nRegressions vs baseline (passed before, fail now):');
      for (const id of comparison.regressions) console.log(`  ⚠ ${id}`);
    }
    if (comparison && comparison.fixes.length > 0) {
      console.log(`\nFixes vs baseline: ${comparison.fixes.length}`);
    }
    if (comparison && comparison.newCases.length > 0) {
      console.log(`New cases (not in baseline): ${comparison.newCases.length}`);
    }
  }

  if (UPDATE_BASELINE) {
    writeBaseline(results);
    // When explicitly (re)freezing the baseline, don't fail on the diff we just froze.
    process.exit(summary.failed > 0 ? 1 : 0);
  }

  const code = evalRunExitCode(summary, comparison, { failOnRegression: FAIL_ON_REGRESSION });
  process.exit(code);
}

main();
