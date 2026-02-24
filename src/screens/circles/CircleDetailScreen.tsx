import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import { supabase } from '../../lib/supabase';
import ChatTab from './tabs/ChatTab';
import FeedTab from './tabs/FeedTab';
import MembersTab from './tabs/MembersTab';
import DiscordTab from './tabs/DiscordTab';
import ChallengesTab from './tabs/ChallengesTab';
import DigestTab from './tabs/DigestTab';
import OfficeTab, { AgentStats } from './tabs/OfficeTab';
import WalletTab from './tabs/WalletTab';
import ProfileTab from './tabs/ProfileTab';
import { Circle } from '../../types';
import ErrorBoundary from '../../components/ErrorBoundary';

const TAB_META: { key: string; label: string; icon: string }[] = [
  { key: 'CHAT', label: 'Chat', icon: '💬' },
  { key: 'OFFICE', label: 'Office', icon: '🏢' },
  { key: 'FEED', label: 'Feed', icon: '📋' },
  { key: 'CHALLENGES', label: 'Challenges', icon: '🏆' },
  { key: 'MEMBERS', label: 'Members', icon: '👥' },
  { key: 'DIGEST', label: 'Digest', icon: '📊' },
  { key: 'DISCORD', label: 'Discord', icon: '🎮' },
  { key: 'WALLET', label: 'Wallet', icon: '💰' },
  { key: 'PROFILE', label: 'Profile', icon: '👤' },
];

const TABS = TAB_META.map(t => t.key) as readonly string[];
type Tab = string;

