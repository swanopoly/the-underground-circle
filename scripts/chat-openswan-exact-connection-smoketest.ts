/**
 * Source-contract smoke for exact Chat -> OpenSwan connection routing.
 *
 * OpenSwan session keys are provider-local and can repeat across bridges. Chat
 * must preserve the connection that produced a selected session, resolve one
 * exact current connection, and persist dispatch kind + connection lineage on
 * the accepted canonical run. This test performs no provider or database I/O.
 *
 * Run: npx tsx scripts/chat-openswan-exact-connection-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveExactOpenSwanConnection } from '../src/lib/connectedAgentHandoffCore';

const chatPath = fileURLToPath(
  new URL('../src/screens/circles/tabs/ChatTab.tsx', import.meta.url),
);
const chatSource = readFileSync(chatPath, 'utf8');
const handoffCorePath = fileURLToPath(
  new URL('../src/lib/connectedAgentHandoffCore.ts', import.meta.url),
);
const handoffCoreSource = readFileSync(handoffCorePath, 'utf8');
const dispatchPath = fileURLToPath(
  new URL('../src/lib/connectedAgentDispatch.ts', import.meta.url),
);
const dispatchSource = readFileSync(dispatchPath, 'utf8');

function section(
  source: string,
  startMarker: string,
  endMarker: string,
  label: string,
): string {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${label}: start marker exists`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${label}: end marker exists`);
  return source.slice(start, end);
}

function count(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

const assignableAgent = section(
  chatSource,
  'type AssignableAgent = {',
  'function applyTerminalProfileToTask(',
  'AssignableAgent contract',
);
const sessionAdapter = section(
  chatSource,
  'function toAssignableSessionAgent(',
  'function buildAssignableAgentSubjectMetadata(',
  'OpenSwan session assignable adapter',
);
const connectionResolver = section(
  chatSource,
  'const resolveOpenSwanConnection = useCallback',
  'const attachAcceptedHandoffRun = useCallback',
  'exact OpenSwan connection resolver',
);
const acceptedRunWriter = section(
  chatSource,
  'const attachAcceptedHandoffRun = useCallback',
  'const dispatchAssignedAgentTask = useCallback',
  'accepted-run writer',
);
const dispatchFunction = section(
  chatSource,
  'const dispatchAssignedAgentTask = useCallback',
  'const spawnDedicatedOpenSwanSession = useCallback',
  'connected-agent dispatch function',
);
const dedicatedSpawn = section(
  chatSource,
  'const spawnDedicatedOpenSwanSession = useCallback',
  'useEffect(() => {',
  'dedicated OpenSwan spawn',
);
const openSwanBranchStart = dispatchFunction.indexOf("if (normalizedProvider === 'openswan') {");
assert.notEqual(openSwanBranchStart, -1, 'Chat has a dedicated OpenSwan dispatch branch');
const nextProviderBranch = dispatchFunction.indexOf('const bridgeProviders =', openSwanBranchStart);
assert.notEqual(nextProviderBranch, -1, 'OpenSwan dispatch branch has a bounded end');
const openSwanBranch = dispatchFunction.slice(openSwanBranchStart, nextProviderBranch);

// Session discovery already knows the local connection id. The assignable
// projection must preserve it instead of reducing identity to a session key.
assert.match(
  assignableAgent,
  /\bconnectionId\??:\s*string(?:\s*\|\s*null)?;/,
  'assignable agents carry an explicit local connection id',
);
assert.match(
  sessionAdapter,
  /connectionId:\s*agent\.connectionId\b/,
  'OpenSwan session adapter preserves the exact source connection id',
);

// The pure canonical resolver owns provider eligibility and exact cardinality;
// Chat adapts its inventory through that helper rather than reimplementing or
// weakening the identity checks in the component.
assert.match(
  handoffCoreSource,
  /export\s+function\s+resolveExactOpenSwanConnection\s*\(/,
  'connectedAgentHandoffCore exports the pure exact resolver',
);
assert.match(
  dispatchSource,
  /export\s*\{[\s\S]{0,420}\bresolveExactOpenSwanConnection\b[\s\S]{0,420}\}\s*from\s*['"]\.\/connectedAgentHandoffCore['"];/,
  'connectedAgentDispatch re-exports the canonical exact resolver',
);
assert.match(
  connectionResolver.slice(0, 260),
  /connectionId|requestedConnectionId|expectedConnectionId/,
  'resolver accepts the selected session connection id',
);
assert.match(
  connectionResolver,
  /resolveExactOpenSwanConnection\s*\(/,
  'Chat routes connection selection through the canonical pure resolver',
);
assert.match(
  connectionResolver,
  /return\s+resolveExactOpenSwanConnection\(\s*connections\s*,\s*connectionId\s*\?\?\s*undefined\s*\)/,
  'Chat returns the canonical discriminated result with its exact connection id intact',
);
assert.doesNotMatch(
  connectionResolver,
  /\.find\s*\(/,
  'Chat resolver never chooses the first matching connection',
);
assert.doesNotMatch(
  connectionResolver,
  /\.name\s*===|includes\([^)]*name/i,
  'resolver never treats a connection name as identity',
);

// The canonical run writer accepts and forwards the exact transport kind and
// connection id rather than attempting to infer either from receipt prose.
assert.match(
  acceptedRunWriter.slice(0, 420),
  /externalDispatchKind|dispatchKind/,
  'accepted-run helper accepts an explicit dispatch kind',
);
assert.match(
  acceptedRunWriter.slice(0, 520),
  /externalConnectionId|connectionId/,
  'accepted-run helper accepts an explicit connection id',
);
assert.match(
  acceptedRunWriter,
  /recordConnectedAgentAcceptedRun\([\s\S]{0,700}externalDispatchKind[\s\S]{0,260}externalConnectionId/,
  'accepted-run projection persists both external lineage fields',
);

// Exact live selected sessions are sends; a new child is a spawn. Published
// DB-bound Office agents have a separate, independently tested exact send.
const liveSessionBranchStart = openSwanBranch.indexOf("if (agent.source === 'openswan-session'");
assert.notEqual(liveSessionBranchStart, -1, 'live OpenSwan session branch has a bounded start');
const liveOpenSwanBranch = openSwanBranch.slice(liveSessionBranchStart);
assert.match(
  liveOpenSwanBranch,
  /resolveOpenSwanConnection\(\s*agent\.connectionId\s*\)/,
  'selected OpenSwan agents resolve through their exact connection id',
);
const sendCall = liveOpenSwanBranch.indexOf('sendSessionMessage(');
const spawnCall = liveOpenSwanBranch.indexOf('spawnSubAgent(');
assert.ok(sendCall >= 0, 'OpenSwan branch has one selected-session send');
assert.ok(spawnCall > sendCall, 'OpenSwan branch has one later child spawn');
assert.equal(count(liveOpenSwanBranch, /sendSessionMessage\s*\(/g), 1, 'no alternate live selected-session send path');
assert.equal(count(liveOpenSwanBranch, /spawnSubAgent\s*\(/g), 1, 'no alternate spawn path');

const sendAccepted = liveOpenSwanBranch.slice(sendCall, spawnCall);
const spawnAccepted = liveOpenSwanBranch.slice(spawnCall);
assert.match(
  liveOpenSwanBranch.slice(0, sendCall),
  /const\s+externalConnectionId\s*=\s*connectionResolution\.connectionId\s*;/,
  'OpenSwan branch aliases durable lineage only from the successful exact resolution',
);
assert.match(
  sendAccepted,
  /externalDispatchKind:\s*['"]sessions_send['"]|dispatchKind:\s*['"]sessions_send['"]|['"]sessions_send['"]/,
  'selected-session acceptance is stamped sessions_send',
);
assert.match(
  sendAccepted,
  /\{\s*externalDispatchKind:\s*['"]sessions_send['"]\s*,\s*externalConnectionId\s*\}/,
  'selected-session acceptance carries the resolved exact connection id',
);
assert.match(
  spawnAccepted,
  /externalDispatchKind:\s*['"]sessions_spawn['"]|dispatchKind:\s*['"]sessions_spawn['"]|['"]sessions_spawn['"]/,
  'spawn acceptance is stamped sessions_spawn',
);
assert.match(
  spawnAccepted,
  /\{\s*externalDispatchKind:\s*['"]sessions_spawn['"]\s*,\s*externalConnectionId\s*\}/,
  'spawn acceptance carries the chosen exact connection id',
);

assert.match(
  dedicatedSpawn,
  /resolveOpenSwanConnection\s*\(/,
  'dedicated spawn resolves one exact current OpenSwan connection',
);
assert.match(
  dedicatedSpawn,
  /externalDispatchKind:\s*['"]sessions_spawn['"]|dispatchKind:\s*['"]sessions_spawn['"]|['"]sessions_spawn['"]/,
  'dedicated spawn acceptance is stamped sessions_spawn',
);
assert.match(
  dedicatedSpawn,
  /externalConnectionId\s*=\s*(?:[A-Za-z_$][\w$]*\.target|[A-Za-z_$][\w$]*)\.connectionId[\s\S]*externalDispatchKind:\s*['"]sessions_spawn['"][\s\S]*externalConnectionId\s*,/,
  'dedicated spawn acceptance carries its chosen exact connection id',
);

// Failure to resolve an exact connection must exit the OpenSwan branch before
// either provider call. Falling through to a different provider or recording
// an accepted run would invite duplicate work.
const resolverCall = liveOpenSwanBranch.indexOf('resolveOpenSwanConnection(');
const unresolvedGate = /if\s*\(\s*![A-Za-z_$][\w$]*(?:\.ok)?\s*\)\s*\{?[\s\S]{0,500}?(?:throw\s+new\s+Error|return\s+)/.exec(
  liveOpenSwanBranch.slice(resolverCall),
);
assert.ok(unresolvedGate, 'missing or ambiguous exact connection exits the OpenSwan branch');
assert.ok(
  unresolvedGate && resolverCall + unresolvedGate.index < sendCall,
  'exact-connection failure gate runs before the first provider call',
);
const unresolvedGateSource = unresolvedGate?.[0] || '';
assert.doesNotMatch(
  unresolvedGateSource,
  /attachAcceptedHandoffRun|trackedReceipt|recordConnectedAgentAcceptedRun/,
  'unresolved connection gate cannot create an accepted canonical run',
);

// Execute the canonical pure resolver directly. The effect counter below makes
// the missing/ambiguous pre-dispatch guarantee concrete without contacting a
// provider or database.
type Connection = {
  id: string;
  provider: string;
  status: string;
  enabled: boolean;
  endpoint: string;
  token: string;
};

function countEffects(connections: readonly Connection[], requestedId?: string | null): {
  providerCalls: number;
  acceptedRuns: number;
} {
  const resolved = resolveExactOpenSwanConnection(connections, requestedId);
  return resolved?.ok === true
    ? { providerCalls: 1, acceptedRuns: 1 }
    : { providerCalls: 0, acceptedRuns: 0 };
}

const connectionA: Connection = {
  id: 'conn-a',
  provider: 'openswan',
  status: 'connected',
  enabled: true,
  endpoint: 'http://127.0.0.1:18790',
  token: 'token-a',
};
const connectionB: Connection = {
  ...connectionA,
  id: 'conn-b',
  endpoint: 'http://127.0.0.1:18791',
  token: 'token-b',
};

const exactResolution = resolveExactOpenSwanConnection([connectionA, connectionB], 'conn-b');
assert.equal(exactResolution?.ok, true, 'canonical resolver accepts one exact usable requested connection');
if (exactResolution?.ok === true) {
  assert.equal(exactResolution.connectionId, 'conn-b', 'resolution preserves exact local connection lineage');
  assert.deepEqual(
    exactResolution.config,
    { endpoint: connectionB.endpoint, token: connectionB.token },
    'resolution returns only the exact endpoint and token needed for dispatch',
  );
}

const soleResolution = resolveExactOpenSwanConnection([connectionA], null);
assert.equal(soleResolution?.ok, true, 'spawn may choose the sole usable OpenSwan connection');
assert.equal(
  soleResolution?.ok === true ? soleResolution.connectionId : null,
  connectionA.id,
  'sole-candidate spawn preserves its chosen exact connection id',
);

assert.deepEqual(
  countEffects([connectionA, connectionB], 'conn-b'),
  { providerCalls: 1, acceptedRuns: 1 },
  'an exact selected connection produces one provider call and one accepted run',
);
assert.deepEqual(
  countEffects([connectionA], 'conn-missing'),
  { providerCalls: 0, acceptedRuns: 0 },
  'a missing selected connection produces no provider call or accepted run',
);
assert.deepEqual(
  countEffects([connectionA, { ...connectionA }], 'conn-a'),
  { providerCalls: 0, acceptedRuns: 0 },
  'an ambiguous exact connection produces no provider call or accepted run',
);
assert.deepEqual(
  countEffects([connectionA, connectionB], null),
  { providerCalls: 0, acceptedRuns: 0 },
  'spawn without a selected connection fails when multiple usable bridges exist',
);
assert.deepEqual(
  countEffects([{ ...connectionA, status: 'disconnected' }], 'conn-a'),
  { providerCalls: 0, acceptedRuns: 0 },
  'a disconnected exact connection produces no provider call or accepted run',
);
assert.deepEqual(
  countEffects([{ ...connectionA, enabled: false }], 'conn-a'),
  { providerCalls: 0, acceptedRuns: 0 },
  'a disabled exact connection produces no provider call or accepted run',
);
assert.deepEqual(
  countEffects([{ ...connectionA, token: '' }], 'conn-a'),
  { providerCalls: 0, acceptedRuns: 0 },
  'a tokenless exact connection produces no provider call or accepted run',
);

console.log('chat OpenSwan exact-connection smoke passed');
