/**
 * wordpress-seo-preview-smoketest — offline guard for buildSeoPreviewCard,
 * the field-level SEO approval card shown after `/wp write` drafts a post.
 *
 * Run: npm run smoke:wordpress-seo-preview
 */

import { buildSeoPreviewCard } from '../src/lib/wordpressSeoPreview';

let failures = 0;
function fail(m: string, detail?: string): void { failures += 1; console.error('FAIL:', m, detail ? `— ${detail}` : ''); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(name, detail);
}

// ── Field rendering ──────────────────────────────────────────────────────────
{
  const card = buildSeoPreviewCard({
    title: 'My Great Post',
    seoTitle: 'My Great Post — Best Guide',
    metaDesc: 'A short description.',
    focusKeyword: 'great post',
    tags: ['guides', 'seo'],
    postId: 42,
    wordCount: 812,
    featuredImage: 'attached',
  });
  assert(card.includes('| Title | My Great Post |'), 'renders title');
  assert(card.includes('My Great Post — Best Guide'), 'renders seo title');
  assert(card.includes('A short description.'), 'renders meta desc');
  assert(card.includes('| Focus Keyword | great post |'), 'renders focus keyword');
  assert(card.includes('guides, seo'), 'renders tag list');
  assert(card.includes('| Featured Image | Attached |'), 'renders featured attached');
  assert(card.includes('~812'), 'renders word count');
  // Auto slug since none passed.
  assert(card.includes('(auto from title)'), 'slug shows auto-from-title when absent');
}

// ── Empty-field flagging ──────────────────────────────────────────────────────
{
  const card = buildSeoPreviewCard({ title: 'Bare' });
  assert(card.includes('| SEO Title (title tag) | (none) |'), 'empty seo title → (none)');
  assert(card.includes('| Meta Description | (none) |'), 'empty meta desc → (none)');
  assert(card.includes('| Focus Keyword | (none) |'), 'empty focus keyword → (none)');
  assert(card.includes('| Tags | (none) |'), 'empty tags → (none)');
  assert(card.includes('| Featured Image | (none) |'), 'no featured → (none)');
  assert(card.includes('| Words | (none) |'), 'no word count → (none)');
}

// ── metaDesc truncation ────────────────────────────────────────────────────────
{
  const long = 'x'.repeat(300);
  const card = buildSeoPreviewCard({ title: 'T', metaDesc: long });
  assert(card.includes('…'), 'long meta desc is truncated with ellipsis');
  // No ellipsis on a short one.
  const short = buildSeoPreviewCard({ title: 'T', metaDesc: 'short desc' });
  assert(!short.includes('…'), 'short meta desc is not truncated');
  // Empty never gets an ellipsis.
  const none = buildSeoPreviewCard({ title: 'T' });
  assert(!none.includes('…'), 'empty meta desc has no ellipsis');
}

// ── Pipe escaping keeps the table intact ───────────────────────────────────────
{
  const card = buildSeoPreviewCard({ title: 'A | B | C', metaDesc: 'has | pipes', tags: ['x|y'] });
  assert(card.includes('A \\| B \\| C'), 'pipes in title escaped');
  assert(card.includes('has \\| pipes'), 'pipes in meta escaped');
  assert(card.includes('x\\|y'), 'pipes in tags escaped');
  // The header/separator rows must remain valid (3 unescaped pipes each).
  assert(card.includes('| SEO Field | Value |'), 'header row intact');
  assert(card.includes('|---|---|'), 'separator row intact');
}

// ── seoTitle length hint ────────────────────────────────────────────────────────
{
  const over = 'T'.repeat(70);
  const card = buildSeoPreviewCard({ title: 'X', seoTitle: over });
  assert(/70 chars — over 60/.test(card), 'seo title >60 shows length hint');
  const under = buildSeoPreviewCard({ title: 'X', seoTitle: 'short title' });
  assert(!/chars — over 60/.test(under), 'short seo title shows no hint');
}

if (failures > 0) {
  console.error(`\n${failures} wordpress-seo-preview smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll wordpress-seo-preview smoke cases passed.');
