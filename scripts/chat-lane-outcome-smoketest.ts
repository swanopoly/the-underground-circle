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
 *   - routing fallback becomes VISIBLE servedBy.fallback (never silent)
 *   - recovery options attach non-mutating and bounded
 *   - telemetry summary is compact + bounded
 *
 * Run: npm run smoke:chat-lane-outcome
 */

import {
  buildChatLaneOutcomeTags,
  classifyChatLaneError,
  normalizeAutomationOutcome,
  normalizeCommandResult,
  normalizeConversationalIntentResult,
  normalizeStreamResult,
  normalizeStructuredResponse,
  normalizeThrownError,
  withRecoveryOptions,
  summarizeChatLaneOutcomeForTelemetry,
} from '../src/lib/chatLaneOutcome';
import type { ChatFailureRecoveryOption } from '../src/lib/chatFailureRecovery';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
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
