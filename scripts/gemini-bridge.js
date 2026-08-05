/**
 * Gemini CLI Bridge — Auto-detects Gemini CLI sessions & provides Gemini API proxy
 *
 * Features:
 *  1. Scans ~/.gemini/ for active session files (handles WSL ↔ Windows paths)
 *  2. Detects running `gemini` processes
 *  3. Reads existing Google OAuth tokens from Gemini CLI config (no API key needed)
 *  4. Proxies /send requests to the Gemini API using stored OAuth credentials
 *
 * Run: node scripts/gemini-bridge.js
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec, execSync } = require('child_process');
const {
  appendOpenSwanWorktreeConfigPrompt,
  clampLaunchCount,
  ensureOpenSwanWorktree,
  loadManagedTerminalSessions,
  makeLaunchId,
  makeTerminalTitle,
  normalizeCliPrompt,
  openTerminal,
  promptPreview,
  isAllowedPairOrigin,
  readJsonBody,
  safeProjectDir,
  saveManagedTerminalSession,
  sendToTerminalByTitle,
  shellQuote,
  shellTextArg,
} = require('./terminal-launch-utils');
const {
  createPairingChallengeStore,
  isBridgeRequestSourceAllowed,
  isPairingRequestSourceAllowed,
} = require('./desktop-bridge-security');

const PORT = Math.max(1024, Math.min(65535, Number(process.env.UC_GEMINI_BRIDGE_PORT) || 7780));
const BRIDGE_BIND_HOST = '127.0.0.1';
const ACTIVE_THRESHOLD = 60_000;    // 60s → active (Gemini sessions update less frequently)
const IDLE_THRESHOLD = 86_400_000;  // 24h → show sessions from today
const SCAN_INTERVAL = 5000;         // Scan every 5s
const LAUNCHED_SESSION_TTL = 12 * 60 * 60_000;
const TOKEN_FILE = path.join(os.homedir(), '.uc-desktop-token');
const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Gemini CLI's OAuth client ID (public, embedded in the CLI)
const GEMINI_CLI_CLIENT_ID = '681255809395-oo8ft2oprdrp9e3aqf6av3hmdib135j.apps.googleusercontent.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-UC-Desktop-Token, X-UC-File-Session-Token',
  'Access-Control-Allow-Private-Network': 'true',
  'Content-Type': 'application/json',
};

let cachedSessions = [];
let lastScanTime = '';
let oauthCreds = null;
let userEmail = '';
let launchedSessions = loadManagedTerminalSessions('gemini');
const pairingChallenges = createPairingChallengeStore({ ttlMs: 30_000, maxEntries: 64 });

function getOrCreateBridgeToken() {
  try {
    if (fs.existsSync(TOKEN_FILE)) {
      const existing = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {}
  const token = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(TOKEN_FILE, `${token}\n`, { mode: 0o600 }); } catch {}
  return token;
}

function hasBridgeAuth(req) {
  const sent = req.headers['x-uc-desktop-token'];
  return typeof sent === 'string' && sent === getOrCreateBridgeToken();
}

function requireBridgeMutationAuth(req, res) {
  const sourceCheck = isBridgeRequestSourceAllowed(req, PORT, isAllowedPairOrigin);
  if (!sourceCheck.ok) {
    res.writeHead(403, CORS);
    res.end(JSON.stringify({
      ok: false,
      code: sourceCheck.code,
      error: 'Bridge mutations are available only through an allowed loopback request.',
    }));
    return false;
  }
  if (!hasBridgeAuth(req)) {
    res.writeHead(401, CORS);
    res.end(JSON.stringify({
      ok: false,
      code: 'bridge_auth_required',
      error: 'Missing or invalid desktop bridge token',
    }));
    return false;
  }
  return true;
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
    // Convert Windows path to WSL path: C:\Users\chris → /mnt/c/Users/chris
    return out.replace(/^([A-Z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
  } catch { return ''; }
}

function resolveGeminiDir() {
  // Try Linux home first
  const linuxDir = path.join(os.homedir(), '.gemini');
  if (fs.existsSync(linuxDir) && fs.existsSync(path.join(linuxDir, 'settings.json'))) {
    return linuxDir;
  }

  // On WSL, try the Windows home
  if (isWSL()) {
    const winHome = getWindowsHome();
    if (winHome) {
      const winDir = path.join(winHome, '.gemini');
      if (fs.existsSync(winDir)) return winDir;
    }
    // Fallback: try common patterns
    const patterns = [
      '/mnt/c/Users/*/\.gemini',
    ];
    for (const pattern of patterns) {
      const base = pattern.replace('/*/\\.gemini', '');
      try {
        const users = fs.readdirSync(base);
        for (const user of users) {
          const candidate = path.join(base, user, '.gemini');
          if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'settings.json'))) {
            return candidate;
          }
        }
      } catch {}
    }
  }

  return linuxDir; // Default fallback
}

