/**
 * runCostRollupCore — pure cost estimation + rollup for agent runs
 * (run-observability expansion v7).
 *
 * Two responsibilities, both pure and total:
 *
 *  1. estimateRunCostUsd(...) — turn a run's model + token totals
 *     (input / output / cached, matching the agentRunPersistence token-total
 *     shape) into a USD estimate, so the long-dead agent_runs.estimated_cost
 *     column can finally be written at the run-completion sites. Per-model
 *     pricing via MODEL_PRICES (claude / gpt / gemini families + free
 *     self-hosted); unknown models fall back to a deliberately conservative
 *     (slightly HIGH) default so we never UNDER-report spend. Cached input is
 *     billed cheaper than fresh input, mirroring src/lib/modelPricing.ts.
 *
 *  2. rollupRunCosts(rows) — aggregate many RunCostRow into a CostRollup:
 *     total spend, WASTED spend (failed / max-iteration / timeout runs whose
 *     dollars produced no completed deliverable), and per-surface + per-day
 *     breakdowns for the office ops board.
 *
 * Purity: zero imports. Loads under tsx for the smoke. No Date.now()/random at
 * module scope. Every export is total — null / undefined / wrong-type / huge /
 * hostile / cyclic input yields a safe neutral value and never throws. Output is
 * bounded (row cap, group-key cap, per-value cost cap) and secret-safe (only
 * surface / day / status labels are ever echoed, never tokens or model secrets).
 */

// ── Pricing ──────────────────────────────────────────────────────────────────

export interface ModelPrice {
  /** USD per 1M non-cached ("fresh") input tokens. */
  inPer1M: number;
  /** USD per 1M output tokens. */
  outPer1M: number;
  /** USD per 1M cached-input tokens — always <= inPer1M ("cached cheaper"). */
  cachedInPer1M: number;
}

/**
 * Small per-family price map (USD per 1M tokens). Keys are already in the
 * normalized form model ids take after lowercasing + `.`→`-` + provider-prefix
 * strip, so longest-substring match resolves real ids like `claude-opus-5`,
 * `gpt-5-6-terra`, and `google_ai/gemini-3.6-flash`. Values sit at/above published rates
 * — this is a spend GUARD, so erring high is the safe direction. Self-hosted
 * (blackswan / ollama) is free. `default` is the conservative unknown fallback.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  // ── Anthropic Claude ──
  'claude-fable-5': { inPer1M: 10,  outPer1M: 50,   cachedInPer1M: 1 },
  'claude-opus-5': { inPer1M: 5,    outPer1M: 25,   cachedInPer1M: 0.5 },
  'claude-sonnet-5': { inPer1M: 3,  outPer1M: 15,   cachedInPer1M: 0.3 },
  'claude-haiku-4-5': { inPer1M: 1, outPer1M: 5,    cachedInPer1M: 0.1 },
  'claude-opus':   { inPer1M: 5,    outPer1M: 25,   cachedInPer1M: 0.5 },
  'claude-sonnet': { inPer1M: 3,    outPer1M: 15,   cachedInPer1M: 0.3 },
  'claude-haiku':  { inPer1M: 1,    outPer1M: 5,    cachedInPer1M: 0.1 },
  'claude':        { inPer1M: 3,    outPer1M: 15,   cachedInPer1M: 0.3 },
  // ── OpenAI GPT ──
  'gpt-5-6-sol':   { inPer1M: 5,    outPer1M: 30,   cachedInPer1M: 0.5 },
  'gpt-5-6-terra': { inPer1M: 2.5,  outPer1M: 15,   cachedInPer1M: 0.25 },
  'gpt-5-6-luna':  { inPer1M: 1,    outPer1M: 6,    cachedInPer1M: 0.1 },
  'gpt-5-5-pro':   { inPer1M: 30,   outPer1M: 180,  cachedInPer1M: 3 },
  'gpt-5-5':       { inPer1M: 5,    outPer1M: 30,   cachedInPer1M: 0.5 },
  'gpt-5-4-mini':  { inPer1M: 0.75, outPer1M: 4.5,  cachedInPer1M: 0.075 },
  'gpt-5-4-nano':  { inPer1M: 0.2,  outPer1M: 1.2,  cachedInPer1M: 0.02 },
  'gpt-5-4':       { inPer1M: 2.5,  outPer1M: 15,   cachedInPer1M: 0.25 },
  'o3-pro':        { inPer1M: 20,   outPer1M: 80,   cachedInPer1M: 5 },
  'o3':            { inPer1M: 10,   outPer1M: 40,   cachedInPer1M: 2.5 },
  'gpt-4o-mini':   { inPer1M: 0.15, outPer1M: 0.6,  cachedInPer1M: 0.075 },
  'gpt-4o':        { inPer1M: 2.5,  outPer1M: 10,   cachedInPer1M: 1.25 },
  'gpt-4':         { inPer1M: 3,    outPer1M: 12,   cachedInPer1M: 0.3 },
  'gpt-5':         { inPer1M: 5,    outPer1M: 30,   cachedInPer1M: 0.5 },
  'gpt':           { inPer1M: 2.5,  outPer1M: 10,   cachedInPer1M: 0.25 },
  // ── Google Gemini ──
  'gemini-3-6-flash': { inPer1M: 1.5, outPer1M: 7.5, cachedInPer1M: 0.15 },
  'gemini-3-5-flash-lite': { inPer1M: 0.3, outPer1M: 2.5, cachedInPer1M: 0.03 },
  'gemini-3-5-flash': { inPer1M: 1.5, outPer1M: 9, cachedInPer1M: 0.15 },
  'gemini-flash':  { inPer1M: 0.1,  outPer1M: 0.4,  cachedInPer1M: 0.01 },
  'gemini-pro':    { inPer1M: 1.25, outPer1M: 10,   cachedInPer1M: 0.31 },
  'gemini':        { inPer1M: 1.25, outPer1M: 10,   cachedInPer1M: 0.31 },
  // ── Self-hosted (zero marginal cost) ──
  'blackswan':     { inPer1M: 0,    outPer1M: 0,    cachedInPer1M: 0 },
  'ollama':        { inPer1M: 0,    outPer1M: 0,    cachedInPer1M: 0 },
  // ── Conservative unknown-model fallback (deliberately high) ──
  'default':       { inPer1M: 5,    outPer1M: 25,   cachedInPer1M: 0.5 },
};

const DEFAULT_PRICE: ModelPrice = MODEL_PRICES.default;

/** Cap a single token count: non-number/NaN/negative → 0, floored, hard-capped. */
const MAX_TOKENS = 1e12;
function clampTokens(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_TOKENS, Math.floor(n));
}

