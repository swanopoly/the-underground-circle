/**
 * Mission Streaks — track daily mission task completion streaks
 * Connects to existing gamification system for bonus XP rewards.
 * See docs/NEXT_LEVEL_PLAN.md
 */
import { supabase } from './supabase';
import { useState, useEffect, useCallback } from 'react';

export interface MissionStreak {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastCompletionDate: string | null; // YYYY-MM-DD
  totalTasksCompleted: number;
}

const STREAK_KEY_PREFIX = 'uc_mission_streak_';

/** Load streak data from localStorage (fast) with Supabase fallback */
export function loadStreak(userId: string): MissionStreak {
  const defaults: MissionStreak = {
    userId,
    currentStreak: 0,
    longestStreak: 0,
    lastCompletionDate: null,
    totalTasksCompleted: 0,
  };

  try {
    const raw = localStorage.getItem(`${STREAK_KEY_PREFIX}${userId}`);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}

  return defaults;
}

/** Save streak to localStorage */
function saveStreak(streak: MissionStreak) {
  try {
    localStorage.setItem(`${STREAK_KEY_PREFIX}${streak.userId}`, JSON.stringify(streak));
  } catch {}
}

/** Get today's date as YYYY-MM-DD */
function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

/** Get yesterday's date as YYYY-MM-DD */
function yesterdayStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * Record a task completion and update the streak.
 * Returns the updated streak and any bonus XP earned.
 */
export function recordTaskCompletion(userId: string): {
  streak: MissionStreak;
  bonusXP: number;
  isNewDay: boolean;
  milestoneReached: string | null;
} {
  const streak = loadStreak(userId);
  const today = todayStr();
  const yesterday = yesterdayStr();

  streak.totalTasksCompleted++;

  const isNewDay = streak.lastCompletionDate !== today;

  if (isNewDay) {
    if (streak.lastCompletionDate === yesterday) {
      // Consecutive day — extend streak
      streak.currentStreak++;
    } else if (streak.lastCompletionDate === today) {
      // Already completed today — no streak change
    } else {
      // Streak broken — reset
      streak.currentStreak = 1;
    }
    streak.lastCompletionDate = today;
  }

  // Update longest streak
  if (streak.currentStreak > streak.longestStreak) {
    streak.longestStreak = streak.currentStreak;
  }

  // Calculate bonus XP based on streak length
  let bonusXP = 0;
  if (isNewDay) {
    bonusXP = Math.min(streak.currentStreak * 5, 50); // 5 XP per day, cap at 50
  }

  // Check for milestones
  let milestoneReached: string | null = null;
  const milestones: Record<number, string> = {
    3: 'Hat Trick',
    7: 'Week Warrior',
    14: 'Two-Week Titan',
    30: 'Monthly Machine',
    50: 'Streak Legend',
    100: 'Centurion',
  };
  if (isNewDay && milestones[streak.currentStreak]) {
    milestoneReached = milestones[streak.currentStreak];
  }

  saveStreak(streak);
  return { streak, bonusXP, isNewDay, milestoneReached };
}

/**
 * Check if the streak is still active (completed a task today or yesterday).
 * If not, the streak resets on next completion.
 */
export function isStreakActive(streak: MissionStreak): boolean {
  if (!streak.lastCompletionDate) return false;
  const today = todayStr();
  const yesterday = yesterdayStr();
  return streak.lastCompletionDate === today || streak.lastCompletionDate === yesterday;
}

/**
 * Check if the user has completed a mission task today.
 */
export function hasCompletedToday(streak: MissionStreak): boolean {
  return streak.lastCompletionDate === todayStr();
}

// ─── React Hook ──────────────────────────────────────────────────────────────

export function useMissionStreak(userId: string | null) {
  const [streak, setStreak] = useState<MissionStreak | null>(null);

  useEffect(() => {
    if (!userId) return;
    setStreak(loadStreak(userId));
  }, [userId]);

  const recordCompletion = useCallback(() => {
    if (!userId) return null;
    const result = recordTaskCompletion(userId);
    setStreak(result.streak);
    return result;
  }, [userId]);

  return { streak, recordCompletion };
}
