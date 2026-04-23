/**
 * claude-retry-smoketest — pins the retry classifier + backoff
 * envelope the _claude/anthropic.ts callClaude uses. Deno edge
 * functions can't be imported directly from tsx (esm.sh imports), so
 * we mirror the decision logic here. Real end-to-end behavior is
 * covered by hitting the live endpoint after deploy.
 *
 * Run: npm run smoke:claude-retry
 */

// ─── Mirrors of the retry classification logic ──────────────────────

function isRetryableStatus(status: number): boolean {
  if (status === 429) return true;        // rate limit
  if (status === 529) return true;        // Anthropic overloaded
  if (status >= 500 && status <= 599) return true;
  return false;
}

function backoffMs(attempt: number): number {
  const base = 500 * Math.pow(2, Math.max(0, attempt));
  const capped = Math.min(base, 2000);
  return Math.floor(Math.random() * capped);
}

// Simulate the retry loop with a fake fetch that yields a sequence of responses.
async function runRetryLoop(
  responses: Array<{ status: number } | { throws: string }>,
  maxRetries: number,
): Promise<{ result: 'ok' | 'failed'; attempts: number; finalStatus?: number; error?: string }> {
  let attempt = 0;
  let fetchesMade = 0;
  while (true) {
    const next = responses[Math.min(fetchesMade, responses.length - 1)];
    fetchesMade += 1;
    if ('throws' in next) {
      // Network-level error → retry unless exhausted
      if (attempt < maxRetries) {
        attempt += 1;
        continue;
      }
      return { result: 'failed', attempts: fetchesMade, error: next.throws };
    }
    if (next.status >= 200 && next.status < 300) {
      return { result: 'ok', attempts: fetchesMade, finalStatus: next.status };
    }
    const retryable = isRetryableStatus(next.status);
    if (!retryable || attempt >= maxRetries) {
      return { result: 'failed', attempts: fetchesMade, finalStatus: next.status };
    }
    attempt += 1;
  }
}

// ─── Test runner ──────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

