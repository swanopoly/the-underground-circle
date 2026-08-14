// email-calendar-oauth — Supabase Edge Function
//
// Unified OAuth2 handler for Google and Microsoft Calendar + Email.
// Supports Calendar + Email integration for Office furniture items.
//
// Routes:
//   POST /authorize  { provider, scopes, client_nonce } (authenticated)
//   GET  /callback?code=...&state=...
//   POST /fetch-calendar  { provider }   → returns real calendar events
//   POST /fetch-emails    { provider }   → returns real emails
//   POST /status          { provider }   → checks connection status
//   POST /disconnect      { provider }   → removes stored tokens
//
// Secrets needed:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
//   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
//   (Optional) YAHOO_CLIENT_ID, YAHOO_CLIENT_SECRET
//
// Deploy: npx supabase functions deploy email-calendar-oauth

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SITE_URL =
  Deno.env.get("SITE_URL") || "https://app.chrisswanson.xyz";
const APP_ORIGIN = (() => {
  try {
    const parsed = new URL(SITE_URL);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("invalid protocol");
    return parsed.origin;
  } catch {
    return "https://app.chrisswanson.xyz";
  }
})();

const OAUTH_NONCE_PATTERN = /^[a-f0-9]{48}$/;

function parseCombinedOAuthState(raw: string): { serverNonce: string; clientNonce: string } | null {
  const [serverNonce, clientNonce, extra] = raw.split(".");
  if (extra !== undefined || !OAUTH_NONCE_PATTERN.test(serverNonce) || !OAUTH_NONCE_PATTERN.test(clientNonce)) {
    return null;
  }
  return { serverNonce, clientNonce };
}

function getCallbackUrl(): string {
  return `${SUPABASE_URL}/functions/v1/email-calendar-oauth/callback`;
}

// ─── Provider configs ─────────────────────────────────────────────────────────

interface ProviderConfig {
  authUrl: string;
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scopes: { calendar: string; email: string; base: string };
  extraAuthParams?: Record<string, string>;
}

function getProviderConfig(provider: string): ProviderConfig | null {
  switch (provider) {
    case "google":
      return {
        authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
        tokenUrl: "https://oauth2.googleapis.com/token",
        clientId: Deno.env.get("GOOGLE_CLIENT_ID") || "",
        clientSecret: Deno.env.get("GOOGLE_CLIENT_SECRET") || "",
        scopes: {
          calendar:
            "https://www.googleapis.com/auth/calendar.readonly",
          email:
            "https://www.googleapis.com/auth/gmail.readonly",
          base: "https://www.googleapis.com/auth/userinfo.email openid",
        },
        extraAuthParams: {
          access_type: "offline",
          prompt: "consent",
          include_granted_scopes: "true",
        },
      };
    case "microsoft":
      return {
        authUrl:
          "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
        tokenUrl:
          "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        clientId: Deno.env.get("MICROSOFT_CLIENT_ID") || "",
        clientSecret: Deno.env.get("MICROSOFT_CLIENT_SECRET") || "",
        scopes: {
          calendar: "Calendars.Read",
          email: "Mail.Read",
          base: "User.Read offline_access",
        },
      };
    default:
      return null;
  }
}

type OAuthServiceScope = "calendar" | "email";

const OAUTH_SERVICE_SCOPE_ORDER: readonly OAuthServiceScope[] = ["calendar", "email"];

function normalizeOAuthServiceScopes(raw: unknown): OAuthServiceScope[] {
  if (typeof raw !== "string") return [];
  const requested = new Set(
    raw
      .split(",")
      .map((scope) => scope.trim().toLowerCase())
      .filter(Boolean),
  );
  return OAUTH_SERVICE_SCOPE_ORDER.filter((scope) => requested.has(scope));
}

function hasRecordedOAuthServiceScope(
  tokens: { scopes: string },
  service: OAuthServiceScope,
): boolean {
  return normalizeOAuthServiceScopes(tokens.scopes).includes(service);
}

