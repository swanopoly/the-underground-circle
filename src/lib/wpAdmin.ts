/**
 * wpAdmin — WordPress REST API client for OpenSwan.
 *
 * Handles: media upload, post/page/CPT CRUD, slide creation, site discovery.
 * Authentication via WP Application Passwords (Basic auth) with credentials
 * fetched from 1Password at call time — never stored in the browser.
 *
 * Flow:
 *   1. User says "upload this to DI Slides"
 *   2. OpenSwan resolves WP credentials from 1Password via bridge /secrets
 *   3. Uploads the image to /wp-json/wp/v2/media
 *   4. Creates the slide via the plugin's CPT REST endpoint
 *   5. Reports success with the slide URL
 */

import { getCredentials } from './credentialService';
import { supabase } from './supabase';
import { redactRestError } from './wordpressRestError';
import {
  buildCaptionFollowUpBody,
  buildMediaUploadHeaders,
  resolveUploadMimeType,
} from './wordpressMediaUpload';
import {
  classifyPostTypeWritability,
  resolveRestBase,
  type WpPostTypeMap,
} from './wordpressPostTypeResolver';

export interface WpSiteConfig {
  siteUrl: string;           // e.g. "https://www.example.com/wp"
  onePasswordItem: string;   // e.g. "WordPress Warsaw" — the 1Password item name
  onePasswordVault?: string; // optional vault override
}

export interface WpAuthHeaders {
  Authorization: string;
  'Content-Type'?: string;
}

interface WpMediaResult {
  id: number;
  source_url: string;
  title: { rendered: string };
  link: string;
  error?: string;
}

interface WpPostResult {
  id: number;
  link: string;
  title: { rendered: string };
  status: string;
  error?: string;
}

type WpWritableStatus = 'draft' | 'publish' | 'private' | 'pending' | 'future';

export interface WpUpdatePostOptions {
  postId: number;
  postType?: string;
  title?: string;
  content?: string;
  status?: WpWritableStatus;
  slug?: string;
  excerpt?: string;
  date?: string;
  featured_media?: number;
  menu_order?: number;
  meta?: Record<string, unknown>;
}

export interface WpTrashPostOptions {
  postId: number;
  postType?: string;
  force?: boolean;
}

interface WpTrashPostResult {
  id?: number;
  link?: string;
  title?: { rendered?: string } | string;
  status?: string;
  deleted?: boolean;
  previous?: WpPostResult;
  error?: string;
}

// ── Auth ────────────────────────────────────────────────────────────────────

async function resolveAuth(config: WpSiteConfig): Promise<WpAuthHeaders | null> {
  const { ok, fields, error } = await getCredentials({
    item: config.onePasswordItem,
    vault: config.onePasswordVault,
    fields: ['username', 'password'],
  });
  if (!ok || !fields.username || !fields.password) {
    console.warn('[wpAdmin] credential resolution failed:', error);
    return null;
  }
  const basic = btoa(`${fields.username}:${fields.password}`);
  return { Authorization: `Basic ${basic}` };
}

function apiUrl(config: WpSiteConfig, path: string): string {
  const base = config.siteUrl.replace(/\/+$/, '');
  return `${base}/wp-json/wp/v2${path}`;
}

const BUILT_IN_REST_BASE_BY_POST_TYPE: Record<string, string> = {
  post: 'posts',
  posts: 'posts',
  page: 'pages',
  pages: 'pages',
};

function validatePostTypeSlug(postType: string): void {
  if (!/^[A-Za-z0-9_-]+$/.test(postType)) {
    throw new Error('postType may only contain letters, numbers, underscores, and hyphens');
  }
}

async function resolvePostTypeRestBase(
  config: WpSiteConfig,
  postType?: string,
  opts: { requireRestWritable?: boolean } = {},
): Promise<string> {
  const requested = postType && postType.trim() ? postType.trim() : 'posts';
  validatePostTypeSlug(requested);

  const builtIn = BUILT_IN_REST_BASE_BY_POST_TYPE[requested];
  if (builtIn) return builtIn;

  let types: WpPostTypeMap;
  try {
    types = await discoverPostTypes(config);
  } catch {
    // Preserve existing CPT behavior when discovery is temporarily unavailable,
    // but only after validating the slug so arbitrary paths cannot be built.
    return requested;
  }

  const resolved = resolveRestBase(types, requested);
  const entry = types[resolved.matchedSlug]
    || Object.values(types).find((candidate) => (
      candidate?.slug === resolved.matchedSlug || candidate?.rest_base === resolved.restBase
    ));
  const writability = classifyPostTypeWritability(entry);
  if (opts.requireRestWritable && writability.needsAdminFallback) {
    throw new Error(`WordPress post type "${requested}" is not available through REST (${writability.reason}). Use the wp-admin browser automation fallback.`);
  }

  validatePostTypeSlug(resolved.restBase);
  return resolved.restBase;
}

