/**
 * chat-terminal-transport-policy-smoketest
 *
 * Locks the stream-vs-batch decision used by ChatTab's terminal model path
 * before the final run_plain_chat / run_openswan dispatcher cutover.
 *
 * Run: `npm run smoke:chat-terminal-transport-policy`
 */

import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import {
  chooseChatTerminalTransport,
  looksLikeTerminalActionRequest,
  type ChatTerminalTransportDecision,
  type ChatTerminalTransportPolicyInput,
} from '../src/lib/chatTerminalTransportPolicy';

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

const plainPlan = buildChatAutomationPlan({ message: 'hello there' });
assertEqual(plainPlan.execution.kind, 'run_plain_chat', 'planner: plain chat remains run_plain_chat');
assertEqual(
  decide({ executionKind: plainPlan.execution.kind, chatMode: 'none' }),
  { path: 'stream_then_escalate', reason: 'stream_escalate_on_tool_use', canStream: true },
  'policy: simple none-mode chat streams (default escalate-on-tool-use, enabled 2026-07-01)',
);

const talkPlan = buildChatAutomationPlan({ message: 'hello there', selectedMode: 'talk' });
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

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}

console.log('\nAll chat-terminal-transport-policy smoke cases passed.');
