/**
 * googleCreds — client helpers for the Google Workspace integration.
 *
 * Two surfaces:
 *   1. Sign-in path   — via Supabase Auth (`supabase.auth.signInWithOAuth`)
 *   2. Workspace path — via the `google-oauth` edge function (this file)
 *
 * The sign-in path gives us an identity. The workspace path gives us a
 * long-lived refresh token that edge functions use to call Gmail /
 * Calendar / Drive / Sheets / Docs / Contacts APIs on the user's behalf.
 *
 * Users can do either independently:
 *   - Sign in with email → connect Google Workspace later in Settings
 *   - Sign in with Google → workspace scopes available immediately if the
 *     user opted in during sign-in, otherwise connect in Settings
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { getFreshAccessToken } from './authSession';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';

export type GoogleService = 'email' | 'calendar' | 'drive' | 'sheets' | 'docs' | 'contacts';

export interface GoogleAuthStatus {
  connected: boolean;
  email?: string;
  scopes?: string[];
  expires_at?: string;
  updated_at?: string;
}

/**
 * Bounded fetch: every googleCreds call already degrades cleanly on
 * REJECTION, but a fetch against a hung edge function never rejects — it
 * pinned useGoogleAuthStatus at loading:true forever. 8s cap; AbortController
 * (not AbortSignal.timeout) for RN/Hermes compatibility.
 */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 8_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
}

/** One-shot fetch — current connection status for the signed-in user. */
export async function getGoogleAuthStatus(): Promise<GoogleAuthStatus> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) return { connected: false };
  try {
    const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/google-oauth?action=status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { connected: false };
    return await res.json();
  } catch {
    return { connected: false };
  }
}

/**
 * AUTHORITATIVE status probe: returns `null` when the answer is UNKNOWN — no
 * session token, transport error, non-OK response, or malformed body — instead
 * of collapsing those into `{connected:false}` like {@link getGoogleAuthStatus}
 * does. Callers that gate behavior on an EXPLICIT false (e.g. the v2
 * connectivity snapshot, whose tristate contract is "omit when unknown; only
 * literal false gates") must use this variant so a transient status-endpoint
 * blip is never reported as "Google is not connected".
 */
export async function getGoogleAuthStatusAuthoritative(): Promise<GoogleAuthStatus | null> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) return null;
  try {
    const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/google-oauth?action=status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body.connected !== 'boolean') return null;
    return body as GoogleAuthStatus;
  } catch {
    return null;
  }
}

/**
 * Returns a currently-valid Google Workspace access token via the edge fn's
 * `?action=token` route, which refreshes with the stored refresh_token when
 * the cached one has expired (P14 durability fix — connections made weeks ago
 * keep working). Returns null when not connected or when Google demands a
 * reconnect. The refresh_token itself never reaches the client.
 */
