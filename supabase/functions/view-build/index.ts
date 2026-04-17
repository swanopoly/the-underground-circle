// view-build — public edge function that renders a shared Builder HTML
// snapshot at a stable URL. Called by anyone (unauth) via
//   GET /functions/v1/view-build?id=abc123
//
// We look up the id in builder_publications, bump view_count, then return
// the raw HTML. A thin attribution bar is injected so recipients know
// where the page came from; a ?plain=1 query param skips the bar for
// embedding.
//
// Deploy: npx supabase functions deploy view-build --no-verify-jwt
//   (the --no-verify-jwt flag is critical — this endpoint is meant to be
//    opened in an unauthenticated browser tab by random recipients)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function attributionBar(title: string, id: string): string {
  const safeTitle = escapeHtml(title);
  const safeId = escapeHtml(id);
  return `<div id="uc-attr-bar" style="position:fixed;bottom:12px;right:12px;z-index:2147483647;font-family:system-ui,-apple-system,sans-serif;">
  <a href="https://app.chrisswanson.xyz" target="_blank" rel="noopener noreferrer"
     aria-label="Built in Underground Circle: ${safeTitle}"
     style="display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;background:rgba(10,10,20,0.92);color:#e2e8f0;text-decoration:none;font-size:11px;border:1px solid rgba(148,163,184,0.3);box-shadow:0 4px 18px rgba(0,0,0,0.4);">
    <span style="font-weight:800;letter-spacing:0.5px;">UC</span>
    <span style="opacity:0.7;">·</span>
    <span>Built in Underground Circle</span>
    <span style="opacity:0.4;margin-left:4px;font-family:monospace;">${safeId}</span>
  </a>
</div>`;
}

function injectAttribution(html: string, title: string, id: string): string {
  const bar = attributionBar(title, id);
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${bar}</body>`);
  }
  return html + bar;
}

function errorPage(title: string, message: string, status: number): Response {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const body = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${safeTitle}</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>html,body{margin:0;padding:0;background:#050810;color:#e2e8f0;font-family:system-ui,-apple-system,sans-serif;height:100%;}
  .w{max-width:540px;margin:15vh auto;padding:0 24px;text-align:center;}
  h1{font-size:22px;font-weight:800;margin:0 0 12px;}
  p{color:#94a3b8;line-height:1.5;}
  a{color:#22d3ee;text-decoration:none;border-bottom:1px solid #22d3ee55;}
  </style></head><body><div class="w"><h1>${safeTitle}</h1><p>${safeMessage}</p>
  <p style="margin-top:24px;"><a href="https://app.chrisswanson.xyz">The Underground Circle</a></p></div></body></html>`;
  return new Response(body, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return errorPage("Method not allowed", "This endpoint only supports GET.", 405);

  const url = new URL(req.url);
  const id = url.searchParams.get("id");
  if (!id) return errorPage("Missing id", "This link is missing the publication id.", 400);

  const supaUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supaUrl || !serviceKey) {
    return errorPage("Service unavailable", "The view service is misconfigured.", 500);
  }
  const supabase = createClient(supaUrl, serviceKey);

  const { data, error } = await supabase
    .from("builder_publications")
    .select("id, title, html, expires_at")
    .eq("id", id)
    .maybeSingle();

  if (error || !data) {
    return errorPage("Not found", `No shared build at this link${error ? `: ${error.message}` : ''}.`, 404);
  }

  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) {
    return errorPage("Link expired", "This shared build has passed its 30-day lifespan.", 410);
  }

  // Fire-and-forget view-count bump so it doesn't block page load
  supabase.rpc("increment_builder_publication_views", { p_id: id }).catch(() => {});

  const plain = url.searchParams.get("plain") === "1";
  const html = plain ? data.html : injectAttribution(data.html, data.title || "Shared build", data.id);

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      // Content Security Policy — the iframe runs the shared author's code,
      // so we keep it permissive but isolate cookies
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
});
