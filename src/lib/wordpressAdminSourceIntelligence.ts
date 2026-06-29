export interface WordPressAdminMenuItem {
  id?: string;
  label: string;
  href?: string;
  postType?: string;
  adminPage?: string;
}

export interface WordPressAdminCustomPostType {
  slug: string;
  label: string;
  listUrl?: string;
  addNewUrl?: string;
}

export interface WordPressAdminStatusCount {
  status: string;
  label: string;
  count: number;
}

export interface WordPressAdminListRow {
  postId: number;
  title: string;
  slug?: string;
  status?: string;
  authorId?: string;
  editUrl?: string;
  actions: string[];
  sliderNames: string[];
  imageUrl?: string;
  imageBasename?: string;
  expires?: string;
  dateText?: string;
  createdByBroadcaster?: boolean;
  isBroadcasted?: boolean;
  menuOrder?: string;
}

export interface WordPressAdminQuickEditSummary {
  fieldNames: string[];
  statusOptions: string[];
  supportsExpiration: boolean;
  supportsMenuOrder: boolean;
  supportsBulkEdit: boolean;
}

export interface DealerInspireAdminSignals {
  detected: boolean;
  pluginHandles: string[];
  adminPages: WordPressAdminMenuItem[];
  productMenus: string[];
  jumpToSiteCount: number;
  currentPostTypeKind?: 'di_slide' | 'slides' | 'special_offers' | 'fixed_op' | 'inventory' | 'staff' | 'events' | 'wallet' | 'personalizer' | 'unknown_di_custom_type';
}

export interface WordPressAdminSourceIntelligence {
  sourceKind: 'wordpress_admin_source';
  isWordPressAdmin: boolean;
  siteOrigin?: string;
  adminRoot?: string;
  canonicalUrl?: string;
  wpVersion?: string;
  bodyClasses: string[];
  globals: {
    ajaxPath?: string;
    pagenow?: string;
    typenow?: string;
    adminpage?: string;
  };
  currentScreen: {
    heading?: string;
    postType?: string;
    postTypeLabel?: string;
    isListTable: boolean;
  };
  menuItems: WordPressAdminMenuItem[];
  customPostTypes: WordPressAdminCustomPostType[];
  statusCounts: WordPressAdminStatusCount[];
  columns: string[];
  rows: WordPressAdminListRow[];
  quickEdit: WordPressAdminQuickEditSummary;
  security: {
    hasAuthCheck: boolean;
    sessionExpired: boolean;
    hasLogoutLink: boolean;
    hasNonceFields: boolean;
    nonceFieldNames: string[];
    hasCloudflareEmailProtection: boolean;
    redactedTransientValues: string[];
  };
  dealerInspire: DealerInspireAdminSignals;
}

export interface WordPressAdminSourceIntelligenceOptions {
  maxMenuItems?: number;
  maxRows?: number;
}

const SENSITIVE_QUERY_KEY_RE = /(?:^|[_-])(?:nonce|token|key|api_?key|password|passwd|secret|auth|session|cookie|bearer|client_?secret|security)(?:$|[_-])/i;
const NONCE_QUERY_KEYS = new Set(['_wpnonce', 'nonce', 'screenoptionnonce', '_inline_edit', '_wp_http_referer', '_ajax_nonce']);
const TRANSIENT_SECRET_PATTERNS = [
  'nonce',
  'apiKey',
  '_wpnonce',
  'screenoptionnonce',
  'heartbeatSettings.nonce',
  'SEARCH_SERVICE.apiKey',
  'Cloudflare email placeholders',
];

