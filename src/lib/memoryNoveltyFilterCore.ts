/**
 * memoryNoveltyFilterCore — anchor-relative NOVELTY / anti-redundancy for the
 * cross-source memory-assembly step. It drops a discrete candidate memory/skill
 * item whose fact is ALREADY stated in an always-present free-text ANCHOR block
 * (user notes, the `## Circle Operating Memory` doc, startup memory), so scarce
 * retrieval budget is spent on NEW information instead of restating a line the
 * model already sees verbatim.
 *
 * THE GAP THIS FILLS (grounded in the memory stack):
 * `openswanMemoryStores.buildOpenSwanMemoryStores` formats memory from TWO
 * different SHAPES and concatenates them:
 *   (a) always-present free-text DOC blocks — `userNotes` (user_memory doc), the
 *       `## Circle Operating Memory` doc, `startup`; and
 *   (b) discrete scored ITEMS — `workingMemory` / turn retrieval hits, inferred
 *       `userProfile` rows, skills.
 * Nothing removes a discrete item whose fact is already covered by a doc block.
 * The codebase already knows this hurts: `formatUserProfile` hand-rolls a brittle
 * 40-char-verbatim-prefix dedup of profile rows against the notes blob ("Two
 * sources writing the same fact ... burns tokens and risks the model treating
 * near-duplicates as separate signals"), but that covers ONE of ~5 cross-source
 * pairs and escapes on any paraphrase/reorder past char 40.
 *
 * WHY chatRetrievalRankCore CANNOT DO THIS: it dedups items AGAINST EACH OTHER
 * within one bag via whole-text Jaccard/SIG/exact. A fact living as ONE line
 * inside a 40-line doc blob has ~0 whole-blob Jaccard vs a one-line item, so
 * blob-vs-item duplicates are structurally invisible to it. This core EXPLODES an
 * anchor blob into LINES and tests each candidate against the anchor-line exact
 * keys + a token-boundary containment scan of the joined blob + per-line Jaccard.
 * COMPLEMENTARY: rank + item-vs-item dedup first, then novelty-filter the
 * survivors against the doc anchors.
 *
 * PURITY / SAFETY CONTRACT:
 *   - ZERO runtime imports (type-only by construction) → loads under tsx/esbuild;
 *     no react-native / supabase / network.
 *   - DETERMINISTIC: no Date.now()/Math.random()/argless `new Date`; output order
 *     is input order; identical input → identical output, always.
 *   - TOTAL: every export handles null/undefined/wrong-type/NaN/cyclic/throwing-
 *     getter/proxy/huge input by returning a safe bounded value, never throws.
 *   - BOUNDED: exported MAX_* caps — candidate count, anchor chars/lines, tokens
 *     per unit, text scan length, id/source length, compare window — all clamped.
 *   - SECRET-SAFE: no output field ever carries candidate OR anchor TEXT. A drop
 *     carries only a bounded id + source (control/line-sep/prompt-fence chars
 *     stripped, length-clamped — they are opaque identifiers, not content) + a
 *     reason enum + the matched side. Kept items carry the caller's OWN text (the
 *     value they were already going to bind into the prompt), length-capped only.
 *
 * FAIL-OPEN BIAS: every redundancy drop is information-preserving — its fact
 * remains present via the matching anchor line or the kept candidate it duplicates
 * — so a false positive only avoids a duplicate, it never removes a fact from the
 * prompt. On any ambiguity the core KEEPS (higher default threshold, both-sides
 * token floors, short-candidate exact/containment-only), never over-drops.
 */

// ─── Exported bounds (single source of truth) ────────────────────────────────

