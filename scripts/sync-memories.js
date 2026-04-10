/**
 * Memory Sync — Pulls agent memories from Supabase and writes them to local files
 * that Claude Code / Cursor / Codex can read on session start.
 *
 * Run: node scripts/sync-memories.js
 * Or add to start-dev.js for automatic sync on dev server start.
 *
 * Writes to: .agent-memory/context.md (gitignored)
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load env
const envPath = path.join(__dirname, '..', '.env');
let env = {};
try {
  const raw = fs.readFileSync(envPath, 'utf-8');
  for (const line of raw.replace(/\r/g, '').split('\n')) {
    const eqIdx = line.indexOf('=');
    if (eqIdx > 0 && line[0] !== '#') {
      const key = line.slice(0, eqIdx).trim();
      const val = line.slice(eqIdx + 1).trim();
      if (key && val) env[key] = val;
    }
  }
} catch { console.error('[sync-memories] No .env file found'); process.exit(1); }

const SUPABASE_URL = env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[sync-memories] Missing SUPABASE_URL or ANON_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const OUTPUT_DIR = path.join(__dirname, '..', '.agent-memory');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'context.md');

// Circle ID — use the default circle from the .env or hardcode
const CIRCLE_ID = env.EXPO_PUBLIC_DEFAULT_CIRCLE_ID || 'fcccaa73-2d48-4a90-8c19-c556b19f89dc';

async function sync() {
  console.log('[sync-memories] Fetching memories from Supabase...');

  // Fetch all active memories for this circle (no auth needed for circle_shared)
  const { data: memories, error } = await supabase
    .from('memory_entries')
    .select('*')
    .eq('circle_id', CIRCLE_ID)
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
    .limit(100);

  if (error) {
    console.error('[sync-memories] Supabase error:', error.message);
    // Still write an empty file so agents don't fail on missing file
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, '# Agent Memory\n\nNo memories loaded (Supabase error).\n');
    return;
  }

  if (!memories || memories.length === 0) {
    console.log('[sync-memories] No memories found');
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    fs.writeFileSync(OUTPUT_FILE, '# Agent Memory\n\nNo memories saved yet. Use the app to build context.\n');
    return;
  }

  // Group by scope and kind
  const sessions = memories.filter(m => m.scope === 'session');
  const circle = memories.filter(m => m.scope === 'circle');
  const user = memories.filter(m => m.scope === 'user');

  const lines = [
    '# Agent Memory',
    `> Auto-synced from Supabase at ${new Date().toISOString()}`,
    `> ${memories.length} memories loaded for circle ${CIRCLE_ID}`,
    '',
  ];

  // Session context (what agents have been working on)
  if (sessions.length > 0) {
    lines.push('## Recent Agent Sessions');
    for (const m of sessions.slice(0, 10)) {
      lines.push(`### ${m.title}`);
      lines.push(m.content);
      lines.push(`_Source: ${m.source_surface || 'unknown'} | Updated: ${m.updated_at}_`);
      lines.push('');
    }
  }

  // Circle knowledge (shared decisions, facts)
  if (circle.length > 0) {
    lines.push('## Circle Knowledge');
    for (const m of circle.slice(0, 20)) {
      const kind = m.memory_kind || 'fact';
      lines.push(`- **[${kind}]** ${m.title}: ${m.content}`);
    }
    lines.push('');
  }

  // User preferences and instructions
  if (user.length > 0) {
    lines.push('## User Preferences & Instructions');
    for (const m of user.slice(0, 20)) {
      const kind = m.memory_kind || 'preference';
      lines.push(`- **[${kind}]** ${m.title}: ${m.content}`);
    }
    lines.push('');
  }

  // Skills (instruction-type memories)
  const skills = memories.filter(m => m.memory_kind === 'instruction');
  if (skills.length > 0) {
    lines.push('## Agent Skills');
    for (const s of skills) {
      lines.push(`- ${s.title}: ${s.content}`);
    }
    lines.push('');
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, lines.join('\n'));
  console.log(`[sync-memories] Wrote ${memories.length} memories to ${OUTPUT_FILE}`);
}

sync().catch(err => {
  console.error('[sync-memories] Fatal error:', err);
  process.exit(1);
});
