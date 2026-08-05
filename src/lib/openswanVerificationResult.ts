/**
 * openswanVerificationResult — the pure, dependency-light core of the OpenSwan
 * verification runtime: the result type, the check→tool mapping, the human
 * summary, and the fail-closed blocked-result builder.
 *
 * This is split out from openswanVerificationRuntime (which imports the tool
 * runtime, and through it react-native/supabase) so the transformation logic
 * can be unit/smoke tested in plain Node. Only `import type` deps here — nothing
 * loads at runtime — so importing this module never pulls the heavy chain.
 */

import type { OpenSwanExecutionContract, OpenSwanExecutionStatus } from './openswanExecution';
import type { OpenSwanToolName, OpenSwanVerificationCheck } from './openswanTaskPlanner';

export type OpenSwanVerificationResult = {
  check: OpenSwanVerificationCheck;
  status: OpenSwanExecutionStatus;
  execution: OpenSwanExecutionContract;
  ok: boolean;
  executed: boolean;
  summary: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

export function getToolNameForCheck(check: OpenSwanVerificationCheck): OpenSwanToolName {
  if (check.kind === 'typecheck') return 'verification.typecheck';
  if (check.kind === 'tests') return 'verification.tests';
  if (check.kind === 'lint') return 'verification.lint';
  return 'verification.preview';
}

export function summarizeVerificationCheck(check: OpenSwanVerificationCheck, result: {
  status: OpenSwanExecutionStatus;
  command?: string;
  error?: string;
}): string {
  if (result.status === 'passed') {
    return `${check.label}: passed${result.command ? ` via \`${result.command}\`` : ''}`;
  }
  if (result.status === 'failed') {
    return `${check.label}: failed${result.error ? ` (${result.error})` : ''}`;
  }
  if (result.status === 'blocked') {
    return `${check.label}: blocked${result.error ? ` (${result.error})` : ''}`;
  }
  if (result.status === 'manual_required') {
    return `${check.label}: manual review required`;
  }
  if (result.status === 'not_applicable') {
    return `${check.label}: not applicable (no automatic verification for this task)`;
  }
  return `${check.label}: planned`;
}

/**
 * A check whose dispatch threw (edge/network error, relay failure, empty
 * response) becomes a fail-closed 'blocked' result instead of propagating. This
 * keeps one check's failure from rejecting the whole concurrent batch in
 * executeOpenSwanVerificationPlan — every sibling check still reports its own
 * outcome, and the failed one is surfaced honestly as blocked rather than
 * silently dropped or mistaken for a pass.
 */
export function buildBlockedVerificationResult(
  check: OpenSwanVerificationCheck,
  error: string,
): OpenSwanVerificationResult {
  const summary = summarizeVerificationCheck(check, { status: 'blocked', error });
  return {
    check,
    status: 'blocked',
    execution: {
      status: 'blocked',
      mode: 'blocked',
      summary,
      toolName: getToolNameForCheck(check),
      checkId: check.id,
      checkLabel: check.label,
      executed: false,
      error,
    },
    ok: false,
    executed: false,
    summary,
    error,
  };
}
