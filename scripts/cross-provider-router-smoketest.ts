/**
 * cross-provider-router-smoketest — pins the route-resolution rules
 * in `crossProviderRouter.ts`. Regression on this means a chat or
 * agent might silently route to the wrong provider, miss the user's
 * connected key, or fail to fall through.
 *
 * Run: npm run smoke:cross-provider-router
 */

import {
  resolveProviderRoutes,
  findAliasKey,
  isTransientProviderError,
  MODEL_ALIASES,
} from '../src/lib/crossProviderRouter';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function set<T extends string>(...items: T[]): Set<T> {
  return new Set<T>(items);
}

function main() {
  // ── findAliasKey: friendly id resolution ─────────────────────────
  assert(findAliasKey('claude-opus-4-6') === 'claude-opus-4-6', 'findAliasKey: claude-opus-4-6 → exact key');
  assert(findAliasKey('claude-haiku-4-5-20251001') === 'claude-haiku-4-5', 'findAliasKey: dated haiku → claude-haiku-4-5');
  assert(findAliasKey('llama-3.3-70b-versatile') === 'llama-3.3-70b', 'findAliasKey: groq llama → llama-3.3-70b');
  assert(findAliasKey('gemini-flash') === 'gemini-2.5-flash', 'findAliasKey: gemini-flash → gemini-2.5-flash');
  // SwanBot Tier 3 (S3) routes the legacy Gemini fallback via findAliasKey →
  // google_ai model. Lock the pro path it depends on.
  assert(findAliasKey('gemini-2.5-pro') === 'gemini-2.5-pro', 'findAliasKey: gemini-2.5-pro → gemini-2.5-pro');
  assert(findAliasKey('gemini-pro') === 'gemini-2.5-pro', 'findAliasKey: gemini-pro → gemini-2.5-pro');
  assert(findAliasKey('') === null, 'findAliasKey: empty → null');
  assert(findAliasKey('made-up-model-id') === null, 'findAliasKey: unknown id → null');

  // ── resolveProviderRoutes: ordering with all providers ──────────
  {
    const routes = resolveProviderRoutes('claude-sonnet-4-6', {
      available: set('anthropic', 'openrouter'),
    });
    assert(routes.length === 2, 'sonnet 4.6: 2 routes (anthropic + openrouter)', `got ${routes.length}`);
    assert(routes[0].provider === 'openrouter', 'sonnet 4.6: openrouter first by default to reduce direct Anthropic spend');
    assert(routes[1].provider === 'anthropic-direct', 'sonnet 4.6: anthropic-direct fallback when OR is unavailable');
  }

  // ── Only OR connected → only OR route ────────────────────────────
  {
    const routes = resolveProviderRoutes('claude-sonnet-4-6', {
      available: set('openrouter'),
    });
    assert(routes.length >= 1 && routes.every((r) => r.provider === 'openrouter'),
      'sonnet 4.6 (only OR connected) → OR route only', `got ${routes.map((r) => r.provider).join(',')}`);
  }

  // ── Only HF connected, model not on HF → no routes ───────────────
  {
    const routes = resolveProviderRoutes('claude-sonnet-4-6', {
      available: set('huggingface'),
    });
    assert(routes.length === 0, 'sonnet 4.6 (only HF) → no routes (Claude isn\'t on HF)', `got ${routes.map((r) => r.label).join(',')}`);
  }

  // ── Llama 3.3 70B with HF + OR + Groq ────────────────────────────
  {
    const routes = resolveProviderRoutes('llama-3.3-70b', {
      available: set('huggingface', 'openrouter', 'groq'),
    });
    const providers = routes.map((r) => r.provider);
    assert(providers.includes('groq'), 'llama 3.3 70B: groq present');
    assert(providers.includes('openrouter'), 'llama 3.3 70B: openrouter present');
    assert(providers.includes('huggingface'), 'llama 3.3 70B: huggingface present');
    // Default preference is cost-sensitive: HF/free first, then fast cheap
    // providers, then OR paid/free fallbacks.
    const groqIdx = providers.indexOf('groq');
    const orIdx = providers.indexOf('openrouter');
    const hfIdx = providers.indexOf('huggingface');
    assert(hfIdx < groqIdx && groqIdx < orIdx,
      'llama 3.3 70B order: huggingface → groq → openrouter',
      `got ${providers.join(' → ')}`);
  }

  // ── preferFree pushes free OR variant first ──────────────────────
  {
    const routes = resolveProviderRoutes('llama-3.3-70b', {
      available: set('openrouter'),
      preferFree: true,
    });
    const firstOR = routes.find((r) => r.provider === 'openrouter');
    assert(firstOR?.modelId.endsWith(':free'), 'preferFree=true: free OR variant emitted first',
      `got ${firstOR?.modelId}`);
  }

  // ── Free fallback always emitted last when not preferred ─────────
  {
    const routes = resolveProviderRoutes('llama-3.3-70b', {
      available: set('openrouter'),
      preferFree: false,
    });
    const orRoutes = routes.filter((r) => r.provider === 'openrouter');
    assert(orRoutes.length === 2 && orRoutes[0].modelId === 'meta-llama/llama-3.3-70b-instruct',
      'preferFree=false: paid OR variant first', `got ${orRoutes.map((r) => r.modelId).join(',')}`);
    assert(orRoutes[1].modelId === 'meta-llama/llama-3.3-70b-instruct:free',
      'preferFree=false: free OR variant fallback last');
  }

  // ── Mistral (only HF + OR free) — both should be in chain ────────
  {
    const routes = resolveProviderRoutes('mistral-small-free', {
      available: set('huggingface', 'openrouter'),
    });
    const providers = routes.map((r) => r.provider);
    assert(providers.includes('openrouter') && providers.includes('huggingface'),
      'mistral-small-free: both OR free + HF present');
  }

  // ── No alias entry, only OR connected → emits the literal id ─────
  {
    const routes = resolveProviderRoutes('some/exotic-model-id', {
      available: set('openrouter'),
    });
    assert(routes.length === 1 && routes[0].modelId === 'some/exotic-model-id',
      'unknown alias + OR connected → emit literal id as OR route');
  }

  // ── Empty available set → empty routes ───────────────────────────
  {
    const routes = resolveProviderRoutes('llama-3.3-70b', {
      available: set(),
    });
    assert(routes.length === 0, 'no providers connected → no routes');
  }

  // ── isTransientProviderError ────────────────────────────────────
  assert(isTransientProviderError({ status: 429 }), '429 → transient');
  assert(isTransientProviderError({ status: 503 }), '503 → transient');
  assert(isTransientProviderError({ statusCode: 500 }), '500 → transient (statusCode shape)');
  assert(!isTransientProviderError({ status: 400 }), '400 → structural (not transient)');
  assert(!isTransientProviderError({ status: 401 }), '401 → structural (not transient)');
  assert(isTransientProviderError({ message: 'rate limit exceeded' }), 'rate-limit msg → transient');
  assert(isTransientProviderError({ message: 'fetch failed' }), 'network msg → transient');
  assert(!isTransientProviderError(null), 'null → not transient');
  assert(!isTransientProviderError({ message: 'invalid model id' }), 'invalid model msg → structural');

  // ── MODEL_ALIASES catalog sanity ─────────────────────────────────
  const requiredAliases = ['claude-sonnet-4-6', 'claude-opus-4-6', 'gpt-4o', 'llama-3.3-70b', 'mistral-large'];
  for (const k of requiredAliases) {
    assert(MODEL_ALIASES[k] != null, `MODEL_ALIASES contains ${k}`);
  }

  if (failures > 0) {
    console.error(`\n${failures} cross-provider-router smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll cross-provider-router smoke cases passed.');
}

main();