/** Hard cap on scanned candidates. Extra candidates are ignored. */
export const MAX_CANDIDATES = 2000;
/** Cap on chars scanned per anchor blob AND on the joined-blob length. */
export const MAX_ANCHOR_CHARS = 20000;
/** Cap on total anchor lines exploded across all blobs. */
export const MAX_ANCHOR_LINES = 512;
/** Cap on tokens kept per line/candidate for a Jaccard verdict. */
export const MAX_TOKENS_PER_UNIT = 60;
/** Cap on chars scanned when normalizing a single text unit. */
export const MAX_TEXT_SCAN = 4000;
/** Shared-prefix signature window for long lines (generalizes the 40-char hack). */
export const SIG_CHARS = 140;
/** A candidate shorter than this (normalized) never uses the containment signal. */
export const MIN_CONTAINMENT_CHARS = 16;
/** Hard cap on kept items and default `maxKeep`. */
export const MAX_KEEP = 2000;
/** Max chars kept from a candidate id. */
export const MAX_ID_LEN = 200;
/** Max chars kept from a candidate source tag. */
export const MAX_SOURCE_LEN = 64;
/** Cap on anchor/accepted line Jaccard comparisons per candidate (bounds work). */
export const COMPARE_WINDOW = 256;
/** Default token-set Jaccard cutoff for the redundancy signal (strict → few false drops). */
export const DEFAULT_REDUNDANCY_THRESHOLD = 0.82;
/** Default min meaningful tokens on BOTH sides before a Jaccard verdict is allowed. */
export const DEFAULT_MIN_TOKENS = 5;

// ─── Internal bounds (not part of the public cap surface) ────────────────────

/** Both a token and its matched string must clear this length (drops "a"/"of"). */
const MIN_TOKEN_LEN = 2;
/** Defensive cap on a returned kept item's text (real memory items are far under). */
const MAX_TEXT_OUT = 100000;
/** Bound the pre-clamp scan of a hostile mega-string in cleanLabel. */
const MAX_LABEL_SCAN = 4096;

// ─── Public types ────────────────────────────────────────────────────────────

export interface NoveltyCandidate {
  /** Stable identity used to map a drop/keep back to the source row. */
  id: string;
  /** The item payload (the fact). Only ever normalized internally for a dedup key. */
  text: string;
  /** Optional source tag (memory family / store label). */
  source?: string;
}

/** A doc blob, several blobs, or a few item-like rows carrying `text`. */
export type AnchorInput = string | ReadonlyArray<string | { text?: unknown }>;

export interface NoveltyFilterOptions {
  /** Token-set Jaccard cutoff (0,1]. Invalid → DEFAULT_REDUNDANCY_THRESHOLD. */
  redundancyThreshold?: number;
  /** Enable the token-boundary containment signal. Default true. */
  containment?: boolean;
  /** Min meaningful tokens on both sides before a Jaccard verdict. Default 5. */
  minTokens?: number;
  /** Fold each accepted candidate into the working index so later candidates
   *  dedup against earlier-accepted ones too. Default true. */
  chainAcceptedCandidates?: boolean;
  /** Hard cap on kept items (novel overflow → 'capacity' drops). Default MAX_KEEP. */
  maxKeep?: number;
}

/** Why a candidate was found already-covered. `capacity` is a maxKeep overflow
 *  (budget-driven, not a redundancy verdict) and is only ever produced by
 *  filterNovelAgainstAnchors — isCoveredByAnchors returns only the three
 *  redundancy reasons. */
export type NoveltyCoverageReason = 'exact' | 'containment' | 'jaccard';
export type NoveltyReason = NoveltyCoverageReason | 'capacity';
/** Which side the fact was already present on: an original anchor, or an
 *  earlier-kept candidate (chaining). A capacity overflow reports 'candidate'
 *  (the slots were filled by kept candidates). */
export type NoveltyMatched = 'anchor' | 'candidate';

export interface NoveltyDrop {
  id: string;
  source: string;
  reason: NoveltyReason;
  matched: NoveltyMatched;
}

export interface NoveltyVerdict {
  /** Novel survivors, in input order (prompt-ready). Carry the caller's own text. */
  keep: NoveltyCandidate[];
  /** Redundant / overflow candidates, in input order. Carry NO text. */
  drop: NoveltyDrop[];
  keptCount: number;
  droppedCount: number;
}

/** Opaque, bounded prebuilt anchor index (see buildAnchorIndex). Callers hold it
 *  and pass it back to filterNovelAgainstAnchors / isCoveredByAnchors so the blob
 *  is exploded ONCE per turn. `joined` is internally space-padded for
 *  token-boundary containment matching. */
