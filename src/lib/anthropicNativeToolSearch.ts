/**
 * anthropicNativeToolSearch — X2 (P46): API-native deferred tool loading via
 * Anthropic's Tool Search Tool.
 *
 * Why: P25 ships progressive disclosure CLIENT-side (pinned core +
 * `tools.search` unlock), but its tool-APPEND on unlock rounds busts the
 * tools cache tier (the P26 honest limit — render order tools→system→
 * messages means a changed tools array invalidates everything). Anthropic's
 * native mechanism sends the FULL catalog every round with
 * `defer_loading: true` on non-pinned tools; the API excludes deferred
 * definitions from the context prefix server-side and expands them on
 * discovery via appended `tool_reference` blocks — the prefix never changes,
 * so the cache is preserved BY DESIGN. Anthropic-measured: ~85% token cut on
 * large catalogs, tool-selection accuracy 49%→74% (Opus 4). Our catalog is
 * ~157 tools — 3-5× past the documented 30-50 degradation threshold.
 *
 * Wire facts (verified against the tool-search-tool doc, fetched 2026-07-09):
 *   - Tool entry: `{type:'tool_search_tool_regex_20251119', name:'tool_search_tool_regex'}`
 *     (or the `bm25` variant). GA — NO beta header.
 *   - Every tool's FULL definition is sent on every request, deferred ones
 *     included (the API needs them server-side to search + expand).
 *   - Never defer the search tool itself; at least one tool must stay
 *     non-deferred or the API 400s ("All tools cannot be deferred").
 *   - A deferred tool must NOT carry `cache_control` (400) — scrubbed here.
 *   - Search results arrive as `server_tool_use` + `tool_search_tool_result`
 *     blocks; NEVER return a tool_result for a `srvtoolu_...` id; pass both
 *     blocks back unchanged on later rounds (the loop's verbatim history
 *     handling already does this). Discovered tools arrive as ordinary
 *     `tool_use` calls — the client dispatcher needs no changes.
 *   - Keep the 3-5 hottest tools non-deferred (our pinned core).
 *   - Supported models (documented list): Fable/Mythos 5, Opus 4.5-4.8,
 *     Sonnet 4.5/4.6, Haiku 4.5. Opus 4.1 and earlier are NOT supported.
 *
 * FLAG-DARK: `isNativeDeferredToolsEnabled()` defaults OFF
 * (localStorage['uc_native_deferred_tools']==='1' opts in). The swanbot-ai
 * relay forwards `tools` verbatim (relayBody.tools = body.tools) with no
 * tools-tier cache_control, so no edge change is needed for the flip — the
 * flip gate is a live-run measurement (cache_read ratio + tool-selection
 * behavior), recorded in the plan doc.
 *
 * Pure by construction: no imports, guarded localStorage read only,
 * non-mutating, bounded, never throws.
 */

// ─── Tool entries ───────────────────────────────────────────────────────────

export const ANTHROPIC_TOOL_SEARCH_REGEX_TOOL = Object.freeze({
  type: 'tool_search_tool_regex_20251119',
  name: 'tool_search_tool_regex',
});

export const ANTHROPIC_TOOL_SEARCH_BM25_TOOL = Object.freeze({
  type: 'tool_search_tool_bm25_20251119',
  name: 'tool_search_tool_bm25',
});

export type NativeToolSearchVariant = 'regex' | 'bm25';

/** Anthropic custom-tool shape as our relay sends it (extra fields ride along). */
export interface AnthropicToolDefinitionLike {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  [key: string]: unknown;
}

// ─── Flag (default OFF) ─────────────────────────────────────────────────────

export const NATIVE_DEFERRED_TOOLS_FLAG = 'uc_native_deferred_tools';

/** DEFAULT OFF — explicit '1' opts a device in. Safe under tsx/node (no localStorage → false). */
export function isNativeDeferredToolsEnabled(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(NATIVE_DEFERRED_TOOLS_FLAG) === '1';
  } catch {
    return false;
  }
}

// ─── Model support (documented list; unknown → false, fail closed) ─────────

const SUPPORTED_MODEL_PATTERNS: ReadonlyArray<RegExp> = [
  /^claude-fable-5/,
  /^claude-mythos-5/,
  /^claude-opus-4-[5-8]/,
  /^claude-sonnet-4-[5-6]/,
  /^claude-sonnet-5/,
  /^claude-haiku-4-5/,
];

/**
 * True only for models on the documented tool-search compatibility list.
 * Marketplace/provider-prefixed ids (`deepseek/...`, `openrouter/...`),
 * aliases (`auto`, `blackswan`), and older Claude models all return false —
 * the caller keeps the legacy client-side progressive palette.
 */
export function isNativeToolSearchSupportedModel(model: string | null | undefined): boolean {
  if (!model || typeof model !== 'string') return false;
  return SUPPORTED_MODEL_PATTERNS.some((pattern) => pattern.test(model));
}

