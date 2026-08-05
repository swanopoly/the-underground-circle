/**
 * contextCompactionTierCore — the PURE escalation-TIER SELECTOR that turns token
 * pressure (+ a stale-tool-vs-load-bearing byte breakdown + an optional turn
 * count) into ONE minimal-sufficient compaction tier:
 *   'none' | 'drop_tool_noise' | 'summarize_oldest' | 'hard_truncate'
 * and detects the hard-limit EMERGENCY that forces truncation of protected /
 * recent content before a provider replies 400 "prompt too long".
 *
 * WHY (two unowned failure modes in long OpenSwan/SwanBot tool loops):
 *   1. OVER-WINDOW 400. Every existing compaction core PROTECTS a recent suffix
 *      (system + last N + referenced) and never touches it. In a coding-agent /
 *      computer-use run a single recent tool_result — a 500KB `local.run_shell`
 *      stdout dump, a screenshot-heavy computer-use round — can exceed the model
 *      window ON ITS OWN, so openswanContextCompactionCore hits its all-protected
 *      keepAll branch and forwards an over-window prompt; the provider 400s and
 *      the run dies. This core adds the missing HARD-TRUNCATE tier: it reports the
 *      overage and WHICH protected messages to shave (largest-first) so the caller
 *      can trim via promptTokenEstimateCore.truncateToTokenBudget BEFORE
 *      forwarding, guaranteeing the prompt fits.
 *   2. NEEDLESS SUMMARISER SPEND. When mild pressure can be relieved by locally
 *      DROPPING stale tool_result bytes (free, no model call, like
 *      clear_tool_uses), nothing tells the runtime "a drop alone gets you under
 *      target — do NOT pay for an LLM summariser this round." This core picks the
 *      CHEAPEST sufficient tier: drop-only vs drop+summarise.
 *
 * WHAT IT IS (and is NOT): a DISJOINT decision layer that SITS ABOVE the existing
 * appliers (openswanContextCompactionCore's index partition,
 * agentContextCompression's Haiku summariser, promptTokenEstimateCore's string
 * truncator) and ROUTES among them. It never produces an index partition and
 * never touches message bytes — it consumes the same lightweight per-message
 * projection openswanContextCompactionCore does (superset-compatible) and returns
 * a single tier decision plus the emergency overage/candidates.
 *
 * PURITY / SAFETY CONTRACT:
 *   - ZERO IMPORTS (not even `import type`): takes plain projection objects, so it
 *     loads under tsx/esbuild with no react-native/supabase/network at import time.
 *   - DETERMINISTIC: no Date.now()/Math.random()/argless `new Date`; guarded
 *     numeric coercion; a total-order candidate sort.
 *   - TOTAL: every export handles null/undefined/wrong-type/NaN/Infinity/negative/
 *     huge/bigint/cyclic/throwing-getter/hostile-array input by returning a safe,
 *     well-formed keep-nothing-needed plan — it never throws.
 *   - BOUNDED: exported MAX_* caps (scan cap, candidate cap, content/est/reason/
 *     turn caps) plus window/keep/reserved clamps.
 *   - SECRET-SAFE: the reason carries ONLY fixed labels + counts / token numbers,
 *     never message content; it is stripped of control / line-separator / prompt-
 *     fence chars and lone surrogates at a single sanitize chokepoint.
 *
 * ALIGNMENT: the fractions / keep-count / SUMMARY_KEEP_FRACTION / CHARS_PER_TOKEN /
 * window defaults / MAX_REASON_CHARS below MIRROR openswanContextCompactionCore's
 * exported constants (identical VALUES, re-declared to honor the zero-import
 * contract), and the recent-suffix pair guard mirrors its id-free guard — so the
 * selector and the partitioner can never drift. The smoke cross-checks these
 * values against openswanContextCompactionCore to pin the lockstep.
 *
 * Smoke: scripts/context-compaction-tier-core-smoketest.ts
 * (npm run smoke:context-compaction-tier-core).
 */

// ── Alignment constants (MIRROR openswanContextCompactionCore — keep in lockstep) ──

