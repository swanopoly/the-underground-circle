import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Animated, Easing } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { TRACKS, getTotalLessons, getTotalXP, Track } from '../../lib/schoolsData';
import { getProgress, getTrackProgress, SchoolsProgress } from '../../lib/schoolsProgress';

// ─── Design Tokens ────────────────────────────────────────────────────────
const BG_PAGE = '#050508', BG_SURFACE = '#0a0a10', BG_RAISED = '#0f0f18', BG_INPUT = '#1a1a28';
const AMBER = '#f59e0b', AMBER_DIM = '#b47a08', AMBER_GLOW = 'rgba(245,158,11,0.08)', AMBER_BORDER = 'rgba(245,158,11,0.25)';
const GREEN = '#22c55e';
const TEXT_PRI = '#f0f0f5', TEXT_SEC = '#a0a0b0', TEXT_TER = '#606075', TEXT_DIS = '#3a3a4e';
const BORDER_DEF = '#1a1a28', BORDER_HOV = '#2a2a3e';
const R_CARD = 14, R_BTN = 10, R_PILL = 100;

// ─── Track Card ───────────────────────────────────────────────────────────
function TrackCard({ track, index, progress, onPress }: {
  track: Track;
  index: number;
  progress: SchoolsProgress;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;

  const totalLessons = getTotalLessons(track);
  const totalXP = getTotalXP(track);
  const trackProgress = getTrackProgress(progress, track.id, totalLessons);
  const progressPercent = Math.round(trackProgress * 100);
  const hasStarted = progressPercent > 0;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
        Animated.timing(slideAnim, { toValue: 0, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
      ]).start();
    }, 400 + index * 80);
    return () => clearTimeout(t);
  }, [index, fadeAnim, slideAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={`${track.title} track, ${progressPercent}% complete`}
        style={[s.trackCard, hovered && s.trackCardHover]}
      >
        <View style={[s.trackAccent, { backgroundColor: track.color }]} />
        <View style={s.trackInner}>
          {/* Icon + Title */}
          <View style={s.trackHeader}>
            <View style={[s.trackIconBox, { backgroundColor: track.color + '15' }]}>
              <Text style={[s.trackIconText, { color: track.color }]}>{track.icon}</Text>
            </View>
            <View style={s.trackTitleWrap}>
              <Text style={s.trackTitle}>{track.title}</Text>
              <Text style={s.trackSubtitle}>{track.subtitle}</Text>
            </View>
          </View>

          {/* Stats Row */}
          <View style={s.trackStatsRow}>
            <View style={s.trackStat}>
              <Text style={s.trackStatValue}>{track.modules.length}</Text>
              <Text style={s.trackStatLabel}>Modules</Text>
            </View>
            <View style={s.trackStatDivider} />
            <View style={s.trackStat}>
              <Text style={s.trackStatValue}>{totalLessons}</Text>
              <Text style={s.trackStatLabel}>Lessons</Text>
            </View>
            <View style={s.trackStatDivider} />
            <View style={s.trackStat}>
              <Text style={s.trackStatValue}>{totalXP.toLocaleString()}</Text>
              <Text style={s.trackStatLabel}>XP</Text>
            </View>
          </View>

          {/* Progress Bar */}
          <View style={s.trackProgressBarBg}>
            <View style={[s.trackProgressBarFill, { width: `${progressPercent}%`, backgroundColor: track.color }]} />
          </View>

          {/* Action text */}
          <Text style={[s.trackActionText, { color: track.color }]}>
            {hasStarted ? 'Continue' : 'Start Learning'} {' ->'}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Wiki Link Card ──────────────────────────────────────────────────────
const CYAN = '#06b6d4';

function WikiLinkCard({ onPress }: { onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }).start();
    }, 700);
    return () => clearTimeout(t);
  }, [fadeAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim, maxWidth: 720, width: '100%', alignSelf: 'center', marginTop: 20 }} nativeID="section-schools-wiki-link">
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel="Browse AI Wiki"
        style={[s.wikiCard, hovered && s.wikiCardHover]}
      >
        <View style={s.wikiAccent} />
        <View style={s.wikiInner}>
          <View style={s.wikiIconBox}>
            <Text style={s.wikiIconText}>{'W'}</Text>
          </View>
          <View style={s.wikiTitleWrap}>
            <Text style={s.wikiTitle}>AI Wiki</Text>
            <Text style={s.wikiSubtitle}>Deep dive into AI agents, models, and tools</Text>
          </View>
          <Text style={s.wikiArrow}>{'-->'}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────
