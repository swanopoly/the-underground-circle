// boss-agent — Jon Snow's heartbeat edge function
//
// Actions:
//   promote_reviewed — auto-promote peer-reviewed tasks with all approvals
//   generate_tasks  — create tasks from goals with auto_task_count
//   detect_stuck    — flag tasks stuck >24h, notify via Telegram if configured
//
// Called by pg_cron via automation-executor or manually from the dashboard.
// Deploy: npx supabase functions deploy boss-agent

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { callClaude as callClaudeShared, logClaudeUsage, checkCircleClaudeBudget } from "../_claude/anthropic.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const TELEGRAM_API = "https://api.telegram.org/bot";

// ─── Model Orchestra Routing ─────────────────────────────────────────────────

const MODEL_MAP: Record<string, string> = {
  "claude-haiku":  "claude-haiku-4-5",
  "claude-sonnet": "claude-sonnet-4-6",
  // Opus points at the latest (4.7) per Rule #3 on canonical model IDs.
  "claude-opus":   "claude-opus-4-7",
};

interface AgentModelConfig {
  name: string;
  preferredModel: string;
  role: string;
}

const AGENT_MODELS: Record<string, AgentModelConfig> = {
  jon:       { name: "Jon Snow",  preferredModel: "claude-sonnet", role: "boss" },
  tyrion:    { name: "Tyrion",    preferredModel: "claude-sonnet", role: "writer" },
  varys:     { name: "Varys",     preferredModel: "claude-sonnet", role: "researcher" },
  daenerys:  { name: "Daenerys",  preferredModel: "claude-opus",   role: "strategist" },
  arya:      { name: "Arya",      preferredModel: "claude-haiku",  role: "executor" },
  sansa:     { name: "Sansa",     preferredModel: "claude-sonnet", role: "designer" },
  sandor:    { name: "Sandor",    preferredModel: "claude-haiku",  role: "reviewer" },
  bran:      { name: "Bran",      preferredModel: "claude-opus",   role: "analyst" },
  samwell:   { name: "Samwell",   preferredModel: "claude-haiku",  role: "writer" },
  petyr:     { name: "Petyr",     preferredModel: "claude-sonnet", role: "strategist" },
  jorah:     { name: "Jorah",     preferredModel: "claude-haiku",  role: "executor" },
  brienne:   { name: "Brienne",   preferredModel: "claude-sonnet", role: "reviewer" },
  grey_worm: { name: "Grey Worm", preferredModel: "claude-haiku",  role: "executor" },
};

