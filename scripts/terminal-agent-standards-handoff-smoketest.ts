/**
 * terminal-agent-standards-handoff-smoketest
 *
 * Verifies that managed terminal-agent bridge paths are wired to carry the
 * applicable agent development standards without importing React Native bridge
 * environment code into this Node smoke path.
 *
 * Run: npm run smoke:terminal-agent-standards-handoff
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

import { applyAgentDevelopmentStandardsToPrompt } from '../src/lib/agentDevelopmentStandards';

const require = createRequire(import.meta.url);
const {
  appendOpenSwanWorktreeConfigPrompt,
} = require('./terminal-launch-utils');

let failures = 0;
function fail(message: string) { failures += 1; console.error('FAIL:', message); }
function pass(message: string) { console.log('pass:', message); }
function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

function main() {
  const repoRoot = resolve(__dirname, '..');
  const dispatcher = readFileSync(resolve(repoRoot, 'src/lib/bridgeTaskDispatcher.ts'), 'utf8');
  const launcher = readFileSync(resolve(repoRoot, 'src/lib/terminalAgentSessionLauncher.ts'), 'utf8');

  const wrapped = applyAgentDevelopmentStandardsToPrompt('fix a bridge runtime bug');
  assert(wrapped.includes('=== AGENT DEVELOPMENT STANDARDS ==='), 'standards helper wraps terminal runtime task');
  assert(wrapped.includes('docs/TYPESCRIPT_AGENT_BEST_PRACTICES.md'), 'standards helper selects TypeScript runtime standard');

  assert(dispatcher.includes("import { applyAgentDevelopmentStandardsToPrompt } from './agentDevelopmentStandards';"),
    'bridge dispatcher imports standards wrapper');
  assert(dispatcher.includes('const profiledMessage = applyAgentDevelopmentStandardsToPrompt(message'),
    'terminal session sends profile messages before dispatch');
  assert(dispatcher.includes('body: JSON.stringify({ sessionId, message: profiledMessage })'),
    'terminal session send payload uses profiled message');
  assert(dispatcher.includes('const profiledPrompt = applyAgentDevelopmentStandardsToPrompt(prompt'),
    'direct bridge dispatch profiles delegated prompts');
  assert(dispatcher.includes('prompts: [profiledTask]'),
    'terminal launch payloads use profiled prompts');
  assert(launcher.includes('applyAgentDevelopmentStandardsToPrompt(prompt'),
    'chat-launched terminal sessions profile each launch prompt');
  assert(dispatcher.includes('const profiledTask = applyAgentDevelopmentStandardsToPrompt(task'),
    'direct terminal session launch profiles delegated task');

  const worktreePrompt = appendOpenSwanWorktreeConfigPrompt('fix a bridge runtime bug', repoRoot);
  assert(worktreePrompt.includes('SwanBot/OpenSwan Worktree Config'),
    'terminal launch utility appends OpenSwan worktree config');
  assert(worktreePrompt.includes('status:'),
    'terminal launch utility config block includes status');
  assert(appendOpenSwanWorktreeConfigPrompt(worktreePrompt, repoRoot) === worktreePrompt,
    'terminal launch utility does not duplicate OpenSwan worktree config');

  const bridgeSources = [
    readFileSync(resolve(repoRoot, 'scripts/claude-bridge.js'), 'utf8'),
    readFileSync(resolve(repoRoot, 'scripts/codex-bridge.js'), 'utf8'),
    readFileSync(resolve(repoRoot, 'scripts/cursor-bridge.js'), 'utf8'),
    readFileSync(resolve(repoRoot, 'scripts/gemini-bridge.js'), 'utf8'),
  ].join('\n');
  const attachmentCalls = bridgeSources.match(/appendOpenSwanWorktreeConfigPrompt/g) || [];
  assert(attachmentCalls.length >= 8,
    'all managed terminal bridge launchers import and call OpenSwan worktree config attachment',
    `found ${attachmentCalls.length}`);

  if (failures > 0) {
    console.error(`\n${failures} terminal-agent standards handoff smoke-test failure(s)`);
    process.exit(1);
  }

  console.log('\nAll terminal-agent standards handoff smoke cases passed.');
}

main();
