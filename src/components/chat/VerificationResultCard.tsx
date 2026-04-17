import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getOpenSwanExecutionStatusColor, getOpenSwanExecutionStatusLabel } from '../../lib/openswanExecution';
import type { OpenSwanVerificationResult } from '../../lib/openswanVerificationRuntime';

type Props = {
  results: OpenSwanVerificationResult[];
  accentColor: string;
};

export default function VerificationResultCard({ results, accentColor }: Props) {
  if (!results.length) return null;

  return (
    <View style={[styles.card, { borderColor: `${accentColor}30` }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: accentColor }]}>VERIFICATION</Text>
        <Text style={styles.meta}>{results.filter((result) => result.ok).length}/{results.length} checks green</Text>
      </View>
      <View style={styles.list}>
        {results.map((result) => (
          <View key={result.check.id} style={styles.row}>
            <Text style={[styles.status, { color: getOpenSwanExecutionStatusColor(result.status) }]}>
              {getOpenSwanExecutionStatusLabel(result.status)}
            </Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{result.check.label}</Text>
              <Text style={styles.summary}>{result.summary}</Text>
              {result.command ? <Text style={styles.command}>{result.command}</Text> : null}
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#07101a',
    padding: 10,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  meta: {
    color: '#7c8aa0',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  status: {
    width: 34,
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.8,
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
    marginTop: 2,
    lineHeight: 14,
  },
  command: {
    color: '#64748b',
    fontSize: 10,
    marginTop: 4,
    fontFamily: 'monospace',
  },
});
