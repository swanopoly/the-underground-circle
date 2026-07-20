// streamDegeneracyCore - the PURE CONTENT-based degeneracy detector for a live or
// finished streamed answer. It answers the ONE question the transport-timing state
// machine deliberately cannot: "is the model still SAYING anything, or is it just
// emitting bytes while looping garbage?" - so the chat bubble can stop a runaway
// generation instead of growing a wall of repeated text to max_tokens.
//
// Why this exists (the unowned half of "stalled/degenerate"):
//   `streamHealthCore` watches THREE TRANSPORT SIGNALS and nothing else - it owns
//   STALLED (silence: no byte for a while). But the classic neural-text failure is
//   the opposite: a stream that keeps emitting bytes while looping -
//   "I'll help you. I'll help you. I'll help you...", a run of "==========", a wall
//   of blank lines, or one repeated code line to the token cap. Every one of those
//   bytes re-stamps streamHealthCore's idle clock, so a looping stream reads as
//   perfectly healthy `streaming` FOREVER while output_tokens (cost) climb. This
//   module is the disjoint CONTENT-based half: silence vs. looping are complementary.
//   It is acute here because the app routes to many open / fine-tuned models
//   (BlackSwan-v5, DeepSeek, Groq/Together/Fireworks opens, Ollama, MiniMax, z.ai)
//   that degenerate far more readily than frontier models.
//
// What it does - a bounded TAIL scan (loops manifest at the tail of the growing
// bubble):
//   (a) PERIODIC TAIL-LOOP - for the SMALLEST period p, the last-p-char block that
//       repeats contiguously at the very end. p==1 is a single-char runaway
//       (guarded by a HIGHER threshold so a legit "----" rule or an indent run is
//       safe); p>=2 needs a block with >=2 distinct chars (an all-same block is a
//       char run, deferred to p==1) spanning far past any legitimate repetition.
//   (b) LOW-DIVERSITY - a secondary, triple-gated check for near-periodic vocabulary
//       collapse the char scan misses (mostly-one-word output that isn't cleanly
//       periodic). The triple gate keeps ordinary prose and tables/CSV safe.
//
// CONSERVATIVE by construction: a FALSE "degenerate" truncates a GOOD answer (bad),
// a MISS only wastes tokens (cheap) - so every threshold sits far above legitimate
// repetition and the detector fires only on egregious loops.
//
// PURITY (load-bearing - the smoke runs under tsx/esbuild): ZERO imports; zero side
// effects at import. DETERMINISTIC - no Date.now / Math.random / argless `new Date`;
// no timing is needed at all (unlike streamHealthCore, whose clock is an input).
// TOTAL - every export survives null / undefined / wrong-type / huge / hostile
// (throwing getters, cyclic, Proxy) input by degrading to a neutral verdict and
// NEVER throwing. BOUNDED - only the last MAX_SCAN_CHARS are examined, every echoed
// string is clamped, arrays are capped. SECRET-SAFE - any echoed repeat unit is
// length-clamped, whitespace-escaped, and long hex/base64/token runs are redacted;
// the reason sentence carries kind + numbers only (never echoed content).

// -- Public contract ---------------------------------------------------------

/** The degeneracy classification. `none` is the healthy default. */
export type StreamDegeneracyKind =
  | 'none' // no degeneracy detected
  | 'char_run' // a single character repeated to a runaway length
  | 'phrase_loop' // a short multi-char unit repeated contiguously (no newline)
  | 'line_loop' // a repeated unit that contains a newline (a looped line)
  | 'low_diversity'; // near-periodic vocabulary collapse (mostly one token)

/** The verdict from {@link assessStreamDegeneracy}. When not degenerate every
 *  field is the neutral default (`kind:'none'`, `confidence:0`, `repeats:0`,
 *  `repeatUnit:''`, `reason:''`) - never `undefined`. */
export interface StreamDegeneracyVerdict {
  /** The headline: true only for an egregious, past-threshold loop. */
  degenerate: boolean;
  /** Which failure shape fired (`'none'` when healthy). */
  kind: StreamDegeneracyKind;
  /** Strength in [0,1], rounded to 2dp; 0 when not degenerate. */
  confidence: number;
  /** Contiguous repeat count for periodic kinds; 0 otherwise. */
  repeats: number;
  /** Bounded (<= REPEAT_UNIT_MAX), whitespace-escaped, secret-redacted repeated
   *  span; '' when there is nothing safe to show. */
  repeatUnit: string;
  /** Short, secret-safe sentence (kind + numbers only); '' when healthy. */
  reason: string;
}

