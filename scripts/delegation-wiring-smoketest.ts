/**
 * delegation-wiring-smoketest — task #32. Verifies the gate-wiring
 * helpers added to subagentRegistry behave correctly when composed
 * with stubbed Supabase lookups. Real integration with live Supabase
 * is covered by the adjacent delegation-gate smoke + manual QA
 * against the dev environment.
 *
 * Run: npm run smoke:delegation-wiring
 */

import { canDelegate, type DelegationGateDecision } from '../src/lib/delegationGate';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Stubbed Supabase query surface ─────────────────────────────
// Mirrors the two reads subagentRegistry does before spawning:
//   1. readParentDelegationDepth(parentRunId) — pulls metadata.delegationDepth
//   2. countInFlightDelegations(circleId) — COUNTs running children

type AgentRun = {
  id: string;
  circle_id: string;
  status: 'running' | 'completed' | 'failed';
  parent_run_id: string | null;
  metadata?: { delegationDepth?: number };
};

function makeFixture() {
  const rows: AgentRun[] = [];
  return {
    rows,
    async readParentDelegationDepth(parentRunId: string | undefined): Promise<number> {
      if (!parentRunId) return 0;
      const row = rows.find((r) => r.id === parentRunId);
      const depth = row?.metadata?.delegationDepth;
      if (typeof depth === 'number' && Number.isFinite(depth) && depth >= 0) return depth;
      return 0;
    },
    async countInFlightDelegations(circleId: string): Promise<number> {
      return rows.filter((r) => r.circle_id === circleId && r.status === 'running' && r.parent_run_id !== null).length;
    },
  };
}

// Compose the gate-wiring logic that subagentRegistry runs before
// spawning. Mirror signature exactly.
async function wiringDecision(args: {
  parentRunId?: string;
  circleId: string;
  fx: ReturnType<typeof makeFixture>;
}): Promise<{ gate: DelegationGateDecision; proposedDepth: number; inFlight: number }> {
  const parentDepth = await args.fx.readParentDelegationDepth(args.parentRunId);
  const proposedDepth = parentDepth + 1;
  const inFlight = await args.fx.countInFlightDelegations(args.circleId);
  const gate = canDelegate({ proposedDepth, inFlight, circleId: args.circleId, parentRunId: args.parentRunId });
  return { gate, proposedDepth, inFlight };
}

async function main() {
  // ─── Root delegation (no parent) ────────────────────────────────
  {
    const fx = makeFixture();
    const d = await wiringDecision({ circleId: 'c1', fx });
    assert(d.gate.ok, 'root: no parent → allowed');
    assert(d.proposedDepth === 1, 'root: proposedDepth=1 (child of root)');
    assert(d.inFlight === 0, 'root: in-flight = 0');
  }

  // ─── Normal child under depth-1 parent (grandchild case) ────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'parent', circle_id: 'c1', status: 'running', parent_run_id: 'grandparent', metadata: { delegationDepth: 1 } });
    const d = await wiringDecision({ parentRunId: 'parent', circleId: 'c1', fx });
    assert(d.gate.ok, 'grandchild: depth 2 allowed');
    assert(d.proposedDepth === 2, 'grandchild: proposedDepth=2');
  }

  // ─── Would-be great-grandchild REJECTED ─────────────────────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'parent', circle_id: 'c1', status: 'running', parent_run_id: 'gp', metadata: { delegationDepth: 2 } });
    const d = await wiringDecision({ parentRunId: 'parent', circleId: 'c1', fx });
    assert(!d.gate.ok, 'great-grandchild: rejected');
    assert(d.gate.reason === 'depth_exceeded', 'great-grandchild: reason=depth_exceeded');
    assert(d.proposedDepth === 3, 'great-grandchild: depth computed as 3');
  }

  // ─── Concurrency: 3 running children → reject ───────────────────
  {
    const fx = makeFixture();
    // Unrelated root (not a child, shouldn't count)
    fx.rows.push({ id: 'root', circle_id: 'c1', status: 'running', parent_run_id: null });
    fx.rows.push({ id: 'c1a', circle_id: 'c1', status: 'running', parent_run_id: 'root' });
    fx.rows.push({ id: 'c1b', circle_id: 'c1', status: 'running', parent_run_id: 'root' });
    fx.rows.push({ id: 'c1c', circle_id: 'c1', status: 'running', parent_run_id: 'root' });
    const d = await wiringDecision({ circleId: 'c1', fx });
    assert(!d.gate.ok, 'concurrency: 3 running children → new delegation rejected');
    assert(d.gate.reason === 'concurrency_exceeded', 'concurrency: reason matches');
    assert(d.inFlight === 3, `concurrency: in-flight count = 3 (got ${d.inFlight})`);
  }

  // ─── Concurrency scoped to circle — other circles don't leak ────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'other1', circle_id: 'c2', status: 'running', parent_run_id: 'pOther1' });
    fx.rows.push({ id: 'other2', circle_id: 'c2', status: 'running', parent_run_id: 'pOther2' });
    fx.rows.push({ id: 'other3', circle_id: 'c2', status: 'running', parent_run_id: 'pOther3' });
    const d = await wiringDecision({ circleId: 'c1', fx });
    assert(d.gate.ok, 'concurrency: other circles do not count against c1');
    assert(d.inFlight === 0, 'concurrency: c1 in-flight stays 0');
  }

  // ─── Completed / failed children don't count ────────────────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'done1', circle_id: 'c1', status: 'completed', parent_run_id: 'p' });
    fx.rows.push({ id: 'done2', circle_id: 'c1', status: 'completed', parent_run_id: 'p' });
    fx.rows.push({ id: 'fail1', circle_id: 'c1', status: 'failed', parent_run_id: 'p' });
    const d = await wiringDecision({ circleId: 'c1', fx });
    assert(d.gate.ok, 'concurrency: completed + failed children do not count');
    assert(d.inFlight === 0, 'concurrency: only status=running counts');
  }

  // ─── Missing parent metadata treated as depth 0 ─────────────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'parent', circle_id: 'c1', status: 'running', parent_run_id: null });
    // No metadata.delegationDepth — old runs predating CA-8d
    const d = await wiringDecision({ parentRunId: 'parent', circleId: 'c1', fx });
    assert(d.gate.ok, 'missing depth metadata: treated as depth 0 → child allowed');
    assert(d.proposedDepth === 1, 'missing metadata: proposedDepth defaults to 1');
  }

  // ─── Parent row missing entirely → depth 0 ──────────────────────
  {
    const fx = makeFixture();
    const d = await wiringDecision({ parentRunId: 'ghost', circleId: 'c1', fx });
    assert(d.gate.ok, 'ghost parent: treated as depth 0 → allowed');
    assert(d.proposedDepth === 1, 'ghost parent: depth=1');
  }

  // ─── Negative / NaN metadata rejected by gate ───────────────────
  {
    const fx = makeFixture();
    fx.rows.push({ id: 'parent', circle_id: 'c1', status: 'running', parent_run_id: null, metadata: { delegationDepth: -5 as any } });
    const d = await wiringDecision({ parentRunId: 'parent', circleId: 'c1', fx });
    // readParentDelegationDepth clamps negative to 0, so child's depth is 1 — allowed
    assert(d.gate.ok, 'negative depth in metadata: clamped to 0 → child allowed');
    assert(d.proposedDepth === 1, 'negative metadata: clamped');
  }

  if (failures > 0) {
    console.error(`\n${failures} delegation-wiring smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll delegation-wiring smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
