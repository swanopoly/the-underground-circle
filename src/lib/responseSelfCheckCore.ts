// responseSelfCheckCore — the PURE, context-free PRE-SEND self-verification scan
// for the agent's DRAFT final answer. It answers the one question the transport
// state machine cannot on an otherwise-CLEAN finish (stop_reason !== 'tool_use'):
// "is this answer actually FINISHED, or is it silently half-done?"
//
// Why this exists (the unowned self-defect family):
//   When SwanBot's tool loop stops cleanly, swanbot.ts assembles finalResponseText
//   and returns it verbatim. Today it hand-rolls exactly ONE narrow incompleteness
//   case (a max_tokens stop still carrying a tool_use block) and misses the rest of
//   the structurally-detectable self-inflicted defect family that arrives on a
//   clean turn. The app routes heavily to open / fine-tuned models (BlackSwan-v5,
//   DeepSeek, Groq/Together/Fireworks opens, Ollama, MiniMax, z.ai) that regularly
//   emit: a leftover template placeholder ("[TODO]", "<insert path>", "{{var}}",
//   "___"), an EMPTY code fence (```ts``` with no body) or an UNCLOSED fence (odd
//   fence count → breaks rendering + signals truncation), a promise-without-delivery
//   ("Here is the updated file:" then nothing), a dangling/truncated final sentence
//   (ends on "and"/"to"/"because"/a bare ":" / an open bracket), or a claimed
//   completed action ("I've edited the file") that NO tool this turn backs. Every one
//   is detectable from the draft text alone (plus, for the last, the turn's own tool
//   name list) with ZERO external context.
//
// ADVISORY only — this NEVER edits, suppresses, or blocks the answer. It returns a
// flag + a bounded, secret-safe defect list the caller can route to telemetry or the
// existing `incomplete: true` continue channel. It is deliberately complementary to
// its neighbors: streamDegeneracyCore detects TOO-MUCH (loops), responseFaithfulness
// detects NOT-GROUNDED (needs external context), this detects MISSING/UNFINISHED.
//
// PURITY (load-bearing — the smoke runs under tsx/esbuild, which cannot load
// react-native): ZERO runtime imports; zero side effects at import. DETERMINISTIC —
// no Date.now / Math.random / argless `new Date`; frozen const cue lists; every
// global regex resets lastIndex before use so nothing leaks between calls. TOTAL —
// every export survives null / undefined / wrong-type / huge / hostile (throwing
// getters, cyclic, Proxy, bigint) input by degrading to a safe neutral result and
// NEVER throwing. BOUNDED — only head=first MAX_SCAN_CHARS and tail=last TAIL_WINDOW
// chars are scanned, defects capped at MAX_DEFECTS, every evidence string clamped to
// EVIDENCE_MAX. SECRET-SAFE — evidence snippets are whitespace-collapsed, long
// hex/base64/token runs are redacted, and control / line-separator / prompt-fence
// chars are stripped so a snippet can never carry a secret or break a downstream
// prompt.

// ─── Public contract ─────────────────────────────────────────────────────────

/** The structurally-detectable self-inflicted defect shapes. */
export type ResponseDefectKind =
  | 'unfilled_placeholder' // a leftover template token ([TODO], <insert x>, {{var}}, ___) or bare marker
  | 'empty_code_fence' // a fenced code block that opened and closed with no body
  | 'unclosed_code_fence' // an odd fence count — a fence was never closed
  | 'promise_without_delivery' // a delivery lead-in ("here is the file:") that ends with nothing
  | 'dangling_sentence' // the answer ends mid-thought (trailing conjunction / open bracket / bare ':')
  | 'unbacked_action_claim'; // a past-tense completion claim no tool this turn backs

/** Advisory band. `ok` = clean; `review` = only low-severity signals; `incomplete`
 *  = at least one high-severity self-defect (the answer looks unfinished). */
export type ResponseSelfCheckFlag = 'ok' | 'review' | 'incomplete';

/** One detected self-defect. `evidence` is a bounded, secret-safe snippet. */
export interface ResponseDefect {
  kind: ResponseDefectKind;
  severity: 'high' | 'low';
  evidence: string;
}

/** The verdict from {@link scanResponseForDefects}. On a clean/empty/hostile input
 *  every field is the neutral default (`flag:'ok'`, `incomplete:false`, `defects:[]`). */
