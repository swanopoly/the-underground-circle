/**
 * stream-health-core-smoketest — pins the pure byte-truth transport state
 * machine (src/lib/streamHealthCore.ts) that lets the pending chat bubble tell
 * the truth during an unbounded wait instead of rotating "pondering…" over a
 * connection that silently hung after the SSE handshake. Load-bearing behavior:
 *
 *   MACHINE: init → 'opening'; handshake → 'waiting_first_token' (stamps the
 *   idle clock, clears sawFirstToken); first byte → 'streaming' (sets
 *   sawFirstToken); subsequent bytes re-stamp lastByteAtMs and are the recovery
 *   edge back from slow/stalled.
 *
 *   BUDGETS: after the first token an idle gap of 20s → 'slow', 60s → 'stalled'.
 *   BEFORE the first token the TTFT budget is generous — 20s is still
 *   'waiting_first_token', 'slow' only at 40s and 'stalled' at 80s.
 *
 *   MEASUREMENT: idle_tick with no usable reference (still 'opening', or a
 *   non-finite clock) leaves the state untouched — no invented stall; a byte
 *   with a bad clock drops the reference (fail-safe optimistic).
 *
 *   TOTALITY: every export survives null / undefined / wrong types / a Proxy
 *   with throwing getters / huge & non-finite numbers without throwing, and
 *   describeStreamHealth always returns a non-empty in-vocabulary sentence.
 *
 * Pure — loads under tsx (streamHealthCore has zero imports).
 * Run: npx tsx scripts/stream-health-core-smoketest.ts
 */

