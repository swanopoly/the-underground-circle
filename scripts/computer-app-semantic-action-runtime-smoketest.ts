/**
 * Source-contract smoke for the OpenSwan/SwanBot native semantic-action
 * integration. This intentionally does not import or execute the runtime:
 * it pins the public/edge schemas and every fail-closed dispatch boundary
 * without opening a native app.
 *
 * Run:
 *   /Users/cswanson/.npm/_npx/fd45a72a545557e9/node_modules/.bin/tsx \
 *     scripts/computer-app-semantic-action-runtime-smoketest.ts
 */

import { readFileSync } from 'node:fs';

let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function section(
  source: string,
  startMarker: string,
  endMarker: string,
  label: string,
): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0, `${label} start marker exists`);
  assert(end > start, `${label} end marker follows its start`);
  return source.slice(start, end);
}

function schemaPropertyNames(toolSource: string, label: string): string[] {
  const propertiesStart = toolSource.indexOf('properties: {');
  const requiredStart = toolSource.indexOf('required:', propertiesStart);
  assert(propertiesStart >= 0, `${label} properties object exists`);
  assert(requiredStart > propertiesStart, `${label} required list follows properties`);
  const propertiesSource = toolSource.slice(propertiesStart, requiredStart);
  return Array.from(
    propertiesSource.matchAll(/^\s+([A-Za-z][A-Za-z0-9_]*):\s*\{\s*type:/gm),
    (match) => match[1],
  );
}

function schemaRequiredNames(toolSource: string, label: string): string[] {
  const match = toolSource.match(/required:\s*\[([^\]]+)\]/s);
  assert(!!match, `${label} required list exists`);
  return Array.from(
    match![1].matchAll(/['"]([^'"]+)['"]/g),
    (entry) => entry[1],
  );
}

function sorted(values: string[]): string[] {
  return [...values].sort();
}

const runtimeSource = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
const adapterSource = readFileSync('src/lib/computerAppAdapter.ts', 'utf8');
const swanBotSource = readFileSync('src/lib/swanbot.ts', 'utf8');
const rawClientSource = readFileSync('src/lib/swanbotClientToolDispatcher.ts', 'utf8');
const edgeSource = readFileSync('supabase/functions/swanbot-v2-ai/index.ts', 'utf8');

const expectedPublicFields = [
  'action',
  'appName',
  'pid',
  'path',
  'expectedRole',
  'expectedLabel',
];
const expectedRequiredFields = [
  'appName',
  'pid',
  'path',
  'expectedRole',
  'expectedLabel',
];

// ── OpenSwan public contract ─────────────────────────────────────────────

const runtimeArgsSource = section(
  runtimeSource,
  "  'desktop.click_element':     {",
  "  'desktop.set_element_value':",
  'OpenSwan semantic press execution args',
);
const runtimeArgFields = Array.from(
  runtimeArgsSource.matchAll(/^\s+([A-Za-z][A-Za-z0-9_]*)(\?)?:\s*/gm),
  (match) => ({ name: match[1], optional: match[2] === '?' }),
);
assert(
  JSON.stringify(runtimeArgFields.map((field) => field.name))
    === JSON.stringify(expectedPublicFields),
  'OpenSwan execution args expose exactly action/appName/pid/path/expectedRole/expectedLabel',
);
assert(
  runtimeArgFields.find((field) => field.name === 'action')?.optional === true
    && runtimeArgFields
      .filter((field) => field.name !== 'action')
      .every((field) => field.optional === false),
  'semantic press is the only optional public field and exact target identity fields are required',
);
assert(
  runtimeArgsSource.includes("action?: 'press'")
    && !runtimeArgsSource.includes('selector')
    && !runtimeArgsSource.includes('elementIndex')
    && !runtimeArgsSource.includes('targetId'),
  'OpenSwan public args support only press and expose no generic selector/index/capability bypass',
);

