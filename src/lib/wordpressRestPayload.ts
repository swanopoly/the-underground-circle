export type WordPressRestPostStatus = 'publish' | 'draft' | 'pending' | 'future' | 'private';

export type WordPressValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type NormalizedWordPressSite = {
  siteUrl: string;
  onePasswordItem: string;
  onePasswordVault?: string;
};

export type NormalizedWordPressUpdatePost = {
  postId: number;
  postType?: string;
  title?: string;
  content?: string;
  status?: WordPressRestPostStatus;
  slug?: string;
  excerpt?: string;
  date?: string;
  featured_media?: number;
  menu_order?: number;
  meta?: Record<string, string | number | boolean | null>;
};

export type NormalizedWordPressTrashPost = {
  postId: number;
  postType?: string;
  force: false;
};

export interface WordPressRestPostPayloadInput {
  title: string;
  content: string;
  status: WordPressRestPostStatus;
  categories?: number[];
  tags?: number[];
  excerpt?: string;
  slug?: string;
  date?: string;
  meta?: Record<string, string>;
}

export function buildWordPressPostBody(
  request: WordPressRestPostPayloadInput,
  featuredMediaId?: number,
): Record<string, unknown> {
  const postBody: Record<string, unknown> = {
    title: request.title,
    content: request.content,
    status: request.status,
  };

  if (request.excerpt) {
    postBody.excerpt = request.excerpt;
  }
  if (request.slug) {
    postBody.slug = request.slug;
  }
  if (request.date) {
    postBody.date = request.date;
  }
  if (request.meta && Object.keys(request.meta).length > 0) {
    postBody.meta = request.meta;
  }
  if (featuredMediaId) {
    postBody.featured_media = featuredMediaId;
  }
  if (request.categories && request.categories.length > 0) {
    postBody.categories = request.categories;
  }
  if (request.tags && request.tags.length > 0) {
    postBody.tags = request.tags;
  }

  return postBody;
}

const WP_UPDATE_META_MAX_KEYS = 30;
const WP_UPDATE_META_KEY_MAX_CHARS = 80;
const WP_UPDATE_META_STRING_MAX_CHARS = 2_000;
const WP_UPDATE_META_MAX_JSON_CHARS = 8_000;

function isAllowedWpPostType(postType: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(postType);
}

function normalizeWpUpdateMeta(meta: unknown): WordPressValidationResult<Record<string, string | number | boolean | null> | undefined> {
  if (meta === undefined || meta === null) return { ok: true, value: undefined };
  if (typeof meta !== 'object' || Array.isArray(meta)) {
    return { ok: false, error: 'meta must be an object with scalar values' };
  }
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length > WP_UPDATE_META_MAX_KEYS) {
    return { ok: false, error: `meta may include at most ${WP_UPDATE_META_MAX_KEYS} keys` };
  }
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    if (!key || key.length > WP_UPDATE_META_KEY_MAX_CHARS || !/^[A-Za-z0-9_.:-]+$/.test(key)) {
      return { ok: false, error: 'meta keys may only contain letters, numbers, underscores, dashes, periods, and colons' };
    }
    if (value === null || typeof value === 'boolean') {
      out[key] = value;
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return { ok: false, error: `meta.${key} must be finite` };
      out[key] = value;
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > WP_UPDATE_META_STRING_MAX_CHARS) return { ok: false, error: `meta.${key} is too long` };
      out[key] = value;
      continue;
    }
    return { ok: false, error: `meta.${key} must be a scalar value` };
  }
  if (JSON.stringify(out).length > WP_UPDATE_META_MAX_JSON_CHARS) {
    return { ok: false, error: 'meta payload is too large' };
  }
  return { ok: true, value: out };
}

