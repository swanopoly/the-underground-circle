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
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-persisted-chat-metadata-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

  const runnerSource = `
import {
  formatPersistedChatBotMessage,
  isPersistedChatBotMessage,
  stripPersistedChatBotPrefix,
} from '../src/lib/persistedChatMetadata';
import {
  readMessageArtifacts,
  readMessageBrowserPlanEvents,
  readMessageBrowserPlans,
  readMessageBrowserSessions,
  readMessageExecutionStream,
  readMessageMemoriesUsed,
  readMessageMemoryRefs,
  readMessageMemoryRecommendations,
  readMessageResearchRefs,
  readMessageWikiRefs,
  readPersistedChatBotMessageFields,
} from '../src/lib/messageMetadataReaders';

declare const process: { exit(code?: number): never; stdout: { write(chunk: string): void } };

const failures: string[] = [];

const persisted = formatPersistedChatBotMessage('OpenSwan', 'Research complete', {
  artifacts: [{ kind: 'code', title: 'Patch', content: 'console.log(1);' }],
  wikiRefs: [{ id: 'wiki-1', title: 'AI Wiki', subtitle: 'Reference', category: 'open-source', color: '#22c55e', tags: ['ai'] }],
  researchRefs: [{ id: 'res-1', title: 'Research Doc', subtitle: 'Summary', color: '#38bdf8', reviewStatus: 'reviewed', sourceType: 'report', relevantSpirits: [] }],
  memoriesUsed: ['Workflow: CC / project'],
  memoryRefs: [{ id: 'mem-1', title: 'Project Memory', scope: 'session', memoryKind: 'finding' }],
  memoryRecommendations: [{ id: 'rec-1', memoryId: 'mem-1', title: 'Promote memory', content: 'Promote memory', memoryKind: 'finding', priority: 'medium', rationale: 'helpful', target: 'promote_existing', source: 'guidance_promotion', recommendationType: 'promote_existing' }],
  executionStream: [{ mode: 'automatic', status: 'passed', summary: 'Typecheck green' }],
  browserPlans: [{ planId: 'plan-1', task: 'Compare pricing', actions: [], backend: 'browserbase_stagehand', backendLabel: 'Browserbase', requiresApproval: true, status: 'planned' }],
  browserPlanEvents: [{ id: 'evt-1', kind: 'planned', summary: 'Plan created', planId: 'plan-1', at: '2026-01-01T00:00:00.000Z' }],
  browserSessions: [{ id: 'sess-1', planId: 'plan-1', task: 'Compare pricing', backend: 'browserbase_stagehand', backendLabel: 'Browserbase', status: 'executing', startedAt: '2026-01-01T00:00:00.000Z', actions: [] }],
  commandDecisions: [{ routeId: 'browser', source: 'slash', input: 'use browser', commandText: '/browser plan pricing', decidedAt: '2026-01-01T00:00:00.000Z' }],
  observedEval: {
    mode: 'research',
    profile: 'research',
    intent: 'research',
    taskKind: 'research',
    outcome: 'strong',
    score: 91,
    verification: { planned: 2, executed: 2, passed: 2, failed: 0, manualRequired: 0, blocked: 0, coverageRatio: 1 },
    artifacts: { total: 2, durable: 1, kinds: ['code_patch', 'research_brief'] },
    tools: { total: 2, failed: 0, manualRequired: 0, blocked: 0 },
    blockers: [],
    strengths: ['2 verification check(s) passed'],
  },
});

if (!isPersistedChatBotMessage(persisted, true)) failures.push('formatted persisted bot message should be recognized as bot content');
if (stripPersistedChatBotPrefix(persisted) !== 'Research complete') failures.push('stripPersistedChatBotPrefix should remove prefix and metadata marker');

const metadata = readPersistedChatBotMessageFields(persisted);
if (readMessageArtifacts(metadata).length !== 1) failures.push('artifacts should survive persisted metadata round-trip');
if (readMessageWikiRefs(metadata).length !== 1) failures.push('wiki refs should survive persisted metadata round-trip');
if (readMessageResearchRefs(metadata).length !== 1) failures.push('research refs should survive persisted metadata round-trip');
if (readMessageMemoriesUsed(metadata).length !== 1) failures.push('memories used should survive persisted metadata round-trip');
if (readMessageMemoryRefs(metadata).length !== 1) failures.push('memory refs should survive persisted metadata round-trip');
if (readMessageMemoryRecommendations(metadata).length !== 1) failures.push('memory recommendations should survive persisted metadata round-trip');
if (readMessageExecutionStream(metadata).length !== 1) failures.push('execution stream should survive persisted metadata round-trip');
if (readMessageBrowserPlans(metadata).length !== 1) failures.push('browser plans should survive persisted metadata round-trip');
if (readMessageBrowserPlanEvents(metadata).length !== 1) failures.push('browser plan events should survive persisted metadata round-trip');
if (readMessageBrowserSessions(metadata).length !== 1) failures.push('browser sessions should survive persisted metadata round-trip');
if ((metadata.commandDecisions || []).length !== 1) failures.push('command decisions should survive persisted metadata round-trip');
if ((metadata.observedEval?.score || 0) !== 91) failures.push('observed eval should survive persisted metadata round-trip');

const emptyMetadata = readPersistedChatBotMessageFields('plain assistant text');
if (Object.keys(emptyMetadata).length !== 0) failures.push('plain assistant text should normalize to empty persisted metadata');

if (failures.length) {
  console.error('Persisted chat metadata failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Persisted chat metadata checks passed.');
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
      path.join(projectRoot, 'src/lib/messageMetadataReaders.ts'),
      path.join(projectRoot, 'src/lib/persistedChatMetadata.ts'),
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
