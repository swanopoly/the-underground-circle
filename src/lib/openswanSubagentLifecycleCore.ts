/**
 * Pure, bounded readers for the current OpenSwan/OpenClaw subagent lifecycle
 * contract. These helpers intentionally consume structured tool details only;
 * human-facing `content`, `text`, `line`, `task`, and `label` fields are never
 * inspected for lifecycle identity or completion.
 */

export const OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS = Object.freeze({
  providerRunId: 160,
  childSessionKey: 160,
  providerStatus: 96,
  entriesPerBucket: 128,
} as const);

export interface OpenSwanSpawnHandle {
  status: 'accepted';
  /** Exact, provider-owned run identity. Null means the structured value was absent or unsafe. */
  providerRunId: string | null;
  /** Exact OpenSwan child-session identity. Null means the structured value was absent or unsafe. */
  childSessionKey: string | null;
}

export type OpenSwanSpawnPhase =
  | 'accepted'
  | 'provider_error_unknown_dispatch'
  | 'pre_dispatch_failed'
  | 'unrecognized_status';

export interface OpenSwanSpawnDisposition {
  providerStatus: string;
  providerRunId: string | null;
  childSessionKey: string | null;
  phase: OpenSwanSpawnPhase;
  /** Null means the provider response cannot prove whether the child started. */
  transportAccepted: boolean | null;
  taskCompletionVerified: false;
}

export type OpenSwanSessionSendPhase =
  | 'accepted'
  | 'turn_ended'
  | 'response_timeout'
  | 'provider_error_unknown_dispatch'
  | 'pre_dispatch_failed'
  | 'unrecognized_status';

export interface OpenSwanSessionSendHandle {
  /** Exact bounded value from the provider's structured `status` field. */
  providerStatus: string;
  providerRunId: string | null;
  sessionKey: string | null;
  phase: OpenSwanSessionSendPhase;
  /** Null means the structured status cannot prove whether dispatch started. */
  transportAccepted: boolean | null;
  /** Null means the structured status cannot prove whether a provider turn ended. */
  transportEnded: boolean | null;
  responseTimedOut: boolean;
  taskCompletionVerified: false;
  terminalResult: OpenSwanSubagentTerminalResult;
}

export type OpenSwanSubagentRuntimeStatus =
  | 'running'
  | 'done'
  | 'failed'
  | 'timeout'
  | 'unknown';

export type OpenSwanSubagentLifecycleSource = 'active' | 'recent';

export interface OpenSwanSubagentLifecycleRecord {
  providerRunId: string;
  childSessionKey: string;
  /** Normalized only from the structured bucket/status contract, never prose. */
  runtimeStatus: OpenSwanSubagentRuntimeStatus;
  /** Exact bounded value from the provider's structured `status` field. */
  providerStatus: string;
  source: OpenSwanSubagentLifecycleSource;
  pendingDescendants: number | null;
  runtimeMs: number | null;
  startedAt: number | null;
  endedAt: number | null;
}

export interface OpenSwanSubagentLifecycleSnapshot {
  active: readonly OpenSwanSubagentLifecycleRecord[];
  recent: readonly OpenSwanSubagentLifecycleRecord[];
}

export type OpenSwanSubagentLifecycleLookup =
  | {
    kind: 'found';
    providerRunId: string;
    record: OpenSwanSubagentLifecycleRecord;
  }
  | {
    kind: 'not_found';
    providerRunId: string;
  }
  | {
    kind: 'ambiguous';
    providerRunId: string;
    matches: number;
  }
  | {
    kind: 'invalid_id';
    providerRunId: null;
  };

export type OpenSwanSubagentTerminalResult = 'failed' | 'outcome_unknown' | null;

export type OpenSwanSubagentLifecycleReason =
  | 'provider_running'
  | 'provider_done_task_unverified'
  | 'provider_failed'
  | 'provider_timeout'
  | 'provider_unknown';

export interface OpenSwanSubagentLifecycleClassification {
  providerRuntimeStatus: OpenSwanSubagentRuntimeStatus;
  /** True only after the provider record has moved to the structured `recent` bucket. */
  transportEnded: boolean;
  /** The current provider list never proves that the requested task succeeded. */
  taskCompletionVerified: false;
  /** `done` is deliberately outcome_unknown until a typed task result exists. */
  terminalResult: OpenSwanSubagentTerminalResult;
  reason: OpenSwanSubagentLifecycleReason;
}

const OPENSWAN_LIFECYCLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const OPENSWAN_PROVIDER_STATUS_RE = /^[\x20-\x7e]+$/;
const MAX_SAFE_LIFECYCLE_NUMBER = Number.MAX_SAFE_INTEGER;

function isStructuredObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readStructuredField(source: object, key: string): unknown {
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Accept direct tool details, a raw tool result containing `details`, or the
 * gateway envelope containing `result.details`. No string field is decoded.
 */
function readStructuredDetails(input: unknown): object | null {
  if (!isStructuredObject(input)) return null;
  let source = input;
  const result = readStructuredField(source, 'result');
  if (isStructuredObject(result)) source = result;
  const details = readStructuredField(source, 'details');
  return isStructuredObject(details) ? details : source;
}

function readExactLifecycleId(value: unknown, maxChars: number): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > maxChars
    || value !== value.trim()
    || !OPENSWAN_LIFECYCLE_ID_RE.test(value)
  ) return null;
  return value;
}

function readProviderStatus(value: unknown): string | null {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.providerStatus
    || value !== value.trim()
    || !OPENSWAN_PROVIDER_STATUS_RE.test(value)
  ) return null;
  return value;
}

function readProviderStatusToken(value: unknown): string | null {
  return readExactLifecycleId(
    value,
    OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.providerStatus,
  );
}

function readOptionalSafeNumber(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || !Number.isInteger(value)
    || value < 0
    || value > MAX_SAFE_LIFECYCLE_NUMBER
  ) return null;
  return value;
}

function parseLifecycleRecord(
  input: unknown,
  source: OpenSwanSubagentLifecycleSource,
): OpenSwanSubagentLifecycleRecord | null {
  if (!isStructuredObject(input)) return null;
  const providerRunId = readExactLifecycleId(
    readStructuredField(input, 'runId'),
    OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.providerRunId,
  );
  const childSessionKey = readExactLifecycleId(
    readStructuredField(input, 'sessionKey'),
    OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.childSessionKey,
  );
  const providerStatus = readProviderStatus(readStructuredField(input, 'status'));
  if (!providerRunId || !childSessionKey || !providerStatus) return null;

  let runtimeStatus: OpenSwanSubagentRuntimeStatus;
  if (source === 'active') {
    // Bucket membership is the structured signal. In current OpenSwan the
    // provider status may be "active (waiting on ...)", which remains opaque.
    runtimeStatus = 'running';
  } else if (
    providerStatus === 'done'
    || providerStatus === 'failed'
    || providerStatus === 'timeout'
    || providerStatus === 'unknown'
  ) {
    runtimeStatus = providerStatus;
  } else {
    return null;
  }

  const endedAt = readOptionalSafeNumber(readStructuredField(input, 'endedAt'));
  // A recent-bucket row is terminal only when the current structured response
  // also carries its end timestamp. Missing/malformed proof remains unseen.
  if (source === 'recent' && endedAt === null) return null;

  return Object.freeze({
    providerRunId,
    childSessionKey,
    runtimeStatus,
    providerStatus,
    source,
    pendingDescendants: readOptionalSafeNumber(readStructuredField(input, 'pendingDescendants')),
    runtimeMs: readOptionalSafeNumber(readStructuredField(input, 'runtimeMs')),
    startedAt: readOptionalSafeNumber(readStructuredField(input, 'startedAt')),
    endedAt,
  });
}

function parseLifecycleBucket(
  input: unknown,
  source: OpenSwanSubagentLifecycleSource,
): readonly OpenSwanSubagentLifecycleRecord[] | null {
  if (!Array.isArray(input)) return null;
  try {
    if (input.length > OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.entriesPerBucket) return null;
    const records: OpenSwanSubagentLifecycleRecord[] = [];
    for (let index = 0; index < input.length; index += 1) {
      const record = parseLifecycleRecord(input[index], source);
      if (record) records.push(record);
    }
    return Object.freeze(records);
  } catch {
    return null;
  }
}

/** Parse the structured current `sessions_spawn` disposition without prose. */
export function parseOpenSwanSpawnDisposition(
  input: unknown,
): OpenSwanSpawnDisposition | null {
  try {
    const details = readStructuredDetails(input);
    if (!details) return null;
    const providerStatus = readProviderStatusToken(readStructuredField(details, 'status'));
    if (!providerStatus) return null;
    const rawProviderRunId = readStructuredField(details, 'runId');
    const rawChildSessionKey = readStructuredField(details, 'childSessionKey');
    const providerRunId = readExactLifecycleId(
      rawProviderRunId,
      OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.providerRunId,
    );
    const childSessionKey = readExactLifecycleId(
      rawChildSessionKey,
      OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.childSessionKey,
    );
    const identity = {
      providerStatus,
      providerRunId,
      childSessionKey,
      taskCompletionVerified: false as const,
    };
    if (providerStatus === 'accepted') {
      return Object.freeze({ ...identity, phase: 'accepted', transportAccepted: true });
    }
    if (providerStatus === 'error') {
      // Current OpenSwan can report an ACP registration error after starting
      // the child. Both identities survive that shape, but they do not prove
      // whether execution began, so preserve them and remain uncertain.
      const hasRawProviderRunId = rawProviderRunId !== undefined && rawProviderRunId !== null;
      const hasRawChildSessionKey = rawChildSessionKey !== undefined && rawChildSessionKey !== null;
      const hasInvalidIdentity = (hasRawProviderRunId && !providerRunId)
        || (hasRawChildSessionKey && !childSessionKey);
      if (hasInvalidIdentity || !!providerRunId) {
        return Object.freeze({
          ...identity,
          phase: 'provider_error_unknown_dispatch',
          transportAccepted: null,
        });
      }
      return Object.freeze({ ...identity, phase: 'pre_dispatch_failed', transportAccepted: false });
    }
    if (providerStatus === 'forbidden' || providerStatus === 'not_found' || providerStatus === 'not-found') {
      return Object.freeze({ ...identity, phase: 'pre_dispatch_failed', transportAccepted: false });
    }
    return Object.freeze({ ...identity, phase: 'unrecognized_status', transportAccepted: null });
  } catch {
    return null;
  }
}

