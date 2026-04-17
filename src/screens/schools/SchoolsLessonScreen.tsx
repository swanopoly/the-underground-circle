import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, Animated, Easing, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getTrack, getModule, getLesson, Lesson, LessonSection, QuizQuestion, LessonRef } from '../../lib/schoolsData';
import { getProgress, completeLesson, isLessonCompleted, getRecommendedNextLessonRef, SchoolsProgress } from '../../lib/schoolsProgress';
import { WikiArticle, getArticlesForLesson } from '../../lib/wikiData';

// ─── Design Tokens ────────────────────────────────────────────────────────
const BG_PAGE = '#050508', BG_SURFACE = '#0a0a10', BG_RAISED = '#0f0f18', BG_INPUT = '#1a1a28';
const AMBER = '#f59e0b', AMBER_GLOW = 'rgba(245,158,11,0.08)', AMBER_BORDER = 'rgba(245,158,11,0.25)';
const GREEN = '#22c55e', RED = '#ef4444';
const TEXT_PRI = '#f0f0f5', TEXT_SEC = '#a0a0b0', TEXT_TER = '#606075', TEXT_DIS = '#3a3a4e';
const BORDER_DEF = '#1a1a28', BORDER_HOV = '#2a2a3e';
const R_CARD = 14, R_BTN = 10, R_PILL = 100;

const SECTION_TYPE_COLORS: Record<string, string> = {
  learn: '#3b82f6',
  explore: '#22c55e',
  challenge: '#f59e0b',
  reflect: '#a855f7',
  connect: '#22d3ee',
};

