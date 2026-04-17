// publish-preview — authenticated edge fn that takes the user's current
// Builder artifact HTML and creates a shareable public URL for it.
//
// POST body: { html: string, title?: string, circle_id?: string }
// Response:  { id: string, url: string, expires_at: string }
//
// The URL returned points at `view-build?id=<id>`, which is the public
// renderer. Auth is required here (we want to pin the row to a user for
// ownership + rate limiting), but the resulting share link is public.
//
// Deploy: npx supabase functions deploy publish-preview

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_HTML_BYTES = 400_000; // ~400KB is plenty for a landing page

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface PublishRequest {
  html: string;
  title?: string;
  circle_id?: string | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "service misconfigured" }, 500);

  // Authenticate the caller using the JWT from the Authorization header,
  // then do the actual work with the service-role client so the insert
  // bypasses RLS (we already checked ownership).
  const authHeader = req.headers.get("authorization");
  if (!authHeader) return json({ error: "authorization header required" }, 401);
  const anonClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") || "", {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userResp } = await anonClient.auth.getUser();
  const userId = userResp?.user?.id;
  if (!userId) return json({ error: "authentication failed" }, 401);

  let body: PublishRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON body" }, 400);
  }

  if (!body.html || typeof body.html !== "string") return json({ error: "html required" }, 400);
  const byteLen = new TextEncoder().encode(body.html).length;
  if (byteLen > MAX_HTML_BYTES) {
    return json({ error: `html too large (${byteLen} bytes > ${MAX_HTML_BYTES})` }, 413);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  if (body.circle_id) {
    const { data: membership, error: membershipError } = await supabase
      .from("circle_members")
      .select("circle_id")
      .eq("circle_id", body.circle_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (membershipError || !membership) {
      return json({ error: "you are not a member of the requested circle" }, 403);
    }
  }

  const { data, error } = await supabase
    .from("builder_publications")
    .insert({
      user_id: userId,
      circle_id: body.circle_id ?? null,
      title: (body.title || "Shared build").slice(0, 120),
      html: body.html,
    })
    .select("id, expires_at")
    .single();

  if (error || !data) {
    return json({ error: error?.message || "insert failed" }, 500);
  }

  const viewUrl = `${supabaseUrl}/functions/v1/view-build?id=${data.id}`;
  return json({ id: data.id, url: viewUrl, expires_at: data.expires_at });
});
