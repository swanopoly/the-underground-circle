/**
 * desktop-action-trace-smoketest — pins the L1 desktop action-trace
 * capture + retrieval-as-context layer (the desktop twin of the browser
 * D7c guided replay in supabase/functions/computer-use-agent/index.ts).
 *
 * Covered:
 *   1. Both current redaction contracts: the desktop runtime recursively
 *      masks credential-shaped keys and bounds heterogeneous harvested
 *      traces, while the edge uses stronger tool-aware allowlisting and
 *      omits typed/key/credential/ask-user actions from replay traces.
 *      Both keep a ≤40-action sliding window (newest kept).
 *   2. Normalization parity with the edge `normalizeTaskForReplay`:
 *      schedule prefix stripped, lowercased, whitespace collapsed.
 *   3. Example-block format: numbered tool(input) steps, HYPOTHESIS +
 *      re-ground drift rules, approval-gate wording, ~2.5k char cap.
 *   4. Success-only persistence payload shape ({v:1, normalizedTask,
 *      capturedAtIso, actions}) + ~12kb bound (oldest actions dropped).
 *   5. Exact-match-only retrieval semantics over stubbed run rows
 *      (newest-first, first match wins, no fuzzy matching).
 *   6. Evidence-gated injection (research open question 3): the runtime
 *      consults shouldInjectDesktopExample(learnedFacts) BEFORE retrieving a
 *      trace; pure-seam test shows suppression skips the example block while
 *      success-only persistence still works (the gate never touches it).
 *
 * The pure helpers are MIRRORED from src/lib/computerTaskRuntime.ts —
 * that module cannot be imported here (agentRuntime drags in
 * react-native, see scripts/computer-task-runtime-smoketest.ts for the
 * same pattern). Source-contract assertions below read both the runtime
 * file and the edge function to pin their intentionally different,
 * defense-in-depth redaction responsibilities.
 *
 * Run: npm run smoke:desktop-action-trace
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// appLearnedFacts is dependency-light (import type only at the top), so the
// REAL gate is imported here — no mirror needed for the gate itself.
import {
  createEmptyAppLearnedFacts,
  shouldInjectDesktopExample,
} from '../src/lib/appLearnedFacts';

// ─── Mirrored pure helpers (keep in lockstep with computerTaskRuntime) ──────

interface DesktopActionTraceEntry { tool: string; input: unknown }
interface DesktopActionTrace {
  v: 1;
  normalizedTask: string;
  capturedAtIso: string;
  actions: DesktopActionTraceEntry[];
}

const DESKTOP_ACTION_TRACE_MAX_ACTIONS = 40;
const DESKTOP_ACTION_TRACE_MAX_STRING_CHARS = 200;
const DESKTOP_ACTION_TRACE_MAX_PAYLOAD_CHARS = 12_000;
const DESKTOP_ACTION_TRACE_EXAMPLE_MAX_CHARS = 2_500;

const DESKTOP_TRACE_SENSITIVE_KEY_RE = /password|secret|token|otp|credential|passcode|pin|cvv|card/i;
const DESKTOP_TRACE_MAX_REDACTION_DEPTH = 4;
const DESKTOP_TRACE_MAX_ARRAY_ITEMS = 20;

function normalizeDesktopTaskText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/^run this computer task exactly as written:\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function redactDesktopTraceValue(value: unknown, depth: number): unknown {
  if (typeof value === 'string') return value.slice(0, DESKTOP_ACTION_TRACE_MAX_STRING_CHARS);
  if (!value || typeof value !== 'object') return value;
  if (depth >= DESKTOP_TRACE_MAX_REDACTION_DEPTH) return '[depth-capped]';
  if (Array.isArray(value)) {
    return value.slice(0, DESKTOP_TRACE_MAX_ARRAY_ITEMS).map((item) => redactDesktopTraceValue(item, depth + 1));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (DESKTOP_TRACE_SENSITIVE_KEY_RE.test(key)) { out[key] = '[redacted]'; continue; }
    out[key] = redactDesktopTraceValue(entry, depth + 1);
  }
  return out;
}

function redactDesktopTraceInput(input: unknown): unknown {
  return redactDesktopTraceValue(input, 0);
}

function recordDesktopActionTraceEntry(
  trace: DesktopActionTraceEntry[],
  action: { tool: string; input: unknown },
): DesktopActionTraceEntry[] {
  trace.push({
    tool: String(action.tool || 'unknown_tool'),
    input: redactDesktopTraceInput(action.input),
  });
  if (trace.length > DESKTOP_ACTION_TRACE_MAX_ACTIONS) trace.shift();
  return trace;
}

function buildDesktopActionTracePayload(args: {
  task: string;
  actions: DesktopActionTraceEntry[];
  capturedAtIso?: string;
}): DesktopActionTrace | null {
  const normalizedTask = normalizeDesktopTaskText(args.task);
  if (!normalizedTask || !Array.isArray(args.actions) || args.actions.length === 0) return null;
  const payload: DesktopActionTrace = {
    v: 1,
    normalizedTask,
    capturedAtIso: args.capturedAtIso || new Date().toISOString(),
    actions: args.actions.slice(-DESKTOP_ACTION_TRACE_MAX_ACTIONS),
  };
  const serializedLength = () => {
    try { return JSON.stringify(payload).length; } catch { return Number.MAX_SAFE_INTEGER; }
  };
  while (payload.actions.length > 1 && serializedLength() > DESKTOP_ACTION_TRACE_MAX_PAYLOAD_CHARS) {
    payload.actions.shift();
  }
  if (serializedLength() > DESKTOP_ACTION_TRACE_MAX_PAYLOAD_CHARS) return null;
  return payload;
}

function buildDesktopActionTraceExampleBlock(trace: DesktopActionTrace): string {
  if (!trace || trace.v !== 1 || !Array.isArray(trace.actions) || trace.actions.length === 0) return '';
  const header = `## Example: previous successful run of this exact task (${String(trace.capturedAtIso || '').slice(0, 10)})`;
  const intro = 'A previous successful run of this exact task used these steps:';
  const rules = [
    'Treat each step as a HYPOTHESIS, not a script: before replaying a step, verify the target element/window still exists and is enabled (desktop.read_a11y_tree / desktop.window_state); on ANY mismatch stop following the example and re-ground normally (observe, then act).',
    'Never skip approval or ask_user steps — the example never overrides approval gates.',
    'The example shortens exploration — correctness rules are unchanged.',
  ].join('\n');
  const stepLines = trace.actions.map((action, index) => {
    let inputText = '{}';
    try {
      inputText = JSON.stringify(action.input ?? {}).slice(0, DESKTOP_ACTION_TRACE_MAX_STRING_CHARS);
    } catch { /* keep '{}' */ }
    return `${index + 1}. ${action.tool}(${inputText})`;
  });
  const render = (lines: string[]) => [header, intro, ...lines, rules].join('\n');
  let kept = stepLines.slice();
  let omitted = 0;
  const renderWithOmission = () =>
    render(omitted > 0 ? [...kept, `… (${omitted} more step(s) omitted)`] : kept);
  while (kept.length > 1 && renderWithOmission().length > DESKTOP_ACTION_TRACE_EXAMPLE_MAX_CHARS) {
    kept.pop();
    omitted += 1;
  }
  const text = renderWithOmission();
  return text.length <= DESKTOP_ACTION_TRACE_EXAMPLE_MAX_CHARS ? text : '';
}

