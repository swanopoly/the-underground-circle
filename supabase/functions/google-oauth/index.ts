// Google OAuth — Supabase Edge Function
//
// Handles Google Workspace OAuth for Gmail / Calendar / Drive / Sheets /
// Docs / Contacts integration. Distinct from Supabase Auth's built-in
// Google provider: THAT handles sign-in (identity only); THIS handles
// the long-lived Workspace scope grant so edge functions can call
// Google APIs on the user's behalf.
//
//   ?action=authorize  — returns Google consent URL with narrowed scopes
//   ?action=callback   — exchanges code for tokens, stores in DB
//   ?action=status     — returns {connected, email, scopes, expires_at}
//   ?action=token      — returns a VALID access token, refreshing via the
//                        stored refresh_token when expired (never returns
//                        the refresh_token itself)
//   ?action=revoke     — hits Google's revoke endpoint + deletes row
//
// Env required:
//   GOOGLE_OAUTH_CLIENT_ID
//   GOOGLE_OAUTH_CLIENT_SECRET
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   SUPABASE_ANON_KEY  (for auth verification)
//
// Deploy: npx supabase functions deploy google-oauth

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// The post-callback redirect. Must match whatever the client expects to
// handle the success page (typically a shallow "close the popup" route).
// When running locally the client usually opens http://localhost:8081;
// production sits behind app.chrisswanson.xyz. We read it from env so
// the same function works in both environments.
const APP_URL = Deno.env.get("APP_URL") || "https://app.chrisswanson.xyz";

// Scope sets — matches Hermes's `--services` shorthand so the UI can
// offer checkboxes that map directly to granular consent.
const SCOPE_SETS: Record<string, string[]> = {
  email:    ["https://www.googleapis.com/auth/gmail.modify"],
  calendar: ["https://www.googleapis.com/auth/calendar"],
  drive:    ["https://www.googleapis.com/auth/drive"],
  sheets:   ["https://www.googleapis.com/auth/spreadsheets"],
  docs:     ["https://www.googleapis.com/auth/documents"],
  contacts: ["https://www.googleapis.com/auth/contacts.readonly"],
};

// Always included so we can reliably get the user's email back from
// the `userinfo` endpoint for display in settings.
const BASE_SCOPES = [
  "openid",
  "email",
  "profile",
];

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getServiceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getAuthedUser(req: Request): Promise<string | null> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace("Bearer ", "");
  if (!token) return null;
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user } } = await anon.auth.getUser();
  return user?.id || null;
}

// ─── Action: authorize ──────────────────────────────────────────────────

