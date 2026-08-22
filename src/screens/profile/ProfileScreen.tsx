import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { safeGetUser } from '../../lib/authSession';
import type { Achievement, AgentBot, Friend, Integration, User, UserAchievement, XPEvent } from '../../types';
import {
  checkAndUnlockAchievements,
  getAllAchievements,
  getLeaderboard,
  getLevelInfo,
  getRecentXPEvents,
  getUserAchievements,
  getUserXP,
} from '../../lib/gamification';
import { getFriends, getUserIntegrations, platformConnections } from '../../lib/integrations';
import { getUserAgents } from '../../lib/agents';
import { useUserApiKeys, type LLMProvider } from '../../lib/llmProviders';
import MentionsInbox from '../../components/MentionsInbox';
import { PROFILE_DASHBOARD_TOKENS as PD } from '../../components/profile/profileDashboardTheme';
import { getLastProfileCircle, navigateToUnifiedProfile } from '../../lib/profileNavigation';
import { secureSignOut } from '../../lib/authLogout';
import {
  loadOfficeAgentUsageProfilesExact,
  type TerminalAuthorityCurrentGuard,
  type TerminalExactAuthority,
} from '../../lib/officeTerminal';
import { summarizeOfficeAgentLifetimeUsage } from '../../lib/officeAgents';

const FONT = Platform.OS === 'web'
  ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
  : Platform.OS === 'ios' ? 'System' : 'Roboto';

const THEME_COLORS = ['#6366f1', '#a855f7', '#22c55e', '#f43f5e', '#f59e0b', '#3b82f6', '#fbbf24'];

const LLM_PROVIDER_META: Partial<Record<LLMProvider, { label: string; glyph: string; accent: string }>> = {
  anthropic: { label: 'Anthropic', glyph: 'A', accent: '#d97706' },
  openai: { label: 'OpenAI', glyph: 'O', accent: '#10a37f' },
  openrouter: { label: 'OpenRouter', glyph: 'R', accent: '#7c3aed' },
  groq: { label: 'Groq', glyph: 'Q', accent: '#f97316' },
  huggingface: { label: 'Hugging Face', glyph: 'H', accent: '#ffbd45' },
  replicate: { label: 'Replicate', glyph: 'P', accent: '#475569' },
  ollama: { label: 'Ollama', glyph: 'L', accent: '#5b21b6' },
  zai: { label: 'Z.AI / GLM', glyph: 'Z', accent: '#0ea5e9' },
  minimax: { label: 'MiniMax', glyph: 'M', accent: '#ec4899' },
  'github-models': { label: 'GitHub Models', glyph: 'G', accent: '#6e7681' },
};

function fmt(value: number): string {
  return value.toLocaleString();
}

function getTimeAgo(dateString: string): string {
  const diff = Date.now() - new Date(dateString).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'NOW';
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}H`;
  return `${Math.floor(hours / 24)}D`;
}

function getEventLabel(type: string): string {
  const labels: Record<string, string> = {
    check_in: 'Daily check-in',
    task_complete: 'Task completed',
    circle_join: 'Joined circle',
    circle_create: 'Created circle',
    upvote_received: 'Upvote received',
    streak_bonus: 'Streak bonus',
    badge_earned: 'Achievement unlocked',
    daily_login: 'Daily login',
  };
  return labels[type] || type.replace(/_/g, ' ');
}

function themeColorName(color: string): string {
  const names: Record<string, string> = {
    '#6366f1': 'Indigo',
    '#a855f7': 'Purple',
    '#22c55e': 'Green',
    '#f43f5e': 'Rose',
    '#f59e0b': 'Amber',
    '#3b82f6': 'Blue',
    '#fbbf24': 'Gold',
  };
  return names[color] || 'Custom';
}

function DashboardSection({
  testID,
  title,
  meta,
  actionLabel,
  onAction,
  children,
  style,
}: {
  testID: string;
  title: string;
  meta?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: React.ReactNode;
  style?: any;
}) {
  return (
    <View testID={testID} style={[styles.dashboardPanel, style]}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>{title}</Text>
        {meta ? <Text style={styles.panelMeta}>{meta}</Text> : null}
        {actionLabel && onAction ? (
          <Pressable
            onPress={onAction}
            accessibilityRole="button"
            accessibilityLabel={`${actionLabel} ${title}`}
            style={({ hovered, pressed, focused }: any) => [
              styles.panelAction,
              hovered && styles.controlHovered,
              pressed && styles.controlPressed,
              focused && Platform.OS === 'web' && styles.controlFocused,
            ]}
          >
            <Text style={styles.panelActionText}>{actionLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.panelBody}>{children}</View>
    </View>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, accent ? { color: accent } : null]} numberOfLines={1}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function CompactEmpty({ title, hint, onPress }: { title: string; hint: string; onPress?: () => void }) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={({ hovered, pressed, focused }: any) => [
          styles.emptyState,
          hovered && styles.controlHovered,
          pressed && styles.controlPressed,
          focused && Platform.OS === 'web' && styles.controlFocused,
        ]}
      >
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyHint}>{hint}</Text>
      </Pressable>
    );
  }
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyHint}>{hint}</Text>
    </View>
  );
}

function ResourceChip({
  glyph,
  title,
  meta,
  accent,
  onPress,
}: {
  glyph: string;
  title: string;
  meta: string;
  accent: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${meta}`}
      style={({ hovered, pressed, focused }: any) => [
        styles.resourceChip,
        hovered && styles.controlHovered,
        pressed && styles.controlPressed,
        focused && Platform.OS === 'web' && styles.controlFocused,
      ]}
    >
      <View style={[styles.resourceGlyph, { borderColor: `${accent}55`, backgroundColor: `${accent}18` }]}>
        <Text style={[styles.resourceGlyphText, { color: accent }]}>{glyph}</Text>
      </View>
      <View style={styles.resourceCopy}>
        <Text style={styles.resourceTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.resourceMeta} numberOfLines={1}>{meta}</Text>
      </View>
    </Pressable>
  );
}

