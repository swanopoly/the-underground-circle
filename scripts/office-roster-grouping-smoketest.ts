import Module from 'node:module';

import type { OfficeAgent } from '../src/lib/officeAgents';
import type { AgentConnection, ProviderType } from '../src/lib/connectionManager';
import type { AgentIdentity } from '../src/lib/agentIdentity';

process.env.EXPO_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= 'test-anon-key';

const originalLoad = (Module as any)._load;
(Module as any)._load = function loadWithReactNativeSmokeStubs(request: string, parent: unknown, isMain: boolean) {
  if (request === 'react-native') {
    return {
      Platform: {
        OS: 'web',
        select: (options: Record<string, unknown>) => options.web ?? options.default,
      },
    };
  }
  if (request === '@react-native-async-storage/async-storage') {
    const store = new Map<string, string>();
    return {
      __esModule: true,
      default: {
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => { store.set(key, value); },
        removeItem: async (key: string) => { store.delete(key); },
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function agent(overrides: Partial<OfficeAgent> & Pick<OfficeAgent, 'id' | 'name' | 'providerType'>): OfficeAgent {
  return {
    id: overrides.id,
    name: overrides.name,
    role: overrides.role || 'Agent',
    status: overrides.status || 'idle',
    color: overrides.color || '#6366f1',
    deskIndex: overrides.deskIndex || 0,
    activity: overrides.activity || 'Ready',
    messagesProcessed: overrides.messagesProcessed || 0,
    uptimeHours: overrides.uptimeHours || 0,
    uptime: overrides.uptime || 'recent',
    lastActive: overrides.lastActive || new Date().toISOString(),
    recentActions: overrides.recentActions || [],
    recentMessages: overrides.recentMessages || [],
    costToday: overrides.costToday || 0,
    costTotal: overrides.costTotal || 0,
    costWeek: overrides.costWeek || 0,
    tokensUsed: overrides.tokensUsed || 0,
    inputTokens: overrides.inputTokens || 0,
    outputTokens: overrides.outputTokens || 0,
    cachedTokens: overrides.cachedTokens || 0,
    newTokens: overrides.newTokens || 0,
    turns: overrides.turns || 0,
    sessionKey: overrides.sessionKey || overrides.id,
    model: overrides.model || 'test-model',
    connectionId: overrides.connectionId || `conn-${overrides.providerType}`,
    connectionName: overrides.connectionName || overrides.providerType,
    providerType: overrides.providerType,
    spirit: overrides.spirit,
    lastUserMessage: overrides.lastUserMessage,
    lastAssistantText: overrides.lastAssistantText,
    recentToolCalls: overrides.recentToolCalls,
    activeFiles: overrides.activeFiles,
    currentToolName: overrides.currentToolName,
    currentToolFile: overrides.currentToolFile,
    projectDir: overrides.projectDir,
    subagentCount: overrides.subagentCount,
    version: overrides.version,
    slug: overrides.slug,
    runtimeKind: overrides.runtimeKind,
    parentSessionKey: overrides.parentSessionKey,
    isSynthetic: overrides.isSynthetic,
    isProviderMain: overrides.isProviderMain,
  };
}

function connection(provider: ProviderType, overrides: Partial<AgentConnection> = {}): AgentConnection {
  return {
    id: overrides.id || `conn-${provider}`,
    name: overrides.name || provider,
    provider,
    endpoint: overrides.endpoint || 'http://localhost',
    token: overrides.token || '',
    enabled: overrides.enabled ?? true,
    status: overrides.status || 'connected',
    color: overrides.color || '#6366f1',
    error: overrides.error,
    lastConnected: overrides.lastConnected,
    sessionCount: overrides.sessionCount,
    agentIds: overrides.agentIds,
    remoteId: overrides.remoteId,
  };
}

function identity(sessionKey: string, overrides: Partial<AgentIdentity> = {}): AgentIdentity {
  const now = Date.now();
  return {
    sessionKey,
    totalCostAllTime: overrides.totalCostAllTime || 0,
    totalTokensAllTime: overrides.totalTokensAllTime || 0,
    totalSessionsAllTime: overrides.totalSessionsAllTime || 0,
    firstSeen: overrides.firstSeen || now,
    lastSeen: overrides.lastSeen || now,
    totalMessages: overrides.totalMessages || 0,
    totalTurns: overrides.totalTurns || 0,
    customName: overrides.customName,
    customColor: overrides.customColor,
    appearance: overrides.appearance,
    spiritId: overrides.spiritId,
    spiritEmoji: overrides.spiritEmoji,
    soulPrompt: overrides.soulPrompt,
    customProfileId: overrides.customProfileId,
    customProfileName: overrides.customProfileName,
    assignedFloorId: overrides.assignedFloorId,
    deskIndex: overrides.deskIndex,
    mostUsedModel: overrides.mostUsedModel,
    tags: overrides.tags,
    bondId: overrides.bondId,
    bondLevel: overrides.bondLevel,
    bondXP: overrides.bondXP,
    isPrimary: overrides.isPrimary,
    isCustomized: overrides.isCustomized,
    boundAiProvider: overrides.boundAiProvider,
    boundModel: overrides.boundModel,
    terminalConfig: overrides.terminalConfig,
    soulTraits: overrides.soulTraits,
  };
}

async function main(): Promise<void> {
  const older = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const recent = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { buildOfficeRoster } = await import('../src/lib/officeRoster');
  const { DEFAULT_AGENT, HUGGINGSWAN_AGENT } = await import('../src/lib/officeAgents');

  const codexMain = agent({
    id: 'codex-main',
    name: 'Codex Main',
    providerType: 'codex',
    status: 'building',
    runtimeKind: 'main',
    lastActive: recent,
  });
  const claudeMain = agent({
    id: 'claude-main',
    name: 'Claude Main',
    providerType: 'claude-code',
    status: 'active',
    runtimeKind: 'main',
    lastActive: recent,
  });
  const staleSelectedSubagent = agent({
    id: 'codex-subagent',
    name: 'Codex Subagent',
    providerType: 'codex',
    status: 'idle',
    runtimeKind: 'subagent',
    parentSessionKey: 'codex-main',
    lastActive: older,
  });
  const staleUnselectedSubagent = agent({
    id: 'codex-old-subagent',
    name: 'Codex Old Subagent',
    providerType: 'codex',
    status: 'idle',
    runtimeKind: 'subagent',
    parentSessionKey: 'codex-main',
    lastActive: older,
  });

  const roster = buildOfficeRoster({
    agents: [DEFAULT_AGENT, staleUnselectedSubagent, claudeMain, staleSelectedSubagent, codexMain, HUGGINGSWAN_AGENT],
    connections: [connection('opencode', { name: 'OpenCode Local' })],
    identities: new Map([
      ['provider-main:opencode', identity('provider-main:opencode', {
        customName: 'OpenCode Primary',
        isPrimary: true,
        boundAiProvider: 'opencode',
        boundModel: 'opencode/custom',
      })],
    ]),
    selectedAgentId: staleSelectedSubagent.id,
  });

  assert(roster[0]?.id === DEFAULT_AGENT.id, 'OpenSwan should stay first in Office roster');
  assert(roster[1]?.id === codexMain.id, 'building local Codex session should be the first local main after OpenSwan');
  assert(roster[2]?.id === claudeMain.id, 'active local Claude session should stay before local extras and synthetic provider mains');
  assert(roster.some(item => item.id === staleSelectedSubagent.id), 'selected local subagent should stay visible even when stale');
  assert((roster.findIndex(item => item.id === staleSelectedSubagent.id)) > 2, 'selected stale subagent should remain after local provider mains');
  assert(roster.some(item => item.id === 'provider-main::opencode'), 'connected persistent provider should get a synthetic provider main');
  assert(roster.find(item => item.id === 'provider-main::opencode')?.name === 'OpenCode Primary', 'synthetic provider main should use primary identity name');
  assert(!roster.some(item => item.id === HUGGINGSWAN_AGENT.id), 'HuggingSwan should not double-render as a standalone roster slot');
  assert(!roster.some(item => item.id === staleUnselectedSubagent.id), 'stale unselected subagent should be hidden');
  assert(roster.every((item, index) => item.deskIndex === index), 'desk indexes should match final roster order');

  // ─── Bridge-aware status reconcile (O2, P38) ───────────────────────────────
  // Fail-visible: a dead connection DEMOTES stale active/building + annotates;
  // fresh activity keeps status but still notes; never upgrades, never hides.
  const { reconcileAgentStatusWithConnection, BRIDGE_RECONCILE_STALE_MS } = await import('../src/lib/officeAgents');
  const T0 = Date.parse('2026-06-10T12:00:00.000Z');
  const staleIso = new Date(T0 - BRIDGE_RECONCILE_STALE_MS - 5_000).toISOString();
  const freshIso = new Date(T0 - 2_000).toISOString();

  // Direct unit behavior (fixed clock)
  const demoted = reconcileAgentStatusWithConnection(
    { status: 'active', lastActive: staleIso, connectionId: 'c1' }, 'disconnected', T0,
  );
  assert(demoted.status === 'offline', 'stale active + disconnected bridge should demote to offline');
  assert(demoted.statusNote === 'bridge offline — status stale', 'demotion should carry the fail-visible note');
  const freshKept = reconcileAgentStatusWithConnection(
    { status: 'building', lastActive: freshIso, connectionId: 'c1' }, 'error', T0,
  );
  assert(freshKept.status === 'building', 'fresh activity should keep its status despite a disagreeing bridge');
  assert(freshKept.statusNote === 'bridge disconnected', 'fresh-but-disagreeing should still note the bridge');
  const connectedOk = reconcileAgentStatusWithConnection(
    { status: 'active', lastActive: staleIso, connectionId: 'c1' }, 'connected', T0,
  );
  assert(connectedOk.status === 'active' && !connectedOk.statusNote, 'connected bridge should leave status untouched');
  const idleUntouched = reconcileAgentStatusWithConnection(
    { status: 'idle', lastActive: staleIso, connectionId: 'c1' }, 'disconnected', T0,
  );
  assert(idleUntouched.status === 'idle' && !idleUntouched.statusNote, 'idle is not misleading — untouched');
  const offlineNeverUpgraded = reconcileAgentStatusWithConnection(
    { status: 'offline', lastActive: freshIso, connectionId: 'c1' }, 'connected', T0,
  );
  assert(offlineNeverUpgraded.status === 'offline', 'reconcile never upgrades a status');
  const noConn = reconcileAgentStatusWithConnection(
    { status: 'active', lastActive: staleIso, connectionId: '' }, 'disconnected', T0,
  );
  assert(noConn.status === 'active' && !noConn.statusNote, 'agents without a connection are untouched');

  // Roster-level: dead codex bridge demotes its stale "active" main visibly.
  const staleRealIso = new Date(Date.now() - BRIDGE_RECONCILE_STALE_MS - 60_000).toISOString();
  const deadBridgeAgent = agent({
    id: 'codex-dead-bridge', name: 'Codex Dead', providerType: 'codex',
    status: 'active', runtimeKind: 'main', lastActive: staleRealIso,
  });
  const reconciledRoster = buildOfficeRoster({
    agents: [deadBridgeAgent],
    currentUserId: 'user-1',
    connections: [connection('codex', { status: 'disconnected' })],
  });
  const reconciledRow = reconciledRoster.find(item => item.id === 'codex-dead-bridge');
  assert(!!reconciledRow, 'reconciled agent should stay in the roster (never hidden)');
  assert(reconciledRow?.status === 'offline', 'roster should show the demoted status');
  assert(reconciledRow?.statusNote === 'bridge offline — status stale', 'roster row should carry the status note');
  const healthyRoster = buildOfficeRoster({
    agents: [deadBridgeAgent],
    currentUserId: 'user-1',
    connections: [connection('codex', { status: 'connected' })],
  });
  const healthyRow = healthyRoster.find(item => item.id === 'codex-dead-bridge');
  assert(healthyRow?.status === 'active' && !healthyRow?.statusNote, 'connected bridge leaves the roster row untouched');

  // ─── Synthetic pinned-agent live status (O8) ───────────────────────────────
  // Composition pin for the OfficeTab seam: pinned roster row → run evidence →
  // upgrade-only status/activity. UPGRADE is safe here (unlike the O2
  // demote-only reconcile) because live agent_runs rows are written by the
  // executing runtime itself — authoritative evidence work is happening.
  const {
    buildOfficeBuildingBoard,
    deriveSyntheticAgentStatusFromRuns,
    applySyntheticAgentStatusUpgrade,
    OPENSWAN_RUN_NAME_KEYS,
  } = await import('../src/lib/officeOpsBoard');
  const T1 = Date.now();
  const liveChatRun = {
    id: 'run-live-1',
    title: 'Ship the roadmap digest',
    status: 'running',
    surface: 'main_chat',
    started_at: new Date(T1 - 60_000).toISOString(),
    created_at: new Date(T1 - 60_000).toISOString(),
  };

  const applyO8 = (rosterRow: OfficeAgent, runs: Array<Record<string, unknown>>) => {
    const board = buildOfficeBuildingBoard(runs as any, { nowMs: T1 });
    const live = deriveSyntheticAgentStatusFromRuns(OPENSWAN_RUN_NAME_KEYS, board.building, T1);
    return applySyntheticAgentStatusUpgrade(rosterRow.status, live);
  };

  // Default pinned OpenSwan (baseline 'active'): status never demoted, but the
  // activity line now reflects the real live run instead of the static blurb.
  const pinnedDefault = buildOfficeRoster({ agents: [] })[0];
  assert(pinnedDefault?.id === DEFAULT_AGENT.id && pinnedDefault.isSynthetic === true, 'empty roster still pins synthetic OpenSwan first');
  const defaultUpgrade = applyO8(pinnedDefault, [liveChatRun]);
  assert(defaultUpgrade.changed && defaultUpgrade.status === 'active', 'live chat run keeps pinned OpenSwan active (never demoted)');
  assert(defaultUpgrade.activity === 'Working: Ship the roadmap digest', `live activity line should show the run, got: ${defaultUpgrade.activity}`);

  // DB-fed BlackSwan pin stuck 'idle' mid-task (the O8 gap): run evidence upgrades it.
  const idlePinned = agent({
    id: 'db::openswan-row', name: 'BlackSwan', providerType: 'blackswan-local',
    status: 'idle', isSynthetic: true, lastActive: recent,
  });
  const idleRoster = buildOfficeRoster({ agents: [idlePinned], currentUserId: 'user-1' });
  assert(idleRoster[0]?.id === idlePinned.id && idleRoster[0]?.status === 'idle', 'DB-fed BlackSwan row takes the pinned slot, still idle');
  const idleUpgrade = applyO8(idleRoster[0], [liveChatRun]);
  assert(idleUpgrade.changed && idleUpgrade.status === 'active', 'idle pinned agent upgrades to active from a running chat run');
  const queuedUpgrade = applyO8(idleRoster[0], [{ ...liveChatRun, status: 'queued' }]);
  assert(queuedUpgrade.changed && queuedUpgrade.status === 'building', 'queued run upgrades idle pin to building only');

  // No evidence / finished evidence → the roster row is left exactly as built.
  const noEvidence = applyO8(idleRoster[0], []);
  assert(!noEvidence.changed && noEvidence.status === 'idle', 'no runs → pinned status untouched');
  const finishedOnly = applyO8(idleRoster[0], [{
    ...liveChatRun, status: 'completed', completed_at: new Date(T1 - 30_000).toISOString(),
  }]);
  assert(!finishedOnly.changed && finishedOnly.status === 'idle', 'finished runs are not upgrade evidence');
  const foreignRun = applyO8(idleRoster[0], [{ ...liveChatRun, surface: 'feed_task' }]);
  assert(!foreignRun.changed, 'feed-surface runs do not claim the OpenSwan pin');

  console.log('office-roster-grouping smoke passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