const GEMINI_DIR = resolveGeminiDir();

// ── OAuth token management ───────────────────────────────────────────────────

function loadOAuthCreds() {
  const credsPath = path.join(GEMINI_DIR, 'oauth_creds.json');
  try {
    if (!fs.existsSync(credsPath)) return null;
    const data = JSON.parse(fs.readFileSync(credsPath, 'utf-8'));
    oauthCreds = data;
    return data;
  } catch { return null; }
}

function loadUserEmail() {
  const accountsPath = path.join(GEMINI_DIR, 'google_accounts.json');
  try {
    if (!fs.existsSync(accountsPath)) return '';
    const data = JSON.parse(fs.readFileSync(accountsPath, 'utf-8'));
    return data.active || '';
  } catch { return ''; }
}

function isTokenExpired() {
  if (!oauthCreds || !oauthCreds.expiry_date) return true;
  // Add 60s buffer before expiry
  return Date.now() > (oauthCreds.expiry_date - 60000);
}

function refreshAccessToken() {
  return new Promise((resolve, reject) => {
    if (!oauthCreds || !oauthCreds.refresh_token) {
      return reject(new Error('No refresh token available — run `gemini` to re-authenticate'));
    }

    const postData = new URLSearchParams({
      client_id: GEMINI_CLI_CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: oauthCreds.refresh_token,
    }).toString();

    const url = new URL(GOOGLE_TOKEN_URL);
    const reqOpts = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(reqOpts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.access_token) {
            oauthCreds.access_token = data.access_token;
            oauthCreds.expiry_date = Date.now() + ((data.expires_in || 3600) * 1000);
            if (data.id_token) oauthCreds.id_token = data.id_token;

            // Save refreshed tokens back to disk
            const credsPath = path.join(GEMINI_DIR, 'oauth_creds.json');
            try { fs.writeFileSync(credsPath, JSON.stringify(oauthCreds, null, 2)); } catch {}

            resolve(oauthCreds.access_token);
          } else {
            reject(new Error(data.error_description || data.error || 'Token refresh failed'));
          }
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function getAccessToken() {
  if (!oauthCreds) loadOAuthCreds();
  if (!oauthCreds) throw new Error('No OAuth credentials found — run `gemini` CLI to authenticate');

  if (isTokenExpired()) {
    console.log('[gemini-bridge] Access token expired, refreshing...');
    await refreshAccessToken();
    console.log('[gemini-bridge] Token refreshed successfully');
  }

  return oauthCreds.access_token;
}

// ── Gemini API call ──────────────────────────────────────────────────────────

function callGeminiAPI(prompt, model = 'gemini-2.5-flash') {
  return new Promise(async (resolve, reject) => {
    let accessToken;
    try {
      accessToken = await getAccessToken();
    } catch (e) { return reject(e); }

    const payload = JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.7,
      },
    });

    const apiPath = `/v1beta/models/${model}:generateContent`;
    const reqOpts = {
      hostname: 'generativelanguage.googleapis.com',
      path: apiPath,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(reqOpts, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (data.error) {
            return reject(new Error(data.error.message || JSON.stringify(data.error)));
          }
          const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const usage = data.usageMetadata || {};
          resolve({
            response: text,
            model,
            tokens: {
              input: usage.promptTokenCount || 0,
              output: usage.candidatesTokenCount || 0,
              total: usage.totalTokenCount || 0,
            },
          });
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('API request timed out')); });
    req.write(payload);
    req.end();
  });
}

