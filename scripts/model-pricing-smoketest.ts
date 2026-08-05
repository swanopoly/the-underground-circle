/**
 * model-pricing-smoketest
 *
 * Pins the cost math in `src/lib/modelPricing.ts` — the single source of truth
 * for per-token pricing that drives cost estimates and (indirectly) approval
 * gates. Money math must be exact, so this hand-checks:
 *   - rate-table values against published Anthropic rates + the 25% buffer
 *   - dot→dash + provider-prefix normalization (per CLAUDE.md)
 *   - longest-key matching (so `gpt-5-4` never shadows `gpt-5-4-mini`, etc.)
 *   - cache-read discount applied to the RIGHT count (0.1x of input rate)
 *   - input vs output multipliers not swapped
 *   - degenerate inputs never throw / never NaN
 *
 * Pure module (zero imports) → tsx loads it directly.
 *
 * Run: npm run smoke:model-pricing
 */

import assert from 'node:assert/strict';

import {
  MODEL_PRICING,
  resolveModelRate,
  estimateCost,
  estimateCostWithCache,
} from '../src/lib/modelPricing';

const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;

// ─── Rate table sanity: buffer model is internally consistent ─────────────────
// Published Anthropic rates × 1.25 buffer (CLAUDE.md / modelPricing header):
//   Opus 4.6+  $5/$25  → 6.25 / 31.25
//   Sonnet 4.6 $3/$15  → 3.75 / 18.75
//   Haiku 4.5  $1/$5   → 1.25 / 6.25
//   Fable 5    $10/$50 → 12.50 / 62.50
// And cache-read is 0.10× the (buffered) input rate.
const RATE_EXPECT: Array<[string, number, number]> = [
  ['claude-opus-4-8', 6.25, 31.25],
  ['claude-opus-4-7', 6.25, 31.25],
  ['claude-opus-4-6', 6.25, 31.25],
  ['claude-sonnet-4-6', 3.75, 18.75],
  ['claude-haiku-4-5', 1.25, 6.25],
  ['claude-fable-5', 12.50, 62.50],
];
for (const [key, inR, outR] of RATE_EXPECT) {
  const r = MODEL_PRICING[key];
  assert(r, `${key} present in pricing table`);
  assert.equal(r.inPer1M, inR, `${key} input rate = ${inR}`);
  assert.equal(r.outPer1M, outR, `${key} output rate = ${outR}`);
  // cache-read must be the discounted read rate (0.1x input), never the input rate.
  assert(approx(r.cachedInPer1M, inR * 0.1), `${key} cache-read = 0.1x input (${inR * 0.1}), got ${r.cachedInPer1M}`);
  // output must cost MORE than input for every Claude model (guards a swap).
  assert(r.outPer1M > r.inPer1M, `${key} output rate > input rate (multipliers not swapped)`);
}

// Every entry: output >= input and cache-read <= input (never a premium).
for (const [key, r] of Object.entries(MODEL_PRICING)) {
  assert(r.outPer1M >= r.inPer1M, `${key}: output rate is never below input rate`);
  assert(r.cachedInPer1M <= r.inPer1M, `${key}: cache-read rate never exceeds full input rate`);
  assert(r.inPer1M >= 0 && r.outPer1M >= 0 && r.cachedInPer1M >= 0, `${key}: no negative rates`);
}

// ─── resolveModelRate: normalization + longest-match ──────────────────────────

// dot → dash normalization (4.8 → 4-8).
assert.equal(resolveModelRate('claude-opus-4.8').label, 'Claude Opus 4.8', 'dots normalized to dashes');
assert.equal(resolveModelRate('claude-opus-4-8').label, 'Claude Opus 4.8', 'exact dash form matches');

// provider prefix + nested prefix are both matched (substring includes handles depth).
assert.equal(resolveModelRate('anthropic/claude-opus-4-8').inPer1M, 6.25, 'single provider prefix ok');
assert.equal(resolveModelRate('openrouter/anthropic/claude-opus-4-8').inPer1M, 6.25, 'nested provider prefix ok');
assert.equal(resolveModelRate('google_ai/gemini-2.5-pro').label, 'Gemini 2.5 Pro', 'underscore provider + dotted ver');

// Date-suffixed variants still resolve to the base model.
assert.equal(resolveModelRate('claude-haiku-4-5-20251001').label, 'Claude Haiku 4.5', 'date suffix ignored');

