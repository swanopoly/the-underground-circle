/**
 * Focused smoke for the Office Agent -> Chat exact-identity handoff.
 *
 * The handoff is navigation-only: Office builds a bounded entity handle,
 * Circle admits only chat+agent handles and assigns a monotonic request id,
 * and Chat applies the exact target after thread/draft hydration. It may seed a
 * bounded composer draft, but it must never submit a turn.
 *
 * Run: npx tsx scripts/office-agent-chat-handoff-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CHAT_AGENT_FOCUS_DRAFT_MAX,
  DEFAULT_CHAT_AGENT_TARGET_ID,
  buildChatAgentTargets,
  chatAgentTargetIdFromOfficeAgentId,
  normalizeChatAgentFocusDraft,
  resolveChatAgentFocusRequest,
} from '../src/lib/chatAgentTargets';
import { decodeEntityHandle, encodeEntityHandle } from '../src/lib/entityHandleCore';

const officePath = fileURLToPath(new URL('../src/screens/circles/tabs/OfficeTab.tsx', import.meta.url));
const circlePath = fileURLToPath(new URL('../src/screens/circles/CircleDetailScreen.tsx', import.meta.url));
const chatPath = fileURLToPath(new URL('../src/screens/circles/tabs/ChatTab.tsx', import.meta.url));
const gatewayPath = fileURLToPath(new URL('../src/screens/circles/tabs/office/AgentGatewayPanels.tsx', import.meta.url));
const terminalPath = fileURLToPath(new URL('../src/screens/circles/tabs/office/AgentTerminalPanels.tsx', import.meta.url));
const panelPath = fileURLToPath(new URL('../src/screens/circles/tabs/office/AgentPanel.tsx', import.meta.url));
const officeSource = readFileSync(officePath, 'utf8');
const circleSource = readFileSync(circlePath, 'utf8');
const chatSource = readFileSync(chatPath, 'utf8');
const gatewaySource = readFileSync(gatewayPath, 'utf8');
const terminalSource = readFileSync(terminalPath, 'utf8');
const panelSource = readFileSync(panelPath, 'utf8');

let passed = 0;
function check(condition: unknown, label: string): asserts condition {
  assert.ok(condition, label);
  passed += 1;
  console.log(`  ok ${passed}. ${label}`);
}

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(endIndex > startIndex, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

// Exact namespaced Office ids survive the established entity-handle format.
const sessionAgentId = 'connection-1::agent:main:release';
const encoded = encodeEntityHandle({ surface: 'chat', kind: 'agent', id: sessionAgentId });
assert.equal(encoded, `chat:agent:${sessionAgentId}`);
assert.deepEqual(decodeEntityHandle(encoded), {
  surface: 'chat',
  kind: 'agent',
  id: sessionAgentId,
});
check(true, 'Office agent id round-trips through chat:agent handle exactly');

assert.equal(
  chatAgentTargetIdFromOfficeAgentId('default::blackswan'),
  DEFAULT_CHAT_AGENT_TARGET_ID,
);
assert.equal(
  chatAgentTargetIdFromOfficeAgentId(sessionAgentId),
  `agent::${sessionAgentId}`,
);
check(true, 'default OpenSwan and non-default agents map to canonical Chat target ids');

const bridgeMappings = [
  ['cc::claude-session', 'agent::bridge::claude-code::claude-session', 'claude-code'],
  ['codex::codex-session', 'agent::bridge::codex::codex-session', 'codex'],
  ['cursor::cursor-session', 'agent::bridge::cursor::cursor-session', 'cursor'],
  ['gemini::gemini-session', 'agent::bridge::gemini::gemini-session', 'gemini'],
] as const;
const bridgeTargets = buildChatAgentTargets(bridgeMappings.map(([, targetId, provider]) => ({
  id: targetId.replace(/^agent::/, ''),
  name: 'Duplicate display name',
  provider,
  status: 'active',
})));
for (const [officeId, targetId] of bridgeMappings) {
  assert.equal(chatAgentTargetIdFromOfficeAgentId(officeId), targetId);
  assert.ok(bridgeTargets.some((target) => target.id === targetId && target.connected));
}
check(true, 'Claude, Codex, Cursor, and Gemini Office sessions resolve to their exact connected Chat targets');

const disconnectedTargets = buildChatAgentTargets([]);
assert.equal(chatAgentTargetIdFromOfficeAgentId('provider-main::codex'), 'preset::codex');
assert.ok(disconnectedTargets.some((target) => target.id === 'preset::codex' && target.status === 'setup_required'));
assert.equal(chatAgentTargetIdFromOfficeAgentId('provider-main::openswan'), DEFAULT_CHAT_AGENT_TARGET_ID);
assert.equal(chatAgentTargetIdFromOfficeAgentId('provider-main::zai'), null);
check(true, 'disconnected provider mains select a real setup target or fail closed when Chat has none');

const duplicateNameAgents = [
  { id: 'agent-a', name: 'Same display name' },
  { id: 'agent-b', name: 'Same display name' },
];
assert.deepEqual(
  duplicateNameAgents.map((agent) => chatAgentTargetIdFromOfficeAgentId(agent.id)),
  ['agent::agent-a', 'agent::agent-b'],
);
check(true, 'duplicate display names cannot collapse exact-id target selection');

for (const invalid of ['', 'contains a space', 'line\nbreak', 'x'.repeat(257), null, undefined]) {
  assert.equal(chatAgentTargetIdFromOfficeAgentId(invalid), null);
}
check(true, 'empty, unsafe, oversized, and non-string ids fail closed');

const first = resolveChatAgentFocusRequest(sessionAgentId, 7, 0);
assert.equal(first?.targetId, `agent::${sessionAgentId}`);
assert.equal(resolveChatAgentFocusRequest(sessionAgentId, 7, 7), null);
assert.equal(resolveChatAgentFocusRequest(sessionAgentId, 6, 7), null);
assert.equal(resolveChatAgentFocusRequest(sessionAgentId, 7.5, 0), null);
assert.equal(resolveChatAgentFocusRequest(sessionAgentId, 8, 7)?.requestId, 8);
check(true, 'focus requests apply only in strictly increasing positive integer order');

assert.equal(decodeEntityHandle('not-a-handle'), null);
assert.equal(decodeEntityHandle('chat:run:run-1')?.kind, 'run');
assert.equal(decodeEntityHandle('office:agent:agent-a')?.surface, 'office');
check(true, 'malformed, wrong-kind, and wrong-surface handles remain distinguishable');

assert.equal(normalizeChatAgentFocusDraft('  Review the release plan  '), 'Review the release plan');
assert.equal(normalizeChatAgentFocusDraft('first line\r\nsecond line'), 'first line\nsecond line');
assert.equal(normalizeChatAgentFocusDraft(`keep\u0000 this`), 'keep this');
assert.equal(normalizeChatAgentFocusDraft('x'.repeat(CHAT_AGENT_FOCUS_DRAFT_MAX + 1))?.length, CHAT_AGENT_FOCUS_DRAFT_MAX);
assert.equal(normalizeChatAgentFocusDraft(null), null);
check(true, 'optional multi-line drafts use the dedicated bounded Chat-handoff policy');

const officeHandoff = section(
  officeSource,
  'const handleOpenAgentInChat = useCallback',
  'const handleOpenAutomate = useCallback',
);
check(
  /encodeEntityHandle\(\{\s*surface: 'chat',\s*kind: 'agent',\s*id: agentId\s*\}\)/s.test(officeHandoff),
  'Office builds a chat+agent handle from the callback exact id',
);
check(
  officeHandoff.includes('normalizeChatAgentFocusDraft(draft) || undefined'),
  'Office preserves bounded multi-line panel drafts instead of applying the one-line quick-seed ceiling',
);
check(
  officeHandoff.indexOf('setSelectedAgent(null);') >= 0
    && officeHandoff.indexOf('setSelectedAgent(null);') < officeHandoff.indexOf('onOpenAgentInChat?.('),
  'Office retires the mounted modal before switching to Chat',
);
check(
  officeSource.includes('onOpenAgentInChat={onOpenAgentInChat ? handleOpenAgentInChat : undefined}'),
  'Office passes the canonical handoff adapter into AgentPanel',
);
check(
  panelSource.includes('chatAgentTargetIdFromOfficeAgentId(chatAgentId)')
    && panelSource.includes('onOpenInChat={openAgentInChat}'),
  'AgentPanel disables every Chat handoff when the Office identity has no resolvable Chat target',
);

const circleCapture = section(
  circleSource,
  'const captureCrossSurfaceFocus = useCallback',
  'useEffect(() => {',
);
check(
  circleCapture.includes("target === 'CHAT' && handle?.kind === 'agent' && handle.surface === 'chat'"),
  'Circle admits only a matching Chat agent handle for target selection',
);
check(
  circleCapture.includes('chatAgentFocusSequenceRef.current += 1'),
  'Circle assigns each admitted Chat focus a monotonic request id',
);
check(
  circleCapture.includes('normalizeChatAgentFocusDraft(rawDraft)'),
  'Circle validates optional draft text at the trust boundary',
);

const chatAdmission = section(
  chatSource,
  '// Navigation requests are exact-id and monotonically identified.',
  'const [agentName, setAgentNameState]',
);
check(
  chatAdmission.includes('resolveChatAgentFocusRequest(')
    && chatAdmission.includes('normalizeChatAgentFocusDraft(focusAgentDraft)')
    && chatAdmission.includes('setPendingAgentFocus({'),
  'Chat admits exact-id requests into a pending hydration-safe slot',
);

const chatApplication = section(
  chatSource,
  'const inputRef = useRef<TextInput>(null);',
  '// STOP button for OpenSwan typed-loop turns',
);
check(
  chatApplication.includes("threadLoadState.status !== 'ready'")
    && chatApplication.includes('threadLoadState.threadId !== activeThreadId'),
  'Chat waits for the selected thread and saved draft to hydrate',
);
check(
  chatApplication.includes('setSelectedChatAgentId(pendingAgentFocus.targetId)')
    && chatApplication.includes('setInput(pendingAgentFocus.draft)')
    && chatApplication.includes('inputRef.current?.focus()'),
  'Chat selects the exact target, optionally seeds the composer, and focuses it',
);
check(
  !/sendMessage\s*\(|addUserMessage\s*\(|dispatchAssignedAgentTask\s*\(/.test(chatApplication),
  'the focus application path cannot auto-send or dispatch a task',
);

check(
  circleSource.includes('focusAgentId={chatAgentFocus?.agentId || null}')
    && circleSource.includes('focusAgentRequestId={chatAgentFocus?.requestId || 0}'),
  'Circle carries the typed focus request into Chat props',
);
check(
  !/onOpenInChat\(taskInput\.trim\(\)\);\s*setTaskInput\(''\)/.test(gatewaySource)
    && !/onOpenInChat\(messageInput\.trim\(\)\);\s*setMessageInput\(''\)/.test(gatewaySource)
    && !/onOpenInChat\(`Delegate this to a subagent:[\s\S]+?\);\s*setSpawnInput\(''\)/.test(gatewaySource)
    && !/onOpenInChat\(message\);\s*setInput\(''\)/.test(terminalSource),
  'draft producers retain source text instead of clearing it before handoff admission is known',
);

console.log(`\noffice-agent-chat-handoff smoke: ${passed} checks passed`);
