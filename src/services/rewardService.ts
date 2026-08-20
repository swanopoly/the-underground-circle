import { supabase } from '../lib/supabase';
import { useEffect, useState, useRef, useCallback } from 'react';
import { type Badge, getPointsForModel } from '../lib/badges';
import type { OfficeAgent } from '../lib/officeAgents';

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

// The 2026-08-06 security lockdown revoked client EXECUTE on award_points: a
// SECURITY DEFINER function taking an arbitrary p_user_id was a self-award
// exploit. Keep every client award site dormant before network I/O until a
// server-owned event ledger replaces this mutation path.

export async function awardPoints(
  _userId: string,
  _points: number,
  _reason: string,
  _metadata?: Record<string, any>,
): Promise<{ newTotal: number; newBadges: Badge[] }> {
  return { newTotal: 0, newBadges: [] };
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
    // A newly created account legitimately has no points row until its first
    // server-owned reward event. Preserve that as the uninitialized `null`
    // state instead of asking PostgREST for exactly one row and emitting 406.
    .maybeSingle();
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
  const lastTurns = useRef(-1); // -1 = not yet seeded
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;
    // Seed on first render — don't re-award historical turns
    if (lastTurns.current < 0) {
      lastTurns.current = agentTurns;
      return;
    }
    if (agentTurns <= lastTurns.current) return;

    const delta = agentTurns - lastTurns.current;
    lastTurns.current = agentTurns;

    // Debounce to batch rapid updates (1.5s for snappy feedback)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      debounceRef.current = null;
      const { newBadges } = await awardAgentTurnPoints(userId, agentModel, delta);
      if (newBadges.length > 0) onNewBadges(newBadges);
    }, 1500);
  }, [agentTurns, userId]);

  // Cleanup pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
}

// ─── Multi-agent XP tracker ──────────────────────────────────────────────
// Tracks ALL connected agents' turns and awards XP to the USER.
// Every bot earns XP for its owner — Claude Code, OpenSwan, Codex, all of them.

export function useAllAgentPointsTracker(
  userId: string | undefined,
  agents: OfficeAgent[],
  onNewBadges: (badges: Badge[]) => void,
) {
  const prevTurnsRef = useRef<Map<string, number>>(new Map());
  const seededRef = useRef(false);
  const pendingPointsRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId || agents.length === 0) return;

    // First render: seed prevTurnsRef with current values so we only
    // award points for NEW turns, not re-award all historical turns.
    if (!seededRef.current) {
      seededRef.current = true;
      for (const agent of agents) {
        if (agent.id === 'default::blackswan') continue;
        const currentTurns = agent.turns || agent.messagesProcessed || 0;
        if (currentTurns > 0) prevTurnsRef.current.set(agent.id, currentTurns);
      }
      return; // skip awarding on first render
    }

    let newPoints = 0;

    for (const agent of agents) {
      // Skip the default BlackSwan agent (always has 0 turns)
      if (agent.id === 'default::blackswan') continue;

      const currentTurns = agent.turns || agent.messagesProcessed || 0;
      if (currentTurns <= 0) continue;

      const prevTurns = prevTurnsRef.current.get(agent.id) ?? 0;
      if (currentTurns > prevTurns) {
        const delta = currentTurns - prevTurns;
        const ppTurn = getPointsForModel(agent.model);
        newPoints += delta * ppTurn;
        prevTurnsRef.current.set(agent.id, currentTurns);
      }
    }

    if (newPoints <= 0) return;

    pendingPointsRef.current += newPoints;

    // Debounce: batch rapid agent updates into one DB call (1.5s for faster feedback)
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      debounceRef.current = null;
      const points = pendingPointsRef.current;
      pendingPointsRef.current = 0;
      if (points <= 0) return;

      const agentSummary = agents
        .filter(a => a.id !== 'default::blackswan' && (a.turns || a.messagesProcessed || 0) > 0)
        .map(a => `${a.name}(${a.model})`)
        .join(', ');

      const { newBadges } = await awardPoints(userId, points, 'Agent activity', {
        agentCount: agents.length,
        agents: agentSummary,
        points,
      });
      if (newBadges.length > 0) onNewBadges(newBadges);
    }, 1500);
  }, [agents, userId]);

  // Cleanup pending debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);
}
