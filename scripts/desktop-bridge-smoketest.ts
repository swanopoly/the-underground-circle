/**
 * desktop-bridge-smoketest — covers the pure protocol helpers in
 * `src/lib/desktopBridgeProtocol.ts`. The live HTTP client in
 * `desktopBridge.ts` needs a running bridge + paired token; that gets
 * integration-tested manually.
 *
 * Run: npm run smoke:desktop-bridge
 */

import * as fs from 'node:fs';
import { execSync } from 'node:child_process';

import {
  parseKeyCombo,
  escapeAppleScriptString,
  isValidAppName,
  validateDesktopUrl,
  validateDesktopPath,
  validateClickCoords,
  DESKTOP_MODIFIERS,
  DESKTOP_NAMED_KEYS,
  DESKTOP_PUNCTUATION_KEYS,
} from '../src/lib/desktopBridgeProtocol';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

// ─── parseKeyCombo — good cases ────────────────────────────────────────
{
  const r = parseKeyCombo('Cmd+T');
  assert(r.ok, 'combo: Cmd+T parses');
  if (r.ok) {
    assert(r.modifiers.length === 1 && r.modifiers[0] === 'cmd', 'combo: Cmd+T single modifier');
    assert(r.key === 'T', 'combo: Cmd+T key = T');
  }
}
{
  const r = parseKeyCombo('Cmd+Shift+N');
  assert(r.ok, 'combo: Cmd+Shift+N parses');
  if (r.ok) {
    assert(r.modifiers.length === 2, 'combo: two modifiers');
    assert(r.key === 'N', 'combo: key = N');
  }
}
{
  const r = parseKeyCombo('Return');
  assert(r.ok, 'combo: bare Return parses');
  if (r.ok) assert(r.modifiers.length === 0, 'combo: Return has no modifiers');
}
{
  const r = parseKeyCombo('Cmd+Escape');
  assert(r.ok, 'combo: Cmd+Escape parses (named key)');
}
{
  const r = parseKeyCombo('  Cmd  +  Shift  +  P  ');
  assert(r.ok, 'combo: whitespace trimmed');
}
{
  const r = parseKeyCombo('Cmd+,');
  assert(r.ok, 'combo: Cmd+, parses (preferences punctuation key)');
}
{
  const r = parseKeyCombo('Cmd+=');
  assert(r.ok, 'combo: Cmd+= parses (zoom punctuation key)');
}
{
  const r = parseKeyCombo('Cmd+`');
  assert(r.ok, 'combo: Cmd+` parses (window cycling punctuation key)');
}
{
  const r = parseKeyCombo('PageDown');
  assert(r.ok, 'combo: bare PageDown parses');
}

// ─── parseKeyCombo — rejects ───────────────────────────────────────────
for (const bad of [
  '',
  '+',
  'Cmd+',
  'Cmd+Shift',                  // all modifiers, no terminal key
  'Shift+Cmd+A+B',               // two terminal keys
  'Cmd+Bogus',                   // unknown named key
  'Cmd+Z+X',                     // two letter keys
  'Cmd+Shift+Alt+Ctrl+Fn+Extra+A', // > 5 parts
]) {
  const r = parseKeyCombo(bad);
  assert(!r.ok, `combo: rejects ${JSON.stringify(bad)}`);
}
// `"+T"` collapses to bare `T` after empty-segment filter — same as
// pressing T with no modifiers. Accepted by design; tested explicitly:
{
  const r = parseKeyCombo('+T');
  assert(r.ok, 'combo: "+T" accepted as bare T (empty segments filtered)');
}

// ─── parseKeyCombo — every modifier alias ──────────────────────────────
for (const mod of Array.from(DESKTOP_MODIFIERS)) {
  const r = parseKeyCombo(`${mod}+A`);
  assert(r.ok, `combo: modifier "${mod}" accepted`);
}

// ─── parseKeyCombo — every named key ──────────────────────────────────
for (const key of Array.from(DESKTOP_NAMED_KEYS)) {
  const r = parseKeyCombo(`Cmd+${key}`);
  assert(r.ok, `combo: named key "${key}" accepted`);
}

// ─── parseKeyCombo — every safe punctuation key ────────────────────────
for (const key of Array.from(DESKTOP_PUNCTUATION_KEYS)) {
  const r = parseKeyCombo(`Cmd+${key}`);
  assert(r.ok, `combo: punctuation key "${key}" accepted`);
}

// ─── escapeAppleScriptString ──────────────────────────────────────────
assert(escapeAppleScriptString('hello')  === 'hello',          'escape: no-op on plain ascii');
assert(escapeAppleScriptString('he said "hi"') === 'he said \\"hi\\"', 'escape: escapes double quotes');
assert(escapeAppleScriptString('back\\slash') === 'back\\\\slash', 'escape: escapes backslashes');
assert(escapeAppleScriptString('\\"') === '\\\\\\"', 'escape: backslash first, then quote');

