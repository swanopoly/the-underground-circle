// responseRegisterCore — the PURE, per-turn RESPONSE-REGISTER decision: how the
// ASSISTANT's answer should be shaped THIS turn (verbosity + format + explain-vs-do
// + formality), emitted as one compact, imperative system-prompt directive.
//
// Why this exists: the only response-shaping signal in the SwanBot prompt today is
// userChatProfile.generateProfileContext — a slow, AGGREGATE, DESCRIPTIVE "## User
// Profile" block ("Prefers detailed responses") that needs 3+ messages, is IMPURE
// (new Date + AsyncStorage), and averages symmetrically and slowly. It ignores every
// PER-TURN signal: an explicit inline directive in the CURRENT message ("just the
// code", "keep it short", "explain step by step", "as bullet points"); prior-turn
// corrective FEEDBACK ("that was too long", "give me more detail", "stop explaining,
// just do it") — after which the model's attention fades and the next fresh turn
// silently reverts; and the current message's own terse-vs-detailed / expert-vs-
// novice / code-density style. There is also a clean ASYMMETRY: contextDepthPolicy
// gives users an INPUT dial (how much CONTEXT loads) but there is NO OUTPUT dial for
// how the ANSWER is shaped. This core is the fast per-turn OUTPUT dial.
//
// It COMPOSES with (does not duplicate) the aggregate profile: the profile becomes
// the low-priority `profileHint` default; this core's fast per-turn signals override
// it. Deterministic precedence: (1) explicit inline directive > (2) sticky session
// preference > (3) prior-turn corrective feedback > (4) current-message style/
// expertise inference > (5) profileHint (the aggregate profile, read STRUCTURALLY —
// never imported) > (6) neutral default. The neutral default (normal/auto/auto/
// neutral) yields an EMPTY `directive` → a byte-identical no-op section, exactly like
// contextDepthPolicy's 'standard' identity and conversationComplexityFloorCore's null.
//
// PURITY / SAFETY CONTRACT (load-bearing — the smoke runs under tsx/esbuild, which
// cannot load react-native/supabase):
//  - TYPE-ONLY imports; no runtime import at all. tsx-loadable.
//  - Every export is TOTAL: never throws on null / undefined / wrong-type / huge /
//    bigint / cyclic / proxy / hostile input — returns a safe neutral value.
//  - DETERMINISTIC: no Date.now / Math.random / argless `new Date`; frozen maps/sets;
//    object-map lookups guarded via Object.prototype.hasOwnProperty.call vs
//    "__proto__"/"constructor"; code-POINT-aware text (a UTF-16 pre-slice never splits
//    a surrogate pair; the sanitize chokepoint strips lone surrogates).
//  - BOUNDED: exported MAX_* caps clamp every string / scanned window / word count.
//  - SECRET-SAFE: the user's message text is NEVER echoed into the directive/output —
//    only FIXED register labels are emitted; control / line-sep / prompt-fence chars
//    are stripped at the sanitize chokepoint.
//
// Storage (sticky pref) follows the contextDepthPolicy house pattern EXACTLY: a
// module-scoped session override plus web localStorage behind try/catch (fail-soft to
// null on native/node).
//
// Smoke: scripts/response-register-core-smoketest.ts

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ResponseVerbosity = 'terse' | 'brief' | 'normal' | 'detailed';
export type ResponseFormat = 'prose' | 'bullets' | 'code_first' | 'auto';
export type ResponsePosture = 'just_do' | 'explain' | 'auto';
export type ResponseFormality = 'casual' | 'neutral' | 'formal';
export type ResponseRegisterSource =
  | 'explicit'
  | 'sticky'
  | 'feedback'
  | 'message_style'
  | 'profile'
  | 'default';

export interface ResponseRegister {
  verbosity: ResponseVerbosity;
  format: ResponseFormat;
  posture: ResponsePosture;
  formality: ResponseFormality;
  /** Which precedence layer won. 'default' ⇒ neutral register ⇒ empty directive. */
  source: ResponseRegisterSource;
  /** Compact imperative system-prompt line, or '' for the neutral no-op. */
  directive: string;
}

/** The four steerable axes only (no source/directive). The sticky-pref shape. */
export type ResponseRegisterPreference = Partial<
  Pick<ResponseRegister, 'verbosity' | 'format' | 'posture' | 'formality'>
>;

export interface ResolveResponseRegisterInput {
  /** The current user message (string; an object with `content`/`text` is tolerated). */
  currentMessage?: unknown;
  /** Prior conversation turns (chronological). Any hostile shape tolerated. */
  priorMessages?: unknown;
  /** Reserved surface hint (chat/office/…); accepted and ignored today. */
  surface?: unknown;
  /** Explicit sticky preference; when absent, the stored preference is used. */
  sticky?: unknown;
  /** Aggregate userChatProfile fields, read structurally (NOT imported). */
  profileHint?: unknown;
}

// ---------------------------------------------------------------------------
// Bounds (exported so callers/tests can reason about the caps)
// ---------------------------------------------------------------------------

