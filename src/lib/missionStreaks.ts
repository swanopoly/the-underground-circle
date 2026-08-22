/**
 * Mission Streaks — track daily mission task completion streaks
 * Connects to existing gamification system for bonus XP rewards.
 *
 * Dual-persisted: localStorage (fast read on page load) + mission_streaks
 * table in Supabase (durable across browser clears + devices). On a fresh
 * device with empty localStorage, the next save backfills from DB on the
 * subsequent load via syncStreakFromServer().
 *
 * See docs/NEXT_LEVEL_PLAN.md and migration 20260430_mission_streaks.sql.
 */
import { supabase } from './supabase';
import { useState, useEffect, useCallback } from 'react';
import { safeGetUserForAccessToken } from './authSession';
import { normalizeMissionStreakRowExact } from './missionStreakExactCore';
export { normalizeMissionStreakRowExact } from './missionStreakExactCore';

export interface MissionStreak {
  userId: string;
  /** Optional circle scope. Streaks are per-circle since missions are
   *  per-circle. Null/undefined = global (legacy / un-circled). */
  circleId?: string | null;
  currentStreak: number;
  longestStreak: number;
  lastCompletionDate: string | null; // YYYY-MM-DD
  totalTasksCompleted: number;
}

export type MissionStreakExactAuthority = Readonly<{
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
}>;

export type MissionStreakExactAuthorityFence = (
  authority: MissionStreakExactAuthority,
) => boolean;

export type MissionStreakExactReadResult =
  | Readonly<{ ok: true; streak: MissionStreak | null }>
  | Readonly<{
      ok: false;
      error: 'invalid_authority' | 'authority_retired' | 'authority_mismatch' | 'backend_error' | 'invalid_response';
    }>;

const EXACT_STREAK_SCOPE_PART_MAX = 240;
const EXACT_STREAK_ACCESS_TOKEN_MAX = 16_384;

function normalizeExactStreakScopePart(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= EXACT_STREAK_SCOPE_PART_MAX ? normalized : null;
}

function normalizeMissionStreakExactAuthority(
  authority: MissionStreakExactAuthority | null | undefined,
): MissionStreakExactAuthority | null {
  const userId = normalizeExactStreakScopePart(authority?.userId);
  const circleId = normalizeExactStreakScopePart(authority?.circleId);
  const accessToken = typeof authority?.accessToken === 'string' ? authority.accessToken.trim() : '';
  const generation = Number(authority?.generation);
  if (
    !userId
    || !circleId
    || !accessToken
    || accessToken.length > EXACT_STREAK_ACCESS_TOKEN_MAX
    || !Number.isSafeInteger(generation)
    || generation <= 0
  ) return null;
  return { userId, circleId, accessToken, generation };
}

function isExactStreakAuthorityCurrent(
  authority: MissionStreakExactAuthority,
  fence: MissionStreakExactAuthorityFence,
): boolean {
  try {
    return fence(authority) === true;
  } catch {
    return false;
  }
}

/**
 * Bearer-bound, generation-fenced streak read for authority-sensitive panels.
 * Unlike the legacy local-first helper, backend and schema failures are
 * explicit and can never be presented as a verified zero-day streak.
 */
export async function loadMissionStreakExact(
  capturedAuthority: MissionStreakExactAuthority,
  fence: MissionStreakExactAuthorityFence,
): Promise<MissionStreakExactReadResult> {
  const authority = normalizeMissionStreakExactAuthority(capturedAuthority);
  if (!authority || typeof fence !== 'function') return { ok: false, error: 'invalid_authority' };
  if (!isExactStreakAuthorityCurrent(authority, fence)) return { ok: false, error: 'authority_retired' };

  try {
    const { value: verifiedUser, error: authError } = await safeGetUserForAccessToken(authority.accessToken);
    if (!isExactStreakAuthorityCurrent(authority, fence)) return { ok: false, error: 'authority_retired' };
    if (authError || verifiedUser?.id !== authority.userId) {
      return { ok: false, error: 'authority_mismatch' };
    }

    const { data, error } = await supabase
      .from('mission_streaks')
      .select('user_id, circle_id, current_streak, longest_streak, last_completion_date, total_tasks_completed')
      .eq('user_id', authority.userId)
      .eq('circle_id', authority.circleId)
      .limit(2)
      .setHeader('Authorization', `Bearer ${authority.accessToken}`);
    if (!isExactStreakAuthorityCurrent(authority, fence)) return { ok: false, error: 'authority_retired' };
    if (error) return { ok: false, error: 'backend_error' };
    if (!Array.isArray(data) || data.length > 1) return { ok: false, error: 'invalid_response' };
    const streak = normalizeMissionStreakRowExact(data[0] ?? null, authority);
    return streak === undefined
      ? { ok: false, error: 'invalid_response' }
      : { ok: true, streak };
  } catch {
    return isExactStreakAuthorityCurrent(authority, fence)
      ? { ok: false, error: 'backend_error' }
      : { ok: false, error: 'authority_retired' };
  }
}

