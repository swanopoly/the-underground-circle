import React, { useState, useEffect, lazy, Suspense } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform as RNPlatform,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { getSlackConfig } from '../../../lib/slack';
import { getTeamsConfig } from '../../../lib/teams';
import { getCircleDiscordConfig } from '../../../lib/discord';

// Lazy-load platform sub-tabs — only one is visible at a time
const SlackTab = lazy(() => import('./SlackTab'));
const TeamsTab = lazy(() => import('./TeamsTab'));
const DiscordTab = lazy(() => import('./DiscordTab'));
const GitHubTab = lazy(() => import('./GitHubTab'));
const HeliusTab = lazy(() => import('./HeliusTab'));

type PlatformKey = 'none' | 'github' | 'slack' | 'teams' | 'discord' | 'helius';

interface PlatformStatus {
  connected: boolean;
  name?: string;
}

const PLATFORMS = [
  {
    key: 'github' as const,
    label: 'GitHub',
    icon: '{>}',
    color: '#238636',
    description: 'Receive push, PR, issue, release, and CI events from your repos',
  },
  {
    key: 'slack' as const,
    label: 'Slack',
    icon: '💬',
    color: '#4A154B',
    description: 'Post check-ins, streaks, and updates to Slack channels',
  },
  {
    key: 'teams' as const,
    label: 'Microsoft Teams',
    icon: '💼',
    color: '#5B5FC7',
    description: 'Send notifications to Teams channels',
  },
  {
    key: 'discord' as const,
    label: 'Discord',
    icon: '🎮',
    color: '#5865F2',
    description: 'Browse channels, send messages, and sync your server',
  },
  {
    key: 'helius' as const,
    label: 'Helius (Solana)',
    icon: '◎',
    color: '#9945FF',
    description: 'Solana RPC, token balances, swaps via Jupiter, and trading bot',
  },
];

function PlatformCard({ platform, status, isWide, onPress }: {
  platform: typeof PLATFORMS[number];
  status: PlatformStatus;
  isWide: boolean;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      {...(RNPlatform.OS === 'web' ? {
        onHoverIn: () => setHovered(true),
        onHoverOut: () => setHovered(false),
      } : {})}
      style={[
        styles.platformCard,
        isWide && styles.platformCardWide,
        { borderColor: status.connected ? platform.color + '40' : '#2a2a2a' },
        hovered && styles.platformCardHovered,
        hovered && { borderColor: platform.color + '60' },
      ]}
    >
      <View style={styles.cardTop}>
        <View style={[styles.iconCircle, { backgroundColor: platform.color + '18' }]}>
          <Text style={styles.platformIconText}>{platform.icon}</Text>
        </View>
        <View style={[
          styles.statusBadge,
          status.connected && { backgroundColor: '#22c55e15', borderColor: '#22c55e30' },
        ]}>
          <View style={[styles.statusDot, status.connected && { backgroundColor: '#22c55e' }]} />
          <Text style={[styles.statusLabel, status.connected && { color: '#22c55e' }]}>
            {status.connected ? 'Active' : 'Inactive'}
          </Text>
        </View>
      </View>

      <Text style={[styles.platformName, { color: platform.color }]}>
        {platform.label}
      </Text>

      {status.connected && status.name && (
        <Text style={styles.connectedTo}>{status.name}</Text>
      )}

      <Text style={styles.platformDesc}>{platform.description}</Text>

      <View style={[
        styles.cardAction,
        { backgroundColor: platform.color + '12', borderColor: platform.color + '25' },
      ]}>
        <Text style={[styles.cardActionText, { color: platform.color }]}>
          {status.connected ? 'Manage' : 'Connect'} →
        </Text>
      </View>
    </Pressable>
  );
}

