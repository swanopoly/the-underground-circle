/**
 * model-freshness-diff — "did a new top model come out?" awareness report.
 *
 * Fetches the live OpenRouter /models list, reads the hardcoded catalog ids
 * out of src/lib/llmProviders.ts, and prints the top-family models that are
 * live but NOT yet wired — so a human (or a follow-up PR) hand-adds the
 * capability + pricing + (optional) failover rows the drift-guard requires.
 *
 * This deliberately does NOT auto-wire anything: making an arbitrary remote
 * model routable with default pricing + text-only capabilities would silently
 * defeat the "selectable == wired" invariant. It keeps curation in human hands
 * while removing the "we didn't know Kimi K4 shipped" gap. The banned-vendor
 * gate (NO Grok / xAI) is applied so a banned model is never suggested.
 *
 * Run: npm run models:freshness
 *      npm run models:freshness -- --fixture path/to/models.json   (offline)
 *
 * The pure diff/filter logic lives in src/lib/modelCatalogFilterCore.ts and is
 * covered by scripts/model-catalog-filter-core-smoketest.ts (no network).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { computeModelFreshnessDiff } from '../src/lib/modelCatalogFilterCore';

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

// Curated "top" vendor families we want to stay current on. The long tail of
// niche/community OpenRouter models is intentionally ignored. NO x-ai (banned;
// also enforced structurally by the filter core).
const TOP_FAMILIES = [
  'anthropic', 'openai', 'google', 'moonshotai', 'deepseek',
  'qwen', 'z-ai', 'minimax', 'mistralai', 'meta-llama',
];

/** Extract every model id literal from PROVIDER_MODELS in llmProviders.ts.
 *  The file pulls in react-native transitively so it isn't tsx-importable —
 *  we parse the source the same way the model-catalog drift-guard does. */
function wiredCatalogIds(): string[] {
  const src = readFileSync(join(process.cwd(), 'src/lib/llmProviders.ts'), 'utf8');
  const block = src.match(/export const PROVIDER_MODELS[\s\S]*?\n\};/)?.[0] || src;
  return (block.match(/id:\s*'([^']+)'/g) || [])
    .map((e) => e.match(/'([^']+)'/)?.[1])
    .filter((x): x is string => !!x);
}

async function fetchLiveIds(): Promise<string[] | null> {
  const fixtureFlag = process.argv.indexOf('--fixture');
  if (fixtureFlag >= 0 && process.argv[fixtureFlag + 1]) {
    const raw = JSON.parse(readFileSync(process.argv[fixtureFlag + 1], 'utf8'));
    return (raw?.data || []).map((m: { id: string }) => m.id).filter(Boolean);
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    const resp = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!resp.ok) return null;
    const json = await resp.json() as { data?: Array<{ id: string }> };
    return Array.isArray(json.data) ? json.data.map((m) => m.id).filter(Boolean) : null;
  } catch {
    return null;
  }
}

async function main() {
  const wired = wiredCatalogIds();
  const live = await fetchLiveIds();
  if (!live) {
    console.error('model-freshness-diff: could not fetch OpenRouter /models (offline?).');
    console.error('  Re-run with network, or: npm run models:freshness -- --fixture <models.json>');
    process.exit(0); // informational tool — a fetch failure is not a build failure
  }

  const diff = computeModelFreshnessDiff(live, wired, { topFamilies: TOP_FAMILIES });

  console.log(`Model freshness: ${diff.wiredCount} wired slugs; ${diff.consideredCount} live top-family models considered.`);
  if (diff.newTopModels.length === 0) {
    console.log('\n✅ Catalog is current — no new top-family models on OpenRouter that are missing from the catalog.');
    return;
  }
  console.log(`\n🆕 ${diff.newTopModels.length} top model(s) live on OpenRouter but NOT yet in the catalog:\n`);
  for (const id of diff.newTopModels) console.log(`  - ${id}`);
  console.log('\nTo wire one: add its `openrouter/`-routed id to PROVIDER_MODELS.openrouter in');
  console.log('src/lib/llmProviders.ts, plus a modelPricing row + (if not covered by a family');
  console.log('pattern) a modelCapabilities entry, then re-run `npm run smoke:model-catalog`.');
}

main();
