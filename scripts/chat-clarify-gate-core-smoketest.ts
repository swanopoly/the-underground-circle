/**
 * chat-clarify-gate-core-smoketest — the pure, high-precision "ask ONE good
 * question or just proceed" gate for SwanBot (src/lib/chatClarifyGateCore.ts).
 *
 * The load-bearing property is PRECISION: over-asking is worse than the
 * problem, so the OVERWHELMING majority of real messages must return
 * shouldClarify:false. The biggest group below is a realistic benign mix
 * (questions, summaries, greetings, well-specified creates, code help, and
 * action verbs that already carry a concrete target) that must ALL proceed.
 * A second group is the narrow, genuinely-ambiguous action/build slice
 * ("delete them", "send it", "deploy", "update the post") that must clarify
 * with a one-sentence question and 2–CLARIFY_MAX_OPTIONS tappable options.
 * Context (thread/attachment) and headless modes force proceed. A degenerate
 * group asserts every export is total (null/undefined/{}/number/huge → no
 * throw, neutral value). isDestructiveActionPhrase is checked both ways.
 *
 * Pure — loads under tsx (chatClarifyGateCore has zero imports).
 */

import {
  decideChatClarify,
  isDestructiveActionPhrase,
  CLARIFY_MAX_OPTIONS,
  MAX_CLARIFY_CONTENT_WORDS,
  type ClarifyDecision,
  type ClarifyOptions,
} from '../src/lib/chatClarifyGateCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** A returned decision is always well-shaped and bounded. */
function assertShape(d: ClarifyDecision, label: string): void {
  assert(!!d && typeof d === 'object', `${label} — is object`);
  assertEq(typeof d.shouldClarify, 'boolean', `${label} — shouldClarify boolean`);
  assertEq(typeof d.question, 'string', `${label} — question string`);
  assert(Array.isArray(d.options), `${label} — options array`);
  assertEq(typeof d.reason, 'string', `${label} — reason string`);
  assert(d.options.length <= CLARIFY_MAX_OPTIONS, `${label} — options bounded`);
  assert(d.question.length <= 200, `${label} — question bounded`);
  for (const opt of d.options) {
    assert(typeof opt === 'string' && opt.length > 0 && opt.length <= 60, `${label} — option non-empty & bounded`);
  }
}

/** Assert a message PROCEEDS (the precision-guard workhorse). */
function assertProceed(input: string, label: string, opts?: ClarifyOptions): void {
  const d = decideChatClarify(input, opts);
  assertShape(d, label);
  assertEq(d.shouldClarify, false, `${label} — proceeds`);
  assertEq(d.question, '', `${label} — no question`);
  assertEq(d.options.length, 0, `${label} — no options`);
}

/** Assert a message CLARIFIES with a well-formed single question. */
function assertClarify(input: string, label: string, opts?: ClarifyOptions): ClarifyDecision {
  const d = decideChatClarify(input, opts);
  assertShape(d, label);
  assertEq(d.shouldClarify, true, `${label} — clarifies`);
  assert(d.question.length > 0 && d.question.endsWith('?'), `${label} — one question ending in '?'`);
  assert(!d.question.includes('. '), `${label} — single sentence (no '. ')`);
  assert(d.options.length >= 2 && d.options.length <= CLARIFY_MAX_OPTIONS, `${label} — 2..MAX options`);
  assert(d.reason.length > 0, `${label} — has reason`);
  return d;
}

