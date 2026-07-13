// codebaseIndexCore — the PURE core behind Cursor-style codebase awareness (P4 of
// docs/CODING_AGENT_UPGRADE_PLAN.md). The agent is currently blind to a repo: no
// index, no relevant-file retrieval, no `@file` mentions. This module owns the two
// deterministic, side-effect-free halves of that feature so they can be smoke-tested
// before any filesystem crawl / embeddings / DB is wired:
//
//   (A) INDEX PLANNING — planCodebaseIndex(entries): given a flat list of file
//       paths (+ optional sizes, as a tree crawl would produce), decide WHAT is
//       worth indexing. Ignores vendored/build/VCS dirs anywhere in the path, keeps
//       only an extension allowlist (→ a coarse language label), and skips
//       too-large / generated / lock files. Caps the total so a giant monorepo can
//       never blow the budget. Deterministic ordering so the same tree always plans
//       the same way.
//
//   (B) QUERY RANKING — rankFilesForQuery(query, files): a LEXICAL relevance ranker
//       over already-indexed files (path + optional symbols + summary). This is the
//       embedding-free fallback AND the re-ranker that runs on top of semantic
//       search — it tokenizes the query (splitting on non-alphanumerics AND
//       camelCase/snake_case boundaries), drops stopwords, and scores each file by
//       weighted term hits: basename > path segment > exact symbol > symbol
//       substring > summary term frequency (bounded, TF-with-diminishing-returns).
//       Files matching zero query terms are dropped; ties break on path asc.
//
// PURITY: ZERO runtime imports, tsx-loadable (smoke: codebase-index-core). No
// filesystem, no network, no DB — a bridge tool later crawls the tree (desktop.
// file_list), embeds via memoryEmbeddings, stores in a codebase_files table, then
// calls rankFilesForQuery to re-rank / to serve the `@file` resolver. Every export
// is total: it never throws on degenerate/undefined input, returning empty/neutral
// results instead.

// ── Tunables (exported so the bridge/DB layer shares the exact same limits) ──────

/** Files larger than this are skipped (reason 'too_large'). A source file over
 *  ~512KB is almost always generated/minified/vendored — not worth an embedding. */
export const MAX_FILE_BYTES = 512_000;

/** Hard ceiling on indexed files per plan; the overflow is skipped 'cap_exceeded'
 *  (deterministically — the lowest-priority files by the same sort order). */
export const MAX_INDEXED_FILES = 5000;

/** Directory names that disqualify a path if they appear as ANY path segment.
 *  Matched segment-wise (not substring) so e.g. `src/distributed/x.ts` is kept. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'target',
  '.cache',
  '.expo',
  '.turbo',
  '.gradle',
  '.idea',
  '.svn',
  'bower_components',
]);

/** Extension (lowercased, no dot) → coarse language label. The allowlist IS this
 *  map's keyset: a file whose extension is absent is skipped 'unsupported_ext'. */
export const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  scala: 'scala',
  sql: 'sql',
  md: 'markdown',
  mdx: 'markdown',
  json: 'config',
  yaml: 'config',
  yml: 'config',
  toml: 'config',
  ini: 'config',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  vue: 'vue',
  svelte: 'svelte',
};

/** Exact basenames that are always generated/lock artifacts → skipped 'generated'. */
const GENERATED_BASENAMES: ReadonlySet<string> = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'npm-shrinkwrap.json',
  'poetry.lock',
  'pipfile.lock',
  'cargo.lock',
  'composer.lock',
  'gemfile.lock',
  'go.sum',
]);

/** Basename suffixes that mark generated/minified/bundled files → 'generated'. */
const GENERATED_SUFFIXES: readonly string[] = [
  '.min.js',
  '.min.css',
  '.map',
  '.bundle.js',
  '.bundle.css',
  '.generated.ts',
  '.generated.js',
  '.g.dart',
  '.pb.go',
  '_pb2.py',
  '.lock',
];

export type SkipReason =
  | 'ignored_dir'
  | 'unsupported_ext'
  | 'too_large'
  | 'generated'
  | 'cap_exceeded';

