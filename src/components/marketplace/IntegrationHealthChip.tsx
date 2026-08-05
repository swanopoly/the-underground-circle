/**
 * IntegrationHealthChip — the honest replacement for the hardcoded green
 * "Connected" pip on Marketplace integration cards (the silent-bad-key trust
 * bug). Renders the badge computed by `buildIntegrationHealthBadge`:
 *
 *   ● Key rejected (401)          ← tone dot + label (tap to expand)
 *   Re-paste the key or check…    ← expandable bounded detail line
 *   [ Re-test key ]               ← optional, when badge.showRetest && onRetest
 *
 * Pure presentation: all policy (tone/label/detail/secret-scrubbing) lives in
 * `src/lib/integrationHealthBadgeCore.ts`. Styling mirrors IntegrationsTab's
 * statusBadge / statusDot / statusLabel so the chip drops into the existing
 * card top-right without visual drift.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { IntegrationHealthBadge, IntegrationHealthTone } from '../../lib/integrationHealthBadgeCore';

const TONE_COLORS: Record<IntegrationHealthTone, string> = {
  ok: '#22c55e',
  warn: '#f59e0b',
  danger: '#ef4444',
};

export interface IntegrationHealthChipProps {
  badge: IntegrationHealthBadge;
  /** Wire to a fresh key probe; button renders only when badge.showRetest. */
  onRetest?: () => void;
  /** Start with the detail line visible (e.g. right after a failed save). */
  initiallyExpanded?: boolean;
}

export default function IntegrationHealthChip({
  badge,
  onRetest,
  initiallyExpanded = false,
}: IntegrationHealthChipProps) {
  const [expanded, setExpanded] = useState(!!initiallyExpanded);
  const color = TONE_COLORS[badge.tone] || TONE_COLORS.warn;
  const expandable = !!badge.detail;

  return (
    <View style={styles.wrap}>
      <Pressable
        disabled={!expandable}
        onPress={() => setExpanded(prev => !prev)}
        accessibilityRole={expandable ? 'button' : undefined}
        accessibilityLabel={`Integration health: ${badge.label}`}
        style={[
          styles.chip,
          { backgroundColor: `${color}15`, borderColor: `${color}30` },
        ]}
      >
        <View style={[styles.dot, { backgroundColor: color }]} />
        <Text style={[styles.label, { color }]} numberOfLines={1}>
          {badge.label}
        </Text>
        {expandable ? (
          <Text style={[styles.caret, { color }]}>{expanded ? '▾' : '▸'}</Text>
        ) : null}
      </Pressable>

      {expanded && badge.detail ? (
        <Text style={styles.detail}>{badge.detail}</Text>
      ) : null}

      {badge.showRetest && onRetest ? (
        <Pressable
          onPress={onRetest}
          accessibilityRole="button"
          accessibilityLabel="Re-test key"
          style={[styles.retestButton, { borderColor: `${color}40` }]}
        >
          <Text style={[styles.retestText, { color }]}>Re-test key</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'flex-end',
    gap: 4,
    maxWidth: 220,
  },
  // Mirrors IntegrationsTab styles.statusBadge (tone colors injected inline).
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  // Mirrors styles.statusDot.
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  // Mirrors styles.statusLabel.
  label: {
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '600',
    flexShrink: 1,
  },
  caret: {
    fontSize: 9,
    fontWeight: '700',
  },
  detail: {
    color: '#93a0b4',
    fontSize: 11,
    lineHeight: 15,
    textAlign: 'right',
  },
  retestButton: {
    paddingVertical: 3,
    paddingHorizontal: 9,
    borderRadius: 14,
    borderWidth: 1,
    backgroundColor: '#0c1018',
  },
  retestText: {
    fontSize: 10,
    fontFamily: 'monospace',
    fontWeight: '700',
    letterSpacing: 0.4,
  },
});
