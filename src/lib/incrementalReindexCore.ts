/**
 * incrementalReindexCore — pure planning half of the codebase-index cost fix
 * (coding-agent optimization).
 *
 * `src/lib/codebaseIndexRuntime.ts::indexCodebase` currently re-reads,
 * re-extracts, and RE-EMBEDS the entire repo on every run — slow, and it burns
 * embedding spend (`memoryEmbeddings.embedTexts` → llm-proxy 'openai-embed')
 * on files that have not changed since the last index. This module lets the
 * runtime fetch the existing `codebase_files` rows ONCE, diff them against a
 * fresh crawl, and embed/upsert only the files that are actually new or
 * changed — reusing the vectors already stored for everything else and
 * deleting rows for files that vanished.
 *
 * A file must be RE-INDEXED (re-read + re-embedded) when any of these hold:
 *   1. it is NEW — its path is absent from the existing rows;
 *   2. its size or modified-time CHANGED versus the stored row;
 *   3. the stored row has NO embedding yet (`embedding_present` is not true);
 *   4. the stored row was embedded with a DIFFERENT model than the current one
 *      (provider migration — the old vector is dimensionally/semantically
 *      incompatible and must be recomputed).
 * Everything else is REUSED (its stored row + vector are kept untouched).
 * Stored paths the fresh crawl no longer produced are DELETED. `force: true`
 * re-indexes every crawled file regardless of signature (still removing stale).
 *
 * PURITY (load-bearing): this module has ZERO runtime imports (types only —
 * there are none needed) and no `Date.now()` / `Math.random()` anywhere, so it
 * loads cleanly under tsx/esbuild for smoke testing. Every export is TOTAL:
 * null / undefined / wrong-typed / huge / hostile input yields a safe neutral
 * `ReindexPlan` or boolean rather than throwing. Output arrays are bounded by
 * `MAX_PLAN_FILES`.
 *
 * Wiring (impure, lives in codebaseIndexRuntime.ts): indexCodebase() should
 * fetch the existing rows once (select path,size_bytes,embedding,embedding_model),
 * call `planIncrementalReindex(crawledEntries, existingRows, { embeddingModel:
 * EMBEDDING_MODEL })`, then read/extract/embed/upsert ONLY `plan.toReindex`,
 * leave `plan.toReuse` rows alone, and delete `plan.toDelete`.
 */

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * A row already stored in `codebase_files`, mapped to just the fields that
 * matter for incremental diffing. `embedding_present` mirrors "the `embedding`
 * column is non-null"; the wiring can pass it explicitly or hand a raw DB row
 * with an `embedding` field and let normalization derive it.
 */
export interface IndexedRow {
  path: string;
  size_bytes?: number;
  modified_at?: string;
  embedding_present?: boolean;
  embedding_model?: string;
}

/** A file the fresh crawl produced (repo-relative path + optional signature). */
export interface CrawledEntry {
  path: string;
  sizeBytes?: number;
  modifiedAt?: string;
}

/** The diff: what to re-embed, what to keep as-is, what to remove. */
export interface ReindexPlan {
  /** New/changed files that must be read + embedded + upserted. */
  toReindex: CrawledEntry[];
  /** Paths whose stored row + vector are unchanged and should be left alone. */
  toReuse: string[];
  /** Stored paths the fresh crawl no longer produced — delete their rows. */
  toDelete: string[];
  /** Compact human-readable summary of the plan (bounded; counts only). */
  reason: string;
}

// ── Bounds ───────────────────────────────────────────────────────────────────

/**
 * Hard ceiling on entries considered from either side (hostile-input guard;
 * well above any real repo — codebaseIndexCore caps indexing at 5000 files).
 */
export const MAX_PLAN_FILES = 20000;

// ── Small total helpers ────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Normalize a path value: backslashes → slashes, trimmed. '' when unusable. */
function normalizePath(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\\/g, '/').trim();
}

/** A finite number, or undefined for anything else (NaN/Infinity/string/...). */
function finiteNumberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** A non-empty string, or undefined. */
function nonEmptyStringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

// ── Normalization (total; accepts unknown, tolerates raw DB rows) ──────────────

/**
 * Coerce arbitrary crawl output into clean `CrawledEntry[]`. Non-arrays yield
 * `[]`; non-object / path-less elements are dropped; duplicate paths keep the
 * FIRST occurrence; output is capped at `MAX_PLAN_FILES`. Accepts both the
 * camelCase `sizeBytes`/`modifiedAt` and the crawler's raw `size`/`modified_at`.
 */
