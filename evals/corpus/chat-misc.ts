// chat-misc — a golden-case corpus module extending the deterministic eval net
// (docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md ADD #1: "an eval CI
// merge-gate … the safety net that makes every consolidation below safe"). This
// is a sibling corpus to `evals/coreGoldenCorpus.ts`: it pins the exact OUTPUT
// of four more load-bearing PURE cores on FIXED inputs, so CI catches ANY
// behavioral drift with NO API keys, NO network, NO flakiness.
//
// Cores covered (each imported AT RUNTIME — that is the whole point, it exercises
// them — and each itself dependency-light + tsx-loadable):
//   • agentTodoCore        — the P6 agent-maintained live TODO state core.
//   • chatStopMessageCore  — user-facing stop-message humanize + quick replies.
//   • chatLaneOutcome      — the W5 unified lane error boundary + classifier.
//   • runCostRollupCore    — per-run cost estimate + multi-run rollup.
//
// Each case's `run()` calls the REAL core fn on a frozen input and returns true
// iff the output equals the GOLDEN value captured from that same core (never
// invented). Every golden here was probed from live core output on 2026-07-15.
// Pure-ASCII outputs are pinned by full `JSON.stringify` equality; outputs that
// contain typographic characters (em dash / curly quotes) are pinned by robust
// ASCII prefix + field checks so a copy-fidelity slip can never mask a real
// regression. Each `run()` is self-contained + defensive (compares via a
// throw-safe JSON helper or guarded field reads; never depends on mutable state).

import type { CoreGoldenCase } from '../coreGoldenCorpus';

import {
  applyAgentTodoWrite,
  renderAgentTodoList,
  summarizeAgentTodoProgress,
  agentTodoStats,
} from '../../src/lib/agentTodoCore';
import {
  resolveChatStopMessage,
  humanizeStopText,
  isLikelyModelDirectedNote,
} from '../../src/lib/chatStopMessageCore';
import {
  classifyChatLaneError,
  normalizeThrownError,
  normalizeCommandResult,
  normalizeConversationalIntentResult,
  buildChatLaneOutcomeTags,
  summarizeChatLaneOutcomeForTelemetry,
} from '../../src/lib/chatLaneOutcome';
import {
  rollupRunCosts,
  estimateRunCostUsd,
  isWastedRunStatus,
} from '../../src/lib/runCostRollupCore';

/** Throw-safe stable serializer for golden equality (cyclic → sentinel, never throws). */
const j = (v: unknown): string => {
  try {
    return JSON.stringify(v);
  } catch {
    return '__unstringifiable__';
  }
};

