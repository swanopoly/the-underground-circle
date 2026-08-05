/**
 * bridgeAuth — single source of truth for the local-bridge desktop
 * token. All four bridges (Claude Code, Codex, Gemini CLI, Cursor)
 * share the same token, persisted at `~/.uc-desktop-token` and cached
 * in localStorage under `uc_desktop_bridge_token_v1` (set by
 * `desktopBridge.ts` after pairing).
 *
 * `/sessions` is gated on every bridge — without the
 * `X-UC-Desktop-Token` header those endpoints return 401. The bridge
 * detectors used to fetch `/sessions` unauthenticated, which broke
 * agent auto-connect after the bridges added the gate. This module
 * lets the detectors send the header without each one re-implementing
 * the read-or-pair flow.
 *
 * `getCachedBridgeToken()` is sync and read-only — safe to call from
 * hot paths. `ensureBridgeToken()` lazily pairs against the first
 * reachable bridge if the cache is empty; multiple concurrent callers
 * dedupe via a singleton promise so we don't fan out N pair requests
 * on app boot.
 */
import { getBridgeUrl } from './bridgeEnvironment';

const TOKEN_KEY = 'uc_desktop_bridge_token_v1';
const PAIR_PORTS = [7778, 7779, 7780, 7781] as const;

let inflightPair: Promise<string | null> | null = null;

export type BridgePairExchangeResult = {
  ok: boolean;
  status: number;
  token?: string;
  code?: string;
  error?: string;
};

export function getCachedBridgeToken(): string | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const v = localStorage.getItem(TOKEN_KEY);
    return v && v.length >= 32 ? v : null;
  } catch {
    return null;
  }
}

function writeToken(value: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(TOKEN_KEY, value);
  } catch {
    /* quota / private-mode — caller proceeds without persistence */
  }
}

export function cacheBridgeToken(value: string | null | undefined) {
  if (!value || value.length < 32) return;
  writeToken(value);
}

export function clearCachedBridgeToken(expected?: string | null) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (expected && localStorage.getItem(TOKEN_KEY) !== expected) return;
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private-mode storage failures are fail-soft */
  }
}

/**
 * Complete the shared challenge-v1 pairing exchange used by the Claude,
 * Codex, Gemini, and Cursor bridges. Current Claude returns its expected first
 * challenge as HTTP 200 so browsers do not log the handshake as a failed
 * resource; older and rolling-restart bridges may still use HTTP 428. A
 * first-response token is also accepted for compatibility, but current bridge
 * sources never disclose it before the challenge.
 */
export async function requestBridgePairToken(
  url: string,
  signal?: AbortSignal,
): Promise<BridgePairExchangeResult> {
  const post = async (body: Record<string, string>): Promise<{
    status: number;
    json: Record<string, unknown> | null;
  }> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
    const json = await response.json().catch(() => null) as Record<string, unknown> | null;
    return { status: response.status, json };
  };

  const first = await post({});
  let result = first;
  if (
    (first.status === 200 || first.status === 428)
    && first.json?.code === 'pairing_challenge_required'
    && typeof first.json?.challenge === 'string'
    && /^[a-f0-9]{48}$/i.test(first.json.challenge)
  ) {
    result = await post({ pairingChallenge: first.json.challenge });
  }

  const token = typeof result.json?.token === 'string' ? result.json.token : undefined;
  const ok = result.status >= 200
    && result.status < 300
    && result.json?.ok === true
    && !!token
    && token.length >= 32;
  return {
    ok,
    status: result.status,
    token: ok ? token : undefined,
    code: typeof result.json?.code === 'string' ? result.json.code : undefined,
    error: typeof result.json?.error === 'string'
      ? result.json.error
      : (ok ? undefined : `Pairing failed with HTTP ${result.status}.`),
  };
}

/**
 * Pair against the first reachable bridge. All bridges return the same
 * shared token, so a single round-trip is sufficient. 1.5s timeout per
 * URL keeps app boot fast when bridges are offline.
 */
async function pairWithAnyBridge(): Promise<string | null> {
  const pairUrls = PAIR_PORTS
    .map((port) => {
      const base = getBridgeUrl(port);
      if (!base) return null;
      return port === 7778 ? `${base}/desktop/pair` : `${base}/pair`;
    })
    .filter((url): url is string => !!url);
  for (const url of pairUrls) {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 1500);
      try {
        const paired = await requestBridgePairToken(url, ac.signal);
        if (paired.ok && paired.token) {
          writeToken(paired.token);
          return paired.token;
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // try next bridge
    }
  }
  return null;
}

/**
 * Cached token if present; otherwise pair against any reachable bridge.
 * Concurrent callers share the same in-flight pair promise.
 */
export async function ensureBridgeToken(): Promise<string | null> {
  const cached = getCachedBridgeToken();
  if (cached) return cached;
  if (inflightPair) return inflightPair;
  inflightPair = pairWithAnyBridge().finally(() => { inflightPair = null; });
  return inflightPair;
}

/**
 * Build a headers object with the desktop token if available.
 * Used by detectors that probe `/sessions` etc.
 */
export function bridgeAuthHeaders(token?: string | null): Record<string, string> {
  const t = token ?? getCachedBridgeToken();
  return t ? { 'X-UC-Desktop-Token': t } : {};
}

function pairingUrlsForBridgeRequest(url: string): string[] {
  try {
    const parsed = new URL(url);
    const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const explicitClaude = port === '7778';
    const explicitOther = port === '7779' || port === '7780' || port === '7781';
    parsed.search = '';
    parsed.hash = '';
    const make = (pathname: string) => {
      const candidate = new URL(parsed.toString());
      candidate.pathname = pathname;
      return candidate.toString();
    };
    if (explicitClaude) return [make('/desktop/pair')];
    if (explicitOther) return [make('/pair')];
    // Custom/tunnel bridge URLs commonly omit the local port. Try both
    // challenge routes; neither discloses a token before challenge completion.
    return [make('/desktop/pair'), make('/pair')];
  } catch {
    return [];
  }
}

/**
 * Authenticated bridge fetch with one stale-token repair. A rejected request
 * has not reached route dispatch, so replaying its string/JSON body once after
 * a fresh challenge exchange is safe.
 */
export async function fetchBridgeAuthenticated(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const send = async (token: string | null): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (token) headers.set('X-UC-Desktop-Token', token);
    else headers.delete('X-UC-Desktop-Token');
    return fetch(url, { ...init, headers });
  };

  const token = await ensureBridgeToken();
  const first = await send(token);
  if (first.status !== 401) return first;

  clearCachedBridgeToken(token);
  const pairUrls = pairingUrlsForBridgeRequest(url);
  for (const pairUrl of pairUrls) {
    try {
      const paired = await requestBridgePairToken(pairUrl, init.signal ?? undefined);
      if (!paired.ok || !paired.token) continue;
      cacheBridgeToken(paired.token);
      return send(paired.token);
    } catch {
      // Try the alternate challenge route for a custom/tunnel URL.
    }
  }
  return first;
}
