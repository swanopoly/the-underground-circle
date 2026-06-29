/**
 * wordpress-list-pagination-smoketest — offline guard for the pure pagination
 * logic used by the R7 WpListResult fetching variants in siteAutomation.
 *
 * Note: the *Result page-walkers themselves fetch and are NOT smoke-tested
 * here; only the dependency-light header/decision logic is.
 *
 * Run: npm run smoke:wordpress-list-pagination
 */
import {
  MAX_LIST_PAGES,
  parsePaginationHeaders,
  shouldFetchNextPage,
  type WpListResult,
} from '../src/lib/wordpressListPagination';

let failures = 0;
function fail(m: string): void { failures += 1; console.error('FAIL:', m); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(`${name}${detail ? ` — ${detail}` : ''}`);
}

function headers(map: Record<string, string | null>): { get(name: string): string | null } {
  return { get: (name) => (name in map ? map[name] : null) };
}

// ── parsePaginationHeaders ──────────────────────────────────────────────────
{
  const normal = parsePaginationHeaders(headers({ 'X-WP-Total': '57', 'X-WP-TotalPages': '6' }));
  assert(normal.total === 57 && normal.totalPages === 6, 'parse: normal values', JSON.stringify(normal));

  const missing = parsePaginationHeaders(headers({}));
  assert(missing.total === 0 && missing.totalPages === 0, 'parse: missing → 0', JSON.stringify(missing));

  const nan = parsePaginationHeaders(headers({ 'X-WP-Total': 'abc', 'X-WP-TotalPages': '' }));
  assert(nan.total === 0 && nan.totalPages === 0, 'parse: NaN/empty → 0', JSON.stringify(nan));

  const negative = parsePaginationHeaders(headers({ 'X-WP-Total': '-5', 'X-WP-TotalPages': '-1' }));
  assert(negative.total === 0 && negative.totalPages === 0, 'parse: negative clamps to 0', JSON.stringify(negative));

  const nullVal = parsePaginationHeaders(headers({ 'X-WP-Total': null }));
  assert(nullVal.total === 0, 'parse: null → 0');
}

// ── WpListResult error-vs-empty discrimination ──────────────────────────────
{
  const okEmpty: WpListResult<number> = { ok: true, items: [], total: 0, totalPages: 0 };
  const okFull: WpListResult<number> = { ok: true, items: [1, 2], total: 2, totalPages: 1 };
  const err: WpListResult<number> = { ok: false, error: 'forbidden', status: 403 };

  // A genuinely-empty ok result is distinguishable from an error.
  assert(okEmpty.ok === true && okEmpty.items.length === 0, 'result: ok-empty is ok with no items');
  assert(err.ok === false, 'result: error is not ok');
  // The discriminant lets a caller fail-open only on the empty branch.
  const slugsFrom = (r: WpListResult<{ slug: string }>): string[] => (r.ok ? r.items.map((i) => i.slug) : []);
  assert(slugsFrom({ ok: true, items: [{ slug: 'a' }], total: 1, totalPages: 1 }).length === 1, 'result: ok yields items');
  assert(slugsFrom({ ok: false, error: 'x' }).length === 0, 'result: error yields [] (caller fails open, not "empty list")');
  void okFull;
}

// ── shouldFetchNextPage ─────────────────────────────────────────────────────
{
  // Continues mid-run.
  assert(shouldFetchNextPage(1, 5) === true, 'next: page 1 of 5 continues');
  assert(shouldFetchNextPage(3, 5) === true, 'next: page 3 of 5 continues');
  // Stops at last page.
  assert(shouldFetchNextPage(5, 5) === false, 'next: stops at totalPages');
  assert(shouldFetchNextPage(1, 1) === false, 'next: single page stops');
  assert(shouldFetchNextPage(1, 0) === false, 'next: zero totalPages stops');
  // Stops at the cap even when more pages exist.
  assert(shouldFetchNextPage(MAX_LIST_PAGES, 1000) === false, 'next: stops at default cap');
  assert(shouldFetchNextPage(3, 1000, 4) === true, 'next: under explicit cap continues');
  assert(shouldFetchNextPage(4, 1000, 4) === false, 'next: at explicit cap stops');
}

if (failures > 0) {
  console.error(`\n${failures} wordpress-list-pagination smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll wordpress-list-pagination smoke cases passed.');
