/**
 * agent-core-steering-smoketest — verifies mid-run steering injection in the
 * typed tool loop (`runAgent` `steering` option, Phase 7b of
 * docs/CHAT_UX_INTEGRATION_UPGRADE_PLAN.md): drained notes become VERBATIM
 * user messages at the iteration boundary (after the tool-result message and
 * the iteration_complete checkpoint, before the next provider turn), each
 * injection emits a `steering_applied` event, runs without the option are
 * unchanged, and a throwing drain never breaks the loop.
 *
 * Run: npx tsx scripts/agent-core-steering-smoketest.ts
 */

import {
  runAgent,
  type AgentEvent,
  type AgentMessage,
  type AgentMessageContentBlock,
  type AgentProvider,
  type AgentToolDefinition,
  type ProviderTurnResult,
} from '../src/lib/agentExecutionCore';

let failures = 0;

function fail(message: string) {
  failures += 1;
  console.error('FAIL:', message);
}

function pass(message: string) {
  console.log('pass:', message);
}

function expect(condition: unknown, message: string) {
  if (!condition) fail(message);
}

// ── Shared fixtures ─────────────────────────────────────────────────────────

const noopTool: AgentToolDefinition = {
  name: 'noop',
  description: 'does nothing',
  input_schema: { type: 'object', properties: {} },
  async handler() { return { ok: true, data: null }; },
};

/**
 * Scripted stub provider (mirrors agent-core-smoketest's scriptedProvider):
 * turn 1 → tool_use for the registered no-op tool, turn 2 → end_turn text.
 * Snapshots the messages array each turn so assertions can inspect exactly
 * what each model turn saw.
 */
function makeProvider(turnSnapshots: AgentMessage[][]): AgentProvider {
  const turns: ProviderTurnResult[] = [
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_1', name: 'noop', input: {} }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'final answer' }] },
  ];
  let i = 0;
  return {
    async turn(args) {
      turnSnapshots.push(args.messages.map((m) => ({ ...m })));
      if (i >= turns.length) throw new Error(`scripted provider: out of turns at index ${i}`);
      return turns[i++];
    },
  };
}

async function main() {
  // ── (a)+(b) Steered run: verbatim note after tool results + event ─────────
  {
    const snapshots: AgentMessage[][] = [];
    const events: AgentEvent[] = [];
    let drains = 0;
    const result = await runAgent({
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [noopTool],
      provider: makeProvider(snapshots),
      onEvent: (e) => events.push(e),
      steering: {
        drain: () => {
          drains += 1;
          return drains === 1 ? ['[framed] steer note'] : [];
        },
      },
    });
    expect(result.text === 'final answer', 'steered run reaches the final response');
    expect(drains === 1, 'drain called exactly once (one iteration boundary)');
    expect(snapshots.length === 2, 'provider called exactly twice');

    // (a) The second provider turn sees the note as a user message AFTER the
    //     tool-result message, injected verbatim (bus owns the formatting).
    const secondTurn = snapshots[1] ?? [];
    const toolResultIdx = secondTurn.findIndex((m) =>
      m.role === 'user'
      && Array.isArray(m.content)
      && (m.content as AgentMessageContentBlock[]).some((b) => b.type === 'tool_result'));
    const noteIdx = secondTurn.findIndex((m) =>
      m.role === 'user'
      && typeof m.content === 'string'
      && m.content.includes('steer note'));
    expect(toolResultIdx >= 0, 'second turn contains the tool-result message');
    expect(noteIdx >= 0, 'second turn contains a user message with the steering note');
    expect(noteIdx > toolResultIdx, 'steering note sits AFTER the tool-result message');
    expect(secondTurn[noteIdx]?.content === '[framed] steer note', 'note injected verbatim (no re-formatting)');

    // (b) steering_applied event with the boundary iteration and the note.
    const applied = events.filter((e) => e.kind === 'steering_applied');
    expect(applied.length === 1, 'exactly one steering_applied event emitted');
    const evt = applied[0];
    if (evt && evt.kind === 'steering_applied') {
      expect(evt.iteration === 1, 'steering_applied carries the boundary iteration (1)');
      expect(evt.note === '[framed] steer note', 'steering_applied carries the note');
    }
    const kinds = events.map((e) => e.kind);
    const iterCompleteIdx = kinds.indexOf('iteration_complete');
    const appliedIdx = kinds.indexOf('steering_applied');
    expect(iterCompleteIdx >= 0 && appliedIdx > iterCompleteIdx,
      'steering_applied fires after the iteration_complete checkpoint');
    expect(kinds.indexOf('turn_start', appliedIdx) > appliedIdx,
      'steering_applied fires before the next turn_start');
    pass('(a)+(b) steered run: verbatim note after tool results + steering_applied event');
  }

  // ── (c) No steering option → behavior unchanged ───────────────────────────
  {
    const snapshots: AgentMessage[][] = [];
    const events: AgentEvent[] = [];
    const result = await runAgent({
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [noopTool],
      provider: makeProvider(snapshots),
      onEvent: (e) => events.push(e),
    });
    expect(result.text === 'final answer', 'unsteered run produces the same final text');
    expect(events.every((e) => e.kind !== 'steering_applied'), 'no steering_applied events without the option');
    expect(
      !result.messages.some((m) => typeof m.content === 'string' && m.content.includes('steer note')),
      'no steering note in the history without the option',
    );
    // Plain shape: user → assistant(tool_use) → user(tool_result) → assistant(text).
    expect(result.messages.length === 4, 'unsteered history keeps the plain 4-message shape');
    pass('(c) no steering option: behavior unchanged');
  }

  // ── (d) Throwing drain → best-effort, run still completes ─────────────────
  {
    const snapshots: AgentMessage[][] = [];
    const events: AgentEvent[] = [];
    const result = await runAgent({
      initialMessages: [{ role: 'user', content: 'go' }],
      tools: [noopTool],
      provider: makeProvider(snapshots),
      onEvent: (e) => events.push(e),
      steering: { drain: () => { throw new Error('bus exploded'); } },
    });
    expect(result.text === 'final answer', 'throwing drain does not break the run');
    expect(result.hitMaxIterations === false, 'throwing drain does not derail the loop');
    expect(events.every((e) => e.kind !== 'steering_applied'), 'no steering_applied event when drain throws');
    pass('(d) throwing drain: final response still produced, no steering event');
  }

  if (failures > 0) {
    console.error(`\n${failures} agent-core steering smoke failure(s)`);
    process.exit(1);
  }
  console.log('\nAll agent-core steering smoke cases passed.');
}

main().catch((err) => {
  console.error('smoke test crashed:', err);
  process.exit(1);
});
