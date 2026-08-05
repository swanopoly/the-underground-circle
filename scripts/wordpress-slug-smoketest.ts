/**
 * wordpress-slug-smoketest — offline guard for slugify / normalizeSlug /
 * resolveUniqueSlug used by the WordPress write path.
 *
 * Run: npm run smoke:wordpress-slug
 */

import { slugify, normalizeSlug, resolveUniqueSlug } from '../src/lib/wordpressSlug';

let failures = 0;
function fail(m: string, detail?: string): void { failures += 1; console.error('FAIL:', m, detail ? `— ${detail}` : ''); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(name, detail);
}

// ── slugify ────────────────────────────────────────────────────────────────
assert(slugify('My Post Title!') === 'my-post-title', 'slugify: basic', slugify('My Post Title!'));
assert(slugify('  Leading & Trailing  ') === 'leading-trailing', 'slugify: trims + collapses', slugify('  Leading & Trailing  '));
assert(slugify('Hello   World') === 'hello-world', 'slugify: collapses whitespace runs');
assert(slugify('!!!') === 'post', 'slugify: empty result falls back to "post"', slugify('!!!'));
assert(slugify('') === 'post', 'slugify: empty input falls back');
assert(!slugify('Trailing dash—').endsWith('-'), 'slugify: no trailing dash');
assert(!slugify('---Leading').startsWith('-'), 'slugify: no leading dash');
{
  const long = slugify('a'.repeat(200));
  assert(long.length <= 60, 'slugify: length capped at 60', String(long.length));
  assert(!long.endsWith('-'), 'slugify: cap does not leave trailing dash');
}

// ── normalizeSlug idempotency ────────────────────────────────────────────────
{
  const once = normalizeSlug('My Custom_Slug!');
  const twice = normalizeSlug(once);
  assert(once === twice, 'normalizeSlug: idempotent', `${once} vs ${twice}`);
}

// ── resolveUniqueSlug collisions ──────────────────────────────────────────────
assert(resolveUniqueSlug('my-post', []) === 'my-post', 'resolveUniqueSlug: no collision returns base');
assert(resolveUniqueSlug('my-post', ['my-post']) === 'my-post-2', 'resolveUniqueSlug: first collision → -2');
assert(resolveUniqueSlug('my-post', ['my-post', 'my-post-2']) === 'my-post-3', 'resolveUniqueSlug: chained collision → -3');
assert(resolveUniqueSlug('My-Post', ['my-post']) === 'my-post-2', 'resolveUniqueSlug: case-insensitive collision match');
assert(resolveUniqueSlug('Fresh', ['other', 'thing']) === 'fresh', 'resolveUniqueSlug: normalizes base when free');

if (failures > 0) {
  console.error(`\n${failures} wordpress-slug smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll wordpress-slug smoke cases passed.');
