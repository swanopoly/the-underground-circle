/**
 * Source-contract smoke for the OpenSwan observe -> approve -> set -> verify
 * browser toggle runtime lane.
 *
 * Run:
 *   npx tsx scripts/browser-toggle-runtime-gateway-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { describeBrowserBridgeFailure } from '../src/lib/browserBridgeFailure';

let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
const clientSource = readFileSync('src/lib/browserBridge.ts', 'utf8');
const swanbotSource = readFileSync('src/lib/swanbot.ts', 'utf8');
const executeStart = runtimeSource.indexOf('export async function executeOpenSwanRuntimeTool');
const executeEnd = runtimeSource.indexOf('/**\n * Coordination-domain', executeStart);
const executeSource = runtimeSource.slice(executeStart, executeEnd);
const prepareStart = runtimeSource.indexOf('async function prepareGuardedBrowserToggle');
const prepareEnd = runtimeSource.indexOf('function attachComputerAppMutationMetadata', prepareStart);
const prepareSource = runtimeSource.slice(prepareStart, prepareEnd);
const dispatchStart = runtimeSource.indexOf('async function executeGuardedBrowserToggle');
const dispatchEnd = runtimeSource.indexOf('export async function executeOpenSwanRuntimeTool', dispatchStart);
const dispatchSource = runtimeSource.slice(dispatchStart, dispatchEnd);

assert(
  executeSource.indexOf('prepareGuardedBrowserToggle(args, context)')
    < executeSource.indexOf('maybeRequestToolApproval(tool, approvalArgs, context)'),
  'fresh exact toggle observation occurs before approval lookup/request',
);
assert(
  executeSource.includes('approvalArgs = preparedBrowserToggle.approvalArgs'),
  'approval is bound to the runtime-prepared redacted toggle identity',
);
assert(
  executeSource.includes("if (tool === 'browser.set_toggle')")
    && executeSource.includes('executeGuardedBrowserToggle(')
    && executeSource.includes('no genuine exact-call approval receipt'),
  'set_toggle can enter its handler only through the genuine approval-receipt path',
);
assert(
  prepareSource.includes('normalizeGuardedBrowserToggleIntent(input)')
    && prepareSource.includes('domSnapshot({ maxNodes: 100, interestingOnly: true })')
    && prepareSource.includes('observeGuardedBrowserToggleTarget({'),
  'preparation normalizes model authority, observes a fresh page, then resolves one exact state control',
);
assert(
  prepareSource.includes("operation: 'guarded_non_consequential_toggle'")
    && prepareSource.includes('normalizedIntentSha256')
    && prepareSource.includes('pageUrlSha256')
    && prepareSource.includes('pageOrigin: browserApprovalOrigin(target.url)')
    && prepareSource.includes('targetFingerprint: target.targetFingerprint'),
  'durable approval uses bounded semantics and cryptographic intent/page/target bindings',
);
const returnedApprovalStart = prepareSource.indexOf('approvalArgs: {', prepareSource.indexOf('prepared: {'));
const returnedApprovalEnd = prepareSource.indexOf('role: normalized.args.role,', returnedApprovalStart);
const returnedApproval = prepareSource.slice(returnedApprovalStart, returnedApprovalEnd);
assert(
  returnedApprovalStart >= 0
    && returnedApprovalEnd > returnedApprovalStart
    && !returnedApproval.includes('targetId:')
    && !returnedApproval.includes('expectedUrl: target.url')
    && !returnedApproval.includes('name: normalized.args.name')
    && !returnedApproval.includes('selector: normalized.args.selector')
    && !returnedApproval.includes('taskContext: normalized.args.taskContext'),
  'one-shot capability, locator, task context, and exact URL never enter durable approval args',
);
assert(
  dispatchSource.includes('buildComputerAppToolArgsFingerprintAsync(')
    && dispatchSource.includes('normalizedArgs: prepared.dispatchArgs')
    && dispatchSource.includes('handler: async (sealedArgs)')
    && dispatchSource.includes('setGuardedBrowserToggleState({ ...sealedArgs })'),
  'handler entry receives only the cryptographically sealed transient dispatch args',
);
assert(
  dispatchSource.includes('outcome-unknown')
    && dispatchSource.includes("outcomeUnknownPolicy: 'verify_before_retry'"),
  'uncertain handler outcomes require fresh observation instead of blind replay',
);
assert(
  dispatchSource.includes('proof.stateMatches === true')
    && dispatchSource.includes('proof.currentState === prepared.dispatchArgs.desiredState')
    && dispatchSource.includes('proof.previousState === prepared.beforeState')
    && dispatchSource.includes('proof.targetFingerprint === prepared.dispatchArgs.targetFingerprint'),
  'completion requires coherent before/after state proof for the approved exact target',
);
assert(
  dispatchSource.includes('proof.mutationPerformed')
    && dispatchSource.includes('was already'),
  'completion distinguishes a performed transition from an already-satisfied no-op',
);

assert(
  clientSource.includes('export async function observeGuardedBrowserToggleTarget')
    && clientSource.includes("'/browser/toggle_target'")
    && clientSource.includes('export async function setGuardedBrowserToggleState')
    && clientSource.includes("'/browser/set_toggle'"),
  'browser client exposes separate observation and guarded mutation endpoints',
);
assert(
  clientSource.includes('export function extractBrowserGuardedToggleTarget')
    && clientSource.includes('export function extractBrowserToggleProofMetadata')
    && clientSource.includes('stateMatches !== (currentState === desiredState)'),
  'client parsers fail closed on malformed or incoherent toggle evidence',
);
const proofParserStart = clientSource.indexOf('export function extractBrowserToggleProofMetadata');
const proofParserEnd = clientSource.indexOf('/**\n * Extract the only fill proof fields', proofParserStart);
const proofParserSource = clientSource.slice(proofParserStart, proofParserEnd);
assert(
  proofParserStart >= 0
    && proofParserEnd > proofParserStart
    && !proofParserSource.includes('targetId:')
    && !proofParserSource.includes('name:')
    && !proofParserSource.includes('selector:'),
  'runtime proof metadata excludes live target capabilities and locator text',
);
assert(
  clientSource.includes("role === 'radio' && args.desiredState !== true")
    && clientSource.includes('hasUnsafeToggleSignals(args)')
    && clientSource.includes('credentialSemantics === true'),
  'client defense-in-depth refuses impossible radio clearing and protected targets',
);
assert(
  swanbotSource.indexOf("case 'browser.set_toggle':")
    < swanbotSource.indexOf('const desktopResult = await dispatchSwanBotDesktopClientTool'),
  'SwanBot routes set_toggle through the sealed runtime before any direct desktop/browser dispatcher',
);
assert(
  swanbotSource.includes('iteration: i + 1')
    && swanbotSource.includes('toolName: call.name')
    && swanbotSource.includes('toolUseId: call.id')
    && swanbotSource.includes('iteration: context?.iteration'),
  'SwanBot forwards exact continuation, tool-call, and iteration identity to the runtime gateway',
);
const blockedFailure = describeBrowserBridgeFailure(
  'resolved control is outside the guarded toggle canary',
  'browser_toggle_canary_blocked',
);
assert(
  blockedFailure.errorCode === 'browser_toggle_canary_blocked'
    && blockedFailure.retryability === 'do_not_retry'
    && blockedFailure.requiredEvidence.includes('user.approve_dedicated_browser_action'),
  'protected toggle targets receive typed do-not-retry recovery instead of a generic browser error',
);
const verificationFailure = describeBrowserBridgeFailure(
  'after-state did not match',
  'browser_toggle_verification_failed',
);
assert(
  verificationFailure.errorCode === 'browser_toggle_verification_failed'
    && verificationFailure.retryability === 'retry_after_evidence'
    && verificationFailure.requiredEvidence.includes('browser.dom_snapshot'),
  'toggle proof mismatch requires fresh browser evidence before one bounded retry',
);

console.log(`browser-toggle-runtime-gateway-smoketest: ${assertions} assertions passed`);
