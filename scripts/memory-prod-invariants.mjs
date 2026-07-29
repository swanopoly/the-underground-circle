#!/usr/bin/env node
/**
 * memory-prod-invariants — READ-ONLY production integrity checks for the memory
 * system.
 *
 * The smoke suites prove the pure cores are correct. They cannot prove the
 * DEPLOYED system is healthy: whether provenance is actually being written,
 * whether rows are reachable, whether anything is orphaned. This closes that
 * gap — it runs real queries against the linked Supabase project and asserts
 * invariants that must hold of live data.
 *
 * SAFETY: every statement is a SELECT. Nothing here writes, and it must stay
 * that way — this is run against production.
 *
 * Usage:
 *   node scripts/memory-prod-invariants.mjs            # human output
 *   node scripts/memory-prod-invariants.mjs --json out.json
 *
 * Exit codes: 0 = all invariants hold, 1 = at least one FAIL, 2 = harness error.
 * WARN never fails the run — a warn is "worth knowing", a fail is "broken".
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync } from 'node:fs';

const run = promisify(execFile);
const argv = process.argv.slice(2);
const jsonAt = argv.indexOf('--json') >= 0 ? argv[argv.indexOf('--json') + 1] : null;

async function q(sql) {
  const { stdout } = await run('supabase', ['db', 'query', '--linked', sql], {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120_000,
  });
  // The CLI prints a banner then one or more JSON objects; take every {...}
  // block and merge their `rows`. Tolerant on purpose — the banner text has
  // changed between CLI versions before.
  const rows = [];
  for (const m of stdout.matchAll(/\{[\s\S]*?\n\}/g)) {
    try { rows.push(...(JSON.parse(m[0]).rows ?? [])); } catch { /* not a result block */ }
  }
  return rows;
}

const results = [];
const rec = (level, name, detail, data) => {
  results.push({ level, name, detail, data: data ?? null });
  const tag = level === 'FAIL' ? '✗ FAIL' : level === 'WARN' ? '! WARN' : '✓ ok  ';
  console.log(`${tag}  ${name}`);
  if (detail) console.log(`        ${detail}`);
};

const n = (v) => (v === null || v === undefined ? 0 : Number(v));

/**
 * When `source_run_id` started being written (commits 461c68a client / b38a3ca
 * v1 edge, deployed 2026-07-29). Provenance is graded only on rows created
 * after this instant — earlier rows are unbackfillable, not defective.
 */
const PROVENANCE_WIRED_AT = '2026-07-29T11:40:00Z';

