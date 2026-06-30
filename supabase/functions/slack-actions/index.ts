// Slack Actions — Send outbound messages to Slack channels
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { getAuthenticatedUser, isServiceRoleRequest, userOwnsConnection } from "../_shared/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { connectionId, channelId, text, blocks } = await req.json();

    if (!connectionId || !channelId || !text) {
      return new Response(
        JSON.stringify({ error: "Missing connectionId, channelId, or text" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Authorize: a trusted service-role caller (automation) OR an authenticated
    // user. Membership against the connection's owning org/circle is verified
    // below, once we know which connection this is.
    const serviceRole = isServiceRoleRequest(req);
    let authUserId: string | null = null;
    if (!serviceRole) {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) {
        return new Response(
          JSON.stringify({ error: "Authentication required", code: "unauthenticated" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      authUserId = authUser.id;
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up bot token + owning org/circle
    const { data: connection } = await supabase
      .from("slack_connections")
      .select("bot_token, org_id, circle_id")
      .eq("id", connectionId)
      .eq("is_active", true)
      .single();

    if (!connection?.bot_token) {
      return new Response(
        JSON.stringify({ error: "Slack connection not found or inactive" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // IDOR guard: the caller must belong to the org/circle that owns this
    // connection — otherwise any signed-in user could post to any connected
    // Slack workspace by enumerating connectionId.
    if (!serviceRole && !(await userOwnsConnection(supabase, authUserId!, connection.org_id, connection.circle_id))) {
      return new Response(
        JSON.stringify({ error: "Not authorized for this connection", code: "forbidden" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Post message to Slack
    const slackResponse = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${connection.bot_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        ...(blocks ? { blocks } : {}),
      }),
    });

    const slackData = await slackResponse.json();

    if (!slackData.ok) {
      return new Response(
        JSON.stringify({ error: slackData.error || "Slack API error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, ts: slackData.ts }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Slack actions error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
