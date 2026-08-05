/**
 * googleWorkspaceRuntime — the IMPURE executor for the Google Workspace agent
 * tools (gmail.* / gdocs.* / gsheets.* / gdrive.* / gcal.*). The pure halves
 * live in `googleWorkspaceOps.ts` (request planners, response extractors,
 * scope checks, error mapping — smoke: google-workspace-ops). This module owns
 * exactly two side effects:
 *
 *   1. TOKEN RESOLUTION — generalizes the pattern proven in
 *      `googleDocsCreate.ts`: read the caller's own `user_google_credentials`
 *      row (RLS: user-only), verify the plan's required scope was granted,
 *      and refresh near-expiry tokens through the google-oauth edge fn's
 *      `?action=token` route (the refresh_token never reaches the client).
 *      Unlike the docs helper it distinguishes not_connected /
 *      missing_scope / reconnect_required so the model gets an actionable,
 *      honest failure instead of a generic null.
 *
 *   2. EXECUTION — fetch the planned googleapis.com request with the bearer
 *      token, map failures through `describeGoogleApiError`, and scrub the
 *      token from anything outbound (belt-and-braces; no path embeds it).
 *
 * Connection UI lives in Circle Settings → Google Workspace (google-oauth
 * edge fn Phase A). Scopes granted there: gmail.modify, calendar, drive,
 * spreadsheets, documents, contacts.readonly.
 */

import {
  checkGoogleScope,
  describeGoogleApiError,
  type GoogleApiPlanResult,
} from './googleWorkspaceOps';

export type GoogleWorkspaceErrorCode =
  | 'invalid_args'
  | 'not_connected'
  | 'reconnect_required'
  | 'missing_scope'
  | 'rate_limited'
  | 'not_found'
  | 'api_error';

export type GoogleWorkspaceRunResult =
  | { ok: true; status: number; json?: unknown; text?: string }
  | { ok: false; code: GoogleWorkspaceErrorCode; message: string };

/** Response bodies larger than this are clipped before extraction. */
const MAX_RESPONSE_TEXT_CHARS = 400_000;
/** Refresh the cached access token when it expires within this window. */
const TOKEN_EXPIRY_SLACK_MS = 30_000;

const NOT_CONNECTED_MESSAGE =
  'Google Workspace is not connected for this account — connect it in Circle Settings → Google Workspace, then retry.';

function scrubToken(text: string, token: string | null): string {
  if (!token || !text) return text;
  return text.split(token).join('[redacted]');
}

/**
 * Resolve a usable access token for the plan's scopes, or an actionable
 * failure. Lazy imports keep this module loadable in dependency-light
 * environments (same discipline as googleDocsCreate).
 */
async function resolveAccessToken(plan: { scopeAnyOf: string[] }): Promise<
  | { ok: true; token: string }
  | { ok: false; code: GoogleWorkspaceErrorCode; message: string }
> {
  try {
    const [{ supabase }, { safeGetUserId }] = await Promise.all([
      import('./supabase'),
      import('./authSession'),
    ]);
    const userId = await safeGetUserId();
    if (!userId) return { ok: false, code: 'not_connected', message: NOT_CONNECTED_MESSAGE };

    const { data, error } = await supabase
      .from('user_google_credentials')
      .select('access_token, expires_at, scopes')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data || typeof data.access_token !== 'string' || !data.access_token) {
      return { ok: false, code: 'not_connected', message: NOT_CONNECTED_MESSAGE };
    }

    const scopes: string[] = Array.isArray(data.scopes) ? data.scopes : [];
    if (scopes.length > 0 && !checkGoogleScope(scopes, plan)) {
      return {
        ok: false,
        code: 'missing_scope',
        message:
          'The Google Workspace connection was granted without the scope this action needs — ' +
          'reconnect in Circle Settings → Google Workspace with the relevant service (email/docs/sheets/drive/calendar) checked.',
      };
    }

    if (data.expires_at) {
      const expiresAtMs = new Date(data.expires_at).getTime();
      if (Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now() + TOKEN_EXPIRY_SLACK_MS) {
        const { fetchGoogleWorkspaceAccessToken } = await import('./googleCreds');
        const fresh = await fetchGoogleWorkspaceAccessToken();
        if (!fresh) {
          return {
            ok: false,
            code: 'reconnect_required',
            message: 'The Google Workspace token could not be refreshed — reconnect in Circle Settings → Google Workspace.',
          };
        }
        return { ok: true, token: fresh };
      }
    }

    return { ok: true, token: data.access_token };
  } catch (e: any) {
    return { ok: false, code: 'api_error', message: `Google credential lookup failed: ${String(e?.message || e).slice(0, 200)}` };
  }
}

/**
 * Execute a pure plan from googleWorkspaceOps. Invalid plans fail closed
 * without any network/credential access. Non-JSON success bodies (Drive
 * export/download) come back as `text`.
 */
export async function runGoogleWorkspacePlan(
  planResult: GoogleApiPlanResult,
): Promise<GoogleWorkspaceRunResult> {
  if (!planResult || planResult.ok !== true) {
    return { ok: false, code: 'invalid_args', message: (planResult && 'error' in planResult && planResult.error) || 'Invalid request.' };
  }
  const plan = planResult;

  const tokenResult = await resolveAccessToken(plan);
  if (!tokenResult.ok) return tokenResult;
  const token = tokenResult.token;

  try {
    const res = await fetch(plan.url, {
      method: plan.method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(plan.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(plan.body !== undefined ? { body: JSON.stringify(plan.body) } : {}),
    });

    const rawText = await res.text();
    const bodyText = scrubToken(rawText.slice(0, MAX_RESPONSE_TEXT_CHARS), token);

    if (!res.ok) {
      const mapped = describeGoogleApiError(res.status, bodyText);
      return { ok: false, code: mapped.code, message: mapped.message };
    }

    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        return { ok: true, status: res.status, json: JSON.parse(bodyText || 'null') };
      } catch {
        return { ok: true, status: res.status, text: bodyText };
      }
    }
    return { ok: true, status: res.status, text: bodyText };
  } catch (e: any) {
    return {
      ok: false,
      code: 'api_error',
      message: scrubToken(`Google API request failed: ${String(e?.message || e).slice(0, 300)}`, token),
    };
  }
}
