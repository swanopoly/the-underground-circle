// google-workspace-token — shared Google Workspace (Gmail/Docs/…) access-token
// resolver for edge functions.
//
// Why this exists: the scheduled-action-runner's legacy getUserOauthToken()
// reads the `integrations` table and never refreshes ("// TODO: refresh if
// expired"), so a scheduled Gmail send fails the moment the ~1h access_token
// expires. The gmail.* agent tools instead use `user_google_credentials`,
// which stores the refresh_token and supports silent refresh (see
// supabase/functions/google-oauth/index.ts → handleToken). This module mirrors
// that exact refresh contract so scheduled Gmail can prefer the refreshing
// store and fall back to the legacy token.
//
// The refresh_token NEVER leaves this function and is NEVER logged.

/**
 * Pure, total predicate: does a Google access token with this `expires_at`
 * need refreshing at time `now`?
 *
 * Returns true when the expiry is missing, unparseable, or within `marginMs`
 * of `now` (default 2 minutes — the same safety margin
 * google-oauth/handleToken uses). Returns false only for a well-formed expiry
 * that is further out than the margin. Never throws for any input.
 *
 * This is the tsx-smokeable core: no imports, no I/O, no clock of its own.
 */
export function googleTokenNeedsRefresh(
  expiresAt: string | null | undefined,
  now: number,
  marginMs = 120_000,
): boolean {
  if (expiresAt == null) return true;
  const parsedMs = new Date(expiresAt as string).getTime();
  if (!Number.isFinite(parsedMs)) return true;
  return parsedMs - now <= marginMs;
}

export type GoogleWorkspaceTokenResult =
  | { ok: true; accessToken: string; refreshed: boolean }
  | { ok: false; code: 'not_connected' | 'reconnect_required' | 'refresh_failed' | 'not_configured' };

/**
 * Best-effort scrub for any error text we log: strip anything that looks like a
 * bearer/OAuth token and hard-cap the length so a token can never leak into
 * logs or the activity feed. Internal — never exported.
 */
function scrubTokenText(text: unknown): string {
  let s = String(text ?? '');
  s = s.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
  s = s.replace(/ya29\.\S+/g, '[redacted-token]');
  s = s.replace(/[A-Za-z0-9_-]{40,}/g, '[redacted]');
  return s.slice(0, 200);
}

/**
 * Resolve a live Gmail/Workspace access token for `userId` from
 * `user_google_credentials`, refreshing it against Google's OAuth token
 * endpoint when it's expired (or within the 2-minute margin), exactly like
 * google-oauth/handleToken. On success returns the (possibly refreshed) access
 * token; on any recoverable problem returns a typed failure code so the caller
 * can decide whether to fall back, ask the user to reconnect, or stop.
 *
 * `now` is injectable for deterministic tests; defaults to Date.now.
 * NEVER logs the access_token or refresh_token.
 */
export async function resolveGoogleWorkspaceAccessToken(
  supabase: any,
  userId: string,
  now: () => number = () => Date.now(),
): Promise<GoogleWorkspaceTokenResult> {
  try {
    const { data: creds } = await supabase
      .from('user_google_credentials')
      .select('access_token, refresh_token, expires_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (!creds || !creds.access_token) {
      return { ok: false, code: 'not_connected' };
    }

    // Still fresh (2-minute safety margin)? Return the cached token as-is —
    // no network round-trip.
    if (!googleTokenNeedsRefresh(creds.expires_at, now())) {
      return { ok: true, accessToken: creds.access_token as string, refreshed: false };
    }

    // Needs refresh.
    if (!creds.refresh_token) {
      return { ok: false, code: 'reconnect_required' };
    }

    const clientId = Deno.env.get('GOOGLE_OAUTH_CLIENT_ID');
    const clientSecret = Deno.env.get('GOOGLE_OAUTH_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      return { ok: false, code: 'not_configured' };
    }

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: creds.refresh_token as string,
        grant_type: 'refresh_token',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      // invalid_grant = revoked/expired consent — the user must reconnect.
      // Keep the row (revoke is the user's explicit action, not ours).
      const reconnect = /invalid_grant/i.test(errText);
      console.error(`[google-workspace-token] refresh failed: ${scrubTokenText(errText)}`);
      return { ok: false, code: reconnect ? 'reconnect_required' : 'refresh_failed' };
    }

    // Shape: { access_token, expires_in, scope, token_type } — refresh grants
    // do NOT return a new refresh_token unless rotation is enabled.
    const tokens = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!tokens.access_token) {
      return { ok: false, code: 'refresh_failed' };
    }
    const expiresAt = new Date(now() + (tokens.expires_in || 3600) * 1000).toISOString();
    await supabase
      .from('user_google_credentials')
      .update({
        access_token: tokens.access_token,
        expires_at: expiresAt,
        updated_at: new Date(now()).toISOString(),
      })
      .eq('user_id', userId);

    return { ok: true, accessToken: tokens.access_token, refreshed: true };
  } catch (err) {
    console.error(
      `[google-workspace-token] resolve threw: ${scrubTokenText(err instanceof Error ? err.message : String(err))}`,
    );
    return { ok: false, code: 'not_connected' };
  }
}
