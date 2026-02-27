import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Animated,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { useUserRewards } from '../services/rewardService';
import { BADGES, Badge, TIER_COLORS, getNextBadge, formatPoints } from '../lib/badges';
import HaloBadge from './HaloBadge';

interface Props {
  onClose?: () => void;
}

function ProgressBar({ current, target, color }: { current: number; target: number; color: string }) {
  const pct = Math.min(1, current / target);
  const widthAnim = React.useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(widthAnim, { toValue: pct, duration: 800, useNativeDriver: false }).start();
  }, [pct]);
  return (
    <View style={progressStyles.track}>
      <Animated.View style={[
        progressStyles.fill,
        { width: widthAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }), backgroundColor: color },
      ]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: { height: 4, backgroundColor: '#1a1a2e', borderRadius: 2, overflow: 'hidden', flex: 1 },
  fill: { height: '100%', borderRadius: 2 },
});

export default function RewardsPanel({ onClose }: Props) {
  const [userId, setUserId] = useState<string | undefined>();
  const [selectedTier, setSelectedTier] = useState<string>('all');
  const { points, badges, loading } = useUserRewards(userId);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUserId(user?.id));
  }, []);

  const earnedIds = new Set(badges.map(b => b.badge_id));
  const lifetime = points?.lifetime_points ?? 0;
  const nextBadge = getNextBadge(lifetime);

  const TIERS = ['all', 'bronze', 'silver', 'gold', 'platinum', 'legendary'];
  const filteredBadges = BADGES.filter(b =>
    selectedTier === 'all' || b.tier === selectedTier,
  );

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>ACHIEVEMENTS</Text>
          <Text style={styles.subtitle}>Underground Circle · Combat Record</Text>
        </View>
        {onClose && (
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Points summary */}
        <View style={styles.pointsCard}>
          <View style={styles.pointsRow}>
            <View style={styles.pointsStat}>
              <Text style={styles.pointsValue}>{formatPoints(lifetime)}</Text>
              <Text style={styles.pointsLabel}>LIFETIME XP</Text>
            </View>
            <View style={styles.pointsDivider} />
            <View style={styles.pointsStat}>
              <Text style={[styles.pointsValue, { color: '#ffd700' }]}>{earnedIds.size}</Text>
              <Text style={styles.pointsLabel}>BADGES EARNED</Text>
            </View>
            <View style={styles.pointsDivider} />
            <View style={styles.pointsStat}>
              <Text style={[styles.pointsValue, { color: '#6366f1' }]}>{BADGES.length - earnedIds.size}</Text>
              <Text style={styles.pointsLabel}>REMAINING</Text>
            </View>
          </View>

          {/* Progress to next badge */}
          {nextBadge && (
            <View style={styles.nextBadge}>
              <View style={styles.nextBadgeHeader}>
                <Text style={styles.nextBadgeLabel}>NEXT: {nextBadge.name.toUpperCase()}</Text>
                <Text style={[styles.nextBadgePoints, { color: TIER_COLORS[nextBadge.tier].border }]}>
                  {formatPoints(lifetime)} / {formatPoints(nextBadge.pointsRequired)}
                </Text>
              </View>
              <ProgressBar
                current={lifetime}
                target={nextBadge.pointsRequired}
                color={TIER_COLORS[nextBadge.tier].border}
              />
            </View>
          )}
        </View>

        {/* Most recent badge */}
        {badges.length > 0 && (() => {
          const latestId = badges[badges.length - 1].badge_id;
          const latestBadge = BADGES.find(b => b.id === latestId);
          if (!latestBadge) return null;
          return (
            <View style={styles.latestCard}>
              <Text style={styles.latestLabel}>CURRENT RANK</Text>
              <View style={styles.latestContent}>
                <HaloBadge badge={latestBadge} earned size="md" animate />
                <View style={styles.latestInfo}>
                  <Text style={[styles.latestName, { color: TIER_COLORS[latestBadge.tier].border }]}>
                    {latestBadge.name}
                  </Text>
                  <Text style={styles.latestDesc}>{latestBadge.description}</Text>
                  <Text style={[styles.latestLore, { color: TIER_COLORS[latestBadge.tier].border + 'aa' }]}>
                    {latestBadge.lore}
                  </Text>
                </View>
              </View>
            </View>
          );
        })()}

        {/* Tier filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tierFilter}>
          {TIERS.map(t => (
            <Pressable
              key={t}
              style={[styles.tierBtn, selectedTier === t && styles.tierBtnActive]}
              onPress={() => setSelectedTier(t)}
            >
              <Text style={[styles.tierBtnText, selectedTier === t && styles.tierBtnTextActive]}>
                {t.toUpperCase()}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Badge grid */}
        <View style={styles.grid}>
          {filteredBadges.map(badge => {
            const earned = earnedIds.has(badge.id);
            const tier = TIER_COLORS[badge.tier];
            return (
              <View key={badge.id} style={[styles.badgeCell, !earned && styles.badgeCellLocked]}>
                <HaloBadge badge={badge} earned={earned} size="sm" />
                <Text style={[styles.badgeCellName, { color: earned ? tier.border : '#444' }]} numberOfLines={1}>
                  {badge.name}
                </Text>
                <Text style={[styles.badgeCellPoints, { color: earned ? '#888' : '#333' }]}>
                  {formatPoints(badge.pointsRequired)} XP
                </Text>
                {earned && (
                  <View style={[styles.earnedDot, { backgroundColor: tier.border }]} />
                )}
              </View>
            );
          })}
        </View>

        {/* Points key */}
        <View style={styles.keyCard}>
          <Text style={styles.keyTitle}>XP PER AGENT TURN</Text>
          {[
            { label: 'Opus / GPT-4 / Ultra', pts: 10, color: '#ffd700' },
            { label: 'Sonnet / GPT-4o', pts: 5, color: '#c0c0c0' },
            { label: 'Haiku / Flash / Mini', pts: 2, color: '#cd7f32' },
            { label: 'Other models', pts: 3, color: '#888' },
          ].map(k => (
            <View key={k.label} style={styles.keyRow}>
              <Text style={styles.keyLabel}>{k.label}</Text>
              <Text style={[styles.keyPts, { color: k.color }]}>+{k.pts} XP</Text>
            </View>
          ))}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderColor: '#1a1a1a',
  },
  title: { color: '#eee', fontSize: 18, fontWeight: '900', fontFamily: 'monospace', letterSpacing: 3 },
  subtitle: { color: '#444', fontSize: 10, fontFamily: 'monospace', marginTop: 2, letterSpacing: 1 },
  closeBtn: { padding: 8 },
  closeText: { color: '#666', fontSize: 18 },
  pointsCard: {
    margin: 16,
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 14,
    padding: 20,
  },
  pointsRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 16 },
  pointsStat: { alignItems: 'center', flex: 1 },
  pointsValue: { color: '#00FF9C', fontSize: 22, fontWeight: '900', fontFamily: 'monospace' },
  pointsLabel: { color: '#555', fontSize: 8, fontFamily: 'monospace', letterSpacing: 1, marginTop: 4 },
  pointsDivider: { width: 1, backgroundColor: '#1a1a2e' },
  nextBadge: { gap: 8 },
  nextBadgeHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  nextBadgeLabel: { color: '#666', fontSize: 9, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 1 },
  nextBadgePoints: { fontSize: 9, fontFamily: 'monospace', fontWeight: '700' },
  latestCard: {
    marginHorizontal: 16,
    marginBottom: 16,
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 14,
    padding: 16,
  },
  latestLabel: { color: '#444', fontSize: 9, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 2, marginBottom: 12 },
  latestContent: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  latestInfo: { flex: 1 },
  latestName: { fontSize: 16, fontWeight: '900', fontFamily: 'monospace', marginBottom: 4 },
  latestDesc: { color: '#888', fontSize: 11, fontFamily: 'monospace', marginBottom: 6 },
  latestLore: { fontSize: 10, fontFamily: 'monospace', fontStyle: 'italic', lineHeight: 15 },
  tierFilter: { paddingHorizontal: 16, marginBottom: 12, flexGrow: 0 },
  tierBtn: {
    paddingHorizontal: 12, paddingVertical: 6,
    borderRadius: 6, borderWidth: 1, borderColor: '#1a1a2e',
    marginRight: 8,
  },
  tierBtnActive: { backgroundColor: '#6366f120', borderColor: '#6366f160' },
  tierBtnText: { color: '#555', fontSize: 10, fontWeight: '700', fontFamily: 'monospace' },
  tierBtnTextActive: { color: '#6366f1' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    gap: 8,
  },
  badgeCell: {
    width: '22%' as any,
    minWidth: 72,
    flex: 1,
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 10,
    gap: 4,
    position: 'relative',
  },
  badgeCellLocked: { opacity: 0.45 },
  badgeCellName: { fontSize: 8, fontWeight: '700', fontFamily: 'monospace', textAlign: 'center' },
  badgeCellPoints: { fontSize: 7, fontFamily: 'monospace', textAlign: 'center' },
  earnedDot: {
    position: 'absolute',
    top: 4, right: 4,
    width: 6, height: 6,
    borderRadius: 3,
  },
  keyCard: {
    margin: 16,
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: 14,
    padding: 16,
  },
  keyTitle: { color: '#444', fontSize: 9, fontFamily: 'monospace', fontWeight: '800', letterSpacing: 2, marginBottom: 12 },
  keyRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderColor: '#1a1a1a' },
  keyLabel: { color: '#888', fontSize: 11, fontFamily: 'monospace' },
  keyPts: { fontSize: 11, fontWeight: '800', fontFamily: 'monospace' },
});
