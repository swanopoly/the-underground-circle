#!/usr/bin/env node
// Development server supervisor - keeps services running with auto-restart
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RESTART_DELAY = 2000; // 2 seconds
const MAX_RESTARTS = 10;
const RESTART_WINDOW = 60000; // 1 minute
const PLANNED_STOP_TIMEOUT = 5000;

// Metro resolves modules from both the lockfile and the installed dependency
// tree. A dev server that survives an npm install can therefore retain a
// module graph that no longer matches disk. Keep this list deliberately small:
// it covers npm's source/install locks plus the Expo/Metro resolver surface
// involved in lazy web bundles, without watching Metro's own writable caches.
const DEPENDENCY_FINGERPRINT_PATHS = [
  'package-lock.json',
  'node_modules/.package-lock.json',
  'node_modules/expo/package.json',
  'node_modules/@expo/cli/package.json',
  'node_modules/@expo/cli/build/metro-require/require.js',
  'node_modules/expo/node_modules/@expo/cli/package.json',
  'node_modules/expo/node_modules/@expo/cli/build/metro-require/require.js',
  'node_modules/metro/package.json',
  'node_modules/metro-resolver/package.json',
];
const DEPENDENCY_POLL_MS = 1500;
const DEPENDENCY_QUIET_MS = 3000;
const DEPENDENCY_RESTART_COOLDOWN_MS = 15000;

