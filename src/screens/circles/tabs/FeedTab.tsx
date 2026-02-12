import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  Platform,
  Pressable,
  RefreshControl,
} from 'react-native';
import { supabase } from '../../../lib/supabase';
import { showAlert } from '../../../lib/alert';
import Button from '../../../components/Button';

const REACTION_EMOJIS = ['🔥', '💪', '👏', '💯', '⚡'];

export default function FeedTab({ circleId }: { circleId: string }) {
  const [checkIns, setCheckIns] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const fetchCheckIns = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setCurrentUserId(user.id);

    const { data } = await supabase
      .from('check_ins')
      .select('*, user:profiles(username, display_name)')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .limit(50);

    // Fetch reactions for these check-ins
    const checkInIds = (data || []).map((c: any) => c.id);
    let reactionsMap: any = {};
    if (checkInIds.length > 0) {
      const { data: reactions } = await supabase
        .from('reactions')
        .select('*, user:profiles(username)')
        .in('check_in_id', checkInIds);

      (reactions || []).forEach((r: any) => {
        if (!reactionsMap[r.check_in_id]) reactionsMap[r.check_in_id] = [];
        reactionsMap[r.check_in_id].push(r);
      });
    }

    const enriched = (data || []).map((c: any) => ({
      ...c,
      reactions: reactionsMap[c.id] || [],
    }));

    setCheckIns(enriched);

    if (user) {
      const today = new Date().toISOString().split('T')[0];
      const todayCheckIn = (data || []).find(
        (c: any) => c.user_id === user.id && c.created_at.startsWith(today)
      );
      setHasCheckedInToday(!!todayCheckIn);
    }
  }, [circleId]);

  useEffect(() => {
    fetchCheckIns();
    const channel = supabase
      .channel(`feed:${circleId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'check_ins', filter: `circle_id=eq.${circleId}` }, () => fetchCheckIns())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId, fetchCheckIns]);

  const handleCheckIn = async () => {
    if (!content.trim()) return;
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { error } = await supabase.from('check_ins').insert({
      user_id: user.id,
      circle_id: circleId,
      content: content.trim(),
      check_in_date: new Date().toISOString().split('T')[0],
    });

    setLoading(false);
    if (error) {
      if (error.code === '23505') showAlert('Already checked in', 'One per day.');
      else showAlert('Error', error.message);
      return;
    }
    setContent('');
    setHasCheckedInToday(true);
    fetchCheckIns();
  };

  const toggleReaction = async (checkInId: string, emoji: string) => {
    if (!currentUserId) return;
    const existing = checkIns
      .find((c) => c.id === checkInId)
      ?.reactions?.find((r: any) => r.user_id === currentUserId && r.emoji === emoji);

    if (existing) {
      await supabase.from('reactions').delete().eq('id', existing.id);
    } else {
      await supabase.from('reactions').insert({
        user_id: currentUserId,
        check_in_id: checkInId,
        emoji,
      });
    }
    fetchCheckIns();
  };

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  };

  const groupReactions = (reactions: any[]) => {
    const groups: { [emoji: string]: { count: number; userReacted: boolean } } = {};
    reactions.forEach((r: any) => {
      if (!groups[r.emoji]) groups[r.emoji] = { count: 0, userReacted: false };
      groups[r.emoji].count++;
      if (r.user_id === currentUserId) groups[r.emoji].userReacted = true;
    });
    return groups;
  };

  const renderCheckIn = ({ item }: { item: any }) => {
    const reactionGroups = groupReactions(item.reactions || []);
    return (
      <CheckInCard
        item={item}
        reactionGroups={reactionGroups}
        onReact={(emoji: string) => toggleReaction(item.id, emoji)}
        getTimeAgo={getTimeAgo}
      />
    );
  };

  return (
    <View style={styles.container}>
      {!hasCheckedInToday && (
        <View style={styles.checkInBox}>
          <Text style={styles.checkInPrompt}>What did you DO today?</Text>
          <TextInput
            style={styles.checkInInput}
            placeholder="12hr shift, still made dinner for the kids..."
            placeholderTextColor="#333"
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={500}
          />
          <Button title="CHECK IN" onPress={handleCheckIn} loading={loading} />
        </View>
      )}

      {hasCheckedInToday && (
        <View style={styles.checkedBanner}>
          <Text style={styles.checkedText}>✓ CHECKED IN TODAY</Text>
        </View>
      )}

      <FlatList
        data={checkIns}
        keyExtractor={(item) => item.id}
        renderItem={renderCheckIn}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchCheckIns(); setRefreshing(false); }} tintColor="#fff" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📝</Text>
            <Text style={styles.emptyText}>No check-ins yet</Text>
            <Text style={styles.emptySubtext}>Be the first to put in work</Text>
          </View>
        }
      />
    </View>
  );
}

function CheckInCard({ item, reactionGroups, onReact, getTimeAgo }: any) {
  const [hovered, setHovered] = useState(false);
  const [showReactions, setShowReactions] = useState(false);

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => { setHovered(false); setShowReactions(false); }}
      style={[styles.card, hovered && styles.cardHovered]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.userRow}>
          <View style={styles.userAvatar}>
            <Text style={styles.userAvatarText}>
              {(item.user?.display_name || '?').charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <Text style={styles.userName}>{item.user?.display_name || item.user?.username}</Text>
            <Text style={styles.timeText}>{getTimeAgo(item.created_at)} ago</Text>
          </View>
        </View>
      </View>

      <Text style={styles.cardContent}>{item.content}</Text>

      {/* Existing reactions */}
      {Object.keys(reactionGroups).length > 0 && (
        <View style={styles.reactionsRow}>
          {Object.entries(reactionGroups).map(([emoji, data]: [string, any]) => (
            <ReactionBadge
              key={emoji}
              emoji={emoji}
              count={data.count}
              active={data.userReacted}
              onPress={() => onReact(emoji)}
            />
          ))}
        </View>
      )}

      {/* Add reaction button */}
      {hovered && (
        <View style={styles.reactionBar}>
          {showReactions ? (
            <View style={styles.emojiPicker}>
              {REACTION_EMOJIS.map((emoji) => (
                <Pressable key={emoji} onPress={() => { onReact(emoji); setShowReactions(false); }} style={styles.emojiButton}>
                  <Text style={styles.emojiText}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
          ) : (
            <Pressable onPress={() => setShowReactions(true)} style={styles.addReactionButton}>
              <Text style={styles.addReactionText}>+ React</Text>
            </Pressable>
          )}
        </View>
      )}
    </Pressable>
  );
}

function ReactionBadge({ emoji, count, active, onPress }: any) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.reactionBadge, active && styles.reactionBadgeActive, hovered && styles.reactionBadgeHovered]}
    >
      <Text style={styles.reactionEmoji}>{emoji}</Text>
      <Text style={[styles.reactionCount, active && styles.reactionCountActive]}>{count}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  checkInBox: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
    gap: 10,
  },
  checkInPrompt: {
    color: '#888',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
  },
  checkInInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 12,
    padding: 14,
    color: '#fff',
    fontSize: 15,
    minHeight: 70,
    textAlignVertical: 'top',
  },
  checkedBanner: {
    backgroundColor: '#0d1f0d',
    padding: 10,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  checkedText: {
    color: '#4a9a4a',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 2,
  },
  list: {
    padding: 16,
    maxWidth: 580,
    alignSelf: 'center',
    width: '100%',
  },
  card: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease' } as any : {}),
  },
  cardHovered: {
    borderColor: '#2a2a2a',
    backgroundColor: '#131313',
  },
  cardHeader: {
    marginBottom: 10,
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  userAvatarText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  userName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  timeText: {
    color: '#444',
    fontSize: 11,
    marginTop: 1,
  },
  cardContent: {
    color: '#bbb',
    fontSize: 15,
    lineHeight: 22,
  },
  reactionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 12,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 4,
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  reactionBadgeActive: {
    borderColor: '#335',
    backgroundColor: '#1a1a2e',
  },
  reactionBadgeHovered: {
    borderColor: '#444',
  },
  reactionEmoji: {
    fontSize: 14,
  },
  reactionCount: {
    color: '#666',
    fontSize: 12,
    fontWeight: '700',
  },
  reactionCountActive: {
    color: '#88f',
  },
  reactionBar: {
    marginTop: 10,
  },
  addReactionButton: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  addReactionText: {
    color: '#555',
    fontSize: 12,
    fontWeight: '600',
  },
  emojiPicker: {
    flexDirection: 'row',
    gap: 4,
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: '#222',
  },
  emojiButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  emojiText: {
    fontSize: 18,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
  },
  emptyIcon: {
    fontSize: 32,
    marginBottom: 12,
  },
  emptyText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  emptySubtext: {
    color: '#555',
    fontSize: 14,
    marginTop: 4,
  },
});
