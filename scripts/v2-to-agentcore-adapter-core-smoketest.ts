/**
 * Smoke: src/lib/v2ToAgentCoreAdapterCore.ts
 *
 * House harness (numbered groups incl. a hostile no-throw group; 50+ asserts;
 * process.exit(1) on any failure). Verifies the loop-convergence CONSOLIDATE #1
 * message/tool-shape adapter (ADR-0002 §3) against the REAL shapes in
 * src/lib/agentExecutionCore.ts and supabase/functions/swanbot-v2-ai/index.ts.
 *
 * Run: npx tsx scripts/v2-to-agentcore-adapter-core-smoketest.ts
 */

import {
  toAgentCoreMessages,
  toAgentCoreToolDefs,
  fromAgentCoreResult,
  normalizeV2StopReason,
  V2_TO_AGENTCORE_LIMITS,
} from '../src/lib/v2ToAgentCoreAdapterCore';

let passes = 0;
let failures = 0;

function assert(cond: boolean, msg: string): void {
  if (cond) {
    passes += 1;
  } else {
    failures += 1;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}
function assertEq<T>(actual: T, expected: T, msg: string): void {
  const ok = Object.is(actual, expected);
  if (!ok) console.error(`    actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  assert(ok, msg);
}
function group(n: number, title: string): void {
  console.log(`\n[${n}] ${title}`);
}
function noThrow(label: string, fn: () => unknown): unknown {
  try {
    const v = fn();
    passes += 1;
    return v;
  } catch (e) {
    failures += 1;
    console.error(`  ✗ THREW: ${label}: ${e instanceof Error ? e.message : String(e)}`);
    return undefined;
  }
}

async function main(): Promise<void> {
  // ── 1. toAgentCoreMessages — string content + role passthrough ──────────────
  group(1, 'toAgentCoreMessages: string content + roles');
  {
    const out = toAgentCoreMessages([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      { role: 'system', content: 'you are grounded' },
    ]);
    assert(Array.isArray(out), 'returns an array');
    assertEq(out.length, 3, 'keeps all 3 messages');
    assertEq(out[0].role, 'user', 'user role preserved');
    assertEq(out[0].content, 'hello', 'user string content preserved');
    assertEq(out[1].role, 'assistant', 'assistant role preserved');
    assertEq(out[2].role, 'system', 'system role preserved (core superset)');
    assertEq(out[2].content, 'you are grounded', 'system content preserved');
  }

  // ── 2. toAgentCoreMessages — content blocks (text/tool_use/tool_result) ─────
  group(2, 'toAgentCoreMessages: content blocks');
  {
    const out = toAgentCoreMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'thinking' },
          { type: 'tool_use', id: 'tu_1', name: 'tasks.create', input: { title: 'ship it' } },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: '{"ok":true}', is_error: false },
        ],
      },
    ]);
    assertEq(out.length, 2, 'two block messages kept');
    const a = out[0].content;
    assert(Array.isArray(a), 'assistant content is a block array');
    if (Array.isArray(a)) {
      assertEq(a.length, 2, 'both assistant blocks kept');
      assertEq(a[0].type, 'text', 'text block type');
      assertEq((a[0] as { text: string }).text, 'thinking', 'text preserved');
      assertEq(a[1].type, 'tool_use', 'tool_use block type');
      const tu = a[1] as { id: string; name: string; input: unknown };
      assertEq(tu.id, 'tu_1', 'tool_use id preserved');
      assertEq(tu.name, 'tasks.create', 'tool_use name preserved');
      assertEq(JSON.stringify(tu.input), '{"title":"ship it"}', 'tool_use input preserved (sanitised)');
    }
    const u = out[1].content;
    if (Array.isArray(u)) {
      assertEq(u[0].type, 'tool_result', 'tool_result block type');
      const tr = u[0] as { tool_use_id: string; content: unknown; is_error?: boolean };
      assertEq(tr.tool_use_id, 'tu_1', 'tool_result tool_use_id preserved');
      assertEq(tr.content, '{"ok":true}', 'tool_result string content preserved');
      assertEq(tr.is_error, false, 'is_error preserved when present');
    }
  }

  // ── 3. toAgentCoreMessages — normalisation + fidelity of is_error omission ──
  group(3, 'toAgentCoreMessages: normalisation edges');
  {
    // Unknown role → 'user'; unknown block type dropped; missing is_error omitted.
    const out = toAgentCoreMessages([
      { role: 'weird', content: 'x' },
      { role: 'user', content: [
        { type: 'text', text: 'keep' },
        { type: 'mystery', foo: 1 },
        { type: 'tool_result', tool_use_id: 'z', content: 'no-flag' },
      ] },
    ]);
    assertEq(out[0].role, 'user', 'unknown role coerced to user');
    const blocks = out[1].content;
    if (Array.isArray(blocks)) {
      assertEq(blocks.length, 2, 'unknown block type dropped');
      const tr = blocks[1] as { is_error?: boolean };
      assertEq('is_error' in tr, false, 'is_error omitted when source lacked it');
    }
    // number id/name on tool_use coerced to string.
    const out2 = toAgentCoreMessages([{ role: 'assistant', content: [{ type: 'tool_use', id: 42, name: 7, input: null }] }]);
    const b = (out2[0].content as Array<{ id: string; name: string; input: unknown }>)[0];
    assertEq(b.id, '42', 'numeric id coerced to string');
    assertEq(b.name, '7', 'numeric name coerced to string');
    assertEq(JSON.stringify(b.input), '{}', 'null tool_use input → {}');
    // content neither string nor array → empty string.
    const out3 = toAgentCoreMessages([{ role: 'user', content: 12345 }]);
    assertEq(out3[0].content, '', 'non-string/array content → empty string');
  }

  // ── 4. toAgentCoreMessages — image side-channel parts tolerated ─────────────
  group(4, 'toAgentCoreMessages: image side channel');
  {
    const out = toAgentCoreMessages([{
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'img',
        content: [
          { type: 'text', text: 'screenshot' },
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' } },
        ],
      }],
    }]);
    const tr = (out[0].content as Array<{ content: unknown }>)[0];
    const parts = tr.content as Array<{ type: string; text?: string; source?: { media_type: string; data: string } }>;
    assert(Array.isArray(parts), 'tool_result content array preserved');
    assertEq(parts[0].type, 'text', 'text part kept');
    assertEq(parts[1].type, 'image', 'image part kept');
    assertEq(parts[1].source!.media_type, 'image/jpeg', 'image media_type preserved');
    assertEq(parts[1].source!.data, 'AAAA', 'image data preserved');
    // image with missing media_type → default png.
    const out2 = toAgentCoreMessages([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'i', content: [{ type: 'image', source: { type: 'base64', data: 'ZZ' } }] }] }]);
    const p = ((out2[0].content as Array<{ content: unknown }>)[0].content as Array<{ source: { media_type: string } }>)[0];
    assertEq(p.source.media_type, 'image/png', 'missing media_type defaults to image/png');
  }

  // ── 5. toAgentCoreToolDefs — core fields + advertise shape ──────────────────
  group(5, 'toAgentCoreToolDefs: core fields');
  {
    const defs = toAgentCoreToolDefs([
      { name: 'save_memory', description: 'store a memory', input_schema: { type: 'object', properties: { text: { type: 'string' } } }, clientOnly: false },
      { name: 'desktop.screenshot', description: 'shot', input_schema: { type: 'object' }, clientOnly: true },
    ]);
    assertEq(defs.length, 2, 'both tools kept');
    assertEq(defs[0].name, 'save_memory', 'tool name preserved');
    assertEq(defs[0].description, 'store a memory', 'description preserved');
    assertEq(JSON.stringify(defs[0].input_schema), '{"type":"object","properties":{"text":{"type":"string"}}}', 'input_schema preserved');
    assert(typeof defs[0].handler === 'function', 'handler is a function');
    // clientOnly is intentionally dropped (ADR-0002 §2.3).
    assertEq('clientOnly' in (defs[1] as Record<string, unknown>), false, 'clientOnly flag dropped');
  }

  // ── 6. toAgentCoreToolDefs — defaults / dedup / examples / interactive ──────
  group(6, 'toAgentCoreToolDefs: defaults + dedup');
  {
    const defs = toAgentCoreToolDefs([
      { name: 'a' }, // no description/schema → defaults
      { name: 'a', description: 'dup should be skipped' }, // dedup by name
      { name: '  ', description: 'blank name skipped' },
      { name: 'b', description: 'b', input_schema: { type: 'object' }, input_examples: [{ x: 1 }, 'bad', { y: 2 }], interactive: true },
      { description: 'no name at all' },
    ]);
    const names = defs.map((d) => d.name);
    assertEq(JSON.stringify(names), '["a","b"]', 'deduped + blank/nameless dropped');
    assertEq(defs[0].description, '', 'missing description defaults to empty string');
    assertEq(JSON.stringify(defs[0].input_schema), '{"type":"object","properties":{}}', 'missing input_schema default');
    assertEq(defs[1].interactive, true, 'interactive:true preserved');
    assert(Array.isArray(defs[1].input_examples), 'input_examples array present');
    assertEq(defs[1].input_examples!.length, 2, 'non-object example dropped, 2 objects kept');
    assertEq('interactive' in (defs[0] as Record<string, unknown>), false, 'interactive omitted when not true');
    assertEq('input_examples' in (defs[0] as Record<string, unknown>), false, 'input_examples omitted when none');
  }

  // ── 7. toAgentCoreToolDefs — handler resolver (real dispatch injection) ─────
  group(7, 'toAgentCoreToolDefs: handler resolver + fail-closed fallback');
  {
    const realHandler = async () => ({ ok: true as const, data: { bound: true } });
    const defs = toAgentCoreToolDefs(
      [{ name: 'tasks.create', description: 'd', input_schema: {} }, { name: 'unbound', description: 'd', input_schema: {} }],
      { resolveHandler: (n) => (n === 'tasks.create' ? realHandler : undefined) },
    );
    const boundResult = await defs[0].handler({}, { session: {}, iteration: 0 });
    assertEq(boundResult.ok, true, 'resolver-bound handler used (ok:true)');
    assert(boundResult.ok === true && JSON.stringify(boundResult.data) === '{"bound":true}', 'bound handler returns real data');
    const fallbackResult = await defs[1].handler({}, { session: {}, iteration: 0 });
    assertEq(fallbackResult.ok, false, 'unbound tool falls back to fail-closed handler');
    assert(fallbackResult.ok === false && fallbackResult.error.includes('unbound'), 'fallback error names the tool');
    // Throwing resolver → fail-closed fallback, no throw.
    const defs2 = noThrow('throwing resolver', () => toAgentCoreToolDefs(
      [{ name: 'x', description: 'd', input_schema: {} }],
      { resolveHandler: () => { throw new Error('boom'); } },
    )) as ReturnType<typeof toAgentCoreToolDefs>;
    const r2 = await defs2[0].handler({}, { session: {}, iteration: 1 });
    assertEq(r2.ok, false, 'throwing resolver → fallback handler (still ok:false)');
    // Resolver returning a non-function → fallback.
    const defs3 = toAgentCoreToolDefs([{ name: 'y', description: 'd', input_schema: {} }], { resolveHandler: () => 'not-a-fn' as unknown as undefined });
    const r3 = await defs3[0].handler({}, { session: {}, iteration: 0 });
    assertEq(r3.ok, false, 'non-function resolver result → fallback');
  }

  // ── 8. normalizeV2StopReason — full vocabulary + precedence ─────────────────
  group(8, 'normalizeV2StopReason: vocabulary + precedence');
  {
    assertEq(normalizeV2StopReason({ stopReason: 'end_turn' }), 'end_turn', 'end_turn → end_turn');
    assertEq(normalizeV2StopReason({ stopReason: 'stop_sequence' }), 'end_turn', 'stop_sequence → end_turn (edge parity)');
    assertEq(normalizeV2StopReason({ stopReason: 'max_tokens' }), 'max_tokens', 'max_tokens → max_tokens');
    assertEq(normalizeV2StopReason({ stopReason: 'tool_use' }), 'error', 'terminal tool_use → error');
    assertEq(normalizeV2StopReason({ stopReason: 'garbage' }), 'error', 'unknown → error');
    assertEq(normalizeV2StopReason({ stopReason: 'END_TURN' }), 'end_turn', 'case-insensitive');
    assertEq(normalizeV2StopReason({ hitMaxIterations: true, stopReason: 'tool_use' }), 'max_tokens', 'hitMax precedence over raw reason');
    assertEq(normalizeV2StopReason({ aborted: true, stopReason: 'end_turn' }), 'error', 'aborted → error (not a clean completion)');
    assertEq(normalizeV2StopReason({ aborted: true, hitMaxIterations: true }), 'error', 'aborted wins over hitMax');
    assertEq(normalizeV2StopReason({}), 'error', 'empty → error');
    // No client_pending exists client-side (ADR §2.3) — never emitted.
    assert(normalizeV2StopReason({ stopReason: 'client_pending' }) === 'error', 'client_pending has no client-side meaning → error');
  }

  // ── 9. fromAgentCoreResult — full contract mapping ──────────────────────────
  group(9, 'fromAgentCoreResult: contract mapping');
  {
    const runResult = {
      text: 'done',
      iterations: 2,
      stopReason: 'end_turn' as const,
      hitMaxIterations: false,
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: [
          { type: 'text', text: 'ok' },
          { type: 'tool_use', id: 't1', name: 'tasks.create', input: { a: 1 } },
          { type: 'tool_use', id: 't2', name: 'save_memory', input: {} },
        ] },
        { role: 'user', content: [
          { type: 'tool_result', tool_use_id: 't1', content: '{"ok":true}', is_error: false },
          { type: 'tool_result', tool_use_id: 't2', content: '{"ok":false}', is_error: true },
        ] },
      ],
      usage: { input_tokens: 10, output_tokens: 5, cached_tokens: 3 },
    };
    const v2 = fromAgentCoreResult(runResult);
    assertEq(v2.text, 'done', 'text mapped');
    assertEq(v2.stopReason, 'end_turn', 'stopReason normalised to end_turn');
    assert(Array.isArray(v2.toolCalls), 'toolCalls is an array');
    assertEq(v2.toolCalls.length, 2, 'both tool_use blocks reconstructed');
    const tc0 = v2.toolCalls[0] as { toolName: string; toolUseId: string; ok: boolean };
    assertEq(tc0.toolName, 'tasks.create', 'toolCalls[0].toolName (edge :2531 shape)');
    assertEq(tc0.toolUseId, 't1', 'toolCalls[0].toolUseId');
    assertEq(tc0.ok, true, 'toolCalls[0].ok from is_error:false');
    const tc1 = v2.toolCalls[1] as { ok: boolean };
    assertEq(tc1.ok, false, 'toolCalls[1].ok from is_error:true');
    assertEq(JSON.stringify(v2.usage), '{"input_tokens":10,"output_tokens":5,"cached_tokens":3}', 'usage passthrough (sanitised)');
  }

  // ── 10. fromAgentCoreResult — abort/cap/absent-usage neutrals ───────────────
  group(10, 'fromAgentCoreResult: flag + neutral handling');
  {
    const aborted = fromAgentCoreResult({ text: 'partial', stopReason: 'end_turn', aborted: true, messages: [] });
    assertEq(aborted.stopReason, 'error', 'aborted run → error stopReason');
    assertEq(aborted.text, 'partial', 'aborted text still returned');
    const capped = fromAgentCoreResult({ text: '', stopReason: 'tool_use', hitMaxIterations: true, messages: [] });
    assertEq(capped.stopReason, 'max_tokens', 'cap-exhausted → max_tokens');
    const noUsage = fromAgentCoreResult({ text: 'x', stopReason: 'end_turn', messages: [] });
    assertEq(JSON.stringify(noUsage.usage), '{"input_tokens":0,"output_tokens":0,"cached_tokens":0}', 'absent usage → neutral zero object');
    assertEq(noUsage.toolCalls.length, 0, 'no tool_use → empty toolCalls');
    // Unresolved tool_use (no matching result) → ok:true (rare incomplete case).
    const unresolved = fromAgentCoreResult({ text: '', stopReason: 'end_turn', messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'orphan', name: 'foo', input: {} }] },
    ] });
    assertEq((unresolved.toolCalls[0] as { ok: boolean }).ok, true, 'orphan tool_use defaults ok:true');
  }

  // ── 11. Roundtrip fidelity: v2 message → core → shape-equal ─────────────────
  group(11, 'roundtrip fidelity');
  {
    const v2Msgs = [
      { role: 'user', content: 'plan the release' },
      { role: 'assistant', content: [
        { type: 'text', text: 'starting' },
        { type: 'tool_use', id: 'u9', name: 'missions.create_task', input: { title: 't', nested: { deep: [1, 2, 3] } } },
      ] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'u9', content: '{"ok":true,"data":{}}', is_error: false }] },
    ];
    const core = toAgentCoreMessages(v2Msgs);
    assertEq(core.length, v2Msgs.length, 'message count preserved');
    assertEq(core[0].content, 'plan the release', 'string content roundtrips exactly');
    const tu = (core[1].content as Array<{ type: string; name?: string; input?: unknown }>)[1];
    assertEq(tu.name, 'missions.create_task', 'tool name roundtrips');
    assertEq(JSON.stringify(tu.input), '{"title":"t","nested":{"deep":[1,2,3]}}', 'nested input roundtrips structurally');
    const tr = (core[2].content as Array<{ type: string; content?: unknown; is_error?: boolean }>)[0];
    assertEq(tr.content, '{"ok":true,"data":{}}', 'tool_result content roundtrips');
    assertEq(tr.is_error, false, 'is_error roundtrips');
    // toolDefs roundtrip: v2 ToolDef advertise fields survive.
    const defs = toAgentCoreToolDefs([{ name: 'wp.update_page', description: 'edit', input_schema: { type: 'object', properties: { id: { type: 'number' } } } }]);
    assertEq(defs[0].name, 'wp.update_page', 'toolDef name roundtrips');
    assertEq(JSON.stringify(defs[0].input_schema), '{"type":"object","properties":{"id":{"type":"number"}}}', 'input_schema roundtrips');
  }

  // ── 12. Bounds: huge inputs clamped, never unbounded ────────────────────────
  group(12, 'bounds: clamping');
  {
    const bigMsgs = Array.from({ length: V2_TO_AGENTCORE_LIMITS.maxMessages + 500 }, () => ({ role: 'user', content: 'x' }));
    const outMsgs = toAgentCoreMessages(bigMsgs);
    assertEq(outMsgs.length, V2_TO_AGENTCORE_LIMITS.maxMessages, 'message array capped at maxMessages');
    const bigTools = Array.from({ length: V2_TO_AGENTCORE_LIMITS.maxTools + 100 }, (_v, i) => ({ name: `t${i}`, description: 'd', input_schema: {} }));
    assertEq(toAgentCoreToolDefs(bigTools).length, V2_TO_AGENTCORE_LIMITS.maxTools, 'tool array capped at maxTools');
    const bigString = 'z'.repeat(V2_TO_AGENTCORE_LIMITS.maxStringChars + 10_000);
    const clamped = toAgentCoreMessages([{ role: 'user', content: bigString }]);
    assert((clamped[0].content as string).length < bigString.length, 'oversized string content clamped');
    assert((clamped[0].content as string).includes('[truncated'), 'clamp marker appended');
    const bigBlocks = { role: 'assistant', content: Array.from({ length: V2_TO_AGENTCORE_LIMITS.maxBlocksPerMessage + 200 }, () => ({ type: 'text', text: 'b' })) };
    const outBlocks = toAgentCoreMessages([bigBlocks]);
    assertEq((outBlocks[0].content as unknown[]).length, V2_TO_AGENTCORE_LIMITS.maxBlocksPerMessage, 'block array capped');
    const manyExamples = { name: 'e', description: 'd', input_schema: {}, input_examples: Array.from({ length: V2_TO_AGENTCORE_LIMITS.maxInputExamples + 20 }, () => ({ k: 1 })) };
    assertEq(toAgentCoreToolDefs([manyExamples])[0].input_examples!.length, V2_TO_AGENTCORE_LIMITS.maxInputExamples, 'input_examples capped');
    const manyCalls = {
      text: '', stopReason: 'end_turn', messages: [
        { role: 'assistant', content: Array.from({ length: V2_TO_AGENTCORE_LIMITS.maxToolCalls + 50 }, (_v, i) => ({ type: 'tool_use', id: `c${i}`, name: 'n', input: {} })) },
      ],
    };
    assertEq(fromAgentCoreResult(manyCalls).toolCalls.length, V2_TO_AGENTCORE_LIMITS.maxToolCalls, 'toolCalls capped at maxToolCalls');
  }

  // ── 13. Secret-safety: adapter reshapes but never fabricates a leak vector ──
  group(13, 'secret-safety: passthrough only, deep sanitise');
  {
    // A deeply-nested tool input is structurally sanitised (JSON-safe), not
    // expanded unbounded; non-serialisable leaves are dropped.
    const withFn = toAgentCoreMessages([{ role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'n', input: { keep: 'v', fn: () => 1, sym: Symbol('s'), bad: NaN } }] }]);
    const inp = (withFn[0].content as Array<{ input: Record<string, unknown> }>)[0].input;
    assertEq(inp.keep, 'v', 'serialisable field kept');
    assertEq('fn' in inp, false, 'function leaf dropped');
    assertEq('sym' in inp, false, 'symbol leaf dropped');
    assertEq(inp.bad, null, 'NaN → null (JSON-safe)');
    // Round-trips through JSON without throwing (proves JSON-safety).
    noThrow('sanitised input JSON.stringify', () => JSON.stringify(inp));
  }

  // ── 14. HOSTILE no-throw group: null/undefined/wrong-type/cyclic/huge ───────
  group(14, 'HOSTILE: total, never throws');
  {
    // Every export returns a safe neutral and NEVER throws on garbage input.
    assertEq(JSON.stringify(noThrow('msgs(null)', () => toAgentCoreMessages(null))), '[]', 'toAgentCoreMessages(null) → []');
    assertEq(JSON.stringify(noThrow('msgs(undefined)', () => toAgentCoreMessages(undefined))), '[]', 'toAgentCoreMessages(undefined) → []');
    assertEq(JSON.stringify(noThrow('msgs(number)', () => toAgentCoreMessages(42))), '[]', 'toAgentCoreMessages(42) → []');
    assertEq(JSON.stringify(noThrow('msgs(string)', () => toAgentCoreMessages('nope'))), '[]', 'toAgentCoreMessages(string) → []');
    assertEq(JSON.stringify(noThrow('msgs(object)', () => toAgentCoreMessages({ role: 'user' }))), '[]', 'toAgentCoreMessages(object) → []');

    assertEq(JSON.stringify(noThrow('tools(null)', () => toAgentCoreToolDefs(null))), '[]', 'toAgentCoreToolDefs(null) → []');
    assertEq(JSON.stringify(noThrow('tools(undefined)', () => toAgentCoreToolDefs(undefined))), '[]', 'toAgentCoreToolDefs(undefined) → []');
    assertEq(JSON.stringify(noThrow('tools(string)', () => toAgentCoreToolDefs('x'))), '[]', 'toAgentCoreToolDefs(string) → []');
    assertEq(JSON.stringify(noThrow('tools([garbage])', () => toAgentCoreToolDefs([1, 'a', null, true, {}]))), '[]', 'toAgentCoreToolDefs of junk entries → []');

    const rNull = noThrow('result(null)', () => fromAgentCoreResult(null)) as { text: string; toolCalls: unknown[]; stopReason: string };
    assertEq(rNull.text, '', 'fromAgentCoreResult(null).text → ""');
    assertEq(rNull.toolCalls.length, 0, 'fromAgentCoreResult(null).toolCalls → []');
    assertEq(rNull.stopReason, 'error', 'fromAgentCoreResult(null).stopReason → error');
    const rUndef = noThrow('result(undefined)', () => fromAgentCoreResult(undefined)) as { stopReason: string };
    assertEq(rUndef.stopReason, 'error', 'fromAgentCoreResult(undefined) → error');
    const rNum = noThrow('result(number)', () => fromAgentCoreResult(999)) as { text: string };
    assertEq(rNum.text, '', 'fromAgentCoreResult(number) neutral');

    assertEq(noThrow('stopReason(null)', () => normalizeV2StopReason(null)), 'error', 'normalizeV2StopReason(null) → error (total)');
    assertEq(noThrow('stopReason(undefined)', () => normalizeV2StopReason(undefined)), 'error', 'normalizeV2StopReason(undefined) → error (total)');
    assertEq(noThrow('stopReason({})', () => normalizeV2StopReason({})), 'error', 'normalizeV2StopReason({}) → error');

    // Cyclic tool input must not hang or throw.
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    const cyc = noThrow('cyclic input', () => toAgentCoreMessages([{ role: 'assistant', content: [{ type: 'tool_use', id: 'c', name: 'n', input: cyclic }] }])) as ReturnType<typeof toAgentCoreMessages>;
    const cycInput = (cyc[0].content as Array<{ input: Record<string, unknown> }>)[0].input;
    assertEq(cycInput.a, 1, 'cyclic input: scalar kept');
    assertEq(cycInput.self, '[omitted: circular]', 'cyclic ref collapsed to marker');
    noThrow('cyclic result JSON.stringify', () => JSON.stringify(cyc));

    // Cyclic messages array element (self-referential) — sanitiser bounds it.
    const cyclicResult: Record<string, unknown> = { text: 'x', stopReason: 'end_turn' };
    cyclicResult.messages = [{ role: 'assistant', content: [{ type: 'tool_use', id: 'z', name: 'n', input: cyclicResult }] }];
    noThrow('cyclic result mapping', () => fromAgentCoreResult(cyclicResult));

    // Deeply nested input beyond depth cap — collapses, no stack overflow.
    let deep: Record<string, unknown> = { v: 0 };
    for (let i = 0; i < 200; i++) deep = { next: deep };
    noThrow('deep-nested input', () => toAgentCoreMessages([{ role: 'user', content: [{ type: 'tool_use', id: 'd', name: 'n', input: deep }] }]));

    // Hostile schema (function / cyclic) on a tool.
    const badSchema: Record<string, unknown> = { type: 'object' };
    badSchema.loop = badSchema;
    const bad = noThrow('hostile tool schema', () => toAgentCoreToolDefs([{ name: 'h', description: 'd', input_schema: badSchema, handler: () => {} }])) as ReturnType<typeof toAgentCoreToolDefs>;
    assertEq(bad.length, 1, 'hostile-schema tool still produced');
    noThrow('hostile schema JSON.stringify', () => JSON.stringify(bad[0].input_schema));

    // Prototype-pollution-style keys are treated as ordinary own keys, not acted on.
    const polluted = toAgentCoreMessages([{ role: 'user', content: [{ type: 'tool_use', id: 'p', name: 'n', input: JSON.parse('{"__proto__":{"x":1},"ok":2}') }] }]);
    const pIn = (polluted[0].content as Array<{ input: Record<string, unknown> }>)[0].input;
    assertEq(pIn.ok, 2, 'normal key kept alongside a __proto__ key without pollution');
    assertEq(({} as Record<string, unknown>).x, undefined, 'global Object prototype not polluted');
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  if (failures > 0) {
    console.error(`✗ v2ToAgentCoreAdapterCore smoke FAILED: ${passes} passed, ${failures} failed`);
    process.exit(1);
  }
  console.log(`✓ v2ToAgentCoreAdapterCore smoke PASSED: ${passes} assertions, 0 failures`);
}

main().catch((e) => {
  console.error(`✗ smoke crashed: ${e instanceof Error ? e.stack || e.message : String(e)}`);
  process.exit(1);
});
