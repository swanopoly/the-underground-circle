/**
 * agent-coordination-cli-smoketest — the pure command router
 * (src/lib/agentCoordinationCli.ts) with in-memory injected I/O. Verifies the
 * claim → held-by-other → release → reclaim flow, check/status/heartbeat/prune,
 * exit codes, arg parsing (--as/--intent/--ttl/env), and the not-persisted path.
 *
 * Pure — the router imports only the pure lease core; I/O is injected here.
 */

import { runCoordinationCommand, parseCoordinationArgs } from '../src/lib/agentCoordinationCli';
import type { LeaseRegistry } from '../src/lib/agentFileLeaseCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

/** In-memory registry deps with a fixed clock. */
function makeDeps(t: number, canWrite = true) {
  let reg: LeaseRegistry = { version: 1, leases: {} };
  return {
    readRegistry: () => reg,
    writeRegistry: (r: LeaseRegistry) => { if (canWrite) reg = r; return canWrite; },
    now: () => t,
    peek: () => reg,
    setNow: (_n: number) => { /* fixed in this harness */ },
  };
}

function main(): void {
  const T = 5_000_000;

  // ─── (1) arg parsing ──────────────────────────────────────────────────────
  const p1 = parseCoordinationArgs(['claim', 'src/x.ts', '--as', 'cursor', '--intent', 'refactor', '--ttl', '30']);
  assertEq(p1.command, 'claim', '(1) command parsed');
  assertEq(p1.path, 'src/x.ts', '(1) path parsed');
  assertEq(p1.label, 'cursor', '(1) --as label parsed');
  assertEq(p1.intent, 'refactor', '(1) --intent parsed');
  assertEq(p1.ttlMs, 30_000, '(1) --ttl seconds → ms');
  assertEq(parseCoordinationArgs(['status'], 'envLabel').label, 'envLabel', '(1) env label fallback');
  assertEq(parseCoordinationArgs([]).command, '', '(1) empty argv → empty command');
  assertEq(parseCoordinationArgs(['status']).label, 'cli-agent', '(1) default label');

  // ─── (2) status on empty registry ─────────────────────────────────────────
  const d = makeDeps(T);
  const s0 = runCoordinationCommand(['status'], d);
  assertEq(s0.exitCode, 0, '(2) status exit 0');
  assert(s0.lines.join(' ').toLowerCase().includes('no files'), '(2) empty status message');

  // ─── (3) claim → held-by-other → check ────────────────────────────────────
  const c1 = runCoordinationCommand(['claim', 'src/x.ts', '--as', 'A', '--intent', 'edit x'], d);
  assertEq(c1.exitCode, 0, '(3) A claims → exit 0');
  assert(c1.lines[0].startsWith('GRANTED'), '(3) GRANTED', c1.lines[0]);
  assert('src/x.ts' in d.peek().leases, '(3) lease persisted to registry');

  const c2 = runCoordinationCommand(['claim', 'src/x.ts', '--as', 'B'], d);
  assertEq(c2.exitCode, 1, '(3) B blocked → exit 1');
  assert(c2.lines[0].startsWith('DENIED'), '(3) DENIED for B', c2.lines[0]);
  assertEq(d.peek().leases['src/x.ts'].ownerId, 'A', '(3) denied claim did not steal the lease');

  assertEq(runCoordinationCommand(['check', 'src/x.ts', '--as', 'B'], d).exitCode, 1, '(3) check by B → held (exit 1)');
  assertEq(runCoordinationCommand(['check', 'src/x.ts', '--as', 'A'], d).exitCode, 0, '(3) check by A (owner) → free (exit 0)');
  assertEq(runCoordinationCommand(['check', 'src/y.ts', '--as', 'B'], d).exitCode, 0, '(3) check unseen file → free');

  // ─── (4) A renews (heartbeat), B cannot ───────────────────────────────────
  assertEq(runCoordinationCommand(['heartbeat', 'src/x.ts', '--as', 'A'], d).exitCode, 0, '(4) owner heartbeat ok');
  assertEq(runCoordinationCommand(['heartbeat', 'src/x.ts', '--as', 'B'], d).exitCode, 1, '(4) non-owner heartbeat denied');

  // ─── (5) status lists the active lease ────────────────────────────────────
  const s1 = runCoordinationCommand(['status', '--json'], d);
  assert(s1.lines.join('\n').includes('src/x.ts'), '(5) status lists x.ts');
  assert(Array.isArray((s1.data as any)?.active) && (s1.data as any).active.length === 1, '(5) status data.active has 1 lease');

  // ─── (6) release: non-owner denied, owner ok, then B can claim ────────────
  assertEq(runCoordinationCommand(['release', 'src/x.ts', '--as', 'B'], d).exitCode, 1, '(6) B cannot release A’s active lease');
  assertEq(runCoordinationCommand(['release', 'src/x.ts', '--as', 'A'], d).exitCode, 0, '(6) A releases');
  assert(!('src/x.ts' in d.peek().leases), '(6) lease removed after release');
  assertEq(runCoordinationCommand(['claim', 'src/x.ts', '--as', 'B'], d).exitCode, 0, '(6) B claims after release');

  // ─── (7) prune (no expired here → 0 dropped) ──────────────────────────────
  const pr = runCoordinationCommand(['prune'], d);
  assertEq(pr.exitCode, 0, '(7) prune exit 0');
  assertEq((pr.data as any)?.dropped, 0, '(7) nothing expired to drop');

  // ─── (8) not-persisted path → WARNING but still ok ────────────────────────
  const dRO = makeDeps(T, false); // writeRegistry returns false
  const cRO = runCoordinationCommand(['claim', 'src/z.ts', '--as', 'A'], dRO);
  assertEq(cRO.exitCode, 0, '(8) claim still ok when registry not writable');
  assert(cRO.lines.some((l) => /WARNING/.test(l)), '(8) warns that registry was not persisted');

  // ─── (9) usage / unknown / missing-path → exit 2 or 2/usage ───────────────
  assertEq(runCoordinationCommand([], d).exitCode, 2, '(9) empty → usage exit 2');
  assertEq(runCoordinationCommand(['frobnicate'], d).exitCode, 2, '(9) unknown command → exit 2');
  assertEq(runCoordinationCommand(['claim'], d).exitCode, 2, '(9) claim without path → usage exit 2');
  assert(runCoordinationCommand(['help'], d).lines.join('\n').includes('Usage:'), '(9) help shows usage');

  // ─── (10) degenerate never throws ─────────────────────────────────────────
  try {
    runCoordinationCommand(undefined as any, d);
    runCoordinationCommand(['status'], d);
    parseCoordinationArgs(undefined as any);
    passes += 1;
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (10) degenerate threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll agent-coordination-cli smoke cases passed (${passes} passed).`);
}

main();
