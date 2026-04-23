/**
 * MemoryViewer — OpenSwan memory inbox + memory library.
 *
 * Full-width, style-guide-aligned governance surface for:
 * - newly learned cross-agent knowledge
 * - quick memory capture
 * - search, edit, prune, and consolidation
 * - approve/pin/promote/forget actions on learned memory
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { View, Text, Pressable, ScrollView, TextInput, StyleSheet, Platform, ActivityIndicator, Animated } from 'react-native';
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
import {
  deriveChatSessionArchiveRecommendations,
  loadChatSessionArchive,
  searchChatSessionArchive,
  setChatSessionArchiveRecommendationState,
  type ChatSessionArchiveRecommendation,
  type ChatSessionArchiveRecord,
  type ChatSessionArchiveSearchMatch,
} from '../../lib/chatSessionArchive';
// VS Code Dark+ tokens — this surface is the IDE-feel "developer
// console" flavor, not the default rounded-dark UC style. All colors
// flow through `vsCodeTheme.ts` so a theme swap (Monokai, etc.) only
// touches one file.
import { bg, border, text, accent, radius, font, shadow, kindAccent } from '../../lib/vsCodeTheme';

const MONO = font.mono;

// Legacy kind-color map kept for existing callers that import it as a
// raw table. New code should prefer `kindAccent()` from vsCodeTheme.
const KIND_COLORS: Record<string, string> = {
  preference:  accent.purple,
  fact:        accent.cyan,
  decision:    accent.yellow,
  finding:     accent.green,
  instruction: accent.purple,
  policy:      accent.blue,
  context:     text.muted,
};

interface Props {
  circleId: string;
  threadId?: string | null;
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

function formatArchiveEventTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function archiveLineageLabel(mem: MemoryEntry): string | null {
  const source = String(mem.metadata?.source || '');
  if (source === 'thread_archive_match') return 'From thread archive match';
  if (source === 'thread_archive_recommendation') return 'From archive suggestion';
  return null;
}

export default function MemoryViewer({ circleId, threadId, userId, accentColor = '#22d3ee', onClose }: Props) {
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
  const [sessionArchive, setSessionArchive] = useState<ChatSessionArchiveRecord | null>(null);
  const [archiveMatches, setArchiveMatches] = useState<ChatSessionArchiveSearchMatch[]>([]);
  const [archiveRecommendations, setArchiveRecommendations] = useState<ChatSessionArchiveRecommendation[]>([]);

  // ── Mount animation — same motion language as the chat-bottom
  // popups (fade + snap via spring). Backdrop has its own quick fade
  // so the scrim appears BEFORE the console to anchor the eye.
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const consoleOpacity = useRef(new Animated.Value(0)).current;
  const consoleScale = useRef(new Animated.Value(0.97)).current;
  const consoleTranslateY = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(backdropOpacity, { toValue: 1, duration: 120, useNativeDriver: false }),
      Animated.timing(consoleOpacity,  { toValue: 1, duration: 160, useNativeDriver: false }),
      Animated.spring(consoleScale,     { toValue: 1, tension: 170, friction: 14, useNativeDriver: false }),
      Animated.spring(consoleTranslateY,{ toValue: 0, tension: 170, friction: 14, useNativeDriver: false }),
    ]).start();
    // Only on mount; closing unmounts us so no exit animation needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape-to-close on web — matches VS Code's modal / command palette
  // dismissal pattern. No-op on native (no DOM).
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { getUserMemories } = await import('../../lib/agentMemory');
      const data = await getUserMemories(circleId, userId);
      setMemories(data);
      const archive = await loadChatSessionArchive(circleId, threadId).catch(() => null);
      setSessionArchive(archive);
      setArchiveRecommendations(deriveChatSessionArchiveRecommendations(archive, 6));
      try {
        const { getMemoryHealthReport } = await import('../../lib/memoryConsolidation');
        setHealthReport(await getMemoryHealthReport(circleId));
      } catch {}
    } catch {}
    setLoading(false);
  }, [circleId, threadId, userId]);

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
    if (!searchQuery.trim()) {
      setSearchResults(null);
      setArchiveMatches([]);
      return;
    }
    try {
      const { searchMemories } = await import('../../lib/agentMemory');
      const results = await searchMemories(circleId, searchQuery.trim());
      setSearchResults(results);
      setArchiveMatches(searchChatSessionArchive(sessionArchive, searchQuery.trim(), 10));
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

  const handleArchivePromote = async (match: ChatSessionArchiveSearchMatch, scope: 'circle' | 'user') => {
    setSavingNote(true);
    try {
      const { saveMemory } = await import('../../lib/agentRunSystem');
      const saved = await saveMemory({
        scope,
        circleId,
        userId,
        memoryKind: match.kind === 'event' ? 'finding' : match.kind === 'touch' ? 'context' : 'fact',
        title: `Archive: ${match.title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Thread archive match'}`,
        content: [
          `Archive match kind: ${match.kind}`,
          `Source thread: ${threadId || 'main'}`,
          `Summary: ${match.title.replace(/\s+/g, ' ').trim().slice(0, 80) || 'Thread archive match'}`,
          `Excerpt: ${match.excerpt}`,
        ].join('\n'),
        visibility: scope === 'circle' ? 'circle_shared' : 'private',
        importance: 0.68,
        retrievalMode: 'on_demand',
        sourceSurface: 'main_chat',
        metadata: {
          source: 'thread_archive_match',
          archiveMatchKind: match.kind,
          archiveMatchId: match.id,
          archiveThreadId: threadId || 'main',
          archiveTimestamp: match.timestamp || null,
        },
      } as any);
      if (saved) {
        await recordMemoryFeedback({
          memoryId: saved.id,
          action: 'accepted',
          note: `Accepted archive ${match.kind} match from thread ${threadId || 'main'}`,
          userId,
          source: 'thread_archive_match',
        });
      }
      await load();
    } catch {}
    setSavingNote(false);
  };

  const handleArchiveRecommendationPromote = async (
    recommendation: ChatSessionArchiveRecommendation,
    scope: 'circle' | 'user',
  ) => {
    setSavingNote(true);
    try {
      const { saveMemory } = await import('../../lib/agentRunSystem');
      const saved = await saveMemory({
        scope,
        circleId,
        userId,
        memoryKind: recommendation.kind === 'failure_pattern' ? 'finding' : 'instruction',
        title: `Archive pattern: ${recommendation.title}`.slice(0, 120),
        content: recommendation.content,
        visibility: scope === 'circle' ? 'circle_shared' : 'private',
        importance: recommendation.confidence === 'high' ? 0.8 : 0.72,
        retrievalMode: 'on_demand',
        sourceSurface: 'main_chat',
        metadata: {
          source: 'thread_archive_recommendation',
          archiveRecommendationId: recommendation.id,
          archiveRecommendationKind: recommendation.kind,
          archiveRecommendationConfidence: recommendation.confidence,
          archiveThreadId: threadId || 'main',
          archiveRecommendationSources: recommendation.sources.slice(0, 6),
        },
      } as any);
      if (saved) {
        await recordMemoryFeedback({
          memoryId: saved.id,
          action: 'accepted',
          note: `Accepted archive recommendation: ${recommendation.title}`,
          userId,
          source: 'thread_archive_recommendation',
        });
      }
      await setChatSessionArchiveRecommendationState({
        circleId,
        threadId,
        recommendationId: recommendation.id,
        status: scope === 'circle' ? 'saved_shared' : 'saved_private',
        memoryId: saved?.id || null,
      });
      setArchiveRecommendations((prev) => prev.filter((entry) => entry.id !== recommendation.id));
      await load();
    } catch {}
    setSavingNote(false);
  };

  const handleArchiveRecommendationDismiss = async (recommendation: ChatSessionArchiveRecommendation) => {
    try {
      await setChatSessionArchiveRecommendationState({
        circleId,
        threadId,
        recommendationId: recommendation.id,
        status: 'dismissed',
      });
      setArchiveRecommendations((prev) => prev.filter((entry) => entry.id !== recommendation.id));
      await load();
    } catch {}
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
        {archiveLineageLabel(mem) ? (
          <Text style={s.cardSubtext}>{archiveLineageLabel(mem)}</Text>
        ) : null}
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
    // Pop-up console — fixed-position backdrop + centered console. Covers
    // most of the viewport so the scroll area is big enough to work in.
    // Click backdrop to dismiss, or press Escape (web). The backdrop +
    // console have independent Animated values so the scrim appears just
    // before the console snaps into place.
    <View style={s.backdrop}>
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity: backdropOpacity }]}>
        <Pressable
          onPress={onClose}
          accessibilityLabel="Dismiss memory console"
          style={s.backdropHit}
        />
      </Animated.View>
      <Animated.View style={[
        s.container,
        Platform.OS === 'web' ? ({ transformOrigin: 'center center' } as any) : null,
        {
          opacity: consoleOpacity,
          transform: [{ scale: consoleScale }, { translateY: consoleTranslateY }],
        },
      ]}>
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

      {threadId && sessionArchive ? (
        <View style={s.archivePanel}>
          <View style={s.archiveHeader}>
            <Text style={s.sectionLabel}>THREAD ARCHIVE</Text>
            <Text style={s.archiveMeta}>
              {sessionArchive.messages.length} msgs · {sessionArchive.events.length} events · {sessionArchive.touched.length} touches
            </Text>
          </View>
          {sessionArchive.touched.length > 0 ? (
            <Text style={s.archiveTouched}>
              {sessionArchive.touched.slice(-12).join(' · ')}
            </Text>
          ) : null}
          <View style={s.archiveColumns}>
            <View style={s.archiveColumn}>
              <Text style={s.archiveColumnTitle}>RECENT EVENTS</Text>
              {sessionArchive.events.slice(-4).reverse().map((event) => (
                <View key={event.id} style={s.archiveItem}>
                  <Text style={s.archiveItemTitle}>
                    [{event.kind}] {event.summary}
                  </Text>
                  <Text style={s.archiveItemMeta}>{formatArchiveEventTime(event.timestamp)}</Text>
                </View>
              ))}
            </View>
            <View style={s.archiveColumn}>
              <Text style={s.archiveColumnTitle}>RECENT TRANSCRIPT</Text>
              {sessionArchive.messages.slice(-3).reverse().map((message) => (
                <View key={message.messageId} style={s.archiveItem}>
                  <Text style={s.archiveItemTitle}>
                    {(message.role === 'assistant' ? (message.userName || 'SwanBot') : (message.userName || 'User')).toUpperCase()}
                  </Text>
                  <Text style={s.archiveItemBody}>{message.content.slice(0, 160)}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {archiveRecommendations.length > 0 ? (
        <View style={s.archivePanel}>
          <View style={s.archiveHeader}>
            <Text style={s.sectionLabel}>ARCHIVE SUGGESTIONS</Text>
            <Text style={s.archiveMeta}>{archiveRecommendations.length} candidates</Text>
          </View>
          <View style={s.archiveColumn}>
            {archiveRecommendations.map((recommendation) => (
              <View key={recommendation.id} style={s.archiveItem}>
                <Text style={s.archiveItemTitle}>{recommendation.title}</Text>
                <Text style={s.archiveItemBody}>{recommendation.summary}</Text>
                <Text style={s.archiveItemMeta}>
                  {recommendation.confidence.toUpperCase()} · {recommendation.kind.replace(/_/g, ' ')}
                </Text>
                <View style={s.actionRow}>
                  <Pressable
                    onPress={() => handleArchiveRecommendationPromote(recommendation, 'circle')}
                    style={({ hovered, pressed }: any) => [s.primaryBtn, hovered && webHoverPrimary, pressed && webPressed]}
                  >
                    <Text style={s.primaryBtnText}>{savingNote ? 'SAVING...' : 'SAVE SHARED'}</Text>
                  </Pressable>
                  {userId ? (
                    <Pressable
                      onPress={() => handleArchiveRecommendationPromote(recommendation, 'user')}
                      style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}
                      >
                        <Text style={s.ghostBtnText}>{savingNote ? 'SAVING...' : 'SAVE PRIVATE'}</Text>
                      </Pressable>
                    ) : null}
                  <Pressable
                    onPress={() => handleArchiveRecommendationDismiss(recommendation)}
                    style={({ hovered, pressed }: any) => [s.dangerBtn, hovered && webHoverDanger, pressed && webPressed]}
                  >
                    <Text style={s.dangerBtnText}>DISMISS</Text>
                  </Pressable>
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {archiveMatches.length > 0 ? (
        <View style={s.archivePanel}>
          <View style={s.archiveHeader}>
            <Text style={s.sectionLabel}>ARCHIVE MATCHES</Text>
            <Text style={s.archiveMeta}>{archiveMatches.length} results</Text>
          </View>
          <View style={s.archiveColumn}>
            {archiveMatches.map((match) => (
              <View key={`${match.kind}:${match.id}`} style={s.archiveItem}>
                <Text style={s.archiveItemTitle}>{match.title}</Text>
                <Text style={s.archiveItemBody}>{match.excerpt}</Text>
                {match.timestamp ? (
                  <Text style={s.archiveItemMeta}>{formatArchiveEventTime(match.timestamp)}</Text>
                ) : null}
                <View style={s.actionRow}>
                  <Pressable
                    onPress={() => handleArchivePromote(match, 'circle')}
                    style={({ hovered, pressed }: any) => [s.primaryBtn, hovered && webHoverPrimary, pressed && webPressed]}
                  >
                    <Text style={s.primaryBtnText}>{savingNote ? 'SAVING...' : 'SAVE SHARED'}</Text>
                  </Pressable>
                  {userId ? (
                    <Pressable
                      onPress={() => handleArchivePromote(match, 'user')}
                      style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}
                    >
                      <Text style={s.ghostBtnText}>{savingNote ? 'SAVING...' : 'SAVE PRIVATE'}</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ))}
          </View>
        </View>
      ) : null}

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
            <Pressable onPress={() => { setSearchQuery(''); setSearchResults(null); setArchiveMatches([]); }} style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}>
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

      {/* VS Code-style status bar — persistent bottom strip with quick
          counts. Mirrors the blue bar in VS Code's main window. */}
      <View style={s.statusBar}>
        <View style={s.statusBarSegment}>
          <Text style={s.statusBarText}>
            {activeTab === 'inbox' ? '⊚' : '●'} {activeTab.toUpperCase()}
          </Text>
        </View>
        <View style={s.statusBarDivider} />
        <View style={s.statusBarSegment}>
          <Text style={s.statusBarText}>
            {displayMemories.length}/{memories.total} entries
          </Text>
        </View>
        {searchResults ? (
          <>
            <View style={s.statusBarDivider} />
            <View style={s.statusBarSegment}>
              <Text style={s.statusBarText}>
                filter: “{searchQuery.slice(0, 24)}{searchQuery.length > 24 ? '…' : ''}”
              </Text>
            </View>
          </>
        ) : null}
        <View style={{ flex: 1 }} />
        <View style={s.statusBarSegment}>
          <Text style={s.statusBarText}>OpenSwan memory · UTF-8 · mono</Text>
        </View>
      </View>
      </Animated.View>
    </View>
  );
}

