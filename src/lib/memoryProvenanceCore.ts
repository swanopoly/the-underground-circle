// memoryProvenanceCore — the PURE "make retrieved-memory provenance + staleness
// VISIBLE to the model" brain. It implements two findings from
// docs/SWANBOT_RESPONSE_QUALITY_PLAN.md:
//
//   • R2 (provenance markers): a retrieved memory line today renders as just
//     `- title: content` (openswanMemoryStores.ts:54, :118–127), so the model
//     cannot tell a high-confidence fact from a low-confidence guess and has no
//     stable handle to cite. This core appends a compact CONFIDENCE band (from
//     the retrieval `score`/`confidence`) plus a short citable id token + source.
//   • R5 (as-of dating): those same lines carry no timestamp even though the rows
//     hold `updated_at`/`created_at`, so month-old facts read as fresh. This core
//     appends a relative `as of 2d ago` / `as of 3w ago` marker so the model can
//     hedge stale ones.
//
// PURITY: type-only imports (tsx-loadable — the type imports are fully erased by
// esbuild, so no react-native / supabase / deno is pulled in). Every function
// takes `nowMs` (epoch ms) from the caller so it stays deterministic — it never
// reads the clock (no Date.now) and never uses randomness.
//
// TOTALITY: every export is total. null / undefined / wrong-type / huge / hostile
// / cyclic input degrades to a safe neutral ('' or 'unknown') and NEVER throws.
//
// SECRET-SAFE: the memory TEXT is preserved verbatim (bounded) because it is
// already destined for the prompt, but internal ids and source paths are NEVER
// emitted in full — only a short (≤6-char) citation token / basename, so a UUID
// or a filesystem path can't leak through the provenance suffix.
//
// GROUNDED in the two real retrieval shapes (see `MemoryProvenanceInput`):
//   • PromptMemoryReference (src/lib/memoryService.ts:30) — id/title/score/
//     confidence/updatedAt/sourceSurface.
//   • MemoryEntry (src/lib/agentRunSystem.ts:103) — id/title/content/updated_at/
//     created_at/source_surface.
//
// smoke: scripts/memory-provenance-core-smoketest.ts

import type { PromptMemoryReference } from './memoryService';
import type { MemoryEntry } from './agentRunSystem';

/** Confidence band a retrieval score is bucketed into for the model. */
export type ConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';

/**
 * The normalized per-line input this core formats. The wiring point maps a real
 * `PromptMemoryReference` or `MemoryEntry` into this shape (see
 * `formatMemoryReferenceLine`, which does that mapping for you). Every field is
 * `unknown` — nothing is trusted.
 */
export interface MemoryProvenanceItem {
  /** The memory line text (e.g. `title: content`). Preserved verbatim, bounded. */
  text?: unknown;
  /** Retrieval relevance/confidence. Accepts 0..1 or a 0..100 percentage. */
  score?: unknown;
  /** Source surface/label (e.g. 'chat', 'session'). Rendered as a short token. */
  source?: unknown;
  /** When the memory was last updated — epoch ms, a numeric string, or an ISO date. */
  updatedAtMs?: unknown;
  /** Stable memory id — only a short citation token of it is ever emitted. */
  id?: unknown;
}

/**
 * The two real retrieval shapes this core is designed to summarize. Kept as an
 * exported alias so the grounding is compile-checked against the live types: if a
 * field name below drifts from `PromptMemoryReference` / `MemoryEntry`, `tsc`
 * fails here. Callers pass these straight into `formatMemoryReferenceLine`.
 */
export type MemoryProvenanceInput =
  | Partial<Pick<PromptMemoryReference, 'id' | 'title' | 'score' | 'confidence' | 'updatedAt' | 'sourceSurface' | 'lastAccessedAt'>>
  | Partial<Pick<MemoryEntry, 'id' | 'title' | 'content' | 'updated_at' | 'created_at' | 'source_surface' | 'last_accessed_at'>>
  | MemoryProvenanceItem;

// ── Tunable bounds / thresholds (exported so the smoke + wiring share them) ────
/** At or above this normalized score → 'high'. */
export const CONFIDENCE_HIGH_MIN = 0.66;
/** At or above this normalized score (and below HIGH) → 'medium'; below → 'low'. */
export const CONFIDENCE_MEDIUM_MIN = 0.33;
/** Hard cap on the memory-text portion of a line (matches the ~180-char store slice, +headroom). */
export const MAX_PROVENANCE_TEXT_LEN = 200;
/** Hard cap on a rendered source token. */
export const MAX_SOURCE_TOKEN_LEN = 24;
/** How many leading id chars become the citation token (`#abc123`). */
export const ID_TOKEN_LEN = 6;

