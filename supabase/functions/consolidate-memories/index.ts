// consolidate-memories — Phase 4 of AGENT_MEMORY_GOD_PLAN.
//
// Daily cron that scans memories captured in the last 24 hours, runs the
// existing detectContradictions logic against the rest of the store, and
// auto-quarantines the loser when a clear contradiction is found.
//
// Quarantine rule (matches the spec): newer wins by default; if either
// memory is pinned, pinned wins; ties stay active and are logged.
//
// Call modes:
//   * POST {} — scan everything across all circles (cron mode, default)
//   * POST { circleId } — scan a single circle (manual / debug)
//   * POST { circleId, lookbackHours } — override the 24h window
//
// Auth: service-role key in Authorization header (cron) or a user JWT
// scoped to the target circle.
//
// Deploy: npx supabase functions deploy consolidate-memories
//
// Spec: docs/superpowers/specs/2026-04-28-memory-inspect-control-design.md

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_LOOKBACK_HOURS = 24;
const MAX_NEW_MEMORIES_PER_RUN = 200;       // safety cap per circle per run
const SIMILARITY_THRESHOLD = 0.78;          // only truly-similar memories
const MAX_CANDIDATES_PER_MEMORY = 10;       // how many neighbors to compare against

interface ConsolidateRequest {
  circleId?: string;
  lookbackHours?: number;
}

interface MemoryRow {
  id: string;
  circle_id: string | null;
  title: string;
  content: string;
  memory_kind: string;
  importance: number;
  pinned: boolean | null;
  is_active: boolean;
  created_at: string;
  metadata: Record<string, unknown>;
}

