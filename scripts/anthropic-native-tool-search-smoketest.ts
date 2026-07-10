/**
 * anthropic-native-tool-search-smoketest — verifies the X2 (P46) pure module
 * `src/lib/anthropicNativeToolSearch.ts` (API-native deferred tool loading).
 *
 * Covers:
 *   - exact wire shapes for both search-tool variants (no beta header needed)
 *   - flag reader defaults OFF under node (no localStorage)
 *   - model support: documented list only; aliases/marketplace ids fail closed
 *   - decision thresholds (10+ tools; >10k estimated definition tokens)
 *   - payload invariants: search tool first + never deferred; pinned eager;
 *     others defer_loading:true; cache_control scrubbed from deferred only;
 *     catalog order preserved (byte-stable across rounds); excludeNames
 *     dropped; inputs never mutated; empty catalog → empty payload
 *
 * Run: npm run smoke:anthropic-native-tool-search
 */

import {
  ANTHROPIC_TOOL_SEARCH_REGEX_TOOL,
  ANTHROPIC_TOOL_SEARCH_BM25_TOOL,
  isNativeDeferredToolsEnabled,
  isNativeToolSearchSupportedModel,
  shouldUseNativeDeferredTools,
  buildNativeDeferredToolPayload,
  summarizeNativeDeferredToolPayload,
  type AnthropicToolDefinitionLike,
} from '../src/lib/anthropicNativeToolSearch';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Case 1: wire shapes ────────────────────────────────────────────────
  {
    assert(ANTHROPIC_TOOL_SEARCH_REGEX_TOOL.type === 'tool_search_tool_regex_20251119'
      && ANTHROPIC_TOOL_SEARCH_REGEX_TOOL.name === 'tool_search_tool_regex',
      'case1: regex search tool entry matches the documented wire shape');
    assert(ANTHROPIC_TOOL_SEARCH_BM25_TOOL.type === 'tool_search_tool_bm25_20251119'
      && ANTHROPIC_TOOL_SEARCH_BM25_TOOL.name === 'tool_search_tool_bm25',
      'case1: bm25 search tool entry matches the documented wire shape');
    assert(!('defer_loading' in ANTHROPIC_TOOL_SEARCH_REGEX_TOOL),
      'case1: search tool entry carries no defer_loading (never deferred)');
  }

  // ─── Case 2: flag defaults OFF ──────────────────────────────────────────
  {
    assert(isNativeDeferredToolsEnabled() === false,
      'case2: flag reader returns false under node (default OFF, fail closed)');
  }

  // ─── Case 3: model support — documented list, fail closed ───────────────
  {
    for (const supported of [
      'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
      'claude-opus-4-5-20251101', 'claude-sonnet-4-6', 'claude-sonnet-4-5-20250929',
      'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5',
    ]) {
      assert(isNativeToolSearchSupportedModel(supported), `case3: ${supported} supported`);
    }
    for (const unsupported of [
      'claude-opus-4-1', 'claude-3-5-sonnet-20241022', 'auto', 'blackswan',
      'deepseek/deepseek-reasoner', 'openrouter/auto', 'huggingface_endpoint/cswan801/BlackSwan-v5',
      '', null, undefined,
    ]) {
      assert(!isNativeToolSearchSupportedModel(unsupported as any),
        `case3: ${String(unsupported) || '(empty)'} NOT supported (fail closed)`);
    }
  }

  // ─── Case 4: decision thresholds ────────────────────────────────────────
  {
    assert(shouldUseNativeDeferredTools({ flagEnabled: false, toolCount: 200 }).reason === 'flag_off',
      'case4: flag off wins over everything');
    assert(shouldUseNativeDeferredTools({ flagEnabled: true, model: 'deepseek/deepseek-chat', toolCount: 200 }).reason === 'model_unsupported',
      'case4: unsupported model → no');
    const bigCatalog = shouldUseNativeDeferredTools({ flagEnabled: true, model: 'claude-haiku-4-5', toolCount: 157 });
    assert(bigCatalog.use && bigCatalog.reason === 'catalog_size',
      'case4: 157 tools → use (10+ threshold)');
    assert(shouldUseNativeDeferredTools({ flagEnabled: true, model: 'claude-sonnet-4-6', toolCount: 10 }).use,
      'case4: exactly 10 tools → use');
    const smallButFat = shouldUseNativeDeferredTools({
      flagEnabled: true, model: 'claude-sonnet-4-6', toolCount: 6, estimatedDefinitionChars: 50_000,
    });
    assert(smallButFat.use && smallButFat.reason === 'definition_tokens',
      'case4: 6 tools but >10k estimated tokens → use');
    assert(!shouldUseNativeDeferredTools({ flagEnabled: true, model: 'claude-sonnet-4-6', toolCount: 5, estimatedDefinitionChars: 2000 }).use,
      'case4: small lean catalog → standard tool calling');
    assert(shouldUseNativeDeferredTools({ flagEnabled: true, toolCount: 20 }).use,
      'case4: model omitted → caller owns the model gate, thresholds still apply');
  }

  // ─── Case 5: payload invariants ─────────────────────────────────────────
  {
    const catalog: AnthropicToolDefinitionLike[] = [
      { name: 'tasks.list', description: 'List tasks', input_schema: { type: 'object' } },
      { name: 'tools.search', description: 'Client-side tool search', input_schema: { type: 'object' } },
      { name: 'wp.update_post', description: 'Update a post', input_schema: { type: 'object' }, cache_control: { type: 'ephemeral' } },
      { name: 'memory.save', description: 'Save memory', input_schema: { type: 'object' } },
      { name: 'browser.plan_task', description: 'Plan browser task', input_schema: { type: 'object' } },
    ];
    const payload = buildNativeDeferredToolPayload(catalog, {
      pinnedNames: ['tasks.list', 'memory.save'],
      excludeNames: ['tools.search'],
    });

    assert(payload.tools[0].type === 'tool_search_tool_regex_20251119',
      'case5: search tool is FIRST (default regex variant)');
    assert(payload.tools.length === 5, 'case5: search + 2 pinned + 2 deferred (tools.search excluded)',
      `got ${payload.tools.length}`);
    assert(payload.pinnedCount === 2 && payload.deferredCount === 2 && payload.excludedCount === 1,
      'case5: counts match');

    const names = payload.tools.map((t) => t.name);
    assert(names.join(',') === 'tool_search_tool_regex,tasks.list,memory.save,wp.update_post,browser.plan_task',
      'case5: pinned group precedes deferred group, catalog order preserved within groups');

    const pinnedTool = payload.tools.find((t) => t.name === 'tasks.list')!;
    assert(!('defer_loading' in pinnedTool), 'case5: pinned tool has NO defer_loading field');
    const deferredTool = payload.tools.find((t) => t.name === 'wp.update_post')!;
    assert(deferredTool.defer_loading === true, 'case5: non-pinned tool gets defer_loading:true');
    assert(!('cache_control' in deferredTool),
      'case5: cache_control SCRUBBED from deferred tool (API 400 guard)');
    assert(!names.includes('tools.search'),
      'case5: client-side tools.search excluded (native search replaces it)');

    // Byte-stability: same catalog in → identical payload out.
    const again = buildNativeDeferredToolPayload(catalog, {
      pinnedNames: ['tasks.list', 'memory.save'],
      excludeNames: ['tools.search'],
    });
    assert(JSON.stringify(again.tools) === JSON.stringify(payload.tools),
      'case5: payload is deterministic across rounds (cache contract)');

    // Non-mutation of inputs.
    assert(!('defer_loading' in catalog[4]), 'case5: input catalog never mutated');
    assert('cache_control' in catalog[2], 'case5: input cache_control untouched');

    // Variant selection.
    const bm25 = buildNativeDeferredToolPayload(catalog, { pinnedNames: [], variant: 'bm25' });
    assert(bm25.tools[0].type === 'tool_search_tool_bm25_20251119' && bm25.variant === 'bm25',
      'case5: bm25 variant selectable');

    // All-deferred is VALID per the doc (search tool itself is the non-deferred one).
    assert(bm25.pinnedCount === 0 && bm25.deferredCount === 5,
      'case5: empty pinned set defers the whole catalog (search tool stays eager)');

    // Degenerate input.
    const empty = buildNativeDeferredToolPayload([], { pinnedNames: [] });
    assert(empty.tools.length === 0, 'case5: empty catalog → empty payload (caller falls back)');
    const junk = buildNativeDeferredToolPayload([{ name: '' } as any, null as any], { pinnedNames: [] });
    assert(junk.tools.length === 0, 'case5: nameless/null defs dropped');

    const summary = summarizeNativeDeferredToolPayload(payload);
    assert(summary.total === 5 && summary.pinned === 2 && summary.deferred === 2
      && summary.excluded === 1 && summary.variant === 'regex',
      'case5: telemetry summary is counts-only');
  }

  console.log(failures === 0 ? '\nanthropic-native-tool-search smoke: ALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
