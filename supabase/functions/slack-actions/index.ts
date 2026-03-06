// Slack Actions — Send outbound messages to Slack channels
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
    const { connectionId, channelId, text, blocks } = await req.json();

    if (!connectionId || !channelId || !text) {
      return new Response(
        JSON.stringify({ error: "Missing connectionId, channelId, or text" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up bot token
    const { data: connection } = await supabase
      .from("slack_connections")
      .select("bot_token")
      .eq("id", connectionId)
      .eq("is_active", true)
      .single();

    if (!connection?.bot_token) {
      return new Response(
        JSON.stringify({ error: "Slack connection not found or inactive" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
