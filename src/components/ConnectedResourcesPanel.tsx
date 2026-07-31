/**
 * ConnectedResourcesPanel — the user-facing "What's connected" panel.
 *
 * The agent gets a per-turn Connected Resources prompt block; this is the
 * matching USER view: one collapsed summary line (Integrations N · Vault
 * logins N · Google ✓/✗ · Provider keys N) that expands into four rows, each
 * expandable to its bounded name list and a "Connect more →" action.
 *
 * Pure presentation: the model comes from `buildConnectedResourcesPanel`
 * (connectedResourcesPanelCore — secret-safe, names only). Navigation is the
 * host's job via `onConnect(row)` — on web the idiom is the `uc:switch-tab`
 * CustomEvent with `row.connectAction.targetTab`.
 *
 * Styling matches the Marketplace (IntegrationsTab) idiom: dark monospace
 * cards on #0d1018 with #1b2433 borders.
 */

import React, { useMemo, useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import {
  buildConnectedResourcesPanel,
  type ConnectedResourcePanelRow,
  type ConnectedResourcePanelTone,
} from '../lib/connectedResourcesPanelCore';
import type { ConnectedResourcesInput } from '../lib/connectedResourcesDigest';

const TONE_COLORS: Record<ConnectedResourcePanelTone, string> = {
  connected: '#22c55e',
  partial: '#f59e0b',
  empty: '#64748b',
};

interface ConnectedResourcesPanelProps {
  /** The structured snapshot from `loadConnectedResourcesSnapshot()` (or null while loading). */
  input: ConnectedResourcesInput | null | undefined;
  /** Host navigation hook — e.g. dispatch `uc:switch-tab` with `row.connectAction.targetTab`. */
  onConnect?: (row: ConnectedResourcePanelRow) => void;
  /** Start with the row list open (default: collapsed summary line only). */
  initiallyExpanded?: boolean;
}

export default function ConnectedResourcesPanel({
  input,
  onConnect,
  initiallyExpanded = false,
}: ConnectedResourcesPanelProps) {
  const model = useMemo(() => buildConnectedResourcesPanel(input), [input]);
  const [open, setOpen] = useState(initiallyExpanded);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <View style={styles.shell}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={styles.header}
        accessibilityRole="button"
        accessibilityLabel={`What's connected. ${model.summaryLine}. ${open ? 'Collapse' : 'Expand'}`}
      >
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>WHAT'S CONNECTED</Text>
          <Text style={styles.summaryLine} numberOfLines={1}>{model.summaryLine}</Text>
        </View>
        <Text style={styles.chevron}>{open ? '▾' : '▸'}</Text>
      </Pressable>

      {open && (
        <View style={styles.rowStack}>
          {model.rows.map((row) => {
            const expanded = expandedKey === row.key;
            const toneColor = TONE_COLORS[row.tone];
            return (
              <View key={row.key} style={styles.rowCard}>
                <Pressable
                  onPress={() => setExpandedKey(expanded ? null : row.key)}
                  style={styles.rowHead}
                  accessibilityRole="button"
                  accessibilityLabel={`${row.title}: ${row.countLabel}. ${expanded ? 'Collapse' : 'Expand'}`}
                >
                  <Text style={styles.rowIcon}>{row.icon}</Text>
                  <Text style={styles.rowTitle}>{row.title}</Text>
                  <View style={[styles.tonePip, { backgroundColor: toneColor }]} />
                  <Text style={[styles.countLabel, { color: toneColor }]} numberOfLines={1}>
                    {row.countLabel}
                  </Text>
                  <Text style={styles.rowChevron}>{expanded ? '▾' : '▸'}</Text>
                </Pressable>
                {expanded && (
                  <View style={styles.rowBody}>
                    {row.items.length > 0 ? (
                      <View style={styles.itemWrap}>
                        {row.items.map((item, idx) => (
                          <View key={`${row.key}-${idx}`} style={styles.itemChip}>
                            <Text style={styles.itemChipText} numberOfLines={1}>{item}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={styles.emptyText}>Nothing here yet — your agent can't use this surface until it's connected.</Text>
                    )}
                    <Pressable
                      onPress={() => onConnect?.(row)}
                      style={styles.connectBtn}
                      accessibilityRole="button"
                      accessibilityLabel={`${row.title}: ${row.connectAction.label}`}
                    >
                      <Text style={styles.connectBtnText}>{row.connectAction.label}</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: '#0d1018',
    borderWidth: 1,
    borderColor: '#1b2433',
    borderRadius: 14,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 10,
  },
  headerLeft: { flex: 1, gap: 4 },
  headerTitle: {
    color: '#7d8798',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1.1,
  },
  summaryLine: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  chevron: {
    color: '#93a0b4',
    fontSize: 13,
    fontFamily: 'monospace',
  },
  rowStack: {
    borderTopWidth: 1,
    borderTopColor: '#161d2b',
    padding: 10,
    gap: 8,
  },
  rowCard: {
    backgroundColor: '#0a0e15',
    borderWidth: 1,
    borderColor: '#161d2b',
    borderRadius: 10,
    overflow: 'hidden',
  },
  rowHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowIcon: { fontSize: 13 },
  rowTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: 'monospace',
    flex: 1,
  },
  tonePip: { width: 7, height: 7, borderRadius: 4 },
  countLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
    maxWidth: 220,
  },
  rowChevron: {
    color: '#64748b',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  rowBody: {
    borderTopWidth: 1,
    borderTopColor: '#141a26',
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
  },
  itemWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  itemChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#232734',
    backgroundColor: '#0d1018',
    paddingHorizontal: 10,
    paddingVertical: 5,
    maxWidth: 260,
  },
  itemChipText: {
    color: '#93a0b4',
    fontSize: 11,
    fontFamily: 'monospace',
    fontWeight: '700',
  },
  emptyText: {
    color: '#7d8798',
    fontSize: 11,
    lineHeight: 17,
    fontFamily: 'monospace',
  },
  connectBtn: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3b82f6',
    backgroundColor: '#1b2333',
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  connectBtnText: {
    color: '#dbeafe',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: 'monospace',
  },
});
