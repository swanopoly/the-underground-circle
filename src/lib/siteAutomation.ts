import { supabase } from './supabase';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SiteCredential {
  id: string;
  platform: string;
  siteUrl: string | null;
  username: string | null;
  label: string;
  isActive: boolean;
  metadata: Record<string, unknown>;
}

export type WordPressPostStatus = 'publish' | 'draft' | 'pending' | 'future' | 'private';

export interface WordPressPostRequest {
  siteUrl: string;
  username: string;
  appPassword: string;
  title: string;
  content: string;
  status: WordPressPostStatus;
  featuredImageUrl?: string;
  categories?: number[];
  tags?: number[];
  excerpt?: string;
  slug?: string;
  date?: string;  // ISO 8601 — for scheduled posts, set future date + status: 'future'
  meta?: Record<string, string>;  // SEO meta: _yoast_wpseo_title, rank_math_title, etc.
}

export interface WordPressPost {
  id: number;
  title: string;
  slug: string;
  status: string;
  date: string;
  modified: string;
  link: string;
  excerpt: string;
  categories: number[];
  tags: number[];
  featured_media: number;
}

export interface WordPressSiteInfo {
  name: string;
  description: string;
  url: string;
  gmt_offset: number;
  timezone_string: string;
}

export interface WordPressPage {
  id: number;
  title: string;
  slug: string;
  status: string;
  date: string;
  modified: string;
  link: string;
  parent: number;
}

export interface WordPressPostResult {
  success: boolean;
  postId?: number;
  postUrl?: string;
  error?: string;
}

export interface WordPressConnectionResult {
  connected: boolean;
  siteName?: string;
  error?: string;
}

export interface WordPressCategory {
  id: number;
  name: string;
  slug: string;
  count: number;
}

export interface WordPressTag {
  id: number;
  name: string;
  slug: string;
  count: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Simple Base64 encoding for client-side credential obfuscation.
 *  NOT real encryption — real encryption should happen server-side
 *  when an edge function is added. This prevents plaintext storage. */
function encodeCredential(credential: string): string {
  try {
    return btoa(unescape(encodeURIComponent(credential)));
  } catch {
    return btoa(credential);
  }
}

function decodeCredential(encoded: string): string {
  try {
    return decodeURIComponent(escape(atob(encoded)));
  } catch {
    return atob(encoded);
  }
}

/** Build Basic Auth header for WordPress REST API */
function wpAuthHeader(username: string, appPassword: string): string {
  return 'Basic ' + btoa(`${username}:${appPassword}`);
}

/** Normalize site URL — ensure trailing slash, strip trailing /wp-json etc. */
function normalizeSiteUrl(url: string): string {
  let normalized = url.trim();
  // Remove trailing paths that shouldn't be there
  normalized = normalized.replace(/\/wp-json\/?.*$/, '');
  normalized = normalized.replace(/\/wp-admin\/?.*$/, '');
  // Ensure https if no protocol
  if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
    normalized = 'https://' + normalized;
  }
  // Remove trailing slash for consistency
  normalized = normalized.replace(/\/+$/, '');
  return normalized;
}

// ─── 1. Store Credential ────────────────────────────────────────────────────

export async function storeSiteCredential(
  platform: string,
  siteUrl: string | null,
  username: string | null,
  credential: string,
  label: string = 'default',
  metadata: Record<string, unknown> = {},
): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser().catch(() => ({
      data: null as any,
      error: { message: 'Auth error' },
    }));
    if (userError || !userData?.user) {
      return { success: false, error: 'Not authenticated' };
    }

    const encrypted = encodeCredential(credential);

    const { error } = await supabase.from('user_site_credentials').upsert(
      {
        user_id: userData.user.id,
        platform,
        site_url: siteUrl,
        username,
        credential_encrypted: encrypted,
        label,
        metadata,
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,platform,label' },
    );

    if (error) {
      console.error('[SiteAutomation] Store credential error:', error);
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    console.error('[SiteAutomation] Store credential exception:', err);
    return { success: false, error: err.message || 'Unknown error' };
  }
}

