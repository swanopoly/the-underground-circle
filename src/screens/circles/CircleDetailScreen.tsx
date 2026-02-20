import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  Animated,
  useWindowDimensions,
  ScrollView,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import ChatTab from './tabs/ChatTab';
import FeedTab from './tabs/FeedTab';
import MembersTab from './tabs/MembersTab';
import DiscordTab from './tabs/DiscordTab';
import ChallengesTab from './tabs/ChallengesTab';
import DigestTab from './tabs/DigestTab';
import OfficeTab from './tabs/OfficeTab';
import { Circle } from '../../types';

const TABS = ['CHAT', 'OFFICE', 'FEED', 'CHALLENGES', 'MEMBERS', 'DIGEST', 'DISCORD'] as const;
type Tab = typeof TABS[number];

export default function CircleDetailScreen({ route, navigation }: any) {
  const { circleId, circleName } = route.params;
  const [activeTab, setActiveTab] = useState<Tab>('CHAT');
  const [circle, setCircle] = useState<Circle | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [activeStreakCount, setActiveStreakCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const { width: winW } = useWindowDimensions();
  const isMobile = winW < 700;
  const [onlineMembers, setOnlineMembers] = useState(0);
  const [loading, setLoading] = useState(true);

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
              <Text style={styles.circleName}>
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
                <Text style={styles.statNum}>🤖 —</Text>
                <Text style={styles.statLbl}>Agents</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>—</Text>
                <Text style={styles.statLbl}>Sessions</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: '#555' }]}>$—</Text>
                <Text style={styles.statLbl}>Cost Today</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>$—</Text>
                <Text style={styles.statLbl}>Cost This Week</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: '#f59e0b' }]}>◎ —</Text>
                <Text style={styles.statLbl}>Treasury (SOL)</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={styles.statNum}>—</Text>
                <Text style={styles.statLbl}>Tokens</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <Text style={[styles.statNum, { color: '#555' }]}>⚙️ Connect</Text>
                <Text style={styles.statLbl}>in Office tab</Text>
              </View>
            </ScrollView>
          )}

          {/* Tab Bar — desktop: full row, mobile: active tab + hamburger */}
          {isMobile ? (
            <View style={styles.mobileTabRow}>
              <Text style={[styles.mobileActiveTab, { color: accentColor }]}>{activeTab}</Text>
              <Pressable
                onPress={() => setMenuOpen(!menuOpen)}
                style={[styles.hamburger, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
              >
                <Text style={styles.hamburgerText}>{menuOpen ? '✕' : '☰'}</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabBar}
            >
              {TABS.map((tab) => (
                <TabButton
                  key={tab}
                  label={tab}
                  active={activeTab === tab}
                  accentColor={accentColor}
                  onPress={() => setActiveTab(tab)}
                />
              ))}
            </ScrollView>
          )}
        </View>
      </View>

      {/* Mobile tab dropdown */}
      {isMobile && menuOpen && (
        <View style={styles.mobileMenu}>
          {TABS.map((tab) => (
            <Pressable
              key={tab}
              onPress={() => { setActiveTab(tab); setMenuOpen(false); }}
              style={[
                styles.mobileMenuItem,
                activeTab === tab && { backgroundColor: accentColor + '15', borderLeftColor: accentColor, borderLeftWidth: 3 },
                Platform.OS === 'web' && { cursor: 'pointer' } as any,
              ]}
            >
              <Text style={[
                styles.mobileMenuText,
                activeTab === tab && { color: accentColor, fontWeight: '800' },
              ]}>
                {tab === 'CHAT' ? '💬' : tab === 'OFFICE' ? '🏢' : tab === 'FEED' ? '📰' :
                 tab === 'CHALLENGES' ? '🏆' : tab === 'MEMBERS' ? '👥' : tab === 'DIGEST' ? '📊' : '🎮'} {tab}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* Content — keep tabs mounted so state persists */}
      <View style={[styles.tabContent, activeTab !== 'CHAT' && styles.hiddenTab]}>
        <ChatTab circleId={circleId} accentColor={accentColor} />
      </View>
      <View style={[styles.tabContent, activeTab !== 'OFFICE' && styles.hiddenTab]}>
        <OfficeTab circleId={circleId} accentColor={accentColor} />
      </View>
      <View style={[styles.tabContent, activeTab !== 'FEED' && styles.hiddenTab]}>
        <FeedTab circleId={circleId} />
      </View>
      <View style={[styles.tabContent, activeTab !== 'CHALLENGES' && styles.hiddenTab]}>
        <ChallengesTab circleId={circleId} />
      </View>
      <View style={[styles.tabContent, activeTab !== 'MEMBERS' && styles.hiddenTab]}>
        <MembersTab circleId={circleId} />
      </View>
      <View style={[styles.tabContent, activeTab !== 'DIGEST' && styles.hiddenTab]}>
        <DigestTab circleId={circleId} />
      </View>
      <View style={[styles.tabContent, activeTab !== 'DISCORD' && styles.hiddenTab]}>
        <DiscordTab circleId={circleId} />
      </View>
    </View>
  );
}

// ─── Back Button with hover ──────────────────────────────────────────────────

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
    >
      <Text style={[styles.backText, hovered && { color: accentColor }]}>←</Text>
    </Pressable>
  );
}

// ─── Tab Button with hover + underline ───────────────────────────────────────

function TabButton({ label, active, accentColor, onPress }: {
  label: string; active: boolean; accentColor: string; onPress: () => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={[
        styles.tab,
        active && { borderBottomColor: accentColor },
        hovered && !active && { borderBottomColor: '#333', backgroundColor: '#ffffff06' },
      ]}
    >
      <Text style={[
        styles.tabText,
        { color: active ? accentColor : '#555' },
        active && { fontWeight: '800' },
        hovered && !active && { color: '#888' },
      ]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  loadingText: {
    color: '#333',
    fontSize: 12,
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
    paddingHorizontal: 12,
    paddingBottom: 10,
    gap: 10,
  },

  // Back
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff08',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  backText: {
    color: '#666',
    fontSize: 17,
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
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
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
    color: '#555',
    fontSize: 9,
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: '#ffffff0a',
  },
  onlineWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22c55e',
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
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff08',
    justifyContent: 'center',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.2s ease' } as any : {}),
  },
  gearText: {
    fontSize: 14,
  },

  // Tab Bar — centered, spacious
  tabBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 4,
    flexGrow: 1,
  },
  tab: {
    paddingVertical: 12,
    paddingHorizontal: 18,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    ...(Platform.OS === 'web' ? { transition: 'all 0.2s ease', cursor: 'pointer' } as any : {}),
  },
  tabText: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1,
  },

  // Mobile tab row
  mobileTabRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  mobileActiveTab: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 2,
  },
  hamburger: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#ffffff08',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hamburgerText: {
    color: '#888',
    fontSize: 18,
  },
  mobileMenu: {
    backgroundColor: '#0d0d12',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingVertical: 4,
    zIndex: 100,
  },
  mobileMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 20,
  },
  mobileMenuText: {
    fontSize: 13,
    color: '#777',
    fontFamily: 'monospace',
    fontWeight: '600',
    letterSpacing: 1,
  },

  // Tab content
  tabContent: {
    flex: 1,
  },
  hiddenTab: {
    display: 'none' as any,
  },
});
