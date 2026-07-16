// otelGenAiSpanCore — PURE builders that turn an agent run's lifecycle into an
// OpenTelemetry **GenAI** span tree: `invoke_agent` (root) → `chat` (per model
// turn) → `execute_tool` (per tool call). This is ADD #5 of
// docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md ("OTel GenAI span-tree
// observability … cost/cache/latency per span … replaces flat DB rows").
//
// The HARD, testable part extracted here is the *shape mapping*: taking the
// `AgentEvent` stream from `src/lib/agentExecutionCore.ts`
// (turn_start / turn_end+usage / tool_call_start / tool_call_result / …) and
// producing spans whose attributes use the real OTel GenAI semantic-convention
// keys, so the eventual observability layer is "wire a verified core" — the
// caller only generates ids, records timestamps, and exports the spans; it
// never re-derives which attribute key a token count belongs under.
//
// What this does NOT do (deliberately — that is the caller's job):
//   - Generate span/trace ids or read a clock (ids + startMs/endMs are params —
//     no Date.now / Math.random anywhere, so builders are deterministic).
//   - Emit / export / batch spans to an OTLP collector.
//   - Carry any prompt text, tool input, tool output, or credentials. Only
//     identity + numeric telemetry fields are ever read, so a span can never
//     smuggle a secret or an unbounded payload (every string is length-capped).
//
// OTel GenAI conventions applied (semconv `gen_ai.*`):
//   - Span NAME = "<operation> <target>": `invoke_agent <agent>`,
//     `chat <model>`, `execute_tool <tool>`.
//   - `gen_ai.operation.name` ∈ { invoke_agent, chat, execute_tool }.
//   - `gen_ai.system` = provider/framework (derived from the model id;
//     falls back to the app runtime brand when there is no model).
//   - `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
//     `gen_ai.usage.output_tokens`, `gen_ai.usage.cache_read_input_tokens`,
//     `gen_ai.usage.cache_creation_input_tokens`, `gen_ai.tool.name`,
//     `gen_ai.tool.type`, and the standard `error.type` on a failed tool.
//   App-namespaced extensions (`openswan.*`) carry run id / iteration / tool ok,
//   which have no standard semconv key.
//
// PURITY: zero imports, tsx-loadable (smoke: otel-genai-span-core). Every export
// is TOTAL — null / undefined / wrong-type / huge / hostile / cyclic input
// yields a well-formed neutral span (or undefined for the query helper) and
// NEVER throws.

/** OTel GenAI operation names we model, one per span kind. */
export type GenAiSpanKind = 'invoke_agent' | 'chat' | 'execute_tool';

export interface GenAiSpan {
  /** OTel span name: "<operation> <target>", e.g. "chat claude-haiku-4-5". */
  name: string;
  kind: GenAiSpanKind;
  /** Flat scalar attributes — GenAI semconv keys + app `openswan.*` extensions. */
  attributes: Record<string, string | number | boolean>;
  startMs: number;
  endMs?: number;
  /** Absent on the root `invoke_agent` span; set on every child span. */
  parentId?: string;
  spanId: string;
}

// ─── Bounds (secret/DoS hygiene) ─────────────────────────────────────────────
/** Max chars kept from any string attribute / name / id — caps a hostile blob. */
const MAX_STR = 512;
/** Non-negative integer clamp for token counts / iteration (generous, sane). */
const MAX_COUNT = 1_000_000_000;
/** Timestamp clamp — guards absurd-but-finite values (e.g. 1e300). */
const MAX_MS = Number.MAX_SAFE_INTEGER;

/** App runtime brand — used as `gen_ai.system` when no model resolves a provider. */
const DEFAULT_SYSTEM = 'openswan';
/** Standard OTel error attribute value stamped on a failed `execute_tool` span. */
const TOOL_ERROR_TYPE = 'tool_execution_error';

// ─── Total coercion helpers (never throw) ────────────────────────────────────

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

/** Bounded string coercion. Scalars stringify; everything else → fallback. */
function str(v: unknown, fallback: string): string {
  if (typeof v === 'string') return v.length > MAX_STR ? v.slice(0, MAX_STR) : v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return fallback;
}

function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Non-negative, floored, clamped integer (token counts, iteration). */
function nonNegInt(v: unknown): number | undefined {
  const n = finiteNum(v);
  if (n === undefined || n < 0) return undefined;
  const f = Math.floor(n);
  return f > MAX_COUNT ? MAX_COUNT : f;
}

