import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  Platform, Animated, Easing,
} from 'react-native';
import { WikiArticle, WikiSection, WIKI_ARTICLES, getArticle, getRelatedArticles } from '../../lib/wikiData';
import { getLesson, getModule } from '../../lib/schoolsData';
import { getWikiProgress, markWikiArticleRead, WikiProgress } from '../../lib/wikiProgress';

// ── Design Tokens ─────────────────────────────────────────────────────────
const BG_PAGE = '#050508', BG_SURFACE = '#0a0a10', BG_RAISED = '#0f0f18';
const TEXT_PRI = '#f0f0f5', TEXT_SEC = '#a0a0b0', TEXT_TER = '#606075', TEXT_DIS = '#3a3a4e';
const BORDER_DEF = '#1a1a28', BORDER_HOV = '#2a2a3e';
const R_CARD = 14, R_BTN = 10, R_PILL = 100;

// ── Code Block ────────────────────────────────────────────────────────────
function CodeBlock({ code }: { code: string }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.codeScroll}>
      <View style={s.codeBlock}>
        <Text style={s.codeText}>{code}</Text>
      </View>
    </ScrollView>
  );
}

// ── Table ─────────────────────────────────────────────────────────────────
function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.tableScroll}>
      <View style={s.table}>
        {/* Header row */}
        <View style={s.tableHeaderRow}>
          {headers.map((h, i) => (
            <View key={i} style={[s.tableCell, s.tableHeaderCell, i === 0 && s.tableCellFirst]}>
              <Text style={s.tableHeaderText}>{h}</Text>
            </View>
          ))}
        </View>
        {/* Data rows */}
        {rows.map((row, ri) => (
          <View key={ri} style={[s.tableRow, ri % 2 === 1 && s.tableRowAlt]}>
            {row.map((cell, ci) => (
              <View key={ci} style={[s.tableCell, ci === 0 && s.tableCellFirst]}>
                <Text style={s.tableCellText}>{cell}</Text>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── Content Section ───────────────────────────────────────────────────────
function ContentSection({ section, color, index }: {
  section: WikiSection;
  color: string;
  index: number;
}) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(10)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
        Animated.timing(slideAnim, { toValue: 0, duration: 350, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false }),
      ]).start();
    }, 400 + index * 100);
    return () => clearTimeout(t);
  }, [index, fadeAnim, slideAnim]);

  return (
    <Animated.View style={[s.sectionCard, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}>
      <Text style={s.sectionTitle}>{section.title}</Text>
      <Text style={s.sectionContent}>{section.content}</Text>

      {section.bulletPoints && section.bulletPoints.length > 0 && (
        <View style={s.bulletList}>
          {section.bulletPoints.map((bp, i) => (
            <View key={i} style={s.bulletRow}>
              <View style={[s.bulletDot, { backgroundColor: color }]} />
              <Text style={s.bulletText}>{bp}</Text>
            </View>
          ))}
        </View>
      )}

      {section.codeExample && (
        <CodeBlock code={section.codeExample} />
      )}

      {section.tableData && (
        <DataTable headers={section.tableData.headers} rows={section.tableData.rows} />
      )}
    </Animated.View>
  );
}

