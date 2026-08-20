/**
 * OfficeTerminal.tsx — BlackSwan Terminal
 *
 * Clean monochromatic terminal inspired by Ollama's design.
 * Features: collapsible response cards, status footer, metrics bar,
 * command palette input, multi-agent targeting, streaming responses.
 *
 * All circle members see the same terminal history (via Supabase Realtime).
 * Commands route to a specific agent (@AgentName) or all agents (@all).
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
  sendTerminalCommandExact,
  loadTerminalHistory,
  loadResponsesForMessages,
  subscribeToTerminalMessages,
  deleteTerminalMessage,
  deleteTerminalMessageExact,
  buildTerminalCommandTargetReceipt,
  createTerminalAuthorityOperationFence,
  isTerminalCommandDispatchReceiptCurrent,
  isTerminalMessageDeleteReceiptCurrent,
  normalizeTerminalExactAuthority,
  resolveTerminalTargetSelection,
  terminalExactAuthorityMatches,
  type TerminalAuthorityCurrentGuard,
  type TerminalCommandDispatchReceipt,
  type TerminalExactAuthority,
} from '../lib/officeTerminal';
import { supabase } from '../lib/supabase';
import { subscribeWithReconnect } from '../lib/subscribeWithReconnect';
import { getStrictLocalAiModeMessage, shouldBlockExternalAiProvider } from '../lib/privacyMode';
import { CircleOfficeAgent } from '../lib/circleOffice';
import { isConnectedOfficeStatus } from '../lib/officeAgents';
import { awardPoints } from '../services/rewardService';
import { getPointsForModel } from '../lib/badges';
import AutomationsPanel from './AutomationsPanel';
import TrainingDashboard from './TrainingDashboard';
import SpawnAgentPanel from './SpawnAgentPanel';
import { ProviderKey, PROVIDER_MODELS, LLMProvider, ThinkingLevel } from '../lib/llmProviders';
import { PROVIDER_META, type ProviderType } from '../lib/connectionManager';
import { detectClaudeCodeBridge, execBridgeCommand } from '../lib/claudeCodeDetector';
import { executeDeviceCommand } from '../lib/deviceManager';
import { getAllModels, formatModelOption, type RegisteredModel } from '../lib/modelRegistry';
import { loadModelGroups } from '../lib/integrations/modelProviderRegistry';
import {
  buildAgentRuntimeSubject,
  isUuidLike,
  type AgentRuntimeSubjectMetadata,
} from '../lib/agentRuntimeSubject';

// ─── BlackSwan Terminal Theme (Ollama-inspired monochrome) ───────────────────

const BS = {
  // Core palette — pure black/gray, no color tint
  bg:        '#000000',
  bgPanel:   '#0a0a0a',
  bgCard:    '#161616',
  bgInput:   '#0a0a0a',
  bgHover:   '#252525',
  border:    '#1a1a1a',
  borderLit: '#2a2a2a',
  // Text — gray scale only
  textPrimary:   '#e8e8e8',
  textSecondary: '#9e9e9e',
  textMuted:     '#4f4f4f',
  textGhost:     '#2a2a2a',
  // Accent — white/light gray (monochromatic, no color)
  accent:     '#e8e8e8',
  accentDim:  '#b5b5b5',
  accentGlow: '#ffffff10',
  // Semantic — muted versions
  info:    '#9e9e9e',
  success: '#9e9e9e',
  warning: '#9e9e9e',
  error:   '#9e9e9e',
  // Agent colors — monochrome
  swan:    '#e8e8e8',
  user:    '#b5b5b5',
} as const;

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';
const DEFAULT_BLACKSWAN_TARGET_ID = 'blackswan-default';

type TerminalMode = 'execute' | 'plan' | 'explore' | 'fleet' | 'autopilot';

const THINKING_LEVELS: Array<{ key: ThinkingLevel; label: string; symbol: string; color: string }> = [
  { key: 'fast',     label: 'Fast',     symbol: 'F', color: '#9e9e9e' },
  { key: 'balanced', label: 'Balanced', symbol: 'B', color: '#e8e8e8' },
  { key: 'deep',     label: 'Deep',     symbol: 'D', color: '#ffffff' },
];

const TERMINAL_MODES: Array<{ key: TerminalMode; label: string; symbol: string; color: string }> = [
  { key: 'execute',   label: 'Exec',      symbol: '>', color: '#e8e8e8' },
  { key: 'plan',      label: 'Plan',      symbol: 'P', color: '#b5b5b5' },
  { key: 'explore',   label: 'Explore',   symbol: '?', color: '#9e9e9e' },
  { key: 'fleet',     label: 'Fleet',     symbol: 'F', color: '#b5b5b5' },
  { key: 'autopilot', label: 'Auto',      symbol: 'A', color: '#ffffff' },
];

// ─── Model options ────────────────────────────────────────────────────────────

const BASE_MODELS: Array<{ key: string | null; label: string; icon: string; color: string }> = [
  { key: null,             label: 'Auto',           icon: 'A', color: '#9e9e9e' },
  { key: 'blackswan',     label: 'BlackSwan',       icon: 'S', color: '#e8e8e8' },
  // These are server-owned runtime shortcuts, not proof that a user's
  // provider account lists the corresponding model. Account-backed Claude,
  // OpenAI, and Google choices are added below from loadModelGroups with the
  // provider embedded in the model id. In particular, never add bare GPT or
  // Gemini ids here: on a BlackSwan target a bare id does not carry enough
  // routing authority and can take a different fallback path than its label.
  { key: 'claude-haiku',  label: 'Haiku',           icon: 'H', color: '#b5b5b5' },
  { key: 'claude-sonnet', label: 'Sonnet',          icon: 'S', color: '#cecece' },
  { key: 'claude-opus',   label: 'Opus',            icon: 'O', color: '#ffffff' },
  // HuggingSwan open models (via HF Inference Router)
  { key: 'qwen3.5',       label: 'Qwen 3.5',        icon: 'Q', color: '#c4b5fd' },
  { key: 'qwen3-coder',   label: 'Qwen Coder',      icon: 'C', color: '#a78bfa' },
  { key: 'nemotron',      label: 'Nemotron 3',       icon: 'N', color: '#86efac' },
  { key: 'kimi-k2.5',     label: 'Kimi K2.5',        icon: 'K', color: '#67e8f9' },
  { key: 'llama-3.3',     label: 'Llama 3.3',        icon: 'L', color: '#d9f99d' },
  { key: 'gpt-oss',       label: 'gpt-oss',          icon: 'g', color: '#e5e5e5' },
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
  // Compatibility surfaces may show immutable command history without exposing
  // dispatch, automations, local shell, training, or agent-creation controls.
  readOnly?: boolean;
  readOnlyReason?: string;

  // Exact auth snapshot owned by the mounting Office surface. Agent commands
  // fail closed without it; compatibility/read-only mounts may omit it.
  terminalAuthority?: TerminalExactAuthority | null;
  isTerminalAuthorityCurrent?: TerminalAuthorityCurrentGuard;

  // ── Direct invocation callback (bypasses broadcast round-trip) ──
  onCommandSent?: (params: Readonly<{
    messageId: string;
    command: string;
    targetAgentId: string | null;
    targetAgentIds: string[] | null;
    targetAgentName: string;
    targetAgentSubject?: AgentRuntimeSubjectMetadata | null;
    targetAgentSubjects?: AgentRuntimeSubjectMetadata[] | null;
    model: string | null;
    senderId: string;
    authority: TerminalExactAuthority;
    targetFingerprint: string;
    receipt: TerminalCommandDispatchReceipt;
  }>) => void;
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
  { cmd: '/agents',       desc: 'List connected agents and their status' },
  { cmd: '/models',       desc: 'Show available models from registry' },
  { cmd: '/devices',      desc: 'List connected local devices' },
  { cmd: '/spawn',        desc: 'Create a new agent in this circle' },
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

function cleanTargetLookupName(value: string | null | undefined): string {
  return String(value || '').trim().replace(/^@+/, '').trim().toLowerCase();
}

function buildTerminalAgentSubjectMetadata(agent: CircleOfficeAgent): AgentRuntimeSubjectMetadata {
  return buildAgentRuntimeSubject({
    id: agent.id,
    name: agent.name,
    providerType: agent.provider as ProviderType,
    spirit: agent.spirit,
  }, {
    dbAgentId: isUuidLike(agent.id) ? agent.id : null,
  }).metadata;
}

function uniqueTerminalAgentSubjects(
  subjects: Array<AgentRuntimeSubjectMetadata | null | undefined>
): AgentRuntimeSubjectMetadata[] {
  const seen = new Set<string>();
  const out: AgentRuntimeSubjectMetadata[] = [];
  for (const subject of subjects) {
    if (!subject?.agentSubjectKey || seen.has(subject.agentSubjectKey)) continue;
    seen.add(subject.agentSubjectKey);
    out.push(subject);
  }
  return out;
}

function buildTerminalTargetSubjectContext(params: {
  agents: CircleOfficeAgent[];
  targetAgentId: string | null;
  targetAgentName: string;
  targetAgentIds: string[] | null;
}): {
  targetAgentSubject: AgentRuntimeSubjectMetadata | null;
  targetAgentSubjects: AgentRuntimeSubjectMetadata[] | null;
} {
  const byId = new Map(params.agents.map(agent => [agent.id, agent]));
  const byName = new Map(
    params.agents.map(agent => [cleanTargetLookupName(agent.name), agent])
  );
  const resolve = (id?: string | null, fallbackName?: string | null) => {
    if (id && byId.has(id)) return buildTerminalAgentSubjectMetadata(byId.get(id)!);
    const cleanName = cleanTargetLookupName(fallbackName);
    if (cleanName && byName.has(cleanName)) return buildTerminalAgentSubjectMetadata(byName.get(cleanName)!);
    return null;
  };

  const requestedTargetCount = params.targetAgentIds?.length
    ? params.targetAgentIds.length
    : params.targetAgentId
      ? 1
      : params.agents.length;
  const selectedSubjects = params.targetAgentIds?.length
    ? params.targetAgentIds.map(id => resolve(id))
    : params.targetAgentId
      ? [resolve(params.targetAgentId, params.targetAgentName)]
      : params.agents.map(buildTerminalAgentSubjectMetadata);

  const targetAgentSubjects = uniqueTerminalAgentSubjects(selectedSubjects);
  return {
    targetAgentSubject: requestedTargetCount === 1 && targetAgentSubjects.length === 1 ? targetAgentSubjects[0] : null,
    targetAgentSubjects: targetAgentSubjects.length > 0 ? targetAgentSubjects : null,
  };
}

// ─── Streaming indicator ─────────────────────────────────────────────────────

function PendingDots() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setFrame(f => (f + 1) % 4), 300);
    return () => clearInterval(t);
  }, []);
  const bars = ['|', '/', '-', '\\'];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Text style={{ color: BS.accent, fontFamily: MONO, fontSize: 11, width: 10, textAlign: 'center' }}>{bars[frame]}</Text>
      <Text style={{ color: BS.textSecondary, fontFamily: MONO, fontSize: 11 }}>streaming</Text>
    </View>
  );
}

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

  if (parts.length === 0) return <Text style={respContentStyles.text}>{text}</Text>;

  return (
    <View style={{ flex: 1 }}>
      {parts.map((p, i) =>
        p.type === 'image' ? (
          <Image
            key={i}
            source={{ uri: p.value }}
            style={{ width: 256, height: 256, borderRadius: 12, marginVertical: 6 }}
            resizeMode="cover"
            accessibilityLabel={p.alt || 'Generated image'}
          />
        ) : (
          <Text key={i} style={respContentStyles.text}>{p.value}</Text>
        ),
      )}
    </View>
  );
}

const respContentStyles = StyleSheet.create({
  text: {
    color: BS.textPrimary,
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
    fontFamily: MONO,
  },
});

// ─── Response Card (OpenSwan-style collapsible) ──────────────────────────────

function ResponseCard({ resp }: { resp: TerminalResponse }) {
  const [collapsed, setCollapsed] = useState(false);
  const isLong = (resp.responseText?.length || 0) > 400;

  if (resp.status === 'pending') {
    return (
      <View style={cardStyles.card}>
        <View style={cardStyles.cardHeader}>
          <View style={[cardStyles.agentDot, { backgroundColor: BS.accent }]} />
          <Text style={cardStyles.agentName}>{resp.agentName}</Text>
        </View>
        <PendingDots />
      </View>
    );
  }

  if (resp.status === 'streaming') {
    return (
      <View style={[cardStyles.card, cardStyles.streamingCard]}>
        <View style={[cardStyles.cardHeader, cardStyles.streamingHeader]}>
          <View style={[cardStyles.agentDot, { backgroundColor: BS.accentDim }]} />
          <Text style={cardStyles.agentName}>{resp.agentName}</Text>
          <Text style={cardStyles.streamingBadge}>HANDOFF OPEN · AWAITING VERIFIED RESULT</Text>
        </View>
        <ResponseContent text={resp.responseText || ''} />
        <Text style={cardStyles.streamingNotice}>
          Completion is unverified. Check the connected agent before retrying if dispatch was uncertain.
        </Text>
      </View>
    );
  }

  if (resp.status === 'error') {
    return (
      <View style={[cardStyles.card, { borderLeftColor: BS.error }]}>
        <View style={cardStyles.cardHeader}>
          <View style={[cardStyles.agentDot, { backgroundColor: BS.error }]} />
          <Text style={[cardStyles.agentName, { color: BS.error }]}>{resp.agentName}</Text>
          <Text style={cardStyles.errorBadge}>ERR</Text>
        </View>
        <Text style={cardStyles.errorText}>{resp.errorMessage || resp.responseText || 'Unknown error'}</Text>
      </View>
    );
  }

  return (
    <View style={cardStyles.card}>
      <Pressable style={cardStyles.cardHeader} onPress={() => isLong && setCollapsed(!collapsed)}>
        <View style={[cardStyles.agentDot, { backgroundColor: BS.accent }]} />
        <Text style={cardStyles.agentName}>{resp.agentName}</Text>
        {resp.tokenCount > 0 && (
          <Text style={cardStyles.tokenBadge}>{fmtTokenCost(resp.tokenCount)}</Text>
        )}
        {resp.latencyMs != null && (
          <Text style={cardStyles.latencyBadge}>
            {resp.latencyMs >= 1000 ? `${(resp.latencyMs / 1000).toFixed(1)}s` : `${resp.latencyMs}ms`}
          </Text>
        )}
        {isLong && (
          <Text style={cardStyles.collapseIcon}>{collapsed ? '+' : '-'}</Text>
        )}
      </Pressable>
      {!collapsed && <ResponseContent text={resp.responseText || ''} />}
    </View>
  );
}

const cardStyles = StyleSheet.create({
  card: {
    backgroundColor: BS.bgCard,
    borderWidth: 1,
    borderColor: BS.border,
    borderRadius: 12,
    marginTop: 6,
    marginLeft: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  streamingCard: {
    borderColor: BS.borderLit,
    borderLeftWidth: 3,
    borderLeftColor: BS.accentDim,
  },
  streamingHeader: {
    flexWrap: 'wrap',
    ...(Platform.OS === 'web' ? { cursor: 'default' } as any : {}),
  },
  streamingBadge: {
    color: BS.accent,
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.7,
    backgroundColor: BS.accentGlow,
    borderWidth: 1,
    borderColor: BS.borderLit,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
    marginLeft: 'auto',
  },
  streamingNotice: {
    color: BS.textSecondary,
    fontFamily: MONO,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 8,
  },
  agentDot: { width: 6, height: 6, borderRadius: 3 },
  agentName: {
    color: BS.accent,
    fontFamily: MONO,
    fontSize: 11,
    fontWeight: '700',
  },
  tokenBadge: {
    color: BS.textSecondary,
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '600',
    backgroundColor: '#ffffff08',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
    marginLeft: 'auto',
  },
  latencyBadge: {
    color: BS.textMuted,
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: '600',
  },
  collapseIcon: {
    color: BS.textMuted,
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: '700',
    width: 14,
    textAlign: 'center',
  },
  errorBadge: {
    color: '#f87171',
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: '800',
    backgroundColor: '#f8717114',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
    letterSpacing: 1,
  },
  errorText: {
    color: '#f87171',
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 16,
  },
});

// ─── Terminal Message Row (OpenSwan card layout) ─────────────────────────────

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
      {/* User command line */}
      <View style={rowStyles.cmdBlock}>
        <View style={rowStyles.cmdMeta}>
          <Text style={rowStyles.time}>{fmtTime(msg.createdAt)}</Text>
          {!isLocal && <Text style={rowStyles.sender}>{msg.senderName}</Text>}
          <Text style={rowStyles.targetTag}>{msg.targetAgentName}</Text>
          {onDelete && hovered && (
            <Pressable style={rowStyles.deleteBtn} onPress={() => onDelete(msg.id)} hitSlop={8}>
              <Text style={rowStyles.deleteText}>x</Text>
            </Pressable>
          )}
        </View>
        <View style={rowStyles.cmdLine}>
          <Text style={rowStyles.prompt}>{'>'}</Text>
          <Text style={rowStyles.command}>{msg.commandText}</Text>
        </View>
      </View>

      {/* Response cards */}
      {msgResponses.length > 0 ? (
        msgResponses.map(resp => <ResponseCard key={resp.id} resp={resp} />)
      ) : msg.responseText ? (
        <View style={[cardStyles.card, isLocal && { borderLeftColor: BS.info }]}>
          {msg.responseAgentName && (
            <View style={cardStyles.cardHeader}>
              <View style={[cardStyles.agentDot, { backgroundColor: isLocal ? BS.info : BS.accent }]} />
              <Text style={[cardStyles.agentName, isLocal && { color: BS.info }]}>{msg.responseAgentName}</Text>
            </View>
          )}
          <ResponseContent text={msg.responseText || ''} />
        </View>
      ) : (
        <View style={cardStyles.card}>
          <View style={cardStyles.cardHeader}>
            <View style={[cardStyles.agentDot, { backgroundColor: BS.accent }]} />
            <Text style={cardStyles.agentName}>{msg.targetAgentName}</Text>
          </View>
          <PendingDots />
        </View>
      )}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
  },
  cmdBlock: {
    marginBottom: 2,
  },
  cmdMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  time: {
    color: BS.textMuted,
    fontSize: 9,
    fontFamily: MONO,
  },
  sender: {
    color: BS.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    fontFamily: MONO,
  },
  targetTag: {
    color: BS.textSecondary,
    fontSize: 9,
    fontWeight: '700',
    fontFamily: MONO,
    backgroundColor: '#ffffff08',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
  },
  cmdLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  prompt: {
    color: BS.user,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: MONO,
    marginRight: 6,
  },
  command: {
    color: BS.textPrimary,
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
    fontFamily: MONO,
  },
  deleteBtn: {
    marginLeft: 'auto',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: BS.bgCard,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  deleteText: {
    color: BS.textMuted,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: MONO,
  },
});