// ── Utility ──────────────────────────────────────────────────────────────────

function safeExec(cmd) {
  try {
    return execSync(cmd, { timeout: 10000, maxBuffer: 512 * 1024, encoding: 'utf-8' }).trim();
  } catch { return ''; }
}

// ── Scan for Gemini CLI sessions ─────────────────────────────────────────────
// Gemini CLI stores sessions at: .gemini/tmp/{project}/chats/session-*.json

function scanSessions() {
  const sessions = [];

  // Scan .gemini/tmp/*/chats/ for session files
  const tmpDir = path.join(GEMINI_DIR, 'tmp');
  if (fs.existsSync(tmpDir)) {
    try {
      const projects = fs.readdirSync(tmpDir);
      for (const proj of projects) {
        const chatsDir = path.join(tmpDir, proj, 'chats');
        if (!fs.existsSync(chatsDir)) continue;

        let chatFiles;
        try { chatFiles = fs.readdirSync(chatsDir); } catch { continue; }

        for (const file of chatFiles) {
          if (!file.startsWith('session-') || !file.endsWith('.json')) continue;

          const filePath = path.join(chatsDir, file);
          let fstat;
          try { fstat = fs.statSync(filePath); } catch { continue; }

          const age = Date.now() - fstat.mtimeMs;
          if (age > IDLE_THRESHOLD) continue;

          const session = parseGeminiSession(filePath, fstat, proj);
          if (session) sessions.push(session);
        }
      }
    } catch {}
  }

  // Also detect running gemini processes
  const psOut = safeExec('ps aux 2>/dev/null');
  if (psOut) {
    for (const line of psOut.split('\n')) {
      if (
        /gemini/i.test(line) &&
        !line.includes('gemini-bridge') &&
        !line.includes('grep') &&
        !line.includes('node ')
      ) {
        const parts = line.split(/\s+/);
        const pid = parts[1];
        const cwd = safeExec(`readlink /proc/${pid}/cwd 2>/dev/null`) || '';

        // Check if we already have a session for this working directory
        const hasSession = sessions.find(s =>
          s.projectDir === cwd || s.projectDir.endsWith(path.basename(cwd))
        );

        if (!hasSession && cwd) {
          sessions.push({
            sessionId: `pid-${pid}`,
            projectDir: cwd,
            model: 'gemini-2.5-pro',
            status: 'active',
            task: `Running in ${path.basename(cwd)}`,
            lastActivity: new Date().toISOString(),
            totalInputTokens: 0,
            totalOutputTokens: 0,
            messageCount: 0,
            recentActions: ['gemini process detected'],
            thinkingEnabled: false,
          });
        } else if (hasSession) {
          hasSession.status = 'active';
        }
      }
    }
  }

  launchedSessions = launchedSessions.filter((s) => {
    const age = Date.now() - new Date(s.lastActivity).getTime();
    return age < LAUNCHED_SESSION_TTL;
  }).map((s) => {
    const age = Date.now() - new Date(s.lastActivity).getTime();
    return { ...s, status: age < ACTIVE_THRESHOLD ? s.status : 'idle' };
  });

  const seen = new Set();
  return [...launchedSessions, ...sessions].filter((s) => {
    if (seen.has(s.sessionId)) return false;
    seen.add(s.sessionId);
    return true;
  });
}

