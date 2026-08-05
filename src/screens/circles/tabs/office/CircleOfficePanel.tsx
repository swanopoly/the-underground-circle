/**
 * CircleOfficePanel — the circle-wide published-agent roster plus the
 * bridge-connect / bridge-unavailable states that sit above it.
 *
 * Extracted verbatim from `OfficeTab.tsx` as part of that file's decomposition.
 * These are self-contained presentational components: they take props and read
 * only pure helpers, so they moved without any prop threading. `coStyles` now
 * comes from the shared `officeTabStyles` module.
 */

import React, { useState } from 'react';
import { Linking, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { CircleOfficeAgent, PROVIDER_DISPLAY } from '../../../../lib/circleOffice';
import {
  getOfficeStatusColor,
  getOfficeStatusSortRank,
  isConnectedOfficeStatus,
} from '../../../../lib/officeAgents';
import { getBridgeEnvironment } from '../../../../lib/bridgeEnvironment';
import { getLastSeen } from '../../../../lib/agentHeartbeat';
import ConnectAllBridgesPanel, { isConnectPanelDismissed } from '../../../../components/office/ConnectAllBridgesPanel';
import { coStyles } from './officeTabStyles';

// ─── Circle Office Panel ──────────────────────────────────────────────────────
// Shows ALL circle members' published agents with their live status.

const CONNECTION_STATUS_UI = {
  connecting:   { label: 'Connecting…',   color: '#f59e0b', dot: '🟡' },
  live:         { label: 'Live',          color: '#22c55e', dot: '🟢' },
  reconnecting: { label: 'Reconnecting…', color: '#f59e0b', dot: '🟡' },
  offline:      { label: 'Offline',       color: '#666',    dot: '⚫' },
} as const;

// Shown on production web where localhost bridges (Claude Code, Codex, Gemini,
// Cursor, OpenSwan) can't be reached. Explains *why* the agent list is empty
// instead of leaving the user staring at an unhelpful blank panel.
/**
 * OfficeConnectBridgesSection — wraps the new ConnectAllBridgesPanel
 * with the per-circle dismiss flag and falls back to the legacy
 * BridgeUnavailableBanner for environments where the bridges
 * truly cannot be reached (e.g. native mobile users on a build that
 * predates the panel).
 */
export function OfficeConnectBridgesSection({ circleId }: { circleId: string }) {
  const [dismissed, setDismissed] = useState<boolean>(() => isConnectPanelDismissed(circleId));

  if (dismissed) {
    // After explicit dismiss the legacy banner still surfaces the
    // "no bridges reachable" message in case the env is unreachable.
    return <BridgeUnavailableBanner />;
  }

  return (
    <ConnectAllBridgesPanel
      circleId={circleId}
      onDismiss={() => setDismissed(true)}
    />
  );
}

export function BridgeUnavailableBanner() {
  const env = getBridgeEnvironment();
  const [dismissed, setDismissed] = useState(false);
  if (env.available || dismissed) return null;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        backgroundColor: '#161b22',
        borderWidth: 1,
        borderColor: '#30363d',
        borderLeftWidth: 3,
        borderLeftColor: '#6366f1',
        borderRadius: 6,
        padding: 12,
        marginHorizontal: 16,
        marginTop: 8,
      }}
      nativeID="section-office-bridge-unavailable"
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: '#e6edf3', fontSize: 13, fontWeight: '600', marginBottom: 4 }}>
          Agent bridges can run locally or on any reachable machine
        </Text>
        <Text style={{ color: '#8b949e', fontSize: 12, lineHeight: 18 }}>
          The Office can show local bridges, public bridges, and custom agents running on a Pi,
          VPS, or another machine. On the hosted web app, raw localhost ports are not reachable,
          so purely local bridges will stay empty unless you run the app locally or expose a public bridge URL. Start the UC dev server locally
          (<Text style={{ fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string, color: '#c9d1d9' }}>npm run dev</Text>)
          to see your local agents, or set <Text style={{ fontFamily: Platform.select({ web: 'ui-monospace, SFMono-Regular, Menlo, monospace', default: 'monospace' }) as string, color: '#c9d1d9' }}>EXPO_PUBLIC_BRIDGE_HOST</Text> or a custom public endpoint to reach agents elsewhere.
        </Text>
      </View>
      <Pressable
        onPress={() => setDismissed(true)}
        style={{ padding: 4 }}
        accessibilityRole="button"
        accessibilityLabel="Dismiss bridge notice"
      >
        <Text style={{ color: '#8b949e', fontSize: 14 }}>×</Text>
      </Pressable>
    </View>
  );
}