function createDependencyFingerprinter(repoRoot, relativePaths = DEPENDENCY_FINGERPRINT_PATHS) {
  const digestCache = new Map();

  return () => {
    const aggregate = crypto.createHash('sha256');

    for (const relativePath of relativePaths) {
      const absolutePath = path.join(repoRoot, relativePath);
      aggregate.update(`${relativePath}\0`);

      try {
        const stat = fs.lstatSync(absolutePath);
        if (!stat.isFile() && !stat.isSymbolicLink()) {
          aggregate.update(`unsupported:${stat.mode}\0`);
          continue;
        }

        const cacheKey = [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
        const cached = digestCache.get(relativePath);
        let fileDigest;
        if (cached?.cacheKey === cacheKey) {
          fileDigest = cached.digest;
        } else if (stat.isSymbolicLink()) {
          fileDigest = crypto.createHash('sha256').update(fs.readlinkSync(absolutePath)).digest('hex');
          digestCache.set(relativePath, { cacheKey, digest: fileDigest });
        } else {
          fileDigest = crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
          digestCache.set(relativePath, { cacheKey, digest: fileDigest });
        }
        aggregate.update(`present:${fileDigest}\0`);
      } catch (error) {
        if (error?.code === 'ENOENT') {
          digestCache.delete(relativePath);
          aggregate.update('missing\0');
          continue;
        }
        throw error;
      }
    }

    return aggregate.digest('hex');
  };
}

class DependencyRestartMonitor {
  constructor({
    fingerprint,
    onStableChange,
    pollMs = DEPENDENCY_POLL_MS,
    quietMs = DEPENDENCY_QUIET_MS,
    cooldownMs = DEPENDENCY_RESTART_COOLDOWN_MS,
    now = () => Date.now(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval,
  }) {
    this.fingerprint = fingerprint;
    this.onStableChange = onStableChange;
    this.pollMs = pollMs;
    this.quietMs = quietMs;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.timer = null;
    this.appliedFingerprint = null;
    this.candidateFingerprint = null;
    this.candidateSince = 0;
    this.lastRestartAt = Number.NEGATIVE_INFINITY;
  }

  start() {
    if (this.timer) return;
    try {
      this.appliedFingerprint = this.fingerprint();
    } catch (error) {
      console.warn(`[dependency-watch] initial fingerprint failed: ${error.message}`);
    }
    this.timer = this.setIntervalImpl(() => this.checkNow(), this.pollMs);
  }

  checkNow() {
    let currentFingerprint;
    try {
      currentFingerprint = this.fingerprint();
    } catch (error) {
      console.warn(`[dependency-watch] fingerprint failed: ${error.message}`);
      return;
    }

    if (this.appliedFingerprint === null) {
      this.appliedFingerprint = currentFingerprint;
      return;
    }
    if (currentFingerprint === this.appliedFingerprint) {
      this.candidateFingerprint = null;
      this.candidateSince = 0;
      return;
    }

    const checkTime = this.now();
    if (currentFingerprint !== this.candidateFingerprint) {
      this.candidateFingerprint = currentFingerprint;
      this.candidateSince = checkTime;
      return;
    }
    if (checkTime - this.candidateSince < this.quietMs) return;
    if (checkTime - this.lastRestartAt < this.cooldownMs) return;

    // Commit the observed fingerprint before requesting the restart. The same
    // stable state can never cause a loop, even if the restart itself fails.
    this.appliedFingerprint = currentFingerprint;
    this.candidateFingerprint = null;
    this.candidateSince = 0;
    this.lastRestartAt = checkTime;
    try {
      this.onStableChange(currentFingerprint);
    } catch (error) {
      console.warn(`[dependency-watch] restart request failed: ${error.message}`);
    }
  }

  stop() {
    if (!this.timer) return;
    this.clearIntervalImpl(this.timer);
    this.timer = null;
  }
}

class ServiceManager {
  constructor(name, command, args = [], options = {}) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.process = null;
    this.restarts = [];
    this.stopping = false;
    this.restartTimer = null;
    this.forceStopTimer = null;
    this.plannedRestart = null;
    this.processGroup = options.processGroup === true;
    this.spawnImpl = options.spawnImpl || spawn;
    this.env = { ...(options.env || {}) };
  }

  start(args = this.args) {
    if (this.stopping) return;

    const now = Date.now();
    const timeStr = new Date(now).toLocaleTimeString();
    console.log(`\n[${timeStr}] 🚀 Starting ${this.name}...`);

    const child = this.spawnImpl(this.command, args, {
      stdio: ['ignore', 'inherit', 'inherit'], // stdin ignored, stdout/stderr inherited
      shell: true,
      cwd: __dirname,
      env: { ...process.env, ...this.env },
      // A separate group lets a planned Expo restart stop npx and Metro
      // together. Other services retain their existing process behavior.
      detached: this.processGroup && process.platform !== 'win32',
    });
    this.process = child;

    child.on('exit', (code, signal) => {
      const exitTime = new Date().toLocaleTimeString();
      if (this.process === child) this.process = null;
      if (this.forceStopTimer) {
        clearTimeout(this.forceStopTimer);
        this.forceStopTimer = null;
      }

      if (this.stopping) {
        console.log(`[${exitTime}] ✓ ${this.name} stopped gracefully`);
        return;
      }

      if (this.plannedRestart) {
        const planned = this.plannedRestart;
        this.plannedRestart = null;
        console.log(`[${exitTime}] ↻ ${this.name} stopped for planned restart (${planned.reason})`);
        this.restartTimer = setTimeout(() => {
          this.restartTimer = null;
          this.start(planned.args);
        }, planned.delayMs);
        return;
      }

      console.log(`\n[${exitTime}] ⚠️  ${this.name} exited (code: ${code}, signal: ${signal})`);

      // Check restart rate
      const restartNow = Date.now();
      this.restarts = this.restarts.filter(t => restartNow - t < RESTART_WINDOW);
      this.restarts.push(restartNow);

      if (this.restarts.length > MAX_RESTARTS) {
        console.error(`\n❌ ${this.name} crashed ${MAX_RESTARTS} times in ${RESTART_WINDOW / 1000}s`);
        console.error('   Giving up. Check for errors above.');
        process.exit(1);
      }

      console.log(`   Restarting in ${RESTART_DELAY / 1000}s... (attempt ${this.restarts.length}/${MAX_RESTARTS})`);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.start();
      }, RESTART_DELAY);
    });

    child.on('error', (err) => {
      const errTime = new Date().toLocaleTimeString();
      console.error(`\n[${errTime}] ❌ ${this.name} error:`, err.message);
    });
  }

  requestRestart({ reason, args = this.args, delayMs = 250 }) {
    if (this.stopping || this.plannedRestart) return false;

    const planned = { reason, args, delayMs };
    this.plannedRestart = planned;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    const child = this.process;
    if (!child) {
      this.plannedRestart = null;
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.start(planned.args);
      }, planned.delayMs);
      return true;
    }

    console.log(`\n♻️  Restarting ${this.name}: ${reason}`);
    this.terminateChild(child, 'SIGTERM');
    this.forceStopTimer = setTimeout(() => {
      if (this.process !== child || child.exitCode !== null) return;
      console.warn(`[dependency-watch] ${this.name} did not stop in ${PLANNED_STOP_TIMEOUT}ms; forcing it down`);
      this.terminateChild(child, 'SIGKILL');
    }, PLANNED_STOP_TIMEOUT);
    return true;
  }

  terminateChild(child, signal) {
    if (this.processGroup && process.platform !== 'win32' && child.pid) {
      try {
        process.kill(-child.pid, signal);
        return;
      } catch (error) {
        if (error?.code !== 'ESRCH') {
          console.warn(`[supervisor] ${this.name} process-group ${signal} failed: ${error.message}`);
        }
      }
    }
    try {
      child.kill(signal);
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        console.warn(`[supervisor] ${this.name} ${signal} failed: ${error.message}`);
      }
    }
  }

  stop() {
    this.stopping = true;
    this.plannedRestart = null;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.forceStopTimer) {
      clearTimeout(this.forceStopTimer);
      this.forceStopTimer = null;
    }
    if (this.process) {
      console.log(`\n⏹  Stopping ${this.name}...`);
      this.terminateChild(this.process, 'SIGTERM');
    }
  }
}

