/**
 * Smoke test for src/lib/streamFirstChunkCore.ts
 *
 * Pure — loads under tsx (streamFirstChunkCore has zero runtime imports).
 *
 * Covers (OPTIMIZE — cut perceived latency at the chat SSE emit loop):
 *   - planFirstFlush: no thinking phase → no ack + a SMALL bounded first-flush
 *     threshold; thinking phase → early ack + a threshold >= the no-ack default;
 *     minFlushChars override (respected + clamped to [MIN,MAX]); firstDeltaChars
 *     is observation-only (changes reason, never the numeric threshold);
 *     boundedness (huge/tiny/fractional/negative); determinism + fresh object.
 *   - shouldCoalesceDelta: small recent buffer coalesces (true); buffer at/over
 *     maxBufferChars flushes (false); held at/over maxHoldMs flushes even with a
 *     tiny buffer; empty buffer holds (never an empty flush) regardless of hold;
 *     custom opts respected + clamped to caps; exact boundary behavior; an
 *     end-to-end micro-delta stream that coalesces then releases on maxHold.
 *   - Hostile no-throw across every export.
 *
 * Run: npx tsx scripts/stream-first-chunk-core-smoketest.ts
 */

import {
  planFirstFlush,
  shouldCoalesceDelta,
  FIRST_FLUSH_MIN_CHARS,
  FIRST_FLUSH_MAX_CHARS,
  DEFAULT_FIRST_FLUSH_CHARS,
  THINKING_FIRST_FLUSH_CHARS,
  DEFAULT_MAX_COALESCE_BUFFER_CHARS,
  DEFAULT_MAX_COALESCE_HOLD_MS,
  COALESCE_BUFFER_CHARS_CAP,
  COALESCE_HOLD_MS_CAP,
  type FirstFlushPlan,
} from '../src/lib/streamFirstChunkCore';

