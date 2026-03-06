// automation-executor — Supabase Edge Function
//
// Executes circle automations: gathers context, calls AI, routes output.
// Called by pg_cron (schedule), DB triggers (event), or frontend (manual).
//
// Deploy: npx supabase functions deploy automation-executor
// Secrets: ANTHROPIC_API_KEY (required)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Model routing ───────────────────────────────────────────────────────────

const CLAUDE_MODEL_MAP: Record<string, string> = {
  "claude-haiku":  "claude-haiku-4-5-20251001",
  "claude-sonnet": "claude-sonnet-4-6",
  "claude-opus":   "claude-opus-4-6",
};

interface AIResult {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
}

// Rough cost per 1M tokens (input, output)
const MODEL_COSTS: Record<string, [number, number]> = {
  "claude-haiku-4-5-20251001": [0.80, 4.00],
  "claude-sonnet-4-6":        [3.00, 15.00],
  "claude-opus-4-6":          [15.00, 75.00],
};

async function callClaude(systemPrompt: string, userMessage: string, modelKey: string): Promise<AIResult> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const modelId = CLAUDE_MODEL_MAP[modelKey] || CLAUDE_MODEL_MAP["claude-haiku"];

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: modelId,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API ${res.status}: ${err}`);
  }

  const data = await res.json();
  const usage = data.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const costs = MODEL_COSTS[modelId] || [0.80, 4.00];
  const estimatedCost = (inputTokens * costs[0] + outputTokens * costs[1]) / 1_000_000;

  return {
    text: data.content?.[0]?.text || "No response generated.",
    model: modelId,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost,
  };
}

// ─── Context gathering (lighter version of swanbot-ai) ───────────────────────

interface ContextFlags {
  members?: boolean;
  check_ins?: boolean;
  tasks?: boolean;
  streaks?: boolean;
  analytics?: boolean;
}

async function gatherContext(supabase: any, circleId: string, flags: ContextFlags) {
  // Always get circle info
  const { data: circle } = await supabase
    .from("circles")
    .select("name, description")
    .eq("id", circleId)
    .single();

  let members: any[] = [];
  let memberCount = 0;
  if (flags.members !== false) {
    const { data: membersRaw } = await supabase
      .from("circle_members")
      .select("role, user:profiles(id, username, display_name, current_streak, longest_streak)")
      .eq("circle_id", circleId);
    members = (membersRaw || []).map((m: any) => ({ ...m.user, role: m.role }));
    memberCount = members.length;
  }

  let todayCheckIns: any[] = [];
  let notCheckedIn: any[] = [];
  if (flags.check_ins !== false) {
    const today = new Date().toISOString().split("T")[0];
    const { data } = await supabase
      .from("check_ins")
      .select("content, created_at, user:profiles(display_name, username)")
      .eq("circle_id", circleId)
      .gte("created_at", today);
    todayCheckIns = data || [];

    const checkedInIds = new Set(todayCheckIns.map((c: any) => c.user?.username));
    notCheckedIn = members.filter((m: any) => !checkedInIds.has(m.username));
  }

  let openTasks: any[] = [];
  let completedTasks: any[] = [];
  if (flags.tasks !== false) {
    const { data: open } = await supabase
      .from("tasks")
      .select("title, status, priority, due_date, assignee:profiles!tasks_assigned_to_fkey(display_name)")
      .eq("circle_id", circleId)
      .neq("status", "done")
      .order("created_at", { ascending: false })
      .limit(20);
    openTasks = open || [];

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);
    const { data: done } = await supabase
      .from("tasks")
      .select("title, completed_at, assignee:profiles!tasks_assigned_to_fkey(display_name)")
      .eq("circle_id", circleId)
      .eq("status", "done")
      .gte("completed_at", weekAgo.toISOString())
      .limit(10);
    completedTasks = done || [];
  }

  return {
    circle,
    members,
    memberCount,
    todayCheckIns,
    checkedInCount: todayCheckIns.length,
    notCheckedIn,
    openTasks,
    completedTasks,
  };
}

// ─── Build prompt context string ─────────────────────────────────────────────

function buildContextString(ctx: any): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
  const timeStr = now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });

  let s = `Circle: ${ctx.circle?.name || "Unknown"}\nDate: ${dateStr} at ${timeStr} ET\nMembers: ${ctx.memberCount}\nChecked in today: ${ctx.checkedInCount}/${ctx.memberCount}`;

  if (ctx.members.length > 0) {
    s += `\n\nMembers:\n${ctx.members.map((m: any) =>
      `- ${m.display_name || m.username} (${m.role || "member"}) — ${m.current_streak || 0} day streak`
    ).join("\n")}`;
  }

  if (ctx.notCheckedIn.length > 0) {
    s += `\n\nHaven't checked in today:\n${ctx.notCheckedIn.map((m: any) =>
      `- ${m.display_name || m.username}`
    ).join("\n")}`;
  }

  if (ctx.todayCheckIns.length > 0) {
    s += `\n\nToday's check-ins:\n${ctx.todayCheckIns.map((c: any) =>
      `- ${c.user?.display_name || c.user?.username}: "${c.content}"`
    ).join("\n")}`;
  }

  if (ctx.openTasks.length > 0) {
    s += `\n\nOpen tasks (${ctx.openTasks.length}):\n${ctx.openTasks.slice(0, 10).map((t: any) =>
      `- [${t.priority}] ${t.title} → ${t.assignee?.display_name || "Unassigned"} (${t.status})`
    ).join("\n")}`;
  }

  if (ctx.completedTasks.length > 0) {
    s += `\n\nCompleted this week:\n${ctx.completedTasks.map((t: any) =>
      `- ✅ ${t.title} by ${t.assignee?.display_name || "someone"}`
    ).join("\n")}`;
  }

  return s;
}

// ─── Variable substitution ──────────────────────────────────────────────────

function substituteVariables(prompt: string, vars: Record<string, string>): string {
  return prompt.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

// ─── Output routing ──────────────────────────────────────────────────────────

async function routeOutput(
  supabase: any,
  outputTarget: string,
  circleId: string,
  agentName: string,
  text: string,
  webhookUrl?: string,
  automationName?: string,
) {
  // Skip output if AI said SKIP
  if (text.trim() === "SKIP") return;

  switch (outputTarget) {
    case "chat":
      // Insert as a bot message in the circle chat
      await supabase.from("messages").insert({
        circle_id: circleId,
        content: text,
        is_bot: true,
        user_id: null,
      });
      break;

    case "activity":
      await supabase.from("agent_activity").insert({
        circle_id: circleId,
        agent_name: agentName,
        source: "cron",
        source_detail: `automation:${automationName || "unknown"}`,
        activity_type: "task_completed",
        title: `Automation: ${automationName || "Task"}`,
        body: text.slice(0, 2000),
        status: "completed",
      });
      break;

    case "webhook":
      if (webhookUrl) {
        try {
          await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              text,
              source: "circle-automation",
              automation: automationName,
              circle_id: circleId,
            }),
            signal: AbortSignal.timeout(10000),
          });
        } catch (e) {
          console.warn("Webhook delivery failed:", e);
        }
      }
      break;

    case "silent":
      // Output stored only in automation_runs
      break;
  }
}

// ─── Main handler ────────────────────────────────────────────────────────────

interface AutomationRequest {
  automationId: string;
  circleId: string;
  triggerSource: "schedule" | "event" | "manual";
  triggeredBy?: string;
  eventPayload?: any;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", service: "automation-executor" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body: AutomationRequest = await req.json();
    const { automationId, circleId, triggerSource, triggeredBy, eventPayload } = body;

    if (!automationId || !circleId) {
      return new Response(
        JSON.stringify({ error: "Missing automationId or circleId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 1. Load automation config
    const { data: automation, error: autoErr } = await supabase
      .from("circle_automations")
      .select("*")
      .eq("id", automationId)
      .single();

    if (autoErr || !automation) {
      return new Response(
        JSON.stringify({ error: "Automation not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!automation.enabled && triggerSource !== "manual") {
      return new Response(
        JSON.stringify({ error: "Automation is disabled" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Create run record
    const { data: run } = await supabase
      .from("automation_runs")
      .insert({
        automation_id: automationId,
        circle_id: circleId,
        status: "running",
        trigger_source: triggerSource,
        triggered_by: triggeredBy || null,
      })
      .select("id")
      .single();

    const runId = run?.id;
    const startTime = Date.now();

    try {
      // 3. Gather context
      const contextFlags: ContextFlags = automation.include_context || {};
      const context = await gatherContext(supabase, circleId, contextFlags);

      // 4. Substitute variables in prompt
      const contextString = buildContextString(context);
      const vars: Record<string, string> = {
        circle_name: context.circle?.name || "Unknown",
        member_count: String(context.memberCount || 0),
        checked_in_count: String(context.checkedInCount || 0),
        date: new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
        time: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" }),
      };
      if (eventPayload) {
        vars.event = JSON.stringify(eventPayload);
      }

      const resolvedPrompt = substituteVariables(automation.prompt, vars);

      // 5. Build system prompt
      const systemPrompt = `You are BlackSwan 🦢 — an AI assistant for "${context.circle?.name || "Unknown"}" circle.
