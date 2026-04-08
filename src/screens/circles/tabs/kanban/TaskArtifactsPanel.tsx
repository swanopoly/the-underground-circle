/**
 * TaskArtifactsPanel -- Renders artifacts produced by a task run
 * Groups by artifact_kind, shows preview for code, text, links, etc.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet, Platform, Linking,
} from 'react-native';
import { supabase } from '../../../../lib/supabase';

interface Props {
  runId: string;
  circleId: string;
}

interface Artifact {
  id: string;
  run_id: string;
  artifact_kind: string;
  label: string;
  content: string | null;
  url: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
}

type ArtifactKind =
  | 'code_patch'
  | 'file'
  | 'image'
  | 'screenshot'
  | 'design_spec'
  | 'link'
  | 'doc'
  | 'report'
  | 'copy'
  | 'test_result';

const KIND_ICONS: Record<string, string> = {
  code_patch: '</>',
  file: '[]',
  image: '#',
  screenshot: '[S]',
  design_spec: '[D]',
  link: '->',
  doc: 'Dc',
  report: 'Rp',
  copy: 'Tx',
  test_result: 'Ts',
};

const KIND_COLORS: Record<string, string> = {
  code_patch: '#22c55e',
  file: '#3b82f6',
  image: '#ec4899',
  screenshot: '#f59e0b',
  design_spec: '#8b5cf6',
  link: '#06b6d4',
  doc: '#6366f1',
  report: '#6366f1',
  copy: '#a0a0b0',
  test_result: '#f59e0b',
};

const KIND_LABELS: Record<string, string> = {
  code_patch: 'Code Patches',
  file: 'Files',
  image: 'Images',
  screenshot: 'Screenshots',
  design_spec: 'Design Specs',
  link: 'Links',
  doc: 'Documents',
  report: 'Reports',
  copy: 'Copy',
  test_result: 'Test Results',
};

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function truncateContent(content: string, maxLines: number): string {
  const lines = content.split('\n');
  if (lines.length <= maxLines) return content;
  return lines.slice(0, maxLines).join('\n') + '\n...';
}

export default function TaskArtifactsPanel({ runId, circleId }: Props) {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchArtifacts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('task_run_artifacts')
        .select('id, run_id, artifact_kind, label, content, url, metadata, created_at')
        .eq('run_id', runId)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('[TaskArtifactsPanel] fetch error:', error.message);
      } else if (data) {
        setArtifacts(data);
      }
    } catch (err) {
      console.error('[TaskArtifactsPanel] fetch exception:', err);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    fetchArtifacts();

    const channel = supabase
      .channel(`task-run-artifacts-${runId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'task_run_artifacts',
        filter: `run_id=eq.${runId}`,
      }, () => fetchArtifacts())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [runId, fetchArtifacts]);

  // Group artifacts by kind
  const grouped = artifacts.reduce<Record<string, Artifact[]>>((acc, art) => {
    const kind = art.artifact_kind || 'file';
    if (!acc[kind]) acc[kind] = [];
    acc[kind].push(art);
    return acc;
  }, {});

  const getKindIcon = (kind: string): string => KIND_ICONS[kind] || '[]';
  const getKindColor = (kind: string): string => KIND_COLORS[kind] || '#6366f1';

  const handleLinkPress = (url: string) => {
    Linking.openURL(url).catch((err) =>
      console.warn('[TaskArtifactsPanel] link open error:', err)
    );
  };

  const renderArtifactPreview = (artifact: Artifact) => {
    const kind = artifact.artifact_kind as ArtifactKind;

    // Code / file: show first 10 lines as code block
    if (kind === 'code_patch' || kind === 'file') {
      if (!artifact.content) return null;
      return (
        <View style={s.codeBlock}>
          <Text style={s.codeText} numberOfLines={10}>
            {truncateContent(artifact.content, 10)}
          </Text>
        </View>
      );
    }

    // Image / screenshot / design_spec: placeholder
    if (kind === 'image' || kind === 'screenshot' || kind === 'design_spec') {
      return (
        <View style={s.imagePlaceholder}>
          <Text style={s.imagePlaceholderIcon}>{getKindIcon(kind)}</Text>
          <Text style={s.imagePlaceholderLabel}>
            {KIND_LABELS[kind] || kind}
          </Text>
        </View>
      );
    }

    // Link: clickable URL
    if (kind === 'link') {
      const url = artifact.url || artifact.content;
      if (!url) return null;
      return (
        <Pressable
          onPress={() => handleLinkPress(url)}
          style={s.linkRow}
          accessibilityRole="link"
        >
          <Text style={s.linkText} numberOfLines={1}>{url}</Text>
        </Pressable>
      );
    }

    // Doc / report / copy: text preview
    if (kind === 'doc' || kind === 'report' || kind === 'copy') {
      if (!artifact.content) return null;
      return (
        <Text style={s.textPreview} numberOfLines={4}>
          {artifact.content}
        </Text>
      );
    }

    // Test result: pass/fail badge
    if (kind === 'test_result') {
      const passed = artifact.metadata?.passed ?? artifact.content?.toLowerCase().includes('pass');
      return (
        <View style={s.testResultRow}>
          <View style={[s.testBadge, { backgroundColor: passed ? '#22c55e18' : '#ef444418' }]}>
            <Text style={[s.testBadgeText, { color: passed ? '#22c55e' : '#ef4444' }]}>
              {passed ? 'PASSED' : 'FAILED'}
            </Text>
          </View>
          {artifact.content ? (
            <Text style={s.testDetail} numberOfLines={2}>{artifact.content}</Text>
          ) : null}
        </View>
      );
    }

    // Fallback
    if (artifact.content) {
      return (
        <Text style={s.textPreview} numberOfLines={3}>{artifact.content}</Text>
      );
    }
    return null;
  };

  if (loading) {
    return (
      <View style={s.container} nativeID="section-task-artifacts">
        <View style={s.header}>
          <Text style={s.headerIcon}>[A]</Text>
          <Text style={s.headerTitle}>ARTIFACTS</Text>
        </View>
        <View style={s.empty}>
          <Text style={s.emptyText}>Loading artifacts...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={s.container} nativeID="section-task-artifacts">
      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerIcon}>[A]</Text>
        <Text style={s.headerTitle}>ARTIFACTS</Text>
        <View style={s.countBadge}>
          <Text style={s.countText}>{artifacts.length}</Text>
        </View>
      </View>

      {/* Artifacts */}
      <ScrollView
        style={s.list}
        contentContainerStyle={s.listContent}
        showsVerticalScrollIndicator={false}
      >
        {artifacts.length === 0 && (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>[]</Text>
            <Text style={s.emptyText}>No artifacts yet</Text>
            <Text style={s.emptySubtext}>Artifacts will appear as the run produces output</Text>
          </View>
        )}

        {Object.entries(grouped).map(([kind, items]) => (
          <View key={kind} style={s.group}>
            {/* Group header */}
            <View style={s.groupHeader}>
              <View style={[s.groupIconBox, { backgroundColor: getKindColor(kind) + '18', borderColor: getKindColor(kind) + '40' }]}>
                <Text style={[s.groupIconText, { color: getKindColor(kind) }]}>{getKindIcon(kind)}</Text>
              </View>
              <Text style={s.groupLabel}>{KIND_LABELS[kind] || kind}</Text>
              <Text style={s.groupCount}>{items.length}</Text>
            </View>

            {/* Artifact cards */}
            {items.map((artifact) => (
              <View key={artifact.id} style={s.card}>
                <View style={s.cardHeader}>
                  <Text style={s.cardLabel} numberOfLines={1}>{artifact.label}</Text>
                  <Text style={s.cardTimestamp}>{timeAgo(artifact.created_at)}</Text>
                </View>
                {renderArtifactPreview(artifact)}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a10',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: '#1a1a28',
    gap: 6,
  },
  headerIcon: {
    color: '#8b5cf6',
    fontSize: 11,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  headerTitle: {
    color: '#a0a0b0',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: 'monospace',
  },
  countBadge: {
    backgroundColor: '#1a1a28',
    borderRadius: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  countText: {
    color: '#606075',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  list: {
    flex: 1,
  },
  listContent: {
    padding: 12,
    paddingBottom: 24,
    gap: 16,
  },
  group: {
    gap: 8,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
  },
  groupIconBox: {
    width: 24,
    height: 24,
    borderRadius: 2,
    borderWidth: 2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  groupIconText: {
    fontSize: 9,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  groupLabel: {
    color: '#a0a0b0',
    fontSize: 12,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
    flex: 1,
  },
  groupCount: {
    color: '#606075',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  card: {
    backgroundColor: '#0f0f18',
    borderWidth: 2,
    borderColor: '#1a1a28',
    borderRadius: 2,
    padding: 10,
    gap: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardLabel: {
    color: '#f0f0f5',
    fontSize: 12,
    fontWeight: '600',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    flex: 1,
  },
  cardTimestamp: {
    color: '#606075',
    fontSize: 10,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  codeBlock: {
    backgroundColor: '#050508',
    borderWidth: 1,
    borderColor: '#1a1a28',
    borderRadius: 2,
    padding: 8,
  },
  codeText: {
    color: '#22c55e',
    fontSize: 11,
    fontFamily: 'monospace',
    lineHeight: 16,
  },
  imagePlaceholder: {
    backgroundColor: '#050508',
    borderWidth: 2,
    borderColor: '#1a1a28',
    borderRadius: 2,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  imagePlaceholderIcon: {
    color: '#2a2a3e',
    fontSize: 20,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  imagePlaceholderLabel: {
    color: '#606075',
    fontSize: 11,
    fontWeight: '600',
    fontFamily: 'monospace',
  },
  linkRow: {
    paddingVertical: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  linkText: {
    color: '#06b6d4',
    fontSize: 12,
    fontFamily: 'monospace',
    textDecorationLine: 'underline',
  },
  textPreview: {
    color: '#a0a0b0',
    fontSize: 12,
    lineHeight: 17,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  testResultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  testBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 2,
  },
  testBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: 'monospace',
    letterSpacing: 0.5,
  },
  testDetail: {
    flex: 1,
    color: '#a0a0b0',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 6,
  },
  emptyIcon: {
    color: '#2a2a3e',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'monospace',
  },
  emptyText: {
    color: '#606075',
    fontSize: 12,
    fontWeight: '500',
    fontFamily: 'monospace',
  },
  emptySubtext: {
    color: '#444455',
    fontSize: 11,
    fontFamily: 'monospace',
  },
});
