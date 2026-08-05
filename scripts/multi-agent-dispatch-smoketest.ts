/**
 * multi-agent-dispatch-smoketest — verifies parseMultiAgentRequest
 * extracts leading agent mentions and returns null for everything
 * that isn't a multi-agent request.
 *
 * Run: `npx tsx scripts/multi-agent-dispatch-smoketest.ts`
 */
import {
  parseMultiAgentRequest,
  parseMultiAgentOrchestrationRequest,
  makeAliasResolver,
  BLACKSWAN_ALIASES,
} from '../src/lib/multiAgentDispatch';
import {
  buildSubagentLoopSummary,
  buildSubagentParentSummary,
  runSubagentTypedCoreLoop,
  type SubagentParentSummary,
} from '../src/lib/delegationGate';
import type { AgentProvider, AgentToolDefinition } from '../src/lib/agentExecutionCore';

let failures = 0;

function ok(msg: string) { console.log('  ok:', msg); }
function fail(msg: string, detail?: any) {
  failures += 1;
  console.error('FAIL:', msg);
  if (detail !== undefined) console.error('  detail:', JSON.stringify(detail));
}

// Build a resolver with a few agents + BlackSwan aliases
const aliases: Record<string, string> = { claudia: 'Claudia', gabe: 'Gabe', rio: 'Rio' };
for (const a of BLACKSWAN_ALIASES) aliases[a] = 'BlackSwan';
const resolve = makeAliasResolver(aliases);

// ─── Positive cases ──────────────────────────────────────────────────────

console.log('\nparseMultiAgentRequest — positive');

function expectMatch(
  input: string,
  expectedAgents: string[],
  expectedPrompt: string,
  msg: string,
) {
  const result = parseMultiAgentRequest(input, resolve);
  if (!result) { fail(msg + ' (returned null)', input); return; }
  const got = result.agents.map(a => a.resolvedName);
  if (JSON.stringify(got) !== JSON.stringify(expectedAgents)) {
    fail(msg + ` — agents mismatch (got ${JSON.stringify(got)}, want ${JSON.stringify(expectedAgents)})`, result);
    return;
  }
  if (result.cleanedPrompt !== expectedPrompt) {
    fail(msg + ` — prompt mismatch (got "${result.cleanedPrompt}", want "${expectedPrompt}")`, result);
    return;
  }
  ok(msg);
}

expectMatch(
  '@blackswan @claudia summarize what shipped today',
  ['BlackSwan', 'Claudia'],
  'summarize what shipped today',
  'two agents → summary task',
);

expectMatch(
  '@blackswan @claudia @gabe plan the next sprint',
  ['BlackSwan', 'Claudia', 'Gabe'],
  'plan the next sprint',
  'three agents → plan task',
);

expectMatch(
  '@Claudia @Gabe pick the better proposal',
  ['Claudia', 'Gabe'],
  'pick the better proposal',
  'mixed-case aliases resolve',
);

expectMatch(
  '@blackswan  @claudia    review the diff',  // extra whitespace
  ['BlackSwan', 'Claudia'],
  'review the diff',
  'extra whitespace tolerated',
);

// ─── De-dup ──────────────────────────────────────────────────────────────

console.log('\nparseMultiAgentRequest — de-dup aliases of same canonical');

const dedup1 = parseMultiAgentRequest('@blackswan @swanbot summarize today', resolve);
if (dedup1 === null) {
  ok('two aliases of one agent → null (not multi-agent)');
} else {
  fail('two aliases of one agent should NOT count as multi-agent', dedup1);
}

const dedup2 = parseMultiAgentRequest('@blackswan @swanbot @claudia talk', resolve);
if (dedup2 && dedup2.agents.length === 2 && dedup2.agents[0].resolvedName === 'BlackSwan' && dedup2.agents[1].resolvedName === 'Claudia') {
  ok('blackswan + swanbot + claudia → 2 unique agents');
} else {
  fail('expected 2 unique agents (BlackSwan, Claudia)', dedup2);
}

// ─── Negative cases ──────────────────────────────────────────────────────

console.log('\nparseMultiAgentRequest — negative');

const negatives: Array<[string, string]> = [
  ['summarize today',                    'no @ prefix'],
  ['@blackswan summarize today',         'single agent'],
  ['hello @blackswan @claudia',          '@ not at start'],
  ['@unknown @anotherone do something',  'all unresolved'],
  ['@blackswan @unknown please help',    'second agent unresolved → stop at 1'],
  ['@blackswan @claudia',                'no prompt body'],
];

for (const [input, why] of negatives) {
  const r = parseMultiAgentRequest(input, resolve);
  if (r === null) ok(`"${input.slice(0, 40)}" → null (${why})`);
  else fail(`"${input}" should NOT match (${why})`, r);
}

// ─── Orchestration planner ───────────────────────────────────────────────

console.log('\nparseMultiAgentOrchestrationRequest — orchestration');

