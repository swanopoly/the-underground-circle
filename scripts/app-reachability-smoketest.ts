/**
 * Smoke: live app-reachability classifier — "can chat actually reach and
 * automate app X right now?" from injected probe results.
 *
 *   npx tsx scripts/app-reachability-smoketest.ts
 *
 * Pins: the full status ladder (every status reachable via crafted inputs),
 * the REAL stale-bridge case seen on this Mac (bridge online but its health
 * tool list predates 'cad_compile' → bridge_outdated naming the command),
 * fuzzy running/frontmost matching ('Adobe Photoshop 2026' vs 'Photoshop'),
 * web-app short-circuit skipping bridge checks, skipped-probe handling,
 * bounded chat copy containing the fix, garbage tolerance, stable check
 * order, and chatCanFix only for launch/focus.
 */
import {
  buildAppReachabilityReport,
  describeAppReachabilityForChat,
  requiredBridgeCommandsForDocSlug,
  REQUIRED_BRIDGE_COMMANDS_BY_DOC_SLUG,
  DEFAULT_REQUIRED_BRIDGE_COMMANDS,
  type AppReachabilityReport,
  type AppReachabilityStatus,
} from '../src/lib/appReachability';
import { resolveAppAutomationDoc } from '../src/lib/appAutomationDocsIndex';

