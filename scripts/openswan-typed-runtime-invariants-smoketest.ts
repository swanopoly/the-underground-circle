/**
 * openswan-typed-runtime-invariants-smoketest — guards three invariants of the
 * OpenSwan typed runtime so structural cleanups / un-darkenings can only land
 * deliberately:
 *   OST-G1 — the legacy dual tool path `runOpenSwanRuntimeToolLoop` has zero
 *            callers (only the pure `extractBrowserPlansFromToolActions` helper
 *            is imported from `openswanRuntimeToolLoop`).
 *   OST-G2 — the session runtime keeps T2/T8 seams dark (parallelToolConcurrency
 *            pinned to 1; resolveAdditionalTools / toolParallelPolicyProvider /
 *            getProgressiveOpenSwanTools commented out, not passed live).
 *   OST-G3 — agentExecutionCore.runAgent advertises an additive-only tool set:
 *            without resolveAdditionalTools the set is identical turn-over-turn;
 *            with one it only GROWS (never shrinks).
 *   OST-G4 — typed run-ledger paths preserve input/output/cache token rollups.
 *
 * Run: npm run smoke:openswan-typed-runtime-invariants
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { runAgent, type AgentProvider, type AgentToolDefinition } from '../src/lib/agentExecutionCore';

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

// ── OST-G2: T2/T8 seams stay dark in the session runtime ───────────────────
const sessionSrc = readFileSync(join(repoRoot, 'src/lib/openswanSessionRuntime.ts'), 'utf8');
const persistenceSrc = readFileSync(join(repoRoot, 'src/lib/agentRunPersistence.ts'), 'utf8');
const subagentSrc = readFileSync(join(repoRoot, 'src/lib/subagentRegistry.ts'), 'utf8');
assert(/parallelToolConcurrency:\s*1\b/.test(sessionSrc), 'session runtime pins parallelToolConcurrency: 1');

function allMentionsAreComments(src: string, token: string): boolean {
  const lines = src.split('\n').filter((l) => l.includes(token));
  if (lines.length === 0) return true; // absent is fine (still dark)
  return lines.every((l) => l.trim().startsWith('//'));
}
assert(allMentionsAreComments(sessionSrc, 'resolveAdditionalTools'), 'resolveAdditionalTools is comment-only in session runtime (dark)');
assert(allMentionsAreComments(sessionSrc, 'toolParallelPolicyProvider'), 'toolParallelPolicyProvider is comment-only in session runtime (dark)');
assert(allMentionsAreComments(sessionSrc, 'getProgressiveOpenSwanTools'), 'getProgressiveOpenSwanTools is comment-only in session runtime (dark)');

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
