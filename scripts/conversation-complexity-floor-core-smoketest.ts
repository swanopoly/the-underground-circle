/**
 * conversation-complexity-floor-core-smoketest — pins the mid-task context
 * floor (src/lib/conversationComplexityFloorCore.ts). Load-bearing assertions:
 *
 *   ESTIMATOR: estimateTurnComplexity buckets a turn into trivial/simple/
 *   moderate/complex from inlined heuristics (bare follow-ups + greetings →
 *   trivial; short questions/statements → simple; action verbs / longer text →
 *   moderate; long / multi-step / long-task → complex). It never imports the
 *   react-tainted agenticCodingProfile.
 *
 *   FLOOR: resolveConversationComplexityFloor returns null on an empty/thin
 *   trail (byte-identical no-op), returns a floor ONE TIER BELOW the most recent
 *   substantive prior user turn ('complex' → 'moderate', 'moderate' → 'simple')
 *   when the current turn is thin, decays to null once the recent user turns are
 *   casual again, and is a no-op when the current turn is already substantive.
 *
 *   HOSTILE: every export is total — null/undefined/wrong-type/huge/hostile
 *   input yields a safe neutral value and never throws.
 *
 * Pure — loads under tsx (the core has type-only imports; chatPromptAssembly is
 * a dependency-light pure module and its type is erased at compile time).
 */

import {
  estimateTurnComplexity,
  resolveConversationComplexityFloor,
  type ChatPromptComplexity,
} from '../src/lib/conversationComplexityFloorCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

const TIERS: ReadonlyArray<ChatPromptComplexity> = ['trivial', 'simple', 'moderate', 'complex'];
const isTier = (v: unknown): v is ChatPromptComplexity => TIERS.includes(v as ChatPromptComplexity);

// Assistant filler so trails clear the length>=2 guard and exercise the
// user-turn extraction (assistant/model turns must be skipped).
const A = (content: string) => ({ role: 'assistant' as const, content });
const U = (content: string) => ({ role: 'user' as const, content });

// A clearly-substantive prior task turn (multi-step → 'complex').
const COMPLEX_TASK =
  'First scaffold the new billing service, then wire up the Stripe webhooks, and after that migrate the existing subscriptions and add tests.';
// A short action turn (→ 'moderate').
const MODERATE_TASK = 'Please review the auth changes in this PR.';