export interface ResponseSelfCheckResult {
  flag: ResponseSelfCheckFlag;
  /** Convenience mirror of `flag === 'incomplete'` — the existing continue channel. */
  incomplete: boolean;
  /** Deduped, high-severity-first, capped at MAX_DEFECTS. */
  defects: ResponseDefect[];
}

/** Input to {@link scanResponseForDefects}. */
export interface ResponseSelfCheckInput {
  /** The finished draft answer to scan. Non-string → treated as empty (neutral). */
  responseText?: unknown;
  /**
   * The AUTHORITATIVE, complete list of tool NAMES invoked this turn (e.g.
   * `toolEvents.map(e => e.tool)`). Enables the opt-in unbacked-action-claim check.
   * Omitted / non-array → that check is SKIPPED (unknown ≠ none), never guessed.
   */
  toolCallsUsed?: unknown;
}

// ─── Exported bounds (callers + smoke share these) ───────────────────────────

/** Only the first this-many chars feed the placeholder / fence scans. */
export const MAX_SCAN_CHARS = 200_000;
/** Only the last this-many chars (from the TRUE end) feed the dangling / promise scans. */
export const TAIL_WINDOW = 600;
/** Hard cap on the returned defect list. */
export const MAX_DEFECTS = 12;
/** Hard cap on each defect's echoed `evidence` snippet. */
export const EVIDENCE_MAX = 80;

// ─── Internal bounds (defensive; not caller-tunable) ─────────────────────────

const MAX_FENCE_LINES = 100_000; // cap lines examined for fence markers
const MAX_PLACEHOLDERS = 40; // cap placeholder matches collected per scan
const MAX_CLAIM_SCAN = 40_000; // only this many head chars feed the claim scan
const MAX_TOOLS = 500; // cap tool-name entries read
const MAX_TOOL_NAME = 120; // cap each tool-name length
const SECRET_MIN = 32; // an alnum/base64/token run >= this is redacted from echoes
const REDACTED_MASK = '[redacted]';
const TAIL_SCAN_MAX = TAIL_WINDOW * 4; // hard bound for endsDangling's own slice

// ─── Frozen cue data ─────────────────────────────────────────────────────────

/** A final word from this set (a trailing conjunction / preposition / relativizer)
 *  means the sentence was cut mid-thought. */
const DANGLING_WORDS: ReadonlySet<string> = new Set<string>([
  'and', 'or', 'but', 'so', 'to', 'the', 'a', 'an', 'with', 'for', 'of', 'in',
  'on', 'at', 'from', 'by', 'as', 'is', 'are', 'was', 'were', 'that', 'which',
  'because', 'if', 'when', 'while', 'then',
]);

/** All-caps bracket contents that are ordinary annotations, NOT placeholders. */
const ANNOTATION_ALLOW: ReadonlySet<string> = new Set<string>([
  'NOTE', 'WARNING', 'INFO', 'TIP', 'IMPORTANT', 'CAUTION', 'DONE', 'OK', 'YES',
  'NO', 'WIP', 'DRAFT', 'NEW', 'DEPRECATED',
]);

// ─── Regexes (module-scope constants; globals are lastIndex-reset before use) ──

// A fence marker LINE (opening or closing): up to 3 leading spaces then 3+ backticks
// or 3+ tildes. Used for counting (parity → unclosed) and for scaffold stripping.
const FENCE_MARKER_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*[^\n]*$/;
// A fence OPEN with an optional info string captured.
const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\n]*)$/;
// A fence CLOSE: a bare fence marker with nothing after it.
const FENCE_CLOSE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/;
// A bullet / ordered list item line.
const LIST_ITEM_RE = /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/;
// A markdown table row.
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

const MUSTACHE_RE = /\{\{[^{}\n]{0,120}\}\}/g;
const BRACKET_RE = /\[([^\]\[\n]{1,80})\](\()?/g;
const ANGLE_RE = /<\s*(?:insert|placeholder|replace|enter|fill(?:\s+in)?|todo|your\b[^>\n]*\bhere|path\s*\/?\s*to|add\b[^>\n]*\bhere)\b[^>\n]{0,60}>/gi;
const UNDERSCORE_RE = /_{3,}/g;
const BARE_MARKER_RE = /(^|[^\w\[{<])(TODO|FIXME|XXX|TBD)(?![\w\]}>])/g;

// Bracket-inner classifiers (non-global; single test each).
const ALLCAPS_PLACEHOLDER_RE = /^[A-Z][A-Z0-9 _./-]{2,}$/;
const PLACEHOLDER_KEYWORD_RE = /(?:\b(?:todo|fixme|insert|placeholder|replace|redacted|tbd|xxx)\b|\bfill(?:\s+in)?\b|\byour\b[^\]]*\bhere\b|\bpath\s*\/?\s*to\b|\benter\b[^\]]*\bhere\b|\badd\b[^\]]*\bhere\b|\bcoming\s+soon\b|\bto\s+be\s+(?:filled|added|determined)\b)/i;

