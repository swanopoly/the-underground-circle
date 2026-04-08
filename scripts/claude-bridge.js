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
const { exec, execSync } = require('child_process');

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
  'Access-Control-Allow-Headers': 'Content-Type',
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

        // Capture last user message
        if (entry.type === 'human' && entry.message) {
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


  // ── POST /spawn — spawn a new Claude Code session with a task ──────────────
  if (url === '/spawn' && req.method === 'POST') {
    let body = '';
    req.on('data', c => { body += c; if (body.length > 64000) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); } catch { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'Invalid JSON' })); return; }
      const { task, model, workdir } = parsed;
      if (!task) { res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'Missing task' })); return; }

      const cwd = workdir || process.cwd();
      const modelFlag = model ? `--model ${model}` : '';
      // Spawn claude in background with the task as prompt, capture session output
      const escaped = task.replace(/'/g, "'\\''");
      const cmd = `cd "${cwd}" && nohup claude ${modelFlag} --dangerously-skip-permissions -p "${escaped}" > /tmp/claude-spawn-$$.log 2>&1 & echo $!`;

      const { exec } = require('child_process');
      exec(cmd, { timeout: 10000, shell: '/bin/bash' }, (err, stdout, stderr) => {
        if (err) {
          res.writeHead(500, CORS);
          res.end(JSON.stringify({ ok: false, error: err.message }));
          return;
        }
        const pid = stdout.trim();
        res.writeHead(200, CORS);
        res.end(JSON.stringify({
          ok: true,
          pid,
          message: `Spawned Claude Code session (PID ${pid}) with task: ${task.slice(0, 100)}`,
        }));
      });
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
  res.writeHead(404, CORS);
  res.end(JSON.stringify({ error: 'Not found. Use /health, /sessions, /exec, /devices/*, or /mcp' }));
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
