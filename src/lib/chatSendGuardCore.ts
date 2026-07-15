// chatSendGuardCore — the PURE pre-send input guard for SwanBot chat.
//
// Finding it fixes: the send box is the first place a user can be silently
// blocked or forced through hoops. Today an empty send does nothing (no
// feedback), and pasting a 40KB blob or a raw stack trace goes straight into
// the transcript — bloating the persisted message row (CLAUDE.md warns to keep
// payloads bounded) and burying the actual question. This core is the tiny,
// deterministic gate the send handler runs FIRST: it returns one of three
// verdicts —
//   • 'block'   → only the genuinely-nothing case (empty / whitespace-only AND
//                 no attachment); the hint tells the user exactly what to do.
//   • 'confirm' → a soft, one-tap check for two high-value moments: a HUGE
//                 paste (offer to attach-as-file so it doesn't crowd chat) and
//                 a pasted STACK TRACE / error dump (offer to debug it).
//   • 'send'    → everything else, including empty text WHEN a file is attached.
//
// DESIGN BIAS (load-bearing): BIAS HARD TO 'send'. A guard that gets in the
// way is worse than the problem it solves. 'block' is reserved for the one case
// where there is literally nothing to send; 'confirm' never blocks — it is a
// helpful nudge with an obvious "send as-is" escape hatch — and any doubt, any
// unrecognized shape, any internal error all resolve to 'send'.
//
// PURITY (load-bearing — the smoke runs under tsx/esbuild, which CANNOT load
// react-native): ZERO runtime imports. No app modules, supabase, or
// react-native. No Date.now()/Math.random(); no top-level side effects. Every
// export is TOTAL — never throws on any input (null/undefined/number/huge/
// hostile) and returns a safe neutral verdict (send). Output is bounded: the
// hint/reason strings are fixed constants and scanning is capped.

// ── Types ────────────────────────────────────────────────────────────────────

export type SendGuardAction = 'send' | 'block' | 'confirm';

export interface SendGuardVerdict {
  /** What the send handler should do: proceed, hard-stop, or ask one question. */
  action: SendGuardAction;
  /** Short machine reason for the decision (audit/debug; never secret). */
  reason: string;
  /** User-facing one-liner. '' for a plain 'send'; the ask/notice otherwise. */
  hint: string;
}

export interface SendGuardOptions {
  /** True when a file/image is staged — empty text is then a valid "open it". */
  hasAttachment?: boolean;
}

// ── Tunables (exported where wiring + smokes share the exact bounds) ─────────

/** A paste larger than this (chars) triggers the "attach as a file?" confirm. */
export const HUGE_PASTE_THRESHOLD = 8000;

/**
 * The largest message we bother to reason about in full. Beyond this we still
 * send/confirm correctly (the huge-paste check uses the raw length), but error
 * scanning only inspects the first MAX_REASONABLE_MESSAGE chars — plenty to
 * recognize a stack trace, and a hard cap so a hostile megabyte paste stays
 * cheap. Also a documented "this is already a lot" reference bound.
 */
export const MAX_REASONABLE_MESSAGE = 20000;

// ── Fixed user-facing copy (bounded output) ──────────────────────────────────

const HINT_EMPTY = 'Type a message or attach a file.';
const HINT_HUGE_PASTE =
  "That's a large paste — send it, or attach it as a file so it doesn't crowd the chat?";
const HINT_ERROR_DUMP = 'Looks like an error — want me to debug it?';

// ── Bounds for the error scan ────────────────────────────────────────────────

/** Max lines inspected when classifying an error dump (junk armor). */
const MAX_ERROR_LINES = 500;
/** Max chars of any single line inspected (junk armor). */
const MAX_LINE_CHARS = 500;
/** Frame/header counts we bother to accumulate to (bounded work). */
const MAX_SIGNAL_COUNT = 8;

// ── Error-dump signal regexes (all anchored / URL-safe, no lookbehind) ───────

// A real `file.ext:line[:col]` token (e.g. src/foo.ts:12:5, Main.java:8,
// index.js:10:15). The extension must START with a letter so IPs/ports like
// 127.0.0.1:5432 do not match. URLs are stripped from the line first so a
// host:port like example.com:8080 cannot masquerade as a file:line.
const FILE_LINE_RE = /[\w$./\\-]+\.[a-z][a-z0-9]*:\d+(?::\d+)?/i;

// A V8/JVM-style "    at <frame> (<location:line>)" line. Requires a
// parenthesized colon-number so English lines ("at 5:30 (ish)", "at the store
// (downtown)") are NOT mistaken for frames.
const AT_FRAME_RE = /^at\s+\S.*\([^)]*:\d+[^)]*\)/i;

// A Python `File "x.py", line N` frame line.
const PY_FRAME_RE = /^file\s+["'][^"']+["'],?\s*line\s+\d+/i;

// A Python traceback header.
const TRACEBACK_RE = /^traceback\s*\(most recent call last\)\s*:?/i;

