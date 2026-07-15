// localExecPlanCore — the PURE wiring brain for the coding-agent execution
// tools (plan P2/P3): `local.run_shell` and `git.run`. It composes the two
// pure policy cores (`shellCommandPolicy`, `gitCommandPolicy`) into ONE
// bridge-ready exec plan: a validated argv array, a clamped timeout, the
// approval tier (auto / ask / never), a redacted preview for approval
// banners, and a bounded formatter for the tool-loop result text.
//
// Execution contract: the bridge runs execFile(argv[0], argv.slice(1)) — argv
// is NEVER joined into a shell string for execution, so pipes/&&/redirection
// inside args are inert text to the child process. The joined form is used
// ONLY for classification, which makes classification strictly MORE
// conservative than execution (an arg containing `|` or `$(…)` escalates the
// tier even though execFile would pass it literally). Over-asking is safe;
// under-asking is the only real failure.
//
// PURITY: imports only the two pure zero-import policy cores. tsx-loadable
// (smoke: local-exec-plan-core). Never throws.

import {
  classifyShellCommand,
  SHELL_TIMEOUT_DEFAULT_MS,
  SHELL_TIMEOUT_MIN_MS,
  SHELL_TIMEOUT_MAX_MS,
} from './shellCommandPolicy';
import { planGitCommand } from './gitCommandPolicy';

export type LocalExecTool = 'local.run_shell' | 'git.run';
export type LocalExecClassification = 'read' | 'mutate' | 'blocked';
export type LocalExecApprovalTier = 'auto' | 'ask' | 'never';

export interface LocalExecPlan {
  /** true when the command may execute (read or approval-gated mutate). */
  ok: boolean;
  tool: LocalExecTool;
  /** FULL argv — binary at [0]; the bridge runs execFile(argv[0], argv.slice(1)). */
  argv: string[];
  /** Working directory as provided; the bridge re-validates and enforces the write-scoped grant. */
  cwd: string;
  timeoutMs: number;
  classification: LocalExecClassification;
  approvalTier: LocalExecApprovalTier;
  reason: string;
  /** Secret-redacted, length-bounded command echo for approval banners. */
  preview: string;
  notes: string[];
}

export const MAX_EXEC_ARGS = 256;
export const MAX_EXEC_ARG_LENGTH = 2_048;
/** Cap for the formatted tool-loop result text (head+tail, tail-biased). */
export const MAX_EXEC_RESULT_TEXT = 12_000;

function blockedPlan(tool: LocalExecTool, reason: string, cwd = '', preview = ''): LocalExecPlan {
  return {
    ok: false,
    tool,
    argv: [],
    cwd,
    timeoutMs: SHELL_TIMEOUT_DEFAULT_MS,
    classification: 'blocked',
    approvalTier: 'never',
    reason,
    preview,
    notes: [],
  };
}

function clampTimeout(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : SHELL_TIMEOUT_DEFAULT_MS;
  return Math.max(SHELL_TIMEOUT_MIN_MS, Math.min(SHELL_TIMEOUT_MAX_MS, n));
}

/** Validates a raw argv array: 1..MAX strings, bounded length, no control
 *  chars (tab allowed — legit in grep patterns etc.). Returns an error string
 *  or null. */
function validateArgv(raw: unknown): { argv: string[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'argv must be a non-empty array of strings' };
  if (raw.length > MAX_EXEC_ARGS) return { error: `argv exceeds ${MAX_EXEC_ARGS} args` };
  const argv: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') return { error: 'every argv element must be a string' };
    if (item.length > MAX_EXEC_ARG_LENGTH) return { error: `an argv element exceeds ${MAX_EXEC_ARG_LENGTH} chars` };
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(item)) return { error: 'argv contains control characters' };
    argv.push(item);
  }
  if (!argv[0].trim()) return { error: 'argv[0] (the binary) must be non-empty' };
  return { argv };
}

/**
 * Plan a `local.run_shell` call. args: { argv: string[]; cwd: string;
 * timeoutMs?: number }. Classification runs over the space-joined argv via
 * `classifyShellCommand` — strictly more conservative than the argv execution
 * (see module header). Never throws.
 */
export function planRunShellExec(rawArgs: unknown): LocalExecPlan {
  const a = (rawArgs || {}) as Record<string, unknown>;
  const validated = validateArgv(a.argv);
  if ('error' in validated) return blockedPlan('local.run_shell', validated.error);
  const cwd = typeof a.cwd === 'string' ? a.cwd.trim() : '';
  if (!cwd) return blockedPlan('local.run_shell', 'cwd is required — pass the repo/project directory the command should run in');

  const joined = validated.argv.join(' ');
  const decision = classifyShellCommand(joined, { timeoutMs: typeof a.timeoutMs === 'number' ? a.timeoutMs : undefined });
  return {
    ok: decision.ok,
    tool: 'local.run_shell',
    argv: decision.ok ? validated.argv : [],
    cwd,
    timeoutMs: decision.clampedTimeoutMs,
    classification: decision.classification,
    approvalTier: decision.approvalTier,
    reason: decision.reason,
    preview: decision.preview,
    notes: decision.notes,
  };
}

