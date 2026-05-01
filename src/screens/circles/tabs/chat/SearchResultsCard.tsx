/**
 * SearchResultsCard — renders `/search <query>` results as a list of
 * clickable rows. Tapping a row jumps the chat list to that message
 * and flashes a highlight ring.
 *
 * Why a card instead of flat text: the original `/search` handler
 * dumped 10 results into a bot-message blob — readable but not
 * navigable. Real chat tools (Slack, Linear) make every result a
 * clickable target so users can move from "I remembered we talked
 * about X" to "I'm now reading that exact thread" in one tap.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View, Platform } from 'react-native';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export interface SearchResultRow {
  /** id is the chat message id when the result is from the in-memory
   *  list. May be undefined for older messages we can't link to —
   *  in that case the row renders without a JUMP button. */
  id?: string;
  authorName: string;
  isBot: boolean;
  snippet: string;
  timestamp: string;
}

interface Props {
  query: string;
  results: SearchResultRow[];
  onJump: (messageId: string) => void;
  accentColor?: string;
}

export default function SearchResultsCard({ query, results, onJump, accentColor = '#94a3b8' }: Props) {
  return (
    <View style={[s.card, { borderColor: accentColor + '40' }]} nativeID="section-chat-search-results">
      <View style={s.header}>
        <Text style={[s.kicker, { color: accentColor }]}>SEARCH RESULTS</Text>
        <Text style={s.count}>{results.length} match{results.length === 1 ? '' : 'es'}</Text>
      </View>
      <Text style={s.queryLine}>
        for <Text style={s.queryValue}>"{query}"</Text>
      </Text>
      {results.length === 0 ? (
        <Text style={s.empty}>No messages matched.</Text>
      ) : (
        <View style={s.rows}>
          {results.map((r, idx) => (
            <View key={(r.id || 'noid') + ':' + idx} style={s.row}>
              <View style={s.rowHead}>
                <Text style={[s.author, r.isBot && { color: '#a855f7' }]}>{r.authorName}</Text>
                <Text style={s.timestamp}>{r.timestamp}</Text>
              </View>
              <Text style={s.snippet} numberOfLines={2}>{r.snippet}</Text>
              {r.id ? (
                <Pressable
                  onPress={() => onJump(r.id!)}
                  style={({ pressed }) => [
                    s.jumpBtn,
                    { borderColor: accentColor + '60' },
                    pressed && { backgroundColor: accentColor + '20' },
                  ]}
                  accessibilityLabel={`Jump to message from ${r.authorName}`}
                >
                  <Text style={[s.jumpText, { color: accentColor }]}>JUMP →</Text>
                </Pressable>
              ) : (
                <Text style={s.archived}>(archived — can't jump)</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: '#0a0f1c',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { fontSize: 9, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  count: { fontSize: 9, color: '#64748b', fontFamily: MONO },
  queryLine: { color: '#94a3b8', fontSize: 11, marginBottom: 4 },
  queryValue: { color: '#e2e8f0', fontWeight: '700' },
  empty: { color: '#64748b', fontStyle: 'italic', fontSize: 12, paddingVertical: 6 },
  rows: { gap: 8 },
  row: {
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#1e293b',
    borderRadius: 8,
    padding: 8,
    gap: 4,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  author: { color: '#cbd5e1', fontSize: 11, fontWeight: '700' },
  timestamp: { color: '#64748b', fontSize: 9, fontFamily: MONO },
  snippet: { color: '#94a3b8', fontSize: 12, lineHeight: 17 },
  jumpBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    marginTop: 2,
  },
  jumpText: { fontSize: 9, fontWeight: '900', letterSpacing: 1, fontFamily: MONO },
  archived: { color: '#475569', fontSize: 10, fontStyle: 'italic' },
});
