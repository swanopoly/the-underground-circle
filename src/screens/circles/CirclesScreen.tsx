import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  RefreshControl,
  Alert,
  Platform,
  Pressable,
  Image,
  Animated,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { Circle } from '../../types';

// ─── Design Tokens — "Linear meets Arc Browser" ────────────────────────────
const BG_PAGE     = '#050508';
const BG_SURFACE  = '#0a0a10';
const BG_RAISED   = '#0f0f18';
const BG_INPUT    = '#1a1a28';

const GREEN       = '#b8ff61';
const GREEN_DIM   = '#6ab833';
const GREEN_GLOW8 = 'rgba(184,255,97,0.08)';
const GREEN_GLOW15= 'rgba(184,255,97,0.15)';
const GREEN_GLOW3 = 'rgba(184,255,97,0.03)';
const GREEN_BORDER= 'rgba(184,255,97,0.25)';

const TEXT_PRI    = '#f0f0f5';
const TEXT_SEC    = '#a0a0b0';
const TEXT_TER    = '#606075';
const TEXT_DIS    = '#3a3a4e';

const BORDER_DEF  = '#1a1a28';
const BORDER_HOV  = '#2a2a3e';

const RADIUS_CARD = 14;
const RADIUS_BTN  = 10;
const RADIUS_PILL = 100;
const RADIUS_INNER= 10;

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Deterministic "random" from string seed for stable mock data
function hashSeed(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  return (Math.abs(h) % 1000) / 1000;
}

// ─── CSS Injection (web only, with dedup guard) ────────────────────────────
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('uc-circles-css')) {
  const style = document.createElement('style');
  style.id = 'uc-circles-css';
  style.textContent = `
    @keyframes uc-breathe { 0%,100%{opacity:.5;transform:scale(1)} 50%{opacity:1;transform:scale(1.3)} }
    @keyframes uc-cursor-blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }
    @keyframes uc-shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
    @keyframes uc-float { 0%{transform:translateY(0);opacity:0} 10%{opacity:.15} 90%{opacity:.1} 100%{transform:translateY(-110vh);opacity:0} }
  `;
  document.head.appendChild(style);
}

// ─── Portal Afterglow ──────────────────────────────────────────────────────
function PortalAfterglow() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(opacity, { toValue: 0, duration: 2500, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [opacity]);
  if (Platform.OS !== 'web') return null;
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', top: '25%', left: '50%', width: 500, height: 500,
      marginLeft: -250, marginTop: -250, borderRadius: 250, opacity,
      ...(Platform.OS === 'web' ? { background: `radial-gradient(circle, rgba(184,255,97,0.1) 0%, transparent 70%)` } as any : {}),
    }} />
  );
}

// ─── Floating Particles ────────────────────────────────────────────────────
function FloatingParticles() {
  const particles = useRef(Array.from({ length: 4 }, (_, i) => ({
    left: `${15 + i * 20}%`, delay: i * 3, duration: 18 + i * 4, size: 2,
  }))).current;
  if (Platform.OS !== 'web') return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p, i) => (
        <div key={i} style={{
          position: 'absolute', left: p.left, bottom: '-5%',
          width: p.size, height: p.size, borderRadius: p.size,
          backgroundColor: GREEN, opacity: 0.15,
          animation: `uc-float ${p.duration}s linear ${p.delay}s infinite`,
        }} />
      ))}
    </View>
  );
}

