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
const crypto = require('crypto');
const { exec, spawn } = require('child_process');
const {
  appendOpenSwanWorktreeConfigPrompt,
  ensureOpenSwanWorktree,
  isAllowedPairOrigin,
  loadManagedTerminalSessions,
  makeTerminalTitle,
  saveManagedTerminalSession,
  sendToTerminalByTitle,
} = require('./terminal-launch-utils');
const {
  buildCodexSessionRecentActions,
  summarizeCodexJsonl,
} = require('./codex-session-summary');

const PORT = 7779;
const SCAN_INTERVAL = 5000;
const ACTIVE_THRESHOLD = 120_000;   // 2min → active
const IDLE_THRESHOLD = 1800_000;    // 30min → idle (Codex writes less frequently than Claude)

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UC-Desktop-Token, X-UC-File-Session-Token',
  // Private Network Access (Chrome 116+) — required for the live HTTPS
  // app at app.chrisswanson.xyz to talk to localhost without silent
  // browser blocking.
  'Access-Control-Allow-Private-Network': 'true',
  'Content-Type': 'application/json',
};

const TOKEN_FILE = path.join(os.homedir(), '.uc-desktop-token');
const MAX_LAUNCH_COUNT = 20;
const LAUNCHED_SESSION_TTL = 12 * 60 * 60_000;

let cachedSessions = [];
let lastScanTime = '';

// ── Shared desktop bridge token ─────────────────────────────────────────────
// The browser app pairs once and then sends this token to all local bridges.

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

function readJsonBody(req, maxBytes = 512 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function shellQuote(value) {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

function shellTextArg(value) {
  const encoded = Buffer.from(String(value ?? ''), 'utf8').toString('base64');
  const decoder = "process.stdout.write(Buffer.from(process.argv[1], 'base64').toString('utf8'))";
  return `"$(node -e ${shellQuote(decoder)} ${shellQuote(encoded)})"`;
}

function appleScriptString(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')}"`;
}

function clampLaunchCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(MAX_LAUNCH_COUNT, Math.floor(n)));
}

function normalizeCliPrompt(value) {
  return String(value || '').replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

function promptPreview(value, max = 180) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function readFileTail(filePath, maxBytes = 512 * 1024) {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, 'r');
    try {
      const buffer = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buffer, 0, buffer.length, start);
      const text = buffer.toString('utf8');
      const firstNewline = text.indexOf('\n');
      return start > 0 && firstNewline >= 0 ? text.slice(firstNewline + 1) : text;
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function safeProjectDir(input) {
  const candidate = input ? path.resolve(String(input)) : process.cwd();
  try {
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) return candidate;
  } catch {}
  return process.cwd();
}

function buildManagedCodexPrompt({ sessionId, displayName, index, count, prompt }) {
  const cleanPrompt = normalizeCliPrompt(prompt) || `Stand by for delegated work from The Underground Circle. You are session ${index + 1} of ${count}.`;
  return [
    `[UC-CODEX:${sessionId}]`,
    `You are ${displayName}, a managed Codex terminal session launched from The Underground Circle.`,
    `Session ${index + 1} of ${count}. Work independently and keep notes in your terminal output.`,
    'Do not mention the UC-CODEX launcher marker unless the user asks about orchestration metadata.',
    '',
    'User task:',
    cleanPrompt,
  ].join('\n');
}

function buildCodexCommand({ cwd, prompt, model, fullAuto = false, search = false }) {
  const parts = [
    'codex',
    '--no-alt-screen',
    '-C',
    shellQuote(cwd),
  ];
  if (model) parts.push('-m', shellQuote(model));
  if (search) parts.push('--search');
  if (fullAuto) parts.push('--full-auto');
  if (prompt) parts.push(shellTextArg(prompt));
  return `cd ${shellQuote(cwd)} && ${parts.join(' ')}`;
}