/** Optional tuning for {@link assessStreamDegeneracy}; every field is clamped to a
 *  safe band, and an invalid / hostile value falls back to the default. */
export interface AssessStreamDegeneracyOptions {
  /** Longest loop period scanned (chars). Clamped to [1, MAX_LOOP_PERIOD]. */
  maxPeriod?: number;
  /** Minimum spanned length (repeats*period) for a p>=2 loop to qualify.
   *  Clamped to [LOOP_SPAN_FLOOR, MAX_SCAN_CHARS]; default LOOP_SPAN_MIN. */
  minLoopSpan?: number;
  /** Minimum contiguous repeats for a p>=2 loop to qualify.
   *  Clamped to [LOOP_REPEATS_FLOOR, MAX_LOOP_REPEATS]; default LOOP_REPEATS_MIN. */
  minRepeats?: number;
}

// -- Exported bounds (callers + smoke share these) ---------------------------

/** Only the last this-many chars of the answer are examined - loops live at the
 *  tail of the growing bubble, and this hard-bounds all work on huge inputs. */
export const MAX_SCAN_CHARS = 4096;
/** Longest loop period scanned. Beyond a ~64-char repeated unit it stops being a
 *  meaningful periodic loop and the bound keeps work + echoed spans small. */
export const MAX_LOOP_PERIOD = 64;
/** A single-char run must reach this length to count as a `char_run`. Set HIGHER
 *  than LOOP_SPAN_MIN because single-char repetition is far more often legitimate
 *  (a "--------" rule, an indent, a run of blank lines). */
export const CHAR_RUN_MIN = 300;
/** A p>=2 loop must span at least this many chars (repeats*period) to qualify -
 *  well above a "|--|--|" table separator or a "----" rule. */
export const LOOP_SPAN_MIN = 240;
/** A p>=2 loop must repeat contiguously at least this many times to qualify. */
export const LOOP_REPEATS_MIN = 4;
/** Low-diversity needs at least this many whitespace tokens before it can fire -
 *  a short answer is never judged for vocabulary collapse. */
export const DIVERSITY_MIN_WORDS = 100;
/** Low-diversity gate: distinct/total token ratio must be at or below this
 *  (normal prose sits ~0.4-0.7; tables/CSV are near 1.0). */
export const DIVERSITY_MAX_UNIQUE_RATIO = 0.1;
/** Low-diversity gate: the single most frequent token must be at least this
 *  fraction of all tokens (a real loop is dominated by one unit). */
export const DIVERSITY_TOP_TOKEN_MIN_RATIO = 0.25;
/** Only the last this-many whitespace tokens of the tail feed the diversity check. */
export const MAX_DIVERSITY_WORDS = 400;
/** Hard cap on the echoed `repeatUnit`. */
export const REPEAT_UNIT_MAX = 40;

// -- Internal bounds (defensive clamps; callers tune within these) -----------

/** Floor for a caller-supplied `minLoopSpan` - keeps tuning conservative. */
const LOOP_SPAN_FLOOR = 80;
/** Floor for a caller-supplied `minRepeats`. */
const LOOP_REPEATS_FLOOR = 2;
/** Cap for a caller-supplied `minRepeats`. */
const MAX_LOOP_REPEATS = 4096;
/** Hard cap on the `reason` sentence. */
const REASON_MAX = 160;
/** The mask substituted for a redacted secret-shaped run. */
const REDACTED_MASK = '[redacted]';

/** A contiguous alnum / base64 / token run of >= 16 chars - long enough to skip
 *  ordinary words, short enough to catch hex/base64 secret shapes. Redacted from
 *  echoes. ASCII-only source; a fresh RegExp is built per call. */
const SECRET_RUN_SOURCE = '[A-Za-z0-9+/=_-]{16,}';

// -- Small total helpers -----------------------------------------------------

/** Read `key` off an arbitrary value without ever throwing (a hostile input can
 *  be a Proxy whose getter throws). Non-object / throwing read -> `undefined`. */
