/**
 * AccountabilityDigestCard — compact agent-work accountability summary for the
 * Digest surface. Renders the pure output of
 * accountabilityDigestCore.buildAccountabilityDigest: one stat row
 * (runs · verified % · PRs · completed) plus short highlight lines.
 *
 * Purely presentational: hides itself when the digest is null/empty, never
 * fetches. Styling follows the DigestTab idiom (Card, uppercase section
 * labels, muted stat labels).
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Card from '../Card';
import {
  isEmptyAccountabilityDigest,
  type AccountabilityDigest,
} from '../../lib/accountabilityDigestCore';

interface Props {
  digest: AccountabilityDigest | null;
}

export default function AccountabilityDigestCard({ digest }: Props) {
  if (!digest || isEmptyAccountabilityDigest(digest)) return null;

  const { counts, highlights, windowLabel } = digest;
  const verifiedPct =
    counts.runs > 0 ? Math.round((counts.verifiedRuns / counts.runs) * 100) : 0;

  return (
    <Card style={s.card}>
      <View style={s.titleRow}>
        <Text style={s.title}>THIS WEEK · AGENT WORK</Text>
        <Text style={s.window}>{windowLabel.toUpperCase()}</Text>
      </View>

      <View style={s.statsRow}>
        <Stat value={String(counts.runs)} label="RUNS" />
        <Dot />
        <Stat
          value={`${verifiedPct}%`}
          label="VERIFIED"
          color={counts.runs === 0 ? '#666' : verifiedPct >= 100 ? '#22c55e' : '#e89b3e'}
        />
        <Dot />
        <Stat value={String(counts.prReferences)} label="PRS" />
        <Dot />
        <Stat value={String(counts.tasksCompleted)} label="COMPLETED" />
      </View>

      {highlights.length > 0 && (
        <View style={s.highlights}>
          {highlights.map((line, i) => (
            <Text key={i} style={s.highlightText}>
              {'· '}
              {line}
            </Text>
          ))}
        </View>
      )}
    </Card>
  );
}

function Stat({ value, label, color }: { value: string; label: string; color?: string }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statNum, color ? { color } : null]}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function Dot() {
  return <Text style={s.dot}>·</Text>;
}

const s = StyleSheet.create({
  card: {
    marginBottom: 16,
    padding: 14,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  title: {
    color: '#666',
    fontSize: 11,
    letterSpacing: 2,
    fontWeight: '700',
  },
  window: {
    color: '#444',
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: '700',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stat: {
    alignItems: 'center',
    flex: 1,
  },
  statNum: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '900',
  },
  statLabel: {
    color: '#666',
    fontSize: 9,
    letterSpacing: 1,
    fontWeight: '700',
    marginTop: 2,
  },
  dot: {
    color: '#333',
    fontSize: 14,
    paddingHorizontal: 2,
  },
  highlights: {
    marginTop: 10,
    gap: 2,
  },
  highlightText: {
    color: '#8a8a9e',
    fontSize: 12,
    lineHeight: 17,
  },
});
