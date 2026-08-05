/**
 * chatComposerSeedCore.ts — the cross-surface composer-seed protocol.
 *
 * WHY: empty-state chips on Feed/Office/Missions dispatch `uc:switch-tab` →
 * CHAT and then drop the user at an EMPTY composer (the gap documented at
 * FeedTab's empty state). This module defines a tiny, event-based protocol so
 * a picking surface can also pre-fill the chat composer:
 *
 *   1. The picking surface calls `buildComposerSeedDetail(seedText)`. If the
 *      seed validates, it dispatches
 *      `new CustomEvent(SEED_EVENT_NAME, { detail })` BEFORE the existing
 *      `uc:switch-tab` event (ChatTab is mounted-but-hidden under the tab
 *      switcher, so its listener is already live).
 *   2. ChatTab listens for SEED_EVENT_NAME, runs the payload through
 *      `parseComposerSeedDetail` (total — hostile/foreign event detail can
 *      never throw or inject), and calls `setInput(text)`.
 *
 * DEGRADES SAFELY: if no listener is mounted (native, old build, chat not
 * rendered) the CustomEvent is simply lost and behavior is exactly today's —
 * the user lands in Chat with an empty composer. No queue, no storage, no
 * ordering requirement beyond "seed before switch".
 *
 * PURE MODULE: no React, no react-native, no DOM, no Supabase — smoke-testable
 * under tsx/esbuild (see the "smoke tests need pure modules" memory). The
 * dispatch itself (CustomEvent) stays in the host surfaces.
 */

/** Event name for the composer-seed CustomEvent (web only, like uc:switch-tab). */
export const SEED_EVENT_NAME = 'uc:seed-composer';

/** Hard ceiling on seed length (after trim). Seeds are chip-sized starters,
 * not documents; anything longer is suspicious or a bug. */
export const SEED_TEXT_MAX = 280;

/** Validated seed payload. `caret` is a character index into `text` telling
 * the composer where to place the cursor (always end-of-text for built seeds,
 * so command seeds like `/create ` are ready for the user to keep typing). */
export interface ComposerSeedDetail {
  text: string;
  caret: number;
}

/**
 * Slash-command token shape — mirrors real chatCommandRegistry ids
 * (`/create`, `/watch`, `/room`, …): lowercase alpha start, then lowercase
 * alphanumerics/hyphens. Anything else after a leading `/` (uppercase,
 * dots, further slashes like `/bin/sh`, shell metacharacters) is rejected.
 */
const SLASH_COMMAND_TOKEN_RE = /^\/[a-z][a-z0-9-]*$/;

/**
 * Same-surface handler tokens (`office:deploy-agent`, `mission:create`, …)
 * are interpreted by their host surface, never typed into chat — seeding one
 * would paste internal routing strings into the composer. Matches a single
 * namespaced token with no spaces.
 */
const HANDLER_TOKEN_RE = /^[a-z][a-z0-9_-]*:[^\s]*$/;

/** Strip C0 controls, DEL, and C1 controls (includes \n, \r, \t — chip seeds
 * are single-line starters). */
function stripControlChars(value: string): string {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) continue;
    out += ch;
  }
  return out;
}

/**
 * Build a validated seed payload from raw chip text, or null when the seed
 * must not be forwarded. Rules:
 *   - must be a string; control characters are stripped, then trimmed
 *   - non-empty and ≤ SEED_TEXT_MAX chars after that normalization
 *   - a single `namespace:token` handler value (office:*, mission:*, …) is
 *     rejected — those are surface routing tokens, not chat text
 *   - if it starts with `/`, the first whitespace-delimited token must be a
 *     well-formed lowercase slash command (SLASH_COMMAND_TOKEN_RE) — this
 *     rejects shell-ish paths (`/bin/sh`), uppercase, and metacharacters
 *   - caret is placed at end-of-text
 *
 * NOTE: builders that want a trailing-space command seed (`/create `) should
 * know the trim removes it — the seeded text is `/create` with the caret at
 * the end, which is equivalent for the user (they type a space next or the
 * host re-appends one; we never seed invisible whitespace).
 */
export function buildComposerSeedDetail(seedText: string): ComposerSeedDetail | null {
  if (typeof seedText !== 'string') return null;
  const text = stripControlChars(seedText).trim();
  if (!text) return null;
  if (text.length > SEED_TEXT_MAX) return null;
  if (HANDLER_TOKEN_RE.test(text)) return null;
  if (text.startsWith('/')) {
    const token = text.split(/\s+/, 1)[0] ?? '';
    if (!SLASH_COMMAND_TOKEN_RE.test(token)) return null;
  }
  return { text, caret: text.length };
}

/**
 * Total parser for the receiving side (ChatTab's event listener). `detail`
 * is hostile-by-default — any page script can dispatch a CustomEvent with an
 * arbitrary detail — so this never throws and re-validates the text through
 * the exact same rules as `buildComposerSeedDetail`.
 *
 * A caret that is a valid integer within [0, text.length] is preserved;
 * anything else (missing, negative, fractional, oversized, non-number)
 * degrades to end-of-text rather than rejecting an otherwise-good seed.
 */
export function parseComposerSeedDetail(detail: unknown): ComposerSeedDetail | null {
  try {
    if (typeof detail !== 'object' || detail === null || Array.isArray(detail)) return null;
    const rawText = (detail as { text?: unknown }).text;
    if (typeof rawText !== 'string') return null;
    const built = buildComposerSeedDetail(rawText);
    if (!built) return null;
    const rawCaret = (detail as { caret?: unknown }).caret;
    const caret =
      typeof rawCaret === 'number' &&
      Number.isInteger(rawCaret) &&
      rawCaret >= 0 &&
      rawCaret <= built.text.length
        ? rawCaret
        : built.text.length;
    return { text: built.text, caret };
  } catch {
    return null;
  }
}
