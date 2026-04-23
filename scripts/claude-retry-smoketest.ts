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

function parseRetryAfterMs(header: string | null | undefined, nowMs = Date.now()): number | null {
  if (!header) return null;
  const trimmed = header.trim();
  if (!trimmed) return null;
  const HARD_CAP_MS = 10_000;
  if (/^\d+$/.test(trimmed)) {
    const sec = Number(trimmed);
    if (!Number.isFinite(sec) || sec <= 0) return null;
    return Math.min(sec * 1000, HARD_CAP_MS);
  }
  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const deltaMs = parsed - nowMs;
  if (deltaMs <= 0) return null;
  return Math.min(deltaMs, HARD_CAP_MS);
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

  // ─── Retry-After parsing ────────────────────────────────────────
  {
    assert(parseRetryAfterMs(null) === null, 'retry-after: null header → null');
    assert(parseRetryAfterMs(undefined) === null, 'retry-after: undefined → null');
    assert(parseRetryAfterMs('') === null, 'retry-after: empty string → null');
    assert(parseRetryAfterMs('   ') === null, 'retry-after: whitespace only → null');
    assert(parseRetryAfterMs('5') === 5000, 'retry-after: "5" → 5000ms');
    assert(parseRetryAfterMs('0') === null, 'retry-after: "0" → null (no positive delta)');
    assert(parseRetryAfterMs('1') === 1000, 'retry-after: "1" → 1000ms');
    // HARD_CAP_MS = 10_000 — anything larger must be clamped.
    assert(parseRetryAfterMs('30') === 10000, 'retry-after: "30" clamps to 10000ms cap');
    assert(parseRetryAfterMs('600') === 10000, 'retry-after: "600" clamps to cap');

    // Malformed values should return null, NOT throw.
    assert(parseRetryAfterMs('abc') === null, 'retry-after: garbage → null');
    assert(parseRetryAfterMs('-5') === null, 'retry-after: negative → null');
    assert(parseRetryAfterMs('5.5') === null, 'retry-after: decimal → null (spec: integer seconds only)');

    // HTTP-date form: compute a target 3s in the future and verify we
    // get a positive delta within tolerance. Note: `.toUTCString()`
    // truncates to the second, so if `now` has an fractional ms near
    // 999, the observed delta can be as low as ~2001ms. Bound widens
    // accordingly to avoid flakes.
    const now = Date.now();
    const future = new Date(now + 3000).toUTCString();
    const past = new Date(now - 5000).toUTCString();
    const fromFuture = parseRetryAfterMs(future, now);
    assert(fromFuture !== null, 'retry-after: future HTTP-date → non-null');
    assert(fromFuture !== null && fromFuture >= 2000 && fromFuture <= 3500, `retry-after: future HTTP-date delta in [2000,3500]ms (got ${fromFuture})`);
    assert(parseRetryAfterMs(past, now) === null, 'retry-after: past HTTP-date → null (non-positive delta)');

    // HTTP-date way in the future must clamp to cap.
    const farFuture = new Date(now + 60_000).toUTCString();
    const farDelta = parseRetryAfterMs(farFuture, now);
    assert(farDelta === 10000, `retry-after: far-future HTTP-date clamps to cap (got ${farDelta})`);

    // Invalid HTTP-date → null
    assert(parseRetryAfterMs('Not a valid date', now) === null, 'retry-after: invalid date string → null');
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
