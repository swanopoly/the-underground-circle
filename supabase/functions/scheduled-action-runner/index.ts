// scheduled-action-runner — Supabase Edge Function
//
// Picks `scheduled_actions` rows where status='pending' AND scheduled_for<=now(),
// claims them (status='running'), executes the per-kind adapter, and stores
// the result back on the row. Called by pg_cron once a minute (see
// supabase/migrations/20260414_scheduled_actions_cron.sql) and can also be
// invoked ad-hoc by the client to run a specific action "now".
//
// Safety contract:
//   * Every kind is a durable/external mutation and always needs a fresh,
//     exact, single-use approval (legacy requires_approval=false is ignored).
//   * One runner atomically claims an occurrence before consuming approval.
//   * dispatched_at is stamped immediately before the only executor attempt.
//   * A failure/timeout after that boundary is outcome_unknown and is sealed.
//   * Results and errors persist only fixed status codes and opaque receipt IDs.
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
const PER_ACTION_TIMEOUT_MS = 20_000;
const APPROVAL_TTL_SECONDS = 600;
const APPROVAL_SCHEMA_VERSION = 2;

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
  claim_token: string | null;
  claimed_at: string | null;
  dispatched_at: string | null;
  outcome_unknown_at: string | null;
  recurrence?: string | null;
  recurrence_label?: string | null;
  parent_action_id?: string | null;
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

interface ApprovalBindingPayload {
  approvalSchemaVersion: number;
  actionId: string;
  userId: string;
  circleId: string | null;
  actionKind: string;
  payloadFingerprint: string;
  occurrenceFingerprint: string;
}

interface ApprovalBinding {
  sessionKey: string;
  actionType: string;
  description: string;
  payload: ApprovalBindingPayload;
}

interface ApprovalRow {
  id: string;
  circle_id: string | null;
  session_key: string;
  action_type: string;
  description: string;
  payload: Record<string, unknown>;
  status: string;
  requested_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  timeout_seconds: number;
  applied_at: string | null;
}

type ApprovalGate =
  | { state: 'waiting' }
  | { state: 'rejected'; code: 'approval_rejected' | 'approval_expired' }
  | { state: 'invalid'; code: 'approval_scope_mismatch' | 'approval_consumed' }
  | { state: 'approved'; approval: ApprovalRow; binding: ApprovalBinding; expiresAt: number };

interface RunSummary {
  claimed: number;
  succeeded: number;
  failed: number;
  outcomeUnknown: number;
  skipped: number;
}

