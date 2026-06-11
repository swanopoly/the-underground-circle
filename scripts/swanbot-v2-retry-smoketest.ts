/**
 * swanbot-v2-retry-smoketest — locks in the pure S4 retry logic for the
 * SwanBot v2 (M2) continuation loop.
 *
 *   1. runWithTransientRetry — success short-circuit, retry-then-succeed,
 *      terminal-no-retry, exhaustion, and the exponential backoff schedule.
 *   2. isRetryableInvokeError — HTTP status, Supabase error classes,
 *      FunctionsHttpError.context.status, message fallback, structural 4xx.
 *
 * Pure: no Supabase, no React Native. Sleeper is injected so it runs
 * instantly. Run: `npm run smoke:swanbot-v2-retry`
 */

import {
  runWithTransientRetry,
  isRetryableInvokeError,
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
    const out = await runWithTransientRetry<string>(async (tryIndex) => {
      calls += 1;
      if (tryIndex < 2) return { ok: false, retryable: true };
      return { ok: true, value: 'recovered' };
    }, { sleep, baseDelayMs: 400, maxRetries: 2, onRetry: (i) => retrySeen.push(i.delayMs) });
    assertEqual(out, 'recovered', 'retry: recovers after transient failures');
    assertEqual(calls, 3, 'retry: 1 initial + 2 retries');
    assertEqual(delays, [400, 800], 'retry: exponential backoff 400→800');
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
    }, { sleep, maxRetries: 2, baseDelayMs: 100 });
    assertEqual(out, null, 'exhaust: returns null after exhaustion');
    assertEqual(calls, 3, 'exhaust: tried 1 + 2 retries');
    assertEqual(delays, [100, 200], 'exhaust: slept between the 3 attempts only');
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

  // ─── isRetryableInvokeError classification ─────────────────────────────
  {
    assertEqual(isRetryableInvokeError(null), false, 'classify: null → false');
    assertEqual(isRetryableInvokeError(undefined), false, 'classify: undefined → false');
    // Shared provider classifier path (status field).
    assertEqual(isRetryableInvokeError({ status: 529 }), true, 'classify: 529 → true');
    assertEqual(isRetryableInvokeError({ status: 503 }), true, 'classify: 503 → true');
    assertEqual(isRetryableInvokeError({ status: 400 }), false, 'classify: 400 → false');
    assertEqual(isRetryableInvokeError({ status: 401 }), false, 'classify: 401 → false');
    // Supabase function-error classes.
    assertEqual(isRetryableInvokeError({ name: 'FunctionsFetchError', message: 'x' }), true, 'classify: FunctionsFetchError → true');
    assertEqual(isRetryableInvokeError({ name: 'FunctionsRelayError', message: 'x' }), true, 'classify: FunctionsRelayError → true');
    // FunctionsHttpError carries status on .context.
    assertEqual(isRetryableInvokeError({ name: 'FunctionsHttpError', context: { status: 429 } }), true, 'classify: HttpError 429 → true');
    assertEqual(isRetryableInvokeError({ name: 'FunctionsHttpError', context: { status: 408 } }), true, 'classify: HttpError 408 → true');
    assertEqual(isRetryableInvokeError({ name: 'FunctionsHttpError', context: { status: 422 } }), false, 'classify: HttpError 422 → false');
    // Message fallback (Supabase network failure).
    assertEqual(isRetryableInvokeError({ message: 'Failed to send a request to the Edge Function' }), true, 'classify: failed-to-send → true');
    // Genuinely structural / unknown.
    assertEqual(isRetryableInvokeError({ message: 'bad input' }), false, 'classify: unknown message → false');
  }

  if (failures > 0) { console.error(`\n${failures} failure(s)`); process.exit(1); }
  console.log('\nAll swanbot-v2-retry smoke cases passed.');
}

main().catch((err) => { console.error('smoke crashed:', err); process.exit(1); });