const liveAgents = [
  { id: 'default::blackswan', name: 'OpenSwan', provider: 'openswan', status: 'idle' },
  { id: 'codex-1', name: 'Codex #1', provider: 'codex', status: 'idle' },
  { id: 'codex-2', name: 'Codex #2', provider: 'codex', status: 'building' },
  { id: 'claude-1', name: 'Claude Code #1', provider: 'claude-code', status: 'idle' },
  { id: 'gemini-1', name: 'Gemini CLI #1', provider: 'gemini', status: 'offline' },
];

function expectPlan(
  input: string,
  expectedKind: 'dispatch' | 'help',
  expectedTargets: string[],
  msg: string,
) {
  const plan = parseMultiAgentOrchestrationRequest(input, liveAgents);
  if (!plan) { fail(msg + ' (returned null)', input); return; }
  if (plan.kind !== expectedKind) {
    fail(msg + ` — kind mismatch (got ${plan.kind}, want ${expectedKind})`, plan);
    return;
  }
  if (JSON.stringify(plan.targetIds) !== JSON.stringify(expectedTargets)) {
    fail(msg + ` — targets mismatch (got ${JSON.stringify(plan.targetIds)}, want ${JSON.stringify(expectedTargets)})`, plan);
    return;
  }
  ok(msg);
}

expectPlan('/multi all audit the bridge plan', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], '/multi all fans out to usable agents');
expectPlan('/multi active audit the bridge plan', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], '/multi active includes idle/building agents');
expectPlan('/multi provider codex audit the bridge plan', 'dispatch', ['codex-1', 'codex-2'], '/multi provider codex scopes to Codex sessions');
expectPlan('@openswan @codex1 audit the bridge plan', 'dispatch', ['default::blackswan', 'codex-1'], 'compact @mention aliases resolve');
expectPlan('/roundtable decide the implementation order', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], '/roundtable uses active agents');
expectPlan('/sequence all implement the bridge handoff', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], '/sequence all creates a chain plan');
expectPlan('/multi debate provider codex review the bridge handoff', 'dispatch', ['codex-1', 'codex-2'], '/multi debate provider codex creates debate plan');
expectPlan('ask all codex agents to audit the bridge plan', 'dispatch', ['codex-1', 'codex-2'], 'natural language provider fan-out works');
expectPlan('use as many agents as possible to audit the bridge plan', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], 'natural language max fan-out leading phrase works');
expectPlan('keep building the WordPress automation and have as many agents work on it as possible', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], 'natural language max fan-out trailing phrase works');
expectPlan('run a sequential workflow for implement the bridge handoff', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], 'natural language sequential workflow works');
expectPlan('run a debate about the bridge handoff design', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], 'natural language debate works');
expectPlan('/multi help', 'help', [], '/multi help returns help plan');
expectPlan('/multi all', 'help', [], '/multi all without a task returns help plan');

console.log('\nparseMultiAgentOrchestrationRequest — bounded deployment intent');

const manyAgents = Array.from({ length: 15 }, (_, index) => ({
  id: `agent-${index + 1}`,
  name: `Agent ${index + 1}`,
  provider: index % 2 === 0 ? 'codex' : 'openswan',
  status: 'idle',
}));

function expectDeploymentIntent(
  input: string,
  agents: typeof liveAgents,
  expected: {
    strategy: 'parallel' | 'roundtable' | 'sequential' | 'debate';
    maxTargets: number;
    targetCount: number;
    truncatedCount: number;
    requestedScope?: string;
  },
  msg: string,
) {
  const plan = parseMultiAgentOrchestrationRequest(input, agents);
  if (!plan || plan.kind !== 'dispatch') {
    fail(msg + ' (did not produce dispatch plan)', plan);
    return;
  }
  const intent = plan.deploymentIntent;
  if (!intent) {
    fail(msg + ' (missing deploymentIntent)', plan);
    return;
  }
  if (
    intent.bounded === true
    && intent.strategy === expected.strategy
    && intent.maxTargets === expected.maxTargets
    && intent.targetIds.length === expected.targetCount
    && intent.truncatedCount === expected.truncatedCount
    && intent.modelPolicy === 'agent_select_from_connected_providers'
    && (!expected.requestedScope || intent.requestedScope === expected.requestedScope)
  ) {
    ok(msg);
  } else {
    fail(msg + ' — deployment intent mismatch', { intent, expected });
  }
}

expectDeploymentIntent(
  'use as many agents as possible to audit this repo',
  manyAgents,
  { strategy: 'parallel', maxTargets: 12, targetCount: 12, truncatedCount: 3, requestedScope: 'as many active agents as possible' },
  'max fan-out is bounded to 12 and reports truncation',
);

expectDeploymentIntent(
  '/roundtable all: decide the rollout',
  manyAgents,
  { strategy: 'roundtable', maxTargets: 5, targetCount: 5, truncatedCount: 10, requestedScope: 'all agents' },
  '/roundtable all is bounded to 5',
);

expectDeploymentIntent(
  '/sequence all: implement the rollout',
  manyAgents,
  { strategy: 'sequential', maxTargets: 8, targetCount: 8, truncatedCount: 7, requestedScope: 'all agents' },
  '/sequence all is bounded to 8',
);

