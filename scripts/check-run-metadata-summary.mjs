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
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-run-metadata-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

const runnerSource = `
import {
  buildRunMetadataSummaryProps,
  readRunBrowserPlanEvents,
  readRunBrowserSessions,
  readRunExecutionStream,
} from '../src/lib/runMetadataSummary';

declare const process: { exit(code?: number): never; stdout: { write(chunk: string): void } };

const failures: string[] = [];

const currentShape = buildRunMetadataSummaryProps({
  command_route_decisions: [{ routeId: 'browser', source: 'slash', commandText: '/browser plan pricing', originalText: 'use browser' }],
  browserPlans: [{ planId: 'plan-1', task: 'Compare pricing', actions: [], backendLabel: 'Browserbase' }],
  delegated_subagents: ['research-1', 'research-2'],
  activeSkills: [
    { name: 'research_topic', displayName: 'Research Topic', source: 'inferred' },
    { name: 'summarize_thread', displayName: 'Summarize Thread', source: 'recommended' },
  ],
  explicitMode: 'research',
  modeLabel: 'Research',
  modeDescription: 'Investigate deeply and compare options before deciding.',
  modeOutcome: 'Findings, tradeoffs, evidence, and recommendation.',
  modeOutcomeSummary: {
    headline: 'Research run produced 2 artifacts.',
    bulletPoints: ['report: Structured Report'],
    blockers: ['manual review required'],
  },
  observedEval: {
    mode: 'research',
    profile: 'research',
    intent: 'research',
    taskKind: 'research',
    outcome: 'strong',
    score: 88,
    verification: { planned: 2, executed: 2, passed: 2, failed: 0, manualRequired: 0, blocked: 0, coverageRatio: 1 },
    artifacts: { total: 2, durable: 1, kinds: ['report', 'research_brief'] },
    tools: { total: 2, failed: 0, manualRequired: 0, blocked: 0 },
    responseQuality: { score: 84, met: ['clear recommendation'], missed: [] },
    modeSignals: [
      { key: 'recommendation', label: 'Recommendation', score: 84 },
      { key: 'evidence', label: 'Evidence', score: 78 },
    ],
    blockers: [],
    strengths: ['2 verification check(s) passed'],
  },
});

if (currentShape.commandDecisions.length !== 1) failures.push('current metadata should keep command_route_decisions');
if (currentShape.browserPlans.length !== 1) failures.push('current metadata should keep browserPlans');
if (currentShape.delegatedSubagents.length !== 2) failures.push('current metadata should keep delegated_subagents');
if (currentShape.activeSkills.length !== 2) failures.push('current metadata should keep activeSkills');
if (currentShape.activeSkills[0]?.displayName !== 'Research Topic') failures.push('current metadata should keep active skill display names');
if (currentShape.modeContext?.label !== 'Research') failures.push('current metadata should keep explicit mode label');
if (currentShape.modeContext?.outcome !== 'Findings, tradeoffs, evidence, and recommendation.') failures.push('current metadata should keep mode outcome');
if (currentShape.modePresentation?.verificationTitle !== 'EVIDENCE & CHECKS') failures.push('research mode should derive presentation hints');
if (currentShape.modeOutcomeSummary?.headline !== 'Research run produced 2 artifacts.') failures.push('current metadata should keep mode outcome summary');
if (currentShape.observedEval?.score !== 88) failures.push('current metadata should keep observed eval summary');
if (currentShape.observedEval?.responseQuality.score !== 84) failures.push('current metadata should keep response-quality score');
if (currentShape.observedEval?.responseQuality.met[0] !== 'clear recommendation') failures.push('current metadata should keep response-quality met rules');
if (currentShape.observedEval?.modeSignals[0]?.label !== 'Recommendation') failures.push('current metadata should keep mode-specific quality signals');

const legacyShape = buildRunMetadataSummaryProps({
  commandDecisions: [{ routeId: 'github', source: 'natural_language', commandText: '/gh tree', originalText: 'show repo tree' }],
});

if (legacyShape.commandDecisions.length !== 1) failures.push('legacy metadata should keep commandDecisions fallback');
if (legacyShape.browserPlans.length !== 0) failures.push('missing browserPlans should normalize to empty');
if (legacyShape.delegatedSubagents.length !== 0) failures.push('missing delegated_subagents should normalize to empty');
if (legacyShape.activeSkills.length !== 0) failures.push('missing activeSkills should normalize to empty');
if (legacyShape.modeContext !== null) failures.push('missing mode metadata should normalize to null');
if (legacyShape.modePresentation !== null) failures.push('missing mode metadata should normalize presentation to null');
if (legacyShape.modeOutcomeSummary !== null) failures.push('missing mode outcome summary should normalize to null');
if (legacyShape.observedEval !== null) failures.push('missing observed eval should normalize to null');

const detailMetadata = {
  execution_stream: [{ status: 'passed', summary: 'Typecheck green' }],
  browserPlanEvents: [{ id: 'evt-1', type: 'planned', status: 'pending', summary: 'Plan created', planId: 'plan-1', createdAt: '2026-01-01T00:00:00.000Z' }],
  browserSessions: [{ id: 'sess-1', planId: 'plan-1', status: 'running', provider: 'browserbase', createdAt: '2026-01-01T00:00:00.000Z' }],
};

if (readRunExecutionStream(detailMetadata).length !== 1) failures.push('execution stream reader should keep execution_stream');
if (readRunBrowserPlanEvents(detailMetadata).length !== 1) failures.push('browser event reader should keep browserPlanEvents');
if (readRunBrowserSessions(detailMetadata).length !== 1) failures.push('browser session reader should keep browserSessions');

const emptyShape = buildRunMetadataSummaryProps(null);
if (emptyShape.commandDecisions.length !== 0 || emptyShape.browserPlans.length !== 0 || emptyShape.delegatedSubagents.length !== 0 || emptyShape.activeSkills.length !== 0 || emptyShape.modeContext !== null) {
  failures.push('null metadata should normalize to empty summary props');
}
if (readRunExecutionStream(null).length !== 0) failures.push('null metadata should normalize execution stream to empty');
if (readRunBrowserPlanEvents(null).length !== 0) failures.push('null metadata should normalize browser plan events to empty');
if (readRunBrowserSessions(null).length !== 0) failures.push('null metadata should normalize browser sessions to empty');

if (failures.length) {
  console.error('Run metadata summary failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Run metadata summary checks passed.');
`;

  const tsconfigSource = JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'CommonJS',
      moduleResolution: 'Node',
      esModuleInterop: true,
      strict: true,
      skipLibCheck: true,
      rootDir: projectRoot,
      outDir,
    },
    include: [
      runnerPath,
      path.join(projectRoot, 'src/lib/chatCommandRegistry.ts'),
      path.join(projectRoot, 'src/lib/runRouting.ts'),
      path.join(projectRoot, 'src/lib/runMetadataSummary.ts'),
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
