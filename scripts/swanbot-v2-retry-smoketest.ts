/**
 * swanbot-v2-retry-smoketest — locks in the pure S4 retry logic for the
 * SwanBot v2 (M2) continuation loop and its hardened full-jitter backoff.
 *
 *   1. runWithTransientRetry — success short-circuit, retry-then-succeed,
 *      terminal-no-retry, exhaustion (max-attempts cap), Retry-After honored,
 *      and the injected-rng backoff schedule.
 *   2. transientBackoffMs — full-jitter bounds (delay ∈ [0, capped ceiling]),
 *      monotonic cap growth then plateau, and Retry-After clamped to the cap.
 *   3. isRetryableInvokeError — the retryable set (429/500/502/503/504/529 +
 *      408/network retry; 400/401/403/404/422 do NOT), Supabase error classes,
 *      FunctionsHttpError.context.status, message fallback.
 *
 * Pure: no Supabase, no React Native. Sleeper + rng are injected so it runs
 * instantly and deterministically. Run: `npm run smoke:swanbot-v2-retry`
 */

import {
  runWithTransientRetry,
  isRetryableInvokeError,
  transientBackoffMs,
  TRANSIENT_RETRY_CAP_MS,
  type RetryAttemptResult,
} from '../src/lib/swanbotV2Retry';

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(name: string) { console.log('pass:', name); }
function assert(ok: boolean, name: string) { if (!ok) fail(name); else pass(name); }
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${name}\n  actual:   ${a}\n  expected: ${e}`);
  else pass(name);
}

/** Sleeper stub that records the delays it was asked to wait, instantly. */
function recordingSleeper() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => { delays.push(ms); } };
}

async function main() {
  // ─── success on first try → no retries, no sleeps ──────────────────────
  {
    const { delays, sleep } = recordingSleeper();
    let calls = 0;
    const out = await runWithTransientRetry<string>(async () => {
      calls += 1;
      return { ok: true, value: 'win' };
    }, { sleep });
    assertEqual(out, 'win', 'success: returns value');
    assertEqual(calls, 1, 'success: called once');
    assertEqual(delays.length, 0, 'success: no sleeps');
  }

  // ─── retryable twice then success → 3 calls, 2 sleeps, backoff schedule ─
  {
    const { delays, sleep } = recordingSleeper();
    const retrySeen: number[] = [];
    let calls = 0;
    // Inject rng=1 so full jitter resolves to the exact ceiling (base*2^n),
    // making the schedule deterministic and equal to the pre-jitter values.
    const out = await runWithTransientRetry<string>(async (tryIndex) => {
      calls += 1;
      if (tryIndex < 2) return { ok: false, retryable: true };
      return { ok: true, value: 'recovered' };
    }, { sleep, baseDelayMs: 400, maxRetries: 2, rng: () => 1, onRetry: (i) => retrySeen.push(i.delayMs) });
    assertEqual(out, 'recovered', 'retry: recovers after transient failures');
    assertEqual(calls, 3, 'retry: 1 initial + 2 retries');
    assertEqual(delays, [400, 800], 'retry: exponential backoff ceiling 400→800 (rng=1)');
    assertEqual(retrySeen, [400, 800], 'retry: onRetry fired with each delay');
  }

  // ─── terminal failure → returns null immediately, no retry ─────────────
  {
    const { delays, sleep } = recordingSleeper();
    let calls = 0;
    const out = await runWithTransientRetry<string>(async () => {
      calls += 1;
      return { ok: false, retryable: false };
    }, { sleep });
    assertEqual(out, null, 'terminal: returns null');
    assertEqual(calls, 1, 'terminal: no retry on structural failure');
    assertEqual(delays.length, 0, 'terminal: no sleeps');
  }

  // ─── always retryable → exhausts at maxRetries, returns null ───────────
  {
    const { delays, sleep } = recordingSleeper();
    let calls = 0;
    const out = await runWithTransientRetry<string>(async () => {
      calls += 1;
      return { ok: false, retryable: true } as RetryAttemptResult<string>;
    }, { sleep, maxRetries: 2, baseDelayMs: 100, rng: () => 1 });
    assertEqual(out, null, 'exhaust: returns null after exhaustion');
    assertEqual(calls, 3, 'exhaust: tried 1 + 2 retries');
    assertEqual(delays, [100, 200], 'exhaust: slept between the 3 attempts only (rng=1)');
  }

  // ─── max-attempts cap: attempts never exceed 1 + maxRetries ────────────
  {
    const { delays, sleep } = recordingSleeper();
    let calls = 0;
    await runWithTransientRetry<string>(async () => {
      calls += 1;
      return { ok: false, retryable: true };
    }, { sleep, maxRetries: 3, baseDelayMs: 10, rng: () => 0 });
    assertEqual(calls, 4, 'max-attempts: 1 + maxRetries(3) = 4 attempts, no more');
    assertEqual(delays.length, 3, 'max-attempts: exactly maxRetries sleeps');
  }

  // ─── maxRetries: 0 → single attempt, never sleeps ──────────────────────
  {
    const { delays, sleep } = recordingSleeper();
    let calls = 0;
    const out = await runWithTransientRetry<string>(async () => {
      calls += 1;
      return { ok: false, retryable: true };
    }, { sleep, maxRetries: 0 });
    assertEqual(out, null, 'no-retry: null');
    assertEqual(calls, 1, 'no-retry: exactly one attempt');
    assertEqual(delays.length, 0, 'no-retry: no sleeps');
  }

  // ─── Retry-After honored: server hint drives the next wait (clamped) ───
  {
    const { delays, sleep } = recordingSleeper();
    const seen: number[] = [];
    let calls = 0;
    await runWithTransientRetry<string>(async (tryIndex) => {
      calls += 1;
      if (tryIndex === 0) return { ok: false, retryable: true, retryAfterMs: 1500 };
      return { ok: true, value: 'ok' };
    }, { sleep, baseDelayMs: 400, maxRetries: 2, rng: () => 0, onRetry: (i) => seen.push(i.delayMs) });
    assertEqual(delays, [1500], 'retry-after: server hint (1500ms) used verbatim, not jittered backoff');
    assertEqual(seen, [1500], 'retry-after: onRetry reports the honored delay');
  }
  {
    const { delays, sleep } = recordingSleeper();
    await runWithTransientRetry<string>(async (tryIndex) => {
      if (tryIndex === 0) return { ok: false, retryable: true, retryAfterMs: 999_999 };
      return { ok: true, value: 'ok' };
    }, { sleep, baseDelayMs: 400, maxRetries: 2, capMs: 20_000, rng: () => 0 });
    assertEqual(delays, [20_000], 'retry-after: hostile huge hint clamped to cap (20s)');
  }

  // ─── transientBackoffMs: full-jitter bounds + monotonic cap plateau ────
  {
    // rng=0 → floor of the window is always 0 (full jitter includes 0).
    for (let n = 0; n <= 10; n += 1) {
      assertEqual(transientBackoffMs(n, { baseDelayMs: 400, capMs: 20_000, rng: () => 0 }), 0,
        `jitter: rng=0 → 0 at attempt ${n} (window starts at 0)`);
    }
    // rng=1 → the ceiling; assert the doubling schedule per attempt.
    const ceilAt = (n: number) => transientBackoffMs(n, { baseDelayMs: 400, capMs: 20_000, rng: () => 1 });
    assertEqual(ceilAt(0), 400, 'jitter: attempt 0 ceiling = base (400)');
    assertEqual(ceilAt(1), 800, 'jitter: attempt 1 ceiling = 800');
    assertEqual(ceilAt(2), 1600, 'jitter: attempt 2 ceiling = 1600');
    assertEqual(ceilAt(3), 3200, 'jitter: attempt 3 ceiling = 3200');
    // Monotonic growth until the cap, then a hard plateau at cap.
    assert(ceilAt(0) < ceilAt(1) && ceilAt(1) < ceilAt(2) && ceilAt(2) < ceilAt(3),
      'jitter: ceiling grows monotonically before the cap');
    assertEqual(ceilAt(6), 20_000, 'jitter: attempt 6 (25600 raw) plateaus at cap');
    assertEqual(ceilAt(50), 20_000, 'jitter: huge attempt plateaus at cap (no growth past cap)');
    assertEqual(ceilAt(1000), 20_000, 'jitter: 2^1000 overflow collapses to cap, still finite');
    // Mid-range rng stays strictly inside [0, ceiling].
    const mid = transientBackoffMs(2, { baseDelayMs: 400, capMs: 20_000, rng: () => 0.5 });
    assert(mid >= 0 && mid <= 1600, `jitter: rng=0.5 sample in [0,1600] (got ${mid})`);
    assertEqual(mid, 800, 'jitter: rng=0.5 at attempt 2 = 800 (half the ceiling)');
    // Out-of-range / NaN rng is clamped, never negative / NaN.
    assert(transientBackoffMs(1, { rng: () => -5 }) === 0, 'jitter: negative rng clamped to 0');
    assert(transientBackoffMs(1, { rng: () => Number.NaN }) === 0, 'jitter: NaN rng clamped to 0');
    assertEqual(transientBackoffMs(1, { baseDelayMs: 400, rng: () => 5 }), 800, 'jitter: rng>1 clamped to 1 → ceiling');
    // Default cap constant is a sane bound.
    assert(TRANSIENT_RETRY_CAP_MS >= 5_000 && TRANSIENT_RETRY_CAP_MS <= 60_000, 'cap: default is a sane bound');
  }

  // ─── isRetryableInvokeError classification — the canonical retryable set ─
  {
    assertEqual(isRetryableInvokeError(null), false, 'classify: null → false');
    assertEqual(isRetryableInvokeError(undefined), false, 'classify: undefined → false');
    // Retryable set: 429/500/502/503/504/529 (+ 408 timeout).
    assertEqual(isRetryableInvokeError({ status: 429 }), true, 'classify: 429 → true');
    assertEqual(isRetryableInvokeError({ status: 500 }), true, 'classify: 500 → true');
    assertEqual(isRetryableInvokeError({ status: 502 }), true, 'classify: 502 → true');
    assertEqual(isRetryableInvokeError({ status: 503 }), true, 'classify: 503 → true');
    assertEqual(isRetryableInvokeError({ status: 504 }), true, 'classify: 504 → true');
    assertEqual(isRetryableInvokeError({ status: 529 }), true, 'classify: 529 overloaded → true');
    // Structural — must NOT retry.
    assertEqual(isRetryableInvokeError({ status: 400 }), false, 'classify: 400 → false');
    assertEqual(isRetryableInvokeError({ status: 401 }), false, 'classify: 401 → false');
    assertEqual(isRetryableInvokeError({ status: 403 }), false, 'classify: 403 → false');
    assertEqual(isRetryableInvokeError({ status: 404 }), false, 'classify: 404 → false');
    assertEqual(isRetryableInvokeError({ status: 422 }), false, 'classify: 422 → false');
    // Supabase function-error classes.
    assertEqual(isRetryableInvokeError({ name: 'FunctionsFetchError', message: 'x' }), true, 'classify: FunctionsFetchError → true');
    assertEqual(isRetryableInvokeError({ name: 'FunctionsRelayError', message: 'x' }), true, 'classify: FunctionsRelayError → true');
    // FunctionsHttpError carries status on .context.
    assertEqual(isRetryableInvokeError({ name: 'FunctionsHttpError', context: { status: 429 } }), true, 'classify: HttpError 429 → true');
    assertEqual(isRetryableInvokeError({ name: 'FunctionsHttpError', context: { status: 503 } }), true, 'classify: HttpError 503 → true');
    assertEqual(isRetryableInvokeError({ name: 'FunctionsHttpError', context: { status: 408 } }), true, 'classify: HttpError 408 → true');
    assertEqual(isRetryableInvokeError({ name: 'FunctionsHttpError', context: { status: 422 } }), false, 'classify: HttpError 422 → false');
    assertEqual(isRetryableInvokeError({ name: 'FunctionsHttpError', context: { status: 400 } }), false, 'classify: HttpError 400 → false');
    // Message fallback (Supabase network failure).
    assertEqual(isRetryableInvokeError({ message: 'Failed to send a request to the Edge Function' }), true, 'classify: failed-to-send → true');
    // Genuinely structural / unknown.
    assertEqual(isRetryableInvokeError({ message: 'bad input' }), false, 'classify: unknown message → false');
  }

  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nAll swanbot-v2-retry smoke cases passed.');
}

main().catch((err) => { console.error('smoke crashed:', err); process.exit(1); });
