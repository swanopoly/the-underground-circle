/**
 * terminal-agent-launch-smoketest — pure parser/formatter coverage for
 * launching local terminal agents from chat. No bridges are called.
 *
 * Run: npm run smoke:terminal-agent-launch
 */
import {
  formatTerminalAgentLaunchResponse,
  parseTerminalAgentLaunchRequest,
} from '../src/lib/terminalAgentLaunchParser';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' - ' + detail : ''}`);
}

function main() {
  const claude = parseTerminalAgentLaunchRequest('Start 10 seperate Claude Code sessions in my terminal');
  assert(claude?.provider === 'claude-code', 'Claude Code provider detected');
  assert(claude?.count === 10, 'Claude Code count=10 with misspelled separate');
  assert(claude?.names[0] === 'Claude Code #1', 'Claude Code names generated');

  const single = parseTerminalAgentLaunchRequest('start a Claude Code session in my terminal');
  assert(single?.count === 1, 'single Claude Code command defaults count=1');
  assert(single?.names[0] === 'Claude Code', 'single session keeps canonical Office name');

  const codex = parseTerminalAgentLaunchRequest('launch 3 codex terminals with prompts: 1. auth audit 2. cost audit 3. bridge audit');
  assert(codex?.provider === 'codex', 'Codex provider detected');
  assert(codex?.prompts[2] === 'bridge audit', 'Codex inline prompt list parsed');

  const gemini = parseTerminalAgentLaunchRequest([
    'spin up two Gemini CLI agents with prompts:',
    '1. summarize the docs',
    '2. check the release plan',
  ].join('\n'));
  assert(gemini?.provider === 'gemini', 'Gemini provider detected');
  assert(gemini?.count === 2, 'Gemini word count parsed');
  assert(gemini?.prompts[0] === 'summarize the docs', 'Gemini numbered prompt parsed');

  const unrelated = parseTerminalAgentLaunchRequest('can Claude Code explain terminal agents?');
  assert(unrelated === null, 'non-launch question ignored');

  const summary = formatTerminalAgentLaunchResponse(claude!, {
    ok: true,
    sessions: [],
    launched: 10,
    failed: [],
    projectDir: '/tmp/project',
  });
  assert(summary.includes('Started 10/10 Claude Code terminal sessions.'), 'summary includes Claude Code launched count');
  assert(summary.includes('Registered in Office as Claude Code #1'), 'summary includes Office registration');

  if (failures > 0) {
    console.error(`\n${failures} terminal-agent-launch smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll terminal-agent-launch smoke cases passed.');
}

main();