/** Fraction of the window at/above which compaction is TRIGGERED. */
export const CONTEXT_SAFETY_FRACTION = 0.75;
/** Fraction of the window we aim to compact DOWN to once triggered (< safety). */
export const CONTEXT_TARGET_FRACTION = 0.55;
/** A summarised message shrinks to ~this fraction, so summarising frees (1 - this). */
export const SUMMARY_KEEP_FRACTION = 0.2;
/** Chars→tokens heuristic (~4 chars/token). Threshold math only — NEVER billing. */
export const CHARS_PER_TOKEN = 4;
/** Window used when the caller gives no (or a nonsensical) contextWindowTokens. */
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 200_000;
/** Clamp bounds for a caller-supplied window (a 4k tiny model … a 2M frontier). */
export const CONTEXT_WINDOW_MIN = 4_000;
export const CONTEXT_WINDOW_MAX = 2_000_000;
/** Most-recent messages preserved verbatim when nothing else is specified. */
export const DEFAULT_KEEP_RECENT_COUNT = 6;
export const KEEP_RECENT_MIN = 2;
export const KEEP_RECENT_MAX = 200;
/** Reason strings are capped so a pathological run can't bloat telemetry. */
export const MAX_REASON_CHARS = 240;

// ── This core's own tunables ──────────────────────────────────────────────────

/** Headroom (tokens) reserved for the model's OUTPUT. hardLimit = window − this. */
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 8_000;

/** Proactive drop (fight long-context rot) only kicks in past this turn count. */
export const PROACTIVE_DROP_TURN_THRESHOLD = 40;
/** …and only when at least this many tokens of stale tool noise are droppable. */
export const PROACTIVE_DROP_MIN_FREE_TOKENS = 2_000;
/** …and only when load is already at least this fraction of the soft trigger. */
export const PROACTIVE_DROP_PRESSURE_FLOOR = 0.6;

// ── Bounds (exported caps; single source of truth) ───────────────────────────

/** Hard cap on scanned message projections. Extra slots are ignored. */
export const MAX_MESSAGES = 100_000;
/** Hard cap on emitted hard-truncate candidate indices. */
export const MAX_HARD_TRUNCATE_CANDIDATES = 32;
/** Max per-message content length honored (chars). Guards sum overflow. */
export const MAX_CONTENT_LEN = 1_000_000_000; // 1e9
/** Absolute ceiling for the (derived or supplied) running token estimate. */
export const MAX_ESTIMATED_TOKENS = 1_000_000_000_000_000; // 1e15 — stays inside safe-int
/** Turn count is a secondary signal; clamp it so a garbage value stays bounded. */
export const MAX_TURN_COUNT = 1_000_000_000; // 1e9

// ── Public shapes ─────────────────────────────────────────────────────────────

/**
 * Lightweight per-message projection the selector reasons over. Superset of
 * openswanContextCompactionCore.CompactionMessageView (adds `protected`) so a
 * caller can pass that core's projections directly. All fields optional / loosely
 * typed — every one is defensively normalised.
 */
export interface CompactionTierMessageView {
  /** 'system' is always protected; any other value is treated as compactable. */
  role?: string;
  /** Approx char length of the message content (drives per-message freed est). */
  contentLen?: number;
  /** True when the message carries tool_result block(s) — the bulky, droppable kind. */
  isToolResult?: boolean;
  /** True when a message that will REMAIN in context still depends on this one. */
  referencedLater?: boolean;
  /** Caller-forced protection (never dropped/summarised/counted droppable). */
  protected?: boolean;
}

/** Selector input — every field is `unknown` and defensively normalised. */
export interface CompactionTierInput {
  /** Running whole-history token estimate. Missing/invalid → derived from Σ contentLen. */
  estimatedTokens?: unknown;
  /** The target model's context window (tokens). Clamped; default 200k. */
  contextWindowTokens?: unknown;
  /** Headroom kept for the model's OUTPUT. Clamped [0, window/2]; default 8k. */
  reservedOutputTokens?: unknown;
  /** The message projections, in order. Non-array → treated as empty. */
  messages?: unknown;
  /** How many trailing messages to preserve verbatim. Clamped [2, 200]; def 6. */
  keepRecentCount?: unknown;
  /** OPTIONAL secondary signal — how many tool-loop turns have run so far. */
  turnCount?: unknown;
}

