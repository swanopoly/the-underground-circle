/**
 * openswan-typed-runtime-invariants-smoketest — guards three invariants of the
 * OpenSwan typed runtime so structural cleanups / un-darkenings can only land
 * deliberately:
 *   OST-G1 — the legacy dual tool path `runOpenSwanRuntimeToolLoop` has zero
 *            callers (only the pure `extractBrowserPlansFromToolActions` helper
 *            is imported from `openswanRuntimeToolLoop`).
 *   OST-G2 — the session runtime keeps its typed-core seams LIVE: the T2
 *            progressive-disclosure seam (getProgressiveOpenSwanTools called,
 *            resolveAdditionalTools passed into the typed-core run) and, since
 *            2026-07-20, the T8 toolParallelPolicyProvider. As of the R1 flip
 *            (2026-07-20) T8 PARALLELISM is also LIVE in this one runtime:
 *            parallelToolConcurrency is pinned to 4 (partitioned groups may
 *            dispatch up to 4 concurrently; groups stay sequential/in-order,
 *            approval/interactive/unknown tools stay sequential barriers).
 *            The delegationGate and swanbotV2BatchRuntime pins stay at 1.
 *   OST-G3 — agentExecutionCore.runAgent advertises an additive-only tool set:
 *            without resolveAdditionalTools the set is identical turn-over-turn;
 *            with one it only GROWS (never shrinks).
 *   OST-G4 — typed run-ledger paths preserve input/output/cache token rollups.
 *   OST-G5 — the AI-first flags flipped default-ON on 2026-07-01 stay ON:
 *            stream->escalate defaults ON when the flag is unset (explicit
 *            '0'/'false'/'off' opt-out still turns it OFF), and the mass-deploy
 *            tool stays enabled AND approval-gated (mandatory 'ask' policy,
 *            50-agent ceiling, $10 per-deploy cost cap).
 *
 * Run: npm run smoke:openswan-typed-runtime-invariants
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { runAgent, type AgentProvider, type AgentToolDefinition } from '../src/lib/agentExecutionCore';
import {
  chooseChatTerminalTransport,
  isStreamEscalateOnToolUseEnabled,
  STREAM_ESCALATE_ON_TOOL_USE_FLAG,
} from '../src/lib/chatTerminalTransportPolicy';
import {
  capDeployCount,
  MAX_AGENTS_PER_DEPLOY,
  PER_DEPLOY_COST_CAP_USD,
  shouldRequireApproval,
} from '../src/lib/agentDeployPolicy';

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function pass(message: string): void {
  console.log('pass:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

const repoRoot = resolve(__dirname, '..');

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist' || entry === 'build') continue;
    const full = join(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry)) out.push(full);
  }
}

const files: string[] = [];
walk(join(repoRoot, 'src'), files);
walk(join(repoRoot, 'scripts'), files);
walk(join(repoRoot, 'supabase'), files);

// ── OST-G1: dead dual-path has no live caller ──────────────────────────────
const loopDefFile = join(repoRoot, 'src/lib/openswanRuntimeToolLoop.ts');
const selfFile = resolve(__filename);
const callerFiles: string[] = [];
const importerFiles: string[] = [];
for (const f of files) {
  if (resolve(f) === selfFile) continue; // never scan this guard itself
  const src = readFileSync(f, 'utf8');
  if (src.includes('runOpenSwanRuntimeToolLoop') && f !== loopDefFile) callerFiles.push(f);
  if (/from\s+['"]\.\/openswanRuntimeToolLoop['"]/.test(src) || /from\s+['"]\.\.\/lib\/openswanRuntimeToolLoop['"]/.test(src)) {
    // record the named imports for whitelist check
    const m = src.match(/import\s+\{([^}]*)\}\s+from\s+['"][^'"]*openswanRuntimeToolLoop['"]/);
    importerFiles.push(`${f} :: ${m ? m[1].trim() : '(unparsed)'}`);
  }
}
assert(
  callerFiles.length === 0,
  'runOpenSwanRuntimeToolLoop has no caller outside its own definition file',
  callerFiles.length ? `unexpected references in: ${callerFiles.join(', ')}` : undefined,
);
// only openswanSessionRuntime.ts imports the module, and only the pure helper
const badImporters = importerFiles.filter(
  (entry) => !entry.includes('openswanSessionRuntime.ts') || !entry.includes('extractBrowserPlansFromToolActions'),
);
assert(
  importerFiles.length === 1 && badImporters.length === 0,
  'only openswanSessionRuntime.ts imports openswanRuntimeToolLoop, and only extractBrowserPlansFromToolActions',
  importerFiles.join(' | '),
);

// ── OST-G2: T2 seam is LIVE (2026-07-01), T8 parallelism LIVE (R1, 2026-07-20) ─
const sessionSrc = readFileSync(join(repoRoot, 'src/lib/openswanSessionRuntime.ts'), 'utf8');
const persistenceSrc = readFileSync(join(repoRoot, 'src/lib/agentRunPersistence.ts'), 'utf8');
const subagentSrc = readFileSync(join(repoRoot, 'src/lib/subagentRegistry.ts'), 'utf8');
assert(/parallelToolConcurrency:\s*4\b/.test(sessionSrc), 'session runtime pins parallelToolConcurrency: 4 (R1 flip, 2026-07-20)');
// The other two typed-core call sites stay fully sequential — the R1 flip is
// scoped to the OpenSwan session runtime only.
const delegationSrc = readFileSync(join(repoRoot, 'src/lib/delegationGate.ts'), 'utf8');
const v2BatchSrc = readFileSync(join(repoRoot, 'src/lib/swanbotV2BatchRuntime.ts'), 'utf8');
assert(/parallelToolConcurrency:\s*1\b/.test(delegationSrc), 'delegationGate keeps parallelToolConcurrency pinned to 1');
assert(/parallelToolConcurrency:\s*1\b/.test(v2BatchSrc), 'swanbotV2BatchRuntime keeps parallelToolConcurrency pinned to 1');

function allMentionsAreComments(src: string, token: string): boolean {
  const lines = src.split('\n').filter((l) => l.includes(token));
  if (lines.length === 0) return true; // absent is fine (still dark)
  return lines.every((l) => l.trim().startsWith('//'));
}
function hasLiveMention(src: string, token: string): boolean {
  return src.split('\n').some((l) => l.includes(token) && !l.trim().startsWith('//'));
}
// Progressive disclosure was un-darkened in f9c9a0b: the session runtime must
// import + call the bridge helper and pass its resolver into the typed core.
assert(
  /import\s*\{[^}]*getProgressiveOpenSwanTools[^}]*\}\s*from\s*['"]\.\/openswanBridge['"]/.test(sessionSrc)
    && hasLiveMention(sessionSrc, 'getProgressiveOpenSwanTools('),
  'getProgressiveOpenSwanTools is imported and called LIVE in the session runtime (wired 2026-07-01)',
);
assert(
  sessionSrc.split('\n').some((l) => l.trim() === 'resolveAdditionalTools,'),
  'resolveAdditionalTools is passed LIVE into the typed-core run (wired 2026-07-01)',
);
// T8 policy provider (2026-07-20): passed LIVE and, since the R1 flip, serves
// BOTH duties — side-effect CLASSIFICATION (toolReplaySafetyCore's verify-first
// gate on failed mutating tools) AND parallel partitioning
// (partitionParallelSafeBatch groups only auto/no-external-side-effect/
// read-only-or-disjoint-domain calls for the concurrency-4 dispatch above).
assert(
  hasLiveMention(sessionSrc, 'toolParallelPolicyProvider: createOpenSwanToolParallelPolicyProvider('),
  'toolParallelPolicyProvider is passed LIVE into the typed-core run (replay safety + partitioning, 2026-07-20)',
);

// ── OST-G4: typed run-ledger token rollups stay complete ───────────────────
assert(
  persistenceSrc.includes('tokenTotals.input +=') && persistenceSrc.includes('tokenTotals.output +='),
  'agentRunPersistence accumulates input/output usage from typed turn_end events',
);
assert(
  persistenceSrc.includes('cache_read_input_tokens') && persistenceSrc.includes('cache_creation_input_tokens'),
  'agentRunPersistence accumulates provider cache usage from typed turn_end events',
);
assert(
  persistenceSrc.includes('input_tokens: tokenTotals.input')
    && persistenceSrc.includes('output_tokens: tokenTotals.output')
    && persistenceSrc.includes('cached_tokens: tokenTotals.cached'),
  'agentRunPersistence finalizes agent_runs token columns',
);
assert(
  subagentSrc.includes('cached_tokens: typeof toolLoopResult.usage.total_tokens ==='),
  'subagent typed-core child runs persist cached_tokens from total token usage',
);
assert(
  sessionSrc.includes('const delegatedUsageTotals = emptyOpenSwanTokenTotals()')
    && sessionSrc.includes('addOpenSwanUsageTotals(delegatedUsageTotals, result.usage)'),
  'session runtime accumulates delegated subagent usage totals',
);
assert(
  sessionSrc.includes('usage: result.usage || null'),
  'session runtime preserves delegated usage in run metadata',
);
assert(
  sessionSrc.includes('finalUsageTotals.input += delegatedUsageTotals.input')
    && sessionSrc.includes('cached_tokens: finalUsageTotals.cached'),
  'session runtime finalizes parent runs with parent plus delegated token totals',
);

// ── OST-G5: AI-first flags stay default-ON (flipped 2026-07-01, f9c9a0b) ────
// (a) stream->escalate defaults ON when the flag is unset. Node has no
// localStorage, so this call IS the unset case.
type FlagStore = { localStorage?: { getItem: (k: string) => string | null } };
delete (globalThis as FlagStore).localStorage;
assert(isStreamEscalateOnToolUseEnabled() === true, 'stream->escalate defaults ON when the flag is unset');
assert(
  chooseChatTerminalTransport({ canStreamAnthropic: true }).path === 'stream_then_escalate',
  'simple streamable chat resolves to stream_then_escalate by default',
);
// (b) explicit opt-out values still turn it OFF; other stored values stay ON.
function withStoredFlag<T>(value: string | null, run: () => T): T {
  (globalThis as FlagStore).localStorage = {
    getItem: (k: string) => (k === STREAM_ESCALATE_ON_TOOL_USE_FLAG ? value : null),
  };
  try {
    return run();
  } finally {
    delete (globalThis as FlagStore).localStorage;
  }
}
for (const optOut of ['0', 'false', 'off']) {
  assert(
    withStoredFlag(optOut, () => isStreamEscalateOnToolUseEnabled()) === false,
    `stream->escalate opt-out value '${optOut}' turns the flag OFF`,
  );
}
assert(
  withStoredFlag('off', () => chooseChatTerminalTransport({ canStreamAnthropic: true }).path) === 'stream_plain_chat',
  'opted-out simple streamable chat falls back to legacy stream_plain_chat',
);
for (const stillOn of [null, '1', 'true']) {
  assert(
    withStoredFlag(stillOn, () => isStreamEscalateOnToolUseEnabled()) === true,
    `stream->escalate stays ON for stored value ${JSON.stringify(stillOn)}`,
  );
}
// Explicit caller override always wins over the flag (both directions).
assert(
  chooseChatTerminalTransport({ canStreamAnthropic: true, streamEscalateOnToolUse: false }).path === 'stream_plain_chat'
    && chooseChatTerminalTransport({ canStreamAnthropic: true, streamEscalateOnToolUse: true }).path === 'stream_then_escalate',
  'explicit streamEscalateOnToolUse override wins over the flag',
);

// (c) mass-deploy tool: flag stays ON, and enablement stays flag-governed for
// both advertising and loop reachability (source-level — the runtime module
// transitively imports react-native so it cannot be imported here).
const toolRuntimeSrc = readFileSync(join(repoRoot, 'src/lib/openswanToolRuntime.ts'), 'utf8');
assert(
  /const DEPLOY_AGENTS_TOOL_ENABLED:\s*boolean\s*=\s*true\b/.test(toolRuntimeSrc),
  'DEPLOY_AGENTS_TOOL_ENABLED is ON (enabled 2026-07-01)',
);
assert(
  toolRuntimeSrc.includes('...(DEPLOY_AGENTS_TOOL_ENABLED ? [TEAM_DEPLOY_AGENTS_TOOL_DEFINITION] : [])'),
  'deploy tool advertising stays governed by DEPLOY_AGENTS_TOOL_ENABLED',
);
const loopGateIdx = toolRuntimeSrc.indexOf('if (DEPLOY_AGENTS_TOOL_ENABLED) {');
assert(
  loopGateIdx >= 0 && toolRuntimeSrc.slice(loopGateIdx, loopGateIdx + 200).includes("TOOL_LOOP_SAFE_NAMES.add('team.deploy_agents')"),
  'deploy tool loop reachability stays governed by DEPLOY_AGENTS_TOOL_ENABLED',
);
// The deploy tool must stay mandatory-'ask' even while enabled.
const deployPolicyIdx = toolRuntimeSrc.indexOf("if (tool === 'team.deploy_agents')");
assert(
  deployPolicyIdx >= 0 && toolRuntimeSrc.slice(deployPolicyIdx, deployPolicyIdx + 700).includes("approvalMode: 'ask'"),
  "deploy tool policy remains mandatory approvalMode: 'ask'",
);
// Caps stay 50 agents / $10 per deploy (behavioral — agentDeployPolicy is pure).
assert(MAX_AGENTS_PER_DEPLOY === 50, 'deploy ceiling remains 50 agents per deploy');
assert(PER_DEPLOY_COST_CAP_USD === 10, 'per-deploy cost cap remains $10');
const capped = capDeployCount(9999);
assert(capped.count === 50 && capped.truncated === true, 'capDeployCount clamps oversized requests to the 50-agent ceiling');
assert(
  shouldRequireApproval({ count: 50, estimateUsd: 0 }).required === true,
  'large fan-outs still require approval regardless of cost',
);
assert(
  shouldRequireApproval({ count: 1, estimateUsd: 10.01 }).required === true,
  'estimates over the $10 cap still require approval regardless of count',
);

// ── OST-G3: additive-only advertised tool set (behavioral) ─────────────────
function makeTool(name: string): AgentToolDefinition {
  return {
    name,
    description: `mock ${name}`,
    input_schema: { type: 'object', properties: {} },
    handler: async () => ({ ok: true, data: { name } }),
  };
}

function makeProvider(captured: string[][]): AgentProvider {
  let turn = 0;
  return {
    async turn(args) {
      captured.push(args.tools.map((t) => t.name).sort());
      turn += 1;
      if (turn === 1) {
        return {
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'u1', name: 'mock_a', input: {} }],
        };
      }
      return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'done' }] };
    },
  };
}

async function runBehavioral(): Promise<void> {
  const baseTools = [makeTool('mock_a'), makeTool('mock_b')];
  const baseNames = baseTools.map((t) => t.name).sort();

  // (1) no resolveAdditionalTools -> identical turn-over-turn
  const cap1: string[][] = [];
  await runAgent({
    initialMessages: [{ role: 'user', content: 'hello' }],
    tools: baseTools,
    provider: makeProvider(cap1),
    maxIterations: 5,
  });
  assert(cap1.length >= 2, 'provider was called for at least two turns (static)');
  const allIdentical = cap1.every((names) => JSON.stringify(names) === JSON.stringify(baseNames));
  assert(allIdentical, 'static run: advertised tool set is identical turn-over-turn', JSON.stringify(cap1));

  // (2) positive control: resolveAdditionalTools adds exactly one tool from the
  // SECOND turn onward (iteration is 1-indexed in runAgent), so the first
  // captured snapshot is still the base set and the set grows by exactly one.
  const cap2: string[][] = [];
  await runAgent({
    initialMessages: [{ role: 'user', content: 'hello' }],
    tools: baseTools,
    provider: makeProvider(cap2),
    maxIterations: 5,
    resolveAdditionalTools: ({ iteration }) => (iteration >= 2 ? [makeTool('mock_c')] : []),
  });
  assert(cap2.length >= 2, 'provider was called for at least two turns (dynamic)');
  const firstSet = new Set(cap2[0]);
  const lastSet = new Set(cap2[cap2.length - 1]);
  // never shrinks
  const shrank = [...firstSet].some((n) => !lastSet.has(n));
  assert(!shrank, 'dynamic run: tool set never removes a tool');
  // grows by exactly the one added tool
  assert(lastSet.has('mock_c') && lastSet.size === firstSet.size + 1, 'dynamic run: tool set grows by exactly the added tool');
}

runBehavioral()
  .then(() => {
    if (failures > 0) {
      console.error(`\n${failures} assertion(s) failed.`);
      process.exit(1);
    }
    console.log('\nopenswan-typed-runtime-invariants-smoketest: all assertions passed.');
  })
  .catch((err) => {
    console.error('FAIL: behavioral run threw:', err);
    process.exit(1);
  });