function parseGeminiSession(filePath, fstat, projectName) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw);

    const age = Date.now() - fstat.mtimeMs;
    const messages = data.messages || [];
    const geminiMessages = messages.filter(m => m.type === 'gemini');

    // Sum tokens from all gemini responses
    let totalInput = 0, totalOutput = 0;
    let model = 'gemini-2.5-pro';
    let thinkingEnabled = false;
    const recentActions = [];

    for (const msg of geminiMessages) {
      if (msg.tokens) {
        totalInput += msg.tokens.input || 0;
        totalOutput += msg.tokens.output || 0;
      }
      if (msg.model) model = msg.model;
      if (msg.thoughts && msg.thoughts.length > 0) thinkingEnabled = true;
    }

    // Get last user message as task description
    const userMessages = messages.filter(m => m.type === 'user');
    let task = '';
    if (userMessages.length > 0) {
      const lastUser = userMessages[userMessages.length - 1];
      if (lastUser.content) {
        if (Array.isArray(lastUser.content)) {
          task = lastUser.content.map(c => c.text || '').join(' ').slice(0, 80);
        } else if (typeof lastUser.content === 'string') {
          task = lastUser.content.slice(0, 80);
        }
      }
    }

    // Extract tool use actions from gemini messages
    for (const msg of geminiMessages.slice(-5)) {
      if (msg.toolCalls || msg.functionCalls) {
        const calls = msg.toolCalls || msg.functionCalls || [];
        for (const call of calls) {
          recentActions.push(call.name || call.tool || 'tool_call');
        }
      }
    }

    // Resolve project directory from projects.json
    let projectDir = projectName || '';
    const projectsPath = path.join(GEMINI_DIR, 'projects.json');
    if (fs.existsSync(projectsPath)) {
      try {
        const projects = JSON.parse(fs.readFileSync(projectsPath, 'utf-8'));
        if (projects.projects) {
          for (const [dir, name] of Object.entries(projects.projects)) {
            if (name === projectName) {
              // Convert Windows path to WSL if needed
              projectDir = dir.replace(/\\/g, '/');
              if (isWSL() && /^[A-Z]:/.test(dir)) {
                projectDir = dir.replace(/^([A-Z]):\\/, (_, d) => `/mnt/${d.toLowerCase()}/`).replace(/\\/g, '/');
              }
              break;
            }
          }
        }
      } catch {}
    }

    return {
      sessionId: data.sessionId || path.basename(filePath, '.json'),
      projectDir,
      model,
      status: age < ACTIVE_THRESHOLD ? 'active' : 'idle',
      task,
      lastActivity: data.lastUpdated || data.startTime || new Date(fstat.mtimeMs).toISOString(),
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      messageCount: geminiMessages.length,
      recentActions: recentActions.slice(-5),
      thinkingEnabled,
    };
  } catch (err) {
    return null;
  }
}

function buildGeminiManagedPrompt({ sessionId, displayName, index, count, prompt }) {
  const cleanPrompt = normalizeCliPrompt(prompt) || `Stand by for delegated work from The Underground Circle. You are session ${index + 1} of ${count}.`;
  return [
    `[UC-GEMINI-CLI:${sessionId}]`,
    `You are ${displayName}, a managed Gemini CLI terminal session launched from The Underground Circle.`,
    `Session ${index + 1} of ${count}. Work independently and keep concise terminal notes.`,
    '',
    'User task:',
    cleanPrompt,
  ].join('\n');
}

function registerLaunchedGeminiSession(data) {
  const session = {
    sessionId: data.sessionId,
    projectDir: data.projectDir || process.cwd(),
    branch: data.branch || null,
    worktree: data.worktreeDir || null,
    isWorktree: Boolean(data.isWorktree),
    model: data.model || 'gemini-cli',
    status: data.status || 'active',
    task: data.task || 'Gemini CLI terminal session',
    lastActivity: data.lastActivity || new Date().toISOString(),
    totalInputTokens: 0,
    totalOutputTokens: 0,
    messageCount: 0,
    recentActions: data.recentActions || [],
    thinkingEnabled: false,
    displayName: data.displayName,
    prompt: data.prompt,
    launchId: data.launchId,
    launchedAt: data.launchedAt,
    terminal: data.terminal,
    terminalPid: data.terminalPid,
    launchError: data.launchError,
    terminalTitle: data.terminalTitle,
    manageable: Boolean(data.terminalTitle),
  };
  const idx = launchedSessions.findIndex((s) => s.sessionId === session.sessionId);
  if (idx >= 0) launchedSessions[idx] = session;
  else launchedSessions.push(session);
  if (session.terminalTitle) saveManagedTerminalSession('gemini', session);
  return session;
}

