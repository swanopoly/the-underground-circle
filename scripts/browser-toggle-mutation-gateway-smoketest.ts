/**
 * Focused smoke for the browser.set_toggle model boundary and sealed mutation
 * gateway. Run with:
 *   npx tsx scripts/browser-toggle-mutation-gateway-smoketest.ts
 */

import {
  authorizeComputerAppMutation,
  buildComputerAppToolArgsFingerprintAsync,
  createComputerAppObservationEpoch,
  dispatchAuthorizedComputerAppMutation,
  normalizeGuardedBrowserToggleIntent,
  resolveComputerAppMutationPolicy,
  type ComputerAppMutationContract,
  type ComputerAppObservationEpoch,
  type GuardedBrowserToggleIntent,
} from '../src/lib/computerAppGrounding';

let assertions = 0;

function assert(condition: unknown, message: string, detail?: unknown): asserts condition {
  assertions += 1;
  if (!condition) {
    throw new Error(
      `${message}${detail === undefined ? '' : `\n${JSON.stringify(detail, null, 2)}`}`,
    );
  }
}

async function expectReject(
  operation: () => Promise<unknown>,
  pattern: RegExp,
  message: string,
) {
  let rejection: unknown = null;
  try {
    await operation();
  } catch (error) {
    rejection = error;
  }
  assert(rejection instanceof Error, message);
  assert(pattern.test(rejection.message), `${message} with the expected reason`, rejection.message);
}

const now = Date.parse('2026-07-25T16:00:00.000Z');
const browserTarget = {
  browserProcessId: 'uc-browser-process-toggle-smoke',
  browserSessionId: 'uc-browser-context-toggle-smoke',
  browserTabId: 'uc-browser-page-toggle-smoke',
  browserTargetFingerprint: `uc-browser-target-${'a'.repeat(64)}`,
  url: 'https://example.test/preferences',
};

function buildRuntimeToggleDispatchArgs(
  modelArgs: GuardedBrowserToggleIntent,
  targetId: string,
) {
  return {
    targetId,
    targetFingerprint: browserTarget.browserTargetFingerprint,
    desiredState: modelArgs.desiredState,
    submit: false as const,
    timeoutMs: modelArgs.timeoutMs,
    ...(modelArgs.taskContext ? { taskContext: modelArgs.taskContext } : {}),
    credentialSemantics: false as const,
    expectedBrowserProcessId: browserTarget.browserProcessId,
    expectedBrowserContextId: browserTarget.browserSessionId,
    expectedPageId: browserTarget.browserTabId,
    expectedUrl: browserTarget.url,
  };
}

function createToggleEpoch(id: string): ComputerAppObservationEpoch {
  return createComputerAppObservationEpoch({
    id,
    surface: 'browser',
    capturedAt: now,
    freshnessMs: 30_000,
    target: browserTarget,
    evidenceIds: [`dom:${id}`],
  });
}

function createToggleAction(
  id: string,
  epoch: ComputerAppObservationEpoch,
  toolArgsFingerprint: string,
): ComputerAppMutationContract {
  return {
    schemaVersion: 1,
    actionId: id,
    tool: 'browser.set_toggle',
    surface: 'browser',
    observationEpochId: epoch.id,
    expectedTarget: browserTarget,
    toolArgsFingerprint,
    risk: 'medium',
    approvalRequired: true,
    idempotencyKey: `toggle-smoke:${id}`,
    verification: {
      kind: 'browser_dom',
      predicate: 'The exact observed toggle reports the requested checked state.',
      evidenceTools: ['browser.dom_snapshot'],
    },
    outcomeUnknownPolicy: 'verify_before_retry',
  };
}

async function authorizeToggle(
  action: ComputerAppMutationContract,
  epoch: ComputerAppObservationEpoch,
  offsetMs: number,
) {
  const policy = await resolveComputerAppMutationPolicy({
    action,
    approvalGate: async (request) => ({
      decision: 'approved',
      approvalId: `approval:${action.actionId}`,
      approvalKey: request.approvalKey,
    }),
    decidedAt: now + offsetMs,
  });
  const authorization = authorizeComputerAppMutation({
    action,
    policy,
    epoch,
    now: now + offsetMs + 10,
  });
  assert(authorization.allowed, `${action.actionId} receives a sealed runtime authorization`, authorization);
  return authorization;
}

