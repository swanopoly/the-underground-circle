/**
 * One-shot ordering gate for exact Chat plan approvals.
 *
 * Realtime resolution can arrive before the filing call returns and registers
 * the in-memory resume owner. This dependency-free gate retains that early
 * decision, hands it to registration exactly once, and rejects duplicate or
 * conflicting callbacks. It carries no task text or approval payload.
 */

export type ExactPlanApprovalResolution = 'approved' | 'rejected';

const EXACT_APPROVAL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EXACT_APPROVAL_FINGERPRINT_RE = /^args-v2:sha256:[0-9a-f]{64}$/;
const EXACT_APPROVAL_ACTION_RE = /^chat\.run_computer_task(?:\.[a-z0-9_-]{1,80})?$/i;
const EXACT_APPROVAL_PROGRAM_RE = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const EXACT_APPROVAL_SESSION_RE = /^chat::[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const EXACT_APPROVAL_REQUEST_IDENTITY_MAX = 240;
const EXACT_APPROVAL_EXPIRY_SKEW_MS = 2 * 60 * 1000;
const EXACT_APPROVAL_MAX_TIMEOUT_SECONDS = 24 * 60 * 60;

/**
 * Value-only, credential-free correlation needed to resume one exact Chat
 * plan after a full tab reload. This is a pointer to authority, never
 * authority itself: the approval gate still re-fingerprints the rebuilt plan
 * and atomically consumes the matching server row before dispatch.
 */
export interface ExactPlanApprovalCorrelation {
  schemaVersion: 1;
  approvalId: string;
  circleId: string;
  threadId: string;
  userId: string;
  sessionKey: string;
  actionType: string;
  expiresAtMs: number;
  programId: string;
  programFingerprint: string;
  requestIdentity: string;
  requestIdentityFingerprint: string;
  approvalIntentFingerprint: string;
}

export interface ExactPlanApprovalExpectedScope {
  circleId: string;
  threadId: string;
  userId: string;
  sessionKey: string;
  actionType: string;
  programId: string;
  programFingerprint: string;
  requestIdentity: string;
  requestIdentityFingerprint: string;
  approvalIntentFingerprint: string;
}

export interface ExactPlanApprovalRowSnapshot {
  id?: unknown;
  circle_id?: unknown;
  session_key?: unknown;
  action_type?: unknown;
  status?: unknown;
  requested_at?: unknown;
  timeout_seconds?: unknown;
  resolved_at?: unknown;
  resolved_by?: unknown;
  applied_at?: unknown;
  payload?: unknown;
}

export type ExactPlanApprovalRowDecision =
  | { kind: 'pending'; expiresAtMs: number }
  | { kind: 'approved'; expiresAtMs: number }
  | { kind: 'rejected'; expiresAtMs: number }
  | { kind: 'expired'; expiresAtMs: number }
  | {
      kind: 'invalid';
      reason:
        | 'legacy_or_malformed_correlation'
        | 'scope_mismatch'
        | 'program_mismatch'
        | 'request_mismatch'
        | 'approval_intent_mismatch'
        | 'row_missing_or_mismatched'
        | 'row_payload_mismatch'
        | 'row_timing_invalid'
        | 'already_consumed'
        | 'unknown_status';
    };

export type ExactPlanApprovalRegisterResult =
  | { kind: 'pending' }
  | { kind: 'resolved'; status: ExactPlanApprovalResolution }
  | { kind: 'duplicate' };

export type ExactPlanApprovalResolveResult =
  | { kind: 'queued_before_registration' }
  | { kind: 'ready'; status: ExactPlanApprovalResolution }
  | { kind: 'duplicate' };

export interface ExactPlanApprovalContinuityGate {
  register(approvalId: string): ExactPlanApprovalRegisterResult;
  resolve(approvalId: string, status: ExactPlanApprovalResolution): ExactPlanApprovalResolveResult;
  forget(approvalId: string): void;
  clear(): void;
}

function safeApprovalId(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 200) : '';
}

function safeBoundedString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  if (!normalized || normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) return '';
  return normalized;
}

function safeUuid(value: unknown): string {
  const normalized = safeBoundedString(value, 80);
  return EXACT_APPROVAL_UUID_RE.test(normalized) ? normalized : '';
}

function safeFingerprint(value: unknown): string {
  const normalized = safeBoundedString(value, 96);
  return EXACT_APPROVAL_FINGERPRINT_RE.test(normalized) ? normalized : '';
}

