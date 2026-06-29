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
  { path: 'stream_plain_chat', reason: 'simple_streamable_plain_chat', canStream: true },
  'policy: simple none-mode chat can stream',
);

const talkPlan = buildChatAutomationPlan({ message: 'hello there', selectedMode: 'talk' });
assertEqual(talkPlan.execution.kind, 'run_openswan', 'planner: talk mode still classifies as run_openswan');
assertEqual(
  decide({ executionKind: talkPlan.execution.kind, chatMode: 'talk' }),
  { path: 'stream_plain_chat', reason: 'simple_streamable_plain_chat', canStream: true },
  'policy: talk mode preserves the current streamable simple-chat behavior',
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

const localAppMessage = 'open Notes and create a note called QA';
assert(looksLikeTerminalActionRequest(localAppMessage), 'detector: local app task needs tools');

assertEqual(
  decide({ executionKind: 'run_plain_chat', chatMode: 'none', canStreamAnthropic: false }),
  { path: 'batch_openswan', reason: 'stream_unavailable', canStream: false },
  'policy: non-streamable models fall back to batch OpenSwan',
);

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}

console.log('\nAll chat-terminal-transport-policy smoke cases passed.');
