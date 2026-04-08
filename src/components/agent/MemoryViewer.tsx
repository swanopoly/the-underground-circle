/**
 * MemoryViewer — Shows what the AI agent remembers, with edit/delete controls.
 * Renders as a collapsible panel in the chat.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import type { MemoryEntry } from '../../lib/agentRunSystem';

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const KIND_COLORS: Record<string, string> = {
  preference: '#a855f7',
  fact: '#6366f1',
  decision: '#f59e0b',
  finding: '#22c55e',
  instruction: '#ec4899',
  policy: '#3b82f6',
  context: '#606075',
};

interface Props {
  circleId: string;
  userId?: string;
  accentColor?: string;
  onClose: () => void;
}

export default function MemoryViewer({ circleId, userId, accentColor = '#6366f1', onClose }: Props) {
  const [memories, setMemories] = useState<{ circle: MemoryEntry[]; user: MemoryEntry[]; session: MemoryEntry[]; total: number }>({ circle: [], user: [], session: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'all' | 'circle' | 'user' | 'session'>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemoryEntry[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { getUserMemories } = await import('../../lib/agentMemory');
      const data = await getUserMemories(circleId, userId);
      setMemories(data);
    } catch {}
    setLoading(false);
  }, [circleId, userId]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (memoryId: string) => {
    try {
      const { deleteMemory } = await import('../../lib/agentMemory');
      await deleteMemory(memoryId);
      load();
    } catch {}
  };

  const handleEdit = async (memoryId: string) => {
    if (!editContent.trim()) return;
    try {
      const { editMemory } = await import('../../lib/agentMemory');
      await editMemory(memoryId, { content: editContent.trim() });
      setEditingId(null);
      load();
    } catch {}
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    try {
      const { searchMemories } = await import('../../lib/agentMemory');
      const results = await searchMemories(circleId, searchQuery.trim());
      setSearchResults(results);
    } catch {}
  };

  const displayMemories = searchResults || (
    activeTab === 'circle' ? memories.circle :
    activeTab === 'user' ? memories.user :
    activeTab === 'session' ? memories.session :
    [...memories.circle, ...memories.user, ...memories.session]
  );

  const renderMemory = (mem: MemoryEntry, i: number) => {
    const kindColor = KIND_COLORS[mem.memory_kind] || '#606075';
    const isEditing = editingId === mem.id;

    return (
      <View key={mem.id} style={s.memoryCard}>
        <View style={s.memoryHeader}>
          <View style={[s.kindBadge, { backgroundColor: kindColor + '20', borderColor: kindColor + '40' }]}>
            <Text style={[s.kindBadgeText, { color: kindColor }]}>{mem.memory_kind.toUpperCase()}</Text>
          </View>
          <View style={[s.scopeBadge, { backgroundColor: '#1a1a28' }]}>
            <Text style={s.scopeBadgeText}>{mem.scope}</Text>
          </View>
          <Text style={s.memoryDate}>{new Date(mem.created_at).toLocaleDateString()}</Text>
        </View>
        <Text style={s.memoryTitle}>{mem.title}</Text>
        {isEditing ? (
          <View style={{ gap: 4 }}>
            <TextInput
              value={editContent}
              onChangeText={setEditContent}
              style={s.editInput}
              multiline
              autoFocus
            />
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <Pressable onPress={() => handleEdit(mem.id)} style={[s.actionBtn, { backgroundColor: '#22c55e20', borderColor: '#22c55e40' }]}>
                <Text style={[s.actionBtnText, { color: '#22c55e' }]}>Save</Text>
              </Pressable>
              <Pressable onPress={() => setEditingId(null)} style={[s.actionBtn, { backgroundColor: '#1a1a28' }]}>
                <Text style={[s.actionBtnText, { color: '#606075' }]}>Cancel</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={s.memoryContent}>{mem.content}</Text>
        )}
        {!isEditing && (
          <View style={s.memoryActions}>
            <Pressable
              onPress={() => { setEditingId(mem.id); setEditContent(mem.content); }}
              style={[s.actionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={[s.actionBtnText, { color: '#a0a0b0' }]}>Edit</Text>
            </Pressable>
            <Pressable
              onPress={() => handleDelete(mem.id)}
              style={[s.actionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
            >
              <Text style={[s.actionBtnText, { color: '#ef4444' }]}>Delete</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={s.container}>
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Agent Memory</Text>
        <Text style={s.headerCount}>{memories.total} memories</Text>
        <Pressable onPress={onClose} style={[s.closeBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
          <Text style={s.closeBtnText}>X</Text>
        </Pressable>
      </View>

      {/* Search */}
      <View style={s.searchRow}>
        <TextInput
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          placeholder="Search memories..."
          placeholderTextColor="#3a3a4e"
          style={s.searchInput}
          returnKeyType="search"
        />
        {searchResults && (
          <Pressable onPress={() => { setSearchQuery(''); setSearchResults(null); }} style={[s.actionBtn, Platform.OS === 'web' && { cursor: 'pointer' } as any]}>
            <Text style={[s.actionBtnText, { color: '#a0a0b0' }]}>Clear</Text>
          </Pressable>
        )}
      </View>

      {/* Tabs */}
      <View style={s.tabRow}>
        {(['all', 'circle', 'user', 'session'] as const).map(tab => (
          <Pressable
            key={tab}
            onPress={() => { setActiveTab(tab); setSearchResults(null); }}
            style={[s.tab, activeTab === tab && { borderBottomColor: accentColor, borderBottomWidth: 2 }, Platform.OS === 'web' && { cursor: 'pointer' } as any]}
          >
            <Text style={[s.tabText, activeTab === tab && { color: accentColor }]}>
              {tab === 'all' ? 'All' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'circle' ? ` (${memories.circle.length})` :
               tab === 'user' ? ` (${memories.user.length})` :
               tab === 'session' ? ` (${memories.session.length})` :
               ` (${memories.total})`}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Memory list */}
      <ScrollView style={s.list} nestedScrollEnabled showsVerticalScrollIndicator>
        {loading ? (
          <ActivityIndicator color={accentColor} style={{ padding: 20 }} />
        ) : displayMemories.length === 0 ? (
          <Text style={s.emptyText}>
            {searchResults ? 'No memories match your search.' : 'No memories yet. The agent will start remembering as you chat.'}
          </Text>
        ) : (
          displayMemories.map(renderMemory)
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { backgroundColor: '#0a0a10', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, maxHeight: 500, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderBottomWidth: 1, borderBottomColor: '#1a1a28' },
  headerTitle: { color: '#f0f0f5', fontSize: 12, fontWeight: '700', fontFamily: MONO },
  headerCount: { color: '#3a3a4e', fontSize: 10, fontFamily: MONO },
  closeBtn: { marginLeft: 'auto', width: 22, height: 22, borderRadius: 2, backgroundColor: '#1a1a28', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: '#2a2a3e' },
  closeBtnText: { color: '#606075', fontSize: 10, fontWeight: '700' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#1a1a28' },
  searchInput: { flex: 1, color: '#f0f0f5', fontSize: 11, fontFamily: MONO, paddingVertical: 4, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any,
  tabRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#1a1a28' },
  tab: { flex: 1, paddingVertical: 6, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { color: '#606075', fontSize: 9, fontWeight: '600', fontFamily: MONO },
  list: { maxHeight: 380, padding: 8 },
  emptyText: { color: '#3a3a4e', fontSize: 10, fontFamily: MONO, fontStyle: 'italic', padding: 16, textAlign: 'center' },
  memoryCard: { backgroundColor: '#0f0f18', borderWidth: 1, borderColor: '#1a1a28', borderRadius: 2, padding: 8, marginBottom: 6 },
  memoryHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  kindBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2, borderWidth: 1 },
  kindBadgeText: { fontSize: 7, fontWeight: '700', fontFamily: MONO },
  scopeBadge: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' },
  scopeBadgeText: { color: '#606075', fontSize: 7, fontWeight: '600', fontFamily: MONO },
  memoryDate: { color: '#3a3a4e', fontSize: 8, fontFamily: MONO, marginLeft: 'auto' },
  memoryTitle: { color: '#a0a0b0', fontSize: 11, fontWeight: '600', fontFamily: MONO, marginBottom: 2 },
  memoryContent: { color: '#808090', fontSize: 10, fontFamily: MONO, lineHeight: 15 },
  memoryActions: { flexDirection: 'row', gap: 4, marginTop: 4 },
  actionBtn: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 2, borderWidth: 1, borderColor: '#2a2a3e' },
  actionBtnText: { fontSize: 8, fontWeight: '700', fontFamily: MONO },
  editInput: { color: '#f0f0f5', fontSize: 10, fontFamily: MONO, backgroundColor: '#05050a', borderWidth: 1, borderColor: '#2a2a3e', borderRadius: 2, padding: 6, minHeight: 40, ...(Platform.OS === 'web' ? { outlineStyle: 'none' } : {}) } as any,
});
