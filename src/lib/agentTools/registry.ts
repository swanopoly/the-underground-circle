/**
 * agentTools/registry — singleton tool registry for AgentExecutionCore.
 *
 * Mirrors Hermes' `tools/registry.py` pattern:
 *   - Tools self-register at module import time via `registerTool(...)`.
 *   - Dispatch goes through the registry, which enforces the
 *     `{ok, data} | {ok: false, error}` return envelope — tools that throw
 *     are caught and converted.
 *   - `getAvailableTools()` returns the array the provider advertises to
 *     the model (JSON schema + description).
 *
 * Import side-effects: any file that calls `registerTool()` at module scope
 * must be imported somewhere for its registration to take effect. See
 * `agentTools/index.ts` for the canonical import list.
 */

import type { AgentToolDefinition, AgentToolContext, AgentToolResult } from '../agentExecutionCore';

type ToolOptions = {
  /** Optional allowlist of sessions that may see this tool. Defaults to all. */
  visibleIn?: (session: Record<string, unknown>) => boolean;
};

type RegisteredTool = {
  def: AgentToolDefinition;
  options: ToolOptions;
};

const registry = new Map<string, RegisteredTool>();

export function registerTool(def: AgentToolDefinition, options: ToolOptions = {}) {
  if (registry.has(def.name)) {
    // Last write wins — but warn. Duplicate registrations usually mean a
    // circular import or a copy-paste bug.
    console.warn(`[agentTools] Tool "${def.name}" registered twice; using the latest.`);
  }
  // Defensive wrap: ensure the handler ALWAYS returns the JSON envelope,
  // even if the tool author forgot. This is the equivalent of Hermes'
  // `registry.dispatch` try/except — prevents a throw from killing the
  // entire agent loop.
  const safeHandler = async (input: unknown, ctx: AgentToolContext): Promise<AgentToolResult> => {
    try {
      const result = await def.handler(input, ctx);
      if (result && typeof result === 'object' && 'ok' in result) return result;
      return { ok: false, error: `Tool "${def.name}" returned a malformed response.` };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Tool "${def.name}" threw: ${message}` };
    }
  };
  registry.set(def.name, { def: { ...def, handler: safeHandler }, options });
}

export function unregisterTool(name: string) {
  registry.delete(name);
}

/**
 * Tools visible in the given session. Filter function gives scope-based
 * control (e.g. omit write-memory tools from an unauthenticated preview).
 */
export function getAvailableTools(session: Record<string, unknown> = {}): AgentToolDefinition[] {
  const out: AgentToolDefinition[] = [];
  for (const { def, options } of registry.values()) {
    if (options.visibleIn && !options.visibleIn(session)) continue;
    out.push(def);
  }
  return out;
}

export function getTool(name: string): AgentToolDefinition | undefined {
  return registry.get(name)?.def;
}

export function listToolNames(): string[] {
  return Array.from(registry.keys()).sort();
}

/** Test / hot-reload escape hatch. Drops all registrations. */
export function _resetRegistry() {
  registry.clear();
}
