import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import Card from '../../components/Card';
import { generateNudge, getProgressInsight, getOnThisDay } from '../../lib/coach';
import { indexSafeProfiles, loadSafeCircleProfiles } from '../../lib/safeProfiles';

const formatNumber = (n: number) => n.toLocaleString();

export default function DailyDigestScreen() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [circles, setCircles] = useState<any[]>([]);
  const [selectedCircleId, setSelectedCircleId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  // Data
  const [todayCheckIns, setTodayCheckIns] = useState<any[]>([]);
  const [activeMembers, setActiveMembers] = useState(0);
  const [tasksCompleted, setTasksCompleted] = useState(0);
  const [mvp, setMvp] = useState<{ name: string; xp: number } | null>(null);
  const [streakAtRisk, setStreakAtRisk] = useState<any[]>([]);
  const [nudge, setNudge] = useState<string | null>(null);
  const [insight, setInsight] = useState<string>('');
  const [onThisDay, setOnThisDay] = useState<{ weekAgo: any[]; monthAgo: any[] }>({ weekAgo: [], monthAgo: [] });

  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const fetchData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setUserId(user.id);

    // Get user's circles
    const { data: memberships } = await supabase
      .from('circle_members')
      .select('circle_id, circle:circles(id, name)')
      .eq('user_id', user.id)
      .limit(50);

    const userCircles = (memberships || []).map((m: any) => m.circle).filter(Boolean);
    setCircles(userCircles);

    const circleId = selectedCircleId || userCircles[0]?.id;
    if (!circleId) { setLoading(false); return; }
    if (!selectedCircleId && circleId) setSelectedCircleId(circleId);

    // Today's check-ins
    const { data: checkIns } = await supabase
      .from('check_ins')
      .select('*')
      .eq('circle_id', circleId)
      .gte('created_at', today + 'T00:00:00')
      .order('vote_count', { ascending: false })
      .limit(50);

    const todayProfiles = indexSafeProfiles(await loadSafeCircleProfiles({
      circleId,
      userIds: (checkIns || []).map((row: any) => row.user_id),
    }));
    const hydratedCheckIns = (checkIns || []).map((row: any) => ({ ...row, user: todayProfiles.get(row.user_id) || null }));
    setTodayCheckIns(hydratedCheckIns);

    // Active members (unique users who checked in today)
    const uniqueUsers = new Set((checkIns || []).map((c: any) => c.user_id));
    setActiveMembers(uniqueUsers.size);

    // Tasks completed today
    const { data: tasks } = await supabase
      .from('tasks')
      .select('id')
      .eq('circle_id', circleId)
      .eq('status', 'done')
      .gte('completed_at', today + 'T00:00:00')
      .limit(50);

    setTasksCompleted(tasks?.length || 0);

    // MVP of the day — most XP earned today
    const { data: xpEvents } = await supabase
      .from('xp_events')
      .select('user_id, xp_amount')
      .eq('circle_id', circleId)
      .gte('created_at', today + 'T00:00:00')
      .limit(50);

    if (xpEvents && xpEvents.length > 0) {
      const xpByUser: Record<string, number> = {};
      for (const e of xpEvents) {
        xpByUser[e.user_id] = (xpByUser[e.user_id] || 0) + e.xp_amount;
      }
      const topUserId = Object.entries(xpByUser).sort((a, b) => b[1] - a[1])[0];
      if (topUserId) {
        const [profile] = await loadSafeCircleProfiles({ circleId, userIds: [topUserId[0]] });
        setMvp({
          name: profile?.display_name || profile?.username || 'Unknown',
          xp: topUserId[1],
        });
      }
    } else {
      setMvp(null);
    }

    // Streak at risk — members who checked in yesterday but not today
    const { data: yesterdayCheckIns } = await supabase
      .from('check_ins')
      .select('user_id')
      .eq('circle_id', circleId)
      .gte('created_at', yesterday + 'T00:00:00')
      .lt('created_at', today + 'T00:00:00')
      .limit(50);

    const yesterdayProfiles = indexSafeProfiles(await loadSafeCircleProfiles({
      circleId,
      userIds: (yesterdayCheckIns || []).map((row: any) => row.user_id),
    }));
    const hydratedYesterday = (yesterdayCheckIns || []).map((row: any) => ({
      ...row,
      user: yesterdayProfiles.get(row.user_id) || null,
    }));
    const todayUserIds = new Set((checkIns || []).map((c: any) => c.user_id));
    const atRisk = hydratedYesterday.filter(
      (c: any) => !todayUserIds.has(c.user_id)
    );
    setStreakAtRisk(atRisk);

    // Coach nudge & insight
    const [n, i, otd] = await Promise.all([
      generateNudge(user.id),
      getProgressInsight(user.id),
      getOnThisDay(user.id),
    ]);
    setNudge(n);
    setInsight(i);
    setOnThisDay(otd);

    setLoading(false);
  }, [selectedCircleId, today, yesterday]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).toUpperCase();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />
      }
    >
      <View style={styles.inner}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>TODAY'S GRIND REPORT</Text>
          <Text style={styles.date}>{dateStr}</Text>
        </View>

        {/* Circle Selector */}
        {circles.length > 1 && (
          <View style={styles.circleSelector}>
            {circles.map((c) => (
              <Pressable
                key={c.id}
                onPress={() => { setSelectedCircleId(c.id); setLoading(true); }}
                style={[
                  styles.circleChip,
                  selectedCircleId === c.id && styles.circleChipActive,
                ]}
              >
                <Text
                  style={[
                    styles.circleChipText,
                    selectedCircleId === c.id && styles.circleChipTextActive,
                  ]}
                >
                  {c.name?.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Nudge */}
        {nudge && (
          <Card style={styles.nudgeCard}>
            <Text style={styles.nudgeText}>{nudge}</Text>
          </Card>
        )}

        {/* Insight */}
        {insight ? (
          <Card style={styles.insightCard}>
            <Text style={styles.insightText}>{insight}</Text>
          </Card>
        ) : null}

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <Card style={styles.statCard}>
            <Text style={styles.statNum}>{formatNumber(todayCheckIns.length)}</Text>
            <Text style={styles.statLabel}>CHECK-INS TODAY</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statNum}>{formatNumber(activeMembers)}</Text>
            <Text style={styles.statLabel}>ACTIVE MEMBERS</Text>
          </Card>
          <Card style={styles.statCard}>
            <Text style={styles.statNum}>{formatNumber(tasksCompleted)}</Text>
            <Text style={styles.statLabel}>TASKS DONE</Text>
          </Card>
        </View>

        {/* MVP */}
        {mvp && (
          <Card style={styles.mvpCard}>
            <Text style={styles.sectionLabel}>MVP OF THE DAY</Text>
            <Text style={styles.mvpName}>🏆 {mvp.name}</Text>
            <Text style={styles.mvpXp}>{formatNumber(mvp.xp)} XP earned today</Text>
          </Card>
        )}

        {/* Streak Watch */}
        {streakAtRisk.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>🔥 STREAK WATCH</Text>
            {streakAtRisk.map((item: any, i: number) => (
              <Card key={i} style={styles.streakCard}>
                <Text style={styles.streakName}>
                  {item.user?.display_name || item.user?.username || 'Unknown'}
                </Text>
                <Text style={styles.streakInfo}>
                  {item.user?.current_streak || 0} day streak at risk
                </Text>
              </Card>
            ))}
          </View>
        )}

        {/* Today's Check-ins */}
        {todayCheckIns.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>TODAY'S CHECK-INS</Text>
            {todayCheckIns.map((item: any) => (
              <Card key={item.id} style={styles.checkinCard}>
                <View style={styles.checkinHeader}>
                  <Text style={styles.checkinUser}>
                    {item.user?.display_name || item.user?.username || 'Unknown'}
                  </Text>
                  <Text style={styles.checkinVotes}>▲ {item.vote_count || 0}</Text>
                </View>
                <Text style={styles.checkinContent}>{item.content}</Text>
              </Card>
            ))}
          </View>
        )}

        {/* On This Day */}
        {(onThisDay.weekAgo.length > 0 || onThisDay.monthAgo.length > 0) && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>📅 ON THIS DAY</Text>
            {onThisDay.weekAgo.length > 0 && (
              <View>
                <Text style={styles.otdSubLabel}>7 DAYS AGO</Text>
                {onThisDay.weekAgo.map((item: any, i: number) => (
                  <Card key={i} style={styles.otdCard}>
                    <Text style={styles.otdText}>{item.content}</Text>
                  </Card>
                ))}
              </View>
            )}
            {onThisDay.monthAgo.length > 0 && (
              <View>
                <Text style={styles.otdSubLabel}>30 DAYS AGO</Text>
                {onThisDay.monthAgo.map((item: any, i: number) => (
                  <Card key={i} style={styles.otdCard}>
                    <Text style={styles.otdText}>{item.content}</Text>
                  </Card>
                ))}
              </View>
            )}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000' },
  scrollContent: { flexGrow: 1 },
  inner: {
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 32,
  },
  header: { marginBottom: 20 },
  title: {
    color: '#fff',
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 3,
  },
  date: {
    color: '#666',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    marginTop: 4,
  },
  circleSelector: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  circleChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#222',
    ...(Platform.OS === 'web' ? { cursor: 'pointer', transition: 'all 0.15s ease' } as any : {}),
  },
  circleChipActive: { borderColor: '#fff', backgroundColor: '#000000' },
  circleChipText: { color: '#555', fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  circleChipTextActive: { color: '#fff' },
  nudgeCard: { marginBottom: 12, borderColor: '#332200' },
  nudgeText: { color: '#e89b3e', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  insightCard: { marginBottom: 16 },
  insightText: { color: '#bbb', fontSize: 14, lineHeight: 20 },
  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  statCard: { flex: 1, alignItems: 'center' as const, padding: 14 },
  statNum: { color: '#fff', fontSize: 22, fontWeight: '900' },
  statLabel: { color: '#666', fontSize: 9, letterSpacing: 1, fontWeight: '700', marginTop: 4, textAlign: 'center' as const },
  mvpCard: { marginBottom: 16, borderColor: '#332200' },
  sectionLabel: {
    color: '#666',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
    marginBottom: 10,
  },
  mvpName: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 4 },
  mvpXp: { color: '#e89b3e', fontSize: 13, fontWeight: '700', marginTop: 2 },
  section: { marginBottom: 20 },
  streakCard: { marginBottom: 6, padding: 12 },
  streakName: { color: '#fff', fontSize: 14, fontWeight: '700' },
  streakInfo: { color: '#e84040', fontSize: 12, marginTop: 2 },
  checkinCard: { marginBottom: 6, padding: 12 },
  checkinHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  checkinUser: { color: '#fff', fontSize: 13, fontWeight: '700' },
  checkinVotes: { color: '#6366f1', fontSize: 12, fontWeight: '700' },
  checkinContent: { color: '#bbb', fontSize: 14, lineHeight: 20 },
  otdSubLabel: {
    color: '#555',
    fontSize: 10,
    letterSpacing: 1,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 8,
  },
  otdCard: { marginBottom: 6, padding: 12, opacity: 0.7 },
  otdText: { color: '#999', fontSize: 13, lineHeight: 18, fontStyle: 'italic' },
});