async function handleAuthorize(req: Request, url: URL): Promise<Response> {
  const userId = await getAuthedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthenticated" }, 401);

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  if (!clientId) return jsonResponse({ error: "GOOGLE_OAUTH_CLIENT_ID not configured" }, 500);

  // Parse requested services. Default to the full set if none specified.
  // `?services=email,calendar,drive` — matches Hermes's shorthand.
  const servicesParam = url.searchParams.get("services") || "email,calendar,drive,sheets,docs,contacts";
  const services = servicesParam.split(",").map((s) => s.trim()).filter(Boolean);
  const scopes = new Set<string>(BASE_SCOPES);
  for (const svc of services) {
    const set = SCOPE_SETS[svc];
    if (set) set.forEach((s) => scopes.add(s));
  }

  // CSRF state token.
  const stateBytes = new Uint8Array(24);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const supabase = getServiceClient();
  const { error: stateErr } = await supabase
    .from("google_oauth_states")
    .insert({
      state,
      user_id: userId,
      services,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
  if (stateErr) {
    console.error("Failed to store google oauth state:", stateErr);
    return jsonResponse({ error: "Failed to initiate OAuth flow" }, 500);
  }

  const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth?action=callback`;

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    // Ask for a refresh_token — the whole point of this flow. Without
    // `access_type=offline` + `prompt=consent` Google omits it on
    // subsequent authorizations and our edge function can't refresh.
    access_type: "offline",
    prompt: "consent",
    scope: [...scopes].join(" "),
    state,
    include_granted_scopes: "true",
  });

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  return jsonResponse({ url: authUrl });
}

// ─── Action: callback ───────────────────────────────────────────────────

async function handleCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  // Google returned an error page — redirect back to app with error flag.
  if (errorParam) {
    return Response.redirect(`${APP_URL}/?google_oauth=error&reason=${encodeURIComponent(errorParam)}`, 302);
  }
  if (!code || !state) {
    return new Response("Missing code or state", { status: 400 });
  }

  const supabase = getServiceClient();

  // Verify + consume the state row.
  const { data: stateRow, error: stateErr } = await supabase
    .from("google_oauth_states")
    .select("user_id, services, expires_at")
    .eq("state", state)
    .maybeSingle();
  if (stateErr || !stateRow) {
    return new Response("Invalid OAuth state (expired or CSRF)", { status: 400 });
  }
  if (new Date(stateRow.expires_at) < new Date()) {
    await supabase.from("google_oauth_states").delete().eq("state", state);
    return new Response("OAuth state expired — please retry", { status: 400 });
  }
  // One-shot use — delete before the token exchange so even a replay
  // in-flight can't succeed twice.
  await supabase.from("google_oauth_states").delete().eq("state", state);

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;
  const callbackUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-oauth?action=callback`;

  // Exchange the code.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("Google token exchange failed:", errText.slice(0, 400));
    return new Response("Token exchange failed: " + errText.slice(0, 300), { status: 502 });
  }
  const tokens = await tokenRes.json();
  // Shape: { access_token, expires_in, refresh_token, scope, token_type, id_token }

  // Ask Google who this is — cheaper than decoding the id_token here.
  const userinfoRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const userinfo = userinfoRes.ok ? await userinfoRes.json() : { email: null };
  const email = String(userinfo?.email || "");

  // Upsert credentials.
  const scopes = String(tokens.scope || "").split(/\s+/).filter(Boolean);
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();

  const { error: upsertErr } = await supabase
    .from("user_google_credentials")
    .upsert({
      user_id: stateRow.user_id,
      email,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      expires_at: expiresAt,
      scopes,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });

  if (upsertErr) {
    console.error("Failed to upsert google credentials:", upsertErr);
    return new Response("Failed to save credentials", { status: 500 });
  }

  // Redirect back to the app with a success flag. The client listens for
  // this flag on mount + refreshes its connection status.
  return Response.redirect(`${APP_URL}/?google_oauth=ok`, 302);
}

// ─── Action: status ─────────────────────────────────────────────────────

async function handleStatus(req: Request): Promise<Response> {
  const userId = await getAuthedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthenticated" }, 401);

  const supabase = getServiceClient();
  const { data } = await supabase
    .from("user_google_credentials")
    .select("email, scopes, expires_at, updated_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return jsonResponse({ connected: false });
  return jsonResponse({
    connected: true,
    email: data.email,
    scopes: data.scopes || [],
    expires_at: data.expires_at,
    updated_at: data.updated_at,
  });
}

// ─── Action: token ──────────────────────────────────────────────────────
// The durability route (P14): client tools (docs.create_document etc.) hold
// only the ~1h access_token; this refreshes-and-returns so a connection made
// weeks ago still works. The refresh_token NEVER leaves this function.

async function handleToken(req: Request): Promise<Response> {
  const userId = await getAuthedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthenticated" }, 401);

  const supabase = getServiceClient();
  const { data: creds } = await supabase
    .from("user_google_credentials")
    .select("access_token, refresh_token, expires_at, scopes")
    .eq("user_id", userId)
    .maybeSingle();

  if (!creds) return jsonResponse({ error: "not_connected" }, 404);

  // Still fresh (2-minute safety margin)? Return the cached token as-is.
  const expiresAtMs = creds.expires_at ? new Date(creds.expires_at).getTime() : 0;
  if (creds.access_token && expiresAtMs - Date.now() > 2 * 60 * 1000) {
    return jsonResponse({
      access_token: creds.access_token,
      expires_at: creds.expires_at,
      scopes: creds.scopes || [],
      refreshed: false,
    });
  }

  if (!creds.refresh_token) {
    return jsonResponse({ error: "reconnect_required" }, 401);
  }

  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) {
    return jsonResponse({ error: "Google OAuth not configured" }, 500);
  }

  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: creds.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!refreshRes.ok) {
    const errText = await refreshRes.text();
    console.error("Google token refresh failed:", errText.slice(0, 400));
    // invalid_grant = revoked/expired consent — the user must reconnect.
    // Keep the row (revoke is the user's explicit action, not ours).
    const reconnect = /invalid_grant/i.test(errText);
    return jsonResponse(
      { error: reconnect ? "reconnect_required" : "refresh_failed" },
      reconnect ? 401 : 502,
    );
  }

  const tokens = await refreshRes.json();
  // Shape: { access_token, expires_in, scope, token_type } — refresh grants
  // do NOT return a new refresh_token unless rotation is enabled.
  const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString();
  await supabase
    .from("user_google_credentials")
    .update({
      access_token: tokens.access_token,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  return jsonResponse({
    access_token: tokens.access_token,
    expires_at: expiresAt,
    scopes: creds.scopes || [],
    refreshed: true,
  });
}

// ─── Action: revoke ─────────────────────────────────────────────────────

async function handleRevoke(req: Request): Promise<Response> {
  const userId = await getAuthedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthenticated" }, 401);

  const supabase = getServiceClient();
  const { data: creds } = await supabase
    .from("user_google_credentials")
    .select("refresh_token")
    .eq("user_id", userId)
    .maybeSingle();

  if (creds?.refresh_token) {
    // Best-effort revoke at Google's endpoint. Non-fatal — still delete
    // our row so the user is fully disconnected on our side.
    try {
      await fetch(
        `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(creds.refresh_token)}`,
        { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } },
      );
    } catch { /* ignore */ }
  }

  await supabase.from("user_google_credentials").delete().eq("user_id", userId);
  return jsonResponse({ revoked: true });
}

// ─── Router ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    switch (action) {
      case "authorize": return await handleAuthorize(req, url);
      case "callback":  return await handleCallback(url);
      case "status":    return await handleStatus(req);
      case "token":     return await handleToken(req);
      case "revoke":    return await handleRevoke(req);
      default:
        return jsonResponse({ error: "Unknown action. Use ?action=authorize|callback|status|revoke|token" }, 400);
    }
  } catch (err: any) {
    console.error("google-oauth error:", err);
    return jsonResponse({ error: err?.message || "Internal error" }, 500);
  }
});
