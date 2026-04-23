#!/usr/bin/env npx tsx
/**
 * export-traces — CA-8g. Pulls `agent_runs` + `agent_run_events`
 * rows for a date range and writes them as JSONL to
 * `docs/traces/<yyyy-mm-dd>.jsonl` (one file per day). Each line is
 * one run with its prompt, tool calls, final response, usage, and
 * success/failure. Feeds the (future) DSPy/GEPA optimizer and the
 * golden-eval regression runner.
 *
 * Reads from env:
 *   SUPABASE_URL                  — required
 *   SUPABASE_SERVICE_ROLE_KEY     — required (service role bypasses RLS;
 *                                   this script is ops-only, never ships
 *                                   to the client bundle)
 *
 * Usage:
 *   npx tsx scripts/export-traces.ts                  # exports yesterday
 *   npx tsx scripts/export-traces.ts --date 2026-04-20
 *   npx tsx scripts/export-traces.ts --since 2026-04-15 --until 2026-04-22
 *   npx tsx scripts/export-traces.ts --source swanbot-v2-ai
 *
 * Privacy + compliance:
 *   - Message bodies ARE included — the whole point is prompt + response
 *     text. Don't commit the output to a public repo; `docs/traces/` is
 *     gitignored by default.
 *   - Strip or redact PII before publishing any subset (e.g. to a
 *     co-training partner).
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'node:fs';
import * as path from 'node:path';

interface Args {
  date?: string;
  since?: string;
  until?: string;
  source?: string;
  outDir: string;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { outDir: path.join(process.cwd(), 'docs', 'traces'), help: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { args.help = true; continue; }
    if (a === '--date')    { args.date = argv[++i]; continue; }
    if (a === '--since')   { args.since = argv[++i]; continue; }
    if (a === '--until')   { args.until = argv[++i]; continue; }
    if (a === '--source')  { args.source = argv[++i]; continue; }
    if (a === '--out')     { args.outDir = argv[++i]; continue; }
  }
  return args;
}

function dayIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function resolveDateRange(args: Args): { since: string; until: string } {
  if (args.date) return { since: args.date, until: args.date };
  if (args.since && args.until) return { since: args.since, until: args.until };
  if (args.since) return { since: args.since, until: dayIso(new Date()) };
  // Default: yesterday UTC (finished day with complete traces).
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  const y = dayIso(d);
  return { since: y, until: y };
}

function usage(): void {
  console.log(`\nexport-traces — dump agent_runs + agent_run_events to JSONL

Options:
  --date <yyyy-mm-dd>     single day (UTC); defaults to yesterday
  --since <yyyy-mm-dd>    start of range
  --until <yyyy-mm-dd>    end of range
  --source <source>       filter by metadata.version (e.g. swanbot-v2-ai)
  --out <dir>             output directory (default: docs/traces)
  -h, --help              this message
`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  if (args.help) { usage(); return; }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('error: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY must be set in env');
    process.exit(1);
  }

  const supabase = createClient(url, key);
  const { since, until } = resolveDateRange(args);
  const sinceIso = `${since}T00:00:00Z`;
  const untilIso = `${until}T23:59:59Z`;

  console.log(`[export-traces] range ${since} → ${until} ${args.source ? `· source=${args.source}` : ''}`);

  // Paginate — Supabase caps single queries at 1000 rows by default.
  const pageSize = 500;
  let offset = 0;
  const runs: Record<string, unknown>[] = [];
  while (true) {
    const q = supabase
      .from('agent_runs')
      .select('id, circle_id, user_id, surface, title, mode, model, provider, status, iteration_count, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, final_stop_reason, started_at, completed_at, tool_calls, metadata')
      .gte('started_at', sinceIso)
      .lte('started_at', untilIso)
      .order('started_at', { ascending: true })
      .range(offset, offset + pageSize - 1);
    const { data, error } = await q;
    if (error) { console.error('[export-traces] agent_runs query failed:', error.message); process.exit(1); }
    const rows = data || [];
    for (const row of rows) {
      if (args.source && (row as any)?.metadata?.version !== args.source) continue;
      runs.push(row as Record<string, unknown>);
    }
    if (rows.length < pageSize) break;
    offset += pageSize;
  }

  console.log(`[export-traces] fetched ${runs.length} runs`);

  if (runs.length === 0) {
    console.log('[export-traces] no runs in range; nothing to write');
    return;
  }

  // Attach events per run, paginated separately.
  const byDate = new Map<string, Record<string, unknown>[]>();
  for (const run of runs) {
    const day = String(run.started_at || '').slice(0, 10);
    if (!day) continue;
    if (!byDate.has(day)) byDate.set(day, []);
    byDate.get(day)!.push(run);
  }

  fs.mkdirSync(args.outDir, { recursive: true });

  for (const [day, dayRuns] of byDate) {
    const outPath = path.join(args.outDir, `${day}.jsonl`);
    const lines: string[] = [];
    for (const run of dayRuns) {
      // Fetch events for this run — cap at 200 so a single runaway
      // run doesn't blow up the file. Rare in practice.
      const { data: events } = await supabase
        .from('agent_run_events')
        .select('kind, payload, created_at')
        .eq('run_id', run.id)
        .order('created_at', { ascending: true })
        .limit(200);
      const trimmedRun = {
        ...run,
        // Keep payload slim; full tool_calls already on the run row.
        events: (events || []).map((e: any) => ({
          kind: e.kind,
          payload: e.payload,
          at: e.created_at,
        })),
      };
      lines.push(JSON.stringify(trimmedRun));
    }
    fs.writeFileSync(outPath, lines.join('\n') + '\n');
    console.log(`[export-traces] wrote ${lines.length} runs → ${outPath}`);
  }
}

main().catch((err) => {
  console.error('[export-traces] fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
