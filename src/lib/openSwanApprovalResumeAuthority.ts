import {
  normalizeOpenSwanApprovalResumeBindingV1,
  type OpenSwanApprovalResumeBindingV1,
} from './openswanToolApprovals';

/**
 * Process-private custody for the exact runtime call that originally stopped
 * at a manual approval. Durable approval rows intentionally contain only a
 * SHA-256 binding; this registry is the complementary, short-lived value
 * authority. Raw arguments never leave this module except through the exact
 * in-process dispatch callback used by a bound continuation.
 */

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CALL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,179}$/;
const APPROVAL_DIGEST_RE = /^approval-v2:sha256:[0-9a-f]{64}$/;
const MAX_LEASES = 256;
const MAX_SOURCE_CALL_ORDINALS = 2_048;
const SOURCE_CALL_ORDINAL_TTL_MS = 5 * 60_000;
const MAX_DEPTH = 20;
const MAX_NODES = 4_096;
const MAX_OBJECT_KEYS = 512;

type FrozenData = unknown;

export type OpenSwanApprovalResumeExactCallLeaseInput = Readonly<{
  approvalId: string;
  sourceRunId: string;
  userId: string;
  circleId: string;
  threadId: string;
  /** Exact persisted user message that originated the approved call. */
  sourceUserMessageId: string;
  toolName: string;
  toolApprovalDigest: string;
  sourceToolUseId: string;
  sourceIteration: number;
  /** 1-indexed position in the original provider tool-use block array. */
  sourceCallOrdinal: number;
  args: Record<string, unknown>;
  expiresAtMs: number;
}>;

export type OpenSwanApprovalResumeExactCall = Readonly<{
  approvalId: string;
  sourceRunId: string;
  userId: string;
  circleId: string;
  threadId: string;
  sourceUserMessageId: string;
  toolName: string;
  toolApprovalDigest: string;
  /** Original provider call identity; audit-only, never reused for dispatch. */
  sourceToolUseId: string;
  sourceIteration: number;
  /** 1-indexed position in the original provider tool-use block array. */
  sourceCallOrdinal: number;
  /** Deeply cloned and frozen process-private arguments. */
  args: Readonly<Record<string, unknown>>;
  expiresAtMs: number;
}>;

type StoredLease = OpenSwanApprovalResumeExactCall & Readonly<{
  registeredAtMs: number;
}>;

export type OpenSwanApprovalResumeItemOutcome = Readonly<{
  approvalId: string;
  toolName: string;
  state: 'satisfied' | 'failed' | 'blocked' | 'missing';
}>;

export type OpenSwanApprovalResumeDisposition = Readonly<{
  state: 'satisfied' | 'failed' | 'incomplete';
  items: readonly OpenSwanApprovalResumeItemOutcome[];
}>;

export type OpenSwanApprovalResumeDispatchStatus =
  | 'planned'
  | 'running'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'manual_required'
  | 'not_applicable';

export type OpenSwanApprovalResumeExecution<T> = Readonly<{
  disposition: OpenSwanApprovalResumeDisposition;
  executions: readonly T[];
  cancelled: boolean;
}>;

const leasesByApprovalId = new Map<string, StoredLease>();
const sourceCallOrdinals = new Map<string, Readonly<{
  ordinal: number;
  expiresAtMs: number;
  registeredAtMs: number;
}>>();

function sourceCallIdentityKey(input: Readonly<{
  sourceRunId: string;
  sourceToolUseId: string;
  sourceIteration: number;
}>): string {
  return `${input.sourceRunId}\u0000${input.sourceIteration}\u0000${input.sourceToolUseId}`;
}

function sweepExpiredSourceCallOrdinals(nowMs: number): void {
  for (const [key, value] of sourceCallOrdinals) {
    if (value.expiresAtMs <= nowMs) sourceCallOrdinals.delete(key);
  }
}

/**
 * Retain provider-array order just before a typed handler enters. This is a
 * process-private identity sidecar: no args or persisted metadata are added.
 */
