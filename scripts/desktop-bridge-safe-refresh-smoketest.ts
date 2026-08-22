/**
 * Behavioral smoke for the Claude desktop bridge idle-safe source refresh.
 *
 * Every bridge runs from a copied script tree on a reserved loopback port with
 * a disposable HOME and private attachment root. The installed/live bridge on
 * :7778 is never contacted or signaled.
 */

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(__dirname, '..');
const bridgeSource = readFileSync(resolve(root, 'scripts/claude-bridge.js'), 'utf8');
const keepaliveSource = readFileSync(resolve(root, 'scripts/dev-stack-keepalive.js'), 'utf8');
const startDevSource = readFileSync(resolve(root, 'start-dev.js'), 'utf8');
const browserBridgeSource = readFileSync(resolve(root, 'scripts/browser-bridge.js'), 'utf8');
const requireForSmoke = createRequire(import.meta.url);
const keepaliveModule = requireForSmoke(resolve(root, 'scripts/dev-stack-keepalive.js')) as {
  attachBridgeSafeRefreshIpcController: (
    child: ChildProcess,
    options: Record<string, unknown>,
  ) => {
    consumeCommittedExit: (
      code: number | null,
      signal: NodeJS.Signals | null,
      current: boolean,
    ) => false | { manifestSha256: string; immutableSnapshot: Record<string, any> };
    dispose: () => void;
    snapshotForTest: () => Record<string, any> | null;
  };
  BRIDGE_SAFE_REFRESH_IPC_PROTOCOL: string;
  MAX_STARTS: number;
  SAFE_REFRESH_REPLACEMENT_MAX_SPAWN_ATTEMPTS: number;
  SAFE_REFRESH_REPLACEMENT_RETRY_WINDOW_MS: number;
  createBoundedSafeRefreshReplacementController: (
    options: Record<string, any>,
  ) => {
    scheduleInitial: (delayMs?: number) => boolean;
    isActive: () => boolean;
    ownsCandidate: (child: FakeSupervisorChild) => boolean;
    markReady: (child: FakeSupervisorChild) => boolean;
    snapshotForTest: () => Record<string, any>;
  };
  schedulePlannedSafeRefreshRespawn: (
    service: Record<string, unknown>,
    state: Record<string, any>,
    options: Record<string, any>,
  ) => boolean;
  bridgeSafeRefreshIpcMac: (secret: string, type: string, fields: unknown[]) => string;
  cleanupImmutableBridgeSnapshot: (snapshot: Record<string, any>) => boolean;
  createImmutableBridgeSnapshot: (options: Record<string, any>) => Record<string, any>;
  inspectServiceStartupManifestSha256: (service: Record<string, any>) => string | null;
  immutableBridgeSnapshotSpawnSpec: (snapshot: Record<string, any>) => {
    args: string[];
    env: Record<string, string>;
  };
  readAndVerifyImmutableBridgeSnapshot: (snapshot: Record<string, any>) => Record<string, any>;
  scavengeStaleImmutableBridgeSnapshots: (options?: Record<string, any>) => {
    scanned: number;
    removed: number;
    retained: number;
  };
};
const startDevModule = requireForSmoke(resolve(root, 'start-dev.js')) as {
  ServiceManager: new (
    name: string,
    command: string,
    args?: string[],
    options?: Record<string, any>,
  ) => {
    process: FakeSupervisorChild | null;
    restarts: number[];
    safeRefreshReplacement: { isActive: () => boolean } | null;
    scheduleSafeRefreshReplacement: (manifestSha256?: string, snapshot?: Record<string, any>) => boolean;
    markSafeRefreshReplacementReady: (child: FakeSupervisorChild) => boolean;
    stop: () => void;
  };
};
const browserBridgeModule = requireForSmoke(resolve(root, 'scripts/browser-bridge.js')) as {
  _inspectRestartSafetyState: (runtime: Record<string, unknown>) => Record<string, any>;
};

let assertions = 0;

class FakeSupervisorChild extends EventEmitter {
  pid: number;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;

  constructor(pid: number) {
    super();
    this.pid = pid;
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.signalCode = signal;
    queueMicrotask(() => this.emit('exit', this.exitCode, signal));
    return true;
  }

  send(_message: unknown, callback?: (error: Error | null) => void): boolean {
    callback?.(null);
    return true;
  }
}

function emitSignedOnline(args: {
  child: FakeSupervisorChild;
  kind: 'dev-stack-keepalive' | 'start-dev';
  secret: string;
  generation: number;
  instanceId?: string;
  manifestSha256?: string;
  port?: number;
  snapshotId?: string;
}): void {
  const parentPid = process.pid;
  const instanceId = args.instanceId || '1'.repeat(32);
  const manifestSha256 = args.manifestSha256 || '2'.repeat(64);
  const requestNonce = '3'.repeat(64);
  const host = '127.0.0.1';
  const port = args.port || 7778;
  const snapshotId = args.snapshotId || '';
  const fields = [
    args.kind,
    parentPid,
    args.child.pid,
    args.generation,
    instanceId,
    manifestSha256,
    requestNonce,
    host,
    port,
    snapshotId,
  ];
  args.child.emit('message', {
    protocol: keepaliveModule.BRIDGE_SAFE_REFRESH_IPC_PROTOCOL,
    type: 'online',
    supervisorKind: args.kind,
    parentPid,
    childPid: args.child.pid,
    generation: args.generation,
    instanceId,
    manifestSha256,
    requestNonce,
    host,
    port,
    snapshotId,
    mac: keepaliveModule.bridgeSafeRefreshIpcMac(args.secret, 'online', fields),
  });
}

function createTimerQueue(): {
  schedule: (callback: () => void) => Record<string, any>;
  clear: (timer: Record<string, any>) => void;
  runNext: () => void;
  pending: () => number;
} {
  const timers: Array<{ callback: () => void; cancelled: boolean }> = [];
  return {
    schedule(callback) {
      const timer = { callback, cancelled: false };
      timers.push(timer);
      return timer;
    },
    clear(timer) {
      timer.cancelled = true;
    },
    runNext() {
      let timer = timers.shift();
      while (timer?.cancelled) timer = timers.shift();
      assert.ok(timer, 'expected a queued supervisor timer');
      timer.callback();
    },
    pending() {
      return timers.filter((timer) => !timer.cancelled).length;
    },
  };
}

function fakeImmutableSnapshot(manifestSha256 = '2'.repeat(64)): Record<string, any> {
  return {
    rootPath: '/private/fake-snapshot',
    descriptorPath: '/private/fake-snapshot/snapshot.json',
    snapshotId: '9'.repeat(32),
    manifestSha256,
    originalMainPath: '/workspace/scripts/claude-bridge.js',
    fileCount: 5,
  };
}

function verifyFakeImmutableSnapshot(snapshot: Record<string, any>): Record<string, any> {
  if (!snapshot || snapshot.fileCount !== 5) throw new Error('fake snapshot invalid');
  return {
    manifestSha256: snapshot.manifestSha256,
    snapshotId: snapshot.snapshotId,
  };
}

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

function eq(actual: unknown, expected: unknown, message: string): void {
  assertions += 1;
  assert.equal(actual, expected, message);
}

async function reservePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