/** Required timestamp — invalid/negative → 0; clamped to MAX_MS. */
function msRequired(v: unknown): number {
  const n = finiteNum(v);
  if (n === undefined || n < 0) return 0;
  return n > MAX_MS ? MAX_MS : n;
}

/** Optional timestamp — invalid/negative → undefined; clamped to MAX_MS. */
function msOptional(v: unknown): number | undefined {
  const n = finiteNum(v);
  if (n === undefined || n < 0) return undefined;
  return n > MAX_MS ? MAX_MS : n;
}

// ─── Provider (gen_ai.system) derivation ─────────────────────────────────────

/** Normalize a model-id prefix token to the app's canonical provider id. */
function normalizeProviderToken(token: string): string {
  const t = token.toLowerCase().replace(/[\s-]+/g, '_');
  switch (t) {
    case 'hugging_face':
    case 'huggingface_endpoint':
      return 'huggingface';
    case 'z_ai':
      return 'zai';
    case 'google':
    case 'googleai':
    case 'google_genai':
      return 'google_ai';
    case 'openai_compatible':
      return 'openai';
    default:
      return t || DEFAULT_SYSTEM;
  }
}

/**
 * Derive the OTel `gen_ai.system` (provider) from a model id. A provider-prefixed
 * id (`openrouter/auto`, `google_ai/gemini-2.5-pro`,
 * `huggingface_endpoint/cswan801/BlackSwan-v5`) uses the prefix; a bare id is
 * matched by well-known model family. No model at all → the app runtime brand
 * (`openswan`). Total: non-string / empty input → `openswan`. Never throws.
 */
export function deriveGenAiSystem(model: unknown): string {
  const m = str(model, '').toLowerCase();
  if (!m) return DEFAULT_SYSTEM;
  const slash = m.indexOf('/');
  if (slash > 0) return normalizeProviderToken(m.slice(0, slash));
  if (m.startsWith('claude') || m.includes('anthropic')) return 'anthropic';
  if (m.startsWith('gpt') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4') || m.includes('openai')) return 'openai';
  if (m.startsWith('gemini') || m.includes('google')) return 'google_ai';
  if (m.startsWith('deepseek')) return 'deepseek';
  if (m.startsWith('mistral') || m.startsWith('mixtral') || m.startsWith('codestral')) return 'mistral_ai';
  if (m.startsWith('command') || m.includes('cohere')) return 'cohere';
  if (m.includes('blackswan')) return 'huggingface';
  if (m.includes('llama')) return 'meta';
  return DEFAULT_SYSTEM;
}

// ─── Span builders ───────────────────────────────────────────────────────────

/**
 * ROOT span for one agent run (one `runAgent` invocation). Has NO `parentId` —
 * it is the top of the trace. `gen_ai.system` is derived from the (default/root)
 * model, so per-provider cost rolls up at the root. Total: any garbage input
 * yields `{ kind:'invoke_agent', name:'invoke_agent', … }` with a spanId.
 */
export function buildInvokeAgentSpan(input: {
  runId: unknown;
  agentName?: unknown;
  model?: unknown;
  startMs: unknown;
  spanId: unknown;
}): GenAiSpan {
  const safe = asRecord(input);
  const agentName = str(safe.agentName, '');
  const model = str(safe.model, '');
  const runId = str(safe.runId, '');

  const attributes: Record<string, string | number | boolean> = {
    'gen_ai.operation.name': 'invoke_agent',
    'gen_ai.system': deriveGenAiSystem(model),
  };
  if (model) attributes['gen_ai.request.model'] = model;
  if (agentName) attributes['gen_ai.agent.name'] = agentName;
  if (runId) attributes['openswan.run.id'] = runId;

  return {
    name: agentName ? `invoke_agent ${agentName}` : 'invoke_agent',
    kind: 'invoke_agent',
    attributes,
    startMs: msRequired(safe.startMs),
    // No parentId — root of the trace.
    spanId: str(safe.spanId, '') || 'unknown',
  };
}

/**
 * CHILD span for one model turn (agentExecutionCore `turn_start` → `turn_end`).
 * Maps the `usage` telemetry to the OTel token-count keys; a missing usage field
 * simply omits its attribute (no zero-filling). Total: garbage → neutral `chat`
 * span. Never throws.
 */
export function buildChatSpan(input: {
  parentId: unknown;
  iteration: unknown;
  model?: unknown;
  usage?: unknown;
  startMs: unknown;
  endMs?: unknown;
  spanId: unknown;
}): GenAiSpan {
  const safe = asRecord(input);
  const model = str(safe.model, '');
  const parentId = str(safe.parentId, '');
  const iteration = nonNegInt(safe.iteration);

  const attributes: Record<string, string | number | boolean> = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.system': deriveGenAiSystem(model),
  };
  if (model) attributes['gen_ai.request.model'] = model;
  if (iteration !== undefined) attributes['openswan.agent.iteration'] = iteration;

  // Usage → OTel GenAI token-count attributes. Read named scalar fields only
  // (cyclic/hostile usage objects are harmless — we never traverse deeply).
  const usage = asRecord(safe.usage);
  const inTok = nonNegInt(usage.input_tokens);
  if (inTok !== undefined) attributes['gen_ai.usage.input_tokens'] = inTok;
  const outTok = nonNegInt(usage.output_tokens);
  if (outTok !== undefined) attributes['gen_ai.usage.output_tokens'] = outTok;
  const cacheRead = nonNegInt(usage.cache_read_input_tokens);
  if (cacheRead !== undefined) attributes['gen_ai.usage.cache_read_input_tokens'] = cacheRead;
  const cacheCreate = nonNegInt(usage.cache_creation_input_tokens);
  if (cacheCreate !== undefined) attributes['gen_ai.usage.cache_creation_input_tokens'] = cacheCreate;

  const span: GenAiSpan = {
    name: model ? `chat ${model}` : 'chat',
    kind: 'chat',
    attributes,
    startMs: msRequired(safe.startMs),
    spanId: str(safe.spanId, '') || 'unknown',
  };
  if (parentId) span.parentId = parentId;
  const endMs = msOptional(safe.endMs);
  if (endMs !== undefined) span.endMs = endMs;
  return span;
}

