/**
 * credentials-get-policy-smoketest — asserts the runtime tool policy for the
 * disabled model-side `credentials.get` name retains an ask policy backstop,
 * while redacted vault reads stay auto-approved (regression guard against
 * both secret exposure and over-gating).
 *
 * Bootstrap mirrors tool-description-lint-smoketest: openswanToolRuntime
 * transitively imports react-native via the supabase singleton, which
 * tsx/esbuild cannot parse — so we stub the native specifiers with
 * node:module.registerHooks, then dynamically import the REAL runtime.
 *
 * Run: npm run smoke:credentials-get-policy
 */

import { registerHooks } from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://creds-policy-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'creds-policy-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

let failures = 0;
function fail(m: string): void { failures += 1; console.error('FAIL:', m); }
function pass(m: string): void { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string): void {
  if (cond) pass(name); else fail(`${name}${detail ? ` — ${detail}` : ''}`);
}

async function main(): Promise<void> {
  const runtime = await import('../src/lib/openswanToolRuntime');
  const getOpenSwanToolPolicy = runtime.getOpenSwanToolPolicy;

  const creds = getOpenSwanToolPolicy('credentials.get');
  assert(creds.approvalMode === 'ask', 'credentials.get is approval-gated (ask)', creds.approvalMode);
  assert(creds.approvalKind === 'privileged_action', 'credentials.get keeps privileged_action fingerprint', String(creds.approvalKind));
  assert(creds.mutatesState === false, 'credentials.get reports mutatesState false (honest read)', String(creds.mutatesState));
  assert(creds.family === 'vault', 'credentials.get groups under the vault family', creds.family);

  const blockedCredentialRead = await runtime.executeOpenSwanRuntimeTool(
    'credentials.get',
    { item: 'Synthetic Login', vault: 'Test', fields: ['username'] },
    {
      circleId: '11111111-1111-4111-8111-111111111111',
      userId: '22222222-2222-4222-8222-222222222222',
      surface: 'main_chat',
      toolName: 'credentials.get',
      toolUseId: 'credential-policy-smoke',
    },
  );
  assert(blockedCredentialRead.ok === false, 'credentials.get direct runtime invocation fails closed');
  assert(
    blockedCredentialRead.resultsText.includes('no secret was fetched'),
    'credentials.get direct runtime invocation stops before secret retrieval',
    blockedCredentialRead.resultsText,
  );

  const fillSaved = getOpenSwanToolPolicy('browser.fill_credential_field');
  assert(fillSaved.approvalMode === 'ask', 'browser.fill_credential_field is approval-gated (ask)', fillSaved.approvalMode);
  assert(fillSaved.approvalKind === 'browser_action', 'browser.fill_credential_field uses browser_action approval kind', String(fillSaved.approvalKind));
  assert(fillSaved.mutatesState === true, 'browser.fill_credential_field mutates browser page state', String(fillSaved.mutatesState));
  assert(fillSaved.externalSideEffect === true, 'browser.fill_credential_field is an external side effect', String(fillSaved.externalSideEffect));
  assert(fillSaved.summary.includes('temporarily unavailable'), 'browser.fill_credential_field summary documents the fail-closed target-binding stop');

  // Regression guard: redacted vault reads must NOT be over-gated.
  const find = getOpenSwanToolPolicy('vault.find');
  assert(find.approvalMode === 'auto', 'vault.find redacted read stays auto', find.approvalMode);
  assert(find.mutatesState === false, 'vault.find does not mutate', String(find.mutatesState));

  // And mutating vault writes stay gated.
  const grant = getOpenSwanToolPolicy('vault.grant');
  assert(grant.approvalMode === 'ask', 'vault.grant write stays approval-gated', grant.approvalMode);

  // P64 (backlog #3): publishing a circle is externally-visible exposure that
  // toggling back doesn't fully undo, so it is 'ask'-gated (not the auto
  // coordination-write doctrine). Pin so it can't silently regress to auto.
  const togglePublic = getOpenSwanToolPolicy('circle.toggle_public');
  assert(togglePublic.approvalMode === 'ask', 'circle.toggle_public is approval-gated (public exposure not reversible)', togglePublic.approvalMode);
  assert(!!togglePublic.approvalKind, 'circle.toggle_public carries an approvalKind', String(togglePublic.approvalKind));

  if (failures > 0) {
    console.error(`\n${failures} credentials-get-policy smoke-test failure(s)`);
    process.exit(1);
  }
  console.log('\nAll credentials-get-policy smoke cases passed.');
}

void main();
