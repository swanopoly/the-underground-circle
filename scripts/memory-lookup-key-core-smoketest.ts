/**
 * memory-lookup-key-core-smoketest — exercises src/lib/memoryLookupKeyCore.ts,
 * the pure lookup-key seam behind agent-memory reads.
 *
 * Why this matters: agent memory is written under ONE key — the runtime subject
 * key `dbAgentId || sessionKey || identityKey` — and that key ROTATES. A
 * session-derived local-bridge agent that gets published to
 * `circle_office_agents` switches to a uuid; a bridge reconnect mints a new
 * session key. Every read that asks only for the CURRENT key silently loses
 * everything written before the rotation, and "silently" is the whole problem:
 * the failure mode is an empty array that reads exactly like "this agent has no
 * memories". Three shipped bugs came out of that (2026-07-24):
 *   - SOUL readers asked for `scopes:['agent']` with no agent id → always []
 *   - `buildMemoryContext` had no aliases param → model read alias-blind while
 *     the Office panel read alias-aware (visible on screen, gone from prompt)
 *   - the agent-scope query was pinned at `.limit(20)` under a 200-row request
 *
 * Covers:
 *   1. Key normalization: trim, stringified-nullish junk, objects, numbers
 *   2. Nested alias-array flattening
 *   3. resolveMemoryLookupIds: order preservation (write key first),
 *      case-insensitive dedupe, junk drop, MAX_MEMORY_LOOKUP_IDS cap
 *   4. deriveMemoryLookupIds: id-only callers still get identity/legacy aliases
 *   5. The agent-scope-without-an-id caller error + its warning text
 *   6. resolveMemoryScopeQueryLimit: honors the caller, falls back, caps
 *   7. Write-key/read-key ROUND TRIP: a rotated subject key is still found via
 *      aliases, and the alias-blind control misses it
 *   8. Never throws on null/partial/malformed input; deterministic
 *
 * Usage:
 *   npm run smoke:memory-lookup-key-core
 */

import {
  DEFAULT_AGENT_SCOPE_MEMORY_LIMIT,
  MAX_MEMORY_LOOKUP_IDS,
  MAX_MEMORY_SCOPE_QUERY_LIMIT,
  deriveMemoryLookupIds,
  describeAgentScopeLookupWarning,
  flattenMemoryLookupValues,
  isAgentScopeMissingLookupId,
  memoryLookupComparisonKey,
  memoryLookupIdsMatch,
  normalizeMemoryLookupKey,
  resolveMemoryLookupIds,
  resolveMemoryScopeQueryLimit,
  scopesRequestAgentMemory,
} from '../src/lib/memoryLookupKeyCore';
import { buildAgentRuntimeSubject } from '../src/lib/agentRuntimeSubject';

