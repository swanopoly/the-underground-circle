import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

const bridge = read('scripts/claude-bridge.js');
const desktop = read('src/lib/desktopBridge.ts');
const runtime = read('src/lib/openswanToolRuntime.ts');
const dispatcher = read('src/lib/swanbotClientToolDispatcher.ts');
const adapter = read('src/lib/computerAppAdapter.ts');

let assertions = 0;
function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(`Assertion ${assertions} failed: ${message}`);
}

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  check(from >= 0, `source contains start marker: ${start}`);
  const to = source.indexOf(end, from + start.length);
  check(to > from, `source contains end marker after start: ${end}`);
  return source.slice(from, to);
}

const classifierSource = between(
  bridge,
  '/* UC_SMOKE_EXTRACT_START classifyNativeSemanticValueTarget */',
  '/* UC_SMOKE_EXTRACT_END classifyNativeSemanticValueTarget */',
);
const classifierContext = vm.createContext({});
vm.runInContext(`${classifierSource}; this.classify = classifyNativeSemanticValueTarget;`, classifierContext);
const classify = classifierContext.classify as (
  node: Record<string, unknown>,
  context: string,
) => { ok: boolean; reason?: string; action?: string };

for (const role of ['AXTextField', 'AXTextArea', 'AXTextView', 'AXSearchField']) {
  const result = classify({ role, label: 'Project name', value: '' }, 'Create project');
  check(result.ok === true, `${role} is accepted as a named non-secret text field`);
  check(result.action === 'set_value', `${role} is classified as set_value`);
}
check(classify({ role: 'AXSecureTextField', label: 'Name' }, '').reason === 'secure_or_credential_control', 'secure role is refused');
check(classify({ role: 'AXPasswordField', label: 'Name' }, '').reason === 'secure_or_credential_control', 'password role is refused');
check(classify({ role: 'AXButton', label: 'Name' }, '').reason === 'unsupported_role', 'non-text role is refused');
check(classify({ role: 'AXTextField', label: '' }, '').reason === 'missing_label', 'unlabelled text field is refused');
check(classify({ role: 'AXTextField', label: 'Name', containerRole: 'AXSheet' }, '').reason === 'modal_context', 'modal field is refused');
check(classify({ role: 'AXTextField', label: 'API key' }, '').reason === 'secure_or_credential_context', 'credential context is refused');
check(classify({ role: 'AXTextField', label: 'Delete all' }, '').reason === 'destructive_context', 'destructive context is refused');
check(['secure_or_credential_context', 'permission_or_payment_context'].includes(String(classify({ role: 'AXTextField', label: 'Credit card' }, '').reason)), 'payment context is refused');
check(classify({ role: 'AXTextField', label: 'Accessibility permission' }, '').reason === 'permission_or_payment_context', 'permission context is refused');

check(bridge.includes("'/desktop/semantic_value_target'"), 'bridge exposes semantic value preparation endpoint');
check(bridge.includes("'/desktop/semantic_value'"), 'bridge exposes semantic value consume endpoint');
check(bridge.includes('const nativeSemanticValueTargets = new Map()'), 'bridge stores short-lived value capabilities separately from press capabilities');
check(bridge.includes('purgeExpiredNativeSemanticValueTargets'), 'bridge purges expired value capabilities');
check(bridge.includes('NATIVE_SEMANTIC_TARGET_STORE_MAX'), 'value capability store is bounded');
check(bridge.includes('const capability = consumeNativeSemanticValueTarget(targetId)'), 'dispatch consumes the value capability');
const valueDispatch = between(
  bridge,
  "if (url === '/desktop/semantic_value' && req.method === 'POST')",
  "// `/desktop/click_element`",
);
check(valueDispatch.indexOf('consumeNativeSemanticValueTarget(targetId)') < valueDispatch.indexOf('Date.now() > capability.expiresAtMs'), 'one-shot capability is consumed before expiry checks');
check(valueDispatch.indexOf('consumeNativeSemanticValueTarget(targetId)') < valueDispatch.indexOf('targetFingerprint !== capability.targetFingerprint'), 'one-shot capability is consumed before fingerprint checks');
check(valueDispatch.includes('collectFreshFrontmostNativeSemanticTree(capability'), 'handler entry re-observes the exact frontmost app');
check(valueDispatch.includes("['set-value', '--pid', String(capability.pid), '--path', capability.targetPath, '--text', capability.requestedValue]"), 'exact stored target and value dispatch once through AX set-value');
check(valueDispatch.includes("dispatchMethod === 'ax_set_value'"), 'bridge requires AX set-value acknowledgement');
check(valueDispatch.includes('afterTarget?.exactValueHash === capability.requestedValueHash'), 'after proof requires exact requested value hash');
check(valueDispatch.includes('afterTarget?.exactValueLength === capability.requestedValueLength'), 'after proof requires exact requested value length');
check(valueDispatch.includes('afterTargetFingerprint === capability.targetFingerprint'), 'after proof stays on the same semantic field');
check(valueDispatch.includes('replayAllowed: false'), 'bridge result is never replayable');
check(!valueDispatch.includes('click_at'), 'semantic value lane has no coordinate fallback');
check(!valueDispatch.includes('paste_text'), 'semantic value lane has no paste fallback');