// ─── Decision (documented thresholds) ───────────────────────────────────────

export interface NativeDeferredToolsDecision {
  use: boolean;
  reason:
    | 'flag_off'
    | 'model_unsupported'
    | 'below_threshold'
    | 'catalog_size'
    | 'definition_tokens';
}

/**
 * Anthropic's documented guidance: use tool search at 10+ tools or >10k
 * tokens of definitions; below that, standard tool calling wins. Token
 * estimate uses the chars/4 heuristic on the serialized definitions.
 */
export function shouldUseNativeDeferredTools(input: {
  flagEnabled: boolean;
  model?: string | null;
  toolCount: number;
  estimatedDefinitionChars?: number;
}): NativeDeferredToolsDecision {
  if (!input.flagEnabled) return { use: false, reason: 'flag_off' };
  if (input.model !== undefined && !isNativeToolSearchSupportedModel(input.model)) {
    return { use: false, reason: 'model_unsupported' };
  }
  if (input.toolCount >= 10) return { use: true, reason: 'catalog_size' };
  const estimatedTokens = (input.estimatedDefinitionChars ?? 0) / 4;
  if (estimatedTokens > 10_000) return { use: true, reason: 'definition_tokens' };
  return { use: false, reason: 'below_threshold' };
}

// ─── Payload builder ────────────────────────────────────────────────────────

export interface NativeDeferredToolPayload {
  /** The exact `tools` array for the request: search tool first, then pinned
   *  (non-deferred), then the deferred remainder — stable order per round. */
  tools: Array<Record<string, unknown>>;
  pinnedCount: number;
  deferredCount: number;
  /** Names excluded entirely (e.g. the client-side `tools.search`, redundant
   *  next to the native search tool). */
  excludedCount: number;
  variant: NativeToolSearchVariant;
}

/**
 * Build the native-deferred `tools` payload from the full catalog.
 *
 * Invariants (each smoke-pinned):
 *   - The search tool is FIRST and never deferred.
 *   - `pinnedNames` members keep loading eagerly (no defer_loading field);
 *     everything else gets `defer_loading: true`.
 *   - Within the pinned and deferred groups, catalog order is preserved —
 *     the same catalog in produces byte-identical payloads across rounds
 *     (the cache contract).
 *   - `cache_control` is scrubbed from deferred definitions (API 400) and
 *     left alone on pinned ones.
 *   - `excludeNames` entries are dropped entirely (used for the client-side
 *     `tools.search`, which the native search tool replaces).
 *   - Inputs are never mutated (shallow copies).
 *   - Degenerate input (empty catalog) returns an empty tools array — the
 *     caller must fall back to the legacy palette, never send search-only.
 */
export function buildNativeDeferredToolPayload(
  catalog: ReadonlyArray<AnthropicToolDefinitionLike>,
  opts: {
    pinnedNames: ReadonlyArray<string>;
    excludeNames?: ReadonlyArray<string>;
    variant?: NativeToolSearchVariant;
  },
): NativeDeferredToolPayload {
  const variant: NativeToolSearchVariant = opts.variant === 'bm25' ? 'bm25' : 'regex';
  const searchTool = variant === 'bm25' ? ANTHROPIC_TOOL_SEARCH_BM25_TOOL : ANTHROPIC_TOOL_SEARCH_REGEX_TOOL;
  const pinnedSet = new Set(opts.pinnedNames);
  const excludeSet = new Set(opts.excludeNames ?? []);

  const pinned: Array<Record<string, unknown>> = [];
  const deferred: Array<Record<string, unknown>> = [];
  let excludedCount = 0;

  for (const def of catalog) {
    if (!def || typeof def.name !== 'string' || !def.name) continue;
    if (excludeSet.has(def.name)) {
      excludedCount += 1;
      continue;
    }
    if (pinnedSet.has(def.name)) {
      pinned.push({ ...def });
    } else {
      const copy: Record<string, unknown> = { ...def, defer_loading: true };
      // A deferred tool must not carry cache_control (API 400) — breakpoints
      // belong on non-deferred entries only.
      delete copy.cache_control;
      deferred.push(copy);
    }
  }

  if (pinned.length + deferred.length === 0) {
    return { tools: [], pinnedCount: 0, deferredCount: 0, excludedCount, variant };
  }

  return {
    tools: [{ ...searchTool }, ...pinned, ...deferred],
    pinnedCount: pinned.length,
    deferredCount: deferred.length,
    excludedCount,
    variant,
  };
}

/** Compact telemetry shape (bounded — counts only, never definitions). */
export function summarizeNativeDeferredToolPayload(payload: NativeDeferredToolPayload): {
  total: number;
  pinned: number;
  deferred: number;
  excluded: number;
  variant: NativeToolSearchVariant;
} {
  return {
    total: payload.tools.length,
    pinned: payload.pinnedCount,
    deferred: payload.deferredCount,
    excluded: payload.excludedCount,
    variant: payload.variant,
  };
}