/** Parse only a structured accepted spawn handle for legacy accepted callers. */
export function parseOpenSwanSpawnHandle(input: unknown): OpenSwanSpawnHandle | null {
  const disposition = parseOpenSwanSpawnDisposition(input);
  if (!disposition || disposition.phase !== 'accepted') return null;
  return Object.freeze({
    status: 'accepted',
    providerRunId: disposition.providerRunId,
    childSessionKey: disposition.childSessionKey,
  });
}

/**
 * Parse only current structured `sessions_send` details. An inline reply is
 * deliberately ignored: even `ok` proves only that the provider turn ended,
 * not that the user's requested task completed.
 */
export function parseOpenSwanSessionSendHandle(
  input: unknown,
): OpenSwanSessionSendHandle | null {
  try {
    const details = readStructuredDetails(input);
    if (!details) return null;
    const providerStatus = readProviderStatusToken(readStructuredField(details, 'status'));
    if (!providerStatus) return null;

    const rawProviderRunId = readStructuredField(details, 'runId');
    const rawSessionKey = readStructuredField(details, 'sessionKey');
    const providerRunId = readExactLifecycleId(
      rawProviderRunId,
      OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.providerRunId,
    );
    const sessionKey = readExactLifecycleId(
      rawSessionKey,
      OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.childSessionKey,
    );
    const identity = {
      providerStatus,
      providerRunId,
      sessionKey,
      taskCompletionVerified: false as const,
    };

    switch (providerStatus) {
      case 'accepted':
        return Object.freeze({
          ...identity,
          phase: 'accepted',
          transportAccepted: true,
          transportEnded: false,
          responseTimedOut: false,
          terminalResult: null,
        });
      case 'ok':
        return Object.freeze({
          ...identity,
          phase: 'turn_ended',
          transportAccepted: true,
          transportEnded: true,
          responseTimedOut: false,
          terminalResult: 'outcome_unknown',
        });
      case 'timeout':
        return Object.freeze({
          ...identity,
          phase: 'response_timeout',
          transportAccepted: true,
          transportEnded: false,
          responseTimedOut: true,
          terminalResult: null,
        });
      case 'error':
        // Current OpenSwan uses `error` both before dispatch (resolution or
        // agent-start failure) and after an already-started waited turn. A
        // generated run id plus session key exists in both shapes, so neither
        // identity can disambiguate whether provider work began.
        const hasRawProviderRunId = rawProviderRunId !== undefined && rawProviderRunId !== null;
        const hasRawSessionKey = rawSessionKey !== undefined && rawSessionKey !== null;
        const hasInvalidIdentity = (hasRawProviderRunId && !providerRunId)
          || (hasRawSessionKey && !sessionKey);
        if (!hasInvalidIdentity && !providerRunId && !sessionKey) {
          return Object.freeze({
            ...identity,
            phase: 'pre_dispatch_failed',
            transportAccepted: false,
            transportEnded: false,
            responseTimedOut: false,
            terminalResult: 'failed',
          });
        }
        return Object.freeze({
          ...identity,
          phase: 'provider_error_unknown_dispatch',
          transportAccepted: null,
          transportEnded: null,
          responseTimedOut: false,
          terminalResult: 'outcome_unknown',
        });
      case 'forbidden':
      case 'not_found':
      case 'not-found':
        return Object.freeze({
          ...identity,
          phase: 'pre_dispatch_failed',
          transportAccepted: false,
          transportEnded: false,
          responseTimedOut: false,
          terminalResult: 'failed',
        });
      default:
        // Future/hostile statuses retain their bounded token for diagnostics,
        // but can never be promoted to dispatch acceptance or completion.
        return Object.freeze({
          ...identity,
          phase: 'unrecognized_status',
          transportAccepted: null,
          transportEnded: null,
          responseTimedOut: false,
          terminalResult: 'outcome_unknown',
        });
    }
  } catch {
    return null;
  }
}

