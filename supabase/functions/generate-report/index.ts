// Generate Report — Creates PDF/CSV reports from analytics, goals, and check-ins
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { getAuthenticatedUser, isServiceRoleRequest } from "../_shared/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { reportId, orgId } = await req.json();

    if (!reportId || !orgId) {
      return new Response(
        JSON.stringify({ error: "Missing reportId or orgId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Authorization ──────────────────────────────────────────────────────
    // Reports aggregate cross-circle analytics + per-user check-ins for an org
    // and run under the service role. Require either a trusted service-role
    // caller (cron) or an authenticated user who is a member of the target org.
    // Without this, anyone could POST a reportId + orgId and receive another
    // org's data.
    if (!isServiceRoleRequest(req)) {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) {
        return new Response(
          JSON.stringify({ error: "Authentication required", code: "unauthenticated" }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const { data: membership } = await supabase
        .from("org_members")
        .select("user_id")
        .eq("org_id", orgId)
        .eq("user_id", authUser.id)
        .maybeSingle();
      if (!membership) {
        return new Response(
          JSON.stringify({ error: "Not authorized for this organization", code: "forbidden" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Get report details
    const { data: report } = await supabase
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .single();

    if (!report) {
      return new Response(
        JSON.stringify({ error: "Report not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark as generating
    await supabase
      .from("reports")
      .update({ status: "generating" })
      .eq("id", reportId);

    // Gather data based on report type
    const circleIds = report.metadata?.circle_ids;
    let reportData: Record<string, any> = {};

    // Get org circles
    const circleQuery = supabase
      .from("circles")
      .select("id, name, member_count")
      .eq("org_id", orgId);
    if (circleIds?.length) circleQuery.in("id", circleIds);
    const { data: circles } = await circleQuery;

    if (report.report_type === "analytics" || report.report_type === "comprehensive") {
      const { data: analytics } = await supabase
        .from("circle_analytics_daily")
        .select("*")
        .in("circle_id", (circles || []).map(c => c.id))
        .gte("date", report.date_from)
        .lte("date", report.date_to)
        .order("date", { ascending: true });

      reportData.analytics = analytics || [];
    }

    if (report.report_type === "goals" || report.report_type === "comprehensive") {
      const { data: goals } = await supabase
        .from("org_goals")
        .select("*")
        .eq("org_id", orgId);

      reportData.goals = goals || [];
    }

    if (report.report_type === "engagement" || report.report_type === "comprehensive") {
      const { data: checkIns } = await supabase
        .from("check_ins")
        .select("user_id, circle_id, created_at")
        .in("circle_id", (circles || []).map(c => c.id))
        .gte("created_at", report.date_from)
        .lte("created_at", report.date_to);

      reportData.checkIns = checkIns || [];
    }

    // Generate CSV content
    let content: string;
    const fileName = `report_${report.report_type}_${report.date_from}_${report.date_to}`;

    if (report.format === "csv") {
      content = generateCSV(report.report_type, reportData, circles || []);
    } else {
      // For PDF, generate an HTML representation that could be converted
      content = generateHTMLReport(report.report_type, reportData, circles || []);
    }

    // Store in Supabase Storage
    const ext = report.format === "csv" ? "csv" : "html";
    const filePath = `reports/${orgId}/${fileName}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from("reports")
      .upload(filePath, new Blob([content]), {
        contentType: report.format === "csv" ? "text/csv" : "text/html",
        upsert: true,
      });

    if (uploadError) {
      await supabase
        .from("reports")
        .update({ status: "failed" })
        .eq("id", reportId);

      return new Response(
        JSON.stringify({ error: uploadError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get a time-limited SIGNED URL. The `reports` bucket MUST be private — a
    // public bucket leaves report files readable by anyone who can guess the
    // path (reports/{orgId}/{type}_{dates}). Signed URLs scope + expire access.
    const { data: urlData, error: signErr } = await supabase.storage
      .from("reports")
      .createSignedUrl(filePath, 60 * 60 * 24 * 7); // 7 days

    if (signErr || !urlData?.signedUrl) {
      await supabase.from("reports").update({ status: "failed" }).eq("id", reportId);
      return new Response(
        JSON.stringify({ error: signErr?.message || "could not sign report URL" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const fileUrl = urlData.signedUrl;

    // Update report with URL
    await supabase
      .from("reports")
      .update({
        status: "ready",
        file_url: fileUrl,
      })
      .eq("id", reportId);

    return new Response(
      JSON.stringify({ success: true, url: fileUrl }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Report generation error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function generateCSV(reportType: string, data: Record<string, any>, circles: any[]): string {
  const rows: string[] = [];

  if (data.analytics?.length) {
    rows.push("Date,Circle,Active Members,Check-ins,Messages,Avg Streak,Tasks Completed");
    for (const row of data.analytics) {
      const circle = circles.find(c => c.id === row.circle_id);
      rows.push(`${row.date},${circle?.name || row.circle_id},${row.active_members},${row.total_check_ins},${row.total_messages},${row.avg_streak},${row.tasks_completed}`);
    }
  }

  if (data.goals?.length) {
    if (rows.length) rows.push("");
    rows.push("Goal Type,Title,Status,Target,Current,Unit");
    for (const goal of data.goals) {
      rows.push(`${goal.goal_type},${goal.title},${goal.status},${goal.target_value || ""},${goal.current_value || 0},${goal.unit || ""}`);
    }
  }

  if (data.checkIns?.length) {
    if (rows.length) rows.push("");
    rows.push("User ID,Circle ID,Date");
    for (const ci of data.checkIns) {
      rows.push(`${ci.user_id},${ci.circle_id},${ci.created_at}`);
    }
  }

  return rows.join("\n");
}

function generateHTMLReport(reportType: string, data: Record<string, any>, circles: any[]): string {
  let sections = "";

  if (data.analytics?.length) {
    const totalCheckins = data.analytics.reduce((s: number, r: any) => s + r.total_check_ins, 0);
    const avgStreak = data.analytics.reduce((s: number, r: any) => s + Number(r.avg_streak), 0) / data.analytics.length;

    sections += `
    <div class="section">
      <h2>Analytics Summary</h2>
      <div class="metrics">
        <div class="metric"><span class="value">${totalCheckins}</span><span class="label">Total Check-ins</span></div>
        <div class="metric"><span class="value">${avgStreak.toFixed(1)}</span><span class="label">Avg Streak</span></div>
        <div class="metric"><span class="value">${data.analytics.length}</span><span class="label">Data Points</span></div>
      </div>
    </div>`;
  }

  if (data.goals?.length) {
    const goalRows = data.goals.map((g: any) => `
      <tr><td>${g.goal_type}</td><td>${g.title}</td><td>${g.status}</td>
      <td>${g.current_value || 0}/${g.target_value || "-"} ${g.unit || ""}</td></tr>
    `).join("");

    sections += `
    <div class="section">
      <h2>Goals</h2>
      <table><tr><th>Type</th><th>Title</th><th>Status</th><th>Progress</th></tr>${goalRows}</table>
    </div>`;
  }

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Report</title>
<style>
  body { font-family: monospace; background: #0a0a0a; color: #fff; padding: 40px; max-width: 800px; margin: 0 auto; }
  h1 { color: #6366f1; } h2 { color: #ccc; border-bottom: 1px solid #1a1a2e; padding-bottom: 8px; }
  .metrics { display: flex; gap: 20px; }
  .metric { background: #111; border: 1px solid #1a1a2e; border-radius: 8px; padding: 16px; text-align: center; }
  .value { display: block; font-size: 24px; font-weight: bold; color: #6366f1; }
  .label { font-size: 12px; color: #888; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #1a1a2e; }
  th { color: #888; } .section { margin-bottom: 32px; }
</style></head>
<body><h1>The Underground Circle — Report</h1><p style="color:#888">${reportType} report</p>${sections}</body></html>`;
}
