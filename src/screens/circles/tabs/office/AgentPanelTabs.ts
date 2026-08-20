import type { OfficeAgent } from '../../../../lib/officeAgents';
import type { AgentConnection } from '../../../../lib/connectionManager';
import {
  buildOpenSwanConnectionFingerprint,
  matchesOpenSwanConnectionFingerprint,
  resolveOpenSwanConnectionTransport,
  type OpenSwanConnectionFingerprint,
} from '../../../../lib/officeAgentSessionBindingCore';

export type AgentPanelTabKey =
  | 'overview'
  | 'activity'
  | 'memory'
  | 'cron'
  | 'spirit'
  | 'evolution'
  | 'runs'
  | 'openswan'
  | 'terminal'
  | 'customize';

export type AgentPanelPrimaryKey = 'overview' | 'work' | 'runtime' | 'more';

export interface AgentPanelTab {
  key: AgentPanelTabKey;
  label: string;
  description: string;
}

export interface AgentPanelCapabilities {
  hasCircleContext: boolean;
  hasIdentityAuthority: boolean;
  hasProgressionStorage: boolean;
  canCustomize: boolean;
  hasRuntimeConnection?: boolean;
}

export interface AgentPanelGroup {
  key: AgentPanelPrimaryKey;
  label: string;
  description: string;
  tabs: AgentPanelTab[];
}

/**
 * Non-secret proof of the exact connected runtime that Office is currently
 * projecting. Durable connection metadata deliberately reloads as
 * `disconnected`, so runtime panels must pair that exact-authority reload with
 * this live verdict before using its locally hydrated secret.
 */
export type AgentPanelRuntimeConnectionSnapshot = Readonly<
  OpenSwanConnectionFingerprint & { status: 'connected' }
>;

export type AgentPanelRuntimeConnectionFence = (
  snapshot: AgentPanelRuntimeConnectionSnapshot,
) => boolean;

const TAB_CATALOG: Record<AgentPanelTabKey, AgentPanelTab> = {
  overview: { key: 'overview', label: 'Overview', description: 'Identity, readiness, controls, and high-signal agent context.' },
  activity: { key: 'activity', label: 'Activity', description: 'Execution telemetry, timeline, tools, messages, and session evidence.' },
  memory: { key: 'memory', label: 'Memory', description: 'Agent, shared, and startup memory available to this runtime.' },
  cron: { key: 'cron', label: 'Schedules', description: 'Connection-level OpenSwan schedules for this runtime endpoint.' },
  spirit: { key: 'spirit', label: 'Spirit', description: 'Soul, personality, and long-lived behavioral configuration.' },
  evolution: { key: 'evolution', label: 'XP & Achievements', description: 'Progression, milestones, and long-term agent growth signals.' },
  runs: { key: 'runs', label: 'Runs', description: 'Tracked runs and step-by-step execution records for this agent.' },
  openswan: { key: 'openswan', label: 'OpenSwan', description: 'Exact runtime evidence and Chat-owned task handoff for this live OpenSwan session.' },
  terminal: { key: 'terminal', label: 'Terminal', description: 'Managed terminal profile, Chat task handoff, and capability-gated read-only diagnostics.' },
  customize: { key: 'customize', label: 'Customize', description: 'Appearance and presentation settings for this agent.' },
};

const GROUP_CATALOG: ReadonlyArray<{
  key: AgentPanelPrimaryKey;
  label: string;
  description: string;
  tabKeys: readonly AgentPanelTabKey[];
}> = [
  {
    key: 'overview',
    label: 'Overview',
    description: 'Agent identity, readiness, and essential controls.',
    tabKeys: ['overview'],
  },
  {
    key: 'work',
    label: 'Work',
    description: 'Current activity, runs, and retained working context.',
    tabKeys: ['activity', 'runs', 'memory'],
  },
  {
    key: 'runtime',
    label: 'Runtime',
    description: 'Runtime sessions, terminal access, and schedules.',
    tabKeys: ['openswan', 'terminal', 'cron'],
  },
  {
    key: 'more',
    label: 'More',
    description: 'Spirit, progression, and presentation settings.',
    tabKeys: ['spirit', 'evolution', 'customize'],
  },
] as const;

function isOpenSwanAgent(agent: OfficeAgent): boolean {
  return agent.providerType === 'openswan' || agent.providerType === 'blackswan-local';
}

function resolveAgentPanelRuntimeConnection(
  agent: OfficeAgent | null | undefined,
  connections: readonly AgentConnection[],
): AgentConnection | null {
  if (!agent || !isOpenSwanAgent(agent) || !Array.isArray(connections)) return null;
  const eligible = connections.filter(connection => !!resolveOpenSwanConnectionTransport(connection));
  const isBuiltIn = agent.id === 'default::blackswan'
    || agent.id === 'blackswan-default'
    || agent.id === 'openswan:main_chat';
  if (isBuiltIn) return eligible.length === 1 ? eligible[0] : null;
  const exact = eligible.filter(connection => connection.id === agent.connectionId);
  return exact.length === 1 ? exact[0] : null;
}

