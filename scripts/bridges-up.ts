/**
 * bridges-up — start any bridges that aren't already running.
 * Run: npm run bridges:up
 *
 * Probes all 5 bridges via the shared diag library, then for any
 * that come back `offline` it spawns the bridge process detached
 * (via `nohup`-style child) so it survives this script exiting.
 * Bridges that are already healthy or merely degraded (auth missing)
 * are left alone — no churn for the running ones, no double-start.
 *
 * Why this exists: `start-dev.js` is the canonical supervisor and
 * does this on launch, but if the user already has Expo / Claude
 * bridge running and just wants to top up the missing pieces (e.g.
 * "Codex died, bring it back without restarting everything"), this
 * is the surgical option.
 *
 * Logs land in /tmp/uc-bridges/<name>.log so the user can `tail -f`
 * if anything misbehaves later.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { resolve } from 'node:path';
import { BRIDGE_CATALOG, probeBridges, summarizeBridgeProbes } from '../src/lib/bridgeHealthDiag';

const LOG_DIR = '/tmp/uc-bridges';
const REPO_ROOT = resolve(__dirname, '..');

function ensureLogDir() {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

function startBridge(entry: typeof BRIDGE_CATALOG[number]): { pid: number | undefined } {
  ensureLogDir();
  const logFile = `${LOG_DIR}/${entry.name}.log`;
  // restartCommand is "node <path>" — we split it back out so we can
  // spawn directly without a shell.
  const parts = entry.restartCommand.split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  const out = openSync(logFile, 'a');
  const err = openSync(logFile, 'a');
  const child = spawn(cmd, args, {
    cwd: REPO_ROOT,
    stdio: ['ignore', out, err],
    detached: true,
  });
  child.unref();
  return { pid: child.pid };
}

async function main() {
  console.log('Probing bridges...\n');
  const before = await probeBridges();
  console.log(summarizeBridgeProbes(before));
  console.log('');

  const offline = before.filter((r) => r.status === 'offline');
  if (offline.length === 0) {
    console.log('All bridges up — nothing to start.');
    return;
  }

  console.log(`Starting ${offline.length} offline bridge${offline.length === 1 ? '' : 's'}...\n`);
  for (const r of offline) {
    const entry = BRIDGE_CATALOG.find((e) => e.name === r.name);
    if (!entry) continue;
    const { pid } = startBridge(entry);
    console.log(`  → ${entry.label.padEnd(18)} spawned (pid=${pid ?? '?'}) — log: /tmp/uc-bridges/${entry.name}.log`);
  }

  // Give them ~3s to bind ports.
  console.log('\nWaiting 3s for ports to bind...\n');
  await new Promise((r) => setTimeout(r, 3000));

  const after = await probeBridges();
  console.log(summarizeBridgeProbes(after));
  console.log('');

  const stillOffline = after.filter((r) => r.status === 'offline');
  if (stillOffline.length > 0) {
    console.error(`${stillOffline.length} bridge(s) still offline — check /tmp/uc-bridges/*.log for errors.`);
    process.exit(2);
  }
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
