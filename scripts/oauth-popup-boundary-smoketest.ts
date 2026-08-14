/**
 * Source-level security contract for the shared OAuth popup boundary.
 *
 * This test does not contact an identity provider. It pins the browser/edge
 * handshake, one-time state handling, output encoding, and callback headers.
 *
 * Run:
 *   npx tsx scripts/oauth-popup-boundary-smoketest.ts
 */

import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "..");
const client = fs.readFileSync(path.join(root, "src", "lib", "oauthConnect.ts"), "utf8");
const edge = fs.readFileSync(
  path.join(root, "supabase", "functions", "email-calendar-oauth", "index.ts"),
  "utf8",
);
const figmaEdge = fs.readFileSync(
  path.join(root, "supabase", "functions", "figma-oauth", "index.ts"),
  "utf8",
);
const relay = fs.readFileSync(path.join(root, "src", "lib", "oauthCallbackRelay.ts"), "utf8");
const entry = fs.readFileSync(path.join(root, "index.ts"), "utf8");
const oauthStoreMigration = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260813190000_atomic_oauth_credential_store.sql"),
  "utf8",
);

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`OAuth popup boundary smoke failed: ${message}`);
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  check(startIndex >= 0, `section starts with ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  check(endIndex > startIndex, `section ends with ${end}`);
  return source.slice(startIndex, endIndex);
}

function ordered(source: string, needles: string[], message: string): void {
  let cursor = -1;
  for (const needle of needles) {
    const next = source.indexOf(needle, cursor + 1);
    check(next > cursor, `${message}: ${needle}`);
    cursor = next;
  }
}

// ── Browser accepts only the expected callback ─────────────────────────────

const clientCallback = section(
  client,
  "function readExpectedCallbackMessage(",
  "export function openOAuthPopup(",
);
check(
  client.includes("window.crypto.getRandomValues(bytes)"),
  "client nonce comes from Web Crypto",
);
check(
  client.includes("const bytes = new Uint8Array(24)"),
  "client nonce has 192 bits of entropy",
);
check(!client.includes("Math.random()"), "OAuth state never uses Math.random");
check(
  client.includes("const origin = window.location.origin"),
  "callback origin is normalized to the exact app origin",
);
check(
  clientCallback.includes("event.origin !== callbackOrigin"),
  "callback rejects a different origin",
);
check(
  clientCallback.includes("event.source !== popup"),
  "callback rejects a different window",
);
ordered(clientCallback, [
  "data.type !== 'oauth-callback'",
  "data.provider !== provider",
  "data.nonce !== clientNonce",
  "typeof data.success !== 'boolean'",
], "callback validates its typed attempt envelope");
check(
  client.includes("client_nonce: clientNonce"),
  "authorize request binds the browser attempt nonce",
);
check(
  client.includes("url.origin === PROVIDER_AUTHORIZE_ORIGINS[provider]"),
  "server-provided authorization URL must match the exact provider origin",
);
check(
  !client.includes("error: e?.message"),
  "browser does not expose raw transport exceptions",
);
check(
  client.includes("data.reconnectRequired === true")
    && client.includes("? 'reconnect_required'"),
  "an unusable stored credential becomes a reconnect-required state instead of a false clean disconnect",
);

// ── Shared provider credentials preserve Calendar and Email permissions ───

const scopeHelpers = section(
  edge,
  'type OAuthServiceScope = "calendar" | "email";',
  "// ─── Token helpers",
);
check(
  scopeHelpers.includes('const OAUTH_SERVICE_SCOPE_ORDER: readonly OAuthServiceScope[] = ["calendar", "email"]'),
  "the edge function has an explicit allowlist for service scope labels",
);
check(
  scopeHelpers.includes("OAUTH_SERVICE_SCOPE_ORDER.filter((scope) => requested.has(scope))"),
  "arbitrary client scope labels cannot pass normalization",
);
check(
  scopeHelpers.includes("function grantedOAuthServiceScopes(")
    && scopeHelpers.includes("required.every((scope) => granted.has(scope))"),
  "provider token responses are mapped back to exact granted Office services",
);
check(
  scopeHelpers.includes("function grantedOAuthServiceScopesFromTokenResponse(")
    && scopeHelpers.includes('provider === "microsoft" && rawProviderScopes === undefined')
    && scopeHelpers.includes("normalizeOAuthServiceScopes(requestedScopes)"),
  "Microsoft's documented omitted-scope response falls back only to the exact server-held request",
);

const authorize = section(
  edge,
  'if (action === "authorize" && req.method === "POST") {',
  "// ── GET /callback",
);
ordered(authorize, [
  "requestedScopes = body.scopes === undefined",
  'serviceClient.rpc("reserve_office_oauth_authorization_v1"',
  "const reservation = firstRpcRow(reservationResult.data)",
  "const serviceScopes = normalizeOAuthServiceScopes(reservation?.required_scopes)",
  'const scopes = serviceScopes.join(",")',
  "serviceScopes.includes(\"calendar\")",
  "serviceScopes.includes(\"email\")",
  "scopes,",
  "credential_revision: reservationRevision",
  "intent_epoch: reservationIntentEpoch",
  "operation_id: operationId",
], "authorization reserves and stores a revision-fenced canonical permission union");
check(
  authorize.includes('error: "Could not verify existing connection permissions"')
    && authorize.includes("status: 503"),
  "existing-scope lookup failure stops authorization instead of narrowing permissions",
);
check(
  authorize.includes("if (requestedScopes.length === 0)")
    && authorize.includes('error: "Select calendar or email access"'),
  "an explicit request without an allowed service scope fails closed",
);
check(
  authorize.includes("const unsupportedRequestedScopes")
    && authorize.includes('error: "This provider does not support the requested Office service"'),
  "authorization rejects provider and service combinations without a real adapter",
);
check(
  edge.includes('include_granted_scopes: "true"'),
  "Google authorization preserves previously granted service permissions during incremental consent",
);

// ── Server state is opaque, short-lived, and single-use ────────────────────

check(
  edge.includes("const OAUTH_NONCE_PATTERN = /^[a-f0-9]{48}$/"),
  "server requires fixed-length random nonces",
);
check(
  edge.includes('authUrl.searchParams.set("state", `${nonce}.${clientNonce}`)'),
  "provider state binds server and browser nonces without credentials",
);
const callback = section(
  edge,
  "// ── GET /callback — OAuth redirect handler",
  "// ── POST handlers — require auth",
);
ordered(callback, [
  "const parsedState = parseCombinedOAuthState(stateRaw)",
  '.eq("state", parsedState.serverNonce)',
  '.from("email_calendar_oauth_states")',
  ".delete()",
  '.eq("id", stateRow.id)',
  '.select("id")',
  "fetch(config.tokenUrl",
  "const grantedServiceScopes = grantedOAuthServiceScopesFromTokenResponse(",
  'serviceClient.rpc("commit_office_oauth_authorization_v1"',
], "callback claims one-time state before exchanging and storing tokens");
check(
  callback.includes("if (claimError || !claimedState)"),
  "failed or replayed state claims fail closed",
);
check(
  callback.includes("if (storeError)"),
  "credential persistence failures cannot report success",
);
check(
  callback.includes("includesEveryOAuthServiceScope(grantedServiceScopes, stateServiceScopes)")
    && callback.includes('error: "The requested Calendar or Email permission was not granted"')
    && callback.includes("p_granted_scopes: grantedServiceScopes.join")
    && callback.includes("p_required_scopes: stateServiceScopes.join")
    && callback.includes("p_expected_intent_epoch: expectedIntentEpoch")
    && callback.includes("p_expected_revision: expectedRevision")
    && callback.includes("p_provider_subject: providerSubject"),
  "callback stores only verified provider grants and requires the complete state scope union",
);
check(
  edge.includes("if (disconnectError)")
    && edge.includes('JSON.stringify({ error: "Unsupported provider", disconnected: false })'),
  "disconnect rejects foreign provider namespaces and persistence failures cannot report success",
);
check(
  !edge.includes('store_user_api_key_service')
    && !figmaEdge.includes('store_user_api_key_service'),
  "OAuth providers never call the nonexistent legacy service RPC",
);
check(
  figmaEdge.includes('serviceClient.rpc("commit_figma_oauth_authorization_v1"')
    && figmaEdge.includes('commit?.applied !== true')
    && figmaEdge.includes('error: "Could not save the Figma connection"'),
  "Figma uses its fenced service-only credential RPC and fails closed on persistence errors",
);

// ── Stored credentials are usable, refreshable, and metadata-preserving ───

const tokenHelpers = section(
  edge,
  "async function refreshTokenIfNeeded(",
  "// ─── Google API helpers",
);
check(
  tokenHelpers.includes('serviceClient.rpc("claim_office_oauth_refresh_v1"')
    && tokenHelpers.includes('outcome === "fresh"')
    && tokenHelpers.includes('outcome === "busy"'),
  "credential reads use a bounded database refresh claim and distinguish fresh/busy state",
);
check(
  tokenHelpers.includes('serviceClient.rpc("commit_office_oauth_refresh_v1"')
    && tokenHelpers.includes("p_expected_intent_epoch: intentEpoch")
    && tokenHelpers.includes("p_expected_revision: revision")
    && tokenHelpers.includes("p_claim_id: claimId"),
  "refresh persistence is fenced by exact epoch, revision, and lease id",
);
check(
  !edge.includes('rpc("store_user_api_key"'),
  "OAuth token writes have no legacy caller-authenticated storage path",
);
check(
  tokenHelpers.includes("const refreshedScopes = data.scope === undefined")
    && tokenHelpers.includes("includesEveryOAuthServiceScope(refreshedScopes, recordedScopes)")
    && tokenHelpers.includes('p_granted_scopes: refreshedScopes.join(",")'),
  "refresh persistence preserves and requires the original granted scopes",
);
check(
  !tokenHelpers.includes("await resp.text()"),
  "provider refresh response bodies are never copied into errors",
);

const statusHandler = section(
  edge,
  'if (action === "status") {',
  "// ── POST /disconnect",
);
ordered(statusHandler, [
  "getProviderConfig(provider)",
  "refreshTokenIfNeeded(user.id, provider)",
  "if (!credential)",
  "const requestedService",
  "hasRecordedOAuthServiceScope(credential, requestedService)",
  "connected: true",
], "status proves a stored credential is current before reporting connected");
check(
  statusHandler.includes("connected: false")
    && statusHandler.includes("reconnectRequired: true"),
  "expired credentials that cannot refresh fail closed as disconnected",
);
check(
  statusHandler.includes('body.service !== undefined && !requestedService')
    && statusHandler.includes('!hasRecordedOAuthServiceScope(credential, requestedService)')
    && statusHandler.includes('reconnectRequired: true'),
  "status checks the requested Calendar or Email permission before reporting that service connected",
);
check(
  client.includes("export type OAuthServiceScope = 'calendar' | 'email';")
    && client.includes('service?: OAuthServiceScope')
    && client.includes("...(service ? { service } : {})"),
  "the client sends the exact Office service to the status endpoint",
);

const calendarHandler = section(
  edge,
  'if (action === "fetch-calendar") {',
  "// ── POST /fetch-emails",
);
ordered(calendarHandler, [
  "refreshTokenIfNeeded(user.id, provider)",
  'hasRecordedOAuthServiceScope(credential, "calendar")',
  "fetchGoogleCalendarEvents(credential.accessToken)",
], "calendar reads refresh credentials before the provider API");
check(
  calendarHandler.includes('error: "Calendar connection is unavailable"')
    && !calendarHandler.includes("err.message"),
  "calendar failures expose only a bounded generic error",
);
check(
  calendarHandler.includes('error: "Calendar permission is required"')
    && calendarHandler.includes('reconnectRequired: true')
    && calendarHandler.includes('status: 409'),
  "calendar reads reject credentials without recorded Calendar permission before the provider API",
);

const emailHandler = section(
  edge,
  'if (action === "fetch-emails") {',
  'JSON.stringify({ error: "Unknown action"',
);
ordered(emailHandler, [
  "refreshTokenIfNeeded(user.id, provider)",
  'hasRecordedOAuthServiceScope(credential, "email")',
  "fetchGmailMessages(credential.accessToken)",
], "email reads refresh credentials before the provider API");
check(
  emailHandler.includes('error: "Email connection is unavailable"')
    && !emailHandler.includes("err.message"),
  "email failures expose only a bounded generic error",
);
check(
  emailHandler.includes('error: "Email permission is required"')
    && emailHandler.includes('reconnectRequired: true')
    && emailHandler.includes('status: 409'),
  "email reads reject credentials without recorded Email permission before the provider API",
);
check(!edge.includes("providerError.slice"), "provider callback errors are mapped to bounded copy");
check(
  !edge.includes("fetchYahooEmails")
    && !edge.includes('provider === "yahoo"')
    && !client.includes("yahoo: 'https://api.login.yahoo.com'")
    && relay.includes("new Set(['google', 'microsoft', 'figma'])"),
  "Yahoo identity metadata is not presented as a real inbox integration",
);

// ── Provider-wide token replacement is atomic across tabs/devices ─────────

for (const token of [
  "CREATE TABLE IF NOT EXISTS public.oauth_provider_credentials (",
  "CREATE OR REPLACE FUNCTION public.reserve_office_oauth_authorization_v1(",
  "CREATE OR REPLACE FUNCTION public.commit_office_oauth_authorization_v1(",
  "CREATE OR REPLACE FUNCTION public.claim_office_oauth_refresh_v1(",
  "CREATE OR REPLACE FUNCTION public.commit_office_oauth_refresh_v1(",
  "CREATE OR REPLACE FUNCTION public.disconnect_office_oauth_provider_v1(",
  "auth.role() IS DISTINCT FROM 'service_role'",
  "pg_advisory_xact_lock(",
  "FOR UPDATE;",
  "oauth_scope_union_not_granted",
  "oauth_refresh_token_required",
  "refresh_claim_expires_at",
  "provider_subject",
  "TO service_role;",
]) {
  check(oauthStoreMigration.includes(token), `fenced OAuth storage pins ${token}`);
}
check(
  oauthStoreMigration.indexOf("pg_advisory_xact_lock(")
    < oauthStoreMigration.indexOf("SELECT * INTO v_row"),
  "the provider lock is acquired before reading or replacing current credential control state",
);
check(
  oauthStoreMigration.indexOf("oauth_scope_union_not_granted")
    < oauthStoreMigration.indexOf("access_token_enc = extensions.pgp_sym_encrypt"),
  "a concurrent callback cannot overwrite a broader existing Calendar or Email grant",
);
check(
  oauthStoreMigration.includes("ALTER TABLE public.oauth_provider_credentials FORCE ROW LEVEL SECURITY")
    && oauthStoreMigration.includes("REVOKE ALL ON TABLE public.oauth_provider_credentials FROM PUBLIC, anon, authenticated")
    && oauthStoreMigration.includes("reserved_oauth_credential")
    && oauthStoreMigration.includes("user_api_keys_select_own_non_oauth"),
  "OAuth secrets are service-only and the legacy generic BYOK namespace cannot recreate or list them",
);

// ── Callback uses a trusted-app redirect because edge HTML is sandboxed ───

const resultPage = section(edge, "function oauthResultResponse(", "\n}");
check(resultPage.includes('new URL("/oauth/email-calendar/callback", APP_ORIGIN)'),
  "callback redirects to the exact configured app origin");
check(resultPage.includes("relayUrl.hash = new URLSearchParams"),
  "non-secret callback values stay in the URL fragment");
check(resultPage.includes("status: 303"), "callback uses a non-cacheable redirect");
check(resultPage.includes('"Location": relayUrl.toString()'), "redirect location is explicit");
check(resultPage.includes('"Cache-Control": "no-store"'), "callback redirect is not cached");
check(!edge.includes("return new Response(html"), "edge no longer relies on blocked inline HTML");
check(!edge.includes("window.opener"), "edge response contains no executable opener script");

check(relay.includes("window.location.pathname !== OAUTH_CALLBACK_PATH"),
  "relay runs only on the dedicated callback path");
check(relay.includes("OAUTH_NONCE_PATTERN.test(nonce)"), "relay validates the attempt nonce");
check(relay.includes("OAUTH_PROVIDERS.has(provider)"), "relay validates the provider");
check(relay.includes("window.history.replaceState(null, '', OAUTH_CALLBACK_PATH)"),
  "relay clears callback details from the address bar");
check(relay.includes("window.opener.postMessage({"), "relay messages only its opener");
check(relay.includes("}, window.location.origin)"), "relay targets its exact app origin");
check(!relay.includes("postMessage('*'") && !relay.includes(", '*')"),
  "relay never uses a wildcard postMessage target");
check(entry.includes("if (!relayOAuthCallbackFromAppOrigin())"),
  "callback popup is handled before mounting the full app");

console.log(`OAuth popup boundary smoke passed (${assertions} assertions).`);
