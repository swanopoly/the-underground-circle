/**
 * model-catalog-smoketest — pins current chat model catalog and routing
 * invariants so picker entries do not become runtime dead ends.
 *
 * Run: npm run smoke:model-catalog
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findAliasKey, resolveProviderRoutes } from '../src/lib/crossProviderRouter';
import { isMarketplaceRoutedModel } from '../src/lib/blackswanRouting';
import { getModelFailoverChain, resolveModelForSoul } from '../src/lib/serviceProfileSouls';
import { resolveModelRate } from '../src/lib/modelPricing';

let failures = 0;
const root = process.cwd();
// llmProviders / modelCapabilities pull react-native (hooks, supabase) in
// transitively, so they are not tsx-importable — we parse their source the
// same way the rest of this file already does. modelPricing /
// serviceProfileSouls are dependency-light and imported above.
const llmProvidersSource = readFileSync(join(root, 'src/lib/llmProviders.ts'), 'utf8');
const modelCapabilitiesSource = readFileSync(join(root, 'src/lib/modelCapabilities.ts'), 'utf8');
const serviceProfileSoulsSource = readFileSync(join(root, 'src/lib/serviceProfileSouls.ts'), 'utf8');
const chatTabSource = readFileSync(join(root, 'src/screens/circles/tabs/ChatTab.tsx'), 'utf8');

function fail(message: string, detail?: unknown) {
  failures += 1;
  console.error('FAIL:', message);
  if (detail !== undefined) console.error('  detail:', JSON.stringify(detail));
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: unknown) {
  if (condition) pass(message);
  else fail(message, detail);
}

function ids(provider: string): string[] {
  const escaped = provider.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = llmProvidersSource.match(new RegExp(`\\n\\s*${escaped}: \\[([\\s\\S]*?)\\n\\s*\\],`));
  return match?.[1].match(/id:\s*'([^']+)'/g)?.map((entry) => entry.match(/'([^']+)'/)?.[1]).filter(Boolean) as string[] || [];
}

function capabilityRow(modelId: string): string {
  const escaped = modelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = modelCapabilitiesSource.match(new RegExp(`'${escaped}':\\s*\\[([^\\]]*)\\]`));
  return match?.[1] || '';
}

function hasCapability(modelId: string, capability: string): boolean {
  return capabilityRow(modelId).includes(`'${capability}'`);
}

// ─── selectable == wired helpers ─────────────────────────────────────────────
// These enforce the invariant that a picker-selectable model id is actually
// wired end-to-end (catalog row + capability row + pricing row) so the chat
// catalog cannot silently re-drift into runtime dead ends.

const ALL_PROVIDERS = [
  'openai', 'openai_compatible', 'anthropic', 'openrouter', 'groq', 'ollama',
  'replicate', 'github-models', 'huggingface', 'zai', 'minimax', 'google_ai',
  'mistral_ai', 'cohere', 'perplexity', 'together_ai', 'fireworks_ai', 'deepseek',
];

/** Every model id across every PROVIDER_MODELS provider (catalog ids). */
function allProviderModelIds(): string[] {
  return ALL_PROVIDERS.flatMap((provider) => ids(provider));
}

/** True when modelCapabilities.ts has an EXACT-id-keyed row for this model. */
function hasCapabilityRow(modelId: string): boolean {
  return capabilityRow(modelId) !== '';
}

/** True when modelPricing.ts resolves this id to a real (non-default) rate
 *  through the SAME path the runtime uses: resolveModelRate does dot->dash
 *  normalization + provider-prefix strip + longest-substring family match.
 *  Note this is family-level (e.g. `claude-opus-4-x` matches the `claude-opus-4`
 *  rate), not exact-key — pairing it with the exact-id-keyed capability check
 *  below is what makes a renamed/typo'd frontier id fail the wired assertion. */
function hasPricingRow(modelId: string): boolean {
  return resolveModelRate(modelId).label !== 'Unknown Model';
}

/** Strip an OpenRouter/provider vendor prefix and any `:variant` suffix so a
 *  mirror id like `openai/gpt-5.5` or `meta-llama/...:nitro` reduces to the
 *  bare model id used to key modelCapabilities. */
