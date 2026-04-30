#!/usr/bin/env node
/**
 * Cursor Bridge — Auto-detects Cursor AI agent sessions
 * Reads ~/.cursor/projects/ agent transcripts and terminal logs.
 * Serves session data via HTTP for The Underground Circle to consume.
 * Zero npm dependencies (Node.js built-ins only).
 *
 * Run: node scripts/cursor-bridge.js
 *
 * Data sources:
 *   ~/.cursor/projects/{project}/agent-transcripts/*.jsonl — conversation history
 *   ~/.cursor/projects/{project}/terminals/*.txt — terminal command logs
 *   ~/.cursor/ai-tracking/ai-code-tracking.db — AI code tracking (SQLite)
 *
 * Handles WSL ↔ Windows paths automatically.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PORT = 7781;
const BRIDGE_STARTED_AT = new Date().toISOString();
const ACTIVE_THRESHOLD = 300_000;   // 5min → active (Cursor sessions persist longer)
const IDLE_THRESHOLD = 86_400_000;  // 24h → include sessions from today
const SCAN_INTERVAL = 5000;
const TAIL_BYTES = 32768;           // Read last 32KB of each transcript

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UC-Desktop-Token',
  'Access-Control-Allow-Private-Network': 'true',
  'Content-Type': 'application/json',
};

function getOrCreateBridgeToken() {
  const tokenPath = path.join(os.homedir(), '.uc-desktop-token');
  try {
    if (fs.existsSync(tokenPath)) {
      const existing = fs.readFileSync(tokenPath, 'utf-8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {}
  const crypto = require('crypto');
  const token = crypto.randomBytes(24).toString('hex');
  try { fs.writeFileSync(tokenPath, token + '\n', { mode: 0o600 }); } catch {}
  return token;
}

function hasValidBridgeToken(req) {
  const value = req.headers['x-uc-desktop-token'];
  const sent = Array.isArray(value) ? value[0] : value;
  return !!sent && sent === getOrCreateBridgeToken();
}

function isAllowedBridgeOrigin(req) {
  const origin = String(req.headers.origin || req.headers.referer || '');
  if (!origin) return true;
  try {
    const host = new URL(origin).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === 'app.chrisswanson.xyz';
  } catch {
    return false;
  }
}

let cachedSessions = [];
let lastScanTime = '';

// ── WSL-aware path resolution ────────────────────────────────────────────────

function isWSL() {
  try {
    const ver = fs.readFileSync('/proc/version', 'utf-8');
    return /microsoft|wsl/i.test(ver);
  } catch { return false; }
}

function getWindowsHome() {
  try {
    const out = execSync('cmd.exe /c "echo %USERPROFILE%" 2>/dev/null', {
      timeout: 5000, encoding: 'utf-8',
    }).trim().replace(/\r/g, '');
    return out.replace(/^([A-Z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
  } catch { return ''; }
}

function resolveCursorDir() {
  // Try Linux home first
  const linuxDir = path.join(os.homedir(), '.cursor');
  if (fs.existsSync(path.join(linuxDir, 'projects'))) {
    return linuxDir;
  }

  // On WSL, try the Windows home
  if (isWSL()) {
    const winHome = getWindowsHome();
    if (winHome) {
      const winDir = path.join(winHome, '.cursor');
      if (fs.existsSync(winDir)) return winDir;
    }
    // Common fallback
    const fallback = '/mnt/c/Users';
    try {
      const users = fs.readdirSync(fallback);
      for (const user of users) {
        const candidate = path.join(fallback, user, '.cursor');
        if (fs.existsSync(path.join(candidate, 'projects'))) {
          return candidate;
        }
      }
    } catch {}
  }

  return linuxDir;
}

const CURSOR_DIR = resolveCursorDir();
const PROJECTS_DIR = path.join(CURSOR_DIR, 'projects');

// ── Tail-read a JSONL file ───────────────────────────────────────────────────

function tailReadJsonl(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return [];
    const readSize = Math.min(TAIL_BYTES, stat.size);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf-8').split('\n');
    const startIdx = readSize < stat.size ? 1 : 0;
    const entries = [];
    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      try { entries.push(JSON.parse(line)); } catch {}
    }
    return entries;
  } catch { return []; }
}

// ── Extract text from Cursor message content ─────────────────────────────────

function extractText(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(c => c && c.type === 'text')
      .map(c => c.text || '')
      .join('\n')
      .slice(0, 500);
  }
  return '';
}

// ── Parse a Cursor agent transcript ──────────────────────────────────────────

function parseTranscript(filePath, fstat, projectName) {
  try {
    const entries = tailReadJsonl(filePath);
    if (entries.length === 0) return null;

    const age = Date.now() - fstat.mtimeMs;
    if (age > IDLE_THRESHOLD) return null;

    const sessionId = path.basename(path.dirname(filePath));
    let userMessages = 0;
    let assistantMessages = 0;
    let lastUserQuery = '';
    let model = 'cursor';
    const recentActions = [];

    for (const entry of entries) {
      const role = entry.role;
      const content = entry.message?.content;
      const text = extractText(content);

      if (role === 'user') {
        userMessages++;
        // Extract user query from <user_query> tags
        const queryMatch = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
        if (queryMatch) {
          lastUserQuery = queryMatch[1].trim().slice(0, 200);
        } else if (text.length > 5 && text.length < 500) {
          lastUserQuery = text.slice(0, 200);
        }
      }

      if (role === 'assistant') {
        assistantMessages++;
        // Detect tool usage from assistant text
        if (text.includes('file_edit') || text.includes('editing')) recentActions.push('file_edit');
        if (text.includes('terminal') || text.includes('command')) recentActions.push('terminal');
        if (text.includes('search') || text.includes('grep')) recentActions.push('search');
        if (text.includes('read') || text.includes('reading')) recentActions.push('read_file');
      }

      // Check for model info in metadata
      if (entry.model) model = entry.model;
      if (entry.metadata?.model) model = entry.metadata.model;
    }

    // Resolve project directory from the project hash name
    let projectDir = '';
    if (projectName) {
      // Cursor project hash format: c-Users-chris-UC-the-underground-circle
      // Convert back to path: /mnt/c/Users/chris/UC/the-underground-circle
      projectDir = projectName
        .replace(/^c-/, '/mnt/c/')
        .replace(/^wsl-Ubuntu-/, '/home/')
        .replace(/-/g, '/');
    }

    return {
      sessionId,
      projectDir,
      projectHash: projectName,
      model,
      status: age < ACTIVE_THRESHOLD ? 'active' : 'idle',
      kind: 'agent',
      task: lastUserQuery || 'Cursor agent session',
      lastActivity: new Date(fstat.mtimeMs).toISOString(),
      totalInputTokens: 0,
      totalOutputTokens: 0,
      messageCount: userMessages + assistantMessages,
      userMessages,
      assistantMessages,
      recentActions: [...new Set(recentActions)].slice(-5),
    };
  } catch {
    return null;
  }
}

// ── Scan for Cursor sessions ─────────────────────────────────────────────────

function scanSessions() {
  const sessions = [];

  if (!fs.existsSync(PROJECTS_DIR)) return sessions;

  let projectDirs;
  try { projectDirs = fs.readdirSync(PROJECTS_DIR); } catch { return sessions; }

  for (const projName of projectDirs) {
    const projPath = path.join(PROJECTS_DIR, projName);
    let projStat;
    try { projStat = fs.statSync(projPath); } catch { continue; }
    if (!projStat.isDirectory()) continue;

    // Scan agent-transcripts
    const transcriptsDir = path.join(projPath, 'agent-transcripts');
    if (fs.existsSync(transcriptsDir)) {
      try {
        const transcriptDirs = fs.readdirSync(transcriptsDir);
        for (const tDir of transcriptDirs) {
          const tPath = path.join(transcriptsDir, tDir);
          try {
            if (!fs.statSync(tPath).isDirectory()) continue;
          } catch { continue; }

          // Find the JSONL file inside
          const files = fs.readdirSync(tPath).filter(f => f.endsWith('.jsonl'));
          for (const file of files) {
            const filePath = path.join(tPath, file);
            let fstat;
            try { fstat = fs.statSync(filePath); } catch { continue; }

            const session = parseTranscript(filePath, fstat, projName);
            if (session) sessions.push(session);
          }
        }
      } catch {}
    }
  }

  return sessions;
}

// ── Periodic scan ────────────────────────────────────────────────────────────

function doScan() {
  try {
    cachedSessions = scanSessions();
    lastScanTime = new Date().toISOString();
  } catch (err) {
    console.error('[cursor-bridge] Scan error:', err.message);
  }
}

doScan();
setInterval(doScan, SCAN_INTERVAL);

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  if (url !== '/health' && url !== '/pair' && !hasValidBridgeToken(req)) {
    res.writeHead(401, CORS);
    res.end(JSON.stringify({ ok: false, error: 'Missing or invalid bridge token.' }));
    return;
  }

  if (url === '/health') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      bridge: 'cursor',
      version: '1.0.0',
      sessions: cachedSessions.length,
      cursorDir: CURSOR_DIR,
      capabilities: ['sessions', 'update'],
      auth: 'n/a',
      uptime_s: Math.round(process.uptime()),
      started_at: BRIDGE_STARTED_AT,
    }));
    return;
  }

  if (url === '/pair' && req.method === 'POST') {
    if (!isAllowedBridgeOrigin(req)) {
      res.writeHead(403, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: only local/app origins allowed' }));
      return;
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      token: getOrCreateBridgeToken(),
      tokenFile: '~/.uc-desktop-token',
    }));
    return;
  }

  if (url === '/sessions') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      sessions: cachedSessions,
      timestamp: lastScanTime,
    }));
    return;
  }

  // ── POST /update — queue a task for an existing Cursor session ──────────
  // Cursor's CLI runs interactively; we can't programmatically dispatch.
  // What we CAN do is annotate the session row so the user sees the
  // pending task next time they open the Cursor UI / next session refresh.
  // Body: { sessionId, task } — both required.
  if (url === '/update' && req.method === 'POST') {
    if (!isAllowedBridgeOrigin(req)) {
      res.writeHead(403, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: only local/app origins allowed' }));
      return;
    }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8192) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
        return;
      }
      const sessionId = String(parsed.sessionId || '').trim();
      const task = String(parsed.task || '').trim();
      if (!sessionId || !task) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Missing sessionId or task' }));
        return;
      }
      // Find the session in cache and annotate.
      const idx = cachedSessions.findIndex(s => s.sessionId === sessionId);
      if (idx === -1) {
        res.writeHead(404, CORS);
        res.end(JSON.stringify({ ok: false, error: `Session ${sessionId} not found. Available: ${cachedSessions.map(s => s.sessionId).join(', ') || '(none)'}` }));
        return;
      }
      cachedSessions[idx] = {
        ...cachedSessions[idx],
        task,
        queuedAt: new Date().toISOString(),
        recentActions: [...(cachedSessions[idx].recentActions || []), 'queued_task'].slice(-5),
      };
      res.writeHead(200, CORS);
      res.end(JSON.stringify({
        ok: true,
        sessionId,
        message: 'Task queued. Visible on next Cursor session refresh.',
        session: cachedSessions[idx],
      }));
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: 'Not found. Use /health, /sessions, or /update' }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Kill it with: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  }
  console.error('[cursor-bridge] Server error:', err.message);
});

process.on('uncaughtException', (err) => console.error('[cursor-bridge] Uncaught:', err.message));

server.listen(PORT, () => {
  console.log(`\n  Cursor Bridge`);
  console.log(`  Serving on http://localhost:${PORT}`);
  console.log(`  Scanning ${PROJECTS_DIR}`);
  console.log(`  Found ${cachedSessions.length} session(s)\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /health    — Bridge status`);
  console.log(`    GET  /sessions  — Active Cursor sessions\n`);
});
