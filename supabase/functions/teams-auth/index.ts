// Teams Auth — Azure AD OAuth callback for MS Teams integration
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return new Response(
        `<html><body><h1>Error</h1><p>${error}</p></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    if (!code || !state) {
      return new Response(
        JSON.stringify({ error: "Missing code or state" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Decode state
    let stateData: { circleId?: string; orgId?: string };
    try {
      stateData = JSON.parse(atob(state));
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid state" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const clientId = Deno.env.get("TEAMS_CLIENT_ID")!;
    const clientSecret = Deno.env.get("TEAMS_CLIENT_SECRET")!;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const redirectUri = `${supabaseUrl}/functions/v1/teams-auth`;

    // Exchange code for token
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
      const err = await tokenResponse.text();
      console.error("Token exchange error:", err);
      return new Response(
        `<html><body><h1>Authentication Failed</h1><p>Could not exchange code for token.</p></body></html>`,
        { status: 500, headers: { "Content-Type": "text/html" } }
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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Store connection
    const { error: insertError } = await supabase
      .from("teams_connections")
      .upsert({
        org_id: stateData.orgId || null,
        circle_id: stateData.circleId || null,
        tenant_id: tokenData.ext_expires_in ? "azure" : "unknown",
        team_name: firstTeam?.displayName || "Microsoft Teams",
        bot_token: accessToken,
        refresh_token: tokenData.refresh_token || null,
        is_active: true,
      });

    if (insertError) {
      console.error("DB insert error:", insertError);
    }

    // Redirect back to app
    const appUrl = Deno.env.get("APP_URL") || "https://app.chrisswanson.xyz";
    const redirectPath = stateData.circleId
      ? `/circle/${stateData.circleId}?tab=teams`
      : "/";

    return new Response(null, {
      status: 302,
      headers: { Location: `${appUrl}${redirectPath}` },
    });
  } catch (error: any) {
    console.error("Teams auth error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
