import assert from 'node:assert/strict';
import {
  OFFICE_PREFERENCE_MAX_ACCESS_TOKEN_BYTES,
  OFFICE_PREFERENCE_MAX_DEADLINE_MS,
  OFFICE_PREFERENCE_MAX_VALUE_BYTES,
  createOfficePreferenceWriteQueue,
} from '../src/lib/officePreferenceWriteQueueCore';
import type {
  CapturedOfficePreferenceWrite,
  OfficePreferenceTransportResult,
  OfficePreferenceWriteInput,
} from '../src/lib/officePreferenceWriteQueueCore';

const USER_A = '11111111-1111-4111-8111-111111111111';
const USER_B = '22222222-2222-4222-8222-222222222222';
const CIRCLE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CIRCLE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TOKEN_A = 'header.payload.signatureA';
const TOKEN_A_REFRESHED = 'header.payload.signatureA2';
const TOKEN_B = 'header.payload.signatureB';

type CurrentScope = {
  userId: string;
  circleId: string;
  accessToken: string;
  generation: number;
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function writeInput(
  partial: unknown,
  overrides: Partial<Omit<OfficePreferenceWriteInput, 'partial'>> = {},
): OfficePreferenceWriteInput {
  return {
    userId: USER_A,
    circleId: CIRCLE_A,
    accessToken: TOKEN_A,
    authorityGeneration: 1,
    partial,
    ...overrides,
  };
}

async function flushQueueStart(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function run(): Promise<void> {
  let assertions = 0;
  const equal = <T>(actual: T, expected: T, message: string): void => {
    assert.equal(actual, expected, message);
    assertions += 1;
  };
  const deepEqual = (actual: unknown, expected: unknown, message: string): void => {
    assert.deepEqual(actual, expected, message);
    assertions += 1;
  };

  let currentScope: CurrentScope | null = {
    userId: USER_A,
    circleId: CIRCLE_A,
    accessToken: TOKEN_A,
    generation: 1,
  };

  // Invalid and oversized authority/value input never reaches the transport.
  let boundaryDispatches = 0;
  const boundaryQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    save: async () => {
      boundaryDispatches += 1;
      return { ok: true };
    },
  });
  equal(
    (await boundaryQueue.enqueue(writeInput({ theme: 'dark' }, { userId: 'not-a-user' }))).code,
    'invalid_authority',
    'non-UUID user authority fails closed',
  );
  equal(
    (await boundaryQueue.enqueue(writeInput({ theme: 'dark' }, { circleId: 'not-a-circle' }))).code,
    'invalid_authority',
    'non-UUID circle authority fails closed',
  );
  equal(
    (await boundaryQueue.enqueue(writeInput({ theme: 'dark' }, { authorityGeneration: 0 }))).code,
    'invalid_authority',
    'non-positive authority generation fails closed',
  );
  equal(
    (await boundaryQueue.enqueue(writeInput({ theme: 'dark' }, { accessToken: 'opaque token' }))).code,
    'invalid_authority',
    'non-JWT authority fails closed',
  );
  equal(
    (
      await boundaryQueue.enqueue(writeInput(
        { theme: 'dark' },
        { accessToken: `a.${'b'.repeat(OFFICE_PREFERENCE_MAX_ACCESS_TOKEN_BYTES)}.c` },
      ))
    ).code,
    'authority_too_large',
    'oversized token fails closed',
  );
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  equal(
    (await boundaryQueue.enqueue(writeInput(circular))).code,
    'invalid_value',
    'circular preference value fails closed',
  );
  equal(
    (await boundaryQueue.enqueue(writeInput({ zoom: Number.NaN }))).code,
    'invalid_value',
    'non-JSON number fails closed',
  );
  equal(
    (await boundaryQueue.enqueue(writeInput({ note: 'x'.repeat(OFFICE_PREFERENCE_MAX_VALUE_BYTES + 1) }))).code,
    'value_too_large',
    'oversized preference value fails closed',
  );
  equal(boundaryDispatches, 0, 'invalid boundary input never dispatches');

  // Enqueue captures an immutable authority/value snapshot before waiting.
  const captureGate = deferred<OfficePreferenceTransportResult>();
  const captured: CapturedOfficePreferenceWrite[] = [];
  const captureQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    save: async (item) => {
      captured.push(item);
      if (captured.length === 1) return captureGate.promise;
      return { ok: true };
    },
  });
  const firstCapture = captureQueue.enqueue(writeInput({ blocker: true }));
  const mutablePartial = { theme: 'garden', nested: { zoom: 2 } };
  const mutableInput = writeInput(mutablePartial);
  const secondCapture = captureQueue.enqueue(mutableInput);
  mutableInput.accessToken = TOKEN_B;
  mutableInput.circleId = CIRCLE_B;
  mutablePartial.theme = 'changed';
  mutablePartial.nested.zoom = 99;
  captureGate.resolve({ ok: true });
  await firstCapture;
  await secondCapture;
  equal(captured[1]?.accessToken, TOKEN_A, 'queued item captures the original access token');
  equal(captured[1]?.circleId, CIRCLE_A, 'queued item captures the original circle');
  deepEqual(
    captured[1]?.partial,
    { theme: 'garden', nested: { zoom: 2 } },
    'queued item captures the original JSON value',
  );
  equal(Object.isFrozen(captured[1]?.partial), true, 'captured preference root is immutable');
  equal(
    Object.isFrozen((captured[1]?.partial.nested ?? null) as object),
    true,
    'captured nested preference value is immutable',
  );

  // Same-scope writes serialize in order.
  const laneGate = deferred<OfficePreferenceTransportResult>();
  const laneStarts: number[] = [];
  let activeLane = 0;
  let maxActiveLane = 0;
  const laneQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    save: async (item) => {
      const order = item.partial.order as number;
      laneStarts.push(order);
      activeLane += 1;
      maxActiveLane = Math.max(maxActiveLane, activeLane);
      if (order === 1) await laneGate.promise;
      activeLane -= 1;
      return { ok: true };
    },
  });
  const laneA1 = laneQueue.enqueue(writeInput({ order: 1 }));
  const laneA2 = laneQueue.enqueue(writeInput({ order: 2 }));
  await flushQueueStart();
  equal(laneStarts.length, 1, 'second same-scope write waits for the first');
  laneGate.resolve({ ok: true });
  await Promise.all([laneA1, laneA2]);
  equal(maxActiveLane, 1, 'same-scope transport calls never overlap');
  deepEqual(laneStarts, [1, 2], 'same-scope writes retain enqueue order');

  // A timed-out lane cannot block a different user/circle scope.
  const crossScopeGate = deferred<OfficePreferenceTransportResult>();
  const crossScopeStarts: string[] = [];
  const crossScopeQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    deadlineMs: 5,
    save: async (item) => {
      crossScopeStarts.push(`${item.userId}:${item.circleId}`);
      if (item.circleId === CIRCLE_A) return crossScopeGate.promise;
      return { ok: true };
    },
  });
  const hungA = crossScopeQueue.enqueue(writeInput({ hung: true }));
  await flushQueueStart();
  currentScope = {
    userId: USER_B,
    circleId: CIRCLE_B,
    accessToken: TOKEN_B,
    generation: 2,
  };
  const fastB = await crossScopeQueue.enqueue(writeInput(
    { ready: true },
    {
      userId: USER_B,
      circleId: CIRCLE_B,
      accessToken: TOKEN_B,
      authorityGeneration: 2,
    },
  ));
  equal(fastB.code, 'saved', 'hung scope A does not block scope B');
  equal((await hungA).code, 'deadline_exceeded', 'hung caller receives a bounded typed deadline');
  deepEqual(
    crossScopeStarts,
    [`${USER_A}:${CIRCLE_A}`, `${USER_B}:${CIRCLE_B}`],
    'different user/circle lane dispatches independently',
  );
  equal(crossScopeQueue.getLaneCount(), 1, 'hung scope retains only its own serialization lane');
  crossScopeGate.resolve({ ok: true });

  // Every captured authority field is checked immediately before dispatch.
  currentScope = {
    userId: USER_A,
    circleId: CIRCLE_A,
    accessToken: TOKEN_A,
    generation: 3,
  };
  const scopeGate = deferred<OfficePreferenceTransportResult>();
  let scopeDispatches = 0;
  const scopeQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    save: async () => {
      scopeDispatches += 1;
      if (scopeDispatches === 1) return scopeGate.promise;
      return { ok: true };
    },
  });
  const scopedFirst = scopeQueue.enqueue(writeInput({ order: 1 }, { authorityGeneration: 3 }));
  const retiredSecond = scopeQueue.enqueue(writeInput({ order: 2 }, { authorityGeneration: 3 }));
  await flushQueueStart();
  currentScope = {
    userId: USER_A,
    circleId: CIRCLE_B,
    accessToken: TOKEN_A,
    generation: 4,
  };
  scopeGate.resolve({ ok: true });
  await scopedFirst;
  const retiredResult = await retiredSecond;
  equal(retiredResult.code, 'scope_retired', 'waiting write retires after the circle changes');
  equal(retiredResult.dispatched, false, 'retired circle never calls save');
  equal(scopeDispatches, 1, 'only the pre-switch write reached the transport');

  currentScope = {
    userId: USER_A,
    circleId: CIRCLE_A,
    accessToken: TOKEN_A,
    generation: 5,
  };
  const tokenGate = deferred<OfficePreferenceTransportResult>();
  let tokenDispatches = 0;
  const tokenQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    save: async () => {
      tokenDispatches += 1;
      if (tokenDispatches === 1) return tokenGate.promise;
      return { ok: true };
    },
  });
  const beforeRefresh = tokenQueue.enqueue(writeInput({ order: 1 }, { authorityGeneration: 5 }));
  const staleToken = tokenQueue.enqueue(writeInput({ order: 2 }, { authorityGeneration: 5 }));
  await flushQueueStart();
  currentScope = {
    userId: USER_A,
    circleId: CIRCLE_A,
    accessToken: TOKEN_A_REFRESHED,
    generation: 6,
  };
  tokenGate.resolve({ ok: true });
  await beforeRefresh;
  equal((await staleToken).code, 'scope_retired', 'waiting write retires after token refresh');
  equal(tokenDispatches, 1, 'a stale captured token is never silently replayed');

  currentScope = {
    userId: USER_A,
    circleId: CIRCLE_A,
    accessToken: TOKEN_A,
    generation: 7,
  };
  const generationQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    save: async () => ({ ok: true }),
  });
  currentScope = { ...currentScope, generation: 8 };
  equal(
    (await generationQueue.enqueue(writeInput({ generation: 'stale' }, { authorityGeneration: 7 }))).code,
    'scope_retired',
    'same-string credentials still retire when authority generation changes',
  );

  // Rejected and explicit failures settle as data and never poison later work.
  currentScope = {
    userId: USER_A,
    circleId: CIRCLE_A,
    accessToken: TOKEN_A,
    generation: 9,
  };
  const failureOrder: number[] = [];
  const failureQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    save: async (item) => {
      const order = item.partial.order as number;
      failureOrder.push(order);
      if (order === 1) throw new Error('network unavailable');
      if (order === 2) return { ok: false, retryable: false };
      return { ok: true };
    },
  });
  const rejected = failureQueue.enqueue(writeInput({ order: 1 }, { authorityGeneration: 9 }));
  const explicitFailure = failureQueue.enqueue(writeInput({ order: 2 }, { authorityGeneration: 9 }));
  const afterFailures = failureQueue.enqueue(writeInput({ order: 3 }, { authorityGeneration: 9 }));
  equal((await rejected).code, 'save_failed', 'transport rejection becomes a typed failure');
  const explicitResult = await explicitFailure;
  equal(explicitResult.code, 'save_failed', 'explicit transport failure remains typed');
  equal(explicitResult.ok ? true : explicitResult.retryable, false, 'transport retryability is preserved');
  equal((await afterFailures).code, 'saved', 'later write runs after earlier failures');
  deepEqual(failureOrder, [1, 2, 3], 'failure does not reorder or poison the lane');

  // Disposing the component-owned queue retires waiting and future work.
  const disposeGate = deferred<OfficePreferenceTransportResult>();
  let disposeDispatches = 0;
  const disposeQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    save: async () => {
      disposeDispatches += 1;
      if (disposeDispatches === 1) return disposeGate.promise;
      return { ok: true };
    },
  });
  const disposeFirst = disposeQueue.enqueue(writeInput({ order: 1 }, { authorityGeneration: 9 }));
  const disposeWaiting = disposeQueue.enqueue(writeInput({ order: 2 }, { authorityGeneration: 9 }));
  await flushQueueStart();
  disposeQueue.dispose();
  const disposeNew = await disposeQueue.enqueue(writeInput({ order: 3 }, { authorityGeneration: 9 }));
  equal(disposeNew.code, 'scope_retired', 'disposed queue rejects new work');
  equal(disposeNew.dispatched, false, 'new work after dispose is not dispatched');
  disposeGate.resolve({ ok: true });
  await disposeFirst;
  equal((await disposeWaiting).code, 'scope_retired', 'dispose retires already-waiting work');
  equal(disposeDispatches, 1, 'dispose leaves only the already-dispatched operation');

  // The injectable deadline is clamped to the exported hard maximum.
  let scheduledDelay = 0;
  const boundedQueue = createOfficePreferenceWriteQueue({
    getCurrentScope: () => currentScope,
    deadlineMs: Number.MAX_SAFE_INTEGER,
    scheduler: {
      schedule: (callback, delayMs) => {
        scheduledDelay = delayMs;
        queueMicrotask(callback);
        return 1;
      },
      cancel: () => undefined,
    },
    save: () => new Promise<OfficePreferenceTransportResult>(() => undefined),
  });
  const boundedResult = await boundedQueue.enqueue(writeInput(
    { bounded: true },
    { authorityGeneration: 9 },
  ));
  equal(scheduledDelay, OFFICE_PREFERENCE_MAX_DEADLINE_MS, 'injected deadline is hard-capped');
  equal(boundedResult.code, 'deadline_exceeded', 'injected scheduler returns typed deadline result');
  equal(
    boundedResult.ok ? false : boundedResult.outcomeUnknown,
    true,
    'deadline reports mutation outcome as unknown',
  );

  console.log(`office-preference-write-queue-core smoke passed (${assertions} assertions)`);
}

void run();
