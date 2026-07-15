/**
 * markdownSegmentCore — pure block-level markdown segmenter for chat bubbles.
 *
 * Problem this fixes (UX backlog #17): SwanBot chat bubbles render the model's
 * answer as ONE raw <Text>. The existing inline renderer
 * (`src/components/chat/ChatInlineRichText.tsx`, used by ChatTab's
 * `renderContent` → `bodyTextBlock`) only styles `@mentions` and `**bold**`,
 * so users see literal ``` fences, `#` heading marks, `-`/`*`/`1.` bullet
 * markers, and `>` quote marks in the message body. This module splits a
 * message into ORDERED block segments — fenced code, ATX heading, bullet line,
 * blockquote, and coalesced plain text — so the RN renderer can style each part
 * (monospace code block, bold heading, bulleted row, quoted block) instead of
 * dumping raw markdown.
 *
 * It intentionally does NOT parse inline spans (bold/mentions/links) inside a
 * text segment — the caller keeps using its inline renderer for {kind:'text'}
 * content. Ordered-list numbers are dropped (bullet content is the item text
 * only), matching the minimal {kind:'bullet', content} contract.
 *
 * PURITY CONTRACT (load-bearing — the smoke test runs under tsx/esbuild, which
 * cannot load react-native):
 *  - Zero runtime imports. No react-native, no supabase, no app modules.
 *  - Every export is TOTAL: never throws on null / undefined / wrong-type /
 *    huge / hostile input — it returns a safe neutral value ([] or false).
 *  - Deterministic: no Date.now()/Math.random(); same input, same output.
 *  - Bounded: at most MARKDOWN_SEGMENT_MAX segments, each content capped at
 *    MARKDOWN_SEGMENT_CONTENT_MAX chars, and the whole input is scanned only up
 *    to a fixed window so megabyte pastes stay cheap.
 *
 * Wiring (caller, not this module): `src/screens/circles/tabs/ChatTab.tsx`
 * bot-message render — in `renderContent`, where `bodyTextBlock` renders
 * `<ChatInlineRichText content={bodyContent} …/>`: when
 * `hasRenderableMarkdown(bodyContent)`, map `segmentMarkdown(bodyContent)` to
 * styled Views (monospace code block, bold heading, bulleted rows, quoted
 * block) — keeping ChatInlineRichText for each {kind:'text'} segment's inline
 * spans — instead of one raw <Text>. The same swap fits FloatingChat's
 * ChatInlineRichText usage.
 */

export type MarkdownSegmentKind = 'text' | 'code' | 'heading' | 'bullet' | 'quote';

export interface MarkdownSegment {
  kind: MarkdownSegmentKind;
  content: string;
  /** Fenced-code info string (e.g. 'ts'), lowercased + sanitized. Code only. */
  lang?: string;
  /** ATX heading depth 1..6. Heading only. */
  level?: number;
}

// ---------------------------------------------------------------------------
// Bounds (exported so callers/tests can reason about the caps)
// ---------------------------------------------------------------------------

/** Hard cap on the number of segments returned. */
export const MARKDOWN_SEGMENT_MAX = 200;
/** Hard cap on each segment's `content` length (chars). */
export const MARKDOWN_SEGMENT_CONTENT_MAX = 8000;

/** Only the first INPUT_SCAN_MAX chars of the input are ever examined. */
const INPUT_SCAN_MAX = 100_000;
/** Cap on a fenced-code info string / language token. */
const LANG_MAX = 24;

// ---------------------------------------------------------------------------
// Small total helpers
// ---------------------------------------------------------------------------

/** Cap `s` to MARKDOWN_SEGMENT_CONTENT_MAX; mark truncation with a single '…'. */
function capContent(s: string): string {
  const max = MARKDOWN_SEGMENT_CONTENT_MAX;
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)) + '…';
}

