/**
 * modelContextBudgetCore — make the chat prompt's EXTRAS char budget aware of
 * the selected model's context window.
 *
 * Why this module exists (prompt-assembly expansion): the extras char budget
 * (`resolveChatPromptContextPolicy → maxExtrasChars`, plus the `/context` dial
 * in contextDepthPolicy) is a FIXED ladder — trivial 1.2k … complex 8k, max
 * 16k — sized for the ~128k–200k context windows the app's default models
 * (Claude, GPT-4o) carry. But a 1M-window model (Gemini 2.5, GPT-4.1) could
 * safely take far more per-turn context, and an 8k-window model (Llama-3-8B,
 * older GPTs) should take less. This core scales the tier/dial policy by the
 * model's window so large-window models stop leaving context on the table and
 * small-window models stop overflowing.
 *
 * Design (all load-bearing):
 *   - MODEL_CONTEXT_WINDOWS: a conservative approx-token-window table keyed by
 *     normalized bare model id, with family fallbacks for dated snapshots and
 *     provider variants. Deliberately UNDER-estimates when unsure.
 *   - getModelContextWindow: normalize (strip provider/vendor prefixes) + look
 *     up; null for anything we don't recognize (fail-open to identity below).
 *   - resolveModelContextBudget: an IDENTITY transform for the common case —
 *     it returns the SAME policy object when the window is unknown OR sits in
 *     the ~128k–200k band the fixed budgets were already tuned for (no
 *     regression, byte-identical prompts for today's default models). It scales
 *     maxExtrasChars/retrievalBudget/retrievalCount UP only for genuinely large
 *     windows (>= ~400k) and gently DOWN for genuinely small ones (<= ~32k),
 *     never below the incoming policy on the up path (no regression) and never
 *     above it on the down path, always under a sane absolute cap, and
 *     additionally bounded so the extras can never claim more of the window
 *     than a safe fraction after the base prompt (approxBasePromptChars).
 *
 * Pure by construction: no runtime imports (type-only), tsx-loadable, no
 * Date.now()/Math.random() at module scope, bounded, TOTAL — every export
 * returns a safe neutral value on null/undefined/wrong-type/huge/hostile input
 * and never throws.
 */

import type { ChatPromptContextPolicy } from './chatPromptAssembly';

// ─── Model id normalization (self-contained copy) ────────────────────────────
//
// Mirrors normalizeModelId in src/lib/modelCapabilities.ts (kept a local copy
// so this module stays dependency-light / import-type-only). Model ids arrive
// provider-prefixed from the marketplace/router surfaces
// (`openrouter/anthropic/claude-sonnet-4-6`, `google_ai/gemini-2.5-pro`,
// `huggingface_endpoint/cswan801/BlackSwan-v5`, …); this strips the routing
// heads down to the bare id so window lookups key on one canonical form.
// Alias heads (`hugging_face`→`huggingface`, `z_ai`→`zai`) are both in the set.

const PROVIDER_PREFIX_HEADS: ReadonlySet<string> = new Set<string>([
  'openrouter',
  'openai', 'openai_compatible',
  'anthropic',
  'google_ai', 'googleai', 'google',
  'deepseek',
  'huggingface', 'huggingface_endpoint', 'hugging_face', 'hf',
  'groq',
  'mistral', 'mistral_ai', 'mistralai',
  'cohere',
  'perplexity',
  'together', 'together_ai',
  'fireworks', 'fireworks_ai',
  'zai', 'z_ai',
  'minimax',
  'ollama',
  'github', 'github-models', 'github_models',
  'replicate',
  'openswan',
  // Vendor/org heads seen inside OpenRouter/HF-style ids.
  'meta-llama', 'deepseek-ai', 'qwen', 'black-forest-labs', 'stabilityai',
  'moonshotai', 'x-ai', 'meta', 'mistral-ai', 'zai-org', 'minimaxai',
  'accounts', 'fireworks', 'models',
]);

