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
expectPlan('run a sequential workflow for implement the bridge handoff', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], 'natural language sequential workflow works');
expectPlan('run a debate about the bridge handoff design', 'dispatch', ['default::blackswan', 'codex-1', 'codex-2', 'claude-1'], 'natural language debate works');
expectPlan('/multi help', 'help', [], '/multi help returns help plan');
expectPlan('/multi all', 'help', [], '/multi all without a task returns help plan');

console.log('\n' + (failures > 0 ? `FAILED — ${failures} assertion(s)` : 'PASSED — all assertions ok'));
process.exit(failures > 0 ? 1 : 0);
