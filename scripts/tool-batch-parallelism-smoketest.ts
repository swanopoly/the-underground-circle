/**
 * tool-batch-parallelism-smoketest
 *
 * Verifies the conservative rule that lets the tool loop dispatch a round
 * concurrently: only an all-read-only/auto round with no approval gate and >1
 * tool. Any mutation, external side effect, approval, or gate forces sequential
 * (so observe→act→verify ordering is never reordered).
 *
 * Run: npm run smoke:tool-batch-parallelism
 */

import assert from 'node:assert/strict';

import {
  isParallelSafeToolPolicy,
  canParallelizeToolBatch,
} from '../src/lib/toolBatchParallelism';

const READ = { mutatesState: false, externalSideEffect: false, approvalMode: 'auto' };
const MUTATE = { mutatesState: true, externalSideEffect: false, approvalMode: 'auto' };
const SIDE = { mutatesState: false, externalSideEffect: true, approvalMode: 'auto' };
const ASK = { mutatesState: false, externalSideEffect: false, approvalMode: 'ask' };

// ── isParallelSafeToolPolicy ───────────────────────────────────────────────
assert.equal(isParallelSafeToolPolicy(READ), true, 'pure read/observe is parallel-safe');
assert.equal(isParallelSafeToolPolicy(MUTATE), false, 'state mutation is not parallel-safe');
assert.equal(isParallelSafeToolPolicy(SIDE), false, 'external side effect is not parallel-safe');
assert.equal(isParallelSafeToolPolicy(ASK), false, 'approval-required is not parallel-safe');
assert.equal(isParallelSafeToolPolicy(null), false, 'unknown policy is not parallel-safe');
assert.equal(isParallelSafeToolPolicy(undefined), false);

// ── canParallelizeToolBatch ────────────────────────────────────────────────
assert.equal(canParallelizeToolBatch([READ, READ, READ]), true, 'all-read multi-tool round parallelizes');
assert.equal(canParallelizeToolBatch([READ, READ], { hasApprovalGate: false }), true);
assert.equal(canParallelizeToolBatch([READ, READ], { hasApprovalGate: true }), false, 'approval gate forces sequential');
assert.equal(canParallelizeToolBatch([READ]), false, 'single tool: nothing to parallelize');
assert.equal(canParallelizeToolBatch([]), false, 'empty round');
assert.equal(canParallelizeToolBatch([READ, MUTATE]), false, 'a mutation forces the whole round sequential');
assert.equal(canParallelizeToolBatch([READ, SIDE]), false, 'a side effect forces sequential');
assert.equal(canParallelizeToolBatch([READ, ASK]), false, 'an approval tool forces sequential');
assert.equal(canParallelizeToolBatch([READ, null]), false, 'an unknown-policy tool forces sequential');

console.log('All tool batch parallelism smoke cases passed.');