async function main() {
  // ─── Classifier ──────────────────────────────────────────────────
  assert(isRetryableStatus(429), 'classify: 429 rate-limit retryable');
  assert(isRetryableStatus(529), 'classify: 529 Anthropic-specific overloaded retryable');
  assert(isRetryableStatus(500), 'classify: 500 retryable');
  assert(isRetryableStatus(502), 'classify: 502 retryable');
  assert(isRetryableStatus(503), 'classify: 503 retryable');
  assert(isRetryableStatus(504), 'classify: 504 retryable');
  assert(isRetryableStatus(599), 'classify: 599 retryable (upper 5xx)');
  assert(!isRetryableStatus(400), 'classify: 400 bad-request NOT retryable');
  assert(!isRetryableStatus(401), 'classify: 401 auth NOT retryable');
  assert(!isRetryableStatus(403), 'classify: 403 forbidden NOT retryable');
  assert(!isRetryableStatus(404), 'classify: 404 NOT retryable');
  assert(!isRetryableStatus(413), 'classify: 413 payload-too-large NOT retryable');
  assert(!isRetryableStatus(422), 'classify: 422 unprocessable NOT retryable');
  assert(!isRetryableStatus(200), 'classify: 200 NOT retryable (success)');
  assert(!isRetryableStatus(201), 'classify: 201 NOT retryable');
  assert(!isRetryableStatus(300), 'classify: 3xx NOT retryable');

  // ─── Retry loop — happy path (succeeds first attempt) ───────────
  {
    const r = await runRetryLoop([{ status: 200 }], 2);
    assert(r.result === 'ok', 'happy: first attempt OK');
    assert(r.attempts === 1, 'happy: exactly one fetch');
  }

  // ─── Retry loop — 529 then 200 ──────────────────────────────────
  {
    const r = await runRetryLoop([{ status: 529 }, { status: 200 }], 2);
    assert(r.result === 'ok', 'recover: 529 then 200 succeeds');
    assert(r.attempts === 2, 'recover: 2 fetches made');
  }

  // ─── Retry loop — 529, 529, 200 (uses 3rd attempt) ──────────────
  {
    const r = await runRetryLoop([{ status: 529 }, { status: 529 }, { status: 200 }], 2);
    assert(r.result === 'ok', 'recover: 2 retries then succeed');
    assert(r.attempts === 3, 'recover: 3 total attempts');
  }

  // ─── Retry loop — 529 persistent, exhausts retries ──────────────
  {
    const r = await runRetryLoop([{ status: 529 }], 2);
    assert(r.result === 'failed', 'exhausted: 3 persistent 529 → failed');
    assert(r.attempts === 3, 'exhausted: exactly 1 + maxRetries attempts');
    assert(r.finalStatus === 529, 'exhausted: final status is 529');
  }

  // ─── Retry loop — 400 fails fast (NO retry) ─────────────────────
  {
    const r = await runRetryLoop([{ status: 400 }], 2);
    assert(r.result === 'failed', 'fast-fail: 400 fails immediately');
    assert(r.attempts === 1, 'fast-fail: exactly 1 attempt (no retry on structural)');
  }

  // ─── Retry loop — 401 fails fast ────────────────────────────────
  {
    const r = await runRetryLoop([{ status: 401 }], 2);
    assert(r.result === 'failed', '401: fails fast');
    assert(r.attempts === 1, '401: 1 attempt');
  }

  // ─── Retry loop — maxRetries=0 disables retries entirely ────────
  {
    const r = await runRetryLoop([{ status: 529 }, { status: 200 }], 0);
    assert(r.result === 'failed', 'maxRetries=0: 529 is not retried even when retryable');
    assert(r.attempts === 1, 'maxRetries=0: single attempt only');
  }

  // ─── Retry loop — network error then success ───────────────────
  {
    const r = await runRetryLoop([{ throws: 'ECONNRESET' }, { status: 200 }], 2);
    assert(r.result === 'ok', 'network: ECONNRESET then 200 succeeds');
    assert(r.attempts === 2, 'network: recovered on 2nd attempt');
  }

  // ─── Retry loop — network error persistent ─────────────────────
  {
    const r = await runRetryLoop([{ throws: 'network down' }], 2);
    assert(r.result === 'failed', 'network persistent: exhausts retries');
    assert(r.attempts === 3, 'network persistent: 3 attempts');
  }

  // ─── Mixed: network then 529 then success ───────────────────────
  {
    const r = await runRetryLoop([{ throws: 'ETIMEDOUT' }, { status: 529 }, { status: 200 }], 2);
    assert(r.result === 'ok', 'mixed: network + 529 recover');
    assert(r.attempts === 3, 'mixed: 3 attempts');
  }

  // ─── backoffMs envelope ─────────────────────────────────────────
  for (let a = 0; a <= 5; a += 1) {
    const ms = backoffMs(a);
    assert(ms >= 0, `backoff(${a}): non-negative`);
    assert(ms <= 2000, `backoff(${a}): never exceeds 2000ms cap`);
  }
  // Sample distribution — with enough samples we should see some growth in max
  // until the cap kicks in.
  const samples = (attempt: number, count: number) => {
    const max = Array.from({ length: count }, () => backoffMs(attempt)).reduce((a, b) => Math.max(a, b), 0);
    return max;
  };
  const max0 = samples(0, 50);
  const max1 = samples(1, 50);
  assert(max1 <= 2000 && max0 <= 2000, 'backoff: all samples under 2s cap');
  // Attempt 0's ceiling is 500ms — statistically the max of 50 samples
  // should sit below 550ms (allowing tiny slack for Math.floor edge).
  assert(max0 <= 500, `backoff: attempt 0 ceiling ≤ 500 (got ${max0})`);

  if (failures > 0) {
    console.error(`\n${failures} claude-retry smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll claude-retry smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
