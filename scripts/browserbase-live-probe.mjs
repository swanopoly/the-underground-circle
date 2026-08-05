#!/usr/bin/env node
/**
 * browserbase-live-probe.mjs — R8.0 live go/no-go probe (ENABLEMENT ONLY).
 *
 * Changes NO app runtime path. Run manually against YOUR OWN Browserbase
 * account to answer the four gated R8 questions before the CDP migration:
 *
 *   Q0  Does POST https://api.browserbase.com/v1/sessions return a CDP
 *       `connectUrl`? (the migration target)
 *   Q1  Does GET  https://api.browserbase.com/v1/sessions/{id}/debug return
 *       `debuggerFullscreenUrl`? (R11 live-view / takeover URL)
 *   Q2  Does the LEGACY POST https://www.browserbase.com/v1/sessions/{id}/commands
 *       endpoint still exist? (R8 must keep the fallback while it EXISTS)
 *   Q3  Can a Context be created? (R9 persistent-login enablement)
 *
 * GO for R8.0 IFF Q0 (connectUrl) PASS AND Q1 (debug) PASS.
 *
 * Safety:
 *   - Reads BROWSERBASE_API_KEY + BROWSERBASE_PROJECT_ID from env ONLY.
 *     Never accepts secrets as argv; never prints them (masked + redacted).
 *   - Always releases any session it creates (browser-minutes cost).
 *   - Best-effort context cleanup; reports the id if it cannot delete.
 *   - Each probe is isolated so one failure does not abort the others.
 *
 * Requires Node >= 18 (native fetch + AbortSignal.timeout).
 */

const API_BASE = 'https://api.browserbase.com';
const LEGACY_BASE = 'https://www.browserbase.com';
const TIMEOUT_MS = 20000;

const apiKey = process.env.BROWSERBASE_API_KEY;
const projectId = process.env.BROWSERBASE_PROJECT_ID;

// ── Secret-safe printing ─────────────────────────────────────────────────────

function mask(secret) {
  if (!secret) return '<missing>';
  return `${secret.slice(0, 4)}...(${secret.length} chars)`;
}

/** Strip the live key value (and the project id) from any text before print. */
function redact(text) {
  if (typeof text !== 'string') return text;
  let out = text;
  if (apiKey) out = out.split(apiKey).join('[redacted-key]');
  if (projectId) out = out.split(projectId).join('[redacted-project]');
  return out;
}

function shortBody(text) {
  if (typeof text !== 'string') return '';
  return redact(text.slice(0, 300));
}

// ── Env gate (no network until creds are present) ────────────────────────────

if (!apiKey || !projectId) {
  console.error('R8.0 Browserbase live-probe — missing env, no network call made.\n');
  console.error(`  BROWSERBASE_API_KEY    = ${mask(apiKey)}`);
  console.error(`  BROWSERBASE_PROJECT_ID = ${projectId ? '[present]' : '<missing>'}\n`);
  console.error('Export both, then re-run. The script reads from env, never argv:\n');
  console.error('  export BROWSERBASE_API_KEY=...');
  console.error('  export BROWSERBASE_PROJECT_ID=...');
  console.error('  node scripts/browserbase-live-probe.mjs\n');
  process.exit(2);
}

// ── HTTP helper ──────────────────────────────────────────────────────────────

async function call(base, path, method, body) {
  const headers = { 'X-BB-API-Key': apiKey, 'Content-Type': 'application/json' };
  let res;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return { networkError: redact(String(err?.message || err)) };
  }
  const raw = await res.text().catch(() => '');
  let json;
  try { json = raw ? JSON.parse(raw) : undefined; } catch { json = undefined; }
  return { status: res.status, ok: res.ok, json, raw };
}

// ── Result accumulation ──────────────────────────────────────────────────────

const results = [];
function record(q, label, verdict, detail) {
  results.push({ q, label, verdict, detail });
  console.error(`[${verdict.padEnd(12)}] ${q} ${label}${detail ? ` — ${detail}` : ''}`);
}

let createdSessionId = null;
let createdContextId = null;

