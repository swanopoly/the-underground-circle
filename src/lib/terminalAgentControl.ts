import { fetchBridgeAuthenticated } from './bridgeAuth';
import { getBridgeUrl } from './bridgeEnvironment';
import { sendTerminalAgentSessionMessage, wakeAndAssignTask } from './bridgeTaskDispatcher';
import { loadAgentIdentities, type TerminalAgentOfficeConfig } from './agentIdentity';
import {
  formatVisualBriefsForConnectedAgent,
  type ChatVisualBriefArtifact,
} from './chatVisualBriefCore';

export type TerminalAgentControlProvider = 'claude-code' | 'codex' | 'gemini' | 'cursor';

export type TerminalAgentControlSession = {
  provider: TerminalAgentControlProvider;
  providerLabel: string;
  sessionId: string;
  displayName: string;
  status: string;
  task?: string | null;
  lastActivity?: string | null;
  projectDir?: string | null;
  model?: string | null;
  manageable: boolean;
  recentActions: string[];
  terminalConfig?: TerminalAgentOfficeConfig | null;
};

const PROVIDERS: Array<{ provider: TerminalAgentControlProvider; label: string; port: number }> = [
  { provider: 'claude-code', label: 'Claude Code', port: 7778 },
  { provider: 'codex', label: 'Codex', port: 7779 },
  { provider: 'gemini', label: 'Gemini CLI', port: 7780 },
  { provider: 'cursor', label: 'Cursor Composer', port: 7781 },
];

function displayNameFor(providerLabel: string, raw: any, index: number, total: number): string {
  const explicit = String(raw?.displayName || raw?.slug || '').trim();
  if (explicit) return explicit;
  return total > 1 ? `${providerLabel} #${index + 1}` : providerLabel;
}

async function fetchProviderSessions(provider: typeof PROVIDERS[number]): Promise<TerminalAgentControlSession[]> {
  const bridgeUrl = getBridgeUrl(provider.port);
  if (!bridgeUrl) return [];
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/sessions`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
    return sessions.map((session: any, index: number) => ({
      provider: provider.provider,
      providerLabel: provider.label,
      sessionId: String(session.sessionId || ''),
      displayName: displayNameFor(provider.label, session, index, sessions.length),
      status: String(session.status || 'idle'),
      task: session.task || session.lastUserMessage || null,
      lastActivity: session.lastActivity || null,
      projectDir: session.projectDir || null,
      model: session.model || null,
      manageable: Boolean(session.terminalTitle || session.manageable),
      recentActions: Array.isArray(session.recentActions) ? session.recentActions.slice(-4) : [],
    })).filter((session: TerminalAgentControlSession) => Boolean(session.sessionId));
  } catch {
    return [];
  }
}

export async function listTerminalAgentControlSessions(): Promise<TerminalAgentControlSession[]> {
  const groups = await Promise.all(PROVIDERS.map(fetchProviderSessions));
  const sessions = groups.flat();
  const identities = await loadAgentIdentities().catch(() => new Map());
  const hydrated = sessions.map((session) => {
    const identity = identities.get(session.sessionId);
    if (!identity) return session;
    return {
      ...session,
      displayName: identity.customName || session.displayName,
      model: identity.terminalConfig?.defaultModel || identity.boundModel || session.model,
      terminalConfig: identity.terminalConfig || null,
    };
  });
  return hydrated.sort((a, b) => {
    const statusRank = (value: string) => value === 'active' || value === 'building' ? 0 : value === 'idle' ? 1 : 2;
    const rank = statusRank(a.status) - statusRank(b.status);
    if (rank !== 0) return rank;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function formatTerminalAgentStatus(sessions: TerminalAgentControlSession[]): string {
  if (sessions.length === 0) {
    return 'No local terminal agent sessions are visible right now. Start one with `start a Codex session in my terminal` or `start 3 Claude Code sessions with prompts:`.';
  }
  const lines = sessions.map((session) => {
    const bits = [
      `**${session.displayName}**`,
      `provider: ${session.providerLabel}`,
      `status: ${session.status}`,
      session.manageable ? 'chat-control: ready' : 'chat-control: observe only',
      session.task ? `task: ${session.task}` : '',
      session.projectDir ? `project: ${session.projectDir.split('/').pop() || session.projectDir}` : '',
      session.sessionId ? `id: \`${session.sessionId}\`` : '',
    ].filter(Boolean);
    return `- ${bits.join(' · ')}`;
  });
  return [
    `Terminal agent sessions (${sessions.length})`,
    '',
    ...lines,
    '',
    'Send follow-ups with `/agent <name or id> <message>` or `tell Codex #1 to <message>`.',
  ].join('\n');
}

