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
  canonicalizePathWithExistingAncestor,
  classifyExecBinary,
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
