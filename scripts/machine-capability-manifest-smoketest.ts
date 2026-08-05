/**
 * Smoke test for the machine-capability manifest (QW5).
 *
 * Covers:
 *   - src/lib/localComputerAwarenessIntent.ts: LOCAL_COMPUTER_CAPABILITY_CATALOG
 *     + observe/gated-act helpers.
 *   - src/lib/chatCapabilityManifest.ts: desktop-family expansion +
 *     deep-vs-generic app support advertisement.
 *
 * Pure / tsx-loadable: both source modules only import other pure modules
 * (fileSearchQuery, knownAppShortcuts) and `import type` the runtime approval
 * enum, so this loads under tsx/esbuild without pulling react-native.
 *
 * Run: npx tsx scripts/machine-capability-manifest-smoketest.ts
 */

import {
  LOCAL_COMPUTER_CAPABILITY_CATALOG,
  getLocalComputerObserveCapabilities,
  getLocalComputerGatedActCapabilities,
  getLocalComputerObserveTools,
  getLocalComputerAwarenessRisk,
  getLocalComputerAwarenessRiskProfile,
  type LocalComputerAwarenessKind,
} from '../src/lib/localComputerAwarenessIntent';
import {
  buildDesktopCapabilityExpansion,
  describeAppDesktopSupport,
  buildCapabilityManifestPrompt,
} from '../src/lib/chatCapabilityManifest';

let passed = 0;
let failed = 0;