/** Per-turn text actually scanned (message + each prior turn). */
export const MAX_ANALYZE_CHARS = 20_000;
/** Never scan an unbounded history tail to find the recent user turns. */
export const MAX_PRIOR_SCAN = 100;
/** Word count is clamped here before any threshold comparison. */
export const MAX_WORDS = 5_000;
/** The emitted directive is clamped to this many code points. */
export const MAX_DIRECTIVE_CHARS = 280;
/** The status line is clamped to this many code points. */
export const MAX_STATUS_CHARS = 240;
/** Raw command/preference strings are clamped before parsing. */
export const MAX_COMMAND_CHARS = 400;

// Internal bounds (implementation detail).
const MAX_FEEDBACK_TURNS = 2;
const SHORT_IMPERATIVE_WORDS = 3;
const LONG_WORDS = 60;
const ELLIPSIS = String.fromCharCode(0x2026); // '…' — built, never a raw literal

// ---------------------------------------------------------------------------
// Frozen validation sets (Set.has is pollution-safe: `.has('__proto__')` never
// walks the prototype chain, so no hasOwnProperty guard is needed for these).
// ---------------------------------------------------------------------------

const VERBOSITY_SET: ReadonlySet<string> = new Set(['terse', 'brief', 'normal', 'detailed']);
const FORMAT_SET: ReadonlySet<string> = new Set(['prose', 'bullets', 'code_first', 'auto']);
const POSTURE_SET: ReadonlySet<string> = new Set(['just_do', 'explain', 'auto']);
const FORMALITY_SET: ReadonlySet<string> = new Set(['casual', 'neutral', 'formal']);

const VERBOSITY_ORDER: readonly ResponseVerbosity[] = ['terse', 'brief', 'normal', 'detailed'];

function isVerbosity(v: unknown): v is ResponseVerbosity {
  return typeof v === 'string' && VERBOSITY_SET.has(v);
}
function isFormat(v: unknown): v is ResponseFormat {
  return typeof v === 'string' && FORMAT_SET.has(v);
}
function isPosture(v: unknown): v is ResponsePosture {
  return typeof v === 'string' && POSTURE_SET.has(v);
}
function isFormality(v: unknown): v is ResponseFormality {
  return typeof v === 'string' && FORMALITY_SET.has(v);
}

interface Axes {
  verbosity: ResponseVerbosity;
  format: ResponseFormat;
  posture: ResponsePosture;
  formality: ResponseFormality;
}

const NEUTRAL_AXES: Readonly<Axes> = Object.freeze({
  verbosity: 'normal',
  format: 'auto',
  posture: 'auto',
  formality: 'neutral',
});

function neutralRegister(source: ResponseRegisterSource): ResponseRegister {
  return { verbosity: 'normal', format: 'auto', posture: 'auto', formality: 'neutral', source, directive: '' };
}

function isNeutralPartial(p: ResponseRegisterPreference | null | undefined): boolean {
  if (!p) return true;
  return (
    (!isVerbosity(p.verbosity) || p.verbosity === 'normal') &&
    (!isFormat(p.format) || p.format === 'auto') &&
    (!isPosture(p.posture) || p.posture === 'auto') &&
    (!isFormality(p.formality) || p.formality === 'neutral')
  );
}

/** Overlay a (possibly hostile) partial onto neutral, validating every axis. */
function overlay(base: Axes, p: ResponseRegisterPreference | null | undefined): Axes {
  return {
    verbosity: p && isVerbosity(p.verbosity) ? p.verbosity : base.verbosity,
    format: p && isFormat(p.format) ? p.format : base.format,
    posture: p && isPosture(p.posture) ? p.posture : base.posture,
    formality: p && isFormality(p.formality) ? p.formality : base.formality,
  };
}

// ---------------------------------------------------------------------------
// Code-point-aware primitives (never split a surrogate pair; never throw)
// ---------------------------------------------------------------------------

function isLoneSurrogate(cp: number): boolean {
  return cp >= 0xd800 && cp <= 0xdfff;
}

/** Zero-width + bidi controls + word-joiner + BOM (trojan-source smuggling). */
function isFormatChar(cp: number): boolean {
  return (
    cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0x200e || cp === 0x200f ||
    cp === 0x2060 || cp === 0xfeff ||
    (cp >= 0x202a && cp <= 0x202e) ||
    (cp >= 0x2066 && cp <= 0x2069)
  );
}

/** Control / DEL / C1 / line-separator / Unicode-Tag smuggling code points. */
function isControlChar(cp: number): boolean {
  return (
    cp < 0x20 || cp === 0x7f ||
    (cp >= 0x80 && cp <= 0x9f) ||
    cp === 0x2028 || cp === 0x2029 ||
    (cp >= 0xe0000 && cp <= 0xe007f)
  );
}

/** Count code points (bounded by the string length). */
function codePointLen(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i) as number;
    i += cp > 0xffff ? 2 : 1;
    n += 1;
  }
  return n;
}

/** Keep the first `maxCp` code points, appending an ellipsis when truncated. */
function clampCodePoints(s: string, maxCp: number): string {
  if (maxCp <= 0) return '';
  let out = '';
  let n = 0;
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i) as number;
    const wide = cp > 0xffff;
    if (n >= maxCp) return out + ELLIPSIS;
    out += wide ? String.fromCodePoint(cp) : s[i];
    n += 1;
    i += wide ? 2 : 1;
  }
  return out;
}

