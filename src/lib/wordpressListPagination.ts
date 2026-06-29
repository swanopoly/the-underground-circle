/**
 * wordpressListPagination — pure helpers for paging WordPress REST list
 * endpoints reliably.
 *
 * Dependency-light on purpose (no fetch, no react-native, `import type` only):
 * the header parsing and the page-walk decision are deterministic so the smoke
 * harness (tsx/esbuild) can load them, and siteAutomation can reuse the exact
 * same bound-checking logic in its fetching Result variants.
 *
 * Two problems this addresses:
 *  1. WP list endpoints are paginated (default per_page 10, max 100). Reading
 *     only page 1 silently truncates categories/tags/posts.
 *  2. The legacy helpers return `[]` on BOTH an HTTP error and a genuinely-empty
 *     result, so a 403/500 is indistinguishable from "no posts". Callers that
 *     branch on emptiness (e.g. slug-collision lists) get a false signal.
 */

/** Hard cap on pages walked, to prevent a runaway loop on a hostile/huge site. */
export const MAX_LIST_PAGES = 10;

/**
 * Parses the WordPress pagination headers. Missing/NaN values become 0;
 * negatives clamp to 0. `headers` only needs a `get(name)` accessor (the
 * standard fetch `Headers` shape), so this stays fetch-free.
 */
export function parsePaginationHeaders(
  headers: { get(name: string): string | null },
): { total: number; totalPages: number } {
  const clamp = (raw: string | null): number => {
    const n = parseInt(raw || '', 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  return {
    total: clamp(headers.get('X-WP-Total')),
    totalPages: clamp(headers.get('X-WP-TotalPages')),
  };
}

/**
 * Result tuple that distinguishes a transport/HTTP error from a genuinely-empty
 * ok result. `ok: true` with `items: []` means "the site really has none";
 * `ok: false` means "we could not read the list" and callers must NOT treat it
 * as empty.
 */
export type WpListResult<T> =
  | { ok: true; items: T[]; total: number; totalPages: number }
  | { ok: false; error: string; status?: number };

/**
 * True only while there is a next page to fetch AND we are under the bound.
 * `currentPage` is the page we just read (1-based).
 */
export function shouldFetchNextPage(
  currentPage: number,
  totalPages: number,
  cap: number = MAX_LIST_PAGES,
): boolean {
  return currentPage < totalPages && currentPage < cap;
}