/** The four escalation tiers, cheapest → most drastic. */
export type CompactionTier = 'none' | 'drop_tool_noise' | 'summarize_oldest' | 'hard_truncate';

/** Selector output — one tier decision plus the numbers behind it. */
export interface CompactionTierPlan {
  tier: CompactionTier;
  /** True iff tier !== 'none'. */
  shouldCompact: boolean;
  /** est > softTrigger. */
  overSoftTrigger: boolean;
  /** est > hardLimit. */
  overHardLimit: boolean;
  /** est / window, rounded to 3 decimals. */
  pressureRatio: number;
  estimatedTokens: number;
  softTriggerTokens: number;
  targetTokens: number;
  hardLimitTokens: number;
  freeableByDropTokens: number;
  freeableBySummarizeTokens: number;
  projectedTokensAfterDrop: number;
  projectedTokensAfterDropAndSummarize: number;
  /** 0 unless tier === 'hard_truncate'; else afterBoth − hardLimit ( > 0 ). */
  hardTruncateOverageTokens: number;
  /** Ascending protected indices to shave; [] unless tier === 'hard_truncate'. */
  hardTruncateCandidates: number[];
  /** Bounded, secret-safe (counts/tokens only). */
  reason: string;
}

// ── Internal shapes ───────────────────────────────────────────────────────────

interface NormMsg {
  index: number;
  isSystem: boolean;
  contentLen: number;
  isToolResult: boolean;
  referencedLater: boolean;
  protectedFlag: boolean;
}

// ── Total coercion helpers ────────────────────────────────────────────────────

/** Guarded property read — a throwing getter yields undefined, not a throw. */
function readField(obj: unknown, key: string): unknown {
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Coerce to a finite number, else `fallback`. Accepts number/bigint/numeric-
 * string; blank string, NaN, ±Infinity, huge bigint → fallback. Never throws.
 */
function toFiniteOr(value: unknown, fallback: number): number {
  let n: number;
  if (typeof value === 'number') n = value;
  else if (typeof value === 'bigint') n = Number(value);
  else if (typeof value === 'string') {
    const t = value.trim();
    n = t === '' ? NaN : Number(t);
  } else n = NaN;
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function normalizeWindow(value: unknown): number {
  const n = toFiniteOr(value, NaN);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CONTEXT_WINDOW_TOKENS;
  return clamp(Math.floor(n), CONTEXT_WINDOW_MIN, CONTEXT_WINDOW_MAX);
}

function normalizeKeepRecent(value: unknown): number {
  const n = toFiniteOr(value, NaN);
  if (!Number.isFinite(n)) return DEFAULT_KEEP_RECENT_COUNT;
  return clamp(Math.floor(n), KEEP_RECENT_MIN, KEEP_RECENT_MAX);
}

/** Reserved output headroom, clamped [0, floor(window/2)]; garbage → default. */
function normalizeReservedOutput(value: unknown, window: number): number {
  const cap = Math.floor(window / 2);
  const n = toFiniteOr(value, NaN);
  const base = Number.isFinite(n) ? Math.floor(n) : DEFAULT_RESERVED_OUTPUT_TOKENS;
  return clamp(base, 0, cap);
}

function normalizeTurnCount(value: unknown): number {
  const n = toFiniteOr(value, NaN);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), MAX_TURN_COUNT);
}

function normalizeContentLen(value: unknown): number {
  const n = toFiniteOr(value, 0);
  if (!(n > 0)) return 0;
  return Math.min(Math.floor(n), MAX_CONTENT_LEN);
}

/** A short role string (bounded work) equals 'system' after trim/lowercase. */
function isSystemRole(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  if (value.length > 32) return false; // huge role can't legitimately be 'system'
  return value.trim().toLowerCase() === 'system';
}

// ── Reason sanitize chokepoint (code-point aware, surrogate-safe) ──────────────

/**
 * Code point we strip from the (already synthetic) reason: C0 controls
 * (0x00–0x1f), DEL (0x7f), C1 (0x80–0x9f), line/paragraph separators
 * (0x2028/0x2029), and prompt-fence chars backtick (0x60), '<' (0x3c), '>'
 * (0x3e). Coded by code point so no literal control char appears in this file.
 */