// Longest-key wins — the critical collision guard.
assert.equal(resolveModelRate('gpt-5-4').label, 'GPT-5.4', 'gpt-5-4 exact');
assert.equal(resolveModelRate('gpt-5-4-mini').label, 'GPT-5.4 Mini', 'gpt-5-4-mini not shadowed by gpt-5-4');
assert.equal(resolveModelRate('gpt-5-5').label, 'GPT-5.5', 'gpt-5-5 exact');
assert.equal(resolveModelRate('gpt-5-5-pro').label, 'GPT-5.5 Pro', 'gpt-5-5-pro not shadowed by gpt-5-5');
assert.equal(resolveModelRate('sonar').label, 'Sonar', 'sonar exact');
assert.equal(resolveModelRate('sonar-pro').label, 'Sonar Pro', 'sonar-pro not shadowed by sonar');
assert.equal(resolveModelRate('o3').label, 'OpenAI o3', 'o3 exact');
assert.equal(resolveModelRate('o3-mini').label, 'o3 Mini', 'o3-mini not shadowed by o3');
assert.equal(resolveModelRate('claude-haiku-4-5').label, 'Claude Haiku 4.5', 'haiku-4-5 beats bare claude-haiku');

// Unknown / undefined → the documented default (never a throw, never Opus rates).
assert.equal(resolveModelRate(undefined).label, 'Unknown Model', 'undefined → default');
assert.equal(resolveModelRate('').label, 'Unknown Model', 'empty → default');
assert.equal(resolveModelRate('totally-made-up-model').label, 'Unknown Model', 'unknown → default');

// ─── estimateCostWithCache: the four-count → USD conversion ────────────────────
// USD = (cached*cacheRead + new*in + out*out) / 1e6

// Opus 4.8: 2M cache-read + 1M new + 500k out
// = 2e6*0.625 + 1e6*6.25 + 5e5*31.25 = 1.25 + 6.25 + 15.625 = 23.125
assert(approx(estimateCostWithCache('claude-opus-4-8', 2_000_000, 1_000_000, 500_000), 23.125),
  'Opus 4.8 cache-aware cost = $23.125');

// Sonnet 4.6: 100k cache + 10k new + 5k out
// = 1e5*0.375 + 1e4*3.75 + 5e3*18.75 = 0.0375 + 0.0375 + 0.09375 = 0.16875
assert(approx(estimateCostWithCache('claude-sonnet-4-6', 100_000, 10_000, 5_000), 0.16875),
  'Sonnet 4.6 cache-aware cost = $0.16875');

// Cache-read tokens must be CHEAPER than the same count of new tokens
// (proves the discounted rate is applied to the cached count, not the input rate).
{
  const cachedOnly = estimateCostWithCache('claude-opus-4-8', 1_000_000, 0, 0);
  const newOnly = estimateCostWithCache('claude-opus-4-8', 0, 1_000_000, 0);
  assert(approx(cachedOnly, 0.625), '1M cache-read on Opus 4.8 = $0.625');
  assert(approx(newOnly, 6.25), '1M new input on Opus 4.8 = $6.25');
  assert(approx(cachedOnly, newOnly * 0.1), 'cache-read is exactly 10% of the new-input cost');
}

// Output must be billed at the output rate, distinct from input.
{
  const outOnly = estimateCostWithCache('claude-opus-4-8', 0, 0, 1_000_000);
  assert(approx(outOnly, 31.25), '1M output on Opus 4.8 = $31.25 (output rate, not input)');
}

// ─── estimateCost (no cache split): full input price for all input ────────────
// Haiku 4.5: 1M in + 1M out = 1.25 + 6.25 = 7.5
assert(approx(estimateCost('claude-haiku-4-5', 1_000_000, 1_000_000), 7.5),
  'Haiku 4.5 simple estimate = $7.50');
// Ordering guard: swapping in/out counts changes the price (they are not symmetric).
assert(
  estimateCost('claude-opus-4-8', 1_000_000, 0) !== estimateCost('claude-opus-4-8', 0, 1_000_000),
  'input-heavy and output-heavy costs differ (multipliers applied to the right counts)',
);
assert(
  estimateCost('claude-opus-4-8', 0, 1_000_000) > estimateCost('claude-opus-4-8', 1_000_000, 0),
  'output-heavy costs more than input-heavy on Opus (output rate is higher)',
);

// ─── Zero-cost / degenerate inputs never throw, never NaN ─────────────────────
assert.equal(estimateCost('ollama', 999_999, 999_999), 0, 'zero-rate model → $0');
assert.equal(estimateCostWithCache('blackswan-7b', 1, 1, 1), 0, 'zero-rate model cache-aware → $0');
assert.equal(estimateCost('claude-opus-4-8', 0, 0), 0, 'zero tokens → $0');
assert.equal(estimateCostWithCache('claude-opus-4-8', 0, 0, 0), 0, 'zero tokens cache-aware → $0');
assert(Number.isFinite(estimateCost(undefined, 1000, 1000)), 'undefined model → finite cost via default');
assert(Number.isFinite(estimateCostWithCache('x', 1, 2, 3)), 'unknown model → finite cost via default');

console.log('All model pricing smoke cases passed.');
