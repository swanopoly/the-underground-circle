import React, { useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from 'react-native';
import { ChatEntry, ChatRun, RUN_STATUS_CONFIG } from './chatTypes';
import type { PromptMemoryReference } from '../../../../lib/memoryService';
import type { ResearchDocumentReference } from '../../../../lib/researchControl';
import type { WikiArticleReference } from '../../../../lib/wikiData';
import type { SwanBotStructuredArtifact } from '../../../../lib/swanbot';
import {
  readMessageArtifacts,
  readMessageMemoriesUsed,
  readMessageMemoryRefs,
  readMessageResearchRefs,
  readMessageWikiRefs,
} from '../../../../lib/messageMetadataReaders';

interface Props {
  entries: ChatEntry[];
  runs: ChatRun[];
  onSelectRun: (run: ChatRun) => void;
  accentColor: string;
}

function formatMemoryRecencyLabel(ref: PromptMemoryReference): string {
  const timestamp = ref.lastAccessedAt || ref.updatedAt;
  if (!timestamp) return 'unknown freshness';
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageHours = ageMs / 3_600_000;
  if (ageHours < 24) return 'fresh today';
  const ageDays = ageHours / 24;
  if (ageDays < 7) return `${Math.max(1, Math.round(ageDays))}d old`;
  if (ageDays < 30) return `${Math.max(1, Math.round(ageDays / 7))}w old`;
  return `${Math.max(1, Math.round(ageDays / 30))}mo old`;
}

function formatMemoryStrengthLabel(ref: PromptMemoryReference): string {
  const score = ref.importance ?? 0.5;
  if (score >= 0.9) return 'core';
  if (score >= 0.75) return 'strong';
  if (score >= 0.6) return 'active';
  return 'light';
}

function formatMemoryStateLabel(ref: PromptMemoryReference): string {
  if (ref.memoryState === 'distilled') return 'distilled guidance';
  if (ref.retrievalMode === 'startup' && ref.pinned) return 'pinned startup';
  if (ref.retrievalMode === 'startup') return 'startup guidance';
  if (ref.pinned) return 'pinned';
  if (ref.memoryState === 'supporting') return 'supporting';
  return 'retrieved';
}

function formatMemoryTrustLabel(ref: PromptMemoryReference): string {
  const helpfulness = ref.helpfulness;
  if (helpfulness == null) return 'unrated';
  if (helpfulness >= 0.8) return 'trusted';
  if (helpfulness >= 0.6) return 'proven';
  if (helpfulness <= 0.3) return 'weak';
  return 'mixed';
}

function formatMemorySourceLabel(ref: PromptMemoryReference): string | null {
  switch (ref.sourceSurface) {
    case 'claude_code_bridge': return 'Claude Code';
    case 'codex_bridge': return 'Codex';
    case 'cursor_bridge': return 'Cursor';
    case 'gemini_bridge': return 'Gemini';
    default: return null;
  }
}

function formatEntryTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function UserBubble({ entry, accentColor }: { entry: ChatEntry; accentColor: string }) {
  return (
    <View style={styles.userRow}>
      <Text style={styles.timestampText}>{formatEntryTime(entry.createdAt)}</Text>
      <View style={[styles.userBubble, { backgroundColor: accentColor + '18', borderColor: accentColor + '45' }]}>
        <Text style={styles.userLabel}>You</Text>
        <Text style={styles.userText}>{entry.content}</Text>
      </View>
    </View>
  );
}

function AssistantBubble({ entry, accentColor }: { entry: ChatEntry; accentColor: string }) {
  const wikiRefs = readMessageWikiRefs(entry.metadata) as WikiArticleReference[];
  const researchRefs = readMessageResearchRefs(entry.metadata) as ResearchDocumentReference[];
  const memoryRefs = readMessageMemoryRefs(entry.metadata) as PromptMemoryReference[];
  const memoriesUsed = readMessageMemoriesUsed(entry.metadata);
  const artifacts = readMessageArtifacts(entry.metadata) as SwanBotStructuredArtifact[];

  return (
    <View style={styles.assistantRow}>
      <View style={[styles.agentIconBox, { borderColor: accentColor + '35', backgroundColor: accentColor + '14' }]}>
        <Text style={[styles.agentIconText, { color: accentColor }]}>✦</Text>
      </View>
      <View style={styles.assistantBubble}>
        <Text style={[styles.assistantLabel, { color: accentColor }]}>BlackSwan</Text>
        <Text style={styles.assistantText}>{entry.content}</Text>
        {artifacts.length > 0 ? (
          <View style={styles.artifactStack}>
            {artifacts.map((artifact, index) => (
              <View key={`${artifact.title}-${index}`} style={styles.artifactCard}>
                <Text style={styles.artifactTitle}>{artifact.title}</Text>
                {artifact.kind === 'image' && artifact.url ? (
                  <Image source={{ uri: artifact.url }} style={styles.artifactImage} resizeMode="cover" />
                ) : null}
                {(artifact.kind === 'code' || artifact.kind === 'webpage') && artifact.content ? (
                  <ScrollView horizontal style={styles.codeScroll} contentContainerStyle={styles.codeScrollContent}>
                    <Text style={styles.codeText}>{artifact.content}</Text>
                  </ScrollView>
                ) : null}
                {artifact.kind !== 'image' && artifact.content ? (
                  artifact.kind === 'code' || artifact.kind === 'webpage' ? null : <Text style={styles.artifactText}>{artifact.content}</Text>
                ) : null}
                {artifact.kind === 'audio' && artifact.url ? (
                  <Text style={styles.artifactMeta}>Audio generated and attached to this run.</Text>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
        {wikiRefs.length > 0 ? (
          <View style={styles.wikiRefsWrap}>
            <Text style={styles.wikiRefsLabel}>Sources from the AI Wiki</Text>
            {wikiRefs.slice(0, 4).map(ref => (
              <View key={ref.id} style={[styles.wikiRefCard, { borderColor: ref.color + '40', backgroundColor: ref.color + '10' }]}>
                <Text style={[styles.wikiRefTitle, { color: ref.color }]}>{ref.title}</Text>
                <Text style={styles.wikiRefMeta}>{ref.category}</Text>
                <Text style={styles.wikiRefSubtitle} numberOfLines={2}>{ref.subtitle}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {researchRefs.length > 0 ? (
          <View style={styles.wikiRefsWrap}>
            <Text style={styles.wikiRefsLabel}>Research shaping this response</Text>
            {researchRefs.slice(0, 3).map(ref => (
              <View key={ref.id} style={[styles.wikiRefCard, { borderColor: ref.color + '40', backgroundColor: ref.color + '10' }]}>
                <Text style={[styles.wikiRefTitle, { color: ref.color }]}>{ref.title}</Text>
                <Text style={styles.wikiRefMeta}>
                  {(ref.profileKey || ref.sourceType || 'research').toUpperCase()} • {ref.reviewStatus.toUpperCase()}
                </Text>
                <Text style={styles.wikiRefSubtitle} numberOfLines={2}>{ref.subtitle}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {(memoryRefs.length > 0 || memoriesUsed.length > 0) ? (
          <View style={styles.wikiRefsWrap}>
            <Text style={styles.wikiRefsLabel}>Persistent memory used</Text>
            {memoryRefs.length > 0 ? memoryRefs.slice(0, 4).map((ref) => (
              <View key={ref.id} style={styles.memoryRefCard}>
                <Text style={styles.memoryRefTitle}>{ref.title}</Text>
                <Text style={styles.memoryRefMeta}>
                  {formatMemoryStateLabel(ref).toUpperCase()} • {String(ref.scope).toUpperCase()} • {String(ref.memoryKind).toUpperCase()} • {formatMemoryStrengthLabel(ref).toUpperCase()} • {formatMemoryTrustLabel(ref).toUpperCase()} • {formatMemoryRecencyLabel(ref).toUpperCase()}{formatMemorySourceLabel(ref) ? ` • ${formatMemorySourceLabel(ref)!.toUpperCase()}` : ''}{ref.soulKey ? ` • ${ref.soulKey.replace(/^soul:/, '').toUpperCase()}` : ''}
                </Text>
                {ref.matchReason || ref.helpfulness != null ? (
                  <Text style={styles.wikiRefSubtitle}>
                    {ref.matchReason || ''}
                    {ref.helpfulness != null ? `${ref.matchReason ? ' · ' : ''}prior feedback: ${formatMemoryTrustLabel(ref)}` : ''}
                  </Text>
                ) : null}
              </View>
            )) : (
              <View style={styles.memoryChipRow}>
                {memoriesUsed.slice(0, 5).map((memory, index) => (
                  <View key={`${memory}-${index}`} style={styles.memoryChip}>
                    <Text style={styles.memoryChipText}>{memory}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}
        <Text style={styles.assistantTimestamp}>{formatEntryTime(entry.createdAt)}</Text>
      </View>
    </View>
  );
}

function SystemEntry({ entry }: { entry: ChatEntry }) {
  return (
    <View style={styles.systemRow}>
      <Text style={styles.systemText}>{entry.content}</Text>
    </View>
  );
}

function RunLinkCard({ entry, runs, onSelectRun }: { entry: ChatEntry; runs: ChatRun[]; onSelectRun: (run: ChatRun) => void }) {
  const runId = entry.metadata?.runId as string | undefined;
  const run = runId ? runs.find(r => r.id === runId) : null;
  if (!run) return null;
  const statusConf = RUN_STATUS_CONFIG[run.status];

  return (
    <Pressable style={styles.runCardInline} onPress={() => onSelectRun(run)}>
      <View style={styles.runCardHeader}>
        <View style={[styles.runStatusDot, { backgroundColor: statusConf.color }]} />
        <Text style={[styles.runStatusLabel, { color: statusConf.color }]}>{statusConf.label}</Text>
        <Text style={styles.runCardMode}>{run.mode}</Text>
      </View>
      {run.summary ? <Text style={styles.runCardSummary} numberOfLines={2}>{run.summary}</Text> : null}
      <Text style={styles.runCardMeta}>{run.targetLabel ?? 'BlackSwan'} • {formatEntryTime(run.createdAt)}</Text>
    </Pressable>
  );
}

function ChatTranscript({ entries, runs, onSelectRun, accentColor }: Props) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(timer);
  }, [entries.length]);

  const renderEntry = useCallback((entry: ChatEntry) => {
    if (entry.entryType === 'run-link' || entry.entryType === 'approval-link') {
      return <RunLinkCard key={entry.id} entry={entry} runs={runs} onSelectRun={onSelectRun} />;
    }
    if (entry.entryType === 'notice' || entry.role === 'system') {
      return <SystemEntry key={entry.id} entry={entry} />;
    }
    if (entry.role === 'assistant') {
      return <AssistantBubble key={entry.id} entry={entry} accentColor={accentColor} />;
    }
    return <UserBubble key={entry.id} entry={entry} accentColor={accentColor} />;
  }, [accentColor, runs, onSelectRun]);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      showsVerticalScrollIndicator
    >
      {entries.map(renderEntry)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#071009',
  },
  contentContainer: {
    paddingVertical: 18,
    paddingHorizontal: 16,
  },
  userRow: {
    alignItems: 'flex-end',
    marginBottom: 14,
  },
  userBubble: {
    maxWidth: '78%' as any,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 26,
    borderWidth: 1,
  },
  userLabel: {
    color: '#b6c6af',
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 4,
  },
  userText: {
    color: '#f5faef',
    fontSize: 15,
    lineHeight: 21,
  },
  assistantRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 14,
  },
  agentIconBox: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  agentIconText: {
    fontSize: 15,
    fontWeight: '900',
  },
  assistantBubble: {
    maxWidth: '78%' as any,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 26,
    backgroundColor: '#0f1811',
    borderWidth: 1,
    borderColor: '#18231a',
  },
  assistantLabel: {
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  assistantText: {
    color: '#e2ebdc',
    fontSize: 15,
    lineHeight: 21,
  },
  assistantTimestamp: {
    color: '#768676',
    fontSize: 11,
    marginTop: 8,
  },
  artifactStack: {
    marginTop: 12,
    gap: 10,
  },
  artifactCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#223224',
    backgroundColor: '#0b140d',
    padding: 10,
  },
  artifactTitle: {
    color: '#d8ead5',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 8,
  },
  artifactText: {
    color: '#dce7d6',
    fontSize: 13,
    lineHeight: 18,
  },
  codeScroll: {
    borderRadius: 14,
    backgroundColor: '#081009',
    borderWidth: 1,
    borderColor: '#1c2d1f',
  },
  codeScrollContent: {
    padding: 10,
  },
  codeText: {
    color: '#dff6cf',
    fontSize: 12,
    lineHeight: 18,
    fontFamily: 'monospace',
  },
  artifactMeta: {
    color: '#97aa97',
    fontSize: 12,
  },
  artifactImage: {
    width: '100%' as any,
    height: 220,
    borderRadius: 14,
    backgroundColor: '#101810',
  },
  wikiRefsWrap: {
    marginTop: 12,
    gap: 8,
  },
  wikiRefsLabel: {
    color: '#97aa97',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  wikiRefCard: {
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  wikiRefTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  wikiRefMeta: {
    color: '#89a189',
    fontSize: 10,
    textTransform: 'capitalize',
    marginBottom: 4,
  },
  wikiRefSubtitle: {
    color: '#d0ddca',
    fontSize: 12,
    lineHeight: 16,
  },
  memoryRefCard: {
    borderWidth: 1,
    borderColor: '#213224',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#0a140b',
  },
  memoryRefTitle: {
    color: '#d7ecd1',
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 2,
  },
  memoryRefMeta: {
    color: '#86a186',
    fontSize: 10,
  },
  memoryChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  memoryChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#29402b',
    backgroundColor: '#0d1810',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  memoryChipText: {
    color: '#d7ecd1',
    fontSize: 11,
    fontWeight: '700',
  },
  timestampText: {
    color: '#738373',
    fontSize: 11,
    marginBottom: 6,
  },
  systemRow: {
    alignItems: 'center',
    marginVertical: 8,
    paddingHorizontal: 18,
  },
  systemText: {
    color: '#8a988a',
    fontSize: 12,
    textAlign: 'center',
  },
  runCardInline: {
    marginVertical: 8,
    marginHorizontal: 8,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1b281d',
    backgroundColor: '#101910',
  },
  runCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  runStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  runStatusLabel: {
    fontSize: 12,
    fontWeight: '800',
  },
  runCardMode: {
    marginLeft: 'auto',
    color: '#839283',
    fontSize: 11,
    textTransform: 'capitalize',
  },
  runCardSummary: {
    color: '#d8e4d2',
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 6,
  },
  runCardMeta: {
    color: '#768676',
    fontSize: 11,
  },
});

export default ChatTranscript;