export interface IndexInputEntry {
  path: string;
  size?: number;
}

export interface IndexedFile {
  path: string;
  language: string;
}

export interface SkippedFile {
  path: string;
  reason: SkipReason;
}

export interface CodebaseIndexPlan {
  toIndex: IndexedFile[];
  skipped: SkippedFile[];
  /** Count of indexed files per language label. */
  byLanguage: Record<string, number>;
  totalIndexed: number;
}

export interface PlanIndexOptions {
  maxFileBytes?: number;
  maxIndexedFiles?: number;
}

// ── Path helpers (POSIX + Windows separators; no imports) ────────────────────────

/** Split a path into non-empty segments on both `/` and `\`. */
function pathSegments(path: string): string[] {
  return path.split(/[\\/]+/).filter((s) => s.length > 0);
}

/** Last path segment (filename). '' for a path that ends in a separator / is empty. */
function basename(path: string): string {
  const segs = pathSegments(path);
  return segs.length ? segs[segs.length - 1] : '';
}

/** Lowercased extension without the leading dot ('' if none / dotfile with no ext).
 *  A leading-dot name like `.gitignore` has NO extension (dotfiles aren't ".ignore"). */
function extname(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return ''; // no dot, or dot is the first char (dotfile)
  return name.slice(dot + 1).toLowerCase();
}

function hasIgnoredDir(path: string): boolean {
  for (const seg of pathSegments(path)) {
    if (IGNORED_DIRS.has(seg)) return true;
  }
  return false;
}

function isGenerated(name: string): boolean {
  const lower = name.toLowerCase();
  if (GENERATED_BASENAMES.has(lower)) return true;
  for (const suffix of GENERATED_SUFFIXES) {
    if (lower.endsWith(suffix)) return true;
  }
  return false;
}

/**
 * Plan a codebase index from a flat list of file entries (as a tree crawl yields).
 * Pure + deterministic + total (never throws). Non-string/degenerate entries are
 * ignored. Ordering is stabilized by path (asc) BEFORE the cap is applied, so the
 * cap always drops the same trailing files for a given input set.
 */
export function planCodebaseIndex(
  entries: unknown,
  opts?: PlanIndexOptions,
): CodebaseIndexPlan {
  const maxBytes =
    typeof opts?.maxFileBytes === 'number' && opts.maxFileBytes > 0
      ? opts.maxFileBytes
      : MAX_FILE_BYTES;
  const maxFiles =
    typeof opts?.maxIndexedFiles === 'number' && opts.maxIndexedFiles >= 0
      ? Math.floor(opts.maxIndexedFiles)
      : MAX_INDEXED_FILES;

  const toIndex: IndexedFile[] = [];
  const skipped: SkippedFile[] = [];
  const byLanguage: Record<string, number> = {};

  if (!Array.isArray(entries)) {
    return { toIndex, skipped, byLanguage, totalIndexed: 0 };
  }

  // Normalize + dedupe by path (first occurrence wins), dropping degenerate rows.
  const seen = new Set<string>();
  const normalized: Array<{ path: string; size?: number }> = [];
  for (const raw of entries) {
    if (raw == null || typeof raw !== 'object') continue;
    const path = (raw as IndexInputEntry).path;
    if (typeof path !== 'string' || path.trim() === '') continue;
    if (seen.has(path)) continue;
    seen.add(path);
    const size = (raw as IndexInputEntry).size;
    normalized.push({
      path,
      size: typeof size === 'number' && isFinite(size) ? size : undefined,
    });
  }

  // Deterministic order up front so the cap is stable across runs.
  normalized.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

  for (const entry of normalized) {
    const { path, size } = entry;

    if (hasIgnoredDir(path)) {
      skipped.push({ path, reason: 'ignored_dir' });
      continue;
    }

    const name = basename(path);
    if (isGenerated(name)) {
      skipped.push({ path, reason: 'generated' });
      continue;
    }

    const ext = extname(name);
    const language = EXTENSION_LANGUAGE[ext];
    if (!language) {
      skipped.push({ path, reason: 'unsupported_ext' });
      continue;
    }

    if (typeof size === 'number' && size > maxBytes) {
      skipped.push({ path, reason: 'too_large' });
      continue;
    }

    if (toIndex.length >= maxFiles) {
      skipped.push({ path, reason: 'cap_exceeded' });
      continue;
    }

    toIndex.push({ path, language });
    byLanguage[language] = (byLanguage[language] ?? 0) + 1;
  }

  return { toIndex, skipped, byLanguage, totalIndexed: toIndex.length };
}

