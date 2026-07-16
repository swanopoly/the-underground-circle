/**
 * agent-run-proof-publisher-core-smoketest — the ACCOUNTABILITY keystone
 * (src/lib/agentRunProofPublisherCore.ts) that COMPOSES the two already-built
 * pure cores — `openswanRunProofCore.buildRunProof` +
 * `taskPRLinkageCore.extractGitReferences` — into the Feed-visible proof-of-work
 * row payloads (docs/ACCOUNTABILITY_PROOF_OF_WORK_PLAN.md GAP 1/2/3/4).
 *
 * Load-bearing assertions:
 *   HAPPY: tools + files + all-passing verification + a PR reference →
 *     proofRow.verified true, git_references populated (PR #123 + commit),
 *     proof_tags include 'completed'/'verified', activityRow is a 'task_completed'
 *     row (status 'completed') whose body links the PR.
 *   FAILED: a failing verification check → verified false, honest, activityRow
 *     is 'task_failed' / status 'failed', proof_tags include 'failed'/'checks-failed'.
 *   STOP-FAIL: a run stopped in a failure family (max_tokens) forces verified
 *     false even when checks passed → 'task_failed'.
 *   SECRET-SAFE: secret-bearing paths reduce to basenames only; secret tokens in
 *     free text are masked; a non-github url is never linked; nothing leaks a
 *     directory or key into either row.
 *   EMPTY: {} → neutral rows (verified false, run_id null, no task_id, no refs).
 *   INJECTED nowMs → ISO `at`; missing/invalid nowMs → ''.
 *   BOUNDED + every export TOTAL (hostile / cyclic input never throws) + DETERMINISTIC.
 *
 * Pure — loads under tsx (the publisher core imports only the two zero-import cores).
 */

import {
  buildRunProofPublication,
  type RunProofPublication,
} from '../src/lib/agentRunProofPublisherCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Structural invariants EVERY publication must satisfy (bounded + typed + JSON-safe).
function assertShape(pub: RunProofPublication, label: string): void {
  assert(!!pub && typeof pub === 'object', label + ' returns object');
  assert(!!pub.proofRow && typeof pub.proofRow === 'object' && !Array.isArray(pub.proofRow), label + ' proofRow is record');
  assert(!!pub.activityRow && typeof pub.activityRow === 'object' && !Array.isArray(pub.activityRow), label + ' activityRow is record');
  assert(Array.isArray(pub.gitReferences), label + ' gitReferences is array');
  // proofRow keys / types
  const p = pub.proofRow;
  assert(typeof p.headline === 'string', label + ' proofRow.headline string');
  assert((p.headline as string).length <= 120, label + ' proofRow.headline ≤120');
  assert(p.title === p.headline, label + ' proofRow.title == headline');
  assertEq(p.pow_type, 'agent_run', label + ' proofRow.pow_type agent_run');
  assert(Array.isArray(p.bullets), label + ' proofRow.bullets array');
  assert((p.bullets as unknown[]).length <= 8, label + ' proofRow.bullets ≤8');
  assert((p.bullets as unknown[]).every((b) => typeof b === 'string' && (b as string).length <= 160), label + ' each bullet string ≤160');
  assert(typeof p.verified === 'boolean', label + ' proofRow.verified boolean');
  assert(Array.isArray(p.proof_tags), label + ' proofRow.proof_tags array');
  assert((p.proof_tags as unknown[]).length <= 16, label + ' proofRow.proof_tags ≤16');
  assert(Array.isArray(p.git_references), label + ' proofRow.git_references array');
  assert((p.git_references as unknown[]).length <= 20, label + ' proofRow.git_references ≤20');
  assert(typeof p.at === 'string', label + ' proofRow.at string');
  assert(p.run_id === null || typeof p.run_id === 'string', label + ' proofRow.run_id string|null');
  // activityRow keys / types
  const a = pub.activityRow;
  assert(a.activity_type === 'task_completed' || a.activity_type === 'task_failed', label + ' activityRow.activity_type valid');
  assert(a.status === 'completed' || a.status === 'failed', label + ' activityRow.status valid');
  assertEq(a.source, 'system', label + ' activityRow.source system');
  assert(typeof a.title === 'string' && (a.title as string).length <= 120, label + ' activityRow.title string ≤120');
  assert(typeof a.body === 'string', label + ' activityRow.body string');
  assert((a.body as string).length <= 700, label + ' activityRow.body ≤700');
  assert(!!a.metadata && typeof a.metadata === 'object' && !Array.isArray(a.metadata), label + ' activityRow.metadata record');
  // JSON-serializable (no cycles, no functions surviving)
  let jsonOk = true;
  try { JSON.stringify(pub); } catch { jsonOk = false; }
  assert(jsonOk, label + ' publication is JSON-serializable');
}

