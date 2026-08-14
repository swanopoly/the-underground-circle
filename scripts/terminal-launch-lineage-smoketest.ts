/**
 * Red-first contract for managed terminal launch lineage.
 *
 * A successful /launch response is allowed to become a connected-agent
 * acceptance only when it identifies exactly one bounded provider session.
 * The test executes the four client launch adapters with mocked HTTP and then
 * executes terminalAgentControl with mocked dependencies. No bridge, terminal,
 * provider, Supabase row, or canonical run is touched.
 *
 * Run: npx tsx scripts/terminal-launch-lineage-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const root = process.cwd();
const bridgePath = resolve(root, 'src/lib/bridgeTaskDispatcher.ts');
const terminalPath = resolve(root, 'src/lib/terminalAgentControl.ts');
const chatPath = resolve(root, 'src/screens/circles/tabs/ChatTab.tsx');

const bridgeSource = readFileSync(bridgePath, 'utf8');
const terminalSource = readFileSync(terminalPath, 'utf8');
const chatSource = readFileSync(chatPath, 'utf8');

const compile = (source: string, fileName: string) => ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName,
}).outputText;

const compiledBridgeSource = compile(bridgeSource, bridgePath);
const compiledTerminalSource = compile(terminalSource, terminalPath);

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

function sourceSection(source: string, start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, Math.max(0, startIndex + start.length));
  check(startIndex >= 0, `${label}: start marker exists`);
  check(endIndex > startIndex, `${label}: end marker exists`);
  return startIndex >= 0 && endIndex > startIndex ? source.slice(startIndex, endIndex) : '';
}

type BridgeResult = {
  ok: boolean;
  transportAccepted: boolean | null;
  response?: string;
  error?: string;
  dispatchedVia: string;
  provider: string;
  sessionId?: string;
  displayName?: string;
};

type BridgeModule = {
  spawnNewClaudeSession: (task: string) => Promise<BridgeResult>;
  spawnNewCodexSession: (task: string) => Promise<BridgeResult>;
  spawnNewGeminiCliSession: (task: string) => Promise<BridgeResult>;
  spawnNewCursorComposerSession: (task: string) => Promise<BridgeResult>;
};

type FetchCall = { url: string; method: string };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function loadBridgeModule(launchBody: unknown): {
  bridge: BridgeModule;
  calls: FetchCall[];
} {
  const calls: FetchCall[] = [];
  const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = String(init?.method || 'GET').toUpperCase();
    calls.push({ url, method });
    if (method === 'GET') return jsonResponse({ ok: true });
    return jsonResponse(launchBody);
  };

  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const sandbox = {
    module: moduleRecord,
    exports: moduleRecord.exports,
    require(specifier: string): unknown {
      if (specifier === './bridgeAuth') return { fetchBridgeAuthenticated: fetchImpl };
      if (specifier === './bridgeEnvironment') {
        return { getBridgeUrl: (port: number) => `http://bridge-${port}.test` };
      }
      if (specifier === './agentDevelopmentStandards') {
        return { applyAgentDevelopmentStandardsToPrompt: (value: string) => value };
      }
      if (specifier === './agentIdentity') return {};
      throw new Error(`Unexpected bridge dependency: ${specifier}`);
    },
    AbortController,
    Response,
    fetch: fetchImpl,
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
  return { bridge: moduleRecord.exports as unknown as BridgeModule, calls };
}

const adapters = [
  {
    label: 'Claude Code',
    provider: 'claude-code',
    invoke: (bridge: BridgeModule) => bridge.spawnNewClaudeSession('one exact task'),
  },
  {
    label: 'Codex',
    provider: 'codex',
    invoke: (bridge: BridgeModule) => bridge.spawnNewCodexSession('one exact task'),
  },
  {
    label: 'Gemini CLI',
    provider: 'gemini',
    invoke: (bridge: BridgeModule) => bridge.spawnNewGeminiCliSession('one exact task'),
  },
  {
    label: 'Cursor Composer',
    provider: 'cursor',
    invoke: (bridge: BridgeModule) => bridge.spawnNewCursorComposerSession('one exact task'),
  },
] as const;

const exactSessionIdByProvider: Record<string, string> = {
  'claude-code': 'claude-code-launch::exact-01',
  codex: 'codex-launch::exact-01',
  gemini: 'gemini-cli-launch::exact-01',
  cursor: 'cursor-composer-launch::exact-01',
};

async function exerciseLaunchAdapters(): Promise<void> {
  for (const adapter of adapters) {
    const sessionId = exactSessionIdByProvider[adapter.provider];
    const displayName = `${adapter.label} Exact`;
    const positiveFixture = {
      ok: true,
      launchId: `${adapter.provider}-launch`,
      launched: 1,
      failed: [],
      sessions: [{ sessionId, displayName, status: 'active' }],
    };
    const positive = loadBridgeModule(positiveFixture);
    const accepted = await adapter.invoke(positive.bridge);
    check(accepted.ok === true, `${adapter.label}: one exact returned session is accepted`);
    check(accepted.transportAccepted === true, `${adapter.label}: exact launch records positive transport acceptance`);
    check(accepted.sessionId === sessionId, `${adapter.label}: BridgeTaskResult preserves exact sessionId`);
    check(accepted.displayName === displayName, `${adapter.label}: BridgeTaskResult preserves displayName`);
    check(accepted.provider === adapter.provider, `${adapter.label}: BridgeTaskResult preserves provider`);
    check(positive.calls.filter((call) => call.method === 'POST').length === 1, `${adapter.label}: exact launch makes one mutation call`);

    const invalidFixtures: Array<{ label: string; body: unknown }> = [
      {
        label: 'missing returned session',
        body: { ok: true, launchId: 'missing', launched: 1, failed: [], sessions: [] },
      },
      {
        label: 'missing sessionId',
        body: {
          ok: true,
          launchId: 'missing-id',
          launched: 1,
          failed: [],
          sessions: [{ displayName: 'No exact id', status: 'active' }],
        },
      },
      {
        label: 'unsafe sessionId',
        body: {
          ok: true,
          launchId: 'unsafe-id',
          launched: 1,
          failed: [],
          sessions: [{ sessionId: 'not an exact id', displayName: 'Unsafe', status: 'active' }],
        },
      },
      {
        label: 'receipt-incompatible sessionId punctuation',
        body: {
          ok: true,
          launchId: 'unsafe-punctuation-id',
          launched: 1,
          failed: [],
          sessions: [{ sessionId: `${sessionId}/child`, displayName: 'Unsafe punctuation', status: 'active' }],
        },
      },
      {
        label: 'sessionId without an alphanumeric prefix',
        body: {
          ok: true,
          launchId: 'unsafe-prefix-id',
          launched: 1,
          failed: [],
          sessions: [{ sessionId: ':provider-session', displayName: 'Unsafe prefix', status: 'active' }],
        },
      },
      {
        label: 'sessionId with bidirectional control text',
        body: {
          ok: true,
          launchId: 'unsafe-bidi-id',
          launched: 1,
          failed: [],
          sessions: [{ sessionId: `provider-${String.fromCharCode(0x202e)}-session`, displayName: 'Unsafe bidi', status: 'active' }],
        },
      },
      {
        label: 'overlong sessionId',
        body: {
          ok: true,
          launchId: 'overlong-id',
          launched: 1,
          failed: [],
          sessions: [{ sessionId: `s${'x'.repeat(160)}`, displayName: 'Overlong', status: 'active' }],
        },
      },
      {
        label: 'multiple successful identities',
        body: {
          ok: true,
          launchId: 'multiple',
          launched: 2,
          failed: [],
          sessions: [
            { sessionId: `${sessionId}-a`, displayName: `${displayName} A`, status: 'active' },
            { sessionId: `${sessionId}-b`, displayName: `${displayName} B`, status: 'active' },
          ],
        },
      },
    ];

    for (const fixture of invalidFixtures) {
      const scenario = loadBridgeModule(fixture.body);
      const result = await adapter.invoke(scenario.bridge);
      check(result.ok === false, `${adapter.label}: ${fixture.label} is not accepted`);
      check(result.transportAccepted === null, `${adapter.label}: ${fixture.label} remains outcome_unknown after POST`);
      check(!result.sessionId, `${adapter.label}: ${fixture.label} exposes no accepted session lineage`);
      check(scenario.calls.filter((call) => call.method === 'POST').length === 1, `${adapter.label}: ${fixture.label} is never replayed`);
      const canonicalWrites = result.ok && result.transportAccepted === true && Boolean(result.sessionId) ? 1 : 0;
      check(canonicalWrites === 0, `${adapter.label}: ${fixture.label} cannot create an accepted canonical run`);
    }
  }
}

type TerminalControlResult = {
  kind: 'status_query' | 'handoff';
  ok: boolean;
  transportAccepted?: boolean | null;
  provider?: string;
  actor?: string;
  sessionId?: string;
  agentSubjectMetadata?: {
    agentSubjectKey?: string;
    agentDisplayName?: string;
    agentSessionKey?: string | null;
  };
};

type TerminalModule = {
  executeTerminalAgentControlFromChat: (
    message: string,
    options?: { circleId?: string; launchIfMissing?: boolean },
  ) => Promise<TerminalControlResult | null>;
};

function loadTerminalModule(launchResult: BridgeResult): {
  terminal: TerminalModule;
  launchProviders: string[];
} {
  const launchProviders: string[] = [];
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const sandbox = {
    module: moduleRecord,
    exports: moduleRecord.exports,
    require(specifier: string): unknown {
      if (specifier === './bridgeAuth') {
        return {
          fetchBridgeAuthenticated: async () => ({
            ok: true,
            json: async () => ({ sessions: [] }),
          }),
        };
      }
      if (specifier === './bridgeEnvironment') {
        return { getBridgeUrl: (port: number) => `http://bridge-${port}.test` };
      }
      if (specifier === './bridgeTaskDispatcher') {
        return {
          sendTerminalAgentSessionMessage: async () => {
            throw new Error('existing-session send must not run in a launch-if-missing fixture');
          },
          wakeAndAssignTask: async (provider: string) => {
            launchProviders.push(provider);
            return launchResult;
          },
        };
      }
      if (specifier === './agentIdentity') {
        return { loadAgentIdentities: async () => new Map() };
      }
      if (specifier === './agentRuntimeSubject') {
        return {
          buildAgentRuntimeSubject: (agent: Record<string, unknown>) => ({
            metadata: {
              agentSubjectKey: agent.sessionKey,
              agentDisplayName: agent.name,
              agentSessionKey: agent.sessionKey,
            },
          }),
        };
      }
      if (specifier === './chatVisualBriefCore') {
        return { formatVisualBriefsForConnectedAgent: () => '' };
      }
      throw new Error(`Unexpected terminal dependency: ${specifier}`);
    },
    AbortController,
    Map,
    Promise,
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: Object.freeze({ log() {}, warn() {}, error() {} }),
  };
  vm.runInNewContext(compiledTerminalSource, sandbox, { filename: terminalPath });
  return {
    terminal: moduleRecord.exports as unknown as TerminalModule,
    launchProviders,
  };
}

async function exerciseTerminalControlLineage(): Promise<void> {
  const cases = [
    { provider: 'claude-code', label: 'Claude Code', command: 'tell Claude Code to inspect the exact launch' },
    { provider: 'codex', label: 'Codex', command: 'tell Codex to inspect the exact launch' },
    { provider: 'gemini', label: 'Gemini CLI', command: 'tell Gemini CLI to inspect the exact launch' },
    { provider: 'cursor', label: 'Cursor Composer', command: 'tell Cursor Composer to inspect the exact launch' },
  ] as const;

  for (const fixture of cases) {
    const sessionId = exactSessionIdByProvider[fixture.provider];
    const displayName = `${fixture.label} Exact`;
    const harness = loadTerminalModule({
      ok: true,
      transportAccepted: true,
      dispatchedVia: 'bridge',
      provider: fixture.provider,
      sessionId,
      displayName,
    });
    const result = await harness.terminal.executeTerminalAgentControlFromChat(fixture.command, {
      circleId: '11111111-1111-4111-8111-111111111111',
      launchIfMissing: true,
    });
    check(harness.launchProviders.join(',') === fixture.provider, `${fixture.label}: terminal control launches exactly one intended provider`);
    check(result?.kind === 'handoff' && result.ok === true, `${fixture.label}: exact launch becomes a typed accepted handoff`);
    check(result?.transportAccepted === true, `${fixture.label}: exact launch retains positive transport acceptance`);
    check(result?.sessionId === sessionId, `${fixture.label}: terminal control preserves returned sessionId`);
    check(result?.actor === displayName, `${fixture.label}: terminal control preserves returned displayName`);
    check(result?.agentSubjectMetadata?.agentSubjectKey === sessionId, `${fixture.label}: terminal control subject key is the exact sessionId`);
    check(result?.agentSubjectMetadata?.agentSessionKey === sessionId, `${fixture.label}: terminal control subject metadata retains exact session lineage`);
  }
}

type AssignedDispatchReceipt = {
  status?: string;
  sessionId?: string | null;
  runId?: string | null;
};

function loadAssignedDispatchHarness(launchResult: BridgeResult): {
  dispatch: (
    agent: Record<string, unknown>,
    task: string,
    visualArtifacts?: readonly unknown[],
  ) => Promise<AssignedDispatchReceipt>;
  wakeCalls: () => number;
  canonicalWrites: () => number;
} | null {
  const assignedDispatch = sourceSection(
    chatSource,
    'const dispatchAssignedAgentTask = useCallback',
    'const spawnDedicatedOpenSwanSession = useCallback',
    'Chat assigned-agent executable harness',
  );
  if (!assignedDispatch) return null;

  let wakeCalls = 0;
  let canonicalWrites = 0;
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const compiledAssignedDispatch = compile(
    `${assignedDispatch}\nmodule.exports.dispatch = dispatchAssignedAgentTask;`,
    chatPath,
  );
  const sandbox: Record<string, unknown> = {
    module: moduleRecord,
    exports: moduleRecord.exports,
    useCallback: (callback: unknown) => callback,
    circleId: '11111111-1111-4111-8111-111111111111',
    currentUserId: '22222222-2222-4222-8222-222222222222',
    currentUserName: 'Owner',
    resolveOpenSwanConnection: async () => ({ ok: false }),
    buildAssignableAgentSubjectMetadata: (agent: Record<string, unknown>) => ({
      agentSubjectKey: agent.id,
      agentDisplayName: agent.name,
      agentDbId: agent.id,
      agentProvider: agent.provider,
      agentSessionKey: null,
      legacyAgentIds: [],
    }),
    buildConnectedAgentHandoffReceipt: (input: Record<string, unknown>) => ({
      ...input,
      completionVerified: false,
    }),
    attachAcceptedHandoffRun: async (candidate: AssignedDispatchReceipt) => {
      canonicalWrites += 1;
      return { ...candidate, runId: '33333333-3333-4333-8333-333333333333' };
    },
    formatVisualBriefsForConnectedAgent: () => '',
    applyTerminalProfileToTask: (value: string) => value,
    wakeAndAssignTask: async () => {
      wakeCalls += 1;
      return launchResult;
    },
    formatChatAgentProviderLabel: (provider: string) => provider,
    buildAgentRuntimeSubject: (agent: Record<string, unknown>) => ({
      metadata: {
        agentSubjectKey: agent.sessionKey || agent.id,
        agentDisplayName: agent.name,
        agentSessionKey: agent.sessionKey || null,
        legacyAgentIds: [],
      },
    }),
    supportsGenericCustomAgentDispatch: () => false,
    console: Object.freeze({ log() {}, warn() {}, error() {} }),
  };
  try {
    vm.runInNewContext(compiledAssignedDispatch, sandbox, { filename: chatPath });
  } catch (error) {
    failures.push(`Chat assigned-agent executable harness evaluates (${String(error)})`);
    return null;
  }
  const dispatch = moduleRecord.exports.dispatch;
  check(typeof dispatch === 'function', 'Chat assigned-agent executable harness exports its dispatcher');
  if (typeof dispatch !== 'function') return null;
  return {
    dispatch: dispatch as (
      agent: Record<string, unknown>,
      task: string,
      visualArtifacts?: readonly unknown[],
    ) => Promise<AssignedDispatchReceipt>,
    wakeCalls: () => wakeCalls,
    canonicalWrites: () => canonicalWrites,
  };
}

async function exerciseAssignedLaunchWithoutLineage(): Promise<void> {
  const harness = loadAssignedDispatchHarness({
    ok: true,
    transportAccepted: true,
    dispatchedVia: 'bridge',
    provider: 'codex',
    response: 'Bridge claimed acceptance without one exact launched session.',
  });
  if (!harness) return;

  const result = await harness.dispatch({
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Owned Codex Agent',
    provider: 'codex',
    ownerId: '22222222-2222-4222-8222-222222222222',
    isOwn: true,
    source: 'db',
    sessionKey: null,
  }, 'perform exactly once', []);
  check(harness.wakeCalls() === 1, 'selected-agent missing-lineage launch performs exactly one bridge attempt');
  check(result.status === 'unknown', 'selected-agent bridge success without sessionId becomes outcome unknown');
  check(result.runId == null, 'selected-agent missing-lineage outcome has no canonical run id');
  check(harness.canonicalWrites() === 0, 'selected-agent missing-lineage outcome creates no accepted canonical run');
}

function checkSourceWiring(): void {
  check(
    /export interface BridgeTaskResult[\s\S]{0,500}\bsessionId\??\s*:\s*string/.test(bridgeSource),
    'BridgeTaskResult exposes returned launch sessionId',
  );
  check(
    /export interface BridgeTaskResult[\s\S]{0,600}\bdisplayName\??\s*:\s*string/.test(bridgeSource),
    'BridgeTaskResult exposes returned launch displayName',
  );

  const assignedDispatch = sourceSection(
    chatSource,
    'const dispatchAssignedAgentTask = useCallback',
    'const spawnDedicatedOpenSwanSession = useCallback',
    'Chat assigned-agent dispatch',
  );
  const acceptedTerminalLaunch = sourceSection(
    assignedDispatch,
    "if (result.dispatchedVia === 'bridge') {",
    "return receipt(\n          'drafted'",
    'Chat accepted managed-terminal launch',
  );
  check(
    /receipt\([\s\S]{0,650}'accepted'[\s\S]{0,650}result\.sessionId/.test(acceptedTerminalLaunch),
    'Chat accepted managed-terminal launch writes the returned exact sessionId into its receipt',
  );
  const missingSessionGuard = acceptedTerminalLaunch.search(/if\s*\(\s*!result\.sessionId\s*\)/);
  const acceptedRunWrite = acceptedTerminalLaunch.search(/trackedReceipt\s*\(\s*receipt\s*\(\s*['"]accepted['"]/);
  check(
    missingSessionGuard >= 0 && acceptedRunWrite > missingSessionGuard,
    'Chat classifies a successful managed bridge result without sessionId before any accepted-run write',
  );
  check(
    /agent\.source\s*===\s*'db'[\s\S]{0,320}agentSubjectMetadata/.test(acceptedTerminalLaunch)
      && /trackedReceipt\([\s\S]{0,900}(?:agent\.source\s*===\s*'db'|[A-Za-z_$][\w$]*Subject)/.test(acceptedTerminalLaunch),
    'Chat keeps a selected DB terminal agent as the canonical run subject while the receipt carries the launched session',
  );

  const terminalLaunch = sourceSection(
    terminalSource,
    'const launchExplicitProvider = async',
    'const sessions = await listTerminalAgentControlSessions()',
    'terminal control launch-if-missing',
  );
  check(/sessionId:\s*launched\.sessionId/.test(terminalLaunch), 'terminal control returns the exact launched sessionId');
  check(/buildAgentRuntimeSubject\([\s\S]{0,500}launched\.sessionId/.test(terminalLaunch), 'terminal control builds its subject from exact launch lineage');
  check(/agentSubjectMetadata:\s*[A-Za-z_$][\w$]*\.metadata/.test(terminalLaunch), 'terminal control returns exact launched subject metadata');

  const terminalRoute = sourceSection(
    chatSource,
    '// ─── Terminal agent control',
    '// ─── Terminal agent launcher',
    'Chat terminal control route',
  );
  check(/sessionId:\s*terminalAgentControl\.sessionId/.test(terminalRoute), 'Chat handoff receipt adopts terminal control session lineage');
  check(
    /attachAcceptedHandoffRun\([\s\S]{0,260}terminalAgentControl\.agentSubjectMetadata/.test(terminalRoute),
    'Chat canonical accepted-run writer receives exact terminal subject metadata',
  );
}

async function main(): Promise<void> {
  await exerciseLaunchAdapters();
  await exerciseTerminalControlLineage();
  await exerciseAssignedLaunchWithoutLineage();
  checkSourceWiring();

  if (failures.length > 0) {
    console.error(`terminal launch lineage smoke: ${failures.length} failed, ${passed} passed`);
    failures.forEach((failure, index) => console.error(`  ${index + 1}. ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`terminal launch lineage smoke: all ${passed} assertions passed`);
}

void main().catch((error) => {
  if (error instanceof assert.AssertionError) {
    console.error('terminal launch lineage smoke assertion failed:', error.message);
  } else {
    console.error('terminal launch lineage smoke crashed:', error);
  }
  process.exitCode = 1;
});