let passed = 0;
function assert(cond: unknown, label: string, detail?: unknown) {
  if (!cond) {
    console.error(`FAIL: ${label}${detail !== undefined ? ` — ${JSON.stringify(detail)}` : ''}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`pass: ${label}`);
}
const deepEq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// Captured from the live stale bridge on this Mac: started before the newest
// endpoints, so it lists 'photoshop_document_status' but NOT 'cad_compile',
// 'photoshop_apply_adjustment_layer', or 'illustrator_document_status'.
const STALE_BRIDGE_TOOLS = [
  'launch',
  'focus',
  'a11y_tree',
  'screenshot',
  'applescript',
  'photoshop_document_status',
  'observe_app',
];
const FRESH_BRIDGE_TOOLS = [
  ...STALE_BRIDGE_TOOLS,
  'cad_compile',
  'photoshop_apply_adjustment_layer',
  'photoshop_layer_inventory',
  'illustrator_document_status',
  'indesign_document_status',
];

const figmaDoc = resolveAppAutomationDoc('figma');
const onshapeDoc = resolveAppAutomationDoc('onshape');
const photoshopDoc = resolveAppAutomationDoc('photoshop');
const freecadDoc = resolveAppAutomationDoc('freecad');
assert(figmaDoc?.status === 'web_only', 'fixture: figma doc resolves web_only');
assert(onshapeDoc?.status === 'cloud_service', 'fixture: onshape doc resolves cloud_service');
assert(photoshopDoc?.status === 'executable', 'fixture: photoshop doc resolves executable');
assert(freecadDoc?.status === 'executable', 'fixture: freecad doc resolves executable');

const EXPECTED_CHECK_ORDER = ['route', 'bridge_online', 'bridge_commands', 'installed', 'running', 'frontmost', 'a11y'];
const VALID_STATUSES: AppReachabilityStatus[] = [
  'reachable', 'needs_launch', 'needs_focus', 'bridge_offline', 'bridge_outdated',
  'not_installed', 'a11y_blocked', 'web_app', 'unknown',
];
const checkById = (r: AppReachabilityReport, id: string) => r.checks.find((c) => c.id === id);

// ── a. web_app short-circuit (bridge checks skipped even with bridge offline) ──
const webReport = buildAppReachabilityReport({
  appName: 'Figma',
  bridgeOnline: false, // would be bridge_offline if the short-circuit failed
  bridgeToolNames: [],
  requiredBridgeCommands: ['a11y_tree'],
  appDoc: figmaDoc,
});
assert(webReport.status === 'web_app', 'web_only doc → web_app', webReport.status);
assert(webReport.firstBlocker === null, 'web_app has no blocker');
assert(webReport.userAction === null, 'web_app userAction is null');
assert(webReport.chatCanFix === false, 'web_app chatCanFix false');
assert(webReport.docPath === 'docs/apps/figma.md', 'web_app carries docPath');
assert(checkById(webReport, 'bridge_online')?.outcome === 'skipped', 'web_app skips bridge_online even when offline');
assert(checkById(webReport, 'bridge_commands')?.outcome === 'skipped', 'web_app skips bridge_commands');
assert(checkById(webReport, 'a11y')?.outcome === 'skipped', 'web_app skips a11y');
assert(/browser/i.test(checkById(webReport, 'route')?.detail ?? ''), 'route detail notes browser pipeline');
const cloudReport = buildAppReachabilityReport({ appName: 'Onshape', bridgeOnline: true, appDoc: onshapeDoc });
assert(cloudReport.status === 'web_app', 'cloud_service doc → web_app', cloudReport.status);

// ── b. bridge_offline ───────────────────────────────────────────────────────
const offline = buildAppReachabilityReport({
  appName: 'Photoshop',
  bridgeOnline: false,
  appDoc: photoshopDoc,
  installed: { installed: true, resolvedName: 'Adobe Photoshop 2026' },
});
assert(offline.status === 'bridge_offline', 'bridge offline → bridge_offline', offline.status);
assert(offline.firstBlocker?.fix === 'Start the desktop bridge: npm run bridge', 'offline fix is the exact npm run bridge command');
assert(offline.userAction === offline.firstBlocker?.fix, 'userAction mirrors first blocker fix');
assert(checkById(offline, 'installed')?.outcome === 'skipped', 'checks after offline bridge are skipped');
assert(offline.resolvedAppName === 'Adobe Photoshop 2026', 'resolvedAppName prefers install probe name');

// ── c. REAL stale-bridge case: online but predates cad_compile ──────────────
const staleFreecad = buildAppReachabilityReport({
  appName: 'FreeCAD',
  bridgeOnline: true,
  bridgeToolNames: STALE_BRIDGE_TOOLS,
  requiredBridgeCommands: requiredBridgeCommandsForDocSlug('freecad'), // ['cad_compile']
  appDoc: freecadDoc,
  installed: { installed: true, resolvedName: 'FreeCAD' },
  runningApps: ['Finder', 'Terminal'],
});
assert(staleFreecad.status === 'bridge_outdated', 'stale bridge (no cad_compile) → bridge_outdated', staleFreecad.status);
assert((staleFreecad.firstBlocker?.detail ?? '').includes('cad_compile'), 'outdated detail names the missing command');
assert(/older build/.test(staleFreecad.firstBlocker?.fix ?? ''), 'outdated fix says older build');
assert((staleFreecad.firstBlocker?.fix ?? '').includes('npm run bridge'), 'outdated fix says restart via npm run bridge');
assert(checkById(staleFreecad, 'bridge_online')?.outcome === 'pass', 'stale bridge still passes bridge_online');
assert(checkById(staleFreecad, 'running')?.outcome === 'skipped', 'ladder stops at outdated bridge (running skipped)');
assert(staleFreecad.chatCanFix === false, 'bridge_outdated is not chat-fixable');

// Same stale bridge against Photoshop: has photoshop_document_status but lacks
// photoshop_layer_inventory — missing list must name only the missing one.
const stalePhotoshop = buildAppReachabilityReport({
  appName: 'Photoshop',
  bridgeOnline: true,
  bridgeToolNames: STALE_BRIDGE_TOOLS,
  requiredBridgeCommands: requiredBridgeCommandsForDocSlug('photoshop'),
  appDoc: photoshopDoc,
});
assert(stalePhotoshop.status === 'bridge_outdated', 'stale bridge missing photoshop_layer_inventory → bridge_outdated');
assert((stalePhotoshop.firstBlocker?.detail ?? '').includes('photoshop_layer_inventory'), 'missing list names photoshop_layer_inventory');
assert(!(stalePhotoshop.firstBlocker?.detail ?? '').includes('photoshop_document_status'), 'missing list omits commands the bridge already has');

// Missing-command list is bounded to 6 shown.
const manyMissing = buildAppReachabilityReport({
  appName: 'X',
  bridgeOnline: true,
  bridgeToolNames: [],
  requiredBridgeCommands: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'],
});
assert(manyMissing.status === 'bridge_outdated', 'empty tool list with requirements → bridge_outdated');
const manyDetail = manyMissing.firstBlocker?.detail ?? '';
assert(manyDetail.includes('c6') && !manyDetail.includes('c7'), 'missing-command list bounded to 6 shown', manyDetail);
assert(manyDetail.includes('+2 more'), 'bounded list counts the hidden commands', manyDetail);

// Fresh bridge passes the same requirements.
const freshCommands = buildAppReachabilityReport({
  appName: 'FreeCAD',
  bridgeOnline: true,
  bridgeToolNames: FRESH_BRIDGE_TOOLS,
  requiredBridgeCommands: ['cad_compile'],
});
assert(freshCommands.status === 'reachable', 'fresh bridge with cad_compile → reachable', freshCommands.status);
assert(checkById(freshCommands, 'bridge_commands')?.outcome === 'pass', 'fresh bridge passes bridge_commands');

// ── d. not_installed ────────────────────────────────────────────────────────
const notInstalledCli = buildAppReachabilityReport({
  appName: 'FreeCAD',
  bridgeOnline: true,
  bridgeToolNames: FRESH_BRIDGE_TOOLS,
  requiredBridgeCommands: ['cad_compile'],
  appDoc: freecadDoc,
  installed: { installed: false },
});
assert(notInstalledCli.status === 'not_installed', 'installed:false → not_installed', notInstalledCli.status);
assert((notInstalledCli.firstBlocker?.fix ?? '').includes('FreeCAD'), 'not_installed fix names the app');
assert(/command-line engine/.test(notInstalledCli.firstBlocker?.fix ?? ''), 'CLI-engine app gets the engine install hint');
const notInstalledGeneric = buildAppReachabilityReport({
  appName: 'Obscurify',
  bridgeOnline: true,
  installed: { installed: false },
});
assert(notInstalledGeneric.status === 'not_installed', 'generic app installed:false → not_installed');
assert((notInstalledGeneric.firstBlocker?.fix ?? '').includes('Install Obscurify'), 'generic install fix stays generic');
assert(!/command-line engine/.test(notInstalledGeneric.firstBlocker?.fix ?? ''), 'generic install fix has no CLI-engine hint');

// ── e. needs_launch + fuzzy running matching ────────────────────────────────
const psBase = {
  appName: 'Photoshop',
  bridgeOnline: true,
  bridgeToolNames: FRESH_BRIDGE_TOOLS,
  requiredBridgeCommands: requiredBridgeCommandsForDocSlug('photoshop'),
  appDoc: photoshopDoc,
  installed: { installed: true, resolvedName: 'Adobe Photoshop 2026' },
};
const needsLaunch = buildAppReachabilityReport({ ...psBase, runningApps: ['Finder', 'Google Chrome'] });
assert(needsLaunch.status === 'needs_launch', 'app absent from runningApps → needs_launch', needsLaunch.status);
assert(needsLaunch.chatCanFix === true, 'needs_launch is chat-fixable');
assert((needsLaunch.firstBlocker?.fix ?? '').includes('desktop.launch_app'), 'launch fix names desktop.launch_app');
assert((needsLaunch.firstBlocker?.fix ?? '').includes('approval'), 'launch fix requires approval');
assert(checkById(needsLaunch, 'frontmost')?.outcome === 'skipped', 'frontmost skipped after needs_launch');

const fuzzyRunning = buildAppReachabilityReport({
  ...psBase,
  runningApps: ['Finder', 'Adobe Photoshop 2026'],
  windowState: { frontmostApp: 'Adobe Photoshop 2026', appHasWindow: true },
  a11yProbe: { ok: true, nodeCount: 412 },
});
assert(fuzzyRunning.status === 'reachable', "fuzzy match 'Adobe Photoshop 2026' vs 'Photoshop' → reachable", fuzzyRunning.status);
assert((checkById(fuzzyRunning, 'running')?.detail ?? '').includes('Adobe Photoshop 2026'), 'running detail names the matched process');
assert(fuzzyRunning.firstBlocker === null && fuzzyRunning.userAction === null, 'reachable has no blocker or user action');
assert(fuzzyRunning.checks.every((c) => c.outcome === 'pass'), 'full-probe reachable passes all seven checks');
assert(fuzzyRunning.checks.every((c) => c.label.length > 0 && c.detail.length > 0), 'every check has label and detail');

// Reverse direction: caller name longer than the process name.
const reverseFuzzy = buildAppReachabilityReport({
  appName: 'Adobe Photoshop 2026',
  bridgeOnline: true,
  runningApps: ['Photoshop'],
});
assert(checkById(reverseFuzzy, 'running')?.outcome === 'pass', 'fuzzy match works in both directions');
// Match via installed.resolvedName when appName alone would never match.
const resolvedNameFuzzy = buildAppReachabilityReport({
  appName: 'PS',
  bridgeOnline: true,
  installed: { installed: true, resolvedName: 'Adobe Photoshop 2026' },
  runningApps: ['Adobe Photoshop 2026'],
});
assert(resolvedNameFuzzy.status === 'reachable', 'running match via installed.resolvedName', resolvedNameFuzzy.status);

// ── f. needs_focus ──────────────────────────────────────────────────────────
const needsFocus = buildAppReachabilityReport({
  ...psBase,
  runningApps: ['Adobe Photoshop 2026'],
  windowState: { frontmostApp: 'Google Chrome', appHasWindow: true },
});
assert(needsFocus.status === 'needs_focus', 'frontmost mismatch → needs_focus', needsFocus.status);
assert(needsFocus.chatCanFix === true, 'needs_focus is chat-fixable');
assert((needsFocus.firstBlocker?.fix ?? '').includes('desktop.focus_app'), 'focus fix names desktop.focus_app');
assert(checkById(needsFocus, 'a11y')?.outcome === 'skipped', 'a11y skipped after needs_focus');

// ── g. a11y_blocked ─────────────────────────────────────────────────────────
const a11yBlocked = buildAppReachabilityReport({
  ...psBase,
  runningApps: ['Adobe Photoshop 2026'],
  windowState: { frontmostApp: 'Adobe Photoshop 2026' },
  a11yProbe: { ok: false, error: 'AXError: not trusted' },
});
assert(a11yBlocked.status === 'a11y_blocked', 'failed a11y read → a11y_blocked', a11yBlocked.status);
assert((a11yBlocked.firstBlocker?.detail ?? '').includes('AXError'), 'a11y detail carries the probe error');
const a11yFix = a11yBlocked.firstBlocker?.fix ?? '';
assert(a11yFix.includes('Privacy & Security') && a11yFix.includes('Accessibility'), 'a11y fix points at macOS TCC settings');
assert(/macOS update/.test(a11yFix) && /restart/i.test(a11yFix), 'a11y fix warns about stale grants + bridge restart');
const a11yEmpty = buildAppReachabilityReport({ ...psBase, a11yProbe: { ok: true, nodeCount: 0 } });
assert(a11yEmpty.status === 'a11y_blocked', 'ok:true but 0 nodes → a11y_blocked', a11yEmpty.status);
assert(a11yEmpty.chatCanFix === false, 'a11y_blocked is not chat-fixable');

// ── h/unknown + skipped-probe handling ──────────────────────────────────────
const unknownReport = buildAppReachabilityReport({ appName: 'Mystery', bridgeOnline: true });
assert(unknownReport.status === 'unknown', 'bridge online + no probes at all → unknown', unknownReport.status);
assert(unknownReport.firstBlocker === null && unknownReport.userAction === null, 'unknown has no blocker/action');
assert(checkById(unknownReport, 'bridge_online')?.outcome === 'pass', 'unknown still records bridge_online pass');
const toolsOnly = buildAppReachabilityReport({ appName: 'Mystery', bridgeOnline: true, bridgeToolNames: STALE_BRIDGE_TOOLS });
assert(toolsOnly.status === 'reachable', 'any probe beyond bridgeOnline → not unknown', toolsOnly.status);

const partialProbes = buildAppReachabilityReport({
  appName: 'Photoshop',
  bridgeOnline: true,
  bridgeToolNames: FRESH_BRIDGE_TOOLS,
  requiredBridgeCommands: requiredBridgeCommandsForDocSlug('photoshop'),
  installed: { installed: true },
});
assert(partialProbes.status === 'reachable', 'missing probes never fail the ladder', partialProbes.status);
assert(
  ['running', 'frontmost', 'a11y'].every((id) => checkById(partialProbes, id)?.outcome === 'skipped'),
  'unprovided probes are skipped, not failed',
);
const requiredOnly = buildAppReachabilityReport({
  appName: 'Photoshop',
  bridgeOnline: true,
  requiredBridgeCommands: ['cad_compile'],
});
assert(checkById(requiredOnly, 'bridge_commands')?.outcome === 'skipped', 'required commands without a health tool list → skipped');
const nullFrontmost = buildAppReachabilityReport({
  appName: 'Photoshop',
  bridgeOnline: true,
  runningApps: ['Adobe Photoshop 2026'],
  windowState: { frontmostApp: null },
});
assert(checkById(nullFrontmost, 'frontmost')?.outcome === 'skipped', 'windowState with null frontmostApp → skipped');
assert(nullFrontmost.status === 'reachable', 'null frontmost probe does not block reachability');

// ── Check order stability ───────────────────────────────────────────────────
for (const report of [webReport, offline, staleFreecad, fuzzyRunning, unknownReport]) {
  assert(
    deepEq(report.checks.map((c) => c.id), EXPECTED_CHECK_ORDER),
    `check order stable (${report.status})`,
    report.checks.map((c) => c.id),
  );
}

// ── chatCanFix only for launch/focus + describe bounds across the matrix ────
const matrix: AppReachabilityReport[] = [
  webReport, cloudReport, offline, staleFreecad, stalePhotoshop, manyMissing, freshCommands,
  notInstalledCli, notInstalledGeneric, needsLaunch, fuzzyRunning, reverseFuzzy, resolvedNameFuzzy,
  needsFocus, a11yBlocked, a11yEmpty, unknownReport, toolsOnly, partialProbes, nullFrontmost,
];
assert(
  matrix.every((r) => r.chatCanFix === (r.status === 'needs_launch' || r.status === 'needs_focus')),
  'chatCanFix true only for needs_launch/needs_focus across the whole matrix',
);
assert(
  matrix.every((r) => VALID_STATUSES.includes(r.status)),
  'every matrix report has a valid status',
);
for (const report of [offline, staleFreecad, notInstalledCli, needsLaunch, needsFocus, a11yBlocked]) {
  const text = describeAppReachabilityForChat(report);
  assert(
    text.length <= 600 && report.userAction !== null && text.includes(report.userAction),
    `describe(${report.status}) ≤600 chars and contains the fix (${text.length})`,
  );
}
assert(
  matrix.every((r) => describeAppReachabilityForChat(r).length <= 600),
  'describe bounded ≤600 chars for every matrix report',
);
const launchText = describeAppReachabilityForChat(needsLaunch);
assert(launchText.includes('✗') && launchText.includes('✓'), 'describe shows pass/fail marks');
assert((launchText.match(/desktop\./g) ?? []).length === 1, 'describe names at most one tool (chatCanFix case)');
const reachableText = describeAppReachabilityForChat(fuzzyRunning);
assert(/reachable/i.test(reachableText) && !reachableText.includes('Next step'), 'reachable describe has no next step');
assert(/browser/i.test(describeAppReachabilityForChat(webReport)), 'web_app describe mentions the browser route');

// ── Never throws on garbage inputs ──────────────────────────────────────────
const garbageInputs: unknown[] = [
  null,
  undefined,
  {},
  { appName: 42, bridgeOnline: 'yes' },
  {
    appName: 'X',
    bridgeOnline: true,
    bridgeToolNames: [1, null, {}, 'a11y_tree'],
    requiredBridgeCommands: {},
    installed: { installed: 'no' },
    runningApps: 'Photoshop',
    windowState: 'front',
    a11yProbe: { ok: 'true', nodeCount: 'lots' },
  },
  { appName: 'X', bridgeOnline: true, appDoc: { status: 'weird' } },
  { appName: '', bridgeOnline: false, runningApps: [null, 7] },
];
for (let i = 0; i < garbageInputs.length; i += 1) {
  let report: AppReachabilityReport | null = null;
  let threw = false;
  try {
    report = buildAppReachabilityReport(garbageInputs[i] as never);
    describeAppReachabilityForChat(report);
  } catch {
    threw = true;
  }
  assert(!threw && report !== null && VALID_STATUSES.includes(report.status), `garbage input #${i} handled without throwing`);
}
let describeThrew = false;
try {
  describeAppReachabilityForChat(null as never);
  describeAppReachabilityForChat({ status: 'zzz', checks: [null, { id: 9 }] } as never);
} catch {
  describeThrew = true;
}
assert(!describeThrew, 'describe never throws on garbage reports');

// ── Required-command map exports ────────────────────────────────────────────
assert(
  deepEq(REQUIRED_BRIDGE_COMMANDS_BY_DOC_SLUG.photoshop, ['photoshop_document_status', 'photoshop_layer_inventory']),
  'map: photoshop commands',
);
assert(deepEq(REQUIRED_BRIDGE_COMMANDS_BY_DOC_SLUG.indesign, ['indesign_document_status']), 'map: indesign commands');
assert(deepEq(REQUIRED_BRIDGE_COMMANDS_BY_DOC_SLUG.illustrator, ['illustrator_document_status', 'illustrator_text_inventory']), 'map: illustrator commands');
for (const slug of ['freecad', 'openscad', 'blender']) {
  assert(deepEq(REQUIRED_BRIDGE_COMMANDS_BY_DOC_SLUG[slug], ['cad_compile']), `map: ${slug} uses cad_compile`);
}
assert(deepEq(REQUIRED_BRIDGE_COMMANDS_BY_DOC_SLUG.autocad, ['a11y_tree']), 'map: autocad commands');
assert(deepEq(DEFAULT_REQUIRED_BRIDGE_COMMANDS, ['a11y_tree', 'screenshot']), 'default desktop commands');
assert(deepEq(requiredBridgeCommandsForDocSlug('sketch'), DEFAULT_REQUIRED_BRIDGE_COMMANDS), 'helper falls back to default for unmapped slug');
assert(deepEq(requiredBridgeCommandsForDocSlug(null), DEFAULT_REQUIRED_BRIDGE_COMMANDS), 'helper falls back to default for null');
const copyA = requiredBridgeCommandsForDocSlug('freecad');
copyA.push('mutated');
assert(deepEq(requiredBridgeCommandsForDocSlug('freecad'), ['cad_compile']), 'helper returns copies, exports stay unmutated');

console.log(`\nAll app-reachability smoke cases passed (${passed} assertions).`);
