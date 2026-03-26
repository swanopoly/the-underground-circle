import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Alert,
  Platform,
} from 'react-native';
import { LoadingScreen } from '../../../components/LoadingWave';
import {
  getTeamsConfig,
  initiateTeamsOAuth,
  disconnectTeams,
  getTeamsChannelMappings,
  type TeamsConnection,
  type TeamsChannelMapping,
} from '../../../lib/teams';

type ViewMode = 'setup' | 'connected';

const EVENT_TYPES = [
  { key: 'check_in', label: 'Check-ins', icon: '✅' },
  { key: 'streak_update', label: 'Streak Updates', icon: '🔥' },
  { key: 'task_completed', label: 'Tasks Completed', icon: '📋' },
  { key: 'member_joined', label: 'New Members', icon: '👋' },
];

export default function TeamsTab({ circleId }: { circleId: string }) {
  const [connection, setConnection] = useState<TeamsConnection | null>(null);
  const [mappings, setMappings] = useState<TeamsChannelMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<ViewMode>('setup');

  useEffect(() => {
    loadConfig();
  }, [circleId]);

  const loadConfig = async () => {
    setLoading(true);
    try {
      const config = await getTeamsConfig(circleId);
      setConnection(config);
      if (config) {
        setMode('connected');
        const maps = await getTeamsChannelMappings(config.id, circleId);
        setMappings(maps);
      } else {
        setMode('setup');
      }
    } catch (err) {
      console.error('Teams config error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = () => {
    initiateTeamsOAuth(circleId);
  };

  const handleDisconnect = async () => {
    if (!connection) return;

    const doDisconnect = async () => {
      const { error } = await disconnectTeams(connection.id);
      if (error) {
        if (Platform.OS === 'web') alert(error);
        else Alert.alert('Error', error);
      } else {
        setConnection(null);
        setMode('setup');
      }
    };

    if (Platform.OS === 'web') {
      if (confirm('Disconnect Microsoft Teams?')) doDisconnect();
    } else {
      Alert.alert('Disconnect Teams', 'Remove the Teams integration?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: doDisconnect },
      ]);
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (mode === 'setup') {
    return (
      <View style={styles.centered}>
        <View style={styles.setupCard}>
          <Text style={styles.teamsIcon}>💼</Text>
          <Text style={styles.setupTitle}>Connect Teams</Text>
          <Text style={styles.setupDescription}>
            Get check-in updates, streak notifications, and task completions posted directly to your Microsoft Teams channels.
          </Text>
          <Pressable onPress={handleConnect} style={styles.connectBtn}>
            <Text style={styles.connectBtnText}>Add to Teams</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Connection info */}
      <View style={styles.connectedCard}>
        <View style={styles.connectedHeader}>
          <Text style={styles.connectedIcon}>✅</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.connectedTitle}>Connected to Teams</Text>
            <Text style={styles.teamName}>{connection?.team_name || 'Team'}</Text>
          </View>
          <Pressable onPress={handleDisconnect} style={styles.disconnectBtn}>
            <Text style={styles.disconnectBtnText}>Disconnect</Text>
          </Pressable>
        </View>
      </View>

      {/* Event configuration */}
      <Text style={styles.sectionTitle}>Notifications</Text>
      <Text style={styles.sectionDescription}>
        These events will be posted to your configured Teams channel.
      </Text>

      {EVENT_TYPES.map((event) => {
        const isActive = mappings.some(m => m.event_types.includes(event.key));
        return (
          <View key={event.key} style={styles.eventRow}>
            <Text style={styles.eventIcon}>{event.icon}</Text>
            <Text style={styles.eventLabel}>{event.label}</Text>
            <View style={[styles.statusDot, isActive && styles.statusDotActive]} />
            <Text style={[styles.statusText, isActive && styles.statusTextActive]}>
              {isActive ? 'Active' : 'Off'}
            </Text>
          </View>
        );
      })}

      {/* Channel mappings */}
      {mappings.length > 0 && (
        <>
          <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Channel Mappings</Text>
          {mappings.map((mapping) => (
            <View key={mapping.id} style={styles.mappingRow}>
              <Text style={styles.channelName}>#{mapping.teams_channel_name || mapping.teams_channel_id}</Text>
              <Text style={styles.mappingEvents}>
                {mapping.event_types.join(', ')}
              </Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  setupCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    maxWidth: 400,
    width: '100%',
  },
  teamsIcon: { fontSize: 48, marginBottom: 16 },
  setupTitle: { color: '#fff', fontSize: 20, fontWeight: '700', fontFamily: 'monospace', marginBottom: 8 },
  setupDescription: {
    color: '#888',
    fontSize: 13,
    fontFamily: 'monospace',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 24,
  },
  connectBtn: {
    backgroundColor: '#5B5FC7',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 10,
  },
  connectBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', fontFamily: 'monospace' },
  connectedCard: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#22c55e40',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  connectedHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  connectedIcon: { fontSize: 24 },
  connectedTitle: { color: '#22c55e', fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  teamName: { color: '#ccc', fontSize: 13, fontFamily: 'monospace' },
  disconnectBtn: {
    backgroundColor: '#ef444415',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  disconnectBtnText: { color: '#ef4444', fontSize: 12, fontFamily: 'monospace' },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginBottom: 4 },
  sectionDescription: { color: '#888', fontSize: 12, fontFamily: 'monospace', marginBottom: 12 },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    gap: 10,
  },
  eventIcon: { fontSize: 16 },
  eventLabel: { flex: 1, color: '#ccc', fontSize: 13, fontFamily: 'monospace' },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#555',
  },
  statusDotActive: { backgroundColor: '#22c55e' },
  statusText: { color: '#555', fontSize: 11, fontFamily: 'monospace', width: 40 },
  statusTextActive: { color: '#22c55e' },
  mappingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
  },
  channelName: { color: '#5B5FC7', fontSize: 13, fontFamily: 'monospace' },
  mappingEvents: { color: '#888', fontSize: 11, fontFamily: 'monospace' },
});
