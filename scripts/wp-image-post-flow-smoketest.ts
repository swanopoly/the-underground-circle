/**
 * wp-image-post-flow-smoketest — offline guard for the pure "attach images in
 * chat → post them to WordPress" glue: Dealer-Inspire-aware site URL
 * normalization, intent detection, the bounded wp.upload_media directive,
 * connect guidance, and the user-facing plan summary line.
 *
 * Run: npx tsx scripts/wp-image-post-flow-smoketest.ts
 */

import {
  normalizeWordPressSiteUrl,
  detectWordPressImagePostIntent,
  buildWpImageUploadDirective,
  buildWpConnectGuidance,
  summarizeWpImagePlanForUser,
  MAX_WP_IMAGE_DIRECTIVE_LENGTH,
  MAX_WP_DIRECTIVE_IMAGE_LINES,
  MAX_WP_CONNECT_GUIDANCE_LENGTH,
  MAX_WP_IMAGE_SUMMARY_LENGTH,
  type WpDirectiveAttachment,
} from '../src/lib/wpImagePostFlow';

let failures = 0;
function fail(m: string, detail?: string): void { failures += 1; console.error('FAIL:', m, detail ? `— ${detail}` : ''); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(name, detail);
}
function count(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

// ── normalizeWordPressSiteUrl ────────────────────────────────────────────────

// THE canonical Dealer Inspire case — subdir install, verbatim.
{
  const Example = normalizeWordPressSiteUrl('https://www.exampledealerchryslerdodgejeepramofwestpalmbeach.com/wp/wp-admin');
  assert(Example?.siteUrl === 'https://www.exampledealerchryslerdodgejeepramofwestpalmbeach.com/wp', 'normalize: Example wp-admin → /wp site base', Example?.siteUrl);
  assert(Example?.adminUrl === 'https://www.exampledealerchryslerdodgejeepramofwestpalmbeach.com/wp/wp-admin', 'normalize: Example adminUrl round-trips', Example?.adminUrl);
  assert(Example?.wasAdminUrl === true, 'normalize: Example wasAdminUrl true');
  assert(Example?.httpDowngraded !== true, 'normalize: Example not flagged httpDowngraded');
}

assert(normalizeWordPressSiteUrl('https://site.com/wp-admin/upload.php?x=1#y')?.siteUrl === 'https://site.com', 'normalize: deep wp-admin path + query + fragment stripped');
assert(normalizeWordPressSiteUrl('https://site.com/wp')?.siteUrl === 'https://site.com/wp', 'normalize: bare subdir site URL preserved');
assert(normalizeWordPressSiteUrl('https://site.com/wp')?.wasAdminUrl === false, 'normalize: bare site URL is not wasAdminUrl');
assert(normalizeWordPressSiteUrl('site.com')?.siteUrl === 'https://site.com', 'normalize: bare domain assumes https');
assert(normalizeWordPressSiteUrl('https://site.com/wp/wp-login.php')?.siteUrl === 'https://site.com/wp', 'normalize: wp-login.php keeps /wp subdir');
assert(normalizeWordPressSiteUrl('https://site.com/wp/wp-login.php')?.wasAdminUrl === true, 'normalize: wp-login counts as admin-surface URL');
assert(normalizeWordPressSiteUrl('https://site.com/wp/wp-login.php?redirect_to=%2Fwp-admin%2F')?.siteUrl === 'https://site.com/wp', 'normalize: wp-login query stripped');
assert(normalizeWordPressSiteUrl('https://site.com/wp/')?.siteUrl === 'https://site.com/wp', 'normalize: trailing slash stripped');
assert(normalizeWordPressSiteUrl('https://site.com/')?.siteUrl === 'https://site.com', 'normalize: root slash stripped');
assert(normalizeWordPressSiteUrl('https://site.com/blog/wp-admin/')?.siteUrl === 'https://site.com/blog', 'normalize: /blog subdir preserved from wp-admin URL');
assert(normalizeWordPressSiteUrl('HTTPS://SITE.COM/Blog/wp-admin')?.siteUrl === 'https://site.com/Blog', 'normalize: host lowercased, path case preserved');
assert(normalizeWordPressSiteUrl('www.site.com/wp/wp-admin')?.siteUrl === 'https://www.site.com/wp', 'normalize: scheme-less wp-admin URL accepted');
assert(normalizeWordPressSiteUrl('https://site.com/wp?p=1')?.siteUrl === 'https://site.com/wp', 'normalize: query stripped on bare site URL');
assert(normalizeWordPressSiteUrl('https://site.com:8443/wp-admin')?.siteUrl === 'https://site.com:8443', 'normalize: port preserved');

{
  const http = normalizeWordPressSiteUrl('http://site.com/wp-admin');
  assert(http?.siteUrl === 'http://site.com', 'normalize: http stays http');
  assert(http?.httpDowngraded === true, 'normalize: http flagged httpDowngraded');
}
{
  const local = normalizeWordPressSiteUrl('http://localhost:8080/wp-admin');
  assert(local?.siteUrl === 'http://localhost:8080', 'normalize: localhost (dotless) allowed');
}

// Rejections — credential-bearing URLs are REFUSED, never echoed.
assert(normalizeWordPressSiteUrl('https://admin:hunter2@site.com/wp-admin') === null, 'normalize: userinfo URL with password rejected');
assert(normalizeWordPressSiteUrl('admin@site.com') === null, 'normalize: bare userinfo@host rejected');
assert(normalizeWordPressSiteUrl('javascript:alert(1)') === null, 'normalize: javascript: scheme rejected');
assert(normalizeWordPressSiteUrl('data:text/html,hi') === null, 'normalize: data: scheme rejected');
assert(normalizeWordPressSiteUrl('https://intranet/wp-admin') === null, 'normalize: dotless non-localhost host rejected');
assert(normalizeWordPressSiteUrl('not a url') === null, 'normalize: garbage rejected');
assert(normalizeWordPressSiteUrl('') === null, 'normalize: empty rejected');
assert(normalizeWordPressSiteUrl('https://site.com/<script>') === null, 'normalize: invalid chars rejected');

// ── detectWordPressImagePostIntent ──────────────────────────────────────────

{
  const intent = detectWordPressImagePostIntent({
    text: 'get these up on https://www.exampledealerchryslerdodgejeepramofwestpalmbeach.com/wp/wp-admin please',
    imageAttachmentCount: 1,
  });
  assert(intent?.confidence === 'high', 'intent: admin URL + image → high');
  assert(intent?.siteUrl === 'https://www.exampledealerchryslerdodgejeepramofwestpalmbeach.com/wp', 'intent: siteUrl extracted + normalized to /wp base', intent?.siteUrl ?? 'null');
  assert(intent?.adminUrl === 'https://www.exampledealerchryslerdodgejeepramofwestpalmbeach.com/wp/wp-admin', 'intent: adminUrl carried');
}
{
  const intent = detectWordPressImagePostIntent({ text: 'upload these photos to my wordpress site', imageAttachmentCount: 2 });
  assert(intent?.confidence === 'high', 'intent: explicit verb+noun+target → high');
  assert(intent?.siteUrl === null, 'intent: no URL in text → siteUrl null');
  assert(intent?.adminUrl === null, 'intent: no URL in text → adminUrl null');
}
assert(detectWordPressImagePostIntent({ text: 'put these on the dealer site', imageAttachmentCount: 1 })?.confidence === 'high', 'intent: "dealer site" target → high');
{
  const intent = detectWordPressImagePostIntent({ text: 'the wordpress site needs these screenshots uploaded', imageAttachmentCount: 1 });
  assert(intent?.confidence === 'medium', 'intent: loose wording, no URL → medium', intent?.confidence ?? 'null');
  assert(intent?.siteUrl === null, 'intent: medium keeps siteUrl null');
}
assert(detectWordPressImagePostIntent({ text: 'upload these photos to my wordpress site', imageAttachmentCount: 0 }) === null, 'intent: zero image attachments → null');
assert(detectWordPressImagePostIntent({ text: 'what is wordpress', imageAttachmentCount: 1 }) === null, 'intent: "what is wordpress" → null');
assert(detectWordPressImagePostIntent({ text: 'how do I upload images to wordpress?', imageAttachmentCount: 1 }) === null, 'intent: how-do-I question → null');
assert(detectWordPressImagePostIntent({ text: 'is it possible to add photos to wordpress?', imageAttachmentCount: 1 }) === null, 'intent: capability ask → null');
assert(detectWordPressImagePostIntent({ text: 'can it upload photos to wordpress?', imageAttachmentCount: 1 }) === null, 'intent: "can it …" capability ask → null');
assert(detectWordPressImagePostIntent({ text: 'I love the wordpress ecosystem', imageAttachmentCount: 1 }) === null, 'intent: wordpress mention without upload verb → null');
assert(detectWordPressImagePostIntent({ text: '', imageAttachmentCount: 3 }) === null, 'intent: empty text → null');
assert(detectWordPressImagePostIntent({ text: 'can you upload these photos to my wordpress site', imageAttachmentCount: 1 })?.confidence === 'high', 'intent: polite "can you upload these…" is a task, not a question');
{
  const intent = detectWordPressImagePostIntent({ text: 'upload shoot.jpg photos to wordpress', imageAttachmentCount: 1 });
  assert(intent !== null && intent.siteUrl === null, 'intent: filename token not mistaken for a site URL', intent?.siteUrl ?? 'null');
}

// wantsSlide / wantsPost flags
{
  const slide = detectWordPressImagePostIntent({ text: 'upload these banners to the wordpress site as hero slides', imageAttachmentCount: 1 });
  assert(slide?.wantsSlide === true, 'intent: slide/banner/hero wording → wantsSlide');
  const post = detectWordPressImagePostIntent({ text: 'add these photos to a blog post on wordpress', imageAttachmentCount: 1 });
  assert(post?.wantsPost === true, 'intent: blog-post wording → wantsPost');
  const plain = detectWordPressImagePostIntent({ text: 'upload these images to wordpress', imageAttachmentCount: 1 });
  assert(plain?.wantsSlide === false && plain?.wantsPost === false, 'intent: plain media upload → both flags false');
}

// ── buildWpImageUploadDirective ─────────────────────────────────────────────

const EXAMPLE_DI_SITE = 'https://www.exampledealerchryslerdodgejeepramofwestpalmbeach.com/wp';
const PLACEHOLDER_RE = /onePasswordItem: <resolve via the circle's WordPress vault item — ask the user if unknown>/;

{
  const directive = buildWpImageUploadDirective({
    attachments: [
      { name: 'lot-front.png', mimeType: 'image/png', storagePath: 'chat-uploads/u1/lot-front.png' },
      { name: 'showroom.jpg', mimeType: 'image/jpeg', storagePath: 'chat-uploads/u1/showroom.jpg' },
    ],
    siteUrl: EXAMPLE_DI_SITE,
    wantsSlide: false,
    wantsPost: false,
  });
  assert(count(directive, 'wp.upload_media {') === 2, 'directive: one recipe line per image', String(count(directive, 'wp.upload_media {')));
  assert(directive.includes('storagePath: "chat-uploads/u1/lot-front.png"'), 'directive: storagePath 1 verbatim');
  assert(directive.includes('storagePath: "chat-uploads/u1/showroom.jpg"'), 'directive: storagePath 2 verbatim');
  assert(directive.includes('fileName: "lot-front.png"') && directive.includes('mimeType: "image/jpeg"'), 'directive: fileName + mimeType carried exactly');
  assert(directive.includes(`siteUrl: "${EXAMPLE_DI_SITE}"`), 'directive: known siteUrl inlined in recipe');
  assert(PLACEHOLDER_RE.test(directive), 'directive: literal "ask the user" onePasswordItem fallback present');
  assert(!/onePasswordItem:\s*"/.test(directive), 'directive: never invents a quoted onePasswordItem value');
  assert(/approval-gated WordPress write/.test(directive), 'directive: approval expectation line present');
  assert(/never publish live without explicit approval/.test(directive) && /drafts by default/.test(directive), 'directive: draft-by-default hard rule present');
  assert(/report each returned media source_url/.test(directive), 'directive: plain upload → report media URLs back');
  assert(!directive.includes('wp.create_slide') && !directive.includes('wp.update_post'), 'directive: plain upload has no slide/post follow-up');
  assert(directive.length <= MAX_WP_IMAGE_DIRECTIVE_LENGTH, 'directive: basic case within bound', String(directive.length));
}

{
  const directive = buildWpImageUploadDirective({
    attachments: [{ name: 'hero.png', mimeType: 'image/png', storagePath: 'chat-uploads/u1/hero.png' }],
    siteUrl: null,
    wantsSlide: true,
    wantsPost: true,
  });
  assert(directive.includes('siteUrl: "ASK USER"'), 'directive: unknown siteUrl → ASK USER in recipe');
  assert(/siteUrl unknown — ASK USER/.test(directive), 'directive: unknown siteUrl called out up front');
  assert(directive.includes('wp.create_slide { siteUrl, onePasswordItem, storagePath, fileName, mimeType, title, status: "draft", slideType }'), 'directive: wantsSlide → wp.create_slide follow-up with draft status');
  assert(/DRAFT post/.test(directive) && directive.includes('source_url') && directive.includes('wp.update_post'), 'directive: wantsPost → draft post embedding source_url');
  assert(directive.includes('wp.list_posts'), 'directive: wantsPost mentions wp.list_posts for targeting');
}

// 10-image clamp (12 attached → exactly 10 recipes, clamp stated).
{
  const tiny: WpDirectiveAttachment[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c'].map((s) => ({
    name: `${s}.png`,
    mimeType: 'image/png',
    storagePath: `p${s}`,
  }));
  const directive = buildWpImageUploadDirective({ attachments: tiny, siteUrl: null, wantsSlide: false, wantsPost: false });
  assert(count(directive, 'wp.upload_media {') === MAX_WP_DIRECTIVE_IMAGE_LINES, 'directive: 12 images clamp to 10 recipe lines', String(count(directive, 'wp.upload_media {')));
  assert(/First 10 of 12 images listed/.test(directive), 'directive: clamp is stated (first 10 of 12)');
  assert(/remaining 2/.test(directive), 'directive: clamp states the remainder');
  assert(directive.length <= MAX_WP_IMAGE_DIRECTIVE_LENGTH, 'directive: clamped block within 2400', String(directive.length));
  assert(!directive.includes('pc'), 'directive: 11th+ image recipes not listed');

  const ten = buildWpImageUploadDirective({ attachments: tiny.slice(0, 10), siteUrl: null, wantsSlide: false, wantsPost: false });
  assert(count(ten, 'wp.upload_media {') === 10 && !/images listed/.test(ten), 'directive: exactly 10 images → 10 recipes, no clamp note');
}

