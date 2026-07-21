// ═══════════════════════════════════════════════════════════════════════════════
//  Agent Connect — Cloud bridge for CLI agent heartbeats
//
//  Receives heartbeat POSTs from Claude Code hooks (native HTTP type),
//  Codex, Gemini CLI, Cursor, Copilot, Windsurf, Aider, etc.
//  Upserts agent presence into circle_office_agents.
//
//  Auth: Bearer <connect_token> (generated in-app)
//
//  Accepts TWO payload formats:
//
//  1. Claude Code native hook payload (auto-sent by type:"http" hooks):
//     { session_id, cwd, model, hook_event_name, source, ... }
//
//  2. Custom format (for curl-based hooks):
//     { event, agent_type, session_id?, model?, cwd?, task?, tool_name?, circle_id? }
//
//  Deploy: npx supabase functions deploy agent-connect --no-verify-jwt
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { corsHeaders, errResponse, jsonResponse } from "../_shared/edge.ts";

// Agent type → display metadata
const AGENT_META: Record<string, { name: string; icon: string; color: string; provider: string }> = {
  "claude-code": { name: "Claude Code", icon: "💻", color: "#6366f1", provider: "claude-code" },
  "codex":       { name: "Codex",       icon: "🧠", color: "#10a37f", provider: "codex" },
  "gemini-cli":  { name: "Gemini CLI",  icon: "♊", color: "#4285f4", provider: "gemini" },
  "cursor":      { name: "Cursor",      icon: "🎯", color: "#8b5cf6", provider: "cursor" },
  "opencode":    { name: "OpenCode",    icon: "OC", color: "#38bdf8", provider: "opencode" },
  "windsurf":    { name: "Windsurf",    icon: "WS", color: "#06b6d4", provider: "windsurf" },
  "copilot":     { name: "Copilot",     icon: "CP", color: "#1f6feb", provider: "copilot" },
  "aider":       { name: "Aider",       icon: "AI", color: "#f59e0b", provider: "aider" },
  "cline":       { name: "Cline",       icon: "CL", color: "#ec4899", provider: "cline" },
  "continue":    { name: "Continue",    icon: "CN", color: "#22c55e", provider: "continue" },
  "amp":         { name: "Amp",         icon: "AM", color: "#a78bfa", provider: "amp" },
};

// Map Claude Code hook_event_name → our event type
const HOOK_EVENT_MAP: Record<string, string> = {
  "SessionStart": "session_start",
  "SessionEnd": "session_end",
  "PreToolUse": "tool_use",
  "PostToolUse": "tool_use",
  "Notification": "heartbeat",
  "Stop": "session_end",
  "SubagentStart": "tool_use",
  "SubagentStop": "heartbeat",
  "UserPromptSubmit": "heartbeat",
};

// ═══════════════════════════════════════════════════════════════════════════════
//  Read ops (MCP v2 read tools — event: "read_op")
//
//  Served ONLY after the same token-validation + circle-membership gates as the
//  presence path (the caller in Deno.serve returns 401/403 before reaching
//  here). Every query is manually scoped to the resolved circle id because the
//  service-role client bypasses RLS. Output is bounded (≤20 rows, long strings
//  truncated) and allowlisted — never approval `payload`, skill `content`,
//  `session_key`, tokens, or credentials.
// ═══════════════════════════════════════════════════════════════════════════════

const READ_OPS = ["list_pending_approvals", "list_skills", "circle_live_info", "list_tasks"];
const MAX_READ_ROWS = 20;

// ═══════════════════════════════════════════════════════════════════════════════
//  Write ops (MCP v2 write tools — event: "write_op")
//
//  Served ONLY after the SAME token-validation + circle-membership gates as the
//  read/presence paths (the caller in Deno.serve returns 401/403 before reaching
//  here). Append-only: every write is an INSERT scoped to the resolved circle id
//  — never UPDATE/DELETE, and never memory, skills, or approvals. `circle_id`
//  and `user_id` are SERVER-forced from the validated token/membership, never
//  trusted from the client body. Inputs are validated (required fields, enum
//  checks) and bounded (title/detail size caps), and writes are rate-limited
//  per token so a leaked token cannot spam rows.
// ═══════════════════════════════════════════════════════════════════════════════

const WRITE_OPS = ["report_receipt"];
// proof_of_work.pow_type CHECK set (supabase/migrations/20260410_circle_missions.sql:60-61).
const POW_TYPES = ["commit", "pr", "deploy", "agent_run", "checkin", "manual"];
const MAX_RECEIPT_TITLE = 300;         // proof_of_work.title truncation cap
const MAX_RECEIPT_DETAIL_BYTES = 4096; // proof_of_work.detail (jsonb) serialized cap
const MAX_RECEIPTS_PER_MIN = 12;       // per-token (user+circle) append rate limit

