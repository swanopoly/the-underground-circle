/**
 * TraceViewer — Request lifecycle viewer for terminal commands
 * Shows each command as a trace: user → agent → response with timing, tokens, cost
 * Inspired by Langfuse traces / LangSmith runs
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, Platform } from 'react-native';
import { supabase } from '../lib/supabase';
import { loadSafeCircleProfiles } from '../lib/safeProfiles';

interface Trace {
  id: string;
  messageId: string;
  agentName: string;
  command: string;
  responseText: string;
  status: 'done' | 'error' | 'pending' | 'streaming';
  model: string | null;
  tokenCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  latencyMs: number | null;
  senderName: string;
  createdAt: string;
}

interface Props {
  circleId: string;
  accentColor?: string;
}

export default function TraceViewer({ circleId, accentColor = '#6366f1' }: Props) {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryFocused, setRetryFocused] = useState(false);
  const loadGenerationRef = useRef(0);

  const loadTraces = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!circleId) {
      setTraces([]);
      setLoadError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);

    try {
      // Join responses with messages to get the command text and sender
      const { data: responses, error: responsesError } = await supabase
        .from('office_terminal_responses')
        .select(`
          id, message_id, agent_name, response_text, status, model,
          token_count, input_tokens, output_tokens, cache_read_tokens,
          latency_ms, created_at
        `)
        .eq('circle_id', circleId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (responsesError) throw responsesError;
      if (generation !== loadGenerationRef.current) return;

      if (!responses || responses.length === 0) {
        setTraces([]);
        return;
      }

      // Get the message details for these responses
      const messageIds = [...new Set(responses.map(r => r.message_id).filter(Boolean))];
      const { data: messages, error: messagesError } = messageIds.length > 0
        ? await supabase
            .from('office_terminal_messages')
            .select('id, command_text, sender_id, model')
            .in('id', messageIds)
        : { data: [] as any[], error: null };
      if (messagesError) throw messagesError;
      if (generation !== loadGenerationRef.current) return;

      // Get sender profiles
      const senderIds = [...new Set((messages || []).map(m => m.sender_id).filter(Boolean))];
      const profiles = senderIds.length > 0
        ? await loadSafeCircleProfiles({ circleId, userIds: senderIds })
        : [];
      if (generation !== loadGenerationRef.current) return;

      const messageMap = new Map((messages || []).map(m => [m.id, m]));
      const profileMap = new Map((profiles || []).map(p => [p.id, p]));

      const mapped: Trace[] = responses.map(r => {
        const msg = r.message_id ? messageMap.get(r.message_id) : null;
        const sender = msg?.sender_id ? profileMap.get(msg.sender_id) : null;
        return {
          id: r.id,
          messageId: r.message_id,
          agentName: r.agent_name || 'Unknown',
          command: msg?.command_text || '(unknown command)',
          responseText: r.response_text || '',
          status: normalizeTraceStatus(r.status),
          model: r.model || msg?.model || null,
          tokenCount: r.token_count || 0,
          inputTokens: r.input_tokens || 0,
          outputTokens: r.output_tokens || 0,
          cacheReadTokens: r.cache_read_tokens || 0,
          latencyMs: r.latency_ms,
          senderName: sender?.display_name || sender?.username || 'User',
          createdAt: r.created_at,
        };
      });

      setTraces(mapped);
    } catch (err) {
      console.error('[TraceViewer] Failed to load traces:', err);
      if (generation === loadGenerationRef.current) {
        setLoadError('Request traces could not be loaded. Check your connection and try again.');
      }
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    void loadTraces();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [loadTraces]);

  // Realtime: refresh traces when new responses arrive (debounced)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!circleId) return;
    const channel = supabase
      .channel(`traces-live-${circleId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'office_terminal_responses',
        filter: `circle_id=eq.${circleId}`,
      }, () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => { void loadTraces(); }, 2000);
      })
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [circleId, loadTraces]);

  if (loading) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyText}>Loading traces...</Text>
      </View>
    );
  }

  if (loadError) {
    return (
      <View
        style={styles.emptyContainer}
        accessibilityRole="alert"
        accessibilityLiveRegion="assertive"
      >
        <Text style={styles.emptyTitle}>Traces unavailable</Text>
        <Text style={styles.emptyText}>{loadError}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry loading request traces"
          onPress={() => { void loadTraces(); }}
          onFocus={() => setRetryFocused(true)}
          onBlur={() => setRetryFocused(false)}
          style={({ pressed }) => [
            styles.retryButton,
            retryFocused && styles.retryButtonFocused,
            pressed && styles.retryButtonPressed,
          ]}
        >
          <Text style={styles.retryButtonText}>RETRY</Text>
        </Pressable>
      </View>
    );
  }

  if (traces.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.emptyIcon}>🔍</Text>
        <Text style={styles.emptyTitle}>No Traces Yet</Text>
        <Text style={styles.emptyText}>Send a command in the Terminal to see request traces here.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>REQUEST TRACES</Text>
        <Text style={styles.headerSub}>
          {traces.length} traces (last 50) • token-based cost estimates
        </Text>
      </View>

      {traces.map(trace => {
        const isExpanded = expandedId === trace.id;
        const isError = trace.status === 'error';
        const statusMeta = getTraceStatusMeta(trace.status);
        const cost = trace.tokenCount * 0.0000005;
        const timeAgo = formatTimeAgo(trace.createdAt);

        return (
          <Pressable
            key={trace.id}
            onPress={() => setExpandedId(isExpanded ? null : trace.id)}
            accessibilityRole="button"
            accessibilityLabel={`${trace.senderName} to ${trace.agentName}, ${statusMeta.label.toLowerCase()}: ${trace.command}`}
            accessibilityHint={isExpanded ? 'Collapses trace details' : 'Expands trace details'}
            accessibilityState={{ expanded: isExpanded }}
            style={[
              styles.traceCard,
              isError && styles.traceCardError,
              Platform.OS === 'web' && { cursor: 'pointer' } as any,
            ]}
          >
            {/* Trace header row */}
            <View style={styles.traceHeader}>
              <View style={[styles.statusDot, {
                backgroundColor: statusMeta.color,
              }]} />
              <Text style={styles.traceSender}>{trace.senderName}</Text>
              <Text style={styles.traceArrow}>→</Text>
              <Text style={[styles.traceAgent, { color: accentColor }]}>{trace.agentName}</Text>
              <Text style={styles.traceTime}>{timeAgo}</Text>
            </View>

            {/* Command preview */}
            <Text style={styles.traceCommand} numberOfLines={isExpanded ? undefined : 1}>
              {trace.command}
            </Text>

            {/* Metrics pills */}
            <View style={styles.metricsPills}>
              {trace.model && (
                <View style={styles.pill}>
                  <Text style={styles.pillText}>{formatModelName(trace.model)}</Text>
                </View>
              )}
              <View style={styles.pill}>
                <Text style={styles.pillText}>{trace.tokenCount} tok</Text>
              </View>
              {trace.latencyMs != null && (
                <View style={[styles.pill, {
                  backgroundColor: trace.latencyMs > 5000 ? '#ef444420' : trace.latencyMs > 2000 ? '#f59e0b20' : '#22c55e20',
                }]}>
                  <Text style={[styles.pillText, {
                    color: trace.latencyMs > 5000 ? '#ef4444' : trace.latencyMs > 2000 ? '#f59e0b' : '#22c55e',
                  }]}>
                    {trace.latencyMs >= 1000 ? `${(trace.latencyMs / 1000).toFixed(1)}s` : `${trace.latencyMs}ms`}
                  </Text>
                </View>
              )}
              <View style={styles.pill}>
                <Text style={styles.pillText}>~${cost.toFixed(4)}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: `${statusMeta.color}20` }]}>
                <Text style={[styles.pillText, { color: statusMeta.color }]}>{statusMeta.label}</Text>
              </View>
            </View>

            {/* Expanded details */}
            {isExpanded && (
              <View style={styles.expandedSection}>
                {/* Token breakdown */}
                {(trace.inputTokens > 0 || trace.outputTokens > 0) && (
                  <View style={styles.tokenRow}>
                    <Text style={styles.detailLabel}>Tokens:</Text>
                    <Text style={[styles.detailValue, { color: '#3b82f6' }]}>
                      {trace.inputTokens} in
                    </Text>
                    <Text style={styles.detailSep}>/</Text>
                    <Text style={[styles.detailValue, { color: '#a855f7' }]}>
                      {trace.outputTokens} out
                    </Text>
                    {trace.cacheReadTokens > 0 && (
                      <>
                        <Text style={styles.detailSep}>/</Text>
                        <Text style={[styles.detailValue, { color: '#22c55e' }]}>
                          {trace.cacheReadTokens} cached
                        </Text>
                      </>
                    )}
                  </View>
                )}

                {/* Response text */}
                <View style={styles.responseBox}>
                  <Text style={styles.responseLabel}>Response:</Text>
                  <Text style={styles.responseText}>
                    {trace.responseText.slice(0, 500)}
                    {trace.responseText.length > 500 ? '...' : ''}
                  </Text>
                </View>
              </View>
            )}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

