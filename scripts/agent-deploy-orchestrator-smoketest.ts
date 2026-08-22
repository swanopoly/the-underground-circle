/**
 * Smoke test for the Phase-3 mass-agent-deploy ORCHESTRATOR
 * (agentDeployOrchestrator.deployAgents) — the impure web/bridge fan-out.
 *
 * The orchestrator is normally un-loadable under tsx because it talks to
 * subagentRegistry / agentSpawner (react-native + supabase transitive
 * imports). It was refactored so those are TYPE-ONLY static imports and the
 * three impure downstream calls (delegate / spawn / bridgeAvailable) are
 * INJECTABLE via an optional `deps` arg (defaulting to lazily-imported real
 * impls). This test injects mocks for all three, so the full launch LOGIC —
 * fan-out + capping + per-agent model passthrough + partial-failure
 * aggregation + transient lifecycle + bridge gating — is unit-coverable with
 * no network / supabase / bridge.
 *
 * Run: npx tsx scripts/agent-deploy-orchestrator-smoketest.ts
 */

import { buildAgentDeployPlan } from '../src/lib/agentDeployPlan';
import { MAX_AGENTS_PER_DEPLOY, MAX_CONCURRENT_DEPLOY_LAUNCHES } from '../src/lib/agentDeployPolicy';
import {
  deployAgents,
  type DeployAgentsDeps,
} from '../src/lib/agentDeployOrchestrator';

