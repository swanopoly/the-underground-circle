/**
 * circleMemoryDigestCore — pure formatter for the multi-doc Circle Memory bank.
 *
 * Background (memory-bank opt v7): migration `20260506_circle_memory_bank.sql`
 * split `circle_memory` from ONE free-form doc per circle into up to THREE
 * named docs (`doc_kind` ∈ brief / active_context / progress). But three prompt
 * readers still call `.single()` on `circle_memory`:
 *
 *   - src/lib/openswanMemoryStores.ts (~103, cap 900)
 *   - src/lib/agentRunSystem.ts       (~1063, cap 900)
 *   - src/lib/memoryService.ts        (~322, cap 1200)
 *
 * With >1 row present, `.single()` errors (multiple rows) and — wrapped in
 * try/catch — the ENTIRE shared-memory block is silently dropped, or it returns
 * one arbitrary row. Either way, the other two shared docs never reach the
 * model. This module is the pure fix: given the `getAllMemoryDocs(circleId)`
 * record (or any doc collection), it formats up to three populated docs under
 * ONE total character budget — split ACROSS docs, not per-doc — so the combined
 * block stays about the size of the old single-doc cap instead of tripling.
 *
 * Purity contract:
 *   - Zero imports (smoke-testable under tsx; no react-native / supabase).
 *   - No Date.now() / Math.random() at module scope. Recency uses only the
 *     timestamps carried on the doc rows (deterministic).
 *   - Every export is TOTAL: null / undefined / wrong-type / huge / hostile /
 *     cyclic input → safe neutral value ('' or []), never throws.
 *   - Bounded output (content ≤ budget; total ≤ budget + fixed overhead).
 *   - Secret-safe: never echoes anything beyond the doc content the caller
 *     already trusts into the prompt, and that content is untrusted-fenced.
 *
 * Untrusted-content rule: doc content is member-authored (untrusted). It is
 * wrapped in the codebase's `<untrusted_quoted>` fence with nested fence
 * markers and invisible Unicode Tag chars stripped first, so a member cannot
 * close the fence early and smuggle text out as trusted instructions. Doc
 * labels (structural, above the fence) are sanitized to the known kinds or a
 * defanged title-case fallback.
 */

/** A single shared-memory doc row. Fields are `unknown` because callers may
 *  pass the raw Supabase row (which uses `last_edited_at`), the task-declared
 *  shape (`updated_at`), or arbitrary input — all handled defensively. */
export interface MemoryDoc {
  doc_kind?: unknown;
  content?: unknown;
  updated_at?: unknown;
}

// ── Tunables ────────────────────────────────────────────────────────────────
/** Max docs rendered — mirrors the three memory-bank kinds. */
const MAX_DOCS = 3;
/** Default total content budget (chars) shared across all rendered docs. */
const DEFAULT_TOTAL_BUDGET = 1000;
/** Hard ceiling so a hostile huge budget can't produce an unbounded block. */
const MAX_TOTAL_BUDGET = 20000;
/** A doc must be able to receive at least this many chars to be worth showing;
 *  otherwise the shared budget is concentrated on fewer, more-recent docs. */
const MIN_DOC_CHARS = 40;
/** Cap how much of a hostile giant array we scan (bounded work, no throw). */
const HARD_ARRAY_SCAN = 2000;
/** Cap how many populated docs we retain before ranking (bounded sort). */
const HARD_POPULATED_SCAN = 64;
/** Slack above the content budget for labels + fences + heading (defensive). */
const MAX_STRUCTURAL_OVERHEAD = 512;

const FENCE_OPEN = '<untrusted_quoted>';
const FENCE_CLOSE = '</untrusted_quoted>';
// Matches the fence marker incl. spaced/cased variants. Source string so each
// use builds a FRESH regex (a shared /g regex carries lastIndex across calls).
const FENCE_MARKER_SOURCE = '<\\s*\\/?\\s*untrusted_quoted\\s*>';
// Invisible Unicode Tag block (U+E0000–U+E007F) — used to smuggle hidden ASCII.
const UNICODE_TAG_CHARS = /[\u{E0000}-\u{E007F}]/gu;

// ── Small total helpers ─────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** Coerce an arbitrary budget into a finite, non-negative, bounded integer.
 *  Explicit 0 is respected (→ empty). Garbage (NaN, Infinity, negatives,
 *  non-numbers, undefined) falls back to the default. */
function sanitizeBudget(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
    return Math.min(Math.floor(v), MAX_TOTAL_BUDGET);
  }
  return DEFAULT_TOTAL_BUDGET;
}

