// Agent Performance Metrics - Leaderboard & ROI Analysis
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { OfficeAgent } from '../lib/officeAgents';
import { OpenClawSession } from '../lib/openclawService';

interface Props {
  agents: OfficeAgent[];
  sessions: OpenClawSession[];
  accentColor?: string;
}

interface AgentMetrics {
  agentId: string;
  name: string;
  color: string;
  sessionCount: number;
  totalCost: number;
  avgCostPerSession: number;
  totalTokens: number;
  avgTokensPerSession: number;
  messagesProcessed: number;
  uptimePercent: number;
  efficiency: number; // tokens per dollar
  errorCount: number;
  model: string;
  lastActive: string;
  status: 'active' | 'idle' | 'error' | 'offline' | 'building';
}

type SortBy = 'sessions' | 'cost' | 'efficiency' | 'uptime' | 'messages';

export default function AgentPerformanceMetrics({ agents, sessions, accentColor = '#6366f1' }: Props) {
  const [sortBy, setSortBy] = useState<SortBy>('cost');
  const [sortDesc, setSortDesc] = useState(true);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const metrics = useMemo(() => {
    return calculateAgentMetrics(agents, sessions);
  }, [agents, sessions]);

  const sortedMetrics = useMemo(() => {
    const sorted = [...metrics].sort((a, b) => {
      let aVal: number;
      let bVal: number;

      switch (sortBy) {
        case 'sessions':
          aVal = a.sessionCount;
          bVal = b.sessionCount;
          break;
        case 'cost':
          aVal = a.totalCost;
          bVal = b.totalCost;
          break;
        case 'efficiency':
          aVal = a.efficiency;
          bVal = b.efficiency;
          break;
        case 'uptime':
          aVal = a.uptimePercent;
          bVal = b.uptimePercent;
          break;
        case 'messages':
          aVal = a.messagesProcessed;
          bVal = b.messagesProcessed;
          break;
        default:
          return 0;
      }

      return sortDesc ? bVal - aVal : aVal - bVal;
    });

    return sorted;
  }, [metrics, sortBy, sortDesc]);

  const handleSort = (newSort: SortBy) => {
    if (sortBy === newSort) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(newSort);
      setSortDesc(true);
    }
  };

  const topPerformer = sortedMetrics[0];
  const totalCost = metrics.reduce((sum, m) => sum + m.totalCost, 0);
  const avgEfficiency = metrics.reduce((sum, m) => sum + m.efficiency, 0) / metrics.length || 0;

  if (agents.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyTitle}>No Agents Connected</Text>
        <Text style={styles.emptyText}>
          Connect agents to see performance metrics, leaderboards, and ROI analysis.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      {/* Summary Cards */}
      <View style={styles.summaryRow}>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>TOTAL AGENTS</Text>
          <Text style={[styles.summaryValue, { color: accentColor }]}>{agents.length}</Text>
          <Text style={styles.summarySubtext}>
            {agents.filter(a => a.status === 'active').length} active
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>TOTAL COST</Text>
          <Text style={[styles.summaryValue, { color: accentColor }]}>${totalCost.toFixed(2)}</Text>
          <Text style={styles.summarySubtext}>
            Avg ${(totalCost / agents.length).toFixed(2)}/agent
          </Text>
        </View>

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>AVG EFFICIENCY</Text>
          <Text style={[styles.summaryValue, { color: accentColor }]}>
            {avgEfficiency.toFixed(0)}K
          </Text>
          <Text style={styles.summarySubtext}>tokens per dollar</Text>
        </View>
      </View>

      {/* Top Performer Banner */}
      {topPerformer && (
        <View style={[styles.topPerformerBanner, { borderColor: accentColor }]}>
          <Text style={styles.trophyIcon}>🏆</Text>
          <View style={styles.topPerformerInfo}>
            <Text style={styles.topPerformerLabel}>TOP PERFORMER</Text>
            <Text style={[styles.topPerformerName, { color: topPerformer.color }]}>
              {topPerformer.name}
            </Text>
            <Text style={styles.topPerformerStats}>
              {topPerformer.sessionCount} sessions · ${topPerformer.totalCost.toFixed(2)} · 
              {topPerformer.efficiency.toFixed(0)}K tokens/$
            </Text>
          </View>
        </View>
      )}

      {/* Sort Controls */}
      <View style={styles.sortControls}>
        <Text style={styles.sortLabel}>SORT BY:</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sortButtons}>
          <SortButton
            label="Sessions"
            active={sortBy === 'sessions'}
            onPress={() => handleSort('sessions')}
            accentColor={accentColor}
          />
          <SortButton
            label="Cost"
            active={sortBy === 'cost'}
            onPress={() => handleSort('cost')}
            accentColor={accentColor}
          />
          <SortButton
            label="Efficiency"
            active={sortBy === 'efficiency'}
            onPress={() => handleSort('efficiency')}
            accentColor={accentColor}
          />
          <SortButton
            label="Uptime"
            active={sortBy === 'uptime'}
            onPress={() => handleSort('uptime')}
            accentColor={accentColor}
          />
          <SortButton
            label="Messages"
            active={sortBy === 'messages'}
            onPress={() => handleSort('messages')}
            accentColor={accentColor}
          />
        </ScrollView>
      </View>

      {/* Leaderboard */}
      <View style={styles.leaderboard}>
        {sortedMetrics.map((metric, index) => (
          <AgentMetricRow
            key={metric.agentId}
            metric={metric}
            rank={index + 1}
            isExpanded={selectedAgent === metric.agentId}
            onPress={() => setSelectedAgent(selectedAgent === metric.agentId ? null : metric.agentId)}
            accentColor={accentColor}
          />
        ))}
      </View>
    </ScrollView>
  );
}

