// distil-soul-wisdom — Phase 3 of AGENT_MEMORY_GOD_PLAN.
//
// Given a (circle, soul_key), pulls the top-50 memories routed to that
// SOUL in that circle and asks Claude Haiku to synthesize 5–8 bullets of
// durable guidance. Upserts the result into `soul_wisdom`.
//
// Call modes:
//   * POST { circleId, soulKey }          — refresh a single pair
//   * POST { circleId }                   — refresh all SOULs for the circle
//   * POST { refreshAll: true }           — refresh every stale pair (cron mode)
//
// Auth: accepts either a user JWT (user must be in the target circle) OR
// the service role key in the Authorization header (for pg_cron).
//
// Deploy: npx supabase functions deploy distil-soul-wisdom

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MIN_MEMORIES_FOR_WISDOM = 15;
const MAX_MEMORIES_PER_SOUL = 50;
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";

interface DistilRequest {
  circleId?: string;
  soulKey?: string;
  refreshAll?: boolean;
  force?: boolean;            // ignore freshness, regenerate anyway
  model?: string;
}

interface MemoryRow {
  id: string;
  title: string;
  content: string;
  memory_kind: string;
  importance: number;
  updated_at: string;
  role: string;
  ownership_mode: string;
  confidence: number;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errResponse(status: number, message: string): Response {
  return jsonResponse({ ok: false, error: message }, status);
}

// ── Memory gathering ────────────────────────────────────────────────────────

async function loadSoulMemories(
  supabase: any,
  circleId: string,
  soulKey: string,
): Promise<MemoryRow[]> {
  // Primary-role memories first (the ones this SOUL "owns"), then shared,
  // limited to MAX_MEMORIES_PER_SOUL. We order by importance DESC then
  // updated_at DESC so fresh high-importance memories dominate.
  const { data, error } = await supabase
    .from("memory_soul_links")
    .select(`
      role, ownership_mode, confidence,
      memory:memory_entries!inner (
        id, title, content, memory_kind, importance, updated_at, is_active
      )
    `)
    .eq("circle_id", circleId)
    .eq("soul_key", soulKey)
    .order("role", { ascending: true })   // 'primary' sorts before 'shared'/'reference'
    .limit(MAX_MEMORIES_PER_SOUL);

  if (error) {
    console.warn("[distil-soul-wisdom] memory load failed:", error.message);
    return [];
  }

  return (data || [])
    .filter((r: any) => r.memory && r.memory.is_active)
    .map((r: any) => ({
      id: r.memory.id,
      title: r.memory.title,
      content: r.memory.content,
      memory_kind: r.memory.memory_kind,
      importance: r.memory.importance,
      updated_at: r.memory.updated_at,
      role: r.role,
      ownership_mode: r.ownership_mode,
      confidence: r.confidence,
    }))
    // Secondary in-JS sort because the Postgres ORDER BY above was on the
    // join table only — we want primary first, THEN importance within role.
    .sort((a, b) => {
      const roleRank = (r: string) => (r === "primary" ? 0 : r === "shared" ? 1 : 2);
      const roleDiff = roleRank(a.role) - roleRank(b.role);
      if (roleDiff !== 0) return roleDiff;
      if (b.importance !== a.importance) return b.importance - a.importance;
      return (b.updated_at || "").localeCompare(a.updated_at || "");
    });
}

// ── Distillation prompt ─────────────────────────────────────────────────────

function buildDistilPrompt(soulKey: string, memories: MemoryRow[]): string {
  const soulName = soulKey.replace(/^soul:/, "").replace(/-/g, " ");
  const memBlock = memories.map((m, i) =>
    `${i + 1}. [${m.memory_kind} · ${m.role}] ${m.title} — ${m.content}`,
  ).join("\n");

  return `You are distilling durable guidance for the "${soulName}" SOUL in a specific team's context.

Input: ${memories.length} memories routed to this SOUL, ordered by role (primary first) then importance.

Your job: write 5 to 8 concise bullets that capture what this SOUL has LEARNED in this team's context. These bullets will be injected into the SOUL's system prompt on every invocation, so they must be:
- Specific to patterns the team actually follows (pull from the memories below, don't invent).
- Prescriptive ("prefer X over Y", "avoid Z because…") rather than descriptive.
- Durable — facts that will still be true next month. Skip anything ephemeral.
- No preamble. No "Based on the memories…". Just the bullets.
- Each bullet under 140 chars. Markdown \`-\` prefix.

Memories:
${memBlock}

Output only the bullets, nothing else.`;
}

async function callHaiku(
  apiKey: string,
  model: string,
  prompt: string,
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 800,
      system: "You synthesize team-specific guidance from memory lists. Output only markdown bullets, no preamble.",
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text?.trim() || "";
}

// ── Core distillation for one (circle, soul) pair ──────────────────────────

async function distilOne(
  supabase: any,
  circleId: string,
  soulKey: string,
  anthropicKey: string,
  model: string,
): Promise<{ ok: boolean; skipped?: string; body?: string; sourceIds?: string[] }> {
  const memories = await loadSoulMemories(supabase, circleId, soulKey);
  if (memories.length < MIN_MEMORIES_FOR_WISDOM) {
    return { ok: false, skipped: `only ${memories.length} memories (min ${MIN_MEMORIES_FOR_WISDOM})` };
  }

  const prompt = buildDistilPrompt(soulKey, memories);
  const body = await callHaiku(anthropicKey, model, prompt);
  if (!body || body.length < 20) {
    return { ok: false, skipped: "model returned empty/short response" };
  }

  const sourceIds = memories.map((m) => m.id);
  const { error: upsertError } = await supabase
    .from("soul_wisdom")
    .upsert(
      {
        circle_id: circleId,
        soul_key: soulKey,
        body,
        source_memory_ids: sourceIds,
        source_count: sourceIds.length,
        model,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "circle_id,soul_key" },
    );
  if (upsertError) {
    throw new Error(`upsert failed: ${upsertError.message}`);
  }
  return { ok: true, body, sourceIds };
}

// ── Target discovery ───────────────────────────────────────────────────────

async function listSoulsForCircle(supabase: any, circleId: string): Promise<string[]> {
  const { data } = await supabase
    .from("memory_soul_links")
    .select("soul_key")
    .eq("circle_id", circleId);
  const set = new Set<string>();
  for (const row of data || []) set.add((row as any).soul_key);
  return Array.from(set);
}

async function listStaleTargets(supabase: any, force: boolean): Promise<Array<{ circle_id: string; soul_key: string }>> {
  let query = supabase
    .from("soul_wisdom_staleness")
    .select("circle_id, soul_key, freshness, primary_memories");
  if (!force) {
    query = query.in("freshness", ["never", "stale", "aged"]);
  }
  const { data } = await query;
  return (data || [])
    .filter((r: any) => (r.primary_memories || 0) >= MIN_MEMORIES_FOR_WISDOM)
    .map((r: any) => ({ circle_id: r.circle_id, soul_key: r.soul_key }));
}

// ── Handler ─────────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    return jsonResponse({ service: "distil-soul-wisdom", status: "ok" });
  }

  try {
    const body: DistilRequest = await req.json().catch(() => ({}));
    const model = body.model || DEFAULT_MODEL;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!anthropicKey) return errResponse(500, "ANTHROPIC_API_KEY not set in Supabase secrets");

    // Auth gate — either the caller presents a user JWT (we verify they are
    // in the target circle) OR they present the service role key.
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const isServiceRole = token && token === serviceKey;

    let callerUserId: string | null = null;
    if (!isServiceRole && token) {
      const anon = createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_ANON_KEY") || serviceKey,
        { global: { headers: { Authorization: `Bearer ${token}` } } },
      );
      const { data: { user } } = await anon.auth.getUser();
      callerUserId = user?.id || null;
    }
    if (!isServiceRole && !callerUserId) {
      return errResponse(401, "Authentication required (JWT or service role)");
    }

    // Build the target list
    const targets: Array<{ circle_id: string; soul_key: string }> = [];

    if (body.refreshAll) {
      targets.push(...(await listStaleTargets(supabase, !!body.force)));
    } else if (body.circleId && body.soulKey) {
      targets.push({ circle_id: body.circleId, soul_key: body.soulKey });
    } else if (body.circleId) {
      const souls = await listSoulsForCircle(supabase, body.circleId);
      for (const sk of souls) targets.push({ circle_id: body.circleId, soul_key: sk });
    } else {
      return errResponse(400, "Provide circleId + soulKey, circleId alone, or refreshAll: true");
    }

    // If called with a user JWT (not service role), verify they belong to
    // every target circle before doing expensive work.
    if (!isServiceRole && callerUserId) {
      const targetCircles = Array.from(new Set(targets.map(t => t.circle_id)));
      const { data: members } = await supabase
        .from("circle_members")
        .select("circle_id")
        .eq("user_id", callerUserId)
        .in("circle_id", targetCircles);
      const allowed = new Set((members || []).map((m: any) => m.circle_id));
      const ownedTargets = targets.filter(t => allowed.has(t.circle_id));
      if (ownedTargets.length === 0) {
        return errResponse(403, "You are not a member of any target circle");
      }
      targets.length = 0;
      targets.push(...ownedTargets);
    }

    // Distil each target
    const results: Array<Record<string, unknown>> = [];
    for (const t of targets) {
      try {
        const r = await distilOne(supabase, t.circle_id, t.soul_key, anthropicKey, model);
        results.push({ circle_id: t.circle_id, soul_key: t.soul_key, ...r });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results.push({ circle_id: t.circle_id, soul_key: t.soul_key, ok: false, error: msg });
      }
    }

    const summary = {
      ok: true,
      total: targets.length,
      succeeded: results.filter(r => r.ok).length,
      skipped: results.filter(r => (r as any).skipped).length,
      failed: results.filter(r => !r.ok && !(r as any).skipped).length,
      results,
    };
    return jsonResponse(summary);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[distil-soul-wisdom] error:", msg);
    return errResponse(500, msg);
  }
});
