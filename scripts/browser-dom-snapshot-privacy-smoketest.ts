/**
 * Browser DOM snapshot privacy + identity handoff smoke.
 *
 * Offline: executes the production PAGE_WALKER against a tiny fake DOM,
 * evaluates SwanBot's production projection, and pins the bridge-issued URL
 * identity used by read-only locator actionability.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

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

type Attrs = Record<string, string>;
type ElementOptions = {
  value?: string;
  text?: string;
  aggregateText?: string;
  children?: any[];
  contentEditable?: boolean;
  style?: { display?: string; visibility?: string; opacity?: string };
  hidden?: boolean;
  inert?: boolean;
};

function textNode(value: string) {
  return {
    nodeType: 3,
    nodeValue: value,
    textContent: value,
    childNodes: [],
    children: [],
  };
}

function element(
  tagName: string,
  attrs: Attrs = {},
  options: ElementOptions = {},
) {
  const children = options.children || [];
  const directTextNodes = typeof options.text === 'string' ? [textNode(options.text)] : [];
  const childNodes = [...directTextNodes, ...children];
  const node: any = {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    children,
    childNodes,
    value: options.value || '',
    textContent: options.aggregateText ?? [
      options.text || '',
      ...children.map((child) => String(child?.textContent || '')),
    ].join(' '),
    id: attrs.id || '',
    disabled: false,
    hidden: options.hidden === true,
    inert: options.inert === true,
    isContentEditable: options.contentEditable === true,
    __style: options.style || {},
    labels: [],
    getAttribute: (name: string) => attrs[name] ?? null,
    hasAttribute: (name: string) => Object.prototype.hasOwnProperty.call(attrs, name),
    getBoundingClientRect: () => ({ width: 100, height: 20 }),
  };
  for (const child of childNodes) {
    if (child && typeof child === 'object') child.parentElement = node;
  }
  return node;
}

function runPageWalker(root: any) {
  const byId = new Map<string, any>();
  const labelsByFor = new Map<string, any>();
  const index = (node: any) => {
    if (!node || node.nodeType !== 1) return;
    if (node.id) byId.set(node.id, node);
    const labelFor = node.tagName === 'LABEL' ? node.getAttribute('for') : null;
    if (labelFor) labelsByFor.set(labelFor, node);
    for (const child of node.children || []) index(child);
  };
  index(root);
  const document = {
    body: root,
    documentElement: root,
    location: { href: 'https://example.test/app?private=bridge-only#state' },
    title: 'Privacy fixture',
    getElementById: (id: string) => byId.get(id) || null,
    querySelector: (selector: string) => {
      const match = selector.match(/^label\[for="(.+)"\]$/);
      return match ? labelsByFor.get(match[1]) || null : null;
    },
  };
  const window = {
    getComputedStyle: (node: any) => ({
      display: node?.__style?.display || 'block',
      visibility: node?.__style?.visibility || 'visible',
      opacity: node?.__style?.opacity || '1',
    }),
  };
  const CSS = { escape: (value: string) => value };
  return new Function(
    'document',
    'window',
    'CSS',
    `return (${bridge._PAGE_WALKER})({ maxNodes: 100, interestingOnly: false });`,
  )(document, window, CSS);
}

function loadSwanBotProjection() {
  const source = readFileSync(new URL('../src/lib/swanbot.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export const SWANBOT_BROWSER_DOM_SNAPSHOT_TEXT_MAX_CHARS');
  const end = source.indexOf('\nasync function dispatchBrowserDomSnapshot', start);
  const module = { exports: {} as Record<string, unknown> };
  const javascript = typescript.transpileModule(source.slice(start, end), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
    },
  }).outputText;
  new Function('exports', 'module', javascript)(module.exports, module);
  return module.exports as {
    buildSwanBotBrowserDomSnapshotResult: (
      rawData: unknown,
      renderedText: unknown,
      nowMs?: number,
    ) => { ok: boolean; data?: Record<string, unknown>; error?: string };
    sanitizeSwanBotBrowserDomText: (value: unknown, maxLength: number) => string;
  };
}

function loadBrowserClientSanitizer() {
  const source = readFileSync(new URL('../src/lib/browserBridge.ts', import.meta.url), 'utf8');
  const start = source.indexOf('function isSanitizedBrowserOrigin(');
  const end = source.indexOf('\nfunction parseBoundedBrowserIdentity(', start);
  const module = { exports: {} as Record<string, unknown> };
  const javascript = typescript.transpileModule(source.slice(start, end), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2020,
    },
  }).outputText;
  new Function('exports', 'module', 'sanitizeUntrustedForModel', javascript)(
    module.exports,
    module,
    (value: string) => value,
  );
  return module.exports as {
    sanitizeBrowserSnapshotModelText: (value: unknown, maxLength: number) => string;
    isOpaqueBrowserUrlIdentity: (value: unknown) => boolean;
  };
}

async function main() {
  const secrets = {
    password: 'SuperSecretPassword!',
    token: 'tok_live_123456789',
    email: 'private.person@example.test',
    tel: '+1-555-867-5309',
    card: '4111111111111111',
    otp: '804219',
    username: 'private-login-name',
    apiSecret: 'sk-private-987654',
  };
  const genericValues = {
    search: 'ordinary grounding query',
    notes: 'GENERIC_NOTES_FIELD_SECRET',
    date: '2037-11-29',
    file: '/Users/private/Secret Upload.pdf',
    select: 'internal-account-id-8932',
    contentEditable: 'CONTENTEDITABLE_PRIVATE_DRAFT',
    labelledPassword: 'LABEL_ONLY_PASSWORD_VALUE',
  };
  const hiddenSecrets = [
    'HIDDEN_SCRIPT_BOOTSTRAP_SECRET',
    'HIDDEN_STYLE_SECRET',
    'HIDDEN_TEMPLATE_SECRET',
    'HIDDEN_NOSCRIPT_SECRET',
    'ARIA_HIDDEN_SECRET',
    'INERT_DESCENDANT_SECRET',
    'DISPLAY_NONE_SECRET',
  ];
  const root = element('main', {}, {
    // A real container textContent aggregates hidden/source/form descendants.
    // It must never be copied wholesale into an ancestor accessible name.
    aggregateText: [
      'Checkout dashboard',
      ...Object.values(secrets),
      ...Object.values(genericValues),
      ...hiddenSecrets,
    ].join(' '),
    children: [
      element('h1', {}, {
        children: [element('span', {}, { text: 'Checkout dashboard' })],
      }),
      element('p', {}, { text: 'Ordinary direct visible copy' }),
      element('button', {}, {
        children: [element('span', {}, { text: 'Continue safely' })],
      }),
      element('input', { type: 'submit' }, { value: 'Continue' }),
      element('input', { type: 'search', name: 'catalog_search' }, { value: genericValues.search }),
      element('input', { type: 'text', name: 'notes', 'aria-label': 'Notes' }, { value: genericValues.notes }),
      element('input', { type: 'date', 'aria-label': 'Due date' }, { value: genericValues.date }),
      element('input', { type: 'file', 'aria-label': 'Upload attachment' }, { value: genericValues.file }),
      element('select', { name: 'locale', 'aria-label': 'Locale' }, { value: genericValues.select }),
      element('div', { 'aria-label': 'Draft editor' }, {
        value: genericValues.contentEditable,
        text: genericValues.contentEditable,
        contentEditable: true,
      }),
      element('label', { for: 'label-only-field' }, { text: 'Password' }),
      element('input', { type: 'text', id: 'label-only-field' }, { value: genericValues.labelledPassword }),
      element(
        'input',
        { type: 'password', role: `textbox ${secrets.password}`, 'aria-label': secrets.password },
        { value: secrets.password },
      ),
      element('input', { type: 'text', name: 'accessToken' }, { value: secrets.token }),
      element('input', { type: 'email', name: 'contactEmail' }, { value: secrets.email }),
      element('input', { type: 'tel', autocomplete: 'tel' }, { value: secrets.tel }),
      element('input', { type: 'text', autocomplete: 'cc-number' }, { value: secrets.card }),
      element('input', { type: 'text', autocomplete: 'one-time-code' }, { value: secrets.otp }),
      element('input', { type: 'text', name: 'userName' }, { value: secrets.username }),
      element('textarea', { name: 'apiSecret' }, { value: secrets.apiSecret, text: secrets.apiSecret }),
      element('script', {}, { text: hiddenSecrets[0] }),
      element('style', {}, { text: hiddenSecrets[1] }),
      element('template', {}, { text: hiddenSecrets[2] }),
      element('noscript', {}, { text: hiddenSecrets[3] }),
      element('div', { 'aria-hidden': 'true' }, { text: hiddenSecrets[4] }),
      element('div', {}, { text: hiddenSecrets[5], inert: true }),
      element('div', {}, { text: hiddenSecrets[6], style: { display: 'none' } }),
    ],
  });
  const walked = runPageWalker(root);
  const serializedTree = JSON.stringify(walked);
  assert(
    [...Object.values(secrets), ...Object.values(genericValues), ...hiddenSecrets]
      .every((secret) => !serializedTree.includes(secret)),
    'PAGE_WALKER emits no editable value or hidden/script/style/template/noscript/inert text',
  );
  assert(
    serializedTree.includes('Checkout dashboard')
      && serializedTree.includes('Ordinary direct visible copy')
      && serializedTree.includes('Continue safely')
      && serializedTree.includes('"value":"Continue"'),
    'PAGE_WALKER preserves useful headings, nested button names, direct visible copy, and non-editable action labels',
  );
  const redactedNodes: any[] = [];
  const allNodes: any[] = [];
  const collect = (node: any) => {
    if (!node) return;
    allNodes.push(node);
    if (node.valueRedacted === true) redactedNodes.push(node);
    for (const child of node.children || []) collect(child);
  };
  collect(walked.tree);
  assert(
    redactedNodes.length === 15
      && redactedNodes.every((node) => (
        Number.isSafeInteger(node.valueLength)
        && node.valueLength >= 0
        && node.valueLength <= 1_000_000
        && !Object.prototype.hasOwnProperty.call(node, 'value')
      )),
    'every editable control exposes only controlled structure and bounded value length',
  );
  assert(
    redactedNodes.some((node) => node.sensitiveKind === 'password' && node.name === 'Password field')
      && redactedNodes.filter((node) => node.sensitiveKind === 'password').length === 2
      && !serializedTree.includes(`"name":"${secrets.password}"`),
    'hostile aria-label/role and label-only password semantics produce controlled field labels',
  );
  assert(
    allNodes.every((node) => (
      typeof node.role === 'string'
      && node.role.length > 0
      && node.role.length <= 40
      && /^[a-z]+$/.test(node.role)
    )),
    'every emitted role is a bounded canonical role rather than attacker-controlled role text',
  );

  const exactUrl =
    'https://alice:RawPassword@example.test/checkout?access_token=query-secret&email=private%40example.test#otp=804219';
  const expectedUrl = bridge._buildBrowserUrlIdentity(exactUrl);
  const codecA = bridge._createBrowserUrlIdentityCodec({ key: Buffer.alloc(32, 0x11) });
  const codecARestartSameKey = bridge._createBrowserUrlIdentityCodec({ key: Buffer.alloc(32, 0x11) });
  const codecB = bridge._createBrowserUrlIdentityCodec({ key: Buffer.alloc(32, 0x22) });
  const codecAIdentity = codecA.build(exactUrl);
  assert(
    /^uc_browser_url_[a-f0-9]{64}$/.test(expectedUrl)
      && !expectedUrl.includes('alice')
      && !expectedUrl.includes('query-secret')
      && codecAIdentity === codecA.build(exactUrl)
      && codecAIdentity === codecARestartSameKey.build(exactUrl)
      && codecAIdentity !== codecB.build(exactUrl),
    'bridge emits a stable same-key opaque URL identity that rotates with the process key',
  );
  assert(
    bridge._browserOpaqueUrlIdentityMatches(expectedUrl, exactUrl)
      && !bridge._browserOpaqueUrlIdentityMatches(expectedUrl, exactUrl.replace('query-secret', 'drifted'))
      && !bridge._browserOpaqueUrlIdentityMatches(expectedUrl, `${exactUrl}#changed`)
      && !bridge._browserOpaqueUrlIdentityMatches(`uc_browser_url_${'0'.repeat(64)}`, exactUrl)
      && !bridge._browserOpaqueUrlIdentityMatches(exactUrl, exactUrl)
      && codecA.matches(codecAIdentity, exactUrl)
      && !codecB.matches(codecAIdentity, exactUrl),
    'strict opaque URL identity accepts only the exact keyed URL and rejects raw, forged, query, fragment, and restart-key drift',
  );

  const registry = bridge._createBrowserIdentityRegistry({
    randomUUID: () => 'snapshot-privacy-fixture-00000000',
    now: () => '2026-07-27T12:00:00.000Z',
  });
  const contextRef = {};
  const pageRef = { isClosed: () => false, url: () => exactUrl };
  const identity = registry.observe(contextRef, pageRef, exactUrl);
  const expectedIdentity = {
    expectedBrowserContextId: identity.browserContextId,
    expectedPageId: identity.pageId,
    expectedUrl,
  };
  assert(
    bridge._checkExpectedBrowserFillIdentity(
      registry,
      contextRef,
      pageRef,
      expectedIdentity,
      pageRef,
    ).ok === true,
    'same live page accepts the DOM-issued opaque identity for later actionability',
  );
  registry.advancePageDocument(pageRef);
  assert(
    bridge._checkExpectedBrowserFillIdentity(
      registry,
      contextRef,
      pageRef,
      expectedIdentity,
      pageRef,
    ).ok === false,
    'page identity drift invalidates the DOM-to-actionability handoff',
  );

  const stableRegistry = bridge._createBrowserIdentityRegistry({
    randomUUID: () => 'snapshot-coherence-stable-000000',
    now: () => '2026-07-27T12:00:00.000Z',
  });
  const stableContext = {};
  const stablePage = { isClosed: () => false, url: () => exactUrl };
  const stableCapture = await bridge._captureCoherentBrowserDomSnapshot({
    registry: stableRegistry,
    contextRef: stableContext,
    pageRef: stablePage,
    resolveActivePage: () => stablePage,
    evaluateSnapshot: async () => ({
      documentUrl: exactUrl,
      title: 'Stable title',
      tree: { id: '0', role: 'document' },
      nodeCount: 1,
      totalNodes: 1,
      truncated: false,
    }),
  });
  assert(
    stableCapture.ok === true
      && stableCapture.identity.url === exactUrl
      && stableCapture.displayUrl === 'https://example.test'
      && stableCapture.snapshot.title === 'Stable title',
    'coherent capture returns one stable HTTP(S) tree/title/document identity envelope',
  );

  const pageDriftRegistry = bridge._createBrowserIdentityRegistry({
    randomUUID: () => 'snapshot-coherence-page-drift-00',
    now: () => '2026-07-27T12:00:00.000Z',
  });
  const pageDriftContext = {};
  const pageDriftPage = { isClosed: () => false, url: () => exactUrl };
  const pageDriftCapture = await bridge._captureCoherentBrowserDomSnapshot({
    registry: pageDriftRegistry,
    contextRef: pageDriftContext,
    pageRef: pageDriftPage,
    resolveActivePage: () => pageDriftPage,
    evaluateSnapshot: async () => {
      pageDriftRegistry.advancePageDocument(pageDriftPage);
      return {
        documentUrl: exactUrl,
        title: 'Old document',
        tree: { id: '0', role: 'document' },
      };
    },
  });

  let liveUrl = exactUrl;
  const urlDriftRegistry = bridge._createBrowserIdentityRegistry({
    randomUUID: () => 'snapshot-coherence-url-drift-000',
    now: () => '2026-07-27T12:00:00.000Z',
  });
  const urlDriftContext = {};
  const urlDriftPage = { isClosed: () => false, url: () => liveUrl };
  const urlDriftCapture = await bridge._captureCoherentBrowserDomSnapshot({
    registry: urlDriftRegistry,
    contextRef: urlDriftContext,
    pageRef: urlDriftPage,
    resolveActivePage: () => urlDriftPage,
    evaluateSnapshot: async () => {
      liveUrl = exactUrl.replace('query-secret', 'spa-drift');
      return {
        documentUrl: exactUrl,
        title: 'Old SPA state',
        tree: { id: '0', role: 'document' },
      };
    },
  });

  const activeDriftRegistry = bridge._createBrowserIdentityRegistry({
    randomUUID: () => 'snapshot-coherence-tab-drift-000',
    now: () => '2026-07-27T12:00:00.000Z',
  });
  const activeDriftContext = {};
  const activeDriftPage = { isClosed: () => false, url: () => exactUrl };
  const otherPage = { isClosed: () => false, url: () => 'https://other.test/' };
  let activeChecks = 0;
  const activeDriftCapture = await bridge._captureCoherentBrowserDomSnapshot({
    registry: activeDriftRegistry,
    contextRef: activeDriftContext,
    pageRef: activeDriftPage,
    resolveActivePage: () => (++activeChecks === 1 ? activeDriftPage : otherPage),
    evaluateSnapshot: async () => ({
      documentUrl: exactUrl,
      title: 'Tab changed',
      tree: { id: '0', role: 'document' },
    }),
  });

  let unsupportedEvaluated = false;
  const unsupportedRegistry = bridge._createBrowserIdentityRegistry({
    randomUUID: () => 'snapshot-coherence-about-0000000',
    now: () => '2026-07-27T12:00:00.000Z',
  });
  const unsupportedContext = {};
  const unsupportedPage = { isClosed: () => false, url: () => 'about:blank' };
  const unsupportedCapture = await bridge._captureCoherentBrowserDomSnapshot({
    registry: unsupportedRegistry,
    contextRef: unsupportedContext,
    pageRef: unsupportedPage,
    resolveActivePage: () => unsupportedPage,
    evaluateSnapshot: async () => {
      unsupportedEvaluated = true;
      return {
        documentUrl: 'about:blank',
        title: '',
        tree: { id: '0', role: 'document' },
      };
    },
  });
  assert(
    pageDriftCapture.ok === false
      && urlDriftCapture.ok === false
      && activeDriftCapture.ok === false
      && unsupportedCapture.ok === false
      && unsupportedEvaluated === false
      && [pageDriftCapture, urlDriftCapture, activeDriftCapture, unsupportedCapture]
        .every((result) => result.code === 'browser_identity_mismatch'),
    'page-generation, exact-URL, active-tab, and non-HTTP drift fail closed without returning a tree',
  );

  const {
    buildSwanBotBrowserDomSnapshotResult,
    sanitizeSwanBotBrowserDomText,
  } = loadSwanBotProjection();
  const observedAt = '2026-07-27T12:00:00.000Z';
  const rawData = {
    browserProcessId: 'uc_browser_process_snapshot_privacy_1',
    browserContextId: 'uc_browser_context_snapshot_privacy_2',
    pageId: 'uc_browser_page_snapshot_privacy_3',
    evidenceId: 'uc_browser_evidence_snapshot_privacy_4',
    observedAt,
    url: expectedUrl,
    displayUrl: 'https://example.test',
    title: `Checkout ${exactUrl} token=title-secret`,
    nodeCount: 9,
    truncated: false,
    tree: { value: secrets.password },
    html: `<input value="${secrets.card}">`,
    source: `email=${secrets.email}`,
    secret: secrets.token,
  };
  const projection = buildSwanBotBrowserDomSnapshotResult(
    rawData,
    `Checkout dashboard\n${exactUrl}\npassword=rendered-secret\nordinary visible copy`,
    Date.parse(observedAt),
  );
  const projectionText = JSON.stringify(projection);
  const data = projection.data || {};
  assert(
    projection.ok === true
      && data.url === 'https://example.test'
      && data.expectedUrl === expectedUrl
      && data.readOnlyEvidence === true
      && data.mutationAuthorization === false,
    'SwanBot returns sanitized display URL plus exact opaque read-only identity with no mutation authority',
  );
  assert(
    !projectionText.includes('alice')
      && !projectionText.includes('RawPassword')
      && !projectionText.includes('query-secret')
      && !projectionText.includes('title-secret')
      && !projectionText.includes('rendered-secret')
      && !projectionText.includes(secrets.password)
      && !projectionText.includes(secrets.card)
      && !projectionText.includes(secrets.email)
      && !projectionText.includes(secrets.token)
      && projectionText.includes('Checkout dashboard')
      && projectionText.includes('ordinary visible copy'),
    'model-visible URL/title/text drops URL secrets and hostile raw fields while preserving regular grounding text',
  );
  assert(
    Object.keys(data).sort().join('|') === [
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
    ].sort().join('|')
      && String(data.text || '').length <= 8_192
      && String(data.title || '').length <= 2_000,
    'SwanBot projection is allowlisted and bounded',
  );

  const {
    sanitizeBrowserSnapshotModelText,
    isOpaqueBrowserUrlIdentity,
  } = loadBrowserClientSanitizer();
  const urlLeakFixture = [
    'ordinary visible copy',
    'https://alice:pw@example.test/private/path?arbitrary=ABSOLUTE_SECRET#ABSOLUTE_FRAGMENT',
    '//alice:pw@example.test/private/path?arbitrary=PROTOCOL_SECRET#PROTOCOL_FRAGMENT',
    './private/report?arbitrary=RELATIVE_SECRET#RELATIVE_FRAGMENT',
    '/reset/account?arbitrary=ROOT_RELATIVE_SECRET',
    'mailto:private-mail@example.test',
    'tel:+15558675309',
    'data:text/plain;base64,DATA_URL_SECRET',
    'blob:https://example.test/BLOB_URL_SECRET',
    'javascript:alert(JAVASCRIPT_URL_SECRET)',
    'file:///Users/private/FILE_URL_SECRET.txt',
    'settings?arbitrary=INLINE_QUERY_SECRET#fragment=INLINE_FRAGMENT_SECRET',
    'ordinary&arbitrary=INLINE_AMPERSAND_SECRET',
    'refresh_token=REFRESH_TOKEN_SECRET',
    'client-secret=CLIENT_SECRET_VALUE',
    'private_key=PRIVATE_KEY_VALUE',
    'ssn=SOCIAL_SECURITY_VALUE',
    'session_id=ASSIGNMENT_SECRET',
  ].join(' ');
  const sanitizedUrlOutputs = [
    bridge._sanitizeBrowserSnapshotText(urlLeakFixture, 20_000),
    sanitizeBrowserSnapshotModelText(urlLeakFixture, 20_000),
    sanitizeSwanBotBrowserDomText(urlLeakFixture, 20_000),
  ];
  const urlSecrets = [
    'alice',
    'ABSOLUTE_SECRET',
    'ABSOLUTE_FRAGMENT',
    'PROTOCOL_SECRET',
    'PROTOCOL_FRAGMENT',
    'RELATIVE_SECRET',
    'RELATIVE_FRAGMENT',
    'ROOT_RELATIVE_SECRET',
    'private-mail',
    '15558675309',
    'DATA_URL_SECRET',
    'BLOB_URL_SECRET',
    'JAVASCRIPT_URL_SECRET',
    'FILE_URL_SECRET',
    'INLINE_QUERY_SECRET',
    'INLINE_FRAGMENT_SECRET',
    'INLINE_AMPERSAND_SECRET',
    'REFRESH_TOKEN_SECRET',
    'CLIENT_SECRET_VALUE',
    'PRIVATE_KEY_VALUE',
    'SOCIAL_SECURITY_VALUE',
    'ASSIGNMENT_SECRET',
  ];
  assert(
    sanitizedUrlOutputs.every((output) => (
      urlSecrets.every((secret) => !output.includes(secret))
      && output.includes('ordinary visible copy')
      && output.includes('https://example.test')
      && output.includes('//example.test')
    )),
    'bridge, client, and SwanBot sanitizers strip absolute/protocol-relative/relative/special-scheme URL secrets consistently',
  );

  const rawUrlProjection = buildSwanBotBrowserDomSnapshotResult(
    { ...rawData, url: exactUrl },
    'SECRET_RAW_URL_PROJECTION',
    Date.parse(observedAt),
  );
  const fileDisplayProjection = buildSwanBotBrowserDomSnapshotResult(
    { ...rawData, displayUrl: 'file:///Users/private/secret.txt' },
    'SECRET_FILE_PROJECTION',
    Date.parse(observedAt),
  );
  assert(
    rawUrlProjection.ok === false
      && fileDisplayProjection.ok === false
      && bridge._safeHttpBrowserOrigin('https://alice:pw@example.test/path?secret=yes') === 'https://example.test'
      && bridge._safeHttpBrowserOrigin('about:blank') === null
      && bridge._safeHttpBrowserOrigin('file:///Users/private/secret.txt') === null
      && bridge._safeHttpBrowserOrigin('data:text/plain,secret') === null,
    'raw URL identities and non-HTTP display schemes fail closed while HTTP(S) display stays origin-only',
  );

  const clientSource = readFileSync(new URL('../src/lib/browserBridge.ts', import.meta.url), 'utf8');
  const bridgeSource = readFileSync(new URL('./browser-bridge.js', import.meta.url), 'utf8');
  const actionabilityHandlerStart = bridgeSource.indexOf('async function handleLocatorActionability(');
  const actionabilityHandlerEnd = bridgeSource.indexOf('// ── Locator resolver', actionabilityHandlerStart);
  const actionabilityHandler = bridgeSource.slice(actionabilityHandlerStart, actionabilityHandlerEnd);
  const clientActionabilityStart = clientSource.indexOf('export async function locatorActionability(');
  const clientActionabilityEnd = clientSource.indexOf(
    '\nconst VERIFICATION_GATE_HINT',
    clientActionabilityStart,
  );
  const clientActionability = clientSource.slice(clientActionabilityStart, clientActionabilityEnd);
  assert(
    isOpaqueBrowserUrlIdentity(expectedUrl)
      && !isOpaqueBrowserUrlIdentity(exactUrl)
      && !clientSource.includes('legacySafeUrl')
      && clientSource.includes('if (!identity || !isOpaqueBrowserUrlIdentity(expectedUrl))')
      && clientActionability.includes('|| !opaqueExpectedUrl')
      && actionabilityHandler.includes('!isBrowserUrlIdentity(body.expectedUrl)'),
    'new DOM-to-actionability path rejects legacy/raw URL compatibility at client and bridge boundaries',
  );

  if (failures > 0) {
    console.error(`\n${failures} assertion(s) failed.`);
    process.exit(1);
  }
  console.log('\nbrowser-dom-snapshot-privacy-smoketest: all assertions passed.');
}

void main();
