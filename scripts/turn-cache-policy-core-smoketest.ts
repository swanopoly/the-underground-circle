/**
 * turn-cache-policy-core-smoketest — the pure cache-eligibility predicate behind
 * SwanBot turn de-dup (src/lib/turnCachePolicyCore.ts, robustness backlog #6).
 *
 * Load-bearing behavior asserted here:
 *   - classifyTurnResult tags the app's REAL failure/stop/recovery copy (chat
 *     stop messages + AI-offline fallbacks + desktop-bridge notices) as
 *     'failure', so isCacheableTurnResult → false and the 15s replay cache in
 *     swanbotTurnDedupe skips them (retry re-runs instead of a silent no-op).
 *   - Genuine answers, incl. long prose that merely mentions "failed", are
 *     'success' → cacheable.
 *   - Empty/whitespace strings and null/undefined → 'empty' → not cacheable.
 *   - Structured objects: ok:false / truthy error → 'failure'; a failure
 *     `response` string → 'failure'; a real `response` string → 'success'
 *     (fixes the structured wiring site, which has no ok/error flag).
 *   - Length + lead bias: a short leading marker fires; a marker buried past the
 *     lead window in a mid-length answer does not; >=400-char results stay
 *     'success'.
 *   - Every export is TOTAL — degenerate/hostile input never throws.
 *
 * Pure — loads under tsx (turnCachePolicyCore has zero imports).
 */

import {
  classifyTurnResult,
  isCacheableTurnResult,
  NON_CACHEABLE_MARKERS,
  type TurnResultClass,
} from '../src/lib/turnCachePolicyCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

// The app's real failure/stop/recovery copy (verbatim-ish from
// chatStopMessageCore.ts and swanbot.ts fallbacks).
const REAL_FAILURES: readonly string[] = [
  'This turn stopped before I could finish. Try again in a moment — if it keeps happening, start a fresh chat.',
  'A tool step failed, so I stopped this turn early. Try again in a moment, or tell me to take a different approach.',
  'This turn hit its limit of back-to-back tool rounds, so I paused before repeating any desktop or browser actions. Tap Continue to resume, or start fresh.',
  "I couldn't reach the server to finish this turn. Check your connection and try again in a moment.",
  "I stopped because my last few attempts weren't making progress, and repeating them wouldn't help. Try again with a bit more detail, or start fresh.",
  'Hey Chris, I couldn’t complete that — the provider key is missing. You can check provider keys in Marketplace.',
  'Hey Chris, my AI connection is down right now. Try a command like "status", "my tasks", "streak", or "leaderboard".',
  "Chris, I can't reach my AI backend at the moment. You can still use commands: \"help\" to see what's available.",
  "AI's offline rn Chris. Commands like \"status\", \"streak\", \"my tasks\" still work — type \"help\" to see all options.",
  'Connection to AI is temporarily down. In the meantime, try "status" or "my tasks" — I’ve got those locally.',
  'Desktop bridge is not connected or does not have the requested folder access.',
  'The local desktop bridge is not responding, so chat cannot see or control desktop apps.',
  'Something went wrong: Unknown error',
];

const REAL_SUCCESSES: readonly string[] = [
  "What's good? 🦢",
  'Your streak is 12 days. Keep it going!',
  'You have 3 open tasks: ship the router, review the PR, and update the changelog.',
  "Here's the status: everything is green and the deploy finished a minute ago.",
  'Sure — I opened the file and added the import at the top. Anything else?',
  'The leaderboard: 1) Ada 2) Linus 3) Grace. You are in 4th, 20 XP behind Grace.',
];

