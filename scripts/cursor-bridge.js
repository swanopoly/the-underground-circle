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
const crypto = require('crypto');
const { execFile, execSync } = require('child_process');
const {
  clampLaunchCount,
  isAllowedPairOrigin,
  loadManagedTerminalSessions,
  makeLaunchId,
  normalizeCliPrompt,
  promptPreview,
  readJsonBody,
  safeProjectDir,
  saveManagedTerminalSession,
} = require('./terminal-launch-utils');

const PORT = 7781;
const ACTIVE_THRESHOLD = 300_000;   // 5min → active (Cursor sessions persist longer)
const IDLE_THRESHOLD = 86_400_000;  // 24h → include sessions from today
const SCAN_INTERVAL = 5000;
const TAIL_BYTES = 32768;           // Read last 32KB of each transcript
const TOKEN_FILE = path.join(os.homedir(), '.uc-desktop-token');

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UC-Desktop-Token, X-UC-File-Session-Token',
  'Access-Control-Allow-Private-Network': 'true',
  'Content-Type': 'application/json',
};

let cachedSessions = [];
let lastScanTime = '';
let managedSessions = loadManagedTerminalSessions('cursor');

// ── Shared desktop bridge token ─────────────────────────────────────────────

function getOrCreateBridgeToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {}

  const token = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 });
  } catch {}
  return token;
}

function hasBridgeAuth(req) {
  const token = getOrCreateBridgeToken();
  const supplied = req.headers['x-uc-desktop-token'];
  return typeof supplied === 'string' && supplied === token;
}

function writeJson(res, status, body) {
  res.writeHead(status, CORS);
  res.end(JSON.stringify(body));
}

function requireBridgeAuth(req, res) {
  if (hasBridgeAuth(req)) return true;
  writeJson(res, 401, { ok: false, error: 'Missing or invalid desktop bridge token' });
  return false;
}

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

function runExecFile(command, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: stderr?.trim() || error.message });
        return;
      }
      resolve({ ok: true, stdout: stdout?.trim() || '' });
    });
  });
}

function appleScriptString(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

async function runOsascript(lines, timeout = 8000) {
  return runExecFile('osascript', lines.flatMap((line) => ['-e', line]), timeout);
}

async function sendPromptToCursorComposer({ prompt, projectDir, appName }) {
  const message = normalizeCliPrompt(prompt);
  if (!message) return { ok: false, error: 'Missing Cursor Composer prompt.' };
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Cursor Composer handoff currently supports macOS Cursor.app automation only.' };
  }

  const cwd = safeProjectDir(projectDir || process.cwd());
  const openResult = await runExecFile('open', ['-a', appName || 'Cursor', cwd], 7000);
  if (!openResult.ok) return openResult;

  const scriptResult = await runOsascript([
    'set previousClipboard to the clipboard',
    `set the clipboard to ${appleScriptString(message)}`,
    `tell application ${appleScriptString(appName || 'Cursor')} to activate`,
    'delay 0.7',
    'tell application "System Events"',
    'keystroke "i" using command down',
    'delay 0.25',
    'keystroke "v" using command down',
    'delay 0.15',
    'key code 36',
    'end tell',
    'set the clipboard to previousClipboard',
  ], 10000);

  if (!scriptResult.ok) {
    return {
      ok: false,
      error: `${scriptResult.error || 'Cursor automation failed'} Make sure Cursor is installed and macOS Accessibility permissions allow this terminal to control Cursor.`,
    };
  }
  return { ok: true };
}

function registerManagedCursorSession(data) {
  const session = {
    sessionId: data.sessionId,
    projectDir: data.projectDir || process.cwd(),
    projectHash: data.projectHash || 'manual-composer',
    model: data.model || 'cursor-composer',
    status: data.status || 'active',
    kind: 'composer',
    task: data.task || 'Cursor Composer task',
    lastActivity: data.lastActivity || new Date().toISOString(),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    messageCount: data.messageCount || 0,
    userMessages: data.userMessages || 0,
    assistantMessages: data.assistantMessages || 0,
    recentActions: data.recentActions || [],
    displayName: data.displayName || 'Cursor Composer',
    prompt: data.prompt,
    launchId: data.launchId,
    launchedAt: data.launchedAt,
    manageable: true,
  };
  const idx = managedSessions.findIndex((s) => s.sessionId === session.sessionId);
  if (idx >= 0) managedSessions[idx] = session;
  else managedSessions.push(session);
  saveManagedTerminalSession('cursor', session);
  return session;
}

