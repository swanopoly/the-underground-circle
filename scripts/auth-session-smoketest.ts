/**
 * auth-session-smoketest — verifies the pure refresh-vs-use-as-is decision that
 * `getFreshAccessToken` (src/lib/authSession.ts) depends on, extracted into
 * src/lib/authSessionRefreshPolicy.ts so it's tsx-importable (authSession.ts
 * itself pulls in ./supabase -> react-native and can't load under the smoke
 * runner).
 *
 * Invariants under test:
 *   1. A token with comfortably more than the threshold left is used as-is
 *      (no refresh).
 *   2. A token exactly at the threshold boundary refreshes (`<=`, not `<`),
 *      so we never ship a JWT with ≤60s of life to an edge function.
 *   3. An already-expired token refreshes.
 *   4. Missing/zero/undefined `expires_at` fails closed -> refresh.
 *   5. The exported threshold is the documented 60s.
 *
 * Run: npx tsx scripts/auth-session-smoketest.ts
 */

import assert from 'node:assert/strict';
import {
  REFRESH_THRESHOLD_SECONDS,
  shouldRefreshAccessToken,
} from '../src/lib/authSessionRefreshPolicy';

let passCount = 0;
function pass(label: string) {
  passCount += 1;
  console.log(`PASS ${passCount}: ${label}`);
}

async function main() {
  const now = 1_000_000; // arbitrary fixed "now" in unix seconds

  // 1. Comfortably valid -> use as-is.
  assert.equal(
    shouldRefreshAccessToken(now + 3600, now),
    false,
    'fresh token (1h left) should be used as-is',
  );
  assert.equal(
    shouldRefreshAccessToken(now + REFRESH_THRESHOLD_SECONDS + 1, now),
    false,
    'token with threshold+1s left should be used as-is',
  );
  pass('valid tokens above the threshold are used as-is (no refresh)');

  // 2. Boundary is inclusive-refresh (<=): exactly threshold seconds left
  //    must refresh, so a request never lands with a token at/under 60s.
  assert.equal(
    shouldRefreshAccessToken(now + REFRESH_THRESHOLD_SECONDS, now),
    true,
    'token with exactly threshold seconds left must refresh (<=, not <)',
  );
  assert.equal(
    shouldRefreshAccessToken(now + REFRESH_THRESHOLD_SECONDS - 1, now),
    true,
    'token below the threshold must refresh',
  );
  pass('threshold boundary refreshes (<=), never shipping a ≤60s token');

  // 3. Already expired -> refresh.
  assert.equal(
    shouldRefreshAccessToken(now - 1, now),
    true,
    'expired token must refresh',
  );
  assert.equal(
    shouldRefreshAccessToken(now, now),
    true,
    'token expiring exactly now must refresh',
  );
  pass('expired / expiring-now tokens refresh');

  // 4. Missing expiry fails closed -> refresh (matches `expires_at ?? 0`).
  for (const missing of [0, undefined, null] as const) {
    assert.equal(
      shouldRefreshAccessToken(missing, now),
      true,
      `missing/zero expires_at (${String(missing)}) must fail closed to refresh`,
    );
  }
  pass('missing/zero/undefined/null expires_at fails closed to refresh');

  // 5. Documented threshold constant is 60s (1h token lifetime headroom).
  assert.equal(REFRESH_THRESHOLD_SECONDS, 60, 'threshold stays the documented 60s');
  pass('REFRESH_THRESHOLD_SECONDS is 60');

  console.log(`All auth-session smoke cases passed (${passCount} PASS).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
