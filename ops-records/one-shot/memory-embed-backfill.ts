/**
 * ⚠️  RETIRED — NOT DEPLOYED, AND DELIBERATELY NOT UNDER supabase/functions/.
 *
 * It ran once on 2026-07-28 (2,604 rows embedded, 0 failures, $0.0143) and the
 * deployed function + its MEMORY_BACKFILL_TOKEN secret were removed the same
 * day. It is parked here rather than in `supabase/functions/` on purpose: a
 * bare `supabase functions deploy` deploys EVERY directory under that path, so
 * leaving a retired ops endpoint there would silently re-publish a
 * memory_entries writer. Kept for the record and in case the gap ever recurs.
 *
 * ONE-SHOT ops function: embed `memory_entries` rows
 * that have `embedding IS NULL`.
 *
 * WHY A FUNCTION AND NOT A LOCAL SCRIPT
 * `OPENAI_API_KEY` lives only as a Supabase secret. A local script would need
 * the raw key on the operator's machine; running here means the key never
 * leaves the platform and spend stays on the app's own key.
 *
 * WHY THIS MATTERS
 * `match_memories` filters `AND m.embedding IS NOT NULL`, so an un-embedded row
 * is invisible to semantic search forever. A live check on 2026-07-28 found
 * only 599 of 3,478 active memories (17.2%) embedded — 83% of the circle's
 * memory was unreachable.
 *
 * SAFETY
 *  - Requires a dedicated `MEMORY_BACKFILL_TOKEN` secret in an `x-ops-token`
 *    header. Not callable by an app user, and narrower than service role.
 *  - Bounded per invocation (`limit`, hard-capped) and resumable via keyset
 *    paging on `id`, so it can never run away.
 *  - `dryRun` (the DEFAULT) reports what it would do and spends nothing.
 *  - Refuses if the batch would exceed `maxSpendUsd`.
 *  - Only ever writes the `embedding` column of rows that had NULL. It cannot
 *    modify content, and re-running is idempotent (the NULL filter excludes
 *    anything already done).
 *  - Never logs key material or row content.
 *
 * DELETE THIS FUNCTION once the backfill is complete — it exists to repair a
 * historical gap, not as a standing endpoint. Ongoing coverage is handled by
 * embed-on-write (`memoryEmbeddings.queueMemoryEmbedding`).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.3";

const EMBEDDING_MODEL = "text-embedding-3-small";
const USD_PER_1M_TOKENS = 0.02;
const MAX_LIMIT = 1000;
const OPENAI_BATCH = 100;
/** text-embedding-3-small accepts 8192 tokens; stay well clear. */
const MAX_CHARS_PER_ROW = 8000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Length-safe constant-time-ish compare so a bad token can't be probed by timing. */
function tokenMatches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  // Auth on a DEDICATED secret rather than the platform service-role key: the
  // value injected as SUPABASE_SERVICE_ROLE_KEY did not match the project's
  // published service_role API key, so comparing against it rejected a
  // legitimate operator. A purpose-set secret is unambiguous, and scopes this
  // endpoint to exactly one job rather than to anything holding service role.
  const opsToken = Deno.env.get("MEMORY_BACKFILL_TOKEN") ?? "";
  const presented = (req.headers.get("x-ops-token") ?? "").trim();
  if (!opsToken || !presented || !tokenMatches(presented, opsToken)) {
    return json(401, { error: "ops_token_required" });
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* defaults */ }

  const dryRun = body.dryRun !== false; // default TRUE — spending is opt-in
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number(body.limit) || 200));
  const maxSpendUsd = Number(body.maxSpendUsd) > 0 ? Number(body.maxSpendUsd) : 0.25;

  const openaiKey = Deno.env.get("OPENAI_API_KEY") ?? "";
  if (!openaiKey && !dryRun) return json(500, { error: "openai_key_missing" });

  // Service role for the DB client only (RLS bypass is required to read every
  // circle's rows). Authorization above is the ops token, NOT this key.
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) return json(500, { error: "service_key_missing" });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
    { auth: { persistSession: false } },
  );

  // Keyset page on id — the only unique, totally ordered column.
  const after = typeof body.after === "string" ? body.after : "";
  let q = supabase
    .from("memory_entries")
    .select("id, title, content")
    .eq("is_active", true)
    .is("embedding", null)
    .order("id", { ascending: true })
    .limit(limit);
  if (after) q = q.gt("id", after);

  const { data: rows, error } = await q;
  if (error) return json(500, { error: error.message });
  if (!rows || rows.length === 0) {
    return json(200, { done: true, scanned: 0, embedded: 0, message: "no rows need embedding" });
  }

  const inputs = rows.map((r: Record<string, unknown>) => {
    const t = typeof r.title === "string" ? r.title : "";
    const c = typeof r.content === "string" ? r.content : "";
    return `${t}\n${c}`.slice(0, MAX_CHARS_PER_ROW).trim() || "(empty)";
  });
  const chars = inputs.reduce((n, s) => n + s.length, 0);
  const estTokens = Math.ceil(chars / 4);
  const estUsd = (estTokens / 1_000_000) * USD_PER_1M_TOKENS;

  if (estUsd > maxSpendUsd) {
    return json(400, {
      error: "spend_cap_exceeded",
      estUsd: Number(estUsd.toFixed(4)),
      maxSpendUsd,
      hint: "lower `limit` or raise `maxSpendUsd`",
    });
  }

  if (dryRun) {
    return json(200, {
      dryRun: true, scanned: rows.length, wouldEmbed: rows.length,
      estTokens, estUsd: Number(estUsd.toFixed(4)),
      lastId: rows[rows.length - 1].id,
    });
  }

  let embedded = 0;
  const failures: string[] = [];
  for (let i = 0; i < rows.length; i += OPENAI_BATCH) {
    const slice = rows.slice(i, i + OPENAI_BATCH);
    const sliceInputs = inputs.slice(i, i + OPENAI_BATCH);
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: sliceInputs }),
    });
    if (!res.ok) {
      // Never echo the response body verbatim — it can carry request context.
      failures.push(`openai_${res.status}`);
      break;
    }
    const payload = await res.json();
    const vectors: number[][] = (payload?.data ?? []).map((d: { embedding: number[] }) => d.embedding);
    for (let j = 0; j < slice.length && j < vectors.length; j++) {
      const vec = vectors[j];
      if (!Array.isArray(vec) || vec.length === 0) { failures.push("empty_vector"); continue; }
      // pgvector wants the bracketed TEXT form, not a JS array — writing the
      // raw array silently produces an unusable column value.
      const { error: upErr } = await supabase
        .from("memory_entries")
        .update({ embedding: `[${vec.join(",")}]` })
        .eq("id", slice[j].id)
        .is("embedding", null); // idempotent: never overwrite an existing vector
      if (upErr) failures.push(`update_failed`); else embedded += 1;
    }
  }

  return json(200, {
    dryRun: false,
    scanned: rows.length,
    embedded,
    failures: failures.slice(0, 5),
    failureCount: failures.length,
    estTokens,
    estUsd: Number(estUsd.toFixed(4)),
    lastId: rows[rows.length - 1].id,
  });
});
