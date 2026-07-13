// Smoke test for agentCostForecastCore — pure, tsx-loadable, deterministic.
// Run: npx tsx scripts/agent-cost-forecast-core-smoketest.ts
import {
  DEFAULT_TIER_RATES,
  inferTier,
  forecastCost,
  type PlannedCall,
} from '../src/lib/agentCostForecastCore';

let passed = 0;
let failed = 0;

function assert(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

function approx(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

// ---------------------------------------------------------------------------
// inferTier — substring inference
// ---------------------------------------------------------------------------
assert('inferTier haiku -> fast', inferTier('claude-haiku-4-5') === 'fast');
assert('inferTier flash -> fast', inferTier('google_ai/gemini-1.5-flash') === 'fast');
assert('inferTier mini -> fast', inferTier('gpt-4o-mini') === 'fast');
assert('inferTier -8b -> fast', inferTier('llama-3-8b-instruct') === 'fast');
assert('inferTier blackswan+nano markers -> nano', inferTier('huggingface_endpoint/cswan801/BlackSwan-v5-nano') === 'nano');
assert('inferTier blackswan (no cheap marker) -> strong', inferTier('cswan801/BlackSwan-v5') === 'strong');
assert('inferTier qwen mini -> nano', inferTier('qwen2.5-mini') === 'nano');
assert('inferTier bare nano -> nano', inferTier('some-nano-model') === 'nano');
assert('inferTier opus -> frontier', inferTier('claude-opus-4-8') === 'frontier');
assert('inferTier gpt-5 -> frontier', inferTier('openai/gpt-5') === 'frontier');
assert('inferTier sonnet-4 -> frontier (frontier wins over strong)', inferTier('claude-sonnet-4-5') === 'frontier');
assert('inferTier gemini-2.5-pro -> frontier', inferTier('google_ai/gemini-2.5-pro') === 'frontier');
assert('inferTier reasoner -> frontier', inferTier('deepseek/deepseek-reasoner') === 'frontier');
assert('inferTier plain sonnet -> strong', inferTier('claude-3-sonnet') === 'strong');
assert('inferTier gpt-4 -> strong', inferTier('gpt-4o') === 'strong');
assert('inferTier deepseek (non-reasoner) -> strong', inferTier('deepseek/deepseek-chat') === 'strong');
assert('inferTier large -> strong', inferTier('mistral-large-latest') === 'strong');
assert('inferTier unknown -> strong (fail-safe)', inferTier('totally-made-up-model') === 'strong');
assert('inferTier empty -> strong', inferTier('') === 'strong');
assert('inferTier non-string -> strong', inferTier(undefined as unknown as string) === 'strong');

// ---------------------------------------------------------------------------
// forecastCost — single call math
// ---------------------------------------------------------------------------
{
  // strong: input 1M @ $3, output 1M @ $15 => $18.00
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 1_000_000 }]);
  assert('single strong call = $18.00', approx(f.totalUsd, 18));
  assert('single call callCount = 1', f.callCount === 1);
  assert('single call byTier.strong = 18', approx(f.byTier.strong, 18));
  assert('single call uncapped -> proceed', f.recommendation === 'proceed');
  assert('single call capUsd null', f.capUsd === null);
  assert('single call overCap false', f.overCap === false);
}

{
  // nano: 500k in @0.1 = 0.05, 250k out @0.4 = 0.10 => 0.15
  const f = forecastCost([{ model: 'x', tier: 'nano', estInputTokens: 500_000, estOutputTokens: 250_000 }]);
  assert('nano fractional call = $0.15', approx(f.totalUsd, 0.15));
}

// ---------------------------------------------------------------------------
// forecastCost — multi-call sum + count multiplier
// ---------------------------------------------------------------------------
{
  const calls: PlannedCall[] = [
    { model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 1_000_000 }, // $18 strong
    { model: 'claude-haiku-4-5', estInputTokens: 1_000_000, estOutputTokens: 1_000_000, count: 2 }, // fast: (0.8+4)*2 = 9.6
  ];
  const f = forecastCost(calls);
  assert('multi-call total = 27.60', approx(f.totalUsd, 27.6));
  assert('multi-call callCount = 3 (1 + 2)', f.callCount === 3);
  assert('multi-call byTier.strong = 18', approx(f.byTier.strong, 18));
  assert('multi-call byTier.fast = 9.60', approx(f.byTier.fast, 9.6));
  assert('byTier sums to total', approx(f.byTier.strong + f.byTier.fast, f.totalUsd));
}

{
  // count multiplier: 3x a $2 call => $6
  const f = forecastCost([{ model: 'x', tier: 'strong', estInputTokens: 0, estOutputTokens: 400_000, count: 3 }]);
  // 400k out @15 = 6.0 per call; *3 = 18
  assert('count=3 multiplier applied', approx(f.totalUsd, 18));
  assert('count=3 callCount = 3', f.callCount === 3);
}

