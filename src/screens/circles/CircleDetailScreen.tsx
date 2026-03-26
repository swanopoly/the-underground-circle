import React, { useState, useEffect, useRef, useCallback } from 'react';
import FlatIcon from '../../components/FlatIcon';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Animated,
  useWindowDimensions,
  ScrollView,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import ChatTab from './tabs/ChatTab';
import OfficeTab from './tabs/OfficeTab';
import FeedTab from './tabs/FeedTab';
import MembersTab from './tabs/MembersTab';
import ChallengesTab from './tabs/ChallengesTab';
import WalletTab from './tabs/WalletTab';
import ProfileTab from './tabs/ProfileTab';
import RoomsTab from './tabs/RoomsTab';
import AnalyticsTab from './tabs/AnalyticsTab';
import IntegrationsTab from './tabs/IntegrationsTab';
import BackpackTab from './tabs/BackpackTab';

import { Circle } from '../../types';
import ErrorBoundary from '../../components/ErrorBoundary';
import { LoadingScreen } from '../../components/LoadingWave';

// Core tabs (Chat, Office, Rooms) always mounted; secondary tabs lazy-mount on first visit

const TAB_META: { key: string; label: string; icon: string; flatIcon?: string }[] = [
  { key: 'CHAT', label: 'Chat', icon: '💬', flatIcon: 'chat' },
  { key: 'OFFICE', label: 'Office', icon: '🏢', flatIcon: 'office' },
  { key: 'ROOMS', label: 'Rooms', icon: '🏠', flatIcon: 'rooms' },
  { key: 'BACKPACK', label: 'Backpack', icon: '🎒', flatIcon: 'backpack' },
  { key: 'FEED', label: 'Feed', icon: '📋', flatIcon: 'feed' },
  { key: 'WALLET', label: 'Wallet', icon: '💰', flatIcon: 'wallet' },
  { key: 'INTEGRATIONS', label: 'Integrations', icon: '🔗', flatIcon: 'integrations' },
  { key: 'CHALLENGES', label: 'Challenges', icon: '🏆', flatIcon: 'challenges' },
  { key: 'MEMBERS', label: 'Members', icon: '👥', flatIcon: 'members' },
  { key: 'ANALYTICS', label: 'Analytics', icon: '📊', flatIcon: 'analytics' },
  { key: 'PROFILE', label: 'Profile', icon: '👤', flatIcon: 'profile' },
];

const TABS = TAB_META.map(t => t.key) as readonly string[];
type Tab = string;

// Persist active tab per circle across refreshes
const TAB_STORAGE_KEY = 'uc_active_tab';
function loadSavedTab(circleId: string): Tab {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(`${TAB_STORAGE_KEY}_${circleId}`);
      if (raw && TABS.includes(raw)) return raw;
    }
    // Native: AsyncStorage is async, so we load synchronously from a cache below
  } catch {}
  return 'FEED';
}
function saveTab(circleId: string, tab: Tab) {
  try {
    const key = `${TAB_STORAGE_KEY}_${circleId}`;
    if (Platform.OS === 'web') {
      localStorage.setItem(key, tab);
    } else {
      AsyncStorage.setItem(key, tab).catch(() => {});
    }
  } catch {}
}

// Cache circle data so the screen renders instantly on refresh
const CIRCLE_CACHE_KEY = 'uc_circle_cache';
function loadCachedCircle(circleId: string): { circle: Circle | null; memberCount: number } {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(`${CIRCLE_CACHE_KEY}_${circleId}`);
      if (raw) return JSON.parse(raw);
    }
  } catch {}
  return { circle: null, memberCount: 0 };
}
function cacheCircle(circleId: string, circle: Circle, memberCount: number) {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem(`${CIRCLE_CACHE_KEY}_${circleId}`, JSON.stringify({ circle, memberCount }));
    }
  } catch {}
}