const valuePrepare = between(
  bridge,
  "if (url === '/desktop/semantic_value_target' && req.method === 'POST')",
  "if (url === '/desktop/semantic_value' && req.method === 'POST')",
);
check(valuePrepare.includes('cached.generation !== indexGeneration'), 'preparation binds the exact a11y generation');
check(valuePrepare.includes('cachedAgeMs > NATIVE_SEMANTIC_OBSERVATION_MAX_AGE_MS'), 'preparation rejects stale observations');
check(valuePrepare.includes("cached.semanticSlice !== 'full'"), 'preparation requires the complete bounded semantic observation');
check(valuePrepare.includes('observedNode.exactValueHash !== currentValueHash'), 'preparation binds the exact current value hash');
check(valuePrepare.includes('looksLikeSecretNativeSemanticValue(requestedValue)'), 'bridge independently refuses secret-like requested values');
check(valuePrepare.includes('targetId: null'), 'bridge supports a proven already-desired no-op without a capability');
check(valuePrepare.includes('approvalRequired: mutationNeeded'), 'no-op needs no approval while a mutation does');
check(valuePrepare.includes("risk: mutationNeeded ? 'medium' : 'low'"), 'bridge reports bounded no-op versus mutation risk');

check(desktop.includes('export async function observeNativeSemanticValueTarget'), 'desktop client maps the sealed preparation endpoint');
check(desktop.includes('export async function performNativeSemanticValue'), 'desktop client maps one-shot value dispatch');
check(desktop.includes('export async function fingerprintNativeSemanticValue'), 'desktop client exposes matching transient SHA-256 binding');
check(desktop.includes('mapNativeSemanticValueProofSnapshot'), 'desktop client validates proof snapshots');
check(desktop.includes('mapNativeSemanticValueProof'), 'desktop client validates the proof envelope');
check(desktop.includes('hasExactNativeSemanticValuePostcondition'), 'desktop client independently checks same-target value proof');
check(desktop.includes("mapped.proof.dispatchMethod !== 'ax_set_value'"), 'desktop client refuses non-AX dispatch receipts');
check(desktop.includes("{ attachBodyOnError: true }"), 'desktop client preserves structured pre/post-dispatch failure proof');

check(adapter.includes('executeObservedNativeSemanticValueMutation'), 'adapter owns observe-classify-approve-dispatch-verify orchestration');
check(adapter.includes('looksLikeSecretSemanticValue'), 'adapter independently blocks secret-like values');
check(adapter.includes("proof.diff?.kind === 'target_value_changed'"), 'adapter requires the exact changed-value postcondition');
check(adapter.includes('target.targetId === null'), 'adapter accepts bridge-proven no-op without dispatch');
check(!between(adapter, 'export async function executeObservedNativeSemanticValueMutation', 'function toolMatches').includes('bridgeSetElementValue'), 'sealed adapter never calls the raw PID/path setter');

check(runtime.includes('async function executeGuardedNativeSemanticValue'), 'OpenSwan has a dedicated semantic value gateway');
check(runtime.includes("if (tool === 'desktop.set_element_value')"), 'typed runtime intercepts semantic value before raw dispatch');
check(runtime.includes('executeObservedNativeSemanticValueMutation'), 'typed runtime reuses the canonical adapter');
check(runtime.includes('observeNativeSemanticValueTarget: desktopBridge.observeNativeSemanticValueTarget'), 'typed runtime uses sealed bridge preparation');
check(runtime.includes('performNativeSemanticValue: async (dispatchArgs)'), 'typed runtime owns the durable perform boundary');
check(runtime.includes("idempotencyKey: `${actionId}:native-semantic-value-v1`"), 'semantic value action has a one-call durable idempotency key');
check(runtime.includes("evidenceTools: ['desktop.semantic_value:exact-same-target-value-proof']"), 'semantic value action names exact proof evidence');
check(runtime.includes("finishDurableAgentAction(\n        completedDispatch.lease,\n        canComplete ? 'verified' : 'outcome_unknown'"), 'durable final state is verified or replay-blocked unknown');
const approvalSlice = between(
  runtime,
  'approvalArgs = {\n          approvalSchemaVersion: proposal.schemaVersion,',
  "const gate = await maybeRequestToolApproval(\n          'desktop.set_element_value'",
);
check(approvalSlice.includes('requestedValueHash: proposal.requestedValueHash'), 'approval binds the requested value hash');
check(approvalSlice.includes('requestedValueLength: proposal.requestedValueLength'), 'approval binds the requested value length');
check(!approvalSlice.includes('args.text'), 'approval payload contains no raw requested text');
check(!approvalSlice.includes('targetPath'), 'approval payload contains no raw target path');
check(!approvalSlice.includes('targetLabel'), 'approval payload contains no raw target label');

const genericTools = between(runtime, 'const GENERIC_NATIVE_UI_MUTATION_TOOLS', 'function isGenericNativeUiMutationTool');
check(!genericTools.includes("'desktop.set_element_value'"), 'semantic value no longer enters the acknowledgement-only generic lane');
const rawSetCase = between(dispatcher, "case 'desktop.set_element_value':", 'default:');
check(rawSetCase.includes('requires the sealed OpenSwan semantic field/value runtime'), 'raw SwanBot dispatcher fails closed for value mutation');
check(!rawSetCase.includes('bridge.setElementValue'), 'raw SwanBot dispatcher cannot call the legacy setter');
check(runtime.includes('The raw desktop bridge path cannot dispatch it.'), 'raw OpenSwan switch also fails closed');

check(runtime.includes("tool === 'desktop.launch_app' || tool === 'desktop.focus_app'"), 'launch/focus share one lifecycle policy');
check(runtime.includes("approvalMode: 'auto'"), 'reversible exact app lifecycle avoids redundant approval');
check(runtime.includes('hasAuthenticatedPersistedOpenSwanCallIdentity(tool, context)'), 'approval-free lifecycle still requires authenticated persisted exact-call identity');

console.log(`native semantic value runtime smoke passed (${assertions} assertions)`);