interface ProfileScreenProps {
  navigation: any;
  route?: any;
  exactAgentUsageAuthority?: TerminalExactAuthority | null;
  isExactAgentUsageAuthorityCurrent?: TerminalAuthorityCurrentGuard;
}

export default function ProfileScreen({
  navigation,
  route,
  exactAgentUsageAuthority = null,
  isExactAgentUsageAuthorityCurrent,
}: ProfileScreenProps) {
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
  const [bioSaving, setBioSaving] = useState(false);
  const [bioError, setBioError] = useState<string | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [agents, setAgents] = useState<AgentBot[]>([]);
  const { keys: apiKeys, isLoading: apiKeysLoading } = useUserApiKeys();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [agentLifetimeUsage, setAgentLifetimeUsage] = useState<{
    tokens: number;
    cost: number;
    status: 'loading' | 'ready' | 'unavailable';
  }>({ tokens: 0, cost: 0, status: 'loading' });

  const xp = profile?.xp || 0;
  const levelInfo = getLevelInfo(xp);
  const themeColor = profile?.theme_color || PD.accent;
  const currentLevelXP = Math.pow(levelInfo.level - 1, 2) * 50;
  const nextLevelXP = levelInfo.level >= 100 ? currentLevelXP : Math.pow(levelInfo.level, 2) * 50;
  const progressPercent = Math.max(0, Math.min(100, Math.round(levelInfo.progress * 100)));
  const { width: viewportWidth } = useWindowDimensions();
  const isDesktop = viewportWidth >= 760;

  const loadAll = async () => {
    setProfileLoading(true);
    setProfileLoadError(null);
    try {
      const { value: user } = await safeGetUser();
      if (!user) throw new Error('Your signed-in profile is unavailable.');

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (profileError) throw profileError;
      if (!profileData) throw new Error('Your profile could not be found.');
      setProfile(profileData);
      setBioText(profileData.bio || '');

      const [userXP, checkInsResult, circlesResult, badges, unlockedBadges, activity, leaderboard] = await Promise.all([
        getUserXP(user.id),
        supabase.from('xp_events').select('*', { count: 'exact', head: true }).eq('user_id', user.id).eq('event_type', 'check_in'),
        supabase.from('circle_members').select('*', { count: 'exact', head: true }).eq('user_id', user.id),
        getAllAchievements(),
        getUserAchievements(user.id),
        getRecentXPEvents(user.id, 10),
        getLeaderboard(undefined, 50),
      ]);

      if (userXP) {
        setGrindKarma(userXP.grind_karma);
        setSocialKarma(userXP.social_karma);
      }
      setTotalCheckIns(checkInsResult.count || 0);
      setCirclesJoined(circlesResult.count || 0);
      setAllBadges(badges);
      setUserBadges(unlockedBadges);
      setRecentActivity(activity);
      const rankIndex = leaderboard.findIndex((entry) => entry.user_id === user.id);
      setRank(rankIndex >= 0 ? rankIndex + 1 : null);
      setTotalUsers(leaderboard.length);

      try {
        const [integrationRows, agentRows, friendRows] = await Promise.all([
          getUserIntegrations(user.id),
          getUserAgents(),
          getFriends(),
        ]);
        setIntegrations(integrationRows);
        setAgents(agentRows);
        setFriends(friendRows);
      } catch (error) {
        console.error('Error loading profile connections:', error);
      }

      checkAndUnlockAchievements(user.id).catch(console.error);
    } catch (error) {
      console.error('Error loading profile dashboard:', error);
      setProfileLoadError(error instanceof Error ? error.message : 'Profile details could not be loaded.');
    } finally {
      setProfileLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    const requestedAuthority = exactAgentUsageAuthority;
    const fence = isExactAgentUsageAuthorityCurrent;
    let cancelled = false;
    if (!requestedAuthority || !fence || !fence(requestedAuthority)) {
      setAgentLifetimeUsage({ tokens: 0, cost: 0, status: 'unavailable' });
      return () => { cancelled = true; };
    }
    setAgentLifetimeUsage((current) => ({ ...current, status: 'loading' }));
    void loadOfficeAgentUsageProfilesExact(requestedAuthority, fence).then((result) => {
      if (cancelled || !fence(requestedAuthority)) return;
      if (!result.ok) {
        setAgentLifetimeUsage((current) => ({ ...current, status: 'unavailable' }));
        return;
      }
      const { tokens, cost } = summarizeOfficeAgentLifetimeUsage(result.profiles.values());
      setAgentLifetimeUsage({ tokens, cost, status: 'ready' });
    });
    return () => { cancelled = true; };
  }, [
    exactAgentUsageAuthority?.accessToken,
    exactAgentUsageAuthority?.circleId,
    exactAgentUsageAuthority?.generation,
    exactAgentUsageAuthority?.userId,
    isExactAgentUsageAuthorityCurrent,
  ]);

  useEffect(() => {
    if (!route?.name || route.name !== 'Profile') return;
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

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof document === 'undefined') return;
    let flag: string | null = null;
    try { flag = window.localStorage.getItem('uc_focus_mentions_inbox'); } catch {}
    if (!flag) return;
    let tries = 0;
    let animationFrame: any;
    const tryScroll = () => {
      const element = document.getElementById('section-mentions-inbox');
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        try { window.localStorage.removeItem('uc_focus_mentions_inbox'); } catch {}
        return;
      }
      if (tries++ < 60) animationFrame = requestAnimationFrame(tryScroll);
    };
    animationFrame = requestAnimationFrame(tryScroll);
    return () => { if (animationFrame) cancelAnimationFrame(animationFrame); };
  }, []);

  const handleSignOut = async () => {
    const signOutLocal = async () => {
      try { await secureSignOut({ scope: 'local', userId: profile?.id }); } catch {}
    };
    if (Platform.OS === 'web') {
      if (window.confirm('Sign out of this device?')) await signOutLocal();
      return;
    }
    const { Alert } = require('react-native');
    Alert.alert('Sign out?', 'Sign out of this device?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: () => { void signOutLocal(); } },
    ]);
  };

  const saveBio = async () => {
    if (!profile || bioSaving) return;
    const previousBio = profile.bio;
    const trimmed = bioText.trim();
    setBioSaving(true);
    setBioError(null);
    setProfile({ ...profile, bio: trimmed });
    const { error } = await supabase.from('profiles').update({ bio: trimmed }).eq('id', profile.id);
    if (error) {
      console.error('Failed to save bio:', error);
      setProfile({ ...profile, bio: previousBio });
      setBioError('Bio could not be saved. Try again.');
    } else {
      setEditingBio(false);
    }
    setBioSaving(false);
  };

  const updateThemeColor = async (color: string) => {
    if (!profile || themeSaving) return;
    const previousColor = profile.theme_color;
    setThemeSaving(true);
    setThemeError(null);
    setProfile({ ...profile, theme_color: color });
    const { error } = await supabase.from('profiles').update({ theme_color: color }).eq('id', profile.id);
    if (error) {
      console.error('Failed to update theme color:', error);
      setProfile({ ...profile, theme_color: previousColor });
      setThemeError('Theme color could not be saved. Try again.');
    } else {
      setShowThemeSelector(false);
    }
    setThemeSaving(false);
  };

  const unlockedIds = new Set(userBadges.map((badge) => badge.achievement_id));
  const unlockedMap = new Map(userBadges.map((badge) => [badge.achievement_id, badge.unlocked_at]));
  const pinnedAchievements = (profile?.pinned_achievements || [])
    .map((id) => allBadges.find((badge) => badge.id === id))
    .filter(Boolean)
    .slice(0, 3) as Achievement[];
  const connectedPlatforms = integrations.filter((integration) => integration.is_active).slice(0, 4);
  const activeKeys = apiKeys.filter((key) => key.isActive);
  const activeAgents = agents.filter((agent) => agent.is_active).slice(0, 3);

  return (
    <View testID="profile-dashboard" style={styles.container}>
      <View testID="profile-dashboard-header" style={[styles.header, isDesktop && styles.headerDesktop]}>
        <View style={styles.headerCopy}>
          <Text style={[styles.headerEyebrow, { color: themeColor }]}>WORKSPACE</Text>
          <Text style={styles.headerTitle} numberOfLines={1}>Profile</Text>
          <Text style={styles.headerSubtitle}>Account, progress, and workspace settings</Text>
        </View>
        <View style={styles.headerActions}>
          <Pressable
            onPress={() => navigation.navigate('EditProfile')}
            accessibilityRole="button"
            accessibilityLabel="Edit profile"
            style={({ hovered, pressed, focused }: any) => [
              styles.headerActionButton,
              hovered && styles.controlHovered,
              pressed && styles.controlPressed,
              focused && Platform.OS === 'web' && styles.controlFocused,
            ]}
          >
            <Text style={styles.headerActionText}>EDIT PROFILE</Text>
          </Pressable>
          <Pressable
            onPress={handleSignOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out of this device"
            style={({ hovered, pressed, focused }: any) => [
              styles.headerActionButton,
              styles.headerDangerButton,
              hovered && styles.headerDangerHovered,
              pressed && styles.controlPressed,
              focused && Platform.OS === 'web' && styles.controlFocused,
            ]}
          >
            <Text style={styles.headerDangerText}>LOG OUT</Text>
          </Pressable>
        </View>
      </View>

      <View style={[styles.inner, isDesktop && styles.innerDesktop]}>
        {profileLoadError ? (
          <View style={styles.errorNotice}>
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>Some profile details could not be loaded</Text>
              <Text style={styles.errorText}>{profileLoadError}</Text>
            </View>
            <Pressable
              onPress={() => { void loadAll(); }}
              accessibilityRole="button"
              accessibilityLabel="Retry loading profile details"
              style={styles.noticeAction}
            >
              <Text style={styles.noticeActionText}>RETRY</Text>
            </Pressable>
          </View>
        ) : null}

        {profileLoading && !profile ? (
          <View style={styles.loadingPanel}>
            <ActivityIndicator color={themeColor} size="small" />
            <Text style={styles.loadingText}>Loading profile…</Text>
          </View>
        ) : profile ? (
          <>
            <View testID="profile-summary" style={styles.dashboardPanel}>
              <View style={[styles.identityRow, !isDesktop && styles.identityRowCompact]}>
                <Pressable
                  onPress={() => navigation.navigate('EditProfile')}
                  accessibilityRole="button"
                  accessibilityLabel="Edit profile photo and details"
                  style={({ focused }: any) => [
                    styles.avatarButton,
                    { borderColor: `${themeColor}90` },
                    focused && Platform.OS === 'web' && styles.controlFocused,
                  ]}
                >
                  {profile.avatar_url ? (
                    <Image source={{ uri: profile.avatar_url }} style={styles.avatarImage} accessibilityLabel={`${profile.display_name || profile.username} profile photo`} />
                  ) : (
                    <Text style={styles.avatarText}>{profile.display_name?.charAt(0)?.toUpperCase() || profile.username?.charAt(0)?.toUpperCase() || '?'}</Text>
                  )}
                </Pressable>

                <View style={styles.identityCopy}>
                  <Text style={styles.displayName} numberOfLines={1}>{profile.display_name || profile.username || 'Member'}</Text>
                  <Text style={styles.username} numberOfLines={1}>@{profile.username || 'member'}</Text>
                  {profile.status_message ? <Text style={styles.statusMessage} numberOfLines={2}>{profile.status_message}</Text> : null}
                  <View style={styles.identityMetaRow}>
                    <View style={[styles.metaPill, { borderColor: `${themeColor}55`, backgroundColor: `${themeColor}14` }]}>
                      <Text style={[styles.metaPillText, { color: themeColor }]}>{levelInfo.title}</Text>
                    </View>
                    <Text style={styles.memberSince}>
                      Joined {new Date(profile.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                    </Text>
                    {profile.banner_url ? <Text style={styles.memberSince}>Custom banner</Text> : null}
                  </View>
                </View>

                <View style={[styles.progressBlock, !isDesktop && styles.progressBlockCompact]}>
                  <View style={styles.progressHeader}>
                    <Text style={[styles.levelText, { color: themeColor }]}>LEVEL {levelInfo.level}</Text>
                    <Text style={styles.progressXP}>{fmt(xp)} XP</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <View style={[styles.progressFill, { width: `${progressPercent}%` as any, backgroundColor: themeColor }]} />
                  </View>
                  <Text style={styles.progressHint}>
                    {levelInfo.level >= 100
                      ? 'Maximum level reached'
                      : `${fmt(Math.max(0, xp - currentLevelXP))} / ${fmt(Math.max(1, nextLevelXP - currentLevelXP))} XP to next level`}
                  </Text>
                </View>
              </View>

              <View style={styles.metricGrid}>
                <Metric label={totalUsers > 0 ? `RANK / ${totalUsers}` : 'RANK'} value={rank === null ? '—' : `#${rank}`} accent={rank === null ? undefined : themeColor} />
                <Metric label="GRIND KARMA" value={fmt(grindKarma)} />
                <Metric label="SOCIAL KARMA" value={fmt(socialKarma)} />
                <Metric label="STREAK" value={`${profile.current_streak || 0}D`} />
                <Metric label="BEST" value={`${profile.longest_streak || 0}D`} />
                <Metric label="CHECK-INS" value={fmt(totalCheckIns)} />
                <Metric label="CIRCLES" value={String(circlesJoined)} />
                <Metric
                  label="AGENT TOKENS · LIFETIME"
                  value={agentLifetimeUsage.status === 'ready' ? fmt(agentLifetimeUsage.tokens) : '—'}
                  accent={agentLifetimeUsage.status === 'ready' ? themeColor : undefined}
                />
                <Metric
                  label="AGENT SPEND · LIFETIME"
                  value={agentLifetimeUsage.status === 'ready' ? `$${agentLifetimeUsage.cost.toFixed(2)}` : '—'}
                  accent={agentLifetimeUsage.status === 'ready' ? themeColor : undefined}
                />
              </View>
            </View>

            <View style={[styles.dashboardGrid, isDesktop && styles.dashboardGridDesktop]}>
              <DashboardSection testID="profile-activity" title="Recent activity" meta={`${recentActivity.length}`} style={styles.dashboardColumn}>
                {recentActivity.length > 0 ? (
                  <View style={styles.list}>
                    {recentActivity.map((event) => (
                      <View key={event.id} style={styles.activityRow}>
                        <View style={[styles.activityDot, { backgroundColor: themeColor }]} />
                        <View style={styles.activityCopy}>
                          <Text style={styles.activityTitle} numberOfLines={1}>{getEventLabel(event.event_type)}</Text>
                          <Text style={styles.activityMeta}>{getTimeAgo(event.created_at)}</Text>
                        </View>
                        <Text style={[styles.activityXP, { color: themeColor }]}>+{event.xp_amount} XP</Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <CompactEmpty title="No recent activity" hint="Your latest XP events will appear here." />
                )}
              </DashboardSection>

              <DashboardSection
                testID="profile-achievements"
                title="Achievements"
                meta={`${userBadges.length}/${allBadges.length}`}
                actionLabel="CUSTOMIZE"
                onAction={() => navigation.navigate('EditProfile')}
                style={styles.dashboardColumn}
              >
                <Text style={styles.groupLabel}>PINNED</Text>
                {pinnedAchievements.length > 0 ? (
                  <View style={styles.pinnedRow}>
                    {pinnedAchievements.map((badge) => (
                      <Pressable
                        key={badge.id}
                        onPress={() => setSelectedBadge({ ...badge, unlocked_at: unlockedMap.get(badge.id) })}
                        accessibilityRole="button"
                        accessibilityLabel={`Open ${badge.name} achievement details`}
                        style={({ hovered, pressed, focused }: any) => [
                          styles.achievementButton,
                          hovered && styles.controlHovered,
                          pressed && styles.controlPressed,
                          focused && Platform.OS === 'web' && styles.controlFocused,
                        ]}
                      >
                        <Text style={styles.achievementIcon}>{badge.icon}</Text>
                        <Text style={styles.achievementName} numberOfLines={1}>{badge.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <CompactEmpty title="Nothing pinned" hint="Choose up to three achievements in Edit Profile." onPress={() => navigation.navigate('EditProfile')} />
                )}

                <View style={styles.sectionDivider} />
                <Text style={styles.groupLabel}>ALL BADGES</Text>
                {allBadges.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badgeRow}>
                    {allBadges.map((badge) => {
                      const unlocked = unlockedIds.has(badge.id);
                      return (
                        <Pressable
                          key={badge.id}
                          onPress={() => setSelectedBadge({ ...badge, unlocked_at: unlockedMap.get(badge.id) })}
                          accessibilityRole="button"
                          accessibilityLabel={`${badge.name}, ${unlocked ? 'unlocked' : 'locked'}`}
                          style={({ hovered, pressed, focused }: any) => [
                            styles.badgeButton,
                            !unlocked && styles.badgeLocked,
                            hovered && styles.controlHovered,
                            pressed && styles.controlPressed,
                            focused && Platform.OS === 'web' && styles.controlFocused,
                          ]}
                        >
                          <Text style={styles.badgeIcon}>{unlocked ? badge.icon : '○'}</Text>
                          <Text style={styles.badgeName} numberOfLines={1}>{badge.name}</Text>
                        </Pressable>
                      );
                    })}
                  </ScrollView>
                ) : (
                  <CompactEmpty title="No achievements available" hint="Achievements will appear here when configured." />
                )}
              </DashboardSection>
            </View>

            <DashboardSection
              testID="profile-connections"
              title="Connections"
              actionLabel="MANAGE"
              onAction={() => navigation.navigate('Integrations')}
            >
              <View style={styles.resourceGroup}>
                <Text style={styles.groupLabel}>ACCOUNTS</Text>
                {connectedPlatforms.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resourceRow}>
                    {connectedPlatforms.map((integration) => {
                      const platform = platformConnections[integration.platform as keyof typeof platformConnections];
                      if (!platform) return null;
                      return (
                        <ResourceChip
                          key={integration.id}
                          glyph={platform.icon}
                          title={platform.name}
                          meta={`@${integration.platform_username || 'connected'}`}
                          accent={themeColor}
                          onPress={() => navigation.navigate('Integrations')}
                        />
                      );
                    })}
                    <ResourceChip glyph="+" title="Connect account" meta="Add a service" accent={themeColor} onPress={() => navigation.navigate('Integrations')} />
                  </ScrollView>
                ) : (
                  <CompactEmpty title="Connect an account" hint="Add GitHub, Discord, Spotify, and other services." onPress={() => navigation.navigate('Integrations')} />
                )}
              </View>

              <View style={styles.sectionDivider} />
              <View style={styles.resourceGroup}>
                <Text style={styles.groupLabel}>AI MODELS</Text>
                {apiKeysLoading ? (
                  <View style={styles.inlineLoading}>
                    <ActivityIndicator color={themeColor} size="small" />
                    <Text style={styles.loadingText}>Loading model connections…</Text>
                  </View>
                ) : activeKeys.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resourceRow}>
                    {activeKeys.map((key) => {
                      const meta = LLM_PROVIDER_META[key.provider] || { label: key.provider, glyph: 'A', accent: PD.accent };
                      return (
                        <ResourceChip
                          key={key.id}
                          glyph={meta.glyph}
                          title={meta.label}
                          meta={key.label || 'Connected'}
                          accent={meta.accent}
                          onPress={() => navigation.navigate('Integrations')}
                        />
                      );
                    })}
                    <ResourceChip glyph="+" title="Add model" meta="Connect a provider" accent={themeColor} onPress={() => navigation.navigate('Integrations')} />
                  </ScrollView>
                ) : (
                  <CompactEmpty title="Connect an AI model" hint="Add OpenAI, Anthropic, OpenRouter, or another provider." onPress={() => navigation.navigate('Integrations')} />
                )}
              </View>

              <View style={styles.sectionDivider} />
              <View style={styles.resourceGroup}>
                <View style={styles.groupHeader}>
                  <Text style={styles.groupLabel}>AI AGENTS</Text>
                  <Pressable onPress={() => navigation.navigate('Agents')} accessibilityRole="button" accessibilityLabel="Manage AI agents">
                    <Text style={[styles.inlineLink, { color: themeColor }]}>MANAGE</Text>
                  </Pressable>
                </View>
                {activeAgents.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.resourceRow}>
                    {activeAgents.map((agent) => (
                      <ResourceChip
                        key={agent.id}
                        glyph={agent.name?.charAt(0)?.toUpperCase() || 'A'}
                        title={agent.name}
                        meta={`${agent.type.toUpperCase()} · ACTIVE`}
                        accent={PD.success}
                        onPress={() => navigation.navigate('Agents')}
                      />
                    ))}
                    <ResourceChip glyph="+" title="Add agent" meta="Create an assistant" accent={themeColor} onPress={() => navigation.navigate('Agents')} />
                  </ScrollView>
                ) : (
                  <CompactEmpty title="Create an AI agent" hint="Add an assistant for recurring work." onPress={() => navigation.navigate('Agents')} />
                )}
              </View>
            </DashboardSection>

            <View style={[styles.dashboardGrid, isDesktop && styles.dashboardGridDesktop]}>
              <DashboardSection
                testID="profile-community"
                title="Community"
                actionLabel="VIEW FRIENDS"
                onAction={() => navigation.navigate('Friends')}
                style={styles.dashboardColumn}
              >
                {friends.length > 0 ? (
                  <View style={styles.friendSummary}>
                    <View>
                      <Text style={styles.friendCount}>{friends.length}</Text>
                      <Text style={styles.metricLabel}>FRIENDS</Text>
                    </View>
                    <View style={styles.friendAvatars}>
                      {friends.slice(0, 5).map((friend, index) => (
                        <View key={friend.id} style={[styles.friendAvatar, { zIndex: 6 - index }]}>
                          <Text style={styles.friendAvatarText}>{friend.friend?.display_name?.charAt(0)?.toUpperCase() || '?'}</Text>
                        </View>
                      ))}
                      {friends.length > 5 ? (
                        <View style={[styles.friendAvatar, styles.friendAvatarMore]}>
                          <Text style={styles.friendAvatarText}>+{friends.length - 5}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                ) : (
                  <CompactEmpty title="No friends yet" hint="Connect with people in your circles." onPress={() => navigation.navigate('Friends')} />
                )}
                <Pressable
                  onPress={() => navigation.navigate('Friends')}
                  accessibilityRole="button"
                  accessibilityLabel="Invite friends"
                  style={({ hovered, pressed, focused }: any) => [
                    styles.primaryButton,
                    { backgroundColor: themeColor },
                    hovered && { opacity: 0.9 },
                    pressed && styles.controlPressed,
                    focused && Platform.OS === 'web' && styles.controlFocused,
                  ]}
                >
                  <Text style={styles.primaryButtonText}>INVITE FRIENDS</Text>
                </Pressable>
              </DashboardSection>

              <DashboardSection testID="profile-details" title="Profile details" style={styles.dashboardColumn}>
                <View style={styles.detailHeader}>
                  <Text style={styles.groupLabel}>BIO</Text>
                  <Pressable
                    onPress={() => {
                      if (editingBio) setBioText(profile.bio || '');
                      setBioError(null);
                      setEditingBio(!editingBio);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={editingBio ? 'Cancel editing bio' : 'Edit bio'}
                  >
                    <Text style={[styles.inlineLink, { color: themeColor }]}>{editingBio ? 'CANCEL' : 'EDIT'}</Text>
                  </Pressable>
                </View>
                {editingBio ? (
                  <View style={styles.bioEditor}>
                    <TextInput
                      value={bioText}
                      onChangeText={setBioText}
                      placeholder="Tell people a little about yourself…"
                      placeholderTextColor={PD.textMuted}
                      multiline
                      maxLength={200}
                      accessibilityLabel="Profile bio"
                      style={styles.bioInput}
                    />
                    {bioError ? <Text style={styles.fieldError}>{bioError}</Text> : null}
                    <Pressable
                      onPress={() => { void saveBio(); }}
                      disabled={bioSaving}
                      accessibilityRole="button"
                      accessibilityLabel="Save profile bio"
                      style={[styles.secondaryButton, bioSaving && styles.controlDisabled]}
                    >
                      <Text style={styles.secondaryButtonText}>{bioSaving ? 'SAVING…' : 'SAVE BIO'}</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Text style={styles.bioText}>{profile.bio || 'No bio yet.'}</Text>
                )}

                <View style={styles.sectionDivider} />
                <View style={styles.detailHeader}>
                  <Text style={styles.groupLabel}>ACCENT COLOR</Text>
                  <Pressable
                    onPress={() => { setThemeError(null); setShowThemeSelector((current) => !current); }}
                    accessibilityRole="button"
                    accessibilityLabel={showThemeSelector ? 'Close accent color selector' : 'Change accent color'}
                    accessibilityState={{ expanded: showThemeSelector }}
                  >
                    <Text style={[styles.inlineLink, { color: themeColor }]}>{showThemeSelector ? 'CLOSE' : 'CHANGE'}</Text>
                  </Pressable>
                </View>
                <View style={styles.themeSummary}>
                  <View style={[styles.themeSwatch, { backgroundColor: themeColor }]} />
                  <Text style={styles.themeName}>{themeColorName(themeColor)}</Text>
                  {themeSaving ? <ActivityIndicator color={themeColor} size="small" /> : null}
                </View>
                {showThemeSelector ? (
                  <View style={styles.themeOptions}>
                    {THEME_COLORS.map((color) => (
                      <Pressable
                        key={color}
                        onPress={() => { void updateThemeColor(color); }}
                        disabled={themeSaving}
                        accessibilityRole="button"
                        accessibilityLabel={`Use ${themeColorName(color)} accent color`}
                        accessibilityState={{ selected: themeColor === color, disabled: themeSaving }}
                        style={[
                          styles.themeOption,
                          { backgroundColor: color },
                          themeColor === color && styles.themeOptionSelected,
                          themeSaving && styles.controlDisabled,
                        ]}
                      />
                    ))}
                  </View>
                ) : null}
                {themeError ? <Text style={styles.fieldError}>{themeError}</Text> : null}
              </DashboardSection>
            </View>

            <MentionsInbox />
          </>
        ) : null}
      </View>

      {selectedBadge ? (
        <Modal transparent animationType="fade" visible onRequestClose={() => setSelectedBadge(null)}>
          <View style={styles.modalBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={() => setSelectedBadge(null)}
              accessibilityRole="button"
              accessibilityLabel="Close achievement details"
            />
            <View accessibilityViewIsModal style={styles.modalCard}>
              <Pressable
                onPress={() => setSelectedBadge(null)}
                accessibilityRole="button"
                accessibilityLabel="Close achievement details"
                style={styles.modalClose}
              >
                <Text style={styles.modalCloseText}>×</Text>
              </Pressable>
              <Text style={styles.modalIcon}>{selectedBadge.icon}</Text>
              <Text style={styles.modalTitle}>{selectedBadge.name}</Text>
              <Text style={styles.modalDescription}>{selectedBadge.description}</Text>
              <View style={[styles.metaPill, { borderColor: `${themeColor}55`, backgroundColor: `${themeColor}14` }]}>
                <Text style={[styles.metaPillText, { color: themeColor }]}>+{selectedBadge.xp_reward} XP</Text>
              </View>
              <Text style={selectedBadge.unlocked_at ? styles.modalUnlocked : styles.modalLocked}>
                {selectedBadge.unlocked_at
                  ? `Unlocked ${new Date(selectedBadge.unlocked_at).toLocaleDateString()}`
                  : 'Not yet unlocked'}
              </Text>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: PD.canvas,
  },
  header: {
    width: '100%',
    minHeight: 64,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: PD.border,
    backgroundColor: PD.header,
  },
  headerDesktop: {
    paddingHorizontal: 20,
  },
  headerCopy: {
    flex: 1,
    minWidth: 180,
  },
  headerEyebrow: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginBottom: 2,
  },
  headerTitle: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '800',
  },
  headerSubtitle: {
    color: PD.textMuted,
    fontFamily: FONT,
    fontSize: 11,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerActionButton: {
    minHeight: 34,
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: PD.controlRadius,
    borderWidth: 1,
    borderColor: PD.borderStrong,
    backgroundColor: PD.inset,
  },
  headerActionText: {
    color: PD.textSecondary,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  headerDangerButton: {
    borderColor: '#7f1d1d',
    backgroundColor: '#2a0c0c',
  },
  headerDangerHovered: {
    borderColor: PD.danger,
    backgroundColor: '#3a1010',
  },
  headerDangerText: {
    color: '#fca5a5',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  inner: {
    width: '100%',
    maxWidth: PD.maxWidth,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    gap: 12,
  },
  innerDesktop: {
    paddingHorizontal: 16,
  },
  dashboardPanel: {
    minWidth: 0,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: PD.panelRadius,
    backgroundColor: PD.panel,
    padding: 16,
  },
  panelHeader: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  panelTitle: {
    flex: 1,
    color: PD.text,
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  panelMeta: {
    color: PD.textMuted,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '800',
  },
  panelAction: {
    minHeight: 28,
    paddingHorizontal: 9,
    paddingVertical: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PD.borderStrong,
    borderRadius: PD.controlRadius,
    backgroundColor: PD.inset,
  },
  panelActionText: {
    color: PD.textSecondary,
    fontFamily: 'monospace',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  panelBody: {
    gap: 10,
  },
  dashboardGrid: {
    gap: 12,
  },
  dashboardGridDesktop: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  dashboardColumn: {
    flex: 1,
  },
  identityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  identityRowCompact: {
    flexWrap: 'wrap',
  },
  avatarButton: {
    width: 58,
    height: 58,
    flexShrink: 0,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 29,
    borderWidth: 1,
    backgroundColor: PD.inset,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  avatarText: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 22,
    fontWeight: '800',
  },
  identityCopy: {
    flex: 1,
    minWidth: 160,
  },
  displayName: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 18,
    fontWeight: '800',
  },
  username: {
    color: PD.textSecondary,
    fontFamily: FONT,
    fontSize: 12,
    marginTop: 2,
  },
  statusMessage: {
    maxWidth: 520,
    color: PD.textSecondary,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 7,
  },
  identityMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  metaPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  metaPillText: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  memberSince: {
    color: PD.textMuted,
    fontFamily: FONT,
    fontSize: 10,
  },
  progressBlock: {
    width: 250,
    flexShrink: 0,
    padding: 12,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 10,
    backgroundColor: PD.inset,
  },
  progressBlockCompact: {
    width: '100%',
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 8,
  },
  levelText: {
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  progressXP: {
    color: PD.textSecondary,
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '800',
  },
  progressTrack: {
    height: 5,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: PD.borderStrong,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressHint: {
    color: PD.textMuted,
    fontFamily: FONT,
    fontSize: 10,
    marginTop: 7,
  },
  metricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: PD.border,
  },
  metricTile: {
    flexGrow: 1,
    minWidth: 105,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  metricValue: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '800',
  },
  metricLabel: {
    color: PD.textMuted,
    fontFamily: 'monospace',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.8,
    marginTop: 3,
  },
  list: {
    gap: 6,
  },
  activityRow: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  activityDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  activityCopy: {
    flex: 1,
    minWidth: 0,
  },
  activityTitle: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '700',
  },
  activityMeta: {
    color: PD.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    marginTop: 2,
  },
  activityXP: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  groupLabel: {
    color: PD.textMuted,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
  },
  inlineLink: {
    fontFamily: 'monospace',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  pinnedRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  achievementButton: {
    minWidth: 110,
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  achievementIcon: {
    fontSize: 18,
  },
  achievementName: {
    flex: 1,
    color: PD.text,
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '700',
  },
  badgeRow: {
    gap: 6,
    paddingRight: 4,
  },
  badgeButton: {
    width: 94,
    minHeight: 66,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    padding: 8,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  badgeLocked: {
    opacity: 0.45,
  },
  badgeIcon: {
    color: PD.textMuted,
    fontSize: 19,
  },
  badgeName: {
    maxWidth: '100%',
    color: PD.textSecondary,
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
  },
  sectionDivider: {
    height: 1,
    backgroundColor: PD.border,
    marginVertical: 2,
  },
  resourceGroup: {
    gap: 8,
  },
  resourceRow: {
    gap: 7,
    paddingRight: 4,
  },
  resourceChip: {
    width: 170,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  resourceGlyph: {
    width: 30,
    height: 30,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 8,
  },
  resourceGlyphText: {
    fontFamily: 'monospace',
    fontSize: 12,
    fontWeight: '900',
  },
  resourceCopy: {
    flex: 1,
    minWidth: 0,
  },
  resourceTitle: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 11,
    fontWeight: '800',
  },
  resourceMeta: {
    color: PD.textMuted,
    fontFamily: FONT,
    fontSize: 9,
    marginTop: 2,
  },
  friendSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  friendCount: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 20,
    fontWeight: '800',
  },
  friendAvatars: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
  },
  friendAvatar: {
    width: 30,
    height: 30,
    marginLeft: -8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: PD.panel,
    borderRadius: 15,
    backgroundColor: PD.borderStrong,
  },
  friendAvatarMore: {
    backgroundColor: PD.hover,
  },
  friendAvatarText: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 9,
    fontWeight: '800',
  },
  primaryButton: {
    minHeight: 36,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: PD.controlRadius,
  },
  primaryButtonText: {
    color: '#fff',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  detailHeader: {
    minHeight: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  bioText: {
    color: PD.textSecondary,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 18,
  },
  bioEditor: {
    gap: 8,
  },
  bioInput: {
    minHeight: 88,
    color: PD.text,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 18,
    textAlignVertical: 'top',
    padding: 10,
    borderWidth: 1,
    borderColor: PD.borderStrong,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  secondaryButton: {
    minHeight: 34,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: PD.borderStrong,
    borderRadius: PD.controlRadius,
    backgroundColor: PD.inset,
  },
  secondaryButtonText: {
    color: PD.textSecondary,
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  themeSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    minHeight: 36,
  },
  themeSwatch: {
    width: 22,
    height: 22,
    borderRadius: 11,
  },
  themeName: {
    flex: 1,
    color: PD.textSecondary,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '700',
  },
  themeOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 9,
    padding: 10,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  themeOption: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeOptionSelected: {
    borderColor: PD.text,
  },
  emptyState: {
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    padding: 12,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  emptyTitle: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyHint: {
    maxWidth: 420,
    color: PD.textMuted,
    fontFamily: FONT,
    fontSize: 10,
    lineHeight: 15,
    textAlign: 'center',
  },
  inlineLoading: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: 8,
    backgroundColor: PD.inset,
  },
  loadingPanel: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: PD.border,
    borderRadius: PD.panelRadius,
    backgroundColor: PD.panel,
  },
  loadingText: {
    color: PD.textMuted,
    fontFamily: FONT,
    fontSize: 11,
  },
  errorNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    borderRadius: 10,
    backgroundColor: '#2a0c0c',
  },
  errorCopy: {
    flex: 1,
    minWidth: 0,
  },
  errorTitle: {
    color: '#fecaca',
    fontFamily: FONT,
    fontSize: 12,
    fontWeight: '800',
  },
  errorText: {
    color: '#fca5a5',
    fontFamily: FONT,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  noticeAction: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#ef444466',
    borderRadius: PD.controlRadius,
    backgroundColor: '#3a1010',
  },
  noticeActionText: {
    color: '#fecaca',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.7,
  },
  fieldError: {
    color: PD.danger,
    fontFamily: FONT,
    fontSize: 10,
    lineHeight: 15,
  },
  controlHovered: {
    borderColor: '#334155',
    backgroundColor: PD.hover,
  },
  controlPressed: {
    opacity: 0.78,
  },
  controlDisabled: {
    opacity: 0.5,
  },
  controlFocused: {
    borderColor: PD.accent,
    ...(Platform.OS === 'web' ? {
      outlineStyle: 'solid',
      outlineWidth: 2,
      outlineColor: `${PD.accent}80`,
      outlineOffset: 2,
    } as any : {}),
  },
  modalBackdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    gap: 9,
    padding: 22,
    borderWidth: 1,
    borderColor: PD.borderStrong,
    borderRadius: PD.panelRadius,
    backgroundColor: PD.panel,
  },
  modalClose: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: PD.borderStrong,
    borderRadius: PD.controlRadius,
    backgroundColor: PD.inset,
  },
  modalCloseText: {
    color: PD.textSecondary,
    fontSize: 17,
    lineHeight: 18,
  },
  modalIcon: {
    fontSize: 36,
  },
  modalTitle: {
    color: PD.text,
    fontFamily: FONT,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  modalDescription: {
    color: PD.textSecondary,
    fontFamily: FONT,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  modalUnlocked: {
    color: PD.success,
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '700',
  },
  modalLocked: {
    color: PD.textMuted,
    fontFamily: FONT,
    fontSize: 10,
    fontWeight: '700',
  },
});
