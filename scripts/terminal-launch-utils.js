const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile, execFileSync } = require('child_process');

const MAX_LAUNCH_COUNT = 20;
const TERMINAL_SESSION_REGISTRY = path.join(osHomeDir(), '.uc-terminal-agent-sessions.json');
const OPENSWAN_WORKTREE_CONFIG_MARKER = '## SwanBot/OpenSwan Worktree Config';

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
  // Escape order matters: backslash FIRST, then the double quote, or the
  // backslashes introduced by the quote step get double-escaped and the
  // literal reopens.
  //
  // The line-terminator class must include a BARE \r. `\r?\n` leaves a lone
  // carriage return untouched, and AppleScript treats CR as a statement
  // terminator, so an unescaped one makes the generated script fail to
  // compile. That is a launch/send denial of service rather than an injection
  // (the double quote is still escaped, so the string cannot be closed), but
  // it is reachable from fields that skip normalizeCliPrompt.
  return `"${String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r\n|[\r\n\u2028\u2029]/g, '\\n')}"`;
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

function looksLikeOpenSwanRepo(projectDir) {
  const dir = safeProjectDir(projectDir);
  return fs.existsSync(path.join(dir, 'AGENTS.md'))
    && fs.existsSync(path.join(dir, 'docs', 'AGENTS_ROADMAP.md'));
}

function readOpenSwanWorktreeConfigPrompt(projectDir) {
  const repoRoot = path.resolve(__dirname, '..');
  const reportPath = path.join(__dirname, 'openswan-worktree-config-report.ts');
  if (!fs.existsSync(reportPath)) return '';
  const dir = safeProjectDir(projectDir);
  if (!looksLikeOpenSwanRepo(dir)) return '';
  try {
    return execFileSync('npx', ['tsx', reportPath, '--prompt', '--repo', dir], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 256 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function appendOpenSwanWorktreeConfigPrompt(prompt, projectDir) {
  const cleanPrompt = normalizeCliPrompt(prompt);
  if (!cleanPrompt || cleanPrompt.includes(OPENSWAN_WORKTREE_CONFIG_MARKER)) return cleanPrompt;
  if (String(process.env.UC_DISABLE_OPENSWAN_WORKTREE_CONFIG || '').trim() === '1') return cleanPrompt;
  const configBlock = readOpenSwanWorktreeConfigPrompt(projectDir);
  if (!configBlock || !configBlock.includes(OPENSWAN_WORKTREE_CONFIG_MARKER)) return cleanPrompt;
  return [
    cleanPrompt,
    '',
    'Hidden SwanBot/OpenSwan worktree configuration for this launched agent:',
    configBlock,
  ].join('\n');
}

// Git-worktree isolation for a launched agent. When `useWorktree` is set, each
// session gets its own `.openswan-worktrees/openswan-agent-<ts>-<i>` checkout on
// a fresh branch off HEAD, so parallel/risky edits never collide with the shared
// tree. Fail-open: any git failure falls back to the shared workspace so a
// launch is never blocked by worktree trouble. Uses execFileSync (no shell) to
// avoid injection from the cwd path.
function ensureOpenSwanWorktree({ baseCwd, useWorktree = false, index = 0, label = 'openswan-agent' } = {}) {
  const resolvedBase = safeProjectDir(baseCwd);
  if (!useWorktree) {
    return { cwd: resolvedBase, isWorktree: false, branch: null, worktreeDir: null };
  }
  try {
    const branch = `${label}-${Date.now()}-${index}`;
    const worktreeDir = path.join(resolvedBase, '.openswan-worktrees', branch);
    fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });
    try {
      // New branch off the current HEAD.
      execFileSync('git', ['worktree', 'add', worktreeDir, '-b', branch, 'HEAD'], {
        cwd: resolvedBase, timeout: 20_000, stdio: ['ignore', 'ignore', 'ignore'],
      });
    } catch {
      // The branch may already exist — attach a worktree to it instead.
      execFileSync('git', ['worktree', 'add', worktreeDir, branch], {
        cwd: resolvedBase, timeout: 20_000, stdio: ['ignore', 'ignore', 'ignore'],
      });
    }
    return { cwd: worktreeDir, isWorktree: true, branch, worktreeDir };
  } catch (err) {
    console.warn('[worktree] creation failed, using shared workspace:', err && err.message ? err.message : err);
    return { cwd: resolvedBase, isWorktree: false, branch: null, worktreeDir: null };
  }
}

// Remove a single OpenSwan worktree. Non-force by design: git refuses to remove
// a worktree with uncommitted changes, which protects an agent's unsaved work.
// Pass force:true only when the caller has confirmed the work is disposable.
function removeOpenSwanWorktree(baseCwd, worktreeDir, { force = false } = {}) {
  const resolvedBase = safeProjectDir(baseCwd);
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreeDir);
  execFileSync('git', args, { cwd: resolvedBase, timeout: 20_000, stdio: ['ignore', 'ignore', 'ignore'] });
}

