/**
 * swanbot-v2-wp-smoketest — M3e coverage for the WordPress client-delegated
 * WordPress dispatchers in src/lib/swanbot.ts. Validates:
 *   - validateWpSite — siteUrl http/https prefix check; onePasswordItem required
 *   - dispatchWpDiscoverTypes — trims to 40 entries; shapes correctly
 *   - dispatchWpListPosts — perPage clamped 1..50; extracts title.rendered
 *   - dispatchWpUploadMedia — defaults mimeType; requires path+name
 *   - dispatchWpCreateSlide — defaults status=draft; requires explicit publish
 *     status for live slides; default mimeType=image/jpeg
 *   - dispatchWpUpdatePost — requires postId and at least one bounded field
 *   - dispatchWpTrashPost — restorable trash only; rejects force/permanent delete
 *
 * Offline — wpAdmin module calls stubbed. Run:
 *   npm run smoke:swanbot-v2-wp
 */

import { readFileSync } from 'node:fs';

import {
  buildOpenSwanToolApprovalKey,
  resolveOpenSwanRuntimeApprovalDecision,
} from '../src/lib/openswanToolApprovals';

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
  updatePost: (config: any, opts: any) => Promise<any>;
  trashPost: (config: any, opts: any) => Promise<any>;
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
  const status: 'draft' | 'publish' = input?.status === 'publish' ? 'publish' : 'draft';
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

const ALLOWED_WP_UPDATE_STATUSES = new Set(['draft', 'publish', 'private', 'pending', 'future']);
const WP_UPDATE_META_MAX_KEYS = 30;
const WP_UPDATE_META_KEY_MAX_CHARS = 80;
const WP_UPDATE_META_STRING_MAX_CHARS = 2_000;
const WP_UPDATE_META_MAX_JSON_CHARS = 8_000;

function normalizeWpUpdateMeta(meta: unknown): { ok: true; meta?: Record<string, string | number | boolean | null> } | { ok: false; error: string } {
  if (meta === undefined || meta === null) return { ok: true };
  if (typeof meta !== 'object' || Array.isArray(meta)) return { ok: false, error: 'meta must be an object with scalar values' };
  const entries = Object.entries(meta as Record<string, unknown>);
  if (entries.length > WP_UPDATE_META_MAX_KEYS) return { ok: false, error: `meta may include at most ${WP_UPDATE_META_MAX_KEYS} keys` };
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
  if (JSON.stringify(out).length > WP_UPDATE_META_MAX_JSON_CHARS) return { ok: false, error: 'meta payload is too large' };
  return { ok: true, meta: out };
}

