/**
 * Read-only browser.locator_actionability contract smoke.
 *
 * Exercises the exported structural inspector with fake Playwright objects,
 * the client response allowlist, and source wiring across the authenticated
 * bridge route, OpenSwan, and SwanBot v2.
 */

import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
  serializeSwanBotClientToolResult,
  SWANBOT_CLIENT_TOOL_RESULT_MAX_CHARS,
} from '../src/lib/swanbotClientToolDispatcher';

const require = createRequire(import.meta.url);
const typescript = require('typescript') as typeof import('typescript');
const bridge = require('./browser-bridge.js') as Record<string, any>;

let failures = 0;
function assert(condition: unknown, message: string): asserts condition {
  if (condition) console.log('pass:', message);
  else {
    failures += 1;
    console.error('FAIL:', message);
  }
}

function fakeElement(options?: {
  role?: string;
  tagName?: string;
  type?: string;
  hitSelf?: boolean;
}) {
  const element: any = {
    tagName: options?.tagName || 'BUTTON',
    isConnected: true,
    isContentEditable: false,
    contains: () => false,
    getAttribute: (name: string) => {
      if (name === 'role') return options?.role || 'button';
      if (name === 'type') return options?.type || '';
      return null;
    },
    getBoundingClientRect: () => ({
      x: 20,
      y: 20,
      left: 20,
      top: 20,
      right: 120,
      bottom: 60,
      width: 100,
      height: 40,
    }),
  };
  const overlay = {};
  element.ownerDocument = {
    defaultView: { innerWidth: 1_200, innerHeight: 800 },
    elementFromPoint: () => options?.hitSelf === false ? overlay : element,
  };
  return element;
}

function fakeHandle(element: any, options?: {
  box?: Record<string, number> | null;
  visible?: boolean;
  enabled?: boolean;
  editable?: boolean;
  onDispose?: () => void;
}) {
  return {
    __element: element,
    evaluate: async (fn: (...args: any[]) => unknown, arg?: any) => (
      fn(element, arg?.__element || arg)
    ),
    boundingBox: async () => options?.box ?? null,
    isVisible: async () => options?.visible !== false,
    isEnabled: async () => options?.enabled !== false,
    isEditable: async () => options?.editable === true,
    dispose: async () => { options?.onDispose?.(); },
  };
}

function fakeLocator(options?: {
  counts?: number[];
  elements?: any[];
  boxes?: Array<Record<string, number> | null>;
  visible?: boolean[];
  enabled?: boolean;
  editable?: boolean;
  onDispose?: () => void;
}) {
  let countIndex = 0;
  let handleIndex = 0;
  const elements = options?.elements || [fakeElement(), fakeElement()];
  const counts = options?.counts || [1, 1];
  const boxes = options?.boxes || [
    { x: 20, y: 20, width: 100, height: 40 },
    { x: 20, y: 20, width: 100, height: 40 },
  ];
  const visible = options?.visible || [true, true];
  return {
    count: async () => counts[Math.min(countIndex++, counts.length - 1)],
    elementHandle: async () => {
      const index = Math.min(handleIndex++, elements.length - 1);
      return fakeHandle(elements[index], {
        box: boxes[Math.min(index, boxes.length - 1)],
        visible: visible[Math.min(index, visible.length - 1)],
        enabled: options?.enabled,
        editable: options?.editable,
        onDispose: options?.onDispose,
      });
    },
  };
}

