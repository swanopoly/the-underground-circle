import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { User } from '../../types';
import PageContainer from '../../components/PageContainer';
import Card from '../../components/Card';
import Button from '../../components/Button';

export default function ProfileScreen() {
  const [profile, setProfile] = useState<User | null>(null);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (data) setProfile(data);
  };

  const handleSignOut = async () => {
    if (Platform.OS === 'web') {
      if (window.confirm('You sure you want to sign out?')) {
        await supabase.auth.signOut();
      }
    } else {
      // For mobile, use Alert
      const { Alert } = require('react-native');
      Alert.alert('Leave?', 'You sure you want to sign out?', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
      ]);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>PROFILE</Text>
      </View>

      <PageContainer>
        <Card style={styles.profileCard}>
          <View style={styles.avatarSection}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
            <Text style={styles.displayName}>{profile?.display_name || 'Loading...'}</Text>
            <Text style={styles.username}>@{profile?.username || '...'}</Text>
          </View>
        </Card>

        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Text style={styles.statNumber}>{profile?.current_streak || 0}</Text>
            <Text style={styles.statLabel}>CURRENT{'\n'}STREAK</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statNumber}>{profile?.longest_streak || 0}</Text>
            <Text style={styles.statLabel}>LONGEST{'\n'}STREAK</Text>
          </Card>
        </View>

        {profile?.bio && (
          <Card style={styles.bioCard}>
            <Text style={styles.bioLabel}>BIO</Text>
            <Text style={styles.bioText}>{profile.bio}</Text>
          </Card>
        )}

        <View style={styles.spacer} />

        <Button
          title="SIGN OUT"
          variant="ghost"
          onPress={handleSignOut}
          style={styles.signOutButton}
        />
      </PageContainer>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    paddingTop: 60,
    paddingBottom: 20,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 3,
  },
  profileCard: {
    alignItems: 'center',
    padding: 28,
    marginBottom: 16,
  },
  avatarSection: {
    alignItems: 'center',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#1a1a2e',
    borderWidth: 2,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  avatarText: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
  },
  displayName: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  username: {
    color: '#666',
    fontSize: 14,
    marginTop: 4,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    alignItems: 'center',
    padding: 20,
  },
  statNumber: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    marginBottom: 6,
  },
  statLabel: {
    color: '#666',
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 14,
  },
  bioCard: {
    marginBottom: 16,
  },
  bioLabel: {
    color: '#666',
    fontSize: 10,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 8,
  },
  bioText: {
    color: '#ccc',
    fontSize: 15,
    lineHeight: 22,
  },
  spacer: {
    height: 20,
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: '#222',
  },
});