async function dispatchWpUpdatePost(stubs: WpStubs, input: Record<string, any>) {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  const postId = Number(input?.postId);
  if (!Number.isFinite(postId) || postId <= 0) return { ok: false, error: 'postId must be a positive number' };
  const postType = typeof input?.postType === 'string' && input.postType.trim() ? input.postType.trim() : undefined;
  if (postType && !isAllowedWpPostType(postType)) {
    return { ok: false, error: 'postType may only contain letters, numbers, underscores, and hyphens' };
  }
  const hasStatus = Object.prototype.hasOwnProperty.call(input, 'status');
  if (hasStatus && (typeof input.status !== 'string' || !ALLOWED_WP_UPDATE_STATUSES.has(input.status))) {
    return { ok: false, error: 'status must be draft, publish, private, pending, or future' };
  }
  const status = hasStatus ? input.status as 'draft' | 'publish' | 'private' | 'pending' | 'future' : undefined;
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
  const opts = {
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
    meta: metaResult.meta,
  };
  if (!Object.entries(opts).some(([key, value]) => key !== 'postId' && key !== 'postType' && value !== undefined)) {
    return { ok: false, error: 'No WordPress update fields provided' };
  }
  try {
    const post = await stubs.updatePost(v.site, opts);
    return {
      ok: true,
      data: {
        post: {
          id: post.id,
          title: typeof post.title === 'string' ? post.title : post.title?.rendered,
          status: post.status,
          link: post.link,
        },
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function isAllowedWpPostType(postType: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(postType);
}

async function dispatchWpTrashPost(stubs: WpStubs, input: Record<string, any>) {
  const v = validateWpSite(input);
  if (!v.ok) return v;
  const postId = Number(input?.postId);
  if (!Number.isFinite(postId) || postId <= 0) return { ok: false, error: 'postId must be a positive number' };
  const postType = typeof input?.postType === 'string' && input.postType.trim() ? input.postType.trim() : undefined;
  if (postType && !isAllowedWpPostType(postType)) {
    return { ok: false, error: 'postType may only contain letters, numbers, underscores, and hyphens' };
  }
  const hasForce = Object.prototype.hasOwnProperty.call(input, 'force');
  if (hasForce) return { ok: false, error: 'wp.trash_post only supports restorable trash. Permanent delete is not supported.' };
  const force = false;

  try {
    const result = await stubs.trashPost(v.site, { postId, postType, force });
    const previous = result?.previous && typeof result.previous === 'object' ? result.previous : undefined;
    const source = previous || result || {};
    const returnedId = Number(source.id);
    const title = typeof source.title === 'string' ? source.title : source.title?.rendered;
    return {
      ok: true,
      data: {
        post: {
          id: Number.isFinite(returnedId) && returnedId > 0 ? returnedId : postId,
          postType: postType || 'posts',
          action: force ? 'deleted' : 'trashed',
          force,
          deleted: result?.deleted === true,
          status: typeof source.status === 'string' ? source.status : undefined,
          link: typeof source.link === 'string' ? source.link : undefined,
          title,
        },
      },
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function dispatchWpClientTool(stubs: WpStubs, name: string, input: Record<string, any>) {
  switch (name) {
    case 'wp.discover_types':
      return dispatchWpDiscoverTypes(stubs, input);
    case 'wp.list_posts':
      return dispatchWpListPosts(stubs, input);
    case 'wp.upload_media':
      return dispatchWpUploadMedia(stubs, input);
    case 'wp.create_slide':
      return dispatchWpCreateSlide(stubs, input);
    case 'wp.update_post':
      return dispatchWpUpdatePost(stubs, input);
    case 'wp.trash_post':
      return dispatchWpTrashPost(stubs, input);
    default:
      return { ok: false, error: `Unknown client tool "${name}"` };
  }
}

type WpApprovalRow = { id?: string; status?: string; payload?: Record<string, unknown> | null };

const WP_MUTATION_TOOLS = new Set(['wp.upload_media', 'wp.create_slide', 'wp.update_post', 'wp.trash_post']);

function normalizeApprovalArgs(input: Record<string, any>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === 'approvalId' || key === 'approval_id' || key === 'toolApprovalKey' || key === 'approvalKey') continue;
    out[key] = value;
  }
  return out;
}

async function dispatchWpClientToolWithApproval(
  stubs: WpStubs,
  name: string,
  input: Record<string, any>,
  approvalRows: WpApprovalRow[] | 'lookup_error' = [],
) {
  if (!WP_MUTATION_TOOLS.has(name)) return dispatchWpClientTool(stubs, name, input);
  if (approvalRows === 'lookup_error') {
    return { ok: false, error: 'Approval check failed before running the WordPress action. I did not touch WordPress.' };
  }
  const args = normalizeApprovalArgs(input);
  const decision = resolveOpenSwanRuntimeApprovalDecision({ tool: name, args, rows: approvalRows });
  if (decision.kind === 'pass') return dispatchWpClientTool(stubs, name, input);
  if (decision.kind === 'defer') {
    return {
      ok: false,
      error: 'Approval is still pending for this WordPress action. I did not touch WordPress.',
      data: { approvalRequest: { id: decision.approvalId, status: 'pending' } },
    };
  }
  if (decision.kind === 'block') {
    return { ok: false, error: 'This WordPress action was rejected. I did not touch WordPress.' };
  }
  return {
    ok: false,
    error: 'Approval requested for this WordPress action. I did not touch WordPress yet.',
    data: { approvalRequest: { id: 'new-approval', status: 'pending' } },
  };
}

// ─── Test runner ───────────────────────────────────────────────────
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function assertSwanBotWpApprovalGateSource() {
  const source = readFileSync('src/lib/swanbot.ts', 'utf8');
  assert(source.includes('SWANBOT_CLIENT_WP_MUTATION_TOOLS'), 'approval gate: mutating wp tool set exists');
  for (const tool of ['wp.upload_media', 'wp.create_slide', 'wp.update_post', 'wp.trash_post']) {
    assert(source.includes(`'${tool}'`), `approval gate: ${tool} is classified as mutating`);
    assert(
      source.includes(`withSwanBotClientWordPressApproval(call.name, input, context, () => dispatch${tool === 'wp.upload_media' ? 'WpUploadMedia' : tool === 'wp.create_slide' ? 'WpCreateSlide' : tool === 'wp.update_post' ? 'WpUpdatePost' : 'WpTrashPost'}(input))`),
      `approval gate: ${tool} dispatch is wrapped`,
    );
  }
  assert(!/case 'wp\.discover_types':\s*return withSwanBotClientWordPressApproval/.test(source), 'approval gate: discover_types stays read-only direct');
  assert(!/case 'wp\.list_posts':\s*return withSwanBotClientWordPressApproval/.test(source), 'approval gate: list_posts stays read-only direct');
  assert(source.includes('resolveSwanBotClientToolApproval'), 'approval gate: resolver exists');
  assert(source.includes('buildOpenSwanToolApprovalKey'), 'approval gate: reuses exact OpenSwan approval key');
  assert(source.includes('resolveOpenSwanRuntimeApprovalDecision'), 'approval gate: reuses OpenSwan approval decision matcher');
  assert(source.includes(".from('agent_run_approvals')"), 'approval gate: checks run approval rows before dispatch');
  assert(source.includes('requestRunApproval'), 'approval gate: creates approval row when missing');
  assert(source.includes('I did not touch WordPress'), 'approval gate: blocked copy is customer-safe and explicit');

  const args = {
    siteUrl: 'https://example.com',
    onePasswordItem: 'Dealer WP',
    postId: 88,
    title: 'June Offer',
  };
  const key = buildOpenSwanToolApprovalKey('wp.update_post', args);
  const approved = resolveOpenSwanRuntimeApprovalDecision({
    tool: 'wp.update_post',
    args,
    rows: [{ id: 'approval_1', status: 'approved', payload: { toolApprovalKey: key } }],
  });
  assert(approved.kind === 'pass', 'approval gate: exact approved wp key passes');
  const pending = resolveOpenSwanRuntimeApprovalDecision({
    tool: 'wp.update_post',
    args,
    rows: [{ id: 'approval_2', status: 'pending', payload: { toolApprovalKey: key } }],
  });
  assert(pending.kind === 'defer', 'approval gate: exact pending wp key defers');
  const wrongArgs = resolveOpenSwanRuntimeApprovalDecision({
    tool: 'wp.update_post',
    args,
    rows: [{ id: 'approval_3', status: 'approved', payload: { toolApprovalKey: buildOpenSwanToolApprovalKey('wp.update_post', { ...args, postId: 89 }) } }],
  });
  assert(wrongArgs.kind === 'new', 'approval gate: approved wp key for different args does not pass');
}

async function assertWpClientApprovalMatrix() {
  const input = {
    siteUrl: 'https://example.com',
    onePasswordItem: 'Dealer WP',
    postId: 88,
    title: 'June Offer',
  };
  const args = normalizeApprovalArgs(input);
  const exactKey = buildOpenSwanToolApprovalKey('wp.update_post', args);
  const wrongKey = buildOpenSwanToolApprovalKey('wp.update_post', { ...args, postId: 89 });
  const makeUpdateStubs = () => {
    const calls: any[] = [];
    const stubs = makeStubs({
      updatePost: async (_c, opts) => {
        calls.push(opts);
        return { id: opts.postId, status: opts.status || 'draft', link: 'https://example.com/88', title: { rendered: opts.title || 'Untitled' } };
      },
    });
    return { stubs, calls };
  };

  {
    const { stubs, calls } = makeUpdateStubs();
    const r = await dispatchWpClientToolWithApproval(stubs, 'wp.update_post', input, []);
    assert(!r.ok && /Approval requested/.test((r as any).error) && calls.length === 0, 'approval matrix: missing row requests approval and blocks wp update');
  }
  {
    const { stubs, calls } = makeUpdateStubs();
    const r = await dispatchWpClientToolWithApproval(stubs, 'wp.update_post', input, [
      { id: 'pending_1', status: 'pending', payload: { toolApprovalKey: exactKey } },
    ]);
    assert(!r.ok && /pending/.test((r as any).error) && calls.length === 0, 'approval matrix: pending exact row blocks wp update');
  }
  {
    const { stubs, calls } = makeUpdateStubs();
    const r = await dispatchWpClientToolWithApproval(stubs, 'wp.update_post', input, [
      { id: 'rejected_1', status: 'rejected', payload: { toolApprovalKey: exactKey } },
    ]);
    assert(!r.ok && /rejected/.test((r as any).error) && calls.length === 0, 'approval matrix: rejected exact row blocks wp update');
  }
  {
    const { stubs, calls } = makeUpdateStubs();
    const r = await dispatchWpClientToolWithApproval(stubs, 'wp.update_post', input, [
      { id: 'expired_1', status: 'expired', payload: { toolApprovalKey: exactKey } },
    ]);
    assert(!r.ok && /Approval requested/.test((r as any).error) && calls.length === 0, 'approval matrix: expired exact row does not authorize wp update');
  }
  {
    const { stubs, calls } = makeUpdateStubs();
    const r = await dispatchWpClientToolWithApproval(stubs, 'wp.update_post', input, [
      { id: 'wrong_1', status: 'approved', payload: { toolApprovalKey: wrongKey } },
    ]);
    assert(!r.ok && /Approval requested/.test((r as any).error) && calls.length === 0, 'approval matrix: approved wrong-args row blocks wp update');
  }
  {
    const { stubs, calls } = makeUpdateStubs();
    const r = await dispatchWpClientToolWithApproval(stubs, 'wp.update_post', input, [
      { id: 'generic_1', status: 'approved', payload: { tool: 'wp.update_post', app: 'wordpress', label: 'Update post', url: 'https://example.com' } },
    ]);
    assert(!r.ok && /Approval requested/.test((r as any).error) && calls.length === 0, 'approval matrix: generic approval payload does not authorize wp update');
  }
  {
    const { stubs, calls } = makeUpdateStubs();
    const r = await dispatchWpClientToolWithApproval(stubs, 'wp.update_post', input, [
      { id: 'approved_1', status: 'approved', payload: { toolApprovalKey: exactKey } },
    ]);
    assert(r.ok && calls.length === 1, 'approval matrix: approved exact row dispatches wp update once');
  }
  {
    const { stubs, calls } = makeUpdateStubs();
    const r = await dispatchWpClientToolWithApproval(stubs, 'wp.update_post', input, [
      { id: 'auto_1', status: 'auto_approved', payload: { toolApprovalKey: exactKey } },
    ]);
    assert(r.ok && calls.length === 1, 'approval matrix: auto-approved exact row dispatches wp update once');
  }
  {
    const { stubs, calls } = makeUpdateStubs();
    const r = await dispatchWpClientToolWithApproval(stubs, 'wp.update_post', input, 'lookup_error');
    assert(!r.ok && /Approval check failed/.test((r as any).error) && calls.length === 0, 'approval matrix: lookup error fails closed before wp update');
  }
  {
    const stubs = makeStubs();
    const discover = await dispatchWpClientToolWithApproval(stubs, 'wp.discover_types', { siteUrl: 'https://example.com', onePasswordItem: 'Dealer WP' }, []);
    const list = await dispatchWpClientToolWithApproval(stubs, 'wp.list_posts', { siteUrl: 'https://example.com', onePasswordItem: 'Dealer WP' }, []);
    assert(discover.ok && list.ok, 'approval matrix: read-only wp tools bypass approval gate');
  }
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
      slide: { id: 88, link: 'https://ex.com/slide/88', status: opts.status || 'draft', title: { rendered: opts.title || image.fileName } },
    }),
    updatePost: async (_c, opts) => ({
      id: opts.postId,
      link: `https://ex.com/${opts.postId}`,
      status: opts.status || 'draft',
      title: { rendered: opts.title || `Updated ${opts.postId}` },
    }),
    trashPost: async (_c, opts) => opts.force === true
      ? {
          deleted: true,
          previous: {
            id: opts.postId,
            link: `https://ex.com/${opts.postId}`,
            status: 'draft',
            title: { rendered: `Deleted ${opts.postId}` },
          },
        }
      : {
          id: opts.postId,
          link: `https://ex.com/${opts.postId}`,
          status: 'trash',
          title: { rendered: `Trashed ${opts.postId}` },
        },
    ...overrides,
  };
}

async function main() {
  // ─── client-only WordPress approval gate ───────────────────────
  assertSwanBotWpApprovalGateSource();
  await assertWpClientApprovalMatrix();

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
          slide: { id: 88, link: 'https://ex.com/slide/88', status: opts.status || 'draft', title: { rendered: opts.title || image.fileName } },
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
    assert(calls[0].opts.status === 'draft', 'create_slide: default status=draft');
    assert(calls[0].image.mimeType === 'image/jpeg', 'create_slide: default mimeType=image/jpeg');

    // status=publish preserved only when explicit
    calls.length = 0;
    const r2 = await dispatchWpCreateSlide(stubs, {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      storagePath: 'a/s.jpg',
      fileName: 's.jpg',
      status: 'publish',
    });
    assert(r2.ok && calls[0].opts.status === 'publish', 'create_slide: explicit publish preserved');

    // Unknown status → draft
    calls.length = 0;
    const r3 = await dispatchWpCreateSlide(stubs, {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      storagePath: 'a/s.jpg',
      fileName: 's.jpg',
      status: 'scheduled',
    });
    assert(r3.ok && calls[0].opts.status === 'draft', 'create_slide: unknown status → draft');

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

  // ─── update_post ───────────────────────────────────────────────
  {
    const calls: any[] = [];
    const stubs = makeStubs({
      updatePost: async (c, opts) => {
        calls.push({ c, opts });
        return { id: opts.postId, link: `https://ex.com/${opts.postId}`, status: opts.status || 'draft', title: { rendered: opts.title || 'Untitled' } };
      },
    });
    const r = await dispatchWpUpdatePost(stubs, {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      postId: 88,
      postType: 'di_slide',
      title: 'Promaster June',
      status: 'draft',
      featuredMedia: 77,
      menuOrder: -500,
      meta: { expiration_date: '2026-06-30' },
    });
    assert(r.ok, 'update_post: happy path');
    assert(calls[0].opts.postId === 88, 'update_post: postId passthrough');
    assert(calls[0].opts.postType === 'di_slide', 'update_post: postType passthrough');
    assert(calls[0].opts.status === 'draft', 'update_post: status passthrough');
    assert(calls[0].opts.featured_media === 77, 'update_post: featuredMedia normalized');
    assert(calls[0].opts.menu_order === -500, 'update_post: menuOrder normalized');
    assert(calls[0].opts.meta.expiration_date === '2026-06-30', 'update_post: meta passthrough');
    assert((r as any).data?.post?.title === 'Promaster June', 'update_post: title rendered flattened');

    const r2 = await dispatchWpUpdatePost(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 0, title: 'x' });
    assert(!r2.ok && /postId/.test((r2 as any).error), 'update_post: invalid postId rejected');

    const r3 = await dispatchWpUpdatePost(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 88 });
    assert(!r3.ok && /No WordPress update fields/.test((r3 as any).error), 'update_post: empty patch rejected');

    calls.length = 0;
    const r4 = await dispatchWpUpdatePost(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 88, status: 'scheduled', title: 'Fallback status' });
    assert(!r4.ok && /status must/.test((r4 as any).error) && calls.length === 0, 'update_post: unknown status rejected before dispatch');

    const r4b = await dispatchWpUpdatePost(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 88, postType: '../users', title: 'x' });
    assert(!r4b.ok && /postType/.test((r4b as any).error), 'update_post: invalid postType rejected');

    const r4c = await dispatchWpUpdatePost(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 88, slug: '../bad', title: 'x' });
    assert(!r4c.ok && /slug/.test((r4c as any).error), 'update_post: invalid slug rejected');

    const r4d = await dispatchWpUpdatePost(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 88, status: 'future', title: 'x' });
    assert(!r4d.ok && /requires a date/.test((r4d as any).error), 'update_post: future status requires date');

    const r4e = await dispatchWpUpdatePost(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 88, date: 'not a date', title: 'x' });
    assert(!r4e.ok && /date/.test((r4e as any).error), 'update_post: invalid date rejected');

    const r4f = await dispatchWpUpdatePost(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 88, featuredMedia: -1, title: 'x' });
    assert(!r4f.ok && /featuredMedia/.test((r4f as any).error), 'update_post: negative featured media rejected');

    const r4g = await dispatchWpUpdatePost(stubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 88, title: 'x', meta: { nested: { no: true } } });
    assert(!r4g.ok && /scalar/.test((r4g as any).error), 'update_post: nested meta rejected');

    const r4h = await dispatchWpUpdatePost(stubs, {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      postId: 88,
      title: 'x',
      meta: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`k${i}`, i])),
    });
    assert(!r4h.ok && /at most/.test((r4h as any).error), 'update_post: too many meta keys rejected');

    const badStubs = makeStubs({ updatePost: async () => { throw new Error('403 rest_forbidden'); } });
    const r5 = await dispatchWpUpdatePost(badStubs, { siteUrl: 'https://ex.com', onePasswordItem: 'WP', postId: 88, title: 'x' });
    assert(!r5.ok && /403/.test((r5 as any).error), 'update_post: thrown error surfaced');
  }

  // ─── trash_post ────────────────────────────────────────────────
  {
    const calls: any[] = [];
    const stubs = makeStubs({
      trashPost: async (c, opts) => {
        calls.push({ c, opts });
        return opts.force === true
          ? {
              deleted: true,
              previous: {
                id: opts.postId,
                link: `https://ex.com/${opts.postId}`,
                status: 'draft',
                title: { rendered: 'Deleted title' },
              },
            }
          : {
              id: opts.postId,
              link: `https://ex.com/${opts.postId}`,
              status: 'trash',
              title: { rendered: 'Trashed title' },
            };
      },
    });
    const r = await dispatchWpClientTool(stubs, 'wp.trash_post', {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      postId: 88,
      postType: 'pages',
    });
    assert(r.ok, 'trash_post: dispatcher path happy path');
    assert(calls[0].opts.postId === 88, 'trash_post: postId passthrough');
    assert(calls[0].opts.postType === 'pages', 'trash_post: postType passthrough');
    assert(calls[0].opts.force === false, 'trash_post: force defaults false');
    assert((r as any).data?.post?.action === 'trashed', 'trash_post: default action is trashed');
    assert((r as any).data?.post?.deleted === false, 'trash_post: default receipt not force-deleted');
    assert((r as any).data?.post?.status === 'trash', 'trash_post: trashed status preserved');
    assert((r as any).data?.post?.title === 'Trashed title', 'trash_post: title rendered flattened');

    calls.length = 0;
    const r2 = await dispatchWpClientTool(stubs, 'wp.trash_post', {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      postId: 88,
      postType: 'flavor_di_slides',
      force: true,
    });
    assert(!r2.ok && /Permanent delete is not supported/.test((r2 as any).error) && calls.length === 0, 'trash_post: force=true permanent delete rejected before dispatch');

    calls.length = 0;
    const r3 = await dispatchWpClientTool(stubs, 'wp.trash_post', {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      postId: 0,
    });
    assert(!r3.ok && /postId/.test((r3 as any).error) && calls.length === 0, 'trash_post: invalid postId rejected before dispatch');

    const r4 = await dispatchWpClientTool(stubs, 'wp.trash_post', {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      postId: 88,
      postType: '../users',
    });
    assert(!r4.ok && /postType/.test((r4 as any).error), 'trash_post: invalid postType rejected');

    const r5 = await dispatchWpClientTool(stubs, 'wp.trash_post', {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      postId: 88,
      force: 'true',
    });
    assert(!r5.ok && /Permanent delete is not supported/.test((r5 as any).error), 'trash_post: any force field rejected');

    const badStubs = makeStubs({ trashPost: async () => { throw new Error('403 rest_forbidden'); } });
    const r6 = await dispatchWpClientTool(badStubs, 'wp.trash_post', {
      siteUrl: 'https://ex.com',
      onePasswordItem: 'WP',
      postId: 88,
    });
    assert(!r6.ok && /403/.test((r6 as any).error), 'trash_post: thrown error surfaced');
  }

  if (failures > 0) {
    console.error(`\n${failures} swanbot-v2-wp smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll swanbot-v2-wp smoke cases passed.');
}

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
