/**
 * MemoryViewer — OpenSwan memory inbox + memory library.
 *
 * Full-width, style-guide-aligned governance surface for:
 * - newly learned cross-agent knowledge
 * - quick memory capture
 * - search, edit, prune, and consolidation
 * - approve/pin/promote/forget actions on learned memory
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, Platform, ActivityIndicator } from 'react-native';
import type { MemoryEntry } from '../../lib/agentRunSystem';
import { supabase } from '../../lib/supabase';
import {
  decayMemoryImportance,
  markMemoryReviewState,
  pinMemory,
  promoteMemory,
  recordMemoryFeedback,
  softDeleteMemory,
} from '../../lib/memoryActions';
import { routeExistingMemoryToSoulKnowledge } from '../../lib/memoryService';

const MONO = 'monospace';

const KIND_COLORS: Record<string, string> = {
  preference: '#a855f7',
  fact: '#22d3ee',
  decision: '#f59e0b',
  finding: '#22c55e',
  instruction: '#ec4899',
  policy: '#3b82f6',
  context: '#888888',
};

interface Props {
  circleId: string;
  userId?: string;
  accentColor?: string;
  onClose: () => void;
}

type MemoryBuckets = {
  circle: MemoryEntry[];
  user: MemoryEntry[];
  session: MemoryEntry[];
  total: number;
};

type ViewerTab = 'inbox' | 'all' | 'circle' | 'user' | 'session';

function providerLabel(mem: MemoryEntry): string | null {
  switch (mem.source_surface) {
    case 'claude_code_bridge': return 'Claude Code';
    case 'codex_bridge': return 'Codex';
    case 'cursor_bridge': return 'Cursor';
    case 'gemini_bridge': return 'Gemini';
    default: return null;
  }
}

function memoryStateLabel(mem: MemoryEntry): string {
  const review = String(mem.metadata?.review_status || '');
  if (review === 'accepted') return 'accepted';
  if (review === 'dismissed') return 'dismissed';
  if ((mem as any).pinned) return 'pinned';
  if (mem.retrieval_mode === 'startup') return 'startup';
  return 'active';
}

function isInboxMemory(mem: MemoryEntry): boolean {
  const namespace = String(mem.metadata?.namespace || '');
  const source = String(mem.metadata?.source || '');
  const knowledgeKind = String(mem.metadata?.knowledgeKind || '');
  const reviewed = String(mem.metadata?.review_status || '');
  const provider = providerLabel(mem);
  if (!provider) return false;
  if (reviewed === 'dismissed') return false;
  return (
    namespace === 'external_agent_shared_pattern' ||
    namespace === 'external_agent_user_context' ||
    source === 'external_agent_session_promotion' ||
    knowledgeKind === 'shared_project_pattern' ||
    knowledgeKind === 'user_startup_context'
  );
}

function getAllMemories(memories: MemoryBuckets): MemoryEntry[] {
  return [...memories.circle, ...memories.user, ...memories.session];
}

export default function MemoryViewer({ circleId, userId, accentColor = '#22d3ee', onClose }: Props) {
  const [memories, setMemories] = useState<MemoryBuckets>({ circle: [], user: [], session: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ViewerTab>('inbox');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemoryEntry[] | null>(null);
  const [healthReport, setHealthReport] = useState<any>(null);
  const [consolidating, setConsolidating] = useState(false);
  const [newMemoryTitle, setNewMemoryTitle] = useState('');
  const [newMemoryContent, setNewMemoryContent] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { getUserMemories } = await import('../../lib/agentMemory');
      const data = await getUserMemories(circleId, userId);
      setMemories(data);
      try {
        const { getMemoryHealthReport } = await import('../../lib/memoryConsolidation');
        setHealthReport(await getMemoryHealthReport(circleId));
      } catch {}
    } catch {}
    setLoading(false);
  }, [circleId, userId]);

  useEffect(() => { load(); }, [load]);

  const allMemories = useMemo(() => getAllMemories(memories), [memories]);

  const inboxMemories = useMemo(
    () => allMemories
      .filter(isInboxMemory)
      .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()),
    [allMemories],
  );

  const displayMemories = useMemo(() => {
    if (searchResults) return searchResults;
    if (activeTab === 'inbox') return inboxMemories;
    if (activeTab === 'circle') return memories.circle;
    if (activeTab === 'user') return memories.user;
    if (activeTab === 'session') return memories.session;
    return allMemories;
  }, [searchResults, activeTab, inboxMemories, memories, allMemories]);

  const handleDelete = async (memoryId: string) => {
    if (!userId) return;
    await softDeleteMemory(memoryId, userId, 'memory_viewer_delete');
    await load();
  };

  const handleEdit = async (memoryId: string) => {
    if (!editContent.trim()) return;
    try {
      const { editMemory } = await import('../../lib/agentMemory');
      await editMemory(memoryId, { content: editContent.trim() });
      setEditingId(null);
      await load();
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

  const handleQuickSave = async (scope: 'circle' | 'user') => {
    if (!newMemoryContent.trim()) return;
    setSavingNote(true);
    try {
      const { saveMemory } = await import('../../lib/agentRunSystem');
      await saveMemory({
        scope,
        circleId,
        userId,
        memoryKind: 'fact',
        title: newMemoryTitle.trim() || `Quick note ${new Date().toLocaleDateString()}`,
        content: newMemoryContent.trim(),
        visibility: scope === 'circle' ? 'circle_shared' : 'private',
        importance: 0.65,
        retrievalMode: 'on_demand',
        sourceSurface: 'main_chat',
      } as any);
      setNewMemoryTitle('');
      setNewMemoryContent('');
      await load();
    } catch {}
    setSavingNote(false);
  };

  const handleInboxAccept = async (mem: MemoryEntry) => {
    await markMemoryReviewState(mem.id, 'accepted');
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'accepted',
      note: 'Accepted from memory inbox',
      userId,
      source: 'memory_inbox',
    });
    await routeExistingMemoryToSoulKnowledge({
      memoryId: mem.id,
      circleId,
      currentSoulKey: typeof mem.metadata?.soul_key === 'string' ? mem.metadata.soul_key : null,
    });
    await load();
  };

  const handleInboxPin = async (mem: MemoryEntry) => {
    await pinMemory(mem.id);
    await markMemoryReviewState(mem.id, 'pinned');
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'pinned',
      note: 'Pinned from memory inbox',
      userId,
      source: 'memory_inbox',
    });
    await routeExistingMemoryToSoulKnowledge({
      memoryId: mem.id,
      circleId,
      currentSoulKey: typeof mem.metadata?.soul_key === 'string' ? mem.metadata.soul_key : null,
    });
    await load();
  };

  const handleInboxPromote = async (mem: MemoryEntry) => {
    await promoteMemory(mem.id);
    await markMemoryReviewState(mem.id, 'promoted');
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'promoted',
      note: 'Promoted from memory inbox',
      userId,
      source: 'memory_inbox',
    });
    await routeExistingMemoryToSoulKnowledge({
      memoryId: mem.id,
      circleId,
      currentSoulKey: typeof mem.metadata?.soul_key === 'string' ? mem.metadata.soul_key : null,
    });
    await load();
  };

  const handleInboxDismiss = async (mem: MemoryEntry) => {
    await decayMemoryImportance(mem.id);
    await markMemoryReviewState(mem.id, 'dismissed');
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'dismissed',
      note: 'Dismissed from memory inbox',
      userId,
      source: 'memory_inbox',
    });
    await load();
  };

  const renderLibraryMemory = (mem: MemoryEntry) => {
    const kindColor = KIND_COLORS[mem.memory_kind] || '#888888';
    const isEditing = editingId === mem.id;
    return (
      <View key={mem.id} style={s.memoryCard}>
        <View style={s.cardTopRow}>
          <View style={[s.kindBadge, { borderColor: kindColor, backgroundColor: `${kindColor}12` }]}>
            <Text style={[s.kindBadgeText, { color: kindColor }]}>{mem.memory_kind.toUpperCase()}</Text>
          </View>
          <View style={s.metaBadge}>
            <Text style={s.metaBadgeText}>{String(mem.scope).toUpperCase()}</Text>
          </View>
          {providerLabel(mem) ? (
            <View style={[s.metaBadge, { borderColor: '#22d3ee', backgroundColor: '#22d3ee10' }]}>
              <Text style={[s.metaBadgeText, { color: '#22d3ee' }]}>{providerLabel(mem)!.toUpperCase()}</Text>
            </View>
          ) : null}
          <Text style={s.cardDate}>{new Date(mem.updated_at || mem.created_at).toLocaleDateString()}</Text>
        </View>
        <Text style={s.cardTitle}>{mem.title}</Text>
        {String(mem.metadata?.latestTask || '').trim() ? (
          <Text style={s.cardSubtext}>Focus: {String(mem.metadata?.latestTask)}</Text>
        ) : null}
        {isEditing ? (
          <View style={s.editWrap}>
            <TextInput
              value={editContent}
              onChangeText={setEditContent}
              style={s.editInput}
              multiline
              autoFocus
            />
            <View style={s.actionRow}>
              <Pressable onPress={() => handleEdit(mem.id)} style={({ hovered, pressed }: any) => [s.primaryBtn, hovered && webHoverPrimary, pressed && webPressed]}>
                <Text style={s.primaryBtnText}>SAVE</Text>
              </Pressable>
              <Pressable onPress={() => setEditingId(null)} style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}>
                <Text style={s.ghostBtnText}>CANCEL</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <Text style={s.cardBody}>{mem.content}</Text>
        )}
        {!isEditing ? (
          <View style={s.actionRow}>
            <Pressable onPress={() => { setEditingId(mem.id); setEditContent(mem.content); }} style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}>
              <Text style={s.ghostBtnText}>EDIT</Text>
            </Pressable>
            <Pressable onPress={() => handleDelete(mem.id)} style={({ hovered, pressed }: any) => [s.dangerBtn, hovered && webHoverDanger, pressed && webPressed]}>
              <Text style={s.dangerBtnText}>FORGET</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  };

  const renderInboxMemory = (mem: MemoryEntry) => {
    const provider = providerLabel(mem) || 'Agent';
    const project = String(mem.metadata?.projectDir || mem.metadata?.projectKey || '').split('/').filter(Boolean).pop() || 'project';
    const knowledgeKind = String(mem.metadata?.knowledgeKind || '');
    const review = memoryStateLabel(mem);
    return (
      <View key={mem.id} style={s.inboxCard}>
        <View style={s.cardTopRow}>
          <View style={[s.metaBadge, { borderColor: '#22d3ee', backgroundColor: '#22d3ee12' }]}>
            <Text style={[s.metaBadgeText, { color: '#22d3ee' }]}>{provider.toUpperCase()}</Text>
          </View>
          <View style={[s.metaBadge, { borderColor: '#ffffff', backgroundColor: '#ffffff' }]}>
            <Text style={[s.metaBadgeText, { color: '#000000' }]}>{knowledgeKind === 'user_startup_context' ? 'STARTUP' : 'LEARNED'}</Text>
          </View>
          <View style={s.metaBadge}>
            <Text style={s.metaBadgeText}>{review.toUpperCase()}</Text>
          </View>
          <Text style={s.cardDate}>{new Date(mem.updated_at || mem.created_at).toLocaleDateString()}</Text>
        </View>
        <Text style={s.cardTitle}>{mem.title}</Text>
        <Text style={s.cardSubtext}>Project: {project}</Text>
        {Array.isArray(mem.metadata?.recentTasks) && (mem.metadata?.recentTasks as any[]).length > 0 ? (
          <Text style={s.cardBody}>Tasks: {(mem.metadata?.recentTasks as any[]).slice(0, 3).join(' | ')}</Text>
        ) : null}
        <Text style={s.cardBody}>{mem.content}</Text>
        <View style={s.actionRow}>
          <Pressable onPress={() => handleInboxAccept(mem)} style={({ hovered, pressed }: any) => [s.primaryBtn, hovered && webHoverPrimary, pressed && webPressed]}>
            <Text style={s.primaryBtnText}>APPROVE</Text>
          </Pressable>
          <Pressable onPress={() => handleInboxPin(mem)} style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}>
            <Text style={s.ghostBtnText}>PIN</Text>
          </Pressable>
          <Pressable onPress={() => handleInboxPromote(mem)} style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}>
            <Text style={s.ghostBtnText}>PROMOTE</Text>
          </Pressable>
          <Pressable onPress={() => handleInboxDismiss(mem)} style={({ hovered, pressed }: any) => [s.dangerBtn, hovered && webHoverDanger, pressed && webPressed]}>
            <Text style={s.dangerBtnText}>DISMISS</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View style={s.headerCopy}>
          <Text style={s.headerLabel}>OPENSWAN MEMORY</Text>
          <Text style={s.headerTitle}>Knowledge inbox and long-term context</Text>
          <Text style={s.headerHint}>
            Review what OpenSwan learned from Codex, Claude Code, and your chats. Approve what should persist. Forget what should not.
          </Text>
        </View>
        <Pressable onPress={onClose} style={({ hovered, pressed }: any) => [s.closeBtn, hovered && webHoverGhost, pressed && webPressed]}>
          <Text style={s.closeBtnText}>CLOSE</Text>
        </Pressable>
      </View>

      <View style={s.topGrid}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>TOTAL MEMORY</Text>
          <Text style={s.statValue}>{memories.total}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>NEWLY LEARNED</Text>
          <Text style={[s.statValue, { color: '#22d3ee' }]}>{inboxMemories.length}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>AVG TRUST</Text>
          <Text style={[s.statValue, { color: healthReport?.avgTrustScore > 0.5 ? '#22c55e' : '#f59e0b' }]}>
            {healthReport ? `${(healthReport.avgTrustScore * 100).toFixed(0)}%` : '...'}
          </Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>STALE / CONFLICT</Text>
          <Text style={[s.statValue, { color: (healthReport?.stale || 0) > 0 || (healthReport?.contradictionRisk || 0) > 0.2 ? '#ef4444' : '#ffffff' }]}>
            {healthReport ? `${healthReport.stale} / ${(healthReport.contradictionRisk * 100).toFixed(0)}%` : '...'}
          </Text>
        </View>
      </View>

      <View style={s.utilityRow}>
        <View style={s.searchWrap}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            placeholder="SEARCH MEMORIES, PROJECTS, TASKS..."
            placeholderTextColor="#555555"
            style={s.searchInput}
            returnKeyType="search"
          />
          {searchResults ? (
            <Pressable onPress={() => { setSearchQuery(''); setSearchResults(null); }} style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}>
              <Text style={s.ghostBtnText}>CLEAR</Text>
            </Pressable>
          ) : null}
        </View>
        <Pressable
          onPress={async () => {
            setConsolidating(true);
            try {
              const { consolidateMemories } = await import('../../lib/memoryConsolidation');
              await consolidateMemories(circleId);
              await load();
            } catch {}
            setConsolidating(false);
          }}
          style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}
        >
          <Text style={s.ghostBtnText}>{consolidating ? 'CONSOLIDATING...' : 'CONSOLIDATE'}</Text>
        </Pressable>
      </View>

      <View style={s.quickSavePanel}>
        <Text style={s.sectionLabel}>QUICK CAPTURE</Text>
        <TextInput
          value={newMemoryTitle}
          onChangeText={setNewMemoryTitle}
          placeholder="OPTIONAL TITLE"
          placeholderTextColor="#555555"
          style={s.textInput}
        />
        <TextInput
          value={newMemoryContent}
          onChangeText={setNewMemoryContent}
          placeholder="Capture a decision, preference, instruction, finding, or note worth keeping..."
          placeholderTextColor="#555555"
          style={[s.textInput, s.textArea]}
          multiline
        />
        <View style={s.actionRow}>
          <Pressable onPress={() => handleQuickSave('circle')} style={({ hovered, pressed }: any) => [s.primaryBtn, hovered && webHoverPrimary, pressed && webPressed]}>
            <Text style={s.primaryBtnText}>{savingNote ? 'SAVING...' : 'SAVE SHARED'}</Text>
          </Pressable>
          {userId ? (
            <Pressable onPress={() => handleQuickSave('user')} style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}>
              <Text style={s.ghostBtnText}>{savingNote ? 'SAVING...' : 'SAVE PRIVATE'}</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={s.tabRow}>
        {([
          { id: 'inbox', label: `INBOX (${inboxMemories.length})` },
          { id: 'all', label: `ALL (${memories.total})` },
          { id: 'circle', label: `SHARED (${memories.circle.length})` },
          { id: 'user', label: `PRIVATE (${memories.user.length})` },
          { id: 'session', label: `SESSION (${memories.session.length})` },
        ] as Array<{ id: ViewerTab; label: string }>).map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => { setActiveTab(tab.id); setSearchResults(null); }}
            style={({ hovered, pressed }: any) => [
              s.tab,
              activeTab === tab.id ? s.tabActive : null,
              hovered && activeTab !== tab.id ? webHoverGhost : null,
              pressed && webPressed,
            ]}
          >
            <Text style={[s.tabText, activeTab === tab.id ? s.tabTextActive : null]}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView style={s.list} contentContainerStyle={s.listContent} showsVerticalScrollIndicator>
        {loading ? (
          <ActivityIndicator color={accentColor} style={{ padding: 20 }} />
        ) : displayMemories.length === 0 ? (
          <View style={s.emptyCard}>
            <Text style={s.emptyTitle}>NO MEMORY HERE YET</Text>
            <Text style={s.emptyText}>
              {searchResults ? 'No memories match this search.' : activeTab === 'inbox'
                ? 'Newly learned Codex and Claude knowledge will land here for review.'
                : 'OpenSwan will start building memory as your agents work.'}
            </Text>
          </View>
        ) : (
          displayMemories.map((mem) => activeTab === 'inbox' ? renderInboxMemory(mem) : renderLibraryMemory(mem))
        )}
      </ScrollView>
    </View>
  );
}

const webHoverPrimary = Platform.OS === 'web' ? ({
  backgroundColor: '#e0e0e0',
  boxShadow: '0 0 20px rgba(255,255,255,0.25)',
  transform: [{ translateY: -1 }],
} as any) : null;

const webHoverGhost = Platform.OS === 'web' ? ({
  borderColor: '#888888',
  backgroundColor: '#111111',
  transform: [{ translateY: -1 }],
} as any) : null;

const webHoverDanger = Platform.OS === 'web' ? ({
  borderColor: '#ef4444',
  backgroundColor: '#1a0a0a',
  transform: [{ translateY: -1 }],
} as any) : null;

const webPressed = Platform.OS === 'web' ? ({ transform: [{ scale: 0.98 }] } as any) : null;

const s = StyleSheet.create({
  container: {
    width: '100%',
    maxHeight: 780,
    backgroundColor: '#000000',
    borderWidth: 2,
    borderColor: '#ffffff',
    borderRadius: 2,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: '0 0 60px rgba(255,255,255,0.08), 0 0 0 1px rgba(255,255,255,0.15)' } as any : {}),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#222222',
  },
  headerCopy: { flex: 1, gap: 6 },
  headerLabel: {
    color: '#888888',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    fontFamily: MONO,
  },
  headerTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 2,
    fontFamily: MONO,
  },
  headerHint: {
    color: '#888888',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    fontFamily: MONO,
  },
  closeBtn: {
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#000000',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  closeBtnText: { color: '#888888', fontSize: 11, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  topGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  statCard: {
    flexGrow: 1,
    minWidth: 140,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#222222',
    borderRadius: 2,
    padding: 14,
    gap: 6,
  },
  statLabel: { color: '#555555', fontSize: 9, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  statValue: { color: '#ffffff', fontSize: 18, fontWeight: '900', letterSpacing: 1, fontFamily: MONO },
  utilityRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 10,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  searchWrap: { flex: 1, flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  searchInput: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 2,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  quickSavePanel: {
    marginHorizontal: 20,
    marginBottom: 16,
    padding: 16,
    gap: 10,
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#222222',
    borderRadius: 2,
  },
  sectionLabel: { color: '#888888', fontSize: 10, fontWeight: '900', letterSpacing: 2, fontFamily: MONO },
  textInput: {
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 2,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    paddingHorizontal: 14,
    paddingVertical: 12,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  tab: {
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#000000',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  tabActive: {
    borderColor: '#ffffff',
    backgroundColor: '#ffffff',
  },
  tabText: { color: '#888888', fontSize: 10, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  tabTextActive: { color: '#000000' },
  list: { flex: 1, borderTopWidth: 1, borderTopColor: '#222222' },
  listContent: { padding: 20, gap: 12 },
  emptyCard: {
    borderWidth: 1,
    borderColor: '#222222',
    backgroundColor: '#0a0a0a',
    borderRadius: 2,
    padding: 20,
    gap: 8,
  },
  emptyTitle: { color: '#ffffff', fontSize: 12, fontWeight: '900', letterSpacing: 2, fontFamily: MONO },
  emptyText: { color: '#888888', fontSize: 11, fontWeight: '700', lineHeight: 16, fontFamily: MONO },
  inboxCard: {
    width: '100%',
    borderWidth: 2,
    borderColor: '#22d3ee',
    backgroundColor: '#040607',
    borderRadius: 2,
    padding: 16,
    gap: 10,
  },
  memoryCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#0a0a0a',
    borderRadius: 2,
    padding: 16,
    gap: 10,
  },
  cardTopRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  kindBadge: {
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  kindBadgeText: { fontSize: 9, fontWeight: '900', letterSpacing: 1.2, fontFamily: MONO },
  metaBadge: {
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#000000',
    borderRadius: 2,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  metaBadgeText: { color: '#888888', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, fontFamily: MONO },
  cardDate: { marginLeft: 'auto', color: '#555555', fontSize: 10, fontWeight: '700', fontFamily: MONO },
  cardTitle: { color: '#ffffff', fontSize: 14, fontWeight: '900', letterSpacing: 1, fontFamily: MONO },
  cardSubtext: { color: '#888888', fontSize: 11, fontWeight: '700', fontFamily: MONO },
  cardBody: { color: '#dddddd', fontSize: 12, fontWeight: '700', lineHeight: 18, fontFamily: MONO },
  editWrap: { gap: 10 },
  editInput: {
    minHeight: 90,
    backgroundColor: '#000000',
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 2,
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    padding: 12,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  primaryBtn: {
    borderWidth: 2,
    borderColor: '#ffffff',
    backgroundColor: '#ffffff',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  primaryBtnText: { color: '#000000', fontSize: 11, fontWeight: '900', letterSpacing: 1.5, fontFamily: MONO },
  ghostBtn: {
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#000000',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  ghostBtnText: { color: '#888888', fontSize: 11, fontWeight: '900', letterSpacing: 1.2, fontFamily: MONO },
  dangerBtn: {
    borderWidth: 1,
    borderColor: '#333333',
    backgroundColor: '#000000',
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  dangerBtnText: { color: '#ef4444', fontSize: 11, fontWeight: '900', letterSpacing: 1.2, fontFamily: MONO },
});