function bareModelId(modelId: string): string {
  return modelId.replace(/^[a-zA-Z0-9_.-]+\//, '').replace(/:.*$/, '');
}

/** True when a (possibly provider-prefixed) model id maps back to a
 *  PROVIDER_MODELS catalog entry — either a bare id under some provider, a
 *  native claude id, or a valid `openrouter/<vendor>/<model>` mirror. */
function resolvesInProviderModels(modelId: string): boolean {
  const slash = modelId.indexOf('/');
  if (slash <= 0) {
    if (/^claude-/.test(modelId)) {
      // Allow dated aliases (claude-haiku-4-5-20251001) of a canonical id.
      const base = modelId.replace(/-\d{8}$/, '');
      return ids('anthropic').includes(modelId) || ids('anthropic').includes(base);
    }
    return ALL_PROVIDERS.some((provider) => ids(provider).includes(modelId));
  }
  const head = modelId.slice(0, slash);
  const rest = modelId.slice(slash + 1);
  // An openrouter/-prefixed id is an accepted mirror by design.
  if (head === 'openrouter') return true;
  if (ALL_PROVIDERS.includes(head)) return ids(head).includes(rest);
  return false;
}

/** Pull the inlined POPULAR_OPENROUTER_MODELS ids out of ChatTab.tsx source
 *  (the list is a module-local const, not exported, so we can't import it). */
function popularOpenRouterIds(): string[] {
  const block = chatTabSource.match(
    /const POPULAR_OPENROUTER_MODELS:[\s\S]*?\n\];/,
  )?.[0] || '';
  return (block.match(/id:\s*'([^']+)'/g) || [])
    .map((entry) => entry.match(/'([^']+)'/)?.[1])
    .filter(Boolean) as string[];
}

/** Every model-id literal referenced by a serviceProfileSouls Auto ladder
 *  (the `['provider', 'provider/model']` tuples). */
