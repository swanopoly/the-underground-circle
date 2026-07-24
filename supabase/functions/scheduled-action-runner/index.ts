// scheduled-action-runner — Supabase Edge Function
//
// Picks `scheduled_actions` rows where status='pending' AND scheduled_for<=now(),
// claims them (status='running'), executes the per-kind adapter, and stores
// the result back on the row. Called by pg_cron once a minute (see
// supabase/migrations/20260414_scheduled_actions_cron.sql) and can also be
// invoked ad-hoc by the client to run a specific action "now".
//
// Design goals:
//   * One atomic claim step so two cron ticks don't fight over the same row
//   * Per-kind adapter functions — add a kind by adding an entry to EXECUTORS
//   * Retries with exponential backoff (15s × 2^n, capped at 30 min)
//   * Honors `requires_approval`: if true, creates an agent_approvals row and
//     parks the action until the approval is resolved
//   * Every execution produces structured `result` JSON so the Outbox can
//     render "posted to bsky.app/x/abc123" or "200 OK · {json preview}"
//
// Deploy: npx supabase functions deploy scheduled-action-runner
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (both injected by Supabase)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { errResponse, isServiceRoleRequest, jsonResponse } from "../_shared/edge.ts";
import { resolveGoogleWorkspaceAccessToken } from "../_shared/google-workspace-token.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ACTIONS_PER_RUN = 20;       // cap per tick to keep the fn bounded
const PER_ACTION_TIMEOUT_MS = 20_000; // any executor that stalls → failure

interface ScheduledAction {
  id: string;
  user_id: string;
  circle_id: string | null;
  kind: string;
  status: string;
  payload: Record<string, unknown>;
  scheduled_for: string;
  retry_count: number;
  max_retries: number;
  requires_approval: boolean;
  approval_id: string | null;
}

interface ExecResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: string;
  retryable?: boolean;   // false → don't bump retry count, mark failed
}

type SupabaseEdgeClient = any;
type Executor = (action: ScheduledAction, supabase: SupabaseEdgeClient) => Promise<ExecResult>;

// ─── Kind executors ─────────────────────────────────────────────────────────

/** Fire-and-check HTTP webhook. Succeeds on 2xx, fails otherwise. */
const execWebhook: Executor = async (action) => {
  const p = action.payload as { url?: string; method?: string; headers?: Record<string, string>; body?: unknown };
  if (!p.url) return { ok: false, error: 'payload.url required', retryable: false };
  try {
    const res = await fetch(p.url, {
      method: (p.method || 'POST').toUpperCase(),
      headers: { 'Content-Type': 'application/json', ...(p.headers || {}) },
      body: p.body === undefined ? undefined : (typeof p.body === 'string' ? p.body : JSON.stringify(p.body)),
    });
    const text = await res.text();
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 300)}`, retryable: res.status >= 500 };
    }
    return { ok: true, data: { status: res.status, body_preview: text.slice(0, 400) } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
  }
};

/** Bluesky post via AT Protocol. Creates a session with the user's stored
 * app password, posts the text, returns the post URI. */
const execBlueskyPost: Executor = async (action, supabase) => {
  const p = action.payload as { text?: string; reply_to_uri?: string };
  if (!p.text || !p.text.trim()) return { ok: false, error: 'payload.text required', retryable: false };

  const creds = await getUserProviderKey(supabase, action.user_id, 'bluesky');
  if (!creds) return { ok: false, error: 'No Bluesky app password stored for this user', retryable: false };
  const { identifier, password } = creds;

  try {
    // 1. createSession — returns accessJwt + did
    const sessionRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password }),
    });
    if (!sessionRes.ok) {
      const errText = await sessionRes.text();
      return { ok: false, error: `Bluesky auth: ${errText.slice(0, 200)}`, retryable: false };
    }
    const session = await sessionRes.json() as { accessJwt: string; did: string };

    // 2. createRecord — post the text
    const record: Record<string, unknown> = {
      $type: 'app.bsky.feed.post',
      text: p.text.slice(0, 300), // Bluesky's 300-char limit
      createdAt: new Date().toISOString(),
      langs: ['en'],
    };
    const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.accessJwt}`,
      },
      body: JSON.stringify({
        repo: session.did,
        collection: 'app.bsky.feed.post',
        record,
      }),
    });
    if (!postRes.ok) {
      const errText = await postRes.text();
      return { ok: false, error: `Bluesky post: ${errText.slice(0, 200)}`, retryable: postRes.status >= 500 };
    }
    const out = await postRes.json() as { uri: string; cid: string };
    // Convert at:// URI to a user-facing bsky.app URL
    const rkey = out.uri.split('/').pop();
    const handle = identifier.includes('.') ? identifier : `${identifier}.bsky.social`;
    const url = `https://bsky.app/profile/${handle}/post/${rkey}`;
    return { ok: true, data: { uri: out.uri, url, cid: out.cid } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
  }
};

