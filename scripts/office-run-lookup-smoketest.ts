/**
 * office-run-lookup-smoketest — exercises src/lib/officeRunLookup.ts, the pure
 * run↔agent attribution seam extracted out of OfficeTab.tsx.
 *
 * Why this matters: until `agent_runs` carries a durable `agent_id` (plan item
 * O6), EVERY accountability claim the Office makes — the Building-Now board, the
 * per-agent live ops lines, the accountability line, the desk plaque, cost
 * attribution — depends on these functions matching a run to an agent by name
 * and identity aliases. A miss silently attributes an agent's failures to
 * nobody; a false hit attributes them to the wrong agent. Both are worse than
 * showing nothing, and neither was covered by a test while the logic sat inline
 * in a 7k-line component.
 *
 * Covers:
 *   1. runFreshnessUpdatedAtMs fallback order + unusable input → NaN
 *   2. pickFreshestRunFreshness: most-alive wins, degenerates → null
 *   3. Key normalization: case/whitespace, nested alias arrays, order-preserving
 *      dedupe, junk rejection
 *   4. Node + agent key sets: expected keys present, no empties, no dupes
 *   5. Attribution: multi-key hit dedupes by runId, no-match → empty/undefined,
 *      first-key-wins for the accountability index
 *   6. Never throws on null/partial/malformed input; deterministic
 *
 * Usage:
 *   npm run smoke:office-run-lookup
 */

import {
  runFreshnessUpdatedAtMs,
  pickFreshestRunFreshness,
  normalizeOpsLookupKey,
  flattenOpsLookupValues,
  uniqueOpsLookupKeys,
  buildOpsRunNodeLookupKeys,
  buildOfficeAgentRunLookupKeys,
  getOpsRunNodesForAgent,
  getOpsAccountabilityForAgent,
  type OfficeRunNodeLike,
} from '../src/lib/officeRunLookup';
import type { RunFreshnessResult } from '../src/lib/runFreshnessCore';
import type { OfficeAgent } from '../src/lib/officeAgents';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}

function agent(overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: 'agent-1',
    name: 'BlackSwan',
    role: 'engineer',
    status: 'idle',
    color: '#fff',
    deskIndex: 0,
    activity: '',
    messagesProcessed: 0,
    uptimeHours: 0,
    uptime: '',
    lastActive: '',
    recentActions: [],
    recentMessages: [],
    costToday: 0,
    costTotal: 0,
    costWeek: 0,
    tokensUsed: 0,
    inputTokens: 0,
    outputTokens: 0,
    cachedTokens: 0,
    newTokens: 0,
    turns: 0,
    sessionKey: 'session-abc',
    model: 'claude',
    connectionId: 'conn-1',
    connectionName: 'local',
    providerType: 'claude_code' as OfficeAgent['providerType'],
    ...overrides,
  };
}

function node(runId: string, overrides: Partial<OfficeRunNodeLike> = {}): OfficeRunNodeLike {
  return { runId, agentName: 'BlackSwan', subjectAliases: [], ...overrides };
}

function freshness(f: RunFreshnessResult['freshness']): RunFreshnessResult {
  return { freshness: f } as RunFreshnessResult;
}

// ─── 1. runFreshnessUpdatedAtMs ──────────────────────────────────────────────

{
  const t = (iso: string) => Date.parse(iso);
  check('freshness ts: prefers updated_at', runFreshnessUpdatedAtMs({
    updated_at: '2026-07-24T10:00:00Z',
    completed_at: '2026-07-24T09:00:00Z',
    started_at: '2026-07-24T08:00:00Z',
    created_at: '2026-07-24T07:00:00Z',
  }) === t('2026-07-24T10:00:00Z'));

  check('freshness ts: falls back completed → started → created', (
    runFreshnessUpdatedAtMs({ completed_at: '2026-07-24T09:00:00Z', started_at: '2026-07-24T08:00:00Z' }) === t('2026-07-24T09:00:00Z') &&
    runFreshnessUpdatedAtMs({ started_at: '2026-07-24T08:00:00Z', created_at: '2026-07-24T07:00:00Z' }) === t('2026-07-24T08:00:00Z') &&
    runFreshnessUpdatedAtMs({ created_at: '2026-07-24T07:00:00Z' }) === t('2026-07-24T07:00:00Z')
  ));

  check('freshness ts: nulls skipped, not treated as present', runFreshnessUpdatedAtMs({
    updated_at: null, completed_at: null, started_at: '2026-07-24T08:00:00Z',
  }) === t('2026-07-24T08:00:00Z'));

  check('freshness ts: no timestamps → NaN', Number.isNaN(runFreshnessUpdatedAtMs({})));
  check('freshness ts: null/undefined run → NaN', Number.isNaN(runFreshnessUpdatedAtMs(null)) && Number.isNaN(runFreshnessUpdatedAtMs(undefined)));
  check('freshness ts: unparseable string → NaN', Number.isNaN(runFreshnessUpdatedAtMs({ updated_at: 'not-a-date' })));
}

