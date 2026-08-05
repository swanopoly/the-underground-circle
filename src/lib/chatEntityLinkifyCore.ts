// chatEntityLinkifyCore — the PURE span detector that finds the actionable
// entities inside a chat message body so the renderer can make them tappable.
// Today a bot reply that mentions a URL, a local file path, an `@file:`/
// `@symbol:` mention, or a task id renders as flat, un-tappable text. This module
// reads the message text and returns typed, non-overlapping character spans; it
// does NOT open, fetch, resolve, or validate anything — the renderer/bridge does.
//
// Four kinds are recognized, emitted in order of appearance in the text:
//   - url:      http(s):// URLs (trailing sentence punctuation trimmed)
//   - filepath: unix-ish paths — absolute (`/Users/x`), dot-relative (`./x`,
//               `../lib/y.ts`), or a bare relative path WITH a file extension
//               (`src/lib/foo.ts`). Bare relatives without an extension
//               (`src/lib`) and slash-pairs that are not paths (`and/or`, `I/O`,
//               `TCP/IP`, dates `12/25/2026`) are NOT matched — a false file link
//               is worse than a miss.
//   - mention:  `@file:PATH` / `@symbol:NAME` (case-insensitive prefix; quoted
//               values keep spaces; trailing punctuation stripped; mid-word
//               `x@file:y` ignored). target is the arg (PATH or NAME).
//   - task_ref: `task #<4-8 hex>` (the word "task" lets a short id through) or a
//               bare `#<8 hex>`. The span covers the `#…` token; target is the
//               hex id. A 6-hex CSS color (`#1a2b3c`) is NOT a task ref.
//
// Overlap: spans never overlap. Where entities nest (a `@file:` mention contains
// a file path; a URL contains a `#frag` that looks like a task ref) the entity
// that STARTS FIRST wins and the contained one is dropped ("first match wins").
//
// PURITY: zero imports, tsx-loadable (smoke: chat-entity-linkify-core).
// DETERMINISTIC (no Date.now / Math.random / module-scope state). Every export is
// TOTAL — a non-string, empty, huge, or hostile input yields [] and never throws.
// Output is bounded (MAX_SPANS) and every span satisfies
// `text.slice(span.start, span.end) === span.text`.

export type ChatEntityKind = 'url' | 'filepath' | 'mention' | 'task_ref';

export interface ChatEntitySpan {
  kind: ChatEntityKind;
  /** The exact tappable substring as it appears in the text. */
  text: string;
  /** Inclusive char offset where the span starts. */
  start: number;
  /** Exclusive char offset where the span ends (`text.slice(start,end)===text`). */
  end: number;
  /** The actionable value: url, path, mention arg, or task id (hex, no `#`). */
  target: string;
}

// ── Bounds (keep detection + output bounded on hostile input) ─────────────────────
const MAX_TEXT_LEN = 100_000;
const MAX_SPANS = 100;
const MAX_PER_DETECTOR = 2_000;

// ── Patterns ──────────────────────────────────────────────────────────────────────

// http/https URLs. Stop at whitespace and the wrapping/quote chars a URL never
// starts a new token with; trailing sentence punctuation is trimmed in code.
const URL_RE = /https?:\/\/[^\s<>()"'`\]]+/gi;

// `@file:` / `@symbol:` (any case). g2 = quoted inner value, g3 = bare value.
const MENTION_RE = /@(file|symbol):(?:"([^"\n]*)"|(\S+))/gi;