function safeGet(obj: unknown, key: string): unknown {
  if (!obj || typeof obj !== 'object') return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Clamp a caller-supplied integer option into [min,max]; a non-finite / non-number
 *  value falls back to `dflt`, and an out-of-range value clamps to the nearest bound. */
function clampInt(value: unknown, dflt: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : dflt;
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/** Clamp to [0,1]; non-finite -> 0. */
function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/** Round to 2 decimal places, deterministically. */
function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/** Clamp the reason sentence to its hard cap. */
function clampReason(s: string): string {
  return s.length > REASON_MAX ? s.slice(0, REASON_MAX) : s;
}

/** Replace long secret-shaped runs with the mask. Fresh RegExp each call so the
 *  global `lastIndex` can never leak between calls. Never throws. */
function redactSecretRuns(s: string): string {
  try {
    return s.replace(new RegExp(SECRET_RUN_SOURCE, 'g'), REDACTED_MASK);
  } catch {
    return s;
  }
}

/** Make whitespace visible so a newline/tab in an echoed unit can't break a UI
 *  line - done BEFORE stripping controls so the escape survives. */
function escapeWhitespace(s: string): string {
  return s.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
}

/**
 * True for a code point that must never survive in an echoed span: C0 controls +
 * DEL + C1 controls, the two Unicode line separators, the zero-width / word-joiner
 * / bidi-override / BOM markers, and the prompt-fence chars (backtick + angle
 * brackets). Expressed purely as numeric comparisons so the source stays ASCII
 * (no raw invisibles) and the check is deterministic.
 */
function isUnsafeCode(code: number): boolean {
  if (code <= 0x1f) return true; // C0 controls (incl. NUL) - remaining after ws-escape
  if (code >= 0x7f && code <= 0x9f) return true; // DEL + C1 controls
  if (code === 0x2028 || code === 0x2029) return true; // line / paragraph separators
  if (code >= 0x200b && code <= 0x200f) return true; // zero-width + bidi marks
  if (code >= 0x202a && code <= 0x202e) return true; // bidi embeddings / overrides
  if (code >= 0x2060 && code <= 0x2064) return true; // word joiner + invisible ops
  if (code >= 0x2066 && code <= 0x2069) return true; // bidi isolates
  if (code === 0xfeff) return true; // BOM / zero-width no-break space
  if (code === 0x60 || code === 0x3c || code === 0x3e) return true; // ` < >
  return false;
}

/** Strip every unsafe code point (see {@link isUnsafeCode}). Char-code scan; never
 *  throws on a well-formed string. */
function stripUnsafe(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (!isUnsafeCode(s.charCodeAt(i))) out += s.charAt(i);
  }
  return out;
}

/**
 * Turn a raw repeated block into a bounded, whitespace-escaped, secret-redacted
 * span safe to surface in chat/logs. Order: redact secrets first (before an
 * embedded separator could split a token), then escape whitespace, then strip any
 * remaining unsafe chars, then clamp. Never throws; non-string -> ''.
 */
function sanitizeRepeatUnit(block: unknown): string {
  try {
    let s = typeof block === 'string' ? block : '';
    if (!s) return '';
    // Pre-clamp the raw block so escaping can't blow up work on a pathological unit.
    if (s.length > REPEAT_UNIT_MAX * 2) s = s.slice(0, REPEAT_UNIT_MAX * 2);
    s = redactSecretRuns(s);
    s = escapeWhitespace(s);
    s = stripUnsafe(s);
    if (s.length > REPEAT_UNIT_MAX) s = s.slice(0, REPEAT_UNIT_MAX);
    return s;
  } catch {
    return '';
  }
}

/** The neutral (healthy) verdict - a FRESH object each call so a caller can never
 *  corrupt a shared instance. Deterministic (identical values every time). */
function neutralVerdict(): StreamDegeneracyVerdict {
  return { degenerate: false, kind: 'none', confidence: 0, repeats: 0, repeatUnit: '', reason: '' };
}

/** Do the `len`-char blocks of `s` at `aStart` and `bStart` match char-for-char?
 *  Mirrors oscillationDetectorCore.blocksEqual - a per-char compare with no
 *  per-step slice allocation. */
function blockEqualChars(s: string, aStart: number, bStart: number, len: number): boolean {
  for (let k = 0; k < len; k++) {
    if (s.charCodeAt(aStart + k) !== s.charCodeAt(bStart + k)) return false;
  }
  return true;
}

/** How many times the last-`p`-char block repeats CONTIGUOUSLY at the very end of
 *  `s` (length `n`). The final block itself counts as 1; each preceding equal
 *  block adds one. Bounded by n/p iterations. */
function countTailRepeats(s: string, p: number, n: number): number {
  let repeats = 1;
  let start = n - p;
  while (start - p >= 0 && blockEqualChars(s, start - p, start, p)) {
    repeats += 1;
    start -= p;
  }
  return repeats;
}

/** Count distinct char codes in `s[start, start+len)`, early-exiting at 2 (the
 *  only threshold callers care about). */
function distinctCharCount(s: string, start: number, len: number): number {
  const seen = new Set<number>();
  for (let k = 0; k < len; k++) {
    seen.add(s.charCodeAt(start + k));
    if (seen.size >= 2) return seen.size;
  }
  return seen.size;
}

/** Last <= MAX_DIVERSITY_WORDS non-empty whitespace tokens of `tail`. */
function splitTokens(tail: string): string[] {
  const raw = tail.split(/\s+/);
  const out: string[] = [];
  for (const t of raw) {
    if (t.length > 0) out.push(t);
  }
  return out.length > MAX_DIVERSITY_WORDS ? out.slice(out.length - MAX_DIVERSITY_WORDS) : out;
}

/** Build the degenerate verdict for a periodic loop of period `p`. */
function buildPeriodicVerdict(
  tail: string,
  n: number,
  p: number,
  repeats: number,
  kind: StreamDegeneracyKind,
): StreamDegeneracyVerdict {
  const span = repeats * p; // always <= n (the loop lives inside the scanned tail)
  const confidence = round2(clamp01(span / (n > 0 ? n : 1)));
  const repeatUnit = sanitizeRepeatUnit(tail.slice(n - p, n));
  let reason: string;
  if (kind === 'char_run') reason = `single-character run x${repeats}`;
  else if (kind === 'line_loop') reason = `repeating ${p}-char line x${repeats}`;
  else reason = `repeating ${p}-char phrase x${repeats}`;
  return { degenerate: true, kind, confidence, repeats, repeatUnit, reason: clampReason(reason) };
}

/**
 * (a) PERIODIC TAIL-LOOP - the primary, unambiguous detector. Scans period
 * p=1..maxPeriod and returns the SMALLEST qualifying p (the true fundamental
 * period). Returns null when nothing qualifies.
 *
 *   p==1  -> qualifies on repeats >= CHAR_RUN_MIN (single-char runaway).
 *   p>=2  -> the block must have >= 2 DISTINCT chars (an all-same block is a char
 *           run, deferred to the higher p==1 threshold - so a long "====" divider
 *           never trips here), AND repeats*p >= minLoopSpan AND repeats >= minRepeats.
 */
function detectPeriodicLoop(
  tail: string,
  n: number,
  maxPeriod: number,
  minLoopSpan: number,
  minRepeats: number,
): StreamDegeneracyVerdict | null {
  const pMax = Math.min(maxPeriod, n);
  for (let p = 1; p <= pMax; p++) {
    const repeats = countTailRepeats(tail, p, n);
    if (p === 1) {
      if (repeats >= CHAR_RUN_MIN) return buildPeriodicVerdict(tail, n, p, repeats, 'char_run');
      continue;
    }
    // p >= 2: an all-same-char block is really a char run - defer to p==1.
    if (distinctCharCount(tail, n - p, p) < 2) continue;
    if (repeats * p < minLoopSpan || repeats < minRepeats) continue;
    const hasNewline = tail.slice(n - p, n).indexOf('\n') >= 0;
    return buildPeriodicVerdict(tail, n, p, repeats, hasNewline ? 'line_loop' : 'phrase_loop');
  }
  return null;
}

/**
 * (b) LOW-DIVERSITY - the secondary detector, only consulted when (a) found
 * nothing. Fires only when ALL THREE gates hold over the tail's tokens:
 *   wordCount >= DIVERSITY_MIN_WORDS,
 *   distinct/total <= DIVERSITY_MAX_UNIQUE_RATIO,
 *   topTokenFreq/total >= DIVERSITY_TOP_TOKEN_MIN_RATIO.
 * The triple gate keeps ordinary prose (~0.4-0.7 unique) and tables/CSV (many
 * distinct cells) safe. Returns null when it does not fire.
 */
function detectLowDiversity(tail: string): StreamDegeneracyVerdict | null {
  const tokens = splitTokens(tail);
  const total = tokens.length;
  if (total < DIVERSITY_MIN_WORDS) return null;

  const freq = new Map<string, number>();
  let topFreq = 0;
  let topToken = '';
  for (const t of tokens) {
    const c = (freq.get(t) ?? 0) + 1;
    freq.set(t, c);
    if (c > topFreq) {
      topFreq = c;
      topToken = t;
    }
  }

  const distinct = freq.size;
  const uniqueRatio = distinct / total;
  const topRatio = topFreq / total;
  if (uniqueRatio > DIVERSITY_MAX_UNIQUE_RATIO) return null;
  if (topRatio < DIVERSITY_TOP_TOKEN_MIN_RATIO) return null;

  return {
    degenerate: true,
    kind: 'low_diversity',
    confidence: round2(clamp01(1 - uniqueRatio)),
    repeats: 0,
    repeatUnit: sanitizeRepeatUnit(topToken),
    reason: clampReason(`low vocabulary diversity ${distinct}/${total} unique`),
  };
}

// -- Exports -----------------------------------------------------------------

/**
 * Assess whether a streamed answer has degenerated into a content loop.
 *
 * Non-string / empty / hostile input -> the neutral verdict. Otherwise only the
 * last MAX_SCAN_CHARS are examined (loops manifest at the tail). Runs (a) the
 * periodic tail-loop detector, then (b) low-diversity as a fallback. Conservative:
 * a positive means an egregious, past-threshold loop - never ordinary repetition.
 *
 * TOTAL: any input shape (null/number/object/huge/cyclic/Proxy/throwing getters)
 * yields a valid bounded verdict and never throws. Deterministic; secret-safe.
 */
export function assessStreamDegeneracy(
  text: unknown,
  opts?: AssessStreamDegeneracyOptions,
): StreamDegeneracyVerdict {
  try {
    if (typeof text !== 'string' || text.length === 0) return neutralVerdict();

    const maxPeriod = clampInt(safeGet(opts, 'maxPeriod'), MAX_LOOP_PERIOD, 1, MAX_LOOP_PERIOD);
    const minLoopSpan = clampInt(safeGet(opts, 'minLoopSpan'), LOOP_SPAN_MIN, LOOP_SPAN_FLOOR, MAX_SCAN_CHARS);
    const minRepeats = clampInt(safeGet(opts, 'minRepeats'), LOOP_REPEATS_MIN, LOOP_REPEATS_FLOOR, MAX_LOOP_REPEATS);

    const tail = text.length > MAX_SCAN_CHARS ? text.slice(text.length - MAX_SCAN_CHARS) : text;
    const n = tail.length;
    if (n === 0) return neutralVerdict();

    const periodic = detectPeriodicLoop(tail, n, maxPeriod, minLoopSpan, minRepeats);
    if (periodic) return periodic;

    const lowDiv = detectLowDiversity(tail);
    if (lowDiv) return lowDiv;

    return neutralVerdict();
  } catch {
    // Total contract: any unforeseen input shape yields the safe neutral verdict.
    return neutralVerdict();
  }
}

/** Static, secret-free user copy per degeneracy kind. Frozen. */
const DEGENERACY_COPY: Readonly<Record<StreamDegeneracyKind, string>> = Object.freeze({
  none: '',
  char_run: 'The response started repeating itself, so I stopped it early.',
  phrase_loop: 'The response started repeating itself, so I stopped it early.',
  line_loop: 'The response started repeating itself, so I stopped it early.',
  low_diversity: 'The response stopped making progress and began looping, so I stopped it early.',
});

/**
 * The calm, secret-free one-liner for a verdict - what a user sees when a
 * degenerate stream is stopped early. Pairs with resolveChatStopMessage('stuck_loop')
 * for the retry/fresh chips. `none` and any malformed/foreign verdict -> ''.
 * Never throws.
 */
export function describeStreamDegeneracy(verdict: StreamDegeneracyVerdict): string {
  try {
    const kind = safeGet(verdict, 'kind');
    if (typeof kind !== 'string') return '';
    if (Object.prototype.hasOwnProperty.call(DEGENERACY_COPY, kind)) {
      return DEGENERACY_COPY[kind as StreamDegeneracyKind];
    }
    return '';
  } catch {
    return '';
  }
}