async function waitUntil<T>(
  read: () => Promise<T | null>,
  accept: (value: T) => boolean,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null = null;
  while (Date.now() < deadline) {
    try {
      last = await read();
      if (last !== null && accept(last)) return last;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  }
  throw new Error(`${label} timed out; last=${JSON.stringify(last)}`);
}

type Health = {
  ok?: boolean;
  instanceId?: string;
  tools?: unknown[];
  restartSafety?: Record<string, any>;
};

type BridgeProcess = {
  child: ChildProcess;
  baseUrl: string;
  output: () => string;
  lease: string;
  controller?: ReturnType<typeof keepaliveModule.attachBridgeSafeRefreshIpcController>;
  onlineReady: () => boolean;
  generation: number;
};

function copyBridgeScripts(
  fixtureRoot: string,
  options: { includePlaywrightStub?: boolean } = {},
): string {
  const scriptsRoot = join(fixtureRoot, 'scripts');
  mkdirSync(scriptsRoot, { recursive: true, mode: 0o700 });
  for (const filename of [
    'claude-bridge.js',
    'terminal-launch-utils.js',
    'desktop-bridge-security.js',
    'codex-session-summary.js',
    'browser-bridge.js',
  ]) {
    copyFileSync(resolve(root, 'scripts', filename), join(scriptsRoot, filename));
  }
  if (options.includePlaywrightStub !== false) {
    const playwrightRoot = join(fixtureRoot, 'node_modules', 'playwright');
    mkdirSync(playwrightRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(playwrightRoot, 'index.js'), "module.exports = { chromium: {} };\n", { mode: 0o600 });
  }
  return join(scriptsRoot, 'claude-bridge.js');
}

function createTestApp(testAppRoot: string): void {
  const contents = join(testAppRoot, 'Preview.app', 'Contents');
  const executableRoot = join(contents, 'MacOS');
  mkdirSync(executableRoot, { recursive: true, mode: 0o700 });
  writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>com.undergroundcircle.safe-refresh.preview</string>
<key>CFBundleName</key><string>Preview</string>
<key>CFBundlePackageType</key><string>APPL</string>
</dict></plist>
`, { mode: 0o600 });
  writeFileSync(join(executableRoot, 'preview-test'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
}

function spawnBridge(args: {
  sourcePath: string;
  port: number;
  home: string;
  attachmentRoot: string;
  testAppRoot: string;
  openBinary: string;
  supervised: boolean;
  generation?: number;
  immutableSnapshot?: Record<string, any>;
  extraEnv?: Record<string, string>;
  onReservationCommitted?: () => void;
}): BridgeProcess {
  const lease = randomBytes(32).toString('hex');
  const generation = args.generation || 1;
  let captured = '';
  let onlineReady = false;
  const snapshotSpec = args.immutableSnapshot
    ? keepaliveModule.immutableBridgeSnapshotSpawnSpec(args.immutableSnapshot)
    : null;
  const child = spawn(process.execPath, snapshotSpec?.args || [args.sourcePath], {
    cwd: resolve(args.sourcePath, '..', '..'),
    env: {
      ...process.env,
      HOME: args.home,
      UC_CLAUDE_BRIDGE_PORT: String(args.port),
      UC_DESKTOP_ATTACHMENT_OPEN_TEST_MODE: '1',
      UC_DESKTOP_ATTACHMENT_OPEN_TEST_ROOT: args.attachmentRoot,
      UC_ATTACHMENT_OPEN_TEST_APP_ROOT: args.testAppRoot,
      UC_ATTACHMENT_OPEN_TEST_INSTALLED_APPS: 'Preview',
      UC_ATTACHMENT_OPEN_TEST_OPEN_BINARY: args.openBinary,
      UC_BRIDGE_TEST_SCAN_INTERVAL_MS: '75',
      UC_BRIDGE_TEST_REFRESH_EXIT_DELAY_MS: '400',
      UC_BRIDGE_TEST_SOURCE_QUIET_MS: '500',
      UC_BRIDGE_TEST_ABORT_UNCERTAINTY_MS: '350',
      UC_ALLOW_CLAUDE_BRIDGE_BILLING: '0',
      ...(args.supervised
        ? {
            UC_BRIDGE_SUPERVISOR_KIND: 'dev-stack-keepalive',
            UC_BRIDGE_SUPERVISOR_PID: String(process.pid),
            UC_BRIDGE_SUPERVISOR_GENERATION: String(generation),
            UC_BRIDGE_SUPERVISOR_IPC_SECRET: lease,
            UC_BRIDGE_SUPERVISOR_IMMUTABLE_HANDOFF_V1: '1',
          }
        : {
            UC_BRIDGE_SUPERVISOR_KIND: '',
            UC_BRIDGE_SUPERVISOR_PID: '',
            UC_BRIDGE_SUPERVISOR_GENERATION: '',
            UC_BRIDGE_SUPERVISOR_IPC_SECRET: '',
          }),
      ...args.extraEnv,
      ...snapshotSpec?.env,
    },
    stdio: args.supervised ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
  });
  const capture = (chunk: Buffer) => {
    captured = `${captured}${chunk.toString('utf8')}`.slice(-20_000);
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  const controller = args.supervised
    ? keepaliveModule.attachBridgeSafeRefreshIpcController(child, {
        kind: 'dev-stack-keepalive',
        secret: lease,
        generation,
        reservationTtlMs: 5_000,
        healthHost: '127.0.0.1',
        healthPort: args.port,
        sourcePath: realpathSync(args.sourcePath),
        expectedManifestSha256: args.immutableSnapshot?.manifestSha256,
        expectedSnapshotId: args.immutableSnapshot?.snapshotId,
        onSnapshotFailure: (error: Error) => {
          captured = `${captured}\n[snapshot-failure] ${error.message}`.slice(-20_000);
        },
        onReservationCommitted: args.onReservationCommitted,
        onBridgeReady: () => { onlineReady = true; },
      })
    : undefined;
  return {
    child,
    baseUrl: `http://127.0.0.1:${args.port}`,
    output: () => captured,
    lease,
    controller,
    onlineReady: () => onlineReady,
    generation,
  };
}

async function readHealth(bridge: BridgeProcess): Promise<Health | null> {
  if (bridge.child.exitCode !== null) return null;
  const response = await fetch(`${bridge.baseUrl}/desktop/health`);
  if (!response.ok) return null;
  return await response.json() as Health;
}

async function waitForHealth(bridge: BridgeProcess): Promise<Health> {
  return await waitUntil(
    () => readHealth(bridge),
    (health) => health.ok === true && Boolean(health.restartSafety),
    15_000,
    `bridge health (${bridge.output()})`,
  );
}

async function pairBridge(bridge: BridgeProcess): Promise<string> {
  const first = await fetch(`${bridge.baseUrl}/desktop/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  const challenge = await first.json() as Record<string, unknown>;
  const second = await fetch(`${bridge.baseUrl}/desktop/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pairingChallenge: challenge.challenge }),
  });
  const paired = await second.json() as Record<string, unknown>;
  eq(paired.ok, true, 'isolated bridge pairs');
  return String(paired.token || '');
}

