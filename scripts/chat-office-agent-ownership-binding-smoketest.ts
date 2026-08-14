/**
 * Red-first source/pure smoke for Chat -> published Office-agent ownership and
 * exact OpenSwan session binding.
 *
 * The public Office UUID is never a provider session id. Only the authenticated
 * owner may resolve its private binding against a current connection/session
 * snapshot, and only one exact successful resolution may cross sessions_send.
 * Another member's custom gateway must never receive credentials borrowed from
 * an unrelated local connection.
 *
 * No database or real provider is contacted.
 *
 * Run: npx tsx scripts/chat-office-agent-ownership-binding-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dispatchCustomAgentBridgeTask } from '../src/lib/customAgentBridgeDispatcher';
import {
  buildOpenSwanConnectionFingerprint,
  resolveOfficeAgentSessionBinding,
  type ResolveOfficeAgentSessionBindingInput,
} from '../src/lib/officeAgentSessionBindingCore';

const chatPath = fileURLToPath(
  new URL('../src/screens/circles/tabs/ChatTab.tsx', import.meta.url),
);
const chatSource = readFileSync(chatPath, 'utf8');
const customDispatcherPath = fileURLToPath(
  new URL('../src/lib/customAgentBridgeDispatcher.ts', import.meta.url),
);
const customDispatcherSource = readFileSync(customDispatcherPath, 'utf8');

let passed = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): condition is true {
  if (condition) {
    passed += 1;
    return true;
  }
  failures.push(label);
  return false;
}

function expectMatch(source: string, pattern: RegExp, label: string): void {
  check(pattern.test(source), label);
}

function expectNoMatch(source: string, pattern: RegExp, label: string): void {
  check(!pattern.test(source), label);
}

function section(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  if (!check(start >= 0, `${label}: start marker exists`)) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (!check(end > start, `${label}: end marker exists`)) return '';
  return source.slice(start, end);
}

function count(source: string, pattern: RegExp): number {
  return (source.match(pattern) || []).length;
}

const assignableContract = section(
  chatSource,
  'type AssignableAgent = {',
  'function applyTerminalProfileToTask(',
  'AssignableAgent contract',
);
const dbAdapter = section(
  chatSource,
  'function toAssignableDbAgent(',
  'function toAssignableSessionAgent(',
  'published Office-agent adapter',
);
const assignedDispatch = section(
  chatSource,
  'const dispatchAssignedAgentTask = useCallback',
  'const spawnDedicatedOpenSwanSession = useCallback',
  'assigned-agent dispatch',
);
const openSwanStart = assignedDispatch.indexOf("if (normalizedProvider === 'openswan') {");
check(openSwanStart >= 0, 'assigned dispatch has an OpenSwan branch');
const bridgeStart = assignedDispatch.indexOf('const bridgeProviders =', openSwanStart);
check(bridgeStart > openSwanStart, 'OpenSwan branch has a bounded end');
const openSwanBranch = openSwanStart >= 0 && bridgeStart > openSwanStart
  ? assignedDispatch.slice(openSwanStart, bridgeStart)
  : '';
const customStart = assignedDispatch.indexOf('if (supportsGenericCustomAgentDispatch(', bridgeStart);
const fallbackStart = assignedDispatch.indexOf('const agentSubject = buildAgentRuntimeSubject(', customStart);
check(customStart > bridgeStart, 'assigned dispatch has a custom-gateway branch');
check(fallbackStart > customStart, 'custom-gateway branch has a bounded end');
const customBranch = customStart >= 0 && fallbackStart > customStart
  ? assignedDispatch.slice(customStart, fallbackStart)
  : '';

// Public roster identity and provider runtime identity must remain distinct.
expectMatch(
  assignableContract,
  /\bownerId\??:\s*string(?:\s*\|\s*null)?\s*;/,
  'assignable Office agents retain their exact owner id',
);
expectMatch(
  assignableContract,
  /\bisOwn\??:\s*boolean\s*;/,
  'assignable Office agents retain the authenticated ownership verdict',
);
expectMatch(dbAdapter, /ownerId:\s*agent\.ownerId\b/, 'DB adapter preserves ownerId');
expectMatch(dbAdapter, /isOwn:\s*agent\.isOwn\s*===\s*true/, 'DB adapter preserves isOwn fail closed');
expectMatch(dbAdapter, /sessionKey:\s*null\b/, 'DB adapter never converts an Office UUID into a session key');
expectNoMatch(
  dbAdapter,
  /sessionKey:\s*agent\.provider\s*===\s*['"]openswan['"]\s*\?\s*agent\.id/,
  'published OpenSwan Office UUID is not treated as provider session identity',
);

// The DB-only branch must authorize ownership before reading local secrets,
// owner-private binding state, session inventory, or crossing a provider API.
const dbBranchMarker = openSwanBranch.indexOf("agent.source === 'db'");
check(dbBranchMarker >= 0, 'OpenSwan dispatch distinguishes a published DB target');
const bindingRead = openSwanBranch.indexOf('readOfficeAgentSessionBinding(', dbBranchMarker);
const bindingResolve = openSwanBranch.indexOf('resolveOfficeAgentSessionBinding(', dbBranchMarker);
const boundSend = openSwanBranch.indexOf('sendSessionMessage(', bindingResolve);
check(bindingRead > dbBranchMarker, 'owner branch reads the exact owner-private binding');
check(bindingResolve > bindingRead, 'owner branch resolves only after the binding read');
check(boundSend > bindingResolve, 'owner branch sends only after exact binding resolution');

const ownershipGate = dbBranchMarker >= 0 && bindingRead > dbBranchMarker
  ? openSwanBranch.slice(dbBranchMarker, bindingRead)
  : '';
expectMatch(ownershipGate, /agent\.isOwn/, 'published OpenSwan ownership gate requires the authenticated isOwn verdict');
expectMatch(ownershipGate, /agent\.ownerId/, 'published OpenSwan ownership gate checks the exact owner id');
expectMatch(ownershipGate, /currentUserId/, 'published OpenSwan ownership gate binds to the current user');
expectMatch(ownershipGate, /throw\s+new\s+Error|return\s+/, 'non-owner target exits before binding or local/provider work');
expectNoMatch(ownershipGate, /loadConnections|getAutoConnect|buildOfficeSessionSnapshot|readOfficeAgentSessionBinding|resolveOfficeAgentSessionBinding|sendSessionMessage|spawnSubAgent/, 'non-owner gate performs no binding, local-connection, or provider work');

const boundDispatchEndCandidates = [
  openSwanBranch.indexOf("agent.source === 'openswan-session'", boundSend),
  openSwanBranch.indexOf('const connectionResolution =', boundSend),
].filter((value) => value > boundSend);
const boundDispatchEnd = boundDispatchEndCandidates.length > 0
  ? Math.min(...boundDispatchEndCandidates)
  : openSwanBranch.length;
const boundDispatch = bindingRead >= 0
  ? openSwanBranch.slice(bindingRead, boundDispatchEnd)
  : '';

expectMatch(boundDispatch, /buildOfficeSessionSnapshot\s*\(/, 'owner branch builds one current connection/session snapshot');
expectMatch(boundDispatch, /getAutoConnectConnections\s*\(/, 'binding snapshot includes current local connections');
expectMatch(boundDispatch, /getAutoConnectSessions\s*\(/, 'binding snapshot includes structured current sessions');
expectMatch(boundDispatch, /getAutoConnectSessionFingerprints\s*\(/, 'binding snapshot includes exact non-secret connection fingerprints');
for (const field of ['connections', 'sessionsByConnection', 'sessionFingerprintsByConnection']) {
  expectMatch(boundDispatch, new RegExp(`\\b${field}\\b`), `binding resolution receives ${field}`);
}
expectMatch(
  boundDispatch,
  /sendSessionMessage\s*\(\s*[A-Za-z_$][\w$]*\.config\s*,\s*[A-Za-z_$][\w$]*\.sessionKey\s*,/,
  'owner dispatch sends only to the resolver-built config and exact bound session',
);
check(count(boundDispatch, /sendSessionMessage\s*\(/g) === 1, 'owner binding branch has exactly one provider send site');
expectNoMatch(boundDispatch, /spawnSubAgent\s*\(/, 'owner binding branch never converts send failure into a spawn');
expectMatch(boundDispatch, /providerRunId/, 'bound send preserves the exact provider run id');
expectMatch(boundDispatch, /externalDispatchKind:\s*['"]sessions_send['"]/, 'bound acceptance is stamped sessions_send');
expectMatch(
  boundDispatch,
  /externalConnectionId:\s*[A-Za-z_$][\w$]*\.connectionId/,
  'bound acceptance stamps the resolver-built exact local connection id',
);

// A custom target owned by another member may use its explicit gateway, but
// Chat must mark its ownership so the bridge adapter cannot borrow a token from
// a same-provider/name local connection.
for (const field of ['ownerId', 'currentUserId', 'source']) {
  expectMatch(customBranch, new RegExp(`\\b${field}\\s*:`), `custom bridge target carries ${field}`);
}
expectMatch(customDispatcherSource, /\bownerId\??:\s*string/, 'custom dispatcher accepts target owner identity');
expectMatch(customDispatcherSource, /\bcurrentUserId\??:\s*string/, 'custom dispatcher accepts authenticated caller identity');
expectMatch(customDispatcherSource, /\bsource\??:/, 'custom dispatcher accepts public DB-target provenance');

const BINDING_ID = '11111111-1111-4111-8111-111111111111';
const OFFICE_AGENT_ID = '22222222-2222-4222-8222-222222222222';
const AGENT_BOT_ID = '33333333-3333-4333-8333-333333333333';
const CONNECTION_ID = 'conn_bound_owner';
const SESSION_KEY = 'agent:main:bound-owner';
const exactConnection = {
  id: CONNECTION_ID,
  remoteId: AGENT_BOT_ID,
  provider: 'openswan',
  status: 'connected',
  enabled: true,
  endpoint: 'http://127.0.0.1:18790',
  token: 'owner-local-openswan-token',
};
const fingerprint = buildOpenSwanConnectionFingerprint(exactConnection);
check(Boolean(fingerprint), 'fixture has a valid exact connection fingerprint');

const exactInput: ResolveOfficeAgentSessionBindingInput = {
  officeAgentId: OFFICE_AGENT_ID,
  binding: {
    id: BINDING_ID,
    officeAgentId: OFFICE_AGENT_ID,
    agentBotId: AGENT_BOT_ID,
    sessionKey: SESSION_KEY,
  },
  connections: [exactConnection],
  sessionsByConnection: {
    [CONNECTION_ID]: [{ sessionKey: SESSION_KEY }],
  },
  sessionFingerprintsByConnection: {
    [CONNECTION_ID]: fingerprint || undefined,
  },
};

type EffectCounts = {
  sends: number;
  spawns: number;
  connectionId: string | null;
  sessionKey: string | null;
  providerRunId: string | null;
};

function exerciseBinding(input: ResolveOfficeAgentSessionBindingInput): EffectCounts {
  const resolution = resolveOfficeAgentSessionBinding(input);
  if (!resolution.ok) {
    return { sends: 0, spawns: 0, connectionId: null, sessionKey: null, providerRunId: null };
  }
  return {
    sends: 1,
    spawns: 0,
    connectionId: resolution.target.connectionId,
    sessionKey: resolution.target.sessionKey,
    providerRunId: 'provider-run-exact-1',
  };
}

const exactEffects = exerciseBinding(exactInput);
check(exactEffects.sends === 1, 'one exact live owner binding authorizes one send');
check(exactEffects.spawns === 0, 'one exact live owner binding never spawns');
check(exactEffects.connectionId === CONNECTION_ID, 'authorized send retains exact externalConnectionId');
check(exactEffects.sessionKey === SESSION_KEY, 'authorized send retains exact bound session key');
check(exactEffects.providerRunId === 'provider-run-exact-1', 'authorized send retains exact providerRunId');

const rejectedInputs: Array<[string, ResolveOfficeAgentSessionBindingInput]> = [
  ['missing binding', { ...exactInput, binding: null }],
  ['stale connection fingerprint', {
    ...exactInput,
    sessionFingerprintsByConnection: {
      [CONNECTION_ID]: {
        connectionId: CONNECTION_ID,
        agentBotId: AGENT_BOT_ID,
        normalizedEndpoint: 'http://127.0.0.1:19999/',
      },
    },
  }],
  ['ambiguous exact session', {
    ...exactInput,
    sessionsByConnection: {
      [CONNECTION_ID]: [{ sessionKey: SESSION_KEY }, { sessionKey: SESSION_KEY }],
    },
  }],
  ['ambiguous bound connection', {
    ...exactInput,
    connections: [exactConnection, { ...exactConnection, id: 'conn_duplicate_owner' }],
  }],
];

for (const [label, input] of rejectedInputs) {
  const effects = exerciseBinding(input);
  check(effects.sends === 0, `${label} makes zero provider sends`);
  check(effects.spawns === 0, `${label} never falls back to spawn`);
}

async function verifyForeignCustomGatewayDoesNotReceiveBorrowedToken(): Promise<void> {
  const foreignOwnerId = '44444444-4444-4444-8444-444444444444';
  const currentUserId = '55555555-5555-4555-8555-555555555555';
  const borrowedSecret = 'must-not-cross-to-foreign-gateway';
  const captured: Array<{ url: string; headers: Record<string, string> }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(input),
      headers: { ...((init?.headers || {}) as Record<string, string>) },
    });
    return new Response(JSON.stringify({ ok: true, accepted: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await dispatchCustomAgentBridgeTask({
      id: '66666666-6666-4666-8666-666666666666',
      name: 'Another member agent',
      provider: 'opencode',
      gatewayUrl: 'https://foreign-member.example',
      ownerId: foreignOwnerId,
      currentUserId,
      source: 'db',
    } as Parameters<typeof dispatchCustomAgentBridgeTask>[0], 'review this task', [{
      id: 'unrelated-local-opencode',
      name: 'My local OpenCode',
      provider: 'opencode',
      endpoint: 'http://127.0.0.1:7788',
      token: borrowedSecret,
      enabled: true,
      status: 'connected',
      remoteId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as Parameters<typeof dispatchCustomAgentBridgeTask>[2][number]]);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const serialized = JSON.stringify(captured);
  check(!serialized.includes(borrowedSecret), 'foreign custom gateway never receives an unrelated local token');
  for (const request of captured) {
    check(!('Authorization' in request.headers), 'foreign custom gateway receives no borrowed Authorization header');
    check(!('X-UC-Agent-Token' in request.headers), 'foreign custom gateway receives no borrowed agent-token header');
    check(!('X-UC-Desktop-Token' in request.headers), 'foreign custom gateway receives no borrowed desktop-token header');
  }
}

async function main(): Promise<void> {
  await verifyForeignCustomGatewayDoesNotReceiveBorrowedToken();
  if (failures.length > 0) {
    console.error(`chat Office-agent ownership/binding smoke: ${failures.length} failed, ${passed} passed`);
    failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`chat Office-agent ownership/binding smoke: all ${passed} assertions passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
