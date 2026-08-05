/**
 * chat-send-guard-core-smoketest — the pure pre-send input guard for SwanBot
 * chat (src/lib/chatSendGuardCore.ts).
 *
 * The load-bearing property is BIAS-TO-SEND: 'block' is reserved for the one
 * genuinely-empty case, 'confirm' is a helpful nudge (never a wall) for a HUGE
 * paste or a pasted stack trace, and everything else — including empty text
 * with an attachment — must 'send'. The biggest groups below are (a) a
 * realistic benign mix that must ALL send, and (b) prose that merely MENTIONS
 * errors, which must NOT be mistaken for a dump (precision). A second cluster
 * pins the real behaviours: block-on-empty, confirm-on-huge, confirm-on-dump
 * across JS/Python/Java/Go/Node shapes, and error-beats-huge precedence. A
 * degenerate group asserts every export is total (null/undefined/{}/number/
 * huge/hostile → no throw, neutral 'send'/false).
 *
 * Pure — loads under tsx (chatSendGuardCore has zero imports).
 */

import {
  guardChatSend,
  looksLikeErrorDump,
  HUGE_PASTE_THRESHOLD,
  MAX_REASONABLE_MESSAGE,
  type SendGuardVerdict,
  type SendGuardOptions,
  type SendGuardAction,
} from '../src/lib/chatSendGuardCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const VALID_ACTIONS: SendGuardAction[] = ['send', 'block', 'confirm'];

/** A verdict is always well-shaped and bounded. */
function assertShape(v: SendGuardVerdict, label: string): void {
  assert(!!v && typeof v === 'object', `${label} — is object`);
  assert(VALID_ACTIONS.indexOf(v.action) !== -1, `${label} — action in enum`, String(v.action));
  assertEq(typeof v.reason, 'string', `${label} — reason string`);
  assertEq(typeof v.hint, 'string', `${label} — hint string`);
  assert(v.reason.length > 0 && v.reason.length <= 40, `${label} — reason bounded`);
  assert(v.hint.length <= 200, `${label} — hint bounded`);
  // A plain 'send' carries no user-facing text; block/confirm always do.
  if (v.action === 'send') assertEq(v.hint, '', `${label} — send has empty hint`);
  else assert(v.hint.length > 0, `${label} — non-send has a hint`);
}

function assertAction(input: unknown, want: SendGuardAction, label: string, opts?: SendGuardOptions): SendGuardVerdict {
  const v = guardChatSend(input, opts);
  assertShape(v, label);
  assertEq(v.action, want, `${label} — action`);
  return v;
}

// A compact, realistic JS stack trace (multi-line, 2+ frames).
const JS_STACK = [
  "TypeError: Cannot read properties of undefined (reading 'name')",
  '    at Object.<anonymous> (/app/src/index.js:10:15)',
  '    at Module._compile (node:internal/modules/cjs/loader:1254:14)',
  '    at Module._extensions..js (node:internal/modules/cjs/loader:1308:10)',
].join('\n');

const PY_TRACEBACK = [
  'Traceback (most recent call last):',
  '  File "app.py", line 4, in <module>',
  '    print(foo)',
  "NameError: name 'foo' is not defined",
].join('\n');

const JAVA_STACK = [
  'Exception in thread "main" java.lang.NullPointerException',
  '\tat com.example.Main.doStuff(Main.java:15)',
  '\tat com.example.Main.main(Main.java:8)',
].join('\n');

const GO_PANIC = [
  'panic: runtime error: index out of range [3] with length 3',
  '',
  'goroutine 1 [running]:',
  'main.main()',
  '\t/app/main.go:10 +0x1d',
].join('\n');

const NODE_ECONN = [
  'Error: connect ECONNREFUSED 127.0.0.1:5432',
  '    at TCPConnectWrap.afterConnect (node:net:1595:16)',
  '    at Socket.emit (node:events:513:28)',
].join('\n');

