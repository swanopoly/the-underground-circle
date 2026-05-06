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
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { email, inviteCode }: RequestBody = await req.json();
    const normalizedEmail = normalizeEmail(email);

    if (!normalizedEmail || !inviteCode) {
      return json({ error: "Missing email or inviteCode" }, 400);
    }

    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    if (!authHeader || !supabaseUrl || !supabaseAnonKey) {
      return json({ error: "Not authenticated" }, 401);
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    const user = userData?.user;
    if (userError || !user) {
      return json({ error: "Not authenticated" }, 401);
    }

    const { data: invite, error: inviteError } = await supabase
      .from("circle_invites")
      .select("invite_code, email, circle_id, invited_by, status, expires_at")
      .eq("invite_code", inviteCode)
      .eq("invited_by", user.id)
      .eq("email", normalizedEmail)
      .eq("status", "pending")
      .single();

    if (inviteError || !invite) {
      return json({ error: "Invite not found or not owned by caller" }, 403);
    }

    if (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now()) {
      return json({ error: "Invite has expired" }, 410);
    }

    const appUrl = Deno.env.get("APP_URL") || "https://app.chrisswanson.xyz";
    const joinUrl = `${appUrl}/join/${encodeURIComponent(invite.invite_code)}`;

    const [{ data: circle }, { data: profile }] = await Promise.all([
      supabase.from("circles").select("name").eq("id", invite.circle_id).single(),
      supabase.from("profiles").select("display_name, username").eq("id", user.id).single(),
    ]);

    const safeCircleName = escapeHtml(circle?.name || "a circle");
    const safeInviterName = escapeHtml(profile?.display_name || profile?.username || "Someone");
    const safeInviteCode = escapeHtml(invite.invite_code);
    const safeJoinUrl = escapeHtml(joinUrl);

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
          to: [normalizedEmail],
          subject: `${safeInviterName} invited you to ${safeCircleName}`,
          html: `
            <div style="font-family: monospace; background: #0a0a0a; color: #fff; padding: 40px; max-width: 500px; margin: 0 auto;">
              <h1 style="color: #6366f1; font-size: 24px;">You're Invited</h1>
              <p style="color: #ccc; font-size: 14px; line-height: 1.6;">
                <strong>${safeInviterName}</strong> has invited you to join <strong>${safeCircleName}</strong> on The Underground Circle.
              </p>
              <p style="color: #888; font-size: 13px;">
                The Underground Circle is an accountability and productivity platform where teams track goals, check in daily, and stay accountable together.
              </p>
              <div style="margin: 30px 0;">
                <a href="${safeJoinUrl}" style="background: #6366f1; color: #fff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">
                  Join ${safeCircleName}
                </a>
              </div>
              <p style="color: #555; font-size: 11px;">
                Or use invite code: <code style="color: #6366f1;">${safeInviteCode}</code>
              </p>
              <hr style="border-color: #1a1a2e; margin: 30px 0;" />
              <p style="color: #444; font-size: 11px;">
                The Underground Circle - Accountability. Productivity. Growth.
              </p>
            </div>
          `,
        }),
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("Resend error:", err);
        return json({ error: "Failed to send email" }, 500);
      }

      return json({ success: true });
    }

    // Fallback: log the invite (no email service configured)
    console.log(`[INVITE] Would email ${normalizedEmail}: join ${safeCircleName} via ${joinUrl}`);

    return json({ success: true, note: "Email service not configured, invite created but email not sent" });
  } catch (error: any) {
    console.error("Send invite email error:", error);
    return json({ error: error.message || "Internal server error" }, 500);
  }
});
