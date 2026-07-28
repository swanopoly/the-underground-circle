/**
 * memoryRetrievalPolicyCore — the pure RELEVANCE-POLICY layer for turn-time
 * memory recall (`memoryService.retrieveForTurn` / `buildPromptMemoryBundle`).
 *
 * It answers four questions that had no owner, each of which was a live defect:
 *
 *   1. HOW MUCH is a `pinned` memory worth?  `pinned` is a real column
 *      (20260408_memory_v2_retrieval_privacy.sql) that pinMemory/unpinMemory
 *      write, but neither the `match_memories` RPC projection nor the keyword
 *      fallback's row mapper carried it, so the boost was dead on BOTH branches
 *      and user pinning changed nothing the model saw. The boost lives here;
 *      the plumbing fixes live in the migration + mapMemoryEntry.
 *
 *   2. WHEN is a match too weak to inject?  Retrieval asked the RPC for
 *      threshold 0 and then selected purely by value-density with no floor at
 *      all. On a small circle the top-N cosine neighbours of a totally
 *      unrelated question still filled the memory block. `relevanceFloorFor` +
 *      `scoreRetrievalCandidate` add the missing floor. The same defect had a
 *      second half: the ILIKE fallback stamped every lexical row with a flat
 *      synthetic similarity of 0.5 — above most genuine cosine scores — so
 *      lexical noise outranked weak-but-real semantic recall. Here a keyword row
 *      is scored on its own normalized scale (term coverage) and then DISCOUNTED
 *      by a confidence factor, so it can never masquerade as semantic evidence.
 *
 *   3. WHICH prompt section gives up chars when the memory bundle overflows?
 *      The bundle joined [startup, wisdom, external, RELEVANT-THIS-TURN,
 *      supporting] and tail-sliced to 5000 chars, so the query-ranked section —
 *      4th of 5 — was truncated FIRST: the block selected BECAUSE it matched
 *      this turn was the block most likely to be cut. `planMemoryBundleSections`
 *      replaces the tail slice with a per-section cap + the existing
 *      value-density knapsack, with a reservation for the query-ranked section.
 *
 *   4. CAN an un-embedded memory still be recalled?  The ILIKE fallback was an
 *      `else` on "semantic returned nothing", and `match_memories` filters
 *      `embedding IS NOT NULL`. So the moment ONE row in a circle got embedded,
 *      every un-embedded row became permanently unreachable — silently, with no
 *      error anywhere. `mergeRetrievalCandidates` makes the branches a UNION.
 *
 * BOUNDARY vs neighbours:
 *   - contextBudgetFitCore  = the generic value-density knapsack. This core
 *     supplies the memory-specific VALUES/CAPS and calls it; it does not
 *     reimplement it.
 *   - chatRetrievalRankCore = cross-STORE dedup + re-rank of an already-retrieved
 *     bag. This core is upstream of that: it decides what is admissible at all.
 *   - memoryDedupeCore      = write-path identity. Unrelated.
 *
 * CALIBRATION NOTE (why these numbers): the embedding model is
 * `text-embedding-3-small` at 1536 dims (memoryEmbeddings.ts). Unlike ada-002 —
 * whose cosine scores compress into a ~0.70-0.90 band, making any small absolute
 * floor meaningless — 3-small spreads scores out: unrelated short texts land
 * roughly 0.00-0.25, same-topic-different-specifics roughly 0.25-0.40, genuinely
 * on-topic roughly 0.40-0.70, near-paraphrase 0.70+. Every threshold below is
 * expressed against that scale and is documented at its definition. If the
 * embedding model is ever swapped, THESE CONSTANTS MUST BE RECALIBRATED — that
 * is the one coupling this file cannot check for itself.
 *
 * POLICY BIAS (stated once, applied everywhere): a memory that fails to surface
 * is a mild degradation the user rarely notices; an irrelevant memory crowding
 * out a relevant one is a regression they do. So floors are set just above the
 * observed noise band rather than in the middle of the signal band, and every
 * discount is applied to the CHALLENGER (keyword, suppressed, stale), never to
 * the incumbent evidence.
 *
 * PURITY / SAFETY CONTRACT:
 *   - Only a type-free runtime import of contextBudgetFitCore (itself
 *     import-free) -> loads under tsx/esbuild; no react-native/supabase/network.
 *   - DETERMINISTIC: no Date.now()/Math.random()/argless `new Date`. Callers pass
 *     `nowMs`. Ranking is a total order, so identical input -> identical output.
 *   - TOTAL: every export tolerates null/undefined/wrong-type/NaN/Inf/cyclic/
 *     throwing-getter/huge input and returns a safe bounded default; never throws.
 *   - BOUNDED: exported MAX_* caps on scanned candidates, terms, and text scans.
 *   - SECRET-SAFE: no memory text is stored, echoed, or returned. Text is only
 *     ever read to compute a numeric coverage or a length-clamped prefix that is
 *     returned to the caller that supplied it.
 */

import { fitCandidatesToBudget } from './contextBudgetFitCore';

// ─── Bounds ──────────────────────────────────────────────────────────────────