const STREAK_KEY_PREFIX = 'uc_mission_streak_';

function localKey(userId: string, circleId?: string | null): string {
  return circleId
    ? `${STREAK_KEY_PREFIX}${userId}:${circleId}`
    : `${STREAK_KEY_PREFIX}${userId}`;
}

/** Load streak data from localStorage (fast). Caller should also kick a
 *  background syncStreakFromServer() to refresh from DB on first mount. */
export function loadStreak(userId: string, circleId?: string | null): MissionStreak {
  const defaults: MissionStreak = {
    userId,
    circleId: circleId ?? null,
    currentStreak: 0,
    longestStreak: 0,
    lastCompletionDate: null,
    totalTasksCompleted: 0,
  };

  try {
    const raw = localStorage.getItem(localKey(userId, circleId));
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {}

  return defaults;
}

/** Save streak to localStorage AND fire-and-forget to Supabase. */
// Same kill-switch pattern as agentIdentity — first migration miss
// disables the persist for the rest of the session so we don't spam
// the network panel with 404s on every streak update.
let _streakPersistDisabled = false;

function saveStreak(streak: MissionStreak) {
  // 1. Local cache (synchronous, must succeed for UI)
  try {
    localStorage.setItem(localKey(streak.userId, streak.circleId), JSON.stringify(streak));
  } catch {}

  if (_streakPersistDisabled) return;

  // 2. Durable Supabase write (async, best-effort).
  void supabase
    .from('mission_streaks')
    .upsert({
      user_id: streak.userId,
      circle_id: streak.circleId ?? null,
      current_streak: streak.currentStreak,
      longest_streak: streak.longestStreak,
      last_completion_date: streak.lastCompletionDate,
      total_tasks_completed: streak.totalTasksCompleted,
    }, { onConflict: 'user_id,circle_id' })
    .then(({ error }) => {
      if (!error) return;
      const code = (error as any).code;
      const status = (error as any).status;
      if (code === 'PGRST205' || code === 'PGRST204' || status === 404) {
        _streakPersistDisabled = true;
        console.warn(
          '[missionStreaks] mission_streaks table/column missing — falling back to localStorage only. ' +
          'Apply migration `supabase/migrations/20260430_mission_streaks.sql` and reload to re-enable durable persistence.',
        );
        return;
      }
      console.warn('[missionStreaks] DB save failed:', error.message);
    });
}

/**
 * Fetch the user's streak from Supabase. Returns null if no row exists
 * yet (caller should fall back to localStorage default). Used by
 * useMissionStreak's useEffect to refresh after first mount so a fresh
 * browser / new device gets the durable copy.
 */
export async function syncStreakFromServer(
  userId: string,
  circleId?: string | null,
): Promise<MissionStreak | null> {
  try {
    const query = supabase
      .from('mission_streaks')
      .select('current_streak, longest_streak, last_completion_date, total_tasks_completed')
      .eq('user_id', userId);
    const { data, error } = circleId
      ? await query.eq('circle_id', circleId).maybeSingle()
      : await query.is('circle_id', null).maybeSingle();
    if (error || !data) return null;
    return {
      userId,
      circleId: circleId ?? null,
      currentStreak: data.current_streak || 0,
      longestStreak: data.longest_streak || 0,
      lastCompletionDate: data.last_completion_date || null,
      totalTasksCompleted: data.total_tasks_completed || 0,
    };
  } catch {
    return null;
  }
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
export function recordTaskCompletion(userId: string, circleId?: string | null): {
  streak: MissionStreak;
  bonusXP: number;
  isNewDay: boolean;
  milestoneReached: string | null;
} {
  const streak = loadStreak(userId, circleId);
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

export function useMissionStreak(userId: string | null, circleId?: string | null) {
  const [streak, setStreak] = useState<MissionStreak | null>(null);

  useEffect(() => {
    if (!userId) return;
    // Load fast from localStorage first.
    setStreak(loadStreak(userId, circleId));
    // Then refresh from server. If the server has a higher-streak row
    // (e.g. user moved devices), adopt it and re-cache locally so the
    // next reload is fast and accurate.
    void syncStreakFromServer(userId, circleId).then((server) => {
      if (!server) return;
      setStreak((local) => {
        if (!local) return server;
        const localScore = local.currentStreak + local.totalTasksCompleted * 0.01;
        const serverScore = server.currentStreak + server.totalTasksCompleted * 0.01;
        if (serverScore > localScore) {
          // Server is ahead — backfill local cache.
          try {
            localStorage.setItem(localKey(userId, circleId), JSON.stringify(server));
          } catch {}
          return server;
        }
        return local;
      });
    });
  }, [userId, circleId]);

  const recordCompletion = useCallback(() => {
    if (!userId) return null;
    const result = recordTaskCompletion(userId, circleId);
    setStreak(result.streak);
    return result;
  }, [userId, circleId]);

  return { streak, recordCompletion };
}