export default function CircleOfficePanel({
  agents,
  onRefresh,
  accentColor,
  compact = false,
  connectionStatus = 'offline',
}: {
  agents: CircleOfficeAgent[];
  onRefresh: () => void;
  accentColor: string;
  compact?: boolean;
  connectionStatus?: 'connecting' | 'live' | 'reconnecting' | 'offline';
}) {
  const formatBuildMetric = (value: number): string => {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (value >= 10_000) return `${Math.round(value / 1000)}K`;
    if (value >= 1_000) return `${(value / 1000).toFixed(1)}K`;
    return `${Math.max(0, Math.round(value))}`;
  };

  const getBuildMinutes = (agent: CircleOfficeAgent): number => {
    const ts = new Date(agent.lastActiveAt || agent.updatedAt || Date.now()).getTime();
    if (!Number.isFinite(ts)) return 1;
    const mins = Math.round((Date.now() - ts) / 60000);
    return Math.max(1, Math.min(45, mins));
  };

  const getBuildXp = (agent: CircleOfficeAgent): number => {
    const tokenXp = Math.round(((agent.input_tokens_today || 0) + (agent.output_tokens_today || 0) + ((agent.cached_tokens_today || 0) * 0.35)) / 180);
    const actionXp = (agent.message_count_today || 0) * 26;
    const liveXp = agent.status === 'building' ? getBuildMinutes(agent) * 8 : 0;
    return Math.max(agent.status === 'building' ? 24 : 0, tokenXp + actionXp + liveXp);
  };

  const building = agents.filter(a => a.status === 'building');
  const connected = agents.filter(a => isConnectedOfficeStatus(a.status) && a.status !== 'building');
  const offline = agents.filter(a => !isConnectedOfficeStatus(a.status));
  const totalBuildingXp = building.reduce((sum, agent) => sum + getBuildXp(agent), 0);

  if (compact) {
    // Horizontal strip for desktop — scrollable row of agent chips
    return (
      <View style={coStyles.compactBar}>
        <Text style={coStyles.compactLabel}>🏢 Circle Office</Text>
        <View style={[coStyles.connectionDot, { backgroundColor: CONNECTION_STATUS_UI[connectionStatus].color, marginRight: 4 }]} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={coStyles.compactScroll}>
          {agents.map(agent => {
            const display = PROVIDER_DISPLAY[agent.provider] || PROVIDER_DISPLAY['generic-agent'];
            const statusColor = agent.status === 'building' ? '#22c55e' : getOfficeStatusColor(agent.status);
            const buildXp = getBuildXp(agent);
            return (
              <View key={agent.id} style={[coStyles.compactChip, { borderColor: display.color + '44' }]}>
                {/* Live pulse for building */}
                {agent.status === 'building' && (
                  <View style={[coStyles.buildingDot, { backgroundColor: '#22c55e' }]} />
                )}
                <Text style={coStyles.compactIcon}>{display.icon}</Text>
                <View>
                  <Text style={coStyles.compactOwner}>{agent.ownerDisplayName}</Text>
                  <Text style={coStyles.compactAgentName} numberOfLines={1}>{agent.name}</Text>
                  {agent.status === 'building' && (
                    <Text style={coStyles.compactBuildXp}>BUILDING · +{formatBuildMetric(buildXp)} XP</Text>
                  )}
                </View>
                <View style={[coStyles.statusDot, { backgroundColor: statusColor }]} />
                {agent.status === 'building' && agent.currentTask && (
                  <Text style={coStyles.compactTask} numberOfLines={1}>{agent.currentTask}</Text>
                )}
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // Sort: connected agents first, then unavailable, with most recent first within each group
  const sorted = [...agents].sort((a, b) => {
    const rankDiff = getOfficeStatusSortRank(a.status) - getOfficeStatusSortRank(b.status);
    if (rankDiff !== 0) return rankDiff;
    return new Date(b.lastActiveAt || 0).getTime() - new Date(a.lastActiveAt || 0).getTime();
  });

  const onlineCount = agents.filter(a => isConnectedOfficeStatus(a.status)).length;

  // Full card view for mobile
  return (
    <View style={coStyles.panel}>
      <View style={coStyles.panelHeader}>
        <View>
          <Text style={coStyles.panelTitle}>🏢 Circle Office</Text>
          <View style={coStyles.connectionRow}>
            <View style={[coStyles.connectionDot, { backgroundColor: CONNECTION_STATUS_UI[connectionStatus].color }]} />
            <Text style={[coStyles.connectionLabel, { color: CONNECTION_STATUS_UI[connectionStatus].color }]}>
              {CONNECTION_STATUS_UI[connectionStatus].label}
            </Text>
          </View>
        </View>
        <View style={coStyles.panelStats}>
          {building.length > 0 && <Text style={coStyles.statBuilding}>⚡ {building.length} BUILDING · +{formatBuildMetric(totalBuildingXp)} XP</Text>}
          {connected.length > 0 && <Text style={coStyles.statIdle}>🟢 {connected.length} connected</Text>}
          {offline.length > 0 && <Text style={coStyles.statOffline}>⚫ {offline.length} away</Text>}
        </View>
      </View>

      {sorted.map(agent => {
        const display = PROVIDER_DISPLAY[agent.provider] || PROVIDER_DISPLAY['generic-agent'];
        const isBuilding = agent.status === 'building';
        const isConnected = isConnectedOfficeStatus(agent.status) && !isBuilding;
        const isOffline = !isConnectedOfficeStatus(agent.status) && !isBuilding;
        const lastSeen = getLastSeen(agent.lastActiveAt);
        const buildXp = getBuildXp(agent);
        const buildMinutes = getBuildMinutes(agent);
        const buildTokens = (agent.input_tokens_today || 0) + (agent.output_tokens_today || 0) + (agent.cached_tokens_today || 0);
        const buildActions = agent.message_count_today || 0;

        return (
          <View
            key={agent.id}
            style={[
              coStyles.agentCard,
              isBuilding && coStyles.buildingAgentCard,
              { borderColor: isBuilding ? display.color + '66' : isConnected ? display.color + '33' : '#000000' },
              isBuilding && { backgroundColor: display.color + '10' },
              agent.isOwn && coStyles.ownAgentCard,
              isOffline && coStyles.offlineCard,
            ]}
          >
            {/* Header row */}
            <View style={coStyles.agentCardHeader}>
              <View style={[coStyles.providerBadge, { backgroundColor: display.color + '22', borderColor: display.color + '44' }]}>
                <Text style={coStyles.providerIcon}>{display.icon}</Text>
                <Text style={[coStyles.providerLabel, { color: display.color }]}>{display.label}</Text>
              </View>
              <View style={coStyles.statusChip}>
                <View style={[coStyles.statusDot, {
                  backgroundColor: isBuilding ? '#3b82f6' : isConnected ? '#22c55e' : '#333',
                }]} />
                <Text style={[coStyles.statusText, isBuilding && coStyles.statusTextBuilding, isOffline && { color: '#444' }]}>
                  {isBuilding ? 'BUILDING NOW' : isConnected ? 'connected' : lastSeen.text}
                </Text>
              </View>
            </View>

            {/* Owner + agent name */}
            <View style={coStyles.agentIdentity}>
              <View style={[coStyles.ownerAvatar, { backgroundColor: display.color + '33' }]}>
                <Text style={coStyles.ownerAvatarText}>{agent.ownerDisplayName[0]?.toUpperCase()}</Text>
              </View>
              <View>
                <Text style={coStyles.agentName}>{agent.name}</Text>
                <Text style={coStyles.ownerName}>
                  {agent.isOwn ? '👤 Your agent' : `👤 ${agent.ownerDisplayName}`}
                </Text>
              </View>
            </View>

            {/* Live task if building */}
            {isBuilding && agent.currentTask && (
              <View style={[coStyles.taskBlock, { borderLeftColor: display.color }]}>
                <Text style={coStyles.taskLabel}>BUILDING</Text>
                <Text style={coStyles.taskText}>{agent.currentTask}</Text>
                {agent.currentGoal && (
                  <Text style={coStyles.goalText}>🎯 {agent.currentGoal}</Text>
                )}
                <View style={coStyles.buildStatRow}>
                  <View style={[coStyles.buildStatPill, { borderColor: display.color + '55', backgroundColor: display.color + '18' }]}>
                    <Text style={coStyles.buildStatValue}>+{formatBuildMetric(buildXp)}</Text>
                    <Text style={coStyles.buildStatLabel}>BUILD XP</Text>
                  </View>
                  <View style={coStyles.buildStatPill}>
                    <Text style={coStyles.buildStatValue}>{formatBuildMetric(buildActions)}</Text>
                    <Text style={coStyles.buildStatLabel}>ACTIONS</Text>
                  </View>
                  <View style={coStyles.buildStatPill}>
                    <Text style={coStyles.buildStatValue}>{formatBuildMetric(buildTokens)}</Text>
                    <Text style={coStyles.buildStatLabel}>TOKENS</Text>
                  </View>
                  <View style={coStyles.buildStatPill}>
                    <Text style={coStyles.buildStatValue}>{buildMinutes}M</Text>
                    <Text style={coStyles.buildStatLabel}>HOT</Text>
                  </View>
                </View>
                <Text style={coStyles.buildingFlavor}>
                  BUILDING hard. The work is live and momentum is compounding.
                </Text>
              </View>
            )}

            {/* Session URL */}
            {agent.sessionUrl && (
              <Pressable onPress={() => Linking.openURL(agent.sessionUrl!)} style={coStyles.sessionLink}>
                <Text style={[coStyles.sessionLinkText, { color: display.color }]}>
                  🔗 Watch live →
                </Text>
              </Pressable>
            )}

            {agent.returnTime && isBuilding && (
              <Text style={coStyles.returnTime}>Back: {agent.returnTime}</Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
