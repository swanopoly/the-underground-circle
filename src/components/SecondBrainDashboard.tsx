import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { MemoryEntry } from '../lib/agentRunSystem';
import {
  buildSecondBrainGraph,
  createSecondBrainNote,
  createSecondBrainNoteFromMemory,
  promoteSecondBrainNoteToMemory,
  searchSecondBrain,
  summarizeSecondBrainContent,
  updateSecondBrainNote,
  type SecondBrainGraph,
  type SecondBrainNote,
  type SecondBrainSearchResult,
} from '../lib/secondBrain';
import { PIXEL_COLORS, GRID, PX } from '../lib/pixelDesign';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Props {
  circleId: string;
  userId?: string;
  accentColor?: string;
  onOpenCompartment?: (key: string) => void;
}

type BrainFilter = 'active' | 'inbox' | 'evergreen' | 'processed';

interface GraphPosition { x: number; y: number; }
interface ClusterLayout extends GraphPosition {
  color: string;
  tag: string;
  count: number;
  radius: number;
}
interface GraphLayout {
  notePos: Map<string, GraphPosition>;
  noteColor: Map<string, string>;
  clusters: ClusterLayout[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const NODE_COLORS = [
  '#22d3ee', '#22c55e', '#a855f7', '#f59e0b',
  '#38bdf8', '#f43f5e', '#84cc16', '#fb923c',
] as const;

const GOLDEN_ANGLE = 2.39996322972865; // radians

// ─── Layout computation ───────────────────────────────────────────────────────

function computeGraphLayout(
  notes: SecondBrainNote[],
  clusters: SecondBrainGraph['clusters'],
  width: number,
  height: number,
): GraphLayout {
  const cx = width / 2;
  const cy = height / 2;
  const clusterRingR = Math.min(width, height) * 0.33;
  const noteOrbitR = Math.min(width, height) * 0.12;

  const activeClusters = clusters.slice(0, NODE_COLORS.length * 2);

  // Clusters evenly distributed on a ring
  const clusterLayouts: ClusterLayout[] = activeClusters.map((cluster, i) => {
    const angle = (i / Math.max(activeClusters.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const r = 18 + Math.min(12, cluster.count * 2);
    return {
      x: cx + Math.cos(angle) * clusterRingR,
      y: cy + Math.sin(angle) * clusterRingR,
      color: NODE_COLORS[i % NODE_COLORS.length],
      tag: cluster.tag,
      count: cluster.count,
      radius: r,
    };
  });

  const clusterMap = new Map(clusterLayouts.map((c) => [c.tag, c]));

  // Note positions using golden angle distribution around their cluster
  const notePos = new Map<string, GraphPosition>();
  const noteColor = new Map<string, string>();
  const clusterNoteIndex = new Map<string, number>();
  const orphanNotes: SecondBrainNote[] = [];

  for (const note of notes) {
    const primaryTag = note.tags[0];
    const cluster = clusterMap.get(primaryTag);
    if (!cluster) {
      orphanNotes.push(note);
      continue;
    }
    const idx = clusterNoteIndex.get(primaryTag) ?? 0;
    const angle = idx * GOLDEN_ANGLE;
    const r = noteOrbitR * (0.65 + 0.45 * ((idx * 0.618) % 1));
    notePos.set(note.id, {
      x: cluster.x + Math.cos(angle) * r,
      y: cluster.y + Math.sin(angle) * r,
    });
    noteColor.set(note.id, cluster.color);
    clusterNoteIndex.set(primaryTag, idx + 1);
  }

  // Orphan notes orbit the center
  orphanNotes.forEach((note, i) => {
    const angle = i * GOLDEN_ANGLE;
    const r = noteOrbitR * 0.45;
    notePos.set(note.id, {
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
    });
    noteColor.set(note.id, NODE_COLORS[i % NODE_COLORS.length]);
  });

  return { notePos, noteColor, clusters: clusterLayouts };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function asNote(raw: SecondBrainSearchResult['raw']): SecondBrainNote | null {
  const candidate = raw as SecondBrainNote;
  return candidate?.note_kind ? candidate : null;
}

function dateLabel(value?: string | null): string {
  if (!value) return 'unknown';
  try { return new Date(value).toLocaleDateString(); } catch { return 'unknown'; }
}

function memoryLabel(mem: MemoryEntry): string {
  const surface = mem.source_surface ? ` · ${mem.source_surface}` : '';
  return `${mem.scope}/${mem.memory_kind}${surface}`;
}

function noteRadius(note: SecondBrainNote): number {
  return 7 + Math.min(7, (note.importance || 1) * 1.4);
}

// ─── Sub-components: graph primitives ────────────────────────────────────────

function EdgeLine({
  x1, y1, x2, y2, strength, active, highlight, accentColor,
}: {
  x1: number; y1: number; x2: number; y2: number;
  strength: number; active: boolean; highlight: boolean; accentColor: string;
}) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length < 2) return null;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const opacity = active
    ? 0.55 + strength * 0.35
    : highlight
      ? 0.2 + strength * 0.2
      : 0.05 + strength * 0.09;
  const color = active ? accentColor : '#94a3b8';
  const h = active ? 1.5 : 1;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: midX - length / 2,
        top: midY - h / 2,
        width: length,
        height: h,
        backgroundColor: color,
        opacity,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  );
}

function ClusterHub({ cluster, dimmed }: { cluster: ClusterLayout; dimmed: boolean }) {
  const { x, y, radius, color, tag, count } = cluster;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: x - radius,
        top: y - radius,
        width: radius * 2,
        height: radius * 2,
        borderRadius: radius,
        backgroundColor: `${color}18`,
        borderWidth: 1.5,
        borderColor: `${color}${dimmed ? '33' : '55'}`,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: dimmed ? 0.3 : 1,
        ...(Platform.OS === 'web'
          ? { boxShadow: `0 0 ${radius * 1.5}px ${color}28` } as object
          : {}),
      }}
    >
      <Text style={[styles.clusterHubTag, { color: `${color}${dimmed ? '66' : 'cc'}` }]}>
        #{tag}
      </Text>
      <Text style={styles.clusterHubCount}>{count}</Text>
    </View>
  );
}

