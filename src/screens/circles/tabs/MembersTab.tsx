import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Platform,
  Pressable,
  RefreshControl,
} from 'react-native';
import { supabase } from '../../../lib/supabase';

export default function MembersTab({ circleId }: { circleId: string }) {
  const [members, setMembers] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [circleInfo, setCircleInfo] = useState<any>(null);

  const fetchMembers = async () => {
    const { data } = await supabase
      .from('circle_members')
      .select('*, user:profiles(id, username, display_name, current_streak, longest_streak, bio)')
      .eq('circle_id', circleId)
      .order('joined_at', { ascending: true });

    setMembers(data || []);

    const { data: circle } = await supabase
      .from('circles')
      .select('*')
      .eq('id', circleId)
      .single();
    
    setCircleInfo(circle);
  };

  useEffect(() => {
    fetchMembers();
  }, [circleId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMembers();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      {/* Circle Info Card */}
      {circleInfo && (
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={styles.infoItem}>
              <Text style={styles.infoNumber}>{members.length}</Text>
              <Text style={styles.infoLabel}>MEMBERS</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoItem}>
              <Text style={styles.infoNumber}>{circleInfo.max_members}</Text>
              <Text style={styles.infoLabel}>MAX</Text>
            </View>
            <View style={styles.infoDivider} />
            <View style={styles.infoItem}>
              <Text style={styles.infoCode}>{circleInfo.invite_code}</Text>
              <Text style={styles.infoLabel}>INVITE CODE</Text>
            </View>
          </View>
        </View>
      )}

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <MemberCard member={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
      />
    </View>
  );
}

function MemberCard({ member }: { member: any }) {
  const [hovered, setHovered] = useState(false);
  const user = member.user;
  const isCreator = member.role === 'creator';

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.memberCard, hovered && styles.memberCardHovered]}
    >
      <View style={styles.memberLeft}>
        <View style={[styles.avatar, isCreator && styles.avatarCreator]}>
          <Text style={styles.avatarText}>
            {(user?.display_name || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.memberInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.memberName}>{user?.display_name || user?.username}</Text>
            {isCreator && (
              <View style={styles.creatorBadge}>
                <Text style={styles.creatorText}>CREATOR</Text>
              </View>
            )}
          </View>
          <Text style={styles.memberUsername}>@{user?.username}</Text>
          {user?.bio && <Text style={styles.memberBio} numberOfLines={1}>{user.bio}</Text>}
        </View>
      </View>

      <View style={styles.memberStats}>
        <View style={styles.stat}>
          <Text style={styles.statNumber}>{user?.current_streak || 0}</Text>
          <Text style={styles.statLabel}>🔥</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  infoCard: {
    backgroundColor: '#111',
    margin: 16,
    borderRadius: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: '#222',
    maxWidth: 580,
    alignSelf: 'center',
    width: 'calc(100% - 32px)' as any,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  infoItem: {
    alignItems: 'center',
  },
  infoNumber: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    marginBottom: 4,
  },
  infoCode: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 2,
    marginBottom: 4,
  },
  infoLabel: {
    color: '#555',
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '700',
  },
  infoDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#222',
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 20,
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  memberCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease' } as any : {}),
  },
  memberCardHovered: {
    borderColor: '#2a2a2a',
    backgroundColor: '#131313',
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarCreator: {
    borderWidth: 2,
    borderColor: '#f0c040',
  },
  avatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  memberInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  memberName: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  creatorBadge: {
    backgroundColor: '#2a2510',
    borderRadius: 6,
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderWidth: 1,
    borderColor: '#3a3520',
  },
  creatorText: {
    color: '#f0c040',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  memberUsername: {
    color: '#555',
    fontSize: 12,
    marginTop: 2,
  },
  memberBio: {
    color: '#444',
    fontSize: 12,
    marginTop: 4,
  },
  memberStats: {
    alignItems: 'center',
  },
  stat: {
    alignItems: 'center',
  },
  statNumber: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  statLabel: {
    fontSize: 12,
    marginTop: 2,
  },
});
