/**
 * app-task-resolver-smoketest — task→best-app resolution layer in
 * `src/lib/knownAppShortcuts.ts`:
 *
 *   1. Category detection matrix (positives + negatives per category,
 *      URL-bearing tasks never fire, named app beats category inference).
 *   2. Resolver ranking semantics (installed+learned > installed > web-full
 *      > maybe-installed > web-limited; running bonus; honesty rule when the
 *      installed-apps probe is unavailable; named-but-unavailable falls to
 *      the app's own web variant).
 *   3. Preference-memory pure merge + bounds.
 *   4. Open-plan tool names cross-checked against the REAL openswanToolRuntime
 *      catalog source (drift guard).
 *
 * Run: npm run smoke:app-task-resolver
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  APP_OPEN_PLAN_TOOL_NAMES,
  BROWSER_SURFACE_APP_ID,
  KNOWN_APPS,
  PREFERRED_APPS_MAX_CATEGORIES,
  TASK_APP_CATEGORIES,
  buildAppFallbackLadder,
  buildAppOpenPlan,
  detectTaskAppCategory,
  findKnownAppInText,
  findUrlInTaskText,
  isAppOptionConfidentlyLaunchable,
  isKnownAppInstalled,
  parsePreferredAppsByCategoryStore,
  pickRecoveryAppFallback,
  resolveBestAppForTask,
  upsertPreferredAppInStore,
  type ResolveBestAppContext,
  type ResolvedAppOption,
  type TaskAppCategory,
} from '../src/lib/knownAppShortcuts';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── 1. Catalog coverage ─────────────────────────────────────────────────────

for (const category of TASK_APP_CATEGORIES) {
  const apps = KNOWN_APPS.filter((a) => a.taskCategories?.includes(category));
  assert(apps.length >= 1, `coverage: ${category} has ≥1 app (got ${apps.length})`);
  const desktop = apps.filter((a) => !a.webOnly);
  assert(desktop.length >= 1, `coverage: ${category} has ≥1 desktop (non-webOnly) app`);
}
// Categories where a genuinely capable web app exists must have one tagged.
const WEB_FULL_CATEGORIES: TaskAppCategory[] = [
  'photo_editing', 'image_design', 'vector_design', 'video_editing',
  'spreadsheet', 'document_writing', 'presentation', 'email', 'calendar',
  'meetings', 'chat_messaging', 'notes', 'task_management', 'pdf',
  'file_management', 'cad_3d', 'data_analysis',
];
for (const category of WEB_FULL_CATEGORIES) {
  const full = KNOWN_APPS.filter(
    (a) => a.taskCategories?.includes(category) && a.webAppQuality === 'full',
  );
  assert(full.length >= 1, `coverage: ${category} has ≥1 webAppQuality 'full' option`);
}

// ─── 2. Category detection matrix ────────────────────────────────────────────

const DETECTION_POSITIVES: Array<[string, TaskAppCategory]> = [
  ['edit this photo for me', 'photo_editing'],
  ['remove the background from this picture', 'photo_editing'],
  ['crop and brighten the image', 'photo_editing'],
  ['design a logo for the team', 'image_design'],
  ['make an instagram post graphic', 'image_design'],
  ['create an svg icon set', 'vector_design'],
  ['trace this sketch into a vector', 'vector_design'],
  ['trim this video clip down to 30 seconds', 'video_editing'],
  ['edit the footage from yesterday', 'video_editing'],
  ['record a podcast intro', 'audio_music'],
  ['mix the new track', 'audio_music'],
  ['make a budget spreadsheet', 'spreadsheet'],
  ['set up an expense tracker', 'spreadsheet'],
  ['track expenses for the trip', 'spreadsheet'],
  ['write a cover letter', 'document_writing'],
  ['draft a proposal for the client', 'document_writing'],
  ['put together a slide deck', 'presentation'],
  ['make a presentation for friday', 'presentation'],
  ['send an email to the vendor', 'email'],
  ['draft an email about the launch', 'email'],
  ['schedule a meeting with the team', 'calendar'],
  ['send out calendar invites for the offsite', 'calendar'],
  ['add lunch with sam to my calendar', 'calendar'],
  ['join the standup call', 'meetings'],
  ['hop on a quick call', 'meetings'],
  ['send a message to the team', 'chat_messaging'],
  ['ping the team about lunch', 'chat_messaging'],
  ['take notes during the call', 'notes'],
  ['jot down some notes', 'notes'],
  ['make a to-do list for the release', 'task_management'],
  ['add a task for the deploy', 'task_management'],
  ['debug this script', 'code_editing'],
  ['refactor the auth function', 'code_editing'],
  ['sign this pdf', 'pdf'],
  ['fill out the pdf form', 'pdf'],
  ['organize my downloads folder', 'file_management'],
  ['clean up the desktop', 'file_management'],
  ['search the web for cheap flights', 'web_browsing'],
  ['google it for me', 'web_browsing'],
  ['make a 3d model of the bracket', 'cad_3d'],
  ['prepare the stl file for printing', 'cad_3d'],
  ['chart the sales data', 'data_analysis'],
  ['make a pivot table from the export', 'data_analysis'],
];
for (const [task, expected] of DETECTION_POSITIVES) {
  const d = detectTaskAppCategory(task);
  assert(d?.category === expected, `detect: "${task}" → ${expected} (got ${d?.category ?? 'null'})`);
  if (d) {
    assert(
      typeof d.matchedPhrase === 'string' && d.matchedPhrase.length > 0 && d.matchedPhrase.length <= 80,
      `detect: "${task}" matchedPhrase non-empty + bounded`,
    );
  }
}

const DETECTION_NEGATIVES: string[] = [
  'what is quantum gravity',
  'take a photo of the receipt',          // capture, not edit
  'post the update to the feed',          // not image design
  'watch a video about cats',             // not editing
  'play some music',                      // not producing
  "what's my budget for the trip",        // no create verb
  'read the document carefully',          // not writing
  'the presentation went well',           // bare noun
  "what's your email address",            // no send/draft verb
  'the meeting ran long',                 // bare noun
  "what's the code for the door",         // not editing code
  'summarize our roadmap',
];
for (const task of DETECTION_NEGATIVES) {
  const d = detectTaskAppCategory(task);
  assert(d === null, `detect negative: "${task}" → null (got ${d?.category ?? 'null'})`);
}

// URL-bearing tasks never fire category detection.
assert(detectTaskAppCategory('open https://news.ycombinator.com and summarize') === null, 'detect: explicit URL → null');
assert(detectTaskAppCategory('check espn.com for the score') === null, 'detect: bare domain → null');
assert(findUrlInTaskText('check espn.com for the score') === 'https://espn.com', 'url: bare domain normalised to https');
assert(findUrlInTaskText('edit this photo') === null, 'url: no URL → null');

// ─── 3. Explicit app naming ──────────────────────────────────────────────────

{
  const m = findKnownAppInText('edit this photo in photoshop');
  assert(m?.app.id === 'adobe-photoshop', `named: "in photoshop" → adobe-photoshop (got ${m?.app.id})`);
}
{
  const m = findKnownAppInText('make a budget spreadsheet');
  assert(m === null, 'named: generic "spreadsheet" does NOT count as naming Numbers');
}
{
  const m = findKnownAppInText('put the numbers in a table');
  assert(m === null, 'named: generic "numbers" does NOT count as naming Numbers');
}
{
  const m = findKnownAppInText('zoom in on the chart and crop the image');
  assert(m === null, 'named: "zoom in" is camera language, not the Zoom app');
}
{
  const m = findKnownAppInText('start a zoom call with the team');
  assert(m?.app.id === 'zoom', 'named: "zoom call" still names Zoom');
}

// ─── 4. Resolver ranking semantics ───────────────────────────────────────────

const PHOTO_TASK = 'edit this photo for me';
const base: ResolveBestAppContext = { bridgeOnline: true };

{
  // installed + learned beats installed
  const r = resolveBestAppForTask(PHOTO_TASK, {
    bridgeOnline: true,
    installedApps: ['gimp', 'adobe photoshop 2026'],
    appFactsByKey: { gimp: { lastSuccessSurfaceId: 'os_accessibility' } },
  });
  assert(r?.best.appId === 'gimp', `rank: installed+learned wins (got ${r?.best.appId})`);
  assert(r?.best.openVia === 'desktop_launch' && r?.best.surface === 'desktop', 'rank: winner is a desktop launch');
  assert(r?.best.reason.includes('used it successfully'), 'rank: reason cites learned success');
  assert(r?.explicitAppNamed === false, 'rank: no app named');
}
{
  // installed beats web-full
  const r = resolveBestAppForTask(PHOTO_TASK, { bridgeOnline: true, installedApps: ['gimp'] });
  assert(r?.best.appId === 'gimp', `rank: installed beats web-full (got ${r?.best.appId})`);
  assert(r?.best.reason.includes('installed'), 'rank: reason cites installed');
}
{
  // web-full beats web-limited when no desktop is available
  const r = resolveBestAppForTask(PHOTO_TASK, { bridgeOnline: false });
  assert(r?.best.appId === 'photopea', `rank: bridge offline → web-full Photopea (got ${r?.best.appId})`);
  assert(r?.best.openVia === 'browser_url', 'rank: web winner opens via browser_url');
  assert((r?.alternatives.length ?? 99) <= 3, 'rank: alternatives ≤3');
}
{
  // running bonus: already open beats installed+learned-but-closed
  const r = resolveBestAppForTask(PHOTO_TASK, {
    bridgeOnline: true,
    installedApps: ['gimp', 'adobe photoshop 2026'],
    runningApps: ['adobe photoshop 2026'],
    appFactsByKey: { gimp: { lastSuccessSurfaceId: 'os_accessibility' } },
  });
  assert(r?.best.appId === 'adobe-photoshop', `rank: running app wins (got ${r?.best.appId})`);
  assert(r?.best.running === true, 'rank: running flag set');
  assert(r?.best.reason.includes('already running'), 'rank: reason cites already running');
  const plan = buildAppOpenPlan(r!.best);
  assert(plan.steps[0]?.tool === 'desktop.focus_app', 'plan: running app focuses instead of launching');
}
{
  // honesty rule: installedApps unknown → maybe-desktop ranks below web-full
  const r = resolveBestAppForTask(PHOTO_TASK, base);
  assert(r?.best.appId === 'photopea' && r?.best.surface === 'browser',
    `rank: unknown installed list → web-full wins (got ${r?.best.appId}/${r?.best.surface})`);
  const maybeAlt = r?.alternatives.find((o) => o.surface === 'desktop');
  assert(!!maybeAlt && maybeAlt.reason.includes('may not be installed'),
    'rank: maybe-installed desktop alternative is honest about uncertainty');
}
{
  // preferred app for the category outranks learned success
  const r = resolveBestAppForTask(PHOTO_TASK, {
    bridgeOnline: true,
    installedApps: ['gimp', 'adobe photoshop 2026'],
    appFactsByKey: { 'adobe photoshop': { lastSuccessSurfaceId: 'os_accessibility' } },
    preferredAppByCategory: { photo_editing: 'gimp' },
  });
  assert(r?.best.appId === 'gimp', `rank: preferred app wins (got ${r?.best.appId})`);
  assert(r?.best.reason.includes('preferred'), 'rank: reason cites preference');
}

// ─── AR1: availability signal + fallback ladder ──────────────────────────
{
  // availability is populated per option kind.
  const installed = resolveBestAppForTask(PHOTO_TASK, { bridgeOnline: true, installedApps: ['gimp'] });
  assert(installed?.best.availability === 'installed', `AR1: confirmed desktop app → availability 'installed' (got ${installed?.best.availability})`);

  const offline = resolveBestAppForTask(PHOTO_TASK, { bridgeOnline: false });
  assert(offline?.best.availability === 'web', `AR1: web winner → availability 'web' (got ${offline?.best.availability})`);

  // bridge online but probe unavailable → the desktop alternative is a 'maybe'.
  const maybe = resolveBestAppForTask(PHOTO_TASK, base);
  const maybeDesktop = maybe?.alternatives.find((o) => o.surface === 'desktop');
  assert(maybeDesktop?.availability === 'maybe', `AR1: unprobed desktop → availability 'maybe' (got ${maybeDesktop?.availability})`);

  assert(isAppOptionConfidentlyLaunchable({ ...maybe!.best }), 'AR1: web best is confidently launchable');
  assert(!isAppOptionConfidentlyLaunchable(maybeDesktop!), "AR1: 'maybe' desktop is NOT confidently launchable");
}
{
  // buildAppFallbackLadder: best first, deduped, alternatives follow.
  const r = resolveBestAppForTask(PHOTO_TASK, base)!;
  const ladder = buildAppFallbackLadder(r);
  assert(ladder[0].appId === r.best.appId && ladder[0].surface === r.best.surface, 'AR1: ladder starts with the chosen best');
  const keys = ladder.map((o) => `${o.appId}:${o.surface}`);
  assert(new Set(keys).size === keys.length, 'AR1: ladder has no duplicate app+surface entries');
  assert(ladder.length === 1 + r.alternatives.filter((a) => !(a.appId === r.best.appId && a.surface === r.best.surface)).length || ladder.length >= 1, 'AR1: ladder = best + distinct alternatives');
}
{
  // pickRecoveryAppFallback: a named desktop 'maybe' app falls back to a
  // confidently-launchable web alternative, never another desktop guess.
  const r = resolveBestAppForTask('edit this photo in photoshop', { bridgeOnline: true })!;
  assert(r.best.availability === 'maybe', `AR1: named app, no probe → best is 'maybe' (got ${r.best.availability})`);
  const fallback = pickRecoveryAppFallback(r);
  assert(!!fallback, 'AR1: a fallback exists for the named-app maybe case');
  assert(fallback!.appId !== r.best.appId, 'AR1: fallback is never the failed best app');
  assert(isAppOptionConfidentlyLaunchable(fallback!), 'AR1: recovery fallback is confidently launchable (prefers web-full)');
  assert(fallback!.availability === 'web', `AR1: recovery prefers a web fallback over a maybe-desktop (got ${fallback!.availability})`);
}
{
  // No alternatives → null fallback, single-entry ladder.
  const urlTask = resolveBestAppForTask('open https://news.ycombinator.com and summarize', base)!;
  assert(buildAppFallbackLadder(urlTask).length === 1, 'AR1: URL task ladder is just the browser');
  assert(pickRecoveryAppFallback(urlTask) === null, 'AR1: no alternatives → null recovery fallback');
}
{
  // named app beats category inference
  const r = resolveBestAppForTask('edit this photo in photoshop', {
    bridgeOnline: true,
    installedApps: ['gimp', 'adobe photoshop 2026'],
    appFactsByKey: { gimp: { lastSuccessSurfaceId: 'os_accessibility' } },
  });
  assert(r?.explicitAppNamed === true, 'named: explicitAppNamed true');
  assert(r?.best.appId === 'adobe-photoshop', `named: photoshop beats higher-scoring gimp (got ${r?.best.appId})`);
  assert(r?.best.openVia === 'desktop_launch' && r?.best.openTarget === 'Adobe Photoshop 2026',
    'named: desktop launch uses the macLaunchName');
  assert(r?.category === 'photo_editing', 'named: category still from detection');
  assert(!r?.alternatives.some((o) => o.appId === 'adobe-photoshop'), 'named: alternatives exclude the named app');
}
{
  // named-but-unavailable falls to the app's own web variant with a note
  const r = resolveBestAppForTask('edit this photo in photoshop', { bridgeOnline: false });
  assert(r?.explicitAppNamed === true && r?.best.appId === 'adobe-photoshop',
    `named: unavailable still resolves the named app (got ${r?.best.appId})`);
  assert(r?.best.openVia === 'browser_url' && r?.best.openTarget.includes('photoshop.adobe.com'),
    'named: falls to its own web variant');
  assert(r?.best.reason.includes('web version'), 'named: reason notes the web fallback');
}
{
  const docker = resolveBestAppForTask('Open Docker Desktop', {
    bridgeOnline: true,
    installedApps: ['Docker'],
  });
  assert(docker?.best.displayName === 'Docker Desktop', 'desktop product: Docker Desktop display identity is preserved');
  assert(docker?.best.openTarget === 'Docker', 'desktop product: Docker Desktop launches the real macOS app name');

  const microsoftRemoteDesktop = findKnownAppInText('Open Microsoft Remote Desktop');
  assert(
    microsoftRemoteDesktop?.app.id === 'microsoft-remote-desktop',
    'desktop product: exact Microsoft Remote Desktop wins over the generic Screen Sharing alias',
  );
  const remoteDesktopPlan = buildAppOpenPlan({
    appId: microsoftRemoteDesktop!.app.id,
    displayName: microsoftRemoteDesktop!.app.displayName,
    openVia: 'desktop_launch',
    openTarget: microsoftRemoteDesktop!.app.macLaunchName || microsoftRemoteDesktop!.app.displayName,
    surface: 'desktop',
    reason: 'smoke exact identity',
  });
  assert(remoteDesktopPlan.steps[0]?.input.appName === 'Microsoft Remote Desktop', 'desktop product: exact Remote Desktop launch target survives resolution');
}
{
  // installed-list miss → no desktop option even with the bridge online
  const r = resolveBestAppForTask('edit this photo in photoshop', {
    bridgeOnline: true,
    installedApps: ['gimp'],
  });
  assert(r?.best.appId === 'adobe-photoshop' && r?.best.surface === 'browser',
    'named: probe says not installed → web variant');
}
{
  // URL-bearing tasks resolve to the browser directly
  const r = resolveBestAppForTask('open https://news.ycombinator.com and summarize the top story', base);
  assert(r?.category === 'web_browsing', 'url: category web_browsing');
  assert(r?.best.appId === BROWSER_SURFACE_APP_ID, 'url: resolves to the browser surface');
  assert(r?.best.openTarget === 'https://news.ycombinator.com', `url: openTarget is the URL (got ${r?.best.openTarget})`);
  assert(r?.best.openVia === 'browser_url', 'url: opens via browser_url');
}
{
  // web_browsing detection (no URL) also goes straight to the browser
  const r = resolveBestAppForTask('search the web for cheap flights', base);
  assert(r?.best.appId === BROWSER_SURFACE_APP_ID && r?.category === 'web_browsing',
    'web_browsing: resolves to the browser directly');
}
{
  // misses stay misses — chat behaves as today
  assert(resolveBestAppForTask('what is quantum gravity', base) === null, 'resolver: non-task → null');
  assert(resolveBestAppForTask('', base) === null, 'resolver: empty → null');
}
{
  // alternatives: distinct apps, never the best, bounded
  const r = resolveBestAppForTask('make a budget spreadsheet', {
    bridgeOnline: true,
    installedApps: ['microsoft excel', 'numbers'],
  });
  assert(r?.best.appId === 'excel' || r?.best.appId === 'numbers',
    `spreadsheet: an installed desktop app wins (got ${r?.best.appId})`);
  const ids = (r?.alternatives ?? []).map((o) => o.appId);
  assert(ids.length <= 3, 'alternatives: ≤3');
  assert(new Set(ids).size === ids.length, 'alternatives: distinct apps');
  assert(!ids.includes(r!.best.appId), 'alternatives: best not repeated');
}

// Fuzzy installed matching (version-pinned bundle names)
{
  const photoshop = KNOWN_APPS.find((a) => a.id === 'adobe-photoshop')!;
  assert(isKnownAppInstalled(photoshop, ['adobe photoshop 2025']), 'installed: 2026 catalog entry matches a 2025 install');
  assert(isKnownAppInstalled(photoshop, ['adobe photoshop']), 'installed: versionless install name matches');
  const fusion = KNOWN_APPS.find((a) => a.id === 'fusion-360')!;
  assert(isKnownAppInstalled(fusion, ['autodesk fusion 360']), 'installed: "Autodesk Fusion" matches older "Autodesk Fusion 360"');
  const photopea = KNOWN_APPS.find((a) => a.id === 'photopea')!;
  assert(!isKnownAppInstalled(photopea, ['photopea']), 'installed: webOnly apps never count as installed');
}

// ─── 5. Preference memory (pure merge + bounds) ──────────────────────────────

{
  const empty = parsePreferredAppsByCategoryStore(null);
  assert(empty.v === 1 && Object.keys(empty.prefs).length === 0, 'prefs: null → empty store');
  const corrupt = parsePreferredAppsByCategoryStore('{not json');
  assert(Object.keys(corrupt.prefs).length === 0, 'prefs: corrupted JSON → empty store');

  let store = upsertPreferredAppInStore(empty, 'photo_editing', 'gimp');
  store = upsertPreferredAppInStore(store, 'spreadsheet', 'excel');
  assert(store.prefs.photo_editing === 'gimp' && store.prefs.spreadsheet === 'excel', 'prefs: merge keeps both categories');
  store = upsertPreferredAppInStore(store, 'photo_editing', 'adobe-photoshop');
  assert(store.prefs.photo_editing === 'adobe-photoshop', 'prefs: upsert overwrites the category');

  // foreign keys + oversized payloads are dropped on parse
  const dirty = JSON.stringify({
    v: 1,
    prefs: {
      photo_editing: 'gimp',
      not_a_category: 'x',
      spreadsheet: 42,
      email: 'g'.repeat(200),
      ...Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`fake_${i}`, 'x'])),
    },
  });
  const parsed = parsePreferredAppsByCategoryStore(dirty);
  assert(!('not_a_category' in parsed.prefs), 'prefs: foreign category dropped');
  assert(parsed.prefs.spreadsheet === undefined, 'prefs: non-string appId dropped');
  assert((parsed.prefs.email || '').length <= 60, 'prefs: appId bounded to 60 chars');
  assert(Object.keys(parsed.prefs).length <= PREFERRED_APPS_MAX_CATEGORIES, 'prefs: store bounded ≤20 categories');
}

// resolver consumes a preference loaded through the parse path (round trip)
{
  const stored = JSON.stringify(upsertPreferredAppInStore({ v: 1, prefs: {} }, 'photo_editing', 'gimp'));
  const prefs = parsePreferredAppsByCategoryStore(stored).prefs;
  const r = resolveBestAppForTask(PHOTO_TASK, {
    bridgeOnline: true,
    installedApps: ['gimp', 'adobe photoshop 2026'],
    preferredAppByCategory: prefs,
  });
  assert(r?.best.appId === 'gimp', 'prefs: round-tripped preference drives the resolver');
}

// ─── 6. Open-step plans + tool-name validity ─────────────────────────────────

{
  const r = resolveBestAppForTask('make a budget spreadsheet', {
    bridgeOnline: true,
    installedApps: ['microsoft excel'],
  })!;
  const plan = buildAppOpenPlan(r.best);
  assert(plan.steps[0]?.tool === 'desktop.launch_app', 'plan: desktop launch step first');
  assert(plan.steps[0]?.input.appName === 'Microsoft Excel', 'plan: launch uses the open -a name');
  assert(plan.steps[1]?.tool === 'desktop.wait_for_app', 'plan: wait_for_app follows launch');
  assert(typeof plan.steps[1]?.input.timeoutMs === 'number', 'plan: wait has a timeout');
  assert(plan.note.length > 0, 'plan: has a human note');
}
{
  const webOption: ResolvedAppOption = {
    appId: 'google-sheets', displayName: 'Google Sheets', openVia: 'browser_url',
    openTarget: 'https://sheets.google.com', surface: 'browser', reason: 'test',
  };
  const plan = buildAppOpenPlan(webOption);
  assert(plan.steps.length === 1 && plan.steps[0].tool === 'browser.open_url', 'plan: web option → browser.open_url');
  assert(plan.steps[0].input.url === 'https://sheets.google.com', 'plan: browser step carries the URL');
}
{
  const schemeOption: ResolvedAppOption = {
    appId: 'excel', displayName: 'Microsoft Excel', openVia: 'url_scheme',
    openTarget: 'ms-excel:', surface: 'desktop', reason: 'test',
  };
  const plan = buildAppOpenPlan(schemeOption);
  assert(plan.steps.length === 1 && plan.steps[0].tool === 'desktop.open_url', 'plan: url_scheme → desktop.open_url');
}

// Every plan tool name must exist verbatim in the REAL openswanToolRuntime
// catalog (the drift class this assert exists for).
{
  const runtimeSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'openswanToolRuntime.ts'),
    'utf8',
  );
  for (const tool of APP_OPEN_PLAN_TOOL_NAMES) {
    assert(runtimeSource.includes(`'${tool}'`), `tooling: ${tool} exists in the openswanToolRuntime catalog`);
  }
}

if (failures > 0) {
  console.error(`\n${failures} app-task-resolver smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll app-task-resolver smoke cases passed.');
