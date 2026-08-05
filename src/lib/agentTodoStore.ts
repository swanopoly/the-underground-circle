/**
 * agentTodoStore — run-scoped storage for the P6 live TODO tool (`todo.write`).
 * The pure list semantics (validation, single-in_progress, caps, rendering)
 * live in `agentTodoCore.ts`; this module only owns WHERE a run's list lives.
 *
 * Keys are derived from the tool context (runId when present, else
 * userId+threadId) so the same key works across every lane that dispatches
 * catalog tools — the typed loop, the legacy swanbot loop, and the v2 client
 * dispatcher — without threading new state through any of them. In-memory
 * only and deliberately ephemeral: a live TODO is run-scaffolding, not app
 * state (nothing is persisted; a reload simply starts blank). A small LRU cap
 * keeps long sessions from accumulating dead runs.
 */

import type { AgentTodoItem } from './agentTodoCore';

const MAX_TRACKED_RUNS = 50;

const store = new Map<string, AgentTodoItem[]>();

/** Stable per-run key from the runtime tool context. */
export function agentTodoKey(ctx: {
  runId?: string;
  userId?: string;
  threadId?: string;
}): string {
  if (ctx.runId) return `run:${ctx.runId}`;
  return `live:${ctx.userId || 'anon'}:${ctx.threadId || 'default'}`;
}

export function getAgentTodos(key: string): AgentTodoItem[] {
  return store.get(key) || [];
}

export function setAgentTodos(key: string, todos: AgentTodoItem[]): void {
  // Refresh LRU position, then evict the oldest entries past the cap.
  store.delete(key);
  store.set(key, todos);
  while (store.size > MAX_TRACKED_RUNS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function clearAgentTodos(key: string): void {
  store.delete(key);
}
