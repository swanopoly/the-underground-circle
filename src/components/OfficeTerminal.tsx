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

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, TextInput, Pressable,
  KeyboardAvoidingView, Platform, ScrollView, Image,
} from 'react-native';
import {
  TerminalMessage,
  TerminalMessageStatus,
  TerminalResponse,
  sendTerminalCommand,
  loadTerminalHistory,
  loadResponsesForMessages,
  subscribeToTerminalMessages,
  deleteTerminalMessage,
} from '../lib/officeTerminal';
import { supabase } from '../lib/supabase';
import { CircleOfficeAgent } from '../lib/circleOffice';
import { awardPoints } from '../services/rewardService';
import { getPointsForModel } from '../lib/badges';
import AutomationsPanel from './AutomationsPanel';
import { ProviderKey, PROVIDER_MODELS, LLMProvider, ThinkingLevel } from '../lib/llmProviders';
import { PROVIDER_META } from '../lib/connectionManager';

// ─── Thinking levels (inspired by OpenClaw) ──────────────────────────────────

type TerminalMode = 'execute' | 'plan' | 'explore';

const THINKING_LEVELS: Array<{ key: ThinkingLevel; label: string; icon: string; color: string }> = [
  { key: 'fast',     label: 'Fast',     icon: '⚡', color: '#22c55e' },
  { key: 'balanced', label: 'Balanced', icon: '⚖️', color: '#6366f1' },
  { key: 'deep',     label: 'Deep',     icon: '🧠', color: '#f59e0b' },
];

const TERMINAL_MODES: Array<{ key: TerminalMode; label: string; icon: string }> = [
  { key: 'execute', label: 'Execute', icon: '▶' },
  { key: 'plan',    label: 'Plan',    icon: '📋' },
  { key: 'explore', label: 'Explore', icon: '🔍' },
];

// ─── Model options ────────────────────────────────────────────────────────────

const BASE_MODELS: Array<{ key: string | null; label: string; icon: string; color: string }> = [
  { key: null,             label: 'Auto',      icon: '🔄', color: '#6366f1' },
  { key: 'blackswan',     label: 'BlackSwan',  icon: '🦢', color: '#22c55e' },
  { key: 'claude-haiku',  label: 'Haiku',      icon: '⚡', color: '#f59e0b' },
  { key: 'claude-sonnet', label: 'Sonnet',     icon: '🎯', color: '#8b5cf6' },
  { key: 'claude-opus',   label: 'Opus',       icon: '🧠', color: '#ef4444' },
  { key: 'gemini-flash',  label: 'Gemini',     icon: '♊', color: '#4285f4' },
];

/** Build BYO model entries from user's stored API keys */
function buildBYOModels(keys: ProviderKey[]): Array<{ key: string; label: string; icon: string; color: string }> {
  const models: Array<{ key: string; label: string; icon: string; color: string }> = [];
  for (const k of keys) {
    if (!k.isActive) continue;
    const providerModels = PROVIDER_MODELS[k.provider as LLMProvider] || [];
    const meta = PROVIDER_META[k.provider as keyof typeof PROVIDER_META];
    for (const m of providerModels.slice(0, 3)) {
      models.push({
        key: `${k.provider}/${m.id}`,
        label: m.label,
        icon: meta?.icon || '🤖',
        color: meta?.color || '#6366f1',
      });
    }
  }
  return models;
}

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

  // ── Model selector ──
  sharedModel?: string | null;
  onSharedModelChange?: (m: string | null) => void;

  // ── Multi-agent targeting ──
  sharedTargetIds?: string[] | null;
  onSharedSelectTargets?: (ids: string[] | null, names: string) => void;

  // ── BYO API keys (for dynamic model list) ──
  byoProviderKeys?: ProviderKey[];

  // ── Layout ──
  compact?: boolean;  // true = hide header bar (used in the bottom drawer)
  initialTab?: 'commands' | 'automations';

  // ── Direct invocation callback (bypasses broadcast round-trip) ──
  onCommandSent?: (params: {
    messageId: string;
    command: string;
    targetAgentId: string | null;
    targetAgentIds: string[] | null;
    targetAgentName: string;
    model: string | null;
    senderId: string;
  }) => void;
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
  { cmd: '/imagine',      desc: 'Generate an image from a prompt' },
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

