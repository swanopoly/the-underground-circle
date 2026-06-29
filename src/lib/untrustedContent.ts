/**
 * untrustedContent — canonical helper for fencing model-visible content that
 * came from an UNTRUSTED source: circle members, external chat/Discord, room
 * messages, retrieved memory, tool/observation output, uploaded files, web
 * pages. The roadmap's untrusted-content rule requires such content be wrapped
 * so the model treats it as DATA to read, never as instructions to follow —
 * even if it looks like a command or a system message.
 *
 * Why a shared helper (vs. inline `<untrusted_quoted>…</…>`): the inline form
 * scattered across the prompt builders does NOT defang nested fence markers,
 * so a member who types `</untrusted_quoted>` into their note/name/message
 * could close the fence early and smuggle the rest of their text out as
 * trusted instructions. `wrapUntrusted` strips those markers first, closing
 * that injection hole. Pure + dependency-free so it stays smoke-testable and
 * importable anywhere.
 */

export const UNTRUSTED_OPEN = '<untrusted_quoted>';
export const UNTRUSTED_CLOSE = '</untrusted_quoted>';

// Matches the fence marker incl. spaced/cased variants (`< / untrusted_quoted >`,
// `</UNTRUSTED_QUOTED>`). Defined as a source string so each use gets a FRESH
// regex — a shared `/g` regex carries `lastIndex` state across .test()/.replace()
// and would intermittently miss matches.
const FENCE_MARKER_SOURCE = '<\\s*\\/?\\s*untrusted_quoted\\s*>';

export interface WrapUntrustedOptions {
  /** Optional trusted heading placed ABOVE the fence (never inside it). */
  heading?: string;
  /** Truncate the fenced body to this many chars (adds an ellipsis). */
  maxChars?: number;
}

/**
 * Wrap untrusted content in an `<untrusted_quoted>` fence. Returns '' for
 * empty/blank input so callers can push unconditionally and filter. Any
 * nested fence markers in the content are stripped first so embedded text
 * cannot escape the fence.
 */
export function wrapUntrusted(
  content: string | null | undefined,
  opts: WrapUntrustedOptions = {},
): string {
  const raw = String(content ?? '').trim();
  if (!raw) return '';
  let body = raw.replace(new RegExp(FENCE_MARKER_SOURCE, 'gi'), '');
  if (opts.maxChars && opts.maxChars > 0 && body.length > opts.maxChars) {
    body = `${body.slice(0, opts.maxChars)}…`;
  }
  const fenced = `${UNTRUSTED_OPEN}\n${body}\n${UNTRUSTED_CLOSE}`;
  return opts.heading ? `${opts.heading}\n${fenced}` : fenced;
}

/** True if the text contains a fence marker (e.g. to detect smuggling attempts). */
export function containsFenceMarker(content: string | null | undefined): boolean {
  return new RegExp(FENCE_MARKER_SOURCE, 'i').test(String(content ?? ''));
}
