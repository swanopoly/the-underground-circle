import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Animated, Easing,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useUserRewards } from '../services/rewardService';
import {
  BADGES, Badge, TIER_COLORS, BadgeTier,
  getNextBadge, getEarnedBadges, formatPoints, getPointsForModel,
} from '../lib/badges';
import HaloBadge from './HaloBadge';

interface Props {
  onClose?: () => void;
}

// ─── Animated XP bar ────────────────────────────────────────────────────────
function XpBar({ current, target, color, height = 8 }: {
  current: number; target: number; color: string; height?: number;
}) {
  const pct = Math.min(1, target > 0 ? current / target : 1);
  const w   = useRef(new Animated.Value(0)).current;
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(w, { toValue: pct, duration: 900, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    Animated.loop(
      Animated.timing(shimmer, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: false })
    ).start();
  }, [pct]);

  const shimLeft = shimmer.interpolate({ inputRange: [0, 1], outputRange: ['-20%', '120%'] as any });

  return (
    <View style={[xpSt.track, { height, borderRadius: height / 2 }]}>
      <Animated.View style={[
        xpSt.fill,
        { width: w.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), backgroundColor: color, borderRadius: height / 2 },
      ]} />
      {/* Shimmer */}
      <Animated.View style={[xpSt.shimmer, { left: shimLeft, height }]} />
      {/* Segment ticks */}
      <View style={StyleSheet.absoluteFillObject as any}>
        {Array.from({ length: 9 }).map((_, i) => (
          <View key={i} style={[xpSt.tick, { left: `${(i + 1) * 10}%` as any }]} />
        ))}
      </View>
    </View>
  );
}

const xpSt = StyleSheet.create({
  track: { flex: 1, backgroundColor: '#1a1a2e', overflow: 'hidden', position: 'relative' },
  fill:  { position: 'absolute', top: 0, left: 0, bottom: 0 },
  shimmer: { position: 'absolute', top: 0, width: 40, backgroundColor: '#ffffff', opacity: 0.2 },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#00000040' },
});

// ─── Tier section header ─────────────────────────────────────────────────────
function TierHeader({ tier, earnedCount, total }: {
  tier: BadgeTier; earnedCount: number; total: number;
}) {
  const tc = TIER_COLORS[tier];
  return (
    <View style={[thSt.row, { borderColor: tc.border + '30' }]}>
      <View style={[thSt.dot, { backgroundColor: tc.border }]} />
      <Text style={[thSt.label, { color: tc.border }]}>{tc.label}</Text>
      <View style={thSt.spacer} />
      <Text style={[thSt.count, { color: earnedCount === total ? tc.border : '#555' }]}>
        {earnedCount}/{total}
      </Text>
      {earnedCount === total && <Text style={{ fontSize: 10, marginLeft: 4 }}>✦</Text>}
    </View>
  );
}

const thSt = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 4, borderBottomWidth: 1, marginBottom: 10, marginTop: 4 },
  dot: { width: 7, height: 7, borderRadius: 3.5 },
  label: { fontSize: 11, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 2 },
  spacer: { flex: 1 },
  count: { fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
});

