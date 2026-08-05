// codebaseSymbolCore — the PURE symbol/summary extraction half of P4 of
// docs/CODING_AGENT_UPGRADE_PLAN.md (codebase index → embed pipeline). Its
// sibling codebaseIndexCore decides WHICH files to index; this module decides
// WHAT to say about each file so the embed/store layer has something better
// than a bare path. Three deterministic, side-effect-free pieces:
//
//   (A) SYMBOL EXTRACTION — extractCodebaseSymbols(content, language): a
//       regex-based, line-oriented (NOT an AST) declaration-name extractor per
//       coarse language label (the labels codebaseIndexCore.EXTENSION_LANGUAGE
//       produces: typescript, javascript, python, go, rust, java, kotlin, ruby,
//       c, cpp, csharp, php, swift, scala, sql, markdown, config, shell, vue,
//       svelte). Unknown/other languages fall back to a generic combined
//       ts/js + python pattern set. Dedupes preserving first-seen order, skips
//       identifiers under 2 chars, caps at MAX_SYMBOLS_PER_FILE, and only scans
//       the first MAX_SCAN_LINES lines so a huge file can never blow the budget.
//
//   (B) SUMMARY EXTRACTION — extractCodebaseSummary(content, language): the
//       file's leading doc. For code: the first block comment (/** … */ or
//       /* … */) or the leading run of `//` / `#` comment lines within the first
//       30 lines, stripped of comment markers and decoration (`*`, `═`, `─`, box
//       chars), whitespace-collapsed, capped at MAX_SUMMARY_CHARS at a word
//       boundary + '…'. For markdown: first heading + first paragraph. Empty
//       string when nothing found.
//
//   (C) EMBED TEXT — buildCodebaseEmbedText(input): the deterministic embedding
//       input string: path, then `language: …`, then `symbols: a, b, c`, then
//       the summary, newline-separated, skipping absent parts, capped at
//       MAX_EMBED_TEXT_CHARS. Same input → same text, so re-embedding is a pure
//       equality check away.
//
// PURITY: ZERO runtime imports, tsx-loadable (smoke: codebase-symbol-core). No
// filesystem, no network, no DB — a bridge tool reads file contents, calls
// these, embeds via memoryEmbeddings, and stores rows. Every export is total:
// it never throws on degenerate/undefined input, returning empty/neutral
// results instead.

// ── Tunables (exported so the bridge/DB layer shares the exact same limits) ──────

/** Hard ceiling on extracted symbols per file. Beyond this, a symbol list stops
 *  adding retrieval signal and starts bloating the embed text. */
export const MAX_SYMBOLS_PER_FILE = 48;

/** Summary character cap (cut at a word boundary + '…'). */
export const MAX_SUMMARY_CHARS = 400;

/** Total embed-input character cap — comfortably under any embedding model's
 *  token limit even for pathological symbol/summary inputs. */
export const MAX_EMBED_TEXT_CHARS = 6000;

/** Only the first this-many lines are scanned for symbols (bounds work on
 *  generated / concatenated / minified-ish files that slipped past the plan). */
export const MAX_SCAN_LINES = 4000;

/** How deep (in lines) the leading doc comment may START. */
const SUMMARY_HEAD_LINES = 30;

/** Identifiers shorter than this are dropped (single-letter loop vars etc.). */
const MIN_SYMBOL_CHARS = 2;

/** Markdown heading symbols are truncated to this many chars each. */
const MAX_HEADING_SYMBOL_CHARS = 64;

// ── Per-language declaration patterns ────────────────────────────────────────────
// Line-oriented: each regex is matched against a single line and captures the
// declaration identifier in group 1. Anchored at ^ (with explicit \s* only where
// indented declarations are legitimate, e.g. python methods, kotlin members).

const IDENT = '[A-Za-z_$][A-Za-z0-9_$]*';

const TS_JS_PATTERNS: readonly RegExp[] = [
  new RegExp(`^export\\s+default\\s+(?:async\\s+)?function\\s+(${IDENT})`),
  new RegExp(`^export\\s+(?:async\\s+)?function\\s*\\*?\\s+(${IDENT})`),
  new RegExp(`^(?:async\\s+)?function\\s*\\*?\\s+(${IDENT})`),
  new RegExp(`^export\\s+(?:abstract\\s+)?class\\s+(${IDENT})`),
  new RegExp(`^(?:abstract\\s+)?class\\s+(${IDENT})`),
  new RegExp(`^export\\s+interface\\s+(${IDENT})`),
  new RegExp(`^export\\s+type\\s+(${IDENT})`),
  new RegExp(`^export\\s+(?:const\\s+)?enum\\s+(${IDENT})`),
  new RegExp(`^export\\s+(?:const|let)\\s+(?!enum\\b)(${IDENT})`),
  // top-level arrow fn: line starts with const (export const is covered above)
  new RegExp(`^const\\s+(${IDENT})\\s*(?::[^=]+)?=\\s*(?:async\\s*)?\\(`),
];

