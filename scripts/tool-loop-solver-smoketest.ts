/**
 * tool-loop-solver-smoketest — verifies the P56 stuck-loop solver
 * consultation: pure module (`src/lib/toolLoopSolver.ts`) + the
 * agentExecutionCore wiring, end-to-end through `runAgent` with a scripted
 * provider (the agent-core smoke harness pattern).
 *
 * Covers:
 *   - consultation message shape (marker, root-cause/approaches/act
 *     structure, bounded fields, quoted error, tool list, gate untouched)
 *   - shouldConsultSolver gate (once per run)
 *   - E2E stuck path: 2 real failures → 3rd identical request triggers ONE
 *     solver_consultation (call NOT dispatched) → model retries same →
 *     loop_stopped_no_progress ("still stuck after a solver consultation")
 *   - E2E recovery path: consultation → model switches tool → run completes
 *     normally (no loop_stopped)
 *   - transcript stays well-formed (every tool_use closed by a tool_result)
 *
 * Run: npm run smoke:tool-loop-solver
 */

import {
  runAgent,
  type AgentEvent,
  type AgentProvider,
  type AgentToolDefinition,
  type ProviderTurnResult,
} from '../src/lib/agentExecutionCore';
import {
  buildSolverConsultationMessage,
  shouldConsultSolver,
  previewToolInput,
  SOLVER_CONSULTATION_MARKER,
} from '../src/lib/toolLoopSolver';

let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: any, name: string, detail?: string) {
  if (cond) pass(name);
  else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function scriptedProvider(turns: ProviderTurnResult[]): AgentProvider {
  let i = 0;
  return {
    async turn() {
      if (i >= turns.length) throw new Error(`scriptedProvider: out of turns at ${i}`);
      return turns[i++];
    },
  };
}

const failingClick = (id: string): ProviderTurnResult => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name: 'desktop.click_element', input: { label: 'Export' } }],
});

function makeTools(onOtherTool?: () => void): AgentToolDefinition[] {
  return [
    {
      name: 'desktop.click_element',
      description: 'Click a UI element',
      input_schema: { type: 'object', properties: { label: { type: 'string' } } },
      handler: async () => ({ ok: false, error: 'element not found: "Export"' }),
    },
    {
      name: 'desktop.read_a11y_tree',
      description: 'Read the accessibility tree',
      input_schema: { type: 'object', properties: {} },
      handler: async () => {
        onOtherTool?.();
        return { ok: true, data: { summary: 'Export lives under File menu' } };
      },
    },
  ];
}

