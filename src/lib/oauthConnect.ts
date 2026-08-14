// OAuth Connect — popup-based OAuth flow for Office and Figma integrations.
//
// Usage:
//   const result = await openOAuthPopup('google', 'calendar,email', session.access_token);
//   if (result.success) { /* connected! */ }

import { getFreshAccessToken } from './authSession';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';

export type OfficeOAuthProvider = 'google' | 'microsoft';
export type OAuthProvider = OfficeOAuthProvider | 'figma';
export type OAuthServiceScope = 'calendar' | 'email';

export interface OAuthResult {
  success: boolean;
  provider: string;
  email: string;
  error: string;
}

export type OAuthConnectionStatus = {
  state: 'connected' | 'disconnected' | 'reconnect_required' | 'unavailable';
  connected: boolean;
  email: string;
};

export type FigmaOAuthConnectionStatus = {
  state: 'connected' | 'disconnected' | 'reconnect_required' | 'unavailable';
  connected: boolean;
  accountId: string;
};

export type FigmaOAuthDisconnectResult =
  | { outcome: 'disconnected'; disconnected: true }
  | { outcome: 'unknown'; disconnected: false };

export type OAuthAuthorityFence = () => boolean;

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
  figma: 'https://www.figma.com',
};

const PROVIDER_FUNCTIONS: Record<OAuthProvider, string> = {
  google: 'email-calendar-oauth',
  microsoft: 'email-calendar-oauth',
  figma: 'figma-oauth',
};

const OAUTH_CLIENT_DEADLINE_MS = 15_000;

class OAuthClientDeadlineError extends Error {
  constructor() {
    super('OAuth client deadline exceeded');
    this.name = 'OAuthClientDeadlineError';
  }
}

class OAuthClientAbortError extends Error {
  constructor() {
    super('OAuth client operation aborted');
    this.name = 'OAuthClientAbortError';
  }
}

/**
 * Apply one absolute client deadline to auth refresh, request headers, and the
 * response body. Aborting only fetch would leave a stalled auth refresh or
 * body read able to hold the UI busy forever.
 */
async function withOAuthClientDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  callerSignal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let removeCallerAbortListener: (() => void) | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new OAuthClientDeadlineError());
    }, OAUTH_CLIENT_DEADLINE_MS);
  });
  const callerAbort = callerSignal
    ? new Promise<never>((_, reject) => {
        const abort = () => {
          controller.abort();
          reject(new OAuthClientAbortError());
        };
        if (callerSignal.aborted) {
          abort();
          return;
        }
        callerSignal.addEventListener('abort', abort, { once: true });
        removeCallerAbortListener = () => callerSignal.removeEventListener('abort', abort);
      })
    : null;

  try {
    const operations: Promise<T>[] = [operation(controller.signal), deadline];
    if (callerAbort) operations.push(callerAbort);
    return await Promise.race(operations);
  } finally {
    if (timeout) clearTimeout(timeout);
    removeCallerAbortListener?.();
  }
}

function oauthAuthorityIsCurrent(
  isAuthorityCurrent?: OAuthAuthorityFence,
  signal?: AbortSignal,
): boolean {
  if (signal?.aborted) return false;
  if (!isAuthorityCurrent) return true;
  try {
    return isAuthorityCurrent() === true;
  } catch {
    return false;
  }
}

