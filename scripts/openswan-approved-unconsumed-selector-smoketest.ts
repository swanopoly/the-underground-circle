/**
 * Adversarial smoke for the approved-but-unconsumed OpenSwan recovery
 * selector. It imports the real service behind an inert Supabase stub, tests
 * the pure row boundary, and exercises pagination without touching a network.
 *
 * Run: npx tsx scripts/openswan-approved-unconsumed-selector-smoketest.ts
 */

import { registerHooks } from 'node:module';

process.env.EXPO_PUBLIC_SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL
  || 'https://approved-unconsumed-smoke.invalid.supabase.co';
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || 'approved-unconsumed-smoke-anon-key';

type QueryOperation = Readonly<{
  name: 'select' | 'eq' | 'is' | 'gte' | 'or' | 'order' | 'limit' | 'range';
  args: readonly unknown[];
}>;

type QueryRecord = Readonly<{
  table: string;
  operations: QueryOperation[];
}>;

const databaseState: {
  rows: unknown[];
  queries: QueryRecord[];
  executions: number;
  beforeExecute: ((execution: number, query: QueryRecord) => void) | null;
} = {
  rows: [],
  queries: [],
  executions: 0,
  beforeExecute: null,
};

function queryRowKey(value: unknown): { requestedAtMs: number; id: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const idDescriptor = Object.getOwnPropertyDescriptor(record, 'id');
  const requestedAtDescriptor = Object.getOwnPropertyDescriptor(record, 'requested_at');
  if (
    !idDescriptor
    || !('value' in idDescriptor)
    || typeof idDescriptor.value !== 'string'
    || !requestedAtDescriptor
    || !('value' in requestedAtDescriptor)
    || typeof requestedAtDescriptor.value !== 'string'
  ) return null;
  const requestedAtMs = Date.parse(requestedAtDescriptor.value);
  return Number.isFinite(requestedAtMs)
    ? { requestedAtMs, id: idDescriptor.value.toLowerCase() }
    : null;
}

function executeKeysetQuery(query: QueryRecord, limit: number): unknown[] {
  const execution = databaseState.executions;
  databaseState.executions += 1;
  databaseState.beforeExecute?.(execution, query);
  const requestedAtOrder = query.operations.find((operation) => (
    operation.name === 'order' && operation.args[0] === 'requested_at'
  ));
  const ascending = (requestedAtOrder?.args[1] as { ascending?: unknown } | undefined)?.ascending !== false;
  let rows = [...databaseState.rows].sort((left, right) => {
    const leftKey = queryRowKey(left);
    const rightKey = queryRowKey(right);
    if (!leftKey) return rightKey ? 1 : 0;
    if (!rightKey) return -1;
    const compared = leftKey.requestedAtMs - rightKey.requestedAtMs
      || (leftKey.id < rightKey.id ? -1 : leftKey.id > rightKey.id ? 1 : 0);
    return ascending ? compared : -compared;
  });
  const cursorOperation = query.operations.find((operation) => operation.name === 'or');
  if (cursorOperation) {
    const filter = String(cursorOperation.args[0] || '');
    const match = /^requested_at\.(gt|lt)\.([^,]+),and\(requested_at\.eq\.([^,]+),id\.(gt|lt)\.([^)]+)\)$/.exec(filter);
    if (!match || match[2] !== match[3] || match[1] !== match[4]) return [];
    const direction = match[1];
    const cursorRequestedAtMs = Date.parse(match[2]);
    const cursorId = match[5].toLowerCase();
    rows = rows.filter((row) => {
      const key = queryRowKey(row);
      if (!key) return false;
      const compared = key.requestedAtMs - cursorRequestedAtMs
        || (key.id < cursorId ? -1 : key.id > cursorId ? 1 : 0);
      return direction === 'gt' ? compared > 0 : compared < 0;
    });
  }
  return rows.slice(0, limit);
}

