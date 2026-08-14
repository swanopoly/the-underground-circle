import {
  classifyDesktopBridgeHealth,
  type DesktopBridgeHealthClassification,
} from './desktopBridgeProtocol';

export const COMPUTER_CAPABILITY_PREPARED_SNAPSHOT_MAX_AGE_MS = 30_000;

export type ComputerCapabilityPreparedSnapshotRejectionCode =
  | 'invalid_snapshot'
  | 'invalid_observed_at'
  | 'observation_from_future'
  | 'snapshot_stale'
  | 'invalid_bridge_instance'
  | 'bridge_instance_missing'
  | 'bridge_instance_drift'
  | 'invalid_local_browser_readiness';

export interface BuildComputerCapabilityPreparedSnapshotInput {
  /** Capture time for the completed desktop/browser preparation observation. */
  observedAt?: string;
  /** Raw `/desktop/health` response captured by the task-start preparation. */
  desktopHealth?: unknown;
  /** Either `DesktopBrowserReadiness.browser` or raw `/browser/health`. */
  localBrowserReadiness?: unknown;
  /** Optional task-bound instance captured immediately after auto-connect. */
  expectedBridgeInstanceId?: string | null;
}

export interface NormalizeComputerCapabilityPreparedSnapshotOptions {
  /** Test seam only; production callers omit it. */
  nowMs?: number;
  /** Reject an otherwise-current snapshot when the task-bound process changed. */
  expectedBridgeInstanceId?: string | null;
}

export interface AcceptedComputerCapabilityPreparedSnapshot {
  readonly schemaVersion: 1;
  readonly status: 'accepted';
  readonly observedAt: string;
  readonly expiresAt: string;
  readonly bridgeInstanceId: string | null;
  readonly desktopBridgeReadiness: DesktopBridgeHealthClassification;
  readonly localBrowser: Readonly<{
    ready: boolean;
    contextOpen: boolean;
  }>;
}

export interface RejectedComputerCapabilityPreparedSnapshot {
  readonly schemaVersion: 1;
  readonly status: 'rejected';
  readonly rejectionCode: ComputerCapabilityPreparedSnapshotRejectionCode;
  readonly detail: string;
  readonly observedAt: string | null;
  readonly bridgeInstanceId: string | null;
}

export type ComputerCapabilityPreparedSnapshot =
  | AcceptedComputerCapabilityPreparedSnapshot
  | RejectedComputerCapabilityPreparedSnapshot;

export interface ComputerCapabilityPreparedSnapshotSummary {
  status: 'not_provided' | 'accepted' | 'rejected';
  rejectionCode: ComputerCapabilityPreparedSnapshotRejectionCode | null;
  observedAt: string | null;
  bridgeInstanceId: string | null;
  localBrowserReady: boolean;
  localBrowserContextOpen: boolean;
}

export interface AuditComputerCapabilitiesOptions {
  /**
   * Runtime-issued immutable evidence captured after task-start auto-connect.
   * Presence is authoritative: invalid/stale evidence fails closed and never
   * falls back to a second desktop probe.
   */
  preparedSnapshot?: ComputerCapabilityPreparedSnapshot | null;
  /** Current task-bound bridge process, when one was captured by the caller. */
  expectedBridgeInstanceId?: string | null;
  /** Deterministic freshness seam for focused audits; production omits it. */
  nowMs?: number;
}

export type ComputerBrowserCapabilityStatus = 'ready' | 'partial' | 'missing';

export interface ComputerBrowserCapabilityStatuses {
  browserAutomation: ComputerBrowserCapabilityStatus;
  browserSessions: ComputerBrowserCapabilityStatus;
}

const PREPARED_SNAPSHOT_BRAND = new WeakSet<object>();
const BRIDGE_INSTANCE_ID_RE = /^[A-Za-z0-9._:-]{8,128}$/u;
const PREPARED_SNAPSHOT_FUTURE_TOLERANCE_MS = 1_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function issuedPreparedSnapshot<T extends ComputerCapabilityPreparedSnapshot>(snapshot: T): T {
  PREPARED_SNAPSHOT_BRAND.add(snapshot);
  return Object.freeze(snapshot);
}

function rejectedPreparedSnapshot(
  rejectionCode: ComputerCapabilityPreparedSnapshotRejectionCode,
  detail: string,
  input: { observedAt?: string | null; bridgeInstanceId?: string | null } = {},
): RejectedComputerCapabilityPreparedSnapshot {
  return issuedPreparedSnapshot({
    schemaVersion: 1,
    status: 'rejected',
    rejectionCode,
    detail,
    observedAt: input.observedAt || null,
    bridgeInstanceId: input.bridgeInstanceId || null,
  });
}

