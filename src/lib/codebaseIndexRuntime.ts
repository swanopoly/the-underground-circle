/**
 * codebaseIndexRuntime — the IMPURE wiring half of P4 (docs/CODING_AGENT_UPGRADE_PLAN.md):
 * Cursor-style codebase awareness. The pure halves live in `codebaseIndexCore.ts`
 * (index planning + lexical ranking), `codebaseSymbolCore.ts` (symbol/summary
 * extraction), and `codebaseMentionsCore.ts` (`@file:`/`@symbol:` parsing +
 * resolution) — all smoke-tested. This module owns the side effects:
 *
 *   * indexCodebase   — BFS-crawl a local repo via the desktop bridge
 *                       (`listFiles`), plan with `planCodebaseIndex`, read file
 *                       heads (`readFile`), extract symbols/summaries, embed via
 *                       `memoryEmbeddings.embedTexts` (llm-proxy 'openai-embed'),
 *                       and upsert into the owner-scoped `codebase_files` table.
 *                       NO raw file content is persisted — only path/symbols/
 *                       summary/embedding; code stays on the user's machine.
 *   * searchCodebase  — semantic search via the `match_codebase_files` RPC
 *                       re-ranked lexically (`rankFilesForQuery`), with a pure
 *                       lexical fallback when embeddings are unavailable.
 *   * buildCodebaseMentionContextBlock — per-turn `@file:`/`@symbol:` resolver:
 *                       resolves mentions against the index and inlines the head
 *                       of exactly-matched files (bridge read, untrusted-fenced).
 *   * active repo root — the root used by conventions loading, mentions, and
 *                       default search scope; persisted per user in storage.
 *
 * Callers: the `codebase.index` / `codebase.search` tools in
 * openswanToolRuntime.ts and the prompt-section pushes in swanbot.ts.
 */

import { supabase } from './supabase';
import { storage } from './storage';
import {
  planCodebaseIndex,
  rankFilesForQuery,
  IGNORED_DIRS,
  MAX_INDEXED_FILES,
  type RankableFile,
} from './codebaseIndexCore';
import {
  extractCodebaseSymbols,
  extractCodebaseSummary,
  buildCodebaseEmbedText,
} from './codebaseSymbolCore';
import {
  parseCodebaseMentions,
  resolveCodebaseMentions,
  describeResolvedMentions,
} from './codebaseMentionsCore';
import { embedText, embedTexts, EMBEDDING_MODEL } from './memoryEmbeddings';
import { wrapUntrusted } from './untrustedContent';

// ── Tunables ─────────────────────────────────────────────────────────────────

/** BFS crawl ceiling — directories visited, not files. */
export const MAX_CRAWL_DIRS = 600;
/** Default per-index file ceiling (embedding cost guard; hard cap = core's 5000). */
export const DEFAULT_INDEX_MAX_FILES = 1500;
/** Bytes of each file head read for symbol/summary extraction. */
export const INDEX_READ_HEAD_BYTES = 48_000;
/** DB upsert chunk size. */
const UPSERT_CHUNK = 100;
/** Mention block: max exactly-matched files whose head is inlined. */
export const MENTION_FILE_CONTENT_MAX = 2;
/** Mention block: chars of file head inlined per mention. */
export const MENTION_FILE_CONTENT_CHARS = 6_000;
/** Mention block total char cap. */
export const MENTION_BLOCK_MAX_CHARS = 16_000;

const ACTIVE_ROOT_KEY_PREFIX = 'codebase_index_active_root::';

// ── Active repo root ─────────────────────────────────────────────────────────

export async function getActiveCodebaseRoot(userId: string): Promise<string | null> {
  try {
    const v = await storage.getItem(`${ACTIVE_ROOT_KEY_PREFIX}${userId}`);
    return v && v.trim() ? v : null;
  } catch { return null; }
}

export async function setActiveCodebaseRoot(userId: string, rootPath: string): Promise<void> {
  try { await storage.setItem(`${ACTIVE_ROOT_KEY_PREFIX}${userId}`, rootPath); } catch {}
}

// ── Crawl ────────────────────────────────────────────────────────────────────

function normalizeRoot(rootPath: string): string {
  return rootPath.replace(/\\/g, '/').replace(/\/+$/, '');
}

function toRepoRelative(root: string, fullPath: string): string {
  const full = fullPath.replace(/\\/g, '/');
  if (full === root) return '';
  return full.startsWith(`${root}/`) ? full.slice(root.length + 1) : full;
}