// ─── isValidAppName ────────────────────────────────────────────────────
for (const good of ['Zoom', 'Visual Studio Code', 'Google Chrome', 'Notes.app', 'my-app', 'App_Name', 'Something (Beta)']) {
  assert(isValidAppName(good), `appName: accepts "${good}"`);
}
for (const bad of ['', ' ', 'Bad|Name', 'no;semi', '`echo`', '$(whoami)', "'", '"', '\n', 'path/to']) {
  assert(!isValidAppName(bad), `appName: rejects ${JSON.stringify(bad)}`);
}

// ─── Phase 1c additions ────────────────────────────────────────────────

// Pure validators still live in protocol — just make sure the set of
// supported key names didn't regress.
{
  assert(DESKTOP_MODIFIERS.size >= 10, `modifier set ≥10 entries (got ${DESKTOP_MODIFIERS.size})`);
  assert(DESKTOP_NAMED_KEYS.size >= 20, `named-key set ≥20 entries (got ${DESKTOP_NAMED_KEYS.size})`);
  assert(DESKTOP_PUNCTUATION_KEYS.size >= 7, `punctuation-key set ≥7 entries (got ${DESKTOP_PUNCTUATION_KEYS.size})`);
}

// Phase 1c introduced `waitForApp` + `takeScreenshot`. The pure shape
// has no new parser — live behavior is covered by the agent-runtime
// integration tests. What we CAN lock here: that the app-name validator
// still accepts typical targets for the new `waitForApp` call.
for (const target of ['Zoom', 'Visual Studio Code', 'Terminal', 'Safari', 'System Settings']) {
  assert(isValidAppName(target), `waitForApp target accepted: "${target}"`);
}

// ─── Phase 1d validators ──────────────────────────────────────────────

// validateDesktopUrl: accepts
for (const ok of [
  'https://example.com',
  'http://localhost:3000/api',
  'https://example.com/path?q=1&r=2#frag',
  'file:///Users/me/notes.md',
  'mailto:hi@example.com?subject=test',
]) {
  const r = validateDesktopUrl(ok);
  assert(r.ok, `url: accepts ${ok}`);
}
// validateDesktopUrl: rejects
for (const bad of [
  '',
  'javascript:alert(1)',
  'data:text/plain,abc',
  'ftp://example.com',
  'not a url at all',
  `https://example.com/\nattack`,
  'https://' + 'x'.repeat(2100),     // > 2048 chars
]) {
  const r = validateDesktopUrl(bad);
  assert(!r.ok, `url: rejects ${JSON.stringify(bad.slice(0, 50))}`);
}

// validateDesktopPath: accepts typical macOS paths
for (const ok of [
  '~/Downloads',
  '/Users/chris/code/project',
  '/Applications/Zoom.app',
  '/tmp/foo.txt',
  'relative/path/file.md',
  '~/Library/Application Support/',
]) {
  const r = validateDesktopPath(ok);
  assert(r.ok, `path: accepts ${JSON.stringify(ok)}`);
}
// validateDesktopPath: rejects shell-injection attempts + control chars
for (const bad of [
  '',
  '`rm -rf /`',
  '$(whoami)',
  '; ls',
  '| cat',
  '> /etc/passwd',
  '< /dev/null',
  '& disown',
  'file\nwith\nnewlines',
]) {
  const r = validateDesktopPath(bad);
  assert(!r.ok, `path: rejects ${JSON.stringify(bad.slice(0, 40))}`);
}

// validateClickCoords: accepts integers, rejects negatives / floats / huge
{
  const ok1 = validateClickCoords(100, 200);
  assert(ok1.ok, 'coords: accepts (100, 200)');
  const ok2 = validateClickCoords(0, 0);
  assert(ok2.ok, 'coords: accepts (0, 0)');

  const bad1 = validateClickCoords(-1, 10);
  assert(!bad1.ok, 'coords: rejects negative x');
  const bad2 = validateClickCoords(10, -1);
  assert(!bad2.ok, 'coords: rejects negative y');
  const bad3 = validateClickCoords(10.5, 20);
  assert(!bad3.ok, 'coords: rejects float');
  const bad4 = validateClickCoords(50000, 10);
  assert(!bad4.ok, 'coords: rejects > 20000');
  const bad5 = validateClickCoords(NaN, 10);
  assert(!bad5.ok, 'coords: rejects NaN');
  const bad6 = validateClickCoords('abc', 10);
  assert(!bad6.ok, 'coords: rejects non-numeric');
}

// ─── Installed-app detection (/desktop/installed-apps + /desktop/app-installed) ──
//
// Extract the REAL pure helpers from scripts/claude-bridge.js (delimited by
// UC_SMOKE_EXTRACT markers; self-contained by contract) so these smokes
// execute the shipped implementation instead of a drift-prone mirror.

