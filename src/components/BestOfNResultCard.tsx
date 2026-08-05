import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PersistedBestOfNRace } from '../lib/persistedChatMetadata';

/**
 * BestOfNResultCard — interactive render of a `/bestof` race result.
 *
 * Cursor's Best-of-N makes you read worktree diffs to adopt a winner; here
 * every candidate is one tap to adopt. The race summary is persisted with the
 * completion message (persistedChatMetadata `bestOfN`), so the card works on
 * the live message and after reload alike. Adopting fires through the
 * parent's normal send path — this card renders text only and never executes
 * anything (race candidates are text-only generations).
 */

interface Props {
  race: PersistedBestOfNRace;
  accentColor?: string;
  /** Adopt a candidate's answer as the reply (0-based candidate index). */
  onAdopt?: (candidateIndex: number) => void;
  /** Re-run the race (the parent re-issues the /bestof command). */
  onRaceAgain?: () => void;
}

export default function BestOfNResultCard({
  race,
  accentColor = '#22c55e',
  onAdopt,
  onRaceAgain,
}: Props) {
  const [expandedRows, setExpandedRows] = useState<Record<number, boolean>>({});
  const candidates = race.candidates || [];
  if (candidates.length === 0) return null;

  const toggleRow = (index: number) =>
    setExpandedRows((previous) => ({ ...previous, [index]: !previous[index] }));

  const webCursor = Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null;

  return (
    <View style={[styles.container, { borderColor: accentColor + '33' }]}>
      <Text style={styles.header} numberOfLines={2}>
        {`🏁 Best-of-${candidates.length} — ${race.task}`}
      </Text>
      {candidates.map((candidate, index) => {
        const isWinner = race.winnerIndex === index;
        const isExpanded = !!expandedRows[index];
        const metaBits = [
          candidate.ok ? 'ok' : 'failed',
          `${candidate.durationMs}ms`,
          candidate.score !== null ? `score ${candidate.score}` : null,
        ].filter(Boolean) as string[];
        return (
          <View
            key={`${index}-${candidate.model.slice(0, 24)}`}
            style={[
              styles.row,
              isWinner && [styles.winnerRow, { borderColor: accentColor + '55' }],
            ]}
          >
            <View
              style={[
                styles.numberBubble,
                { backgroundColor: accentColor + '22' },
                isWinner && [styles.winnerBubble, { borderColor: accentColor }],
              ]}
            >
              <Text style={[styles.numberText, { color: accentColor }]}>
                {isWinner ? '★' : index + 1}
              </Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.model} numberOfLines={1}>{candidate.model}</Text>
              <Text
                style={[styles.meta, !candidate.ok && styles.metaFailed]}
                numberOfLines={1}
              >
                {metaBits.join(' · ')}
              </Text>
              {candidate.note ? (
                <Text style={styles.note} numberOfLines={2}>{candidate.note}</Text>
              ) : null}
              {candidate.text ? (
                <Pressable onPress={() => toggleRow(index)} style={webCursor}>
                  <Text
                    style={styles.preview}
                    numberOfLines={isExpanded ? undefined : 3}
                  >
                    {candidate.text}
                  </Text>
                  <Text style={[styles.expandHint, { color: accentColor }]}>
                    {isExpanded ? 'Collapse ▲' : 'Expand ▼'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {candidate.ok && onAdopt ? (
              <Pressable
                onPress={() => onAdopt(index)}
                style={({ hovered }: any) => [
                  styles.actionButton,
                  { borderColor: accentColor + '66' },
                  hovered && { backgroundColor: accentColor + '18' },
                  webCursor,
                ]}
              >
                <Text style={[styles.actionText, { color: accentColor }]}>Adopt</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
      <View style={styles.footerRow}>
        <Text style={styles.footer}>
          {onAdopt || onRaceAgain
            ? 'Adopting posts that answer as the reply. Race again with /bestof.'
            : 'Saved candidates from this earlier race. Expand any answer to review it.'}
        </Text>
        {onRaceAgain ? (
          <Pressable
            onPress={onRaceAgain}
            style={({ hovered }: any) => [
              styles.actionButton,
              { borderColor: accentColor + '66' },
              hovered && { backgroundColor: accentColor + '18' },
              webCursor,
            ]}
          >
            <Text style={[styles.actionText, { color: accentColor }]}>Race again</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    backgroundColor: '#0b130b',
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    gap: 2,
  },
  header: {
    color: '#9fb29b',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    marginBottom: 4,
    marginLeft: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  winnerRow: {
    backgroundColor: '#0d150d',
  },
  numberBubble: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  winnerBubble: {
    borderWidth: 1,
  },
  numberText: {
    fontSize: 11,
    fontWeight: '800',
  },
  rowText: {
    flex: 1,
  },
  model: {
    color: '#e6efe2',
    fontSize: 12,
    fontWeight: '700',
  },
  meta: {
    color: '#8fd8b4',
    fontSize: 11,
    marginTop: 1,
  },
  metaFailed: {
    color: '#d9a08c',
  },
  note: {
    color: '#8e9f8e',
    fontSize: 11,
    marginTop: 1,
  },
  preview: {
    color: '#a7b6a2',
    fontSize: 11,
    marginTop: 3,
  },
  expandHint: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  actionButton: {
    borderWidth: 1,
    borderRadius: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    marginTop: 2,
    alignSelf: 'flex-start',
  },
  actionText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  footer: {
    flex: 1,
    color: '#6f7f6f',
    fontSize: 10,
    marginLeft: 2,
  },
});