export const CASES: CoreGoldenCase[] = [
  // ── suite: agent-todo (agentTodoCore) ──────────────────────────────────────
  {
    id: 'chat-misc-todo-mixed-preserves-order-and-status',
    suite: 'agent-todo',
    describe:
      'applyAgentTodoWrite keeps a clean completed/in_progress/pending list in incoming order with no issues',
    run: () => {
      const r = applyAgentTodoWrite([
        { content: 'design core', status: 'completed' },
        { content: 'write tests', status: 'in_progress' },
        { content: 'ship it', status: 'pending' },
      ]);
      return (
        j(r.todos) ===
          '[{"content":"design core","status":"completed"},{"content":"write tests","status":"in_progress"},{"content":"ship it","status":"pending"}]' &&
        Array.isArray(r.issues) &&
        r.issues.length === 0
      );
    },
  },
  {
    id: 'chat-misc-todo-single-in-progress-demotes-rest',
    suite: 'agent-todo',
    describe:
      'at most ONE in_progress item survives — the first wins and every later in_progress demotes to pending (+1 issue)',
    run: () => {
      const r = applyAgentTodoWrite([
        { content: 'first', status: 'in_progress' },
        { content: 'second', status: 'in_progress' },
      ]);
      return (
        j(r.todos) === '[{"content":"first","status":"in_progress"},{"content":"second","status":"pending"}]' &&
        Array.isArray(r.issues) &&
        r.issues.length === 1
      );
    },
  },
  {
    id: 'chat-misc-todo-duplicate-content-first-kept',
    suite: 'agent-todo',
    describe: 'exact-duplicate content is de-duplicated — the first occurrence is kept (+1 issue)',
    run: () => {
      const r = applyAgentTodoWrite([
        { content: 'same', status: 'pending' },
        { content: 'same', status: 'completed' },
      ]);
      return (
        j(r.todos) === '[{"content":"same","status":"pending"}]' &&
        Array.isArray(r.issues) &&
        r.issues.length === 1
      );
    },
  },
  {
    id: 'chat-misc-todo-non-array-empty-list',
    suite: 'agent-todo',
    describe: 'a non-array payload normalizes to an empty list plus exactly one explanatory issue (total)',
    run: () => {
      const r = applyAgentTodoWrite('nope' as unknown);
      return (
        Array.isArray(r.todos) &&
        r.todos.length === 0 &&
        Array.isArray(r.issues) &&
        r.issues.length === 1
      );
    },
  },
  {
    id: 'chat-misc-todo-missing-status-defaults-pending',
    suite: 'agent-todo',
    describe: "an item with no status field defaults to 'pending' (+1 issue)",
    run: () => {
      const r = applyAgentTodoWrite([{ content: 'no status here' }]);
      return (
        j(r.todos) === '[{"content":"no status here","status":"pending"}]' &&
        Array.isArray(r.issues) &&
        r.issues.length === 1
      );
    },
  },
  {
    id: 'chat-misc-todo-render-markers-and-header',
    suite: 'agent-todo',
    describe: 'renderAgentTodoList emits the [x]/[>]/[ ] markers under a "TODO (done/total done):" header',
    run: () => {
      const out = renderAgentTodoList([
        { content: 'a done', status: 'completed' },
        { content: 'b active', status: 'in_progress' },
        { content: 'c waiting', status: 'pending' },
      ]);
      return out === 'TODO (1/3 done):\n[x] a done\n[>] b active\n[ ] c waiting';
    },
  },
  {
    id: 'chat-misc-todo-render-empty',
    suite: 'agent-todo',
    describe: 'an empty/degenerate list renders the sentinel "TODO list is empty."',
    run: () => renderAgentTodoList([]) === 'TODO list is empty.',
  },
  {
    id: 'chat-misc-todo-summarize-active',
    suite: 'agent-todo',
    describe: 'summarizeAgentTodoProgress reports "done/total done; in progress: <content>" for the active item',
    run: () =>
      summarizeAgentTodoProgress([
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ]) === '1/3 done; in progress: b',
  },
  {
    id: 'chat-misc-todo-summarize-empty',
    suite: 'agent-todo',
    describe: 'an empty list summarizes to "no TODO items"',
    run: () => summarizeAgentTodoProgress([]) === 'no TODO items',
  },
  {
    id: 'chat-misc-todo-stats-counts',
    suite: 'agent-todo',
    describe: 'agentTodoStats returns total plus per-status counts (2 completed, 1 in progress, 1 pending)',
    run: () =>
      j(
        agentTodoStats([
          { content: 'a', status: 'completed' },
          { content: 'b', status: 'completed' },
          { content: 'c', status: 'in_progress' },
          { content: 'd', status: 'pending' },
        ]),
      ) === '{"total":4,"pending":1,"inProgress":1,"completed":2}',
  },

  // ── suite: chat-stop-message (chatStopMessageCore) ─────────────────────────
  {
    id: 'chat-misc-stop-tool-use-failed-message',
    suite: 'chat-stop-message',
    describe:
      "the 'tool_use_failed' reason resolves to the friendly no-continue message with a single 'Try again' reply",
    run: () =>
      j(resolveChatStopMessage('tool_use_failed')) ===
      '{"message":"A tool step failed, so I stopped this turn early. Try again in a moment, or tell me to take a different approach.","quickReplies":["Try again"],"canContinue":false}',
  },
  {
    id: 'chat-misc-stop-with-tool-name-injected',
    suite: 'chat-stop-message',
    describe: "a sanitized toolName is injected into the withTool template ('The <tool> step failed …')",
    run: () =>
      j(resolveChatStopMessage('tool_use_failed', { toolName: 'desktop.edit_file' })) ===
      '{"message":"The desktop.edit_file step failed, so I stopped this turn early. Try again in a moment, or tell me to take a different approach.","quickReplies":["Try again"],"canContinue":false}',
  },
  {
    id: 'chat-misc-stop-continuation-failed-alias-continues',
    suite: 'chat-stop-message',
    describe:
      "the internal alias 'continuation_failed' maps to the continuable v2 spec: Continue+Start-fresh replies, canContinue true",
    run: () => {
      const r = resolveChatStopMessage('continuation_failed');
      return (
        r.canContinue === true &&
        j(r.quickReplies) === '["Continue","Start fresh"]' &&
        typeof r.message === 'string' &&
        r.message.startsWith('I finished a local tool step, but the follow-up')
      );
    },
  },
  {
    id: 'chat-misc-stop-unknown-reason-generic',
    suite: 'chat-stop-message',
    describe: 'an unknown/garbage reason falls back to the safe generic resolution (Try again, no continue)',
    run: () => {
      const r = resolveChatStopMessage('totally-unknown-reason');
      return (
        r.canContinue === false &&
        j(r.quickReplies) === '["Try again"]' &&
        typeof r.message === 'string' &&
        r.message.startsWith('This turn stopped before I could finish.')
      );
    },
  },
  {
    id: 'chat-misc-stop-humanize-internal-jargon',
    suite: 'chat-stop-message',
    describe: "raw internal dead-end text ('Tool-use call failed.') is rewritten to the friendly tool_use_failed message",
    run: () =>
      humanizeStopText('Tool-use call failed.') ===
      'A tool step failed, so I stopped this turn early. Try again in a moment, or tell me to take a different approach.',
  },
  {
    id: 'chat-misc-stop-humanize-clean-passthrough',
    suite: 'chat-stop-message',
    describe: 'already-clean user-facing text passes through humanizeStopText unchanged',
    run: () =>
      humanizeStopText('Here is a perfectly normal answer for the user.') ===
      'Here is a perfectly normal answer for the user.',
  },
  {
    id: 'chat-misc-stop-humanize-model-directed-scrubbed',
    suite: 'chat-stop-message',
    describe: 'model-directed instruction text is scrubbed and replaced with a safe user-facing stop message',
    run: () => {
      const out = humanizeStopText('You should ask me to continue and start from fresh observation.');
      return typeof out === 'string' && out.startsWith('This turn stopped before I could finish.');
    },
  },
  {
    id: 'chat-misc-stop-is-model-directed-detects',
    suite: 'chat-stop-message',
    describe: 'isLikelyModelDirectedNote flags model-instruction text and clears ordinary prose',
    run: () =>
      isLikelyModelDirectedNote('You must not repeat the tool call.') === true &&
      isLikelyModelDirectedNote('The weather is nice today.') === false,
  },

  // ── suite: chat-lane-outcome (chatLaneOutcome) ─────────────────────────────
  {
    id: 'chat-misc-lane-classify-rate-limited-system-retry-safe',
    suite: 'chat-lane-outcome',
    describe: 'a rate-limit error classifies as system-recoverable and side-effect-safe to retry',
    run: () =>
      j(classifyChatLaneError('Error 429: rate limit exceeded')) ===
      '{"recoverableBy":"system","retrySideEffectSafe":true,"reason":"rate_limited"}',
  },
  {
    id: 'chat-misc-lane-classify-unknown-fail-closed',
    suite: 'chat-lane-outcome',
    describe: 'an unrecognized error fails CLOSED: user-recoverable and NOT retry-safe (never silently re-executed)',
    run: () =>
      j(classifyChatLaneError('something totally weird happened')) ===
      '{"recoverableBy":"user","retrySideEffectSafe":false,"reason":"unclassified_error"}',
  },
  {
    id: 'chat-misc-lane-classify-policy-block-non-recoverable',
    suite: 'chat-lane-outcome',
    describe: "a 'POLICY BLOCK:' gate message classifies as non-recoverable (recoverableBy:none, not retry-safe)",
    run: () =>
      j(classifyChatLaneError('POLICY BLOCK: this action is not allowed')) ===
      '{"recoverableBy":"none","retrySideEffectSafe":false,"reason":"policy_block"}',
  },
  {
    id: 'chat-misc-lane-classify-5xx-context-required',
    suite: 'chat-lane-outcome',
    describe: 'a status-code-in-context 5xx (HTTP 503) classifies as system-recoverable provider_5xx',
    run: () =>
      j(classifyChatLaneError('HTTP 503 service unavailable')) ===
      '{"recoverableBy":"system","retrySideEffectSafe":true,"reason":"provider_5xx"}',
  },
  {
    id: 'chat-misc-lane-thrown-error-envelope',
    suite: 'chat-lane-outcome',
    describe: 'normalizeThrownError wraps a thrown Error into the unified failed envelope with a fail-closed classification',
    run: () =>
      j(normalizeThrownError('send_message', new Error('boom'))) ===
      '{"lane":"send_message","status":"failed","message":"boom","recoveryOptions":[],"recovery":{"recoverableBy":"user","retrySideEffectSafe":false,"reason":"unclassified_error"}}',
  },
  {
    id: 'chat-misc-lane-outcome-tags',
    suite: 'chat-lane-outcome',
    describe: 'buildChatLaneOutcomeTags emits the stable lane/status/recovery telemetry tag list',
    run: () => {
      const outcome = normalizeThrownError('send_message', new Error('boom'));
      return (
        j(buildChatLaneOutcomeTags(outcome)) ===
        '["lane:send_message","lane_status:failed","recoverable_by:user","retry_safe:no","failure_reason:unclassified_error"]'
      );
    },
  },
  {
    id: 'chat-misc-lane-telemetry-summary',
    suite: 'chat-lane-outcome',
    describe: 'summarizeChatLaneOutcomeForTelemetry drops free text and keeps the bounded lane/recovery signals',
    run: () => {
      const outcome = normalizeThrownError('send_message', new Error('boom'));
      return (
        j(summarizeChatLaneOutcomeForTelemetry(outcome)) ===
        '{"lane":"send_message","status":"failed","recoverableBy":"user","retrySideEffectSafe":false,"reason":"unclassified_error","recoveryOptionCount":0}'
      );
    },
  },
  {
    id: 'chat-misc-lane-command-success-envelope',
    suite: 'chat-lane-outcome',
    describe: "a successful AdvancedCommandResult normalizes to the 'command' lane with status completed and no recovery",
    run: () =>
      j(
        normalizeCommandResult({ success: true, response: 'done' } as unknown as Parameters<
          typeof normalizeCommandResult
        >[0]),
      ) === '{"lane":"command","status":"completed","message":"done","recoveryOptions":[]}',
  },
  {
    id: 'chat-misc-lane-conversational-unhandled-skipped',
    suite: 'chat-lane-outcome',
    describe: 'an unhandled conversational-intent result normalizes to a skipped (declined, not failed) envelope',
    run: () =>
      j(
        normalizeConversationalIntentResult({ handled: false } as unknown as Parameters<
          typeof normalizeConversationalIntentResult
        >[0]),
      ) === '{"lane":"conversational_intent","status":"skipped","message":"","recoveryOptions":[]}',
  },

  // ── suite: run-cost-rollup (runCostRollupCore) ─────────────────────────────
  {
    id: 'chat-misc-cost-rollup-sums-wasted-and-groups',
    suite: 'run-cost-rollup',
    describe:
      'rollupRunCosts sums total spend, counts only failed/timeout/max-iter dollars as wasted, and groups by surface + day',
    run: () =>
      j(
        rollupRunCosts([
          { surface: 'chat', status: 'completed', day: '2026-07-15', costUsd: 1.5 },
          { surface: 'chat', status: 'failed', day: '2026-07-15', costUsd: 0.5 },
          { surface: 'office', status: 'completed', day: '2026-07-16', costUsd: 2 },
        ]),
      ) ===
      '{"totalUsd":4,"wastedUsd":0.5,"bySurface":{"chat":2,"office":2},"byDay":{"2026-07-15":2,"2026-07-16":2}}',
  },
  {
    id: 'chat-misc-cost-rollup-empty-zero',
    suite: 'run-cost-rollup',
    describe: 'an empty row set rolls up to an all-zero, empty-group rollup',
    run: () => j(rollupRunCosts([])) === '{"totalUsd":0,"wastedUsd":0,"bySurface":{},"byDay":{}}',
  },
  {
    id: 'chat-misc-cost-rollup-non-array-zero',
    suite: 'run-cost-rollup',
    describe: 'a non-array input is total-safe and yields the same all-zero rollup (never throws)',
    run: () => j(rollupRunCosts(null as unknown)) === '{"totalUsd":0,"wastedUsd":0,"bySurface":{},"byDay":{}}',
  },
  {
    id: 'chat-misc-cost-estimate-opus-priced',
    suite: 'run-cost-rollup',
    describe:
      'estimateRunCostUsd prices claude-opus tokens with cached input billed cheaper than fresh (1k/1k/1k → $0.0915)',
    run: () =>
      estimateRunCostUsd({ model: 'claude-opus-4-8', inputTokens: 1000, outputTokens: 1000, cachedTokens: 1000 }) ===
      0.0915,
  },
  {
    id: 'chat-misc-cost-estimate-self-hosted-free',
    suite: 'run-cost-rollup',
    describe: 'a self-hosted blackswan model has zero marginal token cost',
    run: () => estimateRunCostUsd({ model: 'blackswan', inputTokens: 1000, outputTokens: 1000 }) === 0,
  },
  {
    id: 'chat-misc-cost-wasted-status-classification',
    suite: 'run-cost-rollup',
    describe: 'isWastedRunStatus flags failed/max_iterations but NOT completed or (deliberately) cancelled',
    run: () =>
      isWastedRunStatus('failed') === true &&
      isWastedRunStatus('max_iterations') === true &&
      isWastedRunStatus('completed') === false &&
      isWastedRunStatus('cancelled') === false,
  },
];