export interface AnchorIndex {
  readonly exact: ReadonlySet<string>;
  readonly sig: ReadonlySet<string>;
  readonly lineTokens: ReadonlyArray<ReadonlySet<string>>;
  readonly joined: string;
}

// ─── Internal shapes ─────────────────────────────────────────────────────────

interface MutableIndex {
  exact: Set<string>;
  sig: Set<string>;
  lineTokens: Array<Set<string>>;
  /** Always begins and ends with a single space so `.includes(' ' + norm + ' ')`
   *  matches only on token boundaries. */
  joined: string;
}

interface ResolvedOptions {
  threshold: number;
  containmentOn: boolean;
  minTokens: number;
  chain: boolean;
  maxKeep: number;
}

// ─── Total coercion helpers ──────────────────────────────────────────────────

/**
 * Strippable code point for user-influenced identifiers: C0 controls (0x00-0x1f),
 * DEL (0x7f), line/paragraph separators (0x2028/0x2029), and the prompt-fence
 * chars backtick (0x60), '<' (0x3c), '>' (0x3e). Coded by code point so no literal
 * control char ever appears in this source file.
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

/** Coerce an untrusted value to a bounded, control/fence-stripped identifier.
 *  Non-primitive (object/symbol/function/nullish) → ''. Never throws. */
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

