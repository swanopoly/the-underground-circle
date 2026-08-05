// capabilityMatchGateCore — the PURE "is the matched capability the RIGHT,
// dominant one?" decision layer that sits ABOVE the app's several request→X
// matchers (skillRelevanceCore lexical skill scores, specialistSelectionCore
// role match-counts, suggestCapabilitiesForMessage family hits,
// openswanSkillResolution hint scores).
//
// WHY: every one of those matchers RANKS or MATCHES, but NONE decides whether
// the top match is clearly dominant (surface/apply the ONE), an ambiguous
// near-tie (present a small choice), or below the bar (stay quiet).
// skillRelevanceCore has NO eligibility floor and breaks final ties by ARRAY
// ORDER (wrong-one-silently-wins when two skills tie); specialistSelectionCore
// returns EVERY "high" role with no cross-candidate dominance;
// suggestCapabilitiesForMessage returns EVERY matched family unscored. This
// core consumes any of those already-scored candidate lists and emits ONE
// deterministic 4-way decision — apply | suggest | disambiguate | none — with
// the eligibility floor + inter-candidate dominance + near-tie disambiguation
// that none of them has. It RE-IMPLEMENTS no matching: it is composition over
// scores, not a re-ranker.
//
// Distinct from proactiveSurfacingCore (its round-2 sibling): that core gates a
// HETEROGENEOUS trouble stream on urgency×time-pressure with anti-nag MEMORY;
// this one arbitrates a HOMOGENEOUS scored candidate set for ONE request on
// pure inter-candidate DOMINANCE — no memory, no clock, no urgency, no
// time. Output is a single decision, not a surfaced/suppressed stream.
//
// PURITY: zero imports (loads under tsx/esbuild — no react-native / supabase /
// network). DETERMINISTIC: no Date.now / Math.random / argless new Date; a
// stable sort with a byte-wise id tiebreak; frozen const defaults; inputs that
// differ only in element order (up to score) → identical output. TOTAL:
// null / undefined / number / string / array-of-junk / cyclic / throwing-getter
// / huge / __proto__-id input yields a valid 'none'-or-safe decision, never
// throws (outer try/catch + per-candidate guards + safe primitives). BOUNDED:
// exported MAX_* caps, every string clamped, every array capped. SECRET-SAFE:
// ids/labels are skill names / family tokens / roles (not secrets) rendered as
// control- / line-sep- / prompt-fence-stripped, length-clamped display strings;
// reasons are a fixed frozen enum; scores are plain finite numbers only.
// Smoke: scripts/capability-match-gate-core-smoketest.ts

// ─── Public model ─────────────────────────────────────────────────────────────

/** One already-scored candidate from any matcher (skill / family / role). */
export interface ScoredCandidate {
  /** Stable id — a skill name, family token, or specialist role. */
  id: string;
  /** The matcher's score on its OWN scale (lexical 0-10, match-count, …). */
  score: number;
  /** Optional display label; defaults to the id. */
  label?: string;
}

/** The four possible outcomes of the gate. */
export type MatchGateAction = 'apply' | 'suggest' | 'disambiguate' | 'none';

/** A single surfaced choice with its relative share of the leader's score. */
export interface MatchGateChoice {
  id: string;
  label: string;
  score: number;
  /** score / topScore, rounded; the leader is always 1, in [0,1]. */
  share: number;
}

export interface MatchGateDecision {
  action: MatchGateAction;
  /** The dominant pick on apply/suggest; null on disambiguate/none. */
  primary: MatchGateChoice | null;
  /** Runner-ups (apply/suggest) or the near-tie cluster (disambiguate). */
  alternatives: MatchGateChoice[];
  /** clamp01(topScore / strongScore), rounded, in [0,1]. */
  confidence: number;
  /** 1 - score2/score1, in [0,1]; 1 when there is a single candidate. */
  margin: number;
  /** Fixed-enum reason string (see MATCH_GATE_REASONS). */
  reason: string;
}

export interface MatchGateOptions {
  /** Eligibility floor: candidates scoring below this are dropped. */
  minScore?: number;
  /** Apply threshold on the matcher's scale — a strong lone leader applies. */
  strongScore?: number;
  /** #1 must beat #2 by at least this fraction to be dominant, in [0,1). */
  dominanceMargin?: number;
  /** Output cap on surfaced alternatives. */
  maxAlternatives?: number;
}

// ─── Bounds / tunables (all exported so callers + smokes share the exact caps) ──

/** Default eligibility floor — "at least one unit of signal". Callers on a
 *  normalized 0-1 scale should pass their own `minScore`. */
export const MATCH_GATE_MIN_SCORE = 1;
/** Default apply threshold. Callers pass a value on their matcher's scale. */
export const MATCH_GATE_STRONG_SCORE = 6;
/** Default dominance band: #1 must beat #2 by >= 25% to be the lone leader. */
export const MATCH_GATE_DOMINANCE_MARGIN = 0.25;
/** Scan cap — at most this many raw candidates are inspected (hostile bound). */
export const MATCH_GATE_MAX_CANDIDATES = 200;
/** Output cap on `alternatives` (the default when the option is absent). On
 *  disambiguate the cluster may hold one more (leader + this many) since there
 *  is no separate `primary` consuming a slot. */