async function main() {
  // ─── Case 1: pure module ────────────────────────────────────────────────
  {
    const msg = buildSolverConsultationMessage({
      tool: 'desktop.click_element',
      inputPreview: '{"label":"Export"}',
      stuckReason: 'repeated identical failing call — desktop.click_element x3',
      lastError: 'element not found: "Export"',
      availableTools: ['desktop.click_element', 'desktop.read_a11y_tree', 'desktop.menu_click'],
      lastObservation: 'dialog "Save changes?" is open',
    });
    assert(msg.startsWith(SOLVER_CONSULTATION_MARKER), 'case1: marker leads the message');
    assert(msg.includes('ROOT CAUSE') && msg.includes('TWO DIFFERENT APPROACHES') && msg.includes('ACT'),
      'case1: structured re-think sections present');
    assert(msg.includes('element not found: "Export"'), 'case1: real error quoted');
    assert(msg.includes('desktop.read_a11y_tree'), 'case1: available tools listed');
    assert(msg.includes('dialog "Save changes?"'), 'case1: latest observation carried');
    assert(msg.includes('approval gates and constraints still apply'),
      'case1: permissions explicitly unchanged');
    assert(msg.includes('blocker report'), 'case1: no-approach → blocker-report path stated');

    const longError = buildSolverConsultationMessage({
      tool: 't', stuckReason: 'r', lastError: 'e'.repeat(900),
      availableTools: Array.from({ length: 100 }, (_, i) => `tool_${i}`),
    });
    assert(!longError.includes('e'.repeat(400)), 'case1: error text bounded');
    assert(!longError.includes('tool_50'), 'case1: tool list bounded (40 max)');

    assert(shouldConsultSolver({ stuck: true, alreadyConsulted: false }) === true, 'case1: gate opens once');
    assert(shouldConsultSolver({ stuck: true, alreadyConsulted: true }) === false, 'case1: gate closes after one consult');
    assert(shouldConsultSolver({ stuck: false, alreadyConsulted: false }) === false, 'case1: no stuck → no consult');
    assert(previewToolInput({ a: 1 }) === '{"a":1}', 'case1: input preview JSON');
    assert(previewToolInput({ big: 'x'.repeat(600) }).length <= 300, 'case1: input preview bounded');
  }

  // ─── Case 2: E2E — still stuck after consultation → hard stop ──────────
  {
    const events: AgentEvent[] = [];
    let dispatches = 0;
    const tools = makeTools();
    tools[0].handler = async () => { dispatches += 1; return { ok: false, error: 'element not found: "Export"' }; };

    const result = await runAgent({
      provider: scriptedProvider([
        failingClick('t1'),
        failingClick('t2'),
        failingClick('t3'), // 3rd identical → solver consultation (not dispatched)
        failingClick('t4'), // ignores the consultation → hard stop
      ]),
      tools,
      initialMessages: [{ role: 'user', content: 'Export the document' }],
      maxIterations: 10,
      onEvent: (e) => events.push(e),
    });

    const consults = events.filter((e) => e.kind === 'solver_consultation');
    const stops = events.filter((e) => e.kind === 'loop_stopped_no_progress');
    assert(consults.length === 1, 'case2: exactly ONE solver consultation', `got ${consults.length}`);
    assert(stops.length === 1, 'case2: hard stop still fires after ignored consultation');
    assert(dispatches === 2, 'case2: the identical call dispatched only twice (3rd + 4th never ran)', `got ${dispatches}`);
    assert(result.text.includes('still stuck after a solver consultation'),
      'case2: final text says the consultation already happened', result.text);

    const consultIdx = events.findIndex((e) => e.kind === 'solver_consultation');
    const stopIdx = events.findIndex((e) => e.kind === 'loop_stopped_no_progress');
    assert(consultIdx >= 0 && stopIdx > consultIdx, 'case2: consultation precedes the stop');

    const solverMsg = result.messages.find((m) =>
      m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(SOLVER_CONSULTATION_MARKER));
    assert(!!solverMsg, 'case2: consultation message present in the transcript');
    assert(typeof solverMsg?.content === 'string' && solverMsg.content.includes('element not found: "Export"'),
      'case2: consultation quotes the captured lastToolErrorText');

    // Transcript well-formedness: every tool_use id has a matching tool_result.
    const useIds: string[] = [];
    const resultIds: string[] = [];
    for (const m of result.messages) {
      if (Array.isArray(m.content)) {
        for (const b of m.content as any[]) {
          if (b?.type === 'tool_use') useIds.push(b.id);
          if (b?.type === 'tool_result') resultIds.push(b.tool_use_id);
        }
      }
    }
    assert(useIds.length > 0 && useIds.every((id) => resultIds.includes(id)),
      'case2: every tool_use closed by a tool_result (resumable transcript)');
  }

  // ─── Case 3: E2E — consultation leads to recovery ───────────────────────
  {
    const events: AgentEvent[] = [];
    let observed = 0;
    const tools = makeTools(() => { observed += 1; });

    const result = await runAgent({
      provider: scriptedProvider([
        failingClick('t1'),
        failingClick('t2'),
        failingClick('t3'), // → consultation
        { // the consultation lands: model re-observes instead
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 't5', name: 'desktop.read_a11y_tree', input: {} }],
        },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Found it — Export is under the File menu; proceeding there.' }] },
      ]),
      tools,
      initialMessages: [{ role: 'user', content: 'Export the document' }],
      maxIterations: 10,
      onEvent: (e) => events.push(e),
    });

    assert(events.filter((e) => e.kind === 'solver_consultation').length === 1,
      'case3: one consultation on the recovery path');
    assert(events.filter((e) => e.kind === 'loop_stopped_no_progress').length === 0,
      'case3: NO hard stop when the model changes approach');
    assert(observed === 1, 'case3: the different tool actually ran after the consultation');
    assert(result.text.includes('File menu'), 'case3: run completed normally with the recovered answer');
    assert(result.hitMaxIterations === false, 'case3: clean termination');
  }

  console.log(failures === 0 ? '\ntool-loop-solver smoke: ALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
