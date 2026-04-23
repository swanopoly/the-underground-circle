/**
 * fallback-chain-smoketest — CA-8f. Verifies the provider fallback
 * chain correctly identifies retryable errors, advances through the
 * chain on transient failures, bubbles structural errors, and fires
 * the onFallback observer once per advance.
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

  if (failures > 0) {
    console.error(`\n${failures} fallback-chain smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll fallback-chain smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
