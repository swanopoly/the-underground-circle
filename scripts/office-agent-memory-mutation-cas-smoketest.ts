import assert from 'node:assert/strict';
import {
  createAgentMemoryCasRequest,
  executeAgentMemoryCasMutation,
  type AgentMemoryCasRequest,
  type AgentMemoryMutationTransportResult,
} from '../src/screens/circles/tabs/office/agentMemoryMutationCore';

let assertions = 0;
function check(condition: unknown, message: string): void {
  assertions += 1;
  assert(condition, message);
}

const baseRow: Record<string, unknown> = {
  id: 'memory-a',
  circle_id: 'circle-a',
  user_id: 'user-a',
  scope: 'agent',
  visibility: 'private',
  is_active: true,
  title: 'Verified memory',
  content: 'observed content',
  embedding: [0.1, 0.2],
  pinned: false,
  retrieval_mode: 'on_demand',
  importance: 0.5,
  updated_at: '2026-08-18T12:00:00.000Z',
};

function exactFakeServer(initialRow: Record<string, unknown> | null) {
  let row = initialRow ? { ...initialRow } : null;
  const execute = async (request: AgentMemoryCasRequest): Promise<AgentMemoryMutationTransportResult> => {
    const matches = !!row
      && row.id === request.id
      && row.circle_id === request.circleId
      && row.user_id === request.userId
      && row.scope === request.scope
      && row.visibility === request.visibility
      && row.is_active === true
      && row.updated_at === request.expectedUpdatedAt;
    if (!matches) return { data: [], status: 200 };
    row = { ...row, ...request.patch };
    return { data: [{ ...row }], status: 200 };
  };
  return {
    execute,
    read: () => row ? { ...row } : null,
    replace: (next: Record<string, unknown> | null) => { row = next ? { ...next } : null; },
  };
}

