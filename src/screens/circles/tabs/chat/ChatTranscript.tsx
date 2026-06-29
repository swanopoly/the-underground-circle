import React, { useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from 'react-native';
import { ChatEntry, ChatRun, RUN_STATUS_CONFIG } from './chatTypes';
import type { PromptMemoryReference } from '../../../../lib/memoryService';
import type { ResearchDocumentReference } from '../../../../lib/researchControl';
import type { WikiArticleReference } from '../../../../lib/wikiData';
import type { SwanBotStructuredArtifact } from '../../../../lib/swanbot';
import ChatAutomationPlanCard from './ChatAutomationPlanCard';
import {
  readMessageArtifacts,
  readMessageChatAutomationPlanPreview,
  readMessageMemoriesUsed,
  readMessageMemoryRefs,
  readMessageRecoveryOptions,
  readMessageResearchRefs,
  readMessageWikiRefs,
} from '../../../../lib/messageMetadataReaders';
import {
  buildChatFailureRecoveryExecutionPlan,
  stripChatFailureRecoveryOptionsText,
} from '../../../../lib/chatFailureRecovery';

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

function formatArchiveBiasLabel(ref: PromptMemoryReference): string | null {
  if (ref.archiveBias === 'boosted') return 'archive boosted';
  if (ref.archiveBias === 'suppressed') return 'archive suppressed';
  if (ref.archiveBias === 'neutral' && ref.archivePassiveScore != null) return 'archive neutral';
  return null;
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

type EntryRouteSource = {
  actor?: string;
  surface?: string;
  selectedModel?: string | null;
  effectiveModel?: string | null;
  provider?: string | null;
  showRouteChips?: boolean;
};

type EntryRouteChip = {
  label: string;
  value: string;
  tone: 'route' | 'model' | 'local' | 'provider';
};

function readEntryRouteSource(metadata: Record<string, unknown> | null | undefined): EntryRouteSource | null {
  const source = metadata?.source;
  if (!source || typeof source !== 'object') return null;
  return source as EntryRouteSource;
}

function formatModelDisplayName(model: string | null | undefined): string {
  const raw = String(model || '').trim();
  if (!raw) return 'unknown';
  if (raw.toLowerCase() === 'auto') return 'Auto';
  return raw
    .replace(/^openrouter\//i, '')
    .replace(/^huggingface_endpoint\//i, '')
    .replace(/^huggingface\//i, '')
    .replace(/^google_ai\//i, '')
    .replace(/^openai\//i, '')
    .replace(/^anthropic\//i, '')
    .replace(/^groq\//i, '')
    .replace(/^mistral_ai\//i, '')
    .replace(/^deepseek\//i, '')
    .replace(/^zai\//i, '')
    .replace(/^z_ai\//i, '')
    .replace(/^minimax\//i, '');
}

function formatRouteSurfaceLabel(surface: string | null | undefined): string {
  const raw = String(surface || '').trim();
  if (!raw) return 'Main chat';
  const normalized = raw.toLowerCase();
  if (normalized.includes('desktop_bridge')) return 'Desktop bridge';
  if (normalized.includes('computer_task')) return 'Computer task';
  if (normalized.includes('file')) return 'File tools';
  if (normalized.includes('openswan')) return 'OpenSwan';
  if (normalized.includes('browser')) return 'Browser';
  if (normalized.includes('local')) return 'Local';
  return raw
    .replace(/^main_chat_?/i, '')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Main chat';
}

function buildEntryRouteChips(entry: ChatEntry): EntryRouteChip[] {
  const source = readEntryRouteSource(entry.metadata);
  if (!source) return [];
  if (source.showRouteChips !== true) return [];
  const usage = entry.metadata?.usage as { model?: string | null } | null | undefined;
  const effectiveModel = source.effectiveModel || usage?.model || null;
  const selectedModel = source.selectedModel || null;
  const provider = source.provider || null;
  const surface = String(source.surface || '').toLowerCase();
  const model = String(effectiveModel || '').toLowerCase();
  const localExecution = surface.includes('desktop_bridge')
    || surface.includes('computer_task')
    || surface.includes('local')
    || model === 'local-desktop-bridge'
    || model === 'computer-file-adapter';
  if (localExecution) return [];
  const chips: EntryRouteChip[] = [
    { label: 'Route', value: formatRouteSurfaceLabel(source.surface), tone: localExecution ? 'local' : 'route' },
  ];

  if (selectedModel) {
    chips.push({
      label: selectedModel.toLowerCase() === 'auto' ? 'Picker' : 'Selected',
      value: formatModelDisplayName(selectedModel),
      tone: 'model',
    });
  }
  if (effectiveModel) {
    chips.push({
      label: localExecution ? 'Engine' : selectedModel?.toLowerCase() === 'auto' ? 'Resolved' : 'Model',
      value: localExecution && effectiveModel === 'local-desktop-bridge'
        ? 'Local desktop bridge'
        : localExecution && effectiveModel === 'computer-file-adapter'
          ? 'Computer file adapter'
          : formatModelDisplayName(effectiveModel),
      tone: localExecution ? 'local' : 'model',
    });
  }
  if (provider && !String(effectiveModel || '').toLowerCase().startsWith(`${provider}/`)) {
    chips.push({ label: 'Provider', value: formatModelDisplayName(provider), tone: 'provider' });
  }

  return chips.slice(0, 4);
}

type TranscriptRecoveryOption = ReturnType<typeof readMessageRecoveryOptions>[number];

function recoveryOptionAccent(option: TranscriptRecoveryOption): string {
  if (option.actor === 'user') return '#f59e0b';
  if (option.actor === 'connected_agent') return '#a78bfa';
  if (option.actor === 'openswan') return '#22c55e';
  if (option.actor === 'llm') return '#38bdf8';
  return '#94a3b8';
}

function recoveryOptionActorLabel(actor: TranscriptRecoveryOption['actor']): string {
  if (actor === 'connected_agent') return 'Connected agent';
  if (actor === 'openswan') return 'OpenSwan';
  if (actor === 'user') return 'User';
  if (actor === 'llm') return 'LLM';
  return 'Stop';
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
  const recoveryOptions = readMessageRecoveryOptions(entry.metadata);
  const planPreview = readMessageChatAutomationPlanPreview(entry.metadata);
  const source = readEntryRouteSource(entry.metadata);
  const routeChips = buildEntryRouteChips(entry);
  const assistantLabel = source?.actor?.trim() || 'OpenSwan';
  const visibleContent = recoveryOptions.length > 0
    ? stripChatFailureRecoveryOptionsText(entry.content)
    : entry.content;

  return (
    <View style={styles.assistantRow}>
      <View style={[styles.agentIconBox, { borderColor: accentColor + '35', backgroundColor: accentColor + '14' }]}>
        <Text style={[styles.agentIconText, { color: accentColor }]}>✦</Text>
      </View>
      <View style={styles.assistantBubble}>
        <Text style={[styles.assistantLabel, { color: accentColor }]}>{assistantLabel}</Text>
        {routeChips.length > 0 ? (
          <View style={styles.routeChipRow}>
            {routeChips.map((chip) => (
              <View
                key={`${entry.id}-${chip.label}-${chip.value}`}
                style={[
                  styles.routeChip,
                  chip.tone === 'local' && styles.routeChipLocal,
                  chip.tone === 'model' && styles.routeChipModel,
                  chip.tone === 'provider' && styles.routeChipProvider,
                ]}
              >
                <Text style={styles.routeChipLabel}>{chip.label}</Text>
                <Text
                  style={[
                    styles.routeChipValue,
                    chip.tone === 'local' && styles.routeChipValueLocal,
                    chip.tone === 'model' && styles.routeChipValueModel,
                  ]}
                  numberOfLines={1}
                >
                  {chip.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        <Text style={styles.assistantText}>{visibleContent}</Text>
        {planPreview ? (
          <ChatAutomationPlanCard preview={planPreview} accentColor={accentColor} />
        ) : null}
        {recoveryOptions.length > 0 ? (
          <View style={styles.recoveryOptionStack}>
            <Text style={styles.recoveryOptionLabel}>Recovery Options</Text>
            {recoveryOptions.slice(0, 5).map((option) => {
              const color = recoveryOptionAccent(option);
              const plan = buildChatFailureRecoveryExecutionPlan(option as any);
              return (
                <View
                  key={`${entry.id}-${option.id}`}
                  style={[styles.recoveryOptionCard, { borderColor: `${color}55`, backgroundColor: `${color}10` }]}
                >
                  <View style={styles.recoveryOptionHeader}>
                    <Text style={[styles.recoveryOptionTitle, { color }]} numberOfLines={2}>{option.label}</Text>
                    <Text style={styles.recoveryOptionMeta}>
                      {[recoveryOptionActorLabel(option.actor).toUpperCase(), option.recommended ? 'RECOMMENDED' : ''].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={styles.recoveryOptionDetail} numberOfLines={3}>{option.detail}</Text>
                  <Text style={styles.recoveryOptionPlan} numberOfLines={2}>{plan.userSummary}</Text>
                </View>
              );
            })}
          </View>
        ) : null}
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
            <Text style={styles.wikiRefsLabel}>Sources from the Wiki</Text>
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
                  {formatMemoryStateLabel(ref).toUpperCase()} • {String(ref.scope).toUpperCase()} • {String(ref.memoryKind).toUpperCase()} • {formatMemoryStrengthLabel(ref).toUpperCase()} • {formatMemoryTrustLabel(ref).toUpperCase()} • {formatMemoryRecencyLabel(ref).toUpperCase()}{formatMemorySourceLabel(ref) ? ` • ${formatMemorySourceLabel(ref)!.toUpperCase()}` : ''}{formatArchiveBiasLabel(ref) ? ` • ${formatArchiveBiasLabel(ref)!.toUpperCase()}` : ''}{ref.soulKey ? ` • ${ref.soulKey.replace(/^soul:/, '').toUpperCase()}` : ''}
                </Text>
                {ref.matchReason || ref.helpfulness != null ? (
                  <Text style={styles.wikiRefSubtitle}>
                    {ref.matchReason || ''}
                    {ref.helpfulness != null ? `${ref.matchReason ? ' · ' : ''}prior feedback: ${formatMemoryTrustLabel(ref)}` : ''}
                    {formatArchiveBiasLabel(ref) ? `${ref.matchReason || ref.helpfulness != null ? ' · ' : ''}archive evidence: ${formatArchiveBiasLabel(ref)}${ref.archivePassiveScore != null ? ` (${Math.round(ref.archivePassiveScore * 100)}%)` : ''}` : ''}
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
      <Text style={styles.runCardMeta}>{run.targetLabel ?? 'OpenSwan'} • {formatEntryTime(run.createdAt)}</Text>
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
      onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      showsVerticalScrollIndicator
    >
      {entries.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={[styles.emptyStateTitle, { color: accentColor }]}>Start a chat</Text>
          <Text style={styles.emptyStateText}>
            Ask OpenSwan to answer, plan, search, automate the browser, or control the paired desktop bridge.
          </Text>
        </View>
      ) : entries.map(renderEntry)}
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
  routeChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  routeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 210,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#29412d',
    backgroundColor: '#0b140d',
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  routeChipLocal: {
    borderColor: '#22c55e45',
    backgroundColor: '#052e1628',
  },
  routeChipModel: {
    borderColor: '#38bdf845',
    backgroundColor: '#082f4928',
  },
  routeChipProvider: {
    borderColor: '#a78bfa45',
    backgroundColor: '#312e8128',
  },
  routeChipLabel: {
    color: '#88a38a',
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase' as any,
    fontFamily: 'monospace',
  },
  routeChipValue: {
    color: '#dce7d6',
    fontSize: 10,
    fontWeight: '800',
    maxWidth: 132,
  },
  routeChipValueLocal: {
    color: '#86efac',
  },
  routeChipValueModel: {
    color: '#bae6fd',
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
  recoveryOptionStack: {
    marginTop: 12,
    gap: 8,
  },
  recoveryOptionLabel: {
    color: '#97aa97',
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  recoveryOptionCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
  recoveryOptionHeader: {
    gap: 3,
  },
  recoveryOptionTitle: {
    fontSize: 12,
    fontWeight: '900',
  },
  recoveryOptionMeta: {
    color: '#89a189',
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  recoveryOptionDetail: {
    color: '#d8e4d2',
    fontSize: 12,
    lineHeight: 17,
  },
  recoveryOptionPlan: {
    color: '#94a3b8',
    fontSize: 11,
    lineHeight: 16,
  },
  emptyState: {
    minHeight: 280,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#203322',
    backgroundColor: '#0b140d',
    padding: 24,
    gap: 8,
  },
  emptyStateTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  emptyStateText: {
    color: '#97aa97',
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
    maxWidth: 420,
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
