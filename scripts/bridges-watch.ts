/**
 * bridges-watch — long-running supervisor that auto-restarts crashed
 * bridges with exponential backoff.
 *
 * Run: `npm run bridges:watch`
 *
 * Behavior:
 *   - Probes every 15s. Healthy + auth-degraded = leave alone.
 *   - On offline: check if port is free (no foreign-PID hold).
 *     • Port free → spawn the bridge, log to /tmp/uc-bridges/<name>.log.
 *     • Port wedged → log a warning + skip (defer to bridges:doctor).
 *   - Backoff: 1s, 2s, 4s, 8s, 16s, 30s (max). Resets on a successful
 *     restart that survives for 5 consecutive healthy probes.
 *   - Circuit breaker: 5 failed restarts in a row → mark "broken,
 *     human required" and stop trying. Next manual `bridges:up`
 *     resets the breaker.
 *
 * Why this lives next to bridges-up rather than replacing it:
 *   - bridges-up is a one-shot used by start-dev.js + manual fixes.
 *   - bridges-watch is a daemon. Run on top of an already-up state.
 *
 * Quit with Ctrl+C — exits cleanly, doesn't kill the bridges it
 * supervised (they were spawned detached).
 */
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRIDGE_CATALOG, probeBridges, type BridgeProbeResult } from '../src/lib/bridgeHealthDiag';

const LOG_DIR = '/tmp/uc-bridges';
const REPO_ROOT = resolve(__dirname, '..');
const PROBE_INTERVAL_MS = 15_000;
const HEALTHY_PROBES_TO_RESET_BACKOFF = 5;
const CIRCUIT_BREAKER_FAILURES = 5;
const BACKOFF_LADDER_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];

interface BridgeState {
  consecutiveFailures: number;
  consecutiveHealthy: number;
  nextRestartAt: number;
  totalRestarts: number;
  circuitBroken: boolean;
}

const state = new Map<string, BridgeState>();
let stopping = false;

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function isPortFree(port: number): boolean {
  try {
    const out = execSync(
      `netstat -an -p tcp 2>/dev/null | grep -E "\\.${port}[[:space:]]+.*LISTEN"`,
      { encoding: 'utf-8', timeout: 2000 },
    ).toString();
    return out.trim().length === 0;
  } catch {
    return true;
  }
}

function startBridge(entry: typeof BRIDGE_CATALOG[number]): { pid: number | undefined } {
  ensureLogDir();
  const logFile = `${LOG_DIR}/${entry.name}.log`;
  const parts = entry.restartCommand.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');
  const child = spawn(cmd, args, { cwd: REPO_ROOT, stdio: ['ignore', out, err], detached: true });
  child.unref();
  return { pid: child.pid };
}

function stateFor(name: string): BridgeState {
  let s = state.get(name);
  if (!s) {
    s = { consecutiveFailures: 0, consecutiveHealthy: 0, nextRestartAt: 0, totalRestarts: 0, circuitBroken: false };
    state.set(name, s);
  }
  return s;
}

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function recordHealthy(name: string) {
  const s = stateFor(name);
  s.consecutiveHealthy += 1;
  if (s.consecutiveFailures > 0 && s.consecutiveHealthy >= HEALTHY_PROBES_TO_RESET_BACKOFF) {
    console.log(`[${ts()}] ${name}: recovered — backoff reset.`);
    s.consecutiveFailures = 0;
  }
}

function nextBackoffMs(failures: number): number {
  const idx = Math.min(failures, BACKOFF_LADDER_MS.length - 1);
  return BACKOFF_LADDER_MS[idx];
}

function maybeRestart(result: BridgeProbeResult) {
  const entry = BRIDGE_CATALOG.find(e => e.name === result.name);
  if (!entry) return;
  const s = stateFor(result.name);

  // Healthy / auth-missing: nothing to do.
  if (result.status === 'healthy') { recordHealthy(result.name); return; }
  if (result.status === 'degraded') { recordHealthy(result.name); return; }

  // Circuit breaker tripped — stop trying.
  if (s.circuitBroken) return;

  // Don't try if a foreign process holds the port.
  if (!isPortFree(entry.port)) {
    console.log(`[${ts()}] ${result.name}: port :${entry.port} held by another process — run \`npm run bridges:doctor\` to recover.`);
    return;
  }

  // Backoff window not yet open.
  const now = Date.now();
  if (now < s.nextRestartAt) return;

  // Ready to attempt restart.
  s.consecutiveFailures += 1;
  s.consecutiveHealthy = 0;
  s.totalRestarts += 1;

  if (s.consecutiveFailures > CIRCUIT_BREAKER_FAILURES) {
    s.circuitBroken = true;
    console.error(`[${ts()}] ${result.name}: circuit breaker tripped after ${s.consecutiveFailures} failures. Inspect /tmp/uc-bridges/${entry.name}.log and run \`npm run bridges:up\` to retry.`);
    return;
  }

  const backoff = nextBackoffMs(s.consecutiveFailures);
  s.nextRestartAt = now + backoff;
  const { pid } = startBridge(entry);
  console.log(`[${ts()}] ${result.name}: offline — spawned (pid=${pid ?? '?'}, attempt ${s.consecutiveFailures}). Log: /tmp/uc-bridges/${entry.name}.log. Next attempt in ${backoff / 1000}s if still offline.`);
}

async function tick() {
  if (stopping) return;
  try {
    const results = await probeBridges({ timeoutMs: 2500 });
    for (const r of results) maybeRestart(r);
  } catch (err) {
    console.error(`[${ts()}] probe failed:`, err);
  }
}

async function main() {
  console.log(`[${ts()}] bridges-watch started — probing every ${PROBE_INTERVAL_MS / 1000}s`);
  console.log(`Quit with Ctrl+C. Logs at ${LOG_DIR}/<bridge>.log`);
  console.log('');

  await tick();
  const timer = setInterval(tick, PROBE_INTERVAL_MS);

  const shutdown = (sig: string) => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    console.log(`\n[${ts()}] received ${sig} — exiting (bridges remain running).`);
    process.exit(0);
  };
  process.on('SIGINT',  () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