// ── Related Article Card ──────────────────────────────────────────────────
function RelatedArticleCard({ article, onPress }: {
  article: WikiArticle;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      accessibilityRole="button"
      accessibilityLabel={`Related: ${article.title}`}
      style={[s.relCard, hovered && s.relCardHover]}
    >
      <View style={[s.relIconBox, { backgroundColor: article.color + '15' }]}>
        <Text style={[s.relIconText, { color: article.color }]}>{article.icon}</Text>
      </View>
      <View style={s.relInfo}>
        <Text style={s.relTitle} numberOfLines={1}>{article.title}</Text>
        <Text style={s.relSubtitle} numberOfLines={1}>{article.subtitle}</Text>
      </View>
      <Text style={[s.relArrow, { color: article.color }]}>{'-->'}</Text>
    </Pressable>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────
export default function WikiArticleScreen({ navigation, route }: any) {
  const { articleId } = route.params as { articleId: string };
  const article = getArticle(articleId);
  const relatedArticles = getRelatedArticles(articleId);
  const [wikiProgress, setWikiProgress] = useState<WikiProgress>({ readArticleIds: [] });

  const headerAnim = useRef(new Animated.Value(0)).current;
  const infoAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, delay: 100, useNativeDriver: false }).start();
    Animated.timing(infoAnim, { toValue: 1, duration: 400, delay: 250, useNativeDriver: false }).start();
  }, [headerAnim, infoAnim]);

  useEffect(() => {
    let mounted = true;
    if (!article) return;

    (async () => {
      const progress = await markWikiArticleRead(article.id);
      if (mounted) setWikiProgress(progress);
    })();

    return () => {
      mounted = false;
    };
  }, [article]);

  if (!article) {
    return (
      <View style={s.page}>
        <View style={s.notFound}>
          <Text style={s.notFoundText}>Article not found</Text>
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button">
            <Text style={s.notFoundBack}>{'<-'} Go back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const hasLessons = article.relatedLessonIds && article.relatedLessonIds.length > 0;
  const nextArticle =
    relatedArticles.find(item => !wikiProgress.readArticleIds.includes(item.id)) ||
    WIKI_ARTICLES.find(item =>
      item.id !== article.id &&
      !wikiProgress.readArticleIds.includes(item.id)
    );

  return (
    <View style={s.page} nativeID="section-wiki-article">
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── SECTION: Header ── */}
        <Animated.View style={[s.header, { opacity: headerAnim }]} nativeID="section-wiki-article-header">
          <View style={s.headerTop}>
            <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
              <Text style={[s.backText, { color: article.color }]}>{'<-'} Back</Text>
            </Pressable>
            <View style={[s.catPill, { backgroundColor: article.color + '12', borderColor: article.color + '25' }]}>
              <Text style={[s.catPillText, { color: article.color }]}>{article.category}</Text>
            </View>
          </View>
          <Text style={s.headerTitle}>{article.title}</Text>
        </Animated.View>

        {/* ── SECTION: Article Info ── */}
        <Animated.View style={[s.infoWrap, { opacity: infoAnim }]} nativeID="section-wiki-article-info">
          <View style={s.infoRow}>
            <View style={[s.infoIconBox, { backgroundColor: article.color + '15' }]}>
              <Text style={[s.infoIconText, { color: article.color }]}>{article.icon}</Text>
            </View>
            <View style={s.infoTextWrap}>
              <Text style={s.infoSubtitle}>{article.subtitle}</Text>
              <View style={s.infoTagsRow}>
                {article.tags.map(tag => (
                  <View key={tag} style={[s.infoTag, { backgroundColor: article.color + '12', borderColor: article.color + '25' }]}>
                    <Text style={[s.infoTagText, { color: article.color }]}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ── SECTION: Content Sections ── */}
        <View nativeID="section-wiki-article-content" style={s.contentWrap}>
          {article.content.map((section, index) => (
            <ContentSection key={index} section={section} color={article.color} index={index} />
          ))}
        </View>

        {/* ── SECTION: Related Articles ── */}
        {relatedArticles.length > 0 && (
          <View nativeID="section-wiki-article-related" style={s.relatedWrap}>
            <Text style={s.relatedTitle}>Related Articles</Text>
            {relatedArticles.map(rel => (
              <RelatedArticleCard
                key={rel.id}
                article={rel}
                onPress={() => navigation.navigate('WikiArticle', { articleId: rel.id })}
              />
            ))}
          </View>
        )}

        {/* ── SECTION: Learn in Schools ── */}
        {hasLessons && (
          <LearnInSchoolsCard
            color={article.color}
            lessonIds={article.relatedLessonIds!}
            onOpenLesson={(lessonId) => {
              const [trackId, moduleId, itemLessonId] = lessonId.split(':');
              navigation.navigate('SchoolsLesson', { trackId, moduleId, lessonId: itemLessonId });
            }}
            onPress={() => navigation.navigate('Schools')}
          />
        )}

        {nextArticle && (
          <View style={s.nextWrap}>
            <Text style={s.nextHeading}>Next Best Step</Text>
            <RelatedArticleCard
              article={nextArticle}
              onPress={() => navigation.replace('WikiArticle', { articleId: nextArticle.id })}
            />
          </View>
        )}

        {/* ── SECTION: Footer ── */}
        <View style={s.footer} nativeID="section-wiki-article-footer">
          <Text style={s.footerText}>Powered by The Underground Circle</Text>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Learn in Schools Card ─────────────────────────────────────────────────
function LearnInSchoolsCard({ color, lessonIds, onOpenLesson, onPress }: {
  color: string;
  lessonIds: string[];
  onOpenLesson: (lessonId: string) => void;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const lessonRefs = lessonIds
    .map(value => {
      const [trackId, moduleId, lessonId] = value.split(':');
      const lesson = getLesson(trackId, moduleId, lessonId);
      const module = getModule(trackId, moduleId);
      if (!lesson || !module) return null;
      return { key: value, title: lesson.title, moduleTitle: module.title };
    })
    .filter((item): item is { key: string; title: string; moduleTitle: string } => Boolean(item));

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay: 600, useNativeDriver: false }).start();
  }, [fadeAnim]);

  return (
    <Animated.View style={[s.learnWrap, { opacity: fadeAnim }]} nativeID="section-wiki-learn-schools">
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel="Continue learning in Schools"
        style={[s.learnCard, hovered && s.learnCardHover]}
      >
        <View style={[s.learnAccent, { backgroundColor: '#f59e0b' }]} />
        <View style={s.learnInner}>
          <View style={[s.learnIconBox, { backgroundColor: '#f59e0b15' }]}>
            <Text style={[s.learnIconText, { color: '#f59e0b' }]}>{'S'}</Text>
          </View>
          <View style={s.learnTextWrap}>
            <Text style={s.learnTitle}>Continue Learning in Schools</Text>
            <Text style={s.learnSubtitle}>Dive deeper with interactive lessons on this topic</Text>
            <Text style={s.learnCount}>{lessonIds.length} related lesson{lessonIds.length !== 1 ? 's' : ''}</Text>
          </View>
          <Text style={[s.learnArrow, { color: '#f59e0b' }]}>{'-->'}</Text>
        </View>
      </Pressable>
      {lessonRefs.length > 0 && (
        <View style={s.learnLessonList}>
          {lessonRefs.slice(0, 3).map(item => (
            <Pressable
              key={item.key}
              onPress={() => onOpenLesson(item.key)}
              accessibilityRole="button"
              accessibilityLabel={`Open lesson ${item.title}`}
              style={[s.learnLessonChip, { borderColor: color + '25' }]}
            >
              <Text style={[s.learnLessonModule, { color }]}>{item.moduleTitle}</Text>
              <Text style={s.learnLessonTitle}>{item.title}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </Animated.View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 24 },

  // Not found
  notFound: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 120 },
  notFoundText: { fontSize: 18, fontWeight: '600', color: TEXT_SEC, marginBottom: 16 },
  notFoundBack: { fontSize: 14, fontWeight: '500', color: '#06b6d4' },

  // Header
  header: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 20 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  backText: { fontSize: 13, fontWeight: '500' },
  catPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R_PILL, borderWidth: 1,
  },
  catPillText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  headerTitle: { fontSize: 28, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.5 },

  // Article Info
  infoWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 28 },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  infoIconBox: {
    width: 48, height: 48, borderRadius: R_BTN, justifyContent: 'center', alignItems: 'center',
  },
  infoIconText: { fontSize: 18, fontWeight: '700' },
  infoTextWrap: { flex: 1 },
  infoSubtitle: { fontSize: 15, fontWeight: '400', color: TEXT_SEC, lineHeight: 22, marginBottom: 10 },
  infoTagsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  infoTag: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R_PILL, borderWidth: 1,
  },
  infoTagText: { fontSize: 11, fontWeight: '600' },

  // Content
  contentWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', gap: 20, marginBottom: 32 },
  sectionCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    padding: 20,
  },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.3, marginBottom: 10 },
  sectionContent: { fontSize: 14, fontWeight: '400', color: TEXT_SEC, lineHeight: 22 },

  // Bullets
  bulletList: { marginTop: 12, gap: 8 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  bulletDot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, flexShrink: 0 },
  bulletText: { fontSize: 13, fontWeight: '400', color: TEXT_SEC, lineHeight: 20, flex: 1 },

  // Code Block
  codeScroll: { marginTop: 12 },
  codeBlock: {
    backgroundColor: '#0a0a12',
    borderWidth: 1,
    borderColor: '#1a1a2e',
    borderRadius: R_BTN,
    padding: 16,
  },
  codeText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 12,
    color: '#b8ff61',
    lineHeight: 18,
  },

  // Table
  tableScroll: { marginTop: 12 },
  table: {
    borderWidth: 1, borderColor: '#1a1a2e', borderRadius: R_BTN, overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row', backgroundColor: '#0a0a12',
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  tableRow: {
    flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  tableRowAlt: { backgroundColor: '#0a0a0f' },
  tableCell: {
    paddingHorizontal: 14, paddingVertical: 10, minWidth: 100,
    borderRightWidth: 1, borderRightColor: '#1a1a2e',
  },
  tableCellFirst: { minWidth: 120 },
  tableHeaderCell: {},
  tableHeaderText: {
    fontSize: 12, fontWeight: '700', color: TEXT_PRI, letterSpacing: 0.3,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  tableCellText: {
    fontSize: 12, fontWeight: '400', color: TEXT_SEC,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  // Related Articles
  relatedWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 24 },
  relatedTitle: { fontSize: 16, fontWeight: '600', color: TEXT_SEC, marginBottom: 12, letterSpacing: 0.3 },
  relCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    padding: 14, marginBottom: 8,
    ...(Platform.OS === 'web' ? { transition: 'all 180ms ease', cursor: 'pointer' } as any : {}),
  },
  relCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 12px -2px rgba(0,0,0,0.3)' } as any : {}),
  },
  relIconBox: {
    width: 36, height: 36, borderRadius: 8, justifyContent: 'center', alignItems: 'center',
  },
  relIconText: { fontSize: 12, fontWeight: '700' },
  relInfo: { flex: 1 },
  relTitle: { fontSize: 14, fontWeight: '600', color: TEXT_PRI, marginBottom: 2 },
  relSubtitle: { fontSize: 12, fontWeight: '400', color: TEXT_SEC },
  relArrow: { fontSize: 13, fontWeight: '600' },

  // Learn in Schools
  learnWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 16 },
  learnCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative',
    ...(Platform.OS === 'web' ? { transition: 'all 220ms ease', cursor: 'pointer' } as any : {}),
  },
  learnCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 12px -2px rgba(0,0,0,0.3)' } as any : {}),
  },
  learnAccent: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
    borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD,
  },
  learnInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, paddingLeft: 20 },
  learnIconBox: {
    width: 40, height: 40, borderRadius: R_BTN, justifyContent: 'center', alignItems: 'center',
  },
  learnIconText: { fontSize: 14, fontWeight: '700' },
  learnTextWrap: { flex: 1 },
  learnTitle: { fontSize: 15, fontWeight: '600', color: TEXT_PRI, marginBottom: 2 },
  learnSubtitle: { fontSize: 12, fontWeight: '400', color: TEXT_SEC, marginBottom: 4 },
  learnCount: { fontSize: 11, fontWeight: '500', color: TEXT_TER },
  learnArrow: { fontSize: 16, fontWeight: '700' },
  learnLessonList: { gap: 8, marginTop: 10 },
  learnLessonChip: {
    backgroundColor: BG_RAISED,
    borderWidth: 1,
    borderColor: BORDER_DEF,
    borderRadius: R_BTN,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  learnLessonModule: { fontSize: 10, fontWeight: '700', color: '#f59e0b', letterSpacing: 0.8, marginBottom: 4 },
  learnLessonTitle: { fontSize: 13, fontWeight: '500', color: TEXT_PRI },
  nextWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 20 },
  nextHeading: { fontSize: 16, fontWeight: '600', color: TEXT_SEC, marginBottom: 12, letterSpacing: 0.3 },

  // Footer
  footer: { marginTop: 16, alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center' },
  footerText: { fontSize: 12, fontWeight: '400', color: TEXT_DIS },
});
