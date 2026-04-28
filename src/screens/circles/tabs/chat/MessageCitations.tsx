/**
 * MessageCitations — Phase M5. Shows a "Used N memories" pill under
 * assistant messages. Tapping expands a drawer listing the cited memories
 * with kind, title, content, and reinforce / not-helpful actions.
 *
 * Lookup strategy:
 *   - If `assistantMessageDbId` is provided, use the get_memory_citations
 *     RPC (keyed by message_id, reliable).
 *   - Otherwise fall back to the timestamp-window query for older
 *     messages whose access_log rows predate the message_id linkage.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  type MemoryCitation,
  loadCitationsForMessage,
  loadCitationsByAssistantMessage,
  decayMemoryImportance,
  recordMemoryFeedback,
} from '../../../../lib/memoryActions';

interface Props {
  userId: string;
  messageTimestamp: string;
  nextMessageTimestamp?: string;
  assistantMessageDbId?: string;
  accentColor?: string;
}

type RowFeedback = 'reinforced' | 'decayed' | null;

export default function MessageCitations({
  userId,
  messageTimestamp,
  nextMessageTimestamp,
  assistantMessageDbId,
  accentColor = '#22d3ee',
}: Props) {
  const [citations, setCitations] = useState<MemoryCitation[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [feedback, setFeedback] = useState<Record<string, RowFeedback>>({});

  const load = useCallback(async () => {
    if (!userId || !messageTimestamp) return;
    let result: MemoryCitation[] = [];
    if (assistantMessageDbId) {
      result = await loadCitationsByAssistantMessage(assistantMessageDbId);
    }
    if (result.length === 0) {
      const after = messageTimestamp;
      const before = nextMessageTimestamp || new Date(new Date(messageTimestamp).getTime() + 30_000).toISOString();
      result = await loadCitationsForMessage({ userId, surface: 'main_chat', after, before });
    }
    setCitations(result.length > 0 ? result : null);
  }, [userId, messageTimestamp, nextMessageTimestamp, assistantMessageDbId]);

  useEffect(() => { void load(); }, [load]);

  if (!citations || citations.length === 0) return null;

  const handleReinforce = async (memoryId: string) => {
    setFeedback(prev => ({ ...prev, [memoryId]: 'reinforced' }));
    await recordMemoryFeedback({
      memoryId,
      action: 'confirmed_helpful',
      source: 'citation_pill',
      userId,
    });
  };

  const handleDecay = async (memoryId: string) => {
    setFeedback(prev => ({ ...prev, [memoryId]: 'decayed' }));
    await Promise.all([
      decayMemoryImportance(memoryId),
      recordMemoryFeedback({
        memoryId,
        action: 'not_helpful',
        source: 'citation_pill',
        userId,
      }),
    ]);
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
          {citations.map((c, i) => {
            const state = feedback[c.memoryId] || null;
            return (
              <View key={`${c.memoryId}-${i}`} style={styles.row}>
                <View style={styles.rowMeta}>
                  <Text style={[styles.kindBadge, { borderColor: accentColor }]}>{c.memoryKind.toUpperCase()}</Text>
                  {c.soulKey && <Text style={styles.soulTag}>{c.soulKey.replace('soul:', '')}</Text>}
                  <Text style={styles.importance}>importance {Math.round((c.importance || 0) * 100)}%</Text>
                </View>
                <Text style={styles.title}>{c.title}</Text>
                <Text style={styles.content} numberOfLines={3}>{c.content}</Text>
                <View style={styles.rowActions}>
                  {state === 'reinforced' && <Text style={styles.feedbackLabel}>helpful — reinforced</Text>}
                  {state === 'decayed' && <Text style={styles.feedbackLabel}>importance reduced</Text>}
                  {state === null && (
                    <>
                      <Pressable onPress={() => handleReinforce(c.memoryId)} style={[styles.actionBtn, { borderColor: accentColor + '60' }]}>
                        <Text style={[styles.actionBtnText, { color: accentColor }]}>helpful</Text>
                      </Pressable>
                      <Pressable onPress={() => handleDecay(c.memoryId)} style={styles.decayBtn}>
                        <Text style={styles.decayBtnText}>not helpful</Text>
                      </Pressable>
                    </>
                  )}
                </View>
              </View>
            );
          })}
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
  rowMeta: { flexDirection: 'row', gap: 6, alignItems: 'center', flexWrap: 'wrap' },
  kindBadge: {
    fontSize: 8, fontWeight: '900', letterSpacing: 0.6, fontFamily: 'monospace',
    paddingHorizontal: 5, paddingVertical: 2, borderRadius: 3, borderWidth: 1,
    color: '#94a3b8',
  },
  soulTag: { fontSize: 9, fontWeight: '700', color: '#64748b', fontFamily: 'monospace' },
  importance: { fontSize: 9, fontWeight: '700', color: '#475569', fontFamily: 'monospace' },
  title: { fontSize: 11, fontWeight: '700', color: '#e2e8f0' },
  content: { fontSize: 10, color: '#94a3b8', lineHeight: 14 },
  rowActions: { flexDirection: 'row', gap: 6, marginTop: 2 },
  actionBtn: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
    borderWidth: 1, backgroundColor: '#0f172a',
  },
  actionBtnText: { fontSize: 9, fontWeight: '800', fontFamily: 'monospace' },
  decayBtn: {
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3,
    borderWidth: 1, borderColor: '#334155', backgroundColor: '#0f172a',
  },
  decayBtnText: { fontSize: 9, fontWeight: '800', color: '#f59e0b', fontFamily: 'monospace' },
  feedbackLabel: { fontSize: 9, color: '#475569', fontFamily: 'monospace' },
});
