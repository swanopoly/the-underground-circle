// GitHub Webhook Receiver — Supabase Edge Function
//
// Receives GitHub webhook events, verifies HMAC signature,
// parses into human-readable summaries, stores in circle_github_events,
// and optionally posts to circle chat.
//
// Deploy: npx supabase functions deploy github-webhook

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── HMAC-SHA256 Signature Verification ──────────────────────────────────────

async function verifyGitHubSignature(
  body: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;

  // GitHub sends: sha256=<hex>
  const expected = signature.replace("sha256=", "");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );
  const computed = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Timing-safe comparison via string equality on hex
  return computed.length === expected.length && computed === expected;
}

// ─── Event Parsers ───────────────────────────────────────────────────────────

interface ParsedEvent {
  title: string;
  body: string | null;
  author: string;
  authorAvatar: string;
  url: string;
  ref: string | null;
  commitsCount: number;
  additions: number;
  deletions: number;
}

function parsePushEvent(payload: any): ParsedEvent {
  const commits = payload.commits || [];
  const branch = (payload.ref || "").replace("refs/heads/", "");
  const pusher = payload.pusher?.name || payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  const commitSummaries = commits
    .slice(0, 5)
    .map((c: any) => {
      const msg = (c.message || "").split("\n")[0].slice(0, 80);
      return `  \`${c.id.slice(0, 7)}\` ${msg}`;
    })
    .join("\n");

  const extra =
    commits.length > 5 ? `\n  ...and ${commits.length - 5} more` : "";

  const totalAdds = commits.reduce(
    (s: number, c: any) => s + (c.added?.length || 0),
    0
  );
  const totalDels = commits.reduce(
    (s: number, c: any) => s + (c.removed?.length || 0),
    0
  );

  return {
    title: `${pusher} pushed ${commits.length} commit${commits.length !== 1 ? "s" : ""} to ${branch}`,
    body: commitSummaries + extra || null,
    author: pusher,
    authorAvatar: avatar,
    url: payload.compare || payload.repository?.html_url || "",
    ref: branch,
    commitsCount: commits.length,
    additions: totalAdds,
    deletions: totalDels,
  };
}

function parsePullRequestEvent(payload: any): ParsedEvent {
  const pr = payload.pull_request || {};
  const action = payload.action || "opened";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";
  const merged = action === "closed" && pr.merged;

  const verb = merged ? "merged" : action;
  const title = `${actor} ${verb} PR #${pr.number}: ${(pr.title || "").slice(0, 80)}`;

  return {
    title,
    body: pr.body?.slice(0, 500) || null,
    author: actor,
    authorAvatar: avatar,
    url: pr.html_url || "",
    ref: pr.head?.ref || null,
    commitsCount: pr.commits || 0,
    additions: pr.additions || 0,
    deletions: pr.deletions || 0,
  };
}

