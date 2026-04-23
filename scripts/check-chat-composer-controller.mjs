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
  const tempRoot = await fs.mkdtemp(path.join(projectRoot, '.tmp-chat-composer-check-'));
  const runnerPath = path.join(tempRoot, 'runner.ts');
  const tsconfigPath = path.join(tempRoot, 'tsconfig.json');
  const outDir = path.join(tempRoot, 'out');

  const runnerSource = `
import {
  canSubmitChatComposerInput,
  getChatComposerSlashToken,
  getSelectedChatSlashCommand,
  resolveWebComposerKeyAction,
  resolveWebComposerTextAction,
  shouldShowChatComposerSlashCommands,
} from '../src/lib/chatComposerController';
import type { ChatSlashCommand } from '../src/lib/chatSlashCommands';

declare const process: { exit(code?: number): never; stdout: { write(chunk: string): void } };

const failures: string[] = [];
const slashCommands: ChatSlashCommand[] = [
  { id: 'wp', routeId: 'wordpress', command: '/wp', insertText: '/wp ', title: 'WordPress', description: 'WordPress commands', category: 'wordpress' },
  { id: 'wiki', routeId: 'local_knowledge', command: '/wiki', insertText: '/wiki ', title: 'Wiki', description: 'Wiki search', category: 'knowledge' },
];

if (getChatComposerSlashToken('/wp help') !== '/wp') {
  failures.push('slash token should extract the first slash command token');
}
if (!shouldShowChatComposerSlashCommands({ input: '/wp', focused: true, commandCount: 2 })) {
  failures.push('slash commands should show for focused slash-only input');
}
if (shouldShowChatComposerSlashCommands({ input: 'hello', focused: true, commandCount: 2 })) {
  failures.push('slash commands should not show for normal text');
}
if (shouldShowChatComposerSlashCommands({ input: '/wp', focused: false, commandCount: 2 })) {
  failures.push('slash commands should not show when input is not focused');
}
if (!canSubmitChatComposerInput(' /wp help ')) {
  failures.push('non-empty input should be submit-eligible');
}
if (canSubmitChatComposerInput('   ')) {
  failures.push('blank input should not be submit-eligible');
}
if (resolveWebComposerTextAction('/wp help', '/wp help\\n') !== 'submit') {
  failures.push('newline after non-empty input should submit on web');
}
if (resolveWebComposerTextAction('   ', '   \\n') !== 'unchanged') {
  failures.push('newline after blank input should stay unchanged on web');
}
if (resolveWebComposerKeyAction({ key: 'ArrowDown', showSlashCommands: true }) !== 'navigate_down') {
  failures.push('ArrowDown should navigate slash suggestions');
}
if (resolveWebComposerKeyAction({ key: 'ArrowUp', showSlashCommands: true }) !== 'navigate_up') {
  failures.push('ArrowUp should navigate slash suggestions');
}
if (resolveWebComposerKeyAction({ key: 'Enter', showSlashCommands: true }) !== 'select_slash') {
  failures.push('Enter with slash suggestions should select the highlighted command');
}
if (resolveWebComposerKeyAction({ key: 'Enter', showSlashCommands: false }) !== 'submit') {
  failures.push('Enter without slash suggestions should submit');
}
if (resolveWebComposerKeyAction({ key: 'Enter', showSlashCommands: true, shiftKey: true }) !== 'none') {
  failures.push('Shift+Enter should not submit or select slash commands');
}
if (getSelectedChatSlashCommand(slashCommands, 1)?.command !== '/wiki') {
  failures.push('selected slash command should honor highlighted index');
}
if (getSelectedChatSlashCommand(slashCommands, 9)?.command !== '/wp') {
  failures.push('selected slash command should fall back to the first item');
}
if (getSelectedChatSlashCommand([], 0) !== null) {
  failures.push('selected slash command should be null for empty lists');
}

if (failures.length) {
  console.error('Chat composer controller failures:');
  for (const failure of failures) console.error('- ' + failure);
  process.exit(1);
}

console.log('Chat composer controller checks passed.');
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
      path.join(projectRoot, 'src/lib/chatComposerController.ts'),
      path.join(projectRoot, 'src/lib/chatSlashCommands.ts'),
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
