const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const MAX_LAUNCH_COUNT = 20;
const TERMINAL_SESSION_REGISTRY = path.join(osHomeDir(), '.uc-terminal-agent-sessions.json');

function osHomeDir() {
  try { return require('os').homedir(); } catch { return process.env.HOME || process.cwd(); }
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
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function safeProjectDir(input, fallback = process.cwd()) {
  const candidate = input ? path.resolve(String(input)) : fallback;
  try {
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) return candidate;
  } catch {}
  return fallback;
}

function makeLaunchId(prefix) {
  return `${prefix || 'terminal-agent-launch'}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
}

function makeTerminalTitle(providerLabel, displayName, sessionId) {
  const safeProvider = String(providerLabel || 'Agent').replace(/\s+/g, ' ').trim();
  const safeName = String(displayName || safeProvider).replace(/\s+/g, ' ').trim();
  const safeSession = String(sessionId || '').replace(/[^\w.-]/g, '').slice(-16);
  return `[UC] ${safeProvider} · ${safeName}${safeSession ? ` · ${safeSession}` : ''}`;
}

function readTerminalSessionRegistry() {
  try {
    if (!fs.existsSync(TERMINAL_SESSION_REGISTRY)) return [];
    const parsed = JSON.parse(fs.readFileSync(TERMINAL_SESSION_REGISTRY, 'utf8'));
    return Array.isArray(parsed?.sessions) ? parsed.sessions : [];
  } catch {
    return [];
  }
}

function writeTerminalSessionRegistry(sessions) {
  try {
    fs.writeFileSync(
      TERMINAL_SESSION_REGISTRY,
      JSON.stringify({ version: 1, sessions }, null, 2),
      { mode: 0o600 },
    );
  } catch {
    /* best-effort local registry */
  }
}

function loadManagedTerminalSessions(provider) {
  const providerKey = String(provider || '').toLowerCase();
  return readTerminalSessionRegistry().filter((session) => String(session.provider || '').toLowerCase() === providerKey);
}

function saveManagedTerminalSession(provider, session) {
  if (!session?.sessionId) return;
  const providerKey = String(provider || '').toLowerCase();
  const sessions = readTerminalSessionRegistry();
  const record = {
    ...session,
    provider: providerKey,
    savedAt: new Date().toISOString(),
  };
  const idx = sessions.findIndex((item) =>
    String(item.provider || '').toLowerCase() === providerKey
    && String(item.sessionId || '') === String(session.sessionId)
  );
  if (idx >= 0) sessions[idx] = record;
  else sessions.push(record);
  writeTerminalSessionRegistry(sessions.slice(-100));
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
    const terminalTitle = String(title || 'UC Agent Terminal');
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
    const shell = process.env.SHELL || 'bash';
    const holdCommand = `${command}; printf '\\n[The Underground Circle] Session exited. Press Ctrl-D to close.\\n'; exec ${shell}`;
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

function runOsascript(lines, timeoutMs = 5000) {
  return new Promise((resolve) => {
    execFile('osascript', lines.flatMap((line) => ['-e', line]), { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        resolve({ ok: false, error: stderr?.trim() || error.message });
        return;
      }
      resolve({ ok: true, stdout: stdout.trim() });
    });
  });
}

async function sendToTerminalByTitle(terminalTitle, message) {
  if (process.platform !== 'darwin') {
    return { ok: false, error: 'Sending to an existing terminal session is currently supported on macOS Terminal.app only.' };
  }
  const title = String(terminalTitle || '').trim();
  if (!title) return { ok: false, error: 'Missing terminal title for this managed session.' };

  const result = await runOsascript([
    'tell application "Terminal"',
    'activate',
    `set targetTitle to ${appleScriptString(title)}`,
    `set payload to ${appleScriptString(message)}`,
    'repeat with w in windows',
    'repeat with t in tabs of w',
    'try',
    'if (custom title of t as text) is targetTitle then',
    'set selected tab of w to t',
    'set index of w to 1',
    'do script payload in t',
    'return "ok"',
    'end if',
    'end try',
    'end repeat',
    'end repeat',
    'return "not_found"',
    'end tell',
  ]);

  if (!result.ok) return result;
  if (result.stdout === 'ok') return { ok: true };
  return { ok: false, error: `Terminal tab not found for "${title}". The tab may have been closed or renamed.` };
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

function isAllowedPairOrigin(req) {
  const origin = String(req?.headers?.origin || '');
  if (!origin) return true;
  if (origin.startsWith('http://localhost')) return true;
  if (origin.startsWith('http://127.0.0.1')) return true;
  if (origin === 'https://app.chrisswanson.xyz') return true;
  return false;
}

module.exports = {
  MAX_LAUNCH_COUNT,
  shellQuote,
  shellTextArg,
  clampLaunchCount,
  normalizeCliPrompt,
  promptPreview,
  safeProjectDir,
  makeLaunchId,
  makeTerminalTitle,
  loadManagedTerminalSessions,
  saveManagedTerminalSession,
  openTerminal,
  sendToTerminalByTitle,
  readJsonBody,
  isAllowedPairOrigin,
};