type AnyRec = Record<string, unknown>;
function meta(pub: RunProofPublication): AnyRec {
  return pub.activityRow.metadata as AnyRec;
}
function tags(pub: RunProofPublication): string[] {
  return pub.proofRow.proof_tags as string[];
}
function bulletsJoin(pub: RunProofPublication): string {
  return (pub.proofRow.bullets as string[]).join(' ⏐ ');
}

// ── shared fixtures (REAL OpenSwan / task shapes) ───────────────────────────
const REPO = 'cswan801/the-underground-circle';
const editA = { tool: 'desktop.edit_file', input: { path: 'src/lib/a.ts' }, status: 'completed', summary: '' };
const editB = { tool: 'desktop.file_write_text', input: { path: 'src/lib/b.ts' }, status: 'completed', summary: '' };
// git.run commit whose summary carries the remote (→ repo) + the [branch sha] line.
const gitCommit = {
  tool: 'git.run',
  input: { verb: 'commit', args: ['commit', '-m', 'feat: x'] },
  status: 'completed',
  summary: `To github.com:${REPO}.git\n[main 7d3a1f2] feat: x`,
};
const vTypePass = { check: { label: 'typecheck', kind: 'typecheck' }, status: 'passed', ok: true, executed: true };
const vTestPass = { check: { label: 'tests', kind: 'tests' }, status: 'passed', ok: true, executed: true };
const vTestFail = { check: { label: 'tests', kind: 'tests' }, status: 'failed', ok: false, executed: true };
const PR_URL = `https://github.com/${REPO}/pull/123`;

