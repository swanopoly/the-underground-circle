/**
 * Agents fleet view (/agents).
 *
 * Multi-source aggregation — never blank. The previous implementation only
 * pulled live bridge sessions, so the page rendered empty whenever the user
 * had no Claude Code / Cursor / Codex / Gemini terminals open. This version
 * combines four sources in priority order:
 *
 *   1. Pinned defaults    BlackSwan + HuggingSwan (always present)
 *   2. Live sessions      Bridge-published CLI sessions (claude-code, cursor,
 *                         codex, gemini, openswan)
 *   3. Bonded agents      Anything in local agentIdentities storage — agents
 *                         the user has named, customized, or bonded with,
 *                         even if not currently connected
 *   4. Connected providers BYOA cloud LLM providers configured (OpenAI,
 *                         Anthropic, OpenRouter, etc.)
 *
 * Each section gets its own card grid with section-specific copy. Sections
 * with zero items render an inline empty-state CTA pointing to the right
 * configuration surface (Integrations tab, bridge setup, etc.).
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import FlatIcon from '../../components/FlatIcon';
import {
  getAutoConnectCircleId,
  getAutoConnectConnections,
  getAutoConnectSessions,
  subscribeAutoConnect,
} from '../../lib/agentAutoConnectState';
import {
  type AgentIdentity,
  loadAgentIdentities,
} from '../../lib/agentIdentity';
import {
  type AgentConnection,
  loadConnections,
  PROVIDER_META,
  type ProviderType,
} from '../../lib/connectionManager';
import {
  DEFAULT_AGENT,
  HUGGINGSWAN_AGENT,
  type OfficeAgent,
  getOfficeStatusColor,
  getOfficeStatusLabel,
  isConnectedOfficeStatus,
  sessionsToAgents,
} from '../../lib/officeAgents';
import {
  applySyntheticAgentStatusUpgrade,
  deriveSyntheticAgentStatusFromRuns,
  HUGGINGSWAN_RUN_NAME_KEYS,
  type OfficeBuildingBoard,
  type OfficeRunNode,
  OPENSWAN_RUN_NAME_KEYS,
} from '../../lib/officeOpsBoard';

const PAGE_MAX_WIDTH = 2200;

type SectionKey = 'pinned' | 'live' | 'bonded' | 'providers';

interface FleetData {
  pinned: OfficeAgent[];
  live: OfficeAgent[];
  bonded: AgentIdentity[];           // identity records (may have no live session)
  providers: AgentConnection[];      // configured BYOA / bridge connections
}

// ── Data assembly ───────────────────────────────────────────────────────────

function getLiveAgents(identities: Map<string, AgentIdentity>): OfficeAgent[] {
  const connections = getAutoConnectConnections();
  const sessionsMap = getAutoConnectSessions();
  const agents: OfficeAgent[] = [];

  for (const [connectionId, sessions] of sessionsMap) {
    const connection = connections.find(conn => conn.id === connectionId);
    if (!connection || !sessions?.length) continue;
    const converted = sessionsToAgents(
      sessions as any,
      connectionId,
      connection.name,
      connection.provider as ProviderType,
    );
    for (const agent of converted) {
      const identity = identities.get(agent.sessionKey);
      agents.push({
        ...agent,
        name: identity?.customName || agent.name,
        color: identity?.customColor || agent.color,
      });
    }
  }

  return agents
    .filter(agent => isConnectedOfficeStatus(agent.status))
    .sort((a, b) => {
      const rank: Record<string, number> = { building: 0, active: 1, idle: 2 };
      const aRank = rank[a.status] ?? 3;
      const bRank = rank[b.status] ?? 3;
      if (aRank !== bRank) return aRank - bRank;
      return (b.turns || 0) - (a.turns || 0);
    });
}

/**
 * Bonded agents = anything in local identity storage. Excludes any session
 * already shown in the live section so we don't double-render. Sorted by
 * most-recently-seen so the user's recent companions appear first.
 */