async function main(): Promise<void> {
  const editRequest = createAgentMemoryCasRequest(
    baseRow,
    { content: 'my safe edit', embedding: null },
    Date.parse('2026-08-18T12:00:01.000Z'),
  );
  check(!!editRequest, 'a verified owner-private active row produces a CAS request');
  check(editRequest?.expectedUpdatedAt === baseRow.updated_at, 'the request carries the exact observed version');
  check(editRequest?.nextUpdatedAt === '2026-08-18T12:00:01.000Z', 'the request carries a distinct next version');
  check(editRequest?.patch.updated_at === editRequest?.nextUpdatedAt, 'the returned postcondition version is part of the requested patch');

  const editServer = exactFakeServer(baseRow);
  const editOutcome = await executeAgentMemoryCasMutation(editRequest!, editServer.execute, () => true);
  check(editOutcome.kind === 'success', 'an exact-version edit with one exact receipt succeeds');
  check(editServer.read()?.content === 'my safe edit', 'the exact server applies the requested content');
  check(editServer.read()?.embedding === null, 'editing invalidates the stale embedding in the same CAS');

  // Behavioral lost-update regression: the draft was based on baseRow, but a
  // Realtime writer changes the server before Save. The captured old request
  // must update zero rows and preserve the other writer's content.
  const staleServer = exactFakeServer({
    ...baseRow,
    content: 'newer teammate content',
    updated_at: '2026-08-18T12:00:00.500Z',
  });
  const staleOutcome = await executeAgentMemoryCasMutation(editRequest!, staleServer.execute, () => true);
  check(staleOutcome.kind === 'conflict', 'a stale observed version is a conflict, never success');
  check(staleServer.read()?.content === 'newer teammate content', 'a stale edit cannot overwrite the newer server row');

  const missingServer = exactFakeServer(null);
  const missingOutcome = await executeAgentMemoryCasMutation(editRequest!, missingServer.execute, () => true);
  check(missingOutcome.kind === 'conflict', 'an exact update returning zero rows is an explicit conflict');

  const deleteRequest = createAgentMemoryCasRequest(baseRow, { is_active: false }, Date.parse('2026-08-18T12:00:02.000Z'))!;
  const deleteServer = exactFakeServer(baseRow);
  const deleteOutcome = await executeAgentMemoryCasMutation(deleteRequest, deleteServer.execute, () => true);
  check(deleteOutcome.kind === 'success', 'an exact delete tombstone succeeds with one receipt');
  check(deleteServer.read()?.is_active === false, 'the delete postcondition is verified inactive');
  const replayOutcome = await executeAgentMemoryCasMutation(deleteRequest, deleteServer.execute, () => true);
  check(replayOutcome.kind === 'conflict', 'replaying a consumed active/version predicate cannot report success');

  const pinRequest = createAgentMemoryCasRequest(baseRow, { pinned: true }, Date.parse('2026-08-18T12:00:03.000Z'))!;
  const pinOutcome = await executeAgentMemoryCasMutation(pinRequest, exactFakeServer(baseRow).execute, () => true);
  check(pinOutcome.kind === 'success' && pinOutcome.row.pinned === true, 'pin verifies its requested field');

  const promoteRequest = createAgentMemoryCasRequest(baseRow, {
    pinned: true,
    retrieval_mode: 'startup',
    importance: 0.95,
  }, Date.parse('2026-08-18T12:00:04.000Z'))!;
  const promoteOutcome = await executeAgentMemoryCasMutation(promoteRequest, exactFakeServer(baseRow).execute, () => true);
  check(
    promoteOutcome.kind === 'success'
      && promoteOutcome.row.pinned === true
      && promoteOutcome.row.retrieval_mode === 'startup'
      && promoteOutcome.row.importance === 0.95,
    'promote requires every requested postcondition field',
  );

  const mismatchedReceipt = await executeAgentMemoryCasMutation(
    pinRequest,
    async request => ({ data: [{ ...baseRow, ...request.patch, pinned: false }], status: 200 }),
    () => true,
  );
  check(mismatchedReceipt.kind === 'outcome_unknown', 'a mismatched one-row receipt is outcome unknown');
  const multipleReceipts = await executeAgentMemoryCasMutation(
    pinRequest,
    async request => ({ data: [
      { ...baseRow, ...request.patch },
      { ...baseRow, ...request.patch },
    ], status: 200 }),
    () => true,
  );
  check(multipleReceipts.kind === 'outcome_unknown', 'multiple receipts are outcome unknown, never success');
  const malformedReceipt = await executeAgentMemoryCasMutation(
    pinRequest,
    async () => ({ data: null, status: 200 }),
    () => true,
  );
  check(malformedReceipt.kind === 'outcome_unknown', 'a malformed 2xx receipt is outcome unknown');

  const rejected = await executeAgentMemoryCasMutation(
    pinRequest,
    async () => ({ data: null, error: { message: 'forbidden' }, status: 403 }),
    () => true,
  );
  check(rejected.kind === 'failure', 'a definite 4xx rejection is distinct from conflict and unknown');
  const serverAmbiguous = await executeAgentMemoryCasMutation(
    pinRequest,
    async () => ({ data: null, error: { message: 'gateway reset' }, status: 503 }),
    () => true,
  );
  check(serverAmbiguous.kind === 'outcome_unknown', 'an ambiguous server/transport error is outcome unknown');
  const thrownTransport = await executeAgentMemoryCasMutation(
    pinRequest,
    async () => { throw new Error('connection reset after dispatch'); },
    () => true,
  );
  check(thrownTransport.kind === 'outcome_unknown', 'a thrown transport after dispatch is outcome unknown');

  let dispatched = false;
  const staleAuthority = await executeAgentMemoryCasMutation(
    pinRequest,
    async () => { dispatched = true; return { data: [], status: 200 }; },
    () => false,
  );
  check(staleAuthority.kind === 'failure' && !dispatched, 'stale authority prevents dispatch entirely');
  let authorityChecks = 0;
  const changedAuthority = await executeAgentMemoryCasMutation(
    pinRequest,
    async request => ({ data: [{ ...baseRow, ...request.patch }], status: 200 }),
    () => { authorityChecks += 1; return authorityChecks === 1; },
  );
  check(changedAuthority.kind === 'outcome_unknown', 'authority retirement after dispatch blocks receipt publication');

  check(createAgentMemoryCasRequest({ ...baseRow, updated_at: null }, { pinned: true }) === null, 'a row without an exact version is not writable');
  check(createAgentMemoryCasRequest({ ...baseRow, visibility: 'circle_shared' }, { pinned: true }) === null, 'a shared row is not writable from the private panel');
  check(createAgentMemoryCasRequest({ ...baseRow, is_active: false }, { pinned: true }) === null, 'an inactive row is not writable');
  check(createAgentMemoryCasRequest(baseRow, { user_id: 'attacker' }) === null, 'identity fields cannot enter a mutation patch');
  check(createAgentMemoryCasRequest(baseRow, {}) === null, 'an empty mutation patch is rejected');
  check(createAgentMemoryCasRequest(baseRow, { embedding: [0.4] }) === null, 'the panel can clear but cannot inject an unverified embedding');
  check(createAgentMemoryCasRequest(baseRow, { importance: Number.NaN }) === null, 'non-finite requested values are rejected');
  check(createAgentMemoryCasRequest(baseRow, { pinned: true }, Number.MAX_VALUE) === null, 'an out-of-range local clock cannot throw or dispatch');

  const futureVersion = createAgentMemoryCasRequest(
    { ...baseRow, updated_at: '2026-08-18T12:00:10.000Z' },
    { pinned: true },
    Date.parse('2026-08-18T12:00:00.000Z'),
  );
  check(futureVersion?.nextUpdatedAt === '2026-08-18T12:00:10.001Z', 'the next CAS version stays monotonic when the client clock trails');

  console.log(`office agent memory mutation CAS smoke passed (${assertions} assertions)`);
}

void main();
