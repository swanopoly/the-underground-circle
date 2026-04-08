import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  Platform, Animated, Easing,
} from 'react-native';
import { WikiArticle, WikiCategory, WikiCategoryInfo, getArticlesByCategory, getCategoryInfo } from '../../lib/wikiData';

// ── Design Tokens ─────────────────────────────────────────────────────────
const BG_PAGE = '#050508', BG_SURFACE = '#0a0a10', BG_RAISED = '#0f0f18';
const TEXT_PRI = '#f0f0f5', TEXT_SEC = '#a0a0b0', TEXT_TER = '#606075', TEXT_DIS = '#3a3a4e';
const BORDER_DEF = '#1a1a28', BORDER_HOV = '#2a2a3e';
const R_CARD = 14, R_BTN = 10, R_PILL = 100;

// ── Article Card ──────────────────────────────────────────────────────────
function ArticleCard({ article, index, onPress }: {
  article: WikiArticle;
  index: number;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(14)).current;

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
        accessibilityLabel={`${article.title} article`}
        style={[s.artCard, hovered && s.artCardHover]}
      >
        <View style={[s.artAccent, { backgroundColor: article.color }]} />
        <View style={s.artInner}>
          <View style={s.artHeader}>
            <View style={[s.artIconBox, { backgroundColor: article.color + '15' }]}>
              <Text style={[s.artIconText, { color: article.color }]}>{article.icon}</Text>
            </View>
            <View style={s.artTitleWrap}>
              <Text style={s.artTitle}>{article.title}</Text>
              <Text style={s.artSubtitle} numberOfLines={2}>{article.subtitle}</Text>
            </View>
          </View>

          {/* Tags Row */}
          <View style={s.artTagsRow}>
            {article.tags.map(tag => (
              <View key={tag} style={[s.artTag, { backgroundColor: article.color + '12', borderColor: article.color + '25' }]}>
                <Text style={[s.artTagText, { color: article.color }]}>{tag}</Text>
              </View>
            ))}
          </View>

          {/* Section count */}
          <View style={s.artFooter}>
            <Text style={s.artSectionCount}>{article.content.length} sections</Text>
            <Text style={[s.artAction, { color: article.color }]}>Read {'-->'}</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────
export default function WikiCategoryScreen({ navigation, route }: any) {
  const { categoryId } = route.params as { categoryId: WikiCategory };
  const categories = getCategoryInfo();
  const categoryInfo = categories.find(c => c.id === categoryId);
  const articles = getArticlesByCategory(categoryId);

  const headerAnim = useRef(new Animated.Value(0)).current;
  const countAnim = useRef(new Animated.Value(0)).current;

  const hasSchoolsConnection = articles.some(a => a.relatedLessonIds && a.relatedLessonIds.length > 0);

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, delay: 100, useNativeDriver: false }).start();
    Animated.timing(countAnim, { toValue: 1, duration: 400, delay: 250, useNativeDriver: false }).start();
  }, [headerAnim, countAnim]);

  const catColor = categoryInfo?.color || '#6366f1';

  return (
    <View style={s.page} nativeID="section-wiki-category">
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── SECTION: Header ── */}
        <Animated.View style={[s.header, { opacity: headerAnim }]} nativeID="section-wiki-category-header">
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={[s.backText, { color: catColor }]}>{'<-'} Back</Text>
          </Pressable>
          <View style={{ flex: 1, marginLeft: 16 }}>
            <View style={s.headerRow}>
              <View style={[s.headerIconBox, { backgroundColor: catColor + '15' }]}>
                <Text style={[s.headerIconText, { color: catColor }]}>{categoryInfo?.icon || '?'}</Text>
              </View>
              <View style={s.headerTitleWrap}>
                <Text style={s.headerTitle}>{categoryInfo?.title || 'Category'}</Text>
                <Text style={s.headerSubtitle}>{categoryInfo?.subtitle || ''}</Text>
              </View>
            </View>
          </View>
        </Animated.View>

        {/* ── SECTION: Article Count ── */}
        <Animated.View style={[s.countWrap, { opacity: countAnim }]} nativeID="section-wiki-category-count">
          <View style={[s.countPill, { backgroundColor: catColor + '10', borderColor: catColor + '25' }]}>
            <Text style={[s.countText, { color: catColor }]}>{articles.length} article{articles.length !== 1 ? 's' : ''}</Text>
          </View>
        </Animated.View>

        {/* ── SECTION: Article List ── */}
        <View nativeID="section-wiki-category-articles" style={s.articlesWrap}>
          {articles.map((article, index) => (
            <ArticleCard
              key={article.id}
              article={article}
              index={index}
              onPress={() => navigation.navigate('WikiArticle', { articleId: article.id })}
            />
          ))}
        </View>

        {/* ── SECTION: Schools Connection ── */}
        {hasSchoolsConnection && (
          <SchoolsConnectionCard catColor={catColor} onPress={() => navigation.navigate('Schools')} />
        )}

        {/* ── SECTION: Footer ── */}
        <View style={s.footer} nativeID="section-wiki-category-footer">
          <Text style={s.footerText}>Powered by The Underground Circle</Text>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Schools Connection Card ───────────────────────────────────────────────
