/**
 * Source contract for the device-private attachment approval recovery receipt.
 *
 * No provider, Supabase, bridge, file, or desktop I/O occurs here. The smoke
 * pins the Chat boundary that turns an approved-but-unrecoverable in-memory
 * lease into one durable, value-free blocked message without replaying it.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const chatSource = readFileSync(
  resolve(root, 'src/screens/circles/tabs/ChatTab.tsx'),
  'utf8',
);

let assertions = 0;
function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  assertions += 1;
}

const dedupeIndex = chatSource.indexOf(
  'const desktopAttachmentResumeUnavailableNoticeKeysRef = useRef(new Set<string>());',
);
const recoveryIndex = chatSource.indexOf(
  'const addDurableDesktopAttachmentResumeUnavailableMessage = (',
);
const sendBoundaryIndex = chatSource.indexOf('const sendMessageUnsafe = async (');
const handlerIndex = chatSource.indexOf(
  'handleDesktopAttachmentApprovalResumeRef.current = async',
  recoveryIndex,
);
const quickActionIndex = chatSource.indexOf(
  'const handleQuickActionSelection',
  handlerIndex,
);
check(dedupeIndex > 0, 'Chat owns a process-local recovery-message dedupe set');
check(sendBoundaryIndex > 0 && sendBoundaryIndex < recoveryIndex, 'the send boundary precedes the approval recovery handler');
check(recoveryIndex > dedupeIndex, 'the durable recovery helper is declared after its stable dedupe authority');
check(handlerIndex > recoveryIndex && quickActionIndex > handlerIndex, 'the exact approval handler uses the bounded helper');

const sendBoundarySource = chatSource.slice(sendBoundaryIndex, recoveryIndex);
const recoverySource = chatSource.slice(recoveryIndex, handlerIndex);
const handlerSource = chatSource.slice(handlerIndex, quickActionIndex);
check(/queued\.status !== 'approved'/.test(recoverySource), 'only an approved decision can emit the recovery terminal');
check(/queued\.userId !== currentUserId/.test(recoverySource), 'recovery requires the exact requester');
check(/queued\.circleId !== circleId/.test(recoverySource), 'recovery requires the exact circle');
check(/queued\.threadId !== activeThreadId/.test(recoverySource), 'recovery requires the exact mounted origin thread');
check(/activeThreadScopeRef\.current\.threadId !== queued\.threadId/.test(recoverySource), 'recovery rechecks live thread scope');
check(/noticeKeys\.has\(approval\.id\)[\s\S]*noticeKeys\.add\(approval\.id\)/.test(recoverySource), 'one approval emits at most one terminal per mounted process');
check(/while \(noticeKeys\.size > 64\)/.test(recoverySource), 'the private dedupe ledger is bounded');

const recoveryMessageStart = recoverySource.indexOf('addBotMessage(');
check(recoveryMessageStart > 0, 'the helper emits one Chat message');
const recoveryMessageSource = recoverySource.slice(recoveryMessageStart);
check((recoverySource.match(/addBotMessage\(/g) || []).length === 1, 'one helper invocation creates one message only');
check(/Approval was recorded, but this device-private attachment open could not resume\./.test(recoveryMessageSource), 'copy truthfully distinguishes recorded consent from unavailable execution');
check(/Nothing was opened\. Reattach one file and ask again\./.test(recoveryMessageSource), 'copy states the non-execution outcome and manual fresh-request recovery');
check(/durability:\s*'transcript'/.test(recoveryMessageSource), 'the blocked outcome survives refresh');
check(/outcomeVerdict:\s*'blocked'/.test(recoveryMessageSource), 'the message cannot infer completion from clean prose');
check(/runId:\s*approval\.run_id/.test(recoveryMessageSource), 'the persisted terminal keeps exact source-run lineage');
check(/requestAuthorId:\s*queued\.userId/.test(recoveryMessageSource), 'the persisted terminal keeps exact requester lineage');
check(/surface:\s*'main_chat_desktop_attachment_resume_unavailable'/.test(recoveryMessageSource), 'the source surface identifies the bounded recovery lane');
check(!/quickReplies|sendMessage\(|desktopAttachmentResume:/.test(recoveryMessageSource), 'the terminal offers no replay or automatic continuation');
check(!/approvalId\s*:|attachmentId\s*:|messageId\s*:|sha256\s*:|(?:storage|local|manifest)?Path\s*:|filename\s*:|appName\s*:|secret\s*:/i.test(recoveryMessageSource), 'visible and persisted recovery fields contain no approval, file, path, app, or secret authority');
check(!/approval\.id/.test(recoveryMessageSource), 'the raw approval id remains outside visible and persisted message arguments');

check((handlerSource.match(/addDurableDesktopAttachmentResumeUnavailableMessage\(queued\)/g) || []).length === 5,
  'missing lease, stale approved batch, binding drift, expiry, and post-claim pre-custody loss share the same durable terminal');
check(/if \(!claimed\.ok\) \{[\s\S]*if \(queued\.status === 'approved'\)[\s\S]*addDurableDesktopAttachmentResumeUnavailableMessage\(queued\)/.test(handlerSource),
  'a process restart or missing lease records recovery only after approval');
const staleBatchStart = handlerSource.indexOf("if (queued.resumeDisposition === 'stale_batch_revoke')");
const rejectionStart = handlerSource.indexOf("if (queued.status === 'rejected')");
const bindingFailureStart = handlerSource.indexOf('if (!privateCapability || !exactLedger)', rejectionStart);
check(staleBatchStart > 0 && rejectionStart > staleBatchStart && bindingFailureStart > rejectionStart,
  'stale batches are consumed before the ordinary rejection and approved-continuation branches');
const staleBatchSource = handlerSource.slice(staleBatchStart, rejectionStart);
check(/try \{[\s\S]*if \(queued\.status === 'approved'\) \{[\s\S]*addDurableDesktopAttachmentResumeUnavailableMessage\(queued\);[\s\S]*\}[\s\S]*\} finally \{[\s\S]*revokeDesktopAttachmentOpenCapability\(privateCapability, scope\)/.test(staleBatchSource),
  'a stale actual approval emits the durable terminal before capability revocation');
check(!/sendMessage\(|desktopAttachmentResume:/.test(staleBatchSource),
  'a stale batch decision cannot dispatch or retry an attachment open');
check(!/addDurableDesktopAttachmentResumeUnavailableMessage/.test(handlerSource.slice(rejectionStart, bindingFailureStart)),
  'rejection remains silent and never poses as a failed approved execution');

const ledgerDriftCopyIndex = sendBoundarySource.indexOf(
  'The approved attachment-open continuation no longer matches its exact task ledger.',
);
const ledgerDriftReturnIndex = sendBoundarySource.indexOf('return;', ledgerDriftCopyIndex);
const custodyAcceptedIndex = sendBoundarySource.indexOf('options.desktopAttachmentResumeCustody.accepted();');
check(
  ledgerDriftCopyIndex > 0
    && ledgerDriftReturnIndex > ledgerDriftCopyIndex
    && custodyAcceptedIndex > ledgerDriftReturnIndex,
  'ledger drift returns from sendMessage before runtime custody can be accepted',
);
const claimIndex = handlerSource.indexOf('const claimed = claimOpenSwanDesktopAttachmentApprovalResumeLease({');
const sendResumeIndex = handlerSource.indexOf('await sendMessage(claimed.originalUserTaskText');
const sendFinallyIndex = handlerSource.indexOf('} finally {', sendResumeIndex);
check(claimIndex > 0 && sendResumeIndex > claimIndex && sendFinallyIndex > sendResumeIndex,
  'the claimed lease wraps the entire send attempt in a finally boundary');
const postClaimFinallySource = handlerSource.slice(sendFinallyIndex);
check(/if \(!custodyTransferred && isDesktopAttachmentOpenCapability\(privateCapability\)\) \{[\s\S]*try \{[\s\S]*addDurableDesktopAttachmentResumeUnavailableMessage\(queued\);[\s\S]*\} finally \{[\s\S]*revokeDesktopAttachmentOpenCapability\(privateCapability, scope\)/.test(postClaimFinallySource),
  'every return or throw before custody emits the durable blocked terminal and then revokes');
check(/accepted: \(\) => \{[\s\S]*custodyTransferred = true;[\s\S]*Approval granted — resuming/.test(handlerSource),
  'only the runtime custody callback suppresses the blocked recovery terminal');

const batchIndex = chatSource.indexOf('onResolvedBatch={(batchApprovals, status) => {');
const enhancedInputIndex = chatSource.indexOf('\n      <EnhancedInput', batchIndex);
check(batchIndex > 0 && enhancedInputIndex > batchIndex, 'the stale batch callback is source-isolated');
const batchSource = chatSource.slice(batchIndex, enhancedInputIndex);
check(/const desktopApprovals = batchApprovals\.filter/.test(batchSource),
  'desktop batch decisions inspect the actual callback rows rather than a rewritten decision list');
check(/approval\.requested_by !== currentUserId/.test(batchSource),
  'stale desktop batch recovery requires the exact requester');
check(/immediateOwner\?\.userId === currentUserId[\s\S]*immediateOwner\.circleId === circleId[\s\S]*immediateOwner\.threadId === activeThreadId/.test(batchSource),
  'stale desktop batch recovery accepts only the exact live run owner scope');
check(/message\.runId === approval\.run_id[\s\S]*message\.requestAuthorId === currentUserId/.test(batchSource),
  'persisted run ownership also requires exact requester lineage');
const desktopBatchStart = batchSource.indexOf('if (desktopApprovals.length > 0)');
const ordinaryBatchStart = batchSource.indexOf('const genericApprovals = batchApprovals.filter', desktopBatchStart);
check(desktopBatchStart > 0 && ordinaryBatchStart > desktopBatchStart, 'the defensive desktop batch branch is bounded');
const desktopBatchSource = batchSource.slice(desktopBatchStart, ordinaryBatchStart);
check(/approval,[\s\S]*status,[\s\S]*resumeDisposition: 'stale_batch_revoke'/.test(desktopBatchSource),
  'the handler receives the actual approved or rejected batch decision unchanged');
check(!/status:\s*'rejected'/.test(desktopBatchSource),
  'an actual batch approval is never rewritten into a silent rejection');
check(!/addBotMessage\(|sendMessage\(|queuedApprovalResumesRef|flushQueuedApprovalResumesRef/.test(desktopBatchSource),
  'the stale desktop branch emits no ephemeral substitute and schedules no retry or dispatch');

check(/const messageThreadId = activeThreadId;/.test(chatSource), 'Chat snapshots the mounted thread for every bot message');
check(/if \(durability === 'transcript' && messageThreadId\) \{[\s\S]*saveRecoverableChatMessage\(messageThreadId, msg\)/.test(chatSource),
  'transcript recovery enters the local refresh-recovery store');
check(/if \(durability === 'transcript' && currentUserId && messageThreadId\) \{[\s\S]*persistChatTabBotMessageWithRetry\(/.test(chatSource),
  'transcript recovery enters durable Chat persistence with retry');
check(/assign\('runId', message\.runId\);[\s\S]*assign\('requestAuthorId', message\.requestAuthorId\);/.test(chatSource),
  'run and requester lineage survive the persisted metadata projection');

console.log(`Chat desktop attachment recovery durability smoke passed (${assertions} assertions).`);