function normalizeModelIdLocal(modelId: string): string {
  let id = (modelId || '').trim().toLowerCase();
  if (!id) return '';
  for (;;) {
    const slashIdx = id.indexOf('/');
    if (slashIdx <= 0) break;
    const head = id.slice(0, slashIdx);
    const rest = id.slice(slashIdx + 1);
    if (!rest || !PROVIDER_PREFIX_HEADS.has(head)) break;
    id = rest;
  }
  return id;
}

// ─── Context-window table (approximate, conservative token windows) ──────────
//
// Values are deliberately conservative — when a family advertises a range we
// take the low-to-mid end (e.g. Llama-4-Scout advertises up to 10M but we key
// it at 1M). Unknown ids resolve to null (see getModelContextWindow), which
// makes resolveModelContextBudget a no-op identity — the safe default.

export const MODEL_CONTEXT_WINDOWS: Readonly<Record<string, number>> = {
  // Anthropic Claude — exact long-context tiers first. Sonnet 4.6 and Haiku
  // remain at their established 200k windows; unknown Claude ids stay on the
  // conservative family fallback below.
  'claude-sonnet-5': 1_000_000,
  'claude-opus-5': 1_000_000,
  'claude-sonnet-4-6': 200_000,
  'claude-fable-5': 1_000_000,
  'claude-opus-4-8': 1_000_000,
  'claude-opus-4-7': 1_000_000,
  'claude-opus-4-6': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-haiku-4-5-20251001': 200_000,
  'claude-3-5-sonnet': 200_000,
  'claude-3-5-haiku': 200_000,
  'claude-3-opus': 200_000,

  // OpenAI
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4': 8_000, // legacy base GPT-4 — small window
  'gpt-3.5-turbo': 16_000, // small window
  'gpt-4.1': 1_000_000,
  'gpt-4.1-mini': 1_000_000,
  'gpt-4.1-nano': 1_000_000,
  'gpt-5.6-sol': 1_050_000,
  'gpt-5.6-terra': 1_050_000,
  'gpt-5.6-luna': 1_050_000,
  'gpt-5.5-pro': 1_050_000,
  'gpt-5.5': 1_050_000,
  'gpt-5.4': 1_050_000,
  'gpt-5.4-mini': 1_050_000,
  'gpt-5.4-nano': 1_050_000,
  'codex-mini': 128_000,
  'o1': 200_000,
  'o1-mini': 128_000,
  'o3': 200_000,
  'o3-pro': 200_000,
  'o3-mini': 200_000,
  'o4-mini': 200_000,

  // Google Gemini — long-context family (1M+).
  'gemini-2.5-pro': 1_000_000,
  'gemini-2.5-flash': 1_000_000,
  'gemini-2.5-flash-lite': 1_000_000,
  'gemini-2.5-flash-preview': 1_000_000,
  'gemini-2.0-flash': 1_000_000,
  'gemini-1.5-pro': 2_000_000,
  'gemini-1.5-flash': 1_000_000,
  'gemini-3.6-flash': 1_048_576,
  'gemini-3.5-flash-lite': 1_048_576,
  'gemini-3.5-flash': 1_000_000,
  'gemini-3.1-pro-preview': 1_000_000,
  'gemini-3.1-flash-lite': 1_000_000,

  // DeepSeek
  'deepseek-v4-pro': 1_000_000,
  'deepseek-v4-flash': 1_000_000,
  'deepseek-v3': 128_000,
  'deepseek-v3.2': 128_000,
  'deepseek-r1': 128_000,
  'deepseek-chat': 128_000,
  'deepseek-reasoner': 128_000,

  // Mistral / Mixtral / Codestral
  'mistral-medium-3-5': 256_000,
  'mistral-large-2512': 256_000,
  'mistral-small-2603': 256_000,
  'codestral-2508': 128_000,
  'ministral-14b-2512': 256_000,
  'ministral-8b-2512': 256_000,
  'ministral-3b-2512': 256_000,
  'mistral-large-3': 128_000,
  'mistral-large': 128_000,
  'mistral-small': 32_000, // small-window boundary → gentle reduce
  'ministral-8b': 128_000,
  'codestral': 32_000,
  'mixtral-8x7b': 32_000,
  'mixtral-8x22b': 64_000,

  // Qwen
  'qwen-3.5-coder': 128_000,
  'qwen-3.5-flash': 128_000,
  'qwen-3.5-plus': 128_000,
  'qwen-2.5-coder': 128_000,
  'qwq': 32_000,

  // Meta Llama
  'llama-4-scout': 1_000_000, // advertised far higher; kept conservative
  'llama-4-maverick': 1_000_000,
  'llama-3.3-70b': 128_000,
  'llama-3.1-8b': 128_000,
  'llama-3-8b': 8_000, // base Llama-3 — small window
  'llama-2-70b': 4_000, // legacy — very small

  // Perplexity Sonar
  'sonar-pro': 200_000,
  'sonar-reasoning-pro': 128_000,
  'sonar-deep-research': 128_000,
  'sonar': 128_000,

  // Cohere Command
  'command-a-plus-05-2026': 128_000,
  'command-a-reasoning-08-2025': 128_000,
  'command-a-03-2025': 128_000,
  'command-r7b-12-2024': 128_000,
  'command-a': 256_000,
  'command-r-plus': 128_000,
  'command-r': 128_000,

  // Current Z.AI, MiniMax, and open-weight hosted families.
  'glm-5.1': 200_000,
  'glm-5': 200_000,
  'minimax-m2.7': 204_800,
  'minimax-m2.7-highspeed': 204_800,
  'minimax-m2.5': 204_800,
  'minimax-m2.5-highspeed': 204_800,
  'gpt-oss-120b': 131_072,
  'gpt-oss-20b': 131_072,

  // BlackSwan-v5 (app-trained Qwen). Grounding context only; tools never route
  // here. Conservative small-ish window. One normalized key covers
  // huggingface/…, huggingface_endpoint/…, and the bare repo id.
  'cswan801/blackswan-v5': 32_000,
};