/**
 * Plan a `git.run` call. args: { verb: string; args?: string[]; message?:
 * string; repoPath: string; timeoutMs?: number }. Delegates verb/flag safety
 * to `planGitCommand` (read→auto, write→ask, force-push/reset --hard/config
 * injection→blocked) and prepends the git binary to its argv. Never throws.
 */
export function planGitRunExec(rawArgs: unknown): LocalExecPlan {
  const a = (rawArgs || {}) as Record<string, unknown>;
  const repoPath = typeof a.repoPath === 'string' ? a.repoPath.trim() : '';
  if (!repoPath) return blockedPlan('git.run', 'repoPath is required — pass the repository directory the git command should run in');

  const gitPlan = planGitCommand({ verb: a.verb as string, args: a.args as unknown[], message: a.message as string | undefined });
  const preview = `git ${gitPlan.argv.join(' ')}`.slice(0, 200);
  if (!gitPlan.ok) {
    return { ...blockedPlan('git.run', gitPlan.reason, repoPath, preview), notes: gitPlan.notes };
  }
  return {
    ok: true,
    tool: 'git.run',
    argv: ['git', ...gitPlan.argv],
    cwd: repoPath,
    timeoutMs: clampTimeout(a.timeoutMs),
    classification: gitPlan.classification === 'read' ? 'read' : 'mutate',
    approvalTier: gitPlan.approvalTier,
    reason: gitPlan.reason,
    preview,
    notes: gitPlan.notes,
  };
}

/** Single entry used by the approval gate and the executors. Never throws. */
export function planLocalExec(tool: LocalExecTool, rawArgs: unknown): LocalExecPlan {
  return tool === 'git.run' ? planGitRunExec(rawArgs) : planRunShellExec(rawArgs);
}

export interface LocalExecBridgeOutcome {
  exitCode: number | null;
  signal?: string | null;
  timedOut: boolean;
  outputOverflow?: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  truncatedStdout?: boolean;
  truncatedStderr?: boolean;
}

/** Tail-biased cap: errors and test summaries land at the END of output, so
 *  keep a small head and a large tail when over budget. */
function capText(text: string, budget: number): { text: string; capped: boolean } {
  if (text.length <= budget) return { text, capped: false };
  const head = Math.floor(budget * 0.2);
  const tail = budget - head;
  return {
    text: `${text.slice(0, head)}\n… [${text.length - budget} chars omitted] …\n${text.slice(-tail)}`,
    capped: true,
  };
}

/**
 * Formats a bridge exec outcome into the bounded tool-loop result text.
 * `success` is false on non-zero exit, timeout, or output overflow — the
 * run-and-fix gate treats that as a failed verification. Never throws.
 */
export function formatExecResultText(plan: LocalExecPlan, outcome: LocalExecBridgeOutcome): { text: string; success: boolean } {
  const success = outcome.exitCode === 0 && !outcome.timedOut && !outcome.outputOverflow;
  const seconds = (Math.max(0, outcome.durationMs) / 1000).toFixed(1);
  const status = outcome.timedOut
    ? `TIMED OUT after ${seconds}s (limit ${(plan.timeoutMs / 1000).toFixed(0)}s)`
    : outcome.outputOverflow
      ? `OUTPUT OVERFLOW (exceeded the capture buffer) after ${seconds}s`
      : `exit ${outcome.exitCode ?? 'unknown'}${outcome.signal ? ` (signal ${outcome.signal})` : ''} in ${seconds}s`;

  const parts: string[] = [`$ ${plan.preview}`, status];
  const stdout = String(outcome.stdout || '').trim();
  const stderr = String(outcome.stderr || '').trim();
  // Budget split: stderr first-class (it carries the failure), stdout gets the rest.
  const stderrBudget = stderr ? Math.min(stderr.length, Math.floor(MAX_EXEC_RESULT_TEXT * 0.45)) : 0;
  const stdoutBudget = Math.max(1_000, MAX_EXEC_RESULT_TEXT - stderrBudget - 400);
  if (stdout) {
    const capped = capText(stdout, stdoutBudget);
    parts.push(`--- stdout${capped.capped || outcome.truncatedStdout ? ' (truncated)' : ''} ---`, capped.text);
  }
  if (stderr) {
    const capped = capText(stderr, stderrBudget);
    parts.push(`--- stderr${capped.capped || outcome.truncatedStderr ? ' (truncated)' : ''} ---`, capped.text);
  }
  if (!stdout && !stderr) parts.push('(no output)');
  return { text: parts.join('\n'), success };
}