function main(): void {
  // ─── (1) HAPPY: tools + files + passing verification + PR reference ────────
  {
    const pub = buildRunProofPublication({
      runId: '550e8400-e29b-41d4-a716-446655440000',
      taskId: 'task-abc-777',
      toolsUsed: [editA, gitCommit],
      filesTouched: ['src/lib/a.ts'],
      verification: [vTypePass, vTestPass],
      stopReason: 'end_turn',
      durationMs: 45_000,
      outputSummary: 'Implemented the feature and opened a PR.',
      deliverable: `Done. Opened ${PR_URL} for review.`,
      toolEvents: [editA, gitCommit],
      attachments: [{ url: PR_URL }],
      nowMs: 1_700_000_000_000,
    });
    assertShape(pub, '(1)');
    assertEq(pub.proofRow.verified, true, '(1) verified true (all checks passed, clean stop)');
    assertEq(pub.proofRow.run_id, '550e8400-e29b-41d4-a716-446655440000', '(1) run_id preserved (hyphens intact)');
    assertEq(pub.proofRow.task_id, 'task-abc-777', '(1) task_id present');
    assert(tags(pub).includes('completed'), '(1) proof_tags has completed', tags(pub).join(','));
    assert(tags(pub).includes('verified'), '(1) proof_tags has verified', tags(pub).join(','));
    // git references: a PR (#123, repo) and a commit (7d3a1f2, repo)
    const refs = pub.gitReferences;
    assert(refs.length >= 2, '(1) ≥2 git references', 'len ' + refs.length);
    const pr = refs.find((r) => r.type === 'pull_request');
    assert(!!pr, '(1) has a pull_request ref');
    assertEq(pr?.prNumber, 123, '(1) PR number 123');
    assertEq(pr?.repo, REPO, '(1) PR repo parsed');
    assertEq(pr?.url, PR_URL, '(1) PR url canonical');
    const commit = refs.find((r) => r.type === 'commit');
    assert(!!commit, '(1) has a commit ref');
    assertEq(commit?.sha, '7d3a1f2', '(1) commit sha from [main 7d3a1f2]');
    assertEq(commit?.repo, REPO, '(1) commit repo from remote line');
    // both rows carry the same refs
    assertEq((pub.proofRow.git_references as unknown[]).length, refs.length, '(1) proofRow mirrors refs');
    assertEq((meta(pub).git_references as unknown[]).length, refs.length, '(1) metadata mirrors refs');
    // activity row is a completed task
    assertEq(pub.activityRow.activity_type, 'task_completed', '(1) activity_type task_completed');
    assertEq(pub.activityRow.status, 'completed', '(1) status completed');
    assertEq(pub.activityRow.title, pub.proofRow.headline, '(1) activity title == headline');
    assert((pub.activityRow.body as string).includes('Linked'), '(1) body links refs');
    assert((pub.activityRow.body as string).includes('PR #123'), '(1) body names PR #123');
    assert(Array.isArray(meta(pub).git_labels) && (meta(pub).git_labels as string[]).some((l) => l.includes('PR #123')), '(1) metadata git_labels rendered');
    assertEq(meta(pub).verified, true, '(1) metadata.verified true');
    // at stamp from injected nowMs
    assertEq(pub.proofRow.at, new Date(1_700_000_000_000).toISOString(), '(1) at is ISO of nowMs');
    assertEq(meta(pub).at, pub.proofRow.at, '(1) metadata.at == proofRow.at');
    // headline names the work
    assert((pub.proofRow.headline as string).startsWith('Completed'), '(1) headline Completed', String(pub.proofRow.headline));
  }

  // ─── (2) FAILED: a failing verification check → honest failure ─────────────
  {
    const pub = buildRunProofPublication({
      runId: 'run-fail-1',
      taskId: 'task-fail-1',
      toolsUsed: [editA],
      filesTouched: ['src/lib/a.ts'],
      verification: [vTypePass, vTestFail],
      stopReason: 'end_turn',
      durationMs: 12_000,
      outputSummary: 'Attempted the fix; tests still failing.',
      nowMs: 1_700_000_000_000,
    });
    assertShape(pub, '(2)');
    assertEq(pub.proofRow.verified, false, '(2) verified false when a check failed');
    assert(tags(pub).includes('failed'), '(2) proof_tags has failed', tags(pub).join(','));
    assert(tags(pub).includes('checks-failed'), '(2) proof_tags has checks-failed', tags(pub).join(','));
    assertEq(pub.activityRow.activity_type, 'task_failed', '(2) activity_type task_failed');
    assertEq(pub.activityRow.status, 'failed', '(2) status failed');
    assertEq(meta(pub).verified, false, '(2) metadata.verified false');
    assert((pub.proofRow.headline as string).startsWith('Failed'), '(2) headline Failed', String(pub.proofRow.headline));
    // no git references present here
    assertEq(pub.gitReferences.length, 0, '(2) no git refs');
    assert(!('task_id' in pub.proofRow) || pub.proofRow.task_id === 'task-fail-1', '(2) task_id present');
  }

  // ─── (3) STOP-FAIL: passing checks but stopped in a failure family ─────────
  {
    const pub = buildRunProofPublication({
      runId: 'run-stop-1',
      toolsUsed: [editA],
      verification: [vTypePass, vTestPass],
      stopReason: 'max_tokens', // loop-level failure family
      durationMs: 999_000,
      outputSummary: 'Ran out of budget mid-way.',
      nowMs: 1_700_000_000_000,
    });
    assertShape(pub, '(3)');
    assertEq(pub.proofRow.verified, false, '(3) stop-fail forces verified false even w/ passing checks');
    assert(tags(pub).includes('stopped'), '(3) proof_tags has stopped', tags(pub).join(','));
    assertEq(pub.activityRow.activity_type, 'task_failed', '(3) activity_type task_failed on stop-fail');
    assertEq(pub.activityRow.status, 'failed', '(3) status failed on stop-fail');
    assert(!('task_id' in pub.proofRow), '(3) no task_id key when taskId absent');
    assertEq((meta(pub) as AnyRec).task_id, undefined, '(3) metadata has no task_id when absent');
  }

  // ─── (4) SECRET-SAFE: paths → basenames, secrets masked, non-github ignored ─
  {
    const secretPath = '/Users/cswanson/secrets/id_rsa.pem';
    const awsPath = '/home/user/.aws/credentials';
    const pub = buildRunProofPublication({
      runId: 'run-secret-1',
      filesTouched: [secretPath, awsPath],
      toolsUsed: [editA],
      verification: [vTypePass],
      stopReason: 'end_turn',
      durationMs: 5_000,
      outputSummary: `Wrote key to ${secretPath} using token sk-ABCDEF0123456789abcdef0123XYZ and AKIAIOSFODNN7EXAMPLE done.`,
      // a hostile non-github "pull" url must NOT become a linked reference
      deliverable: 'See https://github.com.evil.com/o/r/pull/9 and https://evil.com/github.com/o/r/pull/8',
      nowMs: 1_700_000_000_000,
    });
    assertShape(pub, '(4)');
    const bj = bulletsJoin(pub);
    const hj = pub.proofRow.headline as string;
    const body = pub.activityRow.body as string;
    const blob = `${bj} ⏐ ${hj} ⏐ ${body}`;
    // basenames appear (safe), full directories do not
    assert(bj.includes('id_rsa.pem'), '(4) basename id_rsa.pem present');
    assert(bj.includes('credentials'), '(4) basename credentials present');
    assert(!blob.includes('/Users/cswanson'), '(4) no /Users/cswanson dir leaked');
    assert(!blob.includes('/home/user'), '(4) no /home/user dir leaked');
    assert(!blob.includes('secrets/'), '(4) no secrets/ segment leaked');
    assert(!blob.includes('.aws/'), '(4) no .aws/ segment leaked');
    // secret tokens masked
    assert(!blob.includes('sk-ABCDEF0123456789abcdef0123XYZ'), '(4) sk- token masked');
    assert(!blob.includes('AKIAIOSFODNN7EXAMPLE'), '(4) AWS key masked');
    // hostile non-github urls never linked
    assertEq(pub.gitReferences.length, 0, '(4) host-scope: no refs from spoofed urls');
    assert(!blob.includes('evil.com'), '(4) no evil.com in any row text');
  }

  // ─── (5) GIT linkage variety + toolEvents-fallback-from-toolsUsed ──────────
  {
    // toolEvents omitted → git source falls back to the toolsUsed array.
    const pub = buildRunProofPublication({
      runId: 'run-git-1',
      taskId: 'task-git-1',
      toolsUsed: [gitCommit], // carries remote + [main 7d3a1f2]
      verification: [vTypePass],
      stopReason: 'end_turn',
      durationMs: 3_000,
      deliverable: `Opened PR #45 and pushed. ${PR_URL}`,
      nowMs: 1_700_000_000_000,
    });
    assertShape(pub, '(5)');
    const refs = pub.gitReferences;
    assert(refs.some((r) => r.type === 'commit' && r.sha === '7d3a1f2'), '(5) commit ref via toolsUsed fallback');
    assert(refs.some((r) => r.type === 'pull_request' && r.prNumber === 123), '(5) PR #123 from deliverable url');
    // "PR #45" prose is absorbed by the canonical /pull/123? No — different number, both kept.
    assert(refs.some((r) => r.type === 'pull_request' && r.prNumber === 45), '(5) prose PR #45 kept');
    assert((meta(pub).git_labels as string[]).length > 0, '(5) labels rendered');
    // explicit toolEvents overrides the fallback
    const pub2 = buildRunProofPublication({
      toolsUsed: ['some.tool'],
      toolEvents: [gitCommit],
      deliverable: 'no url here',
      nowMs: 1,
    });
    assert(pub2.gitReferences.some((r) => r.type === 'commit'), '(5) explicit toolEvents used for git scan');
  }

  // ─── (6) EMPTY / neutral ───────────────────────────────────────────────────
  {
    const pub = buildRunProofPublication({});
    assertShape(pub, '(6)');
    assertEq(pub.proofRow.verified, false, '(6) empty → verified false');
    assertEq(pub.proofRow.run_id, null, '(6) empty → run_id null');
    assert(!('task_id' in pub.proofRow), '(6) empty → no task_id key');
    assertEq(pub.gitReferences.length, 0, '(6) empty → no refs');
    assertEq((pub.proofRow.bullets as unknown[]).length, 0, '(6) empty → no bullets');
    assertEq(pub.activityRow.body, '', '(6) empty → empty body');
    assertEq(pub.activityRow.activity_type, 'task_completed', '(6) empty → task_completed (neutral)');
    assertEq(pub.proofRow.at, '', '(6) empty → no nowMs → at empty');
    assert((pub.proofRow.headline as string).length > 0, '(6) empty → non-empty neutral headline');
  }

  // ─── (7) nowMs injection variants ──────────────────────────────────────────
  {
    assertEq(buildRunProofPublication({ nowMs: 0 }).proofRow.at, new Date(0).toISOString(), '(7) nowMs 0 → epoch ISO');
    assertEq(buildRunProofPublication({ nowMs: 1_700_000_000_123 }).proofRow.at, new Date(1_700_000_000_123).toISOString(), '(7) nowMs → ISO');
    assertEq(buildRunProofPublication({ nowMs: NaN }).proofRow.at, '', '(7) NaN nowMs → ""');
    assertEq(buildRunProofPublication({ nowMs: Infinity }).proofRow.at, '', '(7) Infinity nowMs → ""');
    assertEq(buildRunProofPublication({ nowMs: -1 }).proofRow.at, '', '(7) negative nowMs → ""');
    assertEq(buildRunProofPublication({ nowMs: 1e19 }).proofRow.at, '', '(7) out-of-range nowMs → ""');
    assertEq(buildRunProofPublication({ nowMs: '1700000000000' as unknown }).proofRow.at, '', '(7) string nowMs → "" (numbers only)');
    assertEq(buildRunProofPublication({}).proofRow.at, '', '(7) missing nowMs → ""');
  }

  // ─── (8) id coercion (number / bigint / huge / control chars / empty) ──────
  {
    assertEq(buildRunProofPublication({ runId: 12345 }).proofRow.run_id, '12345', '(8) number runId → string');
    assertEq(buildRunProofPublication({ runId: 99n as unknown }).proofRow.run_id, '99', '(8) bigint runId → string');
    assertEq(buildRunProofPublication({ runId: '' }).proofRow.run_id, null, '(8) empty runId → null');
    assertEq(buildRunProofPublication({ runId: '   ' }).proofRow.run_id, null, '(8) whitespace runId → null');
    assertEq(buildRunProofPublication({ runId: {} as unknown }).proofRow.run_id, null, '(8) object runId → null');
    assertEq(buildRunProofPublication({ runId: NaN }).proofRow.run_id, null, '(8) NaN runId → null');
    const huge = buildRunProofPublication({ runId: 'x'.repeat(5000) }).proofRow.run_id as string;
    assert(huge.length <= 200, '(8) huge runId clipped ≤200', 'len ' + huge.length);
    // control chars stripped, hyphens preserved
    const ctrl = buildRunProofPublication({ runId: 'ab\u0000c\u001f-d\u007fe' }).proofRow.run_id as string;
    assert(!/[\u0000-\u001f\u007f]/.test(ctrl), '(8) control chars stripped from id');
    assert(ctrl.includes('-'), '(8) hyphen preserved in id', ctrl);
    assertEq(buildRunProofPublication({ taskId: '  t-1  ' }).proofRow.task_id, 't-1', '(8) taskId trimmed');
  }

  // ─── (9) BOUNDS under oversized inputs ─────────────────────────────────────
  {
    const manyTools = Array.from({ length: 400 }, (_, i) => ({ tool: `tool.${i}`, status: 'completed', summary: '' }));
    const manyFiles = Array.from({ length: 400 }, (_, i) => `src/gen/file${i}.ts`);
    const manyChecks = Array.from({ length: 400 }, (_, i) => ({ check: { label: `c${i}`, kind: 'lint' }, status: 'passed', ok: true }));
    const manyUrls = Array.from({ length: 400 }, (_, i) => `https://github.com/${REPO}/pull/${i + 1}`).join(' ');
    const pub = buildRunProofPublication({
      runId: 'run-big',
      toolsUsed: manyTools,
      filesTouched: manyFiles,
      verification: manyChecks,
      deliverable: manyUrls,
      outputSummary: 'z'.repeat(50_000),
      stopReason: 'end_turn',
      durationMs: 60_000,
      nowMs: 1_700_000_000_000,
    });
    assertShape(pub, '(9)');
    assert((pub.proofRow.bullets as unknown[]).length <= 8, '(9) bullets bounded ≤8');
    assert((pub.proofRow.proof_tags as unknown[]).length <= 16, '(9) tags bounded ≤16');
    assert(pub.gitReferences.length <= 20, '(9) refs bounded ≤20', 'len ' + pub.gitReferences.length);
    assert((pub.activityRow.body as string).length <= 700, '(9) body bounded ≤700');
    assert((meta(pub).git_labels as string[]).length <= 8, '(9) git_labels bounded ≤8');
    assert((pub.proofRow.headline as string).length <= 120, '(9) headline bounded ≤120');
  }

  // ─── (10) DETERMINISTIC (no Date.now/Math.random) ──────────────────────────
  {
    const input = {
      runId: 'det-1',
      taskId: 'det-task',
      toolsUsed: [editA, editB, gitCommit],
      filesTouched: ['src/lib/a.ts', 'src/lib/b.ts'],
      verification: [vTypePass, vTestPass],
      stopReason: 'end_turn',
      durationMs: 30_000,
      outputSummary: 'Deterministic run.',
      deliverable: `Opened ${PR_URL}`,
      attachments: [{ url: PR_URL }],
      nowMs: 1_700_000_000_000,
    };
    const a = JSON.stringify(buildRunProofPublication(input));
    const b = JSON.stringify(buildRunProofPublication(input));
    assertEq(a, b, '(10) same input → identical output');
    assert(a.length > 50, '(10) output is non-trivial');
  }

  // ─── (11) HOSTILE / cyclic / wrong-type inputs never throw ─────────────────
  {
    const cyc: AnyRec = {};
    cyc.self = cyc;
    const cycArr: unknown[] = [];
    cycArr.push({ tool: 'git.run', summary: 'x', self: cycArr });
    const hugeStr = 'y'.repeat(2_000_000);
    const hostiles: unknown[] = [
      null,
      undefined,
      42,
      'a string',
      true,
      false,
      [],
      [1, 2, 3],
      {},
      () => 'fn',
      Symbol('s'),
      cyc,
      { runId: Symbol('id'), taskId: () => 1 },
      { toolsUsed: cyc, filesTouched: cyc, verification: cyc, deliverable: cyc },
      { toolsUsed: cycArr, toolEvents: cycArr, attachments: cycArr },
      { outputSummary: hugeStr, deliverable: hugeStr, runId: hugeStr },
      { toolsUsed: [null, undefined, 1, 'x', {}, [], () => 1] },
      { verification: [{ check: null }, { status: 123 }, 'nope', 7] },
      { nowMs: {} },
      { nowMs: [] },
      { stopReason: {} },
      { durationMs: 'not-a-number' },
      { filesTouched: 'src/a.ts' }, // bare string, not array
      { attachments: { url: PR_URL } }, // record, not array
    ];
    let idx = 0;
    for (const h of hostiles) {
      idx++;
      let threw = false;
      let pub: RunProofPublication | null = null;
      try {
        pub = buildRunProofPublication(h as never);
      } catch {
        threw = true;
      }
      assert(!threw, `(11.${idx}) hostile input did not throw`);
      if (pub) assertShape(pub, `(11.${idx})`);
    }
  }

  // ─── (12) tool-name array (strings) still parses + non-fatal git empties ───
  {
    const pub = buildRunProofPublication({
      runId: 'run-names',
      toolsUsed: ['desktop.edit_file', 'git.run', 'verification.typecheck'],
      verification: [vTypePass],
      stopReason: 'end_turn',
      durationMs: 1_000,
      nowMs: 1_700_000_000_000,
    });
    assertShape(pub, '(12)');
    assertEq(pub.gitReferences.length, 0, '(12) bare tool-name strings carry no git text');
    assert(tags(pub).includes('completed'), '(12) completed from clean run');
    assertEq(pub.proofRow.pow_type, 'agent_run', '(12) pow_type stable');
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  if (failures > 0) {
    console.error(`\n✗ agentRunProofPublisherCore smoke FAILED: ${failures} failed, ${passes} passed`);
    process.exit(1);
  }
  console.log(`✓ agentRunProofPublisherCore smoke PASSED: ${passes} assertions across 12 groups`);
}

main();
