/**
 * agentSpawner — 1-click multi-agent spawner.
 *
 * Calls the Claude Code Bridge's /spawn endpoint to launch N Claude Code
 * sessions in parallel. Each session gets a scoped task and optionally
 * its own git worktree for conflict-free parallel editing.
 *
 * Patterns adopted from Octogent (github.com/hesamsheikh/octogent):
 *   - Todo-driven decomposition: one agent per mission task
 *   - Worktree isolation: each agent on its own branch
 *   - Scoped context: each agent gets only its relevant brief
 */

const BRIDGE_URL = 'http://localhost:7778';

export interface SpawnTask {
  task: string;
  model?: string;
}

export interface SpawnOpts {
  tasks: SpawnTask[];
  useWorktree?: boolean;
  workdir?: string;
}

export interface SpawnResult {
  ok: boolean;
  spawned: number;
  total: number;
  results: Array<{
    ok: boolean;
    pid?: string;
    task: string;
    cwd?: string;
    logFile?: string;
    error?: string;
  }>;
  message: string;
}

export interface SpawnedAgentStatus {
  ok: boolean;
  pid?: string | null;
  logFile?: string | null;
  isRunning: boolean;
  completed: boolean;
  hasOutput?: boolean;
  output?: string;
  lastUpdatedAt?: string | null;
  byteLength?: number;
  error?: string;
}

function isLegacyMissingTaskError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes('missing task');
}

async function spawnSingleLegacy(
  task: SpawnTask,
  opts?: Pick<SpawnOpts, 'useWorktree' | 'workdir'>,
): Promise<{ ok: boolean; pid?: string; task: string; cwd?: string; logFile?: string; error?: string }> {
  const res = await fetch(`${BRIDGE_URL}/spawn`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      task: task.task,
      model: task.model,
      useWorktree: opts?.useWorktree ?? false,
      workdir: opts?.workdir,
    }),
  });

  let payload: any = null;
  let text = '';
  try {
    payload = await res.json();
  } catch {
    text = await res.text().catch(() => '');
  }

  if (!res.ok) {
    return {
      ok: false,
      task: task.task,
      error: payload?.error || text || `HTTP ${res.status}`,
    };
  }

  if (payload?.results && Array.isArray(payload.results) && payload.results.length > 0) {
    const first = payload.results[0];
    return {
      ok: !!first?.ok,
      pid: first?.pid,
      task: first?.task || task.task,
      cwd: first?.cwd,
      logFile: first?.logFile,
      error: first?.error,
    };
  }

  return {
    ok: !!payload?.ok,
    pid: payload?.pid,
    task: task.task,
    cwd: payload?.cwd,
    logFile: payload?.logFile,
    error: payload?.error,
  };
}

export async function spawnAgents(opts: SpawnOpts): Promise<SpawnResult> {
  try {
    if (opts.tasks.length > 1) {
      const results = await Promise.all(opts.tasks.map((task) => spawnSingleLegacy(task, opts)));
      const spawned = results.filter((result) => result.ok).length;
      return {
        ok: spawned > 0,
        spawned,
        total: opts.tasks.length,
        results,
        message:
          spawned === opts.tasks.length
            ? `Spawned ${spawned}/${opts.tasks.length} agent${spawned === 1 ? '' : 's'}`
            : `Spawned ${spawned}/${opts.tasks.length} agents`,
      };
    }

    const res = await fetch(`${BRIDGE_URL}/spawn`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tasks: opts.tasks,
        useWorktree: opts.useWorktree ?? false,
        workdir: opts.workdir,
      }),
    });
    if (!res.ok) {
      const txt = await res.text();
      if (opts.tasks.length > 0 && isLegacyMissingTaskError(txt)) {
        const results = [];
        for (const task of opts.tasks) {
          results.push(await spawnSingleLegacy(task, opts));
        }
        const spawned = results.filter((result) => result.ok).length;
        return {
          ok: spawned > 0,
          spawned,
          total: opts.tasks.length,
          results,
          message:
            spawned === opts.tasks.length
              ? `Spawned ${spawned}/${opts.tasks.length} agent${spawned === 1 ? '' : 's'}`
              : `Spawned ${spawned}/${opts.tasks.length} agents (legacy bridge compatibility mode)`,
        };
      }
      return { ok: false, spawned: 0, total: opts.tasks.length, results: [], message: `Bridge error: ${txt.slice(0, 200)}` };
    }
    return await res.json();
  } catch (err: any) {
    return {
      ok: false,
      spawned: 0,
      total: opts.tasks.length,
      results: [],
      message: err?.message?.includes('fetch')
        ? 'Claude Code Bridge not running. Start it with: node scripts/claude-bridge.js'
        : (err?.message || 'Spawn failed'),
    };
  }
}

export async function spawnSingle(task: string, model?: string): Promise<SpawnResult> {
  return spawnAgents({ tasks: [{ task, model }] });
}

export async function spawnMultiple(task: string, count: number, opts?: { model?: string; useWorktree?: boolean }): Promise<SpawnResult> {
  const tasks: SpawnTask[] = [];
  for (let i = 0; i < count; i++) {
    tasks.push({ task: `${task} (agent ${i + 1}/${count})`, model: opts?.model });
  }
  return spawnAgents({ tasks, useWorktree: opts?.useWorktree });
}

export async function spawnFromMissionTasks(
  missionTasks: Array<{ title: string; description?: string }>,
  opts?: { model?: string; useWorktree?: boolean; contextPrefix?: string },
): Promise<SpawnResult> {
  const tasks: SpawnTask[] = missionTasks.map(t => ({
    task: [
      opts?.contextPrefix,
      `Task: ${t.title}`,
      t.description ? `Details: ${t.description}` : null,
      'Complete this task, commit your changes, and report back.',
    ].filter(Boolean).join('\n'),
    model: opts?.model,
  }));
  return spawnAgents({ tasks, useWorktree: opts?.useWorktree ?? true });
}

export async function isBridgeAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchSpawnedAgentStatus(opts: {
  pid?: string | null;
  logFile?: string | null;
  maxBytes?: number;
}): Promise<SpawnedAgentStatus> {
  try {
    const res = await fetch(`${BRIDGE_URL}/spawn/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pid: opts.pid || undefined,
        logFile: opts.logFile || undefined,
        maxBytes: opts.maxBytes,
      }),
      signal: AbortSignal.timeout(8000),
    });
    let payload: any = null;
    try {
      payload = await res.json();
    } catch {
      payload = null;
    }
    if (!res.ok) {
      return {
        ok: false,
        pid: opts.pid || null,
        logFile: opts.logFile || null,
        isRunning: false,
        completed: false,
        error: payload?.error || `HTTP ${res.status}`,
      };
    }
    return {
      ok: payload?.ok === true,
      pid: payload?.pid ?? opts.pid ?? null,
      logFile: payload?.logFile ?? opts.logFile ?? null,
      isRunning: !!payload?.isRunning,
      completed: !!payload?.completed,
      hasOutput: !!payload?.hasOutput,
      output: typeof payload?.output === 'string' ? payload.output : '',
      lastUpdatedAt: payload?.lastUpdatedAt ?? null,
      byteLength: Number(payload?.byteLength || 0),
      error: payload?.error,
    };
  } catch (err: any) {
    return {
      ok: false,
      pid: opts.pid || null,
      logFile: opts.logFile || null,
      isRunning: false,
      completed: false,
      error: err?.message || 'Failed to fetch spawn status',
    };
  }
}