expectDeploymentIntent(
  '/debate all: review the rollout',
  manyAgents,
  { strategy: 'debate', maxTargets: 6, targetCount: 6, truncatedCount: 9, requestedScope: 'all agents' },
  '/debate all is bounded to 6',
);

expectDeploymentIntent(
  '/multi provider codex: audit provider routing',
  manyAgents,
  { strategy: 'parallel', maxTargets: 12, targetCount: 8, truncatedCount: 0, requestedScope: 'codex agents' },
  'provider-scoped fan-out preserves requested scope',
);

expectDeploymentIntent(
  '@openswan @codex1 audit the bridge plan',
  liveAgents,
  { strategy: 'parallel', maxTargets: 12, targetCount: 2, truncatedCount: 0, requestedScope: '@OpenSwan @Codex #1' },
  'explicit mentions produce bounded deployment intent',
);

// ─── O3: typed-core subagent fan-out ─────────────────────────────────────
//
// Mirrors `delegateToSubagents`' Promise.allSettled fan-out, with each
// child running the REAL typed-core loop (`runSubagentTypedCoreLoop` is
// the production composition delegateToSubagent injects its impure deps
// into). Verifies the parent's fan-in only ever sees the summary-only
// contract — including for a child whose loop rejects.

async function typedCoreFanOut() {
  console.log('\ntyped-core subagent fan-out (O3)');

  const childProvider = (label: string): AgentProvider => ({
    turn: async () => ({
      stop_reason: 'end_turn' as const,
      content: [{ type: 'text' as const, text: `${label}: ` + 'r'.repeat(2000) + ' FULL_CHILD_TRANSCRIPT' }],
      usage: { input_tokens: 100, output_tokens: 40 },
    }),
  });
  const noTools: AgentToolDefinition[] = [{
    name: 'noop.tool',
    description: 'noop',
    input_schema: { type: 'object', properties: {} },
    handler: async () => ({ ok: true, data: { text: 'ok' } }),
  }];
  const throwingProvider: AgentProvider = {
    turn: async () => { throw new Error('child transport exploded'); },
  };

  const specs = ['architect', 'coder', 'reviewer'];
  const settled = await Promise.allSettled([
    runSubagentTypedCoreLoop({ userMessage: 'design it', tools: noTools, provider: childProvider('architect'), maxIterations: 5 }),
    runSubagentTypedCoreLoop({ userMessage: 'build it', tools: noTools, provider: childProvider('coder'), maxIterations: 5 }),
    runSubagentTypedCoreLoop({ userMessage: 'review it', tools: noTools, provider: throwingProvider, maxIterations: 5 }),
  ]);

  // Fan-in exactly like delegateToSubagents: fulfilled → summary contract;
  // rejected → short failed contract (never a throw to the caller).
  const parentView: SubagentParentSummary[] = settled.map((entry, index) => {
    if (entry.status === 'fulfilled') {
      const payload = buildSubagentLoopSummary({
        finalText: entry.value.runResult.text,
        toolCalls: entry.value.toolCalls,
        completedCleanly: !entry.value.runResult.hitMaxIterations,
        usage: entry.value.usage,
      });
      return buildSubagentParentSummary({ payload, status: 'completed', runId: `run-${specs[index]}` });
    }
    const failMsg = `Specialist failed: ${(entry.reason as Error)?.message || 'unknown error'}`;
    return buildSubagentParentSummary({
      payload: { summary: failMsg, toolCallCount: 0, completed: false },
      status: 'failed',
    });
  });

  if (parentView.length === 3) ok('fan-out: 3 children → 3 parent summaries');
  else fail('fan-out: expected 3 summaries', parentView.length);

  const [a, b, c] = parentView;
  if (a.status === 'completed' && b.status === 'completed' && c.status === 'failed') {
    ok('fan-out: statuses reflect per-child outcomes (2 completed, 1 failed)');
  } else fail('fan-out: status mismatch', parentView.map((p) => p.status));

  if (a.summary.length <= 1200 && a.summary.endsWith('...') && b.summary.length <= 1200) {
    ok('fan-out: each child summary independently bounded');
  } else fail('fan-out: summary bound violated', { a: a.summary.length, b: b.summary.length });

  if (a.tokens.input === 100 && a.tokens.output === 40 && c.tokens.input === null) {
    ok('fan-out: per-child token accounting (failed child → null, never 0)');
  } else fail('fan-out: token accounting mismatch', parentView.map((p) => p.tokens));

  const merged = JSON.stringify(parentView);
  if (!merged.includes('FULL_CHILD_TRANSCRIPT')) {
    ok('fan-out: no child transcript leaks into the merged parent view');
  } else fail('fan-out: transcript leaked into parent view');
}

typedCoreFanOut()
  .catch((err) => { fail('typed-core fan-out threw', String(err)); })
  .finally(() => {
    console.log('\n' + (failures > 0 ? `FAILED — ${failures} assertion(s)` : 'PASSED — all assertions ok'));
    process.exit(failures > 0 ? 1 : 0);
  });
