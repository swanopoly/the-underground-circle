// routing-resilience — a golden-case corpus module extending the deterministic
// eval net (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md ADD #1) over the
// three PURE cores that keep cross-provider routing RESILIENT under failure:
//
//   • providerErrorAdvanceCore — should a fallback chain advance past a route
//     that just threw? (classify the error, then decide advance/stop)
//   • oscillationDetectorCore  — is the tool loop stuck in an A-B-A-B thrash of
//     failing calls the exact-repeat guard misses?
//   • providerBackoffCore      — how long should a durably-dead provider be
//     deprioritized (escalating cooldown window)?
//
// Each case runs the REAL core on a FROZEN input and returns true iff the output
// equals the value CAPTURED from that core (never invented). If a consolidation
// drifts any of these behaviors, its case flips pass→fail and the aggregator
// smoke exits non-zero. Same contract as `../coreGoldenCorpus`: this module is
// the PURITY EXCEPTION that imports the cores AT RUNTIME to exercise them — every
// imported core is itself dependency-light + tsx-loadable, so the aggregator runs
// under tsx with no react-native / supabase / deno in the graph. Every `run()` is
// self-contained and defensive; a throwing case is caught by the aggregator, but
// these return clean booleans.

import type { CoreGoldenCase } from '../coreGoldenCorpus';
import { classifyProviderError, shouldAdvanceAfterError } from '../../src/lib/providerErrorAdvanceCore';
import { detectOscillatingFailure } from '../../src/lib/oscillationDetectorCore';
import { backoffWindowMs, isCoolingDown, PROVIDER_BACKOFF_MAX_WINDOW_MS } from '../../src/lib/providerBackoffCore';

// The exact JSON of the "not stuck" verdict — the frozen safe-neutral shape
// oscillationDetectorCore returns (in {stuck,pattern,reason} construction order)
// for every non-oscillating history. Pinning the literal catches a drift that
// added a field or changed the empty-string neutrals.
const OSC_NOT_STUCK_JSON = '{"stuck":false,"pattern":"","reason":""}';