function serviceSoulLadderIds(): string[] {
  const out = new Set<string>();
  const tupleRe = /\[\s*'[^']+'\s*,\s*'([^']+)'\s*\]/g;
  let m: RegExpExecArray | null;
  while ((m = tupleRe.exec(serviceProfileSoulsSource))) out.add(m[1]);
  return [...out];
}

/** Keys of the MODEL_FAILOVER map (the primary models that have a chain).
 *  We read the keys from source, then walk each chain via the imported
 *  getModelFailoverChain so both the seed and every fallback are covered. */
function modelFailoverIds(): string[] {
  const block = serviceProfileSoulsSource.match(/const MODEL_FAILOVER[\s\S]*?\n\};/)?.[0] || '';
  const keys = (block.match(/^\s*(?:'([^']+)'|\[([^\]]+)\]):/gm) || [])
    .map((line) => line.match(/'([^']+)'/)?.[1])
    .filter(Boolean) as string[];
  const out = new Set<string>(keys);
  for (const key of keys) {
    for (const fallback of getModelFailoverChain(key)) out.add(fallback);
  }
  return [...out];
}

// Deprecated model ids that must never reappear in a picker catalog, and the
// banned xAI/Grok family (project decision: no Grok / no xAI anywhere).
const DEPRECATED_MODEL_IDS = ['o3', 'o4-mini', 'o3-mini', 'mixtral-8x7b-32768'];
const GROK_XAI_PATTERNS = ['grok', 'x-ai', 'xai'];

// Ladder ids intentionally allowed to be unresolved in PROVIDER_MODELS.
// Empty: the deprecated `openai/o3` directReasoner rung was removed, so the
// ladder-resolution guard is now strict (any unresolved rung hard-fails).
const KNOWN_UNRESOLVED_LADDER_IDS = new Set<string>([]);

function main() {
  assert(ids('openai')[0] === 'gpt-5.5', 'OpenAI catalog starts with GPT-5.5 for newest default picks', ids('openai').slice(0, 5));
  assert(ids('openai').includes('gpt-5.5-pro'), 'OpenAI catalog includes GPT-5.5 Pro for explicit hardest-work picks');
  assert(ids('openai').includes('gpt-5.4-mini'), 'OpenAI catalog includes GPT-5.4 Mini for subagents/computer-use');

  assert(ids('anthropic').includes('claude-fable-5'), 'Anthropic catalog includes Claude Fable 5');
  assert(ids('anthropic').includes('claude-opus-4-8'), 'Anthropic catalog includes Claude Opus 4.8');
  assert(ids('anthropic').includes('claude-sonnet-4-6'), 'Anthropic catalog keeps Claude Sonnet 4.6');

  assert(ids('google_ai').includes('gemini-3.5-flash'), 'Google AI catalog includes Gemini 3.5 Flash');
  assert(ids('google_ai').includes('gemini-3.1-flash-lite'), 'Google AI catalog includes Gemini 3.1 Flash-Lite');
  assert(ids('google_ai').includes('gemini-2.5-flash-lite'), 'Google AI catalog includes Gemini 2.5 Flash-Lite fallback');

  assert(ids('perplexity').includes('sonar-deep-research'), 'Perplexity catalog includes Sonar Deep Research');
  assert(ids('perplexity').includes('sonar-reasoning-pro'), 'Perplexity catalog includes Sonar Reasoning Pro');

  const complexBuildModel = resolveModelForSoul(
    'sr-engineer',
    'auto',
    'build',
    'complex',
    false,
    false,
    new Set(['openai']),
  );
  assert(complexBuildModel === 'openai/gpt-5.5', 'Auto complex build routes to GPT-5.5 when OpenAI is connected', complexBuildModel);

  assert(findAliasKey('gpt-5.5') === 'gpt-5.5', 'Cross-provider aliases know GPT-5.5');
  assert(findAliasKey('claude-opus-4-8') === 'claude-opus-4-8', 'Cross-provider aliases know Claude Opus 4.8');
  assert(findAliasKey('sonar-deep-research') === 'sonar-deep-research', 'Cross-provider aliases know Sonar Deep Research');

  const gptRoutes = resolveProviderRoutes('gpt-5.5', { available: new Set(['openai', 'openrouter']) });
  assert(gptRoutes.some((route) => route.provider === 'openai' && route.modelId === 'gpt-5.5'), 'GPT-5.5 has direct OpenAI route', gptRoutes);
  assert(gptRoutes.some((route) => route.provider === 'openrouter' && route.modelId === 'openai/gpt-5.5'), 'GPT-5.5 has OpenRouter fallback route', gptRoutes);

  assert(hasCapability('gpt-5.5', 'reasoning'), 'Capability router marks GPT-5.5 as reasoning-capable');
  assert(hasCapability('claude-opus-4-8', 'code'), 'Capability router marks Opus 4.8 as code-capable');
  assert(hasCapability('sonar-deep-research', 'reasoning'), 'Capability router marks Sonar Deep Research as reasoning-capable');

  assert(isMarketplaceRoutedModel('openai_compatible/company-agent'), 'BlackSwan routing treats OpenAI-compatible models as marketplace routed');
  assert(isMarketplaceRoutedModel('github-models/openai/gpt-4.1'), 'BlackSwan routing treats GitHub Models as marketplace routed');

  // ── Drift guard: selectable == wired ───────────────────────────────────────
  // The frontier/default tier is what Auto and the failover ladders actually
  // emit. Every one of these picker ids MUST be present in PROVIDER_MODELS and
  // have BOTH an exact-id-keyed modelCapabilities row and a modelPricing match.
  // The capability row is exact-key, so bumping an Opus/GPT/Gemini id in the
  // catalog without adding its capabilities row fails here instead of silently
  // shipping a picker entry that degrades to the ['text'] default at runtime.
  const WIRED_FRONTIER_IDS = [
    // OpenAI
    'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.4-nano', 'gpt-4o',
    // Anthropic
    'claude-fable-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
    'claude-sonnet-4-6', 'claude-haiku-4-5',
    // Google AI
    'gemini-3.5-flash', 'gemini-3.1-pro-preview', 'gemini-3.1-flash-lite',
    'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite',
  ];
  const frontierCatalogIds = new Set([...ids('openai'), ...ids('anthropic'), ...ids('google_ai')]);
  for (const id of WIRED_FRONTIER_IDS) {
    assert(frontierCatalogIds.has(id), `Frontier picker id "${id}" is present in PROVIDER_MODELS`);
    assert(hasCapabilityRow(id), `Frontier picker id "${id}" has a modelCapabilities row (selectable == wired)`);
    assert(hasPricingRow(id), `Frontier picker id "${id}" has a modelPricing row (selectable == wired)`, resolveModelRate(id).label);
  }

  // Every claude-* id in the Anthropic catalog resolves in BOTH the pricing
  // and capability tables. Edge MODEL_MAPs live in Deno files we can't import,
  // so per the lane we assert the canonical claude ids exist in llmProviders +
  // are fully wired here; that is the importable proxy for "resolves in both
  // edge maps". claude is a code-capable family, so assert that too.
  for (const id of ids('anthropic')) {
    assert(/^claude-/.test(id), `Anthropic catalog id "${id}" is a claude-* id`);
    assert(hasCapabilityRow(id), `Claude picker id "${id}" has a modelCapabilities row`);
    assert(hasCapability(id, 'code'), `Claude picker id "${id}" is marked code-capable`);
    assert(hasPricingRow(id), `Claude picker id "${id}" has a modelPricing row`);
  }

  // An OpenRouter mirror of a model we price natively must ALSO resolve to that
  // pricing row through the dot->dash + provider-prefix-strip normalizer. This
  // catches the realistic drift where a priced model is renamed but its OR
  // mirror id is left pointing at a now-unpriced string. We gate on the bare id
  // already having a native pricing row, so families the project hasn't priced
  // anywhere yet (e.g. perplexity sonar, OSS llama/qwen mirrors) don't force a
  // failure here — that native-pricing gap is tracked separately. Variant
  // shortcuts (`:nitro`/`:floor`/`:free`) and `openrouter/auto` are routing
  // meta, not priced model rows.
  for (const id of ids('openrouter')) {
    if (id === 'openrouter/auto' || /:.*$/.test(id)) continue;
    const bare = bareModelId(id);
    if (!hasPricingRow(bare)) continue;
    assert(hasPricingRow(id), `OpenRouter mirror "${id}" resolves to the same modelPricing row as its bare id`, resolveModelRate(id).label);
  }

  // Every serviceProfileSouls Auto-ladder + MODEL_FAILOVER id must exist in
  // PROVIDER_MODELS (or be a valid openrouter/-prefixed mirror). This stops a
  // ladder from routing Auto to a model the catalog no longer offers.
  for (const id of serviceSoulLadderIds()) {
    if (KNOWN_UNRESOLVED_LADDER_IDS.has(id)) {
      if (!resolvesInProviderModels(id)) {
        console.warn(`warn: ladder id "${id}" does not resolve in PROVIDER_MODELS (pre-existing drift in serviceProfileSouls.ts, not owned by this lane)`);
      }
      continue;
    }
    assert(resolvesInProviderModels(id), `Auto-ladder model "${id}" resolves in PROVIDER_MODELS`);
  }
  for (const id of modelFailoverIds()) {
    assert(resolvesInProviderModels(id), `Failover model "${id}" resolves in PROVIDER_MODELS`);
  }

  // ── Drift guard: no deprecated ids, no Grok/xAI ────────────────────────────
  // Scan every picker catalog id (PROVIDER_MODELS across all providers + the
  // inlined POPULAR_OPENROUTER_MODELS list in ChatTab). Deprecated reasoning
  // ids and the entire Grok/xAI family must never reappear.
  const catalogIdsForBanScan = [...allProviderModelIds(), ...popularOpenRouterIds()];
  assert(catalogIdsForBanScan.length > 0, 'Ban-scan found catalog ids to check', catalogIdsForBanScan.length);
  assert(popularOpenRouterIds().length > 0, 'Parsed POPULAR_OPENROUTER_MODELS ids from ChatTab source', popularOpenRouterIds().length);

  const deprecatedHits = catalogIdsForBanScan.filter((id) => {
    const low = id.toLowerCase();
    const bare = bareModelId(id).toLowerCase();
    return DEPRECATED_MODEL_IDS.some((dep) => low === dep || bare === dep);
  });
  assert(deprecatedHits.length === 0, 'No deprecated model ids (o3 / o4-mini / o3-mini / mixtral-8x7b-32768) in picker catalogs', deprecatedHits);

  const grokHits = catalogIdsForBanScan.filter((id) => {
    const segments = id.toLowerCase().split('/');
    const bare = bareModelId(id).toLowerCase();
    // Match the vendor segment of a routed id (e.g. `openrouter/x-ai/grok-2`)
    // or the bare id family — not arbitrary substrings, so legit ids are safe.
    return GROK_XAI_PATTERNS.some((p) => segments.includes(p) || bare === p || bare.startsWith(`${p}-`));
  });
  assert(grokHits.length === 0, 'No Grok / xAI model ids in picker catalogs (project decision: no Grok / no xAI)', grokHits);

  if (failures > 0) {
    console.error(`\n${failures} model-catalog smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll model-catalog smoke cases passed.');
}

main();