let passed = 0;
let failed = 0;
function check(label: string, ok: boolean): void {
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label}`); }
}

console.log('\n=== 1. Key normalization ===');
check('trims surrounding whitespace', normalizeMemoryLookupKey('  agent-1  ') === 'agent-1');
check('preserves original casing (agent_id equality is case-sensitive)',
  normalizeMemoryLookupKey('Default::BlackSwan') === 'Default::BlackSwan');
check('empty string → ""', normalizeMemoryLookupKey('   ') === '');
check('null → ""', normalizeMemoryLookupKey(null) === '');
check('undefined → ""', normalizeMemoryLookupKey(undefined) === '');
check('stringified nullish junk "null" → ""', normalizeMemoryLookupKey('null') === '');
check('stringified nullish junk "undefined" → ""', normalizeMemoryLookupKey('UNDEFINED') === '');
check('object → "" (never "[object Object]")', normalizeMemoryLookupKey({ id: 'x' }) === '');
check('number is usable', normalizeMemoryLookupKey(42) === '42');
check('comparison key case-folds', memoryLookupComparisonKey(' BlackSwan ') === 'blackswan');
check('comparison key of junk is ""', memoryLookupComparisonKey('null') === '');

console.log('\n=== 2. Nested alias flattening ===');
check('flattens nested arrays',
  JSON.stringify(flattenMemoryLookupValues(['a', ['b', ['c']], null, '', undefined])) === JSON.stringify(['a', 'b', 'c']));
check('non-array scalar flattens to single entry',
  JSON.stringify(flattenMemoryLookupValues('solo')) === JSON.stringify(['solo']));
check('all-junk input → []', flattenMemoryLookupValues([null, undefined, '   ', 'null']).length === 0);

console.log('\n=== 3. resolveMemoryLookupIds ===');
{
  const ids = resolveMemoryLookupIds('uuid-live', ['legacy-a', 'legacy-b']);
  check('write key stays first', ids[0] === 'uuid-live');
  check('aliases follow in order', JSON.stringify(ids) === JSON.stringify(['uuid-live', 'legacy-a', 'legacy-b']));
}
{
  const ids = resolveMemoryLookupIds('agent-1', ['agent-1', ' agent-1 ', 'AGENT-1', 'other']);
  check('dedupes exact + whitespace + case variants', JSON.stringify(ids) === JSON.stringify(['agent-1', 'other']));
}
{
  const ids = resolveMemoryLookupIds('  ', [null, 'null', ['nested-ok', ['deep-ok']], undefined]);
  check('drops junk, keeps nested real ids', JSON.stringify(ids) === JSON.stringify(['nested-ok', 'deep-ok']));
}
check('no agent id and no aliases → []', resolveMemoryLookupIds(undefined, undefined).length === 0);
check('never throws on malformed input',
  (() => { try { resolveMemoryLookupIds({ bad: true } as unknown, [{ worse: true }] as unknown); return true; } catch { return false; } })());
{
  const many = Array.from({ length: MAX_MEMORY_LOOKUP_IDS + 20 }, (_, i) => `alias-${i}`);
  const ids = resolveMemoryLookupIds('primary', many);
  check(`capped at MAX_MEMORY_LOOKUP_IDS (${MAX_MEMORY_LOOKUP_IDS})`, ids.length === MAX_MEMORY_LOOKUP_IDS);
  check('cap keeps the primary write key', ids[0] === 'primary');
  check('explicit max override respected', resolveMemoryLookupIds('primary', many, { max: 3 }).length === 3);
}
check('deterministic',
  JSON.stringify(resolveMemoryLookupIds('a', ['b', 'A'])) === JSON.stringify(resolveMemoryLookupIds('a', ['b', 'A'])));

console.log('\n=== 4. deriveMemoryLookupIds (callers that only know an id) ===');
{
  const ids = deriveMemoryLookupIds({ agentId: 'default::blackswan', agentName: 'BlackSwan' });
  check('OpenSwan main: supplied id first', ids[0] === 'default::blackswan');
  check('OpenSwan main: identity key alias present', ids.includes('blackswan'));
  check('OpenSwan main: legacy chat id alias present', ids.includes('openswan:main_chat'));
}
{
  const ids = deriveMemoryLookupIds({ agentId: 'bridge-agent', agentName: 'Claude Code', sessionKey: 'local::session-alpha' });
  check('session agent: session key comes along as an alias', ids.includes('local::session-alpha'));
  check('session agent: raw id retained', ids.includes('bridge-agent'));
}
{
  const ids = deriveMemoryLookupIds({
    agentId: 'uuid-live',
    agentName: 'Claude Code',
    dbAgentId: 'uuid-live',
    agentAliases: ['local::session-old'],
  });
  check('explicit caller aliases outrank derived ones', ids.indexOf('local::session-old') === 1);
}
check('no identifying input → []', deriveMemoryLookupIds({ agentName: 'Nameless' }).length === 0);
check('derive never throws on junk',
  (() => { try { deriveMemoryLookupIds({ agentId: null, agentAliases: { nope: 1 } as unknown }); return true; } catch { return false; } })());

console.log('\n=== 5. Agent scope without a lookup id (the Bug-1 guard) ===');
check('scopesRequestAgentMemory true for ["agent"]', scopesRequestAgentMemory(['agent']) === true);
check('scopesRequestAgentMemory true for mixed list', scopesRequestAgentMemory(['circle', 'room', 'agent']) === true);
check('scopesRequestAgentMemory false for non-agent scopes', scopesRequestAgentMemory(['circle', 'user']) === false);
check('scopesRequestAgentMemory false for undefined (default scopes exclude agent)',
  scopesRequestAgentMemory(undefined) === false);
check('agent scope + no id → caller error',
  isAgentScopeMissingLookupId({ scopes: ['agent'], lookupIds: [] }) === true);
check('agent scope + junk-only ids → caller error',
  isAgentScopeMissingLookupId({ scopes: ['agent'], lookupIds: ['   '] }) === true);
check('agent scope + real id → no error',
  isAgentScopeMissingLookupId({ scopes: ['circle', 'agent'], lookupIds: ['uuid-live'] }) === false);
check('non-agent scope + no id → no error (that read is legitimate)',
  isAgentScopeMissingLookupId({ scopes: ['circle', 'room', 'user'], lookupIds: [] }) === false);
check('undefined scopes → no error', isAgentScopeMissingLookupId({ lookupIds: [] }) === false);
{
  const warning = describeAgentScopeLookupWarning({ scopes: ['agent'], caller: 'loadMemories' });
  check('warning names the caller', warning.includes('loadMemories'));
  check('warning lists the scopes', warning.includes('scopes=[agent]'));
  check('warning says the query can only return []', warning.includes('only ever return []'));
  check('warning points at the fix', warning.includes('memoryAgentAliases'));
  check('warning is bounded', warning.length < 600);
  check('warning survives missing caller',
    describeAgentScopeLookupWarning({ scopes: ['agent'] }).length > 0);
}

console.log('\n=== 6. Agent-scope query limit (Bug 3) ===');
check('honors a caller limit of 200', resolveMemoryScopeQueryLimit(200) === 200);
check('undefined → fallback 20', resolveMemoryScopeQueryLimit(undefined) === DEFAULT_AGENT_SCOPE_MEMORY_LIMIT);
check('zero → fallback', resolveMemoryScopeQueryLimit(0) === DEFAULT_AGENT_SCOPE_MEMORY_LIMIT);
check('negative → fallback', resolveMemoryScopeQueryLimit(-5) === DEFAULT_AGENT_SCOPE_MEMORY_LIMIT);
check('NaN → fallback', resolveMemoryScopeQueryLimit(Number.NaN) === DEFAULT_AGENT_SCOPE_MEMORY_LIMIT);
check('Infinity → fallback', resolveMemoryScopeQueryLimit(Number.POSITIVE_INFINITY) === DEFAULT_AGENT_SCOPE_MEMORY_LIMIT);
check('fractional floors down', resolveMemoryScopeQueryLimit(25.9) === 25);
check(`capped at MAX_MEMORY_SCOPE_QUERY_LIMIT (${MAX_MEMORY_SCOPE_QUERY_LIMIT})`,
  resolveMemoryScopeQueryLimit(100_000) === MAX_MEMORY_SCOPE_QUERY_LIMIT);
check('custom fallback used', resolveMemoryScopeQueryLimit(undefined, 120) === 120);
check('custom fallback still capped', resolveMemoryScopeQueryLimit(undefined, 9_999) === MAX_MEMORY_SCOPE_QUERY_LIMIT);

console.log('\n=== 7. Write-key / read-key round trip across a subject rotation ===');
{
  // A row store keyed exactly the way `memory_entries.agent_id` is.
  type Row = { agentId: string; title: string };
  const rows: Row[] = [];
  const readRows = (lookupIds: string[]): Row[] =>
    rows.filter(row => memoryLookupIdsMatch(lookupIds, row.agentId));

  const localAgent = { id: 'claude-code-local', name: 'Claude Code', sessionKey: 'local::session-alpha' };

  // Phase 1 — session-derived bridge agent, no DB row yet.
  const sessionSubject = buildAgentRuntimeSubject(localAgent as Parameters<typeof buildAgentRuntimeSubject>[0]);
  check('phase 1 write key is the session key', sessionSubject.memoryAgentId === 'local::session-alpha');
  rows.push({ agentId: sessionSubject.memoryAgentId, title: 'learned: repo uses tsx smokes' });

  const sessionRead = readRows(resolveMemoryLookupIds(sessionSubject.memoryAgentId, sessionSubject.memoryAgentAliases));
  check('phase 1 read finds its own write', sessionRead.length === 1);

  // Phase 2 — the agent is published to circle_office_agents: key ROTATES.
  const publishedSubject = buildAgentRuntimeSubject(
    localAgent as Parameters<typeof buildAgentRuntimeSubject>[0],
    { dbAgentId: '11111111-2222-3333-4444-555555555555' },
  );
  check('phase 2 write key rotated to the db uuid',
    publishedSubject.memoryAgentId === '11111111-2222-3333-4444-555555555555');
  rows.push({ agentId: publishedSubject.memoryAgentId, title: 'learned: office panel reads aliases' });

  const aliasBlind = readRows([publishedSubject.memoryAgentId]);
  check('CONTROL: alias-blind read loses the pre-rotation memory (the shipped bug)',
    aliasBlind.length === 1 && aliasBlind[0].title.includes('office panel'));

  const aliasAware = readRows(resolveMemoryLookupIds(publishedSubject.memoryAgentId, publishedSubject.memoryAgentAliases));
  check('alias-aware read finds BOTH pre- and post-rotation memories', aliasAware.length === 2);
  check('alias-aware read includes the old session-keyed row',
    aliasAware.some(row => row.agentId === 'local::session-alpha'));

  // Phase 3 — bridge reconnect mints a new session key; the db id anchors it.
  const reconnected = buildAgentRuntimeSubject(
    { ...localAgent, sessionKey: 'local::session-beta' } as Parameters<typeof buildAgentRuntimeSubject>[0],
    { dbAgentId: '11111111-2222-3333-4444-555555555555' },
  );
  const reconnectIds = resolveMemoryLookupIds(reconnected.memoryAgentId, [
    ...reconnected.memoryAgentAliases,
    ...sessionSubject.memoryAgentAliases,
  ]);
  check('reconnect read (old aliases carried) still sees every row', readRows(reconnectIds).length === 2);
  check('reconnect lookup ids are deduped', reconnectIds.length === new Set(reconnectIds.map(id => id.toLowerCase())).size);

  // A different agent must NOT be able to read them.
  const otherSubject = buildAgentRuntimeSubject({ id: 'other-agent', name: 'Other' } as Parameters<typeof buildAgentRuntimeSubject>[0]);
  check('an unrelated agent reads nothing',
    readRows(resolveMemoryLookupIds(otherSubject.memoryAgentId, otherSubject.memoryAgentAliases)).length === 0);
  check('memoryLookupIdsMatch rejects junk candidates', memoryLookupIdsMatch(['a'], null) === false);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} memoryLookupKeyCore: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
