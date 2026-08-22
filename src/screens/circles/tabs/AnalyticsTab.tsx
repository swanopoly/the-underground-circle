import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  getCircleAnalytics,
  getMemberEngagement,
  getRealtimeStats,
  type RealtimeCircleStats,
} from '../../../lib/analytics';
import { getSupabaseClientForAccessToken } from '../../../lib/supabase';
import { useAuth } from '../../../hooks/useAuth';
import type { CircleAnalytics, MemberEngagement } from '../../../types';

const ClaudeUsagePanel = React.lazy(() => import('../../../components/ClaudeUsagePanel'));

type DateRange = '7d' | '30d' | '90d';
type ReadState = 'loading' | 'ready' | 'error';

const RANGE_OPTIONS: ReadonlyArray<{ value: DateRange; label: string }> = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
];

const COLORS = {
  canvas: '#0d1117',
  surface: '#161b22',
  inset: '#010409',
  hover: '#1c2128',
  border: '#30363d',
  borderMuted: '#21262d',
  text: '#e6edf3',
  secondary: '#8b949e',
  muted: '#484f58',
  accent: '#6366f1',
  accentHover: '#818cf8',
  accentSubtle: '#6366f115',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149',
  info: '#58a6ff',
} as const;

const WEB_INTERACTIVE = Platform.OS === 'web'
  ? ({ cursor: 'pointer', transitionDuration: '120ms' } as any)
  : null;

function rangeDays(range: DateRange): number {
  return range === '7d' ? 7 : range === '30d' ? 30 : 90;
}

function formatCount(value: number): string {
  return Math.max(0, Number(value) || 0).toLocaleString();
}

function formatUpdatedAt(value: number | null): string {
  if (!value) return 'Not updated yet';
  const elapsedSeconds = Math.max(0, Math.round((Date.now() - value) / 1_000));
  if (elapsedSeconds < 60) return 'Updated just now';
  const minutes = Math.max(1, Math.round(elapsedSeconds / 60));
  return `Updated ${minutes}m ago`;
}

function formatChartDay(date: string, compactRange: boolean): string {
  const parsed = new Date(`${date}T00:00:00`);
  if (!Number.isFinite(parsed.getTime())) return '—';
  return compactRange
    ? parsed.toLocaleDateString(undefined, { weekday: 'narrow' })
    : parsed.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}