function decodeHtml(value: string): string {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function redactText(value: string): string {
  return String(value || '')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted_email]')
    .replace(/\b(?:nonce|token|api[_-]?key|password|secret|bearer)\s*[:=]\s*["']?[A-Za-z0-9._~+/-]{8,}/gi, '$1=[redacted]');
}

function stripTags(value: string): string {
  return redactText(decodeHtml(String(value || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ')))
    .replace(/\s+/g, ' ')
    .trim();
}

function attrMap(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(tag))) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = String(value || '').replace(/\s+/g, ' ').trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

function extractFirst(pattern: RegExp, source: string): string | undefined {
  const match = source.match(pattern);
  if (!match) return undefined;
  for (let index = match.length - 1; index > 0; index -= 1) {
    const value = match[index];
    if (value && value !== '"' && value !== "'") {
      return decodeHtml(value).trim();
    }
  }
  return undefined;
}

function sanitizeUrl(rawHref: string | undefined, baseUrl?: string): string | undefined {
  if (!rawHref) return undefined;
  const href = decodeHtml(rawHref).trim();
  if (!href || href === '#') return href || undefined;
  try {
    const url = new URL(href, baseUrl || 'https://wordpress.local');
    if (!['http:', 'https:'].includes(url.protocol)) return undefined;
    url.username = '';
    url.password = '';
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (NONCE_QUERY_KEYS.has(key) || SENSITIVE_QUERY_KEY_RE.test(key)) {
        url.searchParams.delete(key);
      }
    }
    if (!baseUrl && href.startsWith('/')) return `${url.pathname}${url.search}`;
    if (!baseUrl && !/^https?:\/\//i.test(href)) return `${url.pathname}${url.search}`;
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return href.replace(/([?&](?:_wpnonce|nonce|screenoptionnonce|_inline_edit)=)[^&#\s]+/gi, '$1[redacted]');
  }
}

function pathAndSearch(rawHref: string | undefined, baseUrl?: string): string | undefined {
  const href = sanitizeUrl(rawHref, baseUrl);
  if (!href) return undefined;
  try {
    const url = new URL(href, baseUrl || 'https://wordpress.local');
    return `${url.pathname}${url.search}`;
  } catch {
    return href;
  }
}

function queryParamFromHref(rawHref: string | undefined, key: string, baseUrl?: string): string | undefined {
  if (!rawHref) return undefined;
  try {
    return new URL(decodeHtml(rawHref), baseUrl || 'https://wordpress.local').searchParams.get(key) || undefined;
  } catch {
    return undefined;
  }
}

function safeOrigin(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return undefined;
  }
}

function inferAdminRoot(canonicalUrl?: string, ajaxPath?: string): string | undefined {
  const candidate = canonicalUrl || ajaxPath;
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate, canonicalUrl || 'https://wordpress.local');
    const marker = '/wp-admin/';
    const index = url.pathname.indexOf(marker);
    if (index >= 0) {
      return `${url.origin}${url.pathname.slice(0, index + marker.length)}`;
    }
    return `${url.origin}/wp-admin/`;
  } catch {
    return undefined;
  }
}

function extractBodyClasses(html: string): string[] {
  const bodyTag = html.match(/<body\b[^>]*>/i)?.[0] || '';
  return uniqueStrings((attrMap(bodyTag).class || '').split(/\s+/));
}

function extractMenuItems(html: string, baseUrl?: string, maxItems = 80): WordPressAdminMenuItem[] {
  const items: WordPressAdminMenuItem[] = [];
  const linkRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(html)) && items.length < maxItems) {
    const attrs = attrMap(match[1]);
    const label = stripTags(match[2]);
    const href = attrs.href;
    if (!label || !href) continue;
    const idMatch = html.slice(Math.max(0, match.index - 220), match.index).match(/<li\b[^>]*\bid=(["'])([^"']+)\1[^>]*>\s*$/i);
    const sanitized = pathAndSearch(href, baseUrl);
    const postType = queryParamFromHref(href, 'post_type', baseUrl);
    const adminPage = queryParamFromHref(href, 'page', baseUrl);
    items.push({
      id: idMatch?.[2],
      label,
      href: sanitized,
      postType,
      adminPage,
    });
  }
  return items;
}

function extractCustomPostTypes(menuItems: WordPressAdminMenuItem[]): WordPressAdminCustomPostType[] {
  const bySlug = new Map<string, WordPressAdminCustomPostType>();
  for (const item of menuItems) {
    if (!item.postType || item.postType === 'post') continue;
    const existing = bySlug.get(item.postType) || {
      slug: item.postType,
      label: item.label,
    };
    if (/edit\.php/i.test(item.href || '')) existing.listUrl = item.href;
    if (/post-new\.php/i.test(item.href || '')) existing.addNewUrl = item.href;
    if (item.label && item.label.length < existing.label.length) existing.label = item.label;
    bySlug.set(item.postType, existing);
  }
  return Array.from(bySlug.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

function extractStatusCounts(html: string): WordPressAdminStatusCount[] {
  const counts: WordPressAdminStatusCount[] = [];
  const re = /<li\b[^>]*class=(["'])([^"']+)\1[^>]*>\s*<a\b[^>]*>([\s\S]*?)<span\b[^>]*class=(["'])count\4[^>]*>\(([\d,]+)\)<\/span>[\s\S]*?<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html))) {
    const status = match[2].split(/\s+/)[0] || 'unknown';
    counts.push({
      status,
      label: stripTags(match[3]),
      count: Number(match[5].replace(/,/g, '')) || 0,
    });
  }
  return counts;
}

function extractColumns(html: string): string[] {
  const thead = html.match(/<thead\b[^>]*>([\s\S]*?)<\/thead>/i)?.[1] || '';
  const columns: string[] = [];
  const re = /<(?:th|td)\b([^>]*)>([\s\S]*?)<\/(?:th|td)>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(thead))) {
    const attrs = attrMap(match[1]);
    const label = stripTags(match[2]) || attrs.id || attrs.class;
    if (label) columns.push(label);
  }
  return uniqueStrings(columns);
}

function extractRowActions(rowHtml: string): string[] {
  const actionsBlock = rowHtml.match(/<div\b[^>]*class=(["'])[^"']*\brow-actions\b[^"']*\1[^>]*>([\s\S]*?)<\/div>/i)?.[2] || '';
  const actions: string[] = [];
  const re = /<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(actionsBlock))) {
    const label = stripTags(match[1]).replace(/\|$/g, '').trim();
    if (label) actions.push(label);
  }
  return uniqueStrings(actions);
}

function basenameFromUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(decodeHtml(rawUrl), 'https://wordpress.local');
    return decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() || '') || undefined;
  } catch {
    return rawUrl.split('/').filter(Boolean).pop();
  }
}

function cellText(rowHtml: string, columnClass: string): string | undefined {
  const pattern = new RegExp(`<td\\b[^>]*class=(["'])[^"']*\\b${columnClass}\\b[^"']*\\1[^>]*>([\\s\\S]*?)<\\/td>`, 'i');
  const value = stripTags(rowHtml.match(pattern)?.[2] || '');
  return value || undefined;
}

function extractRows(html: string, baseUrl?: string, maxRows = 25): WordPressAdminListRow[] {
  const rows: WordPressAdminListRow[] = [];
  const tbody = html.match(/<tbody\b[^>]*id=(["'])the-list\1[^>]*>([\s\S]*?)<\/tbody>/i)?.[2] || html;
  const rowRe = /<tr\b([^>]*)id=(["'])post-(\d+)\2([^>]*)>([\s\S]*?)<\/tr>/gi;
  let match: RegExpExecArray | null;
  while ((match = rowRe.exec(tbody)) && rows.length < maxRows) {
    const rowAttrs = `${match[1]} ${match[4]}`;
    const rowHtml = match[5];
    const inline = rowHtml.match(new RegExp(`<div\\b[^>]*id=(["'])inline_${match[3]}\\1[^>]*>([\\s\\S]*?)<\\/div>`, 'i'))?.[2] || '';
    const titleAnchor = rowHtml.match(/<a\b([^>]*)class=(["'])[^"']*\brow-title\b[^"']*\2[^>]*>([\s\S]*?)<\/a>/i);
    const title = stripTags(titleAnchor?.[3] || extractFirst(/<div\b[^>]*class=(["'])post_title\1[^>]*>([\s\S]*?)<\/div>/i, inline) || '');
    const imageUrlRaw = rowHtml.match(/<td\b[^>]*class=(["'])[^"']*\bslide_image\b[^"']*\1[^>]*>[\s\S]*?<img\b[^>]*src=(["'])([^"']+)\2/i)?.[3];
    const sliderNames = uniqueStrings(Array.from(rowHtml.matchAll(/<td\b[^>]*class=(["'])[^"']*\bslider\b[^"']*\1[^>]*>([\s\S]*?)<\/td>/gi)).flatMap((sliderMatch) => {
      return Array.from(sliderMatch[2].matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)).map((item) => stripTags(item[1]));
    }));
    const status =
      rowAttrs.match(/\bstatus-([a-z0-9_-]+)/i)?.[1] ||
      extractFirst(/<div\b[^>]*class=(["'])_status\1[^>]*>([\s\S]*?)<\/div>/i, inline);

    rows.push({
      postId: Number(match[3]),
      title,
      slug: extractFirst(/<div\b[^>]*class=(["'])post_name\1[^>]*>([\s\S]*?)<\/div>/i, inline),
      status,
      authorId: extractFirst(/<div\b[^>]*class=(["'])post_author\1[^>]*>([\s\S]*?)<\/div>/i, inline),
      editUrl: pathAndSearch(titleAnchor ? attrMap(titleAnchor[1]).href : undefined, baseUrl),
      actions: extractRowActions(rowHtml),
      sliderNames,
      imageUrl: sanitizeUrl(imageUrlRaw, baseUrl),
      imageBasename: basenameFromUrl(imageUrlRaw),
      expires: cellText(rowHtml, 'expiration_date'),
      dateText: cellText(rowHtml, 'date'),
      createdByBroadcaster: /\bcreated_by_broadcaster\b[\s\S]*?>\s*Yes\s*</i.test(rowHtml),
      isBroadcasted: /\bis_broadcasted\b[\s\S]*?>\s*Yes\s*</i.test(rowHtml),
      menuOrder: extractFirst(/<div\b[^>]*class=(["'])menu_order\1[^>]*>([\s\S]*?)<\/div>/i, inline),
    });
  }
  return rows.filter((row) => row.title);
}

function extractQuickEditSummary(html: string): WordPressAdminQuickEditSummary {
  const quickEdit = html.match(/<tr\b[^>]*id=(["'])inline-edit\1[^>]*>([\s\S]*?)<\/tr>/i)?.[2] || '';
  const bulkEdit = html.match(/<tr\b[^>]*id=(["'])bulk-edit\1[^>]*>([\s\S]*?)<\/tr>/i)?.[2] || '';
  const inputNames = Array.from(`${quickEdit}\n${bulkEdit}`.matchAll(/\bname=(["'])([^"']+)\1/gi)).map((match) => match[2]);
  const statusOptions = Array.from(quickEdit.matchAll(/<option\b[^>]*value=(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/option>/gi))
    .filter((match) => ['publish', 'future', 'pending', 'draft', 'private'].includes(match[2]))
    .map((match) => stripTags(match[3]) || match[2]);
  const fieldNames = uniqueStrings(inputNames.filter((name) => !/_wpnonce|nonce/i.test(name)));
  return {
    fieldNames,
    statusOptions: uniqueStrings(statusOptions),
    supportsExpiration: fieldNames.some((name) => /^expires_(month|day|year)$/i.test(name)),
    supportsMenuOrder: fieldNames.includes('menu_order'),
    supportsBulkEdit: Boolean(bulkEdit),
  };
}

function detectDealerInspire(html: string, menuItems: WordPressAdminMenuItem[], postType?: string): DealerInspireAdminSignals {
  const pluginHandles = uniqueStrings(Array.from(html.matchAll(/wp-content\/(?:mu-)?plugins\/([^/"'?]+)/gi)).map((match) => match[1]))
    .filter((handle) => /\b(di|dealer|inventory|fixed|sliders?|personalization|auditor|radar|wordpress-seo|advanced-custom-fields)/i.test(handle))
    .sort();
  const productMenus = uniqueStrings(menuItems
    .filter((item) => /dealer inspire|inventory|di slides|slides|special offers|fixed ops|personalizer|wallet|forms|ldm seo|third party integrations|morgan|countdown timer/i.test(item.label))
    .map((item) => item.label));
  const adminPages = menuItems.filter((item) => item.adminPage && /dealer|di-|inventory|special|fixed|radar|offers|site-builder|third-party|lst-|countdown|group/i.test(item.adminPage));
  const jumpToSiteCount = (html.match(/wp-admin-bar-dealer_group|Jump to Site|target=(["'])blank\1[\s\S]*?wp-admin/gi) || []).length;
  const currentPostTypeKind = postType && /^(di_slide|slides|special_offers|fixed_op|inventory|staff|events|wallet|personalizer)$/i.test(postType)
    ? postType as DealerInspireAdminSignals['currentPostTypeKind']
    : postType && /di_|special|fixed|inventory|wallet|personalizer/i.test(postType)
      ? 'unknown_di_custom_type'
      : undefined;
  return {
    detected: /Dealer Inspire|dealerinspire|di-sliders|DealerInspireCommonTheme|di_slide|wp-admin-bar-di-logo/i.test(html),
    pluginHandles,
    adminPages,
    productMenus,
    jumpToSiteCount,
    currentPostTypeKind,
  };
}

export function extractWordPressAdminSourceIntelligence(
  html: string,
  options: WordPressAdminSourceIntelligenceOptions = {},
): WordPressAdminSourceIntelligence {
  const source = String(html || '');
  const canonicalUrl = sanitizeUrl(extractFirst(/<link\b[^>]*id=(["'])wp-admin-canonical\1[^>]*href=(["'])([^"']+)\2/i, source) || extractFirst(/<link\b[^>]*rel=(["'])canonical\1[^>]*href=(["'])([^"']+)\2/i, source));
  const ajaxRaw = extractFirst(/\bajaxurl\s*=\s*(["'])([^"']+)\1/i, source) || extractFirst(/"ajaxurl"\s*:\s*(["'])([^"']+)\1/i, source);
  const adminRoot = inferAdminRoot(canonicalUrl, ajaxRaw);
  const siteOrigin = safeOrigin(canonicalUrl) || safeOrigin(adminRoot);
  const bodyClasses = extractBodyClasses(source);
  const globals = {
    ajaxPath: pathAndSearch(ajaxRaw, adminRoot),
    pagenow: extractFirst(/\bpagenow\s*=\s*(["'])([^"']+)\1/i, source),
    typenow: extractFirst(/\btypenow\s*=\s*(["'])([^"']+)\1/i, source),
    adminpage: extractFirst(/\badminpage\s*=\s*(["'])([^"']+)\1/i, source),
  };
  const heading = stripTags(source.match(/<h1\b[^>]*class=(["'])[^"']*\bwp-heading-inline\b[^"']*\1[^>]*>([\s\S]*?)<\/h1>/i)?.[2] || source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  const menuItems = extractMenuItems(source, adminRoot, options.maxMenuItems || 120);
  const postType = globals.typenow || queryParamFromHref(canonicalUrl, 'post_type', adminRoot) || bodyClasses.find((item) => item.startsWith('post-type-'))?.replace(/^post-type-/, '');
  const customPostTypes = extractCustomPostTypes(menuItems);
  const postTypeLabel = customPostTypes.find((item) => item.slug === postType)?.label || heading || undefined;
  const rows = extractRows(source, adminRoot, options.maxRows || 25);
  const dealerInspire = detectDealerInspire(source, menuItems, postType);
  const nonceFieldNames = uniqueStrings(Array.from(source.matchAll(/\b(?:id|name)=(["'])([^"']*(?:nonce|_wpnonce)[^"']*)\1/gi)).map((match) => match[2]));
  const wpVersion = bodyClasses.find((item) => /^version-\d/i.test(item))?.replace(/^version-/, '').replace(/-/g, '.')
    || extractFirst(/[?&]ver=([0-9.]+)/i, source);

  return {
    sourceKind: 'wordpress_admin_source',
    isWordPressAdmin: /wp-admin|wp-core-ui|adminmenu|wpbody-content/i.test(source),
    siteOrigin,
    adminRoot,
    canonicalUrl,
    wpVersion,
    bodyClasses,
    globals,
    currentScreen: {
      heading: heading || undefined,
      postType,
      postTypeLabel,
      isListTable: /wp-list-table|id=(["'])posts-filter\1|id=(["'])the-list\2/i.test(source),
    },
    menuItems,
    customPostTypes,
    statusCounts: extractStatusCounts(source),
    columns: extractColumns(source),
    rows,
    quickEdit: extractQuickEditSummary(source),
    security: {
      hasAuthCheck: /id=(["'])wp-auth-check-wrap\1/i.test(source),
      sessionExpired: /Session expired|interim-login|wp-auth-check/i.test(source),
      hasLogoutLink: /action=logout|Log Out/i.test(source),
      hasNonceFields: nonceFieldNames.length > 0 || /\bnonce\b/i.test(source),
      nonceFieldNames,
      hasCloudflareEmailProtection: /__cf_email__|email-decode\.min\.js/i.test(source),
      redactedTransientValues: TRANSIENT_SECRET_PATTERNS,
    },
    dealerInspire,
  };
}

export function buildWordPressAdminSourceTaskHints(intel: WordPressAdminSourceIntelligence): string[] {
  const hints: string[] = [];
  if (!intel.isWordPressAdmin) {
    return ['Source does not look like a WordPress admin page; observe the current browser state before acting.'];
  }
  if (intel.adminRoot) {
    hints.push(`Use canonical admin root ${intel.adminRoot} and verify the browser origin before any credential or mutation step.`);
  }
  if (intel.security.sessionExpired) {
    hints.push('WordPress auth-check/session-expired UI is present; verify session state and stop for the user if login or MFA is required.');
  }
  if (intel.currentScreen.postType) {
    hints.push(`Current admin screen is post type ${intel.currentScreen.postType}${intel.currentScreen.postTypeLabel ? ` (${intel.currentScreen.postTypeLabel})` : ''}; prefer REST/custom-post discovery first, then wp-admin UI for plugin-only fields.`);
  }
  if (intel.dealerInspire.detected) {
    hints.push('Dealer Inspire WordPress backend detected; expect plugin/admin.php surfaces, custom post types, DI media fields, cache reload controls, and dealership-specific inventory/settings pages.');
  }
  if (intel.dealerInspire.currentPostTypeKind === 'di_slide') {
    hints.push('DI Slides list detected: collect target slide row/post id, slider assignment, desktop/mobile image fields, expiration date, publish status, clone/new-draft action, and proof screenshot before changing live slides.');
  }
  if (intel.quickEdit.supportsExpiration) {
    hints.push('Quick Edit exposes expiration fields; approval is required before changing status, schedule, expiration, order, or trash state.');
  }
  if (intel.rows.length > 0) {
    hints.push(`List table has ${intel.rows.length} sampled rows; use row title/post id/action links instead of coordinate clicks.`);
  }
  return hints;
}