// ─── 2. pickFreshestRunFreshness ─────────────────────────────────────────────

{
  const byId = new Map<string, RunFreshnessResult>([
    ['r-live', freshness('live')],
    ['r-stale', freshness('stale')],
    ['r-done', freshness('done')],
  ]);

  const best = pickFreshestRunFreshness([node('r-done'), node('r-live'), node('r-stale')], byId);
  check('freshest: most-alive rank wins regardless of order', best?.freshness === 'live');

  const onlyStale = pickFreshestRunFreshness([node('r-stale'), node('r-done')], byId);
  check('freshest: picks best available when no live run', onlyStale?.freshness === 'stale');

  check('freshest: unindexed nodes are skipped, not defaulted',
    pickFreshestRunFreshness([node('r-unknown')], byId) === null);
  check('freshest: empty/null node list → null',
    pickFreshestRunFreshness([], byId) === null &&
    pickFreshestRunFreshness(null, byId) === null &&
    pickFreshestRunFreshness(undefined, byId) === null);
  check('freshest: empty/null index → null',
    pickFreshestRunFreshness([node('r-live')], new Map()) === null &&
    pickFreshestRunFreshness([node('r-live')], null) === null);
}

// ─── 3. Key normalization ────────────────────────────────────────────────────

{
  check('normalize: trims + lowercases', normalizeOpsLookupKey('  BlackSwan  ') === 'blackswan');
  check('normalize: empty/whitespace/null → null',
    normalizeOpsLookupKey('') === null &&
    normalizeOpsLookupKey('   ') === null &&
    normalizeOpsLookupKey(null) === null &&
    normalizeOpsLookupKey(undefined) === null);

  check('flatten: nested arrays flattened, blanks dropped',
    JSON.stringify(flattenOpsLookupValues(['a', ['b', ['c', '']], null, '  d  '])) === JSON.stringify(['a', 'b', 'c', 'd']));

  const keys = uniqueOpsLookupKeys(['Alpha', 'alpha', '  ALPHA ', 'Beta', ['Beta', 'Gamma'], '', null, undefined]);
  check('unique: case-insensitive dedupe', JSON.stringify(keys) === JSON.stringify(['alpha', 'beta', 'gamma']));
  check('unique: order preserved (first occurrence wins)', keys[0] === 'alpha' && keys[2] === 'gamma');
  check('unique: never emits an empty key', keys.every(k => k.length > 0));
  check('unique: non-array input → empty', uniqueOpsLookupKeys(null as any).length === 0);
}

// ─── 4. Key sets ─────────────────────────────────────────────────────────────

