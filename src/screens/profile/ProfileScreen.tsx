import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  ScrollView,
  Animated,
  Modal,
  TextInput,
  FlatList,
  useWindowDimensions,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { safeGetUser } from '../../lib/authSession';
import { User, Achievement, UserAchievement, XPEvent, Integration, AgentBot, Friend } from '../../types';
import Card from '../../components/Card';
import Button from '../../components/Button';
import {
  getUserXP,
  getUserAchievements,
  getAllAchievements,
  getLevelInfo,
  getLeaderboard,
  getRecentXPEvents,
  checkAndUnlockAchievements,
} from '../../lib/gamification';
import { getUserIntegrations, platformConnections, getFriends } from '../../lib/integrations';
import { getUserAgents } from '../../lib/agents';
import { useUserApiKeys, type LLMProvider } from '../../lib/llmProviders';
import MentionsInbox from '../../components/MentionsInbox';
import { getLastProfileCircle, navigateToUnifiedProfile } from '../../lib/profileNavigation';

const fmt = (n: number) => n.toLocaleString();

// Display metadata for connected LLM providers — kept here so the
// profile chips don't depend on the marketplace component layout. If
// you add a provider to LLMProvider in lib/llmProviders.ts, add it here
// too so the chip shows a proper label/glyph instead of the raw id.
const LLM_PROVIDER_META: Partial<Record<LLMProvider, { label: string; glyph: string; accent: string }>> = {
  anthropic:       { label: 'Anthropic',     glyph: 'A', accent: '#d97706' },
  openai:          { label: 'OpenAI',        glyph: 'O', accent: '#10a37f' },
  openrouter:      { label: 'OpenRouter',    glyph: 'R', accent: '#7c3aed' },
  groq:            { label: 'Groq',          glyph: 'Q', accent: '#f97316' },
  huggingface:     { label: 'Hugging Face',  glyph: 'H', accent: '#ffbd45' },
  replicate:       { label: 'Replicate',     glyph: 'P', accent: '#475569' },
  ollama:          { label: 'Ollama',        glyph: 'L', accent: '#5b21b6' },
  zai:             { label: 'Z.AI / GLM',    glyph: 'Z', accent: '#0ea5e9' },
  minimax:         { label: 'MiniMax',       glyph: 'M', accent: '#ec4899' },
  'github-models': { label: 'GitHub Models', glyph: 'G', accent: '#6e7681' },
};

