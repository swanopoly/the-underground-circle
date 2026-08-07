// email-calendar-oauth — Supabase Edge Function
//
// Unified OAuth2 handler for Google, Microsoft, and Yahoo.
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
    case "yahoo":
      return {
        authUrl: "https://api.login.yahoo.com/oauth2/request_auth",
        tokenUrl: "https://api.login.yahoo.com/oauth2/get_token",
        clientId: Deno.env.get("YAHOO_CLIENT_ID") || "",
        clientSecret: Deno.env.get("YAHOO_CLIENT_SECRET") || "",
        scopes: {
          calendar: "",
          email: "mail-r",
          base: "openid",
        },
      };
    default:
      return null;
  }
}

// ─── Token helpers ────────────────────────────────────────────────────────────

async function storeTokens(
  supabase: any,
  provider: string,
  accessToken: string,
  refreshToken: string | null,
  expiresIn: number,
  email?: string,
  scopesGranted?: string
): Promise<void> {
  const { error } = await supabase.rpc("store_user_api_key", {
    p_provider: provider,
    p_api_key: accessToken,
    p_label: "oauth",
    p_endpoint: JSON.stringify({
      refresh_token: refreshToken || "",
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      email: email || "",
      scopes: scopesGranted || "",
    }),
  });
  if (error) throw new Error("Token persistence failed");
}

async function getStoredTokens(
  userId: string,
  provider: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: string; email: string } | null> {
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await serviceClient.rpc("get_user_api_key", {
    p_user_id: userId,
    p_provider: provider,
    p_label: "oauth",
  });

  if (!data || data.length === 0) return null;
  const row = data[0];
  let meta: any = {};
  try {
    meta = JSON.parse(row.endpoint || "{}");
  } catch {
    /* ignore */
  }
  return {
    accessToken: row.api_key,
    refreshToken: meta.refresh_token || "",
    expiresAt: meta.expires_at || "",
    email: meta.email || "",
  };
}

async function refreshTokenIfNeeded(
  userId: string,
  provider: string,
  tokens: { accessToken: string; refreshToken: string; expiresAt: string; email: string }
): Promise<string> {
  // Check if token is expired (with 5 min buffer)
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) {
    return tokens.accessToken;
  }

  if (!tokens.refreshToken) {
    throw new Error("Token expired and no refresh token available");
  }

  const config = getProviderConfig(provider);
  if (!config) throw new Error("Unknown provider");

  const body: Record<string, string> = {
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: tokens.refreshToken,
    grant_type: "refresh_token",
  };

  const resp = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (!resp.ok) {
    throw new Error(`Token refresh failed: ${await resp.text()}`);
  }

  const data = await resp.json();
  const newAccessToken = data.access_token;
  const newRefreshToken = data.refresh_token || tokens.refreshToken;
  const expiresIn = data.expires_in || 3600;

  // Update stored tokens using service role
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  // Store the replacement atomically through the service RPC. Deleting the
  // old row first could strand the user without a credential if persistence
  // failed after a successful provider refresh.
  const { error: storeError } = await serviceClient.rpc("store_user_api_key_service", {
    p_user_id: userId,
    p_provider: provider,
    p_api_key: newAccessToken,
    p_label: "oauth",
    p_endpoint: JSON.stringify({
      refresh_token: newRefreshToken,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      email: tokens.email,
    }),
  });
  if (storeError) {
    console.error("[email-calendar-oauth] token refresh store failed:", storeError.message);
    throw new Error("Token refresh persistence failed");
  }

  return newAccessToken;
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
    const err = await resp.text();
    throw new Error(`Google Calendar API error: ${err}`);
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
    throw new Error(`Gmail API error: ${await listResp.text()}`);
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
    throw new Error(`Microsoft Calendar API error: ${await resp.text()}`);
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
    throw new Error(`Microsoft Mail API error: ${await resp.text()}`);
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

// ─── Yahoo API helpers ────────────────────────────────────────────────────────

