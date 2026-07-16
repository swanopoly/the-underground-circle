// responseFaithfulnessCore — a PURE, deterministic groundedness/faithfulness
// HEURISTIC for a finished TEXT response, checked against the context the model
// was given (retrieved memory + tool output) and any explicit citations. This is
// RESPONSE_QUALITY R6 from docs/SWANBOT_RESPONSE_QUALITY_PLAN.md: nothing today
// checks that a specific circle/app fact in a *chat* answer is actually supported
// by what was retrieved — outcomeVerifier.ts / computerTaskEvidenceContract.ts
// only grade computer/app MUTATIONS, and verificationCoverageCore.ts scores tool
// coverage. This closes the RAG "faithfulness" gap with a lightweight proxy for
// RAGAS/FActScore-style claim decomposition.
//
// It is NOT a model call and NOT a real NLI verifier. The proxy:
//   1. Split the response into sentences and keep the CLAIM-BEARING ones — those
//      that assert a *specific* (a number/date/version, a proper noun/name, a
//      code identifier/path, or a long content word). Pure fluff ("Sure, I can
//      help with that!") carries no checkable specific, so it is not a claim and
//      never counts against grounding.
//   2. A claim is GROUNDED when enough of its specific tokens appear in the
//      context (token/entity overlap) or in an explicit citation. Zero-overlap
//      specific claims are the hallucination shape R6 wants surfaced.
//   3. Emit an ADVISORY signal: score, the unsupported claim sentences, the
//      grounded ratio, and a flag (ok / review / ungrounded). This feeds
//      observability and could gate a soft "double-check sources?" nudge. It is a
//      SIGNAL — it NEVER suppresses, edits, or blocks the response.
//
// Because it is a heuristic it errs toward NOT flagging (a false "ungrounded" that
// nags the user is worse than a miss): unknown/hostile/empty input degrades to a
// neutral, non-flagging ok result. Conservative token matching (exact normalized
// forms) can under-credit paraphrase, which pushes borderline answers to 'review'
// rather than a false 'ok' — the safe direction for an advisory grounding hint.
//
// PURITY: zero imports, tsx-loadable (smoke: response-faithfulness-core). Fully
// DETERMINISTIC — no Date.now / Math.random, no module-scope clock/ids. Every
// export is TOTAL: null / undefined / wrong-type / huge / hostile / cyclic input
// yields a safe neutral result and NEVER throws. Bounded (text, sentence, token,
// and citation scans are all capped). Secret-safe (context text is never echoed;
// emitted claim strings are length-clamped and long secret-like runs redacted).

/** The advisory grounding signal for one finished text response. */
export interface FaithfulnessSignal {
  /**
   * Overall faithfulness score in [0,1], rounded to 2 decimals. Headline figure:
   * the grounded ratio plus a small credit when explicit citations were present
   * (the response made an attribution effort). 1 = every specific claim is
   * supported (or there were no specific claims to check).
   */
  score: number;
  /**
   * The claim-bearing sentences whose specifics were NOT found in context or a
   * citation — the hallucination-shape candidates. Deduped, length-clamped,
   * secret-redacted, and bounded in count. Empty when nothing is unsupported.
   */
  unsupportedClaims: string[];
  /**
   * Pure overlap metric in [0,1], rounded 2dp: grounded claims / total
   * claim-bearing sentences. 1 when there are no claim-bearing sentences. Unlike
   * `score` it carries NO citation credit, so callers can see raw overlap.
   */
  groundedRatio: number;
  /**
   * Advisory band derived from `score`:
   *   'ok'         — well grounded (or nothing specific to check),
   *   'review'     — partial grounding; worth a soft "double-check sources?" hint,
   *   'ungrounded' — specific claims with little/no supporting context.
   */
  flag: 'ok' | 'review' | 'ungrounded';
}

export interface AssessFaithfulnessInput {
  /** The finished assistant text to grade. Non-string → treated as empty. */
  responseText?: unknown;
  /** The context the model had (retrieved memory + tool output). Non-string → empty. */
  contextText?: unknown;
  /**
   * Explicit citations the response attributes to. Accepts a string, an array of
   * strings, or citation objects (fields like raw/url/path/sha/title/label/ref/
   * text/content/source are read). Anything else contributes no citation tokens.
   */
  citations?: unknown;
}

