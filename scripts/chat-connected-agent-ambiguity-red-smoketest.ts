/**
 * Red-first adversarial contract for Chat terminal/multi-agent target ambiguity
 * and terminal bridge acknowledgement identity.
 *
 * React Native prevents the terminal modules from being imported directly by
 * Node, so their current TypeScript is transpiled into isolated VM modules with
 * only network/runtime dependencies mocked. No real bridge or provider is used.
 *
 * Run:
 *   npx tsx scripts/chat-connected-agent-ambiguity-red-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { parseMultiAgentOrchestrationRequest } from '../src/lib/multiAgentDispatch';

const root = process.cwd();
const terminalPath = resolve(root, 'src/lib/terminalAgentControl.ts');
const bridgePath = resolve(root, 'src/lib/bridgeTaskDispatcher.ts');
const cursorBridgePath = resolve(root, 'scripts/cursor-bridge.js');
const terminalSource = readFileSync(terminalPath, 'utf8');
const bridgeSource = readFileSync(bridgePath, 'utf8');
const cursorBridgeSource = readFileSync(cursorBridgePath, 'utf8');
const transpileOptions: ts.TranspileOptions = {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
};
const compiledTerminalSource = ts.transpileModule(terminalSource, transpileOptions).outputText;
const compiledBridgeSource = ts.transpileModule(bridgeSource, transpileOptions).outputText;

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

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type TerminalModule = {
  findTerminalAgentSessionTarget: (sessions: Array<Record<string, unknown>>, target: string) => unknown;
  resolveTerminalAgentSessionTarget?: (sessions: Array<Record<string, unknown>>, target: string) => unknown;
  executeTerminalAgentControlFromChat: (
    message: string,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown> | null>;
};

function loadTerminalModule(options: {
  sessions: Array<Record<string, unknown>>;
  onSend: (provider: string, sessionId: string, message: string) => Promise<Record<string, unknown>>;
  onLaunch?: () => Promise<Record<string, unknown>>;
}): TerminalModule {
  const module = { exports: {} as Record<string, unknown> };
  const sandbox: Record<string, unknown> = {
    module,
    exports: module.exports,
    require: (specifier: string) => {
      if (specifier === './bridgeAuth') {
        return {
          fetchBridgeAuthenticated: async (url: string) => jsonResponse(200, {
            sessions: url.includes('7779') ? options.sessions : [],
          }),
        };
      }
      if (specifier === './bridgeEnvironment') {
        return { getBridgeUrl: (port: number) => `http://bridge-${port}.test` };
      }
      if (specifier === './bridgeTaskDispatcher') {
        return {
          sendTerminalAgentSessionMessage: options.onSend,
          wakeAndAssignTask: options.onLaunch || (async () => ({
            ok: false,
            transportAccepted: false,
            error: 'launch not expected',
          })),
        };
      }
      if (specifier === './agentIdentity') return { loadAgentIdentities: async () => new Map() };
      if (specifier === './agentRuntimeSubject') {
        return { buildAgentRuntimeSubject: (input: Record<string, unknown>) => ({ metadata: { ...input } }) };
      }
      if (specifier === './chatVisualBriefCore') {
        return { formatVisualBriefsForConnectedAgent: () => '' };
      }
      throw new Error(`Unexpected terminal dependency: ${specifier}`);
    },
    AbortController,
    Response,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: Object.freeze({ log() {}, warn() {}, error() {} }),
  };
  vm.runInNewContext(compiledTerminalSource, sandbox, { filename: terminalPath });
  return module.exports as unknown as TerminalModule;
}

type BridgeModule = {
  dispatchBridgeTask: (provider: string, prompt: string) => Promise<Record<string, unknown>>;
  sendTerminalAgentSessionMessage: (
    provider: string,
    sessionId: string,
    message: string,
  ) => Promise<Record<string, unknown>>;
};

type FetchScenario = {
  fetch: (url: string, init?: Record<string, unknown>) => Promise<Response>;
  calls: Array<{ url: string; method: string }>;
  postCount: () => number;
};

function fetchScenario(post: (url: string, index: number) => Promise<Response>): FetchScenario {
  const calls: Array<{ url: string; method: string }> = [];
  let posts = 0;
  return {
    calls,
    postCount: () => posts,
    fetch: async (url, init) => {
      const method = String(init?.method || 'GET').toUpperCase();
      calls.push({ url, method });
      if (method !== 'POST') return jsonResponse(200, { ok: true });
      posts += 1;
      return post(url, posts);
    },
  };
}

function loadBridgeModule(fetchImpl: FetchScenario['fetch']): BridgeModule {
  const module = { exports: {} as Record<string, unknown> };
  const sandbox: Record<string, unknown> = {
    module,
    exports: module.exports,
    require: (specifier: string) => {
      if (specifier === './bridgeAuth') {
        return { fetchBridgeAuthenticated: fetchImpl };
      }
      if (specifier === './bridgeEnvironment') {
        return { getBridgeUrl: (port: number) => `http://bridge-${port}.test` };
      }
      if (specifier === './agentDevelopmentStandards') {
        return { applyAgentDevelopmentStandardsToPrompt: (value: string) => value };
      }
      if (specifier === './agentIdentity') return {};
      if (specifier === './supabase') return { supabase: null };
      throw new Error(`Unexpected bridge dependency: ${specifier}`);
    },
    fetch: fetchImpl,
    AbortController,
    Response,
    process: {
      env: {
        EXPO_PUBLIC_ALLOW_CLAUDE_CODE_BILLING: 'true',
      },
    },
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: Object.freeze({ log() {}, warn() {}, error() {} }),
  };
  vm.runInNewContext(compiledBridgeSource, sandbox, { filename: bridgePath });
  return module.exports as unknown as BridgeModule;
}

function hasTerminalCompletionClaim(value: unknown): boolean {
  return /\b(?:task\s+)?(?:completed|done|finished|succeeded)\b/i.test(String(value || ''));
}

function sourceSection(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  check(start >= 0, `${label}: start marker exists`);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(end > start, `${label}: end marker exists`);
  return end > start ? source.slice(start, end) : '';
}

type CursorExactSendHarness = {
  send(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  inputCalls: Array<Record<string, unknown>>;
  writes: () => number;
};

function loadCursorExactSendHarness(
  sessions: Array<Record<string, unknown>>,
  inputResult: Record<string, unknown>,
): CursorExactSendHarness | null {
  const implementation = sourceSection(
    cursorBridgeSource,
    'function findManagedCursorSession(',
    '// ── Periodic scan',
    'Cursor exact-session send',
  );
  if (!implementation) return null;

  const inputCalls: Array<Record<string, unknown>> = [];
  let writes = 0;
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const sandbox: Record<string, unknown> = {
    module: moduleRecord,
    exports: moduleRecord.exports,
    cachedSessions: sessions,
    normalizeCliPrompt: (value: unknown) => String(value || '').trim(),
    promptPreview: (value: unknown, limit: number) => String(value || '').slice(0, limit),
    sendPromptToCursorComposer: async (input: Record<string, unknown>) => {
      inputCalls.push(input);
      return inputResult;
    },
    registerManagedCursorSession: (session: Record<string, unknown>) => {
      writes += 1;
      return session;
    },
    doScan: () => {},
  };
  try {
    vm.runInNewContext(
      `${implementation}\nmodule.exports.send = sendToManagedCursorSession;`,
      sandbox,
      { filename: cursorBridgePath },
    );
  } catch (error) {
    failures.push(`Cursor exact-session send evaluates (${String(error)})`);
    return null;
  }
  const send = moduleRecord.exports.send;
  check(typeof send === 'function', 'Cursor exact-session send is callable');
  if (typeof send !== 'function') return null;
  return {
    send: send as CursorExactSendHarness['send'],
    inputCalls,
    writes: () => writes,
  };
}

async function main(): Promise<void> {
  // Provider-wide aliases such as "Codex" are ambiguous when two sessions are
  // live. The full Chat control path must return a non-dispatch result and must
  // not silently send to whichever row sorted first.
  const codexSessions = [
    {
      provider: 'codex',
      sessionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      displayName: 'Codex #1',
      status: 'active',
      terminalTitle: 'UC Codex #1',
    },
    {
      provider: 'codex',
      sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      displayName: 'Codex #2',
      status: 'active',
      terminalTitle: 'UC Codex #2',
    },
  ];
  const sentSessionIds: string[] = [];
  let launches = 0;
  const terminal = loadTerminalModule({
    sessions: codexSessions,
    onSend: async (_provider, sessionId) => {
      sentSessionIds.push(sessionId);
      return {
        ok: true,
        transportAccepted: true,
        sessionId,
        displayName: sessionId === codexSessions[0].sessionId ? 'Codex #1' : 'Codex #2',
      };
    },
    onLaunch: async () => {
      launches += 1;
      return { ok: true, transportAccepted: true };
    },
  });
  const ambiguousResult = await terminal.executeTerminalAgentControlFromChat(
    'tell Codex to perform exactly once',
    { launchIfMissing: true, circleId: 'circle-test' },
  );
  check(sentSessionIds.length === 0, 'ambiguous terminal provider alias performs zero exact-session sends');
  check(launches === 0, 'ambiguous terminal provider alias performs zero replacement launches');
  check(ambiguousResult?.ok === false, 'ambiguous terminal provider alias returns a non-success result');
  check(/ambig|multiple|more than one/i.test(String(ambiguousResult?.message || '')), 'ambiguous terminal result explains that the target is not unique');

  const directAmbiguous = (
    terminal.resolveTerminalAgentSessionTarget
      ? terminal.resolveTerminalAgentSessionTarget(codexSessions, 'Codex')
      : terminal.findTerminalAgentSessionTarget(codexSessions, 'Codex')
  ) as any;
  check(
    directAmbiguous?.status === 'ambiguous'
      || (directAmbiguous?.ok === false && directAmbiguous?.reason === 'ambiguous'),
    'terminal target resolver exposes a typed ambiguous result instead of the first session',
  );

  sentSessionIds.length = 0;
  const exactResult = await terminal.executeTerminalAgentControlFromChat(
    `/agent "Codex #2" perform one exact send`,
    { launchIfMissing: false, circleId: 'circle-test' },
  );
  check(exactResult?.ok === true, 'one exact terminal display name remains dispatchable');
  check(
    sentSessionIds.length === 1 && sentSessionIds[0] === codexSessions[1].sessionId,
    'one exact terminal display name sends once to its immutable session id',
  );

  // Duplicate Office display names are legal across owners. Multi-agent
  // mentions must surface ambiguity rather than collapse them through find().
  const bridgeWorkerId = 'bridge::codex::codex-session-01';
  const openSwanWorkerId = 'connection-owned-01::agent:main:subagent:worker-02';
  const bridgeReviewerId = 'bridge::claude-code::claude-session-03';
  const duplicateAgents = [
    { id: bridgeWorkerId, name: 'Worker', provider: 'codex', status: 'active' },
    { id: openSwanWorkerId, name: 'Worker', provider: 'openswan', status: 'active' },
    { id: bridgeReviewerId, name: 'Reviewer', provider: 'claude-code', status: 'active' },
  ];
  const duplicatePlan = parseMultiAgentOrchestrationRequest(
    '@Worker @Reviewer inspect the release',
    duplicateAgents,
  );
  check(duplicatePlan?.kind === 'help', 'duplicate multi-agent alias produces help instead of a dispatch plan');
  check((duplicatePlan?.targetIds || []).length === 0, 'duplicate multi-agent alias resolves zero immutable target ids');
  check(/ambig|multiple|more than one/i.test(String(duplicatePlan?.reason || '')), 'duplicate multi-agent help identifies target ambiguity');

  const exactMentionPlan = parseMultiAgentOrchestrationRequest(
    `@${bridgeWorkerId} @${bridgeReviewerId} inspect the release`,
    duplicateAgents,
  );
  check(exactMentionPlan?.kind === 'dispatch', 'direct mentions accept production-shaped immutable bridge ids');
  check(
    exactMentionPlan?.targetIds.join(',') === `${bridgeWorkerId},${bridgeReviewerId}`,
    'direct production-id mention dispatch preserves the intended duplicate-name bridge agent',
  );

  const exactSlashPlan = parseMultiAgentOrchestrationRequest(
    `/multi @${openSwanWorkerId} @${bridgeReviewerId} inspect the release`,
    duplicateAgents,
  );
  check(exactSlashPlan?.kind === 'dispatch', '/multi mentions accept production-shaped connection/session ids');
  check(
    exactSlashPlan?.targetIds.join(',') === `${openSwanWorkerId},${bridgeReviewerId}`,
    '/multi production-id dispatch preserves the intended duplicate-name OpenSwan agent',
  );

  const uniquePlan = parseMultiAgentOrchestrationRequest(
    '@Builder @Reviewer inspect the release',
    [
      { id: 'builder', name: 'Builder', provider: 'codex', status: 'active' },
      { id: 'reviewer', name: 'Reviewer', provider: 'claude-code', status: 'active' },
    ],
  );
  check(uniquePlan?.kind === 'dispatch', 'unique multi-agent aliases still produce a dispatch plan');
  check(
    uniquePlan?.targetIds.join(',') === 'builder,reviewer',
    'unique multi-agent aliases preserve exact immutable target ids',
  );

  // A positive body inside HTTP 5xx is not positive transport evidence. Both
  // direct adapters must remain unknown and perform only the original POST.
  for (const provider of ['claude-code', 'gemini'] as const) {
    const scenario = fetchScenario(async () => jsonResponse(500, {
      ok: true,
      launched: 1,
      results: [{ ok: true, spawnId: 'misleading-handle' }],
      response: 'misleading success body',
    }));
    const bridge = loadBridgeModule(scenario.fetch);
    const result = await bridge.dispatchBridgeTask(provider, 'perform one mutation');
    check(result.ok === false, `${provider} HTTP 5xx plus data.ok is never accepted`);
    check(result.transportAccepted === null, `${provider} HTTP 5xx remains outcome unknown after POST`);
    check(scenario.postCount() === 1, `${provider} HTTP 5xx response is not replayed`);
  }

  const copyScenario = fetchScenario(async () => jsonResponse(200, { ok: true }));
  const copyBridge = loadBridgeModule(copyScenario.fetch);
  const copyResult = await copyBridge.dispatchBridgeTask('gemini', 'accept but do not claim completion');
  check(copyResult.ok === true && copyResult.transportAccepted === true, 'Gemini explicit 2xx acceptance remains accepted');
  check(!hasTerminalCompletionClaim(copyResult.response), 'Gemini transport acknowledgement never defaults to terminal completion copy');

  // Exact-session acceptance requires an exact echoed identity. Missing or
  // mismatched echoes are outcome-unknown and are never retried.
  for (const [label, responseBody] of [
    ['missing echo', { ok: true }],
    ['mismatched echo', { ok: true, sessionId: 'different-session-id' }],
  ] as const) {
    const scenario = fetchScenario(async () => jsonResponse(200, responseBody));
    const bridge = loadBridgeModule(scenario.fetch);
    const result = await bridge.sendTerminalAgentSessionMessage(
      'codex',
      'requested-session-id',
      'perform exactly once',
    );
    check(result.ok === false, `terminal ${label} is not accepted`);
    check(result.transportAccepted === null, `terminal ${label} remains outcome unknown`);
    check(scenario.postCount() === 1, `terminal ${label} is not replayed`);
  }

  const exactEchoScenario = fetchScenario(async () => jsonResponse(200, {
    ok: true,
    sessionId: 'requested-session-id',
    displayName: 'Codex exact',
  }));
  const exactEchoBridge = loadBridgeModule(exactEchoScenario.fetch);
  const exactEcho = await exactEchoBridge.sendTerminalAgentSessionMessage(
    'codex',
    'requested-session-id',
    'perform exactly once',
  );
  check(exactEcho.ok === true && exactEcho.transportAccepted === true, 'exact echoed terminal session identity is accepted');
  check(exactEcho.sessionId === 'requested-session-id', 'exact terminal acceptance preserves requested session lineage');
  check(exactEchoScenario.postCount() === 1, 'exact terminal acceptance performs one send');

  // Cursor's managed-session row is not proof that the GUI input landed in
  // that Composer. A frontmost/mismatched Composer acknowledgement must never
  // be rewritten as success for the requested record or persisted into it.
  const requestedCursorId = 'cursor-composer-launch::requested-01';
  const frontmostCursorId = 'cursor-composer-launch::frontmost-02';
  const cursorHarness = loadCursorExactSendHarness([
    {
      sessionId: requestedCursorId,
      displayName: 'Requested Composer',
      projectDir: '/tmp/requested-cursor-project',
      status: 'idle',
      recentActions: [],
      messageCount: 0,
    },
    {
      sessionId: frontmostCursorId,
      displayName: 'Frontmost Composer',
      projectDir: '/tmp/frontmost-cursor-project',
      status: 'active',
      recentActions: [],
      messageCount: 0,
    },
  ], {
    ok: true,
    sessionId: frontmostCursorId,
    displayName: 'Frontmost Composer',
  });
  if (cursorHarness) {
    const mismatchedCursor = await cursorHarness.send({
      sessionId: requestedCursorId,
      message: 'must not land in whichever Composer is frontmost',
    });
    check(mismatchedCursor.ok === false, 'Cursor frontmost-session mismatch is never accepted for the requested session');
    check(cursorHarness.inputCalls.length <= 1, 'Cursor frontmost mismatch is never replayed');
    check(cursorHarness.writes() === 0, 'Cursor frontmost mismatch does not update the requested managed-session record');
  }

  if (failures.length > 0) {
    console.error(`\nchat-connected-agent-ambiguity red smoke: ${failures.length} failed, ${passed} passed`);
    failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`\nchat-connected-agent-ambiguity smoke: all ${passed} assertions passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
