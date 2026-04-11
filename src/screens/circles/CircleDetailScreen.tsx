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
import MissionsTab from './tabs/MissionsTab';
import FloatingChat from '../../components/FloatingChat';
import TutorialController from '../../components/onboarding/TutorialController';

import { Circle } from '../../types';
import ErrorBoundary from '../../components/ErrorBoundary';
import { LoadingScreen } from '../../components/LoadingWave';

// ─── Inject CSS animation for tab dot pulse (web only) ───────────────────
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('uc-tab-dot-css')) {
  const style = document.createElement('style');
  style.id = 'uc-tab-dot-css';
  style.textContent = `
    @keyframes uc-tab-dot-pulse {
      0%, 100% { transform: scaleX(1); opacity: 0.8; }
      50% { transform: scaleX(1.4); opacity: 1; }
    }
    .uc-tab-dot { animation: uc-tab-dot-pulse 2s ease-in-out infinite; }
  `;
  document.head.appendChild(style);
}

// Core tabs (Chat, Office, Rooms) always mounted; secondary tabs lazy-mount on first visit

// Gated tabs — hidden from nav until the feature is complete (see docs/NEXT_LEVEL_PLAN.md Phase 0.3)
const GATED_TABS = new Set(['WALLET']);

const TAB_META_ALL: { key: string; label: string; icon: string; flatIcon?: string; color: string }[] = [
  { key: 'CHAT', label: 'Chat', icon: '💬', flatIcon: 'chat', color: '#22c55e' },
  { key: 'OFFICE', label: 'Office', icon: '🏢', flatIcon: 'office', color: '#6366f1' },
  { key: 'FEED', label: 'Feed', icon: '🎯', flatIcon: 'feed', color: '#f59e0b' },
  { key: 'ROOMS', label: 'Rooms', icon: '🏠', flatIcon: 'rooms', color: '#a855f7' },
  { key: 'BACKPACK', label: 'Backpack', icon: '🎒', flatIcon: 'backpack', color: '#ec4899' },
  { key: 'INTEGRATIONS', label: 'Integrations', icon: '🔗', flatIcon: 'integrations', color: '#3b82f6' },
  { key: 'CHALLENGES', label: 'Challenges', icon: '🏆', flatIcon: 'challenges', color: '#ef4444' },
  { key: 'MEMBERS', label: 'Members', icon: '👥', flatIcon: 'members', color: '#14b8a6' },
  { key: 'ANALYTICS', label: 'Analytics', icon: '📊', flatIcon: 'analytics', color: '#22d3ee' },
  { key: 'WALLET', label: 'Wallet', icon: '💰', flatIcon: 'wallet', color: '#f97316' },
  { key: 'PROFILE', label: 'Profile', icon: '👤', flatIcon: 'profile', color: '#8b5cf6' },
];

const TAB_META = TAB_META_ALL.filter(t => !GATED_TABS.has(t.key));

const TABS = TAB_META.map(t => t.key) as readonly string[];
type Tab = string;

