// Smoke test for resilientSubscriptionCore — pure, tsx-loadable, deterministic.
// Verifies the generalized agentPresence reconnect/staleness policy:
//   • error/closed/timed-out → reconnect with growing 2^n backoff to a 5min ceiling
//   • subscribed/connecting (healthy / in-progress) → no reconnect
//   • poll model: remaining-wait countdown from lastAttemptMs+nowMs, 0 when elapsed
//   • subscribed-but-silent-past-heartbeat → stale (staleMs); recent → fresh
//   • clock skew (future timestamps) → safe
//   • a degenerate/hostile-input group asserting totality (no throw, bounded, neutral)
// Run: npx tsx scripts/resilient-subscription-core-smoketest.ts
import {
  planReconnect,
  assessSubscriptionHealth,
  normalizeSubscriptionState,
  describeHealth,
  RECONNECT_BASE_DELAY_MS,
  RECONNECT_MAX_BACKOFF_MS,
  DEFAULT_HEARTBEAT_MS,
} from '../src/lib/resilientSubscriptionCore';
import type {
  SubscriptionHealth,
  ReconnectPlan,
  SubscriptionState,
} from '../src/lib/resilientSubscriptionCore';

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
/** Returns fn()'s value; records a failure + returns a sentinel if it throws.
 *  Used by the hostile group to prove totality. */
function noThrow<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    failures++;
    console.error('FAIL: threw (' + label + ') :: ' + String(e));
    return undefined;
  }
}

const BASE = RECONNECT_BASE_DELAY_MS; // 1_000
const CEIL = RECONNECT_MAX_BACKOFF_MS; // 300_000

