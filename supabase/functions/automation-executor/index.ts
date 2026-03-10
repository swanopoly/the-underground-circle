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
          // Telegram Bot API detection: URL contains api.telegram.org or has telegram config
          if (webhookUrl.includes("api.telegram.org")) {
            // Direct Telegram URL: extract bot token and chat ID from URL params
            await fetch(webhookUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text, parse_mode: "Markdown" }),
              signal: AbortSignal.timeout(10000),
            });
          } else {
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
          }
        } catch (e) {
          console.warn("Webhook delivery failed:", e);
        }
      }
      // Also try Telegram via circle settings if no webhookUrl
      if (!webhookUrl) {
        try {
          const { data: circle } = await supabase
            .from("circles")
            .select("settings")
            .eq("id", circleId)
            .single();
          const tg = circle?.settings?.telegram;
          if (tg?.bot_token && tg?.chat_id) {
            await fetch(
              `https://api.telegram.org/bot${tg.bot_token}/sendMessage`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  chat_id: tg.chat_id,
                  text: `\u{1F9B2} *${automationName || "Automation"}*\n\n${text}`,
                  parse_mode: "Markdown",
                }),
                signal: AbortSignal.timeout(10000),
              }
            );
          }
        } catch (e) {
          console.warn("Telegram fallback failed:", e);
        }
      }
      break;

    case "silent":
      // Output stored only in automation_runs
      break;
  }
}

// ─── Build detailed report task ──────────────────────────────────────────────

interface ReportInput {
  automationName: string;
  automationId: string;
  runId: string;
  triggerSource: string;
  model: string;
  modelKey: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCost: number;
  durationMs: number;
  outputTarget: string;
  skipped: boolean;
  circleName: string;
  memberCount: number;
  checkedInCount: number;
  members: any[];
  notCheckedIn: any[];
  todayCheckIns: any[];
  openTasks: any[];
  completedTasks: any[];
  aiOutput: string;
  resolvedPrompt: string;
  systemPrompt: string;
  logSteps: string[];
  completedAt: string;
}

