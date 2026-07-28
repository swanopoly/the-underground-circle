import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtime = readFileSync('src/lib/openswanToolRuntime.ts', 'utf8');
const adapter = readFileSync('src/lib/computerAppAdapter.ts', 'utf8');

let assertions = 0;
function check(condition: unknown, message: string): void {
  assert.ok(condition, message);
  assertions += 1;
}

function sliceBetween(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

const gateway = sliceBetween(
  runtime,
  'async function executeGuardedNativeOpenPath(',
  'async function executeGuardedNativeSemanticPress(',
);
const durableDispatcher = sliceBetween(
  runtime,
  'async function dispatchDurableComputerAppMutation',
  'async function executeGuardedBrowserFill(',
);
const adapterGateway = sliceBetween(
  adapter,
  'export async function executeObservedNativeOpenPath(',
  '/**\n * Observe-first, proof-bearing launch/focus lane.',
);
const rawOpenPathCase = sliceBetween(
  runtime,
  "case 'desktop.open_path': {",
  "case 'desktop.click_at': {",
);

const identityCheck = gateway.indexOf(
  "hasAuthenticatedPersistedOpenSwanCallIdentity('desktop.open_path', context)",
);
const bridgeImport = gateway.indexOf("import('./desktopBridge')");
const bridgeAvailability = gateway.indexOf('isDesktopBridgeAvailable()');
check(identityCheck >= 0, 'gateway requires the exact authenticated persisted call identity');
check(
  identityCheck < bridgeImport && identityCheck < bridgeAvailability,
  'authenticated identity is validated before any bridge access or observation',
);
check(
  runtime.includes('supabase.auth.getUser()')
    && runtime.includes(".from('agent_runs')")
    && runtime.includes(".eq('user_id', context.userId)")
    && runtime.includes(".eq('circle_id', context.circleId)"),
  'pre-observation identity binds authenticated user, persisted run, and circle',
);
check(
  runtime.includes("context.toolName === tool")
    && runtime.includes('context.toolUseId.length > 0')
    && runtime.includes('OPEN_SWAN_RUNTIME_CALL_ID_RE.test(String(context.toolUseId')
    && runtime.includes('Number.isInteger(context.iteration)')
    && runtime.includes('Number(context.iteration) > 1_000'),
  'provider tool name, tool-use id, and positive iteration are exact runtime inputs',
);

const statIndex = adapterGateway.indexOf('deps.statFile(requestedPath)');
const beforeObserveIndex = adapterGateway.indexOf(
  'deps.observeApp({ maxDepth: 1, maxNodes: 1 })',
);
const targetBindingIndex = adapterGateway.indexOf(
  "operation: 'native_open_path',\n    requestedPath,\n    resolvedPath,",
);
const approvalIndex = adapterGateway.indexOf('deps.approvalGate(proposal)');
const dispatchIndex = adapterGateway.indexOf('deps.dispatchOpenPath({');
const afterObserveIndex = adapterGateway.indexOf(
  'deps.observeApp({\n      maxDepth: 10,',
);
check(statIndex >= 0, 'adapter collects a fresh file/folder stat');
check(
  statIndex < beforeObserveIndex
    && beforeObserveIndex < targetBindingIndex
    && targetBindingIndex < approvalIndex
    && approvalIndex < dispatchIndex
    && dispatchIndex < afterObserveIndex,
  'adapter order is stat -> frontmost observation -> exact binding -> approval -> one dispatch -> fresh proof',
);
check(
  adapterGateway.includes("stat.exists !== true")
    && adapterGateway.includes("stat.kind !== 'file' && stat.kind !== 'directory'")
    && adapterGateway.includes('requestedPath,')
    && adapterGateway.includes('resolvedPath')
    && adapterGateway.includes('modifiedAt: stat.modifiedAt'),
  'exact target binding includes existence, kind, resolved path, size, and modification state',
);
check(
  adapter.includes('findNativeOpenPathEvidence(value, targetName)')
    && adapter.includes('value.frontmost !== true')
    && adapterGateway.includes('after.targetEvidenceMatched'),
  'post-open completion requires frontmost native-app state and exact basename/folder evidence',
);
check(
  adapter.includes('if (!candidate.startsWith(targetName)) return false;')
    && adapter.includes('/[\\s—–\\-|•·(\\[]/u.test(after)'),
  'target evidence rejects substring look-alikes and accepts only exact title-delimited names',
);

const dispatchCalls = adapterGateway.match(/deps\.dispatchOpenPath\(\{/g) || [];
check(dispatchCalls.length === 1, 'adapter invokes the mutation dispatcher exactly once');
check(
  !/\b(for\s*\(|while\s*\()/.test(
    adapterGateway.slice(dispatchIndex, afterObserveIndex),
  )
    && !adapterGateway.includes('dispatchOpenPathWithRetry'),
  'the mutation interval has no retry or dispatch loop',
);
check(
  adapterGateway.includes("outcomeUnknownPolicy: 'never_retry'")
    && adapterGateway.includes('replayAllowed: false'),
  'adapter proof permanently disables automatic replay',
);
check(
  adapterGateway.includes(
    'if ((!dispatched.ok || !dispatched.data) && !dispatched.mutationAttempted)',
  )
    && dispatchIndex < afterObserveIndex,
  'an ambiguous attempted dispatch still receives one fresh post-open observation before outcome_unknown',
);

const durableClaimIndex = durableDispatcher.indexOf('claimDurableAgentAction(');
const durableStartIndex = durableDispatcher.indexOf('lease.store.start({');
const handlerEntryIndex = durableDispatcher.indexOf('return input.handler(sealedArgs)');
check(
  durableClaimIndex >= 0
    && durableClaimIndex < durableStartIndex
    && durableStartIndex < handlerEntryIndex,
  'durable helper claims before advancing to dispatched immediately before handler entry',
);
check(
  gateway.includes('dispatchDurableComputerAppMutation({')
    && gateway.includes('handler: async (sealedArgs) => {'),
  'open-path dispatch uses the shared durable computer-app mutation helper',
);
const openPathCalls = gateway.match(/desktopBridge\.openPath\(/g) || [];
check(openPathCalls.length === 1, 'sealed gateway contains one and only one bridge openPath call');
check(
  gateway.indexOf('handler: async (sealedArgs) => {')
    < gateway.indexOf('desktopBridge.openPath(sealedArgs.path)'),
  'the sole bridge openPath call is inside the durable handler',
);
check(
  gateway.includes("canComplete ? 'verified' : 'outcome_unknown'")
    && !/finishDurableAgentAction\([\s\S]{0,160}['\"]failed['\"]/.test(gateway),
  'post-dispatch finalization can only be verified or outcome_unknown, never failed',
);
check(
  gateway.includes('verificationReceipt?.canComplete')
    && gateway.includes('&& durableStateSealed'),
  'model-visible completion requires exact verification and durable terminal acknowledgement',
);

const approvalArgsBlock = sliceBetween(
  gateway,
  'approvalArgs = {',
  '};\n          const gate = await maybeRequestToolApproval',
);
check(
  approvalArgsBlock.includes('targetFingerprint')
    && approvalArgsBlock.includes('targetKind')
    && !approvalArgsBlock.includes('evidenceId')
    && !/\b(path|appName|resolvedAppName)\b/.test(approvalArgsBlock),
  'runtime approval binds stable opaque target evidence, never per-attempt ids or a raw path/app name',
);
const durableMetadataBlocks = gateway.match(
  /finishDurableAgentAction\([\s\S]*?\{\n\s*surface:[\s\S]*?\n\s*\},\n\s*\);/g,
) || [];
check(durableMetadataBlocks.length === 1, 'gateway has one durable finalization metadata block');
check(
  durableMetadataBlocks.every(
    (block) => !/\b(path|appName|resolvedAppName|windowTitles|targetName)\b/.test(block),
  ),
  'durable finalization metadata contains no raw path, app, title, or target name',
);
const proofBlock = sliceBetween(
  adapterGateway,
  'const proof = {',
  '\n  };\n\n  if (!completionVerified)',
);
check(
  proofBlock.includes('targetFingerprint')
    && proofBlock.includes('appFingerprint')
    && !/\b(resolvedPath|targetName|windowTitles|resolvedAppName)\b/.test(proofBlock),
  'returned proof contains opaque fingerprints and no raw path/app observation',
);
check(
  !/\b(?:statResult|beforeResult|afterResult)\.error\b/.test(adapterGateway),
  'model-visible adapter errors never interpolate raw bridge errors',
);
check(
  adapter.includes('function nativeOpenPathErrorCode(')
    && /nativeOpenPathErrorCode\(\s*statResult\.errorCode/.test(adapterGateway)
    && adapterGateway.includes('nativeOpenPathErrorCode(dispatched.errorCode)'),
  'untrusted bridge error codes pass through a fixed allowlist before adapter output',
);

check(
  rawOpenPathCase.includes('raw desktop bridge path cannot dispatch it')
    && !rawOpenPathCase.includes("import('./desktopBridge')")
    && !/\bopenPath\s*\(/.test(rawOpenPathCase),
  'raw dispatcher refuses desktop.open_path and exposes no second mutation path',
);
const runtimeIntercept = runtime.indexOf("if (tool === 'desktop.open_path')");
const genericApproval = runtime.indexOf(
  'const approvalGate = await maybeRequestToolApproval',
  runtimeIntercept,
);
check(
  runtimeIntercept >= 0
    && runtime.indexOf('executeGuardedNativeOpenPath(', runtimeIntercept) < genericApproval,
  'typed runtime intercepts desktop.open_path before the generic/raw dispatch path',
);

console.log(`computer-app-open-path-runtime smoke: ${assertions} assertions passed`);