/** Hard cap on scanned retrieval candidates per call. */
export const MAX_POLICY_CANDIDATES = 2000;
/** Hard cap on query terms honored by coverage scoring. */
export const MAX_COVERAGE_TERMS = 24;
/** Max characters of a single term compared (a hostile mega-token is clamped). */
export const MAX_TERM_LEN = 64;
/** Max characters of title+content scanned for coverage. */
export const MAX_HAYSTACK_SCAN = 20_000;
/** Max characters any single bundle section may occupy after clamping. */
export const MAX_SECTION_CHARS = 200_000;

// ─── Relevance thresholds ────────────────────────────────────────────────────

/**
 * Absolute cosine floor for a SEMANTIC hit (text-embedding-3-small scale).
 *
 * 0.28 sits just above the top of the observed unrelated-pair band (~0.25) and
 * comfortably below the same-topic band (~0.35-0.40), so it removes "nearest
 * neighbour of a question this circle has no memory about" without touching a
 * weak-but-real hit. Deliberately NOT 0.35+: on a short user turn vs. a
 * one-sentence memory, a genuinely useful recall routinely scores 0.30-0.40,
 * and dropping those trades a noticeable regression for an invisible one.
 */
export const SEMANTIC_RELEVANCE_FLOOR = 0.28;

/**
 * Threshold handed to the `match_memories` RPC so obvious noise is pruned in
 * Postgres instead of over the wire. It is the LOWEST floor any candidate could
 * face (a pinned semantic row, see PINNED_FLOOR_RELIEF) — never higher, or the
 * database would silently pre-empt a decision this core is supposed to own.
 */
export const SEMANTIC_RPC_MATCH_THRESHOLD = 0.18;

/**
 * The relevance a KEYWORD (ILIKE) row gets when it matches every distinctive
 * query term. Capped at 0.45 — the top of the "same topic" band — because full
 * lexical coverage proves shared vocabulary, never shared meaning. A lexical hit
 * therefore cannot reach the "on-topic" (0.45+) or "paraphrase" (0.70+) bands
 * that only embedding evidence can earn.
 *
 * Replaces the old flat synthetic 0.5, which ranked EVERY lexical row above most
 * genuine cosine matches.
 */
export const KEYWORD_RELEVANCE_CEILING = 0.45;

/**
 * Floor for a KEYWORD row: 0.18 == 40% weighted term coverage at the ceiling.
 * Below that the row shares a couple of incidental words with the question and
 * is exactly the lexical noise that used to outrank real recall.
 */
export const KEYWORD_RELEVANCE_FLOOR = 0.18;

/** Coverage credit added when a query term appears in the TITLE, not just the body. */
export const KEYWORD_TITLE_BONUS = 0.15;

/** Trust in a semantic relevance number. Reference point for the discount below. */
export const SEMANTIC_CONFIDENCE = 1;

/**
 * Trust discount applied to a keyword relevance before it competes for a slot.
 * 0.6 means a PERFECT lexical match enters ranking at 0.45*0.6 = 0.27 — right at
 * the semantic floor, i.e. "as good as the weakest admissible real match, and no
 * better". That is what keeps an un-embedded row reachable (bug 4) without
 * letting it displace embedded evidence (the old 0.5 bug).
 */
export const KEYWORD_CONFIDENCE = 0.6;

/**
 * Additive boost for an explicitly pinned memory. Unchanged from the (dead)
 * value retrieval already intended to apply; the fix is that it now reaches a
 * row at all. 0.12 is roughly one similarity band — enough to win a tie and to
 * beat a slightly closer neighbour, not enough to drag an off-topic memory in.
 */
export const PINNED_BOOST = 0.12;

/**
 * How much of the relevance floor a pin buys back. Pinning is the strongest
 * explicit human signal in the system, so a pinned memory gets a second look
 * (floor 0.28 -> 0.18 semantic, 0.18 -> 0.08 keyword) — but NOT an exemption:
 * the "always inject" mechanism is `retrieval_mode = 'startup'`, not `pinned`,
 * and a pinned billing note still must not answer a CSS question.
 */
export const PINNED_FLOOR_RELIEF = 0.10;

/**
 * Absolute non-negativity guard on the final score. The meaningful score gate is
 * `finalScoreFloorFor` below; this is only here so a pathological set of
 * negative adjustments can never yield a "kept" candidate.
 */
export const MIN_FINAL_SCORE = 0.01;

// ─── Ranking weights (relocated verbatim from retrieveForTurn) ───────────────

/** Multiplier on the extractor's 0..1 importance. */
export const IMPORTANCE_BONUS_WEIGHT = 0.15;
/** Full swing of the manual-review helpfulness signal: +/- half of this. */
export const HELPFULNESS_SWING = 0.24;
/** Full swing of the passive archive-retrieval signal: +/- half of this. */
export const ARCHIVE_PASSIVE_SWING = 0.18;
/** Recency half-life in days. */
export const RECENCY_HALF_LIFE_DAYS = 30;
/**
 * Floor of the recency multiplier: score *= RECENCY_FLOOR + (1-RECENCY_FLOOR)*decay.
 * An infinitely old memory keeps 60% of its score, so age discounts but never bans.
 */