// ---------------------------------------------------------------------------
// explicit tier overrides inference
// ---------------------------------------------------------------------------
{
  // model id says opus (frontier) but explicit tier nano should win
  const f = forecastCost([{ model: 'claude-opus-4-8', tier: 'nano', estInputTokens: 1_000_000, estOutputTokens: 0 }]);
  assert('explicit tier overrides inference (nano rate)', approx(f.totalUsd, 0.1));
  assert('explicit tier -> byTier.nano present', 'nano' in f.byTier);
  assert('explicit tier -> byTier.frontier absent', !('frontier' in f.byTier));
}

// ---------------------------------------------------------------------------
// cap trip: over / under / exactly
// ---------------------------------------------------------------------------
{
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 1_000_000 }], { capUsd: 20 });
  assert('under cap ($18 < $20) overCap false', f.overCap === false);
  assert('under cap -> proceed', f.recommendation === 'proceed');
  assert('under cap capUsd = 20', f.capUsd === 20);
}
{
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 1_000_000 }], { capUsd: 10 });
  assert('over cap ($18 > $10) overCap true', f.overCap === true);
  assert('over cap (<= 2x) -> approve', f.recommendation === 'approve');
}
{
  // exactly on cap: $18 total, cap 18 => not over (strictly greater)
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 1_000_000 }], { capUsd: 18 });
  assert('exactly on cap overCap false', f.overCap === false);
  assert('exactly on cap -> proceed', f.recommendation === 'proceed');
}

// ---------------------------------------------------------------------------
// 2x cap -> reduce
// ---------------------------------------------------------------------------
{
  // $18 total, cap 5 => 18 > 2*5(=10) => reduce
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 1_000_000 }], { capUsd: 5 });
  assert('over 2x cap -> reduce', f.recommendation === 'reduce');
  assert('over 2x cap overCap still true', f.overCap === true);
}
{
  // just above 2x boundary: cap 8.99, 2x = 17.98, total 18 > 17.98 => reduce
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 1_000_000 }], { capUsd: 8.99 });
  assert('total just over 2x cap -> reduce', f.recommendation === 'reduce');
}
{
  // exactly 2x: cap 9, 2x = 18, total 18 -> NOT > 18 -> approve (not reduce)
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 1_000_000 }], { capUsd: 9 });
  assert('total exactly 2x cap -> approve (not reduce)', f.recommendation === 'approve');
}

// ---------------------------------------------------------------------------
// custom rates override defaults
// ---------------------------------------------------------------------------
{
  const f = forecastCost(
    [{ model: 'x', tier: 'strong', estInputTokens: 1_000_000, estOutputTokens: 1_000_000 }],
    { rates: { strong: { inputPerMTok: 1, outputPerMTok: 1 } } },
  );
  assert('custom strong rate applied ($2 not $18)', approx(f.totalUsd, 2));
}
{
  // partial override: only override nano; strong should still use default
  const f = forecastCost(
    [
      { model: 'x', tier: 'nano', estInputTokens: 1_000_000, estOutputTokens: 0 },
      { model: 'y', tier: 'strong', estInputTokens: 1_000_000, estOutputTokens: 0 },
    ],
    { rates: { nano: { inputPerMTok: 99, outputPerMTok: 0 } } },
  );
  // nano: 99, strong: default 3 => 102
  assert('partial rate override: nano custom + strong default', approx(f.totalUsd, 102));
}
assert('DEFAULT_TIER_RATES frozen shape (frontier output 75)', DEFAULT_TIER_RATES.frontier.outputPerMTok === 75);

// ---------------------------------------------------------------------------
// negative / NaN / undefined tokens clamp to 0
// ---------------------------------------------------------------------------
{
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: -1_000_000, estOutputTokens: -500_000 }]);
  assert('negative tokens clamp to 0', f.totalUsd === 0);
  assert('negative tokens -> proceed', f.recommendation === 'proceed');
}
{
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: NaN, estOutputTokens: 1_000_000 }]);
  // NaN input -> 0; output 1M strong @15 => 15
  assert('NaN input clamps to 0 (output still counts)', approx(f.totalUsd, 15));
}
{
  const f = forecastCost([
    { model: 'gpt-4o', estInputTokens: undefined as unknown as number, estOutputTokens: undefined as unknown as number },
  ]);
  assert('undefined tokens clamp to 0', f.totalUsd === 0);
  assert('undefined tokens callCount = 1 (default count)', f.callCount === 1);
}
{
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: Infinity, estOutputTokens: 1_000_000 }]);
  assert('Infinity input clamps to 0', approx(f.totalUsd, 15));
}