// ─── Inline image detection ──────────────────────────────────────────────────

const IMAGE_MD_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

function ResponseContent({ text }: { text: string }) {
  const parts: Array<{ type: 'text' | 'image'; value: string; alt?: string }> = [];
  let last = 0;
  let match: RegExpExecArray | null;

  IMAGE_MD_REGEX.lastIndex = 0;
  while ((match = IMAGE_MD_REGEX.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', value: text.slice(last, match.index) });
    }
    parts.push({ type: 'image', value: match[2], alt: match[1] });
    last = match.index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ type: 'text', value: text.slice(last) });
  }

  if (parts.length === 0) return <Text style={rowStyles.responseText}>{text}</Text>;

  return (
    <View style={{ flex: 1 }}>
      {parts.map((p, i) =>
        p.type === 'image' ? (
          <Image
            key={i}
            source={{ uri: p.value }}
            style={{ width: 256, height: 256, borderRadius: 8, marginVertical: 6 }}
            resizeMode="cover"
            accessibilityLabel={p.alt || 'Generated image'}
          />
        ) : (
          <Text key={i} style={rowStyles.responseText}>{p.value}</Text>
        ),
      )}
    </View>
  );
}

// ─── Terminal Message Row ─────────────────────────────────────────────────────

function TerminalRow({ msg, responses, onDelete }: {
  msg: TerminalMessage;
  responses?: TerminalResponse[];
  onDelete?: (id: string) => void;
}) {
  const msgResponses = responses || [];
  const isLocal = msg.id.startsWith('local-');
  const [hovered, setHovered] = useState(false);

  return (
    <View
      style={rowStyles.container}
      // @ts-ignore — web-only hover props
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
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
        {onDelete && hovered && (
          <Pressable
            style={rowStyles.deleteBtn}
            onPress={() => onDelete(msg.id)}
            hitSlop={8}
          >
            <Text style={rowStyles.deleteText}>✕</Text>
          </Pressable>
        )}
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
                <ResponseContent text={resp.responseText || ''} />
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
          <ResponseContent text={msg.responseText || ''} />
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
  deleteBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: '#1a1a1a',
  },
  deleteText: {
    color: '#52525b',
    fontSize: 10,
    fontWeight: '700',
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

// ─── Model Chip ──────────────────────────────────────────────────────────────

function ModelChip({ label, icon, active, color, onPress }: {
  label: string; icon: string; active: boolean; color: string; onPress: () => void;
}) {
  return (
    <Pressable
      style={[modelChipStyles.chip, active && { backgroundColor: color + '15', borderColor: color }]}
      onPress={onPress}
    >
      <Text style={modelChipStyles.icon}>{icon}</Text>
      <Text style={[modelChipStyles.text, active && { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const modelChipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 5,
    backgroundColor: '#111', borderWidth: 1, borderColor: '#2a2a2a',
  },
  icon: { fontSize: 10 },
  text: {
    color: '#52525b', fontSize: 10, fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
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

// ─── Terminal sub-tabs ────────────────────────────────────────────────────────

type TerminalTab = 'commands' | 'automations';

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OfficeTerminal({
  circleId, userId, userDisplayName, agents, myAgentIds,
  sharedInput, onSharedInputChange,
  sharedTargetId, sharedTargetName, onSharedSelectTarget,
  sharedModel, onSharedModelChange,
  sharedTargetIds, onSharedSelectTargets,
  byoProviderKeys,
  compact = false,
  initialTab,
  onCommandSent,
}: Props) {
  // Dynamic model list: base models + BYO provider models
  const TERMINAL_MODELS = useMemo(() => {
    const byo = buildBYOModels(byoProviderKeys || []);
    return [...BASE_MODELS, ...byo];
  }, [byoProviderKeys]);

  const [terminalTab, setTerminalTab]          = useState<TerminalTab>(initialTab || 'commands');
  useEffect(() => { if (initialTab) setTerminalTab(initialTab); }, [initialTab]);
  const [thinkingLevel, setThinkingLevel]     = useState<ThinkingLevel>('balanced');
  const [terminalMode, setTerminalMode]       = useState<TerminalMode>('execute');
  const [messages, setMessages]               = useState<TerminalMessage[]>([]);
  const [responses, setResponses]             = useState<Map<string, TerminalResponse[]>>(new Map());
  const [localInput, setLocalInput]           = useState('');
  const [localTargetId, setLocalTargetId]     = useState<string | null>('blackswan-default');
  const [localTargetName, setLocalTargetName] = useState('@BlackSwan');
  const [localModel, setLocalModel]           = useState<string | null>('blackswan');
  const [localTargetIds, setLocalTargetIds]   = useState<string[] | null>(['blackswan-default']);
  const [sending, setSending]                 = useState(false);
  const [loading, setLoading]                 = useState(true);
  // Command history — local per instance (UI preference)
  const [cmdHistory, setCmdHistory]           = useState<string[]>([]);
  const [historyIdx, setHistoryIdx]           = useState(-1);
  const listRef   = useRef<FlatList<TerminalMessage>>(null);
  const inputRef  = useRef<TextInput>(null);
  // Track deleted message IDs to prevent stale response subscription events
  const deletedIdsRef = useRef<Set<string>>(new Set());

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

  // ── Model selection ──
  const selectedModel = sharedModel !== undefined ? sharedModel : localModel;
  const setSelectedModel = useCallback((m: string | null) => {
    if (onSharedModelChange !== undefined) onSharedModelChange(m);
    else setLocalModel(m);
  }, [onSharedModelChange]);

  // ── Multi-agent targeting ──
  const targetIds = sharedTargetIds !== undefined ? sharedTargetIds : localTargetIds;
  const selectTargets = useCallback((ids: string[] | null, names: string) => {
    if (onSharedSelectTargets !== undefined) {
      onSharedSelectTargets(ids, names);
    } else {
      setLocalTargetIds(ids);
    }
  }, [onSharedSelectTargets]);

  // Toggle an agent in/out of multi-select
  const toggleAgentTarget = useCallback((agentId: string, agentName: string) => {
    const current = targetIds || [];
    const isSelected = current.includes(agentId);

    if (isSelected) {
      // Remove agent
      const next = current.filter(id => id !== agentId);
      if (next.length === 0) {
        // Back to @all
        selectTarget(null, '@all');
        selectTargets(null, '@all');
      } else {
        selectTargets(next, next.length === 1 ? `@${agentName}` : `${next.length} agents`);
      }
    } else {
      // Add agent
      const next = [...current, agentId];
      selectTarget(agentId, `@${agentName}`); // keep legacy single for backward compat
      selectTargets(next, next.length === 1 ? `@${agentName}` : `${next.length} agents`);
    }
  }, [targetIds, selectTarget, selectTargets]);

  // Select @all (clear multi-select)
  const selectAll = useCallback(() => {
    selectTarget(null, '@all');
    selectTargets(null, '@all');
  }, [selectTarget, selectTargets]);

  // ── Load history + subscribe ───────────────────────────────────────────────
  useEffect(() => {
    deletedIdsRef.current.clear();

    loadTerminalHistory(circleId, 50).then(async ({ messages: hist }) => {
      setMessages(hist);
      setLoading(false);
      // Phase 3: load existing responses for history messages
      if (hist.length > 0) {
        const resps = await loadResponsesForMessages(hist.map(m => m.id));
        const map = new Map<string, TerminalResponse[]>();
        for (const r of resps) {
          if (deletedIdsRef.current.has(r.messageId)) continue;
          const arr = map.get(r.messageId) || [];
          arr.push(r);
          map.set(r.messageId, arr);
        }
        setResponses(map);
      }
    });
  }, [circleId]);

  useEffect(() => {
    const unsub = subscribeToTerminalMessages(
      circleId,
      (updated) => {
        // Skip updates for messages we've already deleted locally
        if (deletedIdsRef.current.has(updated.id)) return;

        setMessages(prev => {
          const idx = prev.findIndex(m => m.id === updated.id);
          if (idx >= 0) {
            const next = [...prev]; next[idx] = updated; return next;
          }
          return [...prev, updated];
        });
      },
      (deletedId) => {
        // Hard DELETE from another client — remove from local state
        deletedIdsRef.current.add(deletedId);
        setMessages(prev => prev.filter(m => m.id !== deletedId));
        setResponses(prev => {
          const next = new Map(prev);
          next.delete(deletedId);
          return next;
        });
      },
    );
    return unsub;
  }, [circleId]);

  // Phase 2 broadcast subscription removed — Phase 3 postgres_changes on
  // office_terminal_responses is now the single source of truth for responses.

  // Phase 3: Subscribe to office_terminal_responses for this circle's responses.
  // Single stable channel — never re-created on messages change to avoid missing events.
  useEffect(() => {
    const channel = supabase
      .channel(`terminal-responses:${circleId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'office_terminal_responses',
          filter: `circle_id=eq.${circleId}`,
        },
        (payload: any) => {
          const raw = payload.new;
          if (!raw) return;

          // Skip responses for messages that have been deleted
          if (deletedIdsRef.current.has(raw.message_id)) return;

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
  }, [circleId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length]);

  // Fix #6: Auto-timeout pending/invoked messages after 60s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setMessages(prev => prev.map(m => {
        if ((m.status === 'pending' || m.status === 'invoked') &&
            now - new Date(m.createdAt).getTime() > 60000) {
          return { ...m, status: 'error' as TerminalMessageStatus };
        }
        return m;
      }));
    }, 10000); // Check every 10s
    return () => clearInterval(interval);
  }, []);

  // ── Delete a message ───────────────────────────────────────────────────────
  const handleDelete = useCallback(async (messageId: string) => {
    // Track as deleted FIRST — prevents race conditions with realtime subscriptions
    deletedIdsRef.current.add(messageId);

    // Remove from local state immediately
    setMessages(prev => prev.filter(m => m.id !== messageId));
    setResponses(prev => {
      const next = new Map(prev);
      next.delete(messageId);
      return next;
    });

    // Delete from DB (skip local-only messages)
    if (!messageId.startsWith('local-')) {
      const result = await deleteTerminalMessage(messageId);
      if (result.error) {
        console.warn('[OfficeTerminal] Delete failed:', result.error);
      }
    }
  }, []);

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
      targetAgentIds: null,
      model: null,
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

    // Handle /imagine command
    if (cmd.startsWith('/imagine ')) {
      const imagePrompt = cmd.slice(9).trim();
      if (!imagePrompt) return;
      setInput('');
      setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
      setHistoryIdx(-1);
      setSending(true);
      try {
        const { data, error } = await supabase.functions.invoke('image-generate', {
          body: { provider: 'openai', prompt: imagePrompt, circleId },
        });
        const now = new Date().toISOString();
        const responseText = error
          ? `Image generation failed: ${error.message}`
          : data?.error
            ? `Error: ${data.error}`
            : `![Generated Image](${data.url})\n\n${data.revised_prompt ? `*${data.revised_prompt}*` : ''}\n\nCost: $${(data.estimated_cost || 0).toFixed(3)}`;
        const imgMsg: TerminalMessage = {
          id: `local-imagine-${Date.now()}`,
          circleId, senderId: userId, senderName: userDisplayName,
          commandText: cmd, targetAgentId: null, targetAgentName: 'IMAGE',
          targetAgentIds: null, model: null,
          responseText, responseAgentId: null, responseAgentName: 'IMAGE',
          tokenCost: 0, latencyMs: null, status: 'done',
          createdAt: now, updatedAt: now,
        };
        setMessages(prev => [...prev, imgMsg]);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
      } catch (e: any) {
        const now = new Date().toISOString();
        const errMsg: TerminalMessage = {
          id: `local-imagine-err-${Date.now()}`,
          circleId, senderId: userId, senderName: userDisplayName,
          commandText: cmd, targetAgentId: null, targetAgentName: 'IMAGE',
          targetAgentIds: null, model: null,
          responseText: `Image generation error: ${e.message}`,
          responseAgentId: null, responseAgentName: 'IMAGE',
          tokenCost: 0, latencyMs: null, status: 'error',
          createdAt: now, updatedAt: now,
        };
        setMessages(prev => [...prev, errMsg]);
      }
      setSending(false);
      return;
    }

    setSending(true);
    setInput('');
    setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
    setHistoryIdx(-1);

    // Build target name for display
    const displayTargetName = targetIds && targetIds.length > 0
      ? (targetIds.length === 1
        ? agents.find(a => a.id === targetIds[0])?.name
          ? `@${agents.find(a => a.id === targetIds[0])!.name}`
          : targetAgentName
        : `${targetIds.length} agents`)
      : targetAgentName;

    // Wrap command with mode prefix (Plan/Explore inject system-level context)
    let wrappedCmd = cmd;
    if (terminalMode === 'plan') {
      wrappedCmd = `[PLAN MODE — outline steps, do not execute] ${cmd}`;
    } else if (terminalMode === 'explore') {
      wrappedCmd = `[EXPLORE MODE — research and explain, do not make changes] ${cmd}`;
    }

    // Embed thinking level in model key (e.g. "claude-sonnet::deep")
    const modelWithThinking = selectedModel && thinkingLevel !== 'balanced'
      ? `${selectedModel}::${thinkingLevel}`
      : selectedModel;

    const result = await sendTerminalCommand({
      circleId,
      senderId: userId,
      senderName: userDisplayName,
      commandText: wrappedCmd,
      targetAgentId: targetAgentId ?? undefined,
      targetAgentName: displayTargetName,
      targetAgentIds: targetIds,
      model: modelWithThinking,
    });

    // Award XP for terminal activity — model-aware so BlackSwan gives the most
    if (result.messageId && userId) {
      const xp = getPointsForModel(selectedModel || 'auto');
      awardPoints(userId, xp, 'Terminal command', {
        command: cmd.slice(0, 50),
        target: displayTargetName,
        model: selectedModel || 'auto',
      }).catch(() => {});

      // Direct invocation — bypass broadcast round-trip for immediate response
      if (onCommandSent) {
        onCommandSent({
          messageId: result.messageId,
          command: wrappedCmd,
          targetAgentId: targetAgentId ?? null,
          targetAgentIds: targetIds ?? null,
          targetAgentName: displayTargetName,
          model: modelWithThinking ?? null,
          senderId: userId,
        });
      }
    }

    setSending(false);
  }, [input, sending, circleId, userId, userDisplayName, targetAgentId, targetAgentName, targetIds, selectedModel, agents, handleHelp, setInput, onCommandSent, terminalMode, thinkingLevel]);

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

      {/* Terminal sub-tabs */}
      <View style={styles.termTabBar}>
        <Pressable
          onPress={() => setTerminalTab('commands')}
          style={[styles.termTab, terminalTab === 'commands' && styles.termTabActive,
            Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={[styles.termTabText, terminalTab === 'commands' && styles.termTabTextActive]}>⌨ COMMANDS</Text>
        </Pressable>
        <Pressable
          onPress={() => setTerminalTab('automations')}
          style={[styles.termTab, terminalTab === 'automations' && styles.termTabActive,
            Platform.OS === 'web' && { cursor: 'pointer' } as any]}
        >
          <Text style={[styles.termTabText, terminalTab === 'automations' && styles.termTabTextActive]}>⚡ AUTOMATIONS</Text>
        </Pressable>
      </View>

      {/* Automations view */}
      {terminalTab === 'automations' ? (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <AutomationsPanel circleId={circleId} />
        </ScrollView>
      ) : (
      <>

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
            <TerminalRow msg={item} responses={responses.get(item.id)} onDelete={handleDelete} />
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

      {/* Model selector chips */}
      <View style={styles.modelRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {TERMINAL_MODELS.map(m => (
            <ModelChip
              key={m.key ?? 'auto'}
              label={m.label}
              icon={m.icon}
              color={m.color}
              active={selectedModel === m.key}
              onPress={() => setSelectedModel(m.key)}
            />
          ))}
        </ScrollView>
      </View>

      {/* Thinking level + Mode selector */}
      <View style={styles.modelRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          {THINKING_LEVELS.map(tl => (
            <Pressable
              key={tl.key}
              onPress={() => setThinkingLevel(tl.key)}
              style={[styles.thinkChip, thinkingLevel === tl.key && { borderColor: tl.color, backgroundColor: `${tl.color}18` }]}
            >
              <Text style={[styles.thinkChipText, thinkingLevel === tl.key && { color: tl.color }]}>
                {tl.icon} {tl.label}
              </Text>
            </Pressable>
          ))}
          <View style={styles.chipDivider} />
          {TERMINAL_MODES.map(tm => (
            <Pressable
              key={tm.key}
              onPress={() => setTerminalMode(tm.key)}
              style={[styles.thinkChip, terminalMode === tm.key && styles.modeChipActive]}
            >
              <Text style={[styles.thinkChipText, terminalMode === tm.key && styles.modeChipTextActive]}>
                {tm.icon} {tm.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Target selector chips — multi-select enabled */}
      <View style={styles.chipRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipsScroll}
        >
          <AgentChip
            label="@all"
            active={!targetIds || targetIds.length === 0}
            onPress={selectAll}
          />
          {onlineAgents.map(agent => (
            <AgentChip
              key={agent.id}
              label={`@${agent.name}`}
              active={targetIds?.includes(agent.id) ?? false}
              dotColor={STATUS_DOT[agent.status] || STATUS_DOT.offline}
              onPress={() => toggleAgentTarget(agent.id, agent.name)}
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
          <Text style={styles.prefixText}>
            {terminalMode !== 'execute' ? `[${terminalMode.toUpperCase()}] ` : ''}
            {selectedModel ? `[${TERMINAL_MODELS.find(m => m.key === selectedModel)?.label || selectedModel}] ` : ''}
            &gt; {targetIds && targetIds.length > 1 ? `${targetIds.length} agents` : targetAgentName} ▸
          </Text>
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

      </>
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
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 } as any,
  termTabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingHorizontal: 4,
  } as any,
  termTab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  } as any,
  termTabActive: {
    borderBottomColor: '#6366f1',
  } as any,
  termTabText: {
    color: '#555',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  } as any,
  termTabTextActive: {
    color: '#a5b4fc',
  } as any,
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
  modelRow: {
    borderTopWidth: 1, borderTopColor: '#1a1a1a', paddingVertical: 4,
    backgroundColor: '#0a0a0a',
  },
  chipRow: { borderTopWidth: 1, borderTopColor: '#1a1a1a', paddingVertical: 6 },
  chipsScroll: {
    paddingHorizontal: 12, gap: 6, flexDirection: 'row', alignItems: 'center',
  },
  chipDivider: {
    width: 1, height: 18, backgroundColor: '#2a2a2a', marginHorizontal: 4,
  },
  thinkChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  thinkChipText: {
    color: '#666', fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    fontWeight: '600',
  },
  modeChipActive: {
    borderColor: '#6366f1', backgroundColor: '#6366f118',
  },
  modeChipTextActive: {
    color: '#6366f1',
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
