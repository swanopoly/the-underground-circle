/**
 * runApprovalsService — realtime view + resolve actions for
 * `agent_run_approvals`. Feeds the in-chat RunApprovalBanner so users
 * can approve/reject pending HITL gates inline (v2's M3d writes here).
 *
 * Distinct from `services/hitlService.ts`, which watches the legacy
 * `agent_approvals` table used by the kill-switch / per-agent controls.
 * The two tables share a domain (human-in-the-loop gates) but have
 * different schemas and different write paths — keeping them separate
 * avoids confusing UI reads with kill-switch rows and vice versa.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { isApprovalRowLive } from '../lib/approvalCardModelCore';
import { isOpenSwanApprovalAuditPayload } from '../lib/openswanToolApprovals';
import { safeGetUserForAccessToken } from '../lib/authSession';

const APPROVAL_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PENDING_RESULT_LIMIT = 10;
const PENDING_PAGE_SIZE = 32;
const PENDING_MAX_CANDIDATES = 2_048;
const APPROVED_UNCONSUMED_RESULT_LIMIT = 16;
const APPROVED_UNCONSUMED_PAGE_SIZE = 32;
const APPROVED_UNCONSUMED_MAX_CANDIDATES = 2_048;
const APPROVAL_REQUESTED_AT_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:\d{2})$/;

const APPROVAL_KINDS = new Set<ApprovalKind>([
  'tool_use',
  'publish',
  'external_send',
  'file_write',
  'browser_action',
  'cost_threshold',
  'privileged_action',
  'plan_approval',
  'deliverable_review',
]);

export type ApprovalKind =
  | 'tool_use'
  | 'publish'
  | 'external_send'
  | 'file_write'
  | 'browser_action'
  | 'cost_threshold'
  | 'privileged_action'
  | 'plan_approval'
  | 'deliverable_review';

export type AgentRunApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'auto_approved';

export interface AgentRunApproval {
  id: string;
  run_id: string;
  circle_id: string;
  approval_kind: ApprovalKind;
  title: string;
  description: string | null;
  payload: Record<string, unknown> | null;
  status: AgentRunApprovalStatus;
  requested_by: string | null;
  requested_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  timeout_seconds: number;
}

export interface RunApprovalsExactAuthority {
  userId: string;
  circleId: string;
  accessToken: string;
  authorityGeneration: number;
}

export type RunApprovalAuthorityGuard = () => boolean;

export interface ApprovedUnconsumedRunApprovalSelectorInput {
  circleId: string;
  userId: string;
  nowMs: number;
  rows: readonly unknown[];
  limit?: number;
}

// ─── Reads ─────────────────────────────────────────────────────────

type RunApprovalReadScope = Readonly<{
  accessToken?: string;
  isCurrent?: RunApprovalAuthorityGuard;
}>;

function isRunApprovalReadCurrent(scope?: RunApprovalReadScope): boolean {
  try {
    return scope?.isCurrent ? scope.isCurrent() : true;
  } catch {
    return false;
  }
}

async function verifyRunApprovalReadAuthority(
  authority: RunApprovalsExactAuthority,
  isCurrent: RunApprovalAuthorityGuard,
): Promise<boolean> {
  if (
    !APPROVAL_UUID_RE.test(authority?.userId || '')
    || !APPROVAL_UUID_RE.test(authority?.circleId || '')
    || !authority?.accessToken
    || authority.accessToken.length > 16_384
    || !Number.isSafeInteger(authority?.authorityGeneration)
    || authority.authorityGeneration <= 0
    || !isRunApprovalReadCurrent({ isCurrent })
  ) return false;
  const { value: verifiedUser } = await safeGetUserForAccessToken(authority.accessToken);
  return verifiedUser?.id === authority.userId && isRunApprovalReadCurrent({ isCurrent });
}

async function getPendingRunApprovalsInternal(
  circleId: string,
  requestedBy?: string,
  scope?: RunApprovalReadScope,
): Promise<AgentRunApproval[]> {
  if (
    !APPROVAL_UUID_RE.test(circleId)
    || (requestedBy && !APPROVAL_UUID_RE.test(requestedBy))
    || !isRunApprovalReadCurrent(scope)
  ) return [];
  const candidates: AgentRunApproval[] = [];
  let candidateCount = 0;
  let cursor: ApprovalPageCursor | null = null;
  for (let page = 0; page < PENDING_MAX_CANDIDATES / PENDING_PAGE_SIZE; page += 1) {
    let query = supabase
      .from('agent_run_approvals')
      .select('id, run_id, circle_id, approval_kind, title, description, payload, status, requested_by, requested_at, resolved_by, resolved_at, timeout_seconds')
      .eq('circle_id', circleId)
      .eq('status', 'pending');
    if (requestedBy) query = query.eq('requested_by', requestedBy);
    if (cursor) query = query.or(pendingCursorFilter(cursor));
    if (scope?.accessToken) query = query.setHeader('Authorization', `Bearer ${scope.accessToken}`);
    const { data, error } = await query
      .order('requested_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PENDING_PAGE_SIZE);
    if (
      !isRunApprovalReadCurrent(scope)
      || error
      || !Array.isArray(data)
      || data.length > PENDING_PAGE_SIZE
    ) return [];
    let pageCursor: ApprovalPageCursor | null = cursor;
    const parsedPage: AgentRunApproval[] = [];
    for (const row of data) {
      const nextCursor = approvalPageCursor(row);
      if (!nextCursor || (pageCursor && compareApprovalPageCursors(nextCursor, pageCursor) >= 0)) {
        return [];
      }
      const parsed = parsePendingRunApproval(row, { circleId, requestedBy, nowMs: Date.now() });
      if (!parsed) return [];
      parsedPage.push(parsed);
      pageCursor = nextCursor;
    }
    candidateCount += data.length;
    if (candidateCount > PENDING_MAX_CANDIDATES) return [];
    const now = Date.now();
    candidates.push(...parsedPage.filter((row) => (
      isApprovalRowLive(row.requested_at, row.timeout_seconds, now)
    )));
    if (candidates.length >= PENDING_RESULT_LIMIT) return candidates.slice(0, PENDING_RESULT_LIMIT);
    if (data.length < PENDING_PAGE_SIZE) return candidates;
    if (!pageCursor) return [];
    cursor = pageCursor;
  }
  // Nothing sweeps DB rows to status 'expired' (timeout_seconds is stored but
  // unenforced), so filter dead rows here — mirroring the P12 pattern used for
  // HitlApprovalBanner — instead of letting a stale pending approval pin
  // ChatTab's "Needs your approval" pill (and the banner) indefinitely. Doing
  // it at this single read point keeps the banner list, its pending count,
  // and the run pill in agreement. Liveness semantics live in the shared
  // `approvalCardModelCore.isApprovalRowLive` (this filter was its reference
  // implementation): explicit timeout window when set, else the 30-min
  // classifyApprovalAge staleness cap. Hiding a timed-out row only narrows
  // what can be approved — never widens what executes.
  return [];
}

export async function getPendingRunApprovals(
  circleId: string,
  requestedBy?: string,
): Promise<AgentRunApproval[]> {
  return getPendingRunApprovalsInternal(circleId, requestedBy);
}

export async function getPendingRunApprovalsExact(
  authority: RunApprovalsExactAuthority,
  isCurrent: RunApprovalAuthorityGuard,
): Promise<AgentRunApproval[]> {
  if (!await verifyRunApprovalReadAuthority(authority, isCurrent)) return [];
  return getPendingRunApprovalsInternal(authority.circleId, authority.userId, {
    accessToken: authority.accessToken,
    isCurrent,
  });
}

function ownDataProperty(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor && descriptor.enumerable && 'value' in descriptor
    ? descriptor.value
    : undefined;
}

type ApprovalPageCursor = Readonly<{
  requestedAt: string;
  requestedAtSortKey: bigint;
  id: string;
}>;

function approvalTimestampSortKey(value: string): bigint | null {
  const match = APPROVAL_REQUESTED_AT_RE.exec(value);
  if (!match) return null;
  const parsedMs = Date.parse(value);
  if (!Number.isFinite(parsedMs)) return null;
  const fraction = (match[1] || '').padEnd(6, '0');
  // Date.parse retains the first three fractional digits. Add the remaining
  // PostgreSQL microseconds so two timestamptz values inside the same
  // millisecond never fall through to the UUID tie-breaker prematurely.
  const subMillisecondMicros = Number(fraction.slice(3, 6) || '0');
  return BigInt(parsedMs) * 1_000n + BigInt(subMillisecondMicros);
}

/**
 * Read the exact ordered key from an untrusted transport row without invoking
 * accessors. PostgreSQL orders UUIDs by their bytes, which is equivalent to
 * lowercase canonical UUID lexical order for this fixed-width representation.
 */