function resolveModel(agentId: string): string {
  const agent = AGENT_MODELS[agentId];
  const modelKey = agent?.preferredModel || "claude-haiku";
  return MODEL_MAP[modelKey] || MODEL_MAP["claude-haiku"];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getSupabase() {
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  return createClient(url, key);
}

/**
 * Thin wrapper around the shared `callClaude()`. Returns just the text (legacy
 * call shape) so existing call sites don't need to change, but ALSO fires a
 * `claude_api_usage` log so boss-agent spend is visible in the cost dashboard.
 *
 * Boss-agent is called from automation-executor (cron) so its spend adds up
 * across circles — telemetry here is load-bearing for the Phase 1d audit.
 */
async function callClaude(
  system: string,
  user: string,
  model = "claude-haiku-4-5",
  ctx?: { circleId?: string; source?: string; metadata?: Record<string, unknown>; supabase?: any },
): Promise<string> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");
  // Umbrella circle cap — every agent shares the same 24h spend ceiling.
  // Throws (rejects the call) when the circle is over budget so the
  // caller can surface a clean error to the user / log the denial.
  const supabase = ctx?.supabase ?? getSupabase();
  if (ctx?.circleId) {
    const cap = await checkCircleClaudeBudget(supabase, ctx.circleId);
    if (!cap.allowed) throw new Error(cap.reason || "circle_claude_budget_exceeded");
  }
  const result = await callClaudeShared({
    apiKey,
    model,
    maxTokens: 1024,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = result.content?.[0]?.text || "";
  // Fire-and-forget telemetry — reuses the supabase client resolved
  // above for the budget check.
  logClaudeUsage(supabase, {
    circleId: ctx?.circleId ?? null,
    userId: null,
    source: ctx?.source ?? "boss-agent",
    model,
    usage: result.usage,
    metadata: ctx?.metadata,
  });
  return text;
}

async function sendTelegram(
  botToken: string,
  chatId: string,
  text: string
): Promise<void> {
  await fetch(`${TELEGRAM_API}${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
    }),
  });
}

async function logActivity(
  supabase: any,
  circleId: string,
  agentName: string,
  type: string,
  title: string,
  body: string
) {
  await supabase.from("agent_activity").insert({
    circle_id: circleId,
    agent_name: agentName,
    activity_type: type,
    title,
    body,
  });
}

// ─── Action: Promote Reviewed Tasks ──────────────────────────────────────────

async function promoteReviewed(supabase: any, circleId: string) {
  // Get tasks in peer_review with their goal
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, title, peer_approvals, goal_id")
    .eq("circle_id", circleId)
    .eq("status", "peer_review");

  if (!tasks || tasks.length === 0) return { promoted: 0, pending: 0 };

  // Get goals for assigned_agent_ids
  const goalIds = [...new Set(tasks.map((t: any) => t.goal_id).filter(Boolean))];
  let goalMap: Record<string, string[]> = {};
  if (goalIds.length > 0) {
    const { data: goals } = await supabase
      .from("goals")
      .select("id, assigned_agent_ids")
      .in("id", goalIds);
    for (const g of goals || []) {
      goalMap[g.id] = g.assigned_agent_ids || [];
    }
  }

  let promoted = 0;
  let pending = 0;

  for (const task of tasks) {
    const approvals: string[] = task.peer_approvals || [];
    const requiredReviewers = task.goal_id ? (goalMap[task.goal_id] || []) : [];

    // If no goal or no assigned agents, skip auto-promotion
    if (requiredReviewers.length === 0) {
      pending++;
      continue;
    }

    // Check if all required reviewers have approved
    const allApproved = requiredReviewers.every((agentId: string) =>
      approvals.includes(agentId)
    );

    if (allApproved) {
      // Promote to review
      await supabase
        .from("tasks")
        .update({ status: "review" })
        .eq("id", task.id);

      // Add comment
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      await supabase.from("task_comments").insert({
        task_id: task.id,
        user_id: user?.id || "00000000-0000-0000-0000-000000000000",
        content:
          "[AUTO_PROMOTED] \u{1F43A} Jon Snow promoted this task after all peer reviewers approved.",
      });

      await logActivity(
        supabase,
        circleId,
        "Jon Snow",
        "task_completed",
        `Promoted: ${task.title}`,
        `Task moved from peer_review to review (${approvals.length}/${requiredReviewers.length} approvals)`
      );

      promoted++;
    } else {
      pending++;
    }
  }

  return { promoted, pending };
}

// ─── Action: Generate Tasks from Goals ───────────────────────────────────────

async function generateTasks(supabase: any, circleId: string) {
  // Get active goals with auto_task settings
  const { data: goals } = await supabase
    .from("goals")
    .select("*")
    .eq("circle_id", circleId)
    .eq("status", "active")
    .gt("auto_task_count", 0);

  if (!goals || goals.length === 0) return { generated: 0 };

  let generated = 0;

  for (const goal of goals) {
    const freq = goal.auto_task_frequency || "day";
    const targetCount = goal.auto_task_count || 1;
    const agentIds: string[] = goal.assigned_agent_ids || [];

    // Check how many tasks were created recently for this goal
    const since =
      freq === "week"
        ? new Date(Date.now() - 7 * 86400000).toISOString()
        : new Date(Date.now() - 86400000).toISOString();

    const { count } = await supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("circle_id", circleId)
      .eq("goal_id", goal.id)
      .gte("created_at", since);

    const remaining = targetCount - (count || 0);
    if (remaining <= 0) continue;

    // Get recent tasks for context
    const { data: recentTasks } = await supabase
      .from("tasks")
      .select("title, status, priority")
      .eq("circle_id", circleId)
      .eq("goal_id", goal.id)
      .order("created_at", { ascending: false })
      .limit(15);

    // Get agent names and their preferred models
    let agentNames: Record<string, string> = {};
    let agentModels: Record<string, string> = {};
    if (agentIds.length > 0) {
      const { data: agents } = await supabase
        .from("circle_office_agents")
        .select("id, name")
        .in("id", agentIds);
      for (const a of agents || []) {
        agentNames[a.id] = a.name;
        // Resolve preferred model for this agent
        const config = AGENT_MODELS[a.id];
        agentModels[a.id] = config?.preferredModel || "claude-haiku";
      }
    }

    const aiPrompt = `You are Jon Snow, the Boss agent. Generate exactly ${remaining} new tasks for the goal "${goal.name}".
Goal description: ${goal.description || "No description"}
Existing tasks: ${JSON.stringify((recentTasks || []).map((t: any) => t.title))}
Available agents: ${JSON.stringify(agentNames)}
Agent model assignments: ${JSON.stringify(agentModels)}

Output ONLY a JSON array. Each item: {"title": "...", "description": "...", "priority": "normal|high", "assigned_agent_id": "agent-uuid-here"}
Assign tasks round-robin to the available agents. Match task complexity to the agent's model — give complex/strategic tasks to Opus agents, creative tasks to Sonnet agents, and fast/routine tasks to Haiku agents. Make tasks specific and actionable. Do NOT duplicate existing task titles.`;

    try {
      const result = await callClaude(
        "You generate tasks as JSON arrays. Output ONLY valid JSON, no markdown.",
        aiPrompt,
        "claude-sonnet-4-6",
        { supabase, circleId, source: "boss-agent.generate_tasks", metadata: { goal_id: goal.id } },
      );

      // Parse JSON from response
      const jsonMatch = result.match(/\[[\s\S]*\]/);
      if (!jsonMatch) continue;

      const newTasks = JSON.parse(jsonMatch[0]);

      // Get max position
      const { data: maxPos } = await supabase
        .from("tasks")
        .select("position")
        .eq("circle_id", circleId)
        .eq("status", "backlog")
        .order("position", { ascending: false })
        .limit(1);
      let pos = (maxPos?.[0]?.position || 0) + 1;

      // Get the circle creator for created_by
      const { data: creator } = await supabase
        .from("circle_members")
        .select("user_id")
        .eq("circle_id", circleId)
        .eq("role", "creator")
        .limit(1)
        .single();

      for (const task of newTasks) {
        await supabase.from("tasks").insert({
          circle_id: circleId,
          title: task.title,
          description: task.description || null,
          priority: task.priority || "normal",
          status: "backlog",
          assigned_agent_id: task.assigned_agent_id || null,
          goal_id: goal.id,
          position: pos++,
          created_by: creator?.user_id || "00000000-0000-0000-0000-000000000000",
        });
        generated++;
      }

      await logActivity(
        supabase,
        circleId,
        "Jon Snow",
        "task_started",
        `Generated ${newTasks.length} tasks for "${goal.name}"`,
        newTasks.map((t: any) => `- ${t.title}`).join("\n")
      );

      // Update last_auto_task_at
      await supabase
        .from("goals")
        .update({ last_auto_task_at: new Date().toISOString() })
        .eq("id", goal.id);
    } catch (err) {
      console.error(`Task generation failed for goal ${goal.id}:`, err);
    }
  }

  return { generated };
}

// ─── Action: Detect Stuck Tasks ──────────────────────────────────────────────

async function detectStuck(
  supabase: any,
  circleId: string,
  telegramConfig?: { botToken: string; chatId: string }
) {
  const threshold = new Date(Date.now() - 24 * 3600000).toISOString();

  const { data: stuckTasks } = await supabase
    .from("tasks")
    .select(
      "id, title, status, assigned_to, assigned_agent_id, updated_at"
    )
    .eq("circle_id", circleId)
    .in("status", ["in_progress", "peer_review", "review"])
    .lt("updated_at", threshold)
    .order("updated_at", { ascending: true });

  if (!stuckTasks || stuckTasks.length === 0) return { stuck: 0 };

  const stuckList = stuckTasks.map((t: any) => {
    const hrs = Math.round(
      (Date.now() - new Date(t.updated_at).getTime()) / 3600000
    );
    return `- "${t.title}" stuck in ${t.status} for ${hrs}h`;
  });

  await logActivity(
    supabase,
    circleId,
    "Jon Snow",
    "task_failed",
    `${stuckTasks.length} stuck task(s) detected`,
    stuckList.join("\n")
  );

  // Send Telegram notification if configured
  if (telegramConfig?.botToken && telegramConfig?.chatId) {
    const msg =
      `\u{1F43A} *Jon Snow — Stuck Task Alert*\n\n` +
      `${stuckTasks.length} task(s) stuck for 24+ hours:\n\n` +
      stuckList.join("\n") +
      `\n\nPlease review in the dashboard.`;

    try {
      await sendTelegram(
        telegramConfig.botToken,
        telegramConfig.chatId,
        msg
      );
    } catch (err) {
      console.error("Telegram send failed:", err);
    }
  }

  return { stuck: stuckTasks.length };
}

// ─── Action: Model Council (parallel multi-model peer review) ────────────────

async function modelCouncil(supabase: any, circleId: string, taskId: string) {
  // Get the task
  const { data: task } = await supabase
    .from("tasks")
    .select("id, title, description, status, goal_id, peer_approvals")
    .eq("id", taskId)
    .single();

  if (!task) return { error: "Task not found" };
  if (task.status !== "peer_review") return { error: "Task not in peer_review" };

  // Get goal's assigned agents for reviewer list
  let reviewerAgentIds: string[] = [];
  if (task.goal_id) {
    const { data: goal } = await supabase
      .from("goals")
      .select("assigned_agent_ids")
      .eq("id", task.goal_id)
      .single();
    reviewerAgentIds = goal?.assigned_agent_ids || [];
  }

  if (reviewerAgentIds.length === 0) return { reviews: 0 };

  // Run reviews in parallel — each agent uses their preferred model
  const reviews = await Promise.all(
    reviewerAgentIds.map(async (agentId: string) => {
      const agentConfig = AGENT_MODELS[agentId];
      if (!agentConfig) return null;

      const model = resolveModel(agentId);
      const systemPrompt = `You are ${agentConfig.name}, a ${agentConfig.role} reviewing work. Be concise and constructive. Give specific, actionable feedback in 2-4 sentences.`;
      const userPrompt = `Review this task:\nTitle: ${task.title}\nDescription: ${task.description || "No description"}\n\nProvide your review as ${agentConfig.name} (${agentConfig.role}).`;

      try {
        const review = await callClaude(systemPrompt, userPrompt, model, {
          supabase, circleId, source: "boss-agent.model_council",
          metadata: { agent_id: agentId, task_id: task.id },
        });
        return { agentId, agentName: agentConfig.name, model: agentConfig.preferredModel, review };
      } catch (err) {
        console.error(`Council review failed for ${agentConfig.name}:`, err);
        return null;
      }
    })
  );

  // Post each review as a comment
  const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  const userId = user?.id || "00000000-0000-0000-0000-000000000000";
  let posted = 0;

  for (const r of reviews) {
    if (!r) continue;
    await supabase.from("task_comments").insert({
      task_id: taskId,
      user_id: userId,
      agent_id: r.agentId,
      content: `[COUNCIL_REVIEW] ${r.agentName} (${r.model}): ${r.review}`,
    });
    posted++;
  }

  await logActivity(
    supabase,
    circleId,
    "Jon Snow",
    "task_started",
    `Model Council reviewed: ${task.title}`,
    `${posted} agents reviewed in parallel using their preferred models`
  );

  return { reviews: posted };
}

// ─── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      circle_id,
      action,
      task_id,
      telegram_config,
    }: {
      circle_id: string;
      action: "promote_reviewed" | "generate_tasks" | "detect_stuck" | "model_council" | "all";
      task_id?: string;
      telegram_config?: { botToken: string; chatId: string };
    } = body;

    if (!circle_id) {
      return new Response(
        JSON.stringify({ error: "circle_id required" }),
        { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }
      );
    }

    const supabase = getSupabase();
    const results: Record<string, any> = {};

    if (action === "promote_reviewed" || action === "all") {
      results.promote = await promoteReviewed(supabase, circle_id);
    }

    if (action === "generate_tasks" || action === "all") {
      results.generate = await generateTasks(supabase, circle_id);
    }

    if (action === "detect_stuck" || action === "all") {
      results.stuck = await detectStuck(supabase, circle_id, telegram_config);
    }

    if (action === "model_council") {
      if (!task_id) {
        return new Response(
          JSON.stringify({ error: "task_id required for model_council" }),
          { status: 400, headers: { ...corsHeaders, "content-type": "application/json" } }
        );
      }
      results.council = await modelCouncil(supabase, circle_id, task_id);
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "content-type": "application/json" },
    });
  } catch (err) {
    console.error("boss-agent error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "content-type": "application/json" } }
    );
  }
});
