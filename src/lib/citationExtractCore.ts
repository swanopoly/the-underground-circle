// citationExtractCore — the PURE extractor that pulls source references out of
// free-form agent output text so a "Sources" grounding/accountability UI can show
// exactly what an agent grounded its answer on. It reads text and returns typed
// citations; it does NOT fetch, resolve, or validate that a path/URL exists.
//
// Four kinds are recognized, ordered by first appearance in the text:
//   - file_line: `path/to/file.ext:123` (optional `:col`) → { path, line }
//   - file:      bare `path/to/file.ext` with a KNOWN extension → { path }
//   - url:       http(s):// URLs → { url }
//   - commit:    a 7–40 hex string in a git-ish context (`commit `/`sha `/`@`)
//
// Posture (conservative — a false "Source" is worse than a miss): file/file_line
// require a known code/text extension so a bare version like `1.2.3` or a domain
// like `example.com` is NOT a file; a bare 8-hex word in prose is NOT a commit
// unless it sits in a git-ish context. Over-rejecting is safe; the only real
// failure would be surfacing a citation the agent never actually referenced.
//
// PURITY: zero imports, tsx-loadable (smoke: citation-extract-core). DETERMINISTIC
// (no Date.now / Math.random). NEVER throws — every regex scan is guarded and a
// non-string input yields [] / "".

export type CitationKind = 'file_line' | 'file' | 'url' | 'commit';

export interface Citation {
  kind: CitationKind;
  /** The exact matched substring from the source text. */
  raw: string;
  path?: string;
  line?: number;
  url?: string;
  sha?: string;
}

// Known code/text extensions. A bare token only counts as a file/file_line when
// it ends in one of these — this is what keeps `1.2.3` and `example.com` out.
const KNOWN_EXTENSIONS = [
  'ts', 'tsx', 'js', 'jsx', 'py', 'md', 'json', 'sql', 'sh', 'go', 'rs', 'java',
  'css', 'scss', 'html', 'htm', 'yml', 'yaml', 'txt', 'toml', 'rb', 'c', 'h',
  'cpp', 'cc', 'kt', 'swift', 'php', 'xml', 'ini', 'cfg', 'env', 'lua', 'vue',
];
const EXT_ALTERNATION = KNOWN_EXTENSIONS.join('|');

// A path component: at least one char, no whitespace, and — critically for
// file_line — no `:` inside a component so we don't swallow the `:line` suffix.
// Allows dots, dashes, underscores, slashes, `@`, `~`, `+`, `%`.
const PATH_BODY = '[A-Za-z0-9_./~@+%-]';

// URLs: http/https only. Stop at whitespace and common trailing punctuation.
const URL_RE = /https?:\/\/[^\s<>()"'`\]]+/g;

// file:line[:col] — path ending in a known extension, then :line and optional
// :col. Anchored on a non-path boundary so `foo.ts:1` mid-word isn't half-matched.
const FILE_LINE_RE = new RegExp(
  `(?<![${'A-Za-z0-9_./~@+%-'}])((?:${PATH_BODY}*\\/)?${PATH_BODY}+\\.(?:${EXT_ALTERNATION}))(?::(\\d{1,7}))(?::(\\d{1,7}))?`,
  'g',
);

// Bare file path ending in a known extension (NO trailing :line — that's file_line).
const FILE_RE = new RegExp(
  `(?<![${'A-Za-z0-9_./~@+%-'}])((?:${PATH_BODY}*\\/)?${PATH_BODY}+\\.(?:${EXT_ALTERNATION}))(?![${'A-Za-z0-9'}])(?!:\\d)`,
  'g',
);

// Commit SHA only when it sits in a git-ish context: preceded by `commit `,
// `sha `, `revision `, `rev `, or `@`. 7–40 hex. Word-bounded on the right.
const COMMIT_RE = /(?:\b(?:commit|sha|revision|rev)\s+|@)([0-9a-fA-F]{7,40})\b/g;

const MAX_TEXT_LEN = 200_000;
const MAX_RESULTS = 5_000;

/** Guarded regex sweep — collects [index, match] pairs; never throws. */
function scan(re: RegExp, text: string): Array<{ index: number; m: RegExpExecArray }> {
  const out: Array<{ index: number; m: RegExpExecArray }> = [];
  try {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null) {
      if (guard++ > MAX_RESULTS) break;
      out.push({ index: m.index, m });
      // Zero-width match safety: advance to avoid an infinite loop.
      if (m.index === re.lastIndex) re.lastIndex += 1;
    }
  } catch {
    return out;
  }
  return out;
}

