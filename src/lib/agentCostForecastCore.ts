// agentCostForecastCore — the PURE cost-forecast brain for an agent run. Given a
// planned list of model calls (tier + token estimates), it estimates the run's
// USD cost and gates it against a budget cap. It does NOT price live usage or
// call any provider: it turns a *plan* into a bounded dollar forecast plus a
// proceed/approve/reduce recommendation. This feeds the mass-deploy $ cap,
// Office budget alerts, and pre-run approval banners.
//
// Posture (fail-safe = do not UNDER-estimate): an unknown model id resolves to
// the 'strong' tier rather than the cheapest, so a surprise cost is more likely
// to trip the cap than to slip under it silently. Token counts that are
// negative, NaN, undefined, or non-finite clamp to 0 (never negative), and
// `count` clamps up to a minimum of 1. The cap comparison is strictly greater
// than (`> cap`), so a forecast landing exactly on the cap is allowed to
// proceed.
//
// PURITY: zero imports, tsx-loadable (smoke: agent-cost-forecast-core). Never
// throws. DETERMINISTIC: no Date.now / Math.random.

export type CostTier = 'nano' | 'fast' | 'strong' | 'frontier';

export interface PlannedCall {
  model: string;
  /** Optional explicit tier; when set it overrides model-id inference. */
  tier?: CostTier;
  estInputTokens: number;
  estOutputTokens: number;
  /** How many times this call runs (fan-out). Clamped to >= 1. */
  count?: number;
}