/**
 * UTF-16 prefix that never cuts a surrogate pair: keep at most `maxUnits` code
 * units, backing off by one if that would split a high surrogate from its low.
 */
function safePrefix(s: string, maxUnits: number): string {
  if (s.length <= maxUnits) return s;
  let end = maxUnits;
  const code = s.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1; // trailing high surrogate → drop it
  return s.slice(0, end < 0 ? 0 : end);
}

/**
 * The single sanitize CHOKEPOINT for every emitted label/directive/status: strip
 * control / DEL / C1 / line-sep / Unicode-Tag / format (zero-width, bidi) / lone
 * surrogate / backtick / angle brackets, collapse whitespace, trim, and clamp to
 * `maxCp` code points (so the emitted .length stays within 2*maxCp + 1). Non-string
 * -> ''. Because callers pass only FIXED labels this is normally a no-op, but it
 * guarantees the invariant holds against any future edit or hostile echo.
 */
function sanitizeText(input: unknown, maxCp: number): string {
  if (typeof input !== 'string' || input.length === 0) return '';
  const src = input.length > maxCp * 8 ? safePrefix(input, maxCp * 8) : input;
  let out = '';
  for (let i = 0; i < src.length; ) {
    const cp = src.codePointAt(i) as number;
    const wide = cp > 0xffff;
    if (
      !isLoneSurrogate(cp) && !isControlChar(cp) && !isFormatChar(cp) &&
      cp !== 0x60 /* ` */ && cp !== 0x3c /* < */ && cp !== 0x3e /* > */
    ) {
      out += wide ? String.fromCodePoint(cp) : src[i];
    }
    i += wide ? 2 : 1;
  }
  out = out.replace(/[ \t\f\r\n]+/g, ' ').trim();
  if (codePointLen(out) > maxCp) out = clampCodePoints(out, maxCp - 1) + ELLIPSIS;
  return out;
}

// ---------------------------------------------------------------------------
// Safe accessors (handle throwing getters / non-objects; never String() a proxy)
// ---------------------------------------------------------------------------

