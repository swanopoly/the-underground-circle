import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  Alert,
  RefreshControl,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { CheckIn } from '../../types';

export default function CheckInScreen({ route }: any) {
  const { circleId, circleName } = route.params;
  const [checkIns, setCheckIns] = useState<CheckIn[]>([]);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);

  const fetchCheckIns = useCallback(async () => {
    const { data, error } = await supabase
      .from('check_ins')
      .select('*, user:profiles(username, display_name)')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    setCheckIns(data || []);

    // Check if user already checked in today
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

    // Subscribe to realtime check-ins
    const channel = supabase
      .channel(`checkins:${circleId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'check_ins', filter: `circle_id=eq.${circleId}` },
        () => fetchCheckIns()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, fetchCheckIns]);

  const handleCheckIn = async () => {
    if (!content.trim()) {
      Alert.alert('What did you do today?', 'Don\'t leave it blank.');
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const { error } = await supabase.from('check_ins').insert({
      user_id: user.id,
      circle_id: circleId,
      content: content.trim(),
      check_in_date: new Date().toISOString().split('T')[0],
    });

    setLoading(false);
    if (error) {
      if (error.code === '23505') {
        Alert.alert('Already checked in', 'One check-in per day. Come back tomorrow.');
      } else {
        Alert.alert('Error', error.message);
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

  const getTimeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const renderCheckIn = ({ item }: { item: any }) => (
    <View style={styles.checkInCard}>
      <View style={styles.checkInHeader}>
        <Text style={styles.checkInUser}>
          {item.user?.display_name || item.user?.username || 'Unknown'}
        </Text>
        <Text style={styles.checkInTime}>{getTimeAgo(item.created_at)}</Text>
      </View>
      <Text style={styles.checkInContent}>{item.content}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{circleName?.toUpperCase()}</Text>
        <Text style={styles.headerSubtitle}>PROOF OF WORK</Text>
      </View>

      {!hasCheckedInToday && (
        <View style={styles.checkInBox}>
          <TextInput
            style={styles.checkInInput}
            placeholder="What did you DO today?"
            placeholderTextColor="#555"
            value={content}
            onChangeText={setContent}
            multiline
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.checkInButton, loading && styles.buttonDisabled]}
            onPress={handleCheckIn}
            disabled={loading}
          >
            <Text style={styles.checkInButtonText}>
              {loading ? 'POSTING...' : 'CHECK IN'}
            </Text>
          </TouchableOpacity>
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
        renderItem={renderCheckIn}
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
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: 3,
  },
  headerSubtitle: {
    color: '#888',
    fontSize: 12,
    letterSpacing: 2,
    marginTop: 4,
  },
  checkInBox: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  checkInInput: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#333',
    borderRadius: 8,
    padding: 16,
    color: '#fff',
    fontSize: 16,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  checkInButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  checkInButtonText: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
  },
  checkedInBanner: {
    backgroundColor: '#1a2a1a',
    padding: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  checkedInText: {
    color: '#4a9a4a',
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 2,
  },
  list: {
    padding: 16,
  },
  checkInCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  checkInHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  checkInUser: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  checkInTime: {
    color: '#555',
    fontSize: 12,
  },
  checkInContent: {
    color: '#ccc',
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
    color: '#666',
    fontSize: 14,
    marginTop: 4,
  },
});
