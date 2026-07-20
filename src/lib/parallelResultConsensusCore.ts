/**
 * parallelResultConsensusCore — the PURE majority-vote / self-consistency brain
 * for reconciling N candidate answers to the SAME task (a best-of-N race, a
 * provider fan-out, or a subagent verifier panel) BEFORE any LLM judge is paid
 * for.
 *
 * THE GAP THIS FILLS (grounded in the race stack):
 * `bestOfNRace.runBestOfNRace` (src/lib/bestOfNRace.ts ~L307) ALWAYS makes an
 * extra LLM JUDGE model call whenever >=2 candidates succeed — even when the
 * models returned essentially the SAME answer, which is the common case for
 * well-specified / factual tasks and is exactly the situation self-consistency
 * sampling exploits. So the app pays for a judge round-trip to "pick" among
 * answers that already agree, gets a judge score-set but no agreement-based
 * CONFIDENCE, and has no explicit signal when the candidates genuinely DISAGREE
 * (the judge silently picks one of several conflicting answers instead of
 * flagging a conflict for escalation).
 *
 * This core makes ZERO model calls. It clusters the returned answers by
 * near-similarity (token-set Jaccard + short-text token-boundary containment +
 * exact-normalized equality), elects a representative per cluster by plurality
 * (max voting weight, medoid tie-break for the most central phrasing), and emits
 * an agreement ratio, a sample-size-aware confidence, a verdict, and a
 * recommended action (accept / judge / escalate). When the returned answers
 * already agree, the caller can SKIP the judge entirely (accept the medoid) and
 * only pay for the judge on genuine disagreement.
 *
 * WHY NOT the neighbours:
 *   - bestOfNRace.ts races/invokes models then an LLM JUDGE CALL picks a winner
 *     (always, for >=2 successes). No clustering, no ratio, no confidence, no
 *     skip-judge / conflict path. This core is the deterministic pass that runs
 *     BEFORE that judge.
 *   - toolResultDedupCore detects a BYTE-IDENTICAL repeat of the SAME (tool,args)
 *     across SEQUENTIAL rounds (exact FNV hash) to emit a back-reference; it votes
 *     on nothing. This clusters DIFFERENT candidates for the SAME task by NEAR
 *     similarity and ELECTS a winner with confidence — different identity, axis,
 *     and output.
 *   - memoryNoveltyFilterCore / chatRetrievalRankCore DROP redundant items to save
 *     context budget and KEEP a filtered list; they never elect ONE winner or
 *     compute agreement / accept-judge-escalate. This reuses their Jaccard/token
 *     TECHNIQUE, not their purpose (pure/disjoint, no import).
 *   - outcomeVerifier grades ONE produced outcome vs a contract (one candidate).
 *
 * PURITY / SAFETY CONTRACT:
 *   - ZERO runtime imports (type-only by construction) → loads under tsx/esbuild;
 *     no react-native / supabase / network.
 *   - DETERMINISTIC: no Date.now()/Math.random()/argless `new Date`. Clustering is
 *     input-order greedy single-pass; every tie has an explicit stable break;
 *     identical input → identical output, always.
 *   - TOTAL: every export handles null/undefined/wrong-type/NaN/Infinity/bigint/
 *     symbol/control-char/huge/cyclic/throwing-getter/Proxy input by returning a
 *     safe neutral value (a 'none' result or a skipped candidate) and NEVER throws.
 *   - BOUNDED: exported MAX_* caps — candidate count, tokens per unit, text scan
 *     length — plus internal id/reason caps clamp every scan.
 *   - SECRET-SAFE: no output field ever carries candidate/answer TEXT. The winner
 *     is an INDEX the caller maps back to its own array; the reason carries only
 *     counts + a cleaned, bounded winner id (control / line-sep / prompt-fence
 *     chars stripped, length-clamped — an opaque identifier, not content).
 *     agreementRatio and confidence are always finite in [0,1].
 */

// ─── Exported bounds / defaults (single source of truth) ─────────────────────

