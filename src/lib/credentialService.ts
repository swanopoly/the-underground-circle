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

const BRIDGE_URL = 'http://localhost:7778';

export interface CredentialFields {
  [key: string]: string;
}

export async function getCredentials(opts: {
  item: string;
  vault?: string;
  fields?: string[];
}): Promise<{ ok: boolean; fields: CredentialFields; error?: string }> {
  try {
    const res = await fetch(`${BRIDGE_URL}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  try {
    const res = await fetch(`${BRIDGE_URL}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
  try {
    const res = await fetch(`${BRIDGE_URL}/secrets`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
