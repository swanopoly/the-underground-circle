/**
 * wordpressContentMetadata — pure helpers for WordPress content quality:
 * HTML escaping, SEO meta key mapping (Yoast + RankMath), and escaped
 * Gutenberg block builders.
 *
 * Dependency-light on purpose: no react-native, no fetch. Pure functions so
 * the smoke harness (tsx/esbuild) can load it directly, and so siteAutomation
 * / wordpressChatCommands can reuse the exact same escaping/meta logic.
 *
 * IMPORTANT: these escape only their TEXT arguments. The Gutenberg block
 * comment delimiters and any AI-authored `content` HTML are NOT escaped here —
 * callers must keep passing rich HTML through untouched.
 */

/**
 * Escapes the five HTML special characters. Use on plain text that will be
 * interpolated into HTML element bodies/attributes — never on already-formed
 * HTML markup.
 */
export function escapeHtml(input: unknown): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface SeoMetaInput {
  metaDesc?: string;
  seoTitle?: string;
  focusKeyword?: string;
}

/**
 * Maps SEO fields onto BOTH Yoast and RankMath post-meta keys so the metadata
 * lands regardless of which SEO plugin the site runs. Absent fields are
 * omitted entirely (no empty keys written).
 */
export function buildSeoMeta(input: SeoMetaInput): Record<string, string> {
  const meta: Record<string, string> = {};
  const desc = input.metaDesc?.trim();
  const title = input.seoTitle?.trim();
  const kw = input.focusKeyword?.trim();
  if (desc) {
    meta._yoast_wpseo_metadesc = desc;
    meta.rank_math_description = desc;
  }
  if (title) {
    meta._yoast_wpseo_title = title;
    meta.rank_math_title = title;
  }
  if (kw) {
    meta._yoast_wpseo_focuskw = kw;
    meta.rank_math_focus_keyword = kw;
  }
  return meta;
}

export interface SeoMetaDiff {
  persisted: string[];
  dropped: string[];
  blocker?: string;
}

/**
 * Compares the SEO meta keys we REQUESTED against the meta WordPress echoed
 * back on the authenticated create response. WP only echoes meta for keys that
 * are show_in_rest-registered and editable by the current user, so a missing
 * key in the response is a reliable "dropped" signal (the SEO plugin may own
 * it server-side, or it lacks REST registration). Presence proves the echo,
 * not that a specific plugin UI reads that exact key — the blocker wording
 * stays honest about that.
 *
 * Never throws and never fails the publish: the draft already exists; this
 * only produces an honest status row.
 */
export function diffPersistedSeoMeta(
  requested: Record<string, string> | undefined,
  returned: Record<string, unknown> | undefined,
): SeoMetaDiff {
  const keys = requested ? Object.keys(requested) : [];
  if (keys.length === 0) return { persisted: [], dropped: [] };

  const hasReturned = !!returned && typeof returned === 'object';
  const persisted: string[] = [];
  const dropped: string[] = [];
  for (const key of keys) {
    const value = hasReturned ? (returned as Record<string, unknown>)[key] : undefined;
    const present = hasReturned
      && value !== undefined
      && value !== null
      && String(value).trim().length > 0;
    if (present) persisted.push(key);
    else dropped.push(key);
  }

  const diff: SeoMetaDiff = { persisted, dropped };
  if (dropped.length > 0) {
    diff.blocker = `WP did not persist ${dropped.length} SEO meta key(s) (likely missing show_in_rest registration or the SEO plugin owns them server-side) — the draft was still created.`;
  }
  return diff;
}

/**
 * Honest staleness notice for SEO meta that WAS persisted via REST. REST writing
 * the post-meta row does NOT guarantee the live frontend reflects it: Yoast /
 * RankMath maintain their own indexable tables and most sites sit behind an
 * object/page cache, both of which can lag until the post is re-saved in
 * wp-admin or the SEO index rebuilds. Returns '' when nothing persisted so the
 * caller can no-op; never claims "SEO live".
 */
export function buildSeoStalenessNotice(persistedCount: number): string {
  if (persistedCount <= 0) return '';
  return 'SEO meta saved via REST, but Yoast/RankMath indexables and any object/page cache may lag the live frontend until the post is re-saved in wp-admin or the SEO index rebuilds — not confirmed live yet.';
}

// ── Escaped Gutenberg block builders ─────────────────────────────────────────
// Mirror the shapes in siteAutomation.ts `wpBlock`, but escape the TEXT args.

export function escapedParagraph(text: string): string {
  return `<!-- wp:paragraph -->\n<p>${escapeHtml(text)}</p>\n<!-- /wp:paragraph -->`;
}

export function escapedHeading(text: string, level: 2 | 3 | 4 = 2): string {
  return `<!-- wp:heading {"level":${level}} -->\n<h${level}>${escapeHtml(text)}</h${level}>\n<!-- /wp:heading -->`;
}

export function escapedList(items: string[], ordered = false): string {
  const tag = ordered ? 'ol' : 'ul';
  const inner = items.map((i) => `<li>${escapeHtml(i)}</li>`).join('\n');
  return `<!-- wp:list ${ordered ? '{"ordered":true}' : '{}'} -->\n<${tag}>\n${inner}\n</${tag}>\n<!-- /wp:list -->`;
}

export function escapedQuote(text: string, citation?: string): string {
  const cite = citation ? `<cite>${escapeHtml(citation)}</cite>` : '';
  return `<!-- wp:quote -->\n<blockquote class="wp-block-quote"><p>${escapeHtml(text)}</p>${cite}</blockquote>\n<!-- /wp:quote -->`;
}

/** Escapes only the alt text for an image block; url/id are structural. */
export function escapedImageAlt(url: string, alt = '', id?: number): string {
  const safeAlt = escapeHtml(alt);
  return `<!-- wp:image ${id ? `{"id":${id}}` : '{}'} -->\n<figure class="wp-block-image"><img src="${url}" alt="${safeAlt}"${id ? ` class="wp-image-${id}"` : ''}/></figure>\n<!-- /wp:image -->`;
}
