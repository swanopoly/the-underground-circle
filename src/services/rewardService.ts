import { supabase } from '../lib/supabase';
import { useEffect, useState, useRef } from 'react';
import { BADGES, Badge, getPointsForModel } from '../lib/badges';

export interface UserPoints {
  user_id: string;
  total_points: number;
  lifetime_points: number;
  current_streak: number;
  longest_streak: number;
}

export interface UserBadge {
  badge_id: string;
  earned_at: string;
  points_at_earn: number;
}

// ─── Core mutations ────────────────────────────────────────────────────────

export async function awardPoints(
  userId: string,
  points: number,
  reason: string,
  metadata?: Record<string, any>,
): Promise<{ newTotal: number; newBadges: Badge[] }> {
  // Upsert user_points
  const { data: existing } = await supabase
    .from('user_points')
    .select('total_points, lifetime_points')
    .eq('user_id', userId)
    .single();

  const prevTotal = existing?.lifetime_points ?? 0;
  const newTotal = (existing?.total_points ?? 0) + points;
  const newLifetime = prevTotal + points;

  await supabase.from('user_points').upsert(
    {
      user_id: userId,
      total_points: newTotal,
      lifetime_points: newLifetime,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  // Log transaction
  await supabase.from('points_transactions').insert({
    user_id: userId,
    points,
    reason,
    metadata: metadata || {},
  });

  // Check for newly earned badges
  const { data: alreadyEarned } = await supabase
    .from('user_badges')
    .select('badge_id')
    .eq('user_id', userId);

  const earnedIds = new Set((alreadyEarned || []).map((b: any) => b.badge_id));
  const newBadges: Badge[] = [];

  for (const badge of BADGES) {
    if (!earnedIds.has(badge.id) && newLifetime >= badge.pointsRequired) {
      await supabase.from('user_badges').insert({
        user_id: userId,
        badge_id: badge.id,
        earned_at: new Date().toISOString(),
        points_at_earn: newLifetime,
      });
      newBadges.push(badge);
    }
  }

  return { newTotal, newBadges };
}

export async function awardAgentTurnPoints(
  userId: string,
  model: string,
  turns: number,
): Promise<{ newTotal: number; newBadges: Badge[] }> {
  const ppTurn = getPointsForModel(model);
  const total = ppTurn * Math.max(1, turns);
  return awardPoints(userId, total, `Agent turn — ${model}`, { model, turns, ppTurn });
}

export async function getUserPoints(userId: string): Promise<UserPoints | null> {
  const { data } = await supabase
    .from('user_points')
    .select('*')
    .eq('user_id', userId)
    .single();
  return data;
}

export async function getUserBadges(userId: string): Promise<UserBadge[]> {
  const { data } = await supabase
    .from('user_badges')
    .select('*')
    .eq('user_id', userId)
    .order('earned_at', { ascending: true });
  return data || [];
}

// ─── React hooks ──────────────────────────────────────────────────────────

export function useUserRewards(userId?: string) {
  const [points, setPoints] = useState<UserPoints | null>(null);
  const [badges, setBadges] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async (uid: string) => {
    const [p, b] = await Promise.all([getUserPoints(uid), getUserBadges(uid)]);
    setPoints(p);
    setBadges(b);
    setLoading(false);
  };

  useEffect(() => {
    if (!userId) return;
    load(userId);

    const ch = supabase
      .channel('rewards_' + userId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_points', filter: 'user_id=eq.' + userId },
        () => getUserPoints(userId).then(setPoints))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'user_badges', filter: 'user_id=eq.' + userId },
        () => getUserBadges(userId).then(setBadges))
      .subscribe();

    return () => { supabase.removeChannel(ch); };
  }, [userId]);

  return { points, badges, loading };
}

// Hook that auto-awards points when agent turns increase
export function useAgentPointsTracker(
  userId: string | undefined,
  agentTurns: number,
  agentModel: string,
  onNewBadges: (badges: Badge[]) => void,
) {
  const lastTurns = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId || agentTurns <= lastTurns.current) return;

    const delta = agentTurns - lastTurns.current;
    lastTurns.current = agentTurns;

    // Debounce to batch rapid updates
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const { newBadges } = await awardAgentTurnPoints(userId, agentModel, delta);
      if (newBadges.length > 0) onNewBadges(newBadges);
    }, 2000);
  }, [agentTurns, userId]);
}
