/**
 * WebSearchStatusChip — small toolbar indicator that mirrors the
 * shape and density of `DesktopBridgeStatusChip`, but flips a
 * per-circle boolean instead of pairing a bridge.
 *
 * Two states:
 *   - WEB OFF — toggle is off (default). Tap to turn on.
 *   - WEB ON  — chat composer routes the next message through
 *               OpenRouter with `openrouter:web_search` attached.
 *
 * Lives next to the DESKTOP chip so the composer footer is one
 * compact row of capability indicators rather than competing UI in
 * the toolbar above.
 */

import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

interface Props {
  enabled: boolean;
  onToggle: () => void;
  /** Accent color matches `DesktopBridgeStatusChip` so the active
   *  state reads consistently across capability chips. */
  accentColor?: string;
}

export default function WebSearchStatusChip({ enabled, onToggle, accentColor = '#22c55e' }: Props) {
  if (Platform.OS !== 'web') return null;
  const dot = enabled ? accentColor : '#475569';
  const textColor = enabled ? accentColor : '#64748b';
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={`Web search: ${enabled ? 'on' : 'off'}`}
      style={({ hovered }: any) => [
        styles.chip,
        hovered && ({ backgroundColor: '#0f172a' } as any),
        Platform.OS === 'web' && ({ cursor: 'pointer' } as any),
      ]}
    >
      <View style={[styles.dot, { backgroundColor: dot }]} />
      <Text style={styles.labelText}>WEB</Text>
      <Text style={[styles.stateText, { color: textColor }]}>{enabled ? 'ON' : 'OFF'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 999 },
  labelText: {
    color: '#475569',
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
  },
  stateText: {
    fontFamily: 'monospace',
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
});