const bridgeSource = fs.readFileSync('scripts/claude-bridge.js', 'utf8');
const clientSource = fs.readFileSync('src/lib/desktopBridge.ts', 'utf8');

function extractBridgeFunction<T>(name: string): T {
  const startMarker = `/* UC_SMOKE_EXTRACT_START ${name} */`;
  const endMarker = `/* UC_SMOKE_EXTRACT_END ${name} */`;
  const start = bridgeSource.indexOf(startMarker);
  const end = bridgeSource.indexOf(endMarker);
  if (start < 0 || end <= start) throw new Error(`UC_SMOKE_EXTRACT markers for ${name} not found in scripts/claude-bridge.js`);
  const fnSource = bridgeSource.slice(start + startMarker.length, end);
  // eslint-disable-next-line no-new-func
  return new Function(`${fnSource}; return ${name};`)() as T;
}

type InstalledEntry = { name: string; path?: string };
const dedupeInstalledAppEntries = extractBridgeFunction<(entries: unknown, maxApps: number) => { apps: InstalledEntry[]; truncated: boolean }>('dedupeInstalledAppEntries');
const parseInstalledAppsFromMdfindOutput = extractBridgeFunction<(stdout: unknown) => InstalledEntry[]>('parseInstalledAppsFromMdfindOutput');
const validateInstalledAppQueryName = extractBridgeFunction<(name: unknown) => string | null>('validateInstalledAppQueryName');
const shouldUseInstalledAppsCache = extractBridgeFunction<(cache: unknown, nowMs: number, ttlMs: number) => boolean>('shouldUseInstalledAppsCache');
const shellSingleQuote = extractBridgeFunction<(s: unknown) => string>('shellSingleQuote');

// dedupe: case-insensitive, strips .app, bounded, sorted, truncated flag
{
  const r = dedupeInstalledAppEntries([
    { name: 'Zoom.app', path: '/Applications/Zoom.app' },
    { name: 'zoom', path: '/Users/x/Applications/zoom.app' },
    { name: 'Safari' },
    { name: '  ' },
    { name: 'Adobe Photoshop 2025', path: '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app' },
  ], 400);
  assert(r.apps.length === 3, `installed: dedupes case-insensitively (got ${r.apps.length})`);
  assert(r.apps.some((a) => a.name === 'Zoom'), 'installed: strips .app extension');
  assert(!r.truncated, 'installed: no truncation under cap');
  const sorted = [...r.apps.map((a) => a.name)].sort((a, b) => a.localeCompare(b));
  assert(JSON.stringify(r.apps.map((a) => a.name)) === JSON.stringify(sorted), 'installed: names sorted');
}
{
  const many = Array.from({ length: 450 }, (_, i) => ({ name: `App ${i}` }));
  const r = dedupeInstalledAppEntries(many, 400);
  assert(r.apps.length === 400, `installed: bounded at 400 (got ${r.apps.length})`);
  assert(r.truncated, 'installed: truncated flag set past cap');
}
{
  const r = dedupeInstalledAppEntries(Array.from({ length: 900 }, () => ({ name: 'Same App' })), 400);
  assert(r.apps.length === 1 && !r.truncated, 'installed: duplicates do not count toward the cap');
}
{
  const r = dedupeInstalledAppEntries('not-an-array' as unknown, 400);
  assert(Array.isArray(r.apps) && r.apps.length === 0, 'installed: non-array input yields empty list');
}

// mdfind parse: keeps top-level .app paths, skips nested helper bundles
{
  const out = parseInstalledAppsFromMdfindOutput([
    '/Applications/Safari.app',
    '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app',
    '/Applications/Foo.app/Contents/Helpers/Helper.app',
    '/Users/x/Library/SomeTool',
    '',
  ].join('\n'));
  assert(out.length === 2, `installed: mdfind parse keeps top-level bundles only (got ${out.length})`);
  assert(out[0].name === 'Safari' && out[0].path === '/Applications/Safari.app', 'installed: mdfind parse extracts name + path');
  assert(out.some((e) => e.name === 'Adobe Photoshop 2025'), 'installed: mdfind parse handles spaces in path');
  assert(parseInstalledAppsFromMdfindOutput(null).length === 0, 'installed: mdfind parse tolerates null stdout');
}

