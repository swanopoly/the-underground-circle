// turnCachePolicyCore — the PURE predicate that decides whether a completed
// SwanBot turn result is worth CACHING (robustness backlog finding #6).
//
// THE BUG THIS EXISTS FOR: `src/lib/swanbotTurnDedupe.ts`
// (`runSwanBotTurnWithDuplicateGuard`) caches EVERY settled turn result for
// `SWANBOT_TURN_DEDUPE_TTL_MS` (15s) keyed by user+message+context — including
// FAILURE / stop / recovery strings ("A tool step failed…", "AI's offline rn…",
// "This turn stopped before I could finish. Try again…"). So a user who reads a
// transient failure and immediately re-sends the SAME message inside the 15s
// window gets the identical cached failure replayed and the retry is a silent
// no-op — the runner never re-executes. The fix is to gate the cache write on
// this predicate: only genuine SUCCESS results are cacheable; failure/empty
// results are NOT cached, so an immediate retry actually re-runs.
//
// WIRING (do this in swanbotTurnDedupe.ts, inside the settle handler, before
// `completedSwanBotTurns.set(key, { settledAt: Date.now(), value })`):
//     if (isCacheableTurnResult(value)) {
//       completedSwanBotTurns.set(key, { settledAt: Date.now(), value });
//     }
// The in-flight de-dup (concurrent identical sends share one promise) is
// unchanged; only the POST-settle 15s replay cache becomes success-only.
//
// PURITY / SAFETY CONTRACT:
//   - ZERO runtime imports (tsx/esbuild-loadable; no react-native). No
//     Date.now()/Math.random() at module scope.
//   - Every export is TOTAL: null / undefined / wrong-type / huge / hostile
//     (throwing getters, Proxies) input never throws — it resolves to a safe
//     neutral value. Output is bounded (a 3-value enum / a boolean).
//   - BIAS = fail toward NOT caching. A false "failure/empty" merely lets a
//     rapid duplicate re-run (harmless, correct). A false "success" re-caches a
//     failure and reintroduces the silent-no-op bug. So on ANY ambiguity we
//     prefer the non-cacheable classification.
//
// NOTE on structured results: `getSwanBotStructuredResponse` is ALSO wrapped by
// the guard and returns `{ response: string, … }` (no `ok`/`error` field). To
// actually fix that call site we look INTO the object's `response`/`message`/
// `text` string and classify it, in addition to honoring explicit `ok:false` /
// truthy `error`. This is a strict superset of "ok:false or error → failure".

export type TurnResultClass = 'success' | 'failure' | 'empty';

/**
 * Substrings (lowercase, ASCII apostrophes) that mark a turn result as a
 * failure/stop/recovery message rather than a real answer. Grounded in the app's
 * actual copy: chat stop messages (`src/lib/chatStopMessageCore.ts`), the
 * AI-offline fallbacks (`src/lib/swanbot.ts`), desktop-bridge / recovery notices,
 * and generic breakage strings. Exported so the wiring stays a single source of
 * truth and the marker set is inspectable/testable.
 *
 * Matching is deliberately gated (short result + marker LEADS) — see
 * classifyTurnResult — so a long substantive answer that merely mentions
 * "failed" in prose stays a cacheable 'success'.
 */
export const NON_CACHEABLE_MARKERS: readonly string[] = [
  // Generic breakage
  'something broke',
  'something went wrong',
  'went wrong',
  // Inability
  "couldn't",
  'could not',
  "can't reach",
  'cannot reach',
  'unable to',
  // Retry / stop / pause copy
  'try again',
  'stopped before i could',
  'stopped this turn',
  'this turn hit its limit',
  'hit its limit',
  'i paused',
  // Tool / step failure
  'failed',
  'tool step failed',
  'step failed',
  // Connectivity / availability
  'desktop bridge',
  'not connected',
  'not paired',
  'not responding',
  'offline',
  'connection is down',
  'connection to ai',
  'temporarily down',
  'no longer',
];

/** Very-short apologetic openers ("Sorry, one sec.", "oops") that read as a
 *  failure/recovery even without a keyword marker. Only consulted for very short
 *  strings (see VERY_SHORT_APOLOGY_LEN). */
const APOLOGY_TOKENS: readonly string[] = [
  'sorry',
  'my bad',
  'apolog', // apologize / apologies
  'oops',
  'whoops',
];

/**
 * A result at/above this length is treated as a substantive answer (cacheable
 * 'success') even if it contains a marker word — a real reply that explains a
 * failure in prose should still cache. Failure/stop/recovery copy in this app is
 * always well under this. (Also bounds work: huge input short-circuits here.)
 */