async function resolveDisconnectBearer(
  capturedBearer: string | undefined,
  isAuthorityCurrent: OAuthAuthorityFence | undefined,
  signal: AbortSignal,
): Promise<string | null> {
  if (!oauthAuthorityIsCurrent(isAuthorityCurrent, signal)) return null;

  // An exact-authority mutation must use the bearer captured with that
  // authority. Falling back to a newly active global session could disconnect
  // the account that replaced it while this async operation was in flight.
  if (isAuthorityCurrent && !capturedBearer) return null;
  const accessToken = capturedBearer || await getFreshAccessToken();
  if (!oauthAuthorityIsCurrent(isAuthorityCurrent, signal)) return null;
  return accessToken || null;
}

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
  scopes: string | undefined,
  jwt?: string,
  isAuthorityCurrent?: () => boolean,
): Promise<OAuthResult> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve({
        success: false,
        provider,
        email: '',
        error: 'OAuth connections must be completed in the web app.',
      });
      return;
    }
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
    const authorityIsCurrent = () => {
      if (!isAuthorityCurrent) return true;
      try { return isAuthorityCurrent() === true; } catch { return false; }
    };

    // Accept a callback only from this exact popup, the Supabase function
    // origin, the expected provider, and this one browser attempt's nonce.
    const handleMessage = (event: MessageEvent) => {
      if (!authorityIsCurrent()) {
        finish({ success: false, provider, email: '', error: 'The signed-in account changed.' }, true);
        return;
      }
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
      if (!authorityIsCurrent()) {
        finish({ success: false, provider, email: '', error: 'The signed-in account changed.' }, true);
        return;
      }
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
        await withOAuthClientDeadline(async (signal) => {
          if (!authorityIsCurrent()) {
            finish({ success: false, provider, email: '', error: 'The signed-in account changed.' }, true);
            return;
          }
          const accessToken = jwt || await getFreshAccessToken();
          if (!accessToken) {
            finish({
              success: false,
              provider,
              email: '',
              error: 'Your session is unavailable. Sign in again, then retry.',
            }, true);
            return;
          }
          const res = await fetch(
            `${SUPABASE_URL}/functions/v1/${PROVIDER_FUNCTIONS[provider]}/authorize`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
                apikey: SUPABASE_ANON_KEY,
              },
              body: JSON.stringify({
                provider,
                scopes: scopes || (provider === 'figma' ? 'file_content:read' : 'calendar,email'),
                client_nonce: clientNonce,
              }),
              signal,
            }
          );
          const data = await res.json().catch(() => ({}));
          if (!authorityIsCurrent()) {
            finish({ success: false, provider, email: '', error: 'The signed-in account changed.' }, true);
            return;
          }
          if (!res.ok || !isAllowedAuthorizeUrl(provider, data.url)) {
            const safeServerError = typeof data?.error === 'string'
              ? data.error.replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, 300)
              : '';
            finish({
              success: false,
              provider,
              email: '',
              error: safeServerError || `Failed to start OAuth (${res.status})`,
            }, true);
            return;
          }
          if (!settled) popup.location.href = data.url;
        });
      } catch (error) {
        finish({
          success: false,
          provider,
          email: '',
          error: error instanceof OAuthClientDeadlineError
            ? 'OAuth setup timed out. Check your connection and retry.'
            : 'Failed to start OAuth',
        }, true);
      }
    })();
  });
}

/**
 * Check if a provider is connected for the current user.
 */