export default function AnalyticsTab({ circleId }: { circleId: string }) {
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const { session, user, loading: authLoading } = useAuth();
  const [range, setRange] = useState<DateRange>('30d');
  const [analytics, setAnalytics] = useState<CircleAnalytics[]>([]);
  const [realtime, setRealtime] = useState<RealtimeCircleStats | null>(null);
  const [members, setMembers] = useState<MemberEngagement[]>([]);
  const [summaryState, setSummaryState] = useState<ReadState>('loading');
  const [membersLoading, setMembersLoading] = useState(true);
  const [membersFailed, setMembersFailed] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const requestGenerationRef = useRef(0);
  const accessToken = !authLoading && user?.id === session?.user.id
    ? session?.access_token || null
    : null;
  const exactReadClient = useMemo(
    () => accessToken ? getSupabaseClientForAccessToken(accessToken) : null,
    [accessToken],
  );

  useEffect(() => {
    const generation = ++requestGenerationRef.current;
    setSummaryState('loading');
    setAnalytics([]);
    setRealtime(null);
    setMembers([]);
    setMembersLoading(true);
    setMembersFailed(false);

    if (authLoading) return undefined;
    if (!exactReadClient) {
      setSummaryState('error');
      setMembersLoading(false);
      setMembersFailed(true);
      return undefined;
    }

    // Start every lane together, but do not hold the summary/chart behind the
    // slower per-member engagement counts.
    const memberRequest = getMemberEngagement(
      circleId,
      rangeDays(range),
      exactReadClient,
    );
    void Promise.all([
      getCircleAnalytics(circleId, range, exactReadClient),
      getRealtimeStats(circleId, exactReadClient),
    ]).then(([analyticsData, realtimeData]) => {
      if (generation !== requestGenerationRef.current) return;
      setAnalytics(analyticsData);
      setRealtime(realtimeData);
      setSummaryState('ready');
      setLastUpdatedAt(Date.now());
    }).catch((error) => {
      if (generation !== requestGenerationRef.current) return;
      console.warn('[AnalyticsTab] summary read failed:', error);
      setSummaryState('error');
    });

    void memberRequest.then((memberData) => {
      if (generation !== requestGenerationRef.current) return;
      setMembers(memberData);
    }).catch((error) => {
      if (generation !== requestGenerationRef.current) return;
      console.warn('[AnalyticsTab] member engagement read failed:', error);
      setMembersFailed(true);
    }).finally(() => {
      if (generation === requestGenerationRef.current) setMembersLoading(false);
    });

    return () => {
      if (generation === requestGenerationRef.current) requestGenerationRef.current += 1;
    };
  }, [authLoading, circleId, exactReadClient, range, refreshToken]);

  const totals = useMemo(() => {
    const aggregate = analytics.reduce(
      (acc, day) => ({
        checkIns: acc.checkIns + day.total_check_ins,
        messages: acc.messages + day.total_messages,
        tasksCompleted: acc.tasksCompleted + day.tasks_completed,
        activeMemberDays: acc.activeMemberDays + day.active_members,
      }),
      { checkIns: 0, messages: 0, tasksCompleted: 0, activeMemberDays: 0 },
    );
    return {
      ...aggregate,
      avgActiveMembers: analytics.length > 0
        ? Math.round(aggregate.activeMemberDays / analytics.length)
        : 0,
    };
  }, [analytics]);

  const chartDays = useMemo(
    () => analytics.slice(-(range === '7d' ? 7 : 14)),
    [analytics, range],
  );
  const maxCheckIns = Math.max(...chartDays.map((day) => day.total_check_ins), 1);
  const refreshing = summaryState === 'loading' || membersLoading;
  const selectedRangeLabel = RANGE_OPTIONS.find((option) => option.value === range)?.label || range;

  const retry = () => setRefreshToken((value) => value + 1);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.eyebrow}>CIRCLE ANALYTICS</Text>
          <Text style={styles.pageTitle} accessibilityRole="header">Activity overview</Text>
          <Text style={styles.pageSubtitle}>
            Participation, momentum, and AI usage for the selected period.
          </Text>
        </View>
        <View style={styles.headerActions}>
          <Text style={styles.updatedText}>{formatUpdatedAt(lastUpdatedAt)}</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh analytics"
            accessibilityHint="Reloads activity, member engagement, and usage data."
            accessibilityState={{ disabled: refreshing }}
            disabled={refreshing}
            onPress={retry}
            style={({ hovered, pressed, focused }: any) => [
              styles.refreshButton,
              hovered && !refreshing ? styles.refreshButtonHover : null,
              pressed && !refreshing ? styles.refreshButtonPressed : null,
              focused && Platform.OS === 'web' ? styles.keyboardFocus : null,
              refreshing ? styles.buttonDisabled : null,
              WEB_INTERACTIVE,
            ]}
          >
            {refreshing ? <ActivityIndicator size="small" color={COLORS.secondary} /> : null}
            <Text style={styles.refreshButtonText}>{refreshing ? 'Refreshing' : 'Refresh'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.filterBar}>
        <Text style={styles.filterLabel}>Period</Text>
        <View style={styles.rangeRow} accessibilityRole="tablist">
          {RANGE_OPTIONS.map((option) => {
            const selected = range === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="tab"
                accessibilityLabel={`Show analytics for ${option.label}`}
                accessibilityState={{ selected }}
                onPress={() => setRange(option.value)}
                style={({ hovered, pressed, focused }: any) => [
                  styles.rangeButton,
                  selected ? styles.rangeButtonSelected : null,
                  hovered && !selected ? styles.rangeButtonHover : null,
                  pressed ? styles.rangeButtonPressed : null,
                  focused && Platform.OS === 'web' ? styles.keyboardFocus : null,
                  WEB_INTERACTIVE,
                ]}
              >
                <Text style={[styles.rangeButtonText, selected ? styles.rangeButtonTextSelected : null]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {summaryState === 'loading' ? (
        <OverviewLoading />
      ) : summaryState === 'error' ? (
        <StatePanel
          kind="error"
          title="Analytics unavailable"
          message={exactReadClient
            ? 'The latest circle activity could not be verified. Your existing data was not replaced with zeros.'
            : 'Sign in again to verify access to this circle’s analytics.'}
          actionLabel="Try again"
          onAction={retry}
        />
      ) : (
        <>
          <View style={styles.metricsGrid}>
            <MetricCard
              label="Members"
              value={formatCount(realtime?.totalMembers || 0)}
              detail={`${formatCount(totals.avgActiveMembers)} active on an average day`}
              tone={COLORS.accent}
            />
            <MetricCard
              label="Check-ins"
              value={formatCount(totals.checkIns)}
              detail={`${formatCount(realtime?.todayCheckIns || 0)} today`}
              tone={COLORS.success}
            />
            <MetricCard
              label="Average streak"
              value={`${realtime?.avgStreak || 0}d`}
              detail="Across current members"
              tone={COLORS.warning}
            />
            <MetricCard
              label="Tasks completed"
              value={formatCount(totals.tasksCompleted)}
              detail={`${formatCount(totals.messages)} member messages`}
              tone={COLORS.info}
            />
          </View>

          <View style={styles.panel}>
            <SectionHeader
              title="Check-in rhythm"
              description={range === '7d' ? 'Daily activity' : 'Most recent 14 reported days'}
              meta={`${formatCount(totals.checkIns)} in ${selectedRangeLabel}`}
            />
            {chartDays.length === 0 ? (
              <EmptyPanel
                title="No check-ins in this period"
                message="New check-ins will appear here after the daily analytics snapshot updates."
              />
            ) : (
              <View
                style={styles.chart}
                accessible
                accessibilityLabel={`Daily check-ins for the ${selectedRangeLabel} period`}
              >
                <View style={styles.chartBaseline} />
                {chartDays.map((day) => {
                  const height = Math.max(6, (day.total_check_ins / maxCheckIns) * 104);
                  const label = formatChartDay(day.date, range === '7d');
                  return (
                    <View
                      key={day.date}
                      style={styles.barColumn}
                      accessible
                      accessibilityLabel={`${label}: ${day.total_check_ins} check-ins`}
                    >
                      <Text style={styles.barValue}>{day.total_check_ins || ''}</Text>
                      <View
                        style={[
                          styles.bar,
                          { height },
                          day.total_check_ins === 0 ? styles.barEmpty : null,
                        ]}
                      />
                      <Text style={styles.barLabel} numberOfLines={1}>{label}</Text>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </>
      )}

      <View style={styles.panel}>
        <SectionHeader
          title="Member engagement"
          description={`Individual activity over ${selectedRangeLabel}`}
          meta={!membersLoading && !membersFailed ? `${members.length} members` : undefined}
        />
        {membersLoading ? (
          <PanelLoading label="Loading member engagement" />
        ) : membersFailed ? (
          <StatePanel
            embedded
            kind="error"
            title="Member activity unavailable"
            message="The member-level counts could not be verified. Circle totals above remain independent."
            actionLabel="Try again"
            onAction={retry}
          />
        ) : members.length === 0 ? (
          <EmptyPanel
            title="No member activity yet"
            message="Member check-ins, messages, completed tasks, and streaks will appear here."
          />
        ) : compact ? (
          <View style={styles.memberList}>
            {members.map((member, index) => (
              <CompactMemberRow key={member.user_id} member={member} last={index === members.length - 1} />
            ))}
          </View>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.table}>
              <View style={styles.tableHeader} accessibilityRole="header">
                <Text style={[styles.tableHeaderText, styles.memberColumn]}>Member</Text>
                <Text style={styles.metricColumnHeader}>Check-ins</Text>
                <Text style={styles.metricColumnHeader}>Messages</Text>
                <Text style={styles.metricColumnHeader}>Tasks</Text>
                <Text style={styles.metricColumnHeader}>Streak</Text>
              </View>
              {members.map((member, index) => (
                <View
                  key={member.user_id}
                  style={[styles.tableRow, index === members.length - 1 ? styles.tableRowLast : null]}
                  accessible
                  accessibilityLabel={`${member.display_name || member.username || 'Member'}: ${member.check_ins} check-ins, ${member.messages} messages, ${member.tasks_completed} tasks, ${member.current_streak} day streak`}
                >
                  <Text style={[styles.tableMember, styles.memberColumn]} numberOfLines={1}>
                    {member.display_name || member.username || 'Member'}
                  </Text>
                  <Text style={styles.metricColumn}>{formatCount(member.check_ins)}</Text>
                  <Text style={styles.metricColumn}>{formatCount(member.messages)}</Text>
                  <Text style={styles.metricColumn}>{formatCount(member.tasks_completed)}</Text>
                  <Text style={[styles.metricColumn, styles.streakText]}>{member.current_streak}d</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        )}
      </View>

      {exactReadClient ? (
        <React.Suspense fallback={<PanelLoading label="Loading AI usage" framed />}>
          <ClaudeUsagePanel circleId={circleId} client={exactReadClient} />
        </React.Suspense>
      ) : null}
    </ScrollView>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: string;
}) {
  return (
    <View
      style={styles.metricCard}
      accessible
      accessibilityLabel={`${label}: ${value}. ${detail}`}
    >
      <View style={styles.metricLabelRow}>
        <View style={[styles.metricDot, { backgroundColor: tone }]} />
        <Text style={styles.metricLabel}>{label}</Text>
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function SectionHeader({
  title,
  description,
  meta,
}: {
  title: string;
  description: string;
  meta?: string;
}) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.sectionHeaderCopy}>
        <Text style={styles.sectionTitle} accessibilityRole="header">{title}</Text>
        <Text style={styles.sectionDescription}>{description}</Text>
      </View>
      {meta ? <Text style={styles.sectionMeta}>{meta}</Text> : null}
    </View>
  );
}

function OverviewLoading() {
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="Loading analytics overview">
      <View style={styles.metricsGrid}>
        {[0, 1, 2, 3].map((index) => (
          <View key={index} style={[styles.metricCard, styles.loadingMetricCard]}>
            <View style={styles.loadingLineShort} />
            <View style={styles.loadingLineValue} />
            <View style={styles.loadingLine} />
          </View>
        ))}
      </View>
      <View style={[styles.panel, styles.overviewLoadingPanel]}>
        <ActivityIndicator color={COLORS.accent} />
        <Text style={styles.loadingText}>Loading verified circle activity…</Text>
      </View>
    </View>
  );
}

function PanelLoading({ label, framed = false }: { label: string; framed?: boolean }) {
  return (
    <View
      style={[styles.panelLoading, framed ? styles.panel : null]}
      accessibilityRole="progressbar"
      accessibilityLabel={label}
    >
      <ActivityIndicator color={COLORS.accent} />
      <Text style={styles.loadingText}>{label}…</Text>
    </View>
  );
}

function EmptyPanel({ title, message }: { title: string; message: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyMessage}>{message}</Text>
    </View>
  );
}

function StatePanel({
  title,
  message,
  actionLabel,
  onAction,
  embedded = false,
}: {
  kind: 'error';
  title: string;
  message: string;
  actionLabel: string;
  onAction: () => void;
  embedded?: boolean;
}) {
  return (
    <View style={[styles.statePanel, embedded ? styles.statePanelEmbedded : null]} accessibilityRole="alert">
      <View style={styles.stateCopy}>
        <Text style={styles.stateTitle}>{title}</Text>
        <Text style={styles.stateMessage}>{message}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={actionLabel}
        onPress={onAction}
        style={({ hovered, pressed, focused }: any) => [
          styles.secondaryButton,
          hovered ? styles.secondaryButtonHover : null,
          pressed ? styles.secondaryButtonPressed : null,
          focused && Platform.OS === 'web' ? styles.keyboardFocus : null,
          WEB_INTERACTIVE,
        ]}
      >
        <Text style={styles.secondaryButtonText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

function CompactMemberRow({ member, last }: { member: MemberEngagement; last: boolean }) {
  const name = member.display_name || member.username || 'Member';
  return (
    <View
      style={[styles.compactMemberRow, last ? styles.compactMemberRowLast : null]}
      accessible
      accessibilityLabel={`${name}: ${member.check_ins} check-ins, ${member.messages} messages, ${member.tasks_completed} tasks, ${member.current_streak} day streak`}
    >
      <Text style={styles.compactMemberName} numberOfLines={1}>{name}</Text>
      <View style={styles.compactMemberMetrics}>
        <CompactMetric label="Check-ins" value={member.check_ins} />
        <CompactMetric label="Messages" value={member.messages} />
        <CompactMetric label="Tasks" value={member.tasks_completed} />
        <CompactMetric label="Streak" value={`${member.current_streak}d`} accent />
      </View>
    </View>
  );
}

function CompactMetric({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <View style={styles.compactMetric}>
      <Text style={styles.compactMetricLabel}>{label}</Text>
      <Text style={[styles.compactMetricValue, accent ? styles.streakText : null]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.canvas,
  },
  content: {
    width: '100%',
    maxWidth: 1120,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 48,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
  },
  headerCopy: {
    flex: 1,
    minWidth: 220,
  },
  eyebrow: {
    color: COLORS.accentHover,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 6,
  },
  pageTitle: {
    color: COLORS.text,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '700',
  },
  pageSubtitle: {
    color: COLORS.secondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
    maxWidth: 560,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
  },
  updatedText: {
    color: COLORS.muted,
    fontSize: 12,
  },
  refreshButton: {
    minHeight: 44,
    minWidth: 104,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  refreshButtonHover: {
    backgroundColor: COLORS.hover,
    borderColor: COLORS.secondary,
  },
  refreshButtonPressed: {
    backgroundColor: COLORS.inset,
  },
  refreshButtonText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  buttonDisabled: {
    opacity: 0.58,
  },
  keyboardFocus: Platform.OS === 'web' ? ({
    outlineStyle: 'solid',
    outlineWidth: 2,
    outlineColor: COLORS.accentHover,
    outlineOffset: 2,
  } as any) : {},
  filterBar: {
    minHeight: 52,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: COLORS.borderMuted,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  filterLabel: {
    color: COLORS.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  rangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rangeButton: {
    minHeight: 44,
    minWidth: 72,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  rangeButtonSelected: {
    backgroundColor: COLORS.accentSubtle,
    borderColor: COLORS.accent,
  },
  rangeButtonHover: {
    backgroundColor: COLORS.hover,
  },
  rangeButtonPressed: {
    opacity: 0.78,
  },
  rangeButtonText: {
    color: COLORS.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  rangeButtonTextSelected: {
    color: COLORS.accentHover,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: 220,
    minWidth: 150,
    minHeight: 126,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  metricLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metricDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  metricLabel: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '600',
  },
  metricValue: {
    color: COLORS.text,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
    marginTop: 12,
  },
  metricDetail: {
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
  },
  panel: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderMuted,
  },
  sectionHeaderCopy: {
    flex: 1,
    minWidth: 190,
  },
  sectionTitle: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: '600',
  },
  sectionDescription: {
    color: COLORS.secondary,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  sectionMeta: {
    color: COLORS.accentHover,
    fontSize: 12,
    fontWeight: '600',
  },
  chart: {
    height: 168,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 5,
    paddingTop: 18,
    position: 'relative',
  },
  chartBaseline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 28,
    height: 1,
    backgroundColor: COLORS.borderMuted,
  },
  barColumn: {
    flex: 1,
    minWidth: 12,
    height: 142,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  barValue: {
    minHeight: 15,
    color: COLORS.muted,
    fontSize: 9,
    marginBottom: 4,
  },
  bar: {
    width: '64%',
    maxWidth: 28,
    minWidth: 8,
    borderTopLeftRadius: 5,
    borderTopRightRadius: 5,
    backgroundColor: COLORS.accent,
  },
  barEmpty: {
    backgroundColor: COLORS.borderMuted,
  },
  barLabel: {
    color: COLORS.muted,
    fontSize: 9,
    marginTop: 6,
    minHeight: 14,
  },
  table: {
    minWidth: 700,
    width: '100%',
  },
  tableHeader: {
    flexDirection: 'row',
    paddingHorizontal: 4,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  tableHeaderText: {
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '600',
  },
  memberColumn: {
    flex: 2,
    minWidth: 220,
  },
  metricColumnHeader: {
    flex: 1,
    minWidth: 92,
    color: COLORS.secondary,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  tableRow: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderMuted,
  },
  tableRowLast: {
    borderBottomWidth: 0,
  },
  tableMember: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '500',
    paddingRight: 16,
  },
  metricColumn: {
    flex: 1,
    minWidth: 92,
    color: COLORS.secondary,
    fontSize: 13,
    textAlign: 'right',
  },
  streakText: {
    color: COLORS.warning,
    fontWeight: '600',
  },
  memberList: {
    marginHorizontal: -4,
  },
  compactMemberRow: {
    paddingHorizontal: 4,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.borderMuted,
  },
  compactMemberRowLast: {
    borderBottomWidth: 0,
    paddingBottom: 2,
  },
  compactMemberName: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 10,
  },
  compactMemberMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  compactMetric: {
    minWidth: 68,
    flexGrow: 1,
  },
  compactMetricLabel: {
    color: COLORS.muted,
    fontSize: 10,
    marginBottom: 2,
  },
  compactMetricValue: {
    color: COLORS.secondary,
    fontSize: 13,
    fontWeight: '600',
  },
  statePanel: {
    minHeight: 118,
    padding: 16,
    borderWidth: 1,
    borderColor: `${COLORS.danger}55`,
    borderRadius: 12,
    backgroundColor: `${COLORS.danger}0d`,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  statePanelEmbedded: {
    minHeight: 96,
    marginTop: 14,
  },
  stateCopy: {
    flex: 1,
    minWidth: 220,
  },
  stateTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
  },
  stateMessage: {
    color: COLORS.secondary,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonHover: {
    backgroundColor: COLORS.hover,
    borderColor: COLORS.secondary,
  },
  secondaryButtonPressed: {
    backgroundColor: COLORS.inset,
  },
  secondaryButtonText: {
    color: COLORS.text,
    fontSize: 13,
    fontWeight: '600',
  },
  emptyState: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingTop: 18,
  },
  emptyTitle: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptyMessage: {
    color: COLORS.secondary,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 480,
    marginTop: 5,
  },
  panelLoading: {
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  overviewLoadingPanel: {
    minHeight: 190,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  loadingText: {
    color: COLORS.secondary,
    fontSize: 12,
  },
  loadingMetricCard: {
    justifyContent: 'center',
    gap: 12,
  },
  loadingLineShort: {
    width: '42%',
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.borderMuted,
  },
  loadingLineValue: {
    width: '58%',
    height: 24,
    borderRadius: 6,
    backgroundColor: COLORS.border,
  },
  loadingLine: {
    width: '76%',
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.borderMuted,
  },
});
