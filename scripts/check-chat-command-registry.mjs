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
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-command-registry-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

  const runnerSource = `
import {
  buildChatCommandHelpMessage,
  getMatchingChatCommands,
  inferChatCommandExecution,
  inferChatCommandRoute,
  matchesChatCommandRoute,
} from '../src/lib/chatCommandRegistry';
import {
  ALL_QUICK_ACTIONS,
  FEATURED_TOOL_ACTIONS,
  REGISTRY_BACKED_ACTION_SECTIONS,
  resolveQuickActionExecution,
} from '../src/lib/chatActions';

declare const process: { exit(code?: number): never; stdout: { write(chunk: string): void } };

const failures: string[] = [];

if (!matchesChatCommandRoute('/commands', 'help')) failures.push('/commands should match help route');
if (!matchesChatCommandRoute('/status', 'summary')) failures.push('/status should match summary route');
if (!matchesChatCommandRoute('/gh tree', 'github')) failures.push('/gh tree should match github route');
if (!matchesChatCommandRoute('/wp publish 42', 'wordpress')) failures.push('/wp publish should match wordpress route');
if (!matchesChatCommandRoute('/cron cancel abc123', 'schedule')) failures.push('/cron cancel should match schedule route');
if (!matchesChatCommandRoute('/browser plan inspect openai.com pricing', 'browser')) failures.push('/browser plan should match browser route');

const matches = getMatchingChatCommands('/gh');
if (!matches.some((entry) => entry.command === '/gh')) failures.push('slash lookup for /gh should include /gh');

const inferredGitHub = inferChatCommandRoute('show me the repo tree and recent pull requests');
if (inferredGitHub !== 'github') failures.push('natural-language github inference should prefer github route');

const inferredMission = inferChatCommandRoute('show mission progress and active tasks');
if (inferredMission !== 'mission') failures.push('natural-language mission inference should prefer mission route');

const execWiki = inferChatCommandExecution('search wiki React hooks');
if (!execWiki || execWiki.commandText !== '/wiki React hooks') failures.push('wiki execution inference should build /wiki command');

const execGithub = inferChatCommandExecution('show me the repo tree');
if (!execGithub || execGithub.commandText !== '/gh tree') failures.push('github execution inference should build /gh tree');

const execBrowser = inferChatCommandExecution('use browser to compare the pricing pages on openai.com and anthropic.com');
if (!execBrowser || execBrowser.routeId !== 'browser' || !execBrowser.commandText.startsWith('/browser plan ')) {
  failures.push('browser execution inference should build /browser plan command');
}

if (!ALL_QUICK_ACTIONS.some((item) => item.routeId === 'browser')) {
  failures.push('quick actions should expose a browser-capable route');
}
if (!FEATURED_TOOL_ACTIONS.some((item) => item.routeId === 'browser')) {
  failures.push('featured tool actions should expose a browser-capable route');
}
if (!REGISTRY_BACKED_ACTION_SECTIONS.some((section) => section.items.some((item) => item.routeId === 'browser'))) {
  failures.push('registry-backed action sections should expose a browser-capable route');
}
const browserQuickAction = resolveQuickActionExecution('/browser plan ');
if (browserQuickAction.routeId !== 'browser') {
  failures.push('quick action resolution should preserve browser route ids');
}

const help = buildChatCommandHelpMessage();
if (!help.includes('/schedule')) failures.push('help output should include /schedule');
if (!help.includes('/wp publish')) failures.push('help output should include /wp publish');

if (failures.length) {
  console.error('Chat command registry failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Chat command registry checks passed.');
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
      path.join(projectRoot, 'src/lib/chatActions.ts'),
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
