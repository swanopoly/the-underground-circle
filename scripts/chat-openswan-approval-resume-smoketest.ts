/**
 * Focused contract for Chat -> OpenSwan approval continuation.
 *
 * The user-facing continuation must be structural: the original task is
 * routed directly to OpenSwan with an A-ledger, while approval ids/digests
 * remain in transient runtime context rather than technical prompt prose.
 *
 * Run: npx tsx scripts/chat-openswan-approval-resume-smoketest.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  bindChatApprovalResumeActionContract,
  buildChatAutomationPlan,
} from '../src/lib/chatAutomationPlanner';

let assertions = 0;
function check(value: unknown, message: string): asserts value {
  assertions += 1;
  assert.ok(value, message);
}

const originalTask = 'Publish the approved release note to the team site.';
const technicalPrompt =
  'Approval deadbeef for browser.publish was granted. Retry that exact call now.';
const classified = buildChatAutomationPlan({ message: technicalPrompt, selectedMode: 'plan' });
const bound = bindChatApprovalResumeActionContract(classified, {
  originalUserTaskText: originalTask,
});
check(bound, 'a valid original task binds');
assertions += 7;
assert.equal(bound.execution.kind, 'run_openswan');
assert.equal(bound.execution.commandText, originalTask);
assert.equal(bound.multiActionLedger?.actionCount, 1);
assert.equal(bound.multiActionLedger?.actions[0]?.id, 'A1');
assert.equal(bound.multiActionLedger?.actions[0]?.text, originalTask);
assert.equal(bound.multiActionLedger?.actions[0]?.connective, 'lead');
assert.deepEqual(bound.multiActionLedger?.actions[0]?.dependsOnActionIds, []);

const originalLedger = buildChatAutomationPlan({
  message: 'List the rooms, then summarize the newest one.',
}).multiActionLedger;
check(originalLedger, 'compound source task has an original ledger');
const rebound = bindChatApprovalResumeActionContract(classified, {
  originalUserTaskText: 'List the rooms, then summarize the newest one.',
  ledger: originalLedger,
});
check(rebound, 'an existing source ledger binds');
assertions += 2;
assert.equal(rebound.multiActionLedger, originalLedger, 'exact ledger identity is preserved');
assert.equal(
  classified.execution.commandText === rebound.execution.commandText,
  false,
  'base plan command is not mutated into the original task',
);

assertions += 3;
assert.equal(bindChatApprovalResumeActionContract(classified, { originalUserTaskText: '' }), null);
assert.equal(bindChatApprovalResumeActionContract(classified, { originalUserTaskText: '   ' }), null);
assert.equal(
  bindChatApprovalResumeActionContract(classified, { originalUserTaskText: 'x'.repeat(4_001) }),
  null,
);

const chatPath = path.join(process.cwd(), 'src/screens/circles/tabs/ChatTab.tsx');
const chatSource = fs.readFileSync(chatPath, 'utf8');
const sessionRuntimeSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/openswanSessionRuntime.ts'),
  'utf8',
);
const runSystemSource = fs.readFileSync(
  path.join(process.cwd(), 'src/lib/agentRunSystem.ts'),
  'utf8',
);

// These source-level integration pins intentionally start red until ChatTab's
// queue is migrated. They catch the exact historical regression: technical
// approval prose passed to ordinary sendMessage and attachment consumption.
const sourceChecks: Array<[boolean, string]> = [
  [chatSource.includes('bindChatApprovalResumeActionContract'), 'Chat imports and uses the structural binder'],
  [chatSource.includes('approvalResumeBinding:'), 'Chat passes the transient runtime binding'],
  [chatSource.includes('approvalResumeSourceMessageId: exactSourceUserMessageId'), 'Chat binds approval custody to the exact persisted source user row'],
  [chatSource.includes('restoreOpenSwanApprovalResumeOutboxIntoProcessAuthority'), 'Chat restores only the encrypted device-local exact call'],
  [chatSource.includes('onApprovedUnconsumedChange={(approvedRows) =>'), 'Chat reconciles approved-unconsumed rows after realtime/reload'],
  [chatSource.includes('allowApproval={(approval) => (')
    && chatSource.includes('approval.requested_by === currentUserId')
    && chatSource.includes('resolveChatOpenSwanRunOwnerRef.current('), 'Chat shows and counts only requester-owned approvals from the exact mounted source thread'],
  [chatSource.includes("sourceRun.provider === 'openswan'"), 'reload recovery requires an exact OpenSwan source run'],
  [chatSource.includes("terminalRecord?.reason === 'action_coverage_incomplete'"), 'reload recovery requires the approval-stop terminal reason'],
  [chatSource.includes('approval.resolved_by !== currentUserId'), 'another member cannot trigger requester-device generic continuation'],
  [chatSource.includes('openSwanApprovalResumeCustody'), 'Chat has an accepted-custody observer'],
  [chatSource.includes('onApprovalResumeAccepted:'), 'Chat transfers queue custody only after the runtime claims the whole sealed call set'],
  [!chatSource.includes('options.openSwanApprovalResumeCustody.accepted();'), 'Chat does not consume queue custody before durable runtime acceptance'],
  [chatSource.includes('boundOpenSwanApprovalResume'), 'send guard recognizes the bound continuation'],
  [chatSource.includes('requestSourceMessageId: exactSourceUserMessageId'), 'OpenSwan bot lineage persists the exact source user row'],
  [chatSource.includes('authorId: currentUserId || undefined'), 'the optimistic bot row preserves the exact requesting user before realtime hydration'],
  [chatSource.includes('message.dbId === sourceUserMessageId'), 'reload resolves the original task by exact persisted row id'],
  [!chatSource.includes('const candidate = messages[botIndex - 1]'), 'reload never infers the source task from transcript adjacency'],
  [chatSource.includes('const resumedSourceUserMessage = resumedSourceMessageId'), 'continuation reuses the exact source user row'],
  [chatSource.includes('const userMessage = resumedSourceUserMessage || addUserMessage('), 'continuation does not create a synthetic user bubble'],
  [chatSource.includes('if (!resumedSourceUserMessage) {\n      setInput(\'\');'), 'continuation preserves an unrelated composer draft'],
  [chatSource.includes('if (!resumedSourceUserMessage) {\n      if (profileRef.current)'), 'continuation does not double-count profile or activity telemetry'],
  [chatSource.includes('await requirePersistedUserMessageId()'), 'tool-capable OpenSwan waits for durable source lineage before dispatch'],
  [!chatSource.includes('For each approved tool call that has not already executed'), 'technical retry prose is removed'],
  [!chatSource.includes('Approval ${q.id.slice(0, 8)}'), 'approval ids never enter Chat prompt prose'],
  [chatSource.includes('This tab does not hold the encrypted exact call yet'), 'missing local custody stays a truthful nonterminal notice'],
  [chatSource.includes('Approval recorded — securely verifying the exact OpenSwan action before continuing.'), 'Chat acknowledges approval immediately without claiming dispatch'],
  [chatSource.includes('their original order.'), 'combined approval copy promises canonical order verification rather than UI order'],
  [chatSource.includes('.slice(0, OPEN_SWAN_APPROVAL_RESUME_MAX_ITEMS)'), 'large recovered approval sets drain through bounded sealed chunks'],
  [chatSource.includes('terminalWithoutCustody: () => {'), 'a terminal pre-custody result dequeues once instead of retry-looping'],
  [chatSource.includes("'The approved continuation no longer matches its original OpenSwan task and conversation. Nothing ran. Please ask OpenSwan to continue again.'")
    && /approved continuation no longer matches[\s\S]{0,900}terminalWithoutCustody\(\)/.test(chatSource), 'a definitive preflight binding failure terminates queued custody exactly once'],
  [chatSource.includes("'The approved OpenSwan action could not find its exact original request in this conversation. Nothing ran. Ask OpenSwan to continue the task again.'")
    && /resumedSourceMessageId && !resumedSourceUserMessage[\s\S]{0,1500}terminalWithoutCustody\(\)/.test(chatSource), 'a missing exact source row terminates queued custody instead of re-flushing'],
  [/const sendMessage = async[\s\S]{0,900}catch \(error\) \{[\s\S]{0,500}terminalWithoutCustody\(\)/.test(chatSource), 'the outer send boundary terminates pre-runtime approval custody before recovery returns'],
  [chatSource.includes('authoritativeIds.has(entry.item.approvalId)'), 'realtime authority prunes queued approvals that another tab already consumed'],
];
for (const [ok, message] of sourceChecks) check(ok, message);

check(
  sessionRuntimeSource.includes('threadId: opts.chatSessionId || undefined')
    && sessionRuntimeSource.includes('sourceMessageId: opts.approvalResumeSourceMessageId || undefined'),
  'run creation persists canonical Circle Chat thread and exact source-message lineage',
);
check(
  !sessionRuntimeSource.includes('chatSessionId: opts.chatSessionId || undefined'),
  'Circle Chat thread ids are never written to the unrelated legacy chat_session_id foreign key',
);
check(
  runSystemSource.includes("const optionalColumns = ['agent_id', 'thread_id', 'source_message_id'] as const"),
  'run creation has a narrow missing-column rollout fallback for the canonical lineage columns',
);
check(
  sessionRuntimeSource.indexOf('verifyOpenSwanApprovalResumeSourceLineage({')
    < sessionRuntimeSource.indexOf('claimOpenSwanApprovalResumeOutboxCalls({'),
  'durable source lineage is proven before encrypted one-shot device custody is claimed',
);
check(
  sessionRuntimeSource.includes('The encrypted calls were kept for a safe retry'),
  'missing rollout lineage fails closed without destroying recoverable exact calls',
);

console.log(`chat OpenSwan approval-resume smoke passed (${assertions} assertions)`);
