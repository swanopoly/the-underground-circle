import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, TextInput,
  Platform, Animated, Easing,
} from 'react-native';
import { WIKI_ARTICLES, WikiArticle, WikiCategoryInfo, getCategoryInfo, searchArticles } from '../../lib/wikiData';
import StaggerGroup from '../../components/motion/StaggerGroup';
import FadeSlideIn from '../../components/motion/FadeSlideIn';

// ── Design Tokens ─────────────────────────────────────────────────────────
const BG_PAGE = '#050508', BG_SURFACE = '#0a0a10', BG_RAISED = '#0f0f18', BG_INPUT = '#1a1a28';
const TEXT_PRI = '#f0f0f5', TEXT_SEC = '#a0a0b0', TEXT_TER = '#606075', TEXT_DIS = '#3a3a4e';
const BORDER_DEF = '#1a1a28', BORDER_HOV = '#2a2a3e';
const R_CARD = 14, R_BTN = 10, R_PILL = 100;

// ── Category Card ─────────────────────────────────────────────────────────
function CategoryCard({ cat, index, onPress }: {
  cat: WikiCategoryInfo & { articleCount?: number };
  index: number;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(14)).current;

  const articleCount = WIKI_ARTICLES.filter(a => a.category === cat.id).length;

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
        accessibilityLabel={`${cat.title} category, ${articleCount} articles`}
        style={[s.catCard, hovered && s.catCardHover]}
      >
        <View style={[s.catAccent, { backgroundColor: cat.color }]} />
        <View style={s.catInner}>
          <View style={s.catHeader}>
            <View style={[s.catIconBox, { backgroundColor: cat.color + '15' }]}>
              <Text style={[s.catIconText, { color: cat.color }]}>{cat.icon}</Text>
            </View>
            <View style={s.catTitleWrap}>
              <Text style={s.catTitle}>{cat.title}</Text>
              <Text style={s.catSubtitle}>{cat.subtitle}</Text>
            </View>
          </View>
          <View style={[s.catPill, { backgroundColor: cat.color + '15', borderColor: cat.color + '30' }]}>
            <Text style={[s.catPillText, { color: cat.color }]}>{articleCount} articles</Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Featured Article Card ─────────────────────────────────────────────────
function FeaturedArticleCard({ article, index, onPress }: {
  article: WikiArticle;
  index: number;
  onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
    }, 600 + index * 60);
    return () => clearTimeout(t);
  }, [index, fadeAnim]);

  return (
    <Animated.View style={{ opacity: fadeAnim }}>
      <Pressable
        onPress={onPress}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        accessibilityRole="button"
        accessibilityLabel={`${article.title} article`}
        style={[s.featCard, hovered && s.featCardHover]}
      >
        <View style={[s.featIconBox, { backgroundColor: article.color + '15' }]}>
          <Text style={[s.featIconText, { color: article.color }]}>{article.icon}</Text>
        </View>
        <View style={s.featInfo}>
          <Text style={s.featTitle} numberOfLines={1}>{article.title}</Text>
          <Text style={s.featSubtitle} numberOfLines={1}>{article.subtitle}</Text>
        </View>
        <View style={[s.featCatPill, { backgroundColor: article.color + '12', borderColor: article.color + '25' }]}>
          <Text style={[s.featCatPillText, { color: article.color }]}>{article.category}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ── Search Result Card ────────────────────────────────────────────────────
function SearchResultCard({ article, onPress }: {
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
      accessibilityLabel={`${article.title} search result`}
      style={[s.searchCard, hovered && s.searchCardHover]}
    >
      <View style={[s.searchAccent, { backgroundColor: article.color }]} />
      <View style={s.searchInner}>
        <View style={[s.searchIconBox, { backgroundColor: article.color + '15' }]}>
          <Text style={[s.searchIconText, { color: article.color }]}>{article.icon}</Text>
        </View>
        <View style={s.searchInfo}>
          <Text style={s.searchTitle}>{article.title}</Text>
          <Text style={s.searchSubtitle} numberOfLines={1}>{article.subtitle}</Text>
          <View style={s.searchTagsRow}>
            {article.tags.slice(0, 3).map(tag => (
              <View key={tag} style={[s.searchTag, { backgroundColor: article.color + '12', borderColor: article.color + '25' }]}>
                <Text style={[s.searchTagText, { color: article.color }]}>{tag}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────
export default function WikiScreen({ navigation }: any) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchResults = searchQuery.length > 1 ? searchArticles(searchQuery) : [];

  const headerAnim = useRef(new Animated.Value(0)).current;
  const searchBarAnim = useRef(new Animated.Value(0)).current;

  const categories = getCategoryInfo();
  const featuredArticles = WIKI_ARTICLES.slice(0, 5);
  const isSearchActive = searchQuery.length > 1;

  useEffect(() => {
    Animated.timing(headerAnim, { toValue: 1, duration: 500, delay: 100, useNativeDriver: false }).start();
    Animated.timing(searchBarAnim, { toValue: 1, duration: 400, delay: 200, useNativeDriver: false }).start();
  }, [headerAnim, searchBarAnim]);

  return (
    <View style={s.page} nativeID="section-wiki-hub">
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* ── SECTION: Header ── */}
        <Animated.View style={[s.header, { opacity: headerAnim }]} nativeID="section-wiki-header">
          <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Go back">
            <Text style={s.backText}>{'<-'} Back</Text>
          </Pressable>
          <View style={{ flex: 1, marginLeft: 16 }}>
            <Text style={s.headerSubtitle}>Knowledge Base</Text>
            <Text style={s.headerTitle}>AI Wiki</Text>
          </View>
        </Animated.View>

        {/* ── SECTION: Search Bar ── */}
        <Animated.View style={[s.searchBarWrap, { opacity: searchBarAnim }]} nativeID="section-wiki-search">
          <View style={s.searchBarInner}>
            <Text style={s.searchIcon}>{'[?]'}</Text>
            <TextInput
              style={s.searchInput}
              placeholder="Search articles, topics, tools..."
              placeholderTextColor={TEXT_TER}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {searchQuery.length > 0 && (
              <Pressable onPress={() => setSearchQuery('')} accessibilityRole="button" accessibilityLabel="Clear search">
                <Text style={s.searchClear}>X</Text>
              </Pressable>
            )}
          </View>
        </Animated.View>

        {isSearchActive ? (
          /* ── SECTION: Search Results ── */
          <View nativeID="section-wiki-search-results" style={s.sectionWrap}>
            <Text style={s.sectionTitle}>
              {searchResults.length > 0
                ? `${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} for "${searchQuery}"`
                : `No results for "${searchQuery}"`
              }
            </Text>
            {searchResults.map(article => (
              <SearchResultCard
                key={article.id}
                article={article}
                onPress={() => navigation.navigate('WikiArticle', { articleId: article.id })}
              />
            ))}
          </View>
        ) : (
          <>
            {/* ── SECTION: Category Cards ── */}
            <View nativeID="section-wiki-categories" style={s.sectionWrap}>
              <Text style={s.sectionTitle}>Categories</Text>
              <View style={s.catGrid}>
                <StaggerGroup staggerMs={60} baseDelayMs={200}>
                  {categories.map((cat, index) => (
                    <CategoryCard
                      key={cat.id}
                      cat={cat}
                      index={index}
                      onPress={() => navigation.navigate('WikiCategory', { categoryId: cat.id })}
                    />
                  ))}
                </StaggerGroup>
              </View>
            </View>

            {/* ── SECTION: Featured Articles ── */}
            <View nativeID="section-wiki-featured" style={s.sectionWrap}>
              <Text style={s.sectionTitle}>Featured Articles</Text>
              {featuredArticles.map((article, index) => (
                <FeaturedArticleCard
                  key={article.id}
                  article={article}
                  index={index}
                  onPress={() => navigation.navigate('WikiArticle', { articleId: article.id })}
                />
              ))}
            </View>
          </>
        )}

        {/* ── SECTION: Footer ── */}
        <View style={s.footer} nativeID="section-wiki-footer">
          <Text style={s.footerText}>Powered by The Underground Circle</Text>
        </View>

      </ScrollView>
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: BG_PAGE },
  scroll: { paddingTop: 32, paddingBottom: 48, paddingHorizontal: 24 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 24,
  },
  backText: { fontSize: 13, fontWeight: '500', color: '#06b6d4' },
  headerSubtitle: { fontSize: 13, fontWeight: '500', color: TEXT_TER, marginBottom: 2 },
  headerTitle: { fontSize: 28, fontWeight: '700', color: TEXT_PRI, letterSpacing: -0.5 },

  // Search Bar
  searchBarWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 28 },
  searchBarInner: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: BG_INPUT,
    borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_BTN,
    paddingHorizontal: 14, height: 44,
  },
  searchIcon: { fontSize: 13, fontWeight: '600', color: TEXT_TER, marginRight: 10 },
  searchInput: {
    flex: 1, fontSize: 14, color: TEXT_PRI, height: 44,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  searchClear: { fontSize: 13, fontWeight: '700', color: TEXT_SEC, padding: 4 },

  // Section
  sectionWrap: { maxWidth: 720, width: '100%', alignSelf: 'center', marginBottom: 28 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: TEXT_SEC, marginBottom: 14, letterSpacing: 0.3 },

  // Category Card
  catGrid: { gap: 12 },
  catCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative',
    ...(Platform.OS === 'web' ? { transition: 'all 220ms cubic-bezier(0.25,0.46,0.45,0.94)', cursor: 'pointer' } as any : {}),
  },
  catCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { transform: [{ translateY: -1 }], boxShadow: '0 4px 20px -4px rgba(0,0,0,0.4)' } as any : {}),
  },
  catAccent: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
    borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD,
  },
  catInner: { padding: 18, paddingLeft: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  catHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  catIconBox: {
    width: 40, height: 40, borderRadius: R_BTN, justifyContent: 'center', alignItems: 'center',
  },
  catIconText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  catTitleWrap: { flex: 1 },
  catTitle: { fontSize: 16, fontWeight: '600', color: TEXT_PRI, letterSpacing: -0.2, marginBottom: 2 },
  catSubtitle: { fontSize: 12, fontWeight: '400', color: TEXT_SEC },
  catPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: R_PILL,
    borderWidth: 1, marginLeft: 8,
  },
  catPillText: { fontSize: 11, fontWeight: '600' },

  // Featured Article Card
  featCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    padding: 14, marginBottom: 8,
    ...(Platform.OS === 'web' ? { transition: 'all 180ms ease', cursor: 'pointer' } as any : {}),
  },
  featCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 12px -2px rgba(0,0,0,0.3)' } as any : {}),
  },
  featIconBox: {
    width: 36, height: 36, borderRadius: 8, justifyContent: 'center', alignItems: 'center',
  },
  featIconText: { fontSize: 12, fontWeight: '700' },
  featInfo: { flex: 1 },
  featTitle: { fontSize: 14, fontWeight: '600', color: TEXT_PRI, marginBottom: 2 },
  featSubtitle: { fontSize: 12, fontWeight: '400', color: TEXT_SEC },
  featCatPill: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: R_PILL,
    borderWidth: 1,
  },
  featCatPillText: { fontSize: 10, fontWeight: '600', textTransform: 'capitalize' },

  // Search Result Card
  searchCard: {
    backgroundColor: BG_SURFACE, borderWidth: 1, borderColor: BORDER_DEF, borderRadius: R_CARD,
    overflow: 'hidden', position: 'relative', marginBottom: 10,
    ...(Platform.OS === 'web' ? { transition: 'all 180ms ease', cursor: 'pointer' } as any : {}),
  },
  searchCardHover: {
    borderColor: BORDER_HOV, backgroundColor: BG_RAISED,
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 12px -2px rgba(0,0,0,0.3)' } as any : {}),
  },
  searchAccent: {
    position: 'absolute', left: 0, top: 0, bottom: 0, width: 3,
    borderTopLeftRadius: R_CARD, borderBottomLeftRadius: R_CARD,
  },
  searchInner: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingLeft: 18 },
  searchIconBox: {
    width: 40, height: 40, borderRadius: R_BTN, justifyContent: 'center', alignItems: 'center',
  },
  searchIconText: { fontSize: 14, fontWeight: '700' },
  searchInfo: { flex: 1 },
  searchTitle: { fontSize: 15, fontWeight: '600', color: TEXT_PRI, marginBottom: 2 },
  searchSubtitle: { fontSize: 12, fontWeight: '400', color: TEXT_SEC, marginBottom: 6 },
  searchTagsRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  searchTag: {
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: R_PILL, borderWidth: 1,
  },
  searchTagText: { fontSize: 10, fontWeight: '600' },

  // Footer
  footer: { marginTop: 16, alignItems: 'center', maxWidth: 720, width: '100%', alignSelf: 'center' },
  footerText: { fontSize: 12, fontWeight: '400', color: TEXT_DIS },
});
