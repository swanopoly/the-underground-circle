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
const crypto = require('crypto');
const { exec, execSync, execFile, execFileSync } = require('child_process');
const {
  appendOpenSwanWorktreeConfigPrompt,
  clampLaunchCount,
  ensureOpenSwanWorktree,
  pruneOpenSwanWorktrees,
  loadManagedTerminalSessions,
  makeLaunchId,
  makeTerminalTitle,
  normalizeCliPrompt,
  openTerminal,
  promptPreview,
  readJsonBody: readJsonBodyPromise,
  safeProjectDir,
  saveManagedTerminalSession,
  sendToTerminalByTitle,
  shellQuote,
  shellTextArg,
} = require('./terminal-launch-utils');

// UC-3: Playwright-backed /browser/* surface. Lazy-loaded so the
// bridge still boots on machines without playwright installed (we log
// a warning and return 503 on /browser/* calls instead of crashing).
let browserBridge = null;
try { browserBridge = require('./browser-bridge'); }
catch (e) { console.warn('[bridge] playwright unavailable — /browser/* will 503:', e.message); }

const PORT = 7778;
const CLAUDE_DIR = path.join(os.homedir(), '.claude', 'projects');
// Also scan Windows-side Claude sessions when running in WSL
const CLAUDE_DIRS = [CLAUDE_DIR];
if (fs.existsSync('/mnt/c/Users')) {
  try {
    const winUsers = fs.readdirSync('/mnt/c/Users').filter(u => !['Public','Default','Default User','All Users'].includes(u));
    for (const u of winUsers) {
      const winClaudeDir = '/mnt/c/Users/' + u + '/.claude/projects';
      if (fs.existsSync(winClaudeDir) && winClaudeDir !== CLAUDE_DIR) {
        CLAUDE_DIRS.push(winClaudeDir);
      }
    }
  } catch {}
}
const ACTIVE_THRESHOLD = 120_000;    // 2min → active (was 30s — too aggressive)
const IDLE_THRESHOLD = 3_600_000;    // 1h → still show session (was 5min — missed live sessions)
const TAIL_BYTES = 2 * 1024 * 1024; // Read last 2MB of each JSONL (was 16KB — way too small for token counting)
const SCAN_INTERVAL = 5000;        // Scan filesystem every 5s
const LAUNCHED_SESSION_TTL = 12 * 60 * 60_000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // IMPORTANT: `X-UC-Desktop-Token` must appear here — the browser's
  // CORS preflight rejects any /desktop/* call without it. Missing
  // this was the source of "it still can't open apps" bugs even
  // after the bridge was running + paired, because every authed call
  // died silently at the preflight layer. If you add another custom
  // request header on the client side, list it here too.
  'Access-Control-Allow-Headers': 'Content-Type, X-UC-Desktop-Token, X-UC-File-Session-Token',
  // Private Network Access (Chrome 116+). When the page is at
  // https://app.chrisswanson.xyz (a public-network origin) and tries
  // to fetch http://localhost:7778 (a private-network address),
  // Chrome sends a preflight with `Access-Control-Request-Private-
  // Network: true` that we MUST acknowledge or the fetch is silently
  // blocked. Without this header, bridges look "offline" on the live
  // site even when they're running locally. Other browsers ignore it
  // safely.
  'Access-Control-Allow-Private-Network': 'true',
  'Content-Type': 'application/json',
};

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] || '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function isClaudeBridgeBillingAllowed() {
  return envFlag('UC_ALLOW_CLAUDE_BRIDGE_BILLING')
    || envFlag('UC_ALLOW_CLAUDE_CODE_BILLING')
    || envFlag('UC_ALLOW_BILLABLE_CLAUDE_ACTIONS');
}

function commandInvokesClaudeBilling(command) {
  return /\bclaude\b/i.test(command)
    || /@anthropic-ai\/claude-code/i.test(command)
    || /api\.anthropic\.com\/v1\/messages/i.test(command)
    || /\bANTHROPIC_API_KEY\b/.test(command);
}

function sendClaudeBillingBlocked(res, headers, action) {
  res.writeHead(403, headers);
  res.end(JSON.stringify({
    ok: false,
    code: 'claude_bridge_billing_disabled',
    error: `${action} is disabled by default to prevent Anthropic charges. Set UC_ALLOW_CLAUDE_BRIDGE_BILLING=1 before starting the bridge to allow billable Claude Code actions.`,
  }));
}

function configuredBridgeOrigins() {
  return String(process.env.UC_BRIDGE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isBridgeOriginAllowed(req) {
  const origin = String(req.headers.origin || '').trim();
  if (!origin) return true;
  if (configuredBridgeOrigins().includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    const isLocalhost = (
      host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || host === '[::1]'
    );
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && isLocalhost) return true;
    if (parsed.protocol === 'https:' && (host === 'app.chrisswanson.xyz' || host.endsWith('.chrisswanson.xyz'))) return true;
  } catch {
    return false;
  }
  return false;
}

function isDesktopTokenValid(req) {
  const sentToken = req.headers['x-uc-desktop-token'];
  return !!sentToken && sentToken === getOrCreateDesktopToken();
}

function buildCorsHeaders(req) {
  const origin = String(req.headers.origin || '').trim();
  const originAllowed = isBridgeOriginAllowed(req);
  return {
    ...CORS,
    'Access-Control-Allow-Origin': origin
      ? (originAllowed ? origin : 'null')
      : '*',
    'Vary': 'Origin',
  };
}

let cachedSessions = [];
let lastScanTime = '';
let launchedSessions = loadManagedTerminalSessions('claude-code');

const LOCAL_FILE_GRANT_DEFAULT_TTL_MS = 4 * 60 * 60 * 1000;
const LOCAL_FILE_GRANT_MAX_TTL_MS = 12 * 60 * 60 * 1000;
const localFileAccessGrants = new Map();

// ── Device discovery cache (10s TTL) ────────────────────────────────────────
const deviceCache = { data: null, timestamp: 0 };
const DEVICE_CACHE_TTL = 10_000;

function isWSL() {
  try {
    const ver = fs.readFileSync('/proc/version', 'utf-8');
    return /microsoft|wsl/i.test(ver);
  } catch { return false; }
}

function safeExec(cmd) {
  try {
    return execSync(cmd, { timeout: 10000, maxBuffer: 512 * 1024, encoding: 'utf-8' }).trim();
  } catch { return ''; }
}

function stripAnsi(text) {
  return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
}

function readTailText(filePath, maxBytes = 131072) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return '';
    const stats = fs.statSync(filePath);
    const size = Number(stats.size || 0);
    const start = Math.max(0, size - Math.max(2048, Math.min(maxBytes, 262144)));
    const fd = fs.openSync(filePath, 'r');
    try {
      const length = size - start;
      if (length <= 0) return '';
      const buffer = Buffer.alloc(length);
      fs.readSync(fd, buffer, 0, length, start);
      return stripAnsi(buffer.toString('utf-8')).replace(/\r/g, '').trim();
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

function isProcessRunning(pid) {
  const numericPid = Number(pid);
  if (!Number.isFinite(numericPid) || numericPid <= 0) return false;
  const out = safeExec(`ps -p ${numericPid} -o pid=`);
  return Boolean(out);
}

function discoverDevices() {
  const now = Date.now();
  if (deviceCache.data && (now - deviceCache.timestamp) < DEVICE_CACHE_TTL) {
    return deviceCache.data;
  }

  const wsl = isWSL();
  const result = { printers: [], serialPorts: [], usbDevices: [], networkPrinters: [], timestamp: new Date().toISOString() };

  // --- Printers ---
  const lpOut = safeExec('lpstat -p -d 2>/dev/null');
  if (lpOut) {
    const defaultMatch = lpOut.match(/system default destination:\s*(\S+)/);
    const defaultPrinter = defaultMatch ? defaultMatch[1] : '';
    const printerLines = lpOut.match(/^printer\s+(\S+)\s+(.*)$/gm) || [];
    for (const line of printerLines) {
      const m = line.match(/^printer\s+(\S+)\s+(.*)/);
      if (m) {
        result.printers.push({ name: m[1], status: m[2].trim(), isDefault: m[1] === defaultPrinter });
      }
    }
  }
  if (wsl) {
    const psOut = safeExec('powershell.exe -c "Get-Printer | ConvertTo-Json" 2>/dev/null');
    if (psOut) {
      try {
        let parsed = JSON.parse(psOut);
        if (!Array.isArray(parsed)) parsed = [parsed];
        for (const p of parsed) {
          result.printers.push({ name: p.Name, status: p.PrinterStatus || 'unknown', isDefault: false, source: 'windows' });
        }
      } catch {}
    }
  }

  // --- Serial ports ---
  const serialGlobs = ['/dev/ttyUSB*', '/dev/ttyACM*', '/dev/ttyS*'];
  for (const pattern of serialGlobs) {
    const found = safeExec(`ls ${pattern} 2>/dev/null`);
    if (found) {
      for (const p of found.split('\n').filter(Boolean)) {
        result.serialPorts.push({ path: p, description: path.basename(p) });
      }
    }
  }
  // /dev/serial/by-id symlinks
  const byId = safeExec('ls -la /dev/serial/by-id/ 2>/dev/null');
  if (byId) {
    const idLines = byId.split('\n').filter(l => l.includes('->'));
    for (const line of idLines) {
      const parts = line.split(/\s+/);
      const name = parts[parts.length - 3] || '';
      const target = parts[parts.length - 1] || '';
      if (name && target) {
        const resolved = path.resolve('/dev/serial/by-id', target);
        // Avoid duplicates
        if (!result.serialPorts.find(s => s.path === resolved)) {
          result.serialPorts.push({ path: resolved, description: name });
        }
      }
    }
  }
  if (wsl) {
    const comPorts = safeExec('powershell.exe -c "[System.IO.Ports.SerialPort]::GetPortNames()" 2>/dev/null');
    if (comPorts) {
      for (const p of comPorts.split('\n').map(s => s.trim()).filter(Boolean)) {
        result.serialPorts.push({ path: p, description: `Windows ${p}`, source: 'windows' });
      }
    }
  }

  // --- USB devices ---
  const usbOut = safeExec('lsusb 2>/dev/null');
  if (usbOut) {
    for (const line of usbOut.split('\n').filter(Boolean)) {
      result.usbDevices.push({ raw: line.trim() });
    }
  }

  // --- Network printers (mDNS) ---
  const mdnsOut = safeExec('avahi-browse -tpr _ipp._tcp 2>/dev/null');
  if (mdnsOut) {
    for (const line of mdnsOut.split('\n').filter(l => l.startsWith('='))) {
      const parts = line.split(';');
      if (parts.length >= 8) {
        result.networkPrinters.push({ name: parts[3], host: parts[6], address: parts[7], port: parts[8] });
      }
    }
  }

  deviceCache.data = result;
  deviceCache.timestamp = now;
  return result;
}

// ── Tail-read a file and parse JSONL lines ──────────────────────────────────

// Token accumulation cache — stores totals per session so we don't re-read entire files every poll
const _tokenCache = new Map(); // sessionId -> { size, totalInput, totalOutput, cached, new, msgCount }

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

// Full file scan for accurate token totals — runs once per session, caches result
function fullTokenScan(filePath, sessionId) {
  try {
    const stat = fs.statSync(filePath);
    const cached = _tokenCache.get(sessionId);
    // If file hasn't grown, return cached totals
    if (cached && cached.size === stat.size) {
      return cached;
    }

    // Read the full file line by line using a stream-like approach
    // For very large files (>50MB), read in chunks
    let totalInput = 0, totalOutput = 0, cachedTokens = 0, newTokens = 0, msgCount = 0;
    const CHUNK = 4 * 1024 * 1024; // 4MB chunks
    const fd = fs.openSync(filePath, 'r');
    let leftover = '';

    for (let offset = 0; offset < stat.size; offset += CHUNK) {
      const readSize = Math.min(CHUNK, stat.size - offset);
      const buf = Buffer.alloc(readSize);
      fs.readSync(fd, buf, 0, readSize, offset);
      const text = leftover + buf.toString('utf-8');
      const lines = text.split('\n');
      leftover = lines.pop() || ''; // Last line may be partial

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line.trim());
          if (entry.type === 'assistant' && entry.message) {
            msgCount++;
            const u = entry.message.usage;
            if (u) {
              totalInput += u.input_tokens || 0;
              totalOutput += u.output_tokens || 0;
              cachedTokens += u.cache_read_input_tokens || 0;
              newTokens += (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0);
            }
          }
        } catch {}
      }
    }
    fs.closeSync(fd);

    const result = { size: stat.size, totalInput, totalOutput, cachedTokens, newTokens, msgCount };
    _tokenCache.set(sessionId, result);
    return result;
  } catch (e) {
    return null;
  }
}

// ── Scan ~/.claude/projects/ for active sessions ────────────────────────────

function scanSessions() {
  const sessions = [];
  for (const claudeDir of CLAUDE_DIRS) {
    if (!fs.existsSync(claudeDir)) continue;
    const scanned = scanDirectory(claudeDir);
    sessions.push(...scanned);
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

function scanDirectory(claudeDir) {
  if (!fs.existsSync(claudeDir)) return [];
  const sessions = [];

  let projectDirs;
  try { projectDirs = fs.readdirSync(claudeDir); } catch { return []; }

  for (const projHash of projectDirs) {
    const projPath = path.join(claudeDir, projHash);
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

      // Skip sessions that are too old — unless they were active very recently
      if (age > IDLE_THRESHOLD) continue;

      // Determine status: trust file modification time
      // Active = file modified in last 2 min (agent is working)
      // Idle = file modified in last 1h (session exists but not actively working)
      const status = age < ACTIVE_THRESHOLD ? 'active' : 'idle';
      const sessionId = file.replace('.jsonl', '');
      const entries = tailRead(filePath);

      // Extract metadata from entries
      let model = 'unknown', projectDir = '', version = '', slug = '';
      let totalInput = 0, totalOutput = 0, cachedTokens = 0, newTokens = 0;
      let messageCount = 0, lastActivity = '';
      const recentActions = [];
      const seenTools = new Set();

      // Rich live context — extracted from tail entries
      let lastUserMessage = '';
      let lastAssistantText = '';
      const recentToolCalls = []; // { tool, file, timestamp } — last 10 with context
      const activeFiles = new Set(); // files being read/edited/written
      let currentToolName = '';      // the tool being used RIGHT NOW (last tool_use in tail)
      let currentToolFile = '';      // the file the current tool is targeting

      // Get accurate token totals from full file scan (cached between polls)
      const fullScan = fullTokenScan(filePath, sessionId);
      if (fullScan) {
        totalInput = fullScan.totalInput;
        totalOutput = fullScan.totalOutput;
        cachedTokens = fullScan.cachedTokens;
        newTokens = fullScan.newTokens;
        messageCount = fullScan.msgCount;
      }

      // Use tail-read entries for metadata + live context
      for (const entry of entries) {
        if (entry.cwd && !projectDir) projectDir = entry.cwd;
        if (entry.version && !version) version = entry.version;
        if (entry.slug && !slug) slug = entry.slug;
        if (entry.timestamp) {
          if (!lastActivity || entry.timestamp > lastActivity) {
            lastActivity = entry.timestamp;
          }
        }

        // Capture last user message (Claude Code uses type 'user', not 'human')
        if ((entry.type === 'human' || entry.type === 'user') && entry.message) {
          const hContent = entry.message.content;
          if (typeof hContent === 'string' && hContent.trim()) {
            lastUserMessage = hContent.trim().slice(0, 500);
          } else if (Array.isArray(hContent)) {
            for (const hc of hContent) {
              if (hc.type === 'text' && hc.text) {
                lastUserMessage = hc.text.trim().slice(0, 500);
              }
            }
          }
        }

        if (entry.type === 'assistant' && entry.message) {
          if (entry.message.model) model = entry.message.model;
          const content = entry.message.content;
          if (Array.isArray(content)) {
            for (const c of content) {
              // Capture assistant text
              if (c.type === 'text' && c.text) {
                lastAssistantText = c.text.trim().slice(0, 500);
              }
              // Capture tool uses with file context
              if (c.type === 'tool_use' && c.name) {
                if (!seenTools.has(c.name)) {
                  seenTools.add(c.name);
                  recentActions.push(c.name);
                }
                // Extract file path from tool input
                let toolFile = '';
                if (c.input) {
                  toolFile = c.input.file_path || c.input.path || c.input.command || '';
                  if (typeof toolFile === 'string' && toolFile.length > 200) {
                    toolFile = toolFile.slice(0, 200);
                  }
                  // Track active files
                  const fp = c.input.file_path || c.input.path || '';
                  if (fp && typeof fp === 'string') activeFiles.add(fp);
                }
                recentToolCalls.push({
                  tool: c.name,
                  file: toolFile,
                  ts: entry.timestamp || '',
                });
                currentToolName = c.name;
                currentToolFile = toolFile;
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
        // Rich live context
        lastUserMessage,
        lastAssistantText,
        recentToolCalls: recentToolCalls.slice(-10),
        activeFiles: [...activeFiles].slice(-10),
        currentToolName,
        currentToolFile,
      });
    }
  }

  return sessions;
}

function buildClaudeManagedPrompt({ sessionId, displayName, index, count, prompt }) {
  const cleanPrompt = normalizeCliPrompt(prompt) || `Stand by for delegated work from The Underground Circle. You are session ${index + 1} of ${count}.`;
  return [
    `[UC-CLAUDE-CODE:${sessionId}]`,
    `You are ${displayName}, a managed Claude Code terminal session launched from The Underground Circle.`,
    `Session ${index + 1} of ${count}. Work independently and keep concise terminal notes.`,
    '',
    'User task:',
    cleanPrompt,
  ].join('\n');
}

function registerLaunchedClaudeSession(data) {
  const session = {
    sessionId: data.sessionId,
    projectDir: data.projectDir || process.cwd(),
    branch: data.branch || null,
    worktree: data.worktreeDir || null,
    isWorktree: Boolean(data.isWorktree),
    projectHash: data.projectHash || 'manual-launch',
    model: data.model || 'claude-code',
    status: data.status || 'active',
    kind: 'main',
    parentSessionId: null,
    slug: data.slug || data.displayName || data.sessionId,
    displayName: data.displayName,
    task: data.task || 'Claude Code terminal session',
    lastActivity: data.lastActivity || new Date().toISOString(),
    version: data.version || '',
    totalInputTokens: 0,
    totalOutputTokens: 0,
    cachedTokens: 0,
    newTokens: 0,
    messageCount: 0,
    recentActions: data.recentActions || [],
    subagentCount: 0,
    lastUserMessage: data.prompt || data.task || '',
    lastAssistantText: '',
    recentToolCalls: [],
    activeFiles: [],
    currentToolName: '',
    currentToolFile: '',
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
  if (session.terminalTitle) saveManagedTerminalSession('claude-code', session);
  return session;
}

function buildClaudeLaunchCommand({ cwd, prompt, model, permissionMode, displayName }) {
  const parts = ['claude'];
  if (displayName) parts.push('-n', shellQuote(displayName));
  if (model) parts.push('--model', shellQuote(model));
  if (permissionMode) parts.push('--permission-mode', shellQuote(permissionMode));
  parts.push(shellTextArg(prompt));
  return `cd ${shellQuote(cwd)} && ${parts.join(' ')}`;
}

async function launchClaudeCodeSessions(data) {
  const prompts = Array.isArray(data.prompts)
    ? data.prompts.map((p) => normalizeCliPrompt(p)).filter(Boolean)
    : [];
  const count = clampLaunchCount(data.count || prompts.length || 1);
  const cwd = safeProjectDir(data.cwd || data.projectDir);
  const launchId = data.launchId || makeLaunchId('claude-code-launch');
  const model = data.model ? String(data.model).trim() : '';
  const permissionMode = data.permissionMode ? String(data.permissionMode).trim() : '';
  const basePrompt = normalizeCliPrompt(data.prompt || data.task || '');
  const sessions = [];
  const failed = [];

  for (let i = 0; i < count; i++) {
    const sessionId = `${launchId}-${i + 1}`;
    const displayName = Array.isArray(data.names) && data.names[i] ? String(data.names[i]) : `Claude Code #${i + 1}`;
    // Per-session git-worktree isolation when requested (fail-open to shared cwd).
    const { cwd: sessionCwd, branch, worktreeDir, isWorktree } = ensureOpenSwanWorktree({
      baseCwd: cwd, useWorktree: data.useWorktree, index: i,
    });
    const cleanPrompt = prompts[i] || basePrompt || `Stand by as ${displayName}. Wait for a delegated task from The Underground Circle.`;
    const cliPrompt = appendOpenSwanWorktreeConfigPrompt(
      buildClaudeManagedPrompt({ sessionId, displayName, index: i, count, prompt: cleanPrompt }),
      sessionCwd,
    );
    const command = buildClaudeLaunchCommand({ cwd: sessionCwd, prompt: cliPrompt, model, permissionMode, displayName });
    const launchedAt = new Date().toISOString();
    const terminalTitle = makeTerminalTitle('Claude Code', displayName, sessionId);
    const terminalResult = await openTerminal(command, terminalTitle);
    const session = registerLaunchedClaudeSession({
      sessionId,
      projectDir: sessionCwd,
      branch,
      worktreeDir,
      isWorktree,
      model: model || 'claude-code',
      status: terminalResult.ok ? 'active' : 'idle',
      displayName,
      slug: displayName,
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

function findLaunchedClaudeSession(sessionId) {
  const key = String(sessionId || '').trim().toLowerCase();
  if (!key) return null;
  return cachedSessions.find((s) =>
    String(s.sessionId || '').toLowerCase() === key
    || String(s.displayName || s.slug || '').toLowerCase() === key
    || String(s.sessionId || '').toLowerCase().startsWith(key)
  ) || null;
}

function buildClaudeFollowupPrompt(message) {
  return [
    '[UC-CLAUDE-CODE-CONTROL]',
    'Follow-up instruction from The Underground Circle chat:',
    normalizeCliPrompt(message),
  ].join('\n');
}

async function sendToLaunchedClaudeSession(data) {
  const session = findLaunchedClaudeSession(data.sessionId || data.target || data.displayName);
  if (!session) return { ok: false, error: 'Claude Code session not found.' };
  if (!session.terminalTitle) {
    return {
      ok: false,
      error: 'This Claude Code session was detected but was not launched by The Underground Circle, so it cannot be safely targeted from chat. Launch a managed Claude Code session from chat first.',
      session,
    };
  }
  const message = normalizeCliPrompt(data.message || data.command || data.prompt || '');
  if (!message) return { ok: false, error: 'Missing message.' };
  const result = await sendToTerminalByTitle(session.terminalTitle, buildClaudeFollowupPrompt(message));
  if (!result.ok) return { ok: false, error: result.error || 'Terminal send failed.', session };

  const updated = registerLaunchedClaudeSession({
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
    provider: 'claude-code',
    sessionId: updated.sessionId,
    displayName: updated.displayName || updated.slug,
    message: `Sent to ${updated.displayName || updated.slug || updated.sessionId}.`,
    session: updated,
  };
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

const server = http.createServer(async (req, res) => {
  const CORS = buildCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS);
    res.end();
    return;
  }

  const url = req.url.split('?')[0];

  if (!isBridgeOriginAllowed(req)) {
    res.writeHead(403, CORS);
    res.end(JSON.stringify({ ok: false, error: 'Origin blocked by bridge allowlist.' }));
    return;
  }

  if (url === '/health') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      bridge: 'claude-code',
      version: '1.1.0',
      sessions: cachedSessions.length,
      mode: isClaudeBridgeBillingAllowed() ? 'billable-actions-enabled' : 'read-only-cost-guard',
      billableClaudeActionsEnabled: isClaudeBridgeBillingAllowed(),
      capabilities: ['sessions', 'exec', 'desktop', 'browser', 'launch', 'spawn', 'terminal-send'],
    }));
    return;
  }

  if (url === '/sessions') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ sessions: cachedSessions, timestamp: lastScanTime }));
    return;
  }

  if (url === '/launch' && req.method === 'POST') {
    if (!isClaudeBridgeBillingAllowed()) {
      sendClaudeBillingBlocked(res, CORS, 'Launching Claude Code sessions');
      return;
    }
    if (!isDesktopTokenValid(req)) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid desktop token. Pair first via POST /desktop/pair.' }));
      return;
    }
    try {
      const data = await readJsonBodyPromise(req);
      const result = await launchClaudeCodeSessions(data);
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
    if (!isClaudeBridgeBillingAllowed()) {
      sendClaudeBillingBlocked(res, CORS, 'Sending prompts to Claude Code sessions');
      return;
    }
    if (!isDesktopTokenValid(req)) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid desktop token. Pair first via POST /desktop/pair.' }));
      return;
    }
    try {
      const data = await readJsonBodyPromise(req);
      const result = await sendToLaunchedClaudeSession(data);
      res.writeHead(result.ok ? 200 : 409, CORS);
      res.end(JSON.stringify(result));
    } catch (e) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ ok: false, error: e.message || 'Send failed' }));
    }
    return;
  }

  // ── POST /worktree/prune — reclaim finished OpenSwan worktrees ──────────────
  // Body: { workdir?, force? }. Safe by default: only clean worktrees are
  // removed; dirty ones (unsaved agent work) are kept.
  if (url === '/worktree/prune' && req.method === 'POST') {
    if (!isDesktopTokenValid(req)) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid desktop token. Pair first via POST /desktop/pair.' }));
      return;
    }
    try {
      const data = await readJsonBodyPromise(req).catch(() => ({}));
      const baseCwd = data?.workdir || process.cwd();
      const { removed, kept } = pruneOpenSwanWorktrees(baseCwd, { force: !!data?.force });
      res.writeHead(200, CORS);
      res.end(JSON.stringify({
        ok: true,
        removed,
        kept,
        message: `Pruned ${removed.length} worktree${removed.length === 1 ? '' : 's'}${kept.length ? `, kept ${kept.length} with unsaved work` : ''}.`,
      }));
    } catch (e) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ ok: false, error: e.message || 'Prune failed' }));
    }
    return;
  }

  // ── GET /context — aggregated context from ALL sessions for cross-session memory ──
  if (url === '/context') {
    const mainSessions = cachedSessions.filter(s => s.kind === 'main' || !s.kind);
    const sessionContexts = mainSessions.map(s => ({
      sessionId: s.sessionId,
      slug: s.slug || s.sessionId.slice(0, 8),
      projectDir: s.projectDir,
      model: s.model,
      status: s.status,
      lastUserMessage: s.lastUserMessage || '',
      lastAssistantText: s.lastAssistantText || '',
      activeFiles: s.activeFiles || [],
      recentToolCalls: (s.recentToolCalls || []).slice(-5),
      currentToolName: s.currentToolName || '',
      currentToolFile: s.currentToolFile || '',
      messageCount: s.messageCount || 0,
      lastActivity: s.lastActivity || '',
    }));

    // Build a unified summary string for easy injection into agent prompts
    const summaryLines = sessionContexts.map(s => {
      const project = s.projectDir.split('/').pop() || 'unknown';
      const files = s.activeFiles.slice(-3).map(f => f.split('/').pop()).join(', ');
      const parts = [`[${s.slug}] ${project} (${s.status})`];
      if (s.lastUserMessage) parts.push(`  User: ${s.lastUserMessage.slice(0, 200)}`);
      if (s.lastAssistantText) parts.push(`  Agent: ${s.lastAssistantText.slice(0, 200)}`);
      if (files) parts.push(`  Files: ${files}`);
      if (s.currentToolName) parts.push(`  Now: ${s.currentToolName}${s.currentToolFile ? ' → ' + s.currentToolFile.split('/').pop() : ''}`);
      return parts.join('\n');
    });

    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      sessionCount: sessionContexts.length,
      sessions: sessionContexts,
      summary: summaryLines.join('\n\n'),
      timestamp: lastScanTime,
    }));
    return;
  }

  // ── GET /memory — serve synced agent memories from .agent-memory/context.md ──
  if (url === '/memory') {
    const memoryFile = path.join(__dirname, '..', '.agent-memory', 'context.md');
    try {
      const content = fs.readFileSync(memoryFile, 'utf-8');
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/markdown' });
      res.end(content);
    } catch {
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ error: 'No synced memories. Run: node scripts/sync-memories.js' }));
    }
    return;
  }

  // ── GET /skills — list SKILL.md files from ~/.claude/skills ───────────────
  // Read-only enumeration + contents. Lets the UC app pull the user's Claude
  // Code skills into a circle via `/skill import` without hand-pasting URLs.
  // Scans one level deep (skill name = subdir name OR bare .md basename).
  if (url === '/skills') {
    const root = path.join(os.homedir(), '.claude', 'skills');
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true });
      const skills = [];
      for (const entry of entries) {
        // Directory form: ~/.claude/skills/<name>/SKILL.md
        if (entry.isDirectory()) {
          const skillPath = path.join(root, entry.name, 'SKILL.md');
          if (fs.existsSync(skillPath)) {
            const stat = fs.statSync(skillPath);
            skills.push({
              name: entry.name,
              format: 'directory',
              path: skillPath,
              sizeBytes: stat.size,
              modifiedAt: stat.mtime.toISOString(),
            });
          }
          continue;
        }
        // Flat form: ~/.claude/skills/<name>.md
        if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const skillPath = path.join(root, entry.name);
          const stat = fs.statSync(skillPath);
          skills.push({
            name: entry.name.replace(/\.md$/i, ''),
            format: 'file',
            path: skillPath,
            sizeBytes: stat.size,
            modifiedAt: stat.mtime.toISOString(),
          });
        }
      }
      skills.sort((a, b) => a.name.localeCompare(b.name));
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ root, count: skills.length, skills }));
    } catch (err) {
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ root, count: 0, skills: [], error: err.code || err.message }));
    }
    return;
  }

  // ── GET /skills/<name> — return the raw SKILL.md content ──────────────────
  if (url.startsWith('/skills/')) {
    const rawName = decodeURIComponent(url.slice('/skills/'.length));
    // Block traversal + absolute paths.
    if (!rawName || rawName.includes('..') || rawName.startsWith('/') || rawName.includes('\0')) {
      res.writeHead(400, CORS);
      res.end(JSON.stringify({ error: 'Invalid skill name' }));
      return;
    }
    const root = path.join(os.homedir(), '.claude', 'skills');
    const candidates = [
      path.join(root, rawName, 'SKILL.md'),
      path.join(root, `${rawName}.md`),
      path.join(root, rawName),
    ];
    let found = null;
    for (const c of candidates) {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) { found = c; break; }
    }
    if (!found) {
      res.writeHead(404, CORS);
      res.end(JSON.stringify({ error: `No skill named "${rawName}" in ${root}` }));
      return;
    }
    try {
      const content = fs.readFileSync(found, 'utf-8');
      res.writeHead(200, { ...CORS, 'Content-Type': 'text/markdown' });
      res.end(content);
    } catch (err) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  // ── POST /exec — run a shell command (restricted) ──────────────────────────
  if (url === '/exec' && req.method === 'POST') {
    // Only allow requests from localhost origins
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
      // Prevent body flooding (max 10KB)
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
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body. Expected { "command": "..." }' }));
        return;
      }
      if (!command || typeof command !== 'string') {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Missing "command" field' }));
        return;
      }

      if (commandInvokesClaudeBilling(command) && !isClaudeBridgeBillingAllowed()) {
        sendClaudeBillingBlocked(res, CORS, 'Running Claude/Anthropic commands through /exec');
        return;
      }

      // Block dangerous patterns that could damage the system
      const BLOCKED_PATTERNS = [
        /\brm\s+(-[a-zA-Z]*\s+)*\//,     // rm with absolute paths
        /\brm\s+(-[a-zA-Z]*\s+)*~/,       // rm in home directory
        /\brmdir\s+(-[a-zA-Z]*\s+)*\//,   // rmdir with absolute paths
        /\bmkfs\b/,                         // format filesystems
        /\bdd\s+.*of=/,                     // dd write operations
        />\s*\/dev\/sd/,                     // write to block devices
        /\bcurl\b.*\|\s*(ba)?sh/,           // curl pipe to shell
        /\bwget\b.*\|\s*(ba)?sh/,           // wget pipe to shell
        /\bchmod\s+777\b/,                  // world-writable permissions
        /\bpasswd\b/,                        // password changes
        /\buseradd\b/,                       // user creation
        /\buserdel\b/,                       // user deletion
        /\bsudo\b/,                          // privilege escalation
        /\bsu\s+-?\s/,                       // switch user
        /\/etc\/shadow/,                     // shadow file access
        /\/etc\/passwd/,                     // passwd file access
        /\benv\b.*SECRET|KEY|TOKEN|PASS/i,   // env var exfiltration
        /\bcrontab\s+-[er]/,                 // crontab editing
        /\bshutdown\b/,                      // system shutdown
        /\breboot\b/,                        // system reboot
      ];

      const blocked = BLOCKED_PATTERNS.some(p => p.test(command));
      if (blocked) {
        res.writeHead(403, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Command blocked: contains restricted pattern' }));
        return;
      }

      exec(command, { timeout: 30000, maxBuffer: 1024 * 1024, shell: true }, (err, stdout, stderr) => {
        res.writeHead(200, CORS);
        if (err && err.killed) {
          res.end(JSON.stringify({ ok: false, error: 'Command timed out (30s)' }));
        } else {
          res.end(JSON.stringify({
            ok: !err || err.code === 0,
            stdout: (stdout || '').slice(0, 65536), // Cap output at 64KB
            stderr: (stderr || '').slice(0, 16384),  // Cap stderr at 16KB
            code: err ? err.code || 1 : 0,
          }));
        }
      });
    });
    return;
  }


  // ── POST /secrets — fetch credentials from 1Password via op CLI ──────────────
  // Body: { item: "WordPress Warsaw", vault?: "Agent Credentials", fields?: ["username","password"] }
  // Requires: `op` CLI installed + OP_SERVICE_ACCOUNT_TOKEN env var set
  // Returns: { ok: true, fields: { username: "...", password: "..." } }
  if (url === '/secrets' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 8000) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' })); return; }
      const { item, vault, fields, uri } = parsed;

      if (!item && !uri) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Missing item name or op:// URI' }));
        return;
      }

      // Check if op CLI is available
      try { execSync('op --version', { timeout: 5000, stdio: 'pipe' }); } catch {
        res.writeHead(500, CORS);
        res.end(JSON.stringify({ ok: false, error: '1Password CLI (op) not found. Install: https://1password.com/downloads/command-line/' }));
        return;
      }

      try {
        let result;
        if (uri) {
          // Direct op:// URI resolution: op read "op://vault/item/field"
          const out = execSync(`op read "${uri}"`, { timeout: 10000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
          result = { value: out };
        } else {
          // Item get with specific fields
          const vaultFlag = vault ? ` --vault "${vault}"` : '';
          const fieldsFlag = fields?.length ? ` --fields "${fields.join(',')}"` : '';
          const cmd = `op item get "${item}"${vaultFlag}${fieldsFlag} --format json`;
          const out = execSync(cmd, { timeout: 10000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
          const data = JSON.parse(out);
          // Normalize: if fields were requested, data is an array of {id, value, label}
          if (Array.isArray(data)) {
            const fieldMap = {};
            for (const f of data) { fieldMap[f.label || f.id] = f.value; }
            result = fieldMap;
          } else if (data.fields) {
            const fieldMap = {};
            for (const f of data.fields) {
              if (f.value) fieldMap[f.label || f.id] = f.value;
            }
            result = fieldMap;
          } else {
            result = data;
          }
        }
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, fields: result }));
      } catch (err) {
        const msg = err.stderr ? err.stderr.toString().trim() : (err.message || 'op command failed');
        res.writeHead(500, CORS);
        res.end(JSON.stringify({ ok: false, error: msg }));
      }
    });
    return;
  }

  // ── POST /spawn — spawn one or more Claude Code sessions with tasks ─────────
  // Body: { task, model?, workdir?, count?, tasks?, useWorktree? }
  //   - task + count: spawn N sessions with the same task (appends index)
  //   - tasks: array of { task, model? } to spawn one per entry
  //   - useWorktree: if true, each session gets its own git worktree branch
  if (url === '/spawn' && req.method === 'POST') {
    if (!isClaudeBridgeBillingAllowed()) {
      sendClaudeBillingBlocked(res, CORS, 'Spawning Claude Code sessions');
      return;
    }
    let body = '';
    req.on('data', c => { body += c; if (body.length > 128000) req.destroy(); });
    req.on('end', async () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' })); return; }

      // Normalize into an array of { task, model }
      let items = [];
      if (Array.isArray(parsed.tasks)) {
        items = parsed.tasks.filter(t => t && t.task).slice(0, 20);
      } else if (parsed.task) {
        const count = Math.min(Math.max(parseInt(parsed.count) || 1, 1), 20);
        for (let i = 0; i < count; i++) {
          const suffix = count > 1 ? ` (agent ${i + 1}/${count})` : '';
          items.push({ task: parsed.task + suffix, model: parsed.model });
        }
      }
      if (items.length === 0) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'Missing task or tasks[]' })); return; }

      const baseCwd = parsed.workdir || process.cwd();
      const useWorktree = !!parsed.useWorktree;
      const results = [];

      for (let i = 0; i < items.length; i++) {
        const { task, model } = items[i];
        const modelFlag = model ? `--model ${model}` : '';
        // Optional: git worktree isolation per agent (shared helper, fail-open).
        const { cwd } = ensureOpenSwanWorktree({ baseCwd, useWorktree, index: i });

        const escaped = task.replace(/'/g, "'\\''");
        const logFile = `/tmp/claude-spawn-${Date.now()}-${i}.log`;
        const cmd = `cd "${cwd}" && nohup claude ${modelFlag} --dangerously-skip-permissions -p "${escaped}" > "${logFile}" 2>&1 & echo $!`;

        try {
          const pid = await new Promise((resolve, reject) => {
            exec(cmd, { timeout: 15000, shell: '/bin/bash' }, (err, stdout) => {
              if (err) reject(err);
              else resolve(stdout.trim());
            });
          });
          results.push({ ok: true, pid, task: task.slice(0, 120), cwd, logFile });
        } catch (err) {
          results.push({ ok: false, error: err.message, task: task.slice(0, 120) });
        }
      }

      const succeeded = results.filter(r => r.ok).length;
      res.writeHead(200, CORS);
      res.end(JSON.stringify({
        ok: succeeded > 0,
        spawned: succeeded,
        total: items.length,
        results,
        message: `Spawned ${succeeded}/${items.length} Claude Code session${succeeded !== 1 ? 's' : ''}`,
      }));
    });
    return;
  }

  // ── POST /spawn/status — inspect a spawned Claude Code process/log ───────
  // Body: { pid, logFile, maxBytes? }
  if (url === '/spawn/status' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 32000) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body || '{}'); } catch { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' })); return; }

      const pid = String(parsed.pid || '').trim();
      const logFile = String(parsed.logFile || '').trim();
      if (!pid && !logFile) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Missing pid or logFile' }));
        return;
      }

      const maxBytes = Math.max(4096, Math.min(parseInt(parsed.maxBytes, 10) || 131072, 262144));
      const fileExists = !!logFile && fs.existsSync(logFile);
      const output = fileExists ? readTailText(logFile, maxBytes) : '';
      const isRunning = pid ? isProcessRunning(pid) : false;
      let lastUpdatedAt = null;
      let byteLength = 0;
      if (fileExists) {
        try {
          const stats = fs.statSync(logFile);
          lastUpdatedAt = stats.mtime.toISOString();
          byteLength = Number(stats.size || 0);
        } catch {}
      }

      res.writeHead(200, CORS);
      res.end(JSON.stringify({
        ok: true,
        pid: pid || null,
        logFile: logFile || null,
        isRunning,
        completed: !isRunning,
        hasOutput: output.length > 0,
        output,
        lastUpdatedAt,
        byteLength,
      }));
    });
    return;
  }

  // ── GET /devices — Discover all connected devices ──────────────────────────
  if (url === '/devices' && req.method === 'GET') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify(discoverDevices()));
    return;
  }

  // ── GET /devices/printers — List printers with status ─────────────────────
  if (url === '/devices/printers' && req.method === 'GET') {
    const lpOut = safeExec('lpstat -p -d 2>/dev/null');
    const printers = [];
    if (lpOut) {
      const defaultMatch = lpOut.match(/system default destination:\s*(\S+)/);
      const defaultPrinter = defaultMatch ? defaultMatch[1] : '';
      const printerLines = lpOut.match(/^printer\s+(\S+)\s+(.*)$/gm) || [];
      for (const line of printerLines) {
        const m = line.match(/^printer\s+(\S+)\s+(.*)/);
        if (m) {
          printers.push({ name: m[1], status: m[2].trim(), isDefault: m[1] === defaultPrinter });
        }
      }
    }
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ printers }));
    return;
  }

  // ── POST /devices/print — Print a file or text ────────────────────────────
  if (url === '/devices/print' && req.method === 'POST') {
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
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }

      const { printer, text, file, copies } = parsed;
      if (!text && !file) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Must provide "text" or "file"' }));
        return;
      }

      let filePath = file;
      if (text) {
        filePath = path.join(os.tmpdir(), `claude-print-${Date.now()}.txt`);
        fs.writeFileSync(filePath, text, 'utf-8');
      }

      const parts = ['lp'];
      if (printer) parts.push('-d', printer);
      if (copies && copies > 1) parts.push('-n', String(copies));
      parts.push('--', filePath);

      exec(parts.join(' '), { timeout: 15000 }, (err, stdout, stderr) => {
        // Clean up temp file
        if (text) try { fs.unlinkSync(filePath); } catch {}

        if (err) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ ok: false, error: stderr || err.message }));
        } else {
          const jobMatch = (stdout || '').match(/request id is (\S+)/);
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, jobId: jobMatch ? jobMatch[1] : 'unknown' }));
        }
      });
    });
    return;
  }

  // ── GET /devices/serial — List serial ports ───────────────────────────────
  if (url === '/devices/serial' && req.method === 'GET') {
    const ports = [];
    const wsl = isWSL();

    const serialGlobs = ['/dev/ttyUSB*', '/dev/ttyACM*', '/dev/ttyS*'];
    for (const pattern of serialGlobs) {
      const found = safeExec(`ls ${pattern} 2>/dev/null`);
      if (found) {
        for (const p of found.split('\n').filter(Boolean)) {
          ports.push({ path: p, description: path.basename(p) });
        }
      }
    }

    const byId = safeExec('ls -la /dev/serial/by-id/ 2>/dev/null');
    if (byId) {
      const idLines = byId.split('\n').filter(l => l.includes('->'));
      for (const line of idLines) {
        const parts = line.split(/\s+/);
        const name = parts[parts.length - 3] || '';
        const target = parts[parts.length - 1] || '';
        if (name && target) {
          const resolved = path.resolve('/dev/serial/by-id', target);
          if (!ports.find(s => s.path === resolved)) {
            ports.push({ path: resolved, description: name });
          }
        }
      }
    }

    if (wsl) {
      const comPorts = safeExec('powershell.exe -c "[System.IO.Ports.SerialPort]::GetPortNames()" 2>/dev/null');
      if (comPorts) {
        for (const p of comPorts.split('\n').map(s => s.trim()).filter(Boolean)) {
          ports.push({ path: p, description: `Windows ${p}`, source: 'windows' });
        }
      }
    }

    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ports }));
    return;
  }

  // ── POST /devices/serial/send — Send data to a serial port ────────────────
  if (url === '/devices/serial/send' && req.method === 'POST') {
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
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }

      const { port, data, baudRate } = parsed;
      if (!port || !data) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Missing "port" or "data"' }));
        return;
      }

      // Validate port path to prevent injection
      if (!/^(\/dev\/tty[A-Za-z0-9\/]+|COM\d+)$/.test(port)) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid port path' }));
        return;
      }

      let cmd;
      if (baudRate) {
        cmd = `stty -F ${port} ${baudRate} raw -echo 2>/dev/null; echo -ne ${JSON.stringify(data)} > ${port}`;
      } else {
        cmd = `echo -ne ${JSON.stringify(data)} > ${port}`;
      }

      exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
        if (err) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ ok: false, error: stderr || err.message }));
        } else {
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true }));
        }
      });
    });
    return;
  }

  // ── GET /devices/3dprinter — Detect 3D printer services ───────────────────
  if (url === '/devices/3dprinter' && req.method === 'GET') {
    const services = [];

    // Check OctoPrint
    const octoPrint = safeExec('curl -s http://localhost:5000/api/version 2>/dev/null');
    if (octoPrint) {
      try {
        const info = JSON.parse(octoPrint);
        services.push({ type: 'octoprint', url: 'http://localhost:5000', status: 'online', version: info.server || info.text || 'unknown' });
      } catch {
        if (octoPrint.length > 0) services.push({ type: 'octoprint', url: 'http://localhost:5000', status: 'responding' });
      }
    }

    // Check Klipper/Moonraker
    const moonraker = safeExec('curl -s http://localhost:7125/server/info 2>/dev/null');
    if (moonraker) {
      try {
        const info = JSON.parse(moonraker);
        services.push({ type: 'klipper', url: 'http://localhost:7125', status: 'online', version: info.result?.software_version || 'unknown' });
      } catch {
        if (moonraker.length > 0) services.push({ type: 'klipper', url: 'http://localhost:7125', status: 'responding' });
      }
    }

    // Check serial ports for common 3D printer USB vendor/product IDs
    const usbOut = safeExec('lsusb 2>/dev/null');
    if (usbOut) {
      const printerIds = [
        { pattern: /2c99/i, brand: 'Prusa' },
        { pattern: /1a86:7523/i, brand: 'CH340 (common 3D printer)' },
        { pattern: /0403:6001/i, brand: 'FTDI (common 3D printer)' },
        { pattern: /2341/i, brand: 'Arduino/3D printer' },
        { pattern: /1d50:6029/i, brand: 'Marlin USB' },
      ];
      for (const line of usbOut.split('\n')) {
        for (const { pattern, brand } of printerIds) {
          if (pattern.test(line)) {
            services.push({ type: 'serial', status: 'detected', description: `${brand}: ${line.trim()}` });
          }
        }
      }
    }

    res.writeHead(200, CORS);
    res.end(JSON.stringify({ services }));
    return;
  }

  // ── POST /devices/3dprinter/command — Send G-code to a 3D printer ─────────
  if (url === '/devices/3dprinter/command' && req.method === 'POST') {
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
      let parsed;
      try { parsed = JSON.parse(body); } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid JSON body' }));
        return;
      }

      const { target, command, apiKey, port } = parsed;
      if (!target || !command) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Missing "target" or "command"' }));
        return;
      }

      if (target === 'octoprint') {
        const headers = apiKey ? `-H "X-Api-Key: ${apiKey}"` : '';
        const payload = JSON.stringify({ command });
        const cmd = `curl -s -X POST http://localhost:5000/api/printer/command ${headers} -H "Content-Type: application/json" -d '${payload}'`;
        exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(500, CORS);
            res.end(JSON.stringify({ ok: false, error: stderr || err.message }));
          } else {
            res.writeHead(200, CORS);
            res.end(JSON.stringify({ ok: true, response: stdout || undefined }));
          }
        });
      } else if (target === 'klipper') {
        const payload = JSON.stringify({ script: command });
        const cmd = `curl -s -X POST http://localhost:7125/printer/gcode/script -H "Content-Type: application/json" -d '${payload}'`;
        exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(500, CORS);
            res.end(JSON.stringify({ ok: false, error: stderr || err.message }));
          } else {
            res.writeHead(200, CORS);
            res.end(JSON.stringify({ ok: true, response: stdout || undefined }));
          }
        });
      } else if (target === 'serial') {
        if (!port) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Serial target requires "port"' }));
          return;
        }
        if (!/^(\/dev\/tty[A-Za-z0-9\/]+|COM\d+)$/.test(port)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid port path' }));
          return;
        }
        // Send G-code with newline terminator
        const gcode = command.endsWith('\n') ? command : command + '\n';
        const cmd = `echo -ne ${JSON.stringify(gcode)} > ${port}`;
        exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(500, CORS);
            res.end(JSON.stringify({ ok: false, error: stderr || err.message }));
          } else {
            res.writeHead(200, CORS);
            res.end(JSON.stringify({ ok: true }));
          }
        });
      } else {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Invalid target. Use "octoprint", "klipper", or "serial"' }));
      }
    });
    return;
  }

  // ── GET /devices/network — Scan local network for devices ─────────────────
  if (url === '/devices/network' && req.method === 'GET') {
    const devices = [];

    // ARP table
    const arpOut = safeExec('arp -a 2>/dev/null');
    if (arpOut) {
      for (const line of arpOut.split('\n').filter(Boolean)) {
        const m = line.match(/^(\S+)\s+\(([^)]+)\)\s+at\s+(\S+)/);
        if (m) {
          devices.push({ hostname: m[1] !== '?' ? m[1] : undefined, ip: m[2], mac: m[3] !== '<incomplete>' ? m[3] : undefined });
        }
      }
    }

    // mDNS discovery
    const mdnsOut = safeExec('avahi-browse -tpr _http._tcp 2>/dev/null');
    if (mdnsOut) {
      for (const line of mdnsOut.split('\n').filter(l => l.startsWith('='))) {
        const parts = line.split(';');
        if (parts.length >= 8) {
          const existing = devices.find(d => d.ip === parts[7]);
          if (existing) {
            existing.services = existing.services || [];
            existing.services.push(parts[3]);
          } else {
            devices.push({ hostname: parts[6] || undefined, ip: parts[7], services: [parts[3]] });
          }
        }
      }
    }

    res.writeHead(200, CORS);
    res.end(JSON.stringify({ devices }));
    return;
  }

  // ── POST /mcp — MCP (Model Context Protocol) JSON-RPC endpoint ───────────
  if (url === '/mcp' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 65536) {
        res.writeHead(413, CORS);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Request too large' } }));
        req.destroy();
      }
    });
    req.on('end', () => {
      let rpcReq;
      try {
        rpcReq = JSON.parse(body);
      } catch {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }));
        return;
      }

      const { jsonrpc, id, method, params } = rpcReq;
      if (jsonrpc !== '2.0' || id === undefined) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ jsonrpc: '2.0', id: id || null, error: { code: -32600, message: 'Invalid JSON-RPC request' } }));
        return;
      }

      const publicMcpMethods = new Set(['initialize', 'tools/list', 'resources/list']);
      if (!publicMcpMethods.has(method) && !isDesktopTokenValid(req)) {
        res.writeHead(401, CORS);
        res.end(JSON.stringify({
          jsonrpc: '2.0',
          id,
          error: { code: -32001, message: 'Missing or invalid desktop token. Pair first via POST /desktop/pair.' },
        }));
        return;
      }

      // MCP tool definitions
      const MCP_TOOLS = [
        {
          name: 'list_sessions',
          description: 'List all active Claude Code sessions detected by the bridge',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { title: 'List Sessions', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        },
        {
          name: 'exec_command',
          description: 'Execute a shell command on the bridge host (restricted, dangerous commands are blocked)',
          inputSchema: {
            type: 'object',
            properties: { command: { type: 'string', description: 'The shell command to execute' } },
            required: ['command'],
            additionalProperties: false
          },
          annotations: { title: 'Execute Command', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
        },
        {
          name: 'list_devices',
          description: 'Discover all connected devices (printers, serial ports, USB, network printers)',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { title: 'List Devices', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        },
        {
          name: 'list_printers',
          description: 'List available printers with their status',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { title: 'List Printers', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        },
        {
          name: 'print_text',
          description: 'Print text content to a printer',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The text content to print' },
              printer: { type: 'string', description: 'Printer name (optional, uses default if omitted)' }
            },
            required: ['text'],
            additionalProperties: false
          },
          annotations: { title: 'Print Text', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
        },
        {
          name: 'list_serial_ports',
          description: 'List available serial ports (Linux and Windows via WSL)',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { title: 'List Serial Ports', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        },
        {
          name: 'send_serial',
          description: 'Send data to a serial port',
          inputSchema: {
            type: 'object',
            properties: {
              port: { type: 'string', description: 'Serial port path (e.g. /dev/ttyUSB0 or COM3)' },
              data: { type: 'string', description: 'Data string to send' },
              baudRate: { type: 'number', description: 'Baud rate (optional)' }
            },
            required: ['port', 'data'],
            additionalProperties: false
          },
          annotations: { title: 'Send Serial Data', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
        },
        {
          name: 'detect_3d_printer',
          description: 'Detect 3D printer services (OctoPrint, Klipper, serial-connected printers)',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { title: 'Detect 3D Printer', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        },
        {
          name: 'send_gcode',
          description: 'Send G-code command to a 3D printer via OctoPrint, Klipper, or serial',
          inputSchema: {
            type: 'object',
            properties: {
              command: { type: 'string', description: 'G-code command to send' },
              printer: { type: 'string', description: 'Target printer type: "octoprint", "klipper", or "serial"' }
            },
            required: ['command'],
            additionalProperties: false
          },
          annotations: { title: 'Send G-code', readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }
        },
        {
          name: 'scan_network',
          description: 'Scan the local network for devices using ARP and mDNS',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { title: 'Scan Network', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
        }
      ];

      // MCP resource definitions
      const MCP_RESOURCES = [
        { uri: 'bridge://sessions', name: 'Active Sessions', description: 'Currently active Claude Code sessions', mimeType: 'application/json' },
        { uri: 'bridge://devices', name: 'Connected Devices', description: 'All discovered devices (printers, serial, USB, network)', mimeType: 'application/json' },
        { uri: 'bridge://health', name: 'Bridge Health', description: 'Bridge server health and status', mimeType: 'application/json' }
      ];

      function mcpResult(result) {
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
      }

      function mcpError(code, message, data) {
        res.writeHead(200, CORS);
        const errObj = { code, message };
        if (data !== undefined) errObj.data = data;
        res.end(JSON.stringify({ jsonrpc: '2.0', id, error: errObj }));
      }

      if (method === 'initialize') {
        mcpResult({
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false }
          },
          serverInfo: { name: 'claude-bridge', version: '1.0.0' }
        });
        return;
      }

      if (method === 'tools/list') {
        mcpResult({ tools: MCP_TOOLS });
        return;
      }

      if (method === 'tools/call') {
        const toolName = params && params.name;
        const toolArgs = (params && params.arguments) || {};

        if (!toolName) {
          mcpError(-32602, 'Missing tool name in params.name');
          return;
        }

        if (toolName === 'list_sessions') {
          mcpResult({ content: [{ type: 'text', text: JSON.stringify({ sessions: cachedSessions, timestamp: lastScanTime }, null, 2) }] });
          return;
        }

        if (toolName === 'exec_command') {
          const command = toolArgs.command;
          if (!command || typeof command !== 'string') {
            mcpError(-32602, 'Missing or invalid "command" argument');
            return;
          }
          const BLOCKED = [
            /\brm\s+(-[a-zA-Z]*\s+)*\//,
            /\brm\s+(-[a-zA-Z]*\s+)*~/,
            /\brmdir\s+(-[a-zA-Z]*\s+)*\//,
            /\bmkfs\b/,
            /\bdd\s+.*of=/,
            />\s*\/dev\/sd/,
            /\bcurl\b.*\|\s*(ba)?sh/,
            /\bwget\b.*\|\s*(ba)?sh/,
            /\bchmod\s+777\b/,
            /\bpasswd\b/,
            /\buseradd\b/,
            /\buserdel\b/,
            /\bsudo\b/,
            /\bsu\s+-?\s/,
            /\/etc\/shadow/,
            /\/etc\/passwd/,
            /\benv\b.*SECRET|KEY|TOKEN|PASS/i,
            /\bcrontab\s+-[er]/,
            /\bshutdown\b/,
            /\breboot\b/,
          ];
          if (BLOCKED.some(p => p.test(command))) {
            mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Command blocked: contains restricted pattern' }) }], isError: true });
            return;
          }
          exec(command, { timeout: 30000, maxBuffer: 1024 * 1024, shell: true }, (err, stdout, stderr) => {
            if (err && err.killed) {
              mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'Command timed out (30s)' }) }], isError: true });
            } else {
              mcpResult({ content: [{ type: 'text', text: JSON.stringify({
                ok: !err || err.code === 0,
                stdout: (stdout || '').slice(0, 65536),
                stderr: (stderr || '').slice(0, 16384),
                code: err ? err.code || 1 : 0,
              }, null, 2) }] });
            }
          });
          return;
        }

        if (toolName === 'list_devices') {
          mcpResult({ content: [{ type: 'text', text: JSON.stringify(discoverDevices(), null, 2) }] });
          return;
        }

        if (toolName === 'list_printers') {
          const lpOut = safeExec('lpstat -p -d 2>/dev/null');
          const printers = [];
          if (lpOut) {
            const defaultMatch = lpOut.match(/system default destination:\s*(\S+)/);
            const defaultPrinter = defaultMatch ? defaultMatch[1] : '';
            const printerLines = lpOut.match(/^printer\s+(\S+)\s+(.*)$/gm) || [];
            for (const line of printerLines) {
              const m = line.match(/^printer\s+(\S+)\s+(.*)/);
              if (m) printers.push({ name: m[1], status: m[2].trim(), isDefault: m[1] === defaultPrinter });
            }
          }
          mcpResult({ content: [{ type: 'text', text: JSON.stringify({ printers }, null, 2) }] });
          return;
        }

        if (toolName === 'print_text') {
          const { text, printer } = toolArgs;
          if (!text || typeof text !== 'string') {
            mcpError(-32602, 'Missing or invalid "text" argument');
            return;
          }
          const tmpFile = path.join(os.tmpdir(), 'claude-mcp-print-' + Date.now() + '.txt');
          fs.writeFileSync(tmpFile, text, 'utf-8');
          const parts = ['lp'];
          if (printer) parts.push('-d', printer);
          parts.push('--', tmpFile);
          exec(parts.join(' '), { timeout: 15000 }, (err, stdout, stderr) => {
            try { fs.unlinkSync(tmpFile); } catch {}
            if (err) {
              mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: stderr || err.message }) }], isError: true });
            } else {
              const jobMatch = (stdout || '').match(/request id is (\S+)/);
              mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: true, jobId: jobMatch ? jobMatch[1] : 'unknown' }) }] });
            }
          });
          return;
        }

        if (toolName === 'list_serial_ports') {
          const ports = [];
          const wsl = isWSL();
          for (const pattern of ['/dev/ttyUSB*', '/dev/ttyACM*', '/dev/ttyS*']) {
            const found = safeExec('ls ' + pattern + ' 2>/dev/null');
            if (found) {
              for (const p of found.split('\n').filter(Boolean)) {
                ports.push({ path: p, description: path.basename(p) });
              }
            }
          }
          const byId = safeExec('ls -la /dev/serial/by-id/ 2>/dev/null');
          if (byId) {
            for (const line of byId.split('\n').filter(l => l.includes('->'))) {
              const pts = line.split(/\s+/);
              const name = pts[pts.length - 3] || '';
              const target = pts[pts.length - 1] || '';
              if (name && target) {
                const resolved = path.resolve('/dev/serial/by-id', target);
                if (!ports.find(s => s.path === resolved)) {
                  ports.push({ path: resolved, description: name });
                }
              }
            }
          }
          if (wsl) {
            const comPorts = safeExec('powershell.exe -c "[System.IO.Ports.SerialPort]::GetPortNames()" 2>/dev/null');
            if (comPorts) {
              for (const p of comPorts.split('\n').map(s => s.trim()).filter(Boolean)) {
                ports.push({ path: p, description: 'Windows ' + p, source: 'windows' });
              }
            }
          }
          mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ports }, null, 2) }] });
          return;
        }

        if (toolName === 'send_serial') {
          const { port, data, baudRate } = toolArgs;
          if (!port || !data) {
            mcpError(-32602, 'Missing "port" or "data" argument');
            return;
          }
          if (!/^(\/dev\/tty[A-Za-z0-9\/]+|COM\d+)$/.test(port)) {
            mcpError(-32602, 'Invalid port path');
            return;
          }
          let cmd;
          if (baudRate) {
            cmd = 'stty -F ' + port + ' ' + baudRate + ' raw -echo 2>/dev/null; echo -ne ' + JSON.stringify(data) + ' > ' + port;
          } else {
            cmd = 'echo -ne ' + JSON.stringify(data) + ' > ' + port;
          }
          exec(cmd, { timeout: 10000 }, (err, stdout, stderr) => {
            if (err) {
              mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: stderr || err.message }) }], isError: true });
            } else {
              mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] });
            }
          });
          return;
        }

        if (toolName === 'detect_3d_printer') {
          const services = [];
          const octoPrint = safeExec('curl -s http://localhost:5000/api/version 2>/dev/null');
          if (octoPrint) {
            try {
              const info = JSON.parse(octoPrint);
              services.push({ type: 'octoprint', url: 'http://localhost:5000', status: 'online', version: info.server || info.text || 'unknown' });
            } catch {
              if (octoPrint.length > 0) services.push({ type: 'octoprint', url: 'http://localhost:5000', status: 'responding' });
            }
          }
          const moonraker = safeExec('curl -s http://localhost:7125/server/info 2>/dev/null');
          if (moonraker) {
            try {
              const info = JSON.parse(moonraker);
              services.push({ type: 'klipper', url: 'http://localhost:7125', status: 'online', version: info.result?.software_version || 'unknown' });
            } catch {
              if (moonraker.length > 0) services.push({ type: 'klipper', url: 'http://localhost:7125', status: 'responding' });
            }
          }
          const usbOut = safeExec('lsusb 2>/dev/null');
          if (usbOut) {
            const printerIds = [
              { pattern: /2c99/i, brand: 'Prusa' },
              { pattern: /1a86:7523/i, brand: 'CH340 (common 3D printer)' },
              { pattern: /0403:6001/i, brand: 'FTDI (common 3D printer)' },
              { pattern: /2341/i, brand: 'Arduino/3D printer' },
              { pattern: /1d50:6029/i, brand: 'Marlin USB' },
            ];
            for (const line of usbOut.split('\n')) {
              for (const { pattern, brand } of printerIds) {
                if (pattern.test(line)) {
                  services.push({ type: 'serial', status: 'detected', description: brand + ': ' + line.trim() });
                }
              }
            }
          }
          mcpResult({ content: [{ type: 'text', text: JSON.stringify({ services }, null, 2) }] });
          return;
        }

        if (toolName === 'send_gcode') {
          const gcodeCmd = toolArgs.command;
          const target = toolArgs.printer || 'octoprint';
          if (!gcodeCmd || typeof gcodeCmd !== 'string') {
            mcpError(-32602, 'Missing or invalid "command" argument');
            return;
          }
          if (target === 'octoprint') {
            const payload = JSON.stringify({ command: gcodeCmd });
            const cmd = 'curl -s -X POST http://localhost:5000/api/printer/command -H "Content-Type: application/json" -d \'' + payload + '\'';
            exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
              if (err) {
                mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: stderr || err.message }) }], isError: true });
              } else {
                mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: true, response: stdout || undefined }) }] });
              }
            });
          } else if (target === 'klipper') {
            const payload = JSON.stringify({ script: gcodeCmd });
            const cmd = 'curl -s -X POST http://localhost:7125/printer/gcode/script -H "Content-Type: application/json" -d \'' + payload + '\'';
            exec(cmd, { timeout: 15000 }, (err, stdout, stderr) => {
              if (err) {
                mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: false, error: stderr || err.message }) }], isError: true });
              } else {
                mcpResult({ content: [{ type: 'text', text: JSON.stringify({ ok: true, response: stdout || undefined }) }] });
              }
            });
          } else {
            mcpError(-32602, 'Invalid printer target. Use "octoprint" or "klipper"');
          }
          return;
        }

        if (toolName === 'scan_network') {
          const devices = [];
          const arpOut = safeExec('arp -a 2>/dev/null');
          if (arpOut) {
            for (const line of arpOut.split('\n').filter(Boolean)) {
              const m = line.match(/^(\S+)\s+\(([^)]+)\)\s+at\s+(\S+)/);
              if (m) {
                devices.push({ hostname: m[1] !== '?' ? m[1] : undefined, ip: m[2], mac: m[3] !== '<incomplete>' ? m[3] : undefined });
              }
            }
          }
          const mdnsOut = safeExec('avahi-browse -tpr _http._tcp 2>/dev/null');
          if (mdnsOut) {
            for (const line of mdnsOut.split('\n').filter(l => l.startsWith('='))) {
              const parts = line.split(';');
              if (parts.length >= 8) {
                const existing = devices.find(d => d.ip === parts[7]);
                if (existing) {
                  existing.services = existing.services || [];
                  existing.services.push(parts[3]);
                } else {
                  devices.push({ hostname: parts[6] || undefined, ip: parts[7], services: [parts[3]] });
                }
              }
            }
          }
          mcpResult({ content: [{ type: 'text', text: JSON.stringify({ devices }, null, 2) }] });
          return;
        }

        mcpError(-32602, 'Unknown tool: ' + toolName);
        return;
      }

      if (method === 'resources/list') {
        mcpResult({ resources: MCP_RESOURCES });
        return;
      }

      if (method === 'resources/read') {
        const uri = params && params.uri;
        if (!uri) {
          mcpError(-32602, 'Missing resource URI in params.uri');
          return;
        }
        if (uri === 'bridge://sessions') {
          mcpResult({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ sessions: cachedSessions, timestamp: lastScanTime }, null, 2) }] });
          return;
        }
        if (uri === 'bridge://devices') {
          mcpResult({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(discoverDevices(), null, 2) }] });
          return;
        }
        if (uri === 'bridge://health') {
          mcpResult({ contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ ok: true, version: '1.0.0', sessions: cachedSessions.length }, null, 2) }] });
          return;
        }
        mcpError(-32602, 'Unknown resource URI: ' + uri);
        return;
      }

      mcpError(-32601, 'Method not found: ' + method);
    });
    return;
  }
  // ── DESKTOP AUTOMATION (Phase 1a — see docs/DESKTOP_AUTOMATION_PHASE_1_PLAN.md)
  //
  // Token-gated OS-level controls: launch native apps, type text,
  // press key combos, list running apps. Mac-first via osascript;
  // Windows/Linux TODO.
  //
  // Token is stored at `~/.uc-desktop-token` (mode 0600). Generated on
  // first startup. Clients send it as `X-UC-Desktop-Token` header on
  // every POST/run-apps call. `/desktop/health` is intentionally
  // unauthenticated so UIs can detect bridge presence without pairing.
  // ─────────────────────────────────────────────────────────────────────
  if (url === '/desktop/health') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({
      ok: true,
      platform: process.platform,
      supported: process.platform === 'darwin',
      tools: process.platform === 'darwin'
        ? ['launch', 'focus', 'type', 'keys', 'running_apps', 'browser_tabs', 'window_state', 'clipboard', 'clipboard_write', 'clipboard_clear',
           'file_list', 'file_read', 'file_search', 'file_stat', 'file_write', 'file_rename', 'file_write_text', 'file_copy', 'file_trash', 'file_mkdir', 'shortcuts_list', 'shortcuts_run', 'window_manage', 'mouse_move', 'mouse_click', 'mouse_down', 'mouse_up', 'mouse_drag', 'mouse_scroll',
           'paste_text',
           'menu_click', 'indesign_find_change', 'indesign_batch_find_change', 'indesign_document_status', 'indesign_text_inventory', 'indesign_set_layer_state', 'indesign_update_text_layer', 'indesign_batch_update_text_layers', 'indesign_relink_asset', 'indesign_export_proof', 'indesign_package_document',
           'photoshop_document_status', 'photoshop_layer_inventory', 'photoshop_set_layer_state', 'photoshop_update_text_layer', 'photoshop_place_asset', 'photoshop_export_proof',
           'screenshot', 'wait_for_app', 'open_url', 'open_path', 'stage_attachment', 'stage_attachment_manifest', 'click_at', 'screen_size',
           ...(fs.existsSync(path.join(__dirname, 'bin', 'uc-ax-helper')) ? ['a11y_tree', 'click_element', 'set_element_value'] : [])]
        : [],
      // Surface whether the more-reliable click backend is available
      // so clients can decide whether to attempt `click_at` at all.
      optional: {
        cliclick: desktopToolsHas('cliclick'),
        input_helper: fs.existsSync(path.join(__dirname, 'bin', 'uc-input-helper')),
        ax_helper: fs.existsSync(path.join(__dirname, 'bin', 'uc-ax-helper')),
      },
    }));
    return;
  }

  if (url.startsWith('/desktop/')) {
    if (process.platform !== 'darwin') {
      res.writeHead(501, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Desktop automation currently supported on macOS only.' }));
      return;
    }

    const token = getOrCreateDesktopToken();
    const sentToken = req.headers['x-uc-desktop-token'];

    // `/desktop/pair` is the one-time exchange — returns the token
    // value so the UC web app can cache it in encrypted localStorage.
    // Still local-only (bridge binds to localhost by default) so only
    // a same-machine request reaches this handler.
    if (url === '/desktop/pair' && req.method === 'POST') {
      res.writeHead(200, CORS);
      res.end(JSON.stringify({ ok: true, token, tokenFile: '~/.uc-desktop-token' }));
      return;
    }

    if (!sentToken || sentToken !== token) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid desktop token. Pair first via POST /desktop/pair.' }));
      return;
    }

    if (url === '/desktop/running-apps' && req.method === 'GET') {
      const script = 'tell application "System Events" to get name of every application process whose background only is false';
      exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000 }, (err, stdout) => {
        if (err) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        const apps = String(stdout || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, apps }));
      });
      return;
    }

    if (url === '/desktop/browser_tabs' && req.method === 'GET') {
      const parsed = new URL(req.url, 'http://localhost');
      const requested = String(parsed.searchParams.get('browsers') || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      readBrowserTabs(requested, (result) => {
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, ...result }));
      });
      return;
    }

    if (url === '/desktop/window_state' && req.method === 'GET') {
      readWindowState((err, state) => {
        if (err) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
          return;
        }
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, ...state }));
      });
      return;
    }

    if (url === '/desktop/clipboard' && req.method === 'GET') {
      execFile('pbpaste', [], { timeout: 3000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
        if (err) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        const text = String(stdout || '');
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, text, chars: text.length, truncated: false }));
      });
      return;
    }

    if (url === '/desktop/clipboard_write' && req.method === 'POST') {
      readJsonBody(req, 8192, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const text = String(parsed?.text ?? '');
        if (text.length > 4000) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'text too long (max 4000 chars per call)' })); return; }
        exec(`printf %s ${shellSingleQuote(text)} | pbcopy`, { timeout: 3000 }, (err) => {
          if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, chars: text.length }));
        });
      });
      return;
    }

    if (url === '/desktop/clipboard_clear' && req.method === 'POST') {
      exec(`printf '' | pbcopy`, { timeout: 3000 }, (err) => {
        if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (url === '/desktop/paste_text' && req.method === 'POST') {
      readJsonBody(req, 40 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const text = String(parsed?.text ?? '');
        const appName = String(parsed?.appName || '').trim();
        const restoreClipboard = parsed?.restoreClipboard !== false;
        const focusMode = String(parsed?.focusMode || 'require').trim();
        if (text.length === 0) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'text is required' }));
          return;
        }
        if (text.length > 20_000) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'text too long (max 20000 chars per paste)' }));
          return;
        }
        if (appName && !/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (!['require', 'best_effort', 'skip'].includes(focusMode)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid focusMode.' }));
          return;
        }

        const focusTarget = (done) => {
          if (!appName) { done(null, null, null); return; }
          const resolved = resolveInstalledMacApp(appName);
          const targetAppName = resolved?.name || appName;
          if (focusMode === 'skip') {
            done(null, targetAppName, null);
            return;
          }
          const errors = [];
          const finishFocus = (err) => {
            if (!err) {
              done(null, targetAppName, null);
              return;
            }
            const warning = errors.concat(err?.message ? [err.message] : []).filter(Boolean).join(' | ').slice(0, 500) || 'focus failed before paste';
            if (focusMode === 'best_effort') {
              done(null, targetAppName, warning);
              return;
            }
            done(new Error(warning), targetAppName, null);
          };
          const trySystemEventsFocus = () => {
            const script = `
tell application "System Events"
  set targetProc to first application process whose name contains "${escapeAppleScriptString(targetAppName)}"
  set frontmost of targetProc to true
end tell`;
            exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000 }, (err, _stdout, stderr) => {
              if (!err) { finishFocus(null); return; }
              errors.push(String(stderr || err.message || 'System Events focus failed').trim());
              if (resolved?.appPath) {
                execFile('open', [resolved.appPath], { timeout: 5000 }, (openErr, _openStdout, openStderr) => {
                  if (!openErr) { finishFocus(null); return; }
                  errors.push(String(openStderr || openErr.message || 'open app path focus failed').trim());
                  finishFocus(openErr);
                });
                return;
              }
              exec(`open -a ${shellSingleQuote(targetAppName)}`, { timeout: 5000 }, (openErr, _openStdout, openStderr) => {
                if (!openErr) { finishFocus(null); return; }
                errors.push(String(openStderr || openErr.message || 'open -a focus failed').trim());
                finishFocus(openErr);
              });
            });
          };
          const script = `tell application "${escapeAppleScriptString(targetAppName)}" to activate`;
          exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000 }, (err, _stdout, stderr) => {
            if (!err) { finishFocus(null); return; }
            errors.push(String(stderr || err.message || 'activate failed').trim());
            trySystemEventsFocus();
          });
        };

        const finish = (status, payload) => {
          res.writeHead(status, CORS);
          res.end(JSON.stringify(payload));
        };

        execFile('pbpaste', [], { timeout: 3000, maxBuffer: 1024 * 1024 }, (_readErr, oldClipboard) => {
          focusTarget((focusErr, targetAppName, focusWarning) => {
            if (focusErr) {
              finish(400, { ok: false, error: focusErr.message || 'focus failed before paste' });
              return;
            }
            exec(`printf %s ${shellSingleQuote(text)} | pbcopy`, { timeout: 3000 }, (copyErr) => {
              if (copyErr) {
                finish(400, { ok: false, error: copyErr.message || 'clipboard write failed before paste' });
                return;
              }
              const script = 'tell application "System Events" to keystroke "v" using command down';
              exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000 }, (pasteErr) => {
                if (pasteErr) {
                  finish(400, { ok: false, error: pasteErr.message || 'paste keystroke failed' });
                  return;
                }
                if (!restoreClipboard) {
                  finish(200, { ok: true, chars: text.length, appName: targetAppName || null, restoredClipboard: false, focusWarning: focusWarning || undefined });
                  return;
                }
                setTimeout(() => {
                  exec(`printf %s ${shellSingleQuote(String(oldClipboard || ''))} | pbcopy`, { timeout: 3000 }, (restoreErr) => {
                    finish(200, {
                      ok: true,
                      chars: text.length,
                      appName: targetAppName || null,
                      restoredClipboard: !restoreErr,
                      focusWarning: focusWarning || undefined,
                      restoreError: restoreErr ? String(restoreErr.message || restoreErr).slice(0, 200) : undefined,
                    });
                  });
                }, 350);
              });
            });
          });
        });
      });
      return;
    }

    if (url === '/desktop/file_grant' && req.method === 'POST') {
      readJsonBody(req, 4096, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const result = createLocalFileAccessGrant(parsed || {});
        if (!result.ok) { res.writeHead(400, CORS); res.end(JSON.stringify(result)); return; }
        res.writeHead(200, CORS);
        res.end(JSON.stringify(result));
      });
      return;
    }

    if (url === '/desktop/file_grant/status' && req.method === 'GET') {
      const parsed = new URL(req.url, 'http://localhost');
      const grant = getLocalFileAccessGrant(req, parsed);
      res.writeHead(200, CORS);
      res.end(JSON.stringify({
        ok: true,
        granted: !!grant,
        roots: grant ? grant.roots : [],
        scope: grant ? grant.scope : null,
        expiresAt: grant ? new Date(grant.expiresAt).toISOString() : null,
      }));
      return;
    }

    if (url === '/desktop/file_list' && req.method === 'GET') {
      const parsed = new URL(req.url, 'http://localhost');
      const validated = validateDesktopPathServer(parsed.searchParams.get('path') || '');
      if (!validated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: validated.error })); return; }
      try {
        const dir = expandDesktopPath(validated.path);
        const grant = requireLocalFileAccessGrant(req, parsed, dir);
        if (!grant.ok) { res.writeHead(grant.status, CORS); res.end(JSON.stringify({ ok: false, error: grant.error })); return; }
        const entries = fs.readdirSync(dir, { withFileTypes: true }).slice(0, 250).map((entry) => {
          const full = path.join(dir, entry.name);
          let size = null;
          let modifiedAt = null;
          try {
            const stat = fs.statSync(full);
            size = stat.size;
            modifiedAt = stat.mtime.toISOString();
          } catch {}
          return { name: entry.name, path: full, kind: entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other', size, modifiedAt };
        });
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, path: dir, entries, truncated: entries.length >= 250 }));
      } catch (err) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
      return;
    }

    if (url === '/desktop/file_read' && req.method === 'GET') {
      const parsed = new URL(req.url, 'http://localhost');
      const validated = validateDesktopPathServer(parsed.searchParams.get('path') || '');
      if (!validated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: validated.error })); return; }
      try {
        const filePath = expandDesktopPath(validated.path);
        const grant = requireLocalFileAccessGrant(req, parsed, filePath);
        if (!grant.ok) { res.writeHead(grant.status, CORS); res.end(JSON.stringify({ ok: false, error: grant.error })); return; }
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) throw new Error('path is not a file');
        const maxBytes = Math.max(1024, Math.min(256 * 1024, Number(parsed.searchParams.get('maxBytes') || 128 * 1024)));
        const fd = fs.openSync(filePath, 'r');
        const length = Math.min(stat.size, maxBytes);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, 0);
        fs.closeSync(fd);
        const content = buffer.toString('utf8');
        if (content.includes('\u0000')) throw new Error('binary file preview refused');
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, path: filePath, content, size: stat.size, truncated: stat.size > maxBytes }));
      } catch (err) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
      return;
    }

    if (url === '/desktop/file_search' && req.method === 'GET') {
      const parsed = new URL(req.url, 'http://localhost');
      const rootValidated = validateDesktopPathServer(parsed.searchParams.get('rootPath') || '');
      const query = String(parsed.searchParams.get('query') || '').trim();
      if (!rootValidated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: rootValidated.error })); return; }
      if (!query || query.length > 120) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'query is required and must be <= 120 chars' })); return; }
      try {
        const rootPath = expandDesktopPath(rootValidated.path);
        const grant = requireLocalFileAccessGrant(req, parsed, rootPath);
        if (!grant.ok) { res.writeHead(grant.status, CORS); res.end(JSON.stringify({ ok: false, error: grant.error })); return; }
        const result = searchFiles(rootPath, query, {
          maxResults: parsed.searchParams.get('maxResults'),
          maxVisited: parsed.searchParams.get('maxFiles') || parsed.searchParams.get('maxVisited'),
          maxDepth: parsed.searchParams.get('maxDepth'),
          includeContent: parsed.searchParams.get('includeContent'),
          extensions: parsed.searchParams.get('extensions'),
        });
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, rootPath, query, ...result }));
      } catch (err) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
      return;
    }

    if (url === '/desktop/file_stat' && req.method === 'GET') {
      const parsed = new URL(req.url, 'http://localhost');
      const validated = validateDesktopPathServer(parsed.searchParams.get('path') || '');
      if (!validated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: validated.error })); return; }
      try {
        const targetPath = expandDesktopPath(validated.path);
        const grant = requireLocalFileAccessGrant(req, parsed, targetPath);
        if (!grant.ok) { res.writeHead(grant.status, CORS); res.end(JSON.stringify({ ok: false, error: grant.error })); return; }
        let stat = null;
        try {
          stat = fs.lstatSync(targetPath);
        } catch (err) {
          if (err && err.code === 'ENOENT') {
            res.writeHead(200, CORS);
            res.end(JSON.stringify({ ok: true, path: targetPath, exists: false }));
            return;
          }
          throw err;
        }
        const kind = stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : stat.isSymbolicLink() ? 'symlink' : 'other';
        res.writeHead(200, CORS);
        res.end(JSON.stringify({
          ok: true,
          path: targetPath,
          exists: true,
          kind,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString(),
          createdAt: stat.birthtime.toISOString(),
          mode: stat.mode,
        }));
      } catch (err) {
        res.writeHead(400, CORS);
        res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
      }
      return;
    }

    if (url === '/desktop/file_rename' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 4096, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const fromValidated = validateDesktopPathServer(parsed?.fromPath || '');
        const toValidated = validateDesktopPathServer(parsed?.toPath || '');
        if (!fromValidated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: `fromPath: ${fromValidated.error}` })); return; }
        if (!toValidated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: `toPath: ${toValidated.error}` })); return; }
        try {
          const fromPath = expandDesktopPath(fromValidated.path);
          const toPath = expandDesktopPath(toValidated.path);
          const fromGrant = requireLocalFileAccessGrant(req, parsedUrl, fromPath, 'write');
          if (!fromGrant.ok) { res.writeHead(fromGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: fromGrant.error })); return; }
          const toGrant = requireLocalFileAccessGrant(req, parsedUrl, toPath, 'write');
          if (!toGrant.ok) { res.writeHead(toGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: toGrant.error })); return; }

          const sourceStat = fs.lstatSync(fromPath);
          const kind = sourceStat.isDirectory() ? 'directory' : sourceStat.isFile() ? 'file' : 'other';
          const destParent = path.dirname(toPath);
          const destParentGrant = requireLocalFileAccessGrant(req, parsedUrl, destParent, 'write');
          if (!destParentGrant.ok) { res.writeHead(destParentGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: destParentGrant.error })); return; }
          const parentStat = fs.statSync(destParent);
          if (!parentStat.isDirectory()) throw new Error('destination parent is not a directory');
          const overwrite = parseBooleanOption(parsed?.overwrite, false);
          if (fs.existsSync(toPath) && !overwrite) {
            res.writeHead(409, CORS);
            res.end(JSON.stringify({ ok: false, error: 'destination already exists; set overwrite=true to replace it' }));
            return;
          }
          fs.renameSync(fromPath, toPath);
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, fromPath, toPath, kind }));
        } catch (err) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
        }
      });
      return;
    }

    if (url === '/desktop/file_write_text' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 560 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const pathValidated = validateDesktopPathServer(parsed?.path || '');
        if (!pathValidated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: pathValidated.error })); return; }
        const content = parsed?.content;
        if (typeof content !== 'string') { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'content must be a string' })); return; }
        const byteLength = Buffer.byteLength(content, 'utf8');
        if (byteLength > 512 * 1024) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'content exceeds 512 KB per write' })); return; }
        try {
          const filePath = expandDesktopPath(pathValidated.path);
          const writeGrant = requireLocalFileAccessGrant(req, parsedUrl, filePath, 'write');
          if (!writeGrant.ok) { res.writeHead(writeGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: writeGrant.error })); return; }
          const parentDir = path.dirname(filePath);
          const parentGrant = requireLocalFileAccessGrant(req, parsedUrl, parentDir, 'write');
          if (!parentGrant.ok) { res.writeHead(parentGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: parentGrant.error })); return; }
          const parentStat = fs.statSync(parentDir);
          if (!parentStat.isDirectory()) throw new Error('destination parent is not a directory');
          const append = parseBooleanOption(parsed?.append, false);
          const overwrite = parseBooleanOption(parsed?.overwrite, false);
          if (fs.existsSync(filePath)) {
            const existingStat = fs.lstatSync(filePath);
            if (!existingStat.isFile()) throw new Error('destination exists and is not a file');
            if (!append && !overwrite) {
              res.writeHead(409, CORS);
              res.end(JSON.stringify({ ok: false, error: 'file already exists; set overwrite=true or append=true' }));
              return;
            }
          }
          if (append) {
            fs.appendFileSync(filePath, content, 'utf8');
          } else {
            fs.writeFileSync(filePath, content, { encoding: 'utf8', flag: overwrite ? 'w' : 'wx' });
          }
          const stat = fs.statSync(filePath);
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, path: filePath, kind: 'file', bytes: byteLength, size: stat.size, append, overwrite }));
        } catch (err) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
        }
      });
      return;
    }

    if (url === '/desktop/file_mkdir' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 4096, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const pathValidated = validateDesktopPathServer(parsed?.path || '');
        if (!pathValidated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: pathValidated.error })); return; }
        try {
          const dirPath = expandDesktopPath(pathValidated.path);
          const writeGrant = requireLocalFileAccessGrant(req, parsedUrl, dirPath, 'write');
          if (!writeGrant.ok) { res.writeHead(writeGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: writeGrant.error })); return; }
          const parentDir = path.dirname(dirPath);
          const parentGrant = requireLocalFileAccessGrant(req, parsedUrl, parentDir, 'write');
          if (!parentGrant.ok) { res.writeHead(parentGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: parentGrant.error })); return; }
          const recursive = parseBooleanOption(parsed?.recursive, true);
          if (fs.existsSync(dirPath)) {
            const stat = fs.statSync(dirPath);
            if (!stat.isDirectory()) throw new Error('path already exists and is not a directory');
            res.writeHead(200, CORS);
            res.end(JSON.stringify({ ok: true, path: dirPath, kind: 'directory', existed: true }));
            return;
          }
          if (!recursive && !fs.existsSync(parentDir)) throw new Error('parent directory does not exist');
          fs.mkdirSync(dirPath, { recursive });
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, path: dirPath, kind: 'directory', existed: false }));
        } catch (err) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
        }
      });
      return;
    }

    if (url === '/desktop/file_copy' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 4096, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const fromValidated = validateDesktopPathServer(parsed?.fromPath || '');
        const toValidated = validateDesktopPathServer(parsed?.toPath || '');
        if (!fromValidated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: `fromPath: ${fromValidated.error}` })); return; }
        if (!toValidated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: `toPath: ${toValidated.error}` })); return; }
        try {
          const fromPath = expandDesktopPath(fromValidated.path);
          const toPath = expandDesktopPath(toValidated.path);
          const fromGrant = requireLocalFileAccessGrant(req, parsedUrl, fromPath, 'write');
          if (!fromGrant.ok) { res.writeHead(fromGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: fromGrant.error })); return; }
          const toGrant = requireLocalFileAccessGrant(req, parsedUrl, toPath, 'write');
          if (!toGrant.ok) { res.writeHead(toGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: toGrant.error })); return; }
          const sourceStat = fs.lstatSync(fromPath);
          const kind = sourceStat.isDirectory() ? 'directory' : sourceStat.isFile() ? 'file' : 'other';
          if (kind === 'other') throw new Error('source is not a regular file or directory');
          const destParent = path.dirname(toPath);
          const parentGrant = requireLocalFileAccessGrant(req, parsedUrl, destParent, 'write');
          if (!parentGrant.ok) { res.writeHead(parentGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: parentGrant.error })); return; }
          const parentStat = fs.statSync(destParent);
          if (!parentStat.isDirectory()) throw new Error('destination parent is not a directory');
          const overwrite = parseBooleanOption(parsed?.overwrite, false);
          if (fs.existsSync(toPath) && !overwrite) {
            res.writeHead(409, CORS);
            res.end(JSON.stringify({ ok: false, error: 'destination already exists; set overwrite=true to replace it' }));
            return;
          }
          if (sourceStat.isDirectory()) {
            fs.cpSync(fromPath, toPath, { recursive: true, force: overwrite, errorOnExist: !overwrite });
          } else {
            fs.copyFileSync(fromPath, toPath, overwrite ? 0 : fs.constants.COPYFILE_EXCL);
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, fromPath, toPath, kind }));
        } catch (err) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
        }
      });
      return;
    }

    if (url === '/desktop/file_trash' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 4096, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const pathValidated = validateDesktopPathServer(parsed?.path || '');
        if (!pathValidated.ok) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: pathValidated.error })); return; }
        try {
          const filePath = expandDesktopPath(pathValidated.path);
          const writeGrant = requireLocalFileAccessGrant(req, parsedUrl, filePath, 'write');
          if (!writeGrant.ok) { res.writeHead(writeGrant.status, CORS); res.end(JSON.stringify({ ok: false, error: writeGrant.error })); return; }
          const sourceStat = fs.lstatSync(filePath);
          const kind = sourceStat.isDirectory() ? 'directory' : sourceStat.isFile() ? 'file' : 'other';
          if (kind === 'other') throw new Error('path is not a regular file or directory');
          const trashDir = path.join(os.homedir(), '.Trash');
          const parsedPath = path.parse(filePath);
          let trashPath = path.join(trashDir, path.basename(filePath));
          let suffix = 0;
          while (fs.existsSync(trashPath)) {
            suffix += 1;
            trashPath = path.join(trashDir, `${parsedPath.name}-${Date.now()}-${suffix}${parsedPath.ext}`);
          }
          fs.renameSync(filePath, trashPath);
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, path: filePath, trashPath, kind }));
        } catch (err) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message || String(err) }));
        }
      });
      return;
    }

    if (url === '/desktop/shortcuts/list' && req.method === 'GET') {
      execFile('shortcuts', ['list'], { timeout: 5000, maxBuffer: 512 * 1024 }, (err, stdout) => {
        if (err) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message || 'shortcuts CLI unavailable' }));
          return;
        }
        const shortcuts = String(stdout || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, shortcuts }));
      });
      return;
    }

    if (url === '/desktop/shortcuts/run' && req.method === 'POST') {
      readJsonBody(req, 2048, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const name = String(parsed?.name || '').trim();
        if (!name || name.length > 120 || /[\x00-\x1f]/.test(name)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'shortcut name is required and must be <= 120 chars' }));
          return;
        }
        execFile('shortcuts', ['run', name], { timeout: 60_000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'shortcut failed').toString().slice(0, 500) }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, name, output: String(stdout || '').slice(0, 4000) }));
        });
      });
      return;
    }

    if (url === '/desktop/window_manage' && req.method === 'POST') {
      readJsonBody(req, 2048, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const action = String(parsed?.action || '').trim().toLowerCase();
        const appName = String(parsed?.appName || '').trim();
        const width = Number(parsed?.width || 0);
        const height = Number(parsed?.height || 0);
        const script = buildWindowManageScript({ action, appName, width, height });
        if (!script) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'invalid window action. Use focus, raise, minimize, unminimize, zoom, or resize.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000 }, (err) => {
          if (err) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: err.message })); return; }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, action, appName: appName || null, width: width || null, height: height || null }));
        });
      });
      return;
    }

    if (url === '/desktop/mouse_move' && req.method === 'POST') {
      readJsonBody(req, 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const x = Number(parsed?.x);
        const y = Number(parsed?.y);
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 20000 || y > 20000) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'x and y must be non-negative integers <= 20000' }));
          return;
        }
        const helperPath = path.join(__dirname, 'bin', 'uc-input-helper');
        if (!fs.existsSync(helperPath)) {
          res.writeHead(503, CORS);
          res.end(JSON.stringify({ ok: false, error: 'uc-input-helper not found. Build or install the helper before using mouse move.' }));
          return;
        }
        execFile(helperPath, ['move', '--x', String(x), '--y', String(y)], { timeout: 3000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'move failed').toString().slice(0, 300) }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(stdout.toString().trim() || JSON.stringify({ ok: true, x, y }));
        });
      });
      return;
    }

    if (url === '/desktop/mouse_click' && req.method === 'POST') {
      readJsonBody(req, 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const x = Number(parsed?.x);
        const y = Number(parsed?.y);
        const button = String(parsed?.button || 'left').toLowerCase();
        const count = Math.max(1, Math.min(3, Number(parsed?.count || 1)));
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 20000 || y > 20000) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'x and y must be non-negative integers <= 20000' }));
          return;
        }
        if (button !== 'left' && button !== 'right') {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'button must be left or right' }));
          return;
        }
        const helperPath = path.join(__dirname, 'bin', 'uc-input-helper');
        if (!fs.existsSync(helperPath)) {
          res.writeHead(503, CORS);
          res.end(JSON.stringify({ ok: false, error: 'uc-input-helper not found. Build or install the helper before using mouse click.' }));
          return;
        }
        execFile(helperPath, ['click', '--x', String(x), '--y', String(y), '--button', button, '--count', String(count)], { timeout: 5000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'click failed').toString().slice(0, 300) }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(stdout.toString().trim() || JSON.stringify({ ok: true, x, y, button, count }));
        });
      });
      return;
    }

    if ((url === '/desktop/mouse_down' || url === '/desktop/mouse_up') && req.method === 'POST') {
      readJsonBody(req, 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const isDown = url === '/desktop/mouse_down';
        const xRaw = parsed?.x;
        const yRaw = parsed?.y;
        const x = Number(xRaw);
        const y = Number(yRaw);
        const button = String(parsed?.button || 'left').toLowerCase();
        if (button !== 'left' && button !== 'right') {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'button must be left or right' }));
          return;
        }
        if (isDown || xRaw !== undefined || yRaw !== undefined) {
          if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > 20000 || y > 20000) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: 'x and y must be non-negative integers <= 20000' }));
            return;
          }
        }
        const helperPath = path.join(__dirname, 'bin', 'uc-input-helper');
        if (!fs.existsSync(helperPath)) {
          res.writeHead(503, CORS);
          res.end(JSON.stringify({ ok: false, error: `uc-input-helper not found. Build or install the helper before using mouse ${isDown ? 'down' : 'up'}.` }));
          return;
        }
        const helperArgs = [isDown ? 'down' : 'up', '--button', button];
        if (isDown || (xRaw !== undefined && yRaw !== undefined)) {
          helperArgs.push('--x', String(x), '--y', String(y));
        }
        execFile(helperPath, helperArgs, { timeout: 3000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || `mouse ${isDown ? 'down' : 'up'} failed`).toString().slice(0, 300) }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(stdout.toString().trim() || JSON.stringify({ ok: true, x: Number.isInteger(x) ? x : null, y: Number.isInteger(y) ? y : null, button }));
        });
      });
      return;
    }

    if (url === '/desktop/mouse_drag' && req.method === 'POST') {
      readJsonBody(req, 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const fromX = Number(parsed?.fromX);
        const fromY = Number(parsed?.fromY);
        const toX = Number(parsed?.toX);
        const toY = Number(parsed?.toY);
        const durationMs = Math.max(50, Math.min(5000, Number(parsed?.durationMs || 450)));
        if (![fromX, fromY, toX, toY].every((value) => Number.isInteger(value) && value >= 0 && value <= 20000)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'fromX/fromY/toX/toY must be non-negative integers <= 20000' }));
          return;
        }
        const helperPath = path.join(__dirname, 'bin', 'uc-input-helper');
        if (!fs.existsSync(helperPath)) {
          res.writeHead(503, CORS);
          res.end(JSON.stringify({ ok: false, error: 'uc-input-helper not found. Build or install the helper before using mouse drag.' }));
          return;
        }
        execFile(helperPath, ['drag', '--from-x', String(fromX), '--from-y', String(fromY), '--to-x', String(toX), '--to-y', String(toY), '--duration-ms', String(durationMs)], { timeout: 8000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'drag failed').toString().slice(0, 300) }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(stdout.toString().trim() || JSON.stringify({ ok: true, fromX, fromY, toX, toY, durationMs }));
        });
      });
      return;
    }

    if (url === '/desktop/mouse_scroll' && req.method === 'POST') {
      readJsonBody(req, 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const deltaY = Math.max(-5000, Math.min(5000, Number(parsed?.deltaY ?? -600)));
        const deltaX = Math.max(-5000, Math.min(5000, Number(parsed?.deltaX ?? 0)));
        const x = Math.max(0, Math.min(20000, Number(parsed?.x ?? 0)));
        const y = Math.max(0, Math.min(20000, Number(parsed?.y ?? 0)));
        const helperPath = path.join(__dirname, 'bin', 'uc-input-helper');
        if (!fs.existsSync(helperPath)) {
          res.writeHead(503, CORS);
          res.end(JSON.stringify({ ok: false, error: 'uc-input-helper not found. Build or install the helper before using mouse scroll.' }));
          return;
        }
        execFile(helperPath, ['scroll', '--x', String(x), '--y', String(y), '--delta-x', String(deltaX), '--delta-y', String(deltaY)], { timeout: 3000 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'scroll failed').toString().slice(0, 300) }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, x, y, deltaX, deltaY, output: String(stdout || '').slice(0, 500) }));
        });
      });
      return;
    }

    if (url === '/desktop/launch' && req.method === 'POST') {
      readJsonBody(req, 2048, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || '').trim();
        if (!appName || !/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName. Letters, numbers, spaces, . - _ ( ) only.' }));
          return;
        }
        const resolved = resolveInstalledMacApp(appName);
        const launchDone = (err) => {
          if (err) {
            const msg = /not found/i.test(err.message) ? 'app_not_found' : err.message;
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: msg }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: resolved?.name || appName,
            requestedAppName: appName,
            appPath: resolved?.appPath,
          }));
        };
        if (resolved?.appPath) {
          execFile('open', [resolved.appPath], { timeout: 5000 }, launchDone);
        } else {
          exec(`open -a ${shellSingleQuote(appName)}`, { timeout: 5000 }, launchDone);
        }
      });
      return;
    }

    if (url === '/desktop/focus' && req.method === 'POST') {
      readJsonBody(req, 2048, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || '').trim();
        if (!appName || !/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        const resolved = resolveInstalledMacApp(appName);
        const targetAppName = resolved?.name || appName;
        const escapedAppName = targetAppName.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const script = `tell application "${escapedAppName}" to activate`;
        exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000 }, (err) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: targetAppName,
            requestedAppName: appName,
            appPath: resolved?.appPath,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/type' && req.method === 'POST') {
      readJsonBody(req, 8192, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const text = String(parsed?.text ?? '');
        if (text.length === 0) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'text is required' })); return; }
        if (text.length > 4000) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'text too long (max 4000 chars per call)' })); return; }
        // AppleScript string escape — backslash first, then quote.
        const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const script = `tell application "System Events" to keystroke "${escaped}"`;
        exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 10000 }, (err) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, chars: text.length }));
        });
      });
      return;
    }

    if (url === '/desktop/keys' && req.method === 'POST') {
      readJsonBody(req, 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const combo = String(parsed?.combo || '').trim();
        const stanza = keyComboToAppleScript(combo);
        if (!stanza) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid key combo. Examples: "Cmd+T", "Cmd+Shift+N", "Return", "Escape".' }));
          return;
        }
        const script = `tell application "System Events" to ${stanza}`;
        exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000 }, (err) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, combo }));
        });
      });
      return;
    }

    if (url === '/desktop/menu_click' && req.method === 'POST') {
      readJsonBody(req, 2048, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || '').trim();
        const rawPath = Array.isArray(parsed?.menuPath)
          ? parsed.menuPath
          : String(parsed?.menuPath || '').split(/\s*(?:>|→|›)\s*/g);
        const menuPath = rawPath.map((part) => String(part || '').trim()).filter(Boolean);
        if (appName && !/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (menuPath.length < 2 || menuPath.length > 6 || menuPath.some((part) => part.length > 80 || /[\x00-\x1f]/.test(part))) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'menuPath must contain 2-6 labels, each <= 80 chars.' }));
          return;
        }
        const built = buildMenuClickScript({ appName, menuPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not build menu click script.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 7000 }, (err) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, appName: built.appName || null, menuPath: built.menuPath }));
        });
      });
      return;
    }

    if (url === '/desktop/indesign_document_status' && req.method === 'POST') {
      readJsonBody(req, 8 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildInDesignDocumentStatusScript({ appName, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 10000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign document status failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          const documents = Array.isArray(result?.documents)
            ? result.documents.slice(0, 12).map((doc) => ({
                name: doc?.name ? String(doc.name).slice(0, 260) : '',
                path: doc?.path ? String(doc.path).slice(0, 1024) : null,
                modified: doc?.modified === true,
                saved: doc?.saved === true,
                pageCount: Number.isFinite(Number(doc?.pageCount)) ? Number(doc.pageCount) : 0,
              })).filter((doc) => doc.name)
            : [];
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            appRunning: result?.appRunning === true,
            status: result?.status ? String(result.status).slice(0, 80) : 'unknown',
            documentCount: Number.isFinite(Number(result?.documentCount)) ? Number(result.documentCount) : 0,
            activeDocumentName: result?.activeDocumentName ? String(result.activeDocumentName).slice(0, 260) : null,
            activeDocumentPath: result?.activeDocumentPath ? String(result.activeDocumentPath).slice(0, 1024) : null,
            activeDocumentModified: result?.activeDocumentModified === true,
            activeDocumentSaved: result?.activeDocumentSaved === true,
            pageCount: Number.isFinite(Number(result?.pageCount)) ? Number(result.pageCount) : 0,
            spreadCount: Number.isFinite(Number(result?.spreadCount)) ? Number(result.spreadCount) : 0,
            layerCount: Number.isFinite(Number(result?.layerCount)) ? Number(result.layerCount) : 0,
            lockedLayers: Number.isFinite(Number(result?.lockedLayers)) ? Number(result.lockedLayers) : 0,
            hiddenLayers: Number.isFinite(Number(result?.hiddenLayers)) ? Number(result.hiddenLayers) : 0,
            linkCount: Number.isFinite(Number(result?.linkCount)) ? Number(result.linkCount) : 0,
            missingLinks: Number.isFinite(Number(result?.missingLinks)) ? Number(result.missingLinks) : 0,
            modifiedLinks: Number.isFinite(Number(result?.modifiedLinks)) ? Number(result.modifiedLinks) : 0,
            problemLinks: Number.isFinite(Number(result?.problemLinks)) ? Number(result.problemLinks) : 0,
            fontCount: Number.isFinite(Number(result?.fontCount)) ? Number(result.fontCount) : 0,
            missingFonts: Number.isFinite(Number(result?.missingFonts)) ? Number(result.missingFonts) : 0,
            selectionCount: Number.isFinite(Number(result?.selectionCount)) ? Number(result.selectionCount) : 0,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            documents,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/indesign_text_inventory' && req.method === 'POST') {
      readJsonBody(req, 12 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
        const query = String(parsed?.query || '').trim();
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        const maxItems = Math.max(1, Math.min(80, Math.trunc(Number(parsed?.maxItems || 30))));
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (query.length > 160 || /[\x00-\x1F]/.test(query)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'query must be <= 160 chars and cannot contain control chars.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildInDesignTextInventoryScript({ appName, query, expectedDocumentName, sourceDocumentPath, maxItems });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 12000, maxBuffer: 768 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign text inventory failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          const frames = Array.isArray(result?.frames)
            ? result.frames.slice(0, maxItems).map((frame) => ({
                layerName: frame?.layerName ? String(frame.layerName).slice(0, 160) : '',
                itemName: frame?.itemName ? String(frame.itemName).slice(0, 160) : '',
                label: frame?.label ? String(frame.label).slice(0, 160) : '',
                pageName: frame?.pageName ? String(frame.pageName).slice(0, 80) : '',
                contentPreview: frame?.contentPreview ? String(frame.contentPreview).slice(0, 240) : '',
                chars: Number.isFinite(Number(frame?.chars)) ? Number(frame.chars) : 0,
                matchCount: Number.isFinite(Number(frame?.matchCount)) ? Number(frame.matchCount) : 0,
                overflows: frame?.overflows === true,
                locked: frame?.locked === true,
                visible: frame?.visible !== false,
              }))
            : [];
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            appRunning: result?.appRunning === true,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            query,
            textFrameCount: Number.isFinite(Number(result?.textFrameCount)) ? Number(result.textFrameCount) : 0,
            matchedFrames: Number.isFinite(Number(result?.matchedFrames)) ? Number(result.matchedFrames) : 0,
            oversetFrames: Number.isFinite(Number(result?.oversetFrames)) ? Number(result.oversetFrames) : 0,
            lockedLayers: Number.isFinite(Number(result?.lockedLayers)) ? Number(result.lockedLayers) : 0,
            hiddenLayers: Number.isFinite(Number(result?.hiddenLayers)) ? Number(result.hiddenLayers) : 0,
            queryMatches: Number.isFinite(Number(result?.queryMatches)) ? Number(result.queryMatches) : 0,
            layerNames: Array.isArray(result?.layerNames) ? result.layerNames.slice(0, 80).map((name) => String(name || '').slice(0, 160)).filter(Boolean) : [],
            frames,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/indesign_set_layer_state' && req.method === 'POST') {
      readJsonBody(req, 12 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
        const layerName = String(parsed?.layerName || parsed?.targetLayerName || '').trim();
        const action = String(parsed?.action || '').trim().toLowerCase();
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (!layerName || layerName.length > 160 || /[\x00-\x1f]/.test(layerName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'layerName must be 1-160 chars and cannot contain control characters.' }));
          return;
        }
        if (!['show', 'hide', 'lock', 'unlock'].includes(action)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'action must be show, hide, lock, or unlock.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildInDesignSetLayerStateScript({ appName, layerName, action, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 15000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign layer-state update failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          const matches = Array.isArray(result?.matches)
            ? result.matches.slice(0, 12).map((item) => ({
                name: item?.name ? String(item.name).slice(0, 160) : '',
                visible: item?.visible !== false,
                locked: item?.locked === true,
                printable: item?.printable === true,
              })).filter((item) => item.name)
            : [];
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            layerName,
            action,
            matchedLayers: Number.isFinite(Number(result?.matchedLayers)) ? Number(result.matchedLayers) : 0,
            changedLayers: Number.isFinite(Number(result?.changedLayers)) ? Number(result.changedLayers) : 0,
            beforeVisible: result?.beforeVisible === true,
            afterVisible: result?.afterVisible === true,
            beforeLocked: result?.beforeLocked === true,
            afterLocked: result?.afterLocked === true,
            beforePrintable: result?.beforePrintable === true,
            afterPrintable: result?.afterPrintable === true,
            docWasModified: result?.docWasModified === true,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            matches,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

	    if (url === '/desktop/indesign_update_text_layer' && req.method === 'POST') {
	      readJsonBody(req, 16 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
        const fieldName = String(parsed?.fieldName || '').trim();
        const replacementText = String(parsed?.replacementText ?? '');
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (!fieldName || fieldName.length > 160 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(fieldName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'fieldName must be 1-160 chars and cannot contain control chars.' }));
          return;
        }
        if (replacementText.length > 5000 || /[\x00]/.test(replacementText)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'replacementText must be <= 5000 chars and cannot contain NUL.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildInDesignUpdateTextLayerScript({ appName, fieldName, replacementText, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 20000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign text layer update failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          const layerNames = Array.isArray(result?.layerNames)
            ? result.layerNames.slice(0, 20).map((name) => String(name || '').slice(0, 160)).filter(Boolean)
            : [];
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            fieldName,
            replacementText,
            matchedLayers: Number.isFinite(Number(result?.matchedLayers)) ? Number(result.matchedLayers) : 0,
            matchedFrames: Number.isFinite(Number(result?.matchedFrames)) ? Number(result.matchedFrames) : 0,
            updatedFrames: Number.isFinite(Number(result?.updatedFrames)) ? Number(result.updatedFrames) : 0,
            replacementMatches: Number.isFinite(Number(result?.replacementMatches)) ? Number(result.replacementMatches) : 0,
            layerNames,
            unlockedCount: Number.isFinite(Number(result?.unlockedCount)) ? Number(result.unlockedCount) : 0,
            docWasModified: result?.docWasModified === true,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
	      });
	      return;
	    }

	    if (url === '/desktop/indesign_batch_update_text_layers' && req.method === 'POST') {
	      readJsonBody(req, 96 * 1024, (parsed, bodyErr) => {
	        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
	        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
	        const rawUpdates = Array.isArray(parsed?.updates) ? parsed.updates : Array.isArray(parsed?.fieldUpdates) ? parsed.fieldUpdates : [];
	        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
	        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
	        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
	          res.writeHead(400, CORS);
	          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
	          return;
	        }
	        const updates = rawUpdates.slice(0, 12).map((update) => ({
	          fieldName: String(update?.fieldName ?? update?.field ?? update?.targetLabel ?? '').trim(),
	          replacementText: String(update?.replacementText ?? update?.text ?? update?.value ?? ''),
	        })).filter((update) => update.fieldName);
	        if (
	          updates.length < 1 ||
	          rawUpdates.length > 12 ||
	          updates.some((update) => !update.fieldName || update.fieldName.length > 160 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(update.fieldName) || update.replacementText.length > 5000 || /[\x00]/.test(update.replacementText))
	        ) {
	          res.writeHead(400, CORS);
	          res.end(JSON.stringify({ ok: false, error: 'updates must contain 1-12 valid field/replacement values.' }));
	          return;
	        }
	        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
	          res.writeHead(400, CORS);
	          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
	          return;
	        }
	        let sourceDocumentPath = '';
	        if (rawSourceDocumentPath) {
	          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
	          if (!validatedSource.ok) {
	            res.writeHead(400, CORS);
	            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
	            return;
	          }
	          sourceDocumentPath = expandDesktopPath(validatedSource.path);
	        }
	        const built = buildInDesignBatchUpdateTextLayersScript({ appName, updates, expectedDocumentName, sourceDocumentPath });
	        if (!built) {
	          res.writeHead(400, CORS);
	          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
	          return;
	        }
	        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 45000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
	          if (err) {
	            res.writeHead(400, CORS);
	            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign batch text-layer update failed').toString().slice(0, 1000) }));
	            return;
	          }
	          let result = null;
	          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
	          const itemResults = Array.isArray(result?.results)
	            ? result.results.slice(0, updates.length).map((item, index) => ({
	                fieldName: item?.fieldName ? String(item.fieldName).slice(0, 160) : updates[index]?.fieldName || '',
	                replacementText: item?.replacementText !== undefined ? String(item.replacementText).slice(0, 5000) : updates[index]?.replacementText || '',
	                matchedLayers: Number.isFinite(Number(item?.matchedLayers)) ? Number(item.matchedLayers) : 0,
	                matchedFrames: Number.isFinite(Number(item?.matchedFrames)) ? Number(item.matchedFrames) : 0,
	                updatedFrames: Number.isFinite(Number(item?.updatedFrames)) ? Number(item.updatedFrames) : 0,
	                replacementMatches: Number.isFinite(Number(item?.replacementMatches)) ? Number(item.replacementMatches) : 0,
	                layerNames: Array.isArray(item?.layerNames) ? item.layerNames.slice(0, 20).map((name) => String(name || '').slice(0, 160)).filter(Boolean) : [],
	                unlockedCount: Number.isFinite(Number(item?.unlockedCount)) ? Number(item.unlockedCount) : 0,
	                error: item?.error ? String(item.error).slice(0, 500) : null,
	              }))
	            : updates.map((update) => ({
	                fieldName: update.fieldName,
	                replacementText: update.replacementText,
	                matchedLayers: 0,
	                matchedFrames: 0,
	                updatedFrames: 0,
	                replacementMatches: 0,
	                layerNames: [],
	                unlockedCount: 0,
	                error: 'Bridge returned no per-field result.',
	              }));
	          res.writeHead(200, CORS);
	          res.end(JSON.stringify({
	            ok: true,
	            appName: built.appName,
	            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
	            expectedDocumentName: expectedDocumentName || null,
	            sourceDocumentPath: sourceDocumentPath || null,
	            fieldCount: itemResults.length,
	            matchedLayers: itemResults.reduce((sum, item) => sum + item.matchedLayers, 0),
	            matchedFrames: itemResults.reduce((sum, item) => sum + item.matchedFrames, 0),
	            updatedFrames: itemResults.reduce((sum, item) => sum + item.updatedFrames, 0),
	            replacementMatches: itemResults.reduce((sum, item) => sum + item.replacementMatches, 0),
	            unlockedCount: itemResults.reduce((sum, item) => sum + item.unlockedCount, 0),
	            docWasModified: result?.docWasModified === true,
	            docModified: result?.docModified === true,
	            docSaved: result?.docSaved === true,
	            results: itemResults,
	            error: result?.error ? String(result.error).slice(0, 500) : null,
	          }));
	        });
	      });
	      return;
	    }

	    if (url === '/desktop/indesign_find_change' && req.method === 'POST') {
      readJsonBody(req, 16 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
        const findText = String(parsed?.findText ?? '');
        const changeText = String(parsed?.changeText ?? '');
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (!findText || findText.length > 5000 || changeText.length > 5000 || /[\x00]/.test(findText + changeText)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'findText/changeText must be 1-5000 chars and cannot contain NUL.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildInDesignFindChangeScript({ appName, findText, changeText, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 20000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign Find/Change failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName || null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            findText,
            changeText,
            matched: Number.isFinite(Number(result?.matched)) ? Number(result.matched) : 0,
            changed: Number.isFinite(Number(result?.changed)) ? Number(result.changed) : 0,
	            remaining: Number.isFinite(Number(result?.remaining)) ? Number(result.remaining) : 0,
	            replacementMatches: Number.isFinite(Number(result?.replacementMatches)) ? Number(result.replacementMatches) : 0,
	            method: result?.method ? String(result.method) : 'find-change',
	            unlockedCount: Number.isFinite(Number(result?.unlockedCount)) ? Number(result.unlockedCount) : 0,
	            lockedLayers: Number.isFinite(Number(result?.lockedLayers)) ? Number(result.lockedLayers) : 0,
	            hiddenLayers: Number.isFinite(Number(result?.hiddenLayers)) ? Number(result.hiddenLayers) : 0,
	            lockedPageItems: Number.isFinite(Number(result?.lockedPageItems)) ? Number(result.lockedPageItems) : 0,
	            docWasModified: result?.docWasModified === true,
	            docModified: result?.docModified === true,
	            docSaved: result?.docSaved === true,
	            fallbackReason: result?.fallbackReason ? String(result.fallbackReason).slice(0, 500) : null,
	            error: result?.error ? String(result.error).slice(0, 500) : null,
	          }));
        });
      });
      return;
    }

    if (url === '/desktop/indesign_batch_find_change' && req.method === 'POST') {
      readJsonBody(req, 64 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
        const rawPairs = Array.isArray(parsed?.pairs) ? parsed.pairs : Array.isArray(parsed?.replacements) ? parsed.replacements : [];
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        const pairs = rawPairs.slice(0, 20).map((pair) => ({
          findText: String(pair?.findText ?? pair?.find ?? ''),
          changeText: String(pair?.changeText ?? pair?.replaceWith ?? pair?.replacement ?? ''),
        })).filter((pair) => pair.findText);
        if (pairs.length < 1 || rawPairs.length > 20 || pairs.some((pair) => !pair.findText || pair.findText.length > 5000 || pair.changeText.length > 5000 || /[\x00]/.test(pair.findText + pair.changeText))) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'pairs must contain 1-20 find/change values, each <= 5000 chars and without NUL.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildInDesignBatchFindChangeScript({ appName, pairs, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 45000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign batch Find/Change failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          const itemResults = Array.isArray(result?.results)
            ? result.results.slice(0, pairs.length).map((item, index) => ({
                findText: item?.findText ? String(item.findText) : pairs[index]?.findText || '',
                changeText: item?.changeText !== undefined ? String(item.changeText) : pairs[index]?.changeText || '',
                matched: Number.isFinite(Number(item?.matched)) ? Number(item.matched) : 0,
                changed: Number.isFinite(Number(item?.changed)) ? Number(item.changed) : 0,
                remaining: Number.isFinite(Number(item?.remaining)) ? Number(item.remaining) : 0,
                replacementMatches: Number.isFinite(Number(item?.replacementMatches)) ? Number(item.replacementMatches) : 0,
                method: item?.method ? String(item.method).slice(0, 80) : 'find-change',
                unlockedCount: Number.isFinite(Number(item?.unlockedCount)) ? Number(item.unlockedCount) : 0,
                fallbackReason: item?.fallbackReason ? String(item.fallbackReason).slice(0, 500) : null,
                error: item?.error ? String(item.error).slice(0, 500) : null,
              }))
            : pairs.map((pair) => ({
                findText: pair.findText,
                changeText: pair.changeText,
                matched: 0,
                changed: 0,
                remaining: 0,
                replacementMatches: 0,
                method: 'find-change',
                unlockedCount: 0,
                fallbackReason: null,
                error: 'Bridge returned no per-pair result.',
              }));
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName || null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            pairCount: itemResults.length,
            matched: itemResults.reduce((sum, item) => sum + item.matched, 0),
            changed: itemResults.reduce((sum, item) => sum + item.changed, 0),
            remaining: itemResults.reduce((sum, item) => sum + item.remaining, 0),
            replacementMatches: itemResults.reduce((sum, item) => sum + item.replacementMatches, 0),
            unlockedCount: itemResults.reduce((sum, item) => sum + item.unlockedCount, 0),
            docWasModified: result?.docWasModified === true,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            results: itemResults,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/indesign_export_proof' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 16 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
        const rawOutputPath = String(parsed?.outputPath || '').trim();
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        const format = String(parsed?.format || '').trim().toLowerCase() || 'pdf';
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        if (format !== 'pdf') {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'format must be pdf.' }));
          return;
        }
        const outputValidated = validateDesktopPathServer(rawOutputPath);
        if (!outputValidated.ok) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: `outputPath: ${outputValidated.error}` }));
          return;
        }
        const outputPath = expandDesktopPath(outputValidated.path);
        if (!/\.pdf$/i.test(outputPath)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'outputPath must end in .pdf for InDesign proof export.' }));
          return;
        }
        const outputGrant = requireLocalFileAccessGrant(req, parsedUrl, outputPath, 'write');
        if (!outputGrant.ok) {
          res.writeHead(outputGrant.status, CORS);
          res.end(JSON.stringify({ ok: false, error: outputGrant.error }));
          return;
        }
        const parentGrant = requireLocalFileAccessGrant(req, parsedUrl, path.dirname(outputPath), 'write');
        if (!parentGrant.ok) {
          res.writeHead(parentGrant.status, CORS);
          res.end(JSON.stringify({ ok: false, error: parentGrant.error }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildInDesignExportProofScript({ appName, outputPath, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 45000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign proof export failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          let fileExists = false;
          let sizeBytes = 0;
          try {
            const stat = fs.statSync(outputPath);
            fileExists = stat.isFile();
            sizeBytes = stat.size;
          } catch {}
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            outputPath,
            format: 'pdf',
            pageCount: Number.isFinite(Number(result?.pageCount)) ? Number(result.pageCount) : 0,
            spreadCount: Number.isFinite(Number(result?.spreadCount)) ? Number(result.spreadCount) : 0,
            fileExists,
            sizeBytes,
            docWasModified: result?.docWasModified === true,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/indesign_relink_asset' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 24 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
        const rawAssetPath = String(parsed?.assetPath || '').trim();
        const linkQuery = String(parsed?.linkQuery || '').trim();
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (linkQuery.length > 240 || /[\x00-\x1f]/.test(linkQuery)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'linkQuery must be <= 240 chars and cannot contain control characters.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        const assetValidated = validateDesktopPathServer(rawAssetPath);
        if (!assetValidated.ok) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: `assetPath: ${assetValidated.error}` }));
          return;
        }
        const assetPath = expandDesktopPath(assetValidated.path);
        try {
          const stat = fs.statSync(assetPath);
          if (!stat.isFile()) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: 'assetPath must point to a local file.' }));
            return;
          }
        } catch {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'assetPath does not exist.' }));
          return;
        }
        const assetGrant = requireLocalFileAccessGrant(req, parsedUrl, assetPath, 'read');
        if (!assetGrant.ok) {
          res.writeHead(assetGrant.status, CORS);
          res.end(JSON.stringify({ ok: false, error: assetGrant.error }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildInDesignRelinkAssetScript({ appName, assetPath, linkQuery, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 45000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign asset relink failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            assetPath,
            linkQuery: linkQuery || null,
            matchedLinks: Number.isFinite(Number(result?.matchedLinks)) ? Number(result.matchedLinks) : 0,
            relinkedLinks: Number.isFinite(Number(result?.relinkedLinks)) ? Number(result.relinkedLinks) : 0,
            missingBefore: Number.isFinite(Number(result?.missingBefore)) ? Number(result.missingBefore) : 0,
            missingAfter: Number.isFinite(Number(result?.missingAfter)) ? Number(result.missingAfter) : 0,
            linkNames: Array.isArray(result?.linkNames) ? result.linkNames.map((name) => String(name).slice(0, 260)).slice(0, 20) : [],
            docWasModified: result?.docWasModified === true,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/indesign_package_document' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 24 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'InDesign').trim() || 'InDesign';
        const rawOutputFolderPath = String(parsed?.outputFolderPath || '').trim();
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        const includeIdml = parseBooleanOption(parsed?.includeIdml, false);
        const includePdf = parseBooleanOption(parsed?.includePdf, false);
        const copyFonts = parseBooleanOption(parsed?.copyFonts, true);
        const copyLinkedGraphics = parseBooleanOption(parsed?.copyLinkedGraphics, true);
        const copyProfiles = parseBooleanOption(parsed?.copyProfiles, true);
        const updateGraphics = parseBooleanOption(parsed?.updateGraphics, true);
        const includeHiddenLayers = parseBooleanOption(parsed?.includeHiddenLayers, true);
        const ignorePreflightErrors = parseBooleanOption(parsed?.ignorePreflightErrors, false);
        const createReport = parseBooleanOption(parsed?.createReport, true);
        const forceSave = parseBooleanOption(parsed?.forceSave, true);
        const pdfStyle = String(parsed?.pdfStyle || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        if (pdfStyle.length > 180 || /[\x00-\x1f]/.test(pdfStyle)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'pdfStyle must be <= 180 chars and cannot contain control characters.' }));
          return;
        }
        const outputValidated = validateDesktopPathServer(rawOutputFolderPath);
        if (!outputValidated.ok) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: `outputFolderPath: ${outputValidated.error}` }));
          return;
        }
        const outputFolderPath = expandDesktopPath(outputValidated.path);
        try {
          if (fs.existsSync(outputFolderPath) && !fs.statSync(outputFolderPath).isDirectory()) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: 'outputFolderPath must be a directory path.' }));
            return;
          }
        } catch {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not inspect outputFolderPath.' }));
          return;
        }
        const outputGrant = requireLocalFileAccessGrant(req, parsedUrl, outputFolderPath, 'write');
        if (!outputGrant.ok) {
          res.writeHead(outputGrant.status, CORS);
          res.end(JSON.stringify({ ok: false, error: outputGrant.error }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        try { fs.mkdirSync(outputFolderPath, { recursive: true }); } catch (e) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: `Could not create outputFolderPath: ${(e && e.message) || e}` }));
          return;
        }
        const built = buildInDesignPackageDocumentScript({
          appName,
          outputFolderPath,
          expectedDocumentName,
          sourceDocumentPath,
          includeIdml,
          includePdf,
          copyFonts,
          copyLinkedGraphics,
          copyProfiles,
          updateGraphics,
          includeHiddenLayers,
          ignorePreflightErrors,
          createReport,
          forceSave,
          pdfStyle,
        });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve InDesign app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 90000, maxBuffer: 768 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'InDesign package failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          const summary = summarizeDesktopDirectory(outputFolderPath);
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            outputFolderPath,
            packageOk: result?.packageOk === true,
            includeIdml,
            includePdf,
            copyFonts,
            copyLinkedGraphics,
            copyProfiles,
            createReport,
            fileCount: summary.fileCount,
            folderCount: summary.folderCount,
            sizeBytes: summary.sizeBytes,
            sampleFiles: summary.sampleFiles,
            missingLinksBefore: Number.isFinite(Number(result?.missingLinksBefore)) ? Number(result.missingLinksBefore) : 0,
            modifiedLinksBefore: Number.isFinite(Number(result?.modifiedLinksBefore)) ? Number(result.modifiedLinksBefore) : 0,
            missingFontsBefore: Number.isFinite(Number(result?.missingFontsBefore)) ? Number(result.missingFontsBefore) : 0,
            linkCount: Number.isFinite(Number(result?.linkCount)) ? Number(result.linkCount) : 0,
            fontCount: Number.isFinite(Number(result?.fontCount)) ? Number(result.fontCount) : 0,
            docWasModified: result?.docWasModified === true,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/photoshop_document_status' && req.method === 'POST') {
      readJsonBody(req, 8 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'Photoshop').trim() || 'Photoshop';
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildPhotoshopDocumentStatusScript({ appName, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve Photoshop app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 10000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'Photoshop document status failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          const documents = Array.isArray(result?.documents)
            ? result.documents.slice(0, 12).map((doc) => ({
                name: doc?.name ? String(doc.name).slice(0, 260) : '',
                path: doc?.path ? String(doc.path).slice(0, 1024) : null,
                modified: doc?.modified === true,
                saved: doc?.saved === true,
                widthPx: Number.isFinite(Number(doc?.widthPx)) ? Number(doc.widthPx) : 0,
                heightPx: Number.isFinite(Number(doc?.heightPx)) ? Number(doc.heightPx) : 0,
              })).filter((doc) => doc.name)
            : [];
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            appRunning: result?.appRunning === true,
            status: result?.status ? String(result.status).slice(0, 80) : 'unknown',
            documentCount: Number.isFinite(Number(result?.documentCount)) ? Number(result.documentCount) : 0,
            activeDocumentName: result?.activeDocumentName ? String(result.activeDocumentName).slice(0, 260) : null,
            activeDocumentPath: result?.activeDocumentPath ? String(result.activeDocumentPath).slice(0, 1024) : null,
            activeDocumentModified: result?.activeDocumentModified === true,
            activeDocumentSaved: result?.activeDocumentSaved === true,
            widthPx: Number.isFinite(Number(result?.widthPx)) ? Number(result.widthPx) : 0,
            heightPx: Number.isFinite(Number(result?.heightPx)) ? Number(result.heightPx) : 0,
            resolution: Number.isFinite(Number(result?.resolution)) ? Number(result.resolution) : 0,
            mode: result?.mode ? String(result.mode).slice(0, 80) : null,
            bitsPerChannel: result?.bitsPerChannel ? String(result.bitsPerChannel).slice(0, 80) : null,
            layerCount: Number.isFinite(Number(result?.layerCount)) ? Number(result.layerCount) : 0,
            groupCount: Number.isFinite(Number(result?.groupCount)) ? Number(result.groupCount) : 0,
            textLayerCount: Number.isFinite(Number(result?.textLayerCount)) ? Number(result.textLayerCount) : 0,
            smartObjectCount: Number.isFinite(Number(result?.smartObjectCount)) ? Number(result.smartObjectCount) : 0,
            adjustmentLayerCount: Number.isFinite(Number(result?.adjustmentLayerCount)) ? Number(result.adjustmentLayerCount) : 0,
            lockedLayers: Number.isFinite(Number(result?.lockedLayers)) ? Number(result.lockedLayers) : 0,
            hiddenLayers: Number.isFinite(Number(result?.hiddenLayers)) ? Number(result.hiddenLayers) : 0,
            selectionActive: result?.selectionActive === true,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            documents,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/photoshop_layer_inventory' && req.method === 'POST') {
      readJsonBody(req, 12 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'Photoshop').trim() || 'Photoshop';
        const query = String(parsed?.query || '').trim();
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        const maxItems = Math.max(1, Math.min(120, Math.trunc(Number(parsed?.maxItems || 40))));
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (query.length > 160 || /[\x00-\x1F]/.test(query)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'query must be <= 160 chars and cannot contain control chars.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildPhotoshopLayerInventoryScript({ appName, query, expectedDocumentName, sourceDocumentPath, maxItems });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve Photoshop app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 12000, maxBuffer: 768 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'Photoshop layer inventory failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          const layers = Array.isArray(result?.layers)
            ? result.layers.slice(0, maxItems).map((layer) => ({
                name: layer?.name ? String(layer.name).slice(0, 160) : '',
                path: layer?.path ? String(layer.path).slice(0, 300) : '',
                type: layer?.type ? String(layer.type).slice(0, 80) : '',
                kind: layer?.kind ? String(layer.kind).slice(0, 80) : '',
                visible: layer?.visible !== false,
                locked: layer?.locked === true,
                opacity: Number.isFinite(Number(layer?.opacity)) ? Number(layer.opacity) : 0,
                textPreview: layer?.textPreview ? String(layer.textPreview).slice(0, 240) : '',
                hasMask: layer?.hasMask === true,
                bounds: Array.isArray(layer?.bounds) ? layer.bounds.slice(0, 4).map((value) => Number.isFinite(Number(value)) ? Number(value) : 0) : [],
                depth: Number.isFinite(Number(layer?.depth)) ? Number(layer.depth) : 0,
              }))
            : [];
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            appRunning: result?.appRunning === true,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            query,
            layerCount: Number.isFinite(Number(result?.layerCount)) ? Number(result.layerCount) : 0,
            matchedLayers: Number.isFinite(Number(result?.matchedLayers)) ? Number(result.matchedLayers) : 0,
            textLayerCount: Number.isFinite(Number(result?.textLayerCount)) ? Number(result.textLayerCount) : 0,
            smartObjectCount: Number.isFinite(Number(result?.smartObjectCount)) ? Number(result.smartObjectCount) : 0,
            adjustmentLayerCount: Number.isFinite(Number(result?.adjustmentLayerCount)) ? Number(result.adjustmentLayerCount) : 0,
            groupCount: Number.isFinite(Number(result?.groupCount)) ? Number(result.groupCount) : 0,
            lockedLayers: Number.isFinite(Number(result?.lockedLayers)) ? Number(result.lockedLayers) : 0,
            hiddenLayers: Number.isFinite(Number(result?.hiddenLayers)) ? Number(result.hiddenLayers) : 0,
            selectionActive: result?.selectionActive === true,
            maskLayerCount: Number.isFinite(Number(result?.maskLayerCount)) ? Number(result.maskLayerCount) : 0,
            layers,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/photoshop_set_layer_state' && req.method === 'POST') {
      readJsonBody(req, 12 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'Photoshop').trim() || 'Photoshop';
        const layerName = String(parsed?.layerName || parsed?.targetLayerName || '').trim();
        const action = String(parsed?.action || '').trim().toLowerCase();
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (!layerName || layerName.length > 160 || /[\x00-\x1f]/.test(layerName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'layerName must be 1-160 chars and cannot contain control characters.' }));
          return;
        }
        if (!['show', 'hide', 'lock', 'unlock'].includes(action)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'action must be show, hide, lock, or unlock.' }));
          return;
        }
        if (expectedDocumentName.length > 260 || /[\x00]/.test(expectedDocumentName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'expectedDocumentName must be <= 260 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildPhotoshopSetLayerStateScript({ appName, layerName, action, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve Photoshop app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 15000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'Photoshop layer-state update failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          const matches = Array.isArray(result?.matches)
            ? result.matches.slice(0, 12).map((item) => ({
                name: item?.name ? String(item.name).slice(0, 160) : '',
                path: item?.path ? String(item.path).slice(0, 300) : '',
                type: item?.type ? String(item.type).slice(0, 80) : '',
                kind: item?.kind ? String(item.kind).slice(0, 80) : '',
                visible: item?.visible !== false,
                locked: item?.locked === true,
              })).filter((item) => item.name || item.path)
            : [];
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            appRunning: result?.appRunning === true,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            layerName,
            action,
            matchedLayers: Number.isFinite(Number(result?.matchedLayers)) ? Number(result.matchedLayers) : 0,
            changedLayers: Number.isFinite(Number(result?.changedLayers)) ? Number(result.changedLayers) : 0,
            beforeVisible: result?.beforeVisible === true,
            afterVisible: result?.afterVisible === true,
            beforeLocked: result?.beforeLocked === true,
            afterLocked: result?.afterLocked === true,
            docWasModified: result?.docWasModified === true,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            matches,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/photoshop_update_text_layer' && req.method === 'POST') {
      readJsonBody(req, 16 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'Photoshop').trim() || 'Photoshop';
        const layerName = String(parsed?.layerName || '').trim();
        const replacementText = String(parsed?.replacementText ?? '');
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (!layerName || layerName.length > 160 || /[\x00-\x08\x0B\x0C\x0E-\x1F]/.test(layerName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'layerName must be 1-160 chars and cannot contain control chars.' }));
          return;
        }
        if (replacementText.length > 5000 || /[\x00]/.test(replacementText)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'replacementText must be <= 5000 chars and cannot contain NUL.' }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildPhotoshopUpdateTextLayerScript({ appName, layerName, replacementText, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve Photoshop app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 20000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'Photoshop text layer update failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            layerName,
            replacementText,
            matchedLayers: Number.isFinite(Number(result?.matchedLayers)) ? Number(result.matchedLayers) : 0,
            updatedLayers: Number.isFinite(Number(result?.updatedLayers)) ? Number(result.updatedLayers) : 0,
            replacementMatches: Number.isFinite(Number(result?.replacementMatches)) ? Number(result.replacementMatches) : 0,
            layerNames: Array.isArray(result?.layerNames) ? result.layerNames.slice(0, 20).map((name) => String(name || '').slice(0, 160)).filter(Boolean) : [],
            docWasModified: result?.docWasModified === true,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/photoshop_place_asset' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 16 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'Photoshop').trim() || 'Photoshop';
        const rawAssetPath = String(parsed?.assetPath || '').trim();
        const layerName = String(parsed?.layerName || '').trim();
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (layerName.length > 160 || /[\x00-\x1F]/.test(layerName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'layerName must be <= 160 chars and cannot contain control chars.' }));
          return;
        }
        const assetValidated = validateDesktopPathServer(rawAssetPath);
        if (!assetValidated.ok) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: `assetPath: ${assetValidated.error}` }));
          return;
        }
        const assetPath = expandDesktopPath(assetValidated.path);
        if (!fs.existsSync(assetPath)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'assetPath does not exist.' }));
          return;
        }
        const assetGrant = requireLocalFileAccessGrant(req, parsedUrl, assetPath, 'read');
        if (!assetGrant.ok) {
          res.writeHead(assetGrant.status, CORS);
          res.end(JSON.stringify({ ok: false, error: assetGrant.error }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildPhotoshopPlaceAssetScript({ appName, assetPath, layerName, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve Photoshop app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 25000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'Photoshop place asset failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            assetPath,
            layerName: layerName || null,
            placedLayerName: result?.placedLayerName ? String(result.placedLayerName).slice(0, 160) : null,
            docWasModified: result?.docWasModified === true,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    if (url === '/desktop/photoshop_export_proof' && req.method === 'POST') {
      const parsedUrl = new URL(req.url, 'http://localhost');
      readJsonBody(req, 16 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || 'Photoshop').trim() || 'Photoshop';
        const rawOutputPath = String(parsed?.outputPath || '').trim();
        const expectedDocumentName = String(parsed?.expectedDocumentName || '').trim();
        const rawSourceDocumentPath = String(parsed?.sourceDocumentPath || '').trim();
        const format = String(parsed?.format || '').trim().toLowerCase() || (/\.jpe?g$/i.test(rawOutputPath) ? 'jpg' : 'png');
        const quality = Math.max(1, Math.min(12, Math.trunc(Number(parsed?.quality || 10))));
        if (!/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        if (!['png', 'jpg', 'jpeg'].includes(format)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'format must be png, jpg, or jpeg.' }));
          return;
        }
        const outputValidated = validateDesktopPathServer(rawOutputPath);
        if (!outputValidated.ok) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: `outputPath: ${outputValidated.error}` }));
          return;
        }
        const outputPath = expandDesktopPath(outputValidated.path);
        const outputGrant = requireLocalFileAccessGrant(req, parsedUrl, outputPath, 'write');
        if (!outputGrant.ok) {
          res.writeHead(outputGrant.status, CORS);
          res.end(JSON.stringify({ ok: false, error: outputGrant.error }));
          return;
        }
        const parentGrant = requireLocalFileAccessGrant(req, parsedUrl, path.dirname(outputPath), 'write');
        if (!parentGrant.ok) {
          res.writeHead(parentGrant.status, CORS);
          res.end(JSON.stringify({ ok: false, error: parentGrant.error }));
          return;
        }
        let sourceDocumentPath = '';
        if (rawSourceDocumentPath) {
          const validatedSource = validateDesktopPathServer(rawSourceDocumentPath);
          if (!validatedSource.ok) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: `sourceDocumentPath: ${validatedSource.error}` }));
            return;
          }
          sourceDocumentPath = expandDesktopPath(validatedSource.path);
        }
        const built = buildPhotoshopExportProofScript({ appName, outputPath, format, quality, expectedDocumentName, sourceDocumentPath });
        if (!built) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Could not resolve Photoshop app.' }));
          return;
        }
        exec(`osascript -e ${shellSingleQuote(built.script)}`, { timeout: 25000, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'Photoshop proof export failed').toString().slice(0, 1000) }));
            return;
          }
          let result = null;
          try { result = JSON.parse(String(stdout || '').trim()); } catch {}
          let fileExists = false;
          let sizeBytes = 0;
          try {
            const stat = fs.statSync(outputPath);
            fileExists = stat.isFile();
            sizeBytes = stat.size;
          } catch {}
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            appName: built.appName,
            documentName: result?.documentName ? String(result.documentName).slice(0, 260) : null,
            expectedDocumentName: expectedDocumentName || null,
            sourceDocumentPath: sourceDocumentPath || null,
            outputPath,
            format,
            quality: format === 'png' ? null : quality,
            widthPx: Number.isFinite(Number(result?.widthPx)) ? Number(result.widthPx) : 0,
            heightPx: Number.isFinite(Number(result?.heightPx)) ? Number(result.heightPx) : 0,
            fileExists,
            sizeBytes,
            docModified: result?.docModified === true,
            docSaved: result?.docSaved === true,
            error: result?.error ? String(result.error).slice(0, 500) : null,
          }));
        });
      });
      return;
    }

    // ── Phase 1c: screenshot + wait_for_app ──────────────────────────
    //
    // `/desktop/screenshot` — capture the full screen (or an app's
    // window) as base64 PNG. Uses macOS's built-in `screencapture` CLI
    // so there's no additional permission prompt beyond the Screen
    // Recording permission the user already granted.
    //
    // `/desktop/wait_for_app` — polls the running-app list every 250ms
    // until the named app appears (or timeout expires). Eliminates the
    // race between `open -a AppName` and the subsequent keystroke — we
    // want to start typing ONLY after the app is actually ready for
    // input, not just after `open` forked.
    if (url === '/desktop/screenshot' && req.method === 'GET') {
      const tmpFile = path.join(os.tmpdir(), `uc-screenshot-${Date.now()}.png`);
      const flags = '-T0 -x';  // no delay, silent (no camera sound)
      exec(`screencapture ${flags} ${shellSingleQuote(tmpFile)}`, { timeout: 5000 }, (err) => {
        if (err) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({
            ok: false,
            error: /permission/i.test(err.message)
              ? 'Screen Recording permission required. Grant it in System Settings → Privacy & Security → Screen Recording for whichever Terminal is running the bridge.'
              : err.message,
          }));
          return;
        }
        try {
          const buf = fs.readFileSync(tmpFile);
          const b64 = buf.toString('base64');
          try { fs.unlinkSync(tmpFile); } catch {}
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            mimeType: 'image/png',
            sizeBytes: buf.length,
            base64: b64,
          }));
        } catch (readErr) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ ok: false, error: `read screenshot file: ${readErr.message}` }));
        }
      });
      return;
    }

    // Phase 1d — open_url, open_path, click_at, screen_size
    if (url === '/desktop/open_url' && req.method === 'POST') {
      readJsonBody(req, 4096, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const raw = String(parsed?.url || '').trim();
        const validated = validateDesktopUrlServer(raw);
        if (!validated.ok) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: validated.error }));
          return;
        }
        exec(`open ${shellSingleQuote(validated.url)}`, { timeout: 5000 }, (err) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, url: validated.url, scheme: validated.scheme }));
        });
      });
      return;
    }

    if (url === '/desktop/open_path' && req.method === 'POST') {
      readJsonBody(req, 4096, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const raw = String(parsed?.path || '').trim();
        const appName = String(parsed?.appName || '').trim();
        const validated = validateDesktopPathServer(raw);
        if (!validated.ok) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: validated.error }));
          return;
        }
        if (appName && !/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        const resolved = appName ? resolveInstalledMacApp(appName) : null;
        const targetAppName = resolved?.name || appName || null;
        const openArgs = targetAppName
          ? ['-a', resolved?.appPath || targetAppName, validated.path]
          : [validated.path];
        execFile('open', openArgs, { timeout: 5000 }, (err) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: /does not exist|no such file/i.test(err.message) ? 'path_not_found' : err.message }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, path: validated.path, appName: targetAppName }));
        });
      });
      return;
    }

    if (url === '/desktop/stage_attachment' && req.method === 'POST') {
      readJsonBody(req, 140 * 1024 * 1024, (parsed, bodyErr) => {
        void (async () => {
          if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
          try {
            const filename = safeAttachmentFilename(parsed?.filename);
            const groupId = String(parsed?.groupId || '').trim();
            const targetPath = uniqueAttachmentPath(filename, groupId);
            const buffer = await bufferFromAttachmentSource(parsed);
            const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
            fs.writeFileSync(targetPath, buffer, { mode: 0o600 });
            res.writeHead(200, CORS);
            res.end(JSON.stringify({
              ok: true,
              path: targetPath,
              directory: path.dirname(targetPath),
              filename: path.basename(targetPath),
              sizeBytes: buffer.length,
              sha256,
              mimeType: String(parsed?.mimeType || 'application/octet-stream').slice(0, 120),
            }));
          } catch (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: err.message || 'attachment staging failed' }));
          }
        })();
      });
      return;
    }

    if (url === '/desktop/stage_attachment_manifest' && req.method === 'POST') {
      readJsonBody(req, 2 * 1024 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        try {
          const groupId = String(parsed?.groupId || '').trim();
          if (!groupId) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: 'groupId is required' }));
            return;
          }
          const dir = attachmentGroupDirectory(groupId);
          fs.mkdirSync(dir, { recursive: true });
          const targetPath = path.join(dir, '_underground-circle-upload-manifest.json');
          const content = JSON.stringify(parsed?.manifest || {}, null, 2);
          if (Buffer.byteLength(content, 'utf8') > 1024 * 1024) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: 'manifest exceeds 1 MB limit' }));
            return;
          }
          const sha256 = crypto.createHash('sha256').update(content, 'utf8').digest('hex');
          fs.writeFileSync(targetPath, `${content}\n`, { mode: 0o600 });
          res.writeHead(200, CORS);
          res.end(JSON.stringify({
            ok: true,
            path: targetPath,
            directory: dir,
            sizeBytes: Buffer.byteLength(content, 'utf8') + 1,
            sha256,
          }));
        } catch (err) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message || 'attachment manifest staging failed' }));
        }
      });
      return;
    }

    if (url === '/desktop/click_at' && req.method === 'POST') {
      readJsonBody(req, 512, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const xn = Number(parsed?.x);
        const yn = Number(parsed?.y);
        if (!Number.isInteger(xn) || !Number.isInteger(yn) || xn < 0 || yn < 0 || xn > 20000 || yn > 20000) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'x and y must be non-negative integers ≤ 20000' }));
          return;
        }
        // Prefer cliclick (more reliable); fall back to AppleScript.
        const useCliclick = desktopToolsHas('cliclick');
        const cmd = useCliclick
          ? `cliclick c:${xn},${yn}`
          : `osascript -e ${shellSingleQuote(`tell application "System Events" to click at {${xn}, ${yn}}`)}`;
        exec(cmd, { timeout: 3000 }, (err) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({
              ok: false,
              error: useCliclick
                ? err.message
                : 'AppleScript click-at-coords is unreliable on current macOS. Install cliclick (`brew install cliclick`) for accurate clicks.',
              via: useCliclick ? 'cliclick' : 'applescript',
            }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, x: xn, y: yn, via: useCliclick ? 'cliclick' : 'applescript' }));
        });
      });
      return;
    }

    if (url === '/desktop/screen_size' && req.method === 'GET') {
      // `system_profiler SPDisplaysDataType -detailLevel mini` has the
      // resolution but takes > 1s. `osascript` via Finder is fastest:
      //   tell application "Finder" to get bounds of window of desktop
      //   → returns {0, 0, 1920, 1080}
      const script = 'tell application "Finder" to get bounds of window of desktop';
      exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 2000 }, (err, stdout) => {
        if (err) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        const parts = String(stdout || '')
          .trim()
          .split(',')
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n));
        if (parts.length !== 4) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ ok: false, error: `could not parse screen size from "${stdout}"` }));
          return;
        }
        const width = parts[2] - parts[0];
        const height = parts[3] - parts[1];
        res.writeHead(200, CORS);
        res.end(JSON.stringify({ ok: true, width, height }));
      });
      return;
    }

    if (url === '/desktop/wait_for_app' && req.method === 'POST') {
      readJsonBody(req, 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || '').trim();
        if (!appName || !/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName.' }));
          return;
        }
        const timeoutMs = Math.max(500, Math.min(30_000, Number(parsed?.timeoutMs ?? 5_000)));
        const intervalMs = 250;
        const deadline = Date.now() + timeoutMs;
        const needle = appName.toLowerCase();
        const script = 'tell application "System Events" to get name of every application process whose background only is false';
        const poll = () => {
          if (Date.now() > deadline) {
            res.writeHead(200, CORS);
            res.end(JSON.stringify({ ok: false, error: 'timeout', appName, waitedMs: timeoutMs }));
            return;
          }
          exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 2000 }, (err, stdout) => {
            if (!err) {
              const running = String(stdout || '')
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
              if (running.some((a) => a === needle || a.includes(needle))) {
                const elapsedMs = timeoutMs - Math.max(0, deadline - Date.now());
                res.writeHead(200, CORS);
                res.end(JSON.stringify({ ok: true, appName, elapsedMs }));
                return;
              }
            }
            setTimeout(poll, intervalMs);
          });
        };
        poll();
      });
      return;
    }

    // `/desktop/a11y_tree` — walks the AXUIElement tree of a named app
    // (or the frontmost app when `app` omitted) via the Swift helper at
    // scripts/bin/uc-ax-helper. Returns a pruned, LLM-friendly JSON tree.
    //
    // Implementation note: the helper binary is compiled on demand at
    // bridge startup (see ensureAxHelper). Accessibility trust is
    // required for the helper binary specifically — granting `node` AX
    // is NOT enough because TCC identifies by code-signed executable.
    if (url === '/desktop/a11y_tree' && req.method === 'GET') {
      const parsed = new URL(req.url, 'http://localhost');
      const appName = parsed.searchParams.get('app') || '';
      const maxDepth = Math.max(1, Math.min(10, Number(parsed.searchParams.get('max_depth') || 6)));
      const maxNodes = Math.max(20, Math.min(400, Number(parsed.searchParams.get('max_nodes') || 150)));
      const helperPath = path.join(__dirname, 'bin', 'uc-ax-helper');
      if (!fs.existsSync(helperPath)) {
        res.writeHead(503, CORS);
        res.end(JSON.stringify({ ok: false, error: 'uc-ax-helper not compiled. Run `npm run build:ax-helper` or restart the bridge.' }));
        return;
      }
      const args = [
        'tree',
        ...(appName ? ['--app', appName] : ['--frontmost']),
        '--max-depth', String(maxDepth),
        '--max-nodes', String(maxNodes),
      ];
      execFile(helperPath, args, { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err && !stdout) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'helper failed').toString().slice(0, 500) }));
          return;
        }
        // Helper emits a single JSON line on stdout; forward verbatim.
        res.writeHead(200, CORS);
        res.end(stdout.toString().trim());
      });
      return;
    }

    // `/desktop/click_element` — clicks an element by the dotted path
    // returned from `/desktop/a11y_tree`. Tries AXPress first (native
    // accessibility click); falls back to a synthesised CGEvent at bbox
    // centre for elements that don't implement Press. PID is required
    // because AX element paths are only valid under their source app.
    if (url === '/desktop/click_element' && req.method === 'POST') {
      readJsonBody(req, 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const pid = Number(parsed?.pid || 0);
        const pathStr = String(parsed?.path || '');
        if (!pid || !pathStr) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'pid (number) and path (string) required' }));
          return;
        }
        // Light validation so we don't pass arbitrary shell fragments.
        if (!/^[0-9]+(\.[0-9]+)*$/.test(pathStr)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'path must be a dotted integer sequence like "0.2.1"' }));
          return;
        }
        const helperPath = path.join(__dirname, 'bin', 'uc-ax-helper');
        if (!fs.existsSync(helperPath)) {
          res.writeHead(503, CORS);
          res.end(JSON.stringify({ ok: false, error: 'uc-ax-helper not compiled.' }));
          return;
        }
        execFile(helperPath, ['click', '--pid', String(pid), '--path', pathStr], { timeout: 5000 }, (err, stdout, stderr) => {
          if (err && !stdout) {
            res.writeHead(500, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || err.message || 'click failed').toString().slice(0, 300) }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(stdout.toString().trim());
        });
      });
      return;
    }

    if (url === '/desktop/set_element_value' && req.method === 'POST') {
      readJsonBody(req, 40 * 1024, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const pid = Number(parsed?.pid);
        const p = String(parsed?.path || '').trim();
        const text = String(parsed?.text ?? '');
        if (!Number.isInteger(pid) || pid <= 0) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'pid required' }));
          return;
        }
        if (!/^[0-9]+(\.[0-9]+)*$/.test(p)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'path must be dotted integers' }));
          return;
        }
        if (text.length === 0 || text.length > 20_000) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'text must be 1-20000 chars' }));
          return;
        }
        const helper = path.join(__dirname, 'bin', 'uc-ax-helper');
        if (!fs.existsSync(helper)) {
          res.writeHead(503, CORS);
          res.end(JSON.stringify({ ok: false, error: 'uc-ax-helper not compiled. Run npm run bridge once after installing Xcode CLT.' }));
          return;
        }
        execFile(helper, ['set-value', '--pid', String(pid), '--path', p, '--text', text], { timeout: 7000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: (stderr || stdout || err.message || 'set value failed').toString().slice(0, 500) }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(stdout.toString().trim() || JSON.stringify({ ok: true, method: 'ax_set_value', chars: text.length }));
        });
      });
      return;
    }

    res.writeHead(404, CORS);
    res.end(JSON.stringify({ ok: false, error: 'Unknown /desktop endpoint. Try /desktop/health.' }));
    return;
  }

  // ─── UC-3: /browser/* — Playwright-backed persistent Chrome context ────
  //
  // Same auth + CORS story as /desktop/*. The browser context is lazy-
  // launched on first non-health call and reused across requests so we
  // don't pay Chrome's ~2s startup on every tool call.
  if (url.startsWith('/browser/')) {
    if (!browserBridge) {
      res.writeHead(503, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Playwright not installed. Run `npm install playwright` then restart the bridge.' }));
      return;
    }
    // /browser/health is unauthenticated (like /desktop/health) so clients
    // can probe presence without pairing.
    if (url === '/browser/health' && req.method === 'GET') {
      return browserBridge.handleHealth(req, res, CORS);
    }
    // All other endpoints require the same desktop token.
    const token = req.headers['x-uc-desktop-token'];
    if (!token || token !== getOrCreateDesktopToken()) {
      res.writeHead(401, CORS);
      res.end(JSON.stringify({ ok: false, error: 'Missing or invalid desktop token.' }));
      return;
    }
    const parsedUrl = new URL(req.url, 'http://localhost');
    const p = parsedUrl.pathname;
    try {
      if (p === '/browser/open_url' && req.method === 'POST') return browserBridge.handleOpenUrl(req, res, CORS);
      if (p === '/browser/dom_snapshot' && req.method === 'GET') return browserBridge.handleDomSnapshot(req, res, CORS, parsedUrl);
      if (p === '/browser/verification_state' && req.method === 'GET') return browserBridge.handleVerificationState(req, res, CORS);
      if (p === '/browser/click_role' && req.method === 'POST') return browserBridge.handleClickRole(req, res, CORS);
      if (p === '/browser/fill' && req.method === 'POST') return browserBridge.handleFill(req, res, CORS);
      if (p === '/browser/select' && req.method === 'POST') return browserBridge.handleSelect(req, res, CORS);
      if (p === '/browser/upload_file' && req.method === 'POST') return browserBridge.handleUploadFile(req, res, CORS);
      if (p === '/browser/press' && req.method === 'POST') return browserBridge.handlePress(req, res, CORS);
      if (p === '/browser/screenshot' && req.method === 'POST') return browserBridge.handleScreenshot(req, res, CORS);
      if (p === '/browser/close' && req.method === 'POST') return browserBridge.handleClose(req, res, CORS);
    } catch (err) {
      res.writeHead(500, CORS);
      res.end(JSON.stringify({ ok: false, error: (err && err.message) || 'browser handler error' }));
      return;
    }
    res.writeHead(404, CORS);
    res.end(JSON.stringify({ ok: false, error: 'Unknown /browser endpoint. Try /browser/health.' }));
    return;
  }

  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: 'Not found. Use /health, /sessions, /exec, /devices/*, /mcp, /desktop/*, or /browser/*' }));
});

// ─── Desktop-automation helpers (only used by the /desktop/* routes) ──────

function readJsonBody(req, maxBytes, callback) {
  let body = '';
  let destroyed = false;
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > maxBytes && !destroyed) {
      destroyed = true;
      try { req.destroy(); } catch {}
      callback(null, `Request body too large (>${maxBytes} bytes)`);
    }
  });
  req.on('end', () => {
    if (destroyed) return;
    try {
      const parsed = body ? JSON.parse(body) : {};
      callback(parsed, null);
    } catch (err) {
      callback(null, 'Invalid JSON body');
    }
  });
  req.on('error', (err) => { if (!destroyed) callback(null, err.message); });
}

function shellSingleQuote(s) {
  // POSIX shell single-quote escape: close, escape quote, reopen.
  return `'${String(s).replace(/'/g, "'\\''")}'`;
}

function escapeAppleScriptString(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const MAC_APP_SEARCH_ROOTS = [
  '/Applications',
  path.join(os.homedir(), 'Applications'),
  '/System/Applications',
  '/System/Applications/Utilities',
];
const macAppResolveCache = new Map();
const runningInDesignResolveCache = new Map();
const runningPhotoshopResolveCache = new Map();

function normalizeMacAppName(value) {
  return String(value || '')
    .replace(/\.app$/i, '')
    .toLowerCase()
    .replace(/\b(inc|llc|app|application)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripMacAppVersion(value) {
  return normalizeMacAppName(value)
    .replace(/\b(20\d{2}|19\d{2}|v?\d+(?:\.\d+){0,3})\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function macAppVersionRank(value) {
  const text = String(value || '');
  const yearMatch = text.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) return Number(yearMatch[1]);
  const semverMatch = text.match(/\bv?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:\.(\d+))?\b/i);
  if (!semverMatch) return 0;
  return semverMatch
    .slice(1, 5)
    .map((part) => Number(part || 0))
    .reduce((rank, part) => (rank * 1000) + Math.min(part, 999), 0);
}

function walkMacAppBundles(root, depth = 0, out = []) {
  if (depth > 3 || !root || !fs.existsSync(root)) return out;
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(root, entry.name);
    if (/\.app$/i.test(entry.name)) {
      out.push({
        name: entry.name.replace(/\.app$/i, ''),
        appPath: fullPath,
      });
      continue;
    }
    if (entry.name === 'Contents' || entry.name.startsWith('.')) continue;
    walkMacAppBundles(fullPath, depth + 1, out);
  }
  return out;
}

function scoreMacAppCandidate(query, candidateName) {
  const q = normalizeMacAppName(query);
  const c = normalizeMacAppName(candidateName);
  if (!q || !c) return 0;
  if (c === q) return 120;
  const qNoVersion = stripMacAppVersion(query);
  const cNoVersion = stripMacAppVersion(candidateName);
  if (qNoVersion && cNoVersion && cNoVersion === qNoVersion) return 112;
  if (c.includes(q)) return 96 + Math.min(q.length, 24);
  if (q.includes(c)) return 82 + Math.min(c.length, 18);
  if (qNoVersion && cNoVersion && cNoVersion.includes(qNoVersion)) return 88 + Math.min(qNoVersion.length, 18);
  const qWords = qNoVersion.split(' ').filter(Boolean);
  if (qWords.length > 0 && qWords.every((word) => cNoVersion.split(' ').includes(word))) {
    return 72 + qWords.join('').length;
  }
  return 0;
}

function resolveInstalledMacApp(appName) {
  if (process.platform !== 'darwin') return null;
  const query = String(appName || '').trim();
  if (!query) return null;
  const cacheKey = normalizeMacAppName(query);
  const cached = macAppResolveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const candidates = [];
  for (const root of MAC_APP_SEARCH_ROOTS) {
    walkMacAppBundles(root, 0, candidates);
  }
  let best = null;
  for (const candidate of candidates) {
    const score = scoreMacAppCandidate(query, candidate.name);
    if (score < 70) continue;
    const versionRank = macAppVersionRank(candidate.name);
    if (!best || score > best.score || (score === best.score && versionRank > best.versionRank)) {
      best = { ...candidate, score, versionRank };
    }
  }
  const value = best
    ? { name: best.name, appPath: best.appPath, score: best.score, versionRank: best.versionRank }
    : null;
  macAppResolveCache.set(cacheKey, { value, expiresAt: Date.now() + 60_000 });
  return value;
}

function summarizeDesktopDirectory(root) {
  const summary = {
    fileCount: 0,
    folderCount: 0,
    sizeBytes: 0,
    sampleFiles: [],
  };
  const rootPath = String(root || '');
  const maxEntries = 5000;
  function visit(current, depth) {
    if (summary.fileCount + summary.folderCount >= maxEntries || depth > 8) return;
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (summary.fileCount + summary.folderCount >= maxEntries) return;
      const fullPath = path.join(current, entry.name);
      let stat = null;
      try { stat = fs.statSync(fullPath); } catch { continue; }
      if (entry.isDirectory() || stat.isDirectory()) {
        summary.folderCount += 1;
        visit(fullPath, depth + 1);
        continue;
      }
      if (!stat.isFile()) continue;
      summary.fileCount += 1;
      summary.sizeBytes += stat.size;
      if (summary.sampleFiles.length < 40) {
        let rel = fullPath;
        try { rel = path.relative(rootPath, fullPath) || entry.name; } catch {}
        summary.sampleFiles.push(rel);
      }
    }
  }
  visit(rootPath, 0);
  return summary;
}

function getRunningInDesignAppRows() {
  if (process.platform !== 'darwin') return [];
  const script = `
tell application "System Events"
  set out to ""
  repeat with p in (application processes whose background only is false)
    set pname to name of p as text
    if pname contains "InDesign" then
      set out to out & pname & tab & ((frontmost of p) as text) & linefeed
    end if
  end repeat
  return out
end tell
`;
  try {
    return execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 3000 })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, frontmost] = line.split(/\t/);
        return {
          name: String(name || '').trim(),
          frontmost: /^true$/i.test(String(frontmost || '').trim()),
        };
      })
      .filter((row) => row.name);
  } catch {
    return [];
  }
}

function getRunningInDesignDocumentCount(appName) {
  const script = `
tell application "${escapeAppleScriptString(appName)}"
  return (count documents) as text
end tell
`;
  try {
    const raw = execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 3000 }).trim();
    const count = Number(raw);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

function resolveInDesignMacApp(appName) {
  if (process.platform !== 'darwin') return null;
  const query = String(appName || 'InDesign').trim() || 'InDesign';
  if (!/indesign/i.test(query)) return null;
  const cacheKey = normalizeMacAppName(query);
  const cached = runningInDesignResolveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let best = null;
  for (const row of getRunningInDesignAppRows()) {
    const score = scoreMacAppCandidate(query, row.name);
    if (score < 70) continue;
    const documentCount = getRunningInDesignDocumentCount(row.name);
    const versionRank = macAppVersionRank(row.name);
    const rank = (documentCount > 0 ? 100000 : 0) + (row.frontmost ? 10000 : 0) + score + versionRank;
    if (!best || rank > best.rank) best = { ...row, score, documentCount, versionRank, rank };
  }

  const installed = best ? resolveInstalledMacApp(best.name) : null;
  const value = best
    ? {
        name: best.name,
        appPath: installed?.appPath || null,
        score: best.score,
        versionRank: best.versionRank,
        running: true,
        frontmost: best.frontmost,
        documentCount: best.documentCount,
      }
    : null;
  runningInDesignResolveCache.set(cacheKey, { value, expiresAt: Date.now() + 10_000 });
  return value;
}

function getRunningPhotoshopAppRows() {
  if (process.platform !== 'darwin') return [];
  const script = `
tell application "System Events"
  set out to ""
  repeat with p in (application processes whose background only is false)
    set pname to name of p as text
    if pname contains "Photoshop" then
      set out to out & pname & tab & ((frontmost of p) as text) & linefeed
    end if
  end repeat
  return out
end tell
`;
  try {
    return execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 3000 })
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name, frontmost] = line.split(/\t/);
        return {
          name: String(name || '').trim(),
          frontmost: /^true$/i.test(String(frontmost || '').trim()),
        };
      })
      .filter((row) => row.name);
  } catch {
    return [];
  }
}

function getRunningPhotoshopDocumentCount(appName) {
  const script = `
tell application "${escapeAppleScriptString(appName)}"
  return (count documents) as text
end tell
`;
  try {
    const raw = execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 3000 }).trim();
    const count = Number(raw);
    return Number.isFinite(count) ? count : 0;
  } catch {
    return 0;
  }
}

function resolvePhotoshopMacApp(appName) {
  if (process.platform !== 'darwin') return null;
  const query = String(appName || 'Photoshop').trim() || 'Photoshop';
  if (!/photoshop/i.test(query)) return null;
  const cacheKey = normalizeMacAppName(query);
  const cached = runningPhotoshopResolveCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let best = null;
  for (const row of getRunningPhotoshopAppRows()) {
    const score = scoreMacAppCandidate(query, row.name);
    if (score < 70) continue;
    const documentCount = getRunningPhotoshopDocumentCount(row.name);
    const versionRank = macAppVersionRank(row.name);
    const rank = (documentCount > 0 ? 100000 : 0) + (row.frontmost ? 10000 : 0) + score + versionRank;
    if (!best || rank > best.rank) best = { ...row, score, documentCount, versionRank, rank };
  }

  const installed = best ? resolveInstalledMacApp(best.name) : null;
  const value = best
    ? {
        name: best.name,
        appPath: installed?.appPath || null,
        score: best.score,
        versionRank: best.versionRank,
        running: true,
        frontmost: best.frontmost,
        documentCount: best.documentCount,
      }
    : null;
  runningPhotoshopResolveCache.set(cacheKey, { value, expiresAt: Date.now() + 10_000 });
  return value;
}

// Keys supported in combos. Extend as needed; each map entry must be
// a valid AppleScript identifier.
const MODIFIER_TOKENS = {
  cmd: 'command down', command: 'command down', meta: 'command down', super: 'command down',
  shift: 'shift down',
  opt: 'option down', option: 'option down', alt: 'option down',
  ctrl: 'control down', control: 'control down',
  fn: 'function down',
};
// Named keys → AppleScript key codes. Letters / digits we pass via
// `keystroke "x"`; these need `key code N`.
const NAMED_KEY_CODES = {
  return: 36, enter: 36, tab: 48, space: 49, delete: 51, escape: 53, esc: 53,
  left: 123, right: 124, down: 125, up: 126,
  home: 115, end: 119, pageup: 116, 'page-up': 116, pagedown: 121, 'page-down': 121,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111,
};
const PUNCTUATION_KEYS = new Set([',', '.', '-', '=', '`', '[', ']']);

function keyComboToAppleScript(combo) {
  if (!combo || typeof combo !== 'string') return null;
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0 || parts.length > 5) return null;
  const modifiers = [];
  let key = null;
  for (const raw of parts) {
    const lower = raw.toLowerCase();
    if (MODIFIER_TOKENS[lower]) { modifiers.push(MODIFIER_TOKENS[lower]); continue; }
    if (key !== null) return null; // two terminal keys — reject
    key = raw;
  }
  if (!key) return null;
  const usingClause = modifiers.length > 0 ? ` using {${modifiers.join(', ')}}` : '';
  const lowerKey = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(NAMED_KEY_CODES, lowerKey)) {
    return `key code ${NAMED_KEY_CODES[lowerKey]}${usingClause}`;
  }
  if (/^[a-zA-Z0-9]$/.test(key) || PUNCTUATION_KEYS.has(key)) {
    return `keystroke "${key}"${usingClause}`;
  }
  return null;
}

// Cached result of `which <cmd>` probes. Populated on first `/desktop/*`
// call and re-used by subsequent requests. 5-min TTL so a Homebrew
// install of cliclick picks up without restarting the bridge.
const desktopToolProbes = { ts: 0, hits: {} };
function desktopToolsHas(cmd) {
  const now = Date.now();
  if (now - desktopToolProbes.ts > 5 * 60 * 1000) {
    desktopToolProbes.ts = now;
    desktopToolProbes.hits = {};
  }
  if (cmd in desktopToolProbes.hits) return desktopToolProbes.hits[cmd];
  // `which` exits 0 if found. `execSync` throws otherwise.
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore', timeout: 1000 });
    desktopToolProbes.hits[cmd] = true;
  } catch {
    desktopToolProbes.hits[cmd] = false;
  }
  return desktopToolProbes.hits[cmd];
}

// Mirrors `validateDesktopUrl` from the protocol module so the server
// can reject the same inputs before shelling `open`. Lives here
// duplicated (not imported) because the bridge is plain JS + the
// protocol module is TS under src/.
function validateDesktopUrlServer(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'url must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'url is empty' };
  if (trimmed.length > 2048) return { ok: false, error: 'url exceeds 2048 chars' };
  let parsed;
  try { parsed = new URL(trimmed); } catch { return { ok: false, error: 'url does not parse' }; }
  const scheme = String(parsed.protocol || '').replace(/:$/, '').toLowerCase();
  if (!['http', 'https', 'file', 'mailto'].includes(scheme)) {
    return { ok: false, error: `url scheme "${scheme}:" not allowed — use http, https, file, or mailto` };
  }
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: 'url contains control characters' };
  return { ok: true, url: trimmed, scheme };
}

function validateDesktopPathServer(raw) {
  if (typeof raw !== 'string') return { ok: false, error: 'path must be a string' };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'path is empty' };
  if (trimmed.length > 1024) return { ok: false, error: 'path exceeds 1024 chars' };
  if (/[\x00-\x1f]/.test(trimmed)) return { ok: false, error: 'path contains control characters' };
  if (/[`$;|&><\n]/.test(trimmed)) return { ok: false, error: 'path contains shell metacharacter' };
  return { ok: true, path: trimmed };
}

function expandDesktopPath(raw) {
  const trimmed = String(raw || '').trim();
  const home = os.homedir();
  const aliases = {
    downloads: path.join(home, 'Downloads'),
    download: path.join(home, 'Downloads'),
    documents: path.join(home, 'Documents'),
    document: path.join(home, 'Documents'),
    desktop: path.join(home, 'Desktop'),
    home: home,
    'home folder': home,
    'home directory': home,
  };
  const lower = trimmed.toLowerCase();
  if (aliases[lower]) return aliases[lower];
  if (trimmed === '~') return home;
  if (trimmed.startsWith('~/')) return path.join(home, trimmed.slice(2));
  if (trimmed.startsWith('./') || trimmed.startsWith('../')) return path.resolve(process.cwd(), trimmed);
  if (!path.isAbsolute(trimmed) && /^[A-Za-z0-9 ._-]+$/.test(trimmed)) return path.join(home, trimmed);
  return trimmed;
}

function safeAttachmentFilename(raw) {
  const fallback = 'chat-attachment.bin';
  const base = path.basename(String(raw || fallback))
    .replace(/[\x00-\x1f]/g, '')
    .replace(/[/:\\]/g, '_')
    .replace(/[^A-Za-z0-9._ ()@+#-]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  if (!base || base === '.' || base === '..') return fallback;
  return base;
}

function safeAttachmentFolderName(raw) {
  const fallback = 'desktop-file-task';
  const folder = safeAttachmentFilename(raw || fallback)
    .replace(/^\.+/, '')
    .replace(/\.+$/, '')
    .slice(0, 120);
  return folder || fallback;
}

function attachmentGroupDirectory(groupId) {
  const root = path.join(os.homedir(), 'Downloads', 'Underground Circle Attachments');
  return groupId ? path.join(root, safeAttachmentFolderName(groupId)) : root;
}

function uniqueAttachmentPath(filename, groupId) {
  const dir = attachmentGroupDirectory(groupId);
  fs.mkdirSync(dir, { recursive: true });
  const safe = safeAttachmentFilename(filename);
  const ext = path.extname(safe);
  const stem = path.basename(safe, ext) || 'chat-attachment';
  let candidate = path.join(dir, safe);
  if (!fs.existsSync(candidate)) return candidate;
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  candidate = path.join(dir, `${stem}-${stamp}${ext}`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem}-${stamp}-${index}${ext}`);
    index += 1;
  }
  return candidate;
}

async function bufferFromAttachmentSource(parsed) {
  const maxBytes = 100 * 1024 * 1024;
  const sourceUrl = String(parsed?.sourceUrl || '').trim();
  const base64 = String(parsed?.base64 || '').trim();
  if (sourceUrl) {
    const validated = validateDesktopUrlServer(sourceUrl);
    if (!validated.ok) throw new Error(validated.error);
    if (!/^https?$/i.test(validated.scheme)) throw new Error('sourceUrl must use http or https');
    if (typeof fetch !== 'function') throw new Error('This Node runtime does not support fetch for attachment staging.');
    const response = await fetch(validated.url);
    if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > maxBytes) throw new Error('attachment exceeds 100 MB staging limit');
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) throw new Error('attachment exceeds 100 MB staging limit');
    return Buffer.from(arrayBuffer);
  }
  if (base64) {
    const normalized = base64.replace(/^data:[^,]+,/, '');
    const estimated = Math.ceil(normalized.length * 3 / 4);
    if (estimated > maxBytes) throw new Error('attachment exceeds 100 MB staging limit');
    return Buffer.from(normalized, 'base64');
  }
  throw new Error('sourceUrl or base64 is required');
}

function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function parseBooleanOption(raw, fallback) {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const value = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'off'].includes(value)) return false;
  return fallback;
}

function realpathOrResolve(targetPath) {
  try {
    return fs.realpathSync.native ? fs.realpathSync.native(targetPath) : fs.realpathSync(targetPath);
  } catch {
    return path.resolve(targetPath);
  }
}

function isPathInsideRoot(targetPath, rootPath) {
  const target = realpathOrResolve(targetPath);
  const root = realpathOrResolve(rootPath);
  if (target === root) return true;
  const rel = path.relative(root, target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function cleanupLocalFileAccessGrants() {
  const now = Date.now();
  for (const [token, grant] of localFileAccessGrants.entries()) {
    if (!grant || grant.expiresAt <= now) localFileAccessGrants.delete(token);
  }
}

function normalizeGrantRoot(raw) {
  const validated = validateDesktopPathServer(raw);
  if (!validated.ok) return { ok: false, error: validated.error };
  const expanded = expandDesktopPath(validated.path);
  const parent = path.dirname(expanded);
  try {
    const stat = fs.statSync(expanded);
    if (!stat.isDirectory()) {
      const parentStat = fs.statSync(parent);
      if (!parentStat.isDirectory()) return { ok: false, error: `${parent} is not a directory` };
      return { ok: true, root: realpathOrResolve(parent) };
    }
  } catch (err) {
    try {
      const parentStat = fs.statSync(parent);
      if (parentStat.isDirectory()) return { ok: true, root: realpathOrResolve(parent) };
    } catch {}
    return { ok: false, error: err.message || String(err) };
  }
  return { ok: true, root: realpathOrResolve(expanded) };
}

function createLocalFileAccessGrant(input) {
  cleanupLocalFileAccessGrants();
  const rawRoots = Array.isArray(input.roots) && input.roots.length > 0 ? input.roots : ['~'];
  if (rawRoots.length > 12) return { ok: false, error: 'too many roots requested (max 12)' };
  const scope = String(input.scope || 'read').toLowerCase() === 'write' ? 'write' : 'read';
  const roots = [];
  for (const raw of rawRoots) {
    const normalized = normalizeGrantRoot(String(raw || ''));
    if (!normalized.ok) return { ok: false, error: normalized.error };
    if (!roots.includes(normalized.root)) roots.push(normalized.root);
  }
  const ttlMs = clampInt(input.ttlMs, LOCAL_FILE_GRANT_DEFAULT_TTL_MS, 60 * 1000, LOCAL_FILE_GRANT_MAX_TTL_MS);
  const token = crypto.randomBytes(24).toString('hex');
  const grant = {
    token,
    roots,
    scope,
    reason: String(input.reason || '').slice(0, 500),
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  };
  localFileAccessGrants.set(token, grant);
  return {
    ok: true,
    token,
    roots,
    scope: grant.scope,
    expiresAt: new Date(grant.expiresAt).toISOString(),
  };
}

function getLocalFileAccessToken(req, parsedUrl) {
  const fromHeader = req.headers['x-uc-file-session-token'];
  if (Array.isArray(fromHeader)) return fromHeader[0] || '';
  if (fromHeader) return String(fromHeader);
  return parsedUrl ? String(parsedUrl.searchParams.get('fileSessionToken') || '') : '';
}

function getLocalFileAccessGrant(req, parsedUrl) {
  cleanupLocalFileAccessGrants();
  const token = getLocalFileAccessToken(req, parsedUrl);
  if (!token) return null;
  const grant = localFileAccessGrants.get(token);
  if (!grant || grant.expiresAt <= Date.now()) {
    localFileAccessGrants.delete(token);
    return null;
  }
  return grant;
}

function requireLocalFileAccessGrant(req, parsedUrl, targetPath, requiredScope = 'read') {
  const grant = getLocalFileAccessGrant(req, parsedUrl);
	  if (!grant) {
	    return {
	      ok: false,
	      status: 403,
	      error: 'Local file access requires a scoped session token. Retry through the chat runtime so it can prepare scoped file access before using file tools.',
	    };
	  }
  const allowed = grant.roots.some((root) => isPathInsideRoot(targetPath, root));
  if (!allowed) {
    return {
      ok: false,
      status: 403,
      error: 'Local file access grant does not cover this path.',
    };
  }
  if (requiredScope === 'write' && grant.scope !== 'write') {
    return {
      ok: false,
      status: 403,
      error: 'Local file write access requires one-time write-scoped session verification. Approve file changes in the chat before using file write tools.',
    };
  }
  return { ok: true, grant };
}

const SEARCH_SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.next',
  '.expo',
  '.turbo',
  'dist',
  'build',
  'DerivedData',
  '.Trash',
  'Library',
  'Applications',
  'System',
  'Volumes',
  'Photos Library.photoslibrary',
]);

const TEXT_SEARCH_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonl', '.csv', '.tsv', '.xml', '.html', '.htm', '.css', '.scss',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.rb', '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.h', '.cpp', '.hpp', '.cs', '.php', '.sql', '.yaml', '.yml', '.toml', '.ini', '.log', '.env',
  '.sh', '.zsh', '.bash', '.fish', '.applescript',
]);

function parseSearchExtensions(raw) {
  if (!raw) return null;
  const values = String(raw)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
    .map((item) => item.startsWith('.') ? item : `.${item}`);
  return values.length ? new Set(values) : null;
}

function shouldSearchFileContent(filePath, stat, includeContent) {
  if (!includeContent) return false;
  if (stat.size > 768 * 1024) return false;
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_SEARCH_EXTENSIONS.has(ext) || ext === '';
}

function buildSearchNeedles(query) {
  const lower = query.toLowerCase();
  const tokens = lower.split(/[^a-z0-9._-]+/i).map((part) => part.trim()).filter((part) => part.length >= 2);
  return {
    lower,
    tokens: Array.from(new Set(tokens)),
  };
}

function matchesNeedles(value, needles) {
  const lowerValue = String(value || '').toLowerCase();
  if (lowerValue.includes(needles.lower)) return true;
  return needles.tokens.length > 0 && needles.tokens.every((token) => lowerValue.includes(token));
}

const BROWSER_TAB_APPS = {
  chrome: { label: 'Chrome', app: 'Google Chrome', mode: 'chromium' },
  'google chrome': { label: 'Chrome', app: 'Google Chrome', mode: 'chromium' },
  safari: { label: 'Safari', app: 'Safari', mode: 'safari' },
  brave: { label: 'Brave', app: 'Brave Browser', mode: 'chromium' },
  'brave browser': { label: 'Brave', app: 'Brave Browser', mode: 'chromium' },
  edge: { label: 'Edge', app: 'Microsoft Edge', mode: 'chromium' },
  'microsoft edge': { label: 'Edge', app: 'Microsoft Edge', mode: 'chromium' },
  arc: { label: 'Arc', app: 'Arc', mode: 'chromium' },
  opera: { label: 'Opera', app: 'Opera', mode: 'chromium' },
  vivaldi: { label: 'Vivaldi', app: 'Vivaldi', mode: 'chromium' },
};

function browserTabScript(appName, mode) {
  const tabTitle = mode === 'safari' ? 'name of t' : 'title of t';
  return `
if application "${appName}" is running then
  tell application "${appName}"
    set outText to ""
    set tabDelimiter to ASCII character 9
    repeat with w in windows
      repeat with t in tabs of w
        try
          set outText to outText & (${tabTitle} as text) & tabDelimiter & (URL of t as text) & linefeed
        end try
      end repeat
    end repeat
    return outText
  end tell
end if
return ""
`;
}

function readBrowserTabs(requested, callback) {
  const selected = requested.length
    ? requested.map((key) => BROWSER_TAB_APPS[key]).filter(Boolean)
    : [BROWSER_TAB_APPS.chrome, BROWSER_TAB_APPS.safari, BROWSER_TAB_APPS.brave, BROWSER_TAB_APPS.edge, BROWSER_TAB_APPS.arc];
  const unique = Array.from(new Map(selected.map((item) => [item.app, item])).values());
  let remaining = unique.length;
  const tabs = [];
  const errors = [];
  if (remaining === 0) {
    callback({ tabs, errors: ['No supported browser requested.'] });
    return;
  }
  unique.forEach((browser) => {
    const script = browserTabScript(browser.app, browser.mode);
    exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000, maxBuffer: 512 * 1024 }, (err, stdout) => {
      if (err) {
        errors.push(`${browser.label}: ${err.message}`);
      } else {
        String(stdout || '').split(/\r?\n/).forEach((line) => {
          const [title, url] = line.split('\t');
          if (url) tabs.push({ browser: browser.label, title: (title || '').trim(), url: url.trim() });
        });
      }
      remaining -= 1;
      if (remaining === 0) callback({ tabs, errors });
    });
  });
}

function readWindowState(callback) {
  const script = `
tell application "System Events"
  set frontProc to first application process whose frontmost is true
  set frontApp to name of frontProc
  set titleText to ""
  set boundsText to ""
  set windowsText to ""
  tell frontProc
    if (count of windows) > 0 then
      try
        set titleText to name of window 1
      end try
      try
        set p to position of window 1
        set s to size of window 1
        set boundsText to (item 1 of p as text) & "," & (item 2 of p as text) & "," & (item 1 of s as text) & "," & (item 2 of s as text)
      end try
      repeat with w in windows
        try
          set windowsText to windowsText & (name of w as text) & linefeed
        end try
      end repeat
    end if
  end tell
  return frontApp & linefeed & titleText & linefeed & boundsText & linefeed & windowsText
end tell
`;
  exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000, maxBuffer: 256 * 1024 }, (err, stdout) => {
    if (err) { callback(err); return; }
    const lines = String(stdout || '').split(/\r?\n/);
    const boundsParts = String(lines[2] || '').split(',').map((part) => Number(part.trim()));
    const bounds = boundsParts.length === 4 && boundsParts.every((n) => Number.isFinite(n))
      ? { x: boundsParts[0], y: boundsParts[1], width: boundsParts[2], height: boundsParts[3] }
      : null;
    callback(null, {
      frontmostApp: (lines[0] || '').trim(),
      activeWindowTitle: (lines[1] || '').trim(),
      activeWindowBounds: bounds,
      windows: lines.slice(3).map((line) => line.trim()).filter(Boolean).slice(0, 80),
    });
  });
}

function searchFiles(rootPath, query, options = {}) {
  const needles = buildSearchNeedles(query);
  const matches = [];
  let visited = 0;
  let searchedContent = 0;
  let truncated = false;
  const maxVisited = clampInt(options.maxVisited, 15000, 250, 50000);
  const maxMatches = clampInt(options.maxResults, 200, 10, 500);
  const maxDepth = clampInt(options.maxDepth, 9, 1, 20);
  const includeContent = parseBooleanOption(options.includeContent, true);
  const extensions = parseSearchExtensions(options.extensions);

  function visit(current, depth) {
    if (visited >= maxVisited || matches.length >= maxMatches || depth > maxDepth) {
      truncated = true;
      return;
    }
    visited += 1;
    let stat;
    try { stat = fs.lstatSync(current); } catch { return; }
    if (stat.isSymbolicLink()) {
      try { stat = fs.statSync(current); } catch { return; }
    }
    const base = path.basename(current);
    if (stat.isDirectory()) {
      if (depth > 0 && (base.startsWith('.') || SEARCH_SKIP_DIRS.has(base))) return;
      let entries = [];
      try { entries = fs.readdirSync(current); } catch { return; }
      entries
        .sort((a, b) => {
          const aMatch = matchesNeedles(a, needles) ? 0 : 1;
          const bMatch = matchesNeedles(b, needles) ? 0 : 1;
          return aMatch - bMatch || a.localeCompare(b);
        })
        .forEach((entry) => visit(path.join(current, entry), depth + 1));
      return;
    }
    if (!stat.isFile()) return;
    const ext = path.extname(base).toLowerCase();
    if (extensions && !extensions.has(ext)) return;
    let reason = '';
    let snippet = '';
    if (matchesNeedles(base, needles)) {
      reason = 'name';
    } else if (shouldSearchFileContent(current, stat, includeContent)) {
      try {
        const text = fs.readFileSync(current, 'utf8');
        if (!text.includes('\u0000')) {
          searchedContent += 1;
          const textLower = text.toLowerCase();
          let idx = textLower.indexOf(needles.lower);
          if (idx < 0 && needles.tokens.length > 0) {
            idx = textLower.indexOf(needles.tokens[0]);
          }
          if (idx >= 0) {
            reason = 'content';
            snippet = text.slice(Math.max(0, idx - 80), Math.min(text.length, idx + needles.lower.length + 160)).replace(/\s+/g, ' ').trim();
          }
        }
      } catch {}
    }
    if (reason) matches.push({ path: current, name: base, reason, size: stat.size, modifiedAt: stat.mtime.toISOString(), snippet });
  }
  visit(rootPath, 0);
  return { matches, visited, searchedContent, truncated };
}

function buildWindowManageScript({ action, appName, width, height }) {
  const allowed = new Set(['focus', 'raise', 'minimize', 'unminimize', 'zoom', 'resize']);
  if (!allowed.has(action)) return null;
  if (appName && !/^[A-Za-z0-9 .\-_()]+$/.test(appName)) return null;
  if (action === 'resize' && (!Number.isInteger(width) || !Number.isInteger(height) || width < 100 || height < 100 || width > 10000 || height > 10000)) return null;
  const target = appName
    ? `set targetProc to first application process whose name contains "${appName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : `set targetProc to first application process whose frontmost is true`;
  const actionScript = action === 'minimize'
    ? 'set value of attribute "AXMinimized" of window 1 of targetProc to true'
    : action === 'unminimize'
      ? 'set value of attribute "AXMinimized" of window 1 of targetProc to false'
      : action === 'resize'
        ? `set size of window 1 of targetProc to {${width}, ${height}}`
        : action === 'zoom'
          ? 'perform action "AXZoomWindow" of window 1 of targetProc'
          : 'perform action "AXRaise" of window 1 of targetProc';
  return `
tell application "System Events"
  ${target}
  set frontmost of targetProc to true
  if (count of windows of targetProc) is 0 then error "target app has no windows"
  ${actionScript}
end tell
`;
}

function menuLabelVariants(label) {
  const raw = String(label || '').trim();
  const variants = new Set([raw]);
  const withoutDots = raw.replace(/(\.\.\.|…)$/u, '').trim();
  if (withoutDots && withoutDots !== raw) variants.add(withoutDots);
  if (withoutDots) {
    variants.add(`${withoutDots}...`);
    variants.add(`${withoutDots}…`);
  }
  return Array.from(variants).filter(Boolean).slice(0, 6);
}

function appleScriptStringList(values) {
  return `{${values.map((value) => `"${escapeAppleScriptString(value)}"`).join(', ')}}`;
}

function buildMenuClickScript({ appName, menuPath }) {
  const cleanPath = Array.isArray(menuPath)
    ? menuPath.map((part) => String(part || '').trim()).filter(Boolean)
    : [];
  if (cleanPath.length < 2 || cleanPath.length > 6) return null;
  if (cleanPath.some((part) => part.length > 80 || /[\x00-\x1f]/.test(part))) return null;
  if (appName && !/^[A-Za-z0-9 .\-_()]+$/.test(appName)) return null;
  const resolved = appName ? resolveInstalledMacApp(appName) : null;
  const targetName = resolved?.name || String(appName || '').trim();
  const target = targetName
    ? `set targetProc to first application process whose name contains "${escapeAppleScriptString(targetName)}"`
    : `set targetProc to first application process whose frontmost is true`;
  const activate = targetName
    ? `try
  tell application "${escapeAppleScriptString(targetName)}" to activate
end try
delay 0.15`
    : '';
  let menuAccessor = `menu "${escapeAppleScriptString(cleanPath[0])}" of menu bar 1 of targetProc`;
  for (let i = 1; i < cleanPath.length - 1; i += 1) {
    menuAccessor = `menu 1 of menu item "${escapeAppleScriptString(cleanPath[i])}" of ${menuAccessor}`;
  }
  const finalItem = cleanPath[cleanPath.length - 1];
  const finalItemVariants = appleScriptStringList(menuLabelVariants(finalItem));
  return {
    appName: targetName || null,
    menuPath: cleanPath,
    script: `
${activate}
tell application "System Events"
  ${target}
  set frontmost of targetProc to true
  set clickedMenuItem to false
  repeat with candidateMenuItem in ${finalItemVariants}
    try
      click menu item (candidateMenuItem as text) of ${menuAccessor}
      set clickedMenuItem to true
      exit repeat
    end try
  end repeat
  if clickedMenuItem is false then error "menu item not found: ${escapeAppleScriptString(finalItem)}"
end tell
`,
  };
}

function buildInDesignDocumentStatusScript({ appName, expectedDocumentName, sourceDocumentPath }) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const notRunning = JSON.stringify({
    appRunning: false,
    appName: targetName,
    status: 'not_running',
    documentCount: 0,
    activeDocumentName: null,
    activeDocumentPath: null,
    activeDocumentModified: false,
    activeDocumentSaved: false,
    pageCount: 0,
    spreadCount: 0,
    layerCount: 0,
    lockedLayers: 0,
    hiddenLayers: 0,
    linkCount: 0,
    missingLinks: 0,
    modifiedLinks: 0,
    problemLinks: 0,
    fontCount: 0,
    missingFonts: 0,
    selectionCount: 0,
    documents: [],
    error: null,
  });
  const jsx = `
(function () {
  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};

  function normalizeDocName(value) {
    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
  }

  function normalizeDocPath(value) {
    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
    return String(value || "").toLowerCase();
  }

  function documentPath(value) {
    try { return value.fullName.fsName; } catch (_) { return ""; }
  }

  function collectionLength(value) {
    try { return value ? value.length : 0; } catch (_) { return 0; }
  }

  function documentMatches(value) {
    if (!value || value.isValid === false) return false;
    var docName = String(value.name || "");
    if (sourceDocumentPath) {
      var targetPath = normalizeDocPath(sourceDocumentPath);
      var currentPath = normalizeDocPath(documentPath(value));
      if (currentPath && currentPath === targetPath) return true;
      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
    }
    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
    return !sourceDocumentPath && !expectedDocumentName;
  }

  function findTargetDocument() {
    try {
      for (var i = 0; i < app.documents.length; i += 1) {
        if (documentMatches(app.documents[i])) return app.documents[i];
      }
    } catch (_) {}
    if (!sourceDocumentPath && !expectedDocumentName && collectionLength(app.documents) > 0) {
      try { return app.activeDocument; } catch (_) {}
    }
    return null;
  }

  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }

  function jsonString(value) {
    return "\\"" + jsonEscape(value) + "\\"";
  }

  function jsonNullableString(value) {
    return value === undefined || value === null || value === "" ? "null" : jsonString(value);
  }

  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }

  function jsonBoolean(value) {
    return value === true ? "true" : "false";
  }

  function jsonArray(values) {
    return "[" + values.join(",") + "]";
  }

  function documentSummaryJson(doc) {
    return "{" + [
      "\\"name\\":" + jsonString(doc.name),
      "\\"path\\":" + jsonNullableString(doc.path),
      "\\"modified\\":" + jsonBoolean(doc.modified),
      "\\"saved\\":" + jsonBoolean(doc.saved),
      "\\"pageCount\\":" + jsonNumber(doc.pageCount)
    ].join(",") + "}";
  }

  function stringifyInDesignStatus(value) {
    var docs = [];
    try {
      for (var i = 0; i < value.documents.length; i += 1) docs.push(documentSummaryJson(value.documents[i]));
    } catch (_) {}
    return "{" + [
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"status\\":" + jsonString(value.status),
      "\\"documentCount\\":" + jsonNumber(value.documentCount),
      "\\"activeDocumentName\\":" + jsonNullableString(value.activeDocumentName),
      "\\"activeDocumentPath\\":" + jsonNullableString(value.activeDocumentPath),
      "\\"activeDocumentModified\\":" + jsonBoolean(value.activeDocumentModified),
      "\\"activeDocumentSaved\\":" + jsonBoolean(value.activeDocumentSaved),
      "\\"pageCount\\":" + jsonNumber(value.pageCount),
      "\\"spreadCount\\":" + jsonNumber(value.spreadCount),
      "\\"layerCount\\":" + jsonNumber(value.layerCount),
      "\\"lockedLayers\\":" + jsonNumber(value.lockedLayers),
      "\\"hiddenLayers\\":" + jsonNumber(value.hiddenLayers),
      "\\"linkCount\\":" + jsonNumber(value.linkCount),
      "\\"missingLinks\\":" + jsonNumber(value.missingLinks),
      "\\"modifiedLinks\\":" + jsonNumber(value.modifiedLinks),
      "\\"problemLinks\\":" + jsonNumber(value.problemLinks),
      "\\"fontCount\\":" + jsonNumber(value.fontCount),
      "\\"missingFonts\\":" + jsonNumber(value.missingFonts),
      "\\"selectionCount\\":" + jsonNumber(value.selectionCount),
      "\\"documents\\":" + jsonArray(docs),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  function makeDocumentSummary(doc) {
    return {
      name: String(doc && doc.name ? doc.name : ""),
      path: documentPath(doc),
      modified: (function () { try { return doc.modified === true; } catch (_) { return false; } }()),
      saved: (function () { try { return doc.saved === true; } catch (_) { return false; } }()),
      pageCount: (function () { try { return collectionLength(doc.pages); } catch (_) { return 0; } }())
    };
  }

  function getLayerDiagnostics(doc) {
    var out = { layerCount: 0, lockedLayers: 0, hiddenLayers: 0 };
    try {
      out.layerCount = collectionLength(doc.layers);
      for (var i = 0; i < doc.layers.length; i += 1) {
        try { if (doc.layers[i].locked === true) out.lockedLayers += 1; } catch (_) {}
        try { if (doc.layers[i].visible === false) out.hiddenLayers += 1; } catch (_) {}
      }
    } catch (_) {}
    return out;
  }

  function getLinkDiagnostics(doc) {
    var out = { linkCount: 0, missingLinks: 0, modifiedLinks: 0, problemLinks: 0 };
    try {
      out.linkCount = collectionLength(doc.links);
      for (var i = 0; i < doc.links.length; i += 1) {
        var link = doc.links[i];
        var statusText = "";
        var isMissing = false;
        var isModified = false;
        try { statusText = String(link.status || ""); } catch (_) {}
        var lower = statusText.toLowerCase();
        if (/missing/.test(lower)) isMissing = true;
        if (/modified|out.?of.?date|changed/.test(lower)) isModified = true;
        try { if (link.status === LinkStatus.LINK_MISSING) isMissing = true; } catch (_) {}
        try { if (link.status === LinkStatus.LINK_OUT_OF_DATE) isModified = true; } catch (_) {}
        if (isMissing) out.missingLinks += 1;
        if (isModified) out.modifiedLinks += 1;
        if (isMissing || isModified) out.problemLinks += 1;
      }
    } catch (_) {}
    return out;
  }

  function getFontDiagnostics(doc) {
    var out = { fontCount: 0, missingFonts: 0 };
    try {
      out.fontCount = collectionLength(doc.fonts);
      for (var i = 0; i < doc.fonts.length; i += 1) {
        var font = doc.fonts[i];
        var statusText = "";
        var isMissing = false;
        try { statusText = String(font.status || ""); } catch (_) {}
        if (/missing|not.?available|substitut/.test(statusText.toLowerCase())) isMissing = true;
        try { if (font.status === FontStatus.NOT_AVAILABLE) isMissing = true; } catch (_) {}
        if (isMissing) out.missingFonts += 1;
      }
    } catch (_) {}
    return out;
  }

  var out = {
    appRunning: true,
    appName: String(app.name || "InDesign"),
    status: "unknown",
    documentCount: collectionLength(app.documents),
    activeDocumentName: null,
    activeDocumentPath: null,
    activeDocumentModified: false,
    activeDocumentSaved: false,
    pageCount: 0,
    spreadCount: 0,
    layerCount: 0,
    lockedLayers: 0,
    hiddenLayers: 0,
    linkCount: 0,
    missingLinks: 0,
    modifiedLinks: 0,
    problemLinks: 0,
    fontCount: 0,
    missingFonts: 0,
    selectionCount: 0,
    documents: [],
    error: null
  };

  try {
    var maxDocs = Math.min(collectionLength(app.documents), 12);
    for (var docIndex = 0; docIndex < maxDocs; docIndex += 1) {
      out.documents.push(makeDocumentSummary(app.documents[docIndex]));
    }
  } catch (_) {}

  if (out.documentCount < 1) {
    out.status = "no_document";
    return stringifyInDesignStatus(out);
  }

  var doc = findTargetDocument();
  if (!doc) {
    out.status = "document_mismatch";
    try { out.activeDocumentName = String(app.activeDocument.name || ""); } catch (_) {}
    out.error = "Expected InDesign document is not active or open.";
    return stringifyInDesignStatus(out);
  }
  try { app.activeDocument = doc; } catch (_) {}

  out.activeDocumentName = String(doc.name || "");
  out.activeDocumentPath = documentPath(doc);
  try { out.activeDocumentModified = doc.modified === true; } catch (_) {}
  try { out.activeDocumentSaved = doc.saved === true; } catch (_) {}
  try { out.pageCount = collectionLength(doc.pages); } catch (_) {}
  try { out.spreadCount = collectionLength(doc.spreads); } catch (_) {}
  try { out.selectionCount = collectionLength(app.selection); } catch (_) {}
  var layers = getLayerDiagnostics(doc);
  out.layerCount = layers.layerCount;
  out.lockedLayers = layers.lockedLayers;
  out.hiddenLayers = layers.hiddenLayers;
  var links = getLinkDiagnostics(doc);
  out.linkCount = links.linkCount;
  out.missingLinks = links.missingLinks;
  out.modifiedLinks = links.modifiedLinks;
  out.problemLinks = links.problemLinks;
  var fonts = getFontDiagnostics(doc);
  out.fontCount = fonts.fontCount;
  out.missingFonts = fonts.missingFonts;
  out.status = (out.missingLinks + out.modifiedLinks + out.missingFonts) > 0 ? "needs_attention" : "ready";
  return stringifyInDesignStatus(out);
}());
`;
  return {
    appName: targetName,
    script: `
if application "${escapeAppleScriptString(targetName)}" is running then
  tell application "${escapeAppleScriptString(targetName)}"
    set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
  end tell
  return _ucResult
else
  return ${JSON.stringify(notRunning)}
end if
`,
  };
}

function buildInDesignTextInventoryScript({ appName, query, expectedDocumentName, sourceDocumentPath, maxItems }) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const notRunning = JSON.stringify({
    appRunning: false,
    appName: targetName,
    documentName: null,
    query: String(query || ''),
    textFrameCount: 0,
    matchedFrames: 0,
    oversetFrames: 0,
    lockedLayers: 0,
    hiddenLayers: 0,
    queryMatches: 0,
    layerNames: [],
    frames: [],
    error: null,
  });
  const jsx = `
(function () {
  var query = ${JSON.stringify(String(query ?? ''))};
  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};
  var maxItems = ${JSON.stringify(Math.max(1, Math.min(80, Math.trunc(Number(maxItems || 30)))))};

  function normalizeDocName(value) {
    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
  }

  function normalizeDocPath(value) {
    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
    return String(value || "").toLowerCase();
  }

  function documentPath(value) {
    try { return value.fullName.fsName; } catch (_) { return ""; }
  }

  function collectionLength(value) {
    try { return value ? value.length : 0; } catch (_) { return 0; }
  }

  function documentMatches(value) {
    if (!value || value.isValid === false) return false;
    var docName = String(value.name || "");
    if (sourceDocumentPath) {
      var targetPath = normalizeDocPath(sourceDocumentPath);
      var currentPath = normalizeDocPath(documentPath(value));
      if (currentPath && currentPath === targetPath) return true;
      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
    }
    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
    return !sourceDocumentPath && !expectedDocumentName;
  }

  function findTargetDocument() {
    try {
      for (var i = 0; i < app.documents.length; i += 1) {
        if (documentMatches(app.documents[i])) return app.documents[i];
      }
    } catch (_) {}
    if (!sourceDocumentPath && !expectedDocumentName && collectionLength(app.documents) > 0) {
      try { return app.activeDocument; } catch (_) {}
    }
    return null;
  }

  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }

  function jsonString(value) {
    return "\\"" + jsonEscape(value) + "\\"";
  }

  function jsonNullableString(value) {
    return value === undefined || value === null || value === "" ? "null" : jsonString(value);
  }

  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }

  function jsonBoolean(value) {
    return value === true ? "true" : "false";
  }

  function jsonArray(values) {
    return "[" + values.join(",") + "]";
  }

  function frameSummaryJson(frame) {
    return "{" + [
      "\\"layerName\\":" + jsonString(frame.layerName),
      "\\"itemName\\":" + jsonString(frame.itemName),
      "\\"label\\":" + jsonString(frame.label),
      "\\"pageName\\":" + jsonString(frame.pageName),
      "\\"contentPreview\\":" + jsonString(frame.contentPreview),
      "\\"chars\\":" + jsonNumber(frame.chars),
      "\\"matchCount\\":" + jsonNumber(frame.matchCount),
      "\\"overflows\\":" + jsonBoolean(frame.overflows),
      "\\"locked\\":" + jsonBoolean(frame.locked),
      "\\"visible\\":" + jsonBoolean(frame.visible)
    ].join(",") + "}";
  }

  function stringifyInDesignTextInventory(value) {
    var layerParts = [];
    var frameParts = [];
    try {
      for (var i = 0; i < value.layerNames.length; i += 1) layerParts.push(jsonString(value.layerNames[i]));
      for (var j = 0; j < value.frames.length; j += 1) frameParts.push(frameSummaryJson(value.frames[j]));
    } catch (_) {}
    return "{" + [
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"query\\":" + jsonString(value.query),
      "\\"textFrameCount\\":" + jsonNumber(value.textFrameCount),
      "\\"matchedFrames\\":" + jsonNumber(value.matchedFrames),
      "\\"oversetFrames\\":" + jsonNumber(value.oversetFrames),
      "\\"lockedLayers\\":" + jsonNumber(value.lockedLayers),
      "\\"hiddenLayers\\":" + jsonNumber(value.hiddenLayers),
      "\\"queryMatches\\":" + jsonNumber(value.queryMatches),
      "\\"layerNames\\":" + jsonArray(layerParts),
      "\\"frames\\":" + jsonArray(frameParts),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/^\\s+|\\s+$/g, "")
      .replace(/\\s+/g, " ");
  }

  function addUnique(values, value) {
    value = String(value || "");
    if (!value) return;
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] === value) return;
    }
    values.push(value);
  }

  function containsQuery() {
    var q = normalizeText(query);
    if (!q) return true;
    for (var i = 0; i < arguments.length; i += 1) {
      if (normalizeText(arguments[i]).indexOf(q) >= 0) return true;
    }
    return false;
  }

  function countLiteralOccurrences(contents, needle) {
    contents = String(contents || "");
    needle = String(needle || "");
    if (!contents || !needle) return 0;
    var count = 0;
    var from = 0;
    while (true) {
      var index = contents.indexOf(needle, from);
      if (index < 0) break;
      count += 1;
      from = index + Math.max(1, needle.length);
    }
    if (count > 0) return count;
    var lowerContents = contents.toLowerCase();
    var lowerNeedle = needle.toLowerCase();
    from = 0;
    while (true) {
      var lowerIndex = lowerContents.indexOf(lowerNeedle, from);
      if (lowerIndex < 0) break;
      count += 1;
      from = lowerIndex + Math.max(1, lowerNeedle.length);
    }
    if (count > 0) return count;
    return normalizeText(contents).indexOf(normalizeText(needle)) >= 0 ? 1 : 0;
  }

  function safeString(value) {
    try { return String(value || ""); } catch (_) { return ""; }
  }

  function itemLayerName(item) {
    try { return safeString(item.itemLayer.name); } catch (_) { return ""; }
  }

  function itemPageName(item) {
    try {
      if (item.parentPage && item.parentPage.isValid !== false) return safeString(item.parentPage.name);
    } catch (_) {}
    try {
      if (item.parent && item.parent.parentPage && item.parent.parentPage.isValid !== false) return safeString(item.parent.parentPage.name);
    } catch (_) {}
    return "";
  }

  function itemTextContents(item) {
    try {
      var contents = item.contents;
      if (contents !== undefined && contents !== null) return String(contents || "");
    } catch (_) {}
    try {
      if (item.parentStory && item.parentStory.isValid !== false) return String(item.parentStory.contents || "");
    } catch (_) {}
    return "";
  }

  function itemOverflows(item) {
    try { if (item.overflows === true) return true; } catch (_) {}
    try { if (item.parentStory && item.parentStory.overflows === true) return true; } catch (_) {}
    return false;
  }

  function itemLocked(item) {
    try { if (item.locked === true) return true; } catch (_) {}
    try { if (item.itemLayer && item.itemLayer.locked === true) return true; } catch (_) {}
    try { if (item.parentStory && item.parentStory.locked === true) return true; } catch (_) {}
    return false;
  }

  function itemVisible(item) {
    try { if (item.visible === false) return false; } catch (_) {}
    try { if (item.itemLayer && item.itemLayer.visible === false) return false; } catch (_) {}
    return true;
  }

  var out = {
    appRunning: true,
    appName: safeString(app.name || "InDesign"),
    documentName: null,
    query: query,
    textFrameCount: 0,
    matchedFrames: 0,
    oversetFrames: 0,
    lockedLayers: 0,
    hiddenLayers: 0,
    queryMatches: 0,
    layerNames: [],
    frames: [],
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    out.error = "No active InDesign document.";
    return stringifyInDesignTextInventory(out);
  }

  var doc = findTargetDocument();
  if (!doc) {
    out.error = "Expected InDesign document is not active or open.";
    try { out.documentName = safeString(app.activeDocument.name || ""); } catch (_) {}
    return stringifyInDesignTextInventory(out);
  }
  try { app.activeDocument = doc; } catch (_) {}
  out.documentName = safeString(doc.name || "");

  try {
    for (var layerIndex = 0; layerIndex < doc.layers.length; layerIndex += 1) {
      var layer = doc.layers[layerIndex];
      addUnique(out.layerNames, safeString(layer.name || ""));
      try { if (layer.locked === true) out.lockedLayers += 1; } catch (_) {}
      try { if (layer.visible === false) out.hiddenLayers += 1; } catch (_) {}
    }
  } catch (_) {}

  try {
    var items = doc.allPageItems;
    for (var itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      var item = items[itemIndex];
      if (!item || item.isValid === false) continue;
      var contents = itemTextContents(item);
      if (!contents) continue;
      out.textFrameCount += 1;
      var layerName = itemLayerName(item);
      var itemName = "";
      var label = "";
      try { itemName = safeString(item.name); } catch (_) {}
      try { label = safeString(item.label); } catch (_) {}
      var overflow = itemOverflows(item);
      if (overflow) out.oversetFrames += 1;
      if (!containsQuery(layerName, itemName, label, contents)) continue;
      out.matchedFrames += 1;
      var matchCount = countLiteralOccurrences(contents, query);
      out.queryMatches += matchCount;
      if (out.frames.length < maxItems) {
        out.frames.push({
          layerName: layerName,
          itemName: itemName,
          label: label,
          pageName: itemPageName(item),
          contentPreview: contents.replace(/[\\r\\n\\t]+/g, " ").replace(/\\s+/g, " ").slice(0, 220),
          chars: contents.length,
          matchCount: matchCount,
          overflows: overflow,
          locked: itemLocked(item),
          visible: itemVisible(item)
        });
      }
    }
  } catch (err) {
    out.error = err && err.message ? err.message : String(err);
  }

  return stringifyInDesignTextInventory(out);
}());
`;
  return {
    appName: targetName,
    script: `
if application "${escapeAppleScriptString(targetName)}" is running then
  tell application "${escapeAppleScriptString(targetName)}"
    set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
  end tell
  return _ucResult
else
  return ${JSON.stringify(notRunning)}
end if
`,
  };
}

function buildInDesignBatchUpdateTextLayersScript({ appName, updates, expectedDocumentName, sourceDocumentPath }) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const safeUpdates = (Array.isArray(updates) ? updates : [])
    .slice(0, 12)
    .map((update) => ({
      fieldName: String(update?.fieldName ?? ''),
      replacementText: String(update?.replacementText ?? ''),
    }))
    .filter((update) => update.fieldName);
  const jsx = `
(function () {
  var updates = ${JSON.stringify(safeUpdates)};
  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};
  if (!updates || updates.length < 1) throw new Error("Missing text layer updates");

  function normalizeDocName(value) {
    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
  }
  function normalizeDocPath(value) {
    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
    return String(value || "").toLowerCase();
  }
  function documentPath(value) {
    try { return value.fullName.fsName; } catch (_) { return ""; }
  }
  function collectionLength(value) {
    try { return value ? value.length : 0; } catch (_) { return 0; }
  }
  function documentMatches(value) {
    if (!value || value.isValid === false) return false;
    var docName = String(value.name || "");
    if (sourceDocumentPath) {
      var targetPath = normalizeDocPath(sourceDocumentPath);
      var currentPath = normalizeDocPath(documentPath(value));
      if (currentPath && currentPath === targetPath) return true;
      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
    }
    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
    return !sourceDocumentPath && !expectedDocumentName;
  }
  function findTargetDocument() {
    try {
      for (var i = 0; i < app.documents.length; i += 1) {
        if (documentMatches(app.documents[i])) return app.documents[i];
      }
    } catch (_) {}
    if (!sourceDocumentPath && !expectedDocumentName && collectionLength(app.documents) > 0) {
      try { return app.activeDocument; } catch (_) {}
    }
    return null;
  }
  function waitForTargetDocument(ms) {
    var deadline = (new Date()).getTime() + ms;
    while ((new Date()).getTime() < deadline) {
      var found = findTargetDocument();
      if (found) return found;
      $.sleep(250);
    }
    return findTargetDocument();
  }
  function openSourceDocument() {
    if (!sourceDocumentPath) return null;
    var file = File(sourceDocumentPath);
    if (!file.exists) throw new Error("Source InDesign file no longer exists: " + sourceDocumentPath);
    try { return app.open(file); } catch (err) {
      throw new Error("Could not open source InDesign file " + sourceDocumentPath + ": " + (err && err.message ? err.message : err));
    }
  }

  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }
  function jsonString(value) { return "\\"" + jsonEscape(value) + "\\""; }
  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }
  function jsonBoolean(value) { return value === true ? "true" : "false"; }
  function jsonArrayOfStrings(values) {
    var parts = [];
    for (var i = 0; i < values.length; i += 1) parts.push(jsonString(values[i]));
    return "[" + parts.join(",") + "]";
  }
  function stringifyFieldResult(value) {
    return "{" + [
      "\\"fieldName\\":" + jsonString(value.fieldName),
      "\\"replacementText\\":" + jsonString(value.replacementText),
      "\\"matchedLayers\\":" + jsonNumber(value.matchedLayers),
      "\\"matchedFrames\\":" + jsonNumber(value.matchedFrames),
      "\\"updatedFrames\\":" + jsonNumber(value.updatedFrames),
      "\\"replacementMatches\\":" + jsonNumber(value.replacementMatches),
      "\\"layerNames\\":" + jsonArrayOfStrings(value.layerNames),
      "\\"unlockedCount\\":" + jsonNumber(value.unlockedCount),
      "\\"error\\":" + jsonString(value.error)
    ].join(",") + "}";
  }
  function stringifyBatchTextLayerResult(value) {
    var resultParts = [];
    for (var i = 0; i < value.results.length; i += 1) resultParts.push(stringifyFieldResult(value.results[i]));
    return "{" + [
      "\\"documentName\\":" + jsonString(value.documentName),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"results\\":[" + resultParts.join(",") + "]",
      "\\"error\\":" + jsonString(value.error)
    ].join(",") + "}";
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/^\\s+|\\s+$/g, "")
      .replace(/\\s+/g, " ");
  }
  function addUnique(values, value) {
    value = normalizeText(value);
    if (!value) return;
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] === value) return;
    }
    values.push(value);
  }
  function addAliasGroup(values, group) {
    for (var i = 0; i < group.length; i += 1) addUnique(values, group[i]);
  }
  function fieldAliases(raw) {
    var key = normalizeText(raw);
    var aliases = [];
    addUnique(aliases, key);
    if (/\\b(disclaimer|legal|fine print|terms?|condition|copy)\\b/.test(key)) {
      addAliasGroup(aliases, ["disclaimer", "legal", "legal copy", "fine print", "terms", "terms and conditions", "disclosures", "copy"]);
    }
    if (/\\b(apr|rate|finance|payment|lease|offer|rebate|incentive|cash)\\b/.test(key)) {
      addAliasGroup(aliases, ["offer", "apr", "rate", "finance", "financing", "payment", "lease", "rebate", "incentive", "cash offer"]);
    }
    if (/\\b(price|sale|msrp|amount|monthly)\\b/.test(key)) {
      addAliasGroup(aliases, ["price", "sale price", "msrp", "amount", "monthly payment"]);
    }
    if (/\\b(vehicle|model|trim|year|stock|vin)\\b/.test(key)) {
      addAliasGroup(aliases, ["vehicle", "model", "trim", "year", "stock", "stock number", "vin"]);
    }
    if (/\\b(dealer|phone|website|url|address|location)\\b/.test(key)) {
      addAliasGroup(aliases, ["dealer", "dealer info", "dealer information", "phone", "website", "url", "address", "location"]);
    }
    if (/\\b(cta|button|call to action|shop|learn more|view inventory)\\b/.test(key)) {
      addAliasGroup(aliases, ["cta", "button", "call to action", "shop now", "learn more", "view inventory"]);
    }
    if (/\\b(headline|title|main)\\b/.test(key)) {
      addAliasGroup(aliases, ["headline", "title", "main headline", "primary headline"]);
    }
    if (/\\b(subheadline|subtitle|subhead)\\b/.test(key)) {
      addAliasGroup(aliases, ["subheadline", "subhead", "subtitle", "secondary headline"]);
    }
    if (/\\b(expir|expires|date|deadline)\\b/.test(key)) {
      addAliasGroup(aliases, ["expiration", "expires", "expiration date", "deadline", "offer ends"]);
    }
    return aliases;
  }
  function nameMatchesAliases(name, aliases) {
    var normalized = normalizeText(name);
    if (!normalized) return false;
    for (var i = 0; i < aliases.length; i += 1) {
      var alias = aliases[i];
      if (!alias) continue;
      if (normalized === alias) return true;
      if (alias.length > 3 && normalized.indexOf(alias) >= 0) return true;
      if (alias.length > 3 && alias.indexOf(normalized) >= 0) return true;
      var tokenPattern = new RegExp("(^|\\\\s)" + alias.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "(\\\\s|$)");
      if (tokenPattern.test(normalized)) return true;
    }
    return false;
  }
  function layerName(item) {
    try { return String(item.itemLayer.name || ""); } catch (_) { return ""; }
  }
  function itemLabelOrName(item) {
    var parts = [];
    try { if (item.name) parts.push(String(item.name)); } catch (_) {}
    try { if (item.label) parts.push(String(item.label)); } catch (_) {}
    return parts.join(" ");
  }
  function getTextTarget(item) {
    try {
      var contents = item.contents;
      if (contents !== undefined && contents !== null) return item;
    } catch (_) {}
    try {
      if (item.parentStory && item.parentStory.isValid !== false) {
        var storyContents = item.parentStory.contents;
        if (storyContents !== undefined && storyContents !== null) return item.parentStory;
      }
    } catch (_) {}
    return null;
  }
  function targetKey(target, item) {
    try { if (target && target.id !== undefined) return "t:" + String(target.id); } catch (_) {}
    try { if (item && item.id !== undefined) return "i:" + String(item.id); } catch (_) {}
    return String(Math.random());
  }
  function unlockTarget(target, prop, desiredValue, unlocked) {
    try {
      if (!target || target.isValid === false) return;
      var current = target[prop];
      if (current !== desiredValue) {
        unlocked.push({ target: target, prop: prop, value: current });
        target[prop] = desiredValue;
      }
    } catch (_) {}
  }
  function prepareTextItem(item, unlocked) {
    try { unlockTarget(item.itemLayer, "locked", false, unlocked); } catch (_) {}
    try { unlockTarget(item.itemLayer, "visible", true, unlocked); } catch (_) {}
    try { unlockTarget(item, "locked", false, unlocked); } catch (_) {}
    try { unlockTarget(item.parentStory, "locked", false, unlocked); } catch (_) {}
  }
  function restoreUnlocks(unlocked) {
    for (var i = unlocked.length - 1; i >= 0; i -= 1) {
      try {
        if (unlocked[i].target && unlocked[i].target.isValid !== false) {
          unlocked[i].target[unlocked[i].prop] = unlocked[i].value;
        }
      } catch (_) {}
    }
  }
  function readContents(target) {
    try { return String(target.contents || ""); } catch (_) { return ""; }
  }
  function writeContents(target, value) {
    try { target.contents = value; return true; } catch (_) {}
    return false;
  }
  function countReplacementMatchesInDoc(doc, value) {
    if (!value) return 0;
    var count = 0;
    try {
      for (var i = 0; i < doc.stories.length; i += 1) {
        var contents = String(doc.stories[i].contents || "");
        var from = 0;
        while (true) {
          var index = contents.indexOf(value, from);
          if (index < 0) break;
          count += 1;
          from = index + Math.max(1, value.length);
        }
      }
    } catch (_) {}
    return count;
  }
  function applyFieldUpdate(doc, update) {
    var fieldName = String(update.fieldName || "");
    var replacementText = String(update.replacementText || "");
    var aliases = fieldAliases(fieldName);
    var matchedLayerNames = [];
    var matchedLayerMap = {};
    try {
      for (var layerIndex = 0; layerIndex < doc.layers.length; layerIndex += 1) {
        var layer = doc.layers[layerIndex];
        var currentLayerName = String(layer.name || "");
        if (nameMatchesAliases(currentLayerName, aliases)) {
          var normalizedLayer = normalizeText(currentLayerName);
          if (!matchedLayerMap[normalizedLayer]) matchedLayerNames.push(currentLayerName);
          matchedLayerMap[normalizedLayer] = true;
        }
      }
    } catch (_) {}
    var seen = {};
    var matchedFrames = 0;
    var updatedFrames = 0;
    var unlocked = [];
    var error = "";
    try {
      var items = doc.allPageItems;
      for (var itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        var item = items[itemIndex];
        if (!item || item.isValid === false) continue;
        var currentLayerName = layerName(item);
        var matchedByLayer = matchedLayerMap[normalizeText(currentLayerName)] === true || nameMatchesAliases(currentLayerName, aliases);
        var matchedByItem = nameMatchesAliases(itemLabelOrName(item), aliases);
        if (!matchedByLayer && !matchedByItem) continue;
        var target = getTextTarget(item);
        if (!target) continue;
        var key = targetKey(target, item);
        if (seen[key]) continue;
        seen[key] = true;
        matchedFrames += 1;
        prepareTextItem(item, unlocked);
        var before = readContents(target);
        if (before !== replacementText) {
          if (writeContents(target, replacementText)) updatedFrames += 1;
        }
      }
    } catch (err) {
      error = err && err.message ? err.message : String(err);
    }
    restoreUnlocks(unlocked);
    if (!error && matchedFrames < 1) {
      error = "No editable text frame matched field aliases for " + fieldName;
    } else if (!error && updatedFrames < 1) {
      error = "Matching text frames already contained the requested replacement or could not be edited.";
    }
    return {
      fieldName: fieldName,
      replacementText: replacementText,
      matchedLayers: matchedLayerNames.length,
      matchedFrames: matchedFrames,
      updatedFrames: updatedFrames,
      replacementMatches: countReplacementMatchesInDoc(doc, replacementText),
      layerNames: matchedLayerNames,
      unlockedCount: unlocked.length,
      error: error
    };
  }

  var doc = waitForTargetDocument(12000);
  if (!doc && sourceDocumentPath) {
    doc = openSourceDocument();
    $.sleep(750);
    doc = waitForTargetDocument(8000) || doc;
  }
  if (!doc) {
    if (collectionLength(app.documents) < 1) throw new Error("No active InDesign document and source file could not be opened");
    var activeDocName = "";
    try { activeDocName = String(app.activeDocument.name || ""); } catch (_) {}
    throw new Error("Active InDesign document mismatch: expected " + (expectedDocumentName || sourceDocumentPath || "target document") + ", got " + activeDocName);
  }
  try { app.activeDocument = doc; } catch (_) {}
  var docWasModified = false;
  try { docWasModified = doc.modified === true; } catch (_) {}
  var results = [];
  for (var updateIndex = 0; updateIndex < updates.length; updateIndex += 1) {
    results.push(applyFieldUpdate(doc, updates[updateIndex]));
  }
  var docModified = false;
  var docSaved = false;
  try { docModified = doc.modified === true; } catch (_) {}
  try { docSaved = doc.saved === true; } catch (_) {}
  return stringifyBatchTextLayerResult({
    documentName: String(doc.name || ""),
    docWasModified: docWasModified,
    docModified: docModified,
    docSaved: docSaved,
    results: results,
    error: ""
  });
}());
`;
  return {
    appName: targetName,
    script: `
tell application "${escapeAppleScriptString(targetName)}"
  activate
  set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
end tell
return _ucResult
`,
  };
}

function buildInDesignSetLayerStateScript({ appName, layerName, action, expectedDocumentName, sourceDocumentPath }) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const jsx = `
(function () {
  var layerName = ${JSON.stringify(String(layerName ?? ''))};
  var action = ${JSON.stringify(String(action ?? ''))};
  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};
  if (!layerName) throw new Error("Missing layerName");
  if (!/^(show|hide|lock|unlock)$/.test(action)) throw new Error("Invalid layer action");

  function normalizeDocName(value) {
    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
  }

  function normalizeDocPath(value) {
    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
    return String(value || "").toLowerCase();
  }

  function normalizeLayerName(value) {
    return String(value || "").toLowerCase().replace(/^\\s+|\\s+$/g, "").replace(/\\s+/g, " ");
  }

  function documentPath(value) {
    try { return value.fullName.fsName; } catch (_) { return ""; }
  }

  function collectionLength(value) {
    try { return value ? value.length : 0; } catch (_) { return 0; }
  }

  function documentMatches(value) {
    if (!value || value.isValid === false) return false;
    var docName = String(value.name || "");
    if (sourceDocumentPath) {
      var targetPath = normalizeDocPath(sourceDocumentPath);
      var currentPath = normalizeDocPath(documentPath(value));
      if (currentPath && currentPath === targetPath) return true;
      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
    }
    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
    return !sourceDocumentPath && !expectedDocumentName;
  }

  function findTargetDocument() {
    try {
      for (var i = 0; i < app.documents.length; i += 1) {
        if (documentMatches(app.documents[i])) return app.documents[i];
      }
    } catch (_) {}
    if (!sourceDocumentPath && !expectedDocumentName && collectionLength(app.documents) > 0) {
      try { return app.activeDocument; } catch (_) {}
    }
    return null;
  }

  function waitForTargetDocument(ms) {
    var deadline = (new Date()).getTime() + ms;
    while ((new Date()).getTime() < deadline) {
      var found = findTargetDocument();
      if (found) return found;
      $.sleep(250);
    }
    return findTargetDocument();
  }

  function openSourceDocument() {
    if (!sourceDocumentPath) return null;
    var file = File(sourceDocumentPath);
    if (!file.exists) throw new Error("Source InDesign file no longer exists: " + sourceDocumentPath);
    try { return app.open(file); } catch (err) {
      throw new Error("Could not open source InDesign file " + sourceDocumentPath + ": " + (err && err.message ? err.message : err));
    }
  }

  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }

  function jsonString(value) {
    return "\\"" + jsonEscape(value) + "\\"";
  }

  function jsonNullableString(value) {
    return value === undefined || value === null || value === "" ? "null" : jsonString(value);
  }

  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }

  function jsonBoolean(value) {
    return value === true ? "true" : "false";
  }

  function jsonArray(values) {
    return "[" + values.join(",") + "]";
  }

  function safeLayerSnapshot(layer) {
    return {
      name: (function () { try { return String(layer.name || ""); } catch (_) { return ""; } }()),
      visible: (function () { try { return layer.visible !== false; } catch (_) { return false; } }()),
      locked: (function () { try { return layer.locked === true; } catch (_) { return false; } }()),
      printable: (function () { try { return layer.printable === true; } catch (_) { return false; } }())
    };
  }

  function layerSnapshotJson(value) {
    return "{" + [
      "\\"name\\":" + jsonString(value.name),
      "\\"visible\\":" + jsonBoolean(value.visible),
      "\\"locked\\":" + jsonBoolean(value.locked),
      "\\"printable\\":" + jsonBoolean(value.printable)
    ].join(",") + "}";
  }

  function stringifyResult(value) {
    var matches = [];
    try {
      for (var i = 0; i < value.matches.length; i += 1) matches.push(layerSnapshotJson(value.matches[i]));
    } catch (_) {}
    return "{" + [
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"layerName\\":" + jsonString(value.layerName),
      "\\"action\\":" + jsonString(value.action),
      "\\"matchedLayers\\":" + jsonNumber(value.matchedLayers),
      "\\"changedLayers\\":" + jsonNumber(value.changedLayers),
      "\\"beforeVisible\\":" + jsonBoolean(value.beforeVisible),
      "\\"afterVisible\\":" + jsonBoolean(value.afterVisible),
      "\\"beforeLocked\\":" + jsonBoolean(value.beforeLocked),
      "\\"afterLocked\\":" + jsonBoolean(value.afterLocked),
      "\\"beforePrintable\\":" + jsonBoolean(value.beforePrintable),
      "\\"afterPrintable\\":" + jsonBoolean(value.afterPrintable),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"matches\\":" + jsonArray(matches),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  function collectLayerMatches(doc) {
    var exact = [];
    var fuzzy = [];
    var needle = normalizeLayerName(layerName);
    try {
      for (var i = 0; i < doc.layers.length; i += 1) {
        var layer = doc.layers[i];
        var name = "";
        try { name = String(layer.name || ""); } catch (_) {}
        var normalized = normalizeLayerName(name);
        if (normalized === needle) exact.push(layer);
        else if (normalized.indexOf(needle) >= 0 || needle.indexOf(normalized) >= 0) fuzzy.push(layer);
      }
    } catch (_) {}
    return exact.length > 0 ? exact : fuzzy;
  }

  function applyAction(layer) {
    var before = safeLayerSnapshot(layer);
    if (action === "show") layer.visible = true;
    if (action === "hide") layer.visible = false;
    if (action === "lock") layer.locked = true;
    if (action === "unlock") layer.locked = false;
    var after = safeLayerSnapshot(layer);
    return {
      before: before,
      after: after,
      changed: before.visible !== after.visible || before.locked !== after.locked || before.printable !== after.printable
    };
  }

  var doc = findTargetDocument();
  if (!doc && sourceDocumentPath) {
    openSourceDocument();
    doc = waitForTargetDocument(3000);
  }
  if (!doc) throw new Error("Active InDesign document mismatch or no document open.");
  try { app.activeDocument = doc; } catch (_) {}

  var out = {
    documentName: String(doc.name || ""),
    layerName: layerName,
    action: action,
    matchedLayers: 0,
    changedLayers: 0,
    beforeVisible: false,
    afterVisible: false,
    beforeLocked: false,
    afterLocked: false,
    beforePrintable: false,
    afterPrintable: false,
    docWasModified: (function () { try { return doc.modified === true; } catch (_) { return false; } }()),
    docModified: false,
    docSaved: (function () { try { return doc.saved === true; } catch (_) { return false; } }()),
    matches: [],
    error: null
  };

  var matches = collectLayerMatches(doc);
  out.matchedLayers = matches.length;
  for (var m = 0; m < Math.min(matches.length, 12); m += 1) out.matches.push(safeLayerSnapshot(matches[m]));
  if (matches.length < 1) {
    out.error = "No InDesign layer matched " + layerName + ".";
    try { out.docModified = doc.modified === true; } catch (_) {}
    try { out.docSaved = doc.saved === true; } catch (_) {}
    return stringifyResult(out);
  }
  if (matches.length > 1) {
    out.error = "Layer target is ambiguous; matched " + matches.length + " layers.";
    try { out.docModified = doc.modified === true; } catch (_) {}
    try { out.docSaved = doc.saved === true; } catch (_) {}
    return stringifyResult(out);
  }

  var applied = applyAction(matches[0]);
  out.changedLayers = applied.changed ? 1 : 0;
  out.beforeVisible = applied.before.visible;
  out.afterVisible = applied.after.visible;
  out.beforeLocked = applied.before.locked;
  out.afterLocked = applied.after.locked;
  out.beforePrintable = applied.before.printable;
  out.afterPrintable = applied.after.printable;
  out.matches = [applied.after];
  try { out.docModified = doc.modified === true; } catch (_) {}
  try { out.docSaved = doc.saved === true; } catch (_) {}
  return stringifyResult(out);
}());
`;
  return {
    appName: targetName,
    script: `
tell application "${escapeAppleScriptString(targetName)}"
  activate
  set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
end tell
return _ucResult
`,
  };
}

function buildInDesignUpdateTextLayerScript({ appName, fieldName, replacementText, expectedDocumentName, sourceDocumentPath }) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const jsx = `
(function () {
  var fieldName = ${JSON.stringify(String(fieldName ?? ''))};
  var replacementText = ${JSON.stringify(String(replacementText ?? ''))};
  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};
  if (!fieldName) throw new Error("Missing fieldName");

  function normalizeDocName(value) {
    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
  }

  function normalizeDocPath(value) {
    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
    return String(value || "").toLowerCase();
  }

  function documentPath(value) {
    try { return value.fullName.fsName; } catch (_) { return ""; }
  }

  function collectionLength(value) {
    try { return value ? value.length : 0; } catch (_) { return 0; }
  }

  function documentMatches(value) {
    if (!value || value.isValid === false) return false;
    var docName = String(value.name || "");
    if (sourceDocumentPath) {
      var targetPath = normalizeDocPath(sourceDocumentPath);
      var currentPath = normalizeDocPath(documentPath(value));
      if (currentPath && currentPath === targetPath) return true;
      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
    }
    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
    return !sourceDocumentPath && !expectedDocumentName;
  }

  function findTargetDocument() {
    try {
      for (var i = 0; i < app.documents.length; i += 1) {
        if (documentMatches(app.documents[i])) return app.documents[i];
      }
    } catch (_) {}
    if (!sourceDocumentPath && !expectedDocumentName && collectionLength(app.documents) > 0) {
      try { return app.activeDocument; } catch (_) {}
    }
    return null;
  }

  function waitForTargetDocument(ms) {
    var deadline = (new Date()).getTime() + ms;
    while ((new Date()).getTime() < deadline) {
      var found = findTargetDocument();
      if (found) return found;
      $.sleep(250);
    }
    return findTargetDocument();
  }

  function openSourceDocument() {
    if (!sourceDocumentPath) return null;
    var file = File(sourceDocumentPath);
    if (!file.exists) throw new Error("Source InDesign file no longer exists: " + sourceDocumentPath);
    try { return app.open(file); } catch (err) {
      throw new Error("Could not open source InDesign file " + sourceDocumentPath + ": " + (err && err.message ? err.message : err));
    }
  }

  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }

  function jsonString(value) {
    return "\\"" + jsonEscape(value) + "\\"";
  }

  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }

  function jsonBoolean(value) {
    return value === true ? "true" : "false";
  }

  function jsonArrayOfStrings(values) {
    var parts = [];
    for (var i = 0; i < values.length; i += 1) parts.push(jsonString(values[i]));
    return "[" + parts.join(",") + "]";
  }

  function stringifyInDesignTextLayerResult(value) {
    return "{" + [
      "\\"documentName\\":" + jsonString(value.documentName),
      "\\"fieldName\\":" + jsonString(value.fieldName),
      "\\"replacementText\\":" + jsonString(value.replacementText),
      "\\"matchedLayers\\":" + jsonNumber(value.matchedLayers),
      "\\"matchedFrames\\":" + jsonNumber(value.matchedFrames),
      "\\"updatedFrames\\":" + jsonNumber(value.updatedFrames),
      "\\"replacementMatches\\":" + jsonNumber(value.replacementMatches),
      "\\"layerNames\\":" + jsonArrayOfStrings(value.layerNames),
      "\\"unlockedCount\\":" + jsonNumber(value.unlockedCount),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"error\\":" + jsonString(value.error)
    ].join(",") + "}";
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/^\\s+|\\s+$/g, "")
      .replace(/\\s+/g, " ");
  }

  function addUnique(values, value) {
    value = normalizeText(value);
    if (!value) return;
    for (var i = 0; i < values.length; i += 1) {
      if (values[i] === value) return;
    }
    values.push(value);
  }

  function addAliasGroup(values, group) {
    for (var i = 0; i < group.length; i += 1) addUnique(values, group[i]);
  }

  function fieldAliases(raw) {
    var key = normalizeText(raw);
    var aliases = [];
    addUnique(aliases, key);
    if (/\\b(disclaimer|legal|fine print|terms?|condition|copy)\\b/.test(key)) {
      addAliasGroup(aliases, ["disclaimer", "legal", "legal copy", "fine print", "terms", "terms and conditions", "disclosures", "copy"]);
    }
    if (/\\b(apr|rate|finance|payment|lease|offer|rebate|incentive|cash)\\b/.test(key)) {
      addAliasGroup(aliases, ["offer", "apr", "rate", "finance", "financing", "payment", "lease", "rebate", "incentive", "cash offer"]);
    }
    if (/\\b(price|sale|msrp|amount|monthly)\\b/.test(key)) {
      addAliasGroup(aliases, ["price", "sale price", "msrp", "amount", "monthly payment"]);
    }
    if (/\\b(vehicle|model|trim|year|stock|vin)\\b/.test(key)) {
      addAliasGroup(aliases, ["vehicle", "model", "trim", "year", "stock", "stock number", "vin"]);
    }
    if (/\\b(dealer|phone|website|url|address|location)\\b/.test(key)) {
      addAliasGroup(aliases, ["dealer", "dealer info", "dealer information", "phone", "website", "url", "address", "location"]);
    }
    if (/\\b(cta|button|call to action|shop|learn more|view inventory)\\b/.test(key)) {
      addAliasGroup(aliases, ["cta", "button", "call to action", "shop now", "learn more", "view inventory"]);
    }
    if (/\\b(headline|title|main)\\b/.test(key)) {
      addAliasGroup(aliases, ["headline", "title", "main headline", "primary headline"]);
    }
    if (/\\b(subheadline|subtitle|subhead)\\b/.test(key)) {
      addAliasGroup(aliases, ["subheadline", "subhead", "subtitle", "secondary headline"]);
    }
    if (/\\b(expir|expires|date|deadline)\\b/.test(key)) {
      addAliasGroup(aliases, ["expiration", "expires", "expiration date", "deadline", "offer ends"]);
    }
    return aliases;
  }

  function nameMatchesAliases(name, aliases) {
    var normalized = normalizeText(name);
    if (!normalized) return false;
    for (var i = 0; i < aliases.length; i += 1) {
      var alias = aliases[i];
      if (!alias) continue;
      if (normalized === alias) return true;
      if (alias.length > 3 && normalized.indexOf(alias) >= 0) return true;
      if (alias.length > 3 && alias.indexOf(normalized) >= 0) return true;
      var tokenPattern = new RegExp("(^|\\\\s)" + alias.replace(/[.*+?^\${}()|[\\]\\\\]/g, "\\\\$&") + "(\\\\s|$)");
      if (tokenPattern.test(normalized)) return true;
    }
    return false;
  }

  function layerName(item) {
    try { return String(item.itemLayer.name || ""); } catch (_) { return ""; }
  }

  function itemLabelOrName(item) {
    var parts = [];
    try { if (item.name) parts.push(String(item.name)); } catch (_) {}
    try { if (item.label) parts.push(String(item.label)); } catch (_) {}
    return parts.join(" ");
  }

  function getTextTarget(item) {
    try {
      var contents = item.contents;
      if (contents !== undefined && contents !== null) return item;
    } catch (_) {}
    try {
      if (item.parentStory && item.parentStory.isValid !== false) {
        var storyContents = item.parentStory.contents;
        if (storyContents !== undefined && storyContents !== null) return item.parentStory;
      }
    } catch (_) {}
    return null;
  }

  function targetKey(target, item) {
    try { if (target && target.id !== undefined) return "t:" + String(target.id); } catch (_) {}
    try { if (item && item.id !== undefined) return "i:" + String(item.id); } catch (_) {}
    return String(Math.random());
  }

  function unlockTarget(target, prop, desiredValue, unlocked) {
    try {
      if (!target || target.isValid === false) return;
      var current = target[prop];
      if (current !== desiredValue) {
        unlocked.push({ target: target, prop: prop, value: current });
        target[prop] = desiredValue;
      }
    } catch (_) {}
  }

  function prepareTextItem(item, unlocked) {
    try { unlockTarget(item.itemLayer, "locked", false, unlocked); } catch (_) {}
    try { unlockTarget(item.itemLayer, "visible", true, unlocked); } catch (_) {}
    try { unlockTarget(item, "locked", false, unlocked); } catch (_) {}
    try { unlockTarget(item.parentStory, "locked", false, unlocked); } catch (_) {}
  }

  function restoreUnlocks(unlocked) {
    for (var i = unlocked.length - 1; i >= 0; i -= 1) {
      try {
        if (unlocked[i].target && unlocked[i].target.isValid !== false) {
          unlocked[i].target[unlocked[i].prop] = unlocked[i].value;
        }
      } catch (_) {}
    }
  }

  function readContents(target) {
    try { return String(target.contents || ""); } catch (_) { return ""; }
  }

  function writeContents(target, value) {
    try { target.contents = value; return true; } catch (_) {}
    return false;
  }

  function countReplacementMatchesInDoc(doc, value) {
    if (!value) return 0;
    var count = 0;
    try {
      for (var i = 0; i < doc.stories.length; i += 1) {
        var contents = String(doc.stories[i].contents || "");
        var from = 0;
        while (true) {
          var index = contents.indexOf(value, from);
          if (index < 0) break;
          count += 1;
          from = index + Math.max(1, value.length);
        }
      }
    } catch (_) {}
    return count;
  }

  var doc = waitForTargetDocument(12000);
  if (!doc && sourceDocumentPath) {
    doc = openSourceDocument();
    $.sleep(750);
    doc = waitForTargetDocument(8000) || doc;
  }
  if (!doc) {
    if (collectionLength(app.documents) < 1) throw new Error("No active InDesign document and source file could not be opened");
    var activeDocName = "";
    try { activeDocName = String(app.activeDocument.name || ""); } catch (_) {}
    throw new Error("Active InDesign document mismatch: expected " + (expectedDocumentName || sourceDocumentPath || "target document") + ", got " + activeDocName);
  }
  try { app.activeDocument = doc; } catch (_) {}

  var docWasModified = false;
  try { docWasModified = doc.modified === true; } catch (_) {}
  var aliases = fieldAliases(fieldName);
  var matchedLayerNames = [];
  var matchedLayerMap = {};
  try {
    for (var layerIndex = 0; layerIndex < doc.layers.length; layerIndex += 1) {
      var layer = doc.layers[layerIndex];
      var currentLayerName = String(layer.name || "");
      if (nameMatchesAliases(currentLayerName, aliases)) {
        var normalizedLayer = normalizeText(currentLayerName);
        matchedLayerMap[normalizedLayer] = true;
        matchedLayerNames.push(currentLayerName);
      }
    }
  } catch (_) {}

  var seen = {};
  var matchedFrames = 0;
  var updatedFrames = 0;
  var unlocked = [];
  var error = "";
  try {
    var items = doc.allPageItems;
    for (var itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      var item = items[itemIndex];
      if (!item || item.isValid === false) continue;
      var currentLayerName = layerName(item);
      var matchedByLayer = matchedLayerMap[normalizeText(currentLayerName)] === true || nameMatchesAliases(currentLayerName, aliases);
      var matchedByItem = nameMatchesAliases(itemLabelOrName(item), aliases);
      if (!matchedByLayer && !matchedByItem) continue;
      var target = getTextTarget(item);
      if (!target) continue;
      var key = targetKey(target, item);
      if (seen[key]) continue;
      seen[key] = true;
      matchedFrames += 1;
      prepareTextItem(item, unlocked);
      var before = readContents(target);
      if (before !== replacementText) {
        if (writeContents(target, replacementText)) updatedFrames += 1;
      }
    }
  } catch (err) {
    error = err && err.message ? err.message : String(err);
  }
  restoreUnlocks(unlocked);

  if (!error && matchedFrames < 1) {
    error = "No editable text frame matched field aliases for " + fieldName;
  } else if (!error && updatedFrames < 1) {
    error = "Matching text frames already contained the requested replacement or could not be edited.";
  }

  var out = {
    documentName: String(doc.name || ""),
    fieldName: fieldName,
    replacementText: replacementText,
    matchedLayers: matchedLayerNames.length,
    matchedFrames: matchedFrames,
    updatedFrames: updatedFrames,
    replacementMatches: countReplacementMatchesInDoc(doc, replacementText),
    layerNames: matchedLayerNames,
    unlockedCount: unlocked.length,
    docWasModified: docWasModified,
    docModified: false,
    docSaved: false,
    error: error
  };
  try { out.docModified = doc.modified === true; } catch (_) {}
  try { out.docSaved = doc.saved === true; } catch (_) {}
  return stringifyInDesignTextLayerResult(out);
}());
`;
  return {
    appName: targetName,
    script: `
tell application "${escapeAppleScriptString(targetName)}"
  activate
  set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
end tell
return _ucResult
`,
  };
}

function buildInDesignBatchFindChangeScript({ appName, pairs, expectedDocumentName, sourceDocumentPath }) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const safePairs = (Array.isArray(pairs) ? pairs : [])
    .slice(0, 20)
    .map((pair) => ({
      findText: String(pair?.findText ?? ''),
      changeText: String(pair?.changeText ?? ''),
    }))
    .filter((pair) => pair.findText);
  const jsx = `
(function () {
  var pairs = ${JSON.stringify(safePairs)};
  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};
  if (!pairs || pairs.length < 1) throw new Error("Missing Find/Change pairs");

  function normalizeDocName(value) {
    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
  }
  function normalizeDocPath(value) {
    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
    return String(value || "").toLowerCase();
  }
  function documentPath(value) {
    try { return value.fullName.fsName; } catch (_) { return ""; }
  }
  function documentMatches(value) {
    if (!value || value.isValid === false) return false;
    var docName = String(value.name || "");
    if (sourceDocumentPath) {
      var targetPath = normalizeDocPath(sourceDocumentPath);
      var currentPath = normalizeDocPath(documentPath(value));
      if (currentPath && currentPath === targetPath) return true;
      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
    }
    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
    return !sourceDocumentPath && !expectedDocumentName;
  }
  function findTargetDocument() {
    try {
      for (var i = 0; i < app.documents.length; i += 1) {
        if (documentMatches(app.documents[i])) return app.documents[i];
      }
    } catch (_) {}
    if (!sourceDocumentPath && !expectedDocumentName && app.documents.length > 0) return app.activeDocument;
    return null;
  }
  function waitForTargetDocument(ms) {
    var deadline = (new Date()).getTime() + ms;
    while ((new Date()).getTime() < deadline) {
      var found = findTargetDocument();
      if (found) return found;
      $.sleep(250);
    }
    return findTargetDocument();
  }
  function openSourceDocument() {
    if (!sourceDocumentPath) return null;
    var file = File(sourceDocumentPath);
    if (!file.exists) throw new Error("Source InDesign file no longer exists: " + sourceDocumentPath);
    try { return app.open(file); } catch (err) {
      throw new Error("Could not open source InDesign file " + sourceDocumentPath + ": " + (err && err.message ? err.message : err));
    }
  }

  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }
  function jsonString(value) { return "\\"" + jsonEscape(value) + "\\""; }
  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }
  function jsonBoolean(value) { return value === true ? "true" : "false"; }
  function collectionLength(value) {
    try { return value ? value.length : 0; } catch (_) { return 0; }
  }
  function stringifyPairResult(value) {
    return "{" + [
      "\\"findText\\":" + jsonString(value.findText),
      "\\"changeText\\":" + jsonString(value.changeText),
      "\\"matched\\":" + jsonNumber(value.matched),
      "\\"changed\\":" + jsonNumber(value.changed),
      "\\"remaining\\":" + jsonNumber(value.remaining),
      "\\"replacementMatches\\":" + jsonNumber(value.replacementMatches),
      "\\"method\\":" + jsonString(value.method),
      "\\"unlockedCount\\":" + jsonNumber(value.unlockedCount),
      "\\"fallbackReason\\":" + jsonString(value.fallbackReason),
      "\\"error\\":" + jsonString(value.error)
    ].join(",") + "}";
  }
  function stringifyBatchResult(value) {
    var resultParts = [];
    for (var i = 0; i < value.results.length; i += 1) resultParts.push(stringifyPairResult(value.results[i]));
    return "{" + [
      "\\"documentName\\":" + jsonString(value.documentName),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"results\\":[" + resultParts.join(",") + "]",
      "\\"error\\":" + jsonString(value.error)
    ].join(",") + "}";
  }

  var nothing = NothingEnum.NOTHING;
  if (nothing === undefined) nothing = NothingEnum.nothing;
  function resetFindChange() {
    app.findTextPreferences = nothing;
    app.changeTextPreferences = nothing;
  }
  function enableInclusiveSearchOptions() {
    try { app.findChangeTextOptions.includeFootnotes = true; } catch (_) {}
    try { app.findChangeTextOptions.includeHiddenLayers = true; } catch (_) {}
    try { app.findChangeTextOptions.includeLockedLayersForFind = true; } catch (_) {}
    try { app.findChangeTextOptions.includeLockedStoriesForFind = true; } catch (_) {}
    try { app.findChangeTextOptions.includeMasterPages = true; } catch (_) {}
  }
  function unlockTarget(target, prop, unlocked) {
    try {
      if (target && target.isValid !== false && target[prop] === true) {
        unlocked.push({ target: target, prop: prop, value: true });
        target[prop] = false;
      }
    } catch (_) {}
  }
  function temporarilyUnlockDocument(doc) {
    var unlocked = [];
    try {
      for (var i = 0; i < doc.layers.length; i += 1) unlockTarget(doc.layers[i], "locked", unlocked);
    } catch (_) {}
    try {
      for (var j = 0; j < doc.stories.length; j += 1) unlockTarget(doc.stories[j], "locked", unlocked);
    } catch (_) {}
    try {
      var pageItems = doc.allPageItems;
      for (var k = 0; k < pageItems.length; k += 1) unlockTarget(pageItems[k], "locked", unlocked);
    } catch (_) {}
    return unlocked;
  }
  function restoreUnlocks(unlocked) {
    for (var i = unlocked.length - 1; i >= 0; i -= 1) {
      try {
        if (unlocked[i].target && unlocked[i].target.isValid !== false) {
          unlocked[i].target[unlocked[i].prop] = unlocked[i].value;
        }
      } catch (_) {}
    }
  }
  function countCurrentMatches(doc, value) {
    if (!value) return 0;
    var matches = [];
    resetFindChange();
    enableInclusiveSearchOptions();
    try {
      app.findTextPreferences.findWhat = value;
      matches = doc.findText();
    } catch (_) {
      matches = [];
    } finally {
      resetFindChange();
    }
    return collectionLength(matches);
  }
  function runChangeAll(doc, pair, mode) {
    var unlocked = [];
    var matches = [];
    var changed = [];
    var error = "";
    resetFindChange();
    enableInclusiveSearchOptions();
    app.findTextPreferences.findWhat = pair.findText;
    app.changeTextPreferences.changeTo = pair.changeText;
    try { matches = doc.findText(); } catch (_) {}
    try {
      if (mode === "unlocked") unlocked = temporarilyUnlockDocument(doc);
      changed = doc.changeText();
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    } finally {
      restoreUnlocks(unlocked);
      resetFindChange();
    }
    return {
      findText: pair.findText,
      changeText: pair.changeText,
      matched: collectionLength(matches),
      changed: collectionLength(changed),
      method: mode === "unlocked" ? "find-change-unlocked" : "find-change",
      unlockedCount: collectionLength(unlocked),
      fallbackReason: "",
      error: error
    };
  }

  var doc = waitForTargetDocument(12000);
  if (!doc && sourceDocumentPath) {
    doc = openSourceDocument();
    $.sleep(750);
    doc = waitForTargetDocument(8000) || doc;
  }
  if (!doc) {
    if (app.documents.length < 1) throw new Error("No active InDesign document and source file could not be opened");
    var activeDocName = "";
    try { activeDocName = String(app.activeDocument.name || ""); } catch (_) {}
    throw new Error("Active InDesign document mismatch: expected " + (expectedDocumentName || sourceDocumentPath || "target document") + ", got " + activeDocName);
  }
  try { app.activeDocument = doc; } catch (_) {}
  var docWasModified = false;
  try { docWasModified = doc.modified === true; } catch (_) {}
  var results = [];
  var topError = "";
  for (var pairIndex = 0; pairIndex < pairs.length; pairIndex += 1) {
    var pair = {
      findText: String(pairs[pairIndex].findText || ""),
      changeText: String(pairs[pairIndex].changeText || "")
    };
    var first = runChangeAll(doc, pair, "normal");
    var result = first;
    var shouldRetryUnlocked = (first.matched > 0 && first.changed < first.matched) || (first.changed < 1 && first.error);
    if (shouldRetryUnlocked) {
      var second = runChangeAll(doc, pair, "unlocked");
      if (second.changed > 0 || (first.error && !second.error)) {
        second.changed = first.changed + second.changed;
        second.matched = Math.max(first.matched, first.changed + second.matched);
        second.fallbackReason = first.error || "some matched text could not be changed while locked";
        result = second;
      }
    }
    result.remaining = countCurrentMatches(doc, pair.findText);
    result.replacementMatches = countCurrentMatches(doc, pair.changeText);
    results.push(result);
  }
  var docModified = false;
  var docSaved = false;
  try { docModified = doc.modified === true; } catch (_) {}
  try { docSaved = doc.saved === true; } catch (_) {}
  return stringifyBatchResult({
    documentName: String(doc.name || ""),
    docWasModified: docWasModified,
    docModified: docModified,
    docSaved: docSaved,
    results: results,
    error: topError
  });
}());
`;
  return {
    appName: targetName,
    script: `
tell application "${escapeAppleScriptString(targetName)}"
  activate
  set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
end tell
return _ucResult
`,
  };
}

function buildInDesignFindChangeScript({ appName, findText, changeText, expectedDocumentName, sourceDocumentPath }) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const jsx = `
(function () {
		  var findText = ${JSON.stringify(String(findText ?? ''))};
		  var changeText = ${JSON.stringify(String(changeText ?? ''))};
		  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
		  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};
		  if (!findText) throw new Error("Missing findText");
		  function normalizeDocName(value) {
		    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
		  }
		  function normalizeDocPath(value) {
		    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
		    return String(value || "").toLowerCase();
		  }
		  function documentPath(value) {
		    try { return value.fullName.fsName; } catch (_) { return ""; }
		  }
		  function documentMatches(value) {
		    if (!value || value.isValid === false) return false;
		    var docName = String(value.name || "");
		    if (sourceDocumentPath) {
		      var targetPath = normalizeDocPath(sourceDocumentPath);
		      var currentPath = normalizeDocPath(documentPath(value));
		      if (currentPath && currentPath === targetPath) return true;
		      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
		    }
		    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
		    return !sourceDocumentPath && !expectedDocumentName;
		  }
		  function findTargetDocument() {
		    try {
		      for (var i = 0; i < app.documents.length; i += 1) {
		        if (documentMatches(app.documents[i])) return app.documents[i];
		      }
		    } catch (_) {}
		    if (!sourceDocumentPath && !expectedDocumentName && app.documents.length > 0) return app.activeDocument;
		    return null;
		  }
		  function waitForTargetDocument(ms) {
		    var deadline = (new Date()).getTime() + ms;
		    while ((new Date()).getTime() < deadline) {
		      var found = findTargetDocument();
		      if (found) return found;
		      $.sleep(250);
		    }
		    return findTargetDocument();
		  }
		  function openSourceDocument() {
		    if (!sourceDocumentPath) return null;
		    var file = File(sourceDocumentPath);
		    if (!file.exists) throw new Error("Source InDesign file no longer exists: " + sourceDocumentPath);
		    try { return app.open(file); } catch (err) {
		      throw new Error("Could not open source InDesign file " + sourceDocumentPath + ": " + (err && err.message ? err.message : err));
		    }
		  }
		  var doc = waitForTargetDocument(12000);
		  if (!doc && sourceDocumentPath) {
		    doc = openSourceDocument();
		    $.sleep(750);
		    doc = waitForTargetDocument(8000) || doc;
		  }
		  if (!doc) {
		    if (app.documents.length < 1) throw new Error("No active InDesign document and source file could not be opened");
		    var activeDocName = "";
		    try { activeDocName = String(app.activeDocument.name || ""); } catch (_) {}
		    throw new Error("Active InDesign document mismatch: expected " + (expectedDocumentName || sourceDocumentPath || "target document") + ", got " + activeDocName);
		  }
		  try { app.activeDocument = doc; } catch (_) {}
		  var nothing = NothingEnum.NOTHING;
  if (nothing === undefined) nothing = NothingEnum.nothing;
  var docWasModified = false;
  try { docWasModified = doc.modified === true; } catch (_) {}

  function collectionLength(value) {
    try { return value ? value.length : 0; } catch (_) { return 0; }
  }

  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }

  function jsonString(value) {
    return "\\"" + jsonEscape(value) + "\\"";
  }

  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }

  function jsonBoolean(value) {
    return value === true ? "true" : "false";
  }

  function stringifyInDesignResult(value) {
    return "{" + [
      "\\"documentName\\":" + jsonString(value.documentName),
      "\\"matched\\":" + jsonNumber(value.matched),
      "\\"changed\\":" + jsonNumber(value.changed),
      "\\"remaining\\":" + jsonNumber(value.remaining),
      "\\"replacementMatches\\":" + jsonNumber(value.replacementMatches),
      "\\"method\\":" + jsonString(value.method),
      "\\"unlockedCount\\":" + jsonNumber(value.unlockedCount),
      "\\"lockedLayers\\":" + jsonNumber(value.lockedLayers),
      "\\"hiddenLayers\\":" + jsonNumber(value.hiddenLayers),
      "\\"lockedPageItems\\":" + jsonNumber(value.lockedPageItems),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"fallbackReason\\":" + jsonString(value.fallbackReason),
      "\\"error\\":" + jsonString(value.error)
    ].join(",") + "}";
  }

  function resetFindChange() {
    app.findTextPreferences = nothing;
    app.changeTextPreferences = nothing;
  }

  function enableInclusiveSearchOptions() {
    try { app.findChangeTextOptions.includeFootnotes = true; } catch (_) {}
    try { app.findChangeTextOptions.includeHiddenLayers = true; } catch (_) {}
    try { app.findChangeTextOptions.includeLockedLayersForFind = true; } catch (_) {}
    try { app.findChangeTextOptions.includeLockedStoriesForFind = true; } catch (_) {}
    try { app.findChangeTextOptions.includeMasterPages = true; } catch (_) {}
  }

  function getDocumentDiagnostics() {
    var out = {
      lockedLayers: 0,
      hiddenLayers: 0,
      lockedPageItems: 0,
      docModified: false,
      docSaved: false
    };
    try { out.docModified = doc.modified === true; } catch (_) {}
    try { out.docSaved = doc.saved === true; } catch (_) {}
    try {
      for (var i = 0; i < doc.layers.length; i += 1) {
        try { if (doc.layers[i].locked === true) out.lockedLayers += 1; } catch (_) {}
        try { if (doc.layers[i].visible === false) out.hiddenLayers += 1; } catch (_) {}
      }
    } catch (_) {}
    try {
      var pageItems = doc.allPageItems;
      for (var j = 0; j < pageItems.length; j += 1) {
        try { if (pageItems[j].locked === true) out.lockedPageItems += 1; } catch (_) {}
      }
    } catch (_) {}
    return out;
  }

  function unlockTarget(target, prop, unlocked) {
    try {
      if (target && target.isValid !== false && target[prop] === true) {
        unlocked.push({ target: target, prop: prop, value: true });
        target[prop] = false;
      }
    } catch (_) {}
  }

  function temporarilyUnlockDocument() {
    var unlocked = [];
    try {
      for (var i = 0; i < doc.layers.length; i += 1) {
        unlockTarget(doc.layers[i], "locked", unlocked);
      }
    } catch (_) {}
    try {
      for (var j = 0; j < doc.stories.length; j += 1) {
        unlockTarget(doc.stories[j], "locked", unlocked);
      }
    } catch (_) {}
    try {
      var pageItems = doc.allPageItems;
      for (var k = 0; k < pageItems.length; k += 1) {
        unlockTarget(pageItems[k], "locked", unlocked);
      }
    } catch (_) {}
    return unlocked;
  }

  function restoreUnlocks(unlocked) {
    for (var i = unlocked.length - 1; i >= 0; i -= 1) {
      try {
        if (unlocked[i].target && unlocked[i].target.isValid !== false) {
          unlocked[i].target[unlocked[i].prop] = unlocked[i].value;
        }
      } catch (_) {}
    }
  }

  function runChangeAll(mode) {
    var unlocked = [];
    var matches = [];
    var changed = [];
    var error = "";
    resetFindChange();
    enableInclusiveSearchOptions();
    app.findTextPreferences.findWhat = findText;
    app.changeTextPreferences.changeTo = changeText;
    try { matches = doc.findText(); } catch (_) {}
    try {
      if (mode === "unlocked") unlocked = temporarilyUnlockDocument();
      changed = doc.changeText();
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    } finally {
      restoreUnlocks(unlocked);
      resetFindChange();
    }
    return {
      documentName: String(doc.name || ""),
      matched: collectionLength(matches),
      changed: collectionLength(changed),
      method: mode === "unlocked" ? "find-change-unlocked" : "find-change",
      unlockedCount: collectionLength(unlocked),
      error: error
    };
  }

  function countCurrentMatches(value) {
    if (!value) return 0;
    var matches = [];
    resetFindChange();
    enableInclusiveSearchOptions();
    try {
      app.findTextPreferences.findWhat = value;
      matches = doc.findText();
    } catch (_) {
      matches = [];
    } finally {
      resetFindChange();
    }
    return collectionLength(matches);
  }

  var diagnosticsBefore = getDocumentDiagnostics();
  var first = runChangeAll("normal");
  var result = first;
  var shouldRetryUnlocked = (first.matched > 0 && first.changed < first.matched) || (first.changed < 1 && first.error);
  if (shouldRetryUnlocked) {
    var second = runChangeAll("unlocked");
    if (second.changed > 0 || (first.error && !second.error)) {
      second.changed = first.changed + second.changed;
      second.matched = Math.max(first.matched, first.changed + second.matched);
      second.fallbackReason = first.error || "some matched text could not be changed while locked";
      result = second;
    }
  }
  var diagnosticsAfter = getDocumentDiagnostics();
  result.remaining = countCurrentMatches(findText);
  result.replacementMatches = countCurrentMatches(changeText);
  result.lockedLayers = diagnosticsBefore.lockedLayers;
  result.hiddenLayers = diagnosticsBefore.hiddenLayers;
  result.lockedPageItems = diagnosticsBefore.lockedPageItems;
  result.docWasModified = docWasModified;
  result.docModified = diagnosticsAfter.docModified;
  result.docSaved = diagnosticsAfter.docSaved;
  return stringifyInDesignResult(result);
}());
`;
  return {
    appName: targetName,
    script: `
tell application "${escapeAppleScriptString(targetName)}"
  activate
  set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
end tell
return _ucResult
`,
  };
}

function buildInDesignExportProofScript({ appName, outputPath, expectedDocumentName, sourceDocumentPath }) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const jsx = `
(function () {
  var outputPath = ${JSON.stringify(String(outputPath ?? ''))};
  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};
  if (!outputPath) throw new Error("Missing outputPath");

  function normalizeDocName(value) {
    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
  }
  function normalizeDocPath(value) {
    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
    return String(value || "").toLowerCase();
  }
  function documentPath(value) {
    try { return value.fullName.fsName; } catch (_) { return ""; }
  }
  function documentMatches(value) {
    if (!value || value.isValid === false) return false;
    var docName = String(value.name || "");
    if (sourceDocumentPath) {
      var targetPath = normalizeDocPath(sourceDocumentPath);
      var currentPath = normalizeDocPath(documentPath(value));
      if (currentPath && currentPath === targetPath) return true;
      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
    }
    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
    return !sourceDocumentPath && !expectedDocumentName;
  }
  function findTargetDocument() {
    try {
      for (var i = 0; i < app.documents.length; i += 1) {
        if (documentMatches(app.documents[i])) return app.documents[i];
      }
    } catch (_) {}
    if (!sourceDocumentPath && !expectedDocumentName && app.documents.length > 0) return app.activeDocument;
    return null;
  }
  function waitForTargetDocument(ms) {
    var deadline = (new Date()).getTime() + ms;
    while ((new Date()).getTime() < deadline) {
      var found = findTargetDocument();
      if (found) return found;
      $.sleep(250);
    }
    return findTargetDocument();
  }
  function openSourceDocument() {
    if (!sourceDocumentPath) return null;
    var file = File(sourceDocumentPath);
    if (!file.exists) throw new Error("Source InDesign file no longer exists: " + sourceDocumentPath);
    try { return app.open(file); } catch (err) {
      throw new Error("Could not open source InDesign file " + sourceDocumentPath + ": " + (err && err.message ? err.message : err));
    }
  }
  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }
  function jsonString(value) { return "\\"" + jsonEscape(value) + "\\""; }
  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }
  function jsonBoolean(value) { return value === true ? "true" : "false"; }
  function stringifyExportResult(value) {
    return "{" + [
      "\\"documentName\\":" + jsonString(value.documentName),
      "\\"pageCount\\":" + jsonNumber(value.pageCount),
      "\\"spreadCount\\":" + jsonNumber(value.spreadCount),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"error\\":" + jsonString(value.error)
    ].join(",") + "}";
  }

  var doc = waitForTargetDocument(12000);
  if (!doc && sourceDocumentPath) {
    doc = openSourceDocument();
    $.sleep(750);
    doc = waitForTargetDocument(8000) || doc;
  }
  if (!doc) {
    if (app.documents.length < 1) throw new Error("No active InDesign document and source file could not be opened");
    var activeDocName = "";
    try { activeDocName = String(app.activeDocument.name || ""); } catch (_) {}
    throw new Error("Active InDesign document mismatch: expected " + (expectedDocumentName || sourceDocumentPath || "target document") + ", got " + activeDocName);
  }
  try { app.activeDocument = doc; } catch (_) {}

  var docWasModified = false;
  try { docWasModified = doc.modified === true; } catch (_) {}
  var result = {
    documentName: String(doc.name || ""),
    pageCount: 0,
    spreadCount: 0,
    docWasModified: docWasModified,
    docModified: false,
    docSaved: false,
    error: ""
  };
  try { result.pageCount = doc.pages.length; } catch (_) {}
  try { result.spreadCount = doc.spreads.length; } catch (_) {}
  try {
    var outputFile = File(outputPath);
    var pdfType = ExportFormat.PDF_TYPE;
    if (pdfType === undefined) pdfType = ExportFormat.pdfType;
    doc.exportFile(pdfType, outputFile, false);
  } catch (err) {
    result.error = err && err.message ? err.message : String(err);
  }
  try { result.docModified = doc.modified === true; } catch (_) {}
  try { result.docSaved = doc.saved === true; } catch (_) {}
  return stringifyExportResult(result);
}());
`;
  return {
    appName: targetName,
    script: `
tell application "${escapeAppleScriptString(targetName)}"
  activate
  set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
end tell
return _ucResult
`,
  };
}

function buildInDesignRelinkAssetScript({ appName, assetPath, linkQuery, expectedDocumentName, sourceDocumentPath }) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const jsx = `
(function () {
  var assetPath = ${JSON.stringify(String(assetPath ?? ''))};
  var linkQuery = ${JSON.stringify(String(linkQuery ?? ''))};
  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};
  if (!assetPath) throw new Error("Missing assetPath");

  function normalizeDocName(value) {
    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
  }
  function normalizeDocPath(value) {
    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
    return String(value || "").toLowerCase();
  }
  function documentPath(value) {
    try { return value.fullName.fsName; } catch (_) { return ""; }
  }
  function documentMatches(value) {
    if (!value || value.isValid === false) return false;
    var docName = String(value.name || "");
    if (sourceDocumentPath) {
      var targetPath = normalizeDocPath(sourceDocumentPath);
      var currentPath = normalizeDocPath(documentPath(value));
      if (currentPath && currentPath === targetPath) return true;
      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
    }
    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
    return !sourceDocumentPath && !expectedDocumentName;
  }
  function findTargetDocument() {
    try {
      for (var i = 0; i < app.documents.length; i += 1) {
        if (documentMatches(app.documents[i])) return app.documents[i];
      }
    } catch (_) {}
    if (!sourceDocumentPath && !expectedDocumentName && app.documents.length > 0) return app.activeDocument;
    return null;
  }
  function waitForTargetDocument(ms) {
    var deadline = (new Date()).getTime() + ms;
    while ((new Date()).getTime() < deadline) {
      var found = findTargetDocument();
      if (found) return found;
      $.sleep(250);
    }
    return findTargetDocument();
  }
  function openSourceDocument() {
    if (!sourceDocumentPath) return null;
    var file = File(sourceDocumentPath);
    if (!file.exists) throw new Error("Source InDesign file no longer exists: " + sourceDocumentPath);
    try { return app.open(file); } catch (err) {
      throw new Error("Could not open source InDesign file " + sourceDocumentPath + ": " + (err && err.message ? err.message : err));
    }
  }
  function collectionLength(value) {
    try { return value ? value.length : 0; } catch (_) { return 0; }
  }
  function pushUniqueLink(list, link) {
    if (!link || link.isValid === false) return;
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] === link) return;
    }
    list.push(link);
  }
  function collectItemLinks(item, out) {
    if (!item || item.isValid === false) return;
    try { if (item.itemLink && item.itemLink.isValid !== false) pushUniqueLink(out, item.itemLink); } catch (_) {}
    try {
      for (var i = 0; i < collectionLength(item.graphics); i += 1) {
        try { if (item.graphics[i].itemLink) pushUniqueLink(out, item.graphics[i].itemLink); } catch (_) {}
      }
    } catch (_) {}
    try {
      for (var j = 0; j < collectionLength(item.allGraphics); j += 1) {
        try { if (item.allGraphics[j].itemLink) pushUniqueLink(out, item.allGraphics[j].itemLink); } catch (_) {}
      }
    } catch (_) {}
    try { if (item.parent && item.parent.itemLink) pushUniqueLink(out, item.parent.itemLink); } catch (_) {}
  }
  function linkStatusText(link) {
    try { return String(link.status || ""); } catch (_) {}
    return "";
  }
  function isProblemLink(link) {
    try { if (link.status === LinkStatus.NORMAL) return false; } catch (_) {}
    try { if (link.status === LinkStatus.LINK_UP_TO_DATE) return false; } catch (_) {}
    var status = linkStatusText(link).toLowerCase();
    if (!status) return false;
    return status.indexOf("normal") < 0 && status.indexOf("up") < 0 && status.indexOf("ok") < 0;
  }
  function linkIdentity(link) {
    var parts = [];
    try { parts.push(String(link.name || "")); } catch (_) {}
    try { parts.push(String(link.filePath || "")); } catch (_) {}
    try { parts.push(String(link.parent.name || "")); } catch (_) {}
    try { parts.push(String(link.parent.label || "")); } catch (_) {}
    try { parts.push(String(link.parent.itemLayer.name || "")); } catch (_) {}
    return parts.join(" ").toLowerCase();
  }
  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }
  function jsonString(value) { return "\\"" + jsonEscape(value) + "\\""; }
  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }
  function jsonBoolean(value) { return value === true ? "true" : "false"; }
  function jsonArray(values) {
    var out = [];
    for (var i = 0; i < values.length; i += 1) out.push(jsonString(values[i]));
    return "[" + out.join(",") + "]";
  }
  function stringifyRelinkResult(value) {
    return "{" + [
      "\\"documentName\\":" + jsonString(value.documentName),
      "\\"matchedLinks\\":" + jsonNumber(value.matchedLinks),
      "\\"relinkedLinks\\":" + jsonNumber(value.relinkedLinks),
      "\\"missingBefore\\":" + jsonNumber(value.missingBefore),
      "\\"missingAfter\\":" + jsonNumber(value.missingAfter),
      "\\"linkNames\\":" + jsonArray(value.linkNames || []),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"error\\":" + jsonString(value.error)
    ].join(",") + "}";
  }

  var doc = waitForTargetDocument(12000);
  if (!doc && sourceDocumentPath) {
    doc = openSourceDocument();
    $.sleep(750);
    doc = waitForTargetDocument(8000) || doc;
  }
  if (!doc) {
    if (app.documents.length < 1) throw new Error("No active InDesign document and source file could not be opened");
    var activeDocName = "";
    try { activeDocName = String(app.activeDocument.name || ""); } catch (_) {}
    throw new Error("Active InDesign document mismatch: expected " + (expectedDocumentName || sourceDocumentPath || "target document") + ", got " + activeDocName);
  }
  try { app.activeDocument = doc; } catch (_) {}

  var docWasModified = false;
  try { docWasModified = doc.modified === true; } catch (_) {}
  var result = {
    documentName: String(doc.name || ""),
    matchedLinks: 0,
    relinkedLinks: 0,
    missingBefore: 0,
    missingAfter: 0,
    linkNames: [],
    docWasModified: docWasModified,
    docModified: false,
    docSaved: false,
    error: ""
  };
  var selectedLinks = [];
  try {
    for (var s = 0; s < collectionLength(app.selection); s += 1) collectItemLinks(app.selection[s], selectedLinks);
  } catch (_) {}
  var allLinks = [];
  try {
    for (var l = 0; l < collectionLength(doc.links); l += 1) {
      pushUniqueLink(allLinks, doc.links[l]);
      if (isProblemLink(doc.links[l])) result.missingBefore += 1;
    }
  } catch (_) {}
  var targets = [];
  var normalizedQuery = String(linkQuery || "").toLowerCase();
  if (selectedLinks.length > 0) {
    targets = selectedLinks;
  } else if (normalizedQuery) {
    for (var q = 0; q < allLinks.length; q += 1) {
      if (linkIdentity(allLinks[q]).indexOf(normalizedQuery) >= 0) pushUniqueLink(targets, allLinks[q]);
    }
  } else {
    var problemLinks = [];
    for (var p = 0; p < allLinks.length; p += 1) {
      if (isProblemLink(allLinks[p])) pushUniqueLink(problemLinks, allLinks[p]);
    }
    if (problemLinks.length === 1) targets = problemLinks;
    else if (allLinks.length === 1) targets = [allLinks[0]];
    else result.error = "Ambiguous InDesign relink target: select one placed asset or provide linkQuery. Links: " + allLinks.length + ", problem links: " + problemLinks.length + ".";
  }
  if (!result.error && targets.length < 1) {
    result.error = normalizedQuery ? ("No InDesign link matched " + linkQuery) : "No relinkable InDesign link was found.";
  }
  if (!result.error && targets.length > 20) {
    result.error = "Refusing to relink more than 20 InDesign assets at once.";
  }
  if (!result.error) {
    var newFile = File(assetPath);
    if (!newFile.exists) result.error = "Replacement asset no longer exists: " + assetPath;
    else {
      result.matchedLinks = targets.length;
      for (var t = 0; t < targets.length; t += 1) {
        try {
          var beforeName = "";
          try { beforeName = String(targets[t].name || ""); } catch (_) {}
          targets[t].relink(newFile);
          try { targets[t].update(); } catch (_) {}
          result.relinkedLinks += 1;
          var afterName = beforeName;
          try { afterName = String(targets[t].name || beforeName); } catch (_) {}
          if (result.linkNames.length < 20) result.linkNames.push(afterName || beforeName || assetPath.split("/").pop());
        } catch (err) {
          result.error = err && err.message ? err.message : String(err);
          break;
        }
      }
    }
  }
  try {
    for (var m = 0; m < collectionLength(doc.links); m += 1) {
      if (isProblemLink(doc.links[m])) result.missingAfter += 1;
    }
  } catch (_) {}
  try { result.docModified = doc.modified === true; } catch (_) {}
  try { result.docSaved = doc.saved === true; } catch (_) {}
  return stringifyRelinkResult(result);
}());
`;
  return {
    appName: targetName,
    script: `
tell application "${escapeAppleScriptString(targetName)}"
  activate
  set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
end tell
return _ucResult
`,
  };
}

function buildInDesignPackageDocumentScript({
  appName,
  outputFolderPath,
  expectedDocumentName,
  sourceDocumentPath,
  includeIdml,
  includePdf,
  copyFonts,
  copyLinkedGraphics,
  copyProfiles,
  updateGraphics,
  includeHiddenLayers,
  ignorePreflightErrors,
  createReport,
  forceSave,
  pdfStyle,
}) {
  const resolved = resolveInDesignMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp(appName || 'InDesign') ||
    resolveInstalledMacApp('Adobe InDesign') ||
    resolveInstalledMacApp('InDesign');
  const targetName = resolved?.name || String(appName || 'InDesign').trim();
  if (!targetName || !/indesign/i.test(targetName)) return null;
  const jsx = `
(function () {
  var outputFolderPath = ${JSON.stringify(String(outputFolderPath ?? ''))};
  var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
  var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};
  var includeIdml = ${includeIdml ? 'true' : 'false'};
  var includePdf = ${includePdf ? 'true' : 'false'};
  var copyFonts = ${copyFonts ? 'true' : 'false'};
  var copyLinkedGraphics = ${copyLinkedGraphics ? 'true' : 'false'};
  var copyProfiles = ${copyProfiles ? 'true' : 'false'};
  var updateGraphics = ${updateGraphics ? 'true' : 'false'};
  var includeHiddenLayers = ${includeHiddenLayers ? 'true' : 'false'};
  var ignorePreflightErrors = ${ignorePreflightErrors ? 'true' : 'false'};
  var createReport = ${createReport ? 'true' : 'false'};
  var forceSave = ${forceSave ? 'true' : 'false'};
  var pdfStyle = ${JSON.stringify(String(pdfStyle ?? ''))};
  if (!outputFolderPath) throw new Error("Missing outputFolderPath");

  function normalizeDocName(value) {
    return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
  }
  function normalizeDocPath(value) {
    try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
    return String(value || "").toLowerCase();
  }
  function documentPath(value) {
    try { return value.fullName.fsName; } catch (_) { return ""; }
  }
  function documentMatches(value) {
    if (!value || value.isValid === false) return false;
    var docName = String(value.name || "");
    if (sourceDocumentPath) {
      var targetPath = normalizeDocPath(sourceDocumentPath);
      var currentPath = normalizeDocPath(documentPath(value));
      if (currentPath && currentPath === targetPath) return true;
      if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
    }
    if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
    return !sourceDocumentPath && !expectedDocumentName;
  }
  function findTargetDocument() {
    try {
      for (var i = 0; i < app.documents.length; i += 1) {
        if (documentMatches(app.documents[i])) return app.documents[i];
      }
    } catch (_) {}
    if (!sourceDocumentPath && !expectedDocumentName && app.documents.length > 0) return app.activeDocument;
    return null;
  }
  function waitForTargetDocument(ms) {
    var deadline = (new Date()).getTime() + ms;
    while ((new Date()).getTime() < deadline) {
      var found = findTargetDocument();
      if (found) return found;
      $.sleep(250);
    }
    return findTargetDocument();
  }
  function openSourceDocument() {
    if (!sourceDocumentPath) return null;
    var file = File(sourceDocumentPath);
    if (!file.exists) throw new Error("Source InDesign file no longer exists: " + sourceDocumentPath);
    try { return app.open(file); } catch (err) {
      throw new Error("Could not open source InDesign file " + sourceDocumentPath + ": " + (err && err.message ? err.message : err));
    }
  }
  function collectionLength(value) {
    try { return value ? value.length : 0; } catch (_) { return 0; }
  }
  function linkStatusText(link) {
    try { return String(link.status || ""); } catch (_) {}
    return "";
  }
  function isProblemLink(link) {
    try { if (link.status === LinkStatus.NORMAL) return false; } catch (_) {}
    try { if (link.status === LinkStatus.LINK_UP_TO_DATE) return false; } catch (_) {}
    var status = linkStatusText(link).toLowerCase();
    if (!status) return false;
    return status.indexOf("normal") < 0 && status.indexOf("up") < 0 && status.indexOf("ok") < 0;
  }
  function isModifiedLink(link) {
    try { if (link.status === LinkStatus.LINK_OUT_OF_DATE) return true; } catch (_) {}
    var status = linkStatusText(link).toLowerCase();
    return status.indexOf("modified") >= 0 || status.indexOf("out") >= 0;
  }
  function fontStatusText(font) {
    try { return String(font.status || ""); } catch (_) {}
    return "";
  }
  function isMissingFont(font) {
    try { if (font.status === FontStatus.INSTALLED) return false; } catch (_) {}
    var status = fontStatusText(font).toLowerCase();
    if (!status) return false;
    return status.indexOf("installed") < 0 && status.indexOf("ok") < 0;
  }
  function jsonEscape(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/\\\\/g, "\\\\\\\\")
      .replace(/"/g, "\\\\\\"")
      .replace(/\\r/g, "\\\\r")
      .replace(/\\n/g, "\\\\n")
      .replace(/\\t/g, "\\\\t");
  }
  function jsonString(value) { return "\\"" + jsonEscape(value) + "\\""; }
  function jsonNumber(value) {
    var parsed = Number(value);
    return isFinite(parsed) ? String(parsed) : "0";
  }
  function jsonBoolean(value) { return value === true ? "true" : "false"; }
  function stringifyPackageResult(value) {
    return "{" + [
      "\\"documentName\\":" + jsonString(value.documentName),
      "\\"packageOk\\":" + jsonBoolean(value.packageOk),
      "\\"missingLinksBefore\\":" + jsonNumber(value.missingLinksBefore),
      "\\"modifiedLinksBefore\\":" + jsonNumber(value.modifiedLinksBefore),
      "\\"missingFontsBefore\\":" + jsonNumber(value.missingFontsBefore),
      "\\"linkCount\\":" + jsonNumber(value.linkCount),
      "\\"fontCount\\":" + jsonNumber(value.fontCount),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"error\\":" + jsonString(value.error)
    ].join(",") + "}";
  }

  var doc = waitForTargetDocument(12000);
  if (!doc && sourceDocumentPath) {
    doc = openSourceDocument();
    $.sleep(750);
    doc = waitForTargetDocument(8000) || doc;
  }
  if (!doc) {
    if (app.documents.length < 1) throw new Error("No active InDesign document and source file could not be opened");
    var activeDocName = "";
    try { activeDocName = String(app.activeDocument.name || ""); } catch (_) {}
    throw new Error("Active InDesign document mismatch: expected " + (expectedDocumentName || sourceDocumentPath || "target document") + ", got " + activeDocName);
  }
  try { app.activeDocument = doc; } catch (_) {}

  var docWasModified = false;
  try { docWasModified = doc.modified === true; } catch (_) {}
  var result = {
    documentName: String(doc.name || ""),
    packageOk: false,
    missingLinksBefore: 0,
    modifiedLinksBefore: 0,
    missingFontsBefore: 0,
    linkCount: 0,
    fontCount: 0,
    docWasModified: docWasModified,
    docModified: false,
    docSaved: false,
    error: ""
  };
  try {
    result.linkCount = collectionLength(doc.links);
    for (var l = 0; l < collectionLength(doc.links); l += 1) {
      if (isProblemLink(doc.links[l])) result.missingLinksBefore += 1;
      if (isModifiedLink(doc.links[l])) result.modifiedLinksBefore += 1;
    }
  } catch (_) {}
  try {
    result.fontCount = collectionLength(doc.fonts);
    for (var f = 0; f < collectionLength(doc.fonts); f += 1) {
      if (isMissingFont(doc.fonts[f])) result.missingFontsBefore += 1;
    }
  } catch (_) {}
  try {
    var packageFolder = Folder(outputFolderPath);
    if (!packageFolder.exists) packageFolder.create();
    var ok;
    try {
      ok = doc.packageForPrint(
        packageFolder,
        copyFonts,
        copyLinkedGraphics,
        copyProfiles,
        updateGraphics,
        includeHiddenLayers,
        ignorePreflightErrors,
        createReport,
        includeIdml,
        includePdf,
        pdfStyle,
        true,
        "Packaged by Underground Circle desktop bridge",
        forceSave
      );
    } catch (modernErr) {
      ok = doc.packageForPrint(
        packageFolder,
        copyFonts,
        copyLinkedGraphics,
        copyProfiles,
        updateGraphics,
        includeHiddenLayers,
        ignorePreflightErrors,
        createReport,
        "Packaged by Underground Circle desktop bridge",
        forceSave
      );
    }
    result.packageOk = ok !== false;
  } catch (err) {
    result.error = err && err.message ? err.message : String(err);
  }
  try { result.docModified = doc.modified === true; } catch (_) {}
  try { result.docSaved = doc.saved === true; } catch (_) {}
  return stringifyPackageResult(result);
}());
`;
  return {
    appName: targetName,
    script: `
tell application "${escapeAppleScriptString(targetName)}"
  activate
  set _ucResult to do script "${escapeAppleScriptString(jsx)}" language javascript
end tell
return _ucResult
`,
  };
}

function resolvePhotoshopScriptTarget(appName) {
  const resolved = resolvePhotoshopMacApp(appName || 'Photoshop') ||
    resolveInstalledMacApp(appName || 'Photoshop') ||
    resolveInstalledMacApp('Adobe Photoshop') ||
    resolveInstalledMacApp('Photoshop');
  const targetName = resolved?.name || String(appName || 'Photoshop').trim();
  if (!targetName || !/photoshop/i.test(targetName)) return null;
  return targetName;
}

function buildPhotoshopAppleScript(targetName, jsx, notRunning) {
  return {
    appName: targetName,
    script: `
if application "${escapeAppleScriptString(targetName)}" is running then
  tell application "${escapeAppleScriptString(targetName)}"
    set _ucResult to do javascript "${escapeAppleScriptString(jsx)}"
  end tell
  return _ucResult
else
  return ${JSON.stringify(notRunning)}
end if
`,
  };
}

function photoshopJsxPrelude({ expectedDocumentName, sourceDocumentPath }) {
  return `
var expectedDocumentName = ${JSON.stringify(String(expectedDocumentName ?? ''))};
var sourceDocumentPath = ${JSON.stringify(String(sourceDocumentPath ?? ''))};

function normalizeDocName(value) {
  return String(value || "").toLowerCase().replace(/\\.[^.]+$/, "").replace(/^\\s+|\\s+$/g, "");
}

function normalizeDocPath(value) {
  try { return File(String(value || "")).fsName.toLowerCase(); } catch (_) {}
  return String(value || "").toLowerCase();
}

function documentPath(value) {
  try { return value.fullName.fsName; } catch (_) { return ""; }
}

function collectionLength(value) {
  try { return value ? value.length : 0; } catch (_) { return 0; }
}

function unitPx(value) {
  try { return Math.round(Number(value.as("px"))); } catch (_) {}
  try { return Math.round(Number(value)); } catch (_) {}
  return 0;
}

function documentMatches(value) {
  if (!value) return false;
  var docName = String(value.name || "");
  if (sourceDocumentPath) {
    var targetPath = normalizeDocPath(sourceDocumentPath);
    var currentPath = normalizeDocPath(documentPath(value));
    if (currentPath && currentPath === targetPath) return true;
    if (normalizeDocName(docName) === normalizeDocName(sourceDocumentPath.split("/").pop())) return true;
  }
  if (expectedDocumentName && normalizeDocName(docName) === normalizeDocName(expectedDocumentName)) return true;
  return !sourceDocumentPath && !expectedDocumentName;
}

function findTargetDocument() {
  try {
    for (var i = 0; i < app.documents.length; i += 1) {
      if (documentMatches(app.documents[i])) return app.documents[i];
    }
  } catch (_) {}
  if (!sourceDocumentPath && !expectedDocumentName && collectionLength(app.documents) > 0) {
    try { return app.activeDocument; } catch (_) {}
  }
  return null;
}

function jsonEscape(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/\\\\/g, "\\\\\\\\")
    .replace(/"/g, "\\\\\\"")
    .replace(/\\r/g, "\\\\r")
    .replace(/\\n/g, "\\\\n")
    .replace(/\\t/g, "\\\\t");
}

function jsonString(value) { return "\\"" + jsonEscape(value) + "\\""; }
function jsonNullableString(value) { return value === undefined || value === null || value === "" ? "null" : jsonString(value); }
function jsonNumber(value) { var parsed = Number(value); return isFinite(parsed) ? String(parsed) : "0"; }
function jsonBoolean(value) { return value === true ? "true" : "false"; }
function jsonArray(values) { return "[" + values.join(",") + "]"; }

function hasActiveSelection(doc) {
  try {
    var bounds = doc.selection.bounds;
    return bounds && bounds.length === 4;
  } catch (_) {
    return false;
  }
}

function layerKindText(layer) {
  try { return String(layer.kind || ""); } catch (_) { return ""; }
}

function isTextLayer(layer) {
  return /text/i.test(layerKindText(layer));
}

function isSmartObjectLayer(layer) {
  return /smart/i.test(layerKindText(layer));
}

function isAdjustmentLayer(layer) {
  var kind = layerKindText(layer).toLowerCase();
  return /(brightness|contrast|curves|levels|exposure|hue|saturation|colorbalance|gradientmap|selectivecolor|threshold|posterize|channelmixer|photofilter|vibrance|blackandwhite|solidfill|gradientfill|patternfill)/.test(kind);
}

function layerLocked(layer) {
  try { if (layer.allLocked === true) return true; } catch (_) {}
  try { if (layer.pixelsLocked === true || layer.positionLocked === true || layer.transparentPixelsLocked === true) return true; } catch (_) {}
  return false;
}

function layerHasMask(layer) {
  try {
    if (!layer.id) return false;
    var ref = new ActionReference();
    ref.putIdentifier(charIDToTypeID("Lyr "), layer.id);
    var desc = executeActionGet(ref);
    if (desc.hasKey(charIDToTypeID("UsrM"))) return true;
    if (desc.hasKey(stringIDToTypeID("hasUserMask"))) return true;
    if (desc.hasKey(stringIDToTypeID("hasVectorMask"))) return true;
  } catch (_) {}
  return false;
}

function layerBounds(layer) {
  var out = [];
  try {
    var bounds = layer.bounds;
    for (var i = 0; i < Math.min(4, bounds.length); i += 1) out.push(unitPx(bounds[i]));
  } catch (_) {}
  return out;
}

function textPreview(layer) {
  if (!isTextLayer(layer)) return "";
  try { return String(layer.textItem.contents || "").replace(/\\s+/g, " ").slice(0, 240); } catch (_) {}
  return "";
}

function layerMatches(layer, pathText, query) {
  if (!query) return true;
  var q = String(query || "").toLowerCase();
  var haystack = [
    String(layer && layer.name ? layer.name : ""),
    String(pathText || ""),
    textPreview(layer),
    layerKindText(layer)
  ].join(" ").toLowerCase();
  return haystack.indexOf(q) >= 0;
}

function walkLayers(parent, prefix, query, maxItems, stats, out, collect) {
  var layers;
  try { layers = parent.layers; } catch (_) { return; }
  var len = collectionLength(layers);
  for (var i = 0; i < len; i += 1) {
    var layer = layers[i];
    var name = "";
    try { name = String(layer.name || ""); } catch (_) {}
    var pathText = prefix ? prefix + " / " + name : name;
    var typename = "";
    try { typename = String(layer.typename || ""); } catch (_) {}
    var kind = layerKindText(layer);
    var isGroup = /LayerSet/i.test(typename);
    var isText = isTextLayer(layer);
    var isSmart = isSmartObjectLayer(layer);
    var isAdjustment = isAdjustmentLayer(layer);
    var hasMask = layerHasMask(layer);
    stats.layerCount += 1;
    if (isGroup) stats.groupCount += 1;
    if (isText) stats.textLayerCount += 1;
    if (isSmart) stats.smartObjectCount += 1;
    if (isAdjustment) stats.adjustmentLayerCount += 1;
    if (hasMask) stats.maskLayerCount += 1;
    try { if (layer.visible === false) stats.hiddenLayers += 1; } catch (_) {}
    if (layerLocked(layer)) stats.lockedLayers += 1;
    if (layerMatches(layer, pathText, query)) {
      stats.matchedLayers += 1;
      if (collect && out.length < maxItems) {
        var bounds = layerBounds(layer);
        var boundValues = [];
        for (var b = 0; b < bounds.length; b += 1) boundValues.push(jsonNumber(bounds[b]));
        out.push("{" + [
          "\\"name\\":" + jsonString(name),
          "\\"path\\":" + jsonString(pathText),
          "\\"type\\":" + jsonString(isGroup ? "group" : "layer"),
          "\\"kind\\":" + jsonString(kind),
          "\\"visible\\":" + jsonBoolean((function () { try { return layer.visible !== false; } catch (_) { return true; } }())),
          "\\"locked\\":" + jsonBoolean(layerLocked(layer)),
          "\\"opacity\\":" + jsonNumber((function () { try { return layer.opacity; } catch (_) { return 0; } }())),
          "\\"textPreview\\":" + jsonString(textPreview(layer)),
          "\\"hasMask\\":" + jsonBoolean(hasMask),
          "\\"bounds\\":" + jsonArray(boundValues),
          "\\"depth\\":" + jsonNumber(prefix ? prefix.split(" / ").length : 0)
        ].join(",") + "}");
      }
    }
    if (isGroup) walkLayers(layer, pathText, query, maxItems, stats, out, collect);
  }
}

function blankLayerStats() {
  return {
    layerCount: 0,
    matchedLayers: 0,
    textLayerCount: 0,
    smartObjectCount: 0,
    adjustmentLayerCount: 0,
    groupCount: 0,
    lockedLayers: 0,
    hiddenLayers: 0,
    maskLayerCount: 0
  };
}

function getLayerStats(doc) {
  var stats = blankLayerStats();
  walkLayers(doc, "", "", 0, stats, [], false);
  return stats;
}
`;
}

function photoshopNotRunningJson(targetName, kind) {
  const base = {
    appRunning: false,
    appName: targetName,
    status: 'not_running',
    documentCount: 0,
    activeDocumentName: null,
    activeDocumentPath: null,
    activeDocumentModified: false,
    activeDocumentSaved: false,
    widthPx: 0,
    heightPx: 0,
    resolution: 0,
    mode: null,
    bitsPerChannel: null,
    layerCount: 0,
    groupCount: 0,
    textLayerCount: 0,
    smartObjectCount: 0,
    adjustmentLayerCount: 0,
    lockedLayers: 0,
    hiddenLayers: 0,
    selectionActive: false,
    documents: [],
    error: null,
  };
  if (kind === 'inventory') {
    return JSON.stringify({
      appRunning: false,
      appName: targetName,
      documentName: null,
      query: '',
      layerCount: 0,
      matchedLayers: 0,
      textLayerCount: 0,
      smartObjectCount: 0,
      adjustmentLayerCount: 0,
      groupCount: 0,
      lockedLayers: 0,
      hiddenLayers: 0,
      selectionActive: false,
      maskLayerCount: 0,
      layers: [],
      error: null,
    });
  }
  if (kind === 'layer_state') {
    return JSON.stringify({
      appRunning: false,
      appName: targetName,
      documentName: null,
      layerName: '',
      action: '',
      matchedLayers: 0,
      changedLayers: 0,
      beforeVisible: false,
      afterVisible: false,
      beforeLocked: false,
      afterLocked: false,
      docWasModified: false,
      docModified: false,
      docSaved: false,
      matches: [],
      error: 'Photoshop is not running.',
    });
  }
  return JSON.stringify(base);
}

function buildPhotoshopDocumentStatusScript({ appName, expectedDocumentName, sourceDocumentPath }) {
  const targetName = resolvePhotoshopScriptTarget(appName);
  if (!targetName) return null;
  const jsx = `
(function () {
${photoshopJsxPrelude({ expectedDocumentName, sourceDocumentPath })}

  function documentSummaryJson(doc) {
    return "{" + [
      "\\"name\\":" + jsonString(doc.name),
      "\\"path\\":" + jsonNullableString(doc.path),
      "\\"modified\\":" + jsonBoolean(doc.modified),
      "\\"saved\\":" + jsonBoolean(doc.saved),
      "\\"widthPx\\":" + jsonNumber(doc.widthPx),
      "\\"heightPx\\":" + jsonNumber(doc.heightPx)
    ].join(",") + "}";
  }

  function makeDocumentSummary(doc) {
    return {
      name: String(doc && doc.name ? doc.name : ""),
      path: documentPath(doc),
      modified: (function () { try { return doc.saved !== true; } catch (_) { return false; } }()),
      saved: (function () { try { return doc.saved === true; } catch (_) { return false; } }()),
      widthPx: (function () { try { return unitPx(doc.width); } catch (_) { return 0; } }()),
      heightPx: (function () { try { return unitPx(doc.height); } catch (_) { return 0; } }())
    };
  }

  function stringifyPhotoshopStatus(value) {
    var docs = [];
    try {
      for (var i = 0; i < value.documents.length; i += 1) docs.push(documentSummaryJson(value.documents[i]));
    } catch (_) {}
    return "{" + [
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"status\\":" + jsonString(value.status),
      "\\"documentCount\\":" + jsonNumber(value.documentCount),
      "\\"activeDocumentName\\":" + jsonNullableString(value.activeDocumentName),
      "\\"activeDocumentPath\\":" + jsonNullableString(value.activeDocumentPath),
      "\\"activeDocumentModified\\":" + jsonBoolean(value.activeDocumentModified),
      "\\"activeDocumentSaved\\":" + jsonBoolean(value.activeDocumentSaved),
      "\\"widthPx\\":" + jsonNumber(value.widthPx),
      "\\"heightPx\\":" + jsonNumber(value.heightPx),
      "\\"resolution\\":" + jsonNumber(value.resolution),
      "\\"mode\\":" + jsonNullableString(value.mode),
      "\\"bitsPerChannel\\":" + jsonNullableString(value.bitsPerChannel),
      "\\"layerCount\\":" + jsonNumber(value.layerCount),
      "\\"groupCount\\":" + jsonNumber(value.groupCount),
      "\\"textLayerCount\\":" + jsonNumber(value.textLayerCount),
      "\\"smartObjectCount\\":" + jsonNumber(value.smartObjectCount),
      "\\"adjustmentLayerCount\\":" + jsonNumber(value.adjustmentLayerCount),
      "\\"lockedLayers\\":" + jsonNumber(value.lockedLayers),
      "\\"hiddenLayers\\":" + jsonNumber(value.hiddenLayers),
      "\\"selectionActive\\":" + jsonBoolean(value.selectionActive),
      "\\"documents\\":" + jsonArray(docs),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var out = {
    appRunning: true,
    appName: String(app.name || "Photoshop"),
    status: "unknown",
    documentCount: collectionLength(app.documents),
    activeDocumentName: null,
    activeDocumentPath: null,
    activeDocumentModified: false,
    activeDocumentSaved: false,
    widthPx: 0,
    heightPx: 0,
    resolution: 0,
    mode: null,
    bitsPerChannel: null,
    layerCount: 0,
    groupCount: 0,
    textLayerCount: 0,
    smartObjectCount: 0,
    adjustmentLayerCount: 0,
    lockedLayers: 0,
    hiddenLayers: 0,
    selectionActive: false,
    documents: [],
    error: null
  };

  try {
    var maxDocs = Math.min(collectionLength(app.documents), 12);
    for (var docIndex = 0; docIndex < maxDocs; docIndex += 1) out.documents.push(makeDocumentSummary(app.documents[docIndex]));
  } catch (_) {}

  if (out.documentCount < 1) {
    out.status = "no_document";
    return stringifyPhotoshopStatus(out);
  }

  var doc = findTargetDocument();
  if (!doc) {
    out.status = "document_mismatch";
    try { out.activeDocumentName = String(app.activeDocument.name || ""); } catch (_) {}
    out.error = "Expected Photoshop document is not active or open.";
    return stringifyPhotoshopStatus(out);
  }
  try { app.activeDocument = doc; } catch (_) {}

  out.activeDocumentName = String(doc.name || "");
  out.activeDocumentPath = documentPath(doc);
  try { out.activeDocumentModified = doc.saved !== true; } catch (_) {}
  try { out.activeDocumentSaved = doc.saved === true; } catch (_) {}
  try { out.widthPx = unitPx(doc.width); } catch (_) {}
  try { out.heightPx = unitPx(doc.height); } catch (_) {}
  try { out.resolution = Number(doc.resolution || 0); } catch (_) {}
  try { out.mode = String(doc.mode || ""); } catch (_) {}
  try { out.bitsPerChannel = String(doc.bitsPerChannel || ""); } catch (_) {}
  out.selectionActive = hasActiveSelection(doc);
  var stats = getLayerStats(doc);
  out.layerCount = stats.layerCount;
  out.groupCount = stats.groupCount;
  out.textLayerCount = stats.textLayerCount;
  out.smartObjectCount = stats.smartObjectCount;
  out.adjustmentLayerCount = stats.adjustmentLayerCount;
  out.lockedLayers = stats.lockedLayers;
  out.hiddenLayers = stats.hiddenLayers;
  out.status = "ready";
  return stringifyPhotoshopStatus(out);
}());
`;
  return buildPhotoshopAppleScript(targetName, jsx, photoshopNotRunningJson(targetName, 'status'));
}

function buildPhotoshopLayerInventoryScript({ appName, query, expectedDocumentName, sourceDocumentPath, maxItems }) {
  const targetName = resolvePhotoshopScriptTarget(appName);
  if (!targetName) return null;
  const jsx = `
(function () {
${photoshopJsxPrelude({ expectedDocumentName, sourceDocumentPath })}
  var query = ${JSON.stringify(String(query ?? ''))};
  var maxItems = Math.max(1, Math.min(120, Number(${JSON.stringify(Number(maxItems || 40))}) || 40));

  function stringifyInventory(value) {
    return "{" + [
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"query\\":" + jsonString(value.query),
      "\\"layerCount\\":" + jsonNumber(value.layerCount),
      "\\"matchedLayers\\":" + jsonNumber(value.matchedLayers),
      "\\"textLayerCount\\":" + jsonNumber(value.textLayerCount),
      "\\"smartObjectCount\\":" + jsonNumber(value.smartObjectCount),
      "\\"adjustmentLayerCount\\":" + jsonNumber(value.adjustmentLayerCount),
      "\\"groupCount\\":" + jsonNumber(value.groupCount),
      "\\"lockedLayers\\":" + jsonNumber(value.lockedLayers),
      "\\"hiddenLayers\\":" + jsonNumber(value.hiddenLayers),
      "\\"selectionActive\\":" + jsonBoolean(value.selectionActive),
      "\\"maskLayerCount\\":" + jsonNumber(value.maskLayerCount),
      "\\"layers\\":" + jsonArray(value.layers),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var out = {
    appRunning: true,
    appName: String(app.name || "Photoshop"),
    documentName: null,
    query: query,
    layerCount: 0,
    matchedLayers: 0,
    textLayerCount: 0,
    smartObjectCount: 0,
    adjustmentLayerCount: 0,
    groupCount: 0,
    lockedLayers: 0,
    hiddenLayers: 0,
    selectionActive: false,
    maskLayerCount: 0,
    layers: [],
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    out.error = "Photoshop is running with no active document.";
    return stringifyInventory(out);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { out.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    out.error = "Expected Photoshop document is not active or open.";
    return stringifyInventory(out);
  }
  try { app.activeDocument = doc; } catch (_) {}
  out.documentName = String(doc.name || "");
  out.selectionActive = hasActiveSelection(doc);
  var stats = blankLayerStats();
  walkLayers(doc, "", query, maxItems, stats, out.layers, true);
  out.layerCount = stats.layerCount;
  out.matchedLayers = stats.matchedLayers;
  out.textLayerCount = stats.textLayerCount;
  out.smartObjectCount = stats.smartObjectCount;
  out.adjustmentLayerCount = stats.adjustmentLayerCount;
  out.groupCount = stats.groupCount;
  out.lockedLayers = stats.lockedLayers;
  out.hiddenLayers = stats.hiddenLayers;
  out.maskLayerCount = stats.maskLayerCount;
  return stringifyInventory(out);
}());
`;
  return buildPhotoshopAppleScript(targetName, jsx, photoshopNotRunningJson(targetName, 'inventory'));
}

function buildPhotoshopSetLayerStateScript({ appName, layerName, action, expectedDocumentName, sourceDocumentPath }) {
  const targetName = resolvePhotoshopScriptTarget(appName);
  if (!targetName) return null;
  const jsx = `
(function () {
${photoshopJsxPrelude({ expectedDocumentName, sourceDocumentPath })}
  var layerName = ${JSON.stringify(String(layerName ?? ''))};
  var action = ${JSON.stringify(String(action ?? ''))};
  if (!layerName) throw new Error("Missing layerName");
  if (!/^(show|hide|lock|unlock)$/.test(action)) throw new Error("Invalid layer action");

  function normalizeLayerName(value) {
    return String(value || "").toLowerCase().replace(/^\\s+|\\s+$/g, "").replace(/\\s+/g, " ");
  }

  function snapshotLayer(layer, pathText) {
    var typename = "";
    try { typename = String(layer.typename || ""); } catch (_) {}
    return {
      name: (function () { try { return String(layer.name || ""); } catch (_) { return ""; } }()),
      path: String(pathText || ""),
      type: /LayerSet/i.test(typename) ? "group" : "layer",
      kind: layerKindText(layer),
      visible: (function () { try { return layer.visible !== false; } catch (_) { return true; } }()),
      locked: layerLocked(layer)
    };
  }

  function layerSnapshotJson(value) {
    return "{" + [
      "\\"name\\":" + jsonString(value.name),
      "\\"path\\":" + jsonString(value.path),
      "\\"type\\":" + jsonString(value.type),
      "\\"kind\\":" + jsonString(value.kind),
      "\\"visible\\":" + jsonBoolean(value.visible),
      "\\"locked\\":" + jsonBoolean(value.locked)
    ].join(",") + "}";
  }

  function stringifyResult(value) {
    var matches = [];
    try {
      for (var i = 0; i < value.matches.length; i += 1) matches.push(layerSnapshotJson(value.matches[i]));
    } catch (_) {}
    return "{" + [
      "\\"appRunning\\":" + jsonBoolean(value.appRunning),
      "\\"appName\\":" + jsonString(value.appName),
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"layerName\\":" + jsonString(value.layerName),
      "\\"action\\":" + jsonString(value.action),
      "\\"matchedLayers\\":" + jsonNumber(value.matchedLayers),
      "\\"changedLayers\\":" + jsonNumber(value.changedLayers),
      "\\"beforeVisible\\":" + jsonBoolean(value.beforeVisible),
      "\\"afterVisible\\":" + jsonBoolean(value.afterVisible),
      "\\"beforeLocked\\":" + jsonBoolean(value.beforeLocked),
      "\\"afterLocked\\":" + jsonBoolean(value.afterLocked),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"matches\\":" + jsonArray(matches),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  function collectMatches(parent, prefix, result) {
    var layers;
    try { layers = parent.layers; } catch (_) { return; }
    var needle = normalizeLayerName(layerName);
    for (var i = 0; i < collectionLength(layers); i += 1) {
      var layer = layers[i];
      var name = "";
      try { name = String(layer.name || ""); } catch (_) {}
      var pathText = prefix ? prefix + " / " + name : name;
      var normalizedName = normalizeLayerName(name);
      var normalizedPath = normalizeLayerName(pathText);
      var row = { layer: layer, path: pathText };
      if (normalizedName === needle || normalizedPath === needle) result.exact.push(row);
      else if (normalizedName.indexOf(needle) >= 0 || normalizedPath.indexOf(needle) >= 0 || (normalizedName && needle.indexOf(normalizedName) >= 0)) result.fuzzy.push(row);
      var typename = "";
      try { typename = String(layer.typename || ""); } catch (_) {}
      if (/LayerSet/i.test(typename)) collectMatches(layer, pathText, result);
    }
  }

  function setLayerLocked(layer, desired) {
    if (desired) {
      try { layer.allLocked = true; return true; } catch (_) {}
      try { layer.pixelsLocked = true; return true; } catch (_) {}
      return false;
    }
    var changed = false;
    try { layer.allLocked = false; changed = true; } catch (_) {}
    try { layer.pixelsLocked = false; changed = true; } catch (_) {}
    try { layer.positionLocked = false; changed = true; } catch (_) {}
    try { layer.transparentPixelsLocked = false; changed = true; } catch (_) {}
    return changed || !layerLocked(layer);
  }

  function applyAction(layer) {
    var before = snapshotLayer(layer, "");
    var error = "";
    try {
      if (action === "show") layer.visible = true;
      if (action === "hide") layer.visible = false;
      if (action === "lock" && !setLayerLocked(layer, true)) error = "Photoshop could not lock the matched layer.";
      if (action === "unlock" && !setLayerLocked(layer, false)) error = "Photoshop could not unlock the matched layer.";
    } catch (err) {
      error = String(err && err.message ? err.message : err);
    }
    var after = snapshotLayer(layer, "");
    return {
      before: before,
      after: after,
      changed: before.visible !== after.visible || before.locked !== after.locked,
      error: error
    };
  }

  var out = {
    appRunning: true,
    appName: String(app.name || "Photoshop"),
    documentName: null,
    layerName: layerName,
    action: action,
    matchedLayers: 0,
    changedLayers: 0,
    beforeVisible: false,
    afterVisible: false,
    beforeLocked: false,
    afterLocked: false,
    docWasModified: false,
    docModified: false,
    docSaved: false,
    matches: [],
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    out.error = "Photoshop is running with no active document.";
    return stringifyResult(out);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { out.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    out.error = "Expected Photoshop document is not active or open.";
    return stringifyResult(out);
  }
  try { app.activeDocument = doc; } catch (_) {}
  out.documentName = String(doc.name || "");
  try { out.docWasModified = doc.saved !== true; } catch (_) {}
  try { out.docSaved = doc.saved === true; } catch (_) {}

  var matchBuckets = { exact: [], fuzzy: [] };
  collectMatches(doc, "", matchBuckets);
  var matches = matchBuckets.exact.length > 0 ? matchBuckets.exact : matchBuckets.fuzzy;
  out.matchedLayers = matches.length;
  for (var m = 0; m < Math.min(matches.length, 12); m += 1) out.matches.push(snapshotLayer(matches[m].layer, matches[m].path));
  if (matches.length < 1) {
    out.error = "No Photoshop layer matched " + layerName + ".";
    try { out.docModified = doc.saved !== true; } catch (_) {}
    try { out.docSaved = doc.saved === true; } catch (_) {}
    return stringifyResult(out);
  }
  if (matches.length > 1) {
    out.error = "Layer target is ambiguous; matched " + matches.length + " layers.";
    try { out.docModified = doc.saved !== true; } catch (_) {}
    try { out.docSaved = doc.saved === true; } catch (_) {}
    return stringifyResult(out);
  }

  var applied = applyAction(matches[0].layer);
  out.changedLayers = applied.changed ? 1 : 0;
  out.beforeVisible = applied.before.visible;
  out.afterVisible = applied.after.visible;
  out.beforeLocked = applied.before.locked;
  out.afterLocked = applied.after.locked;
  out.matches = [snapshotLayer(matches[0].layer, matches[0].path)];
  if (applied.error) out.error = applied.error;
  try { out.docModified = doc.saved !== true; } catch (_) {}
  try { out.docSaved = doc.saved === true; } catch (_) {}
  return stringifyResult(out);
}());
`;
  return buildPhotoshopAppleScript(targetName, jsx, photoshopNotRunningJson(targetName, 'layer_state'));
}

function buildPhotoshopUpdateTextLayerScript({ appName, layerName, replacementText, expectedDocumentName, sourceDocumentPath }) {
  const targetName = resolvePhotoshopScriptTarget(appName);
  if (!targetName) return null;
  const jsx = `
(function () {
${photoshopJsxPrelude({ expectedDocumentName, sourceDocumentPath })}
  var layerName = ${JSON.stringify(String(layerName ?? ''))};
  var replacementText = ${JSON.stringify(String(replacementText ?? ''))};

  function layerNamesJson(values) {
    var out = [];
    for (var i = 0; i < values.length; i += 1) out.push(jsonString(values[i]));
    return jsonArray(out);
  }

  function stringifyResult(value) {
    return "{" + [
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"layerName\\":" + jsonString(value.layerName),
      "\\"replacementText\\":" + jsonString(value.replacementText),
      "\\"matchedLayers\\":" + jsonNumber(value.matchedLayers),
      "\\"updatedLayers\\":" + jsonNumber(value.updatedLayers),
      "\\"replacementMatches\\":" + jsonNumber(value.replacementMatches),
      "\\"layerNames\\":" + layerNamesJson(value.layerNames),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  function updateMatchingTextLayers(parent, prefix, result) {
    var layers;
    try { layers = parent.layers; } catch (_) { return; }
    var q = String(layerName || "").toLowerCase();
    for (var i = 0; i < collectionLength(layers); i += 1) {
      var layer = layers[i];
      var name = "";
      try { name = String(layer.name || ""); } catch (_) {}
      var pathText = prefix ? prefix + " / " + name : name;
      var typename = "";
      try { typename = String(layer.typename || ""); } catch (_) {}
      if (/LayerSet/i.test(typename)) {
        updateMatchingTextLayers(layer, pathText, result);
        continue;
      }
      if (!isTextLayer(layer)) continue;
      var preview = textPreview(layer);
      var haystack = (name + " " + pathText + " " + preview).toLowerCase();
      if (haystack.indexOf(q) < 0) continue;
      result.matchedLayers += 1;
      result.layerNames.push(pathText);
      try {
        layer.textItem.contents = replacementText;
        result.updatedLayers += 1;
      } catch (err) {
        result.error = String(err && err.message ? err.message : err);
      }
    }
  }

  function countTextLayersWithContents(parent, expectedText) {
    var count = 0;
    var layers;
    try { layers = parent.layers; } catch (_) { return 0; }
    for (var i = 0; i < collectionLength(layers); i += 1) {
      var layer = layers[i];
      var typename = "";
      try { typename = String(layer.typename || ""); } catch (_) {}
      if (/LayerSet/i.test(typename)) {
        count += countTextLayersWithContents(layer, expectedText);
        continue;
      }
      if (!isTextLayer(layer)) continue;
      try {
        if (String(layer.textItem.contents || "") === String(expectedText || "")) count += 1;
      } catch (_) {}
    }
    return count;
  }

  var result = {
    documentName: null,
    layerName: layerName,
    replacementText: replacementText,
    matchedLayers: 0,
    updatedLayers: 0,
    replacementMatches: 0,
    layerNames: [],
    docWasModified: false,
    docModified: false,
    docSaved: false,
    error: null
  };

  if (collectionLength(app.documents) < 1) {
    result.error = "Photoshop is running with no active document.";
    return stringifyResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "Expected Photoshop document is not active or open.";
    return stringifyResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");
  try { result.docWasModified = doc.saved !== true; } catch (_) {}
  updateMatchingTextLayers(doc, "", result);
  result.replacementMatches = countTextLayersWithContents(doc, replacementText);
  try { result.docModified = doc.saved !== true; } catch (_) {}
  try { result.docSaved = doc.saved === true; } catch (_) {}
  return stringifyResult(result);
}());
`;
  return buildPhotoshopAppleScript(targetName, jsx, photoshopNotRunningJson(targetName, 'status'));
}

function buildPhotoshopPlaceAssetScript({ appName, assetPath, layerName, expectedDocumentName, sourceDocumentPath }) {
  const targetName = resolvePhotoshopScriptTarget(appName);
  if (!targetName) return null;
  const jsx = `
(function () {
${photoshopJsxPrelude({ expectedDocumentName, sourceDocumentPath })}
  var assetPath = ${JSON.stringify(String(assetPath ?? ''))};
  var layerName = ${JSON.stringify(String(layerName ?? ''))};

  function stringifyResult(value) {
    return "{" + [
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"placedLayerName\\":" + jsonNullableString(value.placedLayerName),
      "\\"docWasModified\\":" + jsonBoolean(value.docWasModified),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var result = {
    documentName: null,
    placedLayerName: null,
    docWasModified: false,
    docModified: false,
    docSaved: false,
    error: null
  };
  if (collectionLength(app.documents) < 1) {
    result.error = "Photoshop is running with no active document.";
    return stringifyResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "Expected Photoshop document is not active or open.";
    return stringifyResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");
  try { result.docWasModified = doc.saved !== true; } catch (_) {}
  try {
    var file = new File(assetPath);
    if (!file.exists) {
      result.error = "Asset file does not exist.";
      return stringifyResult(result);
    }
    var desc = new ActionDescriptor();
    desc.putPath(charIDToTypeID("null"), file);
    executeAction(charIDToTypeID("Plc "), desc, DialogModes.NO);
    try {
      if (layerName) app.activeDocument.activeLayer.name = layerName;
      result.placedLayerName = String(app.activeDocument.activeLayer.name || layerName || file.displayName || file.name || "Placed asset");
    } catch (_) {
      result.placedLayerName = layerName || file.displayName || file.name || "Placed asset";
    }
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
  try { result.docModified = doc.saved !== true; } catch (_) {}
  try { result.docSaved = doc.saved === true; } catch (_) {}
  return stringifyResult(result);
}());
`;
  return buildPhotoshopAppleScript(targetName, jsx, photoshopNotRunningJson(targetName, 'status'));
}

function buildPhotoshopExportProofScript({ appName, outputPath, format, quality, expectedDocumentName, sourceDocumentPath }) {
  const targetName = resolvePhotoshopScriptTarget(appName);
  if (!targetName) return null;
  const jsx = `
(function () {
${photoshopJsxPrelude({ expectedDocumentName, sourceDocumentPath })}
  var outputPath = ${JSON.stringify(String(outputPath ?? ''))};
  var format = ${JSON.stringify(String(format || 'png').toLowerCase())};
  var quality = Math.max(1, Math.min(12, Number(${JSON.stringify(Number(quality || 10))}) || 10));

  function stringifyResult(value) {
    return "{" + [
      "\\"documentName\\":" + jsonNullableString(value.documentName),
      "\\"widthPx\\":" + jsonNumber(value.widthPx),
      "\\"heightPx\\":" + jsonNumber(value.heightPx),
      "\\"docModified\\":" + jsonBoolean(value.docModified),
      "\\"docSaved\\":" + jsonBoolean(value.docSaved),
      "\\"error\\":" + jsonNullableString(value.error)
    ].join(",") + "}";
  }

  var result = {
    documentName: null,
    widthPx: 0,
    heightPx: 0,
    docModified: false,
    docSaved: false,
    error: null
  };
  if (collectionLength(app.documents) < 1) {
    result.error = "Photoshop is running with no active document.";
    return stringifyResult(result);
  }
  var doc = findTargetDocument();
  if (!doc) {
    try { result.documentName = String(app.activeDocument.name || ""); } catch (_) {}
    result.error = "Expected Photoshop document is not active or open.";
    return stringifyResult(result);
  }
  try { app.activeDocument = doc; } catch (_) {}
  result.documentName = String(doc.name || "");
  try { result.widthPx = unitPx(doc.width); } catch (_) {}
  try { result.heightPx = unitPx(doc.height); } catch (_) {}
  try {
    var outFile = new File(outputPath);
    if (format === "jpg" || format === "jpeg") {
      var jpg = new JPEGSaveOptions();
      jpg.quality = quality;
      doc.saveAs(outFile, jpg, true, Extension.LOWERCASE);
    } else {
      var png = new PNGSaveOptions();
      doc.saveAs(outFile, png, true, Extension.LOWERCASE);
    }
  } catch (err) {
    result.error = String(err && err.message ? err.message : err);
  }
  try { result.docModified = doc.saved !== true; } catch (_) {}
  try { result.docSaved = doc.saved === true; } catch (_) {}
  return stringifyResult(result);
}());
`;
  return buildPhotoshopAppleScript(targetName, jsx, photoshopNotRunningJson(targetName, 'status'));
}

function getOrCreateDesktopToken() {
  const tokenPath = path.join(os.homedir(), '.uc-desktop-token');
  try {
    if (fs.existsSync(tokenPath)) {
      const existing = fs.readFileSync(tokenPath, 'utf-8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch {}
  const crypto = require('crypto');
  const token = crypto.randomBytes(24).toString('hex');
  try {
    fs.writeFileSync(tokenPath, token + '\n', { mode: 0o600 });
  } catch (err) {
    console.warn('[bridge] could not persist desktop token:', err.message);
  }
  return token;
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} already in use. Kill it with: lsof -ti:${PORT} | xargs kill -9`);
    process.exit(1);
  }
  console.error('[bridge] Server error:', err.message);
});

process.on('uncaughtException', (err) => console.error('[bridge] Uncaught:', err.message));

/**
 * Auto-compile the Swift AX helper if we're on macOS, the source file
 * exists, and the binary is missing or older than the source. Silent
 * pass-through on other platforms; we log but don't fail boot so the
 * bridge still serves the non-AX endpoints.
 *
 * Why compile at boot: the binary is gitignored (machine-specific
 * arch) and npm users shouldn't need a separate build step. First
 * `npm run bridge` after a pull does the work once.
 */
function ensureAxHelper() {
  if (process.platform !== 'darwin') return;
  const src = path.join(__dirname, 'bin', 'uc-ax-helper.swift');
  const bin = path.join(__dirname, 'bin', 'uc-ax-helper');
  if (!fs.existsSync(src)) return;
  try {
    const srcStat = fs.statSync(src);
    const binStat = fs.existsSync(bin) ? fs.statSync(bin) : null;
    if (binStat && binStat.mtimeMs >= srcStat.mtimeMs) return; // up to date
  } catch {}
  try {
    console.log('[bridge] Compiling uc-ax-helper (one-time, ~2s)…');
    execFileSync('swiftc', ['-O', '-o', bin, src], { stdio: 'pipe', timeout: 30_000 });
    fs.chmodSync(bin, 0o755);
    console.log('[bridge] ✓ uc-ax-helper ready at', bin);
  } catch (err) {
    console.warn('[bridge] Could not compile uc-ax-helper:', err.message);
    console.warn('[bridge] /desktop/a11y_tree will return 503 until the helper is built.');
    console.warn('[bridge] Install Xcode command-line tools: xcode-select --install');
  }
}
ensureAxHelper();

function ensureInputHelper() {
  if (process.platform !== 'darwin') return;
  const src = path.join(__dirname, 'bin', 'uc-input-helper.swift');
  const bin = path.join(__dirname, 'bin', 'uc-input-helper');
  if (!fs.existsSync(src)) return;
  try {
    const srcStat = fs.statSync(src);
    const binStat = fs.existsSync(bin) ? fs.statSync(bin) : null;
    if (binStat && binStat.mtimeMs >= srcStat.mtimeMs) return;
  } catch {}
  try {
    console.log('[bridge] Compiling uc-input-helper (one-time, ~2s)…');
    execFileSync('swiftc', ['-O', '-o', bin, src], { stdio: 'pipe', timeout: 30_000 });
    fs.chmodSync(bin, 0o755);
    console.log('[bridge] ✓ uc-input-helper ready at', bin);
  } catch (err) {
    console.warn('[bridge] Could not compile uc-input-helper:', err.message);
    console.warn('[bridge] /desktop/mouse_scroll will return 503 until the helper is built.');
    console.warn('[bridge] Install Xcode command-line tools: xcode-select --install');
  }
}
ensureInputHelper();

server.listen(PORT, () => {
  console.log(`\n  Claude Code Bridge`);
  console.log(`  Serving on http://localhost:${PORT}`);
  console.log(`  Scanning ${CLAUDE_DIRS.join(", ")}`);
  console.log(`  Found ${cachedSessions.length} active session(s)\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /health              — Bridge status`);
  console.log(`    GET  /sessions            — Active Claude Code sessions`);
  console.log(`    POST /exec                — Run a shell command
    POST /launch              — Launch visible Claude Code terminal sessions
    POST /terminal/send       — Send a chat instruction to a managed terminal session
    POST /spawn               — Spawn a new Claude Code session with a task`);
  console.log(`    GET  /devices             — Discover all connected devices`);
  console.log(`    GET  /devices/printers    — List printers with status`);
  console.log(`    POST /devices/print       — Print a file or text`);
  console.log(`    GET  /devices/serial      — List serial ports`);
  console.log(`    POST /devices/serial/send — Send data to serial port`);
  console.log(`    GET  /devices/3dprinter   — Detect 3D printer services`);
  console.log(`    POST /devices/3dprinter/command — Send G-code`);
  console.log(`    GET  /devices/network     — Scan local network\n`);
});
