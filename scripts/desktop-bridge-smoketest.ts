/**
 * desktop-bridge-smoketest — covers the pure protocol helpers in
 * `src/lib/desktopBridgeProtocol.ts`. The live HTTP client in
 * `desktopBridge.ts` needs a running bridge + paired token; that gets
 * integration-tested manually.
 *
 * Run: npm run smoke:desktop-bridge
 */

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

if (failures > 0) {
  console.error(`\n${failures} desktop-bridge smoke-test failure(s)`);
  process.exit(1);
}
console.log('\nAll desktop-bridge smoke cases passed.');