// ─── Agent Target Chip (OpenSwan-style pill) ─────────────────────────────────

interface ChipProps {
  label: string;
  active: boolean;
  onPress: () => void;
  dotColor?: string;
}

function AgentChip({ label, active, onPress, dotColor }: ChipProps) {
  return (
    <Pressable
      style={[chipStyles.chip, active && chipStyles.chipActive]}
      onPress={onPress}
    >
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
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
    backgroundColor: BS.bgCard, borderWidth: 1, borderColor: BS.border,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  chipActive: { backgroundColor: BS.accentGlow, borderColor: BS.accent },
  dot: { width: 5, height: 5, borderRadius: 3, flexShrink: 0 },
  text: { color: BS.textSecondary, fontSize: 10, fontWeight: '600', fontFamily: MONO, maxWidth: 80 },
  textActive: { color: BS.accent },
});

// ─── Model Chip (OpenSwan-style toggle) ──────────────────────────────────────

function ModelChip({ label, icon, active, color, onPress }: {
  label: string; icon: string; active: boolean; color: string; onPress: () => void;
}) {
  return (
    <Pressable
      style={[modelChipStyles.chip, active && { backgroundColor: color + '18', borderColor: color }]}
      onPress={onPress}
    >
      <View style={[modelChipStyles.iconBox, active && { backgroundColor: color + '30' }]}>
        <Text style={[modelChipStyles.iconText, active && { color }]}>{icon}</Text>
      </View>
      <Text style={[modelChipStyles.text, active && { color }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const modelChipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    backgroundColor: BS.bgCard, borderWidth: 1, borderColor: BS.border,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  iconBox: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: BS.bgPanel,
    alignItems: 'center', justifyContent: 'center',
  },
  iconText: {
    color: BS.textMuted, fontFamily: MONO, fontSize: 9, fontWeight: '800',
  },
  text: {
    color: BS.textMuted, fontSize: 10, fontWeight: '600', fontFamily: MONO,
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
    borderTopWidth: 1, borderTopColor: BS.border,
    backgroundColor: BS.bgPanel,
  },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10,
    backgroundColor: BS.bgCard, borderWidth: 1, borderColor: '#ffffff15',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  text: { color: BS.accent, fontSize: 11, fontFamily: MONO },
});

// ─── Status dot colors ────────────────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  idle: BS.success, active: BS.accent, building: BS.warning, offline: BS.textMuted, error: BS.error,
};

// ─── Local Shell Panel ───────────────────────────────────────────────────────

