/**
 * memory-intent-core-smoketest — the pure chat memory intent detector +
 * slash-command parser (src/lib/memoryIntentCore.ts) that fixes two live
 * findings: (a) natural-language memory phrases ("note that…", "remember
 * that…", "keep in mind…", "forget that…") never actually saved — the
 * swanbot.ts memory directive tells the model to reply "Saved." without a
 * write — and (b) bare `/remember` / `/forget` fell through to the LLM
 * because ChatTab matched `startsWith('/remember ')`. Load-bearing pins:
 *
 *   DETECT (detectMemoryIntent): every explicit remember lead (remember
 *   that/to, note that, keep in mind, don't forget, make a note, save this)
 *   and forget lead (forget that, don't remember, delete that memory) maps to
 *   the right kind with confidence 'explicit' and the lead phrase stripped
 *   from content; weaker start-anchored shapes (bare remember X, add/save X
 *   to memory, note to self, bare forget X, delete memories about X) are
 *   'implicit'; recall questions ('?'-ending, "remember when…", "what do you
 *   remember…"), non-anchored mentions, idioms ("forget it"), slash input,
 *   and app-artifact saves ("save this file…", "make a note that says…") are
 *   'none'. Courtesy prefixes ("please", "hey swanbot, can you") strip;
 *   matching is case-insensitive with content case preserved; content is
 *   quote-unwrapped, edge-punctuation-trimmed, and capped at
 *   MAX_MEMORY_INTENT_CONTENT_CHARS with a trailing '…'.
 *
 *   COMMANDS (parseMemoryCommand): '/remember X' → remember, '/forget X' →
 *   forget (case-insensitive command, content case preserved), bare or
 *   punctuation-only args → help with empty content, non-slash / other
 *   commands ('/rememberme', '/memories') / non-strings → null.
 *
 *   And: every export is total — degenerate/huge input never throws.
 *
 * Pure — loads under tsx (memoryIntentCore has zero imports).
 */

import {
  detectMemoryIntent,
  parseMemoryCommand,
  MEMORY_COMMAND_USAGE,
  MAX_MEMORY_INTENT_CONTENT_CHARS,
  MAX_MEMORY_INTENT_INPUT_CHARS,
  type MemoryIntent,
} from '../src/lib/memoryIntentCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** Helper: assert the full intent triple in one readable call. */
function assertIntent(input: string, want: MemoryIntent, label: string): void {
  const got = detectMemoryIntent(input);
  assertEq(got.kind, want.kind, `${label} — kind`);
  assertEq(got.content, want.content, `${label} — content`);
  assertEq(got.confidence, want.confidence, `${label} — confidence`);
}