function normalizeTraceStatus(value: unknown): Trace['status'] {
  return value === 'done' || value === 'error' || value === 'pending' || value === 'streaming'
    ? value
    : 'pending';
}

function getTraceStatusMeta(status: Trace['status']): { color: string; label: string } {
  switch (status) {
    case 'done':
      return { color: '#22c55e', label: 'DONE' };
    case 'error':
      return { color: '#ef4444', label: 'ERROR' };
    case 'streaming':
      return { color: '#3b82f6', label: 'STREAMING' };
    case 'pending':
      return { color: '#f59e0b', label: 'PENDING' };
  }
}

function formatTimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

function formatModelName(model: string): string {
  return model
    .replace('claude-haiku-4-5-20251001', 'Haiku')
    .replace('claude-sonnet-4-6', 'Sonnet')
    .replace('claude-opus-4-6', 'Opus')
    .replace('blackswan', 'BlackSwan');
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
    padding: 16,
  },
  emptyContainer: {
    flex: 1,
    backgroundColor: '#000000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 32,
  },
  emptyIcon: { fontSize: 48, marginBottom: 12 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#e8e8e8', marginBottom: 8 },
  emptyText: { fontSize: 13, color: '#9e9e9e', textAlign: 'center' },
  retryButton: {
    minWidth: 96,
    minHeight: 44,
    marginTop: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#3e3e3e',
    backgroundColor: '#161616',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  retryButtonFocused: {
    borderColor: '#6366f1',
    backgroundColor: '#202020',
  },
  retryButtonPressed: { opacity: 0.72 },
  retryButtonText: {
    color: '#e8e8e8',
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: '#e8e8e8',
    letterSpacing: 2,
  },
  headerSub: {
    fontSize: 11,
    color: '#6f6f6f',
  },
  traceCard: {
    backgroundColor: '#161616',
    borderWidth: 1,
    borderColor: '#1a1a1a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  traceCardError: {
    borderColor: '#ef444440',
  },
  traceHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  traceSender: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9e9e9e',
  },
  traceArrow: {
    fontSize: 10,
    color: '#6f6f6f',
  },
  traceAgent: {
    fontSize: 12,
    fontWeight: '700',
    flex: 1,
  },
  traceTime: {
    fontSize: 10,
    color: '#6f6f6f',
  },
  traceCommand: {
    fontSize: 12,
    color: '#b5b5b5',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    marginBottom: 8,
  },
  metricsPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    backgroundColor: '#2a2a2a',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  pillText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#9e9e9e',
  },
  expandedSection: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    paddingTop: 10,
    gap: 8,
  },
  tokenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  detailLabel: {
    fontSize: 11,
    color: '#6f6f6f',
    fontWeight: '600',
  },
  detailValue: {
    fontSize: 11,
    fontWeight: '700',
  },
  detailSep: {
    fontSize: 10,
    color: '#3e3e3e',
  },
  responseBox: {
    backgroundColor: '#0a0a0a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    padding: 10,
  },
  responseLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6f6f6f',
    letterSpacing: 1,
    marginBottom: 6,
  },
  responseText: {
    fontSize: 12,
    color: '#9e9e9e',
    lineHeight: 18,
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
});