const MAX_FAILURE_LEN = 400;

/**
 * A marker only counts when it LEADS — appears within the first this-many
 * characters of the trimmed result. Real failure copy leads with its signal
 * (after at most a short "Hey <name>, " greeting); a marker buried deep in an
 * otherwise-normal mid-length answer is treated as incidental prose → 'success'.
 */
const LEAD_WINDOW = 160;

/** Only very short results are classified failure purely on an apology token. */
const VERY_SHORT_APOLOGY_LEN = 80;

/** Only inspect this many leading chars of a string (bounds hostile huge input). */
const SCAN_CAP = 8000;

/** Fold curly/modifier apostrophes to ASCII `'` so "couldn't" matches whether the
 *  source used a straight or typographic apostrophe. */
function normalizeApostrophes(s: string): string {
  return s.replace(/[‘’ʼ′]/g, "'");
}

/**
 * Classify a raw string turn result. Empty/whitespace → 'empty'. A SHORT
 * (< MAX_FAILURE_LEN) string whose failure marker LEADS (within LEAD_WINDOW), or
 * a very-short apology, → 'failure'. Everything else → 'success'.
 */
function classifyString(raw: string): TurnResultClass {
  // Bound hostile huge input to a leading head slice before any O(n) work.
  const head = raw.length > SCAN_CAP ? raw.slice(0, SCAN_CAP) : raw;
  const trimmed = head.trim();
  const len = trimmed.length;
  if (len === 0) return 'empty';
  // Long → substantive answer (a marker here is incidental prose): cacheable.
  if (len >= MAX_FAILURE_LEN) return 'success';

  const lower = normalizeApostrophes(trimmed.toLowerCase());

  // Very-short apologetic recovery openers.
  if (len <= VERY_SHORT_APOLOGY_LEN) {
    for (let i = 0; i < APOLOGY_TOKENS.length; i += 1) {
      if (lower.indexOf(APOLOGY_TOKENS[i]) >= 0) return 'failure';
    }
  }

  // A leading failure marker in a short result → failure.
  for (let i = 0; i < NON_CACHEABLE_MARKERS.length; i += 1) {
    const idx = lower.indexOf(NON_CACHEABLE_MARKERS[i]);
    if (idx >= 0 && idx <= LEAD_WINDOW) return 'failure';
  }

  return 'success';
}

/**
 * Classify a structured / object turn result. Honors explicit `ok:false` and a
 * truthy `error`, then falls back to classifying the human-visible text field
 * (`response`, else `message`, else `text`) — which is how the structured
 * SwanBot path surfaces failure copy without an `ok`/`error` flag. No recognizable
 * text and no failure flag → 'success'.
 */
function classifyObject(obj: Record<string, unknown>): TurnResultClass {
  if (obj.ok === false) return 'failure';
  if (obj.error) return 'failure';
  const fields = ['response', 'message', 'text'] as const;
  for (let i = 0; i < fields.length; i += 1) {
    const v = obj[fields[i]];
    if (typeof v === 'string') return classifyString(v);
  }
  return 'success';
}

/**
 * Classify an arbitrary turn result value.
 *   - null / undefined                          → 'empty'
 *   - string: empty/whitespace                  → 'empty'
 *   - string: leading failure/stop/recovery copy→ 'failure'
 *   - string: anything else                     → 'success'
 *   - object: ok:false | truthy error           → 'failure'
 *   - object: response/message/text string      → classify that string
 *   - object: otherwise                         → 'success'
 *   - other primitives (number/boolean/…)       → 'success'
 * TOTAL: hostile input (throwing getter / Proxy) is caught and treated as
 * 'failure' (the safe, non-cacheable direction).
 */
export function classifyTurnResult(value: unknown): TurnResultClass {
  try {
    if (value === null || value === undefined) return 'empty';
    if (typeof value === 'string') return classifyString(value);
    if (typeof value === 'object') return classifyObject(value as Record<string, unknown>);
    // Non-null primitives (number/boolean/bigint/symbol/function): never a real
    // turn result; default to the spec's cacheable 'success'.
    return 'success';
  } catch {
    // Any hostile/throwing input → do not cache (safe direction).
    return 'failure';
  }
}

/**
 * The wiring predicate: TRUE only for a genuine success result. Failure and
 * empty results return FALSE so the 15s replay cache never stores them and an
 * immediate retry actually re-runs. Total — never throws.
 */
export function isCacheableTurnResult(value: unknown): boolean {
  return classifyTurnResult(value) === 'success';
}
