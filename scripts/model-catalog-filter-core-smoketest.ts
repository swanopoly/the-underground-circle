/**
 * model-catalog-filter-core-smoketest — pins the shared banned-vendor gate and
 * the dynamic-feed filter that every model source (deploy path, live
 * OpenRouter catalog, popularity feed) now runs through, so the "NO Grok /
 * xAI" invariant holds by construction no matter what a remote list returns.
 *
 * Run: npm run smoke:model-catalog-filter-core
 */
import {
  isBannedVendorModelId,
  filterDynamicModels,
  modelFamilyOf,
  bareModelSlug,
  computeModelFreshnessDiff,
} from '../src/lib/modelCatalogFilterCore';

let failures = 0;
function assert(cond: unknown, message: string, detail?: unknown) {
  if (cond) { console.log('pass:', message); }
  else { failures += 1; console.error('FAIL:', message); if (detail !== undefined) console.error('  detail:', JSON.stringify(detail)); }
}

// ─── isBannedVendorModelId ───────────────────────────────────────────────────
// Every passthrough form of Grok/xAI must fail closed.
for (const banned of [
  'grok', 'grok-2', 'grok-4', 'grok-code-fast',
  'x-ai/grok-2', 'openrouter/x-ai/grok-2', 'xai/grok', 'x_ai/grok-3',
  'openrouter/x-ai/grok-2:nitro', 'GROK-2', 'X-AI/Grok-2',
]) {
  assert(isBannedVendorModelId(banned), `banned: "${banned}" is blocked`);
}

// Real models — including ones whose names merely contain the letters — must
// NOT be false-flagged (segment-scoped, not substring).
for (const ok of [
  'moonshotai/kimi-k3', 'kimi-k3', 'deepseek/deepseek-v4-pro', 'z-ai/glm-5.2',
  'minimax/minimax-m3', 'qwen/qwen3.7-max', 'anthropic/claude-opus-4-8',
  'openai/gpt-5.5', 'google/gemini-3.5-flash',
  // adversarial near-misses: contain the letters but not as a vendor/family segment
  'some-org/maxgroktastic-notreal', 'org/proxair-1', 'vendor/relaxai-model',
]) {
  assert(!isBannedVendorModelId(ok), `allowed: "${ok}" is not flagged`);
}

assert(!isBannedVendorModelId(''), 'empty string is not banned');
assert(!isBannedVendorModelId(undefined as unknown as string), 'undefined is not banned (no throw)');

// ─── modelFamilyOf ───────────────────────────────────────────────────────────
assert(modelFamilyOf('openrouter/anthropic/claude-opus-4-8') === 'anthropic', 'family peels openrouter wrapper');
assert(modelFamilyOf('moonshotai/kimi-k3') === 'moonshotai', 'family reads vendor head');
assert(modelFamilyOf('kimi-k3') === 'kimi-k3', 'bare id has no vendor family (returns itself)');
assert(modelFamilyOf('Z-AI/GLM-5.2') === 'z-ai', 'family is lowercased');

// ─── filterDynamicModels ─────────────────────────────────────────────────────
{
  const feed = [
    { id: 'moonshotai/kimi-k3' },
    { id: 'x-ai/grok-2' },
    { id: 'anthropic/claude-opus-4-8' },
    { id: 'openrouter/x-ai/grok-4' },
    { id: 'deepseek/deepseek-v4-pro' },
    { id: '' },              // junk — dropped
    { id: 'qwen/qwen3.7-max' },
  ];
  const out = filterDynamicModels(feed);
  const ids = out.map((m) => m.id);
  assert(!ids.some((id) => id.includes('grok')), 'grok entries removed from feed', ids);
  assert(!ids.includes(''), 'empty-id entry dropped', ids);
  assert(ids.length === 4, 'four legit models survive', ids);
  assert(ids[0] === 'moonshotai/kimi-k3' && ids[1] === 'anthropic/claude-opus-4-8', 'input order preserved', ids);
}

// allowFamilies restricts a firehose to curated families (still drops banned).
{
  const feed = [
    { id: 'anthropic/claude-opus-4-8' },
    { id: 'moonshotai/kimi-k3' },
    { id: 'someorg/obscure-model-7b' },
    { id: 'x-ai/grok-2' },
  ];
  const out = filterDynamicModels(feed, { allowFamilies: ['anthropic', 'moonshotai'] });
  const ids = out.map((m) => m.id);
  assert(ids.length === 2, 'only allowed families kept', ids);
  assert(ids.includes('anthropic/claude-opus-4-8') && ids.includes('moonshotai/kimi-k3'), 'kept the two allowed', ids);
  assert(!ids.some((id) => id.includes('grok')), 'banned still dropped even inside allowFamilies', ids);
}

assert(filterDynamicModels(null).length === 0, 'null feed -> empty (no throw)');
assert(filterDynamicModels(undefined).length === 0, 'undefined feed -> empty (no throw)');

// ─── bareModelSlug ───────────────────────────────────────────────────────────
assert(bareModelSlug('openrouter/moonshotai/kimi-k3') === 'kimi-k3', 'slug peels openrouter+vendor');
assert(bareModelSlug('moonshotai/kimi-k3') === 'kimi-k3', 'slug peels vendor');
assert(bareModelSlug('kimi-k3') === 'kimi-k3', 'bare slug unchanged');
assert(bareModelSlug('meta-llama/llama-3.3-70b:nitro') === 'llama-3.3-70b', 'slug drops :variant');

// ─── computeModelFreshnessDiff ───────────────────────────────────────────────
{
  const TOP = ['anthropic', 'openai', 'google', 'moonshotai', 'deepseek', 'qwen', 'z-ai', 'minimax'];
  const wired = [
    'moonshotai/kimi-k3', 'anthropic/claude-opus-4-8', 'deepseek/deepseek-v4-pro',
    'qwen/qwen3.7-max', 'openai/gpt-5.5',
  ];
  const live = [
    'moonshotai/kimi-k3',       // already wired -> not new
    'moonshotai/kimi-k4',       // NEW top model -> reported
    'anthropic/claude-opus-4-8',// wired
    'x-ai/grok-5',              // banned -> never reported
    'someorg/niche-model-7b',   // not a top family -> ignored
    'deepseek/deepseek-v5',     // NEW -> reported
  ];
  const diff = computeModelFreshnessDiff(live, wired, { topFamilies: TOP });
  assert(diff.newTopModels.includes('moonshotai/kimi-k4'), 'flags a genuinely-new Kimi release', diff.newTopModels);
  assert(diff.newTopModels.includes('deepseek/deepseek-v5'), 'flags a new DeepSeek release', diff.newTopModels);
  assert(!diff.newTopModels.some((id) => id.includes('grok')), 'never reports a banned vendor as new', diff.newTopModels);
  assert(!diff.newTopModels.includes('someorg/niche-model-7b'), 'ignores non-top-family long tail');
  assert(!diff.newTopModels.includes('moonshotai/kimi-k3'), 'does not re-report an already-wired model');
  assert(diff.wiredCount === 5, 'wired count reflects distinct wired slugs', diff.wiredCount);
}
assert(computeModelFreshnessDiff([], [], { topFamilies: [] }).newTopModels.length === 0, 'empty inputs -> no new models (no throw)');

if (failures > 0) {
  console.error(`\n${failures} model-catalog-filter-core smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll model-catalog-filter-core smoke cases passed.');
