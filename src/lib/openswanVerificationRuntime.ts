import type { OpenSwanExecutionContract, OpenSwanExecutionStatus } from './openswanExecution';
import type { OpenSwanTaskPlan, OpenSwanVerificationCheck } from './openswanTaskPlanner';
import { executeOpenSwanTool, type OpenSwanToolEvent } from './openswanToolRuntime';
import {
  buildBlockedVerificationResult,
  getToolNameForCheck,
  summarizeVerificationCheck,
  type OpenSwanVerificationResult,
} from './openswanVerificationResult';

// The result type and the pure helpers (check→tool mapping, summary,
// fail-closed blocked builder) live in openswanVerificationResult — it has no
// heavy deps, so it's smoke-testable in plain Node. Re-exported here so existing
// consumers keep importing them from the runtime module.
export { buildBlockedVerificationResult };
export type { OpenSwanVerificationResult };

type VerificationCallbacks = {
  onToolEvent?: (event: OpenSwanToolEvent) => void;
};

type VerificationToolExecutionResult = {
  ok: boolean;
  executed: boolean;
  command?: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

export async function executeOpenSwanVerificationPlan(
  taskPlan: OpenSwanTaskPlan,
  callbacks: VerificationCallbacks = {},
): Promise<OpenSwanVerificationResult[]> {
  // Verification checks (typecheck/tests/lint) are independent, read-only
  // analysis commands, and manual/planned checks resolve instantly — so run the
  // round concurrently. The post-execution wait becomes max(check) instead of
  // sum(check); results stay in plan order (Promise.all preserves it). This is
  // correctness-safe: no check mutates state or depends on another's result.
  return Promise.all(
    taskPlan.verification.map((check) => executeOpenSwanVerificationCheck(check, callbacks)),
  );
}

export async function executeOpenSwanVerificationCheck(
  check: OpenSwanVerificationCheck,
  callbacks: VerificationCallbacks = {},
): Promise<OpenSwanVerificationResult> {
  const tool = getToolNameForCheck(check);

  if (check.kind !== 'typecheck' && check.kind !== 'tests' && check.kind !== 'lint') {
    // O5: a non-automatic check that isn't required does not apply to this
    // run — report it honestly as not_applicable instead of a 'planned'
    // that would read as "will run later" forever.
    const status: OpenSwanExecutionStatus = check.required ? 'manual_required' : 'not_applicable';
    callbacks.onToolEvent?.({
      tool,
      status,
      summary: summarizeVerificationCheck(check, { status }),
    });
    return {
      check,
      status,
      execution: {
        status,
        mode: status === 'manual_required' ? 'manual' : 'informational',
        summary: summarizeVerificationCheck(check, { status }),
        checkId: check.id,
        checkLabel: check.label,
        executed: false,
        error: null,
      },
      ok: status !== 'manual_required',
      executed: false,
      summary: summarizeVerificationCheck(check, { status }),
    };
  }

  callbacks.onToolEvent?.({
    tool,
    status: 'running',
    summary: `Running ${check.label}`,
  });
  let result: VerificationToolExecutionResult;
  try {
    result = await executeOpenSwanTool(tool, {}) as VerificationToolExecutionResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const blocked = buildBlockedVerificationResult(check, message);
    callbacks.onToolEvent?.({
      tool,
      status: 'blocked',
      summary: blocked.summary,
      metadata: { execution: blocked.execution },
    });
    return blocked;
  }
  const status: OpenSwanExecutionStatus = !result.executed
    ? 'blocked'
    : result.ok
      ? 'passed'
      : 'failed';
  callbacks.onToolEvent?.({
    tool,
    status,
    summary: summarizeVerificationCheck(check, { status, command: result.command, error: result.error }),
    command: result.command,
    metadata: {
      execution: {
        status,
        mode: status === 'blocked' ? 'blocked' : 'automatic',
        summary: summarizeVerificationCheck(check, { status, command: result.command, error: result.error }),
        toolName: tool,
        checkId: check.id,
        checkLabel: check.label,
        command: result.command,
        executed: result.executed,
        error: result.error || null,
      } satisfies OpenSwanExecutionContract,
    },
  });
  return {
    check,
    status,
    execution: {
      status,
      mode: status === 'blocked' ? 'blocked' : 'automatic',
      summary: summarizeVerificationCheck(check, { status, command: result.command, error: result.error }),
      toolName: tool,
      checkId: check.id,
      checkLabel: check.label,
      command: result.command,
      executed: result.executed,
      error: result.error || null,
    },
    ok: status === 'passed',
    executed: result.executed,
    summary: summarizeVerificationCheck(check, { status, command: result.command, error: result.error }),
    command: result.command,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error,
  };
}

export function upsertOpenSwanVerificationResult(
  results: OpenSwanVerificationResult[],
  nextResult: OpenSwanVerificationResult,
): OpenSwanVerificationResult[] {
  const existingIndex = results.findIndex((result) => result.check.id === nextResult.check.id);
  if (existingIndex === -1) {
    return [...results, nextResult];
  }
  return results.map((result, index) => (index === existingIndex ? nextResult : result));
}