// ─── 2. Load Credentials ───────────────────────────────────────────────────

export async function loadSiteCredentials(
  platform?: string,
): Promise<SiteCredential[]> {
  try {
    let query = supabase
      .from('user_site_credentials')
      .select('id, platform, site_url, username, label, is_active, metadata')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (platform) {
      query = query.eq('platform', platform);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[SiteAutomation] Load credentials error:', error);
      return [];
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      platform: row.platform,
      siteUrl: row.site_url,
      username: row.username,
      label: row.label,
      isActive: row.is_active,
      metadata: row.metadata || {},
    }));
  } catch (err) {
    console.error('[SiteAutomation] Load credentials exception:', err);
    return [];
  }
}

// ─── 3. Delete Credential ──────────────────────────────────────────────────

export async function deleteSiteCredential(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabase
      .from('user_site_credentials')
      .delete()
      .eq('id', id);

    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || 'Unknown error' };
  }
}

// ─── 4. Test WordPress Connection ──────────────────────────────────────────

export async function testWordPressConnection(
  siteUrl: string,
  username: string,
  appPassword: string,
): Promise<WordPressConnectionResult> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const url = `${base}/wp-json/wp/v2/users/me`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: wpAuthHeader(username, appPassword),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      if (response.status === 401) {
        return { connected: false, error: 'Invalid username or application password' };
      }
      if (response.status === 403) {
        return { connected: false, error: 'Access forbidden \u2014 check user permissions' };
      }
      if (response.status === 404) {
        return { connected: false, error: 'WordPress REST API not found at this URL' };
      }
      return { connected: false, error: `HTTP ${response.status}: ${errorText.slice(0, 200)}` };
    }

    const data = await response.json();
    // The /users/me endpoint returns the authenticated user
    // We can get the site name from a separate call
    let siteName = data.name || username;

    // Try to get site name from /wp-json root
    try {
      const rootRes = await fetch(`${base}/wp-json`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      if (rootRes.ok) {
        const rootData = await rootRes.json();
        if (rootData.name) siteName = rootData.name;
      }
    } catch {
      // Non-critical, ignore
    }

    return { connected: true, siteName };
  } catch (err: any) {
    // Network errors, CORS issues, etc.
    if (err.message?.includes('NetworkError') || err.message?.includes('Failed to fetch')) {
      return {
        connected: false,
        error: 'Network error \u2014 the site may block cross-origin requests. A proxy may be required.',
      };
    }
    return { connected: false, error: err.message || 'Connection failed' };
  }
}

// ─── 5. Publish to WordPress ───────────────────────────────────────────────

