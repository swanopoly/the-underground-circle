/**
 * run-and-fix-gate-core-smoketest — the pure run-and-fix verification gate core
 * (src/lib/runAndFixGateCore.ts) behind the P6 auto-nudge in
 * docs/CODING_AGENT_UPGRADE_PLAN.md (run verification after code edits; fix
 * failures before finishing). Load-bearing assertions:
 *
 *   STATE FOLDING: successful CODE_MUTATION calls dirty the workspace (and pin
 *   dirtySinceRound); failed edits do NOT; a passing verification.* round clears
 *   dirty; a failing one keeps it dirty with lastVerificationOk=false; within a
 *   single round, a mutation AFTER the verification keeps the workspace dirty
 *   while a mutation BEFORE a passing verification ends clean; folding never
 *   mutates its input and always increments round, even for degenerate calls.
 *
 *   NUDGE PLANNING: no nudge on the round an edit just landed; the
 *   'dirty_unverified' nudge fires on the following round; 'verification_failed'
 *   fires the same round the verification failed; markNudgeSent blocks a second
 *   nudge that round; the run-wide cap is MAX_VERIFICATION_NUDGES_PER_RUN.
 *
 *   And: every export is total — degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (runAndFixGateCore has zero imports).
 */

import {
  CODE_MUTATION_TOOL_NAMES,
  VERIFICATION_TOOL_PREFIX,
  MAX_VERIFICATION_NUDGES_PER_RUN,
  classifyExecCallForGate,
  createRunAndFixGateState,
  foldRunAndFixRound,
  planVerificationNudge,
  markNudgeSent,
  type RunAndFixGateState,
} from '../src/lib/runAndFixGateCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) constants + zeroed initial state ─────────────────────────────────
  assert(CODE_MUTATION_TOOL_NAMES.has('desktop.edit_file'), '(1) desktop.edit_file is a code-mutation tool');
  assert(CODE_MUTATION_TOOL_NAMES.has('desktop.file_write_text'), '(1) desktop.file_write_text is a code-mutation tool');
  assert(!CODE_MUTATION_TOOL_NAMES.has('desktop.file_read'), '(1) reads are not mutation tools');
  assertEq(VERIFICATION_TOOL_PREFIX, 'verification.', '(1) verification prefix');
  assertEq(MAX_VERIFICATION_NUDGES_PER_RUN, 2, '(1) nudge cap is 2');
  const s0 = createRunAndFixGateState();
  assertEq(s0.dirty, false, '(1) initial dirty=false');
  assertEq(s0.dirtySinceRound, null, '(1) initial dirtySinceRound=null');
  assertEq(s0.lastVerificationOk, null, '(1) initial lastVerificationOk=null');
  assertEq(s0.lastVerificationRound, null, '(1) initial lastVerificationRound=null');
  assertEq(s0.nudgesSent, 0, '(1) initial nudgesSent=0');
  assertEq(s0.lastNudgeRound, null, '(1) initial lastNudgeRound=null');
  assertEq(s0.round, 0, '(1) initial round=0');

  // ─── (2) successful edit dirties; failed edit does not ────────────────────
  const s2 = foldRunAndFixRound(createRunAndFixGateState(), [
    { name: 'desktop.edit_file', ok: true },
  ]);
  assertEq(s2.round, 1, '(2) round incremented to 1');
  assertEq(s2.dirty, true, '(2) successful edit dirties');
  assertEq(s2.dirtySinceRound, 1, '(2) dirtySinceRound pinned to this round');
  const s2b = foldRunAndFixRound(createRunAndFixGateState(), [
    { name: 'desktop.file_write_text', ok: true },
  ]);
  assertEq(s2b.dirty, true, '(2) file_write_text also dirties');
  const s2c = foldRunAndFixRound(createRunAndFixGateState(), [
    { name: 'desktop.edit_file', ok: false },
  ]);
  assertEq(s2c.dirty, false, '(2) FAILED edit does not dirty');
  assertEq(s2c.dirtySinceRound, null, '(2) failed edit leaves dirtySinceRound null');
  const s2d = foldRunAndFixRound(createRunAndFixGateState(), [
    { name: 'desktop.file_read', ok: true },
    { name: 'shell.run', ok: true },
  ]);
  assertEq(s2d.dirty, false, '(2) non-mutation tools do not dirty');

  // ─── (3) dirty persists across rounds; dirtySinceRound is sticky ──────────
  const s3 = foldRunAndFixRound(s2, [{ name: 'desktop.file_read', ok: true }]);
  assertEq(s3.round, 2, '(3) round advances');
  assertEq(s3.dirty, true, '(3) dirty persists with no verification');
  assertEq(s3.dirtySinceRound, 1, '(3) dirtySinceRound stays at first dirty round');
  const s3b = foldRunAndFixRound(s3, [{ name: 'desktop.edit_file', ok: true }]);
  assertEq(s3b.dirtySinceRound, 1, '(3) another edit while dirty does not reset dirtySinceRound');

  // ─── (4) verification pass clears dirty ───────────────────────────────────
  const s4 = foldRunAndFixRound(s3, [{ name: 'verification.typecheck', ok: true }]);
  assertEq(s4.dirty, false, '(4) passing verification clears dirty');
  assertEq(s4.dirtySinceRound, null, '(4) dirtySinceRound reset on clean');
  assertEq(s4.lastVerificationOk, true, '(4) lastVerificationOk=true');
  assertEq(s4.lastVerificationRound, 3, '(4) lastVerificationRound pinned to this round');

  // ─── (5) verification fail keeps dirty ────────────────────────────────────
  const s5 = foldRunAndFixRound(s3, [{ name: 'verification.typecheck', ok: false }]);
  assertEq(s5.dirty, true, '(5) failing verification keeps dirty');
  assertEq(s5.lastVerificationOk, false, '(5) lastVerificationOk=false');
  assertEq(s5.lastVerificationRound, 3, '(5) lastVerificationRound recorded on failure');
  // mixed verification results in one round → not all ok → fail, stays dirty
  const s5b = foldRunAndFixRound(s3, [
    { name: 'verification.typecheck', ok: true },
    { name: 'verification.tests', ok: false },
  ]);
  assertEq(s5b.lastVerificationOk, false, '(5) any failing verification.* call fails the round');
  assertEq(s5b.dirty, true, '(5) mixed pass/fail round stays dirty');

  // ─── (6) same-round ordering: mutation AFTER verification stays dirty ─────
  const s6 = foldRunAndFixRound(createRunAndFixGateState(), [
    { name: 'verification.typecheck', ok: true },
    { name: 'desktop.edit_file', ok: true },
  ]);
  assertEq(s6.dirty, true, '(6) mutation after passing verification → still dirty');
  assertEq(s6.dirtySinceRound, 1, '(6) dirtySinceRound set for post-verify mutation');
  assertEq(s6.lastVerificationOk, true, '(6) verification itself still recorded ok');

  // ─── (7) same-round ordering: mutation BEFORE verification ends clean ─────
  const s7 = foldRunAndFixRound(createRunAndFixGateState(), [
    { name: 'desktop.edit_file', ok: true },
    { name: 'verification.typecheck', ok: true },
  ]);
  assertEq(s7.dirty, false, '(7) edit then passing verification → clean');
  assertEq(s7.dirtySinceRound, null, '(7) dirtySinceRound cleared');
  assertEq(s7.lastVerificationOk, true, '(7) verification ok recorded');
  // ...but a FAILED mutation after the verification does not re-dirty
  const s7b = foldRunAndFixRound(createRunAndFixGateState(), [
    { name: 'verification.typecheck', ok: true },
    { name: 'desktop.edit_file', ok: false },
  ]);
  assertEq(s7b.dirty, false, '(7) failed mutation after verification does not dirty');

  // ─── (8) no nudge the round an edit just landed ───────────────────────────
  const n8 = planVerificationNudge(s2); // dirty since round 1, round 1
  assertEq(n8.shouldNudge, false, '(8) no nudge on the round the edit landed');
  assertEq(n8.reason, 'none', '(8) reason none');
  assertEq(n8.note, '', '(8) empty note when not nudging');

  // ─── (9) dirty_unverified nudge fires the following round ─────────────────
  const n9 = planVerificationNudge(s3); // dirty since round 1, now round 2
  assertEq(n9.shouldNudge, true, '(9) nudge fires after a full dirty round');
  assertEq(n9.reason, 'dirty_unverified', '(9) reason dirty_unverified');
  assert(n9.note.includes('verification.typecheck'), '(9) note names verification.typecheck');
  assert(n9.note.includes('verification.tests'), '(9) note mentions verification.tests');
  assertEq(planVerificationNudge(s3).note, n9.note, '(9) note text is deterministic');
  // clean workspace → no nudge
  assertEq(planVerificationNudge(foldRunAndFixRound(s4, [])).shouldNudge, false, '(9) clean workspace never nudges');

  // ─── (10) verification_failed nudge fires the same round ──────────────────
  const n10 = planVerificationNudge(s5); // verification failed in round 3
  assertEq(n10.shouldNudge, true, '(10) failed verification nudges immediately');
  assertEq(n10.reason, 'verification_failed', '(10) reason verification_failed');
  assert(n10.note.includes('re-run the SAME verification tool'), '(10) note demands re-running the same tool');
  assert(n10.note.includes('fix the code'), '(10) note demands fixing the code');
  // a STALE failure (previous round) does not trigger verification_failed
  const s10b = foldRunAndFixRound(s5, [{ name: 'desktop.file_read', ok: true }]);
  const n10b = planVerificationNudge(s10b);
  assert(n10b.reason !== 'verification_failed', '(10) stale failure is not verification_failed');
  assertEq(n10b.reason, 'dirty_unverified', '(10) stale failure + still-dirty falls back to dirty_unverified');

  // ─── (11) markNudgeSent blocks a second nudge in the same round ───────────
  const s11 = markNudgeSent(s5);
  assertEq(s11.nudgesSent, 1, '(11) nudgesSent incremented');
  assertEq(s11.lastNudgeRound, 3, '(11) lastNudgeRound pinned to current round');
  assertEq(planVerificationNudge(s11).shouldNudge, false, '(11) no second nudge in the same round');
  // next round: the (still dirty) state may nudge again
  const s11b = foldRunAndFixRound(s11, [{ name: 'desktop.file_read', ok: true }]);
  assertEq(planVerificationNudge(s11b).shouldNudge, true, '(11) nudging re-enabled the following round');

  // ─── (12) run-wide cap at MAX_VERIFICATION_NUDGES_PER_RUN ─────────────────
  const s12 = markNudgeSent(s11b); // second nudge sent → at cap
  assertEq(s12.nudgesSent, 2, '(12) two nudges recorded');
  const s12b = foldRunAndFixRound(s12, [{ name: 'verification.typecheck', ok: false }]);
  assertEq(planVerificationNudge(s12b).shouldNudge, false, '(12) capped: even a fresh failure does not nudge');
  assertEq(planVerificationNudge(s12b).reason, 'none', '(12) capped reason is none');

  // ─── (13) immutability — folding/marking never mutates the input ──────────
  const frozen: RunAndFixGateState = createRunAndFixGateState();
  const folded = foldRunAndFixRound(frozen, [{ name: 'desktop.edit_file', ok: true }]);
  assert(folded !== frozen, '(13) fold returns a new object');
  assertEq(frozen.round, 0, '(13) input round unchanged');
  assertEq(frozen.dirty, false, '(13) input dirty unchanged');
  const marked = markNudgeSent(folded);
  assert(marked !== folded, '(13) markNudgeSent returns a new object');
  assertEq(folded.nudgesSent, 0, '(13) input nudgesSent unchanged');

  // ─── (14) degenerate calls still increment round ──────────────────────────
  assertEq(foldRunAndFixRound(s0, undefined).round, 1, '(14) undefined calls → round++');
  assertEq(foldRunAndFixRound(s0, null).round, 1, '(14) null calls → round++');
  assertEq(foldRunAndFixRound(s0, 'nope').round, 1, '(14) string calls → round++');
  assertEq(foldRunAndFixRound(s0, []).round, 1, '(14) empty calls → round++');
  assertEq(foldRunAndFixRound(s0, undefined).dirty, false, '(14) degenerate calls leave dirty untouched');
  const s14 = foldRunAndFixRound(s0, [null, 42, {}, { name: 7 }, { name: '' }, { name: 'desktop.edit_file', ok: true }] as any);
  assertEq(s14.dirty, true, '(14) junk entries skipped; the valid edit still dirties');

  // ─── (16) exec-aware classification (P2/P3: local.run_shell / git.run) ───
  {
    const dirty = foldRunAndFixRound(s0, [{ name: 'desktop.edit_file', ok: true }]);
    // npm test through the shell IS a verification: passing run clears dirty.
    const green = foldRunAndFixRound(dirty, [{ name: 'local.run_shell', ok: true, input: { argv: ['npm', 'test'], cwd: '~' } }]);
    assertEq(green.dirty, false, '(16) passing npm test via run_shell clears dirty');
    assertEq(green.lastVerificationOk, true, '(16) shell test run records verification ok');
    // Failing test run (non-zero exit → ok:false) keeps dirty + records failure.
    const red = foldRunAndFixRound(dirty, [{ name: 'local.run_shell', ok: false, input: { argv: ['npx', 'vitest'], cwd: '~' } }]);
    assertEq(red.dirty, true, '(16) failing shell test keeps dirty');
    // npx is not a verification lead — a FAILING npx call is not a verification
    // record at all (tight matcher); vitest directly IS.
    const redDirect = foldRunAndFixRound(dirty, [{ name: 'local.run_shell', ok: false, input: { argv: ['vitest'], cwd: '~' } }]);
    assertEq(redDirect.lastVerificationOk, false, '(16) failing vitest records verification failure');
    // Neutral reads neither verify nor dirty.
    const neutral = foldRunAndFixRound(s0, [{ name: 'local.run_shell', ok: true, input: { argv: ['ls', '-la'], cwd: '~' } }]);
    assertEq(neutral.dirty, false, '(16) ls does not dirty');
    assertEq(neutral.lastVerificationRound, null, '(16) ls is not a verification');
    // Unknown commands fail safe to mutation (dirty).
    const unknown = foldRunAndFixRound(s0, [{ name: 'local.run_shell', ok: true, input: { argv: ['python', 'gen.py'], cwd: '~' } }]);
    assertEq(unknown.dirty, true, '(16) unknown shell command fails safe to dirty');
    // git worktree changers dirty; commit after a green run does NOT re-dirty.
    const coDirty = foldRunAndFixRound(s0, [{ name: 'git.run', ok: true, input: { verb: 'checkout', repoPath: '~' } }]);
    assertEq(coDirty.dirty, true, '(16) git checkout dirties the worktree');
    const committed = foldRunAndFixRound(green, [{ name: 'git.run', ok: true, input: { verb: 'commit', message: 'x', repoPath: '~' } }]);
    assertEq(committed.dirty, false, '(16) git commit after a green run stays clean');
    // classifyExecCallForGate is total + null for other tools.
    assertEq(classifyExecCallForGate('tasks.list', {}), null, '(16) non-exec tools return null');
    const degenerate = classifyExecCallForGate('local.run_shell', undefined);
    assert(degenerate !== null && degenerate.isMutation && !degenerate.isVerification, '(16) degenerate exec input fails safe to mutation');
  }

  // ─── (16b) verification tools with rewrite flags are MUTATIONS ─────────────
  // A formatter/fixer that exits 0 applied fixes; it did NOT prove correctness,
  // so it must dirty the tree and never mark it verified-clean.
  {
    const cls = (argv: string[]) => classifyExecCallForGate('local.run_shell', { argv })!;
    for (const argv of [
      ['prettier', '--write', '.'], ['prettier', '-w', 'src'], ['eslint', '--fix', '.'],
      ['ruff', 'check', '--fix'], ['npm', 'run', 'clean'], ['npm', 'run', 'format'],
    ]) {
      const c = cls(argv);
      assert(c.isMutation === true && c.isVerification === false, `(16b) rewrite → mutation: ${argv.join(' ')}`, JSON.stringify(c));
    }
    for (const argv of [
      ['npm', 'test'], ['npm', 'run', 'typecheck'], ['npm', 'run', 'test'], ['tsc', '--noEmit'],
      ['prettier', '--check', '.'], ['vitest', 'run'], ['cargo', 'check'],
    ]) {
      const c = cls(argv);
      assert(c.isMutation === false && c.isVerification === true, `(16b) verify stays verify: ${argv.join(' ')}`, JSON.stringify(c));
    }
  }

  // ─── (15) degenerate / undefined never throws ─────────────────────────────
  try {
    const f15 = foldRunAndFixRound(undefined, [{ name: 'desktop.edit_file', ok: true }]);
    assertEq(f15.round, 1, '(15) fold(undefined state) starts from zeroed state');
    assertEq(f15.dirty, true, '(15) fold(undefined state) still folds the calls');
    assertEq(foldRunAndFixRound(null, undefined).round, 1, '(15) fold(null, undefined) → round 1');
    assertEq(foldRunAndFixRound('junk' as any, 'junk').round, 1, '(15) fold(junk, junk) → round 1');
    assertEq(planVerificationNudge(undefined).shouldNudge, false, '(15) planVerificationNudge(undefined) → no nudge');
    assertEq(planVerificationNudge(null).reason, 'none', '(15) planVerificationNudge(null) → none');
    assertEq(planVerificationNudge({} as any).shouldNudge, false, '(15) planVerificationNudge({}) → no nudge');
    const m15 = markNudgeSent(undefined);
    assertEq(m15.nudgesSent, 1, '(15) markNudgeSent(undefined) → nudgesSent 1');
    assertEq(m15.lastNudgeRound, 0, '(15) markNudgeSent(undefined) pins round 0');
    assertEq(markNudgeSent(null).nudgesSent, 1, '(15) markNudgeSent(null) tolerated');
    // hostile state fields normalized rather than thrown on
    const hostile = { dirty: 'yes', dirtySinceRound: NaN, nudgesSent: -3, round: 'x' } as any;
    assertEq(foldRunAndFixRound(hostile, []).round, 1, '(15) hostile state fields normalized in fold');
    assertEq(planVerificationNudge(hostile).shouldNudge, false, '(15) hostile state fields normalized in plan');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (15) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll run-and-fix-gate-core smoke cases passed (${passes} passed).`);
}

main();