export function registerOpenSwanApprovalSourceCallOrdinal(input: Readonly<{
  sourceRunId: string;
  sourceToolUseId: string;
  sourceIteration: number;
  sourceCallOrdinal: number;
  nowMs?: number;
}>): boolean {
  const nowMs = input.nowMs ?? Date.now();
  sweepExpiredSourceCallOrdinals(nowMs);
  if (
    !UUID_RE.test(input.sourceRunId)
    || !CALL_ID_RE.test(input.sourceToolUseId)
    || !Number.isInteger(input.sourceIteration)
    || input.sourceIteration < 1
    || input.sourceIteration > 1_000
    || !Number.isInteger(input.sourceCallOrdinal)
    || input.sourceCallOrdinal < 1
    || input.sourceCallOrdinal > 1_000
  ) return false;
  const key = sourceCallIdentityKey(input);
  const existing = sourceCallOrdinals.get(key);
  if (existing) return existing.ordinal === input.sourceCallOrdinal;
  sourceCallOrdinals.set(key, Object.freeze({
    ordinal: input.sourceCallOrdinal,
    registeredAtMs: nowMs,
    expiresAtMs: nowMs + SOURCE_CALL_ORDINAL_TTL_MS,
  }));
  if (sourceCallOrdinals.size > MAX_SOURCE_CALL_ORDINALS) {
    const oldest = [...sourceCallOrdinals.entries()]
      .sort((a, b) => a[1].expiresAtMs - b[1].expiresAtMs
        || a[1].registeredAtMs - b[1].registeredAtMs)[0];
    if (oldest) sourceCallOrdinals.delete(oldest[0]);
  }
  return sourceCallOrdinals.get(key)?.ordinal === input.sourceCallOrdinal;
}

/** Consume one typed-handler order sidecar. Missing/ambiguous order is null. */
export function takeOpenSwanApprovalSourceCallOrdinal(input: Readonly<{
  sourceRunId: string;
  sourceToolUseId: string;
  sourceIteration: number;
  nowMs?: number;
}>): number | null {
  const nowMs = input.nowMs ?? Date.now();
  sweepExpiredSourceCallOrdinals(nowMs);
  if (
    !UUID_RE.test(input.sourceRunId)
    || !CALL_ID_RE.test(input.sourceToolUseId)
    || !Number.isInteger(input.sourceIteration)
  ) return null;
  const key = sourceCallIdentityKey(input);
  const value = sourceCallOrdinals.get(key);
  if (!value) return null;
  sourceCallOrdinals.delete(key);
  return value.ordinal;
}

function cloneAndFreezeData(
  value: unknown,
  state: { nodes: number },
  depth = 0,
): FrozenData {
  if (depth > MAX_DEPTH || state.nodes >= MAX_NODES) {
    throw new Error('approval_resume_args_too_large');
  }
  state.nodes += 1;
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
    || typeof value === 'undefined'
  ) return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('approval_resume_args_non_finite');
    return value;
  }
  if (typeof value !== 'object') throw new Error('approval_resume_args_unsupported');

  const proto = Object.getPrototypeOf(value);
  if (Array.isArray(value)) {
    if (proto !== Array.prototype || value.length > MAX_OBJECT_KEYS) {
      throw new Error('approval_resume_args_invalid_array');
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => {
      if (key === 'length') return false;
      if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(key)) return true;
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= value.length;
    })) throw new Error('approval_resume_args_invalid_array_key');
    const clone: unknown[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
        throw new Error('approval_resume_args_sparse_or_accessor_array');
      }
      clone.push(cloneAndFreezeData(descriptor.value, state, depth + 1));
    }
    return Object.freeze(clone);
  }

  if (proto !== Object.prototype && proto !== null) {
    throw new Error('approval_resume_args_non_data_object');
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length > MAX_OBJECT_KEYS
    || keys.some((key) => typeof key !== 'string')
  ) throw new Error('approval_resume_args_invalid_object_keys');
  const clone: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
      throw new Error('approval_resume_args_unsafe_key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error('approval_resume_args_accessor');
    }
    clone[key] = cloneAndFreezeData(descriptor.value, state, depth + 1);
  }
  return Object.freeze(clone);
}

function sweepExpired(nowMs: number): void {
  for (const [approvalId, lease] of leasesByApprovalId) {
    if (lease.expiresAtMs <= nowMs) leasesByApprovalId.delete(approvalId);
  }
}

