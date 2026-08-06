'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1']);
const EXEC_BLOCKED_BINARIES = new Set([
  'sudo', 'doas', 'su', 'shutdown', 'reboot', 'halt', 'poweroff',
  'mkfs', 'diskutil', 'dd', 'launchctl', 'nvram', 'csrutil', 'fdisk',
  // `execFile` avoids shell interpolation only when the executable itself is
  // not a shell. Keep shells and the `env` indirection utility out of this
  // generic coding endpoint; dedicated, policy-gated tools own shell work.
  'sh', 'bash', 'zsh', 'dash', 'fish', 'ksh', 'csh', 'tcsh', 'ash', 'yash',
  'mksh', 'rc', 'nu', 'elvish', 'powershell', 'powershell.exe', 'pwsh',
  'pwsh.exe', 'cmd', 'cmd.exe', 'env',
]);
const SAFE_GIT_BINARY = fs.existsSync('/usr/bin/git') ? '/usr/bin/git' : null;

// Git config keys whose VALUES git executes as commands. A repository-local
// config that defines any of these turns this "read-only diagnostic" endpoint
// into arbitrary command execution as the user.
//
// This is not theoretical. Verified empirically against git 2.50.1 with the
// exact hardened argv this module emits: `git diff --no-ext-diff --no-textconv
// --stat` RUNS `filter.<name>.clean` for any path whose .gitattributes assigns
// that filter, because git must clean the worktree copy to compare it against
// the index. `--no-ext-diff` and `--no-textconv` suppress diff DRIVERS; they do
// not suppress content FILTERS. `status`, `log`, `ls-files`, `rev-parse`, and
// `branch` did not execute the filter, but `diff --stat`, `--name-only`, and
// `--check` all did.
//
// There is no git flag that disables in-repo .gitattributes or wildcards a
// filter driver off, so the only sound guard is to refuse the invocation when
// the repository defines an executable key at all. Matching is done on the
// lowercased `section.subsection.key` form because git treats section and key
// names case-insensitively.
const GIT_UNSAFE_CONFIG_KEY_RE = new RegExp([
  // The `(?:.*\.)?` arm also catches the subsection-less spellings, which git
  // ignores today but which cost nothing to refuse.
  '^filter\\.(?:.*\\.)?(?:clean|smudge|process)$',
  '^diff\\.(?:.*\\.)?(?:textconv|command)$',
  '^diff\\.external$',
  '^merge\\.(?:.*\\.)?driver$',
  '^core\\.(?:fsmonitor|hookspath|pager|editor|sshcommand|askpass|alternaterefscommand)$',
  '^sequence\\.editor$',
  '^uploadpack\\.packobjectshook$',
  // An include can pull any of the above in from a path we did not scan.
  '^include\\.path$',
  '^includeif\\..*$',
].join('|'));

/**
 * Parses a git-config INI body into lowercased `section.subsection.key` names.
 * Values are deliberately ignored — presence of the key is what we refuse on.
 * Unparseable input yields the sentinel `?` so callers fail closed.
 */
function parseGitConfigKeyNames(text) {
  const names = [];
  let section = '';
  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[([^\]]*)\]$/.exec(line);
    if (header) {
      const inner = header[1].trim();
      const withSub = /^([A-Za-z0-9.-]+)\s+"(.*)"$/.exec(inner);
      if (withSub) {
        section = `${withSub[1].toLowerCase()}.${withSub[2]}`;
      } else if (/^[A-Za-z0-9.-]+$/.test(inner)) {
        section = inner.toLowerCase();
      } else {
        // A header we cannot model (subsection with escapes, etc.) must not
        // silently widen the scan — mark it unknown so the audit refuses.
        names.push('?');
        section = '?';
      }
      continue;
    }
    const assignment = /^([A-Za-z0-9][A-Za-z0-9-]*)\s*(?:=|$)/.exec(line);
    if (assignment) {
      names.push(`${section}.${assignment[1].toLowerCase()}`);
    }
  }
  return names;
}

