/**
 * wpImagePostFlow — pure glue for "attach images in chat → post them to a
 * WordPress site".
 *
 * Owns four things, nothing else:
 *   1. Dealer-Inspire-aware site URL normalization (subdir installs like
 *      `https://dealer.com/wp/wp-admin` → site base `https://dealer.com/wp`).
 *   2. Intent detection: does this chat message + its image attachments mean
 *      "put these on my WordPress site"?
 *   3. The bounded model-facing upload directive: exact `wp.upload_media`
 *      recipes per image (the tool uploads FROM Supabase storage — chat
 *      attachments already live there as {name, mimeType, storagePath}).
 *   4. Honest connect guidance + the one-line user-facing plan summary.
 *
 * It executes nothing — no supabase, no fetch, no tool calls. ChatTab /
 * router wiring decides when to inject the directive; the existing
 * approval-gated `wp.upload_media` / `wp.create_slide` / `wp.update_post`
 * handlers in openswanToolRuntime do the writes. Credentials ride 1Password
 * vault items (see wpAdmin.WpSiteConfig) — this module NEVER invents an
 * onePasswordItem value and NEVER asks for a password in chat.
 *
 * CRITICAL: keep this module import-free (pure) so it loads under tsx for
 * scripts/wp-image-post-flow-smoketest.ts.
 */

// ── Site URL normalization ──────────────────────────────────────────────────

export interface NormalizedWordPressSite {
  /**
   * Site base used to build `/wp-json/...` paths (see wpAdmin.apiUrl):
   * scheme + host + install-path prefix, no trailing slash. For Dealer
   * Inspire subdir installs this KEEPS the `/wp` (or `/blog`) segment.
   */
  siteUrl: string;
  /** Always `${siteUrl}/wp-admin`. */
  adminUrl: string;
  /** True when the input pointed at wp-admin or wp-login (an admin-surface URL). */
  wasAdminUrl: boolean;
  /** Present (true) when the input was plain http — callers should warn. */
  httpDowngraded?: boolean;
}

/**
 * Normalize anything a user might paste as "my WordPress site" into the
 * canonical site base:
 *
 *   https://dealer.com/wp/wp-admin            → https://dealer.com/wp
 *   https://dealer.com/wp-admin/upload.php?x  → https://dealer.com
 *   https://dealer.com/wp/wp-login.php        → https://dealer.com/wp
 *   dealer.com                                → https://dealer.com
 *
 * Query/fragment stripped, host lowercased (path case preserved), trailing
 * slashes removed. Returns null (REFUSED, never echoed) for credential-bearing
 * userinfo@ URLs, javascript:/data: schemes, hosts without a dot (except
 * localhost), and anything unparseable.
 */