export const RECENCY_FLOOR = 0.6;
/** Default cap on selected memories per turn. */
export const DEFAULT_FINAL_COUNT = 12;

// ─── Bundle-section policy ───────────────────────────────────────────────────

/** Canonical bundle section ids, in presentation order. */
export const MEMORY_BUNDLE_SECTIONS = {
  startup: 'startup',
  soulWisdom: 'soul_wisdom',
  externalAgents: 'external_agents',
  relevantTurn: 'relevant_turn',
  supporting: 'supporting',
} as const;

export type MemoryBundleSectionId =
  (typeof MEMORY_BUNDLE_SECTIONS)[keyof typeof MEMORY_BUNDLE_SECTIONS];

/** Default total char budget for the assembled memory bundle (was a tail slice). */
export const MEMORY_BUNDLE_BUDGET_CHARS = 5000;

/**
 * Per-section value used by the knapsack. `relevant_turn` is highest because it
 * is the ONLY section chosen against this specific question; everything else is
 * standing context that was equally true last turn. `supporting` is lowest — by
 * construction it is the leftovers the ranked pass already declined.
 */
export const MEMORY_BUNDLE_SECTION_VALUE: Record<string, number> = {
  [MEMORY_BUNDLE_SECTIONS.relevantTurn]: 1,
  [MEMORY_BUNDLE_SECTIONS.startup]: 0.7,
  [MEMORY_BUNDLE_SECTIONS.soulWisdom]: 0.5,
  [MEMORY_BUNDLE_SECTIONS.externalAgents]: 0.45,
  [MEMORY_BUNDLE_SECTIONS.supporting]: 0.25,
};

/** Value for a section id the table does not know about. */
export const MEMORY_BUNDLE_DEFAULT_SECTION_VALUE = 0.3;

/**
 * Fraction of the total budget any one section may occupy. Caps sum to >1 on
 * purpose — they are ceilings, not reservations; the knapsack still enforces the
 * total. The point is that no single bulky section (historically `startup`) can
 * consume the budget before the query-ranked section is even considered.
 */
export const MEMORY_BUNDLE_SECTION_SHARE_CAP: Record<string, number> = {
  [MEMORY_BUNDLE_SECTIONS.relevantTurn]: 0.45,
  [MEMORY_BUNDLE_SECTIONS.startup]: 0.4,
  [MEMORY_BUNDLE_SECTIONS.soulWisdom]: 0.25,
  [MEMORY_BUNDLE_SECTIONS.externalAgents]: 0.25,
  [MEMORY_BUNDLE_SECTIONS.supporting]: 0.2,
};

/** Share cap for an unknown section id. */
export const MEMORY_BUNDLE_DEFAULT_SHARE_CAP = 0.25;

/** Marker appended when a section had to be clamped, so the model knows it was cut. */
export const SECTION_TRUNCATION_MARKER = '\n…(truncated)';

/**
 * Minimum chars worth reviving a dropped section with. Below this a section is a
 * stub that costs budget and carries no usable content, so the residual is
 * better spent lengthening a section that is already present.
 */
export const MEMORY_BUNDLE_MIN_REVIVE_CHARS = 160;

// ─── Public types ────────────────────────────────────────────────────────────

export type MemoryMatchSource = 'semantic' | 'keyword';

/** Everything the policy needs about one candidate. All fields optional/hostile-safe. */
export interface RetrievalCandidateSignals {
  id: string;
  /** 'keyword' for ILIKE-fallback rows; anything else is treated as 'semantic'. */
  matchSource?: MemoryMatchSource | string | null;
  /** Raw cosine similarity 0..1 (semantic rows only). */
  similarity?: number | null;
  /** Weighted 0..1 fraction of distinctive query terms present (keyword rows only). */
  keywordCoverage?: number | null;
  /** True when at least one query term matched the TITLE. */
  keywordTitleHit?: boolean | null;
  pinned?: boolean | null;
  /** Extractor importance 0..1. */
  importance?: number | null;
  /** Caller-computed soul-affinity boost (soul link roles live outside this core). */
  soulBoost?: number | null;
  /** Caller-computed task-affinity boost. */
  taskAffinity?: number | null;
  /** Mean manual-review score 0..1, or null when unrated. */
  helpfulness?: number | null;
  /** Mean passive archive-retrieval score 0..1, or null when not applicable. */
  archivePassive?: number | null;
  /** updated_at (preferred) or created_at as epoch ms. Null/invalid -> treated as now. */
  timestampMs?: number | null;
}

