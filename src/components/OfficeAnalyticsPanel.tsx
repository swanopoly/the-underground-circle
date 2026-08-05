/**
 * OfficeAnalyticsPanel.tsx — Real-time Circle Office analytics
 *
 * Toggle: "🌐 All Agents" vs "🎯 My Agents"
 * Stats: tokens, messages, latency, uptime, most active agent
 * Live via Supabase Realtime subscription on circle_office_agents
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Platform,
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

interface UserUsage { name: string; commands: number; tokens: number; cost: number; model: string; lastActive: string }

type Scope = 'all' | 'mine';

export default function OfficeAnalyticsPanel({ circleId, userId, agents: propAgents }: Props) {
  const [scope, setScope] = useState<Scope>('all');
  const [agents, setAgents] = useState<CircleOfficeAgent[]>(propAgents);
  const [latencyPercentiles, setLatencyPercentiles] = useState<LatencyPercentiles>({ p50: 0, p95: 0, p99: 0, count: 0 });
  const [errorRateData, setErrorRateData] = useState<ErrorRateData>({ total: 0, errors: 0, rate: 0, recentErrors: [] });
  const [userUsage, setUserUsage] = useState<UserUsage[]>([]);

  // Keep local state in sync with prop changes (parent's realtime updates)
  useEffect(() => {
    setAgents(propAgents);
  }, [propAgents]);

  // Additional realtime subscription for analytics-specific fields
  useEffect(() => {
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

    return () => { handle.unsubscribe(); };
  }, [circleId]);

  // Load latency percentiles and error rates from terminal responses
  const loadResponseAnalytics = useCallback(async () => {
    if (!circleId) return;
    try {
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();

    const { data: responses } = await supabase
      .from('office_terminal_responses')
      .select('latency_ms, status, agent_name, error_message, created_at')
      .eq('circle_id', circleId)
      .gte('created_at', weekAgo);

    if (!responses) return;

    // Latency percentiles (from successful responses)
    const latencies = responses
      .filter(r => r.status === 'done' && r.latency_ms != null)
      .map(r => r.latency_ms as number);
    setLatencyPercentiles(computePercentiles(latencies));

    // Error rates
    const total = responses.length;
    const errors = responses.filter(r => r.status === 'error').length;
    const recentErrors = responses
      .filter(r => r.status === 'error')
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map(r => ({
        agent: r.agent_name || 'Unknown',
        error: r.error_message || 'Unknown error',
        time: r.created_at,
      }));
    setErrorRateData({ total, errors, rate: total > 0 ? (errors / total) * 100 : 0, recentErrors });

    // User-level usage: group messages by sender
    const { data: messages } = await supabase
      .from('office_terminal_messages')
      .select('id, sender_id, model, created_at')
      .eq('circle_id', circleId)
      .gte('created_at', weekAgo);

    if (messages && messages.length > 0) {
      // Group by sender
      const senderIds = [...new Set(messages.map(m => m.sender_id).filter(Boolean))];
      const { data: profiles } = senderIds.length > 0
        ? await supabase.from('profiles').select('id, display_name, username').in('id', senderIds)
        : { data: [] };
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      // Map messages to responses for token data
      const msgIds = messages.map(m => m.id);
      const { data: respData } = await supabase
        .from('office_terminal_responses')
        .select('message_id, token_count, model')
        .in('message_id', msgIds);

      const respByMsg = new Map<string, { tokens: number; model: string }>();
      for (const r of (respData || [])) {
        const existing = respByMsg.get(r.message_id);
        respByMsg.set(r.message_id, {
          tokens: (existing?.tokens || 0) + (r.token_count || 0),
          model: r.model || existing?.model || 'unknown',
        });
      }

      const byUser = new Map<string, { commands: number; tokens: number; models: Record<string, number>; lastActive: string }>();
      for (const m of messages) {
        const sid = m.sender_id || 'unknown';
        const entry = byUser.get(sid) || { commands: 0, tokens: 0, models: {}, lastActive: '' };
        entry.commands++;
        const resp = respByMsg.get(m.id);
        entry.tokens += resp?.tokens || 0;
        const model = resp?.model || m.model || 'unknown';
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
          cost: data.tokens * 0.0000005,
          model: topModel
            .replace('claude-haiku-4-5-20251001', 'Haiku')
            .replace('claude-sonnet-4-6', 'Sonnet')
            .replace('claude-opus-4-6', 'Opus')
            .replace('blackswan', 'BlackSwan'),
          lastActive: data.lastActive,
        });
      }
      setUserUsage(usage.sort((a, b) => b.tokens - a.tokens));
    }
    } catch (err) {
      console.error('[OfficeAnalytics] Failed to load response analytics:', err);
    }
  }, [circleId]);

  useEffect(() => { loadResponseAnalytics(); }, [loadResponseAnalytics]);

  // Filter by scope
  const filtered = scope === 'mine'
    ? agents.filter(a => a.ownerId === userId)
    : agents;

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

  return (
    <View style={styles.container}>
      {/* Scope toggle */}
      <View style={styles.toggleRow}>
        <Pressable
          style={[styles.toggleBtn, scope === 'all' && styles.toggleBtnActive]}
          onPress={() => setScope('all')}
        >
          <Text style={[styles.toggleText, scope === 'all' && styles.toggleTextActive]}>
            🌐 All Agents
          </Text>
        </Pressable>
        <Pressable
          style={[styles.toggleBtn, scope === 'mine' && styles.toggleBtnActive]}
          onPress={() => setScope('mine')}
        >
          <Text style={[styles.toggleText, scope === 'mine' && styles.toggleTextActive]}>
            🎯 My Agents
          </Text>
        </Pressable>
      </View>

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
            <Text style={styles.metricsTitle}>TOKEN BREAKDOWN (TODAY)</Text>
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

        {/* Latency Percentiles */}
        {latencyPercentiles.count > 0 && (
          <View style={styles.metricsCard}>
            <Text style={styles.metricsTitle}>LATENCY PERCENTILES (7D)</Text>
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
            <Text style={styles.metricsTitle}>SUCCESS RATE (7D)</Text>
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
              <Text style={styles.listTitle}>Usage by Member (7d)</Text>
              <Text style={styles.listSub}>{userUsage.length} active users</Text>
            </View>
            {userUsage.map((u, i) => (
              <View key={i} style={rowStyles.row}>
                <View style={[rowStyles.dot, { backgroundColor: '#e8e8e8' }]} />
                <View style={rowStyles.info}>
                  <Text style={rowStyles.name}>{u.name}</Text>
                  <Text style={rowStyles.owner}>{u.commands} cmds / {u.model}</Text>
                </View>
                <Text style={[rowStyles.tokens, { color: tokenColor(u.tokens) }]}>
                  {fmtTokens(u.tokens)}
                </Text>
                <Text style={rowStyles.msgs}>${u.cost.toFixed(3)}</Text>
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
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
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