// ─── Badge card (expanded grid item) ─────────────────────────────────────────
function BadgeCard({ badge, earned, earnedAt }: {
  badge: Badge; earned: boolean; earnedAt?: string;
}) {
  const tc = TIER_COLORS[badge.tier];
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      style={[
        bcSt.card,
        { borderColor: earned ? tc.border + '55' : '#1a1a2e', opacity: earned ? 1 : 0.45 },
        pressed && earned && { backgroundColor: tc.bg + 'dd', transform: [{ scale: 0.97 }] },
      ]}
    >
      <HaloBadge badge={badge} earned={earned} size="sm" animate={earned} />
      <View style={bcSt.info}>
        <Text style={[bcSt.name, { color: earned ? tc.border : '#555' }]} numberOfLines={1}>
          {badge.name}
        </Text>
        <Text style={bcSt.desc} numberOfLines={2}>{badge.description}</Text>
        <View style={bcSt.footer}>
          {earned ? (
            <View style={[bcSt.earnedBadge, { borderColor: tc.border + '55', backgroundColor: tc.border + '18' }]}>
              <Text style={[bcSt.earnedText, { color: tc.border }]}>
                {earnedAt ? `✓ ${new Date(earnedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : '✓ EARNED'}
              </Text>
            </View>
          ) : (
            <Text style={bcSt.xpReq}>{formatPoints(badge.pointsRequired)} XP</Text>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const bcSt = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    backgroundColor: '#0c0c18',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
  },
  info: { flex: 1, gap: 3 },
  name: { fontSize: 13, fontWeight: '900', fontFamily: 'monospace' },
  desc: { color: '#888', fontSize: 10, fontFamily: 'monospace', lineHeight: 14 },
  footer: { flexDirection: 'row', marginTop: 2 },
  earnedBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  earnedText: { fontSize: 8, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.5 },
  xpReq: { fontSize: 9, color: '#444', fontFamily: 'monospace', fontWeight: '700' },
});

// ─── Stat box ────────────────────────────────────────────────────────────────
function StatBox({ value, label, color = '#00FF9C', sub }: {
  value: string; label: string; color?: string; sub?: string;
}) {
  return (
    <View style={sbSt.box}>
      <Text style={[sbSt.value, { color }]}>{value}</Text>
      <Text style={sbSt.label}>{label}</Text>
      {sub && <Text style={sbSt.sub}>{sub}</Text>}
    </View>
  );
}

const sbSt = StyleSheet.create({
  box: { flex: 1, alignItems: 'center', paddingVertical: 12, gap: 4 },
  value: { fontSize: 22, fontWeight: '900', fontFamily: 'monospace' },
  label: { color: '#555', fontSize: 8, fontFamily: 'monospace', letterSpacing: 1, textTransform: 'uppercase' as any },
  sub: { color: '#333', fontSize: 7, fontFamily: 'monospace', marginTop: 1 },
});

// ─── Main component ───────────────────────────────────────────────────────────
const TIER_ORDER: BadgeTier[] = ['bronze', 'silver', 'gold', 'platinum', 'legendary'];

export default function RewardsPanel({ onClose }: Props) {
  const [userId, setUserId] = useState<string | undefined>();
  const [selectedTier, setSelectedTier] = useState<BadgeTier | 'all'>('all');
  const { points, badges, loading } = useUserRewards(userId);
  const { width } = useWindowDimensions();

  useEffect(() => {
    supabase.auth.getUser()
      .then(({ data: { user } }) => setUserId(user?.id))
      .catch(() => {});
  }, []);

  const earnedMap = new Map(badges.map(b => [b.badge_id, b]));
  const lifetime   = points?.lifetime_points ?? 0;
  const streak     = points?.current_streak  ?? 0;
  const bestStreak = points?.longest_streak  ?? 0;
  const earnedBadges = getEarnedBadges(lifetime);
  const nextBadge    = getNextBadge(lifetime);
  const currentBadge = earnedBadges.length > 0 ? earnedBadges[earnedBadges.length - 1] : null;

  // Progress toward next badge within current tier segment
  const tierStart  = currentBadge?.pointsRequired ?? 0;
  const tierEnd    = nextBadge?.pointsRequired ?? tierStart;
  const tierProgress = tierEnd > tierStart
    ? Math.round(((lifetime - tierStart) / (tierEnd - tierStart)) * 100)
    : 100;

  const filteredBadges = selectedTier === 'all'
    ? BADGES
    : BADGES.filter(b => b.tier === selectedTier);

  // Group for "all" view
  const badgesByTier = TIER_ORDER.map(tier => ({
    tier,
    badges: BADGES.filter(b => b.tier === tier),
    earnedCount: BADGES.filter(b => b.tier === tier && earnedMap.has(b.id)).length,
  }));

  const currentIcon = currentBadge
    ? (currentBadge.name.includes('Demon')   ? '👾'
     : currentBadge.name.includes('Spartan') ? '🏆'
     : currentBadge.name.includes('Major')   ? '💫'
     : currentBadge.name.includes('Captain') ? '🌟'
     : currentBadge.name.includes('Commander') ? '⚜️'
     : currentBadge.name.includes('Lieutenant') ? '🔥'
     : currentBadge.name.includes('Warrant') ? '👁'
     : currentBadge.name.includes('Master Sgt') ? '🌀'
     : currentBadge.name.includes('Gunnery') ? '💠'
     : currentBadge.name.includes('Staff')   ? '🔱'
     : currentBadge.name.includes('Sergeant') ? '⚔️'
     : currentBadge.name.includes('Corporal') ? '🎯'
     : currentBadge.name.includes('Private')  ? '🛡️'
     : '⚡')
    : '💀';

  const badgeColor = currentBadge ? TIER_COLORS[currentBadge.tier].border : '#444';

  return (
    <View style={s.container}>
      {/* ── Header ── */}
      <View style={s.header}>
        <View>
          <Text style={s.title}>⚔️ ACHIEVEMENTS</Text>
          <Text style={s.subtitle}>Underground Circle · Combat Record</Text>
        </View>
        {onClose && (
          <Pressable onPress={onClose} style={s.closeBtn}>
            <Text style={s.closeText}>✕</Text>
          </Pressable>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 40 }}>

        {/* ── Current Rank Hero ── */}
        <View style={[s.rankHero, { borderColor: badgeColor + '40' }]}>
          <View style={s.rankHeroLeft}>
            <View style={[s.rankIconWrap, { backgroundColor: badgeColor + '18', borderColor: badgeColor + '55' }]}>
              <Text style={s.rankIcon}>{currentIcon}</Text>
            </View>
            <View style={s.rankHeroInfo}>
              <Text style={s.rankHeroLabel}>CURRENT RANK</Text>
              <Text style={[s.rankHeroName, { color: badgeColor }]}>
                {currentBadge ? currentBadge.name.toUpperCase() : 'UNRANKED'}
              </Text>
              {currentBadge && (
                <Text style={s.rankHeroDesc}>{currentBadge.description}</Text>
              )}
            </View>
          </View>
          {currentBadge && (
            <HaloBadge badge={currentBadge} earned size="md" animate />
          )}
        </View>

        {/* Current rank lore */}
        {currentBadge && (
          <View style={[s.loreCard, { borderColor: badgeColor + '30' }]}>
            <Text style={s.loreQuote}>{currentBadge.lore}</Text>
            <Text style={[s.loreTier, { color: badgeColor }]}>
              {TIER_COLORS[currentBadge.tier].label} TIER
            </Text>
          </View>
        )}

        {/* ── Stats row ── */}
        <View style={s.statsCard}>
          <StatBox value={formatPoints(lifetime)} label="Lifetime XP" color="#00FF9C" />
          <View style={s.divider} />
          <StatBox value={`${earnedMap.size}`} label="Badges Earned" color="#ffd700" sub={`of ${BADGES.length}`} />
          <View style={s.divider} />
          <StatBox value={`${streak}`} label="Day Streak" color="#6366f1" sub={`best: ${bestStreak}`} />
        </View>

        {/* ── Next rank progress ── */}
        {nextBadge && (
          <View style={[s.nextCard, { borderColor: TIER_COLORS[nextBadge.tier].border + '40' }]}>
            <View style={s.nextTop}>
              <View>
                <Text style={s.nextLabel}>NEXT RANK</Text>
                <Text style={[s.nextName, { color: TIER_COLORS[nextBadge.tier].border }]}>
                  {nextBadge.name}
                </Text>
                <Text style={s.nextDesc}>{nextBadge.description}</Text>
              </View>
              <HaloBadge badge={nextBadge} earned={false} size="sm" />
            </View>
            <View style={s.nextBarRow}>
              <XpBar current={lifetime - tierStart} target={tierEnd - tierStart} color={TIER_COLORS[nextBadge.tier].border} />
              <Text style={[s.nextPct, { color: TIER_COLORS[nextBadge.tier].border }]}>{tierProgress}%</Text>
            </View>
            <View style={s.nextXpRow}>
              <Text style={s.nextXpCurrent}>{formatPoints(lifetime)} XP</Text>
              <Text style={s.nextXpNeeded}>
                {formatPoints(nextBadge.pointsRequired - lifetime)} remaining
              </Text>
              <Text style={s.nextXpTarget}>{formatPoints(nextBadge.pointsRequired)} XP</Text>
            </View>
          </View>
        )}

        {/* ── All-tier progress overview ── */}
        <View style={s.tierOverviewCard}>
          <Text style={s.sectionTitle}>TIER PROGRESS</Text>
          {TIER_ORDER.map(tier => {
            const tc = TIER_COLORS[tier];
            const tierBadges = BADGES.filter(b => b.tier === tier);
            const earned = tierBadges.filter(b => earnedMap.has(b.id)).length;
            const complete = earned === tierBadges.length;
            return (
              <View key={tier} style={s.tierRow}>
                <View style={[s.tierDot, { backgroundColor: tc.border }]} />
                <Text style={[s.tierRowLabel, { color: tc.border }]}>{tc.label}</Text>
                <View style={s.tierBarWrap}>
                  <XpBar current={earned} target={tierBadges.length} color={tc.border} height={6} />
                </View>
                <Text style={[s.tierRowCount, { color: complete ? tc.border : '#555' }]}>
                  {earned}/{tierBadges.length}
                  {complete ? ' ✦' : ''}
                </Text>
              </View>
            );
          })}
        </View>

        {/* ── Recent unlocks ── */}
        {badges.length > 0 && (() => {
          const recent = [...badges]
            .sort((a, b) => new Date(b.earned_at).getTime() - new Date(a.earned_at).getTime())
            .slice(0, 3);
          return (
            <View style={s.timelineCard}>
              <Text style={s.sectionTitle}>RECENT UNLOCKS</Text>
              {recent.map(ub => {
                const b = BADGES.find(x => x.id === ub.badge_id);
                if (!b) return null;
                const tc = TIER_COLORS[b.tier];
                return (
                  <View key={ub.badge_id} style={[s.timelineRow, { borderColor: tc.border + '30' }]}>
                    <View style={[s.timelineDot, { backgroundColor: tc.border }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[s.timelineName, { color: tc.border }]}>{b.name}</Text>
                      <Text style={s.timelineDesc}>{b.description}</Text>
                    </View>
                    <View style={s.timelineRight}>
                      <Text style={[s.timelineTier, { color: tc.border }]}>{tc.label}</Text>
                      <Text style={s.timelineDate}>
                        {new Date(ub.earned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </Text>
                      <Text style={s.timelineXp}>{formatPoints(ub.points_at_earn)} XP</Text>
                    </View>
                  </View>
                );
              })}
            </View>
          );
        })()}

        {/* ── Tier filter ── */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tierFilterScroll} contentContainerStyle={s.tierFilterContent}>
          {(['all', ...TIER_ORDER] as const).map(t => {
            const active = selectedTier === t;
            const color = t === 'all' ? '#6366f1' : TIER_COLORS[t].border;
            return (
              <Pressable
                key={t}
                style={[s.tierBtn, active && { backgroundColor: color + '20', borderColor: color + '60' }]}
                onPress={() => setSelectedTier(t)}
              >
                <Text style={[s.tierBtnText, active && { color }]}>
                  {t === 'all' ? 'ALL' : TIER_COLORS[t].label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* ── Badge list ── */}
        <View style={s.badgeList}>
          {selectedTier === 'all' ? (
            // Grouped by tier
            badgesByTier.map(({ tier, badges: tierBadges, earnedCount }) => (
              <View key={tier}>
                <TierHeader tier={tier} earnedCount={earnedCount} total={tierBadges.length} />
                {tierBadges.map(badge => (
                  <BadgeCard
                    key={badge.id}
                    badge={badge}
                    earned={earnedMap.has(badge.id)}
                    earnedAt={earnedMap.get(badge.id)?.earned_at}
                  />
                ))}
              </View>
            ))
          ) : (
            filteredBadges.map(badge => (
              <BadgeCard
                key={badge.id}
                badge={badge}
                earned={earnedMap.has(badge.id)}
                earnedAt={earnedMap.get(badge.id)?.earned_at}
              />
            ))
          )}
        </View>

        {/* ── XP Rate card ── */}
        <View style={s.keyCard}>
          <Text style={s.sectionTitle}>⚡ XP PER AGENT TURN</Text>
          <Text style={s.keySubtitle}>Every agent task earns you XP. Heavier models, bigger rewards.</Text>
          {[
            { label: 'BlackSwan LLM', pts: 50, color: '#00FF9C', icon: '🦢' },
            { label: 'Opus / GPT-4 / Gemini Ultra', pts: 25, color: '#ffd700', icon: '🧠' },
            { label: 'Sonnet / GPT-4o / Claude 3.5', pts: 15, color: '#c0c0c0', icon: '🎯' },
            { label: 'Haiku / Flash / Mini', pts: 8, color: '#cd7f32', icon: '⚡' },
            { label: 'Other / Unknown models', pts: 10, color: '#6366f1', icon: '🤖' },
          ].map(k => (
            <View key={k.label} style={s.keyRow}>
              <Text style={s.keyIcon}>{k.icon}</Text>
              <Text style={s.keyLabel}>{k.label}</Text>
              <View style={[s.keyPtsBadge, { borderColor: k.color + '55', backgroundColor: k.color + '15' }]}>
                <Text style={[s.keyPts, { color: k.color }]}>+{k.pts} XP</Text>
              </View>
            </View>
          ))}
        </View>

        {/* ── Bottom lore ── */}
        <View style={s.bottomLore}>
          <Text style={s.bottomLoreText}>
            "{currentBadge
              ? `You have proven yourself. Keep building. The Circle watches.`
              : `The journey of a thousand commits begins with a single deploy.`}"
          </Text>
          <Text style={s.bottomLoreBy}>— The Underground Circle</Text>
        </View>

      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#07070f' },

  // Header
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderColor: '#1a1a2e',
  },
  title: { color: '#eee', fontSize: 18, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 3 },
  subtitle: { color: '#444', fontSize: 10, fontFamily: 'monospace', marginTop: 2, letterSpacing: 1 },
  closeBtn: { padding: 8 },
  closeText: { color: '#666', fontSize: 18 },

  // Rank hero
  rankHero: {
    margin: 16, marginBottom: 0, padding: 16,
    backgroundColor: '#0c0c18', borderWidth: 1, borderRadius: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  rankHeroLeft: { flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 },
  rankIconWrap: { width: 52, height: 52, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  rankIcon: { fontSize: 26 },
  rankHeroInfo: { flex: 1, gap: 3 },
  rankHeroLabel: { color: '#555', fontSize: 9, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 2 },
  rankHeroName: { fontSize: 17, fontWeight: '900', fontFamily: 'monospace' },
  rankHeroDesc: { color: '#888', fontSize: 11, fontFamily: 'monospace' },

  // Lore
  loreCard: {
    marginHorizontal: 16, marginTop: 8, marginBottom: 4,
    padding: 14, backgroundColor: '#0a0a16', borderWidth: 1, borderRadius: 12,
  },
  loreQuote: { color: '#777', fontSize: 11, fontFamily: 'monospace', fontStyle: 'italic', lineHeight: 17, marginBottom: 6 },
  loreTier: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 1.5 },

  // Stats
  statsCard: {
    margin: 16, marginBottom: 12,
    backgroundColor: '#0c0c18', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 14,
    flexDirection: 'row',
  },
  divider: { width: 1, backgroundColor: '#1a1a2e', marginVertical: 10 },

  // Next rank
  nextCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 16,
    backgroundColor: '#0c0c18', borderWidth: 1, borderRadius: 14, gap: 10,
  },
  nextTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  nextLabel: { color: '#555', fontSize: 9, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 2, marginBottom: 2 },
  nextName: { fontSize: 16, fontWeight: '900', fontFamily: 'monospace', marginBottom: 2 },
  nextDesc: { color: '#888', fontSize: 10, fontFamily: 'monospace' },
  nextBarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  nextPct: { fontSize: 11, fontWeight: '900', fontFamily: 'monospace', minWidth: 32, textAlign: 'right' },
  nextXpRow: { flexDirection: 'row', justifyContent: 'space-between' },
  nextXpCurrent: { color: '#666', fontSize: 9, fontFamily: 'monospace' },
  nextXpNeeded: { color: '#444', fontSize: 9, fontFamily: 'monospace' },
  nextXpTarget: { color: '#444', fontSize: 9, fontFamily: 'monospace' },

  // Tier overview
  tierOverviewCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 16,
    backgroundColor: '#0c0c18', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 14, gap: 8,
  },
  tierRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tierDot: { width: 7, height: 7, borderRadius: 3.5 },
  tierRowLabel: { fontSize: 9, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1, width: 70 },
  tierBarWrap: { flex: 1 },
  tierRowCount: { fontSize: 9, fontFamily: 'monospace', fontWeight: '700', width: 40, textAlign: 'right' },

  // Timeline
  timelineCard: {
    marginHorizontal: 16, marginBottom: 12, padding: 16,
    backgroundColor: '#0c0c18', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 14, gap: 4,
  },
  timelineRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, borderBottomWidth: 1,
  },
  timelineDot: { width: 8, height: 8, borderRadius: 4 },
  timelineName: { fontSize: 13, fontWeight: '800', fontFamily: 'monospace' },
  timelineDesc: { color: '#666', fontSize: 10, fontFamily: 'monospace', marginTop: 1 },
  timelineRight: { alignItems: 'flex-end', gap: 2 },
  timelineTier: { fontSize: 8, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 1 },
  timelineDate: { color: '#555', fontSize: 9, fontFamily: 'monospace' },
  timelineXp: { color: '#444', fontSize: 8, fontFamily: 'monospace' },

  // Section title
  sectionTitle: { color: '#444', fontSize: 9, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 2, marginBottom: 10 },

  // Tier filter
  tierFilterScroll: { flexGrow: 0, marginBottom: 4 },
  tierFilterContent: { paddingHorizontal: 16, gap: 8, paddingVertical: 8 },
  tierBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#1a1a2e' },
  tierBtnText: { color: '#555', fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },

  // Badge list
  badgeList: { paddingHorizontal: 16, marginBottom: 8 },

  // XP key
  keyCard: {
    margin: 16, marginBottom: 12, padding: 16,
    backgroundColor: '#0c0c18', borderWidth: 1, borderColor: '#1a1a2e', borderRadius: 14,
  },
  keySubtitle: { color: '#555', fontSize: 10, fontFamily: 'monospace', marginBottom: 12, lineHeight: 14 },
  keyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderBottomWidth: 1, borderColor: '#111' },
  keyIcon: { fontSize: 16, width: 22, textAlign: 'center' },
  keyLabel: { flex: 1, color: '#888', fontSize: 11, fontFamily: 'monospace' },
  keyPtsBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  keyPts: { fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },

  // Bottom lore
  bottomLore: { marginHorizontal: 16, marginTop: 4, alignItems: 'center', paddingVertical: 16, gap: 6 },
  bottomLoreText: { color: '#333', fontSize: 11, fontFamily: 'monospace', fontStyle: 'italic', textAlign: 'center', lineHeight: 17 },
  bottomLoreBy: { color: '#252535', fontSize: 9, fontFamily: 'monospace', letterSpacing: 1 },
});