/**
 * BFS the tree under `rootPath` via the bridge, pruning IGNORED_DIRS at the
 * directory level (so node_modules is never even listed). Returns repo-relative
 * file entries plus a truncation flag when a cap was hit.
 */
async function crawlCodebaseEntries(rootPath: string): Promise<{
  entries: Array<{ path: string; size?: number }>;
  truncated: boolean;
  error?: string;
}> {
  const { listFiles, isDesktopBridgeAvailable } = await import('./desktopBridge');
  if (!(await isDesktopBridgeAvailable())) {
    return { entries: [], truncated: false, error: 'Desktop bridge offline.' };
  }
  const root = normalizeRoot(rootPath);
  const queue: string[] = [root];
  const entries: Array<{ path: string; size?: number }> = [];
  let dirsVisited = 0;
  let truncated = false;
  while (queue.length > 0) {
    if (dirsVisited >= MAX_CRAWL_DIRS) { truncated = true; break; }
    const dir = queue.shift() as string;
    dirsVisited += 1;
    const r = await listFiles(dir);
    if (!r.ok || !r.data) continue; // unreadable subdir — skip, not fatal
    if (r.data.truncated) truncated = true;
    for (const entry of r.data.entries || []) {
      const name = String(entry.name || '');
      if (!name) continue;
      const full = (entry.path || `${dir}/${name}`).replace(/\\/g, '/');
      if (entry.kind === 'directory') {
        if (!IGNORED_DIRS.has(name) && !name.startsWith('.')) queue.push(full);
        continue;
      }
      if (entry.kind !== 'file') continue;
      entries.push({
        path: toRepoRelative(root, full),
        size: typeof entry.size === 'number' ? entry.size : undefined,
      });
    }
  }
  return { entries, truncated };
}

// ── Index ────────────────────────────────────────────────────────────────────

export interface IndexCodebaseResult {
  ok: boolean;
  repoRoot: string;
  indexed: number;
  embedded: number;
  skipped: number;
  byLanguage: Record<string, number>;
  truncatedCrawl: boolean;
  staleRemoved: number;
  error?: string;
}

/**
 * Crawl + extract + embed + upsert a repo into `codebase_files`, and mark it
 * the user's active codebase root. Re-running refreshes rows in place and
 * removes rows for files that no longer exist (stale by indexed_at).
 */