function main(): void {
  // ─── (1) Real failure copy → 'failure' / not cacheable ─────────────────────
  for (let i = 0; i < REAL_FAILURES.length; i += 1) {
    const s = REAL_FAILURES[i];
    assertEq(classifyTurnResult(s), 'failure', `(1) real failure #${i} → failure`);
    assertEq(isCacheableTurnResult(s), false, `(1) real failure #${i} not cacheable`);
  }

  // ─── (2) Real success copy → 'success' / cacheable ─────────────────────────
  for (let i = 0; i < REAL_SUCCESSES.length; i += 1) {
    const s = REAL_SUCCESSES[i];
    assertEq(classifyTurnResult(s), 'success', `(2) real success #${i} → success`);
    assertEq(isCacheableTurnResult(s), true, `(2) real success #${i} cacheable`);
  }

  // ─── (3) Empty / whitespace / nullish → 'empty' / not cacheable ────────────
  assertEq(classifyTurnResult(''), 'empty', '(3) empty string → empty');
  assertEq(classifyTurnResult('   '), 'empty', '(3) spaces → empty');
  assertEq(classifyTurnResult('\n\t  \r\n'), 'empty', '(3) whitespace mix → empty');
  assertEq(classifyTurnResult(null), 'empty', '(3) null → empty');
  assertEq(classifyTurnResult(undefined), 'empty', '(3) undefined → empty');
  assertEq(isCacheableTurnResult(''), false, '(3) empty not cacheable');
  assertEq(isCacheableTurnResult(null), false, '(3) null not cacheable');
  assertEq(isCacheableTurnResult(undefined), false, '(3) undefined not cacheable');

  // ─── (4) Structured objects ────────────────────────────────────────────────
  assertEq(classifyTurnResult({ ok: false }), 'failure', '(4) ok:false → failure');
  assertEq(classifyTurnResult({ ok: false, response: 'ignored' }), 'failure', '(4) ok:false dominates');
  assertEq(classifyTurnResult({ error: 'boom' }), 'failure', '(4) truthy error → failure');
  assertEq(classifyTurnResult({ error: {} }), 'failure', '(4) truthy error object → failure');
  assertEq(classifyTurnResult({ error: '' }), 'success', '(4) empty error string → not a failure flag');
  assertEq(classifyTurnResult({ error: null, response: 'All good, 3 tasks done.' }), 'success', '(4) null error + real response → success');
  assertEq(
    classifyTurnResult({ response: 'A tool step failed, so I stopped this turn early. Try again in a moment.' }),
    'failure',
    '(4) failure response string → failure (structured path fix)',
  );
  assertEq(
    isCacheableTurnResult({ response: 'A tool step failed, so I stopped this turn early. Try again in a moment.' }),
    false,
    '(4) failure response not cacheable',
  );
  assertEq(classifyTurnResult({ response: "Here's your status: 3 tasks open." }), 'success', '(4) real response string → success');
  assertEq(isCacheableTurnResult({ response: "Here's your status: 3 tasks open." }), true, '(4) real response cacheable');
  assertEq(classifyTurnResult({ response: '' }), 'empty', '(4) empty response → empty');
  assertEq(classifyTurnResult({ response: '   ' }), 'empty', '(4) whitespace response → empty');
  assertEq(classifyTurnResult({ message: "Couldn't reach the backend." }), 'failure', '(4) message field failure → failure');
  assertEq(classifyTurnResult({ text: 'Done — file saved.' }), 'success', '(4) text field success → success');
  assertEq(classifyTurnResult({ usage: { total_tokens: 5 } }), 'success', '(4) object w/o text/ok/error → success');
  assertEq(classifyTurnResult({ response: 42 }), 'success', '(4) non-string response → success (no failure signal)');
  // ok:false takes precedence even when the response text reads fine.
  assertEq(classifyTurnResult({ ok: false, response: 'Everything worked great.' }), 'failure', '(4) ok:false beats healthy response');

  // ─── (5) Length bias: long prose mentioning "failed" stays 'success' ───────
  const longProse =
    'Great question. When a CI pipeline reports that a job failed, it usually means one of the ' +
    'test stages exited non-zero. The word "failed" in that report is descriptive, not an app ' +
    'error — here is a thorough walkthrough of how to read the log, isolate the failing stage, ' +
    'reproduce it locally, and land a fix, plus how retries and caching interact along the way. ' +
    'This message is intentionally well over four hundred characters so the classifier treats it ' +
    'as a substantive answer rather than a failure banner, because a real explanation should cache.';
  assert(longProse.length >= 400, '(5) long prose fixture is actually long', `len=${longProse.length}`);
  assertEq(classifyTurnResult(longProse), 'success', '(5) long prose containing "failed" → success');
  assertEq(isCacheableTurnResult(longProse), true, '(5) long prose cacheable');
  // Short status containing "failed" leading → failure (safe direction).
  assertEq(classifyTurnResult('Build failed.'), 'failure', '(5) short "Build failed." → failure');
  assertEq(classifyTurnResult('Offline.'), 'failure', '(5) short "Offline." → failure');

  // ─── (6) Lead bias: marker buried past the lead window → 'success' ─────────
  const buriedMarker =
    'Here is a concise summary of the release plan and the three milestones we agreed on, with ' +
    'owners and dates for each, and only near the very end does it mention that one optional ' +
    'stretch item is no longer in scope for this cycle.';
  assert(buriedMarker.length < 400, '(6) buried-marker fixture stays under long gate', `len=${buriedMarker.length}`);
  assert(buriedMarker.toLowerCase().indexOf('no longer') > 160, '(6) marker is past the lead window', `idx=${buriedMarker.toLowerCase().indexOf('no longer')}`);
  assertEq(classifyTurnResult(buriedMarker), 'success', '(6) marker past lead window → success');
  // Same marker LEADING → failure.
  assertEq(classifyTurnResult('That endpoint is no longer available here.'), 'failure', '(6) leading "no longer" → failure');

  // ─── (7) Apostrophe normalization (curly ’ matches ASCII marker) ───────────
  assertEq(classifyTurnResult('I couldn’t finish that.'), 'failure', '(7) curly-apostrophe couldn’t → failure');
  assertEq(classifyTurnResult("I couldn't finish that."), 'failure', '(7) ascii couldn\'t → failure');
  assertEq(classifyTurnResult('We can’t reach the server.'), 'failure', '(7) curly can’t reach → failure');

  // ─── (8) Very-short apologetic recovery openers → 'failure' ────────────────
  assertEq(classifyTurnResult('Sorry, one sec.'), 'failure', '(8) short sorry → failure');
  assertEq(classifyTurnResult('Oops — let me redo that.'), 'failure', '(8) short oops → failure');
  assertEq(classifyTurnResult('My apologies.'), 'failure', '(8) short apologies → failure');
  // A LONG message that opens with "Sorry" but is a real answer is NOT judged on apology alone.
  const longSorry =
    'Sorry for the delay on this — here is the complete answer you asked for, laid out in full. ' +
    'It walks through every step of the setup, the configuration values you need, the exact ' +
    'commands to run in order, and what a healthy result looks like at the end so you can verify ' +
    'the whole thing end to end without guessing, which is well past the short-apology threshold.';
  assert(longSorry.length > 80, '(8) long-sorry fixture exceeds apology window', `len=${longSorry.length}`);
  assertEq(classifyTurnResult(longSorry), 'success', '(8) long answer opening with "Sorry" → success');

  // ─── (9) isCacheableTurnResult mirrors classify === success ────────────────
  const mirror: unknown[] = [
    'ok done', 'A tool step failed.', '', null, undefined, { ok: false },
    { response: 'hello there' }, 42, true, [], longProse,
  ];
  for (let i = 0; i < mirror.length; i += 1) {
    const v = mirror[i];
    assertEq(isCacheableTurnResult(v), classifyTurnResult(v) === 'success', `(9) mirror consistency #${i}`);
  }

  // ─── (10) NON_CACHEABLE_MARKERS shape ──────────────────────────────────────
  assert(Array.isArray(NON_CACHEABLE_MARKERS), '(10) markers is an array');
  assert(NON_CACHEABLE_MARKERS.length >= 10, '(10) markers has meaningful coverage');
  assert(NON_CACHEABLE_MARKERS.every((m) => typeof m === 'string' && m.length > 0), '(10) all markers non-empty strings');
  assert(NON_CACHEABLE_MARKERS.every((m) => m === m.toLowerCase()), '(10) all markers lowercase (matcher lowercases input)');
  assert(NON_CACHEABLE_MARKERS.includes('failed'), '(10) includes "failed"');
  assert(NON_CACHEABLE_MARKERS.includes('offline'), '(10) includes "offline"');
  assert(NON_CACHEABLE_MARKERS.includes('try again'), '(10) includes "try again"');
  // Every marker, on its own leading a short string, classifies as failure.
  for (let i = 0; i < NON_CACHEABLE_MARKERS.length; i += 1) {
    const m = NON_CACHEABLE_MARKERS[i];
    assertEq(classifyTurnResult(`${m} right now`), 'failure', `(10) marker "${m}" leading → failure`);
  }

  // ─── (11) Return type is always one of the three classes ───────────────────
  const samples: unknown[] = ['x', '', null, { ok: false }, 5, [], { response: 'hi' }, 'failed now'];
  const valid: TurnResultClass[] = ['success', 'failure', 'empty'];
  for (let i = 0; i < samples.length; i += 1) {
    assert(valid.indexOf(classifyTurnResult(samples[i])) >= 0, `(11) sample #${i} yields a valid class`);
  }

  // ─── (12) Degenerate / hostile input NEVER throws (safe neutral value) ─────
  try {
    // Throwing getters on the fields we read.
    const throwOk: Record<string, unknown> = {};
    Object.defineProperty(throwOk, 'ok', { get() { throw new Error('boom-ok'); }, enumerable: true });
    assertEq(classifyTurnResult(throwOk), 'failure', '(12) throwing ok getter → failure (caught)');
    assertEq(isCacheableTurnResult(throwOk), false, '(12) throwing ok getter not cacheable');

    const throwResponse: Record<string, unknown> = { ok: true, error: 0 };
    Object.defineProperty(throwResponse, 'response', { get() { throw new Error('boom-resp'); }, enumerable: true });
    assertEq(classifyTurnResult(throwResponse), 'failure', '(12) throwing response getter → failure (caught)');

    // Weird primitives and shapes.
    assertEq(classifyTurnResult(NaN), 'success', '(12) NaN → success (default)');
    assertEq(classifyTurnResult(0), 'success', '(12) 0 → success (default)');
    assertEq(classifyTurnResult(false), 'success', '(12) false → success (default)');
    assertEq(classifyTurnResult(Symbol('s')), 'success', '(12) symbol → success (default)');
    assertEq(classifyTurnResult(() => 1), 'success', '(12) function → success (default)');
    assertEq(classifyTurnResult(123n), 'success', '(12) bigint → success (default)');
    assertEq(classifyTurnResult([]), 'success', '(12) empty array → success');
    assertEq(classifyTurnResult([1, 2, 3]), 'success', '(12) array → success');
    assertEq(classifyTurnResult(Object.create(null)), 'success', '(12) null-proto object → success');

    // Huge / hostile strings.
    const hugeReal = 'a'.repeat(500000);
    assertEq(classifyTurnResult(hugeReal), 'success', '(12) huge non-space string → success (bounded)');
    const hugeSpace = ' '.repeat(500000);
    assertEq(classifyTurnResult(hugeSpace), 'empty', '(12) huge whitespace → empty');
    const hugeSpaceThenFail = ' '.repeat(50000) + 'failed';
    assertEq(classifyTurnResult(hugeSpaceThenFail), 'empty', '(12) marker past scan cap of whitespace → empty (bounded)');
    const paddedFail = '   A tool step failed. Try again.   ';
    assertEq(classifyTurnResult(paddedFail), 'failure', '(12) padded failure trims then classifies → failure');

    // Deeply nested / circular objects must not throw.
    const circular: Record<string, unknown> = { ok: true };
    circular.self = circular;
    assertEq(classifyTurnResult(circular), 'success', '(12) circular object → success (no throw)');

    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (12) degenerate/hostile input threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll turn-cache-policy-core smoke cases passed (${passes} passed).`);
}

main();
