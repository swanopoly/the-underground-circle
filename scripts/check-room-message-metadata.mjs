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
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-room-message-metadata-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

  const runnerSource = `
import { readMessageArtifacts, readMessageBrowserPlanEvents, readMessageBrowserPlans, readMessageMemoriesUsed, readMessageMemoryRefs } from '../src/lib/messageMetadataReaders';
import { buildRoomAgentMessageMetadata } from '../src/lib/roomMessageMetadata';

declare const process: { exit(code?: number): never; stdout: { write(chunk: string): void } };

const failures: string[] = [];

const metadata = buildRoomAgentMessageMetadata({
  usage: { model: 'claude-sonnet-4-6' },
  runId: 'run-1',
  toolEvents: [{ tool: 'code.inspect', input: null, result: 'ok', status: 'completed', summary: 'Inspected file' }],
  verificationResults: [],
  delegatedSubagents: ['research-1'],
  browserPlans: [{ planId: 'plan-1', task: 'Compare pricing', actions: [], backend: 'browserbase_stagehand', backendLabel: 'Browserbase', requiresApproval: true, status: 'planned' }],
  browserPlanEvents: [{ id: 'evt-1', planId: 'plan-1', kind: 'planned', at: '2026-01-01T00:00:00.000Z', summary: 'Plan created' }],
  memoriesUsed: ['Workflow: CC / project'],
  memoryReferences: [{ id: 'mem-1', title: 'Project Memory', scope: 'session', memoryKind: 'finding' }],
  observedEval: {
    mode: 'research',
    profile: 'research',
    intent: 'research',
    taskKind: 'research',
    outcome: 'strong',
    score: 84,
    verification: { planned: 2, executed: 2, passed: 2, failed: 0, manualRequired: 0, blocked: 0, coverageRatio: 1 },
    artifacts: { total: 2, durable: 1, kinds: ['code_patch', 'research_brief'] },
    tools: { total: 1, failed: 0, manualRequired: 0, blocked: 0 },
    blockers: [],
    strengths: ['2 verification check(s) passed'],
  },
}, [{ kind: 'code', title: 'Patch', content: 'console.log(1);' }]);

if ((metadata.run_id as string | null) !== 'run-1') failures.push('room metadata builder should keep run_id');
if (readMessageArtifacts(metadata).length !== 1) failures.push('room metadata builder should expose artifacts');
if (readMessageMemoriesUsed(metadata).length !== 1) failures.push('room metadata builder should expose memories_used');
if (readMessageMemoryRefs(metadata).length !== 1) failures.push('room metadata builder should expose memory_references');
if (readMessageBrowserPlans(metadata).length !== 1) failures.push('room metadata builder should expose browserPlans');
if (readMessageBrowserPlanEvents(metadata).length !== 1) failures.push('room metadata builder should expose browserPlanEvents');
if (!Array.isArray(metadata.tool_events) || metadata.tool_events.length !== 1) failures.push('room metadata builder should expose tool_events');
if (!Array.isArray(metadata.delegated_subagents) || metadata.delegated_subagents.length !== 1) failures.push('room metadata builder should expose delegated_subagents');
if ((metadata.observedEval as any)?.score !== 84) failures.push('room metadata builder should expose observedEval');

if (failures.length) {
  console.error('Room message metadata failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Room message metadata checks passed.');
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
      path.join(projectRoot, 'src/lib/computerUse.ts'),
      path.join(projectRoot, 'src/lib/messageMetadataReaders.ts'),
      path.join(projectRoot, 'src/lib/persistedChatMetadata.ts'),
      path.join(projectRoot, 'src/lib/roomMessageMetadata.ts'),
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
