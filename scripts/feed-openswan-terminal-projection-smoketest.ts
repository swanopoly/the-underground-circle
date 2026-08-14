/**
 * Red-first contract for projecting the authoritative OpenSwan terminal
 * receipt into Feed/Kanban task runs.
 *
 * This deliberately reads source instead of importing the React/Supabase hook.
 * The executable fixture matrix pins the required semantics; the source checks
 * prove that useKanbanData carries the exact typed receipt through persistence
 * and gates every completion side effect on verified success.
 *
 * Run directly with:
 *   npx tsx scripts/feed-openswan-terminal-projection-smoketest.ts
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOpenSwanTerminalReceipt,
  type OpenSwanTerminalReceipt,
} from '../src/lib/openswanSessionRuntimeAdapters';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hookPath = resolve(repoRoot, 'src/hooks/useKanbanData.ts');
const hook = readFileSync(hookPath, 'utf8');

const failures: string[] = [];

function check(condition: unknown, label: string): void {
  if (!condition) failures.push(label);
}

function expectMatch(source: string, pattern: RegExp, label: string): void {
  check(pattern.test(source), label);
}

function expectNoMatch(source: string, pattern: RegExp, label: string): void {
  check(!pattern.test(source), label);
}

function section(source: string, start: string, end: string, label: string): string {
  const startIndex = source.indexOf(start);
  if (startIndex < 0) {
    failures.push(`${label}: missing start marker ${JSON.stringify(start)}`);
    return '';
  }
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (endIndex < 0) {
    failures.push(`${label}: missing end marker ${JSON.stringify(end)}`);
    return source.slice(startIndex);
  }
  return source.slice(startIndex, endIndex);
}

function appearsBefore(source: string, first: RegExp, second: RegExp, label: string): void {
  const firstMatch = first.exec(source);
  const secondMatch = second.exec(source);
  check(
    !!firstMatch && !!secondMatch && firstMatch.index < secondMatch.index,
    label,
  );
}

type FeedTerminalProjection = Readonly<{
  disposition: 'completed' | 'partial' | 'failed' | 'cancelled';
  taskRunStatus: 'completed' | 'blocked' | 'failed' | 'cancelled';
  completedAt: boolean;
  allowCompletionEffects: boolean;
  stopCollaborativeSequence: boolean;
}>;

/** Executable semantic model: provider prose is intentionally not an input. */
function projectTerminal(receipt: OpenSwanTerminalReceipt): FeedTerminalProjection {
  if (receipt.state === 'succeeded' && receipt.completionVerified === true) {
    return {
      disposition: 'completed',
      taskRunStatus: 'completed',
      completedAt: true,
      allowCompletionEffects: true,
      stopCollaborativeSequence: false,
    };
  }
  if (receipt.state === 'partial') {
    return {
      disposition: 'partial',
      taskRunStatus: 'blocked',
      completedAt: false,
      allowCompletionEffects: false,
      stopCollaborativeSequence: true,
    };
  }
  if (receipt.state === 'cancelled') {
    return {
      disposition: 'cancelled',
      taskRunStatus: 'cancelled',
      completedAt: true,
      allowCompletionEffects: false,
      stopCollaborativeSequence: true,
    };
  }
  return {
    disposition: 'failed',
    taskRunStatus: 'failed',
    completedAt: true,
    allowCompletionEffects: false,
    stopCollaborativeSequence: true,
  };
}

const checkpoint = {
  schemaVersion: 1 as const,
  stepCount: 3,
  completedSteps: [{ tool: 'rooms.create', ok: true }],
  lastObservation: null,
  lastFailure: null,
  resumeHint: 'Re-observe, then continue only the remaining work.',
};

