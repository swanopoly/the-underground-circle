/**
 * RunHistoryFilterBar — compact search + status-pill + rollup-stats bar for
 * the Run History drawer sidebar. Presentation-only: all filtering/stat logic
 * lives in the pure runHistoryFilterCore (formatRunHistoryStatsLine renders
 * the stats line so it stays smoke-pinnable).
 *
 * Styling mirrors RunHistoryDrawer's idiom (dark #0b1220 surfaces, #1e293b
 * borders, monospace 9pt pill text, #38bdf8/#22d3ee accents).
 */

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  formatRunHistoryStatsLine,
  type RunHistoryStats,
  type RunStatusFilter,
} from '../../lib/runHistoryFilterCore';

type Props = {
  query: string;
  onQueryChange: (next: string) => void;
  statusFilter: RunStatusFilter;
  onStatusFilterChange: (next: RunStatusFilter) => void;
  stats: RunHistoryStats;
};

const STATUS_PILLS: Array<{ key: RunStatusFilter; label: string }> = [
  { key: 'all', label: 'ALL' },
  { key: 'running', label: 'RUNNING' },
  { key: 'succeeded', label: 'DONE' },
  { key: 'failed', label: 'FAILED' },
  { key: 'other', label: 'OTHER' },
];

export default function RunHistoryFilterBar({
  query,
  onQueryChange,
  statusFilter,
  onStatusFilterChange,
  stats,
}: Props) {
  return (
    <View style={styles.container}>
      <Text style={styles.statsLine}>{formatRunHistoryStatsLine(stats)}</Text>
      <TextInput
        value={query}
        onChangeText={onQueryChange}
        placeholder="Search runs…"
        placeholderTextColor="#475569"
        style={styles.searchInput}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <View style={styles.pillRow}>
        {STATUS_PILLS.map((pill) => {
          const active = statusFilter === pill.key;
          return (
            <Pressable
              key={pill.key}
              onPress={() => onStatusFilterChange(pill.key)}
              style={[styles.pill, active && styles.pillActive]}
            >
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{pill.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
    marginBottom: 8,
  },
  statsLine: {
    color: '#7dd3fc',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.4,
    fontFamily: 'monospace',
  },
  searchInput: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0b1220',
    color: '#e2e8f0',
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0b1220',
  },
  pillActive: {
    borderColor: '#38bdf8',
    backgroundColor: '#082f49',
  },
  pillText: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 0.6,
    fontFamily: 'monospace',
  },
  pillTextActive: {
    color: '#7dd3fc',
  },
});
