// budgetModelDownshiftCore — the PURE budget-guard brain for Auto model routing.
// When a circle has set a spend cap and its spend is running hot, an 'auto'
// model pick should DOWNSHIFT to a cheaper tier so a burst of expensive turns
// cannot blow the cap. This module turns two spend numbers into an alert level,
// and turns (resolved model + level) into a cheaper-tier substitution.
//
// It does NOT read the DB, price live usage, or decide WHEN to apply the swap —
// the caller gates it (only on an empty/'auto' pick, only when a cap exists).
// This is the substitution table + the classifier, nothing else.
//
// Posture:
//   * FAIL-OPEN on the trigger (classifySpendLevel): a missing / invalid /
//     non-positive cap, or unreadable spend, resolves to 'ok' — i.e. the guard
//     is OFF. We never fabricate an alarm from garbage budget data.
//   * FAIL-CLOSED on the action (downshiftForBudget): 'ok', an unknown model,
//     or an already-cheapest model is a strict IDENTITY no-op — we never swap a
//     model we don't recognize, and never touch the user's pick when calm.
//   * The downshift targets are canonical Anthropic-anchored ids (opus → sonnet
//     → haiku) that already exist in the SOUL defaults + failover chain, so the
//     substitute is always a real, routable model. warn = one tier cheaper;
//     critical = the cheapest tier.
//
// PURITY: zero imports, tsx-loadable (smoke: budget-model-downshift-core).
// Never throws. DETERMINISTIC: no Date.now / Math.random. Bounded output.

/** How close the circle's spend is to its cap. Drives the downshift. */
export type SpendAlertLevel = 'ok' | 'warn' | 'critical';

/** spent/cap ratio at/above which we start shaving cost (one tier down). */
export const SPEND_WARN_RATIO = 0.7;
/** spent/cap ratio at/above which we drop to the cheapest tier. */
export const SPEND_CRITICAL_RATIO = 0.95;

export interface ModelDownshiftTier {
  /** Tier label, ordered most-expensive (index 0) → cheapest (last). */
  tier: 'frontier' | 'strong' | 'fast';
  /** Canonical, always-routable model id that represents this tier — the id we
   *  downshift INTO when a pricier model drops to this tier. */
  target: string;
  /** Lowercase substring markers that place a model id in this tier. */
  markers: readonly string[];
}

/**
 * The downshift ladder, most-expensive first. Anchored on the Anthropic
 * opus → sonnet → haiku spine (the SOUL defaults) so every substitution lands
 * on a model that certainly exists. Markers cover the concrete ids Auto can
 * emit (direct BYOK, openrouter/-prefixed, google_ai/, deepseek/, groq/, …).
 *
 * Matching is CHEAP-FIRST (see inferDownshiftTier): an explicit small-model
 * marker (mini / nano / flash / haiku / lite / small / -8b) wins over a broad
 * family marker, so `gpt-5.4-mini` is 'fast' (not 'frontier') and
 * `gemini-2.5-flash` is 'fast' (not swept up by a family rule).
 */
export const MODEL_DOWNSHIFT_TIERS: readonly ModelDownshiftTier[] = [
  {
    tier: 'frontier',
    target: 'claude-opus-4-8',
    markers: ['opus', 'fable', 'gpt-5.5', 'gpt-5-pro'],
  },
  {
    tier: 'strong',
    target: 'claude-sonnet-4-6',
    markers: [
      'sonnet', 'gpt-5', 'gpt-4', 'gemini-2.5-pro', 'gemini-3.1-pro',
      'reasoner', 'deepseek', 'command-r', 'large', 'qwen3-235', 'glm-5',
      'minimax-m1', 'mixtral', '70b', '235b', 'sonar-pro', 'sonar-reasoning',
    ],
  },
  {
    tier: 'fast',
    target: 'claude-haiku-4-5',
    // Short ambiguous tokens are delimiter-anchored ('-mini', not 'mini') so a
    // family name like 'ge-mini' can't be mistaken for a mini variant.
    markers: [
      'haiku', '-mini', '-nano', 'flash', '-lite', '-small', '-8b',
      'blackswan', 'glm-4', 'llama3.2', 'command-light',
    ],
  },
];

const FAST_TIER_INDEX = MODEL_DOWNSHIFT_TIERS.length - 1;

/** Coerce an unknown into a finite number, or null. Accepts numeric strings as
 *  a courtesy (bad JSON), rejects booleans/arrays/objects/NaN/±Infinity. */