function spawnDetached(command, args) {
  return new Promise((resolve) => {
    let settled = false;
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore' });
      child.once('error', (err) => {
        if (settled) return;
        settled = true;
        resolve({ ok: false, error: err.message });
      });
      child.once('spawn', () => {
        if (settled) return;
        settled = true;
        child.unref();
        resolve({ ok: true, pid: child.pid });
      });
    } catch (err) {
      resolve({ ok: false, error: err.message || String(err) });
    }
  });
}

async function openTerminal(command, title) {
  if (process.platform === 'darwin') {
    const terminalTitle = String(title || 'UC Codex');
    return {
      terminal: 'Terminal.app',
      terminalTitle,
      ...(await spawnDetached('osascript', [
        '-e', 'tell application "Terminal"',
        '-e', 'activate',
        '-e', `set ucTab to do script ${appleScriptString(command)}`,
        '-e', `set custom title of ucTab to ${appleScriptString(terminalTitle)}`,
        '-e', 'end tell',
      ])),
    };
  }

  if (process.platform === 'linux') {
    const holdCommand = `${command}; printf '\\n[The Underground Circle] Codex session exited. Press Ctrl-D to close.\\n'; exec ${process.env.SHELL || 'bash'}`;
    const candidates = [
      { terminal: 'gnome-terminal', command: 'gnome-terminal', args: ['--title', title, '--', 'bash', '-lc', holdCommand] },
      { terminal: 'x-terminal-emulator', command: 'x-terminal-emulator', args: ['-e', `bash -lc ${shellQuote(holdCommand)}`] },
      { terminal: 'konsole', command: 'konsole', args: ['--new-tab', '-p', `tabtitle=${title}`, '-e', 'bash', '-lc', holdCommand] },
    ];
    for (const candidate of candidates) {
      const result = await spawnDetached(candidate.command, candidate.args);
      if (result.ok) return { terminal: candidate.terminal, ...result };
    }
    return { ok: false, terminal: 'linux-terminal', error: 'No supported Linux terminal launcher found' };
  }

  return { ok: false, terminal: process.platform, error: 'Native terminal launch is not supported on this platform yet' };
}

function makeLaunchId() {
  return `codex-launch-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

async function launchCodexSessions(data) {
  const prompts = Array.isArray(data.prompts)
    ? data.prompts.map((p) => normalizeCliPrompt(p)).filter(Boolean)
    : [];
  const count = clampLaunchCount(data.count || prompts.length || 1);
  const cwd = safeProjectDir(data.cwd || data.projectDir);
  const launchId = data.launchId || makeLaunchId();
  const model = data.model ? String(data.model).trim() : '';
  const fullAuto = Boolean(data.fullAuto);
  const search = Boolean(data.search);
  const basePrompt = normalizeCliPrompt(data.prompt || data.task || '');
  const sessions = [];
  const failed = [];

  for (let i = 0; i < count; i++) {
    const sessionId = `${launchId}-${i + 1}`;
    const displayName = Array.isArray(data.names) && data.names[i]
      ? String(data.names[i])
      : `Codex #${i + 1}`;
    // Per-session git-worktree isolation when requested (fail-open to shared cwd).
    const { cwd: sessionCwd, branch, worktreeDir, isWorktree } = ensureOpenSwanWorktree({
      baseCwd: cwd, useWorktree: data.useWorktree, index: i,
    });
    const cleanPrompt = prompts[i] || basePrompt || `Stand by as ${displayName}. Wait for a delegated task from The Underground Circle.`;
    const cliPrompt = appendOpenSwanWorktreeConfigPrompt(
      buildManagedCodexPrompt({ sessionId, displayName, index: i, count, prompt: cleanPrompt }),
      sessionCwd,
    );
    const command = buildCodexCommand({ cwd: sessionCwd, prompt: cliPrompt, model, fullAuto, search });
    const launchedAt = new Date().toISOString();
    const terminalTitle = makeTerminalTitle('Codex', displayName, sessionId);
    const terminalResult = await openTerminal(command, terminalTitle);
    const session = registerSession({
      sessionId,
      projectDir: sessionCwd,
      branch,
      worktreeDir,
      isWorktree,
      model: model || 'codex',
      status: terminalResult.ok ? 'active' : 'idle',
      task: promptPreview(cleanPrompt, 240),
      displayName,
      prompt: cleanPrompt,
      launchId,
      launchedAt,
      terminal: terminalResult.terminal,
      terminalPid: terminalResult.pid,
      terminalTitle: terminalResult.terminalTitle || terminalTitle,
      launchError: terminalResult.ok ? undefined : terminalResult.error,
      recentActions: [
        terminalResult.ok
          ? `Launched in ${terminalResult.terminal || 'terminal'}`
          : `Launch failed: ${terminalResult.error || 'unknown error'}`,
        `Prompt: ${promptPreview(cleanPrompt, 160)}`,
      ],
    });
    sessions.push(session);
    if (!terminalResult.ok) failed.push({ sessionId, displayName, error: terminalResult.error || 'Launch failed' });
  }

  return {
    ok: failed.length === 0,
    launchId,
    sessions,
    launched: sessions.length - failed.length,
    failed,
    projectDir: cwd,
  };
}