// Family fallbacks for ids not in the explicit table (dated snapshots, provider
// variants). First match wins — specific patterns precede general ones.
const FAMILY_WINDOW_PATTERNS: ReadonlyArray<{ pattern: RegExp; window: number }> = [
  { pattern: /^gemini-1\.5/, window: 2_000_000 },
  { pattern: /^gemini-/, window: 1_000_000 },
  { pattern: /^gpt-4\.1/, window: 1_000_000 },
  { pattern: /^gpt-4o/, window: 128_000 },
  { pattern: /^gpt-4-turbo/, window: 128_000 },
  { pattern: /^gpt-4\b/, window: 8_000 },
  { pattern: /^gpt-5\.6/, window: 1_050_000 },
  { pattern: /^gpt-5/, window: 400_000 },
  { pattern: /^gpt-3\.5/, window: 16_000 },
  { pattern: /^o[1-9]\b/, window: 200_000 },
  { pattern: /^claude-(?:sonnet|opus|fable)-5\b/, window: 1_000_000 },
  { pattern: /^claude-/, window: 200_000 },
  { pattern: /^mixtral/, window: 32_000 },
  { pattern: /^(mistral|ministral|magistral|codestral)/, window: 128_000 },
  { pattern: /^(qwen|qwq)/, window: 128_000 },
  { pattern: /^llama-4/, window: 1_000_000 },
  { pattern: /^llama-3/, window: 128_000 },
  { pattern: /^llama-2/, window: 4_000 },
  { pattern: /^deepseek/, window: 128_000 },
  { pattern: /^sonar/, window: 128_000 },
  { pattern: /^command/, window: 128_000 },
  { pattern: /^glm-/, window: 200_000 },
  { pattern: /^minimax-/, window: 204_800 },
  { pattern: /^gpt-oss-/, window: 131_072 },
  { pattern: /blackswan/, window: 32_000 },
];

