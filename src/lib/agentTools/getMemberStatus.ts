/**
 * Tool: getMemberStatus — returns the current check-in / streak / last-seen
 * state for every member of the circle. The simplest useful tool for
 * BlackSwan: answers "who's active this week?" without hallucinating.
 *
 * This is the canonical example of how to write a new UC agent tool:
 *   1. Define an input schema (JSON-schema subset — the model reads this).
 *   2. Declare a handler that returns `{ok, data}` or `{ok: false, error}`.
 *   3. Self-register at module import time via `registerTool`.
 *
 * Copy this file as a template when adding new tools.
 */

import { supabase } from '../supabase';
import { registerTool } from './registry';

type MemberStatusInput = {
  circleId: string;
  /** How many days of check-ins to consider "active". Defaults to 7. */
  windowDays?: number;
};

type MemberStatus = {
  userId: string;
  displayName: string | null;
  username: string | null;
  currentStreak: number;
  longestStreak: number;
  checkedInToday: boolean;
  lastCheckInAt: string | null;
};

function isMemberStatusInput(value: unknown): value is MemberStatusInput {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.circleId === 'string' && v.circleId.length > 0;
}

registerTool({
  name: 'getMemberStatus',
  description:
    "Returns every member of a circle with their current streak, longest streak, " +
    "and whether they've checked in during the given window (default 7 days). " +
    "Use this instead of inventing activity facts when the user asks 'who's active', " +
    "'who hasn't shipped', 'who's on a streak', or similar.",
  input_schema: {
    type: 'object',
    properties: {
      circleId: { type: 'string', description: 'Circle UUID to inspect.' },
      windowDays: {
        type: 'integer',
        description: 'Rolling window in days to count as active. Default 7.',
        minimum: 1,
        maximum: 90,
      },
    },
    required: ['circleId'],
    additionalProperties: false,
  },
  handler: async (input) => {
    if (!isMemberStatusInput(input)) {
      return { ok: false, error: 'getMemberStatus: expected { circleId: string }.' };
    }
    const { circleId, windowDays = 7 } = input;
    const sinceIso = new Date(Date.now() - windowDays * 86_400_000).toISOString();
    const todayIso = new Date(new Date().toISOString().split('T')[0]).toISOString();

    const { data: members, error: membersError } = await supabase
      .from('circle_members')
      .select('user:profiles(id, username, display_name, current_streak, longest_streak)')
      .eq('circle_id', circleId);

    if (membersError) {
      return { ok: false, error: `circle_members query failed: ${membersError.message}` };
    }
    const memberRows = (members || []) as Array<{ user: any }>;
    const userIds = memberRows
      .map((r) => (Array.isArray(r.user) ? r.user[0]?.id : r.user?.id))
      .filter(Boolean);

    if (userIds.length === 0) {
      return { ok: true, data: { circleId, windowDays, members: [], count: 0 } };
    }

    const { data: checkIns, error: checkInError } = await supabase
      .from('check_ins')
      .select('user_id, created_at')
      .eq('circle_id', circleId)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false });

    if (checkInError) {
      return { ok: false, error: `check_ins query failed: ${checkInError.message}` };
    }

    const latestByUser = new Map<string, string>();
    for (const ci of (checkIns || []) as Array<{ user_id: string; created_at: string }>) {
      if (!latestByUser.has(ci.user_id)) latestByUser.set(ci.user_id, ci.created_at);
    }

    const statuses: MemberStatus[] = memberRows
      .map((row) => {
        const rawUser = Array.isArray(row.user) ? row.user[0] : row.user;
        if (!rawUser?.id) return null;
        const lastCheckIn = latestByUser.get(rawUser.id) || null;
        return {
          userId: rawUser.id,
          displayName: rawUser.display_name ?? null,
          username: rawUser.username ?? null,
          currentStreak: rawUser.current_streak ?? 0,
          longestStreak: rawUser.longest_streak ?? 0,
          checkedInToday: lastCheckIn ? new Date(lastCheckIn) >= new Date(todayIso) : false,
          lastCheckInAt: lastCheckIn,
        };
      })
      .filter((s): s is MemberStatus => s !== null)
      .sort((a, b) => b.currentStreak - a.currentStreak);

    return {
      ok: true,
      data: {
        circleId,
        windowDays,
        members: statuses,
        count: statuses.length,
        activeCount: statuses.filter((s) => s.lastCheckInAt !== null).length,
        checkedInTodayCount: statuses.filter((s) => s.checkedInToday).length,
      },
    };
  },
});
