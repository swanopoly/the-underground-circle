/**
 * chat-agent-targets-smoketest — pure coverage for the chat agent selector
 * rendered under the OpenSwan composer button.
 *
 * Run: npm run smoke:chat-agent-targets
 */
import {
  DEFAULT_CHAT_AGENT_TARGET_ID,
  buildChatAgentSetupMessage,
  buildChatAgentTargets,
  formatChatAgentProviderLabel,
  normalizeChatAgentProvider,
  resolveChatAgentTarget,
  type ChatAgentLike,
  type ChatAgentTarget,
} from '../src/lib/chatAgentTargets';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' - ' + detail : ''}`);
}

function findProvider(targets: ChatAgentTarget<ChatAgentLike>[], provider: string) {
  return targets.find((target) => target.provider === provider);
}

function main() {
  const defaults = buildChatAgentTargets([]);
  assert(defaults[0]?.id === DEFAULT_CHAT_AGENT_TARGET_ID, 'OpenSwan default appears first');
  assert(findProvider(defaults, 'cursor')?.label === 'Cursor Composer', 'Cursor Composer preset is present');
  assert(findProvider(defaults, 'opencode')?.label === 'OpenCode', 'OpenCode preset is present');
  assert(findProvider(defaults, 'generic-agent')?.label === 'Custom Agent', 'custom agent preset is present');
  assert(findProvider(defaults, 'cursor')?.connected === false, 'unconnected presets are setup-required');

  const agents: ChatAgentLike[] = [
    {
      id: 'default::blackswan',
      name: 'OpenSwan',
      provider: 'blackswan-local',
      status: 'active',
      color: '#ef4444',
    },
    {
      id: 'bridge::cursor::abc123',
      name: 'Cursor',
      provider: 'cursor',
      status: 'idle',
      color: '#8b5cf6',
      sessionKey: 'abc123',
      source: 'bridge-session',
      current_task: 'Update the design system',
    },
    {
      id: 'custom-open-code',
      name: 'My OpenCode',
      provider: 'open-code',
      status: 'building',
    },
  ];
  const targets = buildChatAgentTargets(agents);
  const cursor = findProvider(targets, 'cursor');
  const opencode = findProvider(targets, 'opencode');
  assert(cursor?.connected === true, 'connected Cursor Composer replaces setup preset');
  assert(cursor?.label === 'Cursor Composer', 'Cursor display name is upgraded to Cursor Composer');
  assert(cursor?.sessionKey === 'abc123', 'Cursor target carries session key');
  assert(opencode?.connected === true, 'OpenCode alias normalizes and connects');
  assert(formatChatAgentProviderLabel('cursor-composer') === 'Cursor Composer', 'cursor-composer label alias');
  assert(normalizeChatAgentProvider('open-code') === 'opencode', 'open-code provider alias');

  const selected = resolveChatAgentTarget(targets, cursor!.id);
  assert(selected.provider === 'cursor', 'selected Cursor target resolves by id');
  const fallback = resolveChatAgentTarget(targets, 'missing');
  assert(fallback.id === DEFAULT_CHAT_AGENT_TARGET_ID, 'missing selection falls back to OpenSwan');

  const setupMessage = buildChatAgentSetupMessage(findProvider(defaults, 'cursor')!);
  assert(setupMessage.includes('node scripts/cursor-bridge.js'), 'Cursor setup message names bridge command');

  if (failures > 0) {
    console.error(`\n${failures} chat-agent-targets smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll chat-agent-targets smoke cases passed.');
}

main();
