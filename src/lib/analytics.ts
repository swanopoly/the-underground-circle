/**
 * Analytics service — circle analytics, member engagement, agent usage stats.
 */

import { supabase } from './supabase';
import { CircleAnalytics, MemberEngagement } from '../types';
import type { SupabaseClient } from '@supabase/supabase-js';
import { indexSafeProfiles, loadSafeCircleProfiles } from './safeProfiles';

const MEMBER_ENGAGEMENT_CONCURRENCY = 6;

export interface RealtimeCircleStats {
  todayCheckIns: number;
  todayMessages: number;
  totalMembers: number;
  avgStreak: number;
}

// ─── Circle Analytics ───────────────────────────────────────────────

export async function getCircleAnalytics(
  circleId: string,
  dateRange: '7d' | '30d' | '90d' = '30d',
  client: SupabaseClient = supabase,
): Promise<CircleAnalytics[]> {
  const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data, error } = await client
    .from('circle_analytics_daily')
    .select('*')
    .eq('circle_id', circleId)
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: true });

  if (error) throw error;

  return data || [];
}

// ─── Realtime Stats ─────────────────────────────────────────────────

export async function getRealtimeStats(
  circleId: string,
  client: SupabaseClient = supabase,
): Promise<RealtimeCircleStats> {
  const today = new Date().toISOString().split('T')[0];

  const [checkIns, messages, members] = await Promise.all([
    client
      .from('check_ins')
      .select('*', { count: 'exact', head: true })
      .eq('circle_id', circleId)
      .gte('created_at', today),
    client
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('circle_id', circleId)
      .gte('created_at', today),
    client
      .from('circle_members')
      .select('user_id')
      .eq('circle_id', circleId),
  ]);

  const failedRead = [checkIns.error, messages.error, members.error].find(Boolean);
  if (failedRead) throw failedRead;

  const memberProfiles = indexSafeProfiles(await loadSafeCircleProfiles({
    circleId,
    userIds: (members.data || []).map((member: any) => member.user_id),
    client,
  }));
  const streaks = (members.data || []).map((m: any) => memberProfiles.get(m.user_id)?.current_streak || 0);
  const avgStreak = streaks.length > 0
    ? streaks.reduce((a, b) => a + b, 0) / streaks.length
    : 0;

  return {
    todayCheckIns: checkIns.count || 0,
    todayMessages: messages.count || 0,
    totalMembers: (members.data || []).length,
    avgStreak: Math.round(avgStreak * 10) / 10,
  };
}

// ─── Member Engagement ──────────────────────────────────────────────

export async function getMemberEngagement(
  circleId: string,
  days: number = 30,
  client: SupabaseClient = supabase,
): Promise<MemberEngagement[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  // Get all members
  const { data: members, error: membersError } = await client
    .from('circle_members')
    .select('user_id')
    .eq('circle_id', circleId);

  if (membersError) throw membersError;
  if (!members || members.length === 0) return [];
  const profileById = indexSafeProfiles(await loadSafeCircleProfiles({
    circleId,
    userIds: members.map((member: any) => member.user_id),
    client,
  }));

  const result: MemberEngagement[] = [];

  // Keep exact count queries, but execute a small bounded batch of members at
  // once. The old loop waited for every member before starting the next one,
  // making this dashboard progressively slower as a circle grew.
  for (let offset = 0; offset < members.length; offset += MEMBER_ENGAGEMENT_CONCURRENCY) {
    const batch = members.slice(offset, offset + MEMBER_ENGAGEMENT_CONCURRENCY);
    const rows = await Promise.all(batch.map(async (member): Promise<MemberEngagement | null> => {
      const user = profileById.get(member.user_id) as any;
      if (!user) return null;

      const [checkIns, messages, tasks] = await Promise.all([
        client
          .from('check_ins')
          .select('*', { count: 'exact', head: true })
          .eq('circle_id', circleId)
          .eq('user_id', user.id)
          .gte('created_at', sinceStr),
        client
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('circle_id', circleId)
          .eq('user_id', user.id)
          .eq('is_bot', false)
          .gte('created_at', sinceStr),
        client
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('circle_id', circleId)
          .eq('assigned_to', user.id)
          .eq('status', 'done')
          .gte('completed_at', sinceStr),
      ]);

      const failedRead = [checkIns.error, messages.error, tasks.error].find(Boolean);
      if (failedRead) throw failedRead;

      return {
        user_id: user.id,
        username: user.username,
        display_name: user.display_name,
        check_ins: checkIns.count || 0,
        messages: messages.count || 0,
        tasks_completed: tasks.count || 0,
        current_streak: user.current_streak || 0,
        last_active: '', // Would need a separate query
      };
    }));
    for (const row of rows) {
      if (row) result.push(row);
    }
  }

  // Sort by engagement (check-ins + messages)
  result.sort((a, b) => (b.check_ins + b.messages) - (a.check_ins + a.messages));

  return result;
}

// ─── Agent Usage Stats ──────────────────────────────────────────────

export async function getAgentUsageStats(circleId: string, days: number = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from('circle_analytics_daily')
    .select('agent_cost_total, agent_tokens_total')
    .eq('circle_id', circleId)
    .gte('date', since.toISOString().split('T')[0]);

  const totalCost = (data || []).reduce((sum, d) => sum + (Number(d.agent_cost_total) || 0), 0);
  const totalTokens = (data || []).reduce((sum, d) => sum + (Number(d.agent_tokens_total) || 0), 0);

  return {
    totalCost: Math.round(totalCost * 100) / 100,
    totalTokens,
    avgDailyCost: data && data.length > 0 ? Math.round((totalCost / data.length) * 100) / 100 : 0,
  };
}