// Persist active tab per circle across refreshes
const TAB_STORAGE_KEY = 'uc_active_tab';
function loadSavedTab(circleId: string): Tab {
  try {
    if (Platform.OS === 'web') {
      // 1. Check clean URL path: /circle/:id/:tab
      try {
        const parts = window.location.pathname.split('/');
        // Expected: ['', 'circle', circleId, tabSlug]
        if (parts.length >= 4 && parts[1] === 'circle') {
          const urlTab = parts[3].toUpperCase();
          if (TABS.includes(urlTab)) return urlTab;
        }
      } catch {}
      // 2. Legacy: check ?tab= query param
      try {
        const urlTab = new URLSearchParams(window.location.search).get('tab')?.toUpperCase();
        if (urlTab && TABS.includes(urlTab)) return urlTab;
      } catch {}
      // 3. Fall back to localStorage
      const raw = localStorage.getItem(`${TAB_STORAGE_KEY}_${circleId}`);
      if (raw && TABS.includes(raw)) return raw;
    }
  } catch {}
  return 'OFFICE';
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
const CIRCLE_CACHE_VERSION = 1;
const CIRCLE_CACHE_TTL_MS = 300_000; // 5 minutes
function loadCachedCircle(circleId: string): { circle: Circle | null; memberCount: number } {
  try {
    if (Platform.OS === 'web') {
      const raw = localStorage.getItem(`${CIRCLE_CACHE_KEY}_${circleId}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.version !== CIRCLE_CACHE_VERSION) return { circle: null, memberCount: 0 };
        if (!parsed.savedAt || Date.now() - parsed.savedAt > CIRCLE_CACHE_TTL_MS) return { circle: null, memberCount: 0 };
        return { circle: parsed.circle, memberCount: parsed.memberCount };
      }
    }
  } catch {}
  return { circle: null, memberCount: 0 };
}
function cacheCircle(circleId: string, circle: Circle, memberCount: number) {
  try {
    if (Platform.OS === 'web') {
      localStorage.setItem(`${CIRCLE_CACHE_KEY}_${circleId}`, JSON.stringify({ version: CIRCLE_CACHE_VERSION, savedAt: Date.now(), circle, memberCount }));
    }
  } catch {}
}

export default function CircleDetailScreen({ route, navigation }: any) {
  const { circleId, circleName, tab: routeTab } = route.params;
  const [activeTab, setActiveTabRaw] = useState<Tab>(() => {
    // Route param takes priority (from CMD+K, deep links, programmatic navigation)
    if (routeTab && TABS.includes(routeTab.toUpperCase())) return routeTab.toUpperCase();
    return loadSavedTab(circleId);
  });
  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabRaw(tab);
    saveTab(circleId, tab);
    // Sync tab to URL — clean path: /circle/:id/:tab
    if (Platform.OS === 'web') {
      try {
        const tabSlug = tab.toLowerCase();
        const cleanPath = `/circle/${circleId}/${tabSlug}`;
        document.title = `${tab.charAt(0) + tab.slice(1).toLowerCase()} - ${circleName || 'Circle'}`;
        window.history.replaceState({}, '', cleanPath);
      } catch {}
    }
  }, [circleId, circleName]);

  // When route params change (CMD+K, deep link), switch to the requested tab
  const tabTs = route.params?._tabTs;
  useEffect(() => {
    if (routeTab) {
      const upper = routeTab.toUpperCase();
      if (TABS.includes(upper)) setActiveTab(upper);
    }
  }, [routeTab, tabTs, setActiveTab]);
  const cached = loadCachedCircle(circleId);
  const [circle, setCircle] = useState<Circle | null>(cached.circle);
  const [memberCount, setMemberCount] = useState(cached.memberCount);
  const [activeStreakCount, setActiveStreakCount] = useState(Math.max(1, Math.floor((cached.memberCount || 1) * 0.7)));
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 700;
  const [onlineMembers, setOnlineMembers] = useState(Math.max(1, Math.floor((cached.memberCount || 1) * 0.5)));
  // Chat pop-out state — renders FloatingChat overlay that persists across tabs
  const [chatPopout, setChatPopout] = useState(false);
  const [chatMountKey, setChatMountKey] = useState(0);

  // Loading gate: show loading screen until circle data + Office tab are both ready
  const [circleLoaded, setCircleLoaded] = useState(!!cached.circle);
  const [officeReady, setOfficeReady] = useState(false);
  const loading = !circleLoaded || !officeReady;

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
      // Smart default: if user has no saved tab and circle has missions, show FEED (missions live in Feed now)
      try {
        const hasSavedTab = Platform.OS === 'web' && localStorage.getItem(`${TAB_STORAGE_KEY}_${circleId}`);
        if (!hasSavedTab && !routeTab) {
          const { data: missions } = await supabase
            .from('circle_missions')
            .select('id', { count: 'exact' })
            .eq('circle_id', circleId)
            .eq('status', 'active')
            .limit(1);
          if (missions && missions.length > 0) {
            setActiveTab('FEED');
          }
        }
      } catch {}
    } catch (error) {
      console.error('Error loading circle data:', error);
    } finally {
      setCircleLoaded(true);
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

  // Office is always mounted eagerly so it can load behind the loading screen.
  // The onReady callback fires once Office has fetched its core data.
  const handleOfficeReady = useCallback(() => setOfficeReady(true), []);

  return (
    <View style={styles.container}>
      {/* Loading overlay — covers everything until circle data + Office are ready */}
      {loading && (
        <View style={styles.loadingOverlay}>
          <LoadingScreen />
        </View>
      )}

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <TabBarScroller
            tabs={TAB_META}
            activeTab={activeTab}
            accentColor={accentColor}
            isMobile={isMobile}
            onTabPress={setActiveTab}
          />
        </View>
      </View>

      {/* Pop-out button — visible when Chat tab is active and not already popped out */}
      {activeTab === 'CHAT' && !chatPopout && (
        <Pressable
          onPress={() => setChatPopout(true)}
          style={[styles.popoutBtn, { borderColor: accentColor + '40' }]}
          accessibilityRole="button"
          accessibilityLabel="Pop out chat to floating window"
        >
          <Text style={[styles.popoutBtnText, { color: accentColor }]}>{'\u29C9'}</Text>
        </Pressable>
      )}

      {/* Office — always mounted (eager), loads behind loading screen */}
      <View style={[styles.tabContent, activeTab !== 'OFFICE' && styles.hiddenTab]}>
        <ErrorBoundary>
          <OfficeTab circleId={circleId} accentColor={accentColor} onReady={handleOfficeReady} />
        </ErrorBoundary>
      </View>

      {/* Other tabs — lazy mount on first visit, stay mounted after */}
      {!chatPopout && (
        <LazyTab key={`chat-${chatMountKey}`} tabKey="CHAT" activeTab={activeTab}>
          <ChatTab circleId={circleId} accentColor={accentColor} />
        </LazyTab>
      )}
      <LazyTab tabKey="ROOMS" activeTab={activeTab}>
        <RoomsTab circleId={circleId} accentColor={accentColor} />
      </LazyTab>
      <LazyTab tabKey="BACKPACK" activeTab={activeTab}>
        <BackpackTab circleId={circleId} accentColor={accentColor} />
      </LazyTab>
      <LazyTab tabKey="FEED" activeTab={activeTab}>
        <FeedTab circleId={circleId} accentColor={accentColor} />
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
      {/* WALLET — gated (see docs/NEXT_LEVEL_PLAN.md Phase 0.3) */}
      {!GATED_TABS.has('WALLET') && (
        <LazyTab tabKey="WALLET" activeTab={activeTab}>
          <WalletTab circleId={circleId} />
        </LazyTab>
      )}
      <LazyTab tabKey="PROFILE" activeTab={activeTab}>
        <ProfileTab circleId={circleId} navigation={navigation} />
      </LazyTab>

      {/* Floating Chat — persists across all tabs when popped out */}
      {chatPopout && (
        <FloatingChat
          circleId={circleId}
          circleName={circleName || circle?.name || 'Circle'}
          accentColor={accentColor}
          onClose={() => { setChatPopout(false); setChatMountKey(k => k + 1); }}
        />
      )}

      {/* Onboarding Tutorial — floating guide for new users */}
      <TutorialController circleId={circleId} />
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

function TabPill({ icon, flatIcon, label, active, accentColor, tabColor, isMobile, onPress }: {
  icon: string; flatIcon?: string; label: string; active: boolean; accentColor: string; tabColor: string; isMobile: boolean; onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const color = active ? tabColor : accentColor;

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.tabPill,
        active && { backgroundColor: tabColor + '15', borderColor: tabColor + '50' },
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
        { color: active ? tabColor : hovered ? '#ccc' : '#888' },
        active && { fontWeight: '800' },
      ]}>
        {label}
      </Text>
      {/* Animated dot under active tab */}
      {active && (
        Platform.OS === 'web' ? (
          <div className="uc-tab-dot" style={{
            position: 'absolute', bottom: -1, width: 14, height: 4,
            borderRadius: 2, backgroundColor: tabColor,
          }} />
        ) : (
          <View style={[styles.tabDot, { backgroundColor: tabColor }]} />
        )
      )}
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

  // Desktop: show all tabs in a wrapping row (no scroll)
  if (!isMobile) {
    return (
      <View style={styles.tabBarWrapper}>
        <View style={styles.tabBarDesktopWrap}>
          {tabs.map((tab) => (
            <TabPill
              key={tab.key}
              icon={tab.icon}
              flatIcon={tab.flatIcon}
              label={tab.label}
              active={activeTab === tab.key}
              accentColor={accentColor}
              tabColor={tab.color}
              isMobile={false}
              onPress={() => onTabPress(tab.key)}
            />
          ))}
        </View>
      </View>
    );
  }

  // Mobile: horizontal scroll with arrows
  return (
    <View style={styles.tabBarWrapper}>
      {canScrollLeft && (
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
        contentContainerStyle={styles.tabBarMobile}
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
            tabColor={tab.color}
            isMobile={isMobile}
            onPress={() => onTabPress(tab.key)}
          />
        ))}
      </ScrollView>

      {/* Right arrow (mobile only) */}
      {canScrollRight && (
        <Pressable
          onPress={() => scrollBy(200)}
          style={[styles.tabArrow, styles.tabArrowRight]}
        >
          <Text style={styles.tabArrowText}>›</Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
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

  // Tab Bar — desktop: all tabs visible, wrapping if needed
  tabBarDesktopWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 4,
  },
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
  tabDot: {
    position: 'absolute' as any,
    bottom: -1,
    width: 14,
    height: 4,
    borderRadius: 2,
  },

  // Tab content
  tabContent: {
    flex: 1,
  },
  hiddenTab: {
    display: 'none' as any,
  },

  // Pop-out button
  popoutBtn: {
    position: 'absolute' as any,
    top: Platform.OS === 'web' ? 8 : 48,
    right: 12,
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1a1a28',
    backgroundColor: '#0a0a10',
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    zIndex: 50,
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'opacity 0.15s' } as any : {}),
  },
  popoutBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#a0a0b0',
    fontFamily: 'monospace',
  },
});
