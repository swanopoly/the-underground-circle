// OAuth Connect — popup-based OAuth flow for Google, Microsoft, Yahoo
//
// Usage:
//   const result = await openOAuthPopup('google', 'calendar,email', session.access_token);
//   if (result.success) { /* connected! */ }

import { safeGetSession } from './authSession';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export type OAuthProvider = 'google' | 'microsoft' | 'yahoo';

export interface OAuthResult {
  success: boolean;
  provider: string;
  email: string;
  error: string;
}

/**
 * Opens a popup window that initiates the OAuth flow for the given provider.
 * Returns a promise that resolves when the popup sends back a postMessage.
 */
export function openOAuthPopup(
  provider: OAuthProvider,
  scopes: string = 'calendar,email',
  jwt: string
): Promise<OAuthResult> {
  return new Promise((resolve) => {
    // Open the popup synchronously (about:blank) so the browser keeps the click
    // gesture and does not block it; we redirect it to the IdP once the
    // authenticated init returns a URL. The OAuth state is a server-minted nonce
    // — the user's JWT never travels through the IdP / browser history (advisory #6).
    const width = 500;
    const height = 700;
    const left = window.screenX + (window.innerWidth - width) / 2;
    const top = window.screenY + (window.innerHeight - height) / 2;

    const popup = window.open(
      'about:blank',
      `oauth-${provider}`,
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,location=yes,status=no`
    );

    // Listen for postMessage from popup
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'oauth-callback') {
        window.removeEventListener('message', handleMessage);
        clearInterval(checkClosed);
        resolve({
          success: event.data.success,
          provider: event.data.provider || provider,
          email: event.data.email || '',
          error: event.data.error || '',
        });
      }
    };
    window.addEventListener('message', handleMessage);

    // Also check if popup was closed without completing
    const checkClosed = setInterval(() => {
      if (popup?.closed) {
        clearInterval(checkClosed);
        window.removeEventListener('message', handleMessage);
        // Give a short delay in case the message was sent just before close
        setTimeout(() => {
          resolve({
            success: false,
            provider,
            email: '',
            error: 'Window closed',
          });
        }, 500);
      }
    }, 1000);

    // Timeout after 5 minutes
    setTimeout(() => {
      clearInterval(checkClosed);
      window.removeEventListener('message', handleMessage);
      if (popup && !popup.closed) popup.close();
      resolve({
        success: false,
        provider,
        email: '',
        error: 'Timeout',
      });
    }, 5 * 60 * 1000);

    // Authenticated init: mint the IdP authorize URL (carrying a server-stored
    // nonce state) with the bearer token in a header, then point the popup at it.
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/email-calendar-oauth/authorize`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
            body: JSON.stringify({ provider, scopes }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
          window.removeEventListener('message', handleMessage);
          clearInterval(checkClosed);
          if (popup && !popup.closed) popup.close();
          resolve({ success: false, provider, email: '', error: data.error || `Failed to start OAuth (${res.status})` });
          return;
        }
        if (popup) popup.location.href = data.url;
      } catch (e: any) {
        window.removeEventListener('message', handleMessage);
        clearInterval(checkClosed);
        if (popup && !popup.closed) popup.close();
        resolve({ success: false, provider, email: '', error: e?.message || 'Failed to start OAuth' });
      }
    })();
  });
}

/**
 * Check if a provider is connected for the current user.
 */
export async function checkOAuthStatus(
  provider: OAuthProvider
): Promise<{ connected: boolean; email: string }> {
  const { value: session } = await safeGetSession();
  if (!session) return { connected: false, email: '' };

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/functions/v1/email-calendar-oauth/status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ provider }),
      }
    );

    if (!resp.ok) return { connected: false, email: '' };
    const data = await resp.json();
    return { connected: data.connected, email: data.email || '' };
  } catch {
    return { connected: false, email: '' };
  }
}

/**
 * Disconnect a provider (remove stored tokens).
 */
export async function disconnectOAuth(
  provider: OAuthProvider
): Promise<boolean> {
  const { value: session } = await safeGetSession();
  if (!session) return false;

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/functions/v1/email-calendar-oauth/disconnect`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ provider }),
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch real calendar events from the connected provider.
 */
export async function fetchCalendarEvents(
  provider: OAuthProvider
): Promise<{
  events: Array<{
    id: string;
    title: string;
    start: string;
    end: string;
    timeFormatted: string;
    location: string;
    allDay: boolean;
  }>;
  count: number;
  nextEvent: any;
  email: string;
} | null> {
  const { value: session } = await safeGetSession();
  if (!session) return null;

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/functions/v1/email-calendar-oauth/fetch-calendar`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ provider }),
      }
    );

    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * Fetch real emails from the connected provider.
 */
export async function fetchEmails(
  provider: OAuthProvider
): Promise<{
  emails: Array<{
    id: string;
    sender: string;
    subject: string;
    date: string;
    timeFormatted: string;
    snippet: string;
    unread: boolean;
  }>;
  unread: number;
  total: number;
  email: string;
} | null> {
  const { value: session } = await safeGetSession();
  if (!session) return null;

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/functions/v1/email-calendar-oauth/fetch-emails`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ provider }),
      }
    );

    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}
