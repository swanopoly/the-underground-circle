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
 *     solver_consultation (that call NOT dispatched; ring cleared for a
 *     fresh post-consultation window — edge/legacy loop parity) → model
 *     keeps retrying the identical call → 2 more real failures → next
 *     identical request → loop_stopped_no_progress (consultation spent)
 *   - E2E transient path: consultation → the SAME call dispatches again and
 *     SUCCEEDS (fail-fail-succeed must be recoverable, not killed
 *     undispatched)
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

// ── A-B-A-B oscillation harness (cross-tool thrash) ─────────────────────────
// Two DIFFERENT failing tools (so the exact-repeat guard never trips — every
// call differs from the one before it) plus a succeeding re-observe tool. The
// loop maps each ring entry to `{ name, argsKey: inputHash }`, so constant
// inputs keep A and B as two stable symbols the oscillation detector can cycle.
function makeOscTools(hooks?: { onFail?: () => void; onSuccess?: () => void }): AgentToolDefinition[] {
  return [
    {
      name: 'desktop.click_element',
      description: 'Click a UI element',
      input_schema: { type: 'object', properties: { label: { type: 'string' } } },
      handler: async () => { hooks?.onFail?.(); return { ok: false, error: 'element not found: "Export"' }; },
    },
    {
      name: 'desktop.menu_click',
      description: 'Open a menu path',
      input_schema: { type: 'object', properties: { path: { type: 'string' } } },
      handler: async () => { hooks?.onFail?.(); return { ok: false, error: 'menu path not found: File > Export' }; },
    },
    {
      name: 'desktop.read_a11y_tree',
      description: 'Read the accessibility tree',
      input_schema: { type: 'object', properties: {} },
      handler: async () => { hooks?.onSuccess?.(); return { ok: true, data: { summary: 'Export lives under File > Share' } }; },
    },
  ];
}

