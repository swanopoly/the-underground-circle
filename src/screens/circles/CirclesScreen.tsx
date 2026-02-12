import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { Circle } from '../../types';

export default function CirclesScreen({ navigation }: any) {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCircles = useCallback(async () => {
    const { data: memberships } = await supabase
      .from('circle_members')
      .select('circle_id');

    if (!memberships?.length) {
      setCircles([]);
      return;
    }

    const circleIds = memberships.map((m) => m.circle_id);
    const { data, error } = await supabase
      .from('circles')
      .select('*, circle_members(count)')
      .in('id', circleIds);

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    const formatted = (data || []).map((c: any) => ({
      ...c,
      member_count: c.circle_members?.[0]?.count || 0,
    }));
    setCircles(formatted);
  }, []);

  useEffect(() => {
    fetchCircles();
    const unsubscribe = navigation.addListener('focus', fetchCircles);
    return unsubscribe;
  }, [fetchCircles, navigation]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchCircles();
    setRefreshing(false);
  };

  const renderCircle = ({ item }: { item: Circle }) => (
    <TouchableOpacity
      style={styles.circleCard}
      onPress={() => navigation.navigate('CircleDetail', { circleId: item.id, circleName: item.name })}
    >
      <View style={styles.circleHeader}>
        <Text style={styles.circleName}>{item.name}</Text>
        <Text style={styles.memberCount}>{item.member_count}/{item.max_members}</Text>
      </View>
      {item.description && (
        <Text style={styles.circleDesc}>{item.description}</Text>
      )}
      <Text style={styles.inviteCode}>Code: {item.invite_code}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>YOUR CIRCLES</Text>
      </View>

      {circles.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No circles yet.</Text>
          <Text style={styles.emptySubtext}>Create one or join with a code.</Text>
        </View>
      ) : (
        <FlatList
          data={circles}
          keyExtractor={(item) => item.id}
          renderItem={renderCircle}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
          }
        />
      )}

      <View style={styles.bottomButtons}>
        <TouchableOpacity
          style={styles.createButton}
          onPress={() => navigation.navigate('CreateCircle')}
        >
          <Text style={styles.createButtonText}>CREATE A CIRCLE</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.joinButton}
          onPress={() => navigation.navigate('JoinCircle')}
        >
          <Text style={styles.joinButtonText}>JOIN WITH CODE</Text>
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
  list: {
    padding: 16,
  },
  circleCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 20,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  circleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  circleName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  memberCount: {
    color: '#888',
    fontSize: 14,
  },
  circleDesc: {
    color: '#888',
    fontSize: 14,
    marginTop: 8,
  },
  inviteCode: {
    color: '#555',
    fontSize: 12,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  emptySubtext: {
    color: '#666',
    fontSize: 14,
    marginTop: 8,
  },
  bottomButtons: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  createButton: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
  },
  createButtonText: {
    color: '#0a0a0a',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
  },
  joinButton: {
    backgroundColor: 'transparent',
    borderRadius: 8,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  joinButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 2,
  },
});
