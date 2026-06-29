/**
 * wordpress-rest-payload-smoketest — offline guard for WordPress REST post
 * payload fields used by /wp draft/write/schedule flows.
 *
 * Run: npm run smoke:wordpress-rest-payload
 */

import {
  buildWordPressPostBody,
  normalizeWordPressSiteConfig,
  normalizeWordPressTrashPostMutation,
  normalizeWordPressUpdatePostMutation,
} from '../src/lib/wordpressRestPayload';

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

const scheduledDate = '2026-07-01T14:00:00.000Z';
const payload = buildWordPressPostBody({
  title: 'Scheduled Launch',
  content: '<p>Launch body</p>',
  status: 'future',
  date: scheduledDate,
  slug: 'scheduled-launch',
  excerpt: 'Short launch excerpt',
  categories: [10, 20],
  tags: [30],
  meta: {
    _yoast_wpseo_metadesc: 'Launch meta description',
    rank_math_description: 'Launch meta description',
  },
}, 44);

assert(payload.title === 'Scheduled Launch', 'includes title field', String(payload.title));
assert(payload.content === '<p>Launch body</p>', 'includes content field', String(payload.content));
assert(payload.status === 'future', 'preserves scheduled/future status', String(payload.status));
assert(payload.date === scheduledDate, 'includes scheduled publish date', String(payload.date));
assert(payload.slug === 'scheduled-launch', 'includes slug field', String(payload.slug));
assert(payload.excerpt === 'Short launch excerpt', 'includes excerpt field', String(payload.excerpt));
assert(payload.featured_media === 44, 'includes featured media id', String(payload.featured_media));
assert(Array.isArray(payload.categories) && (payload.categories as number[]).join(',') === '10,20', 'includes category ids');
assert(Array.isArray(payload.tags) && (payload.tags as number[]).join(',') === '30', 'includes tag ids');
assert((payload.meta as Record<string, string> | undefined)?._yoast_wpseo_metadesc === 'Launch meta description', 'includes SEO meta fields');

const sparse = buildWordPressPostBody({
  title: 'Draft',
  content: '<p>Draft</p>',
  status: 'draft',
});
assert(!('date' in sparse), 'omits empty date field');
assert(!('meta' in sparse), 'omits empty meta field');
assert(!('categories' in sparse), 'omits empty categories field');

const site = normalizeWordPressSiteConfig({
  siteUrl: 'https://dealer.example/wp',
  onePasswordItem: 'Dealer WP',
  vault: 'Client Sites',
});
assert(site.ok && site.value.siteUrl === 'https://dealer.example/wp', 'normalizes WordPress site URL');
assert(site.ok && site.value.onePasswordVault === 'Client Sites', 'normalizes WordPress vault name');

const badSite = normalizeWordPressSiteConfig({ siteUrl: 'ftp://dealer.example', onePasswordItem: 'Dealer WP' });
assert(!badSite.ok && /http/.test(badSite.error), 'rejects non-http WordPress site URL');

const missingCredential = normalizeWordPressSiteConfig({ siteUrl: 'https://dealer.example' });
assert(!missingCredential.ok && /onePasswordItem/.test(missingCredential.error), 'requires WordPress credential item');

const update = normalizeWordPressUpdatePostMutation({
  siteUrl: 'https://dealer.example',
  onePasswordItem: 'Dealer WP',
  postId: 14030,
  postType: 'di_slide',
  title: 'Promaster June',
  status: 'future',
  date: '2026-07-01T14:00:00.000Z',
  slug: 'promaster-june',
  excerpt: 'Promaster offer',
  featuredMedia: 44,
  menuOrder: -500,
  meta: {
    expiration_date: '2026/07/31',
    broadcaster_visible: true,
    priority: 2,
    empty: null,
  },
});
assert(update.ok && update.value.update.postId === 14030, 'normalizes update post id');
assert(update.ok && update.value.update.featured_media === 44, 'normalizes featuredMedia alias');
assert(update.ok && update.value.update.menu_order === -500, 'normalizes menuOrder alias');
assert(update.ok && update.value.update.meta?.broadcaster_visible === true, 'keeps scalar meta values');

const updateWithSnakeCaseAliases = normalizeWordPressUpdatePostMutation({
  siteUrl: 'https://dealer.example',
  onePasswordItem: 'Dealer WP',
  postId: 14031,
  featured_media: 45,
  menu_order: 3,
});
assert(updateWithSnakeCaseAliases.ok && updateWithSnakeCaseAliases.value.update.featured_media === 45, 'normalizes featured_media alias');
assert(updateWithSnakeCaseAliases.ok && updateWithSnakeCaseAliases.value.update.menu_order === 3, 'normalizes menu_order alias');

const invalidUpdateCases: Array<[string, Record<string, unknown>, RegExp]> = [
  ['bad post id', { postId: 0, title: 'Nope' }, /postId/],
  ['empty patch', { postId: 14030 }, /No WordPress update fields/],
  ['invalid status', { postId: 14030, status: 'published' }, /status/],
  ['bad post type', { postId: 14030, postType: '../posts', title: 'Nope' }, /postType/],
  ['bad slug', { postId: 14030, slug: '../promo' }, /slug/],
  ['future without date', { postId: 14030, status: 'future' }, /future requires a date/],
  ['bad date', { postId: 14030, date: 'not-a-date' }, /date/],
  ['negative featured media', { postId: 14030, featuredMedia: -1 }, /featuredMedia/],
  ['non-finite menu order', { postId: 14030, menuOrder: Number.NaN }, /menuOrder/],
  ['nested meta', { postId: 14030, meta: { nested: { no: true } } }, /scalar/],
  ['array meta', { postId: 14030, meta: ['nope'] }, /meta/],
  ['bad meta key', { postId: 14030, meta: { 'bad key': 'nope' } }, /meta keys/],
  ['long meta string', { postId: 14030, meta: { long: 'x'.repeat(2_001) } }, /too long/],
];

for (const [label, patch, errorPattern] of invalidUpdateCases) {
  const result = normalizeWordPressUpdatePostMutation({
    siteUrl: 'https://dealer.example',
    onePasswordItem: 'Dealer WP',
    ...patch,
  });
  assert(!result.ok && errorPattern.test(result.error), `rejects invalid update: ${label}`, result.ok ? 'unexpected ok' : result.error);
}

const tooManyMetaKeys = Object.fromEntries(Array.from({ length: 31 }, (_, index) => [`k${index}`, 'v']));
const tooManyMeta = normalizeWordPressUpdatePostMutation({
  siteUrl: 'https://dealer.example',
  onePasswordItem: 'Dealer WP',
  postId: 14030,
  meta: tooManyMetaKeys,
});
assert(!tooManyMeta.ok && /at most 30/.test(tooManyMeta.error), 'rejects oversized meta key count');

const trash = normalizeWordPressTrashPostMutation({
  siteUrl: 'https://dealer.example',
  onePasswordItem: 'Dealer WP',
  postId: 14030,
  postType: 'di_slide',
});
assert(trash.ok && trash.value.trash.force === false, 'normalizes trash as restorable soft-delete');
assert(trash.ok && trash.value.trash.postType === 'di_slide', 'normalizes trash post type');

const trashForce = normalizeWordPressTrashPostMutation({
  siteUrl: 'https://dealer.example',
  onePasswordItem: 'Dealer WP',
  postId: 14030,
  force: true,
});
assert(!trashForce.ok && /Permanent delete/.test(trashForce.error), 'rejects force/permanent trash');

if (failures > 0) {
  console.error(`\n${failures} WordPress REST payload smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll WordPress REST payload smoke cases passed.');
