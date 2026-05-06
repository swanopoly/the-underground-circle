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
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (!res.ok) continue;
      const json = await res.json().catch(() => null);
      const token = (json as any)?.token;
      if (typeof token === 'string' && token.length >= 32) {
        writeToken(token);
        return token;
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