const inertSupabase = {
  from(table: string) {
    const query: QueryRecord = { table, operations: [] };
    databaseState.queries.push(query);
    const chain = {
      select(...args: unknown[]) {
        query.operations.push({ name: 'select', args });
        return chain;
      },
      eq(...args: unknown[]) {
        query.operations.push({ name: 'eq', args });
        return chain;
      },
      is(...args: unknown[]) {
        query.operations.push({ name: 'is', args });
        return chain;
      },
      gte(...args: unknown[]) {
        query.operations.push({ name: 'gte', args });
        return chain;
      },
      or(...args: unknown[]) {
        query.operations.push({ name: 'or', args });
        return chain;
      },
      order(...args: unknown[]) {
        query.operations.push({ name: 'order', args });
        return chain;
      },
      limit(count: number) {
        query.operations.push({ name: 'limit', args: [count] });
        return Promise.resolve({
          data: executeKeysetQuery(query, count),
          error: null,
        });
      },
      range(from: number, to: number) {
        query.operations.push({ name: 'range', args: [from, to] });
        return Promise.resolve({
          data: databaseState.rows.slice(from, to + 1),
          error: null,
        });
      },
    };
    return chain;
  },
};

const NATIVE_STUBS = new Set(['react-native', '@react-native-async-storage/async-storage']);
const NATIVE_STUB_URL = new URL('./native-module-stub.mjs', import.meta.url).href;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (NATIVE_STUBS.has(specifier)) return { url: NATIVE_STUB_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '22222222-2222-4222-8222-222222222222';
const CIRCLE_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_CIRCLE_ID = '44444444-4444-4444-8444-444444444444';
const FIXED_NOW = Date.parse('2026-08-13T16:00:00.000Z');
const APPROVAL_DIGEST = `approval-v2:sha256:${'a'.repeat(64)}`;
const AUTHORITY_DIGEST = `authority-v2:sha256:${'b'.repeat(64)}`;

let assertions = 0;
let failures = 0;

function assert(condition: unknown, message: string, detail?: string): void {
  assertions += 1;
  if (condition) console.log(`pass: ${message}`);
  else {
    failures += 1;
    console.error(`FAIL: ${message}${detail ? ` — ${detail}` : ''}`);
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, '0')}`;
}

function approvalPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    approvalSchemaVersion: 2,
    toolName: 'browser.click',
    toolApprovalDigest: APPROVAL_DIGEST,
    toolApprovalKey: APPROVAL_DIGEST,
    toolApprovalKeyVersion: 2,
    policyFamily: 'browser',
    approvalMode: 'ask',
    mutatesState: true,
    externalSideEffect: false,
    ...overrides,
  };
}

function approvalRow(
  sequence: number,
  overrides: Record<string, unknown> = {},
  nowMs = FIXED_NOW,
): Record<string, unknown> {
  const requestedAtMs = nowMs - 20_000;
  return {
    id: uuid(sequence),
    run_id: uuid(900_000 + sequence),
    circle_id: CIRCLE_ID,
    approval_kind: 'browser_action',
    title: 'Click the reviewed control',
    description: null,
    payload: approvalPayload(),
    status: 'approved',
    requested_by: USER_ID,
    requested_at: iso(requestedAtMs),
    resolved_by: USER_ID,
    resolved_at: iso(requestedAtMs + 1_000),
    timeout_seconds: 60,
    ...overrides,
  };
}

function staleRow(sequence: number, nowMs: number, ageMs: number): Record<string, unknown> {
  const requestedAtMs = nowMs - ageMs;
  return approvalRow(sequence, {
    requested_at: iso(requestedAtMs),
    resolved_at: iso(requestedAtMs),
    timeout_seconds: 1,
  }, nowMs);
}

function operationExists(
  query: QueryRecord | undefined,
  name: QueryOperation['name'],
  ...args: unknown[]
): boolean {
  return !!query?.operations.some((operation) => (
    operation.name === name
    && JSON.stringify(operation.args) === JSON.stringify(args)
  ));
}

function resetDatabase(
  rows: unknown[],
  beforeExecute: ((execution: number, query: QueryRecord) => void) | null = null,
): void {
  databaseState.rows = rows;
  databaseState.queries = [];
  databaseState.executions = 0;
  databaseState.beforeExecute = beforeExecute;
}

async function main(): Promise<void> {
  // Replace only this process's inert client's query entrypoint. The service
  // then imports the same cached object; no request can reach the network.
  const { supabase } = await import('../src/lib/supabase');
  Object.defineProperty(supabase, 'from', {
    value: inertSupabase.from.bind(inertSupabase),
    configurable: true,
  });
  const service = await import('../src/services/runApprovalsService');
  const select = service.selectApprovedUnconsumedRunApprovals;

  const selected = (rows: readonly unknown[], nowMs = FIXED_NOW) => select({
    circleId: CIRCLE_ID,
    userId: USER_ID,
    nowMs,
    rows,
  });

  // Exact happy path and trust-scope checks.
  assert(select(null as never).length === 0, 'malformed selector input fails closed');
  assert(selected([approvalRow(1)]).length === 1, 'canonical live ask row is selected');
  assert(
    selected([approvalRow(2, { resolved_by: OTHER_USER_ID })]).length === 0,
    'approval resolved by a different member is rejected',
  );
  assert(
    selected([approvalRow(3, { requested_by: OTHER_USER_ID })]).length === 0,
    'approval requested by a different user is rejected',
  );
  assert(
    selected([approvalRow(4, { circle_id: OTHER_CIRCLE_ID })]).length === 0,
    'approval from a different circle is rejected',
  );

  // Malformed transport rows fail closed. An accessor is rejected without
  // invoking attacker-controlled code during boundary parsing.
  let getterCalls = 0;
  const accessorPayload = approvalPayload();
  Object.defineProperty(accessorPayload, 'toolName', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'browser.click';
    },
  });
  const malformedRows: unknown[] = [
    null,
    [],
    approvalRow(5, { id: 'not-a-uuid' }),
    approvalRow(6, { run_id: 'not-a-uuid' }),
    approvalRow(7, { approval_kind: 'root_shell' }),
    approvalRow(8, { resolved_at: null }),
    approvalRow(9, { timeout_seconds: 1.5 }),
    approvalRow(10, { payload: approvalPayload({ unexpectedMutationValue: 'secret' }) }),
    approvalRow(11, { payload: accessorPayload }),
    Object.assign(Object.create({ inherited: true }), approvalRow(12)),
    approvalRow(120, { title: 'x'.repeat(241) }),
    approvalRow(121, { description: 'x'.repeat(501) }),
  ];
  assert(selected(malformedRows).length === 0, 'malformed and non-canonical rows all fail closed');
  assert(getterCalls === 0, 'payload accessors are never invoked');

  // Only explicit ask authority is recoverable; status or payload auto modes
  // cannot leak into the user-approved continuation lane.
  assert(
    selected([approvalRow(13, { status: 'auto_approved' })]).length === 0,
    'auto_approved status is excluded',
  );
  assert(
    selected([approvalRow(14, {
      payload: approvalPayload({ approvalMode: 'auto', autoApproveCategory: 'browser_click' }),
    })]).length === 0,
    'canonical auto-mode payload is excluded',
  );

  // PostgreSQL `payload->>key IS NULL` intentionally overfetches absent and
  // JSON-null keys. The pure selector admits only structurally absent keys.
  assert(
    selected([approvalRow(15, { payload: approvalPayload() })]).length === 1,
    'all three absent dispatch fields represent unconsumed authority',
  );
  for (const dispatchKey of [
    'dispatchReceiptSchemaVersion',
    'dispatchBindingDigest',
    'dispatchConsumedAt',
  ]) {
    assert(
      selected([approvalRow(16, { payload: approvalPayload({ [dispatchKey]: null }) })]).length === 0,
      `present JSON null ${dispatchKey} is rejected`,
    );
  }
  assert(
    selected([approvalRow(17, {
      payload: approvalPayload({
        dispatchReceiptSchemaVersion: 2,
        dispatchBindingDigest: AUTHORITY_DIGEST,
        dispatchConsumedAt: iso(FIXED_NOW - 1_000),
      }),
    })]).length === 0,
    'canonical consumed receipt is rejected',
  );

  // Time boundaries are half-open: resolution and selection must both occur
  // strictly before requested_at + timeout_seconds.
  const ttlRequestedAt = FIXED_NOW - 60_000;
  assert(
    selected([approvalRow(18, {
      requested_at: iso(ttlRequestedAt),
      resolved_at: iso(ttlRequestedAt + 1_000),
      timeout_seconds: 60,
    })]).length === 0,
    'now equal to expiry is rejected',
  );
  assert(
    selected([approvalRow(19, {
      requested_at: iso(FIXED_NOW - 10_000),
      resolved_at: iso(FIXED_NOW),
      timeout_seconds: 10,
    })]).length === 0,
    'resolved_at equal to expiry is rejected',
  );
  assert(
    selected([approvalRow(20, {
      requested_at: iso(FIXED_NOW - 10_000),
      resolved_at: iso(FIXED_NOW - 11_000),
      timeout_seconds: 60,
    })]).length === 0,
    'resolution before request is rejected',
  );
  assert(
    selected([approvalRow(21, {
      requested_at: iso(FIXED_NOW),
      resolved_at: iso(FIXED_NOW),
      timeout_seconds: 1,
    })]).length === 1,
    'requested/resolved equality is live while expiry remains in the future',
  );

  // Duplicate primary keys collapse to one result; output ordering is oldest
  // first with id as a stable tie-breaker, regardless of input order.
  const tiedA = approvalRow(30, {
    requested_at: iso(FIXED_NOW - 40_000),
    resolved_at: iso(FIXED_NOW - 39_000),
  });
  const tiedB = approvalRow(31, {
    requested_at: iso(FIXED_NOW - 40_000),
    resolved_at: iso(FIXED_NOW - 39_000),
  });
  const newer = approvalRow(32, {
    requested_at: iso(FIXED_NOW - 30_000),
    resolved_at: iso(FIXED_NOW - 29_000),
  });
  const ordered = selected([newer, tiedB, tiedA, structuredClone(tiedA)]);
  assert(ordered.length === 3, 'duplicate approval ids are emitted once');
  assert(
    JSON.stringify(ordered.map((row) => row.id)) === JSON.stringify([uuid(30), uuid(31), uuid(32)]),
    'results are deterministic oldest-first with id tie-break',
  );
  const microEarlier = approvalRow(35, {
    requested_at: '2026-08-13T15:59:20.123001Z',
    resolved_at: '2026-08-13T15:59:21.000000Z',
  });
  const microLaterWithLowerId = approvalRow(34, {
    requested_at: '2026-08-13T15:59:20.123002Z',
    resolved_at: '2026-08-13T15:59:21.000000Z',
  });
  assert(
    JSON.stringify(selected([microLaterWithLowerId, microEarlier]).map((row) => row.id))
      === JSON.stringify([uuid(35), uuid(34)]),
    'PostgreSQL microsecond order wins before the UUID tie-breaker',
  );

  // More than the former 128-candidate window may be stale. The production
  // reader keeps paging until it reaches the valid row or server exhaustion.
  const liveNow = Date.now();
  const staleFlood = Array.from({ length: 160 }, (_, index) => (
    staleRow(1_000 + index, liveNow, (1_000 + index) * 1_000)
  ));
  const liveAfterFlood = approvalRow(2_000, {
    requested_at: iso(liveNow - 200_000),
    resolved_at: iso(liveNow - 199_000),
    timeout_seconds: 600,
  }, liveNow);
  resetDatabase([...staleFlood, liveAfterFlood]);
  const recoveredAfterFlood = await service.getApprovedUnconsumedRunApprovals(CIRCLE_ID, USER_ID);
  assert(
    recoveredAfterFlood.length === 1 && recoveredAfterFlood[0]?.id === liveAfterFlood.id,
    'a valid row after more than 128 stale candidates is recovered',
  );
  assert(databaseState.queries.length === 6, 'stale flood reads six 32-row pages through exhaustion');

  const firstQuery = databaseState.queries[0];
  assert(operationExists(firstQuery, 'eq', 'circle_id', CIRCLE_ID), 'query prefilters exact circle');
  assert(operationExists(firstQuery, 'eq', 'requested_by', USER_ID), 'query prefilters exact requester');
  assert(operationExists(firstQuery, 'eq', 'resolved_by', USER_ID), 'query prefilters exact resolver');
  assert(operationExists(firstQuery, 'eq', 'status', 'approved'), 'query prefilters approved status');
  assert(operationExists(firstQuery, 'eq', 'payload->>approvalMode', 'ask'), 'query prefilters ask mode');
  for (const dispatchKey of [
    'dispatchReceiptSchemaVersion',
    'dispatchBindingDigest',
    'dispatchConsumedAt',
  ]) {
    assert(
      operationExists(firstQuery, 'is', `payload->>${dispatchKey}`, null),
      `query overfetches absent/JSON-null ${dispatchKey} for strict local parsing`,
    );
  }
  assert(
    operationExists(firstQuery, 'order', 'requested_at', { ascending: true })
      && operationExists(firstQuery, 'order', 'id', { ascending: true }),
    'approved recovery orders globally by requested_at then UUID ascending',
  );
  assert(operationExists(firstQuery, 'limit', 32), 'approved recovery uses a bounded keyset page');
  assert(!firstQuery?.operations.some((operation) => operation.name === 'range'), 'approved recovery never uses a shifting offset');

  // More than one page may share the exact same requested_at. The UUID is a
  // real server-side tie-breaker, not merely a final local sort.
  const equalRequestedAt = iso(liveNow - 300_000);
  const equalTimeHostile = Array.from({ length: 40 }, (_, index) => approvalRow(3_000 + index, {
    requested_at: equalRequestedAt,
    resolved_at: iso(liveNow - 299_000),
    timeout_seconds: 600,
    title: 'x'.repeat(241),
  }, liveNow));
  const liveAfterEqualTime = approvalRow(4_000, {
    requested_at: iso(liveNow - 200_000),
    resolved_at: iso(liveNow - 199_000),
    timeout_seconds: 600,
  }, liveNow);
  resetDatabase([...equalTimeHostile].reverse().concat(liveAfterEqualTime));
  const recoveredAfterEqualTime = await service.getApprovedUnconsumedRunApprovals(CIRCLE_ID, USER_ID);
  assert(
    recoveredAfterEqualTime.length === 1 && recoveredAfterEqualTime[0]?.id === liveAfterEqualTime.id,
    'more than 32 equal-time hostile rows cannot hide the later valid row',
  );
  assert(databaseState.queries.length === 2, 'equal-time recovery advances to its second keyset page');
  assert(
    operationExists(
      databaseState.queries[1],
      'or',
      `requested_at.gt.${equalRequestedAt},and(requested_at.eq.${equalRequestedAt},id.gt.${uuid(3_031)})`,
    ),
    'second approved page resumes after the exact timestamp and UUID pair',
  );

  // Consuming/removing the first page while the second request is being made
  // must not make the reader skip what shifted into the old offset window.
  const shrinkRows = [...equalTimeHostile];
  const removedIds = new Set(shrinkRows.slice(0, 32).map((row) => String(row.id)));
  resetDatabase([...shrinkRows, liveAfterEqualTime], (execution) => {
    if (execution !== 1) return;
    databaseState.rows = databaseState.rows.filter((row) => {
      const key = queryRowKey(row);
      return !key || !removedIds.has(key.id);
    });
  });
  const recoveredAfterShrink = await service.getApprovedUnconsumedRunApprovals(CIRCLE_ID, USER_ID);
  assert(
    recoveredAfterShrink.length === 1 && recoveredAfterShrink[0]?.id === liveAfterEqualTime.id,
    'concurrent first-page consumption cannot skip the later valid row',
  );
  assert(databaseState.queries.length === 2, 'concurrent shrink still reaches server exhaustion in two keyset pages');

  // Pending rows use the inverse keyset order. More than the former 256-row
  // scan can be expired while an older, long-lived row still needs to render.
  const expiredPending = Array.from({ length: 300 }, (_, index) => approvalRow(5_000 + index, {
    status: 'pending',
    requested_at: iso(liveNow - (1_000 + index * 1_000)),
    resolved_by: null,
    resolved_at: null,
    timeout_seconds: 1,
  }, liveNow));
  const olderLivePending = approvalRow(6_000, {
    status: 'pending',
    requested_at: iso(liveNow - 7_200_000),
    resolved_by: null,
    resolved_at: null,
    timeout_seconds: 86_400,
  }, liveNow);
  resetDatabase([...expiredPending, olderLivePending]);
  const pendingAfterExpiredFlood = await service.getPendingRunApprovals(CIRCLE_ID, USER_ID);
  assert(
    pendingAfterExpiredFlood.length === 1 && pendingAfterExpiredFlood[0]?.id === olderLivePending.id,
    'older live pending approval survives more than 256 newer expired rows',
  );
  assert(databaseState.queries.length === 10, 'pending reader reaches the tenth descending keyset page');
  const pendingFirstQuery = databaseState.queries[0];
  assert(
    operationExists(pendingFirstQuery, 'order', 'requested_at', { ascending: false })
      && operationExists(pendingFirstQuery, 'order', 'id', { ascending: false }),
    'pending reader orders by requested_at then UUID descending',
  );
  assert(operationExists(pendingFirstQuery, 'limit', 32), 'pending reader uses a bounded keyset page');
  assert(!pendingFirstQuery?.operations.some((operation) => operation.name === 'range'), 'pending reader never uses a shifting offset');
  assert(
    databaseState.queries.slice(1).every((query) => query.operations.some((operation) => (
      operation.name === 'or' && String(operation.args[0]).includes('requested_at.lt.')
    ))),
    'every later pending page carries a strict descending keyset predicate',
  );

  let pendingGetterCalls = 0;
  const hostilePending = approvalRow(6_001, {
    status: 'pending',
    requested_at: iso(liveNow - 1_000),
    resolved_by: null,
    resolved_at: null,
    timeout_seconds: 60,
  }, liveNow);
  Object.defineProperty(hostilePending, 'title', {
    enumerable: true,
    get() {
      pendingGetterCalls += 1;
      return 'attacker controlled';
    },
  });
  resetDatabase([hostilePending]);
  assert(
    (await service.getPendingRunApprovals(CIRCLE_ID, USER_ID)).length === 0,
    'hostile pending transport row fails the typed page closed',
  );
  assert(pendingGetterCalls === 0, 'pending row accessors are never invoked');

  const pendingCeilingExpired = Array.from({ length: 2_048 }, (_, index) => approvalRow(30_000 + index, {
    status: 'pending',
    requested_at: iso(liveNow - (1_000 + index * 1_000)),
    resolved_by: null,
    resolved_at: null,
    timeout_seconds: 1,
  }, liveNow));
  const pendingBeyondCeiling = approvalRow(40_000, {
    status: 'pending',
    requested_at: iso(liveNow - 7_200_000),
    resolved_by: null,
    resolved_at: null,
    timeout_seconds: 86_400,
  }, liveNow);
  resetDatabase([...pendingCeilingExpired, pendingBeyondCeiling]);
  const pendingCeilingResult = await service.getPendingRunApprovals(CIRCLE_ID, USER_ID);
  assert(pendingCeilingResult.length === 0, 'pending 2,048-candidate ceiling fails closed without a partial slice');
  assert(databaseState.queries.length === 64, 'pending ceiling stops after exactly 64 keyset pages');

  // Hard ceiling: if 2,048 server-filtered candidates do not yield 16 valid
  // rows and the server still has another page, return no partial selection.
  const ceilingRequestedAt = iso(liveNow - 3_000_000);
  const ceilingStale = Array.from({ length: 2_048 }, (_, index) => approvalRow(10_000 + index, {
    requested_at: ceilingRequestedAt,
    resolved_at: iso(liveNow - 2_999_000),
    timeout_seconds: 3_600,
    title: 'x'.repeat(241),
  }, liveNow));
  const liveBeyondCeiling = approvalRow(20_000, {
    requested_at: iso(liveNow - 500),
    resolved_at: iso(liveNow - 500),
    timeout_seconds: 3_600,
  }, liveNow);
  resetDatabase([...ceilingStale, liveBeyondCeiling]);
  const ceilingResult = await service.getApprovedUnconsumedRunApprovals(CIRCLE_ID, USER_ID);
  assert(ceilingResult.length === 0, 'candidate ceiling fails closed without a partial result');
  assert(databaseState.queries.length === 64, 'candidate ceiling stops after exactly 64 pages');
  assert(
    operationExists(databaseState.queries.at(-1), 'limit', 32)
      && !databaseState.queries.at(-1)?.operations.some((operation) => operation.name === 'range'),
    'candidate ceiling stops on the 64th bounded keyset page without fetching by offset',
  );

  assert(
    selected([...ceilingStale, liveBeyondCeiling], liveNow).length === 0,
    'pure selector also rejects inputs beyond the 2,048-candidate safety bound',
  );

  if (failures > 0) {
    console.error(`\n${failures} of ${assertions} approved-unconsumed selector assertions failed.`);
    process.exit(1);
  }
  console.log(`\nAll ${assertions} approved-unconsumed selector assertions passed.`);
}

void main();