function grantedOAuthServiceScopes(
  config: ProviderConfig,
  rawProviderScopes: unknown,
): OAuthServiceScope[] {
  if (typeof rawProviderScopes !== "string" || !rawProviderScopes.trim()) return [];
  let decoded = rawProviderScopes;
  try { decoded = decodeURIComponent(rawProviderScopes); } catch { /* use raw */ }
  const granted = new Set(
    decoded.split(/\s+/).map((scope) => scope.trim().toLowerCase()).filter(Boolean),
  );
  return OAUTH_SERVICE_SCOPE_ORDER.filter((service) => {
    const required = config.scopes[service]
      .split(/\s+/)
      .map((scope) => scope.trim().toLowerCase())
      .filter(Boolean);
    return required.length > 0 && required.every((scope) => granted.has(scope));
  });
}

function includesEveryOAuthServiceScope(
  granted: readonly OAuthServiceScope[],
  required: readonly OAuthServiceScope[],
): boolean {
  return required.every((scope) => granted.includes(scope));
}

function grantedOAuthServiceScopesFromTokenResponse(
  provider: string,
  config: ProviderConfig,
  rawProviderScopes: unknown,
  requestedScopes: readonly OAuthServiceScope[],
): OAuthServiceScope[] {
  // Microsoft documents `scope` as optional on the authorization-code token
  // response; when omitted, the access token is for the scopes requested on
  // the initial authorization leg. That leg is held in our one-time server
  // state, so it is the only safe fallback. Google returns the granted scope
  // set and must continue to prove it explicitly.
  if (provider === "microsoft" && rawProviderScopes === undefined) {
    return normalizeOAuthServiceScopes(requestedScopes);
  }
  return grantedOAuthServiceScopes(config, rawProviderScopes);
}

// ─── Token helpers ────────────────────────────────────────────────────────────

type ActiveOAuthCredential = {
  accessToken: string;
  expiresAt: string;
  email: string;
  scopes: string;
  providerSubject: string;
};

class OAuthRefreshBusyError extends Error {
  constructor() {
    super("OAuth refresh is already in progress");
    this.name = "OAuthRefreshBusyError";
  }
}

class OAuthCredentialUnavailableError extends Error {
  constructor(message = "OAuth credential service is unavailable") {
    super(message);
    this.name = "OAuthCredentialUnavailableError";
  }
}

class OAuthReconnectRequiredError extends Error {
  constructor(message = "OAuth reconnection is required") {
    super(message);
    this.name = "OAuthReconnectRequiredError";
  }
}

function firstRpcRow(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    const row = value[0];
    return row && typeof row === "object" ? row as Record<string, unknown> : null;
  }
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

