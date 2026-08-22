/**
 * agent-run-persistence-receipt-smoketest — pins the durable typed-loop trace
 * contract without importing the React Native Supabase client into Node.
 *
 * The module is transpiled and evaluated with its database dependencies mocked;
 * the real event/tool-call bounders remain in use so this covers the exact
 * payloads written by createPersistedRun.
 *
 * Run: npx tsx scripts/agent-run-persistence-receipt-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInThisContext } from 'node:vm';
import * as ts from 'typescript';
import {
  PERSISTED_TOOL_FAILURE_TEXT,
  boundEventPayload,
  boundToolCallsAggregate,
} from '../src/lib/eventBoundCore';

type PersistedRow = { table: string; payload: Record<string, unknown> };

const repoRoot = resolve(__dirname, '..');
const persistencePath = resolve(repoRoot, 'src/lib/agentRunPersistence.ts');
const source = readFileSync(persistencePath, 'utf8');
assert.ok(
  source.includes("console.warn('[agentRunPersistence] event_insert_failed')")
    && !source.includes("event insert failed:', e"),
  'telemetry insert failures log a value-free stable code',
);
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  },
  fileName: persistencePath,
}).outputText;

const inserted: PersistedRow[] = [];
const updated: PersistedRow[] = [];
const mockSupabase = {
  from(table: string) {
    return {
      async insert(payload: Record<string, unknown>) {
        inserted.push({ table, payload });
        return { error: null };
      },
      update(payload: Record<string, unknown>) {
        updated.push({ table, payload });
        return {
          async eq() {
            return { error: null };
          },
        };
      },
    };
  },
};

const mockRequire = (specifier: string): unknown => {
  if (specifier === './supabase') return { supabase: mockSupabase };
  if (specifier === './eventBoundCore') {
    return {
      PERSISTED_TOOL_FAILURE_TEXT,
      boundEventPayload,
      boundToolCallsAggregate,
    };
  }
  if (specifier === './runCostRollupCore') return { estimateRunCostUsd: () => 0 };
  if (specifier === './agentRunSystem') {
    return {
      createRun: async (input: Record<string, unknown>) => ({
        id: `run_${String(input.title || 'test')}`,
        model: input.model || null,
      }),
      updateRunStatus: async () => undefined,
    };
  }
  throw new Error(`Unexpected dependency while loading agentRunPersistence: ${specifier}`);
};

const moduleShim: { exports: Record<string, unknown> } = { exports: {} };
const factory = runInThisContext(
  `(function(require, module, exports) {\n${transpiled}\n})`,
  { filename: persistencePath },
) as (requireFn: typeof mockRequire, module: typeof moduleShim, exports: Record<string, unknown>) => void;
factory(mockRequire, moduleShim, moduleShim.exports);

const sanitize = moduleShim.exports.sanitizeToolResultMetadataForPersistence as
  (metadata: unknown) => Record<string, unknown> | undefined;
const sanitizeActionMetadata = moduleShim.exports.sanitizeToolActionMetadataForPersistence as
  (metadata: unknown) => Record<string, unknown> | undefined;
const createPersistedRun = moduleShim.exports.createPersistedRun as
  (options: Record<string, unknown>) => Promise<{
    onEvent: (event: Record<string, unknown>) => void;
    finalize: (result: Record<string, unknown>, err?: unknown) => Promise<void>;
    stopHeartbeat: () => void;
  } | null>;

assert.equal(typeof sanitize, 'function', 'pure receipt sanitizer is exported');
assert.equal(typeof sanitizeActionMetadata, 'function', 'pure action metadata projector is exported');
assert.equal(typeof createPersistedRun, 'function', 'persistence adapter loaded under mocked boundary');

const secretToken = `sk-ant-${'A'.repeat(30)}`;
const exactFingerprint = `args-v2:sha256:${'a'.repeat(64)}`;
const metadata = {
  computerActionReceipt: {
    schemaVersion: 1,
    actionId: secretToken,
    tool: 'desktop.click',
    surface: 'desktop',
    toolArgsFingerprint: exactFingerprint,
    handlerEnteredAt: '2026-07-24T14:00:00.000Z',
    outcome: 'succeeded',
    mutates: true,
    approvalRequired: true,
    iteration: 3,
    durationMs: 41,
    summary: 'must not persist free-form summaries',
    raw: { localPath: '/Users/private/secret.txt' },
  },
  mutationDispatchReceipt: {
    schemaVersion: 1,
    actionId: 'action-1',
    tool: 'desktop.click',
    epochId: 'epoch-1',
    authorizedAt: '2026-07-24T13:59:59.000Z',
    dispatchedAt: '2026-07-24T14:00:00.000Z',
    contractBinding: 'must-not-persist',
    policyBinding: 'must-not-persist',
  },
  computerAppVerificationReceipt: {
    schemaVersion: 1,
    actionId: 'action-1',
    beforeEpochId: 'epoch-1',
    afterEpochId: null,
    status: 'inconclusive',
    checkedAt: '2026-07-24T14:00:01.000Z',
    canComplete: false,
    predicate: 'must not persist free-form predicates',
    evidenceIds: ['proof-a', 'proof-b'],
    blockers: ['missing after state'],
  },
  verificationReceipt: {
    verdict: 'verified',
    committed: true,
    commitRef: 'abcdef1234567',
    editedFiles: ['/Users/private/secret-a.ts', '/Users/private/secret-b.ts'],
    checks: [
      { name: 'typecheck', passed: true },
      { name: 'tests', passed: false },
    ],
    summary: 'must not persist paths or check names',
  },
  toolPolicy: { approval: 'ask' },
  approvalRequest: { raw: 'hidden' },
  browserPlan: { url: 'https://private.example' },
  __o1RuntimeStatus: 'passed',
};

const sanitized = sanitize(metadata);
assert.ok(sanitized, 'recognized receipts produce a durable metadata subset');
assert.deepEqual(
  JSON.parse(JSON.stringify(sanitized)),
  {
    computerActionReceipt: {
      schemaVersion: 1,
      tool: 'desktop.click',
      surface: 'desktop',
      toolArgsFingerprint: exactFingerprint,
      handlerEnteredAt: '2026-07-24T14:00:00.000Z',
      outcome: 'succeeded',
      mutates: true,
      approvalRequired: true,
      iteration: 3,
      durationMs: 41,
    },
    mutationDispatchReceipt: {
      schemaVersion: 1,
      actionId: 'action-1',
      tool: 'desktop.click',
      epochId: 'epoch-1',
      authorizedAt: '2026-07-24T13:59:59.000Z',
      dispatchedAt: '2026-07-24T14:00:00.000Z',
    },
    computerAppVerificationReceipt: {
      schemaVersion: 1,
      actionId: 'action-1',
      beforeEpochId: 'epoch-1',
      afterEpochId: null,
      status: 'inconclusive',
      checkedAt: '2026-07-24T14:00:01.000Z',
      canComplete: false,
      evidenceCount: 2,
      blockerCount: 1,
    },
    verificationReceipt: {
      verdict: 'verified',
      committed: true,
      commitRef: 'abcdef1234567',
      editedFileCount: 2,
      checkCount: 2,
      passedCheckCount: 1,
      failedCheckCount: 1,
    },
  },
  'only explicit scalar receipt fields and derived counts survive',
);
assert.equal(
  sanitize({ toolPolicy: {}, browserPlan: {}, computerActionReceipt: { summary: 'only free-form' } }),
  undefined,
  'metadata is omitted when no recognized receipt field survives',
);
const mismatchedVerification = sanitize({
  mutationDispatchReceipt: {
    schemaVersion: 1,
    actionId: 'action-a',
    tool: 'desktop.click',
    epochId: 'epoch-a',
    authorizedAt: '2026-07-24T13:59:59.000Z',
    dispatchedAt: '2026-07-24T14:00:00.000Z',
  },
  computerAppVerificationReceipt: {
    schemaVersion: 1,
    actionId: 'action-b',
    beforeEpochId: 'epoch-a',
    afterEpochId: 'epoch-b',
    status: 'verified',
    checkedAt: '2026-07-24T14:00:01.000Z',
    canComplete: true,
    evidenceCount: 1,
    blockerCount: 0,
  },
});
assert.ok(mismatchedVerification?.mutationDispatchReceipt, 'a valid dispatch receipt remains available for outcome-unknown recovery');
assert.equal(mismatchedVerification?.computerAppVerificationReceipt, undefined, 'verification for another action is stripped before persistence');

const staleEpochVerification = sanitize({
  mutationDispatchReceipt: {
    schemaVersion: 1,
    actionId: 'action-a',
    tool: 'desktop.click',
    epochId: 'epoch-a',
    authorizedAt: '2026-07-24T13:59:59.000Z',
    dispatchedAt: '2026-07-24T14:00:00.000Z',
  },
  computerAppVerificationReceipt: {
    schemaVersion: 1,
    actionId: 'action-a',
    beforeEpochId: 'epoch-a',
    afterEpochId: 'epoch-a',
    status: 'verified',
    checkedAt: '2026-07-24T14:00:01.000Z',
    canComplete: true,
    evidenceCount: 1,
    blockerCount: 0,
  },
});
assert.equal(staleEpochVerification?.computerAppVerificationReceipt, undefined, 'same-epoch verification is stripped as stale proof');

const preDispatchVerification = sanitize({
  mutationDispatchReceipt: {
    schemaVersion: 1,
    actionId: 'action-a',
    tool: 'desktop.click',
    epochId: 'epoch-a',
    authorizedAt: '2026-07-24T13:59:59.000Z',
    dispatchedAt: '2026-07-24T14:00:00.000Z',
  },
  computerAppVerificationReceipt: {
    schemaVersion: 1,
    actionId: 'action-a',
    beforeEpochId: 'epoch-a',
    afterEpochId: 'epoch-b',
    status: 'verified',
    checkedAt: '2026-07-24T13:59:59.500Z',
    canComplete: true,
    evidenceCount: 1,
    blockerCount: 0,
  },
});
assert.equal(preDispatchVerification?.computerAppVerificationReceipt, undefined, 'pre-dispatch verification is stripped before persistence');
assert.doesNotThrow(() => {
  const hostileReceipt: Record<string, unknown> = { actionId: 'safe-action' };
  Object.defineProperty(hostileReceipt, 'tool', {
    enumerable: true,
    get() {
      throw new Error('hostile getter');
    },
  });
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  sanitize({ computerActionReceipt: hostileReceipt, unrelated: cyclic });
}, 'hostile getters and cyclic unrelated metadata do not break sanitization');

const hostileActionMetadata = sanitizeActionMetadata({
  computerActionReceipt: {
    schemaVersion: 1,
    actionId: 'hunter2',
    tool: '/Users/private/tool',
    status: '/Users/example/private.log',
    handlerEnteredAt: '/Users/example/private.log',
    toolArgsFingerprint: 'hunter2',
  },
  toolPolicy: {
    family: '/Users/private',
    approvalMode: 'ask',
    mutatesState: true,
    externalSideEffect: true,
    summary: 'hunter2',
  },
  approvalRequest: {
    id: 'hunter2',
    required: true,
    status: '/Users/private',
    raw: 'private request',
  },
  browserPlan: { task: 'hunter2', path: '/Users/private' },
});
assert.equal(hostileActionMetadata, undefined, 'invalid receipt/policy/action values are dropped entirely');
assert.equal(
  JSON.stringify(sanitizeActionMetadata({
    toolPolicy: {
      family: 'browser',
      approvalMode: 'ask',
      mutatesState: true,
      externalSideEffect: true,
      approvalKind: 'browser_action',
      summary: 'hunter2 /Users/private',
    },
    approvalRequest: {
      id: '018f47a2-4d5f-7abc-8def-1234567890ab',
      required: true,
      status: 'pending',
      raw: 'private request',
    },
    browserPlan: { task: 'hunter2' },
  })).includes('hunter2'),
  false,
  'valid action metadata keeps only controlled policy/correlation fields',
);

async function flushWrites(): Promise<void> {
  await new Promise<void>((resolveFlush) => setTimeout(resolveFlush, 0));
}

async function run(): Promise<void> {
  const handle = await createPersistedRun({
    circleId: 'circle-1',
    userId: 'user-1',
    surface: 'chat',
    title: 'event-receipt',
  });
  assert.ok(handle, 'mock persisted run was created');
  handle!.onEvent({
    kind: 'tool_call_result',
    iteration: 3,
    toolName: 'desktop.click',
    toolUseId: 'tool-use-1',
    result: { ok: true, data: { clicked: true }, metadata },
    durationMs: 41,
    dispatched: false,
  });
  await flushWrites();
  handle!.stopHeartbeat();

  const eventRow = inserted.find((row) =>
    row.table === 'agent_run_events'
      && row.payload.kind === 'tool_call_result'
      && (row.payload.payload as Record<string, unknown>)?.tool_use_id === 'tool-use-1'
  );
  assert.ok(eventRow, 'tool result event was written');
  const eventPayload = eventRow!.payload.payload as Record<string, unknown>;
  assert.equal(eventPayload.dispatched, false, 'pre-dispatch truth is durable');
  assert.ok(eventPayload.metadata, 'recognized receipt metadata is durable');
  assert.equal(
    JSON.stringify(eventPayload).includes(secretToken),
    false,
    'opaque action identifiers are dropped before the event bounder',
  );
  assert.equal(
    JSON.stringify(eventPayload).includes('/Users/private'),
    false,
    'raw file paths and receipt arrays do not reach the event row',
  );

  const noReceiptHandle = await createPersistedRun({
    circleId: 'circle-1',
    userId: 'user-1',
    surface: 'chat',
    title: 'no-receipt',
  });
  assert.ok(noReceiptHandle);
  noReceiptHandle!.onEvent({
    kind: 'tool_call_result',
    iteration: 1,
    toolName: 'browser.read',
    toolUseId: 'tool-use-2',
    result: { ok: true, data: {}, metadata: { browserPlan: { secret: true } } },
    durationMs: 2,
    dispatched: true,
  });
  await flushWrites();
  noReceiptHandle!.stopHeartbeat();
  const noReceiptRow = inserted.find((row) =>
    row.table === 'agent_run_events'
      && (row.payload.payload as Record<string, unknown>)?.tool_use_id === 'tool-use-2'
  );
  const noReceiptPayload = noReceiptRow!.payload.payload as Record<string, unknown>;
  assert.equal(noReceiptPayload.dispatched, true, 'handler-entry truth is durable');
  assert.equal(
    Object.prototype.hasOwnProperty.call(noReceiptPayload, 'metadata'),
    false,
    'unrecognized hidden metadata is omitted entirely',
  );

  const failedHandle = await createPersistedRun({
    circleId: 'circle-1',
    userId: 'user-1',
    surface: 'chat',
    title: 'failed-redaction',
  });
  assert.ok(failedHandle);
  failedHandle!.onEvent({
    kind: 'tool_call_result',
    iteration: 2,
    toolName: 'desktop.launch_app',
    toolUseId: 'tool-use-failed',
    result: {
      ok: false,
      error: '401 token=short-secret /Users/private/provider.log',
    },
    durationMs: 3,
    dispatched: true,
  });
  await flushWrites();
  failedHandle!.stopHeartbeat();
  const failedRow = inserted.find((row) =>
    row.table === 'agent_run_events'
      && (row.payload.payload as Record<string, unknown>)?.tool_use_id === 'tool-use-failed'
  );
  assert.ok(failedRow, 'failed tool result event was written');
  const failedPayload = failedRow!.payload.payload as Record<string, unknown>;
  const failedSerialized = JSON.stringify(failedPayload);
  assert.equal(failedPayload.error, PERSISTED_TOOL_FAILURE_TEXT, 'failed tool event uses fixed redacted copy');
  assert.equal(failedPayload.error_code, 'tool_call_failed', 'failed tool event has a stable error code');
  assert.equal(failedPayload.redacted, true, 'failed tool event declares redaction');
  assert.equal(failedSerialized.includes('short-secret'), false, 'failed tool event omits short provider secrets');
  assert.equal(failedSerialized.includes('/Users/private/provider.log'), false, 'failed tool event omits local paths');
  await failedHandle!.finalize({
    text: '',
    messages: [],
    iterations: 2,
    stopReason: 'error',
    hitMaxIterations: false,
  }, new Error('hunter2 /Users/private/provider.stack'));
  const failedAggregateUpdate = updated.find((row) =>
    row.table === 'agent_runs'
      && Array.isArray(row.payload.tool_calls)
      && (row.payload.tool_calls as Array<Record<string, unknown>>)[0]?.toolUseId === 'tool-use-failed'
  );
  assert.ok(failedAggregateUpdate, 'failed tool call is represented in the run aggregate');
  const failedAggregate = (failedAggregateUpdate!.payload.tool_calls as Array<Record<string, unknown>>)[0];
  assert.equal(failedAggregate.error, PERSISTED_TOOL_FAILURE_TEXT, 'failed run aggregate uses fixed redacted copy');
  assert.equal(JSON.stringify(failedAggregate).includes('short-secret'), false, 'failed run aggregate omits provider details');
  const terminalErrorRow = inserted.find((row) =>
    row.table === 'agent_run_events'
      && row.payload.kind === 'error'
      && (row.payload.payload as Record<string, unknown>)?.error_code === 'agent_run_failed'
  );
  assert.ok(terminalErrorRow, 'terminal adapter error is represented by a stable event');
  const terminalErrorSerialized = JSON.stringify(terminalErrorRow!.payload);
  assert.equal(terminalErrorSerialized.includes('hunter2'), false, 'terminal error omits raw exception messages');
  assert.equal(terminalErrorSerialized.includes('/Users/private'), false, 'terminal error omits local stack paths');

  const aggregateHandle = await createPersistedRun({
    circleId: 'circle-1',
    userId: 'user-1',
    surface: 'chat',
    title: 'aggregate-receipt',
    streamEvents: false,
  });
  assert.ok(aggregateHandle);
  aggregateHandle!.onEvent({
    kind: 'tool_call_result',
    iteration: 1,
    toolName: 'desktop.click',
    toolUseId: 'tool-use-3',
    result: { ok: true, data: {}, metadata },
    durationMs: 7,
    dispatched: false,
  });
  await aggregateHandle!.finalize({
    text: 'done',
    messages: [],
    iterations: 1,
    stopReason: 'end_turn',
    hitMaxIterations: false,
  });
  const aggregateUpdate = updated.find((row) =>
    row.table === 'agent_runs'
      && Array.isArray(row.payload.tool_calls)
      && (row.payload.tool_calls as Array<Record<string, unknown>>)[0]?.toolUseId === 'tool-use-3'
  );
  assert.ok(aggregateUpdate, 'run-level tool-call aggregate was finalized');
  const aggregate = (aggregateUpdate!.payload.tool_calls as Array<Record<string, unknown>>)[0];
  assert.equal(aggregate.dispatched, false, 'dispatched truth survives when event streaming is disabled');
  assert.ok(aggregate.metadata, 'receipt subset survives when event streaming is disabled');
  assert.equal(
    JSON.stringify(aggregate).includes(secretToken),
    false,
    'the real aggregate bounder masks secret-shaped values',
  );

  console.log('All agent run persistence receipt smoke assertions passed.');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
