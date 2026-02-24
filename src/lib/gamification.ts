import { supabase } from './supabase';
import { UserXP, Achievement, UserAchievement, XPEvent } from '../types';

// XP amounts for each action
const XP_AMOUNTS: Record<string, number> = {
  daily_login: 10,
  check_in: 25,
  task_complete: 30,
  circle_join: 50,
  circle_create: 75,
  upvote_received: 5,
};

// Title thresholds by level
const TITLES: [number, string][] = [
  [50, 'Underground King'],
  [40, 'Underground Boss'],
  [30, 'Legend'],
  [25, 'OG'],
  [20, 'Elite'],
  [15, 'Veteran'],
  [10, 'Hustler'],
  [5, 'Grinder'],
  [1, 'Recruit'],
];

export function getXPForAction(action: string): number {
  return XP_AMOUNTS[action] || 0;
}

export function getLevelInfo(xp: number): {
  level: number;
  title: string;
  currentXP: number;
  nextLevelXP: number;
  progress: number;
} {
  const level = Math.min(Math.floor(Math.sqrt(xp / 50)) + 1, 100);
  const title = TITLES.find(([l]) => level >= l)?.[1] || 'Recruit';

  // XP needed for current level: ((level-1)^2) * 50
  const currentLevelXP = Math.pow(level - 1, 2) * 50;
  // XP needed for next level: (level^2) * 50
  const nextLevelXP = level >= 100 ? currentLevelXP : Math.pow(level, 2) * 50;

  const xpIntoLevel = xp - currentLevelXP;
  const xpForLevel = nextLevelXP - currentLevelXP;
  const progress = xpForLevel > 0 ? Math.min(xpIntoLevel / xpForLevel, 1) : 1;

  return { level, title, currentXP: xp, nextLevelXP, progress };
}

export async function awardXP(
  userId: string,
  amount: number,
  eventType: string,
  metadata: Record<string, any> = {}
): Promise<{ total_xp: number; level: number } | null> {
  try {
    const { data, error } = await supabase.rpc('award_xp', {
      p_user_id: userId,
      p_amount: amount,
      p_event_type: eventType,
      p_metadata: metadata,
    });
    if (error) {
      console.error('awardXP error:', error);
      return null;
    }
    return data as { total_xp: number; level: number };
  } catch (error) {
    console.error('awardXP exception:', error);
    return null;
  }
}

export async function getUserXP(userId: string): Promise<UserXP | null> {
  try {
    const { data, error } = await supabase
      .from('user_xp')
      .select('*')
      .eq('user_id', userId)
      .single();
    if (error) return null;
    return data as UserXP;
  } catch (error) {
    console.error('getUserXP exception:', error);
    return null;
  }
}

export async function getUserAchievements(userId: string): Promise<UserAchievement[]> {
  try {
    const { data, error } = await supabase
      .from('user_achievements')
      .select('*, achievement:achievements(*)')
      .eq('user_id', userId)
      .limit(50);
    if (error) return [];
    return (data || []) as UserAchievement[];
  } catch (error) {
    console.error('getUserAchievements exception:', error);
    return [];
  }
}

export async function getAllAchievements(): Promise<Achievement[]> {
  try {
    const { data, error } = await supabase
      .from('achievements')
      .select('*')
      .limit(50);
    if (error) return [];
    return (data || []) as Achievement[];
  } catch (error) {
    console.error('getAllAchievements exception:', error);
    return [];
  }
}