function mergeSessions(fileSessions, registeredSessions) {
  const byId = new Map();
  for (const session of [...registeredSessions, ...fileSessions]) {
    if (!session?.sessionId) continue;
    const existing = byId.get(session.sessionId);
    if (!existing) {
      byId.set(session.sessionId, session);
      continue;
    }
    byId.set(session.sessionId, {
      ...existing,
      ...session,
      displayName: existing.displayName || session.displayName,
      manageable: Boolean(existing.manageable || session.manageable),
      recentActions: [
        ...(existing.recentActions || []),
        ...(session.recentActions || []),
      ].slice(-6),
    });
  }
  return Array.from(byId.values()).sort((a, b) => new Date(b.lastActivity || 0).getTime() - new Date(a.lastActivity || 0).getTime());
}

async function launchCursorComposerSessions(data) {
  const prompts = Array.isArray(data.prompts)
    ? data.prompts.map((p) => normalizeCliPrompt(p)).filter(Boolean)
    : [];
  const count = clampLaunchCount(data.count || prompts.length || 1);
  const projectDir = safeProjectDir(data.cwd || data.projectDir || process.cwd());
  const launchId = data.launchId || makeLaunchId('cursor-composer-launch');
  const basePrompt = normalizeCliPrompt(data.prompt || data.task || '');
  const sessions = [];
  const failed = [];

  for (let i = 0; i < count; i++) {
    const sessionId = `${launchId}-${i + 1}`;
    const displayName = Array.isArray(data.names) && data.names[i]
      ? String(data.names[i])
      : count > 1 ? `Cursor Composer #${i + 1}` : 'Cursor Composer';
    const cleanPrompt = prompts[i] || basePrompt || `Stand by as ${displayName}. Wait for delegated work from The Underground Circle.`;
    const handoffPrompt = [
      `[UC-CURSOR-COMPOSER:${sessionId}]`,
      `You are ${displayName}, a Cursor Composer agent selected from The Underground Circle chat.`,
      'Complete the task in this workspace. Keep changes focused and report what changed when done.',
      '',
      'User task:',
      cleanPrompt,
    ].join('\n');
    const launchedAt = new Date().toISOString();
    const result = await sendPromptToCursorComposer({
      prompt: handoffPrompt,
      projectDir,
      appName: data.appName,
    });
    const session = registerManagedCursorSession({
      sessionId,
      projectDir,
      model: data.model || 'cursor-composer',
      status: result.ok ? 'active' : 'idle',
      displayName,
      task: promptPreview(cleanPrompt, 240),
      prompt: cleanPrompt,
      launchId,
      launchedAt,
      lastActivity: launchedAt,
      recentActions: [
        result.ok
          ? 'Sent task to Cursor Composer'
          : `Cursor Composer handoff failed: ${result.error || 'unknown error'}`,
        `Prompt: ${promptPreview(cleanPrompt, 160)}`,
      ],
    });
    sessions.push(session);
    if (!result.ok) failed.push({ sessionId, displayName, error: result.error || 'Cursor Composer handoff failed' });
  }

  return {
    ok: failed.length === 0,
    launchId,
    sessions,
    launched: sessions.length - failed.length,
    failed,
    projectDir,
  };
}

function findManagedCursorSession(value) {
  const key = String(value || '').trim().toLowerCase();
  if (!key) return null;
  return cachedSessions.find((session) =>
    String(session.sessionId || '').toLowerCase() === key
    || String(session.displayName || '').toLowerCase() === key
    || String(session.sessionId || '').toLowerCase().startsWith(key)
  ) || null;
}

