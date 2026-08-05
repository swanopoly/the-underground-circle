/**
 * wordpress-admin-source-intelligence-smoketest — offline guard for extracting
 * sanitized WordPress / Dealer Inspire admin facts from a current admin page
 * source snapshot without committing raw customer source.
 *
 * Run: npm run smoke:wordpress-admin-source-intelligence
 */

import { readFileSync } from 'fs';
import {
  buildWordPressAdminSourceTaskHints,
  extractWordPressAdminSourceIntelligence,
} from '../src/lib/wordpressAdminSourceIntelligence';

let failures = 0;

function fail(message: string): void {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string): void {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string): void {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` — ${detail}` : ''}`);
}

const dealerInspireFixture = String.raw`
<!doctype html>
<html class="wp-toolbar" lang="en-US">
<head>
  <title>DI Slides &lsaquo; Example Dealer — Dealer Inspire</title>
  <script>
    var ajaxurl = '/wp/wp-admin/admin-ajax.php',
      pagenow = 'edit-di_slide',
      typenow = 'di_slide',
      adminpage = 'edit-php';
  </script>
  <link id="wp-admin-canonical" rel="canonical" href="https://dealer.example/wp/wp-admin/edit.php?post_type=di_slide" />
  <link rel="stylesheet" href="https://dealer.example/wp-content/plugins/di-sliders/assets/css/slide.css?ver=5.9.13" />
  <script id="idpSearchServiceHelper-js-extra">var SEARCH_SERVICE = {"apiKey":"SHOULD_NOT_LEAK"};</script>
  <script id="heartbeat-js-extra">var heartbeatSettings = {"nonce":"HEARTBEAT_SHOULD_NOT_LEAK"};</script>
</head>
<body class="wp-admin wp-core-ui edit-php post-type-di_slide branch-5-9 version-5-9-13">
<ul id="adminmenu">
  <li id="menu-dashboard"><a href="index.php"><div class="wp-menu-name">Dashboard</div></a></li>
  <li id="menu-posts-di_slide"><a href="edit.php?post_type=di_slide"><div class="wp-menu-name">DI Slides</div></a>
    <ul><li><a href="edit.php?post_type=di_slide">All Slides</a></li><li><a href="post-new.php?post_type=di_slide">Add New</a></li><li><a href="edit.php?post_type=di_slider">All Sliders</a></li></ul>
  </li>
  <li id="menu-posts-inventory"><a href="edit.php?post_type=inventory&page=inventory_listview"><div class="wp-menu-name">Inventory</div></a></li>
  <li id="toplevel_page_dealerinspire-settings"><a href="admin.php?page=dealerinspire-settings"><div class="wp-menu-name">Dealer Inspire</div></a>
    <ul><li><a href="admin.php?page=di-broadcast">Broadcaster</a></li><li><a href="admin.php?page=site-builder-settings">Site Builder Settings</a></li></ul>
  </li>
</ul>
<div class="wrap">
<h1 class="wp-heading-inline">DI Slides</h1>
<ul class="subsubsub">
  <li class="all"><a href="edit.php?post_type=di_slide" class="current">All <span class="count">(233)</span></a></li>
  <li class="publish"><a href="edit.php?post_status=publish&post_type=di_slide">Published <span class="count">(17)</span></a></li>
  <li class="draft"><a href="edit.php?post_status=draft&post_type=di_slide">Drafts <span class="count">(194)</span></a></li>