/** Hard cap on scanned candidates. Extra candidates are ignored. */
export const MAX_CONSENSUS_CANDIDATES = 64;
/** Cap on tokens kept per candidate/cluster for a Jaccard verdict. */
export const MAX_CONSENSUS_TOKENS = 80;
/** Cap on code points scanned when normalizing a single candidate's text. */
export const CONSENSUS_TEXT_SCAN_MAX = 8000;
/** Default token-set Jaccard cutoff for the near-similarity signal (strict). */
export const DEFAULT_CONSENSUS_SIMILARITY = 0.8;
/** Default majority fraction: a cluster must exceed this share of total weight to
 *  be a 'consensus' (else a mere 'plurality'). 0.5 → a real majority. Callers may
 *  only RAISE it, into (0.5, 1]. */
export const DEFAULT_MAJORITY_FRACTION = 0.5;
/** Upper clamp on a single candidate's voting weight. */
export const CONSENSUS_WEIGHT_CAP = 1e6;
/** Laplace-style smoothing in the confidence formula: confidence rises with BOTH
 *  agreement AND sample size, asymptotic to <1 (a lone candidate → 0.5). */
export const CONSENSUS_CONFIDENCE_SMOOTHING = 1;

// ─── Internal bounds (not part of the public cap surface) ────────────────────

/** Max chars of the reason string echoed into loop events / persisted rows. */
const CONSENSUS_REASON_MAX = 200;
/** Max chars of a cleaned winner id echoed into the reason. */
const CONSENSUS_REASON_ID_MAX = 60;
/** Bound the pre-clamp scan of a hostile mega-id before the strip loop. */
const CONSENSUS_ID_SCAN_MAX = 4096;
/** A "short" text (for the containment signal) has at most this many tokens. */
const CONSENSUS_CONTAINMENT_MAX_TOKENS = 6;
/** Min token length kept (1 → single-char answers like "7"/"x" still count). */
const MIN_TOKEN_LEN = 1;

// ─── Public types ────────────────────────────────────────────────────────────

/**
 * One candidate answer to the shared task. A bare string IS its text. In object
 * form: `ok` defaults true (only `ok === false` excludes the candidate); `weight`
 * defaults 1 (finite > 0 else 1, capped at CONSENSUS_WEIGHT_CAP) — lets a caller
 * fold in provider trust or a judge score, but the default is one-vote-each
 * majority. `id` is an opaque identifier surfaced (cleaned) in the reason.
 */
export type ConsensusCandidateInput =
  | string
  | { id?: unknown; text?: unknown; ok?: unknown; weight?: unknown };

/**
 *   - 'unanimous' — one cluster: every candidate agrees.
 *   - 'consensus' — the leading cluster exceeds the majority fraction of weight.
 *   - 'plurality' — a clear leader, but not a majority.
 *   - 'tie'       — the top two clusters carry equal weight.
 *   - 'split'     — every candidate is its own cluster (nobody agrees with anybody).
 *   - 'none'      — no valid candidates to reconcile.
 */
export type ConsensusVerdict =
  | 'unanimous'
  | 'consensus'
  | 'plurality'
  | 'tie'
  | 'split'
  | 'none';

/** What the caller should do next. Mirrors outcomeVerifier.resolveVerifierAction. */
export type ConsensusAction = 'accept' | 'judge' | 'escalate';

/** One cluster of agreeing candidates. `members` and `representativeIndex` are
 *  ORIGINAL indices into the caller's input array. */
export interface ConsensusCluster {
  members: number[];
  representativeIndex: number;
  size: number;
  weight: number;
}

export interface ConsensusResult {
  verdict: ConsensusVerdict;
  /** Original index of the winning cluster's representative, or null for 'none'. */
  winnerIndex: number | null;
  /** Clusters sorted by weight desc, then earliest-member index asc. */
  clusters: ConsensusCluster[];
  /** Number of VALID candidates that voted (ok, non-blank). */
  votedCount: number;
  /** round2(topWeight / totalWeight), finite in [0,1]. */
  agreementRatio: number;
  /** round2(agreementRatio * votedCount/(votedCount+smoothing)), finite in [0,1]. */
  confidence: number;
  recommendedAction: ConsensusAction;
  /** Bounded, secret-safe: counts + cleaned winner id, never candidate text. */
  reason: string;
}

