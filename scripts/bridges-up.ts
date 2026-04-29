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
import { execSync, spawn } from 'node:child_process';
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

/**
 * For an offline bridge, check whether its port is actually free —
 * if it's bound but probe failed, spawning a duplicate will hit
 * EADDRINUSE and we should defer to bridges:doctor instead.
 */
function isPortFree(port: number): boolean {
  try {
    const out = execSync(
      `netstat -an -p tcp 2>/dev/null | grep -E "\\.${port}[[:space:]]+.*LISTEN"`,
      { encoding: 'utf-8', timeout: 2000 },
    ).toString();
    return out.trim().length === 0;
  } catch {
    return true;  // assume free on error — spawn will fail loudly if not
  }
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

  // Split offline into two buckets: truly free (safe to start) vs.
  // wedged (port bound by something we can't talk to — defer to doctor).
  const wedged: typeof offline = [];
  const startable: typeof offline = [];
  for (const r of offline) {
    const entry = BRIDGE_CATALOG.find((e) => e.name === r.name);
    if (!entry) continue;
    if (isPortFree(entry.port)) {
      startable.push(r);
    } else {
      wedged.push(r);
    }
  }

  if (wedged.length > 0) {
    console.log(`${wedged.length} bridge(s) wedged — port bound but probe failed:\n`);
    for (const r of wedged) {
      const entry = BRIDGE_CATALOG.find((e) => e.name === r.name);
      console.log(`  ✗ ${entry?.label ?? r.name} (:${entry?.port ?? '?'}) — port held by another process. Run \`npm run bridges:doctor\` for recovery.`);
    }
    console.log('');
  }

  if (startable.length > 0) {
    console.log(`Starting ${startable.length} offline bridge${startable.length === 1 ? '' : 's'}...\n`);
    for (const r of startable) {
      const entry = BRIDGE_CATALOG.find((e) => e.name === r.name);
      if (!entry) continue;
      const { pid } = startBridge(entry);
      console.log(`  → ${entry.label.padEnd(18)} spawned (pid=${pid ?? '?'}) — log: /tmp/uc-bridges/${entry.name}.log`);
    }
    console.log('\nWaiting 3s for ports to bind...\n');
    await new Promise((r) => setTimeout(r, 3000));
  }

  const after = await probeBridges();
  console.log(summarizeBridgeProbes(after));
  console.log('');

  const stillOffline = after.filter((r) => r.status === 'offline');
  if (stillOffline.length > 0) {
    console.error(`${stillOffline.length} bridge(s) still offline — check /tmp/uc-bridges/*.log or run \`npm run bridges:doctor\`.`);
    process.exit(2);
  }
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