/** Parse current `subagents action:list` details.active/details.recent arrays. */
export function parseOpenSwanSubagentLifecycleSnapshot(
  input: unknown,
): OpenSwanSubagentLifecycleSnapshot | null {
  try {
    const details = readStructuredDetails(input);
    if (
      !details
      || readStructuredField(details, 'status') !== 'ok'
      || readStructuredField(details, 'action') !== 'list'
    ) return null;

    const active = parseLifecycleBucket(readStructuredField(details, 'active'), 'active');
    const recent = parseLifecycleBucket(readStructuredField(details, 'recent'), 'recent');
    if (!active || !recent) return null;
    return Object.freeze({ active, recent });
  } catch {
    return null;
  }
}

/**
 * Exact, case-sensitive provider-run lookup. Multiple matching structured rows
 * are ambiguous and never resolved by order or partial identity.
 */
export function lookupOpenSwanSubagentLifecycleByProviderRunId(
  snapshot: OpenSwanSubagentLifecycleSnapshot | null | undefined,
  providerRunId: unknown,
): OpenSwanSubagentLifecycleLookup {
  const exactId = readExactLifecycleId(
    providerRunId,
    OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.providerRunId,
  );
  if (!exactId) return Object.freeze({ kind: 'invalid_id', providerRunId: null });
  if (!snapshot) return Object.freeze({ kind: 'not_found', providerRunId: exactId });

  try {
    const buckets = [snapshot.active, snapshot.recent] as const;
    let found: OpenSwanSubagentLifecycleRecord | null = null;
    let matches = 0;
    for (const bucket of buckets) {
      if (
        !Array.isArray(bucket)
        || bucket.length > OPENSWAN_SUBAGENT_LIFECYCLE_LIMITS.entriesPerBucket
      ) return Object.freeze({ kind: 'ambiguous', providerRunId: exactId, matches: 0 });
      for (const record of bucket) {
        if (record?.providerRunId !== exactId) continue;
        matches += 1;
        if (!found) found = record;
      }
    }
    if (matches === 0 || !found) {
      return Object.freeze({ kind: 'not_found', providerRunId: exactId });
    }
    if (matches > 1) {
      return Object.freeze({ kind: 'ambiguous', providerRunId: exactId, matches });
    }
    return Object.freeze({ kind: 'found', providerRunId: exactId, record: found });
  } catch {
    return Object.freeze({ kind: 'ambiguous', providerRunId: exactId, matches: 0 });
  }
}

/** Convenience reader that returns a record only for a unique exact match. */
export function findOpenSwanSubagentLifecycleByProviderRunId(
  snapshot: OpenSwanSubagentLifecycleSnapshot | null | undefined,
  providerRunId: unknown,
): OpenSwanSubagentLifecycleRecord | null {
  const lookup = lookupOpenSwanSubagentLifecycleByProviderRunId(snapshot, providerRunId);
  return lookup.kind === 'found' ? lookup.record : null;
}

/**
 * Classify transport evidence without promoting provider `done` to task
 * completion. Missing/invalid records return null so polling lag is not turned
 * into a terminal result.
 */
export function classifyOpenSwanSubagentLifecycle(
  record: OpenSwanSubagentLifecycleRecord | null | undefined,
): OpenSwanSubagentLifecycleClassification | null {
  if (!record) return null;
  try {
    switch (record.runtimeStatus) {
      case 'running':
        return Object.freeze({
          providerRuntimeStatus: 'running',
          transportEnded: false,
          taskCompletionVerified: false,
          terminalResult: null,
          reason: 'provider_running',
        });
      case 'done':
        return Object.freeze({
          providerRuntimeStatus: 'done',
          transportEnded: true,
          taskCompletionVerified: false,
          terminalResult: 'outcome_unknown',
          reason: 'provider_done_task_unverified',
        });
      case 'failed':
        return Object.freeze({
          providerRuntimeStatus: 'failed',
          transportEnded: true,
          taskCompletionVerified: false,
          terminalResult: 'failed',
          reason: 'provider_failed',
        });
      case 'timeout':
        return Object.freeze({
          providerRuntimeStatus: 'timeout',
          transportEnded: true,
          taskCompletionVerified: false,
          terminalResult: 'outcome_unknown',
          reason: 'provider_timeout',
        });
      case 'unknown':
        return Object.freeze({
          providerRuntimeStatus: 'unknown',
          transportEnded: true,
          taskCompletionVerified: false,
          terminalResult: 'outcome_unknown',
          reason: 'provider_unknown',
        });
      default:
        return null;
    }
  } catch {
    return null;
  }
}
