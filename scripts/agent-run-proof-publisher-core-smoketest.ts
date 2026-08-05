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
 * OpenSwan chat/room turn bridge (groups 13-15):
 *   MAP: mapRuntimeToolActionsToProofEvents adapts the runtime
 *     {tool_name,status,title,output_preview} shape to {tool,status,summary,result}
 *     so tool names count and git commit/push output + PR URLs in output_preview
 *     become canonical git_references.
 *   GATE: decideOpenSwanTurnProofPublication — cancelled / feed_task / read-only
 *     → no publish; editedFiles / committed / git refs / artifacts / successful
 *     FILE-mutating tool (fs./file./edit tools) → publish; a bare read-only
 *     git.run success is NOT evidence (git. is not a mutation prefix) — a real
 *     commit publishes only via committed / gitRefCount; incomplete → stopReason
 *     'max_iterations' (failure family, never a false completion); receipt
 *     verdict 'failed' → suppress the 'task_completed' activity; hostile input
 *     fails closed and never throws.
 *   PROSE-PROOF (group 16): the gate's gitRefCount must be derived from REAL
 *     tool output only, so a turn that merely NAMES a PR or quotes a github URL
 *     in the model deliverable never publishes; a genuine tool-output commit does.
 *
 * Pure — loads under tsx (the publisher core imports only the two zero-import cores).
 */