const publicToolSource = section(
  runtimeSource,
  "    name: 'desktop.click_element',",
  "    name: 'desktop.set_element_value',",
  'OpenSwan semantic press tool definition',
);
const publicPropertyNames = schemaPropertyNames(publicToolSource, 'OpenSwan semantic press');
const publicRequiredNames = schemaRequiredNames(publicToolSource, 'OpenSwan semantic press');
assert(
  JSON.stringify(sorted(publicPropertyNames)) === JSON.stringify(sorted(expectedPublicFields)),
  'OpenSwan public schema has exactly the semantic press fields',
);
assert(
  JSON.stringify(sorted(publicRequiredNames)) === JSON.stringify(sorted(expectedRequiredFields)),
  'OpenSwan public schema requires the full app/PID/path/role/label observation binding',
);
assert(
  publicToolSource.includes("enum: ['press']")
    && publicToolSource.includes('Observe-first, approval-gated')
    && publicToolSource.includes('automatic replay'),
  'OpenSwan advertises the narrow press action and its observe/approval/no-replay contract',
);
assert(
  !publicToolSource.includes(' x:')
    && !publicToolSource.includes(' y:')
    && !publicToolSource.includes(' text:')
    && !publicToolSource.includes(' selector:'),
  'OpenSwan semantic press cannot silently widen into coordinate, text, or selector mutation',
);

// ── SwanBot sealed-runtime interception ─────────────────────────────────

const swanBotDispatchSource = section(
  swanBotSource,
  'async function dispatchOneClientTool(',
  '/**\n * Selected client tools',
  'SwanBot client tool gateway',
);
const semanticInterceptIndex = swanBotDispatchSource.indexOf("case 'desktop.click_element':");
const sealedReturnIndex = swanBotDispatchSource.indexOf(
  'return dispatchCodingClientTool(call, context);',
  semanticInterceptIndex,
);
const rawDesktopDispatcherIndex = swanBotDispatchSource.indexOf(
  'const desktopResult = await dispatchSwanBotDesktopClientTool',
);
assert(
  semanticInterceptIndex >= 0
    && sealedReturnIndex > semanticInterceptIndex
    && rawDesktopDispatcherIndex > sealedReturnIndex,
  'SwanBot intercepts desktop.click_element into the sealed runtime before the raw desktop dispatcher',
);
assert(
  count(swanBotDispatchSource, "case 'desktop.click_element':") === 1,
  'SwanBot has one unambiguous semantic press interception case',
);

const swanBotRuntimeForwarder = section(
  swanBotSource,
  'async function dispatchCodingClientTool(',
  'function chunkSwanBotClientToolText(',
  'SwanBot runtime forwarder',
);
assert(
  swanBotRuntimeForwarder.includes('runtime.executeOpenSwanRuntimeTool(')
    && swanBotRuntimeForwarder.includes('toolName: call.name')
    && swanBotRuntimeForwarder.includes('toolUseId: call.id')
    && swanBotRuntimeForwarder.includes('runId: context?.runId')
    && swanBotRuntimeForwarder.includes('iteration: context?.iteration'),
  'SwanBot forwards exact run, provider-call, tool, and iteration identity to OpenSwan',
);

// ── Raw runtime/client bypasses fail closed ─────────────────────────────

const rawRuntimeDispatcher = section(
  runtimeSource,
  'async function dispatchOpenSwanRuntimeTool',
  '// ── Memory Save',
  'raw OpenSwan runtime dispatcher',
);
const rawRuntimeSemanticCase = section(
  rawRuntimeDispatcher,
  "    case 'desktop.click_element': {",
  "    case 'desktop.set_element_value': {",
  'raw OpenSwan semantic press case',
);
assert(
  rawRuntimeSemanticCase.includes('ok: false')
    && rawRuntimeSemanticCase.includes('sealed behind the observe-first native semantic-action gateway')
    && rawRuntimeSemanticCase.includes('cannot dispatch through the raw desktop bridge path'),
  'raw OpenSwan dispatcher refuses semantic presses instead of bypassing the gateway',
);
assert(
  !rawRuntimeSemanticCase.includes('clickElement(')
    && !rawRuntimeSemanticCase.includes('performNativeSemanticAction('),
  'raw OpenSwan refusal contains no bridge mutation call',
);