export async function indexCodebase(args: {
  rootPath: string;
  userId: string;
  circleId?: string | null;
  maxFiles?: number;
}): Promise<IndexCodebaseResult> {
  const repoRoot = normalizeRoot(String(args.rootPath || ''));
  const empty: IndexCodebaseResult = {
    ok: false, repoRoot, indexed: 0, embedded: 0, skipped: 0,
    byLanguage: {}, truncatedCrawl: false, staleRemoved: 0,
  };
  if (!repoRoot) return { ...empty, error: 'rootPath is required.' };
  if (!args.userId) return { ...empty, error: 'userId is required.' };

  const crawl = await crawlCodebaseEntries(repoRoot);
  if (crawl.error) return { ...empty, error: crawl.error };
  if (crawl.entries.length === 0) {
    return { ...empty, error: `No files found under ${repoRoot} (is the path right and granted to the bridge?).` };
  }

  const maxFiles = Math.min(
    Math.max(1, Math.floor(args.maxFiles || DEFAULT_INDEX_MAX_FILES)),
    MAX_INDEXED_FILES,
  );
  const plan = planCodebaseIndex(crawl.entries, { maxIndexedFiles: maxFiles });

  const { readFile } = await import('./desktopBridge');
  const startIso = new Date().toISOString();
  type Row = {
    user_id: string; circle_id: string | null; repo_root: string; path: string;
    language: string; symbols: string[]; summary: string | null;
    size_bytes: number | null; embedding: string | null;
    embedding_model: string | null; embedded_at: string | null; indexed_at: string;
  };
  const rows: Row[] = [];
  const embedInputs: string[] = [];
  for (const file of plan.toIndex) {
    const abs = `${repoRoot}/${file.path}`;
    const read = await readFile(abs, INDEX_READ_HEAD_BYTES);
    const content = read.ok ? (read.data?.content ?? '') : '';
    const symbols = extractCodebaseSymbols(content, file.language);
    const summary = extractCodebaseSummary(content, file.language);
    rows.push({
      user_id: args.userId,
      circle_id: args.circleId || null,
      repo_root: repoRoot,
      path: file.path,
      language: file.language,
      symbols,
      summary: summary || null,
      size_bytes: read.ok && typeof read.data?.size === 'number' ? read.data.size : null,
      embedding: null,
      embedding_model: null,
      embedded_at: null,
      indexed_at: startIso,
    });
    embedInputs.push(buildCodebaseEmbedText({ path: file.path, language: file.language, symbols, summary }));
  }

  let embedded = 0;
  const vectors = await embedTexts(embedInputs);
  if (vectors) {
    vectors.forEach((vec, i) => {
      if (vec) {
        rows[i].embedding = `[${vec.join(',')}]`;
        rows[i].embedding_model = EMBEDDING_MODEL;
        rows[i].embedded_at = startIso;
        embedded += 1;
      }
    });
  }

  for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
    const chunk = rows.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from('codebase_files')
      .upsert(chunk as any[], { onConflict: 'user_id,repo_root,path' });
    if (error) {
      return {
        ...empty,
        indexed: i,
        embedded,
        skipped: plan.skipped.length,
        byLanguage: plan.byLanguage,
        truncatedCrawl: crawl.truncated,
        error: `codebase_files upsert failed: ${error.message}${(error as any).code === '42P01' ? ' (table missing — run RUN_THIS_SQL.sql §24)' : ''}`,
      };
    }
  }

  // Remove rows for files the fresh crawl no longer produced.
  let staleRemoved = 0;
  try {
    const { data: stale } = await supabase
      .from('codebase_files')
      .delete()
      .eq('user_id', args.userId)
      .eq('repo_root', repoRoot)
      .lt('indexed_at', startIso)
      .select('id');
    staleRemoved = stale?.length || 0;
  } catch {}

  await setActiveCodebaseRoot(args.userId, repoRoot);

  return {
    ok: true,
    repoRoot,
    indexed: rows.length,
    embedded,
    skipped: plan.skipped.length,
    byLanguage: plan.byLanguage,
    truncatedCrawl: crawl.truncated,
    staleRemoved,
  };
}

// ── Search ───────────────────────────────────────────────────────────────────

export interface CodebaseSearchHit {
  path: string;
  score: number;
  similarity?: number;
  matchedTerms: string[];
  summary?: string;
  symbols?: string[];
}

export interface CodebaseSearchResult {
  results: CodebaseSearchHit[];
  mode: 'semantic' | 'lexical';
  repoRoot: string | null;
  error?: string;
}

/** Weight that converts cosine similarity (0..1) into the lexical score scale. */
const SEMANTIC_SCORE_WEIGHT = 12;

/**
 * Semantic search (match_codebase_files) re-ranked with the pure lexical
 * ranker; falls back to lexical-only over the stored rows when the query
 * embedding is unavailable (privacy mode, proxy failure, no key).
 */
export async function searchCodebase(args: {
  query: string;
  userId: string;
  repoRoot?: string | null;
  limit?: number;
}): Promise<CodebaseSearchResult> {
  const query = String(args.query || '').trim();
  const limit = Math.min(Math.max(1, Math.floor(args.limit || 12)), 30);
  const repoRoot = args.repoRoot !== undefined
    ? (args.repoRoot ? normalizeRoot(args.repoRoot) : null)
    : await getActiveCodebaseRoot(args.userId);
  if (!query) return { results: [], mode: 'lexical', repoRoot, error: 'query is required.' };

  const vector = await embedText(query);
  if (vector) {
    const { data, error } = await supabase.rpc('match_codebase_files', {
      p_query_embedding: vector,
      p_repo_root: repoRoot,
      p_match_threshold: 0,
      p_match_count: Math.max(limit * 4, 40),
    });
    if (!error && Array.isArray(data) && data.length > 0) {
      const candidates: Array<RankableFile & { similarity: number }> = data.map((r: any) => ({
        path: String(r.path || ''),
        symbols: Array.isArray(r.symbols) ? r.symbols : [],
        summary: typeof r.summary === 'string' ? r.summary : undefined,
        similarity: typeof r.similarity === 'number' ? r.similarity : 0,
      }));
      const lexical = rankFilesForQuery(query, candidates, { limit: candidates.length });
      const lexicalByPath = new Map(lexical.map((l) => [l.path, l]));
      const hits: CodebaseSearchHit[] = candidates.map((c) => {
        const lex = lexicalByPath.get(c.path);
        return {
          path: c.path,
          similarity: Math.round(c.similarity * 1000) / 1000,
          score: Math.round((c.similarity * SEMANTIC_SCORE_WEIGHT + (lex?.score || 0)) * 1000) / 1000,
          matchedTerms: lex?.matchedTerms || [],
          summary: c.summary,
          symbols: c.symbols,
        };
      });
      hits.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.path < b.path ? -1 : 1));
      return { results: hits.slice(0, limit), mode: 'semantic', repoRoot };
    }
    // RPC missing / no embedded rows → fall through to lexical.
  }

  // Lexical fallback over stored rows (path/symbols/summary only).
  let q = supabase
    .from('codebase_files')
    .select('path, symbols, summary')
    .eq('user_id', args.userId)
    .limit(2000);
  if (repoRoot) q = q.eq('repo_root', repoRoot);
  const { data: rows, error } = await q;
  if (error) return { results: [], mode: 'lexical', repoRoot, error: error.message };
  const ranked = rankFilesForQuery(query, rows || [], { limit });
  const byPath = new Map((rows || []).map((r: any) => [r.path, r]));
  return {
    results: ranked.map((r) => ({
      path: r.path,
      score: r.score,
      matchedTerms: r.matchedTerms,
      summary: byPath.get(r.path)?.summary || undefined,
      symbols: byPath.get(r.path)?.symbols || undefined,
    })),
    mode: 'lexical',
    repoRoot,
  };
}

