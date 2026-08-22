// Teams Auth — Azure AD OAuth for MS Teams integration
//
//   POST (Authorization: Bearer <supabase jwt>) { circleId?, orgId? }
//        → authenticated initiate: verifies the caller is an org owner/admin or
//          the circle creator (mirrors the teams_connections RLS), stores a
//          random state bound to the verified user, returns { url }.
//   GET  ?code&state
//        → Azure redirect callback: validates state against the server store
//          (never a decoded state) and binds the connection to the SERVER-STORED
//          org/circle with installed_by = the stored user.
//
// See docs/EDGE_SECURITY_ADVISORY_2026-07-16.md (second sweep, teams-auth).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEAMS_SCOPES = "ChannelMessage.Send Channel.ReadBasic.All Team.ReadBasic.All";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

function svc() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function getAuthedUser(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return null;
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user } } = await anon.auth.getUser();
  return user?.id || null;
}

type ConnectionAuthority =
  | { ok: true }
  | { ok: false; unavailable: boolean };

// Mirror the connection-table authority without its legacy OR ambiguity.
// Every supplied target must be authorized, and an org+Circle pair must name
// the Circle's actual organization.
async function isAuthorizedForConnection(
  supabase: ReturnType<typeof svc>,
  userId: string,
  orgId: string | null,
  circleId: string | null,
): Promise<ConnectionAuthority> {
  if (!orgId && !circleId) return { ok: false, unavailable: false };

  if (orgId) {
    const { data, error } = await supabase
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .in("role", ["owner", "admin"])
      .maybeSingle();
    if (error) return { ok: false, unavailable: true };
    if (!data) return { ok: false, unavailable: false };
  }

  if (circleId) {
    const { data: circle, error: circleError } = await supabase
      .from("circles")
      .select("org_id")
      .eq("id", circleId)
      .maybeSingle();
    if (circleError) return { ok: false, unavailable: true };
    if (!circle || (orgId && circle.org_id !== orgId)) {
      return { ok: false, unavailable: false };
    }

    const { data, error } = await supabase
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circleId)
      .eq("user_id", userId)
      .eq("role", "creator")
      .maybeSingle();
    if (error) return { ok: false, unavailable: true };
    if (!data) return { ok: false, unavailable: false };
  }

  return { ok: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Authenticated initiate ────────────────────────────────────────────────
  if (req.method === "POST") {
    const userId = await getAuthedUser(req);
    if (!userId) return json({ error: "Unauthenticated" }, 401);

    let body: { circleId?: unknown; orgId?: unknown } = {};
    try { body = await req.json(); } catch { /* empty body */ }
    const circleId = typeof body.circleId === "string" && body.circleId ? body.circleId : null;
    const orgId = typeof body.orgId === "string" && body.orgId ? body.orgId : null;
    if (!circleId && !orgId) return json({ error: "circleId or orgId required" }, 400);

    const supabase = svc();
    const authority = await isAuthorizedForConnection(supabase, userId, orgId, circleId);
    if (!authority.ok) {
      return authority.unavailable
        ? json({ error: "Teams connection access could not be verified" }, 503)
        : json({ error: "Not authorized to connect Teams for this org/Circle" }, 403);
    }

    const clientId = Deno.env.get("TEAMS_CLIENT_ID");
    if (!clientId) return json({ error: "TEAMS_CLIENT_ID not configured" }, 500);

    const stateBytes = new Uint8Array(24);
    crypto.getRandomValues(stateBytes);
    const state = Array.from(stateBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { error: stateErr } = await supabase.from("teams_oauth_states").insert({
      state,
      user_id: userId,
      org_id: orgId,
      circle_id: circleId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (stateErr) {
      console.error("Failed to store Teams OAuth state:", stateErr);
      return json({ error: "Failed to initiate OAuth flow" }, 500);
    }

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/teams-auth`;
    const oauthUrl =
      `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${clientId}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(TEAMS_SCOPES)}` +
      `&state=${state}`;
    return json({ url: oauthUrl });
  }

  // ── Callback (GET from Azure redirect) ────────────────────────────────────
  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(
        `<html><body><h1>Error</h1><p>${error}</p></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } },
      );
    }
    if (!code || !state) {
      return json({ error: "Missing code or state" }, 400);
    }

    const supabase = svc();

    // Validate state against the server store — never trust a decoded state.
    const { data: stateRow } = await supabase
      .from("teams_oauth_states")
      .select("id, user_id, org_id, circle_id, expires_at")
      .eq("state", state)
      .maybeSingle();
    if (!stateRow) {
      return new Response(
        `<html><body><h1>Invalid or expired state</h1></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } },
      );
    }
    if (new Date(stateRow.expires_at) < new Date()) {
      await supabase.from("teams_oauth_states").delete().eq("id", stateRow.id);
      return new Response(
        `<html><body><h1>State expired</h1></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } },
      );
    }

    const clientId = Deno.env.get("TEAMS_CLIENT_ID")!;
    const clientSecret = Deno.env.get("TEAMS_CLIENT_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const redirectUri = `${supabaseUrl}/functions/v1/teams-auth`;

    const tokenResponse = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
        scope: "https://graph.microsoft.com/.default",
      }),
    });

    if (!tokenResponse.ok) {
      await tokenResponse.body?.cancel().catch(() => undefined);
      console.error(`[teams-auth] token exchange failed (${tokenResponse.status})`);
      return new Response(
        `<html><body><h1>Authentication Failed</h1><p>Could not exchange code for token.</p></body></html>`,
        { status: 500, headers: { "Content-Type": "text/html" } },
      );
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Get team/org info from Graph API
    const meResponse = await fetch("https://graph.microsoft.com/v1.0/me/joinedTeams", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const teamsData = await meResponse.json();
    const firstTeam = teamsData.value?.[0];

    // Roles or membership may change while Azure consent is open. Re-prove
    // the server-stored exact binding immediately before the service-role
    // write; the OAuth state is CSRF proof, not durable tenant authority.
    const commitAuthority = await isAuthorizedForConnection(
      supabase,
      stateRow.user_id,
      stateRow.org_id || null,
      stateRow.circle_id || null,
    );
    if (!commitAuthority.ok) {
      await supabase.from("teams_oauth_states").delete().eq("id", stateRow.id);
      return new Response(
        "<html><body><h1>Authorization changed</h1><p>Reconnect from the current organization or Circle.</p></body></html>",
        { status: commitAuthority.unavailable ? 503 : 403, headers: { "Content-Type": "text/html" } },
      );
    }

    // Bind using the SERVER-STORED org/circle, not client-supplied state.
    const { error: insertError } = await supabase
      .from("teams_connections")
      .upsert({
        org_id: stateRow.org_id || null,
        circle_id: stateRow.circle_id || null,
        tenant_id: tokenData.ext_expires_in ? "azure" : "unknown",
        team_name: firstTeam?.displayName || "Microsoft Teams",
        bot_token: accessToken,
        refresh_token: tokenData.refresh_token || null,
        installed_by: stateRow.user_id,
        is_active: true,
      });
    if (insertError) {
      console.error("[teams-auth] connection commit failed");
      await supabase.from("teams_oauth_states").delete().eq("id", stateRow.id);
      return new Response(
        "<html><body><h1>Connection failed</h1><p>Could not save the Teams connection.</p></body></html>",
        { status: 503, headers: { "Content-Type": "text/html" } },
      );
    }

    await supabase.from("teams_oauth_states").delete().eq("id", stateRow.id);

    // Redirect back to app
    const appUrl = Deno.env.get("APP_URL") || "https://app.chrisswanson.xyz";
    const redirectPath = stateRow.circle_id
      ? `/circle/${stateRow.circle_id}?tab=teams`
      : "/";
    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}${redirectPath}` },
    });
  } catch (error: unknown) {
    console.error("[teams-auth] request failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return json({ error: "Teams authorization failed" }, 500);
  }
});