</ul>
<form id="posts-filter" method="get">
<input type="hidden" id="_wpnonce" name="_wpnonce" value="NONCE_SHOULD_NOT_LEAK" />
<table class="wp-list-table widefat fixed striped table-view-list posts">
<thead><tr><td id="cb">Select</td><th id="title">Title</th><th id="slider">Assigned Slider(s)</th><th id="expiration_date">Expires</th><th id="slide_image">Desktop Image</th></tr></thead>
<tbody id="the-list">
<tr id="post-14030" class="iedit author-self level-0 post-14030 type-di_slide status-publish">
  <td class="title column-title has-row-actions column-primary page-title">
    <strong><a class="row-title" href="https://dealer.example/wp/wp-admin/post.php?post=14030&amp;action=edit" aria-label="Edit Promaster">Promaster</a></strong>
    <div class="hidden" id="inline_14030">
      <div class="post_title">Promaster</div><div class="post_name">promaster</div><div class="post_author">26</div><div class="_status">publish</div><div class="menu_order">-500</div>
    </div>
    <div class="row-actions"><span class="edit"><a href="post.php?post=14030&amp;action=edit">Edit</a> | </span><span class="inline"><button type="button">Quick Edit</button> | </span><span class="trash"><a href="post.php?post=14030&amp;action=trash&amp;_wpnonce=ROW_NONCE_SHOULD_NOT_LEAK">Trash</a> | </span><span class="clone"><a href="admin.php?action=duplicate_post_save_as_new_post&amp;post=14030">Clone</a> | </span><span class="edit_as_new_draft"><a href="admin.php?action=duplicate_post_save_as_new_post_draft&amp;post=14030">New Draft</a></span></div>
  </td>
  <td class="slider column-slider"><a href="post.php?post=11590&amp;action=edit" target="_blank">StellantisUS-1920x600</a></td>
  <td class="expiration_date column-expiration_date">2026/06/30</td>
  <td class="date column-date">Published<br />2026/06/22 at 12:55 pm</td>
  <td class="slide_image column-slide_image"><img src="https://di-uploads.example/uploads/2026/06/ram-pro.jpg" width="100%"></td>
</tr>
</tbody>
</table>
<table style="display:none"><tbody id="inlineedit">
<tr id="inline-edit" class="inline-edit-row inline-edit-di_slide">
  <td>
    <input type="text" name="post_title" />
    <select name="_status"><option value="publish">Published</option><option value="future">Scheduled</option><option value="draft">Draft</option></select>
    <input type="text" name="menu_order" />
    <select id="expires_month" name="expires_month"><option value="06">June</option></select>
    <input type="text" id="expires_day" name="expires_day" value="30" />
    <input type="text" id="expires_year" name="expires_year" value="2026" />
    <input type="hidden" id="_inline_edit" name="_inline_edit" value="INLINE_SHOULD_NOT_LEAK" />
  </td>