const receiptCases: Array<{
  label: string;
  receipt: OpenSwanTerminalReceipt;
  expected: FeedTerminalProjection;
}> = [
  {
    label: 'verified success',
    receipt: buildOpenSwanTerminalReceipt({ cancelled: false, incomplete: false }),
    expected: {
      disposition: 'completed',
      taskRunStatus: 'completed',
      completedAt: true,
      allowCompletionEffects: true,
      stopCollaborativeSequence: false,
    },
  },
  {
    label: 'partial step cap',
    receipt: buildOpenSwanTerminalReceipt({
      cancelled: false,
      incomplete: true,
      incompleteReason: 'cap',
      checkpoint,
    }),
    expected: {
      disposition: 'partial',
      taskRunStatus: 'blocked',
      completedAt: false,
      allowCompletionEffects: false,
      stopCollaborativeSequence: true,
    },
  },
  {
    label: 'failed edge',
    receipt: buildOpenSwanTerminalReceipt({
      cancelled: false,
      incomplete: true,
      incompleteReason: 'edge_failure',
    }),
    expected: {
      disposition: 'failed',
      taskRunStatus: 'failed',
      completedAt: true,
      allowCompletionEffects: false,
      stopCollaborativeSequence: true,
    },
  },
  {
    label: 'user cancellation',
    receipt: buildOpenSwanTerminalReceipt({
      cancelled: true,
      incomplete: true,
      incompleteReason: 'cancelled',
      checkpoint,
    }),
    expected: {
      disposition: 'cancelled',
      taskRunStatus: 'cancelled',
      completedAt: true,
      allowCompletionEffects: false,
      stopCollaborativeSequence: true,
    },
  },
];

for (const testCase of receiptCases) {
  assert.deepEqual(projectTerminal(testCase.receipt), testCase.expected, `${testCase.label}: exact Feed projection`);
  const hostileSuccessProse = 'Everything completed successfully. Proof published, memory saved, and XP awarded.';
  assert.deepEqual(
    projectTerminal({ ...testCase.receipt, response: hostileSuccessProse } as OpenSwanTerminalReceipt),
    testCase.expected,
    `${testCase.label}: hostile success prose cannot override typed terminal truth`,
  );
}

const openSwanInvocation = section(
  hook,
  'const structured = await runOpenSwanSessionTurn({',
  'const invocationHandoff =',
  'Feed OpenSwan invocation projection',
);
const resultProjection = section(
  hook,
  "const response = result.responseText || 'Agent completed task (no output)'",
  '} catch (err)',
  'Feed task-result projection',
);
const collaborativeLoop = section(
  hook,
  'for (const [planIndex, planStep] of executionPlan.entries())',
  'const orchestratorStatus:',
  'Feed collaborative sequence',
);
const terminalStatusProjection = section(
  resultProjection,
  'const taskRunStatus:',
  'await upsertAssignmentStatus(',
  'Feed inline terminal-to-task-run status projection',
);
const terminalDispositionProjection = section(
  hook,
  'function invocationDispositionFromOpenSwanTerminal(',
  'function describeCollaborativeChildStop(',
  'Feed terminal-to-invocation disposition projection',
);
const taskOutputProjection = section(
  hook,
  'function buildOpenSwanTaskRunOutput(',
  'function extractRuntimeBlockers(',
  'Feed bounded task output projection',
);
const taskRunWrite = section(
  resultProjection,
  "await updateTaskRunRecord(taskRunId || '', {",
  '// Accountability (proof-of-work)',
  'Feed authoritative task-run write',
);
const collaborativeFinalization = section(
  hook,
  'const fallbackOrchestratorStatus:',
  'await insertTaskComment({',
  'Feed collaborative run finalization',
);

