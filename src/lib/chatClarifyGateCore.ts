// chatClarifyGateCore — the PURE, high-precision "ask ONE good question or
// just proceed" gate for SwanBot, the chat agent.
//
// Finding it fixes: on a genuinely under-specified ACTION request ("delete
// them", "send it", "deploy", "update the post") SwanBot either guesses wrong
// (deletes/sends/deploys the wrong thing) or over-corrects and interrogates the
// user with several vague questions. Both are bad. This gate is the
// deterministic pre-send net: for the narrow slice of messages that are short,
// context-free, and truly a coin-flip to act on, it returns ONE crisp
// clarifying question with 2–4 tappable options; for the overwhelming majority
// it says "just proceed" and stays out of the way.
//
// DESIGN BIAS (load-bearing): CONSERVATIVE + HIGH-PRECISION. Over-asking is
// worse than the underlying problem, so every ambiguous case leans PROCEED.
// A message only clarifies when ALL of these hold:
//   (a) it is an ACTION/DESTRUCTIVE request (delete/send/deploy/pay/overwrite/
//       publish/email/move/merge/…) OR a bare build/create request, AND
//   (b) a critical parameter (which items / to whom / which env / what change /
//       what to build) is provably MISSING — the object is empty or a dangling
//       pronoun ("it"/"them"/"this") with no substantive target, AND
//   (c) it is NOT resolvable from context — hasActiveThreadContext / an
//       attachment both force PROCEED, AND
//   (d) it is short/vague enough that guessing is a coin-flip — any concrete
//       specificity (a quote, URL, filename, @mention, email, named env, digit,
//       or simply enough content words) forces PROCEED, as do questions.
// The curated verb set is intentionally small. When unsure → proceed.
//
// PURITY (load-bearing — the smoke runs under tsx/esbuild, which CANNOT load
// react-native): ZERO runtime imports. No app modules, supabase, or
// react-native. No Date.now()/Math.random(); no top-level side effects. Every
// export is TOTAL — never throws on any input (null/undefined/number/huge/
// hostile); it returns a safe neutral value (proceed / false). Output is
// bounded: capped question/option lengths and a hard cap on options.

// ── Types ────────────────────────────────────────────────────────────────────

export interface ClarifyDecision {
  /** True ONLY for the narrow, high-precision clarify slice; false otherwise. */
  shouldClarify: boolean;
  /** One-sentence clarifying question ('' when proceeding). */
  question: string;
  /** 2–CLARIFY_MAX_OPTIONS tappable answers ([] when proceeding). */
  options: string[];
  /** Short machine reason for the decision (audit/debug; never secret). */
  reason: string;
}

export interface ClarifyOptions {
  /** An attachment supplies the referent for "this"/"these" → proceed. */
  hasAttachment?: boolean;
  /** Prior thread likely disambiguates dangling pronouns → proceed. */
  hasActiveThreadContext?: boolean;
  /** Automation/headless modes cannot ask a human → proceed. */
  mode?: string;
}

// ── Tunables (exported where wiring + smokes share the exact bounds) ─────────

/** Hard cap on the number of tappable options ever returned. */
export const CLARIFY_MAX_OPTIONS = 4;

/** Chars of the incoming message scanned at all (junk armor). */
export const MAX_CLARIFY_INPUT_CHARS = 4000;

/**
 * A clarify candidate must have at most this many SUBSTANTIVE (non-stopword)
 * words. More content words than this means the message already carries enough
 * specifics to act on → proceed.
 */
export const MAX_CLARIFY_CONTENT_WORDS = 4;

/** Question length cap (bounded output). */
const MAX_QUESTION_CHARS = 200;

/** Per-option length cap (bounded output). */
const MAX_OPTION_CHARS = 60;

/** Tokens scanned when classifying (junk armor). */
const MAX_TOKENS_SCANNED = 64;

// ── Curated vocab (intentionally small — precision over recall) ──────────────

type ActionCategory =
  | 'destructive'
  | 'send'
  | 'publish'
  | 'deploy'
  | 'merge'
  | 'pay'
  | 'move'
  | 'edit';
type ClarifyKind = ActionCategory | 'build';

/**
 * Leading action verbs that mutate/transmit/spend and therefore make a missing
 * object a genuine risk. Deliberately excludes safe/read verbs (summarize,
 * explain, translate, show, find, write…) and the idiom-prone "drop" (as in
 * "drop it"). Keyed by first word → clarify category.
 */
