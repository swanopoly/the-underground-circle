// chatMultiIntentCore — the PURE, high-precision multi-intent (compound)
// chat-turn segmenter behind SwanBot/OpenSwan "address every ask"
// accountability.
//
// Finding it fixes: a single chat turn frequently packs MULTIPLE distinct
// actionable requests ("fix the login bug, then update the changelog, and also
// open a PR"), but the planner/runtime classify exactly ONE intent per turn, so
// later asks are silently dropped ("you only did the first thing I asked"). No
// deterministic primitive enumerates the asks so the app can seed a per-ask
// TODO, verify all N were addressed, or route each to the right lane. This core
// is that missing PRE/AT-routing primitive: it enumerates the top-level
// actionable requests in one user turn.
//
// DESIGN BIAS (load-bearing): CONSERVATIVE + HIGH-PRECISION, exactly like
// chatClarifyGateCore / chatSendGuardCore. Over-splitting is worse than a miss
// (a false second "intent" spawns a phantom TODO the agent can never satisfy),
// so a boundary is kept ONLY when BOTH adjacent clauses read as actionable
// imperatives — each must LEAD with a curated ACTION VERB. This structurally
// blocks:
//   • coordinated OBJECTS   — "fix the header and footer" (footer has no verb)
//   • narrative "and"       — "I opened the file and it crashed" (no imperative)
//   • pure questions        — "what's broken and how do I fix it?"
// all of which collapse to ONE intent. When unsure → one intent.
//
// PURITY (load-bearing — the smoke runs under tsx/esbuild, which CANNOT load
// react-native/supabase): ZERO runtime imports. No Date.now()/Math.random(); no
// top-level side effects; frozen const maps. Every export is TOTAL — never
// throws on any input (null/undefined/number/NaN/huge/cyclic/hostile); it
// returns a safe, bounded, neutral value. Output is BOUNDED (exported MAX_*
// caps) and SECRET-SAFE: segment text re-emits only bounded, cleaned substrings
// of the user's OWN message (control chars / line separators / prompt-fence
// chars stripped, secret-shaped tokens redacted) so nothing new is leaked into a
// downstream prompt.

// ── Types ────────────────────────────────────────────────────────────────────

/** The boundary class that introduced a segment ('lead' for the first). */
export type IntentConnective =
  | 'lead'
  | 'then'
  | 'also'
  | 'enumerated'
  | 'newline'
  | 'semicolon';

export interface IntentSegment {
  /** 0-based position in the enumerated list. */
  index: number;
  /** Bounded, cleaned, secret-safe substring of the user's own turn. */
  text: string;
  /** First curated ACTION VERB (lowercased) leading the segment, or null. */
  verb: string | null;
  /** The boundary class that introduced this segment ('lead' for index 0). */
  connective: IntentConnective;
  /**
   * Forward-looking: true when the NEXT segment follows this one via a
   * sequence ('then'-class) boundary — i.e. this step gates the next. The last
   * segment is always false. (This is the useful ordering edge: seg0.sequential
   * true means "do seg0 before seg1"; false means the neighbours are additive /
   * order-independent.)
   */
  sequential: boolean;
}

export interface MultiIntentResult {
  /** True only when ≥2 distinct actionable asks were accepted. */
  isMultiIntent: boolean;
  /** Always ≥1 segment; ≤ MAX_INTENT_SEGMENTS; first is always 'lead'. */
  segments: IntentSegment[];
  /** Short machine reason (audit/debug; never secret). */
  reason: string;
}

// ── Bounds (exported so wiring + smokes share the exact caps) ────────────────

/** Chars of the incoming message scanned at all (junk armor). */
export const MAX_INTENT_INPUT_CHARS = 4000;

/** Hard cap on emitted segments; the overflow tail folds into the last one. */
export const MAX_INTENT_SEGMENTS = 8;

/** Per-segment text length cap (bounded output; longer truncates with '…'). */
export const MAX_SEGMENT_CHARS = 300;