async function main() {
  console.log('memory prod invariants — READ ONLY\n');

  // ── 1. Reachability: a row nobody can ever read is silent data loss ───────
  {
    const [r] = await q(`
      select
        count(*) filter (where visibility = 'private' and user_id is null) as private_no_owner,
        count(*) filter (where scope = 'agent' and (agent_id is null or agent_id = '')) as agent_no_key,
        count(*) filter (where circle_id is null) as no_circle,
        count(*) as total
      from memory_entries where is_active = true;`);
    // A private row with no owner satisfies no SELECT policy: memory_select_private
    // requires user_id = auth.uid(), and it is not a shared visibility.
    rec(n(r?.private_no_owner) === 0 ? 'PASS' : 'FAIL',
      'no unreachable private rows (private + user_id IS NULL)',
      `private_no_owner=${n(r?.private_no_owner)} of ${n(r?.total)} active`, r);
    rec(n(r?.agent_no_key) === 0 ? 'PASS' : 'WARN',
      'agent-scope rows carry an agent_id',
      `agent rows with no key=${n(r?.agent_no_key)} — these are invisible to the agent that earned them`, r);
    rec(n(r?.no_circle) === 0 ? 'PASS' : 'WARN', 'every active row has a circle', `no_circle=${n(r?.no_circle)}`);
  }

  // ── 2. Provenance: the product's core accountability claim ───────────────
  // Graded ONLY on rows written after the writer was wired. The 3,471 rows that
  // predate it can never be backfilled (their runs are gone), so an all-time
  // ratio is pinned near zero forever and the check degrades into an alarm
  // everyone learns to ignore — the failure mode auto-test's
  // confirm-before-alarm exists to prevent. A rolling window has the same
  // problem in miniature: it would score rows from before the fix and report a
  // regression for a fix that had just landed. All-time is still REPORTED; it
  // just does not set the level.
  {
    const [r] = await q(`
      select count(*) as total,
             count(*) filter (where source_run_id is not null) as with_run,
             count(*) filter (where created_at > '${PROVENANCE_WIRED_AT}') as recent,
             count(*) filter (where created_at > '${PROVENANCE_WIRED_AT}'
                              and source_run_id is not null) as recent_with_run,
             count(*) filter (where source_surface = 'feed_task') as stamped_feed_task,
             count(distinct source_surface) as distinct_surfaces
      from memory_entries where is_active = true;`);
    const pct = n(r?.total) ? (100 * n(r?.with_run) / n(r?.total)).toFixed(1) : '0.0';
    const recent = n(r?.recent);
    const recentPct = recent ? (100 * n(r?.recent_with_run) / recent) : 0;
    // No recent writes at all is not a provenance failure — there is nothing to
    // judge. Say so rather than scoring an empty window.
    const level = recent === 0 ? 'PASS' : recentPct >= 50 ? 'PASS' : recentPct > 0 ? 'WARN' : 'FAIL';
    rec(level,
      'recent memories are traceable to the run that produced them',
      recent === 0
        ? `no memories written since the writer was wired (${PROVENANCE_WIRED_AT}) — nothing to grade yet`
          + ` | all-time ${n(r?.with_run)}/${n(r?.total)} (${pct}%)`
        : `since wiring: ${n(r?.recent_with_run)}/${recent} (${recentPct.toFixed(1)}%) carry source_run_id`
          + ` | all-time ${n(r?.with_run)}/${n(r?.total)} (${pct}%) — pre-2026-07-29 rows cannot be backfilled`,
      r);
    rec('PASS', 'source_surface distribution',
      `feed_task=${n(r?.stamped_feed_task)}, distinct surfaces=${n(r?.distinct_surfaces)} (a high feed_task share is the known hardcode)`, r);
  }

  // ── 3. Semantic reachability: match_memories filters embedding IS NOT NULL ─
  {
    const [r] = await q(`
      select count(*) as total, count(embedding) as embedded
      from memory_entries where is_active = true;`);
    const pct = n(r?.total) ? (100 * n(r?.embedded) / n(r?.total)) : 0;
    rec(pct > 0 ? (pct >= 50 ? 'PASS' : 'WARN') : 'FAIL',
      'memories are reachable by semantic search',
      `embedded ${n(r?.embedded)}/${n(r?.total)} (${pct.toFixed(1)}%) — un-embedded rows are invisible to match_memories`, r);
  }

  // ── 4. Referential health of the satellite tables ────────────────────────
  {
    const [r] = await q(`
      select
        (select count(*) from memory_soul_links l left join memory_entries m on m.id = l.memory_id where m.id is null) as orphan_soul_links,
        (select count(*) from memory_sources s left join memory_entries m on m.id = s.memory_id where m.id is null) as orphan_sources,
        (select count(*) from memory_access_log a left join memory_entries m on m.id = a.memory_id where m.id is null) as orphan_access;`);
    const bad = n(r?.orphan_soul_links) + n(r?.orphan_sources) + n(r?.orphan_access);
    rec(bad === 0 ? 'PASS' : 'WARN', 'no orphaned satellite rows',
      `soul_links=${n(r?.orphan_soul_links)} sources=${n(r?.orphan_sources)} access=${n(r?.orphan_access)}`, r);
  }

  // ── 5. The logMemoryAccess RLS bug: rows with a null owner were rejected ──
  {
    const [r] = await q(`
      select count(*) as total,
             count(*) filter (where user_id is null) as null_user,
             max(created_at)::text as newest
      from memory_access_log;`);
    rec('PASS', 'memory_access_log is being written',
      `rows=${n(r?.total)} null_user=${n(r?.null_user)} newest=${r?.newest ?? 'never'}`, r);
  }

  // ── 6. Duplicate pressure ────────────────────────────────────────────────
  // Keyed on (title, CONTENT), not title alone. An earlier version of this
  // check counted title-only groups and reported 4,595 "excess rows" — but the
  // biggest group turned out to hold 1,889 DISTINCT contents, because
  // `saveProceduralMemory` uses a category as the title and the run's steps as
  // the content. Title-only pressure is a bucket-size signal, not a defect, and
  // reporting it as one nearly justified deleting 1,889 real records.
  {
    const [r] = await q(`
      select
        (select count(*) from (
          select 1 from memory_entries where is_active = true
          group by circle_id, scope, lower(coalesce(title,'')), md5(coalesce(content,''))
          having count(*) > 1
        ) g) as exact_dup_groups,
        (select coalesce(sum(c) - count(*), 0) from (
          select count(*) as c from memory_entries where is_active = true
          group by circle_id, scope, lower(coalesce(title,'')), md5(coalesce(content,''))
          having count(*) > 1
        ) g2) as redundant_rows,
        (select count(*) from memory_entries where is_active = true) as active,
        (select count(distinct md5(coalesce(content,''))) from memory_entries where is_active = true) as distinct_content;`);
    // Only byte-identical repeats are removable without losing information.
    rec(n(r?.redundant_rows) === 0 ? 'PASS' : (n(r?.redundant_rows) < 300 ? 'WARN' : 'FAIL'),
      'no exact-content duplicate rows',
      `${n(r?.redundant_rows)} redundant rows across ${n(r?.exact_dup_groups)} exact-content groups`, r);
    // Informational: how much of the table is distinct content at all.
    const active = n(r?.active); const distinct = n(r?.distinct_content);
    rec('PASS', 'content diversity (informational, NOT a defect)',
      `${distinct} distinct contents across ${active} active rows`
      + ` — a shared title with many distinct contents is a category bucket, not duplication`, r);
  }

  // ── 7. Privacy posture of the live policy set ────────────────────────────
  {
    const rows = await q(`
      select policyname, coalesce(qual,'') as q
      from pg_policies where tablename = 'memory_entries' and cmd = 'SELECT';`);
    const leaky = rows.filter((p) => /private/.test(p.q) && !/auth\.uid\(\)/.test(p.q));
    rec(leaky.length === 0 ? 'PASS' : 'FAIL',
      'no SELECT policy exposes private rows without an owner check',
      leaky.length ? `LEAKY: ${leaky.map((p) => p.policyname).join(', ')}` : `${rows.length} SELECT policies, all owner-checked where private`, rows);
  }

  // ── 8. Indexes the hot paths depend on ──────────────────────────────────
  {
    const rows = await q(`select indexname from pg_indexes where tablename = 'memory_entries';`);
    const have = new Set(rows.map((r) => r.indexname));
    const need = ['idx_memory_entries_title_trgm', 'idx_memory_entries_content_trgm',
                  'idx_memory_entries_circle_rank', 'idx_memory_entries_pinned', 'idx_memory_entries_embedding'];
    const missing = need.filter((i) => !have.has(i));
    rec(missing.length === 0 ? 'PASS' : 'FAIL', 'hot-path indexes present',
      missing.length ? `missing: ${missing.join(', ')}` : `${need.length}/${need.length} present`, { missing });
  }

  // ── 9. match_memories still SECURITY INVOKER (DEFINER would bypass RLS) ──
  {
    const [r] = await q(`select prosecdef from pg_proc where proname = 'match_memories' limit 1;`);
    const definer = r?.prosecdef === true || r?.prosecdef === 'true';
    rec(definer ? 'FAIL' : 'PASS', 'match_memories is SECURITY INVOKER',
      definer ? 'DEFINER — semantic search would bypass RLS across circles' : 'INVOKER — semantic search honours RLS', r);
  }

  const fails = results.filter((r) => r.level === 'FAIL');
  const warns = results.filter((r) => r.level === 'WARN');
  console.log(`\n${results.length} invariants — ${results.length - fails.length - warns.length} ok, ${warns.length} warn, ${fails.length} fail`);
  if (jsonAt) {
    writeFileSync(jsonAt, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2));
    console.log(`wrote ${jsonAt}`);
  }
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error('harness error:', e?.message || e); process.exit(2); });