// Mirrors `asDesktopRunActionTrace` + the newest-first scan loop inside
// agentRunSystem.findRecentDesktopActionTrace (the supabase fetch is the
// stubbed seam — rows below stand in for the query result).
function asDesktopRunActionTrace(candidate: unknown, normalizedTask: string): DesktopActionTrace | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const trace = candidate as DesktopActionTrace;
  if (trace.v !== 1) return null;
  if (typeof trace.normalizedTask !== 'string' || trace.normalizedTask.length === 0) return null;
  if (trace.normalizedTask !== normalizedTask) return null;
  if (!Array.isArray(trace.actions) || trace.actions.length === 0) return null;
  return trace;
}

function findTraceInRows(
  rows: Array<{ metadata?: Record<string, unknown> }>,
  normalizedTask: string,
): DesktopActionTrace | null {
  for (const row of rows) {
    const trace = asDesktopRunActionTrace((row as any)?.metadata?.desktopActionTrace, normalizedTask);
    if (trace) return trace;
  }
  return null;
}

// Mirrors the EDGE matcher verbatim (computer-use-agent/index.ts) so the
// parity case below compares both implementations on the same inputs.
const edgeNormalizeTaskForReplay = (value: string) => String(value || '')
  .toLowerCase()
  .replace(/^run this computer task exactly as written:\s*/i, '')
  .replace(/\s+/g, ' ')
  .trim();