function main() {
  // ─── 1. constants sanity ──────────────────────────────────────────
  assertEq(RECONNECT_BASE_DELAY_MS, 1_000, 'base delay is 1s');
  assertEq(RECONNECT_MAX_BACKOFF_MS, 300_000, 'ceiling is 5min');
  assertEq(DEFAULT_HEARTBEAT_MS, 30_000, 'default heartbeat is 30s');

  // ─── 2. normalizeSubscriptionState — canonical + raw supabase + variants ──
  assertEq(normalizeSubscriptionState('subscribed'), 'subscribed', 'canonical subscribed');
  assertEq(normalizeSubscriptionState('connecting'), 'connecting', 'canonical connecting');
  assertEq(normalizeSubscriptionState('error'), 'error', 'canonical error');
  assertEq(normalizeSubscriptionState('closed'), 'closed', 'canonical closed');
  assertEq(normalizeSubscriptionState('reconnecting'), 'reconnecting', 'canonical reconnecting');
  // raw Supabase RealtimeSubscribeStates
  assertEq(normalizeSubscriptionState('SUBSCRIBED'), 'subscribed', 'SUBSCRIBED -> subscribed');
  assertEq(normalizeSubscriptionState('CHANNEL_ERROR'), 'error', 'CHANNEL_ERROR -> error');
  assertEq(normalizeSubscriptionState('TIMED_OUT'), 'error', 'TIMED_OUT -> error (reconnect)');
  assertEq(normalizeSubscriptionState('CLOSED'), 'closed', 'CLOSED -> closed');
  assertEq(normalizeSubscriptionState('SUBSCRIBING'), 'connecting', 'SUBSCRIBING -> connecting');
  // separator / casing variants of timed-out (the explicit trigger word)
  assertEq(normalizeSubscriptionState('timed-out'), 'error', 'timed-out -> error');
  assertEq(normalizeSubscriptionState('timed out'), 'error', 'timed out -> error');
  assertEq(normalizeSubscriptionState('  Timed_Out '), 'error', 'padded Timed_Out -> error');
  assertEq(normalizeSubscriptionState('joined'), 'subscribed', 'joined -> subscribed');
  assertEq(normalizeSubscriptionState('joining'), 'connecting', 'joining -> connecting');
  // unknown / non-string → safe-neutral connecting
  assertEq(normalizeSubscriptionState('gibberish'), 'connecting', 'unknown -> connecting');
  assertEq(normalizeSubscriptionState(''), 'connecting', 'empty -> connecting');
  assertEq(normalizeSubscriptionState(null), 'connecting', 'null -> connecting');
  assertEq(normalizeSubscriptionState(undefined), 'connecting', 'undefined -> connecting');
  assertEq(normalizeSubscriptionState(42), 'connecting', 'number -> connecting');

  // ─── 3. planReconnect — healthy / in-progress states DO NOT reconnect ──────
  const healthy = planReconnect({ state: 'subscribed', consecutiveFailures: 0, nowMs: 5_000 });
  assertEq(healthy.shouldReconnect, false, 'subscribed -> no reconnect');
  assertEq(healthy.delayMs, 0, 'subscribed -> delay 0');
  assert(healthy.reason.includes('healthy'), 'subscribed reason mentions healthy', healthy.reason);
  const connecting = planReconnect({ state: 'connecting', consecutiveFailures: 0 });
  assertEq(connecting.shouldReconnect, false, 'connecting -> no reconnect');
  assertEq(connecting.delayMs, 0, 'connecting -> delay 0');
  // Even with a stale failure count, a healthy channel is not reconnected.
  assertEq(
    planReconnect({ state: 'subscribed', consecutiveFailures: 9 }).shouldReconnect,
    false,
    'subscribed w/ prior failures -> still no reconnect (not while healthy)',
  );

  // ─── 4. planReconnect — error → growing 2^n backoff (scheduler model) ──────
  // No lastAttemptMs => full window each time. 1s, 2s, 4s, 8s...
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 1 }).delayMs, 1_000, 'n=1 -> 1s');
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 2 }).delayMs, 2_000, 'n=2 -> 2s');
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 3 }).delayMs, 4_000, 'n=3 -> 4s');
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 4 }).delayMs, 8_000, 'n=4 -> 8s');
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 5 }).delayMs, 16_000, 'n=5 -> 16s');
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 9 }).delayMs, 256_000, 'n=9 -> 256s');
  // n=10: 1000*2^9 = 512_000 -> clamped to the 5min ceiling.
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 10 }).delayMs, CEIL, 'n=10 -> ceiling');
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 11 }).delayMs, CEIL, 'n=11 -> ceiling');
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 50 }).delayMs, CEIL, 'n=50 -> ceiling');
  // n=0 (defensive: error but no counted failure) => first attempt = base.
  assertEq(planReconnect({ state: 'error', consecutiveFailures: 0 }).delayMs, BASE, 'n=0 -> base');
  // Every error-state plan wants to reconnect.
  for (let n = 0; n <= 6; n += 1) {
    assertEq(
      planReconnect({ state: 'error', consecutiveFailures: n }).shouldReconnect,
      true,
      'error n=' + n + ' -> shouldReconnect',
    );
  }

  // ─── 5. monotonic non-decreasing + bounded + finite sweep ─────────────────
  {
    let prev = -1;
    for (let n = 0; n <= 20; n += 1) {
      const d = planReconnect({ state: 'error', consecutiveFailures: n }).delayMs;
      assert(Number.isFinite(d), 'sweep n=' + n + ' finite', String(d));
      assert(d >= 0 && d <= CEIL, 'sweep n=' + n + ' within [0, ceiling]', String(d));
      assert(d >= prev, 'sweep n=' + n + ' non-decreasing', 'prev=' + prev + ' d=' + d);
      prev = d;
    }
    assertEq(prev, CEIL, 'sweep tops out at the ceiling');
  }

  // ─── 6. closed / timed-out / reconnecting also warrant reconnect ──────────
  assertEq(
    planReconnect({ state: 'closed', consecutiveFailures: 2 }).shouldReconnect,
    true,
    'closed -> reconnect (sleep/wake recovery, unlike presence CLOSED=offline)',
  );
  assertEq(planReconnect({ state: 'closed', consecutiveFailures: 2 }).delayMs, 2_000, 'closed n=2 -> 2s');
  // Raw TIMED_OUT normalizes to error and reconnects.
  assertEq(
    planReconnect({ state: 'TIMED_OUT', consecutiveFailures: 3 }).shouldReconnect,
    true,
    'TIMED_OUT -> reconnect',
  );
  assertEq(planReconnect({ state: 'TIMED_OUT', consecutiveFailures: 3 }).delayMs, 4_000, 'TIMED_OUT n=3 -> 4s');
  // reconnecting state keeps the poll model alive (retry pending).
  assertEq(
    planReconnect({ state: 'reconnecting', consecutiveFailures: 4 }).shouldReconnect,
    true,
    'reconnecting -> still reconnecting (poll model)',
  );

  // ─── 7. planReconnect — poll model (lastAttemptMs + nowMs) countdown ──────
  // n=3 => window 4s. Elapsed 1s => 3s remaining.
  const p1 = planReconnect({ state: 'error', consecutiveFailures: 3, lastAttemptMs: 0, nowMs: 1_000 });
  assertEq(p1.shouldReconnect, true, 'poll: error -> shouldReconnect');
  assertEq(p1.delayMs, 3_000, 'poll: 1s into a 4s window -> 3s remaining');
  // Exactly at the window edge => 0 (reconnect now).
  const p2 = planReconnect({ state: 'error', consecutiveFailures: 3, lastAttemptMs: 0, nowMs: 4_000 });
  assertEq(p2.delayMs, 0, 'poll: at window edge -> 0');
  assert(p2.reason.includes('now'), 'poll: edge reason says now', p2.reason);
  // Past the window => 0 (do not go negative).
  const p3 = planReconnect({ state: 'error', consecutiveFailures: 3, lastAttemptMs: 0, nowMs: 9_999 });
  assertEq(p3.delayMs, 0, 'poll: past window -> 0 (never negative)');
  // Partway => remaining strictly between 0 and window.
  const p4 = planReconnect({ state: 'error', consecutiveFailures: 4, lastAttemptMs: 1_000, nowMs: 4_000 });
  // window 8s, elapsed 3s => 5s remaining.
  assertEq(p4.delayMs, 5_000, 'poll: 3s into an 8s window -> 5s remaining');

  // ─── 8. planReconnect — clock skew (future lastAttempt) is safe ───────────
  // now < lastAttempt => negative elapsed; remaining is capped at the full window.
  const skew = planReconnect({ state: 'error', consecutiveFailures: 3, lastAttemptMs: 10_000, nowMs: 1_000 });
  assertEq(skew.delayMs, 4_000, 'skew: future lastAttempt -> capped at full window');
  assert(skew.delayMs >= 0 && skew.delayMs <= CEIL, 'skew delay bounded', String(skew.delayMs));

  // ─── 9. planReconnect — maxBackoffMs override ─────────────────────────────
  // A smaller custom ceiling bites before the 2^n growth.
  assertEq(
    planReconnect({ state: 'error', consecutiveFailures: 8, maxBackoffMs: 5_000 }).delayMs,
    5_000,
    'custom small ceiling clamps (2^7*1k=128k -> 5k)',
  );
  assertEq(
    planReconnect({ state: 'error', consecutiveFailures: 2, maxBackoffMs: 5_000 }).delayMs,
    2_000,
    'custom ceiling above value -> value preserved',
  );
  // maxBackoffMs 0 => cooldown off (reconnect immediately).
  assertEq(
    planReconnect({ state: 'error', consecutiveFailures: 5, maxBackoffMs: 0 }).delayMs,
    0,
    'ceiling 0 -> delay 0 (immediate)',
  );
  // Huge override still finite & bounded by the poll math, never explodes.
  const bigCeil = planReconnect({ state: 'error', consecutiveFailures: 40, maxBackoffMs: 10_000_000 });
  assert(Number.isFinite(bigCeil.delayMs) && bigCeil.delayMs >= 0, 'huge ceiling still finite/bounded', String(bigCeil.delayMs));

  // ─── 10. planReconnect — reason strings carry attempt + timing ────────────
  const r1 = planReconnect({ state: 'error', consecutiveFailures: 3 });
  assert(r1.reason.includes('attempt 3'), 'reason includes attempt number', r1.reason);
  assert(r1.reason.includes('channel error'), 'reason names the state', r1.reason);
  assert(r1.reason.includes('retry in'), 'scheduler reason says retry in', r1.reason);
  const r0 = planReconnect({ state: 'error', consecutiveFailures: 0 });
  assert(r0.reason.includes('attempt 1'), 'n=0 reason still says attempt 1', r0.reason);

  // ─── 11. assessSubscriptionHealth — subscribed + recent event = fresh ─────
  const fresh = assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 1_000, nowMs: 1_000 + 10_000 });
  assertEq(fresh.state, 'subscribed', 'fresh: state subscribed');
  assertEq(fresh.staleMs, null, 'fresh: 10s < 30s heartbeat -> not stale');
  assertEq(fresh.lastEventMs, 1_000, 'fresh: lastEventMs passthrough');
  // Exactly at the heartbeat boundary is NOT stale (strict >).
  const edge = assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 0, nowMs: 30_000 });
  assertEq(edge.staleMs, null, 'exactly at 30s heartbeat edge -> not stale');

  // ─── 12. assessSubscriptionHealth — subscribed but SILENT = stale ─────────
  // The silent-staleness case: looks live, but no event past the heartbeat window.
  const stale = assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 0, nowMs: 45_000 });
  assertEq(stale.state, 'subscribed', 'stale: state still reports subscribed');
  assertEq(stale.staleMs, 45_000, 'stale: 45s silence -> staleMs = full gap');
  assert(stale.staleMs != null, 'stale: staleMs non-null IS the stale flag');
  const stale2 = assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 0, nowMs: 30_001 });
  assertEq(stale2.staleMs, 30_001, 'just past heartbeat -> stale by 1ms over');
  // Custom heartbeat window.
  const customHb = assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 0, nowMs: 6_000, heartbeatMs: 5_000 });
  assertEq(customHb.staleMs, 6_000, 'custom 5s heartbeat: 6s silence -> stale');
  const customHbFresh = assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 0, nowMs: 4_000, heartbeatMs: 5_000 });
  assertEq(customHbFresh.staleMs, null, 'custom 5s heartbeat: 4s silence -> fresh');

  // ─── 13. assessSubscriptionHealth — non-subscribed never flags stale ──────
  for (const st of ['connecting', 'error', 'closed', 'reconnecting'] as SubscriptionState[]) {
    const h = assessSubscriptionHealth({ state: st, lastEventMs: 0, nowMs: 999_999 });
    assertEq(h.staleMs, null, st + ' + long silence -> staleMs null (redundant vs its own state)');
    assertEq(h.state, st, st + ' state preserved');
  }
  // consecutiveFailures passthrough (bounded).
  assertEq(
    assessSubscriptionHealth({ state: 'error', consecutiveFailures: 7 }).consecutiveFailures,
    7,
    'consecutiveFailures passthrough',
  );
  assertEq(
    assessSubscriptionHealth({ state: 'error', consecutiveFailures: -3 }).consecutiveFailures,
    0,
    'negative failures -> clamped to 0',
  );
  assertEq(
    assessSubscriptionHealth({ state: 'error', consecutiveFailures: 1e9 }).consecutiveFailures,
    1024,
    'huge failures -> clamped to MAX_FAILURE_EXPONENT',
  );

  // ─── 14. assessSubscriptionHealth — skew / unmeasurable timing = safe ─────
  // Future lastEvent (now < lastEvent) -> negative gap -> cannot be stale.
  const skewH = assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 100_000, nowMs: 1_000 });
  assertEq(skewH.staleMs, null, 'skew: future lastEvent -> not stale');
  // Missing timing -> not measurable -> staleMs null, lastEventMs null.
  const noTiming = assessSubscriptionHealth({ state: 'subscribed' });
  assertEq(noTiming.staleMs, null, 'no timing -> staleMs null');
  assertEq(noTiming.lastEventMs, null, 'no lastEvent -> lastEventMs null');
  assertEq(assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 5 }).staleMs, null, 'lastEvent but no now -> null');

  // ─── 15. describeHealth — the shared live/reconnecting/stale strip copy ────
  assertEq(describeHealth(fresh), 'live', 'describe fresh subscribed -> live');
  assert(describeHealth(stale).startsWith('stale ('), 'describe stale -> stale (…)', describeHealth(stale));
  assert(describeHealth(stale).includes('ago'), 'describe stale -> mentions ago', describeHealth(stale));
  assertEq(describeHealth(assessSubscriptionHealth({ state: 'reconnecting' })), 'reconnecting…', 'describe reconnecting');
  assertEq(describeHealth(assessSubscriptionHealth({ state: 'closed' })), 'offline', 'describe closed -> offline');
  assertEq(describeHealth(assessSubscriptionHealth({ state: 'error' })), 'connection error', 'describe error');
  assertEq(describeHealth(assessSubscriptionHealth({ state: 'connecting' })), 'connecting…', 'describe connecting');

  // ─── 16. end-to-end scenario: sleep/wake drop then recovery ───────────────
  // Channel was subscribed, laptop slept, no events for 5 min, then socket CLOSED.
  const slept = assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 0, nowMs: 300_000 });
  assert(slept.staleMs != null, 'sleep: 5min silence flagged stale (not a frozen live board)');
  // Socket then reports CLOSED -> we plan a reconnect (presence would have gone
  // 'offline' and stopped; this core recovers).
  const wake1 = planReconnect({ state: 'closed', consecutiveFailures: 1, lastAttemptMs: 300_000, nowMs: 300_000 });
  assertEq(wake1.shouldReconnect, true, 'wake: closed -> reconnect planned');
  assertEq(wake1.delayMs, 1_000, 'wake: first retry after 1s');
  // First retry also fails -> back off to 2s; poll a bit later still counts down.
  const wake2 = planReconnect({ state: 'error', consecutiveFailures: 2, lastAttemptMs: 301_000, nowMs: 301_500 });
  assertEq(wake2.delayMs, 1_500, 'wake: 0.5s into the 2s second-attempt window -> 1.5s left');

  // ─── 17. degenerate / hostile input — MUST NOT THROW, bounded, neutral ────
  const throwingState = {
    get state(): string {
      throw new Error('boom-state');
    },
    consecutiveFailures: 1,
  };
  const cyclic: Record<string, unknown> = { state: 'error', consecutiveFailures: 1 };
  cyclic.self = cyclic;

  const hostilePlan: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'nope'],
    ['number', 7],
    ['array', []],
    ['empty obj', {}],
    ['bool', true],
    ['fn', () => 0],
    ['bad state type', { state: 123, consecutiveFailures: 1 }],
    ['NaN failures', { state: 'error', consecutiveFailures: NaN }],
    ['Inf failures', { state: 'error', consecutiveFailures: Infinity }],
    ['-Inf failures', { state: 'error', consecutiveFailures: -Infinity }],
    ['string failures', { state: 'error', consecutiveFailures: '3' }],
    ['obj failures', { state: 'error', consecutiveFailures: {} }],
    ['NaN now/last', { state: 'error', consecutiveFailures: 2, nowMs: NaN, lastAttemptMs: NaN }],
    ['Inf now', { state: 'error', consecutiveFailures: 2, nowMs: Infinity, lastAttemptMs: 0 }],
    ['string now', { state: 'error', consecutiveFailures: 2, nowMs: 'x', lastAttemptMs: 0 }],
    ['bad maxBackoff', { state: 'error', consecutiveFailures: 2, maxBackoffMs: 'huge' as unknown as number }],
    ['neg maxBackoff', { state: 'error', consecutiveFailures: 2, maxBackoffMs: -5 }],
    ['NaN maxBackoff', { state: 'error', consecutiveFailures: 2, maxBackoffMs: NaN }],
    ['bigint failures', { state: 'error', consecutiveFailures: 3n as unknown }],
    ['throwing getter', throwingState],
    ['cyclic', cyclic],
  ];
  for (const [label, input] of hostilePlan) {
    const p = noThrow('plan ' + label, () => planReconnect(input as Parameters<typeof planReconnect>[0]));
    assert(p != null, 'plan(' + label + ') returned', label);
    if (p) {
      assert(typeof p.shouldReconnect === 'boolean', 'plan(' + label + ') bool', String(p.shouldReconnect));
      assert(
        typeof p.delayMs === 'number' && Number.isFinite(p.delayMs) && p.delayMs >= 0,
        'plan(' + label + ') delay finite >=0',
        String(p.delayMs),
      );
      assert(typeof p.reason === 'string' && p.reason.length > 0, 'plan(' + label + ') reason string', p.reason);
    }
  }
  // Specific neutral expectations.
  assertEq(planReconnect(null as never).shouldReconnect, false, 'plan(null) -> no reconnect');
  assertEq(planReconnect(undefined as never).shouldReconnect, false, 'plan(undefined) -> no reconnect');
  assertEq(planReconnect('x' as never).shouldReconnect, false, 'plan(string) -> no reconnect');
  assertEq(planReconnect(throwingState as never).shouldReconnect, false, 'plan(throwing getter) -> caught, false');
  // Non-negative delay guaranteed even for the -Inf failure case.
  assert(planReconnect({ state: 'error', consecutiveFailures: -Infinity }).delayMs >= 0, '-Inf failures -> delay >=0');

  const throwingAssess = {
    get state(): string {
      throw new Error('boom-assess');
    },
  };
  const hostileAssess: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'nope'],
    ['number', 7],
    ['array', []],
    ['empty obj', {}],
    ['bad state', { state: 999 }],
    ['NaN times', { state: 'subscribed', lastEventMs: NaN, nowMs: NaN }],
    ['Inf now', { state: 'subscribed', lastEventMs: 0, nowMs: Infinity }],
    ['string times', { state: 'subscribed', lastEventMs: 'a', nowMs: 'b' }],
    ['neg heartbeat', { state: 'subscribed', lastEventMs: 0, nowMs: 100_000, heartbeatMs: -1 }],
    ['NaN heartbeat', { state: 'subscribed', lastEventMs: 0, nowMs: 100_000, heartbeatMs: NaN }],
    ['bigint fields', { state: 'subscribed', lastEventMs: 0n as unknown, nowMs: 5n as unknown }],
    ['throwing getter', throwingAssess],
  ];
  for (const [label, input] of hostileAssess) {
    const h = noThrow('assess ' + label, () =>
      assessSubscriptionHealth(input as Parameters<typeof assessSubscriptionHealth>[0]),
    );
    assert(h != null, 'assess(' + label + ') returned', label);
    if (h) {
      const okState =
        h.state === 'connecting' ||
        h.state === 'subscribed' ||
        h.state === 'error' ||
        h.state === 'closed' ||
        h.state === 'reconnecting';
      assert(okState, 'assess(' + label + ') valid state', String(h.state));
      assert(
        typeof h.consecutiveFailures === 'number' &&
          Number.isFinite(h.consecutiveFailures) &&
          h.consecutiveFailures >= 0,
        'assess(' + label + ') failures finite >=0',
        String(h.consecutiveFailures),
      );
      assert(h.lastEventMs === null || Number.isFinite(h.lastEventMs), 'assess(' + label + ') lastEventMs null|finite', String(h.lastEventMs));
      assert(h.staleMs === null || Number.isFinite(h.staleMs), 'assess(' + label + ') staleMs null|finite', String(h.staleMs));
    }
  }
  // Neg heartbeat falls back to the 30s default -> 100s silence IS stale.
  assertEq(
    assessSubscriptionHealth({ state: 'subscribed', lastEventMs: 0, nowMs: 100_000, heartbeatMs: -1 }).staleMs,
    100_000,
    'neg heartbeat -> default 30s -> 100s stale',
  );

  // describeHealth totality on hand-built / hostile health objects.
  const hostileDescribe: unknown[] = [
    null,
    undefined,
    {},
    { state: 'bogus', staleMs: 'x' },
    { state: 123, staleMs: NaN },
    { state: 'subscribed', staleMs: 5_000 },
    { state: 'subscribed', staleMs: Infinity },
  ];
  for (const hd of hostileDescribe) {
    const s = noThrow('describe ' + JSON.stringify(hd), () => describeHealth(hd as SubscriptionHealth));
    assert(typeof s === 'string' && (s as string).length > 0, 'describe -> non-empty string', String(s));
  }

  // Type-shape sanity (compile-time coverage of the exported interfaces).
  const planShape: ReconnectPlan = planReconnect({ state: 'error', consecutiveFailures: 1 });
  const healthShape: SubscriptionHealth = assessSubscriptionHealth({ state: 'subscribed' });
  assert(typeof planShape.shouldReconnect === 'boolean', 'ReconnectPlan shape ok');
  assert(typeof healthShape.state === 'string', 'SubscriptionHealth shape ok');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll resilientSubscriptionCore smoke cases passed (' + passes + ' passed).');
}
main();
