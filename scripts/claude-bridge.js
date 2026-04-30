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
const { exec, execSync, execFile, execFileSync } = require('child_process');

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

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  // IMPORTANT: `X-UC-Desktop-Token` must appear here — the browser's
  // CORS preflight rejects any /desktop/* call without it. Missing
  // this was the source of "it still can't open apps" bugs even
  // after the bridge was running + paired, because every authed call
  // died silently at the preflight layer. If you add another custom
  // request header on the client side, list it here too.
  'Access-Control-Allow-Headers': 'Content-Type, X-UC-Desktop-Token',
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

let cachedSessions = [];
let lastScanTime = '';

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
  return sessions;
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
        let cwd = baseCwd;

        // Optional: git worktree isolation per agent
        if (useWorktree) {
          try {
            const branch = `openswan-agent-${Date.now()}-${i}`;
            const worktreeDir = path.join(baseCwd, '.openswan-worktrees', branch);
            execSync(`mkdir -p "${path.dirname(worktreeDir)}"`, { cwd: baseCwd });
            execSync(`git worktree add "${worktreeDir}" -b "${branch}" HEAD 2>/dev/null || git worktree add "${worktreeDir}" "${branch}" 2>/dev/null`, { cwd: baseCwd, timeout: 15000 });
            cwd = worktreeDir;
          } catch (wtErr) {
            // Fall back to shared workspace if worktree fails
            console.warn(`[spawn] Worktree creation failed for agent ${i}:`, wtErr.message);
          }
        }

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
        ? ['launch', 'focus', 'type', 'keys', 'running_apps', 'screenshot', 'wait_for_app', 'open_url', 'open_path', 'click_at', 'screen_size',
           ...(fs.existsSync(path.join(__dirname, 'bin', 'uc-ax-helper')) ? ['a11y_tree', 'click_element'] : [])]
        : [],
      // Surface whether the more-reliable click backend is available
      // so clients can decide whether to attempt `click_at` at all.
      optional: {
        cliclick: desktopToolsHas('cliclick'),
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
      // Require an explicit `Origin` header hint that we recognise to
      // stop random arbitrary-origin websites from issuing the pair
      // call in the background. Browsers send Origin on cross-origin
      // POSTs; CLI tools can send the header explicitly.
      const origin = String(req.headers.origin || '');
      const originAllowed = origin === ''
        || origin.startsWith('http://localhost')
        || origin.startsWith('http://127.0.0.1')
        || origin === 'https://app.chrisswanson.xyz';
      if (!originAllowed) {
        res.writeHead(403, CORS);
        res.end(JSON.stringify({ ok: false, error: 'Pairing origin not allowlisted.' }));
        return;
      }
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

    if (url === '/desktop/launch' && req.method === 'POST') {
      readJsonBody(req, 2048, (parsed, bodyErr) => {
        if (bodyErr) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: bodyErr })); return; }
        const appName = String(parsed?.appName || '').trim();
        if (!appName || !/^[A-Za-z0-9 .\-_()]+$/.test(appName)) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: 'Invalid appName. Letters, numbers, spaces, . - _ ( ) only.' }));
          return;
        }
        exec(`open -a ${shellSingleQuote(appName)}`, { timeout: 5000 }, (err) => {
          if (err) {
            const msg = /not found/i.test(err.message) ? 'app_not_found' : err.message;
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: msg }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, appName }));
        });
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
        const script = `tell application ${shellSingleQuote('"' + appName + '"')} to activate`;
        exec(`osascript -e ${shellSingleQuote(script)}`, { timeout: 5000 }, (err) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: err.message }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, appName }));
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
        const validated = validateDesktopPathServer(raw);
        if (!validated.ok) {
          res.writeHead(400, CORS);
          res.end(JSON.stringify({ ok: false, error: validated.error }));
          return;
        }
        exec(`open ${shellSingleQuote(validated.path)}`, { timeout: 5000 }, (err) => {
          if (err) {
            res.writeHead(400, CORS);
            res.end(JSON.stringify({ ok: false, error: /does not exist|no such file/i.test(err.message) ? 'path_not_found' : err.message }));
            return;
          }
          res.writeHead(200, CORS);
          res.end(JSON.stringify({ ok: true, path: validated.path }));
        });
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
      if (p === '/browser/click_role' && req.method === 'POST') return browserBridge.handleClickRole(req, res, CORS);
      if (p === '/browser/fill' && req.method === 'POST') return browserBridge.handleFill(req, res, CORS);
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
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100,
  f9: 101, f10: 109, f11: 103, f12: 111,
};

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
  if (/^[a-zA-Z0-9]$/.test(key)) {
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

server.listen(PORT, () => {
  console.log(`\n  Claude Code Bridge`);
  console.log(`  Serving on http://localhost:${PORT}`);
  console.log(`  Scanning ${CLAUDE_DIRS.join(", ")}`);
  console.log(`  Found ${cachedSessions.length} active session(s)\n`);
  console.log(`  Endpoints:`);
  console.log(`    GET  /health              — Bridge status`);
  console.log(`    GET  /sessions            — Active Claude Code sessions`);
  console.log(`    POST /exec                — Run a shell command
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