function truncField(value: unknown, max: number): string {
  const s = value == null ? "" : String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// deno-lint-ignore no-explicit-any
async function handleReadOp(sb: any, circleId: string, op: string): Promise<Response> {
  if (op === "list_pending_approvals") {
    // Legacy kill-switch approvals (`agent_approvals`) + run-loop HITL gates
    // (`agent_run_approvals`). NEVER return `payload` or `session_key`.
    const { data: legacyRows, error: legacyErr } = await sb
      .from("agent_approvals")
      .select("id, agent_name, action_type, description, requested_at, timeout_seconds")
      .eq("circle_id", circleId)
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(MAX_READ_ROWS);

    if (legacyErr) {
      return errResponse(500, "read_failed", truncField(legacyErr.message, 300));
    }

    // Table may not exist on older projects — fail open to empty, matching
    // src/services/runApprovalsService.ts.
    const { data: runRows } = await sb
      .from("agent_run_approvals")
      .select("id, approval_kind, title, requested_by, requested_at, timeout_seconds")
      .eq("circle_id", circleId)
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(MAX_READ_ROWS);

    const approvals = [
      ...(legacyRows || []).map((r: any) => ({
        id: r.id,
        source: "agent_approvals",
        kind: truncField(r.action_type, 40),
        title: truncField(r.description, 300),
        requester: truncField(r.agent_name, 80),
        requested_at: r.requested_at,
        timeout_seconds: r.timeout_seconds,
      })),
      ...(runRows || []).map((r: any) => ({
        id: r.id,
        source: "agent_run_approvals",
        kind: truncField(r.approval_kind, 40),
        title: truncField(r.title, 300),
        requester: truncField(r.requested_by, 80) || null,
        requested_at: r.requested_at,
        timeout_seconds: r.timeout_seconds,
      })),
    ]
      .sort((a, b) => String(b.requested_at || "").localeCompare(String(a.requested_at || "")))
      .slice(0, MAX_READ_ROWS);

    return jsonResponse({ ok: true, op, circle_id: circleId, count: approvals.length, approvals });
  }

  if (op === "list_skills") {
    // Metadata only — the `content` column (skill body) is intentionally never
    // selected, matching src/lib/skillLibrary.ts listLibrarySkills.
    const { data, error } = await sb
      .from("circle_skills")
      .select("id, name, description, version, tags, usage_count, success_count, updated_at")
      .eq("circle_id", circleId)
      .order("name", { ascending: true })
      .limit(MAX_READ_ROWS);

    if (error) {
      // PGRST205 = relation missing (skill-library migration not applied) —
      // fail open to an empty library, matching skillLibrary.ts.
      if ((error as any).code === "PGRST205") {
        return jsonResponse({ ok: true, op, circle_id: circleId, count: 0, skills: [] });
      }
      return errResponse(500, "read_failed", truncField(error.message, 300));
    }

    const skills = (data || []).map((r: any) => ({
      id: r.id,
      name: truncField(r.name, 120),
      description: truncField(r.description, 300),
      version: truncField(r.version, 20),
      tags: Array.isArray(r.tags) ? r.tags.slice(0, 10).map((t: unknown) => truncField(t, 40)) : [],
      usage_count: r.usage_count ?? 0,
      success_count: r.success_count ?? 0,
      updated_at: r.updated_at,
    }));

    return jsonResponse({ ok: true, op, circle_id: circleId, count: skills.length, skills });
  }

  if (op === "circle_live_info") {
    const today = new Date().toISOString().split("T")[0];

    const [circleRes, membersRes, checkInsRes, messagesRes, agentsRes] = await Promise.all([
      sb.from("circles").select("id, name").eq("id", circleId).maybeSingle(),
      sb.from("circle_members").select("*", { count: "exact", head: true }).eq("circle_id", circleId),
      sb.from("check_ins").select("*", { count: "exact", head: true }).eq("circle_id", circleId).gte("created_at", today),
      sb.from("messages").select("*", { count: "exact", head: true }).eq("circle_id", circleId).gte("created_at", today),
      sb.from("circle_office_agents")
        .select("name, provider, status, current_task, last_active_at")
        .eq("circle_id", circleId)
        .order("last_active_at", { ascending: false })
        .limit(10),
    ]);

    const agents = (agentsRes.data || []).map((a: any) => ({
      name: truncField(a.name, 80),
      provider: truncField(a.provider, 40),
      status: truncField(a.status, 20),
      current_task: truncField(a.current_task, 160),
      last_active_at: a.last_active_at,
    }));

    return jsonResponse({
      ok: true,
      op,
      circle_id: circleId,
      circle: {
        id: circleId,
        name: truncField((circleRes.data as any)?.name, 120) || null,
      },
      total_members: membersRes.count ?? 0,
      today_check_ins: checkInsRes.count ?? 0,
      today_messages: messagesRes.count ?? 0,
      agents,
    });
  }

  if (op === "list_tasks") {
    // Open tasks on the circle's kanban board (`tasks`). "Open" = status not in
    // (done, approved). Same circle_id scoping + FK profile joins the app board
    // uses (src/hooks/useKanbanData.ts:674-679). UUID owner columns
    // (created_by/assigned_to) are mapped to display names and never returned
    // raw; description, focus_chain, peer_approvals, plan ids, and image_url are
    // intentionally never selected.
    const { data, error } = await sb
      .from("tasks")
      .select(
        "id, title, status, priority, due_date, position, assigned_agent_id, " +
          "creator:profiles!tasks_created_by_fkey(display_name, username), " +
          "assignee:profiles!tasks_assigned_to_fkey(display_name, username)",
      )
      .eq("circle_id", circleId)
      .not("status", "in", "(done,approved)")
      .order("position", { ascending: true })
      .limit(MAX_READ_ROWS);

    if (error) {
      // Missing table (PGRST205) or missing embed FK (PGRST200) → fail open to
      // an empty list, matching the list_skills resilience above.
      if ((error as any).code === "PGRST205" || (error as any).code === "PGRST200") {
        return jsonResponse({ ok: true, op, circle_id: circleId, count: 0, tasks: [] });
      }
      return errResponse(500, "read_failed", truncField(error.message, 300));
    }

    // Map a joined profile row to a single display-name string — never the UUID.
    const nameOf = (p: any): string | null => (p ? truncField(p.display_name || p.username, 80) || null : null);

    const tasks = (data || []).map((r: any) => ({
      id: r.id,
      title: truncField(r.title, 300),
      status: truncField(r.status, 40),
      priority: truncField(r.priority, 20),
      due_date: r.due_date || null,
      position: typeof r.position === "number" ? r.position : null,
      assigned_agent_id: r.assigned_agent_id || null,
      assignee: nameOf(r.assignee),
      creator: nameOf(r.creator),
    }));

    return jsonResponse({ ok: true, op, circle_id: circleId, count: tasks.length, tasks });
  }

  return errResponse(400, "unknown_read_op", `Unknown read op. Supported: ${READ_OPS.join(", ")}`);
}

// deno-lint-ignore no-explicit-any
async function handleWriteOp(sb: any, circleId: string, userId: string, agentType: string, body: any): Promise<Response> {
  const op = typeof body.op === "string" ? body.op : "";

  if (op === "report_receipt") {
    // Append-only proof_of_work INSERT. Writes ONLY this table — never memory,
    // skills, or approvals. circle_id + user_id are server-forced below.

    // ── Required: non-empty title (proof_of_work.title is NOT NULL) ──────────
    const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
    if (!rawTitle) {
      return errResponse(400, "invalid_title", "report_receipt requires a non-empty title");
    }
    const title = truncField(rawTitle, MAX_RECEIPT_TITLE);

    // ── pow_type validated against the DB CHECK set (a bad value is a DB 500) ─
    const powType = typeof body.pow_type === "string" && body.pow_type ? body.pow_type : "agent_run";
    if (!POW_TYPES.includes(powType)) {
      return errResponse(400, "invalid_pow_type", `pow_type must be one of: ${POW_TYPES.join(", ")}`);
    }

    // ── detail: optional plain JSON object, bounded to MAX_RECEIPT_DETAIL_BYTES ─
    let detail: Record<string, unknown> = {};
    if (body.detail != null) {
      if (typeof body.detail !== "object" || Array.isArray(body.detail)) {
        return errResponse(400, "invalid_detail", "detail must be a JSON object");
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(body.detail);
      } catch {
        return errResponse(400, "invalid_detail", "detail must be JSON-serializable");
      }
      // Byte length, not UTF-16 code-unit count — multibyte detail must be
      // measured accurately against the cap it is named for.
      if (new TextEncoder().encode(serialized).length > MAX_RECEIPT_DETAIL_BYTES) {
        return errResponse(400, "detail_too_large", `detail exceeds ${MAX_RECEIPT_DETAIL_BYTES} bytes`);
      }
      detail = body.detail as Record<string, unknown>;
    }

    // ── mission_id: only attach if it belongs to THIS circle; else drop it ───
    let missionId: string | null = null;
    if (typeof body.mission_id === "string" && body.mission_id) {
      const { data: mission } = await sb
        .from("circle_missions")
        .select("id")
        .eq("id", body.mission_id)
        .eq("circle_id", circleId)
        .maybeSingle();
      missionId = mission?.id || null;
    }

    // ── Rate limit: cap receipts/min for this user in this circle ────────────
    const windowStart = new Date(Date.now() - 60_000).toISOString();
    const { count: recentCount } = await sb
      .from("proof_of_work")
      .select("id", { count: "exact", head: true })
      .eq("circle_id", circleId)
      .eq("user_id", userId)
      .gte("created_at", windowStart);
    if ((recentCount ?? 0) >= MAX_RECEIPTS_PER_MIN) {
      return errResponse(429, "rate_limited", `Too many receipts — max ${MAX_RECEIPTS_PER_MIN}/min`);
    }

    // ── Agent label from the same metadata the presence path uses ────────────
    const meta = AGENT_META[agentType] || AGENT_META["claude-code"];

    // ── INSERT only (append-only). circle_id + user_id are SERVER-forced from
    //    the validated token/membership — never trusted from the client body. ──
    const { data: inserted, error: insErr } = await sb
      .from("proof_of_work")
      .insert({
        circle_id: circleId,
        user_id: userId,
        mission_id: missionId,
        agent_name: truncField(meta.name, 80),
        pow_type: powType,
        title,
        detail,
      })
      .select("id, created_at")
      .single();

    if (insErr) {
      // Log the raw DB error server-side but return a generic message — an
      // INSERT error can otherwise echo constraint/column names to the caller.
      console.error("[agent-connect] report_receipt insert failed:", insErr.message);
      return errResponse(500, "write_failed", "Could not record the receipt. Try again shortly.");
    }

    return jsonResponse({
      ok: true,
      op,
      circle_id: circleId,
      receipt: {
        id: inserted?.id,
        pow_type: powType,
        title,
        mission_id: missionId,
        created_at: inserted?.created_at,
      },
    });
  }

  return errResponse(400, "unknown_write_op", `Unknown write op. Supported: ${WRITE_OPS.join(", ")}`);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errResponse(405, "method_not_allowed", "POST only");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    // ── Auth: validate connect token ─────────────────────────────────────────
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!token) {
      return errResponse(401, "missing_token", "Missing Authorization: Bearer <connect_token>");
    }

    const { data: tokenRow, error: tokenErr } = await sb
      .from("agent_connect_tokens")
      .select("id, user_id, circle_id")
      .eq("token", token)
      .single();

    if (tokenErr || !tokenRow) {
      return errResponse(401, "invalid_token", "Invalid connect token");
    }

    const userId = tokenRow.user_id;
    const defaultCircleId = tokenRow.circle_id;

    // Update last_used_at (fire-and-forget)
    sb.from("agent_connect_tokens")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", tokenRow.id)
      .then(() => {});

    // ── Parse body — detect native hook payload vs custom format ─────────────
    const body = await req.json().catch(() => ({}));

    let event: string;
    let agentType: string;
    let sessionId: string | undefined;
    let model: string | undefined;
    let cwd: string | undefined;
    let task: string | undefined;
    let toolName: string | undefined;
    let bodyCircleId: string | undefined;

    if (body.hook_event_name && body.session_id) {
      // ── Native Claude Code hook payload ──────────────────────────────────
      // Claude Code sends: { session_id, cwd, model, hook_event_name, source,
      //   permission_mode, transcript_path, agent_id?, agent_type? }
      event = HOOK_EVENT_MAP[body.hook_event_name] || "heartbeat";
      agentType = "claude-code";
      sessionId = body.session_id;
      model = body.model;
      cwd = body.cwd;
      toolName = body.tool_name;
      bodyCircleId = body.circle_id;

      // Build task from hook context
      if (body.hook_event_name === "SessionStart") {
        const project = cwd ? cwd.split("/").pop() : "";
        task = `Session started${project ? ` in ${project}` : ""}${body.source ? ` (${body.source})` : ""}`;
      } else if (body.hook_event_name === "SessionEnd") {
        task = "Session ended";
      } else if (body.hook_event_name === "PreToolUse" || body.hook_event_name === "PostToolUse") {
        task = toolName ? `Using ${toolName}` : "Working...";
      } else if (body.hook_event_name === "SubagentStart") {
        task = `Spawned ${body.agent_type || "sub"}agent`;
      } else {
        task = body.hook_event_name;
      }
    } else {
      // ── Custom format (curl-based hooks, other agents) ──────────────────
      event = body.event || "heartbeat";
      agentType = body.agent_type || "claude-code";
      sessionId = body.session_id;
      model = body.model;
      cwd = body.cwd;
      task = body.task;
      toolName = body.tool_name;
      bodyCircleId = body.circle_id;
    }

    // ── Token validation (no-op, just returns token info) ────────────────────
    if (event === "token_validate") {
      const { data: valProfile } = await sb
        .from("profiles")
        .select("display_name, username")
        .eq("id", userId)
        .single();

      return new Response(
        JSON.stringify({
          ok: true,
          circle_id: defaultCircleId || null,
          user_id: userId,
          display_name: valProfile?.display_name || valProfile?.username || null,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Resolve circle: body > token default > user's first circle ───────────
    let circleId = bodyCircleId || defaultCircleId;

    if (!circleId) {
      const { data: membership } = await sb
        .from("circle_members")
        .select("circle_id")
        .eq("user_id", userId)
        .limit(1)
        .single();
      circleId = membership?.circle_id;
    }

    if (!circleId) {
      return errResponse(400, "circle_missing", "No circle found. Join a circle first or specify circle_id.");
    }

    // ── SECURITY: Verify user is a member of this circle ─────────────────────
    const { data: memberCheck } = await sb
      .from("circle_members")
      .select("id")
      .eq("circle_id", circleId)
      .eq("user_id", userId)
      .limit(1)
      .single();

    if (!memberCheck) {
      return errResponse(403, "forbidden", "Not a member of this circle");
    }

    // ── Read ops (MCP v2 read tools) — token + membership verified above.
    //    Early return: reads never upsert presence. ────────────────────────────
    if (event === "read_op") {
      return await handleReadOp(sb, circleId, typeof body.op === "string" ? body.op : "");
    }

    // ── Write ops (MCP v2 write tools) — reached ONLY after the SAME token
    //    validation (:385-396) + circle-membership 403 gate (:493-503) as
    //    read_op. Append-only INSERTs; early return so they never upsert
    //    presence. circle_id + user_id are server-forced inside handleWriteOp. ──
    if (event === "write_op") {
      return await handleWriteOp(sb, circleId, userId, agentType, body);
    }

    // ── Get user profile ─────────────────────────────────────────────────────
    const { data: profile } = await sb
      .from("profiles")
      .select("display_name, username")
      .eq("id", userId)
      .single();

    const displayName = profile?.display_name || profile?.username || "Unknown";
    const username = profile?.username || "";

    // ── Agent metadata ───────────────────────────────────────────────────────
    const meta = AGENT_META[agentType] || AGENT_META["claude-code"];

    // ── Build status + task from event ────────────────────────────────────────
    let status = "idle";
    let currentTask: string | null = task || null;

    switch (event) {
      case "session_start":
        status = "building";
        currentTask = currentTask || `Starting session${cwd ? ` in ${cwd.split("/").pop()}` : ""}`;
        break;
      case "tool_use":
        status = "building";
        currentTask = currentTask || (toolName ? `Using ${toolName}` : "Working...");
        break;
      case "heartbeat":
        status = "building";
        currentTask = currentTask || model || "Active";
        break;
      case "session_end":
        status = "idle";
        currentTask = currentTask || "Session ended";
        break;
      default:
        status = "building";
        currentTask = currentTask || event;
    }

    // ── Upsert into circle_office_agents ─────────────────────────────────────
    const now = new Date().toISOString();

    const { data: upserted, error: upsertErr } = await sb
      .from("circle_office_agents")
      .upsert(
        {
          circle_id: circleId,
          owner_id: userId,
          owner_display_name: displayName,
          owner_username: username,
          provider: meta.provider,
          name: meta.name,
          color: meta.color,
          tool_icon: meta.icon,
          status,
          current_task: currentTask,
          is_published: true,
          is_public: false,
          gateway_url: null,
          last_active_at: now,
          updated_at: now,
          last_command: [event, toolName, model, sessionId].filter(Boolean).join(" | "),
          last_command_at: now,
        },
        { onConflict: "circle_id,owner_id,name" },
      )
      .select("id")
      .single();

    if (upsertErr) {
      console.error("[agent-connect] Upsert error:", upsertErr);
      return errResponse(500, "upsert_failed", upsertErr.message);
    }

    return jsonResponse({
      ok: true,
      agent_id: upserted?.id,
      circle_id: circleId,
      status,
      event,
    });
  } catch (error: any) {
    console.error("[agent-connect] Error:", error);
    return errResponse(500, "internal", error?.message || "Internal server error");
  }
});