function SchoolsConnectionCard({ catColor, onPress }: { catColor: string; onPress: () => void }) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 400, delay: 500, useNativeDriver: false }).start();
  }, [fadeAnim]);

  return (
    <Animated.View style={[s.schoolsWrap, { opacity: fadeAnim }]} nativeID="section-wiki-schools-link">
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel="Learn more in Schools"
        style={[s.schoolsCard, hovered && s.schoolsCardHover]}
      >
        <View style={[s.schoolsAccent, { backgroundColor: '#f59e0b' }]} />
        <View style={s.schoolsInner}>
          <View style={[s.schoolsIconBox, { backgroundColor: '#f59e0b15' }]}>
            <Text style={[s.schoolsIconText, { color: '#f59e0b' }]}>{'S'}</Text>
          </View>
          <View style={s.schoolsTitleWrap}>
            <Text style={s.schoolsTitle}>Schools Connection</Text>
            <Text style={s.schoolsSubtitle}>Learn more about these topics in interactive lessons</Text>
          </View>
          <Text style={[s.schoolsAction, { color: '#f59e0b' }]}>{'-->'}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 24 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 12,
  },
  backText: { fontSize: 13, fontWeight: '500' },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerIconBox: {
    width: 44, height: 44, borderRadius: R_BTN, justifyContent: 'center', alignItems: 'center',
  },
  headerIconText: { fontSize: 16, fontWeight: '700' },
  headerTitleWrap: { flex: 1 },
  headerTitle: { fontSize: 26, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.5 },
  headerSubtitle: { fontSize: 13, fontWeight: '400', color: TEXT_SEC, marginTop: 2 },

  // Count
  countWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 20 },
  countPill: {
    alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: R_PILL, borderWidth: 1,
  },
  countText: { fontSize: 12, fontWeight: '600' },

  // Articles
  articlesWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', gap: 12, marginBottom: 24 },

  // Article Card
  artCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative',
    ...(Platform.OS === 'web' ? { transition: 'all 220ms cubic-bezier(0.25,0.46,0.45,0.94)', cursor: 'pointer' } as any : {}),
  },
  artCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -1 }], boxShadow: '0 4px 20px -4px rgba(0,0,0,0.4)' } as any : {}),
  },
  artAccent: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
    borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD,
  },
  artInner: { padding: 18, paddingLeft: 20 },
  artHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  artIconBox: {
    width: 40, height: 40, borderRadius: R_BTN, justifyContent: 'center', alignItems: 'center',
  },
  artIconText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  artTitleWrap: { flex: 1 },
  artTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.2, marginBottom: 2 },
  artSubtitle: { fontSize: 13, fontWeight: '400', color: TEXT_SEC, lineHeight: 18 },

  // Tags
  artTagsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 12 },
  artTag: {
    paddingHorizontal: 9, paddingVertical: 3, borderRadius: R_PILL, borderWidth: 1,
  },
  artTagText: { fontSize: 10, fontWeight: '600' },

  // Footer row
  artFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  artSectionCount: { fontSize: 12, fontWeight: '500', color: TEXT_TER },
  artAction: { fontSize: 13, fontWeight: '600' },

  // Schools Connection
  schoolsWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 12 },
  schoolsCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative',
    ...(Platform.OS === 'web' ? { transition: 'all 220ms ease', cursor: 'pointer' } as any : {}),
  },
  schoolsCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 12px -2px rgba(0,0,0,0.3)' } as any : {}),
  },
  schoolsAccent: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
    borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD,
  },
  schoolsInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, paddingLeft: 20 },
  schoolsIconBox: {
    width: 40, height: 40, borderRadius: R_BTN, justifyContent: 'center', alignItems: 'center',
  },
  schoolsIconText: { fontSize: 14, fontWeight: '700' },
  schoolsTitleWrap: { flex: 1 },
  schoolsTitle: { fontSize: 15, fontWeight: '600', color: TEXT_PRI, marginBottom: 2 },
  schoolsSubtitle: { fontSize: 12, fontWeight: '400', color: TEXT_SEC },
  schoolsAction: { fontSize: 16, fontWeight: '700' },

  // Footer
  footer: { marginTop: 16, alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center' },
  footerText: { fontSize: 12, fontWeight: '400', color: TEXT_DIS },
});
