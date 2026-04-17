// Aggregate Analytics — Supabase Edge Function (daily cron)
// Computes daily rollups for each circle into circle_analytics_daily

import {
  corsHeaders,
  createServiceRoleClient,
  errResponse,
  jsonResponse,
} from "../_shared/edge.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createServiceRoleClient();

    const today = new Date().toISOString().split("T")[0];
    const todayStart = `${today}T00:00:00Z`;
    const todayEnd = `${today}T23:59:59Z`;

    // Get all circles
    const { data: circles } = await supabase
      .from("circles")
      .select("id");

    if (!circles || circles.length === 0) {
      return jsonResponse({ processed: 0 });
    }

    let processed = 0;

    for (const circle of circles) {
      const cid = circle.id;

      // Count check-ins today
      const { count: checkIns } = await supabase
        .from("check_ins")
        .select("*", { count: "exact", head: true })
        .eq("circle_id", cid)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd);

      // Count messages today
      const { count: messages } = await supabase
        .from("messages")
        .select("*", { count: "exact", head: true })
        .eq("circle_id", cid)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd);

      // Active members (posted a message or check-in today)
      const { data: checkInUsers } = await supabase
        .from("check_ins")
        .select("user_id")
        .eq("circle_id", cid)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd);

      const { data: msgUsers } = await supabase
        .from("messages")
        .select("user_id")
        .eq("circle_id", cid)
        .eq("is_bot", false)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd);

      const activeUserIds = new Set([
        ...(checkInUsers || []).map(u => u.user_id),
        ...(msgUsers || []).map(u => u.user_id),
      ]);

      // Average streak of members
      const { data: members } = await supabase
        .from("circle_members")
        .select("user:profiles(current_streak)")
        .eq("circle_id", cid);

      const streaks = (members || []).map((m: any) => m.user?.current_streak || 0);
      const avgStreak = streaks.length > 0
        ? streaks.reduce((a: number, b: number) => a + b, 0) / streaks.length
        : 0;

      // Tasks completed/created today
      const { count: tasksCompleted } = await supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("circle_id", cid)
        .eq("status", "done")
        .gte("completed_at", todayStart)
        .lte("completed_at", todayEnd);

      const { count: tasksCreated } = await supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("circle_id", cid)
        .gte("created_at", todayStart)
        .lte("created_at", todayEnd);

      // Aggregate agent token data for this circle
      const { data: circleAgents } = await supabase
        .from("circle_office_agents")
        .select("token_usage_today, estimated_cost_today")
        .eq("circle_id", cid);

      const agentTokensTotal = (circleAgents || []).reduce(
        (sum: number, a: any) => sum + (a.token_usage_today || 0), 0
      );
      const agentCostTotal = (circleAgents || []).reduce(
        (sum: number, a: any) => sum + parseFloat(a.estimated_cost_today || "0"), 0
      );

      // Upsert daily analytics
      await supabase.from("circle_analytics_daily").upsert({
        circle_id: cid,
        date: today,
        active_members: activeUserIds.size,
        total_check_ins: checkIns || 0,
        total_messages: messages || 0,
        avg_streak: Math.round(avgStreak * 100) / 100,
        tasks_completed: tasksCompleted || 0,
        tasks_created: tasksCreated || 0,
        agent_tokens_total: agentTokensTotal,
        agent_cost_total: Math.round(agentCostTotal * 10000) / 10000,
      }, { onConflict: "circle_id,date" });

      processed++;
    }

    return jsonResponse({ processed, date: today });
  } catch (error: any) {
    console.error("Aggregate analytics error:", error);
    return errResponse(500, "internal", error?.message || "Internal server error");
  }
});
