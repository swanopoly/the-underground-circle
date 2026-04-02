/**
 * Bridge Task Dispatcher — Routes tasks to the correct local bridge
 * based on agent provider type. Falls back gracefully when bridges
 * are unreachable.
 */

const BRIDGE_PORTS: Record<string, number> = {
  'claude-code': 7778,
  'codex': 7779,
  'gemini': 7780,
  'gemini-cli': 7780,
  'cursor': 7781,
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
  try {
    const escaped = prompt.replace(/'/g, "'\\''");
    const fileCtx = fileName ? ` (file: ${fileName})` : '';
    const command = `echo '${escaped}${fileCtx}' | claude --dangerously-skip-permissions -p 2>&1 | tail -200`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    const res = await fetch(`http://localhost:${port}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`http://localhost:${port}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`http://localhost:${port}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`http://localhost:${port}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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
    const res = await fetch(`http://localhost:${port}/exec`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