function getBondedIdentities(
  identities: Map<string, AgentIdentity>,
  liveAgents: OfficeAgent[],
): AgentIdentity[] {
  const liveSessionKeys = new Set(liveAgents.map(a => a.sessionKey));
  return Array.from(identities.values())
    .filter(id => !liveSessionKeys.has(id.sessionKey))
    .filter(id => !!(id.customName || id.bondLevel || id.totalTurns))
    .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

/**
 * O8 parity with the Office (officeOpsBoard.deriveSyntheticAgentStatusFromRuns).
 * The two pinned defaults have no bridge session feeding their status, so
 * without this they'd render their STATIC status (OpenSwan = "active",
 * HuggingSwan = "idle") even while a chat/OpenSwan run is mid-task. Live
 * agent_runs rows (the same nodes the Building-Now board renders) are the
 * authoritative evidence, so we UPGRADE-only: idle → building/active,
 * building → active, activity → "Working: <run>". No evidence / offline / error
 * pass through untouched (the helper's 2h stale-run guard + upgrade-only ladder
 * enforce "never fabricate active"). The static constants are never mutated —
 * we spread into a fresh object. `deriveSyntheticAgentStatusFromRuns` walks
 * children itself, so the board's `building` roots can be passed directly.
 */
function upgradePinnedFromRuns(
  pins: OfficeAgent[],
  buildingNodes: OfficeRunNode[] | null | undefined,
  nowMs: number,
): OfficeAgent[] {
  if (!buildingNodes || buildingNodes.length === 0) return pins;
  return pins.map((agent) => {
    const nameKeys =
      agent.id === DEFAULT_AGENT.id ? OPENSWAN_RUN_NAME_KEYS
      : agent.id === HUGGINGSWAN_AGENT.id ? HUGGINGSWAN_RUN_NAME_KEYS
      : null;
    if (!nameKeys) return agent;
    const upgrade = applySyntheticAgentStatusUpgrade(
      agent.status,
      deriveSyntheticAgentStatusFromRuns(nameKeys, buildingNodes, nowMs),
    );
    if (!upgrade.changed) return agent;
    return { ...agent, status: upgrade.status, activity: upgrade.activity ?? agent.activity };
  });
}

// ── Section renderers ──────────────────────────────────────────────────────

interface SectionHeaderProps {
  title: string;
  subtitle: string;
  count: number;
  iconName?: string;
}

function SectionHeader({ title, subtitle, count, iconName }: SectionHeaderProps) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderLeft}>
        {iconName ? <FlatIcon name={iconName} size={18} /> : null}
        <View>
          <Text style={styles.sectionTitle}>{title}</Text>
          <Text style={styles.sectionSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.sectionCount}>
        <Text style={styles.sectionCountValue}>{count}</Text>
      </View>
    </View>
  );
}

interface AgentCardProps {
  agent: OfficeAgent;
  variant?: 'pinned' | 'live' | 'bonded';
}

function AgentCard({ agent, variant = 'live' }: AgentCardProps) {
  const statusColor = getOfficeStatusColor(agent.status);
  const provider = agent.connectionName || PROVIDER_META[agent.providerType]?.label || agent.providerType;
  const showFiles = agent.activeFiles && agent.activeFiles.length > 0;

  return (
    <View style={[styles.agentCard, variant === 'pinned' && styles.agentCardPinned]}>
      <View style={styles.agentTopRow}>
        <View style={[styles.agentAvatar, { backgroundColor: agent.color + '1f', borderColor: agent.color }]}>
          <Text style={[styles.agentAvatarLetter, { color: agent.color }]}>
            {agent.name.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.agentName} numberOfLines={1}>{agent.name}</Text>
          <Text style={styles.agentRole} numberOfLines={1}>{agent.role || provider}</Text>
        </View>
        <View style={[styles.statusPill, { borderColor: statusColor + '55', backgroundColor: statusColor + '14' }]}>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusPillText, { color: statusColor }]}>
            {getOfficeStatusLabel(agent.status).toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaChip}>
          <Text style={styles.metaChipText}>{provider}</Text>
        </View>
        {agent.model && agent.model !== 'unknown' && (
          <View style={styles.metaChip}>
            <Text style={styles.metaChipText}>{agent.model}</Text>
          </View>
        )}
      </View>

      {agent.activity && (
        <Text style={styles.activityText} numberOfLines={2}>{agent.activity}</Text>
      )}

      {showFiles && (
        <Text style={styles.filesText} numberOfLines={1}>
          Active: {agent.activeFiles!.slice(0, 3).join(' \u00b7 ')}
          {agent.activeFiles!.length > 3 ? ` (+${agent.activeFiles!.length - 3})` : ''}
        </Text>
      )}

      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricValue}>{(agent.turns || 0).toLocaleString()}</Text>
          <Text style={styles.metricLabel}>turns</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricValue}>{formatTokens(agent.tokensUsed || 0)}</Text>
          <Text style={styles.metricLabel}>tokens</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricValue}>${(agent.costTotal || 0).toFixed(2)}</Text>
          <Text style={styles.metricLabel}>spend</Text>
        </View>
      </View>

      {agent.projectDir && (
        <Text style={styles.projectDir} numberOfLines={1}>{agent.projectDir}</Text>
      )}
    </View>
  );
}