/**
 * CHILD span for one tool call (agentExecutionCore `tool_call_start` →
 * `tool_call_result`). Carries `gen_ai.tool.name` + type + the boolean outcome;
 * a failed call also gets the standard `error.type`. `durationMs` (from the
 * result event) closes the span as `endMs = startMs + durationMs`. Total:
 * garbage → neutral `execute_tool` span. Never throws.
 */
export function buildToolSpan(input: {
  parentId: unknown;
  toolName: unknown;
  ok?: unknown;
  durationMs?: unknown;
  startMs: unknown;
  spanId: unknown;
}): GenAiSpan {
  const safe = asRecord(input);
  const toolName = str(safe.toolName, '');
  const parentId = str(safe.parentId, '');

  const attributes: Record<string, string | number | boolean> = {
    'gen_ai.operation.name': 'execute_tool',
    'gen_ai.tool.type': 'function',
  };
  if (toolName) attributes['gen_ai.tool.name'] = toolName;
  if (typeof safe.ok === 'boolean') {
    attributes['openswan.tool.ok'] = safe.ok;
    if (safe.ok === false) attributes['error.type'] = TOOL_ERROR_TYPE;
  }

  const startMs = msRequired(safe.startMs);
  const span: GenAiSpan = {
    name: toolName ? `execute_tool ${toolName}` : 'execute_tool',
    kind: 'execute_tool',
    attributes,
    startMs,
    spanId: str(safe.spanId, '') || 'unknown',
  };
  if (parentId) span.parentId = parentId;
  const dur = msOptional(safe.durationMs);
  if (dur !== undefined) {
    const e = startMs + dur;
    span.endMs = e > MAX_MS ? MAX_MS : e;
  }
  return span;
}

/**
 * Latency of a span in ms (`endMs - startMs`) — the "latency per span" the plan
 * item calls for. Total: a span with no/invalid endMs, or endMs before startMs,
 * or a non-span input → undefined. Never throws.
 */
export function spanDurationMs(span: unknown): number | undefined {
  const s = asRecord(span);
  const start = finiteNum(s.startMs);
  const end = finiteNum(s.endMs);
  if (start === undefined || end === undefined) return undefined;
  if (end < start) return undefined;
  return end - start;
}
