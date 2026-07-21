// agentCoordinationCli — the PURE command router behind a portable coordination
// CLI (`scripts/agent-coordination.ts`). It lets ANY agent — this app's agents,
// an external Claude Code / Cursor session, or a human — claim / release / check
// file leases against the SAME `.uc/agent-locks.json` registry, using the same
// pure `agentFileLeaseCore` brain the in-app tool uses. This is how external
// agents (which can't call the in-app tool) participate in coordination.
// See docs/MULTI_AGENT_FILE_COORDINATION.md.
//
// PURITY: imports only the pure core; all I/O + the clock are DEPENDENCY-INJECTED
// (`deps.readRegistry/writeRegistry/now`), so this router is deterministic and
// fully smoke-testable (smoke: agent-coordination-cli). The thin `scripts/`
// wrapper injects node:fs + Date.now. Never throws.

import type { LeaseRegistry } from './agentFileLeaseCore';
import {
  acquireLease,
  renewLease,
  releaseLease,
  listActiveLeases,
  describeLeases,
  isPathFree,
  pruneExpired,
  normalizeLeasePath,
  LEASE_DEFAULT_TTL_MS,
} from './agentFileLeaseCore';

export interface CoordinationDeps {
  readRegistry: () => LeaseRegistry;
  writeRegistry: (registry: LeaseRegistry) => boolean;
  now: () => number;
}

export interface CoordinationResult {
  /** 0 ok/granted, 1 denied/held-by-other, 2 usage/error. */
  exitCode: number;
  lines: string[];
  /** Machine-readable summary (for the app tool / JSON callers). */
  data?: Record<string, unknown>;
}

const USAGE = [
  'agent-coordination — advisory file leases so agents do not clobber each other.',
  '',
  'Usage: <command> [path] [--as <label>] [--intent "<note>"] [--ttl <seconds>] [--json]',
  '',
  'Commands:',
  '  status | list            Show all active file leases (who is on what).',
  '  check <path>             Is <path> free for me? (exit 1 if held by another agent)',
  '  claim <path>             Acquire an exclusive lease on <path> (exit 1 if held).',
  '  release <path>           Release my lease on <path>.',
  '  heartbeat <path>         Extend my lease on <path> (long edits).',
  '  prune                    Drop expired leases from the registry.',
  '',
  'Identity: pass --as <label> (or set UC_AGENT_LABEL). Each agent MUST use a',
  'distinct, stable label — you renew/release only leases under your own label.',
].join('\n');

interface ParsedArgs {
  command: string;
  path: string;
  label: string;
  intent: string;
  ttlMs: number;
  json: boolean;
}

/** Parse CLI argv (command args only). `envLabel` is UC_AGENT_LABEL fallback. */
export function parseCoordinationArgs(argv: string[], envLabel?: string): ParsedArgs {
  const args = Array.isArray(argv) ? argv.map((a) => String(a)) : [];
  let label = typeof envLabel === 'string' && envLabel.trim() ? envLabel.trim() : '';
  let intent = '';
  let ttlSec = 0;
  let json = false;
  const positional: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--as' || a === '--owner') { label = String(args[++i] ?? '').trim(); }
    else if (a === '--intent') { intent = String(args[++i] ?? '').trim(); }
    else if (a === '--ttl') { ttlSec = parseInt(String(args[++i] ?? ''), 10); }
    else if (a === '--json') { json = true; }
    else if (a.startsWith('--')) { /* ignore unknown flag */ }
    else positional.push(a);
  }
  const command = (positional[0] || '').toLowerCase();
  const path = positional[1] || '';
  return {
    command,
    path,
    label: (label || 'cli-agent').slice(0, 80),
    intent,
    ttlMs: Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec * 1000 : LEASE_DEFAULT_TTL_MS,
    json,
  };
}

function ok(lines: string[], data?: Record<string, unknown>): CoordinationResult { return { exitCode: 0, lines, data }; }
function denied(lines: string[], data?: Record<string, unknown>): CoordinationResult { return { exitCode: 1, lines, data }; }
function usage(lines: string[]): CoordinationResult { return { exitCode: 2, lines }; }

