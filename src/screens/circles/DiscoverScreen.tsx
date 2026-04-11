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
import { Circle } from '../../types';
import { PIXEL_COLORS, GRID, pixelCard, pixelInset } from '../../lib/pixelDesign';

interface DiscoverCircle extends Circle {
  member_count: number;
  active_missions: number;
}

const CIRCLE_TYPE_COLORS: Record<string, string> = {
  builder: '#22d3ee',
  creator: '#a855f7',
  operator: '#f59e0b',
  researcher: '#3b82f6',
  custom: '#6366f1',
};

export default function DiscoverScreen({ navigation }: any) {
  const [circles, setCircles] = useState<DiscoverCircle[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const [joinError, setJoinError] = useState('');
  const { width } = useWindowDimensions();
  const isMobile = width < 700;

  const fetchCircles = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch circles that have descriptions (proxy for "public" until is_public column exists)
      let query = supabase
        .from('circles')
        .select('*, circle_members!inner(count)')
        .not('description', 'is', null)
        .order('created_at', { ascending: false })
        .limit(50);

      const { data } = await query;

      if (data) {
        // Also fetch mission counts
        const circleIds = data.map((c: any) => c.id);
        const { data: missionCounts } = await supabase
          .from('circle_missions')
          .select('circle_id, status')
          .in('circle_id', circleIds)
          .eq('status', 'active');

        const missionMap: Record<string, number> = {};
        (missionCounts || []).forEach((m: any) => {
          missionMap[m.circle_id] = (missionMap[m.circle_id] || 0) + 1;
        });

        setCircles(data.map((c: any) => ({
          ...c,
          member_count: c.circle_members?.[0]?.count || 0,
          active_missions: missionMap[c.id] || 0,
        })));
      }
    } catch (err) {
      console.error('Discover fetch error:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchCircles(); }, [fetchCircles]);

  const handleJoin = async (circle: DiscoverCircle) => {
    setJoining(circle.id);
    setJoinError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setJoinError('Not logged in'); setJoining(null); return; }

      // Check if already a member
      const { data: existing } = await supabase
        .from('circle_members')
        .select('id')
        .eq('circle_id', circle.id)
        .eq('user_id', user.id)
        .single();

      if (existing) {
        // Already a member — navigate directly
        navigation.navigate('CircleDetail', { circleId: circle.id, circleName: circle.name });
        setJoining(null);
        return;
      }

      // Join the circle
      const { error } = await supabase.from('circle_members').insert({
        circle_id: circle.id,
        user_id: user.id,
        role: 'member',
      });

      if (error) { setJoinError(error.message); setJoining(null); return; }

      navigation.navigate('CircleDetail', { circleId: circle.id, circleName: circle.name });
    } catch (e: any) {
      setJoinError(e.message);
    }
    setJoining(null);
  };

  const filtered = circles.filter(c => {
    if (search && !c.name.toLowerCase().includes(search.toLowerCase()) &&
        !(c.description || '').toLowerCase().includes(search.toLowerCase())) return false;
    if (typeFilter && c.circle_type !== typeFilter) return false;
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

      {/* Type filters */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={s.filterRow}>
        <Pressable
          style={[s.filterPill, !typeFilter && s.filterPillActive]}
          onPress={() => setTypeFilter(null)}
        >
          <Text style={[s.filterText, !typeFilter && { color: PIXEL_COLORS.indigo }]}>All</Text>
        </Pressable>
        {Object.entries(CIRCLE_TYPE_COLORS).map(([type, color]) => (
          <Pressable
            key={type}
            style={[s.filterPill, typeFilter === type && { backgroundColor: color + '20', borderColor: color + '50' }]}
            onPress={() => setTypeFilter(typeFilter === type ? null : type)}
          >
            <Text style={[s.filterText, typeFilter === type && { color }]}>
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

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
            const accent = circle.accent_color || CIRCLE_TYPE_COLORS[circle.circle_type || 'custom'] || PIXEL_COLORS.indigo;
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
                    {circle.circle_type && (
                      <Text style={[s.cardType, { color: accent }]}>
                        {circle.circle_type.toUpperCase()}
                      </Text>
                    )}
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
                    {joining === circle.id ? '...' : 'Join Circle'}
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

  filterScroll: { maxHeight: 40, marginBottom: 12 },
  filterRow: { paddingHorizontal: 24, gap: 8 },
  filterPill: {
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 10,
    borderWidth: 1, borderColor: PIXEL_COLORS.border0,
  },
  filterPillActive: { backgroundColor: PIXEL_COLORS.indigo + '20', borderColor: PIXEL_COLORS.indigo + '50' },
  filterText: { color: PIXEL_COLORS.text2, fontSize: 12, fontWeight: '600' },

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