export function normalizeWordPressSiteUrl(raw: string): NormalizedWordPressSite | null {
  const trimmed = String(raw ?? '').trim();
  if (!trimmed) return null;
  // Whitespace/control chars/quotes/backslashes inside a URL → not a URL.
  if (/[\s\u0000-\u001f<>"'`\\]/.test(trimmed)) return null;

  let candidate = trimmed;
  const schemeMatch = candidate.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    if (scheme !== 'http' && scheme !== 'https') return null; // javascript:, data:, etc.
  } else if (candidate.startsWith('//')) {
    candidate = `https:${candidate}`;
  } else {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  // Credential-bearing URLs are refused outright — never echo them back.
  if (url.username || url.password) return null;
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  const hostname = url.hostname; // URL already lowercases the host
  if (!hostname) return null;
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(hostname)) return null;
  if (!hostname.includes('.') && hostname !== 'localhost') return null;

  const host = url.port ? `${hostname}:${url.port}` : hostname;

  // Path prefix up to (excluding) the admin surface; query/fragment ignored.
  let path = url.pathname || '';
  let wasAdminUrl = false;
  const adminMatch = path.match(/^(.*?)\/wp-admin(?:\/|$)/i);
  const loginMatch = path.match(/^(.*?)\/wp-login\.php(?:\/|$)/i);
  if (adminMatch) {
    path = adminMatch[1];
    wasAdminUrl = true;
  } else if (loginMatch) {
    path = loginMatch[1];
    wasAdminUrl = true;
  }
  path = path.replace(/\/+$/, '');

  const siteUrl = `${url.protocol}//${host}${path}`;
  const result: NormalizedWordPressSite = {
    siteUrl,
    adminUrl: `${siteUrl}/wp-admin`,
    wasAdminUrl,
  };
  if (url.protocol === 'http:') result.httpDowngraded = true;
  return result;
}

// ── Intent detection ────────────────────────────────────────────────────────

export interface WpImagePostIntent {
  siteUrl: string | null;
  adminUrl: string | null;
  wantsSlide: boolean;
  wantsPost: boolean;
  confidence: 'high' | 'medium';
}

/** Capability/informational questions are not tasks ("how do I…", "what is…"). */
const CAPABILITY_QUESTION =
  /^\s*(how\s+(do|does|did|would|can|could|should)\b|what(\s+is|\s+are|'s)\b|why\b|when\b|where\b|who\b|is\s+it\s+possible\b|is\s+there\b|can\s+(it|this|that|the\s+\w+)\b|do(es)?\s+(it|this|that|the\s+\w+)\s+(support|handle|work)\b)/i;

const WP_UPLOAD_VERB = /\b(upload|post|add|put)(?:s|ed|ded|ting|ing)?\b/i;
const WP_IMAGE_NOUN = /\b(images?|photos?|pictures?|pics?|screenshots?|these|them)\b/i;
const WP_TARGET =
  /\b(wordpress|wp[\s-]?site|wp-?admin|wp-?login|dealer(?:\s+inspire)?\s+site|media\s+library)\b/i;

/** Strict HIGH pattern: verb … image-noun … wordpress-target, in that order. */
const WP_ORDERED_HIGH =
  /\b(upload|post|add|put)(?:s|ed|ded|ting|ing)?\b[\s\S]{0,200}?\b(images?|photos?|pictures?|pics?|screenshots?|these|them)\b[\s\S]{0,200}?\b(wordpress|wp[\s-]?site|wp-?admin|wp-?login|dealer(?:\s+inspire)?\s+site|media\s+library)\b/i;

const WANTS_SLIDE = /\b(slides?|carousels?|banners?|hero(?:es)?)\b/i;
const WANTS_POST = /\b(posts?|blogs?|articles?|pages?)\b/i;

/** URL-ish tokens in free text (scheme optional). */
const URL_IN_TEXT =
  /(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}(?::\d{1,5})?(?:\/[^\s<>"']*)?/gi;

function extractSiteFromText(text: string): NormalizedWordPressSite | null {
  const matches = text.match(URL_IN_TEXT) || [];
  let generic: NormalizedWordPressSite | null = null;
  for (const rawMatch of matches) {
    const cleaned = rawMatch.replace(/[),.;:!?\]]+$/, '');
    const hasScheme = /^https?:\/\//i.test(cleaned);
    const wpMarked = /wp-?(admin|login)/i.test(cleaned);
    // Scheme-less tokens are only trusted when they look like a site
    // (www.-prefixed or carrying a wp marker) — keeps "photo.jpg" out.
    if (!hasScheme && !wpMarked && !/^www\./i.test(cleaned)) continue;
    const norm = normalizeWordPressSiteUrl(cleaned);
    if (!norm) continue;
    if (norm.wasAdminUrl) return norm; // admin/login URL = strongest signal
    if (!generic) generic = norm;
  }
  return generic;
}

/**
 * Does "this message + these image attachments" mean "put the images on my
 * WordPress site"?
 *
 *   high   — a wp-admin/wp-login URL is in the text, or an explicit ordered
 *            "upload/post/add/put … image-ish … wordpress-ish" phrase.
 *   medium — verb + image-noun + wordpress-ish wording, but loosely arranged
 *            and no admin URL.
 *   null   — no image attachments, capability questions ("how do I…"),
 *            or wordpress mentions without any upload/post verb.
 */
export function detectWordPressImagePostIntent(args: {
  text: string;
  imageAttachmentCount: number;
}): WpImagePostIntent | null {
  const imageCount = Number(args.imageAttachmentCount) || 0;
  if (imageCount < 1) return null;
  const text = String(args.text ?? '').trim();
  if (!text) return null;
  if (CAPABILITY_QUESTION.test(text)) return null;

  const site = extractSiteFromText(text);
  const hasVerb = WP_UPLOAD_VERB.test(text);
  const hasImageNoun = WP_IMAGE_NOUN.test(text);
  const hasTarget = WP_TARGET.test(text);

  let confidence: 'high' | 'medium' | null = null;
  if (site && site.wasAdminUrl) {
    confidence = 'high'; // pasted their wp-admin/wp-login URL with images attached
  } else if (WP_ORDERED_HIGH.test(text)) {
    confidence = 'high';
  } else if (hasVerb && hasImageNoun && (hasTarget || site !== null)) {
    confidence = 'medium';
  }
  if (!confidence) return null;

  return {
    siteUrl: site ? site.siteUrl : null,
    adminUrl: site ? site.adminUrl : null,
    wantsSlide: WANTS_SLIDE.test(text),
    wantsPost: WANTS_POST.test(text),
    confidence,
  };
}

// ── Model-facing upload directive ───────────────────────────────────────────

export interface WpDirectiveAttachment {
  name: string;
  mimeType: string;
  storagePath: string;
}

/** Hard character bound for the injected directive block. */
export const MAX_WP_IMAGE_DIRECTIVE_LENGTH = 2400;
/** Never list more than this many per-image recipes. */
export const MAX_WP_DIRECTIVE_IMAGE_LINES = 10;

/**
 * The onePasswordItem value is NEVER invented — the model must resolve the
 * circle's WordPress vault item or ask the user for the item name.
 */
const ONE_PASSWORD_ITEM_PLACEHOLDER =
  "<resolve via the circle's WordPress vault item — ask the user if unknown>";

function oneLine(value: string): string {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/"/g, '\\"').trim();
}

/**
 * Bounded model-facing block: one exact approval-gated `wp.upload_media`
 * recipe per image attachment (max 10; clamps further only if the char bound
 * demands it, and always says so). Storage paths are internal references —
 * included verbatim. Non-image attachments are filtered out and noted.
 */
export function buildWpImageUploadDirective(args: {
  attachments: Array<WpDirectiveAttachment>;
  siteUrl: string | null;
  wantsSlide: boolean;
  wantsPost: boolean;
}): string {
  const attachments = Array.isArray(args.attachments) ? args.attachments : [];
  const isImage = (a: WpDirectiveAttachment): boolean =>
    /^image\//i.test(String(a?.mimeType ?? ''));
  const images = attachments.filter(isImage);
  const skipped = attachments.filter((a) => !isImage(a));

  const skippedNote = skipped.length
    ? `Skipped ${skipped.length} non-image attachment(s) — only image/* uploads here: ${skipped
        .slice(0, 3)
        .map((a) => oneLine(a?.name || a?.storagePath || 'unnamed').slice(0, 48))
        .join(', ')}${skipped.length > 3 ? ', …' : ''}.`
    : null;

  if (images.length === 0) {
    return [
      'WordPress image upload — no image attachments on this message.',
      skippedNote,
      'Nothing to upload: ask the user to attach the image(s) and try again. Do not call wp.upload_media.',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
  }

  const sitePart = args.siteUrl ? `"${oneLine(args.siteUrl)}"` : '"ASK USER"';
  const recipeFor = (a: WpDirectiveAttachment): string =>
    `wp.upload_media { siteUrl: ${sitePart}, onePasswordItem: ${ONE_PASSWORD_ITEM_PLACEHOLDER}, ` +
    `storagePath: "${oneLine(a.storagePath)}", fileName: "${oneLine(a.name)}", mimeType: "${oneLine(a.mimeType)}" }`;

  const followUps: string[] = [];
  if (args.wantsSlide) {
    followUps.push(
      'After each upload succeeds: wp.create_slide { siteUrl, onePasswordItem, storagePath, fileName, mimeType, title, status: "draft", slideType }.',
    );
  }
  if (args.wantsPost) {
    followUps.push(
      'Then create/update a DRAFT post embedding each returned source_url (wp.update_post; find targets via wp.list_posts) — keep status "draft".',
    );
  }
  if (!args.wantsSlide && !args.wantsPost) {
    followUps.push('Then report each returned media source_url back to the user — no further writes.');
  }

  const build = (shownCount: number): string => {
    const shown = images.slice(0, shownCount);
    const clampNote =
      shownCount < images.length
        ? `First ${shownCount} of ${images.length} images listed — repeat this exact recipe for the remaining ${images.length - shownCount}.`
        : null;
    return [
      `WordPress image upload — ${images.length} image(s) in storage.`,
      args.siteUrl ? null : 'siteUrl unknown — ASK USER for the WordPress site URL first.',
      skippedNote,
      'Every wp.* call is an approval-gated WordPress write — wait for user approval on each.',
      clampNote,
      ...shown.map(recipeFor),
      ...followUps,
      'Hard rule: never publish live without explicit approval; drafts by default.',
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
  };

  let shownCount = Math.min(images.length, MAX_WP_DIRECTIVE_IMAGE_LINES);
  let block = build(shownCount);
  while (block.length > MAX_WP_IMAGE_DIRECTIVE_LENGTH && shownCount > 1) {
    shownCount -= 1;
    block = build(shownCount);
  }
  if (block.length > MAX_WP_IMAGE_DIRECTIVE_LENGTH) {
    block = `${block.slice(0, MAX_WP_IMAGE_DIRECTIVE_LENGTH - 1).trimEnd()}…`;
  }
  return block;
}

// ── Connect guidance ────────────────────────────────────────────────────────

/** Hard character bound for the connect guidance. */
export const MAX_WP_CONNECT_GUIDANCE_LENGTH = 900;

/**
 * Plain-language steps when no WordPress credentials are connected. Passwords
 * go in 1Password, never in chat — chat only ever needs the ITEM NAME.
 */
export function buildWpConnectGuidance(siteUrl: string | null): string {
  const norm = siteUrl ? normalizeWordPressSiteUrl(siteUrl) : null;
  const adminLabel = norm ? norm.adminUrl : "your site's /wp-admin";
  const siteLabel = norm ? norm.siteUrl : 'your WordPress site URL';
  const guidance = [
    "Your WordPress site isn't connected yet — two ways to fix that:",
    `1. In wp-admin (${adminLabel}) open Users → Profile → Application Passwords and create one named "Underground Circle".`,
    `2. Save it in 1Password as one item holding the site URL (${siteLabel}), your WP username, and that application password — then tell me the item name here.`,
    '3. Or skip credentials: I can drive wp-admin in the browser instead — logging in always requires your approval.',
    'Passwords belong in 1Password, never in chat — I only ever need the 1Password item name.',
  ].join('\n');
  if (guidance.length <= MAX_WP_CONNECT_GUIDANCE_LENGTH) return guidance;
  return `${guidance.slice(0, MAX_WP_CONNECT_GUIDANCE_LENGTH - 1).trimEnd()}…`;
}

// ── User-facing plan summary ────────────────────────────────────────────────

/** Hard character bound for the one-line routing notice. */
export const MAX_WP_IMAGE_SUMMARY_LENGTH = 200;

const MAX_SUMMARY_HOST_LENGTH = 40;

function abbreviateHost(host: string): string {
  if (host.length <= MAX_SUMMARY_HOST_LENGTH) return host;
  return `${host.slice(0, MAX_SUMMARY_HOST_LENGTH - 15)}…${host.slice(-14)}`;
}

/**
 * One friendly line for the routing notice, e.g.
 * "🪄 3 images → Examplechryslerdodgejeepra…tpalmbeach.com/wp media library
 *  (draft post after upload; each write needs your approval)".
 */
export function summarizeWpImagePlanForUser(args: {
  count: number;
  siteUrl: string | null;
  wantsSlide: boolean;
  wantsPost: boolean;
}): string {
  const count = Math.max(0, Math.floor(Number(args.count) || 0));
  const noun = count === 1 ? 'image' : 'images';

  let destination = 'your WordPress site — site URL needed';
  if (args.siteUrl) {
    const norm = normalizeWordPressSiteUrl(args.siteUrl);
    if (norm) {
      const hostAndPath = norm.siteUrl.replace(/^https?:\/\//i, '');
      const slash = hostAndPath.indexOf('/');
      const host = slash === -1 ? hostAndPath : hostAndPath.slice(0, slash);
      const path = slash === -1 ? '' : hostAndPath.slice(slash);
      destination = `${abbreviateHost(host.replace(/^www\./, ''))}${path} media library`;
    }
  }

  const follow =
    args.wantsSlide && args.wantsPost
      ? 'slides + draft post after upload'
      : args.wantsSlide
        ? 'slides after upload'
        : args.wantsPost
          ? 'draft post after upload'
          : 'media upload only';

  const line = `🪄 ${count} ${noun} → ${destination} (${follow}; each write needs your approval)`;
  if (line.length <= MAX_WP_IMAGE_SUMMARY_LENGTH) return line;
  return `${line.slice(0, MAX_WP_IMAGE_SUMMARY_LENGTH - 1).trimEnd()}…`;
}
