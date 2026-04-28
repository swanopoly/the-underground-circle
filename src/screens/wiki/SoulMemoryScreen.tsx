import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { deleteMemory, editMemory } from '../../lib/agentMemory';
import { type MemoryEntry } from '../../lib/agentRunSystem';
import { getSpiritById } from '../../lib/agentSpirits';
import { getSpiritMemoryEntries } from '../../lib/memoryService';
import { findRelatedMemories } from '../../lib/memoryEmbeddings';

type RelatedMemory = Awaited<ReturnType<typeof findRelatedMemories>>[number];

function formatRelativeDate(value?: string | null): string {
  if (!value) return 'unknown';
  const ageMs = Date.now() - new Date(value).getTime();
  const hours = ageMs / 3_600_000;
  if (hours < 24) return 'today';
  const days = hours / 24;
  if (days < 7) return `${Math.max(1, Math.round(days))}d ago`;
  if (days < 30) return `${Math.max(1, Math.round(days / 7))}w ago`;
  return `${Math.max(1, Math.round(days / 30))}mo ago`;
}

export default function SoulMemoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const spiritId = route.params?.spiritId as string | undefined;
  const circleId = route.params?.circleId as string | undefined;
  const userId = route.params?.userId as string | undefined;
  const spirit = spiritId ? getSpiritById(spiritId) : undefined;

  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  // Per-memory related-pane state. Keyed by memory id so multiple cards
  // can be expanded independently. Lazy-loaded on first expand.
  const [relatedById, setRelatedById] = useState<Record<string, RelatedMemory[] | 'loading'>>({});

  const load = useCallback(async () => {
    if (!circleId || !userId || !spiritId) {
      setMemories([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const rows = await getSpiritMemoryEntries({
        circleId,
        userId,
        spiritId,
        query,
        limit: 24,
      });
      setMemories(rows);
    } catch {
      setMemories([]);
    }
    setLoading(false);
  }, [circleId, userId, spiritId, query]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => ({
    total: memories.length,
    startup: memories.filter((mem) => mem.retrieval_mode === 'startup').length,
    strong: memories.filter((mem) => (mem.importance || 0) >= 0.75).length,
  }), [memories]);

  const handleDelete = useCallback(async (memoryId: string) => {
    await deleteMemory(memoryId);
    await load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!editingId || !editContent.trim()) return;
    await editMemory(editingId, { content: editContent.trim() });
    setEditingId(null);
    setEditContent('');
    await load();
  }, [editContent, editingId, load]);

  const handleToggleRelated = useCallback(async (memoryId: string) => {
    const current = relatedById[memoryId];
    // Already loaded — collapse by removing the entry.
    if (Array.isArray(current)) {
      setRelatedById(prev => {
        const next = { ...prev };
        delete next[memoryId];
        return next;
      });
      return;
    }
    // Already loading — ignore second tap.
    if (current === 'loading') return;
    setRelatedById(prev => ({ ...prev, [memoryId]: 'loading' }));
    const neighbors = await findRelatedMemories({ memoryId, circleId, limit: 5 });
    setRelatedById(prev => ({ ...prev, [memoryId]: neighbors }));
  }, [relatedById, circleId]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.kicker}>SOUL MEMORY</Text>
          <Text style={styles.title}>{spirit?.name || spiritId || 'Unknown SOUL'}</Text>
          <Text style={styles.subtitle}>
            Private memory aligned to this spirit. This is what OpenSwan can pull in when the active SOUL matches the task.
          </Text>
        </View>
        <Pressable onPress={() => navigation.goBack()} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>CLOSE</Text>
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>TOTAL</Text>
          <Text style={styles.statValue}>{stats.total}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>STARTUP</Text>
          <Text style={styles.statValue}>{stats.startup}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>STRONG</Text>
          <Text style={styles.statValue}>{stats.strong}</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search this SOUL's memory..."
          placeholderTextColor="#64748b"
          style={styles.searchInput}
        />
      </View>

      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {loading ? <ActivityIndicator color="#818cf8" style={{ marginTop: 40 }} /> : null}
        {!loading && memories.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No SOUL memory found</Text>
            <Text style={styles.emptySubtitle}>
              This spirit has not accumulated matching private memory yet, or the current search is too narrow.
            </Text>
          </View>
        ) : null}

        {!loading ? memories.map((memory) => {
          const isEditing = editingId === memory.id;
          return (
            <View key={memory.id} style={styles.memoryCard}>
              <View style={styles.memoryTopRow}>
                <Text style={styles.memoryTitle}>{memory.title}</Text>
                <Text style={styles.memoryMeta}>
                  {(memory.memory_kind || 'finding').toUpperCase()} • {(memory.retrieval_mode || 'on_demand').toUpperCase()} • {formatRelativeDate(memory.updated_at || memory.created_at)}
                </Text>
              </View>
              <Text style={styles.memoryMetaSecondary}>
                importance {(memory.importance || 0).toFixed(2)}{memory.metadata?.capabilityProfile ? ` • ${String(memory.metadata.capabilityProfile).toUpperCase()}` : ''}{memory.metadata?.impactDomain ? ` • ${String(memory.metadata.impactDomain).toUpperCase()}` : ''}
              </Text>

              {isEditing ? (
                <>
                  <TextInput
                    value={editContent}
                    onChangeText={setEditContent}
                    multiline
                    style={styles.editInput}
                    placeholderTextColor="#64748b"
                  />
                  <View style={styles.actionRow}>
                    <Pressable onPress={handleSave} style={styles.primaryAction}>
                      <Text style={styles.primaryActionText}>SAVE</Text>
                    </Pressable>
                    <Pressable onPress={() => { setEditingId(null); setEditContent(''); }} style={styles.secondaryAction}>
                      <Text style={styles.secondaryActionText}>CANCEL</Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.memoryContent}>{memory.content}</Text>
                  <View style={styles.actionRow}>
                    <Pressable onPress={() => { setEditingId(memory.id); setEditContent(memory.content); }} style={styles.secondaryAction}>
                      <Text style={styles.secondaryActionText}>EDIT</Text>
                    </Pressable>
                    <Pressable onPress={() => { void handleToggleRelated(memory.id); }} style={styles.secondaryAction}>
                      <Text style={styles.secondaryActionText}>
                        {Array.isArray(relatedById[memory.id])
                          ? 'HIDE RELATED'
                          : relatedById[memory.id] === 'loading'
                            ? 'LOADING…'
                            : 'RELATED'}
                      </Text>
                    </Pressable>
                    <Pressable onPress={() => { void handleDelete(memory.id); }} style={styles.dangerAction}>
                      <Text style={styles.dangerActionText}>DELETE</Text>
                    </Pressable>
                  </View>
                  {Array.isArray(relatedById[memory.id]) && (
                    <View style={styles.relatedPane}>
                      <Text style={styles.relatedHeader}>RELATED MEMORIES</Text>
                      {(relatedById[memory.id] as RelatedMemory[]).length === 0 ? (
                        <Text style={styles.relatedEmpty}>No semantically nearby memories yet.</Text>
                      ) : (
                        (relatedById[memory.id] as RelatedMemory[]).map((rel) => (
                          <View key={rel.id} style={styles.relatedRow}>
                            <View style={styles.relatedMeta}>
                              <Text style={styles.relatedKind}>{(rel.memory_kind || 'finding').toUpperCase()}</Text>
                              <Text style={styles.relatedSimilarity}>{Math.round((rel.similarity || 0) * 100)}% match</Text>
                            </View>
                            <Text style={styles.relatedTitle} numberOfLines={1}>{rel.title}</Text>
                            <Text style={styles.relatedContent} numberOfLines={2}>{rel.content}</Text>
                          </View>
                        ))
                      )}
                    </View>
                  )}
                </>
              )}
            </View>
          );
        }) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#020617',
    paddingHorizontal: 18,
    paddingTop: 24,
    paddingBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  headerCopy: {
    flex: 1,
    gap: 6,
  },
  kicker: {
    color: '#818cf8',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
  },
  title: {
    color: '#f8fafc',
    fontSize: 28,
    fontWeight: '900',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 760,
  },
  closeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeButtonText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '800',
  },
  statsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  statCard: {
    flex: 1,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  statLabel: {
    color: '#64748b',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1,
  },
  statValue: {
    color: '#e2e8f0',
    fontSize: 22,
    fontWeight: '900',
    marginTop: 4,
  },
  searchRow: {
    marginTop: 16,
  },
  searchInput: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0f172a',
    color: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 11,
    fontSize: 13,
  },
  list: {
    flex: 1,
    marginTop: 16,
  },
  listContent: {
    paddingBottom: 32,
    gap: 12,
  },
  emptyState: {
    marginTop: 48,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: '#e2e8f0',
    fontSize: 18,
    fontWeight: '800',
  },
  emptySubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 520,
    lineHeight: 19,
  },
  memoryCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#312e81',
    backgroundColor: '#0f172a',
    padding: 14,
    gap: 8,
  },
  memoryTopRow: {
    gap: 4,
  },
  memoryTitle: {
    color: '#e0e7ff',
    fontSize: 15,
    fontWeight: '800',
  },
  memoryMeta: {
    color: '#94a3b8',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  memoryMetaSecondary: {
    color: '#7c8aa0',
    fontSize: 11,
  },
  memoryContent: {
    color: '#dbe4f0',
    fontSize: 13,
    lineHeight: 20,
  },
  editInput: {
    minHeight: 110,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#020617',
    color: '#e2e8f0',
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: 'top',
    fontSize: 13,
    lineHeight: 20,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  primaryAction: {
    borderRadius: 999,
    backgroundColor: '#4f46e5',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  primaryActionText: {
    color: '#eef2ff',
    fontSize: 11,
    fontWeight: '800',
  },
  secondaryAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0b1220',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryActionText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '800',
  },
  dangerAction: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: '#2a0f16',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  dangerActionText: {
    color: '#fca5a5',
    fontSize: 11,
    fontWeight: '800',
  },
  relatedPane: {
    marginTop: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
    backgroundColor: '#0a0f1c',
    padding: 10,
    gap: 8,
  },
  relatedHeader: {
    color: '#22d3ee',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.5,
    fontFamily: 'monospace',
  },
  relatedEmpty: {
    color: '#64748b',
    fontSize: 11,
    fontStyle: 'italic',
  },
  relatedRow: {
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    gap: 3,
  },
  relatedMeta: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  relatedKind: {
    color: '#94a3b8',
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  relatedSimilarity: {
    color: '#22d3ee',
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  relatedTitle: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '700',
  },
  relatedContent: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
  },
});
