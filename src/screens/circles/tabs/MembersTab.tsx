import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  Platform,
  Pressable,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { getSupabaseClientForAccessToken } from '../../../lib/supabase';
import { usePaginated } from '../../../hooks/usePaginated';
import { useAuth } from '../../../hooks/useAuth';
import { indexSafeProfiles, loadSafeCircleProfiles } from '../../../lib/safeProfiles';

// Supabase's generated types return the `user:profiles(...)` join as an array
// even though the relationship is one-to-one; loose-typing matches the original
// fetch logic rather than fighting the generator.
type MemberRow = {
  role: string;
  joined_at: string;
  user: any;
};

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

const PAGE_SIZE = 25;

export default function MembersTab({ circleId }: { circleId: string }) {
  const { session, user, loading: authLoading } = useAuth();
  const [checkedInIds, setCheckedInIds] = useState<Set<string>>(new Set());
  const authUserId = user?.id || null;
  const currentUserId = !authLoading && authUserId === session?.user.id ? authUserId : null;
  const accessToken = currentUserId ? session?.access_token || null : null;
  const exactReadClient = useMemo(
    () => accessToken ? getSupabaseClientForAccessToken(accessToken) : null,
    [accessToken],
  );

  // Today's check-ins — separate query so it doesn't slow first paint of the
  // members list. Refreshed whenever members refresh.
  const loadCheckIns = useCallback(async () => {
    if (!exactReadClient) return;
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await exactReadClient
      .from('check_ins')
      .select('user_id')
      .eq('circle_id', circleId)
      .gte('created_at', today);
    if (error) {
      console.error('Error fetching check-ins:', error);
      return;
    }
    setCheckedInIds(new Set((data || []).map((c: any) => c.user_id)));
  }, [circleId, exactReadClient]);

  const page = usePaginated<MemberRow>({
    key: ['members', circleId, currentUserId],
    pageSize: PAGE_SIZE,
    fetchPage: async (from, to) => {
      if (!exactReadClient) {
        return { rows: [], error: new Error('Authenticated member access is not ready.') };
      }
      const { data, error } = await exactReadClient
        .from('circle_members')
        .select('user_id, role, joined_at')
        .eq('circle_id', circleId)
        .range(from, to);
      if (error) return { rows: [], error };
      const profileById = indexSafeProfiles(await loadSafeCircleProfiles({
        circleId,
        userIds: (data || []).map((row: any) => row.user_id),
        client: exactReadClient,
      }));
      return {
        rows: (data || []).map((row: any) => ({ ...row, user: profileById.get(row.user_id) || null })) as MemberRow[],
      };
    },
    manual: authLoading || !exactReadClient,
  });

  // Refresh check-ins in parallel with the first page.
  useEffect(() => { void loadCheckIns(); }, [loadCheckIns]);

  const members: Member[] = useMemo(() => {
    const out: Member[] = [];
    for (const row of page.rows) {
      // `user` can arrive as an object or a one-element array depending on the
      // PostgREST response; handle both.
      const rawUser = Array.isArray(row.user) ? row.user[0] : row.user;
      if (!rawUser?.id) continue;
      out.push({
        id: rawUser.id,
        username: rawUser.username,
        display_name: rawUser.display_name,
        current_streak: rawUser.current_streak || 0,
        longest_streak: rawUser.longest_streak || 0,
        bio: rawUser.bio,
        role: row.role,
        joined_at: row.joined_at,
        checkedInToday: checkedInIds.has(rawUser.id),
      });
    }
    return out.sort((a, b) => (b.current_streak || 0) - (a.current_streak || 0));
  }, [page.rows, checkedInIds]);

  const onRefresh = async () => {
    await Promise.all([page.refresh(), loadCheckIns()]);
  };

  const checkedIn = members.filter((m) => m.checkedInToday).length;

  return (
    <View style={styles.container}>
      {/* Stats */}
      <View style={styles.statsBar}>
        <View style={styles.stat}>
          <Text style={styles.statNum}>{members.length}{page.hasMore ? '+' : ''}</Text>
          <Text style={styles.statLabel}>MEMBERS</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={[styles.statNum, { color: checkedIn === members.length && members.length > 0 ? '#4ade80' : '#e89b3e' }]}>
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
          <RefreshControl refreshing={page.loading} onRefresh={onRefresh} tintColor="#fff" />
        }
        onEndReachedThreshold={0.5}
        onEndReached={() => { void page.loadMore(); }}
        ListFooterComponent={
          page.loadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator color="#6366f1" />
            </View>
          ) : null
        }
        ListEmptyComponent={
          page.loading ? (
            <View style={styles.empty}>
              <ActivityIndicator color="#6366f1" />
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No members yet</Text>
            </View>
          )
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
    borderBottomColor: '#000000',
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
    borderColor: '#000000',
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
  avatarNotCheckedIn: { backgroundColor: '#000000', borderColor: '#333' },
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
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  missingText: { color: '#333', fontSize: 14 },
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyText: { color: '#555', fontSize: 14 },
  footerLoading: { paddingVertical: 20, alignItems: 'center' },
});
