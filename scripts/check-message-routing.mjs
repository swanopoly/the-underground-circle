#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: projectRoot,
      stdio: 'pipe',
      ...opts,
    });
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
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-routing-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

  const runnerSource = `
import { analyzeMessageRouting } from '../src/lib/messageRouting';

declare const process: { exit(code?: number): never; stdout: { write(chunk: string): void } };

type Case = {
  name: string;
  message: string;
  recentHistory?: string[];
  expectedIntent: string;
  expectedComplexity: string;
  expectedUseRuntime?: boolean;
  expectedEntitySummary?: Partial<Record<'stackTraces' | 'codeBlocks' | 'filePaths' | 'githubRefs' | 'errorCodes', number>>;
};

const cases: Case[] = [
  {
    name: 'casual greeting stays trivial',
    message: 'hello',
    expectedIntent: 'casual',
    expectedComplexity: 'trivial',
    expectedUseRuntime: false,
  },
  {
    name: 'stack trace routes to debug with runtime',
    message: 'TypeError: Cannot read properties of undefined\\n    at render (src/app.tsx:12:4)',
    expectedIntent: 'debug',
    expectedComplexity: 'moderate',
    expectedUseRuntime: true,
    expectedEntitySummary: { stackTraces: 2, filePaths: 1, errorCodes: 1 },
  },
  {
    name: 'github review request stays review',
    message: 'Review PR #456 and check src/lib/router.ts for regressions',
    expectedIntent: 'review',
    expectedComplexity: 'moderate',
    expectedUseRuntime: true,
    expectedEntitySummary: { githubRefs: 1, filePaths: 1 },
  },
  {
    name: 'short follow-up inherits prior debug thread',
    message: 'fix it',
    recentHistory: ['The app crashes with ECONNREFUSED and a stack trace in src/net.ts'],
    expectedIntent: 'debug',
    expectedComplexity: 'simple',
    expectedUseRuntime: false,
  },
  {
    name: 'research comparison stays research',
    message: 'Compare Cursor, Codex, and Claude Code for code review workflows',
    expectedIntent: 'research',
    expectedComplexity: 'complex',
    expectedUseRuntime: true,
  },
];

const failures: string[] = [];

for (const testCase of cases) {
  const result = analyzeMessageRouting(testCase.message, 'main_chat', testCase.recentHistory);
  if (result.route.intent !== testCase.expectedIntent) {
    failures.push(\`\${testCase.name}: expected intent \${testCase.expectedIntent}, got \${result.route.intent}\`);
  }
  if (result.route.complexity !== testCase.expectedComplexity) {
    failures.push(\`\${testCase.name}: expected complexity \${testCase.expectedComplexity}, got \${result.route.complexity}\`);
  }
  if (typeof testCase.expectedUseRuntime === 'boolean' && result.route.useRuntime !== testCase.expectedUseRuntime) {
    failures.push(\`\${testCase.name}: expected useRuntime \${String(testCase.expectedUseRuntime)}, got \${String(result.route.useRuntime)}\`);
  }
  if (testCase.expectedEntitySummary) {
    for (const [key, minCount] of Object.entries(testCase.expectedEntitySummary)) {
      const actual = (result.entities as any)[key]?.length || 0;
      if (actual < (minCount || 0)) {
        failures.push(\`\${testCase.name}: expected at least \${minCount} \${key}, got \${actual}\`);
      }
    }
  }
}

if (failures.length) {
  console.error('Routing regression failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Routing regression checks passed for ' + cases.length + ' cases.');
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
      path.join(projectRoot, 'src/lib/agenticCodingProfile.ts'),
      path.join(projectRoot, 'src/lib/messageEntityExtractor.ts'),
      path.join(projectRoot, 'src/lib/messageRouting.ts'),
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