/** Extract a candidate doc list from any input shape:
 *   - array of docs → as-is (bounded scan)
 *   - single doc object (has own `content`/`doc_kind`) → [it]
 *   - record keyed by doc_kind (e.g. getAllMemoryDocs' return) → its values
 *   - anything else → [] */
function toDocArray(docs: unknown): unknown[] {
  if (Array.isArray(docs)) {
    return docs.length > HARD_ARRAY_SCAN ? docs.slice(0, HARD_ARRAY_SCAN) : docs;
  }
  if (isObject(docs)) {
    if ('content' in docs || 'doc_kind' in docs || 'updated_at' in docs) {
      return [docs];
    }
    const values = Object.values(docs);
    return values.length > HARD_ARRAY_SCAN ? values.slice(0, HARD_ARRAY_SCAN) : values;
  }
  return [];
}

/** The doc's content as a trimmed string, or '' if absent / wrong-type. */
function docContent(d: unknown): string {
  if (!isObject(d)) return '';
  const c = d.content;
  return typeof c === 'string' ? c.trim() : '';
}

/** Recency key (ms since epoch). Reads `updated_at` (task shape) then
 *  `last_edited_at` (raw Supabase row) then a couple of aliases. Missing /
 *  unparseable → -Infinity so the doc sorts oldest. Deterministic. */
function docTimestamp(d: unknown): number {
  if (!isObject(d)) return -Infinity;
  const cand =
    d.updated_at ?? d.last_edited_at ?? d.updatedAt ?? d.last_edited ?? null;
  if (typeof cand === 'number') return Number.isFinite(cand) ? cand : -Infinity;
  if (typeof cand === 'string') {
    const t = Date.parse(cand);
    return Number.isFinite(t) ? t : -Infinity;
  }
  return -Infinity;
}

/** Trusted structural label for a doc, placed ABOVE the untrusted fence. Known
 *  kinds map to friendly labels; anything else is defanged (fence markers,
 *  tag chars, newlines, punctuation stripped) and title-cased so a hostile
 *  `doc_kind` cannot inject a heading or close the fence. */
