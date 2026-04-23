/**
 * authSession — single source of truth for "give me a valid access token
 * right now." Wrap every edge-function call in `getFreshAccessToken()`
 * instead of reaching for `supabase.auth.getSession()` directly so we don't
 * ship expired JWTs to Supabase and get 401s back.
 *
 * Supabase's JS client auto-refreshes tokens in the background, but that
 * refresh can lag behind an active request (no-op lock on web, tab-visibility
 * hiccups, laptop sleep). This helper forces an in-line refresh whenever the
 * cached session is within the expiry threshold.
 *
 * Also exports `safeGetUser` / `safeGetSession` — drop-in replacements for the
 * raw supabase.auth calls that never throw (Supabase can emit AbortError when
 * a tab is backgrounded, or fail silently when the no-op lock on web collides
 * with a token refresh). Every unhandled rejection we ship is a potential
 * white-screen, so use the safe helpers at call sites that only need "who is
 * this user, or null".
 */

import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Refresh if the token has ≤60s left. Tokens default to a 1h lifetime so this
// still leaves plenty of headroom on the common path.
const REFRESH_THRESHOLD_SECONDS = 60;

export async function getFreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data.session;
    if (!session?.access_token) return null;

    const expiresAt = session.expires_at ?? 0; // unix seconds
    const nowSec = Math.floor(Date.now() / 1000);
    const secondsLeft = expiresAt - nowSec;

    // Token still comfortably valid — use it as-is.
    if (secondsLeft > REFRESH_THRESHOLD_SECONDS) {
      return session.access_token;
    }

    // Close to (or past) expiry: force a refresh so the next request lands
    // with a fresh JWT instead of getting rejected with 401.
    const { data: refreshed, error } = await supabase.auth.refreshSession();
    if (error || !refreshed.session?.access_token) {
      // Refresh failed (offline, invalid refresh token, etc). Fall back to the
      // stale token — the edge function will still 401, but that 401 is
      // useful signal for the caller to surface.
      return session.access_token;
    }
    return refreshed.session.access_token;
  } catch {
    return null;
  }
}

export type SafeAuthResult<T> = { value: T | null; error: Error | null };

/** Resolves to the current user or null. Never throws. */
export async function safeGetUser(): Promise<SafeAuthResult<User>> {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error) return { value: null, error };
    return { value: data.user ?? null, error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** Resolves to the current session or null. Never throws. */
export async function safeGetSession(): Promise<SafeAuthResult<Session>> {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) return { value: null, error };
    return { value: data.session ?? null, error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** Convenience — just the user id, or null. Never throws. */
export async function safeGetUserId(): Promise<string | null> {
  const { value } = await safeGetUser();
  return value?.id ?? null;
}