// ── Web hover constants — tuned for the VS Code Dark+ surface. ─────
// The "primary" style is the VS Code blue button hover (10% lighter).
const webHoverPrimary = Platform.OS === 'web' ? ({
  backgroundColor: '#1e8ad6', // accent.blue + 10% lighter
  boxShadow: '0 0 0 1px rgba(0, 122, 204, 0.5)',
} as any) : null;

const webHoverGhost = Platform.OS === 'web' ? ({
  // VS Code's universal row-hover: subtle 2–3% lighter bg, no lift.
  backgroundColor: bg.hover,
  borderColor: text.muted,
} as any) : null;

const webHoverDanger = Platform.OS === 'web' ? ({
  borderColor: accent.red,
  backgroundColor: 'rgba(244, 135, 113, 0.08)',
} as any) : null;

const webPressed = Platform.OS === 'web' ? ({ transform: [{ scale: 0.98 }] } as any) : null;

// ── StyleSheet — VS Code Dark+ skin ────────────────────────────────
// Hierarchy: editor bg (darkest) → sidebar bg → tab strip → hover.
// Sharp 2px corners (VS Code signature). Monospace throughout.
// Blue underline on active tab (not inverted fill).
const s = StyleSheet.create({
  // ── Backdrop — fixed overlay covering the whole viewport so the
  // console feels like a proper pop-up, not inline content.
  backdrop: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    ...(Platform.OS === 'web' ? ({ position: 'fixed' as any, backdropFilter: 'blur(2px)' } as any) : {}),
  },
  backdropHit: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: shadow.modalScrim,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  // ── Container — 92vw × 90vh on web, reasonable native defaults.
  // Uses flex column so the inner ScrollView can flex-1 into the
  // remaining space after the header / stats / tabs / status bar take
  // their natural heights.
  container: {
    width: Platform.OS === 'web' ? ('92vw' as any) : '94%',
    height: Platform.OS === 'web' ? ('90vh' as any) : '92%',
    maxWidth: 1400,
    maxHeight: Platform.OS === 'web' ? undefined : 900,
    flexDirection: 'column',
    backgroundColor: bg.editor,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? { boxShadow: shadow.modalLift } as any : {}),
  },
  // VS Code title bar feel — slightly lighter than the editor, thin
  // 1px bottom separator.
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    backgroundColor: bg.tabStrip,
    borderBottomWidth: 1,
    borderBottomColor: border.default,
  },
  headerCopy: { flex: 1, gap: 6 },
  headerLabel: {
    color: text.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.6,
    fontFamily: MONO,
  },
  headerTitle: {
    color: text.primary,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 1.2,
    fontFamily: MONO,
  },
  headerHint: {
    color: text.muted,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 16,
    fontFamily: MONO,
  },
  // Close button styled like VS Code's titlebar × — transparent, hover
  // tints to red (matching the "close window" affordance).
  closeBtn: {
    borderWidth: 0,
    backgroundColor: 'transparent',
    borderRadius: radius.subtle,
    paddingHorizontal: 10,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  closeBtnText: { color: text.muted, fontSize: 11, fontWeight: '700', letterSpacing: 1, fontFamily: MONO },
  topGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
  },
  // Stat cards read like VS Code's "chip" surfaces in the status bar
  // area — slightly lifted sidebar-bg, thin 1px border.
  statCard: {
    flexGrow: 1,
    minWidth: 140,
    backgroundColor: bg.sidebar,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
    padding: 12,
    gap: 4,
  },
  statLabel: {
    color: text.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1.2,
    fontFamily: MONO,
    textTransform: 'uppercase' as const,
  },
  statValue: { color: text.primary, fontSize: 18, fontWeight: '700', letterSpacing: 0.5, fontFamily: MONO },
  utilityRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  archivePanel: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    gap: 10,
    backgroundColor: bg.sidebar,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
  },
  archiveHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  archiveMeta: {
    color: text.muted,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    fontFamily: MONO,
  },
  archiveTouched: {
    color: text.secondary,
    fontSize: 10,
    lineHeight: 15,
    fontFamily: MONO,
  },
  archiveColumns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  archiveColumn: {
    flexGrow: 1,
    minWidth: 260,
    gap: 8,
  },
  archiveColumnTitle: {
    color: text.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.1,
    fontFamily: MONO,
  },
  archiveItem: {
    backgroundColor: bg.editor,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
    padding: 10,
    gap: 4,
  },
  archiveItemTitle: {
    color: text.primary,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 16,
    fontFamily: MONO,
  },
  archiveItemMeta: {
    color: text.faint,
    fontSize: 10,
    fontWeight: '500',
    fontFamily: MONO,
  },
  archiveItemBody: {
    color: text.secondary,
    fontSize: 11,
    lineHeight: 16,
    fontFamily: MONO,
  },
  searchWrap: { flex: 1, flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  // Inputs use VS Code's input bg (#3c3c3c) with a thin 1px border.
  // Focus transitions to accent blue via web CSS in-place.
  searchInput: {
    flex: 1,
    backgroundColor: bg.input,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
    color: text.primary,
    fontSize: 12,
    fontWeight: '500',
    fontFamily: MONO,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', transition: 'border-color 0.15s ease' } as any : {}),
  },
  quickSavePanel: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 14,
    gap: 10,
    backgroundColor: bg.sidebar,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
  },
  sectionLabel: {
    color: text.muted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
    fontFamily: MONO,
    textTransform: 'uppercase' as const,
  },
  textInput: {
    backgroundColor: bg.input,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
    color: text.primary,
    fontSize: 12,
    fontWeight: '500',
    fontFamily: MONO,
    paddingHorizontal: 12,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', transition: 'border-color 0.15s ease' } as any : {}),
  },
  textArea: { minHeight: 88, textAlignVertical: 'top' },
  // Tab strip styled like VS Code editor tabs — sit atop the tab-strip
  // background, active tab gets an accent-blue bottom border (not
  // inverted fill). Keeps the content area visually unified with the
  // active tab.
  tabRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 0,
    paddingHorizontal: 8,
    paddingTop: 4,
    backgroundColor: bg.tabStrip,
    borderBottomWidth: 1,
    borderBottomColor: border.default,
  },
  tab: {
    borderWidth: 0,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    backgroundColor: 'transparent',
    borderRadius: 0,
    paddingHorizontal: 14,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  tabActive: {
    // Blue underline + slightly brighter text. No bg flip.
    borderBottomColor: accent.blue,
    backgroundColor: bg.editor,
  },
  tabText: { color: text.muted, fontSize: 11, fontWeight: '500', letterSpacing: 0.6, fontFamily: MONO },
  tabTextActive: { color: text.primary, fontWeight: '600' },
  // `flex: 1` makes the ScrollView eat the remaining vertical space
  // between the tab strip and the status bar. `minHeight: 0` is the
  // usual fix for a flex child that refuses to shrink below its
  // content (so the inner list DOES get to scroll internally rather
  // than pushing the status bar off-screen).
  list: {
    flex: 1,
    minHeight: 0,
    backgroundColor: bg.editor,
  },
  listContent: { padding: 16, gap: 10, paddingBottom: 32 },
  emptyCard: {
    borderWidth: 1,
    borderColor: border.default,
    backgroundColor: bg.sidebar,
    borderRadius: radius.subtle,
    padding: 18,
    gap: 8,
  },
  emptyTitle: {
    color: text.primary,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.4,
    fontFamily: MONO,
    textTransform: 'uppercase' as const,
  },
  emptyText: { color: text.muted, fontSize: 11, fontWeight: '500', lineHeight: 16, fontFamily: MONO },
  // Inbox memories are "new / needs review" — mark with a left-edge
  // accent border (matches VS Code's "modified file" left-strip).
  inboxCard: {
    width: '100%',
    borderWidth: 1,
    borderLeftWidth: 3,
    borderColor: border.default,
    borderLeftColor: accent.cyan,
    backgroundColor: bg.sidebar,
    borderRadius: radius.subtle,
    padding: 14,
    gap: 8,
  },
  memoryCard: {
    width: '100%',
    borderWidth: 1,
    borderColor: border.default,
    backgroundColor: bg.sidebar,
    borderRadius: radius.subtle,
    padding: 14,
    gap: 8,
  },
  cardTopRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  kindBadge: {
    borderWidth: 1,
    borderRadius: radius.subtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kindBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: MONO,
    textTransform: 'uppercase' as const,
  },
  metaBadge: {
    borderWidth: 1,
    borderColor: border.default,
    backgroundColor: bg.editor,
    borderRadius: radius.subtle,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  metaBadgeText: {
    color: text.muted,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: MONO,
    textTransform: 'uppercase' as const,
  },
  cardDate: { marginLeft: 'auto', color: text.faint, fontSize: 10, fontWeight: '500', fontFamily: MONO },
  cardTitle: { color: text.primary, fontSize: 13, fontWeight: '700', letterSpacing: 0.4, fontFamily: MONO },
  cardSubtext: { color: text.muted, fontSize: 11, fontWeight: '500', fontFamily: MONO },
  cardBody: { color: text.secondary, fontSize: 12, fontWeight: '500', lineHeight: 18, fontFamily: MONO },
  editWrap: { gap: 8 },
  editInput: {
    minHeight: 90,
    backgroundColor: bg.input,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
    color: text.primary,
    fontSize: 12,
    fontWeight: '500',
    fontFamily: MONO,
    padding: 10,
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', transition: 'border-color 0.15s ease' } as any : {}),
  },
  actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // Primary = VS Code blue filled button (Command Palette "Go" style).
  primaryBtn: {
    borderWidth: 1,
    borderColor: accent.blue,
    backgroundColor: accent.blue,
    borderRadius: radius.subtle,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  primaryBtnText: {
    color: text.onAccent,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.8,
    fontFamily: MONO,
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: border.default,
    backgroundColor: bg.sidebar,
    borderRadius: radius.subtle,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  ghostBtnText: {
    color: text.secondary,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    fontFamily: MONO,
  },
  dangerBtn: {
    borderWidth: 1,
    borderColor: border.default,
    backgroundColor: bg.sidebar,
    borderRadius: radius.subtle,
    paddingHorizontal: 12,
    paddingVertical: 8,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  dangerBtnText: {
    color: accent.red,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    fontFamily: MONO,
  },
  // ── VS Code status bar — bottom strip like the blue bar in VS Code's
  // main window. Shows the total memory count + current tab filter.
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: bg.statusBar,
    borderTopWidth: 1,
    borderTopColor: border.default,
  },
  statusBarSegment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusBarText: {
    color: text.onAccent,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.5,
    fontFamily: MONO,
  },
  statusBarDivider: {
    width: 1,
    height: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
  },
});