function parseBridgeInstanceId(value: unknown): { ok: true; value: string | null } | { ok: false } {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };
  const normalized = value.trim();
  return BRIDGE_INSTANCE_ID_RE.test(normalized)
    ? { ok: true, value: normalized }
    : { ok: false };
}

function parseObservedAt(
  value: unknown,
  nowMs: number,
): { ok: true; value: string; ms: number } | {
  ok: false;
  code: Extract<ComputerCapabilityPreparedSnapshotRejectionCode,
    'invalid_observed_at' | 'observation_from_future' | 'snapshot_stale'>;
  detail: string;
} {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return { ok: false, code: 'invalid_observed_at', detail: 'Prepared capability evidence needs a canonical ISO capture time.' };
  }
  const observedAtMs = Date.parse(value);
  if (!Number.isFinite(observedAtMs)) {
    return { ok: false, code: 'invalid_observed_at', detail: 'Prepared capability evidence has an invalid capture time.' };
  }
  if (observedAtMs > nowMs + PREPARED_SNAPSHOT_FUTURE_TOLERANCE_MS) {
    return { ok: false, code: 'observation_from_future', detail: 'Prepared capability evidence is future-dated.' };
  }
  if (nowMs - observedAtMs > COMPUTER_CAPABILITY_PREPARED_SNAPSHOT_MAX_AGE_MS) {
    return { ok: false, code: 'snapshot_stale', detail: 'Prepared capability evidence expired before the capability audit.' };
  }
  return { ok: true, value: new Date(observedAtMs).toISOString(), ms: observedAtMs };
}

function parseLocalBrowserReadiness(
  value: unknown,
): { ok: true; ready: boolean; contextOpen: boolean } | { ok: false } {
  if (value === null || value === undefined) return { ok: true, ready: false, contextOpen: false };
  if (!isRecord(value)) return { ok: false };

  const readyValue = typeof value.ready === 'boolean'
    ? value.ready
    : typeof value.ok === 'boolean'
      ? value.ok
      : null;
  if (readyValue === null) return { ok: false };
  if (typeof value.ready === 'boolean' && typeof value.ok === 'boolean' && value.ready !== value.ok) return { ok: false };
  if (value.contextOpen !== undefined && typeof value.contextOpen !== 'boolean') return { ok: false };
  const contextOpen = value.contextOpen === true;
  if (contextOpen && !readyValue) return { ok: false };
  return { ok: true, ready: readyValue, contextOpen };
}

/**
 * Seal one task-start desktop/browser observation. The returned object is
 * deeply immutable for every mutable field and runtime-branded, so a JSON copy
 * cannot become execution readiness. Rejected snapshots are safe to pass to
 * `auditComputerCapabilities`; their presence suppresses a second probe.
 */
