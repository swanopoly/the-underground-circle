import { supabase } from './supabase';

/**
 * AI Coach Nudges — personalized coaching messages based on user patterns.
 */

export async function generateNudge(userId: string): Promise<string | null> {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  const yesterday = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
  const hour = now.getHours();

  // Check if user checked in today
  const { data: todayCheckins } = await supabase
    .from('check_ins')
    .select('id')
    .eq('user_id', userId)
    .gte('created_at', today + 'T00:00:00')
    .limit(1);

  const checkedInToday = (todayCheckins?.length || 0) > 0;

  // Check if user checked in yesterday
  const { data: yesterdayCheckins } = await supabase
    .from('check_ins')
    .select('id')
    .eq('user_id', userId)
    .gte('created_at', yesterday + 'T00:00:00')
    .lt('created_at', today + 'T00:00:00')
    .limit(1);

  const checkedInYesterday = (yesterdayCheckins?.length || 0) > 0;

  // Streak at risk: checked in yesterday but not today, and it's after 6pm
  if (checkedInYesterday && !checkedInToday && hour >= 18) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('current_streak')
      .eq('id', userId)
      .single();

    const streak = profile?.current_streak || 0;
    if (streak > 1) {
      return `🔥 Your ${streak}-day streak is on the line. Don't let it die.`;
    }
    return `🔥 You showed up yesterday. Don't break the chain today.`;
  }

  // Wednesday drop-off pattern
  const dayOfWeek = now.getDay(); // 0=Sun, 3=Wed
  if (dayOfWeek === 3 && !checkedInToday) {
    // Check last 4 Wednesdays
    const fourWeeksAgo = new Date(now.getTime() - 28 * 86400000).toISOString();
    const { data: allCheckins } = await supabase
      .from('check_ins')
      .select('created_at')
      .eq('user_id', userId)
      .gte('created_at', fourWeeksAgo)
      .limit(50);

    const wednesdayCheckins = (allCheckins || []).filter((c) => {
      return new Date(c.created_at).getDay() === 3;
    });

    // If missed 2+ of last 4 Wednesdays, it's a pattern
    if (wednesdayCheckins.length <= 2) {
      return `📅 Wednesdays are your weak spot — prove them wrong today.`;
    }
  }

  // Longest inactive period warning
  if (!checkedInToday) {
    const { data: recent } = await supabase
      .from('check_ins')
      .select('created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (recent && recent.length > 0) {
      const lastCheckin = new Date(recent[0].created_at);
      const daysSince = Math.floor((now.getTime() - lastCheckin.getTime()) / 86400000);
      if (daysSince >= 3) {
        return `⚠️ It's been ${daysSince} days. The grind doesn't wait for you.`;
      }
    }
  }

  return null;
}

export async function getProgressInsight(userId: string): Promise<string> {
  const now = new Date();
  const startOfThisWeek = new Date(now);
  startOfThisWeek.setDate(now.getDate() - now.getDay());
  startOfThisWeek.setHours(0, 0, 0, 0);

  const startOfLastWeek = new Date(startOfThisWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const thisWeekStr = startOfThisWeek.toISOString();
  const lastWeekStr = startOfLastWeek.toISOString();

  // This week check-ins
  const { data: thisWeekCheckins } = await supabase
    .from('check_ins')
    .select('id')
    .eq('user_id', userId)
    .gte('created_at', thisWeekStr)
    .limit(50);

  // Last week check-ins
  const { data: lastWeekCheckins } = await supabase
    .from('check_ins')
    .select('id')
    .eq('user_id', userId)
    .gte('created_at', lastWeekStr)
    .lt('created_at', thisWeekStr)
    .limit(50);

  // This week XP
  const { data: thisWeekXP } = await supabase
    .from('xp_events')
    .select('xp_amount')
    .eq('user_id', userId)
    .gte('created_at', thisWeekStr)
    .limit(50);

  // Last week XP
  const { data: lastWeekXP } = await supabase
    .from('xp_events')
    .select('xp_amount')
    .eq('user_id', userId)
    .gte('created_at', lastWeekStr)
    .lt('created_at', thisWeekStr)
    .limit(50);

  const thisCount = thisWeekCheckins?.length || 0;
  const lastCount = lastWeekCheckins?.length || 0;
  const thisXP = (thisWeekXP || []).reduce((s, e) => s + (e.xp_amount || 0), 0);
  const lastXP = (lastWeekXP || []).reduce((s, e) => s + (e.xp_amount || 0), 0);

  if (lastCount > 0) {
    const pctChange = Math.round(((thisCount - lastCount) / lastCount) * 100);
    if (pctChange > 0) {
      return `📈 You're up ${pctChange}% on check-ins this week vs last week. Keep that energy.`;
    } else if (pctChange < 0) {
      return `📉 Slower week — ${Math.abs(pctChange)}% fewer check-ins than last week. Time to lock in.`;
    } else {
      return `📊 Same pace as last week — ${thisCount} check-ins. Consistency is king.`;
    }
  }

  if (thisCount > 0) {
    return `📊 ${thisCount} check-ins this week and ${thisXP.toLocaleString()} XP earned. You're building momentum.`;
  }

  return `📊 No check-ins this week yet. Today's a good day to start.`;
}

export async function getOnThisDay(userId: string): Promise<{ weekAgo: any[]; monthAgo: any[] }> {
  const now = new Date();

  const weekAgoDate = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
  const monthAgoDate = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];

  const { data: weekAgo } = await supabase
    .from('check_ins')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', weekAgoDate + 'T00:00:00')
    .lt('created_at', weekAgoDate + 'T23:59:59')
    .limit(50);

  const { data: monthAgo } = await supabase
    .from('check_ins')
    .select('*')
    .eq('user_id', userId)
    .gte('created_at', monthAgoDate + 'T00:00:00')
    .lt('created_at', monthAgoDate + 'T23:59:59')
    .limit(50);

  return {
    weekAgo: weekAgo || [],
    monthAgo: monthAgo || [],
  };
}