function approvalPageCursor(value: unknown): ApprovalPageCursor | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const record = value as Record<string, unknown>;
    const id = ownDataProperty(record, 'id');
    const requestedAt = ownDataProperty(record, 'requested_at');
    if (
      typeof id !== 'string'
      || !APPROVAL_UUID_RE.test(id)
      || typeof requestedAt !== 'string'
      || requestedAt.length > 64
      || !APPROVAL_REQUESTED_AT_RE.test(requestedAt)
    ) return null;
    const requestedAtSortKey = approvalTimestampSortKey(requestedAt);
    if (requestedAtSortKey === null) return null;
    return Object.freeze({
      requestedAt,
      requestedAtSortKey,
      id: id.toLowerCase(),
    });
  } catch {
    return null;
  }
}

function compareApprovalPageCursors(
  left: ApprovalPageCursor,
  right: ApprovalPageCursor,
): number {
  if (left.requestedAtSortKey !== right.requestedAtSortKey) {
    return left.requestedAtSortKey < right.requestedAtSortKey ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/**
 * PostgREST keyset predicate for the exact ascending `(requested_at, id)`
 * order. Both values have passed narrow non-delimiter validation above.
 */
function approvedUnconsumedCursorFilter(cursor: ApprovalPageCursor): string {
  return `requested_at.gt.${cursor.requestedAt},and(requested_at.eq.${cursor.requestedAt},id.gt.${cursor.id})`;
}

function pendingCursorFilter(cursor: ApprovalPageCursor): string {
  return `requested_at.lt.${cursor.requestedAt},and(requested_at.eq.${cursor.requestedAt},id.lt.${cursor.id})`;
}

function parsePendingRunApproval(
  value: unknown,
  expected: Readonly<{ circleId: string; requestedBy?: string; nowMs: number }>,
): AgentRunApproval | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    const record = value as Record<string, unknown>;
    const id = ownDataProperty(record, 'id');
    const runId = ownDataProperty(record, 'run_id');
    const circleId = ownDataProperty(record, 'circle_id');
    const approvalKind = ownDataProperty(record, 'approval_kind');
    const title = ownDataProperty(record, 'title');
    const description = ownDataProperty(record, 'description');
    const status = ownDataProperty(record, 'status');
    const requestedBy = ownDataProperty(record, 'requested_by');
    const requestedAt = ownDataProperty(record, 'requested_at');
    const resolvedBy = ownDataProperty(record, 'resolved_by');
    const resolvedAt = ownDataProperty(record, 'resolved_at');
    const timeoutSeconds = ownDataProperty(record, 'timeout_seconds');
    const rawPayload = ownDataProperty(record, 'payload');
    if (
      typeof id !== 'string'
      || !APPROVAL_UUID_RE.test(id)
      || typeof runId !== 'string'
      || !APPROVAL_UUID_RE.test(runId)
      || circleId !== expected.circleId
      || typeof approvalKind !== 'string'
      || !APPROVAL_KINDS.has(approvalKind as ApprovalKind)
      || typeof title !== 'string'
      || title.length > 240
      || (description !== null && typeof description !== 'string')
      || (typeof description === 'string' && description.length > 500)
      || status !== 'pending'
      || (requestedBy !== null && (typeof requestedBy !== 'string' || !APPROVAL_UUID_RE.test(requestedBy)))
      || (expected.requestedBy !== undefined && requestedBy !== expected.requestedBy)
      || typeof requestedAt !== 'string'
      || requestedAt.length > 64
      || !APPROVAL_REQUESTED_AT_RE.test(requestedAt)
      || resolvedBy !== null
      || resolvedAt !== null
      || !Number.isInteger(timeoutSeconds)
      || Number(timeoutSeconds) < 0
      || Number(timeoutSeconds) > 86_400
    ) return null;
    const requestedAtSortKey = approvalTimestampSortKey(requestedAt);
    if (
      !Number.isFinite(expected.nowMs)
      || requestedAtSortKey === null
      || requestedAtSortKey > BigInt(Math.trunc(expected.nowMs)) * 1_000n
    ) {
      return null;
    }

    let payload: Record<string, unknown> | null = null;
    if (rawPayload !== null) {
      if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) return null;
      const payloadPrototype = Object.getPrototypeOf(rawPayload);
      if (payloadPrototype !== Object.prototype && payloadPrototype !== null) return null;
      const keys = Reflect.ownKeys(rawPayload);
      if (keys.length > 512) return null;
      payload = Object.create(null) as Record<string, unknown>;
      for (const key of keys) {
        if (typeof key !== 'string') return null;
        const descriptor = Object.getOwnPropertyDescriptor(rawPayload, key);
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
        payload[key] = descriptor.value;
      }
    }
    return {
      id,
      run_id: runId,
      circle_id: circleId,
      approval_kind: approvalKind as ApprovalKind,
      title,
      description,
      payload,
      status,
      requested_by: requestedBy,
      requested_at: requestedAt,
      resolved_by: null,
      resolved_at: null,
      timeout_seconds: Number(timeoutSeconds),
    };
  } catch {
    return null;
  }
}

