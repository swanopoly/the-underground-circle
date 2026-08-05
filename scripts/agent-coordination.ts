#!/usr/bin/env -S npx tsx
/**
 * agent-coordination — a portable CLI so ANY agent (this app, an external Claude
 * Code / Cursor, or a human) can coordinate file edits on a shared repo via the
 * `.uc/agent-locks.json` advisory-lease registry. Thin node:fs wrapper over the
 * pure router `src/lib/agentCoordinationCli.ts`.
 *
 *   npx tsx scripts/agent-coordination.ts status
 *   npx tsx scripts/agent-coordination.ts claim src/lib/foo.ts --as cursor --intent "refactor"
 *   npx tsx scripts/agent-coordination.ts check src/lib/foo.ts --as claude
 *   npx tsx scripts/agent-coordination.ts release src/lib/foo.ts --as cursor
 *
 * Identity: pass --as <label> (or set UC_AGENT_LABEL). Each agent uses a distinct
 * stable label. Registry root defaults to CWD; override with --root <dir>.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runCoordinationCommand } from '../src/lib/agentCoordinationCli';
import type { LeaseRegistry } from '../src/lib/agentFileLeaseCore';

function resolveRoot(argv: string[]): string {
  const i = argv.indexOf('--root');
  if (i >= 0 && argv[i + 1]) return path.resolve(String(argv[i + 1]));
  return process.cwd();
}

function main(): void {
  const argv = process.argv.slice(2);
  const root = resolveRoot(argv);
  const lockPath = path.join(root, '.uc', 'agent-locks.json');

  const readRegistry = (): LeaseRegistry => {
    try {
      return JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LeaseRegistry;
    } catch {
      return { version: 1, leases: {} };
    }
  };
  const writeRegistry = (registry: LeaseRegistry): boolean => {
    try {
      fs.mkdirSync(path.dirname(lockPath), { recursive: true });
      fs.writeFileSync(lockPath, JSON.stringify(registry, null, 2), 'utf8');
      return true;
    } catch {
      return false;
    }
  };

  const res = runCoordinationCommand(argv, { readRegistry, writeRegistry, now: () => Date.now() }, process.env.UC_AGENT_LABEL);
  const wantsJson = argv.includes('--json');
  if (wantsJson) {
    process.stdout.write(`${JSON.stringify({ exitCode: res.exitCode, data: res.data ?? null, lines: res.lines }, null, 2)}\n`);
  } else {
    process.stdout.write(`${res.lines.join('\n')}\n`);
  }
  process.exit(res.exitCode);
}

main();
