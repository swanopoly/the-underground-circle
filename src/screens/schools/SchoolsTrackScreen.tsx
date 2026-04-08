import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Animated, Easing } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTrack, getTotalLessons, Track, Module } from '../../lib/schoolsData';
import { getProgress, getTrackProgress, getModuleProgress, getModuleCompletedCount, SchoolsProgress } from '../../lib/schoolsProgress';

// ─── Design Tokens ────────────────────────────────────────────────────────
const BG_PAGE = '#050508', BG_SURFACE = '#0a0a10', BG_RAISED = '#0f0f18', BG_INPUT = '#1a1a28';
const AMBER = '#f59e0b', AMBER_GLOW = 'rgba(245,158,11,0.08)', AMBER_BORDER = 'rgba(245,158,11,0.25)';
const GREEN = '#22c55e';
const TEXT_PRI = '#f0f0f5', TEXT_SEC = '#a0a0b0', TEXT_TER = '#606075', TEXT_DIS = '#3a3a4e';
const BORDER_DEF = '#1a1a28', BORDER_HOV = '#2a2a3e';
const R_CARD = 14, R_BTN = 10, R_PILL = 100;

const DIFFICULTY_COLORS: Record<string, string> = {
  beginner: GREEN,
  intermediate: AMBER,
  advanced: '#ef4444',
};

