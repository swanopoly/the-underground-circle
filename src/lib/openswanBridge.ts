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
 * O2 (2026-06): the legacy `src/lib/agentTools/` registry was retired — its
 * unique tools (skills.view / skills.manage / user_memory.manage /
 * messages.search) now live in the `openswanToolRuntime` catalog, so this
 * bridge is the single tool path for `runAgent` callers.
 *
 * What this DOESN'T do:
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
  listPinnedOpenSwanToolsForSurface,
  executeOpenSwanRuntimeTool,
  formatOpenSwanRuntimeToolResult,
  getOpenSwanToolParallelPolicy,
  type OpenSwanRuntimeToolContext,
  type OpenSwanRuntimeToolName,
  type OpenSwanToolCatalogMatch,
  type OpenSwanToolSurface,
} from './openswanToolRuntime';
import type { AgentToolDefinition } from './agentExecutionCore';
import type { ToolParallelPolicy } from './toolBatchParallelism';

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
    /**
     * Chat mode ('plan' | 'build' | 'review' | …). Forwarded to the
     * catalog's mode filter so tools that declare a `modes` allowlist only
     * appear in those modes — same semantics as the legacy loop's
     * `getToolDefinitions(allowed, surface, mode)` (O1 parity). Omit to
     * keep existing behavior (no mode filtering).
     */
    mode?: string | null;
  },
): AgentToolDefinition[] {
  const catalog = listOpenSwanAnthropicToolsForSurface(surface, opts?.allowedToolNames, opts?.mode);
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
 * Progressive-disclosure variant (T2) — OPT-IN, ships dark. Instead of
 * advertising the full ~157-tool catalog (~15–20k tokens/turn, measurably
 * worse tool selection — docs/TOOLTREE_DESKTOP_RESEARCH §2.2), this returns:
 *
 *   - `tools`: the pinned high-frequency core for the surface plus
 *     `tools.search`, shaped exactly like `getOpenSwanToolsForSurface`
 *     output (same dispatcher, policy, and approval path).
 *   - `resolveAdditionalTools`: drop into `runAgent({ resolveAdditionalTools })`.
 *     Each `tools.search` call records its matched deferred tools in a
 *     per-call closure; at every subsequent turn start the resolver returns
 *     full `AgentToolDefinition`s for everything unlocked so far, which the
 *     core merges additively (never removes the pinned set).
 *
 * `getOpenSwanToolsForSurface` above is untouched and remains the default
 * full-catalog path — flipping a caller to progressive is an explicit,
 * separate change.
 */
export function getProgressiveOpenSwanTools(
  surface: OpenSwanToolSurface,
  ctx: OpenSwanRuntimeToolContext,
  opts?: {
    /** Same semantics as `getOpenSwanToolsForSurface`. Default true. */
    includeFormattedText?: boolean;
  },
): {
  tools: AgentToolDefinition[];
  resolveAdditionalTools: (resolveCtx: { session: Record<string, unknown>; iteration: number }) => AgentToolDefinition[];
} {
  // tools.search needs the surface to scope its matches; make sure the
  // runtime context carries it even if the caller forgot.
  const runtimeCtx: OpenSwanRuntimeToolContext = { ...ctx, surface: ctx.surface || surface };

  const pinnedNames = listPinnedOpenSwanToolsForSurface(surface).map((t) => t.name);
  if (!pinnedNames.includes('tools.search')) pinnedNames.push('tools.search');
  const pinned = new Set<OpenSwanRuntimeToolName>(pinnedNames);

  const tools = getOpenSwanToolsForSurface(surface, runtimeCtx, {
    allowedToolNames: pinnedNames,
    includeFormattedText: opts?.includeFormattedText,
  });

  // Deferred tools the model has unlocked via tools.search during THIS run.
  const unlocked = new Set<OpenSwanRuntimeToolName>();

  const searchTool = tools.find((t) => t.name === 'tools.search');
  if (searchTool) {
    const innerHandler = searchTool.handler;
    searchTool.handler = async (input, toolCtx) => {
      const result = await innerHandler(input, toolCtx);
      try {
        if (result.ok) {
          const raw = (result.data as { raw?: { matches?: OpenSwanToolCatalogMatch[] } }).raw;
          for (const match of raw?.matches || []) {
            if (match?.name && !pinned.has(match.name)) unlocked.add(match.name);
          }
        }
      } catch { /* recording failures must never break the search result */ }
      return result;
    };
  }

  return {
    tools,
    resolveAdditionalTools: () => {
      if (unlocked.size === 0) return [];
      // Re-shape through the same bridge path so policy + approval + surface
      // filtering stay intact; runAgent merges by name (additions only).
      return getOpenSwanToolsForSurface(surface, runtimeCtx, {
        allowedToolNames: [...unlocked],
        includeFormattedText: opts?.includeFormattedText,
      });
    },
  };
}

/**
 * Dependency-aware parallelism provider (T8/O6) — drop straight into
 * `runAgent({ toolParallelPolicyProvider: createOpenSwanToolParallelPolicyProvider() })`.
 * Maps each tool name to its catalog `ToolParallelPolicy` (approval mode,
 * mutation/side-effect flags, coarse `mutationTargets`/`readsFrom` domains)
 * so the core can partition a round into safe parallel groups. Returns
 * `null` on lookup failure, which the core treats as an unsafe sequential
 * barrier — fail closed. Not wired into any call site yet (O1 owns that).
 */
export function createOpenSwanToolParallelPolicyProvider(
  opts?: { activePluginIds?: string[] },
): (toolName: string) => ToolParallelPolicy | null {
  return (toolName: string) => {
    try {
      return getOpenSwanToolParallelPolicy(toolName, opts?.activePluginIds);
    } catch {
      return null;
    }
  };
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
