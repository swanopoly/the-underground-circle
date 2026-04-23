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
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-openswan-mode-policy-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

  const runnerSource = `
import { buildOpenSwanModeResponseContract, OPENSWAN_MODE_POLICIES } from '../src/lib/openswanModePolicy';

declare const process: { exit(code?: number): never; stdout: { write(chunk: string): void } };

const failures: string[] = [];
const modes = ['talk', 'build', 'plan', 'execute', 'review', 'research', 'support', 'design'] as const;

for (const mode of modes) {
  const policy = OPENSWAN_MODE_POLICIES[mode];
  if (!policy.responseContract) {
    failures.push(mode + ' should define a response contract');
    continue;
  }
  if (policy.responseContract.structure.length < 2) {
    failures.push(mode + ' should define a meaningful response structure');
  }
  if (policy.responseContract.qualityBar.length < 2) {
    failures.push(mode + ' should define a quality bar');
  }
  if (policy.responseContract.avoid.length < 2) {
    failures.push(mode + ' should define explicit avoid rules');
  }
  const contract = buildOpenSwanModeResponseContract(mode);
  if (!contract.includes('Response structure:')) {
    failures.push(mode + ' contract should include a response structure section');
  }
  if (!contract.includes('Quality bar:')) {
    failures.push(mode + ' contract should include a quality bar section');
  }
  if (!contract.includes('Avoid:')) {
    failures.push(mode + ' contract should include an avoid section');
  }
}

const noneContract = buildOpenSwanModeResponseContract('none');
if (noneContract !== '') {
  failures.push('none mode should not inject an OpenSwan response contract');
}

if (failures.length) {
  console.error('OpenSwan mode policy failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('OpenSwan mode policy checks passed.');
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
      path.join(projectRoot, 'src/lib/openswanModePolicy.ts'),
      path.join(projectRoot, 'src/lib/agenticCodingProfile.ts'),
      path.join(projectRoot, 'src/lib/taskCapabilityProfiles.ts'),
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