// ── (B) Query ranking ────────────────────────────────────────────────────────────

export interface RankableFile {
  path: string;
  /** Symbol names extracted from the file (functions/classes/exports). */
  symbols?: string[];
  /** A short natural-language summary/docstring for the file. */
  summary?: string;
}

export interface RankedFile {
  path: string;
  score: number;
  /** Distinct query terms that hit this file, sorted asc (for a readable preview). */
  matchedTerms: string[];
}

export interface RankOptions {
  limit?: number;
}

/** Very small English stopword set — enough to stop "the file for auth" from
 *  scoring on "the"/"for". Intentionally minimal (coding queries are terse). */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a',
  'an',
  'and',
  'the',
  'of',
  'to',
  'in',
  'on',
  'for',
  'is',
  'are',
  'be',
  'or',
  'with',
  'at',
  'by',
  'from',
  'as',
  'it',
  'this',
  'that',
  'how',
  'do',
  'does',
  'i',
  'we',
  'my',
]);

/** Score weights, highest → lowest signal. Tuned so a single basename hit beats
 *  any amount of summary term-frequency, and an exact symbol match is strong. */
const W_BASENAME = 10; // query term appears in the file's basename
const W_PATH_SEGMENT = 4; // query term appears in a non-basename path segment
const W_SYMBOL_EXACT = 8; // query term === a symbol token (whole symbol or its parts)
const W_SYMBOL_SUBSTR = 3; // query term is a substring of a symbol
const W_SUMMARY_TF = 1.5; // per-occurrence weight for summary term frequency
const SUMMARY_TF_CAP = 3; // diminishing returns: count at most this many hits/term

/** Default number of ranked files returned. */
export const DEFAULT_RANK_LIMIT = 20;

const MAX_TOKEN_LEN = 64;

/**
 * Tokenize into lowercased alphanumeric terms, splitting on:
 *   - any non-alphanumeric run (spaces, punctuation, path separators, `_`, `-`)
 *   - camelCase / PascalCase boundaries (getUserProfile → get, user, profile)
 *   - letter↔digit boundaries (utf8Decode → utf, decode — the lone digit `8` is
 *     then dropped by the single-char filter, like a stopword)
 * Single-character tokens (incl. bare digits) and pure-stopword tokens are dropped.
 * Deterministic.
 * `keepStopwords` is used when tokenizing FILE fields (a symbol literally named
 * `for` should still be matchable), while the QUERY drops stopwords.
 */
export function tokenize(input: unknown, keepStopwords = false): string[] {
  if (typeof input !== 'string' || input.length === 0) return [];
  // 1) Split on non-alphanumerics into coarse chunks.
  const chunks = input.split(/[^A-Za-z0-9]+/);
  const out: string[] = [];
  for (const chunk of chunks) {
    if (!chunk) continue;
    // 2) Split each chunk on camelCase + letter/digit boundaries.
    //    Insert a space at every boundary, then split on spaces.
    const spaced = chunk
      // lower/digit → Upper  (userProfile → user Profile)
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      // consecutive Upper → Upper+lower  (HTTPServer → HTTP Server)
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      // letter → digit  (utf8 → utf 8)
      .replace(/([A-Za-z])([0-9])/g, '$1 $2')
      // digit → letter  (8decode → 8 decode)
      .replace(/([0-9])([A-Za-z])/g, '$1 $2');
    for (const piece of spaced.split(' ')) {
      const tok = piece.toLowerCase();
      if (tok.length < 2) continue; // drop single chars / empties
      if (tok.length > MAX_TOKEN_LEN) continue; // guard against pathological input
      if (!keepStopwords && STOPWORDS.has(tok)) continue;
      out.push(tok);
    }
  }
  return out;
}

