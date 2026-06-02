/**
 * custom-agent-bridge-dispatch-smoketest
 *
 * Verifies the generic bridge contract used by selected chat agents such as
 * OpenCode, Aider, Cline, Windsurf, Continue, Amp, and user custom agents.
 *
 * Run: npm run smoke:custom-agent-bridge-dispatch
 */
import {
  dispatchCustomAgentBridgeTask,
  findCustomAgentConnection,
  normalizeCustomAgentProvider,
  supportsGenericCustomAgentDispatch,
} from '../src/lib/customAgentBridgeDispatcher';
import type { AgentConnection } from '../src/lib/connectionManager';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' - ' + detail : ''}`);
}

function conn(overrides: Partial<AgentConnection>): AgentConnection {
  return {
    id: 'conn_1',
    name: 'OpenCode Bridge',
    provider: 'opencode',
    endpoint: 'http://127.0.0.1:7791',
    token: 'tok_123',
    enabled: true,
    status: 'connected',
    color: '#38bdf8',
    ...overrides,
  };
}

async function withFetchStub<T>(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
  run: () => Promise<T>,
): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => (
    handler(String(input), init)
  )) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

async function main() {
  assert(normalizeCustomAgentProvider('open-code') === 'opencode', 'normalizes OpenCode aliases');
  assert(supportsGenericCustomAgentDispatch('continue'), 'Continue supports generic dispatch');
  assert(!supportsGenericCustomAgentDispatch('openswan'), 'OpenSwan is excluded from generic dispatch');

  const direct = findCustomAgentConnection(
    { name: 'OpenCode Bridge', provider: 'opencode' },
    [conn({ id: 'generic', provider: 'generic-agent' }), conn({ id: 'direct' })],
  );
  assert(direct?.id === 'direct', 'provider-specific bridge wins over generic fallback');

  const generic = findCustomAgentConnection(
    { name: 'Aider', provider: 'aider' },
    [conn({ id: 'generic', provider: 'generic-agent', name: 'Shared Bridge' })],
  );
  assert(generic?.id === 'generic', 'generic bridge can serve a specific custom provider');

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const ok = await withFetchStub(async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/task')) return new Response('missing', { status: 404 });
    return new Response(JSON.stringify({ ok: true, response: 'accepted by bridge' }), { status: 200 });
  }, () => dispatchCustomAgentBridgeTask(
    { name: 'OpenCode Bridge', provider: 'opencode', circleId: 'circle_1', model: 'fast' },
    'fix a TypeScript planner bug',
    [conn({})],
  ));
  assert(ok.ok, 'dispatch succeeds after endpoint fallback');
  assert(ok.path === '/tasks', 'dispatch tries /tasks after /task returns 404', `got ${ok.path}`);
  assert(ok.response === 'accepted by bridge', 'dispatch returns bridge response text');
  assert(calls[0]?.url === 'http://127.0.0.1:7791/task', 'first dispatch URL is normalized');
  const sentHeaders = calls[1]?.init?.headers as Record<string, string> | undefined;
  assert(sentHeaders?.Authorization === 'Bearer tok_123', 'dispatch sends bearer token');
  assert(sentHeaders?.['X-UC-Agent-Token'] === 'tok_123', 'dispatch sends UC agent token');
  const sentBody = JSON.parse(String(calls[1]?.init?.body || '{}'));
  assert(sentBody.originalTask === 'fix a TypeScript planner bug' && sentBody.provider === 'opencode', 'dispatch body carries original task and provider');
  assert(sentBody.task.includes('=== AGENT DEVELOPMENT STANDARDS ==='), 'dispatch body carries standards handoff block');
  assert(sentBody.task.includes('docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md'), 'dispatch body carries relevant TypeScript standard');

  const gatewayOnly = await withFetchStub(async () => (
    new Response(JSON.stringify({ accepted: true, message: 'gateway accepted' }), { status: 200 })
  ), () => dispatchCustomAgentBridgeTask(
    { name: 'Remote Continue', provider: 'continue', gatewayUrl: 'https://bridge.example.com/' },
    'summarize repo',
    [],
  ));
  assert(gatewayOnly.ok && gatewayOnly.endpoint === 'https://bridge.example.com', 'published gateway URL works without local connection');

  const invalid = await dispatchCustomAgentBridgeTask(
    { name: 'Bad', provider: 'aider', gatewayUrl: 'file:///tmp/nope' },
    'run',
    [],
  );
  assert(!invalid.ok && invalid.error?.includes('invalid'), 'invalid endpoint fails closed');

  if (failures > 0) {
    console.error(`\n${failures} custom-agent-bridge-dispatch smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll custom-agent-bridge-dispatch smoke cases passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