export default function SchoolsScreen({ navigation }: any) {
  const [progress, setProgress] = useState<SchoolsProgress>({
    lessons: {},
    totalXpEarned: 0,
    lessonsCompleted: 0,
    currentStreak: 0,
  });

  const headerAnim = useRef(new Animated.Value(0)).current;
  const overviewAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(useCallback(() => {
    getProgress().then(setProgress);
  }, []));

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, delay: 150, useNativeDriver: false }).start();
    Animated.timing(overviewAnim, { toValue: 1, duration: 500, delay: 280, useNativeDriver: false }).start();
  }, [headerAnim, overviewAnim]);

  const totalLessonsAll = TRACKS.reduce((sum, t) => sum + getTotalLessons(t), 0);
  const totalProgressPercent = totalLessonsAll > 0
    ? Math.round((progress.lessonsCompleted / totalLessonsAll) * 100)
    : 0;

  return (
    <View style={s.page} nativeID="section-schools-hub">
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── SECTION: Header ── */}
        <Animated.View style={[s.header, { opacity: headerAnim }]} nativeID="section-schools-header">
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={s.backText}>{'<-'} Back</Text>
          </Pressable>
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text style={s.headerSubtitle}>Learn</Text>
            <Text style={s.headerTitle}>Schools</Text>
          </View>
          <View style={s.progressPill}>
            <Text style={s.progressPillText}>{totalProgressPercent}% Complete</Text>
          </View>
        </Animated.View>

        {/* ── SECTION: Progress Overview ── */}
        <Animated.View style={[s.overviewCard, { opacity: overviewAnim }]} nativeID="section-schools-overview">
          <View style={s.overviewStatRow}>
            <View style={s.overviewStat}>
              <Text style={[s.overviewStatValue, { color: GREEN }]}>{progress.lessonsCompleted}</Text>
              <Text style={s.overviewStatLabel}>Lessons Completed</Text>
            </View>
            <View style={s.overviewStatDivider} />
            <View style={s.overviewStat}>
              <Text style={[s.overviewStatValue, { color: AMBER }]}>{progress.totalXpEarned.toLocaleString()}</Text>
              <Text style={s.overviewStatLabel}>XP Earned</Text>
            </View>
            <View style={s.overviewStatDivider} />
            <View style={s.overviewStat}>
              <Text style={[s.overviewStatValue, { color: '#a855f7' }]}>{progress.currentStreak}</Text>
              <Text style={s.overviewStatLabel}>Day Streak</Text>
            </View>
          </View>
        </Animated.View>

        {/* ── SECTION: Track Cards ── */}
        <View nativeID="section-schools-tracks" style={s.tracksContainer}>
          {TRACKS.map((track, index) => (
            <TrackCard
              key={track.id}
              track={track}
              index={index}
              progress={progress}
              onPress={() => navigation.navigate('SchoolsTrack', { trackId: track.id })}
            />
          ))}
        </View>

        {/* ── SECTION: Wiki Link ── */}
        <WikiLinkCard onPress={() => navigation.navigate('Wiki')} />

        {/* ── SECTION: Footer ── */}
        <View style={s.footer} nativeID="section-schools-footer">
          <Text style={s.footerText}>Powered by The Underground Circle</Text>
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
    flexDirection: 'row', alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 24,
  },
  backText: { fontSize: 13, fontWeight: '500', color: AMBER },
  headerSubtitle: { fontSize: 13, fontWeight: '500', color: TEXT_TER, marginBottom: 2 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.5 },
  progressPill: {
    backgroundColor: AMBER_GLOW, paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: R_PILL, borderWidth: 1, borderColor: AMBER_BORDER,
  },
  progressPillText: { fontSize: 11, fontWeight: '600', color: AMBER, letterSpacing: 0.3 },

  // Overview Card
  overviewCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    padding: 20, maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 28,
  },
  overviewStatRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  overviewStat: { alignItems: 'center', flex: 1 },
  overviewStatValue: { fontSize: 22, fontWeight: '700', marginBottom: 4 },
  overviewStatLabel: { fontSize: 11, fontWeight: '500', color: TEXT_TER, textAlign: 'center' },
  overviewStatDivider: { width: 1, height: 32, backgroundColor: BORDER_DEF },

  // Tracks
  tracksContainer: { maxWidth: 720, width: '100%', alignSelf: 'center', gap: 14 },

  // Track Card
  trackCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative',
    ...(Platform.OS === 'web' ? { transition: 'all 220ms cubic-bezier(0.25,0.46,0.45,0.94)', cursor: 'pointer' } as any : {}),
  },
  trackCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -1 }], boxShadow: '0 4px 20px -4px rgba(0,0,0,0.4)' } as any : {}),
  },
  trackAccent: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
    borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD,
  },
  trackInner: { padding: 20, paddingLeft: 22 },
  trackHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 16 },
  trackIconBox: {
    width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center',
  },
  trackIconText: { fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  trackTitleWrap: { flex: 1 },
  trackTitle: { fontSize: 17, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.2, marginBottom: 3 },
  trackSubtitle: { fontSize: 13, fontWeight: '400', color: TEXT_SEC, lineHeight: 18 },

  // Track Stats
  trackStatsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    backgroundColor: BG_PAGE, borderRadius: 8, padding: 12, marginBottom: 14,
  },
  trackStat: { alignItems: 'center', flex: 1 },
  trackStatValue: { fontSize: 15, fontWeight: '600', color: TEXT_PRI, marginBottom: 2 },
  trackStatLabel: { fontSize: 10, fontWeight: '500', color: TEXT_TER },
  trackStatDivider: { width: 1, height: 24, backgroundColor: BORDER_DEF },

  // Progress Bar
  trackProgressBarBg: {
    height: 6, backgroundColor: BG_INPUT, borderRadius: 3, overflow: 'hidden', marginBottom: 12,
  },
  trackProgressBarFill: { height: 6, borderRadius: 3, minWidth: 0 },

  // Action Text
  trackActionText: { fontSize: 13, fontWeight: '600', letterSpacing: -0.2 },

  // Wiki Link Card
  wikiCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative' as const,
    ...(Platform.OS === 'web' ? { transition: 'all 220ms cubic-bezier(0.25,0.46,0.45,0.94)', cursor: 'pointer' } as any : {}),
  },
  wikiCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -1 }], boxShadow: '0 4px 20px -4px rgba(0,0,0,0.4)' } as any : {}),
  },
  wikiAccent: {
    position: 'absolute' as const, left: 0, top: 0, bottom: 0, width: 3,
    borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD,
    backgroundColor: CYAN,
  },
  wikiInner: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, padding: 18, paddingLeft: 20 },
  wikiIconBox: {
    width: 40, height: 40, borderRadius: 10, justifyContent: 'center' as const, alignItems: 'center' as const,
    backgroundColor: CYAN + '15',
  },
  wikiIconText: { fontSize: 14, fontWeight: '700' as const, color: CYAN },
  wikiTitleWrap: { flex: 1 },
  wikiTitle: { fontSize: 16, fontWeight: '600' as const, color: TEXT_PRI, letterSpacing: -0.2, marginBottom: 2 },
  wikiSubtitle: { fontSize: 13, fontWeight: '400' as const, color: TEXT_SEC },
  wikiArrow: { fontSize: 14, fontWeight: '700' as const, color: CYAN },

  // Footer
  footer: { marginTop: 32, alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center' },
  footerText: { fontSize: 12, fontWeight: '400', color: TEXT_DIS },
});
