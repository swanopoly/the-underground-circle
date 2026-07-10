/**
 * edge-invoke-retry-smoketest
 *
 * Pins the transient-vs-permanent classifier + bounded backoff the tool loop
 * uses to retry its per-round edge invoke. Transient (network/relay/5xx/429/
 * empty) retries; a usable body or a deterministic 4xx does not.
 *
 * Run: npm run smoke:edge-invoke-retry
 */

import assert from 'node:assert/strict';

import {
  isRetryableEdgeFailure,
  edgeRetryBackoffMs,
  EDGE_INVOKE_RETRIES,
} from '../src/lib/edgeInvokeRetry';

// A usable response is never "transient" — caller handles it.
assert.equal(isRetryableEdgeFailure({ hasData: true }), false);
assert.equal(isRetryableEdgeFailure({ hasData: true, errorName: 'FunctionsFetchError' }), false);

// HTTP status: 5xx / 429 retry; 4xx does not.
for (const status of [500, 502, 503, 504, 429]) {
  assert.equal(isRetryableEdgeFailure({ hasData: false, status }), true, `status ${status} retries`);
}
for (const status of [400, 401, 403, 404, 422]) {
  assert.equal(isRetryableEdgeFailure({ hasData: false, status }), false, `status ${status} does not retry`);
}

// supabase-js transient error classes (network/relay).
assert.equal(isRetryableEdgeFailure({ hasData: false, errorName: 'FunctionsFetchError' }), true);
assert.equal(isRetryableEdgeFailure({ hasData: false, errorName: 'FunctionsRelayError' }), true);

// Message-based transient signals.
for (const msg of ['network error', 'request timed out', 'fetch failed', 'ECONNRESET', 'service unavailable', 'temporarily down', 'rate limit']) {
  assert.equal(isRetryableEdgeFailure({ hasData: false, errorMessage: msg }), true, `"${msg}" retries`);
}

// Empty failure (no data, no usable error info) → transient blip.
assert.equal(isRetryableEdgeFailure({ hasData: false }), true);
// A deterministic named error with no transient signal → do not retry.
assert.equal(isRetryableEdgeFailure({ hasData: false, errorName: 'FunctionsHttpError', errorMessage: 'bad request: missing field' }), false);

// The canonical retryable set, pinned explicitly (429/500/502/503/504/529 →
// retry; 400/401/403/404/422 → do not). 529 (Anthropic overloaded) must be in.
for (const status of [429, 500, 502, 503, 504, 529]) {
  assert.equal(isRetryableEdgeFailure({ hasData: false, status }), true, `retryable set includes ${status}`);
}
for (const status of [400, 401, 403, 404, 422]) {
  assert.equal(isRetryableEdgeFailure({ hasData: false, status }), false, `retryable set excludes ${status}`);
}

// Bounded exponential backoff (deterministic with a fixed jitter source).
const zero = () => 0;
assert.equal(edgeRetryBackoffMs(0, zero), 250);
assert.equal(edgeRetryBackoffMs(1, zero), 500);
assert.equal(edgeRetryBackoffMs(2, zero), 1000);
assert.equal(edgeRetryBackoffMs(10, zero), 2000, 'backoff is capped');
const hi = edgeRetryBackoffMs(0, () => 0.99);
assert(hi >= 250 && hi <= 250 + 150, 'jitter stays within bound');

// Backoff is monotonic non-decreasing across attempts then plateaus at the cap
// (base component grows 250→500→1000→2000→2000 with a fixed rng).
const baseSeq = [0, 1, 2, 3, 4, 10].map((a) => edgeRetryBackoffMs(a, zero));
for (let i = 1; i < baseSeq.length; i += 1) {
  assert(baseSeq[i] >= baseSeq[i - 1], `backoff non-decreasing at step ${i} (${baseSeq[i - 1]}→${baseSeq[i]})`);
}
assert.equal(baseSeq[baseSeq.length - 1], 2000, 'backoff plateaus at the 2000ms cap');
// Every sampled delay sits within [base, base+jitterMax] regardless of rng.
for (const a of [0, 1, 2, 5]) {
  const lo = edgeRetryBackoffMs(a, () => 0);
  const anyR = edgeRetryBackoffMs(a, () => Math.random());
  assert(anyR >= lo && anyR <= lo + 150, `attempt ${a}: sampled delay within [${lo}, ${lo + 150}]`);
}

assert(EDGE_INVOKE_RETRIES >= 1 && EDGE_INVOKE_RETRIES <= 4, 'retry count is sane (max-attempts cap)');

console.log('All edge invoke retry smoke cases passed.');
