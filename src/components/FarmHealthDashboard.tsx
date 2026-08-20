// Farm Health Dashboard - directional analytics from current telemetry
import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { OfficeAgent } from '../lib/officeAgents';
import { OpenSwanSession } from '../lib/openswanService';
import {
  calculateFarmMetrics, calculateAgentScore, analyzeWorkloadDistribution,
  generateCostOptimizations, performHealthCheck, AgentPerformanceScore,
  FarmMetrics, AgentWorkload, CostOptimization, HealthCheck,
} from '../lib/agentFarmMetrics';

interface Props {
  agents: OfficeAgent[];
  sessions: OpenSwanSession[];
  accentColor?: string;
}

type TabType = 'overview' | 'performance' | 'workload' | 'optimization' | 'health';

function FarmProvenanceNotice() {
  return (
    <View
      testID="farm-health-estimate-notice"
      accessible
      accessibilityLabel="Directional estimates. Health, score, workload, optimization, and reliability indicators are derived from current agent status and session telemetry. They are not measured service level agreement results or evaluation receipts."
      style={styles.provenanceNotice}
    >
      <Text accessibilityRole="header" style={styles.provenanceTitle}>DIRECTIONAL ESTIMATES</Text>
      <Text style={styles.provenanceText}>
        Health, score, workload, and optimization indicators are derived from current status and session telemetry—not measured SLA results or eval receipts.
      </Text>
    </View>
  );
}

