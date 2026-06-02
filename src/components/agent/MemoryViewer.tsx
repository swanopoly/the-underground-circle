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
import { getCircleSessionMemoryMode } from '../../lib/agentRunSystem';
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
import { supabase } from '../../lib/supabase';
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

type ArchiveLearningEvent = {
  memoryId: string;
  title: string;
  action: string;
  score: number | null;
  createdAt: string;
  source: string;
  note: string | null;
};

type MemoryContextPlanLayer = {
  id: 'user_notes' | 'user_profile' | 'runtime' | 'working' | 'archive';
  label: string;
  summary: string;
  state: 'ready' | 'partial' | 'empty';
  entries: Array<{ id: string; title: string; body: string; meta?: string | null; memoryId?: string | null }>;
};

type MemoryContextPlanSummary = {
  sessionMode: 'private' | 'shared';
  layers: MemoryContextPlanLayer[];
};

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

function formatArchiveLearningAction(action: string): string {
  return action.replace(/_/g, ' ').toUpperCase();
}

function isArchiveDerivedMemory(mem: MemoryEntry): boolean {
  const source = String(mem.metadata?.source || '');
  return source === 'thread_archive_match' || source === 'thread_archive_recommendation';
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
  const [archiveBoostedMemories, setArchiveBoostedMemories] = useState<MemoryEntry[]>([]);
  const [archiveSuppressedMemories, setArchiveSuppressedMemories] = useState<MemoryEntry[]>([]);
  const [archiveLearningEvents, setArchiveLearningEvents] = useState<ArchiveLearningEvent[]>([]);
  const [selectedLearningMemoryId, setSelectedLearningMemoryId] = useState<string | null>(null);
  const [contextPlan, setContextPlan] = useState<MemoryContextPlanSummary | null>(null);
  const [selectedContextLayerId, setSelectedContextLayerId] = useState<MemoryContextPlanLayer['id'] | null>(null);

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
      const allLoadedMemories = [...data.circle, ...data.user, ...data.session];
      const archive = await loadChatSessionArchive(circleId, threadId).catch(() => null);
      setSessionArchive(archive);
      setArchiveRecommendations(deriveChatSessionArchiveRecommendations(archive, 6));
      try {
        const [{ loadUserMemory }, { loadStartupMemory }] = await Promise.all([
          import('../../lib/userMemory'),
          import('../../lib/memoryService'),
        ]);
        const [userMemoryContent, startupMemory, sessionMode, sharedDocResult] = await Promise.all([
          userId ? loadUserMemory(userId, circleId) : Promise.resolve({ combined: '', global: '', circle: '' }),
          userId ? loadStartupMemory({ circleId, userId, roomId: threadId || undefined }) : Promise.resolve(''),
          getCircleSessionMemoryMode(circleId).catch(() => 'private' as const),
          supabase.from('circle_memory').select('content').eq('circle_id', circleId).maybeSingle(),
        ]);

        const circleRuntimeCount = data.circle.filter((mem) => mem.retrieval_mode !== 'manual_only').length;
        const userProfileCount = data.user.filter((mem) => mem.retrieval_mode !== 'manual_only').length;
        const sessionRuntimeCount = data.session.filter((mem) => mem.retrieval_mode !== 'manual_only').length;
        const startupLines = startupMemory
          ? startupMemory.split('\n').map((line: string) => line.trim()).filter(Boolean).length
          : 0;
        const archiveSignals = archive
          ? archive.messages.length + archive.events.length + archive.touched.length
          : 0;
        const sharedDocChars = typeof sharedDocResult?.data?.content === 'string'
          ? sharedDocResult.data.content.trim().length
          : 0;
        const userNotesChars = userMemoryContent?.combined?.trim().length || 0;
        const runtimePieces = [
          circleRuntimeCount ? `${circleRuntimeCount} circle` : null,
          sessionRuntimeCount ? `${sessionRuntimeCount} session` : null,
          startupLines ? `${startupLines} startup lines` : null,
          sharedDocChars ? 'shared circle doc' : null,
        ].filter(Boolean);
        const userNoteEntries = [
          userMemoryContent?.global?.trim()
            ? {
                id: 'user-notes-global',
                title: 'Global User Notes',
                body: userMemoryContent.global.trim().slice(0, 280),
                meta: 'global',
              }
            : null,
          userMemoryContent?.circle?.trim()
            ? {
                id: 'user-notes-circle',
                title: 'Circle User Notes',
                body: userMemoryContent.circle.trim().slice(0, 280),
                meta: 'circle scoped',
              }
            : null,
        ].filter(Boolean) as MemoryContextPlanLayer['entries'];
        const userProfileEntries = data.user
          .filter((mem) => mem.retrieval_mode !== 'manual_only')
          .slice(0, 6)
          .map((mem) => ({
            id: mem.id,
            title: mem.title,
            body: mem.content.slice(0, 220),
            meta: `${mem.memory_kind} · ${mem.scope}`,
            memoryId: mem.id,
          }));
        const runtimeEntries = [
          ...(typeof sharedDocResult?.data?.content === 'string' && sharedDocResult.data.content.trim()
            ? [{
                id: 'runtime-circle-doc',
                title: 'Circle Operating Memory',
                body: sharedDocResult.data.content.trim().slice(0, 260),
                meta: 'shared circle doc',
              }]
            : []),
          ...data.circle
            .filter((mem) => mem.retrieval_mode !== 'manual_only')
            .slice(0, 4)
            .map((mem) => ({
              id: mem.id,
              title: mem.title,
              body: mem.content.slice(0, 180),
              meta: `${mem.memory_kind} · circle`,
              memoryId: mem.id,
            })),
          ...data.session
            .filter((mem) => mem.retrieval_mode !== 'manual_only')
            .slice(0, 3)
            .map((mem) => ({
              id: mem.id,
              title: mem.title,
              body: mem.content.slice(0, 180),
              meta: `${mem.memory_kind} · session`,
              memoryId: mem.id,
            })),
          ...(startupMemory
            ? startupMemory
                .split('\n')
                .map((line: string) => line.trim())
                .filter(Boolean)
                .slice(0, 4)
                .map((line: string, index: number) => ({
                  id: `runtime-startup-${index}`,
                  title: `Startup Memory ${index + 1}`,
                  body: line.slice(0, 220),
                  meta: 'startup bundle',
                }))
            : []),
        ];
        const workingEntries = allLoadedMemories
          .slice()
          .sort((a, b) => (b.importance || 0) - (a.importance || 0))
          .slice(0, 8)
          .map((mem) => ({
            id: mem.id,
            title: mem.title,
            body: mem.content.slice(0, 220),
            meta: `${mem.memory_kind} · ${mem.scope} · ${mem.retrieval_mode || 'on_demand'}`,
            memoryId: mem.id,
          }));
        const archiveEntries = archive ? [
          ...archive.events.slice(-4).reverse().map((event) => ({
            id: event.id,
            title: `[${event.kind}] ${event.summary}`.slice(0, 100),
            body: event.detail || event.summary,
            meta: 'event',
          })),
          ...archive.messages.slice(-3).reverse().map((message) => ({
            id: message.messageId,
            title: `${message.role === 'assistant' ? (message.userName || 'SwanBot') : (message.userName || 'User')}`.slice(0, 100),
            body: message.content.slice(0, 220),
            meta: 'message',
          })),
          ...archive.touched.slice(-4).reverse().map((touch, index) => ({
            id: `touch-${index}-${touch}`,
            title: touch,
            body: touch,
            meta: 'surface',
          })),
        ] : [];

        setContextPlan({
          sessionMode,
          layers: [
            {
              id: 'user_notes',
              label: 'User Notes',
              summary: userNotesChars
                ? `${userNotesChars} chars of explicit user-authored notes load first.`
                : 'No user-authored notes saved yet.',
              state: userNotesChars ? 'ready' : 'empty',
              entries: userNoteEntries,
            },
            {
              id: 'user_profile',
              label: 'User Profile',
              summary: userProfileCount
                ? `${userProfileCount} user memories are available for profile context.`
                : 'No inferred user-profile memories available yet.',
              state: userProfileCount ? 'ready' : 'empty',
              entries: userProfileEntries,
            },
            {
              id: 'runtime',
              label: 'Runtime Memory',
              summary: runtimePieces.length
                ? `${runtimePieces.join(' · ')}. Session mode is ${sessionMode}.`
                : `No runtime memory loaded yet. Session mode is ${sessionMode}.`,
              state: runtimePieces.length ? 'ready' : 'empty',
              entries: runtimeEntries,
            },
            {
              id: 'working',
              label: 'Working Memory',
              summary: allLoadedMemories.length
                ? `${allLoadedMemories.length} total memory entries are available for retrieval and query-time ranking.`
                : 'No working-memory candidates available for retrieval yet.',
              state: allLoadedMemories.length ? 'partial' : 'empty',
              entries: workingEntries,
            },
            {
              id: 'archive',
              label: 'Thread Archive',
              summary: archiveSignals
                ? `${archiveSignals} archive signals captured across transcript, events, and touched surfaces.`
                : 'No thread archive signals captured for this thread yet.',
              state: archiveSignals ? 'ready' : 'empty',
              entries: archiveEntries,
            },
          ],
        });
      } catch {
        setContextPlan(null);
      }
      const archiveDerivedMemories = allLoadedMemories.filter(isArchiveDerivedMemory);
      if (archiveDerivedMemories.length > 0) {
        try {
          const passiveCutoff = new Date(Date.now() - (14 * 24 * 60 * 60 * 1000)).toISOString();
          const { data: evalRows } = await supabase
            .from('memory_evaluations')
            .select('memory_id, score, feedback, created_at, metadata')
            .in('memory_id', archiveDerivedMemories.map((mem) => mem.id))
            .eq('evaluation_kind', 'manual_review')
            .gte('created_at', passiveCutoff)
            .order('created_at', { ascending: false });

          const passiveByMemoryId = new Map<string, number[]>();
          const recentPassiveEvents: ArchiveLearningEvent[] = [];
          for (const row of (evalRows || []) as any[]) {
            const action = typeof row?.metadata?.action === 'string' ? row.metadata.action : '';
            const source = typeof row?.metadata?.source === 'string' ? row.metadata.source : '';
            if (!source.includes('passive')) continue;
            if (action !== 'confirmed_helpful' && action !== 'weak_signal') continue;
            if (typeof row.memory_id === 'string' && typeof row.score === 'number') {
              const arr = passiveByMemoryId.get(row.memory_id) || [];
              arr.push(row.score);
              passiveByMemoryId.set(row.memory_id, arr);
            }
            const mem = archiveDerivedMemories.find((entry) => entry.id === row.memory_id);
            if (mem && recentPassiveEvents.length < 10) {
              recentPassiveEvents.push({
                memoryId: mem.id,
                title: mem.title,
                action,
                score: typeof row.score === 'number' ? row.score : null,
                createdAt: row.created_at,
                source,
                note: typeof row.feedback === 'string' ? row.feedback : null,
              });
            }
          }

          const boosted = archiveDerivedMemories.filter((mem) => {
            const scores = passiveByMemoryId.get(mem.id) || [];
            if (!scores.length) return false;
            const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
            return avg >= 0.65;
          });
          const suppressed = archiveDerivedMemories.filter((mem) => {
            const scores = passiveByMemoryId.get(mem.id) || [];
            if (!scores.length) return false;
            const avg = scores.reduce((sum, value) => sum + value, 0) / scores.length;
            return avg <= 0.35;
          });

          setArchiveBoostedMemories(boosted.slice(0, 6));
          setArchiveSuppressedMemories(suppressed.slice(0, 6));
          setArchiveLearningEvents(recentPassiveEvents);
        } catch {
          setArchiveBoostedMemories([]);
          setArchiveSuppressedMemories([]);
          setArchiveLearningEvents([]);
        }
      } else {
        setArchiveBoostedMemories([]);
        setArchiveSuppressedMemories([]);
        setArchiveLearningEvents([]);
      }
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

  const selectedLearningMemory = useMemo(
    () => allMemories.find((mem) => mem.id === selectedLearningMemoryId) || null,
    [allMemories, selectedLearningMemoryId],
  );
  const selectedLearningEvents = useMemo(
    () => archiveLearningEvents.filter((event) => event.memoryId === selectedLearningMemoryId).slice(0, 6),
    [archiveLearningEvents, selectedLearningMemoryId],
  );
  const selectedContextLayer = useMemo(
    () => contextPlan?.layers.find((layer) => layer.id === selectedContextLayerId) || null,
    [contextPlan, selectedContextLayerId],
  );

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
        memoryKind: recommendation.kind === 'failure_pattern' || recommendation.kind === 'recovery_pattern' ? 'finding' : 'instruction',
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

  const handleLearningJump = (memoryId: string) => {
    setSelectedLearningMemoryId(memoryId);
    setActiveTab('all');
    setSearchResults(null);
  };

  const handleLearningPin = async (mem: MemoryEntry) => {
    await pinMemory(mem.id);
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'pinned',
      note: 'Pinned from archive learning view',
      userId,
      source: 'archive_learning_view',
    });
    await load();
  };

  const handleLearningPromote = async (mem: MemoryEntry) => {
    await promoteMemory(mem.id);
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'promoted',
      note: 'Promoted from archive learning view',
      userId,
      source: 'archive_learning_view',
    });
    await load();
  };

  const handleLearningDownrank = async (mem: MemoryEntry) => {
    await decayMemoryImportance(mem.id);
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'not_helpful',
      note: 'Downranked from archive learning view',
      userId,
      source: 'archive_learning_view',
    });
    await load();
  };

  const handleContextJump = (memoryId: string) => {
    setSelectedLearningMemoryId(memoryId);
    setActiveTab('all');
    setSearchResults(null);
  };

  const handleContextPin = async (mem: MemoryEntry) => {
    await pinMemory(mem.id);
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'pinned',
      note: 'Pinned from memory context plan',
      userId,
      source: 'memory_context_plan',
    });
    await load();
  };

  const handleContextPromote = async (mem: MemoryEntry) => {
    await promoteMemory(mem.id);
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'promoted',
      note: 'Promoted from memory context plan',
      userId,
      source: 'memory_context_plan',
    });
    await load();
  };

  const handleContextDownrank = async (mem: MemoryEntry) => {
    await decayMemoryImportance(mem.id);
    await recordMemoryFeedback({
      memoryId: mem.id,
      action: 'not_helpful',
      note: 'Downranked from memory context plan',
      userId,
      source: 'memory_context_plan',
    });
    await load();
  };

  const handleContextRetrievalMode = async (
    mem: MemoryEntry,
    retrievalMode: 'startup' | 'on_demand' | 'manual_only',
  ) => {
    try {
      const { editMemory } = await import('../../lib/agentMemory');
      await editMemory(mem.id, { retrieval_mode: retrievalMode });
      await recordMemoryFeedback({
        memoryId: mem.id,
        action: 'accepted',
        note: `Set retrieval mode to ${retrievalMode} from memory context plan`,
        userId,
        source: 'memory_context_plan',
      });
      await load();
    } catch {}
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

      {contextPlan ? (
        <View style={s.archivePanel}>
          <View style={s.archiveHeader}>
            <Text style={s.sectionLabel}>MEMORY CONTEXT PLAN</Text>
            <Text style={s.archiveMeta}>session mode: {contextPlan.sessionMode.toUpperCase()}</Text>
          </View>
          <Text style={s.archiveTouched}>
            Injection order stays stable: user notes → user profile → runtime memory → working memory → thread archive.
          </Text>
          <View style={s.contextPlanGrid}>
            {contextPlan.layers.map((layer) => (
              <Pressable
                key={layer.id}
                onPress={() => setSelectedContextLayerId((current) => current === layer.id ? null : layer.id)}
                style={({ hovered, pressed }: any) => [
                  s.contextPlanCard,
                  layer.state === 'ready' ? s.contextPlanCardReady : null,
                  layer.state === 'partial' ? s.contextPlanCardPartial : null,
                  selectedContextLayerId === layer.id ? s.contextPlanCardSelected : null,
                  hovered && Platform.OS === 'web' ? webHoverGhost : null,
                  pressed && webPressed,
                ]}
              >
                <View style={s.cardTopRow}>
                  <Text style={s.contextPlanTitle}>{layer.label}</Text>
                  <View style={s.metaBadge}>
                    <Text style={s.metaBadgeText}>{layer.state.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={s.archiveItemBody}>{layer.summary}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {selectedContextLayer ? (
        <View style={s.archivePanel}>
          <View style={s.archiveHeader}>
            <Text style={s.sectionLabel}>{selectedContextLayer.label.toUpperCase()} DETAIL</Text>
            <Text style={s.archiveMeta}>{selectedContextLayer.entries.length} entries</Text>
          </View>
          {selectedContextLayer.entries.length > 0 ? (
            <View style={s.archiveColumn}>
              {selectedContextLayer.entries.map((entry) => (
                <View key={entry.id} style={s.archiveItem}>
                  <Text style={s.archiveItemTitle}>{entry.title}</Text>
                  {entry.meta ? (
                    <Text style={s.archiveItemMeta}>{entry.meta}</Text>
                  ) : null}
                  <Text style={s.archiveItemBody}>{entry.body}</Text>
                  {entry.memoryId ? (() => {
                    const mem = allMemories.find((item) => item.id === entry.memoryId);
                    if (!mem) return null;
                    return (
                      <View style={s.actionRow}>
                        <Pressable
                          onPress={() => handleContextJump(mem.id)}
                          style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}
                        >
                          <Text style={s.ghostBtnText}>OPEN</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleContextPin(mem)}
                          style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}
                        >
                          <Text style={s.ghostBtnText}>PIN</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleContextPromote(mem)}
                          style={({ hovered, pressed }: any) => [s.primaryBtn, hovered && webHoverPrimary, pressed && webPressed]}
                        >
                          <Text style={s.primaryBtnText}>PROMOTE</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleContextDownrank(mem)}
                          style={({ hovered, pressed }: any) => [s.dangerBtn, hovered && webHoverDanger, pressed && webPressed]}
                        >
                          <Text style={s.dangerBtnText}>DOWNRANK</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleContextRetrievalMode(mem, 'startup')}
                          style={({ hovered, pressed }: any) => [
                            s.ghostBtn,
                            mem.retrieval_mode === 'startup' ? s.contextModeBtnActive : null,
                            hovered && webHoverGhost,
                            pressed && webPressed,
                          ]}
                        >
                          <Text style={[
                            s.ghostBtnText,
                            mem.retrieval_mode === 'startup' ? s.contextModeBtnTextActive : null,
                          ]}>STARTUP</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleContextRetrievalMode(mem, 'on_demand')}
                          style={({ hovered, pressed }: any) => [
                            s.ghostBtn,
                            (mem.retrieval_mode || 'on_demand') === 'on_demand' ? s.contextModeBtnActive : null,
                            hovered && webHoverGhost,
                            pressed && webPressed,
                          ]}
                        >
                          <Text style={[
                            s.ghostBtnText,
                            (mem.retrieval_mode || 'on_demand') === 'on_demand' ? s.contextModeBtnTextActive : null,
                          ]}>ON DEMAND</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handleContextRetrievalMode(mem, 'manual_only')}
                          style={({ hovered, pressed }: any) => [
                            s.ghostBtn,
                            mem.retrieval_mode === 'manual_only' ? s.contextModeBtnActiveMuted : null,
                            hovered && webHoverGhost,
                            pressed && webPressed,
                          ]}
                        >
                          <Text style={[
                            s.ghostBtnText,
                            mem.retrieval_mode === 'manual_only' ? s.contextModeBtnTextMuted : null,
                          ]}>MANUAL ONLY</Text>
                        </Pressable>
                      </View>
                    );
                  })() : null}
                </View>
              ))}
            </View>
          ) : (
            <View style={s.archiveItem}>
              <Text style={s.archiveItemMeta}>This layer does not have any active entries yet.</Text>
            </View>
          )}
        </View>
      ) : null}

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

      {(archiveBoostedMemories.length > 0 || archiveSuppressedMemories.length > 0 || archiveLearningEvents.length > 0) ? (
        <View style={s.archivePanel}>
          <View style={s.archiveHeader}>
            <Text style={s.sectionLabel}>ARCHIVE LEARNING</Text>
            <Text style={s.archiveMeta}>
              {archiveBoostedMemories.length} boosted · {archiveSuppressedMemories.length} suppressed · {archiveLearningEvents.length} recent signals
            </Text>
          </View>
          <View style={s.archiveColumns}>
            <View style={s.archiveColumn}>
              <Text style={s.archiveColumnTitle}>BOOSTED MEMORIES</Text>
              {archiveBoostedMemories.length > 0 ? archiveBoostedMemories.map((mem) => (
                <Pressable key={mem.id} onPress={() => handleLearningJump(mem.id)} style={({ hovered, pressed }: any) => [s.archiveItem, hovered && webHoverGhost, pressed && webPressed]}>
                  <Text style={s.archiveItemTitle}>{mem.title}</Text>
                  <Text style={s.archiveItemMeta}>{archiveLineageLabel(mem) || 'Archive-derived memory'}</Text>
                </Pressable>
              )) : (
                <View style={s.archiveItem}>
                  <Text style={s.archiveItemMeta}>No boosted archive memories yet.</Text>
                </View>
              )}
            </View>
            <View style={s.archiveColumn}>
              <Text style={s.archiveColumnTitle}>SUPPRESSED MEMORIES</Text>
              {archiveSuppressedMemories.length > 0 ? archiveSuppressedMemories.map((mem) => (
                <Pressable key={mem.id} onPress={() => handleLearningJump(mem.id)} style={({ hovered, pressed }: any) => [s.archiveItem, hovered && webHoverGhost, pressed && webPressed]}>
                  <Text style={s.archiveItemTitle}>{mem.title}</Text>
                  <Text style={s.archiveItemMeta}>{archiveLineageLabel(mem) || 'Archive-derived memory'}</Text>
                </Pressable>
              )) : (
                <View style={s.archiveItem}>
                  <Text style={s.archiveItemMeta}>No suppressed archive memories right now.</Text>
                </View>
              )}
            </View>
            <View style={s.archiveColumn}>
              <Text style={s.archiveColumnTitle}>RECENT PASSIVE FEEDBACK</Text>
              {archiveLearningEvents.length > 0 ? archiveLearningEvents.map((event) => (
                <View key={`${event.memoryId}:${event.createdAt}:${event.action}`} style={s.archiveItem}>
                  <Text style={s.archiveItemTitle}>{event.title}</Text>
                  <Text style={s.archiveItemMeta}>
                    {event.action.replace(/_/g, ' ').toUpperCase()} · {event.score != null ? `${Math.round(event.score * 100)}%` : 'unscored'} · {new Date(event.createdAt).toLocaleString()}
                  </Text>
                  {event.note ? (
                    <Text style={s.archiveItemBody}>{event.note}</Text>
                  ) : null}
                </View>
              )) : (
                <View style={s.archiveItem}>
                  <Text style={s.archiveItemMeta}>No passive archive feedback yet.</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      ) : null}

      {selectedLearningMemory ? (
        <View style={s.archivePanel}>
          <View style={s.archiveHeader}>
            <Text style={s.sectionLabel}>LEARNING DETAIL</Text>
            <Text style={s.archiveMeta}>{selectedLearningMemory.title}</Text>
          </View>
          <Text style={s.cardSubtext}>{archiveLineageLabel(selectedLearningMemory) || 'Archive-derived memory'}</Text>
          <Text style={s.cardBody}>{selectedLearningMemory.content}</Text>
          <View style={s.actionRow}>
            <Pressable onPress={() => handleLearningPromote(selectedLearningMemory)} style={({ hovered, pressed }: any) => [s.primaryBtn, hovered && webHoverPrimary, pressed && webPressed]}>
              <Text style={s.primaryBtnText}>PROMOTE</Text>
            </Pressable>
            <Pressable onPress={() => handleLearningPin(selectedLearningMemory)} style={({ hovered, pressed }: any) => [s.ghostBtn, hovered && webHoverGhost, pressed && webPressed]}>
              <Text style={s.ghostBtnText}>PIN</Text>
            </Pressable>
            <Pressable onPress={() => handleLearningDownrank(selectedLearningMemory)} style={({ hovered, pressed }: any) => [s.dangerBtn, hovered && webHoverDanger, pressed && webPressed]}>
              <Text style={s.dangerBtnText}>DOWNRANK</Text>
            </Pressable>
          </View>
          <View style={s.archiveColumn}>
            <Text style={s.archiveColumnTitle}>RECENT SIGNALS</Text>
            {selectedLearningEvents.length > 0 ? selectedLearningEvents.map((event) => (
              <View key={`${event.memoryId}:${event.createdAt}:${event.action}`} style={s.archiveItem}>
                <Text style={s.archiveItemTitle}>{formatArchiveLearningAction(event.action)}</Text>
                <Text style={s.archiveItemMeta}>
                  {event.score != null ? `${Math.round(event.score * 100)}%` : 'unscored'} · {new Date(event.createdAt).toLocaleString()}
                </Text>
                {event.note ? (
                  <Text style={s.archiveItemBody}>{event.note}</Text>
                ) : null}
              </View>
            )) : (
              <View style={s.archiveItem}>
                <Text style={s.archiveItemMeta}>No recent passive signals for this memory yet.</Text>
              </View>
            )}
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
  contextPlanGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  contextPlanCard: {
    flexGrow: 1,
    minWidth: 220,
    backgroundColor: bg.editor,
    borderWidth: 1,
    borderColor: border.default,
    borderRadius: radius.subtle,
    padding: 10,
    gap: 6,
  },
  contextPlanCardReady: {
    borderColor: `${accent.green}55`,
  },
  contextPlanCardPartial: {
    borderColor: `${accent.yellow}55`,
  },
  contextPlanCardSelected: {
    borderColor: accent.blue,
    backgroundColor: bg.sidebar,
  },
  contextModeBtnActive: {
    borderColor: accent.blue,
    backgroundColor: `${accent.blue}18`,
  },
  contextModeBtnTextActive: {
    color: accent.blue,
  },
  contextModeBtnActiveMuted: {
    borderColor: text.muted,
    backgroundColor: `${text.muted}18`,
  },
  contextModeBtnTextMuted: {
    color: text.muted,
  },
  contextPlanTitle: {
    color: text.primary,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    fontFamily: MONO,
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