async function refreshTokenIfNeeded(
  userId: string,
  provider: string,
): Promise<ActiveOAuthCredential | null> {
  const config = getProviderConfig(provider);
  if (!config || !config.clientId || !config.clientSecret) {
    throw new OAuthCredentialUnavailableError("Provider refresh is unavailable");
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const claimId = crypto.randomUUID();
  const claimResult = await serviceClient.rpc("claim_office_oauth_refresh_v1", {
    p_user_id: userId,
    p_provider: provider,
    p_claim_id: claimId,
    p_lease_seconds: 45,
  });
  if (claimResult.error) throw new OAuthCredentialUnavailableError("Credential lookup failed");
  const claim = firstRpcRow(claimResult.data);
  const outcome = typeof claim?.outcome === "string" ? claim.outcome : "";
  if (outcome === "missing") return null;
  if (outcome === "busy") throw new OAuthRefreshBusyError();
  if (outcome !== "fresh" && outcome !== "claimed") {
    throw new OAuthCredentialUnavailableError("Credential lookup returned an invalid response");
  }

  const accessToken = typeof claim?.access_token === "string" ? claim.access_token : "";
  const expiresAt = typeof claim?.expires_at === "string" ? claim.expires_at : "";
  const email = typeof claim?.account_email === "string" ? claim.account_email.slice(0, 320) : "";
  const scopes = typeof claim?.granted_scopes === "string" ? claim.granted_scopes : "";
  const providerSubject = typeof claim?.provider_subject === "string" ? claim.provider_subject : "";
  const revision = Number(claim?.credential_revision);
  const intentEpoch = Number(claim?.intent_epoch);
  if (!accessToken || !Number.isSafeInteger(revision) || !Number.isSafeInteger(intentEpoch)) {
    throw new OAuthCredentialUnavailableError("Credential lookup returned an invalid response");
  }
  if (outcome === "fresh") {
    return { accessToken, expiresAt, email, scopes, providerSubject };
  }

  const refreshToken = typeof claim?.refresh_token === "string" ? claim.refresh_token : "";
  if (!refreshToken) throw new OAuthReconnectRequiredError("Token expired and no refresh token available");

  let claimCommitted = false;
  try {
    const body: Record<string, string> = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    };

    const resp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });

    if (!resp.ok) throw new OAuthReconnectRequiredError("Token refresh failed");
    const data = await resp.json().catch(() => null);
    if (!data || typeof data.access_token !== "string" || !data.access_token) {
      throw new OAuthReconnectRequiredError("Token refresh returned an invalid response");
    }

    const recordedScopes = normalizeOAuthServiceScopes(scopes);
    const refreshedScopes = data.scope === undefined
      ? recordedScopes
      : grantedOAuthServiceScopes(config, data.scope);
    if (!includesEveryOAuthServiceScope(refreshedScopes, recordedScopes)) {
      throw new OAuthReconnectRequiredError("Token refresh narrowed existing permissions");
    }
    const expiresIn = Number.isFinite(Number(data.expires_in))
      ? Math.max(60, Math.min(Number(data.expires_in), 604_800))
      : 3600;
    const nextExpiry = new Date(Date.now() + expiresIn * 1000).toISOString();
    const commitResult = await serviceClient.rpc("commit_office_oauth_refresh_v1", {
      p_user_id: userId,
      p_provider: provider,
      p_expected_intent_epoch: intentEpoch,
      p_expected_revision: revision,
      p_claim_id: claimId,
      p_operation_id: crypto.randomUUID(),
      p_access_token: data.access_token,
      p_refresh_token: typeof data.refresh_token === "string" ? data.refresh_token : "",
      p_expires_at: nextExpiry,
      p_provider_subject: providerSubject,
      p_granted_scopes: refreshedScopes.join(","),
    });
    if (commitResult.error) {
      console.error(`[email-calendar-oauth] fenced token refresh commit failed for ${provider}`);
      throw new OAuthCredentialUnavailableError("Token refresh persistence failed");
    }
    claimCommitted = true;
    return {
      accessToken: data.access_token,
      expiresAt: nextExpiry,
      email,
      scopes: refreshedScopes.join(","),
      providerSubject,
    };
  } finally {
    if (!claimCommitted) {
      try {
        await serviceClient.rpc("release_office_oauth_refresh_v1", {
          p_user_id: userId,
          p_provider: provider,
          p_expected_intent_epoch: intentEpoch,
          p_expected_revision: revision,
          p_claim_id: claimId,
        });
      } catch {
        // The bounded lease expires even if this best-effort release is lost.
      }
    }
  }
}

// ─── Google API helpers ───────────────────────────────────────────────────────

async function fetchGoogleCalendarEvents(accessToken: string): Promise<any[]> {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    maxResults: "10",
    orderBy: "startTime",
    singleEvents: "true",
    timeMin: now.toISOString(),
    timeMax: endOfDay.toISOString(),
  });

  const resp = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!resp.ok) {
    if (resp.status === 401) throw new OAuthReconnectRequiredError();
    throw new Error("Calendar provider request failed");
  }

  const data = await resp.json();
  return (data.items || []).map((ev: any) => ({
    id: ev.id,
    title: ev.summary || "(No title)",
    start: ev.start?.dateTime || ev.start?.date || "",
    end: ev.end?.dateTime || ev.end?.date || "",
    location: ev.location || "",
    allDay: !ev.start?.dateTime,
  }));
}