let passes = 0, failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else { failures++; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); }
}
function assertEq(a: any, b: any, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function noThrow(label: string, fn: () => void): void {
  try { fn(); assert(true, label); }
  catch (e) { assert(false, label, String(e)); }
}
function isPlan(p: any): boolean {
  return !!p && typeof p === 'object'
    && typeof p.emitEarlyAck === 'boolean'
    && typeof p.flushAtChars === 'number'
    && Number.isInteger(p.flushAtChars)
    && typeof p.reason === 'string'
    && p.reason.length > 0
    && p.flushAtChars >= FIRST_FLUSH_MIN_CHARS
    && p.flushAtChars <= FIRST_FLUSH_MAX_CHARS;
}

function main() {
  // 1) exports & constant sanity -------------------------------------------
  assertEq(typeof planFirstFlush, 'function', '1 planFirstFlush exported');
  assertEq(typeof shouldCoalesceDelta, 'function', '1 shouldCoalesceDelta exported');
  assertEq(FIRST_FLUSH_MIN_CHARS, 1, '1 min flush chars = 1');
  assert(FIRST_FLUSH_MAX_CHARS > DEFAULT_FIRST_FLUSH_CHARS, '1 max > default first flush');
  assert(DEFAULT_FIRST_FLUSH_CHARS >= FIRST_FLUSH_MIN_CHARS, '1 default >= min');
  assert(DEFAULT_FIRST_FLUSH_CHARS <= FIRST_FLUSH_MAX_CHARS, '1 default <= max');
  assert(THINKING_FIRST_FLUSH_CHARS >= DEFAULT_FIRST_FLUSH_CHARS,
    '1 thinking flush >= no-thinking default (ack lets us batch more)');
  assert(THINKING_FIRST_FLUSH_CHARS <= FIRST_FLUSH_MAX_CHARS, '1 thinking flush within bound');
  assert(DEFAULT_MAX_COALESCE_BUFFER_CHARS > 0 && DEFAULT_MAX_COALESCE_HOLD_MS > 0,
    '1 coalesce defaults positive');
  assert(DEFAULT_MAX_COALESCE_HOLD_MS <= 100,
    '1 default hold below perception threshold (no visible lag)');
  assert(COALESCE_BUFFER_CHARS_CAP >= DEFAULT_MAX_COALESCE_BUFFER_CHARS, '1 buffer cap >= default');
  assert(COALESCE_HOLD_MS_CAP >= DEFAULT_MAX_COALESCE_HOLD_MS, '1 hold cap >= default');

  // 2) planFirstFlush — no thinking phase ----------------------------------
  const noThink: FirstFlushPlan = planFirstFlush({});
  assert(isPlan(noThink), '2 plan shape valid for {}');
  assertEq(noThink.emitEarlyAck, false, '2 no thinking phase → no early ack');
  assertEq(noThink.flushAtChars, DEFAULT_FIRST_FLUSH_CHARS, '2 default threshold used');
  assert(noThink.flushAtChars <= 32, '2 first flush is SMALL (fast TTFT)');
  assert(!noThink.reason.toLowerCase().includes('ack'), '2 no-ack reason omits "ack"');
  // explicit false is also no-ack
  assertEq(planFirstFlush({ hasThinkingPhase: false }).emitEarlyAck, false,
    '2 hasThinkingPhase:false → no ack');

  // 3) planFirstFlush — thinking phase -------------------------------------
  const think = planFirstFlush({ hasThinkingPhase: true });
  assert(isPlan(think), '3 plan shape valid for thinking');
  assertEq(think.emitEarlyAck, true, '3 thinking phase → early ack');
  assertEq(think.flushAtChars, THINKING_FIRST_FLUSH_CHARS, '3 thinking default threshold');
  assert(think.flushAtChars >= noThink.flushAtChars,
    '3 thinking threshold >= no-thinking (ack covered the wait)');
  assert(think.reason.toLowerCase().includes('ack'), '3 thinking reason mentions ack');
  assert(think.flushAtChars <= FIRST_FLUSH_MAX_CHARS, '3 thinking threshold bounded');

  // strict coercion: only literal true enables the ack -----------------------
  assertEq(planFirstFlush({ hasThinkingPhase: 1 as any }).emitEarlyAck, false,
    '3 truthy non-boolean (1) does NOT enable ack (strict)');
  assertEq(planFirstFlush({ hasThinkingPhase: 'yes' as any }).emitEarlyAck, false,
    '3 truthy string does NOT enable ack (strict)');
  assertEq(planFirstFlush({ hasThinkingPhase: {} as any }).emitEarlyAck, false,
    '3 object does NOT enable ack (strict)');

  // 4) minFlushChars override (respected + clamped) ------------------------
  const overr = planFirstFlush({ minFlushChars: 5 });
  assertEq(overr.flushAtChars, 5, '4 minFlushChars override used verbatim');
  assertEq(overr.emitEarlyAck, false, '4 override alone does not force ack');
  // override wins over the phase default
  assertEq(planFirstFlush({ hasThinkingPhase: true, minFlushChars: 3 }).flushAtChars, 3,
    '4 override beats thinking default');
  // clamp to MAX
  assertEq(planFirstFlush({ minFlushChars: 10_000 }).flushAtChars, FIRST_FLUSH_MAX_CHARS,
    '4 huge override clamped to MAX');
  // clamp to MIN via fractional-below-1 → treated invalid → default (not override)
  assertEq(planFirstFlush({ minFlushChars: 0.5 }).flushAtChars, DEFAULT_FIRST_FLUSH_CHARS,
    '4 sub-1 fractional override invalid → phase default');
  // exactly 1 respected (== MIN)
  assertEq(planFirstFlush({ minFlushChars: 1 }).flushAtChars, FIRST_FLUSH_MIN_CHARS,
    '4 override of 1 respected (== MIN)');
  // fractional >=1 floors
  assertEq(planFirstFlush({ minFlushChars: 7.9 }).flushAtChars, 7, '4 fractional override floors');
  // invalid override types → phase default
  assertEq(planFirstFlush({ minFlushChars: -4 }).flushAtChars, DEFAULT_FIRST_FLUSH_CHARS,
    '4 negative override → default');
  assertEq(planFirstFlush({ minFlushChars: 0 }).flushAtChars, DEFAULT_FIRST_FLUSH_CHARS,
    '4 zero override → default');
  assertEq(planFirstFlush({ minFlushChars: NaN }).flushAtChars, DEFAULT_FIRST_FLUSH_CHARS,
    '4 NaN override → default');
  assertEq(planFirstFlush({ minFlushChars: Infinity }).flushAtChars, DEFAULT_FIRST_FLUSH_CHARS,
    '4 Infinity override → default');
  assertEq(planFirstFlush({ minFlushChars: '20' as any }).flushAtChars, DEFAULT_FIRST_FLUSH_CHARS,
    '4 string override → default (strict, never coerced)');

  // 5) firstDeltaChars — observation only (reason changes, threshold does not)
  const bigDelta = planFirstFlush({ firstDeltaChars: 500 });
  assertEq(bigDelta.flushAtChars, DEFAULT_FIRST_FLUSH_CHARS,
    '5 firstDeltaChars does NOT change threshold');
  assert(bigDelta.reason.includes('immediate'),
    '5 large first delta → "flush immediately" reason');
  const tinyDelta = planFirstFlush({ firstDeltaChars: 2 });
  assertEq(tinyDelta.flushAtChars, DEFAULT_FIRST_FLUSH_CHARS,
    '5 tiny firstDeltaChars still does NOT change threshold');
  assert(tinyDelta.reason.includes('accumulate'),
    '5 tiny first delta → "accumulate" reason');
  // delta exactly at threshold → meets → immediate
  assert(planFirstFlush({ firstDeltaChars: DEFAULT_FIRST_FLUSH_CHARS }).reason.includes('immediate'),
    '5 first delta == threshold → immediate');
  assert(planFirstFlush({ firstDeltaChars: DEFAULT_FIRST_FLUSH_CHARS - 1 }).reason.includes('accumulate'),
    '5 first delta one below threshold → accumulate');
  // thinking + delta combos keep ack AND the delta reason
  const tb = planFirstFlush({ hasThinkingPhase: true, firstDeltaChars: 999 });
  assert(tb.emitEarlyAck === true && tb.reason.includes('immediate') && tb.reason.toLowerCase().includes('ack'),
    '5 thinking + big delta → ack + immediate');
  const ta = planFirstFlush({ hasThinkingPhase: true, firstDeltaChars: 1 });
  assert(ta.emitEarlyAck === true && ta.reason.includes('accumulate'),
    '5 thinking + tiny delta → ack + accumulate');
  // invalid firstDeltaChars ignored (no immediate/accumulate branch)
  assert(!planFirstFlush({ firstDeltaChars: -3 }).reason.includes('immediate')
    && !planFirstFlush({ firstDeltaChars: -3 }).reason.includes('accumulate'),
    '5 invalid delta → neutral reason (no delta branch)');

  // 6) determinism + fresh object ------------------------------------------
  const a = planFirstFlush({ hasThinkingPhase: true, firstDeltaChars: 4, minFlushChars: 9 });
  const b = planFirstFlush({ hasThinkingPhase: true, firstDeltaChars: 4, minFlushChars: 9 });
  assertEq(JSON.stringify(a), JSON.stringify(b), '6 deterministic — same input same output');
  assert(a !== b, '6 returns a fresh object each call');
  // (9 override, delta 4 < 9 → accumulate, ack on)
  assertEq(a.flushAtChars, 9, '6 combined: override applied');
  assert(a.emitEarlyAck && a.reason.includes('accumulate'), '6 combined: ack + accumulate');

  // 7) shouldCoalesceDelta — small recent buffer coalesces -----------------
  assertEq(shouldCoalesceDelta(3, 5), true, '7 small buffer, brief hold → coalesce');
  assertEq(shouldCoalesceDelta(1, 0), true, '7 one char, no hold → coalesce');
  assertEq(shouldCoalesceDelta(DEFAULT_MAX_COALESCE_BUFFER_CHARS - 1, DEFAULT_MAX_COALESCE_HOLD_MS - 1), true,
    '7 just under both limits → coalesce');

  // 8) buffer at/over maxBufferChars flushes -------------------------------
  assertEq(shouldCoalesceDelta(DEFAULT_MAX_COALESCE_BUFFER_CHARS, 0), false,
    '8 buffer == maxBuffer → flush');
  assertEq(shouldCoalesceDelta(DEFAULT_MAX_COALESCE_BUFFER_CHARS + 100, 0), false,
    '8 buffer over maxBuffer → flush');
  assertEq(shouldCoalesceDelta(1_000_000, 0), false, '8 huge buffer → flush');

  // 9) held at/over maxHoldMs flushes even with a tiny buffer ---------------
  assertEq(shouldCoalesceDelta(1, DEFAULT_MAX_COALESCE_HOLD_MS), false,
    '9 held == maxHold with 1 char → flush (avoid lag)');
  assertEq(shouldCoalesceDelta(2, DEFAULT_MAX_COALESCE_HOLD_MS + 500), false,
    '9 held over maxHold → flush');

  // 10) empty buffer holds — never an empty flush --------------------------
  assertEq(shouldCoalesceDelta(0, 0), true, '10 empty buffer → hold');
  assertEq(shouldCoalesceDelta(0, 999_999), true,
    '10 empty buffer held forever → still hold (never empty flush)');
  assertEq(shouldCoalesceDelta(-5, 10), true, '10 negative buffer → hold (degenerate)');

  // 11) custom opts respected + clamped ------------------------------------
  // small custom maxBuffer flushes earlier
  assertEq(shouldCoalesceDelta(4, 0, { maxBufferChars: 4 }), false,
    '11 custom maxBuffer=4, buffer=4 → flush');
  assertEq(shouldCoalesceDelta(3, 0, { maxBufferChars: 4 }), true,
    '11 custom maxBuffer=4, buffer=3 → coalesce');
  // small custom maxHold flushes earlier
  assertEq(shouldCoalesceDelta(1, 10, { maxHoldMs: 10 }), false,
    '11 custom maxHold=10, held=10 → flush');
  assertEq(shouldCoalesceDelta(1, 9, { maxHoldMs: 10 }), true,
    '11 custom maxHold=10, held=9 → coalesce');
  // huge opts clamped to caps: a buffer at the cap still flushes; below cap-band coalesces
  assertEq(shouldCoalesceDelta(COALESCE_BUFFER_CHARS_CAP, 0, { maxBufferChars: 9_999_999 }), false,
    '11 huge maxBuffer clamped to cap → buffer at cap flushes');
  assertEq(shouldCoalesceDelta(COALESCE_HOLD_MS_CAP, 0, { maxBufferChars: 9_999_999, maxHoldMs: 9_999_999 }), true,
    '11 huge caps: buffer below cap & hold not yet → coalesce');
  assertEq(shouldCoalesceDelta(5, COALESCE_HOLD_MS_CAP, { maxHoldMs: 9_999_999 }), false,
    '11 huge maxHold clamped to cap → held at cap flushes');
  // invalid opts fall back to defaults
  assertEq(shouldCoalesceDelta(DEFAULT_MAX_COALESCE_BUFFER_CHARS, 0, { maxBufferChars: -1 as any }), false,
    '11 invalid maxBuffer → default used');
  assertEq(shouldCoalesceDelta(5, DEFAULT_MAX_COALESCE_HOLD_MS, { maxHoldMs: 'x' as any }), false,
    '11 invalid maxHold → default used');
  assertEq(shouldCoalesceDelta(3, 5, { maxBufferChars: 0, maxHoldMs: NaN } as any), true,
    '11 zero/NaN opts → defaults → small+recent coalesces');

  // 12) exact boundaries ----------------------------------------------------
  assertEq(shouldCoalesceDelta(47, 59), true, '12 one below both defaults → coalesce');
  assertEq(shouldCoalesceDelta(48, 59), false, '12 buffer boundary hit → flush');
  assertEq(shouldCoalesceDelta(47, 60), false, '12 hold boundary hit → flush');
  // fractional buffered/held floor toward the safe side
  assertEq(shouldCoalesceDelta(47.9, 59.9), true, '12 fractional just-under floors → coalesce');
  assertEq(shouldCoalesceDelta(48.9, 0), false, '12 fractional buffer floors to 48 → flush');

  // 13) end-to-end micro-delta stream: coalesce then release on maxHold -----
  // Simulate the SSE loop appending 1-char deltas every 8ms with the default
  // policy; assert it batches (few flushes) yet never holds past maxHold.
  let buffered = 0;
  let heldMs = 0;
  let flushes = 0;
  const STEP_MS = 8;
  for (let i = 0; i < 40; i++) {
    buffered += 1;      // one-char delta
    heldMs += STEP_MS;  // time since last flush advances
    if (!shouldCoalesceDelta(buffered, heldMs)) {
      flushes += 1;
      buffered = 0;
      heldMs = 0;
    }
  }
  assert(flushes > 0, '13 stream produced at least one flush');
  assert(flushes < 40, '13 coalescing collapsed 40 deltas into far fewer flushes');
  // 40 deltas * 8ms = 320ms of stream; with a 60ms hold cap we flush roughly
  // every ~7-8 chars → on the order of 5-6 flushes, never 40.
  assert(flushes <= 12, '13 flush count stays low (batched), got ' + flushes);

  // first-flush threshold path: buffer must reach flushAtChars before paint ---
  const plan = planFirstFlush({});
  let firstBuffer = 0;
  let firstPaintAt = -1;
  for (let i = 0; i < plan.flushAtChars + 5; i++) {
    firstBuffer += 1;
    if (firstPaintAt < 0 && firstBuffer >= plan.flushAtChars) firstPaintAt = i;
  }
  assertEq(firstPaintAt, plan.flushAtChars - 1, '13 first paint fires exactly at flushAtChars chars');

  // 14) return type is always a strict boolean -----------------------------
  for (const [bc, ms] of [[10, 10], [0, 0], [100, 1000], [1, 0]] as const) {
    assertEq(typeof shouldCoalesceDelta(bc, ms), 'boolean', '14 returns boolean for ' + bc + '/' + ms);
  }

  // 15) hostile no-throw across every export -------------------------------
  const cyclic: any = {}; cyclic.self = cyclic;
  const evil: any = { toString() { throw new Error('boom'); }, valueOf() { throw new Error('boom'); } };
  const throwingGetter: any = new Proxy({}, { get() { throw new Error('getter boom'); } });
  const hostiles: any[] = [
    null, undefined, 0, 1, -1, NaN, Infinity, -Infinity, true, false, '', 'str',
    {}, [], [1, 2], cyclic, evil, throwingGetter, Symbol('x'), () => 1, 0.5,
  ];
  for (const h of hostiles) {
    noThrow('15 planFirstFlush no-throw for ' + String(typeof h), () => {
      const r = planFirstFlush(h);
      assert(isPlan(r), '15 planFirstFlush valid plan for hostile ' + String(typeof h));
    });
    noThrow('15 planFirstFlush hostile-fields no-throw for ' + String(typeof h), () => {
      const r = planFirstFlush({ hasThinkingPhase: h, firstDeltaChars: h, minFlushChars: h });
      assert(isPlan(r), '15 planFirstFlush valid plan for hostile fields');
    });
    noThrow('15 shouldCoalesceDelta no-throw for ' + String(typeof h), () => {
      const r = shouldCoalesceDelta(h, h);
      assert(typeof r === 'boolean', '15 shouldCoalesceDelta boolean for hostile');
    });
    noThrow('15 shouldCoalesceDelta hostile-opts no-throw for ' + String(typeof h), () => {
      const r = shouldCoalesceDelta(10, 10, { maxBufferChars: h, maxHoldMs: h });
      assert(typeof r === 'boolean', '15 shouldCoalesceDelta boolean for hostile opts');
    });
  }
  // hostile inputs coerce to safe neutrals
  assertEq(planFirstFlush(null as any).emitEarlyAck, false, '15 null input → no ack');
  assertEq(planFirstFlush(null as any).flushAtChars, DEFAULT_FIRST_FLUSH_CHARS, '15 null input → default threshold');
  assertEq(planFirstFlush(throwingGetter).flushAtChars, DEFAULT_FIRST_FLUSH_CHARS,
    '15 throwing-getter input → default (getter never crashes)');
  assertEq(shouldCoalesceDelta(evil, evil), true, '15 evil buffer coerces to 0 → hold');
  assertEq(shouldCoalesceDelta(10, 10, throwingGetter), true,
    '15 throwing-getter opts → defaults → small+recent coalesces');

  // ── done ────────────────────────────────────────────────────────────────
  if (failures > 0) { console.error('\n' + failures + ' fail'); process.exit(1); }
  console.log('\nAll stream-first-chunk-core smoke cases passed (' + passes + ' passed).');
}
main();
