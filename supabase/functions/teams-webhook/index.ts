// Teams Webhook — Send outbound messages to Teams channels + receive bot messages
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
    const body = await req.json();
    const { action, connectionId, channelId, text } = body;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Handle outbound messages
    if (action === "send") {
      if (!connectionId || !channelId || !text) {
        return new Response(
          JSON.stringify({ error: "Missing connectionId, channelId, or text" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Authorize the outbound send: a trusted service-role caller (automation)
      // OR an authenticated user who belongs to the connection's owning
      // org/circle. Without this, any caller could post to any connected Teams
      // channel by enumerating connectionId (IDOR → spoofing/phishing).
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

      // Look up connection token + owning org/circle
      const { data: connection } = await supabase
        .from("teams_connections")
        .select("bot_token, tenant_id, org_id, circle_id")
        .eq("id", connectionId)
        .eq("is_active", true)
        .single();

      if (!connection?.bot_token) {
        return new Response(
          JSON.stringify({ error: "Teams connection not found or inactive" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (!serviceRole && !(await userOwnsConnection(supabase, authUserId!, connection.org_id, connection.circle_id))) {
        return new Response(
          JSON.stringify({ error: "Not authorized for this connection", code: "forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Post message via Graph API
      // channelId format: teamId/channelId
      const [teamId, teamsChannelId] = channelId.split("/");

      const graphResponse = await fetch(
        `https://graph.microsoft.com/v1.0/teams/${teamId}/channels/${teamsChannelId}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${connection.bot_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            body: {
              contentType: "text",
              content: text,
            },
          }),
        }
      );

      if (!graphResponse.ok) {
        const errorData = await graphResponse.json().catch(() => ({}));
        return new Response(
          JSON.stringify({ error: errorData.error?.message || "Teams API error" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const messageData = await graphResponse.json();

      return new Response(
        JSON.stringify({ success: true, id: messageData.id }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Handle inbound bot messages (from Teams webhook subscription)
    // SECURITY: inbound payloads come from Microsoft, not an app user, so they
    // carry no Supabase JWT. Before this handler does anything beyond logging
    // (e.g. executing commands), it MUST verify the Bot Framework JWT / channel
    // clientState secret — otherwise anyone can POST a forged "message".
    if (body.type === "message" && body.text) {
      // Do not copy private Teams message content into hosted logs. Command
      // handling remains disabled until the Bot Framework signature is
      // verified; this acknowledgement intentionally carries no content.
      console.info("[teams-webhook] Inbound message ignored pending signature verification");

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validation challenge
    if (body.validationToken) {
      return new Response(body.validationToken, {
        headers: { ...corsHeaders, "Content-Type": "text/plain" },
      });
    }

    return new Response(
      JSON.stringify({ error: "Unknown action" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Teams webhook error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
