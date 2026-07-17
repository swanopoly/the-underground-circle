// Smoke test for providerErrorAdvanceCore — pure, tsx-loadable, deterministic.
// Verifies classifyProviderError bucketing + shouldAdvanceAfterError chain
// decisions, incl. a degenerate/hostile-input group asserting no-throw.
// Run: npx tsx scripts/provider-error-advance-core-smoketest.ts
import {
  classifyProviderError,
  shouldAdvanceAfterError,
  type ProviderErrorClass,
} from '../src/lib/providerErrorAdvanceCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

const VALID: ReadonlySet<string> = new Set<ProviderErrorClass>([
  'auth',
  'rate_limit',
  'overload',
  'transient',
  'not_found',
  'permanent',
]);

/** Returns the value if fn() doesn't throw; records a failure + returns a
 *  sentinel if it does. Used by the hostile group to prove totality. */
function noThrow<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    failures++;
    console.error('FAIL: threw (' + label + ') :: ' + String(e));
    return undefined;
  }
}

const both = { differentProviderRemains: true, anyRouteRemains: true };
const sameOnly = { differentProviderRemains: false, anyRouteRemains: true };
const none = { differentProviderRemains: false, anyRouteRemains: false };

function main() {
  // ─── 1. classify → auth (status + message) ────────────────────────
  assertEq(classifyProviderError({ status: 401 }), 'auth', '401 -> auth');
  assertEq(classifyProviderError({ status: 403 }), 'auth', '403 -> auth');
  assertEq(classifyProviderError({ statusCode: 401 }), 'auth', 'statusCode 401 -> auth');
  assertEq(classifyProviderError({ message: 'Unauthorized' }), 'auth', "'Unauthorized' -> auth");
  assertEq(classifyProviderError({ message: 'Incorrect API key provided' }), 'auth', "'api key' -> auth");
  assertEq(classifyProviderError({ error: { code: 'invalid_api_key' } }), 'auth', 'invalid_api_key -> auth');
  assertEq(classifyProviderError({ message: 'authentication_error' }), 'auth', 'authentication -> auth');
  assertEq(classifyProviderError({ message: 'Forbidden: bad token' }), 'auth', 'forbidden -> auth');
  assertEq(classifyProviderError({ message: 'permission denied' }), 'auth', 'permission denied -> auth');

  // ─── 2. classify → rate_limit ─────────────────────────────────────
  assertEq(classifyProviderError({ status: 429 }), 'rate_limit', '429 -> rate_limit');
  assertEq(classifyProviderError({ message: 'Rate limit exceeded' }), 'rate_limit', "'rate limit' -> rate_limit");
  assertEq(classifyProviderError({ message: 'You are being rate limited' }), 'rate_limit', 'rate limited -> rate_limit');
  assertEq(classifyProviderError({ error: { type: 'rate_limit_exceeded' } }), 'rate_limit', 'rate_limit_exceeded -> rate_limit');
  assertEq(classifyProviderError({ message: 'Too Many Requests' }), 'rate_limit', 'too many requests -> rate_limit');
  assertEq(classifyProviderError({ message: 'quota exceeded for this key' }), 'rate_limit', 'quota -> rate_limit');
  // "generate" must NOT be misread as "rate" (word-boundary guard):
  assertEq(classifyProviderError({ message: 'failed to generate response' }), 'permanent', "'generate' NOT rate_limit");
  assertEq(classifyProviderError({ message: 'accurate but slow' }), 'permanent', "'accurate' NOT rate_limit");

  // ─── 3. classify → overload ───────────────────────────────────────
  assertEq(classifyProviderError({ status: 529 }), 'overload', '529 -> overload');
  assertEq(classifyProviderError({ message: 'Overloaded' }), 'overload', "'Overloaded' -> overload");
  assertEq(classifyProviderError({ error: { type: 'overloaded_error' } }), 'overload', 'overloaded_error -> overload');
  assertEq(classifyProviderError({ message: 'service unavailable' }), 'overload', 'service unavailable -> overload');
  assertEq(classifyProviderError({ message: 'the server is busy, try later' }), 'overload', 'server is busy -> overload');

  // ─── 4. classify → transient (5xx / timeout / ECONN) ──────────────
  assertEq(classifyProviderError({ status: 500 }), 'transient', '500 -> transient');
  assertEq(classifyProviderError({ status: 502 }), 'transient', '502 -> transient');
  assertEq(classifyProviderError({ status: 503 }), 'transient', '503 -> transient (5xx, not overload)');
  assertEq(classifyProviderError({ status: 504 }), 'transient', '504 -> transient');
  assertEq(classifyProviderError({ status: 599 }), 'transient', '599 -> transient');
  assertEq(classifyProviderError({ status: 408 }), 'transient', '408 -> transient');
  assertEq(classifyProviderError({ message: 'Request timed out' }), 'transient', 'timed out -> transient');
  assertEq(classifyProviderError({ code: 'ETIMEDOUT' }), 'transient', 'ETIMEDOUT -> transient');
  assertEq(classifyProviderError({ code: 'ECONNRESET' }), 'transient', 'ECONNRESET -> transient');
  assertEq(classifyProviderError({ message: 'fetch failed', cause: { code: 'ECONNREFUSED' } }), 'transient', 'fetch failed -> transient');
  assertEq(classifyProviderError({ message: 'network error' }), 'transient', 'network -> transient');
  assertEq(classifyProviderError({ message: 'socket hang up' }), 'transient', 'socket hang up -> transient');
  assertEq(classifyProviderError(new Error('The operation was aborted')), 'transient', 'aborted -> transient');
  // ENOTFOUND is a DNS/network wobble, NOT a model "not found":
  assertEq(classifyProviderError({ code: 'ENOTFOUND' }), 'transient', 'ENOTFOUND -> transient (not not_found)');

  // Browser/Supabase fetch-failure messages must classify transient (regression
  // for React Native Web / Netlify: 'Failed to fetch', 'Load failed', and the
  // Supabase functions-js 'Failed to send a request' wrapper).
  assertEq(classifyProviderError({ message: 'TypeError: Failed to fetch' }), 'transient', "'Failed to fetch' (Chrome/Edge) -> transient");
  assertEq(classifyProviderError({ message: 'Load failed' }), 'transient', "'Load failed' (Safari) -> transient");
  assertEq(classifyProviderError({ message: 'Failed to send a request to the Edge Function' }), 'transient', 'Supabase FunctionsFetchError -> transient');

  // ─── 5. classify → not_found ──────────────────────────────────────
  assertEq(classifyProviderError({ status: 404 }), 'not_found', '404 -> not_found');
  assertEq(classifyProviderError({ message: 'model not found' }), 'not_found', 'model not found -> not_found');
  assertEq(classifyProviderError({ error: { message: 'The model `x` does not exist' } }), 'not_found', 'does not exist -> not_found');
  assertEq(classifyProviderError({ message: 'no such model: foo' }), 'not_found', 'no such -> not_found');
  assertEq(classifyProviderError({ message: 'unknown model requested' }), 'not_found', 'unknown model -> not_found');
  assertEq(classifyProviderError({ error: { code: 'model_not_found' } }), 'not_found', 'model_not_found -> not_found');

  // ─── 6. classify → permanent (else bucket) ────────────────────────
  assertEq(classifyProviderError({ status: 400 }), 'permanent', '400 -> permanent');
  assertEq(classifyProviderError({ status: 422, message: 'messages: invalid role' }), 'permanent', '422 no-keyword -> permanent');
  assertEq(classifyProviderError({ status: 402, message: 'insufficient credits' }), 'permanent', '402 billing -> permanent');
  assertEq(classifyProviderError({ status: 409 }), 'permanent', '409 -> permanent');
  assertEq(classifyProviderError({ message: 'something weird happened' }), 'permanent', 'unknown msg -> permanent');
  assertEq(classifyProviderError(''), 'permanent', 'empty string -> permanent');
  assertEq(classifyProviderError({}), 'permanent', 'empty object -> permanent');

  // ─── 7. classify → precedence, coercion & real provider shapes ────
  // Numeric status wins over a conflicting body keyword:
  assertEq(classifyProviderError({ status: 400, message: 'invalid api key' }), 'auth', '400 + api key -> auth (fall-through)');
  assertEq(
    classifyProviderError({ response: { status: 503, data: { error: { message: 'upstream overloaded' } } } }),
    'transient',
    'response.status 503 wins over body "overloaded"',
  );
  assertEq(
    classifyProviderError({ response: { data: { error: { message: 'model not found' } } } }),
    'not_found',
    'axios body (no status) -> not_found',
  );
  // Bare number thrown as the error value:
  assertEq(classifyProviderError(429), 'rate_limit', 'number 429 -> rate_limit');
  assertEq(classifyProviderError(404), 'not_found', 'number 404 -> not_found');
  assertEq(classifyProviderError(500), 'transient', 'number 500 -> transient');
  assertEq(classifyProviderError(529), 'overload', 'number 529 -> overload');
  // String-embedded status (axios-style) parsed from text:
  assertEq(classifyProviderError('Request failed with status code 429'), 'rate_limit', 'string "status code 429" -> rate_limit');
  assertEq(classifyProviderError('HTTP 401 Unauthorized'), 'auth', 'string "HTTP 401" -> auth');
  assertEq(classifyProviderError('529'), 'overload', 'bare "529" string -> overload');
  assertEq(classifyProviderError(429n), 'rate_limit', 'bigint 429 -> rate_limit');
  // Full real-world SDK error objects:
  assertEq(
    classifyProviderError({ status: 529, error: { type: 'overloaded_error', message: 'Overloaded' } }),
    'overload',
    'Anthropic overloaded shape -> overload',
  );
  assertEq(
    classifyProviderError({ status: 401, error: { message: 'Incorrect API key provided', type: 'invalid_request_error', code: 'invalid_api_key' } }),
    'auth',
    'OpenAI auth shape -> auth',
  );
  assertEq(
    classifyProviderError({ status: 404, error: { message: 'The model does not exist', code: 'model_not_found' } }),
    'not_found',
    'OpenAI not-found shape -> not_found',
  );

  // ─── 8. shouldAdvanceAfterError — required cases + full matrix ─────
  // The four cases named in the task spec:
  assertEq(shouldAdvanceAfterError('auth', sameOnly), false, 'auth + only-same-provider-left -> false');
  assertEq(shouldAdvanceAfterError('auth', both), true, 'auth + different-provider-left -> true');
  assertEq(shouldAdvanceAfterError('rate_limit', sameOnly), true, 'rate_limit + same-provider-model-left -> true');
  assertEq(shouldAdvanceAfterError('permanent', none), false, 'permanent + no different provider -> false');
  // auth: advance IFF a different provider remains
  assertEq(shouldAdvanceAfterError('auth', none), false, 'auth + nothing left -> false');
  // not_found: same rule as auth/permanent
  assertEq(shouldAdvanceAfterError('not_found', sameOnly), false, 'not_found + same-only -> false');
  assertEq(shouldAdvanceAfterError('not_found', both), true, 'not_found + different provider -> true');
  // permanent: only a different provider
  assertEq(shouldAdvanceAfterError('permanent', sameOnly), false, 'permanent + same-only -> false');
  assertEq(shouldAdvanceAfterError('permanent', both), true, 'permanent + different provider -> true');
  // health classes: advance whenever ANY route remains (same-provider retry ok)
  assertEq(shouldAdvanceAfterError('rate_limit', none), false, 'rate_limit + nothing left -> false');
  assertEq(shouldAdvanceAfterError('rate_limit', both), true, 'rate_limit + anything left -> true');
  assertEq(shouldAdvanceAfterError('overload', sameOnly), true, 'overload + same-only -> true');
  assertEq(shouldAdvanceAfterError('overload', none), false, 'overload + nothing left -> false');
  assertEq(shouldAdvanceAfterError('transient', sameOnly), true, 'transient + same-only -> true');
  assertEq(shouldAdvanceAfterError('transient', none), false, 'transient + nothing left -> false');
  // The crux: a health class advances same-provider where auth does NOT.
  assert(
    shouldAdvanceAfterError('rate_limit', sameOnly) === true && shouldAdvanceAfterError('auth', sameOnly) === false,
    'rate_limit advances same-provider but auth does not',
  );

  // ─── 9. classify + shouldAdvance wired together ───────────────────
  {
    const authCls = classifyProviderError({ status: 401 });
    assertEq(shouldAdvanceAfterError(authCls, both), true, 'wired: 401 -> advance to different provider');
    assertEq(shouldAdvanceAfterError(authCls, sameOnly), false, 'wired: 401 -> do NOT retry same provider');
  }
  {
    const rateCls = classifyProviderError({ status: 429 });
    assertEq(shouldAdvanceAfterError(rateCls, sameOnly), true, 'wired: 429 -> retry same-provider route ok');
  }
  {
    const nfCls = classifyProviderError({ status: 404 });
    assertEq(shouldAdvanceAfterError(nfCls, sameOnly), false, 'wired: 404 -> not same provider');
    assertEq(shouldAdvanceAfterError(nfCls, both), true, 'wired: 404 -> different provider ok');
  }
  {
    const trCls = classifyProviderError({ code: 'ECONNRESET' });
    assertEq(shouldAdvanceAfterError(trCls, sameOnly), true, 'wired: ECONNRESET -> retry anything');
  }

  // ─── 10. degenerate / hostile input — MUST NOT THROW ──────────────
  const throwingGetter: Record<string, unknown> = {};
  Object.defineProperty(throwingGetter, 'status', {
    get() {
      throw new Error('boom-status');
    },
    enumerable: true,
  });
  const circular: Record<string, unknown> = { message: 'weird circular' };
  circular.self = circular;
  const badToString = {
    toString() {
      throw new Error('boom-tostring');
    },
  };
  const huge = 'x'.repeat(2_000_000);
  const hugeAuth = 'unauthorized ' + 'y'.repeat(2_000_000);

  const hostileErrs: Array<[string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['number 0', 0],
    ['NaN', NaN],
    ['bool', true],
    ['symbol', Symbol('x')],
    ['function', () => 0],
    ['empty obj', {}],
    ['empty array', []],
    ['array of junk', [1, 'two', null]],
    ['throwing getter', throwingGetter],
    ['circular', circular],
    ['bad toString', badToString],
    ['huge string', huge],
    ['huge w/ keyword', hugeAuth],
    ['nested nulls', { error: null, response: null, cause: null }],
    ['message is number', { message: 12345 }],
    ['status is object', { status: {} }],
    ['status NaN', { status: NaN }],
    ['deeply nested garbage', { response: { data: { error: 42 } } }],
  ];
  for (const [label, e] of hostileErrs) {
    const cls = noThrow('classify ' + label, () => classifyProviderError(e));
    assert(typeof cls === 'string' && VALID.has(cls as string), 'classify(' + label + ') -> valid class', String(cls));
  }
  // Specific hostile expectations that should still resolve meaningfully:
  assertEq(classifyProviderError(throwingGetter), 'permanent', 'throwing getter -> permanent (caught)');
  assertEq(classifyProviderError(huge), 'permanent', 'huge no-keyword string -> permanent (bounded)');
  assertEq(classifyProviderError(hugeAuth), 'auth', 'huge string w/ leading keyword -> auth (bounded scan)');
  assertEq(classifyProviderError(circular), 'permanent', 'circular -> permanent (no throw)');

  // Hostile ctx / cls for shouldAdvanceAfterError — MUST NOT THROW.
  const hostileCtx: Array<[string, unknown]> = [
    ['null ctx', null],
    ['undefined ctx', undefined],
    ['string ctx', 'nope'],
    ['number ctx', 7],
    ['empty ctx', {}],
    ['string flags', { differentProviderRemains: 'yes', anyRouteRemains: 1 }],
    ['truthy-not-true', { differentProviderRemains: 1, anyRouteRemains: {} }],
    ['array ctx', []],
  ];
  for (const [label, ctx] of hostileCtx) {
    const r = noThrow('advance ' + label, () =>
      shouldAdvanceAfterError('auth', ctx as { differentProviderRemains: boolean; anyRouteRemains: boolean }),
    );
    assert(typeof r === 'boolean', 'shouldAdvance(auth, ' + label + ') -> boolean', String(r));
  }
  // Only literal `true` counts — non-boolean flags are treated as absent.
  assertEq(shouldAdvanceAfterError('rate_limit', { differentProviderRemains: 'yes', anyRouteRemains: 1 } as never), false, 'truthy-not-true flags -> false');
  assertEq(shouldAdvanceAfterError('auth', null as never), false, 'null ctx -> false (stop)');
  // Hostile / unknown class -> conservative (behaves like permanent).
  assertEq(shouldAdvanceAfterError('garbage' as ProviderErrorClass, both), true, 'unknown class + different provider -> true');
  assertEq(shouldAdvanceAfterError('garbage' as ProviderErrorClass, sameOnly), false, 'unknown class + same-only -> false');
  assertEq(shouldAdvanceAfterError(null as never, both), true, 'null class + different provider -> true (conservative)');
  const rBad = noThrow('advance both-hostile', () => shouldAdvanceAfterError(undefined as never, undefined as never));
  assertEq(rBad, false, 'undefined class + undefined ctx -> false');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll providerErrorAdvanceCore smoke cases passed (' + passes + ' passed).');
}
main();
