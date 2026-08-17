import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getAgentPanelGroups,
  getAgentPanelTabs,
  getFallbackAgentPanelTab,
  resolveAgentPanelRuntimeConnectionId,
  type AgentPanelCapabilities,
} from '../src/screens/circles/tabs/office/AgentPanelTabs';
import { resolveOfficeAgentExecutionTruth } from '../src/lib/officeAgents';

type PanelAgent = Parameters<typeof getAgentPanelTabs>[0];

const standardAgent = {
  id: 'agent-standard',
  providerType: 'claude-code',
} as PanelAgent;
const openSwanAgent = {
  id: 'agent-openswan',
  providerType: 'openswan',
} as PanelAgent;
const builtInOpenSwan = {
  id: 'default::blackswan',
  providerType: 'blackswan-local',
  connectionId: 'default',
} as PanelAgent;
const openSwanConnection = (id: string) => ({
  id,
  provider: 'openswan',
  enabled: true,
  status: 'connected',
  endpoint: 'http://localhost:18790',
  token: `token-${id}`,
}) as any;
const fullCapabilities: AgentPanelCapabilities = {
  hasCircleContext: true,
  hasIdentityAuthority: true,
  canCustomize: true,
  hasRuntimeConnection: true,
};
const restrictedCapabilities: AgentPanelCapabilities = {
  hasCircleContext: false,
  hasIdentityAuthority: false,
  canCustomize: false,
  hasRuntimeConnection: true,
};

const fullTabs = getAgentPanelTabs(openSwanAgent, fullCapabilities);
const fullGroups = getAgentPanelGroups(fullTabs);
assert.deepEqual(
  fullGroups.map(group => group.key),
  ['overview', 'work', 'runtime', 'more'],
  'the agent panel exposes four stable primary destinations',
);
assert.deepEqual(
  fullGroups.map(group => [group.key, group.tabs.map(tab => tab.key)]),
  [
    ['overview', ['overview']],
    ['work', ['activity', 'runs', 'memory']],
    ['runtime', ['openswan', 'terminal', 'cron']],
    ['more', ['spirit', 'evolution', 'customize']],
  ],
  'existing section keys are retained as contextual routes under one owner',
);
assert.equal(
  new Set(fullGroups.flatMap(group => group.tabs.map(tab => tab.key))).size,
  fullTabs.length,
  'each available route belongs to exactly one destination',
);

const restrictedTabs = getAgentPanelTabs(openSwanAgent, restrictedCapabilities);
const restrictedKeys = restrictedTabs.map(tab => tab.key);
for (const unavailable of ['memory', 'runs', 'evolution', 'cron', 'terminal', 'spirit', 'customize']) {
  assert(!restrictedKeys.includes(unavailable as any), `${unavailable} is hidden when its render authority is unavailable`);
}
assert(!restrictedKeys.includes('openswan'), 'the OpenSwan runtime route stays hidden without exact private connection authority');
assert.deepEqual(
  restrictedKeys,
  ['overview', 'activity'],
  'a locked panel exposes only routes that can render verified read-only state',
);

