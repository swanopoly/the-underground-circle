/**
 * Analytics service — circle analytics, member engagement, agent usage stats.
 */

import { supabase } from './supabase';
import { CircleAnalytics, MemberEngagement } from '../types';

// ─── Circle Analytics ───────────────────────────────────────────────

export async function getCircleAnalytics(
  circleId: string,
  dateRange: '7d' | '30d' | '90d' = '30d'
): Promise<CircleAnalytics[]> {
  const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data } = await supabase
    .from('circle_analytics_daily')
    .select('*')
    .eq('circle_id', circleId)
    .gte('date', since.toISOString().split('T')[0])
    .order('date', { ascending: true });

  return data || [];
}

// ─── Realtime Stats ─────────────────────────────────────────────────

export async function getRealtimeStats(circleId: string) {
  const today = new Date().toISOString().split('T')[0];

  const [checkIns, messages, members] = await Promise.all([
    supabase
      .from('check_ins')
      .select('*', { count: 'exact', head: true })
      .eq('circle_id', circleId)
      .gte('created_at', today),
    supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('circle_id', circleId)
      .gte('created_at', today),
    supabase
      .from('circle_members')
      .select('user:profiles(current_streak)')
      .eq('circle_id', circleId),
  ]);

  const streaks = (members.data || []).map((m: any) => m.user?.current_streak || 0);
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
  days: number = 30
): Promise<MemberEngagement[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString();

  // Get all members
  const { data: members } = await supabase
    .from('circle_members')
    .select('user_id, user:profiles(id, username, display_name, current_streak)')
    .eq('circle_id', circleId);

  if (!members || members.length === 0) return [];

  const result: MemberEngagement[] = [];

  for (const member of members) {
    const user = member.user as any;
    if (!user) continue;

    const [checkIns, messages, tasks] = await Promise.all([
      supabase
        .from('check_ins')
        .select('*', { count: 'exact', head: true })
        .eq('circle_id', circleId)
        .eq('user_id', user.id)
        .gte('created_at', sinceStr),
      supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('circle_id', circleId)
        .eq('user_id', user.id)
        .eq('is_bot', false)
        .gte('created_at', sinceStr),
      supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('circle_id', circleId)
        .eq('assigned_to', user.id)
        .eq('status', 'done')
        .gte('completed_at', sinceStr),
    ]);

    result.push({
      user_id: user.id,
      username: user.username,
      display_name: user.display_name,
      check_ins: checkIns.count || 0,
      messages: messages.count || 0,
      tasks_completed: tasks.count || 0,
      current_streak: user.current_streak || 0,
      last_active: '', // Would need a separate query
    });
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