export const MATCH_GATE_MAX_ALTERNATIVES = 4;
/** Hard clamp on a rendered id length. */
export const MATCH_GATE_MAX_ID_LEN = 128;
/** Hard clamp on a rendered label length. */
export const MATCH_GATE_MAX_LABEL_LEN = 100;

/** Frozen list of every action (for validation / iteration). */
export const MATCH_GATE_ACTIONS: readonly MatchGateAction[] = Object.freeze([
  'apply',
  'suggest',
  'disambiguate',
  'none',
]);

/** Frozen list of every reason string (a fixed enum — never user text). */
export const MATCH_GATE_REASONS: readonly string[] = Object.freeze([
  'dominant-strong',
  'dominant-weak',
  'near-tie',
  'no-eligible-candidates',
]);

// ─── Numeric guards ────────────────────────────────────────────────────────────

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function round4(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

// ─── Option normalization (each independently total against a hostile proxy) ────

/** Read one option field; a throwing getter / non-object opts → undefined. */
function readOpt(opts: unknown, field: keyof MatchGateOptions): unknown {
  if (!opts || typeof opts !== 'object') return undefined;
  try {
    return (opts as Record<string, unknown>)[field as string];
  } catch {
    return undefined;
  }
}

function normalizeMinScore(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : MATCH_GATE_MIN_SCORE;
}

function normalizeStrongScore(raw: unknown): number {
  // Must be strictly positive — it is a divisor for `confidence`.
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : MATCH_GATE_STRONG_SCORE;
}

function normalizeDominanceMargin(raw: unknown): number {
  // [0,1): a margin >= 1 would put every candidate in-band (always ambiguous),
  // so anything out of range falls back to the safe default.
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw < 1
    ? raw
    : MATCH_GATE_DOMINANCE_MARGIN;
}

function normalizeMaxAlternatives(raw: unknown): number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const n = Math.floor(raw);
    // Floor at 1 so a genuine near-tie can always surface >= 2 options
    // (leader + 1); hard-cap at MATCH_GATE_MAX_ALTERNATIVES.
    if (n < 1) return 1;
    return n > MATCH_GATE_MAX_ALTERNATIVES ? MATCH_GATE_MAX_ALTERNATIVES : n;
  }
  return MATCH_GATE_MAX_ALTERNATIVES;
}

// ─── Secret-safe text handling ──────────────────────────────────────────────────
// ids/labels are skill names / family tokens / roles — a developer-controlled
// vocabulary, NOT user secrets — so they are cleaned + clamped rather than
// secret-masked (masking the id would corrupt the dedup join key). We still
// strip control / line-separator / prompt-fence chars so nothing structural can
// be smuggled into a chip or a prompt.