import {
  STREAM_SLOW_MS,
  STREAM_STALLED_MS,
  STREAM_TTFT_SLOW_MS,
  initStreamHealth,
  advanceStreamHealth,
  describeStreamHealth,
  type StreamHealth,
  type StreamHealthState,
} from '../src/lib/streamHealthCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes += 1;
  else {
    failures += 1;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

// Small helpers -------------------------------------------------------------
function noThrow(fn: () => unknown, m: string): unknown {
  try {
    const v = fn();
    passes += 1;
    return v;
  } catch (err) {
    failures += 1;
    console.error('FAIL: ' + m + ' :: threw ' + String(err));
    return undefined;
  }
}
function isValidState(s: unknown): s is StreamHealthState {
  if (!s || typeof s !== 'object') return false;
  const o = s as Record<string, unknown>;
  const healthOk =
    o.health === 'opening' ||
    o.health === 'waiting_first_token' ||
    o.health === 'streaming' ||
    o.health === 'slow' ||
    o.health === 'stalled';
  const sawOk = o.sawFirstToken === true || o.sawFirstToken === false;
  const byteOk = o.lastByteAtMs === null || (typeof o.lastByteAtMs === 'number' && Number.isFinite(o.lastByteAtMs));
  return healthOk && sawOk && byteOk;
}
const T0 = 1_000_000; // arbitrary fixed epoch-ms base (kept deterministic)

function main(): void {
  // ─── (1) Constants: values + ordering + generosity ────────────────────────
  assertEq(STREAM_SLOW_MS, 20_000, '(1) STREAM_SLOW_MS is 20s');
  assertEq(STREAM_STALLED_MS, 60_000, '(1) STREAM_STALLED_MS is 60s');
  assertEq(STREAM_TTFT_SLOW_MS, 40_000, '(1) STREAM_TTFT_SLOW_MS is 40s');
  assert(STREAM_SLOW_MS < STREAM_STALLED_MS, '(1) slow < stalled');
  assert(STREAM_TTFT_SLOW_MS > STREAM_SLOW_MS, '(1) TTFT slow is more generous than inter-token slow');
  assert(STREAM_TTFT_SLOW_MS <= STREAM_STALLED_MS, '(1) TTFT slow still under post-token stalled');
  assert(
    [STREAM_SLOW_MS, STREAM_STALLED_MS, STREAM_TTFT_SLOW_MS].every((n) => Number.isInteger(n) && n > 0),
    '(1) all budgets are positive integers',
  );

  // ─── (2) initStreamHealth shape + freshness ───────────────────────────────
  const init = initStreamHealth();
  assertEq(init.health, 'opening', '(2) init health opening');
  assertEq(init.sawFirstToken, false, '(2) init sawFirstToken false');
  assertEq(init.lastByteAtMs, null, '(2) init lastByteAtMs null');
  assert(initStreamHealth() !== initStreamHealth(), '(2) init returns a fresh object each call');
  assert(isValidState(init), '(2) init is a valid state');

  // ─── (3) handshake → waiting_first_token, stamps the idle clock ───────────
  const hs = advanceStreamHealth(init, { kind: 'handshake', nowMs: T0 });
  assertEq(hs.health, 'waiting_first_token', '(3) handshake → waiting_first_token');
  assertEq(hs.sawFirstToken, false, '(3) handshake keeps sawFirstToken false');
  assertEq(hs.lastByteAtMs, T0, '(3) handshake stamps lastByteAtMs = nowMs');
  assertEq(describeStreamHealth(hs.health), 'Thinking…', '(3) waiting copy is Thinking…');
  // handshake (re)opens: it clears a previously-seen first token
  const reHs = advanceStreamHealth(
    { health: 'streaming', sawFirstToken: true, lastByteAtMs: T0 },
    { kind: 'handshake', nowMs: T0 + 5 },
  );
  assertEq(reHs.health, 'waiting_first_token', '(3) re-handshake resets to waiting_first_token');
  assertEq(reHs.sawFirstToken, false, '(3) re-handshake clears sawFirstToken');

  // ─── (4) first byte → streaming, sets sawFirstToken ───────────────────────
  const b1 = advanceStreamHealth(hs, { kind: 'byte', nowMs: T0 + 500 });
  assertEq(b1.health, 'streaming', '(4) first byte → streaming');
  assertEq(b1.sawFirstToken, true, '(4) first byte sets sawFirstToken');
  assertEq(b1.lastByteAtMs, T0 + 500, '(4) first byte stamps lastByteAtMs');
  assertEq(describeStreamHealth(b1.health), 'Writing…', '(4) streaming copy is Writing…');
  // a byte straight from init (no handshake) still means streaming (robust)
  const bDirect = advanceStreamHealth(init, { kind: 'byte', nowMs: T0 + 1 });
  assertEq(bDirect.health, 'streaming', '(4) byte from init → streaming');
  assertEq(bDirect.sawFirstToken, true, '(4) byte from init sets sawFirstToken');

  // ─── (5) subsequent bytes re-stamp; byte is the recovery edge ─────────────
  const b2 = advanceStreamHealth(b1, { kind: 'byte', nowMs: T0 + 600 });
  assertEq(b2.health, 'streaming', '(5) subsequent byte stays streaming');
  assertEq(b2.lastByteAtMs, T0 + 600, '(5) subsequent byte re-stamps lastByteAtMs');
  assertEq(b2.sawFirstToken, true, '(5) subsequent byte keeps sawFirstToken');
  const fromSlow = advanceStreamHealth(
    { health: 'slow', sawFirstToken: true, lastByteAtMs: T0 },
    { kind: 'byte', nowMs: T0 + 99 },
  );
  assertEq(fromSlow.health, 'streaming', '(5) byte recovers from slow → streaming');
  const fromStalled = advanceStreamHealth(
    { health: 'stalled', sawFirstToken: true, lastByteAtMs: T0 },
    { kind: 'byte', nowMs: T0 + 99 },
  );
  assertEq(fromStalled.health, 'streaming', '(5) byte recovers from stalled → streaming');

  // ─── (6) idle_tick AFTER first token: slow at 20s, stalled at 60s ─────────
  const streaming = advanceStreamHealth(hs, { kind: 'byte', nowMs: T0 }); // lastByteAtMs = T0, sawFirstToken
  const idle = (ms: number) => advanceStreamHealth(streaming, { kind: 'idle_tick', nowMs: T0 + ms });
  assertEq(idle(0).health, 'streaming', '(6) idle 0 → streaming');
  assertEq(idle(STREAM_SLOW_MS - 1).health, 'streaming', '(6) idle 19.999s → still streaming');
  assertEq(idle(STREAM_SLOW_MS).health, 'slow', '(6) idle 20s → slow');
  assertEq(idle(STREAM_STALLED_MS - 1).health, 'slow', '(6) idle 59.999s → slow');
  assertEq(idle(STREAM_STALLED_MS).health, 'stalled', '(6) idle 60s → stalled');
  assertEq(idle(STREAM_STALLED_MS * 3).health, 'stalled', '(6) idle 180s → still stalled');
  assertEq(describeStreamHealth(idle(STREAM_SLOW_MS).health), 'Still working…', '(6) slow copy is Still working…');
  assertEq(
    describeStreamHealth(idle(STREAM_STALLED_MS).health),
    'Connection seems stalled — say "continue" to retry',
    '(6) stalled copy offers a retry',
  );
  // idle_tick must not re-stamp the clock or flip sawFirstToken
  const idled = idle(STREAM_SLOW_MS);
  assertEq(idled.lastByteAtMs, T0, '(6) idle_tick does not re-stamp lastByteAtMs');
  assertEq(idled.sawFirstToken, true, '(6) idle_tick keeps sawFirstToken');

  // ─── (7) idle_tick BEFORE first token: generous TTFT budget ───────────────
  const waiting = advanceStreamHealth(init, { kind: 'handshake', nowMs: T0 }); // lastByteAtMs = T0, no first token
  const wIdle = (ms: number) => advanceStreamHealth(waiting, { kind: 'idle_tick', nowMs: T0 + ms });
  assertEq(wIdle(STREAM_SLOW_MS).health, 'waiting_first_token', '(7) pre-token 20s is NOT slow (generous)');
  assertEq(wIdle(STREAM_TTFT_SLOW_MS - 1).health, 'waiting_first_token', '(7) pre-token 39.999s still waiting');
  assertEq(wIdle(STREAM_TTFT_SLOW_MS).health, 'slow', '(7) pre-token 40s → slow');
  const preStalled = STREAM_STALLED_MS + (STREAM_TTFT_SLOW_MS - STREAM_SLOW_MS); // 80s
  assertEq(wIdle(preStalled - 1).health, 'slow', '(7) pre-token 79.999s → slow');
  assertEq(wIdle(preStalled).health, 'stalled', '(7) pre-token 80s → stalled');
  assert(preStalled > STREAM_STALLED_MS, '(7) pre-token stalled line is later than post-token');
  assertEq(wIdle(STREAM_STALLED_MS).health, 'slow', '(7) at post-token stalled line, pre-token is only slow');

  // ─── (8) no usable reference / bad clock / skew ───────────────────────────
  // idle_tick on init (opening, lastByteAtMs null) → untouched
  const openIdle = advanceStreamHealth(init, { kind: 'idle_tick', nowMs: T0 + 999_999 });
  assertEq(openIdle.health, 'opening', '(8) idle in opening (no reference) stays opening');
  assertEq(openIdle.lastByteAtMs, null, '(8) opening idle keeps null reference');
  // handshake with a non-finite clock → null reference, idle can't measure
  const hsBad = advanceStreamHealth(init, { kind: 'handshake', nowMs: NaN as unknown as number });
  assertEq(hsBad.health, 'waiting_first_token', '(8) handshake w/ NaN clock still connects');
  assertEq(hsBad.lastByteAtMs, null, '(8) handshake w/ NaN clock drops reference');
  assertEq(
    advanceStreamHealth(hsBad, { kind: 'idle_tick', nowMs: T0 + 999_999 }).health,
    'waiting_first_token',
    '(8) idle with null reference cannot invent a stall',
  );
  // clock skew: now < lastByteAtMs → idle clamps to 0, stays streaming
  const skew = advanceStreamHealth(
    { health: 'streaming', sawFirstToken: true, lastByteAtMs: T0 + 5000 },
    { kind: 'idle_tick', nowMs: T0 + 4000 },
  );
  assertEq(skew.health, 'streaming', '(8) clock skew (now<last) clamps idle → streaming');
  assertEq(skew.lastByteAtMs, T0 + 5000, '(8) skew idle leaves reference intact');
  // byte with a non-finite clock → streaming but reference dropped (fail-safe)
  const byteBad = advanceStreamHealth(streaming, { kind: 'byte', nowMs: Infinity as unknown as number });
  assertEq(byteBad.health, 'streaming', '(8) byte w/ Infinity clock still streaming');
  assertEq(byteBad.lastByteAtMs, null, '(8) byte w/ bad clock drops reference (no false stall later)');

  // ─── (9) describeStreamHealth: the five copies ────────────────────────────
  assertEq(describeStreamHealth('opening'), 'Connecting…', '(9) opening copy');
  assertEq(describeStreamHealth('waiting_first_token'), 'Thinking…', '(9) waiting copy');
  assertEq(describeStreamHealth('streaming'), 'Writing…', '(9) streaming copy');
  assertEq(describeStreamHealth('slow'), 'Still working…', '(9) slow copy');
  assertEq(
    describeStreamHealth('stalled'),
    'Connection seems stalled — say "continue" to retry',
    '(9) stalled copy',
  );
  const allHealths: StreamHealth[] = ['opening', 'waiting_first_token', 'streaming', 'slow', 'stalled'];
  assert(
    allHealths.every((h) => typeof describeStreamHealth(h) === 'string' && describeStreamHealth(h).length > 0),
    '(9) every health copy is a non-empty string',
  );
  assert(new Set(allHealths.map((h) => describeStreamHealth(h))).size === 5, '(9) all five copies are distinct');

  // ─── (10) purity: new object out, input never mutated ─────────────────────
  const before: StreamHealthState = { health: 'waiting_first_token', sawFirstToken: false, lastByteAtMs: T0 };
  const beforeSnapshot = JSON.stringify(before);
  const after = advanceStreamHealth(before, { kind: 'byte', nowMs: T0 + 10 });
  assert(after !== before, '(10) advance returns a new object');
  assertEq(JSON.stringify(before), beforeSnapshot, '(10) advance does not mutate its input state');
  assertEq(before.health, 'waiting_first_token', '(10) input health unchanged after advance');
  // stable copy across calls
  assertEq(describeStreamHealth('slow'), describeStreamHealth('slow'), '(10) describe is stable across calls');

  // ─── (11) hostile / degenerate — must never throw ─────────────────────────
  const r1 = noThrow(() => advanceStreamHealth(null as unknown as StreamHealthState, null as unknown as never), '(11) advance(null,null)');
  assert(isValidState(r1), '(11) advance(null,null) → valid state');
  const r2 = noThrow(
    () => advanceStreamHealth(undefined as unknown as StreamHealthState, { kind: 'byte', nowMs: 1 }),
    '(11) advance(undefined,byte)',
  );
  assertEq((r2 as StreamHealthState).health, 'streaming', '(11) advance(undefined,byte) → streaming');
  const r3 = noThrow(
    () => advanceStreamHealth({} as unknown as StreamHealthState, { kind: 'idle_tick', nowMs: 5 }),
    '(11) advance({},idle_tick)',
  );
  assertEq((r3 as StreamHealthState).health, 'opening', '(11) advance({},idle_tick) → opening (no reference)');
  const r4 = noThrow(
    () =>
      advanceStreamHealth(
        { health: 'zzz', sawFirstToken: 'yes', lastByteAtMs: 'x' } as unknown as StreamHealthState,
        { kind: 'handshake', nowMs: 7 },
      ),
    '(11) advance(garbage-state,handshake)',
  );
  assertEq((r4 as StreamHealthState).health, 'waiting_first_token', '(11) garbage state normalized then handshake applies');
  assertEq((r4 as StreamHealthState).sawFirstToken, false, '(11) garbage sawFirstToken coerced to false');

  // Proxy whose getters throw — as state
  const boom = new Proxy({}, { get() { throw new Error('boom'); } }) as unknown as StreamHealthState;
  const r5 = noThrow(() => advanceStreamHealth(boom, { kind: 'handshake', nowMs: 3 }), '(11) advance(throwing-proxy-state)');
  assert(isValidState(r5), '(11) throwing-proxy state → valid state (degraded)');
  // Proxy whose getters throw — as event
  const r6 = noThrow(
    () => advanceStreamHealth(init, boom as unknown as { kind: 'byte'; nowMs: number }),
    '(11) advance(_, throwing-proxy-event)',
  );
  assert(isValidState(r6), '(11) throwing-proxy event → valid state (no-op)');
  assertEq((r6 as StreamHealthState).health, 'opening', '(11) throwing-proxy event is a no-op on normalized state');

  // Huge / non-finite clocks
  const r7 = noThrow(
    () => advanceStreamHealth(streaming, { kind: 'idle_tick', nowMs: 1e300 }),
    '(11) advance(idle_tick, 1e300)',
  );
  assertEq((r7 as StreamHealthState).health, 'stalled', '(11) astronomically-late idle → stalled (bounded)');
  const r8 = noThrow(
    () => advanceStreamHealth(streaming, { kind: 'idle_tick', nowMs: NaN as unknown as number }),
    '(11) advance(idle_tick, NaN)',
  );
  assertEq((r8 as StreamHealthState).health, 'streaming', '(11) NaN clock idle is a no-op → streaming');
  // unknown / malformed event kind → no-op
  const r9 = noThrow(
    () => advanceStreamHealth(streaming, { kind: 'nope', nowMs: T0 } as unknown as { kind: 'byte'; nowMs: number }),
    '(11) advance(unknown-kind)',
  );
  assertEq((r9 as StreamHealthState).health, 'streaming', '(11) unknown event kind is a no-op');
  const r10 = noThrow(
    () => advanceStreamHealth(streaming, { kind: 42 as unknown as 'byte', nowMs: T0 }),
    '(11) advance(numeric-kind)',
  );
  assert(isValidState(r10), '(11) numeric event kind → valid state');

  // describeStreamHealth hostile inputs
  const hostileHealths: unknown[] = [null, undefined, 123, {}, [], 'bogus', 'x'.repeat(100_000), NaN, true];
  for (const h of hostileHealths) {
    const out = noThrow(() => describeStreamHealth(h as StreamHealth), '(11) describe(' + typeof h + ')');
    assert(typeof out === 'string' && (out as string).length > 0, '(11) describe hostile → non-empty string', JSON.stringify(out));
  }
  assertEq(describeStreamHealth('bogus' as StreamHealth), 'Connecting…', '(11) unknown health → calm opening copy');
  const proxyHealth = new Proxy({}, { get() { throw new Error('boom'); } }) as unknown as StreamHealth;
  const r11 = noThrow(() => describeStreamHealth(proxyHealth), '(11) describe(throwing-proxy)');
  assert(typeof r11 === 'string' && (r11 as string).length > 0, '(11) describe throwing-proxy → non-empty string');

  // full realistic timeline never throws and ends bounded
  const timeline = noThrow(() => {
    let st = initStreamHealth();
    st = advanceStreamHealth(st, { kind: 'handshake', nowMs: T0 });
    st = advanceStreamHealth(st, { kind: 'idle_tick', nowMs: T0 + 10_000 }); // still thinking
    st = advanceStreamHealth(st, { kind: 'byte', nowMs: T0 + 12_000 }); // first token
    st = advanceStreamHealth(st, { kind: 'byte', nowMs: T0 + 12_500 });
    st = advanceStreamHealth(st, { kind: 'idle_tick', nowMs: T0 + 35_000 }); // gap → slow
    st = advanceStreamHealth(st, { kind: 'byte', nowMs: T0 + 36_000 }); // recovers
    return st;
  }, '(11) realistic timeline');
  assertEq((timeline as StreamHealthState).health, 'streaming', '(11) timeline ends streaming after recovery');
  assert(isValidState(timeline), '(11) timeline end state is valid');

  if (failures > 0) {
    console.error(`\n${failures} fail`);
    process.exit(1);
  }
  console.log(`\nAll streamHealthCore smoke cases passed (${passes} passed).`);
}

main();
