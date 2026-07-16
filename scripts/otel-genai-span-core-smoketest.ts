/**
 * otel-genai-span-core-smoketest — the pure OTel GenAI span builders
 * (src/lib/otelGenAiSpanCore.ts) for ADD #5 of the chat architecture strategic
 * plan (invoke_agent → chat → execute_tool span tree with cost/cache/latency).
 *
 * Load-bearing guarantees pinned here:
 *   - the invoke_agent ROOT has NO parentId; every child span DOES;
 *   - span names follow OTel "<operation> <target>" ("chat <model>", etc.);
 *   - `gen_ai.operation.name` is invoke_agent / chat / execute_tool per builder;
 *   - `usage` maps to the OTel keys gen_ai.usage.input_tokens / output_tokens /
 *     cache_read_input_tokens (+ cache_creation_input_tokens), omitting absent ones;
 *   - a tool span carries gen_ai.tool.name + the boolean ok (+ error.type on fail),
 *     and durationMs closes it (endMs = startMs + durationMs);
 *   - gen_ai.system is derived from the model id (provider prefix / family);
 *   - attributes are SECRET-FREE + bounded (no input/output/apiKey ever copied in,
 *     every string length-capped) and every value is a string|number|boolean;
 *   - builders are DETERMINISTIC and TOTAL — null/wrong/huge/hostile/cyclic input
 *     never throws and always yields a well-formed span of the right kind.
 *
 * Pure — loads under tsx (otelGenAiSpanCore has zero imports).
 */

import {
  buildInvokeAgentSpan,
  buildChatSpan,
  buildToolSpan,
  deriveGenAiSystem,
  spanDurationMs,
  type GenAiSpan,
} from '../src/lib/otelGenAiSpanCore';

let passes = 0, failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else { failures++; console.error('FAIL: ' + m + (e ? ' :: ' + e : '')); }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

/** Every attribute value must be a scalar (string|number|boolean) — no objects,
 *  no arrays, no unbounded blobs — for OTLP export + secret hygiene. */
function attrsAreScalar(span: GenAiSpan, maxLen: number): boolean {
  const a = span.attributes;
  if (!a || typeof a !== 'object') return false;
  for (const k of Object.keys(a)) {
    const v = a[k];
    const t = typeof v;
    if (t !== 'string' && t !== 'number' && t !== 'boolean') return false;
    if (t === 'string' && (v as string).length > maxLen) return false;
  }
  return true;
}

