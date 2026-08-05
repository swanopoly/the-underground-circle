/**
 * git-command-policy-smoketest — the pure git-tool policy engine
 * (src/lib/gitCommandPolicy.ts) behind a coding-agent `git` bridge tool (plan P3).
 * Load-bearing assertions: READ verbs → read/auto, WRITE verbs → write/ask,
 * force-push / reset --hard / clean -f / `-c core.sshCommand=…` config injection /
 * --upload-pack exec injection / push --mirror|--delete / filter-branch / an
 * UNKNOWN verb all → blocked/never (fail-safe default-deny), a commit message
 * containing shell metachars (`"; rm -rf ~`) is SAFE (placed as its own argv
 * element after -m — argv SHAPE asserted, never interpolated), a control-char /
 * oversized arg is rejected, and every degenerate/undefined input never throws.
 *
 * Pure — loads under tsx (gitCommandPolicy has zero runtime imports).
 */

import {
  planGitCommand,
  describeGitCommand,
  MAX_GIT_ARG_LENGTH,
  MAX_GIT_ARGS,
} from '../src/lib/gitCommandPolicy';

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
  // ─── (1) READ verbs → read / auto ─────────────────────────────────────────
  for (const verb of ['status', 'diff', 'log', 'show', 'blame', 'rev-parse', 'describe', 'ls-files', 'shortlog']) {
    const p = planGitCommand({ verb });
    assert(p.ok, `(1) read verb "${verb}" is allowed`, p.reason);
    assertEq(p.classification, 'read', `(1) "${verb}" classified read`);
    assertEq(p.approvalTier, 'auto', `(1) "${verb}" tier auto`);
    assertEq(p.argv[0], verb, `(1) "${verb}" argv leads with the verb`);
  }
  // read verb carries its args through into argv (after the verb)
  const logArgs = planGitCommand({ verb: 'log', args: ['--oneline', '-n', '5'] });
  assert(logArgs.ok && logArgs.classification === 'read', '(1) log with safe args is read/ok');
  assertEq(JSON.stringify(logArgs.argv), JSON.stringify(['log', '--oneline', '-n', '5']), '(1) argv = [verb, ...args]');

  // ─── (2) WRITE verbs → write / ask ────────────────────────────────────────
  for (const verb of ['add', 'commit', 'checkout', 'switch', 'reset', 'restore', 'rm', 'mv', 'merge', 'rebase', 'stash', 'pull', 'fetch', 'cherry-pick', 'revert', 'init']) {
    const p = planGitCommand({ verb });
    assert(p.ok, `(2) write verb "${verb}" is allowed`, p.reason);
    assertEq(p.classification, 'write', `(2) "${verb}" classified write`);
    assertEq(p.approvalTier, 'ask', `(2) "${verb}" tier ask`);
  }

  // ─── (3) dual-mode verbs: branch/tag/remote read vs write ─────────────────
  const branchList = planGitCommand({ verb: 'branch' });
  assert(branchList.ok && branchList.classification === 'read' && branchList.approvalTier === 'auto', '(3) bare "branch" is read/auto (list form)');
  const branchDelete = planGitCommand({ verb: 'branch', args: ['-D', 'feature'] });
  assert(branchDelete.ok && branchDelete.classification === 'write' && branchDelete.approvalTier === 'ask', '(3) "branch -D" is write/ask');
  const branchCreate = planGitCommand({ verb: 'branch', args: ['new-feature'] });
  assert(branchCreate.ok && branchCreate.classification === 'write', '(3) "branch <name>" (create) is write');
  const tagList = planGitCommand({ verb: 'tag' });
  assert(tagList.ok && tagList.classification === 'read', '(3) bare "tag" is read (list form)');
  const tagCreate = planGitCommand({ verb: 'tag', args: ['-a', 'v1.0'] });
  assert(tagCreate.ok && tagCreate.classification === 'write', '(3) "tag -a" (annotated create) is write');
  const remoteList = planGitCommand({ verb: 'remote' });
  assert(remoteList.ok && remoteList.classification === 'read', '(3) bare "remote" is read (list form)');
  const remoteAdd = planGitCommand({ verb: 'remote', args: ['add', 'origin', 'https://example.com/r.git'] });
  assert(remoteAdd.ok && remoteAdd.classification === 'write', '(3) "remote add" is write');

  // ─── (4) force-push → blocked / never ─────────────────────────────────────
  for (const args of [['--force', 'origin', 'main'], ['-f', 'origin', 'main'], ['origin', 'main', '--force-with-lease']]) {
    const p = planGitCommand({ verb: 'push', args });
    assertEq(p.ok, false, `(4) push ${args.join(' ')} blocked`);
    assertEq(p.classification, 'blocked', `(4) push ${args.join(' ')} classification blocked`);
    assertEq(p.approvalTier, 'never', `(4) push ${args.join(' ')} tier never`);
    assertEq(p.argv.length, 0, `(4) blocked push produces no argv`);
    assert(/force/i.test(p.reason), '(4) reason mentions force', p.reason);
  }

  // ─── (5) reset --hard → blocked ───────────────────────────────────────────
  const resetHard = planGitCommand({ verb: 'reset', args: ['--hard', 'HEAD~1'] });
  assertEq(resetHard.ok, false, '(5) reset --hard blocked');
  assertEq(resetHard.classification, 'blocked', '(5) reset --hard classification blocked');
  assertEq(resetHard.approvalTier, 'never', '(5) reset --hard tier never');
  assert(/irrecoverable|hard/i.test(resetHard.reason), '(5) reason explains irrecoverable', resetHard.reason);
  // a plain reset (unstage) is still write/ask — only --hard is blocked
  const resetSoft = planGitCommand({ verb: 'reset', args: ['HEAD', 'file.ts'] });
  assert(resetSoft.ok && resetSoft.classification === 'write', '(5) plain reset (no --hard) is write/ask');

  // ─── (5b) clean -f family → blocked ───────────────────────────────────────
  for (const args of [['-f'], ['-fd'], ['-fdx'], ['--force']]) {
    const p = planGitCommand({ verb: 'clean', args });
    assertEq(p.ok, false, `(5b) clean ${args.join(' ')} blocked`);
    assertEq(p.approvalTier, 'never', `(5b) clean ${args.join(' ')} tier never`);
  }

  // ─── (6) `-c core.sshCommand=…` config injection → blocked ────────────────
  const cfgInject = planGitCommand({ verb: 'commit', args: ['-c', 'core.sshCommand=touch /tmp/pwned', '-m', 'x'] });
  assertEq(cfgInject.ok, false, '(6) -c core.sshCommand=… config injection blocked');
  assertEq(cfgInject.approvalTier, 'never', '(6) config injection tier never');
  assert(/config|-c/i.test(cfgInject.reason), '(6) reason mentions config injection', cfgInject.reason);
  // other exec-vector config keys are blocked the same way, incl. no-space -c form
  for (const arg of ['-ccore.pager=sh', '-c', '--config-env', 'core.fsmonitor=evil']) {
    const p = planGitCommand({ verb: 'status', args: [arg] });
    // note: 'core.fsmonitor=evil' alone (not after -c) is just a positional token,
    // so only the -c / --config-env forms must block; assert those specifically
    if (arg === '-ccore.pager=sh' || arg === '-c' || arg === '--config-env') {
      assertEq(p.ok, false, `(6) config-injection token "${arg}" blocked`);
      assertEq(p.approvalTier, 'never', `(6) "${arg}" tier never`);
    }
  }

  // ─── (7) --upload-pack / --receive-pack / --exec → blocked ────────────────
  for (const flag of ['--upload-pack', '--receive-pack', '--exec']) {
    const p = planGitCommand({ verb: 'fetch', args: [`${flag}=/bin/sh`, 'origin'] });
    assertEq(p.ok, false, `(7) ${flag}=… exec injection blocked`);
    assertEq(p.approvalTier, 'never', `(7) ${flag} tier never`);
    // bare form (no =value) blocked too
    const bare = planGitCommand({ verb: 'fetch', args: [flag, '/bin/sh', 'origin'] });
    assertEq(bare.ok, false, `(7) bare ${flag} exec injection blocked`);
  }

  // ─── (7b) push --mirror / --delete → blocked ──────────────────────────────
  for (const flag of ['--mirror', '--delete']) {
    const p = planGitCommand({ verb: 'push', args: [flag, 'origin', 'main'] });
    assertEq(p.ok, false, `(7b) push ${flag} blocked (remote-destructive)`);
    assertEq(p.approvalTier, 'never', `(7b) push ${flag} tier never`);
  }
  // filter-branch / filter-repo whole verbs blocked
  for (const verb of ['filter-branch', 'filter-repo']) {
    const p = planGitCommand({ verb });
    assertEq(p.ok, false, `(7b) "${verb}" blocked`);
    assertEq(p.approvalTier, 'never', `(7b) "${verb}" tier never`);
  }

  // ─── (8) unknown verb → blocked (fail-safe default-deny) ──────────────────
  for (const verb of ['frobnicate', 'daemon', 'gc', 'clone', 'push-all', 'config']) {
    const p = planGitCommand({ verb });
    assertEq(p.ok, false, `(8) unknown verb "${verb}" blocked (default-deny)`);
    assertEq(p.classification, 'blocked', `(8) "${verb}" classification blocked`);
    assertEq(p.approvalTier, 'never', `(8) "${verb}" tier never`);
  }

  // ─── (9) commit message with shell metachars is SAFE (own argv element) ───
  const evil = '"; rm -rf ~';
  const commit = planGitCommand({ verb: 'commit', args: [], message: evil });
  assert(commit.ok, '(9) commit with metachar message is ALLOWED (write/ask)', commit.reason);
  assertEq(commit.classification, 'write', '(9) commit is write');
  assertEq(commit.approvalTier, 'ask', '(9) commit is ask');
  // The load-bearing safety property: argv SHAPE — message is one isolated token
  // right after '-m', never concatenated or interpolated.
  assertEq(JSON.stringify(commit.argv), JSON.stringify(['commit', '-m', evil]), '(9) argv = [commit, -m, <verbatim message>] — metachars inert as one token');
  const mIdx = commit.argv.indexOf('-m');
  assert(mIdx >= 0 && commit.argv[mIdx + 1] === evil, '(9) message is the SOLE element after -m (not split, not merged)');
  // a message with quotes/backticks/newlines is likewise a single safe token
  const multiline = planGitCommand({ verb: 'commit', message: 'title\n\nbody with `backticks` and $VARS and \'quotes\'' });
  assert(multiline.ok && multiline.argv[multiline.argv.indexOf('-m') + 1].includes('`backticks`'), '(9) multi-line/quoted commit body preserved verbatim as one argv token');
  // message on a non-commit verb is ignored (not injected as -m), with a note
  const stashMsg = planGitCommand({ verb: 'status', message: 'ignored' });
  assert(stashMsg.ok && !stashMsg.argv.includes('-m'), '(9) message ignored on non-commit verb (no stray -m)');

  // ─── (10) control-char / oversized / non-string args rejected ─────────────
  const nul = planGitCommand({ verb: 'add', args: ['file\x00.ts'] });
  assertEq(nul.ok, false, '(10) NUL in arg rejected');
  assert(/control/i.test(nul.reason), '(10) reason says control character', nul.reason);
  const newline = planGitCommand({ verb: 'add', args: ['a\nb'] });
  assertEq(newline.ok, false, '(10) newline in arg rejected');
  const oversized = planGitCommand({ verb: 'add', args: ['x'.repeat(MAX_GIT_ARG_LENGTH + 1)] });
  assertEq(oversized.ok, false, '(10) oversized arg rejected');
  const nonString = planGitCommand({ verb: 'add', args: [123 as unknown as string] });
  assertEq(nonString.ok, false, '(10) non-string arg rejected');
  const tooMany = planGitCommand({ verb: 'add', args: Array.from({ length: MAX_GIT_ARGS + 1 }, () => 'x') });
  assertEq(tooMany.ok, false, '(10) too-many args rejected');
  // a NUL inside the commit MESSAGE is fatal (breaks the argv boundary) even
  // though other control chars in a message are allowed
  const nulMsg = planGitCommand({ verb: 'commit', message: 'bad\x00msg' });
  assertEq(nulMsg.ok, false, '(10) NUL in commit message rejected');
  // verb that is itself a flag / config-injection is rejected as an invalid verb
  assertEq(planGitCommand({ verb: '-c' }).ok, false, '(10) verb "-c" rejected (not a valid subcommand)');
  assertEq(planGitCommand({ verb: '--upload-pack' }).ok, false, '(10) verb "--upload-pack" rejected');

  // ─── (11) describe + degenerate never-throws ──────────────────────────────
  assert(describeGitCommand({ verb: 'status' }).toLowerCase().includes('status'), '(11) describe names the verb');
  assert(/blocked/i.test(describeGitCommand({ verb: 'push', args: ['--force'] })), '(11) describe of a blocked command says blocked');
  assert(describeGitCommand({ verb: 'commit', message: evil }).includes('git commit'), '(11) describe of commit shows the command');
  try {
    planGitCommand(undefined as unknown as object);
    planGitCommand(null as unknown as object);
    planGitCommand({} as object);
    planGitCommand({ verb: 123 } as unknown as object);
    planGitCommand({ verb: 'commit', args: 'not-an-array' } as unknown as object);
    planGitCommand({ verb: 'commit', message: 42 } as unknown as object);
    planGitCommand('a string' as unknown as object);
    describeGitCommand(undefined as unknown as object);
    describeGitCommand(null as unknown as object);
    describeGitCommand({} as object);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (11) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll git-command-policy smoke cases passed (${passes} passed).`);
}

main();
