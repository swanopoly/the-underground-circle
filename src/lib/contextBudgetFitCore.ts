/**
 * contextBudgetFitCore — the cross-SOURCE value-density knapsack that spends ONE
 * token budget across a heterogeneous bag of candidate context items to maximize
 * total value, with per-source floors/caps so max-context-on-demand stays bounded
 * and fair.
 *
 * THE GAP THIS FILLS (grounded in the memory/prompt stack):
 * Every existing budget-spend mechanism operates at the wrong granularity or with
 * the wrong rule for "spend a token budget across many context sources":
 *   - memoryService.retrieveForTurn Step 4 is a single-source rank-order PREFIX
 *     fill that STOPS at the first overflow — a big low-density item early caps
 *     the fill even when small high-value items after it would still fit.
 *   - promptSectionPriorityCore.planSectionFit fits whole SECTIONS by ABSOLUTE
 *     priority and truncates the boundary section mid-item — no cross-source
 *     balance, and it's the OUTER section fit, not the inner item selector.
 *   - circleMemoryDigestCore.waterFill is an EVEN (not value-weighted) split of
 *     ONE source.
 *   - contextDepthPolicy + modelContextBudgetCore only SET/SCALE the budget
 *     number; they never decide which items spend it.
 * So when the depth dial or a large-window model raises the budget, the surplus
 * is spent sub-optimally and one dominant source (count-capped semantic
 * retrieval) can crowd out the single highest-signal user note, with no way to
 * reserve a floor for a source or cap a runaway one. This core is that missing
 * value-per-token knapsack: it CONSUMES the ranked/deduped item bag those passes
 * produce (score -> value) and adds the token-budget + cross-source reservation
 * layer they lack. It never re-ranks, re-dedups, or touches item text.
 *
 * THE KNAPSACK FIX: items are competed by value-DENSITY (value/token) in a single
 * global order; an item that doesn't fit is SKIPPED (not stopped on) so a later
 * cheaper high-value item can still land — the opposite of stop-at-first-overflow.
 * A RESERVATION PASS runs first so a source with a minItems/minTokens floor gets
 * its guaranteed share before the global competition, and per-source
 * maxItems/maxTokens caps a runaway source. Item-ATOMIC throughout: an item is
 * kept whole or not at all — never a partial slice.
 *
 * PURITY / SAFETY CONTRACT:
 *   - ZERO runtime imports (type-only by construction) -> loads under tsx/esbuild;
 *     no react-native/supabase/network. Deliberately takes NO item text — only a
 *     pre-estimated {tokens, value} per item — so no content can flow through.
 *   - DETERMINISTIC: no Date.now()/Math.random()/argless `new Date`; the ranking
 *     is a total order (density -> effValue -> tokens -> input index) so identical
 *     input yields identical selection, always.
 *   - TOTAL: every export handles null/undefined/wrong-type/NaN/Inf/cyclic/
 *     throwing-getter/huge input by returning a safe bounded default, never throws.
 *   - BOUNDED: exported MAX_* caps — input count, keep count, source-rule count,
 *     id/source length, and value magnitude are all clamped.
 *   - SECRET-SAFE: no text field exists; the id/source identifiers are defensively
 *     stripped of control / line-separator / prompt-fence chars and length-clamped;
 *     no free-text content ever appears in any output field.
 */

// ─── Bounds (exported caps; single source of truth) ──────────────────────────

/** Hard cap on scanned input candidates. Extra candidates are ignored. */
export const MAX_CANDIDATES = 5000;
/** Absolute ceiling for the sanitized token budget (and any single item's tokens). */
export const MAX_BUDGET_TOKENS = 1_000_000_000; // 1e9
/** Hard cap on kept items (and the default global item cap when opts.maxItems is unset). */
export const MAX_KEEP_ITEMS = 2000;
/** Hard cap on the number of per-source rules honored. */
export const MAX_SOURCE_RULES = 256;
/** Max characters kept from a candidate id. */
export const MAX_ID_LEN = 256;
/** Max characters kept from a candidate/source-rule source tag. */
export const MAX_SOURCE_LEN = 64;
/** Values are clamped to +/- this magnitude before density ranking. */
export const MAX_VALUE_MAGNITUDE = 1_000_000; // 1e6