function isStrippableCode(code: number): boolean {
  if (code <= 0x1f) return true;
  if (code === 0x7f) return true;
  if (code >= 0x80 && code <= 0x9f) return true;
  if (code === 0x2028 || code === 0x2029) return true;
  if (code === 0x60 || code === 0x3c || code === 0x3e) return true;
  return false;
}

/**
 * Strip control / line-sep / fence chars and lone surrogates, then clamp so the
 * emitted UTF-16 .length ≤ MAX_REASON_CHARS WITHOUT splitting a surrogate pair
 * (a whole code point is added or not at all). The reason is synthetic ASCII, so
 * this is defensive — but it keeps the single sanitize chokepoint honest.
 */
function sanitizeReason(s: string): string {
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (ch.length === 1 && cp >= 0xd800 && cp <= 0xdfff) continue; // lone surrogate
    if (isStrippableCode(cp)) continue;
    if (out.length + ch.length > MAX_REASON_CHARS) break;
    out += ch;
  }
  return out;
}

// ── Normalisation ─────────────────────────────────────────────────────────────

/**
 * Normalise the messages payload into one NormMsg PER ARRAY SLOT — junk entries
 * become a safe default view (non-system, len 0, compactable, unprotected) rather
 * than being dropped, so returned indices always align with the caller's array.
 * Bounded by MAX_MESSAGES; hostile length/index getters never throw.
 */
function normalizeViews(raw: unknown): NormMsg[] {
  if (!Array.isArray(raw)) return [];
  let len: number;
  try {
    len = (raw as unknown[]).length;
  } catch {
    return [];
  }
  if (typeof len !== 'number' || !Number.isFinite(len) || len <= 0) return [];
  const limit = Math.min(Math.floor(len), MAX_MESSAGES);
  const out: NormMsg[] = [];
  for (let i = 0; i < limit; i += 1) {
    let m: unknown;
    try {
      m = (raw as unknown[])[i];
    } catch {
      m = null; // hostile array index getter
    }
    const obj = m && typeof m === 'object' ? m : null;
    if (!obj) {
      out.push({ index: i, isSystem: false, contentLen: 0, isToolResult: false, referencedLater: false, protectedFlag: false });
      continue;
    }
    out.push({
      index: i,
      isSystem: isSystemRole(readField(obj, 'role')),
      contentLen: normalizeContentLen(readField(obj, 'contentLen')),
      isToolResult: readField(obj, 'isToolResult') === true,
      referencedLater: readField(obj, 'referencedLater') === true,
      protectedFlag: readField(obj, 'protected') === true,
    });
  }
  return out;
}

// ── Emergency candidate selection ──────────────────────────────────────────────

interface ProtEntry {
  index: number;
  contentLen: number;
}

/**
 * The indices of the largest protected messages: contentLen desc (index asc
 * tiebreak → deterministic), taking the smallest prefix whose summed tokens
 * (Σ contentLen ÷ CHARS_PER_TOKEN) reach `overageTokens`, capped at
 * MAX_HARD_TRUNCATE_CANDIDATES, returned ascending. Always ≥ 1 entry when the
 * protected list is non-empty (the caller shaves these to close the overage).
 */
function selectHardTruncateCandidates(protectedList: ProtEntry[], overageTokens: number): number[] {
  if (protectedList.length === 0) return [];
  const sorted = protectedList.slice().sort((a, b) => (b.contentLen - a.contentLen) || (a.index - b.index));
  const chosen: number[] = [];
  let accChars = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    chosen.push(sorted[i].index);
    accChars += sorted[i].contentLen;
    if (Math.floor(accChars / CHARS_PER_TOKEN) >= overageTokens) break;
    if (chosen.length >= MAX_HARD_TRUNCATE_CANDIDATES) break;
  }
  chosen.sort((a, b) => a - b);
  return chosen;
}

// ── Safe fallback (top-level catch) ─────────────────────────────────────────────