export default function CircleDetailScreen({ route, navigation }: any) {
  const { circleId, circleName } = route.params;
  const [activeTab, setActiveTabRaw] = useState<Tab>(() => loadSavedTab(circleId));
  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabRaw(tab);
    saveTab(circleId, tab);
  }, [circleId]);
  const cached = loadCachedCircle(circleId);
  const [circle, setCircle] = useState<Circle | null>(cached.circle);
  const [memberCount, setMemberCount] = useState(cached.memberCount);
  const [activeStreakCount, setActiveStreakCount] = useState(Math.max(1, Math.floor((cached.memberCount || 1) * 0.7)));
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 700;
  const [onlineMembers, setOnlineMembers] = useState(Math.max(1, Math.floor((cached.memberCount || 1) * 0.5)));
  // Skip loading gate if we have cached data — render immediately
  const [loading, setLoading] = useState(!cached.circle);

  // Native: load saved tab asynchronously on mount
  useEffect(() => {
    if (Platform.OS !== 'web') {
      AsyncStorage.getItem(`${TAB_STORAGE_KEY}_${circleId}`).then(raw => {
        if (raw && TABS.includes(raw)) setActiveTabRaw(raw);
      }).catch(() => {});
    }
  }, [circleId]);

  useEffect(() => {
    loadCircleData();
  }, [circleId]);


  const loadCircleData = async () => {
    try {
      const [circleRes, memberRes] = await Promise.all([
        supabase.from('circles').select('*').eq('id', circleId).single(),
        supabase.from('circle_members').select('user_id').eq('circle_id', circleId),
      ]);
      if (circleRes.data) {
        setCircle(circleRes.data);
        const mc = memberRes.data?.length || 0;
        setMemberCount(mc);
        setOnlineMembers(Math.max(1, Math.floor(mc * 0.5)));
        setActiveStreakCount(Math.max(1, Math.floor(mc * 0.7)));
        cacheCircle(circleId, circleRes.data, mc);
      }
    } catch (error) {
      console.error('Error loading circle data:', error);
    } finally {
      setLoading(false);
    }
  };

  const accentColor = circle?.accent_color || '#6366f1';
  const circleIcon = circle?.icon || '⭕';
  const circleType = circle?.circle_type || 'custom';

  const typeLabels: Record<string, string> = {
    fitness: 'FITNESS', money: 'MONEY', learning: 'LEARNING',
    'mental-health': 'WELLNESS', relationships: 'SOCIAL', career: 'CAREER',
    productivity: 'PRODUCTIVITY', nutrition: 'NUTRITION', purpose: 'PURPOSE',
    gaming: 'GAMING', creative: 'CREATIVE', custom: 'CUSTOM',
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          {/* Tab Bar — horizontal scrollable pills with arrow indicators */}
          <TabBarScroller
            tabs={TAB_META}
            activeTab={activeTab}
            accentColor={accentColor}
            isMobile={isMobile}
            onTabPress={setActiveTab}
          />
        </View>
      </View>

      {/* Core tabs — always mounted, instant switching */}
      <View style={[styles.tabContent, activeTab !== 'CHAT' && styles.hiddenTab]}>
        <ErrorBoundary><ChatTab circleId={circleId} accentColor={accentColor} /></ErrorBoundary>
      </View>
      <View style={[styles.tabContent, activeTab !== 'OFFICE' && styles.hiddenTab]}>
        <ErrorBoundary><OfficeTab circleId={circleId} accentColor={accentColor} /></ErrorBoundary>
      </View>
      <View style={[styles.tabContent, activeTab !== 'ROOMS' && styles.hiddenTab]}>
        <ErrorBoundary><RoomsTab circleId={circleId} accentColor={accentColor} /></ErrorBoundary>
      </View>

      {/* Secondary tabs — lazy mount on first visit, stay mounted after */}
      <LazyTab tabKey="BACKPACK" activeTab={activeTab}>
        <BackpackTab circleId={circleId} accentColor={accentColor} />
      </LazyTab>
      <LazyTab tabKey="FEED" activeTab={activeTab}>
        <FeedTab circleId={circleId} />
      </LazyTab>
      <LazyTab tabKey="CHALLENGES" activeTab={activeTab}>
        <ChallengesTab circleId={circleId} />
      </LazyTab>
      <LazyTab tabKey="MEMBERS" activeTab={activeTab}>
        <MembersTab circleId={circleId} />
      </LazyTab>
      <LazyTab tabKey="ANALYTICS" activeTab={activeTab}>
        <AnalyticsTab circleId={circleId} />
      </LazyTab>
      <LazyTab tabKey="INTEGRATIONS" activeTab={activeTab}>
        <IntegrationsTab circleId={circleId} />
      </LazyTab>
      <LazyTab tabKey="WALLET" activeTab={activeTab}>
        <WalletTab circleId={circleId} />
      </LazyTab>
      <LazyTab tabKey="PROFILE" activeTab={activeTab}>
        <ProfileTab circleId={circleId} navigation={navigation} />
      </LazyTab>
    </View>
  );
}

// ─── Lazy Tab — mounts on first visit, stays mounted after ──────────────────

function LazyTab({ tabKey, activeTab, children }: { tabKey: string; activeTab: string; children: React.ReactNode }) {
  const [hasVisited, setHasVisited] = useState(false);
  const isActive = activeTab === tabKey;

  useEffect(() => {
    if (isActive && !hasVisited) setHasVisited(true);
  }, [isActive, hasVisited]);

  if (!hasVisited) return null;

  return (
    <View style={[styles.tabContent, !isActive && styles.hiddenTab]}>
      <ErrorBoundary>{children}</ErrorBoundary>
    </View>
  );
}

// ─── Tab Pill ───────────────────────────────────────────────────────