const PYTHON_PATTERNS: readonly RegExp[] = [
  new RegExp(`^\\s*(?:async\\s+)?def\\s+(${IDENT})\\s*\\(`),
  new RegExp(`^\\s*class\\s+(${IDENT})`),
];

const GO_PATTERNS: readonly RegExp[] = [
  new RegExp(`^func\\s+(${IDENT})\\s*\\(`),
  // method with receiver: func (r *T) Name(
  new RegExp(`^func\\s*\\([^)]*\\)\\s*(${IDENT})\\s*\\(`),
  new RegExp(`^type\\s+(${IDENT})`),
];

const RUST_PATTERNS: readonly RegExp[] = [
  new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+(${IDENT})`),
  new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?struct\\s+(${IDENT})`),
  new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?enum\\s+(${IDENT})`),
  new RegExp(`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?trait\\s+(${IDENT})`),
  new RegExp(`^impl(?:<[^>]*>)?\\s+(${IDENT})`),
];

// java / kotlin / csharp / swift / scala share one coarse declaration shape.
const JVM_LIKE_MODIFIERS =
  '(?:(?:public|private|protected|internal|static|final|open|sealed|abstract|data|case|export)\\s+)*';
const JVM_LIKE_PATTERNS: readonly RegExp[] = [
  new RegExp(`^\\s*${JVM_LIKE_MODIFIERS}class\\s+(${IDENT})`),
  new RegExp(`^\\s*${JVM_LIKE_MODIFIERS}interface\\s+(${IDENT})`),
  new RegExp(`^\\s*${JVM_LIKE_MODIFIERS}object\\s+(${IDENT})`),
  new RegExp(`^\\s*${JVM_LIKE_MODIFIERS}enum(?:\\s+class)?\\s+(${IDENT})`),
  new RegExp(`^\\s*${JVM_LIKE_MODIFIERS}struct\\s+(${IDENT})`),
  new RegExp(`^\\s*${JVM_LIKE_MODIFIERS}fun\\s+(${IDENT})`),
  new RegExp(`^\\s*${JVM_LIKE_MODIFIERS}func\\s+(${IDENT})`),
];

const GENERIC_PATTERNS: readonly RegExp[] = [...TS_JS_PATTERNS, ...PYTHON_PATTERNS];

const MARKDOWN_HEADING = /^(#{1,3})\s+(.+?)\s*$/;

function patternsForLanguage(language: string): readonly RegExp[] {
  switch (language) {
    case 'typescript':
    case 'javascript':
    case 'vue':
    case 'svelte':
      return TS_JS_PATTERNS;
    case 'python':
      return PYTHON_PATTERNS;
    case 'go':
      return GO_PATTERNS;
    case 'rust':
      return RUST_PATTERNS;
    case 'java':
    case 'kotlin':
    case 'csharp':
    case 'swift':
    case 'scala':
      return JVM_LIKE_PATTERNS;
    default:
      // ruby, c, cpp, php, sql, config, shell, and anything unknown: generic.
      return GENERIC_PATTERNS;
  }
}

/** Coerce untrusted content/language inputs to safe strings ('' when absent). */
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// ── (A) Symbol extraction ────────────────────────────────────────────────────────

/**
 * Regex-based (line-oriented, NOT an AST) declaration-name extraction. Returns
 * the identifiers of top-level-ish declarations for the given coarse language
 * label, deduped preserving first-seen order, capped at MAX_SYMBOLS_PER_FILE.
 * Total: degenerate content/language → [].
 */
export function extractCodebaseSymbols(content: unknown, language: unknown): string[] {
  const text = asString(content);
  if (!text) return [];
  const lang = asString(language).trim().toLowerCase();

  const lines = text.split('\n', MAX_SCAN_LINES);
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (name: string): boolean => {
    const symbol = name.trim();
    if (symbol.length < MIN_SYMBOL_CHARS) return out.length < MAX_SYMBOLS_PER_FILE;
    if (!seen.has(symbol)) {
      seen.add(symbol);
      out.push(symbol);
    }
    return out.length < MAX_SYMBOLS_PER_FILE;
  };

  if (lang === 'markdown') {
    for (const line of lines) {
      const m = line.match(MARKDOWN_HEADING);
      if (!m) continue;
      const heading = m[2].trim().slice(0, MAX_HEADING_SYMBOL_CHARS).trim();
      if (!add(heading)) break;
    }
    return out;
  }

  const patterns = patternsForLanguage(lang);
  outer: for (const line of lines) {
    for (const pattern of patterns) {
      const m = line.match(pattern);
      if (m && m[1] && !add(m[1])) break outer;
    }
  }
  return out;
}

// ── (B) Summary extraction ───────────────────────────────────────────────────────

/** Strip comment markers + box/rule decoration, collapse whitespace. */
function cleanCommentText(raw: string): string {
  return raw
    // per-line leading markers: /** , /* , * , // , # , and closing */
    .replace(/^\s*\/\*+/gm, ' ')
    .replace(/\*+\/\s*$/gm, ' ')
    .replace(/\*\//g, ' ')
    .replace(/^\s*\*+ ?/gm, ' ')
    .replace(/^\s*\/\/+ ?/gm, ' ')
    .replace(/^\s*#+ ?/gm, ' ')
    // decoration runs: box-drawing / rules / separators
    .replace(/[═─━│┃┄┅┆┇┈┉┊┋┌┐└┘├┤┬┴┼╔╗╚╝╠╣╦╩╬▔▁]+/g, ' ')
    .replace(/[-=~_*#]{3,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Cap text at `max` chars, cutting at a word boundary and appending '…'. */
function capAtWordBoundary(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > max * 0.5) cut = cut.slice(0, lastSpace);
  return `${cut.trimEnd()}…`;
}

function extractMarkdownSummary(lines: string[]): string {
  let heading = '';
  const paragraph: string[] = [];
  let inParagraph = false;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!heading) {
      const m = line.match(/^#{1,6}\s+(.+?)\s*$/);
      if (m) heading = m[1].trim();
      continue;
    }
    if (!line) {
      if (inParagraph) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      if (inParagraph) break;
      continue;
    }
    inParagraph = true;
    paragraph.push(line);
  }
  const parts = [heading, paragraph.join(' ')].filter((p) => p.length > 0);
  return capAtWordBoundary(parts.join(' — ').replace(/\s+/g, ' ').trim(), MAX_SUMMARY_CHARS);
}

/**
 * The file's leading doc: for code, the first block comment or leading run of
 * `//` / `#` comment lines within the first 30 lines, stripped of markers and
 * decoration, whitespace-collapsed, capped at MAX_SUMMARY_CHARS (word boundary
 * + '…'). For markdown: first heading + first paragraph. Total: '' when
 * nothing found or input is degenerate.
 */
