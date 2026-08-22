/**
 * Red-first behavior smoke for exact `/terminal/send` identity at each local
 * provider bridge. The real resolver/send functions are evaluated in isolated
 * VMs with terminal input and session writes replaced by counters.
 *
 * No bridge server, terminal, provider, or database is contacted.
 *
 * Run: npx tsx scripts/terminal-bridge-exact-session-server-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

type SendResult = {
  ok?: boolean;
  sessionId?: string;
  error?: string;
};

type AdapterConfig = {
  label: string;
  relativePath: string;
  functionStart: string;
  functionEnd: string;
  sendFunction: string;
  handlerCall: string;
  exactRecordCanAuthorizeInput: boolean;
  sessionExtras: Record<string, unknown>;
};

type LoadedAdapter = {
  send(data: Record<string, unknown>): Promise<SendResult>;
  setSessions(sessions: Array<Record<string, unknown>>): void;
  resetCounters(): void;
  counters(): { input: number; write: number };
};

const adapters: AdapterConfig[] = [
  {
    label: 'Claude Code',
    relativePath: 'scripts/claude-bridge.js',
    functionStart: 'function findLaunchedClaudeSession(',
    functionEnd: '// ── Periodic scan',
    sendFunction: 'sendToLaunchedClaudeSession',
    handlerCall: 'sendToLaunchedClaudeSession(data)',
    exactRecordCanAuthorizeInput: true,
    sessionExtras: { terminalTitle: 'UC Claude exact terminal', slug: 'Claude Exact' },
  },
  {
    label: 'Codex',
    relativePath: 'scripts/codex-bridge.js',
    functionStart: 'function findManagedSession(',
    functionEnd: '// ── Scan for Codex processes',
    sendFunction: 'sendToManagedCodexSession',
    handlerCall: 'sendToManagedCodexSession(data)',
    exactRecordCanAuthorizeInput: true,
    sessionExtras: { terminalTitle: 'UC Codex exact terminal' },
  },
  {
    label: 'Gemini CLI',
    relativePath: 'scripts/gemini-bridge.js',
    functionStart: 'function findLaunchedGeminiSession(',
    functionEnd: '// ── Periodic scan',
    sendFunction: 'sendToLaunchedGeminiSession',
    handlerCall: 'sendToLaunchedGeminiSession(data)',
    exactRecordCanAuthorizeInput: true,
    sessionExtras: { terminalTitle: 'UC Gemini exact terminal' },
  },
  {
    label: 'Cursor Composer',
    relativePath: 'scripts/cursor-bridge.js',
    functionStart: 'function findManagedCursorSession(',
    functionEnd: '// ── Periodic scan',
    sendFunction: 'sendToManagedCursorSession',
    handlerCall: 'sendToManagedCursorSession(data)',
    exactRecordCanAuthorizeInput: false,
    sessionExtras: { projectDir: '/tmp/uc-exact-session-smoke' },
  },
];

let assertions = 0;
const failures: string[] = [];

function check(condition: unknown, label: string): void {
  assertions += 1;
  if (!condition) failures.push(label);
}

function section(source: string, startMarker: string, endMarker: string, label: string): string {
  const start = source.indexOf(startMarker);
  check(start >= 0, `${label}: resolver/send section starts`);
  if (start < 0) return '';
  const end = source.indexOf(endMarker, start + startMarker.length);
  check(end > start, `${label}: resolver/send section ends`);
  return end > start ? source.slice(start, end) : '';
}

function loadAdapter(config: AdapterConfig): LoadedAdapter | null {
  const path = resolve(process.cwd(), config.relativePath);
  const source = readFileSync(path, 'utf8');
  check(source.includes("'/terminal/send'") || source.includes('`/terminal/send`'), `${config.label}: server exposes /terminal/send`);
  check(source.includes(config.handlerCall), `${config.label}: /terminal/send uses the tested send function`);

  const implementation = section(source, config.functionStart, config.functionEnd, config.label);
  if (!implementation) return null;

  const state = {
    sessions: [] as Array<Record<string, unknown>>,
    input: 0,
    write: 0,
  };
  const moduleRecord: { exports: Record<string, unknown> } = { exports: {} };
  const recordWrite = (session: Record<string, unknown>) => {
    state.write += 1;
    return session;
  };
  const recordInput = async () => {
    state.input += 1;
    return { ok: true };
  };
  const sandbox: Record<string, unknown> = {
    module: moduleRecord,
    exports: moduleRecord.exports,
    cachedSessions: state.sessions,
    normalizeCliPrompt: (value: unknown) => String(value || '').trim(),
    promptPreview: (value: unknown, limit: number) => String(value || '').slice(0, limit),
    sendToTerminalByTitle: recordInput,
    sendPromptToCursorComposer: recordInput,
    registerLaunchedClaudeSession: recordWrite,
    registerSession: recordWrite,
    registerLaunchedGeminiSession: recordWrite,
    registerManagedCursorSession: recordWrite,
    doScan: () => {},
    scan: async () => {},
  };

  try {
    vm.runInNewContext(
      `${implementation}\nmodule.exports.send = ${config.sendFunction};`,
      sandbox,
      { filename: path },
    );
  } catch (error) {
    failures.push(`${config.label}: extracted implementation evaluates (${String(error)})`);
    return null;
  }

  const send = moduleRecord.exports.send;
  check(typeof send === 'function', `${config.label}: tested send function is callable`);
  if (typeof send !== 'function') return null;

  return {
    send: send as LoadedAdapter['send'],
    setSessions(sessions) {
      state.sessions = sessions;
      sandbox.cachedSessions = sessions;
    },
    resetCounters() {
      state.input = 0;
      state.write = 0;
    },
    counters() {
      return { input: state.input, write: state.write };
    },
  };
}

const EXACT_ID = 'Managed-Session-01';
const DISPLAY_NAME = 'Exact Display Name';

function session(
  config: AdapterConfig,
  sessionId: string = EXACT_ID,
  displayName: string = DISPLAY_NAME,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    sessionId,
    displayName,
    status: 'idle',
    recentActions: [],
    messageCount: 0,
    ...config.sessionExtras,
    ...extras,
  };
}

async function expectRejectedWithoutMutation(
  adapter: LoadedAdapter,
  config: AdapterConfig,
  label: string,
  payload: Record<string, unknown>,
): Promise<void> {
  adapter.resetCounters();
  const result = await adapter.send({ ...payload, message: 'must target exactly once' });
  const counters = adapter.counters();
  check(result?.ok === false, `${config.label}: ${label} is rejected`);
  check(counters.input === 0, `${config.label}: ${label} performs zero terminal input`);
  check(counters.write === 0, `${config.label}: ${label} performs zero session writes`);
}

async function main(): Promise<void> {
  for (const config of adapters) {
    const adapter = loadAdapter(config);
    if (!adapter) continue;

    adapter.setSessions([session(config)]);
    await expectRejectedWithoutMutation(adapter, config, 'missing sessionId', {});
    await expectRejectedWithoutMutation(adapter, config, 'displayName-only target', { displayName: DISPLAY_NAME });
    await expectRejectedWithoutMutation(adapter, config, 'target-only alias', { target: DISPLAY_NAME });
    await expectRejectedWithoutMutation(adapter, config, 'sessionId prefix', { sessionId: 'Managed-Session' });
    await expectRejectedWithoutMutation(adapter, config, 'case-insensitive sessionId', { sessionId: EXACT_ID.toLowerCase() });

    adapter.setSessions([
      session(config, EXACT_ID, 'Duplicate A'),
      session(config, EXACT_ID, 'Duplicate B'),
    ]);
    await expectRejectedWithoutMutation(adapter, config, 'duplicate exact sessionId', { sessionId: EXACT_ID });

    if (config.exactRecordCanAuthorizeInput) {
      adapter.setSessions([session(config)]);
      adapter.resetCounters();
      const exact = await adapter.send({ sessionId: EXACT_ID, message: 'exact task' });
      const exactCounters = adapter.counters();
      check(exact?.ok === true, `${config.label}: one exact case-sensitive sessionId succeeds`);
      check(exact?.sessionId === EXACT_ID, `${config.label}: success echoes the exact requested sessionId`);
      check(exactCounters.input === 1, `${config.label}: exact session performs one terminal input`);
      check(exactCounters.write === 1, `${config.label}: exact session performs one session write`);
    } else {
      // Cursor's current sender focuses whichever Composer is frontmost. An
      // exact cached record therefore cannot prove the GUI target, especially
      // when another Composer window/conversation is frontmost.
      adapter.setSessions([
        session(config, EXACT_ID, DISPLAY_NAME, {
          projectDir: '/tmp/uc-cursor-requested',
          frontmost: false,
        }),
        session(config, 'Cursor-Frontmost-02', 'Frontmost Other Composer', {
          projectDir: '/tmp/uc-cursor-frontmost',
          frontmost: true,
        }),
      ]);
      adapter.resetCounters();
      const exactRecord = await adapter.send({ sessionId: EXACT_ID, message: 'do not type into the frontmost mismatch' });
      const exactRecordCounters = adapter.counters();
      check(exactRecord?.ok === false, `${config.label}: exact cached record is rejected without verifiable GUI binding`);
      check(
        !(exactRecord?.ok === true && exactRecord?.sessionId === EXACT_ID),
        `${config.label}: exact cached record never echoes success`,
      );
      check(exactRecordCounters.input === 0, `${config.label}: frontmost mismatch performs zero GUI input`);
      check(exactRecordCounters.write === 0, `${config.label}: frontmost mismatch performs zero session writes`);
    }
  }

  if (failures.length > 0) {
    console.error(`terminal bridge exact-session server smoke: ${failures.length}/${assertions} assertions failed`);
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }
  console.log(`terminal bridge exact-session server smoke: ${assertions} assertions passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