/** Resolves the real git directory for `cwd`, walking up like git does and
 *  following a `gitdir:` pointer file (worktrees and submodules). */
function resolveGitDirForCwd(cwd) {
  let cursor;
  try {
    cursor = canonicalizePathWithExistingAncestor(cwd);
  } catch {
    return null;
  }
  for (let depth = 0; depth < 64; depth += 1) {
    const candidate = path.join(cursor, '.git');
    let stat = null;
    try {
      stat = fs.statSync(candidate);
    } catch {
      stat = null;
    }
    if (stat && stat.isDirectory()) return candidate;
    if (stat && stat.isFile()) {
      try {
        const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(candidate, 'utf8'));
        if (!pointer) return null;
        const target = pointer[1].trim();
        return path.isAbsolute(target) ? target : path.resolve(cursor, target);
      } catch {
        return null;
      }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  return null;
}

/**
 * Refuses a git invocation whose repository defines a config key git would
 * execute. Returns `{ ok: true }` when the repository is safe to run in, or a
 * structured refusal. A repository with no git directory is safe by definition
 * (git itself will simply error).
 *
 * Fails CLOSED: an unreadable or unparseable config is refused rather than
 * assumed benign.
 */
function auditRepoGitConfig(cwd) {
  const gitDir = resolveGitDirForCwd(cwd);
  if (!gitDir) return { ok: true, scanned: [] };
  const scanned = [];
  // `config.worktree` is consulted alongside `config` when extensions
  // .worktreeConfig is set; scan it unconditionally so we never depend on
  // parsing that extension correctly.
  for (const name of ['config', 'config.worktree']) {
    const configPath = path.join(gitDir, name);
    let body;
    try {
      body = fs.readFileSync(configPath, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') continue;
      return {
        ok: false,
        code: 'exec_git_repo_config_unreadable',
        error: 'git repository config could not be read; refusing to run in an unverifiable repository',
      };
    }
    scanned.push(configPath);
    for (const key of parseGitConfigKeyNames(body)) {
      if (key === '?' || GIT_UNSAFE_CONFIG_KEY_RE.test(key)) {
        return {
          ok: false,
          code: 'exec_git_repo_config_executable',
          // Report the key name only. It is attacker-influenced, so the VALUE
          // (the command git would have run) never reaches the caller.
          error: key === '?'
            ? 'git repository config contains an unparseable section; refusing to run a diagnostic there'
            : `git repository config defines "${key}", which git executes as a command; refusing to run a diagnostic there`,
        };
      }
    }
  }
  return { ok: true, scanned };
}

function normalizeSocketAddress(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value.startsWith('::ffff:')) return value.slice('::ffff:'.length);
  return value;
}

function isLoopbackAddress(raw) {
  return LOOPBACK_ADDRESSES.has(normalizeSocketAddress(raw));
}

function isLoopbackRequest(req) {
  return isLoopbackAddress(req?.socket?.remoteAddress);
}

function isAllowedBridgeHostHeader(rawHost, expectedPort) {
  const hostHeader = String(rawHost || '').trim();
  if (!hostHeader || /[\s/@\\]/.test(hostHeader)) return false;
  const configuredHosts = String(process.env.UC_BRIDGE_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configuredHosts.includes(hostHeader.toLowerCase())) return true;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    const hostname = parsed.hostname.toLowerCase();
    const allowedHost = hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '[::1]';
    if (!allowedHost) return false;
    return !parsed.port || parsed.port === String(expectedPort);
  } catch {
    return false;
  }
}

/**
 * Constant-time bridge-token comparison. `===` on JS strings short-circuits on
 * the first differing byte, and no bridge rate-limits token attempts, so the
 * naive form is an unbounded guess-with-oracle primitive. Length is not secret
 * (the token is a fixed-width hex string), so an early length return is fine.
 */
