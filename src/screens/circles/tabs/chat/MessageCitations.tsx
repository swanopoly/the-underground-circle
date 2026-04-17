/**
 * MessageCitations — Phase M5. Shows a "Used N memories" pill under
 * assistant messages. Tapping expands a drawer listing the cited memories
 * with kind, title, content, and a "not helpful" decay button.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { type MemoryCitation, loadCitationsForMessage, decayMemoryImportance } from '../../../../lib/memoryActions';

interface Props {
  userId: string;
  messageTimestamp: string;
  nextMessageTimestamp?: string;
  accentColor?: string;
}

export default function MessageCitations({ userId, messageTimestamp, nextMessageTimestamp, accentColor = '#22d3ee' }: Props) {
  const [citations, setCitations] = useState<MemoryCitation[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [decayed, setDecayed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!userId || !messageTimestamp) return;
    const after = messageTimestamp;
    const before = nextMessageTimestamp || new Date(new Date(messageTimestamp).getTime() + 30_000).toISOString();
    const result = await loadCitationsForMessage({ userId, surface: 'main_chat', after, before });
    setCitations(result.length > 0 ? result : null);
  }, [userId, messageTimestamp, nextMessageTimestamp]);

  useEffect(() => { void load(); }, [load]);

  if (!citations || citations.length === 0) return null;

  const handleDecay = async (memoryId: string) => {
    await decayMemoryImportance(memoryId);
    setDecayed(prev => new Set(prev).add(memoryId));
  };

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setExpanded(v => !v)} style={styles.pill}>
        <Text style={[styles.pillText, { color: accentColor }]}>
          {expanded ? '▾' : '▸'} Used {citations.length} memor{citations.length === 1 ? 'y' : 'ies'}
        </Text>
      </Pressable>

      {expanded && (
        <View style={styles.drawer}>
          {citations.map((c, i) => (
            <View key={`${c.memoryId}-${i}`} style={styles.row}>
              <View style={styles.rowMeta}>
                <Text style={[styles.kindBadge, { borderColor: accentColor }]}>{c.memoryKind.toUpperCase()}</Text>
                {c.soulKey && <Text style={styles.soulTag}>{c.soulKey.replace('soul:', '')}</Text>}
              </View>
              <Text style={styles.title}>{c.title}</Text>
              <Text style={styles.content} numberOfLines={2}>{c.content}</Text>
              <View style={styles.rowActions}>
                {decayed.has(c.memoryId) ? (
                  <Text style={styles.decayedLabel}>importance reduced</Text>
                ) : (
                  <Pressable onPress={() => handleDecay(c.memoryId)} style={styles.decayBtn}>
                    <Text style={styles.decayBtnText}>not helpful</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4, marginBottom: 2 },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  pillText: { fontSize: 10, fontWeight: '800', fontFamily: 'monospace', letterSpacing: 0.4 },
  drawer: { marginTop: 4, gap: 6, paddingLeft: 4 },
  row: {
    padding: 8, borderRadius: 6, borderWidth: 1, borderColor: '#1e293b',
    backgroundColor: '#0b1220', gap: 3,
  },
  rowMeta: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  kindBadge: {
    fontSize: 8, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, borderWidth: 1,
    color: '#94a3b8',
  },
  soulTag: { fontSize: 9, fontWeight: '700', color: '#64748b', fontFamily: 'monospace' },
  title: { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },
  content: { fontSize: 10, color: '#94a3b8', lineHeight: 14 },
  rowActions: { flexDirection: 'row', marginTop: 2 },
  decayBtn: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
    borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a',
  },
  decayBtnText: { fontSize: 9, fontWeight: '800', color: '#f59e0b', fontFamily: 'monospace' },
  decayedLabel: { fontSize: 9, color: '#475569', fontFamily: 'monospace' },
});
