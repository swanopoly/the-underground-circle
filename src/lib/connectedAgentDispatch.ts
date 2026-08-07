/**
 * Provider-agnostic dispatch of a delegated task (capability buildout, asset
 * acquisition, failure recovery…) to whichever connected CLI agent is
 * available — not just Codex. Reuses an existing managed session when present
 * (preference order), otherwise launches the first provider whose bridge is
 * online. Fail-closed with an actionable message naming the bridges to start.
 *
 * This is what lets the chat fulfil a browser/app request whose adapter isn't
 * built yet: the broadened capability-buildout trigger fires, and this routes
 * the build to Codex / Claude Code / Gemini / Cursor — whichever is connected.
 */
import { checkAllBridges, sendTerminalAgentSessionMessage } from './bridgeTaskDispatcher';
import { listTerminalAgentControlSessions } from './terminalAgentControl';
import { launchClaudeCodeSessions } from './claudeCodeDetector';
import { launchCodexSessions } from './codexDetector';
import { launchGeminiCliSessions } from './geminiCliDetector';
import { launchCursorComposerSessions } from './cursorDetector';
import {
  formatVisualBriefsForConnectedAgent,
  type ChatVisualBriefArtifact,
} from './chatVisualBriefCore';

export type ConnectedAgentProvider = 'codex' | 'claude-code' | 'gemini' | 'cursor';

// Coding agents that can run a delegated repo/buildout task, in preference
// order: Codex + Claude Code are strongest for autonomous repo edits, Gemini
// CLI also codes, Cursor (GUI) is the last resort.
const DEFAULT_PROVIDER_ORDER: ConnectedAgentProvider[] = ['codex', 'claude-code', 'gemini', 'cursor'];

export interface ConnectedAgentDispatchResult {
  ok: boolean;
  provider: ConnectedAgentProvider | null;
  sessionId?: string;
  launched: boolean;
  resultsText: string;
}

type CommonLaunchInput = {
  count: number;
  prompt: string;
  prompts: string[];
  names: string[];
  circleId?: string;
  userId?: string;
};

function isConnectedAgentProvider(value: string): value is ConnectedAgentProvider {
  return value === 'codex' || value === 'claude-code' || value === 'gemini' || value === 'cursor';
}

async function launchForProvider(provider: ConnectedAgentProvider, input: CommonLaunchInput) {
  switch (provider) {
    case 'codex':       return launchCodexSessions(input);
    case 'claude-code': return launchClaudeCodeSessions(input);
    case 'gemini':      return launchGeminiCliSessions(input);
    case 'cursor':      return launchCursorComposerSessions(input);
    default:            return null;
  }
}

export async function dispatchConnectedAgentTask(opts: {
  prompt: string;
  visionArtifacts?: readonly ChatVisualBriefArtifact[];
  sessionName: string;
  sessionId?: string | null;
  preferredProvider?: ConnectedAgentProvider | null;
  providerOrder?: ConnectedAgentProvider[];
  /**
   * Hard provider allowlist for workflows that require provider-specific
   * result contracts. Unlike providerOrder, this also constrains an explicit
   * sessionId so a stale/user-supplied id cannot silently escape the lane.
   */
  allowedProviders?: ConnectedAgentProvider[];
  launchIfMissing?: boolean;
  circleId?: string;
  userId?: string;
}): Promise<ConnectedAgentDispatchResult> {
  const visualBlock = formatVisualBriefsForConnectedAgent(opts.visionArtifacts);
  const dispatchPrompt = visualBlock ? `${opts.prompt}\n\n${visualBlock}` : opts.prompt;
  const allowed = new Set<ConnectedAgentProvider>(
    opts.allowedProviders?.length ? opts.allowedProviders : DEFAULT_PROVIDER_ORDER,
  );
  const order = Array.from(new Set<ConnectedAgentProvider>([
    ...(opts.preferredProvider ? [opts.preferredProvider] : []),
    ...((opts.providerOrder && opts.providerOrder.length ? opts.providerOrder : DEFAULT_PROVIDER_ORDER)),
  ])).filter((provider) => allowed.has(provider));

  // 1. Reuse a manageable session — explicit id first, else preference order.
  const sessions = await listTerminalAgentControlSessions().catch(
    () => [] as Awaited<ReturnType<typeof listTerminalAgentControlSessions>>,
  );
  const manageable = sessions.filter((session) =>
    session.manageable
    && isConnectedAgentProvider(session.provider)
    && allowed.has(session.provider)
  );
  let target = opts.sessionId
    ? manageable.find((session) => session.sessionId === opts.sessionId) || null
    : null;
  if (!target) {
    for (const provider of order) {
      const found = manageable.find((session) => session.provider === provider);
      if (found) { target = found; break; }
    }
  }
  if (target && isConnectedAgentProvider(target.provider)) {
    const sent = await sendTerminalAgentSessionMessage(target.provider, target.sessionId, dispatchPrompt);
    if (sent.ok) {
      return {
        ok: true,
        provider: target.provider,
        sessionId: sent.sessionId || target.sessionId,
        launched: false,
        resultsText: `Sent the task to the ${target.providerLabel || target.provider} session ${sent.displayName || target.displayName || target.sessionId}.`,
      };
    }
    // Send failed (stale/closed session) — fall through to a fresh launch.
  }

  if (opts.launchIfMissing === false) {
    return {
      ok: false,
      provider: null,
      launched: false,
      resultsText: 'No managed connected-agent session is available and launchIfMissing is false.',
    };
  }

  // 2. Launch the first provider whose bridge is online (one parallel probe).
  const online = await checkAllBridges().catch(() => ({} as Record<string, boolean>));
  const launchable = order.filter((provider) => online[provider]);
  for (const provider of launchable) {
    const launched = await launchForProvider(provider, {
      count: 1,
      prompt: dispatchPrompt,
      prompts: [dispatchPrompt],
      names: [opts.sessionName],
      circleId: opts.circleId,
      userId: opts.userId,
    }).catch(() => null);
    if (launched && launched.ok && launched.launched >= 1) {
      const session = launched.sessions[0] as { sessionId?: string } | undefined;
      return {
        ok: true,
        provider,
        sessionId: session?.sessionId,
        launched: true,
        resultsText: `Launched a ${provider} session to run the task.`,
      };
    }
  }

  const offline = order.filter((provider) => !online[provider]);
  return {
    ok: false,
    provider: null,
    launched: false,
    resultsText: `No connected-agent bridge was reachable${offline.length ? ` (offline: ${offline.join(', ')})` : ''}. Start one — npm run bridge (Claude Code), bridge:codex, bridge:gemini, or bridge:cursor — then retry.`,
  };
}
