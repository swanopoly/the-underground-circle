import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { User } from '../../types';

export default function ProfileScreen() {
  const { signOut } = useAuth();
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

  const handleSignOut = () => {
    Alert.alert('Leave?', 'You sure you want to sign out?', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Sign Out',
        style: 'destructive',
        onPress: () => signOut(),
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>PROFILE</Text>
      </View>

      <View style={styles.profileCard}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
          </Text>
        </View>
        <Text style={styles.displayName}>{profile?.display_name || 'Loading...'}</Text>
        <Text style={styles.username}>@{profile?.username || '...'}</Text>

        <View style={styles.stats}>
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{profile?.current_streak || 0}</Text>
            <Text style={styles.statLabel}>CURRENT STREAK</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statNumber}>{profile?.longest_streak || 0}</Text>
            <Text style={styles.statLabel}>LONGEST STREAK</Text>
          </View>
        </View>
      </View>

      {profile?.bio && (
        <View style={styles.bioCard}>
          <Text style={styles.bioLabel}>BIO</Text>
          <Text style={styles.bioText}>{profile.bio}</Text>
        </View>
      )}

      <View style={styles.bottom}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>SIGN OUT</Text>
        </TouchableOpacity>
      </View>
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
  },
  headerTitle: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 3,
  },
  profileCard: {
    alignItems: 'center',
    padding: 32,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1a1a1a',
    borderWidth: 2,
    borderColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  avatarText: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
  },
  displayName: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '700',
  },
  username: {
    color: '#888',
    fontSize: 14,
    marginTop: 4,
  },
  stats: {
    flexDirection: 'row',
    marginTop: 32,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
  },
  statDivider: {
    width: 1,
    backgroundColor: '#333',
  },
  statNumber: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '900',
  },
  statLabel: {
    color: '#888',
    fontSize: 10,
    letterSpacing: 1,
    marginTop: 4,
    fontWeight: '700',
  },
  bioCard: {
    marginHorizontal: 24,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  bioLabel: {
    color: '#888',
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
  bottom: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 24,
    paddingBottom: 40,
  },
  signOutButton: {
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  signOutText: {
    color: '#ff4444',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
  },
});