/**
 * Approximate context window (in tokens) for a model id. Accepts raw or
 * provider-prefixed ids (normalized internally). Returns null for anything we
 * don't recognize (or non-string input) — callers treat null as "leave the
 * budget alone". Never throws.
 */
export function getModelContextWindow(modelId: unknown): number | null {
  if (typeof modelId !== 'string') return null;
  const norm = normalizeModelIdLocal(modelId);
  if (!norm) return null;
  const exact = MODEL_CONTEXT_WINDOWS[norm];
  if (typeof exact === 'number') return exact;
  for (const family of FAMILY_WINDOW_PATTERNS) {
    if (family.pattern.test(norm)) return family.window;
  }
  return null;
}

// ─── Budget scaling ──────────────────────────────────────────────────────────

/** Windows at/above this scale the budget UP. */
export const LARGE_WINDOW_TOKENS = 400_000;
/** Windows at/above this get the biggest boost (≈1M+). */
export const HUGE_WINDOW_TOKENS = 900_000;
/** Windows at/below this scale the budget DOWN. */
export const SMALL_WINDOW_TOKENS = 32_000;
const SMALLISH_WINDOW_TOKENS = 16_000;
const TINY_WINDOW_TOKENS = 8_000;

const LARGE_BOOST = 2;
const MID_LARGE_BOOST = 1.5;
const SMALL_REDUCE = 0.8;
const SMALLISH_REDUCE = 0.65;
const TINY_REDUCE = 0.5;

/** Absolute ceilings — the budget never exceeds these no matter the window. */
const EXTRAS_CAP = 48_000;
const RETRIEVAL_BUDGET_CAP = 15_000;
const RETRIEVAL_COUNT_CAP = 40;
/** Floors on the reduce path — never starve a turn to nothing. */
const EXTRAS_FLOOR = 800;
const RETRIEVAL_BUDGET_FLOOR = 400;
const RETRIEVAL_COUNT_FLOOR = 1;

/** ~chars per token — used to convert the window into a char budget for the
 *  fit-in-window safety cap. Conservative (English text averages ~4). */
const CHARS_PER_TOKEN = 4;
/** The extras section may claim at most this fraction of the window remaining
 *  after the base prompt (the rest is reserved for history + tools + output). */
const FIT_FRACTION = 0.35;

/**
 * Return the scale factor for a window, or null when the window sits in the
 * middle "already-large default" band (~32k–400k) the fixed budgets assume →
 * identity, no change.
 */
function scaleFactorForWindow(window: number): number | null {
  if (window >= LARGE_WINDOW_TOKENS) {
    return window >= HUGE_WINDOW_TOKENS ? LARGE_BOOST : MID_LARGE_BOOST;
  }
  if (window <= SMALL_WINDOW_TOKENS) {
    if (window <= TINY_WINDOW_TOKENS) return TINY_REDUCE;
    if (window <= SMALLISH_WINDOW_TOKENS) return SMALLISH_REDUCE;
    return SMALL_REDUCE;
  }
  return null;
}

function toPositiveInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Scale a char-budget field. On the UP path (factor >= 1) the result is never
 * below the incoming value (no regression) and never above the sane cap or the
 * fit-in-window cap. On the DOWN path it is floored (never starves) and never
 * above the incoming value (only ever reduces).
 */
function scaleCharBudget(
  current: unknown,
  factor: number,
  cap: number,
  floor: number,
  fitCap: number,
): number {
  const cur = toPositiveInt(current);
  let scaled = Math.round(cur * factor);
  scaled = Math.min(scaled, cap);
  scaled = Math.min(scaled, fitCap);
  if (factor >= 1) return Math.max(cur, scaled);
  scaled = Math.max(scaled, floor);
  return Math.min(cur, scaled);
}