interface BondedCardProps {
  identity: AgentIdentity;
}

function BondedCard({ identity }: BondedCardProps) {
  const accent = identity.customColor || '#6366f1';
  const lastSeen = identity.lastSeen ? formatRelativeTime(identity.lastSeen) : 'unknown';
  const provider = identity.boundAiProvider || 'agent';

  return (
    <View style={styles.agentCard}>
      <View style={styles.agentTopRow}>
        <View style={[styles.agentAvatar, { backgroundColor: accent + '1f', borderColor: accent }]}>
          <Text style={[styles.agentAvatarLetter, { color: accent }]}>
            {(identity.customName || identity.sessionKey).charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.agentName} numberOfLines={1}>
            {identity.customName || identity.sessionKey.slice(0, 16)}
          </Text>
          <Text style={styles.agentRole} numberOfLines={1}>
            Bonded \u00b7 {provider}{identity.boundModel ? ` \u00b7 ${identity.boundModel}` : ''}
          </Text>
        </View>
        {identity.bondLevel ? (
          <View style={[styles.statusPill, { borderColor: accent + '55', backgroundColor: accent + '14' }]}>
            <Text style={[styles.statusPillText, { color: accent }]}>LV {identity.bondLevel}</Text>
          </View>
        ) : (
          <View style={[styles.statusPill, { borderColor: '#33415555', backgroundColor: '#1e293b' }]}>
            <Text style={[styles.statusPillText, { color: '#94a3b8' }]}>OFFLINE</Text>
          </View>
        )}
      </View>

      <View style={styles.metaRow}>
        {identity.spiritEmoji && (
          <View style={styles.metaChip}><Text style={styles.metaChipText}>{identity.spiritEmoji} spirit</Text></View>
        )}
        {identity.isPrimary && (
          <View style={[styles.metaChip, { borderColor: accent + '40', backgroundColor: accent + '10' }]}>
            <Text style={[styles.metaChipText, { color: accent }]}>PRIMARY</Text>
          </View>
        )}
        {identity.tags?.slice(0, 2).map(tag => (
          <View key={tag} style={styles.metaChip}><Text style={styles.metaChipText}>{tag}</Text></View>
        ))}
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricValue}>{identity.totalSessionsAllTime ?? 0}</Text>
          <Text style={styles.metricLabel}>sessions</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricValue}>{formatTokens(identity.totalTokensAllTime ?? 0)}</Text>
          <Text style={styles.metricLabel}>tokens</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricValue}>${(identity.totalCostAllTime ?? 0).toFixed(2)}</Text>
          <Text style={styles.metricLabel}>lifetime</Text>
        </View>
      </View>

      <Text style={styles.projectDir} numberOfLines={1}>last seen {lastSeen}</Text>
    </View>
  );
}

interface ProviderCardProps {
  conn: AgentConnection;
}