// ─── Test runner ─────────────────────────────────────────────────────────────

let assertions = 0;
let failures = 0;
function fail(m: string) { failures += 1; console.error('FAIL:', m); }
function pass(m: string) { console.log('pass:', m); }
function assert(cond: unknown, name: string, detail?: string) {
  assertions += 1;
  if (cond) pass(name); else fail(`${name}${detail ? ' — ' + detail : ''}`);
}

function main() {
  // ─── Source contracts: runtime defense + tool-aware edge telemetry ────────
  const repoRoot = path.resolve(__dirname, '..');
  const runtimeSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/computerTaskRuntime.ts'), 'utf8');
  const edgeSrc = fs.readFileSync(path.join(repoRoot, 'supabase/functions/computer-use-agent/index.ts'), 'utf8');
  const runSystemSrc = fs.readFileSync(path.join(repoRoot, 'src/lib/agentRunSystem.ts'), 'utf8');

  const sensitiveKeyLiteral = '/password|secret|token|otp|credential|passcode|pin|cvv|card/i';
  assert(runtimeSrc.includes(sensitiveKeyLiteral), 'runtime redaction: credential-shaped key regex remains pinned');
  assert(
    edgeSrc.includes('function redactToolInputForTelemetry(tool: string, input: unknown): unknown'),
    'edge redaction: tool-aware telemetry redactor remains the single entry point',
  );
  assert(
    edgeSrc.includes('if (action === "type" || action === "key")')
      && edgeSrc.includes('text: "[redacted]"'),
    'edge redaction: native type/key telemetry replaces text with a marker',
  );
  assert(
    edgeSrc.includes('if (tool === "fill_saved_login")')
      && edgeSrc.includes('return { credential: "[redacted]", purpose: "[redacted]", submit: input.submit === true };'),
    'edge redaction: saved-login telemetry exposes only redaction markers and submit boolean',
  );
  assert(
    edgeSrc.includes('if (tool === "ask_user")')
      && edgeSrc.includes('question: "[confirmation text omitted from telemetry]"'),
    'edge redaction: ask-user telemetry omits confirmation text',
  );
  assert(
    edgeSrc.includes('if (tool === "fill_saved_login" || tool === "ask_user") return;')
      && edgeSrc.includes('if (action === "type" || action === "key") return;'),
    'edge trace: credential, ask-user, type, and key calls are omitted from replay capture',
  );
  assert(
    edgeSrc.includes('actionTrace.push({ tool, input: redactToolInputForTelemetry(tool, input) });'),
    'edge trace: every retained action passes through tool-aware allowlisting',
  );
  assert(
    edgeSrc.includes('if (a.tool === "fill_saved_login") return false;')
      && edgeSrc.includes('classified.action !== "type"')
      && edgeSrc.includes('classified.action !== "key"'),
    'edge replay: historical credential/type/key traces are filtered before prompt injection',
  );
  const prefixLiteral = '/^run this computer task exactly as written:\\s*/i';
  assert(runtimeSrc.includes(prefixLiteral), 'parity: runtime carries the edge schedule-prefix matcher');
  assert(edgeSrc.includes(prefixLiteral), 'parity: edge still carries the schedule-prefix matcher');
  assert(runtimeSrc.includes('DESKTOP_ACTION_TRACE_MAX_STRING_CHARS = 200'), 'parity: runtime string cap is 200');
  assert(edgeSrc.includes('.slice(0, 200)'), 'parity: edge string cap is 200');
  assert(runtimeSrc.includes('DESKTOP_ACTION_TRACE_MAX_ACTIONS = 40'), 'parity: runtime window is 40 actions');
  assert(edgeSrc.includes('actionTrace.length > 40'), 'parity: edge window is 40 actions');
  assert(runtimeSrc.includes('DESKTOP_ACTION_TRACE_WINDOW_DAYS = 45'), 'parity: runtime match window is 45 days');
  assert(edgeSrc.includes('45 * 24 * 60 * 60 * 1000'), 'parity: edge match window is 45 days');
  // Retrieval seam invariants (agentRunSystem): completed-only, newest first,
  // exact equality (no fuzzy), and the swanbot-v2 sibling-run fallback.
  assert(runSystemSrc.includes("'status', 'completed'"), 'retrieval: completed runs only');
  assert(runSystemSrc.includes('trace.normalizedTask !== normalizedTask'), 'retrieval: exact normalized-task equality');
  assert(runSystemSrc.includes("'metadata->>version', 'swanbot-v2-ai'"), 'harvest: swanbot-v2 sibling-run fallback present');
  assert(runSystemSrc.includes("['tool_call_start', 'client_tool_call_pending']"), 'harvest: reads both input-carrying event kinds');
  // Wiring invariants (computerTaskRuntime): success-only persistence guard +
  // example block in prompt assembly.
  assert(/&&\s*agentResponse\s*&&\s*!capabilityBuildout/.test(runtimeSrc.replace(/\n\s*/g, ' ')), 'wiring: persistence gated on success (agentResponse + no buildout)');
  assert(runtimeSrc.includes('${desktopTraceExampleBlock}USER COMPUTER TASK'), 'wiring: example block injected into prompt assembly');
  assert((runtimeSrc.match(/persistDesktopActionTraceForRun\(/g) || []).length === 2, 'wiring: exactly one persistence call site (+definition)');

  // ─── 1. Runtime recursive redaction defense ──────────────────────────────
  {
    const redacted = redactDesktopTraceInput({
      password: 'hunter2',
      apiToken: 'tok_live_abc',
      OTP: '123456',
      cardNumber: '4111',
      note: 'plain value',
      url: 'https://example.com',
    }) as Record<string, unknown>;
    assert(redacted.password === '[redacted]', 'redaction: password masked');
    assert(redacted.apiToken === '[redacted]', 'redaction: token-shaped key masked');
    assert(redacted.OTP === '[redacted]', 'redaction: case-insensitive key masked');
    assert(redacted.cardNumber === '[redacted]', 'redaction: card-shaped key masked');
    assert(redacted.note === 'plain value', 'redaction: non-sensitive value preserved');
    assert(redacted.url === 'https://example.com', 'redaction: url preserved');
  }
  {
    const redacted = redactDesktopTraceInput({
      form: { auth: { passcode: '9999', user: 'chris' } },
      items: [{ secret: 'shh', label: 'ok' }],
    }) as any;
    assert(redacted.form.auth.passcode === '[redacted]', 'redaction: NESTED credential key masked');
    assert(redacted.form.auth.user === 'chris', 'redaction: nested non-sensitive preserved');
    assert(redacted.items[0].secret === '[redacted]', 'redaction: credential key inside array masked');
    assert(redacted.items[0].label === 'ok', 'redaction: array sibling preserved');
  }
  {
    const long = 'x'.repeat(500);
    const redacted = redactDesktopTraceInput({ text: long, nested: { body: long } }) as any;
    assert(redacted.text.length === 200, 'redaction: top-level string truncated to 200');
    assert(redacted.nested.body.length === 200, 'redaction: nested string truncated to 200');
    assert((redactDesktopTraceInput(long) as string).length === 200, 'redaction: bare string input truncated to 200');
    assert(redactDesktopTraceInput(42) === 42, 'redaction: non-string primitive passthrough');
  }
  {
    const trace: DesktopActionTraceEntry[] = [];
    for (let i = 1; i <= 45; i++) {
      recordDesktopActionTraceEntry(trace, { tool: `desktop.step_${i}`, input: { i } });
    }
    assert(trace.length === 40, 'window: capped at 40 actions');
    assert(trace[0].tool === 'desktop.step_6', 'window: oldest dropped first');
    assert(trace[39].tool === 'desktop.step_45', 'window: newest kept');
  }

  // ─── 2. Normalization parity ─────────────────────────────────────────────
  {
    const cases = [
      'Run this computer task exactly as written:   Open Notes and  create a note',
      '  OPEN   Photoshop\nand crop the   image ',
      'run this computer task exactly as written: open zoom',
      'plain task with no prefix',
    ];
    for (const c of cases) {
      assert(
        normalizeDesktopTaskText(c) === edgeNormalizeTaskForReplay(c),
        `normalize parity: ${JSON.stringify(c.slice(0, 40))}`,
        `client="${normalizeDesktopTaskText(c)}" edge="${edgeNormalizeTaskForReplay(c)}"`,
      );
    }
    assert(
      normalizeDesktopTaskText('Run this computer task exactly as written: Open Notes') === 'open notes',
      'normalize: schedule prefix stripped + lowercased',
    );
    assert(normalizeDesktopTaskText('a\t b\n  c') === 'a b c', 'normalize: whitespace collapsed');
    assert(normalizeDesktopTaskText('') === '', 'normalize: empty stays empty');
  }

  // ─── 3. Example-block format + cap + drift wording ───────────────────────
  {
    const trace: DesktopActionTrace = {
      v: 1,
      normalizedTask: 'open notes and create a note',
      capturedAtIso: '2026-06-10T12:00:00.000Z',
      actions: [
        { tool: 'desktop.launch_app', input: { appName: 'Notes' } },
        { tool: 'desktop.read_a11y_tree', input: {} },
        { tool: 'desktop.press_keys', input: { combo: 'cmd+n' } },
        { tool: 'desktop.type_text', input: { text: 'hello' } },
      ],
    };
    const block = buildDesktopActionTraceExampleBlock(trace);
    assert(block.includes('previous successful run of this exact task'), 'example: framed as prior-success example');
    assert(block.includes('2026-06-10'), 'example: carries the capture date');
    assert(block.includes('1. desktop.launch_app({"appName":"Notes"})'), 'example: numbered tool(input) step format');
    assert(block.includes('4. desktop.type_text('), 'example: all steps numbered in order');
    assert(block.includes('HYPOTHESIS'), 'example: hypothesis wording present');
    assert(/desktop\.read_a11y_tree \/ desktop\.window_state/.test(block), 'example: a11y precondition anchor named');
    assert(block.includes('stop following the example and re-ground'), 'example: drift rule (stop + re-ground)');
    assert(block.includes('Never skip approval or ask_user steps'), 'example: approval gate preserved');
    assert(block.includes('correctness rules are unchanged'), 'example: example-not-script framing');
    assert(!/follow it step by step/i.test(block), 'example: no forced-script wording');
  }
  {
    const bigTrace: DesktopActionTrace = {
      v: 1,
      normalizedTask: 'big task',
      capturedAtIso: '2026-06-10T12:00:00.000Z',
      actions: Array.from({ length: 40 }, (_, i) => ({
        tool: `desktop.click_element_${i}`,
        input: { selector: 'y'.repeat(180), index: i },
      })),
    };
    const block = buildDesktopActionTraceExampleBlock(bigTrace);
    assert(block.length > 0, 'example cap: oversized trace still renders');
    assert(block.length <= DESKTOP_ACTION_TRACE_EXAMPLE_MAX_CHARS, 'example cap: ≤2500 chars', `len=${block.length}`);
    assert(block.includes('more step(s) omitted'), 'example cap: omission marker for dropped steps');
    assert(block.includes('Never skip approval or ask_user steps'), 'example cap: rules survive trimming');
    assert(buildDesktopActionTraceExampleBlock({ ...bigTrace, actions: [] }) === '', 'example: empty actions → empty string');
  }

  // ─── 4. Persistence payload shape + 12kb bound ───────────────────────────
  {
    const actions: DesktopActionTraceEntry[] = [];
    recordDesktopActionTraceEntry(actions, { tool: 'desktop.launch_app', input: { appName: 'Notes' } });
    recordDesktopActionTraceEntry(actions, { tool: 'desktop.type_text', input: { text: 'hi', password: 'leak-me' } });
    const payload = buildDesktopActionTracePayload({
      task: 'Run this computer task exactly as written: Open Notes  and type',
      actions,
      capturedAtIso: '2026-06-11T00:00:00.000Z',
    });
    assert(payload !== null, 'payload: built for non-empty actions');
    assert(payload!.v === 1, 'payload: v === 1');
    assert(payload!.normalizedTask === 'open notes and type', 'payload: normalizedTask normalized like the edge matcher');
    assert(payload!.capturedAtIso === '2026-06-11T00:00:00.000Z', 'payload: capturedAtIso carried');
    assert(payload!.actions.length === 2, 'payload: actions carried');
    assert((payload!.actions[1].input as any).password === '[redacted]', 'payload: actions already redacted by capture primitive');
    assert(buildDesktopActionTracePayload({ task: 'x', actions: [] }) === null, 'payload: empty actions → null (success-only, nothing to persist)');
    assert(buildDesktopActionTracePayload({ task: '   ', actions }) === null, 'payload: empty normalized task → null');
  }
  {
    const fat: DesktopActionTraceEntry[] = Array.from({ length: 40 }, (_, i) => ({
      tool: `desktop.step_${i}`,
      input: { blob: 'z'.repeat(400).slice(0, 200), pad: 'w'.repeat(200), idx: i },
    }));
    const payload = buildDesktopActionTracePayload({ task: 'fat task', actions: fat });
    assert(payload !== null, 'bound: oversized trace still persists (trimmed)');
    assert(JSON.stringify(payload).length <= DESKTOP_ACTION_TRACE_MAX_PAYLOAD_CHARS, 'bound: serialized ≤ 12000 chars', `len=${JSON.stringify(payload).length}`);
    assert(payload!.actions.length < 40, 'bound: oldest actions dropped to fit');
    assert(payload!.actions[payload!.actions.length - 1].tool === 'desktop.step_39', 'bound: newest action retained');
  }

  // ─── 5. Exact-match-only retrieval over stubbed rows ─────────────────────
  {
    const mkRow = (normalizedTask: string, tool: string) => ({
      metadata: {
        desktopActionTrace: {
          v: 1 as const,
          normalizedTask,
          capturedAtIso: '2026-06-09T00:00:00.000Z',
          actions: [{ tool, input: {} }],
        },
      },
    });
    const wanted = normalizeDesktopTaskText('Open Notes and create a note');
    // Newest-first ordering is the stubbed query's contract — first match wins.
    const rows = [
      mkRow('open notes and create a note', 'desktop.newest'),
      mkRow('open notes and create a note', 'desktop.older'),
      mkRow('open notes and create a new note', 'desktop.near_miss'),
    ];
    const hit = findTraceInRows(rows, wanted);
    assert(hit !== null, 'retrieval: exact normalized match found');
    assert(hit!.actions[0].tool === 'desktop.newest', 'retrieval: newest successful trace wins (write-back semantics)');
    assert(findTraceInRows([rows[2]], wanted) === null, 'retrieval: near-miss text does NOT match (no fuzzy)');
    assert(findTraceInRows([{ metadata: {} }], wanted) === null, 'retrieval: rows without a trace skipped');
    assert(
      findTraceInRows([{ metadata: { desktopActionTrace: { v: 2, normalizedTask: wanted, capturedAtIso: '', actions: [{ tool: 't', input: {} }] } } }], wanted) === null,
      'retrieval: unknown trace version rejected',
    );
    assert(
      findTraceInRows([{ metadata: { desktopActionTrace: { v: 1, normalizedTask: wanted, capturedAtIso: '', actions: [] } } }], wanted) === null,
      'retrieval: empty-action trace rejected',
    );
  }

  // ─── 6. Evidence-gated injection (open question 3) ───────────────────────
  {
    // Source pins: the runtime consults the gate with the loaded per-app
    // facts BEFORE retrieving a trace, and the suppression branch never
    // reaches findRecentDesktopActionTrace. Persistence stays gate-free.
    assert(runtimeSrc.includes('shouldInjectDesktopExample(learnedFacts)'), 'gate wiring: injection seam consults shouldInjectDesktopExample(learnedFacts)');
    const gateIdx = runtimeSrc.indexOf('shouldInjectDesktopExample(learnedFacts)');
    const retrievalIdx = runtimeSrc.indexOf('findRecentDesktopActionTrace');
    assert(gateIdx >= 0 && retrievalIdx > gateIdx, 'gate wiring: gate decided BEFORE trace retrieval');
    assert(runtimeSrc.includes('if (!exampleGate.inject) {'), 'gate wiring: suppression branch skips retrieval + block assembly');
    assert(!/persistDesktopActionTraceForRun[\s\S]{0,400}exampleGate/.test(runtimeSrc), 'gate wiring: persistence call is NOT conditioned on the gate');

    // Pure-seam simulation of the runtime structure: gate → (block | '').
    const trace: DesktopActionTrace = {
      v: 1,
      normalizedTask: 'open notes and create a note',
      capturedAtIso: '2026-06-10T12:00:00.000Z',
      actions: [{ tool: 'desktop.launch_app', input: { appName: 'Notes' } }],
    };
    const NOW = '2026-06-12T12:00:00.000Z';
    const suppressedFacts = {
      ...createEmptyAppLearnedFacts('notes', NOW),
      exampleAssisted: { ok: 1, fail: 4, lastAtIso: NOW },
      unassisted: { ok: 4, fail: 1 },
    };
    const suppressGate = shouldInjectDesktopExample(suppressedFacts);
    assert(suppressGate.inject === false, 'gate seam: measured regression (1/5 vs 4/5) suppresses');
    const suppressedBlock = suppressGate.inject ? buildDesktopActionTraceExampleBlock(trace) : '';
    assert(suppressedBlock === '', 'gate seam: suppression yields NO example block even with a matching trace');
    assert(/suppressing example injection/.test(suppressGate.reason) && /1\/5/.test(suppressGate.reason), 'gate seam: suppression reason cites the measured numbers', suppressGate.reason);
    // Persistence is independent of the gate: a suppressed-run success still
    // persists its trace (newest successful trace wins on the next retrieval).
    const payload = buildDesktopActionTracePayload({
      task: 'Open Notes and create a note',
      actions: trace.actions,
      capturedAtIso: NOW,
    });
    assert(payload !== null && payload.normalizedTask === 'open notes and create a note', 'gate seam: persistence still works while injection is suppressed');
    // Default-inject side: no facts → inject → the block renders.
    const defaultGate = shouldInjectDesktopExample(null);
    assert(defaultGate.inject === true, 'gate seam: no facts → inject (the verified default)');
    const injectedBlock = defaultGate.inject ? buildDesktopActionTraceExampleBlock(trace) : '';
    assert(injectedBlock.includes('previous successful run of this exact task'), 'gate seam: inject decision renders the example block');
  }

  if (failures > 0) {
    console.error(`\n${failures} desktop-action-trace smoke-test failure(s)`);
    process.exit(1);
  }
  console.log(`\nAll desktop-action-trace smoke cases passed (${assertions} assertions).`);
}

main();
