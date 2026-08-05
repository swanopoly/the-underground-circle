/**
 * fallback-chain-smoketest — CA-8f. Verifies the provider fallback
 * chain correctly identifies retryable errors, advances through the
 * chain on transient failures, bubbles structural errors, and fires
 * the onFallback observer once per advance.
 *
 * Also covers `providerHealthRegistry` (health-aware PRE-selection for
 * the cross-provider router) with injected time: class→cooldown
 * mapping, 30s window enter/exit, request-specific classes NOT cooling
 * down, order-only reorder (never drops to zero), and ring bounding.
 *
 * Run: npm run smoke:fallback-chain
 */

import {
  createFallbackProvider,
  extractErrorMessage,
  extractStatusCode,
  isRetryableProviderError,
  type FallbackProviderEntry,
} from '../src/lib/agentProviders/fallbackChain';
import type { AgentProvider, ProviderTurnResult } from '../src/lib/agentExecutionCore';
import {
  recordProviderOutcome,
  isProviderCoolingDown,
  classifyProviderError,
  excludeCoolingProviders,
  resetProviderHealth,
  providerHealthDebug,
  COOLDOWN_BY_CLASS,
  DEFAULT_COOLDOWN_MS,
  MAX_EVENTS_PER_PROVIDER,
  type ProviderErrorClass,
} from '../src/lib/providerHealthRegistry';
import { resolveProviderRoutes } from '../src/lib/crossProviderRouter';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── Test fixtures ──────────────────────────────────────────────────

function okResult(text: string): ProviderTurnResult {
  return {
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 1, output_tokens: 2 },
  };
}

function makeProvider(label: string, behavior: () => Promise<ProviderTurnResult>): FallbackProviderEntry {
  const provider: AgentProvider = {
    async turn() { return behavior(); },
  };
  return { label, provider };
}

function httpError(status: number, msg = 'upstream error'): Error & { status: number } {
  const e = new Error(msg) as Error & { status: number };
  e.status = status;
  return e;
}

const EMPTY_TURN = { messages: [], tools: [] };