function check(label: string, cond: boolean): void {
  if (cond) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${label}`);
  }
}

const VALID_TIERS = new Set(['safe', 'review', 'external_side_effect']);
const VALID_FAMILIES = new Set(['observe', 'gated_act']);

// ── Catalog shape ───────────────────────────────────────────────────────────
check('catalog is a non-empty array', Array.isArray(LOCAL_COMPUTER_CAPABILITY_CATALOG) && LOCAL_COMPUTER_CAPABILITY_CATALOG.length > 0);

// Every kind appears exactly once (1:1 with the union — no drift, no dupes).
const kinds = LOCAL_COMPUTER_CAPABILITY_CATALOG.map((e) => e.kind);
check('every catalog kind is unique', new Set(kinds).size === kinds.length);

for (const entry of LOCAL_COMPUTER_CAPABILITY_CATALOG) {
  const tag = `[${entry.kind}]`;
  // Each kind carries a valid risk tier.
  check(`${tag} has a valid risk tier`, VALID_TIERS.has(entry.risk));
  // Each kind carries a valid family.
  check(`${tag} has a valid family`, VALID_FAMILIES.has(entry.family));
  // observeBefore is a string or null; freshness is a positive number or null.
  check(
    `${tag} observeBefore is string|null`,
    entry.observeBefore === null || (typeof entry.observeBefore === 'string' && entry.observeBefore.length > 0),
  );
  check(
    `${tag} freshnessMs is positive-number|null`,
    entry.freshnessMs === null || (typeof entry.freshnessMs === 'number' && entry.freshnessMs > 0),
  );
  // The catalog tier must match the live risk function for a content-free intent
  // (proves the catalog is derived from the real risk model, not hand-copied).
  const liveTier = getLocalComputerAwarenessRisk({ route: true, kind: entry.kind, reason: '' });
  check(`${tag} risk matches live risk function`, entry.risk === liveTier);
}

// ── Coordinate kinds carry observeBefore (fresh screenshot) ─────────────────
const coordinateEntries = LOCAL_COMPUTER_CAPABILITY_CATALOG.filter((e) => e.coordinate);
check('at least one coordinate kind exists', coordinateEntries.length > 0);
for (const entry of coordinateEntries) {
  check(`coordinate ${entry.kind} carries observeBefore`, typeof entry.observeBefore === 'string' && entry.observeBefore.length > 0);
  check(`coordinate ${entry.kind} observeBefore is a screenshot`, /screenshot/i.test(entry.observeBefore || ''));
  check(`coordinate ${entry.kind} has a freshness window`, typeof entry.freshnessMs === 'number' && (entry.freshnessMs as number) > 0);
  check(`coordinate ${entry.kind} is in the gated-act family`, entry.family === 'gated_act');
}
// The classic coordinate kinds must be present.
for (const k of ['mouse_click', 'mouse_drag', 'mouse_move'] as LocalComputerAwarenessKind[]) {
  check(`coordinate set includes ${k}`, coordinateEntries.some((e) => e.kind === k));
}

// ── observe vs gated-act partition ──────────────────────────────────────────
const observe = getLocalComputerObserveCapabilities();
const gated = getLocalComputerGatedActCapabilities();
check('observe family is non-empty', observe.length > 0);
check('gated-act family is non-empty', gated.length > 0);
check('observe + gated == whole catalog', observe.length + gated.length === LOCAL_COMPUTER_CAPABILITY_CATALOG.length);
check('observe and gated are disjoint', observe.every((o) => !gated.some((g) => g.kind === o.kind)));
// Read-like kinds must land in observe.
for (const k of ['screen_state', 'a11y_tree', 'file_read', 'window_state', 'clipboard'] as LocalComputerAwarenessKind[]) {
  check(`${k} is an observe capability`, observe.some((e) => e.kind === k));
}
// Mutating kinds must land in gated_act.
for (const k of ['type_text', 'file_trash', 'launch_app', 'shortcut_run', 'menu_click'] as LocalComputerAwarenessKind[]) {
  check(`${k} is a gated-act capability`, gated.some((e) => e.kind === k));
}
// Observe capabilities are read/inert: every one is 'safe' EXCEPT the inert
// 'wait' pacing primitive (which keeps its base 'review' tier for sequence
// accounting but has no side effect, so it belongs in the observe family).
check(
  'observe capabilities are safe or the inert wait timer',
  observe.every((e) => e.risk === 'safe' || e.kind === 'wait'),
);
check('no observe capability has an external side effect', observe.every((e) => e.risk !== 'external_side_effect'));

// ── observe tools ───────────────────────────────────────────────────────────
const observeTools = getLocalComputerObserveTools();
check('observe tools is non-empty', Array.isArray(observeTools) && observeTools.length > 0);
check('observe tools are de-duplicated', new Set(observeTools).size === observeTools.length);
check('observe tools include a11y tree', observeTools.includes('desktop.read_a11y_tree'));
check('observe tools include window_state', observeTools.includes('desktop.window_state'));
check('observe tools include file_read', observeTools.includes('desktop.file_read'));

// ── desktop expansion (chatCapabilityManifest) ──────────────────────────────
const expansion = buildDesktopCapabilityExpansion();
check('expansion observeTools non-empty', expansion.observeTools.length > 0);
check('expansion gatedActKinds non-empty', expansion.gatedActKinds.length > 0);
check('expansion coordinateKinds non-empty', expansion.coordinateKinds.length > 0);
check(
  'expansion risk counts sum to catalog size',
  expansion.riskCounts.safe + expansion.riskCounts.review + expansion.riskCounts.external_side_effect === LOCAL_COMPUTER_CAPABILITY_CATALOG.length,
);
check('expansion has at least one gated (review) kind', expansion.riskCounts.review > 0);
check('expansion has at least one external_side_effect kind', expansion.riskCounts.external_side_effect > 0);

// ── deep vs generic app support ─────────────────────────────────────────────
check('photoshop is deep support', describeAppDesktopSupport('edit this in Photoshop').depth === 'deep');
check('indesign is deep support', describeAppDesktopSupport('open the InDesign layout').depth === 'deep');
check('finder is deep support', describeAppDesktopSupport('open Finder').depth === 'deep');
check('figma is generic support', describeAppDesktopSupport('open Figma').depth === 'generic');
check('blender is generic support', describeAppDesktopSupport('open Blender').depth === 'generic');
check('unknown app is unknown support', describeAppDesktopSupport('open FlibbertyGibbetXYZ').depth === 'unknown');
check('deep match carries appId', describeAppDesktopSupport('Photoshop').appId === 'adobe-photoshop');

// ── prompt lists observe families + honest depth ────────────────────────────
const prompt = buildCapabilityManifestPrompt();
check('prompt still mentions tools.search', prompt.includes('tools.search'));
check('prompt lists the read-first observe menu', /Read-first/i.test(prompt));
check('prompt names a real observe tool', prompt.includes('desktop.read_a11y_tree') || prompt.includes('desktop.window_state'));
check('prompt calls out gated actions', /Gated actions/i.test(prompt));
check('prompt requires fresh screenshot for coordinate actions', /fresh screenshot/i.test(prompt) && /coordinate/i.test(prompt));
check('prompt is honest about deep vs generic support', /Photoshop\/InDesign/i.test(prompt) && /generic/i.test(prompt));

// A desktop-only allowlist still expands the desktop family.
const desktopOnly = buildCapabilityManifestPrompt({ enabledFamilies: ['desktop'] });
check('desktop-only prompt expands the read-first menu', /Read-first/i.test(desktopOnly));
check('desktop-only prompt keeps deep-vs-generic honesty', /generic/i.test(desktopOnly));

// A prompt WITHOUT the desktop family must not carry the desktop expansion lines.
const noDesktop = buildCapabilityManifestPrompt({ enabledFamilies: ['memory', 'research'] });
check('non-desktop prompt omits the read-first desktop menu', !/Read-first/i.test(noDesktop));

// ── risk profile flags (QW3 sanity, exercised via the same module) ──────────
const trashProfile = getLocalComputerAwarenessRiskProfile({ route: true, kind: 'file_trash', reason: '' });
check('file_trash profile is irreversible', trashProfile.reversible === false);
const focusProfile = getLocalComputerAwarenessRiskProfile({ route: true, kind: 'focus_app', appQuery: 'Slack', reason: '' });
check('focus_app profile is reversible', focusProfile.reversible === true);

// ── report ──────────────────────────────────────────────────────────────────
const total = passed + failed;
console.log(`\nmachine-capability-manifest smoke: ${passed}/${total} assertions passed.`);
if (failed > 0) {
  console.error(`${failed} assertion(s) FAILED.`);
  process.exit(1);
}
console.log('OK');