const VERB_CATEGORY: Record<string, ActionCategory> = {
  // destructive
  delete: 'destructive', remove: 'destructive', wipe: 'destructive',
  erase: 'destructive', purge: 'destructive', overwrite: 'destructive',
  revoke: 'destructive', uninstall: 'destructive', reset: 'destructive',
  clear: 'destructive',
  // send (transmit to a recipient)
  send: 'send', email: 'send', forward: 'send', dm: 'send',
  // publish (put somewhere public)
  publish: 'publish', post: 'publish', tweet: 'publish', share: 'publish',
  submit: 'publish',
  // deploy (which environment)
  deploy: 'deploy', ship: 'deploy', release: 'deploy', promote: 'deploy',
  rollback: 'deploy', cutover: 'deploy',
  // merge (which branch/PR)
  merge: 'merge',
  // pay (money)
  pay: 'pay', transfer: 'pay', refund: 'pay', wire: 'pay', venmo: 'pay',
  charge: 'pay',
  // move / rename (destination)
  move: 'move', rename: 'move', migrate: 'move', relocate: 'move',
  // edit (which one / what change)
  update: 'edit', edit: 'edit', change: 'edit', modify: 'edit', fix: 'edit',
  revise: 'edit', rewrite: 'edit',
};

/** Build/create verbs — clarify only when the SUBJECT itself is missing. */
const BUILD_VERBS: Record<string, true> = {
  build: true, create: true, make: true, generate: true, develop: true,
  design: true, scaffold: true, rebuild: true,
};

/**
 * Non-substantive words. If everything after the leading verb is one of these
 * (or empty), the object is a dangling pronoun/filler → the critical param is
 * missing. Any word NOT here counts as a real target → proceed.
 */
const STOPWORDS: Record<string, true> = {
  it: true, its: true, them: true, they: true, this: true, that: true,
  these: true, those: true, all: true, everything: true, everthing: true,
  some: true, one: true, ones: true, stuff: true, things: true, thing: true,
  mine: true, ours: true, yours: true, here: true, there: true, up: true,
  out: true, off: true, over: true, back: true, again: true, already: true,
  now: true, right: true, away: true, then: true, soon: true, please: true,
  pls: true, plz: true, asap: true, immediately: true, today: true,
  tonight: true, for: true, me: true, us: true, the: true, a: true, an: true,
  my: true, your: true, our: true, of: true, to: true, too: true, also: true,
  real: true, quick: true, quickly: true,
};

/** Modes where no human is present to answer → never clarify. */
const NONINTERACTIVE_MODES: Record<string, true> = {
  auto: true, autonomous: true, silent: true, background: true,
  noninteractive: true, 'non-interactive': true, headless: true, yolo: true,
  batch: true, cron: true, scheduled: true, agent: true,
};

/** Per-category clarify copy. One-sentence question, 2–4 tappable options. */
const CLARIFY_CONTENT: Record<ClarifyKind, { question: string; options: string[]; reason: string }> = {
  destructive: {
    question: 'Which items do you want me to delete?',
    options: ['Everything shown here', 'Only the ones I pick', 'Something else'],
    reason: 'destructive-target-missing',
  },
  send: {
    question: 'Who should I send this to?',
    options: ['The whole team', 'One specific person', 'Something else'],
    reason: 'send-recipient-missing',
  },
  publish: {
    question: 'Where should I publish this?',
    options: ['Publish it live now', 'Save it as a draft first', 'Something else'],
    reason: 'publish-target-missing',
  },
  deploy: {
    question: 'Which environment should I deploy to?',
    options: ['Production', 'Staging', 'Preview', 'Something else'],
    reason: 'deploy-env-missing',
  },
  merge: {
    question: 'Which branch or PR should I merge?',
    options: ['The current pull request', "A branch I'll name", 'Something else'],
    reason: 'merge-target-missing',
  },
  pay: {
    question: 'Who should I pay, and how much?',
    options: ['Review the details first', 'Pick a recipient', 'Something else'],
    reason: 'pay-details-missing',
  },
  move: {
    question: 'Where should I move it to?',
    options: ['Pick a destination', "Somewhere I'll name", 'Something else'],
    reason: 'move-destination-missing',
  },
  edit: {
    question: 'Which one should I update, and what change do you want?',
    options: ['The page you’re viewing', 'Let me name which one', 'Something else'],
    reason: 'edit-target-or-change-missing',
  },
  build: {
    question: 'What would you like me to build?',
    options: ['A web page or app', 'A script or automation', 'A document', 'Something else'],
    reason: 'build-subject-missing',
  },
};