// Internal caps (never exported; keep hostile input from blowing up work).
const MAX_BOUNDARY_CANDIDATES = 500;
const MAX_FILLER_STRIPS = 6;

// ── Curated ACTION VERBS (imperative set — precision over recall) ────────────
// A clause is "actionable" only when it LEADS (after stripping courtesy/sequence
// filler + list markers) with one of these. Deliberately base-form imperatives:
// matching whole leading words naturally excludes narrative past tense
// ("opened"/"crashed") and nouns ("the fix is ready").
const ACTION_VERBS: Readonly<Record<string, true>> = Object.freeze({
  build: true, create: true, make: true, generate: true, scaffold: true,
  implement: true, develop: true, design: true, redesign: true, draft: true,
  add: true, write: true, append: true, insert: true, compose: true,
  fix: true, repair: true, resolve: true, debug: true, patch: true,
  update: true, change: true, modify: true, edit: true, revise: true,
  rewrite: true, refactor: true, rename: true, tweak: true, adjust: true,
  delete: true, remove: true, drop: true, clear: true, purge: true,
  wipe: true, uninstall: true, revoke: true, reset: true,
  deploy: true, ship: true, release: true, publish: true, promote: true,
  rollback: true, revert: true, cutover: true,
  run: true, execute: true, exec: true, start: true, stop: true,
  restart: true, launch: true, open: true, close: true, kill: true,
  send: true, email: true, share: true, post: true, forward: true,
  submit: true, notify: true, message: true, dm: true,
  review: true, audit: true, check: true, inspect: true, test: true,
  verify: true, validate: true, analyze: true, analyse: true, research: true,
  investigate: true, summarize: true, summarise: true, document: true,
  commit: true, push: true, pull: true, merge: true, rebase: true,
  fetch: true, clone: true, checkout: true, tag: true, stash: true,
  install: true, configure: true, config: true, setup: true, enable: true,
  disable: true, connect: true, integrate: true, wire: true, hook: true,
  provision: true,
  move: true, copy: true, download: true, upload: true, import: true,
  export: true, migrate: true, sync: true, backup: true, restore: true,
  rollout: true,
  optimize: true, optimise: true, format: true, lint: true, bump: true,
  compile: true, package: true, bundle: true, render: true, plan: true,
  schedule: true, translate: true, convert: true, replace: true, set: true,
});

// ── Boundary detection patterns ──────────────────────────────────────────────
// A single horizontal-whitespace char (space/tab, NOT newline) — so inline
// connective scans never leak across a line break.
const H = '[^\\S\\r\\n]';

/** Sequence ('then'-class) connectives → boundary type 'then' (sequential). */
const THEN_RE = new RegExp(
  `${H}*,?${H}*\\b(?:and${H}+then|then|after${H}+that|afterwards?|next|finally|lastly|followed${H}+by)\\b${H}*`,
  'gi',
);

/** Additive ('also'-class) connectives (explicit) → boundary type 'also'. */
const ALSO_RE = new RegExp(
  `${H}*,?${H}*\\b(?:and${H}+also|as${H}+well${H}+as|also|plus)\\b${H}*`,
  'gi',
);

/** Bare "and" (space-flanked) → boundary type 'also'; kept only when the
 *  FOLLOWING clause leads with a verb (a NEW predicate), enforced downstream. */
const AND_RE = new RegExp(`${H}*,?${H}+\\band\\b${H}+`, 'gi');

/** Newline(s) separating clauses → boundary type 'newline'. */
const NEWLINE_RE = new RegExp(`${H}*(?:\\r?\\n${H}*)+`, 'g');

/** ';' → boundary type 'semicolon'. */
const SEMI_RE = new RegExp(`${H}*;+${H}*`, 'g');

/** Line-start enumeration marker (1. / 1) / - / * / •) → boundary 'enumerated'. */
const ENUM_MARKER_RE = new RegExp(
  `(?:^|\\r?\\n)${H}*(?:\\d{1,3}[.)]|[-*•])${H}+(?=\\S)`,
  'g',
);