function main(): void {
  // ─── (1) estimator: trivial (bare follow-ups / greetings / acks) ───────────
  for (const t of ['yes', 'go', 'do it', 'ok', 'okay', 'thanks', 'yep', 'nope', 'sure', 'hey', 'lgtm', 'ship it']) {
    assertEq(estimateTurnComplexity(t), 'trivial', `(1) "${t}" → trivial`);
  }
  assertEq(estimateTurnComplexity('thanks a lot'), 'trivial', '(1) short casual phrase → trivial');
  assertEq(estimateTurnComplexity('sounds good to me'), 'trivial', '(1) "sounds good to me" → trivial');
  assertEq(estimateTurnComplexity(''), 'trivial', '(1) empty string → trivial');
  assertEq(estimateTurnComplexity('   '), 'trivial', '(1) whitespace only → trivial');

  // ─── (2) estimator: simple (short questions / short statements) ────────────
  assertEq(estimateTurnComplexity('what is this thing'), 'simple', '(2) short what-question → simple');
  assertEq(estimateTurnComplexity('how does the router work here'), 'simple', '(2) short how-question → simple');
  assertEq(estimateTurnComplexity('the sky is blue today'), 'simple', '(2) short plain statement → simple');
  assertEq(estimateTurnComplexity('is there a config for this?'), 'simple', '(2) short yes/no question → simple');

  // ─── (3) estimator: moderate (action verbs, longer questions/statements) ───
  assertEq(estimateTurnComplexity('fix the login bug'), 'moderate', '(3) short fix task → moderate');
  assertEq(estimateTurnComplexity(MODERATE_TASK), 'moderate', '(3) short review task → moderate');
  assertEq(estimateTurnComplexity('please build a settings page'), 'moderate', '(3) short build task → moderate');
  assertEq(estimateTurnComplexity('deploy the service to production'), 'moderate', '(3) short deploy task → moderate');
  {
    const longQuestion =
      'how should we approach the migration of every legacy provider adapter into the new routing layer while keeping the old billing preference and marketplace catalog and provider keys fully working for all of our existing paying users';
    assertEq(estimateTurnComplexity(longQuestion), 'moderate', '(3) long question → moderate');
    const midStatement =
      'the current system has several rough edges around performance and reliability and could use attention from the whole team over the next couple of weeks or so';
    assertEq(estimateTurnComplexity(midStatement), 'moderate', '(3) 21-40 word plain statement → moderate');
  }

  // ─── (4) estimator: complex (long / multi-step / long-task) ────────────────
  assertEq(estimateTurnComplexity(COMPLEX_TASK), 'complex', '(4) multi-step task → complex');
  assertEq(estimateTurnComplexity('first do the schema, then run the backfill'), 'complex', '(4) first…then → complex');
  {
    const bigTask = 'build ' + 'a really large feature that touches many different files '.repeat(6);
    assertEq(estimateTurnComplexity(bigTask), 'complex', '(4) long (>40w) task → complex');
    const longPlain = 'lorem ipsum dolor sit amet '.repeat(20); // ~100 words, no verbs/questions
    assertEq(estimateTurnComplexity(longPlain), 'complex', '(4) very long plain text → complex');
  }
  // estimator is total + always a valid tier for arbitrary input
  for (const v of [null, undefined, 42, {}, [], true, NaN]) {
    assert(isTier(estimateTurnComplexity(v as never)), `(4) estimator returns a tier for ${JSON.stringify(v)}`);
  }

  // ─── (5) floor: empty / thin / non-array trail → null ──────────────────────
  assertEq(resolveConversationComplexityFloor([], 'trivial'), null, '(5) empty array → null');
  assertEq(resolveConversationComplexityFloor([U(COMPLEX_TASK)], 'trivial'), null, '(5) single-message trail → null');
  assertEq(resolveConversationComplexityFloor(null, 'trivial'), null, '(5) null trail → null');
  assertEq(resolveConversationComplexityFloor(undefined, 'trivial'), null, '(5) undefined trail → null');
  assertEq(resolveConversationComplexityFloor('nope', 'trivial'), null, '(5) string trail → null');
  assertEq(resolveConversationComplexityFloor(42, 'trivial'), null, '(5) number trail → null');
  assertEq(resolveConversationComplexityFloor({}, 'trivial'), null, '(5) object trail → null');

  // ─── (6) floor: prior substantive task + thin follow-up → non-null ─────────
  {
    // The realistic mid-task shape: prior task turn + assistant plan, current
    // turn is a bare "yes" (passed as currentComplexity='trivial').
    const trail = [U(COMPLEX_TASK), A('Here is the plan — sound good?')];
    const floor = resolveConversationComplexityFloor(trail, 'trivial');
    assert(floor !== null, '(6) prior complex task + "yes" → non-null');
    assert(floor === 'moderate' || floor === 'simple', '(6) floor is moderate|simple', `got ${JSON.stringify(floor)}`);
    assertEq(floor, 'moderate', '(6) prior COMPLEX task → floor one tier below = moderate');
  }
  {
    // The "yes" also physically present as the last user turn — still floors
    // off the earlier substantive task (robust either way).
    const trail = [U(COMPLEX_TASK), A('Here is the plan.'), U('yes')];
    const floor = resolveConversationComplexityFloor(trail, 'trivial');
    assertEq(floor, 'moderate', '(6) "yes" present in trail still floors to moderate');
  }
  {
    // A "go ahead" style follow-up on a MODERATE prior task → simple floor.
    const trail = [U(MODERATE_TASK), A('Want me to start?')];
    assertEq(resolveConversationComplexityFloor(trail, 'trivial'), 'simple', '(6) prior MODERATE task → floor simple');
  }

  // ─── (7) floor: one-tier-below mapping across current-turn thinness ─────────
  {
    const trail = [U(COMPLEX_TASK), A('ok?')];
    assertEq(resolveConversationComplexityFloor(trail, 'trivial'), 'moderate', '(7) complex→moderate (current trivial)');
    assertEq(resolveConversationComplexityFloor(trail, 'simple'), 'moderate', '(7) complex→moderate (current simple)');
    assertEq(resolveConversationComplexityFloor(trail, undefined), 'moderate', '(7) complex→moderate (current unknown)');
    assertEq(resolveConversationComplexityFloor(trail, 'garbage'), 'moderate', '(7) complex→moderate (current junk string)');
  }

  // ─── (8) floor: decay to null once recent turns are casual ─────────────────
  {
    // task, then two casual user turns since → wound down.
    const decayed = [U(COMPLEX_TASK), A('done'), U('thanks'), A('np'), U('cool')];
    assertEq(resolveConversationComplexityFloor(decayed, 'trivial'), null, '(8) two casual turns since task → null');
    // all-casual recent trail → null.
    const casual = [U('thanks'), A('np'), U('cool')];
    assertEq(resolveConversationComplexityFloor(casual, 'trivial'), null, '(8) all casual recent trail → null');
    // ONE casual turn since the task still keeps a floor (not yet decayed).
    const oneCasual = [U(COMPLEX_TASK), A('done'), U('cool')];
    assertEq(resolveConversationComplexityFloor(oneCasual, 'trivial'), 'moderate', '(8) one casual turn since → still floors');
  }

  // ─── (9) floor: no-op when the current turn is already substantive ─────────
  {
    const trail = [U(COMPLEX_TASK), A('plan')];
    assertEq(resolveConversationComplexityFloor(trail, 'moderate'), null, '(9) current moderate → no-op (message speaks for itself)');
    assertEq(resolveConversationComplexityFloor(trail, 'complex'), null, '(9) current complex → no-op');
  }

  // ─── (10) floor: recency window — substantive too far back → null ──────────
  {
    // The substantive task is the 4th-most-recent user turn (outside the last
    // ~3 window); the recent window is all casual → null.
    const farBack = [U(COMPLEX_TASK), A('a'), U('ok'), A('b'), U('nice'), A('c'), U('cool')];
    assertEq(resolveConversationComplexityFloor(farBack, 'trivial'), null, '(10) substantive outside recency window → null');
  }
  {
    // A substantive turn buried past the backward scan cap must not be found.
    const filler: Array<{ role: 'assistant'; content: string }> = [];
    for (let i = 0; i < 130; i += 1) filler.push(A('filler assistant turn'));
    const buried = [U(COMPLEX_TASK), ...filler]; // user task is >100 back
    assertEq(resolveConversationComplexityFloor(buried, 'trivial'), null, '(10) substantive past scan cap → null');
  }

  // ─── (11) floor: a thin prior trail (short question) does not floor ─────────
  {
    const thin = [U('what is this?'), A('It is the settings page.')];
    assertEq(resolveConversationComplexityFloor(thin, 'trivial'), null, '(11) prior simple question → no floor');
  }

  // ─── (12) hostile / degenerate input → never throws, always null|tier ──────
  const hostileTrails: unknown[] = [
    null,
    undefined,
    NaN,
    0,
    '',
    'string',
    true,
    {},
    [],
    [null, null],
    [1, 'a', true, null],
    [U('go'), U('yes')],
    [{ role: 'user' }, { role: 'user' }], // missing content
    [{ role: 'user', content: 123 }, { role: 'user', content: 456 }], // non-string content
    [{ role: 'user', content: {} }, { role: 'user', content: [] }],
    [{ role: 'model', content: 'x' }, { role: 'model', content: 'y' }], // no user turns
    [{ content: 'orphan' }, { content: 'orphan2' }], // missing role
    [U(COMPLEX_TASK), A('plan')], // valid — must yield a tier
    new Array(5000).fill(A('spam')), // huge, no user turns
    [Symbol('x'), U('go'), U('do it')] as unknown,
  ];
  const hostileCurrents: unknown[] = [null, undefined, NaN, 0, '', 'x', {}, [], true, 'moderate', 'complex', Symbol('s')];
  for (const trail of hostileTrails) {
    for (const cur of hostileCurrents) {
      let out: unknown;
      let threw = false;
      try { out = resolveConversationComplexityFloor(trail, cur); } catch { threw = true; }
      assert(!threw, `(12) no throw for trail=${safe(trail)} cur=${safe(cur)}`);
      assert(out === null || isTier(out), `(12) result is null|tier for trail=${safe(trail)} cur=${safe(cur)}`, `got ${JSON.stringify(out)}`);
    }
  }
  // estimator never throws on hostile input either
  for (const v of [null, undefined, NaN, 0, {}, [], true, Symbol('e'), 'x'.repeat(50_000)]) {
    let threw = false;
    let out: unknown;
    try { out = estimateTurnComplexity(v as never); } catch { threw = true; }
    assert(!threw, `(12) estimator no throw for ${safe(v)}`);
    assert(isTier(out), `(12) estimator returns a tier for ${safe(v)}`);
  }

  // ─── (13) determinism (pure) ───────────────────────────────────────────────
  {
    const trail = [U(COMPLEX_TASK), A('plan'), U('sure')];
    const a = resolveConversationComplexityFloor(trail, 'trivial');
    const b = resolveConversationComplexityFloor(trail, 'trivial');
    assertEq(a, b, '(13) same input → same output');
    assertEq(estimateTurnComplexity(COMPLEX_TASK), estimateTurnComplexity(COMPLEX_TASK), '(13) estimator deterministic');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll conversation-complexity-floor-core smoke cases passed (${passes} passed).`);
}

function safe(v: unknown): string {
  try {
    if (typeof v === 'symbol') return 'Symbol';
    if (Array.isArray(v) && v.length > 20) return `Array(${v.length})`;
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}

main();
