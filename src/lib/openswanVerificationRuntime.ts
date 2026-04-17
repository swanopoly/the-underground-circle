import type { OpenSwanExecutionContract, OpenSwanExecutionStatus } from './openswanExecution';
import type { OpenSwanTaskPlan, OpenSwanToolName, OpenSwanVerificationCheck } from './openswanTaskPlanner';
import { executeOpenSwanTool, type OpenSwanToolEvent } from './openswanToolRuntime';

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

function getToolNameForCheck(check: OpenSwanVerificationCheck): OpenSwanToolName {
  if (check.kind === 'typecheck') return 'verification.typecheck';
  if (check.kind === 'tests') return 'verification.tests';
  if (check.kind === 'lint') return 'verification.lint';
  return 'verification.preview';
}

function summarize(check: OpenSwanVerificationCheck, result: {
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
  return `${check.label}: planned`;
}

export async function executeOpenSwanVerificationPlan(
  taskPlan: OpenSwanTaskPlan,
  callbacks: VerificationCallbacks = {},
): Promise<OpenSwanVerificationResult[]> {
  const results: OpenSwanVerificationResult[] = [];

  for (const check of taskPlan.verification) {
    results.push(await executeOpenSwanVerificationCheck(check, callbacks));
  }

  return results;
}

export async function executeOpenSwanVerificationCheck(
  check: OpenSwanVerificationCheck,
  callbacks: VerificationCallbacks = {},
): Promise<OpenSwanVerificationResult> {
  const tool = getToolNameForCheck(check);

  if (check.kind !== 'typecheck' && check.kind !== 'tests' && check.kind !== 'lint') {
    const status: OpenSwanExecutionStatus = check.required ? 'manual_required' : 'planned';
    callbacks.onToolEvent?.({
      tool,
      status,
      summary: summarize(check, { status }),
    });
    return {
      check,
      status,
      execution: {
        status,
        mode: status === 'manual_required' ? 'manual' : 'informational',
        summary: summarize(check, { status }),
        checkId: check.id,
        checkLabel: check.label,
        executed: false,
        error: null,
      },
      ok: status !== 'manual_required',
      executed: false,
      summary: summarize(check, { status }),
    };
  }

  callbacks.onToolEvent?.({
    tool,
    status: 'running',
    summary: `Running ${check.label}`,
  });
  const result = await executeOpenSwanTool(tool, {}) as VerificationToolExecutionResult;
  const status: OpenSwanExecutionStatus = !result.executed
    ? 'blocked'
    : result.ok
      ? 'passed'
      : 'failed';
  callbacks.onToolEvent?.({
    tool,
    status,
    summary: summarize(check, { status, command: result.command, error: result.error }),
    command: result.command,
    metadata: {
      execution: {
        status,
        mode: status === 'blocked' ? 'blocked' : 'automatic',
        summary: summarize(check, { status, command: result.command, error: result.error }),
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
      summary: summarize(check, { status, command: result.command, error: result.error }),
      toolName: tool,
      checkId: check.id,
      checkLabel: check.label,
      command: result.command,
      executed: result.executed,
      error: result.error || null,
    },
    ok: status === 'passed',
    executed: result.executed,
    summary: summarize(check, { status, command: result.command, error: result.error }),
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
