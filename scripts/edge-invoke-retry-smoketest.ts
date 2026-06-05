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

// Bounded exponential backoff (deterministic with a fixed jitter source).
const zero = () => 0;
assert.equal(edgeRetryBackoffMs(0, zero), 250);
assert.equal(edgeRetryBackoffMs(1, zero), 500);
assert.equal(edgeRetryBackoffMs(2, zero), 1000);
assert.equal(edgeRetryBackoffMs(10, zero), 2000, 'backoff is capped');
const hi = edgeRetryBackoffMs(0, () => 0.99);
assert(hi >= 250 && hi <= 250 + 150, 'jitter stays within bound');

assert(EDGE_INVOKE_RETRIES >= 1 && EDGE_INVOKE_RETRIES <= 4, 'retry count is sane');

console.log('All edge invoke retry smoke cases passed.');
