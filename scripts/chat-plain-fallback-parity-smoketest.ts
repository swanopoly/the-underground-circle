/**
 * chat-plain-fallback-parity-smoketest
 *
 * Guards the no-authority-escalation seam between Anthropic SSE and the
 * selected provider's text-only batch route. This deliberately combines pure
 * runtime policy assertions with source wiring checks because ChatTab cannot be
 * imported into the Node smoke harness without mounting React Native.
 *
 * Run: npx tsx scripts/chat-plain-fallback-parity-smoketest.ts
 */

import { readFileSync } from 'node:fs';
import {
  chooseChatTerminalTransport,
  type ChatTerminalTransportDecision,
  type ChatTerminalTransportPolicyInput,
} from '../src/lib/chatTerminalTransportPolicy';

let failures = 0;

function assert(ok: boolean, name: string): void {
  if (ok) {
    console.log('pass:', name);
    return;
  }
  failures += 1;
  console.error('FAIL:', name);
}

function assertEqual<T>(actual: T, expected: T, name: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  assert(
    actualJson === expectedJson,
    actualJson === expectedJson
      ? name
      : `${name}\n  actual:   ${actualJson}\n  expected: ${expectedJson}`,
  );
}

function decide(input: ChatTerminalTransportPolicyInput): ChatTerminalTransportDecision {
  return chooseChatTerminalTransport({
    chatMode: 'none',
    sessionDelegationMode: 'auto',
    canStreamAnthropic: true,
    streamEscalateOnToolUse: true,
    ...input,
  });
}

// Runtime contract: physical transport availability cannot promote a planner-
// owned plain turn, while semantic action/OpenSwan decisions remain tool-capable.
assertEqual(
  decide({ executionKind: 'run_plain_chat', canStreamAnthropic: false }),
  { path: 'batch_plain_chat', reason: 'stream_unavailable', canStream: false },
  'runtime: non-streamable substantive plain Chat stays batch plain',
);
assertEqual(
  decide({ executionKind: 'run_openswan', canStreamAnthropic: false }),
  { path: 'batch_openswan', reason: 'planner_forced_openswan', canStream: false },
  'runtime: planner-owned OpenSwan still uses its tool-capable batch lane',
);
assertEqual(
  decide({ executionKind: 'run_plain_chat', canStreamAnthropic: false, looksLikeActionRequest: true }),
  { path: 'batch_openswan', reason: 'tool_catalog_required', canStream: false },
  'runtime: semantic action intent still permits the OpenSwan tool lane',
);

const chatTabSource = readFileSync('src/screens/circles/tabs/ChatTab.tsx', 'utf8');
const llmProvidersSource = readFileSync('src/lib/llmProviders.ts', 'utf8');
const chatStreamEdgeSource = readFileSync('supabase/functions/chat-stream/index.ts', 'utf8');

const sharedContextStart = chatTabSource.indexOf('type PlainChatRequestContext = {');
const sharedContextEnd = chatTabSource.indexOf('if (canStream) {', sharedContextStart);
const sharedContextSource = chatTabSource.slice(sharedContextStart, sharedContextEnd);
assert(
  sharedContextStart >= 0
    && sharedContextSource.includes('buildStreamableSystemPrompt({')
    && sharedContextSource.includes('sessionArchiveContext: sessionArchiveContext || undefined')
    && sharedContextSource.includes('attentionSignals: attentionItemsToSurfacingSignals')
    && sharedContextSource.includes("{ role: 'system', content: systemPrompt }")
    && sharedContextSource.includes("{ role: 'user', content: augmentedPrompt }")
    && sharedContextSource.includes('plainChatRequestContextPromise'),
  'source: stream and batch share one cached system/context assembly',
);

const streamCallStart = chatTabSource.indexOf('const handle = streamChatResponse({', sharedContextEnd);
const streamCallEnd = chatTabSource.indexOf('});', streamCallStart);
const streamCallSource = chatTabSource.slice(streamCallStart, streamCallEnd);
assert(
  streamCallStart >= 0 && streamCallSource.includes('messages: plainChatRequestContext.messages'),
  'source: SSE consumes the shared plain-Chat messages',
);

const dynamicFallbackStart = chatTabSource.indexOf('const interruptedToolUseSignal =', streamCallEnd);
const dynamicFallbackEnd = chatTabSource.indexOf('if (usePlainModelFallback) {', dynamicFallbackStart);
const dynamicFallbackSource = chatTabSource.slice(dynamicFallbackStart, dynamicFallbackEnd);
assert(
  dynamicFallbackStart >= 0
    && dynamicFallbackSource.includes('streamToolUses.length > 0')
    && dynamicFallbackSource.includes("streamStopReason === 'tool_use'")
    && dynamicFallbackSource.includes('streamInterruptedResult?.toolUses.length')
    && dynamicFallbackSource.includes("streamInterruptedResult?.stopReason === 'tool_use'")
    && dynamicFallbackSource.includes("terminalPlan.execution.kind === 'run_plain_chat'")
    && dynamicFallbackSource.includes('streamAccumulated.length === 0')
    && dynamicFallbackSource.includes('!interruptedToolUseSignal')
    && dynamicFallbackSource.includes('usePlainModelFallback = true;'),
  'source: zero-output run_plain_chat failures stay plain unless tool_use was observed',
);

const batchFallbackStart = chatTabSource.indexOf('if (usePlainModelFallback) {', dynamicFallbackEnd);
const openSwanStart = chatTabSource.indexOf('const structured = await runOpenSwanSessionTurn({', batchFallbackStart);
const batchFallbackSource = chatTabSource.slice(batchFallbackStart, openSwanStart);
assert(
  batchFallbackStart >= 0
    && batchFallbackSource.includes('await getPlainChatRequestContext()')
    && batchFallbackSource.includes('messages: plainChatRequestContext.messages')
    && batchFallbackSource.includes('maxTokens: 2048')
    && !batchFallbackSource.includes('social conversation')
    && batchFallbackSource.includes('return;'),
  'source: batch plain uses shared context and exits before OpenSwan',
);

const plainInvokeStart = llmProvidersSource.indexOf('export async function invokePlainChatModel');
const plainInvokeEnd = llmProvidersSource.indexOf('export async function webSearchViaOpenRouter', plainInvokeStart);
const plainInvokeSource = llmProvidersSource.slice(plainInvokeStart, plainInvokeEnd);
assert(
  plainInvokeStart >= 0
    && plainInvokeSource.includes('invokeLLMProxy({')
    && !plainInvokeSource.includes('tools:')
    && !plainInvokeSource.includes('plugins:'),
  'source: provider-only batch invocation cannot receive tools or plugins',
);
assert(
  chatStreamEdgeSource.includes('max_tokens: max_tokens || 2048')
    && batchFallbackSource.includes('maxTokens: 2048'),
  'source: batch plain output budget matches the normal chat-stream default',
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}

console.log('\nAll chat plain-fallback parity smoke cases passed.');
