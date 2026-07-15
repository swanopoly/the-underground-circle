/**
 * verification-receipt-core-smoketest — the pure "proof of work" receipt core
 * (src/lib/verificationReceiptCore.ts) assembled at coding-run completion
 * (verification expansion v7). Folds a run's `toolEvents` (each carrying
 * { tool, input, result, status, summary }) into { editedFiles, checks,
 * committed, commitRef?, verdict, summary }. Load-bearing assertions:
 *
 *   EDITS: paths come only from desktop.edit_file / desktop.file_write_text /
 *   a mutating local.run_shell; a failed/blocked edit contributes no path;
 *   paths dedupe; non-mutating shells (npm/cat) contribute nothing.
 *
 *   CHECKS: verification.* events → { name, passed } where passed is driven by
 *   status; planned/running/not_applicable/unknown are NOT checks.
 *
 *   COMMIT: a git.run commit event (verb 'commit' or args incl. 'commit') that
 *   didn't fail → committed, with a sha mined from its result text.
 *
 *   VERDICT: all checks passed + edits present → 'verified'; any failed check →
 *   'failed'; edits with no check (and empty input) → 'unverified'.
 *
 *   SECRET-SAFE + BOUNDED + every export TOTAL (hostile input never throws).
 *
 * Pure — loads under tsx (verificationReceiptCore has zero imports).
 */

import {
  buildVerificationReceipt,
  formatVerificationReceipt,
  type VerificationReceipt,
} from '../src/lib/verificationReceiptCore';

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

// ── shared fixtures ─────────────────────────────────────────────────────────
const editA = { tool: 'desktop.edit_file', input: { path: 'src/a.ts' }, result: '', status: 'passed', summary: '' };
const writeB = { tool: 'desktop.file_write_text', input: { path: 'src/b.ts' }, result: '', status: 'completed', summary: '' };
const editC = { tool: 'desktop.edit_file', input: { path: 'src/c.ts' }, result: '', status: 'passed', summary: '' };
const vTypecheck = { tool: 'verification.typecheck', input: {}, result: '', status: 'passed', summary: '' };
const vTests = { tool: 'verification.tests', input: {}, result: '', status: 'completed', summary: '' };
const gitCommit = { tool: 'git.run', input: { verb: 'commit', repoPath: '/r', message: 'x' }, result: '[main abc1234] x', status: 'passed', summary: '' };

