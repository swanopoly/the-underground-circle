#!/usr/bin/env npx tsx
/**
 * backfill-memory-embeddings — the OPS-SIDE companion to the in-app repair
 * sweep (`memoryEmbeddings.ensureMemoryEmbeddingCoverage`).
 *
 * WHY A SCRIPT EXISTS AT ALL, AND WHY IT IS NOT THE PRIMARY TRIGGER.
 * `match_memories` filters `AND m.embedding IS NOT NULL`, so an un-embedded row
 * is invisible to semantic retrieval. The in-app sweep repairs coverage for the
 * signed-in user, through `llm-proxy` with their own BYOK key, under their own
 * RLS — that is the correct everyday mechanism and it needs no scheduler. What
 * it CANNOT do is a one-time catch-up across every circle for rows written
 * before embed-on-write existed, because no single user can see them all. That
 * is this script's only job.
 *
 * READ THIS BEFORE RUNNING — two boundaries are deliberately crossed:
 *   1. SERVICE ROLE. This reads and writes `memory_entries` with the service
 *      role, bypassing RLS. Ops-only; it must never ship to a client bundle.
 *   2. DIRECT OPENAI KEY. `llm-proxy` rejects anything without a valid user JWT
 *      (401) and resolves the embedding key from THAT user's BYOK settings. A
 *      script cannot mint a user JWT, so it calls the OpenAI embeddings API
 *      directly with `OPENAI_API_KEY`. Consequence: spend lands on that key and
 *      is NOT recorded in the app's usage tracking. Supplying the env var is
 *      how you consent to that.
 *
 * Safety properties (shared with the in-app sweep — same pure core):
 *   * DRY RUN BY DEFAULT. Nothing is written without `--apply`.
 *   * NEVER RE-EMBEDS. The SQL predicate is `embedding IS NULL` and every row
 *     is re-checked through `evaluateEmbeddingEligibility`, so re-running this
 *     after a complete pass costs one query and zero tokens.
 *   * BOUNDED. `--limit`, `--page-size`, `--max-pages` all cap the pass.
 *   * RESUMABLE. Keyset-paged on `id` via the same monotonic cursor, persisted
 *     to `--cursor-file`, so a killed run resumes instead of restarting.
 *   * LOUD. Prints scope, row counts, a token/cost estimate and every boundary
 *     it is about to cross, then requires `--apply` to proceed.
 *
 * Usage:
 *   npx tsx scripts/backfill-memory-embeddings.ts                 # dry run, all circles
 *   npx tsx scripts/backfill-memory-embeddings.ts --circle <uuid>
 *   npx tsx scripts/backfill-memory-embeddings.ts --limit 2000 --apply
 *
 * Env:
 *   SUPABASE_URL                — required
 *   SUPABASE_SERVICE_ROLE_KEY   — required
 *   OPENAI_API_KEY              — required only with --apply
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  EMBEDDING_BATCH_MAX,
  advanceRepairCursor,
  createRepairCursor,
  parseRepairCursor,
  planEmbeddingBatches,
  resolveRepairMaxPages,
  resolveRepairPageSize,
  selectEmbeddingBatch,
  serializeRepairCursor,
  shouldContinueRepair,
  summarizeRepairCursor,
  type MemoryEmbeddingRepairCursor,
} from '../src/lib/memoryEmbeddingPolicyCore';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;
/** text-embedding-3-small list price, USD per 1M input tokens (2026-07). */
const USD_PER_MILLION_TOKENS = 0.02;

interface Args {
  circleId?: string;
  limit: number;
  pageSize: number;
  maxPages: number;
  apply: boolean;
  cursorFile: string;
  fresh: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: 5000,
    pageSize: 100,
    maxPages: 200,
    apply: false,
    cursorFile: path.join(os.tmpdir(), 'uc-memory-embedding-backfill-cursor.json'),
    fresh: false,
    help: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (a === '--circle') { args.circleId = argv[++i]; continue; }
    if (a === '--limit') { args.limit = Number(argv[++i]); continue; }
    if (a === '--page-size') { args.pageSize = Number(argv[++i]); continue; }
    if (a === '--max-pages') { args.maxPages = Number(argv[++i]); continue; }
    if (a === '--cursor-file') { args.cursorFile = argv[++i]; continue; }
    if (a === '--fresh') { args.fresh = true; continue; }
    if (a === '--apply') { args.apply = true; continue; }
    console.error(`Unknown flag: ${a}`);
    args.help = true;
  }
  return args;
}