const CONTROL_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;
const FENCE_RE = /[<>`]/g;

/** A safe id: control/line-sep/fence-stripped, whitespace-collapsed, clamped.
 *  Non-strings and wholly-empty results become '' (⇒ the candidate is dropped). */
function sanitizeId(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(CONTROL_RE, '').replace(FENCE_RE, '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  return cleaned.length > MATCH_GATE_MAX_ID_LEN ? cleaned.slice(0, MATCH_GATE_MAX_ID_LEN) : cleaned;
}

/** A safe label: same stripping, clamped to the label length with an ellipsis.
 *  Non-strings / empties become '' (⇒ the caller falls back to the id). */
function sanitizeLabel(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(CONTROL_RE, ' ').replace(FENCE_RE, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  if (cleaned.length <= MATCH_GATE_MAX_LABEL_LEN) return cleaned;
  if (MATCH_GATE_MAX_LABEL_LEN <= 1) return cleaned.slice(0, MATCH_GATE_MAX_LABEL_LEN);
  return `${cleaned.slice(0, MATCH_GATE_MAX_LABEL_LEN - 1).trimEnd()}…`;
}

// ─── Candidate normalization ────────────────────────────────────────────────────

interface CleanCandidate {
  id: string;
  score: number;
  label: string;
}

/** Read a field off an untrusted candidate; a throwing getter → undefined. */
function readField(obj: Record<string, unknown>, field: string): unknown {
  try {
    return obj[field];
  } catch {
    return undefined;
  }
}

/**
 * Normalize an unknown input into a bounded, de-duped (by id, keeping MAX
 * score), score-desc/id-asc-sorted list of clean candidates. Non-array input,
 * non-object elements, empty ids, non-finite/negative scores, and scores below
 * `minScore` are all dropped. Deterministic and total — never throws, and one
 * hostile element (throwing getter, cyclic object, __proto__ id) never sinks
 * the batch (a Map keys the dedup so a '__proto__' id cannot walk a prototype).
 */
function normalizeCandidates(input: unknown, minScore: number): CleanCandidate[] {
  if (!Array.isArray(input)) return [];
  const limit =
    input.length < MATCH_GATE_MAX_CANDIDATES ? input.length : MATCH_GATE_MAX_CANDIDATES;
  const byId = new Map<string, CleanCandidate>();
  for (let i = 0; i < limit; i++) {
    try {
      const raw = input[i];
      if (!raw || typeof raw !== 'object') continue;
      const obj = raw as Record<string, unknown>;
      const id = sanitizeId(readField(obj, 'id'));
      if (!id) continue;
      const score = readField(obj, 'score');
      if (typeof score !== 'number' || !Number.isFinite(score) || score < 0) continue;
      if (score < minScore) continue;
      // Default the label to a clamped view of the id (never longer than the
      // label cap, so a long id can never overflow the label field).
      const label = sanitizeLabel(readField(obj, 'label')) || sanitizeLabel(id);
      const existing = byId.get(id);
      if (!existing) byId.set(id, { id, score, label });
      else if (score > existing.score) byId.set(id, { id, score, label });
    } catch {
      /* one hostile element must never discard the whole batch */
    }
  }
  const list = Array.from(byId.values());
  // Deterministic order: score desc, then id asc (byte-wise). ids are unique
  // (Map keys), so the tiebreak is always decisive — output is fully
  // independent of the caller's element ordering.
  list.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return list;
}

// ─── The decision ────────────────────────────────────────────────────────────────

function noneDecision(): MatchGateDecision {
  return {
    action: 'none',
    primary: null,
    alternatives: [],
    confidence: 0,
    margin: 0,
    reason: 'no-eligible-candidates',
  };
}

/**
 * Decide, deterministically, whether the top-scored capability candidate is the
 * dominant one to APPLY, a lone-but-weak leader to SUGGEST, an ambiguous
 * near-tie to DISAMBIGUATE, or whether NOTHING clears the eligibility floor.
 *
 * Steps: normalize+dedupe+floor+sort → empty ⇒ `none` → compute margin (1 -
 * score2/score1) and confidence (top/strongScore) → if #2 lands inside the
 * dominance band [topScore·(1-margin), topScore] it's a near-tie ⇒
 * `disambiguate` (primary null, alternatives = the in-band cluster, leader
 * first) → else a lone leader ⇒ `apply` when topScore >= strongScore, otherwise
 * `suggest`, with the below-band runner-ups as bounded alternatives.
 *
 * TOTAL: any hostile / degenerate input yields a valid `none`-or-safe decision,
 * never a throw, never a leaked secret.
 */
export function decideCapabilityMatch(
  candidates: unknown,
  opts?: MatchGateOptions,
): MatchGateDecision {
  try {
    const minScore = normalizeMinScore(readOpt(opts, 'minScore'));
    const strongScore = normalizeStrongScore(readOpt(opts, 'strongScore'));
    const dominanceMargin = normalizeDominanceMargin(readOpt(opts, 'dominanceMargin'));
    const maxAlternatives = normalizeMaxAlternatives(readOpt(opts, 'maxAlternatives'));

    const list = normalizeCandidates(candidates, minScore);
    if (list.length === 0) return noneDecision();

    const topScore = list[0].score;
    const secondScore = list.length > 1 ? list[1].score : 0;
    const margin = topScore > 0 ? clamp01(round4(1 - secondScore / topScore)) : 0;
    const confidence = round4(clamp01(topScore / strongScore));

    const toChoice = (c: CleanCandidate): MatchGateChoice => ({
      id: c.id,
      label: c.label,
      score: c.score,
      share: topScore > 0 ? clamp01(round4(c.score / topScore)) : c.score === topScore ? 1 : 0,
    });

    // Dominance band: candidates at or above this are "near the leader".
    const threshold = topScore * (1 - dominanceMargin);
    const nearTie = list.length > 1 && list[1].score >= threshold;

    if (nearTie) {
      // The in-band cluster (leader + near-tied), capped to maxAlternatives + 1
      // — the leader occupies an alternative slot since there is no primary.
      const clusterCap = maxAlternatives + 1;
      const cluster: MatchGateChoice[] = [];
      for (let i = 0; i < list.length && cluster.length < clusterCap; i++) {
        if (list[i].score < threshold) break; // sorted desc ⇒ rest are below-band
        cluster.push(toChoice(list[i]));
      }
      return {
        action: 'disambiguate',
        primary: null,
        alternatives: cluster,
        confidence,
        margin,
        reason: 'near-tie',
      };
    }

    // A single dominant leader — everything after it is below the band.
    const primary = toChoice(list[0]);
    const alternatives: MatchGateChoice[] = [];
    for (let i = 1; i < list.length && alternatives.length < maxAlternatives; i++) {
      alternatives.push(toChoice(list[i]));
    }
    const strong = topScore >= strongScore;
    return {
      action: strong ? 'apply' : 'suggest',
      primary,
      alternatives,
      confidence,
      margin,
      reason: strong ? 'dominant-strong' : 'dominant-weak',
    };
  } catch {
    // Ultimate safety net — any exotic hostile input degrades to a clean
    // 'none', which is always the safe, correct fallback (surface nothing).
    return noneDecision();
  }
}