export async function fetchGoogleWorkspaceAccessToken(): Promise<string | null> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) return null;
  try {
    const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/google-oauth?action=token`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.access_token === 'string' && data.access_token ? data.access_token : null;
  } catch {
    return null;
  }
}

/**
 * Open the Google consent URL in a new tab/window. User grants scopes,
 * Google redirects to our edge fn callback which stores the refresh
 * token, then redirects back to the app with `?google_oauth=ok`.
 *
 * Returns `{opened: true}` if the flow was launched. The caller should
 * re-check `getGoogleAuthStatus()` after the user returns (e.g. on
 * window focus or visibility change).
 */
export async function startGoogleWorkspaceOAuth(
  services: GoogleService[] = ['email', 'calendar', 'drive', 'sheets', 'docs', 'contacts'],
): Promise<{ opened: boolean; reason?: string }> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) return { opened: false, reason: 'Not signed in' };

  if (typeof window === 'undefined') {
    return { opened: false, reason: 'Google OAuth requires a browser window' };
  }

  try {
    const params = new URLSearchParams({
      action: 'authorize',
      services: services.join(','),
    });
    const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/google-oauth?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text();
      return { opened: false, reason: `Authorize failed: ${res.status} ${body.slice(0, 120)}` };
    }
    const { url } = await res.json();
    if (!url) return { opened: false, reason: 'Server returned no auth URL' };

    // Open in same tab — Google's consent page will redirect back to us.
    // Opening in a popup is nicer but many browsers block it unless the
    // click is the direct user gesture. Same-tab is the reliable path.
    window.location.href = url;
    return { opened: true };
  } catch (err: any) {
    return { opened: false, reason: err?.message || 'Network error starting OAuth' };
  }
}

/** Revoke on Google's side and delete the local credential row. */
export async function revokeGoogleWorkspace(): Promise<boolean> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) return false;
  try {
    const res = await fetchWithTimeout(`${SUPABASE_URL}/functions/v1/google-oauth?action=revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sign in with Google via Supabase Auth. Acts as both sign-in AND
 * sign-up — Supabase auto-creates a user row on first OAuth callback
 * when "Enable Sign Ups" is on in the dashboard, so a user with no
 * existing account is created and signed in in the same click.
 *
 * Defaults are deliberately minimal:
 *   - `openid email profile` only. No Gmail / Drive scope ask on first
 *     sign-in (that consent screen scared users away). When the user
 *     later wants Gmail / Calendar agents, Settings prompts for the
 *     workspace scopes via `startGoogleWorkspaceOAuth`.
 *   - `redirectTo` defaults to `window.location.origin` so the live
 *     site at app.chrisswanson.xyz lands the user back at app.chrisswanson.xyz
 *     instead of whatever the Supabase dashboard "Site URL" was set to.
 *     Make sure the same origin is whitelisted in the Google Cloud
 *     Console OAuth client and Supabase Dashboard → Auth → URL
 *     Configuration → Redirect URLs.
 *
 * Pass `withWorkspaceScopes=true` to request the full Gmail / Calendar
 * / Drive / Sheets / Docs / Contacts set at sign-in. Only do this from
 * an explicit "connect Google Workspace" CTA — never as the default
 * sign-in path.
 */
export async function signInWithGoogle(options?: {
  withWorkspaceScopes?: boolean;
  redirectTo?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const wantsWorkspace = !!options?.withWorkspaceScopes;
  const scopes = wantsWorkspace
    ? [
        'openid', 'email', 'profile',
        'https://www.googleapis.com/auth/gmail.modify',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/spreadsheets',
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/contacts.readonly',
      ].join(' ')
    : 'openid email profile';

  // Default the redirect to the current origin. Without this Supabase
  // falls back to the dashboard "Site URL" — that mismatch is the
  // most common cause of `redirect_uri_mismatch` from Google in prod.
  const redirectTo =
    options?.redirectTo ??
    (typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : undefined);

  // `access_type=offline` + `prompt=consent` are only useful when we
  // need a refresh_token (workspace scopes). For pure identity sign-in
  // they just force the consent dialog every login — annoying for
  // returning users.
  const queryParams: Record<string, string> = wantsWorkspace
    ? { access_type: 'offline', prompt: 'consent' }
    : {};

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      scopes,
      queryParams,
    },
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
}

/** Read OAuth error params Supabase / Google leaves on the URL after a
 *  failed redirect (e.g. `?error=access_denied&error_description=...`).
 *  Returns null when the URL is clean. Auth screens call this on mount
 *  so the user actually sees what went wrong instead of bouncing back
 *  to a clean login form.
 *
 *  Side effect: when an error is found, the params are stripped from
 *  the URL (history.replaceState) so a refresh doesn't re-show the
 *  same banner.
 */
export function readOAuthErrorFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const url = new URL(window.location.href);
    const queryError = url.searchParams.get('error_description') || url.searchParams.get('error');
    // Supabase sometimes returns errors in the hash (#error=...&error_description=...)
    // because the OAuth response_type is `token` for some flows.
    let hashError: string | null = null;
    if (url.hash && url.hash.length > 1) {
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
      hashError = hashParams.get('error_description') || hashParams.get('error');
    }
    const found = queryError || hashError;
    if (!found) return null;

    // Clean the URL so a refresh doesn't replay the error banner.
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    url.searchParams.delete('error_code');
    url.hash = '';
    window.history.replaceState(null, '', url.toString());
    return decodeURIComponent(found);
  } catch {
    return null;
  }
}

/** React hook — status + live refresh on window focus. Used by
 *  Settings > Google Workspace to show real-time connection state. */
export function useGoogleAuthStatus(): GoogleAuthStatus & { loading: boolean; refresh: () => Promise<void> } {
  const [state, setState] = useState<GoogleAuthStatus>({ connected: false });
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const next = await getGoogleAuthStatus();
    if (mountedRef.current) {
      setState(next);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();

    // Auto-refresh when the tab becomes visible — catches the case
    // where the user completed the consent flow in another tab.
    if (typeof document !== 'undefined') {
      const onVis = () => { if (document.visibilityState === 'visible') refresh(); };
      document.addEventListener('visibilitychange', onVis);
      return () => {
        mountedRef.current = false;
        document.removeEventListener('visibilitychange', onVis);
      };
    }
    return () => { mountedRef.current = false; };
  }, [refresh]);

  return { ...state, loading, refresh };
}

/** Friendly service labels for the Settings UI service selector. */
export const GOOGLE_SERVICE_LABELS: Record<GoogleService, string> = {
  email:    'Gmail',
  calendar: 'Calendar',
  drive:    'Drive',
  sheets:   'Sheets',
  docs:     'Docs',
  contacts: 'Contacts',
};

/** Given a scopes array returned by the edge fn, derive the granted
 *  service set for display (scopes include long URL strings we don't
 *  want to render to users). */
export function scopesToServices(scopes: string[] | undefined): GoogleService[] {
  if (!scopes) return [];
  const out = new Set<GoogleService>();
  for (const s of scopes) {
    if (s.includes('gmail'))       out.add('email');
    if (s.includes('calendar'))    out.add('calendar');
    if (s.includes('drive'))       out.add('drive');
    if (s.includes('spreadsheets'))out.add('sheets');
    if (s.includes('documents'))   out.add('docs');
    if (s.includes('contacts'))    out.add('contacts');
  }
  return Array.from(out);
}