// ── `@file:` / `@symbol:` mention context ────────────────────────────────────

/** Indexed files for mention resolution (path/symbols/summary; bounded). */
async function listIndexedFilesForMentions(
  userId: string,
  repoRoot: string | null,
): Promise<RankableFile[]> {
  let q = supabase
    .from('codebase_files')
    .select('path, symbols, summary')
    .eq('user_id', userId)
    .limit(3000);
  if (repoRoot) q = q.eq('repo_root', repoRoot);
  const { data } = await q;
  return (data || []) as RankableFile[];
}

/**
 * Per-turn `@file:`/`@symbol:` resolver. Returns a prompt block (or null when
 * the message has no mentions / nothing is indexed): a resolution map for every
 * mention, plus the untrusted-fenced head of up to MENTION_FILE_CONTENT_MAX
 * exactly-matched files read live via the bridge. Fails soft everywhere — a
 * missing index or offline bridge degrades to paths-only or null, never throws.
 */
export async function buildCodebaseMentionContextBlock(args: {
  message: string;
  userId: string;
}): Promise<string | null> {
  try {
    const mentions = parseCodebaseMentions(args.message);
    if (mentions.length === 0) return null;
    const repoRoot = await getActiveCodebaseRoot(args.userId);
    const files = await listIndexedFilesForMentions(args.userId, repoRoot);
    if (files.length === 0) {
      return '## Codebase Mentions\nThe message references @file:/@symbol: mentions, but no codebase index exists yet — run the `codebase.index` tool on the repo root first.';
    }
    const resolved = resolveCodebaseMentions(mentions, files);
    const parts: string[] = ['## Codebase Mentions', describeResolvedMentions(resolved)];

    if (repoRoot) {
      const exactFiles = resolved
        .filter((r) => r.mention.kind === 'file' && r.status === 'exact' && r.matches.length > 0)
        .slice(0, MENTION_FILE_CONTENT_MAX);
      if (exactFiles.length > 0) {
        try {
          const { readFile, isDesktopBridgeAvailable } = await import('./desktopBridge');
          if (await isDesktopBridgeAvailable()) {
            for (const r of exactFiles) {
              const rel = r.matches[0].path;
              const read = await readFile(`${repoRoot}/${rel}`, MENTION_FILE_CONTENT_CHARS);
              if (!read.ok || !read.data?.content) continue;
              parts.push(wrapUntrusted(read.data.content.slice(0, MENTION_FILE_CONTENT_CHARS), {
                heading: `@${r.mention.kind}:${r.mention.value} → ${rel}${read.data.truncated ? ' (head only)' : ''}`,
              }));
            }
          }
        } catch { /* content inlining is best-effort */ }
      }
    }

    const block = parts.filter(Boolean).join('\n\n');
    return block.length > MENTION_BLOCK_MAX_CHARS
      ? `${block.slice(0, MENTION_BLOCK_MAX_CHARS)}\n… (mention context truncated)`
      : block;
  } catch {
    return null;
  }
}
