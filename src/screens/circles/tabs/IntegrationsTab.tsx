import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { getSlackConfig, type SlackConnection } from '../../../lib/slack';
import { getTeamsConfig, type TeamsConnection } from '../../../lib/teams';
import { getCircleDiscordConfig, type CircleDiscordConfig } from '../../../lib/discord';
import SlackTab from './SlackTab';
import TeamsTab from './TeamsTab';
import DiscordTab from './DiscordTab';

type Platform = 'none' | 'slack' | 'teams' | 'discord';

interface PlatformStatus {
  connected: boolean;
  name?: string;
}

const PLATFORMS = [
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
];

export default function IntegrationsTab({ circleId }: { circleId: string }) {
  const [activePlatform, setActivePlatform] = useState<Platform>('none');
  const [loading, setLoading] = useState(true);
  const [statuses, setStatuses] = useState<Record<string, PlatformStatus>>({
    slack: { connected: false },
    teams: { connected: false },
    discord: { connected: false },
  });

  useEffect(() => {
    loadStatuses();
  }, [circleId]);

  const loadStatuses = async () => {
    setLoading(true);
    try {
      const [slackConfig, teamsConfig, discordConfig] = await Promise.all([
        getSlackConfig(circleId).catch(() => null),
        getTeamsConfig(circleId).catch(() => null),
        getCircleDiscordConfig(circleId).catch(() => ({ guild_id: null, bot_token: null, webhook_url: null, connected_at: null })),
      ]);

      setStatuses({
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

  // Show the selected platform's full management UI
  if (activePlatform !== 'none') {
    return (
      <View style={styles.container}>
        <Pressable onPress={handleBack} style={styles.backRow}>
          <Text style={styles.backText}>← All Integrations</Text>
        </Pressable>
        <View style={styles.platformContent}>
          {activePlatform === 'slack' && <SlackTab circleId={circleId} />}
          {activePlatform === 'teams' && <TeamsTab circleId={circleId} />}
          {activePlatform === 'discord' && <DiscordTab circleId={circleId} />}
        </View>
      </View>
    );
  }

  // Overview: show all platforms
  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <Text style={styles.headerTitle}>Integrations</Text>
      <Text style={styles.headerDesc}>
        Connect your circle to external platforms for notifications, messaging, and sync.
      </Text>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#6366f1" size="large" />
        </View>
      ) : (
        <View style={styles.platformGrid}>
          {PLATFORMS.map((platform) => {
            const status = statuses[platform.key];
            return (
              <Pressable
                key={platform.key}
                onPress={() => setActivePlatform(platform.key)}
                style={[styles.platformCard, { borderColor: status.connected ? platform.color + '50' : '#1a1a2e' }]}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.iconCircle, { backgroundColor: platform.color + '20' }]}>
                    <Text style={styles.platformIcon}>{platform.icon}</Text>
                  </View>
                  <View style={styles.statusBadge}>
                    <View style={[styles.statusDot, status.connected && { backgroundColor: '#22c55e' }]} />
                    <Text style={[styles.statusLabel, status.connected && { color: '#22c55e' }]}>
                      {status.connected ? 'Connected' : 'Not connected'}
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

                <View style={[styles.cardAction, { backgroundColor: platform.color + '15', borderColor: platform.color + '30' }]}>
                  <Text style={[styles.cardActionText, { color: platform.color }]}>
                    {status.connected ? 'Manage' : 'Connect'} →
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}

      {/* Connected count summary */}
      {!loading && (
        <View style={styles.summaryRow}>
          <Text style={styles.summaryText}>
            {Object.values(statuses).filter(s => s.connected).length} of {PLATFORMS.length} connected
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700', fontFamily: 'monospace', marginBottom: 4 },
  headerDesc: { color: '#888', fontSize: 12, fontFamily: 'monospace', lineHeight: 18, marginBottom: 20 },
  loadingContainer: { paddingVertical: 60, alignItems: 'center' },
  platformGrid: { gap: 12 },
  platformCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderRadius: 14,
    padding: 18,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  iconCircle: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  platformIcon: { fontSize: 22 },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#555',
  },
  statusLabel: { color: '#555', fontSize: 11, fontFamily: 'monospace' },
  platformName: { fontSize: 16, fontWeight: '700', fontFamily: 'monospace', marginBottom: 2 },
  connectedTo: { color: '#ccc', fontSize: 12, fontFamily: 'monospace', marginBottom: 4 },
  platformDesc: { color: '#888', fontSize: 12, fontFamily: 'monospace', lineHeight: 18, marginBottom: 14 },
  cardAction: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
  },
  cardActionText: { fontSize: 13, fontWeight: '700', fontFamily: 'monospace' },
  summaryRow: {
    marginTop: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a2e',
    alignItems: 'center',
  },
  summaryText: { color: '#555', fontSize: 11, fontFamily: 'monospace' },
  backRow: {
    paddingBottom: 12,
    marginBottom: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  backText: { color: '#6366f1', fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  platformContent: { flex: 1 },
});
