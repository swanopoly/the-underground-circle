#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: projectRoot, stdio: 'pipe', ...opts });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} failed with code ${code}\n${stderr || stdout}`));
    });
  });
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-openswan-observed-evals-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

  const runnerSource = `
import {
  buildOpenSwanObservedEvalDashboard,
  buildOpenSwanObservedEvalAggregate,
  buildOpenSwanObservedEvalSummary,
} from '../src/lib/openswanObservedEvals';

declare const process: { exit(code?: number): never; stdout: { write(chunk: string): void } };

const failures: string[] = [];

const strong = buildOpenSwanObservedEvalSummary({
  run: {
    status: 'completed',
    mode: 'research',
    provider: 'openswan',
    metadata: {
      explicitMode: 'research',
      resolvedSessionProfile: 'research',
      routingIntent: 'research',
      taskKind: 'research',
      verificationPlan: [{}, {}],
      modeOutcomeSummary: { headline: 'Research brief ready', bulletPoints: [], blockers: [] },
      activeSkills: [
        { name: 'research_topic', displayName: 'Research Topic', source: 'inferred' },
      ],
      runtimeToolActions: [
        { status: 'completed', title: 'search' },
        { status: 'completed', title: 'fetch' },
      ],
    },
  },
  artifacts: [
    { artifact_kind: 'report', title: 'Report' },
    { artifact_kind: 'research_brief', title: 'Research Brief' },
  ],
  verificationResults: [
    { status: 'passed', ok: true, executed: true, summary: 'Typecheck passed' },
    { status: 'passed', ok: true, executed: true, summary: 'Tradeoff review passed' },
  ],
  toolActions: [
    { status: 'completed', title: 'search' },
    { status: 'completed', title: 'fetch' },
  ],
  responseText: 'Findings:\\n- Option A has stronger evidence.\\n- Option B is faster but riskier.\\nRecommendation: choose Option A because the tradeoffs are better supported by the evidence.',
});

if (!strong) failures.push('strong OpenSwan run should produce an eval summary');
if (strong?.outcome !== 'strong') failures.push('clean completed run should score as strong');
if ((strong?.score || 0) < 75) failures.push('strong run should keep a high score');
if (strong?.verification.coverageRatio !== 1) failures.push('strong run should keep full verification coverage');
if ((strong?.responseQuality.score || 0) < 60) failures.push('strong research response should score well on response quality');
if (!(strong?.responseQuality.met || []).includes('clear recommendation')) failures.push('strong research response should record a clear recommendation');
if ((strong?.modeSignals || []).length < 2) failures.push('research run should expose mode signals');
if (strong?.modeSignals?.[0]?.label !== 'Recommendation') failures.push('research run should expose recommendation as a mode signal');
if (!(strong?.skillSignals || []).some((signal) => signal.label === 'Research Topic')) failures.push('research run should expose active skill signals');

const blocked = buildOpenSwanObservedEvalSummary({
  run: {
    status: 'completed',
    mode: 'support',
    provider: 'openswan',
    metadata: {
      explicitMode: 'support',
      resolvedSessionProfile: 'support',
      routingIntent: 'debug',
      taskKind: 'debug',
      verificationPlan: [{}, {}],
      modeOutcomeSummary: { headline: 'Blocked on missing access', bulletPoints: [], blockers: ['Missing token'] },
      activeSkills: [
        { name: 'bug_hunt', displayName: 'Bug Hunt', source: 'inferred' },
      ],
      runtimeToolActions: [
        { status: 'manual_required', title: 'approval needed', output_preview: 'Manual approval needed' },
      ],
    },
  },
  artifacts: [{ artifact_kind: 'checklist', title: 'Recovery Checklist' }],
  verificationResults: [
    { status: 'manual_required', ok: false, executed: false, summary: 'Manual review required' },
  ],
  toolActions: [
    { status: 'manual_required', title: 'approval needed', output_preview: 'Manual approval needed' },
  ],
  responseText: 'Blocked on missing token. Fastest unblock path: restore the token, retry the connection, and use the fallback checklist if access still fails.',
});

if (!blocked) failures.push('blocked OpenSwan run should produce an eval summary');
if (blocked?.outcome !== 'blocked') failures.push('manual-required run should score as blocked');
if (!(blocked?.blockers || []).includes('Missing token')) failures.push('blocked run should preserve blockers');
if (!(blocked?.responseQuality.met || []).includes('fast unblock path')) failures.push('support response should record a fast unblock path');
if (!(blocked?.modeSignals || []).some((signal) => signal.label === 'Unblock Path')) failures.push('support run should expose unblock path as a mode signal');
if (!(blocked?.skillSignals || []).some((signal) => signal.label === 'Bug Hunt')) failures.push('blocked run should expose skill execution signals');

const failed = buildOpenSwanObservedEvalSummary({
  run: {
    status: 'failed',
    mode: 'build',
    provider: 'openswan',
    metadata: {
      explicitMode: 'build',
      resolvedSessionProfile: 'senior',
      routingIntent: 'build',
      taskKind: 'build',
      verificationPlan: [{}, {}],
    },
  },
  verificationResults: [
    { status: 'failed', ok: false, executed: true, summary: 'Tests failed' },
  ],
  toolActions: [
    { status: 'failed', title: 'generate patch', output_preview: 'Patch failed' },
  ],
  responseText: 'I could not finish the build.',
});

if (!failed) failures.push('failed OpenSwan run should produce an eval summary');
if (failed?.outcome !== 'failed') failures.push('failed run should score as failed');
if ((failed?.responseQuality.missed || []).length === 0) failures.push('failed build response should record missed expectations');

const aggregate = buildOpenSwanObservedEvalAggregate([strong, blocked, failed]);
if (aggregate.total !== 3) failures.push('aggregate should count valid summaries');
if (aggregate.averageVerificationCoverage <= 0) failures.push('aggregate should compute average verification coverage');
if (aggregate.averageResponseQuality <= 0) failures.push('aggregate should compute average response quality');
if (aggregate.blockerRate <= 0) failures.push('aggregate should compute blocker rate');
if (aggregate.byOutcome.strong !== 1 || aggregate.byOutcome.blocked !== 1 || aggregate.byOutcome.failed !== 1) {
  failures.push('aggregate should count outcomes by class');
}
if (aggregate.byMode.research !== 1 || aggregate.byMode.support !== 1 || aggregate.byMode.build !== 1) {
  failures.push('aggregate should count outcomes by mode');
}
if (aggregate.modeBreakdown.length !== 3) failures.push('aggregate should build mode breakdown rows');
if (aggregate.modeBreakdown.some((mode) => mode.averageResponseQuality <= 0)) {
  failures.push('mode breakdown should compute average response quality');
}
if (aggregate.modeBreakdown.some((mode) => !mode.weakestSignal)) {
  failures.push('mode breakdown should expose weakest signal per mode');
}
if (aggregate.topBlockers[0]?.label !== 'Missing token') failures.push('aggregate should count top blockers');
const dashboard = buildOpenSwanObservedEvalDashboard([
  { created_at: '2026-04-18T10:00:00.000Z', metadata: { observedEval: strong } },
  { created_at: '2026-04-18T11:00:00.000Z', metadata: { observedEval: blocked } },
  { created_at: '2026-04-18T12:00:00.000Z', metadata: { observedEval: failed } },
]);
if (dashboard.weakestModes.length === 0) failures.push('dashboard should compute weakest modes');
if (dashboard.weakestModes.some((mode) => mode.averageResponseQuality <= 0)) {
  failures.push('dashboard weakest modes should include average response quality');
}
if (dashboard.weakestModes.some((mode) => !mode.weakestSignal)) {
  failures.push('dashboard weakest modes should expose weakest signal');
}
if (dashboard.weakestModes.some((mode) => mode.leadingSignals.length === 0)) {
  failures.push('dashboard weakest modes should include leading mode signals');
}
if (dashboard.failureClusters.length === 0) {
  failures.push('dashboard should expose repeated failure clusters');
}
if (!dashboard.failureClusters.some((cluster) => /Weak (Research Topic|Bug Hunt)/.test(cluster.label))) {
  failures.push('dashboard should include weak skill clusters when active skills underperform');
}

if (failures.length) {
  console.error('OpenSwan observed eval failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('OpenSwan observed eval checks passed.');
`;

  const tsconfigSource = JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      // agentRunSystem's import graph now reaches .tsx modules
      // (chatMessageTypes imports chat cards as of 6b05b8a), and a tsconfig
      // without jsx makes tsc REFUSE .tsx resolution (TS6142) — which broke
      // this gate at clean HEAD, unrelated to whatever change was under
      // test. Match the app tsconfig so the gate compiles what the app
      // compiles.
      jsx: 'react-native',
      rootDir: projectRoot,
      outDir,
    },
    include: [
      runnerPath,
      path.join(projectRoot, 'src/lib/openswanObservedEvals.ts'),
      path.join(projectRoot, 'src/lib/agentRunSystem.ts'),
    ],
  }, null, 2);

  await fs.writeFile(runnerPath, runnerSource, 'utf8');
  await fs.writeFile(tsconfigPath, tsconfigSource, 'utf8');

  const tscBin = require.resolve('typescript/bin/tsc');
  try {
    await run(process.execPath, [tscBin, '-p', tsconfigPath]);
    const compiledRunner = path.join(outDir, path.relative(projectRoot, runnerPath)).replace(/\.ts$/, '.js');
    const { stdout } = await run(process.execPath, [compiledRunner]);
    process.stdout.write(stdout);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
