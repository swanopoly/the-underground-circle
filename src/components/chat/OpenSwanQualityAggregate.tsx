import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { OpenSwanObservedEvalAggregate } from '../../lib/openswanObservedEvals';

type Props = {
  aggregate: OpenSwanObservedEvalAggregate;
  title?: string;
  accentColor?: string;
};

function formatTopModes(byMode: Record<string, number>): string[] {
  return Object.entries(byMode)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([mode, count]) => `${mode.toUpperCase()} ${count}`);
}

export default function OpenSwanQualityAggregate({
  aggregate,
  title = 'OPENSWAN QUALITY',
  accentColor = '#38bdf8',
}: Props) {
  if (!aggregate.total) return null;

  const topModes = formatTopModes(aggregate.byMode);

  return (
    <View style={[styles.card, { borderColor: `${accentColor}30` }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: accentColor }]}>{title}</Text>
        <Text style={styles.meta}>{aggregate.total} RUNS</Text>
      </View>

      <View style={styles.statRow}>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{aggregate.averageScore}</Text>
          <Text style={styles.statLabel}>AVG SCORE</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{aggregate.averageResponseQuality}</Text>
          <Text style={styles.statLabel}>RESPONSE</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{Math.round(aggregate.averageVerificationCoverage * 100)}%</Text>
          <Text style={styles.statLabel}>VERIFY</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{Math.round(aggregate.blockerRate * 100)}%</Text>
          <Text style={styles.statLabel}>BLOCKER RATE</Text>
        </View>
        <View style={[styles.statChip, styles.strongChip]}>
          <Text style={[styles.statValue, styles.strongText]}>{aggregate.byOutcome.strong}</Text>
          <Text style={[styles.statLabel, styles.strongText]}>STRONG</Text>
        </View>
        <View style={[styles.statChip, styles.blockedChip]}>
          <Text style={[styles.statValue, styles.blockedText]}>{aggregate.byOutcome.blocked}</Text>
          <Text style={[styles.statLabel, styles.blockedText]}>BLOCKED</Text>
        </View>
        <View style={[styles.statChip, styles.failedChip]}>
          <Text style={[styles.statValue, styles.failedText]}>{aggregate.byOutcome.failed}</Text>
          <Text style={[styles.statLabel, styles.failedText]}>FAILED</Text>
        </View>
      </View>

      {topModes.length > 0 ? (
        <View style={styles.modeRow}>
          {topModes.map((item) => (
            <View key={item} style={styles.modeChip}>
              <Text style={styles.modeChipText}>{item}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {aggregate.modeBreakdown.length > 0 ? (
        <View style={styles.breakdownWrap}>
          <Text style={styles.breakdownTitle}>MODE BREAKDOWN</Text>
          {aggregate.modeBreakdown.map((mode) => (
            <View key={mode.mode} style={styles.breakdownRow}>
              <Text style={styles.breakdownMode}>{mode.mode.toUpperCase()}</Text>
              <View style={styles.breakdownTextWrap}>
                <Text style={styles.breakdownMeta}>
                  {mode.total} runs · score {mode.averageScore} · response {mode.averageResponseQuality} · verify {Math.round(mode.averageVerificationCoverage * 100)}% · blocker {Math.round(mode.blockerRate * 100)}%
                </Text>
                {mode.weakestSignal ? (
                  <Text style={styles.breakdownWeakest}>
                    {mode.weakestSignal.key.startsWith('skill:') ? 'Weakest skill:' : 'Weakest:'} {mode.weakestSignal.label} {mode.weakestSignal.score}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {aggregate.topBlockers.length > 0 ? (
        <View style={styles.breakdownWrap}>
          <Text style={styles.breakdownTitle}>TOP BLOCKERS</Text>
          {aggregate.topBlockers.slice(0, 3).map((blocker) => (
            <View key={`${blocker.label}-${blocker.count}`} style={styles.breakdownRow}>
              <Text style={styles.breakdownMode}>{blocker.count}×</Text>
              <Text style={styles.breakdownMeta} numberOfLines={2}>{blocker.label}</Text>
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
    backgroundColor: '#0b1220',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
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
  statRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  statChip: {
    minWidth: 70,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#111827',
    gap: 2,
  },
  statValue: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '900',
    fontFamily: 'monospace',
  },
  statLabel: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  strongChip: {
    borderColor: '#14532d',
    backgroundColor: '#052e16',
  },
  strongText: {
    color: '#86efac',
  },
  blockedChip: {
    borderColor: '#78350f',
    backgroundColor: '#1f1605',
  },
  blockedText: {
    color: '#fbbf24',
  },
  failedChip: {
    borderColor: '#7f1d1d',
    backgroundColor: '#2a0b0b',
  },
  failedText: {
    color: '#fca5a5',
  },
  modeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  modeChip: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#111827',
  },
  modeChipText: {
    color: '#cbd5e1',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  breakdownWrap: {
    gap: 6,
    paddingTop: 4,
  },
  breakdownTitle: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  breakdownRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-start',
  },
  breakdownTextWrap: {
    flex: 1,
    gap: 3,
  },
  breakdownMode: {
    minWidth: 64,
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  breakdownMeta: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
  },
  breakdownWeakest: {
    color: '#fbbf24',
    fontSize: 10,
    lineHeight: 14,
    fontFamily: 'monospace',
  },
});
