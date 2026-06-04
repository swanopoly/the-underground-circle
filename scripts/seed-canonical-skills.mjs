#!/usr/bin/env node
/**
 * seed-canonical-skills — upsert the canonical skills/<name>/SKILL.md into a
 * circle's `circle_skills` library via supabase-js.
 *
 * Prefers SUPABASE_SERVICE_ROLE_KEY (bypasses RLS — the intended path for
 * seeding). Falls back to the anon key, which is subject to the
 * `authors_write_skills` RLS policy (WITH CHECK author_id = auth.uid()) and so
 * only works inside an authenticated member session. Idempotent via
 * upsert(onConflict: 'circle_id,name').
 *
 * Usage:
 *   node scripts/seed-canonical-skills.mjs --circle <circle-uuid>
 *   (reads SUPABASE_URL/EXPO_PUBLIC_SUPABASE_URL +
 *    SUPABASE_SERVICE_ROLE_KEY or EXPO_PUBLIC_SUPABASE_ANON_KEY from env/.env)
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Load .env (KEY=VALUE), without overriding already-set env.
try {
  const env = readFileSync(join(repoRoot, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
} catch { /* no .env — rely on process env */ }

const circleArgIdx = process.argv.indexOf('--circle');
const circleId = (circleArgIdx >= 0 ? process.argv[circleArgIdx + 1] : '') || '';
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(circleId)) {
  console.error('Provide a full circle UUID: --circle <uuid>');
  process.exit(1);
}

const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const key = serviceKey || anonKey;
if (!url || !key) {
  console.error('Missing SUPABASE_URL and a key (service role preferred, else anon).');
  process.exit(1);
}
const mode = serviceKey ? 'service_role (RLS bypassed)' : 'anon (RLS applies — needs an author session)';
console.log(`[seed] target circle ${circleId} via ${mode}`);

const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const out = { name: '', description: '', version: '1.0.0', tags: [] };
  if (!m) return out;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.+?)\s*$/);
    if (!kv) continue;
    const value = kv[2].replace(/^['"]|['"]$/g, '');
    if (kv[1] === 'name') out.name = value;
    else if (kv[1] === 'description') out.description = value;
    else if (kv[1] === 'version') out.version = value;
    else if (kv[1] === 'tags') out.tags = value.replace(/^\[|\]$/g, '').split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return out;
}

const skillsDir = join(repoRoot, 'skills');
const names = readdirSync(skillsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(skillsDir, e.name, 'SKILL.md')))
  .map((e) => e.name).sort();

async function main() {
  // author_id = circle creator (best-effort; service role can always read).
  const { data: circle, error: circleErr } = await supabase
    .from('circles').select('id, created_by').eq('id', circleId).maybeSingle();
  if (circleErr) console.warn(`[seed] could not read circle (${circleErr.message}); author_id will be null`);
  if (!circle) console.warn('[seed] circle not visible to this key; proceeding (author_id null)');
  const authorId = circle?.created_by ?? null;

  const rows = names.map((name) => {
    const content = readFileSync(join(skillsDir, name, 'SKILL.md'), 'utf8');
    const fm = parseFrontmatter(content);
    return {
      circle_id: circleId,
      author_id: authorId,
      name: fm.name || name,
      description: fm.description,
      version: fm.version,
      tags: fm.tags,
      content,
    };
  });

  const { data, error } = await supabase
    .from('circle_skills')
    .upsert(rows, { onConflict: 'circle_id,name' })
    .select('name, version');

  if (error) {
    console.error(`[seed] FAILED: ${error.message}`);
    if (/row-level security|violates/i.test(error.message)) {
      console.error('[seed] RLS blocked the write. Use a SUPABASE_SERVICE_ROLE_KEY, or apply scripts/build-canonical-skills-seed.mjs SQL in the Supabase SQL editor.');
    }
    process.exit(2);
  }
  console.log(`[seed] OK — upserted ${data?.length ?? rows.length} skill(s): ${(data || rows).map((r) => r.name).join(', ')}`);
}

main().catch((e) => { console.error('[seed] threw:', e?.message || e); process.exit(2); });
