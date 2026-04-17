import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { buildCodingWorkbenchLines, getCodingWorkbenchMetrics, getCodingWorkbenchPhase, inferCodingWorkbenchFileName } from '../../lib/codingWorkbench';

type CodingWorkbenchPreviewProps = {
  prompt: string;
  tick: number;
  accentColor: string;
  selectedModel?: string;
  title?: string;
};

export default function CodingWorkbenchPreview({
  prompt,
  tick,
  accentColor,
  selectedModel = 'auto',
  title = 'OpenSwan is writing code live...',
}: CodingWorkbenchPreviewProps) {
  const fileName = inferCodingWorkbenchFileName(prompt);
  const lines = buildCodingWorkbenchLines(prompt, tick);
  const phase = getCodingWorkbenchPhase(tick);
  const metrics = getCodingWorkbenchMetrics(tick);

  return (
    <View style={[styles.shell, { borderColor: `${accentColor}30`, shadowColor: accentColor }]}>
      <View style={styles.header}>
        <View style={styles.traffic}>
          <View style={[styles.dot, { backgroundColor: '#ef4444' }]} />
          <View style={[styles.dot, { backgroundColor: '#f59e0b' }]} />
          <View style={[styles.dot, { backgroundColor: '#22c55e' }]} />
        </View>
        <Text style={styles.file}>{fileName}</Text>
        <Text style={[styles.model, { color: accentColor }]}>
          {selectedModel === 'auto' ? 'OpenSwan Auto Route' : selectedModel}
        </Text>
      </View>

      <View style={styles.phaseRow}>
        <Text style={[styles.phaseBadge, { color: accentColor, borderColor: `${accentColor}40` }]}>{phase}</Text>
        <Text style={styles.metric}>+{metrics.xp} BUILD XP</Text>
        <Text style={styles.metric}>{metrics.files} FILES</Text>
        <Text style={styles.metric}>{metrics.passes} PASSES</Text>
      </View>

      <View style={styles.body}>
        {lines.map((line, index) => (
          <View key={`${index}-${line}`} style={styles.row}>
            <Text style={styles.lineNo}>{String(index + 1).padStart(2, '0')}</Text>
            <Text style={styles.code}>{line || ' '}</Text>
          </View>
        ))}
        <View style={styles.row}>
          <Text style={styles.lineNo}>{String(lines.length + 1).padStart(2, '0')}</Text>
          <View style={[styles.cursor, { backgroundColor: accentColor }]} />
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>{title}</Text>
        <Text style={[styles.footerText, { color: accentColor }]}>BUILD STREAM</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#05070b',
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#0b0f17',
    borderBottomWidth: 1,
    borderBottomColor: '#152032',
  },
  traffic: { flexDirection: 'row', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 999 },
  file: {
    color: '#d8e1ef',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    flex: 1,
  },
  model: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
  },
  phaseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#07101c',
    borderBottomWidth: 1,
    borderBottomColor: '#101827',
    flexWrap: 'wrap',
  },
  phaseBadge: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.9,
    fontFamily: 'monospace',
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#09111f',
  },
  metric: {
    color: '#7f8ea3',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontFamily: 'monospace',
  },
  body: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#03060b',
    gap: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineNo: {
    width: 26,
    color: '#425066',
    fontSize: 10,
    textAlign: 'right',
    fontFamily: 'monospace',
  },
  code: {
    color: '#d8e1ef',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
    flex: 1,
  },
  cursor: { width: 8, height: 16, borderRadius: 2 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: '#152032',
    backgroundColor: '#07101c',
  },
  footerText: {
    color: '#7f8ea3',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
    fontFamily: 'monospace',
  },
});