// ── Hero aura: rotating conic-gradient border + layered 3D shadows ──────────
// Injected once into <head> on web. Uses @property to animate the gradient's
// `--ang` angle smoothly without rotating child content. Falls back to a
// static gradient on browsers without @property support (Firefox <128 etc.) —
// border still looks right, just doesn't spin.
const HERO_AURA_STYLE_ID = 'uc-profile-hero-aura-css';
function ensureHeroAuraStyle() {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  if (document.getElementById(HERO_AURA_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = HERO_AURA_STYLE_ID;
  style.textContent = `
    @property --uc-aura-ang {
      syntax: '<angle>';
      initial-value: 0deg;
      inherits: false;
    }
    .uc-profile-hero-aura {
      position: relative;
      border-radius: 22px;
      padding: 2px;
      background: conic-gradient(
        from var(--uc-aura-ang, 0deg),
        #6366f1, #ec4899, #f59e0b, #22d3ee,
        #a855f7, #06b6d4, #6366f1
      );
      animation: uc-aura-rotate 8s linear infinite;
      box-shadow:
        0 30px 60px -20px rgba(99, 102, 241, 0.45),
        0 18px 40px -16px rgba(236, 72, 153, 0.35),
        0 0 80px -10px rgba(34, 211, 238, 0.18),
        0 1px 0 rgba(255, 255, 255, 0.04) inset;
      transform: perspective(1400px) rotateX(1.5deg);
      will-change: --uc-aura-ang, transform;
    }
    .uc-profile-hero-aura::after {
      /* Soft outer glow that breathes with the border */
      content: '';
      position: absolute;
      inset: -8px;
      border-radius: 28px;
      padding: 8px;
      background: conic-gradient(
        from var(--uc-aura-ang, 0deg),
        #6366f140, #ec489940, #f59e0b40, #22d3ee40,
        #a855f740, #06b6d440, #6366f140
      );
      filter: blur(14px);
      opacity: 0.55;
      z-index: -1;
      pointer-events: none;
    }
    .uc-profile-hero-inner {
      position: relative;
      border-radius: 20px;
      background: linear-gradient(180deg, #0a0a0f 0%, #050508 100%);
      overflow: hidden;
    }
    @keyframes uc-aura-rotate {
      to { --uc-aura-ang: 360deg; }
    }
    @media (prefers-reduced-motion: reduce) {
      .uc-profile-hero-aura {
        animation: none;
      }
    }
  `;
  document.head.appendChild(style);
}

function getLevelColor(level: number): string {
  if (level >= 50) return '#fbbf24'; // gold
  if (level >= 30) return '#a855f7'; // purple
  if (level >= 15) return '#3b82f6'; // blue
  if (level >= 5) return '#22c55e'; // green
  return '#6f6f6f'; // gray
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function getEventEmoji(type: string): string {
  const map: Record<string, string> = {
    check_in: '🔥',
    task_complete: '✅',
    circle_join: '🤝',
    circle_create: '🏗️',
    upvote_received: '👍',
    streak_bonus: '⚡',
    badge_earned: '🏅',
    daily_login: '📅',
  };
  return map[type] || '✨';
}

function getEventLabel(type: string): string {
  const map: Record<string, string> = {
    check_in: 'Daily Check-in',
    task_complete: 'Task Completed',
    circle_join: 'Joined Circle',
    circle_create: 'Created Circle',
    upvote_received: 'Upvote Received',
    streak_bonus: 'Streak Bonus',
    badge_earned: 'Achievement Unlocked',
    daily_login: 'Daily Login',
  };
  return map[type] || type;
}

export default function ProfileScreen({ navigation, route }: any) {
  const [profile, setProfile] = useState<User | null>(null);
  const [grindKarma, setGrindKarma] = useState(0);
  const [socialKarma, setSocialKarma] = useState(0);
  const [totalCheckIns, setTotalCheckIns] = useState(0);
  const [circlesJoined, setCirclesJoined] = useState(0);
  const [allBadges, setAllBadges] = useState<Achievement[]>([]);
  const [userBadges, setUserBadges] = useState<UserAchievement[]>([]);
  const [recentActivity, setRecentActivity] = useState<XPEvent[]>([]);
  const [rank, setRank] = useState<number | null>(null);
  const [totalUsers, setTotalUsers] = useState(0);
  const [selectedBadge, setSelectedBadge] = useState<(Achievement & { unlocked_at?: string }) | null>(null);
  const [editingBio, setEditingBio] = useState(false);
  const [bioText, setBioText] = useState('');
  
  // New state for customizable features
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [agents, setAgents] = useState<AgentBot[]>([]);
  // Connected LLM provider keys — surfaced as a "AI MODELS" strip
  // alongside connected accounts so users can see at a glance which
  // models their agents will route to.
  const { keys: apiKeys, isLoading: apiKeysLoading } = useUserApiKeys();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  
  const xpAnim = useRef(new Animated.Value(0)).current;

  const xp = profile?.xp || 0;
  const levelInfo = getLevelInfo(xp);
  const themeColor = profile?.theme_color || '#6366f1';
  const levelColor = getLevelColor(levelInfo.level);

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    if (!route?.name) return;
    if (route.name !== 'Profile') return;
    const lastCircle = getLastProfileCircle();
    if (lastCircle?.circleId) {
      navigation.replace?.('CircleDetail', {
        circleId: lastCircle.circleId,
        circleName: lastCircle.circleName || undefined,
      });
      return;
    }
    if (navigateToUnifiedProfile(navigation, { replace: true })) return;
    navigation.replace?.('CirclesList');
  }, [navigation, route?.name]);

  // If AppHeader set the focus flag (unread mentions badge tap), scroll to
  // the MentionsInbox once it has mounted. Poll a few frames because the
  // inbox renders below other async data. Uses scrollIntoView via the DOM id
  // mirrored from nativeID="section-mentions-inbox" on web.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return;
    let flag: string | null = null;
    try { flag = window.localStorage.getItem('uc_focus_mentions_inbox'); } catch {}
    if (!flag) return;
    let tries = 0;
    let raf: any;
    const tryScroll = () => {
      const el = document.getElementById('section-mentions-inbox');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try { window.localStorage.removeItem('uc_focus_mentions_inbox'); } catch {}
        return;
      }
      if (tries++ < 60) raf = requestAnimationFrame(tryScroll);
    };
    raf = requestAnimationFrame(tryScroll);
    return () => { if (raf) cancelAnimationFrame(raf); };
  }, []);

  useEffect(() => {
    Animated.timing(xpAnim, {
      toValue: levelInfo.progress,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [levelInfo.progress]);

  const loadAll = async () => {
    const { value: user } = await safeGetUser();
    if (!user) return;

    const { data: profileData } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .single();
    if (profileData) {
      setProfile(profileData);
      setBioText(profileData.bio || '');
    }

    const userXP = await getUserXP(user.id);
    if (userXP) {
      setGrindKarma(userXP.grind_karma);
      setSocialKarma(userXP.social_karma);
    }

    const { count: checkInCount } = await supabase
      .from('xp_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('event_type', 'check_in');
    setTotalCheckIns(checkInCount || 0);

    const { count: circleCount } = await supabase
      .from('circle_members')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id);
    setCirclesJoined(circleCount || 0);

    const [badges, uBadges, activity] = await Promise.all([
      getAllAchievements(),
      getUserAchievements(user.id),
      getRecentXPEvents(user.id, 10),
    ]);
    setAllBadges(badges);
    setUserBadges(uBadges);
    setRecentActivity(activity);

    // Load new customizable features
    try {
      const [integrationsData, agentsData, friendsData] = await Promise.all([
        getUserIntegrations(user.id),
        getUserAgents(),
        getFriends(),
      ]);
      setIntegrations(integrationsData);
      setAgents(agentsData);
      setFriends(friendsData);
    } catch (error) {
      console.error('Error loading customizable features:', error);
    }

    // Check for new achievements
    checkAndUnlockAchievements(user.id).catch(console.error);

    // Get rank
    const leaderboard = await getLeaderboard(undefined, 50);
    const idx = leaderboard.findIndex((l) => l.user_id === user.id);
    setRank(idx >= 0 ? idx + 1 : null);
    setTotalUsers(leaderboard.length);
  };

  const handleSignOut = async () => {
    if (Platform.OS === 'web') {
      if (window.confirm('You sure you want to sign out?')) {
        await supabase.auth.signOut();
      }
    } else {
      const { Alert } = require('react-native');
      Alert.alert('Leave?', 'You sure you want to sign out?', [
        { text: 'Stay', style: 'cancel' },
        { text: 'Sign Out', style: 'destructive', onPress: () => supabase.auth.signOut() },
      ]);
    }
  };

  const saveBio = async () => {
    if (!profile) return;
    const prevBio = profile.bio;
    const trimmed = bioText.trim();
    setProfile({ ...profile, bio: trimmed });
    setEditingBio(false);
    const { error } = await supabase.from('profiles').update({ bio: trimmed }).eq('id', profile.id);
    if (error) {
      console.error('Failed to save bio:', error);
      setProfile({ ...profile, bio: prevBio });
      setEditingBio(true);
    }
  };

  const updateThemeColor = async (color: string) => {
    if (!profile) return;
    const prevColor = profile.theme_color;
    setProfile({ ...profile, theme_color: color });
    setShowThemeSelector(false);
    const { error } = await supabase.from('profiles').update({ theme_color: color }).eq('id', profile.id);
    if (error) {
      console.error('Failed to update theme color:', error);
      setProfile({ ...profile, theme_color: prevColor });
    }
  };

  const getPinnedAchievements = () => {
    if (!profile?.pinned_achievements) return [];
    return profile.pinned_achievements
      .map(id => allBadges.find(badge => badge.id === id))
      .filter(Boolean)
      .slice(0, 3) as Achievement[];
  };

  const getConnectedPlatforms = () => {
    return integrations.filter(int => int.is_active).slice(0, 4);
  };

  const unlockedIds = new Set(userBadges.map((ub) => ub.achievement_id));
  const unlockedMap = new Map(userBadges.map((ub) => [ub.achievement_id, ub.unlocked_at]));
  
  const pinnedAchievements = getPinnedAchievements();
  const connectedPlatforms = getConnectedPlatforms();
  const activeAgents = agents.filter(agent => agent.is_active).slice(0, 3);

  const xpBarWidth = xpAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const currentLevelXP = Math.pow(levelInfo.level - 1, 2) * 50;
  const nextLevelXP = levelInfo.level >= 100 ? currentLevelXP : Math.pow(levelInfo.level, 2) * 50;

  const { width: screenWidth } = useWindowDimensions();
  const isDesktop = screenWidth > 640;

  // One-time CSS injection for the rotating-light hero border (web only).
  ensureHeroAuraStyle();

  return (
    <View style={styles.container}>
      <View style={[styles.header, isDesktop && styles.headerDesktop]}>
        <View>
          <Text style={styles.headerEyebrow}>PROFILE</Text>
          <Text style={styles.headerTitle}>Your Command Center</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable onPress={() => navigation.navigate('EditProfile')} style={styles.headerActionBtn}>
            <Text style={styles.headerActionText}>EDIT</Text>
          </Pressable>
          <Pressable onPress={handleSignOut} style={styles.headerDangerBtn}>
            <Text style={styles.headerDangerText}>LOG OUT</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.inner, isDesktop && styles.innerDesktop]}>
          {/* Custom Banner */}
          {profile?.banner_url ? (
            <Pressable style={styles.bannerContainer} onPress={() => navigation.navigate('EditProfile')}>
              {/* In production, would show actual image */}
              <View style={styles.bannerPlaceholder}>
                <Text style={styles.bannerPlaceholderText}>Custom Banner</Text>
              </View>
            </Pressable>
          ) : (
            <Pressable 
              style={styles.bannerContainer} 
              onPress={() => navigation.navigate('EditProfile')}
            >
              <View style={[styles.bannerPlaceholder, { backgroundColor: themeColor + '20' }]}>
                <Text style={[styles.bannerPlaceholderText, { color: themeColor }]}>+ ADD BANNER</Text>
              </View>
            </Pressable>
          )}

          {/* Hero Section — wrapped in the rotating-light aura on web. The
              outer View is a plain block; the className spread is RN-Web only
              and adds the conic-gradient rotating border via injected CSS.
              On native the wrapper is a no-op pass-through. */}
          <View
            {...(Platform.OS === 'web' ? ({ className: 'uc-profile-hero-aura' } as any) : {})}
            style={styles.heroAuraWrapper}
          >
            <View
              {...(Platform.OS === 'web' ? ({ className: 'uc-profile-hero-inner' } as any) : {})}
              style={styles.heroAuraInner}
            >
              <Card style={styles.heroCard}>
                <View style={[styles.heroCardLayout, isDesktop && styles.heroCardLayoutDesktop]}>
                  <View style={[styles.heroSection, isDesktop && styles.heroSectionDesktop]}>
                  <Pressable onPress={() => navigation.navigate('EditProfile')}>
                    <View style={[styles.avatarRing, { borderColor: themeColor }]}>
                      <View style={styles.avatar}>
                        <Text style={styles.avatarText}>
                          {profile?.display_name?.charAt(0)?.toUpperCase() || '?'}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                  <Text style={styles.displayName}>{profile?.display_name || 'Loading...'}</Text>
                  <Text style={styles.username}>@{profile?.username || '...'}</Text>

                  {/* Status Message */}
                  {profile?.status_message ? (
                    <Text style={styles.statusMessage}>"{profile.status_message}"</Text>
                  ) : null}

                  <View style={[styles.titleBadge, { borderColor: themeColor }]}>
                    <Text style={[styles.titleText, { color: themeColor }]}>
                      {levelInfo.title.toUpperCase()}
                    </Text>
                  </View>

                  {/* XP Progress Bar */}
                  <View style={styles.xpContainer}>
                    <View style={styles.xpHeader}>
                      <Text style={[styles.levelLabel, { color: levelColor }]}>
                        Level {levelInfo.level}
                      </Text>
                      <Text style={styles.xpText}>
                        {fmt(xp)} / {fmt(nextLevelXP)} XP
                      </Text>
                    </View>
                    <View style={styles.progressBarContainer}>
                      <View style={styles.progressBarBg}>
                        <Animated.View
                          style={[
                            styles.progressBarFill,
                            { width: xpBarWidth, backgroundColor: levelColor }
                          ]}
                        />
                      </View>
                      <Text style={styles.progressPercent}>
                        {Math.round(levelInfo.progress * 100)}%
                      </Text>
                    </View>
                    {levelInfo.level < 100 && (
                      <Text style={styles.nextLevelText}>
                        {fmt(nextLevelXP - xp)} XP to Level {levelInfo.level + 1}
                      </Text>
                    )}
                  </View>

                  <Text style={styles.memberSince}>
                    Member since {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : '...'}
                  </Text>
                  </View>

                </View>
              </Card>
            </View>
          </View>

          {/* XP Progress Bar */}
          <Card style={styles.xpCard}>
            <View style={styles.xpHeader}>
              <Text style={styles.xpLevel}>LEVEL {levelInfo.level}</Text>
              <Text style={styles.xpNumbers}>
                {fmt(xp - currentLevelXP)} / {fmt(nextLevelXP - currentLevelXP)} XP
              </Text>
            </View>
            <View style={styles.xpBarBg}>
              <Animated.View style={[styles.xpBarFill, { width: xpBarWidth, backgroundColor: themeColor }]} />
            </View>
            <Text style={styles.xpTotal}>{fmt(xp)} TOTAL XP</Text>
          </Card>

          {/* Activity + Rank near the top */}
          <View style={isDesktop ? styles.activityRankRow : undefined}>
            {rank !== null && (
              <View style={isDesktop ? { width: 180, flexShrink: 0 } : undefined}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>RANK</Text>
                </View>
                <Card style={styles.rankCard}>
                  <Text style={styles.rankLabel}>YOUR RANK</Text>
                  <Text style={styles.rankNumber}>#{rank}</Text>
                  <Text style={styles.rankOf}>of {totalUsers} users</Text>
                </Card>
              </View>
            )}

            {recentActivity.length > 0 && (
              <View style={isDesktop ? styles.activityRankCol : undefined}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>RECENT ACTIVITY</Text>
                </View>
                <Card style={styles.activityCard}>
                  {recentActivity.map((event, i) => (
                    <View key={event.id} style={[styles.activityItem, i > 0 && styles.activityBorder]}>
                      <Text style={styles.activityText}>
                        {getEventEmoji(event.event_type)} +{event.xp_amount} XP — {getEventLabel(event.event_type)}
                      </Text>
                      <Text style={styles.activityTime}>{getTimeAgo(event.created_at)}</Text>
                    </View>
                  ))}
                </Card>
              </View>
            )}
          </View>

          {/* Karma + Stats combined on desktop */}
          {isDesktop ? (
            <View style={styles.karmaStatsRow}>
              <Card style={styles.karmaCard}>
                <Text style={styles.karmaEmoji}>🔥</Text>
                <Text style={styles.karmaNumber}>{fmt(grindKarma)}</Text>
                <Text style={styles.karmaLabel}>GRIND KARMA</Text>
              </Card>
              <Card style={styles.karmaCard}>
                <Text style={styles.karmaEmoji}>💬</Text>
                <Text style={styles.karmaNumber}>{fmt(socialKarma)}</Text>
                <Text style={styles.karmaLabel}>SOCIAL KARMA</Text>
              </Card>
              <Card style={styles.statCardInline}>
                <Text style={styles.statNumber}>
                  {profile?.current_streak || 0}{(profile?.current_streak || 0) > 0 ? ' 🔥' : ''}
                </Text>
                <Text style={styles.statLabel}>STREAK</Text>
              </Card>
              <Card style={styles.statCardInline}>
                <Text style={styles.statNumber}>{profile?.longest_streak || 0}</Text>
                <Text style={styles.statLabel}>BEST</Text>
              </Card>
              <Card style={styles.statCardInline}>
                <Text style={styles.statNumber}>{fmt(totalCheckIns)}</Text>
                <Text style={styles.statLabel}>CHECK-INS</Text>
              </Card>
              <Card style={styles.statCardInline}>
                <Text style={styles.statNumber}>{circlesJoined}</Text>
                <Text style={styles.statLabel}>CIRCLES</Text>
              </Card>
            </View>
          ) : (
            <>
              {/* Karma Cards */}
              <View style={styles.karmaRow}>
                <Card style={styles.karmaCard}>
                  <Text style={styles.karmaEmoji}>🔥</Text>
                  <Text style={styles.karmaNumber}>{fmt(grindKarma)}</Text>
                  <Text style={styles.karmaLabel}>GRIND KARMA</Text>
                </Card>
                <Card style={styles.karmaCard}>
                  <Text style={styles.karmaEmoji}>💬</Text>
                  <Text style={styles.karmaNumber}>{fmt(socialKarma)}</Text>
                  <Text style={styles.karmaLabel}>SOCIAL KARMA</Text>
                </Card>
              </View>

              {/* Stats Grid */}
              <View style={styles.statsGrid}>
                <Card style={styles.statCard}>
                  <Text style={styles.statNumber}>
                    {profile?.current_streak || 0}{(profile?.current_streak || 0) > 0 ? ' 🔥' : ''}
                  </Text>
                  <Text style={styles.statLabel}>CURRENT STREAK</Text>
                </Card>
                <Card style={styles.statCard}>
                  <Text style={styles.statNumber}>{profile?.longest_streak || 0}</Text>
                  <Text style={styles.statLabel}>LONGEST STREAK</Text>
                </Card>
                <Card style={styles.statCard}>
                  <Text style={styles.statNumber}>{fmt(totalCheckIns)}</Text>
                  <Text style={styles.statLabel}>CHECK-INS</Text>
                </Card>
                <Card style={styles.statCard}>
                  <Text style={styles.statNumber}>{circlesJoined}</Text>
                  <Text style={styles.statLabel}>CIRCLES</Text>
                </Card>
              </View>
            </>
          )}

          {/* Pinned Achievements */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>PINNED ACHIEVEMENTS</Text>
            <Pressable onPress={() => navigation.navigate('EditProfile')}>
              <Text style={[styles.editLink, { color: themeColor }]}>CUSTOMIZE</Text>
            </Pressable>
          </View>
          {pinnedAchievements.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pinnedScroll}>
              {pinnedAchievements.map((badge) => (
                <Pressable
                  key={badge.id}
                  onPress={() => setSelectedBadge({
                    ...badge,
                    unlocked_at: unlockedMap.get(badge.id),
                  })}
                  style={styles.pinnedBadgeItem}
                >
                  <Text style={styles.pinnedBadgeIcon}>{badge.icon}</Text>
                  <Text style={styles.pinnedBadgeName} numberOfLines={1}>{badge.name}</Text>
                  <View style={[styles.pinnedIndicator, { backgroundColor: themeColor }]}>
                    <Text style={styles.pinnedText}>PINNED</Text>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Card style={styles.emptyPinnedCard}>
              <Text style={styles.emptyPinnedText}>No pinned achievements</Text>
              <Text style={styles.emptyPinnedDesc}>
                Unlock achievements and pin your favorites to showcase them here
              </Text>
            </Card>
          )}

          {/* Linked Accounts */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>CONNECTED ACCOUNTS</Text>
            <Pressable onPress={() => navigation.navigate('Integrations')}>
              <Text style={[styles.editLink, { color: themeColor }]}>MANAGE</Text>
            </Pressable>
          </View>
          {connectedPlatforms.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.platformsScroll}>
              {connectedPlatforms.map((integration) => {
                const platform = platformConnections[integration.platform as keyof typeof platformConnections];
                if (!platform) return null;
                return (
                  <Card key={integration.id} style={styles.platformCard}>
                    <Text style={styles.platformIcon}>{platform.icon}</Text>
                    <Text style={styles.platformName}>{platform.name}</Text>
                    <Text style={styles.platformUsername}>
                      @{integration.platform_username || 'connected'}
                    </Text>
                  </Card>
                );
              })}
              <Pressable 
                style={styles.addPlatformCard}
                onPress={() => navigation.navigate('Integrations')}
              >
                <Text style={styles.addPlatformIcon}>+</Text>
                <Text style={styles.addPlatformText}>CONNECT MORE</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <Card style={styles.emptyPlatformsCard} onPress={() => navigation.navigate('Integrations')}>
              <Text style={styles.emptyPlatformsText}>No accounts connected</Text>
              <Text style={styles.emptyPlatformsDesc}>
                Connect Discord, GitHub, Spotify and more
              </Text>
            </Card>
          )}

          {/* AI Models — connected LLM provider keys. Same visual
              language as CONNECTED ACCOUNTS so the section reads as a
              parallel "what AI does the user have wired up" view.
              Tapping any chip jumps into the Marketplace where the
              full connect / disconnect / replace-key flow lives. */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>AI MODELS</Text>
            <Pressable onPress={() => navigation.navigate('Integrations')}>
              <Text style={[styles.editLink, { color: themeColor }]}>MANAGE</Text>
            </Pressable>
          </View>
          {(() => {
            const activeKeys = apiKeys.filter(k => k.isActive);
            if (apiKeysLoading) {
              return (
                <Card style={styles.emptyPlatformsCard}>
                  <Text style={styles.emptyPlatformsDesc}>Loading…</Text>
                </Card>
              );
            }
            if (activeKeys.length === 0) {
              return (
                <Card style={styles.emptyPlatformsCard} onPress={() => navigation.navigate('Integrations')}>
                  <Text style={styles.emptyPlatformsText}>No AI models connected</Text>
                  <Text style={styles.emptyPlatformsDesc}>
                    Connect OpenAI, Anthropic, OpenRouter, Hugging Face, and more
                  </Text>
                </Card>
              );
            }
            return (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.platformsScroll}>
                {activeKeys.map(k => {
                  const meta = LLM_PROVIDER_META[k.provider] ?? { label: k.provider, glyph: 'A', accent: '#6366f1' };
                  return (
                    <Pressable
                      key={k.id}
                      onPress={() => navigation.navigate('Integrations')}
                    >
                      <Card style={styles.platformCard}>
                        <View style={[styles.aiModelGlyph, { backgroundColor: meta.accent + '22', borderColor: meta.accent + '66' }]}>
                          <Text style={[styles.aiModelGlyphText, { color: meta.accent }]}>{meta.glyph}</Text>
                        </View>
                        <Text style={styles.platformName}>{meta.label}</Text>
                        <Text style={styles.platformUsername}>{k.label || 'connected'}</Text>
                      </Card>
                    </Pressable>
                  );
                })}
                <Pressable
                  style={styles.addPlatformCard}
                  onPress={() => navigation.navigate('Integrations')}
                >
                  <Text style={styles.addPlatformIcon}>+</Text>
                  <Text style={styles.addPlatformText}>ADD MODEL</Text>
                </Pressable>
              </ScrollView>
            );
          })()}

          {/* My Agents */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>MY AI AGENTS</Text>
            <Pressable onPress={() => navigation.navigate('Agents')}>
              <Text style={[styles.editLink, { color: themeColor }]}>MANAGE</Text>
            </Pressable>
          </View>
          {activeAgents.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.agentsScroll}>
              {activeAgents.map((agent) => (
                <Card key={agent.id} style={styles.agentCard}>
                  <Text style={styles.agentIcon}>🤖</Text>
                  <Text style={styles.agentName}>{agent.name}</Text>
                  <Text style={styles.agentType}>{agent.type.toUpperCase()}</Text>
                  <View style={styles.agentStatus}>
                    <View style={styles.agentStatusDot} />
                    <Text style={styles.agentStatusText}>ACTIVE</Text>
                  </View>
                </Card>
              ))}
              <Pressable 
                style={styles.addAgentCard}
                onPress={() => navigation.navigate('Agents')}
              >
                <Text style={styles.addAgentIcon}>+</Text>
                <Text style={styles.addAgentText}>ADD AGENT</Text>
              </Pressable>
            </ScrollView>
          ) : (
            <Card style={styles.emptyAgentsCard} onPress={() => navigation.navigate('Agents')}>
              <Text style={styles.emptyAgentsText}>No AI agents yet</Text>
              <Text style={styles.emptyAgentsDesc}>
                Create AI assistants to automate your grind
              </Text>
            </Card>
          )}

          {/* Friends Preview */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>FRIENDS</Text>
            <Pressable onPress={() => navigation.navigate('Friends')}>
              <Text style={[styles.editLink, { color: themeColor }]}>SEE ALL</Text>
            </Pressable>
          </View>
          {friends.length > 0 ? (
            <View style={styles.friendsPreview}>
              <View style={styles.friendsStats}>
                <Text style={styles.friendsCount}>{friends.length}</Text>
                <Text style={styles.friendsLabel}>FRIENDS</Text>
              </View>
              <View style={styles.friendsAvatars}>
                {friends.slice(0, 5).map((friend, index) => (
                  <View key={friend.id} style={[styles.friendAvatar, { zIndex: 5 - index }]}>
                    <Text style={styles.friendAvatarText}>
                      {friend.friend?.display_name?.charAt(0)?.toUpperCase() || '?'}
                    </Text>
                  </View>
                ))}
                {friends.length > 5 && (
                  <View style={[styles.friendAvatar, styles.friendAvatarMore]}>
                    <Text style={styles.friendAvatarText}>+{friends.length - 5}</Text>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <Card style={styles.emptyFriendsCard} onPress={() => navigation.navigate('Friends')}>
              <Text style={styles.emptyFriendsText}>No friends yet</Text>
              <Text style={styles.emptyFriendsDesc}>
                Connect with other grinders and build your network
              </Text>
            </Card>
          )}

          {/* Theme Color Picker */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>THEME COLOR</Text>
            <Pressable onPress={() => setShowThemeSelector(!showThemeSelector)}>
              <Text style={[styles.editLink, { color: themeColor }]}>CHANGE</Text>
            </Pressable>
          </View>
          <View style={styles.themePreview}>
            <View style={[styles.themeColorDot, { backgroundColor: themeColor }]} />
            <Text style={styles.themeColorName}>
              {themeColor === '#6366f1' ? 'Indigo' :
               themeColor === '#a855f7' ? 'Purple' :
               themeColor === '#22d3ee' ? 'Cyan' :
               themeColor === '#22c55e' ? 'Green' :
               themeColor === '#f43f5e' ? 'Rose' :
               themeColor === '#f59e0b' ? 'Amber' :
               themeColor === '#3b82f6' ? 'Blue' :
               themeColor === '#fbbf24' ? 'Gold' : 'Custom'}
            </Text>
          </View>
          
          {showThemeSelector && (
            <Card style={styles.themeSelector}>
              <View style={styles.themeColors}>
                {['#6366f1', '#a855f7', '#22d3ee', '#22c55e', '#f43f5e', '#f59e0b', '#3b82f6', '#fbbf24'].map(color => (
                  <Pressable
                    key={color}
                    style={[
                      styles.themeColorOption,
                      { backgroundColor: color },
                      themeColor === color && styles.themeColorSelected,
                    ]}
                    onPress={() => updateThemeColor(color)}
                  />
                ))}
              </View>
            </Card>
          )}

          {/* Invite Friends */}
          <Card style={styles.inviteCard}>
            <Text style={styles.inviteTitle}>INVITE FRIENDS</Text>
            <Text style={styles.inviteDesc}>
              Grow your network and earn rewards for successful referrals
            </Text>
            <Button
              title="GENERATE INVITE LINK"
              variant="secondary"
              onPress={() => navigation.navigate('Friends')}
              style={styles.inviteButton}
            />
          </Card>

          {/* All Achievements */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>ALL ACHIEVEMENTS</Text>
            <Text style={styles.sectionCount}>{userBadges.length}/{allBadges.length}</Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.badgeScroll}>
            {allBadges.map((badge) => {
              const unlocked = unlockedIds.has(badge.id);
              return (
                <Pressable
                  key={badge.id}
                  onPress={() => setSelectedBadge({
                    ...badge,
                    unlocked_at: unlockedMap.get(badge.id),
                  })}
                  style={[styles.badgeItem, !unlocked && styles.badgeLocked]}
                >
                  <Text style={[styles.badgeIcon, !unlocked && styles.badgeIconLocked]}>
                    {unlocked ? badge.icon : '🔒'}
                  </Text>
                  <Text style={[styles.badgeName, !unlocked && styles.badgeNameLocked]} numberOfLines={1}>
                    {badge.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Bio Section */}
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>BIO</Text>
            <Pressable onPress={() => setEditingBio(!editingBio)}>
              <Text style={styles.editLink}>{editingBio ? 'CANCEL' : 'EDIT'}</Text>
            </Pressable>
          </View>
          {editingBio ? (
            <Card style={styles.bioEditCard}>
              <TextInput
                style={styles.bioInput}
                value={bioText}
                onChangeText={setBioText}
                placeholder="Tell us about yourself..."
                placeholderTextColor="#444"
                multiline
                maxLength={200}
              />
              <Button title="SAVE" onPress={saveBio} />
            </Card>
          ) : (
            <Card style={styles.bioCard}>
              <Text style={styles.bioText}>{profile?.bio || 'No bio yet. Tap edit to add one.'}</Text>
            </Card>
          )}

          <View style={{ height: 20 }} />
          <View style={styles.accountActionsCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.accountActionsTitle}>Account Actions</Text>
              <Text style={styles.accountActionsDesc}>
                Update your profile, manage connected services, or sign out of this workspace.
              </Text>
            </View>
            <Pressable onPress={handleSignOut} style={styles.signOutButton}>
              <Text style={styles.signOutButtonText}>LOG OUT</Text>
            </Pressable>
          </View>
          {/* Unified mentions inbox — every @ of the current user across
              every circle they're in. Opening this view also marks their
              mentions as seen (bumps profiles.mentions_seen_at). */}
          <MentionsInbox />

          <View style={{ height: 40 }} />
        </View>
      </ScrollView>

      {/* Badge Detail Modal */}
      {selectedBadge && (
        <Modal transparent animationType="fade" visible onRequestClose={() => setSelectedBadge(null)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedBadge(null)}>
            <View style={styles.modalCard}>
              <Text style={styles.modalIcon}>{selectedBadge.icon}</Text>
              <Text style={styles.modalBadgeName}>{selectedBadge.name}</Text>
              <Text style={styles.modalDesc}>{selectedBadge.description}</Text>
              <Text style={[styles.modalXP, { color: themeColor }]}>+{selectedBadge.xp_reward} XP</Text>
              {selectedBadge.unlocked_at ? (
                <Text style={styles.modalUnlocked}>
                  Unlocked {new Date(selectedBadge.unlocked_at).toLocaleDateString()}
                </Text>
              ) : (
                <Text style={styles.modalLocked}>🔒 Not yet unlocked</Text>
              )}
            </View>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}

// ── Design tokens (GitHub dark mode + UC indigo) ────────────────────────────
const FONT = Platform.OS === 'web'
  ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
  : Platform.OS === 'ios' ? 'System' : 'Roboto';

const C = {
  canvas: '#0d1117',
  surface: '#161b22',
  inset: '#010409',
  overlay: '#1c2128',
  border: '#30363d',
  borderMuted: '#21262d',
  borderAccent: '#6366f1',
  text: '#e6edf3',
  textSec: '#8b949e',
  textMuted: '#484f58',
  accent: '#6366f1',
  accentHover: '#818cf8',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149',
};

const cardShadow = Platform.OS === 'web' ? { boxShadow: '0 1px 3px rgba(0,0,0,0.12)' } as any : {};
const featuredShadow = Platform.OS === 'web' ? { boxShadow: '0 2px 8px rgba(0,0,0,0.2), 0 0 0 1px rgba(99,102,241,0.1)' } as any : {};
const modalShadow = Platform.OS === 'web' ? { boxShadow: '0 8px 24px rgba(0,0,0,0.4)' } as any : {};
const transition = Platform.OS === 'web' ? { transition: 'all 0.2s ease' } as any : {};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60, paddingBottom: 16, paddingHorizontal: 32,
    borderBottomWidth: 1, borderBottomColor: C.borderMuted,
    width: '100%',
  },
  headerDesktop: { paddingHorizontal: 48 },
  headerEyebrow: { color: C.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.4, fontFamily: FONT, marginBottom: 2 },
  headerTitle: { color: C.text, fontSize: 22, fontWeight: '700', fontFamily: FONT },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerActionBtn: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    backgroundColor: C.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerActionText: { color: C.accent, fontSize: 12, fontWeight: '700', fontFamily: FONT, letterSpacing: 0.5 },
  headerDangerBtn: {
    borderWidth: 1,
    borderColor: '#4b2222',
    borderRadius: 10,
    backgroundColor: '#251214',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  headerDangerText: { color: '#fca5a5', fontSize: 12, fontWeight: '700', fontFamily: FONT, letterSpacing: 0.5 },
  scrollContent: { flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: 1000,
    alignSelf: 'center' as const,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 60,
  },
  innerDesktop: { paddingHorizontal: 32 },

  // Hero aura wrapper
  heroAuraWrapper: {
    marginTop: 8,
    marginBottom: 16,
    borderRadius: 6,
  },
  heroAuraInner: {
    borderRadius: 6,
    overflow: 'hidden' as any,
  },

  // Hero card
  heroCard: {
    alignItems: 'center', padding: 32, marginBottom: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    ...featuredShadow,
  },
  heroCardLayout: { width: '100%' },
  heroCardLayoutDesktop: { width: '100%' },
  heroSection: { alignItems: 'center' },
  heroSectionDesktop: { alignItems: 'center' },
  avatarRing: { width: 84, height: 84, borderRadius: 42, borderWidth: 2, borderColor: C.accent, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
  avatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: C.overlay, justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: C.text, fontSize: 28, fontWeight: '600', fontFamily: FONT },
  displayName: { color: C.text, fontSize: 22, fontWeight: '600', fontFamily: FONT },
  username: { color: C.textSec, fontSize: 14, marginTop: 2, fontFamily: FONT, fontWeight: '400' },
  titleBadge: { borderWidth: 1, borderRadius: 20, borderColor: C.accent + '40', paddingVertical: 4, paddingHorizontal: 14, marginTop: 12, backgroundColor: C.accent + '15' },
  titleText: { fontSize: 12, fontWeight: '600', color: C.accent, fontFamily: FONT },
  memberSince: { color: C.textMuted, fontSize: 12, marginTop: 10, fontFamily: FONT, fontWeight: '400' },

  // XP Bar
  xpCard: {
    marginBottom: 16, padding: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    ...cardShadow,
  },
  xpLevel: { color: C.text, fontSize: 14, fontWeight: '600', fontFamily: FONT },
  xpNumbers: { color: C.textSec, fontSize: 13, fontWeight: '400', fontFamily: FONT },
  xpBarBg: { height: 8, backgroundColor: C.borderMuted, borderRadius: 4, overflow: 'hidden' },
  xpBarFill: {
    height: '100%', borderRadius: 4,
    backgroundColor: C.accent,
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, #6366f1, #818cf8)' } as any : {}),
  },
  xpTotal: { color: C.textMuted, fontSize: 12, fontWeight: '400', marginTop: 8, textAlign: 'center', fontFamily: FONT },

  // Karma
  karmaRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  karmaCard: {
    flex: 1, alignItems: 'center', padding: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    ...cardShadow,
  },
  karmaEmoji: { fontSize: 16, marginBottom: 6, color: C.accent, fontFamily: FONT },
  karmaNumber: { color: C.text, fontSize: 24, fontWeight: '600', fontFamily: FONT },
  karmaLabel: { color: C.textSec, fontSize: 12, fontWeight: '500', marginTop: 4, fontFamily: FONT },

  // Stats Grid
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  statCard: {
    width: '47%', alignItems: 'center', padding: 16,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    ...cardShadow,
  },
  statNumber: { color: C.text, fontSize: 24, fontWeight: '600', marginBottom: 4, fontFamily: FONT },
  statLabel: { color: C.textSec, fontSize: 12, fontWeight: '500', textAlign: 'center', fontFamily: FONT },

  karmaStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  statCardInline: {
    flex: 1, alignItems: 'center', padding: 16, minWidth: 100,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    ...cardShadow,
  },

  activityRankRow: { flexDirection: 'row', gap: 16 },
  activityRankCol: { flex: 1 },

  // Sections
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 16 },
  sectionTitle: { color: C.text, fontSize: 16, fontWeight: '600', fontFamily: FONT },
  sectionCount: { color: C.textMuted, fontSize: 13, fontWeight: '400', fontFamily: FONT },

  // Badges
  badgeScroll: { marginBottom: 16 },
  badgeItem: { alignItems: 'center', marginRight: 16, width: 70 },
  badgeLocked: { opacity: 0.3 },
  badgeIcon: { fontSize: 32, marginBottom: 4 },
  badgeIconLocked: {},
  badgeName: { color: C.textSec, fontSize: 11, fontWeight: '500', textAlign: 'center', fontFamily: FONT },
  badgeNameLocked: { color: C.textMuted },

  // Activity
  activityCard: {
    marginBottom: 16, padding: 0,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    overflow: 'hidden',
    ...cardShadow,
  },
  activityItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  activityBorder: { borderTopWidth: 1, borderTopColor: C.borderMuted },
  activityText: { color: C.text, fontSize: 13, flex: 1, fontFamily: FONT, fontWeight: '400' },
  activityTime: { color: C.textMuted, fontSize: 12, marginLeft: 8, fontFamily: FONT, fontWeight: '400' },

  // Rank
  rankCard: {
    alignItems: 'center', padding: 24, marginBottom: 16, marginTop: 8,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    ...featuredShadow,
  },
  rankLabel: { color: C.textSec, fontSize: 12, fontWeight: '500', fontFamily: FONT },
  rankNumber: { color: C.accent, fontSize: 40, fontWeight: '600', marginVertical: 4, fontFamily: FONT },
  rankOf: { color: C.textMuted, fontSize: 13, fontFamily: FONT, fontWeight: '400' },

  // Bio
  editLink: { color: C.accent, fontSize: 13, fontWeight: '600', fontFamily: FONT },
  bioCard: { marginBottom: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 6, ...cardShadow },
  bioText: { color: C.textSec, fontSize: 14, lineHeight: 22, fontFamily: FONT, fontWeight: '400' },
  bioEditCard: { marginBottom: 16, gap: 12, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, borderRadius: 6, ...cardShadow },
  bioInput: { backgroundColor: C.canvas, borderWidth: 1, borderColor: C.border, borderRadius: 6, padding: 12, color: C.text, fontSize: 14, minHeight: 80, textAlignVertical: 'top', fontFamily: FONT },

  accountActionsCard: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 12,
    backgroundColor: C.surface,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    ...cardShadow,
  },
  accountActionsTitle: { color: C.text, fontSize: 15, fontWeight: '700', fontFamily: FONT, marginBottom: 4 },
  accountActionsDesc: { color: C.textSec, fontSize: 13, lineHeight: 18, fontFamily: FONT, fontWeight: '400' },
  signOutButton: {
    borderWidth: 1,
    borderColor: '#4b2222',
    borderRadius: 10,
    backgroundColor: '#251214',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  signOutButtonText: { color: '#fca5a5', fontSize: 12, fontWeight: '700', fontFamily: FONT, letterSpacing: 0.6 },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalCard: {
    backgroundColor: C.surface, borderRadius: 12, padding: 32, borderWidth: 1, borderColor: C.border,
    alignItems: 'center', width: '80%', maxWidth: 320,
    ...modalShadow,
  },
  modalIcon: { fontSize: 48, marginBottom: 12 },
  modalBadgeName: { color: C.text, fontSize: 18, fontWeight: '600', marginBottom: 6, fontFamily: FONT },
  modalDesc: { color: C.textSec, fontSize: 13, textAlign: 'center', marginBottom: 10, fontFamily: FONT, fontWeight: '400' },
  modalXP: { color: C.accent, fontSize: 14, fontWeight: '600', marginBottom: 8, fontFamily: FONT },
  modalUnlocked: { color: C.success, fontSize: 12, fontFamily: FONT, fontWeight: '500' },
  modalLocked: { color: C.textMuted, fontSize: 12, fontFamily: FONT, fontWeight: '400' },

  // Banner
  bannerContainer: { marginBottom: -20, height: 140, marginHorizontal: 0, borderRadius: 6, overflow: 'hidden', zIndex: 0 },
  bannerPlaceholder: {
    flex: 1,
    backgroundColor: C.surface,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: 6,
  },
  bannerPlaceholderText: { color: C.textMuted, fontSize: 13, fontWeight: '500', fontFamily: FONT },

  statusMessage: {
    color: C.textSec,
    fontSize: 14,
    fontStyle: 'italic',
    marginVertical: 8,
    textAlign: 'center',
    fontFamily: FONT,
    fontWeight: '400',
  },

  // Pinned achievements
  pinnedScroll: { marginBottom: 16 },
  pinnedBadgeItem: {
    alignItems: 'center',
    marginRight: 16,
    width: 80,
    position: 'relative',
  },
  pinnedBadgeIcon: { fontSize: 36, marginBottom: 6 },
  pinnedBadgeName: {
    color: C.text,
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'center',
    marginBottom: 4,
    fontFamily: FONT,
  },
  pinnedIndicator: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 20,
    position: 'absolute',
    bottom: -8,
    backgroundColor: C.accent,
  },
  pinnedText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '600',
    fontFamily: FONT,
  },
  emptyPinnedCard: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    ...cardShadow,
  },
  emptyPinnedText: { color: C.textSec, fontSize: 14, fontWeight: '500', fontFamily: FONT },
  emptyPinnedDesc: { color: C.textMuted, fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 20, fontFamily: FONT, fontWeight: '400' },

  // Connected platforms
  platformsScroll: { marginBottom: 16 },
  platformCard: {
    alignItems: 'center',
    marginRight: 12,
    minWidth: 80,
    padding: 14,
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    ...cardShadow,
  },
  platformIcon: { fontSize: 20, marginBottom: 6 },
  platformName: { color: C.text, fontSize: 12, fontWeight: '600', marginBottom: 2, fontFamily: FONT },
  platformUsername: { color: C.textMuted, fontSize: 11, fontFamily: FONT, fontWeight: '400' },
  aiModelGlyph: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  aiModelGlyphText: { fontSize: 13, fontWeight: '900', fontFamily: FONT },
  addPlatformCard: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    minWidth: 80,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: 6,
    padding: 14,
  },
  addPlatformIcon: { color: C.textMuted, fontSize: 18, marginBottom: 4, fontFamily: FONT },
  addPlatformText: { color: C.textMuted, fontSize: 11, fontWeight: '500', fontFamily: FONT },
  emptyPlatformsCard: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 6,
    ...cardShadow,
  },
  emptyPlatformsText: { color: C.textSec, fontSize: 14, fontWeight: '500', fontFamily: FONT },
  emptyPlatformsDesc: { color: C.textMuted, fontSize: 13, textAlign: 'center', marginTop: 4, lineHeight: 20, fontFamily: FONT, fontWeight: '400' },

  // Agents
  agentsScroll: { marginBottom: 16 },
  agentCard: {
    alignItems: 'center',
    marginRight: 12,
    minWidth: 90,
    padding: 14,
    position: 'relative',
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
    ...cardShadow,
  },
  agentIcon: { fontSize: 20, marginBottom: 6 },
  agentName: { color: C.text, fontSize: 12, fontWeight: '600', marginBottom: 2, textAlign: 'center', fontFamily: FONT },
  agentType: { color: C.textMuted, fontSize: 11, marginBottom: 4, fontFamily: FONT, fontWeight: '400' },
  agentStatus: { flexDirection: 'row', alignItems: 'center' },
  agentStatusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: C.success,
    marginRight: 4,
  },
  agentStatusText: { color: C.success, fontSize: 11, fontWeight: '500', fontFamily: FONT },
  addAgentCard: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    minWidth: 90,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: C.border,
    borderStyle: 'dashed',
    borderRadius: 6,
    padding: 12,
  },
  addAgentIcon: { color: '#666', fontSize: 20, marginBottom: 4 },
  addAgentText: { color: '#666', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  emptyAgentsCard: { 
    alignItems: 'center', 
    padding: 24,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    ...cardShadow,
  },
  emptyAgentsText: { color: C.textSec, fontSize: 14, fontWeight: '600', fontFamily: FONT },
  emptyAgentsDesc: { color: C.textMuted, fontSize: 12, textAlign: 'center', marginTop: 4, lineHeight: 16, fontFamily: FONT },

  // Friends
  friendsPreview: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
    ...cardShadow,
  },
  friendsStats: { marginRight: 16 },
  friendsCount: { color: C.text, fontSize: 24, fontWeight: '900', fontFamily: FONT },
  friendsLabel: { color: C.textMuted, fontSize: 10, letterSpacing: 1, fontWeight: '700', fontFamily: FONT },
  friendsAvatars: { flexDirection: 'row', flex: 1 },
  friendAvatar: { 
    width: 32, 
    height: 32, 
    borderRadius: 16, 
    backgroundColor: C.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -8,
    borderWidth: 2,
    borderColor: C.surface,
  },
  friendAvatarText: { color: C.text, fontSize: 12, fontWeight: '900', fontFamily: FONT },
  friendAvatarMore: { backgroundColor: C.borderMuted },
  emptyFriendsCard: { 
    alignItems: 'center', 
    padding: 24,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    ...cardShadow,
  },
  emptyFriendsText: { color: C.textSec, fontSize: 14, fontWeight: '600', fontFamily: FONT },
  emptyFriendsDesc: { color: C.textMuted, fontSize: 12, textAlign: 'center', marginTop: 4, lineHeight: 16, fontFamily: FONT },

  // Theme
  themePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.border,
    ...cardShadow,
  },
  themeColorDot: { width: 24, height: 24, borderRadius: 12, marginRight: 12 },
  themeColorName: { color: C.text, fontSize: 14, fontWeight: '700', fontFamily: FONT },
  themeSelector: { marginBottom: 16, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, ...cardShadow },
  themeColors: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  themeColorOption: { 
    width: 32, 
    height: 32, 
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeColorSelected: { borderColor: C.text },

  // Invite
  inviteCard: { 
    alignItems: 'center', 
    padding: 24,
    marginBottom: 16,
    backgroundColor: C.surface,
    borderColor: C.border,
    borderWidth: 1,
    borderRadius: 12,
    ...cardShadow,
  },
  inviteTitle: { 
    color: C.text, 
    fontSize: 16, 
    fontWeight: '800', 
    letterSpacing: 2, 
    marginBottom: 8,
    fontFamily: FONT,
  },
  inviteDesc: { 
    color: C.textSec, 
    fontSize: 13, 
    textAlign: 'center', 
    lineHeight: 18,
    marginBottom: 16,
    fontFamily: FONT,
  },
  inviteButton: { minHeight: 40, paddingHorizontal: 20 },

  // XP Progress Bar
  xpContainer: {
    marginVertical: 16,
    paddingHorizontal: 4,
  },
  xpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  levelLabel: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1,
  },
  xpText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
  },
  progressBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressBarBg: {
    flex: 1,
    height: 8,
    backgroundColor: C.inset,
    borderRadius: 4,
    overflow: 'hidden',
    marginRight: 12,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
    shadowColor: 'rgba(255,255,255,0.3)',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  progressPercent: {
    color: C.textMuted,
    fontSize: 10,
    fontWeight: '700',
    minWidth: 32,
    textAlign: 'right',
    fontFamily: FONT,
  },
  nextLevelText: {
    color: C.textMuted,
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
    fontFamily: FONT,
  },
});
