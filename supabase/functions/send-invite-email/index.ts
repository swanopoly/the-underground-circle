// Send Invite Email — Supabase Edge Function
// Sends a circle invite email to a specified address

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestBody {
  email: string;
  inviteCode: string;
  circleName: string;
  inviterName: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, inviteCode, circleName, inviterName }: RequestBody = await req.json();

    if (!email || !inviteCode) {
      return new Response(
        JSON.stringify({ error: "Missing email or inviteCode" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const appUrl = Deno.env.get("APP_URL") || "https://app.chrisswanson.xyz";
    const joinUrl = `${appUrl}/join/${inviteCode}`;

    // Use Supabase's built-in email via the Auth admin API
    // Or use a third-party service like Resend if configured
    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (resendApiKey) {
      // Send via Resend
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "The Underground Circle <noreply@chrisswanson.xyz>",
          to: [email],
          subject: `${inviterName} invited you to ${circleName}`,
          html: `
            <div style="font-family: monospace; background: #0a0a0a; color: #fff; padding: 40px; max-width: 500px; margin: 0 auto;">
              <h1 style="color: #6366f1; font-size: 24px;">You're Invited</h1>
              <p style="color: #ccc; font-size: 14px; line-height: 1.6;">
                <strong>${inviterName}</strong> has invited you to join <strong>${circleName}</strong> on The Underground Circle.
              </p>
              <p style="color: #888; font-size: 13px;">
                The Underground Circle is an accountability and productivity platform where teams track goals, check in daily, and stay accountable together.
              </p>
              <div style="margin: 30px 0;">
                <a href="${joinUrl}" style="background: #6366f1; color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">
                  Join ${circleName}
                </a>
              </div>
              <p style="color: #555; font-size: 11px;">
                Or use invite code: <code style="color: #6366f1;">${inviteCode}</code>
              </p>
              <hr style="border-color: #1a1a2e; margin: 30px 0;" />
              <p style="color: #444; font-size: 11px;">
                The Underground Circle &mdash; Accountability. Productivity. Growth.
              </p>
            </div>
          `,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("Resend error:", err);
        return new Response(
          JSON.stringify({ error: "Failed to send email" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fallback: log the invite (no email service configured)
    console.log(`[INVITE] Would email ${email}: join ${circleName} via ${joinUrl}`);

    return new Response(
      JSON.stringify({ success: true, note: "Email service not configured, invite created but email not sent" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Send invite email error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