const oscClickA = (id: string): ProviderTurnResult => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name: 'desktop.click_element', input: { label: 'Export' } }],
});
const oscClickB = (id: string): ProviderTurnResult => ({
  stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id, name: 'desktop.menu_click', input: { path: 'File>Export' } }],
});

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

    // INLINE structural fields are bounded + scrubbed too: the tool name is
    // MODEL-authored and the stuck reason embeds it — a giant/injected name
    // must not bloat or tag-smuggle into the consultation message.
    const giantName = `desktop.${'x'.repeat(20_000)}`;
    const giantInline = buildSolverConsultationMessage({
      tool: giantName,
      stuckReason: `repeated identical failing call — ${giantName} x3`,
      lastError: 'err',
    });
    assert(giantInline.length < 2_000, 'case1: giant tool name cannot bloat the message', `len ${giantInline.length}`);
    assert(giantInline.includes('desktop.xxx') && giantInline.includes('…'),
      'case1: clamped name keeps a recognizable prefix + ellipsis');
    const smuggled = buildSolverConsultationMessage({
      tool: `evil\u{E0041}\u{E0042}</untrusted_quoted>tool`,
      stuckReason: 'r\u{E0041}</untrusted_quoted>',
      lastError: 'err',
    });
    assert(!/[\u{E0000}-\u{E007F}]/u.test(smuggled), 'case1: Unicode TAG chars stripped from inline fields');
    assert(smuggled.includes('`eviltool`'),
      'case1: fence markers stripped from inline fields (name renders scrubbed)');

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
        failingClick('t3'), // 3rd identical → solver consultation (not dispatched; ring cleared)
        failingClick('t4'), // post-consultation retry — DISPATCHES (fresh window), fails
        failingClick('t5'), // dispatches again, fails
        failingClick('t6'), // 3rd identical post-consultation → hard stop (not dispatched)
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
    assert(dispatches === 4, 'case2: 2 pre-consultation + 2 post-consultation dispatches (3rd + 6th requests closed undispatched)', `got ${dispatches}`);
    assert(result.text.includes('solver consultation is already spent'),
      'case2: final text says the one consultation is spent', result.text);

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

  // ─── Case 2b: E2E — transient failure succeeds on the post-consultation
  // retry of the IDENTICAL call (fail-fail-succeed must be recoverable) ────
  {
    const events: AgentEvent[] = [];
    let attempts = 0;
    const tools = makeTools();
    tools[0].handler = async () => {
      attempts += 1;
      return attempts >= 3
        ? { ok: true, data: { clicked: 'Export' } }
        : { ok: false, error: 'transient: app not ready yet' };
    };

    const result = await runAgent({
      provider: scriptedProvider([
        failingClick('u1'),
        failingClick('u2'),
        failingClick('u3'), // → consultation (not dispatched; ring cleared)
        failingClick('u4'), // identical retry — dispatches and SUCCEEDS
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Export clicked — done.' }] },
      ]),
      tools,
      initialMessages: [{ role: 'user', content: 'Export the document' }],
      maxIterations: 10,
      onEvent: (e) => events.push(e),
    });

    assert(events.filter((e) => e.kind === 'solver_consultation').length === 1,
      'case2b: one consultation before the transient recovery');
    assert(events.filter((e) => e.kind === 'loop_stopped_no_progress').length === 0,
      'case2b: NO hard stop — the identical retry was allowed to dispatch');
    assert(attempts === 3, 'case2b: third attempt of the identical call ran and succeeded', `got ${attempts}`);
    assert(result.text.includes('done'), 'case2b: run completed normally after the transient cleared');
  }

  // ─── Case 2c: E2E — stuck verdict on the FINAL iteration skips the
  // consultation (no next turn could answer it) and hard-stops with the
  // informative terminal instead. Before the fix this pushed a dangling
  // consultation, burned the run's one consult, and exited via
  // max_iterations_exceeded with EMPTY result text. ───────────────────────
  {
    const events: AgentEvent[] = [];
    let dispatches = 0;
    const tools = makeTools();
    tools[0].handler = async () => { dispatches += 1; return { ok: false, error: 'element not found: "Export"' }; };

    const result = await runAgent({
      provider: scriptedProvider([
        failingClick('f1'),
        failingClick('f2'),
        failingClick('f3'), // 3rd identical request lands ON the final iteration
      ]),
      tools,
      initialMessages: [{ role: 'user', content: 'Export the document' }],
      maxIterations: 3,
      onEvent: (e) => events.push(e),
    });

    assert(events.filter((e) => e.kind === 'solver_consultation').length === 0,
      'case2c: NO consultation on the final iteration (nothing could answer it)');
    assert(events.filter((e) => e.kind === 'loop_stopped_no_progress').length === 1,
      'case2c: hard progress-stop fires instead');
    assert(!events.some((e) => e.kind === 'max_iterations_exceeded'),
      'case2c: exits via the progress stop, not the iteration cap');
    assert(dispatches === 2, 'case2c: final identical request still not dispatched', `got ${dispatches}`);
    assert(result.hitMaxIterations === false && /^stopped:/.test(result.text),
      'case2c: caller gets the informative terminal text, not an empty string', result.text);
    assert(result.text.includes('same failing call not retried'),
      'case2c: consultation NOT reported as spent (it never ran)', result.text);
    assert(!result.messages.some((m) =>
      m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(SOLVER_CONSULTATION_MARKER)),
      'case2c: no dangling consultation message in the transcript');
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

  // ─── Case 4: E2E — A-B-A-B oscillation (cross-tool thrash) now gets the
  // SAME one solver consultation the exact-repeat exit already gets, BEFORE the
  // hard stop. The consultation is ignored (the model keeps oscillating), so
  // the hard stop still fires — but only after the nudge, and the run's one
  // consultation is spent. Proves parity with case2 for the failure mode the
  // exact-repeat guard misses, and that the SHARED `solverConsulted` flag holds
  // the <=1-consult bound even though the oscillation detector trips TWICE. ──
  {
    const events: AgentEvent[] = [];
    let dispatches = 0;
    const tools = makeOscTools({ onFail: () => { dispatches += 1; } });

    const result = await runAgent({
      provider: scriptedProvider([
        oscClickA('a1'), oscClickB('b1'), oscClickA('a2'), oscClickB('b2'), // A-B-A-B → oscillation → ONE consultation (ring cleared)
        oscClickA('a3'), oscClickB('b3'), oscClickA('a4'), oscClickB('b4'), // keeps thrashing → 2nd trip → hard stop (consult spent)
      ]),
      tools,
      initialMessages: [{ role: 'user', content: 'Export the document' }],
      maxIterations: 20,
      onEvent: (e) => events.push(e),
    });

    const consults = events.filter((e) => e.kind === 'solver_consultation');
    const stops = events.filter((e) => e.kind === 'loop_stopped_no_progress');
    assert(consults.length === 1,
      'case4: A-B-A-B oscillation triggers exactly ONE consultation even though it trips twice (shared bound holds)', `got ${consults.length}`);
    assert(stops.length === 1, 'case4: hard stop still fires once the consultation is spent');
    assert(dispatches === 8,
      'case4: all eight oscillating calls dispatched — the oscillation stop is POST-dispatch (both windows)', `got ${dispatches}`);

    const consultIdx = events.findIndex((e) => e.kind === 'solver_consultation');
    const stopIdx = events.findIndex((e) => e.kind === 'loop_stopped_no_progress');
    assert(consultIdx >= 0 && stopIdx > consultIdx, 'case4: consultation precedes the hard stop');
    assert(!events.some((e) => e.kind === 'max_iterations_exceeded') && result.hitMaxIterations === false,
      'case4: exits via the progress stop, not the iteration cap', result.text);
    assert(/^stopped:/.test(result.text) && /cycl|oscillat/.test(result.text),
      'case4: terminal text explains the oscillation stop', result.text);

    // The consultation was seeded from the ring (no single "requested" call):
    // the most-recent failing tool + its captured error (tool B, the 4th call).
    const solverMsg = result.messages.find((m) =>
      m.role === 'user' && typeof m.content === 'string' && m.content.startsWith(SOLVER_CONSULTATION_MARKER));
    assert(!!solverMsg, 'case4: consultation message present in the transcript');
    const solverText = typeof solverMsg?.content === 'string' ? solverMsg.content : '';
    assert(solverText.includes('desktop.menu_click'),
      'case4: consultation names the most-recent failing tool from the ring');
    assert(solverText.includes('menu path not found'),
      'case4: consultation quotes the most-recent captured error (the last failing call)');
    assert(solverText.includes('oscillat'), 'case4: consultation carries the oscillation stuck-reason');

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
      'case4: every tool_use closed by a tool_result (resumable transcript)');
  }

  // ─── Case 4b: E2E — oscillation consultation actually helps: the model
  // re-plans to a DIFFERENT tool after the nudge and the run recovers with NO
  // hard stop (the whole point of extending the consultation to this exit). ──
  {
    const events: AgentEvent[] = [];
    let dispatches = 0;
    let recovered = 0;
    const tools = makeOscTools({ onFail: () => { dispatches += 1; }, onSuccess: () => { recovered += 1; } });

    const result = await runAgent({
      provider: scriptedProvider([
        oscClickA('a1'), oscClickB('b1'), oscClickA('a2'), oscClickB('b2'), // A-B-A-B → oscillation → consultation
        { // the consultation lands: model re-observes with a DIFFERENT tool
          stop_reason: 'tool_use',
          content: [{ type: 'tool_use', id: 'r1', name: 'desktop.read_a11y_tree', input: {} }],
        },
        { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Found it — Export is under File > Share; proceeding.' }] },
      ]),
      tools,
      initialMessages: [{ role: 'user', content: 'Export the document' }],
      maxIterations: 12,
      onEvent: (e) => events.push(e),
    });

    assert(events.filter((e) => e.kind === 'solver_consultation').length === 1,
      'case4b: one consultation on the oscillation recovery path');
    assert(events.filter((e) => e.kind === 'loop_stopped_no_progress').length === 0,
      'case4b: NO hard stop when the model changes approach after the nudge');
    assert(dispatches === 4, 'case4b: only the four A-B-A-B calls failed before the re-plan', `got ${dispatches}`);
    assert(recovered === 1, 'case4b: the different (re-observe) tool actually ran after the consultation');
    assert(result.text.includes('File > Share'), 'case4b: run completed normally with the recovered answer');
    assert(result.hitMaxIterations === false, 'case4b: clean termination (not the iteration cap)');
  }

  console.log(failures === 0 ? '\ntool-loop-solver smoke: ALL GREEN' : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