function ProviderCard({ conn }: ProviderCardProps) {
  const meta = PROVIDER_META[conn.provider];
  const accent = conn.color || meta?.color || '#6366f1';
  const label = meta?.label || conn.provider;
  const isOnline = conn.status === 'connected';

  return (
    <View style={styles.agentCard}>
      <View style={styles.agentTopRow}>
        <View style={[styles.agentAvatar, { backgroundColor: accent + '1f', borderColor: accent }]}>
          <Text style={[styles.agentAvatarLetter, { color: accent }]}>{label.charAt(0)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.agentName} numberOfLines={1}>{conn.name || label}</Text>
          <Text style={styles.agentRole} numberOfLines={1}>{label} provider</Text>
        </View>
        <View style={[styles.statusPill, {
          borderColor: isOnline ? '#22c55e55' : '#33415555',
          backgroundColor: isOnline ? '#22c55e14' : '#1e293b',
        }]}>
          <View style={[styles.statusDot, { backgroundColor: isOnline ? '#22c55e' : '#64748b' }]} />
          <Text style={[styles.statusPillText, { color: isOnline ? '#22c55e' : '#94a3b8' }]}>
            {conn.status.toUpperCase()}
          </Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaChip}>
          <Text style={styles.metaChipText} numberOfLines={1}>{conn.endpoint}</Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricValue}>{conn.sessionCount ?? 0}</Text>
          <Text style={styles.metricLabel}>sessions</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricValue}>{conn.enabled ? 'YES' : 'NO'}</Text>
          <Text style={styles.metricLabel}>enabled</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricValue}>{conn.lastConnected ? formatRelativeTime(new Date(conn.lastConnected).getTime()) : '\u2014'}</Text>
          <Text style={styles.metricLabel}>last seen</Text>
        </View>
      </View>
    </View>
  );
}

interface EmptyStateProps {
  title: string;
  body: string;
  cta?: { label: string; onPress: () => void };
}