/** Reminder — logs to agent_activity so the user sees it in the activity
 * feed. `notify_channels` extension point is declared but only the chat
 * channel is wired today. */
const execReminder: Executor = async (action, supabase) => {
  const p = action.payload as { title?: string; note?: string };
  if (!p.title) return { ok: false, error: 'payload.title required', retryable: false };
  const detail = p.note ? `${p.title} — ${p.note}` : p.title;
  if (action.circle_id) {
    const { error } = await supabase.from('agent_activity').insert({
      circle_id: action.circle_id,
      agent_name: 'Scheduler',
      action: 'reminder',
      detail,
    });
    if (error) return { ok: false, error: error.message, retryable: true };
  }
  return { ok: true, data: { delivered: detail } };
};

/** Gmail send via the Gmail API. Uses the user's stored OAuth token. */
const execGmailSend: Executor = async (action, supabase) => {
  const p = action.payload as { to?: string[]; subject?: string; body_markdown?: string; cc?: string[]; bcc?: string[] };
  if (!p.to?.length || !p.subject || !p.body_markdown) {
    return { ok: false, error: 'payload.{to,subject,body_markdown} required', retryable: false };
  }
  const token = await getUserOauthToken(supabase, action.user_id, 'gmail');
  if (!token) return { ok: false, error: 'No Gmail token stored', retryable: false };

  const mime = buildMime({
    to: p.to, subject: p.subject, body: p.body_markdown, cc: p.cc, bcc: p.bcc,
  });
  const encoded = base64UrlEncode(mime);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({ raw: encoded }),
  });
  if (!res.ok) {
    const errText = await res.text();
    return { ok: false, error: `Gmail: ${errText.slice(0, 200)}`, retryable: res.status >= 500 || res.status === 429 };
  }
  const out = await res.json() as { id: string; threadId: string };
  return { ok: true, data: { message_id: out.id, thread_id: out.threadId } };
};

/** WordPress post via REST API using application-password Basic auth.
 * Site + creds can come from the payload (one-off) or stored under
 * provider='wordpress' as JSON `{site, username, app_password}`. */