export async function publishToWordPress(
  request: WordPressPostRequest,
): Promise<WordPressPostResult> {
  try {
    const base = normalizeSiteUrl(request.siteUrl);
    const auth = wpAuthHeader(request.username, request.appPassword);
    let featuredMediaId: number | undefined;

    // Step 1: Upload featured image if provided
    if (request.featuredImageUrl) {
      try {
        // Fetch the image
        const imgResponse = await fetch(request.featuredImageUrl);
        if (!imgResponse.ok) {
          console.warn('[WordPress] Failed to fetch featured image, continuing without it');
        } else {
          const imgBlob = await imgResponse.blob();
          // Determine filename from URL
          const urlParts = request.featuredImageUrl.split('/');
          const fileName = urlParts[urlParts.length - 1]?.split('?')[0] || 'featured-image.jpg';

          const formData = new FormData();
          formData.append('file', imgBlob, fileName);

          const mediaRes = await fetch(`${base}/wp-json/wp/v2/media`, {
            method: 'POST',
            headers: {
              Authorization: auth,
            },
            body: formData,
          });

          if (mediaRes.ok) {
            const mediaData = await mediaRes.json();
            featuredMediaId = mediaData.id;
          } else {
            console.warn('[WordPress] Failed to upload featured image:', await mediaRes.text().catch(() => ''));
          }
        }
      } catch (imgErr) {
        console.warn('[WordPress] Image upload error, continuing without image:', imgErr);
      }
    }

    // Step 2: Create the post
    const postBody: Record<string, unknown> = {
      title: request.title,
      content: request.content,
      status: request.status,
    };

    if (featuredMediaId) {
      postBody.featured_media = featuredMediaId;
    }
    if (request.categories && request.categories.length > 0) {
      postBody.categories = request.categories;
    }
    if (request.tags && request.tags.length > 0) {
      postBody.tags = request.tags;
    }

    const postRes = await fetch(`${base}/wp-json/wp/v2/posts`, {
      method: 'POST',
      headers: {
        Authorization: auth,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(postBody),
    });

    if (!postRes.ok) {
      const errorText = await postRes.text().catch(() => '');
      return {
        success: false,
        error: `Failed to create post: HTTP ${postRes.status} \u2014 ${errorText.slice(0, 300)}`,
      };
    }

    const postData = await postRes.json();

    return {
      success: true,
      postId: postData.id,
      postUrl: postData.link || postData.guid?.rendered,
    };
  } catch (err: any) {
    console.error('[WordPress] Publish error:', err);
    if (err.message?.includes('NetworkError') || err.message?.includes('Failed to fetch')) {
      return {
        success: false,
        error: 'Network error \u2014 CORS may be blocking the request. Consider using a proxy.',
      };
    }
    return { success: false, error: err.message || 'Publishing failed' };
  }
}

// ─── 6. Fetch WordPress Categories ─────────────────────────────────────────

export async function fetchWordPressCategories(
  siteUrl: string,
  username: string,
  appPassword: string,
): Promise<WordPressCategory[]> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const response = await fetch(`${base}/wp-json/wp/v2/categories?per_page=100`, {
      method: 'GET',
      headers: {
        Authorization: wpAuthHeader(username, appPassword),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data || []).map((cat: any) => ({
      id: cat.id,
      name: cat.name,
      slug: cat.slug,
      count: cat.count || 0,
    }));
  } catch (err) {
    console.error('[WordPress] Fetch categories error:', err);
    return [];
  }
}

// ─── 7. Fetch WordPress Tags ───────────────────────────────────────────────

export async function fetchWordPressTags(
  siteUrl: string,
  username: string,
  appPassword: string,
): Promise<WordPressTag[]> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const response = await fetch(`${base}/wp-json/wp/v2/tags?per_page=100`, {
      method: 'GET',
      headers: {
        Authorization: wpAuthHeader(username, appPassword),
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data || []).map((tag: any) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      count: tag.count || 0,
    }));
  } catch (err) {
    console.error('[WordPress] Fetch tags error:', err);
    return [];
  }
}

// ─── Utility: Decode stored credential (for use in automation) ──────────────

export async function getDecryptedCredential(
  credentialId: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('user_site_credentials')
      .select('credential_encrypted')
      .eq('id', credentialId)
      .single();

    if (error || !data) return null;
    return decodeCredential(data.credential_encrypted);
  } catch {
    return null;
  }
}

// ─── 8. Get Site Info ─────────────────────────────────────────────────────────

export async function getWordPressSiteInfo(
  siteUrl: string,
): Promise<WordPressSiteInfo | null> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    if (!res.ok) return null;
    const d = await res.json();
    return { name: d.name || '', description: d.description || '', url: d.url || base, gmt_offset: d.gmt_offset || 0, timezone_string: d.timezone_string || '' };
  } catch { return null; }
}

// ─── 9. List Posts ────────────────────────────────────────────────────────────