function sameLeaseIdentity(a: StoredLease, b: OpenSwanApprovalResumeExactCallLeaseInput): boolean {
  return a.approvalId === b.approvalId
    && a.sourceRunId === b.sourceRunId
    && a.userId === b.userId
    && a.circleId === b.circleId
    && a.threadId === b.threadId
    && a.sourceUserMessageId === b.sourceUserMessageId
    && a.toolName === b.toolName
    && a.toolApprovalDigest === b.toolApprovalDigest
    && a.sourceToolUseId === b.sourceToolUseId
    && a.sourceIteration === b.sourceIteration
    && a.sourceCallOrdinal === b.sourceCallOrdinal;
}

/**
 * Register once. A second model call can never overwrite the first raw call
 * held for the same durable approval id; an identity mismatch fails closed.
 */
export function registerOpenSwanApprovalResumeExactCallLease(
  input: OpenSwanApprovalResumeExactCallLeaseInput,
  nowMs = Date.now(),
): boolean {
  try {
    sweepExpired(nowMs);
    if (
      !UUID_RE.test(input.approvalId)
      || !UUID_RE.test(input.sourceRunId)
      || !UUID_RE.test(input.userId)
      || !UUID_RE.test(input.circleId)
      || !UUID_RE.test(input.threadId)
      || !UUID_RE.test(input.sourceUserMessageId)
      || !CALL_ID_RE.test(input.toolName)
      || !CALL_ID_RE.test(input.sourceToolUseId)
      || !Number.isInteger(input.sourceIteration)
      || input.sourceIteration < 1
      || input.sourceIteration > 1_000
      || !Number.isInteger(input.sourceCallOrdinal)
      || input.sourceCallOrdinal < 1
      || input.sourceCallOrdinal > 1_000
      || !APPROVAL_DIGEST_RE.test(input.toolApprovalDigest)
      || !Number.isSafeInteger(input.expiresAtMs)
      || input.expiresAtMs <= nowMs
      || input.expiresAtMs > nowMs + 86_400_000
    ) return false;

    const existing = leasesByApprovalId.get(input.approvalId);
    if (existing) return sameLeaseIdentity(existing, input);

    const clonedArgs = cloneAndFreezeData(input.args, { nodes: 0 });
    if (!clonedArgs || typeof clonedArgs !== 'object' || Array.isArray(clonedArgs)) return false;
    const lease = Object.freeze({
      approvalId: input.approvalId,
      sourceRunId: input.sourceRunId,
      userId: input.userId,
      circleId: input.circleId,
      threadId: input.threadId,
      sourceUserMessageId: input.sourceUserMessageId,
      toolName: input.toolName,
      toolApprovalDigest: input.toolApprovalDigest,
      sourceToolUseId: input.sourceToolUseId,
      sourceIteration: input.sourceIteration,
      sourceCallOrdinal: input.sourceCallOrdinal,
      args: clonedArgs as Readonly<Record<string, unknown>>,
      expiresAtMs: input.expiresAtMs,
      registeredAtMs: nowMs,
    });
    leasesByApprovalId.set(input.approvalId, lease);

    if (leasesByApprovalId.size > MAX_LEASES) {
      const oldest = [...leasesByApprovalId.values()]
        .sort((a, b) => a.expiresAtMs - b.expiresAtMs || a.registeredAtMs - b.registeredAtMs)[0];
      if (oldest) leasesByApprovalId.delete(oldest.approvalId);
    }
    return leasesByApprovalId.get(input.approvalId) === lease;
  } catch {
    return false;
  }
}

type ClaimResult =
  | { kind: 'claimed'; calls: readonly OpenSwanApprovalResumeExactCall[] }
  | { kind: 'unavailable'; disposition: OpenSwanApprovalResumeDisposition };

/**
 * All-or-nothing synchronous claim. If even one item is unavailable or its
 * scope/digest differs, no lease is removed and no call may dispatch. Once the
 * complete set is claimed, every lease is removed before the first await so a
 * competing continuation cannot race or replay it.
 */
