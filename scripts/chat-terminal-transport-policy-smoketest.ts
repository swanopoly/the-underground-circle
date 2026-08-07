/**
 * chat-terminal-transport-policy-smoketest
 *
 * Locks the stream-vs-batch decision used by ChatTab's terminal model path
 * before the final run_plain_chat / run_openswan dispatcher cutover.
 *
 * Run: `npm run smoke:chat-terminal-transport-policy`
 */

import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import { readFileSync } from 'node:fs';
import {
  chooseChatTerminalTransport,
  looksLikeTerminalActionRequest,
  type ChatTerminalTransportDecision,
  type ChatTerminalTransportPolicyInput,
} from '../src/lib/chatTerminalTransportPolicy';
import { isConversationOnlyTurn } from '../src/lib/webSearchAutoDetect';
import { resolvePlainChatModelRoute } from '../src/lib/crossProviderRouter';

let failures = 0;
function fail(msg: string) { failures += 1; console.error('FAIL:', msg); }
function pass(name: string) { console.log('pass:', name); }
function assert(ok: boolean, name: string) { if (!ok) fail(name); else pass(name); }
function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${name}\n  actual:   ${a}\n  expected: ${e}`);
  else pass(name);
}

function decide(input: ChatTerminalTransportPolicyInput): ChatTerminalTransportDecision {
  return chooseChatTerminalTransport({
    sessionDelegationMode: 'auto',
    canStreamAnthropic: true,
    ...input,
  });
}

const greetingPlan = buildChatAutomationPlan({ message: 'hello' });
assertEqual(greetingPlan.execution.kind, 'run_plain_chat', 'planner: greeting remains run_plain_chat');
assertEqual(
  decide({
    executionKind: greetingPlan.execution.kind,
    chatMode: 'none',
    conversationOnly: true,
  }),
  { path: 'stream_plain_chat', reason: 'conversation_only_plain_chat', canStream: true },
  'policy: greeting uses the selected streaming model with no OpenSwan escalation palette',
);
assertEqual(
  decide({
    executionKind: greetingPlan.execution.kind,
    chatMode: 'none',
    conversationOnly: true,
    canStreamAnthropic: false,
  }),
  { path: 'batch_plain_chat', reason: 'conversation_only_plain_chat', canStream: false },
  'policy: greeting on a non-streamable model uses plain batch chat, not OpenSwan',
);

for (const greeting of [
  'hello',
  'Hi!',
  'hey there',
  'Good morning OpenSwan',
  'Thanks',
  'How are you?',
]) {
  assert(isConversationOnlyTurn(greeting), `classifier: ${JSON.stringify(greeting)} is conversation-only`);
}
assert(
  !isConversationOnlyTurn('hello, open Photoshop'),
  'classifier: greeting plus a substantive app task is not conversation-only',
);
assert(
  !isConversationOnlyTurn("hello, search today's AI news"),
  'classifier: greeting plus a substantive search is not conversation-only',
);
assertEqual(
  resolvePlainChatModelRoute('claude-sonnet-4-6'),
  { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  'plain model route: native Claude stays on Anthropic',
);
assertEqual(
  resolvePlainChatModelRoute('auto'),
  { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  'plain model route: Auto resolves to the explicit Sonnet default',
);
assertEqual(
  resolvePlainChatModelRoute('openrouter/anthropic/claude-sonnet-4.6'),
  { provider: 'openrouter', model: 'openrouter/anthropic/claude-sonnet-4.6' },
  'plain model route: OpenRouter selection stays on OpenRouter',
);
assertEqual(
  resolvePlainChatModelRoute('huggingface_endpoint/cswan801/BlackSwan-v5'),
  { provider: 'huggingface', model: 'huggingface_endpoint/cswan801/BlackSwan-v5' },
  'plain model route: hosted BlackSwan stays on Hugging Face',
);
assertEqual(
  resolvePlainChatModelRoute('hf:meta-llama/Llama-3.3-70B-Instruct'),
  { provider: 'huggingface', model: 'meta-llama/Llama-3.3-70B-Instruct' },
  'plain model route: custom Hugging Face picker ids use the hosted HF chat route',
);
for (const unsupportedHostedRoute of [
  'ollama/qwen3',
  'openai_compatible/company-chat',
  'replicate/meta/meta-llama-3.1-405b-instruct',
]) {
  assertEqual(
    resolvePlainChatModelRoute(unsupportedHostedRoute),
    null,
    `plain model route: ${unsupportedHostedRoute} cannot leak into the hosted proxy`,
  );
}
assertEqual(
  resolvePlainChatModelRoute('blackswan'),
  null,
  'plain model route: local BlackSwan remains a local bridge concern',
);

for (const mode of ['none', 'talk', 'review', 'build', 'plan']) {
  for (const delegation of ['auto', 'parallel']) {
    assertEqual(
      decide({
        executionKind: 'run_openswan',
        chatMode: mode,
        sessionDelegationMode: delegation,
        hasSelectedRecoveryOption: true,
        isFigmaBuildRequest: true,
        isCodingGenerationRequest: true,
        looksLikeActionRequest: true,
        conversationOnly: true,
        streamEscalateOnToolUse: true,
      }),
      { path: 'stream_plain_chat', reason: 'conversation_only_plain_chat', canStream: true },
      `policy: greeting veto outranks ${mode} mode and ${delegation} delegation`,
    );
  }
}

const plainPlan = buildChatAutomationPlan({ message: 'Explain closures simply' });
assertEqual(plainPlan.execution.kind, 'run_plain_chat', 'planner: substantive plain chat remains run_plain_chat');
assertEqual(
  decide({ executionKind: plainPlan.execution.kind, chatMode: 'none' }),
  { path: 'stream_then_escalate', reason: 'stream_escalate_on_tool_use', canStream: true },
  'policy: substantive none-mode chat streams with the escalation seam enabled',
);

const talkGreetingPlan = buildChatAutomationPlan({ message: 'hello', selectedMode: 'talk' });
assertEqual(talkGreetingPlan.execution.kind, 'run_openswan', 'planner: talk-mode greeting retains its planner classification');
assertEqual(
  decide({
    executionKind: talkGreetingPlan.execution.kind,
    chatMode: 'talk',
    conversationOnly: true,
  }),
  { path: 'stream_plain_chat', reason: 'conversation_only_plain_chat', canStream: true },
  'policy: talk-mode greeting still stays off OpenSwan task/tool orchestration',
);

const talkPlan = buildChatAutomationPlan({ message: 'Explain closures simply', selectedMode: 'talk' });
assertEqual(talkPlan.execution.kind, 'run_openswan', 'planner: talk mode still classifies as run_openswan');
assertEqual(
  decide({ executionKind: talkPlan.execution.kind, chatMode: 'talk' }),
  { path: 'stream_then_escalate', reason: 'stream_escalate_on_tool_use', canStream: true },
  'policy: talk mode streams (default escalate-on-tool-use, enabled 2026-07-01)',
);

assertEqual(
  decide({ executionKind: 'run_openswan', chatMode: 'none' }),
  { path: 'batch_openswan', reason: 'planner_forced_openswan', canStream: false },
  'policy: planner-forced OpenSwan uses the tool-capable batch path',
);

assertEqual(
  decide({ executionKind: 'run_openswan', chatMode: 'review' }),
  { path: 'specialized_agent_run', reason: 'selected_mode', canStream: false },
  'policy: selected non-talk mode uses specialized agent runtime',
);

assertEqual(
  decide({ executionKind: 'run_plain_chat', chatMode: 'none', sessionDelegationMode: 'parallel' }),
  { path: 'batch_openswan', reason: 'parallel_delegation', canStream: false },
  'policy: parallel delegation disables streaming',
);

assertEqual(
  decide({ executionKind: 'run_plain_chat', chatMode: 'none', hasSelectedRecoveryOption: true }),
  { path: 'batch_openswan', reason: 'recovery_option', canStream: false },
  'policy: recovery continuations use batch OpenSwan',
);

assertEqual(
  decide({ executionKind: 'run_plain_chat', chatMode: 'none', isFigmaBuildRequest: true }),
  { path: 'batch_openswan', reason: 'figma_build', canStream: false },
  'policy: Figma build requests use batch OpenSwan',
);

assertEqual(
  decide({ executionKind: 'run_plain_chat', chatMode: 'none', isCodingGenerationRequest: true }),
  { path: 'batch_openswan', reason: 'coding_generation', canStream: false },
  'policy: coding generation uses batch OpenSwan',
);

const actionMessage = 'create a room called QA';
assert(looksLikeTerminalActionRequest(actionMessage), 'detector: room creation needs tools');
assertEqual(
  decide({ executionKind: 'run_plain_chat', chatMode: 'none', looksLikeActionRequest: looksLikeTerminalActionRequest(actionMessage) }),
  { path: 'batch_openswan', reason: 'tool_catalog_required', canStream: false },
  'policy: action-looking chat skips no-tool streaming',
);

const customApiActionMessage = 'Create a custom API action that calls POST /orders';
assert(looksLikeTerminalActionRequest(customApiActionMessage), 'detector: custom API action needs tools');
assertEqual(
  decide({ executionKind: 'run_plain_chat', chatMode: 'none', looksLikeActionRequest: looksLikeTerminalActionRequest(customApiActionMessage) }),
  { path: 'batch_openswan', reason: 'tool_catalog_required', canStream: false },
  'policy: custom API action skips no-tool streaming',
);

const localAppMessage = 'open Notes and create a note called QA';
assert(looksLikeTerminalActionRequest(localAppMessage), 'detector: local app task needs tools');

assertEqual(
  decide({ executionKind: 'run_plain_chat', chatMode: 'none', canStreamAnthropic: false }),
  { path: 'batch_openswan', reason: 'stream_unavailable', canStream: false },
  'policy: non-streamable models fall back to batch OpenSwan',
);

// ─── Phase 2 seam: stream-by-default → escalate-on-tool-use (DEFAULT ON 2026-07-01) ────
// Explicit opt-out still works: with the flag OFF (explicit false) the simple
// streamable turn is byte-for-byte the legacy plain stream. The live default is
// now ON (covered by the two top-of-file assertions); here we pin the explicit
// OFF and ON paths deterministically.
assertEqual(
  decide({ executionKind: plainPlan.execution.kind, chatMode: 'none', streamEscalateOnToolUse: false }),
  { path: 'stream_plain_chat', reason: 'simple_streamable_plain_chat', canStream: true },
  'policy(flag OFF): simple chat is byte-for-byte the legacy plain stream',
);
assertEqual(
  decide({ executionKind: talkPlan.execution.kind, chatMode: 'talk', streamEscalateOnToolUse: false }),
  { path: 'stream_plain_chat', reason: 'simple_streamable_plain_chat', canStream: true },
  'policy(flag OFF): talk mode is byte-for-byte the legacy plain stream',
);

// With the flag ON the SAME simple streamable turn becomes escalation-capable:
// it still streams, but carries the pinned core + tools.search so a tool_use
// signal can upgrade it into the batch OpenSwan loop.
assertEqual(
  decide({ executionKind: plainPlan.execution.kind, chatMode: 'none', streamEscalateOnToolUse: true }),
  { path: 'stream_then_escalate', reason: 'stream_escalate_on_tool_use', canStream: true },
  'policy(flag ON): simple chat streams AND can escalate on tool_use',
);
assertEqual(
  decide({
    executionKind: greetingPlan.execution.kind,
    chatMode: 'none',
    conversationOnly: true,
    streamEscalateOnToolUse: true,
  }),
  { path: 'stream_plain_chat', reason: 'conversation_only_plain_chat', canStream: true },
  'policy(flag ON): greeting remains tool-less plain chat',
);
assertEqual(
  decide({ executionKind: talkPlan.execution.kind, chatMode: 'talk', streamEscalateOnToolUse: true }),
  { path: 'stream_then_escalate', reason: 'stream_escalate_on_tool_use', canStream: true },
  'policy(flag ON): talk mode streams AND can escalate on tool_use',
);

// The flag ONLY affects the simple-streamable terminal branch — every earlier
// guard (selected mode, planner-forced, delegation, recovery, figma, coding,
// action-intent, stream-unavailable) is unchanged whether the flag is on or off.
assertEqual(
  decide({ executionKind: 'run_openswan', chatMode: 'none', streamEscalateOnToolUse: true }),
  { path: 'batch_openswan', reason: 'planner_forced_openswan', canStream: false },
  'policy(flag ON): planner-forced OpenSwan is unaffected by the seam flag',
);
assertEqual(
  decide({
    executionKind: 'run_plain_chat',
    chatMode: 'none',
    looksLikeActionRequest: looksLikeTerminalActionRequest('create a room called QA'),
    streamEscalateOnToolUse: true,
  }),
  { path: 'batch_openswan', reason: 'tool_catalog_required', canStream: false },
  'policy(flag ON): explicit action-intent still uses batch OpenSwan, not the stream seam',
);
assertEqual(
  decide({ executionKind: 'run_plain_chat', chatMode: 'none', canStreamAnthropic: false, streamEscalateOnToolUse: true }),
  { path: 'batch_openswan', reason: 'stream_unavailable', canStream: false },
  'policy(flag ON): non-streamable models still fall back to batch OpenSwan',
);

const chatTabSource = readFileSync('src/screens/circles/tabs/ChatTab.tsx', 'utf8');
const terminalPolicySource = readFileSync('src/lib/chatTerminalTransportPolicy.ts', 'utf8');
const llmProvidersSource = readFileSync('src/lib/llmProviders.ts', 'utf8');
assert(
  chatTabSource.includes('const conversationOnlyTurn = !hasPendingAttachments && isConversationOnlyTurn(content);')
    && chatTabSource.includes('conversationOnly: conversationOnlyTurn,'),
  'ChatTab classifies attachment-free greetings and passes the result into terminal transport',
);
assert(
  chatTabSource.indexOf('const conversationOnlyTurn = !hasPendingAttachments')
    < chatTabSource.indexOf('// ── Resume a pending clarification'),
  'ChatTab classifies greetings before pending clarification can reconstruct an older task',
);
assert(
  chatTabSource.includes('!conversationOnlyTurn\n      && !overrideText?.startsWith')
    && chatTabSource.includes('if (!conversationOnlyTurn && shouldCreateAgentPlanForMessage')
    && chatTabSource.includes('if (!conversationOnlyTurn && effectiveChatMode !=='),
  'ChatTab keeps greetings out of clarification, booking, plan, and specialized-agent task lanes',
);
assert(
  chatTabSource.includes('const recoverySelectionForDisplay = conversationOnlyTurn || options?.displayText')
    && chatTabSource.includes('const recoveryFollowup = !conversationOnlyTurn && latestRecoveryOptionsMessage')
    && chatTabSource.includes('const selectedRecoveryOption = conversationOnlyTurn'),
  'ChatTab keeps greetings from selecting or resuming a prior recovery action',
);
assert(
  chatTabSource.includes('!conversationOnlyTurn\n      && !content.startsWith')
    && chatTabSource.includes('if (!conversationOnlyTurn) {\n      try {\n        const { routeByCapability }'),
  'ChatTab keeps greetings on the selected model instead of connected-agent or capability dispatch',
);
assert(
  terminalPolicySource.indexOf('if (input.conversationOnly)')
    < terminalPolicySource.indexOf("if (chatMode !== 'none'"),
  'terminal policy makes the conversation-only veto outrank all saved modes',
);
assert(
  chatTabSource.includes("terminalTransport.path === 'batch_plain_chat'")
    && chatTabSource.includes("surface: 'main_chat_plain_model'")
    && chatTabSource.includes('const { invokePlainChatModel } = await import')
    && !chatTabSource.includes('const plainResponse = await getAIResponse(augmentedPrompt, context);')
    && chatTabSource.indexOf("if (usePlainModelFallback) {")
      < chatTabSource.indexOf("const structured = await runOpenSwanSessionTurn({"),
  'ChatTab resolves greeting fallback through a no-tools provider call before OpenSwan execution',
);
assert(
  chatTabSource.includes("if (!conversationOnlyPlainChat) setRunStatus('running');"),
  'conversation-only streaming does not start the OpenSwan run-status UI',
);
assert(
  chatTabSource.includes('if (escalateOnToolUse) {')
    && chatTabSource.includes('...(streamTools ? { tools: streamTools } : {}),'),
  'plain greeting streams omit the OpenSwan tool catalog and cannot escalate on tool_use',
);
const plainInvokeStart = llmProvidersSource.indexOf('export async function invokePlainChatModel');
const plainInvokeEnd = llmProvidersSource.indexOf('export async function webSearchViaOpenRouter', plainInvokeStart);
const plainInvokeSource = llmProvidersSource.slice(plainInvokeStart, plainInvokeEnd);
assert(
  plainInvokeStart >= 0
    && plainInvokeSource.includes('invokeLLMProxy({')
    && !plainInvokeSource.includes('tools:')
    && !plainInvokeSource.includes('plugins:'),
  'plain model invocation sends no tools or plugins',
);
const batchCatchIndex = chatTabSource.indexOf('} catch (batchErr) {');
const batchRecoveryIndex = chatTabSource.indexOf('startMainChatFailureRecoveryPayload({', batchCatchIndex);
const outerCatchIndex = chatTabSource.indexOf('} catch (err) {', batchRecoveryIndex);
const outerRecoveryIndex = chatTabSource.indexOf('startMainChatFailureRecoveryPayload({', outerCatchIndex);
assert(
  chatTabSource.indexOf('if (conversationOnlyTurn) {', batchCatchIndex) < batchRecoveryIndex
    && chatTabSource.indexOf('if (conversationOnlyTurn) {', outerCatchIndex) < outerRecoveryIndex
    && chatTabSource.includes('if (boundaryConversationOnly) {'),
  'every greeting failure boundary exits with ordinary Chat copy before recovery launch',
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}

console.log('\nAll chat-terminal-transport-policy smoke cases passed.');
