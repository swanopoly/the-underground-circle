/**
 * Bridge Task Dispatcher — Routes tasks to the correct local bridge
 * based on agent provider type. Falls back gracefully when bridges
 * are unreachable.
 */

import { fetchBridgeAuthenticated } from './bridgeAuth';
import { getBridgeUrl } from './bridgeEnvironment';
import type { TerminalLaunchMode } from './agentIdentity';
import { applyAgentDevelopmentStandardsToPrompt } from './agentDevelopmentStandards';

const BRIDGE_PORTS: Record<string, number> = {
  'claude-code': 7778,
  'codex': 7779,
  'gemini': 7780,
  'gemini-cli': 7780,
  'cursor': 7781,
  'cursor-composer': 7781,
};

function envFlag(name: string): boolean {
  return String(process.env[name] || '').trim().toLowerCase() === 'true'
    || String(process.env[name] || '').trim() === '1';
}

function isClaudeCodeBillingAllowed(): boolean {
  return envFlag('EXPO_PUBLIC_ALLOW_CLAUDE_CODE_BILLING')
    || envFlag('EXPO_PUBLIC_ALLOW_CLAUDE_BRIDGE_BILLING');
}

function claudeBillingDisabledResult(action: string): BridgeTaskResult {
  return {
    ok: false,
    transportAccepted: false,
    error: `${action} is disabled to prevent Anthropic charges. Set EXPO_PUBLIC_ALLOW_CLAUDE_CODE_BILLING=true and restart the app if you intentionally want the app to launch/message Claude Code.`,
    dispatchedVia: 'none',
    provider: 'claude-code',
  };
}

export interface BridgeTaskResult {
  ok: boolean;
  /** true=accepted; false=proved no mutation crossed; null/undefined=do not replay. */
  transportAccepted: boolean | null;
  response?: string;
  error?: string;
  dispatchedVia: 'bridge' | 'edge-function' | 'none';
  provider: string;
  /** Exact bridge-owned session identity, present only after one-session launch/send proof. */
  sessionId?: string;
  displayName?: string;
}

export interface TerminalSessionSendResult extends BridgeTaskResult {}

type BridgeLaunchSessionIdentity = {
  sessionId: string;
  displayName?: string;
};

function readExactBridgeLaunchSession(data: unknown): BridgeLaunchSessionIdentity | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  if (payload.ok === false || payload.launched !== 1 || !Array.isArray(payload.sessions)) return null;
  const failedIds = new Set(
    (Array.isArray(payload.failed) ? payload.failed : [])
      .map((entry) => entry && typeof entry === 'object' ? String((entry as Record<string, unknown>).sessionId || '') : '')
      .filter(Boolean),
  );
  const candidates = payload.sessions.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const session = entry as Record<string, unknown>;
    const sessionId = typeof session.sessionId === 'string' ? session.sessionId : '';
    return sessionId.length <= 160
      && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(sessionId)
      && !session.launchError
      && !failedIds.has(sessionId);
  });
  if (candidates.length !== 1) return null;
  const session = candidates[0] as Record<string, unknown>;
  const displayName = typeof session.displayName === 'string'
    && session.displayName.trim()
    && session.displayName.trim().length <= 160
      ? session.displayName.trim()
      : undefined;
  return {
    sessionId: session.sessionId as string,
    displayName,
  };
}

function missingExactLaunchIdentity(provider: string): BridgeTaskResult {
  return {
    ok: false,
    transportAccepted: null,
    error: `The ${provider} bridge reported a launch but did not return one exact session identity. The task was not replayed.`,
    dispatchedVia: 'bridge',
    provider,
  };
}

function rejectedMutationTransport(res: Response, data?: unknown): false | null {
  const body = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  const status = typeof body?.status === 'string' ? body.status.trim().toLowerCase() : '';
  const explicitStructuredRejection = res.ok && (
    body?.ok === false
    || body?.accepted === false
    || body?.success === false
    || ['failed', 'error', 'rejected', 'cancelled', 'canceled'].includes(status)
  );
  if (explicitStructuredRejection) return false;
  return res.status >= 400
    && res.status < 500
    && res.status !== 408
    && res.status !== 409
      ? false
      : null;
}