export interface RetrievalCandidateScore {
  id: string;
  matchSource: MemoryMatchSource;
  /** Source-normalized 0..1 relevance (cosine, or the keyword proxy). */
  relevance: number;
  /** Trust weight applied to `relevance` before ranking. */
  confidence: number;
  /** Relevance floor this candidate actually had to clear (pin relief applied). */
  floor: number;
  /** Post-boost score gate this candidate had to clear, on its own source scale. */
  scoreFloor: number;
  /** Pre-recency sum of relevance*confidence and every additive boost. */
  baseScore: number;
  /** Recency multiplier actually applied (RECENCY_FLOOR..1). */
  recencyMultiplier: number;
  /** Final ranking score. */
  score: number;
  pinned: boolean;
  admissible: boolean;
  rejectReason: 'below_relevance_floor' | 'below_score_floor' | 'invalid' | null;
}

export interface SelectRetrievalOptions {
  /** Required for the recency decay. Invalid -> recency is neutral (multiplier 1). */
  nowMs?: number | null;
  /** Cap on kept candidates. Default DEFAULT_FINAL_COUNT. */
  finalCount?: number | null;
  /** Escape hatch for callers that need the floors off (diagnostics only). */
  enforceFloors?: boolean;
}

export interface SelectRetrievalResult {
  keep: RetrievalCandidateScore[];
  drop: RetrievalCandidateScore[];
  /** Count of candidates rejected by each reason — cheap, secret-free telemetry. */
  rejected: { belowRelevanceFloor: number; belowScoreFloor: number; invalid: number };
}

export interface MemoryBundleSectionInput {
  id: string;
  /** Rendered length of the section, in characters. */
  chars: number;
}

export interface MemoryBundleSectionPlan {
  id: string;
  keep: boolean;
  /** Characters this section may render. 0 when dropped. */
  maxChars: number;
  /** True when maxChars < the requested chars (caller must clamp the text). */
  truncated: boolean;
}

export interface MemoryBundlePlan {
  sections: MemoryBundleSectionPlan[];
  keptIds: string[];
  usedChars: number;
  budgetChars: number;
}

// ─── Internal helpers (total; hostile input never escapes) ───────────────────

function readField(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined; // throwing getter
  }
}

function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function clamp01(value: unknown, fallback = 0): number {
  return clamp(finiteNumber(value, fallback), 0, 1);
}

function safeString(value: unknown, maxLen: number): string {
  if (typeof value !== 'string') return '';
  return value.length > maxLen ? value.slice(0, maxLen) : value;
}

