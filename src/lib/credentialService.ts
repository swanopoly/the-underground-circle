/**
 * credentialService — Fetch credentials from 1Password via the local bridge.
 *
 * The bridge's /secrets endpoint calls the `op` CLI which authenticates
 * via OP_SERVICE_ACCOUNT_TOKEN. Credentials never touch the browser or
 * Supabase — they're resolved on the bridge and used ephemerally.
 *
 * Setup:
 *   1. Install 1Password CLI: https://1password.com/downloads/command-line/
 *   2. Create a service account: op service-account create "OpenSwan" --vault "Agent Credentials:read_items"
 *   3. Set the token: export OP_SERVICE_ACCOUNT_TOKEN="..."
 *   4. Start the bridge: node scripts/claude-bridge.js
 */

import { getBridgeUrl } from './bridgeEnvironment';
import { getDesktopBridgeToken, ensureDesktopBridgePaired } from './desktopBridge';

const BRIDGE_PORT = 7778;

function getCredentialBridgeUrl(): string | null {
  return getBridgeUrl(BRIDGE_PORT);
}

/**
 * Builds the JSON headers plus the desktop-bridge auth token. The /secrets
 * endpoint is token-gated (401 without it), so every credential fetch must
 * attach `X-UC-Desktop-Token`. Reuses the cached token, auto-pairing once if
 * needed — no new pairing logic. Returns null when the bridge cannot be paired.
 */
async function buildSecretsHeaders(): Promise<Record<string, string> | null> {
  let token = getDesktopBridgeToken();
  if (!token) {
    const ensured = await ensureDesktopBridgePaired();
    if (ensured.ok && ensured.data?.token) token = ensured.data.token;
  }
  if (!token) return null;
  return { 'Content-Type': 'application/json', 'X-UC-Desktop-Token': token };
}

export interface CredentialFields {
  [key: string]: string;
}

export async function getCredentials(opts: {
  item: string;
  vault?: string;
  fields?: string[];
}): Promise<{ ok: boolean; fields: CredentialFields; error?: string }> {
  const bridgeUrl = getCredentialBridgeUrl();
  if (!bridgeUrl) {
    return { ok: false, fields: {}, error: 'Credential bridge unavailable in this environment.' };
  }
  const headers = await buildSecretsHeaders();
  if (!headers) {
    return { ok: false, fields: {}, error: 'Desktop bridge not paired. Pair first to fetch credentials.' };
  }
  try {
    const res = await fetch(`${bridgeUrl}/secrets`, {
      method: 'POST',
      headers,
      body: JSON.stringify(opts),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!data.ok) return { ok: false, fields: {}, error: data.error };
    return { ok: true, fields: data.fields || {} };
  } catch (err: any) {
    return {
      ok: false,
      fields: {},
      error: err?.message?.includes('fetch')
        ? 'Bridge not running. Start with: node scripts/claude-bridge.js'
        : (err?.message || 'Credential fetch failed'),
    };
  }
}

export async function readSecret(uri: string): Promise<string | null> {
  const bridgeUrl = getCredentialBridgeUrl();
  if (!bridgeUrl) return null;
  const headers = await buildSecretsHeaders();
  if (!headers) return null;
  try {
    const res = await fetch(`${bridgeUrl}/secrets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ uri }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    return data.ok ? (data.fields?.value || null) : null;
  } catch {
    return null;
  }
}

export async function isOnePasswordAvailable(): Promise<boolean> {
  const bridgeUrl = getCredentialBridgeUrl();
  if (!bridgeUrl) return false;
  const headers = await buildSecretsHeaders();
  if (!headers) return false;
  try {
    const res = await fetch(`${bridgeUrl}/secrets`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ item: '__health_check__' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    // If op CLI is not found, error message says so
    return !data.error?.includes('not found');
  } catch {
    return false;
  }
}