async function main() {
  console.error('R8.0 Browserbase live-probe (enablement only; changes no app runtime path)');
  console.error(`  key=${mask(apiKey)} project=[present]\n`);

  // Q0 — session create + connectUrl
  const session = await call(API_BASE, '/v1/sessions', 'POST', {
    projectId,
    keepAlive: false,
    timeout: 60,
  });
  if (session.networkError) {
    record('Q0', 'session create + connectUrl', 'INCONCLUSIVE', `network: ${session.networkError}`);
  } else if (!session.ok) {
    const hint = session.status === 401 || session.status === 403
      ? 'bad credentials — check BROWSERBASE_API_KEY/PROJECT_ID'
      : session.status === 404
        ? 'api host/route changed (api.browserbase.com/v1/sessions 404)'
        : shortBody(session.raw);
    record('Q0', 'session create + connectUrl', 'FAIL', `HTTP ${session.status} ${hint}`);
  } else {
    createdSessionId = session.json?.id || null;
    const connectUrl = session.json?.connectUrl;
    if (connectUrl && /^wss?:\/\//i.test(String(connectUrl))) {
      record('Q0', 'session create + connectUrl', 'PASS', `connectUrl present (wss, ${String(connectUrl).length} chars)`);
    } else if (connectUrl) {
      record('Q0', 'session create + connectUrl', 'PASS', `connectUrl present (non-wss scheme, ${String(connectUrl).length} chars)`);
    } else {
      record('Q0', 'session create + connectUrl', 'FAIL', 'session created but NO connectUrl field');
    }
  }

  // Q1 — debug / live-view URL (needs a session)
  if (createdSessionId) {
    const dbg = await call(API_BASE, `/v1/sessions/${createdSessionId}/debug`, 'GET');
    if (dbg.networkError) {
      record('Q1', 'debug/live-view URL', 'INCONCLUSIVE', `network: ${dbg.networkError}`);
    } else if (!dbg.ok) {
      record('Q1', 'debug/live-view URL', 'FAIL', `HTTP ${dbg.status} ${shortBody(dbg.raw)}`);
    } else {
      const full = dbg.json?.debuggerFullscreenUrl;
      const basic = dbg.json?.debuggerUrl;
      const pages = Array.isArray(dbg.json?.pages) ? dbg.json.pages.length : 0;
      if (full) {
        record('Q1', 'debug/live-view URL', 'PASS', `debuggerFullscreenUrl present${basic ? ', debuggerUrl present' : ''}, pages=${pages}`);
      } else {
        record('Q1', 'debug/live-view URL', 'FAIL', `no debuggerFullscreenUrl${basic ? ' (debuggerUrl present)' : ''}, pages=${pages}`);
      }
    }
  } else {
    record('Q1', 'debug/live-view URL', 'INCONCLUSIVE', 'no session id (Q0 did not yield one)');
  }

  // Q2 — legacy /commands existence (probe only; do NOT depend on it).
  // Body shape mirrors computer-use-agent/index.ts:1432.
  if (createdSessionId) {
    const cmd = await call(LEGACY_BASE, `/v1/sessions/${createdSessionId}/commands`, 'POST', {
      command: 'screenshot',
      params: {},
      returnScreenshot: false,
    });
    if (cmd.networkError) {
      record('Q2', 'legacy /commands endpoint', 'INCONCLUSIVE', `network: ${cmd.networkError}`);
    } else if (cmd.status === 404 || cmd.status === 410) {
      record('Q2', 'legacy /commands endpoint', 'GONE', `HTTP ${cmd.status} — safe to remove fallback after a flag bake`);
    } else {
      record('Q2', 'legacy /commands endpoint', 'EXISTS', `HTTP ${cmd.status} — R8 MUST keep the legacy fallback`);
    }
  } else {
    record('Q2', 'legacy /commands endpoint', 'INCONCLUSIVE', 'no session id to probe against');
  }

  // Q3 — context create (R9 enablement)
  const ctx = await call(API_BASE, '/v1/contexts', 'POST', { projectId });
  if (ctx.networkError) {
    record('Q3', 'context create (R9)', 'INCONCLUSIVE', `network: ${ctx.networkError}`);
  } else if (ctx.ok && ctx.json?.id) {
    createdContextId = ctx.json.id;
    record('Q3', 'context create (R9)', 'PASS', `context id created (id length ${String(ctx.json.id).length})`);
  } else {
    record('Q3', 'context create (R9)', 'FAIL', `HTTP ${ctx.status} ${shortBody(ctx.raw)}`);
  }
}

// ── Cleanup (always) ─────────────────────────────────────────────────────────

async function cleanup() {
  if (createdSessionId) {
    const rel = await call(API_BASE, `/v1/sessions/${createdSessionId}`, 'POST', {
      projectId,
      status: 'REQUEST_RELEASE',
    });
    if (rel.ok) {
      console.error(`cleanup: released session ${createdSessionId.slice(0, 6)}...`);
    } else {
      console.error(`cleanup: WARN could not release session ${createdSessionId.slice(0, 6)}... (HTTP ${rel.status || rel.networkError}) — release manually in the dashboard`);
    }
  }
  if (createdContextId) {
    const del = await call(API_BASE, `/v1/contexts/${createdContextId}`, 'DELETE');
    if (del.ok) {
      console.error(`cleanup: deleted context ${createdContextId.slice(0, 6)}...`);
    } else {
      console.error(`cleanup: context ${createdContextId.slice(0, 6)}... persists (DELETE HTTP ${del.status || del.networkError}) — remove it in the dashboard if undesired`);
    }
  }
}

// ── Summary + exit ───────────────────────────────────────────────────────────

function summarize() {
  const get = (q) => results.find((r) => r.q === q);
  const q0 = get('Q0');
  const q1 = get('Q1');
  const q2 = get('Q2');
  const q3 = get('Q3');

  console.error('\n──────── R8.0 SUMMARY ────────');
  for (const r of results) {
    console.error(`  ${r.q}  ${r.verdict.padEnd(12)} ${r.label}`);
  }

  const go = q0?.verdict === 'PASS' && q1?.verdict === 'PASS';
  console.error('\n  GO rule: connectUrl (Q0) PASS AND debug (Q1) PASS');
  console.error(`  /commands (Q2): ${q2?.verdict || 'INCONCLUSIVE'} → ${q2?.verdict === 'GONE' ? 'removal safe after flag bake' : q2?.verdict === 'EXISTS' ? 'KEEP legacy fallback in R8' : 'verdict inconclusive — re-run before deciding'}`);
  console.error(`  context (Q3): ${q3?.verdict || 'INCONCLUSIVE'} → ${q3?.verdict === 'PASS' ? 'R9 persistent-login design unblocked' : 'R9 enablement unconfirmed'}`);
  console.error(`\n  ===> ${go ? 'GO for R8.0 (CDP migration)' : 'NO-GO for R8.0'} <===\n`);

  // exit 0 = GO; 1 = NO-GO/any FAIL (env-missing is handled earlier as exit 2)
  return go ? 0 : 1;
}

let exitCode = 1;
try {
  await main();
} catch (err) {
  console.error(`probe: unexpected error — ${redact(String(err?.message || err))}`);
} finally {
  await cleanup().catch(() => {});
  exitCode = summarize();
}
process.exit(exitCode);
