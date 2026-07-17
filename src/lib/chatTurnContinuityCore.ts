// chatTurnContinuityCore — the PURE, high-precision CROSS-TURN carry-forward
// classifier for SwanBot, the chat agent.
//
// Finding it fixes: SwanBot loses the thread across turns. The runtime has NO
// primitive that reads the CURRENT user message against the PRIOR turns to say
// "this depends on what came before, and here's what." ChatTab feeds
// chatClarifyGateCore a crude `hasActiveThreadContext: messages.length >= 2` —
// wrong in BOTH directions: (a) once a thread has ≥2 messages the clarify gate
// ~never fires, so an ambiguous "delete them" whose target was NEVER named is
// silently proceeded on (wrong-thing risk); (b) a terse "fix it" or an answer
// "production" to the bot's own "which environment?" carries no signal about
// WHAT it refers back to, so the agent re-guesses or drops the antecedent. This
// core computes the three carry-forward facts from the turn TEXTS alone:
//   (1) the current turn's RELATION to the thread (answer / continuation /
//       refinement / meta / new-topic),
//   (2) whether the current turn ANSWERS the assistant's just-asked question
//       (detected from the text pair, no structured resume row needed),
//   (3) whether a dangling referent ("it", "them", "the second one") is
//       RESOLVABLE from the window (a plausible antecedent exists) or not (ask
//       instead of guess).
//
// DESIGN BIAS (load-bearing): CONSERVATIVE toward 'new-topic' / carriesForward
// false — a POSITIVE signal is required to set carriesForward, mirroring
// chatClarifyGateCore / chatMultiIntentCore precision bias. When unsure → a
// fresh topic that does not depend on prior turns.
//
// PURITY (load-bearing — the smoke runs under tsx/esbuild, which CANNOT load
// react-native/supabase): ZERO runtime imports; all types declared locally. No
// Date.now()/Math.random()/argless `new Date`; frozen const vocab. Every export
// is TOTAL — never throws on any input (null/undefined/number/NaN/huge/cyclic/
// proxy/throwing-getter) and returns a safe, bounded, fully-populated frame.
// Output is BOUNDED (exported MAX_* caps; every echoed string clamped) and
// SECRET-SAFE: every echoed span is stripped of control / bidi / zero-width /
// line-separator / prompt-fence chars and passes the canonical looksLikeSecret
// guard (a value-shaped span never leaks) used in proactiveSurfacingCore /
// crossSurfaceReferenceResolverCore.

// ── Public types ──────────────────────────────────────────────────────────────

/** How the current turn relates to the thread. */
export type TurnRelation = 'answer' | 'continuation' | 'refinement' | 'meta' | 'new-topic';

/** One prior turn. `text` may be raw or a compacted summary line. */
export interface ContinuityTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** The full cross-turn carry-forward frame for the current message. */
export interface TurnContinuityFrame {
  /** How the current turn relates to the thread. */
  relation: TurnRelation;
  /** Current turn can't be fully understood/acted on without prior turns. */
  carriesForward: boolean;
  /** Assistant's last turn ended asking AND current msg reads as an answer. */
  answersPriorQuestion: boolean;
  /** Bounded, cleaned, secret-safe echo of the assistant's last question, '' if none. */
  priorQuestionText: string;
  /** Deictic spans in the current msg with no in-message antecedent (bounded/cleaned). */
  danglingReferents: string[];
  /** carriesForward AND the window plausibly supplies an antecedent. */
  resolvable: boolean;
  /** Bounded, cleaned, secret-safe re-grounding echo of the best antecedent, '' if none. */
  antecedentHint: string;
  /** Short machine reason code (audit; never secret). */
  reason: string;
}

// ── Bounds (exported so wiring + smokes share the exact caps) ─────────────────

/** Most prior turns considered (the tail of the window is what matters). */
export const MAX_PRIOR_TURNS = 12;
/** Longest prior-turn text scanned; anything past this is truncated. */
export const MAX_TURN_CHARS = 4000;
/** Longest current message scanned; anything past this is truncated. */
export const MAX_MESSAGE_CHARS = 4000;
/** Hard cap on emitted dangling referents. */
export const MAX_REFERENTS = 8;
/** Per-referent length cap. */
export const MAX_REFERENT_LEN = 40;
/** antecedentHint length cap. */
export const MAX_HINT_LEN = 160;
/** priorQuestionText length cap. */
export const MAX_QUESTION_LEN = 200;

// ── Internal caps (never exported; keep hostile input from blowing up work) ───