function parseLine(raw: string | undefined): number | undefined {
  if (typeof raw !== 'string' || !raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Extract typed source citations from agent output text, ordered by first
 * appearance. Never throws; a non-string or empty input yields [].
 */
export function extractCitations(text: unknown): Citation[] {
  if (typeof text !== 'string' || !text) return [];
  const body = text.length > MAX_TEXT_LEN ? text.slice(0, MAX_TEXT_LEN) : text;

  // Collect all candidates with their start index, then sort by appearance.
  // A byte range already claimed by a higher-priority kind (file_line, url) is
  // not re-claimed by a lower-priority kind (file) — this stops `foo.ts:12`
  // from also matching as a bare `foo.ts`.
  const claimed: Array<[number, number]> = [];
  const overlaps = (start: number, end: number): boolean =>
    claimed.some(([s, e]) => start < e && end > s);
  const claim = (start: number, end: number): void => { claimed.push([start, end]); };

  const found: Array<{ index: number; cite: Citation }> = [];

  // 1) file:line[:col] — highest priority for a `.ext:NN` token.
  for (const { index, m } of scan(FILE_LINE_RE, body)) {
    const raw = m[0];
    const path = m[1];
    const line = parseLine(m[2]);
    if (!path || line === undefined) continue;
    claim(index, index + raw.length);
    found.push({ index, cite: { kind: 'file_line', raw, path, line } });
  }

  // 2) URLs.
  for (const { index, m } of scan(URL_RE, body)) {
    let raw = m[0];
    // Trim trailing sentence punctuation that is almost never part of a URL.
    raw = raw.replace(/[.,;:!?]+$/g, '');
    if (!raw) continue;
    if (overlaps(index, index + raw.length)) continue;
    claim(index, index + raw.length);
    found.push({ index, cite: { kind: 'url', raw, url: raw } });
  }

  // 3) bare files (only where not already inside a file_line/url span).
  for (const { index, m } of scan(FILE_RE, body)) {
    const raw = m[0];
    const path = m[1];
    if (!path) continue;
    if (overlaps(index, index + raw.length)) continue;
    claim(index, index + raw.length);
    found.push({ index, cite: { kind: 'file', raw, path } });
  }

  // 4) commit SHAs in a git-ish context. The captured group is the hex; raw is
  // just the hex (the exact matched SHA substring the UI wants to show).
  for (const { index, m } of scan(COMMIT_RE, body)) {
    const sha = m[1];
    if (!sha) continue;
    // Locate the hex within the full match so `raw` is exactly the SHA.
    const hexOffset = m[0].lastIndexOf(sha);
    const start = index + (hexOffset >= 0 ? hexOffset : 0);
    if (overlaps(start, start + sha.length)) continue;
    claim(start, start + sha.length);
    found.push({ index: start, cite: { kind: 'commit', raw: sha, sha } });
  }

  found.sort((a, b) => a.index - b.index);
  return found.map((f) => f.cite);
}

function citationKey(c: Citation): string {
  return [
    c.kind,
    c.path ?? '',
    c.line ?? '',
    c.url ?? '',
    c.sha ?? '',
  ].join('|');
}

/**
 * Remove duplicate citations (same kind + path + line + url + sha), preserving
 * first-appearance order. Never throws; non-array input yields [].
 */
export function dedupeCitations(cites: unknown): Citation[] {
  if (!Array.isArray(cites)) return [];
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const c of cites) {
    if (!c || typeof c !== 'object') continue;
    const cite = c as Citation;
    if (typeof cite.kind !== 'string') continue;
    const key = citationKey(cite);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(cite);
  }
  return out;
}

function renderOne(c: Citation): string {
  switch (c.kind) {
    case 'file_line':
      return `\`${c.path}:${c.line}\``;
    case 'file':
      return `\`${c.path}\``;
    case 'url':
      return c.url ?? '';
    case 'commit':
      return `commit \`${c.sha}\``;
    default:
      return c.raw ?? '';
  }
}

/**
 * Render a bounded markdown "Sources:" list. Caps at opts.max (default 20) and
 * appends a "+N more" note when truncated. Deduped before rendering. Never
 * throws; empty/non-array input yields "".
 */
export function renderCitations(cites: unknown, opts?: { max?: number }): string {
  const deduped = dedupeCitations(cites);
  if (deduped.length === 0) return '';

  const rawMax = typeof opts?.max === 'number' && Number.isFinite(opts.max) ? Math.floor(opts.max) : 20;
  const max = rawMax < 0 ? 0 : rawMax;

  const shown = deduped.slice(0, max);
  const lines = shown.map((c) => `- ${renderOne(c)}`);
  const remaining = deduped.length - shown.length;

  const parts = ['Sources:', ...lines];
  if (remaining > 0) parts.push(`- +${remaining} more`);
  return parts.join('\n');
}