/** USD per 1,000,000 tokens. */
export interface TierRate {
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface CostForecast {
  /** Sum of every call's cost, rounded to whole cents (USD). */
  totalUsd: number;
  /** Per-tier subtotal (USD, rounded to cents); only tiers that appear. */
  byTier: Record<string, number>;
  /** Sum of every call's clamped count. */
  callCount: number;
  /** The budget cap in effect, or null when uncapped. */
  capUsd: number | null;
  /** true when capUsd != null and totalUsd strictly exceeds it. */
  overCap: boolean;
  /**
   * 'reduce'  — over 2x the cap; the plan should be trimmed before running.
   * 'approve' — over the cap (but <= 2x); needs explicit approval.
   * 'proceed' — within cap (or uncapped); safe to run.
   */
  recommendation: 'proceed' | 'approve' | 'reduce';
}

// Approximate ballpark rates (USD per 1,000,000 tokens). These are deliberately
// rough order-of-magnitude figures for pre-run budgeting, NOT authoritative
// per-model prices — callers can override any tier via opts.rates.
export const DEFAULT_TIER_RATES: Record<CostTier, TierRate> = {
  nano: { inputPerMTok: 0.1, outputPerMTok: 0.4 },
  fast: { inputPerMTok: 0.8, outputPerMTok: 4 },
  strong: { inputPerMTok: 3, outputPerMTok: 15 },
  frontier: { inputPerMTok: 15, outputPerMTok: 75 },
};

const ALL_TIERS: readonly CostTier[] = ['nano', 'fast', 'strong', 'frontier'];

function isTier(value: unknown): value is CostTier {
  return typeof value === 'string' && (ALL_TIERS as readonly string[]).includes(value);
}

/** Clamp a token estimate to a finite, non-negative number (NaN/undefined -> 0). */
function safeTokens(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

/** Clamp a fan-out count to an integer >= 1 (NaN/undefined/<=0 -> 1). */
function safeCount(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

/** Round a USD amount to whole cents; guards non-finite to 0. */
function roundCents(usd: number): number {
  if (!Number.isFinite(usd) || usd <= 0) return 0;
  return Math.round(usd * 100) / 100;
}

/**
 * Infer a cost tier from a model id by substring. Fail-safe: anything
 * unrecognized resolves to 'strong' so we do not under-estimate cost.
 *
 * Order matters. Frontier markers (opus, gpt-5, sonnet-4, gemini-2.5-pro,
 * reasoner) win first so they are not mis-caught by the broader 'sonnet' /
 * 'gpt-4' strong rules. Cheap markers (haiku/flash/mini/-8b/nano) then split
 * into 'nano' (blackswan/qwen/nano families) vs 'fast'.
 */
export function inferTier(model: string): CostTier {
  const id = typeof model === 'string' ? model.toLowerCase() : '';
  if (!id) return 'strong';

  // 1) Frontier markers — highest cost, checked before the strong substrings
  //    so e.g. "sonnet-4" and "gemini-2.5-pro" are not downgraded.
  if (
    id.includes('opus') ||
    id.includes('gpt-5') ||
    id.includes('sonnet-4') ||
    id.includes('gemini-2.5-pro') ||
    id.includes('reasoner')
  ) {
    return 'frontier';
  }

  // 2) Cheap markers — nano vs fast. The nano families are the tiny in-house /
  //    open models; the generic small commercial models are 'fast'.
  const cheap =
    id.includes('haiku') ||
    id.includes('flash') ||
    id.includes('mini') ||
    id.includes('-8b') ||
    id.includes('nano');
  if (cheap) {
    if (id.includes('blackswan') || id.includes('qwen') || id.includes('nano')) return 'nano';
    return 'fast';
  }

  // 3) Strong markers — mid-tier flagship/large models.
  if (
    id.includes('sonnet') ||
    id.includes('gpt-4') ||
    id.includes('deepseek') ||
    id.includes('large')
  ) {
    return 'strong';
  }

  // 4) Unknown — fail-safe to 'strong' (do not under-estimate).
  return 'strong';
}

/**
 * Forecast the total USD cost of a planned list of model calls and gate it
 * against an optional budget cap. Never throws; every malformed input degrades
 * to a safe 0 / 'proceed'.
 */
export function forecastCost(
  calls: PlannedCall[],
  opts?: { capUsd?: number; rates?: Partial<Record<CostTier, TierRate>> },
): CostForecast {
  // Normalize the cap: only a finite, non-negative number counts; else uncapped.
  let capUsd: number | null = null;
  const rawCap = opts?.capUsd;
  if (typeof rawCap === 'number' && Number.isFinite(rawCap) && rawCap >= 0) {
    capUsd = rawCap;
  }

  const list = Array.isArray(calls) ? calls : [];

  // Accumulate un-rounded subtotals per tier so rounding happens once at the end.
  const rawByTier: Record<string, number> = {};
  let rawTotal = 0;
  let callCount = 0;

  for (const call of list) {
    if (!call || typeof call !== 'object') continue;

    const tier: CostTier = isTier(call.tier) ? call.tier : inferTier(call.model);

    // Resolve the rate: caller override for this tier, else the default. Guard
    // a malformed override so a bad rate does not poison the forecast.
    const override = opts?.rates ? opts.rates[tier] : undefined;
    const baseRate = DEFAULT_TIER_RATES[tier];
    const inputPerMTok =
      override && Number.isFinite(override.inputPerMTok) && override.inputPerMTok >= 0
        ? override.inputPerMTok
        : baseRate.inputPerMTok;
    const outputPerMTok =
      override && Number.isFinite(override.outputPerMTok) && override.outputPerMTok >= 0
        ? override.outputPerMTok
        : baseRate.outputPerMTok;

    const inTok = safeTokens(call.estInputTokens);
    const outTok = safeTokens(call.estOutputTokens);
    const count = safeCount(call.count);

    const perCall = (inTok / 1e6) * inputPerMTok + (outTok / 1e6) * outputPerMTok;
    const cost = perCall * count;

    rawByTier[tier] = (rawByTier[tier] || 0) + cost;
    rawTotal += cost;
    callCount += count;
  }

  const totalUsd = roundCents(rawTotal);
  const byTier: Record<string, number> = {};
  for (const key of Object.keys(rawByTier)) {
    byTier[key] = roundCents(rawByTier[key]);
  }

  const overCap = capUsd != null && totalUsd > capUsd;
  let recommendation: CostForecast['recommendation'] = 'proceed';
  if (capUsd != null && totalUsd > 2 * capUsd) {
    recommendation = 'reduce';
  } else if (overCap) {
    recommendation = 'approve';
  }

  return { totalUsd, byTier, callCount, capUsd, overCap, recommendation };
}