export default function IntegrationsTab({ circleId }: { circleId: string }) {
  const { width } = useWindowDimensions();
  const isWide = width > 560;
  const [activePlatform, setActivePlatform] = useState<PlatformKey>('none');
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Record<string, PlatformStatus>>({
    github: { connected: false },
    slack: { connected: false },
    teams: { connected: false },
    discord: { connected: false },
    helius: { connected: false },
  });

  useEffect(() => {
    loadStatuses();
  }, [circleId]);

  const loadStatuses = async () => {
    setLoading(true);
    try {
      const [slackConfig, teamsConfig, discordConfig, ghConns, heliusKey] = await Promise.all([
        getSlackConfig(circleId).catch(() => null),
        getTeamsConfig(circleId).catch(() => null),
        getCircleDiscordConfig(circleId).catch(() => ({ guild_id: null, bot_token: null, webhook_url: null, connected_at: null })),
        supabase
          .from('circle_github_connections')
          .select('full_name')
          .eq('circle_id', circleId)
          .eq('is_active', true)
          .then(r => r.data, () => null),
        supabase.rpc('list_user_api_keys')
          .then(r => {
            const keys = r.data || [];
            return keys.find((k: any) => k.provider === 'helius' && k.is_active) || null;
          }, () => null),
      ]);

      setStatuses({
        github: {
          connected: !!(ghConns && ghConns.length > 0),
          name: ghConns && ghConns.length > 0
            ? `${ghConns.length} repo${ghConns.length > 1 ? 's' : ''} connected`
            : undefined,
        },
        slack: {
          connected: !!slackConfig,
          name: slackConfig?.team_name || undefined,
        },
        teams: {
          connected: !!teamsConfig,
          name: teamsConfig?.team_name || undefined,
        },
        discord: {
          connected: !!discordConfig?.guild_id,
          name: discordConfig?.guild_id ? 'Server connected' : undefined,
        },
        helius: {
          connected: !!heliusKey,
          name: heliusKey ? 'API key active' : undefined,
        },
      });
    } catch (err) {
      console.error('Integration status load error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleBack = () => {
    setActivePlatform('none');
    loadStatuses();
  };

  const connectedCount = Object.values(statuses).filter(s => s.connected).length;

  // Show the selected platform's full management UI
  if (activePlatform !== 'none') {
    return (
      <View style={styles.container}>
        <View style={styles.inner}>
          <Pressable onPress={handleBack} style={styles.backRow}>
            <Text style={styles.backText}>← All Integrations</Text>
          </Pressable>
          <View style={styles.platformContent}>
            <Suspense fallback={<ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />}>
              {activePlatform === 'github' && <GitHubTab circleId={circleId} />}
              {activePlatform === 'slack' && <SlackTab circleId={circleId} />}
              {activePlatform === 'teams' && <TeamsTab circleId={circleId} />}
              {activePlatform === 'discord' && <DiscordTab circleId={circleId} />}
              {activePlatform === 'helius' && <HeliusTab circleId={circleId} />}
            </Suspense>
          </View>
        </View>
      </View>
    );
  }

  // Overview: show all platforms
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.headerBlock}>
          <View style={styles.headerTop}>
            <View style={styles.headerLeft}>
              <Text style={styles.headerTitle}>Integrations</Text>
              <Text style={styles.headerDesc}>
                Connect platforms for notifications, messaging, and sync.
              </Text>
            </View>
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeNum}>{connectedCount}</Text>
              <Text style={styles.headerBadgeSlash}>/{PLATFORMS.length}</Text>
            </View>
          </View>
        </View>

        {/* Status pips */}
        {!loading && (
          <View style={styles.statusBar}>
            <View style={styles.statusPips}>
              {PLATFORMS.map(p => (
                <View
                  key={p.key}
                  style={[
                    styles.statusPip,
                    { backgroundColor: statuses[p.key].connected ? p.color : '#333' },
                  ]}
                />
              ))}
            </View>
            <Text style={styles.statusText}>
              {connectedCount === 0 ? 'No platforms connected' :
               connectedCount === PLATFORMS.length ? 'All platforms active' :
               `${connectedCount} of ${PLATFORMS.length} connected`}
            </Text>
          </View>
        )}

        {/* Platform Grid */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color="#6366f1" size="large" />
          </View>
        ) : (
          <View style={[styles.platformGrid, isWide && styles.platformGridWide]}>
            {PLATFORMS.map((platform) => {
              const status = statuses[platform.key];
              return (
                <PlatformCard
                  key={platform.key}
                  platform={platform}
                  status={status}
                  isWide={isWide}
                  onPress={() => setActivePlatform(platform.key)}
                />
              );
            })}
          </View>
        )}

        {/* Footer hint */}
        {!loading && (
          <View style={styles.footerHint}>
            <Text style={styles.footerHintText}>
              More integrations coming soon
            </Text>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: 40 },
  inner: {
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center' as const,
    padding: 16,
  },

  // Header
  headerBlock: {
    marginBottom: 16,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  headerLeft: { flex: 1, marginRight: 16 },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginBottom: 6,
  },
  headerDesc: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'monospace',
    lineHeight: 20,
  },
  headerBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    backgroundColor: '#111',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  headerBadgeNum: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  headerBadgeSlash: {
    color: '#555',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // Status bar
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#000000',
    gap: 10,
  },
  statusPips: {
    flexDirection: 'row',
    gap: 6,
  },
  statusPip: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    color: '#666',
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: '600',
  },

  // Loading
  loadingContainer: { paddingVertical: 60, alignItems: 'center' },

  // Platform grid
  platformGrid: {
    gap: 12,
  },
  platformGridWide: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },

  // Platform card
  platformCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderRadius: 14,
    padding: 20,
    ...(RNPlatform.OS === 'web' ? { transition: 'all 0.2s ease', cursor: 'pointer' } as any : {}),
  },
  platformCardWide: {
    flexBasis: '48%' as any,
    flexGrow: 1,
  },
  platformCardHovered: {
    backgroundColor: '#161616',
    ...(RNPlatform.OS === 'web' ? { transform: [{ translateY: -2 }] } : {}),
  },

  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  platformIconText: { fontSize: 22 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#555',
  },
  statusLabel: { color: '#555', fontSize: 11, fontFamily: 'monospace', fontWeight: '600' },
  platformName: { fontSize: 16, fontWeight: '700', fontFamily: 'monospace', marginBottom: 4 },
  connectedTo: { color: '#aaa', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
  platformDesc: { color: '#777', fontSize: 12, fontFamily: 'monospace', lineHeight: 18, marginBottom: 16 },
  cardAction: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  cardActionText: { fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },

  // Footer
  footerHint: {
    marginTop: 20,
    paddingVertical: 12,
    alignItems: 'center',
  },
  footerHintText: { color: '#444', fontSize: 11, fontFamily: 'monospace' },

  // Back / platform detail
  backRow: {
    paddingBottom: 12,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  backText: { color: '#6366f1', fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  platformContent: { flex: 1 },
});