function findManagedSession(sessionId) {
  const key = String(sessionId || '').trim().toLowerCase();
  if (!key) return null;
  return cachedSessions.find((s) =>
    String(s.sessionId || '').toLowerCase() === key
    || String(s.displayName || '').toLowerCase() === key
    || String(s.sessionId || '').toLowerCase().startsWith(key)
  ) || null;
}

function buildCodexFollowupPrompt(message) {
  return [
    '[UC-CODEX-CONTROL]',
    'Follow-up instruction from The Underground Circle chat:',
    normalizeCliPrompt(message),
  ].join('\n');
}

async function sendToManagedCodexSession(data) {
  const session = findManagedSession(data.sessionId || data.target || data.displayName);
  if (!session) return { ok: false, error: 'Codex session not found.' };
  if (!session.terminalTitle) {
    return {
      ok: false,
      error: 'This Codex session was detected but was not launched by The Underground Circle, so it cannot be safely targeted from chat. Launch a managed Codex session from chat first.',
      session,
    };
  }
  const message = normalizeCliPrompt(data.message || data.command || data.prompt || '');
  if (!message) return { ok: false, error: 'Missing message.' };
  const result = await sendToTerminalByTitle(session.terminalTitle, buildCodexFollowupPrompt(message));
  if (!result.ok) return { ok: false, error: result.error || 'Terminal send failed.', session };

  const updated = registerSession({
    ...session,
    status: 'active',
    task: promptPreview(message, 240),
    prompt: message,
    lastActivity: new Date().toISOString(),
    messageCount: (session.messageCount || 0) + 1,
    recentActions: [
      ...(session.recentActions || []).slice(-4),
      `Chat sent: ${promptPreview(message, 120)}`,
    ],
  });
  await scan();
  return {
    ok: true,
    provider: 'codex',
    sessionId: updated.sessionId,
    displayName: updated.displayName,
    message: `Sent to ${updated.displayName || updated.sessionId}.`,
    session: updated,
  };
}

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
        !l.includes('[UC-CODEX:') &&
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

        const sessionSummary = summarizeCodexJsonl(readFileTail(filePath));
        const baseName = path.basename(file).replace(/\.\w+$/, '');
        const sessionId = sessionSummary.sessionMarker || `codex-${baseName}`;
        const task = sessionSummary.lastUserMessage
          ? promptPreview(sessionSummary.lastUserMessage, 240)
          : `Session: ${baseName}`;
        sessions.push({
          sessionId,
          projectDir: dir,
          model: sessionSummary.model || 'codex',
          status: age < ACTIVE_THRESHOLD ? 'active' : 'idle',
          task,
          lastActivity: stat.mtime.toISOString(),
          totalInputTokens: 0,
          totalOutputTokens: 0,
          messageCount: sessionSummary.messageCount || 0,
          recentActions: buildCodexSessionRecentActions(sessionSummary),
          filesRead: 0,
          filesWritten: 0,
          lastAssistantMessage: sessionSummary.lastAssistantMessage || undefined,
          appCapabilityResultText: sessionSummary.appCapabilityResultText || undefined,
          appCapabilityResultStatus: sessionSummary.appCapabilityResultStatus || undefined,
        });
      }
    } catch {}
  }

  return sessions;
}