/**
 * Parse one untrusted Supabase row into the narrow value-free wake-up shape.
 * This is deliberately stricter than the server query: JSON-path `IS NULL`
 * matches both an absent key and a present JSON null, while an unconsumed v2
 * payload is canonical only when all three dispatch fields are absent.
 */
function parseApprovedUnconsumedRunApproval(
  value: unknown,
  expected: Readonly<{ circleId: string; userId: string; nowMs: number }>,
): AgentRunApproval | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const recordPrototype = Object.getPrototypeOf(value);
    if (recordPrototype !== Object.prototype && recordPrototype !== null) return null;
    const record = value as Record<string, unknown>;

    const id = ownDataProperty(record, 'id');
    const runId = ownDataProperty(record, 'run_id');
    const circleId = ownDataProperty(record, 'circle_id');
    const approvalKind = ownDataProperty(record, 'approval_kind');
    const title = ownDataProperty(record, 'title');
    const description = ownDataProperty(record, 'description');
    const status = ownDataProperty(record, 'status');
    const requestedBy = ownDataProperty(record, 'requested_by');
    const requestedAt = ownDataProperty(record, 'requested_at');
    const resolvedBy = ownDataProperty(record, 'resolved_by');
    const resolvedAt = ownDataProperty(record, 'resolved_at');
    const timeoutSeconds = ownDataProperty(record, 'timeout_seconds');
    const rawPayload = ownDataProperty(record, 'payload');

    if (
      typeof id !== 'string'
      || !APPROVAL_UUID_RE.test(id)
      || typeof runId !== 'string'
      || !APPROVAL_UUID_RE.test(runId)
      || circleId !== expected.circleId
      || typeof approvalKind !== 'string'
      || !APPROVAL_KINDS.has(approvalKind as ApprovalKind)
      || typeof title !== 'string'
      || title.length > 240
      || (description !== null && typeof description !== 'string')
      || (typeof description === 'string' && description.length > 500)
      || status !== 'approved'
      || requestedBy !== expected.userId
      || resolvedBy !== expected.userId
      || typeof requestedAt !== 'string'
      || requestedAt.length > 64
      || typeof resolvedAt !== 'string'
      || resolvedAt.length > 64
      || !Number.isInteger(timeoutSeconds)
      || Number(timeoutSeconds) < 1
      || Number(timeoutSeconds) > 86_400
      || !rawPayload
      || typeof rawPayload !== 'object'
      || Array.isArray(rawPayload)
    ) return null;

    const payloadPrototype = Object.getPrototypeOf(rawPayload);
    if (payloadPrototype !== Object.prototype && payloadPrototype !== null) return null;
    const payload: Record<string, unknown> = Object.create(null);
    for (const key of Reflect.ownKeys(rawPayload)) {
      if (typeof key !== 'string') return null;
      const descriptor = Object.getOwnPropertyDescriptor(rawPayload, key);
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return null;
      payload[key] = descriptor.value;
    }
    if (
      !isOpenSwanApprovalAuditPayload(payload)
      || payload.approvalMode !== 'ask'
      || payload.toolName === 'desktop.open_attachment'
      || Object.prototype.hasOwnProperty.call(payload, 'dispatchReceiptSchemaVersion')
      || Object.prototype.hasOwnProperty.call(payload, 'dispatchBindingDigest')
      || Object.prototype.hasOwnProperty.call(payload, 'dispatchConsumedAt')
    ) return null;

    const requestedAtSortKey = approvalTimestampSortKey(requestedAt);
    const resolvedAtSortKey = approvalTimestampSortKey(resolvedAt);
    const nowSortKey = Number.isFinite(expected.nowMs)
      ? BigInt(Math.trunc(expected.nowMs)) * 1_000n
      : null;
    const expiresAtSortKey = requestedAtSortKey === null
      ? null
      : requestedAtSortKey + BigInt(Number(timeoutSeconds)) * 1_000_000n;
    if (
      nowSortKey === null
      || requestedAtSortKey === null
      || resolvedAtSortKey === null
      || expiresAtSortKey === null
      || requestedAtSortKey > nowSortKey
      || requestedAtSortKey > resolvedAtSortKey
      || resolvedAtSortKey >= expiresAtSortKey
      || nowSortKey >= expiresAtSortKey
    ) return null;

    return {
      id,
      run_id: runId,
      circle_id: circleId,
      approval_kind: approvalKind as ApprovalKind,
      title,
      description,
      payload,
      status,
      requested_by: requestedBy,
      requested_at: requestedAt,
      resolved_by: resolvedBy,
      resolved_at: resolvedAt,
      timeout_seconds: Number(timeoutSeconds),
    };
  } catch {
    return null;
  }
}