export async function listWordPressPosts(
  siteUrl: string, username: string, appPassword: string,
  opts: { status?: string; search?: string; perPage?: number; page?: number; orderby?: string } = {},
): Promise<{ posts: WordPressPost[]; total: number }> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const params = new URLSearchParams();
    params.set('per_page', String(opts.perPage || 20));
    params.set('page', String(opts.page || 1));
    params.set('orderby', opts.orderby || 'date');
    params.set('order', 'desc');
    if (opts.status) params.set('status', opts.status);
    if (opts.search) params.set('search', opts.search);

    const res = await fetch(`${base}/wp-json/wp/v2/posts?${params}`, {
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
    });
    if (!res.ok) return { posts: [], total: 0 };
    const total = parseInt(res.headers.get('X-WP-Total') || '0', 10);
    const data = await res.json();
    return {
      total,
      posts: (data || []).map((p: any) => ({
        id: p.id, title: p.title?.rendered || '', slug: p.slug, status: p.status,
        date: p.date, modified: p.modified, link: p.link,
        excerpt: (p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim(),
        categories: p.categories || [], tags: p.tags || [], featured_media: p.featured_media || 0,
      })),
    };
  } catch { return { posts: [], total: 0 }; }
}

// ─── 10. Get Single Post ──────────────────────────────────────────────────────

export async function getWordPressPost(
  siteUrl: string, username: string, appPassword: string, postId: number,
): Promise<WordPressPost | null> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/posts/${postId}`, {
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const p = await res.json();
    return {
      id: p.id, title: p.title?.rendered || '', slug: p.slug, status: p.status,
      date: p.date, modified: p.modified, link: p.link,
      excerpt: (p.excerpt?.rendered || '').replace(/<[^>]+>/g, '').trim(),
      categories: p.categories || [], tags: p.tags || [], featured_media: p.featured_media || 0,
    };
  } catch { return null; }
}

// ─── 11. Update Post ──────────────────────────────────────────────────────────

export async function updateWordPressPost(
  siteUrl: string, username: string, appPassword: string,
  postId: number, updates: Partial<{ title: string; content: string; status: WordPressPostStatus; excerpt: string; categories: number[]; tags: number[]; meta: Record<string, string> }>,
): Promise<WordPressPostResult> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/posts/${postId}`, {
      method: 'POST', // WP REST API uses POST for updates
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, error: `HTTP ${res.status}: ${err.slice(0, 200)}` };
    }
    const d = await res.json();
    return { success: true, postId: d.id, postUrl: d.link };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ─── 12. Delete Post ──────────────────────────────────────────────────────────

export async function deleteWordPressPost(
  siteUrl: string, username: string, appPassword: string,
  postId: number, force: boolean = false,
): Promise<{ success: boolean; error?: string }> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const url = `${base}/wp-json/wp/v2/posts/${postId}${force ? '?force=true' : ''}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, error: `HTTP ${res.status}: ${err.slice(0, 200)}` };
    }
    return { success: true };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ─── 13. List Pages ───────────────────────────────────────────────────────────

export async function listWordPressPages(
  siteUrl: string, username: string, appPassword: string,
  opts: { status?: string; perPage?: number } = {},
): Promise<WordPressPage[]> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const params = new URLSearchParams();
    params.set('per_page', String(opts.perPage || 50));
    if (opts.status) params.set('status', opts.status);

    const res = await fetch(`${base}/wp-json/wp/v2/pages?${params}`, {
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data || []).map((p: any) => ({
      id: p.id, title: p.title?.rendered || '', slug: p.slug, status: p.status,
      date: p.date, modified: p.modified, link: p.link, parent: p.parent || 0,
    }));
  } catch { return []; }
}

// ─── 14. Create/Update Page ───────────────────────────────────────────────────

export async function publishWordPressPage(
  siteUrl: string, username: string, appPassword: string,
  page: { title: string; content: string; status: WordPressPostStatus; slug?: string; parent?: number },
): Promise<WordPressPostResult> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/pages`, {
      method: 'POST',
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
      body: JSON.stringify(page),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, error: `HTTP ${res.status}: ${err.slice(0, 200)}` };
    }
    const d = await res.json();
    return { success: true, postId: d.id, postUrl: d.link };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ─── 15. Upload Media ─────────────────────────────────────────────────────────

