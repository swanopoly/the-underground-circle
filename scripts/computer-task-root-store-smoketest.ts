import assert from 'node:assert/strict';

import {
  admitComputerTaskRuntimeRoot,
  createComputerTaskRootStore,
  toComputerTaskRootPointer,
  transitionComputerTaskRuntimeRoot,
  validateComputerTaskRuntimeRootBinding,
  type ComputerTaskRootRpcClient,
} from '../src/lib/computerTaskRootStore';

const ROOT_ROW_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const CIRCLE_ID = '44444444-4444-4444-8444-444444444444';
const THREAD_ID = '55555555-5555-4555-8555-555555555555';
const SECRET_TASK = 'Open Photoshop and create 600 x 600 private-launch-token-123';

type RpcCall = { functionName: string; args: Record<string, unknown> };

async function main(): Promise<void> {
  const calls: RpcCall[] = [];
  let stored: Record<string, unknown> | null = null;
  let requestFingerprint: string | null = null;
  let rootFingerprint: string | null = null;
  let taskFingerprint: string | null = null;
  let mode: 'normal' | 'malformed' | 'rpc_error' = 'normal';

  const client: ComputerTaskRootRpcClient = {
    async rpc(functionName, args) {
      calls.push({ functionName, args });
      if (mode === 'rpc_error') return { data: null, error: { message: 'private db error' } };
      if (functionName === 'admit_computer_task_root_v1') {
        if (mode === 'malformed') return { data: { ok: true, privateExtra: 'bad' } };
        if (!stored) {
          stored = args.p_root_snapshot as Record<string, unknown>;
          requestFingerprint = String(args.p_request_identity_fingerprint);
          rootFingerprint = String(args.p_root_fingerprint);
          taskFingerprint = String(args.p_task_fingerprint);
          return {
            data: {
              schemaVersion: 1,
              ok: true,
              disposition: 'created',
              rootRowId: ROOT_ROW_ID,
              runId: RUN_ID,
              revision: stored.revision,
              state: stored.state,
              rootSnapshot: stored,
            },
          };
        }
        if (
          args.p_request_identity_fingerprint !== requestFingerprint
          || args.p_root_fingerprint !== rootFingerprint
          || args.p_task_fingerprint !== taskFingerprint
        ) {
          return {
            data: {
              schemaVersion: 1,
              ok: false,
              code: 'identity_conflict',
              message: 'identity conflict',
            },
          };
        }
        return {
          data: {
            schemaVersion: 1,
            ok: true,
            disposition: 'duplicate',
            rootRowId: ROOT_ROW_ID,
            runId: RUN_ID,
            revision: stored.revision,
            state: stored.state,
            rootSnapshot: stored,
          },
        };
      }
      if (functionName === 'transition_computer_task_root_v1') {
        assert.equal(typeof args.p_transition_type, 'string');
        assert.equal(args.p_root_row_id, ROOT_ROW_ID);
        if (!stored || args.p_expected_revision !== stored.revision) {
          return {
            data: {
              schemaVersion: 1,
              ok: false,
              code: 'state_conflict',
              message: 'state conflict',
              currentRevision: stored?.revision ?? 0,
              rootRowId: ROOT_ROW_ID,
              runId: RUN_ID,
              rootSnapshot: stored,
            },
          };
        }
        stored = args.p_root_snapshot as Record<string, unknown>;
        return {
          data: {
            schemaVersion: 1,
            ok: true,
            disposition: 'transitioned',
            rootRowId: ROOT_ROW_ID,
            runId: RUN_ID,
            revision: stored.revision,
            state: stored.state,
            rootSnapshot: stored,
          },
        };
      }
      if (functionName === 'read_computer_task_root_v1') {
        if (!stored || args.p_root_row_id !== ROOT_ROW_ID) {
          return {
            data: {
              schemaVersion: 1,
              ok: false,
              code: 'not_found',
              message: 'not found',
            },
          };
        }
        return {
          data: {
            schemaVersion: 1,
            ok: true,
            disposition: 'read',
            rootRowId: ROOT_ROW_ID,
            runId: RUN_ID,
            revision: stored.revision,
            state: stored.state,
            rootSnapshot: stored,
          },
        };
      }
      return { data: null, error: { message: 'unknown rpc' } };
    },
  };

  const store = createComputerTaskRootStore(client);
  const admissionInput = {
    schemaVersion: 1 as const,
    requestIdentity: 'message-600x600',
    userId: USER_ID,
    circleId: CIRCLE_ID,
    threadId: THREAD_ID,
    source: 'chat' as const,
    normalizedTask: SECRET_TASK,
    admittedAt: '2026-08-06T12:00:00.000Z',
  };
  const created = await store.admit(admissionInput);
  assert(created.ok);
  assert.equal(created.disposition, 'created');
  assert.equal(created.record.root.state, 'admitted');
  assert.equal(created.record.root.revision, 0);
  assert.equal(created.record.root.request.userId, USER_ID);
  assert.equal(calls[0].functionName, 'admit_computer_task_root_v1');
  assert.doesNotMatch(
    JSON.stringify(calls[0].args),
    /private-launch-token-123|Open Photoshop/i,
    'raw task text is never sent to durable root persistence',
  );
  const pointer = toComputerTaskRootPointer(created.record);
  assert(pointer, 'only a store-issued record projects to a bounded pointer');
  assert.doesNotMatch(JSON.stringify(pointer), /message-600x600|private-launch-token|Open Photoshop/i);
  assert.equal(
    toComputerTaskRootPointer({ ...created.record }),
    null,
    'a structural record clone has no transition or pointer authority',
  );
  const read = await store.read(pointer);
  assert(read.ok);
  assert.equal(read.record.root.rootFingerprint, created.record.root.rootFingerprint);

  const forgedRead = await store.read({
    ...pointer,
    taskFingerprint: `args-v2:sha256:${'f'.repeat(64)}`,
  });
  assert.equal(forgedRead.ok, false);
  if (!forgedRead.ok) assert.equal(forgedRead.code, 'malformed_response');

  const structuralTransition = await store.transition({
    record: { ...created.record },
    expectedRevision: 0,
    transition: {
      type: 'begin_attempt',
      kind: 'deterministic',
      parentAttemptId: null,
      at: '2026-08-06T12:00:01.000Z',
    },
  });
  assert.equal(structuralTransition.ok, false);
  if (!structuralTransition.ok) assert.equal(structuralTransition.code, 'invalid_input');

  const duplicate = await store.admit({
    ...admissionInput,
    admittedAt: '2026-08-06T12:00:05.000Z',
  });
  assert(duplicate.ok);
  assert.equal(duplicate.disposition, 'duplicate');
  assert.equal(duplicate.record.root.createdAt, '2026-08-06T12:00:00.000Z');

  const drift = await store.admit({
    ...admissionInput,
    normalizedTask: 'Open Photoshop and create 601 x 600',
    admittedAt: '2026-08-06T12:00:06.000Z',
  });
  assert.equal(drift.ok, false);
  if (!drift.ok) assert.equal(drift.code, 'identity_conflict');

  const running = await store.transition({
    record: created.record,
    expectedRevision: 0,
    transition: {
      type: 'begin_attempt',
      kind: 'deterministic',
      parentAttemptId: null,
      at: '2026-08-06T12:00:01.000Z',
    },
  });
  assert(running.ok);
  assert.equal(running.record.root.revision, 1);
  assert.equal(running.record.root.state, 'running');
  assert.equal(running.record.root.attempts.length, 1);

  const stale = await store.transition({
    record: created.record,
    expectedRevision: 0,
    transition: {
      type: 'begin_attempt',
      kind: 'provider',
      parentAttemptId: null,
      at: '2026-08-06T12:00:02.000Z',
    },
  });
  assert.equal(stale.ok, false);
  if (!stale.ok) {
    assert.equal(stale.code, 'state_conflict');
    assert.equal(stale.current?.root.revision, 1);
    assert.equal(stale.current?.root.state, 'running');
  }

  const localStale = await store.transition({
    record: running.record,
    expectedRevision: 0,
    transition: {
      type: 'set_waiting',
      state: 'waiting_input',
      at: '2026-08-06T12:00:03.000Z',
    },
  });
  assert.equal(localStale.ok, false);
  if (!localStale.ok) assert.equal(localStale.code, 'state_conflict');

  const memoryRuntime = await admitComputerTaskRuntimeRoot({
    ...admissionInput,
    requestIdentity: 'memory-runtime-message',
    admittedAt: '2026-08-06T12:00:09.000Z',
  }, { requireDurable: false });
  assert(memoryRuntime.ok);
  assert.equal(memoryRuntime.binding.durability, 'memory');
  assert.equal(memoryRuntime.binding.durableRecord, null);
  const memoryRuntimeDuplicate = await admitComputerTaskRuntimeRoot({
    ...admissionInput,
    requestIdentity: 'memory-runtime-message',
    admittedAt: '2026-08-06T12:00:10.000Z',
  }, { requireDurable: false });
  assert(memoryRuntimeDuplicate.ok);
  assert.equal(memoryRuntimeDuplicate.disposition, 'duplicate');
  const memoryBindingValidation = await validateComputerTaskRuntimeRootBinding(
    memoryRuntime.binding,
    {
      ...admissionInput,
      requestIdentity: 'memory-runtime-message',
      admittedAt: '2026-08-06T12:00:11.000Z',
    },
  );
  assert(memoryBindingValidation.ok);

  let forbiddenMemoryRpcCalls = 0;
  const forbiddenMemoryClient: ComputerTaskRootRpcClient = {
    async rpc() {
      forbiddenMemoryRpcCalls += 1;
      throw new Error('memory mode must not call Supabase');
    },
  };
  const raceInput = {
    ...admissionInput,
    requestIdentity: 'memory-runtime-race-message',
    admittedAt: '2026-08-06T12:00:20.000Z',
  };
  const raceAdmission = await admitComputerTaskRuntimeRoot(
    raceInput,
    { requireDurable: false, client: forbiddenMemoryClient },
  );
  assert(raceAdmission.ok);
  assert.doesNotMatch(
    JSON.stringify(raceAdmission.binding.root),
    /private-launch-token-123|Open Photoshop/i,
    'the volatile canonical root retains fingerprints, never raw task text',
  );
  const raceTransition = {
    type: 'begin_attempt' as const,
    kind: 'deterministic',
    parentAttemptId: null,
    at: '2026-08-06T12:00:21.000Z',
  };
  const raceResults = await Promise.all([
    transitionComputerTaskRuntimeRoot(
      raceAdmission.binding,
      raceInput,
      raceTransition,
      { client: forbiddenMemoryClient },
    ),
    transitionComputerTaskRuntimeRoot(
      raceAdmission.binding,
      raceInput,
      raceTransition,
      { client: forbiddenMemoryClient },
    ),
  ]);
  assert.equal(raceResults.filter((result) => result.ok).length, 1);
  assert.equal(raceResults.filter((result) => !result.ok).length, 1);
  assert.equal(forbiddenMemoryRpcCalls, 0, 'memory admission and CAS never call Supabase');
  const reconciledRaceBinding = await validateComputerTaskRuntimeRootBinding(
    raceAdmission.binding,
    raceInput,
  );
  assert(reconciledRaceBinding.ok);
  assert.equal(reconciledRaceBinding.binding.root.revision, 1);
  assert.equal(reconciledRaceBinding.binding.root.attempts.length, 1);
  assert.equal(reconciledRaceBinding.binding.root.state, 'running');

  const forgedMemoryBinding = await validateComputerTaskRuntimeRootBinding(
    { ...raceAdmission.binding },
    raceInput,
  );
  assert.equal(forgedMemoryBinding.ok, false);
  if (!forgedMemoryBinding.ok) assert.equal(forgedMemoryBinding.code, 'invalid_input');
  const driftedRaceBinding = await validateComputerTaskRuntimeRootBinding(
    raceAdmission.binding,
    { ...raceInput, normalizedTask: 'Open Photoshop and create 601 x 600' },
  );
  assert.equal(driftedRaceBinding.ok, false);
  if (!driftedRaceBinding.ok) assert.equal(driftedRaceBinding.code, 'identity_conflict');

  const durableRuntime = await admitComputerTaskRuntimeRoot(
    { ...admissionInput, admittedAt: '2026-08-06T12:00:30.000Z' },
    { requireDurable: true, client },
  );
  assert(durableRuntime.ok);
  assert.equal(durableRuntime.binding.durability, 'database');
  const durableCallsBeforeTransition = calls.length;
  const durableTransition = await transitionComputerTaskRuntimeRoot(
    durableRuntime.binding,
    { ...admissionInput, admittedAt: '2026-08-06T12:00:31.000Z' },
    {
      type: 'set_waiting',
      state: 'waiting_input',
      at: '2026-08-06T12:00:31.000Z',
    },
    { client },
  );
  assert(durableTransition.ok);
  assert.equal(durableTransition.binding.root.revision, 2);
  assert.equal(durableTransition.binding.root.state, 'waiting_input');
  assert.equal(calls.length, durableCallsBeforeTransition + 1);
  assert.equal(calls.at(-1)?.functionName, 'transition_computer_task_root_v1');

  const durableCallsBeforeForgery = calls.length;
  const forgedDurableBindingTransition = await transitionComputerTaskRuntimeRoot(
    {
      ...durableTransition.binding,
      durableRecord: { ...durableTransition.binding.durableRecord! },
    },
    { ...admissionInput, admittedAt: '2026-08-06T12:00:32.000Z' },
    {
      type: 'set_waiting',
      state: 'paused',
      at: '2026-08-06T12:00:32.000Z',
    },
    { client },
  );
  assert.equal(forgedDurableBindingTransition.ok, false);
  if (!forgedDurableBindingTransition.ok) {
    assert.equal(forgedDurableBindingTransition.code, 'invalid_input');
  }
  const forgedDurableRecordTransition = await store.transition({
    record: { ...durableTransition.binding.durableRecord! },
    expectedRevision: durableTransition.binding.root.revision,
    transition: {
      type: 'set_waiting',
      state: 'paused',
      at: '2026-08-06T12:00:32.000Z',
    },
  });
  assert.equal(forgedDurableRecordTransition.ok, false);
  if (!forgedDurableRecordTransition.ok) {
    assert.equal(forgedDurableRecordTransition.code, 'invalid_input');
  }
  assert.equal(calls.length, durableCallsBeforeForgery, 'a forged record is rejected before RPC');
  assert.doesNotMatch(
    JSON.stringify(calls),
    /private-launch-token-123|Open Photoshop/i,
    'raw task text is absent from every durable admission and transition call',
  );

  let newestBoundedBinding = memoryRuntime.binding;
  let newestBoundedInput = admissionInput;
  for (let index = 0; index <= 256; index += 1) {
    newestBoundedInput = {
      ...admissionInput,
      requestIdentity: `bounded-memory-root-${index}`,
      normalizedTask: `bounded memory task ${index}`,
      admittedAt: new Date(Date.parse('2026-08-06T13:00:00.000Z') + index).toISOString(),
    };
    const boundedAdmission = await admitComputerTaskRuntimeRoot(
      newestBoundedInput,
      { requireDurable: false, client: forbiddenMemoryClient },
    );
    assert(boundedAdmission.ok);
    newestBoundedBinding = boundedAdmission.binding;
  }
  const evictedBinding = await validateComputerTaskRuntimeRootBinding(
    memoryRuntime.binding,
    {
      ...admissionInput,
      requestIdentity: 'memory-runtime-message',
      admittedAt: '2026-08-06T12:00:11.000Z',
    },
  );
  assert.equal(evictedBinding.ok, false);
  if (!evictedBinding.ok) assert.equal(evictedBinding.code, 'not_found');
  const retainedNewestBinding = await validateComputerTaskRuntimeRootBinding(
    newestBoundedBinding,
    newestBoundedInput,
  );
  assert(retainedNewestBinding.ok, 'the bounded map retains its newest canonical root');
  assert.equal(forbiddenMemoryRpcCalls, 0, 'bounded memory admission still avoids Supabase');

  mode = 'malformed';
  const malformed = await store.admit({
    ...admissionInput,
    requestIdentity: 'another-message',
    admittedAt: '2026-08-06T12:00:07.000Z',
  });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.code, 'malformed_response');

  mode = 'rpc_error';
  const unavailable = await store.admit({
    ...admissionInput,
    requestIdentity: 'third-message',
    admittedAt: '2026-08-06T12:00:08.000Z',
  });
  assert.equal(unavailable.ok, false);
  if (!unavailable.ok) {
    assert.equal(unavailable.code, 'rpc_error');
    assert.doesNotMatch(unavailable.message, /private db error/);
  }
  const durableNoFallback = await admitComputerTaskRuntimeRoot({
    ...admissionInput,
    requestIdentity: 'durable-runtime-message',
    admittedAt: '2026-08-06T12:00:12.000Z',
  }, { requireDurable: true, client });
  assert.equal(durableNoFallback.ok, false);
  if (!durableNoFallback.ok) assert.equal(durableNoFallback.code, 'rpc_error');

  console.log('computer task root store smoke passed');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