function NoteDot({
  note,
  pos,
  color,
  isSelected,
  isConnected,
  dimmed,
  onSelect,
}: {
  note: SecondBrainNote;
  pos: GraphPosition;
  color: string;
  isSelected: boolean;
  isConnected: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const r = noteRadius(note);
  const hitR = Math.max(r * 2.5, 18);
  return (
    <Pressable
      onPress={onSelect}
      style={({ hovered, pressed }: any) => ({
        position: 'absolute',
        left: pos.x - hitR,
        top: pos.y - hitR,
        width: hitR * 2,
        height: hitR * 2,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: dimmed ? 0.18 : pressed ? 0.75 : 1,
        ...(Platform.OS === 'web' ? { cursor: 'pointer' } as object : {}),
      })}
    >
      {(isSelected || isConnected) && (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: r * 4,
            height: r * 4,
            borderRadius: r * 2,
            backgroundColor: `${color}18`,
          }}
        />
      )}
      <View
        style={{
          width: r * 2,
          height: r * 2,
          borderRadius: r,
          backgroundColor: isSelected ? color : `${color}cc`,
          borderWidth: isSelected ? 2 : 1,
          borderColor: isSelected ? '#ffffff99' : `${color}88`,
          ...(Platform.OS === 'web' ? {
            boxShadow: isSelected
              ? `0 0 ${r * 3}px ${color}, 0 0 ${r}px ${color}66`
              : isConnected
                ? `0 0 ${r * 2}px ${color}88`
                : `0 0 ${r}px ${color}44`,
          } as object : {}),
        }}
      />
    </Pressable>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function SecondBrainDashboard({
  circleId, userId, accentColor = '#22d3ee', onOpenCompartment,
}: Props) {
  const [notes, setNotes] = useState<SecondBrainNote[]>([]);
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [graph, setGraph] = useState<SecondBrainGraph | null>(null);
  const [filter, setFilter] = useState<BrainFilter>('active');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [url, setUrl] = useState('');
  const [content, setContent] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SecondBrainSearchResult[] | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [graphAreaSize, setGraphAreaSize] = useState({ width: 0, height: 0 });

  const load = useCallback(async () => {
    setLoading(true);
    const [graphResult, memoryResult] = await Promise.all([
      buildSecondBrainGraph(circleId),
      import('../lib/agentMemory')
        .then((mod) => mod.getUserMemories(circleId, userId))
        .catch(() => ({ circle: [], user: [], session: [], agent: [], total: 0 })),
    ]);
    setGraph(graphResult.graph);
    setNotes(graphResult.graph.notes);
    const loaded = [
      ...(memoryResult.circle || []),
      ...(memoryResult.user || []),
      ...(memoryResult.session || []),
      ...((memoryResult as any).agent || []),
    ];
    setMemories(loaded);
    if (graphResult.missing) {
      setStatus('Second brain migration is not deployed yet. Run the SQL migration and refresh.');
    } else if (graphResult.error) {
      setStatus(graphResult.error);
    } else {
      setStatus('');
    }
    setLoading(false);
  }, [circleId, userId]);

  useEffect(() => { load(); }, [load]);

  const visibleNotes = useMemo(() => {
    const source = filter === 'active'
      ? notes.filter((n) => n.status !== 'archived')
      : notes.filter((n) => n.status === filter);
    return source.slice().sort((a, b) => {
      const rank = (b.importance || 0) - (a.importance || 0);
      if (rank !== 0) return rank;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
  }, [filter, notes]);

  const selectedNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) ?? visibleNotes[0] ?? null,
    [notes, selectedNoteId, visibleNotes],
  );

  const graphNotes = useMemo(
    () => (graph?.notes || notes).filter((n) => n.status !== 'archived').slice(0, 20),
    [graph?.notes, notes],
  );

  const graphNoteIds = useMemo(() => new Set(graphNotes.map((n) => n.id)), [graphNotes]);

  const graphLinks = useMemo(
    () => (graph?.links || [])
      .filter((l) => graphNoteIds.has(l.from) && graphNoteIds.has(l.to))
      .slice(0, 45),
    [graph?.links, graphNoteIds],
  );

  const layout = useMemo(() => {
    if (!graphAreaSize.width || !graphAreaSize.height) {
      return { notePos: new Map<string, GraphPosition>(), noteColor: new Map<string, string>(), clusters: [] };
    }
    return computeGraphLayout(graphNotes, graph?.clusters || [], graphAreaSize.width, graphAreaSize.height);
  }, [graphNotes, graph?.clusters, graphAreaSize]);

  const selectedLinks = useMemo(() => {
    if (!selectedNote) return graphLinks.slice(0, 8);
    return graphLinks.filter((l) => l.from === selectedNote.id || l.to === selectedNote.id).slice(0, 8);
  }, [graphLinks, selectedNote]);

  const connectedNoteIds = useMemo(
    () => new Set(selectedLinks.flatMap((l) => [l.from, l.to])),
    [selectedLinks],
  );

  const inboxCount = notes.filter((n) => n.status === 'inbox').length;
  const evergreenCount = notes.filter((n) => n.status === 'evergreen').length;
  const webCount = notes.filter((n) => n.note_kind === 'web_clip').length;
  const linkedMemoryCount = notes.filter((n) => Boolean(n.source_memory_id)).length;

  const handleCapture = async (kind: 'note' | 'web_clip') => {
    if (!userId) { setStatus('Sign in before saving to the circle digital brain.'); return; }
    const body = content.trim();
    const sourceUrl = url.trim();
    if (!body && !sourceUrl) { setStatus('Add note content or a URL first.'); return; }
    setSaving(true);
    const result = await createSecondBrainNote({
      circleId, userId, title,
      url: sourceUrl || undefined,
      content: body || sourceUrl,
      noteKind: kind,
      status: kind === 'web_clip' ? 'inbox' : 'processed',
      visibility: 'circle_shared',
      metadata: { surface: 'backpack', captureMode: kind },
    });
    setSaving(false);
    if (result.note) {
      setTitle(''); setUrl(''); setContent('');
      setSelectedNoteId(result.note.id);
      setStatus('Saved to the .web digital brain.');
      await load();
    } else {
      setStatus(result.missing
        ? 'Second brain database migration is not deployed yet.'
        : result.error || 'Could not save note.');
    }
  };

  const handleSearch = async () => {
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    setSaving(true);
    const result = await searchSecondBrain(circleId, searchQuery, { includeMemories: true, limit: 14 });
    setSearchResults(result.results);
    setSaving(false);
    if (result.error) setStatus(result.error);
  };

  const handlePromoteNote = async (note: SecondBrainNote, scope: 'circle' | 'user') => {
    if (!userId) { setStatus('Sign in before promoting notes into memory.'); return; }
    setSaving(true);
    const result = await promoteSecondBrainNoteToMemory(note, { userId, scope });
    setSaving(false);
    if (result.memory) {
      setStatus(`Promoted "${note.title}" into ${scope} agent memory.`);
      await load();
    } else {
      setStatus(result.error || 'Could not promote note.');
    }
  };

  const handleMark = async (note: SecondBrainNote, nextStatus: SecondBrainNote['status']) => {
    setSaving(true);
    const result = await updateSecondBrainNote(note.id, { status: nextStatus });
    setSaving(false);
    if (result.note) {
      setStatus(`Marked "${note.title}" as ${nextStatus}.`);
      await load();
    } else {
      setStatus(result.error || 'Could not update note.');
    }
  };

  const handleImportMemory = async (mem: MemoryEntry) => {
    if (!userId) { setStatus('Sign in before importing agent memory.'); return; }
    setSaving(true);
    const result = await createSecondBrainNoteFromMemory(mem, userId);
    setSaving(false);
    if (result.note) {
      setSelectedNoteId(result.note.id);
      setStatus('Agent memory linked into the .web digital brain.');
      await load();
    } else {
      setStatus(result.missing
        ? 'Second brain database migration is not deployed yet.'
        : result.error || 'Could not import memory.');
    }
  };

  const resultNotes = (searchResults || []).filter((i) => i.kind === 'note');
  const resultMemories = (searchResults || []).filter((i) => i.kind === 'memory');

  const hasSelection = selectedNote !== null;
  const selectedPos = selectedNote ? layout.notePos.get(selectedNote.id) : null;
  const selRadius = selectedNote ? noteRadius(selectedNote) : 7;

  return (
    <View style={styles.shell}>

      {/* ── Full-height graph stage ─────────────────────────────────────── */}
      <View style={styles.graphStage}>

        {/* Header */}
        <View style={styles.graphStageTop}>
          <View style={styles.heroEyebrowRow}>
            <View style={[styles.dotWebMark, { borderColor: accentColor }]}>
              <Text style={[styles.dotWebText, { color: accentColor }]}>.web</Text>
            </View>
            <View>
              <Text style={styles.heroEyebrow}>CIRCLE SECOND BRAIN</Text>
              <Text style={styles.graphStageTitle}>Digital Brain Graph</Text>
            </View>
          </View>
          <View style={styles.heroActions}>
            <Pressable
              onPress={load}
              style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
            >
              <Text style={styles.ghostBtnText}>REFRESH</Text>
            </Pressable>
            {onOpenCompartment ? (
              <Pressable
                onPress={() => onOpenCompartment('projects')}
                style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
              >
                <Text style={styles.ghostBtnText}>PROJECTS</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {/* Stats row */}
        <View style={styles.graphStageStats}>
          <BrainStat label="Nodes" value={String(notes.length)} color={accentColor} />
          <BrainStat label="Clusters" value={String(graph?.clusters.length || 0)} color="#22c55e" />
          <BrainStat label="Links" value={String(graphLinks.length)} color="#a855f7" />
          <BrainStat label=".web clips" value={String(webCount)} color="#38bdf8" />
        </View>

        {/* Graph canvas */}
        <View style={styles.graphCanvas}>
          <View style={styles.graphCanvasBar}>
            <Text style={styles.graphCanvasTitle}>Knowledge Graph</Text>
            <Text style={styles.graphCanvasMeta}>
              {graphNotes.length} nodes · {layout.clusters.length} clusters · {graphLinks.length} edges
            </Text>
          </View>

          <View
            style={styles.graphArea}
            onLayout={(e) => setGraphAreaSize({
              width: e.nativeEvent.layout.width,
              height: e.nativeEvent.layout.height,
            })}
          >
            {loading ? (
              <ActivityIndicator color={accentColor} style={styles.graphLoader} />
            ) : graphNotes.length === 0 ? (
              <View style={styles.graphEmptyState}>
                <Text style={styles.emptyTitle}>NO BRAIN NODES YET</Text>
                <Text style={styles.emptyText}>
                  Capture a web clip, save a note, or link an agent memory below.
                  {'\n'}The graph will build here automatically.
                </Text>
              </View>
            ) : graphAreaSize.width > 0 ? (
              <>
                {/* Decorative center rings */}
                <CenterRings
                  cx={graphAreaSize.width / 2}
                  cy={graphAreaSize.height / 2}
                  accentColor={accentColor}
                />

                {/* Edges */}
                {graphLinks.map((link, i) => {
                  const from = layout.notePos.get(link.from);
                  const to = layout.notePos.get(link.to);
                  if (!from || !to) return null;
                  const active = link.from === selectedNote?.id || link.to === selectedNote?.id;
                  const highlight = !hasSelection;
                  return (
                    <EdgeLine
                      key={`edge-${i}`}
                      x1={from.x} y1={from.y}
                      x2={to.x} y2={to.y}
                      strength={link.strength}
                      active={active}
                      highlight={highlight}
                      accentColor={accentColor}
                    />
                  );
                })}

                {/* Cluster hubs */}
                {layout.clusters.map((cluster) => (
                  <ClusterHub
                    key={cluster.tag}
                    cluster={cluster}
                    dimmed={hasSelection && !connectedNoteIds.has(cluster.tag)}
                  />
                ))}

                {/* Note dots */}
                {graphNotes.map((note) => {
                  const pos = layout.notePos.get(note.id);
                  if (!pos) return null;
                  const color = layout.noteColor.get(note.id) ?? accentColor;
                  const isSelected = note.id === selectedNote?.id;
                  const isConnected = connectedNoteIds.has(note.id);
                  return (
                    <NoteDot
                      key={note.id}
                      note={note}
                      pos={pos}
                      color={color}
                      isSelected={isSelected}
                      isConnected={isConnected}
                      dimmed={hasSelection && !isSelected && !isConnected}
                      onSelect={() => setSelectedNoteId(note.id)}
                    />
                  );
                })}

                {/* Floating label for selected note */}
                {selectedNote && selectedPos ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.nodeLabel,
                      {
                        left: Math.min(
                          graphAreaSize.width - 148,
                          Math.max(4, selectedPos.x + selRadius + 6),
                        ),
                        top: Math.max(4, selectedPos.y - 14),
                      },
                    ]}
                  >
                    <Text style={styles.nodeLabelText} numberOfLines={2}>
                      {selectedNote.title}
                    </Text>
                  </View>
                ) : null}

                {/* Cluster legend */}
                {layout.clusters.length > 0 ? (
                  <View
                    pointerEvents="none"
                    style={styles.clusterLegend}
                  >
                    {layout.clusters.slice(0, 6).map((c) => (
                      <View key={c.tag} style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: c.color }]} />
                        <Text style={[styles.legendTag, { color: `${c.color}aa` }]}>
                          #{c.tag}
                        </Text>
                      </View>
                    ))}
                    {layout.clusters.length > 6 ? (
                      <Text style={styles.legendMore}>+{layout.clusters.length - 6}</Text>
                    ) : null}
                  </View>
                ) : null}
              </>
            ) : null}
          </View>
        </View>

        {/* Selected node detail dock */}
        <View style={styles.graphDetailDock}>
          <View style={styles.selectedPanel}>
            <Text style={styles.columnTitle}>SELECTED NODE</Text>
            {selectedNote ? (
              <>
                <View style={styles.nodeDetailHeader}>
                  <View style={[
                    styles.kindBadge,
                    { borderColor: layout.noteColor.get(selectedNote.id) ?? accentColor },
                  ]}>
                    <Text style={[
                      styles.kindBadgeText,
                      { color: layout.noteColor.get(selectedNote.id) ?? accentColor },
                    ]}>
                      {selectedNote.note_kind.replace('_', ' ').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.cardMeta}>
                    {selectedNote.status} · {dateLabel(selectedNote.updated_at)}
                  </Text>
                </View>
                <Text style={styles.cardTitle}>{selectedNote.title}</Text>
                <Text style={styles.cardBody}>
                  {summarizeSecondBrainContent(selectedNote.content, 260)}
                </Text>
                {selectedNote.tags.length ? (
                  <View style={styles.tagRow}>
                    {selectedNote.tags.slice(0, 8).map((tag) => (
                      <Text key={tag} style={styles.tag}>#{tag}</Text>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <Text style={styles.emptyText}>Tap any node in the graph to inspect it here.</Text>
            )}
          </View>

          <View style={styles.selectedPanel}>
            <Text style={styles.columnTitle}>
              CONNECTIONS{selectedLinks.length ? ` (${selectedLinks.length})` : ''}
            </Text>
            {selectedLinks.length ? (
              selectedLinks.map((link, i) => {
                const peer = notes.find((n) => n.id === (link.from === selectedNote?.id ? link.to : link.from));
                return (
                  <Pressable
                    key={`${link.from}:${link.to}:${i}`}
                    onPress={() => {
                      const peerId = link.from === selectedNote?.id ? link.to : link.from;
                      setSelectedNoteId(peerId);
                    }}
                    style={({ hovered, pressed }: any) => [
                      styles.linkRow,
                      hovered && webLift,
                      pressed && webPressed,
                    ]}
                  >
                    <View style={styles.linkRowHeader}>
                      <Text style={styles.linkType}>{link.label || 'related'}</Text>
                      <Text style={styles.linkStrength}>
                        {Math.round(link.strength * 100)}%
                      </Text>
                    </View>
                    {peer ? (
                      <Text style={styles.linkPeerTitle} numberOfLines={1}>{peer.title}</Text>
                    ) : null}
                    {link.reason ? (
                      <Text style={styles.linkReason}>{link.reason}</Text>
                    ) : null}
                  </Pressable>
                );
              })
            ) : (
              <Text style={styles.emptyText}>
                Connections form as notes share tags or get promoted into memory.
              </Text>
            )}
          </View>
        </View>
      </View>

      {/* ── Status bar ─────────────────────────────────────────────────── */}
      {status ? (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>{status}</Text>
        </View>
      ) : null}

      {/* ── Summary stat strip ─────────────────────────────────────────── */}
      <View style={styles.statStrip}>
        <BrainStat label="Total" value={String(notes.length)} color={accentColor} />
        <BrainStat label="Inbox" value={String(inboxCount)} color="#f59e0b" />
        <BrainStat label="Evergreen" value={String(evergreenCount)} color="#22c55e" />
        <BrainStat label=".web" value={String(webCount)} color="#38bdf8" />
        <BrainStat label="Memory" value={String(linkedMemoryCount)} color="#a855f7" />
      </View>

      {/* ── Capture panel ──────────────────────────────────────────────── */}
      <View style={styles.capturePanelBelow}>
        <Text style={styles.panelLabel}>INBOX-FIRST CAPTURE</Text>
        <Text style={styles.panelHint}>Everything captured here feeds the graph above.</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Optional title"
          placeholderTextColor={PIXEL_COLORS.text3}
          style={styles.input}
        />
        <TextInput
          value={url}
          onChangeText={setUrl}
          placeholder="https:// source URL for .web capture"
          placeholderTextColor={PIXEL_COLORS.text3}
          autoCapitalize="none"
          style={styles.input}
        />
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder="Paste research, decisions, tasks, customer notes, or agent findings..."
          placeholderTextColor={PIXEL_COLORS.text3}
          multiline
          style={[styles.input, styles.textArea]}
        />
        <View style={styles.heroActions}>
          <Pressable
            onPress={() => handleCapture('web_clip')}
            style={({ hovered, pressed }: any) => [
              styles.primaryBtn,
              { backgroundColor: accentColor, borderColor: accentColor },
              hovered && webLift,
              pressed && webPressed,
            ]}
          >
            <Text style={styles.primaryBtnText}>{saving ? 'SAVING...' : 'SAVE WEB CLIP'}</Text>
          </Pressable>
          <Pressable
            onPress={() => handleCapture('note')}
            style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
          >
            <Text style={styles.ghostBtnText}>SAVE NOTE</Text>
          </Pressable>
        </View>
      </View>

      {/* ── Semantic search ────────────────────────────────────────────── */}
      <View style={styles.searchPanel}>
        <Text style={styles.panelLabel}>SEMANTIC SEARCH</Text>
        <View style={styles.searchRow}>
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            placeholder="Ask the brain anything saved in this circle..."
            placeholderTextColor={PIXEL_COLORS.text3}
            style={[styles.input, { flex: 1 }]}
          />
          <Pressable
            onPress={handleSearch}
            style={({ hovered, pressed }: any) => [
              styles.primaryBtn,
              { borderColor: accentColor, backgroundColor: accentColor },
              hovered && webLift,
              pressed && webPressed,
            ]}
          >
            <Text style={styles.primaryBtnText}>{saving ? '...' : 'SEARCH'}</Text>
          </Pressable>
          {searchResults ? (
            <Pressable
              onPress={() => { setSearchQuery(''); setSearchResults(null); }}
              style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
            >
              <Text style={styles.ghostBtnText}>CLEAR</Text>
            </Pressable>
          ) : null}
        </View>
        {searchResults ? (
          <View style={styles.resultGrid}>
            <View style={styles.resultColumn}>
              <Text style={styles.columnTitle}>NOTE MATCHES</Text>
              {resultNotes.length ? resultNotes.map((item) => {
                const note = asNote(item.raw);
                return (
                  <Pressable
                    key={`note-${item.id}`}
                    onPress={() => note && setSelectedNoteId(note.id)}
                    style={({ hovered, pressed }: any) => [styles.resultCard, hovered && webLift, pressed && webPressed]}
                  >
                    <Text style={styles.cardTitle}>{item.title}</Text>
                    <Text style={styles.cardMeta}>
                      {item.source || 'note'}{item.similarity != null ? ` · ${Math.round(item.similarity * 100)}%` : ''}
                    </Text>
                    <Text style={styles.cardBody}>
                      {summarizeSecondBrainContent(item.summary || item.content, 180)}
                    </Text>
                  </Pressable>
                );
              }) : <Text style={styles.emptyText}>No note matches yet.</Text>}
            </View>
            <View style={styles.resultColumn}>
              <Text style={styles.columnTitle}>AGENT MEMORY MATCHES</Text>
              {resultMemories.length ? resultMemories.map((item) => (
                <View key={`mem-${item.id}`} style={styles.resultCard}>
                  <Text style={styles.cardTitle}>{item.title}</Text>
                  <Text style={styles.cardMeta}>
                    {item.source || 'agent memory'}{item.similarity != null ? ` · ${Math.round(item.similarity * 100)}%` : ''}
                  </Text>
                  <Text style={styles.cardBody}>
                    {summarizeSecondBrainContent(item.content, 180)}
                  </Text>
                </View>
              )) : <Text style={styles.emptyText}>No memory matches yet.</Text>}
            </View>
          </View>
        ) : null}
      </View>

      {/* ── Main grid: notes + memories ────────────────────────────────── */}
      <View style={styles.mainGrid}>
        <View style={styles.leftColumn}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.panelLabel}>KNOWLEDGE NODES</Text>
              <Text style={styles.panelHint}>Promote inbox notes to evergreen or agent memory.</Text>
            </View>
            <View style={styles.filterRow}>
              {(['active', 'inbox', 'processed', 'evergreen'] as BrainFilter[]).map((item) => (
                <Pressable
                  key={item}
                  onPress={() => setFilter(item)}
                  style={({ hovered, pressed }: any) => [
                    styles.filterBtn,
                    filter === item ? { borderColor: accentColor, backgroundColor: `${accentColor}18` } : null,
                    hovered && webLift,
                    pressed && webPressed,
                  ]}
                >
                  <Text style={[styles.filterText, filter === item ? { color: accentColor } : null]}>
                    {item.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>

          {loading ? (
            <ActivityIndicator color={accentColor} style={{ padding: 20 }} />
          ) : visibleNotes.length ? visibleNotes.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              active={selectedNote?.id === note.id}
              accentColor={accentColor}
              onSelect={() => setSelectedNoteId(note.id)}
              onMark={handleMark}
              onPromote={handlePromoteNote}
            />
          )) : (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>NO NODES YET</Text>
              <Text style={styles.emptyText}>
                Save a web clip, import an agent memory, or capture a note to start building.
              </Text>
            </View>
          )}
        </View>

        <View style={styles.rightColumn}>
          <View style={styles.memoryPanel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.panelLabel}>AGENT MEMORIES</Text>
                <Text style={styles.panelHint}>Pull durable memories into the digital brain.</Text>
              </View>
              {onOpenCompartment ? (
                <Pressable
                  onPress={() => onOpenCompartment('terminal')}
                  style={({ hovered, pressed }: any) => [styles.ghostBtn, hovered && webLift, pressed && webPressed]}
                >
                  <Text style={styles.ghostBtnText}>COMMAND</Text>
                </Pressable>
              ) : null}
            </View>
            <ScrollView style={styles.memoryList} nestedScrollEnabled>
              {memories.slice(0, 8).map((mem) => (
                <View key={mem.id} style={styles.memoryCard}>
                  <Text style={styles.cardTitle}>{mem.title}</Text>
                  <Text style={styles.cardMeta}>{memoryLabel(mem)}</Text>
                  <Text style={styles.cardBody}>
                    {summarizeSecondBrainContent(mem.content, 140)}
                  </Text>
                  <Pressable
                    onPress={() => handleImportMemory(mem)}
                    style={({ hovered, pressed }: any) => [styles.miniBtn, hovered && webLift, pressed && webPressed]}
                  >
                    <Text style={styles.miniBtnText}>LINK TO BRAIN</Text>
                  </Pressable>
                </View>
              ))}
              {!memories.length ? (
                <Text style={styles.emptyText}>No circle memories loaded yet.</Text>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </View>
    </View>
  );
}

// ─── Decorative center rings ──────────────────────────────────────────────────

function CenterRings({ cx, cy, accentColor }: { cx: number; cy: number; accentColor: string }) {
  const rings = [
    { r: 18, opacity: 0.35 },
    { r: 34, opacity: 0.18 },
    { r: 54, opacity: 0.09 },
  ];
  return (
    <>
      {rings.map(({ r, opacity }, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: cx - r,
            top: cy - r,
            width: r * 2,
            height: r * 2,
            borderRadius: r,
            borderWidth: 1,
            borderColor: `${accentColor}`,
            opacity,
          }}
        />
      ))}
      {/* Center dot */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: cx - 3,
          top: cy - 3,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: accentColor,
          opacity: 0.5,
        }}
      />
    </>
  );
}

// ─── BrainStat ────────────────────────────────────────────────────────────────

function BrainStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={[styles.brainStat, { borderColor: `${color}30` }]}>
      <Text style={[styles.brainStatValue, { color }]}>{value}</Text>
      <Text style={styles.brainStatLabel}>{label}</Text>
    </View>
  );
}

// ─── NoteCard ─────────────────────────────────────────────────────────────────

function NoteCard({
  note, active, accentColor, onSelect, onMark, onPromote,
}: {
  note: SecondBrainNote;
  active: boolean;
  accentColor: string;
  onSelect: () => void;
  onMark: (note: SecondBrainNote, status: SecondBrainNote['status']) => void;
  onPromote: (note: SecondBrainNote, scope: 'circle' | 'user') => void;
}) {
  const sourceUrl = typeof note.metadata?.sourceUrl === 'string' ? note.metadata.sourceUrl : '';
  return (
    <Pressable
      onPress={onSelect}
      style={({ hovered, pressed }: any) => [
        styles.noteCard,
        active ? { borderColor: accentColor, backgroundColor: `${accentColor}0f` } : null,
        hovered && webLift,
        pressed && webPressed,
      ]}
    >
      <View style={styles.noteTop}>
        <View style={[styles.kindBadge, { borderColor: active ? accentColor : PIXEL_COLORS.border1 }]}>
          <Text style={[styles.kindBadgeText, { color: active ? accentColor : PIXEL_COLORS.text2 }]}>
            {note.note_kind.replace('_', ' ').toUpperCase()}
          </Text>
        </View>
        <Text style={styles.cardMeta}>{note.status.toUpperCase()} · {dateLabel(note.updated_at)}</Text>
      </View>
      <Text style={styles.cardTitle}>{note.title}</Text>
      {sourceUrl ? <Text style={styles.sourceUrl} numberOfLines={1}>{sourceUrl}</Text> : null}
      <Text style={styles.cardBody}>{summarizeSecondBrainContent(note.summary || note.content, 220)}</Text>
      {note.tags.length ? (
        <View style={styles.tagRow}>
          {note.tags.slice(0, 6).map((tag) => (
            <Text key={tag} style={styles.tag}>#{tag}</Text>
          ))}
        </View>
      ) : null}
      <View style={styles.actionRow}>
        <Pressable onPress={() => onMark(note, 'evergreen')} style={styles.miniBtn}>
          <Text style={styles.miniBtnText}>EVERGREEN</Text>
        </Pressable>
        <Pressable onPress={() => onPromote(note, 'circle')} style={styles.miniBtn}>
          <Text style={styles.miniBtnText}>MEMORY</Text>
        </Pressable>
        <Pressable onPress={() => onPromote(note, 'user')} style={styles.miniBtn}>
          <Text style={styles.miniBtnText}>PRIVATE</Text>
        </Pressable>
        <Pressable onPress={() => onMark(note, 'archived')} style={styles.miniBtnDanger}>
          <Text style={styles.miniBtnDangerText}>ARCHIVE</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ─── Interaction helpers ──────────────────────────────────────────────────────

const webLift = Platform.OS === 'web' ? ({
  transform: [{ translateY: -1 }],
  boxShadow: '0 8px 20px rgba(0,0,0,0.28)',
} as any) : null;

const webPressed = Platform.OS === 'web' ? ({ transform: [{ scale: 0.99 }] } as any) : null;

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  shell: {
    marginHorizontal: GRID.lg,
    marginBottom: GRID.xl,
    gap: GRID.md,
  },

  // Graph stage
  graphStage: {
    minHeight: Platform.OS === 'web' ? ('calc(100vh - 132px)' as any) : 720,
    borderWidth: 1,
    borderColor: '#22d3ee33',
    borderRadius: 4,
    backgroundColor: '#060c14',
    padding: GRID.lg,
    gap: GRID.md,
    overflow: 'hidden',
    ...Platform.select({
      web: {
        backgroundImage: [
          'radial-gradient(circle at 15% 18%, rgba(34,211,238,0.18), transparent 28%)',
          'radial-gradient(circle at 76% 20%, rgba(168,85,247,0.18), transparent 26%)',
          'radial-gradient(circle at 50% 80%, rgba(34,197,94,0.12), transparent 28%)',
          'linear-gradient(145deg, #030810 0%, #0c1525 55%, #020610 100%)',
        ].join(', '),
        boxShadow: `0 0 0 1px #22d3ee22, inset 0 1px 0 #ffffff08`,
      } as any,
      default: {},
    }),
  },
  graphStageTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: GRID.md,
    flexWrap: 'wrap',
  },
  graphStageTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 22,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  graphStageStats: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
  },

  // Graph canvas
  graphCanvas: {
    flex: 1,
    minHeight: 440,
    borderWidth: 1,
    borderColor: '#ffffff14',
    borderRadius: 4,
    backgroundColor: '#020914',
    overflow: 'hidden',
    ...Platform.select({
      web: {
        backgroundImage: [
          'radial-gradient(circle at 50% 50%, rgba(34,211,238,0.07), transparent 58%)',
          'radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: '100% 100%, 28px 28px',
      } as any,
      default: {},
    }),
  },
  graphCanvasBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: GRID.md,
    paddingTop: GRID.sm,
    paddingBottom: GRID.xs,
  },
  graphCanvasTitle: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  graphCanvasMeta: {
    color: PIXEL_COLORS.text3,
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 0.4,
  },
  graphArea: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  graphLoader: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    alignSelf: 'center',
    paddingTop: 80,
  },
  graphEmptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: GRID.sm,
    padding: GRID.xl,
  },

  // Node label overlay
  nodeLabel: {
    position: 'absolute',
    maxWidth: 144,
    backgroundColor: '#060c14ee',
    borderWidth: 1,
    borderColor: '#ffffff18',
    borderRadius: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  nodeLabelText: {
    color: PIXEL_COLORS.text0,
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    lineHeight: 14,
  },

  // Cluster hub labels
  clusterHubTag: {
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  clusterHubCount: {
    color: PIXEL_COLORS.text3,
    fontSize: 8,
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: 1,
  },

  // Legend
  clusterLegend: {
    position: 'absolute',
    bottom: GRID.sm,
    left: GRID.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
    alignItems: 'center',
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    opacity: 0.8,
  },
  legendTag: {
    fontSize: 9,
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  legendMore: {
    color: PIXEL_COLORS.text3,
    fontSize: 9,
    fontFamily: 'monospace',
  },

  // Detail dock
  graphDetailDock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
  },
  selectedPanel: {
    flexGrow: 1,
    minWidth: 280,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: '#0c1220',
    padding: GRID.md,
    gap: GRID.sm,
  },
  nodeDetailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
    flexWrap: 'wrap',
  },
  linkRow: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: '#060c14',
    padding: GRID.sm,
    gap: 3,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  linkRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: GRID.sm,
  },
  linkType: {
    color: '#38bdf8',
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },
  linkStrength: {
    color: PIXEL_COLORS.text3,
    fontSize: 9,
    fontFamily: 'monospace',
  },
  linkPeerTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  linkReason: {
    color: PIXEL_COLORS.text2,
    fontSize: 10,
    fontFamily: 'monospace',
    lineHeight: 14,
  },

  // Eyebrow / header
  heroEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: GRID.sm,
  },
  dotWebMark: {
    borderWidth: 2,
    borderRadius: 2,
    paddingHorizontal: GRID.sm,
    paddingVertical: 4,
    backgroundColor: '#00000055',
  },
  dotWebText: {
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  heroEyebrow: {
    color: PIXEL_COLORS.text3,
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 2.5,
  },
  heroActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
  },

  // Stat strip
  statStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
  },
  brainStat: {
    flexGrow: 1,
    minWidth: 110,
    borderWidth: 1,
    borderRadius: 3,
    backgroundColor: '#0a0f1c',
    paddingHorizontal: GRID.md,
    paddingVertical: GRID.sm,
    gap: 2,
  },
  brainStatValue: {
    fontSize: 24,
    fontWeight: '900',
    fontFamily: 'monospace',
    lineHeight: 28,
  },
  brainStatLabel: {
    color: PIXEL_COLORS.text3,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  // Capture panel
  capturePanelBelow: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg1,
    padding: GRID.md,
    gap: GRID.sm,
  },

  // Inputs
  panelLabel: {
    color: PIXEL_COLORS.text2,
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 2.5,
    textTransform: 'uppercase',
  },
  panelHint: {
    color: PIXEL_COLORS.text3,
    fontSize: 10,
    fontFamily: 'monospace',
    marginTop: 1,
  },
  input: {
    backgroundColor: PIXEL_COLORS.bg2,
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    color: PIXEL_COLORS.text0,
    fontSize: 12,
    fontFamily: 'monospace',
    paddingHorizontal: GRID.md,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  textArea: {
    minHeight: 104,
    textAlignVertical: 'top',
  },

  // Buttons
  primaryBtn: {
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: GRID.md,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  primaryBtnText: {
    color: '#040c14',
    fontSize: 10,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1,
  },
  ghostBtn: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    paddingHorizontal: GRID.md,
    paddingVertical: 10,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  ghostBtnText: {
    color: PIXEL_COLORS.text1,
    fontSize: 10,
    fontWeight: '800',
    fontFamily: 'monospace',
    letterSpacing: 0.8,
  },

  // Status bar
  statusBar: {
    borderWidth: 1,
    borderColor: '#f59e0b35',
    backgroundColor: '#f59e0b0e',
    borderRadius: 3,
    padding: GRID.md,
  },
  statusText: {
    color: PIXEL_COLORS.text1,
    fontSize: 11,
    fontFamily: 'monospace',
  },

  // Search
  searchPanel: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg1,
    padding: GRID.md,
    gap: GRID.sm,
  },
  searchRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.sm,
    alignItems: 'stretch',
  },
  resultGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
  },
  resultColumn: {
    flex: 1,
    minWidth: 260,
    gap: GRID.sm,
  },

  // Main grid
  mainGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID.md,
  },
  leftColumn: {
    flex: 1.2,
    minWidth: 320,
    gap: GRID.sm,
  },
  rightColumn: {
    flex: 0.9,
    minWidth: 300,
    gap: GRID.md,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: GRID.sm,
    flexWrap: 'wrap',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  filterBtn: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 2,
    backgroundColor: PIXEL_COLORS.bg2,
    paddingHorizontal: 8,
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  filterText: {
    color: PIXEL_COLORS.text2,
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.6,
  },

  // Note cards
  noteCard: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.md,
    gap: GRID.sm,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  noteTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: GRID.sm,
    flexWrap: 'wrap',
  },
  kindBadge: {
    borderWidth: 1,
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
    backgroundColor: '#00000030',
  },
  kindBadgeText: {
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.6,
  },
  cardTitle: {
    color: PIXEL_COLORS.text0,
    fontSize: 13,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.3,
  },
  cardMeta: {
    color: PIXEL_COLORS.text3,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  cardBody: {
    color: PIXEL_COLORS.text1,
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 17,
  },
  sourceUrl: {
    color: '#38bdf8',
    fontSize: 10,
    fontFamily: 'monospace',
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  tag: {
    color: '#94a3b8',
    backgroundColor: '#ffffff09',
    borderWidth: 1,
    borderColor: '#ffffff14',
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 2,
    fontSize: 9,
    fontFamily: 'monospace',
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  miniBtn: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 2,
    backgroundColor: PIXEL_COLORS.bg1,
    paddingHorizontal: 7,
    paddingVertical: 5,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  miniBtnText: {
    color: PIXEL_COLORS.text1,
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.4,
  },
  miniBtnDanger: {
    borderWidth: 1,
    borderColor: '#ef444440',
    borderRadius: 2,
    backgroundColor: '#ef444410',
    paddingHorizontal: 7,
    paddingVertical: 5,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  miniBtnDangerText: {
    color: '#f87171',
    fontSize: 8,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 0.4,
  },

  // Memory panel
  memoryPanel: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg1,
    padding: GRID.md,
    gap: GRID.md,
  },
  memoryList: {
    maxHeight: 440,
  },
  memoryCard: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.sm,
    gap: 5,
    marginBottom: GRID.sm,
  },

  // Search results
  resultCard: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border1,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.sm,
    gap: 4,
    ...(Platform.OS === 'web' ? { transition: 'all 0.15s ease', cursor: 'pointer' } as any : {}),
  },
  columnTitle: {
    color: PIXEL_COLORS.text2,
    fontSize: 9,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },

  // Empty states
  emptyCard: {
    borderWidth: 1,
    borderColor: PIXEL_COLORS.border0,
    borderRadius: 3,
    backgroundColor: PIXEL_COLORS.bg2,
    padding: GRID.lg,
    gap: GRID.sm,
  },
  emptyTitle: {
    color: PIXEL_COLORS.text1,
    fontSize: 11,
    fontWeight: '900',
    fontFamily: 'monospace',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  emptyText: {
    color: PIXEL_COLORS.text3,
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
});
