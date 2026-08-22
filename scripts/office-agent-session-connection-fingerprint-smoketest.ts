/**
 * Source-contract smoke for the Office OpenSwan cockpit's loaded-session
 * connection fingerprint. This test performs no provider or database I/O.
 *
 * A local connection id is not a sufficient session provenance key: an
 * existing connection can be edited in place to point at a different bridge.
 * Session actions and binding writes therefore require the current connection
 * to match the non-secret identity captured when the session list was loaded:
 * local connection id + remote bot id + normalized endpoint.
 *
 * Run: npx tsx scripts/office-agent-session-connection-fingerprint-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildOpenSwanConnectionFingerprint,
  matchesOpenSwanConnectionFingerprint,
  type OpenSwanConnectionFingerprint,
} from '../src/lib/officeAgentSessionBindingCore';

const panelPath = fileURLToPath(
  new URL('../src/screens/circles/tabs/office/AgentGatewayPanels.tsx', import.meta.url),
);
const panelSource = readFileSync(panelPath, 'utf8');
const corePath = fileURLToPath(
  new URL('../src/lib/officeAgentSessionBindingCore.ts', import.meta.url),
);
const coreSource = readFileSync(corePath, 'utf8');

function sourceSection(
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const refresh = sourceSection(
  panelSource,
  'const refresh = useCallback',
  'useEffect(() =>',
  'OpenSwan session refresh',
);
const runAction = sourceSection(
  panelSource,
  'const runAction = useCallback',
  'const exactSessionMatches',
  'OpenSwan cockpit action gate',
);
const bindDisplayedSession = sourceSection(
  panelSource,
  'const bindDisplayedSession = useCallback',
  'const unbindPublishedAgent = useCallback',
  'Office session bind action',
);
const readiness = sourceSection(
  panelSource,
  'const exactSessionCanBind',
  'const subagentCount',
  'exact session readiness gates',
);

const fingerprintState = /const\s*\[\s*([A-Za-z_$][\w$]*Fingerprint[A-Za-z_$\w]*)\s*,\s*(set[A-Za-z_$][\w$]*Fingerprint[A-Za-z_$\w]*)\s*\]\s*=\s*useState(?:<[^;\n]+>)?\(\s*null\s*\)/i.exec(panelSource);
assert.ok(
  fingerprintState,
  'panel stores a nullable loaded connection fingerprint rather than only a local connection id',
);
const fingerprintName = fingerprintState?.[1] || 'loadedConnectionFingerprint';
const setFingerprintName = fingerprintState?.[2] || 'setLoadedConnectionFingerprint';
const escapedFingerprint = escapeRegExp(fingerprintName);
const escapedSetFingerprint = escapeRegExp(setFingerprintName);

// The captured identity is deliberately non-secret. It must distinguish an
// in-place endpoint edit and an in-place switch to another owner-private bot.
assert.match(
  panelSource,
  /import\s*\{[\s\S]{0,300}\bbuildOpenSwanConnectionFingerprint\b[\s\S]{0,300}\bmatchesOpenSwanConnectionFingerprint\b[\s\S]{0,300}\}\s*from\s*['"][^'"]*officeAgentSessionBindingCore['"];/,
  'panel imports the canonical pure fingerprint builder and matcher',
);
const fingerprintBuilderSection = sourceSection(
  coreSource,
  'export function buildOpenSwanConnectionFingerprint(',
  '/** Match all captured bridge identity fields;',
  'canonical connection fingerprint builder',
);
for (const field of ['id', 'remoteId', 'endpoint']) {
  assert.match(
    fingerprintBuilderSection,
    new RegExp(`['"]${field}['"]`),
    `fingerprint builder captures ${field}`,
  );
}
assert.doesNotMatch(
  fingerprintBuilderSection,
  /['"]token['"]|\.token\b/i,
  'loaded connection fingerprint never retains the bridge token',
);
assert.match(
  coreSource,
  /function\s+normalizeUsableEndpoint\s*\([\s\S]{0,500}new\s+URL\s*\(/,
  'endpoint identity is normalized before it is fingerprinted or compared',
);

const matcherName = 'matchesOpenSwanConnectionFingerprint';
const escapedMatcher = escapeRegExp(matcherName);
const matcherSection = sourceSection(
  coreSource,
  'export function matchesOpenSwanConnectionFingerprint(',
  '\n}',
  'canonical connection fingerprint matcher',
);
for (const identity of ['connectionId', 'agentBotId', 'normalizedEndpoint']) {
  assert.match(
    matcherSection,
    new RegExp(`\\b${identity}\\b`),
    `fingerprint matcher compares ${identity}`,
  );
}

// Every refresh invalidates old provenance synchronously, before resolving or
// contacting the provider, and only stamps the identity associated with the
// session-list response after that response is available.
const clearFingerprint = new RegExp(`${escapedSetFingerprint}\\(\\s*null\\s*\\)`).exec(refresh);
assert.ok(clearFingerprint, 'refresh clears the loaded fingerprint');
const firstAwait = refresh.indexOf('await ');
assert.ok(
  clearFingerprint && firstAwait >= 0 && clearFingerprint.index < firstAwait,
  'refresh clears the loaded fingerprint before its first async boundary',
);
const stampFingerprint = new RegExp(
  `${escapedSetFingerprint}\\(\\s*(?!null\\b)([A-Za-z_$][\\w$]*Fingerprint[A-Za-z_$\\w]*)\\s*\\)`,
  'i',
).exec(refresh);
assert.ok(stampFingerprint, 'successful session loading stamps the exact resolved connection fingerprint');
assert.ok(
  stampFingerprint && refresh.indexOf('listSessions') < stampFingerprint.index,
  'fingerprint is stamped only after the session-list request is associated with that connection',
);

// Provider actions re-resolve the current config. They must compare that fresh
// connection with the loaded fingerprint before invoking the action callback.
const runActionMatch = new RegExp(`${escapedMatcher}\\([\\s\\S]{0,220}${escapedFingerprint}|${escapedMatcher}\\([\\s\\S]{0,220}config\\.connection`).exec(runAction);
assert.ok(runActionMatch, 'runAction compares the freshly resolved connection to loaded session provenance');
const actionCall = runAction.indexOf('await fn(');
assert.ok(actionCall >= 0, 'runAction has one provider action callback');
assert.ok(
  runActionMatch && runActionMatch.index < actionCall,
  'runAction rejects connection drift before any provider action callback',
);

// A binding mutation receives the same exact-current guard. Checking only the
// captured connection object or local id would still permit same-id drift.
const bindMatch = new RegExp(`${escapedMatcher}\\([\\s\\S]{0,260}${escapedFingerprint}|${escapedMatcher}\\([\\s\\S]{0,260}connection`).exec(bindDisplayedSession);
assert.ok(bindMatch, 'bind action checks the loaded connection fingerprint');
const setBindingCall = bindDisplayedSession.indexOf('setOfficeAgentSessionBinding(');
assert.ok(setBindingCall >= 0, 'bind action contains the authoritative set RPC call');
assert.ok(
  bindMatch && bindMatch.index < setBindingCall,
  'bind action rejects connection drift before the binding set RPC',
);
assert.match(
  readiness,
  new RegExp(`${escapedMatcher}\\([\\s\\S]{0,260}${escapedFingerprint}|${escapedMatcher}\\([\\s\\S]{0,260}connection`),
  'rendered bind/action readiness also requires the exact loaded fingerprint',
);

// Exercise the canonical pure helper directly. These assertions prove the
// source-gated call sites use a matcher with the required side-effect
// semantics, rather than merely pinning spelling in the React component.
const loadedConnection = {
  id: 'conn-stable',
  remoteId: '11111111-1111-4111-8111-111111111111',
  endpoint: 'http://127.0.0.1:18790/',
  provider: 'openswan',
  token: 'must-never-enter-the-fingerprint',
};
const loaded = buildOpenSwanConnectionFingerprint(loadedConnection);
assert.ok(loaded, 'canonical builder accepts one exact OpenSwan connection identity');
assert.deepEqual(
  loaded,
  {
    connectionId: loadedConnection.id,
    agentBotId: loadedConnection.remoteId,
    normalizedEndpoint: 'http://127.0.0.1:18790/',
  },
  'fingerprint contains only local id, remote bot id, and normalized endpoint',
);
assert.deepEqual(
  Object.keys(loaded || {}).sort(),
  ['agentBotId', 'connectionId', 'normalizedEndpoint'],
  'fingerprint omits token and every other mutable connection field',
);
assert.ok(Object.isFrozen(loaded), 'fingerprint is immutable');
assert.deepEqual(
  buildOpenSwanConnectionFingerprint({ ...loadedConnection, endpoint: 'http://127.0.0.1:18790' }),
  loaded,
  'trailing slash variants normalize to one endpoint identity',
);

for (const [label, invalid] of [
  ['missing input', undefined],
  ['primitive input', 'conn-stable'],
  ['wrong provider', { ...loadedConnection, provider: 'claude-code' }],
  ['invalid local id', { ...loadedConnection, id: ' conn-stable ' }],
  ['invalid remote bot id', { ...loadedConnection, remoteId: 'bot-by-name' }],
  ['unsafe endpoint', { ...loadedConnection, endpoint: 'javascript:alert(1)' }],
] as const) {
  assert.equal(
    buildOpenSwanConnectionFingerprint(invalid),
    null,
    `${label} fails fingerprint construction`,
  );
}
const hostileConnection = new Proxy({}, {
  get() { throw new Error('hostile connection getter'); },
});
assert.equal(
  buildOpenSwanConnectionFingerprint(hostileConnection),
  null,
  'throwing connection input fails closed',
);
assert.equal(
  matchesOpenSwanConnectionFingerprint(loaded, loadedConnection),
  true,
  'exact unchanged connection matches loaded provenance',
);
assert.equal(
  matchesOpenSwanConnectionFingerprint(null, loadedConnection),
  false,
  'missing loaded provenance fails closed',
);

function countGuardedEffects(current: unknown): { actionCalls: number; setCalls: number } {
  let actionCalls = 0;
  let setCalls = 0;
  if (matchesOpenSwanConnectionFingerprint(loaded, current)) actionCalls += 1;
  if (matchesOpenSwanConnectionFingerprint(loaded, current)) setCalls += 1;
  return { actionCalls, setCalls };
}

assert.deepEqual(
  countGuardedEffects({
    ...loadedConnection,
    endpoint: 'http://127.0.0.1:18790',
  }),
  { actionCalls: 1, setCalls: 1 },
  'an unchanged exact connection performs one action and one binding set',
);
assert.deepEqual(
  countGuardedEffects({
    ...loadedConnection,
    endpoint: 'http://127.0.0.1:18791',
  }),
  { actionCalls: 0, setCalls: 0 },
  'the same local id with a changed endpoint performs no action or binding set',
);
assert.deepEqual(
  countGuardedEffects({
    ...loadedConnection,
    remoteId: '22222222-2222-4222-8222-222222222222',
  }),
  { actionCalls: 0, setCalls: 0 },
  'the same local id with a changed remote bot id performs no action or binding set',
);

console.log('office agent session connection-fingerprint smoke passed');