function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function markerHit(id: string, markers: readonly string[]): boolean {
  for (const mk of markers) {
    if (mk && id.includes(mk)) return true;
  }
  return false;
}

/**
 * Which ladder index a model id sits at: 0 frontier, 1 strong, 2 fast, or -1
 * when unrecognized. Cheap-first matching so small-model markers beat broad
 * family markers. Never throws; non-string / empty → -1 (caller treats as
 * identity).
 */
export function inferDownshiftTier(model: unknown): number {
  const id = typeof model === 'string' ? model.toLowerCase() : '';
  if (!id) return -1;
  // Cheapest tier first: an explicit small-model marker wins outright.
  if (markerHit(id, MODEL_DOWNSHIFT_TIERS[FAST_TIER_INDEX].markers)) return FAST_TIER_INDEX;
  // Then most-expensive → mid so frontier ids beat the broad 'strong' markers.
  for (let i = 0; i < FAST_TIER_INDEX; i += 1) {
    if (markerHit(id, MODEL_DOWNSHIFT_TIERS[i].markers)) return i;
  }
  return -1;
}

/**
 * Classify how close the circle is to its spend cap.
 *   ratio < 0.7            → 'ok'
 *   0.7 <= ratio < 0.95    → 'warn'
 *   ratio >= 0.95          → 'critical'
 * FAIL-OPEN: a missing / non-numeric / non-positive cap → 'ok' (guard OFF), and
 * unreadable or negative spend is treated as 0 (no alarm). Never throws.
 */
export function classifySpendLevel(input: { spentUsd: unknown; capUsd: unknown }): SpendAlertLevel {
  if (!input || typeof input !== 'object') return 'ok';
  const cap = toFiniteNumber((input as { capUsd?: unknown }).capUsd);
  // No usable cap → the feature is off. Never fabricate an alarm.
  if (cap === null || cap <= 0) return 'ok';
  let spent = toFiniteNumber((input as { spentUsd?: unknown }).spentUsd);
  if (spent === null || spent < 0) spent = 0;
  const ratio = spent / cap;
  if (ratio >= SPEND_CRITICAL_RATIO) return 'critical';
  if (ratio >= SPEND_WARN_RATIO) return 'warn';
  return 'ok';
}

export interface BudgetDownshiftResult {
  /** The model to use. Equals the input (when a string) on any no-op. */
  model: string;
  /** True only when we actually swapped in a cheaper tier. */
  downshifted: boolean;
  /** Short, secret-free, bounded explanation (no raw model echo). */
  reason: string;
}

/**
 * Given a resolved 'auto' model and a spend level, either keep it (identity) or
 * substitute a cheaper-tier canonical model.
 *   level 'ok'        → identity (guard off)
 *   level 'warn'      → one tier cheaper (opus → sonnet, sonnet → haiku)
 *   level 'critical'  → cheapest tier (opus → haiku, sonnet → haiku)
 * Identity (FAIL-CLOSED no-op) also when the model is unrecognized or already
 * the cheapest tier. Never throws; the reason never echoes the raw input model,
 * so a hostile/huge id can't bloat or leak through the output.
 */
export function downshiftForBudget(resolvedModel: unknown, level: SpendAlertLevel): BudgetDownshiftResult {
  const original = typeof resolvedModel === 'string' ? resolvedModel : '';
  const identity = (reason: string): BudgetDownshiftResult => ({ model: original, downshifted: false, reason });

  // Calm (or an unknown level from a hostile caller) → never touch the pick.
  if (level !== 'warn' && level !== 'critical') return identity('budget ok: no downshift');

  const fromIdx = inferDownshiftTier(resolvedModel);
  if (fromIdx < 0) return identity('model tier unknown: no downshift');

  // warn shaves one tier; critical goes straight to the cheapest tier.
  const toIdx = level === 'critical' ? FAST_TIER_INDEX : Math.min(fromIdx + 1, FAST_TIER_INDEX);
  if (toIdx <= fromIdx) return identity('already cheapest tier: no downshift');

  const from = MODEL_DOWNSHIFT_TIERS[fromIdx];
  const to = MODEL_DOWNSHIFT_TIERS[toIdx];
  // Defensive: never "downshift" to an empty id or to the model we already have.
  if (!to.target || to.target === original) return identity('no cheaper target: no downshift');

  return {
    model: to.target,
    downshifted: true,
    reason: `budget ${level}: ${from.tier}→${to.tier} downshift (${to.target})`,
  };
}