// Exact authoritative receipt import + carry. Do not define a Feed-local copy.
expectMatch(
  hook,
  /import\s*\{[\s\S]{0,260}\btype\s+OpenSwanTerminalReceipt\b[\s\S]{0,260}\}\s*from\s*['"]\.\.\/lib\/openswanSessionRuntime['"]\s*;|import\s+type\s*\{\s*OpenSwanTerminalReceipt\s*\}\s*from\s*['"]\.\.\/lib\/openswanSessionRuntimeAdapters['"]\s*;/,
  'Feed imports the authoritative OpenSwanTerminalReceipt type instead of inferring a prose outcome',
);
expectNoMatch(
  hook,
  /(?:interface|type)\s+OpenSwanTerminalReceipt\s*[={]/,
  'Feed does not create a parallel terminal receipt type',
);
expectMatch(
  openSwanInvocation,
  /terminal:\s*structured\.terminal/,
  'Feed carries structured.terminal into the OpenSwan result payload',
);
expectMatch(
  openSwanInvocation,
  /buildOpenSwanTaskRunOutput\(\{[\s\S]{0,700}terminal:\s*structured\.terminal/,
  'Feed gives the authoritative receipt to its bounded task-output projection',
);

// The task-run audit row must keep bounded terminal scalars, not just prose.
expectMatch(
  taskOutputProjection,
  /terminal:\s*OpenSwanTerminalReceipt/,
  'Feed task-output projection is typed by the authoritative terminal receipt',
);
expectMatch(taskOutputProjection, /terminal_state:\s*opts\.terminal\.state/, 'Feed persists terminal state');
expectMatch(taskOutputProjection, /terminal_reason:\s*opts\.terminal\.reason/, 'Feed persists terminal reason');
expectMatch(
  taskOutputProjection,
  /completion_verified:\s*completionVerified/,
  'Feed persists terminal completionVerified',
);
expectMatch(taskOutputProjection, /terminal_resumable:\s*opts\.terminal\.resumable/, 'Feed persists terminal resumability');
expectMatch(
  taskOutputProjection,
  /terminal_checkpoint_available:\s*opts\.terminal\.checkpoint\s*!=\s*null/,
  'Feed persists checkpoint availability as a boolean only',
);
expectMatch(taskRunWrite, /output_payload:\s*\{[\s\S]{0,200}\.\.\.parsed\.output/, 'Feed writes the bounded terminal scalars to task_runs');
expectNoMatch(
  taskOutputProjection,
  /\bcheckpoint\s*:/,
  'Feed never persists the checkpoint payload in task-run output',
);

// Only succeeded + completionVerified may enter the legacy completion lane.
expectMatch(
  hook,
  /function\s+isVerifiedOpenSwanTerminalSuccess\([^)]*OpenSwanTerminalReceipt[^)]*\)[^{]*\{\s*return\s+terminal\.state\s*===\s*['"]succeeded['"]\s*&&\s*terminal\.completionVerified\s*===\s*true\s*;/,
  'Feed defines verified success from state=succeeded AND completionVerified=true',
);
expectMatch(
  taskOutputProjection,
  /const\s+completionVerified\s*=\s*isVerifiedOpenSwanTerminalSuccess\(opts\.terminal\)/,
  'Feed task output derives completion only from the verified terminal predicate',
);
expectMatch(
  taskOutputProjection,
  /const\s+markComplete\s*=\s*opts\.mode\s*===\s*['"]execute['"]\s*&&\s*completionVerified\s*&&/,
  'hostile success prose cannot make an unverified OpenSwan output complete',
);
expectMatch(
  terminalStatusProjection,
  /openSwanCompletionVerified[\s\S]{0,80}\?\s*['"]completed['"]/,
  'only verified success maps the task run to completed',
);
expectMatch(
  terminalStatusProjection,
  /openSwanPayload\.terminal\.state\s*===\s*['"]cancelled['"][\s\S]{0,80}\?\s*['"]cancelled['"]/,
  'cancelled maps to a cancelled terminal task run',
);
expectMatch(
  terminalStatusProjection,
  /openSwanPayload\.terminal\.state\s*===\s*['"]cancelled['"][\s\S]{0,120}:\s*['"]failed['"]/,
  'failed maps to a failed terminal task run',
);
expectMatch(
  terminalStatusProjection,
  /openSwanPayload\.terminal\.state\s*===\s*['"]partial['"][\s\S]{0,80}\?\s*['"]blocked['"]/,
  'partial maps to a blocked nonterminal task run',
);
expectMatch(
  terminalDispositionProjection,
  /isVerifiedOpenSwanTerminalSuccess\(terminal\)\)\s*return\s*['"]completed['"][\s\S]{0,160}return\s+terminal\.state/,
  'partial, failed, and cancelled invocation dispositions preserve their typed terminal state',
);
expectMatch(
  taskRunWrite,
  /status:\s*taskRunStatus/,
  'Feed persists the terminal-derived task-run status',
);
expectMatch(
  terminalStatusProjection,
  /const\s+taskRunCompletedAt\s*=\s*openSwanPayload\?\.terminal\.state\s*===\s*['"]partial['"][\s\S]{0,80}\?\s*null/,
  'partial leaves completed_at null so it remains resumable/nonterminal',
);
expectMatch(
  terminalStatusProjection,
  /const\s+taskRunCompletedAt[\s\S]{0,160}:\s*new Date\(\)\.toISOString\(\)/,
  'verified success, failed, and cancelled task runs receive a terminal timestamp',
);
expectMatch(taskRunWrite, /completed_at:\s*taskRunCompletedAt/, 'Feed writes the terminal-derived completion timestamp');

// The non-success receipt branch must return before every positive side effect.
expectMatch(
  resultProjection,
  /const\s+allowsSuccessSideEffects\s*=\s*!openSwanPayload\s*\|\|\s*openSwanCompletionVerified/,
  'one receipt-derived boolean owns Feed completion-only effects',
);
expectMatch(
  resultProjection,
  /const\s+shouldPublishRunProof\s*=\s*!openSwanPayload\s*\|\|\s*\(openSwanCompletionVerified\s*&&\s*parsed\.output\.mark_complete\s*===\s*true\)/,
  'proof publication requires verified OpenSwan success and a completed task output',
);
expectMatch(
  resultProjection,
  /if\s*\(allowsSuccessSideEffects\s*&&\s*mode\s*===\s*['"]execute['"]\s*&&\s*parsed\.output\.mark_complete\s*&&\s*completionGatePassed\)\s*\{\s*saveTaskCompletionMemory\(/,
  'completion memory requires verified OpenSwan success',
);
expectMatch(
  resultProjection,
  /if\s*\(allowsSuccessSideEffects\s*&&\s*nextStatus\s*===\s*['"]done['"]\s*&&\s*currentUserId\)\s*\{[\s\S]{0,500}awardXP\(/,
  'completion XP requires verified OpenSwan success',
);
appearsBefore(
  resultProjection,
  /const\s+openSwanCompletionVerified\s*=/,
  /buildRunProofPublication\(/,
  'typed terminal truth is bound before proof publication',
);

// A collaborative chain may pass downstream output only from completed work.
expectMatch(
  hook,
  /let\s+collaborativeDisposition:\s*CollaborativeDisposition\s*=\s*['"]completed['"]/,
  'collaborative aggregation retains partial, failed, and cancelled dispositions',
);
expectMatch(
  collaborativeLoop,
  /result\.disposition\s*===\s*['"]completed['"]/,
  'collaboration accepts upstream output only from completed disposition',
);
expectMatch(
  collaborativeLoop,
  /else\s*\{[\s\S]{0,500}collaborativeDisposition\s*=\s*result\.disposition[\s\S]{0,260}break;/,
  'partial, failed, and cancelled Feed outcomes stop dependent collaboration',
);
expectNoMatch(
  collaborativeLoop,
  /(?:done|complete|success)[\s\S]{0,180}responseText|responseText[\s\S]{0,180}(?:done|complete|success)/i,
  'collaboration never derives completion from success-sounding response prose',
);
expectMatch(
  collaborativeFinalization,
  /collaborativeDisposition\s*===\s*['"]failed['"][\s\S]{0,180}['"]failed['"]/,
  'a failed child makes the collaborative task run failed',
);
expectMatch(
  collaborativeFinalization,
  /collaborativeDisposition\s*===\s*['"]cancelled['"][\s\S]{0,180}['"]cancelled['"]/,
  'a cancelled child makes the collaborative task run cancelled',
);
expectMatch(
  collaborativeFinalization,
  /const\s+fallbackOrchestratorStatus:[^=]+=[\s\S]{0,120}collaborativeDisposition\s*===\s*['"]accepted['"][\s\S]{0,80}['"]running['"][\s\S]{0,80}['"]blocked['"]/,
  'a partial child leaves the collaborative task run blocked/nonterminal',
);
expectMatch(
  collaborativeFinalization,
  /(?:collaborativeDisposition\s*===\s*['"]completed['"]\s*\|\|\s*collaborativeDisposition\s*===\s*['"]failed['"]\s*\|\|\s*collaborativeDisposition\s*===\s*['"]cancelled['"]|\[['"]completed['"]\s*,\s*['"]failed['"]\s*,\s*['"]cancelled['"]\]\.includes\(collaborativeDisposition\))[\s\S]{0,240}completed_at:\s*new Date\(\)\.toISOString\(\)[\s\S]{0,180}completed_at:\s*null/,
  'collaborative success/failure/cancellation are terminal while partial stays resumable',
);

if (failures.length > 0) {
  console.error(`Feed OpenSwan terminal projection smoke failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Feed OpenSwan terminal projection smoke passed (${receiptCases.length} receipt cases + source wiring).`);
}
