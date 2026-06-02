/**
 * openswan-runtime-approval-smoketest
 *
 * Locks approval matching for privileged OpenSwan runtime tools. A completed
 * approval must unblock the exact same tool+args call, while rejected or
 * unrelated approvals must fail closed or request a fresh approval.
 *
 * Run: npm run smoke:openswan-runtime-approval
 */

import {
  buildOpenSwanToolApprovalKey,
  resolveOpenSwanRuntimeApprovalDecision,
  stableApprovalJson,
} from '../src/lib/openswanToolApprovals';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function assert(condition: unknown, message: string, detail?: string) {
  if (condition) pass(message);
  else fail(`${message}${detail ? ` - ${detail}` : ''}`);
}

const tool = 'desktop.click_element';
const args = { appName: 'Safari', targetLabel: 'Send', meta: { retries: 1, safe: true } };
const reorderedArgs = { targetLabel: 'Send', meta: { safe: true, retries: 1 }, appName: 'Safari' };
const otherArgs = { appName: 'Safari', targetLabel: 'Delete', meta: { retries: 1, safe: true } };
const key = buildOpenSwanToolApprovalKey(tool, args);

assert(
  stableApprovalJson({ b: 2, a: { d: 4, c: 3 } }) === stableApprovalJson({ a: { c: 3, d: 4 }, b: 2 }),
  'stableApprovalJson sorts nested object keys',
);
assert(
  key === buildOpenSwanToolApprovalKey(tool, reorderedArgs),
  'tool approval key is stable across argument key order',
);

const pending = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'p12345678', status: 'pending', payload: { toolApprovalKey: key } }],
});
assert(pending.kind === 'defer', 'pending exact approval defers execution');

const approved = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'a12345678', status: 'approved', payload: { toolApprovalKey: key } }],
});
assert(approved.kind === 'pass', 'approved exact approval passes execution');

const autoApproved = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'aa123456', status: 'auto_approved', payload: { toolApprovalKey: key } }],
});
assert(autoApproved.kind === 'pass', 'auto-approved exact approval passes execution');

const rejected = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'r12345678', status: 'rejected', payload: { toolApprovalKey: key } }],
});
assert(rejected.kind === 'block', 'rejected exact approval blocks execution');

const expired = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'e12345678', status: 'expired', payload: { toolApprovalKey: key } }],
});
assert(expired.kind === 'new', 'expired approval does not pass or block execution');

const legacyPending = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'oldpending', status: 'pending', payload: {} }],
});
assert(legacyPending.kind === 'defer', 'legacy pending approval payload still defers duplicate requests');

const legacyApprovedWithoutPayload = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'oldapproved', status: 'approved', payload: {} }],
});
assert(legacyApprovedWithoutPayload.kind === 'new', 'legacy approved payload without exact args does not pass execution');

const wrongToolArgs = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'wrong', status: 'approved', payload: { toolApprovalKey: buildOpenSwanToolApprovalKey(tool, otherArgs) } }],
});
assert(wrongToolArgs.kind === 'new', 'approved approval for different args does not pass execution');

const legacyExact = resolveOpenSwanRuntimeApprovalDecision({
  tool,
  args,
  rows: [{ id: 'legacy-exact', status: 'approved', payload: { tool, args: reorderedArgs } }],
});
assert(legacyExact.kind === 'pass', 'legacy exact tool and args payload passes execution');

if (failures > 0) {
  console.error(`\n${failures} OpenSwan runtime approval smoke-test failure(s)`);
  process.exit(1);
}

console.log('\nAll OpenSwan runtime approval smoke cases passed.');
