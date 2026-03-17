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

const fmt = (n: number) => n.toLocaleString();

function getLevelColor(level: number): string {
  if (level >= 50) return '#fbbf24'; // gold
  if (level >= 30) return '#a855f7'; // purple
  if (level >= 15) return '#3b82f6'; // blue
  if (level >= 5) return '#22c55e'; // green
  return '#666'; // gray
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

export default function ProfileScreen({ navigation }: any) {
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
    Animated.timing(xpAnim, {
      toValue: levelInfo.progress,
      duration: 1000,
      useNativeDriver: false,
    }).start();
  }, [levelInfo.progress]);

  const loadAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
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
    await supabase.from('profiles').update({ bio: bioText.trim() }).eq('id', profile.id);
    setProfile({ ...profile, bio: bioText.trim() });
    setEditingBio(false);
  };

  const updateThemeColor = async (color: string) => {
    if (!profile) return;
    await supabase.from('profiles').update({ theme_color: color }).eq('id', profile.id);
    setProfile({ ...profile, theme_color: color });
    setShowThemeSelector(false);
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

  return (
    <View style={styles.container}>
      <View style={[styles.header, isDesktop && styles.headerDesktop]}>
        <Text style={styles.headerTitle}>PROFILE</Text>
        <Pressable onPress={() => navigation.navigate('EditProfile')}>
          <Text style={styles.editButton}>EDIT</Text>
        </Pressable>
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

          {/* Hero Section */}
          <Card style={styles.heroCard}>
            <View style={styles.heroSection}>
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
              {profile?.status_message && (
                <Text style={styles.statusMessage}>"{profile.status_message}"</Text>
              )}
              
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
          </Card>

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
               themeColor === '#8b5cf6' ? 'Purple' :
               themeColor === '#06b6d4' ? 'Cyan' :
               themeColor === '#10b981' ? 'Emerald' :
               themeColor === '#f59e0b' ? 'Amber' :
               themeColor === '#ef4444' ? 'Red' :
               themeColor === '#ec4899' ? 'Pink' :
               themeColor === '#84cc16' ? 'Lime' : 'Custom'}
            </Text>
          </View>
          
          {showThemeSelector && (
            <Card style={styles.themeSelector}>
              <View style={styles.themeColors}>
                {['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#84cc16'].map(color => (
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

          {/* Activity + Rank side-by-side on desktop */}
          <View style={isDesktop ? styles.activityRankRow : undefined}>
            {/* Recent Activity */}
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

            {/* Leaderboard Preview */}
            {rank !== null && (
              <View style={isDesktop ? { width: 160, flexShrink: 0 } : undefined}>
                {isDesktop && <View style={styles.sectionHeader}><Text style={styles.sectionTitle}>RANK</Text></View>}
                <Card style={styles.rankCard}>
                  <Text style={styles.rankLabel}>YOUR RANK</Text>
                  <Text style={styles.rankNumber}>#{rank}</Text>
                  <Text style={styles.rankOf}>of {totalUsers} users</Text>
                </Card>
              </View>
            )}
          </View>

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
          <Button
            title="SIGN OUT"
            variant="ghost"
            onPress={handleSignOut}
            style={styles.signOutButton}
          />
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60, paddingBottom: 20, paddingHorizontal: 24,
    borderBottomWidth: 1, borderBottomColor: '#222',
    maxWidth: 480, alignSelf: 'center' as const, width: '100%',
  },
  headerDesktop: { maxWidth: 640 },
  headerTitle: { color: '#fff', fontSize: 22, fontWeight: '900', letterSpacing: 3 },
  editButton: { color: '#6366f1', fontSize: 14, fontWeight: '700', letterSpacing: 1 },
  scrollContent: { flexGrow: 1 },
  inner: { width: '100%', maxWidth: 480, alignSelf: 'center' as const, paddingHorizontal: 20, paddingTop: 20 },
  innerDesktop: { maxWidth: 640 },

  // Hero
  heroCard: { alignItems: 'center', padding: 28, marginBottom: 12 },
  heroSection: { alignItems: 'center' },
  avatarRing: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, justifyContent: 'center', alignItems: 'center', marginBottom: 14 },
  avatar: { width: 78, height: 78, borderRadius: 39, backgroundColor: '#2a2a2a', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '900' },
  displayName: { color: '#fff', fontSize: 22, fontWeight: '700' },
  username: { color: '#666', fontSize: 14, marginTop: 2 },
  titleBadge: { borderWidth: 1, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 12, marginTop: 10 },
  titleText: { fontSize: 11, fontWeight: '800', letterSpacing: 2 },
  memberSince: { color: '#444', fontSize: 11, marginTop: 8 },

  // XP Bar
  xpCard: { marginBottom: 12, padding: 18 },
  xpLevel: { color: '#fff', fontSize: 13, fontWeight: '800', letterSpacing: 2 },
  xpNumbers: { color: '#888', fontSize: 12, fontWeight: '600' },
  xpBarBg: { height: 8, backgroundColor: '#000000', borderRadius: 4, overflow: 'hidden' },
  xpBarFill: {
    height: '100%', borderRadius: 4,
    backgroundColor: '#6366f1',
    ...(Platform.OS === 'web' ? { backgroundImage: 'linear-gradient(90deg, #6366f1, #a855f7)' } as any : {}),
  },
  xpTotal: { color: '#555', fontSize: 10, letterSpacing: 2, fontWeight: '700', marginTop: 8, textAlign: 'center' },

  // Karma
  karmaRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  karmaCard: { flex: 1, alignItems: 'center', padding: 18 },
  karmaEmoji: { fontSize: 24, marginBottom: 6 },
  karmaNumber: { color: '#fff', fontSize: 28, fontWeight: '900' },
  karmaLabel: { color: '#666', fontSize: 9, letterSpacing: 1.5, fontWeight: '700', marginTop: 4 },

  // Stats Grid
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  statCard: { width: '47%', alignItems: 'center', padding: 16 },
  statNumber: { color: '#fff', fontSize: 26, fontWeight: '900', marginBottom: 4 },
  statLabel: { color: '#666', fontSize: 9, letterSpacing: 1, fontWeight: '700', textAlign: 'center' },

  // Desktop combined karma + stats row
  karmaStatsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCardInline: { flex: 1, alignItems: 'center', padding: 14, minWidth: 80 },

  // Desktop activity + rank side-by-side
  activityRankRow: { flexDirection: 'row', gap: 16 },
  activityRankCol: { flex: 1 },

  // Sections
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, marginTop: 8 },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 2 },
  sectionCount: { color: '#666', fontSize: 12, fontWeight: '700' },

  // Badges
  badgeScroll: { marginBottom: 16 },
  badgeItem: { alignItems: 'center', marginRight: 16, width: 70 },
  badgeLocked: { opacity: 0.35 },
  badgeIcon: { fontSize: 32, marginBottom: 4 },
  badgeIconLocked: {},
  badgeName: { color: '#ccc', fontSize: 10, fontWeight: '600', textAlign: 'center' },
  badgeNameLocked: { color: '#555' },

  // Activity
  activityCard: { marginBottom: 16, padding: 0 },
  activityItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  activityBorder: { borderTopWidth: 1, borderTopColor: '#000000' },
  activityText: { color: '#ccc', fontSize: 13, flex: 1 },
  activityTime: { color: '#444', fontSize: 11, marginLeft: 8 },

  // Rank
  rankCard: { alignItems: 'center', padding: 20, marginBottom: 16, marginTop: 8 },
  rankLabel: { color: '#666', fontSize: 10, letterSpacing: 2, fontWeight: '700' },
  rankNumber: { color: '#fff', fontSize: 40, fontWeight: '900', marginVertical: 4 },
  rankOf: { color: '#555', fontSize: 12 },

  // Bio
  editLink: { color: '#6366f1', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  bioCard: { marginBottom: 16 },
  bioText: { color: '#999', fontSize: 14, lineHeight: 20 },
  bioEditCard: { marginBottom: 16, gap: 12 },
  bioInput: { backgroundColor: '#000000', borderWidth: 1, borderColor: '#222', borderRadius: 10, padding: 14, color: '#fff', fontSize: 14, minHeight: 80, textAlignVertical: 'top' },

  signOutButton: { borderWidth: 1, borderColor: '#222' },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { backgroundColor: '#111', borderRadius: 16, padding: 32, borderWidth: 1, borderColor: '#222', alignItems: 'center', width: '80%', maxWidth: 300 },
  modalIcon: { fontSize: 48, marginBottom: 12 },
  modalBadgeName: { color: '#fff', fontSize: 18, fontWeight: '800', marginBottom: 6 },
  modalDesc: { color: '#888', fontSize: 13, textAlign: 'center', marginBottom: 10 },
  modalXP: { color: '#a855f7', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  modalUnlocked: { color: '#4a9a4a', fontSize: 12 },
  modalLocked: { color: '#666', fontSize: 12 },

  // New customizable styles
  bannerContainer: { marginBottom: -24, height: 140, marginHorizontal: 0, borderRadius: 14, overflow: 'hidden', zIndex: 0 },
  bannerPlaceholder: { 
    flex: 1, 
    backgroundColor: '#000000', 
    justifyContent: 'center', 
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  bannerPlaceholderText: { color: '#666', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  
  statusMessage: { 
    color: '#888', 
    fontSize: 14, 
    fontStyle: 'italic', 
    marginVertical: 8,
    textAlign: 'center',
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
    color: '#fff', 
    fontSize: 11, 
    fontWeight: '700', 
    textAlign: 'center',
    marginBottom: 4,
  },
  pinnedIndicator: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    position: 'absolute',
    bottom: -8,
  },
  pinnedText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1,
  },
  emptyPinnedCard: { 
    alignItems: 'center', 
    padding: 24,
    backgroundColor: '#0f0f0f',
    borderColor: '#000000',
  },
  emptyPinnedText: { color: '#666', fontSize: 14, fontWeight: '600' },
  emptyPinnedDesc: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 4, lineHeight: 16 },

  // Connected platforms
  platformsScroll: { marginBottom: 16 },
  platformCard: { 
    alignItems: 'center', 
    marginRight: 12, 
    minWidth: 80,
    padding: 12,
  },
  platformIcon: { fontSize: 24, marginBottom: 6 },
  platformName: { color: '#fff', fontSize: 10, fontWeight: '700', marginBottom: 2 },
  platformUsername: { color: '#666', fontSize: 9 },
  addPlatformCard: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    minWidth: 80,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 12,
  },
  addPlatformIcon: { color: '#666', fontSize: 20, marginBottom: 4 },
  addPlatformText: { color: '#666', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  emptyPlatformsCard: { 
    alignItems: 'center', 
    padding: 24,
    backgroundColor: '#0f0f0f',
    borderColor: '#000000',
  },
  emptyPlatformsText: { color: '#666', fontSize: 14, fontWeight: '600' },
  emptyPlatformsDesc: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 4, lineHeight: 16 },

  // Agents
  agentsScroll: { marginBottom: 16 },
  agentCard: { 
    alignItems: 'center', 
    marginRight: 12, 
    minWidth: 90,
    padding: 12,
    position: 'relative',
  },
  agentIcon: { fontSize: 24, marginBottom: 6 },
  agentName: { color: '#fff', fontSize: 11, fontWeight: '700', marginBottom: 2, textAlign: 'center' },
  agentType: { color: '#666', fontSize: 8, letterSpacing: 1, marginBottom: 4 },
  agentStatus: { flexDirection: 'row', alignItems: 'center' },
  agentStatusDot: { 
    width: 6, 
    height: 6, 
    borderRadius: 3, 
    backgroundColor: '#22c55e',
    marginRight: 4,
  },
  agentStatusText: { color: '#22c55e', fontSize: 8, fontWeight: '700' },
  addAgentCard: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    minWidth: 90,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#333',
    borderStyle: 'dashed',
    borderRadius: 14,
    padding: 12,
  },
  addAgentIcon: { color: '#666', fontSize: 20, marginBottom: 4 },
  addAgentText: { color: '#666', fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  emptyAgentsCard: { 
    alignItems: 'center', 
    padding: 24,
    backgroundColor: '#0f0f0f',
    borderColor: '#000000',
  },
  emptyAgentsText: { color: '#666', fontSize: 14, fontWeight: '600' },
  emptyAgentsDesc: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 4, lineHeight: 16 },

  // Friends
  friendsPreview: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#111',
    borderRadius: 14,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  friendsStats: { marginRight: 16 },
  friendsCount: { color: '#fff', fontSize: 24, fontWeight: '900' },
  friendsLabel: { color: '#666', fontSize: 10, letterSpacing: 1, fontWeight: '700' },
  friendsAvatars: { flexDirection: 'row', flex: 1 },
  friendAvatar: { 
    width: 32, 
    height: 32, 
    borderRadius: 16, 
    backgroundColor: '#2a2a2a',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: -8,
    borderWidth: 2,
    borderColor: '#111',
  },
  friendAvatarText: { color: '#fff', fontSize: 12, fontWeight: '900' },
  friendAvatarMore: { backgroundColor: '#333' },
  emptyFriendsCard: { 
    alignItems: 'center', 
    padding: 24,
    backgroundColor: '#0f0f0f',
    borderColor: '#000000',
  },
  emptyFriendsText: { color: '#666', fontSize: 14, fontWeight: '600' },
  emptyFriendsDesc: { color: '#444', fontSize: 12, textAlign: 'center', marginTop: 4, lineHeight: 16 },

  // Theme
  themePreview: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#222',
  },
  themeColorDot: { width: 24, height: 24, borderRadius: 12, marginRight: 12 },
  themeColorName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  themeSelector: { marginBottom: 16, padding: 16 },
  themeColors: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  themeColorOption: { 
    width: 32, 
    height: 32, 
    borderRadius: 16,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  themeColorSelected: { borderColor: '#fff' },

  // Invite
  inviteCard: { 
    alignItems: 'center', 
    padding: 24,
    marginBottom: 16,
    backgroundColor: '#0f0f0f',
    borderColor: '#000000',
  },
  inviteTitle: { 
    color: '#fff', 
    fontSize: 16, 
    fontWeight: '800', 
    letterSpacing: 2, 
    marginBottom: 8,
  },
  inviteDesc: { 
    color: '#666', 
    fontSize: 13, 
    textAlign: 'center', 
    lineHeight: 18,
    marginBottom: 16,
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
    backgroundColor: '#000000',
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
    color: '#666',
    fontSize: 10,
    fontWeight: '700',
    minWidth: 32,
    textAlign: 'right',
  },
  nextLevelText: {
    color: '#555',
    fontSize: 11,
    textAlign: 'center',
    fontWeight: '500',
  },
});