export async function checkOAuthStatus(
  provider: OfficeOAuthProvider,
  service?: OAuthServiceScope,
  jwt?: string,
): Promise<OAuthConnectionStatus> {
  const accessToken = jwt || await getFreshAccessToken();
  if (!accessToken) return { state: 'unavailable', connected: false, email: '' };

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/functions/v1/email-calendar-oauth/status`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ provider, ...(service ? { service } : {}) }),
      }
    );

    if (!resp.ok) return { state: 'unavailable', connected: false, email: '' };
    const data = await resp.json();
    if (typeof data?.connected !== 'boolean') {
      return { state: 'unavailable', connected: false, email: '' };
    }
    return {
      state: data.connected
        ? 'connected'
        : data.reconnectRequired === true
          ? 'reconnect_required'
          : 'disconnected',
      connected: data.connected,
      email: typeof data.email === 'string' ? data.email : '',
    };
  } catch {
    return { state: 'unavailable', connected: false, email: '' };
  }
}

/**
 * Disconnect a provider (remove stored tokens).
 */
export async function disconnectOAuth(
  provider: OfficeOAuthProvider,
  jwt?: string,
  isAuthorityCurrent?: OAuthAuthorityFence,
  callerSignal?: AbortSignal,
): Promise<boolean> {
  try {
    const disconnected = await withOAuthClientDeadline(async (signal) => {
      if (!oauthAuthorityIsCurrent(isAuthorityCurrent, signal)) return false;
      const accessToken = await resolveDisconnectBearer(jwt, isAuthorityCurrent, signal);
      if (!accessToken || !oauthAuthorityIsCurrent(isAuthorityCurrent, signal)) return false;

      const resp = await fetch(
        `${SUPABASE_URL}/functions/v1/email-calendar-oauth/disconnect`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            apikey: SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ provider }),
          signal,
        }
      );
      if (!oauthAuthorityIsCurrent(isAuthorityCurrent, signal)) return false;
      return resp.ok;
    }, callerSignal);
    return oauthAuthorityIsCurrent(isAuthorityCurrent, callerSignal) && disconnected;
  } catch {
    // A retired/aborted exact authority is never allowed to complete locally,
    // even if the server may already have received the mutation. The caller
    // must refresh status before offering another destructive action.
    return false;
  }
}

/**
 * Fetch real calendar events from the connected provider.
 */
export async function fetchCalendarEvents(
  provider: OfficeOAuthProvider,
  jwt?: string,
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
  const accessToken = jwt || await getFreshAccessToken();
  if (!accessToken) return null;

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/functions/v1/email-calendar-oauth/fetch-calendar`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
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
  provider: OfficeOAuthProvider,
  jwt?: string,
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
  const accessToken = jwt || await getFreshAccessToken();
  if (!accessToken) return null;

  try {
    const resp = await fetch(
      `${SUPABASE_URL}/functions/v1/email-calendar-oauth/fetch-emails`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
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

/** Check the current user's personal Figma OAuth connection. */
export async function checkFigmaOAuthStatus(jwt?: string): Promise<FigmaOAuthConnectionStatus> {
  try {
    return await withOAuthClientDeadline(async (signal) => {
      const accessToken = jwt || await getFreshAccessToken();
      if (!accessToken) return { state: 'unavailable', connected: false, accountId: '' };

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/figma-oauth/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: '{}',
        signal,
      });
      if (!resp.ok) return { state: 'unavailable', connected: false, accountId: '' };
      const data = await resp.json().catch(() => null);
      if (typeof data?.connected !== 'boolean') {
        return { state: 'unavailable', connected: false, accountId: '' };
      }
      return {
        state: data.connected
          ? 'connected'
          : data.reconnectRequired === true
            ? 'reconnect_required'
            : 'disconnected',
        connected: data.connected,
        accountId: typeof data.accountId === 'string' ? data.accountId.slice(0, 160) : '',
      };
    });
  } catch {
    return { state: 'unavailable', connected: false, accountId: '' };
  }
}

/** Disconnect only the current user's personal Figma OAuth credential. */
export async function disconnectFigmaOAuth(
  jwt?: string,
  isAuthorityCurrent?: OAuthAuthorityFence,
  callerSignal?: AbortSignal,
): Promise<FigmaOAuthDisconnectResult> {
  try {
    const result = await withOAuthClientDeadline<FigmaOAuthDisconnectResult>(async (signal) => {
      if (!oauthAuthorityIsCurrent(isAuthorityCurrent, signal)) {
        return { outcome: 'unknown', disconnected: false };
      }
      const accessToken = await resolveDisconnectBearer(jwt, isAuthorityCurrent, signal);
      if (!accessToken || !oauthAuthorityIsCurrent(isAuthorityCurrent, signal)) {
        return { outcome: 'unknown', disconnected: false };
      }

      const resp = await fetch(`${SUPABASE_URL}/functions/v1/figma-oauth/disconnect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
        body: '{}',
        signal,
      });
      if (!oauthAuthorityIsCurrent(isAuthorityCurrent, signal)) {
        return { outcome: 'unknown', disconnected: false };
      }
      if (!resp.ok) return { outcome: 'unknown', disconnected: false };
      const data = await resp.json().catch(() => null);
      if (!oauthAuthorityIsCurrent(isAuthorityCurrent, signal)) {
        return { outcome: 'unknown', disconnected: false };
      }
      return data?.disconnected === true
        ? { outcome: 'disconnected', disconnected: true }
        : { outcome: 'unknown', disconnected: false };
    }, callerSignal);
    return oauthAuthorityIsCurrent(isAuthorityCurrent, callerSignal)
      ? result
      : { outcome: 'unknown', disconnected: false };
  } catch {
    // A timeout or transport failure can occur after the server applied the
    // disconnect. Never report success or blindly replay this mutation; the UI
    // must obtain a fresh status before offering another action.
    return { outcome: 'unknown', disconnected: false };
  }
}