const execWpPost: Executor = async (action, supabase) => {
  const p = action.payload as {
    title?: string; content?: string;
    status?: 'draft' | 'publish' | 'private' | 'pending';
    excerpt?: string; categories?: number[]; tags?: number[];
    // Per-post overrides; fall back to stored creds if absent
    site?: string; username?: string; app_password?: string;
  };
  if (!p.title || !p.content) {
    return { ok: false, error: 'payload.{title,content} required', retryable: false };
  }
  const stored = await getUserWpCreds(supabase, action.user_id);
  const site = (p.site || stored?.site || '').replace(/\/+$/, '');
  const username = p.username || stored?.username;
  const app_password = p.app_password || stored?.app_password;
  if (!site || !username || !app_password) {
    return {
      ok: false,
      error: 'No WordPress credentials. Pass payload.{site,username,app_password} or connect WP under Integrations.',
      retryable: false,
    };
  }
  const basic = btoa(`${username}:${app_password}`);
  try {
    const res = await fetch(`${site}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${basic}` },
      body: JSON.stringify({
        title: p.title,
        content: p.content,
        status: p.status || 'draft',
        excerpt: p.excerpt,
        categories: p.categories,
        tags: p.tags,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `WordPress: ${txt.slice(0, 200)}`, retryable: res.status >= 500 || res.status === 429 };
    }
    const out = await res.json() as { id: number; link: string; status: string };
    return { ok: true, data: { post_id: out.id, url: out.link, status: out.status } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
  }
};

/** X/Twitter post via API v2 with the user's OAuth 2.0 bearer token. */
const execTweet: Executor = async (action, supabase) => {
  const p = action.payload as { text?: string; reply_to?: string };
  if (!p.text?.trim()) return { ok: false, error: 'payload.text required', retryable: false };
  const token =
    (await getUserOauthToken(supabase, action.user_id, 'twitter')) ||
    (await getUserOauthToken(supabase, action.user_id, 'x'));
  if (!token) {
    return { ok: false, error: 'No X/Twitter token stored — connect under Integrations → X.', retryable: false };
  }
  try {
    const body: Record<string, unknown> = { text: p.text.slice(0, 280) };
    if (p.reply_to) body.reply = { in_reply_to_tweet_id: p.reply_to };
    const res = await fetch('https://api.twitter.com/2/tweets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, error: `X: ${txt.slice(0, 200)}`, retryable: res.status >= 500 || res.status === 429 };
    }
    const out = await res.json() as { data: { id: string; text: string } };
    return { ok: true, data: { tweet_id: out.data.id, url: `https://x.com/i/status/${out.data.id}` } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
  }
};

/** LinkedIn post via the ugcPosts API. Needs the member URN which we look
 * up from /v2/userinfo (OIDC scope provides `sub` = numeric member id). */
const execLinkedInPost: Executor = async (action, supabase) => {
  const p = action.payload as { text?: string; visibility?: 'PUBLIC' | 'CONNECTIONS' };
  if (!p.text?.trim()) return { ok: false, error: 'payload.text required', retryable: false };
  const token = await getUserOauthToken(supabase, action.user_id, 'linkedin');
  if (!token) {
    return { ok: false, error: 'No LinkedIn token stored — connect under Integrations → LinkedIn.', retryable: false };
  }
  try {
    // 1. Resolve the member URN
    const meRes = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!meRes.ok) {
      const txt = await meRes.text();
      return { ok: false, error: `LinkedIn userinfo: ${txt.slice(0, 160)}`, retryable: meRes.status >= 500 };
    }
    const me = await meRes.json() as { sub: string };
    const authorUrn = `urn:li:person:${me.sub}`;

    // 2. Post via ugcPosts
    const body = {
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.ShareContent': {
          shareCommentary: { text: p.text.slice(0, 3000) },
          shareMediaCategory: 'NONE',
        },
      },
      visibility: {
        'com.linkedin.ugc.MemberNetworkVisibility':
          p.visibility === 'CONNECTIONS' ? 'CONNECTIONS' : 'PUBLIC',
      },
    };
    const postRes = await fetch('https://api.linkedin.com/v2/ugcPosts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Restli-Protocol-Version': '2.0.0',
      },
      body: JSON.stringify(body),
    });
    if (!postRes.ok) {
      const txt = await postRes.text();
      return { ok: false, error: `LinkedIn: ${txt.slice(0, 200)}`, retryable: postRes.status >= 500 || postRes.status === 429 };
    }
    const out = await postRes.json() as { id: string };
    return {
      ok: true,
      data: { post_id: out.id, url: `https://www.linkedin.com/feed/update/${encodeURIComponent(out.id)}` },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
  }
};

/** Gmail draft via the drafts endpoint. Same auth + MIME as gmail_send. */
const execGmailDraft: Executor = async (action, supabase) => {
  const p = action.payload as { to?: string[]; subject?: string; body_markdown?: string; cc?: string[]; bcc?: string[] };
  if (!p.to?.length || !p.subject || !p.body_markdown) {
    return { ok: false, error: 'payload.{to,subject,body_markdown} required', retryable: false };
  }
  const token = await getUserOauthToken(supabase, action.user_id, 'gmail');
  if (!token) return { ok: false, error: 'No Gmail token stored', retryable: false };

  const mime = buildMime({
    to: p.to, subject: p.subject, body: p.body_markdown, cc: p.cc, bcc: p.bcc,
  });
  const encoded = base64UrlEncode(mime);
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message: { raw: encoded } }),
  });
  if (!res.ok) {
    const txt = await res.text();
    return { ok: false, error: `Gmail draft: ${txt.slice(0, 200)}`, retryable: res.status >= 500 || res.status === 429 };
  }
  const out = await res.json() as { id: string; message?: { id?: string; threadId?: string } };
  return {
    ok: true,
    data: { draft_id: out.id, message_id: out.message?.id, thread_id: out.message?.threadId },
  };
};

