/**
 * swanbotV2BatchRuntimeCore — the PURE, tsx-loadable helpers for the loop
 * convergence batch runtime (`swanbotV2BatchRuntime.ts`, runbook §2 /
 * `docs/adr/ADR-0002-loop-convergence.md`).
 *
 * The runtime module itself imports `supabase` + `runAgent`, so it is NOT
 * loadable under tsx/esbuild. Per the house "smoke-tests-need-pure-modules"
 * rule, the two decisions that MUST stay byte-identical to the deleted
 * `swanbot-v2-ai` edge — the fail-closed model gate (runbook §2.1) and the
 * telemetry-parity terminal-row shape (runbook §3) — are extracted here so the
 * smoke (`scripts/swanbot-v2-batch-runtime-core-smoketest.ts`) can exercise
 * them off the DOM/Supabase.
 *
 * PURITY CONTRACT (load-bearing):
 *  - ZERO runtime imports ⇒ tsx-loadable. No react-native, no supabase, no
 *    `Date.now()` / `Math.random()` (timestamps are caller-injected).
 *  - Every export is TOTAL: never throws on any input, returns a safe neutral.
 *  - Deterministic: same input → same output.
 *  - Secret-safe: only reshapes caller-held control data (never logs/persists).
 */
// ── Cohort tags (telemetry parity §3) ────────────────────────────────────────

/**
 * `metadata.version` cohort tag the readiness gate filters on
 * (`swanbotOpenSwanReadiness.ts` reads `metadata->>version`). The CLIENT loop
 * MUST keep the EXACT edge tag `'swanbot-v2-ai'` — a renamed tag would silently
 * split the cohort and mask a completion-rate regression (runbook §3, R2).
 */
export const V2_BATCH_RUN_VERSION = 'swanbot-v2-ai';

/** Surface the readiness gate co-filters on (`surface='main_chat'`). */
export const V2_BATCH_RUN_SURFACE = 'main_chat';

/** Default target-agent name (edge parity: `index.ts:2927`). */
export const V2_BATCH_DEFAULT_TARGET_AGENT = 'BlackSwan';

/** Batch iteration budget — the edge's `MAX_ITERATIONS = 5` (`index.ts:2307`). */
export const V2_BATCH_MAX_ITERATIONS = 5;

// ── 2.1 Fail-closed model gate (R4) ──────────────────────────────────────────

/**
 * LOCKSTEP mirror of the edge `MODEL_MAP` (`index.ts:2778`-`2789`). The v2 batch
 * lane is Anthropic-only; the `swanbot-ai` relay would happily translate a
 * marketplace/BYOK model, so repointing at it could silently WIDEN batch-lane
 * model support. Keeping this allowlist closed preserves byte-identical batch
 * semantics (relaxing it is a separate later decision — ADR R4).
 */
export const V2_BATCH_MODEL_MAP: Readonly<Record<string, string>> = Object.freeze({
  'claude-haiku': 'claude-haiku-4-5-20251001',
  'claude-sonnet': 'claude-sonnet-4-6',
  'claude-fable': 'claude-fable-5',
  'claude-fable-5': 'claude-fable-5',
  'claude-opus': 'claude-opus-4-8',
  'claude-opus-4-8': 'claude-opus-4-8',
  'claude-opus-4-7': 'claude-opus-4-7',
  'claude-opus-4-6': 'claude-opus-4-6',
  'claude-sonnet-4-6': 'claude-sonnet-4-6',
  'claude-haiku-4-5': 'claude-haiku-4-5-20251001',
});

/** Default model key when the caller passes null/empty — edge parity
 *  (`const modelKey = (body.model as string) || "claude-haiku"`, `index.ts:2914`). */
export const V2_BATCH_DEFAULT_MODEL_KEY = 'claude-haiku';

/** The edge's `model_unsupported_on_v2` body-error code (`index.ts:2924`). */
export const V2_BATCH_MODEL_UNSUPPORTED_CODE = 'model_unsupported_on_v2';
/** The edge's exact rejection message (`index.ts:2924`). */
export const V2_BATCH_MODEL_UNSUPPORTED_MESSAGE =
  'This model is not supported on the v2 typed loop; route via swanbot-ai/llm-proxy.';

/** Same shape as the batch lane's `V2CallResult.bodyError` (`swanbot.ts`). */
export type V2BatchBodyError = { code?: string; message: string };

/** Resolved concrete model, or a fail-closed body error (never throws). */
export type V2BatchModelResolution = { model: string } | { bodyError: V2BatchBodyError };

/**
 * Resolve a requested model to a concrete Anthropic id, or fail closed with the
 * EXACT edge body-error shape. Mirror of `index.ts:2922`-`2924`:
 *   `MODEL_MAP[key] || (/^claude-/.test(key) ? key : null)` → 400 on null.
 * A `MODEL_MAP` alias OR an already-qualified `claude-*` id passes; anything
 * else (non-Anthropic marketplace/BYOK, `auto`/`blackswan` that were NOT
 * pre-resolved upstream) is rejected — so the relay can never quietly run a
 * different model on the batch lane. Total: null/undefined/non-string → the
 * `claude-haiku` default key (edge parity), which resolves.
 */