/** A claim is grounded when >= this fraction of its specific tokens are supported. */
export const CLAIM_SUPPORT_THRESHOLD = 0.5;
/** score >= this → flag 'ok'. */
export const FAITHFULNESS_OK_THRESHOLD = 0.7;
/** score >= this (and < ok) → flag 'review'; below → 'ungrounded'. */
export const FAITHFULNESS_REVIEW_THRESHOLD = 0.4;
/** Small score credit added when the response carried usable explicit citations. */
export const CITATION_CREDIT = 0.1;

// ─── Bounds (hostile/huge input safety) ──────────────────────────────────────
const MAX_TEXT_CHARS = 200_000;
const MAX_SENTENCES = 1_500;
const MAX_TOKENS_PER_SENTENCE = 400;
const MAX_SALIENT_PER_SENTENCE = 60;
const MAX_EVIDENCE_TOKENS = 100_000;
const MAX_CITATIONS = 500;
const MAX_UNSUPPORTED_CLAIMS = 12;
const MAX_CLAIM_CHARS = 200;

/** The neutral, non-flagging result. Used for empty/hostile input and the catch. */
const NEUTRAL: FaithfulnessSignal = {
  score: 1,
  unsupportedClaims: [],
  groundedRatio: 1,
  flag: 'ok',
};

// Content tokens: start on an alphanumeric, then allow the code/path/version
// punctuation that keeps identifiers whole (`src/lib/foo.ts`, `v5`, `2.5`,
// `BlackSwan-v5`, `100%`). Colons/commas/quotes are NOT included, so they act as
// boundaries. `-` is last in the class so it stays literal.
const TOKEN_RE = /[A-Za-z0-9][A-Za-z0-9_./%+#-]*/g;

// Common function words, pronouns, and chat filler. A token normalizing to one of
// these is never treated as a "specific" (so "Sure, I can help you with that" is
// not a claim), and such tokens are kept out of the evidence set to bound it.
const STOPWORDS: ReadonlySet<string> = new Set<string>([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'so', 'to', 'of', 'in',
  'on', 'at', 'by', 'for', 'with', 'as', 'is', 'are', 'was', 'were', 'be',
  'been', 'being', 'am', 'it', 'its', 'this', 'that', 'these', 'those', 'i',
  'you', 'he', 'she', 'we', 'they', 'them', 'me', 'my', 'your', 'our', 'their',
  'his', 'her', 'him', 'us', 'do', 'does', 'did', 'done', 'doing', 'can',
  'could', 'should', 'would', 'will', 'shall', 'may', 'might', 'must', 'have',
  'has', 'had', 'having', 'not', 'no', 'nor', 'yes', 'here', 'there', 'now',
  'also', 'just', 'only', 'very', 'really', 'about', 'into', 'onto', 'from',
  'than', 'them', 'what', 'which', 'who', 'whom', 'whose', 'when', 'where',
  'why', 'how', 'all', 'any', 'some', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'such', 'own', 'same', 'up', 'out', 'off', 'over', 'under',
  'again', 'once', 'because', 'while', 'during', 'before', 'after', 'above',
  'below', 'between', 'through', 'using', 'use', 'used', 'uses', 'make', 'makes',
  'made', 'making', 'help', 'helps', 'need', 'needs', 'want', 'wants', 'let',
  'know', 'sure', 'please', 'thanks', 'thank', 'okay', 'ok', 'get', 'gets',
  'got', 'see', 'like', 'via', 'per', 'etc', 'e.g', 'i.e', 'eg', 'ie', 'vs',
  'able', 'will', 'still', 'even', 'much', 'many', 'well', 'good', 'been',
  'let\'s', 'lets', 'go', 'going', 'run', 'runs', 'set', 'add', 'new',
]);

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Map a score to the advisory band. Total: a non-finite score reads as 0
 * (ungrounded) rather than throwing, but callers only ever pass a clamped score.
 */
export function faithfulnessFlag(score: number): FaithfulnessSignal['flag'] {
  const s = Number.isFinite(score) ? score : 0;
  if (s >= FAITHFULNESS_OK_THRESHOLD) return 'ok';
  if (s >= FAITHFULNESS_REVIEW_THRESHOLD) return 'review';
  return 'ungrounded';
}

function toText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.length > MAX_TEXT_CHARS ? value.slice(0, MAX_TEXT_CHARS) : value;
}

