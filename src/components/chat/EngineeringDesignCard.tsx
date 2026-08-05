import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  EngineeringCalcCardModel,
  EngineeringCardModel,
  EngineeringDesignCardModel,
} from '../../lib/engineeringDesignCardCore';

type Props = {
  model: EngineeringCardModel | null | undefined;
  accentColor: string;
  /** Tap on a next-step chip seeds this text into the chat composer. */
  onSeedCommand?: (text: string) => void;
};

const SAFETY_TONE_COLORS: Record<'ok' | 'warn' | 'danger', { border: string; background: string; text: string }> = {
  ok: { border: '#22c55e45', background: '#052e1628', text: '#86efac' },
  warn: { border: '#f59e0b45', background: '#2a1d0728', text: '#fcd34d' },
  danger: { border: '#ef444445', background: '#3f0b0b38', text: '#fca5a5' },
};

function DesignCard({ model, accentColor, onSeedCommand }: { model: EngineeringDesignCardModel; accentColor: string; onSeedCommand?: (text: string) => void }) {
  const [notesOpen, setNotesOpen] = useState(false);
  const safetyColors = model.safetyPill ? SAFETY_TONE_COLORS[model.safetyPill.tone] : null;

  return (
    <View style={[styles.card, { borderColor: `${accentColor}30` }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: accentColor }]}>ENGINEERING DESIGN</Text>
        {model.truncated ? <Text style={styles.truncatedTag}>TRIMMED</Text> : null}
      </View>
      <Text style={styles.partTitle}>{model.title}</Text>
      {model.subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{model.subtitle}</Text> : null}

      <View style={styles.chipRail}>
        {model.safetyPill && safetyColors ? (
          <View style={[styles.pill, { borderColor: safetyColors.border, backgroundColor: safetyColors.background }]}>
            <Text style={styles.pillLabel}>SAFETY</Text>
            <Text style={[styles.pillValue, { color: safetyColors.text }]}>{model.safetyPill.label}</Text>
          </View>
        ) : null}
        {model.massChip ? (
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>MASS</Text>
            <Text style={styles.pillValue}>{model.massChip}</Text>
          </View>
        ) : null}
        {model.fitChip ? (
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>FIT</Text>
            <Text style={styles.pillValue}>{model.fitChip}</Text>
          </View>
        ) : null}
        {model.materialChip ? (
          <View style={styles.pill}>
            <Text style={styles.pillLabel}>MATERIAL</Text>
            <Text style={styles.pillValue}>{model.materialChip}</Text>
          </View>
        ) : null}
      </View>

      {model.safetyPill?.detail ? (
        <Text style={styles.safetyDetail} numberOfLines={2}>{model.safetyPill.detail}</Text>
      ) : null}

      {model.dimensionRows.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>DIMENSIONS</Text>
          <View style={styles.dimensionGrid}>
            {model.dimensionRows.map((row) => (
              <View key={row.key} style={styles.dimensionCell}>
                <Text style={styles.dimensionLabel} numberOfLines={1}>
                  {row.label}{row.unit ? ` (${row.unit})` : ''}
                </Text>
                <Text style={styles.dimensionValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {model.notes.length > 0 ? (
        <>
          <Pressable onPress={() => setNotesOpen((open) => !open)} style={styles.notesToggle}>
            <Text style={styles.sectionTitle}>
              NOTES {notesOpen ? '▾' : `▸ ${model.notes.length}`}
            </Text>
          </Pressable>
          {notesOpen ? (
            <View style={styles.notesList}>
              {model.notes.map((note, index) => (
                <Text key={`note-${index}`} style={styles.noteText}>• {note}</Text>
              ))}
            </View>
          ) : null}
        </>
      ) : null}

      {model.nextSteps.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>NEXT STEPS</Text>
          <View style={styles.nextStepRow}>
            {model.nextSteps.map((step) => (
              <Pressable
                key={step.id}
                onPress={onSeedCommand ? () => onSeedCommand(step.seedCommand) : undefined}
                disabled={!onSeedCommand}
                style={[styles.nextStepChip, !onSeedCommand && styles.nextStepChipDisabled]}
              >
                <Text style={styles.nextStepChipText}>{step.label.toUpperCase()}</Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
    </View>
  );
}

function CalcCard({ model, accentColor }: { model: EngineeringCalcCardModel; accentColor: string }) {
  return (
    <View style={[styles.card, { borderColor: `${accentColor}30` }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: accentColor }]}>ENGINEERING CALC</Text>
        {model.truncated ? <Text style={styles.truncatedTag}>TRIMMED</Text> : null}
      </View>
      <Text style={styles.partTitle}>{model.title}</Text>
      <Text style={styles.calcAnswer}>{model.answer}</Text>
      {model.formula ? <Text style={styles.calcFormula}>{model.formula}</Text> : null}

      {model.inputRows.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>INPUTS</Text>
          <View style={styles.dimensionGrid}>
            {model.inputRows.map((row) => (
              <View key={row.key} style={styles.dimensionCell}>
                <Text style={styles.dimensionLabel} numberOfLines={1}>
                  {row.label}{row.unit ? ` (${row.unit})` : ''}
                </Text>
                <Text style={styles.dimensionValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {model.extraRows.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>DERIVED</Text>
          <View style={styles.dimensionGrid}>
            {model.extraRows.map((row) => (
              <View key={row.key} style={styles.dimensionCell}>
                <Text style={styles.dimensionLabel} numberOfLines={1}>
                  {row.label}{row.unit ? ` (${row.unit})` : ''}
                </Text>
                <Text style={styles.dimensionValue}>{row.value}</Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      {model.notes.length > 0 ? (
        <View style={styles.notesList}>
          {model.notes.map((note, index) => (
            <Text key={`note-${index}`} style={styles.noteText}>• {note}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export default function EngineeringDesignCard({ model, accentColor, onSeedCommand }: Props) {
  if (!model) return null;
  if (model.kind === 'design') {
    return <DesignCard model={model} accentColor={accentColor} onSeedCommand={onSeedCommand} />;
  }
  return <CalcCard model={model} accentColor={accentColor} />;
}

const styles = StyleSheet.create({
  card: {
    marginTop: 10,
    borderWidth: 1,
    borderRadius: 12,
    backgroundColor: '#0a1018',
    padding: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  truncatedTag: {
    color: '#64748b',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    fontFamily: 'monospace',
  },
  partTitle: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 3,
  },
  chipRail: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 9,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pillLabel: {
    color: '#64748b',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    fontFamily: 'monospace',
  },
  pillValue: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '900',
  },
  safetyDetail: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
    marginTop: 6,
  },
  sectionTitle: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.8,
    fontFamily: 'monospace',
    marginBottom: 6,
    marginTop: 10,
  },
  dimensionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  dimensionCell: {
    flexBasis: '48%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  dimensionLabel: {
    color: '#64748b',
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 0.4,
  },
  dimensionValue: {
    color: '#e2e8f0',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 2,
  },
  calcAnswer: {
    color: '#86efac',
    fontSize: 15,
    fontWeight: '900',
    marginTop: 4,
    fontFamily: 'monospace',
  },
  calcFormula: {
    color: '#64748b',
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 4,
  },
  notesToggle: {
    alignSelf: 'flex-start',
  },
  notesList: {
    gap: 4,
    marginTop: 4,
  },
  noteText: {
    color: '#94a3b8',
    fontSize: 10,
    lineHeight: 14,
  },
  nextStepRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  nextStepChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#22d3ee66',
    backgroundColor: '#0891b222',
  },
  nextStepChipDisabled: {
    opacity: 0.6,
  },
  nextStepChipText: {
    color: '#cffafe',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
});
