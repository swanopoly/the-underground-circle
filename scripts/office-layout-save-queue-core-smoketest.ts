import assert from 'node:assert/strict';
import {
  OfficeLayoutRequestDeadlineError,
  drainLatestOfficeLayoutSaveQueue,
  queueLatestOfficeLayoutSave,
  runOfficeLayoutRequestWithDeadline,
  type OfficeLayoutSaveQueueState,
} from '../src/lib/officeLayoutSaveQueueCore';

type Item = { scope: string; version: number; name: string };
type Result = { ok: boolean; conflict?: boolean };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function state(): OfficeLayoutSaveQueueState<Item> {
  return {
    pending: { current: null },
    active: { current: null },
    inFlight: { current: false },
    drainRequested: { current: false },
  };
}

async function letDrainStart(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function main(): Promise<void> {
{
  const queue = state();
  const first = deferred<Result>();
  const calls: number[] = [];
  queueLatestOfficeLayoutSave(queue, { scope: 'user:circle', version: 1, name: 'v1' });
  const running = drainLatestOfficeLayoutSaveQueue(queue, {
    getActiveScope: () => 'user:circle',
    save: (item) => {
      calls.push(item.version);
      return item.version === 1 ? first.promise : Promise.resolve({ ok: true });
    },
  });
  await letDrainStart();
  queueLatestOfficeLayoutSave(queue, { scope: 'user:circle', version: 2, name: 'v2' });
  await drainLatestOfficeLayoutSaveQueue(queue, {
    getActiveScope: () => 'user:circle',
    save: async () => ({ ok: true }),
  });
  assert.equal(queue.drainRequested.current, true, 'a busy flush records a re-drain request');
  first.resolve({ ok: false });
  await running;
  assert.deepEqual(calls, [1, 2], 'a newer snapshot drains after an older non-conflicting failure');
  assert.equal(queue.pending.current, null, 'the successful newest snapshot clears the queue');
  assert.equal(queue.inFlight.current, false, 'the single writer settles');
}

{
  const queue = state();
  const first = deferred<Result>();
  const calls: number[] = [];
  queueLatestOfficeLayoutSave(queue, { scope: 'user:circle', version: 10, name: 'v10' });
  const running = drainLatestOfficeLayoutSaveQueue(queue, {
    getActiveScope: () => 'user:circle',
    save: (item) => {
      calls.push(item.version);
      return item.version === 10 ? first.promise : Promise.resolve({ ok: true });
    },
  });
  await letDrainStart();
  queueLatestOfficeLayoutSave(queue, { scope: 'user:circle', version: 11, name: 'v11' });
  first.resolve({ ok: false, conflict: true });
  await running;
  assert.deepEqual(calls, [10], 'a conflict pauses the writer before dispatching a newer snapshot');
  assert.equal(queue.pending.current?.version, 11, 'an older conflict never erases the newer snapshot');

  await drainLatestOfficeLayoutSaveQueue(queue, {
    getActiveScope: () => 'user:circle',
    save: async (item) => {
      calls.push(item.version);
      return { ok: true };
    },
  });
  assert.deepEqual(calls, [10, 11], 'a fresh-read resume can send the preserved newest snapshot');
  assert.equal(queue.pending.current, null);
}

{
  const queue = state();
  queueLatestOfficeLayoutSave(queue, { scope: 'user:circle', version: 20, name: 'newest' });
  assert.equal(
    queueLatestOfficeLayoutSave(queue, { scope: 'user:circle', version: 19, name: 'stale' }),
    false,
    'a stale async continuation cannot replace a newer pending version',
  );
  assert.equal(queue.pending.current?.version, 20);

  await drainLatestOfficeLayoutSaveQueue(queue, {
    getActiveScope: () => 'user:circle',
    save: async () => ({ ok: false }),
  });
  assert.equal(queue.pending.current?.version, 20, 'the latest failed snapshot remains for explicit retry');
}

{
  const queue = state();
  queueLatestOfficeLayoutSave(queue, { scope: 'user:circle', version: 30, name: 'rejecting' });
  await assert.rejects(
    drainLatestOfficeLayoutSaveQueue(queue, {
      getActiveScope: () => 'user:circle',
      save: async () => { throw new Error('transport rejected'); },
    }),
    /transport rejected/,
    'a rejected transport remains visible to the caller',
  );
  assert.equal(queue.pending.current?.version, 30, 'a rejected save retains the exact snapshot for retry');
  assert.equal(queue.active.current, null, 'a rejected save clears active state');
}

{
  const queue = state();
  const active = deferred<Result>();
  const calls: number[] = [];
  queueLatestOfficeLayoutSave(queue, { scope: 'user:circle', version: 40, name: 'active-newest' });
  const running = drainLatestOfficeLayoutSaveQueue(queue, {
    getActiveScope: () => 'user:circle',
    save: async (item) => {
      calls.push(item.version);
      return active.promise;
    },
  });
  await letDrainStart();
  assert.equal(
    queueLatestOfficeLayoutSave(queue, { scope: 'user:circle', version: 39, name: 'stale-while-active' }),
    false,
    'a snapshot older than the active write cannot queue behind it',
  );
  active.resolve({ ok: true });
  await running;
  assert.deepEqual(calls, [40], 'the active freshness fence prevents stale reordering');
}

{
  let aborted = false;
  const startedAt = Date.now();
  await assert.rejects(
    runOfficeLayoutRequestWithDeadline((signal) => new Promise<never>(() => {
      signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    }), 15),
    OfficeLayoutRequestDeadlineError,
    'a hung server write settles through the absolute deadline',
  );
  assert.equal(aborted, true, 'the deadline aborts the underlying transport');
  assert(Date.now() - startedAt < 1_000, 'the deadline test settles promptly');
}

console.log('office-layout-save-queue-core smoketest: all assertions passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