{
  const nodeKeys = buildOpsRunNodeLookupKeys(node('r1', {
    agentName: 'BlackSwan',
    subjectKey: 'Subject-Key',
    subjectDisplayName: 'Black Swan',
    subjectDbId: 'DB-1',
    subjectAliases: ['Alias-A', 'alias-a', 'Alias-B'],
  }));
  check('node keys: canonical identity excludes display-name fallbacks',
    JSON.stringify(nodeKeys) === JSON.stringify(['subject-key', 'db-1', 'alias-a', 'alias-b']));
  check('node keys: deduped', new Set(nodeKeys).size === nodeKeys.length);
  check('node keys: null node → empty', buildOpsRunNodeLookupKeys(null).length === 0);
  check('node keys: bare node never throws', buildOpsRunNodeLookupKeys({ runId: 'x' } as OfficeRunNodeLike).length >= 0);

  const agentKeys = buildOfficeAgentRunLookupKeys(agent());
  check('agent keys: includes name / id / sessionKey', agentKeys.includes('blackswan') && agentKeys.includes('agent-1') && agentKeys.includes('session-abc'));
  check('agent keys: deduped + non-empty', new Set(agentKeys).size === agentKeys.length && agentKeys.every(k => k.length > 0));
  check('agent keys: null agent → empty', buildOfficeAgentRunLookupKeys(null).length === 0);

  // A UUID id must be treated as the db id (drives subject.dbAgentId).
  const uuidAgent = agent({ id: '3f1c2b4a-5d6e-4f70-8a91-0b2c3d4e5f60' });
  check('agent keys: uuid id still indexed', buildOfficeAgentRunLookupKeys(uuidAgent).includes('3f1c2b4a-5d6e-4f70-8a91-0b2c3d4e5f60'));

  // Two different agents must not collapse onto the same key set — that is the
  // false-attribution failure mode.
  const other = agent({ id: 'agent-2', name: 'HuggingSwan', sessionKey: 'session-xyz' });
  const overlap = buildOfficeAgentRunLookupKeys(other).filter(k => agentKeys.includes(k));
  check('agent keys: distinct agents do not share identifying keys', !overlap.includes('blackswan') && !overlap.includes('agent-1') && !overlap.includes('session-abc'));
}

// ─── 5. Attribution ──────────────────────────────────────────────────────────

{
  const a = agent();
  const n1 = node('run-1');
  const n2 = node('run-2');
  const byKey = new Map<string, OfficeRunNodeLike[]>([
    ['blackswan', [n1, n2]],
    ['session-abc', [n2]],       // same run reachable by a second key
    ['agent-1', [n1]],
    ['someone-else', [node('run-99')]],
  ]);

  const nodes = getOpsRunNodesForAgent(a, byKey);
  check('attribution: collects across all matching keys', nodes.some(n => n.runId === 'run-1') && nodes.some(n => n.runId === 'run-2'));
  check('attribution: dedupes a run reachable by two keys', nodes.filter(n => n.runId === 'run-2').length === 1);
  check('attribution: never picks up another agent\'s run', !nodes.some(n => n.runId === 'run-99'));
  check('attribution: unknown agent → empty', getOpsRunNodesForAgent(agent({ id: 'zzz', name: 'Nobody', sessionKey: 'none' }), byKey).length === 0);
  check('attribution: null map/agent → empty', getOpsRunNodesForAgent(a, null).length === 0 && getOpsRunNodesForAgent(null, byKey).length === 0);

  const index = new Map<string, { tag: string }>([
    ['session-abc', { tag: 'by-session' }],
    ['blackswan', { tag: 'by-name' }],
  ]);
  const entry = getOpsAccountabilityForAgent(a, index);
  // Exact session/subject identity precedes the legacy display-name fallback.
  check('accountability: exact identity wins before name fallback', entry?.tag === 'by-session');
  check('accountability: no match → undefined', getOpsAccountabilityForAgent(agent({ id: 'q', name: 'Ghost', sessionKey: 'g' }), index) === undefined);
  check('accountability: null index → undefined', getOpsAccountabilityForAgent(a, null) === undefined);
}

// ─── 6. Robustness + determinism ─────────────────────────────────────────────

{
  check('never throws on malformed input', (() => {
    try {
      buildOfficeAgentRunLookupKeys({} as OfficeAgent);
      buildOfficeAgentRunLookupKeys({ id: null, name: null } as any);
      buildOpsRunNodeLookupKeys({ runId: '', subjectAliases: null } as any);
      getOpsRunNodesForAgent({} as OfficeAgent, new Map());
      getOpsAccountabilityForAgent({} as OfficeAgent, new Map());
      uniqueOpsLookupKeys([{ nested: true } as any, 42 as any]);
      pickFreshestRunFreshness([{ runId: '' } as OfficeRunNodeLike], new Map());
      return true;
    } catch { return false; }
  })());

  const a = agent();
  check('deterministic: identical input → identical keys',
    JSON.stringify(buildOfficeAgentRunLookupKeys(a)) === JSON.stringify(buildOfficeAgentRunLookupKeys(a)));
}

console.log(`\noffice-run-lookup smoketest: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