// ── Regex signals ─────────────────────────────────────────────────────────────

/** Courtesy / address / filler prefixes stripped iteratively before matching. */
const COURTESY_PREFIX_RE =
  /^(?:please|pls|plz|kindly|hey|hi|hiya|yo|hello|sup|ok|okay|oh|so|and|well|um|uh|just|now|quickly?|can\s+you|could\s+you|would\s+you|will\s+you|can\s+u|could\s+u|do\s+you\s+mind|would\s+you\s+mind|mind|go\s+ahead\s+and|go\s+ahead|i\s+need\s+you\s+to|i\s+want\s+you\s+to|i\s+need\s+to|i\s+want\s+to|i'?d\s+like\s+you\s+to|i'?d\s+like\s+to|let'?s|lets|let\s+me|we\s+need\s+to|we\s+should|you\s+should|can\s+you\s+please|could\s+you\s+please)\b[\s,:!.\-]*/i;

/** Leading interrogative → it's a question, never a destructive action → proceed. */
const INTERROGATIVE_RE =
  /^(?:what|whats|what'?s|who|whom|whose|where|wheres|where'?s|when|why|how|hows|how'?s|which|whether|is|are|am|do|does|did|dont|don'?t|can|could|should|would|will|shall|may|might|have|has|had|was|were)\b/i;

/**
 * "<edit-verb> the/my/this/that/our/a <generic-noun>" with nothing after — the
 * canonical "update the post" shape: both WHICH one and WHAT change are absent.
 */
const EDIT_GENERIC_RE =
  /^(?:update|edit|change|modify|fix|revise|rewrite)\s+(?:the|my|this|that|our|a)\s+(?:post|page|article|entry|listing|item|record|thing|section|settings?|config|copy|draft)\b\s*[.!?]*$/i;

// Concrete-specificity signals — any present → not a coin-flip → proceed.
const SIG_QUOTE = /["“”`]/;
const SIG_URL = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|io|dev|org|net|app|co|ai|gov|edu|xyz|sh)\b)/i;
const SIG_FILE = /\b[\w-]+\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|png|jpe?g|gif|svg|webp|pdf|csv|tsv|txt|html?|css|scss|py|rb|go|rs|java|sh|zsh|yml|yaml|toml|sql|zip|tar|gz|docx?|xlsx?|pptx?)\b/i;
const SIG_EMAIL = /[\w.+-]+@[\w-]+\.[a-z]{2,}/i;
const SIG_MENTION = /(?:^|\s)[@#][\w-]{2,}/;
const SIG_PATH = /(?:^|\s)[~./]?[\w.-]*\/[\w.-]+/;
const SIG_ENV = /\b(?:prod|production|staging|stage|dev|development|preview|localhost|sandbox|qa|uat|testnet|mainnet)\b/i;
const SIG_DIGIT = /\d/;

// ── Internals (all total) ─────────────────────────────────────────────────────

function toText(message: unknown): string {
  if (typeof message !== 'string') return '';
  const scanned = message.length > MAX_CLARIFY_INPUT_CHARS
    ? message.slice(0, MAX_CLARIFY_INPUT_CHARS)
    : message;
  return scanned.trim();
}

function proceed(reason: string): ClarifyDecision {
  return { shouldClarify: false, question: '', options: [], reason };
}

function cap(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function clarify(kind: ClarifyKind): ClarifyDecision {
  const c = CLARIFY_CONTENT[kind];
  const options = c.options
    .slice(0, CLARIFY_MAX_OPTIONS)
    .map((o) => cap(String(o), MAX_OPTION_CHARS));
  return {
    shouldClarify: true,
    question: cap(c.question, MAX_QUESTION_CHARS),
    options,
    reason: c.reason,
  };
}

/** Iteratively strip stacked courtesy/filler prefixes (bounded). */
function stripCourtesy(text: string): string {
  let t = text;
  for (let i = 0; i < 6; i += 1) {
    const next = t.replace(COURTESY_PREFIX_RE, '');
    if (next === t) break;
    t = next.replace(/^[\s,:!.\-]+/, '');
  }
  return t.trim();
}

/** Cleaned lowercase word tokens (edge punctuation stripped), bounded count. */
function cleanTokens(text: string): string[] {
  const parts = text.split(/\s+/);
  const out: string[] = [];
  const limit = Math.min(parts.length, MAX_TOKENS_SCANNED);
  for (let i = 0; i < limit; i += 1) {
    const cleaned = parts[i].replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '').toLowerCase();
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** True when every token is a stopword/filler (or there are none) → dangling. */
function isAllStopwords(tokens: string[]): boolean {
  for (const t of tokens) {
    if (!STOPWORDS[t]) return false;
  }
  return true;
}

function hasSpecificitySignal(raw: string): boolean {
  return (
    SIG_QUOTE.test(raw)
    || SIG_URL.test(raw)
    || SIG_FILE.test(raw)
    || SIG_EMAIL.test(raw)
    || SIG_MENTION.test(raw)
    || SIG_PATH.test(raw)
    || SIG_ENV.test(raw)
    || SIG_DIGIT.test(raw)
  );
}

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * Decide whether SwanBot should ask ONE clarifying question or just proceed.
 * Total + deterministic. Returns { shouldClarify:false, … } for the
 * overwhelming majority; only the curated, context-free, missing-critical-param
 * action/build slice returns a single question with tappable options.
 */
export function decideChatClarify(message: unknown, opts?: ClarifyOptions): ClarifyDecision {
  try {
    const o: Record<string, unknown> = (opts && typeof opts === 'object')
      ? (opts as Record<string, unknown>)
      : {};
    const hasThread = o.hasActiveThreadContext === true;
    const hasAttach = o.hasAttachment === true;
    const mode = typeof o.mode === 'string' ? (o.mode as string).trim().toLowerCase() : '';

    const raw = toText(message);
    if (!raw) return proceed('empty');
    // Context resolves dangling references → proceed.
    if (hasThread) return proceed('thread-context');
    if (hasAttach) return proceed('attachment-context');
    if (mode && NONINTERACTIVE_MODES[mode]) return proceed('noninteractive-mode');
    // Any concrete specifics → not a coin-flip → proceed.
    if (hasSpecificitySignal(raw)) return proceed('has-specifics');

    const stripped = stripCourtesy(raw);
    if (!stripped) return proceed('courtesy-only');
    // Questions ask for info; they are not destructive actions → proceed.
    if (INTERROGATIVE_RE.test(stripped)) return proceed('question');

    const tokens = cleanTokens(stripped);
    if (tokens.length === 0) return proceed('no-tokens');

    const contentWords = tokens.filter((t) => !STOPWORDS[t]);
    // Enough substantive content to act on → proceed.
    if (contentWords.length > MAX_CLARIFY_CONTENT_WORDS) return proceed('specific-enough');

    const first = tokens[0];
    const rest = tokens.slice(1);

    // Bare build/create with no subject ("build it", "create", "make that").
    if (BUILD_VERBS[first] && isAllStopwords(rest)) return clarify('build');

    const category = VERB_CATEGORY[first];
    if (category) {
      // Action verb with a dangling / absent object ("delete them", "deploy").
      if (isAllStopwords(rest)) return clarify(category);
      // Canonical "update the post" — which one + what change both missing.
      if (category === 'edit' && EDIT_GENERIC_RE.test(stripped)) return clarify('edit');
    }

    return proceed('actionable');
  } catch {
    return proceed('error');
  }
}

/**
 * Helper: does the message read as a destructive/high-stakes ACTION request?
 * True for delete/remove/drop/send/publish/deploy/pay/overwrite/wipe/merge/
 * reset (and close synonyms) when they lead the message (after stripping
 * courtesy prefixes). Questions that merely mention these ("how do I delete a
 * branch") are false. Total: non-strings / junk → false.
 */
export function isDestructiveActionPhrase(message: unknown): boolean {
  try {
    const raw = toText(message);
    if (!raw) return false;
    const stripped = stripCourtesy(raw);
    if (!stripped) return false;
    if (INTERROGATIVE_RE.test(stripped)) return false;
    const tokens = cleanTokens(stripped);
    if (tokens.length === 0) return false;
    return DESTRUCTIVE_HELPER_VERBS[tokens[0]] === true;
  } catch {
    return false;
  }
}

/** Verbs the helper treats as destructive/high-stakes action intents. */
const DESTRUCTIVE_HELPER_VERBS: Record<string, true> = {
  delete: true, remove: true, drop: true, wipe: true, erase: true, purge: true,
  clear: true, reset: true, overwrite: true, revoke: true, uninstall: true,
  send: true, email: true, forward: true, publish: true, post: true,
  tweet: true, deploy: true, ship: true, release: true, rollback: true,
  merge: true, pay: true, transfer: true, refund: true, charge: true,
  wire: true, move: true, rename: true, migrate: true,
};