// Promise-without-delivery: a delivery lead-in that ENDS the message (end-anchored;
// non-global; single exec). The tail's trailing empty-fence scaffold + whitespace is
// stripped first, so an empty ```…``` after the phrase still reads as "nothing".
const PROMISE_END_RES: readonly RegExp[] = [
  /here\s+(?:is|are|'s)\s+(?:the|your|a|an|my|our)\b[^\n]{0,80}:\s*$/i,
  /\bas\s+follows\s*:?\s*$/i,
  /\bbelow\s+(?:is|are)\b[^\n]{0,60}:\s*$/i,
  /\bhere\s+you\s+go\b[^\n]{0,20}:?\s*$/i,
  /\bthe\s+(?:updated|full|complete|final|new|entire|revised|following)\s+(?:code|files?|functions?|scripts?|versions?|implementation|content|snippets?|diff|patch|answer|text|changes?|output|result)\b[^\n]{0,40}(?:\bis\b|\bare\b|:)\s*$/i,
  /\bthe\s+following\b[^\n]{0,40}:\s*$/i,
];

/** One unbacked-action-claim category: a past-tense completion CLAIM regex plus the
 *  tool-name pattern that would BACK it. Claim regexes match specific past-tense
 *  inflections only, so future/base forms ("I'll edit", "I will send") never fire. */
interface ClaimCategory {
  claimRe: RegExp;
  toolRe: RegExp;
}

const CLAIM_CATEGORIES: readonly ClaimCategory[] = [
  {
    // file edit — requires a "file(s)" object near the verb.
    claimRe: /\bi\b[^.\n!?]{0,80}?\b(?:edited|created|updated|saved|deleted|modified|patched|wrote|written|added)\b[^.\n!?]{0,24}\bfiles?\b/i,
    toolRe: /edit|write|create|save|apply|patch|multi_file|delete|update/i,
  },
  {
    // exec / test / build — requires an exec-y object so "I ran into a problem" is safe.
    claimRe: /\bi\b[^.\n!?]{0,80}?\b(?:executed|compiled|rebuilt|tested|built|re-?ran|ran)\b[^.\n!?]{0,24}\b(?:tests?|test\s+suite|suite|build|command|script|code|program|checks?|it|them)\b/i,
    toolRe: /run|shell|exec|bash|test|build|compile/i,
  },
  {
    // send — bare emailed/replied/drafted, or "sent <mail-ish object>".
    claimRe: /\bi\b[^.\n!?]{0,80}?\b(?:(?:emailed|replied|drafted|messaged)|sent\b[^.\n!?]{0,24}\b(?:e-?mail|mail|message|reply|draft|note|it|them))\b/i,
    toolRe: /send|reply|draft|compose|email/i,
  },
  {
    // git — committed/pushed/merged/rebased, or "opened a PR".
    claimRe: /\bi\b[^.\n!?]{0,80}?\b(?:committed|pushed|merged|rebased|opened\b[^.\n!?]{0,20}\b(?:pr|pull\s*request|mr))\b/i,
    toolRe: /git|commit|push|pull_request|merge/i,
  },
  {
    // browse — navigated/browsed/searched, or "opened <page-ish object>".
    claimRe: /\bi\b[^.\n!?]{0,80}?\b(?:navigated|browsed|searched|opened\b[^.\n!?]{0,20}\b(?:url|page|site|website|link|browser|tab))\b/i,
    toolRe: /browser|navigate|open_url|search|web|fetch|goto/i,
  },
];

// ─── Small total helpers ─────────────────────────────────────────────────────

/** Normalize EOLs to '\n' without touching content; '' for non-strings. */
function normEol(s: string): string {
  return s.replace(/\r\n?/g, '\n');
}

/**
 * True for a code point that must never survive in an echoed snippet: C0 controls +
 * DEL + C1 controls, the two Unicode line separators, zero-width / word-joiner /
 * bidi / BOM markers, and the prompt-fence chars (backtick + angle brackets).
 * Expressed as numeric comparisons so the source stays control-char-free.
 */
function isUnsafeCode(code: number): boolean {
  if (code <= 0x1f) return true; // C0 controls (incl. NUL)
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

/** Strip every unsafe code point (see {@link isUnsafeCode}). Never throws. */
function stripUnsafe(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (!isUnsafeCode(s.charCodeAt(i))) out += s.charAt(i);
  }
  return out;
}

/** Replace long alnum/base64/token runs with the mask. Fresh RegExp each call so the
 *  global lastIndex can never leak. Never throws. */
function redactSecrets(s: string): string {
  try {
    return s.replace(new RegExp(`[A-Za-z0-9+/=_-]{${SECRET_MIN},}`, 'g'), REDACTED_MASK);
  } catch {
    return s;
  }
}

/**
 * Turn a raw snippet into a bounded, whitespace-collapsed, secret-redacted string
 * safe to surface in telemetry / a downstream prompt. Order: pre-clamp, redact
 * secrets, collapse whitespace, strip unsafe chars, clamp to EVIDENCE_MAX. Never
 * throws; non-string → ''.
 */
function scrubEvidence(raw: unknown): string {
  try {
    let s = typeof raw === 'string' ? raw : '';
    if (!s) return '';
    if (s.length > EVIDENCE_MAX * 4) s = s.slice(0, EVIDENCE_MAX * 4);
    s = redactSecrets(s);
    s = s.replace(/\s+/g, ' ');
    s = stripUnsafe(s);
    s = s.trim();
    if (s.length > EVIDENCE_MAX) s = s.slice(0, EVIDENCE_MAX - 1) + '…';
    return s;
  } catch {
    return '';
  }
}

/** A fenced-code info string reduced to its first token, sanitized + lowercased. */
function sanitizeLang(info: string): string {
  try {
    const token = (info.trim().split(/\s+/)[0] || '').replace(/[^A-Za-z0-9+#._-]/g, '');
    return token.slice(0, 24).toLowerCase();
  } catch {
    return '';
  }
}

/** The neutral (clean) result — a FRESH object each call so a caller can never
 *  corrupt a shared instance. Deterministic. */
function neutralResult(): ResponseSelfCheckResult {
  return { flag: 'ok', incomplete: false, defects: [] };
}

function severityRank(sev: 'high' | 'low'): number {
  return sev === 'high' ? 0 : 1;
}

/** Safely read a defect-like value's severity without ever throwing. */
function readSeverity(d: unknown): 'high' | 'low' | '' {
  if (!d || typeof d !== 'object') return '';
  try {
    const s = (d as { severity?: unknown }).severity;
    return s === 'high' ? 'high' : s === 'low' ? 'low' : '';
  } catch {
    return '';
  }
}

/** Advance a global regex past a zero-width match so the exec loop can't spin. */
function guardZeroWidth(re: RegExp, m: RegExpExecArray): void {
  if (m.index === re.lastIndex) re.lastIndex += 1;
}

// ─── Placeholder collection ──────────────────────────────────────────────────

interface Placeholder {
  evidence: string;
  severity: 'high' | 'low';
}

/** Is a bracket's inner content a template placeholder (vs an annotation/citation)? */
function isPlaceholderInner(inner: string): boolean {
  const t = inner.trim();
  if (t.length < 2) return false; // [x] / [ ] checkboxes, single letters
  if (ALLCAPS_PLACEHOLDER_RE.test(t)) {
    return !ANNOTATION_ALLOW.has(t); // [TODO] yes; [NOTE]/[WARNING] no
  }
  return PLACEHOLDER_KEYWORD_RE.test(t); // [insert path], [your key here], …
}

/**
 * Collect placeholder defects from `head` (already EOL-normalized). HIGH: mustache
 * {{…}}, bracketed/angle template tokens, inline underscore fill-blanks. LOW: a bare
 * all-caps prose marker (TODO/FIXME/XXX/TBD as a whole word — legitimate often
 * enough to stay low). Deduped by severity+evidence; bounded to MAX_PLACEHOLDERS.
 */
function collectPlaceholders(head: string): Placeholder[] {
  const out: Placeholder[] = [];
  const seen = new Set<string>();
  const add = (raw: string, severity: 'high' | 'low'): void => {
    if (out.length >= MAX_PLACEHOLDERS) return;
    const evidence = scrubEvidence(raw);
    if (!evidence) return;
    const key = severity + '::' + evidence;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ evidence, severity });
  };

  try {
    // Mustache {{var}}
    MUSTACHE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while (out.length < MAX_PLACEHOLDERS && (m = MUSTACHE_RE.exec(head)) !== null) {
      add(m[0], 'high');
      guardZeroWidth(MUSTACHE_RE, m);
    }

    // Bracketed [TODO] / [INSERT x] / [your key here] — skipping markdown links [x](…)
    BRACKET_RE.lastIndex = 0;
    while (out.length < MAX_PLACEHOLDERS && (m = BRACKET_RE.exec(head)) !== null) {
      guardZeroWidth(BRACKET_RE, m);
      if (m[2] === '(') continue; // immediate "](" → a markdown link, not a placeholder
      if (isPlaceholderInner(m[1])) add('[' + m[1] + ']', 'high');
    }

    // Angle <insert …> / <your … here>
    ANGLE_RE.lastIndex = 0;
    while (out.length < MAX_PLACEHOLDERS && (m = ANGLE_RE.exec(head)) !== null) {
      add(m[0], 'high');
      guardZeroWidth(ANGLE_RE, m);
    }

    // Inline underscore fill-blank (a lone "___" HR line and identifier "_" runs are skipped)
    UNDERSCORE_RE.lastIndex = 0;
    while (out.length < MAX_PLACEHOLDERS && (m = UNDERSCORE_RE.exec(head)) !== null) {
      const idx = m.index;
      const run = m[0];
      const before = idx > 0 ? head.charAt(idx - 1) : '';
      const after = head.charAt(idx + run.length);
      guardZeroWidth(UNDERSCORE_RE, m);
      if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue; // foo___bar identifier
      let lineStart = head.lastIndexOf('\n', idx - 1);
      lineStart = lineStart < 0 ? 0 : lineStart + 1;
      let lineEnd = head.indexOf('\n', idx);
      if (lineEnd < 0) lineEnd = head.length;
      const line = head.slice(lineStart, lineEnd);
      if (line.replace(/[_\s]/g, '').length === 0) continue; // a lone rule line, not a blank
      add(run, 'high');
    }

    // Bare all-caps prose markers (LOW) — not the bracketed/angle/mustache variants
    BARE_MARKER_RE.lastIndex = 0;
    while (out.length < MAX_PLACEHOLDERS && (m = BARE_MARKER_RE.exec(head)) !== null) {
      add(m[2], 'low');
      guardZeroWidth(BARE_MARKER_RE, m);
    }
  } catch {
    // Any unforeseen scan error — return whatever was safely collected so far.
  }

  return out;
}

// ─── Fence analysis ──────────────────────────────────────────────────────────

interface FenceInfo {
  /** Info strings of each empty (opened-and-closed-with-no-body) fence. */
  emptyFenceLangs: string[];
  /** Info string of the still-open fence at EOF, if any (for unclosed evidence). */
  openLang: string;
}

/** Line-scan `head` (EOL-normalized) pairing fences to find empty ones + a trailing
 *  unclosed one. Bounded to MAX_FENCE_LINES. Never throws. */
function analyzeFences(head: string): FenceInfo {
  const emptyFenceLangs: string[] = [];
  let openLang = '';
  try {
    const lines = head.split('\n');
    const cap = Math.min(lines.length, MAX_FENCE_LINES);
    let inFence = false;
    let fenceChar = '';
    let fenceLen = 0;
    let lang = '';
    let bodyHasContent = false;
    for (let i = 0; i < cap; i++) {
      const line = lines[i];
      if (!inFence) {
        const om = FENCE_OPEN_RE.exec(line);
        if (om) {
          inFence = true;
          fenceChar = om[1].charAt(0);
          fenceLen = om[1].length;
          lang = sanitizeLang(om[2] || '');
          bodyHasContent = false;
        }
      } else {
        const cm = FENCE_CLOSE_RE.exec(line);
        if (cm && cm[1].charAt(0) === fenceChar && cm[1].length >= fenceLen) {
          if (!bodyHasContent && emptyFenceLangs.length < 64) emptyFenceLangs.push(lang);
          inFence = false;
        } else if (line.trim().length > 0) {
          bodyHasContent = true;
        }
      }
    }
    if (inFence) openLang = lang;
  } catch {
    // fall through with whatever was collected
  }
  return { emptyFenceLangs, openLang };
}

// ─── Dangling / promise (tail) detection ─────────────────────────────────────

/** The last non-empty line of `s`. */
function lastNonEmptyLine(s: string): string {
  const lines = s.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim().length > 0) return lines[i];
  }
  return '';
}