// ── Manual session registration ──────────────────────────────────────────────
// POST /register to manually register a Codex session

let manualSessions = loadManagedTerminalSessions('codex');

function registerSession(data) {
  const session = {
    sessionId: data.sessionId || `codex-manual-${Date.now()}`,
    projectDir: data.projectDir || process.cwd(),
    branch: data.branch || null,
    worktree: data.worktreeDir || null,
    isWorktree: Boolean(data.isWorktree),
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
    displayName: data.displayName,
    prompt: data.prompt,
    launchId: data.launchId,
    launchedAt: data.launchedAt,
    terminal: data.terminal,
    terminalPid: data.terminalPid,
    launchError: data.launchError,
    terminalTitle: data.terminalTitle,
    manageable: Boolean(data.terminalTitle),
    lastAssistantMessage: data.lastAssistantMessage,
    appCapabilityResultText: data.appCapabilityResultText,
    appCapabilityResultStatus: data.appCapabilityResultStatus,
  };

  // Update existing or add new
  const idx = manualSessions.findIndex(s => s.sessionId === session.sessionId);
  if (idx >= 0) {
    manualSessions[idx] = session;
  } else {
    manualSessions.push(session);
  }
  if (session.terminalTitle) saveManagedTerminalSession('codex', session);

  return session;
}

// ── Periodic scan ────────────────────────────────────────────────────────────

async function scan() {
  const processSessions = await scanCodexProcesses();
  const fileSessions = scanCodexFiles();

  // Expire stale manual sessions. Launched sessions stay visible long
  // enough to manage from the Office even before Codex writes session files.
  manualSessions = manualSessions.filter(s => {
    const age = Date.now() - new Date(s.lastActivity).getTime();
    const ttl = s.launchId ? LAUNCHED_SESSION_TTL : IDLE_THRESHOLD * 2;
    return age < ttl;
  }).map(s => {
    const age = Date.now() - new Date(s.lastActivity).getTime();
    return { ...s, status: age < ACTIVE_THRESHOLD ? s.status : 'idle' };
  });

  // Merge all sources, dedup by sessionId. File-backed Codex JSONL records may
  // arrive after a managed terminal registration; keep the terminal controls
  // from the managed record while adding transcript/result metadata from files.
  const allSessions = [...manualSessions, ...processSessions, ...fileSessions];
  const byId = new Map();
  for (const session of allSessions) {
    if (!session?.sessionId) continue;
    const existing = byId.get(session.sessionId);
    if (!existing) {
      byId.set(session.sessionId, session);
      continue;
    }
    byId.set(session.sessionId, {
      ...existing,
      ...session,
      terminalTitle: existing.terminalTitle || session.terminalTitle,
      terminal: existing.terminal || session.terminal,
      terminalPid: existing.terminalPid || session.terminalPid,
      launchId: existing.launchId || session.launchId,
      launchedAt: existing.launchedAt || session.launchedAt,
      manageable: Boolean(existing.manageable || session.manageable),
      recentActions: [
        ...(existing.recentActions || []),
        ...(session.recentActions || []),
      ].filter(Boolean).slice(-8),
      status: existing.status === 'active' || session.status === 'active' ? 'active' : session.status || existing.status,
      lastActivity: new Date(existing.lastActivity || 0).getTime() > new Date(session.lastActivity || 0).getTime()
        ? existing.lastActivity
        : session.lastActivity,
    });
  }
  cachedSessions = Array.from(byId.values());

  lastScanTime = new Date().toISOString();
}

