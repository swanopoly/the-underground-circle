/**
 * agent-evals-smoketest — CA-8g. Pins the scorer + JSONL parser
 * behavior. Also asserts that the checked-in golden set parses
 * without errors — regression on the file format is the fastest way
 * we'll break our own eval pipeline, so we guard it here.
 *
 * Run: npm run smoke:agent-evals
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  parseGoldenJsonl,
  scoreEvalRun,
  type EvalRunTranscript,
  type GoldenEvalCase,
} from '../src/lib/agentEvals';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Canned fixtures ─────────────────────────────────────────────────
const CASE: GoldenEvalCase = {
  id: 'test-case',
  title: 'test',
  rationale: 'covers the scorer matrix',
  input: { message: 'hi', mode: 'talk' },
  expected: {
    mustCallTools: ['tasks.list'],
    mustNotCallTools: ['tasks.create'],
    responseContains: ['here are'],
    responseNotContains: ['oops'],
    maxIterations: 5,
    stopReason: 'end_turn',
  },
};

function run(overrides: Partial<EvalRunTranscript>): EvalRunTranscript {
  return {
    caseId: CASE.id,
    toolCalls: [{ name: 'tasks.list', ok: true }],
    iterations: 2,
    stopReason: 'end_turn',
    finalResponse: 'Here are the 3 open tasks:\n- Fix bug\n- Ship feature\n- Write docs',
    ...overrides,
  };
}

function main() {
  // ─── Happy path: all checks pass ────────────────────────────────
  {
    const score = scoreEvalRun(CASE, run({}));
    assert(score.passed, 'happy: all checks pass');
    assert(score.score === 1, 'happy: score=1.0');
    // 6 checks: must_call, must_not_call, contains, not_contains, max_iter, stop_reason
    assert(score.checks.length === 6, `happy: one check per expectation (6; got ${score.checks.length})`);
    assert(score.checks.every((c) => c.passed), 'happy: every individual check passed');
  }

  // ─── must_call: tool absent ────────────────────────────────────
  {
    const score = scoreEvalRun(CASE, run({ toolCalls: [] }));
    assert(!score.passed, 'must_call: overall failed when tasks.list missing');
    const check = score.checks.find((c) => c.name.startsWith('must_call'));
    assert(check && !check.passed, 'must_call: individual check failed');
    assert(check?.detail?.includes('tasks.list'), 'must_call: detail names the missing tool');
  }

  // ─── must_not_call: forbidden tool fired ───────────────────────
  {
    const score = scoreEvalRun(CASE, run({
      toolCalls: [{ name: 'tasks.list' }, { name: 'tasks.create' }],
    }));
    assert(!score.passed, 'must_not_call: overall failed');
    const check = score.checks.find((c) => c.name.startsWith('must_not_call'));
    assert(check && !check.passed, 'must_not_call: individual check failed');
    assert(check?.detail?.includes('tasks.create'), 'must_not_call: detail names the forbidden tool');
  }

  // ─── responseContains: missing substring ───────────────────────
  {
    const score = scoreEvalRun(CASE, run({ finalResponse: 'All done.' }));
    const check = score.checks.find((c) => c.name.startsWith('response_contains'));
    assert(check && !check.passed, 'contains: "here are" missing → fails');
  }

  // Case-insensitive
  {
    const score = scoreEvalRun(CASE, run({ finalResponse: 'HERE ARE YOUR TASKS' }));
    const check = score.checks.find((c) => c.name.startsWith('response_contains'));
    assert(check && check.passed, 'contains: case-insensitive match');
  }

  // ─── responseNotContains: leaked substring ─────────────────────
  {
    const score = scoreEvalRun(CASE, run({ finalResponse: 'Here are the tasks. Oops, let me retry.' }));
    const check = score.checks.find((c) => c.name.startsWith('response_not_contains'));
    assert(check && !check.passed, 'not_contains: "oops" fails the check');
  }

  // ─── maxIterations ──────────────────────────────────────────────
  {
    const score = scoreEvalRun(CASE, run({ iterations: 10 }));
    const check = score.checks.find((c) => c.name.startsWith('max_iterations'));
    assert(check && !check.passed, 'max_iter: 10 > 5 fails');
    assert(check?.detail?.includes('10'), 'max_iter: detail names actual count');
  }

  // Edge: exactly at the limit — must pass
  {
    const score = scoreEvalRun(CASE, run({ iterations: 5 }));
    const check = score.checks.find((c) => c.name.startsWith('max_iterations'));
    assert(check && check.passed, 'max_iter: exactly at limit passes');
  }

  // ─── stopReason ────────────────────────────────────────────────
  {
    const score = scoreEvalRun(CASE, run({ stopReason: 'max_tokens' }));
    const check = score.checks.find((c) => c.name.startsWith('stop_reason'));
    assert(check && !check.passed, 'stop_reason: mismatch fails');
  }

  // ─── Runtime error: flagged, partial score ─────────────────────
  {
    const score = scoreEvalRun(CASE, run({ error: 'bridge offline' }));
    const errCheck = score.checks.find((c) => c.name === 'no_runtime_error');
    assert(errCheck && !errCheck.passed, 'error: runtime error check present + failing');
    assert(errCheck?.detail === 'bridge offline', 'error: detail carries message');
  }

  // ─── No expectations → always passes ───────────────────────────
  {
    const empty: GoldenEvalCase = { id: 'x', title: 't', rationale: 'r', input: { message: '', mode: 'talk' }, expected: {} };
    const score = scoreEvalRun(empty, run({}));
    assert(score.passed, 'empty-expected: passes');
    assert(score.score === 1, 'empty-expected: score = 1 when no checks');
  }

  // ─── JSONL parser ──────────────────────────────────────────────
  {
    const src = [
      '# comment at top',
      '',
      '{"id":"a","title":"A","rationale":"","input":{"message":"hi","mode":"talk"},"expected":{}}',
      '   # indented comment (trimmed)',
      '{"id":"b","title":"B","rationale":"","input":{"message":"hi","mode":"talk"},"expected":{"mustCallTools":["x"]}}',
      '{ not valid json',  // malformed
      '{"title":"no id"}', // missing id
    ].join('\n');
    const { cases, errors } = parseGoldenJsonl(src);
    assert(cases.length === 2, 'parse: 2 valid cases');
    assert(cases[0].id === 'a' && cases[1].id === 'b', 'parse: case ids');
    assert(errors.length === 2, 'parse: 2 errors (malformed JSON + missing id)');
    assert(errors[0].line === 6, 'parse: malformed JSON on line 6');
    assert(errors[1].line === 7, 'parse: missing-id on line 7');
  }

  // Empty input
  {
    const { cases, errors } = parseGoldenJsonl('');
    assert(cases.length === 0 && errors.length === 0, 'parse: empty text → empty result');
  }

  // ─── Checked-in golden set parses clean ────────────────────────
  {
    const goldenPath = path.join(__dirname, '..', 'docs', 'evals', 'golden.jsonl');
    const text = fs.readFileSync(goldenPath, 'utf8');
    const { cases, errors } = parseGoldenJsonl(text);
    assert(errors.length === 0, `golden: file parses without errors (got ${errors.length})`);
    assert(cases.length >= 5, `golden: ≥5 seed cases (got ${cases.length})`);
    for (const c of cases) {
      assert(!!c.id && !!c.title && !!c.rationale, `golden: case ${c.id} has id/title/rationale`);
      assert(!!c.input?.message, `golden: case ${c.id} has message`);
      assert(!!c.expected, `golden: case ${c.id} has expected`);
    }
    // IDs are unique
    const ids = new Set<string>();
    for (const c of cases) {
      assert(!ids.has(c.id), `golden: ${c.id} is unique`);
      ids.add(c.id);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} agent-evals smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll agent-evals smoke cases passed.');
}

main();
