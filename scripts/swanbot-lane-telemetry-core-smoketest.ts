// Smoke test for swanbotLaneTelemetryCore — pure, tsx-loadable, deterministic.
// Run: npx tsx scripts/swanbot-lane-telemetry-core-smoketest.ts
import {
  classifyLaneTerminal,
  CHAT_LANES,
  LANE_OUTCOMES,
  type LaneTerminal,
  type ChatLane,
  type LaneOutcome,
} from '../src/lib/swanbotLaneTelemetryCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq<T>(a: T, b: T, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Assert a full LaneTerminal shape in one call (3 assertions).
function assertTerminal(
  t: LaneTerminal,
  lane: ChatLane,
  outcome: LaneOutcome,
  fellBack: boolean,
  label: string,
) {
  assertEq(t.lane, lane, label + ' .lane');
  assertEq(t.outcome, outcome, label + ' .outcome');
  assertEq(t.fellBack, fellBack, label + ' .fellBack');
}

// Every result must be enum-only + shaped (used by the hostile group).
function assertWellFormed(t: any, label: string) {
  assert(!!t && typeof t === 'object', label + ' is object');
  assert((CHAT_LANES as readonly string[]).indexOf(t.lane) >= 0, label + ' lane in CHAT_LANES', String(t && t.lane));
  assert((LANE_OUTCOMES as readonly string[]).indexOf(t.outcome) >= 0, label + ' outcome in LANE_OUTCOMES', String(t && t.outcome));
  assert(typeof t.fellBack === 'boolean', label + ' fellBack is boolean');
}

