/**
 * authSessionRefreshPolicy — the *pure* refresh-vs-use-as-is decision that
 * `getFreshAccessToken` (in ./authSession) relies on.
 *
 * This lives in its own dependency-light module (no `./supabase`, no
 * react-native) so it can be unit-smoke-tested with tsx/esbuild. `authSession`
 * imports `./supabase`, which drags in react-native and can't load under the
 * smoke runner — so the boundary math would otherwise be untestable. Keep this
 * file import-free.
 *
 * The rule: a token is safe to use as-is only while it has strictly more than
 * REFRESH_THRESHOLD_SECONDS of life left. At or below the threshold (including
 * already-expired or missing `expires_at`) we must force an in-line refresh
 * before shipping the JWT to an edge function.
 */

// Refresh if the token has ≤60s left. Tokens default to a 1h lifetime so this
// still leaves plenty of headroom on the common path.
export const REFRESH_THRESHOLD_SECONDS = 60;

/**
 * Decide whether a cached access token can be used as-is or must be refreshed
 * first. Pure: no clock/IO — pass `nowSec` (unix seconds) so it's testable.
 *
 * @param expiresAt unix seconds the token expires (0/undefined => treat as expired)
 * @param nowSec    current unix seconds (Math.floor(Date.now()/1000) in prod)
 */
export function shouldRefreshAccessToken(
  expiresAt: number | undefined | null,
  nowSec: number,
): boolean {
  const exp = expiresAt ?? 0;
  const secondsLeft = exp - nowSec;
  return secondsLeft <= REFRESH_THRESHOLD_SECONDS;
}
