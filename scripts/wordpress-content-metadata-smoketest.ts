/**
 * wordpress-content-metadata-smoketest — offline guard for HTML escaping,
 * SEO meta key mapping (Yoast + RankMath), and escaped Gutenberg blocks used
 * by /wp write and the wpBlock builders.
 *
 * Run: npm run smoke:wordpress-content-metadata
 */

import {
  escapeHtml,
  buildSeoMeta,
  diffPersistedSeoMeta,
  buildSeoStalenessNotice,
  escapedParagraph,
  escapedHeading,
  escapedList,
  escapedQuote,
  escapedImageAlt,
} from '../src/lib/wordpressContentMetadata';

let failures = 0;
function fail(m: string): void { failures += 1; console.error('FAIL:', m); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(`${name}${detail ? ` — ${detail}` : ''}`);
}

// ── escapeHtml ────────────────────────────────────────────────────────────
{
  const out = escapeHtml(`<b>x & "y" 'z'>`);
  assert(out.includes('&lt;b&gt;'), 'escapeHtml: < > encoded', out);
  assert(out.includes('&amp;'), 'escapeHtml: & encoded', out);
  assert(out.includes('&quot;'), 'escapeHtml: double quote encoded', out);
  assert(out.includes('&#39;'), 'escapeHtml: single quote encoded', out);
  assert(!out.includes('<b>'), 'escapeHtml: no literal tag remains', out);
  assert(escapeHtml(undefined) === '', 'escapeHtml: undefined -> empty');
  // Ampersand must be escaped first (no double-encoding of entities).
  assert(escapeHtml('a & b').indexOf('&amp;') === 2, 'escapeHtml: ampersand escaped once');
}

// ── buildSeoMeta ────────────────────────────────────────────────────────────
{
  const meta = buildSeoMeta({ metaDesc: 'Desc', seoTitle: 'Title', focusKeyword: 'kw' });
  assert(meta._yoast_wpseo_metadesc === 'Desc', 'seo: Yoast desc set');
  assert(meta.rank_math_description === 'Desc', 'seo: RankMath desc set');
  assert(meta._yoast_wpseo_title === 'Title', 'seo: Yoast title set');
  assert(meta.rank_math_title === 'Title', 'seo: RankMath title set');
  assert(meta._yoast_wpseo_focuskw === 'kw', 'seo: Yoast focus kw set');
  assert(meta.rank_math_focus_keyword === 'kw', 'seo: RankMath focus kw set');
}
{
  const meta = buildSeoMeta({ metaDesc: 'OnlyDesc' });
  assert(Object.keys(meta).length === 2, 'seo: absent fields omitted', JSON.stringify(meta));
  assert(!('_yoast_wpseo_title' in meta), 'seo: missing title key omitted');
  assert(!('rank_math_focus_keyword' in meta), 'seo: missing keyword key omitted');
}
{
  const meta = buildSeoMeta({ metaDesc: '   ', seoTitle: '' });
  assert(Object.keys(meta).length === 0, 'seo: blank/whitespace fields omitted', JSON.stringify(meta));
}

// ── diffPersistedSeoMeta (R1) ─────────────────────────────────────────────
{
  const requested = { _yoast_wpseo_metadesc: 'd', rank_math_description: 'd' };
  // (a) all echoed back → persisted, no dropped, no blocker.
  const all = diffPersistedSeoMeta(requested, { _yoast_wpseo_metadesc: 'd', rank_math_description: 'd' });
  assert(all.persisted.length === 2 && all.dropped.length === 0, 'diff: all echoed → persisted', JSON.stringify(all));
  assert(all.blocker === undefined, 'diff: no blocker when all persisted');

  // (b) returned undefined → all dropped + blocker.
  const none = diffPersistedSeoMeta(requested, undefined);
  assert(none.persisted.length === 0 && none.dropped.length === 2, 'diff: undefined returned → all dropped', JSON.stringify(none));
  assert(!!none.blocker, 'diff: blocker set when all dropped');

  // (c) subset missing → only missing dropped + blocker.
  const subset = diffPersistedSeoMeta(requested, { _yoast_wpseo_metadesc: 'd' });
  assert(subset.persisted.length === 1 && subset.dropped.length === 1, 'diff: subset missing', JSON.stringify(subset));
  assert(subset.dropped[0] === 'rank_math_description', 'diff: correct key dropped', JSON.stringify(subset));
  assert(!!subset.blocker, 'diff: blocker set on partial');

  // (d) empty/undefined requested → empty arrays, no blocker.
  const empty = diffPersistedSeoMeta(undefined, { x: 'y' });
  assert(empty.persisted.length === 0 && empty.dropped.length === 0 && !empty.blocker, 'diff: no requested → empty no blocker', JSON.stringify(empty));
  const emptyObj = diffPersistedSeoMeta({}, undefined);
  assert(emptyObj.persisted.length === 0 && emptyObj.dropped.length === 0 && !emptyObj.blocker, 'diff: empty requested → empty no blocker');

  // (e) returned key with empty-string value → counted as dropped.
  const emptyVal = diffPersistedSeoMeta({ a: 'x' }, { a: '   ' });
  assert(emptyVal.dropped.includes('a') && emptyVal.persisted.length === 0, 'diff: empty-string echo counts as dropped', JSON.stringify(emptyVal));
  assert(!!emptyVal.blocker, 'diff: blocker on empty-value drop');
}

// ── buildSeoStalenessNotice (R22) ──────────────────────────────────────────
{
  // 0 persisted → empty, so an all-dropped write never claims anything was saved.
  assert(buildSeoStalenessNotice(0) === '', 'staleness: 0 persisted → empty');
  assert(buildSeoStalenessNotice(-1) === '', 'staleness: negative → empty');

  const note = buildSeoStalenessNotice(2);
  assert(note.length > 0, 'staleness: positive count → non-empty', note);
  assert(/indexable|cache may lag/i.test(note), 'staleness: mentions indexables/cache', note);
  assert(note.includes('not confirmed live'), 'staleness: does not affirmatively claim live', note);
}

// ── escaped block builders ────────────────────────────────────────────────
{
  const p = escapedParagraph('<b>x');
  assert(p.includes('&lt;b&gt;'), 'block: paragraph escapes text', p);
  assert(!p.includes('<b>x'), 'block: paragraph has no literal tag', p);
  assert(p.includes('<!-- wp:paragraph -->'), 'block: paragraph keeps wp delimiter', p);

  const h = escapedHeading('A & B', 3);
  assert(h.includes('<h3>A &amp; B</h3>'), 'block: heading escapes + level', h);
  assert(h.includes('{"level":3}'), 'block: heading carries level attr', h);

  const list = escapedList(['<li>raw', 'plain & ok'], true);
  assert(list.includes('&lt;li&gt;raw'), 'block: list escapes item text', list);
  assert(list.includes('<ol>'), 'block: ordered list uses ol', list);

  const q = escapedQuote('say "hi"', 'Me <them>');
  assert(q.includes('&quot;hi&quot;'), 'block: quote escapes body', q);
  assert(q.includes('&lt;them&gt;'), 'block: quote escapes citation', q);

  const img = escapedImageAlt('https://x/y.png', 'alt "with" <html>', 7);
  assert(img.includes('alt="alt &quot;with&quot; &lt;html&gt;"'), 'block: image escapes alt', img);
  assert(img.includes('src="https://x/y.png"'), 'block: image keeps raw url', img);
  assert(img.includes('wp-image-7'), 'block: image keeps id class', img);
}

if (failures > 0) {
  console.error(`\n${failures} wordpress-content-metadata smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll wordpress-content-metadata smoke cases passed.');
