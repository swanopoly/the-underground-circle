/**
 * Red-first contract for Chat connected-agent authority and immutable selection.
 *
 * This test performs no real provider or database I/O. It combines focused
 * source wiring checks for Chat's component-local dispatchers with executable
 * pure/mock checks for target resolution and custom-bridge credential routing.
 *
 * Run:
 *   npx tsx scripts/chat-connected-agent-authority-red-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DEFAULT_CHAT_AGENT_TARGET_ID,
  buildChatAgentTargets,
  resolveChatAgentTarget,
  type ChatAgentLike,
} from '../src/lib/chatAgentTargets';
import { dispatchCustomAgentBridgeTask } from '../src/lib/customAgentBridgeDispatcher';

const root = process.cwd();
const chatPath = resolve(root, 'src/screens/circles/tabs/ChatTab.tsx');
const chatSource = readFileSync(chatPath, 'utf8');

let passed = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): condition is true {
  if (condition) {
    passed += 1;
    console.log(`pass: ${label}`);
    return true;
  }
  failures.push(label);
  console.error(`FAIL: ${label}`);
  return false;
}

function section(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  if (!check(start >= 0, `${label}: start marker exists`)) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (!check(end > start, `${label}: end marker follows start`)) return '';
  return source.slice(start, end);
}

function expectMatch(source: string, pattern: RegExp, label: string): void {
  check(pattern.test(source), label);
}

function acceptedResponse(): Response {
  return new Response(JSON.stringify({
    ok: true,
    accepted: true,
    status: 'accepted',
    response: 'accepted once',
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

async function withFetchCapture<T>(run: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<T>): Promise<T> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return acceptedResponse();
  }) as typeof fetch;
  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function headerValue(call: { init?: RequestInit } | undefined, name: string): string | undefined {
  const headers = call?.init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return undefined;
  return (headers as Record<string, string>)[name];
}

function isExplicitlyUnavailable(value: unknown, staleId: string): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  if (row.ok === false && (row.reason === 'not_found' || row.reason === 'unavailable')) return true;
  return row.id === staleId && row.connected === false;
}

async function main(): Promise<void> {
  const dedicatedSpawn = section(
    chatSource,
    'const spawnDedicatedOpenSwanSession = useCallback(async (',
    'useEffect(() => {\n    if (showPluginPicker)',
    'dedicated OpenSwan spawn',
  );
  const terminalDispatch = section(
    chatSource,
    "const bridgeProviders = ['claude-code'",
    'if (supportsGenericCustomAgentDispatch(normalizedProvider))',
    'terminal provider dispatch',
  );

  // A public Office row is not authority to use an arbitrary local OpenSwan
  // runtime. Dedicated spawn must apply the same owner-private binding gate as
  // an ordinary send, before reading local connection state or mutating.
  const dedicatedDbBranch = dedicatedSpawn.indexOf("agent.source === 'db'");
  const dedicatedBindingRead = dedicatedSpawn.indexOf('readOfficeAgentSessionBinding(', dedicatedDbBranch);
  const dedicatedBindingResolve = dedicatedSpawn.indexOf('resolveOfficeAgentSessionBinding(', dedicatedBindingRead);
  const dedicatedSpawnCall = dedicatedSpawn.indexOf('spawnSubAgent(', Math.max(dedicatedBindingResolve, 0));
  check(dedicatedDbBranch >= 0, 'dedicated spawn distinguishes a published DB Office target');
  check(dedicatedBindingRead > dedicatedDbBranch, 'dedicated DB spawn reads the owner-private binding after its DB gate');
  check(dedicatedBindingResolve > dedicatedBindingRead, 'dedicated DB spawn resolves the exact current binding');
  check(dedicatedSpawnCall > dedicatedBindingResolve, 'dedicated DB spawn mutates only after exact binding resolution');
  const dedicatedOwnerGate = dedicatedDbBranch >= 0 && dedicatedBindingRead > dedicatedDbBranch
    ? dedicatedSpawn.slice(dedicatedDbBranch, dedicatedBindingRead)
    : '';
  for (const required of ['currentUserId', 'ownerId', 'isOwn']) {
    expectMatch(dedicatedOwnerGate, new RegExp(`\\b${required}\\b`), `dedicated DB spawn owner gate requires ${required}`);
  }
  expectMatch(dedicatedOwnerGate, /throw\s+new\s+Error|return\s+/, 'dedicated foreign DB target exits before local/provider work');
  const dedicatedResolvedMutation = dedicatedBindingResolve >= 0 && dedicatedSpawnCall > dedicatedBindingResolve
    ? dedicatedSpawn.slice(dedicatedBindingResolve, dedicatedSpawnCall + 180)
    : '';
  expectMatch(
    dedicatedResolvedMutation,
    /spawnSubAgent\s*\(\s*(?:[A-Za-z_$][\w$]*\.)?(?:config|target\.config)/,
    'dedicated DB spawn uses only resolver-produced connection config',
  );

  // Published terminal agents owned by another member cannot be mapped onto
  // this device's local bridge merely because provider names match.
  const wakeIndex = terminalDispatch.indexOf('wakeAndAssignTask(');
  const terminalPreWake = wakeIndex >= 0 ? terminalDispatch.slice(0, wakeIndex) : terminalDispatch;
  check(wakeIndex >= 0, 'terminal provider branch has a bounded local wake call');
  expectMatch(terminalPreWake, /agent\.source\s*===\s*['"]db['"]/, 'terminal DB dispatch has an explicit published-target gate before wake');
  for (const required of ['currentUserId', 'ownerId', 'isOwn']) {
    expectMatch(terminalPreWake, new RegExp(`\\b${required}\\b`), `terminal DB pre-wake gate requires ${required}`);
  }
  expectMatch(terminalPreWake, /throw\s+new\s+Error|return\s+/, 'foreign terminal DB target exits before local wake/launch');

  // A DB target with no immutable connection id or explicit endpoint must not
  // turn provider/name similarity into credential authority.
  const localConnection = {
    id: 'conn-owned-opencode',
    name: 'Different local name',
    provider: 'opencode',
    endpoint: 'https://owned-opencode.example.test',
    token: 'device-local-secret',
    enabled: true,
    status: 'connected',
    remoteId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as any;
  const baseTarget = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Published OpenCode Agent',
    provider: 'opencode',
    ownerId: '22222222-2222-4222-8222-222222222222',
    currentUserId: '22222222-2222-4222-8222-222222222222',
    isOwn: true,
    source: 'db' as const,
  };

  await withFetchCapture(async (calls) => {
    const result = await dispatchCustomAgentBridgeTask(
      baseTarget,
      'must not use a heuristic connection',
      [localConnection],
    );
    check(result.ok === false, 'published DB custom target without exact connection authority fails closed');
    check(result.transportAccepted === false, 'missing custom connection authority is proven pre-dispatch');
    check(calls.length === 0, 'published DB custom target without exact authority performs zero network calls');
  });

  await withFetchCapture(async (calls) => {
    const result = await dispatchCustomAgentBridgeTask(
      { ...baseTarget, connectionId: localConnection.id },
      'use the one explicitly selected connection',
      [localConnection],
    );
    check(result.ok === true && result.transportAccepted === true, 'exact custom connection id may dispatch once');
    check(calls.length === 1, 'exact custom connection id performs one mutation call');
    check(
      headerValue(calls[0], 'Authorization') === 'Bearer device-local-secret',
      'only the exact authorized custom connection supplies its token',
    );
  });

  // `isOwn` is an authenticated projection, but it is not sufficient by
  // itself to release a device-local credential. A published target using an
  // exact local connection must also carry both nonempty owner ids and they
  // must agree. Missing/mismatched identity fails before any network call.
  for (const [label, identity] of [
    ['missing target owner id', { ownerId: undefined, currentUserId: baseTarget.currentUserId }],
    ['missing current user id', { ownerId: baseTarget.ownerId, currentUserId: undefined }],
    ['mismatched owner ids', { ownerId: baseTarget.ownerId, currentUserId: '33333333-3333-4333-8333-333333333333' }],
  ] as const) {
    await withFetchCapture(async (calls) => {
      const result = await dispatchCustomAgentBridgeTask(
        {
          ...baseTarget,
          ...identity,
          connectionId: localConnection.id,
          isOwn: true,
        },
        'must fail before releasing a local credential',
        [localConnection],
      );
      check(result.ok === false, `${label} cannot authorize a published custom dispatch`);
      check(result.transportAccepted === false, `${label} is rejected before transport`);
      check(calls.length === 0, `${label} performs zero network calls`);
      check(!JSON.stringify(calls).includes(localConnection.token), `${label} attaches no device-local token`);
    });
  }

  // A persisted non-default target disappearing from the live roster must not
  // silently mutate the user's selection into default OpenSwan or the first row.
  const agents: ChatAgentLike[] = [
    { id: 'default::blackswan', name: 'OpenSwan', provider: 'openswan', status: 'active' },
    { id: 'live-session', name: 'Codex exact', provider: 'codex', status: 'active', sessionKey: 'codex-session-exact' },
  ];
  const targets = buildChatAgentTargets(agents);
  const staleId = 'agent::removed-session';
  const staleResolution = (resolveChatAgentTarget as any)(targets, staleId);
  check(isExplicitlyUnavailable(staleResolution, staleId), 'stale persisted selected target resolves unavailable instead of another agent');
  check(staleResolution?.id !== DEFAULT_CHAT_AGENT_TARGET_ID, 'stale persisted selected target never falls back to default OpenSwan');
  const exactTargetId = 'agent::live-session';
  const exactResolution = (resolveChatAgentTarget as any)(targets, exactTargetId);
  const exactResolvedId = exactResolution?.ok === true ? exactResolution.target?.id : exactResolution?.id;
  check(exactResolvedId === exactTargetId, 'an extant immutable selected target still resolves exactly');

  if (failures.length > 0) {
    console.error(`\nchat-connected-agent-authority red smoke: ${failures.length} failed, ${passed} passed`);
    failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`\nchat-connected-agent-authority smoke: all ${passed} assertions passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
