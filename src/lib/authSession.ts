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
import { shouldRefreshAccessToken } from './authSessionRefreshPolicy';

/**
 * Hang guard. try/catch converts a REJECTION into a null result, but a GoTrue
 * call that never settles (backgrounded-tab AbortController limbo, no-op web
 * lock collisions, a wedged network socket) hangs the awaiting caller forever
 * — the catch never runs. Every export here races the auth call against a
 * bounded timer and settles with the fallback, so "safe" means hang-safe, not
 * just rejection-safe. The underlying promise is left to resolve in the void.
 */
const AUTH_CALL_TIMEOUT_MS = 6_000;

function withAuthTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs = AUTH_CALL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(fallback); }
    }, timeoutMs);
    promise.then(
      (value) => { if (!settled) { settled = true; clearTimeout(timer); resolve(value); } },
      () => { if (!settled) { settled = true; clearTimeout(timer); resolve(fallback); } },
    );
  });
}

export async function getFreshAccessToken(): Promise<string | null> {
  try {
    const { data } = await withAuthTimeout(
      supabase.auth.getSession(),
      { data: { session: null } } as Awaited<ReturnType<typeof supabase.auth.getSession>>,
    );
    const session = data.session;
    if (!session?.access_token) return null;

    const nowSec = Math.floor(Date.now() / 1000);

    // Token still comfortably valid — use it as-is. (Decision is pure/testable
    // in ./authSessionRefreshPolicy.)
    if (!shouldRefreshAccessToken(session.expires_at, nowSec)) {
      return session.access_token;
    }

    // Close to (or past) expiry: force a refresh so the next request lands
    // with a fresh JWT instead of getting rejected with 401.
    //
    // refreshSession() can *throw* (AbortError on a backgrounded tab, no-op
    // web-lock collision) exactly like the getSession/getUser calls this file
    // documents. If we let that throw hit the outer catch we'd return null and
    // discard the still-usable stale token below. Contain it here so a thrown
    // refresh degrades to the same "fall back to the stale token" path as an
    // error result, rather than nuking the caller's session on a transient
    // hiccup.
    let refreshedToken: string | null = null;
    try {
      const { data: refreshed, error } = await withAuthTimeout(
        supabase.auth.refreshSession(),
        { data: { session: null, user: null }, error: null } as Awaited<ReturnType<typeof supabase.auth.refreshSession>>,
      );
      if (!error) refreshedToken = refreshed.session?.access_token ?? null;
    } catch {
      refreshedToken = null;
    }
    if (!refreshedToken) {
      // Refresh failed or threw (offline, invalid refresh token, backgrounded
      // tab, etc). Fall back to the stale token — the edge function will still
      // 401, but that 401 is useful signal for the caller to surface, and a
      // near-expiry token is still better than forcing a null/logout on a
      // transient refresh hiccup.
      return session.access_token;
    }
    return refreshedToken;
  } catch {
    return null;
  }
}

export type SafeAuthResult<T> = { value: T | null; error: Error | null };

/** Resolves to the current user or null. Never throws, never hangs. */
export async function safeGetUser(): Promise<SafeAuthResult<User>> {
  try {
    const { data, error } = await withAuthTimeout(
      supabase.auth.getUser(),
      { data: { user: null }, error: new Error('auth call timed out') } as unknown as Awaited<ReturnType<typeof supabase.auth.getUser>>,
    );
    if (error) return { value: null, error };
    return { value: data.user ?? null, error: null };
  } catch (e) {
    return { value: null, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

/** Resolves to the current session or null. Never throws, never hangs. */
export async function safeGetSession(): Promise<SafeAuthResult<Session>> {
  try {
    const { data, error } = await withAuthTimeout(
      supabase.auth.getSession(),
      { data: { session: null }, error: new Error('auth call timed out') } as unknown as Awaited<ReturnType<typeof supabase.auth.getSession>>,
    );
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