export interface TerminalSpawnOptions {
  fileName?: string;
  launchMode?: TerminalLaunchMode;
  model?: string;
  sessionName?: string;
  workdir?: string;
  /**
   * When true, the bridge launches the CLI agent in its own git worktree
   * (`.openswan-worktrees/openswan-agent-*`) so edits stay isolated from the
   * shared tree. Honored by the claude-code/codex/gemini launch paths; cursor
   * (GUI injection) ignores it. Fail-open: bridge falls back to the shared cwd.
   */
  useWorktree?: boolean;
}

async function probeBridge(port: number): Promise<boolean> {
  try {
    const baseUrl = getBridgeUrl(port) || `http://localhost:${port}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`${baseUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Dispatch to Claude Code through the structured, server-owned spawn route.
 */
async function dispatchToClaudeCode(prompt: string, fileName?: string | null): Promise<BridgeTaskResult> {
  if (!isClaudeCodeBillingAllowed()) {
    return claudeBillingDisabledResult('Claude Code bridge dispatch');
  }
  const port = BRIDGE_PORTS['claude-code'];
  const online = await probeBridge(port);
  if (!online) return { ok: false, transportAccepted: false, error: 'Claude Code bridge not reachable', dispatchedVia: 'none', provider: 'claude-code' };
  try {
    const fileCtx = fileName ? `\n\nFile context: ${fileName}` : '';
    const fullPrompt = prompt + fileCtx;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const baseUrl = getBridgeUrl(port) || `http://localhost:${port}`;
    const res = await fetchBridgeAuthenticated(`${baseUrl}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: fullPrompt, useWorktree: false }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (res.ok && data?.ok === true) {
      const spawned = Array.isArray(data.results) ? data.results.find((item: any) => item?.ok) : null;
      return {
        ok: true,
        transportAccepted: true,
        response: spawned?.spawnId
          ? `Claude Code task started (handle ${spawned.spawnId}).`
          : (data.message || 'Claude Code task started.'),
        dispatchedVia: 'bridge',
        provider: 'claude-code',
      };
    }
    return { ok: false, transportAccepted: rejectedMutationTransport(res, data), error: data.error || data.message || 'Spawn failed', dispatchedVia: 'bridge', provider: 'claude-code' };
  } catch (e: any) {
    return { ok: false, transportAccepted: null, error: e.message, dispatchedVia: 'none', provider: 'claude-code' };
  }
}

/**
 * Dispatch to Gemini CLI bridge via /send — calls Gemini API with OAuth
 */
async function dispatchToGemini(prompt: string, fileName?: string | null): Promise<BridgeTaskResult> {
  const port = BRIDGE_PORTS['gemini'];
  try {
    const fileCtx = fileName ? `\n\nContext file: ${fileName}` : '';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const baseUrl = getBridgeUrl(port) || `http://localhost:${port}`;
    const res = await fetchBridgeAuthenticated(`${baseUrl}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: prompt + fileCtx }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (res.ok && data?.ok === true) {
      return {
        ok: true,
        transportAccepted: true,
        response: data.response || 'Gemini CLI accepted the task.',
        dispatchedVia: 'bridge',
        provider: 'gemini',
      };
    }
    return { ok: false, transportAccepted: rejectedMutationTransport(res, data), error: data.error || 'Send failed', dispatchedVia: 'bridge', provider: 'gemini' };
  } catch (e: any) {
    return { ok: false, transportAccepted: null, error: e.message, dispatchedVia: 'none', provider: 'gemini' };
  }
}

async function dispatchToCodex(prompt: string, fileName?: string | null): Promise<BridgeTaskResult> {
  const fileCtx = fileName ? `\n\nFile context: ${fileName}` : '';
  return spawnNewCodexSession(`${prompt}${fileCtx}`);
}

export async function sendTerminalAgentSessionMessage(
  provider: string,
  sessionId: string,
  message: string,
): Promise<TerminalSessionSendResult> {
  const normalized = provider.toLowerCase().replace(/\s+/g, '-');
  const bridgeProvider = normalized === 'gemini-cli'
    ? 'gemini'
    : normalized === 'cursor-composer'
      ? 'cursor'
      : normalized;
  const port = BRIDGE_PORTS[bridgeProvider];
  if (!port || !['claude-code', 'codex', 'gemini', 'cursor'].includes(bridgeProvider)) {
    return { ok: false, transportAccepted: false, error: `Terminal session send is not supported for ${provider}`, dispatchedVia: 'none', provider: normalized };
  }

  const online = await probeBridge(port);
  if (!online) {
    return { ok: false, transportAccepted: false, error: `Bridge on port ${port} is not reachable`, dispatchedVia: 'none', provider: normalized };
  }

  const bridgeUrl = getBridgeUrl(port) || `http://localhost:${port}`;
  const profiledMessage = applyAgentDevelopmentStandardsToPrompt(message, {
    label: 'The selected terminal agent must follow these repo standards for this chat handoff.',
  });
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/terminal/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: profiledMessage }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok === true) {
      if (typeof data.sessionId !== 'string' || data.sessionId !== sessionId) {
        return {
          ok: false,
          transportAccepted: null,
          error: 'The bridge accepted a terminal send but returned mismatched session identity. The task was not replayed; verify the requested session before retrying.',
          dispatchedVia: 'bridge',
          provider: normalized,
          sessionId,
          displayName: data?.displayName,
        };
      }
      return {
        ok: true,
        transportAccepted: true,
        response: data.message || `Sent to ${data.displayName || sessionId}.`,
        dispatchedVia: 'bridge',
        provider: normalized,
        sessionId,
        displayName: data.displayName,
      };
    }
    return {
      ok: false,
      transportAccepted: rejectedMutationTransport(res, data),
      error: data?.error || `Terminal send failed with HTTP ${res.status}`,
      dispatchedVia: 'bridge',
      provider: normalized,
      sessionId,
      displayName: data?.displayName,
    };
  } catch (e: any) {
    if (e.name === 'AbortError') return { ok: false, transportAccepted: null, error: 'Terminal send timed out; the task was not replayed', dispatchedVia: 'none', provider: normalized, sessionId };
    return { ok: false, transportAccepted: null, error: `${e.message || 'Bridge response unavailable'}; the task was not replayed`, dispatchedVia: 'none', provider: normalized, sessionId };
  }
}

/**
 * Dispatch to Cursor Composer through the local Cursor bridge.
 */
async function dispatchToCursor(prompt: string, fileName?: string | null): Promise<BridgeTaskResult> {
  const fileCtx = fileName ? `\n\nFile context: ${fileName}` : '';
  return spawnNewCursorComposerSession(`${prompt}${fileCtx}`);
}

/**
 * Main dispatcher — routes task to correct bridge based on provider
 */
export async function dispatchBridgeTask(
  provider: string,
  prompt: string,
  fileName?: string | null,
): Promise<BridgeTaskResult> {
  const normalized = provider.toLowerCase().replace(/\s+/g, '-');
  const bridgeProvider = normalized === 'cursor-composer' ? 'cursor' : normalized;
  const profiledPrompt = applyAgentDevelopmentStandardsToPrompt(prompt, {
    label: 'The selected bridge agent must follow these repo standards for this delegated task.',
  });

  // Check if the direct bridge is reachable
  const port = BRIDGE_PORTS[bridgeProvider];
  if (port && bridgeProvider !== 'codex' && bridgeProvider !== 'cursor') {
    const online = await probeBridge(port);
    if (!online) {
      return { ok: false, transportAccepted: false, error: `Bridge on port ${port} is not reachable`, dispatchedVia: 'none', provider: bridgeProvider };
    }
  }

  switch (bridgeProvider) {
    case 'claude-code':
      return dispatchToClaudeCode(profiledPrompt, fileName);
    case 'gemini':
    case 'gemini-cli':
      return dispatchToGemini(profiledPrompt, fileName);
    case 'codex':
      return dispatchToCodex(profiledPrompt, fileName);
    case 'cursor':
      return dispatchToCursor(profiledPrompt, fileName);
    default:
      return { ok: false, transportAccepted: false, error: `Unknown provider: ${provider}`, dispatchedVia: 'none', provider: normalized };
  }
}

/**
 * Check which bridges are currently online
 */
export async function checkAllBridges(): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};
  await Promise.all(
    Object.entries(BRIDGE_PORTS).map(async ([provider, port]) => {
      results[provider] = await probeBridge(port);
    }),
  );
  return results;
}

/**
 * Spawn a brand new Claude Code session with a task
 */
export async function spawnNewClaudeSession(
  task: string,
  options?: TerminalSpawnOptions,
): Promise<BridgeTaskResult> {
  if (!isClaudeCodeBillingAllowed()) {
    return claudeBillingDisabledResult('Claude Code terminal launch');
  }
  const port = BRIDGE_PORTS['claude-code'];
  const bridgeUrl = getBridgeUrl(port) || `http://localhost:${port}`;
  try {
    const online = await probeBridge(port);
    if (!online) {
      return { ok: false, transportAccepted: false, error: 'Claude bridge not reachable', dispatchedVia: 'none', provider: 'claude-code' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const profiledTask = applyAgentDevelopmentStandardsToPrompt(task, {
      label: 'The launched terminal agent must follow these repo standards for this delegated task.',
    });
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count: 1,
        prompts: [profiledTask],
        names: [options?.sessionName || 'Claude Code #1'],
        model: options?.model,
        projectDir: options?.workdir,
        useWorktree: options?.useWorktree,
        permissionMode: options?.launchMode === 'full-auto'
          ? 'bypassPermissions'
          : options?.launchMode === 'auto'
            ? 'acceptEdits'
            : 'default',
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json().catch(() => null);
    if (res.ok && data?.launched > 0) {
      const session = readExactBridgeLaunchSession(data);
      if (!session) return missingExactLaunchIdentity('claude-code');
      return {
        ok: true,
        transportAccepted: true,
        response: data.message || 'Claude Code terminal session launched.',
        dispatchedVia: 'bridge',
        provider: 'claude-code',
        ...session,
      };
    }
    return { ok: false, transportAccepted: rejectedMutationTransport(res, data), error: data?.error || data?.failed?.[0]?.error || 'Launch failed', dispatchedVia: 'bridge', provider: 'claude-code' };
  } catch (e: any) {
    return { ok: false, transportAccepted: null, error: e.message, dispatchedVia: 'none', provider: 'claude-code' };
  }
}

/**
 * Spawn a new Codex session with a task
 */
export async function spawnNewCodexSession(
  task: string,
  options?: TerminalSpawnOptions,
): Promise<BridgeTaskResult> {
  const port = BRIDGE_PORTS['codex'];
  const bridgeUrl = getBridgeUrl(port) || `http://localhost:${port}`;
  try {
    const online = await probeBridge(port);
    if (!online) return { ok: false, transportAccepted: false, error: 'Codex bridge not reachable', dispatchedVia: 'none', provider: 'codex' };
    const profiledTask = applyAgentDevelopmentStandardsToPrompt(task, {
      label: 'The launched terminal agent must follow these repo standards for this delegated task.',
    });
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count: 1,
        prompts: [profiledTask],
        names: [options?.sessionName || 'Codex'],
        model: options?.model,
        projectDir: options?.workdir,
        useWorktree: options?.useWorktree,
        fullAuto: options?.launchMode === 'full-auto',
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.launched > 0) {
      const session = readExactBridgeLaunchSession(data);
      if (!session) return missingExactLaunchIdentity('codex');
      return {
        ok: true,
        transportAccepted: true,
        response: `Codex terminal session launched${session?.displayName ? ` as ${session.displayName}` : ''}.`,
        dispatchedVia: 'bridge',
        provider: 'codex',
        ...session,
      };
    }
    return {
      ok: false,
      transportAccepted: rejectedMutationTransport(res, data),
      error: data?.error || data?.failed?.[0]?.error || `Codex bridge launch failed with HTTP ${res.status}`,
      dispatchedVia: 'bridge',
      provider: 'codex',
    };
  } catch (e: any) {
    return { ok: false, transportAccepted: null, error: e.message, dispatchedVia: 'none', provider: 'codex' };
  }
}

export async function spawnNewGeminiCliSession(
  task: string,
  options?: TerminalSpawnOptions,
): Promise<BridgeTaskResult> {
  const port = BRIDGE_PORTS['gemini'];
  const bridgeUrl = getBridgeUrl(port) || `http://localhost:${port}`;
  try {
    const online = await probeBridge(port);
    if (!online) return { ok: false, transportAccepted: false, error: 'Gemini CLI bridge not reachable', dispatchedVia: 'none', provider: 'gemini' };
    const profiledTask = applyAgentDevelopmentStandardsToPrompt(task, {
      label: 'The launched terminal agent must follow these repo standards for this delegated task.',
    });
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count: 1,
        prompts: [profiledTask],
        names: [options?.sessionName || 'Gemini CLI #1'],
        model: options?.model,
        projectDir: options?.workdir,
        useWorktree: options?.useWorktree,
        yolo: options?.launchMode === 'full-auto',
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.launched > 0) {
      const session = readExactBridgeLaunchSession(data);
      if (!session) return missingExactLaunchIdentity('gemini');
      return {
        ok: true,
        transportAccepted: true,
        response: 'Gemini CLI terminal session launched.',
        dispatchedVia: 'bridge',
        provider: 'gemini',
        ...session,
      };
    }
    return {
      ok: false,
      transportAccepted: rejectedMutationTransport(res, data),
      error: data?.error || data?.failed?.[0]?.error || `Gemini CLI bridge launch failed with HTTP ${res.status}`,
      dispatchedVia: 'bridge',
      provider: 'gemini',
    };
  } catch (e: any) {
    return { ok: false, transportAccepted: null, error: e.message, dispatchedVia: 'none', provider: 'gemini' };
  }
}

export async function spawnNewCursorComposerSession(
  task: string,
  options?: TerminalSpawnOptions,
): Promise<BridgeTaskResult> {
  const port = BRIDGE_PORTS['cursor'];
  const bridgeUrl = getBridgeUrl(port) || `http://localhost:${port}`;
  try {
    const online = await probeBridge(port);
    if (!online) return { ok: false, transportAccepted: false, error: 'Cursor bridge not reachable', dispatchedVia: 'none', provider: 'cursor' };
    const profiledTask = applyAgentDevelopmentStandardsToPrompt(task, {
      label: 'The launched terminal agent must follow these repo standards for this delegated task.',
    });
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/launch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        count: 1,
        prompts: [profiledTask],
        names: [options?.sessionName || 'Cursor Composer'],
        model: options?.model,
        projectDir: options?.workdir,
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.launched > 0) {
      const session = readExactBridgeLaunchSession(data);
      if (!session) return missingExactLaunchIdentity('cursor');
      return {
        ok: true,
        transportAccepted: true,
        response: `Cursor Composer task sent${session?.displayName ? ` as ${session.displayName}` : ''}.`,
        dispatchedVia: 'bridge',
        provider: 'cursor',
        ...session,
      };
    }
    return {
      ok: false,
      transportAccepted: rejectedMutationTransport(res, data),
      error: data?.error || data?.failed?.[0]?.error || `Cursor bridge launch failed with HTTP ${res.status}`,
      dispatchedVia: 'bridge',
      provider: 'cursor',
    };
  } catch (e: any) {
    return { ok: false, transportAccepted: null, error: e.message, dispatchedVia: 'none', provider: 'cursor' };
  }
}