const rawClientSemanticCase = section(
  rawClientSource,
  "    case 'desktop.click_element':",
  "    case 'desktop.set_element_value':",
  'raw SwanBot desktop client semantic press case',
);
assert(
  rawClientSemanticCase.includes('ok: false')
    && rawClientSemanticCase.includes('requires the sealed OpenSwan native semantic-action runtime')
    && rawClientSemanticCase.includes('cannot use the raw client bridge dispatcher'),
  'raw SwanBot desktop dispatcher also fails closed on semantic presses',
);
assert(
  !rawClientSemanticCase.includes('bridge.clickElement')
    && !rawClientSemanticCase.includes('bridge.performNativeSemanticAction'),
  'raw SwanBot refusal cannot reach either bridge mutation primitive',
);

// ── Observe → prepare → approve → durable sealed dispatch ───────────────

const adapterExecutionSource = section(
  adapterSource,
  'export async function executeObservedNativeSemanticAction(',
  '\nfunction toolMatches(',
  'native semantic adapter execution',
);
const adapterObserveIndex = adapterExecutionSource.indexOf('deps.observeApp({');
const adapterPrepareIndex = adapterExecutionSource.indexOf('deps.observeSemanticActionTarget({');
const adapterApprovalIndex = adapterExecutionSource.indexOf('deps.approvalGate(approvalProposal)');
const adapterPerformIndex = adapterExecutionSource.indexOf('deps.performSemanticAction({');
assert(
  adapterObserveIndex >= 0
    && adapterPrepareIndex > adapterObserveIndex
    && adapterApprovalIndex > adapterPrepareIndex
    && adapterPerformIndex > adapterApprovalIndex,
  'adapter observes the app and seals the exact target before approval, then performs only after approval',
);
assert(
  adapterExecutionSource.includes('pid !== request.expectedPid')
    && adapterExecutionSource.includes('target.indexGeneration === indexGeneration')
    && adapterExecutionSource.includes('Number.isFinite(Date.parse(target.observedAt))'),
  'adapter binds caller PID and the sealed observation epoch before approval',
);

const proposalTypeSource = section(
  adapterSource,
  'export type NativeSemanticActionApprovalProposal = {',
  'export type NativeSemanticActionApprovalDecision',
  'native semantic approval proposal type',
);
assert(
  proposalTypeSource.includes('targetFingerprint: string')
    && proposalTypeSource.includes('evidenceId: string')
    && proposalTypeSource.includes('observedAt: string')
    && proposalTypeSource.includes('indexGeneration: number')
    && proposalTypeSource.includes('targetSummary: string'),
  'approval proposal exposes bounded semantics plus stable observation/fingerprint bindings',
);
assert(
  !proposalTypeSource.includes('targetId:')
    && !proposalTypeSource.includes('targetPath:')
    && !proposalTypeSource.includes('targetLabel:'),
  'approval proposal type excludes the one-shot capability and raw path/label fields',
);

const guardedRuntimeSource = section(
  runtimeSource,
  'async function executeGuardedNativeSemanticPress(',
  'export async function executeOpenSwanRuntimeTool',
  'guarded native semantic runtime',
);
assert(
  guardedRuntimeSource.includes('executeObservedNativeSemanticAction(')
    && guardedRuntimeSource.includes("action: 'press'")
    && guardedRuntimeSource.includes('expectedPid: Number(args?.pid || 0)')
    && guardedRuntimeSource.includes("targetPath: String(args?.path || '')")
    && guardedRuntimeSource.includes("expectedRole: String(args?.expectedRole || '')")
    && guardedRuntimeSource.includes("expectedLabel: String(args?.expectedLabel || '')"),
  'OpenSwan invokes the adapter with the exact public app/PID/path/role/label binding',
);