function TabPill({ icon, flatIcon, label, active, accentColor, isMobile, onPress }: {
  icon: string; flatIcon?: string; label: string; active: boolean; accentColor: string; isMobile: boolean; onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.tabPill,
        active && { backgroundColor: accentColor + '20', borderColor: accentColor + '60' },
        hovered && !active && { backgroundColor: '#ffffff08', borderColor: '#333' },
        isMobile && styles.tabPillMobile,
      ]}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
    >
      {flatIcon ? (
        <FlatIcon
          name={flatIcon}
          size={isMobile ? 16 : 18}
          mono={!hovered && !active}
          glow={active}
          style={!active && !hovered ? { opacity: 0.5 } : undefined}
        />
      ) : (
        <Text style={styles.tabPillIcon}>{icon}</Text>
      )}
      <Text style={[
        styles.tabPillText,
        { color: active ? accentColor : hovered ? '#ccc' : '#888' },
        active && { fontWeight: '800' },
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Tab Bar Scroller ────────────────────────────────────────────────────────

function TabBarScroller({ tabs, activeTab, accentColor, isMobile, onTabPress }: {
  tabs: typeof TAB_META;
  activeTab: string;
  accentColor: string;
  isMobile: boolean;
  onTabPress: (key: string) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);
  const scrollX = useRef(0);
  const contentW = useRef(0);
  const containerW = useRef(0);

  const updateArrows = useCallback(() => {
    setCanScrollLeft(scrollX.current > 4);
    setCanScrollRight(scrollX.current + containerW.current < contentW.current - 4);
  }, []);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    scrollX.current = e.nativeEvent.contentOffset.x;
    containerW.current = e.nativeEvent.layoutMeasurement.width;
    contentW.current = e.nativeEvent.contentSize.width;
    updateArrows();
  }, [updateArrows]);

  const scrollBy = useCallback((delta: number) => {
    const next = Math.max(0, scrollX.current + delta);
    scrollRef.current?.scrollTo({ x: next, animated: true });
  }, []);

  return (
    <View style={styles.tabBarWrapper}>
      {/* Left arrow */}
      {!isMobile && canScrollLeft && (
        <Pressable
          onPress={() => scrollBy(-200)}
          style={[styles.tabArrow, styles.tabArrowLeft]}
        >
          <Text style={styles.tabArrowText}>‹</Text>
        </Pressable>
      )}

      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
        contentContainerStyle={isMobile ? styles.tabBarMobile : styles.tabBar}
        style={styles.tabBarScroll}
      >
        {tabs.map((tab) => (
          <TabPill
            key={tab.key}
            icon={tab.icon}
            flatIcon={tab.flatIcon}
            label={tab.label}
            active={activeTab === tab.key}
            accentColor={accentColor}
            isMobile={isMobile}
            onPress={() => onTabPress(tab.key)}
          />
        ))}
      </ScrollView>

      {/* Right arrow */}
      {!isMobile && canScrollRight && (
        <Pressable
          onPress={() => scrollBy(200)}
          style={[styles.tabArrow, styles.tabArrowRight]}
        >
          <Text style={styles.tabArrowText}>›</Text>
        </Pressable>
      )}

      {/* Fade hints */}
      {!isMobile && canScrollLeft && <View style={[styles.tabFade, styles.tabFadeLeft]} pointerEvents="none" />}
      {!isMobile && canScrollRight && <View style={[styles.tabFade, styles.tabFadeRight]} pointerEvents="none" />}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
  },

  // Header
  header: {
    paddingTop: Platform.OS === 'web' ? 4 : 44,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    width: '100%',
    alignItems: 'center',
  },
  headerInner: {
    width: '100%',
    maxWidth: 800,
  },

  // Top row
  // Tab Bar wrapper with arrows
  tabBarWrapper: {
    position: 'relative' as any,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBarScroll: {
    flex: 1,
  },

  // Tab Bar — desktop
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexGrow: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 4,
  },

  // Tab Bar — mobile: scrollable with padding
  tabBarMobile: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexGrow: 1,
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 4,
  },

  // Arrow buttons
  tabArrow: {
    width: 24,
    height: 28,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    backgroundColor: '#000000',
    zIndex: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabArrowLeft: {},
  tabArrowRight: {},
  tabArrowText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#888',
  },

  // Fade gradients on edges
  tabFade: {
    position: 'absolute' as any,
    top: 0,
    bottom: 0,
    width: 20,
    zIndex: 5,
    pointerEvents: 'none' as any,
  },
  tabFadeLeft: {
    left: 24,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(to right, #000000, transparent)' } as any : {}),
  },
  tabFadeRight: {
    right: 24,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(to left, #000000, transparent)' } as any : {}),
  },

  // Tab pill style (replaces old underline tabs and hamburger menu)
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 28,
    gap: 4,
    ...(Platform.OS === 'web' ? { transition: 'all 0.2s ease', cursor: 'pointer' } as any : {}),
  },
  tabPillMobile: {
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  tabPillIcon: {
    fontSize: 13,
  },
  tabPillText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  // Tab content
  tabContent: {
    flex: 1,
  },
  hiddenTab: {
    display: 'none' as any,
  },
});