function safeNonePlan(reason: string): CompactionTierPlan {
  const window = DEFAULT_CONTEXT_WINDOW_TOKENS;
  const reserved = clamp(DEFAULT_RESERVED_OUTPUT_TOKENS, 0, Math.floor(window / 2));
  return {
    tier: 'none',
    shouldCompact: false,
    overSoftTrigger: false,
    overHardLimit: false,
    pressureRatio: 0,
    estimatedTokens: 0,
    softTriggerTokens: Math.floor(window * CONTEXT_SAFETY_FRACTION),
    targetTokens: Math.floor(window * CONTEXT_TARGET_FRACTION),
    hardLimitTokens: window - reserved,
    freeableByDropTokens: 0,
    freeableBySummarizeTokens: 0,
    projectedTokensAfterDrop: 0,
    projectedTokensAfterDropAndSummarize: 0,
    hardTruncateOverageTokens: 0,
    hardTruncateCandidates: [],
    reason: sanitizeReason(reason),
  };
}

// ── Main decision ──────────────────────────────────────────────────────────────

/**
 * Select the minimal-sufficient compaction tier. Emergency (hard_truncate) is
 * evaluated first, then the cheapest safe tier that relieves the pressure. See
 * the module header for the full contract. Total: never throws; empty/degenerate
 * input yields a keep-nothing-needed 'none' plan.
 */
