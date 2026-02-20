import React, { useState, useEffect, useCallback } from 'react';
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

type Member = {
  id: string;
  username: string;
  display_name: string;
  current_streak: number;
  longest_streak: number;
  bio?: string;
  role?: string;
  joined_at?: string;
  checkedInToday?: boolean;
};

export default function MembersTab({ circleId }: { circleId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchMembers = useCallback(async () => {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError) {
        console.error('Error getting user:', userError);
        return;
      }
      if (user) setCurrentUserId(user.id);

      const { data, error } = await supabase
        .from('circle_members')
        .select('role, joined_at, user:profiles(id, username, display_name, current_streak, longest_streak, bio)')
        .eq('circle_id', circleId)
        .limit(50);

      if (error) {
        console.error('Error fetching members:', error);
        return;
      }

      // Check today's check-ins
      const today = new Date().toISOString().split('T')[0];
      const { data: checkIns, error: checkInError } = await supabase
        .from('check_ins')
        .select('user_id')
        .eq('circle_id', circleId)
        .gte('created_at', today)
        .limit(50);

      if (checkInError) {
        console.error('Error fetching check-ins:', checkInError);
      }

      const checkedInIds = new Set((checkIns || []).map((c: any) => c.user_id));

      const memberList = (data || [])
        .map((d: any) => ({
          ...d.user,
          role: d.role,
          joined_at: d.joined_at,
          checkedInToday: checkedInIds.has(d.user?.id),
        }))
        .filter(Boolean)
        .sort((a: any, b: any) => (b.current_streak || 0) - (a.current_streak || 0));

      setMembers(memberList);
    } catch (err) {
      console.error('Unexpected error in fetchMembers:', err);
    }
  }, [circleId]);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchMembers();
    setRefreshing(false);
  };

  const checkedIn = members.filter((m) => m.checkedInToday).length;

  return (
    <View style={styles.container}>
      {/* Stats */}
      <View style={styles.statsBar}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{members.length}</Text>
          <Text style={styles.statLabel}>MEMBERS</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: checkedIn === members.length ? '#4ade80' : '#e89b3e' }]}>
            {checkedIn}/{members.length}
          </Text>
          <Text style={styles.statLabel}>CHECKED IN</Text>
        </View>
      </View>

      <FlatList
        data={members}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <MemberCard
            member={item}
            rank={index + 1}
            isMe={item.id === currentUserId}
          />
        )}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No members yet</Text>
          </View>
        }
      />
    </View>
  );
}

function MemberCard({ member, rank, isMe }: { member: Member; rank: number; isMe: boolean }) {
  const [hovered, setHovered] = useState(false);
  const medals = ['🥇', '🥈', '🥉'];
  const medal = medals[rank - 1] || `${rank}.`;

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.card, hovered && styles.cardHovered, isMe && styles.cardMe]}
    >
      <View style={styles.cardLeft}>
        <Text style={styles.rank}>{medal}</Text>
        <View style={[styles.avatar, member.checkedInToday ? styles.avatarCheckedIn : styles.avatarNotCheckedIn]}>
          <Text style={styles.avatarText}>
            {(member.display_name || '?').charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={styles.name}>{member.display_name || member.username}</Text>
            {member.role === 'creator' && (
              <View style={styles.creatorBadge}>
                <Text style={styles.creatorText}>FOUNDER</Text>
              </View>
            )}
            {isMe && (
              <View style={styles.youBadge}>
                <Text style={styles.youText}>YOU</Text>
              </View>
            )}
          </View>
          <View style={styles.streakRow}>
            <Text style={styles.streakText}>
              🔥 {member.current_streak || 0} day streak
            </Text>
            {member.current_streak > 0 && member.current_streak >= (member.longest_streak || 0) && (
              <Text style={styles.pbText}>⭐ PB!</Text>
            )}
          </View>
        </View>
      </View>
      <View style={styles.cardRight}>
        {member.checkedInToday ? (
          <View style={styles.checkedBadge}>
            <Text style={styles.checkedText}>✓</Text>
          </View>
        ) : (
          <View style={styles.missingBadge}>
            <Text style={styles.missingText}>—</Text>
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 24,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
  },
  stat: { alignItems: 'center' },
  statNum: { color: '#fff', fontSize: 20, fontWeight: '900' },
  statLabel: { color: '#555', fontSize: 9, letterSpacing: 1.5, fontWeight: '700', marginTop: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: '#222' },
  list: {
    padding: 12,
    maxWidth: 860,
    alignSelf: 'center',
    width: '100%',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 14,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease' } as any : {}),
  },
  cardHovered: { borderColor: '#2a2a2a', backgroundColor: '#131313' },
  cardMe: { borderColor: '#1a2a1a' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  rank: { fontSize: 16, width: 28, textAlign: 'center' },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
  },
  avatarCheckedIn: { backgroundColor: '#1a2e1a', borderColor: '#4ade80' },
  avatarNotCheckedIn: { backgroundColor: '#1a1a1a', borderColor: '#333' },
  avatarText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  info: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  name: { color: '#fff', fontSize: 14, fontWeight: '700' },
  creatorBadge: { backgroundColor: '#2e1a2e', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  creatorText: { color: '#c084fc', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  youBadge: { backgroundColor: '#1a2e1a', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  youText: { color: '#4ade80', fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  streakText: { color: '#666', fontSize: 12 },
  pbText: { color: '#e89b3e', fontSize: 10, fontWeight: '700' },
  cardRight: {},
  checkedBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1a3a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkedText: { color: '#4ade80', fontSize: 14, fontWeight: '800' },
  missingBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1a1a1a',
    justifyContent: 'center',
    alignItems: 'center',
  },
  missingText: { color: '#333', fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 14 },
});
