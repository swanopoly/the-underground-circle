/**
 * In-process foreground-ownership coordinator for one admitted computer-task
 * action.
 *
 * This module never focuses an app or browser itself. It only decides whether
 * one exact target activation may be dispatched, records that activation
 * budget before handler entry, and turns any later foreground drift into an
 * irreversible interrupt for this lease. A durable task coordinator must
 * eventually persist the same state machine with compare-and-set semantics
 * before this can survive refresh or process death.
 */

export const COMPUTER_FOREGROUND_LEASE_MAX_TTL_MS = 120_000;

const BOUNDED_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,199}$/;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const OPAQUE_BROWSER_URL_IDENTITY_RE = /^uc_browser_url_[a-f0-9]{64}$/;

export type ComputerForegroundOwnerV1 =
  | Readonly<{
      kind: 'browser';
      runtimeInstanceId: string;
      browserProcessId: string;
    }>
  | Readonly<{
      kind: 'non_browser';
      runtimeInstanceId: string;
    }>;

/**
 * A browser target is exact from admission. A native-app target may begin with
 * only the canonical app identity when the process is not running; the first
 * positive foreground observation then binds its process and window identity.
 */
export type ComputerForegroundIntendedTargetV1 =
  | Readonly<{
      kind: 'browser_page';
      browserProcessId: string;
      browserContextId: string;
      pageId: string;
      urlIdentity: string;
    }>
  | Readonly<{
      kind: 'native_app';
      appIdentity: string;
      processId?: number;
      windowIdentity?: string;
    }>;

export type ComputerForegroundObservedTargetV1 =
  | Readonly<{
      kind: 'browser_page';
      browserProcessId: string;
      browserContextId: string;
      pageId: string;
      urlIdentity: string;
    }>
  | Readonly<{
      kind: 'native_app';
      appIdentity: string;
      processId: number;
      windowIdentity: string;
    }>;

export type ComputerForegroundLeasePhaseV1 =
  | 'awaiting_initial_observation'
  | 'activation_pending'
  | 'activation_dispatched'
  | 'active'
  | 'interrupted'
  | 'expired'
  | 'stopped'
  | 'released';

export type ComputerForegroundInterruptReasonV1 =
  | 'activation_unverified'
  | 'user_foreground_override';

export interface ComputerForegroundLeaseDraftV1 {
  schemaVersion: 1;
  leaseId: string;
  rootTaskId: string;
  actionId: string;
  owner: ComputerForegroundOwnerV1;
  intendedTarget: ComputerForegroundIntendedTargetV1;
  issuedAt: string;
  expiresAt: string;
}

/**
 * Runtime-issued state. Object identity is intentionally meaningful: a plain
 * object, spread copy, or JSON clone is not a live foreground lease.
 */
export interface ComputerForegroundLeaseV1 extends ComputerForegroundLeaseDraftV1 {
  phase: ComputerForegroundLeasePhaseV1;
  activationCount: 0 | 1;
  boundTarget: ComputerForegroundObservedTargetV1 | null;
  pendingActivationEvidenceId: string | null;
  activationDispatchedAt: string | null;
  activatedAt: string | null;
  interruptedAt: string | null;
  interruptReason: ComputerForegroundInterruptReasonV1 | null;
  lastObservationEvidenceId: string | null;
  lastTransitionAt: string;
}

export type ComputerForegroundLeaseEventV1 =
  | Readonly<{
      type: 'foreground_observed';
      at: string;
      evidenceId: string;
      /** `null` means no exact foreground target could be proven. */
      foregroundTarget: ComputerForegroundObservedTargetV1 | null;
    }>
  | Readonly<{
      type: 'activation_dispatched';
      at: string;
      /** Must equal the latest mismatch observation that recommended focus. */
      basedOnEvidenceId: string;
    }>
  | Readonly<{
      type: 'stop_requested';
      at: string;
    }>
  | Readonly<{
      type: 'release';
      at: string;
    }>
  | Readonly<{
      type: 'check_expiry';
      at: string;
    }>;

export type ComputerForegroundDirectiveV1 =
  | 'observe'
  | 'activate_once'
  | 'observe_activation_result'
  | 'proceed'
  | 'pause_verify_only'
  | 'stop_verify_only'
  | 'done'
  | 'invalid';