/** Same shape as scaleCharBudget for the item-count field (no fit-in-window
 *  cap — it counts items, not chars). */
function scaleCountBudget(current: unknown, factor: number, cap: number, floor: number): number {
  const cur = toPositiveInt(current);
  let scaled = Math.round(cur * factor);
  scaled = Math.min(scaled, cap);
  if (factor >= 1) return Math.max(cur, scaled);
  scaled = Math.max(scaled, floor);
  return Math.min(cur, scaled);
}

export interface ModelContextBudgetOpts {
  /** The selected model's approximate context window in tokens (from
   *  getModelContextWindow). null/undefined/invalid → identity. */
  modelContextWindow?: number | null;
  /** Approximate char length of the base (pre-extras) system prompt. Used to
   *  keep the extras from claiming more of the window than is safe. Optional. */
  approxBasePromptChars?: number;
}

/**
 * Scale a complexity/dial-derived ChatPromptContextPolicy by the model's
 * context window.
 *
 * IDENTITY (returns the SAME object, no allocation, no regression) when:
 *   - `policy` is not an object (hostile input passes through untouched), or
 *   - the window is null/undefined/invalid/non-positive, or
 *   - the window sits in the middle "default" band (~32k–400k) the fixed
 *     budgets were already tuned for, or
 *   - scaling would not move any field (already at/above the cap on the up
 *     path, already at/below on the down path).
 *
 * Otherwise returns a NEW policy with maxExtrasChars/retrievalBudget/
 * retrievalCount scaled — up for large windows, down for small ones — with all
 * other (boolean) fields preserved verbatim. Bounded, total, never throws.
 */
export function resolveModelContextBudget(
  policy: ChatPromptContextPolicy,
  opts: ModelContextBudgetOpts,
): ChatPromptContextPolicy {
  // Totality: a non-object policy passes straight through (identity).
  if (!policy || typeof policy !== 'object') return policy;

  const o = opts && typeof opts === 'object' ? opts : ({} as ModelContextBudgetOpts);
  const rawWindow = o.modelContextWindow;
  const window =
    typeof rawWindow === 'number' && Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : null;
  // Unknown/invalid window → identity. No regression for today's default models.
  if (window === null) return policy;

  const factor = scaleFactorForWindow(window);
  // Middle band → the budgets already assume this window → identity.
  if (factor === null) return policy;

  const baseChars = toPositiveInt(o.approxBasePromptChars);
  const windowChars = window * CHARS_PER_TOKEN;
  // Extras may claim at most FIT_FRACTION of the window left after the base
  // prompt. On large windows this is inert (the EXTRAS_CAP binds first); on
  // small windows it protects against overflow. Floored to an integer.
  const fitCap = Math.max(0, Math.floor((windowChars - baseChars) * FIT_FRACTION));

  const newExtras = scaleCharBudget(policy.maxExtrasChars, factor, EXTRAS_CAP, EXTRAS_FLOOR, fitCap);
  const newBudget = scaleCharBudget(
    policy.retrievalBudget,
    factor,
    RETRIEVAL_BUDGET_CAP,
    RETRIEVAL_BUDGET_FLOOR,
    fitCap,
  );
  const newCount = scaleCountBudget(policy.retrievalCount, factor, RETRIEVAL_COUNT_CAP, RETRIEVAL_COUNT_FLOOR);

  // Nothing moved → identity (same object). Covers the already-at-cap large
  // case and the already-tiny small case — no needless allocation, no drift.
  if (
    newExtras === policy.maxExtrasChars &&
    newBudget === policy.retrievalBudget &&
    newCount === policy.retrievalCount
  ) {
    return policy;
  }

  return {
    ...policy,
    maxExtrasChars: newExtras,
    retrievalBudget: newBudget,
    retrievalCount: newCount,
  };
}