/**
 * Pure selector for approved-but-unconsumed Chat recovery wake-ups. It treats
 * every database row as hostile, deduplicates by approval id, and produces a
 * deterministic oldest-first slice independent of server page order.
 */
export function selectApprovedUnconsumedRunApprovals(
  input: ApprovedUnconsumedRunApprovalSelectorInput,
): AgentRunApproval[] {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return [];
    const limit = input.limit ?? APPROVED_UNCONSUMED_RESULT_LIMIT;
    if (
      !APPROVAL_UUID_RE.test(input.circleId)
      || !APPROVAL_UUID_RE.test(input.userId)
      || !Number.isFinite(input.nowMs)
      || !Number.isInteger(limit)
      || limit < 1
      || limit > APPROVED_UNCONSUMED_RESULT_LIMIT
      || !Array.isArray(input.rows)
      || input.rows.length > APPROVED_UNCONSUMED_MAX_CANDIDATES
    ) return [];

    const byId = new Map<string, AgentRunApproval>();
    for (const value of input.rows) {
      const parsed = parseApprovedUnconsumedRunApproval(value, input);
      if (!parsed || byId.has(parsed.id)) continue;
      byId.set(parsed.id, parsed);
    }

    return [...byId.values()]
      .sort((a, b) => (
        compareApprovalPageCursors(
          approvalPageCursor(a)!,
          approvalPageCursor(b)!,
        )
      ))
      .slice(0, limit);
  } catch {
    return [];
  }
}