/** Bounded, CR-normalized view of the input; '' for non-strings/empty. */
function normalizeInput(text: unknown): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  // Slice first (bounds work on hostile megabyte input), then normalize EOLs.
  return text.slice(0, INPUT_SCAN_MAX).replace(/\r\n?/g, '\n');
}

function sanitizeLang(info: string): string | undefined {
  const token = info.trim().split(/\s+/)[0] || '';
  const cleaned = token
    .replace(/[^A-Za-z0-9+#._-]/g, '')
    .slice(0, LANG_MAX)
    .toLowerCase();
  return cleaned.length > 0 ? cleaned : undefined;
}

// ---------------------------------------------------------------------------
// Line classifiers (each returns a small match object or null; never throws)
// ---------------------------------------------------------------------------

const FENCE_OPEN_RE = /^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^\n]*)$/;
const FENCE_CLOSE_RE = /^[ \t]*(`{3,}|~{3,})[ \t]*$/;
const HEADING_RE = /^[ \t]{0,3}(#{1,6})[ \t]+(.*)$/;
const BULLET_RE = /^[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(\S.*)$/;
const QUOTE_RE = /^[ \t]{0,3}>[ \t]?(.*)$/;

interface FenceOpen {
  char: string;
  len: number;
  lang: string | undefined;
}

function matchFenceOpen(line: string): FenceOpen | null {
  const m = FENCE_OPEN_RE.exec(line);
  if (!m) return null;
  const marker = m[1];
  return { char: marker[0], len: marker.length, lang: sanitizeLang(m[2] || '') };
}

function isFenceClose(line: string, char: string, len: number): boolean {
  const m = FENCE_CLOSE_RE.exec(line);
  if (!m) return false;
  const marker = m[1];
  return marker[0] === char && marker.length >= len;
}

/** Heading match → { level, content } with markers/closing-hashes stripped. */
function matchHeading(line: string): { level: number; content: string } | null {
  const m = HEADING_RE.exec(line);
  if (!m) return null;
  const content = m[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
  if (content.length === 0) return null; // `###` alone is not a useful heading
  return { level: m[1].length, content };
}

/** Bullet match → the item text after the marker (marker + number dropped). */
function matchBullet(line: string): string | null {
  const m = BULLET_RE.exec(line);
  if (!m) return null;
  const content = m[1].replace(/[ \t]+$/, '');
  return content.length > 0 ? content : null;
}