async function runOnce(supabase: SupabaseEdgeClient): Promise<RunSummary> {
  // Lookup plus a guarded pending -> running write is an atomic queue claim.
  // Every later state write is also bound to the winner's opaque claim token.
  const { data: dueActions, error: fetchErr } = await supabase
    .from('scheduled_actions')
    .select('*')
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(MAX_ACTIONS_PER_RUN);

  if (fetchErr) {
    console.error('[scheduled-action-runner] due_action_lookup_failed');
    return { claimed: 0, succeeded: 0, failed: 0, outcomeUnknown: 0, skipped: 0 };
  }
  if (!dueActions || dueActions.length === 0) {
    return { claimed: 0, succeeded: 0, failed: 0, outcomeUnknown: 0, skipped: 0 };
  }

  let succeeded = 0;
  let failed = 0;
  let outcomeUnknown = 0;
  let skipped = 0;
  let claimed = 0;

  for (const raw of dueActions) {
    const action = raw as ScheduledAction;

    const validationCode = validateBeforeDispatch(action);
    if (validationCode) {
      await markPendingAsPredispatchFailed(supabase, action.id, validationCode);
      failed++;
      continue;
    }

    // All current kinds mutate durable/external state. This gate is
    // unconditional; legacy rows with requires_approval=false cannot bypass it.
    const gate = await handleApprovalGate(supabase, action);
    if (gate.state === 'waiting') {
      skipped++;
      continue;
    }
    if (gate.state === 'rejected' || gate.state === 'invalid') {
      await markPendingAsPredispatchFailed(supabase, action.id, gate.code);
      failed++;
      continue;
    }

    const claimToken = crypto.randomUUID();
    const claimTime = new Date().toISOString();
    const { data: claimedAction, error: claimErr } = await supabase
      .from('scheduled_actions')
      .update({
        status: 'running',
        started_at: claimTime,
        claimed_at: claimTime,
        claim_token: claimToken,
        // Normalize legacy caller policy while the exact row is claimed.
        requires_approval: true,
        max_retries: 0,
      })
      .eq('id', action.id)
      .eq('status', 'pending')
      .eq('approval_id', gate.approval.id)
      .is('dispatched_at', null)
      .select('*')
      .maybeSingle();
    if (claimErr || !claimedAction) {
      skipped++;
      continue;
    }
    claimed++;

    const sealedAction = claimedAction as ScheduledAction;
    const claimedBinding = await buildApprovalBinding(sealedAction);
    if (
      !approvalMatchesBinding(gate.approval, claimedBinding)
      || gate.expiresAt <= Date.now()
    ) {
      await markClaimedAsPredispatchFailed(
        supabase,
        sealedAction,
        claimToken,
        'approval_scope_mismatch',
      );
      failed++;
      continue;
    }

    const consumed = await consumeApproval(
      supabase,
      sealedAction,
      gate.approval,
      claimedBinding,
      gate.expiresAt,
    );
    if (!consumed) {
      await markClaimedAsPredispatchFailed(
        supabase,
        sealedAction,
        claimToken,
        'approval_not_consumed',
      );
      failed++;
      continue;
    }

    // This is the irreversible boundary. There is exactly one executor call
    // after it and no code path ever moves this row back to pending.
    const dispatchTime = new Date().toISOString();
    const { data: dispatched, error: dispatchErr } = await supabase
      .from('scheduled_actions')
      .update({ dispatched_at: dispatchTime })
      .eq('id', sealedAction.id)
      .eq('status', 'running')
      .eq('claim_token', claimToken)
      .eq('approval_id', gate.approval.id)
      .is('dispatched_at', null)
      .select('id')
      .maybeSingle();
    if (dispatchErr || !dispatched) {
      await markClaimedAsPredispatchFailed(
        supabase,
        sealedAction,
        claimToken,
        'dispatch_boundary_not_persisted',
      );
      failed++;
      continue;
    }

    const executor = EXECUTORS[sealedAction.kind] || execNotImplemented;
    const result = await runWithTimeout(
      () => executor(sealedAction, supabase),
      PER_ACTION_TIMEOUT_MS,
    );

    if (result.ok) {
      const finalized = await markSucceeded(
        supabase,
        sealedAction,
        claimToken,
        sanitizeExecutionReceipt(result.data),
      );
      if (!finalized) {
        // The row remains running + dispatched. It is deliberately ineligible
        // for queue lookup and manual retry.
        outcomeUnknown++;
        continue;
      }
      succeeded++;
      await createNextOccurrence(supabase, sealedAction);
    } else {
      await markOutcomeUnknown(supabase, sealedAction, claimToken);
      outcomeUnknown++;
    }
  }

  return { claimed, succeeded, failed, outcomeUnknown, skipped };
}

async function handleApprovalGate(
  supabase: SupabaseEdgeClient,
  action: ScheduledAction,
): Promise<ApprovalGate> {
  const binding = await buildApprovalBinding(action);
  if (!action.approval_id) {
    await createAndLinkApproval(supabase, action, binding);
    return { state: 'waiting' };
  }

  const { data, error } = await supabase
    .from('agent_approvals')
    .select(
      'id, circle_id, session_key, action_type, description, payload, status, '
        + 'requested_at, resolved_at, resolved_by, timeout_seconds, applied_at',
    )
    .eq('id', action.approval_id)
    .maybeSingle();
  if (error || !data) return { state: 'waiting' };

  const approval = data as ApprovalRow;
  if (!approvalMatchesBinding(approval, binding)) {
    return { state: 'invalid', code: 'approval_scope_mismatch' };
  }
  if (approval.applied_at) {
    return { state: 'invalid', code: 'approval_consumed' };
  }
  if (approval.status === 'rejected') {
    return { state: 'rejected', code: 'approval_rejected' };
  }

  const expiresAt = approvalExpiresAt(approval);
  if (expiresAt === null || expiresAt <= Date.now()) {
    await expireApproval(supabase, approval.id);
    return { state: 'rejected', code: 'approval_expired' };
  }
  if (approval.status === 'pending') return { state: 'waiting' };
  if (
    approval.status !== 'approved'
    || approval.resolved_by !== action.user_id
    || !approval.resolved_at
  ) {
    return { state: 'invalid', code: 'approval_scope_mismatch' };
  }

  const requestedAt = Date.parse(approval.requested_at);
  const resolvedAt = Date.parse(approval.resolved_at);
  if (
    !Number.isFinite(requestedAt)
    || !Number.isFinite(resolvedAt)
    || resolvedAt < requestedAt
    || resolvedAt > Date.now() + 5_000
    || resolvedAt >= expiresAt
  ) {
    return { state: 'invalid', code: 'approval_scope_mismatch' };
  }
  return { state: 'approved', approval, binding, expiresAt };
}