// Char-bound safety with realistic long names/paths — recipes stay whole.
{
  const long: WpDirectiveAttachment[] = Array.from({ length: 12 }, (_, i) => ({
    name: `dealership-lot-photo-2026-07-04-final-crop-${String(i + 1).padStart(2, '0')}.png`,
    mimeType: 'image/png',
    storagePath: `chat-uploads/user-1a2b3c4d5e6f/2026-07-04/dealership-lot-photo-2026-07-04-final-crop-${String(i + 1).padStart(2, '0')}.png`,
  }));
  const directive = buildWpImageUploadDirective({ attachments: long, siteUrl: EXAMPLE_DI_SITE, wantsSlide: true, wantsPost: true });
  assert(directive.length <= MAX_WP_IMAGE_DIRECTIVE_LENGTH, 'directive: long-path case within 2400', String(directive.length));
  const shown = count(directive, 'wp.upload_media {');
  assert(shown >= 1 && shown <= MAX_WP_DIRECTIVE_IMAGE_LINES, 'directive: long-path case lists 1..10 recipes', String(shown));
  assert(new RegExp(`First ${shown} of 12 images listed`).test(directive), 'directive: long-path clamp note matches shown count');
  const recipeLines = directive.split('\n').filter((l) => l.startsWith('wp.upload_media {'));
  assert(recipeLines.length === shown && recipeLines.every((l) => /^wp\.upload_media \{ siteUrl: ".+", onePasswordItem: <resolve via the circle's WordPress vault item — ask the user if unknown>, storagePath: ".+", fileName: ".+", mimeType: "image\/[a-z.+-]+" \}$/.test(l)), 'directive: every listed recipe line is complete (never truncated mid-recipe)');
}

// Non-image filtering.
{
  const directive = buildWpImageUploadDirective({
    attachments: [
      { name: 'photo.png', mimeType: 'image/png', storagePath: 'chat-uploads/u1/photo.png' },
      { name: 'specs.pdf', mimeType: 'application/pdf', storagePath: 'chat-uploads/u1/specs.pdf' },
    ],
    siteUrl: EXAMPLE_DI_SITE,
    wantsSlide: false,
    wantsPost: false,
  });
  assert(count(directive, 'wp.upload_media {') === 1, 'directive: non-image filtered out of recipes');
  assert(!directive.includes('storagePath: "chat-uploads/u1/specs.pdf"'), 'directive: pdf gets no upload recipe');
  assert(/Skipped 1 non-image attachment/.test(directive) && directive.includes('specs.pdf'), 'directive: skipped file noted by name');
}
{
  const directive = buildWpImageUploadDirective({
    attachments: [{ name: 'doc.pdf', mimeType: 'application/pdf', storagePath: 'chat-uploads/u1/doc.pdf' }],
    siteUrl: null,
    wantsSlide: false,
    wantsPost: false,
  });
  assert(count(directive, 'wp.upload_media {') === 0, 'directive: zero images → zero recipes');
  assert(/no image attachments/i.test(directive) && /Do not call wp\.upload_media/.test(directive), 'directive: zero images → honest nothing-to-upload block');
}

// ── buildWpConnectGuidance ──────────────────────────────────────────────────

const PASSWORD_SOLICITATION = /(paste|send|type|enter|share|give|tell)\s+(me\s+)?(your|the|that)\s+(application\s+)?password/i;

{
  const guidance = buildWpConnectGuidance(EXAMPLE_DI_SITE);
  assert(guidance.length <= MAX_WP_CONNECT_GUIDANCE_LENGTH, 'guidance: within 900 chars', String(guidance.length));
  assert(guidance.includes(EXAMPLE_DI_SITE), 'guidance: normalized siteUrl included');
  assert(guidance.includes(`${EXAMPLE_DI_SITE}/wp-admin`), 'guidance: adminUrl included');
  assert(guidance.includes('Application Passwords'), 'guidance: names the Application Passwords screen');
  assert(guidance.includes('Users → Profile'), 'guidance: names the wp-admin path to it');
  assert(guidance.includes('"Underground Circle"'), 'guidance: suggests the app-password name');
  assert(count(guidance, '1Password') >= 2, 'guidance: passwords live in 1Password (mentioned repeatedly)');
  assert(/item name/.test(guidance), 'guidance: asks only for the 1Password ITEM NAME');
  assert(!PASSWORD_SOLICITATION.test(guidance), 'guidance: never asks the user to put a password in chat');
  assert(!/password\s*[:?]/i.test(guidance), 'guidance: no password prompt punctuation');
  assert(/never in chat/i.test(guidance), 'guidance: says passwords never go in chat');
  assert(/browser/.test(guidance) && /approval/.test(guidance), 'guidance: browser-drive alternative with approval');
}
{
  const guidance = buildWpConnectGuidance(null);
  assert(guidance.length <= MAX_WP_CONNECT_GUIDANCE_LENGTH, 'guidance: null-site variant within 900');
  assert(guidance.includes("your site's /wp-admin") && guidance.includes('your WordPress site URL'), 'guidance: null site → generic placeholders');
  assert(!PASSWORD_SOLICITATION.test(guidance), 'guidance: null-site variant never solicits a password');
}
{
  // Raw admin URL passed straight in still renders normalized.
  const guidance = buildWpConnectGuidance('https://www.exampledealerchryslerdodgejeepramofwestpalmbeach.com/wp/wp-admin');
  assert(guidance.includes(EXAMPLE_DI_SITE) && guidance.includes(`${EXAMPLE_DI_SITE}/wp-admin`), 'guidance: raw admin URL input is normalized before display');
}

// ── summarizeWpImagePlanForUser ─────────────────────────────────────────────

{
  const line = summarizeWpImagePlanForUser({ count: 3, siteUrl: EXAMPLE_DI_SITE, wantsSlide: false, wantsPost: true });
  assert(line.startsWith('🪄'), 'summary: friendly marker prefix');
  assert(line.includes('3 images'), 'summary: image count stated');
  assert(line.includes('/wp media library'), 'summary: subdir install shown in destination', line);
  assert(!line.includes('exampledealerchryslerdodgejeepramofwestpalmbeach.com'), 'summary: 45-char host abbreviated');
  assert(line.includes('…'), 'summary: abbreviation ellipsis present');
  assert(line.includes('draft post after upload'), 'summary: wantsPost follow-up stated');
  assert(line.includes('each write needs your approval'), 'summary: approval expectation stated');
  assert(line.length <= MAX_WP_IMAGE_SUMMARY_LENGTH, 'summary: within bound', String(line.length));
}
assert(summarizeWpImagePlanForUser({ count: 1, siteUrl: 'https://site.com', wantsSlide: false, wantsPost: false }).includes('1 image →'), 'summary: singular noun for one image');
assert(summarizeWpImagePlanForUser({ count: 2, siteUrl: 'https://site.com', wantsSlide: false, wantsPost: false }).includes('media upload only'), 'summary: plain upload wording');
assert(summarizeWpImagePlanForUser({ count: 2, siteUrl: 'https://site.com', wantsSlide: true, wantsPost: true }).includes('slides + draft post after upload'), 'summary: slide+post combo wording');
assert(summarizeWpImagePlanForUser({ count: 2, siteUrl: 'https://site.com', wantsSlide: true, wantsPost: false }).includes('slides after upload'), 'summary: slide-only wording');
assert(summarizeWpImagePlanForUser({ count: 4, siteUrl: null, wantsSlide: false, wantsPost: false }).includes('site URL needed'), 'summary: null site → honest URL-needed note');
{
  const line = summarizeWpImagePlanForUser({
    count: 10,
    siteUrl: 'https://www.a-very-long-subdomain-name-for-testing-purposes.example-dealership-network.com/wp',
    wantsSlide: true,
    wantsPost: true,
  });
  assert(line.length <= MAX_WP_IMAGE_SUMMARY_LENGTH, 'summary: very long host stays within bound', String(line.length));
  assert(line.includes('…'), 'summary: very long host abbreviated');
}

// ── result ──────────────────────────────────────────────────────────────────

if (failures > 0) {
  console.error(`\n${failures} wp-image-post-flow smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll wp-image-post-flow smoke cases passed.');
