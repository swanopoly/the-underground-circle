/**
 * Browser open-url durable mutation gateway smoke.
 *
 * Run:
 *   npx tsx scripts/browser-open-url-mutation-gateway-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://browser-open-url-gateway.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'browser-open-url-gateway-anon-key';

const NATIVE_STUBS = new Set([
  'react-native',
  '@react-native-async-storage/async-storage',
]);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) {
      return { url: STUB_URL, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const PROCESS_ID = 'uc_browser_process_1234567890';
const CONTEXT_ID = 'uc_browser_context_1234567890';
const BEFORE_PAGE_ID = 'uc_browser_page_before_1234567890';
const AFTER_PAGE_ID = 'uc_browser_page_after_1234567890';
const HEALTH_EVIDENCE_ID = 'uc_browser_evidence_health_1234567890';
const OPEN_EVIDENCE_ID = 'uc_browser_evidence_open_1234567890';
const SNAPSHOT_EVIDENCE_ID = 'uc_browser_evidence_snapshot_1234567890';
const OPAQUE_URL = `uc_browser_url_${'a'.repeat(64)}`;

function functionBody(source: string, name: string, nextName: string): string {
  const start = source.indexOf(`async function ${name}`);
  const end = source.indexOf(`async function ${nextName}`, start + 1);
  assert(start >= 0 && end > start, `${name} source body found`);
  return source.slice(start, end);
}

async function main(): Promise<void> {
  const imported = await import('../src/lib/openswanToolRuntime');
  const runtime = ((imported as { default?: typeof imported }).default || imported);

  assert.equal(
    runtime.getOpenSwanToolPolicy('browser.open_url').mutationAuthority,
    'action_ledger',
    'browser.open_url advertises durable action-ledger authority only after gateway wiring',
  );

  const warmRawUrl = 'https://before.example/private?token=never-persist-this';
  const warm = await runtime.bindOpenSwanBrowserOpenUrlHealth({
    ok: true,
    contextOpen: true,
    browserProcessId: PROCESS_ID,
    browserContextId: CONTEXT_ID,
    pageId: BEFORE_PAGE_ID,
    currentUrl: warmRawUrl,
    url: warmRawUrl,
    observedAt: '2026-08-06T12:00:00.000Z',
    evidenceId: HEALTH_EVIDENCE_ID,
  });
  assert(warm && warm.mode === 'warm', 'warm browser health binds exactly');
  assert.equal(warm.browserContextId, CONTEXT_ID);
  assert.equal(warm.pageId, BEFORE_PAGE_ID);
  assert.match(warm.urlIdentity, /^sha256:[a-f0-9]{64}$/);
  assert(!JSON.stringify(warm).includes('never-persist-this'), 'warm binding contains no raw URL');

  const cold = await runtime.bindOpenSwanBrowserOpenUrlHealth({
    ok: true,
    contextOpen: false,
    browserProcessId: PROCESS_ID,
    browserContextId: null,
    pageId: null,
    currentUrl: null,
    url: '',
    observedAt: '2026-08-06T12:00:00.000Z',
    evidenceId: HEALTH_EVIDENCE_ID,
  });
  assert(cold && cold.mode === 'cold', 'explicit cold-context absence binds exactly');
  assert.equal(cold.browserContextId, null);
  assert.equal(cold.pageId, null);
  assert.match(cold.urlIdentity, /explicitly_absent/);

  assert.equal(
    await runtime.bindOpenSwanBrowserOpenUrlHealth({
      ok: true,
      contextOpen: false,
      browserProcessId: PROCESS_ID,
      browserContextId: CONTEXT_ID,
      pageId: null,
      currentUrl: null,
      url: '',
      observedAt: '2026-08-06T12:00:00.000Z',
      evidenceId: HEALTH_EVIDENCE_ID,
    }),
    null,
    'incoherent cold health fails closed',
  );

  const finalRawUrl = 'https://example.com/path?secret=not-in-proof#private';
  const warmProof = runtime.resolveOpenSwanBrowserOpenUrlProof({
    before: warm,
    openResult: {
      browserProcessId: PROCESS_ID,
      browserContextId: CONTEXT_ID,
      pageId: AFTER_PAGE_ID,
      url: finalRawUrl,
      title: 'Example title',
      observedAt: '2026-08-06T12:00:01.000Z',
      evidenceId: OPEN_EVIDENCE_ID,
    },
    snapshot: {
      browserProcessId: PROCESS_ID,
      browserContextId: CONTEXT_ID,
      pageId: AFTER_PAGE_ID,
      url: OPAQUE_URL,
      displayUrl: 'https://example.com',
      title: 'Example title',
      observedAt: '2026-08-06T12:00:02.000Z',
      evidenceId: SNAPSHOT_EVIDENCE_ID,
    },
  });
  assert(warmProof, 'warm navigation proves one coherent post-navigation document');
  assert.equal(warmProof.previousPageId, BEFORE_PAGE_ID);
  assert.equal(warmProof.pageId, AFTER_PAGE_ID);
  assert.equal(warmProof.pageIdRotated, true);
  assert.equal(warmProof.url, OPAQUE_URL);
  assert(!JSON.stringify(warmProof).includes('not-in-proof'), 'proof contains no raw URL');

  assert.equal(
    runtime.resolveOpenSwanBrowserOpenUrlProof({
      before: warm,
      openResult: {
        browserProcessId: PROCESS_ID,
        browserContextId: CONTEXT_ID,
        pageId: BEFORE_PAGE_ID,
        url: finalRawUrl,
        title: 'Example title',
        observedAt: '2026-08-06T12:00:01.000Z',
        evidenceId: OPEN_EVIDENCE_ID,
      },
      snapshot: {
        browserProcessId: PROCESS_ID,
        browserContextId: CONTEXT_ID,
        pageId: BEFORE_PAGE_ID,
        url: OPAQUE_URL,
        displayUrl: 'https://example.com',
        title: 'Example title',
        observedAt: '2026-08-06T12:00:02.000Z',
        evidenceId: SNAPSHOT_EVIDENCE_ID,
      },
    }),
    null,
    'warm navigation without page/document rotation is not verified',
  );

  assert(cold, 'cold binding available');
  const coldProof = runtime.resolveOpenSwanBrowserOpenUrlProof({
    before: cold,
    openResult: {
      browserProcessId: PROCESS_ID,
      browserContextId: CONTEXT_ID,
      pageId: AFTER_PAGE_ID,
      url: finalRawUrl,
      title: '',
      observedAt: '2026-08-06T12:00:01.000Z',
      evidenceId: OPEN_EVIDENCE_ID,
    },
    snapshot: {
      browserProcessId: PROCESS_ID,
      browserContextId: CONTEXT_ID,
      pageId: AFTER_PAGE_ID,
      url: OPAQUE_URL,
      displayUrl: 'https://example.com',
      title: '',
      observedAt: '2026-08-06T12:00:02.000Z',
      evidenceId: SNAPSHOT_EVIDENCE_ID,
    },
  });
  assert(coldProof && coldProof.previousPageId === null, 'cold absence advances to one proved document');

  assert.equal(
    runtime.resolveOpenSwanBrowserOpenUrlProof({
      before: cold,
      openResult: {
        browserProcessId: PROCESS_ID,
        browserContextId: CONTEXT_ID,
        pageId: AFTER_PAGE_ID,
        url: finalRawUrl,
        title: '',
        observedAt: '2026-08-06T12:00:01.000Z',
        evidenceId: OPEN_EVIDENCE_ID,
      },
      snapshot: {
        browserProcessId: PROCESS_ID,
        browserContextId: CONTEXT_ID,
        pageId: AFTER_PAGE_ID,
        url: finalRawUrl,
        displayUrl: 'https://example.com',
        title: '',
        observedAt: '2026-08-06T12:00:02.000Z',
        evidenceId: SNAPSHOT_EVIDENCE_ID,
      },
    }),
    null,
    'raw post-navigation URL can never serve as proof',
  );

  const source = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
  const prepareBody = functionBody(
    source,
    'prepareGuardedBrowserOpenUrl',
    'prepareGuardedBrowserFill',
  );
  assert(
    prepareBody.indexOf('hasAuthenticatedPersistedOpenSwanCallIdentity')
      < prepareBody.indexOf('getBrowserHealth'),
    'authenticated persisted call identity is checked before browser observation',
  );
  assert.match(prepareBody, /destinationUrlSha256/);
  assert(!prepareBody.includes('currentUrl,'), 'raw observed URL is never copied into approval args');

  const executeBody = functionBody(
    source,
    'executeGuardedBrowserOpenUrl',
    'executeGuardedBrowserFill',
  );
  assert.match(executeBody, /buildComputerAppToolArgsFingerprintAsync/);
  assert.match(executeBody, /outcomeUnknownPolicy: 'never_retry'/);
  assert.match(executeBody, /dispatchDurableComputerAppMutation/);
  assert.equal((executeBody.match(/\bopenUrl\(/g) || []).length, 1, 'gateway contains exactly one navigation call');
  assert(
    executeBody.indexOf('getBrowserHealth()') < executeBody.indexOf('openUrl(')
      && executeBody.indexOf('openUrl(') < executeBody.indexOf('domSnapshot('),
    'handler rechecks identity, navigates once, then collects proof',
  );
  assert.match(executeBody, /outcome is unknown[\s\S]*replay-blocked/);

  const durableBody = functionBody(
    source,
    'dispatchDurableComputerAppMutation',
    'executeGuardedBrowserOpenUrl',
  );
  assert(
    durableBody.indexOf('lease.store.start') < durableBody.indexOf('input.handler(sealedArgs)'),
    'durable claim/start reaches dispatched before the bridge handler',
  );
  assert.match(source, /browser\.open_url is available only through the authenticated typed runtime/);

  console.log('browser.open_url durable mutation gateway smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
