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

type OAuthCallbackMessage = {
  type: 'oauth-callback';
  success: boolean;
  provider: OAuthProvider;
  email: string;
  error: string;
  nonce: string;
};

const PROVIDER_AUTHORIZE_ORIGINS: Record<OAuthProvider, string> = {
  google: 'https://accounts.google.com',
  microsoft: 'https://login.microsoftonline.com',
  yahoo: 'https://api.login.yahoo.com',
};

function createOAuthClientNonce(): string | null {
  try {
    const bytes = new Uint8Array(24);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

function getOAuthCallbackOrigin(): string | null {
  try {
    const origin = window.location.origin;
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

function isAllowedAuthorizeUrl(provider: OAuthProvider, candidate: unknown): candidate is string {
  if (typeof candidate !== 'string') return false;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && url.origin === PROVIDER_AUTHORIZE_ORIGINS[provider];
  } catch {
    return false;
  }
}

function readExpectedCallbackMessage(
  event: MessageEvent,
  popup: Window,
  callbackOrigin: string,
  provider: OAuthProvider,
  clientNonce: string,
): OAuthCallbackMessage | null {
  if (event.origin !== callbackOrigin || event.source !== popup) return null;
  const data = event.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  if (
    data.type !== 'oauth-callback'
    || data.provider !== provider
    || data.nonce !== clientNonce
    || typeof data.success !== 'boolean'
    || typeof data.email !== 'string'
    || typeof data.error !== 'string'
    || data.email.length > 320
    || data.error.length > 500
  ) {
    return null;
  }
  return data as OAuthCallbackMessage;
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
    const clientNonce = createOAuthClientNonce();
    const callbackOrigin = getOAuthCallbackOrigin();
    if (!clientNonce || !callbackOrigin) {
      resolve({
        success: false,
        provider,
        email: '',
        error: 'Secure OAuth initialization is unavailable.',
      });
      return;
    }

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
      `oauth-${provider}-${clientNonce.slice(0, 12)}`,
      `width=${width},height=${height},left=${left},top=${top},toolbar=no,menubar=no,location=yes,status=no`
    );

    if (!popup) {
      resolve({ success: false, provider, email: '', error: 'Popup blocked' });
      return;
    }

    let settled = false;
    let checkClosed: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let closeResolutionTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      window.removeEventListener('message', handleMessage);
      if (checkClosed) clearInterval(checkClosed);
      if (timeout) clearTimeout(timeout);
      if (closeResolutionTimer) clearTimeout(closeResolutionTimer);
    };

    const finish = (result: OAuthResult, closePopup = false) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (closePopup && !popup.closed) popup.close();
      resolve(result);
    };

    // Accept a callback only from this exact popup, the Supabase function
    // origin, the expected provider, and this one browser attempt's nonce.
    const handleMessage = (event: MessageEvent) => {
      const message = readExpectedCallbackMessage(
        event,
        popup,
        callbackOrigin,
        provider,
        clientNonce,
      );
      if (!message) return;
      finish({
        success: message.success,
        provider: message.provider,
        email: message.email,
        error: message.error,
      }, true);
    };
    window.addEventListener('message', handleMessage);

    // Also check if popup was closed without completing
    checkClosed = setInterval(() => {
      if (popup.closed) {
        if (checkClosed) clearInterval(checkClosed);
        // Give a short delay in case the message was sent just before close
        closeResolutionTimer = setTimeout(() => {
          finish({
            success: false,
            provider,
            email: '',
            error: 'Window closed',
          });
        }, 500);
      }
    }, 1000);

    // Timeout after 5 minutes
    timeout = setTimeout(() => {
      finish({
        success: false,
        provider,
        email: '',
        error: 'Timeout',
      }, true);
    }, 5 * 60 * 1000);

    // Authenticated init: mint the IdP authorize URL (carrying a server-stored
    // nonce state) with the bearer token in a header, then point the popup at it.
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/email-calendar-oauth/authorize`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${jwt}`,
              apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ provider, scopes, client_nonce: clientNonce }),
          }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !isAllowedAuthorizeUrl(provider, data.url)) {
          finish({
            success: false,
            provider,
            email: '',
            error: `Failed to start OAuth (${res.status})`,
          }, true);
          return;
        }
        if (!settled) popup.location.href = data.url;
      } catch {
        finish({ success: false, provider, email: '', error: 'Failed to start OAuth' }, true);
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
