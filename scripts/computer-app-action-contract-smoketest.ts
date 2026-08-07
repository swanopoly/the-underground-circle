/**
 * Pure smoke for the dispatch-time observation/action/proof contract.
 * Run with:
 *   npx tsx scripts/computer-app-action-contract-smoketest.ts
 */

import {
  authorizeComputerAppMutation,
  buildComputerAppMutationApprovalKey,
  buildComputerAppToolArgsFingerprintAsync,
  buildComputerAppVerificationReceipt,
  createComputerAppObservationEpoch,
  dispatchAuthorizedComputerAppMutation,
  invalidateComputerAppObservationEpoch,
  normalizeGuardedBrowserFillIntent,
  normalizeGuardedBrowserSelectIntent,
  normalizeGuardedBrowserToggleIntent,
  resolveComputerAppMutationPolicy,
  type ComputerAppMutationContract,
  type ComputerAppMutationPolicyVerdict,
  type ComputerAppObservationEpoch,
} from '../src/lib/computerAppGrounding';

let assertions = 0;

function assert(condition: unknown, message: string, detail?: unknown): asserts condition {
  assertions += 1;
  if (!condition) {
    throw new Error(`${message}${detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`}`);
  }
}

async function main() {
const now = Date.parse('2026-07-24T16:00:00.000Z');
const before = createComputerAppObservationEpoch({
  id: 'obs-notes-before',
  surface: 'desktop',
  capturedAt: now,
  freshnessMs: 15_000,
  target: {
    appName: 'Notes',
    bundleId: 'com.apple.Notes',
    pid: 4242,
    windowId: 17,
    documentId: 'note-list-window',
    accessibilityGeneration: 31,
    screenshotId: 'shot-before',
  },
  evidenceIds: ['a11y-before', 'shot-before'],
});
const normalizedActionArgs = {
  text: 'A bounded note body.',
  mode: 'paste',
  target: 'note body',
};
const normalizedActionFingerprint = await buildComputerAppToolArgsFingerprintAsync(
  normalizedActionArgs,
);
assert(
  /^args-v2:sha256:[a-f0-9]{64}$/.test(normalizedActionFingerprint),
  'Web Crypto SHA-256 is available for exact mutation-argument binding',
);

const action: ComputerAppMutationContract = {
  schemaVersion: 1,
  actionId: 'create-note-1',
  tool: 'desktop.paste_text',
  surface: 'desktop',
  observationEpochId: before.id,
  expectedTarget: {
    appName: 'Notes',
    bundleId: 'com.apple.Notes',
    pid: 4242,
    windowId: 17,
    documentId: 'note-list-window',
    accessibilityGeneration: 31,
  },
  toolArgsFingerprint: normalizedActionFingerprint,
  risk: 'medium',
  approvalRequired: true,
  idempotencyKey: 'run-123:create-note-1',
  verification: {
    kind: 'accessibility',
    predicate: 'A new note contains the requested body in Notes.',
    evidenceTools: ['desktop.observe_app', 'desktop.screenshot'],
  },
  outcomeUnknownPolicy: 'verify_before_retry',
};
const approvalIntentKey = buildComputerAppMutationApprovalKey(action);
assert(
  await buildComputerAppToolArgsFingerprintAsync('abc')
    === 'args-v2:sha256:6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25',
  'tool argument fingerprint uses the canonical UTF-8 SHA-256 digest',
);
const normalizedFillFingerprint = await buildComputerAppToolArgsFingerprintAsync({
  exact: true,
  name: 'Title',
  role: 'textbox',
  submit: false,
  text: 'private draft value',
  timeoutMs: 15_000,
});
assert(
  normalizedFillFingerprint === await buildComputerAppToolArgsFingerprintAsync({
    timeoutMs: 15_000,
    text: 'private draft value',
    submit: false,
    role: 'textbox',
    name: 'Title',
    exact: true,
  }),
  'tool argument fingerprint is stable across object key ordering',
);
const nestedArrayFingerprint = await buildComputerAppToolArgsFingerprintAsync({
  steps: [
    { args: ['Photoshop', 600, 600], kind: 'launch' },
    [true, null, { height: 600, width: 600 }],
  ],
});
assert(
  nestedArrayFingerprint === await buildComputerAppToolArgsFingerprintAsync({
    steps: [
      { kind: 'launch', args: ['Photoshop', 600, 600] },
      [true, null, { width: 600, height: 600 }],
    ],
  }),
  'tool argument fingerprint preserves nested array order while canonicalizing nested object keys',
);
assert(
  normalizedFillFingerprint !== await buildComputerAppToolArgsFingerprintAsync({
    exact: true,
    name: 'Title',
    role: 'textbox',
    submit: false,
    text: 'different draft value',
    timeoutMs: 15_000,
  }),
  'tool argument fingerprint changes when a normalized argument changes',
);
assert(
  !normalizedFillFingerprint.includes('private draft value'),
  'tool argument fingerprint never exposes raw field text',
);
const cyclicFingerprintInput: Record<string, unknown> = {};
cyclicFingerprintInput.self = cyclicFingerprintInput;
assert(
  await buildComputerAppToolArgsFingerprintAsync(cyclicFingerprintInput) === '',
  'unsupported cyclic handler args fail closed instead of receiving a reusable fingerprint',
);
class FingerprintClassInput {
  width = 600;
}
for (const unsupportedFingerprintInput of [
  new Date('2026-07-24T16:00:00.000Z'),
  new Map([['width', 600]]),
  new Set([600]),
  new FingerprintClassInput(),
]) {
  assert(
    await buildComputerAppToolArgsFingerprintAsync(unsupportedFingerprintInput) === '',
    'non-plain object prototypes fail closed instead of collapsing to an empty object fingerprint',
  );
}
let getterCalls = 0;
const getterFingerprintInput = Object.defineProperty({}, 'width', {
  enumerable: true,
  get() {
    getterCalls += 1;
    return 600;
  },
});
assert(
  await buildComputerAppToolArgsFingerprintAsync(getterFingerprintInput) === '',
  'accessor-backed handler args fail closed',
);
assert(getterCalls === 0, 'fingerprint canonicalization never invokes an input getter');
const symbolFingerprintInput: Record<string | symbol, unknown> = { width: 600 };
symbolFingerprintInput[Symbol('hidden')] = 'mutation';
assert(
  await buildComputerAppToolArgsFingerprintAsync(symbolFingerprintInput) === '',
  'symbol-keyed handler args fail closed instead of being omitted from the fingerprint',
);
const sparseFingerprintInput = new Array(2);
sparseFingerprintInput[1] = 600;
assert(
  await buildComputerAppToolArgsFingerprintAsync(sparseFingerprintInput) === '',
  'sparse array handler args fail closed instead of treating holes as null',
);
const extraPropertyArray: unknown[] & { hidden?: string } = [600, 600];
extraPropertyArray.hidden = 'mutation';
assert(
  await buildComputerAppToolArgsFingerprintAsync(extraPropertyArray) === '',
  'arrays with extra properties fail closed instead of omitting unbound values',
);
const throwingProxyInput = new Proxy({ width: 600 }, {
  ownKeys() {
    throw new Error('untrusted traversal');
  },
});
let throwingProxyFingerprint = 'not-called';
try {
  throwingProxyFingerprint = await buildComputerAppToolArgsFingerprintAsync(throwingProxyInput);
} catch {
  throwingProxyFingerprint = 'threw';
}
assert(
  throwingProxyFingerprint === '',
  'proxy traversal failures resolve to an empty fingerprint instead of rejecting the async call',
);
assert(
  await buildComputerAppToolArgsFingerprintAsync(new Proxy({ width: 600 }, {})) === '',
  'otherwise transparent Proxy handler args fail closed at the structured-clone boundary',
);
assert(
  await buildComputerAppToolArgsFingerprintAsync(undefined) === ''
    && await buildComputerAppToolArgsFingerprintAsync(1n) === ''
    && await buildComputerAppToolArgsFingerprintAsync(() => 600) === '',
  'unsupported non-JSON values fail closed',
);
assert(
  await buildComputerAppToolArgsFingerprintAsync('x'.repeat(256_001)) === '',
  'pathologically large handler args fail closed before hashing',
);
const benignDraftIntent = normalizeGuardedBrowserFillIntent({
  name: 'Title',
  text: 'Write a password reset guide without including any credentials.',
});
assert(benignDraftIntent.ok, 'ordinary prose about security remains valid non-secret draft text');
for (const secretText of [
  'password: DontLogThisValue123!',
  'Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456',
  'api_key=sk-test_abcdefghijklmnopqrstuvwxyz',
  '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----',
  '123-45-6789',
]) {
  const rejectedSecretIntent = normalizeGuardedBrowserFillIntent({
    name: 'Title',
    text: secretText,
  });
  assert(!rejectedSecretIntent.ok, 'obviously secret-bearing draft text is rejected');
  assert(
    !rejectedSecretIntent.ok && !rejectedSecretIntent.error.includes(secretText),
    'secret-bearing draft rejection never reflects the raw value',
  );
}
const benignToggleIntent = normalizeGuardedBrowserToggleIntent({
  role: ' Switch ',
  name: 'Dark mode',
  desiredState: true,
  timeoutMs: 100,
  taskContext: 'Enable a local display preference.',
});
assert(benignToggleIntent.ok, 'a narrow non-consequential toggle intent is normalized');
assert(
  benignToggleIntent.ok
    && benignToggleIntent.args.role === 'switch'
    && benignToggleIntent.args.exact === true
    && benignToggleIntent.args.submit === false
    && benignToggleIntent.args.timeoutMs === 500,
  'toggle normalization fixes exact/non-submit semantics and bounds the timeout',
  benignToggleIntent,
);
assert(
  benignToggleIntent.ok
    && !('browserProcessId' in benignToggleIntent.args)
    && !('browserSessionId' in benignToggleIntent.args)
    && !('browserTabId' in benignToggleIntent.args)
    && !('url' in benignToggleIntent.args),
  'normalized model toggle args contain no hidden bridge target identity',
);
for (const [label, proposedArgs] of [
  ['broad role-only target', { role: 'checkbox', desiredState: true }],
  ['ambiguous dual locator', {
    role: 'checkbox',
    name: 'Dark mode',
    selector: '#dark-mode',
    desiredState: true,
  }],
  ['non-toggle role', { role: 'button', name: 'Dark mode', desiredState: true }],
  ['radio clear', { role: 'radio', name: 'Daily', desiredState: false }],
  ['submit authority', {
    role: 'checkbox',
    name: 'Dark mode',
    desiredState: true,
    submit: true,
  }],
  ['navigation authority', {
    role: 'checkbox',
    name: 'Dark mode',
    desiredState: true,
    url: 'https://example.test/next',
  }],
  ['generic click authority', {
    role: 'checkbox',
    name: 'Dark mode',
    desiredState: true,
    clickCount: 1,
  }],
  ['hidden browser identity', {
    role: 'checkbox',
    name: 'Dark mode',
    desiredState: true,
    browserTabId: 'model-authored-tab',
  }],
  ['credential target', {
    role: 'checkbox',
    name: 'Remember me',
    desiredState: true,
  }],
  ['CAPTCHA target', {
    role: 'checkbox',
    name: 'I am not a robot',
    desiredState: true,
  }],
  ['payment target', {
    role: 'checkbox',
    name: 'Confirm purchase',
    desiredState: true,
  }],
  ['destructive target', {
    role: 'checkbox',
    name: 'Delete my account',
    desiredState: true,
  }],
  ['publishing target', {
    role: 'switch',
    name: 'Publish automatically',
    desiredState: true,
  }],
  ['malformed optional field', {
    role: 'switch',
    name: 'Dark mode',
    desiredState: true,
    taskContext: 42,
  }],
] as const) {
  const normalized = normalizeGuardedBrowserToggleIntent(proposedArgs);
  assert(!normalized.ok, `toggle normalization rejects ${label}`, normalized);
}
const benignSelectIntent = normalizeGuardedBrowserSelectIntent({
  role: 'combobox',
  name: 'Theme',
  matchBy: 'label',
  value: 'Dark',
  submit: false,
  exact: true,
  timeoutMs: 45_000,
  taskContext: 'Choose a local visual appearance theme.',
  credentialSemantics: false,
});
assert(benignSelectIntent.ok, 'a narrow native presentation-select intent is normalized');
assert(
  benignSelectIntent.ok
    && benignSelectIntent.args.role === 'combobox'
    && benignSelectIntent.args.matchBy === 'label'
    && benignSelectIntent.args.value === 'Dark'
    && benignSelectIntent.args.exact === true
    && benignSelectIntent.args.submit === false
    && benignSelectIntent.args.credentialSemantics === false
    && benignSelectIntent.args.timeoutMs === 30_000,
  'select normalization preserves explicit match semantics and seals exact/non-submit authority',
  benignSelectIntent,
);
assert(
  benignSelectIntent.ok
    && !('targetId' in benignSelectIntent.args)
    && !('browserProcessId' in benignSelectIntent.args)
    && !('browserSessionId' in benignSelectIntent.args)
    && !('browserTabId' in benignSelectIntent.args)
    && !('url' in benignSelectIntent.args),
  'normalized model select args contain no hidden browser or option capability identity',
);
const defaultedSelectIntent = normalizeGuardedBrowserSelectIntent({
  name: 'Theme',
  matchBy: 'value',
  value: 'dark',
  taskContext: 'Choose a local visual theme.',
});
assert(
  defaultedSelectIntent.ok
    && defaultedSelectIntent.args.role === 'combobox'
    && defaultedSelectIntent.args.exact === true
    && defaultedSelectIntent.args.submit === false
    && defaultedSelectIntent.args.credentialSemantics === false,
  'select normalization supplies safe hidden defaults omitted by the public tool schema',
  defaultedSelectIntent,
);
for (const [label, proposedArgs] of [
  ['implicit match mode', {
    role: 'combobox',
    name: 'Theme',
    value: 'Dark',
    exact: true,
    submit: false,
    credentialSemantics: false,
  }],
  ['custom listbox role', {
    role: 'listbox',
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
    exact: true,
    submit: false,
    credentialSemantics: false,
  }],
  ['broad role-only target', {
    role: 'combobox',
    matchBy: 'value',
    value: 'dark',
    exact: true,
    submit: false,
    credentialSemantics: false,
  }],
  ['ambiguous dual locator', {
    role: 'combobox',
    name: 'Theme',
    selector: '#theme',
    matchBy: 'value',
    value: 'dark',
    exact: true,
    submit: false,
    credentialSemantics: false,
  }],
  ['unknown setting', {
    role: 'combobox',
    name: 'Setting',
    matchBy: 'label',
    value: 'Enabled',
    exact: true,
    submit: false,
    credentialSemantics: false,
  }],
  ['privacy setting', {
    role: 'combobox',
    name: 'Profile visibility',
    matchBy: 'label',
    value: 'Public',
    exact: true,
    submit: false,
    credentialSemantics: false,
  }],
  ['subscription setting', {
    role: 'combobox',
    name: 'Renewal plan',
    matchBy: 'value',
    value: 'annual',
    exact: true,
    submit: false,
    credentialSemantics: false,
  }],
  ['navigation authority', {
    role: 'combobox',
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
    exact: true,
    submit: false,
    credentialSemantics: false,
    url: 'https://example.test/next',
  }],
  ['generic click authority', {
    role: 'combobox',
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
    exact: true,
    submit: false,
    credentialSemantics: false,
    clickCount: 1,
  }],
  ['hidden target identity', {
    role: 'combobox',
    name: 'Theme',
    matchBy: 'label',
    value: 'Dark',
    exact: true,
    submit: false,
    credentialSemantics: false,
    targetId: 'model-authored-target',
  }],
  ['untrimmed exact value', {
    role: 'combobox',
    name: 'Theme',
    matchBy: 'label',
    value: ' Dark ',
    exact: true,
    submit: false,
    credentialSemantics: false,
  }],
] as const) {
  const normalized = normalizeGuardedBrowserSelectIntent(proposedArgs);
  assert(!normalized.ok, `select normalization rejects ${label}`, normalized);
}
const fillSelectionBypass = normalizeGuardedBrowserFillIntent({
  role: 'combobox',
  name: 'Theme',
  text: 'dark',
});
assert(
  !fillSelectionBypass.ok,
  'guarded fill normalization cannot mutate a selection control',
);
const freshAttemptSameIntent: ComputerAppMutationContract = {
  ...action,
  actionId: 'create-note-1-retry',
  observationEpochId: 'obs-notes-fresh-retry',
  idempotencyKey: 'run-124:create-note-1-retry',
};
assert(
  buildComputerAppMutationApprovalKey(freshAttemptSameIntent) === approvalIntentKey,
  'approval intent survives a fresh observation and retry identity when target and args are unchanged',
);
assert(
  buildComputerAppMutationApprovalKey({
    ...freshAttemptSameIntent,
    toolArgsFingerprint: 'sha256:different-note-body',
  }) !== approvalIntentKey,
  'approval intent changes when normalized tool arguments change',
);
assert(
  buildComputerAppMutationApprovalKey({
    ...freshAttemptSameIntent,
    expectedTarget: { ...freshAttemptSameIntent.expectedTarget, windowId: 18 },
  }) !== approvalIntentKey,
  'approval intent changes when stable target identity changes',
);
const browserIntent: ComputerAppMutationContract = {
  ...action,
  actionId: 'fill-browser-field',
  tool: 'browser.fill_field',
  surface: 'browser',
  observationEpochId: 'browser-before',
  expectedTarget: {
    browserProcessId: 'uc_browser_process_nonce_1',
    browserSessionId: 'uc_browser_context_nonce_2',
    browserTabId: 'uc_browser_page_nonce_3',
    browserTargetFingerprint: 'uc_browser_target_fingerprint_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    url: 'https://example.test/form',
  },
  idempotencyKey: 'run-123:fill-browser-field',
  toolArgsFingerprint: normalizedFillFingerprint,
  verification: {
    kind: 'browser_dom',
    predicate: 'The exact target field value matches the requested value.',
    evidenceTools: ['browser.fill_field'],
  },
};
const browserIntentKey = buildComputerAppMutationApprovalKey(browserIntent);
assert(
  buildComputerAppMutationApprovalKey({
    ...browserIntent,
    expectedTarget: {
      ...browserIntent.expectedTarget,
      browserProcessId: 'uc_browser_process_restarted_9',
    },
  }) !== browserIntentKey,
  'browser mutation approval is invalidated when the browser bridge process identity changes',
);
assert(
  buildComputerAppMutationApprovalKey({
    ...browserIntent,
    expectedTarget: {
      ...browserIntent.expectedTarget,
      browserTargetFingerprint: 'uc_browser_target_fingerprint_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    },
  }) !== browserIntentKey,
  'browser mutation approval is invalidated when the exact observed element fingerprint changes',
);
assert(
  Object.isFrozen(before)
    && Object.isFrozen(before.target)
    && Object.isFrozen(before.evidenceIds)
    && Object.isFrozen(before.blockerCodes),
  'runtime-issued observation epochs are deeply immutable',
);

async function policyFor(
  contract: ComputerAppMutationContract,
  decidedAt = now + 250,
  decision: 'approved' | 'auto_approved' | 'pending' | 'rejected' = 'approved',
): Promise<ComputerAppMutationPolicyVerdict> {
  return resolveComputerAppMutationPolicy({
    action: contract,
    approvalGate: async (request) => ({
      decision,
      approvalId: decision === 'approved' || decision === 'auto_approved'
        ? `approval:${contract.actionId || 'missing'}`
        : null,
      approvalKey: request.approvalKey,
    }),
    decidedAt,
  });
}

async function authorize(
  contract: ComputerAppMutationContract,
  epoch: ComputerAppObservationEpoch | null,
  checkedAt = now + 500,
  decision: 'approved' | 'auto_approved' | 'pending' | 'rejected' = 'approved',
) {
  return authorizeComputerAppMutation({
    action: contract,
    policy: await policyFor(contract, Math.min(checkedAt, now + 250), decision),
    epoch,
    now: checkedAt,
  });
}

const pendingFlowPolicy = await policyFor(action, now + 200, 'pending');
const pendingFlow = authorizeComputerAppMutation({
  action,
  policy: pendingFlowPolicy,
  epoch: before,
  now: now + 300,
});
assert(!pendingFlow.allowed, 'a newly proposed exact action pauses while approval is pending');
assert(pendingFlow.blockers.some((item) => item.code === 'approval_required'), 'pending proposal is typed');

const approvedFlowPolicy = await policyFor(action, now + 250, 'approved');
assert(
  approvedFlowPolicy.approvalKey === pendingFlowPolicy.approvalKey,
  'pending and approved lookups use the same exact-call approval key',
);
const allowed = authorizeComputerAppMutation({
  action,
  policy: approvedFlowPolicy,
  epoch: before,
  now: now + 500,
});
assert(allowed.allowed, 'fresh exact-target approved mutation is authorized', allowed);
assert(allowed.blockers.length === 0, 'authorized mutation has no blockers', allowed.blockers);

const duplicateAuthorization = await authorize(action, before);
assert(!duplicateAuthorization.allowed, 'the same idempotency key cannot receive a second authorization');
assert(
  duplicateAuthorization.blockers.some((item) => item.code === 'idempotency_replay'),
  'duplicate authorization returns a typed replay blocker',
);

const expiredPolicyAction = {
  ...action,
  actionId: 'expired-policy-action',
  idempotencyKey: 'run-123:expired-policy-action',
};
const expiredPolicyVerdict = authorizeComputerAppMutation({
  action: expiredPolicyAction,
  policy: await policyFor(expiredPolicyAction, now - (16 * 60_000)),
  epoch: before,
  now: now + 500,
});
assert(!expiredPolicyVerdict.allowed, 'an expired approval-policy verdict cannot authorize dispatch');
assert(
  expiredPolicyVerdict.blockers.some((item) => item.code === 'policy_mismatch'),
  'expired policy verdict fails closed with a typed mismatch',
);

const missingPolicy = authorizeComputerAppMutation({ action, epoch: before, now: now + 500 });
assert(!missingPolicy.allowed, 'a mutation without a runtime-issued policy verdict is blocked');
assert(
  missingPolicy.blockers.some((item) => item.code === 'policy_verdict_missing'),
  'missing runtime policy blocker is typed',
);

const validPolicy = await policyFor(action);
const forgedPolicy = { ...validPolicy };
const forgedPolicyVerdict = authorizeComputerAppMutation({
  action,
  policy: forgedPolicy,
  epoch: before,
  now: now + 500,
});
assert(!forgedPolicyVerdict.allowed, 'a JSON clone cannot impersonate a runtime-issued policy verdict');
assert(
  forgedPolicyVerdict.blockers.some((item) => item.code === 'policy_mismatch'),
  'untrusted policy identity fails closed',
);

const forgedBeforeEpoch = {
  ...before,
  target: { ...before.target },
  evidenceIds: [...before.evidenceIds],
  blockerCodes: [...before.blockerCodes],
};
const forgedBeforeVerdict = await authorize(
  {
    ...action,
    actionId: 'forged-before-action',
    observationEpochId: forgedBeforeEpoch.id,
    idempotencyKey: 'run-123:forged-before-action',
  },
  forgedBeforeEpoch,
);
assert(!forgedBeforeVerdict.allowed, 'a JSON clone cannot impersonate a runtime-issued observation epoch');
assert(
  forgedBeforeVerdict.blockers.some((item) => item.code === 'epoch_untrusted'),
  'untrusted observation identity fails closed',
);

const invalidIdentityEpoch = createComputerAppObservationEpoch({
  id: '   ',
  surface: 'desktop',
  capturedAt: now,
  target: before.target,
  evidenceIds: ['a11y-before'],
});
const invalidIdentityAction = { ...action, actionId: '', observationEpochId: invalidIdentityEpoch.id };
const invalidIdentityVerdict = await authorize(invalidIdentityAction, invalidIdentityEpoch);
assert(!invalidIdentityVerdict.allowed, 'missing action and epoch identities fail closed');
assert(
  invalidIdentityVerdict.blockers.some((item) => item.code === 'action_identity_missing')
    && invalidIdentityVerdict.blockers.some((item) => item.code === 'epoch_identity_missing'),
  'missing identity blockers are typed',
  invalidIdentityVerdict.blockers,
);

const unsupportedVersion = await authorize(
  { ...action, schemaVersion: 2 as ComputerAppMutationContract['schemaVersion'] },
  before,
);
assert(!unsupportedVersion.allowed, 'unsupported contract version fails closed');
assert(
  unsupportedVersion.blockers.some((item) => item.code === 'contract_version_unsupported'),
  'unsupported version blocker is typed',
);

const missingEpoch = await authorize(action, null);
assert(!missingEpoch.allowed, 'mutation without an observation epoch is blocked');
assert(missingEpoch.blockers.some((item) => item.code === 'missing_epoch'), 'missing epoch blocker is typed');

const stale = await authorize(action, before, now + 15_001);
assert(!stale.allowed, 'stale observation epoch is blocked');
assert(stale.blockers.some((item) => item.code === 'epoch_stale'), 'stale blocker is typed');

const pidMismatch = await authorize(
  { ...action, expectedTarget: { ...action.expectedTarget, pid: 9999 } },
  before,
);
assert(!pidMismatch.allowed, 'focus/process identity mismatch is blocked');
assert(
  pidMismatch.blockers.some((item) => item.code === 'target_mismatch' && item.detail.includes('pid')),
  'target mismatch identifies the changed PID',
  pidMismatch.blockers,
);

const omittedWindowIdentity = await authorize(
  {
    ...action,
    expectedTarget: {
      appName: 'Notes',
      bundleId: 'com.apple.Notes',
      pid: 4242,
      documentId: 'note-list-window',
      accessibilityGeneration: 31,
    },
  },
  before,
);
assert(!omittedWindowIdentity.allowed, 'action cannot omit identity fields present in the live observation');
assert(
  omittedWindowIdentity.blockers.some((item) => item.code === 'target_identity_missing' && item.detail.includes('windowId')),
  'omitted live identity field is named',
);

const revocableEpoch = createComputerAppObservationEpoch({
  id: 'obs-revocable',
  surface: 'desktop',
  capturedAt: now,
  target: before.target,
  evidenceIds: ['revocable-before'],
});
const revocableAction: ComputerAppMutationContract = {
  ...action,
  actionId: 'revocable-action',
  observationEpochId: revocableEpoch.id,
  idempotencyKey: 'run-123:revocable-action',
};
const invalidated = invalidateComputerAppObservationEpoch(revocableEpoch, 'focus changed', now + 600);
const invalidatedVerdict = await authorize(revocableAction, invalidated, now + 700);
assert(!invalidatedVerdict.allowed, 'invalidated epoch never becomes valid again');
assert(invalidatedVerdict.blockers.some((item) => item.code === 'epoch_invalidated'), 'invalidation blocker is typed');
const retainedOriginalVerdict = await authorize(revocableAction, revocableEpoch, now + 700);
assert(!retainedOriginalVerdict.allowed, 'invalidation revokes the retained original epoch identity too');
assert(
  retainedOriginalVerdict.blockers.some((item) => item.code === 'epoch_invalidated'),
  'retained original epoch reports typed invalidation',
);
assert(
  invalidateComputerAppObservationEpoch(invalidated, 'second reason', now + 800).invalidationReason === 'focus changed',
  'invalidation is advance-only and preserves the first cause',
);

const pendingApproval = await authorize(action, before, now + 500, 'pending');
assert(!pendingApproval.allowed, 'approval-required pending action is blocked');
assert(pendingApproval.blockers.some((item) => item.code === 'approval_required'), 'approval blocker is typed');

const rejectedApprovalAction = {
  ...action,
  actionId: 'rejected-action',
  idempotencyKey: 'run-123:rejected-action',
};
const rejectedApproval = await authorize(rejectedApprovalAction, before, now + 500, 'rejected');
assert(!rejectedApproval.allowed, 'rejected action is blocked');
assert(rejectedApproval.blockers.some((item) => item.code === 'approval_rejected'), 'rejection blocker is typed');

const hiddenCriticalApproval = await authorize(
  {
    ...action,
    risk: 'critical',
    approvalRequired: false,
    actionId: 'hidden-critical-approval',
    idempotencyKey: 'run-123:hidden-critical-approval',
  },
  before,
  now + 500,
  'pending',
);
assert(!hiddenCriticalApproval.allowed, 'critical risk cannot bypass approval by clearing approvalRequired');

const unsafeContract = await authorize(
  {
    ...action,
    idempotencyKey: '',
    verification: { kind: 'visual', predicate: '', evidenceTools: [] },
    outcomeUnknownPolicy: 'invalid' as ComputerAppMutationContract['outcomeUnknownPolicy'],
  },
  before,
);
assert(!unsafeContract.allowed, 'missing idempotency, proof, and replay policy blocks dispatch');
assert(unsafeContract.blockers.some((item) => item.code === 'idempotency_key_missing'), 'idempotency blocker is typed');
assert(unsafeContract.blockers.some((item) => item.code === 'verification_missing'), 'verification blocker is typed');
assert(unsafeContract.blockers.some((item) => item.code === 'unsafe_replay_policy'), 'replay blocker is typed');

const underclassifiedDelete: ComputerAppMutationContract = {
  ...action,
  actionId: 'delete-file-1',
  tool: 'desktop.file_delete',
  risk: 'low',
  approvalRequired: false,
  idempotencyKey: 'run-123:delete-file-1',
};
const underclassifiedPolicy = await policyFor(underclassifiedDelete, now + 250, 'pending');
assert(
  underclassifiedPolicy.risk === 'high'
    && underclassifiedPolicy.approvalRequired
    && underclassifiedPolicy.approvalState === 'pending',
  'runtime policy raises a destructive tool above a model-supplied low-risk label',
  underclassifiedPolicy,
);
const underclassifiedDeleteVerdict = authorizeComputerAppMutation({
  action: underclassifiedDelete,
  policy: underclassifiedPolicy,
  epoch: before,
  now: now + 500,
});
assert(!underclassifiedDeleteVerdict.allowed, 'underclassified destructive mutation cannot dispatch');
assert(
  underclassifiedDeleteVerdict.blockers.some((item) => item.code === 'approval_required'),
  'underclassified destructive mutation is raised into the approval flow',
);

for (const tool of [
  'desktop.set_element_value',
  'desktop.photoshop_place_asset',
  'browser.fill_field',
]) {
  const underclassifiedMutation: ComputerAppMutationContract = {
    ...action,
    actionId: `underclassified:${tool}`,
    tool,
    risk: 'low',
    approvalRequired: false,
    idempotencyKey: `run-123:${tool}`,
    toolArgsFingerprint: `sha256:${tool}:args`,
  };
  const runtimePolicy = await policyFor(underclassifiedMutation, now + 250, 'pending');
  assert(
    runtimePolicy.risk === 'medium'
      && runtimePolicy.approvalRequired
      && runtimePolicy.approvalState === 'pending',
    `${tool} defaults to a reviewable mutation policy`,
    runtimePolicy,
  );
  const verdict = authorizeComputerAppMutation({
    action: underclassifiedMutation,
    policy: runtimePolicy,
    epoch: before,
    now: now + 500,
  });
  assert(!verdict.allowed, `${tool} cannot dispatch with a model-supplied low/no-approval contract`);
}

const missingArgsFingerprint = await authorize(
  { ...action, toolArgsFingerprint: '' },
  before,
);
assert(!missingArgsFingerprint.allowed, 'mutation without an exact tool-argument fingerprint is blocked');
assert(
  missingArgsFingerprint.blockers.some((item) => item.code === 'tool_args_fingerprint_missing'),
  'missing tool-argument fingerprint blocker is typed',
);

const expiringEpoch = createComputerAppObservationEpoch({
  id: 'obs-expiring-before-dispatch',
  surface: 'desktop',
  capturedAt: now,
  freshnessMs: 1_000,
  target: before.target,
  evidenceIds: ['expiring-before'],
});
const expiringAction: ComputerAppMutationContract = {
  ...action,
  actionId: 'expiring-action',
  observationEpochId: expiringEpoch.id,
  idempotencyKey: 'run-123:expiring-action',
};
const expiringAuthorization = await authorize(expiringAction, expiringEpoch, now + 500);
assert(expiringAuthorization.allowed, 'fresh observation can authorize before its deadline');
let expiredHandlerEntries = 0;
let expiredDispatchRejected = false;
try {
  await dispatchAuthorizedComputerAppMutation({
    action: expiringAction,
    authorization: expiringAuthorization,
    normalizedArgs: normalizedActionArgs,
    handler: async () => {
      expiredHandlerEntries += 1;
    },
    now: now + 1_001,
  });
} catch (error) {
  expiredDispatchRejected = /expired/i.test(String(error));
}
assert(expiredDispatchRejected && expiredHandlerEntries === 0, 'authorization cannot be held past observation expiry');
const refreshedExpiringEpoch = createComputerAppObservationEpoch({
  id: 'obs-expiring-refreshed',
  surface: 'desktop',
  capturedAt: now + 1_100,
  target: before.target,
  evidenceIds: ['expiring-refreshed'],
});
const refreshedExpiringAction = {
  ...expiringAction,
  observationEpochId: refreshedExpiringEpoch.id,
};
assert(
  (await authorize(refreshedExpiringAction, refreshedExpiringEpoch, now + 1_200)).allowed,
  'an undispatched expired reservation releases the stable idempotency key for fresh reauthorization',
);

const revokeAfterAuthorizationEpoch = createComputerAppObservationEpoch({
  id: 'obs-revoked-after-authorization',
  surface: 'desktop',
  capturedAt: now,
  target: before.target,
  evidenceIds: ['revoked-after-authorization'],
});
const revokeAfterAuthorizationAction: ComputerAppMutationContract = {
  ...action,
  actionId: 'revoke-after-authorization',
  observationEpochId: revokeAfterAuthorizationEpoch.id,
  idempotencyKey: 'run-123:revoke-after-authorization',
};
const revokeAfterAuthorization = await authorize(
  revokeAfterAuthorizationAction,
  revokeAfterAuthorizationEpoch,
  now + 500,
);
assert(revokeAfterAuthorization.allowed, 'mutation is authorized before its observation is revoked');
invalidateComputerAppObservationEpoch(revokeAfterAuthorizationEpoch, 'modal appeared', now + 600);
let revokedHandlerEntries = 0;
let revokedDispatchRejected = false;
try {
  await dispatchAuthorizedComputerAppMutation({
    action: revokeAfterAuthorizationAction,
    authorization: revokeAfterAuthorization,
    normalizedArgs: normalizedActionArgs,
    handler: async () => {
      revokedHandlerEntries += 1;
    },
    now: now + 700,
  });
} catch (error) {
  revokedDispatchRejected = /invalidated/i.test(String(error));
}
assert(revokedDispatchRejected && revokedHandlerEntries === 0, 'revocation after authorization still blocks handler entry');

const mismatchedArgsEpoch = createComputerAppObservationEpoch({
  id: 'obs-mismatched-handler-args',
  surface: 'desktop',
  capturedAt: now,
  target: before.target,
  evidenceIds: ['mismatched-handler-args-before'],
});
const mismatchedArgsAction: ComputerAppMutationContract = {
  ...action,
  actionId: 'mismatched-handler-args',
  observationEpochId: mismatchedArgsEpoch.id,
  idempotencyKey: 'run-123:mismatched-handler-args',
};
const mismatchedArgsAuthorization = await authorize(
  mismatchedArgsAction,
  mismatchedArgsEpoch,
  now + 500,
);
let mismatchedArgsHandlerEntries = 0;
let mismatchedArgsRejected = false;
try {
  await dispatchAuthorizedComputerAppMutation({
    action: mismatchedArgsAction,
    authorization: mismatchedArgsAuthorization,
    normalizedArgs: { ...normalizedActionArgs, text: 'A different note body.' },
    handler: async () => {
      mismatchedArgsHandlerEntries += 1;
    },
    now: now + 600,
  });
} catch (error) {
  mismatchedArgsRejected = /fingerprint/i.test(String(error));
}
assert(
  mismatchedArgsRejected && mismatchedArgsHandlerEntries === 0,
  'dispatcher recomputes SHA-256 over sealed handler args and rejects contract drift before entry',
);

const sharedEpoch = createComputerAppObservationEpoch({
  id: 'obs-shared-sibling-dispatch',
  surface: 'desktop',
  capturedAt: now,
  target: before.target,
  evidenceIds: ['shared-sibling-before'],
});
const sharedFirstAction: ComputerAppMutationContract = {
  ...action,
  actionId: 'shared-epoch-first',
  observationEpochId: sharedEpoch.id,
  idempotencyKey: 'run-123:shared-epoch-first',
};
const sharedSiblingAction: ComputerAppMutationContract = {
  ...action,
  actionId: 'shared-epoch-sibling',
  observationEpochId: sharedEpoch.id,
  idempotencyKey: 'run-123:shared-epoch-sibling',
};
const sharedFirstAuthorization = await authorize(sharedFirstAction, sharedEpoch, now + 500);
const sharedSiblingAuthorization = await authorize(sharedSiblingAction, sharedEpoch, now + 500);
assert(
  sharedFirstAuthorization.allowed && sharedSiblingAuthorization.allowed,
  'sibling plans can be pre-authorized against the same still-fresh observation',
);
let sharedSiblingHandlerEntries = 0;
let sharedSiblingRejectedInsideFirstHandler = false;
const sharedFirstDispatch = await dispatchAuthorizedComputerAppMutation({
  action: sharedFirstAction,
  authorization: sharedFirstAuthorization,
  normalizedArgs: normalizedActionArgs,
  handler: async () => {
    try {
      await dispatchAuthorizedComputerAppMutation({
        action: sharedSiblingAction,
        authorization: sharedSiblingAuthorization,
        normalizedArgs: normalizedActionArgs,
        handler: async () => {
          sharedSiblingHandlerEntries += 1;
        },
        now: now + 601,
      });
    } catch (error) {
      sharedSiblingRejectedInsideFirstHandler = /invalidated/i.test(String(error));
    }
    return 'first-handler-entered';
  },
  now: now + 600,
});
assert(
  sharedFirstDispatch.ok
    && sharedSiblingRejectedInsideFirstHandler
    && sharedSiblingHandlerEntries === 0,
  'first dispatch revokes the bound observation synchronously before sibling handler entry',
);

const claimRaceEpoch = createComputerAppObservationEpoch({
  id: 'obs-idempotency-claim-race',
  surface: 'desktop',
  capturedAt: now,
  target: before.target,
  evidenceIds: ['claim-race-before'],
});
const claimRaceAction: ComputerAppMutationContract = {
  ...action,
  actionId: 'idempotency-claim-race',
  observationEpochId: claimRaceEpoch.id,
  idempotencyKey: 'run-123:idempotency-claim-race',
};
const oldClaimPolicy = await policyFor(claimRaceAction, now - (15 * 60_000) + 1_000);
const oldClaimAuthorization = authorizeComputerAppMutation({
  action: claimRaceAction,
  policy: oldClaimPolicy,
  epoch: claimRaceEpoch,
  now,
});
assert(oldClaimAuthorization.allowed, 'near-expiry policy can issue a short-lived exact authorization');
const freshClaimAuthorization = authorizeComputerAppMutation({
  action: claimRaceAction,
  policy: await policyFor(claimRaceAction, now + 1_001),
  epoch: claimRaceEpoch,
  now: now + 1_001,
});
assert(freshClaimAuthorization.allowed, 'fresh authorization can reclaim an expired undispatched reservation');
let lateOldDispatchRejected = false;
try {
  await dispatchAuthorizedComputerAppMutation({
    action: claimRaceAction,
    authorization: oldClaimAuthorization,
    normalizedArgs: normalizedActionArgs,
    handler: async () => 'old-handler-must-not-enter',
    now: now + 1_002,
  });
} catch (error) {
  lateOldDispatchRejected = /expired/i.test(String(error));
}
assert(lateOldDispatchRejected, 'late old authorization cannot consume or release a newer claim');
const freshClaimDispatch = await dispatchAuthorizedComputerAppMutation({
  action: claimRaceAction,
  authorization: freshClaimAuthorization,
  normalizedArgs: normalizedActionArgs,
  handler: async () => 'fresh-handler-entered',
  now: now + 1_003,
});
assert(
  freshClaimDispatch.ok && freshClaimDispatch.value === 'fresh-handler-entered',
  'newer exact authorization retains and consumes only its own idempotency claim',
);

const dispatched = await dispatchAuthorizedComputerAppMutation({
  action,
  authorization: allowed,
  normalizedArgs: normalizedActionArgs,
  handler: async (sealedArgs) => {
    assert(
      Object.isFrozen(sealedArgs)
        && typeof sealedArgs === 'object'
        && sealedArgs !== null
        && Object.values(sealedArgs).every((value) => (
          !value || typeof value !== 'object' || Object.isFrozen(value)
        )),
      'handler receives a deeply frozen canonical argument snapshot',
    );
    return 'handler-entered';
  },
  now: now + 1_000,
});
assert(dispatched.ok && dispatched.value === 'handler-entered', 'authorized wrapper enters the exact handler');
const dispatchReceipt = dispatched.dispatchReceipt;
let repeatedDispatchRejected = false;
try {
  await dispatchAuthorizedComputerAppMutation({
    action,
    authorization: allowed,
    normalizedArgs: normalizedActionArgs,
    handler: async () => 'must-not-run',
    now: now + 1_100,
  });
} catch (error) {
  repeatedDispatchRejected = /consumed/i.test(String(error));
}
assert(repeatedDispatchRejected, 'one allowed authorization can enter a mutation handler only once');

const after = createComputerAppObservationEpoch({
  id: 'obs-notes-after',
  surface: 'desktop',
  capturedAt: now + 1_500,
  freshnessMs: 15_000,
  target: {
    ...before.target,
    accessibilityGeneration: 32,
    screenshotId: 'shot-after',
  },
  evidenceIds: ['a11y-after', 'shot-after'],
});

const verified = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: after,
  predicateSatisfied: true,
  evidenceIds: ['note-body-match'],
  checkedAt: now + 1_600,
});
assert(verified.status === 'verified' && verified.canComplete, 'newer matching after-state can complete', verified);
assert(verified.evidenceIds.includes('shot-after'), 'receipt carries after-state proof');
assert(
  Object.isFrozen(verified)
    && Object.isFrozen(verified.evidenceIds)
    && Object.isFrozen(verified.blockers),
  'verification receipts are deeply immutable before hidden metadata branding',
);

const forgedBeforeReceipt = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: {
    ...before,
    target: { ...before.target },
    evidenceIds: [...before.evidenceIds],
    blockerCodes: [...before.blockerCodes],
  },
  afterEpoch: after,
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!forgedBeforeReceipt.canComplete, 'a cloned before-state epoch cannot finalize a mutation');
assert(
  forgedBeforeReceipt.blockers.some((item) => item.includes('not issued by this runtime')),
  'cloned before-state proof fails the runtime identity boundary',
);

const forgedAfterReceipt = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: {
    ...after,
    target: { ...after.target },
    evidenceIds: [...after.evidenceIds],
    blockerCodes: [...after.blockerCodes],
  },
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!forgedAfterReceipt.canComplete, 'a cloned after-state epoch cannot prove completion');
assert(
  forgedAfterReceipt.blockers.some((item) => item.includes('not issued by this runtime')),
  'cloned after-state proof fails the runtime identity boundary',
);

const mutatedContractReceipt = buildComputerAppVerificationReceipt({
  action: { ...action, tool: 'desktop.type_text' },
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: after,
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!mutatedContractReceipt.canComplete, 'authorized contract cannot be changed before finalization');
assert(
  mutatedContractReceipt.blockers.some((item) => item.includes('contract changed')),
  'receipt names post-authorization contract drift',
);

const preDispatchAfter = createComputerAppObservationEpoch({
  id: 'obs-before-dispatch',
  surface: 'desktop',
  capturedAt: now + 400,
  target: before.target,
  evidenceIds: ['too-early'],
});
const preDispatchReceipt = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: preDispatchAfter,
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!preDispatchReceipt.canComplete, 'an observation captured before actual handler entry cannot prove the mutation');

const forgedDispatchReceipt = { ...dispatchReceipt };
const forgedDispatchProof = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt: forgedDispatchReceipt,
  beforeEpoch: before,
  afterEpoch: after,
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!forgedDispatchProof.canComplete, 'a JSON clone cannot impersonate a runtime dispatch receipt');
assert(
  forgedDispatchProof.blockers.some((item) => item.includes('not issued by this runtime')),
  'untrusted dispatch receipt fails closed',
);

const staleAfter = createComputerAppObservationEpoch({
  id: 'obs-stale-after',
  surface: 'desktop',
  capturedAt: now + 1_500,
  freshnessMs: 1_000,
  target: after.target,
  evidenceIds: ['stale-after'],
});
const staleAfterReceipt = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: staleAfter,
  predicateSatisfied: true,
  checkedAt: now + 3_000,
});
assert(!staleAfterReceipt.canComplete, 'expired after-state evidence cannot prove completion');

const futureAfter = createComputerAppObservationEpoch({
  id: 'obs-future-after',
  surface: 'desktop',
  capturedAt: now + 5_000,
  target: after.target,
  evidenceIds: ['future-after'],
});
const futureAfterReceipt = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: futureAfter,
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!futureAfterReceipt.canComplete, 'future-dated after-state evidence cannot prove completion');

const mismatchedBeforeReceipt = buildComputerAppVerificationReceipt({
  action: { ...action, observationEpochId: 'another-before-epoch' },
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: after,
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!mismatchedBeforeReceipt.canComplete, 'action and before-epoch identity must match at finalization');

const noAfter = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: null,
  predicateSatisfied: null,
  checkedAt: now + 1_600,
});
assert(noAfter.status === 'inconclusive' && !noAfter.canComplete, 'missing after-state is inconclusive');

const changedTargetAfter = createComputerAppObservationEpoch({
  id: 'obs-wrong-app-after',
  surface: 'desktop',
  capturedAt: now + 1_500,
  target: {
    appName: 'Mail',
    bundleId: 'com.apple.mail',
    pid: 7070,
    windowId: 88,
  },
  evidenceIds: ['wrong-app-shot'],
});
const changedTargetReceipt = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: changedTargetAfter,
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!changedTargetReceipt.canComplete, 'proof from a different app cannot complete the task');
assert(changedTargetReceipt.blockers.some((item) => item.includes('target changed')), 'receipt explains target drift');

const changedWindowAfter = createComputerAppObservationEpoch({
  id: 'obs-window-drift-after',
  surface: 'desktop',
  capturedAt: now + 1_500,
  target: {
    ...before.target,
    windowId: 18,
    accessibilityGeneration: 32,
  },
  evidenceIds: ['wrong-window-shot'],
});
const changedWindowReceipt = buildComputerAppVerificationReceipt({
  action,
  authorization: allowed,
  dispatchReceipt,
  beforeEpoch: before,
  afterEpoch: changedWindowAfter,
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!changedWindowReceipt.canComplete, 'same-process proof from another window cannot complete the task');

const browserEpoch = createComputerAppObservationEpoch({
  id: 'obs-browser-before',
  surface: 'browser',
  capturedAt: now,
  target: {
    browserSessionId: 'browserbase-session-1',
    browserTabId: 'tab-3',
    url: 'https://example.test/settings',
  },
  evidenceIds: ['dom-before'],
});
const browserAction: ComputerAppMutationContract = {
  ...action,
  actionId: 'save-settings-1',
  tool: 'browser.click_role',
  surface: 'browser',
  observationEpochId: browserEpoch.id,
  expectedTarget: {
    browserSessionId: 'browserbase-session-1',
    browserTabId: 'tab-3',
    url: 'https://example.test/settings',
  },
  idempotencyKey: 'run-123:save-settings-1',
  verification: {
    kind: 'browser_dom',
    predicate: 'The settings saved confirmation is visible.',
    evidenceTools: ['browser.dom_snapshot'],
  },
};
const browserAllowed = await authorize(browserAction, browserEpoch);
assert(browserAllowed.allowed, 'browser mutation accepts exact session/tab/URL identity');
const browserDispatch = await dispatchAuthorizedComputerAppMutation({
  action: browserAction,
  authorization: browserAllowed,
  normalizedArgs: normalizedActionArgs,
  handler: async () => 'browser-handler-entered',
  now: now + 1_000,
});
assert(browserDispatch.ok, 'authorized browser mutation enters its handler');
const missingUrlAfter = createComputerAppObservationEpoch({
  id: 'obs-browser-after-missing-url',
  surface: 'browser',
  capturedAt: now + 1_500,
  target: {
    browserSessionId: 'browserbase-session-1',
    browserTabId: 'tab-3',
  },
  evidenceIds: ['dom-after-missing-url'],
});
const missingUrlReceipt = buildComputerAppVerificationReceipt({
  action: browserAction,
  authorization: browserAllowed,
  dispatchReceipt: browserDispatch.dispatchReceipt,
  beforeEpoch: browserEpoch,
  afterEpoch: missingUrlAfter,
  predicateSatisfied: true,
  checkedAt: now + 1_600,
});
assert(!missingUrlReceipt.canComplete, 'browser after-state without a URL cannot prove completion');
assert(
  missingUrlReceipt.blockers.some((item) => item.includes('complete required target identity')),
  'missing browser after-state identity is explicit',
);

const browserTabDrift = await authorize(
  { ...browserAction, expectedTarget: { ...browserAction.expectedTarget, browserTabId: 'tab-4' } },
  browserEpoch,
);
assert(!browserTabDrift.allowed, 'browser tab drift blocks mutation');

const browserUrlCaseDrift = await authorize(
  {
    ...browserAction,
    expectedTarget: {
      ...browserAction.expectedTarget,
      url: 'https://example.test/Settings',
    },
  },
  browserEpoch,
);
assert(!browserUrlCaseDrift.allowed, 'case-sensitive URL path drift blocks mutation');

const capacityEpoch = createComputerAppObservationEpoch({
  id: 'obs-idempotency-capacity',
  surface: 'desktop',
  capturedAt: now,
  target: before.target,
  evidenceIds: ['capacity-before'],
});
let firstCapacityAction: ComputerAppMutationContract | null = null;
let capacityVerdict: ReturnType<typeof authorizeComputerAppMutation> | null = null;
for (let index = 0; index < 4_200; index += 1) {
  const capacityAction: ComputerAppMutationContract = {
    ...action,
    actionId: `capacity-action-${index}`,
    observationEpochId: capacityEpoch.id,
    toolArgsFingerprint: `sha256:capacity-action-${index}`,
    idempotencyKey: `run-capacity:${index}`,
  };
  const verdict = await authorize(capacityAction, capacityEpoch, now + 500);
  if (verdict.allowed && !firstCapacityAction) firstCapacityAction = capacityAction;
  if (verdict.blockers.some((item) => item.code === 'idempotency_capacity')) {
    capacityVerdict = verdict;
    break;
  }
}
assert(!!capacityVerdict, 'idempotency registry fails closed at capacity');
assert(
  capacityVerdict?.blockers.some((item) => item.code === 'idempotency_capacity'),
  'capacity failure has a typed blocker',
);
assert(!!firstCapacityAction, 'capacity exercise admitted at least one bounded claim');
const retainedCapacityClaim = firstCapacityAction
  ? await authorize(firstCapacityAction, capacityEpoch, now + 500)
  : null;
assert(
  !!retainedCapacityClaim
    && !retainedCapacityClaim.allowed
    && retainedCapacityClaim.blockers.some((item) => item.code === 'idempotency_replay'),
  'capacity never evicts an older live claim and cannot reopen it for replay',
);

console.log(`computer-app-action-contract-smoketest: ${assertions} assertions passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