export function extractCodebaseSummary(content: unknown, language: unknown): string {
  const text = asString(content);
  if (!text) return '';
  const lang = asString(language).trim().toLowerCase();
  const lines = text.split('\n', MAX_SCAN_LINES);

  if (lang === 'markdown') return extractMarkdownSummary(lines);

  const headLimit = Math.min(lines.length, SUMMARY_HEAD_LINES);
  for (let i = 0; i < headLimit; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#!')) continue; // shebang is not a doc comment

    if (trimmed.startsWith('/*')) {
      // Block comment: collect until */ (bounded — decoration strip handles the rest).
      const collected: string[] = [];
      for (let j = i; j < lines.length && j < i + 200; j += 1) {
        collected.push(lines[j]);
        if (lines[j].includes('*/') && !(j === i && lines[j].indexOf('*/') < lines[j].indexOf('/*'))) {
          break;
        }
      }
      return capAtWordBoundary(cleanCommentText(collected.join('\n')), MAX_SUMMARY_CHARS);
    }

    if (trimmed.startsWith('//') || trimmed.startsWith('#')) {
      const marker = trimmed.startsWith('//') ? '//' : '#';
      const collected: string[] = [];
      for (let j = i; j < lines.length; j += 1) {
        const t = lines[j].trim();
        if (!t.startsWith(marker)) break;
        collected.push(t);
      }
      return capAtWordBoundary(cleanCommentText(collected.join('\n')), MAX_SUMMARY_CHARS);
    }

    // First non-empty line is code → no leading doc.
    return '';
  }
  return '';
}

// ── (C) Embed text composition ───────────────────────────────────────────────────

/** The per-file row an embedding is built from (symbols/summary as produced above). */
export interface CodebaseEmbedInput {
  path: string;
  language?: string;
  symbols?: string[];
  summary?: string;
}

/**
 * Deterministic embedding input: path, then `language: …`, then
 * `symbols: a, b, c`, then the summary, newline-separated, skipping absent
 * parts, capped at MAX_EMBED_TEXT_CHARS. Total: '' for degenerate input.
 */
export function buildCodebaseEmbedText(input: CodebaseEmbedInput | null | undefined): string {
  if (!input || typeof input !== 'object') return '';
  const path = typeof input.path === 'string' ? input.path.trim() : '';
  if (!path) return '';

  const parts: string[] = [path];

  const language = typeof input.language === 'string' ? input.language.trim() : '';
  if (language) parts.push(`language: ${language}`);

  const symbols = Array.isArray(input.symbols)
    ? input.symbols
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : [];
  if (symbols.length > 0) parts.push(`symbols: ${symbols.join(', ')}`);

  const summary = typeof input.summary === 'string' ? input.summary.replace(/\s+/g, ' ').trim() : '';
  if (summary) parts.push(summary);

  const text = parts.join('\n');
  return text.length <= MAX_EMBED_TEXT_CHARS ? text : text.slice(0, MAX_EMBED_TEXT_CHARS);
}
