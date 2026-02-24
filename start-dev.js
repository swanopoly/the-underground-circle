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

    console.log(`\n🚀 Starting ${this.name}...`);
    
    this.process = spawn(this.command, this.args, {
      stdio: 'inherit',
      shell: true,
      cwd: __dirname,
    });

    this.process.on('exit', (code, signal) => {
      if (this.stopping) {
        console.log(`✓ ${this.name} stopped gracefully`);
        return;
      }

      console.log(`\n⚠️  ${this.name} exited (code: ${code}, signal: ${signal})`);

      // Check restart rate
      const now = Date.now();
      this.restarts = this.restarts.filter(t => now - t < RESTART_WINDOW);
      this.restarts.push(now);

      if (this.restarts.length > MAX_RESTARTS) {
        console.error(`\n❌ ${this.name} crashed ${MAX_RESTARTS} times in ${RESTART_WINDOW / 1000}s`);
        console.error(`   Giving up. Check for errors above.`);
        process.exit(1);
      }

      console.log(`   Restarting in ${RESTART_DELAY / 1000}s... (attempt ${this.restarts.length}/${MAX_RESTARTS})`);
      setTimeout(() => this.start(), RESTART_DELAY);
    });

    this.process.on('error', (err) => {
      console.error(`\n❌ ${this.name} error:`, err.message);
    });
  }

  stop() {
    this.stopping = true;
    if (this.process) {
      console.log(`\n⏹  Stopping ${this.name}...`);
      this.process.kill('SIGTERM');
    }
  }
}

// Services
const services = [
  new ServiceManager('CORS Proxy', 'node', ['openclaw-proxy.js']),
  new ServiceManager('Expo Dev Server', 'npm', ['start']),
];

// Start all services
console.log('🦢 OpenClaw Development Server');
console.log('================================\n');
services.forEach(s => s.start());

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
