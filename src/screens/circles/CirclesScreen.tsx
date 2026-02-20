import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  Alert,
  Platform,
  Pressable,
  Image,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { Circle } from '../../types';
import Button from '../../components/Button';

function CircleCard({ item, onPress }: { item: Circle; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[styles.circleCard, hovered && styles.circleCardHovered]}
    >
      <View style={styles.circleHeader}>
        <View style={styles.circleNameRow}>
          <View style={[styles.circleAvatar, item.accent_color ? { backgroundColor: item.accent_color + '25' } : null]}>
            {item.circle_image_url ? (
              <Image source={{ uri: item.circle_image_url }} style={{ width: 38, height: 38, borderRadius: 19 }} />
            ) : item.icon && item.icon !== '⭕' ? (
              <Text style={{ fontSize: 20 }}>{item.icon}</Text>
            ) : (
              <Text style={styles.circleAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
            )}
          </View>
          <View>
            <Text style={styles.circleName}>{item.name}</Text>
            {item.description && (
              <Text style={styles.circleDesc} numberOfLines={1}>{item.description}</Text>
            )}
          </View>
        </View>
        <View style={styles.badgeRow}>
          {item.verification_badges && item.verification_badges.length > 0 && (
            <View style={styles.verificationBadge}>
              <Text style={styles.verificationIcon}>✓</Text>
            </View>
          )}
          <View style={styles.memberBadge}>
            <Text style={styles.memberCount}>{item.member_count}/{item.max_members}</Text>
          </View>
        </View>
      </View>
      <View style={styles.circleFooter}>
        <Text style={styles.inviteCode}>Code: {item.invite_code}</Text>
        <Text style={styles.arrowText}>→</Text>
      </View>
    </Pressable>
  );
}

export default function CirclesScreen({ navigation }: any) {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchCircles = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setCircles([]);
        return;
      }

      // First try the optimized function from our migration
      const { data: optimizedData, error: funcError } = await supabase
        .rpc('get_user_circles', { user_uuid: user.id });

      if (!funcError && optimizedData) {
        const formatted = optimizedData.map((c: any) => ({
          id: c.id,
          name: c.name,
          description: c.description,
          invite_code: c.invite_code,
          max_members: c.max_members,
          created_by: c.created_by,
          created_at: c.created_at,
          member_count: Number(c.member_count) || 0,
          user_role: c.user_role,
          icon: c.icon,
          accent_color: c.accent_color,
          circle_image_url: c.circle_image_url,
          // Mock verification status based on circle age and activity
          verification_badges: c.created_at && new Date(c.created_at) < new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) && c.member_count >= 5 
            ? ['activity_verified'] 
            : [],
        }));
        setCircles(formatted);
        return;
      }

      // Fallback to manual query with user filtering
      const { data: memberships, error: membershipError } = await supabase
        .from('circle_members')
        .select('circle_id')
        .eq('user_id', user.id)
        .limit(50);

      if (membershipError) {
        console.error('Error fetching memberships:', membershipError);
        Alert.alert('Error', 'Failed to fetch your circles');
        return;
      }

      if (!memberships?.length) {
        setCircles([]);
        return;
      }

      const circleIds = memberships.map((m) => m.circle_id);
      const { data, error } = await supabase
        .from('circles')
        .select(`
          *,
          circle_members!inner(count)
        `)
        .in('id', circleIds)
        .limit(50);

      if (error) {
        console.error('Error fetching circles:', error);
        Alert.alert('Error', 'Failed to load circle details');
        return;
      }

      const formatted = (data || []).map((c: any) => ({
        ...c,
        member_count: c.circle_members?.[0]?.count || 0,
      }));
      setCircles(formatted);
    } catch (err) {
      console.error('Unexpected error:', err);
      Alert.alert('Error', 'Something went wrong loading your circles');
    }
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>YOUR CIRCLES</Text>
        <Text style={styles.headerSubtitle}>{circles.length} active</Text>
      </View>

      {circles.length === 0 ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Text style={styles.emptyIconText}>⭕</Text>
          </View>
          <Text style={styles.emptyText}>No circles yet.</Text>
          <Text style={styles.emptySubtext}>Create one or join with a code.</Text>
        </View>
      ) : (
        <FlatList
          data={circles}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CircleCard
              item={item}
              onPress={() => navigation.navigate('CircleDetail', { circleId: item.id, circleName: item.name })}
            />
          )}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
          }
        />
      )}

      <View style={styles.bottomButtons}>
        <Button
          title="CREATE A CIRCLE"
          onPress={() => navigation.navigate('CreateCircle')}
        />
        <Button
          title="JOIN WITH CODE"
          variant="secondary"
          onPress={() => navigation.navigate('JoinCircle')}
        />
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
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
  headerSubtitle: {
    color: '#555',
    fontSize: 13,
  },
  list: {
    padding: 16,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
  circleCard: {
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 18,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { transition: 'all 0.2s ease', cursor: 'pointer' } as any : {}),
  },
  circleCardHovered: {
    borderColor: '#444',
    backgroundColor: '#161616',
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -2 }] } : {}),
  },
  circleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  circleNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  circleAvatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  circleAvatarText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  circleName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  circleDesc: {
    color: '#666',
    fontSize: 12,
    marginTop: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  verificationBadge: {
    backgroundColor: '#0d4f0c',
    borderRadius: 10,
    width: 20,
    height: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#16a34a',
  },
  verificationIcon: {
    color: '#22c55e',
    fontSize: 12,
    fontWeight: '900',
  },
  memberBadge: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  memberCount: {
    color: '#888',
    fontSize: 12,
    fontWeight: '700',
  },
  circleFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    paddingTop: 12,
  },
  inviteCode: {
    color: '#444',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    letterSpacing: 1,
  },
  arrowText: {
    color: '#555',
    fontSize: 16,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#111',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  emptyIconText: {
    fontSize: 28,
  },
  emptyText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  emptySubtext: {
    color: '#555',
    fontSize: 14,
    marginTop: 6,
  },
  bottomButtons: {
    padding: 16,
    paddingBottom: 24,
    gap: 10,
    maxWidth: 480,
    alignSelf: 'center',
    width: '100%',
  },
});