// ── Coercion guards (never throw; never stringify a cyclic/symbol) ─────────────

/**
 * Coerce anything to a plain string WITHOUT risk: objects/arrays (cyclic-safe),
 * null/undefined, symbols and functions all become '' rather than `[object …]`
 * or a thrown `Cannot convert a Symbol to a string`.
 */
function toStr(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return '';
}

/** Parse a finite number from a number or a numeric string; else null. */
function toFiniteNum(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** First value that is neither null nor undefined; else undefined. */
function firstDefined(...vals: unknown[]): unknown {
  for (const v of vals) {
    if (v !== null && v !== undefined) return v;
  }
  return undefined;
}

/** Bound a string, appending a single-char ellipsis when clipped. */
function clip(s: string, maxLen: number): string {
  const max = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 0;
  if (max <= 0) return '';
  if (s.length <= max) return s;
  return s.slice(0, Math.max(1, max - 1)) + '…';
}

/**
 * Normalize a raw score into a 0..1 confidence, or null when it is not usable:
 *   • [0, 1]      → used directly.
 *   • (1, 100]    → treated as a percentage (÷100).
 *   • < 0 / > 100 → null (out of any sane range → 'unknown').
 *   • non-finite / non-numeric → null.
 */
function normalizeScore(score: unknown): number | null {
  const n = toFiniteNum(score);
  if (n === null) return null;
  if (n < 0) return null;
  if (n <= 1) return n;
  if (n <= 100) return n / 100;
  return null;
}

/** Parse an epoch-ms from a number, a numeric string, or an ISO date string. */
function toEpochMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const s = value.trim();
    if (!s) return null;
    if (/^-?\d+$/.test(s)) {
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    }
    const parsed = Date.parse(s); // pure parse of a given string — not a clock read
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

// ── Text / source / id sanitizers ──────────────────────────────────────────────

/**
 * Sanitize a memory line's text for single-line rendering: strip Unicode control
 * chars (category Cc — C0, DEL, C1: they could break the line or forge fences),
 * collapse all whitespace to single spaces, trim, and bound. The visible
 * characters — INCLUDING
 * any secret the user chose to store — are preserved; this content is already
 * bound for the prompt, we only keep it single-line and short.
 */
function sanitizeLineText(value: unknown, maxLen: number): string {
  const s = toStr(value);
  if (!s) return '';
  const cleaned = s
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return clip(cleaned, maxLen);
}

/**
 * A short, path-safe source token. If the source looks like a path or URL we keep
 * only the LAST segment (never leak a full path/url), restrict to a safe charset,
 * and bound. '' when there is nothing usable.
 */
function sourceToken(value: unknown): string {
  const s = toStr(value);
  if (!s) return '';
  const parts = s.split(/[/\\]/).filter(Boolean);
  let seg = parts.length > 0 ? parts[parts.length - 1] : s;
  seg = seg.replace(/[^a-zA-Z0-9._-]/g, '').trim();
  if (!seg) return '';
  return clip(seg, MAX_SOURCE_TOKEN_LEN);
}

/**
 * A short citation token derived from an id (`#abc123`) — enough for the model to
 * reference a source without the full id (a UUID or internal handle) ever leaving
 * the process. '' when there is nothing usable.
 */
function shortIdToken(value: unknown): string {
  const s = toStr(value);
  if (!s) return '';
  const alnum = s.replace(/[^a-zA-Z0-9]/g, '');
  if (!alnum) return '';
  const n = Number.isFinite(ID_TOKEN_LEN) && ID_TOKEN_LEN > 0 ? Math.floor(ID_TOKEN_LEN) : 6;
  return '#' + alnum.slice(0, n);
}

// ── Relative age phrasing (R5) ─────────────────────────────────────────────────

/**
 * Coarse relative age of a duration: 'just now' / 'Nm ago' / 'Nh ago' / 'Nd ago'
 * / 'Nw ago' / 'Nmo ago' / 'Ny ago'. Deliberately rough — it is a staleness hint,
 * not a stopwatch. Future / clock-skew (age <= 0) reads as 'just now'. Non-finite
 * → '' (unknown). Uses floor so a value never over-states its bucket.
 */
function relativeAge(ageMs: number): string {
  if (!Number.isFinite(ageMs)) return '';
  const ms = ageMs <= 0 ? 0 : ageMs;
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(ms / 3600000);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(ms / 86400000);
  if (day < 7) return `${day}d ago`;
  if (day < 30) return `${Math.floor(day / 7)}w ago`;
  if (day < 365) return `${Math.floor(day / 30)}mo ago`;
  return `${Math.floor(day / 365)}y ago`;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Bucket a retrieval score into a confidence band the model can weight by.
 * Accepts a 0..1 value or a 0..100 percentage. Anything out of range, non-finite,
 * or non-numeric → 'unknown' (the safe neutral). Never throws.
 */
export function memoryConfidenceBand(score: unknown): ConfidenceBand {
  const v = normalizeScore(score);
  if (v === null) return 'unknown';
  if (v >= CONFIDENCE_HIGH_MIN) return 'high';
  if (v >= CONFIDENCE_MEDIUM_MIN) return 'medium';
  return 'low';
}

/**
 * Relative as-of marker for a memory line, e.g. 'as of 2d ago' / 'as of 3w ago'.
 * `updatedAtMs` accepts epoch ms, a numeric string, or an ISO date string;
 * `nowMs` likewise. If either is unknown/unparseable → '' (so the caller simply
 * omits the marker). Never throws.
 */
export function formatAsOf(updatedAtMs: unknown, nowMs: unknown): string {
  const updated = toEpochMs(updatedAtMs);
  const now = toEpochMs(nowMs);
  if (updated === null || now === null) return '';
  const rel = relativeAge(now - updated);
  if (!rel) return '';
  return `as of ${rel}`;
}

/**
 * Render ONE memory line with a compact, bounded, secret-safe provenance suffix:
 *
 *   `<text> [conf:high · as of 2d ago · src:chat · #a1b2c3]`
 *
 * Each suffix token is included only when it carries signal:
 *   • conf:<band>  — omitted when the score is unknown (no weighting signal).
 *   • as of <age>  — omitted when there is no usable date or `nowMs`.
 *   • src:<token>  — omitted when there is no source; only a short basename token.
 *   • #<token>     — omitted when there is no id; only a ≤6-char citation token.
 *
 * When there is no usable text at all → '' (nothing to render). When every suffix
 * token is empty → just the bounded text. Total: any hostile/cyclic/huge input
 * degrades safely and never throws.
 */
export function formatMemoryProvenance(
  item: { text?: unknown; score?: unknown; source?: unknown; updatedAtMs?: unknown; id?: unknown },
  nowMs: unknown,
): string {
  const it: MemoryProvenanceItem =
    item && typeof item === 'object' ? (item as MemoryProvenanceItem) : {};

  const text = sanitizeLineText(it.text, MAX_PROVENANCE_TEXT_LEN);
  if (!text) return '';

  const tokens: string[] = [];

  const band = memoryConfidenceBand(it.score);
  if (band !== 'unknown') tokens.push(`conf:${band}`);

  const asOf = formatAsOf(it.updatedAtMs, nowMs);
  if (asOf) tokens.push(asOf);

  const src = sourceToken(it.source);
  if (src) tokens.push(`src:${src}`);

  const id = shortIdToken(it.id);
  if (id) tokens.push(id);

  if (tokens.length === 0) return text;
  return `${text} [${tokens.join(' · ')}]`;
}

/**
 * Adapter over a REAL retrieval row. Accepts a `PromptMemoryReference` or a
 * `MemoryEntry` (or the normalized `MemoryProvenanceItem`) and renders the
 * provenance line for it — this is the concrete wiring seam for
 * openswanMemoryStores.ts, which today renders `- title: content`:
 *
 *   `- ${formatMemoryReferenceLine(memory, nowMs)}`
 *
 * Field resolution (all read defensively off `unknown`):
 *   • text  ← text ?? `${title}: ${content}` ?? title ?? content
 *   • score ← score ?? confidence
 *   • source ← source ?? sourceSurface ?? source_surface
 *   • date  ← updatedAtMs ?? updatedAt ?? updated_at ?? created_at ?? *lastAccessed*
 *   • id    ← id
 *
 * Never throws.
 */
export function formatMemoryReferenceLine(input: unknown, nowMs: unknown): string {
  const o: Record<string, unknown> =
    input && typeof input === 'object' ? (input as Record<string, unknown>) : {};

  const title = toStr(o.title);
  const content = toStr(o.content);
  let text: unknown = o.text;
  if (!toStr(text)) {
    if (title && content) text = `${title}: ${content}`;
    else text = title || content;
  }

  const score = firstDefined(o.score, o.confidence);
  const source = firstDefined(o.source, o.sourceSurface, o.source_surface);
  const updatedAtMs = firstDefined(
    o.updatedAtMs,
    o.updatedAt,
    o.updated_at,
    o.created_at,
    o.lastAccessedAt,
    o.last_accessed_at,
  );

  return formatMemoryProvenance({ text, score, source, updatedAtMs, id: o.id }, nowMs);
}