export interface ConsensusOptions {
  /** Token-set Jaccard cutoff in (0,1]. Invalid → DEFAULT_CONSENSUS_SIMILARITY. */
  similarityThreshold?: number;
  /** Majority fraction in (0.5,1]. Invalid → DEFAULT_MAJORITY_FRACTION. */
  majorityFraction?: number;
}

// ─── Total coercion helpers ──────────────────────────────────────────────────

/** Guarded property read — a throwing getter / Proxy trap yields undefined. */
function readField(obj: Record<string, unknown>, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

/** A finite number, or undefined. Accepts number / bigint / numeric-string. */
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

function round2(n: number): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Strippable code point for user-influenced identifiers / the reason string: C0
 * controls (0x00-0x1f), DEL (0x7f), C1 controls (0x80-0x9f), line / paragraph
 * separators (0x2028 / 0x2029), and the prompt-fence chars backtick (0x60),
 * '<' (0x3c), '>' (0x3e). Coded by code point so no literal control char ever
 * appears in this source file.
 */
function isStrippableCode(code: number): boolean {
  if (code <= 0x1f) return true;
  if (code === 0x7f) return true;
  if (code >= 0x80 && code <= 0x9f) return true;
  if (code === 0x2028 || code === 0x2029) return true;
  if (code === 0x60 || code === 0x3c || code === 0x3e) return true;
  return false;
}

/** Strip control / C1 / line-sep / prompt-fence chars from an already-bounded
 *  string (charCode scan is safe here: strippable codes are all in the BMP and
 *  never the high/low half of an astral pair). */
function stripControlFence(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i += 1) {
    if (!isStrippableCode(s.charCodeAt(i))) out += s[i];
  }
  return out;
}

/**
 * Coerce an untrusted candidate id to a bounded, control/fence-stripped opaque
 * identifier. Non-primitive (object/symbol/function/nullish) → ''. Never throws.
 * The final CONSENSUS_REASON_ID_MAX clamp is far below CONSENSUS_ID_SCAN_MAX, so a
 * surrogate half left at the pre-clamp scan boundary is always dropped.
 */
function cleanId(v: unknown): string {
  try {
    let s: string;
    if (typeof v === 'string') s = v;
    else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
    else if (typeof v === 'bigint') s = v.toString();
    else if (typeof v === 'boolean') s = v ? 'true' : 'false';
    else return '';
    if (s === '') return '';
    if (s.length > CONSENSUS_ID_SCAN_MAX) s = s.slice(0, CONSENSUS_ID_SCAN_MAX);
    let out = stripControlFence(s).trim();
    if (out.length > CONSENSUS_REASON_ID_MAX) out = out.slice(0, CONSENSUS_REASON_ID_MAX).trim();
    return out;
  } catch {
    return '';
  }
}

/** Bounded, control-stripped reason string. */
function clampReason(s: string): string {
  const scan = s.length > CONSENSUS_REASON_MAX * 2 ? s.slice(0, CONSENSUS_REASON_MAX * 2) : s;
  const out = stripControlFence(scan).trim();
  return out.length > CONSENSUS_REASON_MAX ? out.slice(0, CONSENSUS_REASON_MAX).trim() : out;
}

// ─── Text normalization + similarity (internal dedup keys only) ──────────────

/**
 * Keep the first `maxCodePoints` CODE POINTS of `s` (never splitting a surrogate
 * pair). The UTF-16 scan is bounded first — each code point is at most 2 units, so
 * `2 * maxCodePoints` units always contains at least `maxCodePoints` code points,
 * and any surrogate half left by that unit-slice sits beyond the kept window.
 */
function sliceCodePoints(s: string, maxCodePoints: number): string {
  const unitCap = maxCodePoints * 2;
  const head = s.length > unitCap ? s.slice(0, unitCap) : s;
  let out = '';
  let count = 0;
  for (const ch of head) {
    if (count >= maxCodePoints) break;
    out += ch;
    count += 1;
  }
  return out;
}

/**
 * Lowercase, collapse every run of unicode non-alphanumerics to one space, trim;
 * scan-capped at CONSENSUS_TEXT_SCAN_MAX code points (surrogate-safe). Coerces
 * number / bigint / boolean to their text; any other non-string → ''. This is an
 * INTERNAL dedup key — never surfaced in any output field. Total; deterministic.
 */