async function sendToManagedCursorSession(data) {
  const session = findManagedCursorSession(data.sessionId || data.target || data.displayName);
  if (!session) return { ok: false, error: 'Cursor Composer session not found.' };
  const message = normalizeCliPrompt(data.message || data.command || data.prompt || '');
  if (!message) return { ok: false, error: 'Missing message.' };
  const result = await sendPromptToCursorComposer({
    prompt: [
      '[UC-CURSOR-COMPOSER-CONTROL]',
      'Follow-up instruction from The Underground Circle chat:',
      message,
    ].join('\n'),
    projectDir: session.projectDir,
    appName: data.appName,
  });
  if (!result.ok) return { ok: false, error: result.error || 'Cursor Composer handoff failed.', session };
  const updated = registerManagedCursorSession({
    ...session,
    status: 'active',
    task: promptPreview(message, 240),
    prompt: message,
    lastActivity: new Date().toISOString(),
    messageCount: (session.messageCount || 0) + 1,
    userMessages: (session.userMessages || 0) + 1,
    recentActions: [
      ...(session.recentActions || []).slice(-4),
      `Chat sent: ${promptPreview(message, 120)}`,
    ],
  });
  doScan();
  return {
    ok: true,
    provider: 'cursor',
    sessionId: updated.sessionId,
    displayName: updated.displayName,
    message: `Sent to ${updated.displayName || updated.sessionId}.`,
    session: updated,
  };
}

// ── Periodic scan ────────────────────────────────────────────────────────────

function doScan() {
  try {
    managedSessions = loadManagedTerminalSessions('cursor');
    cachedSessions = mergeSessions(scanSessions(), managedSessions);
    lastScanTime = new Date().toISOString();
  } catch (err) {
    console.error('[cursor-bridge] Scan error:', err.message);
  }
}

doScan();
setInterval(doScan, SCAN_INTERVAL);

// ── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  if (url === '/health') {
    writeJson(res, 200, {
      ok: true,
      bridge: 'cursor',
      version: '1.1.0',
      sessions: cachedSessions.length,
      cursorDir: CURSOR_DIR,
      capabilities: ['sessions', 'launch', 'terminal-send', 'composer-send'],
    });
    return;
  }

  if (url === '/pair' && req.method === 'POST') {
    if (!isAllowedPairOrigin(req)) {
      writeJson(res, 403, { ok: false, error: 'Pairing origin not allowlisted.' });
      return;
    }
    writeJson(res, 200, { ok: true, token: getOrCreateBridgeToken(), bridge: 'cursor' });
    return;
  }

  if (url === '/sessions') {
    if (!requireBridgeAuth(req, res)) return;
    writeJson(res, 200, {
      sessions: cachedSessions,
      timestamp: lastScanTime,
      sessionCount: cachedSessions.length,
    });
    return;
  }

  if (url === '/launch' && req.method === 'POST') {
    if (!requireBridgeAuth(req, res)) return;
    try {
      const data = await readJsonBody(req);
      const result = await launchCursorComposerSessions(data);
      doScan();
      writeJson(res, result.ok ? 200 : 207, result);
    } catch (e) {
      writeJson(res, 400, { ok: false, error: e.message || 'Launch failed' });
    }
    return;
  }

  if ((url === '/terminal/send' || url === '/composer/send') && req.method === 'POST') {
    if (!requireBridgeAuth(req, res)) return;
    try {
      const data = await readJsonBody(req);
      const result = await sendToManagedCursorSession(data);
      writeJson(res, result.ok ? 200 : 409, result);
    } catch (e) {
      writeJson(res, 400, { ok: false, error: e.message || 'Send failed' });
    }
    return;
  }

  writeJson(res, 404, { error: 'Not found. Use /health, /pair, /sessions, /launch, /terminal/send, or /composer/send' });
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
  console.log(`    POST /pair      — Pair browser token`);
  console.log(`    GET  /sessions  — Active Cursor sessions`);
  console.log(`    POST /launch    — Send a task to Cursor Composer`);
  console.log(`    POST /terminal/send — Send a follow-up to a managed Composer session\n`);
});
