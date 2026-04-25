#!/usr/bin/env node
// Development server supervisor - keeps services running with auto-restart
const { spawn } = require('child_process');
const path = require('path');

const RESTART_DELAY = 2000; // 2 seconds
const MAX_RESTARTS = 10;
const RESTART_WINDOW = 60000; // 1 minute

class ServiceManager {
  constructor(name, command, args = []) {
    this.name = name;
    this.command = command;
    this.args = args;
    this.process = null;
    this.restarts = [];
    this.stopping = false;
  }

  start() {
    if (this.stopping) return;

    const now = Date.now();
    const timeStr = new Date(now).toLocaleTimeString();
    console.log(`\n[${timeStr}] 🚀 Starting ${this.name}...`);
    
    this.process = spawn(this.command, this.args, {
      stdio: ['ignore', 'inherit', 'inherit'], // stdin ignored, stdout/stderr inherited
      shell: true,
      cwd: __dirname,
    });

    this.process.on('exit', (code, signal) => {
      const exitTime = new Date().toLocaleTimeString();
      
      if (this.stopping) {
        console.log(`[${exitTime}] ✓ ${this.name} stopped gracefully`);
        return;
      }

      console.log(`\n[${exitTime}] ⚠️  ${this.name} exited (code: ${code}, signal: ${signal})`);

      // Check restart rate
      const restartNow = Date.now();
      this.restarts = this.restarts.filter(t => restartNow - t < RESTART_WINDOW);
      this.restarts.push(restartNow);

      if (this.restarts.length > MAX_RESTARTS) {
        console.error(`\n❌ ${this.name} crashed ${MAX_RESTARTS} times in ${RESTART_WINDOW / 1000}s`);
        console.error(`   Giving up. Check for errors above.`);
        process.exit(1);
      }

      console.log(`   Restarting in ${RESTART_DELAY / 1000}s... (attempt ${this.restarts.length}/${MAX_RESTARTS})`);
      this.restartTimer = setTimeout(() => {
        this.restartTimer = null;
        this.start();
      }, RESTART_DELAY);
    });

    this.process.on('error', (err) => {
      const errTime = new Date().toLocaleTimeString();
      console.error(`\n[${errTime}] ❌ ${this.name} error:`, err.message);
    });
  }

  stop() {
    this.stopping = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.process) {
      console.log(`\n⏹  Stopping ${this.name}...`);
      this.process.kill('SIGTERM');
    }
  }
}

// Services. Bridges first, then proxy, then Expo — Expo is last so the
// app sees every bridge alive on first poll. Adding Codex / Gemini /
// Cursor here closed a 2026-04-23 gap where those bridges only ran if
// you remembered to start them manually — Ctrl+C-ing the supervisor
// killed Claude Code + Proxy + Expo, leaving the other three stranded
// in stale state from days earlier.
const services = [
  new ServiceManager('Claude Code Bridge', 'node', ['scripts/claude-bridge.js']),
  new ServiceManager('Codex Bridge',       'node', ['scripts/codex-bridge.js']),
  new ServiceManager('Gemini CLI Bridge',  'node', ['scripts/gemini-bridge.js']),
  new ServiceManager('Cursor Bridge',      'node', ['scripts/cursor-bridge.js']),
  new ServiceManager('CORS Proxy',         'node', ['openswan-proxy.js']),
  new ServiceManager('Expo Dev Server',    'npx',  ['expo', 'start', '--web']),
];

// Start all services
console.log('🦢 Underground Circle Dev Server');
console.log('=================================\n');
services.forEach(s => s.start());

// Bridge health summary 6s after launch — gives every service time
// to bind its port. Spawns the same CLI as `npm run check:bridges`
// (subprocess so we don't need start-dev to know about tsx / TS).
setTimeout(() => {
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
  console.log('\n\n📦 Shutting down all services...');
  services.forEach(s => s.stop());
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