export default function CircleDetailScreen({ route, navigation }: any) {
  const { circleId, circleName } = route.params;
  const [activeTab, setActiveTab] = useState<Tab>('CHAT');
  const [circle, setCircle] = useState<Circle | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [activeStreakCount, setActiveStreakCount] = useState(0);
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 700;
  const [onlineMembers, setOnlineMembers] = useState(0);
  const [loading, setLoading] = useState(true);
  const [agentStats, setAgentStats] = useState<AgentStats>({ agentCount: 0, sessionCount: 0, costToday: 0, costWeek: 0, tokens: 0 });

  useEffect(() => {
    loadCircleData();
  }, [circleId]);

  const loadCircleData = async () => {
    try {
      const { data: circleData } = await supabase
        .from('circles')
        .select('*')
        .eq('id', circleId)
        .single();
      if (circleData) setCircle(circleData);

      const { data: memberData } = await supabase
        .from('circle_members')
        .select('user_id')
        .eq('circle_id', circleId);
      if (memberData) {
        setMemberCount(memberData.length);
        setOnlineMembers(Math.max(1, Math.floor(memberData.length * 0.5)));
        setActiveStreakCount(Math.max(1, Math.floor(memberData.length * 0.7)));
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
              <View style={[styles.typeBadge, { backgroundColor: accentColor + '18', borderColor: accentColor + '40' }]}>
                <Text style={[styles.typeText, { color: accentColor }]}>
                  {typeLabels[circleType] || 'CUSTOM'}
                </Text>
              </View>
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
                <Text style={styles.statNum}>{agentStats.tokens > 0 ? (agentStats.tokens > 1000 ? `${(agentStats.tokens / 1000).toFixed(0)}K` : agentStats.tokens) : '—'}</Text>
                <Text style={styles.statLbl}>Tokens</Text>
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

      {/* Content — keep tabs mounted so state persists */}
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
      <View style={[styles.tabContent, activeTab !== 'FEED' && styles.hiddenTab]}>
        <ErrorBoundary>
          <FeedTab circleId={circleId} />
        </ErrorBoundary>
      </View>
      <View style={[styles.tabContent, activeTab !== 'CHALLENGES' && styles.hiddenTab]}>
        <ErrorBoundary>
          <ChallengesTab circleId={circleId} />
        </ErrorBoundary>
      </View>
      <View style={[styles.tabContent, activeTab !== 'MEMBERS' && styles.hiddenTab]}>
        <ErrorBoundary>
          <MembersTab circleId={circleId} />
        </ErrorBoundary>
      </View>
      <View style={[styles.tabContent, activeTab !== 'DIGEST' && styles.hiddenTab]}>
        <ErrorBoundary>
          <DigestTab circleId={circleId} />
        </ErrorBoundary>
      </View>
      <View style={[styles.tabContent, activeTab !== 'DISCORD' && styles.hiddenTab]}>
        <ErrorBoundary>
          <DiscordTab circleId={circleId} />
        </ErrorBoundary>
      </View>
      <View style={[styles.tabContent, activeTab !== 'WALLET' && styles.hiddenTab]}>
        <ErrorBoundary>
          <WalletTab circleId={circleId} />
        </ErrorBoundary>
      </View>
      <View style={[styles.tabContent, activeTab !== 'PROFILE' && styles.hiddenTab]}>
        <ErrorBoundary>
          <ProfileTab circleId={circleId} navigation={navigation} />
        </ErrorBoundary>
      </View>
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
    backgroundColor: '#0a0a0a',
  },
  loadingText: {
    color: '#888',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 2,
  },

  // Header
  header: {
    paddingTop: Platform.OS === 'web' ? 16 : 56,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
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
    paddingHorizontal: 16,
    paddingBottom: 10,
    gap: 10,
  },

  // Back
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff08',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  backText: {
    color: '#888',
    fontSize: 20,
  },

  // Circle Identity — centered
  circleIdentity: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  circleName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.5,
    flexShrink: 1,
  },
  typeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  typeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Stats Row — centered, evenly spaced
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    gap: 16,
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginHorizontal: 16,
    backgroundColor: '#ffffff04',
    borderRadius: 12,
    marginBottom: 8,
  },
  stat: {
    alignItems: 'center',
    gap: 3,
    minWidth: 50,
  },
  statNum: {
    color: '#ccc',
    fontSize: 14,
    fontWeight: '700',
  },
  statLbl: {
    color: '#888',
    fontSize: 10,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#ffffff0a',
  },

  // Icon Bubble
  iconBubble: {
    width: 36,
    height: 36,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  iconText: {
    fontSize: 18,
  },
  gearBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#ffffff08',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  gearText: {
    fontSize: 16,
  },

  // Tab Bar wrapper with arrows
  tabBarWrapper: {
    position: 'relative' as any,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tabBarScroll: {
    flex: 1,
  },

  // Tab Bar — desktop
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 6,
  },

  // Tab Bar — mobile: scrollable with padding
  tabBarMobile: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },

  // Arrow buttons
  tabArrow: {
    width: 28,
    height: 36,
    alignItems: 'center' as any,
    justifyContent: 'center' as any,
    backgroundColor: '#0a0a0a',
    zIndex: 10,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  tabArrowLeft: {},
  tabArrowRight: {},
  tabArrowText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#888',
  },

  // Fade gradients on edges
  tabFade: {
    position: 'absolute' as any,
    top: 0,
    bottom: 0,
    width: 24,
    zIndex: 5,
    pointerEvents: 'none' as any,
  },
  tabFadeLeft: {
    left: 28,
    ...(Platform.OS === 'web' ? { background: 'linear-gradient(to right, #0a0a0a, transparent)' } as any : {}),
  },
  tabFadeRight: {
    right: 28,
    ...(Platform.OS === 'web' ? { background: 'linear-gradient(to left, #0a0a0a, transparent)' } as any : {}),
  },

  // Tab pill style (replaces old underline tabs and hamburger menu)
  tabPill: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 44,
    gap: 6,
    ...(Platform.OS === 'web' ? { transition: 'all 0.2s ease', cursor: 'pointer' } as any : {}),
  },
  tabPillMobile: {
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  tabPillIcon: {
    fontSize: 16,
  },
  tabPillText: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // Tab content
  tabContent: {
    flex: 1,
  },
  hiddenTab: {
    display: 'none' as any,
  },
});