/** Internal: source-trust weight clamp. Not part of the public cap surface. */
const MAX_WEIGHT = 1_000_000;
/** Internal: the source tag every blank/unusable source collapses to. */
const DEFAULT_SOURCE = 'default';
/** Internal: bound the pre-clamp scan of a hostile mega-string in cleanLabel. */
const MAX_LABEL_SCAN = 4096;

// ─── Public types ────────────────────────────────────────────────────────────

export interface BudgetCandidate {
  /** Stable identity used for dedup + partition guarantees. Blank -> positional. */
  id: string;
  /** Source tag (memory family, retrieval, connected-resource line, ...). Blank -> 'default'. */
  source: string;
  /** Pre-estimated token cost of including this item (>= 0). */
  tokens: number;
  /** Relevance/value signal (higher = keep). May be negative. */
  value: number;
}

export interface SourceRule {
  /** Reserve at least this many of the source's items (best-effort under budget). */
  minItems?: number;
  /** Never keep more than this many of the source's items (hard cap). */
  maxItems?: number;
  /** Reserve at least this many of the source's tokens (best-effort under budget). */
  minTokens?: number;
  /** Never keep more than this many of the source's tokens (hard cap). */
  maxTokens?: number;
  /** Source-trust multiplier applied to value before density ranking. Default 1. */
  weight?: number;
}

export interface FitBudgetOptions {
  /** Per-source floors/caps/weights, keyed by (normalized) source tag. */
  sourceRules?: Record<string, SourceRule>;
  /** Global cap on total kept items. Omitted -> MAX_KEEP_ITEMS; <= 0 -> keep none. */
  maxItems?: number;
}

export interface FitBudgetResult {
  /** Kept items, grouped by source in first-seen order; within a source, original
   *  input order (stable, prompt-ready). */
  keep: BudgetCandidate[];
  /** Dropped items, in original input order. */
  drop: BudgetCandidate[];
  /** Sum of kept tokens — guaranteed <= the sanitized budget. */
  usedTokens: number;
  /** Per-source rollup, in first-seen source order. */
  bySource: Array<{ source: string; keptItems: number; keptTokens: number; droppedItems: number }>;
}

/** The frozen default rule applied to any source without an explicit rule. */
export const DEFAULT_SOURCE_RULE: Readonly<SourceRule> = Object.freeze({ weight: 1 });

// ─── Internal shapes ─────────────────────────────────────────────────────────

interface CleanRule {
  minItems: number; // >= 0
  maxItems: number | undefined; // undefined = no cap
  minTokens: number; // >= 0
  maxTokens: number | undefined; // undefined = no cap
  weight: number; // >= 0
}

const DEFAULT_CLEAN_RULE: CleanRule = {
  minItems: 0,
  maxItems: undefined,
  minTokens: 0,
  maxTokens: undefined,
  weight: 1,
};

interface Internal {
  id: string;
  source: string;
  tokens: number;
  value: number;
  idx: number; // dense position among survivors (input order) -> total-order tiebreak
}

interface FitItem extends Internal {
  eff: number; // value * source weight
  dens: number; // eff / max(tokens, 1)
}

// ─── Total coercion helpers ──────────────────────────────────────────────────

/**
 * True for a code point we strip from user-influenced labels: C0 controls
 * (0x00-0x1f), DEL (0x7f), line/paragraph separators (0x2028/0x2029), and the
 * prompt-fence chars backtick (0x60), '<' (0x3c), '>' (0x3e). Coded by code point
 * so no literal control char ever appears in this source file.
 */
function isStrippableCode(code: number): boolean {
  if (code <= 0x1f) return true;
  if (code === 0x7f) return true;
  if (code === 0x2028 || code === 0x2029) return true;
  if (code === 0x60 || code === 0x3c || code === 0x3e) return true;
  return false;
}

