/**
 * Red-first safety contract for Chat's generic/custom connected-agent bridge.
 *
 * This smoke uses a mocked fetch only. It pins two mutation boundaries:
 *   1. A device-local token may be attached only for the current owner's exact
 *      enabled connection endpoint. Provider/name similarity is not authority.
 *   2. Endpoint probing may continue only after an explicit pre-dispatch
 *      404/405. Any ambiguous transport/response failure stops without replay.
 *
 * Run while runtime wiring is in flight:
 *   npx tsx scripts/custom-agent-bridge-safety-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  dispatchCustomAgentBridgeTask,
  type CustomAgentBridgeDispatchResult,
} from '../src/lib/customAgentBridgeDispatcher';
import type { AgentConnection } from '../src/lib/connectionManager';

const root = process.cwd();
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

function section(source: string, start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  if (!check(startIndex >= 0, `${label}: start marker exists`)) return '';
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (!check(endIndex > startIndex, `${label}: end marker exists`)) return '';
  return source.slice(startIndex, endIndex);
}

function connection(overrides: Partial<AgentConnection> = {}): AgentConnection {
  return {
    id: 'conn-owned',
    name: 'Owned OpenCode Bridge',
    provider: 'opencode',
    endpoint: 'https://owned-bridge.example.test',
    token: 'token-must-stay-on-owned-endpoint',
    enabled: true,
    status: 'connected',
    color: '#38bdf8',
    ...overrides,
  };
}

function target(overrides: Record<string, unknown> = {}): any {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Owned OpenCode Bridge',
    provider: 'opencode',
    gatewayUrl: 'https://owned-bridge.example.test/',
    ownerId: '33333333-3333-4333-8333-333333333333',
    currentUserId: '33333333-3333-4333-8333-333333333333',
    isOwn: true,
    circleId: '22222222-2222-4222-8222-222222222222',
    ...overrides,
  };
}

type FetchCall = { url: string; init?: RequestInit };

async function withFetchMock<T>(
  handler: (call: FetchCall, index: number) => Promise<Response> | Response,
  run: (calls: FetchCall[]) => Promise<T>,
): Promise<T> {
  const calls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;

  // Keep intentionally thrown timeout/network cases from leaving the bridge's
  // 20-second abort timer holding this source smoke open. The real timer still
  // exists and fires normally; it is merely unref'd in this isolated process.
  globalThis.setTimeout = ((callback: (...args: any[]) => void, delay?: number, ...args: any[]) => {
    const timer = originalSetTimeout(callback, delay, ...args);
    (timer as any)?.unref?.();
    return timer;
  }) as typeof setTimeout;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init };
    calls.push(call);
    return handler(call, calls.length - 1);
  }) as typeof fetch;

  try {
    return await run(calls);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  }
}

function headersOf(call: FetchCall | undefined): Record<string, string> {
  const headers = call?.init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) return {};
  return headers as Record<string, string>;
}

function hasLocalCredential(call: FetchCall | undefined): boolean {
  const headers = headersOf(call);
  return Boolean(
    headers.Authorization
    || headers.authorization
    || headers['X-UC-Agent-Token']
    || headers['X-UC-Desktop-Token'],
  );
}

function acceptedResponse(message = 'accepted once'): Response {
  return new Response(JSON.stringify({
    accepted: true,
    status: 'accepted',
    response: message,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function asSafetyResult(result: CustomAgentBridgeDispatchResult): CustomAgentBridgeDispatchResult & {
  transportAccepted?: boolean | null;
} {
  return result;
}

async function main(): Promise<void> {
  // ── Exact endpoint credential authority ─────────────────────────────────

  const exact = await withFetchMock(
    () => acceptedResponse(),
    async (calls) => {
      const result = asSafetyResult(await dispatchCustomAgentBridgeTask(
        target(),
        'perform one exact bridge task',
        [connection()],
      ));
      check(calls.length === 1, 'exact owner endpoint makes one mutation call');
      check(calls[0]?.url === 'https://owned-bridge.example.test/task', 'exact owner endpoint is normalized once');
      check(headersOf(calls[0]).Authorization === 'Bearer token-must-stay-on-owned-endpoint', 'exact owner endpoint receives its own bearer token');
      check(headersOf(calls[0])['X-UC-Agent-Token'] === 'token-must-stay-on-owned-endpoint', 'exact owner endpoint receives its own UC agent token');
      check(result.ok === true, 'one exact accepted response succeeds');
      check(result.transportAccepted === true, 'one exact accepted response records positive transport acceptance');
      return result;
    },
  );
  check(exact.ok, 'positive exact-endpoint fixture completes');

  for (const [label, selectedTarget, connections] of [
    [
      'provider fallback to a different target gateway',
      target({ gatewayUrl: 'https://different-target.example.test', name: 'Different target' }),
      [connection({ name: 'Not the target name' })],
    ],
    [
      'name fallback to a different target gateway',
      target({ gatewayUrl: 'https://different-target.example.test', provider: 'aider' }),
      [connection({ provider: 'generic-agent', name: 'Owned OpenCode Bridge' })],
    ],
    [
      'non-owner target at an otherwise matching local endpoint',
      target({ isOwn: false }),
      [connection()],
    ],
    [
      'target with omitted ownership at an otherwise matching local endpoint',
      target({ isOwn: undefined }),
      [connection()],
    ],
    [
      'disabled local connection at an otherwise matching endpoint',
      target(),
      [connection({ enabled: false })],
    ],
  ] as const) {
    await withFetchMock(
      () => acceptedResponse(),
      async (calls) => {
        await dispatchCustomAgentBridgeTask(selectedTarget as any, 'credential isolation task', [...connections]);
        check(calls.length === 1, `${label} makes at most one anonymous target call`);
        check(!hasLocalCredential(calls[0]), `${label} never borrows a device-local credential`);
      },
    );
  }

  // ── Structured failure semantics ────────────────────────────────────────

  for (const status of ['failed', 'error', 'rejected', 'cancelled'] as const) {
    await withFetchMock(
      () => new Response(JSON.stringify({
        ok: true,
        accepted: true,
        status,
        response: 'misleading success prose',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
      async (calls) => {
        const result = asSafetyResult(await dispatchCustomAgentBridgeTask(
          target(),
          `structured ${status} task`,
          [connection()],
        ));
        check(result.ok === false, `explicit JSON status ${status} is never success`);
        check(calls.length === 1, `explicit JSON status ${status} is not replayed to another path`);
      },
    );
  }

  // ── Mutation probe replay boundary ──────────────────────────────────────

  await withFetchMock(
    (_call, index) => {
      if (index === 0) return new Response('not found before dispatch', { status: 404 });
      if (index === 1) return new Response('method unsupported before dispatch', { status: 405 });
      return acceptedResponse('accepted after explicit unsupported paths');
    },
    async (calls) => {
      const result = asSafetyResult(await dispatchCustomAgentBridgeTask(
        target(),
        'probe only explicit unsupported endpoints',
        [connection()],
      ));
      check(calls.length === 3, 'explicit 404 then 405 may probe exactly one next path each');
      check(calls.map((call) => new URL(call.url).pathname).join(',') === '/task,/tasks,/message', 'safe probing preserves the bounded endpoint order');
      check(result.ok === true && result.transportAccepted === true, 'accepted fallback after explicit 404/405 is positively classified');
    },
  );

  const ambiguousCases: Array<[
    string,
    (call: FetchCall, index: number) => Promise<Response> | Response,
  ]> = [
    [
      'network failure',
      async () => { throw new TypeError('network connection lost'); },
    ],
    [
      'timeout',
      async () => { throw new DOMException('request aborted', 'AbortError'); },
    ],
    [
      'HTTP 500 after the mutation request',
      async () => new Response('server failed after request receipt', { status: 500 }),
    ],
    [
      'response-body loss after HTTP success',
      async () => ({
        ok: true,
        status: 200,
        text: async () => { throw new TypeError('response stream lost'); },
      } as unknown as Response),
    ],
  ];

  for (const [label, handler] of ambiguousCases) {
    await withFetchMock(
      handler,
      async (calls) => {
        const result = asSafetyResult(await dispatchCustomAgentBridgeTask(
          target(),
          `${label} mutation task`,
          [connection()],
        ));
        check(calls.length === 1, `${label} stops after one mutation attempt with zero path replay`);
        check(result.ok === false, `${label} is not success`);
        check(result.transportAccepted === null, `${label} records transportAccepted null`);
      },
    );
  }

  // ── Source wiring ───────────────────────────────────────────────────────

  const dispatcherSource = readFileSync(resolve(root, 'src/lib/customAgentBridgeDispatcher.ts'), 'utf8');
  const chatSource = readFileSync(resolve(root, 'src/screens/circles/tabs/ChatTab.tsx'), 'utf8');
  const dispatchSection = section(
    dispatcherSource,
    'export async function dispatchCustomAgentBridgeTask(',
    'function normalizeEndpoint(',
    'custom bridge dispatch',
  );
  const successClassifier = section(
    dispatcherSource,
    'function isSuccessfulBody(',
    'function extractResponse(',
    'custom bridge structured success classifier',
  );

  expectMatch(
    dispatcherSource,
    /interface\s+CustomAgentBridgeTarget[\s\S]{0,400}\bisOwn\??\s*:\s*boolean/,
    'custom bridge target carries explicit current-owner provenance',
  );
  expectMatch(
    dispatcherSource,
    /interface\s+CustomAgentBridgeDispatchResult[\s\S]{0,500}\btransportAccepted\??\s*:\s*boolean\s*\|\s*null/,
    'custom bridge result exposes typed transport acceptance',
  );
  expectMatch(
    dispatchSection,
    /isOwn\s*===\s*true|target\.isOwn\b/,
    'credential selection requires explicit target ownership',
  );
  expectMatch(
    dispatchSection,
    /connection\.enabled|credentialConnection\.enabled|matchingConnection\.enabled/,
    'credential selection requires an enabled owning connection',
  );
  expectMatch(
    dispatchSection,
    /normalizeEndpoint\([^)]*\.endpoint\)[\s\S]{0,180}===\s*(?:targetGateway|endpoint)|(?:targetGateway|endpoint)\s*===[\s\S]{0,180}normalizeEndpoint\([^)]*\.endpoint\)/,
    'credential selection requires exact normalized endpoint equality',
  );
  expectNoMatch(
    dispatchSection,
    /buildHeaders\(\s*connection\?\.token\s*\)/,
    'dispatch never forwards a heuristic connection token directly',
  );
  expectMatch(
    successClassifier,
    /failed[\s\S]{0,160}error[\s\S]{0,160}rejected[\s\S]{0,160}cancelled|(?:failed|error|rejected|cancelled)[\s\S]{0,500}Set\s*\(/i,
    'structured success classifier rejects explicit failed/error/rejected/cancelled statuses',
  );
  expectMatch(
    dispatchSection,
    /res\.status\s*===\s*404\s*\|\|\s*res\.status\s*===\s*405/,
    'only explicit pre-dispatch 404/405 authorize endpoint probing',
  );
  expectMatch(
    dispatchSection,
    /transportAccepted:\s*null/,
    'ambiguous mutation outcomes are typed transportAccepted null',
  );

  const assignableAgent = section(
    chatSource,
    'type AssignableAgent = {',
    'function applyTerminalProfileToTask(',
    'Chat assignable-agent type',
  );
  const dbAgentProjection = section(
    chatSource,
    'function toAssignableDbAgent(',
    'function toAssignableSessionAgent(',
    'Chat published-agent projection',
  );
  const customDispatchCall = section(
    chatSource,
    'if (supportsGenericCustomAgentDispatch(normalizedProvider)) {',
    'const agentSubject = buildAgentRuntimeSubject(',
    'Chat custom-agent dispatch call',
  );
  expectMatch(assignableAgent, /\bisOwn\??\s*:\s*boolean/, 'Chat assignable agents retain owner provenance');
  expectMatch(dbAgentProjection, /isOwn:\s*agent\.isOwn\s*===\s*true/, 'published-agent projection preserves exact current ownership');
  expectMatch(customDispatchCall, /isOwn:\s*agent\.isOwn\s*===\s*true/, 'Chat forwards exact ownership into credential resolution');

  if (failures.length > 0) {
    console.error(`custom-agent-bridge-safety smoke: ${failures.length} failed, ${passed} passed`);
    failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(`custom-agent-bridge-safety smoke: all ${passed} assertions passed`);
}

void main().catch((error) => {
  console.error('custom-agent-bridge-safety smoke crashed:', error);
  process.exitCode = 1;
});