/** Distinct query terms, preserving nothing but presence (order irrelevant). */
function queryTerms(query: unknown): string[] {
  const toks = tokenize(query, false);
  return Array.from(new Set(toks));
}

/**
 * Rank already-indexed files against a natural-language query using LEXICAL
 * signals only (no embeddings). Returns the top-N { path, score, matchedTerms }
 * sorted by score desc then path asc — fully deterministic. Files that match zero
 * query terms are excluded. Pure + total: never throws; degenerate/undefined
 * inputs yield an empty array.
 */
export function rankFilesForQuery(
  query: unknown,
  files: unknown,
  opts?: RankOptions,
): RankedFile[] {
  const terms = queryTerms(query);
  if (terms.length === 0 || !Array.isArray(files)) return [];

  const limit =
    typeof opts?.limit === 'number' && opts.limit > 0
      ? Math.floor(opts.limit)
      : DEFAULT_RANK_LIMIT;

  const scored: RankedFile[] = [];

  for (const raw of files) {
    if (raw == null || typeof raw !== 'object') continue;
    const path = (raw as RankableFile).path;
    if (typeof path !== 'string' || path === '') continue;

    const segments = pathSegments(path);
    const base = segments.length ? segments[segments.length - 1] : '';
    const baseTokens = new Set(tokenize(base, true));
    // Path segments EXCLUDING the basename (basename is scored separately/higher).
    const segTokens = new Set<string>();
    for (let i = 0; i < segments.length - 1; i += 1) {
      for (const t of tokenize(segments[i], true)) segTokens.add(t);
    }

    const symbolsRaw = (raw as RankableFile).symbols;
    const symbols: string[] = Array.isArray(symbolsRaw)
      ? symbolsRaw.filter((s): s is string => typeof s === 'string')
      : [];
    // Exact symbol token set = whole-symbol tokens + their camel/snake parts.
    const symbolTokens = new Set<string>();
    const symbolLowers: string[] = [];
    for (const sym of symbols) {
      const lower = sym.toLowerCase();
      symbolLowers.push(lower);
      symbolTokens.add(lower); // whole symbol (lowercased) counts as an exact token
      for (const t of tokenize(sym, true)) symbolTokens.add(t); // and its parts
    }

    const summary = (raw as RankableFile).summary;
    const summaryTokens = typeof summary === 'string' ? tokenize(summary, false) : [];
    // Term-frequency map (bounded per term at read time).
    const summaryTf = new Map<string, number>();
    for (const t of summaryTokens) {
      summaryTf.set(t, (summaryTf.get(t) ?? 0) + 1);
    }

    let score = 0;
    const matched = new Set<string>();

    for (const term of terms) {
      let hit = false;

      if (baseTokens.has(term)) {
        score += W_BASENAME;
        hit = true;
      }
      if (segTokens.has(term)) {
        score += W_PATH_SEGMENT;
        hit = true;
      }
      if (symbolTokens.has(term)) {
        score += W_SYMBOL_EXACT;
        hit = true;
      } else {
        // Substring match against any symbol (e.g. "auth" in "authTokenValidator").
        for (const lower of symbolLowers) {
          if (lower.includes(term)) {
            score += W_SYMBOL_SUBSTR;
            hit = true;
            break;
          }
        }
      }
      const tf = summaryTf.get(term);
      if (tf) {
        score += W_SUMMARY_TF * Math.min(tf, SUMMARY_TF_CAP);
        hit = true;
      }

      if (hit) matched.add(term);
    }

    if (matched.size === 0) continue; // zero-match files are excluded

    scored.push({
      path,
      score: Math.round(score * 1000) / 1000, // stable, avoids float noise
      matchedTerms: Array.from(matched).sort(),
    });
  }

  scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );

  return scored.slice(0, limit);
}