function usage(): void {
  console.log(`
backfill-memory-embeddings — repair semantic-memory coverage (ops only)

  --circle <uuid>      restrict to one circle (default: every circle)
  --limit <n>          max rows scanned this pass          (default 5000)
  --page-size <n>      rows per query, 1..500              (default 100)
  --max-pages <n>      queries this pass, 1..200           (default 200)
  --cursor-file <p>    resume state                        (default: tmpdir)
  --fresh              ignore the saved cursor and start from the beginning
  --apply              actually embed and write (default is a DRY RUN)
  -h, --help           this message
`);
}

function loadCursor(file: string, fresh: boolean): MemoryEmbeddingRepairCursor {
  if (fresh) return createRepairCursor(Date.now());
  try {
    const parsed = parseRepairCursor(fs.readFileSync(file, 'utf8'));
    if (parsed && !parsed.done) {
      console.log(`  resuming from saved cursor: ${summarizeRepairCursor(parsed)}`);
      return parsed;
    }
  } catch { /* no cursor yet — start clean */ }
  return createRepairCursor(Date.now());
}

function saveCursor(file: string, cursor: MemoryEmbeddingRepairCursor): void {
  try {
    fs.writeFileSync(file, serializeRepairCursor(cursor), 'utf8');
  } catch (err) {
    console.warn(`  (could not persist cursor to ${file}: ${(err as Error).message})`);
  }
}