function stripControlFence(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (!isStrippableCode(s.charCodeAt(i))) out += s[i];
  }
  return out;
}

/**
 * Coerce an untrusted value to a bounded, control/fence-stripped label. Non-
 * primitive (object/symbol/function/nullish) -> ''. Never throws.
 */
function cleanLabel(v: unknown, maxLen: number): string {
  try {
    let s: string;
    if (typeof v === 'string') s = v;
    else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
    else if (typeof v === 'bigint') s = v.toString();
    else if (typeof v === 'boolean') s = v ? 'true' : 'false';
    else return '';
    if (s.length > MAX_LABEL_SCAN) s = s.slice(0, MAX_LABEL_SCAN);
    s = stripControlFence(s).trim();
    if (s.length > maxLen) s = s.slice(0, maxLen).trim();
    return s;
  } catch {
    return '';
  }
}

/** A finite number, or undefined. Accepts number/bigint/numeric-string. */
function toFiniteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'bigint') {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Guarded property read — a throwing getter yields undefined, not a throw. */
function readField(obj: Record<string, unknown>, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

/**
 * Finite, non-negative, integer token count <= MAX_BUDGET_TOKENS.
 * NaN/garbage/<=0 -> 0 (free); +Infinity -> the cap (so it can never fit a real
 * budget). Shared by the budget and per-item token coercion.
 */
function sanitizeTokens(v: unknown): number {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 0;
    if (v === Infinity) return MAX_BUDGET_TOKENS;
    if (v <= 0) return 0;
    return Math.floor(Math.min(v, MAX_BUDGET_TOKENS));
  }
  const n = toFiniteNumber(v);
  if (n === undefined || n <= 0) return 0;
  return Math.floor(Math.min(n, MAX_BUDGET_TOKENS));
}

/** Value clamped to +/-MAX_VALUE_MAGNITUDE. NaN/garbage -> 0; +/-Infinity -> +/-cap. */
function sanitizeValue(v: unknown): number {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 0;
    if (v === Infinity) return MAX_VALUE_MAGNITUDE;
    if (v === -Infinity) return -MAX_VALUE_MAGNITUDE;
    return clamp(v, -MAX_VALUE_MAGNITUDE, MAX_VALUE_MAGNITUDE);
  }
  const n = toFiniteNumber(v);
  if (n === undefined) return 0;
  return clamp(n, -MAX_VALUE_MAGNITUDE, MAX_VALUE_MAGNITUDE);
}

/** Non-negative integer floor <= cap. Missing/garbage/<=0 -> 0 (no floor). */
function sanitizeMin(v: unknown, cap: number): number {
  const n = toFiniteNumber(v);
  if (n === undefined || n <= 0) return 0;
  return Math.floor(Math.min(n, cap));
}

/**
 * Optional non-negative integer cap <= cap. Missing / NaN / +/-Infinity ->
 * undefined (no cap — a garbage max must never accidentally restrict a source).
 * An explicit negative -> 0 (hard zero cap), matching the sibling cores' negative-
 * cap reading.
 */
function sanitizeMax(v: unknown, cap: number): number | undefined {
  if (v === undefined || v === null) return undefined;
  const n = toFiniteNumber(v);
  if (n === undefined) return undefined;
  if (n < 0) return 0;
  return Math.floor(Math.min(n, cap));
}

/** Source-trust weight >= 0, <= MAX_WEIGHT. Missing/garbage/negative -> 1 (default). */
function sanitizeWeight(v: unknown): number {
  if (v === undefined || v === null) return 1;
  const n = toFiniteNumber(v);
  if (n === undefined || n < 0) return 1;
  return Math.min(n, MAX_WEIGHT);
}

/**
 * Global item cap. Missing / NaN / Infinity -> MAX_KEEP_ITEMS (no restriction
 * beyond the hard cap); <= 0 -> 0 (keep nothing); else floor, clamped to the cap.
 */