/** Raw prior-turn entries examined before filtering (tail only). */
const RAW_SCAN_CAP = 128;
/** Tokens produced from any single string. */
const MAX_TOKENS_SCANNED = 400;
/** An answer's substantive-word ceiling. */
const ANSWER_MAX_CONTENT_WORDS = 5;
/** A dangling-referent message's substantive-word ceiling to count as "short". */
const DANGLING_SHORT_CONTENT_WORDS = 5;
/** A deictic within this many leading tokens counts as "leading". */
const LEAD_WINDOW = 3;
/** Iterations of courtesy-prefix stripping. */
const MAX_COURTESY_STRIPS = 4;

// ── Frozen vocab (deterministic; Sets so '__proto__' lookups are safe) ────────

const RELATION_SET: ReadonlySet<string> = new Set<string>([
  'answer', 'continuation', 'refinement', 'meta', 'new-topic',
]);

/** Non-substantive words: dropped from content-word counts + subject detection. */
const STOPWORDS: ReadonlySet<string> = new Set<string>([
  // articles / determiners / possessives
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'our',
  'their', 'his', 'her', 'its', 'another', 'each', 'every', 'some', 'any',
  // pronouns / deictics
  'it', 'them', 'they', 'he', 'she', 'him', 'we', 'you', 'i', 'me', 'us',
  'mine', 'ours', 'yours', 'theirs', 'hers',
  // vague nouns
  'thing', 'things', 'stuff', 'one', 'ones', 'item', 'items',
  // aux / modal / be
  'is', 'are', 'am', 'was', 'were', 'be', 'been', 'being', 'do', 'does',
  'did', 'done', 'have', 'has', 'had', 'will', 'would', 'should', 'could',
  'can', 'may', 'might', 'must', 'shall',
  // preps / conj
  'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with', 'from', 'into', 'onto',
  'and', 'or', 'but', 'so', 'if', 'then', 'than', 'as', 'about', 'over',
  'up', 'out', 'off', 'down', 'back', 'here', 'there',
  // fillers / adverbs / courtesy
  'just', 'now', 'right', 'away', 'soon', 'again', 'already', 'still', 'yet',
  'too', 'also', 'really', 'quick', 'quickly', 'please', 'pls', 'plz', 'asap',
  'ok', 'okay', 'yeah', 'yep', 'yes', 'no', 'not', 'well', 'oh', 'um', 'uh',
  'hmm', 'like', 'kinda', 'sorta',
  // greetings
  'hi', 'hey', 'hiya', 'yo', 'hello', 'sup', 'thanks', 'thank', 'thx',
]);

/** Article/determiner/possessive tokens that mark a following word as a noun. */
const DETERMINERS: ReadonlySet<string> = new Set<string>([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'my', 'your', 'our',
  'their', 'his', 'her', 'its', 'another',
]);

/** Single-word deictic pronouns treated as potential referents. */
const PRONOUN_LIST: readonly string[] = [
  'it', 'its', 'them', 'they', 'that', 'those', 'this', 'these', 'him', 'her',
];

/** Demonstratives: a following concrete noun makes them a determiner, not a referent. */
const DEMONSTRATIVES: ReadonlySet<string> = new Set<string>(['that', 'those', 'this', 'these']);

/** Courtesy tokens stripped from a lead before reading cues (never cue words). */
const COURTESY_TOKENS: ReadonlySet<string> = new Set<string>([
  'please', 'pls', 'plz', 'kindly', 'hey', 'hi', 'hiya', 'yo', 'hello', 'sup',
  'ok', 'okay', 'oh', 'so', 'well', 'um', 'uh', 'hmm', 'yeah', 'yep',
]);

/** Bare affirmations/negations (a whole-message answer to a yes/no question). */
const AFFIRM_NEG: ReadonlySet<string> = new Set<string>([
  'yes', 'yep', 'yeah', 'yup', 'yea', 'y', 'sure', 'ok', 'okay', 'correct',
  'right', 'exactly', 'affirmative', 'absolutely', 'definitely', 'please',
  'do', 'it', 'go', 'ahead', 'sounds', 'good', 'fine', 'perfect', 'great',
  'no', 'nope', 'nah', 'n', 'negative', 'nevermind', 'thanks',
]);

