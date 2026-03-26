import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { LoadingScreen } from '../../../components/LoadingWave';
import {
  getCircleAnalytics,
  getRealtimeStats,
  getMemberEngagement,
} from '../../../lib/analytics';
import { CircleAnalytics, MemberEngagement } from '../../../types';

type DateRange = '7d' | '30d' | '90d';

export default function AnalyticsTab({ circleId }: { circleId: string }) {
  const [range, setRange] = useState<DateRange>('30d');
  const [analytics, setAnalytics] = useState<CircleAnalytics[]>([]);
  const [realtime, setRealtime] = useState<any>(null);
  const [members, setMembers] = useState<MemberEngagement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, [circleId, range]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [analyticsData, realtimeData, memberData] = await Promise.all([
        getCircleAnalytics(circleId, range),
        getRealtimeStats(circleId),
        getMemberEngagement(circleId, range === '7d' ? 7 : range === '30d' ? 30 : 90),
      ]);
      setAnalytics(analyticsData);
      setRealtime(realtimeData);
      setMembers(memberData);
    } catch (err) {
      console.error('Analytics load error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Aggregate totals from analytics data
  const totals = analytics.reduce(
    (acc, d) => ({
      checkIns: acc.checkIns + d.total_check_ins,
      messages: acc.messages + d.total_messages,
      tasksCompleted: acc.tasksCompleted + d.tasks_completed,
      avgActiveMembers: acc.avgActiveMembers + d.active_members,
    }),
    { checkIns: 0, messages: 0, tasksCompleted: 0, avgActiveMembers: 0 }
  );

  if (analytics.length > 0) {
    totals.avgActiveMembers = Math.round(totals.avgActiveMembers / analytics.length);
  }

  // Max check-ins for bar chart scaling
  const maxCheckIns = Math.max(...analytics.map(d => d.total_check_ins), 1);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      {/* Date range selector */}
      <View style={styles.rangeRow}>
        {(['7d', '30d', '90d'] as DateRange[]).map((r) => (
          <Pressable
            key={r}
            onPress={() => setRange(r)}
            style={[styles.rangePill, range === r && styles.rangePillActive]}
          >
            <Text style={[styles.rangePillText, range === r && styles.rangePillTextActive]}>
              {r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Key metrics */}
      <View style={styles.metricsGrid}>
        <MetricCard
          label="Active Members"
          value={realtime?.totalMembers || 0}
          subtext={`${totals.avgActiveMembers} avg/day`}
          color="#6366f1"
        />
        <MetricCard
          label="Check-ins"
          value={totals.checkIns}
          subtext={`${realtime?.todayCheckIns || 0} today`}
          color="#22c55e"
        />
        <MetricCard
          label="Avg Streak"
          value={`${realtime?.avgStreak || 0}d`}
          subtext="across all members"
          color="#f59e0b"
        />
        <MetricCard
          label="Tasks Done"
          value={totals.tasksCompleted}
          subtext={`${totals.messages} messages`}
          color="#ec4899"
        />
      </View>

      {/* Activity chart (simple bars) */}
      <Text style={styles.sectionTitle}>Daily Check-ins</Text>
      <View style={styles.chartContainer}>
        {analytics.slice(-14).map((day, i) => (
          <View key={i} style={styles.barWrapper}>
            <View
              style={[
                styles.bar,
                {
                  height: Math.max(4, (day.total_check_ins / maxCheckIns) * 80),
                  backgroundColor: day.total_check_ins > 0 ? '#6366f1' : '#2a2a2a',
                },
              ]}
            />
            <Text style={styles.barLabel}>
              {new Date(day.date).getDate()}
            </Text>
          </View>
        ))}
        {analytics.length === 0 && (
          <Text style={styles.emptyChart}>No data yet. Check-ins will appear here.</Text>
        )}
      </View>

      {/* Member engagement table */}
      <Text style={styles.sectionTitle}>Member Engagement</Text>
      <View style={styles.table}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, { flex: 2 }]}>Member</Text>
          <Text style={styles.tableHeaderText}>Check-ins</Text>
          <Text style={styles.tableHeaderText}>Messages</Text>
          <Text style={styles.tableHeaderText}>Tasks</Text>
          <Text style={styles.tableHeaderText}>Streak</Text>
        </View>
        {members.map((member) => (
          <View key={member.user_id} style={styles.tableRow}>
            <Text style={[styles.tableCell, { flex: 2, color: '#fff' }]} numberOfLines={1}>
              {member.display_name || member.username}
            </Text>
            <Text style={styles.tableCell}>{member.check_ins}</Text>
            <Text style={styles.tableCell}>{member.messages}</Text>
            <Text style={styles.tableCell}>{member.tasks_completed}</Text>
            <Text style={[styles.tableCell, { color: '#f59e0b' }]}>
              {member.current_streak}d
            </Text>
          </View>
        ))}
        {members.length === 0 && (
          <Text style={styles.emptyTable}>No member data for this period.</Text>
        )}
      </View>
    </ScrollView>
  );
}

function MetricCard({ label, value, subtext, color }: { label: string; value: string | number; subtext: string; color: string }) {
  return (
    <View style={styles.metricCard}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color }]}>{value}</Text>
      <Text style={styles.metricSubtext}>{subtext}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingText: { color: '#888', fontSize: 13, fontFamily: 'monospace' },
  rangeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  rangePill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  rangePillActive: { backgroundColor: '#6366f1' + '20', borderColor: '#6366f1' },
  rangePillText: { color: '#888', fontSize: 13, fontFamily: 'monospace' },
  rangePillTextActive: { color: '#6366f1' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  metricCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 14,
  },
  metricLabel: { color: '#888', fontSize: 11, fontFamily: 'monospace', marginBottom: 4 },
  metricValue: { fontSize: 24, fontWeight: '700', fontFamily: 'monospace' },
  metricSubtext: { color: '#555', fontSize: 11, fontFamily: 'monospace', marginTop: 2 },
  sectionTitle: { color: '#fff', fontSize: 14, fontWeight: '700', fontFamily: 'monospace', marginBottom: 10, marginTop: 8 },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 16,
    height: 140,
    gap: 4,
    marginBottom: 20,
  },
  barWrapper: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  bar: { width: '80%', borderRadius: 3, minWidth: 8 },
  barLabel: { color: '#555', fontSize: 9, fontFamily: 'monospace', marginTop: 4 },
  emptyChart: { color: '#555', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', flex: 1, alignSelf: 'center' },
  table: {
    backgroundColor: '#111',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    backgroundColor: '#0d0d1a',
  },
  tableHeaderText: { flex: 1, color: '#888', fontSize: 11, fontWeight: '700', fontFamily: 'monospace' },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#0d0d1a',
  },
  tableCell: { flex: 1, color: '#ccc', fontSize: 12, fontFamily: 'monospace' },
  emptyTable: { color: '#555', fontSize: 12, fontFamily: 'monospace', textAlign: 'center', padding: 20 },
});
