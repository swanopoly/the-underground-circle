// GitHub OAuth — Supabase Edge Function
//
// Handles GitHub OAuth flow for connecting user accounts:
//   ?action=authorize  — redirect user to GitHub OAuth
//   ?action=callback   — exchange code for token, store in DB
//   ?action=list_repos — list repos for a connected user
//
// Env: GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Deploy: npx supabase functions deploy github-oauth

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { listGitHubReposGraphql } from "../_shared/github-graphql.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const APP_URL = "https://app.chrisswanson.xyz";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getSupabase() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// Resolve the VERIFIED caller from the Authorization: Bearer <supabase jwt>
// header. The service-role reads below bypass RLS, so this is the ONLY access
// control — never trust a user_id from the query string. (Mirrors google-oauth.)
async function getAuthedUser(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
  if (!token) return null;
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user } } = await anon.auth.getUser();
  return user?.id || null;
}

// ─── Action: authorize ──────────────────────────────────────────────────────

async function handleAuthorize(req: Request, url: URL): Promise<Response> {
  // Bind the OAuth flow to the VERIFIED caller, not a client-supplied user_id —
  // otherwise an attacker could plant their GitHub token onto a victim's account
  // by naming the victim's uuid here (account-link CSRF).
  const userId = await getAuthedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthenticated" }, 401);
  const circleId = url.searchParams.get("circle_id");

  if (!circleId) {
    return jsonResponse({ error: "Missing circle_id" }, 400);
  }

  const clientId = Deno.env.get("GITHUB_CLIENT_ID");
  if (!clientId) {
    return jsonResponse({ error: "GITHUB_CLIENT_ID not configured" }, 500);
  }

  // Generate random state token for CSRF protection
  const stateBytes = new Uint8Array(24);
  crypto.getRandomValues(stateBytes);
  const state = Array.from(stateBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Store state in DB
  const supabase = getSupabase();
  const { error: stateErr } = await supabase
    .from("github_oauth_states")
    .insert({
      state,
      circle_id: circleId,
      user_id: userId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    });

  if (stateErr) {
    console.error("Failed to store OAuth state:", stateErr);
    return jsonResponse({ error: "Failed to initiate OAuth flow" }, 500);
  }

  // Build callback URL (this same edge function with action=callback)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const callbackUrl = `${supabaseUrl}/functions/v1/github-oauth?action=callback`;

  const githubAuthUrl =
    `https://github.com/login/oauth/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&scope=repo,admin:repo_hook` +
    `&state=${state}`;

  // Return the URL for the client to open
  return jsonResponse({ url: githubAuthUrl });
}

// ─── Action: callback ───────────────────────────────────────────────────────

async function handleCallback(url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing code or state parameter", { status: 400 });
  }

  const supabase = getSupabase();

  // Verify state exists and is not expired
  const { data: stateRecord, error: stateErr } = await supabase
    .from("github_oauth_states")
    .select("id, circle_id, user_id, expires_at")
    .eq("state", state)
    .single();

  if (stateErr || !stateRecord) {
    return new Response("Invalid or expired OAuth state", { status: 400 });
  }

  if (new Date(stateRecord.expires_at) < new Date()) {
    // Clean up expired state
    await supabase.from("github_oauth_states").delete().eq("id", stateRecord.id);
    return new Response("OAuth state expired. Please try again.", { status: 400 });
  }

  // Exchange code for access token
  const clientId = Deno.env.get("GITHUB_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GITHUB_CLIENT_SECRET")!;

  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error || !tokenData.access_token) {
    console.error("GitHub token exchange failed:", tokenData);
    return new Response(
      `GitHub OAuth error: ${tokenData.error_description || tokenData.error || "Unknown error"}`,
      { status: 400 },
    );
  }

  // Fetch GitHub user info
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!userRes.ok) {
    return new Response("Failed to fetch GitHub user info", { status: 500 });
  }

  const githubUser = await userRes.json();

  // Store token (upsert — one token per user)
  const { error: tokenErr } = await supabase
    .from("user_github_tokens")
    .upsert(
      {
        user_id: stateRecord.user_id,
        access_token: tokenData.access_token,
        github_username: githubUser.login,
        github_user_id: githubUser.id,
        scopes: tokenData.scope || "",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

  if (tokenErr) {
    console.error("Failed to store GitHub token:", tokenErr);
    return new Response("Failed to store token", { status: 500 });
  }

  // Delete used state
  await supabase.from("github_oauth_states").delete().eq("id", stateRecord.id);

  // Return HTML that redirects back to the app
  const redirectUrl = `${APP_URL}?github_connected=1&circle_id=${stateRecord.circle_id}`;
  const html = `<!DOCTYPE html>
<html>
<head><title>GitHub Connected</title></head>
<body style="background:#000;color:#fff;font-family:monospace;display:flex;justify-content:center;align-items:center;height:100vh;margin:0">
<div style="text-align:center">
<p style="font-size:24px">GitHub connected successfully!</p>
<p style="color:#888">Redirecting back to The Underground Circle...</p>
<script>window.location.href = ${JSON.stringify(redirectUrl)};</script>
<noscript><a href="${redirectUrl}" style="color:#6366f1">Click here to continue</a></noscript>
</div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

// ─── Action: list_repos ─────────────────────────────────────────────────────

async function handleListRepos(req: Request): Promise<Response> {
  // Use the VERIFIED caller — the service-role read below bypasses RLS, so a
  // query-param user_id would let anyone list another user's private repos.
  const userId = await getAuthedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthenticated" }, 401);

  const supabase = getSupabase();

  // Fetch token
  const { data: tokenRecord, error: tokenErr } = await supabase
    .from("user_github_tokens")
    .select("access_token, github_username")
    .eq("user_id", userId)
    .single();

  if (tokenErr || !tokenRecord) {
    return jsonResponse({ error: "No GitHub token found. Please connect GitHub first." }, 404);
  }

  // Prefer GitHub GraphQL for richer repo dashboard data in one shaped call.
  // Fall back to REST on schema/rate/auth edge cases so existing UI keeps
  // working while we roll GraphQL out incrementally.
  const graphqlRepos = await listGitHubReposGraphql(tokenRecord.access_token, { first: 100 });
  if (graphqlRepos.data) {
    return jsonResponse({
      github_username: graphqlRepos.data.github_username || tokenRecord.github_username,
      repos: graphqlRepos.data.repos,
      source: "github_graphql",
      graphql: {
        rateLimit: graphqlRepos.data.rateLimit,
        pageInfo: graphqlRepos.data.pageInfo,
      },
    });
  }

  console.warn("GitHub GraphQL repo listing failed, falling back to REST:", graphqlRepos.error);

  // Fetch repos from GitHub REST
  const reposRes = await fetch(
    "https://api.github.com/user/repos?per_page=100&sort=updated",
    {
      headers: {
        Authorization: `Bearer ${tokenRecord.access_token}`,
        Accept: "application/vnd.github.v3+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!reposRes.ok) {
    const body = await reposRes.json().catch(() => ({}));
    return jsonResponse(
      { error: (body as any).message || `GitHub API error: ${reposRes.status}` },
      reposRes.status,
    );
  }

  const repos = await reposRes.json();

  return jsonResponse({
    github_username: tokenRecord.github_username,
    repos,
    source: "github_rest_fallback",
    graphql_error: graphqlRepos.error,
  });
}

// ─── Action: status — check if user has connected GitHub ────────────────────

async function handleStatus(req: Request): Promise<Response> {
  const userId = await getAuthedUser(req);
  if (!userId) return jsonResponse({ error: "Unauthenticated" }, 401);

  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("user_github_tokens")
    .select("github_username, github_user_id, created_at, updated_at")
    .eq("user_id", userId)
    .single();

  if (error || !data) {
    return jsonResponse({ connected: false });
  }

  return jsonResponse({
    connected: true,
    github_username: data.github_username,
    github_user_id: data.github_user_id,
    connected_at: data.created_at,
  });
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Health check
  if (req.method === "GET" && !new URL(req.url).searchParams.has("action")) {
    return jsonResponse({ status: "ok", service: "github-oauth" });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    switch (action) {
      case "authorize":
        return await handleAuthorize(req, url);
      case "callback":
        return await handleCallback(url);
      case "list_repos":
        return await handleListRepos(req);
      case "status":
        return await handleStatus(req);
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err: any) {
    console.error("github-oauth error:", err);
    return jsonResponse({ error: err.message }, 500);
  }
});