// unix-ish paths. Left boundary (?<!path-char) stops a mid-token start. Three
// shapes: dot-relative (`./x`, `../a/b`), absolute (`/a/b`), bare-relative
// (`a/b`, validated for an extension in code so `and/or` is rejected).
const PATH_BODY = 'A-Za-z0-9._~+-';
const PATH_RE = new RegExp(
  `(?<![${PATH_BODY}/@])` +
    `(?:` +
    `\\.\\.?\\/[${PATH_BODY}]+(?:\\/[${PATH_BODY}]+)*` + // ./x  ../a/b
    `|\\/[${PATH_BODY}]+(?:\\/[${PATH_BODY}]+)*` + //        /a/b
    `|[${PATH_BODY}]+(?:\\/[${PATH_BODY}]+)+` + //          a/b (>=1 slash)
    `)`,
  'g',
);

// Task refs. Context form: the word "task" lets a short (4-8 hex) id through.
// Bare form: a lone `#` + exactly 8 hex (so a 6-hex CSS color never matches).
const TASK_CTX_RE = /\btask\s+#([0-9a-fA-F]{4,8})(?![0-9a-fA-F])/gi;
const TASK_BARE_RE = /(?<![0-9A-Za-z#&])#([0-9a-fA-F]{8})(?![0-9a-fA-F])/g;

// Trailing punctuation trimmed off a URL (never part of the link).
const URL_TRAILING_RE = /[.,;:!?]+$/;
// Trailing punctuation trimmed off a bare path / mention value.
const PATH_TRAILING_RE = /[.,;:!?)]+$/;
const MENTION_TRAILING = new Set(['.', ',', ';', ':', '!', '?', ')']);
// A bare relative path is only a path if its final segment has an extension.
// Require the final extension to contain at least one LETTER (still 1-10 alnum to
// end), so a decimal suffix like `3.5`/`4.0`/`.2026` is NOT treated as a file ext
// (which would false-link a bare relative path). Compound exts (`.min.js`) + digit
// exts (`.mp4`, `.7z`, `.h264`) still match.
const FINAL_EXT_RE = /\.(?=[A-Za-z0-9]{1,10}$)[A-Za-z0-9]*[A-Za-z][A-Za-z0-9]*$/;

// Priority is a tie-break for the (near-impossible) same-start+end collision only;
// real nesting is resolved by start position. Lower = kept first.
const PRIORITY: Record<ChatEntityKind, number> = { url: 0, mention: 1, filepath: 2, task_ref: 3 };

interface Candidate {
  start: number;
  end: number;
  priority: number;
  span: ChatEntitySpan;
}

function isAlnum(ch: string): boolean {
  return ch >= '0' && ch <= '9'
    ? true
    : (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z');
}

/** Guarded regex sweep — collects matches; never throws; bounded + zero-width safe. */
function scan(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  try {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null) {
      if (guard++ >= MAX_PER_DETECTOR) break;
      out.push(m);
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  } catch {
    return out;
  }
  return out;
}

function pushSpan(
  out: Candidate[],
  kind: ChatEntityKind,
  start: number,
  text: string,
  target: string,
): void {
  if (text.length === 0) return;
  const end = start + text.length;
  out.push({ start, end, priority: PRIORITY[kind], span: { kind, text, start, end, target } });
}

function collectUrls(text: string, out: Candidate[]): void {
  for (const m of scan(URL_RE, text)) {
    const trimmed = m[0].replace(URL_TRAILING_RE, '');
    pushSpan(out, 'url', m.index, trimmed, trimmed);
  }
}

function collectMentions(text: string, out: Candidate[]): void {
  for (const m of scan(MENTION_RE, text)) {
    // Mid-word guard: `@` must sit at the start or after a non-alphanumeric char.
    if (m.index > 0 && isAlnum(text[m.index - 1])) continue;

    const kind = m[1].toLowerCase();
    const quoted = m[2];
    let value: string;
    let rawText: string;

    if (typeof quoted === 'string') {
      value = quoted.trim();
      rawText = m[0];
    } else {
      let bare = m[3] ?? '';
      let stripped = 0;
      while (bare.length > 0 && MENTION_TRAILING.has(bare[bare.length - 1])) {
        bare = bare.slice(0, -1);
        stripped += 1;
      }
      value = bare;
      rawText = m[0].slice(0, m[0].length - stripped);
    }

    if (value.length === 0) continue;
    // Guard against a kind that isn't the literal @file:/@symbol: we highlight.
    void kind;
    pushSpan(out, 'mention', m.index, rawText, value);
  }
}

function collectPaths(text: string, out: Candidate[]): void {
  for (const m of scan(PATH_RE, text)) {
    const trimmed = m[0].replace(PATH_TRAILING_RE, '');
    if (trimmed.length === 0 || !trimmed.includes('/')) continue;

    const isAbsolute = trimmed.startsWith('/');
    const isDotRelative = trimmed.startsWith('./') || trimmed.startsWith('../');
    if (!isAbsolute && !isDotRelative && !FINAL_EXT_RE.test(trimmed)) {
      // Bare relative without a file extension → likely `and/or`, `I/O`, a date.
      continue;
    }
    pushSpan(out, 'filepath', m.index, trimmed, trimmed);
  }
}

function collectTaskRefs(text: string, out: Candidate[]): void {
  for (const m of scan(TASK_CTX_RE, text)) {
    const hex = m[1];
    const hashOffset = m[0].indexOf('#');
    if (hashOffset < 0 || typeof hex !== 'string') continue;
    pushSpan(out, 'task_ref', m.index + hashOffset, `#${hex}`, hex);
  }
  for (const m of scan(TASK_BARE_RE, text)) {
    const hex = m[1];
    if (typeof hex !== 'string') continue;
    pushSpan(out, 'task_ref', m.index, `#${hex}`, hex);
  }
}

/** Sort candidates and greedily keep the first (leftmost) of any overlapping set. */
function resolveNonOverlapping(cands: Candidate[]): ChatEntitySpan[] {
  cands.sort((a, b) => a.start - b.start || b.end - a.end || a.priority - b.priority);
  const out: ChatEntitySpan[] = [];
  let maxEnd = -1;
  for (const c of cands) {
    if (c.start < maxEnd) continue; // overlaps an already-accepted span
    out.push(c.span);
    maxEnd = c.end > maxEnd ? c.end : maxEnd;
    if (out.length >= MAX_SPANS) break;
  }
  return out;
}

/**
 * Detect the tappable entities in a chat message body: http(s) URLs, unix-ish
 * file paths, `@file:`/`@symbol:` mentions, and task refs. Returns non-overlapping
 * spans in order of appearance, capped at MAX_SPANS. Pure + total: a non-string /
 * empty / hostile input yields []. Every span satisfies
 * `text.slice(span.start, span.end) === span.text`.
 */
export function detectChatEntities(text: unknown): ChatEntitySpan[] {
  if (typeof text !== 'string' || text.length === 0) return [];
  const body = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text;

  const cands: Candidate[] = [];
  try {
    collectUrls(body, cands);
    collectMentions(body, cands);
    collectPaths(body, cands);
    collectTaskRefs(body, cands);
  } catch {
    // Fall through with whatever was collected before the (unexpected) throw.
  }
  return resolveNonOverlapping(cands);
}

/**
 * Split the full text into alternating plain / entity chunks for direct rendering:
 * plain runs carry `entity: null`, tappable runs carry the ChatEntitySpan. The
 * concatenation of every chunk's `text` always reconstructs the original string.
 * Pure + total: a non-string / empty input yields []; there are never empty chunks.
 */
export function splitByEntities(
  text: unknown,
): Array<{ text: string; entity: ChatEntitySpan | null }> {
  if (typeof text !== 'string' || text.length === 0) return [];

  const spans = detectChatEntities(text);
  const out: Array<{ text: string; entity: ChatEntitySpan | null }> = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) out.push({ text: text.slice(cursor, span.start), entity: null });
    out.push({ text: text.slice(span.start, span.end), entity: span });
    cursor = span.end;
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), entity: null });
  return out;
}