async function resolveDefaultSlidePostType(config: WpSiteConfig): Promise<string> {
  try {
    const types = await discoverPostTypes(config);
    const preferred = Object.entries(types).find(([key, entry]) => {
      const haystack = `${key} ${entry?.slug || ''} ${entry?.rest_base || ''} ${entry?.name || ''}`.toLowerCase();
      return /\bdi[_-]?slide\b|\bdi[_-]?slides\b|dealer inspire.+slides|\bslides\b/.test(haystack)
        && !/\bslider\b|\bsliders\b/.test(haystack);
    });
    return preferred?.[1]?.slug || preferred?.[0] || 'di_slide';
  } catch {
    return 'di_slide';
  }
}

// ── Media Upload ────────────────────────────────────────────────────────────

export async function uploadMedia(
  config: WpSiteConfig,
  file: { name: string; blob: Blob; mimeType?: string; altText?: string; caption?: string },
): Promise<WpMediaResult> {
  const auth = await resolveAuth(config);
  if (!auth) throw new Error('Could not resolve WordPress credentials from 1Password');

  // R6: prefer the raw-binary upload path (Content-Type + Content-Disposition)
  // when we can determine a mime type — WP reads the filename from the
  // disposition header and the mime from Content-Type, which is more reliable
  // than guessing from a multipart part. When the mime is indeterminate, fall
  // back to the existing multipart FormData path so there is never a regression.
  const mimeType = (file.mimeType && file.mimeType.trim())
    || resolveUploadMimeType(file.blob?.type, file.name);

  let res: Response;
  if (mimeType) {
    res = await fetch(apiUrl(config, '/media'), {
      method: 'POST',
      headers: buildMediaUploadHeaders({ authorization: auth.Authorization, mimeType, filename: file.name }),
      body: file.blob,
      signal: AbortSignal.timeout(60000),
    });
  } else {
    const formData = new FormData();
    formData.append('file', file.blob, file.name);
    formData.append('title', file.name.replace(/\.[^.]+$/, ''));
    res = await fetch(apiUrl(config, '/media'), {
      method: 'POST',
      headers: { Authorization: auth.Authorization },
      body: formData,
      signal: AbortSignal.timeout(60000),
    });
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`WP media upload failed: ${redactRestError(errText, res.status)}`);
  }
  const media: WpMediaResult = await res.json();

  // WP often ignores alt text / caption on the media create endpoint. Confirm
  // them with JSON follow-up POSTs; non-fatal — keep the uploaded media on
  // failure. Build a single follow-up body so we only make one request.
  if (media?.id) {
    const captionBody = buildCaptionFollowUpBody(file.caption);
    const followUp: Record<string, unknown> = {};
    if (file.altText) followUp.alt_text = file.altText;
    if (captionBody) followUp.caption = captionBody.caption;
    if (Object.keys(followUp).length > 0) {
      try {
        await fetch(apiUrl(config, `/media/${media.id}`), {
          method: 'POST',
          headers: { Authorization: auth.Authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify(followUp),
          signal: AbortSignal.timeout(30000),
        });
      } catch (followErr) {
        console.warn('[wpAdmin] media alt_text/caption follow-up failed:', followErr);
      }
    }
  }
  return media;
}

/**
 * Upload from a Supabase Storage path — fetches the blob, then uploads to WP.
 */
export async function uploadMediaFromStorage(
  config: WpSiteConfig,
  storagePath: string,
  fileName: string,
  mimeType: string,
): Promise<WpMediaResult> {
  const { data } = await supabase.storage
    .from('chat-attachments')
    .createSignedUrl(storagePath, 300);
  if (!data?.signedUrl) throw new Error('Could not create signed URL for attachment');

  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error(`Failed to fetch attachment: ${res.status}`);
  const blob = await res.blob();

  return uploadMedia(config, { name: fileName, blob, mimeType });
}

// ── Posts / Custom Post Types ───────────────────────────────────────────────

export async function createPost(
  config: WpSiteConfig,
  opts: {
    title: string;
    content?: string;
    status?: 'draft' | 'publish' | 'private';
    featured_media?: number; // media ID from uploadMedia
    postType?: string;       // default 'posts', or 'di-slide', 'pages', etc.
    meta?: Record<string, unknown>;
  },
): Promise<WpPostResult> {
  const auth = await resolveAuth(config);
  if (!auth) throw new Error('Could not resolve WordPress credentials from 1Password');

  const restBase = await resolvePostTypeRestBase(config, opts.postType, { requireRestWritable: true });
  const endpoint = `/${restBase}`;

  const body: Record<string, unknown> = {
    title: opts.title,
    content: opts.content || '',
    status: opts.status || 'draft',
  };
  if (opts.featured_media) body.featured_media = opts.featured_media;
  if (opts.meta) body.meta = opts.meta;

  const res = await fetch(apiUrl(config, endpoint), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`WP create ${opts.postType || 'post'} failed: ${redactRestError(errText, res.status)}`);
  }
  return await res.json();
}

