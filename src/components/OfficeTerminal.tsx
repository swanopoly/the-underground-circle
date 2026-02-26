/**
 * OfficeTerminal.tsx — Shared command center terminal
 *
 * All circle members see the same terminal history (via Supabase Realtime).
 * Commands route to a specific agent (@AgentName) or all agents (@all).
 * Responses stream back live via Supabase Broadcast + DB.
 *
 * Supports "controlled" props so two mounted instances can share
 * input + target state — changes to one are instantly mirrored in the other.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import {
  TerminalMessage,
  TerminalResponse,
  sendTerminalCommand,
  loadTerminalHistory,
  loadResponsesForMessages,
  subscribeToTerminalMessages,
  subscribeToTerminalResponses,
  BroadcastResponsePayload,
} from '../lib/officeTerminal';
import { supabase } from '../lib/supabase';
import { CircleOfficeAgent } from '../lib/circleOffice';

// TerminalResponse is imported from officeTerminal.ts

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  circleId: string;
  userId: string;
  userDisplayName: string;
  agents: CircleOfficeAgent[];
  myAgentIds: string[];

  // ── Shared/controlled state — use to mirror two mounted instances ──
  // When provided, the component uses these instead of its own local state.
  sharedInput?: string;
  onSharedInputChange?: (v: string) => void;
  sharedTargetId?: string | null;
  sharedTargetName?: string;
  onSharedSelectTarget?: (id: string | null, name: string) => void;

  // ── Layout ──
  compact?: boolean;  // true = hide header bar (used in the bottom drawer)
}

// ─── Built-in command descriptions ───────────────────────────────────────────

const BUILTIN_CMDS = [
  { cmd: '/help',         desc: 'Show this command reference' },
  { cmd: '/status',       desc: 'Ask agent for current task status' },
  { cmd: '/stop',         desc: 'Ask agent to stop current task' },
  { cmd: '/summarize',    desc: 'Ask agent to summarize recent work' },
  { cmd: '/plan',         desc: 'Ask agent to outline next steps' },
  { cmd: '/cost',         desc: 'Request token usage & cost breakdown' },
  { cmd: '/ping',         desc: 'Verify agent is responsive' },
  { cmd: '/whoami',       desc: 'Ask agent to identify itself' },
];

const HELP_TEXT = BUILTIN_CMDS.map(b => `${b.cmd.padEnd(14)} — ${b.desc}`).join('\n');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch { return '—'; }
}

function fmtTokenCost(n: number): string {
  if (!n) return '';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${n} tok`;
}

// ─── Pending dots animation ───────────────────────────────────────────────────

function PendingDots() {
  const [dots, setDots] = useState('.');
  useEffect(() => {
    const t = setInterval(() => setDots(d => d.length >= 3 ? '.' : d + '.'), 400);
    return () => clearInterval(t);
  }, []);
  return <Text style={pendingStyles.text}>Processing{dots}</Text>;
}

const pendingStyles = StyleSheet.create({
  text: {
    color: '#6366f1',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontSize: 12,
  },
});

// ─── Terminal Message Row ─────────────────────────────────────────────────────

function TerminalRow({ msg, responses }: { msg: TerminalMessage; responses?: TerminalResponse[] }) {
  const msgResponses = responses || [];
  const isLocal = msg.id.startsWith('local-');

  return (
    <View style={rowStyles.container}>
      {/* Header */}
      <View style={rowStyles.header}>
        <Text style={rowStyles.time}>{fmtTime(msg.createdAt)}</Text>
        {!isLocal && (
          <>
            <Text style={rowStyles.sender}>{msg.senderName}</Text>
            <Text style={rowStyles.arrow}>→</Text>
          </>
        )}
        <Text style={[rowStyles.target, isLocal && rowStyles.targetLocal]}>
          {msg.targetAgentName}
        </Text>
      </View>

      {/* Command */}
      <View style={rowStyles.commandLine}>
        <Text style={rowStyles.prompt}>&gt; </Text>
        <Text style={rowStyles.command}>{msg.commandText}</Text>
      </View>

      {/* Responses (Phase 3: multiple) or single response (Phase 2) */}
      {msgResponses.length > 0 ? (
        msgResponses.map((resp, idx) => (
          <View key={resp.id} style={rowStyles.responseLine}>
            <Text style={rowStyles.responseAgent}>{resp.agentName}</Text>
            <Text style={rowStyles.responseArrow}> ▸ </Text>
            {resp.status === 'pending' ? (
              <PendingDots />
            ) : resp.status === 'error' ? (
              <Text style={rowStyles.errorText}>⚠ {resp.errorMessage || 'Error'}</Text>
            ) : (
              <>
                <Text style={rowStyles.responseText}>{resp.responseText}</Text>
                {resp.tokenCount > 0 && (
                  <View style={rowStyles.costBadge}>
                    <Text style={rowStyles.costText}>{fmtTokenCost(resp.tokenCount)}</Text>
                  </View>
                )}
                {resp.latencyMs != null && (
                  <View style={rowStyles.latencyBadge}>
                    <Text style={rowStyles.latencyText}>
                      {resp.latencyMs >= 1000 ? `${(resp.latencyMs / 1000).toFixed(1)}s` : `${resp.latencyMs}ms`}
                    </Text>
                  </View>
                )}
              </>
            )}
          </View>
        ))
      ) : msg.responseText ? (
        // Fallback: Phase 2 single response
        <View style={rowStyles.responseLine}>
          {msg.responseAgentName && (
            <>
              <Text style={rowStyles.responseAgent}>{msg.responseAgentName}</Text>
              <Text style={rowStyles.responseArrow}> ▸ </Text>
            </>
          )}
          <Text style={rowStyles.responseText}>{msg.responseText}</Text>
        </View>
      ) : (
        // No responses yet
        <View style={rowStyles.responseLine}>
          <Text style={rowStyles.responseAgent}>{msg.targetAgentName}</Text>
          <Text style={rowStyles.responseArrow}> ▸ </Text>
          <PendingDots />
        </View>
      )}

      <View style={rowStyles.divider} />
    </View>
  );
}