/**
 * Return only this user's still-live, schema-v2 approvals that were granted
 * but have not won the runtime's one-shot dispatch CAS yet. This is a
 * value-free recovery signal for Chat reloads/realtime updates; it is never
 * dispatch authority by itself. Chat must additionally prove exact persisted
 * run/source-message ownership and restore the matching encrypted local call
 * envelope before attempting a continuation.
 */
async function getApprovedUnconsumedRunApprovalsInternal(
  circleId: string,
  userId: string,
  scope?: RunApprovalReadScope,
): Promise<AgentRunApproval[]> {
  if (
    !APPROVAL_UUID_RE.test(circleId)
    || !APPROVAL_UUID_RE.test(userId)
    || !isRunApprovalReadCurrent(scope)
  ) return [];
  const now = Date.now();
  let candidateCount = 0;
  let selected: AgentRunApproval[] = [];
  let cursor: ApprovalPageCursor | null = null;
  // PostgreSQL does not sweep expired approved rows. Page oldest-first and
  // keep paging until 16 unique rows survive the pure selector. A hard 2,048-
  // candidate ceiling fails closed rather than returning a possibly-starved
  // partial slice; a server-clock RPC should eventually replace this fallback.
  // Keyset pagination is required here: offset pages can skip the next rows if
  // earlier approvals are consumed (and disappear from this query) between
  // requests. The UUID tie-breaker also makes >32 identical timestamps stable.
  for (let page = 0; page < APPROVED_UNCONSUMED_MAX_CANDIDATES / APPROVED_UNCONSUMED_PAGE_SIZE; page += 1) {
    let query = supabase
      .from('agent_run_approvals')
      .select('id, run_id, circle_id, approval_kind, title, description, payload, status, requested_by, requested_at, resolved_by, resolved_at, timeout_seconds')
      .eq('circle_id', circleId)
      .eq('requested_by', userId)
      // A peer resolving the row is not this device owner's consent. §41
      // enforces requester-only resolution for device-private opens; this
      // client guard applies the same narrow rule to generic exact resumes.
      .eq('resolved_by', userId)
      .eq('status', 'approved')
      .eq('payload->>approvalMode', 'ask')
      .is('payload->>dispatchReceiptSchemaVersion', null)
      .is('payload->>dispatchBindingDigest', null)
      .is('payload->>dispatchConsumedAt', null)
      .gte('requested_at', new Date(now - 86_400_000).toISOString());
    if (cursor) query = query.or(approvedUnconsumedCursorFilter(cursor));
    if (scope?.accessToken) query = query.setHeader('Authorization', `Bearer ${scope.accessToken}`);
    const { data, error } = await query
      .order('requested_at', { ascending: true })
      .order('id', { ascending: true })
      .limit(APPROVED_UNCONSUMED_PAGE_SIZE);
    if (!isRunApprovalReadCurrent(scope) || error) return [];
    if (!Array.isArray(data) || data.length > APPROVED_UNCONSUMED_PAGE_SIZE) return [];
    let pageCursor: ApprovalPageCursor | null = cursor;
    for (const row of data) {
      const nextCursor = approvalPageCursor(row);
      // The server response itself is an authority boundary. A missing key,
      // duplicate, backward row, or row not strictly after the prior cursor
      // makes pagination ambiguous, so never return a partial recovery slice.
      if (!nextCursor || (pageCursor && compareApprovalPageCursors(nextCursor, pageCursor) <= 0)) {
        return [];
      }
      pageCursor = nextCursor;
    }
    candidateCount += data.length;
    if (candidateCount > APPROVED_UNCONSUMED_MAX_CANDIDATES) return [];
    const reachedServerExhaustion = data.length < APPROVED_UNCONSUMED_PAGE_SIZE;
    // Retain only already-validated winners between pages. This still lets a
    // later valid row survive arbitrarily many stale pages, while avoiding an
    // O(page²) reparse of every rejected candidate on slower devices.
    selected = selectApprovedUnconsumedRunApprovals({
      circleId,
      userId,
      nowMs: now,
      rows: [...selected, ...data],
    });
    if (selected.length >= APPROVED_UNCONSUMED_RESULT_LIMIT || reachedServerExhaustion) {
      return selected;
    }
    // A full non-empty page must have supplied a strictly advancing cursor.
    // This assignment happens only after the whole page passed validation.
    if (!pageCursor) return [];
    cursor = pageCursor;
  }
  return [];
}

