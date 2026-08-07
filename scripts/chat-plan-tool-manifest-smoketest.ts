/** Adversarial smoke for the inert Chat plan -> exact tool manifest contract. */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  CHAT_PLAN_TOOL_ACTION_MANIFEST_MAX_ACTIONS,
  buildChatPlanToolActionManifestV1,
  fingerprintChatPlanToolActionManifestV1,
  resolveOpenSwanPlanManifestCoverage,
  validateChatPlanToolActionManifestV1,
  type ChatPlanToolActionManifestInputV1,
  type ChatPlanToolActionManifestV1,
  type ChatPlanToolPolicySensitivityInputV1,
  type OpenSwanPlanManifestHardFloor,
} from '../src/lib/openswanToolApprovals';

if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

const ROOT_RUN_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ROOT_RUN_ID = '22222222-2222-4222-8222-222222222222';
const REQUEST_FINGERPRINT = `args-v2:sha256:${'a'.repeat(64)}`;
const OTHER_REQUEST_FINGERPRINT = `args-v2:sha256:${'b'.repeat(64)}`;
const RAW_SECRET = 'synthetic-secret-value-must-never-be-persisted';
const RAW_CREDENTIAL = 'correct-horse-battery-staple';

function policy(
  overrides: Partial<ChatPlanToolPolicySensitivityInputV1> = {},
): ChatPlanToolPolicySensitivityInputV1 {
  return {
    policyFamily: 'desktop',
    approvalMode: 'ask',
    mutatesState: true,
    externalSideEffect: false,
    mutationClassification: 'classified_mutation',
    floorCategory: null,
    policyRevision: 1,
    ...overrides,
  };
}

function action(
  actionIndex: number,
  actionId: string,
  overrides: Partial<ChatPlanToolActionManifestInputV1> = {},
): ChatPlanToolActionManifestInputV1 {
  return {
    actionIndex,
    actionId,
    toolName: 'desktop.semantic_action',
    args: { appName: 'Notes', target: `row-${actionIndex}` },
    policySensitivity: policy(),
    ...overrides,
  };
}

async function build(
  orderedActions: readonly ChatPlanToolActionManifestInputV1[],
  overrides: Partial<{
    rootRunId: string;
    requestIdentityFingerprint: string;
  }> = {},
) {
  return buildChatPlanToolActionManifestV1({
    rootRunId: ROOT_RUN_ID,
    requestIdentityFingerprint: REQUEST_FINGERPRINT,
    orderedActions,
    ...overrides,
  });
}

