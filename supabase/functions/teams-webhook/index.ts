// Teams Webhook — Send outbound messages to Teams channels + receive bot messages
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

      // Look up connection token
      const { data: connection } = await supabase
        .from("teams_connections")
        .select("bot_token, tenant_id")
        .eq("id", connectionId)
        .eq("is_active", true)
        .single();

      if (!connection?.bot_token) {
        return new Response(
          JSON.stringify({ error: "Teams connection not found or inactive" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
    if (body.type === "message" && body.text) {
      // Log received message — future: handle commands
      console.log("Teams message received:", body.text);

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