async function embedBatch(apiKey: string, inputs: string[]): Promise<number[][] | null> {
  try {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.warn(`  embed request failed: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const json: any = await res.json();
    const vectors = (json?.data || []).map((d: any) => d?.embedding);
    if (!Array.isArray(vectors) || vectors.length !== inputs.length) {
      console.warn('  embed response shape unexpected — skipping batch');
      return null;
    }
    return vectors;
  } catch (err) {
    console.warn(`  embed request threw: ${(err as Error).message}`);
    return null;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
    process.exit(1);
  }
  const openaiKey = process.env.OPENAI_API_KEY || '';
  if (args.apply && !openaiKey) {
    console.error('ERROR: --apply needs OPENAI_API_KEY (this script calls OpenAI directly; see the header).');
    process.exit(1);
  }

  const pageSize = resolveRepairPageSize(args.pageSize);
  const maxPages = resolveRepairMaxPages(args.maxPages);
  const limit = Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 5000;
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const countMissing = async (): Promise<number> => {
    let q = supabase.from('memory_entries').select('id', { count: 'exact', head: true })
      .eq('is_active', true).is('embedding', null);
    if (args.circleId) q = q.eq('circle_id', args.circleId);
    const { count, error } = await q;
    if (error) { console.error(`ERROR: coverage query failed: ${error.message}`); process.exit(1); }
    return count || 0;
  };

  const missing = await countMissing();

  // ── Loud preamble ────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════════════');
  console.log(args.apply ? '  MEMORY EMBEDDING BACKFILL — APPLY' : '  MEMORY EMBEDDING BACKFILL — DRY RUN (nothing will be written)');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  target        : ${url}`);
  console.log(`  scope         : ${args.circleId ? `circle ${args.circleId}` : 'ALL CIRCLES'}`);
  console.log(`  rows missing  : ${missing} active memories with no embedding`);
  console.log(`  this pass     : up to ${Math.min(limit, missing)} rows (${pageSize}/page, max ${maxPages} pages)`);
  console.log(`  model         : ${EMBEDDING_MODEL} (${EMBEDDING_DIMS}d)`);
  if (args.apply) {
    console.log('  BOUNDARIES CROSSED:');
    console.log('    * service role — bypasses RLS on memory_entries (read AND write)');
    console.log('    * OPENAI_API_KEY used DIRECTLY — bypasses llm-proxy BYOK resolution');
    console.log('      and the app\'s usage tracking. Spend lands on that key.');
  }
  console.log(`  cursor file   : ${args.cursorFile}${args.fresh ? ' (ignored: --fresh)' : ''}`);
  console.log('══════════════════════════════════════════════════════════════\n');

  if (missing === 0) {
    console.log('Coverage is complete — nothing to do.\n');
    return;
  }

  let cursor = loadCursor(args.cursorFile, args.fresh);
  let estimatedChars = 0;
  let eligibleSeen = 0;

  for (;;) {
    const gate = shouldContinueRepair(cursor, { maxPages, maxRows: limit, nowMs: Date.now() });
    if (!gate.continue) {
      console.log(`\nStopped: ${gate.reason}`);
      break;
    }

    let q = supabase.from('memory_entries')
      .select('id, title, content, embedding_model')
      .eq('is_active', true)
      .is('embedding', null)
      .order('id', { ascending: true })
      .limit(pageSize);
    if (cursor.lastId) q = q.gt('id', cursor.lastId);
    if (args.circleId) q = q.eq('circle_id', args.circleId);

    const { data: rows, error } = await q;
    if (error) { console.error(`ERROR: page fetch failed: ${error.message}`); process.exit(1); }
    const page = (rows || []) as Array<{ id: string; title: string; content: string }>;

    // Same eligibility core the app uses — the proof we never re-embed.
    const jobs: Array<{ id: string; text: string }> = [];
    const claimed: string[] = [];
    let pending: any[] = page;
    let pageSkipped = 0;
    while (pending.length > 0) {
      const sel = selectEmbeddingBatch(pending, { maxBatchSize: EMBEDDING_BATCH_MAX, seenIds: claimed });
      jobs.push(...sel.batch);
      for (const job of sel.batch) claimed.push(job.id);
      pageSkipped += sel.skipped.length;
      if (!sel.truncated || sel.remaining.length === 0) break;
      pending = sel.remaining as any[];
    }
    eligibleSeen += jobs.length;
    for (const job of jobs) estimatedChars += job.text.length;

    let embedded = 0;
    let failed = 0;
    if (args.apply) {
      for (const chunk of planEmbeddingBatches(jobs, EMBEDDING_BATCH_MAX)) {
        const vectors = await embedBatch(openaiKey, chunk.map((j) => j.text));
        if (!vectors) { failed += chunk.length; continue; }
        for (let i = 0; i < chunk.length; i += 1) {
          const vec = vectors[i];
          if (!Array.isArray(vec) || vec.length !== EMBEDDING_DIMS) { failed += 1; continue; }
          const { error: upErr } = await supabase
            .from('memory_entries')
            .update({
              embedding: `[${vec.join(',')}]`,
              embedding_model: EMBEDDING_MODEL,
              embedded_at: new Date().toISOString(),
            })
            .eq('id', chunk[i].id);
          if (upErr) { failed += 1; } else { embedded += 1; }
        }
      }
    }

    cursor = advanceRepairCursor(
      cursor,
      { rowIds: page.map((r) => r.id), requestedPageSize: pageSize, embedded, failed, skipped: pageSkipped },
      Date.now(),
    );
    if (args.apply) saveCursor(args.cursorFile, cursor);
    process.stdout.write(`  page ${cursor.pagesDone}: ${page.length} row(s), ${jobs.length} eligible` +
      (args.apply ? `, ${embedded} embedded, ${failed} failed\n` : ' (dry run)\n'));
  }

  const estTokens = Math.ceil(estimatedChars / 4);
  const estUsd = (estTokens / 1_000_000) * USD_PER_MILLION_TOKENS;
  console.log(`\n${summarizeRepairCursor(cursor)}`);
  console.log(`Estimated embedding spend for the ${eligibleSeen} eligible row(s): ~${estTokens} tokens ≈ $${estUsd.toFixed(4)}`);
  if (!args.apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to embed.\n');
  } else {
    console.log(`\nCursor saved to ${args.cursorFile}. Re-run to continue; re-running after a complete pass costs one query.\n`);
  }
}

main().catch((err) => {
  console.error('backfill-memory-embeddings failed:', err);
  process.exit(1);
});
