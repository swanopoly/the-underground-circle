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
import { supabase } from '../../lib/supabase';
import { showAlert } from '../../lib/alert';
import Button from '../../components/Button';

function CheckInCard({ item }: { item: any }) {
  const [hovered, setHovered] = useState(false);

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <Pressable
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.checkInCard, hovered && styles.checkInCardHovered]}
    >
      <View style={styles.checkInHeader}>
        <View style={styles.checkInUser}>
          <View style={styles.userDot} />
          <Text style={styles.userName}>
            {item.user?.display_name || item.user?.username || 'Unknown'}
          </Text>
        </View>
        <Text style={styles.checkInTime}>{getTimeAgo(item.created_at)}</Text>
      </View>
      <Text style={styles.checkInContent}>{item.content}</Text>
    </Pressable>
  );
}

export default function CheckInScreen({ route, navigation }: any) {
  const { circleId, circleName } = route.params;
  const [checkIns, setCheckIns] = useState<any[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);

  const fetchCheckIns = useCallback(async () => {
    const { data } = await supabase
      .from('check_ins')
      .select('*, user:profiles(username, display_name)')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .limit(50);

    setCheckIns(data || []);

    const { data: { user } } = await supabase.auth.getUser();
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
      .channel(`checkins:${circleId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'check_ins', filter: `circle_id=eq.${circleId}` }, () => fetchCheckIns())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId, fetchCheckIns]);

  const handleCheckIn = async () => {
    if (!content.trim()) {
      showAlert('What did you do today?', "Don't leave it blank.");
      return;
    }
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
      if (error.code === '23505') {
        showAlert('Already checked in', 'One check-in per day. Come back tomorrow.');
      } else {
        showAlert('Error', error.message);
      }
      return;
    }
    setContent('');
    setHasCheckedInToday(true);
    fetchCheckIns();
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchCheckIns();
    setRefreshing(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backButton}>
          <Text style={styles.backText}>← Back</Text>
        </Pressable>
        <View>
          <Text style={styles.headerTitle}>{circleName?.toUpperCase()}</Text>
          <Text style={styles.headerSubtitle}>PROOF OF WORK</Text>
        </View>
      </View>

      {!hasCheckedInToday && (
        <View style={styles.checkInBox}>
          <TextInput
            style={styles.checkInInput}
            placeholder="What did you DO today?"
            placeholderTextColor="#444"
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={500}
          />
          <Button title="CHECK IN" onPress={handleCheckIn} loading={loading} />
        </View>
      )}

      {hasCheckedInToday && (
        <View style={styles.checkedInBanner}>
          <Text style={styles.checkedInText}>✓ YOU CHECKED IN TODAY</Text>
        </View>
      )}

      <FlatList
        data={checkIns}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <CheckInCard item={item} />}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>No check-ins yet.</Text>
            <Text style={styles.emptySubtext}>Be the first to put in work.</Text>
          </View>
        }
      />
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
    paddingBottom: 16,
    paddingHorizontal: 24,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  backButton: {
    padding: 4,
  },
  backText: {
    color: '#888',
    fontSize: 14,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 3,
  },
  headerSubtitle: {
    color: '#666',
    fontSize: 11,
    letterSpacing: 2,
    marginTop: 2,
  },
  checkInBox: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
    gap: 12,
  },
  checkInInput: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    borderRadius: 12,
    padding: 16,
    color: '#fff',
    fontSize: 15,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  checkedInBanner: {
    backgroundColor: '#0d1f0d',
    padding: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  checkedInText: {
    color: '#4a9a4a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2,
  },
  list: {
    padding: 16,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  checkInCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease' } as any : {}),
  },
  checkInCardHovered: {
    borderColor: '#333',
    backgroundColor: '#151515',
  },
  checkInHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  checkInUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#4a9a4a',
  },
  userName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  checkInTime: {
    color: '#444',
    fontSize: 11,
  },
  checkInContent: {
    color: '#bbb',
    fontSize: 15,
    lineHeight: 22,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 60,
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
