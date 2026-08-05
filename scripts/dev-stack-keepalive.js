#!/usr/bin/env node
// dev-stack-keepalive — port-checking supervisor for the local dev stack,
// designed to run under a user LaunchAgent (launchd) so the desktop bridges
// are ALWAYS up (the web app cannot start them itself: a browser page cannot
// spawn a local process when nothing local is listening — see
// src/lib/desktopBridgeAutoConnect.ts).
//
// Unlike start-dev.js (which owns its children), this loop only starts what
// is NOT already listening, so it coexists with a manually-run
// `npm run start` / `npm run web` / `npm run bridge`: if a port is occupied,
// whoever owns it keeps it. Kill any service and the next sweep restarts it.
//
// Install/uninstall via `npm run autostart:install` / `autostart:uninstall`.
// Set UC_KEEPALIVE_EXPO=0 in the LaunchAgent env to leave the Expo web
// server manual while keeping bridges+proxy always-on.

const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const NODE = process.execPath;
const NODE_DIR = path.dirname(NODE);
const ENV = { ...process.env, PATH: `${NODE_DIR}:${process.env.PATH || '/usr/bin:/bin'}` };

const SWEEP_MS = 15_000;
const LOCK_PORT = 18797; // single-instance guard (loopback)
const MAX_STARTS = 5; // per service per window, then cooldown
const START_WINDOW_MS = 10 * 60_000;

const EXPO_ENABLED = process.env.UC_KEEPALIVE_EXPO !== '0';

const SERVICES = [
  { name: 'claude-bridge', port: 7778, cmd: NODE, args: [path.join(REPO, 'scripts/claude-bridge.js')] },
  { name: 'codex-bridge', port: 7779, cmd: NODE, args: [path.join(REPO, 'scripts/codex-bridge.js')] },
  { name: 'gemini-bridge', port: 7780, cmd: NODE, args: [path.join(REPO, 'scripts/gemini-bridge.js')] },
  { name: 'cursor-bridge', port: 7781, cmd: NODE, args: [path.join(REPO, 'scripts/cursor-bridge.js')] },
  { name: 'openswan-proxy', port: 18790, cmd: NODE, args: [path.join(REPO, 'openswan-proxy.js')] },
  ...(EXPO_ENABLED
    // A keepalive respawn follows a crash/recovery boundary, not the normal
    // edit/refresh loop. Clear Metro's transform cache at that boundary so an
    // already-open Chat tab cannot reconnect to a pre-repair bundle graph.
    ? [{ name: 'expo-web', port: 8081, cmd: path.join(NODE_DIR, 'npx'), args: ['expo', 'start', '--web', '--clear'] }]
    : []),
];

const state = new Map(); // name -> { child, starts: number[] }

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function portListening(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (up) => { sock.destroy(); resolve(up); };
    sock.setTimeout(1000, () => done(false));
    sock.on('connect', () => done(true));
    sock.on('error', () => done(false));
  });
}

function canStart(svc) {
  const s = state.get(svc.name) || { child: null, starts: [] };
  const now = Date.now();
  s.starts = s.starts.filter((t) => now - t < START_WINDOW_MS);
  state.set(svc.name, s);
  if (s.child) return false; // our child is alive (port may still be binding)
  if (s.starts.length >= MAX_STARTS) return false; // cooldown until window slides
  return true;
}

function startService(svc) {
  const s = state.get(svc.name);
  s.starts.push(Date.now());
  log(`starting ${svc.name} (port ${svc.port} not listening)`);
  const child = spawn(svc.cmd, svc.args, {
    cwd: REPO,
    env: ENV,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  s.child = child;
  child.on('exit', (code, signal) => {
    log(`${svc.name} exited (code ${code}, signal ${signal || 'none'})`);
    s.child = null;
  });
  child.on('error', (err) => {
    log(`${svc.name} spawn error: ${err.message}`);
    s.child = null;
  });
}

async function sweep() {
  for (const svc of SERVICES) {
    try {
      if (await portListening(svc.port)) continue;
      if (canStart(svc)) startService(svc);
    } catch (err) {
      log(`${svc.name} sweep error: ${err.message}`);
    }
  }
}

// Single-instance guard: hold a loopback lock port. A second copy exits 0,
// which the LaunchAgent's KeepAlive/SuccessfulExit=false policy treats as
// "done, do not restart".
const lock = net.createServer();
lock.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    log('another keepalive instance holds the lock — exiting');
    process.exit(0);
  }
  throw err;
});
lock.listen(LOCK_PORT, '127.0.0.1', () => {
  log(`dev-stack keepalive up (lock :${LOCK_PORT}; expo ${EXPO_ENABLED ? 'managed' : 'manual'})`);
  sweep();
  setInterval(sweep, SWEEP_MS);
});

process.on('SIGTERM', () => {
  log('SIGTERM — leaving services running (they are independent processes)');
  process.exit(0);
});
