import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  Linking,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { Integration } from '../../types';
import Card from '../../components/Card';
import Button from '../../components/Button';
import {
  getUserIntegrations,
  disconnectIntegration,
  platformConnections,
} from '../../lib/integrations';

export default function IntegrationsScreen({ navigation }: any) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadIntegrations();
  }, []);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const data = await getUserIntegrations('');
      setIntegrations(data);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
    setLoading(false);
  };

  const handleConnect = async (platform: keyof typeof platformConnections) => {
    const connection = platformConnections[platform];
    
    Alert.alert(
      'Coming Soon!',
      `${connection.name} integration is coming soon! For now, this would open:\n\n${connection.connectUrl}`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Open Demo',
          onPress: () => {
            // In production, this would handle OAuth flow
            // For demo, we'll just show the URL
            Linking.openURL(connection.connectUrl).catch(() => {
              Alert.alert('Info', `Would redirect to: ${connection.connectUrl}`);
            });
          },
        },
      ]
    );
  };

  const handleDisconnect = async (platform: Integration['platform']) => {
    const connection = platformConnections[platform as keyof typeof platformConnections];
    if (!connection) return;
    
    Alert.alert(
      'Disconnect',
      `Are you sure you want to disconnect your ${connection.name} account?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            try {
              await disconnectIntegration(platform);
              Alert.alert('Success', `${connection.name} disconnected`);
              loadIntegrations();
            } catch (error: any) {
              Alert.alert('Error', error.message);
            }
          },
        },
      ]
    );
  };

  const getConnectionStatus = (platform: keyof typeof platformConnections) => {
    return integrations.find(int => int.platform === platform && int.is_active);
  };

  const formatLastSync = (dateString?: string) => {
    if (!dateString) return 'Never synced';
    
    const diff = Date.now() - new Date(dateString).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just synced';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const connectedCount = integrations.filter(int => int.is_active).length;
  const totalPlatforms = Object.keys(platformConnections).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()}>
          <Text style={styles.headerBack}>← BACK</Text>
        </Pressable>
        <Text style={styles.headerTitle}>INTEGRATIONS</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.inner}>
          {/* Overview Card */}
          <Card style={styles.overviewCard}>
            <Text style={styles.overviewTitle}>CONNECTED SERVICES</Text>
            <View style={styles.overviewStats}>
              <Text style={styles.overviewNumber}>{connectedCount}</Text>
              <Text style={styles.overviewLabel}>of {totalPlatforms} platforms</Text>
            </View>
            <Text style={styles.overviewDesc}>
              Connect your favorite platforms to sync data and automate your grinding experience.
            </Text>
          </Card>

          {/* Social & Communication */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>SOCIAL & COMMUNICATION</Text>
            {(['discord', 'twitter'] as const).map(platform => {
              const connection = platformConnections[platform];
              const integration = getConnectionStatus(platform);
              
              return (
                <Card key={platform} style={styles.integrationCard}>
                  <View style={styles.integrationInfo}>
                    <View style={styles.integrationIcon}>
                      <Text style={styles.integrationEmoji}>{connection.icon}</Text>
                    </View>
                    <View style={styles.integrationDetails}>
                      <Text style={styles.integrationName}>{connection.name}</Text>
                      {integration ? (
                        <View>
                          <Text style={styles.integrationConnected}>
                            ✓ Connected as @{integration.platform_username || 'unknown'}
                          </Text>
                          <Text style={styles.integrationSync}>
                            Last sync: {formatLastSync(integration.last_sync)}
                          </Text>
                        </View>
                      ) : (
                        <Text style={styles.integrationDisconnected}>Not connected</Text>
                      )}
                    </View>
                  </View>
                  
                  {integration ? (
                    <Button
                      title="DISCONNECT"
                      variant="ghost"
                      onPress={() => handleDisconnect(platform)}
                      style={styles.actionButton}
                    />
                  ) : (
                    <Button
                      title="CONNECT"
                      onPress={() => handleConnect(platform)}
                      style={styles.actionButton}
                    />
                  )}
                </Card>
              );
            })}
          </View>

          {/* Development */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>DEVELOPMENT</Text>
            {(['github'] as const).map(platform => {
              const connection = platformConnections[platform];
              const integration = getConnectionStatus(platform);
              
              return (
                <Card key={platform} style={styles.integrationCard}>
                  <View style={styles.integrationInfo}>
                    <View style={styles.integrationIcon}>
                      <Text style={styles.integrationEmoji}>{connection.icon}</Text>
                    </View>
                    <View style={styles.integrationDetails}>
                      <Text style={styles.integrationName}>{connection.name}</Text>
                      {integration ? (
                        <View>
                          <Text style={styles.integrationConnected}>
                            ✓ Connected as @{integration.platform_username || 'unknown'}
                          </Text>
                          <Text style={styles.integrationSync}>
                            Last sync: {formatLastSync(integration.last_sync)}
                          </Text>
                        </View>
                      ) : (
                        <View>
                          <Text style={styles.integrationDisconnected}>Not connected</Text>
                          <Text style={styles.integrationBenefit}>
                            Track commits, PRs, and coding streaks
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  
                  {integration ? (
                    <Button
                      title="DISCONNECT"
                      variant="ghost"
                      onPress={() => handleDisconnect(platform)}
                      style={styles.actionButton}
                    />
                  ) : (
                    <Button
                      title="CONNECT"
                      onPress={() => handleConnect(platform)}
                      style={styles.actionButton}
                    />
                  )}
                </Card>
              );
            })}
          </View>

          {/* Entertainment */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ENTERTAINMENT</Text>
            {(['spotify'] as const).map(platform => {
              const connection = platformConnections[platform];
              const integration = getConnectionStatus(platform);
              
              return (
                <Card key={platform} style={styles.integrationCard}>
                  <View style={styles.integrationInfo}>
                    <View style={styles.integrationIcon}>
                      <Text style={styles.integrationEmoji}>{connection.icon}</Text>
                    </View>
                    <View style={styles.integrationDetails}>
                      <Text style={styles.integrationName}>{connection.name}</Text>
                      {integration ? (
                        <View>
                          <Text style={styles.integrationConnected}>
                            ✓ Connected as @{integration.platform_username || 'unknown'}
                          </Text>
                          <Text style={styles.integrationSync}>
                            Last sync: {formatLastSync(integration.last_sync)}
                          </Text>
                        </View>
                      ) : (
                        <View>
                          <Text style={styles.integrationDisconnected}>Not connected</Text>
                          <Text style={styles.integrationBenefit}>
                            Share your grinding playlist and music stats
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  
                  {integration ? (
                    <Button
                      title="DISCONNECT"
                      variant="ghost"
                      onPress={() => handleDisconnect(platform)}
                      style={styles.actionButton}
                    />
                  ) : (
                    <Button
                      title="CONNECT"
                      onPress={() => handleConnect(platform)}
                      style={styles.actionButton}
                    />
                  )}
                </Card>
              );
            })}
          </View>

          {/* Fitness */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>FITNESS & HEALTH</Text>
            {(['fitbit', 'strava'] as const).map(platform => {
              const connection = platformConnections[platform];
              const integration = getConnectionStatus(platform);
              
              return (
                <Card key={platform} style={styles.integrationCard}>
                  <View style={styles.integrationInfo}>
                    <View style={styles.integrationIcon}>
                      <Text style={styles.integrationEmoji}>{connection.icon}</Text>
                    </View>
                    <View style={styles.integrationDetails}>
                      <Text style={styles.integrationName}>{connection.name}</Text>
                      {integration ? (
                        <View>
                          <Text style={styles.integrationConnected}>
                            ✓ Connected as @{integration.platform_username || 'unknown'}
                          </Text>
                          <Text style={styles.integrationSync}>
                            Last sync: {formatLastSync(integration.last_sync)}
                          </Text>
                        </View>
                      ) : (
                        <View>
                          <Text style={styles.integrationDisconnected}>Not connected</Text>
                          <Text style={styles.integrationBenefit}>
                            {platform === 'fitbit' 
                              ? 'Track steps, heart rate, and sleep data' 
                              : 'Sync workouts and running activities'}
                          </Text>
                        </View>
                      )}
                    </View>
                  </View>
                  
                  {integration ? (
                    <Button
                      title="DISCONNECT"
                      variant="ghost"
                      onPress={() => handleDisconnect(platform)}
                      style={styles.actionButton}
                    />
                  ) : (
                    <Button
                      title="CONNECT"
                      onPress={() => handleConnect(platform)}
                      style={styles.actionButton}
                    />
                  )}
                </Card>
              );
            })}
          </View>

          {/* Privacy & Security */}
          <Card style={styles.privacyCard}>
            <Text style={styles.privacyTitle}>🔒 PRIVACY & SECURITY</Text>
            <Text style={styles.privacyDesc}>
              Your integration data is encrypted and stored securely. You can disconnect any service at any time.
            </Text>
            <Text style={styles.privacyNote}>
              We only access the minimum data required for each integration and never share your personal information.
            </Text>
          </Card>

          <View style={{ height: 40 }} />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    maxWidth: 720,
    alignSelf: 'center',
    width: '100%',
  },
  headerBack: { color: '#6366f1', fontSize: 14, fontWeight: '700' },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '900', letterSpacing: 2 },

  scrollContent: { flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
  },

  // Overview
  overviewCard: { alignItems: 'center', padding: 24, marginBottom: 24 },
  overviewTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
  },
  overviewStats: { alignItems: 'center', marginBottom: 12 },
  overviewNumber: {
    color: '#6366f1',
    fontSize: 48,
    fontWeight: '900',
    lineHeight: 48,
  },
  overviewLabel: {
    color: '#666',
    fontSize: 12,
    letterSpacing: 1,
    marginTop: 4,
  },
  overviewDesc: {
    color: '#888',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },

  // Sections
  section: { marginBottom: 24 },
  sectionTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
  },

  // Integration cards
  integrationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
    padding: 16,
  },
  integrationInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  integrationIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  integrationEmoji: { fontSize: 20 },
  integrationDetails: { flex: 1 },
  integrationName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  integrationConnected: {
    color: '#22c55e',
    fontSize: 12,
    marginBottom: 2,
  },
  integrationDisconnected: {
    color: '#666',
    fontSize: 12,
    marginBottom: 2,
  },
  integrationSync: {
    color: '#444',
    fontSize: 10,
  },
  integrationBenefit: {
    color: '#888',
    fontSize: 11,
    lineHeight: 14,
  },
  actionButton: {
    minHeight: 32,
    paddingHorizontal: 16,
  },

  // Privacy
  privacyCard: {
    padding: 20,
    backgroundColor: '#0f0f0f',
    borderColor: '#2a2a2a',
  },
  privacyTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
    marginBottom: 12,
  },
  privacyDesc: {
    color: '#ccc',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 8,
  },
  privacyNote: {
    color: '#666',
    fontSize: 11,
    lineHeight: 16,
    fontStyle: 'italic',
  },
});