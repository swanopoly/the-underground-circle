/**
 * Bridge Task Dispatcher — Routes tasks to the correct local bridge
 * based on agent provider type. Falls back gracefully when bridges
 * are unreachable.
 */

import { ensureBridgeToken, bridgeAuthHeaders } from './bridgeAuth';

const BRIDGE_PORTS: Record<string, number> = {
  'claude-code': 7778,
  'codex': 7778,    // Routes through Claude Code bridge
  'gemini': 7778,   // Routes through Claude Code bridge (no dedicated bridge yet)
  'gemini-cli': 7778,
  'cursor': 7778,   // Routes through Claude Code bridge
};

export interface BridgeTaskResult {
  ok: boolean;
  response?: string;
  error?: string;
  dispatchedVia: 'bridge' | 'edge-function' | 'none';
  provider: string;
}

async function probeBridge(port: number): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://localhost:${port}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Dispatch to Claude Code bridge via /exec — pipes prompt to claude CLI
 */
async function dispatchToClaudeCode(prompt: string, fileName?: string | null): Promise<BridgeTaskResult> {
  const port = BRIDGE_PORTS['claude-code'];
  const online = await probeBridge(port);
  if (!online) return { ok: false, error: 'Claude Code bridge not reachable', dispatchedVia: 'none', provider: 'claude-code' };
  try {
    // Use a safe temp file approach to avoid shell injection — write prompt to stdin via process substitution
    const fileCtx = fileName ? `\n\nFile context: ${fileName}` : '';
    const fullPrompt = prompt + fileCtx;
    // Pass prompt as JSON body field — the bridge exec endpoint handles it as stdin pipe
    // Escape for shell: use base64 encoding to avoid any injection
    const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(fullPrompt))) : Buffer.from(fullPrompt).toString('base64');
    const command = `echo '${b64}' | base64 -d | claude --dangerously-skip-permissions -p 2>&1 | tail -200`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const token = await ensureBridgeToken();
    const res = await fetch(`http://localhost:${port}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bridgeAuthHeaders(token) },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (data.ok) {
      return {
        ok: true,
        response: data.stdout || data.stderr || 'Task completed (no output)',
        dispatchedVia: 'bridge',
        provider: 'claude-code',
      };
    }
    return { ok: false, error: data.error || 'Exec failed', dispatchedVia: 'bridge', provider: 'claude-code' };
  } catch (e: any) {
    return { ok: false, error: e.message, dispatchedVia: 'none', provider: 'claude-code' };
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
    const token = await ensureBridgeToken();
    const res = await fetch(`http://localhost:${port}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bridgeAuthHeaders(token) },
      body: JSON.stringify({ command: prompt + fileCtx }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (data.ok) {
      return {
        ok: true,
        response: data.response || 'Task completed',
        dispatchedVia: 'bridge',
        provider: 'gemini',
      };
    }
    return { ok: false, error: data.error || 'Send failed', dispatchedVia: 'bridge', provider: 'gemini' };
  } catch (e: any) {
    return { ok: false, error: e.message, dispatchedVia: 'none', provider: 'gemini' };
  }
}

/**
 * Dispatch to Codex — routes through Claude bridge /exec to invoke codex CLI
 */
