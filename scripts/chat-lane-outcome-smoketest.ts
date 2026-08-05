/**
 * chat-lane-outcome-smoketest — verifies the W5 (P39) unified lane error
 * boundary in `src/lib/chatLaneOutcome.ts`.
 *
 * Covers:
 *   - each legacy lane shape normalizes to {status, message, recoveryOptions}
 *   - interrupted stream is NEVER 'failed' and NEVER retry-side-effect-safe
 *   - pre-handshake stream failure IS retry-safe (nothing was delivered)
 *   - fail-closed default: unclassified errors are never retry-safe
 *   - two-axis error classification (system/user/none patterns)
 *   - classifier pinning: policy_block only on real gate phrasings (never
 *     bare "constraint"/"floor" — DB errors fall through to unknown), and
 *     provider_5xx only with status-code context (never a standalone number)
 *   - routing fallback becomes VISIBLE servedBy.fallback (never silent)
 *   - computer-task terminals map from typed status, never failure prose
 *   - recovery options attach non-mutating and bounded
 *   - telemetry summary is compact + bounded
 *
 * Run: npm run smoke:chat-lane-outcome
 */

import {
  buildChatLaneOutcomeTags,
  classifyChatLaneError,
  normalizeAutomationOutcome,
  normalizeComputerTaskLaneOutcome,
  normalizeCommandResult,
  normalizeConversationalIntentResult,
  normalizeStreamResult,
  normalizeStructuredResponse,
  normalizeThrownError,
  withRecoveryOptions,
  summarizeChatLaneOutcomeForTelemetry,
} from '../src/lib/chatLaneOutcome';
import type { ChatFailureRecoveryOption } from '../src/lib/chatFailureRecovery';
import { readFileSync } from 'node:fs';
import { createExactPlanApprovalContinuityGate } from '../src/lib/exactPlanApprovalContinuityCore';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function sourceSection(source: string, startMarker: string, endMarker: string, name: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    fail(`${name} — missing start marker: ${startMarker}`);
    return '';
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) {
    fail(`${name} — missing end marker: ${endMarker}`);
    return '';
  }
  return source.slice(start, end);
}

function countOccurrences(source: string, needle: string): number {
  if (!source || !needle) return 0;
  return source.split(needle).length - 1;
}