export type ComputerForegroundDecisionReasonV1 =
  | 'initial_observation_required'
  | 'initial_activation_available'
  | 'activation_result_required'
  | 'exact_target_foreground'
  | 'activation_unverified'
  | 'user_foreground_override'
  | 'lease_expired'
  | 'stop_requested'
  | 'lease_released'
  | 'invalid_lease'
  | 'invalid_event'
  | 'stale_event'
  | 'activation_evidence_mismatch'
  | 'activation_budget_consumed'
  | 'release_requires_active_target';

export interface ComputerForegroundLeaseDecisionV1 {
  directive: ComputerForegroundDirectiveV1;
  reason: ComputerForegroundDecisionReasonV1;
  mayActivateTarget: boolean;
  mayDispatchForegroundAction: boolean;
  mayRunNonActivatingVerification: boolean;
}

export interface ComputerForegroundLeaseTransitionV1 {
  lease: ComputerForegroundLeaseV1 | null;
  decision: ComputerForegroundLeaseDecisionV1;
  changed: boolean;
}

const issuedForegroundLeases = new WeakSet<object>();

function isBoundedId(value: unknown): value is string {
  return typeof value === 'string'
    && BOUNDED_ID_RE.test(value)
    && !CONTROL_CHAR_RE.test(value);
}

function isBoundedIdentity(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 200
    && value === value.trim()
    && !CONTROL_CHAR_RE.test(value);
}

function parseCanonicalTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || value.length < 20 || value.length > 35) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === value ? parsed : null;
}

function isPositiveProcessId(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
}

function isBrowserTarget(
  target: ComputerForegroundIntendedTargetV1 | ComputerForegroundObservedTargetV1,
): target is Extract<ComputerForegroundObservedTargetV1, { kind: 'browser_page' }> {
  return target.kind === 'browser_page';
}

function validBrowserTarget(
  value: ComputerForegroundIntendedTargetV1 | ComputerForegroundObservedTargetV1,
): boolean {
  return value.kind === 'browser_page'
    && isBoundedIdentity(value.browserProcessId)
    && isBoundedIdentity(value.browserContextId)
    && isBoundedIdentity(value.pageId)
    && OPAQUE_BROWSER_URL_IDENTITY_RE.test(value.urlIdentity);
}

function validIntendedTarget(value: ComputerForegroundIntendedTargetV1): boolean {
  if (value.kind === 'browser_page') return validBrowserTarget(value);
  if (
    value.kind !== 'native_app'
    || !isBoundedIdentity(value.appIdentity)
  ) return false;
  const hasProcess = value.processId !== undefined;
  const hasWindow = value.windowIdentity !== undefined;
  return hasProcess === hasWindow
    && (!hasProcess || (
      isPositiveProcessId(value.processId)
      && isBoundedIdentity(value.windowIdentity)
    ));
}

function validObservedTarget(value: ComputerForegroundObservedTargetV1): boolean {
  if (value.kind === 'browser_page') return validBrowserTarget(value);
  return value.kind === 'native_app'
    && isBoundedIdentity(value.appIdentity)
    && isPositiveProcessId(value.processId)
    && isBoundedIdentity(value.windowIdentity);
}

function ownerMatchesTarget(
  owner: ComputerForegroundOwnerV1,
  target: ComputerForegroundIntendedTargetV1,
): boolean {
  if (!isBoundedId(owner.runtimeInstanceId)) return false;
  if (target.kind === 'browser_page') {
    return owner.kind === 'browser'
      && isBoundedIdentity(owner.browserProcessId)
      && owner.browserProcessId === target.browserProcessId;
  }
  return owner.kind === 'non_browser';
}

function cloneAndFreezeOwner(owner: ComputerForegroundOwnerV1): ComputerForegroundOwnerV1 {
  return owner.kind === 'browser'
    ? Object.freeze({ ...owner })
    : Object.freeze({ ...owner });
}

function cloneAndFreezeIntendedTarget(
  target: ComputerForegroundIntendedTargetV1,
): ComputerForegroundIntendedTargetV1 {
  return Object.freeze({ ...target });
}

function cloneAndFreezeObservedTarget(
  target: ComputerForegroundObservedTargetV1 | null,
): ComputerForegroundObservedTargetV1 | null {
  return target ? Object.freeze({ ...target }) : null;
}

function issueLease(
  state: ComputerForegroundLeaseV1,
): ComputerForegroundLeaseV1 {
  const issued = Object.freeze({
    ...state,
    owner: cloneAndFreezeOwner(state.owner),
    intendedTarget: cloneAndFreezeIntendedTarget(state.intendedTarget),
    boundTarget: cloneAndFreezeObservedTarget(state.boundTarget),
  });
  issuedForegroundLeases.add(issued);
  return issued;
}