/** Outlook / Microsoft 365 email send via the Graph /me/sendMail endpoint.
 * Returns 202 with no body on success. */
const execOutlookSend: Executor = async (action, supabase) => {
  const p = action.payload as { to?: string[]; subject?: string; body_markdown?: string; cc?: string[]; bcc?: string[] };
  if (!p.to?.length || !p.subject || !p.body_markdown) {
    return { ok: false, error: 'payload.{to,subject,body_markdown} required', retryable: false };
  }
  const token =
    (await getUserOauthToken(supabase, action.user_id, 'outlook')) ||
    (await getUserOauthToken(supabase, action.user_id, 'microsoft'));
  if (!token) {
    return { ok: false, error: 'No Outlook/Microsoft token stored — connect under Integrations → Outlook.', retryable: false };
  }
  const message = {
    subject: p.subject,
    body: { contentType: 'Text', content: p.body_markdown },
    toRecipients: p.to.map(a => ({ emailAddress: { address: a } })),
    ccRecipients: (p.cc || []).map(a => ({ emailAddress: { address: a } })),
    bccRecipients: (p.bcc || []).map(a => ({ emailAddress: { address: a } })),
  };
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, saveToSentItems: true }),
    });
    // 202 Accepted with empty body = success
    if (res.status === 202 || res.ok) {
      return { ok: true, data: { delivered_to: p.to.join(', '), subject: p.subject } };
    }
    const txt = await res.text();
    return { ok: false, error: `Outlook: ${txt.slice(0, 200)}`, retryable: res.status >= 500 || res.status === 429 };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
  }
};

/** Slack chat.postMessage. Works with bot (xoxb) or user (xoxp) tokens. */
const execSlackPost: Executor = async (action, supabase) => {
  const p = action.payload as { channel?: string; text?: string; thread_ts?: string; blocks?: unknown[] };
  if (!p.channel || !p.text) return { ok: false, error: 'payload.{channel,text} required', retryable: false };
  const token = await getUserOauthToken(supabase, action.user_id, 'slack');
  if (!token) return { ok: false, error: 'No Slack token stored — connect under Integrations → Slack.', retryable: false };
  try {
    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: p.channel,
        text: p.text,
        thread_ts: p.thread_ts,
        blocks: p.blocks,
        unfurl_links: false,
      }),
    });
    const body = await res.json() as { ok: boolean; ts?: string; channel?: string; error?: string };
    if (!res.ok || !body.ok) {
      // Slack's own error codes (invalid_auth, not_in_channel, etc.) are permanent
      const slackErr = body.error || `HTTP ${res.status}`;
      const retryable = res.status >= 500 || slackErr === 'ratelimited';
      return { ok: false, error: `Slack: ${slackErr}`, retryable };
    }
    const permalink = body.channel && body.ts
      ? `slack://channel?id=${body.channel}&message=${body.ts}`
      : undefined;
    return { ok: true, data: { ts: body.ts, channel: body.channel, permalink } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable: true };
  }
};

const execNotImplemented: Executor = async (action) => ({
  ok: false,
  error: `No executor implemented for scheduled action kind: ${action.kind}`,
  retryable: false,
});

const EXECUTORS: Record<string, Executor> = {
  webhook: execWebhook,
  bluesky_post: execBlueskyPost,
  reminder: execReminder,
  gmail_send: execGmailSend,
  gmail_draft: execGmailDraft,
  wp_post: execWpPost,
  tweet: execTweet,
  linkedin_post: execLinkedInPost,
  outlook_send: execOutlookSend,
  slack_post: execSlackPost,
};

// ─── Credential helpers ─────────────────────────────────────────────────────

async function getUserProviderKey(
  supabase: SupabaseEdgeClient,
  userId: string,
  provider: string,
): Promise<{ identifier: string; password: string } | null> {
  // Try the encrypted user_api_keys RPC first
  try {
    const { data } = await supabase.rpc('get_user_api_key', {
      p_user_id: userId,
      p_provider: provider,
      p_label: 'default',
    });
    if (data && data.length > 0 && data[0].api_key) {
      // For Bluesky we stored identifier+password as JSON in api_key, or
      // used endpoint as identifier. Support both shapes.
      const raw = data[0].api_key as string;
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw);
        return { identifier: parsed.identifier, password: parsed.password };
      }
      if (data[0].endpoint) {
        return { identifier: data[0].endpoint, password: raw };
      }
    }
  } catch {}
  return null;
}