export function resolveV2BatchModel(model: unknown): V2BatchModelResolution {
  const key = typeof model === 'string' && model.trim() ? model.trim() : V2_BATCH_DEFAULT_MODEL_KEY;
  const resolved = V2_BATCH_MODEL_MAP[key] || (/^claude-/.test(key) ? key : null);
  if (!resolved) {
    return {
      bodyError: { code: V2_BATCH_MODEL_UNSUPPORTED_CODE, message: V2_BATCH_MODEL_UNSUPPORTED_MESSAGE },
    };
  }
  return { model: resolved };
}

// ── 3. Telemetry-parity terminal-row builders ────────────────────────────────

/** Normalized v2 stop-reason vocabulary (adapter `normalizeV2StopReason`). */
export type V2BatchStopReason = 'end_turn' | 'max_tokens' | 'error';

/** Token rollup (from `accumulateUsageFromEvents`) → agent_runs columns. */
export type V2BatchUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
};

/** Finite non-negative int, or 0 — parity with the edge's
 *  `agentRunTokenUsageFields` clamp (`index.ts:2402`-`2412`). */
function clampCount(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

/** Coerce any value to a string WITHOUT ever throwing (a hostile object can
 *  carry a throwing `toString`/`Symbol.toPrimitive`). Totality backstop. */
function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return String(value);
  } catch {
    return '';
  }
}

/**
 * Terminal `status` from the normalized stop reason — edge parity
 * (`terminalStatus = finalStopReason === "end_turn" ? "completed" : "failed"`,
 * `index.ts:3000`). Any non-`end_turn` string (incl. `max_tokens`/`error`) is a
 * non-completion, matching the edge; total for any input.
 */
export function v2BatchTerminalStatus(finalStopReason: unknown): 'completed' | 'failed' {
  return finalStopReason === 'end_turn' ? 'completed' : 'failed';
}

/**
 * Build the EXPLICIT terminal `agent_runs` update — a byte-for-byte mirror of
 * the edge terminal write (`index.ts:3002`-`3012`). This deliberately does NOT
 * reuse `agentRunPersistence.finalize`, whose column-only path (a) never sets
 * `metadata.version` (cohort loss), (b) writes the RAW stop reason
 * (`stop_sequence`/`tool_use` leak, understating completions), and (c) ignores
 * `aborted` (inflating completions) — the three drifts §3 documents.
 *
 * Timestamp is caller-injected (purity). Never throws.
 */
export function buildV2BatchTerminalRow(args: {
  toolCalls: unknown;
  iterations: unknown;
  finalStopReason: V2BatchStopReason | string;
  usage: V2BatchUsage;
  targetAgentName: string;
  rawStopReason: string;
  completedAt: string;
}): Record<string, unknown> {
  const usage = args.usage || ({} as V2BatchUsage);
  return {
    tool_calls: Array.isArray(args.toolCalls) ? args.toolCalls : [],
    iteration_count: clampCount(args.iterations),
    final_stop_reason: args.finalStopReason,
    input_tokens: clampCount(usage.inputTokens),
    output_tokens: clampCount(usage.outputTokens),
    cached_tokens: clampCount(usage.cachedTokens),
    status: v2BatchTerminalStatus(args.finalStopReason),
    completed_at: args.completedAt,
    // Cohort tag + raw reason kept, continuation blob deliberately dropped
    // (the client loop never pauses) — edge parity `index.ts:3011`.
    metadata: {
      version: V2_BATCH_RUN_VERSION,
      targetAgent: args.targetAgentName,
      rawStopReason: args.rawStopReason,
    },
  };
}

/**
 * Build the ON-THROW terminal row (de-risk #2 / runbook §0.5.2). The client
 * loop can die mid-run in ways the server edge never could; a crashed run must
 * NOT leave a row with a NULL/clean stop reason the readiness gate miscounts.
 * Mirrors the edge's terminal (non-transient) catch branch
 * (`index.ts:3093`-`3106`) — zeroed usage, `final_stop_reason:'error'`,
 * `status:'failed'`, and (critically) the KEPT `version` cohort tag. Never
 * throws; timestamp caller-injected.
 */
export function buildV2BatchErrorRow(args: {
  targetAgentName: string;
  errorMessage: unknown;
  completedAt: string;
}): Record<string, unknown> {
  const message =
    args.errorMessage instanceof Error ? safeString(args.errorMessage.message) : safeString(args.errorMessage);
  return {
    status: 'failed',
    input_tokens: 0,
    output_tokens: 0,
    cached_tokens: 0,
    tool_calls: [],
    iteration_count: 1,
    final_stop_reason: 'error',
    completed_at: args.completedAt,
    metadata: {
      version: V2_BATCH_RUN_VERSION,
      targetAgent: args.targetAgentName,
      error: message.slice(0, 500),
    },
  };
}

/** Run title — edge parity (`` `v2 ${mode}: ${String(message).slice(0, 80)}` ``,
 *  `index.ts:2935`). Total for any input. */
export function buildV2BatchRunTitle(mode: string, message: unknown): string {
  return `v2 ${mode}: ${safeString(message).slice(0, 80)}`;
}

/** Map the batch lane's `thinkingLevel` to the edge `mode`
 *  (`thinkingLevel === 'fast' ? 'talk' : 'build'`, `swanbot.ts` callSwanBotV2). */
export function resolveV2BatchMode(thinkingLevel: unknown): 'talk' | 'build' {
  return thinkingLevel === 'fast' ? 'talk' : 'build';
}