async function createAndLinkApproval(
  supabase: SupabaseEdgeClient,
  action: ScheduledAction,
  binding: ApprovalBinding,
): Promise<void> {
  let approvalId: string | null = null;
  const { data: existing } = await supabase
    .from('agent_approvals')
    .select('id')
    .eq('session_key', binding.sessionKey)
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    approvalId = String(existing.id);
  } else {
    const { data: inserted } = await supabase
      .from('agent_approvals')
      .insert({
        circle_id: action.circle_id,
        session_key: binding.sessionKey,
        agent_name: 'Scheduler',
        action_type: binding.actionType,
        description: binding.description,
        payload: binding.payload,
        status: 'pending',
        timeout_seconds: APPROVAL_TTL_SECONDS,
      })
      .select('id')
      .maybeSingle();
    approvalId = inserted?.id ? String(inserted.id) : null;

    // A concurrent runner can win the partial unique index.
    if (!approvalId) {
      const { data: raced } = await supabase
        .from('agent_approvals')
        .select('id')
        .eq('session_key', binding.sessionKey)
        .limit(1)
        .maybeSingle();
      approvalId = raced?.id ? String(raced.id) : null;
    }
  }

  if (!approvalId) return;
  await supabase
    .from('scheduled_actions')
    .update({
      approval_id: approvalId,
      requires_approval: true,
      max_retries: 0,
    })
    .eq('id', action.id)
    .eq('status', 'pending')
    .is('approval_id', null);
}

async function consumeApproval(
  supabase: SupabaseEdgeClient,
  action: ScheduledAction,
  approval: ApprovalRow,
  binding: ApprovalBinding,
  expiresAt: number,
): Promise<boolean> {
  if (Date.now() >= expiresAt) return false;
  let update = supabase
    .from('agent_approvals')
    .update({ applied_at: new Date().toISOString() })
    .eq('id', approval.id)
    .eq('session_key', binding.sessionKey)
    .eq('action_type', binding.actionType)
    .eq('description', binding.description)
    .eq('status', 'approved')
    .eq('resolved_by', action.user_id)
    .eq('requested_at', approval.requested_at)
    .eq('resolved_at', approval.resolved_at)
    .eq('timeout_seconds', APPROVAL_TTL_SECONDS)
    .is('applied_at', null);
  update = action.circle_id === null
    ? update.is('circle_id', null)
    : update.eq('circle_id', action.circle_id);
  const { data, error } = await update.select(
    'id, circle_id, session_key, action_type, description, payload, status, '
      + 'requested_at, resolved_at, resolved_by, timeout_seconds, applied_at',
  ).maybeSingle();
  if (error || !data || Date.now() >= expiresAt) return false;
  return approvalMatchesBinding(data as ApprovalRow, binding);
}

async function expireApproval(supabase: SupabaseEdgeClient, approvalId: string): Promise<void> {
  await supabase
    .from('agent_approvals')
    .update({ status: 'expired', resolved_at: new Date().toISOString() })
    .eq('id', approvalId)
    .in('status', ['pending', 'approved'])
    .is('applied_at', null);
}

async function markSucceeded(
  supabase: SupabaseEdgeClient,
  action: ScheduledAction,
  claimToken: string,
  result: Record<string, unknown>,
): Promise<boolean> {
  const { data, error } = await supabase.from('scheduled_actions').update({
    status: 'succeeded',
    completed_at: new Date().toISOString(),
    result,
    error: null,
  })
    .eq('id', action.id)
    .eq('status', 'running')
    .eq('claim_token', claimToken)
    .not('dispatched_at', 'is', null)
    .select('id')
    .maybeSingle();
  return !error && Boolean(data?.id);
}

async function markPendingAsPredispatchFailed(
  supabase: SupabaseEdgeClient,
  actionId: string,
  code: string,
): Promise<void> {
  await supabase.from('scheduled_actions').update({
    status: 'failed',
    completed_at: new Date().toISOString(),
    result: { status: 'not_dispatched' },
    error: boundedFailureCode(code),
    max_retries: 0,
  })
    .eq('id', actionId)
    .eq('status', 'pending')
    .is('dispatched_at', null);
}

