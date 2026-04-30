/**
 * multi-agent-dispatch-smoketest — verifies parseMultiAgentRequest
 * extracts leading agent mentions and returns null for everything
 * that isn't a multi-agent request.
 *
 * Run: `npx tsx scripts/multi-agent-dispatch-smoketest.ts`
 */
import {
  parseMultiAgentRequest,
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

console.log('\n' + (failures > 0 ? `FAILED — ${failures} assertion(s)` : 'PASSED — all assertions ok'));
process.exit(failures > 0 ? 1 : 0);
