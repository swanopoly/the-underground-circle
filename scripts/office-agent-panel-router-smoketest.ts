import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  getAgentPanelGroups,
  getAgentPanelTabs,
  getFallbackAgentPanelTab,
  isAgentPanelRuntimeConnectionSnapshotCurrent,
  resolveAgentPanelRuntimeConnectionId,
  resolveAgentPanelRuntimeConnectionSnapshot,
  type AgentPanelCapabilities,
} from '../src/screens/circles/tabs/office/AgentPanelTabs';
import { resolveOpenSwanConnectionTransport } from '../src/lib/officeAgentSessionBindingCore';
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
  hasProgressionStorage: true,
  canCustomize: true,
  hasRuntimeConnection: true,
};
const restrictedCapabilities: AgentPanelCapabilities = {
  hasCircleContext: false,
  hasIdentityAuthority: false,
  hasProgressionStorage: false,
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

const progressionUnavailableCapabilities: AgentPanelCapabilities = {
  ...fullCapabilities,
  hasProgressionStorage: false,
};
const progressionUnavailableTabs = getAgentPanelTabs(openSwanAgent, progressionUnavailableCapabilities);
const progressionUnavailableKeys = progressionUnavailableTabs.map(tab => tab.key);
assert(!progressionUnavailableKeys.includes('evolution'), 'XP stays hidden until its storage contract is explicitly ready');
assert(
  progressionUnavailableKeys.includes('spirit') && progressionUnavailableKeys.includes('customize'),
  'a missing optional progression schema does not hide verified Spirit or Customize routes',
);
assert.deepEqual(
  getAgentPanelGroups(progressionUnavailableTabs)
    .find(group => group.key === 'more')
    ?.tabs.map(tab => tab.key),
  ['spirit', 'customize'],
  'More retains its usable routes while omitting only unavailable progression',
);
assert.equal(
  getFallbackAgentPanelTab(openSwanAgent, 'evolution', progressionUnavailableCapabilities),
  'overview',
  'a saved Evolution route falls back to Overview when progression storage is unavailable',
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
assert.deepEqual(
  resolveOpenSwanConnectionTransport({ ...openSwanConnection('local-proxy'), token: '' }),
  { endpoint: 'http://localhost:18790', token: '' },
  'the shared transport resolver preserves the exact tokenless browser proxy contract',
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
const connectedRuntimeSnapshot = resolveAgentPanelRuntimeConnectionSnapshot(
  builtInOpenSwan,
  [openSwanConnection('conn-a')],
);
assert.deepEqual(
  connectedRuntimeSnapshot,
  {
    connectionId: 'conn-a',
    agentBotId: null,
    normalizedEndpoint: 'http://localhost:18790/',
    status: 'connected',
  },
  'the panel captures a non-secret live runtime identity without copying its bearer token',
);
assert(
  isAgentPanelRuntimeConnectionSnapshotCurrent(connectedRuntimeSnapshot, [openSwanConnection('conn-a')]),
  'a captured runtime identity is current only while the same exact connection remains live',
);
assert(
  !isAgentPanelRuntimeConnectionSnapshotCurrent(connectedRuntimeSnapshot, [{
    ...openSwanConnection('conn-a'),
    status: 'disconnected',
  }]),
  'a durable disconnected connection cannot preserve a stale live runtime verdict',
);
assert(
  !isAgentPanelRuntimeConnectionSnapshotCurrent(connectedRuntimeSnapshot, [{
    ...openSwanConnection('conn-a'),
    endpoint: 'http://localhost:18791',
  }]),
  'replacing an endpoint in place retires the captured runtime fingerprint',
);
assert.equal(
  resolveAgentPanelRuntimeConnectionId({ ...openSwanAgent, connectionId: 'conn-b' } as PanelAgent, [openSwanConnection('conn-a'), openSwanConnection('conn-b')]),
  'conn-b',
  'a live OpenSwan session retains its exact connection route',
);

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const panel = read('src/screens/circles/tabs/office/AgentPanel.tsx');
const panelTabsSource = read('src/screens/circles/tabs/office/AgentPanelTabs.ts');
const shell = read('src/screens/circles/tabs/office/AgentPanelShell.tsx');
const terminal = read('src/screens/circles/tabs/office/AgentTerminalPanels.tsx');
const runs = read('src/screens/circles/tabs/office/AgentRunsPanel.tsx');
const activity = read('src/screens/circles/tabs/office/AgentActivityPanel.tsx');
const overview = read('src/screens/circles/tabs/office/AgentOverviewPanel.tsx');
const evolution = read('src/screens/circles/tabs/office/AgentEvolutionPanel.tsx');
const progression = read('src/lib/progression.ts');
const xpFeed = read('src/components/rpg/XPEventFeed.tsx');
const office = read('src/screens/circles/tabs/OfficeTab.tsx');
const customize = read('src/screens/circles/tabs/office/AgentCustomizePanel.tsx');
const gateway = read('src/screens/circles/tabs/office/AgentGatewayPanels.tsx');
const envExample = read('.env.example');
assert.equal(
  (gateway.match(/loadPanelOpenSwanConfigExact\(/g) || []).length,
  3,
  'Runtime and Schedules share one exact-storage plus live-snapshot config resolver',
);
assert(!gateway.includes('|| !match.token'), 'panel executors do not re-reject the canonical tokenless proxy');
assert(
  gateway.includes('matchesOpenSwanConnectionFingerprint(runtimeConnectionSnapshot, storedConnection)')
    && gateway.includes("const liveExactConnection: AgentConnection = { ...storedConnection, status: 'connected' };")
    && gateway.includes('isRuntimeConnectionSnapshotCurrent(runtimeConnectionSnapshot)')
    && gateway.includes('resolveOpenSwanConnectionTransport(liveExactConnection)'),
  'runtime config uses the exact-authority secret only after the current non-secret live fingerprint matches',
);
assert(
  gateway.includes("const [cronCapability, setCronCapability] = useState<'unknown' | 'supported' | 'unsupported'>('unknown');")
    && gateway.includes("setCronCapability('unsupported');")
    && gateway.includes('This verified OpenSwan runtime does not expose connection-level schedules.')
    && gateway.includes('accessibilityLabel="Schedule capability status"')
    && gateway.includes('cronCapability === \'unsupported\' || !hasVerifiedSnapshot ? null'),
  'verified unsupported cron capability renders a neutral accessible status without claiming an empty inventory',
);
assert(
  office.includes('const selectedAgentRuntimeConnectionCandidate = resolveAgentPanelRuntimeConnectionSnapshot(')
    && office.includes('const selectedAgentRuntimeConnectionIdCandidate = selectedAgentRuntimeConnectionCandidate?.connectionId || null;')
    && office.includes('const selectedAgentRuntimeConnectionSnapshot = useMemo<AgentPanelRuntimeConnectionSnapshot | null>(')
    && office.includes('selectedAgentRuntimeAgentBotIdCandidate,\n      selectedAgentRuntimeConnectionIdCandidate,\n      selectedAgentRuntimeEndpointCandidate,')
    && !office.includes('() => resolveAgentPanelRuntimeConnectionSnapshot(selectedAgent, connections),\n    [connections, selectedAgent],'),
  'Office preserves one runtime-snapshot object across equivalent roster and session polling replacements',
);

for (const marker of [
  'requestGenerationRef',
  "setState({ status: 'error', module: null })",
  '<LazySectionState',
  'onRetry={gatewayPanels.retry}',
  "scopeKey: panelScopeKey, tab: 'overview'",
  "panelRoute.scopeKey === panelScopeKey ? panelRoute.tab : 'overview'",
  'identityAuthority?.generation',
  'const hasRuntimeConnection = Boolean(',
  'runtimeConnectionSnapshot.connectionId === runtimeConnectionId',
  'isRuntimeConnectionSnapshotCurrent?.(runtimeConnectionSnapshot)',
  'const contentKey = `${panelScopeKey}:${panelTab}`;',
  'const executionTruth = resolveOfficeAgentExecutionTruth(agent);',
  "executionTruth.state === 'warning' ? '#f59e0b'",
  "executionTruth.state === 'warning' ? 'Needs refresh'",
  'tabGroups={tabGroups}',
  'const openAgentInChat = onOpenAgentInChat && chatAgentTargetIdFromOfficeAgentId(chatAgentId)',
  'onOpenInChat={openAgentInChat}',
  'isIdentityAuthorityCurrent={isExactIdentityAuthorityCurrent}',
  'spirit={agent.spirit || undefined}',
  "agent.providerType === 'claude-code' && onRunCommand",
  'onResizeSideBy={resizeSideBy}',
  'AccessibilityInfo.isReduceMotionEnabled()',
]) {
  assert(panel.includes(marker), `AgentPanel wires ${marker}`);
}
assert(
  panel.includes('}), [canCustomize, hasCircleContext, hasIdentityAuthority, hasRuntimeConnection]);')
    && panel.includes('const panelRoutingKey = agent ? `${agent.id}\\u0000${agent.providerType}` : \'closed\';')
    && panel.includes('[panelCapabilities, panelRoutingKey]'),
  'route capabilities and tab catalogs ignore live roster object churn',
);
assert(
  panel.includes('runtimeConnectionSnapshot={runtimeConnectionSnapshot}')
    && panel.includes('isRuntimeConnectionSnapshotCurrent={isRuntimeConnectionSnapshotCurrent}')
    && office.includes('const selectedAgentRuntimeConnectionCandidate = resolveAgentPanelRuntimeConnectionSnapshot(')
    && office.includes('selectedAgent,\n    connections,')
    && office.includes('isAgentPanelRuntimeConnectionSnapshotCurrent(snapshot, connectionsRef.current)')
    && office.includes('isOfficeAuthorityCurrent(connectionAuthority)'),
  'Office hands the popup a non-secret exact runtime snapshot with a live authority-and-connection fence',
);
assert(
  panel.includes("const HAS_AGENT_PROGRESSION_STORAGE_V1 = process.env.EXPO_PUBLIC_AGENT_PROGRESSION_STORAGE_V1 === 'true';")
    && panel.includes('hasProgressionStorage: HAS_AGENT_PROGRESSION_STORAGE_V1,')
    && panelTabsSource.includes('capabilities.hasProgressionStorage === true')
    && panelTabsSource.includes('hasPrivateScope && hasProgressionStorage ? [TAB_CATALOG.evolution] : []')
    && envExample.includes('EXPO_PUBLIC_AGENT_PROGRESSION_STORAGE_V1=false'),
  'the live XP route is default-off and requires one exact positive deployment-readiness flag',
);
assert(!panel.includes('requestIdleCallback'), 'panel chunks are not speculatively prefetched');
assert(!panel.includes('error.message'), 'lazy-section copy never exposes a raw loader error');
assert(!shell.includes('error.message'), 'render-boundary copy never exposes a raw child error');
assert(
  activity.includes('const executionTruth = resolveOfficeAgentExecutionTruth(agent);')
    && activity.includes("executionTruth.state === 'warning'")
    && activity.includes('Runtime status warning: ${executionTruth.statusWarning}. Refresh the connection before assigning new work.')
    && activity.includes("const liveExecutionEvidence = executionTruth.state === 'active';")
    && activity.includes('liveExecutionEvidence && ((agent.recentToolCalls?.length || 0) > 0')
    && activity.includes('liveExecutionEvidence && (agent.activeFiles?.length || 0) > 0')
    && activity.includes('setInspectOpen(false);')
    && activity.includes('[agent.id, agent.sessionKey, agent.connectionId]'),
  'Activity never calls a bridge-disconnected agent available, promotes retained work evidence, or leaves raw diagnostics open across subjects',
);
assert(
  overview.includes('const executionTruth = resolveOfficeAgentExecutionTruth(agent);')
    && overview.includes("executionTruth.state === 'warning'")
    && overview.includes("executionTruth.state === 'connected'")
    && overview.includes("executionTruth.state === 'unavailable'")
    && overview.includes("const hasEvidence = isWorking &&")
    && overview.includes('Refresh the connection before assigning new work.'),
  'Overview uses verified execution truth and suppresses retained work evidence for warning, idle, and offline agents',
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
  office.includes('selectedAgentRefreshRetentionRef')
    && office.includes('scope: floorLayoutScope, agentId: agent.id')
    && office.includes('if (retainedAgentSelection?.scope !== requestedScope)')
    && office.includes('const matchCount = displayAgents.reduce(')
    && office.includes('matchCount === 1')
    && office.includes('resolveUniqueOfficeAgentById(displayAgents, retained.agentId)')
    && office.includes('if (!current) selectedAgentRefreshRetentionRef.current = null;')
    && office.includes('selectedAgentRefreshRetentionRef.current = null;\n        setSelectedAgent(null);\n        setOfficeAccessError(membership.error);')
    && office.includes('onClose={clearSelectedAgentPanel}')
    && !office.includes('onClose={() => setSelectedAgent(null)}'),
  'same-scope token refresh retains only an agent id, then uniquely rebinds or closes fail-closed',
);
assert(
  office.includes('const rawAgents = useMemo<OfficeAgent[]>(() => {')
    && office.includes('return projected;\n  }, [connectedConns, currentUserId, mergedCircleAgents, ownDbCostRows, sessionsTick]);')
    && !office.includes('const rawAgents: OfficeAgent[] = [];'),
  'unrelated Office renders retain roster object identity so selected-agent synchronization cannot feed back forever',
);
assert(
  office.includes('authority.accessToken !== authSession?.access_token')
    && office.includes('authority.accessToken === authSession?.access_token'),
  'the panel authority fails closed during same-user access-token rotation before effects commit',
);
assert(
  panel.includes('onAppearanceChange?: (id: string, appearance: AgentAppearance) => Promise<AgentIdentityExactSaveResult>')
    && office.includes('const receipt = await updateAgentIdentityExact(')
    && office.includes('if (!receipt.ok || !receipt.localSaved || receipt.serverSaved !== true)')
    && office.includes('return receipt;')
    && office.includes('return isOfficeAuthorityCurrent(requestedAuthority)')
    && customize.includes('onAppearanceChange: (id: string, appearance: AgentAppearance) => Promise<AgentIdentityExactSaveResult>')
    && customize.includes("setSaveState('refresh-needed')")
    && customize.includes("setSaveState('outcome-unknown')")
    && customize.includes("label: '✕ NOT SAVED — TRY AGAIN'")
    && !customize.includes('optimistically report'),
  'Customize distinguishes complete, server-only, unknown, and failed exact identity receipts',
);
assert(
  gateway.includes('const clearResult = await clearOfficeAgentSessionBinding(')
    && gateway.includes('expectedBinding,')
    && gateway.includes('clearResult.receipt.resultBinding !== null'),
  'OpenSwan unlink success requires an expected-row CAS receipt with a missing postcondition',
);

console.log('office agent panel router smoke passed');