function resolveGlobalMaxItems(v: unknown): number {
  const n = toFiniteNumber(v);
  if (n === undefined) return MAX_KEEP_ITEMS;
  if (n <= 0) return 0;
  return Math.min(Math.floor(n), MAX_KEEP_ITEMS);
}

// ─── Normalization ───────────────────────────────────────────────────────────

function normalizeOneInternal(raw: unknown): Omit<Internal, 'idx'> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  try {
    const rec = raw as Record<string, unknown>;
    const id = cleanLabel(readField(rec, 'id'), MAX_ID_LEN);
    const source = cleanLabel(readField(rec, 'source'), MAX_SOURCE_LEN) || DEFAULT_SOURCE;
    const tokens = sanitizeTokens(readField(rec, 'tokens'));
    const value = sanitizeValue(readField(rec, 'value'));
    return { id, source, tokens, value };
  } catch {
    return null;
  }
}

/**
 * Coerce the raw bag into bounded, sanitized candidates in input order: cap at
 * MAX_CANDIDATES, drop non-object rows, default a blank source to 'default',
 * synthesize a stable positional id for a blank id, and dedup by final id
 * (FIRST wins). No selection, no ranking. Total.
 */
function normalizeInternal(candidates: unknown): Internal[] {
  if (!Array.isArray(candidates)) return [];
  const out: Internal[] = [];
  const seen = new Set<string>();
  const limit = Math.min(candidates.length, MAX_CANDIDATES);
  for (let i = 0; i < limit; i += 1) {
    let raw: unknown;
    try {
      raw = candidates[i];
    } catch {
      continue; // hostile array index getter
    }
    const parsed = normalizeOneInternal(raw);
    if (!parsed) continue;
    // A blank id gets a stable positional fallback so the item stays trackable.
    // Collisions (with a real id or another synthetic) are safe: first-wins dedup
    // simply drops the later one — no throw, deterministic, bounded.
    const id = parsed.id !== '' ? parsed.id : `auto#${i}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, source: parsed.source, tokens: parsed.tokens, value: parsed.value, idx: out.length });
  }
  return out;
}

function stripInternal(it: Internal): BudgetCandidate {
  return { id: it.id, source: it.source, tokens: it.tokens, value: it.value };
}

/**
 * Defensively coerce + dedup an arbitrary bag into bounded BudgetCandidates
 * (no selection). Input order preserved; junk rows dropped; each id appears once.
 * Total.
 */
export function normalizeCandidates(candidates: unknown): BudgetCandidate[] {
  try {
    return normalizeInternal(candidates).map(stripInternal);
  } catch {
    return [];
  }
}

// ─── Source-rule map ─────────────────────────────────────────────────────────

/**
 * Build a normalized-source -> sanitized-rule map. Keys are normalized exactly as
 * candidate sources (so lookups match); at most MAX_SOURCE_RULES honored; first
 * key wins on a normalization collision. Hostile getters / proxies never throw.
 */
function buildRuleMap(sourceRules: unknown): Map<string, CleanRule> {
  const map = new Map<string, CleanRule>();
  if (!sourceRules || typeof sourceRules !== 'object') return map;
  let keys: string[];
  try {
    keys = Object.keys(sourceRules as Record<string, unknown>);
  } catch {
    return map;
  }
  const rules = sourceRules as Record<string, unknown>;
  const limit = Math.min(keys.length, MAX_SOURCE_RULES);
  for (let i = 0; i < limit; i += 1) {
    const rawKey = keys[i];
    const source = cleanLabel(rawKey, MAX_SOURCE_LEN) || DEFAULT_SOURCE;
    if (map.has(source)) continue; // first wins
    const ruleRaw = readField(rules, rawKey);
    if (!ruleRaw || typeof ruleRaw !== 'object') {
      map.set(source, { ...DEFAULT_CLEAN_RULE });
      continue;
    }
    const r = ruleRaw as Record<string, unknown>;
    map.set(source, {
      minItems: sanitizeMin(readField(r, 'minItems'), MAX_KEEP_ITEMS),
      maxItems: sanitizeMax(readField(r, 'maxItems'), MAX_KEEP_ITEMS),
      minTokens: sanitizeMin(readField(r, 'minTokens'), MAX_BUDGET_TOKENS),
      maxTokens: sanitizeMax(readField(r, 'maxTokens'), MAX_BUDGET_TOKENS),
      weight: sanitizeWeight(readField(r, 'weight')),
    });
  }
  return map;
}

// ─── Ranking (total order) ───────────────────────────────────────────────────

/**
 * Value-density descending, then effValue desc, then tokens asc, then input index
 * asc. A total order independent of sort stability -> deterministic selection.
 */
function cmp(a: FitItem, b: FitItem): number {
  if (b.dens !== a.dens) return b.dens - a.dens;
  if (b.eff !== a.eff) return b.eff - a.eff;
  if (a.tokens !== b.tokens) return a.tokens - b.tokens;
  return a.idx - b.idx;
}

function emptyResult(): FitBudgetResult {
  return { keep: [], drop: [], usedTokens: 0, bySource: [] };
}

// ─── Main ────────────────────────────────────────────────────────────────────

/**
 * Select the item-atomic subset of `candidates` that fits `budgetTokens` to
 * maximize total value, honoring per-source reservations (minItems/minTokens),
 * per-source caps (maxItems/maxTokens), source-trust weights, and a global item
 * cap. Two passes:
 *   1. RESERVATION — for each source (first-seen order) with a floor, take its own
 *      items best-first (density order), skipping items that don't fit the
 *      remaining global budget or the source token cap, until both floors are met
 *      or a cap is hit. Best-effort in source order when the budget is too small
 *      to satisfy every floor.
 *   2. GLOBAL DENSITY — sort the remaining items by value-density desc and greedily
 *      KEEP each that fits (SKIP, never stop, on the ones that don't — the knapsack
 *      fix vs stop-at-first-overflow), subject to per-source and global caps.
 *      Zero-token items are free (kept if caps allow).
 *
 * GUARANTEES: usedTokens <= sanitized budget always; keep union drop covers every
 * valid input id exactly once; per-source maxItems/maxTokens never exceeded;
 * minItems/minTokens honored whenever the budget permits. Deterministic; bounded;
 * never throws — hostile input yields a safe neutral result.
 */
export function fitCandidatesToBudget(
  candidates: unknown,
  budgetTokens: unknown,
  opts?: FitBudgetOptions,
): FitBudgetResult {
  try {
    const normalized = normalizeInternal(candidates);
    if (normalized.length === 0) return emptyResult();

    const budget = sanitizeTokens(budgetTokens);
    const optsObj = opts && typeof opts === 'object' ? (opts as Record<string, unknown>) : undefined;
    const globalMaxItems = resolveGlobalMaxItems(optsObj ? readField(optsObj, 'maxItems') : undefined);
    const ruleMap = buildRuleMap(optsObj ? readField(optsObj, 'sourceRules') : undefined);

    // Attach effValue/density; bucket by source in first-seen order.
    const firstSeen: string[] = [];
    const buckets = new Map<string, FitItem[]>();
    const items: FitItem[] = new Array(normalized.length);
    for (let i = 0; i < normalized.length; i += 1) {
      const it = normalized[i];
      const rule = ruleMap.get(it.source) ?? DEFAULT_CLEAN_RULE;
      const eff = it.value * rule.weight;
      const fit: FitItem = { ...it, eff, dens: eff / Math.max(it.tokens, 1) };
      items[i] = fit;
      let bucket = buckets.get(it.source);
      if (!bucket) {
        bucket = [];
        buckets.set(it.source, bucket);
        firstSeen.push(it.source);
      }
      bucket.push(fit);
    }

    const keptSet = new Set<number>();
    const keptItemsBySource = new Map<string, number>();
    const keptTokensBySource = new Map<string, number>();
    let remainingBudget = budget;
    let totalKept = 0;

    // ── Pass 1: reservation ──────────────────────────────────────────────────
    if (budget > 0 && globalMaxItems > 0) {
      for (const source of firstSeen) {
        if (totalKept >= globalMaxItems) break;
        const rule = ruleMap.get(source);
        if (!rule) continue; // only sources with an explicit rule can floor
        const { minItems, minTokens } = rule;
        if (minItems <= 0 && minTokens <= 0) continue; // no floor to reserve
        const bucket = buckets.get(source);
        if (!bucket || bucket.length === 0) continue;
        const sorted = bucket.slice().sort(cmp);
        let sItems = keptItemsBySource.get(source) ?? 0;
        let sTokens = keptTokensBySource.get(source) ?? 0;
        for (const it of sorted) {
          if (sItems >= minItems && sTokens >= minTokens) break; // floors met
          if (totalKept >= globalMaxItems) break; // global item cap
          if (rule.maxItems !== undefined && sItems >= rule.maxItems) break; // source item cap
          if (it.tokens > remainingBudget) continue; // won't fit -> try a smaller one
          if (rule.maxTokens !== undefined && sTokens + it.tokens > rule.maxTokens) continue; // token cap
          keptSet.add(it.idx);
          sItems += 1;
          sTokens += it.tokens;
          remainingBudget -= it.tokens;
          totalKept += 1;
        }
        keptItemsBySource.set(source, sItems);
        keptTokensBySource.set(source, sTokens);
      }

      // ── Pass 2: global value-density greedy fill ───────────────────────────
      const remaining: FitItem[] = [];
      for (const it of items) if (!keptSet.has(it.idx)) remaining.push(it);
      remaining.sort(cmp);
      for (const it of remaining) {
        if (totalKept >= globalMaxItems) break; // no more slots at all
        // Non-positive weighted value never improves the objective: a negative-eff
        // item strictly LOWERS total kept value, and a zero-eff item only wastes a
        // slot/budget. `remaining` is density-desc sorted and sign(dens)==sign(eff)
        // (dens = eff / max(tokens,1), denom > 0), so all eff<=0 items form a
        // contiguous tail — a single break drops them and keeps the selection
        // value-maximizing. Pass 1 floors are exempt (reserved before this loop).
        if (it.eff <= 0) break;
        const rule = ruleMap.get(it.source) ?? DEFAULT_CLEAN_RULE;
        const sItems = keptItemsBySource.get(it.source) ?? 0;
        const sTokens = keptTokensBySource.get(it.source) ?? 0;
        if (rule.maxItems !== undefined && sItems >= rule.maxItems) continue; // source full
        if (it.tokens > remainingBudget) continue; // won't fit -> SKIP (knapsack), don't stop
        if (rule.maxTokens !== undefined && sTokens + it.tokens > rule.maxTokens) continue; // token cap
        keptSet.add(it.idx);
        keptItemsBySource.set(it.source, sItems + 1);
        keptTokensBySource.set(it.source, sTokens + it.tokens);
        remainingBudget -= it.tokens;
        totalKept += 1;
      }
    }

    // ── Emit ──────────────────────────────────────────────────────────────────
    const keep: BudgetCandidate[] = [];
    for (const source of firstSeen) {
      const bucket = buckets.get(source);
      if (!bucket) continue;
      for (const it of bucket) if (keptSet.has(it.idx)) keep.push(stripInternal(it));
    }
    const drop: BudgetCandidate[] = [];
    let usedTokens = 0;
    for (const it of items) {
      if (keptSet.has(it.idx)) usedTokens += it.tokens;
      else drop.push(stripInternal(it));
    }
    if (usedTokens > budget) usedTokens = budget; // defensive invariant guard

    const bySource = firstSeen.map((source) => {
      const bucket = buckets.get(source);
      const total = bucket ? bucket.length : 0;
      const keptItems = keptItemsBySource.get(source) ?? 0;
      const keptTokens = keptTokensBySource.get(source) ?? 0;
      return { source, keptItems, keptTokens, droppedItems: total - keptItems };
    });

    return { keep, drop, usedTokens, bySource };
  } catch {
    return emptyResult();
  }
}
