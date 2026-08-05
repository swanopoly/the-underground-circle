// Smoke test for computerUseChannelCore — the pure hybrid-fallthrough channel
// selector (api > accessibility > vision). Pure/deterministic; run with:
//   npx tsx scripts/computer-use-channel-core-smoketest.ts
//
// Loads the module under tsx (no react-native / runtime imports allowed) and
// asserts the deterministic-first fallthrough, vision-as-last-resort escalation,
// exhaustion, availability gating, and input-guard behavior.

import {
  describeChannelPlan,
  shouldEscalateToVision,
  selectChannel,
  CHANNEL_PRIORITY,
  DETERMINISTIC_CHANNELS,
  DEFAULT_MAX_NON_VISION_FAILURES,
  type AutomationChannel,
  type ChannelAttempt,
  type ChannelAvailability,
} from '../src/lib/computerUseChannelCore';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${msg}`);
  }
}

function eq<T>(actual: T, expected: T, msg: string): void {
  assert(actual === expected, `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

function arrEq(actual: AutomationChannel[], expected: AutomationChannel[], msg: string): void {
  assert(
    Array.isArray(actual) && actual.length === expected.length && actual.every((v, i) => v === expected[i]),
    `${msg} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`,
  );
}

const ALL: ChannelAvailability = { api: true, accessibility: true, vision: true };
const ok = (channel: AutomationChannel): ChannelAttempt => ({ channel, ok: true });
const fail = (channel: AutomationChannel): ChannelAttempt => ({ channel, ok: false });

// ---- constants / invariants ----------------------------------------------
arrEq([...CHANNEL_PRIORITY], ['api', 'accessibility', 'vision'], 'canonical priority is api>accessibility>vision');
arrEq([...DETERMINISTIC_CHANNELS], ['api', 'accessibility'], 'deterministic channels are api+accessibility');
eq(DEFAULT_MAX_NON_VISION_FAILURES, 2, 'default max non-vision failures is 2');

// ---- describeChannelPlan ---------------------------------------------------
arrEq(describeChannelPlan(ALL), ['api', 'accessibility', 'vision'], 'plan (all): full priority order');
arrEq(
  describeChannelPlan({ api: false, accessibility: true, vision: true }),
  ['accessibility', 'vision'],
  'plan: api gated out',
);
arrEq(
  describeChannelPlan({ api: true, accessibility: false, vision: true }),
  ['api', 'vision'],
  'plan: accessibility gated out',
);
arrEq(
  describeChannelPlan({ api: true, accessibility: true, vision: false }),
  ['api', 'accessibility'],
  'plan: vision gated out (deterministic only)',
);
arrEq(describeChannelPlan({ api: false, accessibility: false, vision: false }), [], 'plan: none available is empty');
arrEq(describeChannelPlan({ api: false, accessibility: false, vision: true }), ['vision'], 'plan: vision-only');

// ---- selectChannel: happy path (deterministic-first) -----------------------
{
  const d = selectChannel(ALL, []);
  eq(d.channel, 'api', 'select: API picked first when available + untried');
  eq(d.escalated, false, 'select: no escalation on first pick');
  eq(d.exhausted, false, 'select: not exhausted on first pick');
}
{
  const d = selectChannel(ALL, [fail('api')]);
  eq(d.channel, 'accessibility', 'select: accessibility after API fails');
  eq(d.escalated, false, 'select: accessibility is not an escalation');
  eq(d.exhausted, false, 'select: not exhausted after only API failed');
}
{
  // API succeeded but is being retried? A successful attempt does not block it.
  const d = selectChannel(ALL, [ok('api')]);
  eq(d.channel, 'api', 'select: a prior SUCCESS does not remove a channel');
}

// ---- selectChannel: vision only after both non-vision fail/unavailable -----
{
  const d = selectChannel(ALL, [fail('api'), fail('accessibility')]);
  eq(d.channel, 'vision', 'select: vision after both non-vision fail');
  eq(d.escalated, true, 'select: escalated flag set when forced to vision');
  eq(d.exhausted, false, 'select: not exhausted while vision remains');
}
{
  // accessibility unavailable + api failed → only vision left → escalated.
  const d = selectChannel({ api: true, accessibility: false, vision: true }, [fail('api')]);
  eq(d.channel, 'vision', 'select: vision when api failed + accessibility unavailable');
  eq(d.escalated, true, 'select: escalated when a non-vision channel failed and only vision remains');
}
{
  // vision-only availability, nothing tried → NOT an escalation (never had a
  // deterministic option to lose).
  const d = selectChannel({ api: false, accessibility: false, vision: true }, []);
  eq(d.channel, 'vision', 'select: vision when it is the only available channel');
  eq(d.escalated, false, 'select: vision-only-from-start is not an escalation');
}

// ---- selectChannel: exhaustion --------------------------------------------
{
  const d = selectChannel(ALL, [fail('api'), fail('accessibility'), fail('vision')]);
  eq(d.channel, null, 'select: null channel when all available fail');
  eq(d.exhausted, true, 'select: exhausted when every available channel failed');
  eq(d.escalated, false, 'select: exhausted is not escalated');
}
{
  // Only deterministic channels available, both failed → exhausted (no vision).
  const d = selectChannel({ api: true, accessibility: true, vision: false }, [fail('api'), fail('accessibility')]);
  eq(d.channel, null, 'select: exhausted when both deterministic fail and no vision');
  eq(d.exhausted, true, 'select: exhausted flag set (no vision fallback)');
  eq(d.escalated, false, 'select: no escalation possible without vision');
}

