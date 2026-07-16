/**
 * v2ToAgentCoreAdapterCore — the message/tool-shape adapter for loop
 * convergence CONSOLIDATE #1 (ADR-0002 §3). Pure, tsx-loadable (`import type`
 * only), deterministic, bounded, secret-safe. NO Supabase, NO `runAgent`, NO
 * Date.now()/Math.random().
 *
 * ADR-0002 ("Loop Convergence — repoint the v2 batch lane at `runAgent`",
 * docs/adr/ADR-0002-loop-convergence.md) repoints the `batch` lane's
 * `callSwanBotV2` at `agentExecutionCore.runAgent`, deleting the bespoke
 * `swanbot-v2-ai` edge `runLoop` + the M2 continuation protocol. To drive the
 * canonical loop, the v2 wire shapes must be translated into the shapes
 * `runAgent` expects — and its result mapped back onto the v2 response
 * contract. This core owns exactly that bidirectional translation.
 *
 * Grounded in the REAL shapes (read, not guessed):
 *
 *   TARGET — src/lib/agentExecutionCore.ts
 *     · AgentMessageContentBlock          :57-60  (text | tool_use | tool_result)
 *     · AgentToolResultContentPart        :53-55  (text | image side channel)
 *     · AgentMessage { role, content }    :62-65  (role adds 'system' vs v2)
 *     · AgentToolDefinition               :67-82  (name/description/input_schema
 *                                                  /input_examples?/handler/interactive?)
 *     · AgentRunResult                    :340-359 (text/messages/iterations/
 *                                                  stopReason/hitMaxIterations/aborted?
 *                                                  — NO usage, NO toolCalls fields)
 *     · runAgent tool_result assembly     :1022   (results are one user-role msg)
 *
 *   SOURCE (v2 wire) — supabase/functions/swanbot-v2-ai/index.ts
 *     · ContentBlock (tool_result string) :65-68
 *     · AgentMessage (role user|assistant):70
 *     · ToolDef (+ clientOnly)            :75-93
 *     · advertised tool shape to model    :2291-2295 ({name,description,input_schema})
 *     · toolCalls record                  :2531   ({toolName,toolUseId,ok,durationMs,error?})
 *     · classifySwanBotV2FinalStopReason  :2365-2383 (end_turn|max_tokens|client_pending|error)
 *     · terminal HTTP response body       :3048-3060 ({text,stopReason,toolCalls,usage,...})
 *
 * Direction:
 *   toAgentCoreMessages(v2Messages)  → AgentMessage[]         (v2 wire → runAgent input)
 *   toAgentCoreToolDefs(v2Tools,opt) → AgentToolDefinition[]  (v2 catalog → runAgent tools)
 *   fromAgentCoreResult(runResult)   → V2 response contract   (runAgent result → v2 wire)
 *
 * TOTALITY: every export returns a safe neutral value for null/undefined/wrong-
 * type/huge/hostile/cyclic input and NEVER throws. Deep values (tool inputs,
 * schemas, usage) are passed through a bounded, cycle-safe JSON sanitiser so a
 * pathological payload can neither exhaust memory nor smuggle a non-serialisable
 * value into the loop. Secret-safe: this core only reshapes data the caller
 * already holds — it never logs, persists, or widens exposure of any field.
 */

import type {
  AgentMessage,
  AgentMessageContentBlock,
  AgentToolResultContentPart,
  AgentToolDefinition,
  AgentToolResult,
} from './agentExecutionCore';

// ─── Bounds (all translation is bounded; hostile input can never blow up) ─────