function main(): void {
  // ─── (1) benign — questions / info requests ALL proceed ───────────────────
  assertProceed("what's the weather", '(1) weather question');
  assertProceed('how do I sort an array in JavaScript', '(1) how-to question');
  assertProceed('why is the build failing', '(1) why question');
  assertProceed('who owns the deploy key', '(1) who question');
  assertProceed('which model is faster', '(1) which question');
  assertProceed('when does staging reset', '(1) when question');
  assertProceed('is the server up', '(1) is question');
  assertProceed('can you explain how promises work', '(1) can-you explain question');
  assertProceed('should I use tabs or spaces', '(1) should question');
  assertProceed('what do you think of this plan', '(1) opinion question');

  // ─── (2) benign — safe reads / summaries / greetings / chit-chat proceed ──
  assertProceed('summarize this', '(2) summarize this');
  assertProceed('summarize the thread for me', '(2) summarize thread');
  assertProceed('tldr', '(2) tldr');
  assertProceed('explain the error', '(2) explain error');
  assertProceed('translate this to French', '(2) translate');
  assertProceed('describe the architecture', '(2) describe');
  assertProceed('hi', '(2) hi');
  assertProceed('hey', '(2) hey');
  assertProceed('hello there', '(2) hello there');
  assertProceed('thanks!', '(2) thanks');
  assertProceed('ok', '(2) ok');
  assertProceed('sounds good', '(2) sounds good');

  // ─── (3) benign — well-specified build/create requests proceed ────────────
  assertProceed('create a landing page for a coffee shop', '(3) coffee shop landing page');
  assertProceed('help me write a function to sort an array', '(3) sort function help');
  assertProceed('build a login form with email and password', '(3) login form');
  assertProceed('create a website', '(3) create a website (subject present)');
  assertProceed('make a to-do app in React', '(3) to-do app');
  assertProceed('write a haiku about the ocean', '(3) haiku');
  assertProceed('design a logo for a bakery', '(3) bakery logo');
  assertProceed('build the checkout flow', '(3) build the checkout flow');
  assertProceed('generate a color palette', '(3) generate palette');

  // ─── (4) benign — ACTION verbs that already carry a target proceed ────────
  assertProceed('deploy to staging', '(4) deploy to staging (env named)');
  assertProceed('deploy the app to production', '(4) deploy to production');
  assertProceed('delete the old logs', '(4) delete the old logs');
  assertProceed('delete the temp branch', '(4) delete the temp branch');
  assertProceed('send the Q3 report to the finance team', '(4) send Q3 report');
  assertProceed('publish the blog post about our launch', '(4) publish blog post');
  assertProceed('merge PR #42', '(4) merge PR #42 (digit + mention)');
  assertProceed('email john@example.com the invoice', '(4) email a named address');
  assertProceed('move the file to Archive', '(4) move file to Archive');
  assertProceed('update the homepage hero to say Summer Sale', '(4) update hero with change');
  assertProceed('pay the $50 invoice', '(4) pay $50 invoice (money)');
  assertProceed('reset the password for the test account', '(4) reset named password');
  assertProceed('remove the unused imports in App.tsx', '(4) remove imports in file');
  assertProceed('rename the branch to release-v5', '(4) rename to named branch');

  // ─── (5) narrow ambiguous ACTION slice — these clarify ────────────────────
  const dDelete = assertClarify('delete them', '(5) delete them');
  assertEq(dDelete.reason, 'destructive-target-missing', '(5) delete them reason');
  const dSend = assertClarify('send it', '(5) send it');
  assertEq(dSend.reason, 'send-recipient-missing', '(5) send it reason');
  const dDeploy = assertClarify('deploy', '(5) bare deploy');
  assertEq(dDeploy.reason, 'deploy-env-missing', '(5) deploy reason');
  assert(dDeploy.options.indexOf('Production') !== -1, '(5) deploy offers Production');
  assertEq(dDeploy.options.length, CLARIFY_MAX_OPTIONS, '(5) deploy uses all 4 options');
  const dEdit = assertClarify('update the post', '(5) update the post');
  assertEq(dEdit.reason, 'edit-target-or-change-missing', '(5) update the post reason');
  assertClarify('publish it', '(5) publish it');
  assertClarify('merge', '(5) bare merge');
  assertClarify('pay them', '(5) pay them');
  assertClarify('move it', '(5) move it');
  assertClarify('delete', '(5) bare delete');
  assertClarify('remove those', '(5) remove those');
  assertClarify('reset it', '(5) reset it');
  assertClarify('change the settings', '(5) change the settings');
  assertClarify('overwrite it', '(5) overwrite it');
  assertClarify('wipe everything', '(5) wipe everything');
  assertClarify('please just delete all of them', '(5) verbose dangling delete still clarifies');
  assertClarify('can you send it', '(5) polite send it still clarifies');
  assertClarify('build it', '(5) bare build it');
  assertClarify('make that', '(5) make that');

  // ─── (6) context / opts gating forces proceed ─────────────────────────────
  assertProceed('delete them', '(6) delete them + thread context', { hasActiveThreadContext: true });
  assertProceed('send it', '(6) send it + thread context', { hasActiveThreadContext: true });
  assertProceed('delete these', '(6) delete these + attachment', { hasAttachment: true });
  assertProceed('deploy', '(6) deploy + headless mode', { mode: 'auto' });
  assertProceed('delete them', '(6) delete them + background mode', { mode: 'background' });
  // …but an interactive mode does NOT suppress the clarify:
  assertClarify('delete them', '(6) delete them + chat mode still clarifies', { mode: 'chat' });
  assertProceed('summarize this', '(6) summarize + attachment', { hasAttachment: true });

  // ─── (7) isDestructiveActionPhrase — true on leading destructive verbs ─────
  assert(isDestructiveActionPhrase('delete the logs') === true, '(7) delete → true');
  assert(isDestructiveActionPhrase('remove them') === true, '(7) remove → true');
  assert(isDestructiveActionPhrase('drop the table') === true, '(7) drop → true');
  assert(isDestructiveActionPhrase('send it') === true, '(7) send → true');
  assert(isDestructiveActionPhrase('publish it') === true, '(7) publish → true');
  assert(isDestructiveActionPhrase('deploy now') === true, '(7) deploy → true');
  assert(isDestructiveActionPhrase('pay them') === true, '(7) pay → true');
  assert(isDestructiveActionPhrase('overwrite the file') === true, '(7) overwrite → true');
  assert(isDestructiveActionPhrase('wipe the disk') === true, '(7) wipe → true');
  assert(isDestructiveActionPhrase('merge the branch') === true, '(7) merge → true');
  assert(isDestructiveActionPhrase('reset it') === true, '(7) reset → true');
  assert(isDestructiveActionPhrase('please delete it') === true, '(7) courtesy prefix stripped → true');
  assert(isDestructiveActionPhrase('can you send it') === true, '(7) can-you send → true');
  // …and false on non-actions / questions / builds:
  assert(isDestructiveActionPhrase("what's the weather") === false, '(7) weather → false');
  assert(isDestructiveActionPhrase('summarize this') === false, '(7) summarize → false');
  assert(isDestructiveActionPhrase('how do I delete a branch') === false, '(7) how-to delete question → false');
  assert(isDestructiveActionPhrase('create a landing page') === false, '(7) create → false');
  assert(isDestructiveActionPhrase('hello') === false, '(7) greeting → false');
  assert(isDestructiveActionPhrase('explain the deploy process') === false, '(7) explain → false');

  // ─── (8) structural / bounds invariants ───────────────────────────────────
  assertEq(CLARIFY_MAX_OPTIONS, 4, '(8) CLARIFY_MAX_OPTIONS is 4');
  assertEq(MAX_CLARIFY_CONTENT_WORDS, 4, '(8) MAX_CLARIFY_CONTENT_WORDS is 4');
  assert(typeof isDestructiveActionPhrase === 'function', '(8) helper is a function');
  const proceedD = decideChatClarify('what is the weather');
  assertEq(proceedD.options.length, 0, '(8) proceed has empty options');
  assertEq(proceedD.question, '', '(8) proceed has empty question');
  // returned decisions are fresh objects — mutating one cannot poison the next:
  const m1 = decideChatClarify('delete them');
  m1.options.push('POISON');
  (m1 as { shouldClarify: boolean }).shouldClarify = false;
  const m2 = decideChatClarify('delete them');
  assertEq(m2.shouldClarify, true, '(8) later call unaffected by earlier mutation (shouldClarify)');
  assert(m2.options.indexOf('POISON') === -1, '(8) later call unaffected by earlier mutation (options)');

  // ─── (9) degenerate inputs never throw (totality) ─────────────────────────
  try {
    const junk: unknown[] = [
      null, undefined, 0, 42, 3.14, NaN, Infinity, true, false, {}, [],
      ['delete them'], { message: 'delete them' }, () => 'delete them',
      Symbol('x'), 10n as unknown,
    ];
    for (const j of junk) {
      const d = decideChatClarify(j);
      assertShape(d, `(9) decide(${String(typeof j)})`);
      assertEq(d.shouldClarify, false, `(9) decide(${String(typeof j)}) → proceed`);
      assertEq(isDestructiveActionPhrase(j), false, `(9) helper(${String(typeof j)}) → false`);
    }
    // opts may be hostile too:
    assertEq(decideChatClarify('delete them', null as unknown as ClarifyOptions).shouldClarify, true, '(9) null opts tolerated');
    assertEq(decideChatClarify('delete them', 42 as unknown as ClarifyOptions).shouldClarify, true, '(9) number opts tolerated');
    assertEq(decideChatClarify('delete them', { mode: 123 } as unknown as ClarifyOptions).shouldClarify, true, '(9) non-string mode tolerated');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (9) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  // ─── (10) huge / adversarial input stays bounded and safe ─────────────────
  try {
    const huge = decideChatClarify('a'.repeat(100000));
    assertEq(huge.shouldClarify, false, '(10) 100k benign chars → proceed');
    const hugeDelete = decideChatClarify(`delete ${'x'.repeat(100000)}`);
    assertEq(hugeDelete.shouldClarify, false, '(10) delete <huge substantive object> → proceed');
    const hugeDangling = decideChatClarify(`please ${'  '.repeat(20)} delete them`);
    assertEq(hugeDangling.shouldClarify, true, '(10) padded dangling delete still clarifies');
    assertShape(hugeDelete, '(10) huge decision shape');
    // empty / whitespace proceed with neutral reason
    assertEq(decideChatClarify('').shouldClarify, false, '(10) empty string → proceed');
    assertEq(decideChatClarify('     ').shouldClarify, false, '(10) whitespace → proceed');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) huge inputs threw: ${(e as Error)?.message}`);
  }

  // ─── (11) precision census — a realistic mix must mostly proceed ──────────
  const realisticMix: string[] = [
    "what's the weather", 'how do I sort an array in JavaScript', 'why is the build failing',
    'summarize this', 'summarize the thread', 'translate this to French', 'explain the error',
    'hi', 'hey', 'hello there', 'thanks!', 'ok', 'sounds good', 'tldr',
    'create a landing page for a coffee shop', 'help me write a function to sort an array',
    'build a login form with email and password', 'make a to-do app in React',
    'write a haiku about the ocean', 'design a logo for a bakery',
    'deploy to staging', 'delete the old logs', 'send the Q3 report to the finance team',
    'publish the blog post about our launch', 'merge PR #42', 'move the file to Archive',
    'update the homepage hero to say Summer Sale', 'pay the $50 invoice',
    'reset the password for the test account', 'rename the branch to release-v5',
    'add a dark mode toggle to settings', 'refactor the auth module',
    'fix the failing test in agentCore', 'review this pull request',
    // the genuinely-ambiguous minority:
    'delete them', 'send it', 'deploy', 'update the post',
  ];
  let clarified = 0;
  for (const m of realisticMix) {
    if (decideChatClarify(m).shouldClarify) clarified += 1;
  }
  // Only the 4 truly-ambiguous ones should clarify → well under ~15% of the mix.
  assertEq(clarified, 4, '(11) exactly the 4 ambiguous messages clarify');
  assert(clarified / realisticMix.length < 0.15, '(11) gate clarifies <15% of a realistic mix (conservative)');

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chatClarifyGateCore smoke cases passed (${passes} passed).`);
}

main();