function timingSafeTokenEqual(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  if (!supplied || !expected) return false;
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  const expectedBytes = Buffer.from(expected, 'utf8');
  if (suppliedBytes.length !== expectedBytes.length) return false;
  return crypto.timingSafeEqual(suppliedBytes, expectedBytes);
}

/**
 * Builds CORS headers that reveal the response only to an allow-listed origin.
 *
 * A static `Access-Control-Allow-Origin: *` on a localhost bridge lets any
 * website the user visits read the response body. Combined with a static
 * `Access-Control-Allow-Private-Network: true` — which is granted on the
 * preflight, before any route or origin check runs — that turns every
 * unauthenticated route into cross-origin readable content. Both headers are
 * therefore emitted only for an origin that passed the allowlist; a disallowed
 * origin gets no ACAO header at all, so the browser blocks the read.
 *
 * A request with no Origin is a non-browser caller (native app, curl) and keeps
 * `*`, which is meaningless to those clients and unreachable from a page.
 */
function buildBridgeCorsHeaders(req, isOriginAllowed, baseHeaders) {
  const headers = { ...(baseHeaders || {}) };
  delete headers['Access-Control-Allow-Origin'];
  delete headers['Access-Control-Allow-Private-Network'];
  const origin = String(req?.headers?.origin || '').trim();
  headers.Vary = 'Origin';
  if (!origin) {
    headers['Access-Control-Allow-Origin'] = '*';
    return headers;
  }
  if (typeof isOriginAllowed === 'function' && isOriginAllowed(req)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Private-Network'] = 'true';
  }
  return headers;
}

function isBridgeRequestSourceAllowed(req, expectedPort, isOriginAllowed) {
  if (!isLoopbackRequest(req)) {
    return { ok: false, code: 'bridge_non_loopback_source' };
  }
  if (!isAllowedBridgeHostHeader(req?.headers?.host, expectedPort)) {
    return { ok: false, code: 'bridge_host_blocked' };
  }
  if (typeof isOriginAllowed !== 'function' || !isOriginAllowed(req)) {
    return { ok: false, code: 'bridge_origin_blocked' };
  }
  return { ok: true };
}

function isPairingRequestSourceAllowed(req, expectedPort, isOriginAllowed) {
  const result = isBridgeRequestSourceAllowed(req, expectedPort, isOriginAllowed);
  if (result.ok) return result;
  return {
    ok: false,
    code: String(result.code || '').replace(/^bridge_/, 'pairing_'),
  };
}

function createPairingChallengeStore(options = {}) {
  const ttlMs = Math.max(5_000, Math.min(120_000, Number(options.ttlMs) || 30_000));
  const maxEntries = Math.max(4, Math.min(256, Number(options.maxEntries) || 64));
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const randomBytes = typeof options.randomBytes === 'function'
    ? options.randomBytes
    : (size) => crypto.randomBytes(size);
  const challenges = new Map();

  function cleanupExpired() {
    const current = now();
    for (const [challenge, entry] of challenges.entries()) {
      if (!entry || entry.expiresAt <= current) challenges.delete(challenge);
    }
  }

  function evictForIssue() {
    while (challenges.size >= maxEntries) {
      const oldest = challenges.keys().next().value;
      if (!oldest) break;
      challenges.delete(oldest);
    }
  }

  function issue(remoteAddress) {
    cleanupExpired();
    evictForIssue();
    const challenge = randomBytes(24).toString('hex');
    const expiresAt = now() + ttlMs;
    challenges.set(challenge, {
      remoteAddress: normalizeSocketAddress(remoteAddress),
      expiresAt,
    });
    return { challenge, expiresAt };
  }

  function consume(challenge, remoteAddress) {
    cleanupExpired();
    const value = String(challenge || '').trim();
    if (!/^[a-f0-9]{48}$/i.test(value)) return false;
    const entry = challenges.get(value);
    // Delete before evaluating the binding so even a failed replay cannot
    // turn into a second attempt.
    challenges.delete(value);
    if (!entry || entry.expiresAt <= now()) return false;
    return entry.remoteAddress === normalizeSocketAddress(remoteAddress);
  }

  return { issue, consume };
}