</tr>
<tr id="bulk-edit" class="bulk-edit-di_slide"><td><select name="_status"><option value="-1">No Change</option></select><input type="submit" name="bulk_edit" value="Update" /></td></tr>
</tbody></table>
</form>
</div>
<div id="wp-auth-check-wrap" class="hidden"><div id="wp-auth-check-form" data-src="https://dealer.example/wp/wp-login.php?interim-login=1"></div><p>Session expired</p></div>
<span class="__cf_email__" data-cfemail="EMAIL_SHOULD_NOT_LEAK">[email protected]</span>
</body>
</html>`;

const intel = extractWordPressAdminSourceIntelligence(dealerInspireFixture);
const serialized = JSON.stringify(intel);
const hints = buildWordPressAdminSourceTaskHints(intel);

assert(intel.isWordPressAdmin, 'detects WordPress admin source');
assert(intel.siteOrigin === 'https://dealer.example', 'extracts site origin', String(intel.siteOrigin));
assert(intel.adminRoot === 'https://dealer.example/wp/wp-admin/', 'extracts /wp/wp-admin root', String(intel.adminRoot));
assert(intel.globals.pagenow === 'edit-di_slide', 'extracts pagenow', String(intel.globals.pagenow));
assert(intel.globals.typenow === 'di_slide', 'extracts typenow', String(intel.globals.typenow));
assert(intel.currentScreen.heading === 'DI Slides', 'extracts current heading', String(intel.currentScreen.heading));
assert(intel.currentScreen.postType === 'di_slide', 'extracts current post type', String(intel.currentScreen.postType));
assert(intel.dealerInspire.detected, 'detects Dealer Inspire backend');
assert(intel.dealerInspire.currentPostTypeKind === 'di_slide', 'classifies DI Slides post type', String(intel.dealerInspire.currentPostTypeKind));
assert(intel.dealerInspire.pluginHandles.includes('di-sliders'), 'extracts DI plugin handles', intel.dealerInspire.pluginHandles.join(','));
assert(intel.customPostTypes.some((item) => item.slug === 'di_slide' && item.addNewUrl?.includes('post-new.php')), 'extracts custom post type add-new URL');
assert(intel.customPostTypes.some((item) => item.slug === 'inventory'), 'extracts inventory custom post type');
assert(intel.statusCounts.some((item) => item.status === 'all' && item.count === 233), 'extracts status counts');
assert(intel.columns.includes('Assigned Slider(s)'), 'extracts list-table columns');
assert(intel.rows.length === 1, 'extracts sampled post rows', String(intel.rows.length));
assert(intel.rows[0]?.postId === 14030, 'extracts row post id', String(intel.rows[0]?.postId));
assert(intel.rows[0]?.title === 'Promaster', 'extracts row title', String(intel.rows[0]?.title));
assert(intel.rows[0]?.status === 'publish', 'extracts row status', String(intel.rows[0]?.status));
assert(intel.rows[0]?.actions.includes('Clone') && intel.rows[0]?.actions.includes('New Draft'), 'extracts row actions', intel.rows[0]?.actions.join(','));
assert(intel.rows[0]?.sliderNames.includes('StellantisUS-1920x600'), 'extracts slider assignment', intel.rows[0]?.sliderNames.join(','));
assert(intel.rows[0]?.imageBasename === 'ram-pro.jpg', 'extracts image basename', String(intel.rows[0]?.imageBasename));
assert(intel.rows[0]?.expires === '2026/06/30', 'extracts expiration date', String(intel.rows[0]?.expires));
assert(intel.quickEdit.supportsExpiration, 'detects Quick Edit expiration support');
assert(intel.quickEdit.supportsMenuOrder, 'detects Quick Edit order support');
assert(intel.quickEdit.supportsBulkEdit, 'detects bulk edit support');
assert(intel.security.hasAuthCheck && intel.security.sessionExpired, 'detects auth-check/session-expired signals');
assert(intel.security.hasNonceFields, 'detects nonce fields without exposing values');
assert(intel.security.hasCloudflareEmailProtection, 'detects Cloudflare email protection');
assert(hints.some((hint) => hint.includes('DI Slides list detected')), 'builds DI Slides task hint');
assert(!serialized.includes('SHOULD_NOT_LEAK'), 'redacts API keys/nonces from parsed intelligence');
assert(!serialized.includes('EMAIL_SHOULD_NOT_LEAK'), 'redacts email protection payloads');
assert(!serialized.includes('ROW_NONCE_SHOULD_NOT_LEAK'), 'redacts row action nonce values');

// ── ReDoS guard (untrusted source must parse in bounded time) ──────────────
// A long run of word characters in a single field (title/cell/heading/label)
// previously drove the redaction email regex into O(n^2) catastrophic
// backtracking (10-30s per parse). Each of these reachable paths must stay well
// under a generous time budget regardless of the adjacent-word-char run length.
const REDOS_BUDGET_MS = 1_000;
const redosPaths: Array<[string, string]> = [
  ['long date cell', '<body class="wp-admin"><table><tbody id="the-list"><tr id="post-1"><td class="title column-title"><a class="row-title" href="x">t</a></td><td class="date column-date">' + 'z'.repeat(200_000) + '</td></tr></tbody></table>'],
  ['long h1 heading', '<body class="wp-admin"><h1>' + 'z'.repeat(200_000) + '</h1></body>'],
  ['long menu label', '<body class="wp-admin"><ul id="adminmenu"><li><a href="edit.php?post_type=x">' + 'z'.repeat(200_000) + '</a></li></ul>'],
  ['long base64-ish title', '<body class="wp-admin"><table><tbody id="the-list"><tr id="post-1"><td class="title column-title"><a class="row-title" href="x">' + 'ABCDabcd0123'.repeat(20_000) + '</a></td></tr></tbody></table>'],
];
for (const [label, redosHtml] of redosPaths) {
  const startedAt = Date.now();
  extractWordPressAdminSourceIntelligence(redosHtml);
  const elapsed = Date.now() - startedAt;
  assert(elapsed < REDOS_BUDGET_MS, `parses untrusted "${label}" in bounded time (ReDoS-safe)`, `${elapsed}ms`);
}

// Redaction of a genuine email must still work after bounding the email regex.
const emailIntel = extractWordPressAdminSourceIntelligence('<body class="wp-admin"><h1>Contact john.doe@example.com now</h1></body>');
assert(!JSON.stringify(emailIntel).includes('john.doe@example.com'), 'still redacts a real email address');

// ── Bounds: an explicit 0 cap must mean "extract none", not fall to default ──
let capFixtureMenu = '<body class="wp-admin"><ul id="adminmenu">';
for (let index = 0; index < 200; index += 1) capFixtureMenu += `<a href="edit.php?post_type=t${index}">Item ${index}</a>`;
capFixtureMenu += '</ul>';
let capFixtureRows = '<table><tbody id="the-list">';
for (let index = 1; index <= 200; index += 1) capFixtureRows += `<tr id="post-${index}" class="status-publish"><td class="title column-title"><strong><a class="row-title" href="post.php?post=${index}&action=edit">Row ${index}</a></strong></td></tr>`;
capFixtureRows += '</tbody></table>';
const capFixture = `<!doctype html><html><body class="wp-admin">${capFixtureMenu}${capFixtureRows}</body></html>`;

const zeroCaps = extractWordPressAdminSourceIntelligence(capFixture, { maxMenuItems: 0, maxRows: 0 });
assert(zeroCaps.menuItems.length === 0, 'maxMenuItems:0 extracts zero menu items (honors explicit 0)', String(zeroCaps.menuItems.length));
assert(zeroCaps.rows.length === 0, 'maxRows:0 extracts zero rows (honors explicit 0)', String(zeroCaps.rows.length));

const smallCaps = extractWordPressAdminSourceIntelligence(capFixture, { maxMenuItems: 3, maxRows: 5 });
assert(smallCaps.menuItems.length <= 3, 'maxMenuItems caps menu items', String(smallCaps.menuItems.length));
assert(smallCaps.rows.length <= 5, 'maxRows caps rows', String(smallCaps.rows.length));

const defaultCaps = extractWordPressAdminSourceIntelligence(capFixture);
assert(defaultCaps.menuItems.length <= 120, 'default menu cap still applies', String(defaultCaps.menuItems.length));
assert(defaultCaps.rows.length <= 25, 'default row cap still applies', String(defaultCaps.rows.length));

function readRepoFile(path: string): string {
  return readFileSync(path, 'utf8');
}

const browserBridgeServer = readRepoFile('scripts/browser-bridge.js');
const claudeBridge = readRepoFile('scripts/claude-bridge.js');
const browserBridgeClient = readRepoFile('src/lib/browserBridge.ts');
const openswanRuntime = readRepoFile('src/lib/openswanToolRuntime.ts');
const openswanPlanner = readRepoFile('src/lib/openswanTaskPlanner.ts');
const swanbotClient = readRepoFile('src/lib/swanbot.ts');
const swanbotV2Edge = readRepoFile('supabase/functions/swanbot-v2-ai/index.ts');

assert(browserBridgeServer.includes('async function handlePageSource'), 'browser bridge exposes a page-source handler');
// The property that matters is WHERE the read happens: page HTML is pulled
// inside the local bridge process and only a bounded excerpt crosses the wire.
// Matching the exact literal `await launched.page.content()` pinned one
// spelling, and broke when the handler was refactored to hold a single
// `pageRef` so the identity check observes the SAME page object the content was
// read from (re-reading `launched.page` could race a navigation).
assert(
  /const\s+\w+\s*=\s*await\s+\w+\.content\(\)/.test(browserBridgeServer),
  'browser bridge reads page content only inside local bridge',
);
assert(browserBridgeServer.includes('Math.min(300_000'), 'browser bridge hard-caps page-source retrieval');
assert(browserBridgeServer.includes('source: truncated ? source.slice(0, maxChars) : source'), 'browser bridge truncates raw source before responding');
assert(claudeBridge.includes("p === '/browser/page_source'") && claudeBridge.includes('handlePageSource'), 'claude bridge routes token-protected page-source endpoint');
assert(browserBridgeClient.includes('async function pageSource'), 'browserBridge keeps raw page source behind a private helper');
assert(!browserBridgeClient.includes('export async function pageSource'), 'browserBridge does not export raw page source helper');
assert(browserBridgeClient.includes('export async function readWordPressAdminSourceIntelligence'), 'browserBridge exports parsed WordPress admin intelligence');
assert(browserBridgeClient.includes('extractWordPressAdminSourceIntelligence(source.data.source'), 'browserBridge immediately parses raw source locally');
assert(!browserBridgeClient.includes('source: source.data.source'), 'browserBridge parsed intelligence result does not return raw HTML');
assert(openswanRuntime.includes("name: 'browser.wp_admin_source_intelligence'"), 'OpenSwan tool catalog includes WordPress admin source intelligence');
assert(openswanRuntime.includes("'browser.wp_admin_source_intelligence': { reads: ['browser_page'] }"), 'OpenSwan marks source intelligence as browser-page read-only dependency');
assert(openswanRuntime.includes('fenceUntrustedObservationText(untrustedLines)'), 'OpenSwan fences parsed page-derived text as untrusted');
assert(openswanPlanner.includes("| 'browser.wp_admin_source_intelligence'"), 'OpenSwan planner union includes source intelligence tool');
assert(openswanPlanner.includes("wordpress_cms:") && openswanPlanner.includes("'browser.wp_admin_source_intelligence'"), 'OpenSwan planner recommends source intelligence for WordPress work');
assert(swanbotClient.includes("case 'browser.wp_admin_source_intelligence'"), 'SwanBot client dispatcher handles source intelligence');
assert(swanbotClient.includes('dispatchBrowserWpAdminSourceIntelligence'), 'SwanBot client has source-intelligence dispatcher helper');
assert(swanbotClient.includes('rawHtmlReturned: false'), 'SwanBot client marks raw HTML as not returned');
assert(swanbotV2Edge.includes('name: "browser.wp_admin_source_intelligence"'), 'SwanBot v2 edge advertises source intelligence tool');
assert(swanbotV2Edge.includes('Never returns raw HTML') && swanbotV2Edge.includes('additionalProperties: false'), 'SwanBot v2 schema documents no raw HTML and rejects stray args');
assert(swanbotV2Edge.includes('browser.wp_admin_source_intelligence", "browser.verification_state'), 'SwanBot v2 browser group includes source intelligence');
assert(swanbotV2Edge.includes('wordpress: ["wp.discover_types", "wp.list_posts", "browser.wp_admin_source_intelligence"'), 'SwanBot v2 WordPress group prioritizes source intelligence');
// P76b moved the edge's inline selector regexes into v2ToolSelectionCore (imported by the edge fn)
const v2SelectionCore = readRepoFile('src/lib/v2ToolSelectionCore.ts');
assert(swanbotV2Edge.includes('selectToolGroups'), 'SwanBot v2 edge selects tool groups via v2ToolSelectionCore');
assert(v2SelectionCore.includes('dealer inspire|dealerinspire|di_slide|flavor_di_slides|di slides?|quick edit|expiration_date|admin\\.php|reload cache'), 'SwanBot v2 WordPress selector includes Dealer Inspire admin terms');
assert(swanbotV2Edge.includes('call **browser.wp_admin_source_intelligence** before wp-admin UI decisions'), 'SwanBot v2 prompt tells the model to use source intelligence before wp-admin UI decisions');

if (failures > 0) {
  console.error(`\n${failures} WordPress admin source intelligence smoke failure(s)`);
  process.exit(1);
}

console.log('\nAll WordPress admin source intelligence smoke cases passed.');