export function planCompactionTier(input?: CompactionTierInput | null): CompactionTierPlan {
  try {
    const inObj: unknown = input && typeof input === 'object' ? input : {};

    const window = normalizeWindow(readField(inObj, 'contextWindowTokens'));
    const reservedOutput = normalizeReservedOutput(readField(inObj, 'reservedOutputTokens'), window);
    const keepRecent = normalizeKeepRecent(readField(inObj, 'keepRecentCount'));
    const turnCount = normalizeTurnCount(readField(inObj, 'turnCount'));

    const views = normalizeViews(readField(inObj, 'messages'));
    const n = views.length;

    // Protected recent suffix. Pair guard (id-free, mirrors openswan): never let
    // the kept suffix START with a tool_result — its tool_use would sit in the
    // compacted region → orphan — so pull the boundary back to include it.
    let recentStart = Math.max(0, n - keepRecent);
    while (recentStart > 0 && views[recentStart].isToolResult) recentStart -= 1;

    // Single accumulation pass: total chars, freeable-by-drop (unprotected
    // tool_result bytes) and freeable-by-summarize (unprotected non-tool bytes ×
    // (1 − keep)), plus the protected messages (for the emergency).
    let totalChars = 0;
    let dropChars = 0; // integer
    let summarizeChars = 0; // float (× (1 − SUMMARY_KEEP_FRACTION))
    const protectedList: ProtEntry[] = [];
    for (let i = 0; i < n; i += 1) {
      const v = views[i];
      totalChars += v.contentLen;
      const isProtected = v.protectedFlag || v.isSystem || v.referencedLater || i >= recentStart;
      if (isProtected) {
        protectedList.push({ index: i, contentLen: v.contentLen });
      } else if (v.isToolResult) {
        dropChars += v.contentLen;
      } else {
        summarizeChars += v.contentLen * (1 - SUMMARY_KEEP_FRACTION);
      }
    }

    // Running token estimate: caller-supplied (valid), else derived from Σ chars.
    let est = toFiniteOr(readField(inObj, 'estimatedTokens'), NaN);
    if (!Number.isFinite(est) || est < 0) est = Math.ceil(totalChars / CHARS_PER_TOKEN);
    est = clamp(Math.floor(Math.max(0, est)), 0, MAX_ESTIMATED_TOKENS);

    const freeableByDropTokens = Math.floor(dropChars / CHARS_PER_TOKEN);
    const freeableBySummarizeTokens = Math.floor(summarizeChars / CHARS_PER_TOKEN);

    const softTrigger = Math.floor(window * CONTEXT_SAFETY_FRACTION);
    const target = Math.floor(window * CONTEXT_TARGET_FRACTION);
    const hardLimit = window - reservedOutput; // > 0 (reserved ≤ window/2)

    // Projected loads, clamped ≥ 0 (never split a surrogate… numbers only, but the
    // clamp keeps every reported figure finite & non-negative). Clamping never
    // flips a comparison vs the positive thresholds below.
    const afterDrop = Math.max(0, est - freeableByDropTokens);
    const afterBoth = Math.max(0, afterDrop - freeableBySummarizeTokens);

    const overSoftTrigger = est > softTrigger;
    const overHardLimit = est > hardLimit;
    const pressureRatio = Math.round((est / window) * 1000) / 1000;

    let tier: CompactionTier;
    let overageTokens = 0;
    let candidates: number[] = [];
    let reason: string;

    if (afterBoth > hardLimit && protectedList.length > 0) {
      // (1) EMERGENCY — even max drop+summarise can't fit the hard window. Shave
      // the largest protected messages so the caller can trim before forwarding.
      // Guarded on protectedList.length > 0: with no shave targets (e.g. messages
      // absent but a large caller estimate) hard_truncate could only emit an empty
      // candidate set — an internally-inconsistent "truncate but nothing to shave"
      // plan. That degenerate case flows to branch (3) -> tier 'none' while
      // overHardLimit=true still signals the over-window condition to the caller.
      tier = 'hard_truncate';
      overageTokens = afterBoth - hardLimit;
      candidates = selectHardTruncateCandidates(protectedList, overageTokens);
      reason = 'tier hard_truncate: afterBoth ' + afterBoth + 't over hard ' + hardLimit +
        't overage ' + overageTokens + 't shave ' + candidates.length + ' protected of ' + protectedList.length;
    } else if (!overSoftTrigger) {
      // (2) Under the soft trigger — proactive-only path.
      if (
        turnCount >= PROACTIVE_DROP_TURN_THRESHOLD &&
        freeableByDropTokens >= PROACTIVE_DROP_MIN_FREE_TOKENS &&
        est >= softTrigger * PROACTIVE_DROP_PRESSURE_FLOOR
      ) {
        tier = 'drop_tool_noise';
        reason = 'tier drop_tool_noise: proactive turns ' + turnCount + ' freeableDrop ' +
          freeableByDropTokens + 't est ' + est + 't under soft ' + softTrigger + 't';
      } else {
        tier = 'none';
        reason = 'tier none: est ' + est + 't under soft ' + softTrigger + 't window ' + window + 't';
      }
    } else {
      // (3) Over the soft trigger but the hard window still fits after compaction.
      if (freeableByDropTokens === 0 && freeableBySummarizeTokens === 0) {
        tier = 'none'; // over trigger but nothing compactable (matches openswan keepAll)
        reason = 'tier none: est ' + est + 't over soft ' + softTrigger +
          't nothing compactable under hard ' + hardLimit + 't';
      } else if (freeableByDropTokens > 0 && afterDrop <= target) {
        tier = 'drop_tool_noise'; // cheapest — a free local drop clears the pressure
        reason = 'tier drop_tool_noise: est ' + est + 't afterDrop ' + afterDrop + 't under target ' + target + 't';
      } else if (freeableBySummarizeTokens > 0) {
        tier = 'summarize_oldest'; // drop + summarise (safe from 400: afterBoth ≤ hard)
        reason = 'tier summarize_oldest: est ' + est + 't afterDrop ' + afterDrop + 't afterBoth ' +
          afterBoth + 't target ' + target + 't hard ' + hardLimit + 't';
      } else {
        // Drop alone can't reach target, but nothing unprotected/non-tool remains to
        // summarise (freeableBySummarizeTokens === 0), so drop+summarise would reach
        // the identical end state (afterBoth === afterDrop) while paying for a no-op
        // summariser call. Stay on the cheaper free drop tier. Reaching this else
        // guarantees not-both-zero (branch above), so freeableByDropTokens > 0 here.
        tier = 'drop_tool_noise';
        reason = 'tier drop_tool_noise: est ' + est + 't afterDrop ' + afterDrop +
          't over target ' + target + 't nothing summarizable';
      }
    }

    return {
      tier,
      shouldCompact: tier !== 'none',
      overSoftTrigger,
      overHardLimit,
      pressureRatio: Number.isFinite(pressureRatio) ? pressureRatio : 0,
      estimatedTokens: est,
      softTriggerTokens: softTrigger,
      targetTokens: target,
      hardLimitTokens: hardLimit,
      freeableByDropTokens,
      freeableBySummarizeTokens,
      projectedTokensAfterDrop: afterDrop,
      projectedTokensAfterDropAndSummarize: afterBoth,
      hardTruncateOverageTokens: overageTokens,
      hardTruncateCandidates: candidates,
      reason: sanitizeReason(reason),
    };
  } catch {
    return safeNonePlan('tier none: safe default (input error)');
  }
}
