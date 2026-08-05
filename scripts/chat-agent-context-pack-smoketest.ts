/**
 * chat-agent-context-pack-smoketest
 *
 * Verifies the portable Chat -> SwanBot/OpenSwan/connected-agent handoff
 * object. This is intentionally pure: no Supabase, no React Native, no bridge.
 *
 * Run: npm run smoke:chat-agent-context-pack
 */

import { buildChatAutomationPlan } from '../src/lib/chatAutomationPlanner';
import {
  buildChatAgentContextPack,
  type ChatAgentContextPack,
  type ChatAgentContextPackTarget,
} from '../src/lib/chatAgentContextPack';
import { createChatTransportHandlers } from '../src/lib/chatTransportHandlers';
import { dispatchChatAutomationPlan, type ChatTransportContext } from '../src/lib/runChatAutomationPlan';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(name: string) {
  console.log('pass:', name);
}

function assert(value: unknown, name: string, detail?: string) {
  if (value) pass(name);
  else fail(`${name}${detail ? ` - ${detail}` : ''}`);
}

function assertEqual<T>(actual: T, expected: T, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass(name);
  else fail(`${name}\n  actual:   ${a}\n  expected: ${e}`);
}

function packFor(message: string, selectedMode?: string | null): ChatAgentContextPack {
  return buildChatAgentContextPack(
    buildChatAutomationPlan({ message, selectedMode }),
    {
      circleId: 'circle-1',
      userId: 'user-1',
      threadId: 'thread-1',
      model: 'claude-sonnet-4-6',
      chatMode: 'act',
      maxPromptChars: 1800,
    },
  );
}

function hasTarget(pack: ChatAgentContextPack, target: ChatAgentContextPackTarget): boolean {
  return pack.suggestedTargets.includes(target);
}

async function main() {
  {
    const pack = packFor('hello there');
    assertEqual(pack.version, 'chat_agent_context_pack_v1', 'plain: version');
    assertEqual(pack.executionKind, 'run_plain_chat', 'plain: execution kind');
    assert(hasTarget(pack, 'swanbot'), 'plain: suggests SwanBot');
    assertEqual(pack.canDispatchToConnectedAgent, false, 'plain: no connected-agent dispatch by default');
    assert(pack.proofRequirements.includes('final answer'), 'plain: final-answer proof');
    assert(pack.compactPrompt.includes('UC CHAT AGENT CONTEXT PACK'), 'plain: compact prompt header');
  }

  {
    const pack = packFor('review the latest office run', 'review');
    assertEqual(pack.executionKind, 'run_openswan', 'openswan mode: execution kind');
    assert(hasTarget(pack, 'openswan'), 'openswan mode: suggests OpenSwan');
    assert(pack.proofRequirements.some((item) => /agent run/i.test(item)), 'openswan mode: run receipt proof');
    assertEqual(pack.dispatchContext.threadId, 'thread-1', 'openswan mode: carries thread id');
    assertEqual(pack.dispatchContext.model, 'claude-sonnet-4-6', 'openswan mode: carries selected model');
  }

  {
    const pack = packFor('Debug the failing TypeScript build in src/lib/swanbot.ts and run typecheck after the fix');
    assertEqual(pack.executionKind, 'run_build_discovery', 'coding: starts through build discovery');
    assert(hasTarget(pack, 'codex'), 'coding: suggests Codex');
    assert(hasTarget(pack, 'claude_code'), 'coding: suggests Claude Code');
    assert(hasTarget(pack, 'cursor'), 'coding: suggests Cursor');
    assertEqual(pack.allowParallelAgents, true, 'coding: allows parallel non-destructive agents');
    assert(pack.acceptanceCriteria.length > 0, 'coding: carries acceptance criteria');
  }

  {
    const pack = packFor("post a summary of today's standup to our Slack channel");
    assertEqual(pack.risk, 'external_side_effect', 'external send: risk');
    assertEqual(pack.approval.required, true, 'external send: approval required');
    assertEqual(pack.humanReviewRequired, true, 'external send: human review required');
    assertEqual(pack.allowParallelAgents, false, 'external send: never advertises side effects as parallel-safe');
    assert(
      pack.guardrails.some((item) => /external system|approval/i.test(item)),
      'external send: guardrail names approval/external system boundary',
    );
    assert(
      pack.compactPrompt.toLowerCase().includes('approval'),
      'external send: compact prompt includes approval boundary',
    );
  }

  {
    const pack = packFor('Remember api_key=sk-12345678901234567890 for the deployment later');
    assert(!pack.goal.includes('sk-12345678901234567890'), 'redaction: goal strips secret-shaped value');
    assert(!pack.commandText?.includes('sk-12345678901234567890'), 'redaction: command text strips secret-shaped value');
    assert(!pack.compactPrompt.includes('sk-12345678901234567890'), 'redaction: compact prompt strips secret-shaped value');
    assert(pack.compactPrompt.includes('[redacted]'), 'redaction: compact prompt marks redaction');
  }

  {
    const plan = buildChatAutomationPlan({ message: 'review the latest office run', selectedMode: 'review' });
    const ctx: ChatTransportContext = {
      circleId: 'circle-2',
      userId: 'user-2',
      threadId: 'thread-2',
      model: 'claude-opus-4-8',
      chatMode: 'act',
    };
    let handlerPack: ChatAgentContextPack | undefined;
    const handlers = createChatTransportHandlers({
      run_openswan: async (_plan, handlerCtx) => {
        handlerPack = handlerCtx.agentContextPack;
        return { message: 'ok', runId: 'run-1' };
      },
    });
    const outcome = await dispatchChatAutomationPlan(plan, { handlers, ctx });
    const pack = outcome.data?.chatAgentContextPack as ChatAgentContextPack | undefined;
    assert(!!pack, 'dispatcher: attaches context pack');
    assertEqual(pack?.dispatchContext.circleId, 'circle-2', 'dispatcher: context pack carries circle id');
    assertEqual(pack?.dispatchContext.threadId, 'thread-2', 'dispatcher: context pack carries thread id');
    assertEqual(pack?.dispatchContext.model, 'claude-opus-4-8', 'dispatcher: context pack carries model');
    assert(!!handlerPack, 'dispatcher: handler receives context pack before execution');
    assertEqual(
      handlerPack?.compactPrompt,
      pack?.compactPrompt,
      'dispatcher: handler and outcome share the same immutable context payload',
    );
    assert(
      Object.isFrozen(handlerPack) && Object.isFrozen(handlerPack?.guardrails),
      'dispatcher: context pack and nested policy arrays are immutable',
    );
    assert(!!outcome.data?.chatAutomationPlanPreview, 'dispatcher: still attaches plan preview');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log('\nAll chat-agent-context-pack smoke cases passed.');
}

main().catch((err) => {
  console.error('smoke crashed:', err);
  process.exit(1);
});
