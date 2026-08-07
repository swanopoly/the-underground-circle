/**
 * Focused smoke for durable capability-buildout provider preservation.
 *
 * Run:
 *   npx tsx scripts/computer-task-state-provider-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import {
  compactComputerTaskCapabilityBuildout,
  normalizeComputerTaskCapabilityProvider,
} from '../src/lib/computerTaskStateModel';
import { compactExactPlanApprovalCorrelation } from '../src/lib/exactPlanApprovalContinuityCore';

const providers = ['codex', 'claude-code', 'gemini', 'cursor'] as const;
for (const provider of providers) {
  assert.equal(
    normalizeComputerTaskCapabilityProvider(provider),
    provider,
    `canonical ${provider} provider survives normalization`,
  );
  assert.equal(
    compactComputerTaskCapabilityBuildout({
      status: 'requested',
      message: 'Delegated buildout',
      provider,
      updatedAt: '2026-07-24T12:00:00.000Z',
    })?.provider,
    provider,
    `canonical ${provider} provider survives compaction`,
  );
}

assert.equal(
  normalizeComputerTaskCapabilityProvider('  CLAUDE-CODE  '),
  'claude-code',
  'benign casing and whitespace normalize to the canonical provider id',
);
for (const hostile of [
  'shell',
  'codex<script>',
  'x'.repeat(10_000),
  42,
  { toString: () => 'codex' },
  null,
]) {
  assert.equal(
    normalizeComputerTaskCapabilityProvider(hostile),
    null,
    'unknown, oversized, and non-string providers fail closed',
  );
}

const compacted = compactComputerTaskCapabilityBuildout({
  status: 'made_up',
  message: ` ${'m'.repeat(2_000)} `,
  provider: 'codex<script>',
  sourceRefs: ['valid-ref', { toString: () => 'smuggled-ref' }, 'r'.repeat(900)],
  unexpectedSecret: 'must not survive',
  updatedAt: '2026-07-24T12:00:00.000Z',
}) as Record<string, unknown> | null;

assert(compacted, 'object buildout compacts');
assert.equal(compacted.status, 'requested', 'unknown statuses fail closed to requested');
assert.equal(compacted.provider, null, 'hostile provider is removed');
assert.equal((compacted.message as string).length, 1_000, 'message is bounded');
assert.deepEqual(
  compacted.sourceRefs,
  ['valid-ref', 'r'.repeat(500)],
  'lists reject non-string objects and bound retained values',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(compacted, 'unexpectedSecret'),
  false,
  'unknown persisted properties are not copied',
);

const exactPhotoshopPlan = buildChatAutomationPlan({
  message: 'Open Photoshop and create a new document 600 x 600',
});
assert.equal(exactPhotoshopPlan.execution.kind, 'run_computer_task');
assert.equal(
  exactPhotoshopPlan.execution.routeId,
  null,
  'exact Photoshop programs persist route-less approval authority',
);
const exactPhotoshopApprovalActionType = `chat.${exactPhotoshopPlan.execution.kind}${
  exactPhotoshopPlan.execution.routeId ? `.${exactPhotoshopPlan.execution.routeId}` : ''
}`;
assert.equal(exactPhotoshopApprovalActionType, 'chat.run_computer_task');

const exactCorrelation = compactExactPlanApprovalCorrelation({
  schemaVersion: 1,
  approvalId: '44444444-4444-4444-8444-444444444444',
  circleId: '11111111-1111-4111-8111-111111111111',
  threadId: '33333333-3333-4333-8333-333333333333',
  userId: '22222222-2222-4222-8222-222222222222',
  sessionKey: 'chat::33333333-3333-4333-8333-333333333333',
  actionType: exactPhotoshopApprovalActionType,
  expiresAtMs: Date.parse('2026-08-06T16:15:00.000Z'),
  programId: 'photoshop_new_document',
  programFingerprint: `args-v2:sha256:${'a'.repeat(64)}`,
  requestIdentity: 'user-1720000000000-exact-a',
  requestIdentityFingerprint: `args-v2:sha256:${'b'.repeat(64)}`,
  approvalIntentFingerprint: `args-v2:sha256:${'c'.repeat(64)}`,
  credential: 'must not survive',
});
assert(exactCorrelation, 'complete exact approval correlation survives compaction');
assert.equal(
  exactCorrelation.actionType,
  'chat.run_computer_task',
  'persisted exact approval correlation retains the production route-less action type',
);
assert.equal(
  Object.prototype.hasOwnProperty.call(exactCorrelation, 'credential'),
  false,
  'exact approval persistence drops credential-like and unknown fields',
);
assert.equal(
  compactExactPlanApprovalCorrelation({ ...exactCorrelation, schemaVersion: 0 }),
  null,
  'legacy exact approval state fails closed',
);

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const stateSource = readFileSync(`${repoRoot}/src/lib/computerTaskState.ts`, 'utf8');
assert.match(
  stateSource,
  /capabilityBuildout: compactComputerTaskCapabilityBuildout\(parsed\.capabilityBuildout\)/,
  'hydration runs stored buildout state through the canonical compactor',
);
assert.match(
  stateSource,
  /capabilityBuildout: compactComputerTaskCapabilityBuildout\(record\.capabilityBuildout\)/,
  'persistence runs live buildout state through the canonical compactor',
);
assert.match(
  stateSource,
  /requestIdentity: typeof parsed\.requestIdentity === 'string'[\s\S]*?parsed\.requestIdentity\.trim\(\)\.length <= 240[\s\S]*?!\/\[\\u0000-\\u001f\\u007f\]\/[.]test\(parsed\.requestIdentity\)[\s\S]*?parsed\.requestIdentity\.trim\(\)[\s\S]*?: null/,
  'hydration only admits a bounded, non-control originating request identity',
);
assert.match(
  stateSource,
  /if \(requestIdentity === undefined\) \{\s*requestIdentity = sameTask \? previous\?\.requestIdentity \|\| null : null;\s*\}/,
  'phase rewrites preserve request identity only for the same durable task',
);
assert.match(
  stateSource,
  /const boundedRequestIdentity = typeof requestIdentity === 'string'[\s\S]*?requestIdentity: boundedRequestIdentity,/,
  'persistence revalidates request identity before writing it',
);
assert.match(
  stateSource,
  /exactPlanApproval: compactExactPlanApprovalCorrelation\(parsed\.exactPlanApproval\)/,
  'hydration admits only the canonical bounded exact approval correlation',
);
assert.match(
  stateSource,
  /record\.circleId === circleId && record\.threadId === \(threadId \|\| null\)/,
  'task-state hydration rejects a record copied across circle or thread scope',
);
assert.match(
  stateSource,
  /exactPlanApproval: compactExactPlanApprovalCorrelation\(record\.exactPlanApproval\)/,
  'persistence strips unknown exact approval fields before storage',
);

console.log('computer task state provider smoke passed');