/** Lowercase + strip trailing code/version punctuation so `8081.` == `8081`. */
function normalizeToken(raw: string): string {
  const trimmed = raw.replace(/[._/%+#-]+$/, '');
  return trimmed.toLowerCase();
}

/**
 * Split text into sentences: newlines first (bullets/list items are their own
 * lines), then sentence terminators `.!?` followed by whitespace. Leading list
 * markers are stripped. Bounded to MAX_SENTENCES.
 */
function splitSentences(text: string): string[] {
  const out: string[] = [];
  const lines = text.split(/\r?\n+/);
  for (const line of lines) {
    const parts = line.split(/(?<=[.!?])\s+/);
    for (const part of parts) {
      // Strip a leading LIST MARKER only — a bullet, or a numbered ordinal
      // (digits + '.'/')'/']' + whitespace). Do NOT strip a bare leading number:
      // ports/versions/counts/years are exactly the 'specific' data this check
      // exists to verify, and the old class ([\\d.)]) ate them before checking.
      const s = part.replace(/^\s*(?:[-*•]\s*|\d+[.)\]]\s+)/, '').trim();
      if (s) {
        out.push(s);
        if (out.length >= MAX_SENTENCES) return out;
      }
    }
  }
  return out;
}

/**
 * Is `raw`/`norm` a SPECIFIC (checkable) token? Numbers/dates/versions, code
 * identifiers/paths, camelCase, mid-sentence proper nouns, and long content words
 * are specifics; stopwords and short filler are not. `isFirst` suppresses the
 * proper-noun rule for a grammatically-capitalized sentence-initial word (a long
 * such word is still caught by the length rule).
 */
function isSalient(raw: string, norm: string, isFirst: boolean): boolean {
  if (norm.length < 2) return false;
  if (STOPWORDS.has(norm)) return false;
  if (/\d/.test(norm)) return true; // number, date, version, id, percentage
  if (/[A-Za-z0-9][._/][A-Za-z0-9]/.test(raw)) return true; // dotted/slashed/underscored identifier
  if (/[a-z][A-Z]/.test(raw)) return true; // camelCase identifier
  if (!isFirst && /^[A-Z]/.test(raw)) return true; // proper noun mid-sentence
  if (norm.length >= 6) return true; // specific-ish long content word
  return false;
}

/** Collect normalized non-stopword tokens (length >= 2) from `text` into `set`. */
function collectTokens(text: string, set: Set<string>): void {
  if (!text) return;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let count = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (set.size >= MAX_EVIDENCE_TOKENS || count >= MAX_EVIDENCE_TOKENS) break;
    count += 1;
    const norm = normalizeToken(m[0]);
    if (norm.length >= 2 && !STOPWORDS.has(norm)) set.add(norm);
    if (m.index === TOKEN_RE.lastIndex) TOKEN_RE.lastIndex += 1; // zero-width guard
  }
}

