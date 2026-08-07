#!/usr/bin/env node

const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  DependencyRestartMonitor,
  ServiceManager,
  createDefaultServices,
  createDependencyFingerprinter,
  createExpoDependencyMonitor,
} = require('../start-dev.js');

let assertions = 0;
let failures = 0;

function assert(condition, label, detail = '') {
  assertions += 1;
  if (condition) {
    console.log(`pass: ${label}`);
    return;
  }
  failures += 1;
  console.error(`FAIL: ${label}${detail ? ` — ${detail}` : ''}`);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.exitCode = null;
    this.killSignals = [];
  }

  kill(signal) {
    this.killSignals.push(signal);
    this.exitCode = 0;
    queueMicrotask(() => this.emit('exit', 0, signal));
    return true;
  }
}

async function run() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'uc-start-dev-watch-'));
  try {
    fs.mkdirSync(path.join(tempRoot, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'package-lock.json'), '{"lockfileVersion":3}\n');
    fs.writeFileSync(path.join(tempRoot, 'node_modules/.package-lock.json'), '{"packages":{}}\n');

    const fingerprint = createDependencyFingerprinter(tempRoot, [
      'package-lock.json',
      'node_modules/.package-lock.json',
      'node_modules/@expo/cli/package.json',
    ]);
    const initial = fingerprint();
    assert(initial === fingerprint(), 'fingerprint is stable while dependency metadata is unchanged');

    fs.writeFileSync(path.join(tempRoot, 'package-lock.json'), '{"lockfileVersion":3,"changed":true}\n');
    const sourceLockChanged = fingerprint();
    assert(sourceLockChanged !== initial, 'package-lock content changes the dependency fingerprint');

    fs.writeFileSync(path.join(tempRoot, 'node_modules/.package-lock.json'), '{"packages":{"node_modules/expo":{}}}\n');
    const installLockChanged = fingerprint();
    assert(installLockChanged !== sourceLockChanged, 'npm installed-tree metadata changes the dependency fingerprint');

    fs.mkdirSync(path.join(tempRoot, 'node_modules/@expo/cli'), { recursive: true });
    fs.writeFileSync(path.join(tempRoot, 'node_modules/@expo/cli/package.json'), '{"name":"@expo/cli"}\n');
    assert(fingerprint() !== installLockChanged, 'a previously missing Expo resolver package changes the fingerprint when installed');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }

  let currentFingerprint = 'base';
  let now = 0;
  const stableChanges = [];
  const monitor = new DependencyRestartMonitor({
    fingerprint: () => currentFingerprint,
    onStableChange: value => stableChanges.push(value),
    quietMs: 100,
    cooldownMs: 500,
    now: () => now,
    setIntervalImpl: () => ({ fakeTimer: true }),
    clearIntervalImpl: () => {},
  });
  monitor.start();

  currentFingerprint = 'install-stage-one';
  now = 10;
  monitor.checkNow();
  now = 80;
  monitor.checkNow();
  assert(stableChanges.length === 0, 'a dependency write does not restart Metro before the quiet period');

  currentFingerprint = 'install-final';
  now = 90;
  monitor.checkNow();
  now = 191;
  monitor.checkNow();
  assert(stableChanges.length === 1 && stableChanges[0] === 'install-final', 'only the final stable install fingerprint requests a restart');
  now = 400;
  monitor.checkNow();
  assert(stableChanges.length === 1, 'the same fingerprint cannot create a restart loop');

  currentFingerprint = 'next-install';
  now = 450;
  monitor.checkNow();
  now = 560;
  monitor.checkNow();
  assert(stableChanges.length === 1, 'restart cooldown bounds back-to-back dependency refreshes');
  now = 700;
  monitor.checkNow();
  assert(stableChanges.length === 2 && stableChanges[1] === 'next-install', 'a later stable dependency change restarts once after cooldown');
  monitor.stop();

  const spawnCalls = [];
  let nextPid = 2000;
  const fakeSpawn = (command, args, options) => {
    const child = new FakeChild(nextPid++);
    spawnCalls.push({ command, args: [...args], options, child });
    return child;
  };
  const expoManager = new ServiceManager(
    'Expo Dev Server',
    'npx',
    ['expo', 'start', '--web'],
    { spawnImpl: fakeSpawn, env: { BROWSER: 'none' } },
  );
  expoManager.start();
  const planned = expoManager.requestRestart({
    reason: 'test dependency refresh',
    args: ['expo', 'start', '--web', '--clear'],
    delayMs: 0,
  });
  await wait(5);

  assert(planned, 'Expo accepts a planned dependency restart');
  assert(spawnCalls.length === 2, 'planned restart replaces only its current child exactly once');
  assert(
    spawnCalls[1]?.args.join(' ') === 'expo start --web --clear',
    'dependency restart clears Metro cache',
    spawnCalls[1]?.args.join(' '),
  );
  assert(
    spawnCalls.every(call => call.options.env.BROWSER === 'none'),
    'initial start and dependency restart explicitly suppress browser opening',
  );
  assert(expoManager.restarts.length === 0, 'planned dependency restart does not consume the crash-loop budget');
  expoManager.stop();

  const { services, expoService } = createDefaultServices();
  const serviceNames = services.map(service => service.name);
  assert(serviceNames.length === 6 && serviceNames[5] === 'Expo Dev Server', 'default supervisor preserves all five bridge/proxy services before Expo');
  assert(expoService.processGroup === true, 'only Expo owns a killable process group for bounded child-tree restart');
  assert(expoService.env.BROWSER === 'none', 'default Expo service cannot open or foreground a browser');
  assert(
    services.filter(service => service.processGroup).map(service => service.name).join(',') === 'Expo Dev Server',
    'healthy bridge and proxy services are excluded from dependency restarts',
  );

  let requestedRestart = null;
  let monitorFingerprint = 'before';
  let monitorNow = 0;
  const targetedMonitor = createExpoDependencyMonitor(
    { requestRestart: request => { requestedRestart = request; return true; } },
    {
      fingerprint: () => monitorFingerprint,
      quietMs: 10,
      cooldownMs: 100,
      now: () => monitorNow,
      setIntervalImpl: () => ({ fakeTimer: true }),
      clearIntervalImpl: () => {},
    },
  );
  targetedMonitor.start();
  monitorFingerprint = 'after';
  monitorNow = 1;
  targetedMonitor.checkNow();
  monitorNow = 12;
  targetedMonitor.checkNow();
  targetedMonitor.stop();
  assert(requestedRestart?.reason === 'installed dependency metadata changed', 'stable dependency change targets the Expo manager directly');
  assert(
    requestedRestart?.args.join(' ') === 'expo start --web --clear',
    'targeted restart requests Expo web with a clean Metro cache',
  );

  if (failures > 0) {
    console.error(`\n${failures} of ${assertions} assertions failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${assertions} start-dev dependency-watch assertions passed.`);
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