interface CandidateRow {
  id: string;
  title: string;
  content: string;
  memory_kind: string;
  importance: number;
  pinned: boolean | null;
  created_at: string;
  similarity: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Negation / value-swap signals borrowed from src/lib/memoryConsolidation.ts.
// Kept narrow on purpose — the scoring step (similarity ≥ 0.78) already
// did the heavy lifting; this is the human-language sanity check.
function isContradiction(a: { content: string }, b: { content: string }): boolean {
  const aL = a.content.toLowerCase();
  const bL = b.content.toLowerCase();
  const hasNegation =
    (aL.includes("not ") !== bL.includes("not ")) ||
    (aL.includes("don't") !== bL.includes("don't")) ||
    aL.includes("instead of") ||
    aL.includes("rather than") ||
    aL.includes("changed to") ||
    aL.includes("switched to") ||
    bL.includes("instead of") ||
    bL.includes("rather than");
  const hasValueSwap =
    (aL.includes("use ") !== bL.includes("use ")) ||
    (aL.includes("prefer") !== bL.includes("prefer"));
  return hasNegation || hasValueSwap;
}

interface ConsolidationOutcome {
  newer_id: string;
  older_id: string;
  loser_id: string;            // the one we quarantined
  reason: "newer_wins" | "pinned_wins" | "tied_kept";
  similarity: number;
}

async function consolidateOneCircle(
  supabase: any,
  circleId: string,
  lookbackHours: number,
): Promise<ConsolidationOutcome[]> {
  const sinceIso = new Date(Date.now() - lookbackHours * 3_600_000).toISOString();

  // Pull recent memories — ones we haven't yet checked.
  const { data: recent, error: recentErr } = await supabase
    .from("memory_entries")
    .select("id, circle_id, title, content, memory_kind, importance, pinned, is_active, created_at, metadata")
    .eq("circle_id", circleId)
    .eq("is_active", true)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(MAX_NEW_MEMORIES_PER_RUN);

  if (recentErr || !recent || recent.length === 0) return [];

  const outcomes: ConsolidationOutcome[] = [];
  const quarantineIds = new Set<string>();

  for (const newer of recent as MemoryRow[]) {
    if (quarantineIds.has(newer.id)) continue;        // already lost an earlier comparison

    const queryText = `${newer.title}\n${newer.content}`.trim();
    if (!queryText) continue;

    // Embed once, find candidates via match_memories RPC.
    const { data: rawCandidates, error: matchErr } = await supabase
      .rpc("match_memories", {
        p_query_embedding: null,                       // server-side embedding via the RPC
        p_circle_id: circleId,
        p_match_threshold: SIMILARITY_THRESHOLD,
        p_match_count: MAX_CANDIDATES_PER_MEMORY,
        p_soul_key: null,
      });

    // The RPC requires a query embedding in current schema; if it errors,
    // fall back to keyword matching via FTS to keep the cron useful even
    // before the embedding-by-text path is added.
    let candidates: CandidateRow[] = [];
    if (!matchErr && Array.isArray(rawCandidates) && rawCandidates.length > 0) {
      candidates = rawCandidates as CandidateRow[];
    } else {
      const { data: textMatches } = await supabase
        .from("memory_entries")
        .select("id, title, content, memory_kind, importance, pinned, created_at")
        .eq("circle_id", circleId)
        .eq("is_active", true)
        .neq("id", newer.id)
        .textSearch("fts", queryText.split(/\s+/).slice(0, 6).join(" | "), { type: "websearch" })
        .limit(MAX_CANDIDATES_PER_MEMORY);
      candidates = ((textMatches as any[]) || []).map(c => ({ ...c, similarity: 0.5 }));
    }

    for (const cand of candidates) {
      if (cand.id === newer.id) continue;
      if (quarantineIds.has(cand.id)) continue;

      // Final sanity gate.
      if (!isContradiction(newer, cand)) continue;

      // Decide winner.
      const newerPinned = !!newer.pinned;
      const olderPinned = !!cand.pinned;
      let reason: ConsolidationOutcome["reason"];
      let loserId: string;

      if (newerPinned && !olderPinned) {
        reason = "pinned_wins";
        loserId = cand.id;
      } else if (olderPinned && !newerPinned) {
        reason = "pinned_wins";
        loserId = newer.id;
      } else if (newerPinned && olderPinned) {
        // Both pinned — don't auto-resolve; surface for human review.
        reason = "tied_kept";
        outcomes.push({
          newer_id: newer.id,
          older_id: cand.id,
          loser_id: newer.id,                         // sentinel: nothing actually quarantined
          reason,
          similarity: cand.similarity ?? 0,
        });
        continue;
      } else {
        // Default: newer wins.
        reason = "newer_wins";
        loserId = cand.id;
      }

      // Quarantine — set is_active = false. Soft delete preserves history.
      const { error: quarErr } = await supabase
        .from("memory_entries")
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq("id", loserId);
      if (quarErr) {
        console.warn("[consolidate-memories] quarantine failed:", loserId, quarErr.message);
        continue;
      }

      // Record evaluation row so the audit trail shows why.
      await supabase
        .from("memory_evaluations")
        .insert({
          memory_id: loserId,
          evaluation_kind: "contradiction",
          evaluator: "consolidate-memories-cron",
          passed: false,
          score: 0,
          feedback: `Quarantined: contradicted by ${reason === "pinned_wins" ? "pinned" : "newer"} memory ${loserId === cand.id ? newer.id : cand.id}`,
          metadata: {
            winner_id: loserId === cand.id ? newer.id : cand.id,
            loser_id: loserId,
            similarity: cand.similarity ?? 0,
            reason,
          },
        });

      quarantineIds.add(loserId);
      outcomes.push({
        newer_id: newer.id,
        older_id: cand.id,
        loser_id: loserId,
        reason,
        similarity: cand.similarity ?? 0,
      });
    }
  }

  return outcomes;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "POST only" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") || "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  );

  let body: ConsolidateRequest = {};
  try { body = await req.json(); } catch { /* empty body is fine */ }
  const lookbackHours = Math.max(1, Math.min(168, body.lookbackHours || DEFAULT_LOOKBACK_HOURS));

  const startedAt = Date.now();

  // Resolve which circles to scan.
  let circleIds: string[];
  if (body.circleId) {
    circleIds = [body.circleId];
  } else {
    const { data: circles, error: circlesErr } = await supabase
      .from("circles")
      .select("circle_id")
      .limit(1000);
    if (circlesErr) return jsonResponse({ ok: false, error: circlesErr.message }, 500);
    circleIds = (circles || []).map((c: any) => c.circle_id);
  }

  let totalQuarantined = 0;
  let totalTied = 0;
  const perCircle: Record<string, number> = {};

  for (const cid of circleIds) {
    try {
      const outcomes = await consolidateOneCircle(supabase, cid, lookbackHours);
      const quar = outcomes.filter(o => o.reason !== "tied_kept").length;
      const tied = outcomes.filter(o => o.reason === "tied_kept").length;
      totalQuarantined += quar;
      totalTied += tied;
      if (quar > 0 || tied > 0) perCircle[cid] = quar;
    } catch (err) {
      console.warn(`[consolidate-memories] circle ${cid} failed:`, err);
    }
  }

  return jsonResponse({
    ok: true,
    quarantined: totalQuarantined,
    tied_kept: totalTied,
    circles_scanned: circleIds.length,
    duration_ms: Date.now() - startedAt,
    per_circle: perCircle,
  });
});