interface ShellEntry {
  id: string;
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  code: number;
  ok: boolean;
  timestamp: string;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CommandKeyPanel — accordion-style command reference
// ═══════════════════════════════════════════════════════════════════════════════

const COMMAND_SECTIONS = [
  {
    title: 'Agent Commands',
    icon: '🤖',
    commands: [
      { cmd: '/status',    desc: 'Ask agent for current task status', hint: 'What are you working on?' },
      { cmd: '/stop',      desc: 'Ask agent to stop current task', hint: 'Gracefully halt work' },
      { cmd: '/summarize', desc: 'Summarize recent work', hint: 'Get a recap of what was done' },
      { cmd: '/plan',      desc: 'Outline next steps', hint: 'Ask agent to plan ahead' },
      { cmd: '/ping',      desc: 'Verify agent is responsive', hint: 'Quick health check' },
      { cmd: '/whoami',    desc: 'Agent identity & capabilities', hint: 'What model, what tools?' },
    ],
  },
  {
    title: 'Discovery',
    icon: '🔍',
    commands: [
      { cmd: '/agents',  desc: 'List connected agents and status', hint: 'See who is online' },
      { cmd: '/models',  desc: 'Show available AI models', hint: 'From registry + BYO keys' },
      { cmd: '/devices', desc: 'List local connected devices', hint: 'Printers, serial, USB' },
      { cmd: '/cost',    desc: 'Token usage & cost breakdown', hint: 'How much has been spent' },
    ],
  },
  {
    title: 'Create & Generate',
    icon: '✨',
    commands: [
      { cmd: '/spawn',   desc: 'Create a new agent in this circle', hint: 'Deploy a new AI agent' },
      { cmd: '/imagine',  desc: 'Generate an image from a prompt', hint: '/imagine a sunset over mountains' },
    ],
  },
  {
    title: 'Targeting',
    icon: '🎯',
    commands: [
      { cmd: '@AgentName', desc: 'Send command to a specific agent', hint: 'Click agent chips below input' },
      { cmd: '@all',       desc: 'Broadcast to all online agents', hint: 'Every agent responds' },
      { cmd: '@BlackSwan', desc: 'Talk to the circle\'s AI', hint: 'Always available' },
    ],
  },
  {
    title: 'Modes',
    icon: '⚡',
    commands: [
      { cmd: 'Exec',      desc: 'Direct execution mode (default)', hint: 'Agent acts immediately' },
      { cmd: 'Plan',      desc: 'Planning mode — think before acting', hint: 'Agent outlines steps first' },
      { cmd: 'Explore',   desc: 'Research mode — gather info', hint: 'Agent investigates before answering' },
      { cmd: 'Fleet',     desc: 'Multi-agent coordination', hint: 'Agents collaborate on tasks' },
      { cmd: 'Autopilot', desc: 'Autonomous loop — agent keeps working', hint: 'Runs until you hit STOP' },
    ],
  },
  {
    title: 'Thinking Levels',
    icon: '🧠',
    commands: [
      { cmd: 'Fast',     desc: 'Quick responses, lower cost', hint: 'Best for simple questions' },
      { cmd: 'Balanced', desc: 'Default — good quality + speed', hint: 'Everyday usage' },
      { cmd: 'Deep',     desc: 'Maximum reasoning, higher cost', hint: 'Complex problems, code review' },
    ],
  },
  {
    title: 'Shell (Local Bridge)',
    icon: '💻',
    commands: [
      { cmd: 'pwd',          desc: 'Print working directory', hint: 'Where is the agent running?' },
      { cmd: 'git status',   desc: 'Git repository status', hint: 'See uncommitted changes' },
      { cmd: 'git log -5',   desc: 'Recent commit history', hint: 'Last 5 commits' },
      { cmd: 'ls -la',       desc: 'List files in directory', hint: 'See what\'s in the folder' },
      { cmd: 'df -h /',      desc: 'Disk space usage', hint: 'How much storage is left' },
      { cmd: 'uptime',       desc: 'System uptime', hint: 'How long has the machine been on' },
    ],
  },
  {
    title: 'Tips',
    icon: '💡',
    commands: [
      { cmd: 'Arrow Up/Down', desc: 'Cycle through command history', hint: 'Like a real terminal' },
      { cmd: 'Tab',           desc: 'Autocomplete agent names', hint: 'Start typing @ to see suggestions' },
      { cmd: 'Enter',         desc: 'Send command', hint: 'Or click the > button' },
    ],
  },
];

function CommandKeyPanel({ onRunCommand }: { onRunCommand: (cmd: string) => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ 'Agent Commands': true });