// count clamp: negative / NaN / 0 -> 1
{
  const f = forecastCost([{ model: 'x', tier: 'strong', estInputTokens: 0, estOutputTokens: 1_000_000, count: -5 }]);
  assert('negative count clamps to 1 (cost = 15)', approx(f.totalUsd, 15));
  assert('negative count -> callCount 1', f.callCount === 1);
}
{
  const f = forecastCost([{ model: 'x', tier: 'strong', estInputTokens: 0, estOutputTokens: 1_000_000, count: 0 }]);
  assert('zero count clamps to 1', f.callCount === 1);
}
{
  const f = forecastCost([{ model: 'x', tier: 'strong', estInputTokens: 0, estOutputTokens: 1_000_000, count: NaN }]);
  assert('NaN count clamps to 1', f.callCount === 1);
}
{
  const f = forecastCost([{ model: 'x', tier: 'strong', estInputTokens: 0, estOutputTokens: 1_000_000, count: 2.9 }]);
  assert('fractional count floors to 2', f.callCount === 2);
}

// ---------------------------------------------------------------------------
// byTier breakdown sums to total (multi-tier)
// ---------------------------------------------------------------------------
{
  const calls: PlannedCall[] = [
    { model: 'claude-opus-4-8', estInputTokens: 100_000, estOutputTokens: 200_000 }, // frontier
    { model: 'gpt-4o', estInputTokens: 300_000, estOutputTokens: 100_000 }, // strong
    { model: 'gpt-4o-mini', estInputTokens: 500_000, estOutputTokens: 500_000, count: 4 }, // fast
    { model: 'BlackSwan-v5-nano', estInputTokens: 1_000_000, estOutputTokens: 0 }, // nano
  ];
  const f = forecastCost(calls);
  const sum = Object.values(f.byTier).reduce((a, b) => a + b, 0);
  assert('multi-tier byTier sums to total', approx(sum, f.totalUsd, 0.005));
  assert('multi-tier has all four tiers', ['nano', 'fast', 'strong', 'frontier'].every((t) => t in f.byTier));
  assert('multi-tier callCount = 7 (1+1+4+1)', f.callCount === 7);
}

// ---------------------------------------------------------------------------
// empty / malformed calls -> 0 / proceed
// ---------------------------------------------------------------------------
{
  const f = forecastCost([]);
  assert('empty calls total 0', f.totalUsd === 0);
  assert('empty calls callCount 0', f.callCount === 0);
  assert('empty calls byTier empty', Object.keys(f.byTier).length === 0);
  assert('empty calls -> proceed', f.recommendation === 'proceed');
  assert('empty calls overCap false', f.overCap === false);
}
{
  const f = forecastCost([], { capUsd: 0 });
  assert('empty calls with cap 0 -> proceed (0 not > 0)', f.recommendation === 'proceed');
  assert('empty calls with cap 0 overCap false', f.overCap === false);
  assert('cap 0 preserved as capUsd 0', f.capUsd === 0);
}
{
  const f = forecastCost(null as unknown as PlannedCall[]);
  assert('null calls -> total 0', f.totalUsd === 0);
}
{
  const f = forecastCost([null as unknown as PlannedCall, undefined as unknown as PlannedCall, { model: 'x', tier: 'nano', estInputTokens: 1_000_000, estOutputTokens: 0 }]);
  assert('null/undefined entries skipped, valid one counts', approx(f.totalUsd, 0.1));
  assert('null/undefined entries not counted in callCount', f.callCount === 1);
}
{
  // negative cap -> treated as uncapped (capUsd null)
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 0 }], { capUsd: -10 });
  assert('negative cap -> uncapped (capUsd null)', f.capUsd === null);
  assert('negative cap -> proceed', f.recommendation === 'proceed');
}
{
  // NaN cap -> uncapped
  const f = forecastCost([{ model: 'gpt-4o', estInputTokens: 1_000_000, estOutputTokens: 0 }], { capUsd: NaN });
  assert('NaN cap -> uncapped (capUsd null)', f.capUsd === null);
}

// ---------------------------------------------------------------------------
// mass-deploy scenario: 50 nano agents against a $10 cap
// ---------------------------------------------------------------------------
{
  const f = forecastCost(
    [{ model: 'BlackSwan-v5-nano', tier: 'nano', estInputTokens: 200_000, estOutputTokens: 100_000, count: 50 }],
    { capUsd: 10 },
  );
  // per call: 0.2*0.1 + 0.1*0.4 = 0.02 + 0.04 = 0.06; *50 = 3.00
  assert('50 nano agents = $3.00', approx(f.totalUsd, 3));
  assert('50 nano agents callCount 50', f.callCount === 50);
  assert('50 nano agents under $10 cap -> proceed', f.recommendation === 'proceed');
}

// ---------------------------------------------------------------------------
console.log(`agent-cost-forecast-core smoke: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