function resolveBinaryBasename(binary) {
  const value = String(binary || '').trim();
  let resolved = value;
  if (value.includes('/') || value.includes('\\')) {
    try {
      resolved = fs.realpathSync.native ? fs.realpathSync.native(value) : fs.realpathSync(value);
    } catch {
      resolved = path.resolve(value);
    }
  }
  return path.basename(resolved).toLowerCase();
}

function canonicalizePathWithExistingAncestor(targetPath) {
  const absolute = path.resolve(String(targetPath || ''));
  let cursor = absolute;
  const suffix = [];
  while (true) {
    try {
      const canonicalAncestor = fs.realpathSync.native
        ? fs.realpathSync.native(cursor)
        : fs.realpathSync(cursor);
      return path.join(canonicalAncestor, ...suffix.reverse());
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function classifyExecBinary(binary) {
  const binaryName = resolveBinaryBasename(binary);
  if (!binaryName) {
    return { ok: false, binaryName: '(empty)', code: 'exec_binary_empty' };
  }
  if (EXEC_BLOCKED_BINARIES.has(binaryName)) {
    return { ok: false, binaryName, code: 'exec_binary_refused' };
  }
  return { ok: true, binaryName };
}

function prepareSupportedExecInvocation(argv, cwd) {
  if (!Array.isArray(argv) || argv.length < 1) {
    return { ok: false, code: 'exec_argv_invalid', error: 'argv is required' };
  }
  const binaryCheck = classifyExecBinary(argv[0]);
  if (!binaryCheck.ok) return binaryCheck;

  if (binaryCheck.binaryName === 'node') {
    if (argv.length === 2 && (argv[1] === '--version' || argv[1] === '-v')) {
      return { ok: true, binary: process.execPath, args: ['--version'] };
    }
    if (argv.length === 3 && argv[1] === '--check') {
      const requested = String(argv[2] || '');
      if (!requested || path.isAbsolute(requested)) {
        return {
          ok: false,
          code: 'exec_node_target_refused',
          error: 'node --check requires a relative JavaScript file inside cwd',
        };
      }
      let target;
      let canonicalCwd;
      try {
        target = canonicalizePathWithExistingAncestor(path.resolve(cwd, requested));
        canonicalCwd = canonicalizePathWithExistingAncestor(cwd);
      } catch {
        return {
          ok: false,
          code: 'exec_node_target_refused',
          error: 'node --check target could not be canonicalized',
        };
      }
      const inside = target === canonicalCwd || target.startsWith(`${canonicalCwd}${path.sep}`);
      if (!inside || !/\.(?:c|m)?js$/i.test(target)) {
        return {
          ok: false,
          code: 'exec_node_target_refused',
          error: 'node --check target must be a JavaScript file inside cwd',
        };
      }
      return { ok: true, binary: process.execPath, args: ['--check', target] };
    }
    return {
      ok: false,
      code: 'exec_node_mode_refused',
      error: 'node is limited to --version and --check <relative JavaScript file>',
    };
  }

  if (binaryCheck.binaryName !== 'git' || !SAFE_GIT_BINARY) {
    return {
      ok: false,
      code: 'exec_binary_not_supported',
      error: 'exec_file supports only read-only git diagnostics and node --check/--version',
    };
  }

  const args = argv.slice(1);
  const command = args[0];
  const rest = args.slice(1);
  let allowed = false;
  if (command === 'status') {
    allowed = rest.every((arg) => [
      '--short', '--branch', '--porcelain', '--porcelain=v1', '--porcelain=v2',
      '--untracked-files=no', '--untracked-files=normal', '--untracked-files=all',
    ].includes(arg));
  } else if (command === 'diff') {
    allowed = rest.every((arg) => [
      '--check', '--stat', '--name-only', '--name-status', '--cached', '--staged',
      '--quiet', '--exit-code', '--no-color',
    ].includes(arg));
  } else if (command === 'log') {
    allowed = rest.every((arg) => [
      '--oneline', '--stat', '--name-only', '--no-color', '--decorate', '--no-decorate',
    ].includes(arg) || /^-[1-9]\d?$/.test(arg) || /^--max-count=[1-9]\d?$/.test(arg));
  } else if (command === 'rev-parse') {
    allowed = rest.length > 0 && rest.every((arg) => [
      '--show-toplevel', '--show-prefix', '--is-inside-work-tree',
      '--abbrev-ref', 'HEAD',
    ].includes(arg));
  } else if (command === 'branch') {
    allowed = rest.length === 1 && rest[0] === '--show-current';
  } else if (command === 'ls-files') {
    allowed = rest.every((arg) => [
      '--cached', '--modified', '--deleted', '--others', '--exclude-standard', '--stage',
    ].includes(arg));
  }
  if (!allowed) {
    return {
      ok: false,
      code: 'exec_git_command_refused',
      error: 'git invocation is outside the read-only diagnostic allowlist',
    };
  }
  // The subcommand allowlist is necessary but NOT sufficient: an allowlisted
  // read-only subcommand still executes repository-configured helper programs.
  // Refuse before building the invocation.
  const repoAudit = auditRepoGitConfig(cwd);
  if (!repoAudit.ok) return repoAudit;
  return {
    ok: true,
    binary: SAFE_GIT_BINARY,
    args: [
      '-c', 'core.fsmonitor=false',
      '-c', 'core.hooksPath=/dev/null',
      '-c', 'pager.status=false',
      '-c', 'pager.log=false',
      ...(command === 'diff' ? ['--no-pager', 'diff', '--no-ext-diff', '--no-textconv', ...rest] : ['--no-pager', ...args]),
    ],
    env: {
      ...process.env,
      GIT_PAGER: 'cat',
      PAGER: 'cat',
    },
  };
}

function prepareSupportedDiagnosticCommand(command, cwd) {
  const value = String(command || '').trim();
  if (!value || value.length > 256 || /[\x00-\x1f]/.test(value)) {
    return { ok: false, code: 'diagnostic_command_invalid', error: 'Diagnostic command is empty or invalid' };
  }
  const fixed = {
    pwd: ['/bin/pwd', []],
    'ls': ['/bin/ls', []],
    'ls -la': ['/bin/ls', ['-la']],
    'df -h /': ['/bin/df', ['-h', '/']],
    uptime: ['/usr/bin/uptime', []],
  };
  if (fixed[value]) {
    const [binary, args] = fixed[value];
    if (!fs.existsSync(binary)) {
      return { ok: false, code: 'diagnostic_unavailable', error: `${value} is unavailable on this host` };
    }
    return { ok: true, binary, args };
  }
  if (/^(?:git|node)(?:\s+[A-Za-z0-9._=/-]+)*$/.test(value)) {
    return prepareSupportedExecInvocation(value.split(/\s+/), cwd);
  }
  return {
    ok: false,
    code: 'diagnostic_command_refused',
    error: 'Command is outside the fixed read-only diagnostic allowlist',
  };
}

module.exports = {
  auditRepoGitConfig,
  buildBridgeCorsHeaders,
  timingSafeTokenEqual,
  canonicalizePathWithExistingAncestor,
  classifyExecBinary,
  parseGitConfigKeyNames,
  resolveGitDirForCwd,
  createPairingChallengeStore,
  isAllowedBridgeHostHeader,
  isBridgeRequestSourceAllowed,
  isLoopbackAddress,
  isLoopbackRequest,
  isPairingRequestSourceAllowed,
  normalizeSocketAddress,
  prepareSupportedDiagnosticCommand,
  prepareSupportedExecInvocation,
};
