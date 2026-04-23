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

/** One-shot fetch — current connection status for the signed-in user. */
export async function getGoogleAuthStatus(): Promise<GoogleAuthStatus> {
  const accessToken = await getFreshAccessToken();
  if (!accessToken) return { connected: false };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/google-oauth?action=status`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return { connected: false };
    return await res.json();
  } catch {
    return { connected: false };
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
    const res = await fetch(`${SUPABASE_URL}/functions/v1/google-oauth?${params}`, {
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
    const res = await fetch(`${SUPABASE_URL}/functions/v1/google-oauth?action=revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Sign in with Google via Supabase Auth. Distinct from the Workspace
 * OAuth above — this is for identity only (email + profile scopes).
 *
 * If the caller passes `withWorkspaceScopes=true`, we request the full
 * Gmail/Calendar/Drive/Sheets/Docs/Contacts scope set at sign-in time,
 * so a fresh user lands with everything wired up after one click.
 * Supabase stores the provider_refresh_token in the session; our
 * edge function reads it on first workspace call to bootstrap
 * `user_google_credentials` without a second OAuth round-trip.
 */
export async function signInWithGoogle(options?: {
  withWorkspaceScopes?: boolean;
  redirectTo?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const scopes = options?.withWorkspaceScopes
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

  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: options?.redirectTo,
      scopes,
      queryParams: {
        // These two together guarantee Google returns a refresh_token.
        // Without them, the user gets a new access_token only, which
        // expires in ~1 hour with no way to refresh.
        access_type: 'offline',
        prompt: 'consent',
      },
    },
  });
  if (error) return { ok: false, reason: error.message };
  return { ok: true };
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