/** Strong imperative "new work" verbs: a short msg leading with one is NOT an answer. */
const NEW_WORK_VERBS: ReadonlySet<string> = new Set<string>([
  'build', 'create', 'make', 'generate', 'scaffold', 'implement', 'develop',
  'design', 'redesign', 'draft', 'add', 'write', 'append', 'insert', 'compose',
  'fix', 'repair', 'resolve', 'debug', 'patch', 'update', 'change', 'modify',
  'edit', 'revise', 'rewrite', 'refactor', 'rename', 'tweak', 'adjust',
  'delete', 'remove', 'drop', 'clear', 'purge', 'wipe', 'uninstall', 'revoke',
  'reset', 'deploy', 'ship', 'release', 'publish', 'promote', 'rollback',
  'revert', 'run', 'execute', 'exec', 'start', 'stop', 'restart', 'launch',
  'open', 'close', 'kill', 'send', 'email', 'share', 'post', 'forward',
  'submit', 'notify', 'message', 'dm', 'review', 'audit', 'check', 'inspect',
  'test', 'verify', 'validate', 'analyze', 'analyse', 'research', 'investigate',
  'summarize', 'summarise', 'document', 'commit', 'push', 'pull', 'merge',
  'rebase', 'fetch', 'clone', 'checkout', 'install', 'configure', 'setup',
  'enable', 'disable', 'connect', 'integrate', 'wire', 'provision', 'move',
  'copy', 'download', 'upload', 'import', 'export', 'migrate', 'sync', 'backup',
  'restore', 'optimize', 'optimise', 'format', 'lint', 'bump', 'compile',
  'package', 'bundle', 'render', 'plan', 'schedule', 'translate', 'convert',
  'replace', 'set',
]);

/** Pure thread-control phrases (whole message, after courtesy strip). */
const META_PHRASES: ReadonlySet<string> = new Set<string>([
  'stop', 'nvm', 'nevermind', 'never mind', 'cancel', 'cancel that', 'wait',
  'hold on', 'holdon', 'scratch that', 'undo', 'forget it', 'forget that',
  'forget about it', 'disregard', 'disregard that', 'abort', 'abort that',
  'start over', 'nvm then',
]);

// ── Multi-word anaphora patterns (deterministic; global, reset before use) ────