function main(): void {
  // ─── (1) invoke_agent ROOT: no parent, OTel required keys ──────────────────
  {
    const s = buildInvokeAgentSpan({
      runId: 'run_abc', agentName: 'Researcher', model: 'claude-haiku-4-5',
      startMs: 1000, spanId: 'span-root',
    });
    assertEq(s.kind, 'invoke_agent', '(1) kind invoke_agent');
    assertEq(s.parentId, undefined, '(1) ROOT has no parentId');
    assertEq(s.name, 'invoke_agent Researcher', '(1) name = invoke_agent <agent>');
    assertEq(s.spanId, 'span-root', '(1) spanId preserved');
    assertEq(s.startMs, 1000, '(1) startMs preserved');
    assertEq(s.attributes['gen_ai.operation.name'], 'invoke_agent', '(1) operation.name');
    assertEq(s.attributes['gen_ai.system'], 'anthropic', '(1) system derived from model');
    assertEq(s.attributes['gen_ai.request.model'], 'claude-haiku-4-5', '(1) request.model');
    assertEq(s.attributes['gen_ai.agent.name'], 'Researcher', '(1) agent.name');
    assertEq(s.attributes['openswan.run.id'], 'run_abc', '(1) run.id extension');
  }
  {
    // No agentName / no model → generic name + default system, still no parent.
    const s = buildInvokeAgentSpan({ runId: 'r', startMs: 5, spanId: 'x' });
    assertEq(s.name, 'invoke_agent', '(1) generic name w/o agentName');
    assertEq(s.attributes['gen_ai.system'], 'openswan', '(1) default system w/o model');
    assertEq(s.attributes['gen_ai.request.model'], undefined, '(1) no model → no model attr');
    assertEq(s.parentId, undefined, '(1) still no parentId');
  }

  // ─── (2) chat CHILD: parent + OTel usage token keys ────────────────────────
  {
    const s = buildChatSpan({
      parentId: 'span-root', iteration: 2, model: 'openrouter/auto',
      usage: { input_tokens: 1200, output_tokens: 340, cache_read_input_tokens: 900, cache_creation_input_tokens: 128 },
      startMs: 1005, endMs: 1900, spanId: 'span-chat-2',
    });
    assertEq(s.kind, 'chat', '(2) kind chat');
    assertEq(s.parentId, 'span-root', '(2) child carries parentId');
    assertEq(s.name, 'chat openrouter/auto', '(2) name = chat <model>');
    assertEq(s.startMs, 1005, '(2) startMs');
    assertEq(s.endMs, 1900, '(2) endMs preserved');
    assertEq(s.attributes['gen_ai.operation.name'], 'chat', '(2) operation.name chat');
    assertEq(s.attributes['gen_ai.usage.input_tokens'], 1200, '(2) OTel input_tokens key');
    assertEq(s.attributes['gen_ai.usage.output_tokens'], 340, '(2) OTel output_tokens key');
    assertEq(s.attributes['gen_ai.usage.cache_read_input_tokens'], 900, '(2) OTel cache_read key');
    assertEq(s.attributes['gen_ai.usage.cache_creation_input_tokens'], 128, '(2) OTel cache_creation key');
    assertEq(s.attributes['openswan.agent.iteration'], 2, '(2) iteration extension');
    assertEq(s.attributes['gen_ai.system'], 'openrouter', '(2) system from prefixed model');
  }
  {
    // Partial usage → only present fields become attributes (no zero-filling).
    const s = buildChatSpan({ parentId: 'p', iteration: 1, model: 'gpt-4o', usage: { input_tokens: 50 }, startMs: 0, spanId: 's' });
    assertEq(s.attributes['gen_ai.usage.input_tokens'], 50, '(2) partial usage: input present');
    assertEq(s.attributes['gen_ai.usage.output_tokens'], undefined, '(2) partial usage: output omitted');
    assertEq(s.attributes['gen_ai.usage.cache_read_input_tokens'], undefined, '(2) partial usage: cache_read omitted');
    assertEq(s.endMs, undefined, '(2) no endMs → undefined');
  }
  {
    // No usage at all → zero usage attributes; no model → generic name.
    const s = buildChatSpan({ parentId: 'p', iteration: 0, startMs: 10, spanId: 's' });
    assertEq(s.name, 'chat', '(2) generic name w/o model');
    const usageKeys = Object.keys(s.attributes).filter((k) => k.startsWith('gen_ai.usage.'));
    assertEq(usageKeys.length, 0, '(2) no usage → no usage attrs');
    assertEq(s.attributes['openswan.agent.iteration'], 0, '(2) iteration 0 still recorded');
  }

  // ─── (3) execute_tool CHILD: tool.name + ok + duration ─────────────────────
  {
    const s = buildToolSpan({ parentId: 'span-chat-2', toolName: 'local.run_shell', ok: true, durationMs: 45, startMs: 1100, spanId: 'span-tool-1' });
    assertEq(s.kind, 'execute_tool', '(3) kind execute_tool');
    assertEq(s.parentId, 'span-chat-2', '(3) tool child parentId');
    assertEq(s.name, 'execute_tool local.run_shell', '(3) name = execute_tool <tool>');
    assertEq(s.attributes['gen_ai.operation.name'], 'execute_tool', '(3) operation.name execute_tool');
    assertEq(s.attributes['gen_ai.tool.name'], 'local.run_shell', '(3) gen_ai.tool.name');
    assertEq(s.attributes['gen_ai.tool.type'], 'function', '(3) gen_ai.tool.type function');
    assertEq(s.attributes['openswan.tool.ok'], true, '(3) ok=true recorded');
    assertEq(s.attributes['error.type'], undefined, '(3) no error.type when ok');
    assertEq(s.endMs, 1145, '(3) endMs = startMs + durationMs');
  }
  {
    // Failed tool → ok=false + standard OTel error.type.
    const s = buildToolSpan({ parentId: 'p', toolName: 'git.run', ok: false, durationMs: 12, startMs: 200, spanId: 's' });
    assertEq(s.attributes['openswan.tool.ok'], false, '(3) ok=false recorded');
    assertEq(s.attributes['error.type'], 'tool_execution_error', '(3) error.type on failure');
    assertEq(s.endMs, 212, '(3) failed tool endMs still computed');
  }
  {
    // No duration → open span (no endMs); non-bool ok → omitted (safe neutral).
    const s = buildToolSpan({ parentId: 'p', toolName: 'gmail.search', startMs: 5, spanId: 's', ok: 'yes' as unknown });
    assertEq(s.endMs, undefined, '(3) no durationMs → open span');
    assertEq(s.attributes['openswan.tool.ok'], undefined, '(3) non-bool ok omitted');
    assertEq(s.attributes['gen_ai.tool.name'], 'gmail.search', '(3) tool.name still present');
  }

  // ─── (4) deriveGenAiSystem: provider prefixes + families + default ─────────
  assertEq(deriveGenAiSystem('claude-haiku-4-5'), 'anthropic', '(4) claude → anthropic');
  assertEq(deriveGenAiSystem('gpt-4o'), 'openai', '(4) gpt → openai');
  assertEq(deriveGenAiSystem('o3-mini'), 'openai', '(4) o3 → openai');
  assertEq(deriveGenAiSystem('gemini-2.5-pro'), 'google_ai', '(4) gemini → google_ai');
  assertEq(deriveGenAiSystem('openrouter/auto'), 'openrouter', '(4) prefix openrouter');
  assertEq(deriveGenAiSystem('google_ai/gemini-2.5-pro'), 'google_ai', '(4) prefix google_ai');
  assertEq(deriveGenAiSystem('deepseek/deepseek-reasoner'), 'deepseek', '(4) prefix deepseek');
  assertEq(deriveGenAiSystem('huggingface_endpoint/cswan801/BlackSwan-v5'), 'huggingface', '(4) hf endpoint prefix → huggingface');
  assertEq(deriveGenAiSystem('hugging_face/x'), 'huggingface', '(4) alias hugging_face → huggingface');
  assertEq(deriveGenAiSystem('z_ai/glm-4'), 'zai', '(4) alias z_ai → zai');
  assertEq(deriveGenAiSystem('mistral-large-latest'), 'mistral_ai', '(4) mistral family');
  assertEq(deriveGenAiSystem('command-r-plus'), 'cohere', '(4) command family → cohere');
  assertEq(deriveGenAiSystem('BlackSwan-v5'), 'huggingface', '(4) blackswan bare → huggingface');
  assertEq(deriveGenAiSystem(''), 'openswan', '(4) empty → default system');
  assertEq(deriveGenAiSystem(undefined), 'openswan', '(4) undefined → default system');
  assertEq(deriveGenAiSystem('some-unknown-model'), 'openswan', '(4) unknown bare → default');

  // ─── (5) spanDurationMs: latency-per-span helper ───────────────────────────
  {
    const tool = buildToolSpan({ parentId: 'p', toolName: 't', ok: true, durationMs: 45, startMs: 1100, spanId: 's' });
    assertEq(spanDurationMs(tool), 45, '(5) duration from closed tool span');
    const chat = buildChatSpan({ parentId: 'p', iteration: 1, startMs: 100, endMs: 250, spanId: 's' });
    assertEq(spanDurationMs(chat), 150, '(5) duration from chat span');
    const open = buildToolSpan({ parentId: 'p', toolName: 't', startMs: 5, spanId: 's' });
    assertEq(spanDurationMs(open), undefined, '(5) open span → undefined');
    assertEq(spanDurationMs({ startMs: 100, endMs: 90 }), undefined, '(5) end<start → undefined');
    assertEq(spanDurationMs(null), undefined, '(5) null → undefined');
    assertEq(spanDurationMs('nope' as unknown), undefined, '(5) non-span → undefined');
    assertEq(spanDurationMs({ startMs: 0, endMs: 0 }), 0, '(5) zero-length span → 0');
  }

  // ─── (6) SECRET-FREE + bounded attributes ──────────────────────────────────
  {
    // A caller might spread a whole tool_call event in. Only declared identity
    // fields are read — input/output/apiKey/secret must NEVER appear.
    const hostileEvent = {
      parentId: 'p', toolName: 'browser.fill_credential_field', ok: true, durationMs: 3, startMs: 1, spanId: 's',
      input: { password: 'hunter2', apiKey: 'sk-LIVE-DEADBEEF' },
      output: 'base64-blob-of-secrets',
      apiKey: 'sk-should-not-appear',
    } as unknown as { parentId: unknown; toolName: unknown; ok?: unknown; durationMs?: unknown; startMs: unknown; spanId: unknown };
    const s = buildToolSpan(hostileEvent);
    const keys = Object.keys(s.attributes);
    assert(!keys.includes('input'), '(6) input not copied into attributes');
    assert(!keys.includes('output'), '(6) output not copied into attributes');
    assert(!keys.includes('apiKey'), '(6) apiKey not copied into attributes');
    assert(!keys.includes('password'), '(6) password not copied into attributes');
    const blob = JSON.stringify(s.attributes);
    assert(!blob.includes('hunter2'), '(6) no secret value leaked into attributes');
    assert(!blob.includes('sk-LIVE-DEADBEEF'), '(6) no api key value leaked into attributes');
    assert(!blob.includes('sk-should-not-appear'), '(6) top-level apiKey value not leaked');
  }
  {
    // Huge hostile strings are length-capped in every builder.
    const big = 'A'.repeat(100_000);
    const s1 = buildInvokeAgentSpan({ runId: big, agentName: big, model: big, startMs: 0, spanId: big });
    assert(attrsAreScalar(s1, 512), '(6) invoke_agent attrs scalar + bounded');
    assert(s1.spanId.length <= 512, '(6) spanId bounded');
    assert(s1.name.length <= 600, '(6) name bounded (prefix + capped agent)');
    const s2 = buildChatSpan({ parentId: big, iteration: 1, model: big, usage: { input_tokens: 1 }, startMs: 0, spanId: 's' });
    assert(attrsAreScalar(s2, 512), '(6) chat attrs scalar + bounded');
    assert((s2.parentId ?? '').length <= 512, '(6) parentId bounded');
    const s3 = buildToolSpan({ parentId: 'p', toolName: big, ok: true, startMs: 0, spanId: 's' });
    assert(attrsAreScalar(s3, 512), '(6) tool attrs scalar + bounded');
  }
  {
    // Token counts clamped non-negative; negatives/NaN/huge dropped or clamped.
    const s = buildChatSpan({ parentId: 'p', iteration: -5, model: 'x', usage: { input_tokens: -10, output_tokens: NaN, cache_read_input_tokens: 1e300 }, startMs: 0, spanId: 's' });
    assertEq(s.attributes['gen_ai.usage.input_tokens'], undefined, '(6) negative tokens dropped');
    assertEq(s.attributes['gen_ai.usage.output_tokens'], undefined, '(6) NaN tokens dropped');
    assertEq(s.attributes['gen_ai.usage.cache_read_input_tokens'], 1_000_000_000, '(6) huge tokens clamped');
    assertEq(s.attributes['openswan.agent.iteration'], undefined, '(6) negative iteration dropped');
  }

  // ─── (7) DETERMINISM — same input → identical span ─────────────────────────
  {
    const mk = () => buildChatSpan({ parentId: 'p', iteration: 3, model: 'claude-haiku-4-5', usage: { input_tokens: 10, output_tokens: 20 }, startMs: 7, endMs: 9, spanId: 's' });
    assertEq(JSON.stringify(mk()), JSON.stringify(mk()), '(7) chat span deterministic');
    const mkr = () => buildInvokeAgentSpan({ runId: 'r', agentName: 'A', model: 'gpt-4o', startMs: 1, spanId: 's' });
    assertEq(JSON.stringify(mkr()), JSON.stringify(mkr()), '(7) invoke_agent span deterministic');
  }

  // ─── (8) HOSTILE / degenerate input → never throws, always well-formed ─────
  const cyclic: Record<string, unknown> = { toolName: 'c' };
  cyclic.self = cyclic;
  const usageCyclic: Record<string, unknown> = { input_tokens: 5 };
  usageCyclic.self = usageCyclic;
  const hostile: unknown[] = [
    null, undefined, 0, 1, NaN, '', 'string', true, false, [], {}, [1, 2, 3],
    Symbol('x'), () => 0, cyclic,
    { runId: {}, agentName: [], model: () => 1, startMs: 'nope', spanId: null },
    { parentId: Symbol('p'), iteration: {}, model: {}, usage: usageCyclic, startMs: {}, endMs: [], spanId: {} },
    { parentId: null, toolName: {}, ok: 1, durationMs: -3, startMs: null, spanId: [] },
  ];
  try {
    for (const h of hostile) {
      const a = buildInvokeAgentSpan(h as never);
      assertEq(a.kind, 'invoke_agent', '(8) invoke_agent kind under hostile');
      assert(typeof a.spanId === 'string' && a.spanId.length > 0, '(8) invoke_agent has spanId');
      assertEq(a.parentId, undefined, '(8) invoke_agent never gets a parent');
      assert(typeof a.startMs === 'number' && Number.isFinite(a.startMs) && a.startMs >= 0, '(8) invoke_agent startMs finite ≥0');
      assert(attrsAreScalar(a, 512), '(8) invoke_agent attrs scalar under hostile');
      assertEq(a.attributes['gen_ai.operation.name'], 'invoke_agent', '(8) invoke_agent op.name always set');

      const c = buildChatSpan(h as never);
      assertEq(c.kind, 'chat', '(8) chat kind under hostile');
      assert(typeof c.spanId === 'string' && c.spanId.length > 0, '(8) chat has spanId');
      assert(attrsAreScalar(c, 512), '(8) chat attrs scalar under hostile');
      assertEq(c.attributes['gen_ai.operation.name'], 'chat', '(8) chat op.name always set');

      const t = buildToolSpan(h as never);
      assertEq(t.kind, 'execute_tool', '(8) tool kind under hostile');
      assert(typeof t.spanId === 'string' && t.spanId.length > 0, '(8) tool has spanId');
      assert(attrsAreScalar(t, 512), '(8) tool attrs scalar under hostile');
      assertEq(t.attributes['gen_ai.operation.name'], 'execute_tool', '(8) tool op.name always set');

      // Query helper + derive must also never throw on hostile input.
      spanDurationMs(h);
      deriveGenAiSystem(h);
    }
    passes++; // reaching here == no throw across the whole hostile sweep
  } catch (e) {
    failures++;
    console.error('FAIL: (8) hostile input threw :: ' + ((e as Error)?.message ?? String(e)));
  }

  // ─── (9) end-to-end: a mini run maps to a coherent parent/child tree ───────
  {
    const root = buildInvokeAgentSpan({ runId: 'run1', agentName: 'Coder', model: 'claude-haiku-4-5', startMs: 0, spanId: 'r' });
    const chat = buildChatSpan({ parentId: root.spanId, iteration: 1, model: 'claude-haiku-4-5', usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 80 }, startMs: 1, endMs: 500, spanId: 'c1' });
    const tool = buildToolSpan({ parentId: chat.spanId, toolName: 'codebase.search', ok: true, durationMs: 30, startMs: 200, spanId: 't1' });
    assertEq(root.parentId, undefined, '(9) root has no parent');
    assertEq(chat.parentId, 'r', '(9) chat parented to root');
    assertEq(tool.parentId, 'c1', '(9) tool parented to chat');
    assertEq(root.kind, 'invoke_agent', '(9) root kind');
    assertEq(chat.kind, 'chat', '(9) chat kind');
    assertEq(tool.kind, 'execute_tool', '(9) tool kind');
    assertEq(spanDurationMs(chat), 499, '(9) chat latency');
    assertEq(spanDurationMs(tool), 30, '(9) tool latency');
    // Cache-read savings observable on the chat span (the plan's "cache per span").
    assertEq(chat.attributes['gen_ai.usage.cache_read_input_tokens'], 80, '(9) cache read visible on chat span');
  }

  if (failures > 0) { console.error('\n' + failures + ' fail'); process.exit(1); }
  console.log('\nAll otel-genai-span-core smoke cases passed (' + passes + ' passed).');
}

main();