async function fetchYahooEmails(accessToken: string): Promise<any[]> {
  // Yahoo Mail API via Yahoo Social API
  // Note: Yahoo's mail REST API is limited. We try the endpoint:
  const resp = await fetch(
    "https://api.login.yahoo.com/openid/v1/userinfo",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  // Yahoo's mail REST API is deprecated — return user info at minimum
  // so the widget shows the connected account
  if (resp.ok) {
    const userInfo = await resp.json();
    return [
      {
        id: "yahoo-connected",
        sender: userInfo.name || userInfo.email || "Yahoo Mail",
        subject: "Connected — open Yahoo Mail to view inbox",
        date: new Date().toISOString(),
        snippet: "Yahoo Mail connected successfully",
        unread: false,
      },
    ];
  }

  return [];
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
    const scopes = typeof body.scopes === "string" && body.scopes ? body.scopes : "calendar,email";
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

    // Build scope string
    const scopeParts = [config.scopes.base];
    if (scopes.includes("calendar") && config.scopes.calendar) {
      scopeParts.push(config.scopes.calendar);
    }
    if (scopes.includes("email") && config.scopes.email) {
      scopeParts.push(config.scopes.email);
    }

    // Opaque single-use nonce bound to the verified user, stored server-side.
    const nonceBytes = new Uint8Array(24);
    crypto.getRandomValues(nonceBytes);
    const nonce = Array.from(nonceBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: stateErr } = await serviceClient.from("email_calendar_oauth_states").insert({
      state: nonce,
      user_id: user.id,
      provider,
      scopes,
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
      .select("id, user_id, provider, scopes, expires_at")
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
        error: providerError.slice(0, 200),
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
    const scopes = (stateRow.scopes as string) || "calendar,email";
    const userId = stateRow.user_id as string;

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

    // Get user email for display
    let userEmail = "";
    try {
      if (provider === "google") {
        const infoResp = await fetch(
          "https://www.googleapis.com/oauth2/v2/userinfo",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (infoResp.ok) {
          const info = await infoResp.json();
          userEmail = typeof info.email === "string" ? info.email : "";
        }
      } else if (provider === "microsoft") {
        const infoResp = await fetch(
          "https://graph.microsoft.com/v1.0/me",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (infoResp.ok) {
          const info = await infoResp.json();
          userEmail = typeof info.mail === "string"
            ? info.mail
            : typeof info.userPrincipalName === "string"
              ? info.userPrincipalName
              : "";
        }
      } else if (provider === "yahoo") {
        const infoResp = await fetch(
          "https://api.login.yahoo.com/openid/v1/userinfo",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (infoResp.ok) {
          const info = await infoResp.json();
          userEmail = typeof info.email === "string" ? info.email : "";
        }
      }
    } catch {
      // non-critical
    }

    // Store tokens for the verified user via the service role — no JWT needed
    // now that the flow is bound to a server-stored nonce (advisory #6).
    const expiresIn = Number.isFinite(Number(tokens.expires_in))
      ? Math.max(60, Math.min(Number(tokens.expires_in), 604_800))
      : 3600;
    let storeError: unknown = null;
    try {
      const storeResult = await serviceClient.rpc("store_user_api_key_service", {
        p_user_id: userId,
        p_provider: provider,
        p_api_key: tokens.access_token,
        p_label: "oauth",
        p_endpoint: JSON.stringify({
          refresh_token: typeof tokens.refresh_token === "string" ? tokens.refresh_token : "",
          expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
          email: userEmail.slice(0, 320),
          scopes,
        }),
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

  const provider = body.provider || "google";

  // ── POST /status — Check connection ──────────────────────────────────────
  if (action === "status") {
    const tokens = await getStoredTokens(user.id, provider);
    return new Response(
      JSON.stringify({
        connected: !!tokens,
        email: tokens?.email || "",
        provider,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── POST /disconnect — Remove tokens ─────────────────────────────────────
  if (action === "disconnect") {
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    let disconnectError: unknown = null;
    try {
      const disconnectResult = await serviceClient
        .from("user_api_keys")
        .delete()
        .eq("user_id", user.id)
        .eq("provider", provider)
        .eq("label", "oauth");
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
    const tokens = await getStoredTokens(user.id, provider);
    if (!tokens) {
      return new Response(
        JSON.stringify({ error: "Not connected", events: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const accessToken = tokens.accessToken; // TODO: refresh if needed
      let events: any[] = [];

      if (provider === "google") {
        events = await fetchGoogleCalendarEvents(accessToken);
      } else if (provider === "microsoft") {
        events = await fetchMicrosoftCalendarEvents(accessToken);
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
          email: tokens.email,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err.message, events: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // ── POST /fetch-emails — Get real emails ─────────────────────────────────
  if (action === "fetch-emails") {
    const tokens = await getStoredTokens(user.id, provider);
    if (!tokens) {
      return new Response(
        JSON.stringify({ error: "Not connected", emails: [] }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    try {
      const accessToken = tokens.accessToken;
      let emails: any[] = [];

      if (provider === "google") {
        emails = await fetchGmailMessages(accessToken);
      } else if (provider === "microsoft") {
        emails = await fetchMicrosoftEmails(accessToken);
      } else if (provider === "yahoo") {
        emails = await fetchYahooEmails(accessToken);
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
          email: tokens.email,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err.message, emails: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