export async function updatePost(
  config: WpSiteConfig,
  opts: WpUpdatePostOptions,
): Promise<WpPostResult> {
  const auth = await resolveAuth(config);
  if (!auth) throw new Error('Could not resolve WordPress credentials from 1Password');
  if (!Number.isFinite(opts.postId) || opts.postId <= 0) {
    throw new Error('postId must be a positive number');
  }

  const restBase = await resolvePostTypeRestBase(config, opts.postType, { requireRestWritable: true });
  const endpoint = `/${restBase}/${opts.postId}`;

  const body: Record<string, unknown> = {};
  if (typeof opts.title === 'string') body.title = opts.title;
  if (typeof opts.content === 'string') body.content = opts.content;
  if (typeof opts.status === 'string') body.status = opts.status;
  if (typeof opts.slug === 'string') body.slug = opts.slug;
  if (typeof opts.excerpt === 'string') body.excerpt = opts.excerpt;
  if (typeof opts.date === 'string') body.date = opts.date;
  if (typeof opts.featured_media === 'number' && Number.isFinite(opts.featured_media)) {
    body.featured_media = opts.featured_media;
  }
  if (typeof opts.menu_order === 'number' && Number.isFinite(opts.menu_order)) {
    body.menu_order = opts.menu_order;
  }
  if (opts.meta && typeof opts.meta === 'object' && !Array.isArray(opts.meta)) {
    body.meta = opts.meta;
  }
  if (Object.keys(body).length === 0) {
    throw new Error('No WordPress update fields provided');
  }

  const res = await fetch(apiUrl(config, endpoint), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`WP update ${opts.postType || 'post'} ${opts.postId} failed: ${redactRestError(errText, res.status)}`);
  }
  return await res.json();
}

export async function trashPost(
  config: WpSiteConfig,
  opts: WpTrashPostOptions,
): Promise<WpTrashPostResult> {
  const auth = await resolveAuth(config);
  if (!auth) throw new Error('Could not resolve WordPress credentials from 1Password');
  if (!Number.isFinite(opts.postId) || opts.postId <= 0) {
    throw new Error('postId must be a positive number');
  }

  const restBase = await resolvePostTypeRestBase(config, opts.postType, { requireRestWritable: true });
  const endpoint = `/${restBase}/${opts.postId}`;
  const params = new URLSearchParams({ force: opts.force === true ? 'true' : 'false' });

  const res = await fetch(`${apiUrl(config, endpoint)}?${params}`, {
    method: 'DELETE',
    headers: { ...auth, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`WP delete ${opts.postType || 'post'} ${opts.postId} failed: ${redactRestError(errText, res.status)}`);
  }
  return await res.json();
}

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * List available post types on the site — useful for discovering if
 * DI Slides or other plugins register custom REST endpoints.
 */
export async function discoverPostTypes(config: WpSiteConfig): Promise<Record<string, { name: string; slug: string; rest_base: string; show_in_rest?: boolean }>> {
  const auth = await resolveAuth(config);
  if (!auth) throw new Error('Could not resolve WordPress credentials');

  const res = await fetch(`${config.siteUrl.replace(/\/+$/, '')}/wp-json/wp/v2/types`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`WP types discovery failed: ${res.status}`);
  return await res.json();
}

/**
 * List posts/items of any type — for browsing existing slides, pages, etc.
 */
export async function listPosts(
  config: WpSiteConfig,
  opts: { postType?: string; perPage?: number; status?: string },
): Promise<WpPostResult[]> {
  const auth = await resolveAuth(config);
  if (!auth) throw new Error('Could not resolve WordPress credentials');

  const restBase = await resolvePostTypeRestBase(config, opts.postType, { requireRestWritable: true });
  const endpoint = `/${restBase}`;
  const params = new URLSearchParams();
  params.set('per_page', String(opts.perPage || 20));
  if (opts.status) params.set('status', opts.status);

  const res = await fetch(`${apiUrl(config, endpoint)}?${params}`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`WP list ${opts.postType || 'posts'} failed: ${res.status}`);
  return await res.json();
}

// ── Convenience: Upload Image → Create Slide (one call) ────────────────────

export async function uploadImageAndCreateSlide(
  config: WpSiteConfig,
  image: { storagePath: string; fileName: string; mimeType: string },
  slideOpts?: { title?: string; status?: 'draft' | 'publish'; slideType?: string },
): Promise<{ media: WpMediaResult; slide: WpPostResult }> {
  // 1. Upload the image
  const media = await uploadMediaFromStorage(
    config, image.storagePath, image.fileName, image.mimeType,
  );

  // 2. Create the slide with the uploaded image as featured media.
  const slideType = slideOpts?.slideType || await resolveDefaultSlidePostType(config);
  const slide = await createPost(config, {
    title: slideOpts?.title || image.fileName.replace(/\.[^.]+$/, ''),
    status: slideOpts?.status || 'draft',
    featured_media: media.id,
    postType: slideType,
  });

  return { media, slide };
}
