import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ChatCommandDecision } from '../../lib/chatCommandRegistry';
import {
  buildCommandDecisionSummary,
  formatCommandDecisionRoute,
  formatCommandDecisionSource,
} from '../../lib/runRouting';

type Props = {
  decisions?: ChatCommandDecision[];
  variant?: 'compact' | 'detailed';
  accentColor?: string;
};

export default function RunRoutingSummary({
  decisions = [],
  variant = 'detailed',
  accentColor = '#38bdf8',
}: Props) {
  if (!decisions.length) return null;

  if (variant === 'compact') {
    const summary = buildCommandDecisionSummary(decisions);
    if (!summary) return null;
    return (
      <Text style={[styles.compactSummary, { color: accentColor }]}>
        {summary}
      </Text>
    );
  }

  return (
    <View style={styles.list}>
      {decisions.map((decision, index) => (
        <View key={`${decision.routeId}-${decision.decidedAt}-${index}`} style={styles.row}>
          <Text style={[styles.badge, { color: accentColor }]}>
            {decision.routeId.replace(/_/g, ' ').slice(0, 3).toUpperCase()}
          </Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>
              {formatCommandDecisionRoute(decision)} via {formatCommandDecisionSource(decision)}
            </Text>
            <Text style={styles.summary} numberOfLines={2}>
              {decision.input}
            </Text>
            <Text style={styles.command}>{decision.commandText}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
  },
  badge: {
    width: 34,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  label: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
  },
  summary: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 2,
  },
  command: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  compactSummary: {
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
