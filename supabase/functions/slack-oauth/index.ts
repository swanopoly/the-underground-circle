// Slack OAuth Callback — Supabase Edge Function
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // Handle OAuth callback (GET from Slack redirect)
  if (req.method === "GET") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      return Response.redirect(`https://app.chrisswanson.xyz?slack_error=${error}`, 302);
    }

    if (!code || !state) {
      return new Response("Missing code or state", { status: 400 });
    }

    try {
      const { circleId, orgId } = JSON.parse(atob(state));

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
        return Response.redirect(`https://app.chrisswanson.xyz?slack_error=${tokenData.error}`, 302);
      }

      // Store connection
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );

      await supabase.from("slack_connections").insert({
        org_id: orgId || null,
        circle_id: circleId || null,
        team_id: tokenData.team?.id,
        team_name: tokenData.team?.name,
        bot_token: tokenData.access_token,
        bot_user_id: tokenData.bot_user_id,
        scopes: tokenData.scope?.split(",") || [],
      });

      return Response.redirect(`https://app.chrisswanson.xyz?slack_connected=true`, 302);
    } catch (err: any) {
      console.error("Slack OAuth error:", err);
      return Response.redirect(`https://app.chrisswanson.xyz?slack_error=internal`, 302);
    }
  }

  return new Response("Method not allowed", { status: 405 });
});