function targetsMatch(
  intendedTarget: ComputerForegroundIntendedTargetV1,
  boundTarget: ComputerForegroundObservedTargetV1 | null,
  observedTarget: ComputerForegroundObservedTargetV1 | null,
): boolean {
  if (!observedTarget || !validObservedTarget(observedTarget)) return false;

  if (boundTarget) {
    if (boundTarget.kind !== observedTarget.kind) return false;
    if (isBrowserTarget(boundTarget) && isBrowserTarget(observedTarget)) {
      return boundTarget.browserProcessId === observedTarget.browserProcessId
        && boundTarget.browserContextId === observedTarget.browserContextId
        && boundTarget.pageId === observedTarget.pageId
        && boundTarget.urlIdentity === observedTarget.urlIdentity;
    }
    if (boundTarget.kind === 'native_app' && observedTarget.kind === 'native_app') {
      return boundTarget.appIdentity === observedTarget.appIdentity
        && boundTarget.processId === observedTarget.processId
        && boundTarget.windowIdentity === observedTarget.windowIdentity;
    }
    return false;
  }

  if (intendedTarget.kind !== observedTarget.kind) return false;
  if (isBrowserTarget(intendedTarget) && isBrowserTarget(observedTarget)) {
    return intendedTarget.browserProcessId === observedTarget.browserProcessId
      && intendedTarget.browserContextId === observedTarget.browserContextId
      && intendedTarget.pageId === observedTarget.pageId
      && intendedTarget.urlIdentity === observedTarget.urlIdentity;
  }
  if (intendedTarget.kind === 'native_app' && observedTarget.kind === 'native_app') {
    return intendedTarget.appIdentity === observedTarget.appIdentity
      && (intendedTarget.processId === undefined || intendedTarget.processId === observedTarget.processId)
      && (intendedTarget.windowIdentity === undefined || intendedTarget.windowIdentity === observedTarget.windowIdentity);
  }
  return false;
}

function directiveForPhase(
  lease: ComputerForegroundLeaseV1,
  overrideReason?: ComputerForegroundDecisionReasonV1,
): ComputerForegroundLeaseDecisionV1 {
  switch (lease.phase) {
    case 'awaiting_initial_observation':
      return {
        directive: 'observe',
        reason: overrideReason || 'initial_observation_required',
        mayActivateTarget: false,
        mayDispatchForegroundAction: false,
        mayRunNonActivatingVerification: true,
      };
    case 'activation_pending':
      return {
        directive: 'activate_once',
        reason: overrideReason || 'initial_activation_available',
        mayActivateTarget: lease.activationCount === 0,
        mayDispatchForegroundAction: false,
        mayRunNonActivatingVerification: true,
      };
    case 'activation_dispatched':
      return {
        directive: 'observe_activation_result',
        reason: overrideReason || 'activation_result_required',
        mayActivateTarget: false,
        mayDispatchForegroundAction: false,
        mayRunNonActivatingVerification: true,
      };
    case 'active':
      return {
        directive: 'proceed',
        reason: overrideReason || 'exact_target_foreground',
        mayActivateTarget: false,
        mayDispatchForegroundAction: true,
        mayRunNonActivatingVerification: true,
      };
    case 'interrupted':
      return {
        directive: 'pause_verify_only',
        reason: overrideReason || lease.interruptReason || 'user_foreground_override',
        mayActivateTarget: false,
        mayDispatchForegroundAction: false,
        mayRunNonActivatingVerification: true,
      };
    case 'expired':
      return {
        directive: 'stop_verify_only',
        reason: overrideReason || 'lease_expired',
        mayActivateTarget: false,
        mayDispatchForegroundAction: false,
        mayRunNonActivatingVerification: true,
      };
    case 'stopped':
      return {
        directive: 'stop_verify_only',
        reason: overrideReason || 'stop_requested',
        mayActivateTarget: false,
        mayDispatchForegroundAction: false,
        mayRunNonActivatingVerification: true,
      };
    case 'released':
      return {
        directive: 'done',
        reason: overrideReason || 'lease_released',
        mayActivateTarget: false,
        mayDispatchForegroundAction: false,
        mayRunNonActivatingVerification: false,
      };
  }
}

function invalidDecision(
  reason: ComputerForegroundDecisionReasonV1,
): ComputerForegroundLeaseDecisionV1 {
  return {
    directive: 'invalid',
    reason,
    mayActivateTarget: false,
    mayDispatchForegroundAction: false,
    mayRunNonActivatingVerification: false,
  };
}

