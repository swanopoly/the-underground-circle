import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, ScrollView, StyleSheet, Pressable, RefreshControl, Image, Animated, Easing, Platform, useWindowDimensions,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getMyOrganizations, type OrgWithCounts } from '../../lib/organizations';

// ─── Design Tokens (shared with CirclesScreen) ────────────────────────────
const BG_PAGE = '#050508', BG_SURFACE = '#0a0a10', BG_RAISED = '#0f0f18', BG_INPUT = '#1a1a28';
const INDIGO = '#6366f1', INDIGO_GLOW = 'rgba(99,102,241,0.08)', INDIGO_BORDER = 'rgba(99,102,241,0.25)';
const GREEN = '#b8ff61';
const TEXT_PRI = '#f0f0f5', TEXT_SEC = '#a0a0b0', TEXT_TER = '#606075', TEXT_DIS = '#3a3a4e';
const BORDER_DEF = '#1a1a28', BORDER_HOV = '#2a2a3e';
const R_CARD = 14, R_BTN = 10, R_PILL = 100;

const PLAN_COLORS: Record<string, string> = { free: '#6b7280', pro: '#6366f1', business: '#f59e0b', enterprise: '#ec4899' };
const PLAN_LABELS: Record<string, string> = { free: 'Free', pro: 'Pro', business: 'Business', enterprise: 'Enterprise' };

// ─── Org Card ──────────────────────────────────────────────────────────────
const OrgCard = React.memo(function OrgCard({ org, onPress, index }: { org: OrgWithCounts; onPress: () => void; index: number }) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;
  const planColor = PLAN_COLORS[org.plan] || '#6b7280';

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
        Animated.timing(slideAnim, { toValue: 0, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
      ]).start();
    }, 400 + index * 60);
    return () => clearTimeout(t);
  }, [index, fadeAnim, slideAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={`View organization ${org.name}`}
        style={[s.card, hovered && s.cardHover]}
      >
        <View style={[s.accentStripe, { backgroundColor: planColor }]} />
        <View style={s.cardInner}>
          {/* Header */}
          <View style={s.cardHeader}>
            {org.logo_url ? (
              <Image source={{ uri: org.logo_url }} style={s.avatar} />
            ) : (
              <View style={[s.avatarFallback, { backgroundColor: planColor + '18' }]}>
                <Text style={[s.avatarText, { color: planColor }]}>{org.name.charAt(0).toUpperCase()}</Text>
              </View>
            )}
            <View style={s.headerText}>
              <Text style={s.cardTitle} numberOfLines={1}>{org.name}</Text>
              <Text style={s.cardSlug}>/{org.slug}</Text>
            </View>
            <View style={[s.planPill, { backgroundColor: planColor + '15', borderColor: planColor + '40' }]}>
              <Text style={[s.planPillText, { color: planColor }]}>{PLAN_LABELS[org.plan] || org.plan}</Text>
            </View>
          </View>

          {/* Stats */}
          <View style={s.statsRow}>
            <View style={s.statChip}>
              <Text style={s.statVal}>{org.member_count || 0}</Text>
              <Text style={s.statLbl}>members</Text>
            </View>
            <View style={s.statChip}>
              <Text style={s.statVal}>{org.circle_count || 0}</Text>
              <Text style={s.statLbl}>circles</Text>
            </View>
            <View style={{ flex: 1 }} />
            <Text style={[s.enterText, hovered && { color: INDIGO }]}>View →</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
});

