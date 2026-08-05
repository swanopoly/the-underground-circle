/**
 * openswan-run-proof-core-smoketest — the pure proof-of-work card core
 * (src/lib/openswanRunProofCore.ts) that turns a completed OpenSwan run into a
 * feed/activity card (ACCOUNTABILITY #1). `buildRunProof` folds a run's tool
 * events, files touched, verification results, stop reason, duration, and
 * output summary into { headline (≤120), bullets (≤8), verified, proofTags }.
 *
 * Load-bearing assertions:
 *   HAPPY: tools + files + all-passing verification + clean stop →
 *     headline names the work, verified=true, tags include 'completed'/'verified',
 *     bullets carry the summary + verification + files + tools.
 *   FAILED: a failing verification check → verified=false, outcome 'failed',
 *     honest "N failed" bullet, 'checks-failed' tag.
 *   STOP-FAIL: run stopped in a failure family (max_tokens/aborted) forces
 *     verified=false even when checks passed.
 *   SECRET-SAFE: secret-bearing paths reduce to basenames only; secret tokens
 *     in free text are masked; nothing leaks a directory or key.
 *   EMPTY: no signals → neutral card (verified=false, no bullets).
 *   BOUNDED + every export TOTAL (hostile/cyclic input never throws).
 *
 * Pure — loads under tsx (openswanRunProofCore has zero imports).
 */

import { buildRunProof, type RunProof } from '../src/lib/openswanRunProofCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Structural invariants EVERY result must satisfy (bounded + typed).
function assertShape(r: RunProof, label: string): void {
  assert(!!r && typeof r === 'object', label + ' returns object');
  assert(typeof r.headline === 'string', label + ' headline is string');
  assert(r.headline.length <= 120, label + ' headline ≤120', 'len ' + (r.headline || '').length);
  assert(Array.isArray(r.bullets), label + ' bullets is array');
  assert(r.bullets.length <= 8, label + ' bullets ≤8', 'len ' + r.bullets.length);
  assert(r.bullets.every((b) => typeof b === 'string' && b.length <= 160), label + ' each bullet string ≤160');
  assert(typeof r.verified === 'boolean', label + ' verified is boolean');
  assert(Array.isArray(r.proofTags), label + ' proofTags is array');
  assert(r.proofTags.length <= 16, label + ' proofTags ≤16', 'len ' + r.proofTags.length);
  assert(r.proofTags.every((t) => typeof t === 'string' && t.length <= 40), label + ' each tag string ≤40');
  assert(new Set(r.proofTags).size === r.proofTags.length, label + ' tags deduped');
}

function hasTag(r: RunProof, t: string): boolean {
  return r.proofTags.includes(t);
}
function bulletsJoin(r: RunProof): string {
  return r.bullets.join(' ⏐ ');
}

// ── shared fixtures (real OpenSwan shapes) ──────────────────────────────────
const editA = { tool: 'desktop.edit_file', input: { path: 'src/a.ts' }, result: '', status: 'completed', summary: '' };
const editB = { tool: 'desktop.file_write_text', input: { path: 'src/lib/b.ts' }, result: '', status: 'completed', summary: '' };
const gitCommit = { tool: 'git.run', input: { verb: 'commit', message: 'x' }, result: '[main abc1234] x', status: 'completed', summary: '' };
const readTool = { tool: 'desktop.file_read_text', input: { path: 'src/a.ts' }, result: '...', status: 'completed', summary: '' };

// OpenSwanVerificationResult-shaped
const vTypePass = { check: { label: 'typecheck', kind: 'typecheck' }, status: 'passed', ok: true, executed: true, summary: 'typecheck: passed' };
const vTestPass = { check: { label: 'tests', kind: 'tests' }, status: 'passed', ok: true, executed: true, summary: 'tests: passed' };
const vTestFail = { check: { label: 'tests', kind: 'tests' }, status: 'failed', ok: false, executed: true, summary: 'tests: failed (2 failing)' };
const vLintReview = { check: { label: 'lint', kind: 'lint' }, status: 'manual_required', ok: false, executed: false, summary: 'lint: manual review required' };
const vNa = { check: { label: 'preview', kind: 'preview' }, status: 'not_applicable', ok: true, executed: false, summary: 'preview: n/a' };