async function main() {
  const normalizedByName = normalizeGuardedBrowserToggleIntent({
    role: ' Switch ',
    name: 'Dark mode',
    desiredState: true,
    submit: false,
    exact: true,
    timeoutMs: 45_000.9,
    taskContext: 'Enable a local visual preference.',
    credentialSemantics: false,
  });
  assert(normalizedByName.ok, 'an exact, non-consequential named switch is accepted');
  assert(
    normalizedByName.ok
      && normalizedByName.args.role === 'switch'
      && normalizedByName.args.name === 'Dark mode'
      && normalizedByName.args.desiredState === true
      && normalizedByName.args.submit === false
      && normalizedByName.args.exact === true
      && normalizedByName.args.timeoutMs === 30_000
      && normalizedByName.args.credentialSemantics === false,
    'the named switch is canonicalized to bounded exact non-submit args',
    normalizedByName,
  );

  const normalizedBySelector = normalizeGuardedBrowserToggleIntent({
    role: 'checkbox',
    selector: '[data-testid="reduce-motion"]',
    desiredState: false,
    timeoutMs: 250,
  });
  assert(normalizedBySelector.ok, 'an exact selector can safely request a checkbox false state');
  assert(
    normalizedBySelector.ok
      && normalizedBySelector.args.timeoutMs === 500
      && !('name' in normalizedBySelector.args),
    'selector targeting remains singular and timeout is lower-bounded',
    normalizedBySelector,
  );

  const selectedRadio = normalizeGuardedBrowserToggleIntent({
    role: 'radio',
    name: 'Comfortable layout',
    desiredState: true,
  });
  assert(selectedRadio.ok, 'a clearly local layout radio is accepted when desiredState is true');

  for (const safePreferenceName of [
    'Remove animations',
    'Confirm before closing tabs',
  ]) {
    const safePreference = normalizeGuardedBrowserToggleIntent({
      role: 'switch',
      name: safePreferenceName,
      desiredState: true,
    });
    assert(
      safePreference.ok,
      `ordinary local preference remains available: ${safePreferenceName}`,
      safePreference,
    );
  }

  const rejectedInputs: Array<[string, unknown]> = [
    ['non-object input', null],
    ['missing desired state', { role: 'switch', name: 'Dark mode' }],
    ['non-boolean desired state', { role: 'switch', name: 'Dark mode', desiredState: 'true' }],
    ['unsupported pressed-button role', { role: 'button', name: 'Dark mode', desiredState: true }],
    ['broad role-only targeting', { role: 'checkbox', desiredState: true }],
    ['two competing locators', {
      role: 'checkbox',
      name: 'Dark mode',
      selector: '#dark-mode',
      desiredState: true,
    }],
    ['inexact name matching', {
      role: 'checkbox',
      name: 'Dark mode',
      desiredState: true,
      exact: false,
    }],
    ['direct radio clearing', { role: 'radio', name: 'Comfortable layout', desiredState: false }],
    ['submit authority', {
      role: 'checkbox',
      name: 'Dark mode',
      desiredState: true,
      submit: true,
    }],
    ['generic click authority', {
      role: 'checkbox',
      name: 'Dark mode',
      desiredState: true,
      clickCount: 2,
    }],
    ['navigation authority', {
      role: 'checkbox',
      name: 'Dark mode',
      desiredState: true,
      href: 'https://example.test/done',
    }],
    ['model-authored process identity', {
      role: 'checkbox',
      name: 'Dark mode',
      desiredState: true,
      browserProcessId: browserTarget.browserProcessId,
    }],
    ['model-authored page identity', {
      role: 'checkbox',
      name: 'Dark mode',
      desiredState: true,
      browserTabId: browserTarget.browserTabId,
    }],
    ['malformed timeout', {
      role: 'checkbox',
      name: 'Dark mode',
      desiredState: true,
      timeoutMs: Number.NaN,
    }],
    ['blank optional task context', {
      role: 'checkbox',
      name: 'Dark mode',
      desiredState: true,
      taskContext: '   ',
    }],
    ['credential semantics', {
      role: 'checkbox',
      name: 'Dark mode',
      desiredState: true,
      credentialSemantics: true,
    }],
    ['PIN credential target', { role: 'switch', name: 'Require PIN', desiredState: true }],
    ['email credential signal', { role: 'switch', name: 'Email notifications', desiredState: true }],
    ['login persistence', { role: 'checkbox', name: 'Remember me', desiredState: true }],
    ['MFA target', { role: 'switch', name: 'Require MFA', desiredState: true }],
    ['CAPTCHA target', { role: 'checkbox', name: 'I am not a robot', desiredState: true }],
    ['payment target', { role: 'checkbox', name: 'Confirm purchase', desiredState: true }],
    ['delete target', { role: 'checkbox', name: 'Delete my account', desiredState: true }],
    ['publish target', { role: 'switch', name: 'Publish automatically', desiredState: true }],
    ['release target', { role: 'switch', name: 'Release notes notifications', desiredState: true }],
    ['send target', { role: 'switch', name: 'Send diagnostics', desiredState: true }],
    ['auto-renew subscription target', {
      role: 'switch',
      name: 'Auto-renew subscription',
      desiredState: true,
    }],
    ['remote-access target', {
      role: 'switch',
      name: 'Enable remote access',
      desiredState: true,
    }],
    ['discoverable-profile target', {
      role: 'switch',
      name: 'Make profile discoverable',
      desiredState: true,
    }],
    ['analytics-sharing target', {
      role: 'switch',
      name: 'Share analytics',
      desiredState: true,
    }],
    ['camera-permission target', {
      role: 'switch',
      name: 'Allow camera access',
      desiredState: true,
    }],
    ['account-sync target', {
      role: 'switch',
      name: 'Sync account data',
      desiredState: true,
    }],
    ['unknown generic setting', {
      role: 'switch',
      name: 'Enable feature',
      desiredState: true,
    }],
    ['consequential consent target', {
      role: 'checkbox',
      name: 'Agree to terms and conditions',
      desiredState: true,
    }],
  ];
  for (const [label, input] of rejectedInputs) {
    const result = normalizeGuardedBrowserToggleIntent(input);
    assert(!result.ok, `normalizer rejects ${label}`, result);
  }
  const secretFieldName = 'sk-test-this-field-name-must-not-be-reflected';
  const rejectedSecretField = normalizeGuardedBrowserToggleIntent({
    role: 'switch',
    name: 'Dark mode',
    desiredState: true,
    [secretFieldName]: true,
  });
  assert(!rejectedSecretField.ok, 'unknown model fields are rejected');
  assert(
    !rejectedSecretField.ok && !rejectedSecretField.error.includes(secretFieldName),
    'unknown-field rejection does not reflect a potentially sensitive field name',
  );

  assert(normalizedByName.ok, 'named toggle remains narrowed for gateway tests');
  const modelArgs = normalizedByName.args;
  const modelArgKeys = Object.keys(modelArgs).sort();
  assert(
    JSON.stringify(modelArgKeys) === JSON.stringify([
      'credentialSemantics',
      'desiredState',
      'exact',
      'name',
      'role',
      'submit',
      'taskContext',
      'timeoutMs',
    ]),
    'normalized model args contain only the public toggle contract',
    modelArgKeys,
  );
  for (const hiddenIdentityField of [
    'browserProcessId',
    'browserSessionId',
    'browserTabId',
    'browserTargetFingerprint',
    'url',
    'observationEpochId',
  ]) {
    assert(
      !(hiddenIdentityField in modelArgs),
      `model args do not contain hidden ${hiddenIdentityField}`,
    );
  }

  const modelFingerprint = await buildComputerAppToolArgsFingerprintAsync(modelArgs);
  assert(
    /^args-v2:sha256:[a-f0-9]{64}$/.test(modelFingerprint),
    'normalized public intent has a cryptographic exact-argument fingerprint',
    modelFingerprint,
  );
  const dispatchArgs = buildRuntimeToggleDispatchArgs(modelArgs, 'toggle-capability-dispatch');
  const dispatchFingerprint = await buildComputerAppToolArgsFingerprintAsync(dispatchArgs);
  assert(
    /^args-v2:sha256:[a-f0-9]{64}$/.test(dispatchFingerprint)
      && dispatchFingerprint !== modelFingerprint,
    'runtime-enriched handler args receive a distinct cryptographic binding',
    dispatchFingerprint,
  );

  const dispatchEpoch = createToggleEpoch('toggle-dispatch-epoch');
  const dispatchAction = createToggleAction(
    'toggle-dispatch',
    dispatchEpoch,
    dispatchFingerprint,
  );
  const dispatchAuthorization = await authorizeToggle(dispatchAction, dispatchEpoch, 100);
  let dispatchHandlerCalls = 0;
  const dispatchResult = await dispatchAuthorizedComputerAppMutation({
    action: dispatchAction,
    authorization: dispatchAuthorization,
    normalizedArgs: dispatchArgs,
    handler: async (sealedArgs) => {
      dispatchHandlerCalls += 1;
      assert(Object.isFrozen(sealedArgs), 'handler receives deeply frozen canonical toggle args');
      assert(
        sealedArgs !== dispatchArgs,
        'handler receives a canonical clone, not the runtime-owned argument object',
      );
      assert(
        await buildComputerAppToolArgsFingerprintAsync(sealedArgs) === dispatchFingerprint,
        'handler receives exactly the fingerprint-bound runtime args',
        sealedArgs,
      );
      assert(
        sealedArgs.expectedBrowserProcessId === browserTarget.browserProcessId
          && sealedArgs.expectedBrowserContextId === browserTarget.browserSessionId
          && sealedArgs.expectedPageId === browserTarget.browserTabId
          && sealedArgs.expectedUrl === browserTarget.url
          && sealedArgs.targetFingerprint === browserTarget.browserTargetFingerprint,
        'runtime-owned bridge identity is sealed into handler args after model normalization',
        sealedArgs,
      );
      assert(
        !('role' in sealedArgs) && !('name' in sealedArgs) && !('selector' in sealedArgs),
        'model locator authority is replaced by the one-shot observed target capability',
      );
      return { desiredState: sealedArgs.desiredState };
    },
    now: now + 120,
  });
  assert(dispatchResult.ok, 'exact normalized toggle args enter the handler', dispatchResult);
  assert(dispatchHandlerCalls === 1, 'exact dispatch enters the handler once');
  assert(
    dispatchResult.ok && dispatchResult.value.desiredState === true,
    'the requested state reaches the handler without hidden identity entering model args',
  );

  const mismatchEpoch = createToggleEpoch('toggle-mismatch-epoch');
  const mismatchAction = createToggleAction(
    'toggle-mismatch',
    mismatchEpoch,
    dispatchFingerprint,
  );
  const mismatchAuthorization = await authorizeToggle(mismatchAction, mismatchEpoch, 200);
  let mismatchHandlerCalls = 0;
  await expectReject(
    () => dispatchAuthorizedComputerAppMutation({
      action: mismatchAction,
      authorization: mismatchAuthorization,
      normalizedArgs: {
        ...dispatchArgs,
        desiredState: false,
      },
      handler: async () => {
        mismatchHandlerCalls += 1;
        return 'must-not-run';
      },
      now: now + 220,
    }),
    /arguments do not match the authorized SHA-256 fingerprint/i,
    'post-authorization desired-state drift is rejected before handler entry',
  );
  assert(mismatchHandlerCalls === 0, 'argument drift never reaches the toggle handler');

  const identityMismatchEpoch = createToggleEpoch('toggle-identity-mismatch-epoch');
  const identityMismatchAction = createToggleAction(
    'toggle-identity-mismatch',
    identityMismatchEpoch,
    dispatchFingerprint,
  );
  const identityMismatchAuthorization = await authorizeToggle(
    identityMismatchAction,
    identityMismatchEpoch,
    240,
  );
  let identityMismatchHandlerCalls = 0;
  await expectReject(
    () => dispatchAuthorizedComputerAppMutation({
      action: identityMismatchAction,
      authorization: identityMismatchAuthorization,
      normalizedArgs: {
        ...dispatchArgs,
        expectedPageId: 'different-runtime-page',
      },
      handler: async () => {
        identityMismatchHandlerCalls += 1;
        return 'must-not-run';
      },
      now: now + 260,
    }),
    /arguments do not match the authorized SHA-256 fingerprint/i,
    'post-authorization hidden page-identity drift is rejected before handler entry',
  );
  assert(identityMismatchHandlerCalls === 0, 'hidden identity drift never reaches the handler');

  const sharedEpoch = createToggleEpoch('toggle-shared-epoch');
  assert(normalizedBySelector.ok, 'selector toggle remains narrowed for epoch tests');
  const sharedDispatchArgs = buildRuntimeToggleDispatchArgs(
    normalizedBySelector.args,
    'toggle-capability-shared',
  );
  const sharedFingerprint = await buildComputerAppToolArgsFingerprintAsync(
    sharedDispatchArgs,
  );
  const firstSharedAction = createToggleAction(
    'toggle-shared-first',
    sharedEpoch,
    sharedFingerprint,
  );
  const secondSharedAction = createToggleAction(
    'toggle-shared-second',
    sharedEpoch,
    sharedFingerprint,
  );
  const firstSharedAuthorization = await authorizeToggle(firstSharedAction, sharedEpoch, 300);
  const secondSharedAuthorization = await authorizeToggle(secondSharedAction, sharedEpoch, 310);
  let firstSharedHandlerCalls = 0;
  let secondSharedHandlerCalls = 0;
  const firstSharedDispatch = await dispatchAuthorizedComputerAppMutation({
    action: firstSharedAction,
    authorization: firstSharedAuthorization,
    normalizedArgs: sharedDispatchArgs,
    handler: async () => {
      firstSharedHandlerCalls += 1;
      return 'first-entered';
    },
    now: now + 330,
  });
  assert(firstSharedDispatch.ok, 'the first authorized sibling consumes the shared observation');
  await expectReject(
    () => dispatchAuthorizedComputerAppMutation({
      action: secondSharedAction,
      authorization: secondSharedAuthorization,
      normalizedArgs: sharedDispatchArgs,
      handler: async () => {
        secondSharedHandlerCalls += 1;
        return 'second-must-not-enter';
      },
      now: now + 340,
    }),
    /observation was invalidated before handler entry/i,
    'a second mutation cannot reuse pre-mutation browser state',
  );
  assert(firstSharedHandlerCalls === 1, 'the first shared-epoch handler ran once');
  assert(secondSharedHandlerCalls === 0, 'the stale sibling handler never ran');

  console.log(`browser-toggle-mutation-gateway-smoketest: ${assertions} assertions passed`);
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
