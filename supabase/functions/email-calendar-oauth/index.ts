// email-calendar-oauth — Supabase Edge Function
//
// Unified OAuth2 handler for Google, Microsoft, and Yahoo.
// Supports Calendar + Email integration for Office furniture items.
//
// Routes:
//   GET  /authorize?provider=google|microsoft|yahoo&scopes=calendar,email&state=JWT
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
  await supabase.rpc("store_user_api_key", {
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
  // Delete old and re-store — use service role to update directly
  await serviceClient
    .from("user_api_keys")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("label", "oauth");

  // Re-store with new tokens — we need to call the RPC as the user
  // Since we can't impersonate, store directly using service role
  const passphrase = "tuc-default-enc-key-change-me"; // fallback
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
    console.warn("[email-calendar-oauth] token refresh store failed:", storeError.message);
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

  // ── GET /authorize — Start OAuth flow ────────────────────────────────────
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

    let body: { provider?: unknown; scopes?: unknown } = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const provider = typeof body.provider === "string" && body.provider ? body.provider : "google";
    const scopes = typeof body.scopes === "string" && body.scopes ? body.scopes : "calendar,email";

    const config = getProviderConfig(provider);
    if (!config || !config.clientId) {
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
    authUrl.searchParams.set("state", nonce);

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
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(oauthResultHTML(false, error), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    if (!code) {
      return new Response(oauthResultHTML(false, "Missing authorization code"), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    // Resolve the flow from the server-stored nonce — never trust a decoded
    // client-supplied state (that carried the JWT; advisory #6).
    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: stateRow } = await serviceClient
      .from("email_calendar_oauth_states")
      .select("id, user_id, provider, scopes, expires_at")
      .eq("state", stateRaw)
      .maybeSingle();
    if (!stateRow) {
      return new Response(oauthResultHTML(false, "Invalid or expired state"), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }
    if (new Date(stateRow.expires_at) < new Date()) {
      await serviceClient.from("email_calendar_oauth_states").delete().eq("id", stateRow.id);
      return new Response(oauthResultHTML(false, "State expired"), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }
    const provider = (stateRow.provider as string) || "google";
    const scopes = (stateRow.scopes as string) || "calendar,email";
    const userId = stateRow.user_id as string;

    const config = getProviderConfig(provider);
    if (!config) {
      return new Response(oauthResultHTML(false, "Unknown provider"), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    // Exchange code for tokens
    const tokenBody: Record<string, string> = {
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: getCallbackUrl(),
      grant_type: "authorization_code",
    };

    const tokenResp = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(tokenBody),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error(`Token exchange failed for ${provider}:`, err);
      return new Response(oauthResultHTML(false, `Token exchange failed`), {
        headers: { ...corsHeaders, "Content-Type": "text/html" },
      });
    }

    const tokens = await tokenResp.json();

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
          userEmail = info.email || "";
        }
      } else if (provider === "microsoft") {
        const infoResp = await fetch(
          "https://graph.microsoft.com/v1.0/me",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (infoResp.ok) {
          const info = await infoResp.json();
          userEmail = info.mail || info.userPrincipalName || "";
        }
      } else if (provider === "yahoo") {
        const infoResp = await fetch(
          "https://api.login.yahoo.com/openid/v1/userinfo",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } }
        );
        if (infoResp.ok) {
          const info = await infoResp.json();
          userEmail = info.email || "";
        }
      }
    } catch {
      // non-critical
    }

    // Store tokens for the verified user via the service role — no JWT needed
    // now that the flow is bound to a server-stored nonce (advisory #6).
    await serviceClient.rpc("store_user_api_key_service", {
      p_user_id: userId,
      p_provider: provider,
      p_api_key: tokens.access_token,
      p_label: "oauth",
      p_endpoint: JSON.stringify({
        refresh_token: tokens.refresh_token || "",
        expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
        email: userEmail,
        scopes,
      }),
    });
    // Single-use: delete the consumed nonce.
    await serviceClient.from("email_calendar_oauth_states").delete().eq("id", stateRow.id);

    // Send success HTML that posts message to opener window
    return new Response(oauthResultHTML(true, "", provider, userEmail), {
      headers: { ...corsHeaders, "Content-Type": "text/html" },
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
    await serviceClient
      .from("user_api_keys")
      .delete()
      .eq("user_id", user.id)
      .eq("provider", provider)
      .eq("label", "oauth");

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

// ─── OAuth result HTML — sends postMessage to opener ──────────────────────────

function oauthResultHTML(
  success: boolean,
  error: string = "",
  provider: string = "",
  email: string = ""
): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${success ? "Connected!" : "Connection Failed"}</title>
  <style>
    body {
      margin: 0; padding: 40px 20px;
      background: #0a0a0a; color: #fff;
      font-family: 'SF Mono', 'Fira Code', monospace;
      display: flex; align-items: center; justify-content: center;
      min-height: 100vh; box-sizing: border-box;
    }
    .card {
      background: #111; border: 1px solid #2a2a2a; border-radius: 16px;
      padding: 40px; text-align: center; max-width: 360px; width: 100%;
    }
    .icon { font-size: 48px; margin-bottom: 16px; }
    h2 { margin: 0 0 8px; font-size: 18px; font-weight: 900; letter-spacing: 1px; }
    p { color: #888; font-size: 12px; margin: 0; line-height: 1.6; }
    .email { color: #22c55e; font-weight: 700; }
    .error { color: #ef4444; }
    .close-hint { color: #555; font-size: 10px; margin-top: 20px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">${success ? "✅" : "❌"}</div>
    <h2>${success ? "CONNECTED" : "CONNECTION FAILED"}</h2>
    ${
      success
        ? `<p>${provider === "google" ? "Google" : provider === "microsoft" ? "Microsoft" : "Yahoo"} account connected</p>
           ${email ? `<p class="email">${email}</p>` : ""}
           <p class="close-hint">This window will close automatically...</p>`
        : `<p class="error">${error}</p>
           <p class="close-hint">Close this window and try again</p>`
    }
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({
        type: 'oauth-callback',
        success: ${success},
        provider: '${provider}',
        email: '${email}',
        error: '${error}'
      }, '*');
      ${success ? "setTimeout(() => window.close(), 1500);" : ""}
    }
  </script>
</body>
</html>`;
}