function safeId(value: unknown): string {
  if (typeof value === 'string') return value.length > 256 ? value.slice(0, 256) : value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function normalizeMatchSource(value: unknown): MemoryMatchSource {
  return value === 'keyword' ? 'keyword' : 'semantic';
}

// ─── Keyword relevance (bug 2, second half: lexical != semantic) ─────────────

/**
 * Weighted fraction of the distinctive query terms present in a candidate row,
 * plus whether any of them landed in the title.
 *
 * Length-weighted (capped at MAX_TERM_LEN) because a long distinctive token
 * ("pgbouncer") is far stronger evidence of aboutness than a short generic one
 * ("app"), and unweighted coverage would let three throwaway words outscore it.
 *
 * Returns coverage in 0..1. Never throws; empty/hostile input -> 0.
 */
export function computeKeywordCoverage(
  terms: unknown,
  title: unknown,
  content: unknown,
): { coverage: number; titleHit: boolean; matchedTerms: number } {
  try {
    if (!Array.isArray(terms) || terms.length === 0) {
      return { coverage: 0, titleHit: false, matchedTerms: 0 };
    }
    const titleText = safeString(title, MAX_HAYSTACK_SCAN).toLowerCase();
    const bodyText = safeString(content, MAX_HAYSTACK_SCAN).toLowerCase();
    const haystack = `${titleText}\n${bodyText}`;

    const seen = new Set<string>();
    let totalWeight = 0;
    let matchedWeight = 0;
    let matchedTerms = 0;
    let titleHit = false;

    const limit = Math.min(terms.length, MAX_COVERAGE_TERMS);
    for (let i = 0; i < limit; i += 1) {
      const raw = terms[i];
      const term = safeString(raw, MAX_TERM_LEN).trim().toLowerCase();
      if (!term || seen.has(term)) continue;
      seen.add(term);
      const weight = Math.min(term.length, MAX_TERM_LEN);
      totalWeight += weight;
      if (haystack.includes(term)) {
        matchedWeight += weight;
        matchedTerms += 1;
        if (!titleHit && titleText.includes(term)) titleHit = true;
      }
    }

    if (totalWeight <= 0) return { coverage: 0, titleHit: false, matchedTerms: 0 };
    return { coverage: clamp(matchedWeight / totalWeight, 0, 1), titleHit, matchedTerms };
  } catch {
    return { coverage: 0, titleHit: false, matchedTerms: 0 };
  }
}

/**
 * Map keyword coverage onto the shared 0..1 relevance scale. Ceiling-bounded so
 * a lexical row can never enter the bands that only embedding evidence earns.
 */
export function keywordRelevance(coverage: unknown, titleHit?: unknown): number {
  const base = clamp01(coverage);
  const withBonus = clamp(base + (titleHit === true ? KEYWORD_TITLE_BONUS : 0), 0, 1);
  return clamp(KEYWORD_RELEVANCE_CEILING * withBonus, 0, 1);
}

/**
 * The relevance floor a candidate must clear, given its evidence source and
 * whether the user pinned it. Pinning buys `PINNED_FLOOR_RELIEF` off the floor —
 * a second look, never an exemption.
 */
export function relevanceFloorFor(matchSource: unknown, pinned?: unknown): number {
  const base = normalizeMatchSource(matchSource) === 'keyword'
    ? KEYWORD_RELEVANCE_FLOOR
    : SEMANTIC_RELEVANCE_FLOOR;
  return pinned === true ? Math.max(0, base - PINNED_FLOOR_RELIEF) : base;
}

/**
 * The POST-BOOST score gate. The relevance floor is the real admissibility test;
 * this second gate exists for one job: drop a candidate that squeaked past the
 * relevance floor and was then actively SUPPRESSED (a human "not helpful"
 * verdict, an archive down-vote) instead of injecting it anyway.
 *
 * It is DERIVED, not a flat constant, and that matters. The score of a
 * just-barely-admissible, unboosted, maximally recency-decayed candidate is
 * `floor * confidence * RECENCY_FLOOR` — and that number is different for a
 * semantic row (0.28) and a confidence-discounted keyword row (0.108). A flat
 * absolute floor calibrated on the semantic scale would silently double-penalize
 * every keyword row and re-create the un-embedded-memory blind spot this pass
 * exists to fix. Expressing the gate on each source's OWN scale means it tests
 * only what it claims to test: "did feedback push this below its own baseline?"
 */
export function finalScoreFloorFor(relevanceFloor: unknown, confidence: unknown): number {
  const floor = clamp(finiteNumber(relevanceFloor, 0), 0, 1);
  const conf = clamp(finiteNumber(confidence, 1), 0, 1);
  return Math.max(MIN_FINAL_SCORE, floor * conf * RECENCY_FLOOR);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Score ONE candidate. Deterministic: `nowMs` is injected, never read from the
 * clock. The additive/multiplicative shape is preserved verbatim from the live
 * scorer (`base * (RECENCY_FLOOR + (1-RECENCY_FLOOR)*decay)`); what is new is
 * (a) source-normalized relevance instead of a flat synthetic 0.5 for keyword
 * rows, (b) the confidence discount, (c) the pinned boost actually reaching a
 * row, and (d) the two floors.
 */
export function scoreRetrievalCandidate(
  candidate: unknown,
  nowMs: unknown,
  opts?: { enforceFloors?: boolean },
): RetrievalCandidateScore {
  const enforce = opts?.enforceFloors !== false;
  const id = safeId(readField(candidate, 'id'));

  const invalid = (reason: RetrievalCandidateScore['rejectReason']): RetrievalCandidateScore => ({
    id,
    matchSource: 'semantic',
    relevance: 0,
    confidence: 0,
    floor: SEMANTIC_RELEVANCE_FLOOR,
    scoreFloor: finalScoreFloorFor(SEMANTIC_RELEVANCE_FLOOR, SEMANTIC_CONFIDENCE),
    baseScore: 0,
    recencyMultiplier: RECENCY_FLOOR,
    score: 0,
    pinned: false,
    admissible: false,
    rejectReason: reason,
  });

  try {
    if (!id) return invalid('invalid');

    const matchSource = normalizeMatchSource(readField(candidate, 'matchSource'));
    const pinned = readField(candidate, 'pinned') === true;

    const relevance = matchSource === 'keyword'
      ? keywordRelevance(readField(candidate, 'keywordCoverage'), readField(candidate, 'keywordTitleHit'))
      : clamp01(readField(candidate, 'similarity'));
    const confidence = matchSource === 'keyword' ? KEYWORD_CONFIDENCE : SEMANTIC_CONFIDENCE;
    const floor = relevanceFloorFor(matchSource, pinned);
    const scoreFloor = finalScoreFloorFor(floor, confidence);

    // Recency: half-life decay on age, floored so old-but-relevant is discounted,
    // never banned. An unusable/absent timestamp is treated as "now" (multiplier 1)
    // rather than as infinitely old — missing metadata must not silently suppress.
    const now = finiteNumber(nowMs, NaN);
    const stamp = finiteNumber(readField(candidate, 'timestampMs'), NaN);
    let recencyMultiplier = 1;
    if (Number.isFinite(now) && Number.isFinite(stamp)) {
      const halfLifeMs = RECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
      const ageMs = Math.max(0, now - stamp);
      const decay = Math.exp(-Math.LN2 * (ageMs / halfLifeMs));
      recencyMultiplier = clamp(
        RECENCY_FLOOR + (1 - RECENCY_FLOOR) * (Number.isFinite(decay) ? decay : 0),
        RECENCY_FLOOR,
        1,
      );
    }

    const pinnedBoost = pinned ? PINNED_BOOST : 0;
    const importanceBonus = clamp01(readField(candidate, 'importance')) * IMPORTANCE_BONUS_WEIGHT;
    const soulBoost = clamp(finiteNumber(readField(candidate, 'soulBoost'), 0), 0, 1);
    const taskAffinity = clamp(finiteNumber(readField(candidate, 'taskAffinity'), 0), -1, 1);

    const helpfulnessRaw = readField(candidate, 'helpfulness');
    const helpfulness = typeof helpfulnessRaw === 'number' && Number.isFinite(helpfulnessRaw)
      ? clamp(helpfulnessRaw, 0, 1)
      : null;
    const helpfulnessAdjustment = helpfulness == null ? 0 : (helpfulness - 0.5) * HELPFULNESS_SWING;

    const archiveRaw = readField(candidate, 'archivePassive');
    const archivePassive = typeof archiveRaw === 'number' && Number.isFinite(archiveRaw)
      ? clamp(archiveRaw, 0, 1)
      : null;
    const archiveAdjustment = archivePassive == null ? 0 : (archivePassive - 0.5) * ARCHIVE_PASSIVE_SWING;

    const baseScore = relevance * confidence
      + soulBoost
      + pinnedBoost
      + importanceBonus
      + helpfulnessAdjustment
      + archiveAdjustment
      + taskAffinity;
    const rawScore = baseScore * recencyMultiplier;
    const score = Number.isFinite(rawScore) ? rawScore : 0;

    let rejectReason: RetrievalCandidateScore['rejectReason'] = null;
    if (enforce) {
      if (relevance < floor) rejectReason = 'below_relevance_floor';
      else if (score < scoreFloor) rejectReason = 'below_score_floor';
    }

    return {
      id,
      matchSource,
      relevance,
      confidence,
      floor,
      scoreFloor,
      baseScore: Number.isFinite(baseScore) ? baseScore : 0,
      recencyMultiplier,
      score,
      pinned,
      admissible: rejectReason === null,
      rejectReason,
    };
  } catch {
    return invalid('invalid');
  }
}

/**
 * Score, floor-filter, and rank a whole candidate set.
 *
 * Order is a TOTAL order — score desc, then relevance desc, then semantic before
 * keyword, then input index — so selection is stable and reproducible regardless
 * of sort stability or the order the two retrieval branches happened to return.
 */
export function selectRetrievalCandidates(
  candidates: unknown,
  opts?: SelectRetrievalOptions,
): SelectRetrievalResult {
  const empty: SelectRetrievalResult = {
    keep: [],
    drop: [],
    rejected: { belowRelevanceFloor: 0, belowScoreFloor: 0, invalid: 0 },
  };
  try {
    if (!Array.isArray(candidates) || candidates.length === 0) return empty;
    const enforceFloors = opts?.enforceFloors !== false;
    const finalCountRaw = finiteNumber(opts?.finalCount, DEFAULT_FINAL_COUNT);
    const finalCount = clamp(Math.floor(finalCountRaw), 0, MAX_POLICY_CANDIDATES);
    const nowMs = opts?.nowMs;

    const limit = Math.min(candidates.length, MAX_POLICY_CANDIDATES);
    const scored: Array<{ s: RetrievalCandidateScore; idx: number }> = [];
    const rejected = { belowRelevanceFloor: 0, belowScoreFloor: 0, invalid: 0 };
    const seenIds = new Set<string>();

    for (let i = 0; i < limit; i += 1) {
      const s = scoreRetrievalCandidate(candidates[i], nowMs, { enforceFloors });
      if (!s.id || seenIds.has(s.id)) {
        if (!s.id) rejected.invalid += 1;
        continue;
      }
      seenIds.add(s.id);
      scored.push({ s, idx: i });
    }

    const admissible: Array<{ s: RetrievalCandidateScore; idx: number }> = [];
    const drop: RetrievalCandidateScore[] = [];
    for (const entry of scored) {
      if (entry.s.admissible) {
        admissible.push(entry);
        continue;
      }
      drop.push(entry.s);
      if (entry.s.rejectReason === 'below_relevance_floor') rejected.belowRelevanceFloor += 1;
      else if (entry.s.rejectReason === 'below_score_floor') rejected.belowScoreFloor += 1;
      else rejected.invalid += 1;
    }

    // Total order: score desc -> semantic before keyword -> relevance desc ->
    // input index. Source comes BEFORE relevance deliberately: raw relevance is
    // only comparable WITHIN a source (that is what the confidence discount
    // exists for), so a keyword row's 0.45 must not out-tiebreak a semantic
    // row's 0.27 after they already tied on the comparable number.
    admissible.sort((a, b) => {
      if (b.s.score !== a.s.score) return b.s.score - a.s.score;
      if (a.s.matchSource !== b.s.matchSource) return a.s.matchSource === 'semantic' ? -1 : 1;
      if (b.s.relevance !== a.s.relevance) return b.s.relevance - a.s.relevance;
      return a.idx - b.idx;
    });

    const keep = admissible.slice(0, finalCount).map((e) => e.s);
    for (const overflow of admissible.slice(finalCount)) drop.push(overflow.s);

    return { keep, drop, rejected };
  } catch {
    return empty;
  }
}

/**
 * Union the semantic and keyword branches, deduped by id, semantic winning any
 * collision (it carries the stronger evidence for the same row).
 *
 * THE BUG THIS FIXES: the ILIKE fallback was an `else` on
 * `semantic.length === 0`, and `match_memories` filters `embedding IS NOT NULL`.
 * So the moment ONE memory in a circle got embedded, every un-embedded row
 * became permanently unreachable — invisible forever, with no error anywhere.
 * The fallback has to CONTRIBUTE, not substitute.
 */
export function mergeRetrievalCandidates<T>(semantic: unknown, keyword: unknown): T[] {
  const out: T[] = [];
  try {
    const seen = new Set<string>();
    const push = (list: unknown): void => {
      if (!Array.isArray(list)) return;
      const limit = Math.min(list.length, MAX_POLICY_CANDIDATES);
      for (let i = 0; i < limit && out.length < MAX_POLICY_CANDIDATES; i += 1) {
        const item = list[i];
        const id = safeId(readField(item, 'id'));
        if (!id || seen.has(id)) continue;
        seen.add(id);
        out.push(item as T);
      }
    };
    push(semantic); // semantic first => it wins any id collision
    push(keyword);
  } catch {
    return out;
  }
  return out;
}

// ─── Bundle-section budget (bug 3: the tail slice) ──────────────────────────

/**
 * Sections guaranteed a slot before the density competition runs.
 *
 *   - `startup`      carries standing instructions/preferences. Dropping it
 *     outright changes agent BEHAVIOR, not just recall.
 *   - `relevant_turn` carries the memories retrieved BECAUSE they match this
 *     question. Dropping/truncating it first was the original defect.
 *
 * Their share caps sum to 0.85 <= 1, which is what makes both reservations
 * simultaneously satisfiable at any budget — the invariant that keeps this from
 * degrading into "whichever reserved section is listed first wins".
 */
export const MEMORY_BUNDLE_RESERVED_SECTIONS: readonly string[] = [
  MEMORY_BUNDLE_SECTIONS.startup,
  MEMORY_BUNDLE_SECTIONS.relevantTurn,
];

function sectionValue(id: string): number {
  const v = MEMORY_BUNDLE_SECTION_VALUE[id];
  return typeof v === 'number' && Number.isFinite(v) ? v : MEMORY_BUNDLE_DEFAULT_SECTION_VALUE;
}

function sectionShareCap(id: string): number {
  const v = MEMORY_BUNDLE_SECTION_SHARE_CAP[id];
  return typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.min(v, 1)
    : MEMORY_BUNDLE_DEFAULT_SHARE_CAP;
}

/**
 * Decide which memory-bundle sections render and at what length.
 *
 * REPLACES: `sections.join('\n\n').slice(0, 5000)`, which truncated in
 * presentation order and therefore cut the query-ranked section (4th of 5)
 * before the generic standing context ahead of it.
 *
 * Algorithm:
 *   0. Everything fits -> return it untouched. The common turn pays nothing.
 *   1. PER-SECTION CAP — clamp each section to its share of the budget so one
 *      bulky section cannot consume the budget before the others are weighed.
 *      (A cap TRUNCATES rather than drops: an item-atomic knapsack alone would
 *      throw away a whole section, which is worse than shortening it.)
 *   2. KNAPSACK — contextBudgetFitCore over the capped sizes, with per-section
 *      value and a reservation for MEMORY_BUNDLE_RESERVED_SECTIONS.
 *   3. GIVE BACK — hand any residual budget to kept-but-truncated sections in
 *      value order, so a small bundle is never clamped for no reason.
 *
 * GUARANTEE: sum(maxChars over kept) <= budgetChars. Deterministic. Never throws.
 */
export function planMemoryBundleSections(
  sections: unknown,
  budgetChars?: unknown,
): MemoryBundlePlan {
  const rawBudget = finiteNumber(budgetChars, NaN);
  const budget = Number.isFinite(rawBudget) && rawBudget >= 0
    ? Math.floor(Math.min(rawBudget, MAX_SECTION_CHARS))
    : MEMORY_BUNDLE_BUDGET_CHARS;

  const emptyPlan: MemoryBundlePlan = { sections: [], keptIds: [], usedChars: 0, budgetChars: budget };

  try {
    if (!Array.isArray(sections) || sections.length === 0) return emptyPlan;

    // Normalize: first id wins; zero/negative/absent chars are nothing to render.
    const seen = new Set<string>();
    const normalized: Array<{ id: string; chars: number }> = [];
    const limit = Math.min(sections.length, MAX_POLICY_CANDIDATES);
    for (let i = 0; i < limit; i += 1) {
      const entry = sections[i];
      const id = safeId(readField(entry, 'id'));
      if (!id || seen.has(id)) continue;
      const chars = Math.floor(clamp(finiteNumber(readField(entry, 'chars'), 0), 0, MAX_SECTION_CHARS));
      if (chars <= 0) continue;
      seen.add(id);
      normalized.push({ id, chars });
    }
    if (normalized.length === 0) return emptyPlan;
    if (budget <= 0) {
      return {
        sections: normalized.map((s) => ({ id: s.id, keep: false, maxChars: 0, truncated: true })),
        keptIds: [],
        usedChars: 0,
        budgetChars: budget,
      };
    }

    // Step 0 — it all fits. Do nothing at all.
    const totalChars = normalized.reduce((sum, s) => sum + s.chars, 0);
    if (totalChars <= budget) {
      return {
        sections: normalized.map((s) => ({ id: s.id, keep: true, maxChars: s.chars, truncated: false })),
        keptIds: normalized.map((s) => s.id),
        usedChars: totalChars,
        budgetChars: budget,
      };
    }

    // Step 1 — per-section share cap.
    const capped = normalized.map((s) => {
      const cap = Math.max(1, Math.floor(budget * sectionShareCap(s.id)));
      return { id: s.id, requested: s.chars, allowed: Math.min(s.chars, cap) };
    });

    // Step 2 — value-density knapsack with reservations for the two must-keeps.
    const sourceRules: Record<string, { minItems?: number }> = {};
    for (const s of capped) {
      if (MEMORY_BUNDLE_RESERVED_SECTIONS.indexOf(s.id) !== -1) sourceRules[s.id] = { minItems: 1 };
    }
    const fit = fitCandidatesToBudget(
      capped.map((s) => ({ id: s.id, source: s.id, tokens: s.allowed, value: sectionValue(s.id) })),
      budget,
      { sourceRules },
    );
    const keptIds = new Set(fit.keep.map((k) => String(k.id)));

    const plan = capped.map((s) => ({
      id: s.id,
      keep: keptIds.has(s.id),
      maxChars: keptIds.has(s.id) ? s.allowed : 0,
      truncated: keptIds.has(s.id) ? s.allowed < s.requested : true,
    }));

    // Step 3 — spend the residual. BREADTH BEFORE DEPTH: a dropped section that
    // can be revived at a usable length beats lengthening a section that is
    // already present, because a section missing entirely reads to the model as
    // "there is nothing here", which is a different (and wrong) claim.
    let used = plan.reduce((sum, s) => sum + s.maxChars, 0);
    let residual = Math.max(0, budget - used);
    const byValueThenOrder = (a: { idx: number }, b: { idx: number }): number => {
      const dv = sectionValue(plan[b.idx].id) - sectionValue(plan[a.idx].id);
      if (dv !== 0) return dv;
      return a.idx - b.idx;
    };
    const grantTo = (idx: number): void => {
      const slot = plan[idx];
      const requested = capped[idx]?.requested ?? slot.maxChars;
      const want = requested - slot.maxChars;
      if (want <= 0 || residual <= 0) return;
      const grant = Math.min(want, residual);
      slot.maxChars += grant;
      residual -= grant;
      slot.keep = slot.maxChars > 0;
      slot.truncated = slot.maxChars < requested;
    };

    if (residual >= MEMORY_BUNDLE_MIN_REVIVE_CHARS) {
      const revivable = plan
        .map((s, idx) => ({ s, idx }))
        .filter((e) => !e.s.keep)
        .sort(byValueThenOrder);
      for (const entry of revivable) {
        if (residual < MEMORY_BUNDLE_MIN_REVIVE_CHARS) break;
        grantTo(entry.idx);
      }
    }
    if (residual > 0) {
      const extendable = plan
        .map((s, idx) => ({ s, idx }))
        .filter((e) => e.s.keep && e.s.truncated)
        .sort(byValueThenOrder);
      for (const entry of extendable) {
        if (residual <= 0) break;
        grantTo(entry.idx);
      }
    }
    used = plan.reduce((sum, s) => sum + s.maxChars, 0);

    return {
      sections: plan,
      keptIds: plan.filter((s) => s.keep).map((s) => s.id),
      usedChars: used,
      budgetChars: budget,
    };
  } catch {
    return emptyPlan;
  }
}

/**
 * Clamp one section's rendered text to `maxChars`, cutting on a line (or word)
 * boundary and appending a visible truncation marker so the model is not misled
 * into treating a cut list as complete.
 *
 * GUARANTEE: the result is always <= maxChars characters, and is a prefix of the
 * input apart from the marker. Never throws.
 */
export function clampSectionText(text: unknown, maxChars: unknown): string {
  try {
    if (typeof text !== 'string' || text.length === 0) return '';
    const cap = Math.floor(finiteNumber(maxChars, 0));
    if (!Number.isFinite(cap) || cap <= 0) return '';
    if (text.length <= cap) return text;

    const markerLen = SECTION_TRUNCATION_MARKER.length;
    if (cap <= markerLen) return text.slice(0, cap);

    const room = cap - markerLen;
    let cut = text.slice(0, room);
    const boundaryFloor = Math.floor(room * 0.5);
    const nl = cut.lastIndexOf('\n');
    if (nl >= boundaryFloor) {
      cut = cut.slice(0, nl);
    } else {
      const sp = cut.lastIndexOf(' ');
      if (sp >= boundaryFloor) cut = cut.slice(0, sp);
    }
    return `${cut.replace(/\s+$/, '')}${SECTION_TRUNCATION_MARKER}`;
  } catch {
    return '';
  }
}