export function resolveAgentPanelRuntimeConnectionSnapshot(
  agent: OfficeAgent | null | undefined,
  connections: readonly AgentConnection[],
): AgentPanelRuntimeConnectionSnapshot | null {
  const connection = resolveAgentPanelRuntimeConnection(agent, connections);
  const fingerprint = buildOpenSwanConnectionFingerprint(connection);
  return connection && fingerprint
    ? Object.freeze({ ...fingerprint, status: 'connected' as const })
    : null;
}

/** Re-check a captured runtime verdict against Office's current exact lane. */
export function isAgentPanelRuntimeConnectionSnapshotCurrent(
  snapshot: AgentPanelRuntimeConnectionSnapshot | null | undefined,
  connections: readonly AgentConnection[],
): snapshot is AgentPanelRuntimeConnectionSnapshot {
  if (!snapshot || snapshot.status !== 'connected' || !Array.isArray(connections)) return false;
  const matches = connections.filter(connection => connection.id === snapshot.connectionId);
  return matches.length === 1
    && !!resolveOpenSwanConnectionTransport(matches[0])
    && matchesOpenSwanConnectionFingerprint(snapshot, matches[0]);
}

/**
 * Resolve the exact connection that may back runtime-only panel routes. The
 * built-in OpenSwan card is a product identity, not a connection id: it may use
 * one singular connected OpenSwan runtime, but two candidates are deliberately
 * ambiguous and expose no runtime controls until the user selects a concrete
 * session. Live roster sessions must match their own connection id exactly.
 */
export function resolveAgentPanelRuntimeConnectionId(
  agent: OfficeAgent | null | undefined,
  connections: readonly AgentConnection[],
): string | null {
  return resolveAgentPanelRuntimeConnectionSnapshot(agent, connections)?.connectionId || null;
}

/**
 * Returns only routes that can render useful content for the current panel
 * scope. Omitting capabilities preserves the legacy catalog for source-level
 * consumers; the live AgentPanel always supplies an explicit snapshot.
 */
export function getAgentPanelTabs(
  agent: OfficeAgent,
  capabilities?: AgentPanelCapabilities,
): AgentPanelTab[] {
  const hasCircleContext = capabilities?.hasCircleContext ?? true;
  const hasIdentityAuthority = capabilities?.hasIdentityAuthority ?? true;
  // An omitted capability snapshot preserves the legacy source-level catalog.
  // Any explicit live snapshot must positively declare progression storage;
  // malformed or stale callers fail closed instead of probing optional tables.
  const hasProgressionStorage = capabilities
    ? capabilities.hasProgressionStorage === true
    : true;
  const canCustomize = capabilities?.canCustomize ?? true;
  const hasRuntimeConnection = capabilities?.hasRuntimeConnection ?? true;
  const hasPrivateScope = hasCircleContext && hasIdentityAuthority;
  const openSwanAgent = isOpenSwanAgent(agent);
  const openSwanRuntimeAgent = openSwanAgent && hasPrivateScope && hasRuntimeConnection;

  return [
    TAB_CATALOG.overview,
    TAB_CATALOG.activity,
    ...(hasPrivateScope ? [TAB_CATALOG.runs, TAB_CATALOG.memory] : []),
    ...(openSwanRuntimeAgent ? [TAB_CATALOG.openswan] : []),
    // Terminal, Spirit, and Customize all read or persist owner-private agent
    // identity. Do not advertise a locked route while exact authority is still
    // unavailable; Overview and Activity remain truthful read-only fallbacks.
    ...(hasPrivateScope ? [TAB_CATALOG.terminal] : []),
    ...(openSwanRuntimeAgent ? [TAB_CATALOG.cron] : []),
    ...(hasPrivateScope ? [TAB_CATALOG.spirit] : []),
    ...(hasPrivateScope && hasProgressionStorage ? [TAB_CATALOG.evolution] : []),
    ...(hasPrivateScope && canCustomize ? [TAB_CATALOG.customize] : []),
  ];
}

export function getAgentPanelGroups(tabs: readonly AgentPanelTab[]): AgentPanelGroup[] {
  const tabsByKey = new Map(tabs.map(tab => [tab.key, tab]));
  return GROUP_CATALOG.map(group => ({
    key: group.key,
    label: group.label,
    description: group.description,
    tabs: group.tabKeys.flatMap(tabKey => {
      const tab = tabsByKey.get(tabKey);
      return tab ? [tab] : [];
    }),
  })).filter(group => group.tabs.length > 0);
}

export function getAgentPanelGroupForTab(
  groups: readonly AgentPanelGroup[],
  tabKey: AgentPanelTabKey,
): AgentPanelGroup | null {
  return groups.find(group => group.tabs.some(tab => tab.key === tabKey)) || null;
}

export function getFallbackAgentPanelTab(
  agent: OfficeAgent,
  currentTab: AgentPanelTabKey,
  capabilities?: AgentPanelCapabilities,
): AgentPanelTabKey {
  const tabs = getAgentPanelTabs(agent, capabilities);
  return tabs.some(tab => tab.key === currentTab) ? currentTab : tabs[0]?.key || 'overview';
}
