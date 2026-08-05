/**
 * wordpress-post-type-resolver-smoketest — offline guard for the pure CPT
 * rest_base resolver + REST-publishability classifier (WP R5).
 *
 * Run: npm run smoke:wordpress-post-type-resolver
 */

import {
  resolveRestBase,
  classifyPostTypeWritability,
  type WpPostTypeMap,
} from '../src/lib/wordpressPostTypeResolver';

let failures = 0;
function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}
function pass(message: string): void {
  console.log('pass:', message);
}
function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

const map: WpPostTypeMap = {
  post: { slug: 'post', rest_base: 'posts', name: 'Posts', show_in_rest: true },
  flavor_di_slides: { slug: 'flavor_di_slides', rest_base: 'di-slides', name: 'DI Slides', show_in_rest: true },
  legacy_widget: { slug: 'legacy_widget', name: 'Legacy', show_in_rest: false },
  no_base: { slug: 'no_base', name: 'No Base' },
  older_core: { slug: 'older_core', rest_base: 'older-core', name: 'Older Core' },
};

// ── resolveRestBase ────────────────────────────────────────────────────────
const r1 = resolveRestBase(map, 'post');
assert(r1.source === 'discovered' && r1.restBase === 'posts', 'exact slug match -> discovered, rest_base');

const r2 = resolveRestBase(map, 'flavor_di_slides');
assert(r2.restBase === 'di-slides' && r2.matchedSlug === 'flavor_di_slides', 'rest_base != slug resolved correctly');

const r3 = resolveRestBase(map, 'does_not_exist');
assert(
  r3.source === 'fallback' && r3.restBase === 'does_not_exist' && r3.matchedSlug === 'does_not_exist',
  'missing type -> fallback to requested slug',
);

const r4 = resolveRestBase({}, 'anything');
assert(r4.source === 'fallback' && r4.restBase === 'anything', 'empty map -> fallback, no throw');

const r5 = resolveRestBase(null, 'anything');
assert(r5.source === 'fallback' && r5.restBase === 'anything', 'null map -> fallback, no throw');

const r6 = resolveRestBase(map, 'no_base');
assert(r6.source === 'discovered' && r6.restBase === 'no_base', 'matched entry with no rest_base -> discovered, fallback restBase to slug');

const r7 = resolveRestBase(map, 'di-slides');
assert(
  r7.source === 'discovered' && r7.restBase === 'di-slides' && r7.matchedSlug === 'flavor_di_slides',
  'request can already be the REST base and still resolves to discovered type',
);

// ── classifyPostTypeWritability ────────────────────────────────────────────
const c1 = classifyPostTypeWritability(map.post);
assert(c1.restPublishable && !c1.needsAdminFallback, 'healthy type -> publishable, no fallback');

const c2 = classifyPostTypeWritability(map.legacy_widget);
assert(!c2.restPublishable && c2.needsAdminFallback && c2.reason.includes('show_in_rest'), 'show_in_rest false -> admin fallback');

const c3 = classifyPostTypeWritability(map.no_base);
assert(!c3.restPublishable && c3.needsAdminFallback && c3.reason.includes('rest_base'), 'missing rest_base -> admin fallback');

const c4 = classifyPostTypeWritability(undefined);
assert(!c4.restPublishable && c4.needsAdminFallback && c4.reason.includes('not found'), 'undefined entry -> not found, admin fallback');

const c5 = classifyPostTypeWritability(map.older_core);
assert(c5.restPublishable && !c5.needsAdminFallback, 'show_in_rest undefined + rest_base present -> publishable (older core)');

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log('\nwordpress-post-type-resolver-smoketest: all assertions passed.');