// ─── Module Card ──────────────────────────────────────────────────────────
function ModuleCard({ module, index, trackId, progress, isLocked, onPress }: {
  module: Module;
  index: number;
  trackId: string;
  progress: SchoolsProgress;
  isLocked: boolean;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;

  const lessonCount = module.lessons.length;
  const completedCount = getModuleCompletedCount(progress, trackId, module.id);
  const modProgress = getModuleProgress(progress, trackId, module.id, lessonCount);
  const progressPercent = Math.round(modProgress * 100);
  const diffColor = DIFFICULTY_COLORS[module.difficulty] || TEXT_TER;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
        Animated.timing(slideAnim, { toValue: 0, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
      ]).start();
    }, 300 + index * 70);
    return () => clearTimeout(t);
  }, [index, fadeAnim, slideAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={`${module.title} module, ${completedCount} of ${lessonCount} lessons completed${isLocked ? ', locked' : ''}`}
        style={[s.moduleCard, hovered && s.moduleCardHover]}
      >
        <View style={[s.moduleAccent, { backgroundColor: module.color }]} />
        <View style={s.moduleInner}>
          {/* Top row: icon + title + difficulty */}
          <View style={s.moduleTopRow}>
            <View style={[s.moduleIconBox, { backgroundColor: module.color + '15' }]}>
              <Text style={[s.moduleIconText, { color: module.color }]}>{module.icon}</Text>
            </View>
            <View style={s.moduleTitleWrap}>
              <Text style={s.moduleTitle}>{module.title}</Text>
              <Text style={s.moduleSubtitle}>{module.subtitle}</Text>
            </View>
            <View style={[s.difficultyPill, { backgroundColor: diffColor + '15', borderColor: diffColor + '30' }]}>
              <Text style={[s.difficultyText, { color: diffColor }]}>
                {module.difficulty.charAt(0).toUpperCase() + module.difficulty.slice(1)}
              </Text>
            </View>
          </View>

          {/* Progress row */}
          <View style={s.moduleProgressRow}>
            <Text style={s.moduleProgressText}>{completedCount}/{lessonCount} lessons</Text>
            <View style={s.moduleProgressBarBg}>
              <View style={[s.moduleProgressBarFill, { width: `${progressPercent}%`, backgroundColor: module.color }]} />
            </View>
          </View>

          {/* Lock overlay */}
          {isLocked && (
            <View style={s.lockOverlay} nativeID="section-module-lock-overlay">
              <Text style={s.lockIcon}>[!]</Text>
              <Text style={s.lockText}>Complete earlier modules to unlock</Text>
            </View>
          )}
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────
export default function SchoolsTrackScreen({ navigation, route }: any) {
  const { trackId } = route.params;
  const track = getTrack(trackId);
  const [progress, setProgress] = useState<SchoolsProgress>({
    lessons: {},
    totalXpEarned: 0,
    lessonsCompleted: 0,
    currentStreak: 0,
  });

  const headerAnim = useRef(new Animated.Value(0)).current;
  const descAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(useCallback(() => {
    getProgress().then(setProgress);
  }, []));

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, delay: 100, useNativeDriver: false }).start();
    Animated.timing(descAnim, { toValue: 1, duration: 500, delay: 220, useNativeDriver: false }).start();
  }, [headerAnim, descAnim]);

  if (!track) {
    return (
      <View style={s.page}>
        <View style={s.errorCenter}>
          <Text style={s.errorText}>Track not found</Text>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={s.backText}>{'<-'} Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const totalLessons = getTotalLessons(track);
  const trackProg = getTrackProgress(progress, trackId, totalLessons);
  const trackPercent = Math.round(trackProg * 100);

  // Compute how many modules have at least 1 completed lesson (for soft gate)
  const modulesWithCompletions = track.modules.filter((m, i) => {
    if (i >= 4) return false; // only count first 4
    return getModuleCompletedCount(progress, trackId, m.id) > 0;
  }).length;

  return (
    <View style={s.page} nativeID="section-schools-track">
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── SECTION: Header ── */}
        <Animated.View style={[s.header, { opacity: headerAnim }]} nativeID="section-track-header">
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={s.backText}>{'<-'} Back</Text>
          </Pressable>
          <View style={s.headerCenter}>
            <View style={[s.headerIconBox, { backgroundColor: track.color + '15' }]}>
              <Text style={[s.headerIconText, { color: track.color }]}>{track.icon}</Text>
            </View>
            <Text style={s.headerTitle}>{track.title}</Text>
          </View>
          <View style={[s.progressPill, { borderColor: track.color + '40', backgroundColor: track.color + '10' }]}>
            <Text style={[s.progressPillText, { color: track.color }]}>{trackPercent}%</Text>
          </View>
        </Animated.View>

        {/* ── SECTION: Description ── */}
        <Animated.View style={[s.descWrap, { opacity: descAnim }]} nativeID="section-track-description">
          <Text style={s.descText}>{track.description}</Text>
        </Animated.View>

        {/* ── SECTION: Module Cards ── */}
        <View nativeID="section-track-modules" style={s.modulesContainer}>
          {track.modules.map((module, index) => {
            const isLocked = index >= 4 && modulesWithCompletions < 2;
            return (
              <ModuleCard
                key={module.id}
                module={module}
                index={index}
                trackId={trackId}
                progress={progress}
                isLocked={isLocked}
                onPress={() => navigation.navigate('SchoolsModule', { trackId, moduleId: module.id })}
              />
            );
          })}
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 24 },

  // Error
  errorCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  errorText: { fontSize: 16, fontWeight: '500', color: TEXT_SEC },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 20,
  },
  backText: { fontSize: 13, fontWeight: '500', color: AMBER },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 16 },
  headerIconBox: {
    width: 32, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center',
  },
  headerIconText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.3 },
  progressPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R_PILL, borderWidth: 1,
  },
  progressPillText: { fontSize: 12, fontWeight: '600' },

  // Description
  descWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 24 },
  descText: { fontSize: 14, fontWeight: '400', color: TEXT_SEC, lineHeight: 22 },

  // Modules Container
  modulesContainer: { maxWidth: 720, width: '100%', alignSelf: 'center', gap: 12 },

  // Module Card
  moduleCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative',
    ...(Platform.OS === 'web' ? { transition: 'all 220ms cubic-bezier(0.25,0.46,0.45,0.94)', cursor: 'pointer' } as any : {}),
  },
  moduleCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -1 }], boxShadow: '0 4px 20px -4px rgba(0,0,0,0.4)' } as any : {}),
  },
  moduleAccent: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
    borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD,
  },
  moduleInner: { padding: 18, paddingLeft: 20 },
  moduleTopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  moduleIconBox: {
    width: 36, height: 36, borderRadius: 9, justifyContent: 'center', alignItems: 'center',
  },
  moduleIconText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  moduleTitleWrap: { flex: 1 },
  moduleTitle: { fontSize: 15, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.2, marginBottom: 2 },
  moduleSubtitle: { fontSize: 12, fontWeight: '400', color: TEXT_SEC },

  // Difficulty Pill
  difficultyPill: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: R_PILL, borderWidth: 1,
  },
  difficultyText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3 },

  // Module Progress
  moduleProgressRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  moduleProgressText: { fontSize: 12, fontWeight: '500', color: TEXT_TER, minWidth: 75 },
  moduleProgressBarBg: {
    flex: 1, height: 5, backgroundColor: BG_INPUT, borderRadius: 3, overflow: 'hidden',
  },
  moduleProgressBarFill: { height: 5, borderRadius: 3 },

  // Lock Overlay
  lockOverlay: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12,
    backgroundColor: BG_INPUT, borderRadius: 8, padding: 10,
  },
  lockIcon: { fontSize: 14, fontWeight: '700', color: AMBER },
  lockText: { fontSize: 12, fontWeight: '500', color: TEXT_TER },
});
