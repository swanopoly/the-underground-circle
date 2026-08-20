/**
 * OfficeAnalyticsPanel.tsx — Real-time Circle Office analytics
 *
 * Toggle: "🌐 All Agents" vs "🎯 My Agents"
 * Stats: tokens, messages, latency, uptime, most active agent
 * Live via Supabase Realtime subscription on circle_office_agents
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { subscribeWithReconnect } from '../lib/subscribeWithReconnect';
import { CircleOfficeAgent } from '../lib/circleOffice';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  circleId: string;
  userId: string;
  agents: CircleOfficeAgent[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000)      return `${(n / 1000).toFixed(1)}K`;
  return String(n || 0);
}

function tokenColor(n: number): string {
  if (n > 200_000) return '#ef4444';
  if (n > 50_000)  return '#f59e0b';
  return '#22c55e';
}

function latencyColor(ms: number): string {
  if (ms > 5000) return '#ef4444';
  if (ms > 2000) return '#f59e0b';
  return '#22c55e';
}

function uptimeColor(score: number): string {
  if (score >= 0.9) return '#22c55e';
  if (score >= 0.6) return '#f59e0b';
  return '#ef4444';
}

function fmtLatency(ms: number | null | undefined): string {
  if (!ms) return '—';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms}ms`;
}

function fmtUptime(score: number | null | undefined): string {
  if (score == null) return '—';
  return `${Math.round(score * 100)}%`;
}

function readNumericMetric(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: string;
  value: string;
  label: string;
  valueColor?: string;
  sub?: string;
}

function StatCard({ icon, value, label, valueColor = '#e8e8e8', sub }: StatCardProps) {
  return (
    <View style={cardStyles.card}>
      <Text style={cardStyles.icon}>{icon}</Text>
      <Text style={[cardStyles.value, { color: valueColor }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={cardStyles.label}>{label}</Text>
      {sub ? <Text style={cardStyles.sub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: '46%',
    backgroundColor: '#161616',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  icon: { fontSize: 20, marginBottom: 6 },
  value: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  label: { color: '#6f6f6f', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  sub: { color: '#e8e8e8', fontSize: 10, marginTop: 2 },
});

// ─── Agent Row (mini list) ────────────────────────────────────────────────────

function AgentRow({ agent }: { agent: CircleOfficeAgent }) {
  const statusColors: Record<string, string> = {
    idle: '#22c55e', building: '#3b82f6', offline: '#6f6f6f', error: '#ef4444',
  };
  const color = statusColors[agent.status] || '#6f6f6f';
  return (
    <View style={rowStyles.row}>
      <View style={[rowStyles.dot, { backgroundColor: color }]} />
      <View style={rowStyles.info}>
        <Text style={rowStyles.name} numberOfLines={1}>{agent.name}</Text>
        <Text style={rowStyles.owner} numberOfLines={1}>{agent.ownerDisplayName}</Text>
      </View>
      <Text style={[rowStyles.tokens, { color: tokenColor(agent.token_usage_total ?? 0) }]}>
        {fmtTokens(agent.token_usage_total ?? 0)}
      </Text>
      <Text style={rowStyles.msgs}>{agent.message_count_total ?? 0} msgs</Text>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
    gap: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  info: { flex: 1 },
  name: { color: '#e8e8e8', fontSize: 12, fontWeight: '600' },
  owner: { color: '#6f6f6f', fontSize: 10 },
  tokens: { fontSize: 12, fontWeight: '700', minWidth: 50, textAlign: 'right' },
  msgs: { color: '#6f6f6f', fontSize: 10, minWidth: 45, textAlign: 'right' },
});

// ─── Main Component ───────────────────────────────────────────────────────────

interface LatencyPercentiles { p50: number; p95: number; p99: number; count: number }
interface ErrorRateData { total: number; errors: number; rate: number; recentErrors: Array<{ agent: string; error: string; time: string }> }

function computePercentiles(values: number[]): LatencyPercentiles {
  if (values.length === 0) return { p50: 0, p95: 0, p99: 0, count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const p = (pct: number) => sorted[Math.min(Math.floor(sorted.length * pct / 100), sorted.length - 1)];
  return { p50: p(50), p95: p(95), p99: p(99), count: sorted.length };
}

interface UserUsage { name: string; commands: number; tokens: number; model: string; lastActive: string }

interface AnalyticsSnapshot {
  latencyPercentiles: LatencyPercentiles;
  errorRateData: ErrorRateData;
  userUsage: UserUsage[];
}

interface AnalyticsResponseRow {
  id: string;
  latency_ms: number | null;
  status: string;
  agent_name: string | null;
  error_message: string | null;
  created_at: string;
}

interface AnalyticsMessageRow {
  id: string;
  sender_id: string | null;
  model: string | null;
  created_at: string;
}

interface AnalyticsResponseUsageRow {
  id: string;
  message_id: string;
  token_count: number | null;
  model: string | null;
  created_at: string;
}

interface AnalyticsProfileRow {
  id: string;
  display_name: string | null;
  username: string | null;
}

const ANALYTICS_PAGE_SIZE = 500;
const ANALYTICS_FILTER_CHUNK_SIZE = 100;

function chunkValues<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function loadAllResponseRows(
  circleId: string,
  windowStart: string,
  windowEnd: string,
): Promise<AnalyticsResponseRow[]> {
  const rows: AnalyticsResponseRow[] = [];
  let expectedCount: number | null = null;
  let offset = 0;
  while (expectedCount === null || offset < expectedCount) {
    const { data, error, count } = await supabase
      .from('office_terminal_responses')
      .select('id, latency_ms, status, agent_name, error_message, created_at', { count: 'exact' })
      .eq('circle_id', circleId)
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);
    if (error) throw error;
    if (!Number.isSafeInteger(count) || Number(count) < 0 || (expectedCount !== null && count !== expectedCount)) {
      throw new Error('Analytics response history changed while it was loading.');
    }
    if (expectedCount === null) expectedCount = Number(count);
    const page = (data ?? []) as AnalyticsResponseRow[];
    rows.push(...page);
    offset += page.length;
    if (offset === expectedCount) break;
    if (offset > expectedCount || page.length === 0) throw new Error('Analytics response history was incomplete.');
  }
  return rows;
}

async function loadAllMessageRows(
  circleId: string,
  windowStart: string,
  windowEnd: string,
): Promise<AnalyticsMessageRow[]> {
  const rows: AnalyticsMessageRow[] = [];
  let expectedCount: number | null = null;
  let offset = 0;
  while (expectedCount === null || offset < expectedCount) {
    const { data, error, count } = await supabase
      .from('office_terminal_messages')
      .select('id, sender_id, model, created_at', { count: 'exact' })
      .eq('circle_id', circleId)
      .gte('created_at', windowStart)
      .lte('created_at', windowEnd)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);
    if (error) throw error;
    if (!Number.isSafeInteger(count) || Number(count) < 0 || (expectedCount !== null && count !== expectedCount)) {
      throw new Error('Analytics message history changed while it was loading.');
    }
    if (expectedCount === null) expectedCount = Number(count);
    const page = (data ?? []) as AnalyticsMessageRow[];
    rows.push(...page);
    offset += page.length;
    if (offset === expectedCount) break;
    if (offset > expectedCount || page.length === 0) throw new Error('Analytics message history was incomplete.');
  }
  return rows;
}

async function loadProfiles(senderIds: string[]): Promise<AnalyticsProfileRow[]> {
  const rows: AnalyticsProfileRow[] = [];
  for (const senderIdChunk of chunkValues(senderIds, ANALYTICS_FILTER_CHUNK_SIZE)) {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, display_name, username')
      .in('id', senderIdChunk)
      .order('id', { ascending: true });
    if (error) throw error;
    rows.push(...((data ?? []) as AnalyticsProfileRow[]));
  }
  return rows;
}

async function loadResponseUsageRows(
  messageIds: string[],
  windowStart: string,
  windowEnd: string,
): Promise<AnalyticsResponseUsageRow[]> {
  const rows: AnalyticsResponseUsageRow[] = [];
  for (const messageIdChunk of chunkValues(messageIds, ANALYTICS_FILTER_CHUNK_SIZE)) {
    let expectedCount: number | null = null;
    let offset = 0;
    while (expectedCount === null || offset < expectedCount) {
      const { data, error, count } = await supabase
        .from('office_terminal_responses')
        .select('id, message_id, token_count, model, created_at', { count: 'exact' })
        .in('message_id', messageIdChunk)
        .gte('created_at', windowStart)
        .lte('created_at', windowEnd)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + ANALYTICS_PAGE_SIZE - 1);
      if (error) throw error;
      if (!Number.isSafeInteger(count) || Number(count) < 0 || (expectedCount !== null && count !== expectedCount)) {
        throw new Error('Analytics usage history changed while it was loading.');
      }
      if (expectedCount === null) expectedCount = Number(count);
      const page = (data ?? []) as AnalyticsResponseUsageRow[];
      rows.push(...page);
      offset += page.length;
      if (offset === expectedCount) break;
      if (offset > expectedCount || page.length === 0) throw new Error('Analytics usage history was incomplete.');
    }
  }
  return rows;
}

const EMPTY_ANALYTICS: AnalyticsSnapshot = {
  latencyPercentiles: { p50: 0, p95: 0, p99: 0, count: 0 },
  errorRateData: { total: 0, errors: 0, rate: 0, recentErrors: [] },
  userUsage: [],
};

type Scope = 'all' | 'mine';

export default function OfficeAnalyticsPanel({ circleId, userId, agents: propAgents }: Props) {
  const [scope, setScope] = useState<Scope>('all');
  const [focusedControl, setFocusedControl] = useState<'all' | 'mine' | 'refresh' | null>(null);
  const [agents, setAgents] = useState<CircleOfficeAgent[]>(propAgents);
  const [agentScopeKey, setAgentScopeKey] = useState(`${circleId}:${userId}`);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot>(EMPTY_ANALYTICS);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const [analyticsStale, setAnalyticsStale] = useState(false);
  const [hasAnalyticsSnapshot, setHasAnalyticsSnapshot] = useState(false);
  const [analyticsUpdatedAt, setAnalyticsUpdatedAt] = useState<Date | null>(null);
  const analyticsGenerationRef = useRef(0);
  const analyticsScopeRef = useRef<string | null>(null);
  const realtimeGenerationRef = useRef(0);
  const usageRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentAnalyticsScope = `${circleId}:${userId}`;

  // Keep local state in sync with prop changes (parent's realtime updates)
  useEffect(() => {
    setAgents(propAgents);
    setAgentScopeKey(`${circleId}:${userId}`);
  }, [circleId, userId, propAgents]);

  // Additional realtime subscription for analytics-specific fields
  useEffect(() => {
    const generation = ++realtimeGenerationRef.current;
    const handle = subscribeWithReconnect({
      channelName: `analytics-${circleId}`,
      // No onCatchUp: this handler applies incremental UPDATE patches over the
      // `propAgents` snapshot the parent owns, so there is nothing local to
      // refetch. Reconnect alone is the fix — the parent's own poll re-seeds it.
      setup: (channel) => channel
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'circle_office_agents',
        filter: `circle_id=eq.${circleId}`,
      }, ({ new: row }) => {
        if (realtimeGenerationRef.current !== generation) return;
        const r = row as Record<string, unknown>;
        setAgents(prev => prev.map(a =>
          a.id === (r.id as string)
            ? {
                ...a,
                token_usage_today:   (r.token_usage_today  as number) ?? a.token_usage_today,
                token_usage_total:   (r.token_usage_total  as number) ?? a.token_usage_total,
                message_count_today: (r.message_count_today as number) ?? a.message_count_today,
                message_count_total: (r.message_count_total as number) ?? a.message_count_total,
                last_response_ms:    (r.last_response_ms   as number) ?? a.last_response_ms,
                uptime_score:        (r.uptime_score        as number) ?? a.uptime_score,
                status:              (r.status              as CircleOfficeAgent['status']) ?? a.status,
                input_tokens_today:  (r.input_tokens_today  as number) ?? a.input_tokens_today,
                output_tokens_today: (r.output_tokens_today as number) ?? a.output_tokens_today,
                cached_tokens_today: (r.cached_tokens_today as number) ?? a.cached_tokens_today,
                input_tokens_total:  (r.input_tokens_total  as number) ?? a.input_tokens_total,
                output_tokens_total: (r.output_tokens_total as number) ?? a.output_tokens_total,
                cached_tokens_total: (r.cached_tokens_total as number) ?? a.cached_tokens_total,
                estimated_cost_today: readNumericMetric(r.estimated_cost_today, a.estimated_cost_today ?? 0),
                estimated_cost_total: readNumericMetric(r.estimated_cost_total, a.estimated_cost_total ?? 0),
                model_name:           (r.model_name as string) ?? a.model_name,
              }
            : a
        ));
      }),
    });

    return () => {
      if (realtimeGenerationRef.current === generation) {
        realtimeGenerationRef.current += 1;
      }
      handle.unsubscribe();
    };
  }, [circleId, userId]);

  // Load latency percentiles and error rates from terminal responses
  const loadResponseAnalytics = useCallback(async () => {
    const requestScope = `${circleId}:${userId}`;
    const generation = ++analyticsGenerationRef.current;
    const canRetainSnapshot = analyticsScopeRef.current === requestScope;

    setAnalyticsLoading(true);
    setAnalyticsError(null);
    setAnalyticsStale(false);
    if (!canRetainSnapshot) {
      setAnalytics(EMPTY_ANALYTICS);
      setHasAnalyticsSnapshot(false);
      setAnalyticsUpdatedAt(null);
    }

    if (!circleId || !userId) {
      if (analyticsGenerationRef.current === generation) {
        setAnalyticsLoading(false);
        setAnalyticsError('Analytics are unavailable until the circle and member scope are ready.');
      }
      return;
    }

    try {
      const snapshotTime = Date.now();
      const windowEnd = new Date(snapshotTime).toISOString();
      const windowStart = new Date(snapshotTime - 7 * 86400000).toISOString();
      const responseRows = await loadAllResponseRows(circleId, windowStart, windowEnd);

      const latencies = responseRows
        .filter(r => r.status === 'done' && r.latency_ms != null)
        .map(r => r.latency_ms as number);
      const nextLatencyPercentiles = computePercentiles(latencies);

      const total = responseRows.length;
      const errors = responseRows.filter(r => r.status === 'error').length;
      const recentErrors = responseRows
        .filter(r => r.status === 'error')
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5)
        .map(r => ({
          agent: r.agent_name || 'Unknown',
          error: r.error_message || 'Unknown error',
          time: r.created_at,
        }));
      const nextErrorRateData: ErrorRateData = {
        total,
        errors,
        rate: total > 0 ? (errors / total) * 100 : 0,
        recentErrors,
      };

      const messageRows = await loadAllMessageRows(circleId, windowStart, windowEnd);
      let nextUserUsage: UserUsage[] = [];

      if (messageRows.length > 0) {
        const senderIds = [...new Set(messageRows.map(m => m.sender_id).filter((id): id is string => Boolean(id)))];
        const profiles = senderIds.length > 0 ? await loadProfiles(senderIds) : [];
        const profileMap = new Map(profiles.map(p => [p.id, p]));

        const msgIds = messageRows.map(m => m.id);
        const responseUsageRows = msgIds.length > 0
          ? await loadResponseUsageRows(msgIds, windowStart, windowEnd)
          : [];

        const respByMsg = new Map<string, { tokens: number; model: string }>();
        for (const r of responseUsageRows) {
          const existing = respByMsg.get(r.message_id);
          respByMsg.set(r.message_id, {
            tokens: (existing?.tokens || 0) + (r.token_count || 0),
            model: r.model || existing?.model || 'unknown',
          });
        }

        const byUser = new Map<string, { commands: number; tokens: number; models: Record<string, number>; lastActive: string }>();
        for (const m of messageRows) {
          const sid = m.sender_id || 'unknown';
          const entry = byUser.get(sid) || { commands: 0, tokens: 0, models: {}, lastActive: '' };
          entry.commands++;
          const response = respByMsg.get(m.id);
          entry.tokens += response?.tokens || 0;
          const model = response?.model || m.model || 'unknown';
          entry.models[model] = (entry.models[model] || 0) + 1;
          if (m.created_at > entry.lastActive) entry.lastActive = m.created_at;
          byUser.set(sid, entry);
        }

        const usage: UserUsage[] = [];
        for (const [senderId, data] of byUser) {
          const profile = profileMap.get(senderId);
          const topModel = Object.entries(data.models).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
          usage.push({
            name: profile?.display_name || profile?.username || 'User',
            commands: data.commands,
            tokens: data.tokens,
            model: topModel
              .replace('claude-haiku-4-5-20251001', 'Haiku')
              .replace('claude-sonnet-4-6', 'Sonnet')
              .replace('claude-opus-4-6', 'Opus')
              .replace('blackswan', 'BlackSwan'),
            lastActive: data.lastActive,
          });
        }
        nextUserUsage = usage.sort((a, b) => b.tokens - a.tokens);
      }

      if (analyticsGenerationRef.current !== generation) return;
      setAnalytics({
        latencyPercentiles: nextLatencyPercentiles,
        errorRateData: nextErrorRateData,
        userUsage: nextUserUsage,
      });
      analyticsScopeRef.current = requestScope;
      setHasAnalyticsSnapshot(true);
      setAnalyticsUpdatedAt(new Date(windowEnd));
    } catch (err) {
      console.error('[OfficeAnalytics] Failed to load response analytics:', err);
      if (analyticsGenerationRef.current !== generation) return;
      setAnalyticsError('Circle analytics could not be loaded. Check your connection and try again.');
      setAnalyticsStale(canRetainSnapshot);
      setHasAnalyticsSnapshot(canRetainSnapshot);
    } finally {
      if (analyticsGenerationRef.current === generation) {
        setAnalyticsLoading(false);
      }
    }
  }, [circleId, userId]);

  useEffect(() => {
    void loadResponseAnalytics();
    return () => {
      analyticsGenerationRef.current += 1;
    };
  }, [loadResponseAnalytics]);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (usageRefreshTimerRef.current) clearTimeout(usageRefreshTimerRef.current);
      usageRefreshTimerRef.current = setTimeout(() => {
        usageRefreshTimerRef.current = null;
        void loadResponseAnalytics();
      }, 1200);
    };
    const handle = subscribeWithReconnect({
      channelName: `analytics-usage-${circleId}`,
      setup: channel => channel
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'office_terminal_responses',
          filter: `circle_id=eq.${circleId}`,
        }, scheduleRefresh)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'office_terminal_messages',
          filter: `circle_id=eq.${circleId}`,
        }, scheduleRefresh),
      onCatchUp: scheduleRefresh,
    });

    return () => {
      if (usageRefreshTimerRef.current) {
        clearTimeout(usageRefreshTimerRef.current);
        usageRefreshTimerRef.current = null;
      }
      handle.unsubscribe();
    };
  }, [circleId, loadResponseAnalytics]);

  const analyticsMatchesScope = analyticsScopeRef.current === currentAnalyticsScope;
  const showAnalyticsSnapshot = hasAnalyticsSnapshot && analyticsMatchesScope;
  const { latencyPercentiles, errorRateData, userUsage } = showAnalyticsSnapshot
    ? analytics
    : EMPTY_ANALYTICS;

  // Filter by scope
  const scopedAgents = agentScopeKey === currentAnalyticsScope ? agents : [];
  const filtered = scope === 'mine'
    ? scopedAgents.filter(a => a.ownerId === userId)
    : scopedAgents;

  // Compute stats
  const totalTokensToday    = filtered.reduce((s, a) => s + (a.token_usage_today   ?? 0), 0);
  const totalTokensAllTime  = filtered.reduce((s, a) => s + (a.token_usage_total   ?? 0), 0);
  const totalMessagesToday  = filtered.reduce((s, a) => s + (a.message_count_today ?? 0), 0);
  const totalMessagesAllTime = filtered.reduce((s, a) => s + (a.message_count_total ?? 0), 0);
  // Use DB-stored estimated cost (model-aware) instead of flat-rate guess
  const totalCostToday      = filtered.reduce((s, a) => s + (a.estimated_cost_today ?? 0), 0);
  const totalCostAllTime    = filtered.reduce((s, a) => s + (a.estimated_cost_total ?? 0), 0);
  // Granular token breakdown
  const inputTokensToday    = filtered.reduce((s, a) => s + (a.input_tokens_today  ?? 0), 0);
  const outputTokensToday   = filtered.reduce((s, a) => s + (a.output_tokens_today ?? 0), 0);
  const cachedTokensToday   = filtered.reduce((s, a) => s + (a.cached_tokens_today ?? 0), 0);
  const onlineCount         = filtered.filter(a => a.status !== 'offline').length;
  const latencies           = filtered.map(a => a.last_response_ms).filter((v): v is number => v != null);
  const avgLatency          = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const uptimes             = filtered.map(a => a.uptime_score).filter((v): v is number => v != null);
  const avgUptime           = uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : null;
  const mostActive          = filtered.reduce<CircleOfficeAgent | null>((best, a) =>
    (a.message_count_today ?? 0) > (best?.message_count_today ?? -1) ? a : best, null);

  // Sort agents by total usage desc for the list
  const sortedAgents = [...filtered].sort((a, b) =>
    (b.token_usage_total ?? 0) - (a.token_usage_total ?? 0)
  );
  const hasCircleActivity = errorRateData.total > 0 || userUsage.length > 0;
  const analyticsStatusTitle = analyticsLoading
    ? (showAnalyticsSnapshot ? 'Refreshing circle analytics' : 'Loading circle analytics')
    : analyticsError
      ? (analyticsStale && showAnalyticsSnapshot ? 'Circle analytics may be out of date' : 'Circle analytics unavailable')
      : showAnalyticsSnapshot
        ? (hasCircleActivity ? 'Circle analytics are current' : 'No circle terminal activity in the past 7 days')
        : 'Preparing circle analytics';
  const analyticsStatusDetail = analyticsError
    ? (analyticsStale && showAnalyticsSnapshot
        ? 'The last successful circle-wide snapshot remains visible below.'
        : analyticsError)
    : analyticsLoading && showAnalyticsSnapshot
      ? 'The last successful circle-wide snapshot remains visible while this refresh runs.'
      : showAnalyticsSnapshot && analyticsUpdatedAt
        ? `Circle-wide request and member metrics updated ${analyticsUpdatedAt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`
        : 'Seven-day request and member metrics cover the entire circle.';

  return (
    <View style={styles.container}>
      {/* Scope toggle */}
      <View style={styles.toggleRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show all agent cards"
          accessibilityHint="Changes the agent cards and agent breakdown only"
          accessibilityState={{ selected: scope === 'all' }}
          hitSlop={4}
          onFocus={() => setFocusedControl('all')}
          onBlur={() => setFocusedControl(null)}
          style={({ pressed }) => [
            styles.toggleBtn,
            scope === 'all' && styles.toggleBtnActive,
            focusedControl === 'all' && styles.controlFocused,
            pressed && styles.controlPressed,
          ]}
          onPress={() => setScope('all')}
        >
          <Text style={[styles.toggleText, scope === 'all' && styles.toggleTextActive]}>
            🌐 All Agents
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show my agent cards"
          accessibilityHint="Changes the agent cards and agent breakdown only"
          accessibilityState={{ selected: scope === 'mine' }}
          hitSlop={4}
          onFocus={() => setFocusedControl('mine')}
          onBlur={() => setFocusedControl(null)}
          style={({ pressed }) => [
            styles.toggleBtn,
            scope === 'mine' && styles.toggleBtnActive,
            focusedControl === 'mine' && styles.controlFocused,
            pressed && styles.controlPressed,
          ]}
          onPress={() => setScope('mine')}
        >
          <Text style={[styles.toggleText, scope === 'mine' && styles.toggleTextActive]}>
            🎯 My Agents
          </Text>
        </Pressable>
      </View>
      <Text style={styles.scopeNote} accessibilityLiveRegion="polite">
        Agent cards: {scope === 'mine' ? 'my agents' : 'all agents'} · 7-day request and member metrics: entire circle
      </Text>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
        {/* All-Time Cumulative Stats */}
        <View style={styles.statsGrid}>
          <StatCard
            icon="◎"
            value={fmtTokens(totalTokensAllTime)}
            label="Total Tokens (All Time)"
            valueColor="#f59e0b"
            sub={`$${totalCostAllTime.toFixed(2)} est. cost`}
          />
          <StatCard
            icon="📨"
            value={fmtTokens(totalMessagesAllTime)}
            label="Total Messages (All Time)"
            valueColor="#8b5cf6"
          />
        </View>

        {/* Today Stats grid */}
        <View style={styles.statsGrid}>
          <StatCard
            icon="⚡"
            value={fmtTokens(totalTokensToday)}
            label="Tokens Today"
            valueColor={tokenColor(totalTokensToday)}
            sub={`$${totalCostToday.toFixed(2)} today`}
          />
          <StatCard
            icon="💬"
            value={String(totalMessagesToday)}
            label="Messages Today"
            valueColor="#e5e5e5"
          />
          <StatCard
            icon="🏆"
            value={mostActive?.name || '—'}
            label="Most Active"
            valueColor="#6366f1"
            sub={mostActive ? `${mostActive.message_count_today ?? 0} msgs` : undefined}
          />
          <StatCard
            icon="⏱️"
            value={fmtLatency(avgLatency)}
            label="Avg Latency"
            valueColor={avgLatency ? latencyColor(avgLatency) : '#6f6f6f'}
          />
          <StatCard
            icon="🟢"
            value={`${onlineCount}/${filtered.length}`}
            label="Agents Online"
            valueColor={onlineCount > 0 ? '#22c55e' : '#6f6f6f'}
          />
          <StatCard
            icon="📈"
            value={fmtUptime(avgUptime)}
            label="Avg Uptime"
            valueColor={avgUptime != null ? uptimeColor(avgUptime) : '#6f6f6f'}
          />
        </View>

        {/* Token Breakdown — Today */}
        {totalTokensToday > 0 && (
          <View style={styles.metricsCard}>
            <Text style={styles.metricsTitle}>AGENT TOKEN BREAKDOWN (TODAY)</Text>
            <View style={styles.percentilesRow}>
              <View style={styles.percentileItem}>
                <Text style={styles.percentileLabel}>INPUT</Text>
                <Text style={[styles.percentileValue, { color: '#3b82f6' }]}>{fmtTokens(inputTokensToday)}</Text>
              </View>
              <View style={styles.percentileItem}>
                <Text style={styles.percentileLabel}>OUTPUT</Text>
                <Text style={[styles.percentileValue, { color: '#a855f7' }]}>{fmtTokens(outputTokensToday)}</Text>
              </View>
              <View style={styles.percentileItem}>
                <Text style={styles.percentileLabel}>CACHED</Text>
                <Text style={[styles.percentileValue, { color: '#22c55e' }]}>{fmtTokens(cachedTokensToday)}</Text>
              </View>
              <View style={styles.percentileItem}>
                <Text style={styles.percentileLabel}>CACHE HIT</Text>
                <Text style={[styles.percentileValue, { color: '#22c55e' }]}>
                  {inputTokensToday > 0 ? `${Math.round((cachedTokensToday / inputTokensToday) * 100)}%` : '—'}
                </Text>
              </View>
            </View>
            {/* Proportional bar */}
            {(inputTokensToday + outputTokensToday) > 0 && (
              <View style={{ flexDirection: 'row', height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 8 }}>
                <View style={{ flex: inputTokensToday - cachedTokensToday, backgroundColor: '#3b82f6' }} />
                <View style={{ flex: cachedTokensToday, backgroundColor: '#22c55e' }} />
                <View style={{ flex: outputTokensToday, backgroundColor: '#a855f7' }} />
              </View>
            )}
          </View>
        )}

        <View
          style={[
            styles.analyticsStatus,
            analyticsError && styles.analyticsStatusError,
            analyticsStale && showAnalyticsSnapshot && styles.analyticsStatusStale,
          ]}
          accessibilityRole={analyticsError ? 'alert' : undefined}
          accessibilityLiveRegion="polite"
        >
          <View style={styles.analyticsStatusCopy}>
            <Text style={styles.analyticsStatusTitle}>{analyticsStatusTitle}</Text>
            <Text style={styles.analyticsStatusDetail}>{analyticsStatusDetail}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={analyticsError ? 'Retry circle analytics' : 'Refresh circle analytics'}
            accessibilityState={{ disabled: analyticsLoading, busy: analyticsLoading }}
            disabled={analyticsLoading}
            onPress={() => { void loadResponseAnalytics(); }}
            onFocus={() => setFocusedControl('refresh')}
            onBlur={() => setFocusedControl(null)}
            style={({ pressed }) => [
              styles.refreshButton,
              analyticsLoading && styles.refreshButtonDisabled,
              focusedControl === 'refresh' && !analyticsLoading && styles.controlFocused,
              pressed && !analyticsLoading && styles.controlPressed,
            ]}
          >
            <Text style={styles.refreshButtonText}>
              {analyticsLoading ? 'Refreshing…' : analyticsError ? 'Retry' : 'Refresh'}
            </Text>
          </Pressable>
        </View>

        {/* Latency Percentiles */}
        {latencyPercentiles.count > 0 && (
          <View style={styles.metricsCard}>
            <Text style={styles.metricsTitle}>CIRCLE LATENCY PERCENTILES (7D)</Text>
            <View style={styles.percentilesRow}>
              <View style={styles.percentileItem}>
                <Text style={styles.percentileLabel}>P50</Text>
                <Text style={[styles.percentileValue, { color: latencyColor(latencyPercentiles.p50) }]}>
                  {fmtLatency(latencyPercentiles.p50)}
                </Text>
              </View>
              <View style={styles.percentileDivider} />
              <View style={styles.percentileItem}>
                <Text style={styles.percentileLabel}>P95</Text>
                <Text style={[styles.percentileValue, { color: latencyColor(latencyPercentiles.p95) }]}>
                  {fmtLatency(latencyPercentiles.p95)}
                </Text>
              </View>
              <View style={styles.percentileDivider} />
              <View style={styles.percentileItem}>
                <Text style={styles.percentileLabel}>P99</Text>
                <Text style={[styles.percentileValue, { color: latencyColor(latencyPercentiles.p99) }]}>
                  {fmtLatency(latencyPercentiles.p99)}
                </Text>
              </View>
            </View>
            <Text style={styles.percentileSub}>{latencyPercentiles.count} requests sampled</Text>
          </View>
        )}

        {/* Success / Error Rate */}
        {errorRateData.total > 0 && (
          <View style={styles.metricsCard}>
            <Text style={styles.metricsTitle}>CIRCLE SUCCESS RATE (7D)</Text>
            <View style={styles.errorRateRow}>
              <View style={styles.errorRateMain}>
                <Text style={[styles.errorRateValue, {
                  color: errorRateData.rate > 10 ? '#ef4444' : errorRateData.rate > 5 ? '#f59e0b' : '#22c55e',
                }]}>
                  {(100 - errorRateData.rate).toFixed(1)}%
                </Text>
                <Text style={styles.errorRateSub}>
                  {errorRateData.total - errorRateData.errors} OK / {errorRateData.errors} errors
                </Text>
              </View>
              {/* Success bar */}
              <View style={styles.successBar}>
                <View style={[styles.successBarFill, {
                  width: `${100 - errorRateData.rate}%`,
                  backgroundColor: errorRateData.rate > 10 ? '#ef4444' : '#22c55e',
                }]} />
              </View>
            </View>
            {/* Recent errors */}
            {errorRateData.recentErrors.length > 0 && (
              <View style={styles.recentErrors}>
                <Text style={styles.recentErrorsTitle}>Recent Errors</Text>
                {errorRateData.recentErrors.map((e, i) => (
                  <View key={i} style={styles.errorItem}>
                    <Text style={styles.errorAgent}>{e.agent}</Text>
                    <Text style={styles.errorMsg} numberOfLines={1}>{e.error}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Usage by Member */}
        {userUsage.length > 0 && (
          <View style={styles.agentList}>
            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>Circle usage by member (7d)</Text>
              <Text style={styles.listSub}>{userUsage.length} active users</Text>
            </View>
            {userUsage.map((u, i) => (
              <View key={i} style={rowStyles.row}>
                <View style={[rowStyles.dot, { backgroundColor: '#e8e8e8' }]} />
                <View style={rowStyles.info}>
                  <Text style={rowStyles.name}>{u.name}</Text>
                  <Text style={rowStyles.owner}>{u.model}</Text>
                </View>
                <Text style={[rowStyles.tokens, { color: tokenColor(u.tokens) }]}>
                  {fmtTokens(u.tokens)}
                </Text>
                <Text style={rowStyles.msgs}>{u.commands} cmds</Text>
              </View>
            ))}
          </View>
        )}

        {/* Per-agent breakdown */}
        {sortedAgents.length > 0 && (
          <View style={styles.agentList}>
            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>Agent Breakdown</Text>
              <Text style={styles.listSub}>Sorted by total usage</Text>
            </View>
            {sortedAgents.map(agent => (
              <AgentRow key={agent.id} agent={agent} />
            ))}
          </View>
        )}

        {filtered.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>{scope === 'mine' ? '🎯' : '🌐'}</Text>
            <Text style={styles.emptyTitle}>
              {scope === 'mine' ? 'No agents connected yet' : 'No agents in this circle'}
            </Text>
            <Text style={styles.emptyText}>
              {scope === 'mine'
                ? 'Connect your agent in the Office tab to see your stats'
                : 'Circle members need to publish their agents to the office'}
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  toggleRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  toggleBtn: {
    flex: 1,
    minHeight: 44,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  toggleBtnActive: {
    backgroundColor: '#6366f115',
    borderColor: '#6366f1',
  },
  toggleText: {
    color: '#6f6f6f',
    fontSize: 13,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#e8e8e8',
  },
  scopeNote: {
    color: '#8b8b8b',
    fontSize: 10,
    lineHeight: 15,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  controlFocused: {
    borderColor: '#a5b4fc',
  },
  controlPressed: {
    opacity: 0.72,
  },
  scroll: {
    padding: 12,
    gap: 12,
    paddingBottom: 32,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  agentList: {
    backgroundColor: '#161616',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1a1a1a',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#000000',
  },
  listTitle: {
    color: '#e8e8e8',
    fontSize: 13,
    fontWeight: '700',
  },
  listSub: {
    color: '#6f6f6f',
    fontSize: 10,
  },
  // Latency Percentiles & Error Rate
  metricsCard: {
    backgroundColor: '#161616',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1a1a1a',
    padding: 14,
  },
  analyticsStatus: {
    minHeight: 64,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111827',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#243047',
    padding: 12,
  },
  analyticsStatusError: {
    backgroundColor: '#1c1012',
    borderColor: '#7f1d1d',
  },
  analyticsStatusStale: {
    backgroundColor: '#1c170d',
    borderColor: '#78350f',
  },
  analyticsStatusCopy: {
    flex: 1,
    minWidth: 190,
  },
  analyticsStatusTitle: {
    color: '#f3f4f6',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 3,
  },
  analyticsStatusDetail: {
    color: '#a3a3a3',
    fontSize: 10,
    lineHeight: 15,
  },
  refreshButton: {
    minWidth: 88,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#4f46e5',
    backgroundColor: '#312e81',
    paddingHorizontal: 14,
  },
  refreshButtonDisabled: {
    opacity: 0.55,
  },
  refreshButtonText: {
    color: '#eef2ff',
    fontSize: 11,
    fontWeight: '700',
  },
  metricsTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9e9e9e',
    letterSpacing: 1.5,
    marginBottom: 12,
  },
  percentilesRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  percentileItem: {
    alignItems: 'center',
    flex: 1,
  },
  percentileLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#6f6f6f',
    letterSpacing: 1,
    marginBottom: 4,
  },
  percentileValue: {
    fontSize: 20,
    fontWeight: '800',
  },
  percentileDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#2a2a2a',
  },
  percentileSub: {
    fontSize: 10,
    color: '#6f6f6f',
    textAlign: 'center',
    marginTop: 8,
  },
  errorRateRow: {
    marginBottom: 8,
  },
  errorRateMain: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 8,
  },
  errorRateValue: {
    fontSize: 28,
    fontWeight: '800',
  },
  errorRateSub: {
    fontSize: 11,
    color: '#9e9e9e',
  },
  successBar: {
    height: 6,
    backgroundColor: '#2a2a2a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  successBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  recentErrors: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    paddingTop: 8,
  },
  recentErrorsTitle: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9e9e9e',
    letterSpacing: 1,
    marginBottom: 6,
  },
  errorItem: {
    flexDirection: 'row',
    paddingVertical: 4,
    gap: 8,
  },
  errorAgent: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ef4444',
    minWidth: 70,
  },
  errorMsg: {
    fontSize: 11,
    color: '#ef4444',
    flex: 1,
  },

  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyTitle: {
    color: '#e8e8e8',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyText: {
    color: '#6f6f6f',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
