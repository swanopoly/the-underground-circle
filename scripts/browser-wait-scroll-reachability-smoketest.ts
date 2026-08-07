/**
 * Focused source-contract smoke for the semantic browser wait/scroll lane.
 *
 * Proves the two tools are reachable through the authenticated local router,
 * strict browser client, OpenSwan catalog/runtime, SwanBot v2 clientOnly
 * catalog, and canonical SwanBot client dispatcher without exposing raw
 * selectors/deltas or raw URL/status data. Both operations are bound to the
 * exact opaque identity from one fresh DOM snapshot.
 *
 * Run:
 *   npx tsx scripts/browser-wait-scroll-reachability-smoketest.ts
 */

import { readFileSync } from 'node:fs';

let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function sliceBetween(source: string, start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert(startIndex >= 0 && endIndex > startIndex, `${label} has stable source boundaries`);
  return source.slice(startIndex, endIndex);
}

const routerSource = readFileSync('scripts/claude-bridge.js', 'utf8');
const bridgeSource = readFileSync('scripts/browser-bridge.js', 'utf8');
const clientSource = readFileSync('src/lib/browserBridge.ts', 'utf8');
const failureSource = readFileSync('src/lib/browserBridgeFailure.ts', 'utf8');
const protocolSource = readFileSync('src/lib/desktopBridgeProtocol.ts', 'utf8');
const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
const swanbotSource = readFileSync('src/lib/swanbot.ts', 'utf8');
const v2EdgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');

// Authenticated local route reachability.
const browserRouter = sliceBetween(
  routerSource,
  "if (url.startsWith('/browser/'))",
  "res.end(JSON.stringify({ error: 'Not found.",
  'local browser router',
);
const tokenGateIndex = browserRouter.indexOf("const token = req.headers['x-uc-desktop-token']");
const waitRouteIndex = browserRouter.indexOf("p === '/browser/wait_for'");
const scrollRouteIndex = browserRouter.indexOf("p === '/browser/scroll'");
assert(
  tokenGateIndex >= 0 && tokenGateIndex < waitRouteIndex && tokenGateIndex < scrollRouteIndex,
  'wait and scroll routes are behind the canonical desktop-token gate',
);
assert(
  browserRouter.includes("return browserBridge.handleWaitFor(req, res, CORS)")
    && browserRouter.includes("return browserBridge.handleScroll(req, res, CORS)"),
  'canonical local router dispatches wait and scroll to their browser handlers',
);