function buildReportTask(r: ReportInput): { title: string; description: string } {
  const ts = new Date(r.completedAt);
  const dateLabel = ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const timeLabel = ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
  const title = `[Auto] ${r.automationName} - ${dateLabel} ${timeLabel}`;

  const lines: string[] = [];

  // ── Summary ──
  lines.push(`AUTOMATION REPORT: ${r.automationName}`);
  lines.push(`${"=".repeat(50)}`);
  lines.push(`Status: ${r.skipped ? "SKIPPED" : "COMPLETED"}`);
  lines.push(`Trigger: ${r.triggerSource}`);
  lines.push(`Completed: ${dateLabel} at ${timeLabel} ET`);
  lines.push(`Duration: ${(r.durationMs / 1000).toFixed(1)}s`);
  lines.push(`Model: ${r.model} (${r.modelKey})`);
  lines.push(`Tokens: ${r.totalTokens} total (${r.inputTokens} input / ${r.outputTokens} output)`);
  lines.push(`Cost: $${r.estimatedCost.toFixed(4)}`);
  lines.push(`Output routed to: ${r.outputTarget}`);
  lines.push(`Run ID: ${r.runId}`);
  lines.push("");

  // ── Context Analyzed ──
  lines.push(`CONTEXT ANALYZED`);
  lines.push(`${"-".repeat(50)}`);
  lines.push(`Circle: ${r.circleName}`);
  lines.push(`Members: ${r.memberCount} total, ${r.checkedInCount} checked in today`);
  lines.push(`Open tasks: ${r.openTasks.length}`);
  lines.push(`Completed tasks (7d): ${r.completedTasks.length}`);
  lines.push("");

  // Members
  if (r.members.length > 0) {
    lines.push(`MEMBERS REVIEWED (${r.members.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const m of r.members) {
      const streak = m.current_streak || 0;
      const longest = m.longest_streak || 0;
      lines.push(`  ${m.display_name || m.username} (${m.role || "member"}) - ${streak}d streak (best: ${longest}d)`);
    }
    lines.push("");
  }

  // Not checked in
  if (r.notCheckedIn.length > 0) {
    lines.push(`NOT CHECKED IN TODAY (${r.notCheckedIn.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const m of r.notCheckedIn) {
      lines.push(`  - ${m.display_name || m.username}`);
    }
    lines.push("");
  }

  // Check-ins
  if (r.todayCheckIns.length > 0) {
    lines.push(`TODAY'S CHECK-INS (${r.todayCheckIns.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const c of r.todayCheckIns) {
      const who = c.user?.display_name || c.user?.username || "Unknown";
      const when = new Date(c.created_at).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
      lines.push(`  [${when}] ${who}: "${c.content}"`);
    }
    lines.push("");
  }

  // Open tasks
  if (r.openTasks.length > 0) {
    lines.push(`OPEN TASKS REVIEWED (${r.openTasks.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const t of r.openTasks.slice(0, 20)) {
      const who = t.assignee?.display_name || "Unassigned";
      lines.push(`  [${(t.priority || "normal").toUpperCase()}] ${t.title} -> ${who} (${t.status})${t.due_date ? ` due ${t.due_date}` : ""}`);
    }
    lines.push("");
  }

  // Completed tasks
  if (r.completedTasks.length > 0) {
    lines.push(`COMPLETED THIS WEEK (${r.completedTasks.length})`);
    lines.push(`${"-".repeat(50)}`);
    for (const t of r.completedTasks) {
      const who = t.assignee?.display_name || "someone";
      lines.push(`  [done] ${t.title} by ${who}`);
    }
    lines.push("");
  }

  // ── AI Response ──
  lines.push(`AI RESPONSE`);
  lines.push(`${"=".repeat(50)}`);
  lines.push(r.aiOutput);
  lines.push("");

  // ── Execution Log ──
  lines.push(`EXECUTION LOG`);
  lines.push(`${"-".repeat(50)}`);
  for (const step of r.logSteps) {
    lines.push(`  ${step}`);
  }
  lines.push("");

  // ── Prompt ──
  lines.push(`PROMPT SENT TO AI`);
  lines.push(`${"-".repeat(50)}`);
  lines.push(r.resolvedPrompt);

  return { title, description: lines.join("\n") };
}

// ─── Main handler ────────────────────────────────────────────────────────────

interface AutomationRequest {
  automationId: string;
  circleId: string;
  triggerSource: "schedule" | "event" | "manual" | "retry";
  triggeredBy?: string;
  eventPayload?: any;
  retryCount?: number;
}

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 30_000; // 30 seconds

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
    const { automationId, circleId, triggerSource, triggeredBy, eventPayload, retryCount = 0 } = body;

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
    const logSteps: string[] = [];

    // Helper to log a step and update the run record in realtime
    const logStep = async (step: string) => {
      logSteps.push(`[${((Date.now() - startTime) / 1000).toFixed(1)}s] ${step}`);
      if (runId) {
        await supabase
          .from("automation_runs")
          .update({ error_message: logSteps.join("\n") })
          .eq("id", runId)
          .eq("status", "running");
      }
    };

    try {
      // 3. Gather context
      await logStep(`⏳ Gathering context for "${automation.name}"...`);
      const contextFlags: ContextFlags = automation.include_context || {};
      const context = await gatherContext(supabase, circleId, contextFlags);
      await logStep(`✓ Context loaded — ${context.memberCount} members, ${context.checkedInCount} checked in, ${context.openTasks?.length || 0} open tasks`);

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
      await logStep(`✓ Prompt resolved (${resolvedPrompt.length} chars)`);

      // 5. Build system prompt
      const systemPrompt = `You are BlackSwan 🦢 — an AI assistant for "${context.circle?.name || "Unknown"}" circle.
You are running an automated task: "${automation.name}".
Be concise, direct, and actionable. Use real data from the context below.
Always prefix your response with 🦢.

## Circle Context
${contextString}`;

      // 6. Call AI
      const modelKey = automation.model || "claude-haiku";
      const modelId = CLAUDE_MODEL_MAP[modelKey] || CLAUDE_MODEL_MAP["claude-haiku"];
      await logStep(`⏳ Calling ${modelId}...`);
      const aiResult = await callClaude(systemPrompt, resolvedPrompt, modelKey);
      await logStep(`✓ AI responded — ${aiResult.totalTokens} tokens (${aiResult.inputTokens} in / ${aiResult.outputTokens} out) · $${aiResult.estimatedCost.toFixed(4)}`);

      // 7. Route output
      const outputTarget = automation.output_target || "silent";
      if (outputTarget !== "silent") {
        await logStep(`⏳ Routing output → ${outputTarget}...`);
      }
      await routeOutput(
        supabase,
        outputTarget,
        circleId,
        automation.agent || "BlackSwan",
        aiResult.text,
        automation.webhook_url,
        automation.name,
      );
      if (outputTarget !== "silent") {
        await logStep(`✓ Output delivered to ${outputTarget}`);
      }

      // 8. Always log to agent_activity (so it shows in the activity feed)
      const activityBody = `**${automation.name}** (${triggerSource})\n\n${aiResult.text.slice(0, 1500)}\n\n_${aiResult.totalTokens} tokens · ${modelId} · $${aiResult.estimatedCost.toFixed(4)}_`;
      await supabase.from("agent_activity").insert({
        circle_id: circleId,
        agent_name: automation.agent || "BlackSwan",
        source: triggerSource === "manual" ? "webchat" : "cron",
        source_detail: `automation:${automation.name}`,
        activity_type: "task_completed",
        title: `🤖 ${automation.name}`,
        body: activityBody.slice(0, 2000),
        status: "completed",
        metadata: {
          automation_id: automationId,
          run_id: runId,
          model: modelId,
          tokens: aiResult.totalTokens,
          cost: aiResult.estimatedCost,
          trigger: triggerSource,
          output_target: outputTarget,
        },
      });

      // 9. Update run as completed with detailed log
      const durationMs = Date.now() - startTime;
      logSteps.push(`[${(durationMs / 1000).toFixed(1)}s] ✅ Completed successfully`);
      const completedAt = new Date().toISOString();
      await supabase
        .from("automation_runs")
        .update({
          status: "completed",
          completed_at: completedAt,
          duration_ms: durationMs,
          output_text: aiResult.text,
          prompt_used: resolvedPrompt,
          token_count: aiResult.totalTokens,
          model_used: aiResult.model,
          estimated_cost: aiResult.estimatedCost,
          input_context: {
            circle: context.circle?.name,
            memberCount: context.memberCount,
            checkedInCount: context.checkedInCount,
            openTaskCount: context.openTasks?.length || 0,
            log: logSteps,
          },
          output_target: outputTarget,
          error_message: null,
        })
        .eq("id", runId);

      // 10. Update automation metadata
      await supabase
        .from("circle_automations")
        .update({
          last_error: null,
          last_run_at: new Date().toISOString(),
          run_count: (automation.run_count || 0) + 1,
        })
        .eq("id", automationId);

      // 11. Create detailed report task
      await logStep("⏳ Creating report task...");
      const skipped = aiResult.text.trim() === "SKIP";
      const taskCreator = triggeredBy || automation.created_by || null;
      if (taskCreator) {
        const reportTask = buildReportTask({
          automationName: automation.name,
          automationId,
          runId: runId || "unknown",
          triggerSource,
          model: modelId,
          modelKey,
          inputTokens: aiResult.inputTokens,
          outputTokens: aiResult.outputTokens,
          totalTokens: aiResult.totalTokens,
          estimatedCost: aiResult.estimatedCost,
          durationMs,
          outputTarget,
          skipped,
          circleName: context.circle?.name || "Unknown",
          memberCount: context.memberCount,
          checkedInCount: context.checkedInCount,
          members: context.members,
          notCheckedIn: context.notCheckedIn,
          todayCheckIns: context.todayCheckIns,
          openTasks: context.openTasks,
          completedTasks: context.completedTasks,
          aiOutput: aiResult.text,
          resolvedPrompt,
          systemPrompt,
          logSteps,
          completedAt,
        });
        const { data: newTask } = await supabase.from("tasks").insert({
          circle_id: circleId,
          created_by: taskCreator,
          title: reportTask.title,
          description: reportTask.description,
          priority: skipped ? "low" : "normal",
          status: "done",
          completed_at: completedAt,
          position: 99999,
        }).select("id").single();

        // Add the full AI output as a comment on the task
        if (newTask?.id) {
          await supabase.from("task_comments").insert({
            task_id: newTask.id,
            user_id: taskCreator,
            content: `[AUTOMATION_REPORT]\n\n--- AI FULL OUTPUT ---\n${aiResult.text}\n\n--- PROMPT SENT ---\n${resolvedPrompt}\n\n--- SYSTEM PROMPT ---\n${systemPrompt}`,
          });
        }
        await logStep("✓ Report task created");
      }

      return new Response(
        JSON.stringify({ ok: true, runId, durationMs, tokens: aiResult.totalTokens }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );

    } catch (execErr: any) {
      // Update run as failed with detailed log
      const durationMs = Date.now() - startTime;
      logSteps.push(`[${(durationMs / 1000).toFixed(1)}s] ❌ Failed: ${execErr.message}`);

      if (runId) {
        await supabase
          .from("automation_runs")
          .update({
            status: "failed",
            completed_at: new Date().toISOString(),
            duration_ms: durationMs,
            error_message: execErr.message,
            input_context: { log: logSteps },
          })
          .eq("id", runId);
      }

      // Log failure to activity feed
      await supabase.from("agent_activity").insert({
        circle_id: circleId,
        agent_name: automation.agent || "BlackSwan",
        source: triggerSource === "manual" ? "webchat" : "cron",
        source_detail: `automation:${automation.name}`,
        activity_type: "task_completed",
        title: `🤖 ${automation.name}`,
        body: `❌ Failed: ${execErr.message}\n\n${logSteps.join("\n")}`.slice(0, 2000),
        status: "failed",
        metadata: { automation_id: automationId, run_id: runId, trigger: triggerSource },
      });

      // Update automation last_error
      await supabase
        .from("circle_automations")
        .update({ last_error: execErr.message, last_run_at: new Date().toISOString() })
        .eq("id", automationId);

      // Create failure report task
      const failCreator = triggeredBy || automation.created_by || null;
      if (failCreator) {
        const ts = new Date();
        const dateLabel = ts.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        const timeLabel = ts.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/New_York" });
        const failReport = [
          `AUTOMATION FAILED: ${automation.name}`,
          `${"=".repeat(50)}`,
          `Status: FAILED`,
          `Error: ${execErr.message}`,
          `Trigger: ${triggerSource}`,
          `Failed at: ${dateLabel} at ${timeLabel} ET`,
          `Duration: ${(durationMs / 1000).toFixed(1)}s`,
          `Run ID: ${runId || "unknown"}`,
          "",
          `EXECUTION LOG`,
          `${"-".repeat(50)}`,
          ...logSteps.map((s: string) => `  ${s}`),
        ].join("\n");

        await supabase.from("tasks").insert({
          circle_id: circleId,
          created_by: failCreator,
          title: `[Auto] FAILED: ${automation.name} - ${dateLabel} ${timeLabel}`,
          description: failReport,
          priority: "high",
          status: "backlog",
          position: 99999,
        });
      }

      // Retry logic: schedule a retry if under the limit
      if (retryCount < MAX_RETRIES) {
        const nextRetry = retryCount + 1;
        console.log(`Scheduling retry ${nextRetry}/${MAX_RETRIES} for automation ${automationId} in ${RETRY_DELAY_MS}ms`);

        setTimeout(async () => {
          try {
            const supabaseUrl = Deno.env.get("SUPABASE_URL");
            const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
            if (!supabaseUrl || !serviceKey) return;

            await fetch(`${supabaseUrl}/functions/v1/automation-executor`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${serviceKey}`,
              },
              body: JSON.stringify({
                automationId,
                circleId,
                triggerSource: "retry",
                triggeredBy,
                eventPayload,
                retryCount: nextRetry,
              }),
              signal: AbortSignal.timeout(60_000),
            });
          } catch (retryErr) {
            console.error(`Retry ${nextRetry} failed to dispatch:`, retryErr);
          }
        }, RETRY_DELAY_MS);
      }

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