export const V2_TO_AGENTCORE_LIMITS = {
  /** Max messages kept from a v2 message array (overflow dropped from the tail). */
  maxMessages: 4000,
  /** Max content blocks kept per message. */
  maxBlocksPerMessage: 1000,
  /** Max tool definitions kept from a v2 catalog. */
  maxTools: 512,
  /** Max reconstructed toolCalls records in a v2 result. */
  maxToolCalls: 2000,
  /** Max input_examples kept per tool. */
  maxInputExamples: 32,
  /** Per-string char cap (text blocks, descriptions, JSON string leaves). */
  maxStringChars: 200_000,
  /** base64 image data hard cap (sliced, no marker, so it stays valid base64). */
  maxImageDataChars: 4_000_000,
  /** Deep-sanitiser structural caps. */
  maxDepth: 12,
  maxArrayItems: 4096,
  maxObjectKeys: 512,
  /** Global node budget across one sanitise call (backstop vs. fan-out blowup). */
  maxNodes: 50_000,
} as const;

const VALID_CORE_ROLES = new Set<AgentMessage['role']>(['user', 'assistant', 'system']);

// ─── Primitive-safe helpers ───────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toStringSafe(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  return '';
}

function clampString(value: string, cap: number): string {
  if (value.length <= cap) return value;
  return `${value.slice(0, cap)}…[truncated ${value.length - cap} chars]`;
}

/**
 * Bounded, cycle-safe JSON sanitiser. Returns a structurally-cloned, JSON-safe
 * copy: strings clamped, arrays/objects capped, cycles collapsed to a marker,
 * non-finite numbers → null, functions/symbols/undefined dropped. A shared
 * global node budget bounds total work regardless of fan-out. Never throws.
 */
function sanitizeDeep(value: unknown): unknown {
  const budget = { nodes: V2_TO_AGENTCORE_LIMITS.maxNodes };
  const seen = new WeakSet<object>();
  const walk = (v: unknown, depth: number): unknown => {
    if (v === null) return null;
    const t = typeof v;
    if (t === 'string') return clampString(v as string, V2_TO_AGENTCORE_LIMITS.maxStringChars);
    if (t === 'number') return Number.isFinite(v as number) ? v : null;
    if (t === 'boolean') return v;
    if (t === 'bigint') return clampString((v as bigint).toString(), V2_TO_AGENTCORE_LIMITS.maxStringChars);
    if (t !== 'object') return undefined; // function / symbol / undefined → drop
    if (budget.nodes <= 0) return '[omitted: budget]';
    if (depth >= V2_TO_AGENTCORE_LIMITS.maxDepth) return '[omitted: too deep]';
    const obj = v as object;
    if (seen.has(obj)) return '[omitted: circular]';
    seen.add(obj);
    budget.nodes -= 1;
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      const n = Math.min(v.length, V2_TO_AGENTCORE_LIMITS.maxArrayItems);
      for (let i = 0; i < n && budget.nodes > 0; i++) out.push(walk(v[i], depth + 1));
      return out;
    }
    const out: Record<string, unknown> = {};
    let kept = 0;
    for (const key in obj as Record<string, unknown>) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      if (kept >= V2_TO_AGENTCORE_LIMITS.maxObjectKeys || budget.nodes <= 0) break;
      const sv = walk((obj as Record<string, unknown>)[key], depth + 1);
      if (sv === undefined) continue;
      out[key] = sv;
      kept += 1;
    }
    return out;
  };
  try {
    return walk(value, 0);
  } catch {
    return null;
  }
}

/** Sanitised plain-object clone (or a neutral default when input isn't an object). */
function sanitizeObject(value: unknown, fallback: Record<string, unknown>): Record<string, unknown> {
  if (!isPlainObject(value)) return { ...fallback };
  const cleaned = sanitizeDeep(value);
  return isPlainObject(cleaned) ? cleaned : { ...fallback };
}

// ─── Direction 1: v2 wire messages → AgentMessage[] (runAgent input) ──────────

function normalizeRole(role: unknown): AgentMessage['role'] {
  return typeof role === 'string' && VALID_CORE_ROLES.has(role as AgentMessage['role'])
    ? (role as AgentMessage['role'])
    : 'user'; // unknown / missing → attribute to user (never fabricate an assistant turn)
}

