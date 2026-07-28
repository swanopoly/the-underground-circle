/**
 * Focused offline smoke for the sealed native single-value HTML select lane.
 *
 * Run:
 *   npx tsx scripts/browser-select-mutation-gateway-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { normalizeGuardedBrowserSelectIntent } from '../src/lib/computerAppGrounding';

let assertions = 0;

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1;
  if (!condition) throw new Error(message);
}

const bridgeSource = readFileSync('scripts/browser-bridge.js', 'utf8');
const routerSource = readFileSync('scripts/claude-bridge.js', 'utf8');
const clientSource = readFileSync('src/lib/browserBridge.ts', 'utf8');
const groundingSource = readFileSync('src/lib/computerAppGrounding.ts', 'utf8');

const observeStart = bridgeSource.indexOf('async function handleObserveGuardedSelectTarget(');
const mutationStart = bridgeSource.indexOf('async function handleGuardedSelectMutation(', observeStart);
const dispatchStart = bridgeSource.indexOf('async function handleSelect(', mutationStart);
const dispatchEnd = bridgeSource.indexOf('\nfunction expandUploadPath(', dispatchStart);
const observeSource = bridgeSource.slice(observeStart, mutationStart);
const mutationSource = bridgeSource.slice(mutationStart, dispatchStart);
const dispatchSource = bridgeSource.slice(dispatchStart, dispatchEnd);

assert(
  observeStart >= 0 && mutationStart > observeStart && dispatchStart > mutationStart,
  'bridge exposes separate select observation and exact-handle mutation phases',
);
assert(
  routerSource.includes("p === '/browser/select'")
    && routerSource.includes('browserBridge.handleSelect')
    && routerSource.indexOf("const token = req.headers['x-uc-desktop-token']")
      < routerSource.indexOf("p === '/browser/select'"),
  'the existing authenticated select route reaches only the sealed dispatcher',
);
assert(
  dispatchSource.includes("body.selectMode === 'observe_guarded_native'")
    && dispatchSource.includes("body.selectMode === 'guarded_native_single'")
    && dispatchSource.includes("'browser_select_canary_blocked'"),
  'unsealed legacy select requests fail closed',
);
assert(
  observeSource.includes('Number(Boolean(name)) + Number(Boolean(selector)) !== 1')
    && observeSource.includes("role !== 'combobox'")
    && observeSource.includes('body.exact !== true')
    && observeSource.includes('body.submit !== false')
    && observeSource.includes('!GUARDED_SELECT_MATCH_BY.has(matchBy)')
    && observeSource.includes('matchCount !== 1'),
  'observation requires one exact combobox locator and an explicit match mode',
);
assert(
  observeSource.includes("capabilityKind: 'guarded_select_v1'")
    && observeSource.includes('targetFingerprint,')
    && observeSource.includes('optionFingerprint,')
    && observeSource.includes('initialOptionFingerprint: currentOptionFingerprint')
    && observeSource.includes('targetHandle = null; // ownership transferred'),
  'observation issues a one-shot exact-handle capability bound to before and desired option identity',
);
assert(
  mutationSource.indexOf('guardedTargetCapabilities.consume(body.targetId)')
    < mutationSource.indexOf('checkGuardedSelectCapabilityRecord(')
    && mutationSource.indexOf('checkGuardedSelectCapabilityRecord(')
      < mutationSource.indexOf('inspectResolvedSelectTarget(targetHandle, {')
    && mutationSource.indexOf('inspectResolvedSelectTarget(targetHandle, {')
      < mutationSource.indexOf('buildGuardedSelectTargetFingerprint(')
    && mutationSource.indexOf('buildGuardedSelectTargetFingerprint(')
      < mutationSource.indexOf('const mutationPerformed =')
    && mutationSource.indexOf('const mutationPerformed =')
      < mutationSource.indexOf('await targetHandle.selectOption(optionSpec, { timeout })')
    && mutationSource.indexOf('await targetHandle.selectOption(optionSpec, { timeout })')
      < mutationSource.indexOf('captureCoherentGuardedSelectObservation({'),
  'mutation consumes, revalidates, performs at most one exact native selection, then observes',
);
assert(
  mutationSource.includes('if (mutationPerformed) {')
    && !mutationSource.includes('resolveLocator(')
    && !mutationSource.includes('.click(')
    && !mutationSource.includes("getByRole('option'")
    && !mutationSource.includes('runWithBrowserDialogHandling('),
  'mutation has a no-op path and no click, global option, locator, custom-widget, or dialog fallback',
);
assert(
  mutationSource.includes('proof.selectionMatches')
    && mutationSource.includes("errorCode: 'browser_select_verification_failed'")
    && mutationSource.includes('await targetHandle.dispose()'),
  'completion requires fresh matching proof and always disposes the consumed handle',
);
assert(
  bridgeSource.includes("tagName !== 'select'")
    && bridgeSource.includes("!== 'select-one'")
    && bridgeSource.includes('descriptor.multiple === true')
    && bridgeSource.includes('descriptor.visible !== true')
    && bridgeSource.includes('descriptor.enabled !== true')
    && bridgeSource.includes('descriptor.inertAncestor === true')
    && bridgeSource.includes('descriptor.hasForm === true')
    && bridgeSource.includes('descriptor.hasInlineMutationHandler === true')
    && bridgeSource.includes('descriptor.optionMatchCount !== 1')
    && bridgeSource.includes('desiredOption.disabled === true')
    && bridgeSource.includes('desiredOption.groupDisabled === true'),
  'server inspection rejects custom, multiple, hidden, disabled, inert, form, handler, ambiguous, and disabled-option targets',
);
assert(
  bridgeSource.includes("'guarded-select-invariant-v1\\0'")
    && bridgeSource.includes("'guarded-select-option-v1\\0'")
    && bridgeSource.includes("'guarded-select-target-v1\\0'")
    && bridgeSource.includes("createHmac('sha256', guardedTargetFingerprintKey)"),
  'select target, option, and stable structure use keyed fingerprints',
);
assert(
  bridgeSource.includes("['combobox', 'listbox', 'option'].includes(role.toLowerCase())")
    && bridgeSource.includes('isSelectionControl: true')
    && bridgeSource.includes("explicitRole === 'combobox'"),
  'generic click and guarded fill cannot bypass the dedicated select lane',
);

const normalized = normalizeGuardedBrowserSelectIntent({
  name: 'Theme',
  matchBy: 'label',
  value: 'Dark',
  taskContext: 'Choose a local visual appearance theme.',
});
assert(
  normalized.ok
    && normalized.args.role === 'combobox'
    && normalized.args.exact === true
    && normalized.args.submit === false
    && normalized.args.credentialSemantics === false,
  'normalizer supplies sealed safe defaults omitted from the public schema',
);
for (const [label, input] of [
  ['ambiguous target', {
    name: 'Theme',
    selector: '#theme',
    matchBy: 'label',
    value: 'Dark',
  }],
  ['implicit match mode', { name: 'Theme', value: 'Dark' }],
  ['custom widget role', {
    role: 'listbox',
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
  }],
  ['submit authority', {
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
    submit: true,
  }],
  ['non-exact authority', {
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
    exact: false,
  }],
  ['credential authority', {
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
    credentialSemantics: true,
  }],
  ['unknown semantics', {
    name: 'Setting',
    matchBy: 'label',
    value: 'Enabled',
  }],
  ['protected semantics', {
    name: 'Profile visibility',
    matchBy: 'label',
    value: 'Public',
  }],
  ['navigation field', {
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
    url: 'https://example.test/next',
  }],
  ['hidden capability', {
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
    targetId: 'model-authored',
  }],
] as const) {
  assert(
    !normalizeGuardedBrowserSelectIntent(input).ok,
    `normalizer rejects ${label}`,
  );
}
assert(
  groundingSource.includes('export function normalizeGuardedBrowserSelectIntent')
    && groundingSource.includes('Reflect.ownKeys(source)')
    && groundingSource.includes('GUARDED_BROWSER_SELECT_INPUT_FIELDS'),
  'normalizer is an exported strict plain-object allowlist boundary',
);

// Load only the pure production parsers so this Node smoke does not import
// React Native browser client dependencies.
const parserStart = clientSource.indexOf('function isBoundedOpaqueBrowserId(');
const parserEnd = clientSource.indexOf('\n// ─── Calls', parserStart);
const typescript = require('typescript') as typeof import('typescript');
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
const extractTarget = parserModule.exports.extractBrowserGuardedSelectTarget;
const extractProof = parserModule.exports.extractBrowserSelectProofMetadata;
assert(
  typeof extractTarget === 'function' && typeof extractProof === 'function',
  'production select target and proof parsers load as pure functions',
);

const identity = {
  browserProcessId: `uc_browser_process_${'a'.repeat(30)}`,
  browserContextId: `uc_browser_context_${'b'.repeat(30)}`,
  pageId: `uc_browser_page_${'c'.repeat(30)}`,
  url: 'https://example.test/preferences',
  observedAt: '2026-07-26T12:00:00.000Z',
  evidenceId: `uc_browser_evidence_${'d'.repeat(30)}`,
};
const targetFingerprint = `uc_browser_select_target_${'e'.repeat(64)}`;
const optionFingerprint = `uc_browser_select_option_${'f'.repeat(64)}`;
const previousOptionFingerprint = `uc_browser_select_option_${'1'.repeat(64)}`;
const targetId = `uc_browser_target_${'g'.repeat(30)}`;
const parsedTarget = extractTarget({
  ...identity,
  targetId,
  targetFingerprint,
  optionFingerprint,
  targetExpiresAt: '2026-07-26T12:02:00.000Z',
  matchBy: 'label',
  currentOptionFingerprint: previousOptionFingerprint,
  selectionMatches: false,
  rawLabel: 'must be dropped',
});
assert(
  parsedTarget
    && parsedTarget.targetId === targetId
    && parsedTarget.optionFingerprint === optionFingerprint
    && !('rawLabel' in parsedTarget),
  'target parser accepts only coherent bounded opaque identity and drops raw option text',
);
assert(
  extractTarget({
    ...parsedTarget,
    currentOptionFingerprint: optionFingerprint,
    selectionMatches: false,
  }) === null,
  'target parser rejects incoherent selection-match evidence',
);

const parsedProof = extractProof({
  ...identity,
  targetFingerprint,
  optionFingerprint,
  matchBy: 'label',
  previousOptionFingerprint,
  currentOptionFingerprint: optionFingerprint,
  selectionMatches: true,
  mutationPerformed: true,
  targetId,
  value: 'Dark',
  label: 'Dark',
});
assert(
  parsedProof
    && parsedProof.selectionMatches === true
    && parsedProof.mutationPerformed === true
    && !('targetId' in parsedProof)
    && !('value' in parsedProof)
    && !('label' in parsedProof),
  'proof parser returns a redacted coherent before/after option proof',
);
assert(
  extractProof({
    ...parsedProof,
    mutationPerformed: false,
  }) === null,
  'proof parser rejects a false no-op claim when before and desired options differ',
);
assert(
  extractProof({
    ...parsedProof,
    currentOptionFingerprint: previousOptionFingerprint,
    selectionMatches: true,
  }) === null,
  'proof parser rejects an incoherent desired-state claim',
);

assert(
  clientSource.includes('export async function observeGuardedBrowserSelectTarget')
    && clientSource.includes('export async function setGuardedBrowserSelectOption')
    && clientSource.includes("selectMode: 'observe_guarded_native'")
    && clientSource.includes("selectMode: 'guarded_native_single'")
    && clientSource.includes('unsealed browser selection is disabled'),
  'client exports only guarded live calls while the legacy function fails closed',
);

console.log(`browser-select-mutation-gateway-smoketest: ${assertions} assertions passed`);
