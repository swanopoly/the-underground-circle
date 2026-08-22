/**
 * DiscoverScreen — browse and join public circles
 * Shows circles that have opted into discovery with their mission activity.
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TextInput, Pressable, StyleSheet, Platform,
  useWindowDimensions, ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { PIXEL_COLORS, GRID, pixelCard, pixelInset } from '../../lib/pixelDesign';

interface DiscoverCircle {
  id: string;
  name: string;
  description: string | null;
  max_members: number;
  created_at: string;
  member_count: number;
  active_missions: number;
  is_member: boolean;
}

export default function DiscoverScreen({ navigation }: any) {
  const [circles, setCircles] = useState<DiscoverCircle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState('');
  const { width } = useWindowDimensions();
  const isMobile = width < 700;

  const fetchCircles = useCallback(async () => {
    setLoading(true);
    try {
      // Discovery is a narrow server-owned projection. Never read raw circle
      // rows here: those rows include invite and integration credentials.
      const { data, error } = await supabase.rpc('discover_public_circles', {
        p_search: null,
        p_limit: 50,
        p_offset: 0,
      });
      if (error) throw error;
      setCircles(Array.isArray(data) ? data as DiscoverCircle[] : []);
    } catch (err) {
      console.error('Discover fetch error:', err);
      setCircles([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCircles(); }, [fetchCircles]);

  const handleJoin = async (circle: DiscoverCircle) => {
    setJoining(circle.id);
    setJoinError('');
    try {
      const { data, error } = await supabase.rpc('join_public_circle', {
        p_circle_id: circle.id,
      });
      if (error) {
        setJoinError(error.message?.includes('circle_full')
          ? 'This circle is full.'
          : 'This circle is not available to join.');
        return;
      }
      const joined = Array.isArray(data) ? data[0] : data;
      if (!joined?.circle_id) {
        setJoinError('The join could not be verified. Please try again.');
        return;
      }
      navigation.navigate('CircleDetail', {
        circleId: joined.circle_id,
        circleName: joined.circle_name || circle.name,
      });
    } catch {
      setJoinError('The join could not be completed. Please try again.');
    } finally {
      setJoining(null);
    }
  };

  const filtered = circles.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
        !(c.description || '').toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backText}>{'<'} Back</Text>
        </Pressable>
        <Text style={s.title}>DISCOVER CIRCLES</Text>
        <Text style={s.subtitle}>{filtered.length} circle{filtered.length !== 1 ? 's' : ''} available</Text>
      </View>

      {/* Search */}
      <View style={[s.searchRow, isMobile && { paddingHorizontal: 12 }]}>
        <TextInput
          style={s.searchInput}
          placeholder="Search circles..."
          placeholderTextColor={PIXEL_COLORS.text3}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {joinError ? <Text style={s.errorText}>{joinError}</Text> : null}

      {/* Circle list */}
      <ScrollView style={s.list} contentContainerStyle={[s.listContent, isMobile && { paddingHorizontal: 12 }]}>
        {loading && (
          <ActivityIndicator color={PIXEL_COLORS.indigo} style={{ marginTop: 40 }} />
        )}

        {!loading && filtered.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyTitle}>No circles found</Text>
            <Text style={s.emptyDesc}>
              {search ? 'Try a different search term.' : 'No public circles available yet. Create one!'}
            </Text>
          </View>
        )}

        <View style={[s.grid, isMobile && { gap: 12 }]}>
          {filtered.map(circle => {
            const accent = PIXEL_COLORS.indigo;
            const initial = circle.name.charAt(0).toUpperCase();
            return (
              <View key={circle.id} style={[s.card, isMobile && { width: '100%' }]}>
                {/* Card header */}
                <View style={s.cardHeader}>
                  <View style={[s.avatar, { backgroundColor: accent + '18' }]}>
                    <Text style={[s.avatarText, { color: accent }]}>{initial}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.cardTitle} numberOfLines={1}>{circle.name}</Text>
                    {circle.is_member && <Text style={[s.cardType, { color: accent }]}>MEMBER</Text>}
                  </View>
                </View>

                {/* Description */}
                {circle.description && (
                  <Text style={s.cardDesc} numberOfLines={2}>{circle.description}</Text>
                )}

                {/* Stats row */}
                <View style={s.statsRow}>
                  <View style={s.stat}>
                    <Text style={s.statValue}>{circle.member_count}</Text>
                    <Text style={s.statLabel}>members</Text>
                  </View>
                  {circle.active_missions > 0 && (
                    <View style={s.stat}>
                      <Text style={[s.statValue, { color: PIXEL_COLORS.indigo }]}>{circle.active_missions}</Text>
                      <Text style={s.statLabel}>missions</Text>
                    </View>
                  )}
                </View>

                {/* Join button */}
                <Pressable
                  style={[s.joinBtn, { backgroundColor: accent }]}
                  onPress={() => handleJoin(circle)}
                  disabled={joining === circle.id}
                >
                  <Text style={s.joinBtnText}>
                    {joining === circle.id ? '...' : circle.is_member ? 'Open Circle' : 'Join Circle'}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: PIXEL_COLORS.bg0 },

  header: { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 },
  backBtn: { marginBottom: 8 },
  backText: { color: PIXEL_COLORS.text1, fontSize: 13, fontWeight: '600', fontFamily: 'monospace' },
  title: { color: PIXEL_COLORS.text0, fontSize: 22, fontWeight: '800', letterSpacing: 1 },
  subtitle: { color: PIXEL_COLORS.text2, fontSize: 12, marginTop: 4 },

  searchRow: { paddingHorizontal: 24, marginBottom: 12 },
  searchInput: {
    ...pixelInset,
    color: PIXEL_COLORS.text0,
    fontSize: 14,
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm + 2,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },

  errorText: { color: PIXEL_COLORS.red, fontSize: 12, paddingHorizontal: 24, marginBottom: 8 },

  list: { flex: 1 },
  listContent: { paddingHorizontal: 24, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },

  empty: { alignItems: 'center', paddingTop: 60 },
  emptyTitle: { color: PIXEL_COLORS.text0, fontSize: 16, fontWeight: '700' },
  emptyDesc: { color: PIXEL_COLORS.text2, fontSize: 13, marginTop: 8, textAlign: 'center' },

  card: {
    ...pixelCard,
    width: 320,
    padding: GRID.lg,
    gap: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 18, fontWeight: '800' },
  cardTitle: { color: PIXEL_COLORS.text0, fontSize: 15, fontWeight: '700' },
  cardType: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 },
  cardDesc: { color: PIXEL_COLORS.text1, fontSize: 13, lineHeight: 19 },

  statsRow: { flexDirection: 'row', gap: 16 },
  stat: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  statValue: { color: PIXEL_COLORS.text0, fontSize: 14, fontWeight: '700', fontFamily: 'monospace' },
  statLabel: { color: PIXEL_COLORS.text3, fontSize: 11 },

  joinBtn: {
    paddingVertical: 10, borderRadius: 8, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  joinBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