export function claimOpenSwanApprovalResumeExactCalls(input: {
  binding: OpenSwanApprovalResumeBindingV1;
  currentRunId: string;
  sourceUserMessageId: string;
  nowMs?: number;
  /**
   * Synchronous custody handoff. It runs only after the complete set matches,
   * but before leases are removed. A throw leaves every lease intact and
   * returns an incomplete disposition without dispatch.
   */
  accept?: (summary: Readonly<{
    runId: string;
    approvalIds: readonly string[];
  }>) => void;
}): ClaimResult {
  const nowMs = input.nowMs ?? Date.now();
  const binding = normalizeOpenSwanApprovalResumeBindingV1(input.binding);
  sweepExpired(nowMs);
  if (
    !binding
    || !UUID_RE.test(input.currentRunId)
    || !UUID_RE.test(input.sourceUserMessageId)
    || input.currentRunId === binding.sourceRunId
  ) {
    const rawItems = binding?.approvals || [];
    return {
      kind: 'unavailable',
      disposition: Object.freeze({
        state: 'incomplete' as const,
        items: Object.freeze(rawItems.map((item) => Object.freeze({
          approvalId: item.approvalId,
          toolName: item.toolName,
          state: 'missing' as const,
        }))),
      }),
    };
  }

  const calls: OpenSwanApprovalResumeExactCall[] = [];
  let unavailable = false;
  const outcomes = binding.approvals.map((item) => {
    const lease = leasesByApprovalId.get(item.approvalId);
    const matches = !!lease
      && lease.expiresAtMs > nowMs
      && lease.sourceRunId === binding.sourceRunId
      && lease.userId === binding.userId
      && lease.circleId === binding.circleId
      && lease.threadId === binding.threadId
      && lease.sourceUserMessageId === input.sourceUserMessageId
      && lease.toolName === item.toolName
      && lease.toolApprovalDigest === item.toolApprovalDigest;
    if (!matches) unavailable = true;
    else calls.push(lease);
    return Object.freeze({
      approvalId: item.approvalId,
      toolName: item.toolName,
      state: matches ? 'satisfied' as const : 'missing' as const,
    });
  });
  if (unavailable || calls.length !== binding.approvals.length) {
    return {
      kind: 'unavailable',
      disposition: Object.freeze({
        state: 'incomplete' as const,
        items: Object.freeze(outcomes.map((item) => (
          item.state === 'satisfied'
            ? Object.freeze({ ...item, state: 'blocked' as const })
            : item
        ))),
      }),
    };
  }

  // Approval queries/UI projections commonly return newest-first. That order
  // is not execution authority. Reconstruct the only proven order from the
  // original provider round + block ordinal retained with each exact call.
  // A duplicate position means the total order is ambiguous, so a combined
  // continuation fails closed before custody transfer or lease removal.
  const sourcePositions = new Set<string>();
  for (const call of calls) {
    const position = `${call.sourceIteration}:${call.sourceCallOrdinal}`;
    if (sourcePositions.has(position)) {
      return {
        kind: 'unavailable',
        disposition: Object.freeze({
          state: 'incomplete' as const,
          items: Object.freeze(calls.map((item) => Object.freeze({
            approvalId: item.approvalId,
            toolName: item.toolName,
            state: 'blocked' as const,
          }))),
        }),
      };
    }
    sourcePositions.add(position);
  }
  calls.sort((a, b) => (
    a.sourceIteration - b.sourceIteration
    || a.sourceCallOrdinal - b.sourceCallOrdinal
  ));
  if (input.accept) {
    try {
      input.accept(Object.freeze({
        runId: input.currentRunId,
        approvalIds: Object.freeze(calls.map((call) => call.approvalId)),
      }));
    } catch {
      return {
        kind: 'unavailable',
        disposition: Object.freeze({
          state: 'incomplete' as const,
          items: Object.freeze(calls.map((call) => Object.freeze({
            approvalId: call.approvalId,
            toolName: call.toolName,
            state: 'blocked' as const,
          }))),
        }),
      };
    }
  }
  for (const call of calls) leasesByApprovalId.delete(call.approvalId);
  return { kind: 'claimed', calls: Object.freeze(calls) };
}

/**
 * Execute a claimed continuation in original provider call order. The caller supplies the
 * normal runtime dispatch seam; this helper supplies an exact runtime-owned
 * toolUseId/iteration and never asks a model to reconstruct the call.
 */