// ─── Circle Card ───────────────────────────────────────────────────────────
const CircleCard = React.memo(function CircleCard({ item, onPress, index }: { item: Circle; onPress: () => void; index: number }) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;

  useEffect(() => {
    const delay = 400 + index * 60;
    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
        Animated.timing(slideAnim, { toValue: 0, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
      ]).start();
    }, delay);
    return () => clearTimeout(timer);
  }, [index, fadeAnim, slideAnim]);

  const memberCount = item.member_count || 0;
  const accent = item.accent_color || GREEN;
  const initial = item.name.charAt(0).toUpperCase();

  // Stable mock data seeded by circle id
  const stats = useMemo(() => ({
    commits: Math.floor(hashSeed(item.id + 'c') * 20),
    prs: Math.floor(hashSeed(item.id + 'p') * 5),
    streak: Math.floor(hashSeed(item.id + 's') * 14) + 1,
    isActive: memberCount > 1,
    agentStatus: memberCount > 1 ? 'monitoring repo activity...' : 'idle',
  }), [item.id, memberCount]);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={`Enter circle ${item.name}`}
        style={[s.card, hovered && s.cardHover, stats.isActive && s.cardActive]}
      >
        {/* Accent stripe */}
        <View style={[s.accentStripe, { backgroundColor: stats.isActive ? GREEN : accent + '30' }]} />

        <View style={s.cardInner}>
          {/* Header: avatar + name + badge */}
          <View style={s.cardHeader}>
            <View style={[s.avatar, { backgroundColor: accent + '18' }]}>
              {item.circle_image_url ? (
                <Image source={{ uri: item.circle_image_url }} style={s.avatarImage} />
              ) : (
                <Text style={[s.avatarText, { color: accent }]}>{initial}</Text>
              )}
            </View>
            <View style={s.cardHeaderText}>
              <Text style={s.cardTitle} numberOfLines={1}>{item.name}</Text>
              {item.description ? (
                <Text style={s.cardDesc} numberOfLines={1}>{item.description}</Text>
              ) : null}
            </View>
            <View style={s.pillBadge}>
              {stats.isActive && <View style={s.onlineDot} />}
              <Text style={s.pillText}>{memberCount}</Text>
            </View>
          </View>

          {/* Agent status */}
          <View style={s.agentBar}>
            <Text style={s.agentPrompt}>{'>'}</Text>
            <Text style={[s.agentText, stats.isActive && { color: GREEN_DIM }]} numberOfLines={1}>
              {stats.agentStatus}
            </Text>
            {stats.isActive && Platform.OS === 'web' && (
              <Text style={s.agentCursor}>█</Text>
            )}
          </View>

          {/* Stats */}
          <View style={s.statsRow}>
            <View style={s.statChip}>
              <Text style={s.statVal}>{stats.commits}</Text>
              <Text style={s.statLbl}>commits</Text>
            </View>
            <View style={s.statChip}>
              <Text style={s.statVal}>{stats.prs}</Text>
              <Text style={s.statLbl}>PRs</Text>
            </View>
            {stats.streak > 3 && (
              <View style={s.statChip}>
                <Text style={[s.statVal, stats.streak >= 8 && { color: '#fbbf24' }, stats.streak >= 14 && { color: '#f87171' }]}>
                  {stats.streak}d
                </Text>
                <Text style={s.statLbl}>streak</Text>
              </View>
            )}
          </View>

          {/* Footer */}
          <View style={s.cardFooter}>
            <Text style={s.codeText}>/{item.invite_code}</Text>
            <Text style={[s.enterText, hovered && { color: GREEN }]}>Enter →</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

// ─── Create / Join Card ────────────────────────────────────────────────────
function CreateJoinCard({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay: 0, useNativeDriver: false }).start();
    }, 700);
    return () => clearTimeout(t);
  }, [fadeAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <View style={s.createCard}>
        <Text style={s.createPlus}>+</Text>
        <Text style={s.createLabel}>Start something new</Text>
        <View style={{ gap: 8, width: '100%', maxWidth: 220, marginTop: 12 }}>
          <Pressable
            style={[s.createBtn, s.createBtnPrimary, hovered === 'c' && s.createBtnPrimaryHover]}
            onPress={onCreate}
            onHoverIn={() => setHovered('c')}
            onHoverOut={() => setHovered(null)}
            accessibilityRole="button"
            accessibilityLabel="Create a new circle"
          >
            <Text style={s.createBtnTextPri}>Create a Circle</Text>
          </Pressable>
          <Pressable
            style={[s.createBtn, hovered === 'j' && s.createBtnHover]}
            onPress={onJoin}
            onHoverIn={() => setHovered('j')}
            onHoverOut={() => setHovered(null)}
            accessibilityRole="button"
            accessibilityLabel="Join a circle with an invite code"
          >
            <Text style={s.createBtnText}>Join with Code</Text>
          </Pressable>
        </View>
      </View>
    </Animated.View>
  );
}

