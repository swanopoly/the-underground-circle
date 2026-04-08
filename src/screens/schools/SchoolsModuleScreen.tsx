import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Animated, Easing } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTrack, getModule, Module, Lesson } from '../../lib/schoolsData';
import { getProgress, isLessonCompleted, getLessonProgress, getModuleCompletedCount, SchoolsProgress } from '../../lib/schoolsProgress';

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

// ─── Lesson Card ──────────────────────────────────────────────────────────
function LessonCard({ lesson, index, trackId, moduleId, moduleColor, progress, onPress }: {
  lesson: Lesson;
  index: number;
  trackId: string;
  moduleId: string;
  moduleColor: string;
  progress: SchoolsProgress;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;

  const completed = isLessonCompleted(progress, trackId, moduleId, lesson.id);
  const lessonProg = getLessonProgress(progress, trackId, moduleId, lesson.id);
  const quizScore = lessonProg?.quizScore;
  const lessonNumber = String(index + 1).padStart(2, '0');

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
        Animated.timing(slideAnim, { toValue: 0, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
      ]).start();
    }, 350 + index * 60);
    return () => clearTimeout(t);
  }, [index, fadeAnim, slideAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={`Lesson ${lessonNumber}: ${lesson.title}${completed ? ', completed' : ''}`}
        style={[s.lessonCard, hovered && s.lessonCardHover]}
      >
        <View style={s.lessonInner}>
          {/* Left: number */}
          <View style={[s.lessonNumberBox, { backgroundColor: completed ? GREEN + '15' : moduleColor + '10' }]}>
            {completed ? (
              <Text style={[s.lessonCheckmark, { color: GREEN }]}>[/]</Text>
            ) : (
              <Text style={[s.lessonNumber, { color: moduleColor }]}>{lessonNumber}</Text>
            )}
          </View>

          {/* Center: title + subtitle */}
          <View style={s.lessonContent}>
            <Text style={[s.lessonTitle, completed && s.lessonTitleCompleted]}>{lesson.title}</Text>
            <Text style={s.lessonSubtitle}>{lesson.subtitle}</Text>

            {/* Pills row */}
            <View style={s.lessonPillsRow}>
              <View style={s.lessonPill}>
                <Text style={s.lessonPillText}>{lesson.durationMinutes} min</Text>
              </View>
              <View style={[s.lessonPill, { backgroundColor: AMBER_GLOW, borderColor: AMBER_BORDER }]}>
                <Text style={[s.lessonPillText, { color: AMBER }]}>+{lesson.xpReward} XP</Text>
              </View>
              {completed && quizScore !== undefined && (
                <View style={[s.lessonPill, { backgroundColor: GREEN + '10', borderColor: GREEN + '30' }]}>
                  <Text style={[s.lessonPillText, { color: GREEN }]}>Quiz: {Math.round(quizScore)}%</Text>
                </View>
              )}
            </View>
          </View>

          {/* Right: chevron */}
          <Text style={s.lessonChevron}>{'>'}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────
export default function SchoolsModuleScreen({ navigation, route }: any) {
  const { trackId, moduleId } = route.params;
  const track = getTrack(trackId);
  const module = getModule(trackId, moduleId);
  const [progress, setProgress] = useState<SchoolsProgress>({
    lessons: {},
    totalXpEarned: 0,
    lessonsCompleted: 0,
    currentStreak: 0,
  });

  const headerAnim = useRef(new Animated.Value(0)).current;
  const infoAnim = useRef(new Animated.Value(0)).current;

  useFocusEffect(useCallback(() => {
    getProgress().then(setProgress);
  }, []));

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, delay: 100, useNativeDriver: false }).start();
    Animated.timing(infoAnim, { toValue: 1, duration: 500, delay: 240, useNativeDriver: false }).start();
  }, [headerAnim, infoAnim]);

  if (!track || !module) {
    return (
      <View style={s.page}>
        <View style={s.errorCenter}>
          <Text style={s.errorText}>Module not found</Text>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={s.backText}>{'<-'} Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const diffColor = DIFFICULTY_COLORS[module.difficulty] || TEXT_TER;
  const lessonCount = module.lessons.length;
  const completedCount = getModuleCompletedCount(progress, trackId, moduleId);
  const allComplete = completedCount === lessonCount && lessonCount > 0;
  const totalModuleXP = module.lessons.reduce((sum, l) => sum + l.xpReward, 0);

  return (
    <View style={s.page} nativeID="section-schools-module">
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── SECTION: Header ── */}
        <Animated.View style={[s.header, { opacity: headerAnim }]} nativeID="section-module-header">
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={s.backText}>{'<-'} Back</Text>
          </Pressable>
          <View style={s.headerCenter}>
            <Text style={[s.headerTitle, { color: module.color }]}>{module.title}</Text>
          </View>
          <View style={[s.diffBadge, { backgroundColor: diffColor + '15', borderColor: diffColor + '30' }]}>
            <Text style={[s.diffBadgeText, { color: diffColor }]}>
              {module.difficulty.charAt(0).toUpperCase() + module.difficulty.slice(1)}
            </Text>
          </View>
        </Animated.View>

        {/* ── SECTION: Module Info Card ── */}
        <Animated.View style={[s.infoCard, { opacity: infoAnim }]} nativeID="section-module-info">
          <Text style={s.infoDescription}>{module.description}</Text>
          <View style={s.infoMetaRow}>
            <View style={s.infoMetaItem}>
              <Text style={s.infoMetaLabel}>Age Range</Text>
              <Text style={s.infoMetaValue}>{module.ageRange}</Text>
            </View>
            <View style={s.infoMetaDivider} />
            <View style={s.infoMetaItem}>
              <Text style={s.infoMetaLabel}>Lessons</Text>
              <Text style={s.infoMetaValue}>{completedCount}/{lessonCount}</Text>
            </View>
            <View style={s.infoMetaDivider} />
            <View style={s.infoMetaItem}>
              <Text style={s.infoMetaLabel}>Badge</Text>
              <View style={[s.badgePill, { backgroundColor: module.color + '15', borderColor: module.color + '30' }]}>
                <Text style={[s.badgePillText, { color: module.color }]}>{module.badgeName}</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ── SECTION: Lesson List ── */}
        <View nativeID="section-module-lessons" style={s.lessonsContainer}>
          {module.lessons.map((lesson, index) => (
            <LessonCard
              key={lesson.id}
              lesson={lesson}
              index={index}
              trackId={trackId}
              moduleId={moduleId}
              moduleColor={module.color}
              progress={progress}
              onPress={() => navigation.navigate('SchoolsLesson', { trackId, moduleId, lessonId: lesson.id })}
            />
          ))}
        </View>

        {/* ── SECTION: Module Completion Card ── */}
        {allComplete && (
          <View style={s.completionCard} nativeID="section-module-complete">
            <Text style={s.completionIcon}>[*]</Text>
            <Text style={s.completionTitle}>Module Complete!</Text>
            <Text style={s.completionBadge}>Badge Earned: {module.badgeName}</Text>
            <Text style={s.completionXP}>+{totalModuleXP.toLocaleString()} XP Total</Text>
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

  // Error
  errorCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  errorText: { fontSize: 16, fontWeight: '500', color: TEXT_SEC },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 20,
  },
  backText: { fontSize: 13, fontWeight: '500', color: AMBER },
  headerCenter: { flex: 1, marginLeft: 16 },
  headerTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  diffBadge: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R_PILL, borderWidth: 1,
  },
  diffBadgeText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },

  // Info Card
  infoCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    padding: 20, maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 24,
  },
  infoDescription: {
    fontSize: 14, fontWeight: '400', color: TEXT_SEC, lineHeight: 22, marginBottom: 18,
  },
  infoMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' },
  infoMetaItem: { alignItems: 'center', flex: 1 },
  infoMetaLabel: { fontSize: 10, fontWeight: '500', color: TEXT_TER, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoMetaValue: { fontSize: 14, fontWeight: '600', color: TEXT_PRI },
  infoMetaDivider: { width: 1, height: 32, backgroundColor: BORDER_DEF },
  badgePill: {
    paddingHorizontal: 10, paddingVertical: 3, borderRadius: R_PILL, borderWidth: 1,
  },
  badgePillText: { fontSize: 11, fontWeight: '600' },

  // Lessons Container
  lessonsContainer: { maxWidth: 720, width: '100%', alignSelf: 'center', gap: 10 },

  // Lesson Card
  lessonCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { transition: 'all 180ms cubic-bezier(0.25,0.46,0.45,0.94)', cursor: 'pointer' } as any : {}),
  },
  lessonCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -1 }], boxShadow: '0 2px 12px -3px rgba(0,0,0,0.35)' } as any : {}),
  },
  lessonInner: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },

  // Lesson Number
  lessonNumberBox: {
    width: 40, height: 40, borderRadius: 10, justifyContent: 'center', alignItems: 'center',
  },
  lessonNumber: { fontSize: 14, fontWeight: '700' },
  lessonCheckmark: { fontSize: 14, fontWeight: '700' },

  // Lesson Content
  lessonContent: { flex: 1 },
  lessonTitle: { fontSize: 15, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.2, marginBottom: 2 },
  lessonTitleCompleted: { color: TEXT_SEC },
  lessonSubtitle: { fontSize: 12, fontWeight: '400', color: TEXT_TER, marginBottom: 8 },

  // Pills
  lessonPillsRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  lessonPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R_PILL,
    backgroundColor: BG_INPUT, borderWidth: 1, borderColor: BORDER_DEF,
  },
  lessonPillText: { fontSize: 10, fontWeight: '500', color: TEXT_SEC },

  // Chevron
  lessonChevron: { fontSize: 16, fontWeight: '500', color: TEXT_DIS },

  // Completion Card
  completionCard: {
    backgroundColor: GREEN + '08', borderWidth: 1, borderColor: GREEN + '30', borderRadius: R_CARD,
    padding: 24, alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center', marginTop: 20,
  },
  completionIcon: { fontSize: 28, fontWeight: '700', color: GREEN, marginBottom: 8 },
  completionTitle: { fontSize: 18, fontWeight: '700', color: GREEN, marginBottom: 6 },
  completionBadge: { fontSize: 14, fontWeight: '500', color: TEXT_SEC, marginBottom: 4 },
  completionXP: { fontSize: 13, fontWeight: '600', color: AMBER },
});