import {
  buildRunProofPublication,
  decideOpenSwanTurnProofPublication,
  mapRuntimeToolActionsToProofEvents,
  type RunProofPublication,
} from '../src/lib/agentRunProofPublisherCore';
// The runtime feeds the gate's gitRefCount from a TOOL-ONLY extraction; group
// (16) mirrors that wiring, so it imports the same extractor the runtime uses.
import { extractGitReferences } from '../src/lib/taskPRLinkageCore';

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

  // ─── (13) MAP: runtime tool_name shape → proof events (+ git URL in result) ─
  {
    const runtimeActions = [
      { kind: 'tool', tool_name: 'desktop.edit_file', title: 'desktop > edit file', status: 'completed', input_preview: '{"path":"src/lib/a.ts"}', output_preview: 'Edited src/lib/a.ts', metadata: {} },
      { kind: 'tool', tool_name: 'git.run', title: 'git > run', status: 'completed', input_preview: '{"verb":"commit"}', output_preview: `To github.com:${REPO}.git\n[main 7d3a1f2] feat: x`, metadata: {} },
      { kind: 'tool', tool_name: 'browser.navigate', title: 'browser > navigate', status: 'completed', input_preview: '{}', output_preview: `Opened ${PR_URL}`, metadata: {} },
      { kind: 'tool', tool_name: 'web.search', title: 'web > search', status: 'failed', input_preview: 'q', output_preview: 'timeout', metadata: {} },
    ];
    const events = mapRuntimeToolActionsToProofEvents(runtimeActions);
    assertEq(events.length, 4, '(13) all runtime actions mapped');
    assertEq(events[0].tool, 'desktop.edit_file', '(13) tool_name → tool');
    assertEq(events[0].status, 'completed', '(13) status passes raw');
    assertEq(events[0].summary, 'desktop > edit file', '(13) title → summary');
    assertEq(events[0].result, 'Edited src/lib/a.ts', '(13) output_preview → result');
    assertEq(events[3].status, 'failed', '(13) failed status passes raw');
    assert(events[1].result.includes('github.com'), '(13) git output preserved in result');
    // Mapped events feed BOTH sub-cores: tool names count, git text links refs.
    const pub = buildRunProofPublication({
      runId: 'run-map-1',
      toolsUsed: events,
      toolEvents: events,
      verification: [vTypePass],
      stopReason: 'end_turn',
      durationMs: 9_000,
      nowMs: 1_700_000_000_000,
    });
    assertShape(pub, '(13)');
    assert(pub.gitReferences.some((r) => r.type === 'commit' && r.sha === '7d3a1f2'), '(13) commit ref from output_preview→result');
    assert(pub.gitReferences.some((r) => r.type === 'pull_request' && r.prNumber === 123), '(13) PR ref from URL in output_preview');
    assert(bulletsJoin(pub).includes('4 tool call'), '(13) tool_name shape counted by proof card', bulletsJoin(pub));
    // Idempotent: an already-mapped {tool,...} event maps through unchanged.
    const remapped = mapRuntimeToolActionsToProofEvents(events);
    assertEq(remapped.length, 4, '(13) already-mapped events accepted');
    assertEq(remapped[1].tool, 'git.run', '(13) tool key accepted on re-map');
    // Malformed elements skipped; non-array → [].
    const messy = mapRuntimeToolActionsToProofEvents([
      null, undefined, 42, 'str', [], {}, { tool_name: 7 }, { title: 'no tool' },
      { tool_name: '  ', status: 'completed' },
      { tool_name: 'ok.tool', status: 9, title: null, output_preview: {} },
    ] as unknown[]);
    assertEq(messy.length, 1, '(13) malformed elements skipped');
    assertEq(messy[0].tool, 'ok.tool', '(13) surviving tool kept');
    assertEq(messy[0].status, '', '(13) non-string status → ""');
    assertEq(messy[0].summary, '', '(13) non-string title → ""');
    assertEq(messy[0].result, '', '(13) non-string output_preview → ""');
    assertEq(mapRuntimeToolActionsToProofEvents(null).length, 0, '(13) null → []');
    assertEq(mapRuntimeToolActionsToProofEvents({ tool_name: 'x' }).length, 0, '(13) record → []');
    // Bounds: ≤200 events, per-field clips.
    const many = mapRuntimeToolActionsToProofEvents(
      Array.from({ length: 250 }, (_, i) => ({ tool_name: `t.${i}`, status: 'completed', title: 'x'.repeat(5000), output_preview: 'y'.repeat(50_000) })),
    );
    assertEq(many.length, 200, '(13) events bounded ≤200');
    assert(many.every((e) => e.tool.length <= 120 && e.status.length <= 120 && e.summary.length <= 300 && e.result.length <= 1600), '(13) per-field clips hold');
  }

  // ─── (14) GATE: decideOpenSwanTurnProofPublication branches ────────────────
  {
    const receiptEdits = { editedFiles: ['a.ts', 'b.ts'], checks: [], committed: false, verdict: 'verified', summary: 'ok' };
    const receiptCommit = { editedFiles: [], checks: [], committed: true, verdict: 'unverified', summary: '' };
    const receiptFailed = { editedFiles: ['a.ts'], checks: [], committed: false, verdict: 'failed', summary: 'checks failed' };
    const readonlyEvents = [
      { tool: 'web.search', status: 'completed', summary: '', result: '' },
      { tool: 'circle.snapshot', status: 'completed', summary: '', result: '' },
    ];
    // A bare git.run success with NO commit/push output — read-only shaped
    // (git status/log/diff). Per the openswan-chat-proof fix, `git.` is no
    // longer a mutation prefix, so this is NOT proof-of-work on its own.
    const readonlyGitEvents = [{ tool: 'git.run', status: 'completed', summary: '', result: '' }];
    const base = { runSurface: 'main_chat', cancelled: false, incomplete: false, receipt: null, toolEvents: readonlyEvents, artifactCount: 0, gitRefCount: 0 };

    // cancelled → never publish, even with maximal evidence.
    const dCancel = decideOpenSwanTurnProofPublication({ ...base, cancelled: true, receipt: receiptEdits, toolEvents: readonlyGitEvents, artifactCount: 3, gitRefCount: 2 });
    assertEq(dCancel.publish, false, '(14) cancelled → no publish');
    assertEq(dCancel.stopReason, 'cancelled', '(14) cancelled → stopReason cancelled');
    assertEq(dCancel.reason, 'cancelled', '(14) cancelled reason');
    // feed_task surface → never publish (Kanban owns the richer publication).
    const dFeed = decideOpenSwanTurnProofPublication({ ...base, runSurface: 'feed_task', receipt: receiptEdits, gitRefCount: 2, artifactCount: 1 });
    assertEq(dFeed.publish, false, '(14) feed_task → no publish (double-post guard)');
    assertEq(dFeed.reason, 'feed-task-surface', '(14) feed_task reason');
    // read-only turn → no publish, clean end_turn.
    const dRead = decideOpenSwanTurnProofPublication({ ...base });
    assertEq(dRead.publish, false, '(14) read-only → no publish');
    assertEq(dRead.stopReason, 'end_turn', '(14) clean turn → end_turn');
    assertEq(dRead.suppressCompletedActivity, false, '(14) no receipt → no suppression');
    assertEq(dRead.reason, 'no-mutation-evidence', '(14) read-only reason');
    // evidence branches → publish.
    assertEq(decideOpenSwanTurnProofPublication({ ...base, receipt: receiptEdits }).publish, true, '(14) editedFiles → publish');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, receipt: receiptEdits }).reason, 'edited-files', '(14) editedFiles reason');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, receipt: receiptCommit }).publish, true, '(14) committed → publish');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, gitRefCount: 1 }).publish, true, '(14) gitRefCount → publish');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, artifactCount: 2 }).publish, true, '(14) artifactCount → publish');
    // legacy fallback (no receipt): successful FILE-mutating tool → publish.
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: [{ tool: 'fs.write_file', status: 'completed' }] }).publish, true, '(14) fs.* prefix → publish');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: [{ tool: 'fs.write_file', status: 'completed' }] }).reason, 'mutating-tool', '(14) fs.* → mutating-tool reason');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: [{ tool: 'desktop.edit_file', status: 'completed' }] }).publish, true, '(14) catalog edit tool → publish');
    // REGRESSION (openswan-chat-proof): a read-only git.run (git status/log/diff)
    // is dual-use — its bare success is NOT mutation evidence, since 'git.' is no
    // longer a mutation prefix. It must NOT publish via the legacy fallback.
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: readonlyGitEvents }).publish, false, '(14) read-only git.run success → NO publish');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: readonlyGitEvents }).reason, 'no-mutation-evidence', '(14) read-only git.run → no-mutation-evidence');
    // A GENUINE commit/push STILL publishes: its [branch sha]/pushed-ref output
    // becomes a git reference upstream (extractGitReferences on the tool output),
    // so the caller passes gitRefCount>0 and the git-references branch fires.
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: readonlyGitEvents, gitRefCount: 1 }).publish, true, '(14) real commit (gitRefCount>0) → publish');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: readonlyGitEvents, gitRefCount: 1 }).reason, 'git-references', '(14) real commit → git-references reason');
    // fail-closed: failed/blocked mutating tools are NOT evidence.
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: [{ tool: 'fs.write_file', status: 'failed' }] }).publish, false, '(14) failed fs.write_file → no publish');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: [{ tool: 'desktop.edit_file', status: 'blocked' }] }).publish, false, '(14) blocked edit → no publish');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, toolEvents: [{ tool: 'fs.write_file' }] }).publish, false, '(14) missing status → no publish');
    // incomplete → max_iterations; publish still allowed with evidence.
    const dIncomplete = decideOpenSwanTurnProofPublication({ ...base, incomplete: true, receipt: receiptEdits });
    assertEq(dIncomplete.stopReason, 'max_iterations', '(14) incomplete → max_iterations');
    assertEq(dIncomplete.publish, true, '(14) incomplete w/ evidence still publishes');
    // cancelled wins over incomplete.
    assertEq(decideOpenSwanTurnProofPublication({ ...base, cancelled: true, incomplete: true }).stopReason, 'cancelled', '(14) cancelled beats incomplete');
    // verdict failed → suppress task_completed; proof row may still publish.
    const dFail = decideOpenSwanTurnProofPublication({ ...base, receipt: receiptFailed });
    assertEq(dFail.suppressCompletedActivity, true, '(14) verdict failed → suppress');
    assertEq(dFail.publish, true, '(14) failed receipt w/ edits still publishes proof');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, receipt: receiptEdits }).suppressCompletedActivity, false, '(14) verdict verified → no suppress');
    // pre-pass contract: stopReason independent of gitRefCount.
    const preA = decideOpenSwanTurnProofPublication({ ...base, incomplete: true, gitRefCount: 0 });
    const preB = decideOpenSwanTurnProofPublication({ ...base, incomplete: true, gitRefCount: 5 });
    assertEq(preA.stopReason, preB.stopReason, '(14) stopReason invariant across gitRefCount');
    // hostile counts coerce to 0 (fail-closed).
    assertEq(decideOpenSwanTurnProofPublication({ ...base, gitRefCount: NaN, artifactCount: -3 }).publish, false, '(14) NaN/negative counts → no publish');
    assertEq(decideOpenSwanTurnProofPublication({ ...base, gitRefCount: '5' }).publish, false, '(14) string count → no publish');
    // failure stopReasons feed the publisher → honest 'task_failed', never a
    // false completion (STOP_FAIL family in openswanRunProofCore).
    const pubMax = buildRunProofPublication({ runId: 'run-cap-1', toolsUsed: [editA], stopReason: 'max_iterations', nowMs: 1_700_000_000_000 });
    assertEq(pubMax.activityRow.activity_type, 'task_failed', '(14) max_iterations → task_failed activity');
    assertEq(pubMax.proofRow.verified, false, '(14) max_iterations → verified false');
    const pubCancelled = buildRunProofPublication({ runId: 'run-stop-2', toolsUsed: [editA], stopReason: 'cancelled', nowMs: 1_700_000_000_000 });
    assertEq(pubCancelled.activityRow.activity_type, 'task_failed', '(14) cancelled stopReason → task_failed activity');
  }

  // ─── (15) bridge exports TOTAL under hostile / null input ──────────────────
  {
    const cyc: AnyRec = {};
    cyc.self = cyc;
    const cycArr: unknown[] = [];
    cycArr.push({ tool_name: 'git.run', output_preview: 'x', self: cycArr });
    const hostiles: unknown[] = [
      null, undefined, 42, 'a string', true, [], {}, () => 'fn', Symbol('s'), cyc, cycArr,
      { runSurface: 7, cancelled: 'yes', incomplete: 1, receipt: 'nope', toolEvents: cyc, artifactCount: 'many', gitRefCount: {} },
      { receipt: { editedFiles: 'a.ts', committed: 'true', verdict: 42 } },
      { receipt: { editedFiles: cycArr, verdict: 'failed' } },
      { toolEvents: [null, 7, 'x', { tool: 9 }, { tool: 'git.run', status: cyc }] },
      { runSurface: 'feed_task', cancelled: true },
    ];
    let idx = 0;
    for (const h of hostiles) {
      idx++;
      let threw = false;
      let mapped: unknown = null;
      let decided: ReturnType<typeof decideOpenSwanTurnProofPublication> | null = null;
      try {
        mapped = mapRuntimeToolActionsToProofEvents(h);
        decided = decideOpenSwanTurnProofPublication(h as never);
      } catch {
        threw = true;
      }
      assert(!threw, `(15.${idx}) hostile bridge input did not throw`);
      assert(Array.isArray(mapped), `(15.${idx}) map always returns an array`);
      if (decided) {
        assert(typeof decided.publish === 'boolean', `(15.${idx}) decision.publish boolean`);
        assert(typeof decided.suppressCompletedActivity === 'boolean', `(15.${idx}) decision.suppress boolean`);
        assert(decided.stopReason === 'cancelled' || decided.stopReason === 'max_iterations' || decided.stopReason === 'end_turn', `(15.${idx}) decision.stopReason valid`);
        assert(typeof decided.reason === 'string' && decided.reason.length <= 60, `(15.${idx}) decision.reason bounded string`);
        let jsonOk = true;
        try { JSON.stringify(decided); } catch { jsonOk = false; }
        assert(jsonOk, `(15.${idx}) decision JSON-serializable`);
      }
    }
    // Fail-closed: pure garbage never publishes.
    assertEq(decideOpenSwanTurnProofPublication(null as never).publish, false, '(15) null input → publish false');
    assertEq(decideOpenSwanTurnProofPublication({} as never).publish, false, '(15) {} → publish false');
  }

  // ─── (16) REGRESSION (openswan-chat-proof): the publish gate must count git
  //     refs from REAL TOOL OUTPUT only — never from the untrusted model
  //     deliverable prose. This mirrors the openswanSessionRuntime wiring, where
  //     the gate's gitRefCount is `extractGitReferences({ toolEvents:
  //     proofEvents }).length`, NOT `pub.gitReferences.length` (which ALSO scans
  //     the deliverable). Pins: prose-only PR mention → NO publish; full PR URL
  //     quoted in prose → NO publish; genuine commit in tool output → publish.
  {
    const gateBase = { runSurface: 'main_chat', cancelled: false, incomplete: false, receipt: null, artifactCount: 0 };

    // (a) A read-only Q&A turn: the model ANSWERS about a PR and the only tool
    //     run was a read (web.search) whose output carries no git commit text.
    const qaEvents = mapRuntimeToolActionsToProofEvents([
      { kind: 'tool', tool_name: 'web.search', title: 'web > search', status: 'completed', input_preview: 'q', output_preview: 'PR #128 refactored the auth module', metadata: {} },
    ]);
    // The COMBINED scan (deliverable + tools) DOES pick up the prose "PR #128" —
    // this is the over-count that used to trip a false completion.
    const combined = buildRunProofPublication({
      runId: 'run-prose-1',
      toolsUsed: qaEvents,
      toolEvents: qaEvents,
      deliverable: 'PR #128 refactored the auth module.',
      stopReason: 'end_turn',
      durationMs: 1_000,
      outputSummary: 'PR #128 refactored the auth module.',
      nowMs: 1_700_000_000_000,
    });
    assert(combined.gitReferences.length >= 1, '(16) combined scan sees the prose PR (the hazard)', 'len ' + combined.gitReferences.length);
    // The gate must instead be fed the TOOL-ONLY count, which is 0 here.
    const qaToolRefs = extractGitReferences({ toolEvents: qaEvents });
    assertEq(qaToolRefs.length, 0, '(16) tool-only git refs = 0 for a prose-only PR mention');
    const proseDecision = decideOpenSwanTurnProofPublication({ ...gateBase, toolEvents: qaEvents, gitRefCount: qaToolRefs.length });
    assertEq(proseDecision.publish, false, '(16) prose-only PR mention → NO publish');
    assertEq(proseDecision.reason, 'no-mutation-evidence', '(16) prose-only PR → no-mutation-evidence');

    // (b) Even a FULL github.com /pull/N URL quoted in the DELIVERABLE prose (not
    //     tool output) must NOT publish — the fixNote's "strip url-less prose
    //     refs" alternative was incomplete; the tool-only derivation closes it.
    const urlProseEvents = mapRuntimeToolActionsToProofEvents([
      { kind: 'tool', tool_name: 'web.search', title: 'web > search', status: 'completed', output_preview: 'no git in this tool output', metadata: {} },
    ]);
    const urlProseToolRefs = extractGitReferences({ toolEvents: urlProseEvents });
    assertEq(urlProseToolRefs.length, 0, '(16) full PR URL in deliverable prose → 0 tool refs');
    assertEq(
      decideOpenSwanTurnProofPublication({ ...gateBase, toolEvents: urlProseEvents, gitRefCount: urlProseToolRefs.length }).publish,
      false,
      '(16) full PR URL quoted in prose → NO publish',
    );

    // (c) A GENUINE commit: the git.run tool output carries the [branch sha]
    //     line, so the tool-only scan yields a ref → gitRefCount>0 → publish.
    const commitEvents = mapRuntimeToolActionsToProofEvents([
      { kind: 'tool', tool_name: 'git.run', title: 'git > run', status: 'completed', input_preview: '{"verb":"commit"}', output_preview: `To github.com:${REPO}.git\n[main 7d3a1f2] feat: x`, metadata: {} },
    ]);
    const commitToolRefs = extractGitReferences({ toolEvents: commitEvents });
    assert(commitToolRefs.length >= 1, '(16) tool-only scan sees a real commit', 'len ' + commitToolRefs.length);
    const commitDecision = decideOpenSwanTurnProofPublication({ ...gateBase, toolEvents: commitEvents, gitRefCount: commitToolRefs.length });
    assertEq(commitDecision.publish, true, '(16) real commit in tool output → publish');
    assertEq(commitDecision.reason, 'git-references', '(16) real commit → git-references reason');
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  if (failures > 0) {
    console.error(`\n✗ agentRunProofPublisherCore smoke FAILED: ${failures} failed, ${passes} passed`);
    process.exit(1);
  }
  console.log(`✓ agentRunProofPublisherCore smoke PASSED: ${passes} assertions across 16 groups`);
}

main();