export const CASES: CoreGoldenCase[] = [
  // ── suite: provider-error-advance (providerErrorAdvanceCore) ────────────────
  {
    id: 'routing-resilience-provider-error-5xx-classifies-transient',
    suite: 'provider-error-advance',
    describe: 'a 503 (and the wider 5xx band) buckets as a transient error, the retry-worthy-anywhere class',
    run: () =>
      classifyProviderError({ status: 503 }) === 'transient' &&
      classifyProviderError({ status: 500 }) === 'transient' &&
      classifyProviderError({ status: 502 }) === 'transient',
  },
  {
    id: 'routing-resilience-provider-error-4xx-auth-classifies-auth',
    suite: 'provider-error-advance',
    describe: 'a 401/403 buckets as an auth error (the same key will keep failing on this provider)',
    run: () => classifyProviderError({ status: 401 }) === 'auth' && classifyProviderError({ status: 403 }) === 'auth',
  },
  {
    id: 'routing-resilience-transient-5xx-advances-when-any-route-remains',
    suite: 'provider-error-advance',
    describe: 'end-to-end: a transient 5xx error advances the fallback chain whenever ANY route (even same-provider) remains',
    run: () => {
      const cls = classifyProviderError({ status: 503 });
      return cls === 'transient' && shouldAdvanceAfterError(cls, { anyRouteRemains: true, differentProviderRemains: false }) === true;
    },
  },
  {
    id: 'routing-resilience-auth-4xx-does-not-advance-same-provider',
    suite: 'provider-error-advance',
    describe: 'end-to-end: a 4xx auth error does NOT advance to another same-provider route (only a different provider could help)',
    run: () => {
      const cls = classifyProviderError({ status: 401 });
      return cls === 'auth' && shouldAdvanceAfterError(cls, { anyRouteRemains: true, differentProviderRemains: false }) === false;
    },
  },
  {
    id: 'routing-resilience-auth-advances-only-to-different-provider',
    suite: 'provider-error-advance',
    describe: 'an auth failure advances the chain iff a DIFFERENT provider still remains, not on a same-provider-only remainder',
    run: () =>
      shouldAdvanceAfterError('auth', { anyRouteRemains: true, differentProviderRemains: true }) === true &&
      shouldAdvanceAfterError('auth', { anyRouteRemains: true, differentProviderRemains: false }) === false,
  },
  {
    id: 'routing-resilience-transient-stops-when-chain-exhausted',
    suite: 'provider-error-advance',
    describe: 'even a transient error stops (no advance) once no route of any kind remains in the chain',
    run: () => shouldAdvanceAfterError('transient', { anyRouteRemains: false, differentProviderRemains: false }) === false,
  },
  {
    id: 'routing-resilience-status-code-classification-table',
    suite: 'provider-error-advance',
    describe: 'the decisive status codes bucket exactly: 429→rate_limit, 529→overload, 404→not_found, 408→transient',
    run: () =>
      classifyProviderError({ status: 429 }) === 'rate_limit' &&
      classifyProviderError({ status: 529 }) === 'overload' &&
      classifyProviderError({ status: 404 }) === 'not_found' &&
      classifyProviderError({ status: 408 }) === 'transient',
  },
  {
    id: 'routing-resilience-message-heuristic-and-permanent-failsafe',
    suite: 'provider-error-advance',
    describe: "a status-less 'invalid api key' message reads as auth, while an unclassifiable error fails safe to permanent",
    run: () =>
      classifyProviderError('invalid api key') === 'auth' &&
      classifyProviderError('connection timeout') === 'transient' &&
      classifyProviderError({}) === 'permanent' &&
      classifyProviderError(null) === 'permanent',
  },
  {
    id: 'routing-resilience-advance-hostile-ctx-fails-closed',
    suite: 'provider-error-advance',
    describe: 'a null/garbage remaining-route context is treated as nothing-remains → stop (never throws, fails closed)',
    run: () =>
      shouldAdvanceAfterError('transient', null as unknown as { anyRouteRemains: boolean; differentProviderRemains: boolean }) === false &&
      shouldAdvanceAfterError('auth', {} as { anyRouteRemains: boolean; differentProviderRemains: boolean }) === false,
  },

  // ── suite: oscillation-detector (oscillationDetectorCore) ───────────────────
  {
    id: 'routing-resilience-oscillation-abab-detected',
    suite: 'oscillation-detector',
    describe: 'an A-B-A-B run of failing calls (2 full cycles of a period-2 block) is flagged stuck with the cycle pattern',
    run: () => {
      const v = detectOscillatingFailure([
        { name: 'A', ok: false },
        { name: 'B', ok: false },
        { name: 'A', ok: false },
        { name: 'B', ok: false },
      ]);
      return (
        v.stuck === true &&
        v.pattern === 'A→B' &&
        typeof v.reason === 'string' &&
        v.reason.startsWith('oscillating failing tool-call cycle') &&
        v.reason.includes('A→B')
      );
    },
  },
  {
    id: 'routing-resilience-oscillation-distinct-rounds-not-stuck',
    suite: 'oscillation-detector',
    describe: 'four distinct failing calls (A-B-C-D, no repeating block) are not an oscillation',
    run: () =>
      JSON.stringify(
        detectOscillatingFailure([
          { name: 'A', ok: false },
          { name: 'B', ok: false },
          { name: 'C', ok: false },
          { name: 'D', ok: false },
        ]),
      ) === OSC_NOT_STUCK_JSON,
  },
  {
    id: 'routing-resilience-oscillation-identical-block-deferred',
    suite: 'oscillation-detector',
    describe: 'an all-identical failing run (A-A-A-A, a period-1 exact repeat) is deferred to the exact-repeat guard, not flagged here',
    run: () =>
      JSON.stringify(
        detectOscillatingFailure([
          { name: 'A', ok: false },
          { name: 'A', ok: false },
          { name: 'A', ok: false },
          { name: 'A', ok: false },
        ]),
      ) === OSC_NOT_STUCK_JSON,
  },
  {
    id: 'routing-resilience-oscillation-success-cuts-the-run',
    suite: 'oscillation-detector',
    describe: 'a success anywhere in the trailing run breaks the failure chain, so an interrupted A-B-A-B is not stuck (no success in between)',
    run: () =>
      JSON.stringify(
        detectOscillatingFailure([
          { name: 'A', ok: false },
          { name: 'B', ok: false },
          { name: 'A', ok: true },
          { name: 'B', ok: false },
        ]),
      ) === OSC_NOT_STUCK_JSON,
  },
  {
    id: 'routing-resilience-oscillation-argskey-disambiguates-symbols',
    suite: 'oscillation-detector',
    describe: 'argsKey splits same-named calls into distinct symbols so click(Export)/click(Save) reads as a two-symbol cycle',
    run: () => {
      const v = detectOscillatingFailure([
        { name: 'click', ok: false, argsKey: 'Export' },
        { name: 'click', ok: false, argsKey: 'Save' },
        { name: 'click', ok: false, argsKey: 'Export' },
        { name: 'click', ok: false, argsKey: 'Save' },
      ]);
      return v.stuck === true && v.pattern === 'click#Export→click#Save';
    },
  },
  {
    id: 'routing-resilience-oscillation-needs-two-full-cycles',
    suite: 'oscillation-detector',
    describe: 'a single A-B cycle (fewer than the minimum 2 cycles) is not yet an oscillation',
    run: () =>
      JSON.stringify(
        detectOscillatingFailure([
          { name: 'A', ok: false },
          { name: 'B', ok: false },
        ]),
      ) === OSC_NOT_STUCK_JSON,
  },
  {
    id: 'routing-resilience-oscillation-empty-and-null-total',
    suite: 'oscillation-detector',
    describe: 'an empty history and a null input both collapse to the safe neutral not-stuck verdict (total, never throws)',
    run: () =>
      JSON.stringify(detectOscillatingFailure([])) === OSC_NOT_STUCK_JSON &&
      JSON.stringify(detectOscillatingFailure(null)) === OSC_NOT_STUCK_JSON,
  },

  // ── suite: provider-backoff (providerBackoffCore) ───────────────────────────
  {
    id: 'routing-resilience-backoff-zero-failures-is-base',
    suite: 'provider-backoff',
    describe: 'zero consecutive failures yields exactly the base window (2^0 = 1×) — no escalation beyond base',
    run: () => backoffWindowMs(0, 30000) === 30000,
  },
  {
    id: 'routing-resilience-backoff-escalates-monotonic',
    suite: 'provider-backoff',
    describe: 'consecutive failures double the window (30k→60k→120k→240k), strictly increasing across 0..3',
    run: () => {
      const w0 = backoffWindowMs(0, 30000);
      const w1 = backoffWindowMs(1, 30000);
      const w2 = backoffWindowMs(2, 30000);
      const w3 = backoffWindowMs(3, 30000);
      return w0 === 30000 && w1 === 60000 && w2 === 120000 && w3 === 240000 && w0 < w1 && w1 < w2 && w2 < w3;
    },
  },
  {
    id: 'routing-resilience-backoff-multiplier-ceiling',
    suite: 'provider-backoff',
    describe: 'the 2^n multiplier is capped at 8×, so 4 and 10 failures both plateau at 240k (never 2^10 × base)',
    run: () => backoffWindowMs(4, 30000) === 240000 && backoffWindowMs(10, 30000) === 240000,
  },
  {
    id: 'routing-resilience-backoff-absolute-window-ceiling',
    suite: 'provider-backoff',
    describe: 'a huge base window still cannot exceed the absolute 8-minute ceiling — the head-of-line fix never becomes offline-forever',
    run: () => backoffWindowMs(10, 100000) === 480000 && backoffWindowMs(10, 100000) === PROVIDER_BACKOFF_MAX_WINDOW_MS,
  },
  {
    id: 'routing-resilience-backoff-negative-count-floors-to-base',
    suite: 'provider-backoff',
    describe: 'a negative/garbage failure count coerces to zero failures → base window (total, never negative)',
    run: () => backoffWindowMs(-1, 30000) === 30000 && backoffWindowMs('bad' as unknown, 30000) === 30000,
  },
  {
    id: 'routing-resilience-backoff-cooling-zero-failures-false',
    suite: 'provider-backoff',
    describe: 'with zero disqualifying failures a provider is never reported cooling down (stays eligible)',
    run: () => isCoolingDown({ lastFailureAtMs: 1000, consecutiveFailures: 0, nowMs: 1000 }) === false,
  },
  {
    id: 'routing-resilience-backoff-cooling-window-boundary',
    suite: 'provider-backoff',
    describe: 'a 1-failure provider is cooling while inside its 60s window and eligible once elapsed passes it',
    run: () =>
      isCoolingDown({ lastFailureAtMs: 1000, consecutiveFailures: 1, nowMs: 1000 + 30000 }) === true &&
      isCoolingDown({ lastFailureAtMs: 1000, consecutiveFailures: 1, nowMs: 1000 + 60001 }) === false,
  },
  {
    id: 'routing-resilience-backoff-cooling-future-skew-false',
    suite: 'provider-backoff',
    describe: 'a failure timestamp in the future (clock skew) reads as not-cooling rather than a negative window',
    run: () => isCoolingDown({ lastFailureAtMs: 5000, consecutiveFailures: 3, nowMs: 1000 }) === false,
  },
];
