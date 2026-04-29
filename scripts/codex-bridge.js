/**
 * Codex Bridge — Exposes local Codex sessions to The Underground Circle app.
 * Scans for running Codex processes and serves session data via HTTP.
 * Zero npm dependencies (Node.js built-ins only).
 *
 * Run: node scripts/codex-bridge.js
 *
 * The app auto-detects this bridge on localhost:7779 and shows
 * Codex as an agent in the Office.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec, spawn } = require('child_process');

const PORT = 7779;
const BRIDGE_STARTED_AT = new Date().toISOString();
const SCAN_INTERVAL = 5000;
const ACTIVE_THRESHOLD = 120_000;   // 2min → active
const IDLE_THRESHOLD = 1800_000;    // 30min → idle (Codex writes less frequently than Claude)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

let cachedSessions = [];
let lastScanTime = '';

// ── Scan for Codex processes ─────────────────────────────────────────────────

function scanCodexProcesses() {
  return new Promise((resolve) => {
    // Look for codex CLI processes
    const cmd = process.platform === 'win32'
      ? 'tasklist /FI "IMAGENAME eq codex*" /FO CSV'
      : 'ps aux | grep -E "codex|openai" | grep -v grep | grep -v "codex-bridge" | grep -v "node scripts"';

    exec(cmd, (err, stdout) => {
      if (err || !stdout.trim()) {
        resolve([]);
        return;
      }

      // Filter out bridge process and node scripts to avoid self-detection
      const lines = stdout.trim().split('\n').filter(l =>
        l.includes('codex') &&
        !l.includes('codex-bridge') &&
        !l.includes('node scripts') &&
        !l.includes('node /')  // Exclude node process running the bridge
      );
      const sessions = lines.map((line, i) => {
        const pid = extractPid(line);
        return {
          sessionId: `codex-${pid || i}`,
          projectDir: process.cwd(),
          model: 'codex',
          status: 'active',
          task: 'Deep research in progress',
          lastActivity: new Date().toISOString(),
          totalInputTokens: 0,
          totalOutputTokens: 0,
          messageCount: 0,
          recentActions: ['Analyzing codebase'],
          filesRead: 0,
          filesWritten: 0,
        };
      });

      resolve(sessions);
    });
  });
}

// ── Scan for Codex sandbox/session files ──────────────────────────────────────

function scanCodexFiles() {
  const sessions = [];

  // Check common Codex working directories (Linux + Windows via WSL)
  const codexDirs = [
    path.join(os.homedir(), '.codex'),
    path.join(os.homedir(), '.openai'),
    path.join(os.homedir(), '.config', 'codex'),
  ];
  // Also scan Windows-side Codex directories when running in WSL
  try {
    const winUsers = fs.readdirSync('/mnt/c/Users').filter(u => !u.startsWith('.') && u !== 'Public' && u !== 'Default' && u !== 'Default User' && u !== 'All Users');
    for (const u of winUsers) {
      codexDirs.push(`/mnt/c/Users/${u}/.codex`);
    }
  } catch {}

  // Find Codex session files — only look in sessions/ subdirectory for rollout-*.jsonl
  function findSessionFiles(dir) {
    const results = [];
    const sessionsDir = path.join(dir, 'sessions');
    if (!fs.existsSync(sessionsDir)) return results;

    function recurse(d, depth) {
      if (depth > 5) return;
      try {
        const entries = fs.readdirSync(d, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(d, entry.name);
          if (entry.isDirectory()) {
            recurse(fullPath, depth + 1);
          } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
            results.push(fullPath);
          }
        }
      } catch {}
    }
    recurse(sessionsDir, 0);
    return results;
  }

  for (const dir of codexDirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      const sessionFiles = findSessionFiles(dir);
      for (const filePath of sessionFiles) {
        const file = path.relative(dir, filePath);
        const stat = fs.statSync(filePath);
        const age = Date.now() - stat.mtimeMs;

        // Only include recently active files
        if (age > IDLE_THRESHOLD) continue;

        // Try to extract model from last line of jsonl
        let detectedModel = 'codex';
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const lastLines = content.trim().split('\n').slice(-5);
          for (const line of lastLines.reverse()) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.model) { detectedModel = parsed.model; break; }
              if (parsed.payload?.model) { detectedModel = parsed.payload.model; break; }
            } catch {}
          }
        } catch {}
        const baseName = path.basename(file).replace(/\.\w+$/, '');
        sessions.push({
          sessionId: `codex-${baseName}`,
          projectDir: dir,
          model: detectedModel,
          status: age < ACTIVE_THRESHOLD ? 'active' : 'idle',
          task: `Session: ${baseName}`,
          lastActivity: stat.mtime.toISOString(),
          totalInputTokens: 0,
          totalOutputTokens: 0,
          messageCount: 0,
          recentActions: [],
          filesRead: 0,
          filesWritten: 0,
        });
      }
    } catch {}
  }

  return sessions;
}

// ── Manual session registration ──────────────────────────────────────────────
// POST /register to manually register a Codex session

let manualSessions = [];

function registerSession(data) {
  const session = {
    sessionId: data.sessionId || `codex-manual-${Date.now()}`,
    projectDir: data.projectDir || process.cwd(),
    model: data.model || 'codex',
    status: data.status || 'active',
    task: data.task || 'Deep research',
    lastActivity: new Date().toISOString(),
    totalInputTokens: data.totalInputTokens || 0,
    totalOutputTokens: data.totalOutputTokens || 0,
    messageCount: data.messageCount || 0,
    recentActions: data.recentActions || [],
    filesRead: data.filesRead || 0,
    filesWritten: data.filesWritten || 0,
  };

  // Update existing or add new
  const idx = manualSessions.findIndex(s => s.sessionId === session.sessionId);
  if (idx >= 0) {
    manualSessions[idx] = session;
  } else {
    manualSessions.push(session);
  }

  return session;
}

// ── Periodic scan ────────────────────────────────────────────────────────────

async function scan() {
  const processSessions = await scanCodexProcesses();
  const fileSessions = scanCodexFiles();

  // Expire stale manual sessions
  manualSessions = manualSessions.filter(s => {
    const age = Date.now() - new Date(s.lastActivity).getTime();
    return age < IDLE_THRESHOLD * 2;
  });

  // Merge all sources, dedup by sessionId
  const allSessions = [...manualSessions, ...processSessions, ...fileSessions];
  const seen = new Set();
  cachedSessions = allSessions.filter(s => {
    if (seen.has(s.sessionId)) return false;
    seen.add(s.sessionId);
    return true;
  });

  lastScanTime = new Date().toISOString();
}

function extractPid(line) {
  const match = line.match(/\s+(\d+)\s+/);
  return match ? match[1] : null;
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      bridge: 'codex',
      version: '1.0.0',
      sessions: cachedSessions.length,
      capabilities: ['sessions', 'exec/stream', 'register', 'update'],
      auth: 'n/a',
      uptime_s: Math.round(process.uptime()),
      started_at: BRIDGE_STARTED_AT,
    }));
    return;
  }

  if (req.url === '/sessions') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      sessions: cachedSessions,
      lastScan: lastScanTime,
      sessionCount: cachedSessions.length,
    }));
    return;
  }

  if (req.url === '/register' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const session = registerSession(data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, session }));
      } catch (e) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.url === '/update' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (!data.sessionId) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'sessionId required' }));
          return;
        }
        const session = registerSession(data);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, session }));
      } catch (e) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // ── POST /exec/stream — run a shell command, stream output as SSE ───────
  // Mirrors the claude-bridge endpoint so the same chat UI streaming
  // path works regardless of which bridge the user has running. Same
  // security: localhost-only origin gate, blocked-pattern filter,
  // 30s timeout, output caps.
  if (req.url === '/exec/stream' && req.method === 'POST') {
    const origin = req.headers['origin'] || req.headers['referer'] || '';
    const isLocal = !origin || origin.includes('localhost') || origin.includes('127.0.0.1') || origin.includes('app.chrisswanson.xyz');
    if (!isLocal) {
      res.writeHead(403, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Forbidden: only local/app origins allowed' }));
      return;
    }

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10240) {
        res.writeHead(413, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Request body too large' }));
        req.destroy();
      }
    });
    req.on('end', () => {
      let command;
      try {
        const parsed = JSON.parse(body);
        command = parsed.command;
      } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }
      if (!command || typeof command !== 'string') {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Missing "command" field' }));
        return;
      }

      // Same blocked-pattern filter as claude-bridge.
      const BLOCKED = [
        /\brm\s+(-[a-zA-Z]*\s+)*\//, /\brm\s+(-[a-zA-Z]*\s+)*~/,
        /\brmdir\s+(-[a-zA-Z]*\s+)*\//, /\bmkfs\b/, /\bdd\s+.*of=/,
        />\s*\/dev\/sd/, /\bcurl\b.*\|\s*(ba)?sh/, /\bwget\b.*\|\s*(ba)?sh/,
        /\bchmod\s+777\b/, /\bpasswd\b/, /\buseradd\b/, /\buserdel\b/,
        /\bsudo\b/, /\bsu\s+-?\s/, /\/etc\/shadow/, /\/etc\/passwd/,
        /\benv\b.*SECRET|KEY|TOKEN|PASS/i, /\bcrontab\s+-[er]/,
        /\bshutdown\b/, /\breboot\b/,
      ];
      if (BLOCKED.some(p => p.test(command))) {
        res.writeHead(403, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Command blocked: contains restricted pattern' }));
        return;
      }

      res.writeHead(200, {
        ...CORS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const startedAt = Date.now();
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const STDOUT_CAP = 256 * 1024;
      const STDERR_CAP = 64 * 1024;
      let killed = false;

      const send = (event) => {
        try { res.write(`data: ${JSON.stringify(event)}\n\n`); } catch { /* socket closed */ }
      };

      const child = spawn('sh', ['-c', command], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const timeout = setTimeout(() => {
        killed = true;
        child.kill('SIGTERM');
        send({ type: 'error', error: 'Command timed out (30s)' });
        try { res.end(); } catch {}
      }, 30000);

      child.stdout.on('data', (buf) => {
        if (stdoutBytes >= STDOUT_CAP) return;
        const remaining = STDOUT_CAP - stdoutBytes;
        const chunk = buf.length > remaining ? buf.slice(0, remaining) : buf;
        stdoutBytes += chunk.length;
        send({ type: 'stdout', chunk: chunk.toString('utf8') });
        if (stdoutBytes >= STDOUT_CAP) {
          send({ type: 'stderr', chunk: '\n[stdout cap of 256KB reached — further output suppressed]\n' });
        }
      });

      child.stderr.on('data', (buf) => {
        if (stderrBytes >= STDERR_CAP) return;
        const remaining = STDERR_CAP - stderrBytes;
        const chunk = buf.length > remaining ? buf.slice(0, remaining) : buf;
        stderrBytes += chunk.length;
        send({ type: 'stderr', chunk: chunk.toString('utf8') });
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        if (killed) return;
        send({ type: 'error', error: err.message || 'spawn failed' });
        try { res.end(); } catch {}
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (killed) return;
        send({ type: 'done', code: code ?? 0, durationMs: Date.now() - startedAt });
        try { res.end(); } catch {}
      });

      req.on('close', () => {
        if (!child.killed) { try { child.kill('SIGTERM'); } catch {} }
        clearTimeout(timeout);
      });
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ── Start ────────────────────────────────────────────────────────────────────

scan();
setInterval(scan, SCAN_INTERVAL);

server.listen(PORT, () => {
  console.log(`\n🧠 Codex Bridge running on http://localhost:${PORT}`);
  console.log(`   Health:   http://localhost:${PORT}/health`);
  console.log(`   Sessions: http://localhost:${PORT}/sessions`);
  console.log(`   Register: POST http://localhost:${PORT}/register`);
  console.log(`   Update:   POST http://localhost:${PORT}/update`);
  console.log(`\n   The Underground Circle will auto-detect this bridge.`);
  console.log(`   Your Codex agent will appear in the Office.\n`);
});