/** Round to micro-dollars (6dp) — keeps sub-cent per-run estimates meaningful. */
function roundMicro(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/** Resolve a (possibly hostile) model value to its price via longest-key match. */
function resolveModelPrice(model: unknown): ModelPrice {
  if (typeof model !== 'string') return DEFAULT_PRICE;
  const m = model
    .toLowerCase()
    .replace(/\./g, '-') // 4.8 → 4-8, gemini-2.5 → gemini-2-5
    .replace(/^[a-z0-9_]+\//, '') // strip one leading provider/ prefix
    .trim();
  if (!m) return DEFAULT_PRICE;

  let bestKey = 'default';
  let bestLen = 0;
  for (const key of Object.keys(MODEL_PRICES)) {
    if (key === 'default') continue;
    if (m.includes(key) && key.length > bestLen) {
      bestKey = key;
      bestLen = key.length;
    }
  }
  return MODEL_PRICES[bestKey] || DEFAULT_PRICE;
}

const MAX_COST_USD = 1e9;

/**
 * Estimate a single run's USD cost from its model + token totals. Cached input
 * is billed at the (cheaper) cached rate, fresh input at the full rate. Total by
 * construction: any missing / wrong-type / huge / negative field degrades to 0
 * tokens or the conservative default price, so the result is always a finite,
 * non-negative, bounded number — never NaN or negative.
 */
export function estimateRunCostUsd(input: {
  model?: unknown;
  cachedTokens?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
}): number {
  const rec: Record<string, unknown> =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const price = resolveModelPrice(rec.model);
  const cached = clampTokens(rec.cachedTokens);
  const fresh = clampTokens(rec.inputTokens);
  const output = clampTokens(rec.outputTokens);

  const raw =
    (cached * price.cachedInPer1M + fresh * price.inPer1M + output * price.outPer1M) /
    1_000_000;

  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.min(MAX_COST_USD, roundMicro(raw));
}

// ── Rollup ───────────────────────────────────────────────────────────────────

export interface RunCostRow {
  surface?: string;
  agentId?: string;
  status?: string;
  day?: string;
  costUsd?: number;
}

export interface CostRollup {
  /** Total estimated spend across all rows, rounded to cents. */
  totalUsd: number;
  /** Spend on failed / max-iteration / timeout runs (a subset of totalUsd). */
  wastedUsd: number;
  /** Spend grouped by surface (missing → "unknown"), each rounded to cents. */
  bySurface: Record<string, number>;
  /** Spend grouped by day (missing → "unknown"), each rounded to cents. */
  byDay: Record<string, number>;
}

const MAX_ROWS = 100_000;
const MAX_GROUP_KEYS = 2000;
const MAX_KEY_LEN = 64;
const UNKNOWN_KEY = 'unknown';
const OVERFLOW_KEY = '__overflow__';

/** Round to cents; non-finite → 0. Rollup rounds only final sums, never inputs. */
function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/** Coerce a row's costUsd: non-number/NaN/negative → 0, hard-capped. */
function toCostUsd(value: unknown): number {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(MAX_COST_USD, n);
}

/** Normalize a grouping key: non-string/empty → "unknown", bounded length. */
function normalizeKey(value: unknown): string {
  if (typeof value !== 'string') return UNKNOWN_KEY;
  const t = value.trim();
  if (!t) return UNKNOWN_KEY;
  return t.length > MAX_KEY_LEN ? t.slice(0, MAX_KEY_LEN) : t;
}

/**
 * Add to a group map with a bounded key set: known keys accumulate; once the
 * cap is hit, further NEW keys funnel into a single overflow bucket so hostile
 * input with millions of unique surfaces can never blow up the output.
 */
function addToGroup(map: Record<string, number>, key: string, amount: number): void {
  if (amount <= 0) return;
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    map[key] += amount;
    return;
  }
  if (Object.keys(map).length >= MAX_GROUP_KEYS) {
    map[OVERFLOW_KEY] = (map[OVERFLOW_KEY] || 0) + amount;
    return;
  }
  map[key] = amount;
}

/**
 * A run's dollars are "wasted" when the run did not complete successfully and
 * left no deliverable: failed / errored, hit the iteration cap, or timed out.
 * Cancelled runs are intentionally EXCLUDED (a deliberate stop, not waste).
 * Total on any input shape.
 */
export function isWastedRunStatus(status: unknown): boolean {
  if (typeof status !== 'string') return false;
  const s = status.toLowerCase().trim();
  if (!s) return false;
  if (s === 'failed' || s === 'error' || s === 'errored') return true;
  if (s.includes('max_iter') || s.includes('max-iter') || s.includes('maxiter')) return true;
  if (s.includes('timeout') || s.includes('timed_out') || s.includes('timed-out')) return true;
  return false;
}

/**
 * Aggregate RunCostRow[] into a CostRollup. Sums costUsd, tracks wasted spend
 * (failed/max-iteration/timeout), and groups by surface + day. Precise
 * accumulation, cents-rounded final sums. Total on any input: non-arrays and
 * non-object rows are skipped, and processing is bounded by MAX_ROWS.
 */
export function rollupRunCosts(rows: unknown): CostRollup {
  const bySurface: Record<string, number> = {};
  const byDay: Record<string, number> = {};

  if (!Array.isArray(rows)) {
    return { totalUsd: 0, wastedUsd: 0, bySurface, byDay };
  }

  let total = 0;
  let wasted = 0;
  const limit = Math.min(rows.length, MAX_ROWS);

  for (let i = 0; i < limit; i++) {
    const row = rows[i];
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;

    const cost = toCostUsd(r.costUsd);
    if (cost <= 0) continue; // zero/invalid cost contributes nothing to a cost rollup

    total += cost;
    if (isWastedRunStatus(r.status)) wasted += cost;

    addToGroup(bySurface, normalizeKey(r.surface), cost);
    addToGroup(byDay, normalizeKey(r.day), cost);
  }

  const roundGroup = (src: Record<string, number>): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const key of Object.keys(src)) out[key] = round2(src[key]);
    return out;
  };

  return {
    totalUsd: round2(total),
    wastedUsd: round2(wasted),
    bySurface: roundGroup(bySurface),
    byDay: roundGroup(byDay),
  };
}