/** Leading list marker stripped from a clause/segment head. */
const LEADING_MARKER_RE = /^[^\S\r\n]*(?:\d{1,3}[.)]|[-*•])[^\S\r\n]+/;

/** Leading edge decoration (quotes / brackets / punctuation) stripped. */
const LEADING_EDGE_RE = /^[\s"'“”‘’(\[<>*•:;,.!?_-]+/;

/**
 * Courtesy / sequence filler stripped (iteratively, bounded) before reading a
 * clause's leading verb. Articles are intentionally NOT here: "the fix is
 * ready" must keep "the" as its head so it does not mis-read the noun "fix" as
 * an imperative.
 */
const LEADING_FILLER_RE =
  /^(?:please|pls|plz|kindly|then|also|next|now|just|first(?:ly)?|second(?:ly)?|third(?:ly)?|finally|lastly|afterwards?|afterward|plus|and|so|go|ok|okay|yeah|yep|maybe|actually|quickly|quick|really|simply|kindly|can\s+you|could\s+you|would\s+you|will\s+you|you\s+should|i\s+want\s+you\s+to|i\s+need\s+you\s+to|i\s+want\s+to|i\s+need\s+to|go\s+ahead\s+and|let'?s|lets)\b[\s,:;.!-]*/i;

// ── Secret-safety + text cleaning ─────────────────────────────────────────────

/**
 * True for injection / control / bidi / zero-width / line-separator code points
 * that are neutralized (replaced with a space) before a segment is emitted. Uses
 * numeric ranges (no regex literal) so the source stays free of the very
 * invisible characters it guards against.
 */
function isDangerousCode(c: number): boolean {
  return (
    (c >= 0x00 && c <= 0x08) // C0 controls (NUL..BS), keep \t \n \r
    || c === 0x0b || c === 0x0c
    || (c >= 0x0e && c <= 0x1f)
    || c === 0x7f // DEL
    || c === 0x85 // NEL
    || c === 0x2028 || c === 0x2029 // line / paragraph separators
    || (c >= 0x200b && c <= 0x200f) // zero-width + LRM/RLM
    || (c >= 0x202a && c <= 0x202e) // bidi embeddings / overrides
    || c === 0x2060 // word joiner
    || (c >= 0x2066 && c <= 0x2069) // bidi isolates
    || c === 0xfeff // BOM / zero-width no-break space
    || (c >= 0xfff9 && c <= 0xfffb) // interlinear annotation
  );
}

/** Replace every dangerous code point with a space. Total: never throws. */
function stripDangerous(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i += 1) {
    out += isDangerousCode(input.charCodeAt(i)) ? ' ' : input.charAt(i);
  }
  return out;
}

/** Prompt-fence runs collapsed so a segment can't break out of a prompt block. */
const FENCE_RE = /(?:`{3,}|~{3,})/g;

/** Secret-shaped tokens → '[redacted]' (never echo a value that looks secret). */
const SECRET_PATTERNS: readonly RegExp[] = [
  /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, // JWT
  /\bsk-[A-Za-z0-9_-]{12,}/gi, // sk-… / sk-ant-…
  /\bAKIA[0-9A-Z]{12,}\b/g, // AWS access key id
  /\bgh[posru]_[A-Za-z0-9]{20,}\b/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/gi, // Slack tokens
  /-----BEGIN[A-Z0-9 ]+-----/g, // PEM header
  /\b(?:api[_-]?key|apikey|secret|token|password|passwd|pwd|bearer|authorization)\b\s*[:=]\s*[^\s'"]{6,}/gi,
  /\b[0-9a-fA-F]{32,}\b/g, // long hex run
  /\b[A-Za-z0-9+/]{40,}={0,2}\b/g, // long base64-ish run
];

function redactSecrets(input: string): string {
  let s = input;
  try {
    for (const re of SECRET_PATTERNS) {
      re.lastIndex = 0;
      s = s.replace(re, '[redacted]');
    }
  } catch {
    return input;
  }
  return s;
}

/**
 * Clean a raw slice into a bounded, secret-safe segment text: strip the leading
 * list marker, neutralize control/bidi/zero-width + prompt-fence chars, collapse
 * whitespace, redact secret-shaped tokens, trim edge decoration, and hard-cap at
 * MAX_SEGMENT_CHARS (truncating with '…'). Total: never throws.
 */
function cleanSegmentText(raw: string): string {
  try {
    if (typeof raw !== 'string' || !raw) return '';
    let s = raw.length > MAX_INTENT_INPUT_CHARS ? raw.slice(0, MAX_INTENT_INPUT_CHARS) : raw;
    s = s.replace(LEADING_MARKER_RE, '');
    s = stripDangerous(s).replace(FENCE_RE, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    s = redactSecrets(s);
    s = s.replace(/\s+/g, ' ').trim();
    s = s.replace(LEADING_EDGE_RE, '').replace(/[\s]+$/, '');
    if (s.length > MAX_SEGMENT_CHARS) {
      s = `${s.slice(0, MAX_SEGMENT_CHARS - 1).trimEnd()}…`;
    }
    return s;
  } catch {
    return '';
  }
}

/**
 * The first curated ACTION VERB leading `raw` (lowercased), or null. Strips the
 * leading list marker + edge punctuation, iteratively strips courtesy/sequence
 * filler, then reads the first alphabetic token. Total: never throws.
 */
function firstActionVerb(raw: string): string | null {
  try {
    if (typeof raw !== 'string' || !raw) return null;
    let t = raw.length > MAX_SEGMENT_CHARS * 2 ? raw.slice(0, MAX_SEGMENT_CHARS * 2) : raw;
    t = t.replace(LEADING_MARKER_RE, '').replace(LEADING_EDGE_RE, '');
    for (let i = 0; i < MAX_FILLER_STRIPS; i += 1) {
      const next = t.replace(LEADING_FILLER_RE, '');
      if (next === t) break;
      t = next.replace(LEADING_EDGE_RE, '');
    }
    const m = t.match(/^([a-zA-Z][a-zA-Z'’-]*)/);
    if (!m) return null;
    const w = m[1].toLowerCase().replace(/['’-]+$/, '');
    // Strict === true (not truthy): ACTION_VERBS is a plain object literal, so a
    // missing key like "constructor" would otherwise resolve to the inherited
    // Object.prototype.constructor (a truthy function) and be mis-read as a verb.
    return ACTION_VERBS[w] === true ? w : null;
  } catch {
    return null;
  }
}

// ── Internal boundary model ───────────────────────────────────────────────────

interface Boundary {
  /** Inclusive char offset where the connective glue starts. */
  gStart: number;
  /** Exclusive char offset where the glue ends (next clause begins here). */
  gEnd: number;
  type: Exclude<IntentConnective, 'lead'>;
}

/** Tie-break priority for same-start/same-length overlaps (lower kept first). */
const BOUNDARY_PRIORITY: Readonly<Record<Boundary['type'], number>> = Object.freeze({
  then: 0,
  also: 1,
  enumerated: 2,
  newline: 3,
  semicolon: 4,
});

/** Guarded regex sweep — collects matches; never throws; bounded + zero-width safe. */
function scan(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  try {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null) {
      if (guard++ >= MAX_BOUNDARY_CANDIDATES) break;
      out.push(m);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  } catch {
    return out;
  }
  return out;
}

function pushCandidate(
  out: Boundary[],
  type: Boundary['type'],
  gStart: number,
  gEnd: number,
): void {
  if (gEnd <= gStart) return;
  out.push({ gStart, gEnd, type });
}

/** Enumerated-list boundaries (≥2 line-start markers), or null when not a list. */
function detectEnumeratedBoundaries(s: string): Boundary[] | null {
  const markers = scan(ENUM_MARKER_RE, s);
  if (markers.length < 2) return null;
  const out: Boundary[] = [];
  const preamble = s.slice(0, markers[0].index);
  const hasPreamble = preamble.trim().length > 0;
  // With a preamble, marker[0] separates it from item 0; otherwise item 0 leads
  // and its inline marker is stripped by cleanSegmentText.
  const startIdx = hasPreamble ? 0 : 1;
  for (let i = startIdx; i < markers.length; i += 1) {
    const mk = markers[i];
    pushCandidate(out, 'enumerated', mk.index, mk.index + mk[0].length);
  }
  return out;
}

/** Inline (non-enumerated) boundaries: then / also / bare-and / newline / semicolon. */
function detectInlineBoundaries(s: string): Boundary[] {
  const cands: Boundary[] = [];
  for (const m of scan(THEN_RE, s)) pushCandidate(cands, 'then', m.index, m.index + m[0].length);
  for (const m of scan(ALSO_RE, s)) pushCandidate(cands, 'also', m.index, m.index + m[0].length);
  for (const m of scan(AND_RE, s)) pushCandidate(cands, 'also', m.index, m.index + m[0].length);
  for (const m of scan(NEWLINE_RE, s)) pushCandidate(cands, 'newline', m.index, m.index + m[0].length);
  for (const m of scan(SEMI_RE, s)) pushCandidate(cands, 'semicolon', m.index, m.index + m[0].length);
  return resolveNonOverlapping(cands);
}

/** Sort by start, keep the leftmost/longest of any overlapping glue run. */
function resolveNonOverlapping(cands: Boundary[]): Boundary[] {
  cands.sort(
    (a, b) =>
      a.gStart - b.gStart
      || b.gEnd - a.gEnd
      || BOUNDARY_PRIORITY[a.type] - BOUNDARY_PRIORITY[b.type],
  );
  const out: Boundary[] = [];
  let maxEnd = -1;
  for (const c of cands) {
    if (c.gStart < maxEnd) continue;
    out.push(c);
    if (c.gEnd > maxEnd) maxEnd = c.gEnd;
    if (out.length >= MAX_INTENT_SEGMENTS * 8) break;
  }
  return out;
}

interface Clause {
  start: number;
  end: number;
  connective: IntentConnective;
  actionable: boolean;
}

/** Split the turn into clauses at the accepted boundaries (offsets preserved). */
function buildClauses(s: string, boundaries: Boundary[]): Clause[] {
  const clauses: Clause[] = [];
  let cursor = 0;
  let connective: IntentConnective = 'lead';
  for (const b of boundaries) {
    const start = cursor;
    const end = b.gStart;
    clauses.push({ start, end, connective, actionable: firstActionVerb(s.slice(start, end)) !== null });
    cursor = b.gEnd;
    connective = b.type;
  }
  clauses.push({
    start: cursor,
    end: s.length,
    connective,
    actionable: firstActionVerb(s.slice(cursor, s.length)) !== null,
  });
  return clauses;
}

function emptyLeadSegment(): IntentSegment {
  return { index: 0, text: '', verb: null, connective: 'lead', sequential: false };
}

function singleResult(s: string, clauses: Clause[]): MultiIntentResult {
  const text = cleanSegmentText(s);
  const verb = firstActionVerb(s);
  const anyActionable = clauses.some((c) => c.actionable);
  return {
    isMultiIntent: false,
    segments: [{ index: 0, text, verb, connective: 'lead', sequential: false }],
    reason: anyActionable ? 'single-one-verb' : 'single-no-verb',
  };
}

// ── Exports ──────────────────────────────────────────────────────────────────

const MULTI_INTENT_NOTICE_EXECUTION_KINDS = new Set([
  'run_command_handler',
  'run_build_discovery',
]);

/**
 * Whether Chat should preview later segmented asks for an execution lane.
 * Computer tasks are deliberately excluded: their shared runtime receives the
 * complete original message and owns its ordered substeps as one workflow.
 */
export function shouldSurfaceMultiIntentNotice(executionKind: unknown): boolean {
  return typeof executionKind === 'string'
    && MULTI_INTENT_NOTICE_EXECUTION_KINDS.has(executionKind);
}

/**
 * Enumerate the distinct top-level ACTIONABLE requests packed into one chat
 * turn. Total + deterministic. Returns a single 'lead' segment (isMultiIntent
 * false) for the overwhelming majority — non-strings, questions, statements,
 * coordinated objects, narrative "and" — and only splits when ≥2 clauses each
 * lead with a curated imperative verb. Segment text is a bounded, cleaned,
 * secret-safe substring of the user's own turn; nothing is silently dropped
 * (the overflow tail folds into the last segment with reason 'capped').
 */
export function segmentChatIntents(message: unknown): MultiIntentResult {
  try {
    if (typeof message !== 'string') {
      return { isMultiIntent: false, segments: [emptyLeadSegment()], reason: 'empty' };
    }
    const sliced = message.length > MAX_INTENT_INPUT_CHARS
      ? message.slice(0, MAX_INTENT_INPUT_CHARS)
      : message;
    if (!sliced.trim()) {
      return { isMultiIntent: false, segments: [emptyLeadSegment()], reason: 'empty' };
    }

    const boundaries = detectEnumeratedBoundaries(sliced) ?? detectInlineBoundaries(sliced);
    const clauses = buildClauses(sliced, boundaries);

    // Walk clauses, merging every non-actionable clause into the current
    // segment (a boundary is kept only when both sides are actionable). Each
    // range is a [firstClause, lastClause] inclusive span.
    const ranges: Array<[number, number]> = [];
    let curStart = 0;
    let curHasVerb = clauses[0].actionable;
    for (let i = 1; i < clauses.length; i += 1) {
      if (clauses[i].actionable && curHasVerb) {
        ranges.push([curStart, i - 1]);
        curStart = i;
        curHasVerb = true;
      } else if (clauses[i].actionable) {
        curHasVerb = true; // first verb of a leading non-actionable run
      }
    }
    ranges.push([curStart, clauses.length - 1]);

    // Fewer than 2 actionable segments → the whole (bounded) turn is one intent.
    if (ranges.length < 2) {
      return singleResult(sliced, clauses);
    }

    // Cap: fold the overflow tail into the last kept segment (nothing dropped).
    let capped = false;
    let finalRanges = ranges;
    if (ranges.length > MAX_INTENT_SEGMENTS) {
      capped = true;
      const head = ranges.slice(0, MAX_INTENT_SEGMENTS - 1);
      const tail: [number, number] = [ranges[MAX_INTENT_SEGMENTS - 1][0], ranges[ranges.length - 1][1]];
      finalRanges = head.concat([tail]);
    }

    const segments: IntentSegment[] = finalRanges.map(([a, b], index) => {
      const start = clauses[a].start;
      const end = clauses[b].end;
      const text = cleanSegmentText(sliced.slice(start, end));
      return {
        index,
        text,
        verb: firstActionVerb(text),
        connective: clauses[a].connective,
        sequential: false, // set below (forward-looking)
      };
    });
    for (let i = 0; i < segments.length - 1; i += 1) {
      segments[i].sequential = segments[i + 1].connective === 'then';
    }

    let reason = 'multi-additive';
    if (capped) {
      reason = 'capped';
    } else {
      const later = segments.slice(1).map((seg) => seg.connective);
      if (later.some((c) => c === 'enumerated')) reason = 'multi-enumerated';
      else if (later.some((c) => c === 'then')) reason = 'multi-sequential';
    }

    return { isMultiIntent: true, segments, reason };
  } catch {
    return { isMultiIntent: false, segments: [emptyLeadSegment()], reason: 'error' };
  }
}

/**
 * True iff the turn packs ≥2 distinct actionable requests. Exactly
 * `segmentChatIntents(message).isMultiIntent`. Total: non-strings / junk → false.
 */
export function isCompoundRequest(message: unknown): boolean {
  try {
    return segmentChatIntents(message).isMultiIntent;
  } catch {
    return false;
  }
}
