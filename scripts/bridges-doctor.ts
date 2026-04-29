/**
 * bridges-doctor — diagnose bridge failures the regular probe can't
 * explain.
 *
 * Symptom we hit on 2026-04-29: a `claude-bridge.js` process running
 * as root was holding port 18790 but the proxy was wedged (HTTP 502
 * from somewhere upstream, no listening socket visible to the user's
 * `lsof`). `npm run check:bridges` correctly reported "offline" but
 * couldn't tell us:
 *   • the port WAS held (just by a foreign user),
 *   • we needed sudo to recover,
 *   • the recovery command ("kill 46571 && restart") was specific.
 *
 * This doctor goes a layer deeper. For each catalog entry it:
 *   1. Probes /health (same as check:bridges).
 *   2. If the bridge is healthy/degraded → done, just report.
 *   3. If offline → look up the port via `lsof`. Three cases:
 *      a. nobody listening      → simple "start the bridge" hint
 *      b. our user listening    → wedged-but-running, suggest restart
 *      c. another user listening → permission issue, give sudo command
 *   4. Auth-missing degraded states get the per-bridge auth command.
 *
 * Run: `npm run bridges:doctor`
 *
 * Exit codes:
 *   0 — every bridge healthy or only auth-missing degraded
 *   2 — at least one wedged or offline bridge needs intervention
 */

import { execSync } from 'node:child_process';
import { BRIDGE_CATALOG, probeBridges, type BridgeProbeResult, type BridgeCatalogEntry } from '../src/lib/bridgeHealthDiag';

interface PortHolder {
  pid: number;
  user: string;
  command: string;
}

/**
 * Look up which process is bound to the given TCP port via `lsof`.
 * Returns null when nothing is listening — but also returns null when
 * the socket is owned by another user our lsof can't see.
 */
function findPortHolderViaLsof(port: number): PortHolder | null {
  try {
    const out = execSync(
      `lsof -nP -iTCP:${port} -sTCP:LISTEN -F pcLn 2>/dev/null`,
      { encoding: 'utf-8', timeout: 3000 },
    ).toString();
    if (!out.trim()) return null;
    const fields: Record<string, string> = {};
    for (const line of out.split('\n')) {
      if (!line) continue;
      const tag = line[0];
      const val = line.slice(1);
      if (tag === 'p' || tag === 'c' || tag === 'L') {
        fields[tag] = val;
      }
    }
    if (!fields.p) return null;
    return {
      pid: Number(fields.p),
      user: fields.L || 'unknown',
      command: fields.c || 'unknown',
    };
  } catch {
    return null;
  }
}

/**
 * Detect whether ANY process (regardless of owner) is listening on the
 * port. Uses macOS / BSD `netstat` which doesn't require lsof's
 * permission to inspect foreign sockets. Returns true when the port is
 * bound, false otherwise.
 */
