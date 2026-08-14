import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const chatSource = readFileSync(
  resolve(root, 'src/screens/circles/tabs/ChatTab.tsx'),
  'utf8',
);
const bannerSource = readFileSync(
  resolve(root, 'src/components/RunApprovalBanner.tsx'),
  'utf8',
);
const sessionSource = readFileSync(
  resolve(root, 'src/lib/openswanSessionRuntime.ts'),
  'utf8',
);

let assertions = 0;
function check(value: unknown, message: string): asserts value {
  assert.ok(value, message);
  assertions += 1;
}

const addUserIndex = chatSource.indexOf('const userMessage = resumedSourceUserMessage || addUserMessage(');
const linkIndex = chatSource.indexOf('await linkAttachmentsToMessage(', addUserIndex);
const classifyIndex = chatSource.indexOf('desktopAttachmentRequest = classifyDesktopAttachmentRequest({', linkIndex);
const clearComposerIndex = chatSource.indexOf('setStagedFiles([]);', classifyIndex);
const stageIndex = chatSource.indexOf('const stagedCapability = await stageDesktopAttachmentOpenCapability({', clearComposerIndex);
const issueIndex = chatSource.indexOf('const authority = issueOpenSwanDesktopAttachmentAuthority({', stageIndex);
const runIndex = chatSource.indexOf('const structured = await runOpenSwanSessionTurn({', issueIndex);

check(addUserIndex > 0, 'Chat persists the user turn before attachment consumers');
check(linkIndex > addUserIndex, 'exact attachment rows link only after user-message persistence');
check(classifyIndex > linkIndex, 'desktop-open classification consumes the returned durable link');
check(clearComposerIndex > classifyIndex, 'composer state clears only after exact linkage and classification');
check(stageIndex > clearComposerIndex, 'bridge staging starts only after the shared persistence/link barrier');
check(issueIndex > stageIndex, 'process-private authority is issued only after one-shot bridge staging');
check(runIndex > issueIndex, 'OpenSwan dispatch starts only after exact capability issuance');

const stageSlice = chatSource.slice(stageIndex, issueIndex);
const stagePreparationSlice = chatSource.slice(clearComposerIndex, stageIndex);
check(/base64,\s*sizeBytes:\s*manifestItem\.sizeBytes,\s*sha256:\s*manifestItem\.sha256/s.test(stageSlice),
  'bridge staging binds the exact sealed bytes, size, and SHA-256');
check(/messageId:\s*persistedAttachmentMessageId/.test(stagePreparationSlice),
  'bridge scope binds the exact persisted Chat message');
check(!/storagePath|signedUrl|localPath|manifestPath/.test(stageSlice),
  'the new bridge staging seam carries no storage, signed, local, or manifest path');

const authoritySlice = chatSource.slice(issueIndex, runIndex);
check(/privateCapability:\s*stagedCapability\.data/.test(authoritySlice),
  'the opaque capability enters only the process-private authority binder');
check(/revokeDesktopAttachmentOpenCapability/.test(authoritySlice),
  'authority failure revokes the one-shot bridge capability');

check(/if \(turnHasImageAttachments && !opensDesktopAttachment\)/.test(chatSource),
  'desktop-open images bypass pre-link/provider visual analysis');
check(/if \(!opensDesktopAttachment && unreadable\.length > 0\)/.test(chatSource),
  'metadata-only binary documents remain eligible only for exact desktop open');
check(/desktopAttachmentMessageId:\s*opensDesktopAttachment/.test(chatSource),
  'the runtime receives the transient persisted-message binding');
check(/multiActionLedgerReference:\s*opensDesktopAttachment/.test(chatSource),
  'the runtime receives the exact in-memory action ledger reference');
check(/const explicitDesktopApp = resolveExplicitDesktopAttachmentApp\(content\)/.test(chatSource),
  'Chat resolves explicit app identity through the canonical closed-world parser');
check(/preferredAppName:\s*explicitDesktopApp/.test(chatSource),
  'the exact parsed app target reaches private bridge staging without extension override');

const approvalHandler = chatSource.indexOf('handleDesktopAttachmentApprovalResumeRef.current = async');
const quickActionHandler = chatSource.indexOf('const handleQuickActionSelection', approvalHandler);
check(approvalHandler > runIndex && quickActionHandler > approvalHandler,
  'Chat installs a dedicated desktop-attachment approval continuation');