// ─── Empty State ───────────────────────────────────────────────────────────
function EmptyState({ onCreate, onJoin }: { onCreate: () => void; onJoin: () => void }) {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const taglines = useRef([
    'Every underground movement starts with the first circle.',
    'The void awaits your signal.',
    'Your agents are ready. Give them a home.',
  ]).current;
  const [tagIdx, setTagIdx] = useState(0);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, delay: 400, useNativeDriver: false }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(pulseAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    loop.start();
    const interval = setInterval(() => setTagIdx(i => (i + 1) % taglines.length), 5000);
    return () => { loop.stop(); clearInterval(interval); };
  }, [fadeAnim, pulseAnim, taglines]);

  const ringScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] });
  const ringOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  return (
    <Animated.View style={[s.emptyContainer, { opacity: fadeAnim }]}>
      <Animated.View style={[s.emptyRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}>
        <View style={s.emptyRingInner} />
      </Animated.View>

      <Text style={s.emptyTitle}>Create your first circle</Text>
      <Text style={s.emptyTagline}>{taglines[tagIdx]}</Text>

      <View style={{ gap: 10, marginTop: 24 }}>
        <Pressable style={[s.createBtn, s.createBtnPrimary]} onPress={onCreate} accessibilityRole="button">
          <Text style={s.createBtnTextPri}>Create a Circle</Text>
        </Pressable>
        <Pressable style={s.createBtn} onPress={onJoin} accessibilityRole="button">
          <Text style={s.createBtnText}>Join with Code</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────
export default function CirclesScreen({ navigation }: any) {
  const [circles, setCircles] = useState<Circle[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;

  const headerAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, delay: 200, useNativeDriver: false }).start();
  }, [headerAnim]);

  const fetchCircles = useCallback(async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
      if (!user) { setCircles([]); return; }

      const { data: optimizedData, error: funcError } = await supabase.rpc('get_user_circles', { user_uuid: user.id });
      if (!funcError && optimizedData) {
        setCircles(optimizedData.map((c: any) => ({
          id: c.id, name: c.name, description: c.description, invite_code: c.invite_code,
          max_members: c.max_members, created_by: c.created_by, created_at: c.created_at,
          member_count: Number(c.member_count) || 0, user_role: c.user_role,
          icon: c.icon, accent_color: c.accent_color, circle_image_url: c.circle_image_url,
        })));
        return;
      }

      const { data: memberships } = await supabase.from('circle_members').select('circle_id').eq('user_id', user.id).limit(50);
      if (!memberships?.length) { setCircles([]); return; }
      const { data } = await supabase.from('circles').select('*, circle_members!inner(count)').in('id', memberships.map(m => m.circle_id)).limit(50);
      setCircles((data || []).map((c: any) => ({ ...c, member_count: c.circle_members?.[0]?.count || 0 })));
    } catch (err) { console.error('CirclesScreen fetch error:', err); }
  }, []);

  useEffect(() => {
    fetchCircles();
    return navigation.addListener('focus', fetchCircles);
  }, [fetchCircles, navigation]);

  return (
    <View style={s.page}>
      <PortalAfterglow />
      <FloatingParticles />

      <ScrollView
        contentContainerStyle={s.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchCircles(); setRefreshing(false); }} tintColor={GREEN} />}
      >
        {/* Header */}
        <Animated.View style={[s.header, { opacity: headerAnim }]}>
          <View>
            <Text style={s.headerGreet}>Welcome back</Text>
            <Text style={s.headerTitle}>Your Circles</Text>
          </View>
          <View style={s.headerPill}>
            <Text style={s.headerPillText}>{circles.length} active</Text>
          </View>
        </Animated.View>

        {/* Content */}
        {circles.length === 0 ? (
          <EmptyState
            onCreate={() => navigation.navigate('CreateCircle')}
            onJoin={() => navigation.navigate('JoinCircle')}
          />
        ) : (
          <View style={[s.grid, isDesktop && circles.length > 1 && { flexDirection: 'row', flexWrap: 'wrap' }]}>
            {circles.map((item, i) => (
              <View key={item.id} style={[s.gridItem, isDesktop && circles.length > 1 && { width: '48%' }]}>
                <CircleCard item={item} index={i} onPress={() => navigation.navigate('CircleDetail', { circleId: item.id, circleName: item.name })} />
              </View>
            ))}
            <View style={[s.gridItem, isDesktop && circles.length > 1 && { width: '48%' }]}>
              <CreateJoinCard onCreate={() => navigation.navigate('CreateCircle')} onJoin={() => navigation.navigate('JoinCircle')} />
            </View>
          </View>
        )}

        {/* Bottom links */}
        <View style={s.bottomRow}>
          <Pressable onPress={() => navigation.navigate('OrgList')} style={s.bottomLink} accessibilityRole="button">
            <Text style={s.bottomLinkText}>Organizations</Text>
          </Pressable>
          <Text style={s.bottomDot}>·</Text>
          <Pressable onPress={() => navigation.navigate('Schools')} style={s.bottomLink} accessibilityRole="button">
            <Text style={s.bottomLinkText}>For Schools</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 24 },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
    maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 28,
  },
  headerGreet: { fontSize: 13, fontWeight: '500', color: TEXT_TER, marginBottom: 4 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.5 },
  headerPill: {
    backgroundColor: BG_RAISED, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: RADIUS_PILL, borderWidth: 1, borderColor: BORDER_DEF,
  },
  headerPillText: { fontSize: 12, fontWeight: '600', color: TEXT_SEC },

  // Grid
  grid: { maxWidth: 720, width: '100%', alignSelf: 'center', gap: 16 },
  gridItem: { width: '100%' },

  // Card
  card: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF,
    borderRadius: RADIUS_CARD, overflow: 'hidden', position: 'relative',
    ...(Platform.OS === 'web' ? {
      transition: 'all 220ms cubic-bezier(0.25,0.46,0.45,0.94)', cursor: 'pointer',
      boxShadow: `0 0 0 1px ${GREEN_GLOW3}`,
    } as any : {}),
  },
  cardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? {
      transform: [{ translateY: -1 }],
      boxShadow: `0 0 0 1px ${GREEN_GLOW8}, 0 4px 24px -4px rgba(0,0,0,0.5), 0 0 40px -8px ${GREEN_GLOW8}`,
    } as any : {}),
  },
  cardActive: { borderColor: GREEN_BORDER },

  accentStripe: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderTopLeftRadius: RADIUS_CARD, borderBottomLeftRadius: RADIUS_CARD,
  },
  cardInner: { padding: 20, paddingLeft: 22 },

  // Card header
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 },
  avatar: {
    width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center',
  },
  avatarImage: { width: 44, height: 44, borderRadius: 12 },
  avatarText: { fontSize: 18, fontWeight: '700' },
  cardHeaderText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.2 },
  cardDesc: { fontSize: 13, fontWeight: '400', color: TEXT_SEC, marginTop: 2 },
  pillBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: BG_RAISED, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: RADIUS_PILL, borderWidth: 1, borderColor: BORDER_DEF,
  },
  onlineDot: {
    width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN,
    ...(Platform.OS === 'web' ? { animation: 'uc-breathe 2s ease-in-out infinite' } as any : {}),
  },
  pillText: { fontSize: 12, fontWeight: '600', color: TEXT_SEC },

  // Agent bar
  agentBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: BG_INPUT + '80', paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: RADIUS_INNER, marginBottom: 14,
  },
  agentPrompt: { color: GREEN, fontSize: 12, fontFamily: MONO, fontWeight: '700' },
  agentText: { color: TEXT_DIS, fontSize: 12, fontFamily: MONO, flex: 1 },
  agentCursor: {
    color: GREEN, fontSize: 11, fontFamily: MONO,
    ...(Platform.OS === 'web' ? { animation: 'uc-cursor-blink 1s step-end infinite' } as any : {}),
  },

  // Stats
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: BG_RAISED, paddingHorizontal: 10, paddingVertical: 4,
    borderRadius: RADIUS_PILL, borderWidth: 1, borderColor: BORDER_DEF,
  },
  statVal: { fontSize: 12, fontWeight: '700', color: GREEN },
  statLbl: { fontSize: 11, fontWeight: '500', color: TEXT_TER },

  // Footer
  cardFooter: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: BORDER_DEF + '60', paddingTop: 12,
  },
  codeText: { fontSize: 11, fontWeight: '500', color: TEXT_DIS, fontFamily: MONO },
  enterText: {
    fontSize: 12, fontWeight: '600', color: TEXT_TER, letterSpacing: 0.3,
    ...(Platform.OS === 'web' ? { transition: 'color 150ms ease-out' } as any : {}),
  },

  // Create card
  createCard: {
    borderWidth: 1, borderColor: BORDER_DEF, borderStyle: 'dashed', borderRadius: RADIUS_CARD,
    backgroundColor: BG_SURFACE + '60', padding: 28, alignItems: 'center', justifyContent: 'center', minHeight: 200,
  },
  createPlus: { fontSize: 28, fontWeight: '300', color: TEXT_DIS, marginBottom: 4 },
  createLabel: { fontSize: 14, fontWeight: '500', color: TEXT_TER, marginBottom: 4 },
  createBtn: {
    paddingVertical: 11, paddingHorizontal: 20, borderRadius: RADIUS_BTN,
    borderWidth: 1, borderColor: BORDER_HOV, alignItems: 'center',
    ...(Platform.OS === 'web' ? { transition: 'all 180ms ease-out', cursor: 'pointer' } as any : {}),
  },
  createBtnHover: { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: '#3a3a4e' },
  createBtnPrimary: { backgroundColor: GREEN_GLOW8, borderColor: GREEN_BORDER },
  createBtnPrimaryHover: {
    ...(Platform.OS === 'web' ? { boxShadow: `0 0 24px -4px ${GREEN_GLOW15}`, backgroundColor: GREEN_GLOW15 } as any : {}),
  },
  createBtnTextPri: { fontSize: 14, fontWeight: '600', color: GREEN },
  createBtnText: { fontSize: 14, fontWeight: '500', color: TEXT_SEC },

  // Empty
  emptyContainer: { justifyContent: 'center', alignItems: 'center', paddingVertical: 80 },
  emptyRing: {
    width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderColor: GREEN,
    justifyContent: 'center', alignItems: 'center', marginBottom: 28,
  },
  emptyRingInner: {
    width: 60, height: 60, borderRadius: 30, borderWidth: 1, borderColor: GREEN + '30', backgroundColor: GREEN_GLOW8,
  },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.3, marginBottom: 8 },
  emptyTagline: { fontSize: 13, fontWeight: '400', color: TEXT_TER, fontStyle: 'italic', textAlign: 'center', maxWidth: 280, marginBottom: 8 },

  // Bottom
  bottomRow: {
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12,
    paddingTop: 32, maxWidth: 720, alignSelf: 'center',
  },
  bottomLink: { ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}) },
  bottomLinkText: { fontSize: 13, fontWeight: '500', color: TEXT_TER },
  bottomDot: { fontSize: 13, color: TEXT_DIS },
});
