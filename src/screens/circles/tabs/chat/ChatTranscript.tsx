import React, { useRef, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Image } from 'react-native';
import { ChatEntry, ChatRun, RUN_STATUS_CONFIG } from './chatTypes';
import type { WikiArticleReference } from '../../../../lib/wikiData';
import type { SwanBotStructuredArtifact } from '../../../../lib/swanbot';

interface Props {
  entries: ChatEntry[];
  runs: ChatRun[];
  onSelectRun: (run: ChatRun) => void;
  accentColor: string;
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
  const wikiRefs = (entry.metadata?.wikiRefs as WikiArticleReference[] | undefined) || [];
  const artifacts = (entry.metadata?.artifacts as SwanBotStructuredArtifact[] | undefined) || [];

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
