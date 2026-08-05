/**
 * Focused security smoke for the Claude desktop bridge boundary.
 *
 * Run:
 *   npx tsx scripts/desktop-bridge-security-smoketest.ts
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const {
  classifyExecBinary,
  canonicalizePathWithExistingAncestor,
  createPairingChallengeStore,
  isAllowedBridgeHostHeader,
  isLoopbackAddress,
  isPairingRequestSourceAllowed,
  prepareSupportedDiagnosticCommand,
  prepareSupportedExecInvocation,
} = require('./desktop-bridge-security.js') as {
  canonicalizePathWithExistingAncestor: (target: string) => string;
  classifyExecBinary: (binary: string) => { ok: boolean; binaryName: string; code?: string };
  createPairingChallengeStore: (options?: {
    ttlMs?: number;
    maxEntries?: number;
    now?: () => number;
    randomBytes?: (size: number) => Buffer;
  }) => {
    issue: (remoteAddress: string) => { challenge: string; expiresAt: number };
    consume: (challenge: string, remoteAddress: string) => boolean;
  };
  isAllowedBridgeHostHeader: (host: string, port: number) => boolean;
  isLoopbackAddress: (address: string) => boolean;
  isPairingRequestSourceAllowed: (
    req: { socket: { remoteAddress: string }; headers: { host?: string; origin?: string } },
    port: number,
    originAllowed: (req: unknown) => boolean,
  ) => { ok: boolean; code?: string };
  prepareSupportedDiagnosticCommand: (command: string, cwd: string) => { ok: boolean; code?: string };
  prepareSupportedExecInvocation: (argv: string[], cwd: string) => { ok: boolean; code?: string; binary?: string; args?: string[] };
};
const {
  isAllowedPairOrigin,
} = require('./terminal-launch-utils.js') as {
  isAllowedPairOrigin: (req: { headers: { host?: string; origin?: string } }) => boolean;
};

let failures = 0;
let assertions = 0;

function assert(condition: unknown, message: string): void {
  assertions += 1;
  if (condition) {
    console.log(`pass: ${message}`);
  } else {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

function mockRequest(
  remoteAddress: string,
  host = 'localhost:7778',
  origin = 'https://app.chrisswanson.xyz',
) {
  return {
    socket: { remoteAddress },
    headers: { host, origin },
  };
}

function main(): void {
  assert(isLoopbackAddress('127.0.0.1'), 'socket: IPv4 loopback is allowed');
  assert(isLoopbackAddress('::ffff:127.0.0.1'), 'socket: IPv4-mapped loopback is allowed');
  assert(isLoopbackAddress('::1'), 'socket: IPv6 loopback is recognized');
  assert(!isLoopbackAddress('192.168.1.25'), 'socket: LAN source is rejected');
  assert(!isLoopbackAddress('10.0.0.5'), 'socket: private non-loopback source is rejected');

  assert(isAllowedBridgeHostHeader('localhost:7778', 7778), 'host: localhost and expected port are allowed');
  assert(isAllowedBridgeHostHeader('127.0.0.1:7778', 7778), 'host: numeric loopback is allowed');
  assert(isAllowedBridgeHostHeader('[::1]:7778', 7778), 'host: bracketed IPv6 loopback is allowed');
  assert(!isAllowedBridgeHostHeader('evil.example:7778', 7778), 'host: DNS-rebinding hostname is rejected');
  assert(!isAllowedBridgeHostHeader('localhost:9999', 7778), 'host: wrong bridge port is rejected');
  assert(!isAllowedBridgeHostHeader('localhost@evil.example:7778', 7778), 'host: userinfo confusion is rejected');
  const oldAllowedHosts = process.env.UC_BRIDGE_ALLOWED_HOSTS;
  process.env.UC_BRIDGE_ALLOWED_HOSTS = 'tunnel.example,bridge.internal:8443';
  assert(isAllowedBridgeHostHeader('tunnel.example', 7778), 'host: explicit tunnel host allowlist is supported');
  assert(!isAllowedBridgeHostHeader('tunnel.example.evil', 7778), 'host: configured tunnel hostname remains exact-match');
  if (oldAllowedHosts === undefined) delete process.env.UC_BRIDGE_ALLOWED_HOSTS;
  else process.env.UC_BRIDGE_ALLOWED_HOSTS = oldAllowedHosts;

  const originAllowed = (req: any) => req.headers.origin === 'https://app.chrisswanson.xyz';
  assert(
    isPairingRequestSourceAllowed(mockRequest('127.0.0.1'), 7778, originAllowed).ok,
    'pair source: allowed loopback socket, Host, and Origin pass together',
  );
  assert(
    isPairingRequestSourceAllowed(mockRequest('192.168.1.25'), 7778, originAllowed).code === 'pairing_non_loopback_source',
    'pair source: LAN request fails before token exchange',
  );
  assert(
    isPairingRequestSourceAllowed(mockRequest('127.0.0.1', 'attacker.test:7778'), 7778, originAllowed).code === 'pairing_host_blocked',
    'pair source: DNS-rebinding Host fails closed',
  );
  assert(
    isPairingRequestSourceAllowed(mockRequest('127.0.0.1', 'localhost:7778', 'https://evil.example'), 7778, originAllowed).code === 'pairing_origin_blocked',
    'pair source: hostile browser Origin fails closed',
  );
  assert(
    isAllowedPairOrigin({ headers: { host: 'localhost:7778', origin: 'http://localhost:8081' } }),
    'origin: exact localhost web origin remains allowed',
  );
  assert(
    !isAllowedPairOrigin({ headers: { host: 'localhost:7778', origin: 'http://localhost.evil.example' } }),
    'origin: localhost-prefix spoof is rejected',
  );
  assert(
    !isAllowedPairOrigin({ headers: { host: 'localhost:7778', origin: 'https://app.chrisswanson.xyz.evil.example' } }),
    'origin: production-domain suffix spoof is rejected',
  );
  assert(
    isAllowedPairOrigin({ headers: { host: 'localhost:7778', origin: 'https://app.chrisswanson.xyz' } }),
    'origin: built-in production origin remains allowed for a loopback Host',
  );
  const oldAllowedOrigins = process.env.UC_BRIDGE_ALLOWED_ORIGINS;
  delete process.env.UC_BRIDGE_ALLOWED_ORIGINS;
  assert(
    !isAllowedPairOrigin({ headers: { host: 'tunnel.example', origin: 'https://app.chrisswanson.xyz' } }),
    'origin: tunnel Host cannot inherit the built-in production origin',
  );
  assert(
    !isAllowedPairOrigin({ headers: { host: 'tunnel.example' } }),
    'origin: tunnel Host cannot omit its exact configured browser origin',
  );
  process.env.UC_BRIDGE_ALLOWED_ORIGINS = 'https://tunnel-ui.example';
  assert(
    isAllowedPairOrigin({ headers: { host: 'tunnel.example', origin: 'https://tunnel-ui.example' } }),
    'origin: tunnel Host accepts its exact configured origin',
  );
  if (oldAllowedOrigins === undefined) delete process.env.UC_BRIDGE_ALLOWED_ORIGINS;
  else process.env.UC_BRIDGE_ALLOWED_ORIGINS = oldAllowedOrigins;

  let now = 1_000;
  let seed = 1;
  const challengeStore = createPairingChallengeStore({
    ttlMs: 5_000,
    now: () => now,
    randomBytes: (size: number) => Buffer.alloc(size, seed++),
  });
  const wrongSource = challengeStore.issue('127.0.0.1');
  assert(!challengeStore.consume(wrongSource.challenge, '::1'), 'challenge: source binding rejects another socket');
  assert(!challengeStore.consume(wrongSource.challenge, '127.0.0.1'), 'challenge: failed attempt consumes the value');
  const valid = challengeStore.issue('127.0.0.1');
  assert(challengeStore.consume(valid.challenge, '::ffff:127.0.0.1'), 'challenge: valid loopback exchange succeeds once');
  assert(!challengeStore.consume(valid.challenge, '127.0.0.1'), 'challenge: replay is rejected');
  const expired = challengeStore.issue('127.0.0.1');
  now = expired.expiresAt + 1;
  assert(!challengeStore.consume(expired.challenge, '127.0.0.1'), 'challenge: expired value is rejected');
  let capacitySeed = 20;
  const capacityStore = createPairingChallengeStore({
    ttlMs: 5_000,
    maxEntries: 4,
    now: () => 10_000,
    randomBytes: (size: number) => Buffer.alloc(size, capacitySeed++),
  });
  const capacityChallenges = Array.from({ length: 4 }, () => capacityStore.issue('127.0.0.1'));
  assert(
    capacityStore.consume(capacityChallenges[0].challenge, '127.0.0.1'),
    'challenge: consuming at exact capacity does not evict the oldest valid entry',
  );

  for (const binary of [
    'sh', '/bin/bash', '/bin/zsh', 'dash', 'fish', 'ksh', 'csh', 'tcsh',
    '/usr/bin/env', 'pwsh', 'cmd.exe',
  ]) {
    assert(!classifyExecBinary(binary).ok, `exec: ${binary} is refused`);
  }
  assert(prepareSupportedExecInvocation(['git', 'status', '--short'], process.cwd()).ok, 'exec: read-only git status is supported');
  assert(prepareSupportedExecInvocation(['git', 'diff', '--check'], process.cwd()).ok, 'exec: read-only git diff check is supported');
  assert(prepareSupportedExecInvocation(['node', '--version'], process.cwd()).ok, 'exec: node version is supported');
  for (const argv of [
    ['npm', 'test'],
    ['npx', 'tsx', 'payload.ts'],
    ['node', '-e', 'process.exit()'],
    ['python3', '-c', 'print(1)'],
    ['git', 'config', '--global', 'x', 'y'],
    ['git', 'diff', '--ext-diff'],
  ]) {
    assert(!prepareSupportedExecInvocation(argv, process.cwd()).ok, `exec: arbitrary invocation ${argv.join(' ')} is refused`);
  }
  assert(prepareSupportedDiagnosticCommand('pwd', process.cwd()).ok, 'diagnostics: fixed pwd is supported');
  assert(!prepareSupportedDiagnosticCommand('pwd; id', process.cwd()).ok, 'diagnostics: shell operators are refused');

  const tempRoot = mkdtempSync('/private/tmp/uc-bridge-security-');
  try {
    const granted = join(tempRoot, 'granted');
    const outside = join(tempRoot, 'outside');
    mkdirSync(granted);
    mkdirSync(outside);
    symlinkSync(outside, join(granted, 'escape'));
    const canonical = canonicalizePathWithExistingAncestor(join(granted, 'escape', 'future.txt'));
    assert(canonical === join(outside, 'future.txt'), 'paths: nearest existing symlink ancestor canonicalizes outside the grant');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const bridgeSource = readFileSync('scripts/claude-bridge.js', 'utf8');
  const desktopClientSource = readFileSync('src/lib/desktopBridge.ts', 'utf8');
  const bridgeAuthSource = readFileSync('src/lib/bridgeAuth.ts', 'utf8');
  const detectorSource = readFileSync('src/lib/claudeCodeDetector.ts', 'utf8');
  const cursorDetectorSource = readFileSync('src/lib/cursorDetector.ts', 'utf8');
  const terminalControlSource = readFileSync('src/lib/terminalAgentControl.ts', 'utf8');
  const deviceManagerSource = readFileSync('src/lib/deviceManager.ts', 'utf8');
  const openswanToolSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
  const sharedTokenBridgeSources = [
    ['Claude', bridgeSource, 7778],
    ['Codex', readFileSync('scripts/codex-bridge.js', 'utf8'), 7779],
    ['Gemini', readFileSync('scripts/gemini-bridge.js', 'utf8'), 7780],
    ['Cursor', readFileSync('scripts/cursor-bridge.js', 'utf8'), 7781],
  ] as const;
  assert(
    bridgeSource.includes("const BRIDGE_BIND_HOST = '127.0.0.1'")
      && bridgeSource.includes('server.listen(PORT, BRIDGE_BIND_HOST'),
    'source: bridge explicitly binds to IPv4 loopback',
  );
  assert(
    bridgeSource.includes('isPairingRequestSourceAllowed(req, PORT, isBridgeOriginAllowed)'),
    'source: pairing enforces socket, Host, and Origin policy',
  );
  assert(
    bridgeSource.includes('if (!loopbackHost) return false;')
      && readFileSync('scripts/terminal-launch-utils.js', 'utf8').includes('if (!loopbackHost) return false;'),
    'source: implicit browser origins are restricted to loopback Host requests',
  );
  assert(
    bridgeSource.includes('pairing_challenge_required')
      && bridgeSource.includes('desktopPairingChallenges.consume'),
    'source: pairing requires and consumes a one-time challenge',
  );
  assert(
    bridgeSource.indexOf("url === '/desktop/pair'") < bridgeSource.indexOf("process.platform !== 'darwin'"),
    'source: pairing remains available before the macOS-only desktop feature gate',
  );
  assert(
    bridgeSource.includes('home-directory-wide local file grants are refused')
      && !bridgeSource.includes("input.roots) && input.roots.length > 0 ? input.roots : ['~']"),
    'source: server no longer defaults grants to the home directory',
  );
  assert(
    desktopClientSource.includes('requestBridgePairToken')
      && bridgeAuthSource.includes("post({ pairingChallenge: first.json.challenge })")
      && bridgeAuthSource.includes('(first.status === 200 || first.status === 428)')
      && detectorSource.includes('requestBridgePairToken'),
    'source: every Claude /desktop/pair caller completes challenge-v1 across quiet-200 and rolling-428 bridges',
  );
  assert(
    bridgeSource.includes('prepareSupportedExecInvocation(argv, cwd)')
      && bridgeSource.includes("code: 'legacy_shell_exec_retired'"),
    'source: generic exec is retired and exec_file uses the fixed per-command policy',
  );
  assert(
    bridgeSource.includes("kind: normalized.kind")
      && bridgeSource.includes("entry.kind === 'exact' ? target === root"),
    'source: existing files and nonexistent outputs retain exact-target grant semantics',
  );
  assert(
    !bridgeSource.includes("exec(parts.join(' ')")
      && !bridgeSource.includes("cmd = 'stty -F ' + port")
      && bridgeSource.includes("execFile('lp', args"),
    'source: direct and MCP device actions use argv/direct I/O rather than shell interpolation',
  );
  assert(
    !bridgeSource.includes("args.push('--dangerously-skip-permissions'")
      && bridgeSource.includes("spawn('claude', args"),
    'source: structured Claude spawn omits dangerous permission bypass and shell execution',
  );
  const liveExecCallers = [
    'src/lib/computerUse.ts',
    'src/lib/bridgeTaskDispatcher.ts',
    'src/lib/agentInvocation.ts',
    'src/lib/claudeCodeDetector.ts',
    'src/lib/desktopBridgeAutoConnect.ts',
    'src/components/AgentControlCard.tsx',
    'src/screens/circles/tabs/OfficeTab.tsx',
  ];
  assert(
    liveExecCallers.every((file) => !/fetch(?:BridgeAuthenticated)?\([^\n]*\/exec/.test(readFileSync(file, 'utf8'))),
    'source: no live caller posts to the retired /exec route',
  );
  assert(
    bridgeAuthSource.includes("return [make('/desktop/pair'), make('/pair')]"),
    'source: stale-token repair supports no-port Claude tunnel URLs',
  );
  assert(
    desktopClientSource.includes('if (res.status === 401)')
      && desktopClientSource.includes('await writeSecondaryToken(null)')
      && desktopClientSource.includes('const paired = await pairDesktopBridge()'),
    'source: desktop action callers clear both stale token caches, re-pair, and retry once',
  );
  assert(
    cursorDetectorSource.includes("import { fetchBridgeAuthenticated } from './bridgeAuth'")
      && (cursorDetectorSource.match(/fetchBridgeAuthenticated\(`/g) || []).length >= 3
      && !cursorDetectorSource.includes('ensureBridgeToken')
      && !cursorDetectorSource.includes('bridgeAuthHeaders'),
    'source: Cursor session reads and launch use stale-token repair',
  );
  assert(
    terminalControlSource.includes("import { fetchBridgeAuthenticated } from './bridgeAuth'")
      && terminalControlSource.includes('fetchBridgeAuthenticated(`${bridgeUrl}/sessions`')
      && !terminalControlSource.includes('ensureBridgeToken')
      && !terminalControlSource.includes('bridgeAuthHeaders'),
    'source: cross-provider terminal session reads use stale-token repair',
  );
  assert(
    bridgeSource.includes('isPathInsideRoot(canonicalCandidate, canonicalRoot)'),
    'source: skill reads reject symlinks that escape the Claude skills root',
  );
  assert(
    bridgeSource.includes("requireLocalFileAccessGrant(req, parsedUrl, filePath, 'read')")
      && deviceManagerSource.includes("'X-UC-File-Session-Token': grant.data.token"),
    'source: file printing requires an exact read-scoped local-file grant',
  );
  assert(
    desktopClientSource.includes('validateSupportedExecFileArgv(argv)')
      && desktopClientSource.includes("'read',\n    options.reason || `Run read-only")
      && openswanToolSource.includes('Shells, package runners, tests, builds, compilers, scripts, and')
      && openswanToolSource.includes('Direct package-script execution is disabled at the local bridge boundary.'),
    'source: OpenSwan coding catalog and handler match the fixed read-only exec policy',
  );
  for (const [label, source, port] of sharedTokenBridgeSources) {
    assert(
      source.includes("const BRIDGE_BIND_HOST = '127.0.0.1'")
        && source.includes('server.listen(PORT, BRIDGE_BIND_HOST'),
      `source: ${label} shared-token bridge binds port ${port} to loopback`,
    );
    assert(
      source.includes('isPairingRequestSourceAllowed(req, PORT, isAllowedPairOrigin)')
        || source.includes('isPairingRequestSourceAllowed(req, PORT, isBridgeOriginAllowed)'),
      `source: ${label} pairing enforces socket, Host, and Origin`,
    );
    assert(
      source.includes('pairing_challenge_required')
        && (
          source.includes('pairingChallenges.consume')
          || source.includes('desktopPairingChallenges.consume')
        ),
      `source: ${label} pairing consumes challenge-v1 before token disclosure`,
    );
    assert(
      source.includes('isBridgeRequestSourceAllowed(req, PORT,'),
      `source: ${label} paired follow-ups run through the shared source guard`,
    );
  }
  const codexDetectorSource = readFileSync('src/lib/codexDetector.ts', 'utf8');
  const geminiDetectorSource = readFileSync('src/lib/geminiCliDetector.ts', 'utf8');
  assert(
    codexDetectorSource.includes('requestBridgePairToken(`${bridgeUrl}/pair`')
      && geminiDetectorSource.includes('requestBridgePairToken(`${bridgeUrl}/pair`'),
    'source: direct Codex and Gemini detector callers complete challenge-v1',
  );
  const geminiBridgeSource = sharedTokenBridgeSources[2][1];
  const cursorBridgeSource = sharedTokenBridgeSources[3][1];
  const geminiHealthSource = geminiBridgeSource.slice(
    geminiBridgeSource.indexOf("url === '/health'"),
    geminiBridgeSource.indexOf("url === '/pair'"),
  );
  const cursorHealthSource = cursorBridgeSource.slice(
    cursorBridgeSource.indexOf("url === '/health'"),
    cursorBridgeSource.indexOf("url === '/pair'"),
  );
  assert(
    !/email:\s*userEmail/.test(geminiHealthSource)
      && !/geminiDir:\s*GEMINI_DIR/.test(geminiHealthSource)
      && !/cursorDir:\s*CURSOR_DIR/.test(cursorHealthSource),
    'source: public bridge health does not disclose user email or personal config paths',
  );

  if (failures > 0) {
    console.error(`\n${failures}/${assertions} desktop bridge security assertion(s) failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${assertions} desktop bridge security assertions passed.`);
}

main();