// ---- selectChannel: availability gates each channel out --------------------
{
  const d = selectChannel({ api: false, accessibility: true, vision: true }, []);
  eq(d.channel, 'accessibility', 'select: skips unavailable API to accessibility');
  eq(d.escalated, false, 'select: skipping an unavailable channel is not escalation');
}
{
  const d = selectChannel({ api: false, accessibility: false, vision: false }, []);
  eq(d.channel, null, 'select: null when nothing is available');
  eq(d.exhausted, false, 'select: no-channel-available is not exhaustion');
  eq(d.escalated, false, 'select: no-channel-available is not escalation');
}

// ---- selectChannel: preferDeterministic keeps vision last ------------------
{
  // Even with preferDeterministic:false, priority order is unchanged (API first).
  const d = selectChannel(ALL, [], { preferDeterministic: false });
  eq(d.channel, 'api', 'select: preferDeterministic=false still picks API first');
}
{
  const d = selectChannel(ALL, [fail('api')], { preferDeterministic: false });
  eq(d.channel, 'accessibility', 'select: preferDeterministic=false still prefers accessibility over vision');
}
{
  // preferDeterministic default (true) does not force vision when deterministic
  // channels are still untried.
  const d = selectChannel(ALL, []);
  assert(d.channel !== 'vision', 'select: vision is never chosen while a deterministic channel is untried');
}

// ---- shouldEscalateToVision ------------------------------------------------
eq(shouldEscalateToVision([]), false, 'escalate: false with no attempts');
eq(shouldEscalateToVision([fail('api')]), false, 'escalate: false after one non-vision failure (< default 2)');
eq(shouldEscalateToVision([fail('api'), fail('accessibility')]), true, 'escalate: true when all non-vision failed');
eq(
  shouldEscalateToVision([ok('api'), fail('accessibility')]),
  false,
  'escalate: false when a deterministic channel succeeded (only 1 failed)',
);
eq(
  shouldEscalateToVision([fail('api')], { maxNonVisionFailures: 1 }),
  true,
  'escalate: threshold=1 escalates after a single non-vision failure',
);
eq(
  shouldEscalateToVision([fail('api'), fail('accessibility')], { maxNonVisionFailures: 5 }),
  true,
  'escalate: all-deterministic-failed escalates even below a high threshold',
);
eq(
  shouldEscalateToVision([fail('vision')]),
  false,
  'escalate: a vision failure alone does not count toward non-vision threshold',
);
eq(
  shouldEscalateToVision([fail('api'), fail('api')]),
  false,
  'escalate: repeated failures of the SAME channel count once (distinct channels)',
);

// ---- input guards: undefined / malformed are safe, never throw -------------
try {
  // @ts-expect-error — intentionally undefined availability
  arrEq(describeChannelPlan(undefined), [], 'guard: describeChannelPlan(undefined) is empty');
  // @ts-expect-error — intentionally undefined attempts
  eq(shouldEscalateToVision(undefined), false, 'guard: shouldEscalateToVision(undefined) is false');
  // @ts-expect-error — intentionally undefined args
  const d = selectChannel(undefined, undefined);
  eq(d.channel, null, 'guard: selectChannel(undefined,undefined) → null channel');
  eq(d.exhausted, false, 'guard: selectChannel(undefined,undefined) not exhausted');

  // Malformed attempts entries are ignored, not fatal.
  const messy = [
    null,
    undefined,
    42,
    'nope',
    { channel: 'bogus', ok: false },
    { ok: false },
    { channel: 'api' }, // missing ok → treated as failed (ok=false)
    fail('accessibility'),
  ] as unknown as ChannelAttempt[];
  const d2 = selectChannel(ALL, messy);
  eq(d2.channel, 'vision', 'guard: malformed list keeps valid api+accessibility failures → vision');
  eq(d2.escalated, true, 'guard: escalation still detected through malformed entries');

  // Non-array attempts → treated as empty.
  // @ts-expect-error — intentionally wrong type
  const d3 = selectChannel(ALL, 'not-an-array');
  eq(d3.channel, 'api', 'guard: non-array attempts treated as empty → API');

  // Partial availability object missing keys → missing keys are unavailable.
  // @ts-expect-error — intentionally partial
  arrEq(describeChannelPlan({ api: true }), ['api'], 'guard: partial availability → only present truthy keys');

  // Non-boolean truthy values must NOT enable a channel (strict boolean).
  // @ts-expect-error — intentionally wrong value types
  arrEq(describeChannelPlan({ api: 1, accessibility: 'yes', vision: {} }), [], 'guard: non-true values do not enable channels');

  // Invalid maxNonVisionFailures falls back to default (2).
  eq(
    shouldEscalateToVision([fail('api')], { maxNonVisionFailures: 0 }),
    false,
    'guard: maxNonVisionFailures=0 falls back to default (not escalated on 1 failure)',
  );
  // @ts-expect-error — intentionally wrong type
  eq(shouldEscalateToVision([fail('api')], { maxNonVisionFailures: 'x' }), false, 'guard: non-number threshold → default');

  assert(true, 'guard: no inputs threw');
} catch (err) {
  assert(false, `guard: unexpected throw — ${(err as Error)?.message ?? String(err)}`);
}

console.log(`computer-use-channel-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