function buildGeminiLaunchCommand({ cwd, prompt, model, yolo = false }) {
  const parts = ['gemini'];
  if (model) parts.push('--model', shellQuote(model));
  if (yolo) parts.push('--yolo');
  parts.push('--prompt-interactive', shellTextArg(prompt));
  return `cd ${shellQuote(cwd)} && ${parts.join(' ')}`;
}

async function launchGeminiCliSessions(data) {
  const prompts = Array.isArray(data.prompts)
    ? data.prompts.map((p) => normalizeCliPrompt(p)).filter(Boolean)
    : [];
  const count = clampLaunchCount(data.count || prompts.length || 1);
  const cwd = safeProjectDir(data.cwd || data.projectDir);
  const launchId = data.launchId || makeLaunchId('gemini-cli-launch');
  const model = data.model ? String(data.model).trim() : '';
  const yolo = Boolean(data.yolo);
  const basePrompt = normalizeCliPrompt(data.prompt || data.task || '');
  const sessions = [];
  const failed = [];

  for (let i = 0; i < count; i++) {
    const sessionId = `${launchId}-${i + 1}`;
    const displayName = Array.isArray(data.names) && data.names[i] ? String(data.names[i]) : `Gemini CLI #${i + 1}`;
    // Per-session git-worktree isolation when requested (fail-open to shared cwd).
    const { cwd: sessionCwd, branch, worktreeDir, isWorktree } = ensureOpenSwanWorktree({
      baseCwd: cwd, useWorktree: data.useWorktree, index: i,
    });
    const cleanPrompt = prompts[i] || basePrompt || `Stand by as ${displayName}. Wait for a delegated task from The Underground Circle.`;
    const cliPrompt = appendOpenSwanWorktreeConfigPrompt(
      buildGeminiManagedPrompt({ sessionId, displayName, index: i, count, prompt: cleanPrompt }),
      sessionCwd,
    );
    const command = buildGeminiLaunchCommand({ cwd: sessionCwd, prompt: cliPrompt, model, yolo });
    const launchedAt = new Date().toISOString();
    const terminalTitle = makeTerminalTitle('Gemini CLI', displayName, sessionId);
    const terminalResult = await openTerminal(command, terminalTitle);
    const session = registerLaunchedGeminiSession({
      sessionId,
      projectDir: sessionCwd,
      branch,
      worktreeDir,
      isWorktree,
      model: model || 'gemini-cli',
      status: terminalResult.ok ? 'active' : 'idle',
      displayName,
      task: promptPreview(cleanPrompt, 240),
      prompt: cleanPrompt,
      launchId,
      launchedAt,
      lastActivity: launchedAt,
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

function findLaunchedGeminiSession(sessionId) {
  const key = String(sessionId || '').trim().toLowerCase();
  if (!key) return null;
  return cachedSessions.find((s) =>
    String(s.sessionId || '').toLowerCase() === key
    || String(s.displayName || '').toLowerCase() === key
    || String(s.sessionId || '').toLowerCase().startsWith(key)
  ) || null;
}

function buildGeminiFollowupPrompt(message) {
  return [
    '[UC-GEMINI-CLI-CONTROL]',
    'Follow-up instruction from The Underground Circle chat:',
    normalizeCliPrompt(message),
  ].join('\n');
}

async function sendToLaunchedGeminiSession(data) {
  const session = findLaunchedGeminiSession(data.sessionId || data.target || data.displayName);
  if (!session) return { ok: false, error: 'Gemini CLI session not found.' };
  if (!session.terminalTitle) {
    return {
      ok: false,
      error: 'This Gemini CLI session was detected but was not launched by The Underground Circle, so it cannot be safely targeted from chat. Launch a managed Gemini CLI session from chat first.',
      session,
    };
  }
  const message = normalizeCliPrompt(data.message || data.command || data.prompt || '');
  if (!message) return { ok: false, error: 'Missing message.' };
  const result = await sendToTerminalByTitle(session.terminalTitle, buildGeminiFollowupPrompt(message));
  if (!result.ok) return { ok: false, error: result.error || 'Terminal send failed.', session };

  const updated = registerLaunchedGeminiSession({
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
  doScan();
  return {
    ok: true,
    provider: 'gemini-cli',
    sessionId: updated.sessionId,
    displayName: updated.displayName,
    message: `Sent to ${updated.displayName || updated.sessionId}.`,
    session: updated,
  };
}

// ── Periodic scan ───────────────────────────────────────────────────────────

function doScan() {
  try {
    cachedSessions = scanSessions();
    lastScanTime = new Date().toISOString();
  } catch (err) {
    console.error('[gemini-bridge] Scan error:', err.message);
  }
}

// Initial load
loadOAuthCreds();
userEmail = loadUserEmail();
doScan();
setInterval(doScan, SCAN_INTERVAL);

// ── HTTP server ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  if (url === '/health') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      agent: 'gemini-cli',
      bridge: 'gemini-cli',
      version: '1.1.0',
      sessions: cachedSessions.length,
      capabilities: ['sessions', 'send', 'launch', 'terminal-send'],
    }));
    return;
  }

  if (url === '/pair' && req.method === 'POST') {
    const sourceCheck = isPairingRequestSourceAllowed(req, PORT, isAllowedPairOrigin);
    if (!sourceCheck.ok) {
      res.writeHead(403, CORS);
      res.end(JSON.stringify({
        ok: false,
        code: sourceCheck.code,
        error: 'Pairing is available only through an allowed loopback bridge request.',
      }));
      return;
    }
    let pairInput;
    try {
      pairInput = await readJsonBody(req, 2048);
    } catch (err) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({
        ok: false,
        code: 'pairing_body_invalid',
        error: String(err?.message || err || 'Invalid pairing request body.').slice(0, 300),
      }));
      return;
    }
    const pairingChallenge = String(pairInput?.pairingChallenge || '').trim();
    if (!pairingChallenge) {
      const issued = pairingChallenges.issue(req.socket.remoteAddress);
      res.writeHead(428, CORS);
      res.end(JSON.stringify({
        ok: false,
        code: 'pairing_challenge_required',
        challenge: issued.challenge,
        expiresAt: new Date(issued.expiresAt).toISOString(),
        error: 'Retry pairing once with the short-lived challenge.',
      }));
      return;
    }
    if (!pairingChallenges.consume(pairingChallenge, req.socket.remoteAddress)) {
      res.writeHead(403, CORS);
      res.end(JSON.stringify({
        ok: false,
        code: 'pairing_challenge_invalid',
        error: 'Pairing challenge is invalid, expired, already used, or belongs to another source.',
      }));
      return;
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok: true, token: getOrCreateBridgeToken(), bridge: 'gemini-cli' }));
    return;
  }

  const sourceCheck = isBridgeRequestSourceAllowed(req, PORT, isAllowedPairOrigin);
  if (!sourceCheck.ok) {
    res.writeHead(403, CORS);
    res.end(JSON.stringify({
      ok: false,
      code: sourceCheck.code,
      error: 'Bridge access is available only through an allowed loopback or explicitly configured tunnel request.',
    }));
    return;
  }

  if (url === '/sessions') {
    if (!hasBridgeAuth(req)) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid desktop bridge token' }));
      return;
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ sessions: cachedSessions, timestamp: lastScanTime }));
    return;
  }

  if (url === '/launch' && req.method === 'POST') {
    if (!hasBridgeAuth(req)) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid desktop bridge token' }));
      return;
    }
    try {
      const data = await readJsonBody(req);
      const result = await launchGeminiCliSessions(data);
      doScan();
      res.writeHead(result.ok ? 200 : 207, CORS);
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ ok: false, error: e.message || 'Launch failed' }));
    }
    return;
  }

  if (url === '/terminal/send' && req.method === 'POST') {
    if (!hasBridgeAuth(req)) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid desktop bridge token' }));
      return;
    }
    try {
      const data = await readJsonBody(req);
      const result = await sendToLaunchedGeminiSession(data);
      res.writeHead(result.ok ? 200 : 409, CORS);
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ ok: false, error: e.message || 'Send failed' }));
    }
    return;
  }

  // ── GET /auth — Check OAuth status ─────────────────────────────────────────
  if (url === '/auth' && req.method === 'GET') {
    if (!hasBridgeAuth(req)) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid desktop bridge token' }));
      return;
    }
    loadOAuthCreds(); // Reload from disk
    userEmail = loadUserEmail();
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      authenticated: !!oauthCreds?.access_token,
      email: userEmail,
      expired: isTokenExpired(),
      expiresAt: oauthCreds?.expiry_date ? new Date(oauthCreds.expiry_date).toISOString() : null,
    }));
    return;
  }

  // ── POST /send — Send a message via Gemini API (using OAuth tokens) ────────
  if (url === '/send' && req.method === 'POST') {
    if (!requireBridgeMutationAuth(req, res)) return;

    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 32768) {
        res.writeHead(413, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Request body too large' }));
        req.destroy();
      }
    });
    req.on('end', async () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }

      const { command, model } = parsed;
      if (!command || typeof command !== 'string') {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Missing "command" field' }));
        return;
      }

      // Try Gemini API with OAuth first, fall back to CLI
      let responded = false;

      try {
        const result = await callGeminiAPI(command, model || 'gemini-2.5-flash');
        doScan();
        res.writeHead(200, CORS);
        res.end(JSON.stringify({
          ok: true,
          response: result.response,
          model: result.model,
          tokens: result.tokens,
        }));
        responded = true;
      } catch (apiErr) {
        console.log('[gemini-bridge] API call failed, falling back to CLI:', apiErr.message);
      }

      // Fallback: pipe through gemini CLI (handles its own OAuth)
      if (!responded) {
        const safeCommand = command.replace(/'/g, "'\\''");
        exec(`echo '${safeCommand}' | gemini 2>&1`, {
          timeout: 60000,
          maxBuffer: 1024 * 1024,
          shell: true,
          env: { ...process.env, TERM: 'dumb' },
        }, (err, stdout, stderr) => {
          doScan();
          const response = (stdout || '').trim() || (stderr || '').trim() || '';

          if (err && !response) {
            res.writeHead(200, CORS);
            res.end(JSON.stringify({ ok: false, error: err.message || 'Gemini CLI failed' }));
            return;
          }

          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            response,
            model: 'gemini-cli',
          }));
        });
      }
    });
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: 'Not found. Use /health, /sessions, /auth, /launch, /terminal/send, or /send' }));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Kill it with: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  }
  console.error('[gemini-bridge] Server error:', err.message);
});

process.on('uncaughtException', (err) => console.error('[gemini-bridge] Uncaught:', err.message));

server.listen(PORT, BRIDGE_BIND_HOST, () => {
  console.log(`\n  Gemini CLI Bridge`);
  console.log(`  Serving on http://${BRIDGE_BIND_HOST}:${PORT} (loopback only)`);
  console.log(`  Scanning ${GEMINI_DIR}`);
  console.log(`  Auth: ${oauthCreds ? `OAuth (${userEmail})` : 'Not authenticated — run gemini CLI first'}`);
  console.log(`  Found ${cachedSessions.length} active session(s)\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /health    — Bridge status + auth info`);
  console.log(`    GET  /sessions  — Active Gemini CLI sessions`);
  console.log(`    GET  /auth      — OAuth authentication status`);
  console.log(`    POST /launch    — Launch visible Gemini CLI terminal sessions`);
  console.log(`    POST /terminal/send — Send a chat instruction to a managed terminal session`);
  console.log(`    POST /send      — Send message via Gemini API (uses Gmail OAuth)\n`);
});