/** WordPress credentials are stored under provider='wordpress' in
 * user_api_keys as JSON `{site, username, app_password}`. Falls back to
 * null if the stored shape isn't recognised so the payload override path
 * can still succeed. */
async function getUserWpCreds(
  supabase: SupabaseEdgeClient,
  userId: string,
): Promise<{ site: string; username: string; app_password: string } | null> {
  try {
    const { data } = await supabase.rpc('get_user_api_key', {
      p_user_id: userId,
      p_provider: 'wordpress',
      p_label: 'default',
    });
    if (!data || data.length === 0 || !data[0]?.api_key) return null;
    const raw = data[0].api_key as string;
    if (raw.startsWith('{')) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed.site && parsed.username && parsed.app_password) {
          return { site: parsed.site, username: parsed.username, app_password: parsed.app_password };
        }
      } catch { /* fall through */ }
    }
    // Legacy shape: endpoint=site, api_key=password — still needs a username
    // which isn't recoverable from this shape. Treat as incomplete.
    return null;
  } catch {
    return null;
  }
}

async function getUserOauthToken(
  supabase: SupabaseEdgeClient,
  userId: string,
  provider: string,
): Promise<string | null> {
  try {
    // Gmail prefers the refreshing Workspace store (user_google_credentials),
    // which holds the refresh_token and silently renews the ~1h access_token;
    // the legacy `integrations` token below stays only as a backward-compat
    // fallback for connections that predate that store.
    if (provider === 'gmail') {
      const r = await resolveGoogleWorkspaceAccessToken(supabase, userId);
      if (r.ok) return r.accessToken;
      /* fall through to legacy integrations token for backward compat */
    }
    const { data } = await supabase
      .from('integrations')
      .select('access_token, refresh_token, token_expires_at')
      .eq('user_id', userId)
      .eq('provider', provider)
      .eq('is_active', true)
      .maybeSingle();
    if (!data?.access_token) return null;
    // TODO: refresh if expired — OAuth refresh flow per provider
    return data.access_token as string;
  } catch {
    return null;
  }
}

// ─── MIME + base64url helpers for Gmail ─────────────────────────────────────