function labelForDocKind(k: unknown): string {
  const raw = typeof k === 'string' ? k.trim().toLowerCase() : '';
  if (raw === 'brief') return 'Brief';
  if (raw === 'active_context') return 'Active Context';
  if (raw === 'progress') return 'Progress';
  const safe = raw
    .replace(UNICODE_TAG_CHARS, '')
    .replace(/[^a-z0-9 _-]/gi, ' ')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .trim();
  if (!safe) return 'Circle Memory';
  return safe
    .split(' ')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/** Wrap already-trimmed content in the `<untrusted_quoted>` fence, stripping
 *  nested fence markers + invisible tag chars first. '' → '' (caller filters). */
function fenceUntrusted(content: string): string {
  let body = String(content ?? '');
  body = body.replace(UNICODE_TAG_CHARS, '');
  body = body.replace(new RegExp(FENCE_MARKER_SOURCE, 'gi'), '');
  body = body.trim();
  if (!body) return '';
  return FENCE_OPEN + '\n' + body + '\n' + FENCE_CLOSE;
}

/** Sanitize an optional trusted heading: strip fence markers, tag chars, and
 *  newlines; bound length. Non-string → ''. */
function sanitizeHeading(h: unknown): string {
  if (typeof h !== 'string') return '';
  return h
    .replace(UNICODE_TAG_CHARS, '')
    .replace(new RegExp(FENCE_MARKER_SOURCE, 'gi'), '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, 120)
    .trim();
}

/**
 * Water-fill an even split of `budget` across docs of the given content
 * lengths. Each doc gets an equal share; a doc that needs less than its share
 * donates the remainder to the others, so a short doc never wastes budget and
 * the total allocated is min(budget, Σ lengths) — never per-doc.
 */
function waterFill(lengths: number[], budget: number): number[] {
  const n = lengths.length;
  const alloc = new Array<number>(n).fill(0);
  if (n === 0 || budget <= 0) return alloc;
  let remaining = budget;
  let active: number[] = [];
  for (let i = 0; i < n; i++) if (lengths[i] > 0) active.push(i);

  while (active.length > 0 && remaining > 0) {
    const share = Math.floor(remaining / active.length);
    if (share <= 0) break; // remainder < active.length — handled below
    const next: number[] = [];
    let progressed = false;
    for (const i of active) {
      const want = lengths[i] - alloc[i];
      const give = Math.min(share, want);
      if (give > 0) {
        alloc[i] += give;
        remaining -= give;
        progressed = true;
      }
      if (alloc[i] < lengths[i]) next.push(i);
    }
    active = next;
    if (!progressed) break;
  }

  // Distribute the sub-`active.length` remainder one char at a time so the full
  // budget is used (single pass suffices: remaining < active.length here).
  for (const i of active) {
    if (remaining <= 0) break;
    if (alloc[i] < lengths[i]) {
      alloc[i] += 1;
      remaining -= 1;
    }
  }
  return alloc;
}

/**
 * Pick and trim which docs fit the SHARED budget. Populated docs (non-empty
 * string content) are ranked most-recently-updated first, capped to the three
 * memory-bank kinds, thinned so each surviving doc clears MIN_DOC_CHARS, then
 * allocated a fair slice of the one budget. Returns doc objects with `content`
 * trimmed to its allocation — Σ content lengths ≤ budget. TOTAL: any bad input
 * → []. */
export function selectMemoryDocsForBudget(
  docs: unknown,
  totalBudgetChars: number,
): MemoryDoc[] {
  const budget = sanitizeBudget(totalBudgetChars);
  if (budget <= 0) return [];

  const arr = toDocArray(docs);
  const populated: Array<{ src: Record<string, unknown>; content: string; ts: number; idx: number }> = [];
  for (let i = 0; i < arr.length; i++) {
    const d = arr[i];
    if (!isObject(d)) continue;
    const content = docContent(d);
    if (!content) continue;
    populated.push({ src: d, content, ts: docTimestamp(d), idx: i });
    if (populated.length >= HARD_POPULATED_SCAN) break;
  }
  if (populated.length === 0) return [];

  // Most-recently-updated first; stable on original order for ties/missing ts.
  populated.sort((a, b) => (b.ts - a.ts) || (a.idx - b.idx));

  const maxByBudget = Math.max(1, Math.floor(budget / MIN_DOC_CHARS));
  const n = Math.min(MAX_DOCS, populated.length, maxByBudget);
  const chosen = populated.slice(0, n);

  const alloc = waterFill(chosen.map((c) => c.content.length), budget);

  const out: MemoryDoc[] = [];
  for (let i = 0; i < chosen.length; i++) {
    const a = alloc[i];
    if (a <= 0) continue;
    const full = chosen[i].content;
    const trimmed = full.length > a ? full.slice(0, a) : full;
    out.push({
      doc_kind: chosen[i].src.doc_kind,
      content: trimmed,
      updated_at: chosen[i].src.updated_at ?? chosen[i].src.last_edited_at,
    });
  }
  return out;
}

/**
 * Format up to three populated Circle Memory docs into ONE prompt block under a
 * single shared character budget (default ~1000), split across the docs (NOT
 * per-doc), labeled by `doc_kind`, most-recently-updated first, with each doc's
 * content wrapped in an `<untrusted_quoted>` fence. Empty / no populated docs
 * → ''. TOTAL + bounded + never throws.
 *
 * @param docs  getAllMemoryDocs record, a doc array, or a single doc.
 * @param opts.totalBudgetChars  shared content budget (default ~1000).
 * @param opts.heading  optional trusted heading placed once above all blocks.
 */
export function formatCircleMemoryDigest(
  docs: unknown,
  opts?: { totalBudgetChars?: number; heading?: unknown },
): string {
  const options = isObject(opts) ? opts : undefined;
  const budget = sanitizeBudget(options?.totalBudgetChars);
  const selected = selectMemoryDocsForBudget(docs, budget);
  if (selected.length === 0) return '';

  const blocks: string[] = [];
  for (const d of selected) {
    const content = typeof d.content === 'string' ? d.content : '';
    const fenced = fenceUntrusted(content);
    if (!fenced) continue;
    blocks.push(labelForDocKind(d.doc_kind) + '\n' + fenced);
  }
  if (blocks.length === 0) return '';

  const heading = sanitizeHeading(options?.heading);
  let out = blocks.join('\n\n');
  if (heading) out = heading + '\n' + out;

  // Defensive final bound. Content is already ≤ budget by construction; this
  // only guards the fixed label/fence/heading overhead against pathological
  // inputs so the block can never grow unbounded.
  const hardMax = budget + MAX_STRUCTURAL_OVERHEAD;
  if (out.length > hardMax) out = out.slice(0, hardMax);
  return out;
}