export default function FarmHealthDashboard({ agents, sessions, accentColor = '#e8e8e8' }: Props) {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [farmMetrics, setFarmMetrics] = useState<FarmMetrics | null>(null);
  const [agentScores, setAgentScores] = useState<AgentPerformanceScore[]>([]);
  const [workloads, setWorkloads] = useState<AgentWorkload[]>([]);
  const [optimizations, setOptimizations] = useState<CostOptimization[]>([]);
  const [healthCheck, setHealthCheck] = useState<HealthCheck | null>(null);

  // Recalculate metrics when agents/sessions change
  useEffect(() => {
    if (agents.length === 0) {
      setFarmMetrics(null);
      setAgentScores([]);
      setWorkloads([]);
      setOptimizations([]);
      setHealthCheck(null);
      return;
    }

    const metrics = calculateFarmMetrics(agents, sessions);
    setFarmMetrics(metrics);

    const scores = agents.map(a => calculateAgentScore(a, sessions, agents));
    setAgentScores(scores);

    const loads = analyzeWorkloadDistribution(agents);
    setWorkloads(loads);

    const opts = generateCostOptimizations(agents, sessions);
    setOptimizations(opts);

    const health = performHealthCheck(agents, sessions);
    setHealthCheck(health);
  }, [agents, sessions]);

  const renderOverview = () => {
    if (!farmMetrics) return null;

    const healthColor =
      farmMetrics.healthStatus === 'excellent' ? '#22c55e' :
      farmMetrics.healthStatus === 'good' ? '#3b82f6' :
      farmMetrics.healthStatus === 'fair' ? '#f59e0b' :
      farmMetrics.healthStatus === 'poor' ? '#ef4444' :
      '#6f6f6f';

    return (
      <View style={styles.tabContent}>
        {/* Health Status Banner */}
        <View style={[styles.healthBanner, { backgroundColor: healthColor + '15', borderColor: healthColor + '40' }]}>
          <Text style={[styles.healthIcon, { color: healthColor }]}>
            {farmMetrics.healthStatus === 'excellent' ? '🎯' :
             farmMetrics.healthStatus === 'good' ? '✅' :
             farmMetrics.healthStatus === 'fair' ? '⚠️' :
             farmMetrics.healthStatus === 'poor' ? '🔴' : '🚨'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.healthStatus, { color: healthColor }]}>
              ESTIMATED FARM STATUS: {farmMetrics.healthStatus.toUpperCase()}
            </Text>
            <Text style={styles.healthSubtext}>
              {farmMetrics.activeAgents}/{farmMetrics.totalAgents} agents active · Avg estimate: {farmMetrics.averageScore}
            </Text>
          </View>
        </View>

        {/* Quick Stats Grid */}
        <View style={styles.statsGrid}>
          <View style={[styles.statCard, { borderLeftColor: '#22c55e' }]}>
            <Text style={styles.statValue}>{farmMetrics.activeAgents}</Text>
            <Text style={styles.statLabel}>ACTIVE</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: '#f59e0b' }]}>
            <Text style={styles.statValue}>{farmMetrics.idleAgents}</Text>
            <Text style={styles.statLabel}>IDLE</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: '#ef4444' }]}>
            <Text style={styles.statValue}>{farmMetrics.errorAgents}</Text>
            <Text style={styles.statLabel}>ERRORS</Text>
          </View>
          <View style={[styles.statCard, { borderLeftColor: '#6f6f6f' }]}>
            <Text style={styles.statValue}>{farmMetrics.offlineAgents}</Text>
            <Text style={styles.statLabel}>OFFLINE</Text>
          </View>
        </View>

        {/* Cost Overview */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>💰 COST OVERVIEW</Text>
          <View style={styles.costRow}>
            <Text style={styles.costLabel}>Today:</Text>
            <Text style={[styles.costValue, { color: farmMetrics.totalCostToday > 10 ? '#ef4444' : '#22c55e' }]}>
              ${farmMetrics.totalCostToday.toFixed(2)}
            </Text>
          </View>
          <View style={styles.costRow}>
            <Text style={styles.costLabel}>This Week:</Text>
            <Text style={styles.costValue}>${farmMetrics.totalCostWeek.toFixed(2)}</Text>
          </View>
          <View style={styles.costRow}>
            <Text style={styles.costLabel}>Total Messages:</Text>
            <Text style={styles.costValue}>{farmMetrics.totalMessagesProcessed.toLocaleString()}</Text>
          </View>
          <View style={styles.costRow}>
            <Text style={styles.costLabel}>Total Tokens:</Text>
            <Text style={styles.costValue}>{farmMetrics.totalTokensUsed.toLocaleString()}</Text>
          </View>
        </View>

        {/* Top Performer */}
        {farmMetrics.topPerformer && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>🏆 TOP ESTIMATED PERFORMER</Text>
            <View style={[styles.performerCard, { borderColor: farmMetrics.topPerformer.agent.color + '60' }]}>
              <View style={[styles.performerAvatar, { backgroundColor: farmMetrics.topPerformer.agent.color + '20' }]}>
                <Text style={[styles.performerAvatarText, { color: farmMetrics.topPerformer.agent.color }]}>
                  {farmMetrics.topPerformer.agent.name.charAt(0)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.performerName}>{farmMetrics.topPerformer.agent.name}</Text>
                <Text style={styles.performerRole}>{farmMetrics.topPerformer.agent.role}</Text>
              </View>
              <Text style={styles.performerScore}>{farmMetrics.topPerformer.score}</Text>
            </View>
          </View>
        )}

        {/* Bottleneck Alert */}
        {farmMetrics.bottleneck && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>⚠️ BOTTLENECK DETECTED</Text>
            <View style={[styles.bottleneckCard, { borderColor: '#ffffff20' }]}>
              <Text style={styles.bottleneckAgent}>{farmMetrics.bottleneck.agent.name}</Text>
              <Text style={styles.bottleneckReason}>{farmMetrics.bottleneck.reason}</Text>
            </View>
          </View>
        )}
      </View>
    );
  };

  const renderPerformance = () => {
    return (
      <View style={styles.tabContent}>
        <Text style={styles.sectionTitle}>🎯 AGENT PERFORMANCE ESTIMATES</Text>
        <View style={styles.legendRow}>
          <Text style={styles.legendText}>S: Elite (90+) · A: Expert (80-89) · B: Proficient (70-79) · C: Learning (60-69)</Text>
        </View>
        <ScrollView style={styles.scoreList}>
          {[...agentScores]
            .sort((a, b) => b.overall - a.overall)
            .map((score) => {
              const agent = agents.find(a => a.id === score.agentId);
              if (!agent) return null;

              const gradeColor =
                score.grade === 'S' ? '#f59e0b' :
                score.grade === 'A' ? '#22c55e' :
                score.grade === 'B' ? '#3b82f6' :
                score.grade === 'C' ? '#f59e0b' :
                '#ef4444';

              return (
                <View key={score.agentId} style={[styles.scoreCard, { borderLeftColor: gradeColor }]}>
                  <View style={styles.scoreHeader}>
                    <View style={styles.scoreNameRow}>
                      <View style={[styles.scoreGrade, { backgroundColor: gradeColor + '20', borderColor: gradeColor }]}>
                        <Text style={[styles.scoreGradeText, { color: gradeColor }]}>{score.grade}</Text>
                      </View>
                      <View>
                        <Text style={styles.scoreName}>{agent.name}</Text>
                        <Text style={styles.scoreRole}>{agent.role}</Text>
                      </View>
                    </View>
                    <View style={styles.scoreOverall}>
                      <Text style={[styles.scoreOverallValue, { color: gradeColor }]}>{score.overall}</Text>
                      <Text style={styles.scoreOverallLabel}>ESTIMATE</Text>
                    </View>
                  </View>

                  {/* Breakdown Bars */}
                  <View style={styles.breakdownContainer}>
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Reliability</Text>
                      <View style={styles.breakdownBar}>
                        <View style={[styles.breakdownFill, { width: `${score.breakdown.reliability}%`, backgroundColor: '#22c55e' }]} />
                      </View>
                      <Text style={styles.breakdownValue}>{score.breakdown.reliability}</Text>
                    </View>
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Efficiency</Text>
                      <View style={styles.breakdownBar}>
                        <View style={[styles.breakdownFill, { width: `${score.breakdown.efficiency}%`, backgroundColor: '#3b82f6' }]} />
                      </View>
                      <Text style={styles.breakdownValue}>{score.breakdown.efficiency}</Text>
                    </View>
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Productivity</Text>
                      <View style={styles.breakdownBar}>
                        <View style={[styles.breakdownFill, { width: `${score.breakdown.productivity}%`, backgroundColor: '#f59e0b' }]} />
                      </View>
                      <Text style={styles.breakdownValue}>{score.breakdown.productivity}</Text>
                    </View>
                    <View style={styles.breakdownRow}>
                      <Text style={styles.breakdownLabel}>Quality</Text>
                      <View style={styles.breakdownBar}>
                        <View style={[styles.breakdownFill, { width: `${score.breakdown.quality}%`, backgroundColor: '#a855f7' }]} />
                      </View>
                      <Text style={styles.breakdownValue}>{score.breakdown.quality}</Text>
                    </View>
                  </View>

                  <View style={styles.scoreFooter}>
                    <Text style={styles.scoreRank}>Rank: #{score.rank}</Text>
                    <Text style={[styles.scoreTrend, { color: score.trend === 'improving' ? '#22c55e' : score.trend === 'declining' ? '#ef4444' : '#9e9e9e' }]}>
                      {score.trend === 'improving' ? '📈 Improving' : score.trend === 'declining' ? '📉 Declining' : '➡️ Stable'}
                    </Text>
                  </View>
                </View>
              );
            })}
        </ScrollView>
      </View>
    );
  };

  const renderWorkload = () => {
    return (
      <View style={styles.tabContent}>
        <Text style={styles.sectionTitle}>⚡ WORKLOAD DISTRIBUTION</Text>
        <ScrollView style={styles.workloadList}>
          {[...workloads]
            .sort((a, b) => b.currentLoad - a.currentLoad)
            .map((load) => {
              const statusColor =
                load.recommendedAction === 'overloaded' ? '#ef4444' :
                load.recommendedAction === 'optimal' ? '#22c55e' :
                '#f59e0b';

              return (
                <View key={load.agentId} style={[styles.workloadCard, { borderLeftColor: statusColor }]}>
                  <View style={styles.workloadHeader}>
                    <Text style={styles.workloadName}>{load.agentName}</Text>
                    <View style={[styles.workloadBadge, { backgroundColor: statusColor + '20', borderColor: statusColor }]}>
                      <Text style={[styles.workloadBadgeText, { color: statusColor }]}>
                        {load.recommendedAction === 'overloaded' ? '🔥 OVERLOADED' :
                         load.recommendedAction === 'optimal' ? '✓ OPTIMAL' :
                         '💤 UNDERUTILIZED'}
                      </Text>
                    </View>
                  </View>

                  {/* Load Bar */}
                  <View style={styles.loadBarContainer}>
                    <View style={styles.loadBar}>
                      <View style={[styles.loadFill, { width: `${load.currentLoad}%`, backgroundColor: statusColor }]} />
                    </View>
                    <Text style={[styles.loadPercent, { color: statusColor }]}>{load.currentLoad}%</Text>
                  </View>

                  <View style={styles.workloadStats}>
                    <Text style={styles.workloadStat}>In Progress: {load.tasksInProgress}</Text>
                    <Text style={styles.workloadStat}>Capacity: {load.estimatedCapacity}/hr</Text>
                  </View>
                </View>
              );
            })}
        </ScrollView>
      </View>
    );
  };

  const renderOptimization = () => {
    return (
      <View style={styles.tabContent}>
        <Text style={styles.sectionTitle}>💡 COST OPTIMIZATION SUGGESTIONS</Text>
        {optimizations.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>✅</Text>
            <Text style={styles.emptyTitle}>No current suggestions</Text>
            <Text style={styles.emptyText}>Current telemetry did not produce an optimization suggestion.</Text>
          </View>
        ) : (
          <ScrollView style={styles.optimizationList}>
            {optimizations.map((opt, i) => {
              const priorityColor =
                opt.priority === 'high' ? '#ef4444' :
                opt.priority === 'medium' ? '#f59e0b' :
                '#3b82f6';

              return (
                <View key={i} style={[styles.optimizationCard, { borderLeftColor: priorityColor }]}>
                  <View style={styles.optimizationHeader}>
                    <View style={[styles.priorityBadge, { backgroundColor: priorityColor + '20', borderColor: priorityColor }]}>
                      <Text style={[styles.priorityText, { color: priorityColor }]}>
                        {opt.priority.toUpperCase()}
                      </Text>
                    </View>
                    <Text style={styles.optimizationType}>
                      {opt.type === 'model_downgrade' ? '📊 Model Optimization' :
                       opt.type === 'consolidate_agents' ? '🔗 Consolidation' :
                       opt.type === 'archive_inactive' ? '🗄️ Archive' :
                       '⚡ Batch Tasks'}
                    </Text>
                  </View>

                  <Text style={styles.optimizationRecommendation}>{opt.recommendation}</Text>

                  <View style={styles.savingsRow}>
                    <Text style={styles.savingsLabel}>Estimated Savings:</Text>
                    <Text style={[styles.savingsValue, { color: '#22c55e' }]}>
                      ${opt.potentialSavings.toFixed(2)}/day
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    );
  };

  const renderHealth = () => {
    if (!healthCheck) return null;
    const hasIssues = healthCheck.issues.length > 0;
    const isClear = healthCheck.passed && !hasIssues;
    const attentionColor = healthCheck.passed ? '#f59e0b' : '#ef4444';
    const statusColor = isClear ? '#22c55e' : attentionColor;

    return (
      <View style={styles.tabContent}>
        <View style={[styles.healthStatusCard, { backgroundColor: `${statusColor}08`, borderColor: `${statusColor}30` }]}>
          <Text style={[styles.healthStatusIcon, { color: statusColor }]}>
            {isClear ? '✅' : '⚠️'}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.healthStatusText, { color: statusColor }]}>
              {isClear ? 'NO CURRENT ISSUES' : 'ATTENTION RECOMMENDED'}
            </Text>
            <Text style={styles.healthStatusSubtext}>
              {healthCheck.issues.length} issue{healthCheck.issues.length !== 1 ? 's' : ''} found
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>📋 HEALTH CHECK REPORT</Text>
        <ScrollView style={styles.issueList}>
          {healthCheck.issues.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🎯</Text>
              <Text style={styles.emptyTitle}>No current issues</Text>
              <Text style={styles.emptyText}>No issues were inferred from current status and session telemetry.</Text>
            </View>
          ) : (
            healthCheck.issues.map((issue, i) => {
              const severityColor =
                issue.severity === 'critical' ? '#ef4444' :
                issue.severity === 'warning' ? '#f59e0b' :
                '#3b82f6';

              const severityIcon =
                issue.severity === 'critical' ? '🚨' :
                issue.severity === 'warning' ? '⚠️' :
                'ℹ️';

              return (
                <View key={i} style={[styles.issueCard, { borderLeftColor: severityColor }]}>
                  <View style={styles.issueHeader}>
                    <Text style={styles.issueIcon}>{severityIcon}</Text>
                    <View style={[styles.severityBadge, { backgroundColor: severityColor + '20', borderColor: severityColor }]}>
                      <Text style={[styles.severityText, { color: severityColor }]}>
                        {issue.severity.toUpperCase()}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.issueMessage}>{issue.message}</Text>
                </View>
              );
            })
          )}
        </ScrollView>
      </View>
    );
  };

  if (agents.length === 0) {
    return (
      <View style={styles.container}>
        <FarmProvenanceNotice />
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🏢</Text>
          <Text style={styles.emptyTitle}>No Agent Data</Text>
          <Text style={styles.emptyText}>Connect agents to see farm health metrics</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FarmProvenanceNotice />

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        {[
          { key: 'overview', label: 'Overview', icon: '🏢' },
          { key: 'performance', label: 'Performance', icon: '🎯' },
          { key: 'workload', label: 'Workload', icon: '⚡' },
          { key: 'optimization', label: 'Optimize', icon: '💡' },
          { key: 'health', label: 'Health', icon: '🏥' },
        ].map((tab) => (
          <Pressable
            key={tab.key}
            onPress={() => setActiveTab(tab.key as TabType)}
            accessibilityRole="tab"
            accessibilityLabel={`${tab.label} farm estimates`}
            accessibilityState={{ selected: activeTab === tab.key }}
            style={[
              styles.tab,
              activeTab === tab.key && [styles.tabActive, { borderBottomColor: accentColor }],
              Platform.OS === 'web' && { cursor: 'pointer' } as any,
            ]}
          >
            <Text style={styles.tabIcon}>{tab.icon}</Text>
            <Text style={[styles.tabLabel, activeTab === tab.key && { color: accentColor }]}>
              {tab.label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Content */}
      <ScrollView style={styles.scrollContainer} showsVerticalScrollIndicator={true}>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'performance' && renderPerformance()}
        {activeTab === 'workload' && renderWorkload()}
        {activeTab === 'optimization' && renderOptimization()}
        {activeTab === 'health' && renderHealth()}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  provenanceNotice: {
    backgroundColor: '#0d0d14',
    borderBottomWidth: 1,
    borderBottomColor: '#f59e0b55',
    paddingHorizontal: 16,
    paddingVertical: 10,
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
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
    backgroundColor: '#000000',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    gap: 4,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: '#e8e8e8',
  },
  tabIcon: {
    fontSize: 16,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6f6f6f',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  scrollContainer: {
    flex: 1,
  },
  tabContent: {
    padding: 16,
    gap: 16,
  },

  // Overview
  healthBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  healthIcon: {
    fontSize: 32,
  },
  healthStatus: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  healthSubtext: {
    fontSize: 11,
    color: '#9e9e9e',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#000000',
    borderLeftWidth: 3,
    borderRadius: 8,
    padding: 12,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#e8e8e8',
    fontFamily: 'monospace',
  },
  statLabel: {
    fontSize: 10,
    color: '#6f6f6f',
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
    marginTop: 2,
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: '#9e9e9e',
    fontFamily: 'monospace',
    letterSpacing: 1.5,
  },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  costLabel: {
    fontSize: 12,
    color: '#9e9e9e',
    fontFamily: 'monospace',
  },
  costValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e8e8e8',
    fontFamily: 'monospace',
  },
  performerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    backgroundColor: '#000000',
    borderRadius: 8,
    borderWidth: 2,
  },
  performerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  performerAvatarText: {
    fontSize: 18,
    fontWeight: '800',
  },
  performerName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e8e8e8',
    fontFamily: 'monospace',
  },
  performerRole: {
    fontSize: 10,
    color: '#6f6f6f',
    fontFamily: 'monospace',
  },
  performerScore: {
    fontSize: 24,
    fontWeight: '800',
    color: '#22c55e',
    fontFamily: 'monospace',
  },
  bottleneckCard: {
    padding: 12,
    backgroundColor: '#000000',
    borderRadius: 8,
    borderWidth: 2,
  },
  bottleneckAgent: {
    fontSize: 13,
    fontWeight: '700',
    color: '#9e9e9e',
    fontFamily: 'monospace',
    marginBottom: 4,
  },
  bottleneckReason: {
    fontSize: 11,
    color: '#9e9e9e',
    fontFamily: 'monospace',
  },

  // Performance
  legendRow: {
    padding: 10,
    backgroundColor: '#000000',
    borderRadius: 8,
  },
  legendText: {
    fontSize: 9,
    color: '#6f6f6f',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  scoreList: {
    flex: 1,
  },
  scoreCard: {
    backgroundColor: '#000000',
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
    gap: 12,
  },
  scoreHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  scoreNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  scoreGrade: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  scoreGradeText: {
    fontSize: 14,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  scoreName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e8e8e8',
    fontFamily: 'monospace',
  },
  scoreRole: {
    fontSize: 10,
    color: '#6f6f6f',
    fontFamily: 'monospace',
  },
  scoreOverall: {
    alignItems: 'center',
  },
  scoreOverallValue: {
    fontSize: 28,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  scoreOverallLabel: {
    fontSize: 8,
    color: '#6f6f6f',
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  breakdownContainer: {
    gap: 8,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breakdownLabel: {
    width: 75,
    fontSize: 9,
    color: '#9e9e9e',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  breakdownBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#2a2a2a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  breakdownFill: {
    height: '100%',
    borderRadius: 3,
  },
  breakdownValue: {
    width: 30,
    fontSize: 9,
    color: '#e8e8e8',
    fontFamily: 'monospace',
    fontWeight: '700',
    textAlign: 'right',
  },
  scoreFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  scoreRank: {
    fontSize: 10,
    color: '#9e9e9e',
    fontFamily: 'monospace',
  },
  scoreTrend: {
    fontSize: 10,
    fontWeight: '600',
    fontFamily: 'monospace',
  },

  // Workload
  workloadList: {
    flex: 1,
  },
  workloadCard: {
    backgroundColor: '#000000',
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    gap: 10,
  },
  workloadHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  workloadName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e8e8e8',
    fontFamily: 'monospace',
  },
  workloadBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  workloadBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  loadBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  loadBar: {
    flex: 1,
    height: 10,
    backgroundColor: '#2a2a2a',
    borderRadius: 5,
    overflow: 'hidden',
  },
  loadFill: {
    height: '100%',
    borderRadius: 5,
  },
  loadPercent: {
    width: 40,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    textAlign: 'right',
  },
  workloadStats: {
    flexDirection: 'row',
    gap: 12,
  },
  workloadStat: {
    fontSize: 10,
    color: '#6f6f6f',
    fontFamily: 'monospace',
  },

  // Optimization
  optimizationList: {
    flex: 1,
  },
  optimizationCard: {
    backgroundColor: '#000000',
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    gap: 10,
  },
  optimizationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  priorityText: {
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  optimizationType: {
    fontSize: 11,
    color: '#9e9e9e',
    fontFamily: 'monospace',
    fontWeight: '600',
  },
  optimizationRecommendation: {
    fontSize: 12,
    color: '#e8e8e8',
    fontFamily: 'monospace',
    lineHeight: 18,
  },
  savingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#2a2a2a',
  },
  savingsLabel: {
    fontSize: 10,
    color: '#9e9e9e',
    fontFamily: 'monospace',
  },
  savingsValue: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },

  // Health
  healthStatusCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 2,
  },
  healthStatusIcon: {
    fontSize: 32,
  },
  healthStatusText: {
    fontSize: 13,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  healthStatusSubtext: {
    fontSize: 10,
    color: '#9e9e9e',
    fontFamily: 'monospace',
    marginTop: 2,
  },
  issueList: {
    flex: 1,
  },
  issueCard: {
    backgroundColor: '#000000',
    borderLeftWidth: 4,
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    gap: 8,
  },
  issueHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  issueIcon: {
    fontSize: 16,
  },
  severityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
  },
  severityText: {
    fontSize: 8,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  issueMessage: {
    fontSize: 12,
    color: '#e8e8e8',
    fontFamily: 'monospace',
    lineHeight: 18,
  },

  // Empty states
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#e8e8e8',
    fontFamily: 'monospace',
    marginBottom: 6,
  },
  emptyText: {
    fontSize: 12,
    color: '#6f6f6f',
    fontFamily: 'monospace',
    textAlign: 'center',
  },
});