/**
 * Reclaim finished OpenSwan worktrees (`.openswan-worktrees/*`). Routed through
 * the Claude Code bridge since worktrees are shared across providers in one
 * repo. Safe by default — only clean worktrees are removed; dirty ones (unsaved
 * agent work) are kept unless `force` is set.
 */
export async function pruneTerminalAgentWorktrees(
  options?: { workdir?: string; force?: boolean },
): Promise<{ ok: boolean; removed?: string[]; kept?: string[]; message?: string; error?: string }> {
  const port = BRIDGE_PORTS['claude-code'];
  const bridgeUrl = getBridgeUrl(port) || `http://localhost:${port}`;
  try {
    const online = await probeBridge(port);
    if (!online) return { ok: false, error: 'Claude Code bridge not reachable for worktree prune' };
    const res = await fetchBridgeAuthenticated(`${bridgeUrl}/worktree/prune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workdir: options?.workdir, force: options?.force }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.ok) {
      return { ok: true, removed: data.removed || [], kept: data.kept || [], message: data.message };
    }
    return { ok: false, error: data?.error || `Worktree prune failed with HTTP ${res.status}` };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/**
 * Spawn a new session for any supported provider
 */
export async function spawnNewSession(
  provider: string,
  task: string,
  options?: TerminalSpawnOptions,
): Promise<BridgeTaskResult> {
  const normalized = provider.toLowerCase().replace(/\s+/g, '-');
  const bridgeProvider = normalized === 'cursor-composer' ? 'cursor' : normalized;
  switch (bridgeProvider) {
    case 'claude-code':
      return spawnNewClaudeSession(task, options);
    case 'codex':
      return spawnNewCodexSession(task, options);
    case 'gemini':
    case 'gemini-cli':
      return spawnNewGeminiCliSession(task, options);
    case 'cursor':
      return spawnNewCursorComposerSession(task, options);
    default:
      return { ok: false, transportAccepted: false, error: `Cannot spawn sessions for provider: ${provider}`, dispatchedVia: 'none', provider: normalized };
  }
}

/**
 * Wake an idle agent and assign it a task.
 * If the agent's bridge is online, spawns a new terminal session with the task.
 * If the bridge is offline, makes one direct bridge-dispatch attempt.
 *
 * Flow:
 * 1. Probe the bridge for the agent's provider
 * 2. If online → spawn a new session with the task (wakes up a real terminal)
 * 3. If offline → try a direct bridge dispatch
 * 4. Update a linked roster row only after bridge acceptance
 */
export async function wakeAndAssignTask(
  provider: string,
  agentName: string,
  task: string,
  circleId: string,
  agentDbId?: string,
  options?: TerminalSpawnOptions,
): Promise<BridgeTaskResult> {
  const normalized = provider.toLowerCase().replace(/\s+/g, '-');
  const port = BRIDGE_PORTS[normalized] || BRIDGE_PORTS['claude-code'];
  const bridgeOnline = await probeBridge(port);

  console.log(`[wakeAndAssign] Agent "${agentName}" (${normalized}), bridge ${bridgeOnline ? 'ONLINE' : 'OFFLINE'}`);

  // Roster presence is not dispatch authority. Update it only after a real
  // bridge accepted the task; failures and synchronous AI drafts must not
  // strand an Office agent in `building`.
  const markAcceptedBuilding = async () => {
    if (!agentDbId) return;
    try {
      const { supabase } = await import('./supabase');
      await supabase.from('circle_office_agents')
        .update({
          status: 'building',
          current_task: task.slice(0, 120),
          last_active_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', agentDbId);
    } catch {}
  };

  if (bridgeOnline) {
    // Try spawning a new terminal session first — this WAKES the agent
    const spawnResult = await spawnNewSession(normalized, task, options);
    if (spawnResult.ok) {
      await markAcceptedBuilding();
      console.log(`[wakeAndAssign] Spawned new ${normalized} session for "${agentName}"`);
      return { ...spawnResult, transportAccepted: true };
    }

    // A launch request may have crossed the bridge before its response was
    // lost. Never turn one user action into a second mutation automatically.
    console.log(`[wakeAndAssign] Spawn acknowledgement unavailable (${spawnResult.error}); not replaying through dispatch.`);
    return {
      ...spawnResult,
      ok: false,
      transportAccepted: spawnResult.transportAccepted ?? null,
      error: `${spawnResult.error || 'The bridge did not confirm the launch.'} The task was not replayed.`,
    };
  }

  // Bridge offline — try dispatch anyway (might work if bridge comes back)
  const dispatchResult = await dispatchBridgeTask(normalized, task, options?.fileName);
  if (dispatchResult.ok && dispatchResult.dispatchedVia === 'bridge') await markAcceptedBuilding();
  return dispatchResult.ok
    ? { ...dispatchResult, transportAccepted: true }
    : { ...dispatchResult, transportAccepted: dispatchResult.transportAccepted ?? null };
}