function main(): void {
  // ─── (1) explicit remember leads ──────────────────────────────────────────
  assertIntent('remember that I deploy on Fridays', { kind: 'remember', content: 'I deploy on Fridays', confidence: 'explicit' }, '(1) remember that');
  assertIntent('Remember to run the smoke tests', { kind: 'remember', content: 'run the smoke tests', confidence: 'explicit' }, '(1) remember to');
  assertIntent('note that the staging DB resets nightly', { kind: 'remember', content: 'the staging DB resets nightly', confidence: 'explicit' }, '(1) note that');
  assertIntent('keep in mind that Chris prefers npm', { kind: 'remember', content: 'Chris prefers npm', confidence: 'explicit' }, '(1) keep in mind that');
  assertIntent('keep in mind the bridge runs on port 7778', { kind: 'remember', content: 'the bridge runs on port 7778', confidence: 'explicit' }, '(1) keep in mind (no that)');
  assertIntent("don't forget the standup moved to 9am", { kind: 'remember', content: 'the standup moved to 9am', confidence: 'explicit' }, "(1) don't forget");
  assertIntent("Don't forget to update the changelog", { kind: 'remember', content: 'update the changelog', confidence: 'explicit' }, "(1) don't forget to");
  assertIntent('do not forget that the demo is Tuesday', { kind: 'remember', content: 'the demo is Tuesday', confidence: 'explicit' }, '(1) do not forget that');
  assertIntent('make a note that the client wants dark mode', { kind: 'remember', content: 'the client wants dark mode', confidence: 'explicit' }, '(1) make a note that');
  assertIntent('make a note: invoice #42 is unpaid', { kind: 'remember', content: 'invoice #42 is unpaid', confidence: 'explicit' }, '(1) make a note:');
  assertIntent('save this: the deploy checklist lives in docs/DEPLOY.md', { kind: 'remember', content: 'the deploy checklist lives in docs/DEPLOY.md', confidence: 'explicit' }, '(1) save this:');
  assertIntent('save this to memory: retro is every second Friday', { kind: 'remember', content: 'retro is every second Friday', confidence: 'explicit' }, '(1) save this to memory');
  assertIntent('remember that', { kind: 'remember', content: '', confidence: 'explicit' }, '(1) bare "remember that" keeps explicit kind with empty content');

  // ─── (2) explicit forget leads ────────────────────────────────────────────
  assertIntent('forget that I said the demo was Friday', { kind: 'forget', content: 'I said the demo was Friday', confidence: 'explicit' }, '(2) forget that');
  assertIntent('Forget that.', { kind: 'forget', content: '', confidence: 'explicit' }, '(2) bare "forget that." → empty content');
  assertIntent("don't remember my old address", { kind: 'forget', content: 'my old address', confidence: 'explicit' }, "(2) don't remember");
  assertIntent('do not remember that I use yarn', { kind: 'forget', content: 'I use yarn', confidence: 'explicit' }, '(2) do not remember that');
  assertIntent('delete that memory', { kind: 'forget', content: '', confidence: 'explicit' }, '(2) delete that memory (bare)');
  assertIntent('delete that memory about the old repo', { kind: 'forget', content: 'the old repo', confidence: 'explicit' }, '(2) delete that memory about');

  // ─── (3) implicit remember shapes ─────────────────────────────────────────
  assertIntent('remember my birthday is June 1', { kind: 'remember', content: 'my birthday is June 1', confidence: 'implicit' }, '(3) bare remember X');
  assertIntent('add to memory: standup is async on Fridays', { kind: 'remember', content: 'standup is async on Fridays', confidence: 'implicit' }, '(3) add to memory:');
  assertIntent('save my timezone preference to memory', { kind: 'remember', content: 'my timezone preference', confidence: 'implicit' }, '(3) save X to memory');
  assertIntent('put this in your memory: chris owns the deploy key', { kind: 'remember', content: 'chris owns the deploy key', confidence: 'implicit' }, '(3) put this in your memory');
  assertIntent('store the wifi name in memory', { kind: 'remember', content: 'the wifi name', confidence: 'implicit' }, '(3) store X in memory');
  assertIntent('note to self: renew the cert before August', { kind: 'remember', content: 'renew the cert before August', confidence: 'implicit' }, '(3) note to self');

  // ─── (4) implicit forget shapes ───────────────────────────────────────────
  assertIntent('forget my old address', { kind: 'forget', content: 'my old address', confidence: 'implicit' }, '(4) bare forget X');
  assertIntent('forget about the sprint plan', { kind: 'forget', content: 'the sprint plan', confidence: 'implicit' }, '(4) forget about X');
  assertIntent('delete the memory about my address', { kind: 'forget', content: 'my address', confidence: 'implicit' }, '(4) delete the memory about');
  assertIntent('clear all memories about the old client', { kind: 'forget', content: 'the old client', confidence: 'implicit' }, '(4) clear all memories about');
  assertIntent('remove my address from memory', { kind: 'forget', content: 'my address', confidence: 'implicit' }, '(4) remove X from memory');
  assertIntent('forget everything you know about the migration', { kind: 'forget', content: 'everything you know about the migration', confidence: 'implicit' }, '(4) forget everything about X stays implicit (caller gates mass deletes)');

  // ─── (5) none — recall questions, idioms, non-anchored, app artifacts ─────
  const none: MemoryIntent = { kind: 'none', content: '', confidence: 'implicit' };
  assertIntent('what do you remember about me', none, '(5) recall question (what do you remember)');
  assertIntent('do you remember when we shipped v1?', none, '(5) do you remember …?');
  assertIntent('remember when we went to the lake?', none, '(5) nostalgia ?-ending');
  assertIntent('remember when we went to the lake', none, '(5) nostalgia without ? (interrogative rest)');
  assertIntent('remember me', none, '(5) "remember me" is not a save');
  assertIntent('I forget what that error was', none, '(5) non-anchored "I forget…" statement');
  assertIntent('forget it', none, '(5) "forget it" idiom');
  assertIntent('forget about it', none, '(5) "forget about it" idiom');
  assertIntent('can you remember what I said yesterday', none, '(5) recall via courtesy prefix stays none');
  assertIntent("let's ship the connected resources digest today", none, '(5) plain chat');
  assertIntent('/remember I use npm', none, '(5) slash input is not a conversational intent');
  assertIntent('save this file to my desktop', none, '(5) save-this artifact (file) → app action, not memory');
  assertIntent('make a note that says hello world', none, '(5) "make a note that says…" → app note, not memory');
  assertIntent('make a note in Notes about groceries', none, '(5) "make a note in <app>" → app note, not memory');
  assertIntent('', none, '(5) empty string');
  assertIntent('   ', none, '(5) whitespace-only');

  // ─── (6) courtesy prefixes, case, whitespace, punctuation ─────────────────
  assertIntent('Please remember that I like short PRs', { kind: 'remember', content: 'I like short PRs', confidence: 'explicit' }, '(6) please prefix');
  assertIntent('  hey swanbot, can you remember that the retro moved to Thursday  ', { kind: 'remember', content: 'the retro moved to Thursday', confidence: 'explicit' }, '(6) stacked courtesy prefixes + edge whitespace');
  assertIntent('PLEASE NOTE THAT THE DEMO IS AT NOON!!', { kind: 'remember', content: 'THE DEMO IS AT NOON', confidence: 'explicit' }, '(6) uppercase lead matches; content case preserved; trailing !! stripped');
  assertIntent("ok, don't forget that invoices go out on the 1st.", { kind: 'remember', content: 'invoices go out on the 1st', confidence: 'explicit' }, '(6) ok, prefix + trailing period stripped');
  assertIntent('remember that "always run typecheck before commit"', { kind: 'remember', content: 'always run typecheck before commit', confidence: 'explicit' }, '(6) wrapping quotes stripped');
  assertIntent('— note that the feed loop closed', { kind: 'remember', content: 'the feed loop closed', confidence: 'explicit' }, '(6) leading dash noise stripped');

  // ─── (7) bounding — huge content truncates, huge garbage stays none ───────
  const over = detectMemoryIntent(`remember that ${'a'.repeat(600)}`);
  assertEq(over.kind, 'remember', '(7) overlong content still detected');
  assertEq(over.content.length, MAX_MEMORY_INTENT_CONTENT_CHARS, '(7) content capped at MAX_MEMORY_INTENT_CONTENT_CHARS');
  assert(over.content.endsWith('…'), '(7) capped content ends with ellipsis');
  const exact = detectMemoryIntent(`remember that ${'b'.repeat(MAX_MEMORY_INTENT_CONTENT_CHARS)}`);
  assertEq(exact.content.length, MAX_MEMORY_INTENT_CONTENT_CHARS, '(7) content exactly at cap kept whole');
  assert(!exact.content.endsWith('…'), '(7) at-cap content is not truncated');
  const huge = detectMemoryIntent(`remember that ${'c'.repeat(100000)}`);
  assertEq(huge.kind, 'remember', '(7) 100k-char message still detected (input scan bounded)');
  assert(huge.content.length <= MAX_MEMORY_INTENT_CONTENT_CHARS, '(7) huge input content stays bounded');
  assertEq(detectMemoryIntent('z'.repeat(MAX_MEMORY_INTENT_INPUT_CHARS * 3)).kind, 'none', '(7) huge non-matching input → none');

  // ─── (8) parseMemoryCommand — slash grammar ───────────────────────────────
  const c1 = parseMemoryCommand('/remember I deploy on Fridays');
  assertEq(c1?.action, 'remember', '(8) /remember X → remember');
  assertEq(c1?.content, 'I deploy on Fridays', '(8) /remember content preserved');
  const c2 = parseMemoryCommand('/forget deploy schedule');
  assertEq(c2?.action, 'forget', '(8) /forget X → forget');
  assertEq(c2?.content, 'deploy schedule', '(8) /forget content preserved');
  const c3 = parseMemoryCommand('/REMEMBER Chris Uses Tabs');
  assertEq(c3?.action, 'remember', '(8) command is case-insensitive');
  assertEq(c3?.content, 'Chris Uses Tabs', '(8) content case preserved');
  const c4 = parseMemoryCommand('  /remember   spaced   out  ');
  assertEq(c4?.action, 'remember', '(8) leading whitespace tolerated');
  assertEq(c4?.content, 'spaced out', '(8) internal whitespace collapsed');
  assertEq(parseMemoryCommand('/remember')?.action, 'help', '(8) bare /remember → help');
  assertEq(parseMemoryCommand('/remember')?.content, '', '(8) bare /remember → empty content');
  assertEq(parseMemoryCommand('/forget')?.action, 'help', '(8) bare /forget → help');
  assertEq(parseMemoryCommand('/forget   ')?.action, 'help', '(8) /forget + trailing spaces → help');
  assertEq(parseMemoryCommand('/remember ...')?.action, 'help', '(8) punctuation-only args → help');
  const c5 = parseMemoryCommand('/remember: use npm');
  assertEq(c5?.action, 'remember', '(8) /remember: tolerated');
  assertEq(c5?.content, 'use npm', '(8) /remember: content extracted');
  assertEq(parseMemoryCommand('/forget "billing"')?.content, 'billing', '(8) wrapping quotes stripped from command content');
  assertEq(parseMemoryCommand('/ForGeT   That Thing')?.action, 'forget', '(8) mixed-case /forget');
  assertEq(parseMemoryCommand('/rememberme x'), null, '(8) /rememberme is not our command');
  assertEq(parseMemoryCommand('/memories'), null, '(8) /memories is not ours');
  assertEq(parseMemoryCommand('remember x'), null, '(8) non-slash → null');
  assertEq(parseMemoryCommand(''), null, '(8) empty string → null');
  const c6 = parseMemoryCommand(`/remember ${'d'.repeat(9000)}`);
  assertEq(c6?.action, 'remember', '(8) huge command still parses');
  assert((c6?.content.length ?? 0) <= MAX_MEMORY_INTENT_CONTENT_CHARS, '(8) huge command content bounded');
  assert(!!c6?.content.endsWith('…'), '(8) huge command content truncated with ellipsis');

  // ─── (9) MEMORY_COMMAND_USAGE ─────────────────────────────────────────────
  assert(typeof MEMORY_COMMAND_USAGE === 'string' && MEMORY_COMMAND_USAGE.length > 0, '(9) usage is a non-empty string');
  assert(MEMORY_COMMAND_USAGE.includes('/remember'), '(9) usage mentions /remember');
  assert(MEMORY_COMMAND_USAGE.includes('/forget'), '(9) usage mentions /forget');
  assert(MEMORY_COMMAND_USAGE.length < 600, '(9) usage stays bounded');

  // ─── (10) degenerate inputs never throw ───────────────────────────────────
  try {
    const junk: unknown[] = [null, undefined, 42, 3.14, NaN, true, false, {}, [], ['remember that x'], { message: 'remember that x' }, () => 'remember that x', Symbol('x'), 10n as unknown];
    for (const j of junk) {
      const d = detectMemoryIntent(j);
      assertEq(d.kind, 'none', `(10) detect(${String(typeof j)}) → none`);
      assertEq(d.content, '', `(10) detect(${String(typeof j)}) → empty content`);
      assertEq(parseMemoryCommand(j), null, `(10) parse(${String(typeof j)}) → null`);
    }
    // none contract is the exact neutral triple
    const n = detectMemoryIntent(undefined);
    assertEq(n.confidence, 'implicit', '(10) none confidence is implicit');
    // returned objects are fresh (mutating one result cannot poison the next)
    const m1 = detectMemoryIntent('plain chat');
    (m1 as { kind: string }).kind = 'remember';
    assertEq(detectMemoryIntent('plain chat').kind, 'none', '(10) results are fresh objects per call');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll memory-intent-core smoke cases passed (${passes} passed).`);
}

main();
