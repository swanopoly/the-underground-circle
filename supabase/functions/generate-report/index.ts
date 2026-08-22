// Generate Report — Creates PDF/CSV reports from analytics, goals, and check-ins
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";
import { getAuthenticatedUser, isServiceRoleRequest } from "../_shared/edge.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const REPORT_SIGNED_URL_TTL_SECONDS = 60 * 60;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reportJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

function requestedCircleIds(metadata: unknown): string[] | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return [];
  const value = (metadata as Record<string, unknown>).circle_ids;
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 100) return null;
  const ids = value.map((id) => typeof id === "string" ? id.trim().toLowerCase() : "");
  if (ids.some((id) => !UUID_PATTERN.test(id))) return null;
  return [...new Set(ids)];
}

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

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabase = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── Authorization ──────────────────────────────────────────────────────
    // Reports aggregate cross-circle analytics + per-user check-ins for an org
    // and run under the service role. Require either a trusted service-role
    // caller (cron) or an authenticated user who is a member of the target org.
    // Without this, anyone could POST a reportId + orgId and receive another
    // org's data.
    const serviceRoleCaller = isServiceRoleRequest(req);
    let authUserId: string | null = null;
    let callerSupabase: ReturnType<typeof createClient> | null = null;
    if (!serviceRoleCaller) {
      const authUser = await getAuthenticatedUser(req);
      if (!authUser) {
        return reportJson({ error: "Authentication required", code: "unauthenticated" }, 401);
      }
      authUserId = authUser.id;
      const { data: membership } = await supabase
        .from("org_members")
        .select("user_id")
        .eq("org_id", orgId)
        .eq("user_id", authUser.id)
        .maybeSingle();
      if (!membership) {
        return reportJson({ error: "Not authorized for this organization", code: "forbidden" }, 403);
      }
      const authorization = req.headers.get("Authorization") || req.headers.get("authorization") || "";
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
      if (!authorization || !anonKey) {
        return reportJson({ error: "Report authorization is unavailable", code: "authority_unavailable" }, 503);
      }
      callerSupabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authorization } },
        auth: { persistSession: false },
      });
    }

    // Get report details
    const { data: report } = await supabase
      .from("reports")
      .select("*")
      .eq("id", reportId)
      .eq("org_id", orgId)
      .single();

    if (!report) {
      return reportJson({ error: "Report not found" }, 404);
    }
    if (!serviceRoleCaller && report.created_by !== authUserId) {
      return reportJson({ error: "Report not found or not owned by caller", code: "forbidden" }, 403);
    }

    // Gather data based on report type
    const configuredCircleIds = requestedCircleIds(report.metadata);
    if (configuredCircleIds === null) {
      return reportJson({ error: "Report Circle selection is invalid", code: "validation" }, 400);
    }
    let circleIds = configuredCircleIds;
    let reportData: Record<string, any> = {};

    if (!serviceRoleCaller) {
      const { data: memberRows, error: memberError } = await supabase
        .from("circle_members")
        .select("circle_id")
        .eq("user_id", authUserId!);
      if (memberError) {
        return reportJson({ error: "Report Circle access could not be verified", code: "authority_unavailable" }, 503);
      }
      const authorizedIds = new Set(
        (memberRows || [])
          .map((row: { circle_id?: unknown }) => typeof row.circle_id === "string" ? row.circle_id : null)
          .filter((id: string | null): id is string => Boolean(id)),
      );
      if (circleIds.length > 0 && circleIds.some((id) => !authorizedIds.has(id))) {
        return reportJson({ error: "A selected Circle is not available to this account", code: "forbidden" }, 403);
      }
      if (circleIds.length === 0) circleIds = [...authorizedIds];
      if (authorizedIds.size === 0) {
        return reportJson({ error: "Join a Circle before generating a report", code: "forbidden" }, 403);
      }
    }

    // Get org circles
    const reportDataClient = callerSupabase || supabase;
    const circleQuery = reportDataClient
      .from("circles")
      .select("id, name, member_count")
      .eq("org_id", orgId);
    if (circleIds.length) circleQuery.in("id", circleIds);
    const { data: circles, error: circlesError } = await circleQuery;
    if (circlesError) {
      return reportJson({ error: "Report Circle access could not be verified", code: "authority_unavailable" }, 503);
    }
    if (!serviceRoleCaller) {
      const visibleIds = new Set((circles || []).map((circle: { id: string }) => circle.id));
      if (configuredCircleIds.length > 0 && circleIds.some((id) => !visibleIds.has(id))) {
        return reportJson({ error: "A selected Circle is not available to this account", code: "forbidden" }, 403);
      }
      if (configuredCircleIds.length === 0) circleIds = [...visibleIds];
      if (circleIds.length === 0) {
        return reportJson({ error: "Join a Circle in this organization before generating a report", code: "forbidden" }, 403);
      }
      const metadata = report.metadata && typeof report.metadata === "object" && !Array.isArray(report.metadata)
        ? report.metadata
        : {};
      const { data: metadataReceipt, error: metadataError } = await supabase
        .from("reports")
        .update({ metadata: { ...metadata, circle_ids: circleIds } })
        .eq("id", reportId)
        .eq("org_id", orgId)
        .eq("created_by", authUserId!)
        .select("id")
        .maybeSingle();
      if (metadataError || !metadataReceipt) {
        return reportJson({ error: "Report scope could not be sealed", code: "authority_unavailable" }, 503);
      }
    }

    // Mutate the report only after every caller/report/Circle relationship has
    // been verified. A rejected request must leave no cross-tenant side effect.
    const { data: generatingReceipt, error: generatingError } = await supabase
      .from("reports")
      .update({ status: "generating" })
      .eq("id", reportId)
      .eq("org_id", orgId)
      .eq("created_by", report.created_by)
      .select("id")
      .maybeSingle();
    if (generatingError || !generatingReceipt) {
      return reportJson({ error: "Report generation could not be reserved", code: "authority_unavailable" }, 503);
    }

    if (report.report_type === "analytics" || report.report_type === "comprehensive") {
      const { data: analytics } = await reportDataClient
        .from("circle_analytics_daily")
        .select("*")
        .in("circle_id", (circles || []).map(c => c.id))
        .gte("date", report.date_from)
        .lte("date", report.date_to)
        .order("date", { ascending: true });

      reportData.analytics = analytics || [];
    }

    if (report.report_type === "goals" || report.report_type === "comprehensive") {
      // Org membership alone is not enough authority for Circle-owned goals.
      // Keep the aggregate pinned to the exact Circle set already verified
      // above, including for the service-role execution path.
      const selectedCircleIds = (circles || []).map((circle: { id: string }) => circle.id);
      const { data: goals, error: goalsError } = await reportDataClient
        .from("org_goals")
        .select("*")
        .eq("org_id", orgId)
        .in("circle_id", selectedCircleIds);

      if (goalsError) {
        return reportJson({ error: "Report goal access could not be verified", code: "authority_unavailable" }, 503);
      }

      reportData.goals = goals || [];
    }

    if (report.report_type === "engagement" || report.report_type === "comprehensive") {
      const { data: checkIns } = await reportDataClient
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
    // Include the immutable report id. The old date/type-only path allowed two
    // members generating different Circle subsets for the same dates to
    // overwrite one another and made both report rows point at the last bytes.
    const filePath = `reports/${orgId}/${reportId}/${fileName}.${ext}`;

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
        .eq("id", reportId)
        .eq("org_id", orgId)
        .eq("created_by", report.created_by);

      return reportJson({ error: "Report storage failed", code: "storage_unavailable" }, 500);
    }

    // Get a time-limited SIGNED URL. The `reports` bucket MUST be private — a
    // public bucket leaves report files readable by anyone who can guess the
    // path (reports/{orgId}/{type}_{dates}). Signed URLs scope + expire access.
    const { data: urlData, error: signErr } = await supabase.storage
      .from("reports")
      .createSignedUrl(filePath, REPORT_SIGNED_URL_TTL_SECONDS);

    if (signErr || !urlData?.signedUrl) {
      await supabase
        .from("reports")
        .update({ status: "failed" })
        .eq("id", reportId)
        .eq("org_id", orgId)
        .eq("created_by", report.created_by);
      return reportJson({ error: "Report signing failed", code: "signing_unavailable" }, 500);
    }
    const fileUrl = urlData.signedUrl;

    // Update report with URL
    await supabase
      .from("reports")
      .update({
        status: "ready",
        file_url: fileUrl,
      })
      .eq("id", reportId)
      .eq("org_id", orgId)
      .eq("created_by", report.created_by);

    return reportJson({ success: true, url: fileUrl });
  } catch (error: any) {
    console.error("[generate-report] Report generation failed", {
      name: error instanceof Error ? error.name : typeof error,
    });
    return reportJson({ error: "Report generation failed", code: "internal" }, 500);
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