function eventTimestamp(event: ComputerForegroundLeaseEventV1): number | null {
  return parseCanonicalTimestamp(event.at);
}

function validEvent(event: ComputerForegroundLeaseEventV1): boolean {
  if (!event || typeof event !== 'object' || eventTimestamp(event) === null) return false;
  switch (event.type) {
    case 'foreground_observed':
      return isBoundedId(event.evidenceId)
        && (event.foregroundTarget === null || validObservedTarget(event.foregroundTarget));
    case 'activation_dispatched':
      return isBoundedId(event.basedOnEvidenceId);
    case 'stop_requested':
    case 'release':
    case 'check_expiry':
      return true;
    default:
      return false;
  }
}

/** Issue one short-lived, task/action-bound foreground lease. */
export function createComputerForegroundLeaseV1(
  draft: ComputerForegroundLeaseDraftV1,
): ComputerForegroundLeaseV1 | null {
  if (
    draft?.schemaVersion !== 1
    || !isBoundedId(draft.leaseId)
    || !isBoundedId(draft.rootTaskId)
    || !isBoundedId(draft.actionId)
    || !validIntendedTarget(draft.intendedTarget)
    || !ownerMatchesTarget(draft.owner, draft.intendedTarget)
  ) return null;

  const issuedAtMs = parseCanonicalTimestamp(draft.issuedAt);
  const expiresAtMs = parseCanonicalTimestamp(draft.expiresAt);
  if (
    issuedAtMs === null
    || expiresAtMs === null
    || expiresAtMs <= issuedAtMs
    || expiresAtMs - issuedAtMs > COMPUTER_FOREGROUND_LEASE_MAX_TTL_MS
  ) return null;

  return issueLease({
    ...draft,
    owner: cloneAndFreezeOwner(draft.owner),
    intendedTarget: cloneAndFreezeIntendedTarget(draft.intendedTarget),
    phase: 'awaiting_initial_observation',
    activationCount: 0,
    boundTarget: null,
    pendingActivationEvidenceId: null,
    activationDispatchedAt: null,
    activatedAt: null,
    interruptedAt: null,
    interruptReason: null,
    lastObservationEvidenceId: null,
    lastTransitionAt: draft.issuedAt,
  });
}

/**
 * Read the current instruction without consuming the lease. Cloned or forged
 * state is invalid and can never authorize target activation or mutation.
 */
export function inspectComputerForegroundLeaseV1(
  lease: ComputerForegroundLeaseV1,
): ComputerForegroundLeaseDecisionV1 {
  return issuedForegroundLeases.has(lease)
    ? directiveForPhase(lease)
    : invalidDecision('invalid_lease');
}

function transitionTo(
  previous: ComputerForegroundLeaseV1,
  next: ComputerForegroundLeaseV1,
  reason?: ComputerForegroundDecisionReasonV1,
): ComputerForegroundLeaseTransitionV1 {
  issuedForegroundLeases.delete(previous);
  const issued = issueLease(next);
  return {
    lease: issued,
    decision: directiveForPhase(issued, reason),
    changed: true,
  };
}

function unchangedTransition(
  lease: ComputerForegroundLeaseV1,
  reason: ComputerForegroundDecisionReasonV1,
): ComputerForegroundLeaseTransitionV1 {
  return {
    lease,
    decision: directiveForPhase(lease, reason),
    changed: false,
  };
}

/**
 * Apply one coordinator event. The activation-dispatched transition consumes
 * the sole focus budget before the caller enters a native focus/launch or
 * browser bring-to-front handler. Once `interrupted`, the lease can never
 * activate again; explicit user resume must create a fresh action lease.
 */