function main() {
  // ── 1. Happy path: tools + files + passing verification → verified ────────
  {
    const r = buildRunProof({
      toolsUsed: [editA, editB, gitCommit, { tool: 'verification.typecheck', status: 'completed' }, { tool: 'verification.tests', status: 'completed' }],
      filesTouched: ['src/a.ts', 'src/lib/b.ts'],
      verification: [vTypePass, vTestPass],
      stopReason: 'end_turn',
      durationMs: 42_000,
      outputSummary: 'Refactored the auth session helper and added tests.',
    });
    assertShape(r, '(1)');
    assertEq(r.verified, true, '(1) verified true');
    assert(r.headline.startsWith('Completed:'), '(1) headline Completed', r.headline);
    assert(/2 files edited/.test(r.headline), '(1) headline names files', r.headline);
    assert(hasTag(r, 'completed'), '(1) tag completed');
    assert(hasTag(r, 'verified'), '(1) tag verified');
    assert(hasTag(r, 'files:2'), '(1) tag files:2');
    assert(hasTag(r, 'typecheck'), '(1) tag typecheck kind');
    assert(hasTag(r, 'tests'), '(1) tag tests kind');
    assert(hasTag(r, 'committed'), '(1) tag committed');
    assert(!hasTag(r, 'unverified'), '(1) not unverified');
    const bj = bulletsJoin(r);
    assert(/Refactored the auth session/.test(bj), '(1) summary bullet present');
    assert(/Verification:.*passed/.test(bj), '(1) verification bullet present');
    assert(/Touched 2 files/.test(bj), '(1) files bullet present');
    assert(/Committed changes to git/.test(bj), '(1) commit bullet present');
    assert(/typecheck\+tests passed/.test(bj) || /2 checks passed/.test(bj), '(1) both checks named');
  }

  // ── 2. Failed verification → verified false + honest bullets ──────────────
  {
    const r = buildRunProof({
      toolsUsed: [editA],
      filesTouched: [editA],
      verification: [vTypePass, vTestFail],
      stopReason: 'end_turn',
      durationMs: 12_000,
      outputSummary: 'Attempted fix; tests still failing.',
    });
    assertShape(r, '(2)');
    assertEq(r.verified, false, '(2) verified false on failed check');
    assert(r.headline.startsWith('Failed:'), '(2) headline Failed', r.headline);
    assert(/tests failed/.test(r.headline), '(2) headline names failed check', r.headline);
    assert(hasTag(r, 'failed'), '(2) tag failed');
    assert(hasTag(r, 'unverified'), '(2) tag unverified');
    assert(hasTag(r, 'checks-failed'), '(2) tag checks-failed');
    assert(!hasTag(r, 'verified'), '(2) no verified tag');
    const bj = bulletsJoin(r);
    assert(/Verification:.*passed.*failed/.test(bj) || /failed/.test(bj), '(2) honest failure bullet');
  }

  // ── 3. Stop-reason failure overrides passing checks → verified false ──────
  {
    const r = buildRunProof({
      toolsUsed: [editA],
      filesTouched: [editA],
      verification: [vTypePass, vTestPass],
      stopReason: 'max_tokens',
      durationMs: 999,
    });
    assertShape(r, '(3)');
    assertEq(r.verified, false, '(3) verified false when run stopped');
    assert(r.headline.startsWith('Stopped:'), '(3) headline Stopped', r.headline);
    assert(hasTag(r, 'stopped'), '(3) tag stopped');
    assert(hasTag(r, 'unverified'), '(3) tag unverified');
    assert(/Stop reason: max_tokens/.test(bulletsJoin(r)), '(3) stop-reason bullet');
    // aborted family
    const r2 = buildRunProof({ verification: [vTypePass], stopReason: 'aborted', filesTouched: ['x.ts'] });
    assertEq(r2.verified, false, '(3) aborted → not verified');
    assert(hasTag(r2, 'stopped'), '(3) aborted tag stopped');
  }

  // ── 4. Secret-safe: paths reduce to basename only ─────────────────────────
  {
    const secretPath = '/Users/cswanson/.aws/creds-AKIAIOSFODNN7EXAMPLE/config.ts';
    const r = buildRunProof({
      filesTouched: [secretPath, '/home/deploy/.ssh/id_rsa-secret/main.ts'],
      verification: [vTypePass],
      stopReason: 'end_turn',
    });
    assertShape(r, '(4)');
    const bj = bulletsJoin(r);
    assert(bj.includes('config.ts'), '(4) basename kept');
    assert(bj.includes('main.ts'), '(4) second basename kept');
    assert(!bj.includes('AKIAIOSFODNN7EXAMPLE'), '(4) no secret dir leaked');
    assert(!bj.includes('.aws'), '(4) no .aws dir leaked');
    assert(!bj.includes('/Users/cswanson'), '(4) no absolute path leaked');
    assert(!bj.includes('id_rsa-secret'), '(4) no ssh dir leaked');
    assert(!r.headline.includes('/'), '(4) headline path-free');
    assert(!bulletsJoin(r).includes('/Users'), '(4) bullets path-free');
  }

  // ── 5. Secret-safe: free-text output summary is scrubbed ──────────────────
  {
    const r = buildRunProof({
      filesTouched: ['a.ts'],
      outputSummary: 'Deployed with token sk-ant-abcdef1234567890XYZ and key AKIAIOSFODNN7EXAMPLE at /var/secrets/prod/deploy.log password=hunter2',
      stopReason: 'end_turn',
    });
    assertShape(r, '(5)');
    const bj = bulletsJoin(r) + ' ' + r.headline;
    assert(!bj.includes('sk-ant-abcdefg') && !/sk-ant-abcdef1234567890/.test(bj), '(5) sk- token masked');
    assert(!bj.includes('AKIAIOSFODNN7EXAMPLE'), '(5) AWS key masked');
    assert(!bj.includes('hunter2'), '(5) password value masked');
    assert(!bj.includes('/var/secrets/prod'), '(5) secret dir stripped');
    assert(bj.includes('[redacted]') || bj.includes('deploy.log'), '(5) redaction/basename applied');
  }

  // ── 6. Empty / degenerate → neutral card ──────────────────────────────────
  {
    const r = buildRunProof({});
    assertShape(r, '(6)');
    assertEq(r.verified, false, '(6) empty not verified');
    assertEq(r.bullets.length, 0, '(6) empty no bullets');
    assert(r.headline.length > 0, '(6) neutral headline non-empty');
    assert(/no recorded activity/i.test(r.headline), '(6) neutral headline wording', r.headline);
    assert(hasTag(r, 'no-activity'), '(6) tag no-activity');
    assert(!hasTag(r, 'verified') && !hasTag(r, 'unverified'), '(6) no verify tags on empty');
  }

  // ── 7. Files mined from tool events when filesTouched omitted ─────────────
  {
    const r = buildRunProof({
      toolsUsed: [editA, editB, readTool],
      verification: [vTypePass],
      stopReason: 'end_turn',
    });
    assertShape(r, '(7)');
    assert(hasTag(r, 'files:2'), '(7) files mined from edit events (read excluded)');
    const bj = bulletsJoin(r);
    assert(bj.includes('a.ts') && bj.includes('b.ts'), '(7) mined basenames present');
    assert(!bj.includes('src/lib/b.ts'), '(7) mined paths basenamed');
  }

  // ── 8. Tools accounting: names, call count, failed count ──────────────────
  {
    const r = buildRunProof({
      toolsUsed: [
        { tool: 'desktop.edit_file', status: 'completed', input: { path: 'a.ts' } },
        { tool: 'verification.tests', status: 'failed' },
        { tool: 'git.run', status: 'blocked', input: { verb: 'push' } },
        'browser.navigate',
      ],
      stopReason: 'end_turn',
    });
    assertShape(r, '(8)');
    const bj = bulletsJoin(r);
    assert(/Used 4 tool calls/.test(bj), '(8) call count = 4', bj);
    assert(/2 failed/.test(bj), '(8) failed count = 2 (tests + git)', bj);
    assert(hasTag(r, 'tools:4'), '(8) tag tools:4 distinct');
    assert(bj.includes('browser.navigate'), '(8) string tool name listed');
  }

  // ── 9. not_applicable checks never count; review needs review ─────────────
  {
    const rNa = buildRunProof({ verification: [vTypePass, vNa], filesTouched: ['a.ts'], stopReason: 'end_turn' });
    assertShape(rNa, '(9)');
    assertEq(rNa.verified, true, '(9) na check ignored → still verified');
    assert(!bulletsJoin(rNa).includes('preview'), '(9) na check not shown');

    const rReview = buildRunProof({ verification: [vTypePass, vLintReview], filesTouched: ['a.ts'], stopReason: 'end_turn' });
    assertEq(rReview.verified, false, '(9) review check → not verified');
    assert(hasTag(rReview, 'needs-review'), '(9) tag needs-review');
    assert(/need review/.test(bulletsJoin(rReview)), '(9) review bullet');
  }

  // ── 10. Pre-extracted { name, passed } check shape ────────────────────────
  {
    const r = buildRunProof({
      verification: [{ name: 'typecheck', passed: true }, { name: 'tests', passed: false }],
      filesTouched: ['a.ts'],
      stopReason: 'end_turn',
    });
    assertShape(r, '(10)');
    assertEq(r.verified, false, '(10) pre-extracted failing → not verified');
    assert(hasTag(r, 'checks-failed'), '(10) tag checks-failed');
    const rPass = buildRunProof({ verification: [{ name: 'lint', passed: true }], filesTouched: ['a.ts'], stopReason: 'end_turn' });
    assertEq(rPass.verified, true, '(10) pre-extracted passing → verified');
    assert(hasTag(rPass, 'lint'), '(10) kind tag from name');
  }

  // ── 11. Container unwrapping (result.verificationResults / {toolEvents}) ───
  {
    const r = buildRunProof({
      toolsUsed: { toolEvents: [editA, editB] },
      filesTouched: { editedFiles: ['a.ts', 'b.ts'] },
      verification: { verificationResults: [vTypePass, vTestPass] },
      stopReason: 'end_turn',
    });
    assertShape(r, '(11)');
    assertEq(r.verified, true, '(11) unwrapped containers → verified');
    assert(hasTag(r, 'files:2'), '(11) unwrapped files');
    assert(hasTag(r, 'tools:2'), '(11) unwrapped tools');
  }

  // ── 12. Duration formatting ───────────────────────────────────────────────
  {
    const mk = (ms: unknown) => buildRunProof({ filesTouched: ['a.ts'], durationMs: ms, stopReason: 'end_turn' });
    assert(/Ran for 500ms/.test(bulletsJoin(mk(500))), '(12) sub-second ms');
    assert(/Ran for 5s/.test(bulletsJoin(mk(5_000))), '(12) seconds');
    assert(/Ran for 2m 30s/.test(bulletsJoin(mk(150_000))), '(12) minutes+seconds');
    assert(/Ran for 1h 1m/.test(bulletsJoin(mk(3_660_000))), '(12) hours+minutes');
    assert(!/Ran for/.test(bulletsJoin(mk(0))), '(12) zero → no duration');
    assert(!/Ran for/.test(bulletsJoin(mk(-5))), '(12) negative → no duration');
    assert(!/Ran for/.test(bulletsJoin(mk(NaN))), '(12) NaN → no duration');
    assertShape(mk(Number.MAX_VALUE), '(12) huge duration bounded');
  }

  // ── 13. Summary-only run (no tools/files/checks) → uses summary in headline
  {
    const r = buildRunProof({ outputSummary: 'Answered the question about routing.', stopReason: 'end_turn' });
    assertShape(r, '(13)');
    assert(r.headline.startsWith('Completed:'), '(13) summary-only completed', r.headline);
    assert(/Answered the question/.test(r.headline), '(13) summary in headline');
    assertEq(r.verified, false, '(13) no checks → not verified');
    assert(!hasTag(r, 'unverified'), '(13) nothing to verify → no unverified tag');
  }

  // ── 14. Bare stop-fail with no other detail → sensible headline ───────────
  {
    const r = buildRunProof({ stopReason: 'failed' });
    assertShape(r, '(14)');
    assert(r.headline.startsWith('Stopped:'), '(14) bare fail → Stopped', r.headline);
    assert(/run stopped/.test(r.headline), '(14) fallback tail', r.headline);
    assert(hasTag(r, 'stopped'), '(14) tag stopped');
    // 'tool_use' is neutral, not a failure
    const rNeutral = buildRunProof({ stopReason: 'tool_use', filesTouched: ['a.ts'] });
    assert(rNeutral.headline.startsWith('Completed:'), '(14) tool_use neutral → Completed', rNeutral.headline);
    assertEq(hasTag(rNeutral, 'stopped'), false, '(14) tool_use not stopped');
  }

  // ── 15. Determinism: same input → identical output ────────────────────────
  {
    const input = {
      toolsUsed: [editA, editB, gitCommit],
      filesTouched: ['a.ts', 'b.ts'],
      verification: [vTypePass, vTestPass],
      stopReason: 'end_turn',
      durationMs: 30_000,
      outputSummary: 'Did the thing.',
    };
    const a = buildRunProof(input);
    const b = buildRunProof(input);
    assertEq(JSON.stringify(a), JSON.stringify(b), '(15) deterministic');
  }

  // ── 16. Dedup: repeated files / tools collapse ────────────────────────────
  {
    const r = buildRunProof({
      toolsUsed: [editA, editA, editA, { tool: 'verification.tests', status: 'completed' }],
      filesTouched: ['src/a.ts', 'other/a.ts', 'a.ts'], // all basename a.ts
      verification: [vTestPass],
      stopReason: 'end_turn',
    });
    assertShape(r, '(16)');
    assert(hasTag(r, 'files:1'), '(16) same-basename files dedup to 1');
    assert(hasTag(r, 'tools:2'), '(16) distinct tool names = 2');
    assert(/Used 4 tool calls/.test(bulletsJoin(r)), '(16) call count still counts repeats');
  }

  // ── 17. Bounded: hostile huge arrays / long strings stay in bounds ────────
  {
    const bigTools = Array.from({ length: 5000 }, (_, i) => ({ tool: 'tool.' + (i % 300), status: 'completed' }));
    const bigFiles = Array.from({ length: 5000 }, (_, i) => 'dir/f' + i + '.ts');
    const bigChecks = Array.from({ length: 5000 }, (_, i) => ({ check: { label: 'c' + i, kind: 'typecheck' }, status: 'passed', ok: true }));
    const r = buildRunProof({
      toolsUsed: bigTools,
      filesTouched: bigFiles,
      verification: bigChecks,
      outputSummary: 'z'.repeat(500_000),
      stopReason: 'end_turn',
      durationMs: 12_345,
    });
    assertShape(r, '(17)');
    assert(r.proofTags.length <= 16, '(17) tags bounded');
    assert(r.bullets.length <= 8, '(17) bullets bounded');
    assert(r.headline.length <= 120, '(17) headline bounded');
  }

  // ── 18. HOSTILE no-throw group: every export tolerates garbage ────────────
  {
    const garbage: unknown[] = [
      null, undefined, 0, 1, -1, NaN, Infinity, -Infinity, true, false, '', 'x', 'a'.repeat(100000),
      [], {}, [null, undefined, 1, 'x', {}, []], { toolsUsed: 5 }, { filesTouched: 'not-array' },
      { verification: 'x' }, { stopReason: {} }, { durationMs: 'abc' }, { outputSummary: 12 },
      { toolsUsed: [null, 1, 'x', { tool: 5 }, { tool: 'ok', status: 7 }] },
      { filesTouched: [1, true, null, {}, { path: 5 }, { path: '/a/b/c.ts' }] },
      { verification: [null, 1, 'x', {}, { status: 'weird' }, { ok: 'yes' }] },
      Symbol('s') as unknown, (() => {}) as unknown, new Date() as unknown, /re/ as unknown,
      { toolsUsed: { toolEvents: 'nope' } }, { verification: { results: 42 } },
    ];
    for (let i = 0; i < garbage.length; i++) {
      let r: RunProof | null = null;
      let threw = false;
      try {
        r = buildRunProof(garbage[i] as RunProof extends never ? never : any);
      } catch {
        threw = true;
      }
      assert(!threw, '(18) no throw on garbage #' + i);
      if (r) assertShape(r, '(18) garbage #' + i);
    }

    // Cyclic structures must not hang or throw.
    const cyc: any = { tool: 'desktop.edit_file', input: { path: 'a.ts' }, status: 'completed' };
    cyc.self = cyc;
    cyc.input.owner = cyc;
    const arrCyc: any[] = [cyc];
    arrCyc.push(arrCyc);
    let cycThrew = false;
    let rc: RunProof | null = null;
    try {
      rc = buildRunProof({ toolsUsed: arrCyc, filesTouched: arrCyc, verification: arrCyc, stopReason: 'end_turn' });
    } catch {
      cycThrew = true;
    }
    assert(!cycThrew, '(18) cyclic input no throw');
    if (rc) assertShape(rc, '(18) cyclic result shape');

    // Non-object top-level inputs.
    assertShape(buildRunProof(null as unknown as RunProof), '(18) null input');
    assertShape(buildRunProof(undefined as unknown as RunProof), '(18) undefined input');
    assertShape(buildRunProof('string' as unknown as RunProof), '(18) string input');
    assertShape(buildRunProof(42 as unknown as RunProof), '(18) number input');
    assertShape(buildRunProof([] as unknown as RunProof), '(18) array input');
  }

  // ── 19. Verified requires at least one PASS (files w/o checks ≠ verified) ──
  {
    const r = buildRunProof({ toolsUsed: [editA], filesTouched: ['a.ts'], stopReason: 'end_turn' });
    assertShape(r, '(19)');
    assertEq(r.verified, false, '(19) edits without checks not verified');
    assert(hasTag(r, 'unverified'), '(19) tag unverified');
    assert(/No verification checks were run/.test(bulletsJoin(r)), '(19) honest no-checks bullet');
    assert(hasTag(r, 'completed'), '(19) still completed outcome');
  }

  // ── 20. Tag ordering & content sanity ─────────────────────────────────────
  {
    const r = buildRunProof({
      toolsUsed: [editA, gitCommit],
      filesTouched: ['a.ts'],
      verification: [vTypePass],
      stopReason: 'completed',
      durationMs: 1000,
    });
    assertShape(r, '(20)');
    assertEq(r.proofTags[0], 'completed', '(20) outcome tag first');
    assert(r.proofTags.indexOf('verified') > 0, '(20) verified tag present after outcome');
    assert(hasTag(r, 'committed'), '(20) committed tag');
    assert(r.proofTags.every((t) => /^[a-z0-9:-]+$/.test(t)), '(20) tags are clean slugs');
  }

  // ── 21. Wiring-parallel: raw toolEvents fed to all three fields ───────────
  // Mirrors the sibling verification receipt call
  // buildVerificationReceipt({ editedFiles: toolEvents, checks: toolEvents, commit: toolEvents }).
  // Only verification.* events become checks; only edit tools become files;
  // reads/git/other tool events are never mistaken for checks or touches.
  {
    const toolEvents = [
      editA, // edit
      editB, // edit
      readTool, // read — not a touch, not a check
      gitCommit, // git commit — not a check
      { tool: 'verification.typecheck', input: {}, result: '', status: 'completed', summary: 'ok' },
      { tool: 'verification.tests', input: {}, result: '', status: 'completed', summary: 'ok' },
      { tool: 'browser.navigate', input: {}, result: '', status: 'completed', summary: '' },
    ];
    const r = buildRunProof({
      toolsUsed: toolEvents,
      filesTouched: toolEvents,
      verification: toolEvents,
      stopReason: 'end_turn',
      durationMs: 55_000,
      outputSummary: 'Edited two files and verified.',
    });
    assertShape(r, '(21)');
    assertEq(r.verified, true, '(21) only verification.* passed → verified');
    assert(hasTag(r, 'files:2'), '(21) exactly 2 edited files (read excluded)', JSON.stringify(r.proofTags));
    assert(hasTag(r, 'typecheck') && hasTag(r, 'tests'), '(21) verification kinds tagged');
    assert(hasTag(r, 'committed'), '(21) commit detected from toolEvents');
    assert(!hasTag(r, 'checks-failed'), '(21) no spurious failed check from edit events');
    const bj = bulletsJoin(r);
    assert(/Verification: .*passed/.test(bj), '(21) verification bullet');
    assert(!/desktop\.edit_file passed/.test(bj), '(21) edit event not shown as a passed check');
    assert(/2 checks passed/.test(bj) || /typecheck\+tests passed/.test(bj), '(21) exactly the two real checks');
    assert(bj.includes('a.ts') && bj.includes('b.ts'), '(21) edited basenames present');
  }

  if (failures > 0) {
    console.error('\n' + failures + ' fail (' + passes + ' passed)');
    process.exit(1);
  }
  console.log('\nAll openswan-run-proof-core smoke cases passed (' + passes + ' passed).');
}

main();