export async function getApprovedUnconsumedRunApprovals(
  circleId: string,
  userId: string,
): Promise<AgentRunApproval[]> {
  return getApprovedUnconsumedRunApprovalsInternal(circleId, userId);
}

export async function getApprovedUnconsumedRunApprovalsExact(
  authority: RunApprovalsExactAuthority,
  isCurrent: RunApprovalAuthorityGuard,
): Promise<AgentRunApproval[]> {
  if (!await verifyRunApprovalReadAuthority(authority, isCurrent)) return [];
  return getApprovedUnconsumedRunApprovalsInternal(authority.circleId, authority.userId, {
    accessToken: authority.accessToken,
    isCurrent,
  });
}

// ─── Writes ────────────────────────────────────────────────────────

export async function resolveRunApproval(
  approvalId: string,
  status: 'approved' | 'rejected',
  userId: string,
): Promise<{ ok: boolean; error?: string }> {
  // Fail-closed + idempotent (mirrors agentRunSystem.resolveRunApproval): only
  // a still-PENDING row transitions, so a late click (after another approver or
  // after expiry) can't flip a resolved/expired decision. A no-op update
  // reports ok:false with a clear reason instead of a silent success.
  const { data, error } = await supabase
    .from('agent_run_approvals')
    .update({
      status,
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', approvalId)
    .eq('status', 'pending')
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!Array.isArray(data) || data.length === 0) {
    return { ok: false, error: 'This approval is no longer pending (already resolved or expired).' };
  }
  return { ok: true };
}

export async function resolveRunApprovalExact(
  approvalId: string,
  status: 'approved' | 'rejected',
  authority: RunApprovalsExactAuthority,
  isCurrent: RunApprovalAuthorityGuard,
): Promise<{ ok: boolean; approval?: AgentRunApproval; error?: string }> {
  const id = String(approvalId || '').trim();
  const userId = String(authority?.userId || '').trim();
  const circleId = String(authority?.circleId || '').trim();
  const accessToken = String(authority?.accessToken || '').trim();
  if (
    !APPROVAL_UUID_RE.test(id)
    || !APPROVAL_UUID_RE.test(userId)
    || !APPROVAL_UUID_RE.test(circleId)
    || !accessToken
    || accessToken.length > 16_384
    || !Number.isSafeInteger(authority?.authorityGeneration)
    || authority.authorityGeneration <= 0
    || !isCurrent()
  ) return { ok: false, error: 'This approval belongs to a retired Office session.' };
  const { value: verifiedUser } = await safeGetUserForAccessToken(accessToken);
  if (verifiedUser?.id !== userId || !isCurrent()) {
    return { ok: false, error: 'The signed-in Office account changed before this approval could be resolved.' };
  }
  const { data, error } = await supabase
    .from('agent_run_approvals')
    .update({ status, resolved_by: userId, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('circle_id', circleId)
    .eq('requested_by', userId)
    .eq('status', 'pending')
    .setHeader('Authorization', `Bearer ${accessToken}`)
    .select('id, run_id, circle_id, approval_kind, title, description, payload, status, requested_by, requested_at, resolved_by, resolved_at, timeout_seconds');
  if (!isCurrent()) return { ok: false, error: 'The Office account changed while the approval was resolving.' };
  if (error) return { ok: false, error: error.message };
  const row = Array.isArray(data) && data.length === 1
    && data[0] && typeof data[0] === 'object' && !Array.isArray(data[0])
    ? data[0] as Record<string, unknown>
    : null;
  const parsed = row ? parsePendingRunApproval(
    { ...row, status: 'pending', resolved_by: null, resolved_at: null },
    { circleId, requestedBy: userId, nowMs: Date.now() },
  ) : null;
  if (
    !parsed
    || row?.status !== status
    || row?.resolved_by !== userId
    || row?.circle_id !== circleId
  ) return { ok: false, error: 'This approval is no longer pending or its resolution receipt was invalid.' };
  return {
    ok: true,
    approval: {
      ...parsed,
      status,
      resolved_by: userId,
      resolved_at: typeof row.resolved_at === 'string' ? row.resolved_at : null,
    },
  };
}

// ─── Realtime hook ─────────────────────────────────────────────────
//
// Subscribes to postgres_changes on `agent_run_approvals` filtered by
// circle_id. On every change we refetch the pending slice rather than
// mutate local state — the query is small (≤10 rows) and this keeps
// the reducer trivial. Also refetches every 30s as a safety net in
// case the realtime channel drops silently.

export function useAgentRunApprovals(
  circleId?: string,
  userId?: string,
  exactAuthority?: RunApprovalsExactAuthority | null,
  isExactAuthorityCurrent?: (authority: RunApprovalsExactAuthority) => boolean,
): {
  approvals: AgentRunApproval[];
  approvedUnconsumed: AgentRunApproval[];
  pendingCount: number;
  refresh: () => Promise<void>;
} {
  const [approvals, setApprovals] = useState<AgentRunApproval[]>([]);
  const [approvedUnconsumed, setApprovedUnconsumed] = useState<AgentRunApproval[]>([]);
  const refreshEpochRef = useRef(0);

  // Per-mount channel-topic suffix. supabase.channel() returns the EXISTING
  // instance for a duplicate topic, so two mounts (Chat + Office banners) with
  // a fixed `agent_run_approvals:${circleId}` topic would share one channel and
  // whichever unmounts first would removeChannel() it out from under the other.
  // A unique topic per mount gives each hook instance its own channel.
  const instanceId = useRef(Math.random().toString(36).slice(2)).current;
  const authorityKey = exactAuthority
    ? `${exactAuthority.userId}\u0000${exactAuthority.circleId}\u0000${exactAuthority.accessToken}\u0000${exactAuthority.authorityGeneration}`
    : 'compatibility';

  const refresh = useCallback(async () => {
    const refreshEpoch = ++refreshEpochRef.current;
    if (!circleId) {
      if (refreshEpoch === refreshEpochRef.current) {
        setApprovals([]);
        setApprovedUnconsumed([]);
      }
      return;
    }
    const capturedAuthority = exactAuthority ? { ...exactAuthority } : null;
    const authorityIsCurrent = () => Boolean(
      capturedAuthority
      && capturedAuthority.circleId === circleId
      && capturedAuthority.userId === userId
      && isExactAuthorityCurrent?.(capturedAuthority),
    );
    const [pendingRows, recoverableRows] = capturedAuthority
      ? await Promise.all([
          getPendingRunApprovalsExact(capturedAuthority, authorityIsCurrent),
          getApprovedUnconsumedRunApprovalsExact(capturedAuthority, authorityIsCurrent),
        ])
      : await Promise.all([
          getPendingRunApprovals(circleId, userId),
          userId ? getApprovedUnconsumedRunApprovals(circleId, userId) : Promise.resolve([]),
        ]);
    if (refreshEpoch !== refreshEpochRef.current) return;
    if (capturedAuthority && !authorityIsCurrent()) return;
    setApprovals(pendingRows);
    setApprovedUnconsumed(recoverableRows);
  }, [authorityKey, circleId, isExactAuthorityCurrent, userId]);

  useEffect(() => {
    if (!circleId) {
      refreshEpochRef.current += 1;
      setApprovals([]);
      setApprovedUnconsumed([]);
      return;
    }
    let cancelled = false;
    refresh();

    const channel = supabase
      .channel(`agent_run_approvals:${circleId}:${instanceId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'agent_run_approvals',
          filter: `circle_id=eq.${circleId}`,
        },
        () => {
          if (!cancelled) refresh();
        },
      )
      .subscribe();

    // Safety-net refresh every 30s — realtime channels can drop silently.
    const interval = setInterval(() => { if (!cancelled) refresh(); }, 30_000);

    return () => {
      cancelled = true;
      refreshEpochRef.current += 1;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [circleId, refresh]);

  const pendingCount = useMemo(() => approvals.length, [approvals]);
  return { approvals, approvedUnconsumed, pendingCount, refresh };
}