// A typed error/exception header that essentially never appears in casual
// prose: a CamelCase-ish "<Something>Error"/"<Something>Exception" token, or a
// bare "Error:/Exception:/Fatal:/Panic:" with the colon (the JS/Go default).
// Bare "error" (no suffix, no colon) is intentionally NOT a header.
const ERROR_HEADER_RE =
  /(?:\b[a-z_][a-z0-9_]*(?:error|exception)\b|(?:^|\s)(?:error|exception|fatal|panic|assertionerror|segmentation fault)\s*:)/i;

// Strip scheme URLs before frame detection so host:port isn't read as file:line.
const URL_RE = /https?:\/\/\S+/gi;

// ── Small total helpers ──────────────────────────────────────────────────────

function readHasAttachment(opts: unknown): boolean {
  if (!opts || typeof opts !== 'object') return false;
  try {
    return (opts as { hasAttachment?: unknown }).hasAttachment === true;
  } catch {
    return false;
  }
}

function verdict(action: SendGuardAction, reason: string, hint: string): SendGuardVerdict {
  // Fresh object every call — a caller mutating one verdict cannot poison the next.
  return { action, reason, hint };
}

// ── Exports ──────────────────────────────────────────────────────────────────

/**
 * True when `message` reads like a pasted STACK TRACE / error dump — multiple
 * lines carrying stack frames ("    at fn (file.js:10:5)", Python `File "x.py",
 * line N`, `foo.ts:12:5`) and/or a typed error header (TypeError:, Traceback,
 * NullPointerException, "Error:", "panic:"). Deliberately CONSERVATIVE so it
 * does not fire on ordinary chat that merely mentions "an error": a lone line,
 * or a bare word "error", is never enough. Non-strings / junk → false. Total.
 */
export function looksLikeErrorDump(message: unknown): boolean {
  try {
    if (typeof message !== 'string') return false;
    const text = message.length > MAX_REASONABLE_MESSAGE
      ? message.slice(0, MAX_REASONABLE_MESSAGE)
      : message;
    const lines = text.split(/\r\n|\r|\n/);
    // A single line is almost always conversation, even if it says "Error:".
    if (lines.length < 2) return false;

    let frames = 0;
    let headers = 0;
    const limit = Math.min(lines.length, MAX_ERROR_LINES);
    for (let i = 0; i < limit; i += 1) {
      let line = lines[i];
      if (typeof line !== 'string' || !line) continue;
      if (line.length > MAX_LINE_CHARS) line = line.slice(0, MAX_LINE_CHARS);
      const trimmed = line.replace(URL_RE, ' ').trim();
      if (!trimmed) continue;

      // Classify each line as at most ONE signal (frame first, then header).
      if (
        AT_FRAME_RE.test(trimmed)
        || PY_FRAME_RE.test(trimmed)
        || FILE_LINE_RE.test(trimmed)
      ) {
        if (frames < MAX_SIGNAL_COUNT) frames += 1;
        continue;
      }
      if (TRACEBACK_RE.test(trimmed) || ERROR_HEADER_RE.test(trimmed)) {
        if (headers < MAX_SIGNAL_COUNT) headers += 1;
      }

      if (frames >= 2 || (frames >= 1 && headers >= 1)) break; // early out
    }

    // Two independent frames, OR a typed header plus at least one frame.
    return frames >= 2 || (frames >= 1 && headers >= 1);
  } catch {
    return false;
  }
}

/**
 * Pre-send gate. Total + deterministic. Runs FIRST in the send handler:
 *   • empty / whitespace-only AND no attachment → 'block' (hint: what to do).
 *   • empty text WITH an attachment             → 'send' (open the file).
 *   • a pasted stack trace / error dump         → 'confirm' (offer to debug).
 *   • a HUGE paste (> HUGE_PASTE_THRESHOLD)      → 'confirm' (offer attach-as-file).
 *   • everything else                           → 'send'.
 * Any doubt, any unrecognized/hostile input, any internal error → 'send'.
 */
export function guardChatSend(message: unknown, opts?: SendGuardOptions): SendGuardVerdict {
  try {
    const hasAttachment = readHasAttachment(opts);
    const text = typeof message === 'string' ? message : '';

    // 1) Nothing to send. Block ONLY when there's also no attachment.
    if (text.trim().length === 0) {
      return hasAttachment
        ? verdict('send', 'empty-with-attachment', '')
        : verdict('block', 'empty-no-attachment', HINT_EMPTY);
    }

    // 2) A pasted error dump — the most helpful nudge, so it wins even when the
    //    dump is also huge (offering to debug beats offering to file it away).
    if (looksLikeErrorDump(text)) {
      return verdict('confirm', 'error-dump', HINT_ERROR_DUMP);
    }

    // 3) A huge non-error paste — offer to attach it so it doesn't crowd chat.
    //    Uses the RAW length so a megabyte paste is still caught.
    if (text.length > HUGE_PASTE_THRESHOLD) {
      return verdict('confirm', 'huge-paste', HINT_HUGE_PASTE);
    }

    // 4) Bias hard to send.
    return verdict('send', 'ok', '');
  } catch {
    // Never let our own guard be the thing that blocks a user.
    return verdict('send', 'guard-error', '');
  }
}
