// Slack Events API Handler — Supabase Edge Function
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Verify Slack request signature
async function verifySlackSignature(req: Request, body: string): Promise<boolean> {
  const signingSecret = Deno.env.get("SLACK_SIGNING_SECRET");
  if (!signingSecret) return false;

  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");
  if (!timestamp || !signature) return false;

  // Check timestamp is within 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const sigBaseString = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sigBaseString));
  const computed = `v0=${Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("")}`;

  return computed === signature;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.text();

    // Verify signature
    const valid = await verifySlackSignature(req, body);
    if (!valid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const payload = JSON.parse(body);

    // URL verification challenge
    if (payload.type === "url_verification") {
      return new Response(
        JSON.stringify({ challenge: payload.challenge }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Event callback
    if (payload.type === "event_callback") {
      const event = payload.event;

      // Log the event for now
      console.log(`Slack event: ${event.type} from team ${payload.team_id}`);

      // Handle app_mention — someone @mentioned the bot
      if (event.type === "app_mention") {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );

        // Find the connection for this team
        const { data: connection } = await supabase
          .from("slack_connections")
          .select("id, circle_id, bot_token")
          .eq("team_id", payload.team_id)
          .eq("is_active", true)
          .single();

        if (connection?.bot_token) {
          // Reply with a simple acknowledgment for now
          await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${connection.bot_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              channel: event.channel,
              text: "Hey! I'm connected to The Underground Circle. Check-ins and updates will be posted here.",
              thread_ts: event.ts,
            }),
          });
        }
      }
    }

    return new Response("ok", { status: 200 });
  } catch (error: any) {
    console.error("Slack events error:", error);
    return new Response("Internal error", { status: 500 });
  }
});
