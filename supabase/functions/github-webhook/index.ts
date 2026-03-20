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

function parsePullRequestReviewEvent(payload: any): ParsedEvent {
  const review = payload.review || {};
  const pr = payload.pull_request || {};
  const action = payload.action || "submitted";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  const state = review.state || "commented";
  const verb =
    state === "approved"
      ? "approved"
      : state === "changes_requested"
        ? "requested changes on"
        : "reviewed";

  return {
    title: `${actor} ${verb} PR #${pr.number}: ${(pr.title || "").slice(0, 80)}`,
    body: review.body?.slice(0, 500) || null,
    author: actor,
    authorAvatar: avatar,
    url: review.html_url || pr.html_url || "",
    ref: pr.head?.ref || null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseCheckRunEvent(payload: any): ParsedEvent {
  const checkRun = payload.check_run || {};
  const action = payload.action || "completed";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  const conclusion = checkRun.conclusion || "in_progress";
  const status =
    conclusion === "success"
      ? "passed"
      : conclusion === "failure"
        ? "failed"
        : conclusion;

  return {
    title: `Check "${checkRun.name || "check"}" ${status} on ${checkRun.head_sha?.slice(0, 7) || "unknown"}`,
    body: checkRun.output?.summary?.slice(0, 500) || null,
    author: actor,
    authorAvatar: avatar,
    url: checkRun.html_url || "",
    ref: null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseCheckSuiteEvent(payload: any): ParsedEvent {
  const suite = payload.check_suite || {};
  const action = payload.action || "completed";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  const conclusion = suite.conclusion || "in_progress";
  const status =
    conclusion === "success"
      ? "passed"
      : conclusion === "failure"
        ? "failed"
        : conclusion;

  return {
    title: `Check suite ${status} on ${suite.head_branch || "unknown"} (${suite.head_sha?.slice(0, 7) || ""})`,
    body: `${suite.latest_check_runs_count || 0} check(s) — conclusion: ${conclusion}`,
    author: actor,
    authorAvatar: avatar,
    url: suite.url || "",
    ref: suite.head_branch || null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseDeploymentEvent(payload: any): ParsedEvent {
  const deployment = payload.deployment || {};
  const action = payload.action || "created";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  return {
    title: `${actor} ${action} deployment to ${deployment.environment || "unknown"}`,
    body: deployment.description?.slice(0, 500) || null,
    author: actor,
    authorAvatar: avatar,
    url: deployment.url || "",
    ref: deployment.ref || null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseDeploymentStatusEvent(payload: any): ParsedEvent {
  const status = payload.deployment_status || {};
  const deployment = payload.deployment || {};
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  const state = status.state || "pending";
  const env = deployment.environment || status.environment || "unknown";

  return {
    title: `Deployment to ${env} is ${state}`,
    body: status.description?.slice(0, 500) || null,
    author: actor,
    authorAvatar: avatar,
    url: status.target_url || status.log_url || deployment.url || "",
    ref: deployment.ref || null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseCodeScanningAlertEvent(payload: any): ParsedEvent {
  const alert = payload.alert || {};
  const action = payload.action || "created";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  const severity = alert.rule?.severity || alert.rule?.security_severity_level || "unknown";
  const ruleName = alert.rule?.description || alert.rule?.id || "unknown rule";

  return {
    title: `[SECURITY] Code scanning alert ${action}: ${ruleName}`,
    body: `Severity: ${severity}\nTool: ${alert.tool?.name || "unknown"}\nState: ${alert.state || action}`,
    author: actor,
    authorAvatar: avatar,
    url: alert.html_url || "",
    ref: alert.most_recent_instance?.ref || null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseSecretScanningAlertEvent(payload: any): ParsedEvent {
  const alert = payload.alert || {};
  const action = payload.action || "created";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  return {
    title: `[SECURITY] Secret scanning alert ${action}: ${alert.secret_type_display_name || alert.secret_type || "unknown secret"}`,
    body: `State: ${alert.state || action}\nSecret type: ${alert.secret_type || "unknown"}`,
    author: actor,
    authorAvatar: avatar,
    url: alert.html_url || "",
    ref: null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseDependabotAlertEvent(payload: any): ParsedEvent {
  const alert = payload.alert || {};
  const action = payload.action || "created";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  const severity = alert.security_advisory?.severity || alert.security_vulnerability?.severity || "unknown";
  const pkg = alert.security_vulnerability?.package?.name || alert.dependency?.package?.name || "unknown package";
  const advisory = alert.security_advisory?.summary || "";

  return {
    title: `[SECURITY] Dependabot alert ${action}: ${pkg} (${severity})`,
    body: advisory ? advisory.slice(0, 500) : `Vulnerability in ${pkg} — severity: ${severity}`,
    author: actor,
    authorAvatar: avatar,
    url: alert.html_url || "",
    ref: null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseProjectsV2ItemEvent(payload: any): ParsedEvent {
  const item = payload.projects_v2_item || {};
  const action = payload.action || "created";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  return {
    title: `${actor} ${action} project board item`,
    body: `Content type: ${item.content_type || "unknown"}`,
    author: actor,
    authorAvatar: avatar,
    url: "",
    ref: null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseDiscussionEvent(payload: any): ParsedEvent {
  const discussion = payload.discussion || {};
  const action = payload.action || "created";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  return {
    title: `${actor} ${action} discussion: ${(discussion.title || "").slice(0, 80)}`,
    body: discussion.body?.slice(0, 500) || null,
    author: actor,
    authorAvatar: avatar,
    url: discussion.html_url || "",
    ref: null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseDiscussionCommentEvent(payload: any): ParsedEvent {
  const comment = payload.comment || {};
  const discussion = payload.discussion || {};
  const action = payload.action || "created";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";

  return {
    title: `${actor} ${action} comment on discussion: ${(discussion.title || "").slice(0, 80)}`,
    body: comment.body?.slice(0, 500) || null,
    author: actor,
    authorAvatar: avatar,
    url: comment.html_url || discussion.html_url || "",
    ref: null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseStarEvent(payload: any): ParsedEvent {
  const action = payload.action || "created";
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";
  const repoName = payload.repository?.full_name || "";
  const stars = payload.repository?.stargazers_count || 0;

  const verb = action === "created" ? "starred" : "unstarred";

  return {
    title: `${actor} ${verb} ${repoName} (${stars} stars)`,
    body: null,
    author: actor,
    authorAvatar: avatar,
    url: payload.repository?.html_url || "",
    ref: null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

function parseForkEvent(payload: any): ParsedEvent {
  const forkee = payload.forkee || {};
  const actor = payload.sender?.login || "unknown";
  const avatar = payload.sender?.avatar_url || "";
  const repoName = payload.repository?.full_name || "";
  const forks = payload.repository?.forks_count || 0;

  return {
    title: `${actor} forked ${repoName} (${forks} forks)`,
    body: `Fork: ${forkee.full_name || ""}`,
    author: actor,
    authorAvatar: avatar,
    url: forkee.html_url || payload.repository?.html_url || "",
    ref: null,
    commitsCount: 0,
    additions: 0,
    deletions: 0,
  };
}

// ─── Security Priority Helper ────────────────────────────────────────────────

const SECURITY_EVENTS = new Set([
  "code_scanning_alert",
  "secret_scanning_alert",
  "dependabot_alert",
]);

function isSecurityEvent(eventType: string): boolean {
  return SECURITY_EVENTS.has(eventType);
}

// ─── Chat Message Formatter ──────────────────────────────────────────────────

function formatChatMessage(
  eventType: string,
  action: string | null,
  parsed: ParsedEvent,
  repoFullName: string
): string {
  const iconMap: Record<string, string> = {
    push: "git-push",
    pull_request: "git-pr",
    pull_request_review: "git-review",
    issues: "git-issue",
    release: "git-release",
    workflow_run: "git-ci",
    check_run: "git-ci",
    check_suite: "git-ci",
    deployment: "git-deploy",
    deployment_status: "git-deploy",
    code_scanning_alert: "git-security",
    secret_scanning_alert: "git-security",
    dependabot_alert: "git-security",
    projects_v2_item: "git-project",
    discussion: "git-discussion",
    discussion_comment: "git-discussion",
    star: "git-star",
    fork: "git-fork",
  };
  const icon = iconMap[eventType] || "git-event";

  const securityPrefix = isSecurityEvent(eventType) ? "**[HIGH PRIORITY]** " : "";
  const header = `[${icon}] ${securityPrefix}**${repoFullName}**`;

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
      case "pull_request_review":
        parsed = parsePullRequestReviewEvent(payload);
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
      case "check_run":
        parsed = parseCheckRunEvent(payload);
        break;
      case "check_suite":
        parsed = parseCheckSuiteEvent(payload);
        break;
      case "deployment":
        parsed = parseDeploymentEvent(payload);
        break;
      case "deployment_status":
        parsed = parseDeploymentStatusEvent(payload);
        break;
      case "code_scanning_alert":
        parsed = parseCodeScanningAlertEvent(payload);
        break;
      case "secret_scanning_alert":
        parsed = parseSecretScanningAlertEvent(payload);
        break;
      case "dependabot_alert":
        parsed = parseDependabotAlertEvent(payload);
        break;
      case "projects_v2_item":
        parsed = parseProjectsV2ItemEvent(payload);
        break;
      case "discussion":
        parsed = parseDiscussionEvent(payload);
        break;
      case "discussion_comment":
        parsed = parseDiscussionCommentEvent(payload);
        break;
      case "star":
        parsed = parseStarEvent(payload);
        break;
      case "fork":
        parsed = parseForkEvent(payload);
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

    // Flag security events as high priority in the stored record
    const priority = isSecurityEvent(eventType) ? "high" : "normal";

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
        priority,
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
        activity_type: isSecurityEvent(eventType) ? "alert" : "task_completed",
        title: parsed.title,
        body: (parsed.body || "").slice(0, 2000),
        status: isSecurityEvent(eventType) ? "needs_attention" : "completed",
        metadata: {
          event_type: eventType,
          action,
          event_id: event?.id,
          url: parsed.url,
          author: parsed.author,
          ref: parsed.ref,
          priority,
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
        // Direct event type match (push, pull_request, issues, release, workflow_run, etc.)
        if (evt === eventType || evt === "*") return true;
        // UI-friendly event names → GitHub event mapping
        if (evt === "ci_completed" && eventType === "workflow_run" && payload.workflow_run?.conclusion === "success") return true;
        if (evt === "ci_failed" && eventType === "workflow_run" && payload.workflow_run?.conclusion === "failure") return true;
        if (evt === "pull_request_opened" && eventType === "pull_request" && action === "opened") return true;
        if (evt === "pull_request_merged" && eventType === "pull_request" && action === "closed" && payload.pull_request?.merged) return true;
        if (evt === "pr_approved" && eventType === "pull_request_review" && payload.review?.state === "approved") return true;
        if (evt === "pr_changes_requested" && eventType === "pull_request_review" && payload.review?.state === "changes_requested") return true;
        if (evt === "check_failed" && eventType === "check_run" && payload.check_run?.conclusion === "failure") return true;
        if (evt === "check_passed" && eventType === "check_run" && payload.check_run?.conclusion === "success") return true;
        if (evt === "deploy_success" && eventType === "deployment_status" && payload.deployment_status?.state === "success") return true;
        if (evt === "deploy_failure" && eventType === "deployment_status" && payload.deployment_status?.state === "failure") return true;
        if (evt === "security_alert" && SECURITY_EVENTS.has(eventType)) return true;
        if (evt === "issue_labeled" && eventType === "issues" && action === "labeled") return true;
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