function main() {
  // ─── Case 1: error classification — two axes, fail-closed default ──────
  {
    const rateLimited = classifyChatLaneError('Anthropic returned 429 Too Many Requests');
    assert(rateLimited.recoverableBy === 'system' && rateLimited.retrySideEffectSafe === true,
      'case1: rate limit → system-recoverable, retry-safe');
    const overloaded = classifyChatLaneError('provider overloaded (529)');
    assert(overloaded.recoverableBy === 'system' && overloaded.reason === 'provider_overloaded',
      'case1: 529 overloaded → system');
    const timeout = classifyChatLaneError('Request timed out after 30000ms');
    assert(timeout.recoverableBy === 'system' && timeout.retrySideEffectSafe === true,
      'case1: timeout → system, retry-safe');
    const auth = classifyChatLaneError('Not authenticated');
    assert(auth.recoverableBy === 'user' && auth.retrySideEffectSafe === false,
      'case1: auth → user-recoverable, NOT retry-safe');
    const key = classifyChatLaneError('Missing API key for provider openai');
    assert(key.recoverableBy === 'user' && key.reason === 'key_required',
      'case1: missing key → user');
    const policy = classifyChatLaneError('POLICY-BLOCK: always-confirm floor requires approval');
    assert(policy.recoverableBy === 'none' && policy.retrySideEffectSafe === false,
      'case1: policy block → none (stop+report), never retried');
    const refusal = classifyChatLaneError('The model refused: content policy violation');
    assert(refusal.recoverableBy === 'none', 'case1: content policy → none');
    const unknown = classifyChatLaneError('something inexplicable happened');
    assert(unknown.recoverableBy === 'user' && unknown.retrySideEffectSafe === false
      && unknown.reason === 'unclassified_error',
      'case1: FAIL-CLOSED — unclassified error is never retry-safe');
    const empty = classifyChatLaneError(undefined);
    assert(empty.retrySideEffectSafe === false, 'case1: empty/undefined message → not retry-safe');
  }

  // ─── Case 1b: pinned gate phrases + 5xx status-code context ─────────────
  {
    // Ordinary DB errors (the app's own schema gotchas) must NOT read as
    // policy blocks — they are not stop-and-report gate emissions.
    const checkConstraint = classifyChatLaneError(
      'new row for relation "room_messages" violates check constraint "room_messages_message_type_check"');
    assert(checkConstraint.reason !== 'policy_block' && checkConstraint.recoverableBy !== 'none'
      && checkConstraint.retrySideEffectSafe === false,
      'case1b: DB check-constraint violation is NOT policy_block, NOT retry-safe');
    const uniqueConstraint = classifyChatLaneError(
      'duplicate key value violates unique constraint "user_xp_pkey"');
    assert(uniqueConstraint.reason !== 'policy_block' && uniqueConstraint.recoverableBy !== 'none',
      'case1b: DB unique-constraint violation is NOT policy_block');

    // A standalone number is not an HTTP status — fail closed to unknown.
    const under500 = classifyChatLaneError('Response must be under 500 characters');
    assert(under500.reason === 'unclassified_error' && under500.retrySideEffectSafe === false,
      'case1b: "under 500 characters" → unknown, never retry-safe');
    const items = classifyChatLaneError('Imported 503 items from the feed');
    assert(items.reason !== 'provider_5xx' && items.retrySideEffectSafe === false,
      'case1b: "503 items" is NOT provider_5xx');
    const rows = classifyChatLaneError('summarized about 503 rows');
    assert(rows.reason !== 'provider_5xx', 'case1b: "about 503 rows" is NOT provider_5xx');

    // Real status-code context keeps classifying as provider_5xx.
    const http502 = classifyChatLaneError('HTTP 502 Bad Gateway from provider');
    assert(http502.reason === 'provider_5xx' && http502.recoverableBy === 'system'
      && http502.retrySideEffectSafe === true,
      'case1b: "HTTP 502 Bad Gateway" → provider_5xx, retry-safe');
    const status503 = classifyChatLaneError('edge invoke failed: status 503');
    assert(status503.reason === 'provider_5xx', 'case1b: "status 503" → provider_5xx');
    const error500 = classifyChatLaneError('provider error 500');
    assert(error500.reason === 'provider_5xx', 'case1b: "error 500" → provider_5xx');
    const returned504 = classifyChatLaneError('llm-proxy returned 504');
    assert(returned504.reason === 'provider_5xx',
      'case1b: "returned 504" (the app\'s own template) → provider_5xx');

    // The gates' REAL emitted phrasings are policy blocks (stop + report).
    const floorMsg = classifyChatLaneError(
      'Always-confirm floor: "pay" actions require explicit user confirmation, but no approval context was available — the action was not performed.');
    assert(floorMsg.recoverableBy === 'none' && floorMsg.reason === 'policy_block',
      'case1b: swanbot always-confirm-floor message → policy_block/none');
    const mcpBlock = classifyChatLaneError(
      'POLICY BLOCK: MCP tool "send_email" on server "gmail" requires approval');
    assert(mcpBlock.reason === 'policy_block' && mcpBlock.recoverableBy === 'none',
      'case1b: mcpToolBridge POLICY BLOCK message → policy_block');
    const constraintBlock = classifyChatLaneError(
      'Tool "desktop.run_shortcut" was blocked by a user constraint and did not run. Do not retry the same call.');
    assert(constraintBlock.reason === 'policy_block',
      'case1b: agentExecutionCore user-constraint block → policy_block');
    const approvalFloor = classifyChatLaneError(
      'The pay/charge approval floor always applies to money-moving actions.');
    assert(approvalFloor.reason === 'policy_block',
      'case1b: "approval floor" phrase → policy_block');
    const forbade = classifyChatLaneError(
      'The user forbade "delete" actions for this task. It was not performed. Stop and report instead.');
    assert(forbade.reason === 'policy_block' && forbade.recoverableBy === 'none',
      'case1b: swanbot HARD constraint stop ("user forbade") → policy_block');
  }

  // ─── Case 2: stream lane — the interrupted ≠ failed invariant ──────────
  {
    const interrupted = normalizeStreamResult({
      result: { toolUses: [], stopReason: null, status: 'interrupted', incomplete: true, interruptReason: 'broken_pipe' },
      errorMessage: 'Stream failed',
      text: 'partial answer already on scr',
      model: 'claude-sonnet-4-6',
    });
    assert(interrupted.status === 'interrupted', 'case2: mid-stream drop → interrupted, NOT failed');
    assert(interrupted.recovery?.retrySideEffectSafe === false,
      'case2: interrupted stream NEVER retry-safe (partial output on screen)');
    assert(interrupted.recovery?.reason === 'stream_broken_pipe', 'case2: interrupt reason carried');
    assert(interrupted.data?.incomplete === true, 'case2: incomplete flag carried');

    const preHandshake = normalizeStreamResult({ errorMessage: 'weird handshake refusal', model: 'claude-sonnet-4-6' });
    assert(preHandshake.status === 'failed', 'case2: pre-handshake failure → failed');
    assert(preHandshake.recovery?.retrySideEffectSafe === true,
      'case2: pre-handshake failure IS retry-safe (nothing delivered)');
    const preHandshakeAuth = normalizeStreamResult({ errorMessage: 'Not authenticated' });
    assert(preHandshakeAuth.recovery?.recoverableBy === 'user',
      'case2: pre-handshake auth failure keeps its user classification');

    const complete = normalizeStreamResult({
      result: { toolUses: [{ id: 't1', name: 'x', input: {} }], stopReason: 'tool_use', status: 'complete', incomplete: false },
      text: 'the answer',
      model: 'claude-sonnet-4-6',
    });
    assert(complete.status === 'completed' && complete.message === 'the answer',
      'case2: clean completion → completed with text');
    assert(complete.data?.toolUseCount === 1 && complete.data?.stopReason === 'tool_use',
      'case2: tool-use signal carried for the escalation seam');
    assert(complete.servedBy?.transport === 'chat-stream', 'case2: servedBy records the transport');
  }

  // ─── Case 3: automation-plan lane — near-identity ───────────────────────
  {
    const ok = normalizeAutomationOutcome({
      executionKind: 'direct_chat' as any,
      status: 'completed',
      message: 'done',
      runId: 'run-1',
    });
    assert(ok.lane === 'automation_plan' && ok.status === 'completed' && ok.message === 'done',
      'case3: completed automation outcome maps 1:1');
    assert(ok.recovery === undefined, 'case3: success carries no recovery classification');
    assert((ok.data as any)?.runId === 'run-1', 'case3: runId carried in data');

    const failed = normalizeAutomationOutcome({
      executionKind: 'skipped',
      status: 'failed',
      message: 'provider returned 503',
    });
    assert(failed.recovery?.recoverableBy === 'system', 'case3: failed outcome gets classified');
    const deferred = normalizeAutomationOutcome({
      executionKind: 'deferred', status: 'deferred', message: 'awaiting approval', approvalId: 'ap-1',
    });
    assert(deferred.status === 'deferred' && (deferred.data as any)?.approvalId === 'ap-1',
      'case3: deferred keeps approvalId');
  }

  // ─── Case 4: command + conversational lanes ─────────────────────────────
  {
    const cmd = normalizeCommandResult({ response: 'Tasks listed.', success: true });
    assert(cmd.status === 'completed' && cmd.lane === 'command', 'case4: successful command → completed');
    const cmdFail = normalizeCommandResult({ response: 'No API key configured', success: false });
    assert(cmdFail.status === 'failed' && cmdFail.recovery?.recoverableBy === 'user',
      'case4: failed command classified from its response text');

    const skippedNull = normalizeConversationalIntentResult(null);
    assert(skippedNull.status === 'skipped', 'case4: null intent result → skipped (fall through)');
    const skippedUnhandled = normalizeConversationalIntentResult({ handled: false, message: '' });
    assert(skippedUnhandled.status === 'skipped', 'case4: unhandled → skipped, not failed');
    const handled = normalizeConversationalIntentResult({ handled: true, message: 'Saved.' });
    assert(handled.status === 'completed' && handled.message === 'Saved.', 'case4: handled → completed');
  }

  // ─── Case 4b: typed computer-task terminals — prose is never authority ──
  {
    const statuses = {
      completed: 'completed',
      partial: 'blocked',
      blocked: 'blocked',
      needs_input: 'needs_input',
      waiting_approval: 'deferred',
      failed: 'failed',
      cancelled: 'blocked',
    } as const;

    for (const [computerTaskStatus, expectedLaneStatus] of Object.entries(statuses)) {
      const outcome = normalizeComputerTaskLaneOutcome({
        status: computerTaskStatus as keyof typeof statuses,
        // Deliberately hostile prose: typed status must remain authoritative.
        message: computerTaskStatus === 'completed'
          ? 'Approval lookup failed. The plan was not executed.'
          : 'Everything completed successfully.',
        data: { computerTaskStatus: 'caller-cannot-override', runId: 'run-ct-1' },
      });
      assert(outcome.lane === 'computer_task' && outcome.status === expectedLaneStatus,
        `case4b: ${computerTaskStatus} → truthful lane status ${expectedLaneStatus}`);
      assert(outcome.data?.computerTaskStatus === computerTaskStatus,
        `case4b: ${computerTaskStatus} retains authoritative task status`);
      assert(outcome.data?.runId === 'run-ct-1',
        `case4b: ${computerTaskStatus} preserves caller metadata`);
      assert(outcome.recovery?.retrySideEffectSafe !== true,
        `case4b: ${computerTaskStatus} is never made retry-safe by prose`);
    }

    const approval = normalizeComputerTaskLaneOutcome({
      status: 'waiting_approval',
      message: 'Approval lookup failed. The plan was not executed; retry when the approval service is available.',
    });
    assert(approval.status === 'deferred'
      && approval.recovery?.reason === 'computer_task_waiting_approval',
      'case4b: approval wait is deferred/neutral, never a lane failure');

    const complete = normalizeComputerTaskLaneOutcome({
      status: 'completed',
      message: 'Created the 600x600 Photoshop document.',
    });
    assert(complete.status === 'completed' && complete.recovery === undefined,
      'case4b: completed task is a clean lane success');

    const manyOptions: ChatFailureRecoveryOption[] = Array.from({ length: 12 }, (_, i) => ({
      id: `ct-opt-${i}`, label: `Option ${i}`, detail: 'd', actor: 'user', recommended: i === 0,
      source: 'recovery_policy',
    }));
    const bounded = normalizeComputerTaskLaneOutcome({
      status: 'needs_input',
      message: 'Choose a document.',
      recoveryOptions: manyOptions,
      servedBy: { transport: 'local-desktop-bridge' },
    });
    assert(bounded.recoveryOptions.length === 8,
      'case4b: computer-task recovery options are bounded at 8');
    assert(bounded.servedBy?.transport === 'local-desktop-bridge',
      'case4b: computer-task transport is preserved');

  }

  // ─── Case 4c: ChatTab integration — every continuation shares one seam ─
  {
    const approvalGate = createExactPlanApprovalContinuityGate();
    assert(
      approvalGate.resolve('approval-race', 'rejected').kind === 'queued_before_registration',
      'case4c: resolution-before-registration is retained instead of dropped',
    );
    const reconciledReject = approvalGate.register('approval-race');
    assert(
      reconciledReject.kind === 'resolved' && reconciledReject.status === 'rejected',
      'case4c: later owner registration deterministically receives the early rejection',
    );
    assert(
      approvalGate.register('approval-race').kind === 'duplicate'
        && approvalGate.resolve('approval-race', 'approved').kind === 'duplicate',
      'case4c: an early decision is claimed once and conflicting callbacks cannot replay it',
    );
    assert(
      approvalGate.register('approval-live').kind === 'pending'
        && approvalGate.resolve('approval-live', 'approved').kind === 'ready'
        && approvalGate.resolve('approval-live', 'approved').kind === 'duplicate',
      'case4c: registered approval resolution is also first-terminal-wins',
    );

    const chatTabSource = readFileSync('src/screens/circles/tabs/ChatTab.tsx', 'utf8');
    const recorderSection = sourceSection(
      chatTabSource,
      'async function recordComputerTaskLaneTerminal',
      'export default function ChatTab',
      'case4c module-scope recorder',
    );
    assert(countOccurrences(chatTabSource, 'async function recordComputerTaskLaneTerminal') === 1
      && recorderSection.includes('normalizeComputerTaskLaneOutcome({')
      && recorderSection.includes('recordChatLaneOutcomeNow(laneOutcome)'),
      'case4c: one module-scope typed recorder is shared by every continuation');
    assert(!/normalizeThrownError\s*\(\s*['"]computer_task['"]/.test(chatTabSource),
      'case4c: ChatTab never converts a typed computer-task outcome into a thrown failure');
    assert(/useComputerUseTask\(\s*circleId,\s*currentUserId \|\| undefined,\s*activeThreadId,\s*\)/.test(chatTabSource),
      'case4c: cloud task persistence is scoped to the active chat thread and user');

    const recoverySection = sourceSection(
      chatTabSource,
      'const startTaskFailureRecovery = async',
      'setBotTyping(true);',
      'case4c recovery compatibility',
    );
    assert(recoverySection.includes('outcomeStatus?: ComputerTaskOutcomeStatus')
      && recoverySection.includes("| 'deferred'")
      && /details\.outcomeStatus\s*===\s*'deferred'[\s\S]{0,100}'waiting_approval'/.test(recoverySection),
      'case4c: coarse deferred recovery remains a typed waiting-approval terminal');

    const cloudSection = sourceSection(
      chatTabSource,
      '// When the Computer Use agent completes (or errors out), post its result',
      '// addBotMessage intentionally not in deps',
      'case4c cloud browser terminals',
    );
    const cloudCompletedSection = sourceSection(
      cloudSection,
      "if (status === 'done' && result)",
      "} else if (status === 'error' && errorMessage)",
      'case4c cloud completion',
    );
    const cloudErrorSection = cloudSection.slice(cloudSection.indexOf("} else if (status === 'error' && errorMessage)"));
    assert(countOccurrences(cloudCompletedSection, 'recordComputerTaskLaneTerminal({') === 1
      && /status:\s*'completed'[\s\S]{0,180}executionKind:\s*'browser_computer_use'/.test(cloudCompletedSection),
      'case4c: cloud browser completion records exactly one completed terminal');
    assert(countOccurrences(cloudErrorSection, 'recordComputerTaskLaneTerminal({') === 1
      && /outcomeStatus\s*===\s*'cancelled'[\s\S]{0,80}\?\s*'cancelled'[\s\S]{0,40}:\s*'failed'/.test(cloudErrorSection)
      && /status:\s*terminalStatus[\s\S]{0,180}executionKind:\s*'browser_computer_use'/.test(cloudErrorSection),
      'case4c: cloud browser error uses the hook-owned typed failed-or-cancelled terminal');
    const cloudCancelSection = sourceSection(
      cloudErrorSection,
      "if (terminalStatus === 'cancelled')",
      'const checkpointRecovery = diagnoseComputerTaskCheckpointFailure',
      'case4c cloud cancellation',
    );
    assert(cloudCancelSection.includes('clearComputerTaskState(circleId, activeThreadId)')
      && cloudCancelSection.includes("computerTaskStatus: 'cancelled'")
      && cloudCancelSection.includes('return;')
      && !cloudCancelSection.includes('startMainChatFailureRecoveryPayload'),
      'case4c: cloud cancellation clears executing state and exits before failure recovery');

    const localBrowserSection = sourceSection(
      chatTabSource,
      'const runLocalComputerExecution = useCallback',
      'const executeLocalComputerAwarenessRequest',
      'case4c local browser terminals',
    );
    assert(localBrowserSection.includes('localComputerUseAttemptRef.current = attempt')
      && localBrowserSection.includes('isCurrentAttempt()')
      && localBrowserSection.includes('{ signal: attempt.controller.signal }')
      && localBrowserSection.includes('isAuthoritative: isCurrentAttempt')
      && /if \(!isCurrentAttempt\(\) \|\| result\.cancelled\) return true;/.test(localBrowserSection),
      'case4c: local execution is abortable and late promises lose mutation authority');
    assert(localBrowserSection.includes('deriveComputerUseResultOutcomeStatus(result)')
      && /outcomeStatus === 'waiting_approval'[\s\S]{0,500}status: 'awaiting_approval'/.test(localBrowserSection)
      && /phase: 'awaiting_approval'[\s\S]{0,80}outcomeStatus: 'waiting_approval'/.test(localBrowserSection),
      'case4c: a pending local approval pauses instead of failing');
    const localBlockedSection = sourceSection(
      localBrowserSection,
      "if (outcomeStatus === 'blocked')",
      'const terminalSession: ComputerUseSession',
      'case4c rejected local prerequisite',
    );
    assert(localBlockedSection.includes("status: 'blocked'")
      && localBlockedSection.includes('finalizeBrowserPlanBlocked(blockedSession, result)')
      && /phase: 'blocked'[\s\S]{0,80}outcomeStatus: 'blocked'/.test(localBlockedSection)
      && !localBlockedSection.includes('addRecoverableChatErrorMessage'),
      'case4c: rejected prerequisite persists and presents as blocked without failure recovery');
    assert(localBrowserSection.includes('attempt.controller.abort()')
      && localBrowserSection.includes('clearComputerTaskState(circleId, activeThreadId)')
      && localBrowserSection.includes('finalizeBrowserPlanCancellation(session)')
      && /status:\s*'cancelled'[\s\S]{0,180}executionKind:\s*'local_browser_panel'/.test(localBrowserSection),
      'case4c: local cancellation aborts, clears persistence, and projects a cancelled session');

    const panelSection = sourceSection(
      chatTabSource,
      '/* ── Computer-Use Panel (web only) ── */',
      '<BrowserSessionDrawer',
      'case4c local browser panel terminals',
    );
    const approveOneSection = sourceSection(
      panelSection,
      'onApproveAction={(actionId) => {',
      'onRejectAction={(actionId) => {',
      'case4c panel approve-one',
    );
    const rejectOneSection = sourceSection(
      panelSection,
      'onRejectAction={(actionId) => {',
      'onApproveAll={() => {',
      'case4c panel reject-one',
    );
    const approveAllSection = sourceSection(
      panelSection,
      'onApproveAll={() => {',
      'onPause={() => {',
      'case4c panel approve-all',
    );
    const resumeSection = sourceSection(
      panelSection,
      'onResume={() => {',
      'onCancel={() => {',
      'case4c panel resume',
    );
    const cancelSection = sourceSection(
      panelSection,
      'onCancel={() => {',
      'onOpenSession={() =>',
      'case4c panel cancel',
    );
    assert(!panelSection.includes('executeComputerUsePlan(')
      && approveAllSection.includes('runLocalComputerExecution(updated')
      && resumeSection.includes('runLocalComputerExecution(resumed'),
      'case4c: panel launches execution outside React state updaters through one guarded owner');
    assert(approveOneSection.includes('const hasPendingDecision =')
      && approveOneSection.includes('if (!hasPendingDecision)')
      && approveOneSection.includes('runLocalComputerExecution('),
      'case4c: approving the final individual step immediately runs the decided plan');
    assert(rejectOneSection.includes("status: 'rejected' as const")
      && rejectOneSection.includes('runLocalComputerExecution(rejected'),
      'case4c: rejecting any individual step immediately enters the blocked executor path');
    assert(cancelSection.includes('cancelLocalComputerExecution(computerUseSession)')
      && !cancelSection.includes('recordComputerTaskLaneTerminal({'),
      'case4c: panel cancel delegates to the aborting typed cancellation owner');
    const computerUsePanelSource = readFileSync('src/components/computer-use/ComputerUsePanel.tsx', 'utf8');
    assert(computerUsePanelSource.includes("blocked: 'BLOCKED — REVIEW PLAN'")
      && computerUsePanelSource.includes("session.status === 'blocked'")
      && computerUsePanelSource.includes('hasPendingActions && !isTerminal')
      && /const isActive[\s\S]{0,180}session\.status === 'paused'/.test(computerUsePanelSource),
      'case4c: blocked local session is terminal review UI, never an executable pending plan');
    const pauseSection = sourceSection(
      localBrowserSection,
      'const pauseLocalComputerExecution = useCallback',
      'useEffect(() => () => {',
      'case4c local pause persistence',
    );
    assert(pauseSection.includes("status: 'paused'")
      && pauseSection.includes('setComputerTaskState(null)')
      && pauseSection.includes('clearComputerTaskState(circleId, activeThreadId)'),
      'case4c: pause stays cancellable in-memory and cannot reload as stale executing');

    const threadTransitionSection = sourceSection(
      chatTabSource,
      'const clearMountedThreadState = useCallback',
      '// One authoritative load path',
      'case4c computer-task thread ownership',
    );
    assert(threadTransitionSection.includes('localAttempt?.controller.abort()')
      && threadTransitionSection.includes('setComputerUseSession(null)')
      && threadTransitionSection.includes('setShowComputerUsePermission(false)')
      && threadTransitionSection.includes('localComputerUseSessionOwnsThread(computerUseSession)')
      && threadTransitionSection.includes('Boolean(localComputerUseAttemptRef.current)'),
      'case4c: local execution and pending permission remain owned by one thread and forced transitions clear them');

    const persistTaskSection = sourceSection(
      chatTabSource,
      'const persistComputerTaskState = useCallback',
      '// D6: acknowledge persisted task notifications',
      'case4c stable task persistence and hydration',
    );
    assert(persistTaskSection.includes('computerTaskStateRef.current?.checkpointRecovery')
      && persistTaskSection.includes('computerTaskStateRef.current = nextState')
      && persistTaskSection.includes('}, [activeThreadId, circleId]);')
      && !persistTaskSection.includes('[activeThreadId, circleId, computerTaskState?.checkpointRecovery]'),
      'case4c: checkpoint persistence has stable identity and cannot restart its polling effect per save');
    assert(persistTaskSection.includes("existing?.phase === 'executing'")
      && persistTaskSection.includes('interruptOrphanedComputerTaskState(existing)')
      && persistTaskSection.includes('saveComputerTaskState(hydrated)'),
      'case4c: reload terminalizes an orphaned executing record instead of resurrecting Working state');

    const particleSection = sourceSection(
      chatTabSource,
      'function ParticleEffect',
      '// Loading animation',
      'case4c particle hook topology',
    );
    assert(particleSection.includes('const particlesRef = useRef<Animated.Value[]>([])')
      && particleSection.includes('new Animated.Value(0)')
      && !/Array\.from\([^\n]+useRef\(/.test(particleSection)
      && particleSection.includes('return () => animation.stop()'),
      'case4c: particle hooks stay top-level and their animation stops on cleanup');

    assert(computerUsePanelSource.includes('const pulse = Animated.loop(')
      && computerUsePanelSource.includes('pulse.stop()')
      && computerUsePanelSource.includes('pulseAnim.stopAnimation()')
      && !computerUsePanelSource.includes("pulse.start(() => {\n          if (session.status === 'executing')"),
      'case4c: executing pulse has one cancellable owner with no stale recursive status closure');

    const computerUseHookSource = readFileSync('src/lib/useComputerUseTask.ts', 'utf8');
    assert(computerUseHookSource.includes('const cancelOwnedAttempt = useCallback')
      && /useEffect\(\(\) => \{[\s\S]{0,140}setState\(EMPTY_STATE\);[\s\S]{0,240}cancelOwnedAttempt\(\);[\s\S]{0,120}persistQuestionResolved\(null\)/.test(computerUseHookSource),
      'case4c: cloud Computer Use cancels its handle and invalidates callbacks on unmount or thread change');

    const permissionDialogSource = readFileSync('src/components/computer-use/ComputerUsePermissionDialog.tsx', 'utf8');
    assert(permissionDialogSource.includes('const submittingRef = useRef(false)')
      && permissionDialogSource.includes('if (submittingRef.current) return;')
      && permissionDialogSource.includes('submittingRef.current = true;')
      && permissionDialogSource.includes('disabled={submitting}'),
      'case4c: permission submission reserves synchronously so double clicks cannot duplicate dispatch');

    const permissionSection = sourceSection(
      chatTabSource,
      '/* Computer-Use Permission Dialog (web only) */',
      '<ComputerUseConsole',
      'case4c post-approval terminals',
    );
    const allowSection = sourceSection(
      permissionSection,
      'onAllow={async (permission: ComputerUsePermission) => {',
      'onDeny={() => {',
      'case4c post-approval launch',
    );
    const denySection = permissionSection.slice(permissionSection.indexOf('onDeny={() => {'));
    assert(countOccurrences(allowSection, 'recordComputerTaskLaneTerminal({') === 0
      && /if \(!started\.started\)[\s\S]{0,100}if \(!started\.outcomeStatus\)/.test(allowSection),
      'case4c: post-approval launch never duplicates a hook-owned terminal');
    assert(countOccurrences(denySection, 'recordComputerTaskLaneTerminal({') === 1
      && /status:\s*'cancelled'[\s\S]{0,180}executionKind:\s*'browser_computer_use'/.test(denySection),
      'case4c: approval denial records exactly one cancelled terminal');

    const exactApprovalSection = sourceSection(
      chatTabSource,
      '<HitlApprovalBanner',
      'onEditAndResend=',
      'case4c exact plan approval resolution',
    );
    assert(exactApprovalSection.includes('canResumeApprovalInMountedChat(approval)')
      && exactApprovalSection.includes('const canUseReloadFallback = !pending')
      && exactApprovalSection.includes('scopedExactApprovalCount === 1'),
      'case4c: live owned approval resolves inline while reload fallback remains fail-closed');
    const exactTerminalSection = sourceSection(
      chatTabSource,
      'const terminalizeExactPlanApproval = async',
      'const approvalsForAttention =',
      'case4c exact plan approval terminal owner',
    );
    assert(exactTerminalSection.includes("reason === 'rejected' || reason === 'dismissed'")
      && exactTerminalSection.includes("? 'cancelled'")
      && exactTerminalSection.includes(": 'blocked'")
      && exactTerminalSection.includes('clearComputerTaskState(circleId, activeThreadId)')
      && exactTerminalSection.includes("executionKind: 'exact_plan_approval'")
      && exactTerminalSection.includes('recordSessionArchiveEvent({')
      && !exactTerminalSection.includes('startMainChatFailureRecoveryPayload'),
      'case4c: reject is cancelled and expiry/reload is blocked, with no failure recovery');
    assert(exactApprovalSection.includes('exactPlanApprovalContinuityGateRef.current.resolve')
      && exactApprovalSection.includes("resolution.kind === 'queued_before_registration'")
      && /await pending\.originSettled;[\s\S]{0,900}status === 'rejected'/.test(exactApprovalSection),
      'case4c: approve and reject share one-shot registration and wait for origin writes');
    const filingSection = sourceSection(
      chatTabSource,
      'let exactApprovalResolutionDuringFiling:',
      "const prefix = '';",
      'case4c exact filing registration',
    );
    assert(filingSection.includes('registerExactApprovalOwner(')
      && filingSection.includes('exactPlanApprovalContinuityGateRef.current.register')
      && filingSection.includes(".select('id, circle_id, session_key, action_type, status, requested_at, timeout_seconds')")
      && filingSection.includes('if (exactApprovalResolutionDuringFiling)')
      && filingSection.includes('owner.originSettled.then(async () =>')
      && filingSection.includes('return { handled: true as const, browser: false as const };'),
      'case4c: resolution-before-registration reconciles once and skips stale awaiting persistence');
    const attentionActionSection = sourceSection(
      chatTabSource,
      'const handleChatAttentionAction =',
      '// ─── Room handoff suggestion',
      'case4c expired approval actions',
    );
    assert(attentionActionSection.includes("terminalizeExactPlanApproval(row, 'expired')")
      && attentionActionSection.includes("terminalizeExactPlanApproval(row, 'dismissed')")
      && /await terminalizeExactPlanApproval\(row, 'expired'\)[\s\S]{0,900}await sendMessage\(commandText\)/.test(attentionActionSection),
      'case4c: Ask again and dismiss terminalize the exact expired task before any resend');
  }

  // ─── Case 5: structured response — visible fallback, never silent ──────
  {
    const routed = normalizeStructuredResponse({
      response: 'hi',
      usage: { model: 'deepseek-chat' },
      routing: { provider_routed: 'deepseek', provider_model: 'deepseek-chat' },
    });
    assert(routed.servedBy?.model === 'deepseek-chat' && routed.servedBy?.transport === 'deepseek',
      'case5: marketplace routing recorded in servedBy');
    assert(!routed.servedBy?.fallback, 'case5: successful routing is not a fallback');

    const fellBack = normalizeStructuredResponse({
      response: 'hi',
      usage: { model: 'claude-sonnet-4-6' },
      routing: { routing_fallback: { provider: 'openrouter', reason: 'integration not connected' } },
    });
    assert(fellBack.servedBy?.fallback === true
      && (fellBack.servedBy?.fallbackReason || '').includes('openrouter'),
      'case5: routing fallback is VISIBLE (provider + reason), never silent');
    const v2 = normalizeStructuredResponse({ response: 'ok' }, { lane: 'openswan_v2' });
    assert(v2.lane === 'openswan_v2', 'case5: lane override for the v2 runtime');
  }

  // ─── Case 6: thrown errors + recovery options + bounds ──────────────────
  {
    const thrown = normalizeThrownError('computer_task', new Error('bridge connection refused'));
    assert(thrown.status === 'failed' && thrown.recovery?.recoverableBy === 'system',
      'case6: thrown network error → system-recoverable');
    const thrownStr = normalizeThrownError('batch', 'plain string error');
    assert(thrownStr.message === 'plain string error', 'case6: string throw carried');
    const thrownWeird = normalizeThrownError('batch', { odd: true });
    assert(thrownWeird.message === 'Unknown error' && thrownWeird.recovery?.retrySideEffectSafe === false,
      'case6: non-Error throw → fail-closed unknown');

    const options: ChatFailureRecoveryOption[] = Array.from({ length: 12 }, (_, i) => ({
      id: `opt-${i}`, label: `Option ${i}`, detail: 'd', actor: 'user', recommended: i === 0,
      source: 'recovery_policy',
    }));
    const base = normalizeThrownError('stream', new Error('x'));
    const withOpts = withRecoveryOptions(base, options);
    assert(withOpts.recoveryOptions.length === 8, 'case6: recovery options bounded at 8');
    assert(base.recoveryOptions.length === 0, 'case6: withRecoveryOptions is non-mutating');
    assert(withRecoveryOptions(base, null) === base, 'case6: null options → same outcome');

    const longMessage = 'e'.repeat(9000);
    const clipped = normalizeThrownError('batch', new Error(longMessage));
    assert(clipped.message.length === 4000, 'case6: message clipped to 4000 chars (bounded rows)');
  }

  // ─── Case 7: telemetry summary — compact + signal-preserving ───────────
  {
    const outcome = withRecoveryOptions(
      normalizeStreamResult({
        result: { toolUses: [], stopReason: null, status: 'interrupted', incomplete: true, interruptReason: 'truncated' },
        errorMessage: 'Stream ended before completion',
        model: 'claude-sonnet-4-6',
      }),
      [{ id: 'o1', label: 'Resend', detail: 'd', actor: 'user', recommended: true, source: 'recovery_policy' }],
    );
    const summary = summarizeChatLaneOutcomeForTelemetry(outcome);
    assert(summary.lane === 'stream' && summary.status === 'interrupted',
      'case7: summary carries lane + status');
    assert(summary.recoverableBy === 'user' && summary.retrySideEffectSafe === false,
      'case7: summary carries the two-axis classification');
    assert(summary.model === 'claude-sonnet-4-6' && summary.transport === 'chat-stream',
      'case7: summary records which model/transport served (postmortem lesson)');
    assert(summary.recoveryOptionCount === 1, 'case7: option count, not option content');
    assert(!('message' in summary), 'case7: free-text message NOT in the telemetry shape');
  }

  // ─── Case 8: archive tags — the per-lane quality signal ────────────────
  {
    const failedOutcome = normalizeThrownError('send_message', new Error('provider returned 503'));
    const tags = buildChatLaneOutcomeTags(failedOutcome);
    assert(tags.includes('lane:send_message') && tags.includes('lane_status:failed'),
      'case8: tags carry lane + status');
    assert(tags.includes('recoverable_by:system') && tags.includes('retry_safe:yes')
      && tags.includes('failure_reason:provider_5xx'),
      'case8: tags carry the two-axis classification');
    const okOutcome = normalizeStructuredResponse({ response: 'hi' });
    const okTags = buildChatLaneOutcomeTags(okOutcome);
    assert(okTags.length === 2 && okTags[0] === 'lane:batch' && okTags[1] === 'lane_status:completed',
      'case8: success emits only lane + status tags');
    const fallbackOutcome = normalizeStructuredResponse({
      response: 'hi',
      routing: { routing_fallback: { provider: 'openrouter', reason: 'not connected' } },
    });
    assert(buildChatLaneOutcomeTags(fallbackOutcome).includes('served_by_fallback:yes'),
      'case8: visible-fallback tag present when routing fell back');
  }

  console.log(failures === 0 ? '\nchat-lane-outcome smoke: ALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
