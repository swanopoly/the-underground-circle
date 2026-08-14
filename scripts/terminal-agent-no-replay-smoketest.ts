/**
 * Adversarial smoke for terminal-agent transport acknowledgement and replay.
 *
 * React Native prevents these adapters from being imported directly by Node,
 * so the smoke transpiles their current source into isolated VM modules and
 * replaces only their imported I/O dependencies. The resulting POST counts
 * exercise the real dispatcher functions while source-section assertions pin
 * Chat's orchestration wiring.
 *
 * Run:
 *   npx tsx scripts/terminal-agent-no-replay-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { resolve } from 'node:path';
import ts from 'typescript';

const root = process.cwd();
const bridgePath = resolve(root, 'src/lib/bridgeTaskDispatcher.ts');
const connectedPath = resolve(root, 'src/lib/connectedAgentDispatch.ts');
const chatPath = resolve(root, 'src/screens/circles/tabs/ChatTab.tsx');
const claudeLaunchPath = resolve(root, 'src/lib/claudeCodeDetector.ts');
const codexLaunchPath = resolve(root, 'src/lib/codexDetector.ts');
const geminiLaunchPath = resolve(root, 'src/lib/geminiCliDetector.ts');
const cursorLaunchPath = resolve(root, 'src/lib/cursorDetector.ts');

const bridgeSource = readFileSync(bridgePath, 'utf8');
const connectedSource = readFileSync(connectedPath, 'utf8');
const chatSource = readFileSync(chatPath, 'utf8');
const claudeLaunchSource = readFileSync(claudeLaunchPath, 'utf8');
const codexLaunchSource = readFileSync(codexLaunchPath, 'utf8');
const geminiLaunchSource = readFileSync(geminiLaunchPath, 'utf8');
const cursorLaunchSource = readFileSync(cursorLaunchPath, 'utf8');

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
  console.log(`pass: ${message}`);
}

function matches(source: string, pattern: RegExp, message: string): void {
  assertions += 1;
  assert.match(source, pattern, message);
  console.log(`pass: ${message}`);
}

function section(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  check(start >= 0, `${label} start marker is present`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(end > start, `${label} end marker follows its start`);
  return source.slice(start, end);
}

const triStateType = /transportAccepted\s*:\s*(?:(?:true\s*\|\s*false)|boolean)\s*\|\s*null\s*;/;

const bridgeResultContract = section(
  bridgeSource,
  'export interface BridgeTaskResult {',
  'export interface TerminalSessionSendResult',
  'bridge result contract',
);
const bridgeSessionSend = section(
  bridgeSource,
  'export async function sendTerminalAgentSessionMessage(',
  '/**\n * Dispatch to Cursor Composer',
  'terminal exact-session send adapter',
);
const wakeAndAssign = section(
  bridgeSource,
  'export async function wakeAndAssignTask(',
  '\n}',
  'wake-and-assign dispatcher',
);
const connectedResultContract = section(
  connectedSource,
  'export interface ConnectedAgentDispatchResult {',
  'type CommonLaunchInput',
  'connected-agent result contract',
);
const connectedDispatch = section(
  connectedSource,
  'export async function dispatchConnectedAgentTask(',
  '\n}\n',
  'generic connected-agent dispatcher',
);
const providerLaunches = [
  {
    label: 'Claude Code',
    source: claudeLaunchSource,
    resultStart: 'export interface ClaudeCodeLaunchResult {',
    functionStart: 'export async function launchClaudeCodeSessions(',
    functionEnd: '/**\n * Mark the Claude Code agent as idle',
  },
  {
    label: 'Codex',
    source: codexLaunchSource,
    resultStart: 'export interface CodexLaunchResult {',
    functionStart: 'export async function launchCodexSessions(',
    functionEnd: '// ── Session Memory Persistence',
  },
  {
    label: 'Gemini CLI',
    source: geminiLaunchSource,
    resultStart: 'export interface GeminiCliLaunchResult {',
    functionStart: 'export async function launchGeminiCliSessions(',
    functionEnd: '// ── Session Memory Persistence',
  },
  {
    label: 'Cursor',
    source: cursorLaunchSource,
    resultStart: 'export interface CursorComposerLaunchResult {',
    functionStart: 'export async function launchCursorComposerSessions(',
    functionEnd: '// ── Session Memory Persistence',
  },
].map((entry) => ({
  ...entry,
  contract: section(entry.source, entry.resultStart, entry.functionStart, `${entry.label} launch result contract`),
  implementation: section(entry.source, entry.functionStart, entry.functionEnd, `${entry.label} launch implementation`),
}));
const assignedBridgeRoute = section(
  chatSource,
  "const bridgeProviders = ['claude-code'",
  'if (supportsGenericCustomAgentDispatch(normalizedProvider))',
  'Chat selected/assigned terminal bridge route',
);
const exactBridgeSessionStart = assignedBridgeRoute.indexOf(
  "if (agent.sessionKey && agent.source === 'bridge-session')",
);
const distinctLaunchStart = assignedBridgeRoute.indexOf('const dbId = agent.id?.startsWith');
check(exactBridgeSessionStart >= 0, 'Chat exact terminal-session branch is present');
check(
  distinctLaunchStart > exactBridgeSessionStart,
  'Chat distinct launch branch follows the exact-session attempt',
);
const exactBridgeSessionRoute = assignedBridgeRoute.slice(exactBridgeSessionStart, distinctLaunchStart);

// A transport acknowledgement is deliberately tri-state. `ok` remains a
// compatibility field, but it cannot distinguish a pre-dispatch rejection from
// an ambiguous response after a mutation crossed the POST boundary.
matches(
  bridgeResultContract,
  triStateType,
  'BridgeTaskResult requires explicit true/false/null transport acceptance',
);
matches(
  connectedResultContract,
  triStateType,
  'ConnectedAgentDispatchResult preserves the same tri-state acceptance',
);
matches(
  bridgeSessionSend,
  /transportAccepted\s*:\s*true/,
  'an explicit exact-session acknowledgement is marked accepted',
);
matches(
  bridgeSessionSend,
  /transportAccepted\s*:\s*false/,
  'unsupported, offline, or proven pre-dispatch session failure can be rejected',
);
matches(
  bridgeSessionSend,
  /transportAccepted\s*:\s*null/,
  'post-boundary session ambiguity has an explicit unknown state',
);
for (const providerLaunch of providerLaunches) {
  matches(
    providerLaunch.contract,
    triStateType,
    `${providerLaunch.label} launch result requires explicit true/false/null transport acceptance`,
  );
  matches(
    providerLaunch.implementation,
    /transportAccepted\s*:\s*false/,
    `${providerLaunch.label} launch can prove a pre-dispatch rejection`,
  );
  check(
    !/transportAccepted\s*:\s*data\??\.ok\s*===\s*false\s*\?\s*false\s*:\s*true/.test(providerLaunch.implementation)
      && /data\??\.ok\s*===\s*true|(?:data\??\.)?launched[^\n]*>\s*0|transportAccepted\s*:\s*true/.test(providerLaunch.implementation),
    `${providerLaunch.label} launch marks true only from explicit positive acceptance evidence`,
  );
  matches(
    providerLaunch.implementation,
    /transportAccepted\s*:\s*null/,
    `${providerLaunch.label} launch preserves post-POST ambiguity`,
  );
}

// The exact selected session is attempted once. Ambiguity returns a durable
// unknown receipt from this branch, so execution cannot reach wake/spawn/draft.
matches(
  exactBridgeSessionRoute,
  /const sendResult = await sendTerminalAgentSessionMessage\([\s\S]*?if \(sendResult\.ok\)/,
  'Chat makes one exact-session send attempt before classifying the result',
);
matches(
  exactBridgeSessionRoute,
  /sendResult\.transportAccepted\s*!==\s*false[\s\S]*?return receipt\(\s*'unknown'/,
  'Chat returns an unknown receipt for an ambiguous exact-session send',
);
check(
  !/wakeAndAssignTask\(|spawnNew|dispatchBridgeTask\(|getAIResponse\(/.test(exactBridgeSessionRoute),
  'Chat exact-session ambiguity branch contains no wake, spawn, dispatch, or draft fallback',
);
matches(
  exactBridgeSessionRoute,
  /sendResult\.transportAccepted\s*!==\s*false[\s\S]*?return receipt\(\s*'unknown'[\s\S]*?throw new Error\(/,
  'Chat stops on both unknown and rejected exact-session sends unless launch is separately requested',
);

// The shared SwanBot/OpenSwan connected dispatcher must obey the same stop
// boundary both when reusing a session and while choosing a launch provider.
const connectedExactSend = section(
  connectedDispatch,
  'const sent = await sendTerminalAgentSessionMessage(',
  'if (opts.launchIfMissing === false)',
  'generic connected exact-session send branch',
);
const connectedLaunch = section(
  connectedDispatch,
  '// 2. Launch the first provider whose bridge is online',
  'const offline = order.filter(',
  'generic connected launch branch',
);
matches(
  connectedExactSend,
  /transportAccepted\s*:\s*sent\.transportAccepted/,
  'generic connected dispatch preserves exact-session acceptance state on failure',
);
check(
  !/launchForProvider\(|wakeAndAssignTask\(|dispatchBridgeTask\(/.test(connectedExactSend),
  'generic connected exact-session failure cannot launch, wake, or fall through',
);
check(
  /const provider = launchable\[0\]/.test(connectedLaunch) && !/for\s*\(/.test(connectedLaunch),
  'generic connected launch attempts at most the first explicitly selected online provider',
);
matches(
  connectedLaunch,
  /transportAccepted\s*:\s*launched\?\.transportAccepted\s*\?\?\s*null/,
  'generic connected launch preserves explicit rejection and unknown acceptance without replay',
);
const wakeOnlineLaunch = section(
  wakeAndAssign,
  'if (bridgeOnline) {',
  '// Bridge offline',
  'wake-and-assign online launch branch',
);
matches(
  wakeOnlineLaunch,
  /transportAccepted\s*:\s*spawnResult\.transportAccepted\s*\?\?\s*null/,
  'wake-and-assign preserves failed launch acceptance state',
);
check(
  !/dispatchBridgeTask\(/.test(wakeOnlineLaunch),
  'wake-and-assign never replays an online launch through fallback dispatch',
);

type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<Response>;
type BridgeModule = {
  sendTerminalAgentSessionMessage: (
    provider: string,
    sessionId: string,
    message: string,
  ) => Promise<Record<string, unknown>>;
  spawnNewCodexSession: (
    task: string,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  spawnNewSession: (
    provider: string,
    task: string,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
  wakeAndAssignTask: (
    provider: string,
    agentName: string,
    task: string,
    circleId: string,
    agentDbId?: string,
    options?: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>;
};

type ConnectedModule = {
  dispatchConnectedAgentTask: (options: Record<string, unknown>) => Promise<Record<string, unknown>>;
};

const commonJsOptions: ts.TranspileOptions = {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
};
const compiledBridgeSource = ts.transpileModule(bridgeSource, commonJsOptions).outputText;
const compiledConnectedSource = ts.transpileModule(connectedSource, commonJsOptions).outputText;

function loadBridgeModule(fetchImpl: FetchLike): BridgeModule {
  const module = { exports: {} as Record<string, unknown> };
  const quietConsole = Object.freeze({ log() {}, warn() {}, error() {} });
  const sandbox: Record<string, unknown> = {
    module,
    exports: module.exports,
    require: (specifier: string) => {
      if (specifier === './bridgeAuth') {
        return { fetchBridgeAuthenticated: (url: string, init?: Record<string, unknown>) => fetchImpl(url, init) };
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
    fetch: (url: string, init?: Record<string, unknown>) => fetchImpl(url, init),
    AbortController,
    Response,
    process: { env: Object.create(null) },
    // Mutation-loss scenarios should not leave real 15s/120s timers alive.
    setTimeout: () => 1,
    clearTimeout: () => {},
    console: quietConsole,
  };
  vm.runInNewContext(compiledBridgeSource, sandbox, { filename: bridgePath });
  return module.exports as unknown as BridgeModule;
}

function loadConnectedModule(stubs: {
  sessions?: Array<Record<string, unknown>>;
  online?: Record<string, boolean>;
  send: () => Promise<Record<string, unknown>>;
  launch: (provider: string) => Promise<Record<string, unknown>>;
}): ConnectedModule {
  const module = { exports: {} as Record<string, unknown> };
  const launch = (provider: string) => async () => stubs.launch(provider);
  const sandbox: Record<string, unknown> = {
    module,
    exports: module.exports,
    require: (specifier: string) => {
      if (specifier === './bridgeTaskDispatcher') {
        return {
          checkAllBridges: async () => stubs.online || {},
          sendTerminalAgentSessionMessage: async () => stubs.send(),
        };
      }
      if (specifier === './terminalAgentControl') {
        return { listTerminalAgentControlSessions: async () => stubs.sessions || [] };
      }
      if (specifier === './claudeCodeDetector') return { launchClaudeCodeSessions: launch('claude-code') };
      if (specifier === './codexDetector') return { launchCodexSessions: launch('codex') };
      if (specifier === './geminiCliDetector') return { launchGeminiCliSessions: launch('gemini') };
      if (specifier === './cursorDetector') return { launchCursorComposerSessions: launch('cursor') };
      if (specifier === './chatVisualBriefCore') return { formatVisualBriefsForConnectedAgent: () => '' };
      if (specifier === './connectedAgentHandoffCore') return {};
      throw new Error(`Unexpected connected-dispatch dependency: ${specifier}`);
    },
    console: Object.freeze({ log() {}, warn() {}, error() {} }),
  };
  vm.runInNewContext(compiledConnectedSource, sandbox, { filename: connectedPath });
  return module.exports as unknown as ConnectedModule;
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type BridgeFetchScenario = {
  fetch: FetchLike;
  calls: Array<{ url: string; method: string }>;
  postCount: () => number;
};

function bridgeFetchScenario(options: {
  healthStatus?: number;
  post: (callIndex: number) => Promise<Response>;
}): BridgeFetchScenario {
  const calls: Array<{ url: string; method: string }> = [];
  let postCount = 0;
  return {
    calls,
    postCount: () => postCount,
    fetch: async (url, init) => {
      const method = String(init?.method || 'GET').toUpperCase();
      calls.push({ url, method });
      if (method !== 'POST') return response(options.healthStatus ?? 200, { ok: true });
      postCount += 1;
      return options.post(postCount);
    },
  };
}

async function assertSendClassification(
  label: string,
  expected: true | false | null,
  options: Parameters<typeof bridgeFetchScenario>[0],
): Promise<void> {
  const scenario = bridgeFetchScenario(options);
  const bridge = loadBridgeModule(scenario.fetch);
  const result = await bridge.sendTerminalAgentSessionMessage('codex', 'codex-session-1', 'do this once');
  check(result.transportAccepted === expected, `${label} classifies transportAccepted=${String(expected)}`);
  check(scenario.postCount() <= 1, `${label} performs at most one task-bearing POST`);
}

async function assertLaunchClassification(
  label: string,
  expected: true | false | null,
  options: Parameters<typeof bridgeFetchScenario>[0],
): Promise<void> {
  const scenario = bridgeFetchScenario(options);
  const bridge = loadBridgeModule(scenario.fetch);
  const result = await bridge.spawnNewCodexSession('do this once');
  check(result.transportAccepted === expected, `${label} classifies launch transportAccepted=${String(expected)}`);
  check(scenario.postCount() <= 1, `${label} performs at most one launch POST`);
}

async function runBridgeRuntimeMatrix(): Promise<void> {
  const unsupportedScenario = bridgeFetchScenario({ post: async () => response(200, { ok: true }) });
  const unsupportedBridge = loadBridgeModule(unsupportedScenario.fetch);
  const unsupportedSend = await unsupportedBridge.sendTerminalAgentSessionMessage('unsupported', 'session-1', 'task');
  check(unsupportedSend.transportAccepted === false, 'unsupported session provider is proven pre-dispatch false');
  check(unsupportedScenario.calls.length === 0, 'unsupported session provider performs no network call');
  const unsupportedLaunch = await unsupportedBridge.spawnNewSession('unsupported', 'task');
  check(unsupportedLaunch.transportAccepted === false, 'unsupported launch provider is proven pre-dispatch false');
  check(unsupportedScenario.calls.length === 0, 'unsupported launch provider performs no network call');

  await assertSendClassification('offline exact-session send', false, {
    healthStatus: 503,
    post: async () => response(200, { ok: true }),
  });
  await assertSendClassification('explicit exact-session acceptance', true, {
    post: async () => response(200, { ok: true, sessionId: 'codex-session-1' }),
  });
  await assertSendClassification('structured pre-dispatch session rejection', false, {
    post: async () => response(400, { ok: false, transportAccepted: false, error: 'invalid session' }),
  });
  await assertSendClassification('session HTTP 500 after POST', null, {
    post: async () => response(500, { ok: false, error: 'server failed after receipt' }),
  });
  await assertSendClassification('session response loss after POST', null, {
    post: async () => { throw new Error('socket closed after request body'); },
  });
  await assertSendClassification('session timeout after POST', null, {
    post: async () => { throw Object.assign(new Error('timed out'), { name: 'AbortError' }); },
  });
  await assertSendClassification('malformed session success response', null, {
    post: async () => response(200, {}),
  });

  await assertLaunchClassification('offline bridge launch', false, {
    healthStatus: 503,
    post: async () => response(200, { ok: true, launched: 1 }),
  });
  await assertLaunchClassification('explicit bridge launch acceptance', true, {
    post: async () => response(200, {
      ok: true,
      launched: 1,
      launchId: 'launch-1',
      sessions: [{ sessionId: 'codex-launched-1' }],
    }),
  });
  await assertLaunchClassification('structured pre-dispatch launch rejection', false, {
    post: async () => response(400, { ok: false, transportAccepted: false, error: 'invalid launch' }),
  });
  await assertLaunchClassification('launch HTTP 500 after POST', null, {
    post: async () => response(500, { ok: false, error: 'launch server failed' }),
  });
  await assertLaunchClassification('launch response loss after POST', null, {
    post: async () => { throw new Error('launch response lost'); },
  });
  await assertLaunchClassification('malformed launch success response', null, {
    post: async () => response(200, { ok: true, launched: 0, sessions: [] }),
  });

  const wakeScenario = bridgeFetchScenario({
    post: async () => { throw new Error('launch acknowledgement lost'); },
  });
  const wakeBridge = loadBridgeModule(wakeScenario.fetch);
  const wakeResult = await wakeBridge.wakeAndAssignTask(
    'codex',
    'Codex',
    'perform exactly once',
    'circle-1',
  );
  check(wakeResult.transportAccepted === null, 'wake-and-assign preserves ambiguous launch acceptance');
  check(wakeScenario.postCount() === 1, 'wake-and-assign never replays an ambiguous launch through fallback dispatch');
}

function acceptedLaunch(sessionId: string): Record<string, unknown> {
  return {
    ok: true,
    transportAccepted: true,
    launched: 1,
    sessions: [{ sessionId }],
    failed: [],
  };
}

async function runConnectedDispatcherMatrix(): Promise<void> {
  const exactSession = [{
    manageable: true,
    provider: 'codex',
    providerLabel: 'Codex',
    sessionId: 'codex-exact-1',
    displayName: 'Codex exact',
  }];

  let sends = 0;
  let launches = 0;
  let connected = loadConnectedModule({
    sessions: exactSession,
    online: { codex: true, 'claude-code': true },
    send: async () => {
      sends += 1;
      return { ok: false, transportAccepted: null, provider: 'codex', sessionId: 'codex-exact-1' };
    },
    launch: async () => {
      launches += 1;
      return acceptedLaunch('should-not-launch');
    },
  });
  let result = await connected.dispatchConnectedAgentTask({
    prompt: 'perform once',
    sessionName: 'Exact',
    sessionId: 'codex-exact-1',
    providerOrder: ['codex', 'claude-code'],
  });
  check(sends === 1, 'generic dispatcher attempts the exact session once');
  check(launches === 0, 'generic dispatcher does not launch after ambiguous exact-session send');
  check(result.transportAccepted === null, 'generic dispatcher returns unknown for ambiguous exact-session send');

  sends = 0;
  launches = 0;
  connected = loadConnectedModule({
    sessions: exactSession,
    online: { codex: true },
    send: async () => {
      sends += 1;
      return { ok: false, transportAccepted: false, provider: 'codex', sessionId: 'codex-exact-1' };
    },
    launch: async () => {
      launches += 1;
      return acceptedLaunch('codex-new-1');
    },
  });
  result = await connected.dispatchConnectedAgentTask({
    prompt: 'perform once',
    sessionName: 'Replacement',
    sessionId: 'codex-exact-1',
    providerOrder: ['codex'],
  });
  check(sends === 1 && launches === 0, 'generic dispatcher does not replace an explicitly selected rejected session');
  check(result.transportAccepted === false, 'generic dispatcher preserves proven exact-session rejection');

  launches = 0;
  connected = loadConnectedModule({
    sessions: [],
    online: { codex: true, 'claude-code': true },
    send: async () => ({ ok: false, transportAccepted: false }),
    launch: async (provider) => {
      launches += 1;
      return provider === 'codex'
        ? { ok: false, transportAccepted: null, launched: 0, sessions: [], failed: [] }
        : acceptedLaunch('claude-should-not-launch');
    },
  });
  result = await connected.dispatchConnectedAgentTask({
    prompt: 'perform once',
    sessionName: 'New',
    providerOrder: ['codex', 'claude-code'],
  });
  check(launches === 1, 'generic dispatcher stops provider fan-out after ambiguous launch');
  check(result.transportAccepted === null, 'generic dispatcher exposes ambiguous launch as unknown');

  launches = 0;
  connected = loadConnectedModule({
    sessions: [],
    online: { codex: true, 'claude-code': true },
    send: async () => ({ ok: false, transportAccepted: false }),
    launch: async () => {
      launches += 1;
      return { ok: false, transportAccepted: false, launched: 0, sessions: [], failed: [{ error: 'rejected before launch' }] };
    },
  });
  result = await connected.dispatchConnectedAgentTask({
    prompt: 'perform once',
    sessionName: 'New',
    providerOrder: ['codex', 'claude-code'],
  });
  check(launches === 1, 'generic dispatcher never fans a rejected launch out to another provider implicitly');
  check(result.transportAccepted === false, 'generic dispatcher preserves proven launch rejection');

  launches = 0;
  connected = loadConnectedModule({
    sessions: [],
    online: { codex: true },
    send: async () => ({ ok: false, transportAccepted: false }),
    launch: async () => {
      launches += 1;
      return acceptedLaunch('codex-new-accepted');
    },
  });
  result = await connected.dispatchConnectedAgentTask({
    prompt: 'perform once',
    sessionName: 'New accepted',
    providerOrder: ['codex'],
  });
  check(launches === 1, 'generic dispatcher performs one explicitly intended launch');
  check(result.transportAccepted === true, 'generic dispatcher preserves explicit launch acceptance');
}

async function main(): Promise<void> {
  await runBridgeRuntimeMatrix();
  await runConnectedDispatcherMatrix();
  console.log(`\nAll ${assertions} terminal-agent no-replay assertions passed.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