function main() {
  // ── 1. Empty / degenerate → unverified with no files ──────────────────────
  {
    const r = buildVerificationReceipt({});
    assertEq(r.verdict, 'unverified', '(1) empty verdict unverified');
    assertEq(r.editedFiles.length, 0, '(1) empty no files');
    assertEq(r.checks.length, 0, '(1) empty no checks');
    assertEq(r.committed, false, '(1) empty not committed');
    assertEq(r.commitRef, undefined, '(1) empty no commitRef');
    assert(r.summary.startsWith('•'), '(1) empty summary glyph', r.summary);
    assertEq(r.summary, '• Unverified: no files edited, no checks run', '(1) empty summary text');
  }

  // ── 2. Edits + passing checks + commit → verified ─────────────────────────
  {
    const events = [editA, writeB, editC, vTypecheck, vTests, gitCommit];
    const r = buildVerificationReceipt({ editedFiles: events, checks: events, commit: events });
    assertEq(r.verdict, 'verified', '(2) verified verdict');
    assertEq(r.editedFiles.length, 3, '(2) three files');
    assertEq(r.editedFiles[0], 'src/a.ts', '(2) file a');
    assertEq(r.editedFiles[1], 'src/b.ts', '(2) file b');
    assertEq(r.editedFiles[2], 'src/c.ts', '(2) file c');
    assertEq(r.checks.length, 2, '(2) two checks');
    assertEq(r.checks[0].name, 'typecheck', '(2) check name typecheck');
    assertEq(r.checks[0].passed, true, '(2) typecheck passed');
    assertEq(r.checks[1].name, 'tests', '(2) check name tests');
    assertEq(r.checks[1].passed, true, '(2) tests passed');
    assertEq(r.committed, true, '(2) committed');
    assertEq(r.commitRef, 'abc1234', '(2) commitRef mined from result');
    assertEq(r.summary, '✓ Verified: 3 files edited, typecheck+tests passed, committed abc1234', '(2) exact summary');
    assertEq(r.summary, formatVerificationReceipt(r), '(2) summary === format(receipt)');
  }

  // ── 3. A failed check → failed ────────────────────────────────────────────
  {
    const events = [
      editA,
      vTypecheck,
      { tool: 'verification.tests', input: {}, result: '', status: 'failed', summary: '' },
    ];
    const r = buildVerificationReceipt({ editedFiles: events, checks: events, commit: events });
    assertEq(r.verdict, 'failed', '(3) failed verdict');
    assertEq(r.checks.length, 2, '(3) two checks recorded');
    assertEq(r.checks[1].passed, false, '(3) tests not passed');
    assertEq(r.committed, false, '(3) no commit');
    assertEq(r.summary, '✗ Failed: 1 file edited, typecheck passed, tests failed', '(3) exact failed summary');
    assert(r.summary.startsWith('✗'), '(3) failed glyph', r.summary);
  }

  // ── 4. Edits but no checks → unverified ───────────────────────────────────
  {
    const r = buildVerificationReceipt({ editedFiles: [writeB] });
    assertEq(r.verdict, 'unverified', '(4) unverified verdict');
    assertEq(r.editedFiles.length, 1, '(4) one file');
    assertEq(r.checks.length, 0, '(4) no checks');
    assertEq(r.summary, '• Unverified: 1 file edited, no checks run', '(4) singular file wording');
  }

  // ── 5. Blocked / manual_required checks count as not-passed → failed ──────
  {
    const blocked = buildVerificationReceipt({
      editedFiles: [editA],
      checks: [editA, { tool: 'verification.lint', input: {}, result: '', status: 'blocked', summary: '' }],
    });
    assertEq(blocked.verdict, 'failed', '(5) blocked check → failed');
    assertEq(blocked.checks.length, 1, '(5) one blocked check recorded');
    assertEq(blocked.checks[0].passed, false, '(5) blocked passed=false');

    const manual = buildVerificationReceipt({
      checks: [{ tool: 'verification.typecheck', input: {}, result: '', status: 'manual_required', summary: '' }],
    });
    assertEq(manual.verdict, 'failed', '(5) manual_required → failed');
    assertEq(manual.checks[0].passed, false, '(5) manual_required passed=false');
  }

  // ── 6. Path extraction, dedupe, failed-edit exclusion ─────────────────────
  {
    const events = [
      { tool: 'desktop.edit_file', input: { path: 'src/dup.ts' }, result: '', status: 'passed', summary: '' },
      { tool: 'desktop.edit_file', input: { path: 'src/dup.ts' }, result: '', status: 'passed', summary: '' }, // dupe
      { tool: 'desktop.file_write_text', input: { path: 'src/new.ts' }, result: '', status: 'completed', summary: '' },
      { tool: 'desktop.edit_file', input: { path: 'src/failed.ts' }, result: '', status: 'failed', summary: '' }, // excluded
      { tool: 'desktop.edit_file', input: { path: 'src/blocked.ts' }, result: '', status: 'blocked', summary: '' }, // excluded
      { tool: 'desktop.edit_file', input: { path: 'src/nostatus.ts' } }, // no status → counted
    ];
    const r = buildVerificationReceipt({ editedFiles: events });
    assertEq(r.editedFiles.length, 3, '(6) dedupe + failed/blocked excluded');
    assertEq(r.editedFiles.indexOf('src/dup.ts'), 0, '(6) dup once');
    assert(r.editedFiles.indexOf('src/new.ts') >= 0, '(6) write path present');
    assert(r.editedFiles.indexOf('src/nostatus.ts') >= 0, '(6) statusless edit counted');
    assertEq(r.editedFiles.indexOf('src/failed.ts'), -1, '(6) failed edit excluded');
    assertEq(r.editedFiles.indexOf('src/blocked.ts'), -1, '(6) blocked edit excluded');
  }

  // ── 7. Mutating shell path extraction; reads/builds contribute nothing ────
  {
    const sed = buildVerificationReceipt({
      editedFiles: [{ tool: 'local.run_shell', input: { argv: ['sed', '-i', 's/a/b/', 'src/x.ts'], cwd: '/r' }, result: '', status: 'passed', summary: '' }],
    });
    assert(sed.editedFiles.indexOf('src/x.ts') >= 0, '(7) sed -i path extracted', JSON.stringify(sed.editedFiles));
    assertEq(sed.editedFiles.indexOf('s/a/b/'), -1, '(7) sed script not treated as path');

    const redirect = buildVerificationReceipt({
      editedFiles: [{ tool: 'local.run_shell', input: { argv: ['sh', '-c', 'echo hi > out.log'], cwd: '/r' }, result: '', status: 'completed', summary: '' }],
    });
    assert(redirect.editedFiles.indexOf('out.log') >= 0, '(7) redirection target extracted', JSON.stringify(redirect.editedFiles));

    const wrapped = buildVerificationReceipt({
      editedFiles: [{ tool: 'local.run_shell', input: { argv: ['bash', '-lc', 'sed -i s/x/y/ src/y.ts'], cwd: '/r' }, result: '', status: 'passed', summary: '' }],
    });
    assert(wrapped.editedFiles.indexOf('src/y.ts') >= 0, '(7) wrapped sed path extracted', JSON.stringify(wrapped.editedFiles));

    const npm = buildVerificationReceipt({
      editedFiles: [{ tool: 'local.run_shell', input: { argv: ['npm', 'run', 'typecheck'], cwd: '/r' }, result: '', status: 'passed', summary: '' }],
    });
    assertEq(npm.editedFiles.length, 0, '(7) non-mutating npm → no files');

    const cat = buildVerificationReceipt({
      editedFiles: [{ tool: 'local.run_shell', input: { argv: ['cat', 'src/z.ts'], cwd: '/r' }, result: '', status: 'passed', summary: '' }],
    });
    assertEq(cat.editedFiles.length, 0, '(7) cat read → no files');

    const failedShell = buildVerificationReceipt({
      editedFiles: [{ tool: 'local.run_shell', input: { argv: ['sed', '-i', 's/a/b/', 'src/w.ts'], cwd: '/r' }, result: '', status: 'failed', summary: '' }],
    });
    assertEq(failedShell.editedFiles.length, 0, '(7) failed shell mutation → no files');
  }

  // ── 8. Verified/unverified driven by shell-produced paths ─────────────────
  {
    const events = [
      { tool: 'local.run_shell', input: { argv: ['sed', '-i', 's/a/b/', 'src/gen.ts'], cwd: '/r' }, result: '', status: 'passed', summary: '' },
      vTypecheck,
    ];
    const r = buildVerificationReceipt({ editedFiles: events, checks: events });
    assertEq(r.verdict, 'verified', '(8) shell edit + passing check → verified');
    assertEq(r.editedFiles.length, 1, '(8) shell path present');
  }

  // ── 9. not_applicable / planned / running are NOT checks ──────────────────
  {
    const events = [
      editA,
      vTypecheck,
      { tool: 'verification.tests', input: {}, result: '', status: 'not_applicable', summary: '' },
      { tool: 'verification.lint', input: {}, result: '', status: 'planned', summary: '' },
      { tool: 'verification.preview', input: {}, result: '', status: 'running', summary: '' },
      { tool: 'verification.custom', input: {}, result: '', status: '', summary: '' }, // unknown status skipped
    ];
    const r = buildVerificationReceipt({ editedFiles: events, checks: events });
    assertEq(r.checks.length, 1, '(9) only terminal-passed check counted');
    assertEq(r.checks[0].name, 'typecheck', '(9) typecheck retained');
    assertEq(r.verdict, 'verified', '(9) N/A checks never fail the run');
  }

  // ── 10. Commit variants ───────────────────────────────────────────────────
  {
    assertEq(buildVerificationReceipt({ commit: gitCommit }).committed, true, '(10) single git event committed');
    assertEq(buildVerificationReceipt({ commit: gitCommit }).commitRef, 'abc1234', '(10) single git ref');

    const noRef = buildVerificationReceipt({ commit: { tool: 'git.run', input: { verb: 'commit', repoPath: '/r' }, result: '', status: 'passed', summary: '' } });
    assertEq(noRef.committed, true, '(10) commit with no result still committed');
    assertEq(noRef.commitRef, undefined, '(10) no sha → no commitRef');

    assertEq(buildVerificationReceipt({ commit: { tool: 'git.run', input: { verb: 'status', repoPath: '/r' }, result: '', status: 'passed', summary: '' } }).committed, false, '(10) non-commit verb not committed');
    assertEq(buildVerificationReceipt({ commit: { tool: 'git.run', input: { verb: 'commit' }, result: '', status: 'failed', summary: '' } }).committed, false, '(10) failed commit not committed');

    const viaArgs = buildVerificationReceipt({ commit: { tool: 'git.run', input: { verb: '', args: ['commit', '-m', 'x'], repoPath: '/r' }, result: '[b 9f8e7d6] x', status: 'passed', summary: '' } });
    assertEq(viaArgs.committed, true, '(10) commit via args committed');
    assertEq(viaArgs.commitRef, '9f8e7d6', '(10) commit via args ref');

    assertEq(buildVerificationReceipt({ commit: 'abc1234' }).committed, true, '(10) string ref committed');
    assertEq(buildVerificationReceipt({ commit: 'abc1234' }).commitRef, 'abc1234', '(10) string ref value');
    assertEq(buildVerificationReceipt({ commit: '[main deadbee1] wip' }).commitRef, 'deadbee1', '(10) string commit-line ref');

    const obj = buildVerificationReceipt({ commit: { committed: true, ref: '1a2b3c4' } });
    assertEq(obj.committed, true, '(10) {committed,ref} committed');
    assertEq(obj.commitRef, '1a2b3c4', '(10) {committed,ref} ref');
    assertEq(buildVerificationReceipt({ commit: { committed: false } }).committed, false, '(10) {committed:false}');
    assertEq(buildVerificationReceipt({ commit: [editA, vTypecheck, gitCommit] }).committed, true, '(10) commit found in mixed array');
  }

  // ── 11. formatVerificationReceipt shapes ──────────────────────────────────
  {
    const committedNoRef: VerificationReceipt = { editedFiles: ['x.ts'], checks: [{ name: 'typecheck', passed: true }], committed: true, verdict: 'verified', summary: '' };
    assertEq(formatVerificationReceipt(committedNoRef), '✓ Verified: 1 file edited, typecheck passed, committed', '(11) committed-no-ref line');

    const two: VerificationReceipt = { editedFiles: ['a.ts', 'b.ts'], checks: [{ name: 'typecheck', passed: true }, { name: 'tests', passed: false }], committed: false, verdict: 'failed', summary: '' };
    assertEq(formatVerificationReceipt(two), '✗ Failed: 2 files edited, typecheck passed, tests failed', '(11) plural + mixed checks');

    const none: VerificationReceipt = { editedFiles: [], checks: [], committed: false, verdict: 'unverified', summary: '' };
    assertEq(formatVerificationReceipt(none), '• Unverified: no files edited, no checks run', '(11) empty line');
  }

  // ── 12. Pre-extracted inputs (strings / {name,passed} / ref) ──────────────
  {
    const r = buildVerificationReceipt({
      editedFiles: ['src/a.ts', 'src/b.ts', 'src/a.ts'],
      checks: [{ name: 'typecheck', passed: true }, { name: 'tests', passed: true }],
      commit: 'abc1234',
    });
    assertEq(r.verdict, 'verified', '(12) pre-extracted verified');
    assertEq(r.editedFiles.length, 2, '(12) pre-extracted strings dedupe');
    assertEq(r.checks.length, 2, '(12) pre-extracted checks');
    assertEq(r.committed, true, '(12) pre-extracted commit');
    // bare { path } object
    const bare = buildVerificationReceipt({ editedFiles: [{ path: 'src/only.ts' }] });
    assertEq(bare.editedFiles[0], 'src/only.ts', '(12) bare {path} object');
  }

  // ── 13. Bounding (huge / long inputs) ─────────────────────────────────────
  {
    const many: unknown[] = [];
    for (let i = 0; i < 1000; i++) many.push({ tool: 'desktop.edit_file', input: { path: 'src/f' + i + '.ts' }, result: '', status: 'passed', summary: '' });
    const r = buildVerificationReceipt({ editedFiles: many });
    assert(r.editedFiles.length <= 100, '(13) editedFiles bounded ≤100', String(r.editedFiles.length));

    const manyChecks: unknown[] = [];
    for (let i = 0; i < 200; i++) manyChecks.push({ tool: 'verification.c' + i, input: {}, result: '', status: 'passed', summary: '' });
    const rc = buildVerificationReceipt({ checks: manyChecks });
    assert(rc.checks.length <= 40, '(13) checks bounded ≤40', String(rc.checks.length));

    const longPath = 's'.repeat(5000) + '/huge.ts';
    const rp = buildVerificationReceipt({ editedFiles: [{ tool: 'desktop.edit_file', input: { path: longPath }, result: '', status: 'passed', summary: '' }] });
    assert(rp.editedFiles.length === 0 || rp.editedFiles[0].length <= 300, '(13) path clipped ≤300');

    const rBig = buildVerificationReceipt({ editedFiles: many, checks: manyChecks });
    assert(rBig.summary.length <= 400, '(13) summary bounded ≤400', String(rBig.summary.length));
    assert(typeof rBig.summary === 'string' && rBig.summary.length > 0, '(13) summary non-empty');
  }

  // ── 14. Secret-safety: raw result text never leaks (only the sha) ─────────
  {
    const r = buildVerificationReceipt({
      editedFiles: [{ tool: 'desktop.edit_file', input: { path: 'src/x.ts' }, result: 'TOKEN=SECRETVALUE-should-not-appear', status: 'passed', summary: 'ignore me' }],
      commit: { tool: 'git.run', input: { verb: 'commit', repoPath: '/r' }, result: '[main abc1234] added AKIA_SECRET_KEY=hunter2', status: 'passed', summary: '' },
    });
    assert(r.summary.indexOf('SECRETVALUE') === -1, '(14) edit result secret absent from summary');
    assert(r.summary.indexOf('hunter2') === -1, '(14) commit result secret absent from summary');
    assert(r.summary.indexOf('AKIA') === -1, '(14) commit result secret token absent');
    assertEq(r.commitRef, 'abc1234', '(14) only sha surfaced from commit result');
    assert(JSON.stringify(r.editedFiles).indexOf('SECRETVALUE') === -1, '(14) secret not in editedFiles');

    // control chars in a path are stripped
    const ctrl = buildVerificationReceipt({ editedFiles: [{ tool: 'desktop.file_write_text', input: { path: 'src/a\n\tb.ts' }, result: '', status: 'completed', summary: '' }] });
    assert(ctrl.editedFiles[0].indexOf('\n') === -1 && ctrl.editedFiles[0].indexOf('\t') === -1, '(14) control chars stripped from path');
  }

  // ── 15. Hostile / degenerate: every export TOTAL, never throws ────────────
  {
    const expectReceipt = (label: string, input: unknown): VerificationReceipt | null => {
      try {
        const r = buildVerificationReceipt(input as never);
        const okShape =
          !!r && typeof r === 'object' &&
          Array.isArray(r.editedFiles) && Array.isArray(r.checks) &&
          typeof r.committed === 'boolean' && typeof r.summary === 'string' &&
          (r.verdict === 'verified' || r.verdict === 'unverified' || r.verdict === 'failed');
        assert(okShape, label);
        return r;
      } catch (e) {
        assert(false, label, (e as Error)?.message);
        return null;
      }
    };
    const expectFormat = (label: string, r: unknown): void => {
      try {
        const s = formatVerificationReceipt(r as never);
        assert(typeof s === 'string' && s.length > 0 && s.length <= 400, label, s);
      } catch (e) {
        assert(false, label, (e as Error)?.message);
      }
    };

    expectReceipt('(15) null input', null);
    expectReceipt('(15) undefined input', undefined);
    expectReceipt('(15) number input', 42);
    expectReceipt('(15) string input', 'nope');
    expectReceipt('(15) boolean input', true);
    expectReceipt('(15) array input', [1, 2, 3]);
    expectReceipt('(15) wrong-typed fields', { editedFiles: 123, checks: 'x', commit: true });
    expectReceipt('(15) junk arrays', { editedFiles: [null, 1, true, {}, { tool: 123 }, () => 0, Symbol('s')], checks: [null, 5, 'x'], commit: [null, 5] });
    expectReceipt('(15) edit event missing input', { editedFiles: [{ tool: 'desktop.edit_file' }] });
    expectReceipt('(15) edit event non-string path', { editedFiles: [{ tool: 'desktop.edit_file', input: { path: 123 } }] });
    expectReceipt('(15) shell event missing argv', { editedFiles: [{ tool: 'local.run_shell', input: {} }] });

    // circular objects must not blow up (no traversal of nested refs)
    const circ: Record<string, unknown> = {};
    circ.self = circ;
    expectReceipt('(15) circular field values', { editedFiles: [circ], checks: [circ], commit: circ });

    // huge argv is bounded, not walked forever
    const hugeArgv = new Array(100000).fill('x');
    expectReceipt('(15) huge argv', { editedFiles: [{ tool: 'local.run_shell', input: { argv: hugeArgv }, status: 'passed' }] });

    // deeply nested commit arrays beyond the depth cap → simply not committed
    let nested: unknown = { tool: 'git.run', input: { verb: 'commit' }, status: 'passed', result: '[m 1234567]' };
    for (let i = 0; i < 20; i++) nested = [nested];
    const deep = expectReceipt('(15) deeply nested commit', { commit: nested });
    if (deep) assertEq(deep.committed, false, '(15) beyond-depth commit not committed');

    // huge commit result text is bounded before sha scan
    expectReceipt('(15) huge commit result text', { commit: { tool: 'git.run', input: { verb: 'commit' }, status: 'passed', result: 'z'.repeat(200000) + ' [m abc1234]' } });

    // formatVerificationReceipt on garbage receipts
    expectFormat('(15) format null', null);
    expectFormat('(15) format undefined', undefined);
    expectFormat('(15) format empty object', {});
    expectFormat('(15) format bad verdict', { verdict: 'weird', editedFiles: 'x', checks: 5, committed: 'yes', commitRef: 123 });
    expectFormat('(15) format junk checks', { verdict: 'failed', editedFiles: [1, null, 'ok.ts'], checks: [null, 3, { name: 'lint', passed: 'nah' }] });
    const built = buildVerificationReceipt({ editedFiles: [editA], checks: [vTypecheck], commit: gitCommit });
    expectFormat('(15) format a real receipt', built);
    // idempotent: format of build's own summary-bearing receipt is stable
    assertEq(formatVerificationReceipt(built), built.summary, '(15) format idempotent with build');
  }

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll verification-receipt-core smoke cases passed (' + passes + ' passed).');
}

main();