// ─── Agent Metric Row ──────────────────────────────────────

function AgentMetricRow({ metric, rank, isExpanded, onPress, accentColor }: {
  metric: AgentMetrics;
  rank: number;
  isExpanded: boolean;
  onPress: () => void;
  accentColor: string;
}) {
  const rankEmoji = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}.`;
  const statusColor = metric.status === 'active' ? '#22c55e' : metric.status === 'idle' ? '#eab308' : metric.status === 'error' ? '#ef4444' : '#6b7280';

  return (
    <View style={styles.metricRow}>
      <Pressable
        onPress={onPress}
        style={[
          styles.metricHeader,
          isExpanded && styles.metricHeaderExpanded,
          Platform.OS === 'web' && { cursor: 'pointer' } as any,
        ]}
      >
        <View style={styles.metricLeft}>
          <Text style={styles.rankText}>{rankEmoji}</Text>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <View style={styles.metricNameContainer}>
            <Text style={[styles.metricName, { color: metric.color }]}>{metric.name}</Text>
            <Text style={styles.metricModel}>{metric.model}</Text>
          </View>
        </View>

        <View style={styles.metricStats}>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Sessions</Text>
            <Text style={[styles.statValue, { color: accentColor }]}>{metric.sessionCount}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Cost</Text>
            <Text style={[styles.statValue, { color: accentColor }]}>${metric.totalCost.toFixed(2)}</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Efficiency</Text>
            <Text style={[styles.statValue, { color: accentColor }]}>{metric.efficiency.toFixed(0)}K</Text>
          </View>
          <View style={styles.statItem}>
            <Text style={styles.statLabel}>Uptime</Text>
            <Text style={[styles.statValue, { color: accentColor }]}>{metric.uptimePercent}%</Text>
          </View>
        </View>

        <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
      </Pressable>

      {/* Expanded Details */}
      {isExpanded && (
        <View style={styles.metricDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Avg Cost/Session:</Text>
            <Text style={styles.detailValue}>${metric.avgCostPerSession.toFixed(4)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Total Tokens:</Text>
            <Text style={styles.detailValue}>{(metric.totalTokens / 1000).toFixed(1)}K</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Avg Tokens/Session:</Text>
            <Text style={styles.detailValue}>{metric.avgTokensPerSession.toFixed(0)}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Messages Processed:</Text>
            <Text style={styles.detailValue}>{metric.messagesProcessed}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Errors:</Text>
            <Text style={[styles.detailValue, { color: metric.errorCount > 0 ? '#ef4444' : '#22c55e' }]}>
              {metric.errorCount}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Last Active:</Text>
            <Text style={styles.detailValue}>{metric.lastActive}</Text>
          </View>

          {/* Performance Insights */}
          <View style={styles.insights}>
            <Text style={styles.insightsTitle}>💡 INSIGHTS</Text>
            {metric.efficiency > 50000 && (
              <Text style={styles.insightText}>✨ Excellent efficiency - keeping costs low!</Text>
            )}
            {metric.avgCostPerSession > 0.50 && (
              <Text style={[styles.insightText, { color: '#f59e0b' }]}>
                ⚠️ High cost per session - consider switching model
              </Text>
            )}
            {metric.errorCount > 5 && (
              <Text style={[styles.insightText, { color: '#ef4444' }]}>
                🔴 Multiple errors detected - needs attention
              </Text>
            )}
            {metric.messagesProcessed > 100 && (
              <Text style={styles.insightText}>🏆 High activity - productive agent!</Text>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

// ─── Sort Button ───────────────────────────────────────────

function SortButton({ label, active, onPress, accentColor }: {
  label: string;
  active: boolean;
  onPress: () => void;
  accentColor: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.sortBtn,
        active && [styles.sortBtnActive, { borderColor: accentColor, backgroundColor: accentColor + '15' }],
        Platform.OS === 'web' && { cursor: 'pointer' } as any,
      ]}
    >
      <Text style={[styles.sortBtnText, active && { color: accentColor }]}>{label}</Text>
    </Pressable>
  );
}

// ─── Calculate Metrics ─────────────────────────────────────

function calculateAgentMetrics(agents: OfficeAgent[], sessions: OpenClawSession[]): AgentMetrics[] {
  return agents.map(agent => {
    // Find all sessions for this agent (sessions are per-response, keyed by agentId)
    const agentSessions = sessions.filter(s => s.agentId === agent.id || s.agentId === agent.name);

    const sessionCount = agentSessions.length || 1;
    const totalCost = agentSessions.reduce((sum, s) => sum + (s.totalCost || 0), 0) || agent.costToday || 0;
    const totalTokens = agentSessions.reduce((sum, s) => sum + (s.totalInputTokens || 0) + (s.totalOutputTokens || 0), 0) || agent.tokensUsed || 0;
    const avgCostPerSession = sessionCount > 0 ? totalCost / sessionCount : totalCost;
    const avgTokensPerSession = sessionCount > 0 ? totalTokens / sessionCount : totalTokens;
    const efficiency = totalCost > 0 ? totalTokens / totalCost / 1000 : 0; // tokens per dollar (in thousands)
    const uptimePercent = agent.status === 'active' ? 99 : agent.status === 'idle' ? 95 : agent.status === 'error' ? 70 : 0;
    const errorCount = agent.status === 'error' ? 1 : 0;

    return {
      agentId: agent.id,
      name: agent.name,
      color: agent.color,
      sessionCount,
      totalCost,
      avgCostPerSession,
      totalTokens,
      avgTokensPerSession,
      messagesProcessed: agent.messagesProcessed,
      uptimePercent,
      efficiency,
      errorCount,
      model: agent.model,
      lastActive: agent.lastActive,
      status: agent.status,
    };
  });
}

// ─── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    padding: 16,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#000000',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#888',
    textAlign: 'center',
    lineHeight: 20,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
  },
  summaryLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 6,
  },
  summaryValue: {
    fontSize: 24,
    fontWeight: '800',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  summarySubtext: {
    fontSize: 11,
    color: '#666',
  },
  topPerformerBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0d0d14',
    borderWidth: 2,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    gap: 12,
  },
  trophyIcon: {
    fontSize: 32,
  },
  topPerformerInfo: {
    flex: 1,
  },
  topPerformerLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#888',
    letterSpacing: 1.5,
    marginBottom: 4,
  },
  topPerformerName: {
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 4,
  },
  topPerformerStats: {
    fontSize: 12,
    color: '#888',
  },
  sortControls: {
    marginBottom: 12,
  },
  sortLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 8,
  },
  sortButtons: {
    flexDirection: 'row',
  },
  sortBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0d0d14',
    marginRight: 8,
  },
  sortBtnActive: {
    borderWidth: 2,
  },
  sortBtnText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#888',
  },
  leaderboard: {
    gap: 8,
  },
  metricRow: {
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    overflow: 'hidden',
  },
  metricHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },
  metricHeaderExpanded: {
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  metricLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  rankText: {
    fontSize: 16,
    fontWeight: '800',
    width: 32,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  metricNameContainer: {
    flex: 1,
  },
  metricName: {
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 2,
  },
  metricModel: {
    fontSize: 10,
    color: '#666',
  },
  metricStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statItem: {
    alignItems: 'center',
  },
  statLabel: {
    fontSize: 9,
    color: '#888',
    marginBottom: 2,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  expandIcon: {
    fontSize: 10,
    color: '#666',
  },
  metricDetails: {
    padding: 14,
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  detailLabel: {
    fontSize: 12,
    color: '#888',
  },
  detailValue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    fontFamily: 'monospace',
  },
  insights: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
    gap: 6,
  },
  insightsTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#888',
    letterSpacing: 1,
    marginBottom: 4,
  },
  insightText: {
    fontSize: 11,
    color: '#22c55e',
    lineHeight: 16,
  },
});