function main() {
  // ── 1) v2 lane terminals (the clean-serve + config-error exits) ─────────────
  assertTerminal(
    classifyLaneTerminal({ lane: 'v2', hasResponse: true }),
    'v2', 'served_ok', false, '1a v2 response',
  );
  assertTerminal(
    classifyLaneTerminal({ lane: 'v2', bodyError: true }),
    'v2', 'body_error', false, '1b v2 config body error',
  );
  // v2 attempted with neither text nor body (transport) but explicitly tagged v2
  // and NOT marked as fallen back → transport_null on the v2 lane tag.
  assertTerminal(
    classifyLaneTerminal({ lane: 'v2' }),
    'v2', 'transport_null', false, '1c v2 bare transport',
  );
  // hasResponse wins over a stray bodyError (a served answer is terminal).
  assertTerminal(
    classifyLaneTerminal({ lane: 'v2', hasResponse: true, bodyError: true }),
    'v2', 'served_ok', false, '1d v2 response beats bodyError',
  );

  // ── 2) clean v1 lane (v2 disabled via /v2 off — no fallback) ────────────────
  assertTerminal(
    classifyLaneTerminal({ lane: 'v1', hasResponse: true }),
    'v1', 'served_ok', false, '2a clean v1 serve',
  );
  assertTerminal(
    classifyLaneTerminal({ lane: 'v1', bodyError: true }),
    'v1', 'body_error', false, '2b clean v1 body error',
  );
  assertTerminal(
    classifyLaneTerminal({ lane: 'v1', threw: true }),
    'v1', 'threw', false, '2c clean v1 threw',
  );
  assertTerminal(
    classifyLaneTerminal({ lane: 'v1' }),
    'v1', 'transport_null', false, '2d clean v1 transport null',
  );

  // ── 3) v2 -> v1 fallback (the SILENT path M5 needs measured) ────────────────
  // v2 null/threw, then v1 served → fell_back_to_v1, fellBack TRUE, lane pinned v1.
  assertTerminal(
    classifyLaneTerminal({ lane: 'v1', hasResponse: true, usedV1AfterV2: true }),
    'v1', 'fell_back_to_v1', true, '3a fell back then served',
  );
  // fellBack is orthogonal to outcome: v1 can still body_error / threw / null.
  assertTerminal(
    classifyLaneTerminal({ lane: 'v1', bodyError: true, usedV1AfterV2: true }),
    'v1', 'body_error', true, '3b fell back then v1 body error',
  );
  assertTerminal(
    classifyLaneTerminal({ lane: 'v1', threw: true, usedV1AfterV2: true }),
    'v1', 'threw', true, '3c fell back then v1 threw',
  );
  assertTerminal(
    classifyLaneTerminal({ usedV1AfterV2: true }),
    'v1', 'transport_null', true, '3d fell back then v1 transport null',
  );
  // Fallback PINS the lane to v1 even if a stale v2 tag rides along.
  assertTerminal(
    classifyLaneTerminal({ lane: 'v2', hasResponse: true, usedV1AfterV2: true }),
    'v1', 'fell_back_to_v1', true, '3e fallback overrides stale v2 tag',
  );
  // Distinguishing telemetry: a clean serve vs a fallback serve differ in BOTH
  // outcome and fellBack — the exact signal M5 reads.
  const clean = classifyLaneTerminal({ lane: 'v2', hasResponse: true });
  const fb = classifyLaneTerminal({ lane: 'v1', hasResponse: true, usedV1AfterV2: true });
  assert(clean.outcome !== fb.outcome, '3f clean vs fallback outcomes differ');
  assert(clean.fellBack !== fb.fellBack, '3g clean vs fallback fellBack differ');

  // ── 4) strict-local block (pre-v1-invoke gate) ──────────────────────────────
  assertTerminal(
    classifyLaneTerminal({ blocked: true }),
    'none', 'blocked', false, '4a blocked',
  );
  // Block wins over everything downstream, and clears fellBack (v1 never ran).
  assertTerminal(
    classifyLaneTerminal({ blocked: true, hasResponse: true, lane: 'v2', usedV1AfterV2: true }),
    'none', 'blocked', false, '4b blocked beats response + clears fellBack',
  );

  // ── 5) no auth (missing access token, pre-v1-invoke) ────────────────────────
  assertTerminal(
    classifyLaneTerminal({ authed: false }),
    'none', 'no_auth', false, '5a no auth',
  );
  // no_auth requires the LITERAL false; other falsy values are not "unauthed".
  assertTerminal(
    classifyLaneTerminal({ authed: 0 as unknown }),
    'none', 'transport_null', false, '5b authed:0 is not no_auth',
  );
  assertTerminal(
    classifyLaneTerminal({ authed: null as unknown }),
    'none', 'transport_null', false, '5c authed:null is not no_auth',
  );
  // authed omitted (v2 serve path never checks v1 auth) must NOT be no_auth.
  assertTerminal(
    classifyLaneTerminal({ lane: 'v2', hasResponse: true }),
    'v2', 'served_ok', false, '5d authed omitted still serves',
  );
  // authed:true present alongside a serve is fine.
  assertTerminal(
    classifyLaneTerminal({ lane: 'v1', hasResponse: true, authed: true }),
    'v1', 'served_ok', false, '5e authed:true serve',
  );
  // Block precedes no_auth when both set (deterministic precedence).
  assertTerminal(
    classifyLaneTerminal({ blocked: true, authed: false }),
    'none', 'blocked', false, '5f blocked precedes no_auth',
  );

  // ── 6) lane sanitization + honest 'none' for unattributed ───────────────────
  assertEq(classifyLaneTerminal({ lane: 'v2', hasResponse: true }).lane, 'v2', '6a v2 tag honored');
  assertEq(classifyLaneTerminal({ lane: 'v1', hasResponse: true }).lane, 'v1', '6b v1 tag honored');
  assertEq(classifyLaneTerminal({ lane: 'none', hasResponse: true }).lane, 'none', '6c none tag honored');
  // Unknown/garbage lane tags collapse to 'none' (no biased guess).
  assertEq(classifyLaneTerminal({ lane: 'V2', hasResponse: true }).lane, 'none', '6d wrong-case lane -> none');
  assertEq(classifyLaneTerminal({ lane: 'v3', hasResponse: true }).lane, 'none', '6e unknown lane -> none');
  assertEq(classifyLaneTerminal({ lane: 42 as unknown, hasResponse: true }).lane, 'none', '6f numeric lane -> none');
  assertEq(classifyLaneTerminal({ hasResponse: true }).lane, 'none', '6g served but unattributed -> none');
  // Outcome is still correct even when the lane is unattributed.
  assertEq(classifyLaneTerminal({ hasResponse: true }).outcome, 'served_ok', '6h unattributed serve outcome');

  // ── 7) strict-truthiness of flags (only literal true counts) ────────────────
  assertEq(classifyLaneTerminal({ blocked: 'true' as unknown }).outcome, 'transport_null', '7a blocked:"true" not honored');
  assertEq(classifyLaneTerminal({ blocked: 1 as unknown }).outcome, 'transport_null', '7b blocked:1 not honored');
  assertEq(classifyLaneTerminal({ threw: 1 as unknown }).outcome, 'transport_null', '7c threw:1 not honored');
  assertEq(classifyLaneTerminal({ hasResponse: 'yes' as unknown }).outcome, 'transport_null', '7d hasResponse:"yes" not honored');
  assertEq(classifyLaneTerminal({ hasResponse: 1 as unknown }).outcome, 'transport_null', '7e hasResponse:1 not honored');
  assertEq(classifyLaneTerminal({ bodyError: {} as unknown }).outcome, 'transport_null', '7f bodyError:{} not honored');
  assertEq(classifyLaneTerminal({ usedV1AfterV2: 'x' as unknown }).fellBack, false, '7g usedV1AfterV2:"x" not fellBack');
  assertEq(classifyLaneTerminal({ lane: 'v1', hasResponse: true, usedV1AfterV2: 1 as unknown }).outcome, 'served_ok', '7h fellBack strict → served_ok not fell_back');

  // ── 8) outcome-precedence ordering (threw > response > body > transport) ─────
  assertEq(classifyLaneTerminal({ lane: 'v1', threw: true, hasResponse: true }).outcome, 'threw', '8a threw beats response');
  assertEq(classifyLaneTerminal({ lane: 'v1', threw: true, bodyError: true }).outcome, 'threw', '8b threw beats bodyError');
  assertEq(classifyLaneTerminal({ lane: 'v1', hasResponse: true, bodyError: true }).outcome, 'served_ok', '8c response beats bodyError');
  assertEq(classifyLaneTerminal({ lane: 'v1', bodyError: true }).outcome, 'body_error', '8d bodyError beats transport');

  // ── 9) full-matrix well-formedness sweep (every combination stays enum-only) ─
  const flagKeys = ['hasResponse', 'bodyError', 'threw', 'blocked', 'usedV1AfterV2'] as const;
  const laneTags: unknown[] = ['v2', 'v1', 'none', 'garbage', undefined];
  let sweep = 0;
  for (let mask = 0; mask < (1 << flagKeys.length); mask++) {
    for (const tag of laneTags) {
      const inp: any = { lane: tag };
      for (let b = 0; b < flagKeys.length; b++) {
        if (mask & (1 << b)) inp[flagKeys[b]] = true;
      }
      // authed toggled by the low bit of the mask to exercise the no_auth gate.
      if (mask & 1) inp.authed = false;
      const out = classifyLaneTerminal(inp);
      assertWellFormed(out, 'sweep#' + sweep);
      // Invariant: fell_back_to_v1 implies fellBack && lane === 'v1'.
      if (out.outcome === 'fell_back_to_v1') {
        assert(out.fellBack === true && out.lane === 'v1', 'sweep#' + sweep + ' fell_back invariant');
      }
      // Invariant: blocked/no_auth ⇒ lane none && !fellBack.
      if (out.outcome === 'blocked' || out.outcome === 'no_auth') {
        assert(out.lane === 'none' && out.fellBack === false, 'sweep#' + sweep + ' gate invariant');
      }
      sweep++;
    }
  }
  assert(sweep === (1 << flagKeys.length) * laneTags.length, '9a sweep count', String(sweep));

  // ── 10) hostile / degenerate inputs — MUST NOT THROW ────────────────────────
  const cyclic: any = { lane: 'v2', hasResponse: true };
  cyclic.self = cyclic;
  const hostile: unknown[] = [
    null,
    undefined,
    0,
    1,
    NaN,
    '',
    'v2',
    true,
    false,
    [],
    ['v2'],
    {},
    cyclic,
    () => 'v2',
    Symbol('x'),
    123n,
    { lane: {}, hasResponse: [], bodyError: () => {}, threw: 'no', authed: 'nope', blocked: 0, usedV1AfterV2: null },
    { lane: 'v1', hasResponse: Object.create(null) },
    Object.create(null),
    new Map([['lane', 'v2']]),
  ];
  for (let i = 0; i < hostile.length; i++) {
    let out: LaneTerminal | null = null;
    let threw = false;
    try {
      out = classifyLaneTerminal(hostile[i] as any);
    } catch (e) {
      threw = true;
    }
    assert(!threw, '10.' + i + ' hostile input did not throw');
    assertWellFormed(out, '10.' + i + ' hostile result');
  }
  // Specific neutral defaults for the two most common degenerate calls.
  assertTerminal(classifyLaneTerminal(null as any), 'none', 'transport_null', false, '10null neutral');
  assertTerminal(classifyLaneTerminal(undefined as any), 'none', 'transport_null', false, '10undef neutral');
  assertTerminal(classifyLaneTerminal([] as any), 'none', 'transport_null', false, '10array neutral');
  assertTerminal(classifyLaneTerminal('v2' as any), 'none', 'transport_null', false, '10string neutral');

  // ── 11) frozen catalog exports are complete + immutable ─────────────────────
  assertEq(CHAT_LANES.length, 3, '11a CHAT_LANES length');
  assertEq(LANE_OUTCOMES.length, 7, '11b LANE_OUTCOMES length');
  assert(Object.isFrozen(CHAT_LANES), '11c CHAT_LANES frozen');
  assert(Object.isFrozen(LANE_OUTCOMES), '11d LANE_OUTCOMES frozen');
  // Every catalog member is reachable as a real classifier output.
  assert((CHAT_LANES as readonly string[]).indexOf(clean.lane) >= 0, '11e output lane catalogued');
  assert((LANE_OUTCOMES as readonly string[]).indexOf(fb.outcome) >= 0, '11f output outcome catalogued');
}

main();
if (failures > 0) {
  console.error('\n' + failures + ' fail');
  process.exit(1);
}
console.log('\nAll swanbotLaneTelemetryCore smoke cases passed (' + passes + ' passed).');
