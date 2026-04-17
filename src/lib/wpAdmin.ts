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

// ── Media Upload ────────────────────────────────────────────────────────────

export async function uploadMedia(
  config: WpSiteConfig,
  file: { name: string; blob: Blob; mimeType: string },
): Promise<WpMediaResult> {
  const auth = await resolveAuth(config);
  if (!auth) throw new Error('Could not resolve WordPress credentials from 1Password');

  const formData = new FormData();
  formData.append('file', file.blob, file.name);
  formData.append('title', file.name.replace(/\.[^.]+$/, ''));

  const res = await fetch(apiUrl(config, '/media'), {
    method: 'POST',
    headers: { Authorization: auth.Authorization },
    body: formData,
    signal: AbortSignal.timeout(60000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`WP media upload failed: ${errText.slice(0, 300)}`);
  }
  return await res.json();
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

  const endpoint = opts.postType && opts.postType !== 'posts'
    ? `/${opts.postType}`
    : '/posts';

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
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(`WP create ${opts.postType || 'post'} failed: ${errText.slice(0, 300)}`);
  }
  return await res.json();
}

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * List available post types on the site — useful for discovering if
 * DI Slides or other plugins register custom REST endpoints.
 */
export async function discoverPostTypes(config: WpSiteConfig): Promise<Record<string, { name: string; slug: string; rest_base: string }>> {
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

  const endpoint = opts.postType && opts.postType !== 'posts'
    ? `/${opts.postType}`
    : '/posts';
  const params = new URLSearchParams();
  params.set('per_page', String(opts.perPage || 20));
  if (opts.status) params.set('status', opts.status);

  const res = await fetch(`${apiUrl(config, endpoint)}?${params}`, {
    headers: { ...auth, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`WP list ${opts.postType} failed: ${res.status}`);
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

  // 2. Create the slide with the uploaded image as featured media
  const slide = await createPost(config, {
    title: slideOpts?.title || image.fileName.replace(/\.[^.]+$/, ''),
    status: slideOpts?.status || 'publish',
    featured_media: media.id,
    postType: slideOpts?.slideType || 'flavor_di_slides', // DI Slides CPT — verify via discoverPostTypes
  });

  return { media, slide };
}