/**
 * Strict persistence boundary. Unknown keys (including credentials, raw
 * payloads, command text, and tokens) are never copied into the durable
 * correlation. Missing/legacy fields fail closed instead of being guessed.
 */
export function compactExactPlanApprovalCorrelation(
  value: unknown,
): ExactPlanApprovalCorrelation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) return null;

  const approvalId = safeUuid(input.approvalId);
  const circleId = safeUuid(input.circleId);
  const threadId = safeUuid(input.threadId);
  const userId = safeUuid(input.userId);
  const sessionKey = safeBoundedString(input.sessionKey, 240);
  const actionType = safeBoundedString(input.actionType, 120);
  const programId = safeBoundedString(input.programId, 120);
  const programFingerprint = safeFingerprint(input.programFingerprint);
  const requestIdentity = safeBoundedString(input.requestIdentity, EXACT_APPROVAL_REQUEST_IDENTITY_MAX);
  const requestIdentityFingerprint = safeFingerprint(input.requestIdentityFingerprint);
  const approvalIntentFingerprint = safeFingerprint(input.approvalIntentFingerprint);
  const expiresAtMs = Number(input.expiresAtMs);

  if (
    !approvalId
    || !circleId
    || !threadId
    || !userId
    || !EXACT_APPROVAL_SESSION_RE.test(sessionKey)
    || !EXACT_APPROVAL_ACTION_RE.test(actionType)
    || !EXACT_APPROVAL_PROGRAM_RE.test(programId)
    || !programFingerprint
    || !requestIdentity
    || !requestIdentityFingerprint
    || !approvalIntentFingerprint
    || !Number.isSafeInteger(expiresAtMs)
    || expiresAtMs <= 0
  ) return null;

  return {
    schemaVersion: 1,
    approvalId,
    circleId,
    threadId,
    userId,
    sessionKey,
    actionType,
    expiresAtMs,
    programId,
    programFingerprint,
    requestIdentity,
    requestIdentityFingerprint,
    approvalIntentFingerprint,
  };
}

export function exactPlanApprovalCorrelationMatchesScope(
  value: unknown,
  expected: ExactPlanApprovalExpectedScope,
): value is ExactPlanApprovalCorrelation {
  const correlation = compactExactPlanApprovalCorrelation(value);
  if (!correlation) return false;
  return correlation.circleId === expected.circleId
    && correlation.threadId === expected.threadId
    && correlation.userId === expected.userId
    && correlation.sessionKey === expected.sessionKey
    && correlation.actionType === expected.actionType
    && correlation.programId === expected.programId
    && correlation.programFingerprint === expected.programFingerprint
    && correlation.requestIdentity === expected.requestIdentity
    && correlation.requestIdentityFingerprint === expected.requestIdentityFingerprint
    && correlation.approvalIntentFingerprint === expected.approvalIntentFingerprint;
}

function invalid(reason: Extract<ExactPlanApprovalRowDecision, { kind: 'invalid' }>['reason']): ExactPlanApprovalRowDecision {
  return { kind: 'invalid', reason };
}

/**
 * Reconcile a freshly queried exact row against the persisted correlation and
 * the currently authenticated Chat scope. Realtime payloads are deliberately
 * not trusted; callers pass the result of an exact-row requery here.
 */
