/**
 * TrainingPrivacySettings.tsx — User opt-out controls for BlackSwan training data
 *
 * Lets users control whether their data is used to improve the BlackSwan AI.
 * Granular field-level opt-out for specific data types.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, Switch } from 'react-native';
import { supabase } from '../lib/supabase';

// ─── Data categories users can opt out of ────────────────────────────────────

const DATA_FIELDS = [
  { key: 'messages',   label: 'Chat Messages',     desc: 'Circle chat conversations' },
  { key: 'check_ins',  label: 'Check-ins',         desc: 'Daily check-in content' },
  { key: 'tasks',      label: 'Tasks',             desc: 'Task titles and descriptions' },
  { key: 'terminal',   label: 'Terminal Commands',  desc: 'Command center history' },
  { key: 'goals',      label: 'Goals & Intentions', desc: 'North Star journal entries' },
] as const;

type DataFieldKey = typeof DATA_FIELDS[number]['key'];

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  userId: string;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function TrainingPrivacySettings({ userId }: Props) {
  const [optOut, setOptOut] = useState(false);
  const [optOutFields, setOptOutFields] = useState<DataFieldKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Load current settings
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('training_opt_out, training_opt_out_fields')
        .eq('id', userId)
        .single();

      if (data) {
        setOptOut(data.training_opt_out ?? false);
        setOptOutFields((data.training_opt_out_fields as DataFieldKey[]) ?? []);
      }
      setLoading(false);
    })();
  }, [userId]);

  // Save handler.
  //
  // This is a CONSENT control, so an optimistic toggle that silently fails is
  // the worst possible outcome: the switch reads "opted out" while the data
  // keeps being used for training. supabase-js resolves with `{ error }`
  // rather than throwing, so the write must be checked explicitly, and the UI
  // must fall back to the real stored value when it did not land.
  const save = useCallback(async (
    newOptOut: boolean,
    newFields: DataFieldKey[],
    revert: () => void,
  ) => {
    setSaving(true);
    setSaveError(null);
    const { error } = await supabase
      .from('profiles')
      .update({
        training_opt_out: newOptOut,
        training_opt_out_fields: newFields,
      })
      .eq('id', userId);
    setSaving(false);
    if (error) {
      revert();
      setSaveError('Could not save — your preference was NOT changed. Please try again.');
    }
  }, [userId]);

  // Toggle master opt-out
  const toggleOptOut = useCallback((value: boolean) => {
    const prev = optOut;
    setOptOut(value);
    save(value, optOutFields, () => setOptOut(prev));
  }, [optOut, optOutFields, save]);

  // Toggle individual field
  const toggleField = useCallback((field: DataFieldKey) => {
    const prev = optOutFields;
    const next = prev.includes(field)
      ? prev.filter(f => f !== field)
      : [...prev, field];
    setOptOutFields(next);
    save(optOut, next, () => setOptOutFields(prev));
  }, [optOut, optOutFields, save]);

  if (loading) return null;

  return (
    <View style={styles.container}>
      {/* Header */}
      <Pressable style={styles.header} onPress={() => setExpanded(!expanded)}>
        <View style={styles.headerLeft}>
          <Text style={styles.icon}>🦢</Text>
          <View>
            <Text style={styles.title}>BlackSwan AI Training</Text>
            <Text style={styles.subtitle}>
              {optOut ? 'Opted out' : 'Helping improve BlackSwan'}
            </Text>
          </View>
        </View>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          {/* Explanation */}
          <Text style={styles.explainText}>
            Your data helps BlackSwan learn and get smarter over time. All data is
            anonymized before training. You can opt out completely or exclude specific
            data types.
          </Text>

          {/* Master toggle */}
          <View style={styles.toggleRow}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleLabel}>Help improve BlackSwan AI</Text>
              <Text style={styles.toggleDesc}>
                {optOut ? 'Your data is excluded from training' : 'Your data helps BlackSwan learn'}
              </Text>
            </View>
            <Switch
              value={!optOut}
              onValueChange={(v) => toggleOptOut(!v)}
              trackColor={{ false: '#27272a', true: '#22c55e33' }}
              thumbColor={optOut ? '#52525b' : '#22c55e'}
            />
          </View>

          {/* Granular controls (only shown when not fully opted out) */}
          {!optOut && (
            <>
              <View style={styles.divider} />
              <Text style={styles.sectionTitle}>EXCLUDE SPECIFIC DATA</Text>

              {DATA_FIELDS.map(field => {
                const isExcluded = optOutFields.includes(field.key);
                return (
                  <Pressable
                    key={field.key}
                    style={styles.fieldRow}
                    onPress={() => toggleField(field.key)}
                  >
                    <View style={[styles.checkbox, isExcluded && styles.checkboxActive]}>
                      {isExcluded && <Text style={styles.checkmark}>✕</Text>}
                    </View>
                    <View style={styles.fieldInfo}>
                      <Text style={[styles.fieldLabel, isExcluded && styles.fieldLabelExcluded]}>
                        {field.label}
                      </Text>
                      <Text style={styles.fieldDesc}>{field.desc}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </>
          )}

          {saving && (
            <Text style={styles.savingText}>Saving...</Text>
          )}
          {!saving && saveError && (
            <Text style={styles.saveErrorText}>{saveError}</Text>
          )}
        </View>
      )}
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: { fontSize: 20 },
  title: {
    color: '#e5e5e5',
    fontSize: 13,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  subtitle: {
    color: '#52525b',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  chevron: {
    color: '#52525b',
    fontSize: 14,
  },
  body: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#000000',
  },
  explainText: {
    color: '#71717a',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 10,
    marginBottom: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  toggleInfo: { flex: 1, marginRight: 12 },
  toggleLabel: {
    color: '#e5e5e5',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  toggleDesc: {
    color: '#52525b',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: '#000000',
    marginVertical: 10,
  },
  sectionTitle: {
    color: '#3f3f46',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: {
    backgroundColor: '#ef444415',
    borderColor: '#ef4444',
  },
  checkmark: {
    color: '#ef4444',
    fontSize: 10,
    fontWeight: '700',
  },
  fieldInfo: { flex: 1 },
  fieldLabel: {
    color: '#a1a1aa',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  fieldLabelExcluded: {
    color: '#52525b',
    textDecorationLine: 'line-through',
  },
  fieldDesc: {
    color: '#3f3f46',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  savingText: {
    color: '#6366f1',
    fontSize: 9,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  saveErrorText: {
    color: '#f87171',
    fontSize: 9,
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