async function dispatchToCodex(prompt: string, fileName?: string | null): Promise<BridgeTaskResult> {
  const port = BRIDGE_PORTS['claude-code'];
  const online = await probeBridge(port);
  if (!online) {
    return { ok: false, error: 'Claude bridge offline — cannot dispatch to Codex CLI', dispatchedVia: 'none', provider: 'codex' };
  }
  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const fileCtx = fileName ? ` (file: ${fileName})` : '';
    const command = `echo '${escaped}${fileCtx}' | codex --quiet 2>&1 | tail -200`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const token = await ensureBridgeToken();
    const res = await fetch(`http://localhost:${port}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bridgeAuthHeaders(token) },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (data.ok) {
      return {
        ok: true,
        response: data.stdout || data.stderr || 'Task completed (no output)',
        dispatchedVia: 'bridge',
        provider: 'codex',
      };
    }
    return { ok: false, error: data.error || 'Exec failed', dispatchedVia: 'bridge', provider: 'codex' };
  } catch (e: any) {
    return { ok: false, error: e.message, dispatchedVia: 'none', provider: 'codex' };
  }
}

/**
 * Dispatch to Cursor — routes through Claude bridge /exec
 */
async function dispatchToCursor(prompt: string, fileName?: string | null): Promise<BridgeTaskResult> {
  const port = BRIDGE_PORTS['claude-code'];
  const online = await probeBridge(port);
  if (!online) {
    return { ok: false, error: 'Claude bridge offline — cannot dispatch to Cursor', dispatchedVia: 'none', provider: 'cursor' };
  }
  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const fileCtx = fileName ? ` (file: ${fileName})` : '';
    const command = `echo '${escaped}${fileCtx}' | cursor --quiet 2>&1 | tail -200`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const token = await ensureBridgeToken();
    const res = await fetch(`http://localhost:${port}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bridgeAuthHeaders(token) },
      body: JSON.stringify({ command }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const data = await res.json();
    if (data.ok) {
      return {
        ok: true,
        response: data.stdout || data.stderr || 'Task completed (no output)',
        dispatchedVia: 'bridge',
        provider: 'cursor',
      };
    }
    return { ok: false, error: data.error || 'Exec failed', dispatchedVia: 'bridge', provider: 'cursor' };
  } catch (e: any) {
    return { ok: false, error: e.message, dispatchedVia: 'none', provider: 'cursor' };
  }
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

  // Check if the direct bridge is reachable
  const port = BRIDGE_PORTS[normalized];
  if (port && normalized !== 'codex' && normalized !== 'cursor') {
    const online = await probeBridge(port);
    if (!online) {
      return { ok: false, error: `Bridge on port ${port} is not reachable`, dispatchedVia: 'none', provider: normalized };
    }
  }

  switch (normalized) {
    case 'claude-code':
      return dispatchToClaudeCode(prompt, fileName);
    case 'gemini':
    case 'gemini-cli':
      return dispatchToGemini(prompt, fileName);
    case 'codex':
      return dispatchToCodex(prompt, fileName);
    case 'cursor':
      return dispatchToCursor(prompt, fileName);
    default:
      return { ok: false, error: `Unknown provider: ${provider}`, dispatchedVia: 'none', provider: normalized };
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
  options?: { model?: string; workdir?: string },
): Promise<BridgeTaskResult> {
  const port = BRIDGE_PORTS['claude-code'];
  try {
    const online = await probeBridge(port);
    if (!online) {
      return { ok: false, error: 'Claude bridge not reachable', dispatchedVia: 'none', provider: 'claude-code' };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const res = await fetch(`http://localhost:${port}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, model: options?.model, workdir: options?.workdir }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.ok) {
      return { ok: true, response: data.message || `Session spawned (PID ${data.pid})`, dispatchedVia: 'bridge', provider: 'claude-code' };
    }
    return { ok: false, error: data.error || 'Spawn failed', dispatchedVia: 'bridge', provider: 'claude-code' };
  } catch (e: any) {
    return { ok: false, error: e.message, dispatchedVia: 'none', provider: 'claude-code' };
  }
}

/**
 * Spawn a new Codex session with a task
 */
export async function spawnNewCodexSession(task: string): Promise<BridgeTaskResult> {
  const port = BRIDGE_PORTS['claude-code'];
  try {
    const online = await probeBridge(port);
    if (!online) return { ok: false, error: 'Bridge not reachable', dispatchedVia: 'none', provider: 'codex' };
    const escaped = task.replace(/'/g, "'\\''");
    const command = `nohup codex --quiet -p "${escaped}" > /tmp/codex-spawn-$$.log 2>&1 & echo $!`;
    const token = await ensureBridgeToken();
    const res = await fetch(`http://localhost:${port}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...bridgeAuthHeaders(token) },
      body: JSON.stringify({ command }),
    });
    const data = await res.json();
    return data.ok
      ? { ok: true, response: `Codex session spawned (PID ${data.stdout?.trim()})`, dispatchedVia: 'bridge', provider: 'codex' }
      : { ok: false, error: data.error, dispatchedVia: 'bridge', provider: 'codex' };
  } catch (e: any) {
    return { ok: false, error: e.message, dispatchedVia: 'none', provider: 'codex' };
  }
}

/**
 * Spawn a new session for any supported provider
 */
export async function spawnNewSession(
  provider: string,
  task: string,
  options?: { model?: string; workdir?: string },
): Promise<BridgeTaskResult> {
  const normalized = provider.toLowerCase().replace(/\s+/g, '-');
  switch (normalized) {
    case 'claude-code':
      return spawnNewClaudeSession(task, options);
    case 'codex':
      return spawnNewCodexSession(task);
    case 'gemini':
    case 'gemini-cli':
      return dispatchToGemini(task); // Gemini doesn't have persistent sessions, just dispatch
    default:
      return { ok: false, error: `Cannot spawn sessions for provider: ${provider}`, dispatchedVia: 'none', provider: normalized };
  }
}

/**
 * Wake an idle agent and assign it a task.
 * If the agent's bridge is online, spawns a new terminal session with the task.
 * If the bridge is offline, falls back to dispatchBridgeTask (which may fall through to AI).
 *
 * Flow:
 * 1. Probe the bridge for the agent's provider
 * 2. If online → spawn a new session with the task (wakes up a real terminal)
 * 3. If offline → try dispatch (exec on existing session) → fall back to AI
 * 4. Update agent status in the DB to 'building'
 */
export async function wakeAndAssignTask(
  provider: string,
  agentName: string,
  task: string,
  circleId: string,
  agentDbId?: string,
  options?: { model?: string; workdir?: string; fileName?: string },
): Promise<BridgeTaskResult> {
  const normalized = provider.toLowerCase().replace(/\s+/g, '-');
  const port = BRIDGE_PORTS[normalized] || BRIDGE_PORTS['claude-code'];
  const bridgeOnline = await probeBridge(port);

  console.log(`[wakeAndAssign] Agent "${agentName}" (${normalized}), bridge ${bridgeOnline ? 'ONLINE' : 'OFFLINE'}`);

  // Update agent status to building immediately
  if (agentDbId) {
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
  }

  if (bridgeOnline) {
    // Try spawning a new terminal session first — this WAKES the agent
    const spawnResult = await spawnNewSession(normalized, task, options);
    if (spawnResult.ok) {
      console.log(`[wakeAndAssign] Spawned new ${normalized} session for "${agentName}"`);
      return spawnResult;
    }

    // Spawn failed — try dispatching to an existing session
    console.log(`[wakeAndAssign] Spawn failed (${spawnResult.error}), trying dispatch...`);
    const dispatchResult = await dispatchBridgeTask(normalized, task, options?.fileName);
    if (dispatchResult.ok) return dispatchResult;

    // Both failed
    return { ok: false, error: `Wake failed: spawn (${spawnResult.error}), dispatch (${dispatchResult.error})`, dispatchedVia: 'none', provider: normalized };
  }

  // Bridge offline — try dispatch anyway (might work if bridge comes back)
  const dispatchResult = await dispatchBridgeTask(normalized, task, options?.fileName);
  return dispatchResult;
}