function buildMime(opts: { to: string[]; subject: string; body: string; cc?: string[]; bcc?: string[] }): string {
  const lines = [
    `To: ${opts.to.join(', ')}`,
    opts.cc?.length ? `Cc: ${opts.cc.join(', ')}` : '',
    opts.bcc?.length ? `Bcc: ${opts.bcc.join(', ')}` : '',
    `Subject: ${opts.subject}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    opts.body,
  ].filter(Boolean);
  return lines.join('\r\n');
}

function base64UrlEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ─── Core loop ──────────────────────────────────────────────────────────────

async function runOnce(supabase: SupabaseEdgeClient): Promise<{ claimed: number; succeeded: number; failed: number; skipped: number }> {
  // 1. Fetch IDs of due actions. We do a lookup + individual claim rather
  //    than a SKIP-LOCKED CTE because the Supabase SDK doesn't expose that
  //    syntax ergonomically. The race window is small and each claim is
  //    atomic via the eq('status','pending') guard.
  const { data: dueActions, error: fetchErr } = await supabase
    .from('scheduled_actions')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(MAX_ACTIONS_PER_RUN);

  if (fetchErr) {
    console.error('[runner] fetch failed:', fetchErr);
    return { claimed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }
  if (!dueActions || dueActions.length === 0) {
    return { claimed: 0, succeeded: 0, failed: 0, skipped: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  let skipped = 0;
  let claimed = 0;

  for (const raw of dueActions) {
    const action = raw as ScheduledAction;

    // 1a. HITL gate — park actions that need approval until their
    // agent_approvals row flips to 'approved'. We create the approval row
    // on first sight if one doesn't exist.
    if (action.requires_approval) {
      const gate = await handleApprovalGate(supabase, action);
      if (gate === 'waiting') { skipped++; continue; }
      if (gate === 'rejected') {
        await markFailed(supabase, action, 'Approval rejected', false);
        failed++;
        continue;
      }
      // 'approved' falls through to execution
    }

    // 1b. Atomic claim — only proceeds if still pending. If another runner
    // got here first, eq('status','pending') filters us out and we skip.
    const { data: claimRows, error: claimErr } = await supabase
      .from('scheduled_actions')
      .update({ status: 'running', started_at: new Date().toISOString() })
      .eq('id', action.id)
      .eq('status', 'pending')
      .select('id');
    if (claimErr || !claimRows || claimRows.length === 0) { skipped++; continue; }
    claimed++;

    // 2. Execute with a per-action timeout so one slow provider can't
    // starve the rest of the tick's actions.
    const executor = EXECUTORS[action.kind] || execNotImplemented;
    const result = await runWithTimeout(() => executor(action, supabase), PER_ACTION_TIMEOUT_MS);

    if (result.ok) {
      await markSucceeded(supabase, action, result.data || {});
      succeeded++;
    } else {
      const shouldRetry = (result.retryable !== false) && (action.retry_count + 1 <= action.max_retries);
      if (shouldRetry) {
        await scheduleRetry(supabase, action, result.error || 'unknown');
      } else {
        await markFailed(supabase, action, result.error || 'unknown', false);
      }
      failed++;
    }
  }

  return { claimed, succeeded, failed, skipped };
}

async function handleApprovalGate(
  supabase: SupabaseEdgeClient,
  action: ScheduledAction,
): Promise<'approved' | 'waiting' | 'rejected'> {
  if (action.approval_id) {
    const { data } = await supabase
      .from('agent_approvals')
      .select('status')
      .eq('id', action.approval_id)
      .maybeSingle();
    if (!data) return 'waiting';
    if (data.status === 'approved') return 'approved';
    if (data.status === 'rejected') return 'rejected';
    return 'waiting';
  }
  // Create an approval row on first sight and park
  const { data: approval, error } = await supabase
    .from('agent_approvals')
    .insert({
      circle_id: action.circle_id,
      agent_name: 'Scheduler',
      session_key: null,
      action_type: action.kind,
      action_detail: JSON.stringify(action.payload).slice(0, 500),
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !approval) return 'waiting';
  await supabase.from('scheduled_actions').update({ approval_id: approval.id }).eq('id', action.id);
  return 'waiting';
}

async function markSucceeded(supabase: SupabaseEdgeClient, action: ScheduledAction, result: Record<string, unknown>) {
  await supabase.from('scheduled_actions').update({
    status: 'succeeded',
    completed_at: new Date().toISOString(),
    result,
    error: null,
  }).eq('id', action.id);
}

async function markFailed(supabase: SupabaseEdgeClient, action: ScheduledAction, error: string, retryable: boolean) {
  await supabase.from('scheduled_actions').update({
    status: 'failed',
    completed_at: new Date().toISOString(),
    error,
    retry_count: retryable ? action.retry_count + 1 : action.retry_count,
  }).eq('id', action.id);
}

async function scheduleRetry(supabase: SupabaseEdgeClient, action: ScheduledAction, error: string) {
  const nextAttempt = action.retry_count + 1;
  // Exponential backoff: 15s × 2^n, capped at 30 min
  const delayMs = Math.min(15_000 * Math.pow(2, nextAttempt - 1), 30 * 60_000);
  const scheduledFor = new Date(Date.now() + delayMs).toISOString();
  await supabase.from('scheduled_actions').update({
    status: 'pending',
    scheduled_for: scheduledFor,
    error,
    retry_count: nextAttempt,
    started_at: null,
  }).eq('id', action.id);
}

function runWithTimeout<T>(fn: () => Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    fn().then(v => { clearTimeout(t); resolve(v); }).catch(err => { clearTimeout(t); reject(err); });
  });
}

// ─── Request handler ────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (!isServiceRoleRequest(req)) {
    return errResponse(401, "unauthorized", "scheduled-action-runner requires service-role authorization");
  }

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) {
    return jsonResponse({ error: 'runner env not configured' }, 500);
  }
  const supabase = createClient(url, serviceKey);

  try {
    const summary = await runOnce(supabase);
    return jsonResponse({ ok: true, ...summary, at: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
