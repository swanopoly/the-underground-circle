import {
  buildAgentRuntimeSubject,
  isUuidLike,
  type AgentRuntimeSubjectMetadata,
} from './agentRuntimeSubject';

export type ChatAgentTargetStatus =
  | 'active'
  | 'building'
  | 'idle'
  | 'offline'
  | 'setup_required';

export interface ChatAgentLike {
  id: string;
  name: string;
  provider: string;
  status?: string | null;
  color?: string | null;
  model?: string | null;
  sessionKey?: string | null;
  source?: string | null;
  current_task?: string | null;
}

export interface ChatAgentProviderPreset {
  provider: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  setupHint: string;
  priority: number;
}

export interface ChatAgentTarget<TAgent extends ChatAgentLike = ChatAgentLike> {
  id: string;
  provider: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  status: ChatAgentTargetStatus;
  connected: boolean;
  source: 'connected' | 'preset';
  setupHint?: string;
  agent?: TAgent;
  model?: string | null;
  sessionKey?: string | null;
  priority: number;
  isDefault?: boolean;
  agentSubjectKey?: string;
  agentDbId?: string | null;
  agentSessionKey?: string | null;
  agentLegacyIds?: string[];
  agentSubjectMetadata?: AgentRuntimeSubjectMetadata;
}

export const DEFAULT_CHAT_AGENT_TARGET_ID = 'chat-agent::openswan';
const DEFAULT_CHAT_AGENT_RUNTIME_ID = 'default::blackswan';

export type ParsedChatAgentAssignment = Readonly<{
  selectorKind: 'id' | 'name';
  selector: string;
  task: string;
}>;

export type ChatAgentAssignmentResolution<TAgent extends ChatAgentLike = ChatAgentLike> =
  | Readonly<{ ok: true; agent: TAgent }>
  | Readonly<{ ok: false; reason: 'invalid' | 'not_found' | 'ambiguous' }>;

export function buildChatAgentAssignmentCommand(agentId: string): string {
  const exactId = String(agentId || '').trim();
  return exactId ? `/assign --id ${encodeURIComponent(exactId)} ` : '/assign ';
}

