/**
 * wordpressSeoPreview — pure builder for an approvable, field-level SEO
 * preview card shown after `/wp write` creates a DRAFT, before the user
 * issues the (separately gated) live publish.
 *
 * Dependency-light on purpose: no react-native, no fetch, no runtime imports.
 * Pure markdown copy so the smoke harness (tsx/esbuild) can load it directly
 * and so wordpressChatCommands can reuse the exact rendering.
 *
 * This card is informational + honest: it surfaces what was actually parsed
 * and written (slug is server-derived, so it is rendered as "(auto from
 * title)" rather than implying a value we did not send). It does NOT gate
 * publishing — the existing confirm-token flow in wordpressCommandRisk.ts
 * still owns the `/wp publish <id> confirm` gate.
 */

export interface SeoPreviewFields {
  title?: string;
  slug?: string;
  metaDesc?: string;
  seoTitle?: string;
  focusKeyword?: string;
  tags?: string[];
  postId?: number;
  wordCount?: number;
  featuredImage?: 'attached' | 'failed' | 'none';
}

/** Google snippet meta-description budget. */
const META_DESC_BUDGET = 155;
/** Yoast/RankMath recommended title-tag length cap. */
const SEO_TITLE_HINT = 60;
/** Literal token rendered for an absent/empty field. */
const NONE = '(none)';

/** Markdown-table-safe: collapse newlines and escape pipe chars. */
function cell(value: string): string {
  return value.replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}

/**
 * Renders a compact markdown approval card. Empty/absent fields show the
 * literal `(none)` (slug shows `(auto from title)` since WP derives it
 * server-side). metaDesc is truncated to the Google snippet budget with a
 * trailing ellipsis only when it actually overflows.
 */
export function buildSeoPreviewCard(f: SeoPreviewFields): string {
  const title = f.title?.trim() ? cell(f.title.trim()) : NONE;

  const slugRaw = f.slug?.trim();
  const slug = slugRaw ? cell(slugRaw) : '(auto from title)';

  const seoTitleRaw = f.seoTitle?.trim();
  let seoTitleCell = seoTitleRaw ? cell(seoTitleRaw) : NONE;
  if (seoTitleRaw && seoTitleRaw.length > SEO_TITLE_HINT) {
    seoTitleCell = `${seoTitleCell} (${seoTitleRaw.length} chars — over ${SEO_TITLE_HINT})`;
  }

  const metaRaw = f.metaDesc?.trim();
  const metaCell = metaRaw ? cell(truncate(metaRaw, META_DESC_BUDGET)) : NONE;

  const kw = f.focusKeyword?.trim() ? cell(f.focusKeyword.trim()) : NONE;

  const tagList = (f.tags || []).map((t) => String(t || '').trim()).filter(Boolean);
  const tags = tagList.length ? cell(tagList.join(', ')) : NONE;

  const featured =
    f.featuredImage === 'attached' ? 'Attached'
    : f.featuredImage === 'failed' ? 'Upload failed'
    : NONE;

  const words = typeof f.wordCount === 'number' && f.wordCount > 0 ? `~${f.wordCount}` : NONE;

  return [
    '| SEO Field | Value |',
    '|---|---|',
    `| Title | ${title} |`,
    `| Slug | ${slug} |`,
    `| SEO Title (title tag) | ${seoTitleCell} |`,
    `| Meta Description | ${metaCell} |`,
    `| Focus Keyword | ${kw} |`,
    `| Tags | ${tags} |`,
    `| Featured Image | ${featured} |`,
    `| Words | ${words} |`,
  ].join('\n');
}
