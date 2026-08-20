/**
 * Source-contract smoke for the sealed OpenSwan native-select runtime lane.
 *
 * Run:
 *   npx tsx scripts/browser-select-runtime-gateway-smoketest.ts
 */

import { readFileSync } from 'node:fs';

let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
const clientSource = readFileSync('src/lib/browserBridge.ts', 'utf8');
const bridgeSource = readFileSync('scripts/browser-bridge.js', 'utf8');
const swanbotSource = readFileSync('src/lib/swanbot.ts', 'utf8');
const edgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');

const executeStart = runtimeSource.indexOf('export async function executeOpenSwanRuntimeTool');
const executeEnd = runtimeSource.indexOf('/**\n * Coordination-domain', executeStart);
const executeSource = runtimeSource.slice(executeStart, executeEnd);
const prepareStart = runtimeSource.indexOf('async function prepareGuardedBrowserSelect');
const prepareEnd = runtimeSource.indexOf('function attachComputerAppMutationMetadata', prepareStart);
const prepareSource = runtimeSource.slice(prepareStart, prepareEnd);
const dispatchStart = runtimeSource.indexOf('async function executeGuardedBrowserSelect');
const dispatchEnd = runtimeSource.indexOf('function hasExactOpenSwanRuntimeCallIdentity', dispatchStart);
const dispatchSource = runtimeSource.slice(dispatchStart, dispatchEnd);
const edgeSelectStart = edgeSource.indexOf('name: "browser.select_option"');
const edgeSelectEnd = edgeSource.indexOf('name: "browser.fill_field"', edgeSelectStart);
assert(
  edgeSelectStart >= 0 && edgeSelectEnd > edgeSelectStart,
  'SwanBot edge native-select definition has stable catalog boundaries',
);
const edgeSelectSource = edgeSource.slice(edgeSelectStart, edgeSelectEnd);

assert(
  executeSource.indexOf('prepareGuardedBrowserSelect(runtimeArgs, context)')
    < executeSource.indexOf('maybeAuthorizeToolWithWorkflowReview('),
  'native select is freshly observed before approval lookup/request',
);
assert(
  executeSource.includes('approvalArgs = preparedBrowserSelect.approvalArgs')
    && executeSource.includes('executeGuardedBrowserSelect('),
  'approval and dispatch use the runtime-prepared sealed select target',
);
assert(
  prepareSource.includes('normalizeGuardedBrowserSelectIntent(input)')
    && prepareSource.includes('domSnapshot({ maxNodes: 100, interestingOnly: true })')
    && prepareSource.includes('observeGuardedBrowserSelectTarget({'),
  'select preparation normalizes input and observes both page and exact target',
);
assert(
  prepareSource.includes("role: 'combobox'")
    && prepareSource.includes('optionFingerprint: target.optionFingerprint')
    && prepareSource.includes('beforeOptionFingerprint: target.currentOptionFingerprint'),
  'preparation binds one native combobox option and its prior selection fingerprint',
);
const approvalStart = prepareSource.indexOf('approvalArgs: {');
const approvalEnd = prepareSource.indexOf('beforeOptionFingerprint:', approvalStart);
const approvalSource = prepareSource.slice(approvalStart, approvalEnd);
assert(
  approvalStart >= 0
    && approvalEnd > approvalStart
    && !approvalSource.includes('targetId:')
    && !approvalSource.includes('value: normalized.args.value')
    && !approvalSource.includes('name: normalized.args.name')
    && !approvalSource.includes('selector: normalized.args.selector')
    && !approvalSource.includes('expectedUrl: target.url'),
  'durable approval excludes the one-shot capability, raw option, locator, and full URL',
);
assert(
  dispatchSource.includes("tool: 'browser.select_option'")
    && dispatchSource.includes("outcomeUnknownPolicy: 'verify_before_retry'")
    && dispatchSource.includes('dispatchDurableComputerAppMutation({'),
  'selection uses the shared durable mutation contract and never blind-retries',
);
assert(
  dispatchSource.includes('handler: async (sealedArgs)')
    && dispatchSource.includes('setGuardedBrowserSelectOption({\n        ...sealedArgs,'),
  'the bridge receives only cryptographically sealed handler arguments',
);
assert(
  dispatchSource.includes('proof.selectionMatches === true')
    && dispatchSource.includes('proof.optionFingerprint === prepared.dispatchArgs.optionFingerprint')
    && dispatchSource.includes('proof.previousOptionFingerprint === prepared.beforeOptionFingerprint'),
  'completion requires coherent exact-option before/after proof',
);
assert(
  dispatchSource.includes("finishDurableAgentAction(")
    && dispatchSource.includes("canComplete ? 'verified' : 'outcome_unknown'"),
  'durable final state follows canonical fresh verification',
);
assert(
  dispatchSource.includes('proof.mutationPerformed')
    && dispatchSource.includes('was already selected'),
  'result distinguishes a performed selection from a verified no-op',
);
assert(
  clientSource.includes('export async function observeGuardedBrowserSelectTarget')
    && clientSource.includes('export async function setGuardedBrowserSelectOption')
    && clientSource.includes('export function extractBrowserSelectProofMetadata'),
  'browser client separates observation, mutation, and redacted proof parsing',
);
assert(
  bridgeSource.includes('async function handleSelect(')
    && bridgeSource.includes("selectMode === 'observe_guarded_native'")
    && bridgeSource.includes("selectMode === 'guarded_native_single'"),
  'browser bridge separates native-select observation and mutation behind explicit internal modes',
);
assert(
  bridgeSource.includes('browser select is available only through the sealed observe-approve-mutate native-select lane')
    && bridgeSource.includes("'browser_select_canary_blocked'"),
  'legacy/raw and out-of-canary selection attempts fail closed with typed errors',
);
assert(
  swanbotSource.indexOf("case 'browser.select_option':")
    < swanbotSource.indexOf('const desktopResult = await dispatchSwanBotDesktopClientTool'),
  'SwanBot routes select_option through OpenSwan before raw client dispatch',
);
assert(
  edgeSelectSource.includes('name: "browser.select_option"')
    && edgeSelectSource.includes('matchBy: { type: "string", enum: ["value", "label"]')
    && edgeSelectSource.includes('required: ["value", "matchBy"]')
    && edgeSelectSource.includes('submit: { type: "boolean", enum: [false]')
    && edgeSelectSource.includes('exact: { type: "boolean", enum: [true]')
    && edgeSelectSource.includes('{ required: ["name"], not: { required: ["selector"] } }')
    && edgeSelectSource.includes('{ required: ["selector"], not: { required: ["name"] } }'),
  'SwanBot edge schema exposes the bounded exact-locator native-select contract',
);

console.log(`browser-select-runtime-gateway-smoketest: ${assertions} assertions passed`);
