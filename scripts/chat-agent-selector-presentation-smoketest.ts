/**
 * Pure regression coverage for route-aware agent selector status copy.
 *
 * Run: npx tsx scripts/chat-agent-selector-presentation-smoketest.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { resolveChatAgentSelectorPresentation } from '../src/lib/chatAgentSelectorPresentation';

const normalChat = resolveChatAgentSelectorPresentation('none', {
  label: 'OpenSwan',
  provider: 'openswan',
  connected: true,
  status: 'active',
  isDefault: true,
});
assert.equal(normalChat.summaryLabel, 'Chat · OpenSwan available');
assert.equal(normalChat.openSwanRuntimeActive, false);
assert.equal(normalChat.targetStateLabel, 'OpenSwan available');
assert.equal(normalChat.stateLabel, 'available');
assert.ok(!normalChat.summaryLabel.toLowerCase().includes('off · active'));

const idleNormalChat = resolveChatAgentSelectorPresentation('none', {
  label: 'OpenSwan',
  provider: 'blackswan-local',
  connected: true,
  status: 'idle',
});
assert.equal(idleNormalChat.summaryLabel, 'Chat · OpenSwan available');

const talkRuntime = resolveChatAgentSelectorPresentation('talk', {
  label: 'OpenSwan',
  provider: 'openswan',
  connected: true,
  status: 'idle',
});
assert.equal(talkRuntime.summaryLabel, 'Talk · OpenSwan active');
assert.equal(talkRuntime.openSwanRuntimeActive, true);

const executeRuntime = resolveChatAgentSelectorPresentation('execute', {
  label: 'OpenSwan',
  provider: 'openswan',
  connected: true,
  status: 'active',
});
assert.equal(executeRuntime.summaryLabel, 'Execute · OpenSwan active');

const setupRequired = resolveChatAgentSelectorPresentation('none', {
  label: 'OpenSwan',
  provider: 'openswan',
  connected: false,
  status: 'setup_required',
});
assert.equal(setupRequired.summaryLabel, 'Chat · OpenSwan setup required');

const offline = resolveChatAgentSelectorPresentation('build', {
  label: 'OpenSwan',
  provider: 'openswan',
  connected: true,
  status: 'offline',
});
assert.equal(offline.summaryLabel, 'Build · OpenSwan offline');

const building = resolveChatAgentSelectorPresentation('none', {
  label: 'OpenSwan',
  provider: 'openswan',
  connected: true,
  status: 'building',
});
assert.equal(building.summaryLabel, 'Chat · OpenSwan building');
assert.equal(building.stateLabel, 'building');

const externalAgent = resolveChatAgentSelectorPresentation('none', {
  label: 'Claude Code',
  provider: 'claude-code',
  connected: true,
  status: 'active',
});
assert.equal(externalAgent.summaryLabel, 'Chat · Claude Code active');

const unknownMode = resolveChatAgentSelectorPresentation('future-mode', null);
assert.equal(unknownMode.summaryLabel, 'Chat · OpenSwan available');
assert.equal(unknownMode.openSwanRuntimeActive, false);

const chatTabSource = fs.readFileSync(
  path.join(process.cwd(), 'src/screens/circles/tabs/ChatTab.tsx'),
  'utf8',
);
assert.match(
  chatTabSource,
  /resolveChatAgentSelectorPresentation\(chatMode, selectedChatAgentTarget\)/,
  'ChatTab derives the visible selector copy from the route-aware presentation helper',
);
assert.match(
  chatTabSource,
  /\{selectedAgentPresentation\.summaryLabel\}/,
  'the compact OpenSwan trigger renders the non-contradictory summary label',
);
assert.match(
  chatTabSource,
  /const selectedAgentStatusLabel = selectedAgentPresentation\.stateLabel/,
  'the expanded control center reuses the same route-aware state',
);
assert.doesNotMatch(
  chatTabSource,
  /\{activeModeConfig\?\.label \|\| 'Mode'\} · \{selectedAgentStatusLabel\}/,
  'the old Off · active composition cannot return',
);
assert.match(
  chatTabSource,
  /accessibilityState=\{\{ expanded: showModePicker \}\}/,
  'the OpenSwan control trigger exposes expanded state',
);
assert.match(
  chatTabSource,
  /'aria-haspopup': 'dialog'[\s\S]*?'aria-controls': 'openswan-control-center-popup'/,
  'the trigger identifies its controlled dialog on web',
);
assert.match(
  chatTabSource,
  /nativeID="openswan-control-center-popup"[\s\S]*?role: 'dialog'/,
  'the expanded OpenSwan panel has a named dialog surface',
);
assert.doesNotMatch(
  chatTabSource,
  /e\.nativeEvent\?\.key === 'Tab'[\s\S]{0,320}?onModeChange\(/,
  'bare Tab never changes execution policy or traps focus in the composer',
);
assert.match(
  chatTabSource,
  /event\.key !== 'Escape'[\s\S]*?setShowModePicker\(false\)[\s\S]*?modeTriggerRef\.current\?\.focus/,
  'Escape closes the OpenSwan dialog and returns focus to its trigger',
);
assert.match(
  chatTabSource,
  /showModePicker[\s\S]*?modeCloseRef\.current\?\.focus/,
  'opening the dialog moves keyboard focus to its named close control',
);

console.log('chat-agent-selector-presentation smoke: 18 cases passed');
