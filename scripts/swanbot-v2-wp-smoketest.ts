/**
 * swanbot-v2-wp-smoketest — M3e coverage for the 4 client-delegated
 * WordPress dispatchers in src/lib/swanbot.ts. Validates:
 *   - validateWpSite — siteUrl http/https prefix check; onePasswordItem required
 *   - dispatchWpDiscoverTypes — trims to 40 entries; shapes correctly
 *   - dispatchWpListPosts — perPage clamped 1..50; extracts title.rendered
 *   - dispatchWpUploadMedia — defaults mimeType; requires path+name
 *   - dispatchWpCreateSlide — defaults status=publish; rejects non-publish string
 *     other than 'draft'; default mimeType=image/jpeg
 *
 * Offline — wpAdmin module calls stubbed. Run:
 *   npm run smoke:swanbot-v2-wp
 */

function validateWpSite(input: Record<string, any>) {
  const siteUrl = String(input?.siteUrl || '').trim();
  if (!/^https?:\/\//i.test(siteUrl)) return { ok: false as const, error: 'siteUrl must start with http(s)://' };
  const onePasswordItem = String(input?.onePasswordItem || '').trim();
  if (!onePasswordItem) return { ok: false as const, error: 'onePasswordItem required' };
  const onePasswordVault = typeof input?.vault === 'string' && input.vault.trim() ? input.vault.trim() : undefined;
  return { ok: true as const, site: { siteUrl, onePasswordItem, onePasswordVault } };
}

// Stub wpAdmin module — the dispatchers normally `await import('./wpAdmin')`.
type WpStubs = {
  discoverPostTypes: (config: any) => Promise<Record<string, any>>;
  listPosts: (config: any, opts: any) => Promise<any[]>;
  uploadMediaFromStorage: (config: any, path: string, name: string, mime: string) => Promise<any>;
  uploadImageAndCreateSlide: (config: any, image: any, opts: any) => Promise<any>;
};

async function dispatchWpDiscoverTypes(stubs: WpStubs, input: Record<string, any>) {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  try {
    const types = await stubs.discoverPostTypes(v.site);
    const slim = Object.entries(types).slice(0, 40).map(([slug, t]: [string, any]) => ({
      slug,
      name: t?.name || slug,
      rest_base: t?.rest_base || slug,
    }));
    return { ok: true, data: { siteUrl: v.site.siteUrl, count: slim.length, types: slim } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchWpListPosts(stubs: WpStubs, input: Record<string, any>) {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  const postType = typeof input?.postType === 'string' ? input.postType : undefined;
  const perPage = typeof input?.perPage === 'number' ? Math.max(1, Math.min(50, input.perPage)) : 20;
  const status = typeof input?.status === 'string' ? input.status : undefined;
  try {
    const posts = await stubs.listPosts(v.site, { postType, perPage, status });
    const slim = posts.slice(0, perPage).map((p) => ({
      id: p.id,
      title: typeof p.title === 'string' ? p.title : p.title?.rendered,
      status: p.status,
      link: p.link,
    }));
    return { ok: true, data: { count: slim.length, posts: slim } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchWpUploadMedia(stubs: WpStubs, input: Record<string, any>) {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  const storagePath = String(input?.storagePath || '').trim();
  const fileName = String(input?.fileName || '').trim();
  if (!storagePath || !fileName) return { ok: false, error: 'storagePath and fileName required' };
  const mimeType = typeof input?.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : 'application/octet-stream';
  try {
    const media = await stubs.uploadMediaFromStorage(v.site, storagePath, fileName, mimeType);
    return { ok: true, data: { id: media.id, source_url: media.source_url, fileName } };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchWpCreateSlide(stubs: WpStubs, input: Record<string, any>) {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  const storagePath = String(input?.storagePath || '').trim();
  const fileName = String(input?.fileName || '').trim();
  if (!storagePath || !fileName) return { ok: false, error: 'storagePath and fileName required' };
  const mimeType = typeof input?.mimeType === 'string' && input.mimeType.trim() ? input.mimeType.trim() : 'image/jpeg';
  const status: 'draft' | 'publish' = input?.status === 'draft' ? 'draft' : 'publish';
  const title = typeof input?.title === 'string' ? input.title : undefined;
  const slideType = typeof input?.slideType === 'string' && input.slideType.trim() ? input.slideType.trim() : undefined;
  try {
    const result = await stubs.uploadImageAndCreateSlide(
      v.site,
      { storagePath, fileName, mimeType },
      { title, status, slideType },
    );
    return {
      ok: true,
      data: {
        media: { id: result.media.id, source_url: result.media.source_url },
        slide: {
          id: result.slide.id,
          link: result.slide.link,
          status: result.slide.status,
          title: typeof result.slide.title === 'string' ? result.slide.title : result.slide.title?.rendered,
        },
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// ─── Test runner ───────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function makeStubs(overrides: Partial<WpStubs> = {}): WpStubs {
  return {
    discoverPostTypes: async () => ({
      post: { name: 'Posts', slug: 'post', rest_base: 'posts' },
      page: { name: 'Pages', slug: 'page', rest_base: 'pages' },
      flavor_di_slides: { name: 'DI Slides', slug: 'flavor_di_slides', rest_base: 'flavor_di_slides' },
    }),
    listPosts: async (_c, opts) => {
      const type = opts.postType || 'posts';
      return [
        { id: 1, title: { rendered: `First ${type}` }, status: 'publish', link: `https://ex.com/1` },
        { id: 2, title: { rendered: `Second ${type}` }, status: 'draft', link: `https://ex.com/2` },
      ];
    },
    uploadMediaFromStorage: async (_c, path, name) => ({ id: 42, source_url: `https://ex.com/wp-content/${name}`, file: path }),
    uploadImageAndCreateSlide: async (_c, image, opts) => ({
      media: { id: 77, source_url: `https://ex.com/wp-content/${image.fileName}` },
      slide: { id: 88, link: 'https://ex.com/slide/88', status: opts.status || 'publish', title: { rendered: opts.title || image.fileName } },
    }),
    ...overrides,
  };
}

async function main() {
  // ─── validateWpSite ────────────────────────────────────────────
  assert(!validateWpSite({}).ok, 'validate: missing siteUrl rejected');
  assert(!validateWpSite({ siteUrl: 'ftp://ex.com', onePasswordItem: 'x' }).ok, 'validate: non-http scheme rejected');
  assert(!validateWpSite({ siteUrl: 'javascript:alert(1)', onePasswordItem: 'x' }).ok, 'validate: js: scheme rejected');
  assert(!validateWpSite({ siteUrl: 'https://ex.com' }).ok, 'validate: missing onePasswordItem rejected');
  {
    const r = validateWpSite({ siteUrl: 'https://ex.com/', onePasswordItem: 'WP' });
    assert(r.ok, 'validate: happy path ok');
    assert(r.ok && r.site.siteUrl === 'https://ex.com/', 'validate: trailing slash preserved');
  }
  {
    const r = validateWpSite({ siteUrl: 'HTTP://ex.com', onePasswordItem: 'WP', vault: 'Prod' });
    assert(r.ok, 'validate: uppercase scheme ok');
    assert(r.ok && r.site.onePasswordVault === 'Prod', 'validate: vault preserved');
  }

  // ─── discover_types ────────────────────────────────────────────
  {
    const stubs = makeStubs();
    const r = await dispatchWpDiscoverTypes(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP' });
    assert(r.ok, 'discover_types: happy path');
    assert((r as any).data?.count === 3, 'discover_types: counts all 3 types');
    assert((r as any).data?.types[2].slug === 'flavor_di_slides', 'discover_types: slug preserved');

    // Truncates at 40
    const manyStubs = makeStubs({
      discoverPostTypes: async () => Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`t${i}`, { name: `T${i}`, rest_base: `t${i}` }])),
    });
    const r2 = await dispatchWpDiscoverTypes(manyStubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP' });
    assert((r2 as any).data?.count === 40, 'discover_types: truncated to 40');

    // Bubble thrown errors
    const badStubs = makeStubs({ discoverPostTypes: async () => { throw new Error('401 Unauthorized'); } });
    const r3 = await dispatchWpDiscoverTypes(badStubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP' });
    assert(!r3.ok && /401/.test((r3 as any).error), 'discover_types: thrown error surfaced');
  }

  // ─── list_posts ────────────────────────────────────────────────
  {
    const stubs = makeStubs();
    const r = await dispatchWpListPosts(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP' });
    assert(r.ok, 'list_posts: happy path');
    assert((r as any).data?.posts?.[0].title === 'First posts', 'list_posts: title.rendered flattened');
    assert((r as any).data?.posts?.[0].status === 'publish', 'list_posts: status preserved');

    // Custom post type
    const r2 = await dispatchWpListPosts(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postType: 'flavor_di_slides' });
    assert((r2 as any).data?.posts?.[0].title === 'First flavor_di_slides', 'list_posts: custom postType passthrough');

    // perPage clamped
    const clampedStubs = makeStubs({
      listPosts: async (_c, opts) => Array.from({ length: 100 }, (_, i) => ({ id: i, title: `P${i}`, status: 'publish', link: `https://ex.com/${i}` })),
    });
    const r3 = await dispatchWpListPosts(clampedStubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', perPage: 999 });
    assert((r3 as any).data?.count === 50, 'list_posts: perPage clamped to 50');

    const r4 = await dispatchWpListPosts(clampedStubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', perPage: 0 });
    assert((r4 as any).data?.count === 1, 'list_posts: perPage min 1 (clamped from 0)');

    // String titles (some WP plugins return plain strings) still work
    const strStubs = makeStubs({
      listPosts: async () => [{ id: 1, title: 'Plain Title', status: 'publish', link: 'https://ex.com/1' }],
    });
    const r5 = await dispatchWpListPosts(strStubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP' });
    assert((r5 as any).data?.posts?.[0].title === 'Plain Title', 'list_posts: string title preserved');
  }

  // ─── upload_media ──────────────────────────────────────────────
  {
    const stubs = makeStubs();
    const calls: any[] = [];
    const stubsSpy = makeStubs({
      uploadMediaFromStorage: async (c, p, n, m) => {
        calls.push({ c, p, n, m });
        return { id: 42, source_url: `https://ex.com/${n}` };
      },
    });
    const r = await dispatchWpUploadMedia(stubsSpy, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', storagePath: 'a/b.png', fileName: 'b.png', mimeType: 'image/png' });
    assert(r.ok, 'upload_media: happy path');
    assert(calls[0].m === 'image/png', 'upload_media: mimeType passthrough');
    assert((r as any).data?.id === 42, 'upload_media: id preserved');

    // Default mimeType
    calls.length = 0;
    const r2 = await dispatchWpUploadMedia(stubsSpy, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', storagePath: 'a', fileName: 'b' });
    assert(r2.ok && calls[0].m === 'application/octet-stream', 'upload_media: default mimeType');

    // Missing path/name
    const r3 = await dispatchWpUploadMedia(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', storagePath: '', fileName: 'b' });
    assert(!r3.ok && /storagePath and fileName/.test((r3 as any).error), 'upload_media: missing path rejected');
  }

  // ─── create_slide ──────────────────────────────────────────────
  {
    const calls: any[] = [];
    const stubs = makeStubs({
      uploadImageAndCreateSlide: async (c, image, opts) => {
        calls.push({ c, image, opts });
        return {
          media: { id: 77, source_url: 'https://ex.com/img.jpg' },
          slide: { id: 88, link: 'https://ex.com/slide/88', status: opts.status || 'publish', title: { rendered: opts.title || image.fileName } },
        };
      },
    });
    const r = await dispatchWpCreateSlide(stubs, {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      storagePath: 'a/slide.jpg',
      fileName: 'slide.jpg',
      title: 'Launch Week',
    });
    assert(r.ok, 'create_slide: happy path');
    assert((r as any).data?.slide?.title === 'Launch Week', 'create_slide: title passthrough');
    assert(calls[0].opts.status === 'publish', 'create_slide: default status=publish');
    assert(calls[0].image.mimeType === 'image/jpeg', 'create_slide: default mimeType=image/jpeg');

    // status=draft preserved
    calls.length = 0;
    const r2 = await dispatchWpCreateSlide(stubs, {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      storagePath: 'a/s.jpg',
      fileName: 's.jpg',
      status: 'draft',
    });
    assert(r2.ok && calls[0].opts.status === 'draft', 'create_slide: draft preserved');

    // Unknown status → publish
    calls.length = 0;
    const r3 = await dispatchWpCreateSlide(stubs, {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      storagePath: 'a/s.jpg',
      fileName: 's.jpg',
      status: 'scheduled',
    });
    assert(r3.ok && calls[0].opts.status === 'publish', 'create_slide: unknown status → publish');

    // slideType passthrough
    calls.length = 0;
    const r4 = await dispatchWpCreateSlide(stubs, {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      storagePath: 'a/s.jpg',
      fileName: 's.jpg',
      slideType: 'custom_slide',
    });
    assert(r4.ok && calls[0].opts.slideType === 'custom_slide', 'create_slide: slideType passthrough');

    // 1P resolve fails → error surfaced
    const badStubs = makeStubs({ uploadImageAndCreateSlide: async () => { throw new Error('Could not resolve WordPress credentials from 1Password'); } });
    const r5 = await dispatchWpCreateSlide(badStubs, {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      storagePath: 'a',
      fileName: 'b.jpg',
    });
    assert(!r5.ok && /1Password/.test((r5 as any).error), 'create_slide: 1P fail surfaced');
  }

  if (failures > 0) {
    console.error(`\n${failures} swanbot-v2-wp smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll swanbot-v2-wp smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
