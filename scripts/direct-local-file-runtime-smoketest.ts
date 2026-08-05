import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildDirectLocalFileMutationRuntimeHandoff,
  buildDirectOpenPathRuntimeHandoff,
  DIRECT_LOCAL_FILE_MUTATION_REQUIRED_CONTEXT,
  executeDirectLocalFileRequest,
  planDirectLocalFileRequest,
  routeHasDirectLocalFileActionItems,
  type DirectLocalFileMode,
} from '../src/lib/directLocalFileRuntime';

const mutationCases: Array<{
  mode: DirectLocalFileMode;
  tool:
    | 'desktop.file_rename'
    | 'desktop.file_copy'
    | 'desktop.file_trash'
    | 'desktop.file_mkdir'
    | 'desktop.file_write_text'
    | 'desktop.open_path';
  task: string;
  privateValues: string[];
}> = [
  {
    mode: 'rename',
    tool: 'desktop.file_rename',
    task: 'rename UC_PRIVATE_RENAME_9217.png on my desktop to hidden-output.png',
    privateValues: ['UC_PRIVATE_RENAME_9217.png', 'hidden-output.png'],
  },
  {
    mode: 'copy',
    tool: 'desktop.file_copy',
    task: 'copy UC_PRIVATE_COPY_9217.pdf on my desktop to private-copy.pdf',
    privateValues: ['UC_PRIVATE_COPY_9217.pdf', 'private-copy.pdf'],
  },
  {
    mode: 'trash',
    tool: 'desktop.file_trash',
    task: 'move UC_PRIVATE_TRASH_9217.txt on my desktop to trash',
    privateValues: ['UC_PRIVATE_TRASH_9217.txt'],
  },
  {
    mode: 'mkdir',
    tool: 'desktop.file_mkdir',
    task: 'create a folder on my desktop called UC_PRIVATE_FOLDER_9217',
    privateValues: ['UC_PRIVATE_FOLDER_9217'],
  },
  {
    mode: 'write_text',
    tool: 'desktop.file_write_text',
    task: 'write a text file on my desktop called UC_PRIVATE_SECRET_9217.txt with password swordfish-9217',
    privateValues: ['UC_PRIVATE_SECRET_9217.txt', 'swordfish-9217'],
  },
  {
    mode: 'open_path',
    tool: 'desktop.open_path',
    task: 'open ~/Downloads/UC_PRIVATE_OPEN_9217.pdf in Preview',
    privateValues: ['UC_PRIVATE_OPEN_9217.pdf', 'Preview'],
  },
];

async function main() {
  let executorCalls = 0;
  for (const testCase of mutationCases) {
    const plan = planDirectLocalFileRequest(testCase.task);
    assert.equal(plan.mode, testCase.mode, `${testCase.mode}: parser selects the mutation mode`);

    const outcome = await executeDirectLocalFileRequest(
      testCase.task,
      async () => {
        executorCalls += 1;
        throw new Error(`${testCase.mode}: direct executor must never run`);
      },
    );

    assert.equal(outcome.handled, true, `${testCase.mode}: mutation is consumed by the handoff`);
    assert.equal(outcome.status, 'handoff', `${testCase.mode}: no completion is claimed`);
    assert.match(outcome.message, /not executed directly|authenticated OpenSwan typed runtime/i);
    assert.equal(outcome.data?.mode, testCase.mode, `${testCase.mode}: only the non-secret mode is retained`);
    assert.equal('plan' in (outcome.data || {}), false, `${testCase.mode}: parsed plan is not returned`);
    assert.equal('result' in (outcome.data || {}), false, `${testCase.mode}: no adapter result is returned`);
    assert.equal('proofSignals' in (outcome.data || {}), false, `${testCase.mode}: no proof is fabricated`);

    const handoff = outcome.data?.runtimeHandoff;
    assert(handoff, `${testCase.mode}: structured typed-runtime handoff is present`);
    assert.equal(handoff.tool, testCase.tool, `${testCase.mode}: handoff names the typed tool`);
    assert.equal(handoff.executable, false);
    assert.equal(handoff.adapterCalled, false);
    assert.equal(handoff.mutationDispatched, false);
    assert.equal(handoff.completionClaimed, false);
    for (const falseField of [
      'carriesRawPath',
      'carriesRawApp',
      'carriesRawValue',
      'carriesSecret',
      'carriesIdentity',
      'carriesApproval',
      'carriesReceipt',
      'carriesProof',
    ] as const) {
      assert.equal(handoff[falseField], false, `${testCase.mode}: ${falseField} remains false`);
    }
    assert.deepEqual(
      handoff.requiredContext,
      [...DIRECT_LOCAL_FILE_MUTATION_REQUIRED_CONTEXT],
      `${testCase.mode}: exact sealed context is required`,
    );

    const serialized = JSON.stringify(outcome);
    for (const privateValue of testCase.privateValues) {
      assert.equal(
        serialized.includes(privateValue),
        false,
        `${testCase.mode}: returned metadata omits ${privateValue}`,
      );
    }
  }

  assert.equal(executorCalls, 0, 'all direct local-file executor call counts stay at zero');
  assert.deepEqual(
    buildDirectOpenPathRuntimeHandoff(),
    buildDirectLocalFileMutationRuntimeHandoff('open_path'),
    'open-path compatibility builder uses the same sealed handoff',
  );

  const notMutation = await executeDirectLocalFileRequest(
    'Search files in Downloads for invoice',
    async () => {
      executorCalls += 1;
      throw new Error('non-mutation classifier must not run an executor');
    },
  );
  assert.equal(notMutation.handled, false, 'read-only search is not consumed by the legacy direct mutation lane');
  assert.equal(notMutation.status, 'failed');
  assert.equal(notMutation.data, undefined, 'unhandled input is not copied into metadata');
  assert.equal(executorCalls, 0);

  assert.equal(routeHasDirectLocalFileActionItems({
    kind: 'local_file',
    sourceMessage: mutationCases[0].task,
    actionItems: [{ id: 'rename', surface: 'local_file', tool: 'desktop.file_rename', label: 'Rename', proof: 'Path' }],
  }), true, 'route helper still classifies a typed local-file mutation');
  assert.equal(routeHasDirectLocalFileActionItems({
    kind: 'local_file',
    sourceMessage: 'Search files in Downloads for invoice',
    actionItems: [{ id: 'search', surface: 'local_file', tool: 'desktop.file_search', label: 'Search', proof: 'Matches' }],
  }), false, 'route helper leaves read-only observations out of the mutation lane');

  const runtimeSource = readFileSync(
    new URL('../src/lib/directLocalFileRuntime.ts', import.meta.url),
    'utf8',
  );
  for (const forbiddenSource of [
    "import('./computerFileAdapter')",
    'executeDesktopBridgeFileTask(',
    'await executor(',
    "status: 'completed'",
    'proofSignals:',
  ]) {
    assert.equal(
      runtimeSource.includes(forbiddenSource),
      false,
      `runtime source omits direct-execution primitive ${forbiddenSource}`,
    );
  }
  assert.match(
    runtimeSource,
    /void executor;[\s\S]*status: 'handoff'/,
    'legacy injection seam is inert before the structured handoff returns',
  );

  console.log('All direct local file runtime smoke cases passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
