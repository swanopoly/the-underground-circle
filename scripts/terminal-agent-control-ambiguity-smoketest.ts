/**
 * Focused managed-terminal target ambiguity smoke.
 *
 * The current TypeScript module is transpiled into an isolated VM with bridge
 * dependencies stubbed. No local bridge, terminal, provider, or database is
 * contacted.
 *
 * Run: npx tsx scripts/terminal-agent-control-ambiguity-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

const sourcePath = resolve(process.cwd(), 'src/lib/terminalAgentControl.ts');
const source = readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

let assertions = 0;
let sends = 0;
let launches = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert.ok(condition, message);
}

const sessionsByPort: Record<number, unknown[]> = {
  7778: [{
    sessionId: 'claude-exact-01',
    displayName: 'Review Alpha',
    status: 'active',
    manageable: true,
  }],
  7779: [
    {
      sessionId: 'codex-exact-01',
      displayName: 'Build Alpha',
      status: 'active',
      manageable: true,
    },
    {
      sessionId: 'codex-exact-02',
      displayName: 'Build Beta',
      status: 'active',
      manageable: true,
    },
  ],
  7780: [],
  7781: [],
};

const moduleRecord: { exports: Record<string, any> } = { exports: {} };
const sandbox = {
  module: moduleRecord,
  exports: moduleRecord.exports,
  AbortController,
  clearTimeout,
  console,
  Map,
  Promise,
  require(specifier: string): unknown {
    if (specifier === './bridgeAuth') {
      return {
        fetchBridgeAuthenticated: async (url: string) => {
          const port = Number(new URL(url).port);
          return {
            ok: true,
            json: async () => ({ sessions: sessionsByPort[port] || [] }),
          };
        },
      };
    }
    if (specifier === './bridgeEnvironment') {
      return { getBridgeUrl: (port: number) => `http://127.0.0.1:${port}` };
    }
    if (specifier === './bridgeTaskDispatcher') {
      return {
        sendTerminalAgentSessionMessage: async (_provider: string, sessionId: string) => {
          sends += 1;
          return { ok: true, transportAccepted: true, sessionId };
        },
        wakeAndAssignTask: async () => {
          launches += 1;
          return { ok: true, transportAccepted: true };
        },
      };
    }
    if (specifier === './agentIdentity') {
      return { loadAgentIdentities: async () => new Map() };
    }
    if (specifier === './agentRuntimeSubject') {
      return {
        buildAgentRuntimeSubject: (input: Record<string, unknown>) => ({
          metadata: { id: input.id, providerType: input.providerType },
        }),
      };
    }
    if (specifier === './chatVisualBriefCore') {
      return { formatVisualBriefsForConnectedAgent: () => '' };
    }
    throw new Error(`Unexpected import in ambiguity smoke: ${specifier}`);
  },
  setTimeout,
  URL,
};

vm.runInNewContext(compiled, sandbox, { filename: sourcePath });

const {
  executeTerminalAgentControlFromChat,
  findTerminalAgentSessionTarget,
  resolveTerminalAgentSessionTarget,
} = moduleRecord.exports;

check(typeof resolveTerminalAgentSessionTarget === 'function', 'pure ambiguity-aware resolver is exported');
check(typeof executeTerminalAgentControlFromChat === 'function', 'chat control executor is exported');

const pureSessions = [
  {
    provider: 'codex',
    providerLabel: 'Codex',
    sessionId: 'codex-exact-01',
    displayName: 'Build Alpha',
    status: 'active',
    manageable: true,
    recentActions: [],
  },
  {
    provider: 'codex',
    providerLabel: 'Codex',
    sessionId: 'codex-exact-02',
    displayName: 'Build Beta',
    status: 'active',
    manageable: true,
    recentActions: [],
  },
];

const ambiguous = resolveTerminalAgentSessionTarget(pureSessions, 'Codex');
check(ambiguous.status === 'ambiguous', 'equal-best natural provider aliases are ambiguous');
check(ambiguous.candidates?.length === 2, 'ambiguity retains both equal-best candidates');
check(findTerminalAgentSessionTarget(pureSessions, 'Codex') === null, 'compatibility finder never chooses the first tie');

const exact = resolveTerminalAgentSessionTarget(pureSessions, 'codex-exact-02');
check(exact.status === 'matched', 'exact session id still resolves');
check(exact.matchKind === 'session_id', 'exact session id is distinguished from natural matching');
check(exact.session?.sessionId === 'codex-exact-02', 'exact session id selects the requested session');

async function main(): Promise<void> {
  const ambiguousResult = await executeTerminalAgentControlFromChat(
    '/agent Codex: do not choose for me',
    { launchIfMissing: true, circleId: 'circle-1' },
  );
  check(ambiguousResult?.kind === 'handoff', 'ambiguous send remains a typed handoff result');
  check(ambiguousResult?.ok === false, 'ambiguous send fails closed');
  check(ambiguousResult?.targetStatus === 'ambiguous', 'ambiguous send exposes an explicit target status');
  check(ambiguousResult?.transportAccepted === false, 'ambiguity is proven predispatch');
  check(/nothing was dispatched/i.test(ambiguousResult?.message || ''), 'ambiguity copy states that nothing was dispatched');
  check(/codex-exact-01/.test(ambiguousResult?.message || '') && /codex-exact-02/.test(ambiguousResult?.message || ''), 'ambiguity copy offers exact session ids');
  check(sends === 0, 'ambiguous natural target makes zero session sends');
  check(launches === 0, 'ambiguous natural target never launches a replacement session');

  const exactResult = await executeTerminalAgentControlFromChat('/agent codex-exact-02: continue exactly');
  check(exactResult?.ok === true, 'exact session-id target dispatches');
  check(exactResult?.sessionId === 'codex-exact-02', 'exact dispatch preserves the requested session id');
  check(sends === 1, 'exact session-id target sends exactly once');
  check(launches === 0, 'exact session-id target does not launch');

  const uniqueNameResult = await executeTerminalAgentControlFromChat('/agent "Review Alpha" continue review');
  check(uniqueNameResult?.ok === true, 'unique natural display name still dispatches');
  check(uniqueNameResult?.sessionId === 'claude-exact-01', 'unique natural name selects its one best session');
  check(sends === 2, 'unique natural name adds exactly one send');

  const sendsBeforeStatus = sends;
  const launchesBeforeStatus = launches;
  const statusResult = await executeTerminalAgentControlFromChat('show terminal agent status');
  check(statusResult?.kind === 'status_query', 'status-query discriminant is preserved');
  check(statusResult?.ok === true, 'status query remains successful');
  check(sends === sendsBeforeStatus && launches === launchesBeforeStatus, 'status query performs no send or launch');

  console.log(`terminal-agent-control ambiguity smoke: ${assertions} assertions passed`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