  const toggleSection = (title: string) => {
    setExpanded(prev => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
      <View style={{ padding: 12 }}>
        <Text style={{ color: BS.accent, fontSize: 16, fontWeight: '700', fontFamily: MONO, marginBottom: 4 }}>
          Command Reference
        </Text>
        <Text style={{ color: BS.textMuted, fontSize: 11, fontFamily: MONO, marginBottom: 12 }}>
          Tap any command to use it
        </Text>

        {COMMAND_SECTIONS.map(section => {
          const isOpen = expanded[section.title] ?? false;
          return (
            <View key={section.title} style={{ marginBottom: 2 }}>
              {/* Accordion header */}
              <Pressable
                onPress={() => toggleSection(section.title)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  backgroundColor: isOpen ? BS.bgCard : 'transparent',
                  borderRadius: 6,
                  borderWidth: isOpen ? 1 : 0,
                  borderColor: BS.border,
                  ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
                }}
              >
                <Text style={{ fontSize: 14, marginRight: 8 }}>{section.icon}</Text>
                <Text style={{
                  color: isOpen ? BS.accent : BS.textSecondary,
                  fontSize: 12,
                  fontWeight: '700',
                  fontFamily: MONO,
                  letterSpacing: 0.5,
                  flex: 1,
                }}>
                  {section.title.toUpperCase()}
                </Text>
                <Text style={{ color: BS.textMuted, fontSize: 11, fontFamily: MONO }}>
                  {section.commands.length}
                </Text>
                <Text style={{ color: BS.textMuted, fontSize: 12, marginLeft: 8, fontFamily: MONO }}>
                  {isOpen ? '▾' : '▸'}
                </Text>
              </Pressable>

              {/* Accordion content */}
              {isOpen && (
                <View style={{ paddingLeft: 4, paddingTop: 4, paddingBottom: 8 }}>
                  {section.commands.map(c => (
                    <Pressable
                      key={c.cmd}
                      onPress={() => {
                        if (c.cmd.startsWith('/') || c.cmd.startsWith('@')) {
                          onRunCommand(c.cmd);
                        }
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'flex-start',
                        paddingVertical: 6,
                        paddingHorizontal: 8,
                        borderRadius: 4,
                        ...(Platform.OS === 'web' ? { cursor: c.cmd.startsWith('/') || c.cmd.startsWith('@') ? 'pointer' : 'default' } as any : {}),
                      }}
                    >
                      <Text style={{
                        color: c.cmd.startsWith('/') ? BS.accent : BS.textSecondary,
                        fontSize: 12,
                        fontWeight: '600',
                        fontFamily: MONO,
                        width: 110,
                        flexShrink: 0,
                      }}>
                        {c.cmd}
                      </Text>
                      <View style={{ flex: 1, marginLeft: 8 }}>
                        <Text style={{ color: BS.textSecondary, fontSize: 11, fontFamily: MONO, lineHeight: 16 }}>
                          {c.desc}
                        </Text>
                        <Text style={{ color: BS.textMuted, fontSize: 10, fontFamily: MONO, fontStyle: 'italic', lineHeight: 14 }}>
                          {c.hint}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════

function LocalShellPanel() {
  const [entries, setEntries] = useState<ShellEntry[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [cwd, setCwd] = useState('~');
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState(-1);
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);

  // Check bridge connection on mount + periodically. 30s is fine — bridge
  // up/down transitions are rare and the user gets immediate feedback from
  // command failures if the bridge dies mid-session.
  useEffect(() => {
    const check = () => detectClaudeCodeBridge().then(setBridgeOk);
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // Detect initial working directory
  useEffect(() => {
    execBridgeCommand('pwd').then(res => {
      if (res.ok && res.stdout) setCwd(res.stdout.trim());
    });
  }, []);

  const handleSend = useCallback(async () => {
    const cmd = input.trim();
    if (!cmd || sending) return;

    // Re-check bridge if it was offline — maybe it came back
    if (!bridgeOk) {
      const ok = await detectClaudeCodeBridge();
      setBridgeOk(ok);
      if (!ok) return;
    }

    setSending(true);
    setInput('');
    setCmdHistory(prev => [cmd, ...prev].slice(0, 100));
    setHistoryIdx(-1);

    // Handle 'clear' locally
    if (cmd === 'clear' || cmd === 'cls') {
      setEntries([]);
      setSending(false);
      return;
    }

    // Handle 'help' locally — show available commands
    if (cmd === 'help') {
      setEntries(prev => [...prev, {
        id: `shell-${Date.now()}`,
        command: cmd,
        cwd,
        stdout: [
          'Local Shell — WSL/Linux + Windows Interop',
          '',
          'Linux/WSL commands:',
          '  ls, cat, pwd, cd, mkdir, cp, mv, rm, grep, find, git, npm, node, python...',
          '',
          'Windows interop (from WSL):',
          '  cmd.exe /c "dir"              — Run Windows CMD command',
          '  powershell.exe -Command "..."  — Run PowerShell command',
          '  explorer.exe .                 — Open current folder in Explorer',
          '  notepad.exe file.txt           — Open file in Notepad',
          '  code .                         — Open in VS Code',
          '  wslpath -w /home/user          — Convert WSL path to Windows path',
          '  wslpath -u "C:\\Users"          — Convert Windows path to WSL path',
          '',
          'Built-in shortcuts:',
          '  clear / cls     — Clear terminal',
          '  help            — Show this help',
          '  windir          — List Windows user directory',
          '  winpath         — Show Windows path for current directory',
          '  devices [cmd]   — Manage printers, 3D printers, serial ports',
          '',
          'History: ↑/↓ arrows  ·  Tab: autocomplete (coming soon)',
        ].join('\n'),
        stderr: '',
        code: 0,
        ok: true,
        timestamp: new Date().toISOString(),
        durationMs: 0,
      }]);
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      return;
    }

    // Handle 'devices' locally — device discovery & control
    if (cmd === 'devices' || cmd.startsWith('devices ')) {
      const output = await executeDeviceCommand(cmd);
      setEntries(prev => [...prev, {
        id: `shell-${Date.now()}`,
        command: cmd,
        cwd,
        stdout: output,
        stderr: '',
        code: 0,
        ok: true,
        timestamp: new Date().toISOString(),
        durationMs: 0,
      }]);
      setSending(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
      return;
    }

    const start = Date.now();

    // Built-in shortcuts for Windows interop
    let resolvedCmd = cmd;
    if (cmd === 'windir') resolvedCmd = 'cmd.exe /c "dir /B %USERPROFILE%"';
    else if (cmd === 'winpath') resolvedCmd = `wslpath -w "${cwd}"`;
    else if (cmd === 'dir') resolvedCmd = 'ls -la';  // Windows users expect 'dir' to work
    else if (cmd === 'ipconfig') resolvedCmd = 'ip addr show || ifconfig';
    else if (cmd === 'tasklist') resolvedCmd = 'ps aux';
    else if (cmd === 'systeminfo') resolvedCmd = 'uname -a && cat /etc/os-release 2>/dev/null';

    // Handle 'cd' — update cwd and verify
    const cdMatch = resolvedCmd.match(/^cd\s+(.+)/);

    // Build the actual command with cwd prefix
    const fullCmd = cwd && cwd !== '~'
      ? `cd ${JSON.stringify(cwd)} && ${resolvedCmd}`
      : resolvedCmd;

    const res = await execBridgeCommand(fullCmd);
    const durationMs = Date.now() - start;

    const entry: ShellEntry = {
      id: `shell-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      command: cmd,
      cwd,
      stdout: res.stdout?.trim() || '',
      stderr: res.stderr?.trim() || '',
      code: res.code ?? (res.ok ? 0 : 1),
      ok: res.ok ?? false,
      timestamp: new Date().toISOString(),
      durationMs,
    };

    // Handle error from bridge being down
    if (res.error && !res.stdout && !res.stderr) {
      entry.stderr = res.error;
      entry.ok = false;
      entry.code = -1;
    }

    setEntries(prev => [...prev, entry]);

    // Update cwd if cd was used (or any command might change it)
    if (cdMatch || resolvedCmd.includes('cd ')) {
      const pwdRes = await execBridgeCommand(
        cwd && cwd !== '~' ? `cd ${JSON.stringify(cwd)} && ${resolvedCmd} && pwd` : `${resolvedCmd} && pwd`
      );
      if (pwdRes.ok && pwdRes.stdout) {
        const lines = pwdRes.stdout.trim().split('\n');
        setCwd(lines[lines.length - 1].trim());
      }
    }

    setSending(false);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [input, sending, cwd]);

  const handleKeyPress = useCallback((e: any) => {
    const key = e.nativeEvent?.key;
    if (key === 'ArrowUp') {
      const newIdx = Math.min(historyIdx + 1, cmdHistory.length - 1);
      if (newIdx >= 0 && cmdHistory[newIdx]) {
        setHistoryIdx(newIdx);
        setInput(cmdHistory[newIdx]);
      }
    } else if (key === 'ArrowDown') {
      const newIdx = Math.max(historyIdx - 1, -1);
      setHistoryIdx(newIdx);
      setInput(newIdx === -1 ? '' : cmdHistory[newIdx] ?? '');
    }
  }, [historyIdx, cmdHistory]);

  return (
    <View style={{ flex: 1, backgroundColor: BS.bg }}>
      {/* Connection status bar */}
      <View style={shellStyles.statusBar}>
        <View style={[
          shellStyles.statusDot,
          { backgroundColor: bridgeOk === null ? BS.warning : bridgeOk ? BS.accent : BS.error },
        ]} />
        <Text style={shellStyles.statusText}>
          {bridgeOk === null ? 'connecting...' : bridgeOk ? 'bridge:7778' : 'offline'}
        </Text>
        {cwd !== '~' && (
          <Text style={shellStyles.cwdText} numberOfLines={1}>{cwd}</Text>
        )}
      </View>

      {/* Output area */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 12, gap: 2 }}
        showsVerticalScrollIndicator={false}
      >
        {entries.length === 0 && (
          <View style={shellStyles.welcomeBox}>
            <Text style={shellStyles.welcomeTitle}>BlackSwan Shell</Text>
            <Text style={shellStyles.welcomeText}>
              Local bridge at localhost:7778{'\n'}
              Type "help" for commands  |  "clear" to reset  |  up/down for history
            </Text>
          </View>
        )}

        {entries.map(entry => (
          <View key={entry.id} style={shellStyles.entry}>
            <View style={shellStyles.cmdRow}>
              <Text style={shellStyles.promptChar}>$</Text>
              <Text style={shellStyles.cmdText}>{entry.command}</Text>
              <Text style={[
                shellStyles.exitCode,
                { color: entry.ok ? BS.accent + '60' : BS.error + '80' },
              ]}>
                {entry.code !== 0 ? `[${entry.code}]` : ''} {entry.durationMs}ms
              </Text>
            </View>

            {entry.stdout ? (
              <Text style={shellStyles.stdout} selectable>{entry.stdout}</Text>
            ) : null}

            {entry.stderr ? (
              <Text style={[shellStyles.stderr, { color: entry.ok ? BS.warning : BS.error }]} selectable>
                {entry.stderr}
              </Text>
            ) : null}
          </View>
        ))}

        {sending && (
          <View style={shellStyles.cmdRow}>
            <Text style={shellStyles.promptChar}>$</Text>
            <PendingDots />
          </View>
        )}
      </ScrollView>

      {/* Input bar */}
      <View style={shellStyles.inputRow}>
        <Text style={shellStyles.inputPrompt}>{cwd.split('/').pop() || '~'} $</Text>
        <TextInput
          ref={inputRef}
          style={shellStyles.input}
          value={input}
          onChangeText={(v) => { setInput(v); setHistoryIdx(-1); }}
          placeholder={bridgeOk === false ? 'bridge offline...' : 'command...'}
          placeholderTextColor={BS.textMuted}
          multiline={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          onKeyPress={handleKeyPress}
          editable={!sending}
          autoCorrect={false}
          autoCapitalize="none"
        />
        <Pressable
          style={[shellStyles.sendBtn, (!input.trim() || sending) && shellStyles.sendBtnDisabled]}
          onPress={handleSend}
          disabled={!input.trim() || sending}
        >
          <Text style={shellStyles.sendIcon}>{sending ? '...' : '>'}</Text>
        </Pressable>
      </View>

      {cmdHistory.length > 0 && (
        <View style={shellStyles.historyHint}>
          <Text style={shellStyles.historyHintText}>
            {cmdHistory.length} in history
          </Text>
        </View>
      )}
    </View>
  );
}

const shellStyles = StyleSheet.create({
  statusBar: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: BS.bgPanel, borderBottomWidth: 1, borderBottomColor: BS.border,
  },
  statusDot: { width: 5, height: 5, borderRadius: 3 },
  statusText: { color: BS.textMuted, fontSize: 9, fontFamily: MONO, fontWeight: '600' },
  cwdText: { color: BS.textMuted, fontSize: 9, fontFamily: MONO, marginLeft: 'auto', maxWidth: 200 },
  welcomeBox: { paddingVertical: 16, gap: 4 },
  welcomeTitle: { color: BS.accent, fontSize: 13, fontWeight: '800', letterSpacing: 1, fontFamily: MONO },
  welcomeText: { color: BS.textMuted, fontSize: 10, lineHeight: 16, fontFamily: MONO },
  entry: { paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: BS.border + '40' },
  cmdRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  promptChar: { color: BS.accent, fontSize: 12, fontWeight: '700', flexShrink: 0, fontFamily: MONO },
  cmdText: { color: BS.textPrimary, fontSize: 12, flex: 1, lineHeight: 18, fontFamily: MONO },
  exitCode: { fontSize: 9, fontWeight: '600', marginLeft: 'auto', flexShrink: 0, fontFamily: MONO },
  stdout: { color: BS.textPrimary, fontSize: 11, lineHeight: 16, paddingLeft: 18, marginTop: 2, fontFamily: MONO },
  stderr: { fontSize: 11, lineHeight: 16, paddingLeft: 18, marginTop: 2, fontFamily: MONO },
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: BS.bgInput, borderTopWidth: 1, borderTopColor: BS.border,
    paddingHorizontal: 12, paddingVertical: 6, gap: 8,
  },
  inputPrompt: { color: BS.accent, fontSize: 11, fontWeight: '700', flexShrink: 0, fontFamily: MONO },
  input: {
    flex: 1, color: BS.textPrimary, fontSize: 12, fontFamily: MONO,
    paddingVertical: 4, minHeight: 32,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  sendBtn: {
    width: 32, height: 32, borderRadius: 10,
    backgroundColor: BS.accent, alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  sendBtnDisabled: { backgroundColor: BS.bgCard, opacity: 0.5 },
  sendIcon: { color: '#000', fontSize: 13, fontWeight: '800', fontFamily: MONO },
  historyHint: { paddingHorizontal: 14, paddingBottom: 3, backgroundColor: BS.bgInput },
  historyHintText: { color: BS.textGhost, fontSize: 8, fontFamily: MONO },
});

// ─── Terminal sub-tabs ────────────────────────────────────────────────────────

type TerminalTab = 'commands' | 'automations' | 'shell' | 'spawn' | 'key' | 'train';

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
  readOnly = false,
  readOnlyReason = 'Command history only.',
  terminalAuthority,
  isTerminalAuthorityCurrent,
  onCommandSent,
}: Props) {
  const [accountModelChoices, setAccountModelChoices] = useState<Array<{ key: string; label: string; icon: string; color: string }>>([]);
  const [modelCatalogNotice, setModelCatalogNotice] = useState<string | null>(null);
  const normalizedTerminalAuthority = useMemo(() => normalizeTerminalExactAuthority(
    terminalAuthority,
  ), [
    terminalAuthority?.accessToken,
    terminalAuthority?.circleId,
    terminalAuthority?.generation,
    terminalAuthority?.userId,
  ]);
  const terminalAuthorityRef = useRef<TerminalExactAuthority | null>(normalizedTerminalAuthority);
  const terminalAuthorityGuardRef = useRef<TerminalAuthorityCurrentGuard | undefined>(
    isTerminalAuthorityCurrent,
  );
  const terminalMountedRef = useRef(true);
  // Render-time replacement retires the old subject before effects or awaited
  // callbacks get another turn on the event loop.
  terminalAuthorityRef.current = normalizedTerminalAuthority;
  terminalAuthorityGuardRef.current = isTerminalAuthorityCurrent;
  const capturedTerminalAuthorityIsCurrent = useCallback((captured: TerminalExactAuthority) => {
    if (
      !terminalMountedRef.current
      || !terminalExactAuthorityMatches(captured, terminalAuthorityRef.current)
    ) return false;
    try {
      return terminalAuthorityGuardRef.current?.(captured) === true;
    } catch {
      return false;
    }
  }, []);
  useEffect(() => {
    terminalMountedRef.current = true;
    return () => {
      terminalMountedRef.current = false;
      terminalAuthorityRef.current = null;
    };
  }, []);

  // The Office terminal shares Chat/Rooms' exact account-catalog contract.
  // Keep only a compact first three ready choices per provider; Advanced
  // catalog browsing belongs in Chat/Marketplace rather than this command bar.
  useEffect(() => {
    let cancelled = false;
    setAccountModelChoices([]);
    if (readOnly) {
      setModelCatalogNotice(null);
      return () => { cancelled = true; };
    }
    setModelCatalogNotice('Checking account model catalogs…');
    void loadModelGroups(circleId, { includeDisconnected: false })
      .then((groups) => {
        if (cancelled) return;
        const choices: Array<{ key: string; label: string; icon: string; color: string }> = [];
        const seen = new Set<string>(BASE_MODELS.map((model) => String(model.key || 'auto')));
        for (const group of groups) {
          if (!group.connected || group.provider === 'blackswan') continue;
          const providerKey = group.provider === 'hugging_face'
            ? 'huggingface'
            : group.provider === 'z_ai'
              ? 'zai'
              : group.provider;
          const meta = PROVIDER_META[providerKey as keyof typeof PROVIDER_META];
          for (const model of group.models.filter((item) => item.ready).slice(0, 3)) {
            if (seen.has(model.id)) continue;
            seen.add(model.id);
            choices.push({
              key: model.id,
              label: model.label,
              icon: meta?.icon || 'AI',
              color: meta?.color || '#6366f1',
            });
          }
        }
        const fallbackGroups = groups.filter((group) => (
          group.connected && ['curated_fallback', 'catalog_unsupported'].includes(group.catalogStatus)
        ));
        const emptyGroups = groups.filter((group) => (
          group.connected && group.catalogStatus === 'account_verified_empty'
        ));
        setAccountModelChoices(choices);
        setModelCatalogNotice(
          emptyGroups.length > 0
            ? `${emptyGroups.map((group) => group.label).join(', ')} returned no supported chat models for this key.`
            : fallbackGroups.length > 0
              ? `${fallbackGroups.map((group) => group.label).join(', ')} ${fallbackGroups.length === 1 ? 'is' : 'are'} using a curated fallback; exact access is checked when the command starts.`
              : null,
        );
      })
      .catch(() => {
        if (cancelled) return;
        setAccountModelChoices(buildBYOModels(byoProviderKeys || []));
        setModelCatalogNotice('Account model catalogs could not be checked; exact access is checked when the command starts.');
      });
    return () => { cancelled = true; };
  }, [circleId, byoProviderKeys, readOnly]);

  // Dynamic model list: base models + exact account rows. Preserve the
  // previous curated BYO builder only as the explicit load-failure fallback.
  const TERMINAL_MODELS = useMemo(() => {
    return [...BASE_MODELS, ...accountModelChoices];
  }, [accountModelChoices]);

  const [terminalTab, setTerminalTab]          = useState<TerminalTab>(initialTab || 'commands');
  useEffect(() => { if (initialTab) setTerminalTab(initialTab); }, [initialTab]);
  const [thinkingLevel, setThinkingLevel]     = useState<ThinkingLevel>('balanced');
  const [terminalMode, setTerminalMode]       = useState<TerminalMode>('execute');
  const [messages, setMessages]               = useState<TerminalMessage[]>([]);
  const [responses, setResponses]             = useState<Map<string, TerminalResponse[]>>(new Map());
  const [localInput, setLocalInput]           = useState('');
  const [localModel, setLocalModel]           = useState<string | null>(null);
  const [localTargetIds, setLocalTargetIds]   = useState<string[] | null>(() => (
    agents.some(agent => agent.id === DEFAULT_BLACKSWAN_TARGET_ID)
      ? [DEFAULT_BLACKSWAN_TARGET_ID]
      : null
  ));
  const [sending, setSending]                 = useState(false);
  const [sendError, setSendError]             = useState<string | null>(null);
  const [loading, setLoading]                 = useState(true);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  // Command history — local per instance (UI preference)
  const [cmdHistory, setCmdHistory]           = useState<string[]>([]);
  const [historyIdx, setHistoryIdx]           = useState(-1);
  const listRef   = useRef<FlatList<TerminalMessage>>(null);
  const inputRef  = useRef<TextInput>(null);
  const targetSelectionTouchedRef = useRef(false);
  // Track deleted message IDs to prevent stale response subscription events
  const deletedIdsRef = useRef<Set<string>>(new Set());
  const messagesRef = useRef<TerminalMessage[]>(messages);
  messagesRef.current = messages;
  const transcriptGenerationRef = useRef(0);
  const transcriptCircleRef = useRef(circleId);
  transcriptCircleRef.current = circleId;
  const exactTerminalAuthorityRequired = (
    terminalAuthority !== undefined || isTerminalAuthorityCurrent !== undefined
  );
  useEffect(() => {
    // A retired async operation intentionally cannot update replacement UI.
    // Reset its transient busy/error state from the new authority lifecycle so
    // the replacement account is not left with the old account's spinner.
    setSending(false);
    setSendError(null);
  }, [
    normalizedTerminalAuthority?.accessToken,
    normalizedTerminalAuthority?.circleId,
    normalizedTerminalAuthority?.generation,
    normalizedTerminalAuthority?.userId,
  ]);

  // ── Derive active input/target from shared or local state ──────────────────
  const input = sharedInput !== undefined ? sharedInput : localInput;
  const setInput = useCallback((v: string) => {
    if (onSharedInputChange !== undefined) onSharedInputChange(v);
    else setLocalInput(v);
  }, [onSharedInputChange]);

  // ── Model selection ──
  const selectedModel = sharedModel !== undefined ? sharedModel : localModel;
  const setSelectedModel = useCallback((m: string | null) => {
    if (onSharedModelChange !== undefined) onSharedModelChange(m);
    else setLocalModel(m);
  }, [onSharedModelChange]);

  // ── Canonical agent targeting ──
  // Multi-target ids are the single source of truth. The legacy single-target
  // props remain compatibility mirrors only, so an older parent cannot make
  // persistence target one agent while invocation targets another.
  const targetIdsSource = sharedTargetIds !== undefined
    ? sharedTargetIds
    : sharedTargetId !== undefined
      ? (sharedTargetId ? [sharedTargetId] : null)
      : localTargetIds;
  const targetIds = useMemo<string[] | null>(() => {
    if (!targetIdsSource?.length) return null;
    return Array.from(new Set(targetIdsSource));
  }, [targetIdsSource]);
  const targetSelection = useMemo(
    () => resolveTerminalTargetSelection(targetIds, agents),
    [agents, targetIds],
  );
  const targetAgentName = targetSelection.ok
    ? targetSelection.targetAgentName
    : (sharedTargetName?.trim() || 'Unavailable target');

  const selectTargets = useCallback((ids: string[] | null) => {
    targetSelectionTouchedRef.current = true;
    const normalizedIds = ids?.length ? Array.from(new Set(ids)) : null;
    const resolved = resolveTerminalTargetSelection(normalizedIds, agents);
    const legacyId = resolved.ok
      ? resolved.targetAgentId
      : normalizedIds?.length === 1
        ? normalizedIds[0]
        : null;
    const displayName = resolved.ok
      ? resolved.targetAgentName
      : 'Unavailable target';

    if (onSharedSelectTargets !== undefined) {
      onSharedSelectTargets(normalizedIds, displayName);
    } else if (sharedTargetIds === undefined) {
      setLocalTargetIds(normalizedIds);
    }
    onSharedSelectTarget?.(legacyId, displayName);
  }, [agents, onSharedSelectTarget, onSharedSelectTargets, sharedTargetIds]);

  // If the uncontrolled terminal mounted before its targets arrived, select
  // the visible BlackSwan target once it becomes available. An explicit @all
  // choice remains untouched.
  useEffect(() => {
    if (
      sharedTargetIds !== undefined
      || sharedTargetId !== undefined
      || targetSelectionTouchedRef.current
      || localTargetIds?.length
    ) return;
    if (agents.some(agent => agent.id === DEFAULT_BLACKSWAN_TARGET_ID)) {
      setLocalTargetIds([DEFAULT_BLACKSWAN_TARGET_ID]);
    }
  }, [agents, localTargetIds, sharedTargetId, sharedTargetIds]);

  // Toggle an agent in/out of multi-select
  const toggleAgentTarget = useCallback((agentId: string) => {
    const current = targetIds || [];
    const isSelected = current.includes(agentId);

    if (isSelected) {
      const next = current.filter(id => id !== agentId);
      if (next.length === 0) {
        selectTargets(null);
      } else {
        selectTargets(next);
      }
    } else {
      const next = [...current, agentId];
      selectTargets(next);
    }
  }, [targetIds, selectTargets]);

  // Select @all (clear multi-select)
  const selectAll = useCallback(() => {
    selectTargets(null);
  }, [selectTargets]);

  // ── Load history + subscribe ───────────────────────────────────────────────
  // Authoritative transcript load — used for the initial fetch AND as the
  // realtime catch-up. Messages/responses written while the socket was down
  // never arrive as events, so a reconnect that does not replay this leaves the
  // terminal permanently missing whatever the agent said during the gap.
  const reloadTranscript = useCallback(async () => {
    const requestedCircleId = circleId;
    const generation = ++transcriptGenerationRef.current;
    const requestIsCurrent = () => (
      transcriptGenerationRef.current === generation
      && transcriptCircleRef.current === requestedCircleId
    );
    setTranscriptError(null);
    try {
      const { messages: hist, error: historyError } = await loadTerminalHistory(requestedCircleId, 50);
      if (historyError) throw new Error(historyError);
      if (!requestIsCurrent()) return;
      setMessages(hist.filter(message => !deletedIdsRef.current.has(message.id)));
      // Phase 3: load existing responses for history messages
      if (hist.length > 0) {
        const resps = await loadResponsesForMessages(hist.map(m => m.id));
        if (!requestIsCurrent()) return;
        const map = new Map<string, TerminalResponse[]>();
        for (const r of resps) {
          if (deletedIdsRef.current.has(r.messageId)) continue;
          const arr = map.get(r.messageId) || [];
          arr.push(r);
          map.set(r.messageId, arr);
        }
        setResponses(map);
      } else {
        setResponses(new Map());
      }
    } catch (err) {
      console.error('[OfficeTerminal] transcript load failed:', err);
      if (requestIsCurrent()) {
        setTranscriptError('Recorded command history could not be loaded. Check your connection and retry.');
      }
    } finally {
      if (requestIsCurrent()) setLoading(false);
    }
  }, [circleId]);

  useEffect(() => {
    deletedIdsRef.current.clear();
    setLoading(true);
    setMessages([]);
    setResponses(new Map());

    void reloadTranscript();
    return () => {
      transcriptGenerationRef.current += 1;
    };
  }, [circleId, reloadTranscript]);

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
      () => { void reloadTranscript(); },
    );
    return unsub;
  }, [circleId, reloadTranscript]);

  // Phase 2 broadcast subscription removed — Phase 3 postgres_changes on
  // office_terminal_responses is now the single source of truth for responses.

  // Phase 3: Subscribe to office_terminal_responses for this circle's responses.
  // Single stable channel — never re-created on messages change to avoid missing events.
  useEffect(() => {
    const handle = subscribeWithReconnect({
      channelName: `terminal-responses:${circleId}`,
      onCatchUp: () => { void reloadTranscript(); },
      setup: (channel) => channel
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
      ),
    });

    return () => {
      handle.unsubscribe();
    };
  }, [circleId, reloadTranscript]);

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
    const removeVerifiedMessage = () => {
      deletedIdsRef.current.add(messageId);
      setMessages(prev => prev.filter(m => m.id !== messageId));
      setResponses(prev => {
        const next = new Map(prev);
        next.delete(messageId);
        return next;
      });
    };

    // Local presentation rows have no durable side effect or account owner.
    if (messageId.startsWith('local-')) {
      removeVerifiedMessage();
      return;
    }

    if (exactTerminalAuthorityRequired) {
      const capturedAuthority = terminalAuthorityRef.current;
      const message = messagesRef.current.find(candidate => candidate.id === messageId);
      if (
        !capturedAuthority
        || capturedAuthority.userId !== userId
        || capturedAuthority.circleId !== circleId
        || !capturedTerminalAuthorityIsCurrent(capturedAuthority)
      ) {
        setSendError('Your terminal session changed. Refresh the Office before deleting this message.');
        return;
      }
      if (
        !message
        || message.circleId !== capturedAuthority.circleId
        || message.senderId !== capturedAuthority.userId
      ) {
        setSendError('Only the sender can delete this terminal message.');
        return;
      }

      const result = await deleteTerminalMessageExact(
        messageId,
        capturedAuthority,
        capturedTerminalAuthorityIsCurrent,
      );
      if (
        !result.receipt
        || !isTerminalMessageDeleteReceiptCurrent({
          receipt: result.receipt,
          expectedAuthority: capturedAuthority,
          expectedMessageId: messageId,
          isCurrent: capturedTerminalAuthorityIsCurrent,
        })
      ) {
        setSendError(result.error || 'The message delete could not be verified. Refresh before retrying.');
        return;
      }

      setSendError(null);
      removeVerifiedMessage();
      return;
    }

    // Compatibility mounts retain the legacy mutable-session delete path.
    const result = await deleteTerminalMessage(messageId);
    if (result.error) {
      console.warn('[OfficeTerminal] Delete failed:', result.error);
      return;
    }
    removeVerifiedMessage();
  }, [
    capturedTerminalAuthorityIsCurrent,
    circleId,
    exactTerminalAuthorityRequired,
    userId,
  ]);

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

    // Pure presentation builtins never leave this component. Every other
    // command captures and validates the exact Office authority before it can
    // start a DB, bridge, Edge Function, or agent operation.
    const isPureLocalBuiltin = cmd === '/help' || cmd === '/agents' || cmd === '/spawn';
    const capturedAuthority = isPureLocalBuiltin ? null : terminalAuthorityRef.current;
    if (
      exactTerminalAuthorityRequired
      && (
        !capturedAuthority
        || capturedAuthority.userId !== userId
        || capturedAuthority.circleId !== circleId
        || !capturedTerminalAuthorityIsCurrent(capturedAuthority)
      )
    ) {
      setSendError('Your terminal session changed. Wait for the Office to finish refreshing, then try again.');
      return;
    }

    // Handle builtins locally
    if (cmd === '/help') {
      setInput('');
      setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
      setHistoryIdx(-1);
      handleHelp();
      return;
    }

    // /models — show available models from registry
    if (cmd === '/models') {
      const operationFence = exactTerminalAuthorityRequired
        ? createTerminalAuthorityOperationFence(
            capturedAuthority,
            capturedTerminalAuthorityIsCurrent,
          )
        : null;
      if (exactTerminalAuthorityRequired && !operationFence) {
        setSendError('Your terminal session changed before the model catalog could be read.');
        return;
      }
      setSending(true);
      setSendError(null);
      try {
        const models = await getAllModels();
        if (operationFence && !operationFence.isCurrent()) return;
        const grouped: Record<string, RegisteredModel[]> = {};
        for (const m of models) {
          (grouped[m.provider] ??= []).push(m);
        }
        const lines = ['┌─ MODEL REGISTRY ─────────────────────────────┐'];
        for (const [provider, list] of Object.entries(grouped)) {
          lines.push(`│ ${provider.toUpperCase()} (${list.length})`);
          for (const m of list.slice(0, 8)) {
            const cost = m.input_cost_per_m > 0 ? ` $${m.input_cost_per_m}/$${m.output_cost_per_m}` : ' free';
            lines.push(`│   ${m.tier === 'frontier' ? '⬥' : '◆'} ${m.label}${cost}`);
          }
          if (list.length > 8) lines.push(`│   ... and ${list.length - 8} more`);
        }
        lines.push('└──────────────────────────────────────────────┘');
        // Add as a local response
        const localMsg: TerminalMessage = {
          id: `local-${Date.now()}`,
          circleId,
          senderId: userId,
          senderName: userDisplayName,
          targetAgentId: null,
          targetAgentName: '@system',
          targetAgentIds: null,
          model: null,
          commandText: '/models',
          responseText: lines.join('\n'),
          responseAgentId: 'system',
          responseAgentName: 'System',
          tokenCost: 0,
          latencyMs: 0,
          status: 'done',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setMessages(prev => [localMsg, ...prev]);
        setInput('');
        setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
        setHistoryIdx(-1);
      } catch (error) {
        if (!operationFence || operationFence.isCurrent()) {
          setSendError(error instanceof Error ? error.message : 'The model catalog could not be read.');
        }
      } finally {
        const mayUpdate = !operationFence || operationFence.isCurrent();
        operationFence?.stop();
        if (mayUpdate) setSending(false);
      }
      return;
    }

    // /agents — list connected agents
    if (cmd === '/agents') {
      const lines = ['┌─ CONNECTED AGENTS ────────────────────────────┐'];
      for (const agent of agents) {
        const isOnline = agent.status === 'active' || agent.status === 'idle';
        const dot = isOnline ? '●' : '○';
        const color = isOnline ? 'online' : 'offline';
        lines.push(`│ ${dot} ${agent.name || agent.id} — ${agent.status} (${agent.provider || 'unknown'})`);
      }
      if (agents.length === 0) lines.push('│ No agents connected');
      lines.push('└──────────────────────────────────────────────┘');
      const localMsg: TerminalMessage = {
        id: `local-${Date.now()}`,
        circleId,
        senderId: userId,
        senderName: userDisplayName,
        targetAgentId: null,
        targetAgentName: '@system',
        targetAgentIds: null,
        model: null,
        commandText: '/agents',
        responseText: lines.join('\n'),
        responseAgentId: 'system',
        responseAgentName: 'System',
        tokenCost: 0,
        latencyMs: 0,
        status: 'done',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      setMessages(prev => [localMsg, ...prev]);
      setInput('');
      setSending(false);
      return;
    }

    // /devices — list local devices
    if (cmd === '/devices') {
      const operationFence = exactTerminalAuthorityRequired
        ? createTerminalAuthorityOperationFence(
            capturedAuthority,
            capturedTerminalAuthorityIsCurrent,
          )
        : null;
      if (exactTerminalAuthorityRequired && !operationFence) {
        setSendError('Your terminal session changed before local devices could be read.');
        return;
      }
      setSending(true);
      setSendError(null);
      try {
        const output = await executeDeviceCommand('devices list');
        if (operationFence && !operationFence.isCurrent()) return;
        const localMsg: TerminalMessage = {
          id: `local-${Date.now()}`,
          circleId,
          senderId: userId,
          senderName: userDisplayName,
          targetAgentId: null,
          targetAgentName: '@system',
          targetAgentIds: null,
          model: null,
          commandText: '/devices',
          responseText: output,
          responseAgentId: 'system',
          responseAgentName: 'System',
          tokenCost: 0,
          latencyMs: 0,
          status: 'done',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        setMessages(prev => [localMsg, ...prev]);
        setInput('');
        setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
        setHistoryIdx(-1);
      } catch (error) {
        if (!operationFence || operationFence.isCurrent()) {
          setSendError(error instanceof Error ? error.message : 'Local devices could not be read.');
        }
      } finally {
        const mayUpdate = !operationFence || operationFence.isCurrent();
        operationFence?.stop();
        if (mayUpdate) setSending(false);
      }
      return;
    }

    // /spawn — open the spawn agent wizard
    if (cmd === '/spawn') {
      setInput('');
      setSending(false);
      setTerminalTab('spawn');
      return;
    }

    // Handle /imagine command
    if (cmd.startsWith('/imagine ')) {
      const imagePrompt = cmd.slice(9).trim();
      if (!imagePrompt) return;
      const operationFence = exactTerminalAuthorityRequired
        ? createTerminalAuthorityOperationFence(
            capturedAuthority,
            capturedTerminalAuthorityIsCurrent,
          )
        : null;
      if (exactTerminalAuthorityRequired && (!capturedAuthority || !operationFence)) {
        setSendError('Your terminal session changed before image generation could start.');
        return;
      }
      setInput('');
      setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
      setHistoryIdx(-1);
      setSending(true);
      setSendError(null);
      try {
        if (shouldBlockExternalAiProvider('openai')) {
          throw new Error(getStrictLocalAiModeMessage('openai'));
        }
        const { data, error } = await supabase.functions.invoke('image-generate', {
          headers: capturedAuthority
            ? { Authorization: `Bearer ${capturedAuthority.accessToken}` }
            : undefined,
          signal: operationFence?.signal,
          timeout: 120_000,
          body: {
            provider: 'openai',
            prompt: imagePrompt,
            circleId: capturedAuthority?.circleId || circleId,
          },
        });
        if (operationFence && !operationFence.isCurrent()) return;
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
        if (operationFence && !operationFence.isCurrent()) return;
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
      } finally {
        const mayUpdate = !operationFence || operationFence.isCurrent();
        operationFence?.stop();
        if (mayUpdate) setSending(false);
      }
      return;
    }

    // Agent commands require both a local dispatcher and one immutable auth
    // snapshot. Saving without either creates a durable row that this mounted
    // surface cannot safely execute, so fail before persistence and keep the
    // user's draft intact.
    if (!onCommandSent) {
      setSendError('This terminal has no connected command dispatcher. Open the Office terminal and try again; your draft was not saved.');
      return;
    }
    if (
      !capturedAuthority
      || capturedAuthority.userId !== userId
      || capturedAuthority.circleId !== circleId
      || !capturedTerminalAuthorityIsCurrent(capturedAuthority)
    ) {
      setSendError('Your terminal session changed. Wait for the Office to finish refreshing, then send again.');
      return;
    }

    // Re-resolve at the persistence boundary against the currently supplied
    // exact target list. Never silently discard a stale id or fall back to
    // @all: that would execute a command against a different audience.
    const resolvedTarget = resolveTerminalTargetSelection(targetIds, agents);
    if (!resolvedTarget.ok) {
      setSendError(`${resolvedTarget.error} Your draft was not saved.`);
      return;
    }

    setSending(true);
    setSendError(null);
    const displayTargetName = resolvedTarget.targetAgentName;

    // Wrap command with mode prefix (Plan/Explore/Fleet/Autopilot inject system-level context)
    let wrappedCmd = cmd;
    if (terminalMode === 'plan') {
      wrappedCmd = `[PLAN MODE — Analyze this request and respond with a numbered step-by-step plan. For each step show: (1) what will be done, (2) estimated impact (low/medium/high), (3) files or systems affected. Do NOT execute anything. End with "APPROVE / MODIFY / CANCEL" options.] ${cmd}`;
    } else if (terminalMode === 'explore') {
      wrappedCmd = `[EXPLORE MODE — research and explain, do not make changes] ${cmd}`;
    } else if (terminalMode === 'fleet') {
      wrappedCmd = `[FLEET MODE — Break this request into independent sub-tasks that can run in parallel. For each sub-task show: a short title, status (pending), and what it does. Then execute each sub-task and update its status to (done) or (error). Format each sub-task as "[ ] Task title — description" and update to "[x] Task title — result" when complete.] ${cmd}`;
    } else if (terminalMode === 'autopilot') {
      wrappedCmd = `[AUTOPILOT MODE — Execute this request fully and autonomously without asking for confirmation. Proceed through all necessary steps, report results as you go, and only stop if you hit a critical error.] ${cmd}`;
    }

    // Embed thinking level in model key (e.g. "claude-sonnet::deep")
    const modelWithThinking = selectedModel && thinkingLevel !== 'balanced'
      ? `${selectedModel}::${thinkingLevel}`
      : selectedModel;

    const targetSubjectContext = buildTerminalTargetSubjectContext({
      agents,
      targetAgentId: resolvedTarget.targetAgentId,
      targetAgentName: displayTargetName,
      targetAgentIds: resolvedTarget.targetAgentIds,
    });
    const capturedTarget = buildTerminalCommandTargetReceipt({
      targetAgentId: resolvedTarget.targetAgentId,
      targetAgentIds: resolvedTarget.targetAgentIds,
      targetAgentName: displayTargetName,
    });
    const capturedDispatcher = onCommandSent;

    try {
      const result = await sendTerminalCommandExact({
        circleId: capturedAuthority.circleId,
        senderId: capturedAuthority.userId,
        senderName: userDisplayName,
        commandText: wrappedCmd,
        targetAgentId: resolvedTarget.targetAgentId ?? undefined,
        targetAgentName: displayTargetName,
        targetAgentIds: resolvedTarget.targetAgentIds,
        targetAgentSubject: targetSubjectContext.targetAgentSubject,
        targetAgentSubjects: targetSubjectContext.targetAgentSubjects,
        model: modelWithThinking,
      }, capturedAuthority, capturedTerminalAuthorityIsCurrent);
      if (!result.messageId || !result.receipt) {
        setSendError(result.error || 'Command could not be saved. Your draft is still here.');
        return;
      }
      if (
        result.receipt.messageId !== result.messageId
        || !isTerminalCommandDispatchReceiptCurrent({
          receipt: result.receipt,
          expectedAuthority: capturedAuthority,
          expectedTargetFingerprint: capturedTarget.fingerprint,
          isCurrent: capturedTerminalAuthorityIsCurrent,
        })
      ) {
        setSendError('Command saved, but local dispatch was cancelled because the terminal session or target changed.');
        return;
      }

      setInput('');
      setCmdHistory(prev => [cmd, ...prev].slice(0, 50));
      setHistoryIdx(-1);
      if (result.error) setSendError(result.error);

      // Award XP for terminal activity — model-aware so BlackSwan gives the most
      if (userId) {
        const xp = getPointsForModel(selectedModel || 'auto');
        awardPoints(userId, xp, 'Terminal command', {
          command: cmd.slice(0, 50),
          target: displayTargetName,
          model: selectedModel || 'auto',
        }).catch(() => {});
      }

      // Direct invocation — bypass broadcast round-trip for immediate response.
      // The dispatcher was required before persistence, so this always uses the
      // same resolved selection that was written to the durable row.
      capturedDispatcher(Object.freeze({
        messageId: result.messageId,
        command: wrappedCmd,
        targetAgentId: resolvedTarget.targetAgentId,
        targetAgentIds: resolvedTarget.targetAgentIds,
        targetAgentName: displayTargetName,
        targetAgentSubject: targetSubjectContext.targetAgentSubject,
        targetAgentSubjects: targetSubjectContext.targetAgentSubjects,
        model: modelWithThinking ?? null,
        senderId: capturedAuthority.userId,
        authority: result.receipt.authority,
        targetFingerprint: result.receipt.target.fingerprint,
        receipt: result.receipt,
      }));
    } catch (error) {
      setSendError(error instanceof Error
        ? error.message
        : 'Command could not be saved. Your draft is still here.');
    } finally {
      setSending(false);
    }
  }, [input, sending, circleId, userId, userDisplayName, targetIds, selectedModel, agents, capturedTerminalAuthorityIsCurrent, exactTerminalAuthorityRequired, handleHelp, setInput, onCommandSent, terminalMode, thinkingLevel]);

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

  const onlineAgents = agents.filter(a => isConnectedOfficeStatus(a.status));
  const onlineCount  = onlineAgents.length;

  // Compute total tokens for footer
  const totalTokens = useMemo(() => {
    let sum = 0;
    responses.forEach(resps => resps.forEach(r => { sum += r.tokenCount || 0; }));
    return sum;
  }, [responses]);

  const modeInfo = TERMINAL_MODES.find(m => m.key === terminalMode);
  const modelInfo = TERMINAL_MODELS.find(m => m.key === selectedModel);

  const transcriptFailure = transcriptError ? (
    <View style={styles.transcriptError} accessibilityRole="alert">
      <View style={styles.transcriptErrorCopy}>
        <Text style={styles.transcriptErrorTitle}>History unavailable</Text>
        <Text style={styles.transcriptErrorText}>
          {transcriptError}{messages.length > 0 ? ' Existing history may be stale.' : ''}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry loading recorded command history"
        onPress={() => {
          if (messages.length === 0) setLoading(true);
          void reloadTranscript();
        }}
        style={({ pressed, focused }: any) => [
          styles.transcriptRetry,
          focused ? styles.transcriptRetryFocused : null,
          pressed ? styles.transcriptRetryPressed : null,
        ]}
      >
        <Text style={styles.transcriptRetryText}>Retry</Text>
      </Pressable>
    </View>
  ) : null;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {/* ── Top bar: BlackSwan branding + metrics (OpenSwan-style) ── */}
      {!compact && (
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <View style={styles.brandMark}>
              <Text style={styles.brandLetter}>B</Text>
            </View>
            <View>
              <Text style={styles.brandName}>BLACKSWAN</Text>
              <Text style={styles.brandVersion}>terminal v2</Text>
            </View>
          </View>
          <View style={styles.metricsRow}>
            {terminalMode !== 'execute' && (
              <View style={[styles.metricBadge, { borderColor: modeInfo?.color || BS.accent }]}>
                <Text style={[styles.metricBadgeText, { color: modeInfo?.color || BS.accent }]}>
                  {modeInfo?.label?.toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{onlineCount}</Text>
              <Text style={styles.metricLabel}>agents</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{messages.length}</Text>
              <Text style={styles.metricLabel}>msgs</Text>
            </View>
            <View style={styles.metricDivider} />
            <View style={styles.metricItem}>
              <Text style={styles.metricValue}>{totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}K` : totalTokens}</Text>
              <Text style={styles.metricLabel}>tokens</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Tab bar ── */}
      {readOnly ? (
        <View
          style={styles.readOnlyBar}
          accessibilityRole="summary"
          accessibilityLabel={readOnlyReason}
        >
          <Text style={styles.readOnlyTitle}>RECORDED HISTORY</Text>
          <Text style={styles.readOnlyText}>{readOnlyReason}</Text>
        </View>
      ) : (
      <View style={styles.termTabBar}>
        {(['commands', 'automations', 'shell'] as TerminalTab[]).map(tab => (
          <Pressable
            key={tab}
            onPress={() => setTerminalTab(tab)}
            style={[styles.termTab, terminalTab === tab && styles.termTabActive]}
          >
            <Text style={[styles.termTabText, terminalTab === tab && styles.termTabTextActive]}>
              {tab === 'commands' ? 'CHAT' : tab === 'automations' ? 'AUTO' : 'SHELL'}
            </Text>
          </Pressable>
        ))}
        {/* Train tab */}
        <Pressable
          onPress={() => setTerminalTab('train')}
          style={[styles.spawnBtn, terminalTab === 'train' && styles.spawnBtnActive]}
        >
          <Text style={[styles.spawnBtnText, terminalTab === 'train' && { color: BS.accent }]}>TRAIN</Text>
        </Pressable>
        {/* Key reference button */}
        <Pressable
          onPress={() => setTerminalTab('key')}
          style={[styles.spawnBtn, terminalTab === 'key' && styles.spawnBtnActive]}
        >
          <Text style={[styles.spawnBtnText, terminalTab === 'key' && { color: BS.accent }]}>? KEY</Text>
        </Pressable>
        {/* Spawn agent button */}
        <Pressable
          onPress={() => setTerminalTab('spawn')}
          style={[styles.spawnBtn, terminalTab === 'spawn' && styles.spawnBtnActive]}
        >
          <Text style={[styles.spawnBtnText, terminalTab === 'spawn' && { color: BS.accent }]}>+ AGENT</Text>
        </Pressable>
        {/* Connection indicator in tab bar */}
        <View style={{ flex: 1 }} />
        <View style={styles.connIndicator}>
          <View style={[styles.connDot, onlineCount > 0 && { backgroundColor: BS.accent }]} />
          <Text style={styles.connText}>{onlineCount > 0 ? 'connected' : 'offline'}</Text>
        </View>
      </View>
      )}

      {/* ── Content area ── */}
      {!readOnly && terminalTab === 'spawn' ? (
        <SpawnAgentPanel
          circleId={circleId}
          onCreated={(agentId, agentName) => {
            setTerminalTab('commands');
            // Auto-target the new agent
            if (agentId) {
              selectTargets([agentId]);
            }
            // Post a system message announcing the new agent
            const now = new Date().toISOString();
            const announceMsg: TerminalMessage = {
              id: `local-spawn-${Date.now()}`,
              circleId,
              senderId: userId,
              senderName: 'SYSTEM',
              commandText: `/spawn ${agentName}`,
              targetAgentId: null,
              targetAgentName: '@system',
              targetAgentIds: null,
              model: null,
              responseText: `Agent @${agentName} deployed and ready. Target it with @${agentName} or assign it tasks in the kanban board.`,
              responseAgentId: 'system',
              responseAgentName: 'System',
              tokenCost: 0,
              latencyMs: 0,
              status: 'done',
              createdAt: now,
              updatedAt: now,
            };
            setMessages(prev => [...prev, announceMsg]);
          }}
          onCancel={() => setTerminalTab('commands')}
        />
      ) : !readOnly && terminalTab === 'shell' ? (
        <LocalShellPanel />
      ) : !readOnly && terminalTab === 'train' ? (
        <TrainingDashboard circleId={circleId} />
      ) : !readOnly && terminalTab === 'key' ? (
        <CommandKeyPanel onRunCommand={(cmd) => { setInput(cmd); setTerminalTab('commands'); }} />
      ) : !readOnly && terminalTab === 'automations' ? (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          <AutomationsPanel circleId={circleId} />
        </ScrollView>
      ) : (
      <>

      {/* Message list */}
      {transcriptError && messages.length > 0 ? transcriptFailure : null}
      {loading ? (
        <View style={styles.loadingState}>
          <PendingDots />
        </View>
      ) : transcriptError && messages.length === 0 ? (
        <View style={styles.transcriptErrorEmpty}>{transcriptFailure}</View>
      ) : messages.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyBrand}>
            <Text style={styles.emptyBrandText}>BS</Text>
          </View>
          <Text style={styles.emptyTitle}>BlackSwan Terminal</Text>
          <Text style={styles.emptyText}>
            {readOnly
              ? 'No recorded command history is available for this circle yet.'
              : <>Your agentic command center.{'\n'}Type a message, use /commands, or @target an agent.</>}
          </Text>
          {!readOnly && (
          <View style={styles.emptyHints}>
            {['/help', '/status', '/models', '/agents'].map(cmd => (
              <Pressable key={cmd} style={styles.emptyHintChip} onPress={() => setInput(cmd)}>
                <Text style={styles.emptyHintText}>{cmd}</Text>
              </Pressable>
            ))}
            <Pressable style={[styles.emptyHintChip, { borderColor: BS.accent + '40' }]} onPress={() => setTerminalTab('spawn')}>
              <Text style={styles.emptyHintText}>+ Spawn Agent</Text>
            </Pressable>
          </View>
          )}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={m => m.id}
          renderItem={({ item }) => (
            <TerminalRow
              msg={item}
              responses={responses.get(item.id)}
              onDelete={!readOnly && (item.id.startsWith('local-') || item.senderId === userId)
                ? handleDelete
                : undefined}
            />
          )}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />
      )}

      {!readOnly && (
      <>
      {/* Autocomplete */}
      {showAutocomplete && (
        <AutocompleteSuggestions
          query={input}
          agents={onlineAgents}
          onSelect={(id) => { selectTargets(id ? [id] : null); setInput(''); inputRef.current?.focus(); }}
        />
      )}

      {/* ── Control panel: Model + Mode + Thinking + Agents (compact rows) ── */}
      <View style={styles.controlPanel}>
        {/* Row 1: Models */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          <Text style={styles.rowLabel}>MODEL</Text>
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
        {modelCatalogNotice ? (
          <Text style={styles.modelCatalogNotice} numberOfLines={2}>{modelCatalogNotice}</Text>
        ) : null}

        {/* Row 2: Mode + Thinking */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          <Text style={styles.rowLabel}>MODE</Text>
          {TERMINAL_MODES.map(tm => (
            <Pressable
              key={tm.key}
              onPress={() => setTerminalMode(tm.key)}
              style={[styles.modeChip, terminalMode === tm.key && { borderColor: tm.color, backgroundColor: tm.color + '18' }]}
            >
              <Text style={[styles.modeChipSymbol, terminalMode === tm.key && { color: tm.color }]}>{tm.symbol}</Text>
              <Text style={[styles.modeChipText, terminalMode === tm.key && { color: tm.color }]}>{tm.label}</Text>
            </Pressable>
          ))}
          <View style={styles.chipDivider} />
          <Text style={styles.rowLabel}>THINK</Text>
          {THINKING_LEVELS.map(tl => (
            <Pressable
              key={tl.key}
              onPress={() => setThinkingLevel(tl.key)}
              style={[styles.modeChip, thinkingLevel === tl.key && { borderColor: tl.color, backgroundColor: tl.color + '18' }]}
            >
              <Text style={[styles.modeChipSymbol, thinkingLevel === tl.key && { color: tl.color }]}>{tl.symbol}</Text>
              <Text style={[styles.modeChipText, thinkingLevel === tl.key && { color: tl.color }]}>{tl.label}</Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Row 3: Agent targets + Quick commands */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          <Text style={styles.rowLabel}>TO</Text>
          <AgentChip label="@all" active={!targetIds || targetIds.length === 0} onPress={selectAll} />
          {onlineAgents.map(agent => (
            <AgentChip
              key={agent.id}
              label={`@${agent.name}`}
              active={targetIds?.includes(agent.id) ?? false}
              dotColor={STATUS_DOT[agent.status] || STATUS_DOT.offline}
              onPress={() => toggleAgentTarget(agent.id)}
            />
          ))}
          <View style={styles.chipDivider} />
          {BUILTIN_CMDS.slice(0, 6).map(b => (
            <Pressable key={b.cmd} style={styles.cmdChip} onPress={() => setInput(b.cmd)}>
              <Text style={styles.cmdChipText}>{b.cmd}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* ── Input bar (OpenSwan command palette style) ── */}
      <View style={styles.inputRow}>
        <View style={styles.inputPrefix}>
          <Text style={styles.prefixTarget}>
            {targetIds && targetIds.length > 1 ? `${targetIds.length} agents` : targetAgentName}
          </Text>
          {selectedModel && (
            <Text style={styles.prefixModel}>{modelInfo?.label || selectedModel}</Text>
          )}
        </View>
        <TextInput
          ref={inputRef}
          testID="office-terminal-command-input"
          accessibilityLabel="Office terminal command"
          style={styles.input}
          value={input}
          onChangeText={(v) => { setInput(v); setHistoryIdx(-1); }}
          placeholder="message or /command..."
          placeholderTextColor={BS.textMuted}
          multiline={false}
          returnKeyType="send"
          onSubmitEditing={handleSend}
          onKeyPress={handleKeyPress}
          editable={!sending}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {terminalMode === 'autopilot' && sending ? (
          <Pressable style={styles.stopBtn} onPress={() => setSending(false)}>
            <Text style={styles.stopBtnText}>STOP</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
            onPress={handleSend}
            disabled={!input.trim() || sending}
            accessibilityRole="button"
            accessibilityLabel="Send Office terminal command"
            accessibilityState={{ disabled: !input.trim() || sending, busy: sending }}
          >
            <Text style={styles.sendIcon}>{sending ? '...' : '>'}</Text>
          </Pressable>
        )}
      </View>
      {sendError ? (
        <Pressable
          onPress={() => setSendError(null)}
          accessibilityRole="alert"
          accessibilityLabel={`${sendError}. Dismiss message.`}
          style={{ paddingHorizontal: 12, paddingVertical: 7, backgroundColor: '#ef444415', borderTopWidth: 1, borderTopColor: '#ef444430' }}
        >
          <Text style={{ color: '#fca5a5', fontSize: 10, fontFamily: 'monospace' }}>{sendError}</Text>
        </Pressable>
      ) : null}
      </>
      )}

      {/* ── Footer status line (OpenSwan-style) ── */}
      <View style={styles.footer}>
        <View style={[styles.footerDot, onlineCount > 0 && { backgroundColor: BS.accent }]} />
        <Text style={styles.footerText}>
          {readOnly
            ? 'history only'
            : `${thinkingLevel !== 'balanced' ? `${thinkingLevel} ` : ''}${terminalMode !== 'execute' ? `${terminalMode} ` : ''}${modelInfo?.label || 'auto'}`}
        </Text>
        <View style={{ flex: 1 }} />
        {!readOnly && cmdHistory.length > 0 && (
          <Text style={styles.footerText}>{cmdHistory.length} history</Text>
        )}
        <Text style={styles.footerMuted}>|</Text>
        <Text style={styles.footerText}>{messages.length} messages</Text>
      </View>

      </>
      )}
    </KeyboardAvoidingView>
  );
}

// ─── Styles (Ollama-inspired Monochrome Terminal Theme) ───────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BS.bg },

  // ── Top bar ──
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: BS.bgPanel, borderBottomWidth: 1, borderBottomColor: BS.border,
  },
  topBarLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center',
  },
  brandLetter: { color: '#000', fontFamily: MONO, fontSize: 14, fontWeight: '900' },
  brandName: { color: BS.textPrimary, fontSize: 13, fontWeight: '700', letterSpacing: -0.3 },
  brandVersion: { color: BS.textMuted, fontSize: 9 },
  metricsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metricItem: { alignItems: 'center' },
  metricValue: { color: BS.textPrimary, fontFamily: MONO, fontSize: 12, fontWeight: '600' },
  metricLabel: { color: BS.textMuted, fontSize: 8, letterSpacing: 0.5 },
  metricDivider: { width: 1, height: 20, backgroundColor: BS.border },
  metricBadge: {
    borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: 'transparent', marginRight: 4,
  },
  metricBadgeText: { fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.5 },

  // ── Tabs ──
  readOnlyBar: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: BS.border,
    backgroundColor: BS.bgPanel,
  },
  readOnlyTitle: {
    color: BS.textPrimary,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  readOnlyText: {
    color: BS.textMuted,
    fontSize: 9,
    lineHeight: 13,
    marginTop: 2,
  },
  termTabBar: {
    flexDirection: 'row', alignItems: 'center',
    borderBottomWidth: 1, borderBottomColor: BS.border,
    backgroundColor: BS.bgPanel, paddingHorizontal: 8,
  } as any,
  termTab: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  } as any,
  termTabActive: { borderBottomColor: '#e8e8e8' } as any,
  termTabText: { color: BS.textMuted, fontSize: 11, fontWeight: '500' } as any,
  termTabTextActive: { color: '#e8e8e8', fontWeight: '600' } as any,
  spawnBtn: {
    paddingHorizontal: 12, paddingVertical: 7, marginLeft: 4,
    borderBottomWidth: 2, borderBottomColor: 'transparent',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  spawnBtnActive: { borderBottomColor: '#e8e8e8' },
  spawnBtnText: { color: BS.textMuted, fontSize: 11, fontWeight: '500' },
  connIndicator: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 8 },
  connDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: BS.textMuted },
  connText: { color: BS.textMuted, fontSize: 9 },

  // ── Message list ──
  list: { flex: 1 },
  listContent: { paddingTop: 8, paddingBottom: 8 },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  transcriptErrorEmpty: { flex: 1, justifyContent: 'center', padding: 16 },
  transcriptError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    margin: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#f59e0b55',
    borderRadius: 10,
    backgroundColor: '#f59e0b12',
  },
  transcriptErrorCopy: { flex: 1, minWidth: 0 },
  transcriptErrorTitle: { color: '#f4dfb5', fontSize: 11, fontWeight: '700', marginBottom: 2 },
  transcriptErrorText: { color: '#a8946d', fontSize: 10, lineHeight: 15 },
  transcriptRetry: {
    minHeight: 44,
    minWidth: 72,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: '#f59e0b66',
    borderRadius: 9,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  transcriptRetryFocused: {
    ...Platform.select({ web: { outlineStyle: 'none', boxShadow: '0 0 0 3px rgba(245,158,11,0.28)' } as any, default: {} }),
  },
  transcriptRetryPressed: { opacity: 0.75, backgroundColor: '#f59e0b18' },
  transcriptRetryText: { color: '#f4dfb5', fontSize: 10, fontWeight: '700' },

  // ── Empty state ──
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  emptyBrand: {
    width: 56, height: 56, borderRadius: 16,
    backgroundColor: '#ffffff', borderWidth: 0,
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  emptyBrandText: { color: '#000000', fontFamily: MONO, fontSize: 24, fontWeight: '900' },
  emptyTitle: { color: BS.textPrimary, fontSize: 16, fontWeight: '600', marginBottom: 8 },
  emptyText: { color: BS.textSecondary, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  emptyHints: { flexDirection: 'row', gap: 8, marginTop: 20, flexWrap: 'wrap', justifyContent: 'center' },
  emptyHintChip: {
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 12,
    backgroundColor: BS.bgCard, borderWidth: 1, borderColor: '#ffffff10',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  emptyHintText: { color: BS.textSecondary, fontFamily: MONO, fontSize: 11 },

  // ── Control panel ──
  controlPanel: {
    backgroundColor: BS.bgPanel, borderTopWidth: 1, borderTopColor: BS.border,
    paddingVertical: 5, gap: 4,
  },
  chipsScroll: { paddingHorizontal: 12, gap: 5, flexDirection: 'row', alignItems: 'center' },
  rowLabel: {
    color: BS.textMuted, fontSize: 9, fontWeight: '600',
    letterSpacing: 0.5, marginRight: 4, width: 36, textTransform: 'uppercase',
  },
  modelCatalogNotice: {
    color: BS.textMuted, fontSize: 9, lineHeight: 12, fontFamily: MONO,
    paddingHorizontal: 12, paddingTop: 1,
  },
  chipDivider: { width: 1, height: 16, backgroundColor: BS.border, marginHorizontal: 6 },
  modeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    backgroundColor: BS.bgCard, borderWidth: 1, borderColor: BS.border,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  modeChipSymbol: {
    color: BS.textMuted, fontFamily: MONO, fontSize: 10, fontWeight: '700',
    width: 12, textAlign: 'center',
  },
  modeChipText: { color: BS.textMuted, fontSize: 10, fontWeight: '500' },
  cmdChip: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10,
    backgroundColor: BS.bgCard, borderWidth: 1, borderColor: BS.border,
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  cmdChipText: { color: BS.textMuted, fontSize: 10, fontFamily: MONO },

  // ── Input bar ──
  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: BS.bgInput, borderTopWidth: 1, borderTopColor: BS.borderLit,
    paddingHorizontal: 12, paddingVertical: 8, gap: 8,
  },
  inputPrefix: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 0 },
  prefixTarget: { color: BS.textSecondary, fontFamily: MONO, fontSize: 11, fontWeight: '600' },
  prefixModel: {
    color: BS.textMuted, fontSize: 10,
    backgroundColor: BS.bgCard, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 8, overflow: 'hidden',
  },
  input: {
    flex: 1, color: BS.textPrimary, fontSize: 14, fontFamily: MONO,
    paddingVertical: 6, minHeight: 36,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none' } as any : {}),
  },
  sendBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  sendBtnDisabled: { backgroundColor: BS.bgCard, opacity: 0.3 },
  sendIcon: { color: '#000', fontFamily: MONO, fontSize: 15, fontWeight: '900' },
  stopBtn: {
    paddingHorizontal: 14, height: 36, borderRadius: 10,
    backgroundColor: '#4f4f4f', alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' } as any : {}),
  },
  stopBtnText: { color: '#fff', fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // ── Footer status line ──
  footer: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 5,
    backgroundColor: BS.bgPanel, borderTopWidth: 1, borderTopColor: BS.border,
  },
  footerDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: BS.textMuted },
  footerText: { color: BS.textMuted, fontSize: 9 },
  footerMuted: { color: BS.textGhost, fontSize: 9 },
});