export function normalizeCrawledEntries(crawled: unknown): CrawledEntry[] {
  if (!Array.isArray(crawled)) return [];
  const out: CrawledEntry[] = [];
  const seen = new Set<string>();
  for (const raw of crawled) {
    if (out.length >= MAX_PLAN_FILES) break;
    if (!isObject(raw)) continue;
    const path = normalizePath(raw.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const entry: CrawledEntry = { path };
    const size = finiteNumberOrUndefined(
      raw.sizeBytes !== undefined ? raw.sizeBytes : raw.size,
    );
    if (size !== undefined) entry.sizeBytes = size;
    const mod = nonEmptyStringOrUndefined(
      raw.modifiedAt !== undefined ? raw.modifiedAt : raw.modified_at,
    );
    if (mod !== undefined) entry.modifiedAt = mod;
    out.push(entry);
  }
  return out;
}

/**
 * Coerce arbitrary stored rows into clean `IndexedRow[]`. Non-arrays yield
 * `[]`; non-object / path-less elements are dropped; duplicate paths keep the
 * FIRST occurrence; output is capped at `MAX_PLAN_FILES`. `embedding_present`
 * is taken from an explicit boolean when present, else derived from a raw
 * `embedding` field (non-null, non-empty) so a verbatim DB row works too.
 */
export function normalizeIndexedRows(existing: unknown): IndexedRow[] {
  if (!Array.isArray(existing)) return [];
  const out: IndexedRow[] = [];
  const seen = new Set<string>();
  for (const raw of existing) {
    if (out.length >= MAX_PLAN_FILES) break;
    if (!isObject(raw)) continue;
    const path = normalizePath(raw.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const row: IndexedRow = { path };
    const size = finiteNumberOrUndefined(raw.size_bytes);
    if (size !== undefined) row.size_bytes = size;
    const mod = nonEmptyStringOrUndefined(raw.modified_at);
    if (mod !== undefined) row.modified_at = mod;
    if (typeof raw.embedding_present === 'boolean') {
      row.embedding_present = raw.embedding_present;
    } else if ('embedding' in raw) {
      row.embedding_present = raw.embedding != null && raw.embedding !== '';
    }
    const model = nonEmptyStringOrUndefined(raw.embedding_model);
    if (model !== undefined) row.embedding_model = model;
    out.push(row);
  }
  return out;
}

// ── Signature diff ─────────────────────────────────────────────────────────────

/**
 * True when `crawled` must be re-indexed relative to its stored `existing`
 * row. Encapsulates every "needs re-embed" cause EXCEPT the file being new
 * (that is the caller's map-miss). Order of causes:
 *   1. no usable embedding yet (`embedding_present` !== true);
 *   2. provider migration — `embeddingModel` given and the stored model differs;
 *   3. size changed — only when BOTH sides report a size (an unknown size on
 *      either side is not treated as a change, to avoid needless re-embedding);
 *   4. modified-time changed — same both-sides-known rule.
 * Total: hostile input fails SAFE (returns true → re-index; correctness over
 * cost) rather than throwing.
 */
export function fileSignatureChanged(
  crawled: CrawledEntry,
  existing: IndexedRow,
  embeddingModel?: string,
): boolean {
  try {
    if (!isObject(existing)) return true;
    // 1. Never embedded (or unknown state) → must embed.
    if (existing.embedding_present !== true) return true;
    // 2. Embedded by a different provider/model → old vector is incompatible.
    if (
      typeof embeddingModel === 'string' &&
      embeddingModel.length > 0 &&
      existing.embedding_model !== embeddingModel
    ) {
      return true;
    }
    const c = isObject(crawled) ? crawled : ({} as CrawledEntry);
    // 3. Size changed (both known).
    const cSize = finiteNumberOrUndefined(c.sizeBytes);
    const eSize = finiteNumberOrUndefined(existing.size_bytes);
    if (cSize !== undefined && eSize !== undefined && cSize !== eSize) return true;
    // 4. Modified time changed (both known).
    const cMod = nonEmptyStringOrUndefined(c.modifiedAt);
    const eMod = nonEmptyStringOrUndefined(existing.modified_at);
    if (cMod !== undefined && eMod !== undefined && cMod !== eMod) return true;
    return false;
  } catch {
    return true;
  }
}

// ── Plan ───────────────────────────────────────────────────────────────────────

/**
 * Diff a fresh crawl against the stored rows into a `ReindexPlan`. See the
 * module header for the full rule set. Total: any input shape (including
 * `unknown` garbage) yields a valid, bounded plan; on internal failure it
 * returns an empty plan that schedules nothing rather than throwing.
 */
export function planIncrementalReindex(
  crawled: unknown,
  existing: unknown,
  opts?: { embeddingModel?: string; force?: boolean },
): ReindexPlan {
  try {
    const embeddingModel =
      opts && typeof opts.embeddingModel === 'string' && opts.embeddingModel.length > 0
        ? opts.embeddingModel
        : undefined;
    const force = !!(opts && (opts as { force?: unknown }).force === true);

    const crawledEntries = normalizeCrawledEntries(crawled);
    const existingRows = normalizeIndexedRows(existing);

    const existingByPath = new Map<string, IndexedRow>();
    for (const row of existingRows) existingByPath.set(row.path, row);
    const crawledPaths = new Set<string>();

    const toReindex: CrawledEntry[] = [];
    const toReuse: string[] = [];
    let newCount = 0;
    let changedCount = 0;

    for (const entry of crawledEntries) {
      crawledPaths.add(entry.path);
      if (force) {
        toReindex.push(entry);
        continue;
      }
      const prior = existingByPath.get(entry.path);
      if (!prior) {
        toReindex.push(entry);
        newCount += 1;
        continue;
      }
      if (fileSignatureChanged(entry, prior, embeddingModel)) {
        toReindex.push(entry);
        changedCount += 1;
        continue;
      }
      toReuse.push(entry.path);
    }

    const toDelete: string[] = [];
    for (const row of existingRows) {
      if (!crawledPaths.has(row.path)) toDelete.push(row.path);
    }

    const reason = force
      ? `force: re-index all ${toReindex.length} crawled file(s)` +
        (toDelete.length ? `, remove ${toDelete.length} stale` : '')
      : toReindex.length === 0 && toDelete.length === 0
        ? `up to date: reuse all ${toReuse.length} embedded file(s)`
        : `re-index ${toReindex.length} (${newCount} new, ${changedCount} changed), ` +
          `reuse ${toReuse.length}, remove ${toDelete.length} stale`;

    return { toReindex, toReuse, toDelete, reason };
  } catch {
    return {
      toReindex: [],
      toReuse: [],
      toDelete: [],
      reason: 'reindex planning failed; nothing scheduled',
    };
  }
}
