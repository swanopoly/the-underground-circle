// memoryIntentCore — the PURE detector/parser behind SwanBot chat memory
// writes. Fixes two live findings:
//
//   (1) Natural-language memory phrases ("note that…", "remember that…",
//       "keep in mind…", "forget that…") never actually saved — the memory
//       response directive in swanbot.ts even tells the model to reply
//       "Saved." without any write happening. `detectMemoryIntent` is the
//       deterministic pre-LLM net: the chat send path calls it and routes
//       hits to the real writers (`rememberFromChat` / `forgetFromChat` in
//       memoryService.ts) instead of trusting the model's prose.
//   (2) Bare `/remember` and `/forget` fell through to the LLM because the
//       ChatTab handlers match `startsWith('/remember ')` (trailing space
//       required). `parseMemoryCommand` owns the slash grammar: with args it
//       returns the action + content, bare/args-less it returns `help` so the
//       caller can print MEMORY_COMMAND_USAGE instead of dispatching a model
//       turn.
//
// Semantics (all matching case-insensitive, start-anchored after stripping
// courtesy prefixes like "please" / "hey" / "can you"):
//
//   EXPLICIT remember leads → { kind:'remember', confidence:'explicit' }:
//     "remember that X" / "remember to X" / "note that X" /
//     "keep in mind (that) X" / "don't forget (that|to|about) X" /
//     "make a note (that|of|about|to) X" / "save this (to memory)(:) X"
//   EXPLICIT forget leads → { kind:'forget', confidence:'explicit' }:
//     "forget that X" / "don't remember (that) X" / "delete that memory (about) X"
//   IMPLICIT (weaker but still memory-shaped — callers may confirm first):
//     bare "remember X" (non-interrogative), "add/put/save/store X to memory",
//     "note to self: X", bare "forget (about) X" (idioms "forget it/this"
//     excluded), "delete/remove/clear/erase (the) memory/memories about X",
//     "remove X from memory"
//   NONE → { kind:'none', content:'', confidence:'implicit' }:
//     recall/nostalgia questions ("what do you remember…", anything ending in
//     '?'), non-start-anchored mentions ("I forget what that error was"),
//     slash commands (those belong to parseMemoryCommand), app-artifact saves
//     ("save this file…", "make a note that says… / in Notes"), and plain chat.
//
// The lead phrase is stripped from `content`; content is whitespace-collapsed,
// unwrapped from matching quotes, stripped of edge punctuation, and hard-capped
// at MAX_MEMORY_INTENT_CONTENT_CHARS (truncated with a trailing '…').
//
// PURITY: ZERO runtime imports, tsx-loadable (smoke: memory-intent-core).
// Every export is TOTAL — never throws on null/undefined/wrong-type/huge
// input; returns the neutral 'none' intent / null instead. Deterministic:
// no Date.now()/Math.random(), no top-level side effects.

// ── Types ────────────────────────────────────────────────────────────────────

export interface MemoryIntent {
  kind: 'remember' | 'forget' | 'none';
  /** Lead-phrase-stripped, cleaned, bounded memory content ('' when absent). */
  content: string;
  /** 'explicit' only for the named lead phrases; weaker matches are 'implicit'. */
  confidence: 'explicit' | 'implicit';
}

export interface MemoryCommand {
  action: 'remember' | 'forget' | 'help';
  content: string;
}

// ── Tunables (exported so wiring + smokes share the exact bounds) ────────────

/** Hard cap on extracted memory content; longer content truncates with '…'. */
export const MAX_MEMORY_INTENT_CONTENT_CHARS = 400;

/** Hard cap on how much of the incoming message is scanned at all. */
export const MAX_MEMORY_INTENT_INPUT_CHARS = 4000;

/** Usage help the caller prints for bare `/remember` / `/forget`. */
export const MEMORY_COMMAND_USAGE =
  'Memory commands:\n'
  + '• `/remember <fact>` — save it to memory (example: `/remember Chris deploys on Fridays`)\n'
  + '• `/forget <keyword>` — delete saved memories matching that keyword (example: `/forget deploy schedule`)\n'
  + '• `/memories` — open the memory viewer';

// ── Internals ────────────────────────────────────────────────────────────────

