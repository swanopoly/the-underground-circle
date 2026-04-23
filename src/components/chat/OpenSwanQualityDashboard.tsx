import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { OpenSwanObservedEvalDashboard } from '../../lib/openswanObservedEvals';

type Props = {
  dashboard: OpenSwanObservedEvalDashboard;
  title?: string;
  accentColor?: string;
};

function getOutcomeColor(outcome: string): string {
  switch (outcome) {
    case 'strong':
      return '#22c55e';
    case 'blocked':
      return '#f59e0b';
    case 'failed':
      return '#ef4444';
    default:
      return '#38bdf8';
  }
}

export default function OpenSwanQualityDashboard({
  dashboard,
  title = 'OPENSWAN QUALITY DASHBOARD',
  accentColor = '#38bdf8',
}: Props) {
  if (!dashboard.aggregate.total) return null;

  const trendMax = Math.max(...dashboard.recentRuns.map((run) => run.score), 100);

  return (
    <View style={[styles.card, { borderColor: `${accentColor}30` }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: accentColor }]}>{title}</Text>
        <Text style={styles.meta}>{dashboard.aggregate.total} RUNS</Text>
      </View>

      <View style={styles.summaryRow}>
        <View style={styles.summaryChip}>
          <Text style={styles.summaryValue}>{dashboard.aggregate.averageScore}</Text>
          <Text style={styles.summaryLabel}>AVG SCORE</Text>
        </View>
        <View style={styles.summaryChip}>
          <Text style={styles.summaryValue}>{dashboard.aggregate.averageResponseQuality}</Text>
          <Text style={styles.summaryLabel}>RESPONSE</Text>
        </View>
        <View style={styles.summaryChip}>
          <Text style={styles.summaryValue}>{Math.round(dashboard.aggregate.averageVerificationCoverage * 100)}%</Text>
          <Text style={styles.summaryLabel}>VERIFY</Text>
        </View>
      </View>

      {dashboard.recentRuns.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>RECENT SCORE TREND</Text>
          <View style={styles.trendRow}>
            {dashboard.recentRuns.map((run, index) => (
              <View key={`${run.createdAt}-${index}`} style={styles.trendItem}>
                <View style={styles.trendBarTrack}>
                  <View
                    style={[
                      styles.trendBar,
                      {
                        height: `${Math.max(10, Math.round((run.score / trendMax) * 100))}%`,
                        backgroundColor: getOutcomeColor(run.outcome),
                      },
                    ]}
                  />
                </View>
                <Text style={styles.trendScore}>{run.score}</Text>
                <Text style={styles.trendMode} numberOfLines={1}>{run.mode.toUpperCase()}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {dashboard.weakestModes.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>WEAKEST MODES</Text>
          {dashboard.weakestModes.map((mode) => (
            <View key={mode.mode} style={styles.modeRow}>
              <View style={styles.modeTextWrap}>
                <Text style={styles.modeLabel}>{mode.mode.toUpperCase()}</Text>
                <Text style={styles.modeMeta}>
                  {mode.total} runs · score {mode.averageScore} · response {mode.averageResponseQuality} · blocker {Math.round(mode.blockerRate * 100)}%
                </Text>
                {mode.weakestSignal ? (
                  <Text style={styles.modeWeakest}>
                    {mode.weakestSignal.key.startsWith('skill:') ? 'WEAKEST SKILL:' : 'WEAKEST:'} {mode.weakestSignal.label.toUpperCase()} {mode.weakestSignal.score}
                  </Text>
                ) : null}
                {mode.leadingSignals.length > 0 ? (
                  <View style={styles.signalRow}>
                    {mode.leadingSignals.map((signal) => (
                      <View
                        key={`${mode.mode}-${signal.key}`}
                        style={[
                          styles.signalChip,
                          signal.key.startsWith('skill:') ? styles.skillSignalChip : null,
                        ]}
                      >
                        <Text style={styles.signalChipText}>
                          {signal.label.toUpperCase()} {signal.score}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {dashboard.failureClusters.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>REPEATED FAILURE CLUSTERS</Text>
          {dashboard.failureClusters.map((cluster) => (
            <View key={cluster.key} style={styles.clusterRow}>
              <Text style={styles.clusterCount}>{cluster.count}×</Text>
              <View style={styles.clusterTextWrap}>
              <Text style={styles.clusterLabel}>
                  {cluster.mode.toUpperCase()} · {cluster.label}
                </Text>
                <Text style={styles.clusterMeta}>avg quality {cluster.averageScore}</Text>
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#07101a',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  meta: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  section: {
    gap: 8,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  summaryChip: {
    minWidth: 74,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0b1220',
    gap: 2,
  },
  summaryValue: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  summaryLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  sectionTitle: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  trendRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    minHeight: 120,
  },
  trendItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  trendBarTrack: {
    width: '100%',
    height: 72,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0b1220',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  trendBar: {
    width: '100%',
    minHeight: 6,
    borderRadius: 6,
  },
  trendScore: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  trendMode: {
    color: '#64748b',
    fontSize: 8,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  modeTextWrap: {
    flex: 1,
    gap: 5,
  },
  modeLabel: {
    minWidth: 72,
    color: '#f8fafc',
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  modeMeta: {
    flex: 1,
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
  },
  modeWeakest: {
    color: '#fbbf24',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  signalRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  signalChip: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0b1220',
  },
  skillSignalChip: {
    borderColor: '#14532d',
    backgroundColor: '#052e16',
  },
  signalChipText: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    fontFamily: 'monospace',
  },
  clusterRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  clusterCount: {
    minWidth: 28,
    color: '#fca5a5',
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  clusterTextWrap: {
    flex: 1,
    gap: 2,
  },
  clusterLabel: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
  clusterMeta: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
  },
});