async function main() {
  // ─── extractStatusCode ──────────────────────────────────────────
  assert(extractStatusCode(httpError(529)) === 529, 'extract: .status field');
  assert(extractStatusCode({ statusCode: 503 }) === 503, 'extract: .statusCode field');
  assert(extractStatusCode({ response: { status: 502 } }) === 502, 'extract: .response.status');
  assert(extractStatusCode({ code: 'ECONNRESET' }) === undefined, 'extract: non-numeric code ignored');
  assert(extractStatusCode({ code: 500 }) === 500, 'extract: numeric .code counted');
  assert(extractStatusCode({ status: 99 }) === undefined, 'extract: out-of-range status ignored');
  assert(extractStatusCode({ status: 600 }) === undefined, 'extract: >599 ignored');
  assert(extractStatusCode(null) === undefined, 'extract: null → undefined');
  assert(extractStatusCode('string err') === undefined, 'extract: string → undefined');

  // ─── extractErrorMessage ────────────────────────────────────────
  assert(extractErrorMessage(new Error('boom')) === 'boom', 'message: Error.message');
  assert(extractErrorMessage('raw string') === 'raw string', 'message: passthrough string');
  assert(extractErrorMessage({ error: 'nope' }) === 'nope', 'message: .error string');
  assert(extractErrorMessage({ error: { message: 'nested' } }) === 'nested', 'message: .error.message nested');
  assert(extractErrorMessage(null) === '', 'message: null → empty');

  // ─── isRetryableProviderError ──────────────────────────────────
  // HTTP retryable codes
  assert(isRetryableProviderError(httpError(429)), 'retryable: 429');
  assert(isRetryableProviderError(httpError(529)), 'retryable: 529 (Anthropic overloaded)');
  assert(isRetryableProviderError(httpError(500)), 'retryable: 500');
  assert(isRetryableProviderError(httpError(502)), 'retryable: 502');
  assert(isRetryableProviderError(httpError(503)), 'retryable: 503');
  assert(isRetryableProviderError(httpError(504)), 'retryable: 504');
  assert(isRetryableProviderError(httpError(408)), 'retryable: 408 timeout');

  // HTTP structural — not retryable
  assert(!isRetryableProviderError(httpError(400)), 'structural: 400');
  assert(!isRetryableProviderError(httpError(401)), 'structural: 401');
  assert(!isRetryableProviderError(httpError(403)), 'structural: 403');
  assert(!isRetryableProviderError(httpError(404)), 'structural: 404');
  assert(!isRetryableProviderError(httpError(422)), 'structural: 422');

  // String-only errors (no status)
  assert(isRetryableProviderError(new Error('Overloaded: try again')), 'string retryable: Overloaded');
  assert(isRetryableProviderError(new Error('rate_limit_exceeded')), 'string retryable: rate_limit');
  assert(isRetryableProviderError(new Error('Network error — fetch failed')), 'string retryable: fetch failed');
  assert(isRetryableProviderError(new Error('ECONNRESET')), 'string retryable: ECONNRESET');
  assert(isRetryableProviderError(new Error('request aborted')), 'string retryable: aborted');
  assert(!isRetryableProviderError(new Error('invalid tool schema')), 'string structural: invalid');
  assert(!isRetryableProviderError(new Error('missing required field')), 'string structural: missing field');
  assert(!isRetryableProviderError(null), 'edge: null → not retryable');
  assert(!isRetryableProviderError(undefined), 'edge: undefined → not retryable');

  // ─── Chain routing: primary succeeds ────────────────────────────
  {
    const events: any[] = [];
    const chain = createFallbackProvider({
      providers: [
        makeProvider('primary', async () => okResult('from primary')),
        makeProvider('fallback', async () => okResult('from fallback')),
      ],
      onFallback: (e) => events.push(e),
    });
    const r = await chain.turn(EMPTY_TURN);
    assert(r.stop_reason === 'end_turn', 'happy: stop_reason forwarded');
    assert((r.content[0] as any).text === 'from primary', 'happy: primary wins when no error');
    assert(events.length === 0, 'happy: onFallback NOT called');
  }

  // ─── Chain routing: primary 529 → fallback succeeds ─────────────
  {
    const events: any[] = [];
    const chain = createFallbackProvider({
      providers: [
        makeProvider('anthropic.direct', async () => { throw httpError(529, 'Overloaded'); }),
        makeProvider('openrouter.anthropic', async () => okResult('from fallback')),
      ],
      onFallback: (e) => events.push(e),
    });
    const r = await chain.turn(EMPTY_TURN);
    assert((r.content[0] as any).text === 'from fallback', 'fallback: uses 2nd provider on 529');
    assert(events.length === 1, 'fallback: onFallback fires once');
    assert(events[0].attempted === 'anthropic.direct', 'fallback: observer names failed provider');
    assert(events[0].nextLabel === 'openrouter.anthropic', 'fallback: observer names next provider');
    assert(events[0].statusCode === 529, 'fallback: status code captured');
  }

  // ─── Chain routing: structural error bubbles immediately ────────
  {
    const events: any[] = [];
    const fallbackCalled = { value: false };
    const chain = createFallbackProvider({
      providers: [
        makeProvider('primary', async () => { throw httpError(400, 'bad request'); }),
        makeProvider('fallback', async () => { fallbackCalled.value = true; return okResult('nope'); }),
      ],
      onFallback: (e) => events.push(e),
    });
    try {
      await chain.turn(EMPTY_TURN);
      fail('structural: expected throw');
    } catch (err: any) {
      assert(err.status === 400, 'structural: 400 bubbled');
    }
    assert(!fallbackCalled.value, 'structural: fallback NOT called on 400');
    assert(events.length === 1, 'structural: observer still fires once');
    assert(events[0].nextLabel === 'fallback', 'structural: nextLabel still named');
  }

  // ─── Chain routing: all providers fail → final error bubbles ────
  {
    const events: any[] = [];
    const chain = createFallbackProvider({
      providers: [
        makeProvider('a', async () => { throw httpError(529); }),
        makeProvider('b', async () => { throw httpError(503); }),
        makeProvider('c', async () => { throw httpError(504, 'gateway timeout'); }),
      ],
      onFallback: (e) => events.push(e),
    });
    try {
      await chain.turn(EMPTY_TURN);
      fail('exhausted: expected throw after all fail');
    } catch (err: any) {
      assert(err.status === 504, 'exhausted: last error surfaces');
    }
    assert(events.length === 3, 'exhausted: observer fires once per provider');
    assert(events[events.length - 1].nextLabel === null, 'exhausted: last event nextLabel=null');
  }

  // ─── Three-tier chain: first 2 fail, 3rd succeeds ──────────────
  {
    const events: any[] = [];
    const chain = createFallbackProvider({
      providers: [
        makeProvider('anthropic', async () => { throw httpError(529); }),
        makeProvider('openrouter', async () => { throw httpError(503); }),
        makeProvider('gemini', async () => okResult('g')),
      ],
      onFallback: (e) => events.push(e),
    });
    const r = await chain.turn(EMPTY_TURN);
    assert((r.content[0] as any).text === 'g', '3-tier: 3rd provider served request');
    assert(events.length === 2, '3-tier: observer fires twice (once per skip)');
    assert(events[0].nextLabel === 'openrouter', '3-tier: first advance → openrouter');
    assert(events[1].nextLabel === 'gemini', '3-tier: second advance → gemini');
  }

  // ─── Observer throwing must not mask provider error ─────────────
  {
    const chain = createFallbackProvider({
      providers: [
        makeProvider('primary', async () => { throw httpError(529); }),
        makeProvider('fallback', async () => okResult('from fallback')),
      ],
      onFallback: () => { throw new Error('observer bug'); },
    });
    const r = await chain.turn(EMPTY_TURN);
    assert((r.content[0] as any).text === 'from fallback', 'observer-throw: chain still succeeds');
  }

  // ─── Empty providers array throws at construction ───────────────
  {
    let threw = false;
    try { createFallbackProvider({ providers: [] }); } catch { threw = true; }
    assert(threw, 'construction: empty providers rejected');
  }

  // ════════════════════════════════════════════════════════════════
  //  providerHealthRegistry — health-aware PRE-selection (injected time)
  // ════════════════════════════════════════════════════════════════
  {
    // Fixed clock base so every assertion is deterministic.
    const T0 = 1_000_000;

    // ── classifyProviderError: status-code mapping ────────────────
    resetProviderHealth();
    assert(classifyProviderError({ status: 429 }) === 'rate_limit', 'classify: 429 → rate_limit');
    assert(classifyProviderError({ status: 529 }) === 'overload', 'classify: 529 → overload');
    assert(classifyProviderError({ status: 503 }) === 'overload', 'classify: 503 → overload');
    assert(classifyProviderError({ status: 500 }) === 'transient', 'classify: 500 → transient');
    assert(classifyProviderError({ status: 504 }) === 'transient', 'classify: 504 → transient');
    assert(classifyProviderError({ status: 408 }) === 'transient', 'classify: 408 → transient');
    assert(classifyProviderError({ status: 401 }) === 'auth', 'classify: 401 → auth');
    assert(classifyProviderError({ status: 403 }) === 'auth', 'classify: 403 → auth');
    assert(classifyProviderError({ statusCode: 500 }) === 'transient', 'classify: .statusCode shape → transient');
    assert(classifyProviderError({ response: { status: 429 } }) === 'rate_limit', 'classify: .response.status shape → rate_limit');

    // ── classifyProviderError: message heuristics ─────────────────
    assert(classifyProviderError(new Error('Rate limit exceeded')) === 'rate_limit', 'classify: "rate limit" msg → rate_limit');
    assert(classifyProviderError(new Error('too many requests')) === 'rate_limit', 'classify: "too many requests" → rate_limit');
    assert(classifyProviderError(new Error('Model is overloaded')) === 'overload', 'classify: "overloaded" msg → overload');
    assert(classifyProviderError(new Error('fetch failed')) === 'transient', 'classify: "fetch failed" → transient');
    assert(classifyProviderError(new Error('ECONNRESET')) === 'transient', 'classify: ECONNRESET → transient');
    assert(classifyProviderError(new Error('invalid api key')) === 'auth', 'classify: "invalid api key" → auth');
    assert(classifyProviderError(new Error("This model's maximum context length is 8192")) === 'context_overflow', 'classify: context-length msg → context_overflow');
    assert(classifyProviderError({ status: 400, message: 'reduce the length of the messages' }) === 'context_overflow', 'classify: 400 + context msg → context_overflow');
    assert(classifyProviderError(new Error('flagged by content policy')) === 'content_policy', 'classify: "content policy" → content_policy');
    assert(classifyProviderError({ status: 400, message: 'request blocked by safety moderation' }) === 'content_policy', 'classify: 400 + safety msg → content_policy');
    assert(classifyProviderError({ status: 400, message: 'bad param foo' }) === 'other', 'classify: plain 400 → other');
    assert(classifyProviderError(null) === 'other', 'classify: null → other');
    assert(classifyProviderError(new Error('some unknown thing')) === 'other', 'classify: unknown msg → other');

    // ── COOLDOWN_BY_CLASS table: health vs request-specific ───────
    const coolClasses: ProviderErrorClass[] = ['rate_limit', 'overload', 'transient'];
    const noCoolClasses: ProviderErrorClass[] = ['context_overflow', 'content_policy', 'auth', 'other'];
    for (const c of coolClasses) assert(COOLDOWN_BY_CLASS[c] === true, `table: ${c} DOES cool down`);
    for (const c of noCoolClasses) assert(COOLDOWN_BY_CLASS[c] === false, `table: ${c} does NOT cool down`);

    // ── isProviderCoolingDown: rate_limit enters, ages out at 30s ──
    resetProviderHealth();
    assert(!isProviderCoolingDown('groq', T0), 'cooldown: unknown provider not cooling');
    recordProviderOutcome('groq', { ok: false, errorClass: 'rate_limit' }, T0);
    assert(isProviderCoolingDown('groq', T0), 'cooldown: rate_limit → cooling at t0');
    assert(isProviderCoolingDown('groq', T0 + 29_999), 'cooldown: still cooling at 29.999s (inside 30s window)');
    assert(!isProviderCoolingDown('groq', T0 + DEFAULT_COOLDOWN_MS + 1), 'cooldown: restored after 30s window');
    assert(DEFAULT_COOLDOWN_MS === 30_000, 'cooldown: default window is 30s');

    // ── overload + transient also cool down ───────────────────────
    resetProviderHealth();
    recordProviderOutcome('openrouter', { ok: false, errorClass: 'overload' }, T0);
    assert(isProviderCoolingDown('openrouter', T0 + 5_000), 'cooldown: overload → cooling');
    resetProviderHealth();
    recordProviderOutcome('huggingface', { ok: false, errorClass: 'transient' }, T0);
    assert(isProviderCoolingDown('huggingface', T0 + 5_000), 'cooldown: transient → cooling');

    // ── content_policy / auth / context_overflow do NOT cool down ─
    resetProviderHealth();
    recordProviderOutcome('openai', { ok: false, errorClass: 'content_policy' }, T0);
    assert(!isProviderCoolingDown('openai', T0), 'cooldown: content_policy does NOT cool (request-specific)');
    recordProviderOutcome('openai', { ok: false, errorClass: 'auth' }, T0);
    assert(!isProviderCoolingDown('openai', T0), 'cooldown: auth does NOT cool (config, not health)');
    recordProviderOutcome('openai', { ok: false, errorClass: 'context_overflow' }, T0);
    assert(!isProviderCoolingDown('openai', T0), 'cooldown: context_overflow does NOT cool (prompt-specific)');

    // ── success is not a cooldown signal ──────────────────────────
    resetProviderHealth();
    recordProviderOutcome('groq', { ok: true }, T0);
    assert(!isProviderCoolingDown('groq', T0), 'cooldown: success → not cooling');
    // A recent success alongside a still-in-window failure: failure wins
    // (we surface honesty; a fresh rate-limit still deprioritizes).
    recordProviderOutcome('groq', { ok: false, errorClass: 'rate_limit' }, T0 + 10);
    assert(isProviderCoolingDown('groq', T0 + 20), 'cooldown: in-window rate_limit still cools despite prior success');

    // ── custom cooldown window override ───────────────────────────
    resetProviderHealth();
    recordProviderOutcome('deepseek', { ok: false, errorClass: 'rate_limit' }, T0);
    assert(isProviderCoolingDown('deepseek', T0 + 4_000, { cooldownMs: 5_000 }), 'cooldown: custom 5s window → still cooling at 4s');
    assert(!isProviderCoolingDown('deepseek', T0 + 6_000, { cooldownMs: 5_000 }), 'cooldown: custom 5s window → restored at 6s');

    // ── excludeCoolingProviders: moves cooling to BACK, keeps order ─
    resetProviderHealth();
    const order = ['ollama', 'huggingface', 'groq', 'openrouter'] as const;
    recordProviderOutcome('groq', { ok: false, errorClass: 'rate_limit' }, T0);
    const ex = excludeCoolingProviders(order, T0 + 1_000);
    assert(ex.ordered.length === order.length, 'exclude: length preserved (nothing dropped)');
    assert(ex.ordered[ex.ordered.length - 1] === 'groq', 'exclude: cooling provider moved to BACK');
    assert(ex.ordered[0] === 'ollama' && ex.ordered[1] === 'huggingface' && ex.ordered[2] === 'openrouter',
      'exclude: healthy providers keep relative order');
    assert(ex.deprioritized.length === 1 && ex.deprioritized[0] === 'groq', 'exclude: deprioritized note names groq');
    assert(order.every((p) => ex.ordered.includes(p)), 'exclude: every original provider still present');

    // ── excludeCoolingProviders: NEVER drops to zero (all cooling) ─
    resetProviderHealth();
    recordProviderOutcome('ollama', { ok: false, errorClass: 'overload' }, T0);
    recordProviderOutcome('groq', { ok: false, errorClass: 'rate_limit' }, T0);
    const allCool = excludeCoolingProviders(['ollama', 'groq'] as const, T0 + 100);
    assert(allCool.ordered.length === 2, 'exclude: all-cooling still returns full list (never zero)');
    assert(allCool.ordered[0] === 'ollama' && allCool.ordered[1] === 'groq',
      'exclude: all-cooling → original order preserved (worst case = unchanged)');

    // ── excludeCoolingProviders: no health data → identity order ──
    resetProviderHealth();
    const untouched = excludeCoolingProviders(['a', 'b', 'c'] as const, T0);
    assert(untouched.ordered.join(',') === 'a,b,c', 'exclude: no health data → order unchanged');
    assert(untouched.deprioritized.length === 0, 'exclude: no health data → nothing deprioritized');

    // ── Ring bounding: never exceeds MAX_EVENTS_PER_PROVIDER ──────
    resetProviderHealth();
    for (let i = 0; i < MAX_EVENTS_PER_PROVIDER + 20; i += 1) {
      recordProviderOutcome('churny', { ok: true }, T0 + i);
    }
    assert(providerHealthDebug('churny').events === MAX_EVENTS_PER_PROVIDER,
      `ring: bounded to MAX_EVENTS_PER_PROVIDER (${MAX_EVENTS_PER_PROVIDER})`);
    // The most-recent event must still be the newest we pushed (ring keeps tail).
    recordProviderOutcome('churny', { ok: false, errorClass: 'rate_limit' }, T0 + 10_000);
    assert(isProviderCoolingDown('churny', T0 + 10_001), 'ring: newest event retained after trim');

    // ── empty / blank provider ids are ignored (no crash) ─────────
    resetProviderHealth();
    recordProviderOutcome('', { ok: false, errorClass: 'rate_limit' }, T0);
    assert(!isProviderCoolingDown('', T0), 'edge: blank provider id never cools');
    assert(providerHealthDebug().providers === 0, 'edge: blank id not tracked');

    // ── missing errorClass on failure defaults to "other" (no cool) ─
    resetProviderHealth();
    recordProviderOutcome('mystery', { ok: false }, T0);
    assert(!isProviderCoolingDown('mystery', T0), 'edge: failure w/o class defaults to other → no cooldown');

    // ════════════════════════════════════════════════════════════
    //  Integration: resolveProviderRoutes health-aware PRE-selection
    // ════════════════════════════════════════════════════════════
    // Fail-visible check: reordering changes ORDER, never drops routes.
    resetProviderHealth();
    const avail = new Set<any>(['huggingface', 'groq', 'openrouter']);

    // Baseline order (no health clock): HF → groq → OR (per default pref).
    const base = resolveProviderRoutes('llama-3.3-70b', { available: avail });
    const baseProviders = base.map((r) => r.provider);
    assert(baseProviders.indexOf('huggingface') < baseProviders.indexOf('groq')
      && baseProviders.indexOf('groq') < baseProviders.indexOf('openrouter'),
      'integ: baseline order HF → groq → OR');

    // Now groq just rate-limited. With the clock injected, groq's route
    // must move AFTER openrouter — but still be present (fail-visible).
    recordProviderOutcome('groq', { ok: false, errorClass: 'rate_limit' }, T0);
    const reordered = resolveProviderRoutes('llama-3.3-70b', { available: avail, healthNowMs: T0 + 1_000 });
    const reProviders = reordered.map((r) => r.provider);
    assert(reProviders.includes('groq'), 'integ: cooling groq STILL present (not dropped — fail-visible)');
    assert(reordered.length === base.length, 'integ: same route count (order changed, nothing dropped)');
    assert(reProviders.indexOf('groq') > reProviders.indexOf('openrouter'),
      'integ: cooling groq deprioritized behind openrouter');
    assert(reProviders.indexOf('huggingface') === 0, 'integ: healthy HF still first');

    // After the window, order returns to baseline.
    const restored = resolveProviderRoutes('llama-3.3-70b', { available: avail, healthNowMs: T0 + DEFAULT_COOLDOWN_MS + 1 });
    const restoredProviders = restored.map((r) => r.provider);
    assert(restoredProviders.indexOf('groq') < restoredProviders.indexOf('openrouter'),
      'integ: after 30s window groq restored ahead of openrouter');

    // Health-class that is request-specific (content_policy) must NOT
    // reorder — a moderation refusal on one turn is not a health signal.
    resetProviderHealth();
    recordProviderOutcome('groq', { ok: false, errorClass: 'content_policy' }, T0);
    const notReordered = resolveProviderRoutes('llama-3.3-70b', { available: avail, healthNowMs: T0 + 1_000 });
    const nrProviders = notReordered.map((r) => r.provider);
    assert(nrProviders.indexOf('groq') < nrProviders.indexOf('openrouter'),
      'integ: content_policy failure does NOT reorder (request-specific, not health)');

    // Opt-out: omitting healthNowMs leaves order byte-identical to baseline
    // even when a provider is cooling (production default = no reorder).
    resetProviderHealth();
    recordProviderOutcome('groq', { ok: false, errorClass: 'rate_limit' }, T0);
    const optOut = resolveProviderRoutes('llama-3.3-70b', { available: avail });
    assert(optOut.map((r) => r.provider).join(',') === baseProviders.join(','),
      'integ: no healthNowMs → order unchanged (opt-in only)');

    resetProviderHealth();
  }

  if (failures > 0) {
    console.error(`\n${failures} fallback-chain smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll fallback-chain smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