// ─── Content Section Component ────────────────────────────────────────────
function ContentSection({ section, index }: { section: LessonSection; index: number }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(12)).current;
  const sectionColor = SECTION_TYPE_COLORS[section.type] || TEXT_TER;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 400, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
        Animated.timing(slideAnim, { toValue: 0, duration: 400, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
      ]).start();
    }, 200 + index * 60);
    return () => clearTimeout(t);
  }, [index, fadeAnim, slideAnim]);

  return (
    <Animated.View style={[s.sectionCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <View style={[s.sectionAccent, { backgroundColor: sectionColor }]} />
      <View style={s.sectionInner}>
        {/* Type label */}
        <Text style={[s.sectionTypeLabel, { color: sectionColor }]}>
          {section.type.toUpperCase()}
        </Text>

        {/* Title */}
        <Text style={s.sectionTitle}>{section.title}</Text>

        {/* Content */}
        <Text style={s.sectionContent}>{section.content}</Text>

        {/* Bullet points */}
        {section.bulletPoints && section.bulletPoints.length > 0 && (
          <View style={s.bulletList}>
            {section.bulletPoints.map((bullet, bi) => (
              <View key={bi} style={s.bulletRow}>
                <View style={[s.bulletDot, { backgroundColor: sectionColor }]} />
                <Text style={s.bulletText}>{bullet}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

// ─── Quiz Question Component ──────────────────────────────────────────────
function QuizQuestionCard({ question, qIndex, selectedAnswers, revealed, onSelectAnswer }: {
  question: QuizQuestion;
  qIndex: number;
  selectedAnswers: Record<string, number>;
  revealed: Record<string, boolean>;
  onSelectAnswer: (questionId: string, answerIndex: number) => void;
}) {
  const isRevealed = revealed[question.id] || false;
  const selected = selectedAnswers[question.id];

  return (
    <View style={s.quizCard} nativeID={`section-quiz-question-${qIndex}`}>
      <Text style={s.quizQuestionNumber}>Question {qIndex + 1}</Text>
      <Text style={s.quizQuestionText}>{question.question}</Text>

      <View style={s.quizOptionsContainer}>
        {question.options.map((option, oi) => {
          const isSelected = selected === oi;
          const isCorrect = oi === question.correctIndex;
          let optionStyle = s.quizOption;
          let textStyle = s.quizOptionText;

          if (isRevealed) {
            if (isCorrect) {
              optionStyle = { ...StyleSheet.flatten(s.quizOption), ...StyleSheet.flatten(s.quizOptionCorrect) };
              textStyle = { ...StyleSheet.flatten(s.quizOptionText), ...StyleSheet.flatten(s.quizOptionTextCorrect) };
            } else if (isSelected && !isCorrect) {
              optionStyle = { ...StyleSheet.flatten(s.quizOption), ...StyleSheet.flatten(s.quizOptionIncorrect) };
              textStyle = { ...StyleSheet.flatten(s.quizOptionText), ...StyleSheet.flatten(s.quizOptionTextIncorrect) };
            }
          } else if (isSelected) {
            optionStyle = { ...StyleSheet.flatten(s.quizOption), ...StyleSheet.flatten(s.quizOptionSelected) };
          }

          return (
            <Pressable
              key={oi}
              onPress={() => !isRevealed && onSelectAnswer(question.id, oi)}
              accessibilityRole="button"
              accessibilityLabel={`Option ${oi + 1}: ${option}`}
              style={optionStyle}
              disabled={isRevealed}
            >
              <View style={s.quizOptionRow}>
                <View style={[
                  s.quizOptionLetter,
                  isRevealed && isCorrect && s.quizOptionLetterCorrect,
                  isRevealed && isSelected && !isCorrect && s.quizOptionLetterIncorrect,
                ]}>
                  <Text style={[
                    s.quizOptionLetterText,
                    isRevealed && isCorrect && { color: GREEN },
                    isRevealed && isSelected && !isCorrect && { color: RED },
                  ]}>
                    {String.fromCharCode(65 + oi)}
                  </Text>
                </View>
                <Text style={textStyle}>{option}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Explanation */}
      {isRevealed && question.explanation && (
        <View style={s.quizExplanation}>
          <Text style={s.quizExplanationLabel}>Explanation</Text>
          <Text style={s.quizExplanationText}>{question.explanation}</Text>
        </View>
      )}
    </View>
  );
}

function RelatedWikiCard({ article, onPress }: {
  article: WikiArticle;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open wiki article ${article.title}`}
      style={s.relatedWikiCard}
    >
      <View style={[s.relatedWikiAccent, { backgroundColor: article.color }]} />
      <View style={s.relatedWikiInner}>
        <View style={[s.relatedWikiIconBox, { backgroundColor: article.color + '15' }]}>
          <Text style={[s.relatedWikiIconText, { color: article.color }]}>{article.icon}</Text>
        </View>
        <View style={s.relatedWikiTextWrap}>
          <Text style={s.relatedWikiLabel}>WIKI DEEP DIVE</Text>
          <Text style={s.relatedWikiTitle}>{article.title}</Text>
          <Text style={s.relatedWikiSubtitle}>{article.subtitle}</Text>
        </View>
        <Text style={[s.relatedWikiArrow, { color: article.color }]}>{'-->'}</Text>
      </View>
    </Pressable>
  );
}

function NextStepCard({ nextLesson, onOpenLesson }: {
  nextLesson: LessonRef;
  onOpenLesson: () => void;
}) {
  return (
    <Pressable
      onPress={onOpenLesson}
      accessibilityRole="button"
      accessibilityLabel={`Open next lesson ${nextLesson.lessonTitle}`}
      style={s.nextStepCard}
    >
      <View style={s.nextStepAccent} />
      <View style={s.nextStepInner}>
        <View style={s.nextStepTextWrap}>
          <Text style={s.nextStepLabel}>NEXT STEP</Text>
          <Text style={s.nextStepTitle}>{nextLesson.lessonTitle}</Text>
          <Text style={s.nextStepSubtitle}>{nextLesson.moduleTitle}</Text>
        </View>
        <Text style={s.nextStepArrow}>{'-->'}</Text>
      </View>
    </Pressable>
  );
}

// ─── Main Screen ───────────────────────────────────────────────────────────
export default function SchoolsLessonScreen({ navigation, route }: any) {
  const { trackId, moduleId, lessonId } = route.params;
  const track = getTrack(trackId);
  const module = getModule(trackId, moduleId);
  const lesson = getLesson(trackId, moduleId, lessonId);
  const relatedWikiArticles = getArticlesForLesson(trackId, moduleId, lessonId);

  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, number>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [completed, setCompleted] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [progress, setProgress] = useState<SchoolsProgress>({
    lessons: {},
    totalXpEarned: 0,
    lessonsCompleted: 0,
    currentStreak: 0,
  });

  const headerAnim = useRef(new Animated.Value(0)).current;
  const contentHeight = useRef(0);
  const scrollViewHeight = useRef(0);
  const nextLesson = getRecommendedNextLessonRef(progress, trackId, moduleId, lessonId);

  useFocusEffect(useCallback(() => {
    getProgress().then((p) => {
      setProgress(p);
      if (lesson) {
        setCompleted(isLessonCompleted(p, trackId, moduleId, lessonId));
      }
    });
  }, [trackId, moduleId, lessonId, lesson]));

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, delay: 100, useNativeDriver: false }).start();
  }, [headerAnim]);

  if (!track || !module || !lesson) {
    return (
      <View style={s.page}>
        <View style={s.errorCenter}>
          <Text style={s.errorText}>Lesson not found</Text>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={s.backText}>{'<-'} Go Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const quizQuestions = lesson.quiz || [];
  const totalQuestions = quizQuestions.length;

  // Calculate quiz score
  const answeredCount = Object.keys(revealed).length;
  const correctCount = quizQuestions.filter(q => selectedAnswers[q.id] === q.correctIndex).length;
  const allQuizAnswered = answeredCount === totalQuestions && totalQuestions > 0;
  const quizScorePercent = totalQuestions > 0 ? Math.round((correctCount / totalQuestions) * 100) : 100;

  const handleSelectAnswer = (questionId: string, answerIndex: number) => {
    setSelectedAnswers(prev => ({ ...prev, [questionId]: answerIndex }));
    setRevealed(prev => ({ ...prev, [questionId]: true }));
  };

  const handleComplete = async () => {
    const answerIndices = quizQuestions.map(q => selectedAnswers[q.id] ?? -1);
    const nextProgress = await completeLesson(trackId, moduleId, lessonId, quizScorePercent, answerIndices, lesson.xpReward);
    setProgress(nextProgress);
    setCompleted(true);
  };

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    const maxScroll = contentSize.height - layoutMeasurement.height;
    if (maxScroll > 0) {
      setScrollProgress(Math.min(1, contentOffset.y / maxScroll));
    }
  };

  return (
    <View style={s.page} nativeID="section-schools-lesson">

      {/* ── SECTION: Scroll Progress Bar ── */}
      <View style={s.scrollProgressBg} nativeID="section-lesson-progress-bar">
        <View style={[s.scrollProgressFill, { width: `${Math.round(scrollProgress * 100)}%` }]} />
      </View>

      {/* ── SECTION: Header ── */}
      <Animated.View style={[s.header, { opacity: headerAnim }]} nativeID="section-lesson-header">
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={s.backText}>{'<-'} Back</Text>
        </Pressable>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle} numberOfLines={1}>{lesson.title}</Text>
        </View>
        <View style={s.headerRight}>
          <View style={[s.xpBadge]}>
            <Text style={s.xpBadgeText}>+{lesson.xpReward} XP</Text>
          </View>
          <Text style={s.durationText}>{lesson.durationMinutes} min</Text>
        </View>
      </Animated.View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      >

        {/* ── SECTION: Content Sections ── */}
        <View nativeID="section-lesson-content" style={s.contentContainer}>
          {lesson.sections.map((section, index) => (
            <ContentSection key={index} section={section} index={index} />
          ))}
        </View>

        {relatedWikiArticles.length > 0 && (
          <View nativeID="section-lesson-related-wiki" style={s.relatedWikiWrap}>
            <View style={s.relatedWikiHeader}>
              <Text style={s.relatedWikiHeaderLabel}>Go Deeper</Text>
              <Text style={s.relatedWikiHeaderTitle}>Related Wiki Articles</Text>
              <Text style={s.relatedWikiHeaderSubtitle}>
                Keep moving from lessons into reference material and project patterns.
              </Text>
            </View>
            {relatedWikiArticles.map(article => (
              <RelatedWikiCard
                key={article.id}
                article={article}
                onPress={() => navigation.navigate('WikiArticle', { articleId: article.id })}
              />
            ))}
          </View>
        )}

        {/* ── SECTION: Quiz ── */}
        {quizQuestions.length > 0 && (
          <View nativeID="section-lesson-quiz" style={s.quizContainer}>
            <View style={s.quizHeader}>
              <Text style={s.quizHeaderTitle}>Check Your Understanding</Text>
              <Text style={s.quizHeaderSubtitle}>{totalQuestions} question{totalQuestions !== 1 ? 's' : ''}</Text>
            </View>

            {quizQuestions.map((q, qi) => (
              <QuizQuestionCard
                key={q.id}
                question={q}
                qIndex={qi}
                selectedAnswers={selectedAnswers}
                revealed={revealed}
                onSelectAnswer={handleSelectAnswer}
              />
            ))}

            {/* Quiz Score Summary */}
            {allQuizAnswered && (
              <View style={s.quizSummary} nativeID="section-lesson-quiz-summary">
                <Text style={s.quizSummaryText}>
                  {correctCount}/{totalQuestions} correct ({quizScorePercent}%)
                </Text>
              </View>
            )}
          </View>
        )}

        {/* ── SECTION: Complete Button ── */}
        <View nativeID="section-lesson-complete" style={s.completeContainer}>
          {completed ? (
            <View style={s.completedStack}>
              <View style={s.completedBanner}>
                <Text style={s.completedBannerIcon}>[/]</Text>
                <Text style={s.completedBannerText}>Lesson Completed</Text>
              </View>
              {nextLesson && (
                <NextStepCard
                  nextLesson={nextLesson}
                  onOpenLesson={() => navigation.replace('SchoolsLesson', {
                    trackId: nextLesson.trackId,
                    moduleId: nextLesson.moduleId,
                    lessonId: nextLesson.lessonId,
                  })}
                />
              )}
            </View>
          ) : (
            <Pressable
              onPress={handleComplete}
              accessibilityRole="button"
              accessibilityLabel={`Complete lesson and earn ${lesson.xpReward} XP`}
              disabled={totalQuestions > 0 && !allQuizAnswered}
              style={[
                s.completeBtn,
                (totalQuestions > 0 && !allQuizAnswered) && s.completeBtnDisabled,
              ]}
            >
              <Text style={[
                s.completeBtnText,
                (totalQuestions > 0 && !allQuizAnswered) && s.completeBtnTextDisabled,
              ]}>
                Complete Lesson (+{lesson.xpReward} XP)
              </Text>
            </Pressable>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { paddingBottom: 48, paddingHorizontal: 24 },

  // Error
  errorCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  errorText: { fontSize: 16, fontWeight: '500', color: TEXT_SEC },

  // Scroll Progress
  scrollProgressBg: { height: 3, backgroundColor: BG_INPUT, width: '100%' },
  scrollProgressFill: { height: 3, backgroundColor: AMBER },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center',
    paddingHorizontal: 24, paddingTop: 16, paddingBottom: 14,
  },
  backText: { fontSize: 13, fontWeight: '500', color: AMBER },
  headerCenter: { flex: 1, marginLeft: 14 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  xpBadge: {
    backgroundColor: AMBER_GLOW, paddingHorizontal: 10, paddingVertical: 3,
    borderRadius: R_PILL, borderWidth: 1, borderColor: AMBER_BORDER,
  },
  xpBadgeText: { fontSize: 11, fontWeight: '600', color: AMBER },
  durationText: { fontSize: 12, fontWeight: '500', color: TEXT_TER },

  // Content
  contentContainer: { maxWidth: 720, width: '100%', alignSelf: 'center', gap: 14, marginTop: 8 },
  relatedWikiWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginTop: 28, gap: 12 },
  relatedWikiHeader: { marginBottom: 4 },
  relatedWikiHeaderLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2, color: AMBER, marginBottom: 6,
  },
  relatedWikiHeaderTitle: {
    fontSize: 20, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.3, marginBottom: 4,
  },
  relatedWikiHeaderSubtitle: { fontSize: 13, fontWeight: '400', color: TEXT_TER, lineHeight: 20 },
  relatedWikiCard: {
    backgroundColor: BG_SURFACE,
    borderWidth: 1,
    borderColor: BORDER_DEF,
    borderRadius: R_CARD,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  relatedWikiAccent: { height: 3, width: '100%' },
  relatedWikiInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  relatedWikiIconBox: {
    width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center',
  },
  relatedWikiIconText: { fontSize: 16, fontWeight: '700', color: TEXT_PRI },
  relatedWikiTextWrap: { flex: 1 },
  relatedWikiLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1, color: TEXT_TER, marginBottom: 4 },
  relatedWikiTitle: { fontSize: 15, fontWeight: '600', color: TEXT_PRI, marginBottom: 3 },
  relatedWikiSubtitle: { fontSize: 13, fontWeight: '400', color: TEXT_SEC, lineHeight: 19 },
  relatedWikiArrow: { fontSize: 14, fontWeight: '700' },

  // Section Card
  sectionCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative',
  },
  sectionAccent: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
    borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD,
  },
  sectionInner: { padding: 18, paddingLeft: 20 },
  sectionTypeLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 16, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.2, marginBottom: 8,
  },
  sectionContent: {
    fontSize: 14, fontWeight: '400', color: TEXT_SEC, lineHeight: 22,
  },

  // Bullet points
  bulletList: { marginTop: 12, gap: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7 },
  bulletText: { flex: 1, fontSize: 13, fontWeight: '400', color: TEXT_SEC, lineHeight: 20 },

  // Quiz Container
  quizContainer: { maxWidth: 720, width: '100%', alignSelf: 'center', marginTop: 32 },
  quizHeader: { marginBottom: 18 },
  quizHeaderTitle: { fontSize: 20, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.3, marginBottom: 4 },
  quizHeaderSubtitle: { fontSize: 13, fontWeight: '400', color: TEXT_TER },

  // Quiz Card
  quizCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    padding: 20, marginBottom: 14,
  },
  quizQuestionNumber: {
    fontSize: 10, fontWeight: '600', color: TEXT_TER, letterSpacing: 0.5,
    textTransform: 'uppercase', marginBottom: 8,
  },
  quizQuestionText: {
    fontSize: 15, fontWeight: '500', color: TEXT_PRI, lineHeight: 22, marginBottom: 16,
  },

  // Quiz Options
  quizOptionsContainer: { gap: 8 },
  quizOption: {
    backgroundColor: BG_INPUT, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_BTN,
    padding: 14,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 150ms ease' } as any : {}),
  },
  quizOptionSelected: {
    borderColor: AMBER_BORDER, backgroundColor: AMBER_GLOW,
  },
  quizOptionCorrect: {
    borderColor: GREEN + '50', backgroundColor: GREEN + '10',
  },
  quizOptionIncorrect: {
    borderColor: RED + '50', backgroundColor: RED + '10',
  },
  quizOptionRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  quizOptionLetter: {
    width: 26, height: 26, borderRadius: 13, backgroundColor: BG_PAGE,
    justifyContent: 'center', alignItems: 'center',
  },
  quizOptionLetterCorrect: { backgroundColor: GREEN + '20' },
  quizOptionLetterIncorrect: { backgroundColor: RED + '20' },
  quizOptionLetterText: { fontSize: 12, fontWeight: '600', color: TEXT_TER },
  quizOptionText: { flex: 1, fontSize: 14, fontWeight: '400', color: TEXT_SEC },
  quizOptionTextCorrect: { color: GREEN },
  quizOptionTextIncorrect: { color: RED },

  // Quiz Explanation
  quizExplanation: {
    marginTop: 14, backgroundColor: BG_INPUT, borderRadius: 8, padding: 14,
  },
  quizExplanationLabel: {
    fontSize: 10, fontWeight: '600', color: TEXT_TER, letterSpacing: 0.5,
    textTransform: 'uppercase', marginBottom: 6,
  },
  quizExplanationText: { fontSize: 13, fontWeight: '400', color: TEXT_SEC, lineHeight: 20 },

  // Quiz Summary
  quizSummary: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    padding: 16, alignItems: 'center',
  },
  quizSummaryText: { fontSize: 15, fontWeight: '600', color: TEXT_PRI },

  // Complete Container
  completeContainer: { maxWidth: 720, width: '100%', alignSelf: 'center', marginTop: 28 },
  completedStack: { gap: 12 },
  completeBtn: {
    backgroundColor: AMBER, paddingVertical: 16, borderRadius: R_BTN, alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  completeBtnDisabled: {
    backgroundColor: BG_INPUT, borderWidth: 1, borderColor: BORDER_DEF,
    ...(Platform.OS === 'web' ? { cursor: 'not-allowed' } as any : {}),
  },
  completeBtnText: { fontSize: 15, fontWeight: '600', color: BG_PAGE },
  completeBtnTextDisabled: { color: TEXT_DIS },

  // Completed Banner
  completedBanner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    backgroundColor: GREEN + '08', borderWidth: 1, borderColor: GREEN + '25',
    borderRadius: R_BTN, paddingVertical: 14,
  },
  completedBannerIcon: { fontSize: 16, fontWeight: '700', color: GREEN },
  completedBannerText: { fontSize: 14, fontWeight: '500', color: TEXT_TER },
  nextStepCard: {
    backgroundColor: BG_SURFACE,
    borderWidth: 1,
    borderColor: AMBER_BORDER,
    borderRadius: R_CARD,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  nextStepAccent: { height: 3, backgroundColor: AMBER, width: '100%' },
  nextStepInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
  nextStepTextWrap: { flex: 1 },
  nextStepLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.1, color: AMBER, marginBottom: 4 },
  nextStepTitle: { fontSize: 15, fontWeight: '600', color: TEXT_PRI, marginBottom: 3 },
  nextStepSubtitle: { fontSize: 12, fontWeight: '400', color: TEXT_SEC },
  nextStepArrow: { fontSize: 14, fontWeight: '700', color: AMBER },
});