/** At least one non-whitespace, non-ASCII-punctuation char (letter/digit/…). */
const SUBSTANCE_RE = /[^\s\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/;

/** Whole message reads as a question → recall/nostalgia, never a write. */
const QUESTION_END_RE = /\?[\s!.…]*$/;

/** Leading decoration ("—", "> ", "* ") stripped before lead matching. */
const LEADING_NOISE_RE = /^[\s.,;:!\-–—>*•]+/;

/**
 * Courtesy/address prefixes stripped iteratively (bounded) before matching:
 * "hey swanbot, can you remember that X" → "remember that X". Each prefix
 * must be followed by a separator so words like "sonnet"/"andrew" survive.
 */
const COURTESY_PREFIX_RE =
  /^(?:please|pls|plz|hey|hi|yo|ok|okay|oh|so|also|and|btw|hmm|um|swan|swanbot|blackswan|openswan|bot|can\s+you|could\s+you|would\s+you|will\s+you)\s*[,:!.\-]*\s+/i;

/** Bare "remember <interrogative>…" is recall ("remember when we…"), not a save. */
const INTERROGATIVE_REST_RE = /^(?:when|what|where|who|whom|whose|why|how|if|whether)\b|^me\s*$/i;

/** "save this <artifact>…" is an app/file action, not a memory write. */
const ARTIFACT_REST_RE =
  /^(?:file|image|photo|picture|screenshot|video|doc|document|pdf|page|post|draft|link|url|code|snippet|design|tab)\b/i;

interface LeadRule {
  re: RegExp;
  kind: 'remember' | 'forget';
  confidence: 'explicit' | 'implicit';
  /** Return true to skip this rule for the captured rest (falls through). */
  reject?: (rest: string) => boolean;
}

// Order matters: specific explicit leads first, then implicit fallbacks.
const LEAD_RULES: LeadRule[] = [
  // — explicit remember —
  { re: /^save\s+this\s+(?:to|in|into)\s+(?:your\s+|my\s+)?memory\b[\s:,\-]*([\s\S]*)$/i, kind: 'remember', confidence: 'explicit' },
  { re: /^remember\s+that\b[\s:,\-]*([\s\S]*)$/i, kind: 'remember', confidence: 'explicit' },
  { re: /^remember\s+to\b[\s:,\-]*([\s\S]*)$/i, kind: 'remember', confidence: 'explicit' },
  { re: /^note\s+that\b[\s:,\-]*([\s\S]*)$/i, kind: 'remember', confidence: 'explicit' },
  { re: /^keep\s+in\s+mind\b[\s:,\-]*(?:that\s+)?([\s\S]*)$/i, kind: 'remember', confidence: 'explicit' },
  { re: /^(?:do\s+not|don['’]?t)\s+forget\b[\s:,\-]*(?:that\s+|to\s+|about\s+)?([\s\S]*)$/i, kind: 'remember', confidence: 'explicit' },
  {
    re: /^make\s+a\s+note\b[\s:,\-]*(?:that\s+|of\s+|about\s+|to\s+)?([\s\S]*)$/i,
    kind: 'remember',
    confidence: 'explicit',
    // "make a note that says X" / "make a note in Notes" → app note, not memory.
    reject: (rest) => /^says?\b/i.test(rest) || /^in\b/i.test(rest),
  },
  {
    re: /^save\s+this\b[\s:,\-]*([\s\S]*)$/i,
    kind: 'remember',
    confidence: 'explicit',
    reject: (rest) => ARTIFACT_REST_RE.test(rest),
  },
  // — explicit forget —
  { re: /^forget\s+that\b[\s:,\-]*([\s\S]*)$/i, kind: 'forget', confidence: 'explicit' },
  { re: /^(?:do\s+not|don['’]?t)\s+remember\b[\s:,\-]*(?:that\s+)?([\s\S]*)$/i, kind: 'forget', confidence: 'explicit' },
  { re: /^delete\s+that\s+memory\b[\s:,\-]*(?:about\s+|of\s+)?([\s\S]*)$/i, kind: 'forget', confidence: 'explicit' },
  // — implicit remember —
  { re: /^(?:add|put|save|store)\s+(?:this|that|it)\s+(?:to|in|into)\s+(?:your\s+|my\s+)?memory\b[\s:,\-]*([\s\S]*)$/i, kind: 'remember', confidence: 'implicit' },
  { re: /^(?:add|put|save|store)\s+(?:to|in|into)\s+(?:your\s+|my\s+)?memory\b[\s:,\-]*([\s\S]*)$/i, kind: 'remember', confidence: 'implicit' },
  { re: /^(?:add|put|save|store)\s+([\s\S]+?)\s+(?:to|in|into)\s+(?:your\s+|my\s+)?memory\b[\s.!]*$/i, kind: 'remember', confidence: 'implicit' },
  { re: /^note\s+to\s+self\b[\s:,\-]*([\s\S]*)$/i, kind: 'remember', confidence: 'implicit' },
  {
    re: /^remember\s+([\s\S]+)$/i,
    kind: 'remember',
    confidence: 'implicit',
    reject: (rest) => INTERROGATIVE_REST_RE.test(rest),
  },
  // — implicit forget —
  { re: /^(?:delete|remove|clear|erase|wipe)\s+(?:(?:the|that|this|my|all|any)\s+)*memor(?:y|ies)\b[\s:,\-]*(?:about\s+|of\s+|matching\s+|related\s+to\s+)?([\s\S]*)$/i, kind: 'forget', confidence: 'implicit' },
  { re: /^(?:delete|remove|clear|erase|wipe)\s+([\s\S]+?)\s+from\s+(?:your\s+|my\s+)?memory\b[\s\S]*$/i, kind: 'forget', confidence: 'implicit' },
  {
    re: /^forget\s+(?:about\s+)?([\s\S]+)$/i,
    kind: 'forget',
    confidence: 'implicit',
    // "forget it" / "forget this" / bare "forget about" are conversational
    // dismissals, not deletion requests.
    reject: (rest) => /^(?:it|this|about)[\s.!]*$/i.test(rest.trim()),
  },
];

function noneIntent(): MemoryIntent {
  return { kind: 'none', content: '', confidence: 'implicit' };
}

/**
 * Collapse whitespace, strip edge decoration/quotes, drop punctuation-only
 * strings, and hard-cap length (truncating with '…'). Total: never throws.
 */
function cleanContent(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  let s = raw.length > MAX_MEMORY_INTENT_INPUT_CHARS ? raw.slice(0, MAX_MEMORY_INTENT_INPUT_CHARS) : raw;
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/^[\s:;,.\-–—]+/, '');
  s = s.replace(/[\s.!,;:]+$/, '');
  if (s.length >= 2) {
    const first = s.charAt(0);
    const last = s.charAt(s.length - 1);
    if (
      (first === '"' && last === '"')
      || (first === "'" && last === "'")
      || (first === '“' && last === '”')
      || (first === '‘' && last === '’')
    ) {
      s = s.slice(1, -1).trim();
      s = s.replace(/[\s.!,;:]+$/, '');
    }
  }
  if (!SUBSTANCE_RE.test(s)) return '';
  if (s.length > MAX_MEMORY_INTENT_CONTENT_CHARS) {
    s = `${s.slice(0, MAX_MEMORY_INTENT_CONTENT_CHARS - 1).trimEnd()}…`;
  }
  return s;
}

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * Detect a natural-language memory save/delete intent in a chat message.
 * Total + deterministic; returns the neutral 'none' intent for anything that
 * is not a start-anchored memory phrase (questions, statements, slash
 * commands, app-artifact saves, non-strings).
 */
export function detectMemoryIntent(message: unknown): MemoryIntent {
  try {
    if (typeof message !== 'string') return noneIntent();
    let text = message.length > MAX_MEMORY_INTENT_INPUT_CHARS
      ? message.slice(0, MAX_MEMORY_INTENT_INPUT_CHARS)
      : message;
    text = text.trim();
    if (!text) return noneIntent();
    if (text.startsWith('/')) return noneIntent(); // commands → parseMemoryCommand
    if (QUESTION_END_RE.test(text)) return noneIntent(); // recall question, not a write
    text = text.replace(LEADING_NOISE_RE, '');
    for (let i = 0; i < 5; i += 1) {
      const next = text.replace(COURTESY_PREFIX_RE, '');
      if (next === text) break;
      text = next;
    }
    if (!text) return noneIntent();
    for (const rule of LEAD_RULES) {
      const m = text.match(rule.re);
      if (!m) continue;
      const rest = typeof m[1] === 'string' ? m[1] : '';
      if (rule.reject && rule.reject(rest)) continue;
      return { kind: rule.kind, content: cleanContent(rest), confidence: rule.confidence };
    }
    return noneIntent();
  } catch {
    return noneIntent();
  }
}

/**
 * Parse `/remember` / `/forget` slash commands. `/remember X` → remember,
 * `/forget X` → forget, bare (or punctuation-only args) → help with empty
 * content so the caller prints MEMORY_COMMAND_USAGE. Non-slash input, other
 * commands (`/rememberme`, `/memories`), and non-strings → null.
 */
export function parseMemoryCommand(input: unknown): MemoryCommand | null {
  try {
    if (typeof input !== 'string') return null;
    let text = input.length > MAX_MEMORY_INTENT_INPUT_CHARS
      ? input.slice(0, MAX_MEMORY_INTENT_INPUT_CHARS)
      : input;
    text = text.trim();
    if (!text.startsWith('/')) return null;
    const m = text.match(/^\/(remember|forget)\b[\s:,\-]*([\s\S]*)$/i);
    if (!m) return null;
    const action: MemoryCommand['action'] = m[1].toLowerCase() === 'forget' ? 'forget' : 'remember';
    const content = cleanContent(m[2]);
    if (!content) return { action: 'help', content: '' };
    return { action, content };
  } catch {
    return null;
  }
}