export async function uploadWordPressMedia(
  siteUrl: string, username: string, appPassword: string,
  file: Blob, fileName: string, altText?: string,
): Promise<{ success: boolean; mediaId?: number; url?: string; error?: string }> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const formData = new FormData();
    formData.append('file', file, fileName);
    if (altText) formData.append('alt_text', altText);

    const res = await fetch(`${base}/wp-json/wp/v2/media`, {
      method: 'POST',
      headers: { Authorization: wpAuthHeader(username, appPassword) },
      body: formData,
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      return { success: false, error: `HTTP ${res.status}: ${err.slice(0, 200)}` };
    }
    const d = await res.json();
    return { success: true, mediaId: d.id, url: d.source_url };
  } catch (e: any) { return { success: false, error: e.message }; }
}

// ─── 16. Create Category/Tag ──────────────────────────────────────────────────

export async function createWordPressCategory(
  siteUrl: string, username: string, appPassword: string, name: string,
): Promise<{ id: number } | null> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/categories`, {
      method: 'POST',
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { id: d.id };
  } catch { return null; }
}

export async function createWordPressTag(
  siteUrl: string, username: string, appPassword: string, name: string,
): Promise<{ id: number } | null> {
  try {
    const base = normalizeSiteUrl(siteUrl);
    const res = await fetch(`${base}/wp-json/wp/v2/tags`, {
      method: 'POST',
      headers: { Authorization: wpAuthHeader(username, appPassword), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const d = await res.json();
    return { id: d.id };
  } catch { return null; }
}

// ─── 17. Gutenberg Block Builder ──────────────────────────────────────────────

export const wpBlock = {
  paragraph: (text: string) =>
    `<!-- wp:paragraph -->\n<p>${text}</p>\n<!-- /wp:paragraph -->`,
  heading: (text: string, level: 2 | 3 | 4 = 2) =>
    `<!-- wp:heading {"level":${level}} -->\n<h${level}>${text}</h${level}>\n<!-- /wp:heading -->`,
  image: (url: string, alt: string = '', id?: number) =>
    `<!-- wp:image ${id ? `{"id":${id}}` : '{}'} -->\n<figure class="wp-block-image"><img src="${url}" alt="${alt}"${id ? ` class="wp-image-${id}"` : ''}/></figure>\n<!-- /wp:image -->`,
  list: (items: string[], ordered: boolean = false) => {
    const tag = ordered ? 'ol' : 'ul';
    const inner = items.map(i => `<li>${i}</li>`).join('\n');
    return `<!-- wp:list ${ordered ? '{"ordered":true}' : '{}'} -->\n<${tag}>\n${inner}\n</${tag}>\n<!-- /wp:list -->`;
  },
  quote: (text: string, citation?: string) =>
    `<!-- wp:quote -->\n<blockquote class="wp-block-quote"><p>${text}</p>${citation ? `<cite>${citation}</cite>` : ''}</blockquote>\n<!-- /wp:quote -->`,
  code: (code: string) =>
    `<!-- wp:code -->\n<pre class="wp-block-code"><code>${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</code></pre>\n<!-- /wp:code -->`,
  separator: () =>
    `<!-- wp:separator -->\n<hr class="wp-block-separator has-alpha-channel-opacity"/>\n<!-- /wp:separator -->`,
  spacer: (height: number = 20) =>
    `<!-- wp:spacer {"height":"${height}px"} -->\n<div style="height:${height}px" aria-hidden="true" class="wp-block-spacer"></div>\n<!-- /wp:spacer -->`,
  html: (raw: string) =>
    `<!-- wp:html -->\n${raw}\n<!-- /wp:html -->`,
};

// ─── 18. Auto-load WordPress credentials for agent use ────────────────────────

export async function getActiveWordPressCredentials(): Promise<{
  siteUrl: string; username: string; appPassword: string;
} | null> {
  try {
    const { data: userData } = await supabase.auth.getUser().catch(() => ({ data: null as any }));
    if (!userData?.user) return null;

    const { data, error } = await supabase
      .from('user_site_credentials')
      .select('site_url, username, credential_encrypted')
      .eq('user_id', userData.user.id)
      .eq('platform', 'wordpress')
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !data) return null;
    return {
      siteUrl: data.site_url,
      username: data.username,
      appPassword: decodeCredential(data.credential_encrypted),
    };
  } catch { return null; }
}