async function postJson(
  bridge: BridgeProcess,
  pathname: string,
  token: string,
  body: Record<string, unknown>,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; body: Record<string, any> }> {
  const response = await fetch(`${bridge.baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-UC-Desktop-Token': token,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

async function stopBridge(bridge: BridgeProcess): Promise<void> {
  if (bridge.child.exitCode !== null) return;
  bridge.child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolveExit) => bridge.child.once('exit', () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(() => {
      if (bridge.child.exitCode === null) bridge.child.kill('SIGKILL');
      resolveTimeout();
    }, 2500)),
  ]);
}

async function waitForExit(bridge: BridgeProcess): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  if (bridge.child.exitCode !== null) return { code: bridge.child.exitCode, signal: bridge.child.signalCode };
  return await new Promise((resolveExit, reject) => {
    const timeout = setTimeout(() => reject(new Error(`safe refresh did not exit\n${bridge.output()}`)), 5000);
    bridge.child.once('exit', (code, signal) => {
      clearTimeout(timeout);
      resolveExit({ code, signal });
    });
  });
}

async function waitForOwnedSafeExit(bridge: BridgeProcess): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  immutableSnapshot: Record<string, any>;
  manifestSha256: string;
}> {
  const exited = await waitForExit(bridge);
  const consumed = bridge.controller?.consumeCommittedExit(exited.code, exited.signal, true);
  bridge.controller?.dispose();
  check(Boolean(consumed && /^[0-9a-f]{64}$/u.test(consumed.manifestSha256)), 'real supervisor consumes exact committed record with manifest lineage');
  eq(bridge.controller?.consumeCommittedExit(exited.code, exited.signal, true), false, 'committed reservation cannot replay');
  check(Boolean(consumed && typeof consumed === 'object' && consumed.immutableSnapshot), 'committed exit transfers one immutable snapshot to the supervisor');
  return { ...exited, ...(consumed as Record<string, any>) } as any;
}

async function main(): Promise<void> {
  check(bridgeSource.includes('restartSafety: buildDesktopBridgeRestartSafety()'), 'desktop health exposes restartSafety');
  check(bridgeSource.includes("url === '/desktop/refresh_if_idle'"), 'bridge exposes exact safe-refresh endpoint');
  check(bridgeSource.includes("DESKTOP_BRIDGE_SAFE_REFRESH_CONFIRM = 'restart_stale_bridge_if_idle'"), 'confirmation value is fixed');
  check(bridgeSource.includes("return '/usr/bin/open';"), 'production opaque dispatch pins /usr/bin/open');
  check(bridgeSource.includes('Resolved application has no verifiable production code identity.'), 'unsigned production app bundles fail closed');
  check(bridgeSource.includes('desktopAttachmentOpenProductionBundleLocationSafe(bundleRealPath)'), 'production opaque apps require an immutable system location');
  check(
    bridgeSource.includes("spawnSync(process.execPath, ['--check', initial.sourcePath]")
      && bridgeSource.includes("UC_BRIDGE_REPLACEMENT_LOAD_PROBE: '1'"),
    'every source is parsed and startup-probed with the exact Node runtime',
  );
  check(
    bridgeSource.includes(': MAX_DESKTOP_EXEC_TIMEOUT_MS + DESKTOP_BRIDGE_ABORTED_WORK_MARGIN_MS;')
      && bridgeSource.includes('Math.min(MAX_DESKTOP_EXEC_TIMEOUT_MS, Number(parsed?.timeoutMs)'),
    'production abort uncertainty exceeds the shared maximum exec timeout',
  );
  check(bridgeSource.includes('doScan();\n        const preValidationSafety'), 'refresh forces a complete scan before its first decision');
  check(bridgeSource.includes('desktopBridgeRefreshDrainActive = true;\n        doScan();'), 'refresh scans again beneath the drain fence');
  check(browserBridgeSource.includes('function inspectRestartSafety()'), 'browser bridge exports persistent runtime restart authority');
  const browserIdle = browserBridgeModule._inspectRestartSafetyState({ context: null, launchPromise: null });
  eq(browserIdle.contextOpen, false, 'browser restart inspector reports an unopened context');
  eq(browserIdle.unknown, false, 'unopened browser state is known');
  const browserActive = browserBridgeModule._inspectRestartSafetyState({
    context: { pages: () => [{ isClosed: () => false }] },
    launchPromise: null,
  });
  eq(browserActive.contextOpen, true, 'browser restart inspector sees a persistent context');
  eq(browserActive.livePages, 1, 'browser restart inspector counts live pages');
  const browserUnknown = browserBridgeModule._inspectRestartSafetyState({
    context: { pages: () => { throw new Error('injected page scan failure'); } },
    launchPromise: null,
  });
  eq(browserUnknown.unknown, true, 'browser page inspection failure is conservative');
  const pendingInspector = bridgeSource.slice(
    bridgeSource.indexOf('function inspectPendingDesktopAttachmentOpenCapabilities()'),
    bridgeSource.indexOf('function buildDesktopBridgeRestartSafety('),
  );
  check(!pendingInspector.includes('cleanupExpiredDesktopAttachmentOpenCapabilities'), 'public health aggregation is observation-only');
  for (const source of [keepaliveSource, startDevSource]) {
    check(source.includes('UC_BRIDGE_SUPERVISOR_KIND'), 'supervisor passes owner kind');
    check(source.includes('UC_BRIDGE_SUPERVISOR_PID'), 'supervisor passes direct owner pid');
    check(source.includes('UC_BRIDGE_SUPERVISOR_IPC_SECRET'), 'supervisor passes a process-private IPC key');
    check(source.includes("'ipc'"), 'supervisor creates a real inherited IPC channel');
    check(source.includes('75'), 'supervisor recognizes the safe-refresh exit code');
  }
  check(
    bridgeSource.includes("type: 'online'")
      && bridgeSource.includes('notifyDesktopBridgeSupervisorOnline();')
      && keepaliveSource.includes("path: '/desktop/health'")
      && keepaliveSource.includes('startupSourceSha256 === expectedManifestSha256'),
    'replacement readiness requires signed post-listen ONLINE plus exact-instance manifest health',
  );
  check(
    keepaliveSource.includes("require('./desktop-bridge-immutable-snapshot')")
      && keepaliveSource.includes('immutableSnapshot: committedSafeRefresh.immutableSnapshot')
      && startDevSource.includes('immutableBridgeSnapshotSpawnSpec'),
    'both supervisors transfer committed replacement custody through the immutable snapshot owner',
  );
  {
    const timers = createTimerQueue();
    const replacementCalls: Array<Record<string, any>> = [];
    const candidates: FakeSupervisorChild[] = [];
    let keepaliveSnapshotCleanups = 0;
    const initialStartHistory = Array.from({ length: keepaliveModule.MAX_STARTS }, () => Date.now());
    const fifthStartState: {
      child: FakeSupervisorChild | null;
      starts: number[];
      plannedSafeRefreshRespawn: any;
    } = {
      child: null,
      starts: [...initialStartHistory],
      plannedSafeRefreshRespawn: false,
    };
    const service = { name: 'claude-bridge', port: 7778 };
    const claimed = keepaliveModule.schedulePlannedSafeRefreshRespawn(service, fifthStartState, {
      schedule: timers.schedule,
      clearSchedule: timers.clear,
      start: (_service: unknown, options: Record<string, any>) => {
        replacementCalls.push(options);
        fifthStartState.starts.push(Date.now());
        const child = new FakeSupervisorChild(4100 + candidates.length);
        child.once('error', () => {
          if (fifthStartState.child === child) fifthStartState.child = null;
        });
        child.once('exit', () => {
          if (fifthStartState.child === child) fifthStartState.child = null;
        });
        fifthStartState.child = child;
        candidates.push(child);
        return child;
      },
      delayMs: 0,
      retryDelayMs: 0,
      expectedManifestSha256: '2'.repeat(64),
      immutableSnapshot: fakeImmutableSnapshot(),
      verifySnapshot: verifyFakeImmutableSnapshot,
      cleanupSnapshot: () => { keepaliveSnapshotCleanups += 1; return true; },
    });
    eq(claimed, true, 'fifth-start safe exit reserves one replacement entitlement');
    eq(
      keepaliveModule.schedulePlannedSafeRefreshRespawn(service, fifthStartState, {
        schedule: () => assert.fail('duplicate entitlement must not schedule'),
      }),
      false,
      'pending safe-refresh entitlement cannot duplicate',
    );
    eq(timers.pending(), 1, 'safe exit schedules one replacement attempt');
    timers.runNext();
    eq(replacementCalls.length, 1, 'fifth-start rate history cannot suppress the first owned attempt');
    eq(replacementCalls[0]?.bypassRateLimit, true, 'planned attempt bypasses the crash gate only under its exact entitlement');
    check(Boolean(fifthStartState.plannedSafeRefreshRespawn), 'entitlement remains owned before process spawn');
    candidates[0]!.emit('spawn');
    eq(keepaliveSnapshotCleanups, 0, 'keepalive retains snapshot while a replacement awaits readiness');
    check(Boolean(fifthStartState.plannedSafeRefreshRespawn), 'process spawn alone cannot consume bridge readiness custody');
    candidates[0]!.exitCode = 1;
    candidates[0]!.emit('exit', 1, null);
    eq(timers.pending(), 1, 'early exit before online health schedules one bounded reserved retry');
    check(Boolean(fifthStartState.plannedSafeRefreshRespawn), 'early startup exit retains the exact entitlement');
    timers.runNext();
    eq(replacementCalls.length, 2, 'reserved retry bypasses the fifth-start cap without resetting it');
    check(Boolean(fifthStartState.plannedSafeRefreshRespawn), 'second candidate does not consume custody merely by being returned');
    candidates[1]!.emit('spawn');
    check(Boolean(fifthStartState.plannedSafeRefreshRespawn), 'second process spawn still awaits signed online health');
    const keepaliveReadinessSecret = '4'.repeat(64);
    let keepaliveHealthChecks = 0;
    const keepaliveReadinessIpc = keepaliveModule.attachBridgeSafeRefreshIpcController(
      candidates[1]! as unknown as ChildProcess,
      {
        kind: 'dev-stack-keepalive',
        secret: keepaliveReadinessSecret,
        generation: 2,
        healthHost: '127.0.0.1',
        healthPort: 7778,
        verifyHealth: async (input: Record<string, any>) => {
          keepaliveHealthChecks += 1;
          return keepaliveHealthChecks >= 2
            && input.instanceId === '1'.repeat(32)
            && input.manifestSha256 === '2'.repeat(64)
            && input.port === 7778;
        },
        healthRetryDelayMs: 0,
        onBridgeReady: ({ child }: { child: FakeSupervisorChild }) => {
          fifthStartState.plannedSafeRefreshRespawn?.markReady(child);
        },
      },
    );
    emitSignedOnline({
      child: candidates[1]!,
      kind: 'dev-stack-keepalive',
      secret: keepaliveReadinessSecret,
      generation: 2,
    });
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 5));
    eq(keepaliveHealthChecks, 2, 'keepalive rechecks exact ONLINE instance and manifest health before readiness');
    eq(fifthStartState.plannedSafeRefreshRespawn, null, 'online health consumes the entitlement exactly once');
    eq(keepaliveSnapshotCleanups, 1, 'keepalive cleans the snapshot exactly once after readiness');
    eq(fifthStartState.child, candidates[1], 'keepalive owns exactly the successful replacement child');
    eq(timers.pending(), 0, 'successful spawn cannot create an infinite bypass retry');
    eq(
      fifthStartState.starts.slice(0, initialStartHistory.length).join(','),
      initialStartHistory.join(','),
      'planned retries preserve ordinary start history byte-for-byte',
    );
    eq(fifthStartState.starts.length, keepaliveModule.MAX_STARTS + 2, 'each reserved attempt remains visible in start history');
    keepaliveReadinessIpc.dispose();
  }
  {
    const timers = createTimerQueue();
    const candidates: FakeSupervisorChild[] = [];
    const candidateEnvs: Array<Record<string, string>> = [];
    let startDevHealthChecks = 0;
    let startDevSnapshotCleanups = 0;
    const sentinelRestart = Date.now() - 1_000;
    const manager = new startDevModule.ServiceManager(
      'Safe Refresh Spawn Retry Fixture',
      '/invalid-first-then-valid',
      [],
      {
        shell: false,
        env: {
          UC_BRIDGE_IMMUTABLE_STARTUP_MANIFEST_SHA256: 'a'.repeat(64),
          UC_BRIDGE_IMMUTABLE_SOURCE_SNAPSHOT_ID: 'b'.repeat(32),
          UC_BRIDGE_IMMUTABLE_SNAPSHOT_DESCRIPTOR: '/attacker/descriptor',
        },
        bridgeSupervisorKind: 'start-dev',
        bridgeHealthPort: 7778,
        bridgeHealthVerify: async (input: Record<string, any>) => {
          startDevHealthChecks += 1;
          return input.instanceId === '1'.repeat(32)
            && input.manifestSha256 === '2'.repeat(64)
            && input.port === 7778;
        },
        bridgeManifestInspect: () => '2'.repeat(64),
        safeRefreshSnapshotVerify: verifyFakeImmutableSnapshot,
        safeRefreshSnapshotCleanup: () => { startDevSnapshotCleanups += 1; return true; },
        safeRefreshSnapshotSpawnSpec: () => ({ args: [], env: {} }),
        safeRefreshScheduleImpl: timers.schedule,
        safeRefreshClearScheduleImpl: timers.clear,
        safeRefreshRetryDelayMs: 0,
        spawnImpl: (_command: string, _args: string[], options: { env: Record<string, string> }) => {
          const child = new FakeSupervisorChild(5100 + candidates.length);
          candidates.push(child);
          candidateEnvs.push(options.env);
          return child;
        },
      },
    );
    manager.restarts = [sentinelRestart];
    const startDevSnapshot = fakeImmutableSnapshot();
    eq(manager.scheduleSafeRefreshReplacement('2'.repeat(64), startDevSnapshot), true, 'start-dev reserves a bounded replacement after committed exit');
    timers.runNext();
    eq(candidates.length, 1, 'start-dev launches the first reserved candidate');
    eq(candidateEnvs[0]!.UC_BRIDGE_IMMUTABLE_STARTUP_MANIFEST_SHA256, undefined, 'supervisor strips caller-forged startup manifest lineage');
    eq(candidateEnvs[0]!.UC_BRIDGE_IMMUTABLE_SOURCE_SNAPSHOT_ID, undefined, 'supervisor strips caller-forged snapshot lineage');
    eq(candidateEnvs[0]!.UC_BRIDGE_IMMUTABLE_SNAPSHOT_DESCRIPTOR, undefined, 'supervisor strips caller-forged snapshot paths');
    candidates[0]!.emit('spawn');
    check(Boolean(manager.safeRefreshReplacement?.isActive()), 'start-dev keeps custody after process spawn without bridge readiness');
    eq(startDevSnapshotCleanups, 0, 'start-dev retains snapshot while replacement readiness is pending');
    candidates[0]!.exitCode = 1;
    candidates[0]!.emit('exit', 1, null);
    eq(manager.process, null, 'early-startup candidate exit releases the child slot');
    check(Boolean(manager.safeRefreshReplacement?.isActive()), 'start-dev retains entitlement after pre-readiness exit');
    eq(timers.pending(), 1, 'start-dev schedules one bounded safe replacement retry');
    timers.runNext();
    eq(candidates.length, 2, 'start-dev retries the exact entitlement once');
    check(Boolean(manager.safeRefreshReplacement?.isActive()), 'returned child does not consume start-dev entitlement before spawn');
    candidates[1]!.emit('spawn');
    check(Boolean(manager.safeRefreshReplacement?.isActive()), 'start-dev process spawn still awaits online health');
    emitSignedOnline({
      child: candidates[1]!,
      kind: 'start-dev',
      secret: candidateEnvs[1]!.UC_BRIDGE_SUPERVISOR_IPC_SECRET!,
      generation: Number(candidateEnvs[1]!.UC_BRIDGE_SUPERVISOR_GENERATION),
      snapshotId: startDevSnapshot.snapshotId,
    });
    await new Promise<void>((resolveWait) => queueMicrotask(resolveWait));
    eq(startDevHealthChecks, 1, 'start-dev verifies exact ONLINE instance and manifest health once');
    eq(manager.safeRefreshReplacement, null, 'start-dev consumes entitlement on confirmed bridge readiness');
    eq(startDevSnapshotCleanups, 1, 'start-dev cleans the snapshot exactly once after readiness');
    eq(manager.process, candidates[1], 'start-dev owns exactly one live replacement child');
    eq(manager.restarts.join(','), String(sentinelRestart), 'safe replacement retries do not reset or consume ordinary crash history');
    eq(timers.pending(), 0, 'start-dev successful spawn cannot retry without bound');
    manager.stop();
  }
  {
    const timers = createTimerQueue();
    let attempts = 0;
    let ordinaryRecoveries = 0;
    const controller = keepaliveModule.createBoundedSafeRefreshReplacementController({
      schedule: timers.schedule,
      clearSchedule: timers.clear,
      retryDelayMs: 0,
      startAttempt: () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('injected synchronous spawn throw'), { code: 'ENOENT' });
        const child = new FakeSupervisorChild(6100 + attempts);
        queueMicrotask(() => child.emit('error', Object.assign(new Error('injected async spawn error'), { code: 'ENOENT' })));
        return child;
      },
      onOrdinaryRecovery: () => { ordinaryRecoveries += 1; },
    });
    eq(controller.scheduleInitial(0), true, 'bounded controller accepts an exact replacement entitlement');
    while (timers.pending() > 0) {
      timers.runNext();
      await new Promise<void>((resolveWait) => queueMicrotask(resolveWait));
    }
    eq(attempts, keepaliveModule.SAFE_REFRESH_REPLACEMENT_MAX_SPAWN_ATTEMPTS, 'sync and async spawn failures stop at the shared bounded attempt count');
    eq(controller.snapshotForTest().phase, 'exhausted', 'bounded entitlement becomes ordinary recovery after exhaustion');
    eq(ordinaryRecoveries, 1, 'exhaustion hands off to ordinary recovery exactly once');
    eq(timers.pending(), 0, 'exhausted entitlement cannot schedule a fourth bypass attempt');
    eq(keepaliveModule.SAFE_REFRESH_REPLACEMENT_RETRY_WINDOW_MS, 30_000, 'production safe replacement retry custody is time-bounded');
  }
  {
    const timers = createTimerQueue();
    let shutdownCleanups = 0;
    const manager = new startDevModule.ServiceManager(
      'Safe Refresh Shutdown Fixture',
      'node',
      ['scripts/claude-bridge.js'],
      {
        shell: false,
        bridgeSupervisorKind: 'start-dev',
        safeRefreshScheduleImpl: timers.schedule,
        safeRefreshClearScheduleImpl: timers.clear,
        safeRefreshSnapshotVerify: verifyFakeImmutableSnapshot,
        safeRefreshSnapshotCleanup: () => { shutdownCleanups += 1; return true; },
        safeRefreshSnapshotSpawnSpec: () => ({ args: [], env: {} }),
      },
    );
    eq(
      manager.scheduleSafeRefreshReplacement('2'.repeat(64), fakeImmutableSnapshot()),
      true,
      'start-dev owns a snapshot before its first replacement attempt',
    );
    manager.stop();
    eq(shutdownCleanups, 1, 'supervisor shutdown cleans an unconsumed snapshot exactly once');
    eq(timers.pending(), 0, 'supervisor shutdown cancels the pending snapshot replacement timer');
  }
  {
    const timers = createTimerQueue();
    const stuck = new FakeSupervisorChild(7100);
    stuck.kill = () => false;
    let ordinaryRecoveries = 0;
    const controller = keepaliveModule.createBoundedSafeRefreshReplacementController({
      schedule: timers.schedule,
      clearSchedule: timers.clear,
      readinessTimeoutMs: 1,
      reapTimeoutMs: 1,
      startAttempt: () => stuck,
      onReadinessTimeout: ({ child }: { child: FakeSupervisorChild }) => { child.kill('SIGKILL'); },
      onOrdinaryRecovery: () => { ordinaryRecoveries += 1; },
    });
    controller.scheduleInitial(0);
    timers.runNext();
    stuck.emit('spawn');
    timers.runNext();
    check(controller.isActive(), 'unready live candidate remains owned during bounded reap grace');
    timers.runNext();
    eq(controller.snapshotForTest().phase, 'exhausted', 'kill-false/no-exit candidate cannot retain custody forever');
    eq(ordinaryRecoveries, 1, 'stuck reap hands off to ordinary recovery exactly once');
    eq(timers.pending(), 0, 'stuck reap timeout leaves no duplicate bypass timer');
  }
  {
    const child = new FakeSupervisorChild(7150);
    const secret = '7'.repeat(64);
    const manifestSha256 = '8'.repeat(64);
    const requestNonce = '6'.repeat(64);
    const instanceId = '5'.repeat(32);
    let clock = 1_000;
    let expiryCleanups = 0;
    const controller = keepaliveModule.attachBridgeSafeRefreshIpcController(
      child as unknown as ChildProcess,
      {
        kind: 'dev-stack-keepalive',
        secret,
        generation: 1,
        parentPid: process.pid,
        now: () => clock,
        reservationTtlMs: 10,
        sourcePath: '/workspace/scripts/claude-bridge.js',
        createSnapshot: () => fakeImmutableSnapshot(manifestSha256),
        cleanupSnapshot: () => { expiryCleanups += 1; return true; },
        verifySnapshot: verifyFakeImmutableSnapshot,
      },
    );
    const fields = [
      'dev-stack-keepalive',
      process.pid,
      child.pid,
      1,
      instanceId,
      manifestSha256,
      requestNonce,
    ];
    child.emit('message', {
      protocol: keepaliveModule.BRIDGE_SAFE_REFRESH_IPC_PROTOCOL,
      type: 'reserve',
      supervisorKind: 'dev-stack-keepalive',
      parentPid: process.pid,
      childPid: child.pid,
      generation: 1,
      instanceId,
      manifestSha256,
      requestNonce,
      mac: keepaliveModule.bridgeSafeRefreshIpcMac(secret, 'reserve', fields),
    });
    check(Boolean(controller.snapshotForTest()?.immutableSnapshot), 'supervisor reservation owns one private snapshot');
    clock += 20;
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 20));
    eq(controller.snapshotForTest(), null, 'expired uncommitted reservation releases snapshot custody');
    eq(expiryCleanups, 1, 'expired uncommitted reservation cleans its snapshot exactly once');
    controller.dispose();
    eq(expiryCleanups, 1, 'disposing an expired reservation cannot clean twice');
  }
  {
    const timers = createTimerQueue();
    let spawns = 0;
    let ordinaryRecoveries = 0;
    const state = { child: null, starts: [], plannedSafeRefreshRespawn: false as any };
    const scheduled = keepaliveModule.schedulePlannedSafeRefreshRespawn(
      { name: 'claude-bridge', port: 7778 },
      state,
      {
        schedule: timers.schedule,
        clearSchedule: timers.clear,
        expectedManifestSha256: 'a'.repeat(64),
        immutableSnapshot: fakeImmutableSnapshot('b'.repeat(64)),
        verifySnapshot: verifyFakeImmutableSnapshot,
        cleanupSnapshot: () => true,
        start: () => { spawns += 1; return new FakeSupervisorChild(7200); },
        onOrdinaryRecovery: () => { ordinaryRecoveries += 1; },
        delayMs: 0,
      },
    );
    eq(scheduled, true, 'committed source lineage creates one fail-closed replacement decision');
    timers.runNext();
    eq(spawns, 0, 'source drift from committed manifest prevents candidate execution');
    eq(ordinaryRecoveries, 1, 'lineage drift leaves bounded entitlement through ordinary recovery');
    eq(state.plannedSafeRefreshRespawn, null, 'lineage mismatch clears reserved bypass authority');
  }

  const fixtureRoot = mkdtempSync(join(tmpdir(), 'uc-bridge-safe-refresh-'));
  const bridgePath = copyBridgeScripts(fixtureRoot);
  const home = join(fixtureRoot, 'home');
  const projectDir = join(home, '.claude', 'projects', 'fixture-project');
  const attachmentRoot = join(fixtureRoot, 'private-attachments');
  const testAppRoot = join(fixtureRoot, 'test-apps');
  const openBinary = join(fixtureRoot, 'fixed-test-open');
  mkdirSync(projectDir, { recursive: true, mode: 0o700 });
  createTestApp(testAppRoot);
  writeFileSync(openBinary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  chmodSync(openBinary, 0o700);

  {
    const exactBridgePath = realpathSync(bridgePath);
    const manifestSha256 = keepaliveModule.inspectServiceStartupManifestSha256({
      args: [exactBridgePath],
    });
    check(Boolean(manifestSha256), 'five-file fixture has one stable source manifest');
    const tamperSnapshot = keepaliveModule.createImmutableBridgeSnapshot({
      sourcePath: exactBridgePath,
      expectedManifestSha256: manifestSha256,
    });
    eq(tamperSnapshot.fileCount, 5, 'snapshot creation refuses a partial manifest');
    appendFileSync(join(tamperSnapshot.rootPath, 'files', 'terminal-launch-utils.js'), '\n// tampered\n');
    let tamperRejected = false;
    try {
      keepaliveModule.readAndVerifyImmutableBridgeSnapshot(tamperSnapshot);
    } catch {
      tamperRejected = true;
    }
    check(tamperRejected, 'snapshot byte tampering fails closed before replacement spawn');
    eq(keepaliveModule.cleanupImmutableBridgeSnapshot(tamperSnapshot), true, 'rejected snapshot is removed');
    eq(existsSync(tamperSnapshot.rootPath), false, 'rejected snapshot leaves no temp tree');

    const lateTamperSnapshot = keepaliveModule.createImmutableBridgeSnapshot({
      sourcePath: exactBridgePath,
      expectedManifestSha256: manifestSha256,
    });
    const lateTamperSpec = keepaliveModule.immutableBridgeSnapshotSpawnSpec(lateTamperSnapshot);
    const lateDescriptor = JSON.parse(readFileSync(lateTamperSnapshot.descriptorPath, 'utf8')) as Record<string, any>;
    lateDescriptor.snapshotId = '0'.repeat(32);
    writeFileSync(lateTamperSnapshot.descriptorPath, `${JSON.stringify(lateDescriptor)}\n`, { mode: 0o600 });
    const lateTamperChild = spawnSync(process.execPath, lateTamperSpec.args, {
      cwd: fixtureRoot,
      env: { ...process.env, ...lateTamperSpec.env },
      encoding: 'utf8',
      timeout: 3_000,
    });
    check(lateTamperChild.status !== 0, 'child rejects descriptor drift after the parent built its spawn spec');
    check(
      String(lateTamperChild.stderr || '').includes('immutable_snapshot_descriptor_invalid'),
      'late descriptor drift fails at the child bootstrap before bridge code',
    );
    eq(keepaliveModule.cleanupImmutableBridgeSnapshot(lateTamperSnapshot), true, 'late-tampered snapshot is removed');

    const deadOwnerSnapshot = keepaliveModule.createImmutableBridgeSnapshot({
      sourcePath: exactBridgePath,
      expectedManifestSha256: manifestSha256,
    });
    const deadOwnerScavenge = keepaliveModule.scavengeStaleImmutableBridgeSnapshots({
      candidateRootPaths: [deadOwnerSnapshot.rootPath],
      now: () => Date.now() + 25 * 60 * 60_000,
      isProcessDefinitelyGone: () => true,
    });
    eq(deadOwnerScavenge.scanned, 1, 'orphan scavenger examines only its bounded candidate list');
    eq(deadOwnerScavenge.removed, 1, 'old valid snapshot with definitively dead supervisor is removed');
    eq(existsSync(deadOwnerSnapshot.rootPath), false, 'crash-orphan cleanup removes the exact old private tree');

    const liveOwnerSnapshot = keepaliveModule.createImmutableBridgeSnapshot({
      sourcePath: exactBridgePath,
      expectedManifestSha256: manifestSha256,
    });
    const liveOwnerScavenge = keepaliveModule.scavengeStaleImmutableBridgeSnapshots({
      candidateRootPaths: [liveOwnerSnapshot.rootPath],
      now: () => Date.now() + 25 * 60 * 60_000,
      isProcessDefinitelyGone: () => false,
    });
    eq(liveOwnerScavenge.removed, 0, 'live or ambiguous supervisor ownership is never scavenged');
    eq(liveOwnerScavenge.retained, 1, 'live-owner snapshot remains explicitly retained');
    eq(existsSync(liveOwnerSnapshot.rootPath), true, 'live-owner snapshot bytes remain untouched');
    eq(keepaliveModule.cleanupImmutableBridgeSnapshot(liveOwnerSnapshot), true, 'test removes its retained live-owner snapshot');
  }

  const transcriptPath = join(projectDir, '11111111-1111-4111-8111-111111111111.jsonl');
  writeFileSync(transcriptPath, `${JSON.stringify({
    type: 'user',
    timestamp: new Date().toISOString(),
    cwd: fixtureRoot,
    message: { content: 'isolated active-session fixture' },
  })}\n`, { mode: 0o600 });

  const failedScanPort = await reservePort();
  const failedScanBridge = spawnBridge({
    sourcePath: bridgePath,
    port: failedScanPort,
    home,
    attachmentRoot,
    testAppRoot,
    openBinary,
    supervised: true,
    extraEnv: { UC_BRIDGE_TEST_SESSION_SCAN_FAILURE: '1' },
  });
  try {
    const failedScanHealth = await waitForHealth(failedScanBridge);
    eq(failedScanHealth.restartSafety?.sessionScan?.failed, true, 'incomplete configured-root scan is explicit');
    eq(failedScanHealth.restartSafety?.safeToRefresh, false, 'scan failure can never authorize refresh');
    check(failedScanHealth.restartSafety?.blockers?.includes('session_scan_failed'), 'scan failure blocker is exact');
  } finally {
    await stopBridge(failedScanBridge);
  }

  const browserUnavailableRoot = mkdtempSync(join(tmpdir(), 'uc-bridge-browser-runtime-unavailable-'));
  const browserUnavailableBridgePath = copyBridgeScripts(
    browserUnavailableRoot,
    { includePlaywrightStub: false },
  );
  const browserUnavailableHome = join(browserUnavailableRoot, 'home');
  const browserUnavailableAttachmentRoot = join(browserUnavailableRoot, 'private-attachments');
  const browserUnavailableTestAppRoot = join(browserUnavailableRoot, 'test-apps');
  const browserUnavailableOpenBinary = join(browserUnavailableRoot, 'fixed-test-open');
  mkdirSync(join(browserUnavailableHome, '.claude', 'projects'), { recursive: true, mode: 0o700 });
  createTestApp(browserUnavailableTestAppRoot);
  writeFileSync(browserUnavailableOpenBinary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const browserUnavailablePort = await reservePort();
  const browserUnavailable = spawnBridge({
    sourcePath: browserUnavailableBridgePath,
    port: browserUnavailablePort,
    home: browserUnavailableHome,
    attachmentRoot: browserUnavailableAttachmentRoot,
    testAppRoot: browserUnavailableTestAppRoot,
    openBinary: browserUnavailableOpenBinary,
    supervised: true,
  });
  try {
    const unavailableHealth = await waitForHealth(browserUnavailable);
    eq(unavailableHealth.restartSafety?.browserRuntime?.available, false, 'missing Playwright leaves the browser runtime unavailable');
    check(
      unavailableHealth.restartSafety?.blockers?.includes('browser_runtime_unavailable'),
      'browser runtime absence is an exact restart blocker',
    );
    eq(unavailableHealth.restartSafety?.safeToRefresh, false, 'runtime-degraded replacement is never restart-ready');
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 400));
    eq(browserUnavailable.onlineReady(), false, 'supervisor refuses signed ONLINE readiness when browser runtime is unavailable');
    const unavailableToken = await pairBridge(browserUnavailable);
    const unavailableRefresh = await postJson(
      browserUnavailable,
      '/desktop/refresh_if_idle',
      unavailableToken,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(unavailableRefresh.status, 409, 'browser runtime absence blocks before snapshot reservation');
    check(
      unavailableRefresh.body.restartSafety?.blockers?.includes('browser_runtime_unavailable'),
      'authenticated refusal retains the exact browser-runtime blocker',
    );
    eq(browserUnavailable.controller?.snapshotForTest(), null, 'degraded runtime creates no immutable snapshot');
    eq(browserUnavailable.child.exitCode, null, 'degraded runtime keeps its current bridge alive');
  } finally {
    await stopBridge(browserUnavailable);
    rmSync(browserUnavailableRoot, { recursive: true, force: true });
  }

  const unsupportedRoot = mkdtempSync(join(tmpdir(), 'uc-bridge-no-immutable-supervisor-'));
  const unsupportedBridgePath = copyBridgeScripts(unsupportedRoot);
  const unsupportedHome = join(unsupportedRoot, 'home');
  const unsupportedAttachmentRoot = join(unsupportedRoot, 'private-attachments');
  const unsupportedTestAppRoot = join(unsupportedRoot, 'test-apps');
  const unsupportedOpenBinary = join(unsupportedRoot, 'fixed-test-open');
  mkdirSync(join(unsupportedHome, '.claude', 'projects'), { recursive: true, mode: 0o700 });
  createTestApp(unsupportedTestAppRoot);
  writeFileSync(unsupportedOpenBinary, '#!/bin/sh\nexit 0\n', { mode: 0o700 });
  const unsupportedPort = await reservePort();
  const unsupportedSupervisor = spawnBridge({
    sourcePath: unsupportedBridgePath,
    port: unsupportedPort,
    home: unsupportedHome,
    attachmentRoot: unsupportedAttachmentRoot,
    testAppRoot: unsupportedTestAppRoot,
    openBinary: unsupportedOpenBinary,
    supervised: true,
    extraEnv: { UC_BRIDGE_SUPERVISOR_IMMUTABLE_HANDOFF_V1: '0' },
  });
  try {
    await waitForHealth(unsupportedSupervisor);
    const unsupportedToken = await pairBridge(unsupportedSupervisor);
    appendFileSync(unsupportedBridgePath, '\n// unsupported immutable handoff drift\n');
    const unsupportedHealth = await waitUntil(
      () => readHealth(unsupportedSupervisor),
      (value) => value.restartSafety?.sourceChanged === true
        && value.restartSafety?.blockers?.includes('immutable_source_handoff_unavailable'),
      3000,
      'unsupported immutable handoff supervisor',
    );
    eq(unsupportedHealth.restartSafety?.safeToRefresh, false, 'unsupported supervisor never advertises refresh authority');
    const unsupportedRefresh = await postJson(
      unsupportedSupervisor,
      '/desktop/refresh_if_idle',
      unsupportedToken,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(unsupportedRefresh.status, 409, 'unsupported immutable handoff fails closed before reservation');
    check(
      unsupportedRefresh.body.restartSafety?.blockers?.includes('immutable_source_handoff_unavailable'),
      'unsupported supervisor returns the exact immutable handoff blocker',
    );
    eq(unsupportedSupervisor.controller?.snapshotForTest(), null, 'unsupported handoff creates no private snapshot');
    eq(unsupportedSupervisor.child.exitCode, null, 'unsupported handoff leaves the current bridge alive');
  } finally {
    await stopBridge(unsupportedSupervisor);
    rmSync(unsupportedRoot, { recursive: true, force: true });
  }

  const manualPort = await reservePort();
  const manual = spawnBridge({
    sourcePath: bridgePath,
    port: manualPort,
    home,
    attachmentRoot,
    testAppRoot,
    openBinary,
    supervised: false,
  });
  try {
    const manualInitial = await waitForHealth(manual);
    eq(manualInitial.restartSafety?.sourceChanged, false, 'unchanged source is explicit');
    appendFileSync(bridgePath, '\n// safe-refresh manual drift fixture\n');
    const manualDrift = await waitUntil(
      () => readHealth(manual),
      (health) => health.restartSafety?.sourceChanged === true,
      3000,
      'manual source drift',
    );
    eq(manualDrift.restartSafety?.supervisor?.kind, 'manual', 'manual owner is explicit');
    eq(manualDrift.restartSafety?.safeToRefresh, false, 'manual bridge can never self-refresh');
    check(manualDrift.restartSafety?.blockers?.includes('manual_process_owner'), 'manual owner is a blocker');
  } finally {
    await stopBridge(manual);
  }

  const fakeSupervisorPort = await reservePort();
  const fakeSupervisor = spawnBridge({
    sourcePath: bridgePath,
    port: fakeSupervisorPort,
    home,
    attachmentRoot,
    testAppRoot,
    openBinary,
    supervised: false,
    extraEnv: {
      UC_BRIDGE_SUPERVISOR_KIND: 'dev-stack-keepalive',
      UC_BRIDGE_SUPERVISOR_PID: String(process.pid),
      UC_BRIDGE_SUPERVISOR_GENERATION: '1',
      UC_BRIDGE_SUPERVISOR_IPC_SECRET: randomBytes(32).toString('hex'),
    },
  });
  try {
    await waitForHealth(fakeSupervisor);
    const fakeToken = await pairBridge(fakeSupervisor);
    appendFileSync(bridgePath, '\n// forged-supervisor drift fixture\n');
    const fakeHealth = await waitUntil(
      () => readHealth(fakeSupervisor),
      (value) => value.restartSafety?.sourceChanged === true,
      3000,
      'fake supervisor source drift',
    );
    eq(fakeHealth.restartSafety?.supervisor?.kind, 'dev-stack-keepalive', 'forged env declares a recognized supervisor kind');
    eq(fakeHealth.restartSafety?.supervisor?.ipcConnected, false, 'forged env has no authenticated IPC channel');
    eq(fakeHealth.restartSafety?.supervisor?.replacementReady, false, 'forged env cannot claim replacement custody');
    const fakeRefresh = await postJson(
      fakeSupervisor,
      '/desktop/refresh_if_idle',
      fakeToken,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(fakeRefresh.status, 409, 'fake environment supervisor cannot authorize refresh');
    eq(fakeSupervisor.child.exitCode, null, 'fake supervisor refusal leaves bridge alive');
  } finally {
    await stopBridge(fakeSupervisor);
  }

  const port = await reservePort();
  let generation = 1;
  let reservationCommitHook: (() => void) | null = null;
  let supervised = spawnBridge({
    sourcePath: bridgePath,
    port,
    home,
    attachmentRoot,
    testAppRoot,
    openBinary,
    supervised: true,
    onReservationCommitted: () => reservationCommitHook?.(),
  });
  try {
    let health = await waitForHealth(supervised);
    eq(health.restartSafety?.sourceChanged, false, 'supervised startup begins source-current');
    eq(health.restartSafety?.safeToRefresh, false, 'source-current bridge does not restart');
    check(health.restartSafety?.blockers?.includes('source_not_changed'), 'source-current blocker is exact');
    check((health.restartSafety?.activeSessions?.total || 0) > 0, 'recent transcript conservatively blocks refresh');
    eq(health.restartSafety?.supervisor?.kind, 'dev-stack-keepalive', 'supervisor kind is public but lease is not');
    eq(health.restartSafety?.supervisor?.alive, true, 'direct supervisor lease is live');
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.supervisor?.replacementReady === true,
      3000,
      'authenticated supervisor readiness',
    );
    eq(
      await waitUntil(
        async () => supervised.onlineReady() ? true : null,
        (value) => value === true,
        3000,
        'signed online health readiness',
      ),
      true,
      'real supervisor proves the exact bridge instance online after listen',
    );
    eq(health.restartSafety?.supervisor?.ipcConnected, true, 'direct supervisor IPC channel is live');
    eq(health.restartSafety?.opaqueAttachmentCapabilityPresent, true, 'capability presence is separate from source drift');

    const idleTimestamp = new Date(Date.now() - 10 * 60_000);
    utimesSync(transcriptPath, idleTimestamp, idleTimestamp);
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.activeSessions?.idle === 1,
      3000,
      'idle transcript authority',
    );
    eq(health.restartSafety?.activeSessions?.total, 1, 'idle transcript remains possibly active');
    check(health.restartSafety?.blockers?.includes('possibly_active_sessions'), 'idle transcript blocks refresh');

    unlinkSync(transcriptPath);
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.activeSessions?.total === 0,
      3000,
      'active transcript drain',
    );
    eq(health.restartSafety?.sessionScan?.fresh, true, 'empty session result still has fresh scan authority');

    const token = await pairBridge(supervised);
    const bearer = randomBytes(32).toString('hex');
    const bytes = Buffer.from('safe refresh private capability\n');
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const scope = {
      userId: '11111111-1111-4111-8111-111111111111',
      circleId: '22222222-2222-4222-8222-222222222222',
      threadId: '33333333-3333-4333-8333-333333333333',
      messageId: '44444444-4444-4444-8444-444444444444',
      attachmentId: '55555555-5555-4555-8555-555555555555',
    };
    const staged = await postJson(
      supervised,
      '/desktop/attachment_open/stage',
      token,
      {
        scope,
        filename: 'fixture.pdf',
        mimeType: 'application/pdf',
        preferredAppName: 'Preview',
        base64: bytes.toString('base64'),
        sizeBytes: bytes.length,
        sha256,
      },
      { 'X-UC-Attachment-Open-Capability': bearer },
    );
    eq(staged.status, 200, 'isolated private capability stages');
    const validRunningSource = readFileSync(bridgePath, 'utf8');
    appendFileSync(bridgePath, '\n{\n');
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.sourceChanged === true
        && value.restartSafety?.currentSource?.validationFresh === false,
      3000,
      'unvalidated syntax-invalid source drift',
    );
    eq(health.restartSafety?.currentSource?.files?.[0]?.syntaxValid, null, 'public health executes no syntax validator');
    const invalidSourceRefresh = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(invalidSourceRefresh.status, 409, 'authenticated refresh validates and rejects syntax-invalid source');
    health = await readHealth(supervised) as Health;
    eq(health.restartSafety?.safeToRefresh, false, 'syntax-invalid source never authorizes replacement');
    check(
      invalidSourceRefresh.body.restartSafety?.blockers?.includes('current_source_syntax_invalid')
        || health.restartSafety?.blockers?.includes('current_source_validation_required'),
      'invalid source remains blocked after authenticated validation',
    );

    const originalDirResourcePath = join(resolve(bridgePath, '..'), 'immutable-resource-semantics.txt');
    writeFileSync(originalDirResourcePath, 'original-scripts-dir\n', { mode: 0o600 });
    writeFileSync(
      bridgePath,
      `${validRunningSource}\n`
        + `if (process.env.UC_BRIDGE_TEST_ORIGINAL_DIRNAME === '1' && fs.readFileSync(path.join(__dirname, 'immutable-resource-semantics.txt'), 'utf8') !== 'original-scripts-dir\\n') throw new Error('original dirname resource semantics lost');\n`
        + '// safe-refresh supervised drift fixture\n',
    );
    const freshSourceHealth = await readHealth(supervised);
    check(freshSourceHealth?.restartSafety?.sourceChanged === true, 'fresh valid source drift is explicit');
    check(
      freshSourceHealth?.restartSafety?.currentSource?.files?.some((file: Record<string, unknown>) => file.name === 'claude-bridge.js' && file.quiet === false),
      'freshly-written source is not restart-ready',
    );
    check(freshSourceHealth?.restartSafety?.blockers?.includes('current_source_not_quiet'), 'fresh-write blocker is exact');
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.sourceChanged === true
        && value.restartSafety?.currentSource?.files?.every((file: Record<string, unknown>) => file.present === false || file.quiet === true),
      3000,
      'stable valid supervised source drift',
    );
    const securityDependencyPath = join(resolve(bridgePath, '..'), 'desktop-bridge-security.js');
    const validSecurityDependency = readFileSync(securityDependencyPath, 'utf8');
    const publicHealthMarker = join(fixtureRoot, 'public-health-must-not-execute-source');
    appendFileSync(
      securityDependencyPath,
      `\nrequire('fs').writeFileSync(${JSON.stringify(publicHealthMarker)}, 'executed'); throw new Error('valid-syntax replacement load failure');\n`,
    );
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.sourceChanged === true
        && value.restartSafety?.currentSource?.validationFresh === false,
      3000,
      'dependency drift observation',
    );
    eq(existsSync(publicHealthMarker), false, 'public health never evaluates changed dependency code');
    eq(health.restartSafety?.pendingPrivateCapabilities?.count, 1, 'pending private capability blocks refresh');
    check(health.restartSafety?.blockers?.includes('pending_private_capabilities'), 'private blocker is exact');
    const blockedByCapability = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(blockedByCapability.status, 409, 'pending capability refuses refresh');
    eq(existsSync(publicHealthMarker), false, 'ordinary safety blocker prevents replacement code evaluation');
    eq(supervised.child.exitCode, null, 'blocked refresh does not exit');
    const revoked = await postJson(
      supervised,
      '/desktop/attachment_open/revoke',
      token,
      { scope },
      { 'X-UC-Attachment-Open-Capability': bearer },
    );
    eq(revoked.status, 200, 'private capability is explicitly revoked');
    await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.pendingPrivateCapabilities?.count === 0
        && value.restartSafety?.currentSource?.files?.every((file: Record<string, unknown>) => file.present === false || file.quiet === true),
      3000,
      'invalid dependency validation readiness',
    );
    const throwingDependencyRefresh = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(throwingDependencyRefresh.status, 409, 'replacement load validation rejects a throwing dependency');
    eq(existsSync(publicHealthMarker), true, 'explicit authenticated load validation reached the changed dependency');
    check(
      throwingDependencyRefresh.body.restartSafety?.blockers?.includes('current_source_dependency_load_failed'),
      'typed dependency-load blocker is returned before reservation',
    );
    eq(supervised.child.exitCode, null, 'replacement load failure keeps current bridge alive');
    unlinkSync(publicHealthMarker);
    writeFileSync(securityDependencyPath, validSecurityDependency);
    await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.currentSource?.files?.every((file: Record<string, unknown>) => file.present === false || file.quiet === true),
      3000,
      'restored dependency quiet period',
    );

    const heldDiagnostic = httpRequest(`${supervised.baseUrl}/diagnostics`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-UC-Desktop-Token': token,
        'Transfer-Encoding': 'chunked',
      },
    });
    heldDiagnostic.on('error', () => {});
    heldDiagnostic.write('{"command":');
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.inFlightWorkRequests === 1,
      3000,
      'generic in-flight work visibility',
    );
    check(health.restartSafety?.blockers?.includes('bridge_work_request_in_flight'), 'held non-attachment work blocks refresh');
    const blockedByGenericWork = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(blockedByGenericWork.status, 409, 'generic in-flight work refuses refresh');
    heldDiagnostic.destroy();
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.inFlightWorkRequests === 0
        && value.restartSafety?.abortedWorkOutcomeUnknown === true,
      3000,
      'aborted generic work uncertainty',
    );
    check(health.restartSafety?.blockers?.includes('aborted_bridge_work_outcome_unknown'), 'aborted generic work remains conservatively unknown');
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.blockers?.includes('current_source_validation_required')
        && value.restartSafety?.abortedWorkOutcomeUnknown === false,
      3000,
      'bounded aborted generic work uncertainty expiry',
    );
    eq(health.restartSafety?.abortedWorkOutcomeUnknown, false, 'bounded abort latch eventually clears by observation');

    const partialBearer = randomBytes(32).toString('hex');
    const partialRequest = httpRequest(`${supervised.baseUrl}/desktop/attachment_open/stage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-UC-Desktop-Token': token,
        'X-UC-Attachment-Open-Capability': partialBearer,
        'Transfer-Encoding': 'chunked',
      },
    });
    partialRequest.on('error', () => {});
    partialRequest.write('{"scope":');
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => (value.restartSafety?.inFlightPrivateCapabilityRequests || 0) === 1,
      3000,
      'in-flight private request visibility',
    );
    check(health.restartSafety?.blockers?.includes('private_capability_request_in_flight'), 'in-flight request blocks refresh');
    const blockedByInflight = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(blockedByInflight.status, 409, 'in-flight request refuses refresh');
    partialRequest.destroy();
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.inFlightPrivateCapabilityRequests === 0
        && value.restartSafety?.abortedWorkOutcomeUnknown === true,
      3000,
      'aborted private request uncertainty',
    );
    eq(health.restartSafety?.safeToRefresh, false, 'aborted private request cannot immediately authorize refresh');
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.blockers?.includes('current_source_validation_required')
        && value.restartSafety?.abortedWorkOutcomeUnknown === false,
      3000,
      'idle supervised drift after abort uncertainty',
    );

    const wrongConfirm = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle', extra: true },
    );
    eq(wrongConfirm.status, 400, 'confirmation body is closed-world exact');

    writeFileSync(transcriptPath, `${JSON.stringify({
      type: 'user',
      timestamp: new Date().toISOString(),
      cwd: fixtureRoot,
      message: { content: 'created after prior safe health' },
    })}\n`, { mode: 0o600 });
    const blockedByNewTranscript = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(blockedByNewTranscript.status, 409, 'forced pre-decision scan catches a newly-created transcript');
    check(
      blockedByNewTranscript.body.restartSafety?.blockers?.includes('possibly_active_sessions'),
      'new external transcript is an exact refresh blocker',
    );
    eq(supervised.child.exitCode, null, 'new transcript refusal does not exit');
    unlinkSync(transcriptPath);
    health = await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.activeSessions?.total === 0
        && value.restartSafety?.blockers?.includes('current_source_validation_required'),
      3000,
      'new transcript removal',
    );

    const oldInstanceId = String(health.instanceId || '');
    const tamperedCommitHandoff = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(tamperedCommitHandoff.status, 202, 'validated source may enter a parent-owned snapshot reservation');
    const tamperedReservation = supervised.controller?.snapshotForTest();
    check(Boolean(tamperedReservation?.immutableSnapshot), 'reservation owns the exact private snapshot before commit');
    appendFileSync(
      join(tamperedReservation!.immutableSnapshot.rootPath, 'files', 'terminal-launch-utils.js'),
      '\n// injected post-reservation tamper\n',
    );
    await waitUntil(
      async () => {
        const current = await readHealth(supervised);
        return current && supervised.controller?.snapshotForTest() === null
          ? current
          : null;
      },
      (value) => value.restartSafety?.drainActive === false,
      3000,
      'tampered commit cancellation',
    );
    eq(supervised.child.exitCode, null, 'post-reservation snapshot tamper keeps the old bridge alive');
    eq(existsSync(tamperedReservation!.immutableSnapshot.rootPath), false, 'tampered committed candidate is cleaned before old bridge exit');

    let postCommitActivityInjected = false;
    reservationCommitHook = () => {
      postCommitActivityInjected = true;
      writeFileSync(transcriptPath, `${JSON.stringify({
        type: 'user',
        timestamp: new Date().toISOString(),
        cwd: fixtureRoot,
        message: { content: 'created during supervisor commit acknowledgement' },
      })}\n`, { mode: 0o600 });
    };
    const postCommitBlockedHandoff = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    eq(postCommitBlockedHandoff.status, 202, 'idle state may commit only before the final post-ACK observation');
    const postCommitReservation = supervised.controller?.snapshotForTest();
    check(Boolean(postCommitReservation?.immutableSnapshot), 'post-ACK regression owns a committed snapshot candidate');
    await waitUntil(
      async () => {
        const current = await readHealth(supervised);
        return postCommitActivityInjected
          && supervised.controller?.snapshotForTest() === null
          && current
          ? current
          : null;
      },
      (value) => value.restartSafety?.drainActive === false,
      3000,
      'post-commit external activity cancellation',
    );
    eq(postCommitActivityInjected, true, 'external session appears only as the parent commits the snapshot');
    eq(supervised.child.exitCode, null, 'post-commit forced scan keeps the current bridge alive');
    eq(existsSync(postCommitReservation!.immutableSnapshot.rootPath), false, 'post-commit cancellation cleans the committed snapshot');
    reservationCommitHook = null;
    unlinkSync(transcriptPath);
    await waitUntil(
      () => readHealth(supervised),
      (value) => value.restartSafety?.activeSessions?.total === 0,
      3000,
      'post-commit session removal',
    );

    const acceptedImmutableHandoff = await postJson(
      supervised,
      '/desktop/refresh_if_idle',
      token,
      { confirm: 'restart_stale_bridge_if_idle' },
    );
    if (acceptedImmutableHandoff.status !== 202) {
      throw new Error(`immutable handoff unexpectedly refused: ${JSON.stringify(acceptedImmutableHandoff.body)}\n${supervised.output()}`);
    }
    eq(acceptedImmutableHandoff.status, 202, 'idle supervised drift commits one immutable replacement handoff');
    eq(acceptedImmutableHandoff.body.accepted, true, 'immutable handoff acknowledgement is explicit');
    const committedExit = await waitForOwnedSafeExit(supervised);
    eq(committedExit.code, 75, 'old bridge exits only through the committed safe-refresh code');
    const snapshot = committedExit.immutableSnapshot;
    const verifiedSnapshot = keepaliveModule.readAndVerifyImmutableBridgeSnapshot(snapshot);
    eq(verifiedSnapshot.files.length, 5, 'committed snapshot contains the exact five-file manifest');
    eq(statSync(snapshot.rootPath).mode & 0o777, 0o700, 'snapshot root is private 0700');
    eq(statSync(snapshot.descriptorPath).mode & 0o777, 0o600, 'snapshot descriptor is private 0600');
    for (const file of verifiedSnapshot.files) {
      eq(
        statSync(join(snapshot.rootPath, 'files', file.name)).mode & 0o777,
        0o600,
        `snapshot source ${file.name} is private 0600`,
      );
    }

    const mutableExecutionMarker = join(fixtureRoot, 'mutable-working-tree-executed');
    writeFileSync(
      bridgePath,
      `require('node:fs').writeFileSync(${JSON.stringify(mutableExecutionMarker)}, 'executed'); throw new Error('mutable source executed');\n`,
      { mode: 0o600 },
    );
    for (const dependencyName of [
      'terminal-launch-utils.js',
      'desktop-bridge-security.js',
      'codex-session-summary.js',
      'browser-bridge.js',
    ]) unlinkSync(join(resolve(bridgePath, '..'), dependencyName));

    generation += 1;
    supervised = spawnBridge({
      sourcePath: bridgePath,
      port,
      home,
      attachmentRoot,
      testAppRoot,
      openBinary,
      supervised: true,
      generation,
      immutableSnapshot: snapshot,
      extraEnv: { UC_BRIDGE_TEST_ORIGINAL_DIRNAME: '1' },
    });
    const replacement = await waitForHealth(supervised);
    eq(existsSync(mutableExecutionMarker), false, 'replacement executes no mutable working-tree manifest byte');
    eq(readFileSync(originalDirResourcePath, 'utf8'), 'original-scripts-dir\n', 'snapshot execution preserves original __dirname resource semantics');
    check(replacement.instanceId !== oldInstanceId, 'replacement publishes a fresh exact instance identity');
    eq(replacement.restartSafety?.startupSourceSha256, committedExit.manifestSha256, 'health preserves committed manifest hash lineage');
    eq(replacement.restartSafety?.startupSourceSnapshotId, snapshot.snapshotId, 'health preserves exact immutable snapshot lineage');
    eq(
      await waitUntil(
        async () => supervised.onlineReady() ? true : null,
        (value) => value === true,
        3000,
        'immutable replacement signed online health',
      ),
      true,
      'signed ONLINE and exact health accept the immutable replacement',
    );
    eq(keepaliveModule.cleanupImmutableBridgeSnapshot(snapshot), true, 'supervisor removes snapshot after replacement readiness');
    eq(existsSync(snapshot.rootPath), false, 'ready snapshot leaves no private temp tree behind');

    const publicJson = JSON.stringify(replacement);
    for (const forbidden of [fixtureRoot, home, attachmentRoot, testAppRoot, openBinary, snapshot.rootPath, token, bearer, partialBearer, supervised.lease]) {
      check(!publicJson.includes(forbidden), 'public restart safety leaks no path, token, bearer, or lease');
    }
  } finally {
    await stopBridge(supervised);
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  console.log(`Desktop bridge safe refresh smoke passed (${assertions} assertions).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
