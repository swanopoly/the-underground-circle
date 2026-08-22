// Slack OAuth — Supabase Edge Function
//
//   POST  (Authorization: Bearer <supabase jwt>) { circleId?, orgId? }
//         → authenticated initiate: verifies the caller, stores a random state
//           bound to the verified user + validated circle, returns { url }.
//   GET   ?code&state
//         → Slack redirect callback: validates state against the server store
//           (never trusts a decoded state) and binds the connection to the
//           SERVER-STORED circle/org.
//
// See docs/EDGE_SECURITY_ADVISORY_2026-07-16.md finding #3.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const APP_URL = "https://app.chrisswanson.xyz";
const SLACK_SCOPES = "chat:write,channels:read,channels:history,commands,users:read,app_mentions:read";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

type ConnectionAuthority =
  | { ok: true }
  | { ok: false; unavailable: boolean };

// Mirror the connection-table authority without its legacy OR ambiguity.
// Every supplied target must be authorized, and an org+Circle pair must name
// the Circle's actual organization.
async function authorizeConnectionBinding(
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

    const { data: membership, error: membershipError } = await supabase
      .from("circle_members")
      .select("user_id")
      .eq("circle_id", circleId)
      .eq("user_id", userId)
      .eq("role", "creator")
      .maybeSingle();
    if (membershipError) return { ok: false, unavailable: true };
    if (!membership) return { ok: false, unavailable: false };
  }

  return { ok: true };
}

// Resolve the VERIFIED caller from the Authorization: Bearer <supabase jwt>
// header. The service-role writes below bypass RLS, so this is the only access
// control on the initiate path. (Mirrors google-oauth.)
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);

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

    const authority = await authorizeConnectionBinding(supabase, userId, orgId, circleId);
    if (!authority.ok) {
      return authority.unavailable
        ? json({ error: "Slack connection access could not be verified" }, 503)
        : json({ error: "Not authorized to connect Slack for this org/Circle" }, 403);
    }

    const clientId = Deno.env.get("SLACK_CLIENT_ID");
    if (!clientId) return json({ error: "SLACK_CLIENT_ID not configured" }, 500);

    const stateBytes = new Uint8Array(24);
    crypto.getRandomValues(stateBytes);
    const state = Array.from(stateBytes).map((b) => b.toString(16).padStart(2, "0")).join("");

    const { error: stateErr } = await supabase.from("slack_oauth_states").insert({
      state,
      user_id: userId,
      circle_id: circleId,
      org_id: orgId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });
    if (stateErr) {
      console.error("Failed to store Slack OAuth state:", stateErr);
      return json({ error: "Failed to initiate OAuth flow" }, 500);
    }

    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/slack-oauth`;
    const oauthUrl =
      `https://slack.com/oauth/v2/authorize?client_id=${clientId}` +
      `&scope=${SLACK_SCOPES}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${state}`;
    return json({ url: oauthUrl });
  }

  // ── Callback (GET from Slack redirect) ────────────────────────────────────
  if (req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) return Response.redirect(`${APP_URL}?slack_error=${error}`, 302);
    if (!code || !state) return new Response("Missing code or state", { status: 400 });

    try {
      const supabase = svc();

      // Validate state against the server-side store — never trust a decoded
      // client-supplied state (that was the CSRF hole).
      const { data: stateRow } = await supabase
        .from("slack_oauth_states")
        .select("id, user_id, circle_id, org_id, expires_at")
        .eq("state", state)
        .maybeSingle();
      if (!stateRow) return Response.redirect(`${APP_URL}?slack_error=invalid_state`, 302);
      if (new Date(stateRow.expires_at) < new Date()) {
        await supabase.from("slack_oauth_states").delete().eq("id", stateRow.id);
        return Response.redirect(`${APP_URL}?slack_error=state_expired`, 302);
      }

      // Exchange code for token
      const tokenResponse = await fetch("https://slack.com/api/oauth.v2.access", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: Deno.env.get("SLACK_CLIENT_ID")!,
          client_secret: Deno.env.get("SLACK_CLIENT_SECRET")!,
          code,
          redirect_uri: `${Deno.env.get("SUPABASE_URL")}/functions/v1/slack-oauth`,
        }),
      });
      const tokenData = await tokenResponse.json();
      if (!tokenData.ok) {
        console.error("Slack token exchange failed:", tokenData.error);
        return Response.redirect(`${APP_URL}?slack_error=${tokenData.error}`, 302);
      }

      // Membership or roles may change while the provider consent page is
      // open. Re-prove the server-stored exact binding immediately before the
      // service-role write; never treat a once-valid OAuth state as durable
      // tenant authority.
      const commitAuthority = await authorizeConnectionBinding(
        supabase,
        stateRow.user_id,
        stateRow.org_id || null,
        stateRow.circle_id || null,
      );
      if (!commitAuthority.ok) {
        await supabase.from("slack_oauth_states").delete().eq("id", stateRow.id);
        return Response.redirect(
          `${APP_URL}?slack_error=${commitAuthority.unavailable ? "authority_unavailable" : "authorization_changed"}`,
          302,
        );
      }

      // Bind using the SERVER-STORED circle/org, not the client-supplied state.
      const { error: insertError } = await supabase.from("slack_connections").insert({
        org_id: stateRow.org_id || null,
        circle_id: stateRow.circle_id || null,
        team_id: tokenData.team?.id,
        team_name: tokenData.team?.name,
        bot_token: tokenData.access_token,
        bot_user_id: tokenData.bot_user_id,
        scopes: tokenData.scope?.split(",") || [],
        installed_by: stateRow.user_id,
      });
      if (insertError) {
        console.error("[slack-oauth] connection commit failed");
        return Response.redirect(`${APP_URL}?slack_error=connection_save_failed`, 302);
      }
      await supabase.from("slack_oauth_states").delete().eq("id", stateRow.id);

      return Response.redirect(`${APP_URL}?slack_connected=true`, 302);
    } catch (err: unknown) {
      console.error("[slack-oauth] request failed", {
        name: err instanceof Error ? err.name : typeof err,
      });
      return Response.redirect(`${APP_URL}?slack_error=internal`, 302);
    }
  }

  return new Response("Method not allowed", { status: 405 });
});