/** "the same" / "the same file" — anaphoric, needs a prior subject (not a list). */
const SAME_RE = /\bthe same\b(?: [a-z][a-z'-]*)?/g;
/** "the second one" / "the last option" / "the former" — ordinal, needs a prior LIST. */
const ORDINAL_RE =
  /\bthe (?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|last|latter|former|other|previous|next)(?: (?:one|option|item|choice|result|link|file|version|answer|approach))?\b/g;
/** "option 2" / "number 3" — ordinal, needs a prior LIST. */
const NUM_OPTION_RE = /\b(?:option|item|number|choice|step) #?\d{1,3}\b/g;

/** Lead-ask shapes for a questionless assistant turn. */
const ASK_LEAD_RE =
  /^(?:which|what|whats|who|whom|whose|where|when|why|how|should\s+i|do\s+you\s+want|would\s+you\s+like|would\s+you|could\s+you|can\s+you|do\s+you|are\s+you|is\s+it|pick|choose|select|let\s+me\s+know)\b/;

/** Interrogative lead: the message is itself a question, never a plain answer. */
const INTERROGATIVE_LEAD_RE =
  /^(?:what|whats|who|whom|whose|where|when|why|how|hows|which|whether|is|are|am|do|does|did|can|could|should|would|will|shall|may|might|have|has|had|was|were)\b/;

/** Correction cues that lead a refinement. */
const CORRECTION_STRONG_RE =
  /^(?:actually|instead|rather|correction|i\s+meant|i\s+mean|not\s+(?:that|this|quite))\b/;
const CORRECTION_NEG_RE = /^(?:no|nope|nah|wait)\b[\s,]+\S/;

/** Additive/sequence connectives that lead a continuation. */
const CONTINUATION_LEAD_RE =
  /^(?:also|and\s+also|and\s+then|then|next|after\s+that|afterwards?|plus|one\s+more|another|same\s+for|do\s+the\s+same|likewise|again)\b/;

// ── Secret-safe text cleaning ─────────────────────────────────────────────────

const HIDDEN = '[redacted]';

/**
 * True for injection / control / bidi / zero-width / line-separator code points
 * neutralized (→ space) before any span is emitted. Uses numeric ranges (no
 * regex literal) so the SOURCE stays free of the very invisible characters it
 * guards against. Keeps \t (0x09) \n (0x0a) \r (0x0d) for clause splitting.
 */
function isDangerousCode(c: number): boolean {
  return (
    (c >= 0x00 && c <= 0x08) // C0 controls (NUL..BS)
    || c === 0x0b || c === 0x0c
    || (c >= 0x0e && c <= 0x1f)
    || c === 0x7f // DEL
    || (c >= 0x80 && c <= 0x9f) // C1 controls (incl. NEL 0x85)
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
  try {
    let out = '';
    for (let i = 0; i < input.length; i += 1) {
      out += isDangerousCode(input.charCodeAt(i)) ? ' ' : input.charAt(i);
    }
    return out;
  } catch {
    return input;
  }
}

/** Prompt-fence / tag chars neutralized so a span can't break out of a block. */
const FENCE_RE = /[<>`]/g;

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
      s = s.replace(re, HIDDEN);
    }
  } catch {
    return input;
  }
  return s;
}

/** Does the whole (already control-stripped) string look like a secret VALUE? */
function looksLikeSecretValue(text: string): boolean {
  if (!text) return false;
  if (text.length > 40 && !/\s/.test(text)) return true; // long spaceless blob
  if (/eyJ[A-Za-z0-9_-]{8,}/.test(text)) return true; // JWT-ish
  if (/\b[A-Fa-f0-9]{32,}\b/.test(text)) return true; // long hex digest
  if (/[A-Za-z0-9+/]{40,}={0,2}/.test(text)) return true; // long base64 run
  if (/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/.test(text)) return true; // sk-ant-… style
  if (/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(text)) return true; // GitHub token
  if (/\bxox[bpsae]-[A-Za-z0-9-]{10,}/.test(text)) return true; // Slack token
  if (/\bAKIA[A-Z0-9]{12,}/.test(text)) return true; // AWS access key id
  if (/-----BEGIN[A-Z0-9 ]*PRIVATE KEY-----/.test(text)) return true; // PEM
  return false;
}

/**
 * Flatten any input into ONE bounded, secret-safe line: coerce scalars, strip
 * control/bidi/zero-width + fence chars, collapse whitespace, redact
 * secret-shaped tokens, guard a wholly value-shaped span, hard-clip to `max`.
 * Non-scalar / empty → ''. Total: never throws.
 */
function flatten(raw: unknown, max: number): string {
  try {
    let s: string;
    if (typeof raw === 'string') s = raw;
    else if (typeof raw === 'number' || typeof raw === 'boolean') s = String(raw);
    else return '';
    const capIn = Math.max(1, max) * 8;
    if (s.length > capIn) s = s.slice(0, capIn);
    s = stripDangerous(s).replace(FENCE_RE, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    s = redactSecrets(s);
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) return '';
    if (looksLikeSecretValue(s)) return HIDDEN;
    return s.length > max ? s.slice(0, max) : s;
  } catch {
    return '';
  }
}

/** Cleaned first non-empty line of a turn — a bounded, secret-safe re-grounding hint. */
function leadClause(text: string, max: number): string {
  try {
    let s = text.length > max * 8 ? text.slice(0, max * 8) : text;
    s = stripDangerous(s).replace(FENCE_RE, ' ');
    for (const line of s.split(/\r?\n/)) {
      const f = flatten(line, max);
      if (f) return f;
    }
    return '';
  } catch {
    return '';
  }
}

// ── Tokenization + boundary search ────────────────────────────────────────────

/** Split on any run of non-[a-z0-9] chars; input should be lowercased. Bounded. */
function tokenize(lower: string): string[] {
  const out: string[] = [];
  if (!lower) return out;
  try {
    for (const part of lower.split(/[^a-z0-9]+/)) {
      if (!part) continue;
      out.push(part);
      if (out.length >= MAX_TOKENS_SCANNED) break;
    }
  } catch {
    return out;
  }
  return out;
}

function isAlnumChar(ch: string): boolean {
  if (!ch) return false;
  return (
    (ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')
  );
}

/** First word-boundary index of `needle` (lowercased) in `hay` (lowercased). -1 if absent. */
function wordBoundaryIndex(hay: string, needle: string): number {
  if (!needle || !hay || needle.length > hay.length) return -1;
  let from = 0;
  for (let guard = 0; guard <= hay.length; guard += 1) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) return -1;
    const before = idx === 0 ? '' : hay.charAt(idx - 1);
    const afterPos = idx + needle.length;
    const after = afterPos >= hay.length ? '' : hay.charAt(afterPos);
    if (!isAlnumChar(before) && !isAlnumChar(after)) return idx;
    from = idx + 1;
    if (from > hay.length) return -1;
  }
  return -1;
}

/** Guarded global-regex sweep — collects matches; never throws; bounded. */
function scanAll(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  try {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null) {
      if (guard++ >= 200) break;
      out.push(m);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  } catch {
    return out;
  }
  return out;
}

/**
 * High-precision in-message antecedent test: a token counts as an antecedent
 * NOUN only when it's non-stopword, alphabetic (≥2), AND its previous token is
 * an article/determiner/possessive ("the post", "that file"). A bare verb
 * ("delete"/"fix") without a determiner is NOT a noun — this sidesteps the
 * incomplete-verb-set problem and keeps precision high.
 */
function hasArticleNoun(text: string): boolean {
  const toks = tokenize(text.toLowerCase());
  for (let i = 1; i < toks.length; i += 1) {
    const t = toks[i];
    if (STOPWORDS.has(t)) continue;
    if (t.length < 2 || !/^[a-z][a-z'-]*$/.test(t)) continue;
    if (DETERMINERS.has(toks[i - 1])) return true;
  }
  return false;
}

/** True when `t` reads as a concrete noun (for the demonstrative-determiner skip). */
function isConcreteNounToken(t: string): boolean {
  return (
    !!t &&
    t.length >= 3 &&
    /^[a-z][a-z'-]*$/.test(t) &&
    !STOPWORDS.has(t) &&
    !NEW_WORK_VERBS.has(t)
  );
}

// ── Lead / cue helpers ────────────────────────────────────────────────────────

/** Iteratively strip leading courtesy tokens. Total. */
function stripLeadingCourtesy(lower: string): string {
  let t = lower.trim();
  for (let i = 0; i < MAX_COURTESY_STRIPS; i += 1) {
    const m = t.match(/^([a-z]+)\b[\s,:!.\-]*/);
    if (!m || !COURTESY_TOKENS.has(m[1])) break;
    const next = t.slice(m[0].length);
    if (next === t) break;
    t = next;
  }
  return t.trim();
}

/** Normalized whole message for meta comparison (punctuation → space, courtesy stripped). */
function normalizeForMeta(lower: string): string {
  let s = lower.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < MAX_COURTESY_STRIPS; i += 1) {
    const sp = s.indexOf(' ');
    const head = sp < 0 ? s : s.slice(0, sp);
    if (!COURTESY_TOKENS.has(head)) break;
    s = sp < 0 ? '' : s.slice(sp + 1);
  }
  return s.trim();
}

function isMeta(lower: string): boolean {
  return META_PHRASES.has(normalizeForMeta(lower));
}

function leadsWithCorrection(lower: string): boolean {
  const t = stripLeadingCourtesy(lower);
  return CORRECTION_STRONG_RE.test(t) || CORRECTION_NEG_RE.test(t);
}

function leadsWithContinuation(lower: string): boolean {
  return CONTINUATION_LEAD_RE.test(stripLeadingCourtesy(lower));
}

// ── endsWithQuestion + question extraction ────────────────────────────────────

/** Cleaned, lowercased last sentence/line of a turn. */
function lastSentenceLower(s: string): string {
  let lastTerm = -1;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const c = s.charAt(i);
    if (c === '.' || c === '!' || c === '?' || c === '\n' || c === '\r') {
      if (s.slice(i + 1).trim()) {
        lastTerm = i;
        break;
      }
    }
  }
  return s.slice(lastTerm + 1).replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Does an assistant turn read as ending with a question? True when it ends with
 * '?' (after trimming trailing quotes/brackets) OR its last sentence LEADS with
 * a curated ask shape. Total: non-strings / junk → false.
 */
export function endsWithQuestion(text: unknown): boolean {
  try {
    if (typeof text !== 'string') return false;
    let s = text.length > MAX_TURN_CHARS ? text.slice(0, MAX_TURN_CHARS) : text;
    s = stripDangerous(s).replace(FENCE_RE, ' ').replace(/\s+/g, ' ').trim();
    if (!s) return false;
    const trimmed = s.replace(/[\s"'”’)\]]+$/, '');
    if (trimmed.endsWith('?')) return true;
    return ASK_LEAD_RE.test(lastSentenceLower(s));
  } catch {
    return false;
  }
}

/** Extract + clean the assistant's question sentence (called only when it IS one). */
function extractQuestion(raw: string): string {
  try {
    let s = raw.length > MAX_TURN_CHARS ? raw.slice(0, MAX_TURN_CHARS) : raw;
    s = stripDangerous(s).replace(FENCE_RE, ' ');
    const qIdx = s.lastIndexOf('?');
    let start = 0;
    let end = s.length;
    if (qIdx >= 0) {
      end = qIdx + 1;
      for (let i = qIdx - 1; i >= 0; i -= 1) {
        const c = s.charAt(i);
        if (c === '.' || c === '!' || c === '?' || c === '\n' || c === '\r') {
          start = i + 1;
          break;
        }
      }
    } else {
      let lastTerm = -1;
      for (let i = s.length - 1; i >= 0; i -= 1) {
        const c = s.charAt(i);
        if (c === '.' || c === '!' || c === '\n' || c === '\r') {
          if (s.slice(i + 1).trim()) {
            lastTerm = i;
            break;
          }
        }
      }
      start = lastTerm + 1;
    }
    return flatten(s.slice(start, end), MAX_QUESTION_LEN);
  } catch {
    return '';
  }
}

// ── Answer shape ──────────────────────────────────────────────────────────────

/** Whole message is essentially a bare yes/no (+ courtesy), ≤3 tokens. */
function isBareAffirmation(tokens: string[]): boolean {
  if (tokens.length === 0 || tokens.length > 3) return false;
  for (const t of tokens) {
    if (!AFFIRM_NEG.has(t) && !COURTESY_TOKENS.has(t)) return false;
  }
  return true;
}

/**
 * Does the current message read as an ANSWER to the prior question? A correction
 * lead is NOT an answer (it refines). Otherwise: an option echo of a distinctive
 * word from the question, OR a bare yes/no, OR an ordinal lead, OR a short value
 * that does not lead with a fresh-work imperative.
 */
function isAnswerShaped(
  lower: string,
  contentWordCount: number,
  priorQuestionTokens: ReadonlySet<string>,
): boolean {
  if (leadsWithCorrection(lower)) return false;
  const t = stripLeadingCourtesy(lower);
  const toks = tokenize(t);
  const first = toks.length ? toks[0] : '';

  // option echo of a distinctive question word
  if (first && first.length >= 3 && !STOPWORDS.has(first) && priorQuestionTokens.has(first)) {
    return true;
  }
  // bare yes/no
  if (isBareAffirmation(toks)) return true;
  // ordinal lead
  if (
    /^(?:the\s+)?(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|former|latter|other|previous|next|#?\d{1,3}(?:st|nd|rd|th)?)\b/.test(t) ||
    /^(?:option|number|item|choice)\s+#?\d{1,3}\b/.test(t)
  ) {
    return true;
  }
  // short value answer that is not itself a question and not a fresh imperative
  if (
    contentWordCount <= ANSWER_MAX_CONTENT_WORDS &&
    !NEW_WORK_VERBS.has(first) &&
    !INTERROGATIVE_LEAD_RE.test(t) &&
    !t.replace(/[\s"'”’)\]]+$/, '').endsWith('?')
  ) {
    return true;
  }
  return false;
}

// ── Referent detection ────────────────────────────────────────────────────────

interface ReferentInfo {
  referents: string[];
  /** At least one referent needs a prior LIST to resolve (ordinal/former/latter). */
  hasOrdinal: boolean;
}

function detectReferents(clean: string, lower: string, contentWordCount: number): ReferentInfo {
  const referents: string[] = [];
  const seen = new Set<string>();
  let hasOrdinal = false;
  try {
    const shortMsg = contentWordCount <= DANGLING_SHORT_CONTENT_WORDS;

    const tryAdd = (span: string, charPos: number, ordinal: boolean): void => {
      if (referents.length >= MAX_REFERENTS) return;
      if (charPos < 0) return;
      const before = clean.slice(0, charPos);
      if (hasArticleNoun(before)) return; // in-message antecedent exists
      const leadCount = tokenize(before.toLowerCase()).length;
      if (!shortMsg && leadCount > LEAD_WINDOW) return; // not short & doesn't lead
      const cleaned = flatten(span, MAX_REFERENT_LEN);
      if (!cleaned) return;
      const key = cleaned.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      referents.push(cleaned);
      if (ordinal) hasOrdinal = true;
    };

    // Multi-word anaphora first.
    for (const m of scanAll(SAME_RE, lower)) tryAdd(clean.slice(m.index, m.index + m[0].length), m.index, false);
    for (const m of scanAll(ORDINAL_RE, lower)) tryAdd(clean.slice(m.index, m.index + m[0].length), m.index, true);
    for (const m of scanAll(NUM_OPTION_RE, lower)) tryAdd(clean.slice(m.index, m.index + m[0].length), m.index, true);

    // Single-word pronouns (skip demonstratives acting as determiners).
    for (const p of PRONOUN_LIST) {
      if (referents.length >= MAX_REFERENTS) break;
      const idx = wordBoundaryIndex(lower, p);
      if (idx < 0) continue;
      if (DEMONSTRATIVES.has(p)) {
        const after = lower.slice(idx + p.length).replace(/^[^a-z0-9]+/, '');
        const nextTok = tokenize(after)[0] || '';
        if (isConcreteNounToken(nextTok)) continue; // "that file" → determiner
      }
      tryAdd(clean.slice(idx, idx + p.length), idx, false);
    }
  } catch {
    return { referents: capReferents(referents), hasOrdinal };
  }
  return { referents: capReferents(referents), hasOrdinal };
}

// ── Prior-window model ────────────────────────────────────────────────────────

function normalizeWindow(priorTurns: unknown): ContinuityTurn[] {
  if (!Array.isArray(priorTurns)) return [];
  const src =
    priorTurns.length > RAW_SCAN_CAP ? priorTurns.slice(priorTurns.length - RAW_SCAN_CAP) : priorTurns;
  const valid: ContinuityTurn[] = [];
  for (const entry of src) {
    let role: unknown;
    let text: unknown;
    try {
      if (!entry || typeof entry !== 'object') continue;
      role = (entry as { role?: unknown }).role;
      text = (entry as { text?: unknown }).text;
    } catch {
      continue; // hostile getter / proxy trap → skip this entry
    }
    if (role !== 'user' && role !== 'assistant') continue;
    if (typeof text !== 'string') continue;
    const clamped = text.length > MAX_TURN_CHARS ? text.slice(0, MAX_TURN_CHARS) : text;
    valid.push({ role, text: clamped });
  }
  return valid.length > MAX_PRIOR_TURNS ? valid.slice(valid.length - MAX_PRIOR_TURNS) : valid;
}

/** A turn carries a concrete subject when it has ≥1 non-stopword content token. */
function isSubjectBearing(text: string): boolean {
  const flat = flatten(text, MAX_TURN_CHARS);
  if (!flat) return false;
  for (const t of tokenize(flat.toLowerCase())) {
    if (!STOPWORDS.has(t)) return true;
  }
  return false;
}

/** Did an assistant turn present a list (enumeration markers or ≥2 alternatives)? */
function presentsList(text: string): boolean {
  try {
    const s = stripDangerous(text.length > MAX_TURN_CHARS ? text.slice(0, MAX_TURN_CHARS) : text);
    let markers = 0;
    for (const line of s.split(/\r?\n/)) {
      if (/^\s*(?:\d{1,3}[.)]|[a-z][.)]|[-*•])\s+\S/i.test(line)) {
        markers += 1;
        if (markers >= 2) return true;
      }
    }
    const lower = s.toLowerCase();
    const orCount = (lower.match(/\bor\b/g) || []).length;
    if (orCount >= 2) return true;
    if (orCount >= 1 && lower.indexOf('?') >= 0) return true;
    return false;
  } catch {
    return false;
  }
}

function mostRecentSubjectBearing(window: ContinuityTurn[]): ContinuityTurn | null {
  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (isSubjectBearing(window[i].text)) return window[i];
  }
  return null;
}

function mostRecentAssistantList(window: ContinuityTurn[]): ContinuityTurn | null {
  for (let i = window.length - 1; i >= 0; i -= 1) {
    if (window[i].role === 'assistant' && presentsList(window[i].text)) return window[i];
  }
  return null;
}

// ── Frame builders ────────────────────────────────────────────────────────────

function capReferents(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    const c = flatten(r, MAX_REFERENT_LEN);
    if (!c) continue;
    const key = c.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= MAX_REFERENTS) break;
  }
  return out;
}

function sanitizeReason(reason: unknown): string {
  const s = (typeof reason === 'string' ? reason : '').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40);
  return s || 'unknown';
}

function frame(
  relation: TurnRelation,
  carriesForward: boolean,
  answersPriorQuestion: boolean,
  priorQuestionText: string,
  danglingReferents: string[],
  resolvable: boolean,
  antecedentHint: string,
  reason: string,
): TurnContinuityFrame {
  return {
    relation: RELATION_SET.has(relation) ? relation : 'new-topic',
    carriesForward: carriesForward === true,
    answersPriorQuestion: answersPriorQuestion === true,
    priorQuestionText: flatten(priorQuestionText, MAX_QUESTION_LEN),
    danglingReferents: capReferents(danglingReferents),
    resolvable: resolvable === true,
    antecedentHint: flatten(antecedentHint, MAX_HINT_LEN),
    reason: sanitizeReason(reason),
  };
}

function neutral(reason: string): TurnContinuityFrame {
  return frame('new-topic', false, false, '', [], false, '', reason);
}

/**
 * Attach resolvability to a carries-forward relation: an ordinal referent needs
 * a prior assistant LIST turn; any other referent/continuation/refinement needs
 * a prior subject-bearing turn. antecedentHint = that turn's lead clause.
 */
function withResolvability(
  relation: TurnRelation,
  referentInfo: ReferentInfo,
  window: ContinuityTurn[],
  reason: string,
): TurnContinuityFrame {
  let resolvable = false;
  let hint = '';
  if (referentInfo.hasOrdinal) {
    const listTurn = mostRecentAssistantList(window);
    if (listTurn) {
      resolvable = true;
      hint = leadClause(listTurn.text, MAX_HINT_LEN);
    }
  } else {
    const subj = mostRecentSubjectBearing(window);
    if (subj) {
      resolvable = true;
      hint = leadClause(subj.text, MAX_HINT_LEN);
    }
  }
  return frame(relation, true, false, '', referentInfo.referents, resolvable, hint, reason);
}

// ── Exports ───────────────────────────────────────────────────────────────────

/**
 * Classify how the CURRENT message relates to the PRIOR turns and what it
 * depends on. Pure, deterministic, total. Decision order (conservative toward
 * 'new-topic'): meta → answer → refinement → continuation → dangling-referent →
 * new-topic. A dangling-referent-only message is labeled 'continuation' (it
 * continues the thread by pointing back at it) with its referents populated.
 */
export function resolveTurnContinuity(currentMessage: unknown, priorTurns: unknown): TurnContinuityFrame {
  try {
    const window = normalizeWindow(priorTurns);

    const rawMsg = typeof currentMessage === 'string'
      ? (currentMessage.length > MAX_MESSAGE_CHARS ? currentMessage.slice(0, MAX_MESSAGE_CHARS) : currentMessage)
      : '';
    const clean = flatten(rawMsg, MAX_MESSAGE_CHARS);
    if (!clean) return neutral('empty');
    const lower = clean.toLowerCase();
    const tokens = tokenize(lower);
    let contentWordCount = 0;
    for (const t of tokens) if (!STOPWORDS.has(t)) contentWordCount += 1;

    // 1) meta — pure thread-control.
    if (isMeta(lower)) {
      return frame('meta', false, false, '', [], false, '', 'meta-control');
    }

    // 2) answer — the immediately-preceding assistant turn asked, and this reads
    //    as an answer.
    const lastTurn = window.length ? window[window.length - 1] : null;
    const priorIsQuestion = !!lastTurn && lastTurn.role === 'assistant' && endsWithQuestion(lastTurn.text);
    if (priorIsQuestion && lastTurn) {
      const priorQ = extractQuestion(lastTurn.text);
      const qTokens = new Set(tokenize(priorQ.toLowerCase()));
      if (isAnswerShaped(lower, contentWordCount, qTokens)) {
        return frame('answer', true, true, priorQ, [], true, priorQ, 'answers-prior-question');
      }
    }

    const referentInfo = detectReferents(clean, lower, contentWordCount);

    // 3) refinement — leads with a correction cue.
    if (leadsWithCorrection(lower)) {
      return withResolvability('refinement', referentInfo, window, 'refinement-cue');
    }
    // 4) continuation — leads with an additive/sequence connective.
    if (leadsWithContinuation(lower)) {
      return withResolvability('continuation', referentInfo, window, 'continuation-cue');
    }
    // 5) dangling-referent — a deictic with no in-message antecedent.
    if (referentInfo.referents.length > 0) {
      return withResolvability('continuation', referentInfo, window, 'dangling-referent');
    }

    // 6) new-topic — self-contained; does not depend on prior turns.
    return neutral('new-topic');
  } catch {
    return neutral('error');
  }
}

/**
 * The precise drop-in for `messages.length >= 2`: true iff the current message
 * carries forward AND the thread plausibly supplies the antecedent. When false
 * on a carries-forward message, the caller should ASK rather than guess. Total.
 */
export function carriesThreadContext(currentMessage: unknown, priorTurns: unknown): boolean {
  try {
    const f = resolveTurnContinuity(currentMessage, priorTurns);
    return f.carriesForward === true && f.resolvable === true;
  } catch {
    return false;
  }
}