async function main() {
  assert(
    bridge._hasExactlyOneLocatorActionabilityTarget({ role: 'button', name: 'Save' }),
    'semantic target requires one bounded role/name pair',
  );
  assert(
    bridge._hasExactlyOneLocatorActionabilityTarget({ selector: '#save' }),
    'selector target is accepted without semantic fields',
  );
  assert(
    !bridge._hasExactlyOneLocatorActionabilityTarget({ role: 'button' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ name: 'Save' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ role: 'button', name: 'Save', selector: '#save' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ selector: ' #save' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ selector: 'button >> nth=0' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ selector: 'xpath=(//button)[1]' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ selector: 'button:nth-child(1)' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ selector: 'button:nth-match(1)' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ selector: 'button:/**/first-child' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ selector: ':/**/nth-child(1)' })
      && !bridge._hasExactlyOneLocatorActionabilityTarget({ selector: '#save\\:nth-child' }),
    'missing, contradictory, Playwright-engine, escaped, commented, and positional locator shapes fail closed',
  );
  assert(
    bridge._locatorBoxesAreStable(
      { x: 1, y: 2, width: 100, height: 20 },
      { x: 1.4, y: 2.4, width: 100.4, height: 20.4 },
    ) && !bridge._locatorBoxesAreStable(
      { x: 1, y: 2, width: 100, height: 20 },
      { x: 3, y: 2, width: 100, height: 20 },
    ),
    'stability comparison accepts subpixel drift and rejects material movement',
  );

  const stableElement = fakeElement();
  let waitedMs = 0;
  let disposedHandles = 0;
  const actionable = await bridge._inspectLocatorActionability(
    fakeLocator({
      elements: [stableElement, stableElement],
      onDispose: () => { disposedHandles += 1; },
    }),
    { waitForTimeout: async (ms: number) => { waitedMs += ms; } },
  );
  assert(
    waitedMs === 75
      && disposedHandles === 3
      && actionable.matchCount === 1
      && actionable.unique === true
      && actionable.visible === true
      && actionable.stable === true
      && actionable.enabled === true
      && actionable.editableRelevant === false
      && actionable.receivesEvents === true
      && actionable.obscured === false
      && actionable.actionable === true,
    'one stable enabled event-receiving button produces actionable evidence and disposes every sampled handle',
  );

  const obscuredElement = fakeElement({ hitSelf: false });
  const obscured = await bridge._inspectLocatorActionability(
    fakeLocator({ elements: [obscuredElement, obscuredElement] }),
    { waitForTimeout: async () => {} },
  );
  assert(
    obscured.receivesEvents === false
      && obscured.obscured === true
      && obscured.actionable === false,
    'an obscuring hit target prevents actionable evidence',
  );

  const textbox = fakeElement({ role: 'textbox', tagName: 'INPUT', type: 'text' });
  const readOnlyTextbox = await bridge._inspectLocatorActionability(
    fakeLocator({ elements: [textbox, textbox], editable: false }),
    { waitForTimeout: async () => {} },
  );
  assert(
    readOnlyTextbox.editableRelevant === true
      && readOnlyTextbox.editable === false
      && readOnlyTextbox.actionable === false,
    'editable controls fail actionability when they are not currently editable',
  );

  const replaced = await bridge._inspectLocatorActionability(
    fakeLocator({ elements: [fakeElement(), fakeElement()] }),
    { waitForTimeout: async () => {} },
  );
  assert(
    replaced.attached === false
      && replaced.stable === false
      && replaced.actionable === false,
    'a locator that resolves to a replacement node during sampling fails closed',
  );

  const ambiguous = await bridge._inspectLocatorActionability(
    fakeLocator({ counts: [2_500] }),
    { waitForTimeout: async () => {} },
  );
  assert(
    ambiguous.matchCount === 1_000
      && ambiguous.matchCountCapped === true
      && ambiguous.unique === false,
    'ambiguous match evidence is structurally capped and does not inspect candidates',
  );

  const swanbotSource = readFileSync(new URL('../src/lib/swanbot.ts', import.meta.url), 'utf8');
  const projectionStart = swanbotSource.indexOf(
    'export const SWANBOT_BROWSER_DOM_SNAPSHOT_TEXT_MAX_CHARS',
  );
  const projectionEnd = swanbotSource.indexOf(
    '\nasync function dispatchBrowserDomSnapshot',
    projectionStart,
  );
  const projectionSource = swanbotSource.slice(projectionStart, projectionEnd);
  const domDispatchStart = projectionEnd + 1;
  const domDispatchEnd = swanbotSource.indexOf(
    '\nasync function dispatchBrowserWpAdminSourceIntelligence',
    domDispatchStart,
  );
  const domDispatchSource = swanbotSource.slice(domDispatchStart, domDispatchEnd);
  const projectionModule = { exports: {} as Record<string, unknown> };
  const projectionJavaScript = typescript.transpileModule(
    projectionSource,
    {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  new Function('exports', 'module', projectionJavaScript)(
    projectionModule.exports,
    projectionModule,
  );
  const buildDomSnapshotResult = projectionModule.exports
    .buildSwanBotBrowserDomSnapshotResult as (
      rawData: unknown,
      renderedText: unknown,
      nowMs?: number,
    ) => { ok: boolean; data?: Record<string, unknown>; error?: string };

  const observedAt = '2026-07-27T12:00:00.000Z';
  const observedAtMs = Date.parse(observedAt);
  const longExpectedUrl = `uc_browser_url_${'a'.repeat(64)}`;
  const rawBrowserIdentity = {
    browserProcessId: `uc_browser_process_${'a'.repeat(160)}`,
    browserContextId: `uc_browser_context_${'b'.repeat(160)}`,
    pageId: `uc_browser_page_${'c'.repeat(160)}`,
    url: longExpectedUrl,
    displayUrl: 'https://example.test',
    observedAt,
    evidenceId: `uc_browser_evidence_${'d'.repeat(160)}`,
    title: 't'.repeat(3_000),
    nodeCount: 400,
    truncated: true,
    tree: { html: '<input value="SECRET_TREE_VALUE">' },
    html: '<input value="SECRET_HTML_VALUE">',
    source: '<script>SECRET_SOURCE_VALUE</script>',
    secret: 'SECRET_EXTRA_VALUE',
    expectedUrl: 'https://attacker.invalid/SECRET_DUPLICATE_URL',
  };
  const projectedIdentity = buildDomSnapshotResult(
    rawBrowserIdentity,
    'x'.repeat(20_000),
    observedAtMs,
  );
  const projectedData = projectedIdentity.data || {};
  const projectedKeys = Object.keys(projectedData).sort();
  const expectedProjectedKeys = [
    'browserContextId',
    'browserProcessId',
    'evidenceId',
    'expectedUrl',
    'mutationAuthorization',
    'nodeCount',
    'observedAt',
    'pageId',
    'readOnlyEvidence',
    'text',
    'title',
    'truncated',
    'url',
  ].sort();
  assert(
    projectionStart >= 0
      && projectionEnd > projectionStart
      && domDispatchEnd > domDispatchStart
      && typeof buildDomSnapshotResult === 'function'
      && projectedIdentity.ok === true
      && projectedKeys.join('|') === expectedProjectedKeys.join('|')
      && projectedData.browserProcessId === rawBrowserIdentity.browserProcessId
      && projectedData.browserContextId === rawBrowserIdentity.browserContextId
      && projectedData.pageId === rawBrowserIdentity.pageId
      && projectedData.url === 'https://example.test'
      && projectedData.expectedUrl === longExpectedUrl
      && projectedData.observedAt === observedAt
      && projectedData.evidenceId === rawBrowserIdentity.evidenceId,
    'SwanBot DOM projection preserves one exact opaque, fresh browser identity through a strict allowlist',
  );
  assert(
    domDispatchSource.includes('const text = renderBrowserTree(r.data.tree)')
      && domDispatchSource.includes('return buildSwanBotBrowserDomSnapshotResult(r.data, text)')
      && !domDispatchSource.includes('expectedUrl')
      && projectionSource.includes('browserProcessId: data.browserProcessId')
      && projectionSource.includes('browserContextId: data.browserContextId')
      && projectionSource.includes('pageId: data.pageId')
      && projectionSource.includes('observedAt,')
      && projectionSource.includes('evidenceId: data.evidenceId')
      && !projectionSource.includes('...data'),
    'dispatch projects the live DOM observation without fabricating a URL binding or spreading bridge fields',
  );
  assert(
    (projectedData.title as string).length === 2_000
      && (projectedData.text as string).length === 8_192
      && projectedData.truncated === true
      && projectedData.readOnlyEvidence === true
      && projectedData.mutationAuthorization === false
      && !Object.prototype.hasOwnProperty.call(projectedData, 'tree')
      && !Object.prototype.hasOwnProperty.call(projectedData, 'html')
      && !Object.prototype.hasOwnProperty.call(projectedData, 'source')
      && !Object.prototype.hasOwnProperty.call(projectedData, 'secret')
      && !JSON.stringify(projectedIdentity).includes('SECRET_'),
    'DOM projection clips existing fields and never expands raw tree, HTML, source, secret, or duplicate expectedUrl fields',
  );

  const invalidIdentityCases = [
    { ...rawBrowserIdentity, browserProcessId: 'too_short' },
    { ...rawBrowserIdentity, browserContextId: `uc_browser_context_${'b'.repeat(162)}` },
    { ...rawBrowserIdentity, pageId: `uc_browser_page_${'c'.repeat(20)}!` },
    { ...rawBrowserIdentity, evidenceId: `uc_browser_evidence_${'d'.repeat(161)}` },
    { ...rawBrowserIdentity, url: `uc_browser_url_${'u'.repeat(64)}` },
    { ...rawBrowserIdentity, observedAt: '0' },
    {
      ...rawBrowserIdentity,
      observedAt: new Date(observedAtMs - 30_001).toISOString(),
    },
    {
      ...rawBrowserIdentity,
      observedAt: new Date(observedAtMs + 5_001).toISOString(),
    },
  ];
  const invalidIdentityResults = invalidIdentityCases.map((candidate) => (
    buildDomSnapshotResult(candidate, 'SECRET_RENDERED_TEXT', observedAtMs)
  ));
  assert(
    invalidIdentityResults.every((result) => (
      result.ok === false
      && result.data === undefined
      && result.error === 'Browser DOM snapshot returned invalid or stale page identity. Re-observe after reconnecting the browser bridge.'
      && !JSON.stringify(result).includes('SECRET_')
    )),
    'malformed, oversized, stale, and future browser identities fail closed with one redacted recovery error',
  );

  const serializedIdentityText = serializeSwanBotClientToolResult(projectedIdentity);
  const serializedIdentity = JSON.parse(serializedIdentityText);
  assert(
    serializedIdentityText.length <= SWANBOT_CLIENT_TOOL_RESULT_MAX_CHARS
      && serializedIdentity.ok === true
      && serializedIdentity.truncated !== true
      && serializedIdentity.data.browserProcessId === rawBrowserIdentity.browserProcessId
      && serializedIdentity.data.browserContextId === rawBrowserIdentity.browserContextId
      && serializedIdentity.data.pageId === rawBrowserIdentity.pageId
      && serializedIdentity.data.url === 'https://example.test'
      && serializedIdentity.data.expectedUrl === longExpectedUrl
      && serializedIdentity.data.text.length === 8_192,
    'worst-case DOM identity plus grounding text remains under the existing SwanBot client result cap',
  );

  const clientSource = readFileSync(new URL('../src/lib/browserBridge.ts', import.meta.url), 'utf8');
  const parserStart = clientSource.indexOf('function isBoundedOpaqueBrowserId(');
  const parserEnd = clientSource.indexOf('\n// ─── Calls', parserStart);
  const parserModule = { exports: {} as Record<string, (value: unknown) => any> };
  const parserJavaScript = typescript.transpileModule(
    clientSource.slice(parserStart, parserEnd),
    {
      compilerOptions: {
        module: typescript.ModuleKind.CommonJS,
        target: typescript.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  new Function('exports', 'module', parserJavaScript)(
    parserModule.exports,
    parserModule,
  );
  const extractEvidence = parserModule.exports.extractBrowserLocatorActionabilityEvidence;
  const clientSelectorGuard = parserModule.exports.isNonPositionalBrowserCssSelector;
  const callableActionabilityInput = {
    expectedBrowserProcessId: projectedData.browserProcessId,
    expectedBrowserContextId: projectedData.browserContextId,
    expectedPageId: projectedData.pageId,
    expectedUrl: projectedData.expectedUrl,
    role: 'button',
    name: 'Save',
  };
  assert(
    projectedData.browserProcessId === callableActionabilityInput.expectedBrowserProcessId
      && projectedData.browserContextId === callableActionabilityInput.expectedBrowserContextId
      && projectedData.pageId === callableActionabilityInput.expectedPageId
      && projectedData.expectedUrl === callableActionabilityInput.expectedUrl
      && projectedData.url === 'https://example.test'
      && clientSelectorGuard('#save[data-kind="primary"]'),
    'projected DOM identity maps losslessly to locator_actionability expected* inputs without exposing the exact URL',
  );
  assert(
    clientSelectorGuard('#save[data-kind="primary"]')
      && !clientSelectorGuard('button >> nth=0')
      && !clientSelectorGuard('xpath=(//button)[1]')
      && !clientSelectorGuard('button:nth-match(1)')
      && !clientSelectorGuard(':/**/nth-child(1)')
      && !clientSelectorGuard('#save\\:nth-child'),
    'client and bridge both reject positional, engine, comment, and escape selector bypasses',
  );
  const validEvidence = {
    browserProcessId: `uc_browser_process_${'a'.repeat(30)}`,
    browserContextId: `uc_browser_context_${'b'.repeat(30)}`,
    pageId: `uc_browser_page_${'c'.repeat(30)}`,
    observedAt: new Date().toISOString(),
    evidenceId: `uc_browser_evidence_${'d'.repeat(30)}`,
    currentUrlOrigin: 'https://example.test',
    urlMatchesExpected: true,
    locatorKind: 'semantic',
    readOnlyEvidence: true,
    mutationAuthorization: false,
    matchCount: 1,
    matchCountCapped: false,
    unique: true,
    attached: true,
    visible: true,
    stable: true,
    stableWindowMs: 75,
    enabled: true,
    editableRelevant: false,
    editable: false,
    inViewport: true,
    receivesEvents: true,
    obscured: false,
    actionable: true,
    html: '<input value="SECRET">',
    selector: '#SECRET',
    value: 'SECRET',
  };
  const extracted = extractEvidence({ data: validEvidence });
  assert(
    extracted?.actionable === true
      && !JSON.stringify(extracted).includes('SECRET')
      && !Object.prototype.hasOwnProperty.call(extracted, 'html')
      && !Object.prototype.hasOwnProperty.call(extracted, 'selector')
      && !Object.prototype.hasOwnProperty.call(extracted, 'value'),
    'client parser reconstructs an allowlisted response and drops hostile secret fields',
  );
  assert(
    extractEvidence({ ...validEvidence, actionable: false }) === null
      && extractEvidence({ ...validEvidence, currentUrlOrigin: 'https://example.test?token=SECRET' }) === null
      && extractEvidence({ ...validEvidence, currentUrlOrigin: 'SECRET_NOT_AN_ORIGIN' }) === null
      && extractEvidence({ ...validEvidence, mutationAuthorization: true }) === null
      && extractEvidence({
        ...validEvidence,
        inViewport: false,
        receivesEvents: true,
        obscured: false,
      }) === null
      && extractEvidence({
        ...validEvidence,
        observedAt: new Date(Date.now() - 31_000).toISOString(),
      }) === null
      && extractEvidence({
        ...validEvidence,
        observedAt: new Date(Date.now() + 6_000).toISOString(),
      }) === null,
    'client parser rejects stale, future, contradictory, mutation-authorizing, and unsafe-origin evidence',
  );

  const bridgeSource = readFileSync(new URL('./browser-bridge.js', import.meta.url), 'utf8');
  const routerSource = readFileSync(new URL('./claude-bridge.js', import.meta.url), 'utf8');
  const runtimeSource = readFileSync(new URL('../src/lib/openswanToolRuntime.ts', import.meta.url), 'utf8');
  const dispatcherSource = readFileSync(new URL('../src/lib/swanbotClientToolDispatcher.ts', import.meta.url), 'utf8');
  const edgeSource = readFileSync(new URL('../supabase/functions/swanbot-v2-ai/index.ts', import.meta.url), 'utf8');

  const inspectStart = bridgeSource.indexOf('async function inspectLocatorActionability(');
  const handlerStart = bridgeSource.indexOf('async function handleLocatorActionability(');
  const handlerEnd = bridgeSource.indexOf('// ── Locator resolver', handlerStart);
  const producerSource = bridgeSource.slice(inspectStart, handlerEnd);
  const responseStart = producerSource.lastIndexOf('res.end(JSON.stringify({');
  const responseSource = producerSource.slice(responseStart);
  assert(
    inspectStart >= 0
      && handlerStart > inspectStart
      && handlerEnd > handlerStart
      && [
        '.click(',
        '.fill(',
        '.focus(',
        '.press(',
        '.check(',
        '.uncheck(',
        '.selectOption(',
        '.setInputFiles(',
        '.scrollIntoViewIfNeeded(',
      ].every((token) => !producerSource.includes(token)),
    'evidence producer contains no Playwright mutation or implicit-scroll calls',
  );
  assert(
    ['innerHTML', 'outerHTML', 'textContent', 'innerText'].every((token) => !producerSource.includes(token))
      && responseSource.includes('safeBrowserOrigin(currentUrl)')
      && !responseSource.includes('currentUrl,')
      && producerSource.includes('readOnlyEvidence: true')
      && producerSource.includes('mutationAuthorization: false'),
    'producer returns structural evidence and sanitized origin without DOM/page text or raw URL',
  );
  assert(
    producerSource.includes('guardHumanVerification(')
      && (producerSource.match(/checkIdentity\(\)/g) || []).length >= 3
      && producerSource.includes('activePage(launched.context)')
      && producerSource.includes('handleBefore.boundingBox()')
      && producerSource.includes('handleMiddle.boundingBox()')
      && producerSource.includes('handleAfter.isEnabled()')
      && !producerSource.includes('await ensureContext()'),
    'verification, three-sample stability, and entry/post-gate/exit identity gates run without launching UI',
  );
  assert(
    bridge._isNonPositionalNativeCssSelector('#save[data-kind="primary"]')
      && producerSource.includes('document.querySelectorAll(selector)')
      && producerSource.includes('pageRef.locator(`css=${body.selector}`)')
      && !bridge._isNonPositionalNativeCssSelector('button >> nth=0')
      && !bridge._isNonPositionalNativeCssSelector(':/**/nth-child(1)'),
    'selector path forces validated browser-native non-positional CSS',
  );
  assert(
    producerSource.includes("writeLocatorActionabilityFailure(res, CORS, 'ambiguous_locator'")
      && !producerSource.includes('writeAmbiguousLocator(')
      && !producerSource.includes('candidates:'),
    'ambiguity fails without leaking candidate names or snippets',
  );
  assert(
    routerSource.includes("p === '/browser/locator_actionability'")
      && routerSource.includes('browserBridge.handleLocatorActionability')
      && routerSource.indexOf("const token = req.headers['x-uc-desktop-token']")
        < routerSource.indexOf("p === '/browser/locator_actionability'"),
    'authenticated Claude bridge route reaches the read-only producer',
  );
  assert(
    clientSource.includes("'/browser/locator_actionability'")
      && clientSource.includes('extractBrowserLocatorActionabilityEvidence(raw.data)')
      && clientSource.includes('if (!raw.ok) return safeLocatorActionabilityFailure(raw)')
      && clientSource.includes('const opaqueExpectedUrl = isOpaqueBrowserUrlIdentity(args.expectedUrl)')
      && clientSource.includes('|| !opaqueExpectedUrl')
      && clientSource.includes('evidence.browserProcessId !== args.expectedBrowserProcessId')
      && clientSource.includes('evidence.browserContextId !== args.expectedBrowserContextId')
      && clientSource.includes('evidence.pageId !== args.expectedPageId')
      && producerSource.includes('!isBrowserUrlIdentity(body.expectedUrl)')
      && dispatcherSource.includes("case 'browser.locator_actionability'")
      && dispatcherSource.includes("await import('./browserBridge')")
      && dispatcherSource.includes('result.requiredEvidence?.length'),
    'bounded parsing, opaque-only URL identity, and actionable SwanBot recovery guidance are wired',
  );
  const runtimeDispatcherStart = runtimeSource.indexOf('async function dispatchOpenSwanRuntimeTool');
  const runtimeCaseStart = runtimeSource.indexOf("case 'browser.locator_actionability':", runtimeDispatcherStart);
  const runtimeCaseEnd = runtimeSource.indexOf("case 'browser.click_role':", runtimeCaseStart);
  const runtimeCaseSource = runtimeSource.slice(runtimeCaseStart, runtimeCaseEnd);
  const runtimeDefinitionStart = runtimeSource.indexOf("name: 'browser.locator_actionability'");
  const runtimeDefinitionEnd = runtimeSource.indexOf("name: 'browser.click_role'", runtimeDefinitionStart);
  const runtimeDefinitionSource = runtimeSource.slice(runtimeDefinitionStart, runtimeDefinitionEnd);
  const edgeDefinitionStart = edgeSource.indexOf('name: "browser.locator_actionability"');
  const edgeDefinitionEnd = edgeSource.indexOf('name: "browser.click_role"', edgeDefinitionStart);
  const edgeDefinitionSource = edgeSource.slice(edgeDefinitionStart, edgeDefinitionEnd);
  assert(
    runtimeSource.includes("name: 'browser.locator_actionability'")
      && runtimeSource.includes("'browser.locator_actionability': { reads: ['browser_page'] }")
      && runtimeSource.includes('Fresh identity for read-only target evidence: expectedBrowserProcessId=')
      && runtimeCaseSource.includes("const { locatorActionability } = await import('./browserBridge')")
      && !runtimeCaseSource.includes('a.name')
      && !runtimeCaseSource.includes('a.selector')
      && !runtimeCaseSource.includes('a.expectedUrl'),
    'OpenSwan registers a read-only tool and formats no raw locator or URL',
  );
  assert(
    [
      'expectedBrowserProcessId',
      'expectedBrowserContextId',
      'expectedPageId',
      'expectedUrl',
    ].every((field) => runtimeDefinitionSource.includes(field) && edgeDefinitionSource.includes(field))
      && runtimeDefinitionSource.includes('oneOf:')
      && edgeDefinitionSource.includes('oneOf:')
      && runtimeDefinitionSource.includes('additionalProperties: false')
      && edgeDefinitionSource.includes('additionalProperties: false')
      && !runtimeDefinitionSource.includes('nth:')
      && !edgeDefinitionSource.includes('nth:'),
    'OpenSwan and SwanBot schemas require fresh identity plus exact non-positional locator XOR',
  );
  const serverMutationStart = edgeSource.indexOf('SERVER_SIDE_MUTATION_TOOL_NAMES');
  const serverMutationEnd = edgeSource.indexOf(']);', serverMutationStart);
  const serverMutationSource = edgeSource.slice(serverMutationStart, serverMutationEnd);
  assert(
    edgeSource.includes('name: "browser.locator_actionability"')
      && edgeSource.includes('"browser.locator_actionability", "browser.set_toggle"')
      && edgeSource.includes('clientOnly: true')
      && !serverMutationSource.includes('browser.locator_actionability'),
    'SwanBot v2 exposes the evidence tool as client-only and never as a server mutation',
  );

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nbrowser-locator-actionability-smoketest: all assertions passed.');
}

void main();