/** Count occurrences of a single char in `s` (bounded input). */
function countChar(s: string, ch: string): number {
  let c = 0;
  for (let i = 0; i < s.length; i++) if (s.charAt(i) === ch) c += 1;
  return c;
}

/** Strip trailing blank + fence-marker lines so an empty ```…``` after a delivery
 *  lead-in still reads as "nothing delivered". Bounded pops. */
function stripTrailingFenceScaffold(s: string): string {
  const lines = s.split('\n');
  let end = lines.length;
  let popped = 0;
  while (end > 0 && popped < 20) {
    const last = lines[end - 1];
    if (last.trim() === '' || FENCE_MARKER_RE.test(last)) {
      end -= 1;
      popped += 1;
    } else {
      break;
    }
  }
  return lines.slice(0, end).join('\n');
}

/** Detect a delivery lead-in that ENDS the (EOL-normalized) tail with nothing after
 *  it. Returns the matched phrase or null. */
function detectPromise(tail: string): string | null {
  try {
    const core = stripTrailingFenceScaffold(tail).replace(/\s+$/, '');
    if (!core) return null;
    for (const re of PROMISE_END_RES) {
      re.lastIndex = 0;
      const m = re.exec(core);
      if (m) return m[0];
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Unbacked-action-claim detection ─────────────────────────────────────────

/** Read the tool-name list off a (verified) array without ever throwing. Accepts
 *  strings, or objects with a string `name`/`tool`. Bounded + lowercased. */
function readToolNames(arr: unknown[]): string[] {
  const out: string[] = [];
  let len = 0;
  try {
    len = arr.length;
  } catch {
    return out;
  }
  const cap = Math.min(typeof len === 'number' && len >= 0 ? len : 0, MAX_TOOLS);
  for (let i = 0; i < cap; i++) {
    let v: unknown;
    try {
      v = arr[i];
    } catch {
      continue;
    }
    if (typeof v === 'string') {
      out.push(v.slice(0, MAX_TOOL_NAME).toLowerCase());
    } else if (v && typeof v === 'object') {
      try {
        const n = (v as { name?: unknown; tool?: unknown }).name ?? (v as { tool?: unknown }).tool;
        if (typeof n === 'string') out.push(n.slice(0, MAX_TOOL_NAME).toLowerCase());
      } catch {
        // hostile getter on an entry — skip it
      }
    }
  }
  return out;
}

/** True when any tool name matches a category's backing pattern. */
function toolsBack(names: string[], re: RegExp): boolean {
  for (const n of names) {
    re.lastIndex = 0;
    if (re.test(n)) return true;
  }
  return false;
}

/** Find past-tense completion claims in `scan` that NO listed tool backs. */
function detectUnbackedClaims(scan: string, toolNames: string[]): string[] {
  const out: string[] = [];
  try {
    for (const cat of CLAIM_CATEGORIES) {
      cat.claimRe.lastIndex = 0;
      const m = cat.claimRe.exec(scan);
      if (!m) continue;
      if (toolsBack(toolNames, cat.toolRe)) continue; // an actual tool backs it → fine
      const evidence = scrubEvidence(m[0]);
      if (evidence) out.push(evidence);
    }
  } catch {
    // fall through with whatever was collected
  }
  return out;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/**
 * True when `text` has an UNCLOSED code fence — an odd number of ``` (or ~~~) fence
 * markers, per marker char, in the first MAX_SCAN_CHARS. An unclosed fence both
 * breaks markdown rendering and signals a truncated answer. Non-strings / empty →
 * false. Bounded; never throws.
 */
export function hasUnclosedCodeFence(text: unknown): boolean {
  try {
    if (typeof text !== 'string' || text.length === 0) return false;
    const src = normEol(text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text);
    const lines = src.split('\n');
    const cap = Math.min(lines.length, MAX_FENCE_LINES);
    let backticks = 0;
    let tildes = 0;
    for (let i = 0; i < cap; i++) {
      const m = FENCE_MARKER_RE.exec(lines[i]);
      if (!m) continue;
      if (m[1].charAt(0) === '`') backticks += 1;
      else tildes += 1;
    }
    return backticks % 2 === 1 || tildes % 2 === 1;
  } catch {
    return false;
  }
}

/**
 * True when `text` ends mid-thought: the final word is a trailing conjunction /
 * preposition / relativizer (and, to, because, the, …), OR it ends on an open
 * bracket `([{`, a bare `:`/`,`/`-`/`–`/`—`, or an unmatched quote. FALSE — a
 * well-formed end — when it ends on a code fence, a list item, a table row, a URL,
 * or terminal sentence punctuation (`.`/`!`/`?`, ignoring trailing quotes/brackets).
 * Conservative by design (a false positive would nag a good answer). Operates on the
 * tail only. Non-strings → false; never throws.
 */
export function endsDangling(text: unknown): boolean {
  try {
    if (typeof text !== 'string' || text.length === 0) return false;
    const raw = text.length > TAIL_SCAN_MAX ? text.slice(text.length - TAIL_SCAN_MAX) : text;
    const trimmed = normEol(raw).replace(/\s+$/, '');
    if (trimmed.length === 0) return false;

    // FALSE: a well-formed structural end.
    const lastLine = lastNonEmptyLine(trimmed);
    if (lastLine) {
      if (FENCE_MARKER_RE.test(lastLine)) return false; // ends on a code fence
      if (LIST_ITEM_RE.test(lastLine)) return false; // ends on a list item
      if (TABLE_ROW_RE.test(lastLine)) return false; // ends on a table row
    }
    const lastToken = (trimmed.match(/\S+$/) || [''])[0];
    if (/^https?:\/\//i.test(lastToken)) return false; // ends on a URL

    // FALSE: terminal sentence punctuation, ignoring trailing quotes/close-brackets.
    const stripped = trimmed.replace(/[)\]}"'”’»›`]+$/, '');
    const lastStripped = stripped.slice(-1);
    if (lastStripped === '.' || lastStripped === '!' || lastStripped === '?') return false;

    // TRUE: a dangling structural end.
    const lastRaw = trimmed.slice(-1);
    if (lastRaw === '(' || lastRaw === '[' || lastRaw === '{') return true; // open bracket
    if (
      lastRaw === ':' || lastRaw === ',' || lastRaw === '-' ||
      lastRaw === '–' || lastRaw === '—'
    ) {
      return true; // bare separator / dash
    }

    // TRUE: a trailing conjunction / preposition word.
    const wordCore = trimmed.replace(/[^A-Za-z]+$/, '');
    const wm = wordCore.match(/[A-Za-z]+$/);
    if (wm && DANGLING_WORDS.has(wm[0].toLowerCase())) return true;

    // TRUE: an unmatched trailing quote (opened a quotation, said nothing).
    if (lastRaw === '"' || lastRaw === "'" || lastRaw === '`') {
      if (countChar(trimmed, lastRaw) % 2 === 1) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * The distinct template placeholders left in `text` — bracketed/angle/mustache/
 * underscore HIGH tokens and bare all-caps LOW markers — each scrubbed, redacted,
 * and clamped to EVIDENCE_MAX, deduped, bounded to MAX_PLACEHOLDERS. Non-strings /
 * empty → []. Never throws.
 */
export function findPlaceholders(text: unknown): string[] {
  try {
    if (typeof text !== 'string' || text.length === 0) return [];
    const head = normEol(text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text);
    const out: string[] = [];
    const seen = new Set<string>();
    for (const p of collectPlaceholders(head)) {
      if (seen.has(p.evidence)) continue;
      seen.add(p.evidence);
      out.push(p.evidence);
      if (out.length >= MAX_PLACEHOLDERS) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Reduce a defect list to the advisory flag: any HIGH → 'incomplete'; else any LOW →
 * 'review'; else 'ok'. Total — a non-array or malformed/hostile entry contributes
 * nothing and never throws.
 */
export function selfCheckFlag(defects: unknown): ResponseSelfCheckFlag {
  try {
    if (!Array.isArray(defects)) return 'ok';
    let anyLow = false;
    for (const d of defects) {
      const sev = readSeverity(d);
      if (sev === 'high') return 'incomplete';
      if (sev === 'low') anyLow = true;
    }
    return anyLow ? 'review' : 'ok';
  } catch {
    return 'ok';
  }
}

/** Dedupe defects by severity+kind+evidence, preserving first-seen order. */
function dedupeDefects(defects: ResponseDefect[]): ResponseDefect[] {
  const out: ResponseDefect[] = [];
  const seen = new Set<string>();
  for (const d of defects) {
    const key = d.severity + '::' + d.kind + '::' + d.evidence;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(d);
  }
  return out;
}

/**
 * Scan a DRAFT final answer for self-inflicted, structurally-detectable defects
 * before it ships. Runs placeholder + fence checks on head=first MAX_SCAN_CHARS and
 * dangling + promise checks on tail=last TAIL_WINDOW chars from the true end; runs
 * the opt-in unbacked-action-claim check ONLY when `toolCallsUsed` is an array.
 * Dedupes, sorts high-severity-first, caps at MAX_DEFECTS, and derives the advisory
 * flag. ADVISORY — never edits/suppresses the answer.
 *
 * TOTAL: any input shape (null / non-object / huge / cyclic / Proxy / throwing
 * getters / bigint) yields a valid bounded result and never throws. Deterministic;
 * secret-safe.
 */
export function scanResponseForDefects(input: unknown): ResponseSelfCheckResult {
  try {
    let responseTextRaw: unknown;
    let toolCallsRaw: unknown;
    if (input && typeof input === 'object') {
      try {
        responseTextRaw = (input as ResponseSelfCheckInput).responseText;
      } catch {
        responseTextRaw = undefined;
      }
      try {
        toolCallsRaw = (input as ResponseSelfCheckInput).toolCallsUsed;
      } catch {
        toolCallsRaw = undefined;
      }
    }

    const text = typeof responseTextRaw === 'string' ? responseTextRaw : '';
    if (text.length === 0) return neutralResult();

    const head = normEol(text.length > MAX_SCAN_CHARS ? text.slice(0, MAX_SCAN_CHARS) : text);
    const tail = normEol(text.length > TAIL_WINDOW ? text.slice(text.length - TAIL_WINDOW) : text);

    const defects: ResponseDefect[] = [];

    // Placeholders (head).
    for (const p of collectPlaceholders(head)) {
      defects.push({ kind: 'unfilled_placeholder', severity: p.severity, evidence: p.evidence });
    }

    // Fences (head).
    const fences = analyzeFences(head);
    for (const lang of fences.emptyFenceLangs) {
      defects.push({
        kind: 'empty_code_fence',
        severity: 'high',
        evidence: scrubEvidence('empty ' + (lang || 'code') + ' fence'),
      });
    }
    if (hasUnclosedCodeFence(head)) {
      defects.push({
        kind: 'unclosed_code_fence',
        severity: 'high',
        evidence: scrubEvidence('unclosed ' + (fences.openLang || 'code') + ' fence'),
      });
    }

    // Promise-without-delivery (tail).
    const promise = detectPromise(tail);
    if (promise) {
      defects.push({ kind: 'promise_without_delivery', severity: 'high', evidence: scrubEvidence(promise) });
    }

    // Dangling final sentence (tail).
    if (endsDangling(tail)) {
      const snippet = tail.length > EVIDENCE_MAX * 2 ? tail.slice(tail.length - EVIDENCE_MAX * 2) : tail;
      defects.push({ kind: 'dangling_sentence', severity: 'high', evidence: scrubEvidence(snippet) });
    }

    // Unbacked action claims (opt-in: only when toolCallsUsed is an array).
    if (Array.isArray(toolCallsRaw)) {
      const toolNames = readToolNames(toolCallsRaw);
      const scan = head.length > MAX_CLAIM_SCAN ? head.slice(0, MAX_CLAIM_SCAN) : head;
      for (const evidence of detectUnbackedClaims(scan, toolNames)) {
        defects.push({ kind: 'unbacked_action_claim', severity: 'low', evidence });
      }
    }

    const deduped = dedupeDefects(defects);
    deduped.sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
    const capped = deduped.slice(0, MAX_DEFECTS);
    const flag = selfCheckFlag(capped);
    return { flag, incomplete: flag === 'incomplete', defects: capped };
  } catch {
    // Total contract: any unforeseen input shape yields the safe neutral result.
    return neutralResult();
  }
}
