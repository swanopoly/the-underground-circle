/**
 * wordpressSlug — pure slug helpers for the WordPress write path.
 *
 * Dependency-light on purpose: no react-native, no fetch, no runtime imports.
 * Pure functions so the smoke harness (tsx/esbuild) can load them directly and
 * so wordpressChatCommands can set a clean, validated slug on the create
 * request (WordPressPostRequest.slug already forwards to the REST body).
 *
 * Collision handling takes a caller-supplied existing-slug list — it does NOT
 * fetch. Wiring this wave passes an empty list (no slug list is already
 * fetched; adding a fetch is R7, deferred), so resolveUniqueSlug is a no-op in
 * practice today but ready for a future list source.
 */

const MAX_SLUG_LEN = 60;
const FALLBACK_SLUG = 'post';

/** Derive a clean slug from a free-text title. */
export function slugify(title: string): string {
  const base = String(title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-') // non-alphanumeric runs -> single dash
    .replace(/-+/g, '-') // collapse repeats
    .replace(/^-+|-+$/g, '') // trim leading/trailing dashes
    .slice(0, MAX_SLUG_LEN)
    .replace(/-+$/g, ''); // re-trim if the length cap left a trailing dash
  return base || FALLBACK_SLUG;
}

/** Normalize a user-supplied slug through the same rules (idempotent). */
export function normalizeSlug(raw: string): string {
  return slugify(raw);
}

/**
 * Returns `base` if free, otherwise appends -2, -3, ... until it does not
 * collide (case-insensitive). Bounded by the candidate-set size; never
 * fetches.
 */
export function resolveUniqueSlug(base: string, existingSlugs: string[]): string {
  const normalizedBase = normalizeSlug(base);
  const taken = new Set(
    (existingSlugs || []).map((s) => String(s ?? '').trim().toLowerCase()).filter(Boolean),
  );
  if (!taken.has(normalizedBase.toLowerCase())) return normalizedBase;
  // Bound the loop: at most taken.size + 2 attempts are ever needed.
  const max = taken.size + 2;
  for (let n = 2; n <= max + 1; n += 1) {
    const candidate = `${normalizedBase}-${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  // Unreachable in practice; keep a deterministic fallback.
  return `${normalizedBase}-${taken.size + 2}`;
}