const rowStyles = StyleSheet.create({
  container: { paddingHorizontal: 14, paddingTop: 10 },
  header: {
    flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginBottom: 4,
  },
  time: {
    color: '#3f3f46', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  sender: {
    color: '#71717a', fontSize: 11, fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  arrow: { color: '#3f3f46', fontSize: 11 },
  target: {
    color: '#6366f1', fontSize: 11, fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  targetLocal: { color: '#52525b', fontStyle: 'italic' },
  costBadge: {
    backgroundColor: '#22c55e15', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 1, borderColor: '#22c55e33', marginLeft: 'auto',
  },
  costText: { color: '#22c55e', fontSize: 9, fontWeight: '700' },
  latencyBadge: {
    backgroundColor: '#f59e0b15', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1,
    borderWidth: 1, borderColor: '#f59e0b33',
  },
  latencyText: { color: '#f59e0b', fontSize: 9, fontWeight: '700' },
  commandLine: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 },
  prompt: {
    color: '#6366f1', fontSize: 12, fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  command: {
    color: '#a5b4fc', fontSize: 12, flex: 1, lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  responseLine: {
    flexDirection: 'row', alignItems: 'flex-start', flexWrap: 'wrap',
    marginBottom: 4, paddingLeft: 14,
  },
  responseAgent: {
    color: '#22c55e', fontSize: 11, fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  responseArrow: {
    color: '#3f3f46', fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  responseText: {
    color: '#86efac', fontSize: 12, flex: 1, lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  errorText: {
    color: '#ef4444', fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  divider: { height: 1, backgroundColor: '#1a1a1a', marginTop: 10 },
});

// ─── Agent Target Chip ────────────────────────────────────────────────────────

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  dotColor?: string;
}

function AgentChip({ label, active, onPress, dotColor }: ChipProps) {
  return (
    <Pressable style={[chipStyles.chip, active && chipStyles.chipActive]} onPress={onPress}>
      {dotColor && <View style={[chipStyles.dot, { backgroundColor: dotColor }]} />}
      <Text style={[chipStyles.text, active && chipStyles.textActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
  },
  chipActive: { backgroundColor: '#6366f115', borderColor: '#6366f1' },
  dot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  text: { color: '#71717a', fontSize: 11, fontWeight: '600', maxWidth: 80 },
  textActive: { color: '#6366f1' },
});

// ─── Autocomplete suggestion row ──────────────────────────────────────────────

function AutocompleteSuggestions({
  query, agents, onSelect,
}: { query: string; agents: CircleOfficeAgent[]; onSelect: (id: string | null, name: string) => void }) {
  const lq = query.toLowerCase().slice(1); // strip '@'
  const matches = agents.filter(a => a.name.toLowerCase().startsWith(lq)).slice(0, 5);
  if (matches.length === 0) return null;
  return (
    <View style={acStyles.row}>
      {matches.map(a => (
        <Pressable
          key={a.id}
          style={acStyles.chip}
          onPress={() => onSelect(a.id, `@${a.name}`)}
        >
          <View style={[acStyles.dot, { backgroundColor: STATUS_DOT[a.status] || STATUS_DOT.offline }]} />
          <Text style={acStyles.text}>@{a.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const acStyles = StyleSheet.create({
  row: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 6,
    paddingHorizontal: 12, paddingVertical: 6,
    borderTopWidth: 1, borderTopColor: '#1a1a1a',
    backgroundColor: '#0d0d0d',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5,
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#6366f133',
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  text: { color: '#a5b4fc', fontSize: 11, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
});

// ─── Status dot colors ────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  idle: '#22c55e', building: '#f59e0b', offline: '#52525b', error: '#ef4444',
};

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OfficeTerminal({
  circleId, userId, userDisplayName, agents, myAgentIds,
  sharedInput, onSharedInputChange,
  sharedTargetId, sharedTargetName, onSharedSelectTarget,
  compact = false,
}: Props) {
  const [messages, setMessages]               = useState<TerminalMessage[]>([]);
  const [responses, setResponses]             = useState<Map<string, TerminalResponse[]>>(new Map());
  const [localInput, setLocalInput]           = useState('');
  const [localTargetId, setLocalTargetId]     = useState<string | null>(null);
  const [localTargetName, setLocalTargetName] = useState('@all');
  const [sending, setSending]                 = useState(false);
  const [loading, setLoading]                 = useState(true);
  // Command history — local per instance (UI preference)
  const [cmdHistory, setCmdHistory]           = useState<string[]>([]);
  const [historyIdx, setHistoryIdx]           = useState(-1);
  const listRef   = useRef<FlatList<TerminalMessage>>(null);
  const inputRef  = useRef<TextInput>(null);

  // ── Derive active input/target from shared or local state ──────────────────
  const input = sharedInput !== undefined ? sharedInput : localInput;
  const setInput = useCallback((v: string) => {
    if (onSharedInputChange !== undefined) onSharedInputChange(v);
    else setLocalInput(v);
  }, [onSharedInputChange]);

  const targetAgentId   = sharedTargetId   !== undefined ? sharedTargetId   : localTargetId;
  const targetAgentName = sharedTargetName !== undefined ? sharedTargetName : localTargetName;
  const selectTarget = useCallback((id: string | null, name: string) => {
    if (onSharedSelectTarget !== undefined) {
      onSharedSelectTarget(id, name);
    } else {
      setLocalTargetId(id);
      setLocalTargetName(name);
    }
  }, [onSharedSelectTarget]);

  // ── Load history + subscribe ───────────────────────────────────────────────
  useEffect(() => {
    loadTerminalHistory(circleId, 50).then(async ({ messages: hist }) => {
      setMessages(hist);
      setLoading(false);
      // Phase 3: load existing responses for history messages
      if (hist.length > 0) {
        const resps = await loadResponsesForMessages(hist.map(m => m.id));
        const map = new Map<string, TerminalResponse[]>();
        for (const r of resps) {
          const arr = map.get(r.messageId) || [];
          arr.push(r);
          map.set(r.messageId, arr);
        }
        setResponses(map);
      }
    });
  }, [circleId]);

  useEffect(() => {
    const unsub = subscribeToTerminalMessages(circleId, (updated) => {
      setMessages(prev => {
        const idx = prev.findIndex(m => m.id === updated.id);
        if (idx >= 0) {
          const next = [...prev]; next[idx] = updated; return next;
        }
        return [...prev, updated];
      });
    });
    return unsub;
  }, [circleId]);

  // Subscribe to phase 2 broadcast responses (for backward compat)
  useEffect(() => {
    const unsub = subscribeToTerminalResponses(circleId, (resp: BroadcastResponsePayload) => {
      setMessages(prev => prev.map(m =>
        m.id === resp.messageId
          ? {
              ...m,
              responseText:      resp.responseText,
              responseAgentId:   resp.responseAgentId,
              responseAgentName: resp.responseAgentName,
              tokenCost:         resp.tokenCost,
              latencyMs:         resp.latencyMs,
              status:            resp.status,
            }
          : m
      ));
    });
    return unsub;
  }, [circleId]);

  // Phase 3: Subscribe to office_terminal_responses for multiple agent responses
  // Note: Supabase Realtime postgres_changes does NOT support 'in' filters.
  // We subscribe to all changes on the table and filter client-side by message ID.
  useEffect(() => {
    const messageIdSet = new Set(messages.map(m => m.id));

    const channel = supabase
      .channel(`terminal-responses:${circleId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'office_terminal_responses',
        },
        (payload: any) => {
          const raw = payload.new;
          if (!raw) return;

          // Map snake_case DB columns → camelCase TerminalResponse
          const row: TerminalResponse = {
            id:           raw.id,
            messageId:    raw.message_id,
            agentId:      raw.agent_id,
            agentName:    raw.agent_name,
            responseText: raw.response_text,
            status:       raw.status,
            tokenCount:   raw.token_count,
            latencyMs:    raw.latency_ms,
            errorMessage: raw.error_message,
            createdAt:    raw.created_at,
            updatedAt:    raw.updated_at,
          };

          // Only handle responses for messages we're currently displaying
          if (!messageIdSet.has(row.messageId)) return;

          setResponses(prev => {
            const next = new Map(prev);
            const msgResponses = [...(next.get(row.messageId) || [])];
            const idx = msgResponses.findIndex(r => r.id === row.id);
            if (idx >= 0) {
              msgResponses[idx] = row;
            } else {
              msgResponses.push(row);
            }
            next.set(row.messageId, msgResponses);
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [circleId, messages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // ── Handle /help builtin ───────────────────────────────────────────────────
  const handleHelp = useCallback(() => {
    const now = new Date().toISOString();
    const helpMsg: TerminalMessage = {
      id: `local-help-${Date.now()}`,
      circleId,
      senderId: userId,
      senderName: 'SYSTEM',
      commandText: '/help',
      targetAgentId: null,
      targetAgentName: 'local',
      responseText: HELP_TEXT,
      responseAgentId: null,
      responseAgentName: 'HELP',
      tokenCost: 0,
      latencyMs: null,
      status: 'done',
      createdAt: now,
      updatedAt: now,
    };
    setMessages(prev => [...prev, helpMsg]);
    setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
  }, [circleId, userId]);

  // ── Send command ───────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || sending) return;

    // Handle builtins locally
    if (cmd === '/help') {
      setInput('');
      setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
      setHistoryIdx(-1);
      handleHelp();
      return;
    }

    setSending(true);
    setInput('');
    setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
    setHistoryIdx(-1);

    await sendTerminalCommand({
      circleId,
      senderId: userId,
      senderName: userDisplayName,
      commandText: cmd,
      targetAgentId: targetAgentId ?? undefined,
      targetAgentName,
    });

    setSending(false);
  }, [input, sending, circleId, userId, userDisplayName, targetAgentId, targetAgentName, handleHelp, setInput]);

  // ── Command history navigation (↑ / ↓) ────────────────────────────────────
  const handleKeyPress = useCallback((e: any) => {
    const key = e.nativeEvent?.key;
    if (key === 'ArrowUp') {
      const newIdx = Math.min(historyIdx + 1, cmdHistory.length - 1);
      if (newIdx >= 0 && cmdHistory[newIdx] !== undefined) {
        setHistoryIdx(newIdx);
        setInput(cmdHistory[newIdx]);
      }
    } else if (key === 'ArrowDown') {
      const newIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(newIdx);
      setInput(newIdx === -1 ? '' : cmdHistory[newIdx] ?? '');
    }
  }, [historyIdx, cmdHistory, setInput]);

  // ── Autocomplete detection ─────────────────────────────────────────────────
  // Show suggestions when input starts with '@' and there's a partial name
  const showAutocomplete =
    input.startsWith('@') && input.length > 1 && !input.includes(' ');

  const onlineAgents = agents.filter(a => a.status !== 'offline');
  const onlineCount  = onlineAgents.length;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* Header — hidden in compact (bottom drawer) mode */}
      {!compact && (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.headerTitle}>⌨️ TERMINAL</Text>
            <Text style={styles.headerSub}>Command Center</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={[styles.onlineDot, onlineCount > 0 && styles.onlineDotActive]} />
            <Text style={styles.onlineText}>
              {onlineCount} agent{onlineCount !== 1 ? 's' : ''} online
            </Text>
          </View>
        </View>
      )}

      {/* Message list */}
      {loading ? (
        <View style={styles.loadingState}>
          <Text style={styles.loadingText}>Loading terminal history...</Text>
        </View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>⌨️</Text>
          <Text style={styles.emptyTitle}>Terminal ready</Text>
          <Text style={styles.emptyText}>
            Select a target above, then type a command.{'\n'}
            Use "@all" to broadcast to every connected agent at once.{'\n'}
            Type /help for available commands.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={({ item }) => (
            <TerminalRow msg={item} responses={responses.get(item.id)} />
          )}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {/* Autocomplete suggestions (when typing @name) */}
      {showAutocomplete && (
        <AutocompleteSuggestions
          query={input}
          agents={agents}
          onSelect={(id, name) => {
            selectTarget(id, name);
            setInput('');
            inputRef.current?.focus();
          }}
        />
      )}

      {/* Target selector chips */}
      <View style={styles.chipRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          <AgentChip
            label="@all"
            active={targetAgentId === null}
            onPress={() => selectTarget(null, '@all')}
          />
          {onlineAgents.map(agent => (
            <AgentChip
              key={agent.id}
              label={`@${agent.name}`}
              active={targetAgentId === agent.id}
              dotColor={STATUS_DOT[agent.status] || STATUS_DOT.offline}
              onPress={() => selectTarget(agent.id, `@${agent.name}`)}
            />
          ))}
          {/* Quick command chips */}
          <View style={styles.chipDivider} />
          {BUILTIN_CMDS.slice(0, 4).map(b => (
            <Pressable
              key={b.cmd}
              style={styles.cmdChip}
              onPress={() => setInput(b.cmd)}
            >
              <Text style={styles.cmdChipText}>{b.cmd}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Input bar */}
      <View style={styles.inputRow}>
        <View style={styles.inputPrefix}>
          <Text style={styles.prefixText}>&gt; {targetAgentName} ▸</Text>
        </View>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={input}
          onChangeText={(v) => { setInput(v); setHistoryIdx(-1); }}
          placeholder="Type a command or /help..."
          placeholderTextColor="#3f3f46"
          multiline={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          onKeyPress={handleKeyPress}
          editable={!sending}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <Pressable
          style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Text style={styles.sendIcon}>{sending ? '⏳' : '↵'}</Text>
        </Pressable>
      </View>

      {/* History hint */}
      {cmdHistory.length > 0 && (
        <View style={styles.historyHint}>
          <Text style={styles.historyHintText}>
            ↑↓ history  ·  {cmdHistory.length} cmd{cmdHistory.length !== 1 ? 's' : ''}
          </Text>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  header: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: {
    color: '#e5e5e5',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  headerSub: {
    color: '#3f3f46',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  onlineDot: {
    width: 7, height: 7, borderRadius: 4, backgroundColor: '#3f3f46',
  },
  onlineDotActive: { backgroundColor: '#22c55e' },
  onlineText: {
    color: '#52525b', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  list: { flex: 1 },
  listContent: { paddingTop: 8, paddingBottom: 8 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: {
    color: '#3f3f46', fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  emptyState: {
    flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32,
  },
  emptyIcon: { fontSize: 36, marginBottom: 12 },
  emptyTitle: {
    color: '#e5e5e5', fontSize: 15, fontWeight: '700', marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  emptyText: {
    color: '#3f3f46', fontSize: 11, textAlign: 'center', lineHeight: 18,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  chipRow: { borderTopWidth: 1, borderTopColor: '#1a1a1a', paddingVertical: 6 },
  chipsScroll: {
    paddingHorizontal: 12, gap: 6, flexDirection: 'row', alignItems: 'center',
  },
  chipDivider: {
    width: 1, height: 18, backgroundColor: '#2a2a2a', marginHorizontal: 4,
  },
  cmdChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a',
  },
  cmdChipText: {
    color: '#52525b', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#111', borderTopWidth: 1, borderTopColor: '#1f1f1f',
    paddingHorizontal: 12, paddingVertical: 8, gap: 8,
  },
  inputPrefix: { flexShrink: 0 },
  prefixText: {
    color: '#6366f1', fontSize: 12, fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  input: {
    flex: 1, color: '#e5e5e5', fontSize: 13,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    paddingVertical: 4, minHeight: 32,
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 8,
    backgroundColor: '#6366f1', alignItems: 'center', justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: '#1f1f1f', opacity: 0.5 },
  sendIcon: { color: '#fff', fontSize: 16, fontWeight: '700' },
  historyHint: {
    paddingHorizontal: 14, paddingBottom: 4,
    backgroundColor: '#111',
  },
  historyHintText: {
    color: '#27272a', fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
