/**
 * BuildConversationBadge — compact chip that shows when a thread has an
 * active conversational-build state (exploring / converging). Renders
 * nothing on `idle` so it doesn't clutter every normal chat.
 *
 * Goal: the user can always see that the bot is in build-discovery mode,
 * what it's reasoning about, and tap "Cancel" to drop back to normal
 * chat instantly — no cooldown, no magic phrase.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BuildConversationRecord } from '../lib/conversationalBuild';

interface Props {
  record: BuildConversationRecord;
  onCancel: () => void;
  /** Fires when the user taps "Start" while in the `converging` state.
   *  The caller launches the workbench with `record.brief`. */
  onConfirm?: () => void;
}

export default function BuildConversationBadge({ record, onCancel, onConfirm }: Props) {
  if (record.state === 'idle' || record.state === 'confirmed') return null;

  const isConverging = record.state === 'converging';
  const accent = isConverging ? '#22c55e' : '#f59e0b';
  const label = isConverging ? 'Brief proposed' : 'Exploring build';
  const helper = isConverging
    ? 'Reply yes / go to start, or tell the bot what to change.'
    : 'Bot is gathering details before scaffolding anything.';

  return (
    <View style={[styles.wrap, { borderColor: `${accent}40`, backgroundColor: `${accent}10` }]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={[styles.label, { color: accent }]}>{label}</Text>
        {isConverging && onConfirm ? (
          <Pressable onPress={onConfirm} style={[styles.confirmBtn, { backgroundColor: accent }]} accessibilityRole="button">
            <Text style={styles.confirmBtnText}>Start</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={onCancel} style={styles.cancelBtn} accessibilityRole="button">
          <Text style={styles.cancelBtnText}>Cancel</Text>
        </Pressable>
      </View>
      {record.topic ? (
        <Text style={styles.topic} numberOfLines={2}>
          Topic: {record.topic}
        </Text>
      ) : null}
      <Text style={styles.helper} numberOfLines={2}>
        {helper}
      </Text>
      {isConverging && record.brief ? (
        <Text style={styles.brief} numberOfLines={3}>
          {record.brief}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 6,
    ...(Platform.OS === 'web' ? { transition: 'background-color 0.2s ease, border-color 0.2s ease' } as any : {}),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  label: {
    flex: 1,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  confirmBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  confirmBtnText: {
    color: '#0a0a0a',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  cancelBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cancelBtnText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  helper: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
  },
  topic: {
    color: '#cbd5e1',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
  },
  brief: {
    color: '#e2e8f0',
    fontSize: 11,
    lineHeight: 16,
    fontFamily: Platform.OS === 'web' ? 'ui-monospace, SFMono-Regular, Menlo, monospace' : 'monospace',
    marginTop: 2,
  },
});