function normalize(value: string): string {
  return String(value || '')
    .toLowerCase()
    .replace(/^@/, '')
    .replace(/[_:]+/g, ' ')
    .replace(/[^\w#.\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sessionAliases(session: TerminalAgentControlSession): string[] {
  const id = session.sessionId;
  const idTail = id.split('-').slice(-1)[0];
  return [
    session.displayName,
    session.displayName.replace('#', ''),
    `${session.providerLabel} ${session.displayName.replace(/[^\d]/g, '')}`.trim(),
    session.providerLabel,
    session.provider,
    id,
    id.slice(0, 12),
    idTail,
  ].filter(Boolean);
}

export function findTerminalAgentSessionTarget(
  sessions: TerminalAgentControlSession[],
  target: string,
): TerminalAgentControlSession | null {
  const key = normalize(target);
  if (!key) return null;
  let best: { session: TerminalAgentControlSession; score: number } | null = null;
  for (const session of sessions) {
    const aliases = sessionAliases(session).map(normalize);
    let score = 0;
    if (aliases.some((alias) => alias === key)) score = 100;
    else if (aliases.some((alias) => alias && alias.startsWith(key))) score = 80;
    else if (aliases.some((alias) => alias && (alias.includes(key) || key.includes(alias)))) score = 60;
    if (score > 0 && (!best || score > best.score)) best = { session, score };
  }
  return best?.session || null;
}

function parseSendIntent(message: string): { target: string; body: string } | null {
  const raw = String(message || '').trim();
  if (!raw) return null;

  const isPluralTarget = (target: string) =>
    /\b(?:all|every|available|active|multiple|several)\b/i.test(target)
    || /\bagents\b/i.test(target);

  const slashQuoted = raw.match(/^\/(?:agent|terminal|term)\s+["“]([^"”]+)["”]\s+([\s\S]+)$/i);
  if (slashQuoted && !isPluralTarget(slashQuoted[1])) return { target: slashQuoted[1].trim(), body: slashQuoted[2].trim() };

  const slashColon = raw.match(/^\/(?:agent|terminal|term)\s+(.+?)\s*:\s*([\s\S]+)$/i);
  if (slashColon && !isPluralTarget(slashColon[1])) return { target: slashColon[1].trim(), body: slashColon[2].trim() };

  const tell = raw.match(/^(?:tell|ask)\s+(.+?)\s+to\s+([\s\S]+)$/i);
  if (tell && !isPluralTarget(tell[1]) && /\b(?:codex|claude|gemini|cursor|composer|cli|agent|session|#\d+)\b/i.test(tell[1])) {
    return { target: tell[1].trim(), body: tell[2].trim() };
  }

  const sendQuoted = raw.match(/^send\s+["“]([\s\S]+?)["”]\s+to\s+(.+)$/i);
  if (sendQuoted && !isPluralTarget(sendQuoted[2])) return { target: sendQuoted[2].trim(), body: sendQuoted[1].trim() };

  return null;
}

/** True only for a message that will send instructions to an existing managed
 * terminal agent. Status/list requests intentionally do not trigger image
 * analysis. */
export function isTerminalAgentSendRequest(message: string): boolean {
  return Boolean(parseSendIntent(message));
}

function providerFromExplicitTarget(target: string): TerminalAgentControlProvider | null {
  const key = normalize(target);
  if (/\bclaude(?: code)?\b/.test(key)) return 'claude-code';
  if (/\bcodex\b/.test(key)) return 'codex';
  if (/\bgemini(?: cli)?\b/.test(key)) return 'gemini';
  if (/\bcursor(?: composer)?\b|\bcomposer\b/.test(key)) return 'cursor';
  return null;
}

function providerLabel(provider: TerminalAgentControlProvider): string {
  return PROVIDERS.find((candidate) => candidate.provider === provider)?.label || provider;
}

function isStatusIntent(message: string): boolean {
  const raw = String(message || '').trim();
  if (/^\/(?:agents|terminals|terminal-agents)$/i.test(raw)) return true;
  return /\b(?:what|show|list|status|summarize)\b/i.test(raw)
    && /\b(?:agents?|terminal sessions?|codex|claude code|gemini cli|cursor|composer)\b/i.test(raw)
    && /\b(?:doing|running|open|status|sessions?|working on)\b/i.test(raw);
}

function applyTerminalProfile(message: string, config?: TerminalAgentOfficeConfig | null): string {
  const instructions = config?.defaultPrompt?.trim();
  if (!instructions) return message;
  return [
    instructions,
    '',
    'Follow-up from The Underground Circle chat:',
    message,
  ].join('\n');
}

export async function executeTerminalAgentControlFromChat(
  message: string,
  options: {
    visionArtifacts?: readonly ChatVisualBriefArtifact[];
    circleId?: string;
    launchIfMissing?: boolean;
  } = {},
): Promise<{ message: string } | null> {
  if (isStatusIntent(message)) {
    const sessions = await listTerminalAgentControlSessions();
    return { message: formatTerminalAgentStatus(sessions) };
  }

  const sendIntent = parseSendIntent(message);
  if (!sendIntent) return null;

  const visualContext = formatVisualBriefsForConnectedAgent(options.visionArtifacts);
  const bodyWithVisualContext = visualContext
    ? `${sendIntent.body}\n\n${visualContext}`
    : sendIntent.body;
  const launchExplicitProvider = async (): Promise<{ message: string } | null> => {
    const explicitProvider = providerFromExplicitTarget(sendIntent.target);
    if (!explicitProvider || !options.launchIfMissing || !options.circleId) return null;
    const label = providerLabel(explicitProvider);
    const launched = await wakeAndAssignTask(
      explicitProvider,
      label,
      bodyWithVisualContext,
      options.circleId,
      undefined,
      { sessionName: label },
    );
    if (launched.ok) {
      return {
        message: `Started a managed **${label}** session and sent the task.\n\n${sendIntent.body}`,
      };
    }
    return {
      message: `I found the **${label}** target, but its local bridge could not start a managed session: ${launched.error || 'unknown bridge error'}`,
    };
  };

  const sessions = await listTerminalAgentControlSessions();
  const target = findTerminalAgentSessionTarget(sessions, sendIntent.target);
  if (!target) {
    const launchResult = await launchExplicitProvider();
    if (launchResult) return launchResult;
    return {
      message: [
        `I could not find a terminal agent matching "${sendIntent.target}".`,
        '',
        formatTerminalAgentStatus(sessions),
      ].join('\n'),
    };
  }

  if (!target.manageable) {
    const launchResult = await launchExplicitProvider();
    if (launchResult) return launchResult;
    return {
      message: `I can see **${target.displayName}**, but it was not launched as a managed terminal session, so I cannot safely send input to it. Start a new managed session from chat, then use \`/agent ${target.displayName} <message>\`.`,
    };
  }

  const body = applyTerminalProfile(bodyWithVisualContext, target.terminalConfig);
  const result = await sendTerminalAgentSessionMessage(target.provider, target.sessionId, body);
  if (!result.ok) {
    return { message: `Could not send to **${target.displayName}**: ${result.error || 'unknown error'}` };
  }
  return {
    message: `Sent to **${result.displayName || target.displayName}**.\n\n${sendIntent.body}`,
  };
}
