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

// ─── Stat Card ────────────────────────────────────────────────────────────────

interface StatCardProps {
  icon: string;
  value: string;
  label: string;
  valueColor?: string;
  sub?: string;
}

function StatCard({ icon, value, label, valueColor = '#e5e5e5', sub }: StatCardProps) {
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
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  icon: { fontSize: 20, marginBottom: 6 },
  value: {
    fontSize: 22,
    fontWeight: '800',
    marginBottom: 2,
    letterSpacing: -0.5,
  },
  label: { color: '#52525b', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  sub: { color: '#6366f1', fontSize: 10, marginTop: 2 },
});

// ─── Agent Row (mini list) ────────────────────────────────────────────────────

function AgentRow({ agent }: { agent: CircleOfficeAgent }) {
  const statusColors: Record<string, string> = {
    idle: '#22c55e', building: '#f59e0b', offline: '#52525b', error: '#ef4444',
  };
  const color = statusColors[agent.status] || '#52525b';
  return (
    <View style={rowStyles.row}>
      <View style={[rowStyles.dot, { backgroundColor: color }]} />
      <View style={rowStyles.info}>
        <Text style={rowStyles.name} numberOfLines={1}>{agent.name}</Text>
        <Text style={rowStyles.owner} numberOfLines={1}>{agent.ownerDisplayName}</Text>
      </View>
      <Text style={[rowStyles.tokens, { color: tokenColor(agent.token_usage_today ?? 0) }]}>
        {fmtTokens(agent.token_usage_today ?? 0)}
      </Text>
      <Text style={rowStyles.msgs}>{agent.message_count_today ?? 0} msgs</Text>
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
    borderBottomColor: '#1a1a1a',
    gap: 10,
  },
  dot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  info: { flex: 1 },
  name: { color: '#e5e5e5', fontSize: 12, fontWeight: '600' },
  owner: { color: '#52525b', fontSize: 10 },
  tokens: { fontSize: 12, fontWeight: '700', minWidth: 50, textAlign: 'right' },
  msgs: { color: '#52525b', fontSize: 10, minWidth: 45, textAlign: 'right' },
});

// ─── Main Component ───────────────────────────────────────────────────────────

type Scope = 'all' | 'mine';

export default function OfficeAnalyticsPanel({ circleId, userId, agents: propAgents }: Props) {
  const [scope, setScope] = useState<Scope>('all');
  const [agents, setAgents] = useState<CircleOfficeAgent[]>(propAgents);

  // Keep local state in sync with prop changes (parent's realtime updates)
  useEffect(() => {
    setAgents(propAgents);
  }, [propAgents]);

  // Additional realtime subscription for analytics-specific fields
  useEffect(() => {
    const channel = supabase
      .channel(`analytics-${circleId}`)
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
              }
            : a
        ));
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [circleId]);

  // Filter by scope
  const filtered = scope === 'mine'
    ? agents.filter(a => a.ownerId === userId)
    : agents;

  // Compute stats
  const totalTokensToday    = filtered.reduce((s, a) => s + (a.token_usage_today   ?? 0), 0);
  const totalMessagesToday  = filtered.reduce((s, a) => s + (a.message_count_today ?? 0), 0);
  const onlineCount         = filtered.filter(a => a.status !== 'offline').length;
  const latencies           = filtered.map(a => a.last_response_ms).filter((v): v is number => v != null);
  const avgLatency          = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null;
  const uptimes             = filtered.map(a => a.uptime_score).filter((v): v is number => v != null);
  const avgUptime           = uptimes.length ? uptimes.reduce((a, b) => a + b, 0) / uptimes.length : null;
  const mostActive          = filtered.reduce<CircleOfficeAgent | null>((best, a) =>
    (a.message_count_today ?? 0) > (best?.message_count_today ?? -1) ? a : best, null);

  // Sort agents by messages desc for the list
  const sortedAgents = [...filtered].sort((a, b) =>
    (b.message_count_today ?? 0) - (a.message_count_today ?? 0)
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
        {/* Stats grid */}
        <View style={styles.statsGrid}>
          <StatCard
            icon="⚡"
            value={fmtTokens(totalTokensToday)}
            label="Tokens Today"
            valueColor={tokenColor(totalTokensToday)}
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
            valueColor={avgLatency ? latencyColor(avgLatency) : '#52525b'}
          />
          <StatCard
            icon="🟢"
            value={`${onlineCount}/${filtered.length}`}
            label="Agents Online"
            valueColor={onlineCount > 0 ? '#22c55e' : '#52525b'}
          />
          <StatCard
            icon="📈"
            value={fmtUptime(avgUptime)}
            label="Avg Uptime"
            valueColor={avgUptime != null ? uptimeColor(avgUptime) : '#52525b'}
          />
        </View>

        {/* Per-agent breakdown */}
        {sortedAgents.length > 0 && (
          <View style={styles.agentList}>
            <View style={styles.listHeader}>
              <Text style={styles.listTitle}>Agent Breakdown</Text>
              <Text style={styles.listSub}>Sorted by activity today</Text>
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
    backgroundColor: '#0d0d0d',
  },
  toggleRow: {
    flexDirection: 'row',
    padding: 12,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  toggleBtn: {
    flex: 1,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  toggleBtnActive: {
    backgroundColor: '#6366f115',
    borderColor: '#6366f1',
  },
  toggleText: {
    color: '#71717a',
    fontSize: 13,
    fontWeight: '600',
  },
  toggleTextActive: {
    color: '#6366f1',
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
    backgroundColor: '#111',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1f1f1f',
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  listTitle: {
    color: '#e5e5e5',
    fontSize: 13,
    fontWeight: '700',
  },
  listSub: {
    color: '#52525b',
    fontSize: 10,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyTitle: {
    color: '#e5e5e5',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 6,
    textAlign: 'center',
  },
  emptyText: {
    color: '#52525b',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },
});