function safeGet(obj: unknown, key: string): unknown {
  try {
    if (obj == null) return undefined;
    const t = typeof obj;
    if (t !== 'object' && t !== 'function') return undefined;
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/** Guarded object-map lookup (safe vs "__proto__"/"constructor"/"toString" keys). */
function ownLookup<T>(map: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

/** Coerce a message-ish input to safe, bounded, lowercased analysis text. */
function readMessageText(v: unknown): string {
  try {
    let s: unknown = v;
    if (v && typeof v === 'object') {
      const c = safeGet(v, 'content');
      s = typeof c === 'string' ? c : safeGet(v, 'text');
    }
    if (typeof s !== 'string' || s.length === 0) return '';
    return safePrefix(s, MAX_ANALYZE_CHARS).toLowerCase();
  } catch {
    return '';
  }
}

function countWords(t: string): number {
  const parts = t.split(/\s+/);
  let n = 0;
  for (const p of parts) if (p) n += 1;
  return n > MAX_WORDS ? MAX_WORDS : n;
}

function stepVerbosity(v: ResponseVerbosity, delta: number): ResponseVerbosity {
  const i = VERBOSITY_ORDER.indexOf(v);
  const base = i < 0 ? 2 : i; // unknown -> 'normal'
  let j = base + (typeof delta === 'number' && isFinite(delta) ? delta : 0);
  if (j < 0) j = 0;
  if (j > VERBOSITY_ORDER.length - 1) j = VERBOSITY_ORDER.length - 1;
  return VERBOSITY_ORDER[j];
}

// ---------------------------------------------------------------------------
// Command / natural-phrase token table (frozen; looked up with ownLookup)
// ---------------------------------------------------------------------------

const NEUTRAL_TOKEN: ResponseRegisterPreference = Object.freeze({
  verbosity: 'normal',
  format: 'auto',
  posture: 'auto',
  formality: 'neutral',
});

const TOKEN_PARTIALS: Readonly<Record<string, ResponseRegisterPreference>> = Object.freeze({
  brief: { verbosity: 'brief' },
  concise: { verbosity: 'brief' },
  short: { verbosity: 'terse' },
  terse: { verbosity: 'terse' },
  tldr: { verbosity: 'terse' },
  detail: { verbosity: 'detailed', posture: 'explain' },
  detailed: { verbosity: 'detailed', posture: 'explain' },
  thorough: { verbosity: 'detailed', posture: 'explain' },
  explain: { verbosity: 'detailed', posture: 'explain' },
  code: { format: 'code_first', posture: 'just_do' },
  prose: { format: 'prose' },
  bullets: { format: 'bullets' },
  bullet: { format: 'bullets' },
  list: { format: 'bullets' },
  casual: { formality: 'casual' },
  formal: { formality: 'formal' },
  professional: { formality: 'formal' },
  normal: NEUTRAL_TOKEN,
  standard: NEUTRAL_TOKEN,
  auto: NEUTRAL_TOKEN,
  reset: NEUTRAL_TOKEN,
  off: NEUTRAL_TOKEN,
  clear: NEUTRAL_TOKEN,
  default: NEUTRAL_TOKEN,
});

// ---------------------------------------------------------------------------
// Explicit inline directive parser (layer 1; also the natural-phrase path of
// parseResponseRegisterCommand). Ordered rules; the FIRST rule to set an axis
// wins, so combinations resolve deterministically.
// ---------------------------------------------------------------------------

interface DirectiveRule {
  re: RegExp;
  set: ResponseRegisterPreference;
}

// Note: no rule contains a raw line separator; apostrophes accept ' and the
// curly variant. The user's text is only TESTED, never echoed.
const DIRECTIVE_RULES: readonly DirectiveRule[] = [
  // Code-only (strong exclusivity marker) -> lead with code, no preamble, terse.
  { re: /\b(?:just|only)\s+(?:me\s+)?(?:the\s+)?code\b/, set: { format: 'code_first', posture: 'just_do', verbosity: 'terse' } },
  { re: /\bthe\s+code\s+only\b/, set: { format: 'code_first', posture: 'just_do', verbosity: 'terse' } },
  { re: /\bcode[-\s]?only\b/, set: { format: 'code_first', posture: 'just_do', verbosity: 'terse' } },
  // No preamble / no explanation -> just do it.
  { re: /\bno\s+(?:preamble|explanation|explanations|commentary|intro|prose|fluff|yapping|filler|chatter)\b/, set: { posture: 'just_do' } },
  { re: /\b(?:skip|without|no\s+need\s+for)\s+(?:the\s+)?(?:preamble|explanation|intro|commentary)\b/, set: { posture: 'just_do' } },
  { re: /\bdon['’]?t\s+explain\b/, set: { posture: 'just_do' } },
  // One line / one word -> terse.
  { re: /\bone[-\s](?:line|liner|sentence|word)\b/, set: { verbosity: 'terse' } },
  { re: /\bsingle\s+(?:line|sentence)\b/, set: { verbosity: 'terse' } },
  { re: /\bin\s+a\s+(?:word|sentence)\b/, set: { verbosity: 'terse' } },
  // tl;dr / short version -> brief.
  { re: /\btl[;:]?dr\b/, set: { verbosity: 'brief' } },
  { re: /\b(?:in\s+short|short\s+version|the\s+gist|quick\s+version|quick\s+answer)\b/, set: { verbosity: 'brief' } },
  { re: /\b(?:keep\s+it\s+(?:short|brief|concise|tight)|be\s+(?:brief|concise|succinct|short|quick)|make\s+it\s+(?:short|brief|quick)|briefly|concisely|short\s+answer|shorter)\b/, set: { verbosity: 'brief' } },
  // Bullets / prose format.
  { re: /\b(?:bullet\s*points?|as\s+bullets?|in\s+bullets?|bulleted|as\s+a\s+(?:bulleted\s+)?list|as\s+a\s+numbered\s+list|numbered\s+list|point\s+form|dot\s+points)\b/, set: { format: 'bullets' } },
  { re: /\b(?:in\s+prose|as\s+prose|paragraph\s+form|in\s+paragraphs|no\s+bullets|not\s+a\s+list|full\s+sentences)\b/, set: { format: 'prose' } },
  // ELI5 / simple -> detailed + explain + casual.
  { re: /\b(?:eli5|explain\s+like\s+i['’]?m\s+(?:5|five)|like\s+i['’]?m\s+(?:5|five)|in\s+simple\s+terms|in\s+plain\s+(?:english|terms)|dumb\s+it\s+down|for\s+a\s+beginner|for\s+beginners)\b/, set: { verbosity: 'detailed', posture: 'explain', formality: 'casual' } },
  // Step-by-step / detailed / explain.
  { re: /\b(?:step[-\s]by[-\s]step|walk\s+me\s+through|in\s+detail|detailed|elaborate|go\s+deep(?:er)?|be\s+thorough|thorough(?:ly)?|in\s+depth|comprehensive|explain\s+(?:it|this|that)?\s*(?:in\s+)?(?:more\s+)?(?:detail|thoroughly)|explain\s+step)\b/, set: { verbosity: 'detailed', posture: 'explain' } },
  // Posture: just do it.
  { re: /\b(?:just\s+do\s+(?:it|this|that)|just\s+go\s+ahead|no\s+questions|don['’]?t\s+ask|stop\s+asking)\b/, set: { posture: 'just_do' } },
  // Formality.
  { re: /\b(?:be\s+formal|formally|formal\s+tone|professional\s+tone|be\s+professional|in\s+a\s+professional\s+(?:tone|manner))\b/, set: { formality: 'formal' } },
  { re: /\b(?:be\s+casual|casually|casual\s+tone|keep\s+it\s+casual|informal|relaxed\s+tone)\b/, set: { formality: 'casual' } },
];

/** Parse explicit inline style directives from already-lowercased message text. */
function parseExplicitDirective(messageLower: string): ResponseRegisterPreference | null {
  if (!messageLower) return null;
  const acc: ResponseRegisterPreference = {};
  let hit = false;
  for (const rule of DIRECTIVE_RULES) {
    if (!rule.re.test(messageLower)) continue;
    const s = rule.set;
    if (s.verbosity !== undefined && acc.verbosity === undefined) { acc.verbosity = s.verbosity; hit = true; }
    if (s.format !== undefined && acc.format === undefined) { acc.format = s.format; hit = true; }
    if (s.posture !== undefined && acc.posture === undefined) { acc.posture = s.posture; hit = true; }
    if (s.formality !== undefined && acc.formality === undefined) { acc.formality = s.formality; hit = true; }
  }
  return hit ? acc : null;
}

// ---------------------------------------------------------------------------
// Prior-turn corrective feedback (layer 3)
// ---------------------------------------------------------------------------

const FEEDBACK_SHORTER_RE = /\b(?:too\s+long|too\s+verbose|too\s+wordy|way\s+too\s+long|so\s+long|much\s+too\s+long|too\s+much\s+(?:text|detail|explanation|info)|wall\s+of\s+text|shorter|be\s+shorter|less\s+(?:detail|text|verbose|words)|cut\s+it\s+down|trim\s+(?:it|this)\s+down|tl[;:]?dr|stop\s+explaining|stop\s+yapping|quit\s+explaining|no\s+more\s+explaining|less\s+explanation)\b/;
const FEEDBACK_LONGER_RE = /\b(?:too\s+short|too\s+brief|too\s+terse|not\s+enough\s+detail|more\s+detail|more\s+detailed|more\s+thorough|elaborate|explain\s+more|go\s+deeper|expand\s+on|flesh\s+(?:it|this)\s+out|give\s+me\s+more|not\s+enough)\b/;
const FEEDBACK_JUSTDO_RE = /\b(?:stop\s+explaining|stop\s+yapping|quit\s+explaining|no\s+more\s+explaining|just\s+do\s+(?:it|this|that)|stop\s+asking|quit\s+asking|too\s+much\s+explanation|less\s+explanation)\b/;
const FEEDBACK_EXPLAIN_RE = /\b(?:i\s+don['’]?t\s+understand|didn['’]?t\s+(?:explain|make\s+sense)|explain\s+your|show\s+your\s+(?:work|reasoning)|why\s+did\s+you)\b/;
const FEEDBACK_BULLETS_RE = /\b(?:use\s+bullets|in\s+bullets|as\s+bullets|bullet\s*points?|make\s+it\s+a\s+list|as\s+a\s+list)\b/;

interface FeedbackAdjustment {
  delta: number;
  forcePosture?: ResponsePosture;
  forceFormat?: ResponseFormat;
}

/** Collect the most-recent user turn text (lowercased), tolerating hostile shapes. */
function mostRecentUserTurnText(input: unknown): string {
  if (!Array.isArray(input)) return '';
  const stop = input.length - MAX_PRIOR_SCAN;
  const floor = stop > 0 ? stop : 0;
  let seen = 0;
  for (let i = input.length - 1; i >= floor; i -= 1) {
    const item = input[i];
    if (!item || typeof item !== 'object') continue;
    const role = safeGet(item, 'role');
    const isUser = role === 'user' || role === 'human' || safeGet(item, 'isUser') === true;
    if (!isUser) continue;
    let content = safeGet(item, 'content');
    if (typeof content !== 'string') content = safeGet(item, 'text');
    seen += 1;
    if (typeof content === 'string' && content.trim()) {
      return safePrefix(content, MAX_ANALYZE_CHARS).toLowerCase();
    }
    if (seen >= MAX_FEEDBACK_TURNS) break;
  }
  return '';
}

function detectFeedbackAdjustment(priorMessages: unknown): FeedbackAdjustment | null {
  const t = mostRecentUserTurnText(priorMessages);
  if (!t) return null;
  const justdo = FEEDBACK_JUSTDO_RE.test(t);
  const shorter = FEEDBACK_SHORTER_RE.test(t);
  const longer = FEEDBACK_LONGER_RE.test(t);
  const explain = FEEDBACK_EXPLAIN_RE.test(t);
  const bullets = FEEDBACK_BULLETS_RE.test(t);

  let delta = 0;
  if (shorter) delta = -1;
  else if (longer || explain) delta = 1;

  let forcePosture: ResponsePosture | undefined;
  if (justdo) forcePosture = 'just_do';
  else if (explain || longer) forcePosture = 'explain';

  const forceFormat: ResponseFormat | undefined = bullets ? 'bullets' : undefined;

  if (delta === 0 && forcePosture === undefined && forceFormat === undefined) return null;
  return { delta, forcePosture, forceFormat };
}

function applyFeedback(base: Axes, fb: FeedbackAdjustment): Axes {
  // A corrective step must never land on 'normal': that axis has no rendered
  // VERBOSITY_CLAUSE, so a shorter-correction on a 'detailed' base (verbose profile
  // or a long current message) would collapse to the byte-identical no-op directive
  // '' — the exact silent-revert this feedback layer exists to prevent, and precisely
  // when the answer WAS long. Skip past 'normal' one more step in the feedback direction.
  let verbosity = stepVerbosity(base.verbosity, fb.delta);
  if (verbosity === 'normal' && fb.delta !== 0) {
    verbosity = stepVerbosity(verbosity, fb.delta > 0 ? 1 : -1); // detailed->brief, brief->detailed
  }
  return {
    verbosity,
    format: fb.forceFormat && isFormat(fb.forceFormat) ? fb.forceFormat : base.format,
    posture: fb.forcePosture && isPosture(fb.forcePosture) ? fb.forcePosture : base.posture,
    formality: base.formality,
  };
}

// ---------------------------------------------------------------------------
// Current-message style / expertise inference (layer 4) — deliberately
// CONSERVATIVE: a plain question yields null so it falls through to default.
// ---------------------------------------------------------------------------

const FENCE_RE = /```|~~~/;
const CODE_TASK_RE = /\b(?:fix|refactor|debug|rewrite|optimi[sz]e|implement|add|change|update|convert|migrate)\b/;
const SHORT_ACTION_VERB_RE = /^(?:please\s+)?(?:fix|refactor|debug|implement|build|create|add|make|change|update|remove|delete|rename|move|convert|optimi[sz]e|rewrite|generate|install|deploy|run)\b/;
const NOVICE_RE = /\b(?:i['’]?m\s+(?:new|a\s+beginner|a\s+novice|just\s+starting|not\s+technical|not\s+a\s+(?:dev|developer|coder|programmer))|new\s+to\s+(?:this|coding|programming|react|js|javascript|python|it)|as\s+a\s+beginner|complete\s+beginner|i['’]?m\s+learning)\b/;

function inferMessageStyle(messageLower: string): ResponseRegisterPreference | null {
  const t = messageLower.trim();
  if (!t) return null;
  const words = countWords(t);
  if (FENCE_RE.test(t) && CODE_TASK_RE.test(t)) return { format: 'code_first', verbosity: 'brief' };
  if (NOVICE_RE.test(t)) return { verbosity: 'detailed', posture: 'explain', formality: 'casual' };
  if (words <= SHORT_IMPERATIVE_WORDS && SHORT_ACTION_VERB_RE.test(t)) return { verbosity: 'brief' };
  if (words > LONG_WORDS) return { verbosity: 'detailed' };
  return null;
}

// ---------------------------------------------------------------------------
// profileHint (layer 5) — the aggregate userChatProfile, read STRUCTURALLY.
// ---------------------------------------------------------------------------

function readProfileHint(hint: unknown): ResponseRegisterPreference | null {
  try {
    if (!hint || typeof hint !== 'object') return null;
    const out: ResponseRegisterPreference = {};
    const prl = safeGet(hint, 'preferredResponseLength');
    if (prl === 'brief') out.verbosity = 'brief';
    else if (prl === 'thorough') out.verbosity = 'detailed';
    // 'detailed' is userChatProfile's MIDDLE/default -> leave neutral (no directive).
    if (safeGet(hint, 'prefersStructuredOutput') === true) out.format = 'bullets';
    const tone = safeGet(hint, 'preferredTone');
    if (tone === 'casual') out.formality = 'casual';
    else if (tone === 'professional') out.formality = 'formal';
    // 'technical' -> neutral.
    return isNeutralPartial(out) ? null : out;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Directive + status rendering (FIXED labels only — never echoes user text)
// ---------------------------------------------------------------------------

const DIRECTIVE_PREFIX = 'Response style this turn: ';

const VERBOSITY_CLAUSE: Readonly<Record<string, string>> = Object.freeze({
  terse: 'answer in one or two lines',
  brief: 'be concise',
  detailed: 'give a thorough, detailed answer',
});
const FORMAT_CLAUSE: Readonly<Record<string, string>> = Object.freeze({
  code_first: 'lead with the code',
  bullets: 'use bullet points',
  prose: 'answer in prose, not a list',
});
const POSTURE_CLAUSE: Readonly<Record<string, string>> = Object.freeze({
  just_do: 'skip the preamble and act directly',
  explain: 'explain the steps and your reasoning',
});
const FORMALITY_CLAUSE: Readonly<Record<string, string>> = Object.freeze({
  casual: 'keep the tone casual and plain',
  formal: 'keep the tone formal and professional',
});

/**
 * Render the compact imperative directive for a register. TOTAL: any hostile/partial
 * input is validated axis-by-axis; a fully-neutral register yields '' (the
 * byte-identical no-op). Never throws; the output is sanitized + bounded.
 */
export function buildResponseRegisterDirective(register: unknown): string {
  try {
    const v = safeGet(register, 'verbosity');
    const f = safeGet(register, 'format');
    const p = safeGet(register, 'posture');
    const fm = safeGet(register, 'formality');
    const clauses: string[] = [];
    const vc = isVerbosity(v) ? ownLookup(VERBOSITY_CLAUSE, v) : undefined;
    if (vc) clauses.push(vc);
    const fc = isFormat(f) ? ownLookup(FORMAT_CLAUSE, f) : undefined;
    if (fc) clauses.push(fc);
    const pc = isPosture(p) ? ownLookup(POSTURE_CLAUSE, p) : undefined;
    if (pc) clauses.push(pc);
    const fmc = isFormality(fm) ? ownLookup(FORMALITY_CLAUSE, fm) : undefined;
    if (fmc) clauses.push(fmc);
    if (clauses.length === 0) return '';
    return sanitizeText(DIRECTIVE_PREFIX + clauses.join('; ') + '.', MAX_DIRECTIVE_CHARS);
  } catch {
    return '';
  }
}

/** Build the finished register (axes + source + rendered directive). */
function finalize(p: ResponseRegisterPreference, source: ResponseRegisterSource): ResponseRegister {
  const axes = overlay(NEUTRAL_AXES, p);
  const directive = buildResponseRegisterDirective(axes);
  return { ...axes, source, directive };
}

// ---------------------------------------------------------------------------
// Main entry — deterministic precedence resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the per-turn response register. Precedence: (1) explicit inline directive
 * in currentMessage > (2) sticky session preference (input.sticky, else the stored
 * pref) > (3) prior-turn corrective feedback > (4) current-message style inference >
 * (5) profileHint > (6) neutral default. The neutral default returns an EMPTY
 * directive (byte-identical no-op). TOTAL: any hostile input yields the neutral
 * default and NEVER throws.
 */
export function resolveResponseRegister(input: ResolveResponseRegisterInput | unknown): ResponseRegister {
  try {
    const message = readMessageText(safeGet(input, 'currentMessage'));

    // (1) explicit inline directive
    const explicit = parseExplicitDirective(message);
    if (explicit) return finalize(explicit, 'explicit');

    // (2) sticky session preference
    const sticky = resolveStickyPreference(safeGet(input, 'sticky'));
    if (sticky) return finalize(sticky, 'sticky');

    // Compute the message-style / profile fallbacks up front (also the feedback base).
    const styleP = inferMessageStyle(message);
    const profileP = readProfileHint(safeGet(input, 'profileHint'));
    const base = overlay(NEUTRAL_AXES, styleP ?? profileP ?? null);

    // (3) prior-turn corrective feedback (adjusts the message-style/profile base)
    const fb = detectFeedbackAdjustment(safeGet(input, 'priorMessages'));
    if (fb) {
      const adjusted = applyFeedback(base, fb);
      return { ...adjusted, source: 'feedback', directive: buildResponseRegisterDirective(adjusted) };
    }

    // (4) current-message style inference
    if (styleP && !isNeutralPartial(styleP)) return finalize(styleP, 'message_style');

    // (5) profileHint default
    if (profileP && !isNeutralPartial(profileP)) return finalize(profileP, 'profile');

    // (6) neutral default -> empty directive, byte-identical no-op
    return neutralRegister('default');
  } catch {
    return neutralRegister('default');
  }
}

/**
 * One-line, user-facing status for the /style command reply. FIXED labels only,
 * bounded, never throws.
 */
export function describeResponseRegisterSetting(register: unknown): string {
  try {
    const v = safeGet(register, 'verbosity');
    const f = safeGet(register, 'format');
    const p = safeGet(register, 'posture');
    const fm = safeGet(register, 'formality');
    const parts: string[] = [];
    if (v === 'terse') parts.push('very brief');
    else if (v === 'brief') parts.push('brief');
    else if (v === 'detailed') parts.push('detailed');
    if (f === 'code_first') parts.push('code-first');
    else if (f === 'bullets') parts.push('bulleted');
    else if (f === 'prose') parts.push('prose');
    if (p === 'just_do') parts.push('no preamble');
    else if (p === 'explain') parts.push('step-by-step');
    if (fm === 'casual') parts.push('casual tone');
    else if (fm === 'formal') parts.push('formal tone');
    if (parts.length === 0) {
      return clampCodePoints(
        'Response style: automatic — I adapt length and tone to each message. Use `/brief`, `/detail`, `/code`, or `/bullets` to steer.',
        MAX_STATUS_CHARS,
      );
    }
    return clampCodePoints('Response style: ' + parts.join(', ') + '. `/style reset` to clear.', MAX_STATUS_CHARS);
  } catch {
    return 'Response style: automatic.';
  }
}

// ---------------------------------------------------------------------------
// Command / preference parsing + coercion
// ---------------------------------------------------------------------------

/**
 * Tolerant parser for a `/style|/brief|/detail|/code|/prose|/casual|…` command AND
 * natural phrasings ("keep it short", "just the code"). Returns the steerable-axis
 * partial, or null for an unrecognized command / no style signal. Never throws.
 */
export function parseResponseRegisterCommand(raw: unknown): ResponseRegisterPreference | null {
  try {
    if (typeof raw !== 'string' || raw.length === 0) return null;
    const clamped = safePrefix(raw, MAX_COMMAND_CHARS);
    const s = clamped.trim().toLowerCase();
    if (!s) return null;
    if (s.charCodeAt(0) === 0x2f /* '/' */) {
      const body = s.slice(1).trim();
      if (!body) return null;
      const parts = body.split(/\s+/).filter(Boolean);
      const head = parts[0] || '';
      const token = head === 'style' ? (parts[1] || '') : head;
      if (!token) return null;
      const found = ownLookup(TOKEN_PARTIALS, token);
      return found ? { ...found } : null;
    }
    // Natural phrasing: reuse the explicit-directive parser.
    return parseExplicitDirective(s);
  } catch {
    return null;
  }
}

/** Normalize any partial to only its valid, NON-neutral axes (or null). */
function normalizePreference(p: ResponseRegisterPreference | null | undefined): ResponseRegisterPreference | null {
  if (!p) return null;
  const out: ResponseRegisterPreference = {};
  if (isVerbosity(p.verbosity) && p.verbosity !== 'normal') out.verbosity = p.verbosity;
  if (isFormat(p.format) && p.format !== 'auto') out.format = p.format;
  if (isPosture(p.posture) && p.posture !== 'auto') out.posture = p.posture;
  if (isFormality(p.formality) && p.formality !== 'neutral') out.formality = p.formality;
  return Object.keys(out).length ? out : null;
}

/** Coerce a string token/phrase, a partial, or a full register to a stored pref. */
function coercePreference(pref: unknown): ResponseRegisterPreference | null {
  try {
    if (pref == null) return null;
    if (typeof pref === 'string') {
      const s = safePrefix(pref, MAX_COMMAND_CHARS).trim().toLowerCase();
      if (!s) return null;
      const direct = ownLookup(TOKEN_PARTIALS, s);
      if (direct) return normalizePreference(direct);
      return normalizePreference(parseResponseRegisterCommand(pref));
    }
    if (typeof pref === 'object') {
      return normalizePreference({
        verbosity: isVerbosity(safeGet(pref, 'verbosity')) ? (safeGet(pref, 'verbosity') as ResponseVerbosity) : undefined,
        format: isFormat(safeGet(pref, 'format')) ? (safeGet(pref, 'format') as ResponseFormat) : undefined,
        posture: isPosture(safeGet(pref, 'posture')) ? (safeGet(pref, 'posture') as ResponsePosture) : undefined,
        formality: isFormality(safeGet(pref, 'formality')) ? (safeGet(pref, 'formality') as ResponseFormality) : undefined,
      });
    }
    return null;
  } catch {
    return null;
  }
}

function resolveStickyPreference(stickyInput: unknown): ResponseRegisterPreference | null {
  const provided = coercePreference(stickyInput);
  if (provided) return provided;
  return getStoredResponseRegisterPreference();
}

// ---------------------------------------------------------------------------
// Sticky preference storage (contextDepthPolicy house pattern EXACTLY)
// ---------------------------------------------------------------------------

export const RESPONSE_REGISTER_STORAGE_KEY = 'uc_response_register';

/**
 * Session-scoped fallback so the sticky pref works where localStorage is unavailable
 * (native): the latest set always applies for this JS session; web additionally
 * persists across restarts.
 */
let sessionPrefOverride: ResponseRegisterPreference | null = null;

function clonePref(p: ResponseRegisterPreference): ResponseRegisterPreference {
  const out: ResponseRegisterPreference = {};
  if (p.verbosity !== undefined) out.verbosity = p.verbosity;
  if (p.format !== undefined) out.format = p.format;
  if (p.posture !== undefined) out.posture = p.posture;
  if (p.formality !== undefined) out.formality = p.formality;
  return out;
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Resolve the stored sticky preference: this session's last set -> web localStorage
 * -> null. Never throws.
 */
export function getStoredResponseRegisterPreference(): ResponseRegisterPreference | null {
  try {
    if (sessionPrefOverride) return clonePref(sessionPrefOverride);
    const store = (globalThis as { localStorage?: { getItem?: (k: string) => string | null } }).localStorage;
    const raw = store?.getItem?.(RESPONSE_REGISTER_STORAGE_KEY);
    if (typeof raw === 'string' && raw) {
      const clamped = safePrefix(raw, MAX_COMMAND_CHARS);
      const parsed = coercePreference(safeJsonParse(clamped)) ?? coercePreference(clamped);
      if (parsed) return parsed;
    }
  } catch {
    /* storage unavailable (native/node) -> no sticky pref */
  }
  return null;
}

/**
 * Apply a sticky preference (string token/phrase, partial, or full register). Always
 * takes effect for this session; returns true only when it also PERSISTED to web
 * localStorage. A null/neutral/unrecognized value CLEARS the sticky pref. Never throws.
 */
export function setStoredResponseRegisterPreference(pref: unknown): boolean {
  try {
    const norm = coercePreference(pref);
    sessionPrefOverride = norm;
    const store = (globalThis as {
      localStorage?: { setItem?: (k: string, v: string) => void; removeItem?: (k: string) => void };
    }).localStorage;
    if (!store) return false;
    if (!norm) {
      try { store.removeItem?.(RESPONSE_REGISTER_STORAGE_KEY); } catch { /* ignore */ }
      return false;
    }
    if (!store.setItem) return false;
    store.setItem(RESPONSE_REGISTER_STORAGE_KEY, JSON.stringify(norm));
    return true;
  } catch {
    return false;
  }
}