function main(): void {
  // ─── (1) empty / whitespace with NO attachment → block ────────────────────
  const b1 = assertAction('', 'block', '(1) empty string');
  assertEq(b1.hint, 'Type a message or attach a file.', '(1) empty block hint');
  assertEq(b1.reason, 'empty-no-attachment', '(1) empty block reason');
  assertAction('   ', 'block', '(1) spaces only');
  assertAction('\n\n', 'block', '(1) newlines only');
  assertAction('\t \t', 'block', '(1) tabs+spaces only');
  assertAction('   \n \t ', 'block', '(1) mixed whitespace only');
  assertAction('', 'block', '(1) empty + explicit no attachment', { hasAttachment: false });

  // ─── (2) empty text WITH an attachment → send (open the file) ──────────────
  const s2 = assertAction('', 'send', '(2) empty + attachment', { hasAttachment: true });
  assertEq(s2.hint, '', '(2) empty+attachment has no hint');
  assertEq(s2.reason, 'empty-with-attachment', '(2) empty+attachment reason');
  assertAction('   ', 'send', '(2) whitespace + attachment', { hasAttachment: true });
  assertAction('\n\t', 'send', '(2) newline/tab + attachment', { hasAttachment: true });

  // ─── (3) ordinary messages → send (bias to send) ──────────────────────────
  assertAction('hi', 'send', '(3) hi');
  assertAction('deploy to staging', 'send', '(3) deploy');
  assertAction("what's the weather", 'send', '(3) question');
  assertAction('summarize this thread', 'send', '(3) summarize');
  assertAction('build a login form with email and password', 'send', '(3) build request');
  assertAction('create a landing page for a coffee shop', 'send', '(3) landing page');
  assertAction('help me fix the failing test', 'send', '(3) fix test');
  assertAction('a', 'send', '(3) single char');
  // A normal-size code paste (not an error) still sends.
  assertAction('function add(a, b) {\n  return a + b;\n}\n', 'send', '(3) small code block');
  // Non-error text with an attachment also just sends.
  assertAction('open this', 'send', '(3) text + attachment', { hasAttachment: true });

  // ─── (4) HUGE paste (non-error) → confirm (attach-as-file) ────────────────
  const huge = 'x'.repeat(HUGE_PASTE_THRESHOLD + 1);
  const c4 = assertAction(huge, 'confirm', '(4) just over threshold');
  assertEq(c4.reason, 'huge-paste', '(4) huge reason');
  assert(c4.hint.indexOf('large paste') !== -1, '(4) huge hint mentions large paste');
  assert(c4.hint.indexOf('attach it as a file') !== -1, '(4) huge hint offers file');
  // Prose-like huge paste (many words, no stack signals) still confirms.
  assertAction(('lorem ipsum dolor sit amet '.repeat(400)), 'confirm', '(4) huge prose');
  // Exactly AT the threshold is NOT huge (strictly greater) → send.
  assertAction('y'.repeat(HUGE_PASTE_THRESHOLD), 'send', '(4) exactly at threshold sends');
  assertAction('z'.repeat(HUGE_PASTE_THRESHOLD - 1), 'send', '(4) just under threshold sends');
  // A huge paste with an attachment is still a huge paste → confirm.
  assertAction(huge, 'confirm', '(4) huge + attachment still confirms', { hasAttachment: true });

  // ─── (5) pasted stack trace / error dump → confirm (offer to debug) ───────
  const c5 = assertAction(JS_STACK, 'confirm', '(5) JS stack');
  assertEq(c5.reason, 'error-dump', '(5) JS stack reason');
  assertEq(c5.hint, 'Looks like an error — want me to debug it?', '(5) JS stack hint');
  assertAction(PY_TRACEBACK, 'confirm', '(5) Python traceback');
  assertAction(JAVA_STACK, 'confirm', '(5) Java stack');
  assertAction(GO_PANIC, 'confirm', '(5) Go panic');
  assertAction(NODE_ECONN, 'confirm', '(5) Node ECONNREFUSED');
  // A short error dump (well under the huge threshold) still confirms.
  assert(JS_STACK.length < HUGE_PASTE_THRESHOLD, '(5) JS stack is short (not huge)');
  // Error dump even with an attachment → confirm (still worth the debug offer).
  assertAction(JS_STACK, 'confirm', '(5) stack + attachment confirms', { hasAttachment: true });

  // ─── (6) PRECISION — prose that mentions errors must NOT be a dump → send ──
  assertAction("I'm getting an error, can you help?", 'send', '(6) single-line error mention');
  assertAction('I keep getting an error.\nIt is a weird error.\nCan you help?', 'send', '(6) multi-line prose error word');
  assertAction('I got a TypeError.\nIt happens sometimes.\nAny ideas?', 'send', '(6) TypeError mention, no frame');
  assertAction("Let's meet at 5:30.\nSee you at the cafe on 5th.", 'send', "(6) 'at' + time is not a frame");
  assertAction('at the store\nat the park', 'send', "(6) leading 'at' prose is not a frame");
  assertAction('Check http://example.com:8080\nand http://other.io:3000', 'send', '(6) URL host:port is not file:line');
  assertAction('How do I fix a NullPointerException in Java?', 'send', '(6) how-to question mentioning exception');
  assertAction('The deploy failed. Retry?', 'send', '(6) failure mention, no stack');

  // ─── (7) looksLikeErrorDump — TRUE on real dumps ──────────────────────────
  assert(looksLikeErrorDump(JS_STACK) === true, '(7) JS stack → true');
  assert(looksLikeErrorDump(PY_TRACEBACK) === true, '(7) Python traceback → true');
  assert(looksLikeErrorDump(JAVA_STACK) === true, '(7) Java stack → true');
  assert(looksLikeErrorDump(GO_PANIC) === true, '(7) Go panic → true');
  assert(looksLikeErrorDump(NODE_ECONN) === true, '(7) Node ECONN → true');
  assert(looksLikeErrorDump('Error: boom\n    at foo (bar.js:1:2)\n    at baz (qux.js:3:4)') === true, '(7) generic 2-frame → true');
  assert(looksLikeErrorDump('src/a.ts:12:5 - error\nsrc/b.ts:20:9 - error') === true, '(7) two ts file:line → true');

  // ─── (8) looksLikeErrorDump — FALSE on non-dumps ──────────────────────────
  assert(looksLikeErrorDump("I'm getting an error, can you help?") === false, '(8) single-line mention → false');
  assert(looksLikeErrorDump('I keep getting an error.\nIt is a weird error.') === false, '(8) prose "error" x2 → false');
  assert(looksLikeErrorDump('I got a TypeError.\nplease help') === false, '(8) TypeError no frame → false');
  assert(looksLikeErrorDump('function add(a,b){\n  return a+b;\n}') === false, '(8) normal code → false');
  assert(looksLikeErrorDump('hello there') === false, '(8) greeting → false');
  assert(looksLikeErrorDump('') === false, '(8) empty → false');
  assert(looksLikeErrorDump('deploy to production and send the report') === false, '(8) action request → false');
  assert(looksLikeErrorDump('Check http://a.com:80\nand http://b.io:90') === false, '(8) urls only → false');
  assert(looksLikeErrorDump('at the store\nat the park') === false, "(8) 'at' prose → false");
  assert(looksLikeErrorDump('src/a.ts:12:5 - error TS2304: cannot find name') === false, '(8) single ts line → false (needs 2)');

  // ─── (9) precedence — a HUGE error dump confirms as an ERROR (not a paste) ─
  const frame = '    at handler (/srv/app/routes/api.js:42:19)\n';
  const hugeDump = `TypeError: kaboom\n${frame.repeat(1000)}`;
  assert(hugeDump.length > HUGE_PASTE_THRESHOLD, '(9) constructed dump is huge');
  const c9 = guardChatSend(hugeDump);
  assertShape(c9, '(9) huge dump verdict');
  assertEq(c9.action, 'confirm', '(9) huge dump → confirm');
  assertEq(c9.reason, 'error-dump', '(9) huge dump reason is error-dump (beats huge-paste)');
  assertEq(c9.hint, 'Looks like an error — want me to debug it?', '(9) huge dump uses debug hint');

  // ─── (10) structural / bounds invariants ──────────────────────────────────
  assertEq(HUGE_PASTE_THRESHOLD, 8000, '(10) HUGE_PASTE_THRESHOLD is 8000');
  assertEq(MAX_REASONABLE_MESSAGE, 20000, '(10) MAX_REASONABLE_MESSAGE is 20000');
  assert(HUGE_PASTE_THRESHOLD < MAX_REASONABLE_MESSAGE, '(10) huge < reasonable');
  assert(typeof guardChatSend === 'function', '(10) guardChatSend is a function');
  assert(typeof looksLikeErrorDump === 'function', '(10) looksLikeErrorDump is a function');
  // Fresh objects — mutating one verdict cannot poison the next.
  const m1 = guardChatSend('');
  (m1 as { action: SendGuardAction }).action = 'send';
  (m1 as { hint: string }).hint = 'POISON';
  const m2 = guardChatSend('');
  assertEq(m2.action, 'block', '(10) later call unaffected by mutation (action)');
  assertEq(m2.hint, 'Type a message or attach a file.', '(10) later call unaffected by mutation (hint)');

  // ─── (11) degenerate inputs never throw (totality) ────────────────────────
  try {
    const junk: unknown[] = [
      null, undefined, 0, 42, 3.14, NaN, Infinity, -Infinity, true, false, {},
      [], ['stack'], { message: JS_STACK }, () => JS_STACK, Symbol('x'), 10n as unknown,
    ];
    for (const j of junk) {
      const v = guardChatSend(j);
      assertShape(v, `(11) guard(${String(typeof j)})`);
      // Non-string input carries no text → treated as empty → block (no attach)
      // or send (with attach); never a throw, never a confirm on junk.
      assert(v.action === 'block' || v.action === 'send', `(11) guard(${String(typeof j)}) block|send`);
      assertEq(looksLikeErrorDump(j), false, `(11) looksLikeErrorDump(${String(typeof j)}) → false`);
    }
    // Non-string junk with an attachment → send (empty text + file).
    assertEq(guardChatSend(null, { hasAttachment: true }).action, 'send', '(11) null + attachment → send');
    assertEq(guardChatSend(42 as unknown, { hasAttachment: true }).action, 'send', '(11) number + attachment → send');
    // Hostile opts objects tolerated (non-object, wrong-typed field, throwing getter).
    assertEq(guardChatSend('hi', null as unknown as SendGuardOptions).action, 'send', '(11) null opts tolerated');
    assertEq(guardChatSend('hi', 42 as unknown as SendGuardOptions).action, 'send', '(11) number opts tolerated');
    assertEq(guardChatSend('', { hasAttachment: 'yes' } as unknown as SendGuardOptions).action, 'block', '(11) non-bool hasAttachment → not attached');
    const throwingOpts = {} as SendGuardOptions;
    Object.defineProperty(throwingOpts, 'hasAttachment', { get() { throw new Error('boom'); } });
    assertEq(guardChatSend('', throwingOpts).action, 'block', '(11) throwing getter → treated as no attachment');
    assertEq(guardChatSend('hi', throwingOpts).action, 'send', '(11) throwing getter on non-empty → send');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (11) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  // ─── (12) huge / adversarial input stays bounded and safe ─────────────────
  try {
    // 1MB of benign chars → huge paste confirm, no hang.
    assertEq(guardChatSend('a'.repeat(1_000_000)).action, 'confirm', '(12) 1MB benign → confirm');
    // 1MB of newlines (many empty lines) → whitespace-only → block.
    assertEq(guardChatSend('\n'.repeat(1_000_000)).action, 'block', '(12) 1MB newlines → block');
    // 1MB error dump → still an error dump (scan is capped, signal is early).
    const bigDump = `Error: boom\n${'    at f (a.js:1:2)\n'.repeat(50_000)}`;
    assertEq(guardChatSend(bigDump).action, 'confirm', '(12) 1MB dump → confirm');
    assertEq(guardChatSend(bigDump).reason, 'error-dump', '(12) 1MB dump reason');
    // A pathological single 1MB line (no newlines) → not a dump → huge confirm.
    assertEq(looksLikeErrorDump('at x '.repeat(200_000)), false, '(12) single huge line → not a dump');
    assertEq(guardChatSend('at x '.repeat(200_000)).action, 'confirm', '(12) single huge line → huge confirm');
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (12) huge inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll chatSendGuardCore smoke cases passed (${passes} passed).`);
}

main();