/** Blockquote match → the text after `>` (may be empty for a blank quote line). */
function matchQuote(line: string): string | null {
  const m = QUOTE_RE.exec(line);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Split `text` into ordered block segments the RN renderer can style. Fenced
 * code blocks (```lang … ``` → {kind:'code', lang, content=inner}), ATX
 * headings (#..###### → {kind:'heading', level, content}), bullet lines
 * (-,*,+ or `N.`/`N)` → one {kind:'bullet', content} per line), blockquotes
 * (consecutive `>` lines → one {kind:'quote', content}), and everything else
 * coalesced into {kind:'text'} segments. An unclosed fence treats the rest of
 * the input as code. Order is preserved. Non-strings and empty/whitespace-only
 * input yield []. Output is bounded (≤ MARKDOWN_SEGMENT_MAX segments, each
 * content ≤ MARKDOWN_SEGMENT_CONTENT_MAX chars). Never throws.
 */
export function segmentMarkdown(text: unknown): MarkdownSegment[] {
  const src = normalizeInput(text);
  if (src.length === 0) return [];

  const segments: MarkdownSegment[] = [];
  let capped = false;

  function pushSegment(seg: MarkdownSegment): void {
    if (capped || segments.length >= MARKDOWN_SEGMENT_MAX) {
      capped = true;
      return;
    }
    segments.push({ ...seg, content: capContent(seg.content) });
  }

  const textBuf: string[] = [];
  const quoteBuf: string[] = [];

  function flushText(): void {
    if (textBuf.length === 0) return;
    const joined = textBuf.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    textBuf.length = 0;
    if (joined.length > 0) pushSegment({ kind: 'text', content: joined });
  }

  function flushQuote(): void {
    if (quoteBuf.length === 0) return;
    const joined = quoteBuf.join('\n').trim();
    quoteBuf.length = 0;
    if (joined.length > 0) pushSegment({ kind: 'quote', content: joined });
  }

  const lines = src.split('\n');

  let inCode = false;
  let fenceChar = '`';
  let fenceLen = 3;
  let codeLang: string | undefined;
  const codeBuf: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (capped) break;
    const line = lines[i];

    if (inCode) {
      if (isFenceClose(line, fenceChar, fenceLen)) {
        const seg: MarkdownSegment = { kind: 'code', content: codeBuf.join('\n') };
        if (codeLang) seg.lang = codeLang;
        pushSegment(seg);
        codeBuf.length = 0;
        inCode = false;
      } else {
        codeBuf.push(line);
      }
      continue;
    }

    const fence = matchFenceOpen(line);
    if (fence) {
      flushText();
      flushQuote();
      inCode = true;
      fenceChar = fence.char;
      fenceLen = fence.len;
      codeLang = fence.lang;
      codeBuf.length = 0;
      continue;
    }

    const heading = matchHeading(line);
    if (heading) {
      flushText();
      flushQuote();
      pushSegment({ kind: 'heading', content: heading.content, level: heading.level });
      continue;
    }

    const bullet = matchBullet(line);
    if (bullet !== null) {
      flushText();
      flushQuote();
      pushSegment({ kind: 'bullet', content: bullet });
      continue;
    }

    const quote = matchQuote(line);
    if (quote !== null) {
      flushText(); // pending plain text ends before a quote block
      quoteBuf.push(quote);
      continue;
    }

    // Plain text line (blank lines included → coalesced paragraph spacing).
    flushQuote(); // a non-quote line ends any open quote block
    textBuf.push(line);
  }

  // Unclosed fence → treat everything collected as code.
  if (inCode && !capped) {
    const seg: MarkdownSegment = { kind: 'code', content: codeBuf.join('\n') };
    if (codeLang) seg.lang = codeLang;
    pushSegment(seg);
  }
  flushText();
  flushQuote();

  return segments;
}

// Line anchors use [\r\n] (not just \n) and the quote cue allows any run of
// spaces after '>' ([ \t]* not [ \t]?), so hasRenderableMarkdown detects every
// block segmentMarkdown would emit — including a CR/lone-CR-separated line or an
// indented blockquote like `>  text`. This keeps the caller's contract airtight:
// hasRenderableMarkdown(x) === false ⟹ segmentMarkdown(x) yields only text.
const HAS_FENCE_RE = /(?:^|[\r\n])[ \t]{0,3}(?:`{3,}|~{3,})/;
const HAS_HEADING_RE = /(?:^|[\r\n])[ \t]{0,3}#{1,6}[ \t]+\S/;
const HAS_BULLET_RE = /(?:^|[\r\n])[ \t]{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+\S/;
const HAS_QUOTE_RE = /(?:^|[\r\n])[ \t]{0,3}>[ \t]*\S/;
const HAS_BOLD_RE = /\*\*[^*\r\n]+\*\*/;

/**
 * Cheap pre-check for the caller: true when `text` contains any renderable
 * block/inline markdown worth segmenting — a code fence, an ATX heading, a
 * bullet/ordered-list line, a blockquote, or `**bold**`. Non-strings and empty
 * strings are false. Bounded scan window. Never throws.
 */
export function hasRenderableMarkdown(text: unknown): boolean {
  if (typeof text !== 'string' || text.length === 0) return false;
  const scan = text.slice(0, INPUT_SCAN_MAX);
  return (
    HAS_FENCE_RE.test(scan) ||
    HAS_HEADING_RE.test(scan) ||
    HAS_BULLET_RE.test(scan) ||
    HAS_QUOTE_RE.test(scan) ||
    HAS_BOLD_RE.test(scan)
  );
}
