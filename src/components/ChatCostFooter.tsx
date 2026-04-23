/**
 * ChatCostFooter — tiny persistent footer in the ChatTab composer bar
 * showing the circle's rolling 24h automation + computer-use spend
 * (Cline research item 3). Uses `useCircleCostTelemetry` which is
 * already in the codebase — we just render it in-line so users see
 * cost without opening a separate panel.
 *
 * Ultra-compact: one row, monospace, muted until cost is non-trivial.
 * Tapping it opens the Cost Dashboard (callers pass `onPress`).
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useCircleCostTelemetry } from '../lib/circleCostTelemetry';

interface Props {
  circleId: string | null;
  accentColor: string;
  onPress?: () => void;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export default function ChatCostFooter({ circleId, accentColor, onPress }: Props) {
  const telemetry = useCircleCostTelemetry(circleId);
  const total = telemetry.automation24hCost + telemetry.computerUse24hCost;
  const nonTrivial = total >= 0.01;

  const content = (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: nonTrivial ? accentColor : '#334155' }]} />
      <Text style={styles.label}>24H</Text>
      <Text style={[styles.value, nonTrivial && { color: '#e2e8f0' }]}>
        {fmtUsd(total)}
      </Text>
      {telemetry.automation24hCost > 0 ? (
        <Text style={styles.muted}>
          · auto {fmtUsd(telemetry.automation24hCost)}
        </Text>
      ) : null}
      {telemetry.computerUse24hCost > 0 ? (
        <Text style={styles.muted}>
          · cu {fmtUsd(telemetry.computerUse24hCost)}
        </Text>
      ) : null}
      {telemetry.computerUseLastRunCost != null && telemetry.computerUseLastRunAt ? (
        <Text style={styles.muted}>
          · last {fmtUsd(telemetry.computerUseLastRunCost)}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress) return <View style={styles.wrap}>{content}</View>;

  return (
    <Pressable
      onPress={onPress}
      style={({ hovered }: any) => [
        styles.wrap,
        hovered && ({ backgroundColor: '#0f172a' } as any),
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
      accessibilityRole="button"
      accessibilityLabel="Open circle cost dashboard"
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 999 },
  label: {
    color: '#475569',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  value: {
    color: '#64748b',
    fontFamily: 'monospace',
    fontSize: 10,
    fontWeight: '700',
  },
  muted: {
    color: '#475569',
    fontFamily: 'monospace',
    fontSize: 9,
  },
});
