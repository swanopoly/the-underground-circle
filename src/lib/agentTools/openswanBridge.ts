/**
 * openswanBridge — the adapter that unifies the two parallel agent stacks.
 *
 * - `agentExecutionCore` (Claude Code) owns the typed tool-use loop:
 *   provider-agnostic, event-streaming, testable with a mock.
 * - `openswanToolRuntime` (Codex) owns the tool catalog: ~30 typed tools
 *   with per-surface visibility, approval policies, side-effect metadata.
 *
 * This file bridges the two. `getOpenSwanToolsForSurface(surface, ctx)`
 * returns the tool list shaped as `AgentToolDefinition[]` — drop it
 * straight into `runAgent({ tools })` and every tool routes through
 * Codex's dispatcher with policy + approval enforcement intact.
 *
 * This is what `docs/AGENTS_ROADMAP.md` §4 calls the Phase 1c adapter.
 *
 * What this DOESN'T do:
 *   - Register tools with our local `agentTools/registry.ts`. The OpenSwan
 *     catalog is separate on purpose — it's surface/context-scoped, while
 *     the local registry is global. Callers decide which to use.
 *   - Run approval flows. `executeOpenSwanRuntimeTool` already triggers
 *     `maybeRequestToolApproval` internally when the tool's policy says
 *     `approvalMode: 'ask'`; the bridge just surfaces the returned result
 *     (which may include `approvalRequest`) as `{ok: true, data: ...}`.
 *   - Format tool results for the user. `formatOpenSwanRuntimeToolResult`
 *     gives us a human-readable string which we stash in `data.text` —
 *     consumers can use that for display, or the raw `data.raw` for
 *     structured follow-up.
 */

import {
  listOpenSwanAnthropicToolsForSurface,
  executeOpenSwanRuntimeTool,
  formatOpenSwanRuntimeToolResult,
  type OpenSwanRuntimeToolContext,
  type OpenSwanRuntimeToolName,
  type OpenSwanToolSurface,
} from '../openswanToolRuntime';
import type { AgentToolDefinition } from '../agentExecutionCore';

/**
 * Returns OpenSwan tools (for the given surface) as AgentToolDefinition[],
 * suitable for `runAgent({ tools })`. Handlers route every call through
 * Codex's typed dispatcher, preserving approval policy + metadata.
 */
export function getOpenSwanToolsForSurface(
  surface: OpenSwanToolSurface,
  ctx: OpenSwanRuntimeToolContext,
  opts?: {
    /** If provided, only expose these tool names to the model. */
    allowedToolNames?: OpenSwanRuntimeToolName[];
    /**
     * If true, append the human-readable formatted result into
     * `data.text` alongside the structured `data.raw`. Default true —
     * the model reads `data.text` far better than raw JSON for most tools.
     */
    includeFormattedText?: boolean;
  },
): AgentToolDefinition[] {
  const catalog = listOpenSwanAnthropicToolsForSurface(surface, opts?.allowedToolNames);
  const includeFormatted = opts?.includeFormattedText !== false;

  return catalog.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema as Record<string, unknown>,
    handler: async (input) => {
      try {
        const result = await executeOpenSwanRuntimeTool(
          tool.name as OpenSwanRuntimeToolName,
          input as any,
          ctx,
        );
        const data: Record<string, unknown> = { raw: result };
        if (includeFormatted) {
          try {
            data.text = formatOpenSwanRuntimeToolResult(tool.name as OpenSwanRuntimeToolName, result as any);
          } catch {
            // Formatter failures are non-fatal — raw is enough to recover.
          }
        }
        return { ok: true, data };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  }));
}

/**
 * Convenience — a single-tool variant for when a caller already knows
 * exactly which tool they want. Mostly useful in tests or for forced
 * dispatch from a slash-command handler. Runtime code should prefer
 * `getOpenSwanToolsForSurface` so the model sees the whole palette.
 */
export function getOpenSwanTool(
  name: OpenSwanRuntimeToolName,
  surface: OpenSwanToolSurface,
  ctx: OpenSwanRuntimeToolContext,
): AgentToolDefinition | undefined {
  const all = getOpenSwanToolsForSurface(surface, ctx, { allowedToolNames: [name] });
  return all.find((t) => t.name === name);
}
