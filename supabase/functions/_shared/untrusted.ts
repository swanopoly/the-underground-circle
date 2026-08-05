/**
 * Shared untrusted-content fence for edge functions (Deno).
 *
 * Mirror of src/lib/untrustedContent.ts — kept as a separate copy because edge
 * functions cannot import from the app's RN-flavoured src/ tree. Wrap any
 * model-visible content that came from an UNTRUSTED source (circle members,
 * chat/Discord, room messages, retrieved memory, web pages) so the model treats
 * it as DATA to read, never instructions to follow.
 *
 * Why not raw `<untrusted_quoted>${content}</…>` interpolation: that does NOT
 * strip nested fence markers, so a member who writes `</untrusted_quoted>` into
 * their message/memory could close the fence early and smuggle the rest of
 * their text out as trusted instructions. wrapUntrusted strips those markers
 * first, closing that injection hole.
 */

export const UNTRUSTED_OPEN = "<untrusted_quoted>";
export const UNTRUSTED_CLOSE = "</untrusted_quoted>";

// Matches the fence marker incl. spaced/cased variants. Built as a source string
// so each call gets a FRESH regex (a shared /g regex carries lastIndex state).
const FENCE_MARKER_SOURCE = "<\\s*\\/?\\s*untrusted_quoted\\s*>";

export interface WrapUntrustedOptions {
  /** Optional trusted heading placed ABOVE the fence (never inside it). */
  heading?: string;
  /** Truncate the fenced body to this many chars (adds an ellipsis). */
  maxChars?: number;
}

/**
 * Wrap untrusted content in an `<untrusted_quoted>` fence. Returns '' for
 * empty/blank input. Nested fence markers are stripped first so embedded text
 * cannot escape the fence.
 */
export function wrapUntrusted(
  content: string | null | undefined,
  opts: WrapUntrustedOptions = {},
): string {
  const raw = String(content ?? "").trim();
  if (!raw) return "";
  let body = raw.replace(new RegExp(FENCE_MARKER_SOURCE, "gi"), "");
  if (opts.maxChars && opts.maxChars > 0 && body.length > opts.maxChars) {
    body = `${body.slice(0, opts.maxChars)}…`;
  }
  const fenced = `${UNTRUSTED_OPEN}\n${body}\n${UNTRUSTED_CLOSE}`;
  return opts.heading ? `${opts.heading}\n${fenced}` : fenced;
}