const approvalArgsSource = section(
  guardedRuntimeSource,
  '      approvalArgs = {',
  '      const gate = await maybeAuthorizeToolWithWorkflowReview(',
  'native semantic durable approval args',
);
assert(
  approvalArgsSource.includes('operation: proposal.operation')
    && approvalArgsSource.includes('appName: proposal.app')
    && approvalArgsSource.includes('pid: proposal.pid')
    && approvalArgsSource.includes('targetRole: proposal.targetRole')
    && approvalArgsSource.includes('targetSummary: proposal.targetSummary')
    && approvalArgsSource.includes('targetFingerprint: proposal.targetFingerprint'),
  'durable approval binds the bounded app/PID/role/summary and cryptographic target identity',
);
assert(
  !approvalArgsSource.includes('targetId')
    && !approvalArgsSource.includes('targetPath')
    && !approvalArgsSource.includes('targetLabel')
    && !approvalArgsSource.includes('dispatchArgs'),
  'durable approval args exclude capability, raw path/label, and transient dispatch payload',
);

const epochIndex = guardedRuntimeSource.indexOf('const beforeEpoch = createComputerAppObservationEpoch({');
const argsFingerprintIndex = guardedRuntimeSource.indexOf(
  'const toolArgsFingerprint = await buildComputerAppToolArgsFingerprintAsync(',
);
const policyIndex = guardedRuntimeSource.indexOf('const policy = await resolveComputerAppMutationPolicy({');
const authorizationIndex = guardedRuntimeSource.indexOf('const authorization = authorizeComputerAppMutation({');
const durableDispatchIndex = guardedRuntimeSource.indexOf(
  'const dispatched = await dispatchDurableComputerAppMutation({',
);
const bridgePerformIndex = guardedRuntimeSource.indexOf(
  'desktopBridge.performNativeSemanticAction({',
);
assert(
  epochIndex >= 0
    && argsFingerprintIndex > epochIndex
    && policyIndex > argsFingerprintIndex
    && authorizationIndex > policyIndex
    && durableDispatchIndex > authorizationIndex
    && bridgePerformIndex > durableDispatchIndex,
  'computerAppGrounding epoch, cryptographic args, policy, authorization, and durable wrapper all precede bridge perform',
);
assert(
  guardedRuntimeSource.includes('capturedAt: proposal.observedAt')
    && guardedRuntimeSource.includes('accessibilityGeneration: proposal.indexGeneration')
    && guardedRuntimeSource.includes('accessibilityTargetFingerprint: proposal.targetFingerprint'),
  'computerAppGrounding receives the trusted sealed observation epoch and exact target fingerprint',
);
assert(
  guardedRuntimeSource.includes('normalizedArgs: dispatchArgs')
    && guardedRuntimeSource.includes('handler: async (sealedArgs)')
    && guardedRuntimeSource.includes('targetId: sealedArgs.targetId')
    && guardedRuntimeSource.includes('targetFingerprint: sealedArgs.targetFingerprint')
    && guardedRuntimeSource.includes('approvalId: sealedArgs.approvalId'),
  'only cryptographically sealed transient args can reach bridge perform',
);
assert(
  count(guardedRuntimeSource, 'desktopBridge.performNativeSemanticAction({') === 1
    && !guardedRuntimeSource.includes('desktopBridge.clickElement(')
    && !guardedRuntimeSource.includes('dispatchAuthorizedComputerAppMutation({'),
  'native semantic runtime has one bridge perform call and cannot bypass the shared durable wrapper',
);

// ── Exact-target verification and no replay ─────────────────────────────

assert(
  guardedRuntimeSource.includes("proof.diff.kind === 'target_disappeared'")
    && guardedRuntimeSource.includes("proof.diff.kind === 'target_semantics_changed'")
    && !guardedRuntimeSource.includes("proof.diff.kind === 'tree_changed'"),
  'runtime verification accepts only exact-target disappearance or semantic-fingerprint change',
);
assert(
  guardedRuntimeSource.includes('proof.completionVerified === true')
    && guardedRuntimeSource.includes('proof.outcomeUnknown === false')
    && guardedRuntimeSource.includes('proof.replayAllowed === false')
    && guardedRuntimeSource.includes('proof.mutationAttempted === true')
    && guardedRuntimeSource.includes('proof.mutationPerformed === true')
    && guardedRuntimeSource.includes('proof.dispatchAcknowledged === true'),
  'runtime completion requires coherent acknowledged mutation and no-replay proof flags',
);
assert(
  guardedRuntimeSource.includes("canComplete ? 'verified' : 'outcome_unknown'")
    && guardedRuntimeSource.includes('Treat the outcome as unknown and do not replay it automatically.')
    && guardedRuntimeSource.includes('Do not replay it automatically; re-observe the app')
    && guardedRuntimeSource.includes('the exact call remains replay-blocked and must not be submitted again.'),
  'verified/outcome-unknown durable states and user-facing wording never invite automatic replay',
);
assert(
  guardedRuntimeSource.includes(
    'The exact approved low-consequence accessibility target disappeared or changed semantics after one acknowledged native press.',
  )
    && guardedRuntimeSource.includes("evidenceTools: ['desktop.semantic_action:exact-target-diff']"),
  'grounding verification predicate is explicitly local to the exact approved target',
);