function normalizeToolResultContent(
  content: unknown,
): string | AgentToolResultContentPart[] {
  // v2 wire tool_result content is string-only (index.ts:68); the core also
  // accepts an image side-channel parts array, so we tolerate both directions.
  if (typeof content === 'string') return clampString(content, V2_TO_AGENTCORE_LIMITS.maxStringChars);
  if (!Array.isArray(content)) return clampString(toStringSafe(content), V2_TO_AGENTCORE_LIMITS.maxStringChars);
  const parts: AgentToolResultContentPart[] = [];
  const n = Math.min(content.length, V2_TO_AGENTCORE_LIMITS.maxBlocksPerMessage);
  for (let i = 0; i < n; i++) {
    const part = content[i];
    if (!isPlainObject(part)) continue;
    if (part.type === 'image' && isPlainObject(part.source)) {
      const src = part.source;
      parts.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: typeof src.media_type === 'string' && src.media_type ? src.media_type : 'image/png',
          // Hard-slice (no marker) so bounded data stays valid base64.
          data: toStringSafe(src.data).slice(0, V2_TO_AGENTCORE_LIMITS.maxImageDataChars),
        },
      });
    } else {
      parts.push({ type: 'text', text: clampString(toStringSafe((part as Record<string, unknown>).text), V2_TO_AGENTCORE_LIMITS.maxStringChars) });
    }
  }
  return parts;
}

function normalizeContentBlock(block: unknown): AgentMessageContentBlock | null {
  if (!isPlainObject(block)) return null;
  switch (block.type) {
    case 'text':
      return { type: 'text', text: clampString(toStringSafe(block.text), V2_TO_AGENTCORE_LIMITS.maxStringChars) };
    case 'tool_use':
      return {
        type: 'tool_use',
        id: toStringSafe(block.id),
        name: toStringSafe(block.name),
        input: sanitizeDeep(block.input ?? {}),
      };
    case 'tool_result': {
      const out: Extract<AgentMessageContentBlock, { type: 'tool_result' }> = {
        type: 'tool_result',
        tool_use_id: toStringSafe(block.tool_use_id),
        content: normalizeToolResultContent(block.content),
      };
      // Preserve is_error only when the source carried it (fidelity).
      if ('is_error' in block) out.is_error = block.is_error === true;
      return out;
    }
    default:
      return null; // unknown block type → drop (never throw, never invent)
  }
}

/**
 * Normalise v2 wire messages into `agentExecutionCore`'s `AgentMessage[]`. The
 * core message shape is a strict superset of the v2 wire shape (adds the
 * 'system' role + the image side-channel), so a well-formed v2 message survives
 * unchanged; hostile input degrades to the closest safe shape. Always an array.
 */