/**
 * Run one coordination command. Pure: reads/writes the registry only through
 * `deps`, so it is deterministic and testable. The `label` acts as the ownerId
 * (each agent uses a distinct stable label). Never throws.
 */
export function runCoordinationCommand(argv: string[], deps: CoordinationDeps, envLabel?: string): CoordinationResult {
  const p = parseCoordinationArgs(argv, envLabel);
  const now = deps.now();
  const registry = deps.readRegistry();
  const ownerId = p.label; // label IS the identity for the CLI

  switch (p.command) {
    case 'status':
    case 'list': {
      const active = listActiveLeases(registry, now);
      const lines = [describeLeases(registry, now)];
      return ok(lines, { active });
    }
    case 'check': {
      if (!p.path) return usage(['check requires a <path>', '', USAGE]);
      const free = isPathFree(registry, p.path, ownerId, now);
      const holder = listActiveLeases(registry, now).find((l) => normalizeLeasePath(l.path) === normalizeLeasePath(p.path));
      if (free) return ok([`FREE: ${normalizeLeasePath(p.path)} is available${holder ? ' (you hold it)' : ''}.`], { free: true, holder: holder || null });
      return denied([`HELD: ${normalizeLeasePath(p.path)} is leased by ${holder?.ownerLabel || 'another agent'}${holder?.intent ? ` (${holder.intent})` : ''}.`], { free: false, holder });
    }
    case 'claim': {
      if (!p.path) return usage(['claim requires a <path>', '', USAGE]);
      const res = acquireLease(registry, { path: p.path, ownerId, ownerLabel: p.label, intent: p.intent, ttlMs: p.ttlMs }, now);
      if (!res.ok) {
        return denied([`DENIED: ${normalizeLeasePath(p.path)} — ${res.reason}. Pick another file or wait.`], { outcome: res.outcome, holder: res.holder });
      }
      const wrote = deps.writeRegistry(res.registry);
      const lines = [`${res.outcome.toUpperCase()}: ${normalizeLeasePath(p.path)} leased to ${p.label}${p.intent ? ` — ${p.intent}` : ''}.`];
      if (!wrote) lines.push('WARNING: registry could not be persisted — coordination is advisory only for this run.');
      return ok(lines, { outcome: res.outcome, lease: res.lease, persisted: wrote });
    }
    case 'release': {
      if (!p.path) return usage(['release requires a <path>', '', USAGE]);
      const res = releaseLease(registry, { path: p.path, ownerId }, now);
      if (!res.ok) return denied([`NOT RELEASED: ${normalizeLeasePath(p.path)} — ${res.reason} (you are not the holder).`], { outcome: res.outcome, holder: res.holder });
      const wrote = deps.writeRegistry(res.registry);
      return ok([`RELEASED: ${normalizeLeasePath(p.path)} (${res.outcome}).`], { outcome: res.outcome, persisted: wrote });
    }
    case 'heartbeat': {
      if (!p.path) return usage(['heartbeat requires a <path>', '', USAGE]);
      const res = renewLease(registry, { path: p.path, ownerId, ttlMs: p.ttlMs }, now);
      if (!res.ok) return denied([`NOT RENEWED: ${normalizeLeasePath(p.path)} — ${res.outcome}.`], { outcome: res.outcome });
      const wrote = deps.writeRegistry(res.registry);
      return ok([`RENEWED: ${normalizeLeasePath(p.path)}.`], { outcome: res.outcome, persisted: wrote });
    }
    case 'prune': {
      const pruned = pruneExpired(registry, now);
      const dropped = Object.keys(registry.leases).length - Object.keys(pruned.leases).length;
      const wrote = deps.writeRegistry(pruned);
      return ok([`PRUNED: ${dropped} expired lease(s) removed.`], { dropped, persisted: wrote });
    }
    case '':
    case 'help':
    case '--help':
    case '-h':
      return usage([USAGE]);
    default:
      return usage([`Unknown command: ${p.command}`, '', USAGE]);
  }
}