// Bridge handler validation and privacy boundary.
const waitHandler = sliceBetween(
  bridgeSource,
  'async function handleWaitFor(',
  '// scroll — one coarse semantic wheel gesture.',
  'wait handler',
);
const scrollHandler = sliceBetween(
  bridgeSource,
  'async function handleScroll(',
  'async function handleClose(',
  'scroll handler',
);
const scrollProofHelper = sliceBetween(
  bridgeSource,
  'async function performVerifiedBrowserSemanticScroll(',
  'async function handleScroll(',
  'verified scroll helper',
);
assert(
  waitHandler.indexOf('normalizeBridgeSemanticWait(body)')
    < waitHandler.indexOf('browserIdentities.browserProcessId !== spec.expectedBrowserProcessId')
    && !waitHandler.includes('ensureContext()'),
  'wait validates semantic input and requires an already-observed browser instead of launching/adopting one',
);
assert(
  waitHandler.includes('pageRef.getByRole(spec.role')
    && !waitHandler.includes('resolveLocator(')
    && waitHandler.includes('name: spec.name')
    && waitHandler.includes('exact: true')
    && !waitHandler.includes('body.selector')
    && !waitHandler.includes('waitForSelector'),
  'wait uses exact semantic role/name targeting and has no selector path',
);
assert(
  waitHandler.includes('checkExpectedBrowserSemanticPageIdentity(')
    && waitHandler.includes('captureBrowserSemanticPageIdentityReceipt(')
    && waitHandler.indexOf('checkExpectedBrowserSemanticPageIdentity(') < waitHandler.indexOf('locator.waitFor(')
    && waitHandler.indexOf('captureBrowserSemanticPageIdentityReceipt(') > waitHandler.indexOf('locator.waitFor('),
  'wait exact-checks process/context/page/opaque URL before dispatch and after the awaited operation',
);
assert(
  waitHandler.includes('...afterProof.receipt')
    && waitHandler.includes('condition: spec.condition')
    && waitHandler.includes('completed: true')
    && !waitHandler.includes('url:')
    && !waitHandler.includes('title:')
    && !waitHandler.includes('status:'),
  'wait receipt is privacy-bounded and omits URL/title/status',
);
assert(
  scrollHandler.indexOf('normalizeBridgeSemanticScroll(body)')
    < scrollHandler.indexOf('browserIdentities.browserProcessId !== spec.expectedBrowserProcessId')
    && !scrollHandler.includes('ensureContext()')
    && scrollHandler.includes('const scrollProof = await performVerifiedBrowserSemanticScroll(')
    && scrollHandler.includes('pageRef,\n    spec,')
    && !scrollHandler.includes('pageRef.mouse.wheel(')
    && !scrollHandler.includes('body.dx')
    && !scrollHandler.includes('body.dy'),
  'scroll validates direction/amount before delegating one verified bounded gesture',
);
assert(
  scrollHandler.includes('checkExpectedBrowserSemanticPageIdentity(')
    && scrollHandler.includes('captureBrowserSemanticPageIdentityReceipt(')
    && scrollHandler.indexOf('checkExpectedBrowserSemanticPageIdentity(') < scrollHandler.indexOf('performVerifiedBrowserSemanticScroll(')
    && scrollHandler.indexOf('captureBrowserSemanticPageIdentityReceipt(') > scrollHandler.indexOf('performVerifiedBrowserSemanticScroll('),
  'scroll exact-checks process/context/page/opaque URL before and after the bounded gesture',
);
assert(
  (scrollProofHelper.match(/pageRef\.mouse\.wheel\(/g) || []).length === 1
    && (scrollProofHelper.match(/captureBrowserViewportScrollPosition\(pageRef\)/g) || []).length === 2
    && scrollProofHelper.indexOf('captureBrowserViewportScrollPosition(pageRef)')
      < scrollProofHelper.indexOf('pageRef.mouse.wheel(spec.dx, spec.dy)')
    && scrollProofHelper.lastIndexOf('captureBrowserViewportScrollPosition(pageRef)')
      > scrollProofHelper.indexOf('pageRef.mouse.wheel(spec.dx, spec.dy)')
    && scrollProofHelper.includes('pageRef.waitForTimeout(')
    && scrollProofHelper.includes('browserSemanticScrollMovementVerified(spec.direction, before, after)')
    && scrollProofHelper.includes("errorCode: 'browser_scroll_verification_failed'"),
  'scroll proof captures before/after viewport position, dispatches one wheel only, and requires requested-axis movement',
);
assert(
  bridgeSource.includes('const BROWSER_SCROLL_VERIFICATION_MAX_SAMPLES = 3')
    && bridgeSource.includes('function normalizeBrowserViewportScrollPosition(')
    && bridgeSource.includes('function browserSemanticScrollMovementVerified('),
  'scroll movement verification is normalized and bounded to at most three after samples',
);
assert(
  scrollHandler.includes("scrollProof.errorCode || 'browser_scroll_verification_failed'")
    && scrollHandler.includes('scrollProof.movementVerified !== true')
    && scrollHandler.includes("'browser_scroll_verification_failed'"),
  'scroll no-movement or malformed proof fails closed through the dedicated error code',
);
assert(
  scrollHandler.includes('...afterProof.receipt')
    && scrollHandler.includes('direction: spec.direction')
    && scrollHandler.includes('amount: spec.amount')
    && scrollHandler.includes('movementVerified: true')
    && scrollHandler.includes('completed: true')
    && !scrollHandler.includes('url:')
    && !scrollHandler.includes('title:')
    && !scrollHandler.includes('status:')
    && !scrollHandler.includes('maxX:')
    && !scrollHandler.includes('maxY:'),
  'scroll receipt attests movement while omitting raw deltas, viewport geometry, URL/title/status',
);

// Typed client reachability and response projection.
const waitClient = sliceBetween(
  clientSource,
  'export async function waitFor(',
  '/**\n * One semantic, bounded browser-page scroll.',
  'browser wait client',
);
const scrollClient = sliceBetween(
  clientSource,
  'export async function scrollPage(',
  '/** @deprecated Use scrollPage',
  'browser scroll client',
);
assert(
  waitClient.indexOf('normalizeBrowserSemanticWait(args)') < waitClient.indexOf("callBrowser<BrowserWaitForResult>('POST', '/browser/wait_for'")
    && waitClient.includes('expectedBrowserProcessId: spec.expectedBrowserProcessId')
    && waitClient.includes('expectedBrowserContextId: spec.expectedBrowserContextId')
    && waitClient.includes('expectedPageId: spec.expectedPageId')
    && waitClient.includes('expectedUrl: spec.expectedUrl')
    && waitClient.includes('extractBrowserSemanticPageIdentityReceipt(data, spec)')
    && waitClient.includes('condition: spec.condition')
    && waitClient.includes('completed: true'),
  'typed wait client validates before dispatch and projects a safe receipt',
);
assert(
  scrollClient.indexOf('normalizeBrowserSemanticScroll(args)') < scrollClient.indexOf("callBrowser<BrowserScrollResult>('POST', '/browser/scroll'")
    && scrollClient.includes('expectedBrowserProcessId: spec.expectedBrowserProcessId')
    && scrollClient.includes('expectedBrowserContextId: spec.expectedBrowserContextId')
    && scrollClient.includes('expectedPageId: spec.expectedPageId')
    && scrollClient.includes('expectedUrl: spec.expectedUrl')
    && scrollClient.includes('extractBrowserSemanticPageIdentityReceipt(data, spec)')
    && scrollClient.includes('direction: spec.direction')
    && scrollClient.includes('amount: spec.amount')
    && scrollClient.includes('data.movementVerified !== true')
    && scrollClient.includes('movementVerified: true')
    && scrollClient.includes('completed: true'),
  'typed scroll client requires an exact movementVerified:true attestation before projecting a safe receipt',
);
assert(
  clientSource.includes('export interface BrowserScrollResult extends BrowserSemanticPageIdentityReceipt')
    && clientSource.includes('movementVerified: true;')
    && protocolSource.includes("'browser_scroll_verification_failed'")
    && failureSource.includes("case 'browser_scroll_verification_failed':"),
  'typed protocol and recovery taxonomy preserve the dedicated scroll-verification failure',
);

// OpenSwan catalog + runtime execution.
const waitDefinition = sliceBetween(
  runtimeSource,
  "name: 'browser.wait_for'",
  "name: 'browser.scroll'",
  'OpenSwan wait definition',
);
const scrollDefinition = sliceBetween(
  runtimeSource,
  "name: 'browser.scroll'",
  "name: 'browser.screenshot'",
  'OpenSwan scroll definition',
);
assert(
  waitDefinition.includes("enum: ['page_loaded', 'dom_ready', 'network_idle', 'element_visible', 'element_hidden', 'delay']")
    && waitDefinition.includes("required: ['role', 'name']")
    && waitDefinition.includes("'expectedBrowserProcessId'")
    && waitDefinition.includes("'expectedBrowserContextId'")
    && waitDefinition.includes("'expectedPageId'")
    && waitDefinition.includes("'expectedUrl'")
    && waitDefinition.includes("pattern: '^uc_browser_url_[a-f0-9]{64}$'")
    && waitDefinition.includes('additionalProperties: false')
    && !waitDefinition.includes("selector: {"),
  'OpenSwan wait schema exposes only bounded semantic conditions/targets',
);
assert(
  scrollDefinition.includes("enum: ['up', 'down', 'left', 'right']")
    && scrollDefinition.includes("enum: ['small', 'medium', 'large']")
    && scrollDefinition.includes("required: [\n        'direction'")
    && scrollDefinition.includes("'expectedBrowserProcessId'")
    && scrollDefinition.includes("'expectedBrowserContextId'")
    && scrollDefinition.includes("'expectedPageId'")
    && scrollDefinition.includes("'expectedUrl'")
    && scrollDefinition.includes("pattern: '^uc_browser_url_[a-f0-9]{64}$'")
    && scrollDefinition.includes('additionalProperties: false')
    && !scrollDefinition.includes('dx:')
    && !scrollDefinition.includes('dy:'),
  'OpenSwan scroll schema exposes direction/amount and no raw deltas',
);

const runtimeDispatch = sliceBetween(
  runtimeSource,
  "case 'browser.wait_for': {",
  "case 'browser.screenshot': {",
  'OpenSwan wait/scroll runtime dispatch',
);
assert(
  runtimeDispatch.includes("const { waitFor } = await import('./browserBridge')")
    && runtimeDispatch.includes('const r = await waitFor(a)')
    && runtimeDispatch.includes("const { scrollPage } = await import('./browserBridge')")
    && runtimeDispatch.includes('const r = await scrollPage(a)')
    && runtimeDispatch.includes('r.data.movementVerified !== true')
    && runtimeDispatch.includes('Verified the exact observed browser viewport moved'),
  'OpenSwan runtime reaches both typed browser client functions',
);
assert(
  !runtimeDispatch.includes('.url')
    && !runtimeDispatch.includes('.title')
    && !runtimeDispatch.includes('.status')
    && !runtimeDispatch.includes('.name'),
  'OpenSwan wait/scroll result text cannot leak page URL/title/status/target name',
);
assert(
  runtimeSource.includes("'browser.wait_for',\n  'browser.scroll',\n  'browser.screenshot'")
    && runtimeSource.includes("'browser.wait_for': ['execute']")
    && runtimeSource.includes("'browser.scroll': ['execute']"),
  'wait and scroll are loop-safe and scoped to execute mode',
);

const waitPolicy = sliceBetween(
  runtimeSource,
  "if (tool === 'browser.wait_for')",
  "if (tool.startsWith('browser.'))",
  'wait/scroll policy',
);
assert(
  waitPolicy.includes("approvalMode: 'auto'")
    && waitPolicy.includes('externalSideEffect: false')
    && waitPolicy.includes("if (tool === 'browser.scroll')")
    && waitPolicy.includes('mutatesState: false'),
  'wait and transient viewport scroll are auto-approved with no external side effect',
);
assert(
  runtimeSource.includes("toolName === 'browser.wait_for'")
    && runtimeSource.includes("toolName === 'browser.scroll'")
    && runtimeSource.includes("return { approvalMode: 'auto', mutatesState: true, externalSideEffect: false }"),
  'wait and scroll are sequential barriers rather than unsafe same-round parallel actions',
);

// SwanBot v2 exposure must match the semantic-only public contract and enter
// the canonical OpenSwan dispatcher before any raw bridge compatibility path.
const v2WaitDefinition = sliceBetween(
  v2EdgeSource,
  'name: "browser.wait_for"',
  'name: "browser.scroll"',
  'SwanBot v2 wait definition',
);
const v2ScrollDefinition = sliceBetween(
  v2EdgeSource,
  'name: "browser.scroll"',
  'name: "browser.screenshot"',
  'SwanBot v2 scroll definition',
);
assert(
  v2WaitDefinition.includes('enum: ["page_loaded", "dom_ready", "network_idle", "element_visible", "element_hidden", "delay"]')
    && v2WaitDefinition.includes('required: ["role", "name"]')
    && v2WaitDefinition.includes('"expectedBrowserProcessId"')
    && v2WaitDefinition.includes('"expectedBrowserContextId"')
    && v2WaitDefinition.includes('"expectedPageId"')
    && v2WaitDefinition.includes('"expectedUrl"')
    && v2WaitDefinition.includes('pattern: "^uc_browser_url_[a-f0-9]{64}$"')
    && v2WaitDefinition.includes('additionalProperties: false')
    && !v2WaitDefinition.includes('selector:'),
  'SwanBot v2 wait schema exposes exact semantic conditions and no raw selector',
);
assert(
  v2ScrollDefinition.includes('enum: ["up", "down", "left", "right"]')
    && v2ScrollDefinition.includes('enum: ["small", "medium", "large"]')
    && v2ScrollDefinition.includes('required: [\n          "direction"')
    && v2ScrollDefinition.includes('"expectedBrowserProcessId"')
    && v2ScrollDefinition.includes('"expectedBrowserContextId"')
    && v2ScrollDefinition.includes('"expectedPageId"')
    && v2ScrollDefinition.includes('"expectedUrl"')
    && v2ScrollDefinition.includes('pattern: "^uc_browser_url_[a-f0-9]{64}$"')
    && v2ScrollDefinition.includes('additionalProperties: false')
    && !v2ScrollDefinition.includes('dx:')
    && !v2ScrollDefinition.includes('dy:'),
  'SwanBot v2 scroll schema exposes coarse semantic movement and no raw deltas',
);
assert(
  !v2WaitDefinition.includes('url:')
    && !v2WaitDefinition.includes('title:')
    && !v2WaitDefinition.includes('status:')
    && !v2ScrollDefinition.includes('url:')
    && !v2ScrollDefinition.includes('title:')
    && !v2ScrollDefinition.includes('status:'),
  'SwanBot v2 wait/scroll definitions do not request page URL, title, or status data',
);

const clientGateway = sliceBetween(
  swanbotSource,
  'async function dispatchOneClientTool(',
  'const desktopResult = await dispatchSwanBotDesktopClientTool',
  'SwanBot v2 canonical client gateway',
);
assert(
  clientGateway.includes("case 'browser.wait_for':")
    && clientGateway.includes("case 'browser.scroll':")
    && clientGateway.includes('return dispatchCodingClientTool(call, context);'),
  'SwanBot v2 wait and scroll enter the canonical OpenSwan runtime gateway',
);

console.log(`browser-wait-scroll-reachability-smoketest: ${assertions} assertions passed`);
