import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PersistedComputerFindings } from '../lib/persistedChatMetadata';

/**
 * ChatComputerFindingsCard — inline render of a browser run's structured
 * findings (Phase 3a of docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md).
 *
 * WI-4 persisted these findings and WI-5 resolves "book option 2" against
 * them, but the options themselves only rendered in RunHistoryDrawer — so
 * the user was offered numbered follow-ups without being able to see what
 * the numbers were. This card shows the numbered options inline on the
 * completion message; tapping one fires the same follow-up text the user
 * would have typed, through the parent's normal send path.
 */

interface Props {
  findings: PersistedComputerFindings;
  accentColor?: string;
  /** Fires the WI-5 follow-up for a 1-based option number. */
  onPickOption?: (optionNumber: number) => void;
}

function hostOf(url: string | undefined): string | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const match = raw.match(/^[a-z]+:\/\/([^/]+)/i);
  return match ? match[1].replace(/^www\./i, '') : null;
}

export default function ChatComputerFindingsCard({ findings, accentColor = '#22c55e', onPickOption }: Props) {
  const items = findings.items || [];
  if (items.length === 0) return null;

  return (
    <View style={[styles.container, { borderColor: accentColor + '33' }]}>
      <Text style={styles.header}>Options found ({items.length})</Text>
      {items.map((item, index) => {
        const host = hostOf(item.url);
        const metaBits = [item.price, item.rating, host].filter(Boolean) as string[];
        return (
          <Pressable
            key={`${index}-${item.title.slice(0, 24)}`}
            onPress={onPickOption ? () => onPickOption(index + 1) : undefined}
            disabled={!onPickOption}
            style={({ hovered }: any) => [
              styles.row,
              hovered && onPickOption && { backgroundColor: accentColor + '10' },
              Platform.OS === 'web' && onPickOption && ({ cursor: 'pointer' } as any),
            ]}
          >
            <View style={[styles.numberBubble, { backgroundColor: accentColor + '22' }]}>
              <Text style={[styles.numberText, { color: accentColor }]}>{index + 1}</Text>
            </View>
            <View style={styles.rowText}>
              <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
              {metaBits.length > 0 ? (
                <Text style={styles.meta} numberOfLines={1}>{metaBits.join(' · ')}</Text>
              ) : null}
              {item.notes ? (
                <Text style={styles.notes} numberOfLines={2}>{item.notes}</Text>
              ) : null}
            </View>
            {onPickOption ? (
              <Text style={[styles.pickHint, { color: accentColor }]}>Book</Text>
            ) : null}
          </Pressable>
        );
      })}
      <Text style={styles.footer}>
        {onPickOption
          ? 'Tap an option, or say “book option 2” — the choices are saved with this message, so follow-ups work later too.'
          : 'Saved options from this earlier run. Start a new request to act on them.'}
      </Text>
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
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
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
  },
  numberBubble: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  numberText: {
    fontSize: 11,
    fontWeight: '800',
  },
  rowText: {
    flex: 1,
  },
  title: {
    color: '#e6efe2',
    fontSize: 12,
    fontWeight: '700',
  },
  meta: {
    color: '#8fd8b4',
    fontSize: 11,
    marginTop: 1,
  },
  notes: {
    color: '#8e9f8e',
    fontSize: 11,
    marginTop: 1,
  },
  pickHint: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 3,
  },
  footer: {
    color: '#6f7f6f',
    fontSize: 10,
    marginTop: 4,
    marginLeft: 2,
  },
});