export function normalizeConsensusText(v: unknown): string {
  try {
    let s: string;
    if (typeof v === 'string') s = v;
    else if (typeof v === 'number') s = Number.isFinite(v) ? String(v) : '';
    else if (typeof v === 'bigint') s = v.toString();
    else if (typeof v === 'boolean') s = v ? 'true' : 'false';
    else return '';
    if (s === '') return '';
    if (s.length > CONSENSUS_TEXT_SCAN_MAX) s = sliceCodePoints(s, CONSENSUS_TEXT_SCAN_MAX);
    return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  } catch {
    return '';
  }
}

/** Bounded token set of a normalized string (tokens ≥ MIN_TOKEN_LEN, ≤ MAX per unit). */
function consensusTokenSet(norm: string): Set<string> {
  const set = new Set<string>();
  if (norm === '') return set;
  const parts = norm.split(' ');
  for (let i = 0; i < parts.length && set.size < MAX_CONSENSUS_TOKENS; i += 1) {
    const p = parts[i];
    if (p.length >= MIN_TOKEN_LEN) set.add(p);
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const t of small) if (large.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Token-boundary containment for the SHORT-text case: when one side has few
 * tokens (≤ CONSENSUS_CONTAINMENT_MAX_TOKENS) and strictly fewer than the other,
 * and appears as a contiguous token-boundary substring of the longer normalized
 * text, treat them as agreeing (e.g. "42" ⊂ "the answer is 42"). Padding with
 * spaces enforces whole-token matching so "42" never matches inside "420".
 * Conservative: a short side that is not a contiguous run inside the long side
 * (Jaccard's job) does not match here.
 */
function shortContainment(
  aNorm: string,
  aTokens: Set<string>,
  bNorm: string,
  bTokens: Set<string>,
): boolean {
  const aN = aTokens.size;
  const bN = bTokens.size;
  let shortNorm: string;
  let shortN: number;
  let longNorm: string;
  let longN: number;
  if (aN <= bN) {
    shortNorm = aNorm; shortN = aN; longNorm = bNorm; longN = bN;
  } else {
    shortNorm = bNorm; shortN = bN; longNorm = aNorm; longN = aN;
  }
  if (shortN < 1 || shortN > CONSENSUS_CONTAINMENT_MAX_TOKENS) return false;
  if (shortN >= longN) return false;
  return (' ' + longNorm + ' ').indexOf(' ' + shortNorm + ' ') >= 0;
}

// ─── Candidate extraction ────────────────────────────────────────────────────

interface WorkingMember {
  origIndex: number;
  weight: number;
  id: string;
  norm: string;
  tokens: Set<string>;
}

interface WorkingCluster {
  members: WorkingMember[];
  seedNorm: string;
  seedTokens: Set<string>;
}

/** Resolve a candidate weight: finite > 0 (capped), else the default 1. */
function resolveWeight(v: unknown): number {
  const n = toFiniteNumber(v);
  if (n === undefined || n <= 0) return 1;
  return n > CONSENSUS_WEIGHT_CAP ? CONSENSUS_WEIGHT_CAP : n;
}

interface ExtractedCandidate {
  id: string;
  textRaw: unknown;
  ok: boolean;
  weight: number;
}

/** Coerce one raw candidate. A bare string is its text (ok true, weight 1). An
 *  object supplies id/text/ok/weight (guarded reads). Any other primitive → null
 *  (skipped — not a valid candidate). Never throws. */
function extractCandidate(raw: unknown): ExtractedCandidate | null {
  if (typeof raw === 'string') {
    return { id: '', textRaw: raw, ok: true, weight: 1 };
  }
  if (!raw || typeof raw !== 'object') return null;
  try {
    const obj = raw as Record<string, unknown>;
    const ok = readField(obj, 'ok') === false ? false : true;
    const textRaw = readField(obj, 'text');
    const id = cleanId(readField(obj, 'id'));
    const weight = resolveWeight(readField(obj, 'weight'));
    return { id, textRaw, ok, weight };
  } catch {
    return null;
  }
}

// ─── Representative election ─────────────────────────────────────────────────

/**
 * Per-cluster representative: the member with max voting weight; on a weight tie
 * the MEDOID (the member with the greatest summed intra-cluster Jaccard — the most
 * central phrasing, O(m^2) with m bounded); on a medoid tie the earliest ORIGINAL
 * index (members are in ascending origIndex order, so the first max wins).
 */
function pickRepresentative(members: WorkingMember[]): WorkingMember {
  if (members.length === 1) return members[0];
  let maxW = -Infinity;
  for (const m of members) if (m.weight > maxW) maxW = m.weight;
  const tied: WorkingMember[] = [];
  for (const m of members) if (m.weight === maxW) tied.push(m);
  if (tied.length === 1) return tied[0];

  let best = tied[0];
  let bestSum = -1;
  for (const cand of tied) {
    let sum = 0;
    for (const other of members) {
      if (other === cand) continue;
      sum += jaccard(cand.tokens, other.tokens);
    }
    if (sum > bestSum) {
      bestSum = sum;
      best = cand;
    }
  }
  return best;
}

// ─── Result assembly ─────────────────────────────────────────────────────────

interface FinalCluster {
  members: number[];
  representativeIndex: number;
  representativeId: string;
  size: number;
  weightRaw: number;
  earliestIndex: number;
}

function noneResult(reason: string): ConsensusResult {
  return {
    verdict: 'none',
    winnerIndex: null,
    clusters: [],
    votedCount: 0,
    agreementRatio: 0,
    confidence: 0,
    recommendedAction: 'escalate',
    reason: clampReason(reason),
  };
}

function resolveConsensusOptions(opts: unknown): { threshold: number; majority: number } {
  let threshold = DEFAULT_CONSENSUS_SIMILARITY;
  let majority = DEFAULT_MAJORITY_FRACTION;
  if (opts && typeof opts === 'object') {
    try {
      const o = opts as Record<string, unknown>;
      const t = toFiniteNumber(readField(o, 'similarityThreshold'));
      if (t !== undefined && t > 0 && t <= 1) threshold = t;
      const m = toFiniteNumber(readField(o, 'majorityFraction'));
      if (m !== undefined && m > 0.5 && m <= 1) majority = m;
    } catch {
      /* defaults */
    }
  }
  return { threshold, majority };
}

function buildConsensusReason(
  verdict: ConsensusVerdict,
  topSize: number,
  votedCount: number,
  confidence: number,
  winnerId: string,
  winnerIndex: number,
): string {
  let core: string;
  if (verdict === 'split') {
    core = `${votedCount} candidates all diverged (split, conf ${confidence})`;
  } else {
    core = `${topSize}/${votedCount} candidates agreed (${verdict}, conf ${confidence})`;
  }
  const suffix = winnerId ? ` — ${winnerId}` : ` — winner #${winnerIndex}`;
  return clampReason(core + suffix);
}

/**
 * Reconcile N candidate answers to ONE task into a consensus verdict + winner +
 * confidence, making zero model calls. See the file header for the full contract.
 * Total: any malformed input yields a 'none' result and never throws.
 */
export function reconcileParallelResults(
  candidates: unknown,
  opts?: ConsensusOptions,
): ConsensusResult {
  try {
    if (!Array.isArray(candidates)) {
      return noneResult('input is not an array of candidates (none)');
    }
    const { threshold, majority } = resolveConsensusOptions(opts);

    const clusters: WorkingCluster[] = [];
    // Exact-normalized bucketing via a Map (NOT a plain object) so a candidate
    // whose normalized text is "constructor" / "__proto__" / "hasOwnProperty"
    // cannot poison the lookup or forge a false match.
    const exactByNorm = new Map<string, number>();

    const limit = candidates.length > MAX_CONSENSUS_CANDIDATES
      ? MAX_CONSENSUS_CANDIDATES
      : candidates.length;

    for (let i = 0; i < limit; i += 1) {
      let raw: unknown;
      try {
        raw = candidates[i];
      } catch {
        continue; // hostile index getter
      }
      const parsed = extractCandidate(raw);
      if (!parsed || parsed.ok === false) continue;
      const norm = normalizeConsensusText(parsed.textRaw);
      if (norm === '') continue; // blank / non-text payload → not a valid vote
      const tokens = consensusTokenSet(norm);
      const member: WorkingMember = {
        origIndex: i,
        weight: parsed.weight,
        id: parsed.id,
        norm,
        tokens,
      };

      // Greedy input-order clustering: exact twins collapse immediately (the
      // dominant self-consistency case, prototype-safe via Map); otherwise the
      // FIRST existing cluster whose seed matches by Jaccard OR short-text
      // containment wins; else a new cluster.
      let joined = -1;
      const exactHit = exactByNorm.get(norm);
      if (exactHit !== undefined) {
        joined = exactHit;
      } else {
        for (let c = 0; c < clusters.length; c += 1) {
          const cl = clusters[c];
          if (
            jaccard(tokens, cl.seedTokens) >= threshold ||
            shortContainment(norm, tokens, cl.seedNorm, cl.seedTokens)
          ) {
            joined = c;
            break;
          }
        }
      }

      if (joined >= 0) {
        clusters[joined].members.push(member);
      } else {
        const idx = clusters.length;
        clusters.push({ members: [member], seedNorm: norm, seedTokens: tokens });
        if (!exactByNorm.has(norm)) exactByNorm.set(norm, idx);
      }
    }

    let votedCount = 0;
    for (const cl of clusters) votedCount += cl.members.length;
    if (votedCount === 0) {
      return noneResult('no valid candidates to reconcile (none)');
    }

    // Finalize: representative + weight + earliest index per cluster.
    const finalized: FinalCluster[] = clusters.map((cl) => {
      let weightRaw = 0;
      for (const m of cl.members) weightRaw += m.weight;
      const rep = pickRepresentative(cl.members);
      return {
        members: cl.members.map((m) => m.origIndex),
        representativeIndex: rep.origIndex,
        representativeId: rep.id,
        size: cl.members.length,
        weightRaw,
        earliestIndex: cl.members[0].origIndex,
      };
    });

    // Sort by weight desc, then earliest-member index asc. earliestIndex is unique
    // per cluster, so this is a total order → fully deterministic.
    finalized.sort((a, b) => (b.weightRaw - a.weightRaw) || (a.earliestIndex - b.earliestIndex));

    let total = 0;
    for (const f of finalized) total += f.weightRaw;

    const n = finalized.length;
    const w1 = finalized[0].weightRaw;

    let verdict: ConsensusVerdict;
    if (n === 1) {
      verdict = 'unanimous';
    } else if (n === votedCount) {
      // Every cluster is a singleton — nobody agrees with anybody.
      verdict = 'split';
    } else {
      const w2 = finalized[1].weightRaw;
      if (w1 === w2) verdict = 'tie';
      else if (total > 0 && w1 / total > majority) verdict = 'consensus';
      else verdict = 'plurality';
    }

    const agreementRatio = total > 0 ? clamp01(round2(w1 / total)) : 0;
    const confidence = clamp01(
      round2(agreementRatio * (votedCount / (votedCount + CONSENSUS_CONFIDENCE_SMOOTHING))),
    );
    const winnerIndex = finalized[0].representativeIndex;
    const recommendedAction = resolveConsensusAction(verdict);
    const reason = buildConsensusReason(
      verdict,
      finalized[0].size,
      votedCount,
      confidence,
      finalized[0].representativeId,
      winnerIndex,
    );

    const outClusters: ConsensusCluster[] = finalized.map((f) => ({
      members: f.members,
      representativeIndex: f.representativeIndex,
      size: f.size,
      weight: round2(f.weightRaw),
    }));

    return {
      verdict,
      winnerIndex,
      clusters: outClusters,
      votedCount,
      agreementRatio,
      confidence,
      recommendedAction,
      reason,
    };
  } catch {
    return noneResult('reconciliation failed on malformed input (none)');
  }
}

/**
 * Map a verdict to the next action: an agreeing panel is accepted, a contested one
 * goes to the judge, a fractured / empty one escalates. Mirrors the shape of
 * outcomeVerifier.resolveVerifierAction. Total (unexpected verdict → 'escalate').
 */
export function resolveConsensusAction(verdict: ConsensusVerdict): ConsensusAction {
  if (verdict === 'unanimous' || verdict === 'consensus') return 'accept';
  if (verdict === 'plurality' || verdict === 'tie') return 'judge';
  return 'escalate'; // 'split' | 'none' | anything unexpected
}