export function toAgentCoreMessages(v2Messages: unknown): AgentMessage[] {
  try {
    if (!Array.isArray(v2Messages)) return [];
    const out: AgentMessage[] = [];
    const n = Math.min(v2Messages.length, V2_TO_AGENTCORE_LIMITS.maxMessages);
    for (let i = 0; i < n; i++) {
      const raw = v2Messages[i];
      if (!isPlainObject(raw)) continue;
      const role = normalizeRole(raw.role);
      const content = raw.content;
      if (typeof content === 'string') {
        out.push({ role, content: clampString(content, V2_TO_AGENTCORE_LIMITS.maxStringChars) });
        continue;
      }
      if (Array.isArray(content)) {
        const blocks: AgentMessageContentBlock[] = [];
        const bn = Math.min(content.length, V2_TO_AGENTCORE_LIMITS.maxBlocksPerMessage);
        for (let b = 0; b < bn; b++) {
          const nb = normalizeContentBlock(content[b]);
          if (nb) blocks.push(nb);
        }
        out.push({ role, content: blocks });
        continue;
      }
      // content is neither string nor array (null/number/object/...) → empty text.
      out.push({ role, content: '' });
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Direction 2: v2 ToolDef[] → AgentToolDefinition[] (runAgent tools) ────────

const DEFAULT_INPUT_SCHEMA: Record<string, unknown> = { type: 'object', properties: {} };

/** Optional handler resolver, so the batch runtime can bind REAL dispatch by
 *  name from the canonical `openswanToolRuntime` catalog (ADR-0002 §2.1: all
 *  tools dispatch in-process client-side). Injected — never imported — so this
 *  core stays pure. A missing/throwing resolver falls back to a fail-closed
 *  handler; the v2 edge's own handlers are intentionally NOT carried across
 *  (they bind the edge Supabase client and don't work client-side). */
export type AgentCoreHandler = AgentToolDefinition['handler'];
export type ToAgentCoreToolDefsOptions = {
  resolveHandler?: (toolName: string) => AgentCoreHandler | undefined | null;
};

function makeFallbackHandler(toolName: string): AgentCoreHandler {
  // Fail-closed placeholder (mirrors the v2 ToolDef's "defensive fallback"
  // note, index.ts:88-92) — but returns a policy result instead of throwing,
  // per AgentToolDefinition's "handler MUST NOT throw" contract (:75).
  const handler: AgentCoreHandler = async (): Promise<AgentToolResult> => ({
    ok: false,
    error: `Tool "${toolName}" has no bound handler on the v2→agent-core adapter path; the batch runtime must bind it from the openswanToolRuntime catalog by name.`,
  });
  return handler;
}

function resolveInputExamples(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: Array<Record<string, unknown>> = [];
  const n = Math.min(value.length, V2_TO_AGENTCORE_LIMITS.maxInputExamples);
  for (let i = 0; i < n; i++) {
    const ex = value[i];
    if (!isPlainObject(ex)) continue;
    const cleaned = sanitizeDeep(ex);
    if (isPlainObject(cleaned)) out.push(cleaned);
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Normalise v2 tool declarations into `agentExecutionCore`'s
 * `AgentToolDefinition[]`. Carries the advertise-facing fields the v2 loop
 * itself forwards to the model (name/description/input_schema, index.ts:2291-
 * 2295) plus optional input_examples/interactive. The v2-only `clientOnly` flag
 * is INTENTIONALLY dropped: ADR-0002 §2.3 deletes the client/server split when
 * the loop runs in-process. Handlers are bound via the injected resolver (real
 * dispatch) or a fail-closed fallback. Deduped by name (first wins, matching a
 * registry's first-registration semantics). Always an array.
 */
export function toAgentCoreToolDefs(
  v2Tools: unknown,
  options?: ToAgentCoreToolDefsOptions,
): AgentToolDefinition[] {
  try {
    if (!Array.isArray(v2Tools)) return [];
    const out: AgentToolDefinition[] = [];
    const seenNames = new Set<string>();
    const resolveHandler = options?.resolveHandler;
    const limit = Math.min(v2Tools.length, V2_TO_AGENTCORE_LIMITS.maxTools);
    for (let i = 0; i < limit; i++) {
      const raw = v2Tools[i];
      if (!isPlainObject(raw)) continue;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name || seenNames.has(name)) continue; // a tool with no name is useless
      seenNames.add(name);

      let handler: AgentCoreHandler | undefined;
      if (resolveHandler) {
        try {
          const resolved = resolveHandler(name);
          if (typeof resolved === 'function') handler = resolved;
        } catch {
          handler = undefined; // resolver failure → fail closed to the fallback
        }
      }
      if (!handler) handler = makeFallbackHandler(name);

      const def: AgentToolDefinition = {
        name,
        description: clampString(toStringSafe(raw.description), V2_TO_AGENTCORE_LIMITS.maxStringChars),
        input_schema: sanitizeObject(raw.input_schema, DEFAULT_INPUT_SCHEMA),
        handler,
      };
      const examples = resolveInputExamples(raw.input_examples);
      if (examples) def.input_examples = examples;
      if (raw.interactive === true) def.interactive = true;
      out.push(def);
    }
    return out;
  } catch {
    return [];
  }
}

// ─── Direction 3: AgentRunResult → v2 response contract ───────────────────────

export type V2ResultContract = {
  text: string;
  toolCalls: unknown[];
  usage: unknown;
  stopReason: string;
};

const NEUTRAL_USAGE: Record<string, unknown> = { input_tokens: 0, output_tokens: 0, cached_tokens: 0 };

/**
 * Normalise a raw model stop_reason (+ the run's cap/abort flags) into the v2
 * wire vocabulary. LOCKSTEP mirror of `classifySwanBotV2FinalStopReason`
 * (index.ts:2365-2383) MINUS `client_pending` — the client-side loop never
 * pauses (ADR-0002 §2.3) — with the ADR §3 refinements: an aborted run is NOT
 * a clean completion (→ 'error'), and a cap-exhausted run maps to 'max_tokens'
 * (checked before the raw reason, matching the edge's `hitMax` precedence).
 */
export function normalizeV2StopReason(args: {
  stopReason?: unknown;
  hitMaxIterations?: unknown;
  aborted?: unknown;
} | null | undefined): 'end_turn' | 'max_tokens' | 'error' {
  const a = isPlainObject(args) ? args : {};
  if (a.aborted === true) return 'error';
  if (a.hitMaxIterations === true) return 'max_tokens';
  const raw = toStringSafe(a.stopReason).trim().toLowerCase();
  if (raw === 'end_turn' || raw === 'stop_sequence') return 'end_turn';
  if (raw === 'max_tokens') return 'max_tokens';
  return 'error'; // 'tool_use' terminal (loop ended still wanting a tool) or unknown
}

/**
 * Reconstruct the v2 `toolCalls` trace (index.ts:2531 shape:
 * {toolName,toolUseId,ok}) from an AgentRunResult's `messages`. AgentRunResult
 * has no `toolCalls` field, so we walk the transcript: every tool_use block is
 * one call; `ok` is read from the matching tool_result's `is_error`. Bounded.
 */
function reconstructToolCalls(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return [];
  const errById = new Map<string, boolean>();
  for (const msg of messages) {
    if (!isPlainObject(msg) || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (isPlainObject(block) && block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        errById.set(block.tool_use_id, block.is_error === true);
      }
    }
  }
  const out: unknown[] = [];
  for (const msg of messages) {
    if (!isPlainObject(msg) || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (!isPlainObject(block) || block.type !== 'tool_use') continue;
      if (out.length >= V2_TO_AGENTCORE_LIMITS.maxToolCalls) return out;
      const toolUseId = toStringSafe(block.id);
      // Unresolved tool_use (no matching result) is treated as ok — a terminal
      // transcript closes every use; a missing result is the rare incomplete case.
      const ok = errById.has(toolUseId) ? errById.get(toolUseId) !== true : true;
      out.push({ toolName: toStringSafe(block.name), toolUseId, ok });
    }
  }
  return out;
}

/**
 * Map `agentExecutionCore.runAgent`'s `AgentRunResult` (:340-359) back onto the
 * v2 response contract the `batch` lane's callers already consume (terminal
 * body at index.ts:3048-3060). `text` is the final assistant text; `toolCalls`
 * is reconstructed from the transcript; `usage` is a sanitised passthrough of
 * any usage the runtime attached (AgentRunResult itself carries none — usage is
 * aggregated from turn events — so absent usage yields a neutral zero object);
 * `stopReason` is the normalised v2 vocabulary. Always the full contract shape.
 */
export function fromAgentCoreResult(runResult: unknown): V2ResultContract {
  try {
    const r = isPlainObject(runResult) ? runResult : {};
    const text = clampString(toStringSafe(r.text), V2_TO_AGENTCORE_LIMITS.maxStringChars);
    const toolCalls = reconstructToolCalls(r.messages);
    const usage = isPlainObject(r.usage)
      ? sanitizeObject(r.usage, NEUTRAL_USAGE)
      : { ...NEUTRAL_USAGE };
    const stopReason = normalizeV2StopReason({
      stopReason: r.stopReason,
      hitMaxIterations: r.hitMaxIterations,
      aborted: r.aborted,
    });
    return { text, toolCalls, usage, stopReason };
  } catch {
    return { text: '', toolCalls: [], usage: { ...NEUTRAL_USAGE }, stopReason: 'error' };
  }
}
