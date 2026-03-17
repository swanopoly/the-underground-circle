import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import ChatTab from './tabs/ChatTab';
import OfficeTab from './tabs/OfficeTab';

// Lazy-load all non-chat/office tabs — only mount when user navigates to them
const FeedTab = lazy(() => import('./tabs/FeedTab'));
const MembersTab = lazy(() => import('./tabs/MembersTab'));
const ChallengesTab = lazy(() => import('./tabs/ChallengesTab'));
const WalletTab = lazy(() => import('./tabs/WalletTab'));
const ProfileTab = lazy(() => import('./tabs/ProfileTab'));
const RoomsTab = lazy(() => import('./tabs/RoomsTab'));
const AnalyticsTab = lazy(() => import('./tabs/AnalyticsTab'));
const IntegrationsTab = lazy(() => import('./tabs/IntegrationsTab'));
const BackpackTab = lazy(() => import('./tabs/BackpackTab'));

import { Circle } from '../../types';
import ErrorBoundary from '../../components/ErrorBoundary';

/** Mirrors OfficeTab's AgentStats — inlined to avoid importing from lazy module */
interface AgentStats {
  agentCount: number;
  sessionCount: number;
  costToday: number;
  costWeek: number;
  tokens: number;
  tokensTotal: number;
  messagesTotal: number;
}

// Chat + Office stay mounted permanently; other tabs mount on first visit
const PERSISTENT_TABS = new Set(['CHAT', 'OFFICE']);

const TAB_META: { key: string; label: string; icon: string }[] = [
  { key: 'CHAT', label: 'Chat', icon: '💬' },
  { key: 'OFFICE', label: 'Office', icon: '🏢' },
  { key: 'ROOMS', label: 'Rooms', icon: '🏠' },
  { key: 'BACKPACK', label: 'Backpack', icon: '🎒' },
  { key: 'FEED', label: 'Feed', icon: '📋' },
  { key: 'WALLET', label: 'Wallet', icon: '💰' },
  { key: 'INTEGRATIONS', label: 'Integrations', icon: '🔗' },
  { key: 'CHALLENGES', label: 'Challenges', icon: '🏆' },
  { key: 'MEMBERS', label: 'Members', icon: '👥' },
  { key: 'ANALYTICS', label: 'Analytics', icon: '📊' },
  { key: 'PROFILE', label: 'Profile', icon: '👤' },
];

const TABS = TAB_META.map(t => t.key) as readonly string[];
type Tab = string;