/** Read a possibly-hostile string field off a citation object without throwing. */
function readField(obj: Record<string, unknown>, key: string): string {
  try {
    const v = obj[key];
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/** Fields on a citation-like object that may carry a source reference string. */
const CITATION_STRING_FIELDS = [
  'raw', 'url', 'path', 'sha', 'title', 'label', 'ref', 'text', 'content',
  'source', 'name', 'summary', 'quote', 'id', 'href', 'file',
];

/** Add tokens from one citation entry (string / object / nested strings) to `set`. */
function collectCitationEntry(entry: unknown, set: Set<string>): void {
  if (typeof entry === 'string') {
    collectTokens(entry, set);
    return;
  }
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return;
  const obj = entry as Record<string, unknown>;
  for (const key of CITATION_STRING_FIELDS) {
    const val = readField(obj, key);
    if (val) collectTokens(val, set);
  }
}

/** Collect tokens from the whole citations input. Bounded to MAX_CITATIONS. */
function collectCitationTokens(citations: unknown, set: Set<string>): void {
  if (citations == null) return;
  const items = Array.isArray(citations) ? citations : [citations];
  const limit = items.length > MAX_CITATIONS ? MAX_CITATIONS : items.length;
  for (let i = 0; i < limit; i += 1) {
    if (set.size >= MAX_EVIDENCE_TOKENS) break;
    try {
      collectCitationEntry(items[i], set);
    } catch {
      // Hostile getter on a citation entry — skip it.
    }
  }
}

/** Clamp + redact a claim sentence for safe, bounded emission. */
function scrubClaim(sentence: string): string {
  const redacted = sentence
    .replace(/[A-Fa-f0-9]{32,}/g, '[redacted]') // long hex (hashes/keys)
    .replace(/[A-Za-z0-9+/]{40,}={0,2}/g, '[redacted]') // long base64-ish runs
    .replace(/\s+/g, ' ')
    .trim();
  return redacted.length > MAX_CLAIM_CHARS ? `${redacted.slice(0, MAX_CLAIM_CHARS - 1)}…` : redacted;
}

/** Extract the unique salient (specific) tokens from one sentence. Bounded. */
function salientTokensOf(sentence: string): string[] {
  const salient = new Set<string>();
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = TOKEN_RE.exec(sentence)) !== null) {
    if (index >= MAX_TOKENS_PER_SENTENCE || salient.size >= MAX_SALIENT_PER_SENTENCE) break;
    const raw = m[0];
    const norm = normalizeToken(raw);
    if (isSalient(raw, norm, index === 0)) salient.add(norm);
    index += 1;
    if (m.index === TOKEN_RE.lastIndex) TOKEN_RE.lastIndex += 1; // zero-width guard
  }
  return Array.from(salient);
}

/**
 * Assess how faithfully a finished response is grounded in the provided context
 * and citations. Deterministic overlap heuristic — see the module header. TOTAL:
 * any bad/hostile input degrades to a neutral, non-flagging signal and never
 * throws. ADVISORY only: this never suppresses or edits the response.
 */
export function assessFaithfulness(input: AssessFaithfulnessInput | null | undefined): FaithfulnessSignal {
  try {
    if (!input || typeof input !== 'object') return { ...NEUTRAL, unsupportedClaims: [] };

    const responseText = toText((input as AssessFaithfulnessInput).responseText);
    const contextText = toText((input as AssessFaithfulnessInput).contextText);

    // Evidence set: normalized context tokens plus explicit-citation tokens.
    const contextTokens = new Set<string>();
    collectTokens(contextText, contextTokens);
    const citationTokens = new Set<string>();
    collectCitationTokens((input as AssessFaithfulnessInput).citations, citationTokens);
    const hasCitations = citationTokens.size > 0;
    const isSupported = (token: string): boolean =>
      contextTokens.has(token) || citationTokens.has(token);

    const sentences = splitSentences(responseText);

    let claims = 0;
    let supported = 0;
    const unsupportedSet = new Set<string>();
    const unsupportedClaims: string[] = [];

    for (const sentence of sentences) {
      const salient = salientTokensOf(sentence);
      if (salient.length === 0) continue; // not a claim-bearing sentence
      claims += 1;
      let matched = 0;
      for (const token of salient) if (isSupported(token)) matched += 1;
      const ratio = matched / salient.length;
      if (ratio >= CLAIM_SUPPORT_THRESHOLD) {
        supported += 1;
      } else if (unsupportedClaims.length < MAX_UNSUPPORTED_CLAIMS) {
        const scrubbed = scrubClaim(sentence);
        const key = scrubbed.toLowerCase();
        if (scrubbed && !unsupportedSet.has(key)) {
          unsupportedSet.add(key);
          unsupportedClaims.push(scrubbed);
        }
      }
    }

    // No specific claims to check → neutral (nothing to be unfaithful about).
    if (claims === 0) return { score: 1, unsupportedClaims: [], groundedRatio: 1, flag: 'ok' };

    const groundedRatio = round2(clamp01(supported / claims));
    const score = round2(clamp01(groundedRatio + (hasCitations ? CITATION_CREDIT : 0)));
    return { score, unsupportedClaims, groundedRatio, flag: faithfulnessFlag(score) };
  } catch {
    // Hostile input (e.g. throwing getters on `input`) — safe neutral, never throw.
    return { ...NEUTRAL, unsupportedClaims: [] };
  }
}