function EmptyState({ title, body, cta }: EmptyStateProps) {
  return (
    <View style={styles.emptyInline}>
      <Text style={styles.emptyInlineTitle}>{title}</Text>
      <Text style={styles.emptyInlineBody}>{body}</Text>
      {cta && (
        <Pressable
          onPress={cta.onPress}
          style={[styles.emptyInlineCta, Platform.OS === 'web' && ({ cursor: 'pointer' } as any)]}
        >
          <Text style={styles.emptyInlineCtaText}>{cta.label}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

function formatRelativeTime(ms: number): string {
  if (!ms) return 'unknown';
  const diff = Date.now() - ms;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function matchesQuery(haystack: string[], q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return haystack.join(' ').toLowerCase().includes(needle);
}

// ── Main component ─────────────────────────────────────────────────────────

export default function AgentsScreen({ navigation }: any) {
  const [identities, setIdentities] = useState<Map<string, AgentIdentity>>(new Map());
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  // O8 parity: live agent_runs board for the active circle, used only to
  // upgrade the pinned defaults off their static status. Null until (and
  // unless) a circle is known + the fetch succeeds; the screen renders fine
  // without it (pins fall back to their static status).
  const [opsBoard, setOpsBoard] = useState<OfficeBuildingBoard | null>(null);
  const [tick, setTick] = useState(0);
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<SectionKey | 'all'>('all');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;

    // O8 parity with OfficeTab: fetch the circle's live runs so the pinned
    // defaults can be upgraded off their static status mid-task. The fleet
    // screen has no circleId prop, so we reuse the active circle published by
    // the auto-connect runtime (the same module we already subscribe to).
    // Bounded fetch, lazy import, silent-fail — never break the screen.
    const reloadRuns = async () => {
      const circleId = getAutoConnectCircleId();
      if (!circleId) { if (!cancelled) setOpsBoard(null); return; }
      try {
        const [{ listCircleLiveRuns }, { buildOfficeBuildingBoard }] = await Promise.all([
          import('../../lib/agentRunSystem'),
          import('../../lib/officeOpsBoard'),
        ]);
        const runs = await listCircleLiveRuns(circleId, { limit: 200 });
        if (cancelled) return;
        setOpsBoard(buildOfficeBuildingBoard(runs, { nowMs: Date.now() }));
      } catch { /* live-status extra — never break the fleet screen */ }
    };

    loadAgentIdentities().then(setIdentities).catch(err =>
      console.warn('[AgentsScreen] loadAgentIdentities failed:', err),
    );
    loadConnections().then(setConnections).catch(err =>
      console.warn('[AgentsScreen] loadConnections failed:', err),
    );
    void reloadRuns();
    const unsub = subscribeAutoConnect(() => {
      setTick(v => v + 1);
      setLastUpdatedAt(Date.now());
      loadAgentIdentities().then(setIdentities).catch(() => {});
      loadConnections().then(setConnections).catch(() => {});
      void reloadRuns(); // circle/session change may bring pin runs online
    });
    // Poll on the same cadence as OfficeTab's run reload so a run that starts
    // or finishes with no auto-connect event still flips the pin within ~15s.
    const runsTimer = setInterval(() => { void reloadRuns(); }, 15_000);
    return () => {
      cancelled = true;
      clearInterval(runsTimer);
      unsub();
    };
  }, []);

  const fleet = useMemo<FleetData>(() => {
    const live = getLiveAgents(identities);
    const bonded = getBondedIdentities(identities, live);
    // O8: upgrade the static pins from live run evidence (upgrade-only; never
    // demotes, never fabricates active without a fresh run — see helper).
    const pinned = upgradePinnedFromRuns(
      [DEFAULT_AGENT, HUGGINGSWAN_AGENT],
      opsBoard?.building,
      Date.now(),
    );
    return {
      pinned,
      live,
      bonded,
      providers: connections,
    };
  }, [identities, connections, opsBoard, tick]);

  // Apply search filter to each section independently
  const filteredFleet = useMemo<FleetData>(() => {
    const q = query.trim();
    if (!q) return fleet;
    return {
      pinned: fleet.pinned.filter(a => matchesQuery([a.name, a.role || '', a.providerType], q)),
      live: fleet.live.filter(a => matchesQuery([a.name, a.connectionName || '', a.providerType, a.model || '', a.activity || '', a.projectDir || ''], q)),
      bonded: fleet.bonded.filter(id => matchesQuery([id.customName || '', id.sessionKey, id.boundAiProvider || '', id.boundModel || '', ...(id.tags || [])], q)),
      providers: fleet.providers.filter(c => matchesQuery([c.name, c.provider, c.endpoint], q)),
    };
  }, [fleet, query]);

  // Section visibility from filter pill
  const showPinned = activeFilter === 'all' || activeFilter === 'pinned';
  const showLive = activeFilter === 'all' || activeFilter === 'live';
  const showBonded = activeFilter === 'all' || activeFilter === 'bonded';
  const showProviders = activeFilter === 'all' || activeFilter === 'providers';

  // Top-level summary metrics
  const totalAgents = filteredFleet.pinned.length + filteredFleet.live.length + filteredFleet.bonded.length;
  const liveCount = filteredFleet.live.length;
  const buildingCount = filteredFleet.live.filter(a => a.status === 'building').length;
  const providerCount = filteredFleet.providers.filter(p => p.status === 'connected').length;
  const updatedLabel = formatRelativeTime(lastUpdatedAt);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.shell}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>YOUR FLEET</Text>
              <Text style={styles.title}>Agents</Text>
              <Text style={styles.subtitle}>
                Every agent you can talk to right now — pinned defaults, your live terminal sessions,
                bonded companions across circles, and configured providers. Sources auto-refresh.
              </Text>
            </View>
            <View style={styles.headerMeta}>
              <Text style={styles.headerMetaLabel}>Updated</Text>
              <Text style={styles.headerMetaValue}>{updatedLabel}</Text>
            </View>
          </View>

          {/* Summary metrics */}
          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{totalAgents}</Text>
              <Text style={styles.summaryLabel}>total agents</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: '#22c55e' }]}>{liveCount}</Text>
              <Text style={styles.summaryLabel}>live now</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: '#60a5fa' }]}>{buildingCount}</Text>
              <Text style={styles.summaryLabel}>building</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={[styles.summaryValue, { color: '#c084fc' }]}>{providerCount}</Text>
              <Text style={styles.summaryLabel}>providers online</Text>
            </View>
          </View>

          {/* Toolbar — search + filter pills */}
          <View style={styles.toolbar}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search agents, providers, models, paths"
              placeholderTextColor="#64748b"
              style={styles.searchInput}
            />
            <View style={styles.filterRow}>
              {([
                { key: 'all', label: 'All' },
                { key: 'pinned', label: 'Pinned' },
                { key: 'live', label: 'Live' },
                { key: 'bonded', label: 'Bonded' },
                { key: 'providers', label: 'Providers' },
              ] as const).map(f => {
                const active = activeFilter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setActiveFilter(f.key)}
                    style={[
                      styles.filterPill,
                      active && styles.filterPillActive,
                      Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
                    ]}
                  >
                    <Text style={[styles.filterPillText, active && styles.filterPillTextActive]}>
                      {f.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Section: Pinned defaults — always present */}
          {showPinned && (
            <View style={styles.section}>
              <SectionHeader
                title="Pinned"
                subtitle="Always-on platform agents you can call from any circle"
                count={filteredFleet.pinned.length}
                iconName="brain"
              />
              <View style={styles.agentGrid}>
                {filteredFleet.pinned.map(agent => (
                  <AgentCard key={agent.id} agent={agent} variant="pinned" />
                ))}
              </View>
            </View>
          )}

          {/* Section: Live local sessions */}
          {showLive && (
            <View style={styles.section}>
              <SectionHeader
                title="Live sessions"
                subtitle="Terminals open on your machine right now (Claude Code, Cursor, Codex, Gemini, OpenSwan)"
                count={filteredFleet.live.length}
                iconName="connection"
              />
              {filteredFleet.live.length > 0 ? (
                <View style={styles.agentGrid}>
                  {filteredFleet.live.map(agent => (
                    <AgentCard key={agent.id} agent={agent} variant="live" />
                  ))}
                </View>
              ) : (
                <EmptyState
                  title="No live sessions"
                  body="Open a Claude Code, Cursor, Codex, or Gemini terminal — the bridge will publish it here within a few seconds. Or start an OpenSwan session to bring a remote agent online."
                />
              )}
            </View>
          )}

          {/* Section: Bonded agents */}
          {showBonded && (
            <View style={styles.section}>
              <SectionHeader
                title="Bonded"
                subtitle="Agents you've named, customized, or built XP with — even when offline"
                count={filteredFleet.bonded.length}
                iconName="agents"
              />
              {filteredFleet.bonded.length > 0 ? (
                <View style={styles.agentGrid}>
                  {filteredFleet.bonded.map(identity => (
                    <BondedCard key={identity.sessionKey} identity={identity} />
                  ))}
                </View>
              ) : (
                <EmptyState
                  title="No bonded agents yet"
                  body="When you customize an agent's name, color, or appearance — or invest XP through interactions — it shows up here so you can find it across sessions."
                />
              )}
            </View>
          )}

          {/* Section: Providers */}
          {showProviders && (
            <View style={styles.section}>
              <SectionHeader
                title="Providers"
                subtitle="Configured cloud LLM providers + local bridges"
                count={filteredFleet.providers.length}
                iconName="integrations"
              />
              {filteredFleet.providers.length > 0 ? (
                <View style={styles.agentGrid}>
                  {filteredFleet.providers.map(conn => (
                    <ProviderCard key={conn.id} conn={conn} />
                  ))}
                </View>
              ) : (
                <EmptyState
                  title="No providers configured"
                  body="Add an OpenAI, Anthropic, OpenRouter, or other API key from the Integrations tab to bring more model variety into chat."
                  cta={navigation ? {
                    label: 'Open Integrations',
                    onPress: () => {
                      try { navigation.navigate('Integrations'); } catch {}
                    },
                  } : undefined}
                />
              )}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#020617' },
  scrollContent: { paddingHorizontal: 24, paddingVertical: 24 },
  shell: { width: '100%', maxWidth: PAGE_MAX_WIDTH, alignSelf: 'center', gap: 22 },

  // Header
  headerRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14 },
  headerCopy: { flex: 1, gap: 4 },
  eyebrow: { color: '#38bdf8', fontSize: 12, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { color: '#f8fafc', fontSize: 36, fontWeight: '800' },
  subtitle: { color: '#94a3b8', fontSize: 14, lineHeight: 20, maxWidth: 840 },
  headerMeta: { minWidth: 120, alignItems: 'flex-end', gap: 2 },
  headerMetaLabel: { color: '#64748b', fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1 },
  headerMetaValue: { color: '#e2e8f0', fontSize: 14, fontWeight: '700' },

  // Summary
  summaryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  summaryCard: {
    minWidth: 140, paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 16, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a',
  },
  summaryValue: { color: '#f8fafc', fontSize: 24, fontWeight: '800' },
  summaryLabel: { marginTop: 4, color: '#94a3b8', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },

  // Toolbar
  toolbar: { gap: 10 },
  searchInput: {
    width: '100%', paddingHorizontal: 16, paddingVertical: 14,
    borderRadius: 16, borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#0f172a',
    color: '#e2e8f0', fontSize: 14,
    // outlineStyle is web-only and not in TextStyle — cast through any
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  } as any,
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  filterPill: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999,
    borderWidth: 1, borderColor: '#334155', backgroundColor: 'transparent',
  },
  filterPillActive: { backgroundColor: '#38bdf8', borderColor: '#38bdf8' },
  filterPillText: { color: '#94a3b8', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  filterPillTextActive: { color: '#020617' },

  // Section
  section: { gap: 12 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: '#1e293b',
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 },
  sectionTitle: { color: '#f8fafc', fontSize: 18, fontWeight: '800' },
  sectionSubtitle: { color: '#64748b', fontSize: 12, fontWeight: '600', marginTop: 2 },
  sectionCount: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a',
  },
  sectionCountValue: { color: '#cbd5e1', fontSize: 12, fontWeight: '800' },

  // Agent grid + cards
  agentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  agentCard: {
    flexBasis: 340, flexGrow: 1, minWidth: 300, maxWidth: 460,
    padding: 16, borderRadius: 16, borderWidth: 1, borderColor: '#1e293b',
    backgroundColor: '#0f172a', gap: 12,
  },
  agentCardPinned: { borderColor: '#38bdf855', backgroundColor: '#0d172d' },
  agentTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  agentAvatar: {
    width: 38, height: 38, borderRadius: 10, borderWidth: 1.5,
    alignItems: 'center', justifyContent: 'center',
  },
  agentAvatarLetter: { fontSize: 16, fontWeight: '900', fontFamily: 'monospace' },
  agentName: { color: '#f8fafc', fontSize: 16, fontWeight: '800' },
  agentRole: { color: '#94a3b8', fontSize: 12, fontWeight: '600', marginTop: 1 },

  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },

  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999,
    borderWidth: 1, borderColor: '#334155', backgroundColor: '#111827',
  },
  metaChipText: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },

  activityText: { color: '#e2e8f0', fontSize: 13, lineHeight: 18 },
  filesText: { color: '#94a3b8', fontSize: 12, fontFamily: 'monospace' },

  metricsRow: { flexDirection: 'row', gap: 8 },
  metricBox: {
    flex: 1, paddingVertical: 8, paddingHorizontal: 10,
    borderRadius: 10, backgroundColor: '#111827',
    borderWidth: 1, borderColor: '#1f2937',
  },
  metricValue: { color: '#f8fafc', fontSize: 14, fontWeight: '800' },
  metricLabel: { marginTop: 1, color: '#64748b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },

  projectDir: { color: '#475569', fontSize: 11, fontFamily: 'monospace' },

  // Inline empty state inside a section
  emptyInline: {
    padding: 18, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed',
    borderColor: '#1e293b', backgroundColor: 'rgba(15, 23, 42, 0.5)',
    gap: 6, alignItems: 'flex-start',
  },
  emptyInlineTitle: { color: '#e2e8f0', fontSize: 14, fontWeight: '800' },
  emptyInlineBody: { color: '#94a3b8', fontSize: 13, lineHeight: 18 },
  emptyInlineCta: {
    marginTop: 6, paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 8, backgroundColor: '#38bdf8',
  },
  emptyInlineCtaText: { color: '#020617', fontSize: 12, fontWeight: '800' },
});