export default function CircleDetailScreen({ route, navigation }: any) {
  const { circleId, circleName } = route.params;
  const [activeTab, setActiveTab] = useState<Tab>('OFFICE');
  const [circle, setCircle] = useState<Circle | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [activeStreakCount, setActiveStreakCount] = useState(0);
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 700;
  const [onlineMembers, setOnlineMembers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [agentStats, setAgentStats] = useState<AgentStats>({ agentCount: 0, sessionCount: 0, costToday: 0, costWeek: 0, tokens: 0, tokensTotal: 0, messagesTotal: 0 });

  useEffect(() => {
    loadCircleData();
    loadAgentStats();
  }, [circleId]);

  // Load agent stats immediately from DB (don't wait for Office tab)
  const loadAgentStats = async () => {
    try {
      const { data: agents } = await supabase
        .from('circle_office_agents')
        .select('id, status, token_usage_today, token_usage_total, message_count_today, message_count_total')
        .eq('circle_id', circleId);
      if (agents && agents.length > 0) {
        setAgentStats({
          agentCount: agents.length,
          sessionCount: agents.filter((a: any) => a.status !== 'offline').length,
          costToday: agents.reduce((s: number, a: any) => s + (a.token_usage_today || 0), 0) * 0.0000005,
          costWeek: 0,
          tokens: agents.reduce((s: number, a: any) => s + (a.token_usage_today || 0), 0),
          tokensTotal: agents.reduce((s: number, a: any) => s + (a.token_usage_total || 0), 0),
          messagesTotal: agents.reduce((s: number, a: any) => s + (a.message_count_total || 0), 0),
        });
      }
    } catch {}
  };

  // Realtime subscription for agent stats updates
  useEffect(() => {
    const channel = supabase
      .channel(`circle-agent-stats-${circleId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'circle_office_agents',
        filter: `circle_id=eq.${circleId}`,
      }, () => {
        // Reload stats whenever an agent is updated (token counts changed)
        loadAgentStats();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [circleId]);


  const loadCircleData = async () => {
    try {
      const [circleRes, memberRes] = await Promise.all([
        supabase.from('circles').select('*').eq('id', circleId).single(),
        supabase.from('circle_members').select('user_id').eq('circle_id', circleId),
      ]);
      if (circleRes.data) setCircle(circleRes.data);
      if (memberRes.data) {
        setMemberCount(memberRes.data.length);
        setOnlineMembers(Math.max(1, Math.floor(memberRes.data.length * 0.5)));
        setActiveStreakCount(Math.max(1, Math.floor(memberRes.data.length * 0.7)));
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
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <Text style={styles.loadingText}>LOADING...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          {/* Top row: back + circle info + actions */}
          <View style={styles.headerRow}>
            <BackButton onPress={() => navigation.goBack()} accentColor={accentColor} />

            <View style={styles.circleIdentity}>
              <Text style={styles.circleName} numberOfLines={1}>
                {(circle?.name || circleName)?.toUpperCase()}
              </Text>
            </View>

            <Pressable
              onPress={() => navigation.navigate('CircleSettings', { circleId })}
              style={styles.gearBtn}
              accessibilityLabel="Circle settings"
              accessibilityRole="button"
            >
              <Text style={styles.gearText}>⚙️</Text>
            </Pressable>
          </View>

          {/* DAO / Agent Dashboard Bar — desktop only */}
          {!isMobile && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.statsRow}>
              <View style={styles.stat}>
                <Pressable
                  onPress={() => navigation.navigate('CircleSettings', { circleId })}
                  style={[styles.iconBubble, { backgroundColor: accentColor + '20', borderColor: accentColor + '50' }]}
                >
                  <Text style={styles.iconText}>{circleIcon}</Text>
                </Pressable>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>🤖 {agentStats.agentCount || '—'}</Text>
                <Text style={styles.statLbl}>Agents</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>{agentStats.sessionCount || '—'}</Text>
                <Text style={styles.statLbl}>Sessions</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: agentStats.costToday > 0 ? '#22c55e' : '#888' }]}>${agentStats.costToday > 0 ? agentStats.costToday.toFixed(2) : '—'}</Text>
                <Text style={styles.statLbl}>Cost Today</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>${agentStats.costWeek > 0 ? agentStats.costWeek.toFixed(2) : '—'}</Text>
                <Text style={styles.statLbl}>Cost This Week</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: '#f59e0b' }]}>◎ —</Text>
                <Text style={styles.statLbl}>Treasury (SOL)</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: '#f59e0b' }]}>{agentStats.tokensTotal > 0 ? (agentStats.tokensTotal > 1_000_000 ? `${(agentStats.tokensTotal / 1_000_000).toFixed(1)}M` : agentStats.tokensTotal > 1000 ? `${(agentStats.tokensTotal / 1000).toFixed(0)}K` : agentStats.tokensTotal) : '—'}</Text>
                <Text style={styles.statLbl}>Total Tokens</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>{agentStats.messagesTotal > 0 ? agentStats.messagesTotal : '—'}</Text>
                <Text style={styles.statLbl}>Total Messages</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: agentStats.agentCount > 0 ? '#22c55e' : '#888' }]}>{agentStats.agentCount > 0 ? '● Live' : '⚙️ Connect'}</Text>
                <Text style={styles.statLbl}>{agentStats.agentCount > 0 ? 'OpenClaw' : 'in Office tab'}</Text>
              </View>
            </ScrollView>
          )}

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

      {/* Content — Chat & Office stay mounted; other tabs mount on first visit */}
      <View style={[styles.tabContent, activeTab !== 'CHAT' && styles.hiddenTab]}>
        <ErrorBoundary>
          <ChatTab circleId={circleId} accentColor={accentColor} />
        </ErrorBoundary>
      </View>

      <View style={[styles.tabContent, activeTab !== 'OFFICE' && styles.hiddenTab]}>
        <ErrorBoundary>
          <OfficeTab circleId={circleId} accentColor={accentColor} onAgentStats={setAgentStats} />
        </ErrorBoundary>
      </View>
      <LazyTab tabKey="ROOMS" activeTab={activeTab}>
        <RoomsTab circleId={circleId} accentColor={accentColor} />
      </LazyTab>
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

// ─── Lazy Tab — only mounts on first visit, stays mounted after ─────────────

const tabFallback = (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' }}>
    <ActivityIndicator color="#6366f1" size="small" />
  </View>
);

function LazyTab({ tabKey, activeTab, children }: { tabKey: string; activeTab: string; children: React.ReactNode }) {
  const [hasVisited, setHasVisited] = useState(PERSISTENT_TABS.has(tabKey));
  const isActive = activeTab === tabKey;

  useEffect(() => {
    if (isActive && !hasVisited) setHasVisited(true);
  }, [isActive, hasVisited]);

  if (!hasVisited) return null;

  return (
    <View style={[styles.tabContent, !isActive && styles.hiddenTab]}>
      <ErrorBoundary>
        <Suspense fallback={tabFallback}>
          {children}
        </Suspense>
      </ErrorBoundary>
    </View>
  );
}

// ─── Back Button ──────────────────────────────────────────────────

function BackButton({ onPress, accentColor }: { onPress: () => void; accentColor: string }) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.backBtn,
        hovered && { backgroundColor: accentColor + '20', borderColor: accentColor + '60' },
      ]}
      accessibilityLabel="Go back"
      accessibilityRole="button"
    >
      <Text style={[styles.backText, hovered && { color: accentColor }]}>←</Text>
    </Pressable>
  );
}

// ─── Tab Pill ───────────────────────────────────────────────────────

function TabPill({ icon, label, active, accentColor, isMobile, onPress }: {
  icon: string; label: string; active: boolean; accentColor: string; isMobile: boolean; onPress: () => void;
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
      <Text style={styles.tabPillIcon}>{icon}</Text>
      <Text style={[
        styles.tabPillText,
        { color: active ? accentColor : '#888' },
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    paddingBottom: 2,
    gap: 6,
  },

  // Back
  backBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff08',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  backText: {
    color: '#888',
    fontSize: 16,
  },

  // Circle Identity — centered
  circleIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  circleName: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  typeBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
  },
  typeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Stats Row — centered, evenly spaced
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 1,
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 16,
    marginHorizontal: 10,
    backgroundColor: '#ffffff04',
    borderRadius: 8,
    marginBottom: 4,
  },
  stat: {
    alignItems: 'center',
    gap: 2,
    minWidth: 40,
  },
  statNum: {
    color: '#ccc',
    fontSize: 12,
    fontWeight: '700',
  },
  statLbl: {
    color: '#888',
    fontSize: 9,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 20,
    backgroundColor: '#ffffff0a',
  },

  // Icon Bubble
  iconBubble: {
    width: 28,
    height: 28,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  iconText: {
    fontSize: 14,
  },
  gearBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff08',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  gearText: {
    fontSize: 14,
  },

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
