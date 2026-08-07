/**
 * Focused contract smoke for one-shot foreground ownership and human override.
 *
 * Run:
 *   npx tsx scripts/computer-foreground-ownership-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  COMPUTER_FOREGROUND_LEASE_MAX_TTL_MS,
  createComputerForegroundLeaseV1,
  inspectComputerForegroundLeaseV1,
  transitionComputerForegroundLeaseV1,
  type ComputerForegroundLeaseV1,
  type ComputerForegroundObservedTargetV1,
} from '../src/lib/computerForegroundOwnership';

let assertions = 0;

function check(condition: unknown, message: string): asserts condition {
  assertions += 1;
  assert(condition, message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  assertions += 1;
  assert.equal(actual, expected, message);
}

function nativeObservation(
  appIdentity: string,
  processId: number,
  windowIdentity: string,
): ComputerForegroundObservedTargetV1 {
  return { kind: 'native_app', appIdentity, processId, windowIdentity };
}

function requireLease(value: ComputerForegroundLeaseV1 | null): ComputerForegroundLeaseV1 {
  check(value, 'transition returns a trusted lease');
  return value;
}

const issuedAt = '2026-08-06T12:00:00.000Z';
const expiresAt = '2026-08-06T12:02:00.000Z';
const photoshopLease = createComputerForegroundLeaseV1({
  schemaVersion: 1,
  leaseId: 'foreground.photoshop.1',
  rootTaskId: 'task.photoshop.1',
  actionId: 'action.create-document.1',
  owner: {
    kind: 'non_browser',
    runtimeInstanceId: 'openswan.local-desktop.1',
  },
  intendedTarget: {
    kind: 'native_app',
    appIdentity: 'Adobe Photoshop 2026',
  },
  issuedAt,
  expiresAt,
});
check(photoshopLease, 'a valid native-app foreground lease is issued');
check(Object.isFrozen(photoshopLease), 'the issued lease is immutable');
check(Object.isFrozen(photoshopLease.owner), 'the owner identity is immutable');
check(Object.isFrozen(photoshopLease.intendedTarget), 'the intended target is immutable');
equal(photoshopLease.rootTaskId, 'task.photoshop.1', 'one root task owns the lease');
equal(photoshopLease.actionId, 'action.create-document.1', 'one exact action owns the lease');
equal(inspectComputerForegroundLeaseV1(photoshopLease).directive, 'observe', 'fresh leases require observation');
equal(inspectComputerForegroundLeaseV1(photoshopLease).mayActivateTarget, false, 'observation must precede activation');

const forgedLease = { ...photoshopLease };
equal(inspectComputerForegroundLeaseV1(forgedLease).directive, 'invalid', 'a spread copy has no lease authority');
equal(
  inspectComputerForegroundLeaseV1(JSON.parse(JSON.stringify(photoshopLease))).directive,
  'invalid',
  'a persisted JSON clone has no lease authority',
);

equal(
  createComputerForegroundLeaseV1({
    schemaVersion: 1,
    leaseId: 'foreground.bad-owner.1',
    rootTaskId: 'task.bad-owner.1',
    actionId: 'action.bad-owner.1',
    owner: {
      kind: 'browser',
      runtimeInstanceId: 'openswan.browser.1',
      browserProcessId: 'browser-process-1',
    },
    intendedTarget: {
      kind: 'native_app',
      appIdentity: 'Adobe Photoshop 2026',
    },
    issuedAt,
    expiresAt,
  }),
  null,
  'a browser owner cannot acquire a non-browser target',
);
equal(
  createComputerForegroundLeaseV1({
    schemaVersion: 1,
    leaseId: 'foreground.raw-url.1',
    rootTaskId: 'task.raw-url.1',
    actionId: 'action.raw-url.1',
    owner: {
      kind: 'browser',
      runtimeInstanceId: 'openswan.browser.1',
      browserProcessId: 'browser-process-1',
    },
    intendedTarget: {
      kind: 'browser_page',
      browserProcessId: 'browser-process-1',
      browserContextId: 'browser-context-1',
      pageId: 'browser-page-1',
      urlIdentity: 'https://example.com/private',
    },
    issuedAt,
    expiresAt,
  }),
  null,
  'raw browser URLs cannot enter the foreground lease',
);
equal(
  createComputerForegroundLeaseV1({
    schemaVersion: 1,
    leaseId: 'foreground.too-long.1',
    rootTaskId: 'task.too-long.1',
    actionId: 'action.too-long.1',
    owner: { kind: 'non_browser', runtimeInstanceId: 'openswan.desktop.1' },
    intendedTarget: { kind: 'native_app', appIdentity: 'Preview' },
    issuedAt,
    expiresAt: new Date(Date.parse(issuedAt) + COMPUTER_FOREGROUND_LEASE_MAX_TTL_MS + 1).toISOString(),
  }),
  null,
  'leases cannot outlive the bounded per-action TTL',
);

let native = requireLease(photoshopLease);
let transition = transitionComputerForegroundLeaseV1(native, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:01.000Z',
  evidenceId: 'window-state.before.1',
  foregroundTarget: nativeObservation('Terminal', 900, 'cg-window-terminal-1'),
});
native = requireLease(transition.lease);
equal(transition.decision.directive, 'activate_once', 'an initial mismatch permits exactly one requested activation');
equal(transition.decision.mayActivateTarget, true, 'the single activation budget is explicit');
equal(transition.decision.mayDispatchForegroundAction, false, 'the task action cannot dispatch before focus proof');

const wrongEvidenceClaim = transitionComputerForegroundLeaseV1(native, {
  type: 'activation_dispatched',
  at: '2026-08-06T12:00:01.100Z',
  basedOnEvidenceId: 'window-state.stale',
});
equal(wrongEvidenceClaim.changed, false, 'activation cannot consume authority from stale evidence');
equal(wrongEvidenceClaim.decision.reason, 'activation_evidence_mismatch', 'the mismatch is typed');
equal(wrongEvidenceClaim.decision.mayActivateTarget, true, 'the valid exact evidence may still be used once');

transition = transitionComputerForegroundLeaseV1(native, {
  type: 'activation_dispatched',
  at: '2026-08-06T12:00:01.200Z',
  basedOnEvidenceId: 'window-state.before.1',
});
native = requireLease(transition.lease);
equal(native.activationCount, 1, 'activation is reserved before handler entry');
equal(transition.decision.directive, 'observe_activation_result', 'a dispatch acknowledgement never completes focus');
equal(transition.decision.mayActivateTarget, false, 'the activation budget is consumed immediately');

equal(
  inspectComputerForegroundLeaseV1(photoshopLease).directive,
  'invalid',
  'a consumed predecessor snapshot cannot race the current lease state',
);

transition = transitionComputerForegroundLeaseV1(native, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:01.400Z',
  evidenceId: 'window-state.after-focus.1',
  foregroundTarget: nativeObservation('Adobe Photoshop 2026', 8123, 'cg-window-photoshop-1'),
});
native = requireLease(transition.lease);
equal(native.phase, 'active', 'fresh exact app/PID/window proof activates the lease');
equal(transition.decision.mayDispatchForegroundAction, true, 'only active exact-target proof permits the bounded action');
equal(native.boundTarget?.kind, 'native_app', 'the previously unstarted app is bound to a concrete instance');
check(Object.isFrozen(native.boundTarget), 'the bound process/window target is immutable');

transition = transitionComputerForegroundLeaseV1(native, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:02.000Z',
  evidenceId: 'window-state.human-terminal.1',
  foregroundTarget: nativeObservation('Terminal', 900, 'cg-window-terminal-1'),
});
native = requireLease(transition.lease);
equal(native.phase, 'interrupted', 'a later target change is a human override');
equal(native.interruptReason, 'user_foreground_override', 'the interrupt reason is explicit');
equal(transition.decision.directive, 'pause_verify_only', 'human override pauses mutation work');
equal(transition.decision.mayActivateTarget, false, 'the task cannot reclaim foreground after the user switches away');
equal(transition.decision.mayDispatchForegroundAction, false, 'undispatched mutation remains blocked');
equal(transition.decision.mayRunNonActivatingVerification, true, 'safe background verification remains possible');

transition = transitionComputerForegroundLeaseV1(native, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:03.000Z',
  evidenceId: 'window-state.photoshop-again.1',
  foregroundTarget: nativeObservation('Adobe Photoshop 2026', 8123, 'cg-window-photoshop-1'),
});
native = requireLease(transition.lease);
equal(transition.changed, false, 'later matching focus never auto-resumes an interrupted lease');
equal(transition.decision.directive, 'pause_verify_only', 'explicit resume must enter through a fresh task/action lease');
equal(transition.decision.mayActivateTarget, false, 'an interrupted lease never obtains another activation');

const refocusAttempt = transitionComputerForegroundLeaseV1(native, {
  type: 'activation_dispatched',
  at: '2026-08-06T12:00:03.100Z',
  basedOnEvidenceId: 'window-state.photoshop-again.1',
});
equal(refocusAttempt.changed, false, 'a refocus attempt cannot change interrupted state');
equal(refocusAttempt.decision.reason, 'activation_budget_consumed', 'the one-shot budget remains consumed');
equal(refocusAttempt.decision.mayActivateTarget, false, 'no automatic refocus is possible');

// A task that begins with its target frontmost does not preserve a hidden
// future focus budget after the human changes apps.
let preview = requireLease(createComputerForegroundLeaseV1({
  schemaVersion: 1,
  leaseId: 'foreground.preview.1',
  rootTaskId: 'task.preview.1',
  actionId: 'action.inspect.1',
  owner: { kind: 'non_browser', runtimeInstanceId: 'openswan.desktop.1' },
  intendedTarget: {
    kind: 'native_app',
    appIdentity: 'Preview',
    processId: 700,
    windowIdentity: 'cg-window-preview-1',
  },
  issuedAt,
  expiresAt,
}));
transition = transitionComputerForegroundLeaseV1(preview, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:01.000Z',
  evidenceId: 'window-state.preview.1',
  foregroundTarget: nativeObservation('Preview', 700, 'cg-window-preview-1'),
});
preview = requireLease(transition.lease);
equal(preview.activationCount, 0, 'already-frontmost targets need no activation');
transition = transitionComputerForegroundLeaseV1(preview, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:02.000Z',
  evidenceId: 'window-state.terminal.2',
  foregroundTarget: nativeObservation('Terminal', 900, 'cg-window-terminal-1'),
});
preview = requireLease(transition.lease);
equal(preview.phase, 'interrupted', 'foreground drift interrupts an initially active lease too');
equal(transition.decision.mayActivateTarget, false, 'unused initial budget cannot become an automatic refocus budget');
const hiddenBudgetAttempt = transitionComputerForegroundLeaseV1(preview, {
  type: 'activation_dispatched',
  at: '2026-08-06T12:00:02.100Z',
  basedOnEvidenceId: 'window-state.terminal.2',
});
equal(hiddenBudgetAttempt.changed, false, 'interrupted phase rejects activation even when count is zero');
equal(hiddenBudgetAttempt.decision.reason, 'activation_evidence_mismatch', 'there is no pending initial-activation evidence');
equal(hiddenBudgetAttempt.decision.mayActivateTarget, false, 'the interrupted lease cannot steal focus');

// Browser ownership is bound to one exact process/context/page/opaque URL.
let browser = requireLease(createComputerForegroundLeaseV1({
  schemaVersion: 1,
  leaseId: 'foreground.browser.1',
  rootTaskId: 'task.browser.1',
  actionId: 'action.browser-form.1',
  owner: {
    kind: 'browser',
    runtimeInstanceId: 'openswan.browser-bridge.1',
    browserProcessId: 'browser-process-1',
  },
  intendedTarget: {
    kind: 'browser_page',
    browserProcessId: 'browser-process-1',
    browserContextId: 'browser-context-1',
    pageId: 'browser-page-1',
    urlIdentity: `uc_browser_url_${'a'.repeat(64)}`,
  },
  issuedAt,
  expiresAt,
}));
transition = transitionComputerForegroundLeaseV1(browser, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:01.000Z',
  evidenceId: 'browser-foreground.1',
  foregroundTarget: {
    kind: 'browser_page',
    browserProcessId: 'browser-process-1',
    browserContextId: 'browser-context-1',
    pageId: 'browser-page-1',
    urlIdentity: `uc_browser_url_${'a'.repeat(64)}`,
  },
});
browser = requireLease(transition.lease);
equal(transition.decision.directive, 'proceed', 'the exact browser page owns foreground for its action');

transition = transitionComputerForegroundLeaseV1(browser, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:02.000Z',
  evidenceId: 'browser-foreground.other-tab.1',
  foregroundTarget: {
    kind: 'browser_page',
    browserProcessId: 'browser-process-1',
    browserContextId: 'browser-context-1',
    pageId: 'openswan-chat-page',
    urlIdentity: `uc_browser_url_${'b'.repeat(64)}`,
  },
});
browser = requireLease(transition.lease);
equal(browser.phase, 'interrupted', 'another tab in the same browser is still a foreground override');
equal(transition.decision.mayActivateTarget, false, 'the browser runtime cannot keep bringing its page back');

// Failed activation proof is terminal for this lease and never becomes retry.
let failedFocus = requireLease(createComputerForegroundLeaseV1({
  schemaVersion: 1,
  leaseId: 'foreground.failed-focus.1',
  rootTaskId: 'task.failed-focus.1',
  actionId: 'action.failed-focus.1',
  owner: { kind: 'non_browser', runtimeInstanceId: 'openswan.desktop.2' },
  intendedTarget: { kind: 'native_app', appIdentity: 'Slack' },
  issuedAt,
  expiresAt,
}));
transition = transitionComputerForegroundLeaseV1(failedFocus, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:01.000Z',
  evidenceId: 'window-state.before-slack.1',
  foregroundTarget: nativeObservation('Terminal', 900, 'cg-window-terminal-1'),
});
failedFocus = requireLease(transition.lease);
transition = transitionComputerForegroundLeaseV1(failedFocus, {
  type: 'activation_dispatched',
  at: '2026-08-06T12:00:01.100Z',
  basedOnEvidenceId: 'window-state.before-slack.1',
});
failedFocus = requireLease(transition.lease);
transition = transitionComputerForegroundLeaseV1(failedFocus, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:01.500Z',
  evidenceId: 'window-state.after-slack.1',
  foregroundTarget: null,
});
failedFocus = requireLease(transition.lease);
equal(failedFocus.interruptReason, 'activation_unverified', 'missing focus proof fails closed');
equal(transition.decision.directive, 'pause_verify_only', 'failed focus does not trigger a retry loop');
equal(transition.decision.mayActivateTarget, false, 'activation is never replayed after missing proof');

// Expiry and STOP outrank continuity.
let expiring = requireLease(createComputerForegroundLeaseV1({
  schemaVersion: 1,
  leaseId: 'foreground.expiring.1',
  rootTaskId: 'task.expiring.1',
  actionId: 'action.expiring.1',
  owner: { kind: 'non_browser', runtimeInstanceId: 'openswan.desktop.3' },
  intendedTarget: { kind: 'native_app', appIdentity: 'Notes' },
  issuedAt,
  expiresAt: '2026-08-06T12:00:05.000Z',
}));
transition = transitionComputerForegroundLeaseV1(expiring, {
  type: 'check_expiry',
  at: '2026-08-06T12:00:05.000Z',
});
expiring = requireLease(transition.lease);
equal(expiring.phase, 'expired', 'expiry is fail-closed at the exact boundary');
equal(transition.decision.mayActivateTarget, false, 'expired leases cannot focus');
equal(transition.decision.mayDispatchForegroundAction, false, 'expired leases cannot dispatch task actions');

let stopped = requireLease(createComputerForegroundLeaseV1({
  schemaVersion: 1,
  leaseId: 'foreground.stopped.1',
  rootTaskId: 'task.stopped.1',
  actionId: 'action.stopped.1',
  owner: { kind: 'non_browser', runtimeInstanceId: 'openswan.desktop.4' },
  intendedTarget: { kind: 'native_app', appIdentity: 'Notes' },
  issuedAt,
  expiresAt,
}));
transition = transitionComputerForegroundLeaseV1(stopped, {
  type: 'stop_requested',
  at: '2026-08-06T12:00:01.000Z',
});
stopped = requireLease(transition.lease);
equal(stopped.phase, 'stopped', 'STOP terminalizes foreground ownership');
equal(transition.decision.directive, 'stop_verify_only', 'STOP permits only non-activating verification');

const staleStop = transitionComputerForegroundLeaseV1(stopped, {
  type: 'foreground_observed',
  at: '2026-08-06T12:00:00.500Z',
  evidenceId: 'window-state.stale.2',
  foregroundTarget: nativeObservation('Notes', 501, 'cg-window-notes-1'),
});
equal(staleStop.changed, false, 'out-of-order observations cannot rewind state');
equal(staleStop.decision.reason, 'stale_event', 'stale events have a bounded reason');

// The pure core contains no focus side effect or polling primitive. Existing
// runtime integration must explicitly consume `activate_once`, persist the
// transition, and then call one exact lifecycle handler.
const source = readFileSync('src/lib/computerForegroundOwnership.ts', 'utf8');
for (const forbidden of [
  'setInterval(',
  'setTimeout(',
  'window.focus(',
  'bringToFront(',
  'focusApp(',
  'launchApp(',
]) {
  check(!source.includes(forbidden), `foreground core never performs side effect ${forbidden}`);
}

console.log(`computer foreground ownership smoke: ${assertions} assertions passed`);
