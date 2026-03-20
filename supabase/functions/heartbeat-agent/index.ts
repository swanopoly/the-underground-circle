// ═══════════════════════════════════════════════════════════════════════════════
//  Heartbeat Agent — Autonomous AI daemon that proactively manages circles
//  Inspired by OpenClaw's heartbeat system: runs on a schedule, reads circle
//  state, and takes action without being prompted.
//
//  Trigger: pg_cron every 30 minutes, or manual invocation
//  For each active circle with heartbeat enabled:
//    1. Gather full state (tasks, members, check-ins, GitHub events, streaks)
//    2. Call Claude with tool_use enabled
//    3. BlackSwan decides what needs attention and acts via tools
// ═══════════════════════════════════════════════════════════════════════════════

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── Tool Definitions (same as swanbot-ai) ──────────────────────────────────

const HEARTBEAT_TOOLS = [
  {
    name: "create_task",
    description: "Create a new task on the Kanban board when you identify work that needs doing.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Task title" },
        description: { type: "string", description: "Task description" },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        status: { type: "string", enum: ["backlog", "todo"] },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Update a task's status or priority. Flag stuck tasks, escalate blocked work.",
    input_schema: {
      type: "object",
      properties: {
        task_id: { type: "string" },
        status: { type: "string", enum: ["backlog", "todo", "in_progress", "peer_review", "review", "done"] },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
      },
      required: ["task_id"],
    },
  },
  {
    name: "post_activity",
    description: "Post a proactive update, alert, or summary to the circle activity feed.",
    input_schema: {
      type: "object",
      properties: {
        content: { type: "string", description: "Message content (markdown)" },
        type: { type: "string", enum: ["info", "alert", "celebration", "summary"] },
      },
      required: ["content"],
    },
  },
  {
    name: "store_memory",
    description: "Store an observation or pattern for future reference.",
    input_schema: {
      type: "object",
      properties: {
        key: { type: "string" },
        value: { type: "string" },
        category: { type: "string", enum: ["circle_pattern", "topic_context", "gotcha", "general"] },
        importance: { type: "number" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "nudge_member",
    description: "Send a nudge/reminder to a specific member via activity feed mention.",
    input_schema: {
      type: "object",
      properties: {
        member_name: { type: "string", description: "Display name or username of the member" },
        message: { type: "string", description: "Nudge message" },
        reason: { type: "string", description: "Why you're nudging (streak risk, stuck task, etc.)" },
      },
      required: ["member_name", "message"],
    },
  },
];

async function executeHeartbeatTool(
  toolName: string,
  toolInput: any,
  supabase: any,
  circleId: string,
): Promise<string> {
  try {
    switch (toolName) {
      case "create_task": {
        const { title, description, priority, status } = toolInput;
        const { data, error } = await supabase.from("tasks").insert({
          circle_id: circleId,
          title,
          description: description || null,
          priority: priority || "normal",
          status: status || "todo",
          created_by: "00000000-0000-0000-0000-000000000000", // system user
          position: Date.now(),
        }).select("id, title").single();
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true, task: data });
      }

      case "update_task": {
        const { task_id, ...updates } = toolInput;
        const updateData: any = {};
        if (updates.status) updateData.status = updates.status;
        if (updates.priority) updateData.priority = updates.priority;
        if (updates.status === "done") updateData.completed_at = new Date().toISOString();
        const { error } = await supabase.from("tasks").update(updateData).eq("id", task_id);
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true });
      }

      case "post_activity": {
        const { content, type } = toolInput;
        const { error } = await supabase.from("circle_activity").insert({
          circle_id: circleId,
          type: type || "info",
          content: `🦢 **[Heartbeat]** ${content}`,
          is_bot: true,
        });
        if (error) return JSON.stringify({ error: error.message });
        return JSON.stringify({ success: true });
      }

      case "store_memory": {
        const { key, value, category, importance } = toolInput;
        await supabase.from("blackswan_memory").upsert({
          circle_id: circleId,
          key: `heartbeat_${key}`,
          value,
          category: category || "circle_pattern",
          importance: importance || 5,
          updated_at: new Date().toISOString(),
        }, { onConflict: "circle_id,key" });
        return JSON.stringify({ success: true });
      }

      case "nudge_member": {
        const { member_name, message } = toolInput;
        await supabase.from("circle_activity").insert({
          circle_id: circleId,
          type: "alert",
          content: `🦢 **@${member_name}** — ${message}`,
          is_bot: true,
        });
        return JSON.stringify({ success: true, nudged: member_name });
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

// ─── Gather Circle State ────────────────────────────────────────────────────

async function gatherHeartbeatContext(supabase: any, circleId: string) {
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 86400000).toISOString();
  const threeDaysAgo = new Date(now.getTime() - 259200000).toISOString();

  // Parallel queries
  const [
    circleRes,
    membersRes,
    tasksRes,
    recentCheckInsRes,
    githubEventsRes,
    recentActivityRes,
    memoriesRes,
  ] = await Promise.all([
    supabase.from("circles").select("name, description").eq("id", circleId).single(),
    supabase.from("circle_members")
      .select("user_id, role, profiles(display_name, username, current_streak, longest_streak, last_check_in)")
      .eq("circle_id", circleId),
    supabase.from("tasks")
      .select("id, title, status, priority, assigned_agent_id, created_at, completed_at")
      .eq("circle_id", circleId)
      .neq("status", "done")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.from("check_ins")
      .select("user_id, content, created_at")
      .eq("circle_id", circleId)
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("circle_github_events")
      .select("event_type, action, title, author, created_at")
      .eq("circle_id", circleId)
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase.from("circle_activity")
      .select("content, type, is_bot, created_at")
      .eq("circle_id", circleId)
      .gte("created_at", oneDayAgo)
      .order("created_at", { ascending: false })
      .limit(5),
    supabase.from("blackswan_memory")
      .select("key, value, category, importance")
      .eq("circle_id", circleId)
      .order("importance", { ascending: false })
      .limit(10),
  ]);

  const members = (membersRes.data || []).map((m: any) => ({
    user_id: m.user_id,
    role: m.role,
    display_name: m.profiles?.display_name || m.profiles?.username || "Unknown",
    current_streak: m.profiles?.current_streak || 0,
    longest_streak: m.profiles?.longest_streak || 0,
    last_check_in: m.profiles?.last_check_in,
  }));

  // Identify at-risk members (haven't checked in recently)
  const atRiskMembers = members.filter((m: any) => {
    if (!m.last_check_in) return m.current_streak > 0; // Has a streak but never checked in
    const lastCheckIn = new Date(m.last_check_in);
    const hoursSince = (now.getTime() - lastCheckIn.getTime()) / 3600000;
    return m.current_streak >= 3 && hoursSince > 20; // 3+ day streak and no check-in in 20+ hours
  });

  // Identify stuck tasks (in_progress for 24+ hours with no updates)
  const stuckTasks = (tasksRes.data || []).filter((t: any) => {
    if (t.status !== "in_progress") return false;
    const created = new Date(t.created_at);
    return (now.getTime() - created.getTime()) > 86400000;
  });

  // Tasks waiting for review
  const reviewTasks = (tasksRes.data || []).filter((t: any) =>
    t.status === "peer_review" || t.status === "review"
  );

  return {
    circle: circleRes.data,
    members,
    totalMembers: members.length,
    checkedInToday: (recentCheckInsRes.data || []).length,
    recentCheckIns: recentCheckInsRes.data || [],
    allTasks: tasksRes.data || [],
    stuckTasks,
    reviewTasks,
    atRiskMembers,
    githubEvents: githubEventsRes.data || [],
    recentActivity: recentActivityRes.data || [],
    memories: memoriesRes.data || [],
    timestamp: now.toISOString(),
  };
}

// ─── Call Claude with Heartbeat Context ─────────────────────────────────────

async function runHeartbeat(supabase: any, circleId: string) {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const ctx = await gatherHeartbeatContext(supabase, circleId);
  if (!ctx.circle) return { skipped: true, reason: "Circle not found" };
  if (ctx.totalMembers === 0) return { skipped: true, reason: "No members" };

  // Build the heartbeat prompt
  const systemPrompt = `You are BlackSwan's Heartbeat — an autonomous daemon that monitors circle health and takes proactive action.

## Your Mission
Every 30 minutes, you wake up and check on the circle. You look for:
1. **Streak risks** — Members with long streaks who haven't checked in today
2. **Stuck tasks** — Work that's been in_progress too long without movement
3. **Review bottlenecks** — Tasks waiting for review that nobody's looking at
4. **Wins to celebrate** — Completed tasks, new streaks, GitHub activity worth highlighting
5. **Patterns** — Recurring issues, team habits, things worth remembering

## Rules
- Only act when there's something meaningful to do. If everything looks fine, do nothing.
- Don't spam. Max 2-3 actions per heartbeat. Quality over quantity.
- Be specific and actionable. "Ship it" is better than "please review when you get a chance."
- Celebrate real wins. Don't manufacture positivity.
- Nudge gently. You're a helpful assistant, not a micromanager.
- Store memories only for genuinely useful patterns you observe.

## Tools Available
Use your tools to take action:
- **post_activity**: Post updates, alerts, or celebrations to the circle feed
- **create_task**: Create tasks when you identify work that needs to happen
- **update_task**: Escalate stuck tasks, reprioritize based on context
- **store_memory**: Remember patterns you observe for future heartbeats
- **nudge_member**: Send a targeted reminder to a specific member

If nothing needs attention, respond with just "All clear." and take no actions.`;

  const userMessage = `## Heartbeat Check — ${new Date().toLocaleString("en-US", { timeZone: "America/New_York" })}

### Circle: ${ctx.circle.name}
${ctx.circle.description || "No description"}

### Members (${ctx.totalMembers})
${ctx.members.map((m: any) => `- ${m.display_name} — ${m.current_streak} day streak${m.last_check_in ? `, last check-in: ${new Date(m.last_check_in).toLocaleDateString()}` : ", never checked in"}`).join("\n")}

### Check-ins Today: ${ctx.checkedInToday}/${ctx.totalMembers}
${ctx.recentCheckIns.length > 0 ? ctx.recentCheckIns.map((c: any) => `- "${(c.content || "").slice(0, 80)}"`).join("\n") : "None yet."}

### At-Risk Streaks (${ctx.atRiskMembers.length})
${ctx.atRiskMembers.length > 0 ? ctx.atRiskMembers.map((m: any) => `- ⚠️ ${m.display_name} — ${m.current_streak} day streak at risk!`).join("\n") : "None."}

### Open Tasks (${ctx.allTasks.length})
${ctx.allTasks.slice(0, 15).map((t: any) => `- [${t.status}] ${t.title} (${t.priority})`).join("\n") || "None."}

### Stuck Tasks (in_progress > 24h): ${ctx.stuckTasks.length}
${ctx.stuckTasks.map((t: any) => `- ⚠️ "${t.title}" — stuck since ${new Date(t.created_at).toLocaleDateString()}`).join("\n") || "None."}

### Awaiting Review: ${ctx.reviewTasks.length}
${ctx.reviewTasks.map((t: any) => `- 👀 "${t.title}"`).join("\n") || "None."}

### Recent GitHub Activity
${ctx.githubEvents.length > 0 ? ctx.githubEvents.map((e: any) => `- ${e.event_type}: ${e.title || e.action} by ${e.author}`).join("\n") : "None."}

### Recent Heartbeat Activity
${ctx.recentActivity.filter((a: any) => a.is_bot).length > 0 ? ctx.recentActivity.filter((a: any) => a.is_bot).map((a: any) => `- ${(a.content || "").slice(0, 80)}`).join("\n") : "No recent bot activity."}

### Memories
${ctx.memories.length > 0 ? ctx.memories.map((m: any) => `- [${m.category}] ${m.value}`).join("\n") : "None stored yet."}

What needs attention? Take action if needed, or say "All clear." if everything is fine.`;

  // Call Claude with tools
  const messages: any[] = [{ role: "user", content: userMessage }];
  const actions: any[] = [];

  for (let iteration = 0; iteration < 3; iteration++) {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
        messages,
        tools: HEARTBEAT_TOOLS,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error(`Heartbeat Claude error: ${err}`);
      break;
    }

    const data = await response.json();
    const toolUseBlocks = (data.content || []).filter((b: any) => b.type === "tool_use");

    if (toolUseBlocks.length === 0 || data.stop_reason !== "tool_use") {
      // Extract final text
      const text = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      actions.push({ type: "response", text });
      break;
    }

    // Execute tools
    messages.push({ role: "assistant", content: data.content });
    const toolResults: any[] = [];

    for (const toolBlock of toolUseBlocks) {
      const result = await executeHeartbeatTool(toolBlock.name, toolBlock.input, supabase, circleId);
      actions.push({ tool: toolBlock.name, input: toolBlock.input, result: JSON.parse(result) });
      toolResults.push({ type: "tool_result", tool_use_id: toolBlock.id, content: result });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Log the heartbeat run
  try {
    await supabase.from("automation_runs").insert({
      circle_id: circleId,
      automation_id: null,
      status: "completed",
      input_context: { type: "heartbeat", actions, context_summary: {
        members: ctx.totalMembers,
        checked_in: ctx.checkedInToday,
        at_risk: ctx.atRiskMembers.length,
        stuck: ctx.stuckTasks.length,
        review: ctx.reviewTasks.length,
      }},
      output: actions.map((a: any) => a.text || `${a.tool}(${JSON.stringify(a.input).slice(0, 100)})`).join("\n"),
      started_at: ctx.timestamp,
      completed_at: new Date().toISOString(),
    });
  } catch { /* non-critical */ }

  return { circleId, actions, summary: {
    members: ctx.totalMembers,
    checkedIn: ctx.checkedInToday,
    atRisk: ctx.atRiskMembers.length,
    stuckTasks: ctx.stuckTasks.length,
    reviewTasks: ctx.reviewTasks.length,
    actionsCount: actions.length,
  }};
}

// ─── Main Handler ───────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Accept either a specific circleId or run for all active circles
    let circleIds: string[] = [];

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body.circleId) {
        circleIds = [body.circleId];
      }
    }

    // If no specific circle, get all circles with recent activity
    if (circleIds.length === 0) {
      const threeDaysAgo = new Date(Date.now() - 259200000).toISOString();
      const { data: activeCircles } = await supabase
        .from("circle_members")
        .select("circle_id")
        .gte("joined_at", threeDaysAgo)
        .limit(50);

      // Deduplicate
      const seen = new Set<string>();
      for (const c of (activeCircles || [])) {
        if (!seen.has(c.circle_id)) {
          seen.add(c.circle_id);
          circleIds.push(c.circle_id);
        }
      }

      // Also get circles with recent check-ins (more reliable activity signal)
      const { data: recentCheckins } = await supabase
        .from("check_ins")
        .select("circle_id")
        .gte("created_at", threeDaysAgo)
        .limit(100);
      for (const c of (recentCheckins || [])) {
        if (!seen.has(c.circle_id)) {
          seen.add(c.circle_id);
          circleIds.push(c.circle_id);
        }
      }
    }

    // Cap at 10 circles per invocation to stay within edge function limits
    circleIds = circleIds.slice(0, 10);

    const results = [];
    for (const cid of circleIds) {
      try {
        const result = await runHeartbeat(supabase, cid);
        results.push(result);
      } catch (e: any) {
        results.push({ circleId: cid, error: e.message });
      }
    }

    return new Response(
      JSON.stringify({ heartbeats: results, circlesProcessed: circleIds.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("[heartbeat-agent] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