export function buildComputerCapabilityPreparedSnapshot(
  input: BuildComputerCapabilityPreparedSnapshotInput,
  options: Pick<NormalizeComputerCapabilityPreparedSnapshotOptions, 'nowMs'> = {},
): ComputerCapabilityPreparedSnapshot {
  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  if (!isRecord(input)) {
    return rejectedPreparedSnapshot('invalid_snapshot', 'Prepared capability evidence must be an object.');
  }

  const observedAt = parseObservedAt(input.observedAt || new Date(nowMs).toISOString(), nowMs);
  if (observedAt.ok === false) return rejectedPreparedSnapshot(observedAt.code, observedAt.detail);

  const desktopHealth = input.desktopHealth;
  const desktopRecord = isRecord(desktopHealth) ? desktopHealth : null;
  const observedInstance = parseBridgeInstanceId(desktopRecord?.instanceId);
  const expectedInstance = parseBridgeInstanceId(input.expectedBridgeInstanceId);
  if (!observedInstance.ok || !expectedInstance.ok) {
    return rejectedPreparedSnapshot(
      'invalid_bridge_instance',
      'Prepared capability evidence contains an invalid bridge process identity.',
      { observedAt: observedAt.value },
    );
  }
  if (expectedInstance.value && !observedInstance.value) {
    return rejectedPreparedSnapshot(
      'bridge_instance_missing',
      'Prepared capability evidence did not include the task-bound bridge process identity.',
      { observedAt: observedAt.value },
    );
  }
  if (expectedInstance.value && observedInstance.value !== expectedInstance.value) {
    return rejectedPreparedSnapshot(
      'bridge_instance_drift',
      'The prepared capability evidence came from a different bridge process.',
      { observedAt: observedAt.value, bridgeInstanceId: observedInstance.value },
    );
  }

  const localBrowser = parseLocalBrowserReadiness(input.localBrowserReadiness);
  if (!localBrowser.ok) {
    return rejectedPreparedSnapshot(
      'invalid_local_browser_readiness',
      'Prepared local-browser readiness was malformed or contradictory.',
      { observedAt: observedAt.value, bridgeInstanceId: observedInstance.value },
    );
  }

  const desktopBridgeReadiness = classifyDesktopBridgeHealth(desktopHealth);
  if ((desktopBridgeReadiness.genericToolsReady || localBrowser.ready) && !observedInstance.value) {
    return rejectedPreparedSnapshot(
      'bridge_instance_missing',
      'Ready local capabilities must be bound to one exact bridge process.',
      { observedAt: observedAt.value },
    );
  }

  return issuedPreparedSnapshot({
    schemaVersion: 1,
    status: 'accepted',
    observedAt: observedAt.value,
    expiresAt: new Date(observedAt.ms + COMPUTER_CAPABILITY_PREPARED_SNAPSHOT_MAX_AGE_MS).toISOString(),
    bridgeInstanceId: observedInstance.value,
    desktopBridgeReadiness,
    localBrowser: Object.freeze({
      ready: localBrowser.ready,
      contextOpen: localBrowser.contextOpen,
    }),
  });
}

/** Revalidate brand, freshness, and optional task-bound instance at use time. */
export function normalizeComputerCapabilityPreparedSnapshot(
  value: unknown,
  options: NormalizeComputerCapabilityPreparedSnapshotOptions = {},
): ComputerCapabilityPreparedSnapshot {
  if (!isRecord(value) || !PREPARED_SNAPSHOT_BRAND.has(value)) {
    return rejectedPreparedSnapshot('invalid_snapshot', 'Prepared capability evidence was not issued by this runtime.');
  }
  const snapshot = value as unknown as ComputerCapabilityPreparedSnapshot;
  if (snapshot.status === 'rejected') return snapshot;

  const nowMs = Number.isFinite(options.nowMs) ? Number(options.nowMs) : Date.now();
  const observedAt = parseObservedAt(snapshot.observedAt, nowMs);
  if (observedAt.ok === false) {
    return rejectedPreparedSnapshot(observedAt.code, observedAt.detail, {
      observedAt: snapshot.observedAt,
      bridgeInstanceId: snapshot.bridgeInstanceId,
    });
  }
  const expectedInstance = parseBridgeInstanceId(options.expectedBridgeInstanceId);
  if (!expectedInstance.ok) {
    return rejectedPreparedSnapshot('invalid_bridge_instance', 'The task-bound bridge process identity was invalid.', {
      observedAt: snapshot.observedAt,
      bridgeInstanceId: snapshot.bridgeInstanceId,
    });
  }
  if (expectedInstance.value && snapshot.bridgeInstanceId !== expectedInstance.value) {
    return rejectedPreparedSnapshot('bridge_instance_drift', 'The bridge process changed after capability preparation.', {
      observedAt: snapshot.observedAt,
      bridgeInstanceId: snapshot.bridgeInstanceId,
    });
  }
  return snapshot;
}

/** Pure browser capability projection shared by audit and focused smokes. */
export function resolveComputerBrowserCapabilityStatuses(input: {
  remoteAutomationReady: boolean;
  remoteSessionsReady: boolean;
  localBrowserReady: boolean;
  localBrowserContextOpen: boolean;
}): ComputerBrowserCapabilityStatuses {
  const browserAutomationReady = input.remoteAutomationReady || input.remoteSessionsReady || input.localBrowserReady;
  const browserSessionsReady = input.remoteSessionsReady || (input.localBrowserReady && input.localBrowserContextOpen);
  return {
    browserAutomation: browserAutomationReady ? 'ready' : 'missing',
    browserSessions: browserSessionsReady ? 'ready' : browserAutomationReady ? 'partial' : 'missing',
  };
}

/** Prepared evidence owns the task-start observation even when it is rejected. */
export function shouldProbeDesktopBridgeForCapabilityAudit(
  options: AuditComputerCapabilitiesOptions = {},
): boolean {
  return !Object.prototype.hasOwnProperty.call(options, 'preparedSnapshot');
}