async function markClaimedAsPredispatchFailed(
  supabase: SupabaseEdgeClient,
  action: ScheduledAction,
  claimToken: string,
  code: string,
): Promise<void> {
  await supabase.from('scheduled_actions').update({
    status: 'failed',
    completed_at: new Date().toISOString(),
    result: { status: 'not_dispatched' },
    error: boundedFailureCode(code),
    max_retries: 0,
  })
    .eq('id', action.id)
    .eq('status', 'running')
    .eq('claim_token', claimToken)
    .is('dispatched_at', null);
}

async function markOutcomeUnknown(
  supabase: SupabaseEdgeClient,
  action: ScheduledAction,
  claimToken: string,
): Promise<void> {
  const at = new Date().toISOString();
  await supabase.from('scheduled_actions').update({
    status: 'outcome_unknown',
    completed_at: at,
    outcome_unknown_at: at,
    result: { status: 'outcome_unknown', replay_allowed: false },
    error: 'dispatch_outcome_unknown',
    max_retries: 0,
  })
    .eq('id', action.id)
    .eq('status', 'running')
    .eq('claim_token', claimToken)
    .not('dispatched_at', 'is', null);
}

function runWithTimeout(fn: () => Promise<ExecResult>, ms: number): Promise<ExecResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ ok: false, error: 'dispatch_timeout', retryable: false }),
      ms,
    );
    try {
      fn()
        .then(finish)
        .catch(() => finish({ ok: false, error: 'dispatch_error', retryable: false }));
    } catch {
      finish({ ok: false, error: 'dispatch_error', retryable: false });
    }
  });
}

function validateBeforeDispatch(action: ScheduledAction): string | null {
  const p = action.payload || {};
  const nonEmpty = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  const stringList = (value: unknown) =>
    Array.isArray(value) && value.length > 0 && value.every(nonEmpty);
  if (!Object.prototype.hasOwnProperty.call(EXECUTORS, action.kind)) return 'unsupported_kind';
  switch (action.kind) {
    case 'webhook':
      return nonEmpty(p.url) ? null : 'invalid_payload';
    case 'bluesky_post':
    case 'tweet':
    case 'linkedin_post':
      return nonEmpty(p.text) ? null : 'invalid_payload';
    case 'reminder':
      return nonEmpty(p.title) ? null : 'invalid_payload';
    case 'gmail_send':
    case 'gmail_draft':
    case 'outlook_send':
      return stringList(p.to) && nonEmpty(p.subject) && nonEmpty(p.body_markdown)
        ? null
        : 'invalid_payload';
    case 'wp_post':
      return nonEmpty(p.title) && nonEmpty(p.content) ? null : 'invalid_payload';
    case 'slack_post':
      return nonEmpty(p.channel) && nonEmpty(p.text) ? null : 'invalid_payload';
    default:
      return 'unsupported_kind';
  }
}

const SAFE_FAILURE_CODES = new Set([
  'unsupported_kind',
  'invalid_payload',
  'approval_rejected',
  'approval_expired',
  'approval_scope_mismatch',
  'approval_consumed',
  'approval_not_consumed',
  'dispatch_boundary_not_persisted',
]);

function boundedFailureCode(value: string): string {
  return SAFE_FAILURE_CODES.has(value) ? value : 'predispatch_guard_failed';
}