function createDefaultServices() {
  // Bridges first, then proxy, then Expo — Expo is last so the app sees every
  // bridge alive on first poll. Expo alone receives its own process group so a
  // dependency refresh cannot interrupt healthy bridge services.
  const expoService = new ServiceManager(
    'Expo Dev Server',
    'npx',
    ['expo', 'start', '--web'],
    {
      processGroup: true,
      // Expo's --web mode starts the web bundler and normally opens/focuses a
      // browser. better-opn treats BROWSER=none as an explicit no-open signal.
      env: { BROWSER: 'none' },
    },
  );
  const services = [
    new ServiceManager('Claude Code Bridge', 'node', ['scripts/claude-bridge.js']),
    new ServiceManager('Codex Bridge',       'node', ['scripts/codex-bridge.js']),
    new ServiceManager('Gemini CLI Bridge',  'node', ['scripts/gemini-bridge.js']),
    new ServiceManager('Cursor Bridge',      'node', ['scripts/cursor-bridge.js']),
    new ServiceManager('CORS Proxy',         'node', ['openswan-proxy.js']),
    expoService,
  ];
  return { services, expoService };
}

function createExpoDependencyMonitor(expoService, options = {}) {
  return new DependencyRestartMonitor({
    fingerprint: options.fingerprint || createDependencyFingerprinter(__dirname),
    onStableChange: options.onStableChange || (() => {
      expoService.requestRestart({
        reason: 'installed dependency metadata changed',
        args: ['expo', 'start', '--web', '--clear'],
      });
    }),
    pollMs: options.pollMs,
    quietMs: options.quietMs,
    cooldownMs: options.cooldownMs,
    now: options.now,
    setIntervalImpl: options.setIntervalImpl,
    clearIntervalImpl: options.clearIntervalImpl,
  });
}

function startSupervisor() {
  const { services, expoService } = createDefaultServices();
  const dependencyMonitor = createExpoDependencyMonitor(expoService);
  let shuttingDown = false;

  console.log('🦢 Underground Circle Dev Server');
  console.log('=================================\n');

  // Capture the dependency baseline before Expo starts. If an install begins
  // after this point, the stable changed fingerprint forces one clean restart.
  dependencyMonitor.start();
  services.forEach(service => service.start());

  // Bridge health summary 6s after launch — gives every service time
  // to bind its port. Spawns the same CLI as `npm run check:bridges`
  // (subprocess so we don't need start-dev to know about tsx / TS).
  setTimeout(() => {
    if (shuttingDown) return;
    console.log('\n--- Bridge health (6s post-launch) ---');
    const probe = spawn('npx', ['tsx', 'scripts/check-bridges.ts'], {
      stdio: ['ignore', 'inherit', 'inherit'],
      shell: true,
      cwd: __dirname,
    });
    probe.on('exit', () => {
      console.log('---------------------------------------\n');
    });
  }, 6000);

  // Graceful shutdown
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    dependencyMonitor.stop();
    console.log('\n\n📦 Shutting down all services...');
    services.forEach(service => service.stop());
    setTimeout(() => {
      console.log('\n✓ All services stopped\n');
      process.exit(0);
    }, 1000);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep alive
  process.stdin.resume();
  console.log('\n💡 Press Ctrl+C to stop all services\n');
  return { services, expoService, dependencyMonitor, shutdown };
}

if (require.main === module) {
  startSupervisor();
}

module.exports = {
  DEPENDENCY_FINGERPRINT_PATHS,
  DependencyRestartMonitor,
  ServiceManager,
  createDefaultServices,
  createDependencyFingerprinter,
  createExpoDependencyMonitor,
  startSupervisor,
};
