/**
 * bridgeEnvironment — decides whether local-machine bridges (Claude Code,
 * Codex, Gemini, Cursor, OpenSwan) can be reached from this runtime.
 *
 * These bridges scan files on disk and relay them over HTTP on localhost
 * ports (7778-7781 and 18789/18790). They only work when the user is running
 * `npm run dev` / the bridge scripts on the same machine that renders the
 * Office tab.
 *
 * In production web (app.chrisswanson.xyz) the bridges are unreachable —
 * localhost resolves to nothing, the fetch fails with a CORS/refused error,
 * and we previously showed a blank "No agents" list with no explanation.
 *
 * The app now:
 *   1. Skips bridge probing in prod unless the user opts in (so we don't
 *      hammer localhost and log warning noise).
 *   2. Lets a deployer point at a tunneled/public bridge via
 *      `EXPO_PUBLIC_BRIDGE_HOST` (e.g. "https://bridge.mydomain.tld").
 *   3. Exposes helpers so the UI can explain *why* the Office is empty.
 */

import { Platform } from 'react-native';

type BridgeEnv = {
  /** True if we should try to reach local bridges at all. */
  available: boolean;
  /** Why bridges are / are not available. */
  reason: 'dev' | 'env-override' | 'native' | 'production-web' | 'explicit-opt-in';
  /** Base URL to use for bridge ports. `host` with no trailing slash. */
  host: string;
};

const DEFAULT_LOCAL_HOST = 'http://localhost';

const ENV_HOST = (() => {
  const raw =
    typeof process !== 'undefined' &&
    process.env &&
    (process.env.EXPO_PUBLIC_BRIDGE_HOST as string | undefined);
  if (!raw) return undefined;
  const trimmed = raw.trim().replace(/\/$/, '');
  return trimmed.length > 0 ? trimmed : undefined;
})();

function isWebProduction(): boolean {
  if (Platform.OS !== 'web') return false;
  if (typeof __DEV__ !== 'undefined' && __DEV__) return false;
  if (typeof window === 'undefined') return false;
  const host = window.location?.hostname || '';
  // Dev server hostnames we should still treat as dev:
  if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.endsWith('.local')) {
    return false;
  }
  return true;
}

function userOptedIn(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    return window.localStorage?.getItem('uc_force_bridges') === '1';
  } catch {
    return false;
  }
}

let cached: BridgeEnv | null = null;

export function getBridgeEnvironment(): BridgeEnv {
  if (cached) return cached;

  // Native apps (iOS/Android) almost always run against a local dev bridge
  // during development and don't have a useful notion of "production web".
  // Treat them as available so existing behavior is preserved, and let the
  // env override take precedence if set.
  if (Platform.OS !== 'web') {
    cached = { available: true, reason: 'native', host: ENV_HOST || DEFAULT_LOCAL_HOST };
    return cached;
  }

  if (ENV_HOST) {
    cached = { available: true, reason: 'env-override', host: ENV_HOST };
    return cached;
  }

  if (!isWebProduction()) {
    cached = { available: true, reason: 'dev', host: DEFAULT_LOCAL_HOST };
    return cached;
  }

  if (userOptedIn()) {
    cached = { available: true, reason: 'explicit-opt-in', host: DEFAULT_LOCAL_HOST };
    return cached;
  }

  cached = { available: false, reason: 'production-web', host: DEFAULT_LOCAL_HOST };
  return cached;
}

/** Returns a `http://host:port` URL if bridges are available, else null. */
export function getBridgeUrl(port: number): string | null {
  const env = getBridgeEnvironment();
  if (!env.available) return null;
  // If host already embeds a port (env override pointed at a specific URL),
  // don't slap another one on.
  if (/:\d+$/.test(env.host)) return env.host;
  return `${env.host}:${port}`;
}

/** True if the current runtime can reach local bridges. */
export function areBridgesAvailable(): boolean {
  return getBridgeEnvironment().available;
}

/** Reset the memo. Only call from tests or after toggling user opt-in. */
export function _resetBridgeEnvironmentCache() {
  cached = null;
}

/** Allow a prod user to opt-in (useful when they run a tunnel/ngrok manually). */
export function setForceBridges(enabled: boolean) {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    if (enabled) {
      window.localStorage?.setItem('uc_force_bridges', '1');
    } else {
      window.localStorage?.removeItem('uc_force_bridges');
    }
    _resetBridgeEnvironmentCache();
  } catch {}
}