// Reclaim finished OpenSwan worktrees safely. First prunes stale admin entries
// (dirs already deleted), then removes each `.openswan-worktrees/*` worktree
// that git considers clean. Dirty/in-use worktrees are KEPT (the remove throws
// and we swallow it), so unsaved agent work is never destroyed. Returns the
// lists of removed and kept worktree dirs.
function pruneOpenSwanWorktrees(baseCwd, { force = false } = {}) {
  const resolvedBase = safeProjectDir(baseCwd);
  const removed = [];
  const kept = [];
  try {
    execFileSync('git', ['worktree', 'prune'], { cwd: resolvedBase, timeout: 20_000, stdio: ['ignore', 'ignore', 'ignore'] });
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: resolvedBase, encoding: 'utf8', timeout: 20_000,
    });
    // Repo-scoped exact prefix so we never touch a coincidentally-named
    // foreign worktree (e.g. `.openswan-worktrees-backup/`) or one in another repo.
    const worktreeRoot = `${path.join(resolvedBase, '.openswan-worktrees')}${path.sep}`;
    const dirs = out.split('\n')
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length).trim())
      .filter((dir) => dir.startsWith(worktreeRoot));
    for (const dir of dirs) {
      try {
        removeOpenSwanWorktree(resolvedBase, dir, { force });
        removed.push(dir);
      } catch {
        kept.push(dir); // dirty or in-use — leave it to protect unsaved work
      }
    }
  } catch (err) {
    console.warn('[worktree] prune failed:', err && err.message ? err.message : err);
  }
  return { removed, kept };
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

function requestUsesLoopbackHost(req) {
  const hostHeader = String(req?.headers?.host || '').trim();
  if (!hostHeader || /[\s/@\\]/.test(hostHeader)) return false;
  try {
    const hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]';
  } catch {
    return false;
  }
}

function isAllowedPairOrigin(req) {
  const origin = String(req?.headers?.origin || '').trim();
  const loopbackHost = requestUsesLoopbackHost(req);
  if (!origin) return loopbackHost;
  const configuredOrigins = String(process.env.UC_BRIDGE_ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (configuredOrigins.includes(origin)) return true;
  // Implicit browser origins are valid only when the bridge itself is reached
  // by a loopback Host. Tunnel Hosts require an exact configured origin.
  if (!loopbackHost) return false;
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    const isLocalhost = host === 'localhost'
      || host === '127.0.0.1'
      || host === '::1'
      || host === '[::1]';
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && isLocalhost) return true;
    if (parsed.protocol === 'https:' && host === 'app.chrisswanson.xyz') return true;
  } catch {
    return false;
  }
  return false;
}

module.exports = {
  MAX_LAUNCH_COUNT,
  shellQuote,
  shellTextArg,
  clampLaunchCount,
  normalizeCliPrompt,
  appendOpenSwanWorktreeConfigPrompt,
  ensureOpenSwanWorktree,
  removeOpenSwanWorktree,
  pruneOpenSwanWorktrees,
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