export function normalizeWordPressSiteConfig(input: Record<string, unknown>): WordPressValidationResult<NormalizedWordPressSite> {
  const siteUrl = String(input?.siteUrl || '').trim();
  if (!/^https?:\/\//i.test(siteUrl)) return { ok: false, error: 'siteUrl must start with http(s)://' };
  const onePasswordItem = String(input?.onePasswordItem || '').trim();
  if (!onePasswordItem) return { ok: false, error: 'onePasswordItem required' };
  const onePasswordVault = typeof input?.vault === 'string' && input.vault.trim() ? input.vault.trim() : undefined;
  return { ok: true, value: { siteUrl, onePasswordItem, onePasswordVault } };
}

export function normalizeWordPressUpdatePostMutation(
  input: Record<string, unknown>,
): WordPressValidationResult<{ site: NormalizedWordPressSite; update: NormalizedWordPressUpdatePost }> {
  const siteResult = normalizeWordPressSiteConfig(input);
  if (!siteResult.ok) return siteResult;
  const postId = Number(input?.postId);
  if (!Number.isFinite(postId) || postId <= 0) return { ok: false, error: 'postId must be a positive number' };
  const postType = typeof input?.postType === 'string' && input.postType.trim() ? input.postType.trim() : undefined;
  if (postType && !isAllowedWpPostType(postType)) {
    return { ok: false, error: 'postType may only contain letters, numbers, underscores, and hyphens' };
  }
  const hasStatus = Object.prototype.hasOwnProperty.call(input, 'status');
  const allowedStatuses: WordPressRestPostStatus[] = ['draft', 'publish', 'private', 'pending', 'future'];
  if (hasStatus && (typeof input.status !== 'string' || !allowedStatuses.includes(input.status as WordPressRestPostStatus))) {
    return { ok: false, error: 'status must be draft, publish, private, pending, or future' };
  }
  const status = hasStatus ? input.status as WordPressRestPostStatus : undefined;
  const slug = typeof input?.slug === 'string' ? input.slug.trim() : undefined;
  if (slug && (slug.length > 200 || !/^[A-Za-z0-9](?:[A-Za-z0-9_-]*[A-Za-z0-9])?$/.test(slug))) {
    return { ok: false, error: 'slug must be 1-200 URL-safe characters' };
  }
  const date = typeof input?.date === 'string' && input.date.trim() ? input.date.trim() : undefined;
  if (date && Number.isNaN(Date.parse(date))) return { ok: false, error: 'date must be a valid ISO-compatible date' };
  if (status === 'future' && !date) return { ok: false, error: 'status future requires a date' };
  const rawFeaturedMedia = input?.featuredMedia ?? input?.featured_media;
  const hasFeaturedMedia = rawFeaturedMedia !== undefined && rawFeaturedMedia !== null && rawFeaturedMedia !== '';
  const featuredMedia = Number(rawFeaturedMedia);
  if (hasFeaturedMedia && (!Number.isFinite(featuredMedia) || featuredMedia < 0)) {
    return { ok: false, error: 'featuredMedia must be a non-negative number' };
  }
  const rawMenuOrder = input?.menuOrder ?? input?.menu_order;
  const hasMenuOrder = rawMenuOrder !== undefined && rawMenuOrder !== null && rawMenuOrder !== '';
  const menuOrder = Number(rawMenuOrder);
  if (hasMenuOrder && !Number.isFinite(menuOrder)) return { ok: false, error: 'menuOrder must be a finite number' };
  const metaResult = normalizeWpUpdateMeta(input?.meta);
  if (!metaResult.ok) return metaResult;
  const update: NormalizedWordPressUpdatePost = {
    postId,
    postType,
    title: typeof input?.title === 'string' ? input.title : undefined,
    content: typeof input?.content === 'string' ? input.content : undefined,
    status,
    slug,
    excerpt: typeof input?.excerpt === 'string' ? input.excerpt : undefined,
    date,
    featured_media: hasFeaturedMedia ? featuredMedia : undefined,
    menu_order: hasMenuOrder ? menuOrder : undefined,
    meta: metaResult.value,
  };
  if (!Object.entries(update).some(([key, value]) => key !== 'postId' && key !== 'postType' && value !== undefined)) {
    return { ok: false, error: 'No WordPress update fields provided' };
  }
  return { ok: true, value: { site: siteResult.value, update } };
}

export function normalizeWordPressTrashPostMutation(
  input: Record<string, unknown>,
): WordPressValidationResult<{ site: NormalizedWordPressSite; trash: NormalizedWordPressTrashPost }> {
  const siteResult = normalizeWordPressSiteConfig(input);
  if (!siteResult.ok) return siteResult;
  const postId = Number(input?.postId);
  if (!Number.isFinite(postId) || postId <= 0) return { ok: false, error: 'postId must be a positive number' };
  const postType = typeof input?.postType === 'string' && input.postType.trim() ? input.postType.trim() : undefined;
  if (postType && !isAllowedWpPostType(postType)) {
    return { ok: false, error: 'postType may only contain letters, numbers, underscores, and hyphens' };
  }
  if (Object.prototype.hasOwnProperty.call(input, 'force')) {
    return { ok: false, error: 'wp.trash_post only supports restorable trash. Permanent delete is not supported.' };
  }
  return { ok: true, value: { site: siteResult.value, trash: { postId, postType, force: false } } };
}
