/**
 * Source-wiring contract for Chat -> Office run deep links.
 *
 * React Native screens are intentionally not imported by tsx. This smoke reads
 * their source and pins the narrow integration seam instead:
 *
 *   Chat owns a typed EntityHandle, encodes it as the bounded `focus` payload,
 *   CircleDetail decodes and accepts only OFFICE + office:run alignment, and
 *   Office reopens its existing RunHistoryDrawer for the requested run.
 *
 * Run: npm run smoke:cross-surface-run-focus-wiring
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  decodeEntityHandle,
  encodeEntityHandle,
  type EntityHandle,
} from '../src/lib/entityHandleCore';

const root = process.cwd();
const read = (relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');

const chat = read('src/screens/circles/tabs/ChatTab.tsx');
const circle = read('src/screens/circles/CircleDetailScreen.tsx');
const office = read('src/screens/circles/tabs/OfficeTab.tsx');

function section(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing section start: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing section end: ${end}`);
  return source.slice(startIndex, endIndex);
}

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// The real codec is the fail-closed boundary used by the source wiring below.
const runHandle: EntityHandle = { kind: 'run', id: 'run_abc123', surface: 'office' };
const encodedRunFocus = encodeEntityHandle(runHandle);
assert.equal(encodedRunFocus, 'office:run:run_abc123');
assert.deepEqual(decodeEntityHandle(encodedRunFocus), runHandle);
assert.equal(decodeEntityHandle('not-a-handle'), null, 'malformed focus fails closed');
assert.equal(decodeEntityHandle('office:run:bad id'), null, 'unsafe run id fails closed');
assert.deepEqual(
  decodeEntityHandle('chat:run:run_abc123'),
  { kind: 'run', id: 'run_abc123', surface: 'chat' },
  'surface mismatch remains visible to the CircleDetail alignment guard',
);
assert.deepEqual(
  decodeEntityHandle('office:agent:default::blackswan'),
  { kind: 'agent', id: 'default::blackswan', surface: 'office' },
  'kind mismatch remains visible to the CircleDetail alignment guard',
);

// Chat: one typed helper must carry the same encoded focus on web and both
// native route-param paths. Raw ids/objects never cross the navigation seam.
const chatEntityHandleImport = chat.match(
  /import\s*(?:type\s*)?\{[\s\S]{0,420}?\}\s*from\s*['"]\.\.\/\.\.\/\.\.\/lib\/entityHandleCore['"]/,
)?.[0] ?? '';
assert.match(chatEntityHandleImport, /\bencodeEntityHandle\b/, 'Chat imports the canonical encoder');
assert.match(chatEntityHandleImport, /\bEntityHandle\b/, 'Chat imports the canonical handle type');

const goTab = section(chat, 'const goTab =', '// followup-chips:');
assert.match(
  goTab,
  /const goTab\s*=\s*\(\s*tab:\s*string\s*,\s*(?:focus|handle)\??:\s*EntityHandle(?:\s*\|\s*(?:null|undefined))?\s*\)/,
  'goTab accepts one optional typed EntityHandle',
);
assert.match(
  goTab,
  /const focus\s*=\s*handle\s*\?\s*encodeEntityHandle\(handle\)\s*:\s*['"]['"]/,
  'goTab encodes the typed focus exactly once at its boundary',
);
assert.match(
  goTab,
  /CustomEvent\('uc:switch-tab',[\s\S]{0,240}?detail:\s*focus\s*\?\s*\{\s*tab\s*,\s*focus\s*\}\s*:\s*\{\s*tab\s*\}/,
  'web uc:switch-tab includes the encoded focus',
);

const routeParams = section(goTab, 'const routeParams =', 'try {');
assert.equal(
  occurrences(routeParams, 'focus:'),
  1,
  'the shared native route object owns exactly one encoded focus field',
);
assert.match(routeParams, /focus:\s*focus\s*\|\|\s*null/, 'the shared native route object carries encoded focus');
assert.match(routeParams, /_tabTs:\s*routeTs/, 'the native route object timestamps the tab request');
assert.match(
  chat,
  /const tabNavigationRequestRef\s*=\s*useRef\(0\);[\s\S]{0,900}?tabNavigationRequestRef\.current\s*\+=\s*1/,
  'native focus requests advance a monotonic local sequence',
);
assert.match(
  routeParams,
  /_focusTs:\s*tabNavigationRequestRef\.current/,
  'the native route object carries the repeat-focus request sequence',
);
assert.match(
  goTab,
  /navigation\.setParams\?\.\(\s*routeParams\s*\)/,
  'native setParams receives the shared route object',
);
assert.match(
  goTab,
  /navigation\.navigate\?\.\(\s*['"]CircleDetail['"]\s*,\s*\{\s*circleId\s*,\s*\.\.\.routeParams\s*\}\s*\)/,
  'native navigate spreads the same shared route object',
);

const followupHandler = section(chat, 'const handleFollowupChipPress =', '// reference-nav-chips:');
assert.match(
  followupHandler,
  /case 'open_run':[\s\S]{0,100}?case 'request_approval':[\s\S]{0,220}?goTab\(\s*'OFFICE'\s*,\s*followup\.handle/,
  'open-run and approval follow-ups carry their run handle to Office',
);
assert.match(
  followupHandler,
  /else if \(followup\.handle\)[\s\S]{0,180}?goTab\(\s*'OFFICE'\s*,\s*followup\.handle/,
  'retry fallback carries its run handle instead of landing on generic Office',
);

const referenceHandler = section(chat, 'const handleReferenceChipPress =', '// reference-nav-chips: bounded');
assert.match(
  referenceHandler,
  /goTab\(\s*\(surface\s*\|\|\s*['"]chat['"]\)\.toUpperCase\(\)\s*,\s*match\.handle\s*\)/,
  'reference navigation passes the exact resolved handle',
);

// CircleDetail: decoding is authoritative. Merely asking for OFFICE is not
// sufficient; both decoded surface and kind must align before a run request is
// stored and forwarded.
assert.match(
  circle,
  /import\s*\{[\s\S]{0,180}\bdecodeEntityHandle\b[\s\S]{0,180}\}\s*from\s*['"][^'"]*entityHandleCore['"]/,
  'CircleDetail imports the canonical decoder',
);

const captureFocus = section(circle, 'const captureCrossSurfaceFocus =', '// Owner-only tab gate');
assert.match(
  captureFocus,
  /const handle\s*=\s*decodeEntityHandle\(rawFocus\)/,
  'the shared focus capture decodes the untrusted payload exactly once',
);
const alignmentGuard = section(captureFocus, 'if (', 'officeRunFocusSequenceRef.current += 1;');
assert.match(alignmentGuard, /target\s*===\s*['"]OFFICE['"]/, 'Office focus is positively allowlisted');
assert.match(alignmentGuard, /handle\?\.kind\s*===\s*['"]run['"]/, 'Office focus requires a decoded run entity');
assert.match(alignmentGuard, /handle\.surface\s*===\s*['"]office['"]/, 'Office focus requires the matching office surface');
assert.match(
  captureFocus,
  /if \(target === ['"]OFFICE['"][\s\S]*?return true;[\s\S]*?return false;/,
  'malformed or mismatched focus falls through without mutating Office state',
);
assert.match(circle, /const officeRunFocusSequenceRef\s*=\s*useRef\(0\)/, 'focus requests start from a bounded local sequence');
assert.match(
  captureFocus,
  /officeRunFocusSequenceRef\.current\s*\+=\s*1;[\s\S]{0,160}?setOfficeRunFocus\(\{[\s\S]{0,100}?runId:\s*handle\.id\s*,[\s\S]{0,100}?requestId:\s*officeRunFocusSequenceRef\.current/,
  'each accepted focus gets a fresh request id and the exact decoded run id',
);

const switchHandler = section(circle, 'const onSwitchTab =', "window.addEventListener('keydown'");
assert.match(switchHandler, /detail\?\.focus|detail\.focus/, 'web listener reads only the encoded focus payload');
assert.match(
  switchHandler,
  /captureCrossSurfaceFocus\(\s*e\?\.detail\?\.focus\s*,\s*target\s*,\s*e\?\.detail\?\.draft\s*\)/,
  'the web event uses the shared decoder and alignment guard',
);
assert.ok(
  switchHandler.indexOf('captureCrossSurfaceFocus(') < switchHandler.indexOf('setActiveTab(target)'),
  'web captures the focus request before activating lazy Office',
);

assert.match(
  circle,
  /const\s*\{[^}]*focus:\s*routeFocus[^}]*\}\s*=\s*route\.params/,
  'native route params expose the encoded focus without interpreting it',
);
const nativeRouteEffect = section(circle, '// When route params change', 'const cached =');
assert.match(
  nativeRouteEffect,
  /captureCrossSurfaceFocus\(\s*routeFocus\s*,\s*target\s*\)/,
  'the native route uses the same shared decoder and alignment guard',
);
assert.ok(
  nativeRouteEffect.indexOf('captureCrossSurfaceFocus(') < nativeRouteEffect.indexOf('setActiveTab(target)'),
  'native captures the focus request before activating lazy Office',
);
assert.match(nativeRouteEffect, /const focusTs\s*=\s*route\.params\?\._focusTs/, 'native observes the repeat-focus timestamp');
assert.match(
  nativeRouteEffect,
  /\[[^\]]*routeFocus[^\]]*focusTs[^\]]*captureCrossSurfaceFocus[^\]]*\]/,
  'native repeats focus capture when the focus request timestamp changes',
);

const officeElement = section(circle, '<OfficeTab', '/>');
assert.match(
  officeElement,
  /focusRunId=\{officeRunFocus\?\.runId\s*\|\|\s*null\}/,
  'CircleDetail passes the exact accepted run id into Office',
);
assert.match(
  officeElement,
  /focusRunRequestId=\{officeRunFocus\?\.requestId\s*\|\|\s*0\}/,
  'CircleDetail passes the request sequence into Office',
);

// Office: a new request (including the same run clicked twice) reopens the
// existing drawer. No new run viewer or run store is introduced.
const officeProps = section(office, 'interface Props {', 'type WhiteboardModule');
assert.match(officeProps, /focusRunId\?:\s*string\s*\|\s*null/, 'Office props include the focus run id');
assert.match(officeProps, /focusRunRequestId\?:\s*number/, 'Office props include the focus request id');

const openRunHelper = section(office, 'const openOfficeRunDetail =', 'useEffect(() => {');
assert.match(
  openRunHelper,
  /const nextRunId\s*=\s*String\(runId\s*\|\|\s*['"]['"]\)\.trim\(\);[\s\S]{0,120}?if\s*\(!nextRunId\)\s*return;/,
  'the shared Office helper rejects an empty run id',
);
assert.match(
  openRunHelper,
  /setOfficeRunDetailRefId\(nextRunId\);[\s\S]{0,120}?setOfficeRunDetailRequestId\(\(current\)\s*=>\s*current\s*\+\s*1\);[\s\S]{0,120}?setShowOfficeRunDetail\(true\)/,
  'the helper selects the exact run, keys a fresh drawer, and opens it',
);
assert.match(
  office,
  /useEffect\(\(\)\s*=>\s*\{\s*if\s*\(!focusRunId\s*\|\|\s*focusRunRequestId\s*<=\s*0\)\s*return;\s*openOfficeRunDetail\(focusRunId\);\s*\},\s*\[focusRunId,\s*focusRunRequestId,\s*openOfficeRunDetail\]\);/,
  'Office reacts to each valid request by using the exact-run helper',
);
assert.match(
  office,
  /if\s*\(action\.kind\s*===\s*['"]open_run['"]\)[\s\S]{0,220}?openOfficeRunDetail\(item\.refId\)/,
  'existing Office attention actions keep using the same exact-run helper',
);
const runDrawer = section(office, '<RunHistoryDrawer', '/>');
assert.match(
  runDrawer,
  /key=\{`office-run-detail-\$\{officeRunDetailRequestId\}`\}/,
  'each accepted request remounts the drawer, including repeat clicks on one run',
);
assert.match(
  runDrawer,
  /initialRunId=\{officeRunDetailRefId\}/,
  'the focused run id remains wired into RunHistoryDrawer.initialRunId',
);

console.log('cross-surface-run-focus-wiring smoke: all contracts passed');