function extractPid(line) {
  const match = line.match(/\s+(\d+)\s+/);
  return match ? match[1] : null;
}

// ── HTTP Server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const pathname = (() => {
    try { return new URL(req.url, `http://localhost:${PORT}`).pathname; }
    catch { return req.url; }
  })();

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (pathname === '/health') {
    writeJson(res, 200, {
      ok: true,
      bridge: 'codex',
      version: '1.1.0',
      sessions: cachedSessions.length,
      capabilities: ['sessions', 'register', 'update', 'launch', 'terminal-send'],
    });
    return;
  }

  if (pathname === '/pair' && req.method === 'POST') {
    if (!isAllowedPairOrigin(req)) {
      writeJson(res, 403, { ok: false, error: 'Pairing origin not allowlisted.' });
      return;
    }
    writeJson(res, 200, { ok: true, token: getOrCreateBridgeToken(), bridge: 'codex' });
    return;
  }

  if (pathname === '/sessions') {
    if (!requireBridgeAuth(req, res)) return;
    writeJson(res, 200, {
      sessions: cachedSessions,
      lastScan: lastScanTime,
      sessionCount: cachedSessions.length,
    });
    return;
  }

  if (pathname === '/register' && req.method === 'POST') {
    if (!requireBridgeAuth(req, res)) return;
    try {
      const data = await readJsonBody(req);
      const session = registerSession(data);
      await scan();
      writeJson(res, 200, { ok: true, session });
    } catch (e) {
      writeJson(res, 400, { ok: false, error: e.message || 'Invalid JSON' });
    }
    return;
  }

  if (pathname === '/update' && req.method === 'POST') {
    if (!requireBridgeAuth(req, res)) return;
    try {
      const data = await readJsonBody(req);
      if (!data.sessionId) {
        writeJson(res, 400, { ok: false, error: 'sessionId required' });
        return;
      }
      const session = registerSession(data);
      await scan();
      writeJson(res, 200, { ok: true, session });
    } catch (e) {
      writeJson(res, 400, { ok: false, error: e.message || 'Invalid JSON' });
    }
    return;
  }

  if (pathname === '/launch' && req.method === 'POST') {
    if (!requireBridgeAuth(req, res)) return;
    try {
      const data = await readJsonBody(req);
      const result = await launchCodexSessions(data);
      await scan();
      writeJson(res, result.ok ? 200 : 207, result);
    } catch (e) {
      writeJson(res, 400, { ok: false, error: e.message || 'Launch failed' });
    }
    return;
  }

  if (pathname === '/terminal/send' && req.method === 'POST') {
    if (!requireBridgeAuth(req, res)) return;
    try {
      const data = await readJsonBody(req);
      const result = await sendToManagedCodexSession(data);
      writeJson(res, result.ok ? 200 : 409, result);
    } catch (e) {
      writeJson(res, 400, { ok: false, error: e.message || 'Send failed' });
    }
    return;
  }

  writeJson(res, 404, { error: 'Not found' });
});

// ── Start ────────────────────────────────────────────────────────────────────

scan();
setInterval(scan, SCAN_INTERVAL);

server.listen(PORT, () => {
  console.log(`\n🧠 Codex Bridge running on http://localhost:${PORT}`);
  console.log(`   Health:   http://localhost:${PORT}/health`);
  console.log(`   Pair:     POST http://localhost:${PORT}/pair`);
  console.log(`   Sessions: http://localhost:${PORT}/sessions`);
  console.log(`   Register: POST http://localhost:${PORT}/register`);
  console.log(`   Update:   POST http://localhost:${PORT}/update`);
  console.log(`   Launch:   POST http://localhost:${PORT}/launch`);
  console.log(`   Send:     POST http://localhost:${PORT}/terminal/send`);
  console.log(`\n   The Underground Circle will auto-detect this bridge.`);
  console.log(`   Your Codex agent will appear in the Office.\n`);
});
