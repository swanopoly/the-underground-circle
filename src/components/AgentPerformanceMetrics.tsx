// Agent Performance Metrics - directional leaderboard and telemetry analysis
import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { OfficeAgent } from '../lib/officeAgents';
import { OpenSwanSession } from '../lib/openswanService';

interface Props {
  agents: OfficeAgent[];
  sessions: OpenSwanSession[];
  accentColor?: string;
}

interface AgentMetrics {
  agentId: string;
  name: string;
  color: string;
  responseCount: number;
  totalCost: number;
  avgCostPerResponse: number;
  totalTokens: number;
  avgTokensPerResponse: number;
  recordedTurns: number;
  statusScore: number;
  efficiency: number; // tokens per dollar
  hasErrorSignal: boolean;
  model: string;
  lastActive: string;
  status: 'active' | 'idle' | 'error' | 'offline' | 'building';
}

type SortBy = 'responses' | 'cost' | 'efficiency' | 'status' | 'turns';

const SORT_LABELS: Record<SortBy, string> = {
  responses: 'responses',
  cost: 'cost',
  efficiency: 'efficiency',
  status: 'current status',
  turns: 'recorded turns',
};

function PerformanceProvenanceNotice() {
  return (
    <View
      testID="agent-performance-estimate-notice"
      accessible
      accessibilityLabel="Directional estimates. Rankings, status availability, efficiency, and insights are derived from current agent status, response receipts, and aggregate turn telemetry. They are not measured service level agreement results or evaluation receipts."
      style={styles.provenanceNotice}
    >
      <Text accessibilityRole="header" style={styles.provenanceTitle}>DIRECTIONAL ESTIMATES</Text>
      <Text style={styles.provenanceText}>
        Rankings, status availability, efficiency, and insights use current status, response receipts, and aggregate turn telemetry—not measured SLA results or eval receipts.
      </Text>
    </View>
  );
}

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
        case 'responses':
          aVal = a.responseCount;
          bVal = b.responseCount;
          break;
        case 'cost':
          aVal = a.totalCost;
          bVal = b.totalCost;
          break;
        case 'efficiency':
          aVal = a.efficiency;
          bVal = b.efficiency;
          break;
        case 'status':
          aVal = a.statusScore;
          bVal = b.statusScore;
          break;
        case 'turns':
          aVal = a.recordedTurns;
          bVal = b.recordedTurns;
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
        <PerformanceProvenanceNotice />
        <Text style={styles.emptyIcon}>📊</Text>
        <Text style={styles.emptyTitle}>No Agents Connected</Text>
        <Text style={styles.emptyText}>
          Connect agents to see directional performance metrics and telemetry comparisons.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <PerformanceProvenanceNotice />
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
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
            <Text style={styles.topPerformerLabel}>LEADING {SORT_LABELS[sortBy].toUpperCase()}</Text>
            <Text style={[styles.topPerformerName, { color: topPerformer.color }]}>
              {topPerformer.name}
            </Text>
            <Text style={styles.topPerformerStats}>
              {topPerformer.responseCount} responses · ${topPerformer.totalCost.toFixed(2)} ·{' '}
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
            label="Responses"
            active={sortBy === 'responses'}
            onPress={() => handleSort('responses')}
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
            label="Current status"
            active={sortBy === 'status'}
            onPress={() => handleSort('status')}
            accentColor={accentColor}
          />
          <SortButton
            label="Recorded turns"
            active={sortBy === 'turns'}
            onPress={() => handleSort('turns')}
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
    </View>
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
        accessibilityRole="button"
        accessibilityLabel={`${metric.name}, list position ${rank}`}
        accessibilityHint={isExpanded ? 'Collapses telemetry details' : 'Expands telemetry details'}
        accessibilityState={{ expanded: isExpanded }}
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
            <Text style={styles.statLabel}>Responses</Text>
            <Text style={[styles.statValue, { color: accentColor }]}>{metric.responseCount}</Text>
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
            <Text style={styles.statLabel}>Status</Text>
            <Text style={[styles.statValue, { color: statusColor }]}>{metric.status.toUpperCase()}</Text>
          </View>
        </View>

        <Text style={styles.expandIcon}>{isExpanded ? '▼' : '▶'}</Text>
      </Pressable>

      {/* Expanded Details */}
      {isExpanded && (
        <View style={styles.metricDetails}>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Avg Cost/Response:</Text>
            <Text style={styles.detailValue}>
              {metric.responseCount > 0 ? `$${metric.avgCostPerResponse.toFixed(4)}` : '—'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Total Tokens:</Text>
            <Text style={styles.detailValue}>{(metric.totalTokens / 1000).toFixed(1)}K</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Avg Tokens/Response:</Text>
            <Text style={styles.detailValue}>
              {metric.responseCount > 0 ? metric.avgTokensPerResponse.toFixed(0) : '—'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Recorded Turns:</Text>
            <Text style={styles.detailValue}>{metric.recordedTurns}</Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Current Error Signal:</Text>
            <Text style={[styles.detailValue, { color: metric.hasErrorSignal ? '#ef4444' : '#22c55e' }]}>
              {metric.hasErrorSignal ? 'Detected' : 'None'}
            </Text>
          </View>
          <View style={styles.detailRow}>
            <Text style={styles.detailLabel}>Last Active:</Text>
            <Text style={styles.detailValue}>{metric.lastActive}</Text>
          </View>

          {/* Performance Insights */}
          <View style={styles.insights}>
            <Text style={styles.insightsTitle}>💡 DIRECTIONAL INSIGHTS</Text>
            {metric.efficiency > 50 && (
              <Text style={styles.insightText}>High token volume per estimated dollar in current receipts</Text>
            )}
            {metric.avgCostPerResponse > 0.50 && (
              <Text style={[styles.insightText, { color: '#f59e0b' }]}>
                ⚠️ High cost per response - review model and workload fit
              </Text>
            )}
            {metric.hasErrorSignal && (
              <Text style={[styles.insightText, { color: '#ef4444' }]}>Current agent status reports an error</Text>
            )}
            {metric.recordedTurns > 100 && (
              <Text style={styles.insightText}>🏆 High recorded turn volume</Text>
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
      accessibilityRole="button"
      accessibilityLabel={`Sort by ${label}`}
      accessibilityState={{ selected: active }}
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

function calculateAgentMetrics(agents: OfficeAgent[], sessions: OpenSwanSession[]): AgentMetrics[] {
  return agents.map(agent => {
    // Backpack supplies one OpenSwanSession-shaped row per recorded response.
    const agentResponses = sessions.filter(s => s.agentId === agent.id || s.agentId === agent.name);

    const responseCount = agentResponses.length;
    const responseCost = agentResponses.reduce((sum, s) => sum + (s.totalCost || 0), 0);
    const responseTokens = agentResponses.reduce((sum, s) => sum + (s.totalInputTokens || 0) + (s.totalOutputTokens || 0), 0);
    const totalCost = responseCount > 0 ? responseCost : agent.costToday || 0;
    const totalTokens = responseCount > 0 ? responseTokens : agent.tokensUsed || 0;
    const avgCostPerResponse = responseCount > 0 ? totalCost / responseCount : 0;
    const avgTokensPerResponse = responseCount > 0 ? totalTokens / responseCount : 0;
    const efficiency = totalCost > 0 ? totalTokens / totalCost / 1000 : 0; // tokens per dollar (in thousands)
    const statusScore = agent.status === 'active' ? 4 : agent.status === 'building' ? 3 : agent.status === 'idle' ? 2 : agent.status === 'error' ? 1 : 0;

    return {
      agentId: agent.id,
      name: agent.name,
      color: agent.color,
      responseCount,
      totalCost,
      avgCostPerResponse,
      totalTokens,
      avgTokensPerResponse,
      recordedTurns: agent.messagesProcessed,
      statusScore,
      efficiency,
      hasErrorSignal: agent.status === 'error',
      model: agent.model,
      lastActive: agent.lastActive,
      status: agent.status,
    };
  });
}

// ─── Styles ────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000000',
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  provenanceNotice: {
    alignSelf: 'stretch',
    backgroundColor: '#0d0d14',
    borderWidth: 1,
    borderColor: '#f59e0b55',
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
  },
  provenanceTitle: {
    color: '#f59e0b',
    fontSize: 9,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  provenanceText: {
    color: '#b0b0b0',
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 15,
    marginTop: 3,
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