export function transitionComputerForegroundLeaseV1(
  lease: ComputerForegroundLeaseV1,
  event: ComputerForegroundLeaseEventV1,
): ComputerForegroundLeaseTransitionV1 {
  if (!issuedForegroundLeases.has(lease)) {
    return { lease: null, decision: invalidDecision('invalid_lease'), changed: false };
  }
  if (!validEvent(event)) {
    return { lease, decision: invalidDecision('invalid_event'), changed: false };
  }

  const atMs = eventTimestamp(event)!;
  const lastTransitionMs = parseCanonicalTimestamp(lease.lastTransitionAt)!;
  const expiresAtMs = parseCanonicalTimestamp(lease.expiresAt)!;
  if (atMs < lastTransitionMs) {
    return unchangedTransition(lease, 'stale_event');
  }

  if (
    lease.phase !== 'released'
    && lease.phase !== 'stopped'
    && lease.phase !== 'expired'
    && atMs >= expiresAtMs
  ) {
    return transitionTo(lease, {
      ...lease,
      phase: 'expired',
      pendingActivationEvidenceId: null,
      lastTransitionAt: event.at,
    }, 'lease_expired');
  }

  if (event.type === 'check_expiry') {
    return unchangedTransition(lease, directiveForPhase(lease).reason);
  }

  if (event.type === 'stop_requested') {
    if (lease.phase === 'released' || lease.phase === 'expired' || lease.phase === 'stopped') {
      return unchangedTransition(lease, directiveForPhase(lease).reason);
    }
    return transitionTo(lease, {
      ...lease,
      phase: 'stopped',
      pendingActivationEvidenceId: null,
      lastTransitionAt: event.at,
    }, 'stop_requested');
  }

  if (event.type === 'release') {
    if (lease.phase !== 'active') {
      return unchangedTransition(lease, 'release_requires_active_target');
    }
    return transitionTo(lease, {
      ...lease,
      phase: 'released',
      pendingActivationEvidenceId: null,
      lastTransitionAt: event.at,
    }, 'lease_released');
  }

  if (event.type === 'activation_dispatched') {
    if (lease.activationCount !== 0) {
      return unchangedTransition(lease, 'activation_budget_consumed');
    }
    if (
      lease.phase !== 'activation_pending'
      || !lease.pendingActivationEvidenceId
      || event.basedOnEvidenceId !== lease.pendingActivationEvidenceId
    ) {
      return unchangedTransition(lease, 'activation_evidence_mismatch');
    }
    return transitionTo(lease, {
      ...lease,
      phase: 'activation_dispatched',
      activationCount: 1,
      activationDispatchedAt: event.at,
      pendingActivationEvidenceId: null,
      lastTransitionAt: event.at,
    }, 'activation_result_required');
  }

  const targetMatches = targetsMatch(
    lease.intendedTarget,
    lease.boundTarget,
    event.foregroundTarget,
  );

  if (lease.phase === 'awaiting_initial_observation' || lease.phase === 'activation_pending') {
    if (targetMatches && event.foregroundTarget) {
      return transitionTo(lease, {
        ...lease,
        phase: 'active',
        boundTarget: cloneAndFreezeObservedTarget(event.foregroundTarget),
        pendingActivationEvidenceId: null,
        activatedAt: event.at,
        lastObservationEvidenceId: event.evidenceId,
        lastTransitionAt: event.at,
      }, 'exact_target_foreground');
    }
    return transitionTo(lease, {
      ...lease,
      phase: 'activation_pending',
      pendingActivationEvidenceId: event.evidenceId,
      lastObservationEvidenceId: event.evidenceId,
      lastTransitionAt: event.at,
    }, 'initial_activation_available');
  }

  if (lease.phase === 'activation_dispatched') {
    if (targetMatches && event.foregroundTarget) {
      return transitionTo(lease, {
        ...lease,
        phase: 'active',
        boundTarget: cloneAndFreezeObservedTarget(event.foregroundTarget),
        activatedAt: event.at,
        lastObservationEvidenceId: event.evidenceId,
        lastTransitionAt: event.at,
      }, 'exact_target_foreground');
    }
    return transitionTo(lease, {
      ...lease,
      phase: 'interrupted',
      interruptedAt: event.at,
      interruptReason: 'activation_unverified',
      lastObservationEvidenceId: event.evidenceId,
      lastTransitionAt: event.at,
    }, 'activation_unverified');
  }

  if (lease.phase === 'active') {
    if (targetMatches) {
      return transitionTo(lease, {
        ...lease,
        lastObservationEvidenceId: event.evidenceId,
        lastTransitionAt: event.at,
      }, 'exact_target_foreground');
    }
    return transitionTo(lease, {
      ...lease,
      phase: 'interrupted',
      interruptedAt: event.at,
      interruptReason: 'user_foreground_override',
      lastObservationEvidenceId: event.evidenceId,
      lastTransitionAt: event.at,
    }, 'user_foreground_override');
  }

  // Interrupted and terminal leases may be observed for proof, but an
  // observation can never reactivate them or restore dispatch authority.
  return unchangedTransition(lease, directiveForPhase(lease).reason);
}