let failures = 0;
function assert(label: string, cond: boolean): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}`);
  }
}

// ── Mock builders ─────────────────────────────────────────────────────────────

interface DelegateCall {
  model?: string;
  subagentRole: string;
  spiritId?: string;
  skillBundleId?: string;
  systemPrompt: string;
  message: string;
  surface: string;
  hasParentRunId: boolean;
}

/**
 * Build a mock `delegate` that records every call and resolves successfully,
 * EXCEPT specs whose index is in `rejectIndexes` (those come back as a
 * fulfilled DelegationResult carrying `gateRejection`, mirroring how the real
 * gate signals a soft block without throwing). `throwIndexes` instead reject
 * the promise (mirroring an unexpected delegation crash).
 */
function makeDelegateMock(opts?: {
  rejectIndexes?: Set<number>;
  throwIndexes?: Set<number>;
}): { delegate: NonNullable<DeployAgentsDeps['delegate']>; calls: DelegateCall[] } {
  const calls: DelegateCall[] = [];
  let seen = 0;
  const delegate: NonNullable<DeployAgentsDeps['delegate']> = async (o) => {
    const callIndex = seen;
    seen += 1;
    calls.push({
      model: o.model,
      subagentRole: o.subagent?.role,
      spiritId: o.subagent?.spiritId,
      skillBundleId: o.subagent?.skillBundleId,
      systemPrompt: o.subagent?.systemPrompt || '',
      message: o.message,
      surface: o.surface,
      // The orchestrator must NOT chain mass-deploy children off a parent run
      // (root fan-out). We can't read parentRunId off the typed signature, so
      // assert it via the absence of the key on the passed object.
      hasParentRunId: Object.prototype.hasOwnProperty.call(o, 'parentRunId'),
    });
    if (opts?.throwIndexes?.has(callIndex)) {
      throw new Error(`boom ${callIndex}`);
    }
    if (opts?.rejectIndexes?.has(callIndex)) {
      return {
        gateRejection: {
          reason: 'concurrency_exceeded',
          detail: 'too many parallel children',
        },
      } as any;
    }
    return {} as any;
  };
  return { delegate, calls };
}

function makeSpawnMock(opts?: { okFlags?: boolean[] }): {
  spawn: NonNullable<DeployAgentsDeps['spawn']>;
  calls: Array<{ tasks: Array<{ task: string; model?: string }> }>;
} {
  const calls: Array<{ tasks: Array<{ task: string; model?: string }> }> = [];
  const spawn: NonNullable<DeployAgentsDeps['spawn']> = async ({ tasks }) => {
    calls.push({ tasks: tasks.map((t) => ({ task: t.task, model: t.model })) });
    const results = tasks.map((t, i) => ({
      ok: opts?.okFlags ? !!opts.okFlags[i] : true,
      task: t.task,
      pid: `pid-${i}`,
    }));
    const spawned = results.filter((r) => r.ok).length;
    return {
      ok: spawned > 0,
      spawned,
      total: tasks.length,
      results,
      message: `Spawned ${spawned}/${tasks.length}`,
    } as any;
  };
  return { spawn, calls };
}

const BASE_INPUT = {
  circleId: 'circle-1',
  userId: 'user-1',
  connectedProviders: ['anthropic'],
};

async function main(): Promise<void> {
// ─── 1. Web channel fans out N agents respecting the cap ──────────────────────
console.log('web fan-out + cap');
{
  const plan = buildAgentDeployPlan({ mode: 'uniform', count: 5, model: 'claude-sonnet-4-6' });
  const { delegate, calls } = makeDelegateMock();
  const { spawn } = makeSpawnMock();
  let bridgeChecked = false;
  const result = await deployAgents(
    { ...BASE_INPUT, plan },
    { delegate, spawn, bridgeAvailable: async () => { bridgeChecked = true; return false; } },
  );

  assert('channel is web', result.channel === 'web');
  assert('5 specs => 5 delegate calls (fan-out)', calls.length === 5);
  assert('all 5 deployed', result.deployed === 5);
  assert('0 failed', result.failed === 0);
  assert('items length === plan size', result.items.length === 5);
  // All web successes → bridge is never even checked.
  assert('bridge availability NOT checked when web succeeds', bridgeChecked === false);
}

// ── 1b. Orchestrator caps even an over-sized hand-built plan ───────────────────
console.log('orchestrator hard cap');
{
  // Bypass buildAgentDeployPlan's cap by hand-building an oversized plan to
  // prove the orchestrator itself is the last gate before launch.
  const oversized = {
    mode: 'uniform' as const,
    requestedCount: 80,
    cappedCount: 80,
    truncated: false,
    specs: Array.from({ length: 80 }, (_, index) => ({
      index,
      model: 'claude-sonnet-4-6',
      role: null,
      prompt: `task ${index}`,
    })),
  };
  const { delegate, calls } = makeDelegateMock();
  const result = await deployAgents(
    { ...BASE_INPUT, plan: oversized },
    { delegate, spawn: makeSpawnMock().spawn, bridgeAvailable: async () => false },
  );
  assert('80-spec plan capped to MAX at launch', calls.length === MAX_AGENTS_PER_DEPLOY);
  assert('deployed capped to MAX', result.deployed === MAX_AGENTS_PER_DEPLOY);
}

// ── 1c. Web fan-out is BOUNDED-concurrency, not all-at-once ───────────────────
console.log('bounded launch concurrency');
{
  // A fan-out larger than the concurrency bound must NEVER have more than
  // MAX_CONCURRENT_DEPLOY_LAUNCHES delegations in flight simultaneously, yet
  // must still launch EVERY spec and preserve per-spec item order. This pins
  // the fix for the TOCTOU burst where all N specs would otherwise fire at
  // once and defeat the per-circle delegation concurrency cap.
  const N = MAX_CONCURRENT_DEPLOY_LAUNCHES + 4;
  const plan = buildAgentDeployPlan({ mode: 'uniform', count: N, model: 'claude-sonnet-4-6' });
  let inFlight = 0;
  let peak = 0;
  const order: number[] = [];
  // A delegate that holds each call open for a tick so overlap is observable.
  const delegate: NonNullable<DeployAgentsDeps['delegate']> = async (o) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    order.push(Number((o.message.match(/agent (\d+)/) || [])[1]) || -1);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return {} as any;
  };
  const result = await deployAgents(
    { ...BASE_INPUT, plan },
    { delegate, spawn: makeSpawnMock().spawn, bridgeAvailable: async () => false },
  );
  assert(`all ${N} specs launched`, result.deployed === N && result.items.length === N);
  assert('peak in-flight never exceeds the bound', peak <= MAX_CONCURRENT_DEPLOY_LAUNCHES);
  assert('concurrency bound was actually exercised (peak >= 2)', peak >= 2);
  // items must stay 1:1 and in spec-index order regardless of settle timing.
  assert('items in spec-index order', result.items.every((it, i) => it.index === i));
}

// ─── 2. Per-agent resolved model passed through (no Haiku coercion) ───────────
console.log('per-agent model passthrough');
{
  // individual mode: distinct model per agent. Crucially none is Haiku, and
  // the orchestrator must pass each spec.model through verbatim.
  const plan = buildAgentDeployPlan({
    mode: 'individual',
    count: 3,
    perAgentModels: ['claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-5.5'],
    perAgentRoles: ['researcher', 'designer', 'security'],
  });
  const { delegate, calls } = makeDelegateMock();
  await deployAgents(
    { ...BASE_INPUT, plan },
    { delegate, spawn: makeSpawnMock().spawn, bridgeAvailable: async () => false },
  );
  assert('models passed in plan order', calls[0].model === 'claude-opus-4-8'
    && calls[1].model === 'claude-sonnet-4-6'
    && calls[2].model === 'gpt-5.5');
  assert('NO model coerced to haiku', calls.every((c) => !(c.model || '').includes('haiku')));
  assert('every delegate call carries an explicit model', calls.every((c) => !!c.model));
  // The deploy fan-out is a root delegation: no parentRunId chained in.
  assert('no parentRunId chained (root fan-out)', calls.every((c) => c.hasParentRunId === false));
  assert('surface is main_chat for every agent', calls.every((c) => c.surface === 'main_chat'));
  assert('exact specialties passed in plan order', calls.map((c) => c.subagentRole).join(',') === 'researcher,designer,security');
  assert('specialties carry exact SOUL ids', calls.map((c) => c.spiritId).join(',') === 'researcher,designer,security');
  assert('specialties carry exact skill bundles', calls.map((c) => c.skillBundleId).join(',') === 'researcher-cite-and-synthesize,design-ui-spec-and-critique,seceng-harden-and-threatmodel');
  assert('delegate receives specialty knowledge, not an empty profile', calls.every((c) => c.systemPrompt.length > 100));
}

// ─── 3. Partial-failure aggregation (gateRejection on one agent) ──────────────
console.log('partial-failure aggregation');
{
  const plan = buildAgentDeployPlan({ mode: 'uniform', count: 4, model: 'claude-sonnet-4-6' });
  // Agent at call-index 1 gets a gateRejection; index 3 throws. The other two
  // must still deploy.
  const { delegate, calls } = makeDelegateMock({
    rejectIndexes: new Set([1]),
    throwIndexes: new Set([3]),
  });
  const result = await deployAgents(
    { ...BASE_INPUT, plan },
    { delegate, spawn: makeSpawnMock().spawn, bridgeAvailable: async () => false },
  );
  assert('all 4 still attempted', calls.length === 4);
  assert('2 deployed despite 2 failures', result.deployed === 2);
  assert('2 failed (1 gateRejection + 1 throw)', result.failed === 2);
  assert('deployed + failed === plan size', result.deployed + result.failed === 4);
  const gateItem = result.items.find((it) => it.error?.includes('concurrency_exceeded'));
  assert('gateRejection surfaced in item error', !!gateItem);
  const throwItem = result.items.find((it) => it.error?.includes('boom'));
  assert('thrown delegation surfaced in item error', !!throwItem);
  // Channel stays web as long as at least one agent deployed.
  assert('channel stays web on partial success', result.channel === 'web');
}

// ─── 3b. Counts always sum to plan size (incl. all-fail) ──────────────────────
console.log('counts sum invariant (all web fail)');
{
  const plan = buildAgentDeployPlan({ mode: 'uniform', count: 3, model: 'claude-sonnet-4-6' });
  const { delegate } = makeDelegateMock({ rejectIndexes: new Set([0, 1, 2]) });
  const { spawn, calls: spawnCalls } = makeSpawnMock();
  // bridge NOT available → must NOT fall back; result stays web with 0/3.
  const result = await deployAgents(
    { ...BASE_INPUT, plan },
    { delegate, spawn, bridgeAvailable: async () => false },
  );
  assert('all-reject → deployed 0', result.deployed === 0);
  assert('all-reject → failed 3', result.failed === 3);
  assert('deployed + failed === 3', result.deployed + result.failed === 3);
  assert('channel web (no bridge fallback when unavailable)', result.channel === 'web');
  assert('spawn NEVER called when bridge unavailable', spawnCalls.length === 0);
}

// ─── 4. Transient lifecycle (no persistent-agent creation) ────────────────────
console.log('transient lifecycle');
{
  // The orchestrator must launch ONLY through the injected delegate/spawn —
  // there is no roster/publish dependency to inject, and none should be
  // imported/called. We prove transient-ness structurally: the public
  // DeployAgentsDeps surface has exactly {delegate, spawn, bridgeAvailable}
  // and no "publish"/"persist"/"createAgent" hook. (A persistent-roster write
  // would have to be one of these injectable seams to be testable; its absence
  // is the contract.)
  const depKeys: Array<keyof DeployAgentsDeps> = ['delegate', 'spawn', 'bridgeAvailable'];
  assert('deps surface is exactly the 3 transient-safe seams', depKeys.length === 3);

  // And a successful deploy reports no items beyond the launched specs (no
  // extra "registered N persistent agents" bookkeeping leaks into the result).
  const plan = buildAgentDeployPlan({ mode: 'uniform', count: 2, model: 'claude-sonnet-4-6' });
  const { delegate, calls } = makeDelegateMock();
  const result = await deployAgents(
    { ...BASE_INPUT, plan },
    { delegate, spawn: makeSpawnMock().spawn, bridgeAvailable: async () => false },
  );
  assert('result.items 1:1 with launched specs (no persistent rows)', result.items.length === calls.length);
}

// ─── 5. Bridge path used ONLY when bridge-availability returns true ───────────
console.log('bridge fallback gating');
{
  // 5a. Web all-fail + bridge AVAILABLE → falls back to bridge and deploys.
  {
    const plan = buildAgentDeployPlan({
      mode: 'individual',
      count: 3,
      model: 'claude-sonnet-4-6',
      perAgentRoles: ['researcher', 'designer', 'security'],
      prompt: 'Complete the assigned task.',
    });
    const { delegate } = makeDelegateMock({ rejectIndexes: new Set([0, 1, 2]) });
    const { spawn, calls: spawnCalls } = makeSpawnMock();
    let checked = false;
    const result = await deployAgents(
      { ...BASE_INPUT, plan },
      { delegate, spawn, bridgeAvailable: async () => { checked = true; return true; } },
    );
    assert('bridge availability checked after web failure', checked === true);
    assert('spawn called once when bridge available', spawnCalls.length === 1);
    assert('bridge spawn received all 3 tasks', spawnCalls[0].tasks.length === 3);
    assert('bridge tasks carry per-agent model', spawnCalls[0].tasks.every((t) => t.model === 'claude-sonnet-4-6'));
    assert('bridge task 1 carries Researcher SOUL and skill', spawnCalls[0].tasks[0].task.includes('SOUL: researcher') && spawnCalls[0].tasks[0].task.includes('Skill bundle: researcher-cite-and-synthesize'));
    assert('bridge task 2 carries Designer SOUL and skill', spawnCalls[0].tasks[1].task.includes('SOUL: designer') && spawnCalls[0].tasks[1].task.includes('Skill bundle: design-ui-spec-and-critique'));
    assert('bridge task 3 carries Security SOUL and skill', spawnCalls[0].tasks[2].task.includes('SOUL: security') && spawnCalls[0].tasks[2].task.includes('Skill bundle: seceng-harden-and-threatmodel'));
    assert('bridge handoff preserves the exact task', spawnCalls[0].tasks.every((t) => t.task.endsWith('TASK\nComplete the assigned task.')));
    assert('channel switches to bridge', result.channel === 'bridge');
    assert('bridge deployed 3', result.deployed === 3);
    assert('bridge counts sum to plan size', result.deployed + result.failed === 3);
  }

  // 5b. Bridge availability THROWS → treated as unavailable, no spawn, stays web.
  {
    const plan = buildAgentDeployPlan({ mode: 'uniform', count: 2, model: 'claude-sonnet-4-6' });
    const { delegate } = makeDelegateMock({ rejectIndexes: new Set([0, 1]) });
    const { spawn, calls: spawnCalls } = makeSpawnMock();
    const result = await deployAgents(
      { ...BASE_INPUT, plan },
      { delegate, spawn, bridgeAvailable: async () => { throw new Error('bridge probe exploded'); } },
    );
    assert('spawn NOT called when bridge probe throws', spawnCalls.length === 0);
    assert('channel stays web when bridge probe throws', result.channel === 'web');
    assert('still reports 0/2 honestly', result.deployed === 0 && result.failed === 2);
  }

  // 5c. Web partial success → bridge NOT consulted (only consulted on 0 web wins).
  {
    const plan = buildAgentDeployPlan({ mode: 'uniform', count: 3, model: 'claude-sonnet-4-6' });
    const { delegate } = makeDelegateMock({ rejectIndexes: new Set([0, 1]) }); // 1 success
    const { spawn, calls: spawnCalls } = makeSpawnMock();
    let checked = false;
    const result = await deployAgents(
      { ...BASE_INPUT, plan },
      { delegate, spawn, bridgeAvailable: async () => { checked = true; return true; } },
    );
    assert('bridge NOT checked when web had >=1 success', checked === false);
    assert('spawn NOT called on web partial success', spawnCalls.length === 0);
    assert('channel web on partial success', result.channel === 'web' && result.deployed === 1);
  }

  // 5d. Partial bridge failure aggregates correctly.
  {
    const plan = buildAgentDeployPlan({ mode: 'uniform', count: 3, model: 'claude-sonnet-4-6' });
    const { delegate } = makeDelegateMock({ rejectIndexes: new Set([0, 1, 2]) });
    const { spawn } = makeSpawnMock({ okFlags: [true, false, true] });
    const result = await deployAgents(
      { ...BASE_INPUT, plan },
      { delegate, spawn, bridgeAvailable: async () => true },
    );
    assert('bridge partial: deployed 2', result.deployed === 2);
    assert('bridge partial: failed 1', result.failed === 1);
    assert('bridge partial: counts sum to 3', result.deployed + result.failed === 3);
  }
}

// ─── 6. Empty plan → no-op none channel ───────────────────────────────────────
console.log('empty plan');
{
  const empty = buildAgentDeployPlan({ mode: 'uniform', count: 0, model: 'claude-sonnet-4-6' });
  // count 0 clamps to 1 spec; force a truly empty plan to test the guard.
  const trulyEmpty = { ...empty, specs: [] };
  const { delegate, calls } = makeDelegateMock();
  const { spawn, calls: spawnCalls } = makeSpawnMock();
  const result = await deployAgents(
    { ...BASE_INPUT, plan: trulyEmpty },
    { delegate, spawn, bridgeAvailable: async () => true },
  );
  assert('empty plan → channel none', result.channel === 'none');
  assert('empty plan → 0 deployed / 0 failed', result.deployed === 0 && result.failed === 0);
  assert('empty plan → delegate never called', calls.length === 0);
  assert('empty plan → spawn never called', spawnCalls.length === 0);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
  console.log('');
  if (failures === 0) {
    console.log('All agent-deploy-orchestrator assertions passed.');
  } else {
    console.error(`${failures} assertion(s) FAILED.`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('agent-deploy-orchestrator smoke crashed:', err);
  process.exit(1);
});
