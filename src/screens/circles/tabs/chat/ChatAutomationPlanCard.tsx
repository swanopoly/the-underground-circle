import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ChatAutomationPlanPreview, ChatAutomationPreviewTone } from '../../../../lib/chatAutomationPlanPreview';

type Props = {
  preview: ChatAutomationPlanPreview;
  accentColor: string;
};

function toneColor(tone: ChatAutomationPreviewTone, accentColor: string): string {
  switch (tone) {
    case 'safe':
      return '#22c55e';
    case 'review':
      return '#f59e0b';
    case 'danger':
      return '#ef4444';
    default:
      return accentColor;
  }
}

function compactList(values: string[], limit: number): string[] {
  return values.map((value) => String(value || '').trim()).filter(Boolean).slice(0, limit);
}

export default function ChatAutomationPlanCard({ preview, accentColor }: Props) {
  const riskColor = toneColor(preview.riskTone, accentColor);
  const evidence = compactList(preview.evidence, 3);
  const recovery = compactList(preview.recovery, 2);
  const tools = compactList(preview.tools, 4);
  const evidencePanel = preview.evidencePanel;

  const contractRows = evidencePanel ? [
    { label: 'Observe Before', items: compactList(evidencePanel.observeBefore, 2), tone: 'neutral' as ChatAutomationPreviewTone },
    { label: 'Actionability', items: compactList(evidencePanel.actionabilityChecks, 2), tone: 'neutral' as ChatAutomationPreviewTone },
    { label: 'Approval Before', items: compactList(evidencePanel.approvalBefore, 2), tone: 'review' as ChatAutomationPreviewTone },
    { label: 'Proof After', items: compactList(evidencePanel.proofAfter, 2), tone: 'safe' as ChatAutomationPreviewTone },
    { label: 'Fail Closed', items: compactList(evidencePanel.failClosedRules, 2), tone: 'danger' as ChatAutomationPreviewTone },
    { label: 'Fresh Retry Evidence', items: compactList(evidencePanel.freshEvidenceRequired, 1), tone: 'review' as ChatAutomationPreviewTone },
  ].filter((row) => row.items.length > 0) : [];

  return (
    <View style={[styles.card, { borderColor: `${accentColor}45` }]} nativeID="section-chat-automation-plan">
      <View style={styles.header}>
        <View style={[styles.planMark, { borderColor: `${accentColor}80`, backgroundColor: `${accentColor}14` }]}>
          <Text style={[styles.planMarkText, { color: accentColor }]}>PLAN</Text>
        </View>
        <View style={styles.headerText}>
          <Text style={styles.title} numberOfLines={1}>{preview.title}</Text>
          <Text style={styles.subtitle} numberOfLines={2}>{preview.surfaceLabel}</Text>
        </View>
        <View style={[styles.modePill, { borderColor: `${accentColor}45` }]}>
          <Text style={[styles.modeText, { color: accentColor }]} numberOfLines={1}>{preview.mode}</Text>
        </View>
      </View>

      <View style={styles.chipRow}>
        {preview.chips.slice(0, 5).map((chip) => {
          const color = toneColor(chip.tone, accentColor);
          return (
            <View key={`${chip.label}-${chip.tone}`} style={[styles.chip, { borderColor: `${color}45`, backgroundColor: `${color}10` }]}>
              <Text style={[styles.chipText, { color }]} numberOfLines={1}>{chip.label}</Text>
            </View>
          );
        })}
      </View>

      <View style={styles.metaGrid}>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Route</Text>
          <Text style={styles.metaValue} numberOfLines={1}>{preview.routeLabel}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Risk</Text>
          <Text style={[styles.metaValue, { color: riskColor }]} numberOfLines={1}>{preview.riskLabel}</Text>
        </View>
        <View style={styles.metaItem}>
          <Text style={styles.metaLabel}>Approval</Text>
          <Text style={[styles.metaValue, preview.approvalRequired && { color: '#f59e0b' }]} numberOfLines={2}>
            {preview.approvalLabel}
          </Text>
        </View>
      </View>

      {evidencePanel && contractRows.length > 0 ? (
        <View style={styles.contractSection}>
          <View style={styles.contractHeaderRow}>
            <Text style={styles.sectionLabel}>Evidence Contract</Text>
            <Text style={styles.contractMeta} numberOfLines={1}>
              {evidencePanel.kind} - {evidencePanel.targetLabel}
            </Text>
          </View>
          {evidencePanel.taskFamilyLabel ? (
            <Text style={styles.contractFamily} numberOfLines={1}>{evidencePanel.taskFamilyLabel}</Text>
          ) : null}
          {contractRows.map((row) => {
            const color = toneColor(row.tone, accentColor);
            return (
              <View key={`contract-${row.label}`} style={styles.contractRow}>
                <Text style={[styles.contractLabel, { color }]}>{row.label}</Text>
                <Text style={styles.contractValue} numberOfLines={2}>{row.items.join(' / ')}</Text>
              </View>
            );
          })}
          {evidencePanel.sourceRefs.length > 0 ? (
            <Text style={styles.contractSources} numberOfLines={1}>
              Sources: {evidencePanel.sourceRefs.map((ref) => ref.title).join(', ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      {evidence.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Evidence</Text>
          {evidence.map((item) => <Text key={`evidence-${item}`} style={styles.sectionItem} numberOfLines={2}>{item}</Text>)}
        </View>
      ) : null}

      {tools.length > 0 ? (
        <View style={styles.toolRow}>
          {tools.map((tool) => (
            <View key={`tool-${tool}`} style={styles.toolChip}>
              <Text style={styles.toolText} numberOfLines={1}>{tool}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {recovery.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recovery</Text>
          {recovery.map((item) => <Text key={`recovery-${item}`} style={styles.sectionItem} numberOfLines={2}>{item}</Text>)}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 8,
    borderWidth: 1,
    borderRadius: 8,
    backgroundColor: '#09110c',
    padding: 10,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  planMark: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  planMarkText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#e5f3df',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0,
  },
  subtitle: {
    color: '#9daf9a',
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  modePill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 96,
  },
  modeText: {
    fontSize: 10,
    fontWeight: '800',
    textTransform: 'capitalize',
    letterSpacing: 0,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 160,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  metaGrid: {
    gap: 6,
  },
  metaItem: {
    borderWidth: 1,
    borderColor: '#1d2c20',
    borderRadius: 8,
    backgroundColor: '#0d170f',
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  metaLabel: {
    color: '#7f927f',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
    marginBottom: 2,
  },
  metaValue: {
    color: '#dce9d8',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  section: {
    gap: 4,
  },
  contractSection: {
    gap: 5,
    borderTopWidth: 1,
    borderTopColor: '#1d2c20',
    paddingTop: 7,
  },
  contractHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  contractMeta: {
    color: '#7f927f',
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0,
    flexShrink: 1,
  },
  contractFamily: {
    color: '#b8c7b4',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
  contractRow: {
    gap: 1,
  },
  contractLabel: {
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  contractValue: {
    color: '#d5e1d0',
    fontSize: 11,
    lineHeight: 15,
  },
  contractSources: {
    color: '#7f927f',
    fontSize: 10,
    lineHeight: 14,
  },
  sectionLabel: {
    color: '#8ea18d',
    fontSize: 9,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0,
  },
  sectionItem: {
    color: '#d5e1d0',
    fontSize: 11,
    lineHeight: 15,
  },
  toolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  toolChip: {
    borderWidth: 1,
    borderColor: '#243626',
    borderRadius: 999,
    backgroundColor: '#101b12',
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 180,
  },
  toolText: {
    color: '#b8c7b4',
    fontSize: 10,
    fontFamily: 'monospace',
  },
});