export async function executeOpenSwanApprovalResumeExactCalls<T>(input: {
  binding: OpenSwanApprovalResumeBindingV1;
  currentRunId: string;
  sourceUserMessageId: string;
  nowMs?: number;
  /** Chat STOP authority. An already-aborted signal preserves every lease. */
  signal?: AbortSignal | null;
  accept?: (summary: Readonly<{
    runId: string;
    approvalIds: readonly string[];
  }>) => void;
  dispatch: (
    call: OpenSwanApprovalResumeExactCall,
    identity: Readonly<{ toolUseId: string; iteration: number }>,
  ) => Promise<Readonly<{ status: OpenSwanApprovalResumeDispatchStatus; value: T }>>;
}): Promise<OpenSwanApprovalResumeExecution<T>> {
  if (input.signal?.aborted) {
    const binding = normalizeOpenSwanApprovalResumeBindingV1(input.binding);
    return Object.freeze({
      disposition: Object.freeze({
        state: 'incomplete' as const,
        items: Object.freeze((binding?.approvals || []).map((item) => Object.freeze({
          approvalId: item.approvalId,
          toolName: item.toolName,
          state: 'blocked' as const,
        }))),
      }),
      executions: Object.freeze([]),
      cancelled: true,
    });
  }
  const claim = claimOpenSwanApprovalResumeExactCalls({
    binding: input.binding,
    currentRunId: input.currentRunId,
    sourceUserMessageId: input.sourceUserMessageId,
    nowMs: input.nowMs,
    accept: input.accept,
  });
  if (claim.kind === 'unavailable') {
    return Object.freeze({ disposition: claim.disposition, executions: Object.freeze([]), cancelled: false });
  }

  const outcomes: OpenSwanApprovalResumeItemOutcome[] = [];
  const executions: T[] = [];
  let stopAfterFailure = false;
  let cancelled = false;
  for (let index = 0; index < claim.calls.length; index += 1) {
    const call = claim.calls[index];
    if (input.signal?.aborted) cancelled = true;
    if (stopAfterFailure || cancelled) {
      outcomes.push(Object.freeze({
        approvalId: call.approvalId,
        toolName: call.toolName,
        state: 'blocked' as const,
      }));
      continue;
    }
    const identity = Object.freeze({
      toolUseId: `approval-resume:${call.approvalId}`,
      iteration: index + 1,
    });
    try {
      const dispatched = await input.dispatch(call, identity);
      if (input.signal?.aborted) cancelled = true;
      executions.push(dispatched.value);
      outcomes.push(Object.freeze({
        approvalId: call.approvalId,
        toolName: call.toolName,
        state: dispatched.status === 'passed'
          ? 'satisfied'
          : dispatched.status === 'failed'
            ? 'failed'
            : 'blocked',
      }));
      if (dispatched.status !== 'passed') stopAfterFailure = true;
    } catch {
      outcomes.push(Object.freeze({
        approvalId: call.approvalId,
        toolName: call.toolName,
        state: 'failed' as const,
      }));
      stopAfterFailure = true;
    }
  }

  const state = outcomes.some((item) => item.state === 'failed')
    ? 'failed'
    : outcomes.some((item) => item.state !== 'satisfied')
      ? 'incomplete'
      : 'satisfied';
  return Object.freeze({
    disposition: Object.freeze({ state, items: Object.freeze(outcomes) }),
    executions: Object.freeze(executions),
    cancelled,
  });
}

/** Test/diagnostic seam that exposes no argument values. */
export function inspectOpenSwanApprovalResumeExactCallLease(
  approvalId: string,
  nowMs = Date.now(),
): Readonly<{ present: boolean; expiresAtMs?: number }> {
  sweepExpired(nowMs);
  const lease = leasesByApprovalId.get(approvalId);
  return lease
    ? Object.freeze({ present: true, expiresAtMs: lease.expiresAtMs })
    : Object.freeze({ present: false });
}

/**
 * Synchronous revocation seam for logout, rejection, and device-local outbox
 * cleanup. Omitting ids clears every process-private lease; an explicit empty
 * list clears nothing. Invalid ids are ignored and no argument values escape.
 */
export function deleteOpenSwanApprovalResumeExactCallLeases(
  approvalIds?: readonly string[],
): number {
  if (approvalIds === undefined) {
    const deleted = leasesByApprovalId.size;
    leasesByApprovalId.clear();
    return deleted;
  }
  let deleted = 0;
  for (const approvalId of new Set(approvalIds)) {
    if (UUID_RE.test(approvalId) && leasesByApprovalId.delete(approvalId)) deleted += 1;
  }
  return deleted;
}
