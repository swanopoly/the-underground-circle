// figma-oauth — Figma OAuth2 Flow Edge Function
//
// Handles the Figma OAuth2 authorization code flow:
//   1. /authorize — redirects to Figma auth page
//   2. /callback — exchanges code for tokens, stores in user_api_keys
//   3. /status — checks if user has a Figma connection
//
// Deploy: npx supabase functions deploy figma-oauth

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FIGMA_CLIENT_ID = Deno.env.get("FIGMA_CLIENT_ID") || "";
const FIGMA_CLIENT_SECRET = Deno.env.get("FIGMA_CLIENT_SECRET") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SITE_URL = Deno.env.get("SITE_URL") || "https://app.chrisswanson.xyz";

function getCallbackUrl(): string {
  return `${SUPABASE_URL}/functions/v1/figma-oauth/callback`;
}

// ─── Store tokens ───────────────────────────────────────────────────────────

async function storeTokens(
  supabase: any,
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
): Promise<void> {
  // Store as a "figma" provider API key with tokens in the endpoint field
  await supabase.rpc("store_user_api_key", {
    p_provider: "figma",
    p_api_key: accessToken,
    p_label: "oauth",
    p_endpoint: JSON.stringify({
      refresh_token: refreshToken,
      expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    }),
  });
}

// ─── Refresh token ──────────────────────────────────────────────────────────

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
} | null> {
  const resp = await fetch("https://api.figma.com/v1/oauth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: FIGMA_CLIENT_ID,
      client_secret: FIGMA_CLIENT_SECRET,
      refresh_token: refreshToken,
    }),
  });

  if (!resp.ok) return null;
  return await resp.json();
}

// ─── Main handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop();

  // ── /authorize — Start OAuth flow ──────────────────────────────────────
  if (path === "authorize" || req.method === "GET") {
    if (!FIGMA_CLIENT_ID) {
      return new Response(JSON.stringify({ error: "Figma OAuth not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get state param (JWT token for the user)
    const state = url.searchParams.get("state") || "";

    const authUrl = new URL("https://www.figma.com/oauth");
    authUrl.searchParams.set("client_id", FIGMA_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", getCallbackUrl());
    authUrl.searchParams.set("scope", "files:read");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("response_type", "code");

    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: authUrl.toString() },
    });
  }

  // ── /callback — Exchange code for tokens ───────────────────────────────
  if (path === "callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") || "";

    if (!code) {
      return new Response("Missing authorization code", { status: 400, headers: corsHeaders });
    }

    // Exchange code for tokens
    const tokenResp = await fetch("https://api.figma.com/v1/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: FIGMA_CLIENT_ID,
        client_secret: FIGMA_CLIENT_SECRET,
        redirect_uri: getCallbackUrl(),
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      return new Response(`Token exchange failed: ${err}`, { status: 400, headers: corsHeaders });
    }

    const tokens = await tokenResp.json();

    // Verify user from state (JWT)
    if (state) {
      const supabase = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: `Bearer ${state}` } } },
      );
      const { data: auth } = await supabase.auth.getUser();
      if (auth.user) {
        const serviceClient = createClient(
          SUPABASE_URL,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        // Store using service role but scoped to user via RPC
        // We call the RPC impersonating the user via their JWT
        await storeTokens(supabase, auth.user.id, tokens.access_token, tokens.refresh_token, tokens.expires_in || 7200);
      }
    }

    // Redirect back to the app
    return new Response(null, {
      status: 302,
      headers: { ...corsHeaders, Location: `${SITE_URL}/circles?figma=connected` },
    });
  }

  // ── POST /status — Check Figma connection ──────────────────────────────
  if (req.method === "POST") {
    try {
      const authHeader = req.headers.get("Authorization") || "";
      const supabase = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) {
        return new Response(JSON.stringify({ connected: false }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Check if user has figma key
      const serviceClient = createClient(
        SUPABASE_URL,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const apiKey = await serviceClient.rpc("get_user_api_key", {
        p_user_id: auth.user.id,
        p_provider: "figma",
        p_label: "oauth",
      });

      return new Response(
        JSON.stringify({ connected: !!apiKey.data }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ connected: false, error: err.message }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }

  return new Response("Not found", { status: 404, headers: corsHeaders });
});
