/**
 * tool-batch-parallelism-smoketest
 *
 * Verifies the rules that let the tool loop dispatch a round concurrently:
 *  - legacy rule: an all-read-only/auto round with no approval gate and >1
 *    tool parallelizes; any unknown-footprint mutation, external side effect,
 *    approval, or gate forces sequential.
 *  - dependency-metadata rule (T8/O6): mutating tools that declare disjoint
 *    `mutationTargets` (and no read-vs-write conflicts via `readsFrom`) may
 *    parallelize; overlapping writes, read/write conflicts, missing metadata,
 *    'ask' approval, and external side effects stay sequential.
 *  - real-catalog policies: `getOpenSwanToolParallelPolicy` returns the coarse
 *    dependency domains for representative tools, and the bridge's
 *    `createOpenSwanToolParallelPolicyProvider` is fail-closed. The runtime
 *    transitively imports react-native, so (like the progressive-disclosure
 *    smoke) we stub it via `node:module.registerHooks` + inert supabase env
 *    and dynamically import the REAL catalog.
 *
 * Run: npm run smoke:tool-batch-parallelism
 */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Inert supabase env BEFORE any app module loads (the singleton client is
// created at import time). Never points at a real project.
process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://tool-batch-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'tool-batch-smoke-anon-key';

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

import {
  isParallelSafeToolPolicy,
  isParallelEligibleToolPolicy,
  toolPoliciesAreIndependent,
  canParallelizeToolBatch,
  partitionParallelSafeBatch,
} from '../src/lib/toolBatchParallelism';

const READ = { mutatesState: false, externalSideEffect: false, approvalMode: 'auto' };
const MUTATE = { mutatesState: true, externalSideEffect: false, approvalMode: 'auto' };
const SIDE = { mutatesState: false, externalSideEffect: true, approvalMode: 'auto' };
const ASK = { mutatesState: false, externalSideEffect: false, approvalMode: 'ask' };

// Dependency-metadata policies.
const WRITE_FS = { mutatesState: true, externalSideEffect: false, approvalMode: 'auto', mutationTargets: ['filesystem'] };
const WRITE_FS_2 = { mutatesState: true, externalSideEffect: false, approvalMode: 'auto', mutationTargets: ['filesystem'] };
const WRITE_CLIPBOARD = { mutatesState: true, externalSideEffect: false, approvalMode: 'auto', mutationTargets: ['clipboard'] };
const WRITE_TASKS = { mutatesState: true, externalSideEffect: false, approvalMode: 'auto', mutationTargets: ['circle_tasks'] };
const READ_FS = { mutatesState: false, externalSideEffect: false, approvalMode: 'auto', readsFrom: ['filesystem'] };
const READ_BROWSER = { mutatesState: false, externalSideEffect: false, approvalMode: 'auto', readsFrom: ['browser_page'] };
const WRITE_FS_READS_CLIP = { mutatesState: true, externalSideEffect: false, approvalMode: 'auto', mutationTargets: ['filesystem'], readsFrom: ['clipboard'] };
const ASK_WRITE_FS = { mutatesState: true, externalSideEffect: false, approvalMode: 'ask', mutationTargets: ['filesystem'] };
const SIDE_WRITE_FS = { mutatesState: true, externalSideEffect: true, approvalMode: 'auto', mutationTargets: ['filesystem'] };

// ── isParallelSafeToolPolicy (legacy read-only rule, unchanged) ────────────
assert.equal(isParallelSafeToolPolicy(READ), true, 'pure read/observe is parallel-safe');
assert.equal(isParallelSafeToolPolicy(MUTATE), false, 'state mutation is not parallel-safe');
assert.equal(isParallelSafeToolPolicy(SIDE), false, 'external side effect is not parallel-safe');
assert.equal(isParallelSafeToolPolicy(ASK), false, 'approval-required is not parallel-safe');
assert.equal(isParallelSafeToolPolicy(null), false, 'unknown policy is not parallel-safe');
assert.equal(isParallelSafeToolPolicy(undefined), false);

// ── isParallelEligibleToolPolicy ───────────────────────────────────────────
assert.equal(isParallelEligibleToolPolicy(READ), true, 'pure read is eligible');
assert.equal(isParallelEligibleToolPolicy(WRITE_FS), true, 'mutation with declared targets is eligible');
assert.equal(isParallelEligibleToolPolicy(MUTATE), false, 'mutation without mutationTargets is never eligible');
assert.equal(isParallelEligibleToolPolicy(ASK_WRITE_FS), false, "'ask' approval is never eligible even with targets");
assert.equal(isParallelEligibleToolPolicy(SIDE_WRITE_FS), false, 'external side effect is never eligible even with targets');
assert.equal(isParallelEligibleToolPolicy({ mutatesState: true, externalSideEffect: false, approvalMode: 'auto', mutationTargets: [] }), false, 'empty mutationTargets on a mutating tool is not eligible');
assert.equal(isParallelEligibleToolPolicy(null), false);

// ── toolPoliciesAreIndependent ─────────────────────────────────────────────
assert.equal(toolPoliciesAreIndependent(WRITE_FS, WRITE_CLIPBOARD), true, 'disjoint writes are independent');
assert.equal(toolPoliciesAreIndependent(WRITE_FS, WRITE_FS_2), false, 'overlapping writes conflict');
assert.equal(toolPoliciesAreIndependent(READ_FS, WRITE_FS), false, 'read-vs-write on the same domain conflicts');
assert.equal(toolPoliciesAreIndependent(READ_BROWSER, WRITE_FS), true, 'read of an untouched domain is independent of a writer');
assert.equal(toolPoliciesAreIndependent(READ, WRITE_FS), false, 'no-metadata read has unknown reads → conflicts with any writer');
assert.equal(toolPoliciesAreIndependent(READ, READ), true, 'two no-metadata reads are independent (no writers)');
assert.equal(toolPoliciesAreIndependent(WRITE_FS_READS_CLIP, WRITE_CLIPBOARD), false, 'one tool reads the domain the other writes');
assert.equal(toolPoliciesAreIndependent(WRITE_FS_READS_CLIP, WRITE_TASKS), true, 'fully disjoint reads and writes are independent');

// ── canParallelizeToolBatch: legacy behavior preserved ─────────────────────
assert.equal(canParallelizeToolBatch([READ, READ, READ]), true, 'all-read multi-tool round parallelizes');
assert.equal(canParallelizeToolBatch([READ, READ], { hasApprovalGate: false }), true);
assert.equal(canParallelizeToolBatch([READ, READ], { hasApprovalGate: true }), false, 'approval gate forces sequential');
assert.equal(canParallelizeToolBatch([READ]), false, 'single tool: nothing to parallelize');
assert.equal(canParallelizeToolBatch([]), false, 'empty round');
assert.equal(canParallelizeToolBatch([READ, MUTATE]), false, 'a metadata-less mutation forces the whole round sequential');
assert.equal(canParallelizeToolBatch([READ, SIDE]), false, 'a side effect forces sequential');
assert.equal(canParallelizeToolBatch([READ, ASK]), false, 'an approval tool forces sequential');
assert.equal(canParallelizeToolBatch([READ, null]), false, 'an unknown-policy tool forces sequential');

// ── canParallelizeToolBatch: dependency-metadata rule ──────────────────────
assert.equal(canParallelizeToolBatch([WRITE_FS, WRITE_CLIPBOARD]), true, 'disjoint writes parallelize');
assert.equal(canParallelizeToolBatch([WRITE_FS, WRITE_CLIPBOARD, WRITE_TASKS]), true, 'three pairwise-disjoint writers parallelize');
assert.equal(canParallelizeToolBatch([WRITE_FS, WRITE_FS_2]), false, 'overlapping writes do not parallelize');
assert.equal(canParallelizeToolBatch([READ_FS, WRITE_FS]), false, 'read-vs-write conflict does not parallelize');
assert.equal(canParallelizeToolBatch([WRITE_FS_READS_CLIP, WRITE_CLIPBOARD]), false, 'writer reading the other writer\'s target does not parallelize');
assert.equal(canParallelizeToolBatch([READ_BROWSER, WRITE_FS]), true, 'declared-read of a different domain parallelizes with a writer');
assert.equal(canParallelizeToolBatch([READ, WRITE_FS]), false, 'no-metadata read next to a writer stays sequential (unknown reads)');
assert.equal(canParallelizeToolBatch([MUTATE, WRITE_CLIPBOARD]), false, 'mutating tool with missing mutationTargets never parallelizes');
assert.equal(canParallelizeToolBatch([ASK_WRITE_FS, WRITE_CLIPBOARD]), false, "'ask' tool never parallelizes regardless of targets");
assert.equal(canParallelizeToolBatch([SIDE_WRITE_FS, WRITE_CLIPBOARD]), false, 'externalSideEffect tool never parallelizes regardless of targets');
assert.equal(canParallelizeToolBatch([WRITE_FS, WRITE_CLIPBOARD], { hasApprovalGate: true }), false, 'approval gate still forces sequential with metadata');

// ── partitionParallelSafeBatch ─────────────────────────────────────────────
assert.deepEqual(
  partitionParallelSafeBatch([READ, READ, READ]),
  [[0, 1, 2]],
  'all-read round forms one parallel group',
);
assert.deepEqual(
  partitionParallelSafeBatch([WRITE_FS, WRITE_CLIPBOARD, WRITE_FS_2]),
  [[0, 1], [2]],
  'greedy grouping stops at the first write conflict',
);
assert.deepEqual(
  partitionParallelSafeBatch([READ, READ, MUTATE, READ, READ]),
  [[0, 1], [2], [3, 4]],
  'a metadata-less mutation runs alone and splits the round',
);
assert.deepEqual(
  partitionParallelSafeBatch([WRITE_FS, READ_FS, WRITE_CLIPBOARD]),
  [[0], [1, 2]],
  'a read of a written domain starts a new group; later disjoint tools regroup',
);
assert.deepEqual(
  partitionParallelSafeBatch([READ, READ], { hasApprovalGate: true }),
  [[0], [1]],
  'approval gate makes every tool its own group',
);
assert.deepEqual(partitionParallelSafeBatch([]), [], 'empty round → no groups');
assert.deepEqual(partitionParallelSafeBatch([ASK]), [[0]], 'single ineligible tool is its own group');

// ── Real catalog: getOpenSwanToolParallelPolicy + bridge provider ──────────
async function checkRealCatalogPolicies() {
  const runtime = await import('../src/lib/openswanToolRuntime');
  const bridge = await import('../src/lib/openswanBridge');

  // In-app coordination write → coarse circle domain, auto-approved.
  const tasksCreate = runtime.getOpenSwanToolParallelPolicy('tasks.create');
  assert.deepEqual(tasksCreate.mutationTargets, ['circle_tasks'], 'tasks.create writes circle_tasks');
  assert.equal(tasksCreate.mutatesState, true, 'tasks.create mutates state');
  assert.equal(tasksCreate.approvalMode, 'auto', 'tasks.create is auto-approved');
  assert.equal(tasksCreate.externalSideEffect, false, 'tasks.create has no external side effect');

  // Desktop file write → desktop_files (still 'ask'-gated → never eligible).
  const fileWrite = runtime.getOpenSwanToolParallelPolicy('desktop.file_write_text');
  assert.deepEqual(fileWrite.mutationTargets, ['desktop_files'], 'desktop.file_write_text writes desktop_files');
  assert.equal(fileWrite.approvalMode, 'ask', 'desktop.file_write_text stays HITL-gated');
  assert.equal(isParallelEligibleToolPolicy(fileWrite), false, "'ask' desktop write is never parallel-eligible");

  // Bounded image conversion writes a new local image next to the source, but
  // avoids the generic Photoshop/Preview save dialog and is auto-approved.
  const convertImage = runtime.getOpenSwanToolParallelPolicy('desktop.convert_image');
  assert.deepEqual(convertImage.readsFrom, ['desktop_files'], 'desktop.convert_image reads desktop_files');
  assert.deepEqual(convertImage.mutationTargets, ['desktop_files'], 'desktop.convert_image writes desktop_files');
  assert.equal(convertImage.approvalMode, 'auto', 'desktop.convert_image is auto-approved');
  assert.equal(isParallelEligibleToolPolicy(convertImage), true, 'desktop.convert_image can run without the approval gate');

  // Browser mutation → browser_page.
  const click = runtime.getOpenSwanToolParallelPolicy('browser.click_role');
  assert.deepEqual(click.mutationTargets, ['browser_page'], 'browser.click_role writes browser_page');
  assert.equal(isParallelEligibleToolPolicy(click), false, 'browser mutation stays sequential (ask + side effect)');

  // Memory read → readsFrom only, no mutationTargets.
  const memSearch = runtime.getOpenSwanToolParallelPolicy('search_memories');
  assert.equal(memSearch.mutatesState, false, 'search_memories is a read');
  assert.equal(memSearch.mutationTargets, undefined, 'search_memories declares no mutationTargets');
  assert.deepEqual(memSearch.readsFrom, ['circle_memory'], 'search_memories reads circle_memory');

  // Other representative writers.
  assert.deepEqual(runtime.getOpenSwanToolParallelPolicy('save_memory').mutationTargets, ['circle_memory'], 'save_memory writes circle_memory');
  assert.deepEqual(runtime.getOpenSwanToolParallelPolicy('skills.manage').mutationTargets, ['circle_skills'], 'skills.manage writes circle_skills');
  assert.deepEqual(runtime.getOpenSwanToolParallelPolicy('messages.create').mutationTargets, ['circle_messages'], 'messages.create writes circle_messages');
  assert.deepEqual(runtime.getOpenSwanToolParallelPolicy('wp.create_slide').mutationTargets, ['wordpress'], 'wp.create_slide writes wordpress');
  assert.deepEqual(runtime.getOpenSwanToolParallelPolicy('wp.update_post').mutationTargets, ['wordpress'], 'wp.update_post writes wordpress');

  // A mutating tool with no domain entry stays a barrier (no targets).
  const checkIn = runtime.getOpenSwanToolParallelPolicy('check_ins.log');
  assert.equal(checkIn.mutationTargets, undefined, 'unmapped mutator declares no targets');
  assert.equal(isParallelEligibleToolPolicy(checkIn), false, 'unmapped mutator is never parallel-eligible');

  // End-to-end partition over real catalog policies: tasks.create +
  // goals.create are disjoint auto writers (one group); a second
  // circle_tasks write conflicts and runs after; the trailing tasks.list
  // read of circle_tasks stays behind the writers.
  const roundPolicies = [
    runtime.getOpenSwanToolParallelPolicy('tasks.create'),
    runtime.getOpenSwanToolParallelPolicy('goals.create'),
    runtime.getOpenSwanToolParallelPolicy('tasks.update_status'),
    runtime.getOpenSwanToolParallelPolicy('tasks.list'),
  ];
  assert.deepEqual(
    partitionParallelSafeBatch(roundPolicies),
    [[0, 1], [2], [3]],
    'real-catalog round partitions: disjoint writers group, conflicting write + dependent read barrier',
  );

  // Bridge provider — ready for runAgent({ toolParallelPolicyProvider }).
  const provider = bridge.createOpenSwanToolParallelPolicyProvider();
  assert.deepEqual(provider('tasks.create')?.mutationTargets, ['circle_tasks'], 'bridge provider mirrors the catalog policy');
  const unknown = provider('definitely.not_a_tool');
  assert.ok(unknown === null || isParallelEligibleToolPolicy(unknown) === false, 'bridge provider fails closed for unknown tools');
}

checkRealCatalogPolicies()
  .then(() => {
    console.log('All tool batch parallelism smoke cases passed (pure rules + real catalog policies).');
  })
  .catch((err) => {
    console.error('tool-batch-parallelism smoke crashed:', err);
    process.exit(1);
  });