function isPortBound(port: number): boolean {
  try {
    const out = execSync(
      `netstat -an -p tcp 2>/dev/null | grep -E "\\.${port}[[:space:]]+.*LISTEN"`,
      { encoding: 'utf-8', timeout: 3000 },
    ).toString();
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * When lsof can't see the holder (foreign user), fall back to scanning
 * all processes by command name. Matches against the bridge script's
 * filename so we find e.g. `node openswan-proxy.js` regardless of who
 * launched it.
 */
function findHolderByProcessName(scriptName: string): PortHolder | null {
  try {
    const out = execSync(
      `ps -A -o pid=,user=,command= 2>/dev/null`,
      { encoding: 'utf-8', timeout: 3000 },
    ).toString();
    for (const line of out.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Match script basename anywhere in the command line.
      if (!trimmed.includes(scriptName)) continue;
      // Skip the doctor itself and grep matches.
      if (trimmed.includes('bridges-doctor')) continue;
      if (/\bgrep\b/.test(trimmed)) continue;
      const m = trimmed.match(/^(\d+)\s+(\S+)\s+(.*)$/);
      if (!m) continue;
      return {
        pid: Number(m[1]),
        user: m[2],
        command: m[3].slice(0, 80),
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Combine lsof (precise) with netstat + ps fallback (foreign-user-safe).
 */
function findPortHolder(port: number, scriptName: string): { holder: PortHolder | null; portBound: boolean } {
  const direct = findPortHolderViaLsof(port);
  if (direct) return { holder: direct, portBound: true };
  const portBound = isPortBound(port);
  if (!portBound) return { holder: null, portBound: false };
  // Port is bound but lsof can't see — try process scan.
  const indirect = findHolderByProcessName(scriptName);
  return { holder: indirect, portBound: true };
}

/**
 * Extract the script filename from a restartCommand like
 * "node scripts/claude-bridge.js" → "claude-bridge.js".
 */
function scriptNameFromRestart(cmd: string): string {
  const parts = cmd.split(/\s+/);
  const last = parts[parts.length - 1] || '';
  return last.split('/').pop() || last;
}

function currentUser(): string {
  try {
    return execSync('whoami', { encoding: 'utf-8', timeout: 1000 }).trim();
  } catch {
    return process.env.USER || 'unknown';
  }
}

interface Diagnosis {
  result: BridgeProbeResult;
  kind:
    | 'healthy'
    | 'auth-missing'
    | 'wedged-foreign-user'
    | 'wedged-same-user'
    | 'port-free'
    | 'offline';
  holder?: PortHolder;
  hint: string;
  fix?: string;          // copy-pasteable shell command
}

function diagnose(result: BridgeProbeResult, entry: BridgeCatalogEntry, me: string): Diagnosis {
  if (result.status === 'healthy') {
    return { result, kind: 'healthy', hint: 'all good' };
  }
  if (result.status === 'degraded' && result.authMissing) {
    return {
      result,
      kind: 'auth-missing',
      hint: result.hint || `Bridge running but unauthenticated.`,
    };
  }
  // Status is 'offline' (or rare 'degraded' without authMissing) — go deeper.
  const scriptName = scriptNameFromRestart(entry.restartCommand);
  const { holder, portBound } = findPortHolder(entry.port, scriptName);

  if (!portBound && !holder) {
    return {
      result,
      kind: 'port-free',
      hint: `Nothing listening on :${entry.port}. Start the bridge.`,
      fix: `nohup ${entry.restartCommand} > /tmp/uc-bridges/${entry.name}.log 2>&1 & disown`,
    };
  }
  // Port is bound but unhealthy. If we couldn't identify the holder
  // (foreign user with hidden socket and no matching process), assume
  // foreign user and recommend pkill by name.
  if (!holder) {
    return {
      result,
      kind: 'wedged-foreign-user',
      hint: `Port :${entry.port} is bound but no process matches "${scriptName}" in our view — likely held by another user. Probe failed.`,
      fix: `sudo pkill -f "${scriptName}" && sleep 1 && nohup ${entry.restartCommand} > /tmp/uc-bridges/${entry.name}.log 2>&1 & disown`,
    };
  }
  if (holder.user !== me) {
    return {
      result,
      kind: 'wedged-foreign-user',
      holder,
      hint: `Port :${entry.port} held by PID ${holder.pid} (${holder.command}) running as ${holder.user}, NOT ${me}. Probe failed — likely wedged. You need elevated privileges to recover.`,
      fix: `sudo kill ${holder.pid} && sleep 1 && nohup ${entry.restartCommand} > /tmp/uc-bridges/${entry.name}.log 2>&1 & disown`,
    };
  }
  return {
    result,
    kind: 'wedged-same-user',
    holder,
    hint: `Port :${entry.port} held by PID ${holder.pid} (${holder.command}) but probe failed — process appears wedged.`,
    fix: `kill ${holder.pid} && sleep 1 && nohup ${entry.restartCommand} > /tmp/uc-bridges/${entry.name}.log 2>&1 & disown`,
  };
}

function statusIcon(kind: Diagnosis['kind']): string {
  switch (kind) {
    case 'healthy': return '✓';
    case 'auth-missing': return '⚠';
    case 'wedged-foreign-user': return '✗';
    case 'wedged-same-user': return '✗';
    case 'port-free': return '✗';
    case 'offline': return '✗';
  }
}

async function main() {
  const me = currentUser();
  console.log(`Running as ${me}. Probing bridges...\n`);
  const probes = await probeBridges();

  const diagnoses = probes.map((p) => {
    const entry = BRIDGE_CATALOG.find((e) => e.name === p.name);
    if (!entry) {
      return { result: p, kind: 'offline' as const, hint: 'unknown bridge entry' };
    }
    return diagnose(p, entry, me);
  });

  const counts = { healthy: 0, degraded: 0, broken: 0 };
  for (const d of diagnoses) {
    if (d.kind === 'healthy') counts.healthy += 1;
    else if (d.kind === 'auth-missing') counts.degraded += 1;
    else counts.broken += 1;
  }

  console.log(`Bridges: ${counts.healthy} healthy · ${counts.degraded} degraded · ${counts.broken} broken\n`);

  for (const d of diagnoses) {
    const icon = statusIcon(d.kind);
    const portCol = `:${d.result.port}`.padEnd(7);
    console.log(`${icon} ${d.result.label.padEnd(18)} ${portCol} ${d.kind}`);
    console.log(`    → ${d.hint}`);
    if (d.fix) {
      console.log(`    fix: ${d.fix}`);
    }
    console.log('');
  }

  // Summary suggestion if anything is wedged-foreign-user.
  const foreignWedged = diagnoses.filter((d) => d.kind === 'wedged-foreign-user');
  if (foreignWedged.length > 0) {
    console.log('---');
    console.log(`${foreignWedged.length} bridge(s) wedged under another user. Run the fix command(s) above in your shell.`);
    console.log(`Prevent recurrence: never start bridges via \`sudo npm run …\`. Use plain \`npm run dev\` or \`npm run bridges:up\`.`);
  }

  process.exit(counts.broken > 0 ? 2 : 0);
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