assert.deepEqual(
  resolveOfficeAgentExecutionTruth({
    status: 'active',
    statusNote: 'bridge disconnected',
    currentToolName: 'Write',
    currentToolFile: '/tmp/stale.ts',
    activity: 'Editing stale.ts',
  }),
  {
    state: 'warning',
    statusWarning: 'bridge disconnected',
    currentToolName: '',
    currentToolFile: '',
    activity: '',
  },
  'a bridge warning suppresses retained tool fields before Activity can claim live execution',
);
assert.equal(
  resolveOfficeAgentExecutionTruth({
    status: 'offline',
    currentToolName: 'Write',
    currentToolFile: '/tmp/stale.ts',
    activity: 'Editing stale.ts',
  }).state,
  'unavailable',
  'an offline agent cannot become active from stale tool fields',
);
assert.deepEqual(
  resolveOfficeAgentExecutionTruth({
    status: 'active',
    currentToolName: 'Write',
    currentToolFile: '/tmp/live.ts',
    activity: 'Editing live.ts',
  }),
  {
    state: 'active',
    statusWarning: '',
    currentToolName: 'Write',
    currentToolFile: '/tmp/live.ts',
    activity: 'Editing live.ts',
  },
  'verified active execution retains its current tool evidence',
);
assert.deepEqual(
  getAgentPanelGroups(restrictedTabs).map(group => group.key),
  ['overview', 'work'],
  'empty Runtime and More destinations disappear instead of opening locked sections',
);
assert.equal(
  getFallbackAgentPanelTab(openSwanAgent, 'cron', restrictedCapabilities),
  'overview',
  'an unavailable deep route falls back to Overview instead of rendering blank content',
);
assert(
  !getAgentPanelTabs(standardAgent, fullCapabilities).some(tab => tab.key === 'openswan' || tab.key === 'cron'),
  'provider-specific runtime routes never appear for an incompatible provider',
);
assert(
  !getAgentPanelTabs({ ...openSwanAgent, connectionId: 'db-agent' } as PanelAgent, {
    ...fullCapabilities,
    hasRuntimeConnection: false,
  }).some(tab => tab.key === 'openswan' || tab.key === 'cron'),
  'a DB-only OpenSwan presentation row does not expose unusable live-runtime routes',
);
assert.deepEqual(
  getAgentPanelTabs(standardAgent, {
    ...fullCapabilities,
    hasIdentityAuthority: false,
  }).map(tab => tab.key),
  ['overview', 'activity'],
  'generic and bridge agents do not expose private identity editors before exact authority is ready',
);
assert(
  getAgentPanelTabs(standardAgent, fullCapabilities).some(tab => tab.key === 'terminal' || tab.key === 'spirit' || tab.key === 'customize'),
  'the same identity-backed routes appear once exact circle authority is verified',
);
assert.equal(resolveAgentPanelRuntimeConnectionId(builtInOpenSwan, []), null, 'built-in OpenSwan exposes no runtime route without a connection');
assert.equal(resolveAgentPanelRuntimeConnectionId(builtInOpenSwan, [openSwanConnection('conn-a')]), 'conn-a', 'built-in OpenSwan may use one unambiguous exact connection');
assert.equal(
  resolveAgentPanelRuntimeConnectionId(builtInOpenSwan, [{ ...openSwanConnection('local-proxy'), token: '' }]),
  'local-proxy',
  'the canonical localhost proxy may rely on its own gateway-token injection',
);
assert.equal(
  resolveAgentPanelRuntimeConnectionId(builtInOpenSwan, [{ ...openSwanConnection('loopback-proxy'), endpoint: 'http://127.0.0.1:18790', token: '' }]),
  'loopback-proxy',
  'the canonical numeric loopback proxy may be tokenless',
);
for (const connection of [
  { ...openSwanConnection('remote-tokenless'), endpoint: 'https://runtime.example.com', token: '' },
  { ...openSwanConnection('direct-tokenless'), endpoint: 'http://localhost:18789', token: '' },
  { ...openSwanConnection('masked-proxy'), token: '***' },
]) {
  assert.equal(
    resolveAgentPanelRuntimeConnectionId(builtInOpenSwan, [connection]),
    null,
    `${connection.id} cannot widen the tokenless local-proxy exception`,
  );
}
assert.equal(resolveAgentPanelRuntimeConnectionId(builtInOpenSwan, [openSwanConnection('conn-a'), openSwanConnection('conn-b')]), null, 'built-in OpenSwan never guesses between multiple connected runtimes');
assert.equal(
  resolveAgentPanelRuntimeConnectionId({ ...openSwanAgent, connectionId: 'conn-b' } as PanelAgent, [openSwanConnection('conn-a'), openSwanConnection('conn-b')]),
  'conn-b',
  'a live OpenSwan session retains its exact connection route',
);

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const shell = read('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const terminal = read('src/screens/circles/tabs/office/AgentTerminalPanels.tsx');
const runs = read('src/screens/circles/tabs/office/AgentRunsPanel.tsx');
const activity = read('src/screens/circles/tabs/office/AgentActivityPanel.tsx');
const evolution = read('src/screens/circles/tabs/office/AgentEvolutionPanel.tsx');
const progression = read('src/lib/progression.ts');
const xpFeed = read('src/components/rpg/XPEventFeed.tsx');
const office = read('src/screens/circles/tabs/OfficeTab.tsx');
const customize = read('src/screens/circles/tabs/office/AgentCustomizePanel.tsx');
const gateway = read('src/screens/circles/tabs/office/AgentGatewayPanels.tsx');

for (const marker of [
  'requestGenerationRef',
  "setState({ status: 'error', module: null })",
  '<LazySectionState',
  'onRetry={gatewayPanels.retry}',
  "scopeKey: panelScopeKey, tab: 'overview'",
  "panelRoute.scopeKey === panelScopeKey ? panelRoute.tab : 'overview'",
  'identityAuthority?.generation',
  'hasRuntimeConnection: !!agent && !!runtimeConnectionId',
  'const contentKey = `${panelScopeKey}:${panelTab}`;',
  'tabGroups={tabGroups}',
  'const openAgentInChat = onOpenAgentInChat && chatAgentTargetIdFromOfficeAgentId(chatAgentId)',
  'onOpenInChat={openAgentInChat}',
  'isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}',
  "agent.providerType === 'claude-code' && onRunCommand",
  'onResizeSideBy={resizeSideBy}',
  'AccessibilityInfo.isReduceMotionEnabled()',
]) {
  assert(panel.includes(marker), `AgentPanel wires ${marker}`);
}
assert(!panel.includes('requestIdleCallback'), 'panel chunks are not speculatively prefetched');
assert(!panel.includes('error.message'), 'lazy-section copy never exposes a raw loader error');
assert(!shell.includes('error.message'), 'render-boundary copy never exposes a raw child error');
assert(
  activity.includes('const executionTruth = resolveOfficeAgentExecutionTruth(agent);')
    && activity.includes("executionTruth.state === 'warning'")
    && activity.includes('Runtime status warning: ${executionTruth.statusWarning}. Refresh the connection before assigning new work.')
    && activity.includes('setInspectOpen(false);')
    && activity.includes('[agent.id, agent.sessionKey, agent.connectionId]'),
  'Activity never calls a bridge-disconnected agent available and retires raw diagnostics on subject changes',
);

for (const marker of [
  "role: 'tablist'",
  "role: 'tabpanel'",
  "'aria-controls': 'uc-agent-panel-tabpanel'",
  "'aria-labelledby': activeTabLabelId",
  "['ArrowLeft', 'ArrowRight', 'Home', 'End']",
  '<TabErrorBoundary key={contentKey}',
  "panelMode === 'center' && (",
  "className: 'uc-agent-panel-backdrop'",
  '@media (prefers-reduced-motion: reduce)',
  'accessibilityRole="adjustable"',
]) {
  assert(shell.includes(marker), `AgentPanelShell wires ${marker}`);
}

assert(
  terminal.includes('Chat owns the durable message, approvals, run, proof, and recovery trail.')
    && terminal.includes('onOpenInChat(message)')
    && !terminal.includes('sendTerminalAgentSessionMessage')
    && !terminal.includes('getSwanBotResponse')
    && !terminal.includes('ps aux --sort=-%cpu')
    && !terminal.includes('launchClaudeCodeSessions')
    && !terminal.includes('launchCodexSessions')
    && !terminal.includes('launchGeminiCliSessions')
    && terminal.includes('CONTINUE LAUNCH IN CHAT'),
  'Terminal carries task drafts into Chat and exposes only allowlisted read diagnostics',
);
assert(
  terminal.includes('Rename this agent once from Overview.')
    && !terminal.includes('onRenameAgent?:')
    && !terminal.includes('customName: cleanName'),
  'Terminal profile does not own a second rename transaction',
);
assert(
  runs.includes('Presentation-only liveness projection')
    && !runs.includes("reapRun(runId, 'heartbeat_stale')")
    && !runs.includes('<ScrollView'),
  'Runs remains a read-only projection under the shell scroll owner',
);
assert(
  activity.includes('Inspect session details')
    && activity.includes('accessibilityState={{ expanded: inspectOpen }}')
    && activity.includes('{inspectOpen ? <View'),
  'raw session ids and message logs stay behind an accessible Inspect disclosure',
);
assert(
  evolution.includes('getAgentProgression(userId, agentId, circleId, exactAgentIds, {')
    && evolution.includes('isAuthorityCurrent: isIdentityAuthorityCurrent')
    && evolution.includes('strict: true')
    && evolution.includes('loadMissionStreakExact(capturedAuthority, isIdentityAuthorityCurrent)')
    && evolution.includes('agentIds={exactAgentIds}')
    && evolution.includes('identityAuthority={exactAuthority}')
    && progression.includes("masteryQuery.eq('circle_id', circleId)")
    && progression.includes("unlockQuery.eq('circle_id', circleId)")
    && progression.includes("if (read?.strict) throw new Error('Agent bond progression storage is unavailable.')")
    && progression.includes("error?.code === '42P01'")
    && !progression.includes("message.includes(relation.toLowerCase())")
    && xpFeed.includes("query.in('agent_id', exactAgentIds)")
    && xpFeed.includes("setLoadState('error')")
    && xpFeed.includes('Retry loading XP events'),
  'Evolution resolves progression, streaks, and XP through the exact circle and agent aliases',
);
assert(
  office.includes('The popup is a live projection of the canonical roster')
    && office.includes('displayAgents.find(candidate => candidate.id === previous.id)'),
  'the open popup follows the live roster instead of retaining a click-time snapshot',
);
assert(
  office.includes('authority.accessToken !== authSession?.access_token')
    && office.includes('authority.accessToken === authSession?.access_token'),
  'the panel authority fails closed during same-user access-token rotation before effects commit',
);
assert(
  panel.includes('onAppearanceChange?: (id: string, appearance: AgentAppearance) => Promise<boolean>')
    && office.includes('const receipt = await updateAgentIdentityExact(')
    && office.includes('!receipt.ok || !receipt.localSaved || !receipt.serverSaved')
    && office.includes('return isOfficeAuthorityCurrent(requestedAuthority)')
    && customize.includes('onAppearanceChange: (id: string, appearance: AgentAppearance) => Promise<boolean>')
    && customize.includes('if (saved !== true)')
    && customize.includes("label: '✕ NOT SAVED — TRY AGAIN'")
    && !customize.includes('optimistically report'),
  'Customize reports SAVED only after the exact durable identity receipt resolves',
);
assert(
  gateway.includes('const cleared = await clearOfficeAgentSessionBinding(')
    && gateway.includes('if (!cleared) throw new Error('),
  'OpenSwan unlink success requires a truthful clear receipt',
);

console.log('office agent panel router smoke passed');
