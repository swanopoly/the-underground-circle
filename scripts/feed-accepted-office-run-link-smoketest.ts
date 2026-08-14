/**
 * Red-first source-wiring contract for accepted Feed/Kanban handoffs.
 *
 * A provider acknowledgement is not a completed task, but a confirmed
 * acceptance must still create one canonical, deliberately queued `feed_task`
 * ledger row. The exact local run id is then persisted on `task_runs` and can
 * be opened from both Feed task-run presentations. Unknown/failed dispatches
 * must never manufacture that ledger.
 *
 * This smoke deliberately avoids importing React Native or Supabase modules.
 * Run directly with:
 *   npx tsx scripts/feed-accepted-office-run-link-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath: string): string => readFileSync(resolve(repoRoot, relativePath), 'utf8');

const kanbanHook = read('src/hooks/useKanbanData.ts');
const agentRunSystem = read('src/lib/agentRunSystem.ts');
const activityFeed = read('src/screens/circles/tabs/kanban/ActivityFeedPanel.tsx');
const taskDetail = read('src/screens/circles/tabs/kanban/TaskDetailModal.tsx');
const feedTab = read('src/screens/circles/tabs/FeedTab.tsx');
const circleDetail = read('src/screens/circles/CircleDetailScreen.tsx');

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

function count(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))).length;
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

const acceptedRunWriter = section(
  agentRunSystem,
  'export async function recordConnectedAgentAcceptedRun',
  '// ── 2. Update Run Status',
  'canonical accepted-run writer',
);
const feedHandoffBranch = section(
  kanbanHook,
  "if (invocationDisposition === 'accepted' || invocationDisposition === 'outcome_unknown')",
  'if (!result.success)',
  'Feed accepted/outcome-unknown branch',
);
const feedFailureBranch = section(
  kanbanHook,
  'if (!result.success)',
  "const response = result.responseText || 'Agent completed task (no output)'",
  'Feed failed branch',
);
const activityTaskRunRenderer = section(
  activityFeed,
  'const renderTaskRun =',
  'const renderAutomationRun =',
  'Activity Feed task-run renderer',
);
const taskDetailRunRenderer = section(
  taskDetail,
  '{taskRuns.slice(0, 5).map(run => {',
  '{/* ── Execution Runtime Panels',
  'Task Detail task-run renderer',
);

// ── Executable disposition/cardinality specification ───────────────────────

type Disposition = 'accepted' | 'outcome_unknown' | 'failed';

function modelAcceptedLedger(
  disposition: Disposition,
  create: () => { id: string } | null,
): { disposition: Disposition; canonicalRunId: string | null; calls: number } {
  let calls = 0;
  let canonicalRunId: string | null = null;
  if (disposition === 'accepted') {
    try {
      calls += 1;
      canonicalRunId = create()?.id || null;
    } catch {
      // Provider ownership is already established. Ledger failure may remove
      // the deep link, but must not rewrite acceptance or dispatch again.
    }
  }
  return { disposition, canonicalRunId, calls };
}

const accepted = modelAcceptedLedger('accepted', () => ({ id: 'local-run-1' }));
check(
  accepted.disposition === 'accepted' && accepted.canonicalRunId === 'local-run-1' && accepted.calls === 1,
  'spec: accepted dispatch creates exactly one canonical run and retains its id',
);
const acceptedLedgerFailure = modelAcceptedLedger('accepted', () => {
  throw new Error('ledger unavailable');
});
check(
  acceptedLedgerFailure.disposition === 'accepted'
    && acceptedLedgerFailure.canonicalRunId === null
    && acceptedLedgerFailure.calls === 1,
  'spec: ledger failure preserves accepted disposition without replay',
);
for (const disposition of ['outcome_unknown', 'failed'] as const) {
  const result = modelAcceptedLedger(disposition, () => ({ id: 'must-not-exist' }));
  check(
    result.disposition === disposition && result.canonicalRunId === null && result.calls === 0,
    `spec: ${disposition} creates zero canonical runs`,
  );
}

// ── Canonical writer: queued feed_task row with task + subject attribution ──

expectMatch(
  acceptedRunWriter,
  /taskId\?:\s*string(?:\s*\|\s*null)?/,
  'canonical accepted-run writer accepts an optional task id',
);
expectMatch(
  acceptedRunWriter,
  /createRun\(\{[\s\S]*?taskId:\s*opts\.taskId/,
  'canonical accepted-run writer forwards task id to agent_runs.task_id',
);
expectMatch(
  acceptedRunWriter,
  /agentSubjectMetadata\?:\s*AgentRuntimeSubjectMetadata/,
  'canonical accepted-run writer accepts canonical subject metadata',
);
expectNoMatch(
  acceptedRunWriter,
  /updateRunStatus\(|startRun\(|heartbeat/i,
  'canonical accepted-run writer never starts or heartbeats an acceptance-only row',
);
expectMatch(
  agentRunSystem,
  /status:\s*'queued'/,
  'canonical createRun persists a queued row by default',
);

// ── Feed writer: accepted-only, one attempt, failure-safe, exact local id ───

expectMatch(
  kanbanHook,
  /import\s*\{[\s\S]{0,300}?recordConnectedAgentAcceptedRun[\s\S]{0,300}?\}\s*from\s*['"]\.\.\/lib\/agentRunSystem['"]/,
  'Feed imports the canonical connected-agent accepted-run writer',
);
check(
  count(feedHandoffBranch, /recordConnectedAgentAcceptedRun\(/g) === 1,
  'Feed handoff branch contains exactly one canonical accepted-run write site',
);
expectMatch(
  feedHandoffBranch,
  /if\s*\(\s*accepted(?:\s*&&[^)]*)?\s*\)\s*\{[\s\S]*?recordConnectedAgentAcceptedRun\(/,
  'canonical run persistence is guarded by accepted status, excluding outcome_unknown',
);
expectMatch(
  feedHandoffBranch,
  /recordConnectedAgentAcceptedRun\(\{[\s\S]*?surface:\s*'feed_task'/,
  'accepted Feed handoff creates a feed_task run',
);
expectMatch(
  feedHandoffBranch,
  /recordConnectedAgentAcceptedRun\(\{[\s\S]*?taskId:\s*task\.id/,
  'accepted Feed handoff links the canonical run to the exact task',
);
expectMatch(
  feedHandoffBranch,
  /recordConnectedAgentAcceptedRun\(\{[\s\S]*?agentSubjectMetadata:\s*(?!null\b)[A-Za-z_$][\w$]*(?:\.metadata)?/,
  'accepted Feed handoff passes canonical non-null agent subject metadata',
);
expectMatch(
  feedHandoffBranch,
  /recordConnectedAgentAcceptedRun\(\{[\s\S]*?externalDispatchKind:\s*invocationHandoff\?\.externalDispatchKind[\s\S]*?externalConnectionId:\s*invocationHandoff\?\.externalConnectionId/,
  'accepted Feed run preserves exact external dispatch and connection lineage',
);
expectMatch(
  feedHandoffBranch,
  /try\s*\{[\s\S]*?recordConnectedAgentAcceptedRun\([\s\S]*?\}\s*catch\s*\{/,
  'accepted Feed run persistence is bounded by a ledger-failure catch',
);
expectNoMatch(
  feedFailureBranch,
  /recordConnectedAgentAcceptedRun\(/,
  'failed Feed dispatch creates no accepted canonical run',
);
expectMatch(
  feedHandoffBranch,
  /canonical_agent_run_id:\s*[A-Za-z_$][\w$]*canonical[\w$]*RunId\s*(?:\|\||\?\?)\s*null/i,
  'task_run persists the newly resolved canonical local run id',
);
expectNoMatch(
  feedHandoffBranch,
  /canonical_agent_run_id:\s*invocationHandoff\?\.runId/,
  'task_run does not merely recopy the direct provider result that lacks a local Feed ledger',
);
const acceptedWriteIndex = feedHandoffBranch.indexOf('recordConnectedAgentAcceptedRun(');
const taskRunUpdateIndex = feedHandoffBranch.indexOf('updateTaskRunRecord(');
check(
  acceptedWriteIndex >= 0 && taskRunUpdateIndex > acceptedWriteIndex,
  'task_run output is persisted only after the accepted canonical run id is resolved',
);
expectMatch(
  feedHandoffBranch,
  /return\s*\{[\s\S]*?disposition:\s*invocationDisposition/,
  'Feed returns the original typed accepted/unknown disposition after ledger persistence',
);

// ── Both Feed presentations expose the exact canonical Office run ───────────

function assertExactRunAction(source: string, label: string): void {
  expectMatch(
    source,
    /handoff\?\.canonicalAgentRunId/,
    `${label} gates its action on the validated canonical local run id`,
  );
  expectMatch(
    source,
    /<Pressable[\s\S]{0,600}?onPress=\{[\s\S]{0,260}?handoff\.canonicalAgentRunId[\s\S]{0,600}?(?:OPEN|VIEW)[ _-]?(?:OFFICE )?RUN/i,
    `${label} renders a visible run action using that exact id`,
  );
  expectNoMatch(
    source,
    /onPress=\{[\s\S]{0,180}?(?:externalSessionId|externalProviderRunId|externalConnectionId)/,
    `${label} never substitutes an external identifier for the Office run action`,
  );
}

assertExactRunAction(activityTaskRunRenderer, 'Activity Feed task-run row');
assertExactRunAction(taskDetailRunRenderer, 'Task Detail task-run row');

// Navigation is callback-owned so the same action works on web and native.
expectMatch(
  activityFeed,
  /onOpenOfficeRun\??:\s*\(runId:\s*string\)\s*=>\s*void/,
  'ActivityFeedPanel declares an exact Office-run callback',
);
expectMatch(
  taskDetail,
  /onOpenOfficeRun\??:\s*\(runId:\s*string\)\s*=>\s*void/,
  'TaskDetailModal declares an exact Office-run callback',
);
check(
  count(feedTab, /<ActivityFeedPanel[\s\S]{0,180}?onOpenOfficeRun=\{onOpenOfficeRun\}/g) >= 2,
  'Feed passes the Office-run callback to Activity Feed in mobile and desktop layouts',
);
check(
  count(feedTab, /<TaskDetailModal[\s\S]{0,260}?onOpenOfficeRun=\{onOpenOfficeRun\}/g) >= 2,
  'Feed passes the Office-run callback to Task Detail in mobile and desktop layouts',
);
expectMatch(
  feedTab,
  /onOpenOfficeRun\??:\s*\(runId:\s*string\)\s*=>\s*void/,
  'FeedTab accepts the cross-platform exact Office-run callback',
);
expectMatch(
  circleDetail,
  /<FeedTab[\s\S]{0,260}?onOpenOfficeRun=\{[A-Za-z_$][\w$]*\}/,
  'CircleDetail supplies Feed with the Office-run navigation callback',
);
expectMatch(
  circleDetail,
  /(?:const|function)\s+[A-Za-z_$][\w$]*(?:\s*=\s*useCallback)?[\s\S]{0,700}?kind:\s*['"]run['"][\s\S]{0,220}?surface:\s*['"]office['"][\s\S]{0,500}?setActiveTab\(\s*['"]OFFICE['"]\s*\)/,
  'CircleDetail converts the exact local id to an office:run focus before opening Office',
);

if (failures.length > 0) {
  console.error(`feed accepted Office-run link smoke: ${failures.length} failure${failures.length === 1 ? '' : 's'}`);
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exitCode = 1;
} else {
  console.log('feed accepted Office-run link smoke: all assertions passed');
}