const durableWrapperSource = section(
  runtimeSource,
  'async function dispatchDurableComputerAppMutation',
  'async function executeGuardedBrowserFill(',
  'shared durable computer-app wrapper',
);
assert(
  durableWrapperSource.includes('const claimed = await claimDurableAgentAction(')
    && durableWrapperSource.includes('lease.startAttempted = true')
    && durableWrapperSource.includes('const started = await lease.store.start({')
    && durableWrapperSource.includes("started.call.state !== 'dispatched'")
    && durableWrapperSource.includes('return input.handler(sealedArgs)'),
  'shared durable wrapper claims and confirms dispatched state before one sealed handler entry',
);
assert(
  durableWrapperSource.includes('this call must not be replayed automatically')
    && durableWrapperSource.includes("'outcome_unknown'")
    && durableWrapperSource.includes('outcomeUnknown: lease.startAttempted'),
  'shared durable wrapper preserves uncertain handler-entry truth and forbids blind replay',
);

const runtimeGatewaySource = section(
  runtimeSource,
  'export async function executeOpenSwanRuntimeTool',
  '/**\n * Coordination-domain',
  'OpenSwan runtime public gateway',
);
assert(
  runtimeGatewaySource.indexOf("if (tool === 'desktop.click_element')")
    < runtimeGatewaySource.indexOf('let preparedBrowserFill:'),
  'public OpenSwan gateway routes semantic press to its sealed handler before generic approval/dispatch',
);
assert(
  runtimeGatewaySource.includes('executeGuardedNativeSemanticPress(')
    && !runtimeGatewaySource.includes(
      "if (tool === 'desktop.click_element') {\n    const result = await dispatchOpenSwanRuntimeTool",
    ),
  'public gateway has no raw-dispatch fallback for semantic press',
);

// ── Edge model schema parity ─────────────────────────────────────────────

const edgeToolSource = section(
  edgeSource,
  '      name: "desktop.click_element",',
  '      name: "desktop.set_element_value",',
  'SwanBot edge semantic press tool definition',
);
const edgePropertyNames = schemaPropertyNames(edgeToolSource, 'SwanBot edge semantic press');
const edgeRequiredNames = schemaRequiredNames(edgeToolSource, 'SwanBot edge semantic press');
assert(
  JSON.stringify(sorted(edgePropertyNames)) === JSON.stringify(sorted(publicPropertyNames)),
  'edge and OpenSwan semantic press schemas expose identical property names',
);
assert(
  JSON.stringify(sorted(edgeRequiredNames)) === JSON.stringify(sorted(publicRequiredNames)),
  'edge and OpenSwan semantic press schemas require identical observation identity fields',
);
assert(
  edgeToolSource.includes('enum: ["press"]')
    && edgeToolSource.includes('Observe-first, approval-gated')
    && edgeToolSource.includes('automatic replay'),
  'edge model receives the same press-only observe/approve/no-replay semantics',
);
assert(
  !edgeToolSource.includes('selector:')
    && !edgeToolSource.includes('elementIndex:')
    && !edgeToolSource.includes('targetId:')
    && !edgeToolSource.includes(' x:')
    && !edgeToolSource.includes(' y:'),
  'edge schema cannot introduce a generic locator, capability, or coordinate bypass',
);

console.log(`computer-app semantic action runtime smoke: ${assertions} assertions passed`);
