/**
 * Focused smoke for the first live observe -> approve -> act -> verify
 * computer-app mutation gateway.
 *
 * Run:
 *   npx tsx scripts/browser-fill-mutation-gateway-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { normalizeGuardedBrowserFillIntent } from '../src/lib/computerAppGrounding';

let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

const normalized = normalizeGuardedBrowserFillIntent({
  role: 'textbox',
  name: 'Draft title',
  text: 'private draft',
  exact: true,
  timeoutMs: 99_999,
});
assert(normalized.ok, 'valid named non-secret draft normalizes');
if (normalized.ok) {
  assert(normalized.args.submit === false, 'normalized fill is always non-submit');
  assert(normalized.args.credentialSemantics === false, 'normalized fill explicitly marks non-credential semantics');
  assert(normalized.args.timeoutMs === 30_000, 'timeout is clamped to the bridge maximum');
  assert(normalized.args.text === 'private draft', 'draft text is preserved exactly for fill semantics');
}

assert(
  !normalizeGuardedBrowserFillIntent({ name: 'Draft', text: 'x', submit: true }).ok,
  'submit semantics fail closed before observation or approval',
);
assert(
  !normalizeGuardedBrowserFillIntent({ name: 'Password', text: 'x' }).ok,
  'credential-like accessible names fail closed',
);
assert(
  !normalizeGuardedBrowserFillIntent({ selector: 'input[type=password]', text: 'x' }).ok,
  'credential-like selectors fail closed',
);
assert(
  !normalizeGuardedBrowserFillIntent({ name: 'Recovery phrase', text: 'x' }).ok,
  'wallet recovery/seed fields fail closed before browser observation',
);
assert(
  !normalizeGuardedBrowserFillIntent({ name: 'Credit card CVV', text: 'x' }).ok,
  'payment credential fields fail closed before browser observation',
);
assert(
  !normalizeGuardedBrowserFillIntent({ role: 'textbox', text: 'x' }).ok,
  'broad role-only targeting fails closed',
);
const contradictoryLocators = normalizeGuardedBrowserFillIntent({
  role: 'textbox',
  name: 'Approved draft',
  selector: '#different-field',
  text: 'x',
});
assert(
  !contradictoryLocators.ok
    && contradictoryLocators.error.includes('exactly one'),
  'accessible name plus contradictory selector fails before observation or mutation',
);
assert(
  !normalizeGuardedBrowserFillIntent({ name: '', selector: '#safe', text: 'x' }).ok,
  'an explicitly empty second locator cannot be silently dropped to create selector precedence',
);
assert(
  !normalizeGuardedBrowserFillIntent({
    name: 'Draft',
    text: 'x',
    expectedPageId: 'attacker-controlled-page',
  }).ok,
  'unknown hidden-identity authority is rejected at the model boundary',
);
assert(
  !normalizeGuardedBrowserFillIntent({ name: 'x'.repeat(501), selector: '#safe', text: 'x' }).ok,
  'an invalid supplied name cannot be silently dropped in favor of another locator',
);
assert(
  !normalizeGuardedBrowserFillIntent({ role: 'x'.repeat(81), name: 'Draft', text: 'x' }).ok,
  'an invalid supplied role cannot silently fall back to textbox',
);
assert(
  !normalizeGuardedBrowserFillIntent({ name: 42, selector: '#safe', text: 'x' }).ok,
  'a supplied non-string locator fails closed',
);
assert(
  !normalizeGuardedBrowserFillIntent({ name: 'Draft', text: 'x', exact: 'true' }).ok,
  'a malformed exact flag fails closed instead of changing locator semantics',
);
assert(
  !normalizeGuardedBrowserFillIntent({ name: 'Draft', text: 'x', timeoutMs: '5000' }).ok,
  'a malformed timeout fails closed instead of being silently coerced',
);

const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
const catalogStart = runtimeSource.indexOf("name: 'browser.fill_field',");
const catalogEnd = runtimeSource.indexOf("name: 'browser.fill_credential_field',", catalogStart);
const fillCatalogSource = runtimeSource.slice(catalogStart, catalogEnd);
assert(
  catalogStart >= 0
    && catalogEnd > catalogStart
    && fillCatalogSource.includes('oneOf:')
    && fillCatalogSource.includes("{ required: ['name'], not: { required: ['selector'] } }")
    && fillCatalogSource.includes("{ required: ['selector'], not: { required: ['name'] } }")
    && fillCatalogSource.includes('additionalProperties: false')
    && !fillCatalogSource.includes('anyOf:'),
  'typed catalog advertises name XOR selector and rejects additional model fields',
);
const executeStart = runtimeSource.indexOf('export async function executeOpenSwanRuntimeTool');
const executeSource = runtimeSource.slice(executeStart, runtimeSource.indexOf('/**\n * Coordination-domain', executeStart));
assert(
  executeSource.indexOf('prepareGuardedBrowserFill(args, context)')
    < executeSource.indexOf('maybeRequestToolApproval(tool, approvalArgs, context)'),
  'fresh browser identity is prepared before the exact approval lookup/request',
);
assert(
  executeSource.includes('approvalArgs = preparedBrowserFill.approvalArgs'),
  'the durable approval gate binds the normalized intent and stable target fingerprint',
);
assert(
  runtimeSource.includes('observeGuardedNonSecretFillTarget({')
    && runtimeSource.indexOf('observeGuardedNonSecretFillTarget({')
      < runtimeSource.indexOf('approvalArgs = preparedBrowserFill.approvalArgs'),
  'one exact non-credential field is observed before approval is resolved',
);
const fillPreparationStart = runtimeSource.indexOf('async function prepareGuardedBrowserFill(');
const fillPreparationEnd = runtimeSource.indexOf('async function prepareGuardedBrowserToggle(', fillPreparationStart);
const fillPreparationSource = runtimeSource.slice(fillPreparationStart, fillPreparationEnd);
assert(
  fillPreparationSource.includes('const locatorCount = Number(Boolean(normalized.args.name))')
    && fillPreparationSource.includes('+ Number(Boolean(normalized.args.selector))')
    && fillPreparationSource.includes('if (locatorCount !== 1)')
    && fillPreparationSource.indexOf('if (locatorCount !== 1)')
      < fillPreparationSource.indexOf("await import('./browserBridge')")
    && fillPreparationSource.includes("normalized.args.name ? 'accessible_name' : 'selector'")
    && fillPreparationSource.includes('locatorKind,'),
  'prepare derives one unambiguous approval locator kind and refuses drift before any browser observation',
);
const returnedApprovalObjectStart = fillPreparationSource.indexOf('approvalArgs: {');
const returnedApprovalObjectEnd = fillPreparationSource.indexOf('beforeEpoch,', returnedApprovalObjectStart);
const durableApprovalObject = fillPreparationSource.slice(
  returnedApprovalObjectStart,
  returnedApprovalObjectEnd,
);
assert(
  runtimeSource.includes('dispatchArgs: {')
    && runtimeSource.includes('approvalSchemaVersion: 2')
    && runtimeSource.includes("operation: 'guarded_non_secret_draft_fill'")
    && runtimeSource.includes('targetId: target.targetId')
    && returnedApprovalObjectStart > 0
    && returnedApprovalObjectEnd > returnedApprovalObjectStart
    && !durableApprovalObject.includes('targetId:'),
  'ephemeral targetId is dispatch-only and absent from durable approval args',
);
assert(
  durableApprovalObject.includes('normalizedIntentSha256')
    && durableApprovalObject.includes('pageUrlSha256')
    && durableApprovalObject.includes('draftTextLength')
    && durableApprovalObject.includes('pageOrigin: browserApprovalOrigin(target.url)')
    && !durableApprovalObject.includes('...normalized.args')
    && !durableApprovalObject.includes('text: normalized.args.text')
    && !durableApprovalObject.includes('expectedUrl: target.url')
    && !durableApprovalObject.includes('name: normalized.args.name')
    && !durableApprovalObject.includes('selector: normalized.args.selector')
    && !durableApprovalObject.includes('taskContext: normalized.args.taskContext'),
  'durable approval state uses exact SHA-256 bindings and bounded metadata, never raw draft, locator context, or exact URL',
);
assert(
  runtimeSource.includes("globalThis.crypto?.subtle?.digest !== 'function'")
    && runtimeSource.includes("'SHA-256'")
    && runtimeSource.includes('URL.origin omits userinfo, path, query, and fragment')
    && runtimeSource.includes('buildComputerAppToolArgsFingerprintAsync(')
    && runtimeSource.includes('prepared.dispatchArgs,'),
  'guarded approvals fail closed without SHA-256 and the sealed action cryptographically binds exact transient dispatch args',
);
assert(
  runtimeSource.includes("approvalReceipt.approvalKey !== expectedRuntimeApprovalKey"),
  'the grounding policy checks the genuine OpenSwan receipt against the exact prepared call',
);
assert(
  runtimeSource.includes('dispatchAuthorizedComputerAppMutation({')
    && runtimeSource.includes('normalizedArgs: prepared.dispatchArgs')
    && runtimeSource.includes('handler: async (sealedArgs)')
    && runtimeSource.includes('fillGuardedNonSecretField({ ...sealedArgs })')
    && !runtimeSource.includes('fillGuardedNonSecretField(prepared.dispatchArgs)'),
  'handler entry recomputes the exact args binding and uses only dispatcher-sealed arguments',
);
assert(
  runtimeSource.includes('buildComputerAppVerificationReceipt({')
    && runtimeSource.includes('proof.valueMatches === true')
    && runtimeSource.includes('proof.valueLength === proof.expectedLength')
    && runtimeSource.includes('proof.targetFingerprint === prepared.dispatchArgs.targetFingerprint'),
  'completion requires fresh server-side equality proof for the approved target fingerprint',
);
assert(
  runtimeSource.includes('resultsText: proof.mutationPerformed'),
  'runtime completion text distinguishes an actual fill from an already-matching no-op',
);
assert(
  runtimeSource.includes('issuedOpenSwanMutationDispatchReceipts.add(dispatchReceipt)')
    && runtimeSource.includes('issuedOpenSwanComputerAppVerificationReceipts.add(verificationReceipt)'),
  'only gateway-issued mutation and verification receipts can enter hidden metadata',
);
assert(
  runtimeSource.includes("Omit<OpenSwanRuntimeApprovalReceipt, 'approvalKey'>")
    && runtimeSource.includes('approvalKeyDigest')
    && runtimeSource.includes('delete rawRecord.metadata')
    && runtimeSource.includes('issuedOpenSwanApprovalReceiptMetadata.has(approvalCandidate as object)'),
  'raw approval keys and private fill args are excluded from hidden event metadata',
);

const browserClientSource = readFileSync('src/lib/browserBridge.ts', 'utf8');
const browserServerSource = readFileSync('scripts/browser-bridge.js', 'utf8');
const locatorHelpersStart = browserServerSource.indexOf(
  'function hasExactlyOneGuardedFillLocator(',
);
const locatorHelpersEnd = browserServerSource.indexOf(
  'const GUARDED_TOGGLE_OBSERVE_FIELDS',
  locatorHelpersStart,
);
const locatorHelpersSource = browserServerSource.slice(
  locatorHelpersStart,
  locatorHelpersEnd,
);
const locatorHelpers = new Function(
  `${locatorHelpersSource}; return { hasExactlyOneGuardedFillLocator, hasGuardedFillLocatorOverride };`,
)() as {
  hasExactlyOneGuardedFillLocator: (value: unknown) => boolean;
  hasGuardedFillLocatorOverride: (value: unknown) => boolean;
};
assert(
  locatorHelpers.hasExactlyOneGuardedFillLocator({ name: 'Draft' })
    && locatorHelpers.hasExactlyOneGuardedFillLocator({ selector: '#draft' })
    && !locatorHelpers.hasExactlyOneGuardedFillLocator({})
    && !locatorHelpers.hasExactlyOneGuardedFillLocator({
      name: 'Approved draft',
      selector: '#different-field',
    })
    && !locatorHelpers.hasExactlyOneGuardedFillLocator({
      name: 42,
      selector: '#different-field',
    }),
  'bridge locator validator behavior accepts exactly one string locator and rejects both/none/malformed',
);
assert(
  locatorHelpers.hasGuardedFillLocatorOverride({
    targetId: 'sealed-target',
    name: 'attacker override',
    selector: '#attacker-override',
  })
    && !locatorHelpers.hasGuardedFillLocatorOverride({
      targetId: 'sealed-target',
      targetFingerprint: 'sealed-fingerprint',
    }),
  'bridge mutation validator behavior detects locator reintroduction beside a sealed target',
);
const bridgeObserveStart = browserServerSource.indexOf(
  'async function handleObserveGuardedFillTarget(',
);
const bridgeMutationStart = browserServerSource.indexOf(
  'async function handleFill(',
  bridgeObserveStart,
);
const bridgeObserveSource = browserServerSource.slice(
  bridgeObserveStart,
  bridgeMutationStart,
);
const bridgeMutationEnd = browserServerSource.indexOf(
  '\nasync function handleSelect(',
  bridgeMutationStart,
);
const bridgeMutationSource = browserServerSource.slice(
  bridgeMutationStart,
  bridgeMutationEnd,
);
assert(
  bridgeObserveSource.indexOf('!hasExactlyOneGuardedFillLocator(body)')
    < bridgeObserveSource.indexOf('await ensureContext()'),
  'bridge observation refuses both locators before browser setup or target resolution',
);
assert(
  bridgeMutationSource.indexOf('hasGuardedFillLocatorOverride(body)')
    < bridgeMutationSource.indexOf('await ensureContext()')
    && !browserServerSource.slice(
      browserServerSource.indexOf('const GUARDED_TARGET_FILL_FIELDS'),
      browserServerSource.indexOf('function hasExactlyOneGuardedFillLocator('),
    ).includes("'name'")
    && !browserServerSource.slice(
      browserServerSource.indexOf('const GUARDED_TARGET_FILL_FIELDS'),
      browserServerSource.indexOf('function hasExactlyOneGuardedFillLocator('),
    ).includes("'selector'"),
  'bridge mutation refuses name/selector overrides before consuming or mutating a sealed target',
);
assert(
  browserClientSource.includes('export async function observeGuardedNonSecretFillTarget')
    && browserClientSource.includes("'/browser/fill_target'")
    && browserClientSource.includes('export async function fillGuardedNonSecretField')
    && browserClientSource.includes("fillMode: 'guarded_non_secret'"),
  'client observes an exact target capability before using explicit guarded fill mode',
);
assert(
  browserServerSource.includes('body.fillMode === \'guarded_non_secret\'')
    && browserServerSource.includes('guardedTargetCapabilities.consume(body.targetId)')
    && browserServerSource.includes('checkExpectedBrowserFillIdentity')
    && browserServerSource.includes('inputValue'),
  'server consumes one capability, rechecks live identity, and reads post-fill value',
);
assert(
  browserServerSource.includes('await targetHandle.fill(text')
    && browserServerSource.includes('await targetHandle.inputValue')
    && browserServerSource.includes('try { await targetHandle.dispose(); }'),
  'guarded inspection, fill, proof, and cleanup use the same pinned element handle',
);
assert(
  browserServerSource.includes('const mutationPerformed = currentValue !== text')
    && browserServerSource.includes('if (mutationPerformed)')
    && browserServerSource.indexOf('currentValue = await targetHandle.inputValue')
      < browserServerSource.indexOf('await targetHandle.fill(text'),
  'outcome-unknown retries verify an already-matching exact field before re-filling it',
);
assert(
  browserServerSource.includes('labelText: Array.from((element && element.labels) || [])')
    && browserServerSource.includes('formAction:')
    && browserServerSource.includes('formText:'),
  'resolved targets are rejected using associated-label and containing-form credential context',
);
assert(
  browserServerSource.includes('targetFingerprint')
    && !browserServerSource.slice(
      browserServerSource.indexOf('function buildRedactedBrowserFillProof'),
      browserServerSource.indexOf('function classifyBrowserFailure'),
    ).includes('targetId'),
  'redacted fill proof contains the stable fingerprint but never the live target capability',
);

const claudeBridgeSource = readFileSync('scripts/claude-bridge.js', 'utf8');
assert(
  claudeBridgeSource.includes("p === '/browser/fill_target'")
    && claudeBridgeSource.includes('handleObserveGuardedFillTarget'),
  'authenticated bridge routing exposes the read-only exact-target observation endpoint',
);

console.log(`browser-fill-mutation-gateway-smoketest: ${assertions} assertions passed`);