/** Guarded property read — a throwing getter yields undefined, not a throw. */
function readField(obj: Record<string, unknown>, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
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

/** Coerce a candidate's text field to a bounded string. Non-primitive → ''. */
function coerceText(v: unknown): string {
  if (typeof v === 'string') return v.length > MAX_TEXT_OUT ? v.slice(0, MAX_TEXT_OUT) : v;
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return '';
}

// ─── Text normalization + similarity (internal dedup keys only) ──────────────

/**
 * Lowercase, collapse every run of unicode non-alphanumerics to one space, trim,
 * scan-capped at MAX_TEXT_SCAN. Non-string → ''. This is an INTERNAL dedup key —
 * never surfaced in any output field. Total.
 */
export function normalizeNoveltyText(v: unknown): string {
  try {
    if (typeof v !== 'string') return '';
    const scan = v.length > MAX_TEXT_SCAN ? v.slice(0, MAX_TEXT_SCAN) : v;
    return scan.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  } catch {
    return '';
  }
}

/** Bounded token set of a normalized string (tokens ≥ MIN_TOKEN_LEN, ≤ MAX per unit). */
function tokenSet(norm: string): Set<string> {
  const set = new Set<string>();
  if (norm === '') return set;
  const parts = norm.split(' ');
  for (let i = 0; i < parts.length && set.size < MAX_TOKENS_PER_UNIT; i += 1) {
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

// ─── Anchor index construction ───────────────────────────────────────────────

/** Coerce AnchorInput into a bounded array of blob strings. Never throws. */
function coerceAnchorBlobs(anchors: unknown): string[] {
  if (typeof anchors === 'string') return [anchors];
  if (!Array.isArray(anchors)) return [];
  const blobs: string[] = [];
  // Cap the blob scan so an array of 100k empty rows can't spin unbounded.
  const limit = anchors.length > MAX_ANCHOR_LINES ? MAX_ANCHOR_LINES : anchors.length;
  for (let i = 0; i < limit; i += 1) {
    let el: unknown;
    try {
      el = anchors[i];
    } catch {
      continue; // hostile index getter
    }
    if (typeof el === 'string') {
      blobs.push(el);
    } else if (el && typeof el === 'object') {
      let t: unknown;
      try {
        t = (el as { text?: unknown }).text;
      } catch {
        t = undefined;
      }
      if (t === undefined || t === null) {
        try {
          t = (el as { content?: unknown }).content;
        } catch {
          t = undefined;
        }
      }
      if (typeof t === 'string') blobs.push(t);
    }
  }
  return blobs;
}

function emptyMutableIndex(): MutableIndex {
  return { exact: new Set<string>(), sig: new Set<string>(), lineTokens: [], joined: ' ' };
}

/**
 * Explode anchor blobs into normalized LINES and build the bounded index used by
 * the coverage check: exact-line keys, leading-SIG_CHARS signatures for long
 * lines, per-line token Sets, and a token-boundary-padded joined string for
 * containment. Each blob is scan-capped (MAX_ANCHOR_CHARS) before splitting;
 * total lines ≤ MAX_ANCHOR_LINES; joined ≤ MAX_ANCHOR_CHARS. Junk → empty index.
 * Total; deterministic.
 */
export function buildAnchorIndex(anchors: unknown): AnchorIndex {
  try {
    const blobs = coerceAnchorBlobs(anchors);
    const idx = emptyMutableIndex();
    let joinedFull = false;
    let lineCount = 0;
    for (let b = 0; b < blobs.length; b += 1) {
      if (lineCount >= MAX_ANCHOR_LINES) break;
      let blob = blobs[b];
      if (blob.length > MAX_ANCHOR_CHARS) blob = blob.slice(0, MAX_ANCHOR_CHARS);
      const rawLines = blob.split(/[\r\n]+/);
      for (let l = 0; l < rawLines.length; l += 1) {
        if (lineCount >= MAX_ANCHOR_LINES) break;
        const norm = normalizeNoveltyText(rawLines[l]);
        if (norm === '') continue;
        lineCount += 1;
        idx.exact.add(norm);
        if (norm.length >= SIG_CHARS) idx.sig.add(norm.slice(0, SIG_CHARS));
        idx.lineTokens.push(tokenSet(norm));
        if (!joinedFull) {
          if (idx.joined.length + norm.length + 1 > MAX_ANCHOR_CHARS) joinedFull = true;
          else idx.joined += norm + ' ';
        }
      }
    }
    return idx;
  } catch {
    return emptyMutableIndex();
  }
}

/** Coerce anything (a prebuilt AnchorIndex, a malformed object, junk) into a
 *  usable MutableIndex-shaped view. Missing/wrong-typed fields → empty. Total. */
function coerceIndex(idx: unknown): MutableIndex {
  const o = idx && typeof idx === 'object' ? (idx as Record<string, unknown>) : {};
  return {
    exact: o.exact instanceof Set ? (o.exact as Set<string>) : new Set<string>(),
    sig: o.sig instanceof Set ? (o.sig as Set<string>) : new Set<string>(),
    lineTokens: Array.isArray(o.lineTokens) ? (o.lineTokens as Array<Set<string>>) : [],
    joined: typeof o.joined === 'string' ? (o.joined as string) : ' ',
  };
}

// ─── Coverage check ──────────────────────────────────────────────────────────

/**
 * Three signals, cheapest first, against ONE index. Returns the reason or null.
 * `tokens` is the candidate's precomputed token set (may be empty). Never throws.
 */
function coverageReason(
  norm: string,
  tokens: Set<string>,
  idx: MutableIndex,
  opts: ResolvedOptions,
): NoveltyCoverageReason | null {
  try {
    if (norm === '') return null;
    // (a) exact line, or shared long-line prefix signature.
    if (idx.exact.has(norm)) return 'exact';
    if (norm.length >= SIG_CHARS && idx.sig.has(norm.slice(0, SIG_CHARS))) return 'exact';
    // (b) token-boundary containment inside the joined blob.
    if (opts.containmentOn && norm.length >= MIN_CONTAINMENT_CHARS) {
      if (idx.joined.indexOf(' ' + norm + ' ') >= 0) return 'containment';
    }
    // (c) per-line token-set Jaccard — both sides must clear the token floor so
    //     distinct SHORT facts are never collapsed (mirrors chatRetrievalRankCore).
    if (tokens.size >= opts.minTokens && opts.minTokens > 0) {
      const lt = idx.lineTokens;
      let compared = 0;
      for (let j = lt.length - 1; j >= 0 && compared < COMPARE_WINDOW; j -= 1) {
        const at = lt[j];
        if (!(at instanceof Set) || at.size < opts.minTokens) continue;
        compared += 1;
        if (jaccard(tokens, at) >= opts.threshold) return 'jaccard';
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Is `text` already covered by `index`? Three signals (exact-line / SIG prefix →
 * 'exact'; token-boundary containment → 'containment'; per-line Jaccard →
 * 'jaccard'). `index` is a prebuilt AnchorIndex (malformed/junk → treated as
 * empty → not covered). Never throws.
 */
export function isCoveredByAnchors(
  text: unknown,
  index: AnchorIndex,
  opts?: NoveltyFilterOptions,
): { covered: boolean; reason: NoveltyCoverageReason | null } {
  try {
    const norm = normalizeNoveltyText(text);
    if (norm === '') return { covered: false, reason: null };
    const idx = coerceIndex(index);
    const o = resolveOptions(opts);
    const reason = coverageReason(norm, tokenSet(norm), idx, o);
    return { covered: reason !== null, reason };
  } catch {
    return { covered: false, reason: null };
  }
}

// ─── Options ─────────────────────────────────────────────────────────────────

function resolveThreshold(v: unknown): number {
  const n = toFiniteNumber(v);
  if (n === undefined || n <= 0 || n > 1) return DEFAULT_REDUNDANCY_THRESHOLD;
  return n;
}

function resolveBool(v: unknown, dflt: boolean): boolean {
  return typeof v === 'boolean' ? v : dflt;
}

function resolveMinTokens(v: unknown): number {
  const n = toFiniteNumber(v);
  if (n === undefined || n < 0) return DEFAULT_MIN_TOKENS;
  const f = Math.floor(n);
  return f > MAX_TOKENS_PER_UNIT ? MAX_TOKENS_PER_UNIT : f;
}

function resolveMaxKeep(v: unknown): number {
  const n = toFiniteNumber(v);
  if (n === undefined) return MAX_KEEP;
  if (n <= 0) return 0;
  const f = Math.floor(n);
  return f > MAX_KEEP ? MAX_KEEP : f;
}

function resolveOptions(opts: unknown): ResolvedOptions {
  const def: ResolvedOptions = {
    threshold: DEFAULT_REDUNDANCY_THRESHOLD,
    containmentOn: true,
    minTokens: DEFAULT_MIN_TOKENS,
    chain: true,
    maxKeep: MAX_KEEP,
  };
  if (!opts || typeof opts !== 'object') return def;
  try {
    const o = opts as Record<string, unknown>;
    return {
      threshold: resolveThreshold(readField(o, 'redundancyThreshold')),
      containmentOn: resolveBool(readField(o, 'containment'), true),
      minTokens: resolveMinTokens(readField(o, 'minTokens')),
      chain: resolveBool(readField(o, 'chainAcceptedCandidates'), true),
      maxKeep: resolveMaxKeep(readField(o, 'maxKeep')),
    };
  } catch {
    return def;
  }
}

// ─── Candidate normalization ─────────────────────────────────────────────────

interface CleanCandidate {
  id: string;
  text: string;
  source: string;
}

/** Coerce one raw candidate. A bare string is its text. Blank text / junk → null
 *  (skipped, not counted). Blank id → positional. Never throws. */
function normalizeCandidate(raw: unknown, index: number): CleanCandidate | null {
  if (typeof raw === 'string') {
    const text = coerceText(raw);
    if (text === '') return null;
    return { id: 'c' + index, text, source: '' };
  }
  if (raw === null || typeof raw !== 'object') return null;
  try {
    const obj = raw as Record<string, unknown>;
    let textRaw = readField(obj, 'text');
    if (textRaw === undefined || textRaw === null) textRaw = readField(obj, 'content');
    const text = coerceText(textRaw);
    if (text === '') return null; // no payload → no signal → skip
    let id = cleanLabel(readField(obj, 'id'), MAX_ID_LEN);
    if (id === '') id = 'c' + index;
    const source = cleanLabel(readField(obj, 'source'), MAX_SOURCE_LEN);
    return { id, text, source };
  } catch {
    return null;
  }
}

/** Fold an accepted candidate's fact into the working index (chaining). */
function foldAccepted(idx: MutableIndex, norm: string, tokens: Set<string>, joinedFull: boolean): boolean {
  idx.exact.add(norm);
  if (norm.length >= SIG_CHARS) idx.sig.add(norm.slice(0, SIG_CHARS));
  if (idx.lineTokens.length < MAX_CANDIDATES) idx.lineTokens.push(tokens);
  if (!joinedFull) {
    if (idx.joined.length + norm.length + 1 > MAX_ANCHOR_CHARS) return true; // now full
    idx.joined += norm + ' ';
  }
  return joinedFull;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function emptyVerdict(): NoveltyVerdict {
  return { keep: [], drop: [], keptCount: 0, droppedCount: 0 };
}

/**
 * Filter `candidates` so only facts NOT already present in `anchors` survive.
 * `anchors` may be a raw AnchorInput (a doc blob / blobs / item-like rows) OR a
 * prebuilt AnchorIndex. Candidates are processed in input order; each is either:
 *   - dropped as redundant vs an anchor line (matched 'anchor'), or
 *   - (when chaining, default on) dropped as redundant vs an earlier-KEPT
 *     candidate (matched 'candidate') — a true cross-source pass, or
 *   - kept as novel (and folded into the working index), or
 *   - dropped as 'capacity' overflow once `maxKeep` kept items exist (matched
 *     'candidate') — a budget drop, not a redundancy verdict.
 *
 * GUARANTEES: keep ∪ drop covers every VALID candidate (non-blank text) exactly
 * once; keep preserves input order and carries the caller's own text; no drop
 * carries any candidate/anchor text. Deterministic; bounded; never throws.
 */
export function filterNovelAgainstAnchors(
  candidates: unknown,
  anchors: unknown,
  opts?: NoveltyFilterOptions,
): NoveltyVerdict {
  try {
    const o = resolveOptions(opts);
    // Anchors may already be a prebuilt index (has an `exact` Set) — reuse it.
    const anchorIdx =
      anchors && typeof anchors === 'object' && (anchors as { exact?: unknown }).exact instanceof Set
        ? coerceIndex(anchors)
        : coerceIndex(buildAnchorIndex(anchors));
    const acceptedIdx = emptyMutableIndex();
    let acceptedJoinedFull = false;

    const keep: NoveltyCandidate[] = [];
    const drop: NoveltyDrop[] = [];

    if (!Array.isArray(candidates)) return emptyVerdict();
    const limit = candidates.length > MAX_CANDIDATES ? MAX_CANDIDATES : candidates.length;
    for (let i = 0; i < limit; i += 1) {
      let raw: unknown;
      try {
        raw = candidates[i];
      } catch {
        continue; // hostile index getter
      }
      const c = normalizeCandidate(raw, i);
      if (!c) continue; // junk / blank text → skipped (not a valid candidate)
      const norm = normalizeNoveltyText(c.text);
      if (norm === '') continue; // no signal → skipped
      const tokens = tokenSet(norm);

      // (1) redundant vs an always-present anchor line.
      const anchorReason = coverageReason(norm, tokens, anchorIdx, o);
      if (anchorReason) {
        drop.push({ id: c.id, source: c.source, reason: anchorReason, matched: 'anchor' });
        continue;
      }
      // (2) redundant vs an earlier-accepted candidate (chaining).
      if (o.chain && acceptedIdx.exact.size > 0) {
        const accReason = coverageReason(norm, tokens, acceptedIdx, o);
        if (accReason) {
          drop.push({ id: c.id, source: c.source, reason: accReason, matched: 'candidate' });
          continue;
        }
      }
      // (3) novel — but honor the keep cap.
      if (keep.length >= o.maxKeep) {
        drop.push({ id: c.id, source: c.source, reason: 'capacity', matched: 'candidate' });
        continue;
      }
      keep.push(c.source ? { id: c.id, text: c.text, source: c.source } : { id: c.id, text: c.text });
      if (o.chain) acceptedJoinedFull = foldAccepted(acceptedIdx, norm, tokens, acceptedJoinedFull);
    }

    return { keep, drop, keptCount: keep.length, droppedCount: drop.length };
  } catch {
    return emptyVerdict();
  }
}
