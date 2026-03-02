/**
 * Claude Code Bridge — Auto-detects running Claude Code sessions
 * Reads ~/.claude/projects/ JSONL files and serves session data via HTTP.
 * Zero npm dependencies (Node.js built-ins only).
 *
 * Run: node scripts/claude-bridge.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const PORT = 7778;
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
const ACTIVE_THRESHOLD = 30_000;   // 30s → active
const IDLE_THRESHOLD = 300_000;    // 5min → idle
const TAIL_BYTES = 16384;          // Read last 16KB of each JSONL
const SCAN_INTERVAL = 5000;        // Scan filesystem every 5s

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

let cachedSessions = [];
let lastScanTime = '';

// ── Tail-read a file and parse JSONL lines ──────────────────────────────────

function tailRead(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size === 0) return [];
    const readSize = Math.min(TAIL_BYTES, stat.size);
    const buf = Buffer.alloc(readSize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, readSize, stat.size - readSize);
    fs.closeSync(fd);
    const lines = buf.toString('utf-8').split('\n');
    // First line is likely partial — skip it unless we read from start
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

// ── Scan ~/.claude/projects/ for active sessions ────────────────────────────

function scanSessions() {
  if (!fs.existsSync(CLAUDE_DIR)) return [];
  const sessions = [];

  let projectDirs;
  try { projectDirs = fs.readdirSync(CLAUDE_DIR); } catch { return []; }

  for (const projHash of projectDirs) {
    const projPath = path.join(CLAUDE_DIR, projHash);
    let projStat;
    try { projStat = fs.statSync(projPath); } catch { continue; }
    if (!projStat.isDirectory()) continue;

    let files;
    try { files = fs.readdirSync(projPath); } catch { continue; }

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = path.join(projPath, file);
      let fstat;
      try { fstat = fs.statSync(filePath); } catch { continue; }

      const age = Date.now() - fstat.mtimeMs;
      if (age > IDLE_THRESHOLD) continue; // too old, skip

      const status = age < ACTIVE_THRESHOLD ? 'active' : 'idle';
      const sessionId = file.replace('.jsonl', '');
      const entries = tailRead(filePath);

      // Extract metadata from entries
      let model = 'unknown', projectDir = '', version = '', slug = '';
      let totalInput = 0, totalOutput = 0, cachedTokens = 0, newTokens = 0;
      let messageCount = 0, lastActivity = '';
      const recentActions = [];
      const seenTools = new Set();

      for (const entry of entries) {
        if (entry.sessionId) { /* already have sessionId from filename */ }
        if (entry.cwd && !projectDir) projectDir = entry.cwd;
        if (entry.version && !version) version = entry.version;
        if (entry.slug && !slug) slug = entry.slug;
        if (entry.timestamp) {
          if (!lastActivity || entry.timestamp > lastActivity) {
            lastActivity = entry.timestamp;
          }
        }

        // Extract from assistant messages
        if (entry.type === 'assistant' && entry.message) {
          messageCount++;
          if (entry.message.model) model = entry.message.model;
          const u = entry.message.usage;
          if (u) {
            totalInput += u.input_tokens || 0;
            totalOutput += u.output_tokens || 0;
            cachedTokens += u.cache_read_input_tokens || 0;
            const created = u.cache_creation_input_tokens || 0;
            newTokens += (u.input_tokens || 0) + created;
          }
          // Extract tool calls
          const content = entry.message.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (c.type === 'tool_use' && c.name && !seenTools.has(c.name)) {
                seenTools.add(c.name);
                recentActions.push(c.name);
              }
            }
          }
        }
      }

      // Count subagents
      let subagentCount = 0;
      const subagentDir = path.join(projPath, sessionId);
      if (fs.existsSync(subagentDir)) {
        try {
          const subFiles = fs.readdirSync(subagentDir);
          subagentCount = subFiles.filter(f => f.endsWith('.jsonl')).length;
        } catch {}
      }

      sessions.push({
        sessionId,
        projectDir,
        projectHash: projHash,
        model,
        status,
        kind: 'main',
        parentSessionId: null,
        slug,
        lastActivity: lastActivity || new Date(fstat.mtimeMs).toISOString(),
        version,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        cachedTokens,
        newTokens,
        messageCount,
        recentActions: recentActions.slice(-5),
        subagentCount,
      });
    }
  }

  return sessions;
}

// ── Periodic scan ───────────────────────────────────────────────────────────

function doScan() {
  try {
    cachedSessions = scanSessions();
    lastScanTime = new Date().toISOString();
  } catch (err) {
    console.error('[bridge] Scan error:', err.message);
  }
}

doScan();
setInterval(doScan, SCAN_INTERVAL);

// ── HTTP server ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  if (url === '/health') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, version: '1.0.0', sessions: cachedSessions.length }));
    return;
  }

  if (url === '/sessions') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ sessions: cachedSessions, timestamp: lastScanTime }));
    return;
  }

  // ── POST /exec — run a shell command ─────────────────────────────────────
  if (url === '/exec' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let command;
      try {
        const parsed = JSON.parse(body);
        command = parsed.command;
      } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body. Expected { "command": "..." }' }));
        return;
      }
      if (!command || typeof command !== 'string') {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Missing "command" field' }));
        return;
      }
      exec(command, { timeout: 30000, maxBuffer: 1024 * 1024, shell: true }, (err, stdout, stderr) => {
        res.writeHead(200, CORS);
        if (err && err.killed) {
          res.end(JSON.stringify({ ok: false, error: 'Command timed out (30s)' }));
        } else {
          res.end(JSON.stringify({
            ok: !err || err.code === 0,
            stdout: stdout || '',
            stderr: stderr || '',
            code: err ? err.code || 1 : 0,
          }));
        }
      });
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: 'Not found. Use /health, /sessions, or POST /exec' }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Kill it with: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  }
  console.error('[bridge] Server error:', err.message);
});

process.on('uncaughtException', (err) => console.error('[bridge] Uncaught:', err.message));

server.listen(PORT, () => {
  console.log(`\n  Claude Code Bridge`);
  console.log(`  Serving on http://localhost:${PORT}`);
  console.log(`  Scanning ${CLAUDE_DIR}`);
  console.log(`  Found ${cachedSessions.length} active session(s)\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /health   — Bridge status`);
  console.log(`    GET  /sessions — Active Claude Code sessions`);
  console.log(`    POST /exec     — Run a shell command\n`);
});