async function main() {
  const orderedActions = [
    action(0, 'observe.notes', {
      toolName: 'desktop.a11y_tree',
      args: { appName: 'Notes', includeValues: false },
      policySensitivity: policy({
        approvalMode: 'auto',
        mutatesState: false,
        mutationClassification: 'read_only',
      }),
    }),
    action(1, 'edit.notes', {
      args: { appName: 'Notes', value: RAW_SECRET, nested: { credential: RAW_CREDENTIAL } },
      policySensitivity: policy({ internalSensitivityMarker: RAW_CREDENTIAL }),
    }),
    action(2, 'send.notes', {
      toolName: 'messaging.send',
      args: { channel: 'team', body: RAW_SECRET },
      policySensitivity: policy({
        policyFamily: 'messaging',
        externalSideEffect: true,
        floorCategory: 'send',
      }),
    }),
    action(3, 'edit.after.send'),
  ];

  const manifest = await build(orderedActions);
  assert(manifest, 'valid ordered action manifest builds');
  assert.equal(manifest.orderedActions.length, 4);
  assert.deepEqual(
    manifest.orderedActions.map((entry) => entry.coverage),
    ['plan_covered', 'plan_covered', 'final_confirmation', 'final_confirmation'],
    'coverage is a prefix and no plan-covered action appears after a floor',
  );
  assert.match(manifest.manifestFingerprint, /^chat-plan-tools-v1:sha256:[0-9a-f]{64}$/);
  assert(Object.isFrozen(manifest), 'manifest envelope is immutable');
  assert(Object.isFrozen(manifest.orderedActions), 'ordered action list is immutable');
  assert(manifest.orderedActions.every(Object.isFrozen), 'persisted entries are immutable');

  const serialized = JSON.stringify(manifest);
  assert(!serialized.includes(RAW_SECRET), 'raw tool argument values are absent from persistence');
  assert(!serialized.includes(RAW_CREDENTIAL), 'raw credential and policy values are absent from persistence');
  assert(!serialized.includes('args"'), 'raw args field is absent from persisted entries');
  assert(!serialized.includes('policySensitivity'), 'raw policy object is absent from persisted entries');
  assert(!serialized.includes('authority'), 'manifest contains no runtime authority value');
  assert.deepEqual(
    Object.keys(manifest.orderedActions[0]).sort(),
    [
      'actionId',
      'actionIndex',
      'coverage',
      'policyBindingDigest',
      'toolApprovalDigest',
      'toolName',
    ],
    'persisted entries expose only bounded structural fields and digests',
  );

  const validatedRoundTrip = await validateChatPlanToolActionManifestV1(JSON.parse(serialized));
  assert(validatedRoundTrip, 'serialized manifest round trip validates as inert metadata');
  assert.equal(validatedRoundTrip.manifestFingerprint, manifest.manifestFingerprint);
  assert(Object.isFrozen(validatedRoundTrip), 'validator returns an immutable data copy');

  const reversed = await build([
    action(0, 'edit.after.send'),
    action(1, 'send.notes', {
      toolName: 'messaging.send',
      args: { channel: 'team', body: RAW_SECRET },
      policySensitivity: policy({
        policyFamily: 'messaging',
        externalSideEffect: true,
        floorCategory: 'send',
      }),
    }),
    action(2, 'edit.notes', {
      args: { appName: 'Notes', value: RAW_SECRET, nested: { credential: RAW_CREDENTIAL } },
      policySensitivity: policy({ internalSensitivityMarker: RAW_CREDENTIAL }),
    }),
    action(3, 'observe.notes', {
      toolName: 'desktop.a11y_tree',
      args: { appName: 'Notes', includeValues: false },
      policySensitivity: policy({
        approvalMode: 'auto',
        mutatesState: false,
        mutationClassification: 'read_only',
      }),
    }),
  ]);
  assert(reversed && reversed.manifestFingerprint !== manifest.manifestFingerprint,
    'action ordering changes the manifest fingerprint');

  const argsDrift = await build(orderedActions.map((entry, index) => index === 1
    ? { ...entry, args: { ...entry.args, target: 'different-target' } }
    : entry));
  const toolDrift = await build(orderedActions.map((entry, index) => index === 1
    ? { ...entry, toolName: 'desktop.set_value' }
    : entry));
  const policyDrift = await build(orderedActions.map((entry, index) => index === 1
    ? { ...entry, policySensitivity: policy({ policyRevision: 2 }) }
    : entry));
  const rootDrift = await build(orderedActions, { rootRunId: OTHER_ROOT_RUN_ID });
  const requestDrift = await build(orderedActions, {
    requestIdentityFingerprint: OTHER_REQUEST_FINGERPRINT,
  });
  for (const [label, drifted] of [
    ['args', argsDrift],
    ['tool', toolDrift],
    ['policy sensitivity', policyDrift],
    ['root run', rootDrift],
    ['request identity', requestDrift],
  ] as const) {
    assert(drifted, `${label} drift case builds`);
    assert.notEqual(
      drifted.manifestFingerprint,
      manifest.manifestFingerprint,
      `${label} drift changes the exact manifest fingerprint`,
    );
  }

  const staleFingerprintCopy = JSON.parse(serialized) as ChatPlanToolActionManifestV1;
  (staleFingerprintCopy as { rootRunId: string }).rootRunId = OTHER_ROOT_RUN_ID;
  assert.equal(
    await validateChatPlanToolActionManifestV1(staleFingerprintCopy),
    null,
    'root drift with a stale fingerprint is rejected',
  );

  assert.equal(
    await build([action(0, 'duplicate'), action(1, 'duplicate')]),
    null,
    'duplicate action ids fail closed',
  );
  assert.equal(
    await build([action(0, 'first'), action(0, 'second')]),
    null,
    'duplicate/non-contiguous action indices fail closed',
  );
  assert.equal(
    await build([action(1, 'wrong-first-index')]),
    null,
    'ordering is bound to exact zero-based positions',
  );

  const cyclicArgs: Record<string, unknown> = { label: 'cycle' };
  cyclicArgs.self = cyclicArgs;
  assert.equal(
    await build([action(0, 'cyclic.args', { args: cyclicArgs })]),
    null,
    'cyclic arguments fail closed before digest construction',
  );
  const cyclicPolicy = policy();
  cyclicPolicy.self = cyclicPolicy;
  assert.equal(
    await build([action(0, 'cyclic.policy', { policySensitivity: cyclicPolicy })]),
    null,
    'cyclic policy sensitivity fails closed',
  );
  assert.equal(
    await build([action(0, 'non.json', { args: { callback: () => undefined } })]),
    null,
    'non-JSON argument values fail closed',
  );

  const maxActions = Array.from(
    { length: CHAT_PLAN_TOOL_ACTION_MANIFEST_MAX_ACTIONS },
    (_unused, index) => action(index, `bounded.${index}`),
  );
  assert(await build(maxActions), 'the exact 32-action bound is accepted');
  assert.equal(
    await build([...maxActions, action(CHAT_PLAN_TOOL_ACTION_MANIFEST_MAX_ACTIONS, 'too.many')]),
    null,
    'a 33rd action is rejected',
  );
  assert.equal(await build([]), null, 'empty tool-action manifests are rejected');

  const floors: OpenSwanPlanManifestHardFloor[] = [
    'credential',
    'login',
    'payment',
    'purchase',
    'checkout',
    'publish',
    'send',
    'post',
    'external_communication',
    'delete',
    'trash',
    'overwrite',
    'destructive',
    'permission',
    'security',
    'unknown',
  ];
  for (const floorCategory of floors) {
    assert.equal(
      resolveOpenSwanPlanManifestCoverage(policy({ floorCategory })),
      'final_confirmation',
      `${floorCategory} remains a final-confirmation floor`,
    );
  }
  assert.equal(
    resolveOpenSwanPlanManifestCoverage(policy({ externalSideEffect: true })),
    'final_confirmation',
    'external side effects initially require final confirmation',
  );
  assert.equal(
    resolveOpenSwanPlanManifestCoverage(policy({ mutationClassification: 'unknown' })),
    'final_confirmation',
    'unknown mutation classification fails closed',
  );
  assert.equal(
    resolveOpenSwanPlanManifestCoverage({
      policyFamily: 'desktop',
      approvalMode: 'ask',
      mutatesState: true,
      externalSideEffect: false,
      floorCategory: null,
    }),
    'final_confirmation',
    'unclassified mutation fails closed',
  );
  assert.equal(
    resolveOpenSwanPlanManifestCoverage(policy({ floorCategory: 'new_unreviewed_floor' as never })),
    'final_confirmation',
    'unrecognized floor labels are treated as unknown',
  );
  assert.equal(
    resolveOpenSwanPlanManifestCoverage(policy()),
    'plan_covered',
    'a classified internal non-floor mutation may be covered by the exact plan',
  );

  const maliciousGapEnvelope = {
    schemaVersion: 1 as const,
    rootRunId: manifest.rootRunId,
    requestIdentityFingerprint: manifest.requestIdentityFingerprint,
    orderedActions: manifest.orderedActions.map((entry, index) => ({
      ...entry,
      coverage: index === 3 ? 'plan_covered' as const : entry.coverage,
    })),
  };
  const maliciousGap: ChatPlanToolActionManifestV1 = {
    ...maliciousGapEnvelope,
    manifestFingerprint: await fingerprintChatPlanToolActionManifestV1(maliciousGapEnvelope),
  };
  assert.equal(
    await validateChatPlanToolActionManifestV1(maliciousGap),
    null,
    'even a self-consistent digest cannot put plan coverage after a confirmation floor',
  );

  const duplicateIndexEnvelope = {
    schemaVersion: 1 as const,
    rootRunId: manifest.rootRunId,
    requestIdentityFingerprint: manifest.requestIdentityFingerprint,
    orderedActions: manifest.orderedActions.map((entry, index) => ({
      ...entry,
      actionIndex: index === 1 ? 0 : entry.actionIndex,
    })),
  };
  assert.equal(
    await validateChatPlanToolActionManifestV1({
      ...duplicateIndexEnvelope,
      manifestFingerprint: await fingerprintChatPlanToolActionManifestV1(duplicateIndexEnvelope),
    }),
    null,
    'validator rejects duplicate indices even with a recomputed public digest',
  );

  const rawArgsInjection = JSON.parse(serialized) as Record<string, unknown>;
  const injectedActions = rawArgsInjection.orderedActions as Array<Record<string, unknown>>;
  injectedActions[0].args = { password: RAW_CREDENTIAL };
  assert.equal(
    await validateChatPlanToolActionManifestV1(rawArgsInjection),
    null,
    'validator rejects raw-value fields outside the persisted entry allowlist',
  );

  console.log('chat plan tool manifest smoke passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