export function parseChatAgentAssignmentCommand(input: string): ParsedChatAgentAssignment | null {
  const raw = String(input || '').trim().replace(/^\/assign\s+/i, '');
  if (!raw) return null;

  const idMatch = raw.match(/^--id\s+(\S+)\s+([\s\S]+)$/i);
  if (idMatch) {
    try {
      const selector = decodeURIComponent(idMatch[1]).trim();
      const task = idMatch[2].trim();
      if (!selector || selector.length > 240 || !task) return null;
      return Object.freeze({ selectorKind: 'id' as const, selector, task });
    } catch {
      return null;
    }
  }

  const quoted = raw.match(/^@?(?:["“]([^"”]+)["”]|'([^']+)')\s+([\s\S]+)$/);
  if (quoted) {
    const selector = String(quoted[1] || quoted[2] || '').trim();
    const task = quoted[3].trim();
    if (!selector || selector.length > 120 || !task) return null;
    return Object.freeze({ selectorKind: 'name' as const, selector, task });
  }

  const legacy = raw.match(/^@?([^\s]+)\s+([\s\S]+)$/);
  if (!legacy) return null;
  return Object.freeze({
    selectorKind: 'name' as const,
    selector: legacy[1].trim(),
    task: legacy[2].trim(),
  });
}

export function resolveChatAgentAssignmentTarget<TAgent extends ChatAgentLike>(
  agents: readonly TAgent[],
  parsed: ParsedChatAgentAssignment | null,
  preferredAgentId?: string | null,
): ChatAgentAssignmentResolution<TAgent> {
  if (!parsed || !Array.isArray(agents)) return Object.freeze({ ok: false, reason: 'invalid' });
  const exactId = String(preferredAgentId || (parsed.selectorKind === 'id' ? parsed.selector : '')).trim();
  if (exactId) {
    const matches = agents.filter((agent) => agent.id === exactId);
    if (matches.length === 1) return Object.freeze({ ok: true, agent: matches[0] });
    return Object.freeze({ ok: false, reason: matches.length > 1 ? 'ambiguous' : 'not_found' });
  }
  const normalizedName = parsed.selector.trim().toLowerCase();
  if (!normalizedName) return Object.freeze({ ok: false, reason: 'invalid' });
  const matches = agents.filter((agent) => String(agent.name || '').trim().toLowerCase() === normalizedName);
  if (matches.length === 1) return Object.freeze({ ok: true, agent: matches[0] });
  return Object.freeze({ ok: false, reason: matches.length > 1 ? 'ambiguous' : 'not_found' });
}

export const CHAT_AGENT_PROVIDER_PRESETS: ChatAgentProviderPreset[] = [
  {
    provider: 'openswan',
    label: 'OpenSwan',
    icon: 'OS',
    color: '#6366f1',
    description: 'Default chat runtime with planning, tools, memory, browser, and desktop routes.',
    setupHint: 'OpenSwan is built into chat. Connect an OpenSwan runtime for live session handoff.',
    priority: 0,
  },
  {
    provider: 'cursor',
    label: 'Cursor Composer',
    icon: 'CU',
    color: '#8b5cf6',
    description: 'Send coding tasks into a connected Cursor Composer session.',
    setupHint: 'Start the Cursor bridge with `node scripts/cursor-bridge.js`, then open or launch Cursor Composer from chat.',
    priority: 10,
  },
  {
    provider: 'claude-code',
    label: 'Claude Code',
    icon: 'CC',
    color: '#f59e0b',
    description: 'Delegate repo tasks to managed Claude Code terminal sessions.',
    setupHint: 'Run `npm run bridge` and allow Claude Code billing before launching or messaging Claude Code sessions.',
    priority: 20,
  },
  {
    provider: 'opencode',
    label: 'OpenCode',
    icon: 'OC',
    color: '#38bdf8',
    description: 'Use a connected OpenCode-style custom coding agent.',
    setupHint: 'Connect OpenCode as a custom or generic agent bridge, then it will appear here.',
    priority: 30,
  },
  {
    provider: 'codex',
    label: 'Codex',
    icon: 'CX',
    color: '#10a37f',
    description: 'Delegate implementation tasks to managed Codex terminal sessions.',
    setupHint: 'Run `npm run bridge:codex`, then launch a Codex session from chat or Office.',
    priority: 40,
  },
  {
    provider: 'gemini',
    label: 'Gemini CLI',
    icon: 'GM',
    color: '#4285f4',
    description: 'Use a connected Gemini CLI session for research, code, and review tasks.',
    setupHint: 'Run `npm run bridge:gemini`, then launch a Gemini CLI session.',
    priority: 50,
  },
  {
    provider: 'aider',
    label: 'Aider',
    icon: 'AI',
    color: '#f97316',
    description: 'Use a connected Aider-style custom coding agent.',
    setupHint: 'Connect Aider through the agent connect flow or a generic bridge.',
    priority: 60,
  },
  {
    provider: 'cline',
    label: 'Cline',
    icon: 'CL',
    color: '#ec4899',
    description: 'Use a connected Cline-style desktop coding agent.',
    setupHint: 'Connect Cline through the agent connect flow or a generic bridge.',
    priority: 70,
  },
  {
    provider: 'windsurf',
    label: 'Windsurf',
    icon: 'WS',
    color: '#06b6d4',
    description: 'Use a connected Windsurf agent or editor bridge.',
    setupHint: 'Connect Windsurf through the agent connect flow or a generic bridge.',
    priority: 80,
  },
  {
    provider: 'copilot',
    label: 'Copilot',
    icon: 'CP',
    color: '#1f6feb',
    description: 'Use a connected GitHub Copilot-style agent bridge.',
    setupHint: 'Connect Copilot through the agent connect flow or a generic bridge.',
    priority: 90,
  },
  {
    provider: 'continue',
    label: 'Continue',
    icon: 'CN',
    color: '#22c55e',
    description: 'Use a connected Continue agent or IDE bridge.',
    setupHint: 'Connect Continue through a custom or generic bridge.',
    priority: 100,
  },
  {
    provider: 'amp',
    label: 'Amp',
    icon: 'AM',
    color: '#a78bfa',
    description: 'Use a connected Amp-style coding agent.',
    setupHint: 'Connect Amp through a custom or generic bridge.',
    priority: 110,
  },
  {
    provider: 'generic-agent',
    label: 'Custom Agent',
    icon: 'AG',
    color: '#14b8a6',
    description: 'Any user-connected agent that exposes the app bridge contract.',
    setupHint: 'Connect a custom agent from Office or the agent setup flow.',
    priority: 120,
  },
];

const PRESET_BY_PROVIDER = new Map(CHAT_AGENT_PROVIDER_PRESETS.map((preset) => [preset.provider, preset]));

export function normalizeChatAgentProvider(provider: string | null | undefined): string {
  const normalized = String(provider || '')
    .toLowerCase()
    .trim()
    .replace(/[_\s]+/g, '-');

  if (!normalized || normalized === 'blackswan-local' || normalized === 'black-swan' || normalized === 'blackswan') {
    return 'openswan';
  }
  if (normalized === 'gemini-cli' || normalized === 'google-gemini') return 'gemini';
  if (normalized === 'cursor-composer' || normalized === 'cursor-agent') return 'cursor';
  if (normalized === 'open-code' || normalized === 'opencode-ai') return 'opencode';
  if (normalized === 'custom' || normalized === 'other') return 'generic-agent';
  return normalized;
}

export function getChatAgentProviderPreset(provider: string | null | undefined): ChatAgentProviderPreset {
  const normalized = normalizeChatAgentProvider(provider);
  return PRESET_BY_PROVIDER.get(normalized) || {
    provider: normalized || 'generic-agent',
    label: provider ? humanizeProvider(provider) : 'Custom Agent',
    icon: iconFromProvider(provider || 'agent'),
    color: '#14b8a6',
    description: 'User-connected custom agent.',
    setupHint: 'Connect this agent through the custom bridge flow.',
    priority: 500,
  };
}

export function formatChatAgentProviderLabel(provider: string | null | undefined): string {
  return getChatAgentProviderPreset(provider).label;
}

export function isOpenSwanChatAgentTarget(target: ChatAgentTarget | null | undefined): boolean {
  return !target || target.isDefault || normalizeChatAgentProvider(target.provider) === 'openswan';
}

function buildTargetSubjectFields<TAgent extends ChatAgentLike>(
  agent: TAgent | null,
  provider: string,
  isDefault = false,
): Pick<ChatAgentTarget<TAgent>, 'agentSubjectKey' | 'agentDbId' | 'agentSessionKey' | 'agentLegacyIds' | 'agentSubjectMetadata'> {
  const subject = buildAgentRuntimeSubject({
    id: isDefault ? 'default::blackswan' : (agent?.id || provider || 'agent'),
    name: isDefault ? 'OpenSwan' : (agent?.name || getChatAgentProviderPreset(provider).label || 'Agent'),
    sessionKey: isDefault ? (agent?.sessionKey || 'blackswan') : (agent?.sessionKey || undefined),
    providerType: provider as any,
  }, {
    dbAgentId: agent?.id && isUuidLike(agent.id) ? agent.id : null,
  });
  return {
    agentSubjectKey: subject.subjectKey,
    agentDbId: subject.dbAgentId,
    agentSessionKey: subject.sessionKey,
    agentLegacyIds: subject.legacyIds,
    agentSubjectMetadata: subject.metadata,
  };
}

export function buildChatAgentTargets<TAgent extends ChatAgentLike>(
  agents: TAgent[],
): ChatAgentTarget<TAgent>[] {
  const targets = new Map<string, ChatAgentTarget<TAgent>>();
  const connectedProviders = new Set<string>();

  const addTarget = (target: ChatAgentTarget<TAgent>) => {
    const existing = targets.get(target.id);
    if (!existing || statusRank(target.status) < statusRank(existing.status)) {
      targets.set(target.id, target);
    }
  };

  for (const agent of agents || []) {
    if (!agent?.id) continue;
    const provider = normalizeChatAgentProvider(agent.provider);
    const preset = getChatAgentProviderPreset(provider);
    connectedProviders.add(provider);
    const isDefault = provider === 'openswan' && agent.id === DEFAULT_CHAT_AGENT_RUNTIME_ID;
    const label = provider === 'cursor' && /^cursor$/i.test(agent.name || '')
      ? preset.label
      : agent.name || preset.label;
    addTarget({
      id: isDefault ? DEFAULT_CHAT_AGENT_TARGET_ID : `agent::${agent.id}`,
      provider,
      label,
      icon: preset.icon,
      color: agent.color || preset.color,
      description: buildConnectedDescription(agent, preset),
      status: normalizeTargetStatus(agent.status),
      connected: true,
      source: 'connected',
      agent,
      model: agent.model || null,
      sessionKey: agent.sessionKey || null,
      priority: isDefault ? -10 : preset.priority,
      isDefault,
      ...buildTargetSubjectFields(agent, provider, isDefault),
    });
  }

  if (!targets.has(DEFAULT_CHAT_AGENT_TARGET_ID)) {
    const preset = getChatAgentProviderPreset('openswan');
    addTarget({
      id: DEFAULT_CHAT_AGENT_TARGET_ID,
      provider: 'openswan',
      label: preset.label,
      icon: preset.icon,
      color: preset.color,
      description: preset.description,
      status: 'active',
      connected: true,
      source: 'preset',
      priority: -10,
      isDefault: true,
      ...buildTargetSubjectFields<TAgent>(null, 'openswan', true),
    });
  }

  for (const preset of CHAT_AGENT_PROVIDER_PRESETS) {
    if (preset.provider === 'openswan') continue;
    if (connectedProviders.has(preset.provider)) continue;
    addTarget({
      id: `preset::${preset.provider}`,
      provider: preset.provider,
      label: preset.label,
      icon: preset.icon,
      color: preset.color,
      description: preset.description,
      status: 'setup_required',
      connected: false,
      source: 'preset',
      setupHint: preset.setupHint,
      priority: preset.priority + 1000,
    });
  }

  return Array.from(targets.values()).sort((a, b) => {
    const status = statusRank(a.status) - statusRank(b.status);
    if (status !== 0) return status;
    const priority = a.priority - b.priority;
    if (priority !== 0) return priority;
    return a.label.localeCompare(b.label);
  });
}

export function resolveChatAgentTarget<TAgent extends ChatAgentLike>(
  targets: ChatAgentTarget<TAgent>[],
  selectedId: string | null | undefined,
): ChatAgentTarget<TAgent> {
  const exactSelectedId = String(selectedId || '').trim();
  if (!targets.length) {
    if (exactSelectedId) {
      return buildUnavailableChatAgentTarget<TAgent>(exactSelectedId);
    }
    const preset = getChatAgentProviderPreset('openswan');
    return {
      id: DEFAULT_CHAT_AGENT_TARGET_ID,
      provider: 'openswan',
      label: preset.label,
      icon: preset.icon,
      color: preset.color,
      description: preset.description,
      status: 'active',
      connected: true,
      source: 'preset',
      priority: -10,
      isDefault: true,
      ...buildTargetSubjectFields<TAgent>(null, 'openswan', true),
    };
  }
  if (exactSelectedId) {
    return targets.find((target) => target.id === exactSelectedId)
      || buildUnavailableChatAgentTarget<TAgent>(exactSelectedId);
  }
  return targets.find((target) => target.id === DEFAULT_CHAT_AGENT_TARGET_ID)
    || targets[0];
}

function buildUnavailableChatAgentTarget<TAgent extends ChatAgentLike>(selectedId: string): ChatAgentTarget<TAgent> {
  return {
    id: selectedId,
    provider: 'unavailable',
    label: 'Selected agent unavailable',
    icon: '!',
    color: '#f97316',
    description: 'The exact previously selected agent is no longer available.',
    status: 'offline',
    connected: false,
    source: 'preset',
    setupHint: 'Refresh the agent list and explicitly choose another target. Nothing will be dispatched while this selection is unavailable.',
    priority: Number.MAX_SAFE_INTEGER,
    isDefault: false,
  };
}

export function buildChatAgentSetupMessage(target: ChatAgentTarget): string {
  const preset = getChatAgentProviderPreset(target.provider);
  return [
    `**${target.label}** is not connected yet.`,
    '',
    target.setupHint || preset.setupHint,
    '',
    'Connected agents appear in this selector automatically after their bridge or custom connection is reachable.',
  ].join('\n');
}

function normalizeTargetStatus(status: string | null | undefined): ChatAgentTargetStatus {
  if (status === 'active' || status === 'building' || status === 'idle' || status === 'offline') return status;
  if (status === 'error') return 'offline';
  return 'idle';
}

function statusRank(status: ChatAgentTargetStatus): number {
  if (status === 'active' || status === 'building') return 0;
  if (status === 'idle') return 1;
  if (status === 'offline') return 2;
  return 3;
}

function buildConnectedDescription(agent: ChatAgentLike, preset: ChatAgentProviderPreset): string {
  const parts = [
    agent.sessionKey ? 'managed session' : 'connected agent',
    agent.model ? String(agent.model) : '',
    agent.current_task ? String(agent.current_task).slice(0, 90) : preset.description,
  ].filter(Boolean);
  return parts.join(' · ');
}

function humanizeProvider(provider: string): string {
  return String(provider || 'agent')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function iconFromProvider(provider: string): string {
  const letters = humanizeProvider(provider)
    .split(/\s+/)
    .map((word) => word.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return letters || 'AG';
}