export async function checkAndUnlockAchievements(userId: string): Promise<UserAchievement[]> {
  try {
    const [allAchievements, userAchievements, userXP] = await Promise.all([
      getAllAchievements(),
      getUserAchievements(userId),
      getUserXP(userId),
    ]);

  const unlockedIds = new Set(userAchievements.map((ua) => ua.achievement_id));
  const newlyUnlocked: UserAchievement[] = [];

  // Get user stats for checking conditions
  const { data: profile } = await supabase
    .from('profiles')
    .select('current_streak, longest_streak, wallet_address')
    .eq('id', userId)
    .single();

  const { count: checkInCount } = await supabase
    .from('xp_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'check_in');

  const { count: taskCount } = await supabase
    .from('xp_events')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('event_type', 'task_complete');

  const { count: circlesJoined } = await supabase
    .from('circle_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  const streak = Math.max(profile?.current_streak || 0, profile?.longest_streak || 0);

  // Get total upvotes received
  const { data: upvoteData } = await supabase
    .from('check_ins')
    .select('vote_count')
    .eq('user_id', userId)
    .limit(50);
  const totalUpvotes = (upvoteData || []).reduce((sum: number, c: any) => sum + (c.vote_count || 0), 0);

  // Get max upvotes on single check-in
  const maxSingleUpvotes = Math.max(0, ...(upvoteData || []).map((c: any) => c.vote_count || 0));

  for (const achievement of allAchievements) {
    if (unlockedIds.has(achievement.id)) continue;

    const req = achievement.requirement as Record<string, any>;
    let earned = false;

    switch (req.type) {
      case 'check_in_count':
        earned = (checkInCount || 0) >= req.count;
        break;
      case 'streak':
        earned = streak >= req.count;
        break;
      case 'circle_created': {
        const { count } = await supabase
          .from('circles')
          .select('*', { count: 'exact', head: true })
          .eq('created_by', userId);
        earned = (count || 0) >= req.count;
        break;
      }
      case 'circles_joined':
        earned = (circlesJoined || 0) >= req.count;
        break;
      case 'upvotes_received':
        earned = totalUpvotes >= req.count;
        break;
      case 'single_checkin_upvotes':
        earned = maxSingleUpvotes >= req.count;
        break;
      case 'task_count':
        earned = (taskCount || 0) >= req.count;
        break;
      case 'wallet_connected':
        earned = !!profile?.wallet_address;
        break;
      case 'early_adopter':
        earned = true; // Everyone during beta
        break;
    }

    if (earned) {
      const { data, error } = await supabase
        .from('user_achievements')
        .insert({ user_id: userId, achievement_id: achievement.id })
        .select('*, achievement:achievements(*)')
        .single();

      if (!error && data) {
        newlyUnlocked.push(data as UserAchievement);
        // Award XP for badge
        awardXP(userId, achievement.xp_reward, 'badge_earned', {
          achievement_id: achievement.id,
        }).catch(console.error);
      }
    }
  }

  return newlyUnlocked;
  } catch (error) {
    console.error('checkAndUnlockAchievements exception:', error);
    return [];
  }
}

export async function vote(
  userId: string,
  targetType: string,
  targetId: string,
  voteValue: number
): Promise<{ newVoteCount: number; userVote: number | null }> {
  // Check existing vote
  const { data: existing } = await supabase
    .from('votes')
    .select('*')
    .eq('user_id', userId)
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .single();

  let userVote: number | null = null;

  if (existing) {
    if (existing.vote === voteValue) {
      // Toggle off - remove vote
      await supabase
        .from('votes')
        .delete()
        .eq('id', existing.id);
      userVote = null;
    } else {
      // Change vote direction
      await supabase
        .from('votes')
        .update({ vote: voteValue })
        .eq('id', existing.id);
      userVote = voteValue;
    }
  } else {
    // New vote
    await supabase
      .from('votes')
      .insert({ user_id: userId, target_type: targetType, target_id: targetId, vote: voteValue });
    userVote = voteValue;
  }

  // Recalculate vote_count for the target
  const { data: allVotes } = await supabase
    .from('votes')
    .select('vote')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .limit(50);

  const newVoteCount = (allVotes || []).reduce((sum: number, v: any) => sum + v.vote, 0);

  // Update vote_count on check_ins
  if (targetType === 'check_in') {
    await supabase
      .from('check_ins')
      .update({ vote_count: newVoteCount })
      .eq('id', targetId);
  }

  return { newVoteCount, userVote };
}

export async function getVotes(
  targetType: string,
  targetIds: string[]
): Promise<Record<string, number>> {
  if (!targetIds.length) return {};
  const { data } = await supabase
    .from('votes')
    .select('target_id, vote')
    .eq('target_type', targetType)
    .in('target_id', targetIds)
    .limit(50);

  const counts: Record<string, number> = {};
  for (const id of targetIds) counts[id] = 0;
  for (const v of data || []) {
    counts[v.target_id] = (counts[v.target_id] || 0) + v.vote;
  }
  return counts;
}

export async function getUserVotes(
  userId: string,
  targetType: string,
  targetIds: string[]
): Promise<Record<string, number>> {
  if (!targetIds.length) return {};
  const { data } = await supabase
    .from('votes')
    .select('target_id, vote')
    .eq('user_id', userId)
    .eq('target_type', targetType)
    .in('target_id', targetIds)
    .limit(50);

  const votes: Record<string, number> = {};
  for (const v of data || []) {
    votes[v.target_id] = v.vote;
  }
  return votes;
}

export async function getLeaderboard(
  circleId?: string,
  limit: number = 20
): Promise<{ user_id: string; total_xp: number; level: number; title: string; username: string; display_name: string }[]> {
  try {
    if (circleId) {
    // Get members of circle first
    const { data: members } = await supabase
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', circleId)
      .limit(50);

    if (!members?.length) return [];
    const userIds = members.map((m) => m.user_id);

    const { data } = await supabase
      .from('user_xp')
      .select('user_id, total_xp, level, title')
      .in('user_id', userIds)
      .order('total_xp', { ascending: false })
      .limit(limit);

    // Fetch profiles
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name')
      .in('id', userIds)
      .limit(50);

    const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
    return (data || []).map((d: any) => ({
      user_id: d.user_id,
      total_xp: d.total_xp,
      level: d.level,
      title: d.title,
      username: profileMap.get(d.user_id)?.username || '',
      display_name: profileMap.get(d.user_id)?.display_name || '',
    }));
  }

  const { data } = await supabase
    .from('user_xp')
    .select('user_id, total_xp, level, title')
    .order('total_xp', { ascending: false })
    .limit(limit);

  if (!data?.length) return [];
  const userIds = data.map((d: any) => d.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, username, display_name')
    .in('id', userIds)
    .limit(50);

  const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
  return data.map((d: any) => ({
    user_id: d.user_id,
    total_xp: d.total_xp,
    level: d.level,
    title: d.title,
    username: profileMap.get(d.user_id)?.username || '',
    display_name: profileMap.get(d.user_id)?.display_name || '',
  }));
  } catch (error) {
    console.error('getLeaderboard exception:', error);
    return [];
  }
}

export async function getRecentXPEvents(userId: string, limit: number = 10): Promise<XPEvent[]> {
  try {
    const { data, error } = await supabase
      .from('xp_events')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) return [];
    return (data || []) as XPEvent[];
  } catch (error) {
    console.error('getRecentXPEvents exception:', error);
    return [];
  }
}