const approvalSlice = chatSource.slice(approvalHandler, quickActionHandler);
check(/claimOpenSwanDesktopAttachmentApprovalResumeLease\(\{/.test(approvalSlice),
  'approval continuation synchronously claims the exact process-private lease');
check(/isDesktopAttachmentOpenCapability\(claimed\.privateCapability\)/.test(approvalSlice),
  'approval continuation rejects copied or lost capability objects');
check(/isChatBoundedMultiActionLedger\(claimed\.ledgerReference\)/.test(approvalSlice),
  'approval continuation revalidates the exact retained ledger');
check(/modeOverride:\s*'execute'/.test(approvalSlice),
  'approval continuation cannot be diverted into current Plan mode');
check(/desktopAttachmentResume:\s*Object\.freeze\(\{/.test(approvalSlice),
  'the exact retained sources resume through a private send option');
check(/status:\s*'approved' \| 'rejected'/.test(chatSource),
  'deferred private approvals retain their immutable approve/reject decision');
check(/findIndex\(\(queued\) => \([\s\S]{0,240}queued\.threadId === activeThreadId/.test(chatSource),
  'the queue selects an eligible mounted-thread item instead of head-of-line blocking');
check(/attachments\.length > 0[\s\S]{0,100}stagedFiles\.length > 0/.test(approvalSlice),
  'composer attachments block the private lease claim before custody moves');
check(/desktopAttachmentResumeCustody:\s*Object\.freeze\(\{[\s\S]{0,260}custodyTransferred = true/.test(approvalSlice),
  'Chat records runtime custody only through the dedicated acceptance callback');
check(/finally \{[\s\S]{0,220}!custodyTransferred[\s\S]{0,180}revokeDesktopAttachmentOpenCapability/.test(approvalSlice),
  'every pre-runtime return or throw revokes a claimed private capability');

const custodyIndex = chatSource.indexOf('options.desktopAttachmentResumeCustody.accepted()', issueIndex);
check(custodyIndex > issueIndex && custodyIndex < runIndex,
  'custody transfers at the final Chat boundary immediately before OpenSwan dispatch');
check(/onRunStarted:\s*\(runId\) => \{[\s\S]{0,500}chatOpenSwanRunOwnersRef\.current\.set\(runId, owner\)/.test(chatSource),
  'Chat publishes exact run ownership synchronously for fast approval clicks');
const createRunIndex = sessionSource.indexOf('const run = opts.context.circleId');
const notifyRunIndex = sessionSource.indexOf('opts.onRunStarted(run.id)', createRunIndex);
const toolLoopIndex = sessionSource.indexOf('runTypedCoreToolLoop', notifyRunIndex + 1);
check(createRunIndex >= 0 && notifyRunIndex > createRunIndex && toolLoopIndex > notifyRunIndex,
  'runtime publishes run ownership after persistence and before approval-capable tool dispatch');

const bannerIndex = chatSource.indexOf('<RunApprovalBanner');
const inputIndex = chatSource.indexOf('<EnhancedInput', bannerIndex);
const bannerSlice = chatSource.slice(bannerIndex, inputIndex);
check(/readOpenSwanApprovalAuditToolName/.test(chatSource),
  'Chat imports the canonical schema-v2 approval tool-name reader');
check((bannerSlice.match(/readOpenSwanApprovalAuditToolName\(approval\.payload\)/g) || []).length >= 3,
  'single and batched approval paths share the canonical tool-name reader');
check(/toolName === 'desktop\.open_attachment'/.test(bannerSlice),
  'the approval banner separates one-shot attachment approval from generic retry');
check(/allowDevicePrivateApproval=\{\(approval\) => \{/.test(bannerSlice),
  'Chat supplies an exact owner predicate for process-private approval cards');
check(/approval\.requested_by !== currentUserId/.test(bannerSlice),
  'another circle member cannot surface or resume the requester private-file card');
check(/visibleApprovals = useMemo\(\(\) => approvals\.filter/.test(bannerSource),
  'the reusable banner hides private-device approvals unless its host proves ownership');
check(/isApprovalRowLive\(item\.requested_at, item\.timeout_seconds, Date\.now\(\)\)/.test(bannerSource),
  'single-card approval rechecks liveness at click time');
check(/Private-file opens must be approved one at a time/.test(bannerSlice),
  'a stale batch fails closed instead of opening multiple private files');
check(!/queuedApprovalResumesRef\.current\.push\(\{ id: approval\.id, tool: toolName \}\);[\s\S]{0,160}toolName === 'desktop\.open_attachment'/.test(bannerSlice),
  'desktop approval branches before the generic replay queue');

console.log(`Chat desktop attachment open wiring smoke passed (${assertions} assertions).`);