async function fetchGmailMessages(accessToken: string): Promise<any[]> {
  // Get message list
  const listResp = await fetch(
    "https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=5&labelIds=INBOX",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!listResp.ok) {
    if (listResp.status === 401) throw new OAuthReconnectRequiredError();
    throw new Error("Email provider request failed");
  }

  const listData = await listResp.json();
  const messageIds = (listData.messages || []).map((m: any) => m.id);

  // Fetch each message's metadata
  const emails = await Promise.all(
    messageIds.slice(0, 5).map(async (id: string) => {
      const msgResp = await fetch(
        `https://www.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!msgResp.ok) return null;
      const msg = await msgResp.json();
      const headers = msg.payload?.headers || [];
      const getHeader = (name: string) =>
        headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())
          ?.value || "";
      return {
        id: msg.id,
        sender: getHeader("From").replace(/<.*>/, "").trim(),
        subject: getHeader("Subject") || "(No subject)",
        date: getHeader("Date"),
        snippet: msg.snippet || "",
        unread: (msg.labelIds || []).includes("UNREAD"),
      };
    })
  );

  return emails.filter(Boolean);
}

// ─── Microsoft Graph API helpers ──────────────────────────────────────────────

async function fetchMicrosoftCalendarEvents(
  accessToken: string
): Promise<any[]> {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  const params = new URLSearchParams({
    startDateTime: now.toISOString(),
    endDateTime: endOfDay.toISOString(),
    $top: "10",
    $orderby: "start/dateTime",
    $select: "id,subject,start,end,location,isAllDay",
  });

  const resp = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarView?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!resp.ok) {
    if (resp.status === 401) throw new OAuthReconnectRequiredError();
    throw new Error("Calendar provider request failed");
  }

  const data = await resp.json();
  return (data.value || []).map((ev: any) => ({
    id: ev.id,
    title: ev.subject || "(No title)",
    start: ev.start?.dateTime || "",
    end: ev.end?.dateTime || "",
    location: ev.location?.displayName || "",
    allDay: ev.isAllDay || false,
  }));
}

async function fetchMicrosoftEmails(accessToken: string): Promise<any[]> {
  const resp = await fetch(
    "https://graph.microsoft.com/v1.0/me/messages?$top=5&$orderby=receivedDateTime desc&$select=id,from,subject,receivedDateTime,bodyPreview,isRead",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!resp.ok) {
    if (resp.status === 401) throw new OAuthReconnectRequiredError();
    throw new Error("Email provider request failed");
  }

  const data = await resp.json();
  return (data.value || []).map((msg: any) => ({
    id: msg.id,
    sender:
      msg.from?.emailAddress?.name ||
      msg.from?.emailAddress?.address ||
      "Unknown",
    subject: msg.subject || "(No subject)",
    date: msg.receivedDateTime || "",
    snippet: msg.bodyPreview || "",
    unread: !msg.isRead,
  }));
}

// ─── Format helpers ───────────────────────────────────────────────────────────

function formatTime(isoDate: string): string {
  if (!isoDate) return "";
  try {
    const d = new Date(isoDate);
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoDate;
  }
}

function formatEmailDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 60 * 60 * 1000) {
      const mins = Math.floor(diff / 60000);
      return `${mins}m ago`;
    }
    if (diff < 24 * 60 * 60 * 1000) {
      return d.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      });
    }
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const action = pathParts[pathParts.length - 1];

  // ── POST /authorize — Start OAuth flow ───────────────────────────────────
  // Authenticated init: verify the caller, mint a server-stored nonce, and
  // return the IdP authorize URL carrying only that nonce as state. The user's
  // JWT never travels through the IdP anymore (advisory #6). POST (not GET) so
  // the bearer token rides an Authorization header, not the URL.
  if (action === "authorize" && req.method === "POST") {
    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: req.headers.get("Authorization") || "" } },
    });
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Not authenticated" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let body: { provider?: unknown; scopes?: unknown; client_nonce?: unknown } = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const provider = typeof body.provider === "string" && body.provider ? body.provider : "google";
    const requestedScopes = body.scopes === undefined
      ? [...OAUTH_SERVICE_SCOPE_ORDER]
      : normalizeOAuthServiceScopes(body.scopes);
    const clientNonce = typeof body.client_nonce === "string" ? body.client_nonce : "";
    if (!OAUTH_NONCE_PATTERN.test(clientNonce)) {
      return new Response(
        JSON.stringify({ error: "Invalid OAuth attempt nonce" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const config = getProviderConfig(provider);
    if (!config || !config.clientId || !config.clientSecret) {
      return new Response(
        JSON.stringify({ error: `${provider} OAuth not configured. Set ${provider.toUpperCase()}_CLIENT_ID and ${provider.toUpperCase()}_CLIENT_SECRET in Supabase secrets.` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (requestedScopes.length === 0) {
      return new Response(
        JSON.stringify({ error: "Select calendar or email access" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const unsupportedRequestedScopes = requestedScopes.filter((scope) => !config.scopes[scope]);
    if (unsupportedRequestedScopes.length > 0) {
      return new Response(
        JSON.stringify({ error: "This provider does not support the requested Office service" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Reserve one provider intent before leaving for the identity provider.
    // The database returns the canonical union with any current service grant
    // plus the exact revision/epoch the callback must match. A disconnect or a
    // newer authorization invalidates this callback without relying on timing.
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const operationId = crypto.randomUUID();
    const reservationResult = await serviceClient.rpc("reserve_office_oauth_authorization_v1", {
      p_user_id: user.id,
      p_provider: provider,
      p_requested_scopes: requestedScopes.join(","),
      p_operation_id: operationId,
    });
    const reservation = firstRpcRow(reservationResult.data);
    const reservationIntentEpoch = Number(reservation?.intent_epoch);
    const reservationRevision = Number(reservation?.credential_revision);
    const serviceScopes = normalizeOAuthServiceScopes(reservation?.required_scopes);
    if (reservationResult.error
      || !Number.isSafeInteger(reservationIntentEpoch)
      || !Number.isSafeInteger(reservationRevision)
      || serviceScopes.length === 0) {
      console.error(`[email-calendar-oauth] authorization reservation failed for ${provider}`);
      return new Response(
        JSON.stringify({ error: "Could not verify existing connection permissions" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const scopes = serviceScopes.join(",");

    // Build scope string
    const scopeParts = [config.scopes.base];
    if (serviceScopes.includes("calendar") && config.scopes.calendar) {
      scopeParts.push(config.scopes.calendar);
    }
    if (serviceScopes.includes("email") && config.scopes.email) {
      scopeParts.push(config.scopes.email);
    }

    // Opaque single-use nonce bound to the verified user, stored server-side.
    const nonceBytes = new Uint8Array(24);
    crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const { error: stateErr } = await serviceClient.from("email_calendar_oauth_states").insert({
      state: nonce,
      user_id: user.id,
      provider,
      scopes,
      credential_revision: reservationRevision,
      intent_epoch: reservationIntentEpoch,
      operation_id: operationId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (stateErr) {
      console.error("Failed to store email/calendar OAuth state:", stateErr);
      return new Response(
        JSON.stringify({ error: "Failed to initiate OAuth flow" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const authUrl = new URL(config.authUrl);
    authUrl.searchParams.set("client_id", config.clientId);
    authUrl.searchParams.set("redirect_uri", getCallbackUrl());
    authUrl.searchParams.set("scope", scopeParts.join(" "));
    authUrl.searchParams.set("response_type", "code");
    // The browser nonce is random, short-lived, and contains no credential.
    // Combining it with the server-stored nonce lets the callback authenticate
    // its postMessage to the exact browser attempt without a new DB column.
    authUrl.searchParams.set("state", `${nonce}.${clientNonce}`);

    // Provider-specific params
    if (config.extraAuthParams) {
      for (const [k, v] of Object.entries(config.extraAuthParams)) {
        authUrl.searchParams.set(k, v);
      }
    }

    return new Response(
      JSON.stringify({ url: authUrl.toString() }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── GET /callback — OAuth redirect handler ──────────────────────────────
  if (action === "callback" && req.method === "GET") {
    const code = url.searchParams.get("code");
    const stateRaw = url.searchParams.get("state") || "";
    const providerError = url.searchParams.get("error");
    const parsedState = parseCombinedOAuthState(stateRaw);
    if (!parsedState) {
      return oauthResultResponse({ success: false, error: "Invalid or expired state" });
    }

    // Resolve the flow from the server-stored nonce — never trust a decoded
    // client-supplied state (that carried the JWT; advisory #6).
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: stateRow, error: stateLookupError } = await serviceClient
      .from("email_calendar_oauth_states")
      .select("id, user_id, provider, scopes, expires_at, credential_revision, intent_epoch, operation_id")
      .eq("state", parsedState.serverNonce)
      .maybeSingle();
    if (stateLookupError || !stateRow) {
      if (stateLookupError) console.error("OAuth state lookup failed:", stateLookupError.message);
      return oauthResultResponse({ success: false, error: "Invalid or expired state" });
    }

    // Atomically claim the state before exchanging or storing credentials.
    // Concurrent/replayed callbacks can read the row, but only one can delete
    // and return it; every other callback fails closed.
    const { data: claimedState, error: claimError } = await serviceClient
      .from("email_calendar_oauth_states")
      .delete()
      .eq("id", stateRow.id)
      .eq("state", parsedState.serverNonce)
      .select("id")
      .maybeSingle();
    if (claimError || !claimedState) {
      if (claimError) console.error("OAuth state claim failed:", claimError.message);
      return oauthResultResponse({ success: false, error: "Invalid or expired state" });
    }

    const resultContext = {
      provider: (stateRow.provider as string) || "google",
      clientNonce: parsedState.clientNonce,
    };

    if (new Date(stateRow.expires_at) < new Date()) {
      return oauthResultResponse({ ...resultContext, success: false, error: "State expired" });
    }

    if (providerError) {
      return oauthResultResponse({
        ...resultContext,
        success: false,
        error: providerError === "access_denied"
          ? "Authorization was cancelled"
          : "Provider authorization failed",
      });
    }

    if (!code) {
      return oauthResultResponse({
        ...resultContext,
        success: false,
        error: "Missing authorization code",
      });
    }

    const provider = resultContext.provider;
    const stateServiceScopes = normalizeOAuthServiceScopes(stateRow.scopes);
    const userId = stateRow.user_id as string;
    const expectedRevision = Number(stateRow.credential_revision);
    const expectedIntentEpoch = Number(stateRow.intent_epoch);
    const operationId = typeof stateRow.operation_id === "string" ? stateRow.operation_id : "";
    if (!Number.isSafeInteger(expectedRevision)
      || !Number.isSafeInteger(expectedIntentEpoch)
      || !operationId
      || stateServiceScopes.length === 0) {
      return oauthResultResponse({ ...resultContext, success: false, error: "Invalid or expired state" });
    }

    const config = getProviderConfig(provider);
    if (!config) {
      return oauthResultResponse({ ...resultContext, success: false, error: "Unknown provider" });
    }

    // Exchange code for tokens
    const tokenBody: Record<string, string> = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: getCallbackUrl(),
      grant_type: "authorization_code",
    };

    let tokenResp: Response;
    try {
      tokenResp = await fetch(config.tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(tokenBody),
      });
    } catch {
      console.error(`Token exchange transport failed for ${provider}`);
      return oauthResultResponse({
        ...resultContext,
        success: false,
        error: "Token exchange failed",
      });
    }

    if (!tokenResp.ok) {
      console.error(`Token exchange failed for ${provider} (${tokenResp.status})`);
      return oauthResultResponse({
        ...resultContext,
        success: false,
        error: "Token exchange failed",
      });
    }

    const tokens = await tokenResp.json().catch(() => null);
    if (!tokens || typeof tokens.access_token !== "string" || !tokens.access_token) {
      return oauthResultResponse({
        ...resultContext,
        success: false,
        error: "Provider returned an invalid token response",
      });
    }
    const grantedServiceScopes = grantedOAuthServiceScopesFromTokenResponse(
      provider,
      config,
      tokens.scope,
      stateServiceScopes,
    );
    if (!includesEveryOAuthServiceScope(grantedServiceScopes, stateServiceScopes)) {
      console.warn(`[email-calendar-oauth] provider did not grant every requested Office service for ${provider}`);
      return oauthResultResponse({
        ...resultContext,
        success: false,
        error: "The requested Calendar or Email permission was not granted",
      });
    }

    // Bind the credential to the provider's stable account id. Email is only
    // display metadata and must never decide whether an older rotating refresh
    // token can be preserved.
    let userEmail = "";
    let providerSubject = "";
    try {
      if (provider === "google") {
        const infoResp = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (infoResp.ok) {
          const info = await infoResp.json();
          userEmail = typeof info.email === "string" ? info.email : "";
          providerSubject = typeof info.id === "string" ? info.id : "";
        }
      } else if (provider === "microsoft") {
        const infoResp = await fetch(
          "https://graph.microsoft.com/v1.0/me",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (infoResp.ok) {
          const info = await infoResp.json();
          providerSubject = typeof info.id === "string" ? info.id : "";
          userEmail = typeof info.mail === "string"
            ? info.mail
            : typeof info.userPrincipalName === "string"
              ? info.userPrincipalName
              : "";
        }
      }
    } catch {
      // The bounded public error below handles provider identity lookup loss.
    }
    if (!providerSubject) {
      console.error(`[email-calendar-oauth] provider account identity lookup failed for ${provider}`);
      return oauthResultResponse({
        ...resultContext,
        success: false,
        error: "Could not verify the connected account",
      });
    }

    // Commit only if the provider intent and credential revision still match
    // the one-time state. A disconnect or newer authorization wins and this
    // provider result is discarded rather than resurrecting stale access.
    const expiresIn = Number.isFinite(Number(tokens.expires_in))
      ? Math.max(60, Math.min(Number(tokens.expires_in), 604_800))
      : 3600;
    let storeError: unknown = null;
    try {
      const storeResult = await serviceClient.rpc("commit_office_oauth_authorization_v1", {
        p_user_id: userId,
        p_provider: provider,
        p_expected_intent_epoch: expectedIntentEpoch,
        p_expected_revision: expectedRevision,
        p_operation_id: operationId,
        p_access_token: tokens.access_token,
        p_refresh_token: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
        p_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        p_account_email: userEmail.slice(0, 320),
        p_provider_subject: providerSubject,
        p_granted_scopes: grantedServiceScopes.join(","),
        p_required_scopes: stateServiceScopes.join(","),
      });
      storeError = storeResult.error;
    } catch {
      storeError = true;
    }
    if (storeError) {
      console.error("OAuth token persistence failed");
      return oauthResultResponse({
        ...resultContext,
        success: false,
        error: "Could not save the connection",
      });
    }

    // Send success HTML that posts message to opener window
    return oauthResultResponse({
      ...resultContext,
      success: true,
      email: userEmail.slice(0, 320),
    });
  }

  // ── POST handlers — require auth ─────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return new Response(
      JSON.stringify({ error: "Not authenticated" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* empty body ok for some routes */
  }

  const provider = typeof body.provider === "string" && body.provider
    ? body.provider
    : "google";

  // ── POST /status — Check connection ──────────────────────────────────────
  if (action === "status") {
    const config = getProviderConfig(provider);
    if (!config) {
      return new Response(
        JSON.stringify({ connected: false, provider, error: "Unsupported provider" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let credential: ActiveOAuthCredential | null;
    try {
      credential = await refreshTokenIfNeeded(user.id, provider);
    } catch (error) {
      console.error(`[email-calendar-oauth] credential status lookup failed for ${provider}`);
      if (error instanceof OAuthReconnectRequiredError) {
        return new Response(
          JSON.stringify({ connected: false, email: "", provider, reconnectRequired: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ connected: false, provider, error: "Connection status is unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!credential) {
      return new Response(
        JSON.stringify({ connected: false, email: "", provider }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestedService = typeof body.service === "string"
      ? normalizeOAuthServiceScopes(body.service)[0]
      : undefined;
    if (body.service !== undefined && !requestedService) {
      return new Response(
        JSON.stringify({ connected: false, email: "", provider, error: "Unsupported service" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (requestedService && !config.scopes[requestedService]) {
      return new Response(
        JSON.stringify({ connected: false, email: "", provider, reconnectRequired: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    // Legacy rows without recorded service labels predate scope tracking. Do
    // not claim a specific Office integration is authorized; require a fresh
    // consent that records the canonical service union.
    if (requestedService && !hasRecordedOAuthServiceScope(credential, requestedService)) {
      return new Response(
        JSON.stringify({ connected: false, email: "", provider, reconnectRequired: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        connected: true,
        email: credential.email || "",
        provider,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── POST /disconnect — Remove tokens ─────────────────────────────────────
  if (action === "disconnect") {
    if (!getProviderConfig(provider)) {
      return new Response(
        JSON.stringify({ error: "Unsupported provider", disconnected: false }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let disconnectError: unknown = null;
    try {
      const disconnectResult = await serviceClient.rpc("disconnect_office_oauth_provider_v1", {
        p_user_id: user.id,
        p_provider: provider,
        p_operation_id: crypto.randomUUID(),
      });
      disconnectError = disconnectResult.error;
    } catch {
      disconnectError = true;
    }

    if (disconnectError) {
      console.error("OAuth disconnect persistence failed");
      return new Response(
        JSON.stringify({ error: "Could not disconnect provider", disconnected: false }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ disconnected: true, provider }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── POST /fetch-calendar — Get real calendar events ──────────────────────
  if (action === "fetch-calendar") {
    if (provider !== "google" && provider !== "microsoft") {
      return new Response(
        JSON.stringify({ error: "Calendar provider is unsupported", events: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let credential: ActiveOAuthCredential | null;
    try {
      credential = await refreshTokenIfNeeded(user.id, provider);
    } catch (error) {
      if (error instanceof OAuthReconnectRequiredError) {
        return new Response(
          JSON.stringify({ error: "Calendar permission must be reconnected", events: [], reconnectRequired: true }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Calendar connection is unavailable", events: [] }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!credential) {
      return new Response(
        JSON.stringify({ error: "Not connected", events: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!hasRecordedOAuthServiceScope(credential, "calendar")) {
      return new Response(
        JSON.stringify({ error: "Calendar permission is required", events: [], reconnectRequired: true }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      let events: any[] = [];

      if (provider === "google") {
        events = await fetchGoogleCalendarEvents(credential.accessToken);
      } else if (provider === "microsoft") {
        events = await fetchMicrosoftCalendarEvents(credential.accessToken);
      }

      // Format for the calendar widget
      const formatted = events.map((ev) => ({
        ...ev,
        timeFormatted: formatTime(ev.start),
      }));

      return new Response(
        JSON.stringify({
          events: formatted,
          count: formatted.length,
          nextEvent: formatted[0] || null,
          provider,
          email: credential.email,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (error) {
      if (error instanceof OAuthReconnectRequiredError) {
        return new Response(
          JSON.stringify({ error: "Calendar permission must be reconnected", events: [], reconnectRequired: true }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Calendar connection is unavailable", events: [] }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // ── POST /fetch-emails — Get real emails ─────────────────────────────────
  if (action === "fetch-emails") {
    if (provider !== "google" && provider !== "microsoft") {
      return new Response(
        JSON.stringify({ error: "Email provider is unsupported", emails: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let credential: ActiveOAuthCredential | null;
    try {
      credential = await refreshTokenIfNeeded(user.id, provider);
    } catch (error) {
      if (error instanceof OAuthReconnectRequiredError) {
        return new Response(
          JSON.stringify({ error: "Email permission must be reconnected", emails: [], reconnectRequired: true }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Email connection is unavailable", emails: [] }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!credential) {
      return new Response(
        JSON.stringify({ error: "Not connected", emails: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!hasRecordedOAuthServiceScope(credential, "email")) {
      return new Response(
        JSON.stringify({ error: "Email permission is required", emails: [], reconnectRequired: true }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      let emails: any[] = [];

      if (provider === "google") {
        emails = await fetchGmailMessages(credential.accessToken);
      } else if (provider === "microsoft") {
        emails = await fetchMicrosoftEmails(credential.accessToken);
      }

      // Format dates
      const formatted = emails.map((em) => ({
        ...em,
        timeFormatted: formatEmailDate(em.date),
      }));

      const unreadCount = formatted.filter((e) => e.unread).length;

      return new Response(
        JSON.stringify({
          emails: formatted,
          unread: unreadCount,
          total: formatted.length,
          provider,
          email: credential.email,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (error) {
      if (error instanceof OAuthReconnectRequiredError) {
        return new Response(
          JSON.stringify({ error: "Email permission must be reconnected", emails: [], reconnectRequired: true }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: "Email connection is unavailable", emails: [] }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: "Unknown action" }),
    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});

// ─── OAuth callback relay ────────────────────────────────────────────────────

type OAuthResultPage = {
  success: boolean;
  error?: string;
  provider?: string;
  email?: string;
  clientNonce?: string;
};

function oauthResultResponse(result: OAuthResultPage): Response {
  const provider = typeof result.provider === "string" && getProviderConfig(result.provider)
    ? result.provider
    : "";
  const email = typeof result.email === "string" ? result.email.slice(0, 320) : "";
  const error = typeof result.error === "string" ? result.error.slice(0, 500) : "";
  const clientNonce = typeof result.clientNonce === "string" && OAUTH_NONCE_PATTERN.test(result.clientNonce)
    ? result.clientNonce
    : "";
  const relayUrl = new URL("/oauth/email-calendar/callback", APP_ORIGIN);
  relayUrl.hash = new URLSearchParams({
    success: result.success ? "1" : "0",
    provider,
    email,
    error,
    nonce: clientNonce,
  }).toString();

  // Supabase deliberately serves function-generated HTML as sandboxed text,
  // which blocks postMessage scripts. Redirect to the trusted app origin and
  // let the early app bootstrap relay this non-secret, nonce-bound outcome.
  return new Response(null, {
    status: 303,
    headers: {
      "Location": relayUrl.toString(),
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