// single-check escape safety: hostile names rejected before any spawn
for (const hostile of [
  'Foo"; rm -rf "/',
  "Foo'; rm -rf '/",
  '$(whoami)',
  '`reboot`',
  'a|b',
  'a;b',
  'a&b',
  'a\nb',
  '../../../etc/passwd',
  '',
  '   ',
  'X'.repeat(121),
]) {
  assert(validateInstalledAppQueryName(hostile) === null, `installed: rejects hostile name ${JSON.stringify(hostile.slice(0, 30))}`);
}
for (const good of ['Zoom', 'Visual Studio Code', 'Notes.app', 'Adobe Photoshop 2025', 'Something (Beta)', '  Safari  ']) {
  assert(typeof validateInstalledAppQueryName(good) === 'string', `installed: accepts ${JSON.stringify(good)}`);
}
assert(validateInstalledAppQueryName('  Safari  ') === 'Safari', 'installed: trims accepted names');

// shellSingleQuote: even if a name ever reached a shell, quoting neutralizes it
{
  const q = shellSingleQuote(`Foo"; rm -rf "/`);
  assert(q === `'Foo"; rm -rf "/'`, 'shell-escape: double-quote payload stays inside single quotes');
  const q2 = shellSingleQuote(`Foo'; rm -rf '/`);
  assert(q2 === `'Foo'\\''; rm -rf '\\''/'`, 'shell-escape: single quotes escaped via close-escape-reopen');
  // Behavioral proof: run each hostile name through a REAL shell as a
  // quoted printf argument — it must come back byte-identical (one token,
  // nothing executed).
  for (const hostile of [`Foo"; rm -rf "/`, `Foo'; rm -rf '/`, '$(whoami)', '`id`', 'a;b|c&d>e']) {
    const echoed = execSync(`printf %s ${shellSingleQuote(hostile)}`, { encoding: 'utf8' });
    assert(echoed === hostile, `shell-escape: shell round-trips ${JSON.stringify(hostile.slice(0, 24))} as a single literal token`);
  }
}

// cache behavior (stubbed clock): fresh hit, expiry, empty, clock-backwards
{
  const TTL = 5 * 60 * 1000;
  const cache = { ts: 1_000_000, payload: { ok: true, apps: [], source: 'fs', truncated: false } };
  assert(shouldUseInstalledAppsCache(cache, 1_000_000 + TTL - 1, TTL), 'cache: hit just under TTL');
  assert(!shouldUseInstalledAppsCache(cache, 1_000_000 + TTL, TTL), 'cache: miss at TTL');
  assert(!shouldUseInstalledAppsCache({ ts: 0, payload: null }, 1_000_000, TTL), 'cache: miss when payload empty');
  assert(!shouldUseInstalledAppsCache(cache, 999_999, TTL), 'cache: miss when clock moved backwards');
  assert(!shouldUseInstalledAppsCache(null, 1_000_000, TTL), 'cache: miss on missing cache object');
}

// endpoint + client wiring (source-level — the live HTTP path needs a
// running bridge; same posture as the rest of this file)
{
  assert(bridgeSource.includes("url === '/desktop/installed-apps'"), 'bridge: /desktop/installed-apps endpoint routed');
  assert(bridgeSource.includes("url === '/desktop/app-installed'"), 'bridge: /desktop/app-installed endpoint routed');
  assert(bridgeSource.includes("execFile('open', ['-Ra', name]"), 'bridge: app-installed check uses execFile argv (never raw shell interpolation)');
  assert(bridgeSource.includes("execFile('mdfind', [\"kMDItemKind == 'Application'\"], { timeout: 1500"), 'bridge: Spotlight probe bounded at 1.5s');
  assert(bridgeSource.includes("source: 'fs'") && bridgeSource.includes("source: 'spotlight'"), 'bridge: response carries source discriminator');
  assert(bridgeSource.includes("'installed_apps'") && bridgeSource.includes("'app_installed'"), 'bridge: health advertises installed_apps + app_installed');

  assert(clientSource.includes("callBridge('GET', '/desktop/installed-apps')"), 'client: listInstalledApps hits bridge endpoint');
  assert(clientSource.includes('/desktop/app-installed?name=${encodeURIComponent(clean)}'), 'client: checkAppInstalled URL-encodes the name');
  assert(clientSource.includes('function listInstalledApps') && clientSource.includes('function checkAppInstalled'), 'client: wrapper functions exported');
  assert(clientSource.includes('INSTALLED_APPS_CLIENT_CACHE_TTL_MS = 5 * 60 * 1000') && clientSource.includes('installedAppsClientCache.get(cacheKey)'), 'client: 5-min cache keyed by bridge URL');
  assert(clientSource.includes('function listInstalledAppNamesLower') && /listInstalledAppNamesLower[\s\S]{0,400}return \[\];[\s\S]{0,400}catch \{\s*return \[\];/.test(clientSource), 'client: lowercased-names helper silent-fails to []');
  assert(/checkAppInstalled\([\s\S]{0,300}isValidAppName\(clean\)/.test(clientSource), 'client: checkAppInstalled validates app name before calling bridge');
}

if (failures > 0) {
  console.error(`\n${failures} desktop-bridge smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll desktop-bridge smoke cases passed.');