function sanitizeExecutionReceipt(data?: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { status: 'completed' };
  if (!data || typeof data !== 'object') return result;

  const providerStatus = data.status;
  if (
    typeof providerStatus === 'number'
    && Number.isInteger(providerStatus)
    && providerStatus >= 100
    && providerStatus <= 599
  ) {
    result.provider_status = providerStatus;
  } else if (
    typeof providerStatus === 'string'
    && ['ok', 'accepted', 'draft', 'publish', 'published', 'private', 'pending'].includes(providerStatus)
  ) {
    result.provider_status = providerStatus;
  }

  const ids: Record<string, string> = {};
  for (const key of [
    'id',
    'message_id',
    'thread_id',
    'draft_id',
    'post_id',
    'tweet_id',
    'cid',
    'ts',
  ]) {
    const raw = data[key];
    const value = typeof raw === 'number' ? String(raw) : raw;
    if (
      typeof value === 'string'
      && value.length > 0
      && value.length <= 160
      && /^[A-Za-z0-9:_.-]+$/.test(value)
    ) {
      ids[key] = value;
    }
  }
  if (Object.keys(ids).length > 0) result.receipt_ids = ids;
  return result;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      out[key] = canonicalize(record[key]);
    }
    return out;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === undefined) return null;
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function buildApprovalBinding(action: ScheduledAction): Promise<ApprovalBinding> {
  const payloadFingerprint = await sha256Hex(
    JSON.stringify(canonicalize(action.payload || {})),
  );
  const occurrenceFingerprint = await sha256Hex(JSON.stringify(canonicalize({
    actionId: action.id,
    scheduledFor: action.scheduled_for,
    parentActionId: action.parent_action_id || null,
  })));
  const payload: ApprovalBindingPayload = {
    approvalSchemaVersion: APPROVAL_SCHEMA_VERSION,
    actionId: action.id,
    userId: action.user_id,
    circleId: action.circle_id,
    actionKind: action.kind,
    payloadFingerprint,
    occurrenceFingerprint,
  };
  return {
    sessionKey:
      `scheduled-action:v2:${action.id}:${occurrenceFingerprint.slice(0, 24)}:${payloadFingerprint.slice(0, 24)}`,
    actionType: `scheduled_action.${action.kind}`,
    description:
      `Approve one scheduled ${action.kind} mutation. Contents are hidden and authority expires in 10 minutes.`,
    payload,
  };
}

function approvalMatchesBinding(row: ApprovalRow, binding: ApprovalBinding): boolean {
  if (
    row.circle_id !== binding.payload.circleId
    ||
    row.session_key !== binding.sessionKey
    || row.action_type !== binding.actionType
    || row.description !== binding.description
    || row.timeout_seconds !== APPROVAL_TTL_SECONDS
  ) {
    return false;
  }
  return JSON.stringify(canonicalize(row.payload || {}))
    === JSON.stringify(canonicalize(binding.payload));
}

function approvalExpiresAt(row: ApprovalRow): number | null {
  const requestedAt = Date.parse(row.requested_at);
  if (
    !Number.isFinite(requestedAt)
    || row.timeout_seconds !== APPROVAL_TTL_SECONDS
  ) {
    return null;
  }
  return requestedAt + APPROVAL_TTL_SECONDS * 1_000;
}

function nextCronOccurrence(cronExpr: string, after: Date): Date {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length !== 5) return new Date(after.getTime() + 24 * 60 * 60 * 1_000);
  const [minF, hourF, domF, _monF, dowF] = parts;
  const minute = minF === '*' ? 0 : Number.parseInt(minF, 10);
  const hour = hourF === '*' ? after.getUTCHours() : Number.parseInt(hourF, 10);
  if (!Number.isInteger(minute) || !Number.isInteger(hour)) {
    return new Date(after.getTime() + 24 * 60 * 60 * 1_000);
  }
  const next = new Date(after);
  next.setUTCMinutes(minute, 0, 0);
  next.setUTCHours(hour);
  if (dowF !== '*') {
    const day = Number.parseInt(dowF, 10);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return new Date(after.getTime() + 24 * 60 * 60 * 1_000);
    }
    let ahead = (day - next.getUTCDay() + 7) % 7;
    if (ahead === 0 && next <= after) ahead = 7;
    next.setUTCDate(next.getUTCDate() + ahead);
    return next;
  }
  if (domF !== '*') {
    const day = Number.parseInt(domF, 10);
    if (!Number.isInteger(day) || day < 1 || day > 31) {
      return new Date(after.getTime() + 24 * 60 * 60 * 1_000);
    }
    next.setUTCDate(day);
    if (next <= after) next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }
  if (next <= after) {
    if (hourF === '*') next.setUTCHours(next.getUTCHours() + 1);
    else next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

async function createNextOccurrence(
  supabase: SupabaseEdgeClient,
  action: ScheduledAction,
): Promise<void> {
  if (!action.recurrence) return;
  const next = nextCronOccurrence(action.recurrence, new Date());
  await supabase.from('scheduled_actions').insert({
    user_id: action.user_id,
    circle_id: action.circle_id,
    kind: action.kind,
    payload: action.payload,
    scheduled_for: next.toISOString(),
    requires_approval: true,
    approval_id: null,
    max_retries: 0,
    recurrence: action.recurrence,
    recurrence_label: action.recurrence_label || null,
    parent_action_id: action.id,
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
  } catch {
    console.error('[scheduled-action-runner] unhandled_internal_error');
    return jsonResponse({ ok: false, error: 'runner_internal_error' }, 500);
  }
});