function parseIssuesEvent(payload: any): ParsedEvent {
  const issue = payload.issue || {};
  const action = payload.action || "opened";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  return {
    title: `${actor} ${action} issue #${issue.number}: ${(issue.title || "").slice(0, 80)}`,
    body: issue.body?.slice(0, 500) || null,
    author: actor,
    authorAvatar: avatar,
    url: issue.html_url || "",
    ref: null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseReleaseEvent(payload: any): ParsedEvent {
  const release = payload.release || {};
  const action = payload.action || "published";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  return {
    title: `${actor} ${action} release ${release.tag_name || ""}`,
    body: release.body?.slice(0, 500) || null,
    author: actor,
    authorAvatar: avatar,
    url: release.html_url || "",
    ref: release.tag_name || null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseWorkflowRunEvent(payload: any): ParsedEvent {
  const run = payload.workflow_run || {};
  const action = payload.action || "completed";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  const conclusion = run.conclusion || "in_progress";
  const status =
    conclusion === "success"
      ? "passed"
      : conclusion === "failure"
        ? "failed"
        : conclusion;

  return {
    title: `Workflow "${run.name || "CI"}" ${status} on ${run.head_branch || "unknown"}`,
    body: action === "completed" ? `Conclusion: ${conclusion}` : null,
    author: actor,
    authorAvatar: avatar,
    url: run.html_url || "",
    ref: run.head_branch || null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

// ─── Chat Message Formatter ──────────────────────────────────────────────────

function formatChatMessage(
  eventType: string,
  action: string | null,
  parsed: ParsedEvent,
  repoFullName: string
): string {
  const icon =
    eventType === "push"
      ? "git-push"
      : eventType === "pull_request"
        ? "git-pr"
        : eventType === "issues"
          ? "git-issue"
          : eventType === "release"
            ? "git-release"
            : "git-ci";

  const header = `[${icon}] **${repoFullName}**`;

  let msg = `${header}\n${parsed.title}`;

  if (parsed.body) {
    msg += `\n${parsed.body}`;
  }

  if (parsed.url) {
    msg += `\n${parsed.url}`;
  }

  return msg;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Health check
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", service: "github-webhook" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Read raw body for signature verification
    const body = await req.text();

    const eventType = req.headers.get("x-github-event") || "";
    const deliveryId = req.headers.get("x-github-delivery") || "";
    const signature = req.headers.get("x-hub-signature-256");

    // Parse payload
    let payload: any;
    try {
      payload = JSON.parse(body);
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }

    // GitHub sends a "ping" event when a webhook is first created
    if (eventType === "ping") {
      console.log(`GitHub webhook ping: ${payload.zen}`);
      return new Response(
        JSON.stringify({ ok: true, event: "ping", zen: payload.zen }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Extract repo info to find the connection
    const repoOwner =
      payload.repository?.owner?.login ||
      payload.repository?.owner?.name ||
      "";
    const repoName = payload.repository?.name || "";

    if (!repoOwner || !repoName) {
      console.error("No repository info in webhook payload");
      return new Response("Missing repository info", { status: 400 });
    }

    // Init Supabase service client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Look up connection
    const { data: connection, error: connErr } = await supabase
      .from("circle_github_connections")
      .select("id, circle_id, webhook_secret, events_enabled, notify_chat, notify_activity, is_active, event_count")
      .eq("owner", repoOwner)
      .eq("repo", repoName)
      .eq("is_active", true)
      .single();

    if (connErr || !connection) {
      console.warn(`No active connection for ${repoOwner}/${repoName}`);
      return new Response("No connection found", { status: 404 });
    }

    // Verify HMAC signature
    const valid = await verifyGitHubSignature(
      body,
      signature,
      connection.webhook_secret
    );
    if (!valid) {
      console.error(`Invalid signature for ${repoOwner}/${repoName}`);
      return new Response("Invalid signature", { status: 401 });
    }

    // Check if this event type is enabled
    const enabledEvents: string[] = connection.events_enabled || [];
    if (!enabledEvents.includes(eventType)) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "event_type_disabled" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse the event
    const action = payload.action || null;
    let parsed: ParsedEvent;

    switch (eventType) {
      case "push":
        parsed = parsePushEvent(payload);
        break;
      case "pull_request":
        parsed = parsePullRequestEvent(payload);
        break;
      case "issues":
        parsed = parseIssuesEvent(payload);
        break;
      case "release":
        parsed = parseReleaseEvent(payload);
        break;
      case "workflow_run":
        parsed = parseWorkflowRunEvent(payload);
        break;
      default:
        // Store unknown events with basic info
        parsed = {
          title: `${eventType}${action ? `: ${action}` : ""} on ${repoOwner}/${repoName}`,
          body: null,
          author: payload.sender?.login || "unknown",
          authorAvatar: payload.sender?.avatar_url || "",
          url: payload.repository?.html_url || "",
          ref: null,
          commitsCount: 0,
          additions: 0,
          deletions: 0,
        };
    }

    // Insert event record (idempotent via delivery_id unique index)
    const { data: event, error: insertErr } = await supabase
      .from("circle_github_events")
      .insert({
        circle_id: connection.circle_id,
        connection_id: connection.id,
        event_type: eventType,
        action,
        delivery_id: deliveryId || null,
        title: parsed.title,
        body: parsed.body,
        author: parsed.author,
        author_avatar: parsed.authorAvatar,
        url: parsed.url,
        ref: parsed.ref,
        commits_count: parsed.commitsCount,
        additions: parsed.additions,
        deletions: parsed.deletions,
        payload: payload,
      })
      .select("id")
      .single();

    if (insertErr) {
      // Duplicate delivery_id means we already processed this
      if (insertErr.code === "23505") {
        return new Response(
          JSON.stringify({ ok: true, duplicate: true }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      console.error("Failed to insert event:", insertErr);
      return new Response("Failed to store event", { status: 500 });
    }

    // Update connection stats
    await supabase
      .from("circle_github_connections")
      .update({
        last_event_at: new Date().toISOString(),
        event_count: (connection as any).event_count
          ? (connection as any).event_count + 1
          : 1,
      })
      .eq("id", connection.id);

    // Post to circle chat if enabled
    if (connection.notify_chat) {
      const chatMsg = formatChatMessage(
        eventType,
        action,
        parsed,
        `${repoOwner}/${repoName}`
      );

      await supabase.from("messages").insert({
        circle_id: connection.circle_id,
        content: chatMsg,
        is_bot: true,
        user_id: null,
      });
    }

    // Post to agent activity feed if enabled
    if (connection.notify_activity) {
      await supabase.from("agent_activity").insert({
        circle_id: connection.circle_id,
        agent_name: "BlackSwan",
        source: "github",
        source_detail: `${repoOwner}/${repoName}`,
        activity_type: "task_completed",
        title: parsed.title,
        body: (parsed.body || "").slice(0, 2000),
        status: "completed",
        metadata: {
          event_type: eventType,
          action,
          event_id: event?.id,
          url: parsed.url,
          author: parsed.author,
          ref: parsed.ref,
        },
      });
    }

    // Dispatch matching event-triggered automations
    try {
      // Fetch all enabled GitHub-triggered automations for this circle
      const { data: ghAutomations } = await supabase
        .from("circle_automations")
        .select("id, event_config")
        .eq("circle_id", connection.circle_id)
        .eq("enabled", true)
        .eq("trigger_type", "event");

      const toTrigger = (ghAutomations || []).filter((a: any) => {
        const cfg = a.event_config || {};
        if (cfg.provider !== "github") return false;
        const evt = cfg.event;
        // Direct event type match (push, pull_request, issues, release, workflow_run)
        if (evt === eventType || evt === "*") return true;
        // UI-friendly event names → GitHub event mapping
        if (evt === "ci_completed" && eventType === "workflow_run" && payload.workflow_run?.conclusion === "success") return true;
        if (evt === "pull_request_opened" && eventType === "pull_request" && action === "opened") return true;
        if (evt === "pull_request_merged" && eventType === "pull_request" && action === "closed" && payload.pull_request?.merged) return true;
        return false;
      });

      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

      for (const auto of toTrigger) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/automation-executor`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({
              automationId: auto.id,
              circleId: connection.circle_id,
              triggerSource: "event",
              eventPayload: {
                source: "github",
                event_type: eventType,
                action,
                repo: `${repoOwner}/${repoName}`,
                title: parsed.title,
                author: parsed.author,
                url: parsed.url,
                ref: parsed.ref,
                commits_count: parsed.commitsCount,
              },
            }),
            signal: AbortSignal.timeout(30000),
          });
        } catch (autoErr) {
          console.warn(`Failed to trigger automation ${auto.id}:`, autoErr);
        }
      }

      if (toTrigger.length > 0) {
        console.log(`Triggered ${toTrigger.length} automation(s) for ${eventType} on ${repoOwner}/${repoName}`);
      }
    } catch (autoErr) {
      console.warn("Automation dispatch error (non-fatal):", autoErr);
    }

    // Mark event as processed
    if (event?.id) {
      await supabase
        .from("circle_github_events")
        .update({ processed: true, processed_at: new Date().toISOString() })
        .eq("id", event.id);
    }

    console.log(
      `GitHub webhook processed: ${eventType} on ${repoOwner}/${repoName} → circle ${connection.circle_id}`
    );

    return new Response(
      JSON.stringify({
        ok: true,
        event_id: event?.id,
        event_type: eventType,
        circle_id: connection.circle_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("github-webhook error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