export function reconcileExactPlanApprovalRow(input: {
  correlation: unknown;
  expected: ExactPlanApprovalExpectedScope;
  row: ExactPlanApprovalRowSnapshot | null | undefined;
  nowMs?: number;
}): ExactPlanApprovalRowDecision {
  const correlation = compactExactPlanApprovalCorrelation(input.correlation);
  if (!correlation) return invalid('legacy_or_malformed_correlation');
  const expected = input.expected;
  if (
    correlation.circleId !== expected.circleId
    || correlation.threadId !== expected.threadId
    || correlation.userId !== expected.userId
    || correlation.sessionKey !== expected.sessionKey
    || correlation.actionType !== expected.actionType
  ) return invalid('scope_mismatch');
  if (
    correlation.programId !== expected.programId
    || correlation.programFingerprint !== expected.programFingerprint
  ) return invalid('program_mismatch');
  if (
    correlation.requestIdentity !== expected.requestIdentity
    || correlation.requestIdentityFingerprint !== expected.requestIdentityFingerprint
  ) return invalid('request_mismatch');
  if (correlation.approvalIntentFingerprint !== expected.approvalIntentFingerprint) {
    return invalid('approval_intent_mismatch');
  }

  const row = input.row;
  if (!row || typeof row !== 'object') return invalid('row_missing_or_mismatched');
  if (
    safeUuid(row.id) !== correlation.approvalId
    || safeUuid(row.circle_id) !== correlation.circleId
    || safeBoundedString(row.session_key, 240) !== correlation.sessionKey
    || safeBoundedString(row.action_type, 120) !== correlation.actionType
  ) return invalid('row_missing_or_mismatched');

  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : null;
  if (
    !payload
    || payload.approvalSchemaVersion !== 2
    || payload.redacted !== true
    || safeUuid(payload.userId) !== correlation.userId
    || safeUuid(payload.threadId) !== correlation.threadId
    || safeFingerprint(payload.approvalIntentFingerprint) !== correlation.approvalIntentFingerprint
  ) return invalid('row_payload_mismatch');

  const requestedAtMs = Date.parse(String(row.requested_at || ''));
  const timeoutSeconds = Number(row.timeout_seconds);
  const rowExpiresAtMs = requestedAtMs + timeoutSeconds * 1000;
  if (
    !Number.isFinite(requestedAtMs)
    || !Number.isFinite(timeoutSeconds)
    || timeoutSeconds <= 0
    || timeoutSeconds > EXACT_APPROVAL_MAX_TIMEOUT_SECONDS
    || !Number.isSafeInteger(rowExpiresAtMs)
    || Math.abs(rowExpiresAtMs - correlation.expiresAtMs) > EXACT_APPROVAL_EXPIRY_SKEW_MS
  ) return invalid('row_timing_invalid');

  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const effectiveExpiresAtMs = Math.min(rowExpiresAtMs, correlation.expiresAtMs);
  if (nowMs >= effectiveExpiresAtMs || String(row.status || '') === 'expired') {
    return { kind: 'expired', expiresAtMs: effectiveExpiresAtMs };
  }

  const status = String(row.status || '');
  if (status === 'pending') return { kind: 'pending', expiresAtMs: effectiveExpiresAtMs };
  if (status === 'rejected') return { kind: 'rejected', expiresAtMs: effectiveExpiresAtMs };
  if (status === 'consumed' || (typeof row.applied_at === 'string' && row.applied_at.trim())) {
    return invalid('already_consumed');
  }
  if (status === 'approved' || status === 'auto_approved') {
    const resolvedAtMs = Date.parse(String(row.resolved_at || ''));
    if (
      !safeUuid(row.resolved_by)
      || !Number.isFinite(resolvedAtMs)
      || resolvedAtMs < requestedAtMs
      || resolvedAtMs >= rowExpiresAtMs
      || resolvedAtMs > nowMs + EXACT_APPROVAL_EXPIRY_SKEW_MS
    ) return invalid('row_timing_invalid');
    return { kind: 'approved', expiresAtMs: effectiveExpiresAtMs };
  }
  return invalid('unknown_status');
}

export function createExactPlanApprovalContinuityGate(): ExactPlanApprovalContinuityGate {
  const registered = new Set<string>();
  const earlyResolutions = new Map<string, ExactPlanApprovalResolution>();
  const claimed = new Set<string>();

  return {
    register(rawApprovalId) {
      const approvalId = safeApprovalId(rawApprovalId);
      if (!approvalId || claimed.has(approvalId)) return { kind: 'duplicate' };
      registered.add(approvalId);
      const early = earlyResolutions.get(approvalId);
      if (!early) return { kind: 'pending' };
      earlyResolutions.delete(approvalId);
      claimed.add(approvalId);
      return { kind: 'resolved', status: early };
    },

    resolve(rawApprovalId, status) {
      const approvalId = safeApprovalId(rawApprovalId);
      if (!approvalId || claimed.has(approvalId) || earlyResolutions.has(approvalId)) {
        return { kind: 'duplicate' };
      }
      if (!registered.has(approvalId)) {
        earlyResolutions.set(approvalId, status);
        return { kind: 'queued_before_registration' };
      }
      claimed.add(approvalId);
      return { kind: 'ready', status };
    },

    forget(rawApprovalId) {
      const approvalId = safeApprovalId(rawApprovalId);
      if (!approvalId) return;
      registered.delete(approvalId);
      earlyResolutions.delete(approvalId);
      claimed.delete(approvalId);
    },

    clear() {
      registered.clear();
      earlyResolutions.clear();
      claimed.clear();
    },
  };
}
