export type WritableAgentMemoryScope = 'agent' | 'user' | 'session';

export type AgentMemoryMutationPatch = Readonly<Record<string, unknown>>;

export interface AgentMemoryCasRequest {
  id: string;
  circleId: string;
  userId: string;
  scope: WritableAgentMemoryScope;
  visibility: 'private';
  expectedUpdatedAt: string;
  nextUpdatedAt: string;
  patch: AgentMemoryMutationPatch;
}

export interface AgentMemoryMutationTransportResult {
  data: unknown;
  error?: unknown;
  status?: number;
}

export type AgentMemoryMutationOutcome =
  | { kind: 'success'; row: Record<string, unknown> }
  | { kind: 'conflict'; reason: 'stale_version_or_missing_row' }
  | { kind: 'failure'; reason: 'invalid_request' | 'authority_stale' | 'server_rejected' }
  | { kind: 'outcome_unknown'; reason: 'transport' | 'authority_changed' | 'invalid_receipt' };

const ALLOWED_PATCH_FIELDS = new Set([
  'content',
  'embedding',
  'is_active',
  'pinned',
  'retrieval_mode',
  'importance',
]);

function isAllowedPatchValue(field: string, value: unknown): boolean {
  if (!ALLOWED_PATCH_FIELDS.has(field)) return false;
  if (field === 'content') return typeof value === 'string';
  if (field === 'embedding') return value === null;
  if (field === 'is_active') return value === false;
  if (field === 'pinned') return typeof value === 'boolean';
  if (field === 'retrieval_mode') return value === 'startup';
  return field === 'importance'
    && typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= 1;
}

function exactString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestampMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function sameRequestedValue(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'number' && typeof expected === 'number') {
    return Number.isFinite(actual) && Number.isFinite(expected) && Object.is(actual, expected);
  }
  return Object.is(actual, expected);
}

/**
 * Build a compare-and-swap request from one row in the verified panel snapshot.
 * The next timestamp is monotonic even when the local clock trails the server.
 */
export function createAgentMemoryCasRequest(
  row: Record<string, unknown>,
  patch: AgentMemoryMutationPatch,
  nowMs = Date.now(),
): AgentMemoryCasRequest | null {
  const id = exactString(row.id);
  const circleId = exactString(row.circle_id);
  const userId = exactString(row.user_id);
  const scope = exactString(row.scope);
  const visibility = exactString(row.visibility);
  const expectedUpdatedAt = exactString(row.updated_at);
  const expectedUpdatedAtMs = timestampMs(expectedUpdatedAt);
  const patchEntries = Object.entries(patch);
  if (
    !id
    || !circleId
    || !userId
    || !['agent', 'user', 'session'].includes(scope)
    || visibility !== 'private'
    || row.is_active !== true
    || expectedUpdatedAtMs === null
    || !Number.isFinite(nowMs)
    || patchEntries.length === 0
    || patchEntries.some(([field, value]) => !isAllowedPatchValue(field, value))
  ) return null;

  const nextUpdatedAtMs = Math.max(Math.trunc(nowMs), expectedUpdatedAtMs + 1);
  if (!Number.isFinite(new Date(nextUpdatedAtMs).getTime())) return null;
  const nextUpdatedAt = new Date(nextUpdatedAtMs).toISOString();
  return {
    id,
    circleId,
    userId,
    scope: scope as WritableAgentMemoryScope,
    visibility: 'private',
    expectedUpdatedAt,
    nextUpdatedAt,
    patch: Object.freeze({ ...patch, updated_at: nextUpdatedAt }),
  };
}

function hasExactPostcondition(
  row: Record<string, unknown>,
  request: AgentMemoryCasRequest,
): boolean {
  if (
    exactString(row.id) !== request.id
    || exactString(row.circle_id) !== request.circleId
    || exactString(row.user_id) !== request.userId
    || exactString(row.scope) !== request.scope
    || exactString(row.visibility) !== request.visibility
    || timestampMs(row.updated_at) !== timestampMs(request.nextUpdatedAt)
  ) return false;

  return Object.entries(request.patch).every(([field, expected]) => (
    Object.prototype.hasOwnProperty.call(row, field)
    && (
      field === 'updated_at'
        ? timestampMs(row[field]) === timestampMs(expected)
        : sameRequestedValue(row[field], expected)
    )
  ));
}

function isDefiniteServerRejection(result: AgentMemoryMutationTransportResult): boolean {
  const status = Number(result.status);
  return Number.isInteger(status) && status >= 400 && status < 500;
}

/**
 * Executes one exact memory compare-and-swap. A zero-row 2xx is a conflict,
 * never success. Malformed/multiple receipts and ambiguous transport failures
 * are outcome-unknown because the server may have committed the mutation.
 */
export async function executeAgentMemoryCasMutation(
  request: AgentMemoryCasRequest,
  execute: (request: AgentMemoryCasRequest) => Promise<AgentMemoryMutationTransportResult>,
  isAuthorityCurrent: () => boolean,
): Promise<AgentMemoryMutationOutcome> {
  if (!isAuthorityCurrent()) return { kind: 'failure', reason: 'authority_stale' };

  let result: AgentMemoryMutationTransportResult;
  try {
    result = await execute(request);
  } catch {
    return { kind: 'outcome_unknown', reason: 'transport' };
  }

  if (!isAuthorityCurrent()) return { kind: 'outcome_unknown', reason: 'authority_changed' };
  if (result.error) {
    return isDefiniteServerRejection(result)
      ? { kind: 'failure', reason: 'server_rejected' }
      : { kind: 'outcome_unknown', reason: 'transport' };
  }
  if (!Array.isArray(result.data)) return { kind: 'outcome_unknown', reason: 'invalid_receipt' };
  if (result.data.length === 0) return { kind: 'conflict', reason: 'stale_version_or_missing_row' };
  if (result.data.length !== 1) return { kind: 'outcome_unknown', reason: 'invalid_receipt' };

  const row = result.data[0];
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return { kind: 'outcome_unknown', reason: 'invalid_receipt' };
  }
  const exactRow = row as Record<string, unknown>;
  if (!hasExactPostcondition(exactRow, request)) {
    return { kind: 'outcome_unknown', reason: 'invalid_receipt' };
  }
  return { kind: 'success', row: exactRow };
}