You are running an automated task: "${automation.name}".
Be concise, direct, and actionable. Use real data from the context below.
Always prefix your response with 🦢.

## Circle Context
${contextString}`;

      // 6. Call AI
      const aiResult = await callClaude(systemPrompt, resolvedPrompt, automation.model || "claude-haiku");

      // 7. Route output
      await routeOutput(
        supabase,
        automation.output_target,
        circleId,
        automation.agent || "BlackSwan",
        aiResult.text,
        automation.webhook_url,
        automation.name,
      );

      // 8. Update run as completed
      const durationMs = Date.now() - startTime;
      await supabase
        .from("automation_runs")
        .update({
          status: "completed",
          completed_at: new Date().toISOString(),
          duration_ms: durationMs,
          output_text: aiResult.text,
          prompt_used: resolvedPrompt,
          token_count: aiResult.totalTokens,
          model_used: aiResult.model,
          estimated_cost: aiResult.estimatedCost,
          input_context: { circle: context.circle?.name, memberCount: context.memberCount },
          output_target: automation.output_target,
        })
        .eq("id", runId);

      // 9. Clear last_error on success
      await supabase
        .from("circle_automations")
        .update({ last_error: null })
        .eq("id", automationId);

      return new Response(
        JSON.stringify({ ok: true, runId, durationMs, tokens: aiResult.totalTokens }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );

    } catch (execErr: any) {
      // Update run as failed
      const durationMs = Date.now() - startTime;
      if (runId) {
        await supabase
          .from("automation_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            error_message: execErr.message,
          })
          .eq("id", runId);
      }

      // Update automation last_error
      await supabase
        .from("circle_automations")
        .update({ last_error: execErr.message })
        .eq("id", automationId);

      throw execErr;
    }

  } catch (err: any) {
    console.error("automation-executor error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
