// Smoke test for providerBackoffCore — pure, tsx-loadable, deterministic.
// Verifies the consecutive-failure exponential backoff window (2^n, clamped by
// both a multiplier ceiling AND an absolute maxWindowMs ceiling) and the
// isCoolingDown window check, incl. a degenerate/hostile-input group asserting
// totality (no throw, bounded, safe-neutral).
// Run: npx tsx scripts/provider-backoff-core-smoketest.ts
import {
  backoffWindowMs,
  isCoolingDown,
  PROVIDER_BACKOFF_MAX_MULTIPLIER,
  PROVIDER_BACKOFF_MAX_WINDOW_MS,
  PROVIDER_BACKOFF_DEFAULT_BASE_WINDOW_MS,
} from '../src/lib/providerBackoffCore';

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

const BASE = 30_000;
const CEIL = 480_000; // PROVIDER_BACKOFF_MAX_WINDOW_MS

function main() {
  // ─── 1. constants sanity ──────────────────────────────────────────
  assertEq(PROVIDER_BACKOFF_MAX_MULTIPLIER, 8, 'max multiplier is 8');
  assertEq(PROVIDER_BACKOFF_MAX_WINDOW_MS, 480_000, 'max window is 8min');
  assertEq(PROVIDER_BACKOFF_DEFAULT_BASE_WINDOW_MS, 30_000, 'default base is 30s');
  assertEq(CEIL, PROVIDER_BACKOFF_MAX_WINDOW_MS, 'local CEIL mirrors export');

  // ─── 2. 0 failures → base window (2^0 = 1×) ───────────────────────
  assertEq(backoffWindowMs(0, BASE), BASE, '0 failures -> base');
  assertEq(backoffWindowMs(0, 100_000), 100_000, '0 failures -> base (other base)');
  assertEq(backoffWindowMs(0, 1), 1, '0 failures -> tiny base preserved');
  assertEq(backoffWindowMs(0, 0), 0, '0 failures, base 0 -> 0');

  // ─── 3. exponential growth 2^n with consecutive failures ──────────
  assertEq(backoffWindowMs(1, BASE), 60_000, '1 failure -> 2x base');
  assertEq(backoffWindowMs(2, BASE), 120_000, '2 failures -> 4x base');
  assertEq(backoffWindowMs(3, BASE), 240_000, '3 failures -> 8x base (at mult clamp)');
  // Explicit non-decreasing escalation across the growth region.
  assert(
    backoffWindowMs(0, BASE) < backoffWindowMs(1, BASE) &&
      backoffWindowMs(1, BASE) < backoffWindowMs(2, BASE) &&
      backoffWindowMs(2, BASE) < backoffWindowMs(3, BASE),
    'window strictly grows over 0..3 failures',
  );

  // ─── 4. multiplier clamp (default 8) — n>=3 all pin to 8x ─────────
  assertEq(backoffWindowMs(3, BASE), 240_000, '3 failures clamped at 8x');
  assertEq(backoffWindowMs(4, BASE), 240_000, '4 failures still 8x (clamped)');
  assertEq(backoffWindowMs(5, BASE), 240_000, '5 failures still 8x (clamped)');
  assertEq(backoffWindowMs(10, BASE), 240_000, '10 failures still 8x (clamped)');
  assertEq(backoffWindowMs(100, BASE), 240_000, '100 failures still 8x (clamped)');
  assertEq(backoffWindowMs(1_000_000, BASE), 240_000, '1e6 failures still 8x (clamped)');

  // ─── 5. absolute maxWindowMs ceiling (default 8min) ───────────────
  // With a larger base, 8x exceeds the ceiling and is clamped to it.
  assertEq(backoffWindowMs(2, 100_000), 400_000, '4x*100k = 400k (<= ceiling)');
  assertEq(backoffWindowMs(3, 100_000), CEIL, '8x*100k = 800k -> clamped to ceiling');
  assertEq(backoffWindowMs(9, 100_000), CEIL, 'high failures + big base -> ceiling');
  // A custom smaller ceiling bites before the multiplier clamp.
  assertEq(backoffWindowMs(3, BASE, { maxWindowMs: 100_000 }), 100_000, 'custom small ceiling clamps');
  assertEq(backoffWindowMs(1, BASE, { maxWindowMs: 100_000 }), 60_000, 'custom ceiling above value -> value');

  // ─── 6. huge override CANNOT freeze a provider for hours ──────────
  // Even a multi-hour base collapses to the absolute ceiling (8 min).
  assertEq(backoffWindowMs(0, 10_000_000), CEIL, 'huge base, 0 failures -> ceiling');
  assertEq(backoffWindowMs(3, 10_000_000), CEIL, 'huge base + failures -> ceiling');
  assertEq(backoffWindowMs(0, 60 * 60_000), CEIL, '1h base -> ceiling (never hours)');
  // A huge multiplier override is still capped by the absolute ceiling.
  assertEq(backoffWindowMs(5, BASE, { maxMultiplier: 1000 }), CEIL, '32x*30k = 960k -> ceiling');
  assertEq(backoffWindowMs(20, BASE, { maxMultiplier: 1_000_000 }), CEIL, 'huge mult -> ceiling');
  // Multiplier override below the growth stays within the ceiling.
  assertEq(backoffWindowMs(2, BASE, { maxMultiplier: 1000 }), 120_000, '4x under big-mult cap = 120k');
  // Only when BOTH clamps are explicitly widened can the window exceed the
  // default ceiling — a path isCoolingDown never takes (it exposes neither).
  assertEq(
    backoffWindowMs(5, BASE, { maxMultiplier: 1000, maxWindowMs: 10_000_000 }),
    960_000,
    'both clamps widened -> 32x*30k = 960k',
  );

  // ─── 7. multiplier floor at 1 (never shrink below base) ───────────
  assertEq(backoffWindowMs(5, BASE, { maxMultiplier: 1 }), BASE, 'mult clamp 1 -> base');
  assertEq(backoffWindowMs(5, BASE, { maxMultiplier: 0.1 }), BASE, 'mult < 1 floored to 1 -> base');
  assertEq(backoffWindowMs(5, BASE, { maxMultiplier: -3 }), BASE, 'negative mult floored to 1 -> base');

  // ─── 8. monotonic non-decreasing sweep + bounded + finite ─────────
  {
    let prev = -1;
    for (let n = 0; n <= 14; n += 1) {
      const w = backoffWindowMs(n, BASE);
      assert(Number.isFinite(w), 'sweep n=' + n + ' finite', String(w));
      assert(w >= 0 && w <= CEIL, 'sweep n=' + n + ' within [0, ceiling]', String(w));
      assert(w >= prev, 'sweep n=' + n + ' non-decreasing', 'prev=' + prev + ' w=' + w);
      prev = w;
    }
  }

  // ─── 9. fractional failure counts floor down ──────────────────────
  assertEq(backoffWindowMs(1.9, BASE), 60_000, '1.9 failures floors to 1 -> 2x');
  assertEq(backoffWindowMs(2.999, BASE), 120_000, '2.999 floors to 2 -> 4x');
  assertEq(backoffWindowMs(0.5, BASE), BASE, '0.5 floors to 0 -> base');

  // ─── 10. isCoolingDown — within / at / past the window ────────────
  // 1 failure, base 30k -> window 60k.
  assertEq(
    isCoolingDown({ lastFailureAtMs: 1_000, consecutiveFailures: 1, nowMs: 1_000 + 59_999, baseWindowMs: BASE }),
    true,
    '59.999s into a 60s window -> cooling',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 1_000, consecutiveFailures: 1, nowMs: 1_000 + 60_000, baseWindowMs: BASE }),
    false,
    'exactly at 60s window edge -> not cooling',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 1_000, consecutiveFailures: 1, nowMs: 1_000 + 60_001, baseWindowMs: BASE }),
    false,
    'past 60s window -> not cooling',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 1, nowMs: 0, baseWindowMs: BASE }),
    true,
    'zero elapsed, 1 failure -> cooling',
  );

  // ─── 11. isCoolingDown — no failures / future / defaults ──────────
  assertEq(
    isCoolingDown({ lastFailureAtMs: 1_000, consecutiveFailures: 0, nowMs: 1_500, baseWindowMs: BASE }),
    false,
    '0 failures -> never cooling',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 5_000, consecutiveFailures: 2, nowMs: 1_000, baseWindowMs: BASE }),
    false,
    'future failure (clock skew) -> not cooling',
  );
  // baseWindowMs omitted -> default 30k -> 1 failure window 60k.
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 1, nowMs: 59_999 }),
    true,
    'default base: 59.999s -> cooling',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 1, nowMs: 60_000 }),
    false,
    'default base: 60s edge -> not cooling',
  );

  // ─── 12. THE FIX: durably-dead provider stays cooled past flat 30s ─
  // 5 consecutive failures -> window clamps to 8x*30k = 240k (4 min).
  assertEq(backoffWindowMs(5, BASE), 240_000, 'durably-dead window = 240k');
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 5, nowMs: 100_000, baseWindowMs: BASE }),
    true,
    '100s after 5 failures -> STILL cooling (flat 30s window would retry)',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 5, nowMs: 239_999, baseWindowMs: BASE }),
    true,
    '239.999s after 5 failures -> still cooling',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 5, nowMs: 240_000, baseWindowMs: BASE }),
    false,
    '240s after 5 failures -> aged out',
  );
  // Contrast: a single failure at the same 100s would NOT be cooling (60s win).
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 1, nowMs: 100_000, baseWindowMs: BASE }),
    false,
    '100s after 1 failure -> not cooling (short window)',
  );

  // ─── 13. isCoolingDown never freezes for hours (ceiling guard) ────
  // Even a 10M-ms base override: window clamps to 480k, so by 8 min it clears.
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 20, nowMs: 400_000, baseWindowMs: 10_000_000 }),
    true,
    'huge base, 400s -> still within 8min ceiling',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 20, nowMs: 480_000, baseWindowMs: 10_000_000 }),
    false,
    'huge base, 480s -> cleared at ceiling (no multi-min freeze)',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 20, nowMs: 3_600_000, baseWindowMs: 10_000_000 }),
    false,
    'huge base, 1h -> definitely retried (never frozen for hours)',
  );

  // ─── 14. isCoolingDown sanitizes a hostile baseWindowMs -> default ─
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 1, nowMs: 1_000, baseWindowMs: 'huge' }),
    true,
    'string base -> default 30k -> 1k elapsed cooling',
  );
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: 1, nowMs: 1_000, baseWindowMs: -999 }),
    true,
    'negative base -> default 30k -> cooling',
  );

  // ─── 15. degenerate / hostile input — MUST NOT THROW, bounded ─────
  const throwingOpts: { maxMultiplier?: number } = {};
  Object.defineProperty(throwingOpts, 'maxMultiplier', {
    get() {
      throw new Error('boom-mult');
    },
    enumerable: true,
  });

  // backoffWindowMs hostile args: every result must be finite, >=0, <=ceiling
  // (no widened overrides here), and must not throw.
  const hostileBackoff: Array<[string, unknown, unknown, { maxMultiplier?: number; maxWindowMs?: number } | undefined]> = [
    ['null/null', null, null, undefined],
    ['undef/undef', undefined, undefined, undefined],
    ['NaN/NaN', NaN, NaN, undefined],
    ['strings', '3', '30000', undefined],
    ['neg count', -5, BASE, undefined],
    ['+Inf count', Infinity, BASE, undefined],
    ['-Inf count', -Infinity, BASE, undefined],
    ['+Inf base', 3, Infinity, undefined],
    ['neg base', 3, -100, undefined],
    ['NaN base', 3, NaN, undefined],
    ['obj/obj', {}, {}, undefined],
    ['arr/arr', [], [], undefined],
    ['bool/bool', true, false, undefined],
    ['fn/fn', () => 0, () => 0, undefined],
    ['bigint args', 3n as unknown, 30000n as unknown, undefined],
    ['opts null', 3, BASE, null as unknown as undefined],
    ['opts string', 3, BASE, 'nope' as unknown as undefined],
    ['opts array', 3, BASE, [] as unknown as undefined],
    ['opts NaN fields', 3, BASE, { maxMultiplier: NaN, maxWindowMs: NaN }],
    ['opts neg window', 3, BASE, { maxWindowMs: -5 }],
    ['opts throwing getter', 3, BASE, throwingOpts],
  ];
  for (const [label, cf, base, opts] of hostileBackoff) {
    const w = noThrow('backoff ' + label, () => backoffWindowMs(cf, base, opts));
    assert(
      typeof w === 'number' && Number.isFinite(w) && (w as number) >= 0 && (w as number) <= CEIL,
      'backoff(' + label + ') -> finite within [0, ceiling]',
      String(w),
    );
  }
  // Specific hostile expectations that should still resolve meaningfully.
  assertEq(backoffWindowMs(null, null), BASE, 'null/null -> default base');
  assertEq(backoffWindowMs(Infinity, BASE), BASE, '+Inf count is non-finite -> neutral base');
  assertEq(backoffWindowMs(3, Infinity), 240_000, '+Inf base -> default base, 8x');
  assertEq(backoffWindowMs(3, BASE, { maxWindowMs: 0 }), 0, 'ceiling 0 -> 0 (cooldown off)');
  assertEq(backoffWindowMs(3, BASE, { maxWindowMs: -5 }), 240_000, 'neg ceiling -> default ceiling');
  assertEq(backoffWindowMs(3, BASE, throwingOpts), BASE, 'throwing opts getter -> caught, default base');

  // isCoolingDown hostile inputs: every result a boolean, no throw.
  const throwingInput = {
    lastFailureAtMs: 0,
    consecutiveFailures: 1,
    get nowMs(): number {
      throw new Error('boom-now');
    },
  };
  const hostileCooling: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['string', 'nope'],
    ['number', 7],
    ['array', []],
    ['empty obj', {}],
    ['bad last', { lastFailureAtMs: 'x', consecutiveFailures: 1, nowMs: 1_000 }],
    ['bad now', { lastFailureAtMs: 0, consecutiveFailures: 1, nowMs: 'x' }],
    ['NaN now', { lastFailureAtMs: 0, consecutiveFailures: 1, nowMs: NaN }],
    ['Inf now', { lastFailureAtMs: 0, consecutiveFailures: 1, nowMs: Infinity }],
    ['NaN last', { lastFailureAtMs: NaN, consecutiveFailures: 1, nowMs: 1_000 }],
    ['bad count', { lastFailureAtMs: 0, consecutiveFailures: 'x', nowMs: 1_000 }],
    ['neg count', { lastFailureAtMs: 0, consecutiveFailures: -3, nowMs: 1_000 }],
    ['throwing now getter', throwingInput],
    ['count as object', { lastFailureAtMs: 0, consecutiveFailures: {}, nowMs: 1_000 }],
  ];
  for (const [label, input] of hostileCooling) {
    const r = noThrow('cooling ' + label, () =>
      isCoolingDown(input as { lastFailureAtMs: unknown; consecutiveFailures: unknown; nowMs: unknown }),
    );
    assert(typeof r === 'boolean', 'isCoolingDown(' + label + ') -> boolean', String(r));
  }
  // Specific hostile expectations — all safe-neutral false.
  assertEq(isCoolingDown(null as never), false, 'null input -> false');
  assertEq(isCoolingDown(7 as never), false, 'number input -> false');
  assertEq(isCoolingDown({} as never), false, 'empty obj -> false');
  assertEq(
    isCoolingDown({ lastFailureAtMs: 0, consecutiveFailures: -3, nowMs: 1_000 }),
    false,
    'negative count -> false',
  );
  assertEq(isCoolingDown(throwingInput as never), false, 'throwing getter -> caught, false');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll providerBackoffCore smoke cases passed (' + passes + ' passed).');
}
main();