// ─── Empty State ───────────────────────────────────────────────────────────
function EmptyState({ onCreatePress }: { onCreatePress: () => void }) {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, delay: 400, useNativeDriver: false }).start();
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(pulseAnim, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [fadeAnim, pulseAnim]);

  const ringScale = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1.05] });
  const ringOpacity = pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.7] });

  return (
    <Animated.View style={[s.emptyContainer, { opacity: fadeAnim }]}>
      <Animated.View style={[s.emptyRing, { transform: [{ scale: ringScale }], opacity: ringOpacity, borderColor: INDIGO }]}>
        <View style={[s.emptyRingInner, { borderColor: INDIGO + '30', backgroundColor: INDIGO_GLOW }]} />
      </Animated.View>
      <Text style={s.emptyTitle}>Create your first organization</Text>
      <Text style={s.emptyDesc}>Manage multiple circles, teams, and billing under one roof.</Text>

      <View style={s.emptyFeatures}>
        {['Centralized billing & members', 'Shared circles with role access', 'Analytics across all circles', 'Custom branding options'].map((f, i) => (
          <View key={i} style={s.featureRow}>
            <Text style={s.featureCheck}>✓</Text>
            <Text style={s.featureText}>{f}</Text>
          </View>
        ))}
      </View>

      <Pressable style={s.primaryBtn} onPress={onCreatePress} accessibilityRole="button">
        <Text style={s.primaryBtnText}>Create Organization</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────
export default function OrgListScreen({ navigation }: any) {
  const [orgs, setOrgs] = useState<OrgWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const { width } = useWindowDimensions();
  const isDesktop = width >= 768;
  const headerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, delay: 200, useNativeDriver: false }).start();
  }, [headerAnim]);

  const fetchOrgs = useCallback(async () => {
    setLoading(true);
    try { setOrgs(await getMyOrganizations()); } catch (err) { console.error('Org fetch error:', err); }
    finally { setLoading(false); }
  }, []);

  useFocusEffect(useCallback(() => { fetchOrgs(); }, [fetchOrgs]));

  return (
    <View style={s.page}>
      <ScrollView contentContainerStyle={s.scroll} refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchOrgs} tintColor={INDIGO} />}>
        {/* Header */}
        <Animated.View style={[s.header, { opacity: headerAnim }]}>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={s.backText}>← Back</Text>
          </Pressable>
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text style={s.headerGreet}>Manage your teams</Text>
            <Text style={s.headerTitle}>Organizations</Text>
          </View>
          <Pressable onPress={() => navigation.navigate('CreateOrg')} style={s.newBtn} accessibilityRole="button">
            <Text style={s.newBtnText}>+ New</Text>
          </Pressable>
        </Animated.View>

        {/* Content */}
        {orgs.length === 0 && !loading ? (
          <EmptyState onCreatePress={() => navigation.navigate('CreateOrg')} />
        ) : (
          <View style={[s.grid, isDesktop && orgs.length > 1 && { flexDirection: 'row', flexWrap: 'wrap' }]}>
            {orgs.map((org, i) => (
              <View key={org.id} style={[s.gridItem, isDesktop && orgs.length > 1 && { width: '48%' }]}>
                <OrgCard org={org} index={i} onPress={() => navigation.navigate('OrgDetail', { orgId: org.id, orgName: org.name })} />
              </View>
            ))}
            {/* Create another card */}
            <View style={[s.gridItem, isDesktop && orgs.length > 1 && { width: '48%' }]}>
              <Pressable style={s.createCard} onPress={() => navigation.navigate('CreateOrg')} accessibilityRole="button">
                <Text style={s.createPlus}>+</Text>
                <Text style={s.createLabel}>Create another organization</Text>
              </Pressable>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 24 },

  header: {
    flexDirection: 'row', alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 28,
  },
  backText: { fontSize: 13, fontWeight: '500', color: INDIGO },
  headerGreet: { fontSize: 13, fontWeight: '500', color: TEXT_TER, marginBottom: 2 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.5 },
  newBtn: {
    backgroundColor: INDIGO, paddingHorizontal: 16, paddingVertical: 8, borderRadius: R_BTN,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  newBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  grid: { maxWidth: 720, width: '100%', alignSelf: 'center', gap: 16 },
  gridItem: { width: '100%' },

  card: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative',
    ...(Platform.OS === 'web' ? { transition: 'all 220ms cubic-bezier(0.25,0.46,0.45,0.94)', cursor: 'pointer', boxShadow: `0 0 0 1px rgba(99,102,241,0.03)` } as any : {}),
  },
  cardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -1 }], boxShadow: `0 0 0 1px ${INDIGO_GLOW}, 0 4px 24px -4px rgba(0,0,0,0.5), 0 0 40px -8px ${INDIGO_GLOW}` } as any : {}),
  },
  accentStripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD },
  cardInner: { padding: 20, paddingLeft: 22 },

  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  avatar: { width: 44, height: 44, borderRadius: 12 },
  avatarFallback: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 18, fontWeight: '700' },
  headerText: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.2 },
  cardSlug: { fontSize: 12, fontWeight: '500', color: TEXT_TER, marginTop: 2 },
  planPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: R_PILL, borderWidth: 1 },
  planPillText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },

  statsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderTopWidth: 1, borderTopColor: BORDER_DEF + '60', paddingTop: 14,
  },
  statChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: BG_RAISED, paddingHorizontal: 10, paddingVertical: 4, borderRadius: R_PILL, borderWidth: 1, borderColor: BORDER_DEF,
  },
  statVal: { fontSize: 12, fontWeight: '700', color: INDIGO },
  statLbl: { fontSize: 11, fontWeight: '500', color: TEXT_TER },
  enterText: {
    fontSize: 12, fontWeight: '600', color: TEXT_TER, letterSpacing: 0.3,
    ...(Platform.OS === 'web' ? { transition: 'color 150ms ease-out' } as any : {}),
  },

  createCard: {
    borderWidth: 1, borderColor: BORDER_DEF, borderStyle: 'dashed', borderRadius: R_CARD,
    backgroundColor: BG_SURFACE + '60', padding: 28, alignItems: 'center', justifyContent: 'center', minHeight: 140,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 200ms ease-out' } as any : {}),
  },
  createPlus: { fontSize: 24, fontWeight: '300', color: TEXT_DIS, marginBottom: 4 },
  createLabel: { fontSize: 13, fontWeight: '500', color: TEXT_TER },

  emptyContainer: { justifyContent: 'center', alignItems: 'center', paddingVertical: 60 },
  emptyRing: { width: 100, height: 100, borderRadius: 50, borderWidth: 2, justifyContent: 'center', alignItems: 'center', marginBottom: 28 },
  emptyRingInner: { width: 60, height: 60, borderRadius: 30, borderWidth: 1 },
  emptyTitle: { fontSize: 20, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.3, marginBottom: 8 },
  emptyDesc: { fontSize: 14, fontWeight: '400', color: TEXT_SEC, textAlign: 'center', maxWidth: 340, marginBottom: 24, lineHeight: 20 },
  emptyFeatures: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    padding: 18, marginBottom: 24, width: '100%', maxWidth: 360,
  },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  featureCheck: { color: GREEN, fontSize: 13, fontWeight: '700' },
  featureText: { color: TEXT_SEC, fontSize: 13, flex: 1 },
  primaryBtn: {
    backgroundColor: INDIGO_GLOW, borderWidth: 1, borderColor: INDIGO_BORDER,
    paddingHorizontal: 28, paddingVertical: 13, borderRadius: R_BTN,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  primaryBtnText: { color: INDIGO, fontSize: 14, fontWeight: '600' },
});
