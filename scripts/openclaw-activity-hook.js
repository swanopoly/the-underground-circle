#!/usr/bin/env node
/**
 * OpenClaw Activity Hook
 * 
 * Logs agent activity to Supabase agent_activity table.
 * Can be called directly or piped JSON via stdin.
 * 
 * Usage:
 *   echo '{"source":"discord","activity_type":"message_in","title":"Swan asked me to update the UI"}' | node openclaw-activity-hook.js
 * 
 * Or with args:
 *   node openclaw-activity-hook.js --source discord --type task_completed --title "Updated Office UI" --body "Added 3 files"
 * 
 * Required env vars:
 *   SUPABASE_URL          - e.g. https://rjkniqiqdtroeholxacg.supabase.co
 *   SUPABASE_SERVICE_KEY  - service role key (NOT anon key — needs insert without auth)
 *   ACTIVITY_CIRCLE_ID    - the circle to log activity to
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://rjkniqiqdtroeholxacg.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || '';
const CIRCLE_ID = process.env.ACTIVITY_CIRCLE_ID || '';

if (!SUPABASE_KEY) {
  process.stderr.write('[openclaw-activity-hook] ERROR: SUPABASE_SERVICE_KEY not set\n');
  process.exit(1);
}
if (!CIRCLE_ID) {
  process.stderr.write('[openclaw-activity-hook] ERROR: ACTIVITY_CIRCLE_ID not set\n');
  process.exit(1);
}

async function insertActivity(payload) {
  const body = JSON.stringify({
    circle_id: CIRCLE_ID,
    agent_name: payload.agent_name || 'SwanBot',
    source: payload.source || 'system',
    source_detail: payload.source_detail || null,
    activity_type: payload.activity_type || 'task_completed',
    title: payload.title || '(no title)',
    body: payload.body || null,
    status: payload.status || 'completed',
    metadata: payload.metadata || {},
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_activity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    process.stderr.write(`[openclaw-activity-hook] Insert failed ${res.status}: ${text}\n`);
    process.exit(1);
  }

  process.stderr.write(`[openclaw-activity-hook] Logged: ${payload.title}\n`);
}

// Parse stdin JSON or CLI args
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      result[key] = args[i + 1] || true;
      i++;
    }
  }
  // Map CLI flag names to DB column names
  if (result.type) { result.activity_type = result.type; delete result.type; }
  if (result.detail) { result.source_detail = result.detail; delete result.detail; }
  return result;
}

async function main() {
  let payload = parseArgs();

  // If stdin has data, prefer it (allows piping JSON)
  if (!process.stdin.isTTY) {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString().trim();
    if (raw) {
      try {
        const fromStdin = JSON.parse(raw);
        payload = { ...payload, ...fromStdin };
      } catch {
        process.stderr.write('[openclaw-activity-hook] Could not parse stdin JSON\n');
      }
    }
  }

  if (!payload.title) {
    process.stderr.write('[openclaw-activity-hook] ERROR: title is required\n');
    process.exit(1);
  }

  await insertActivity(payload);
}

main().catch(err => {
  process.stderr.write(`[openclaw-activity-hook] FATAL: ${err.message}\n`);
  process.exit(1);
});

// ─── Project Room logging (optional) ────────────────────────────────────────
// If ACTIVITY_ROOM_ID is set, also logs to project_room_activity
async function logToRoom(payload) {
  const roomId = process.env.ACTIVITY_ROOM_ID;
  const circleId = process.env.ACTIVITY_CIRCLE_ID;
  if (!roomId || !circleId) return;

  const body = JSON.stringify({
    room_id: roomId,
    circle_id: circleId,
    agent_session_key: payload.agent_session_key || 'swanbot-main',
    agent_name: payload.agent_name || 'SwanBot',
    activity_type: payload.activity_type || 'task_completed',
    title: payload.title,
    body: payload.body || null,
    metadata: payload.metadata || {},
  });

  const res = await fetch(`${SUPABASE_URL}/rest/v1/project_room_activity`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': 'return=minimal',
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    process.stderr.write(`[openclaw-activity-hook] Room log failed ${res.status}: ${text}\n`);
  }
}
