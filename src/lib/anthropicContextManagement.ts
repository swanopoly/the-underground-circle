/**
 * anthropicContextManagement — pure config builder for Anthropic's
 * `context_management` request field (the `clear_tool_uses_20250919` strategy,
 * a.k.a. "context editing").
 *
 * WHAT THIS DOES (verified against Anthropic's Messages API docs):
 *   Long client-driven tool loops re-send the WHOLE message history on every
 *   round. Once that history is large, most of the input tokens are stale
 *   tool_result bytes the model no longer needs. `clear_tool_uses_20250919`
 *   tells the API to DROP the oldest tool-use/tool-result pairs from the
 *   prompt before the model sees them (keeping the N most-recent pairs), and
 *   replace each cleared result with a short placeholder so the model knows
 *   something was removed rather than silently losing context.
 *
 *   Anthropic's published data on this strategy: +29–39% on agentic evals and
 *   −84% token consumption on a 100-turn eval. It is NOT compaction
 *   (`compact_20260112`, which summarizes) — this prunes.
 *
 * CACHE ECONOMICS (why `clear_at_least` matters — read before tuning):
 *   Prompt caching is a prefix match: clearing tool results mutates the cached
 *   prefix, so a clear INVALIDATES every cached breakpoint at or after the
 *   clear point (the swanbot-ai relay adds two such breakpoints — system+tools
 *   and message-history — see P26). If the strategy clears a small sliver each
 *   round, you pay a full cache RE-WRITE (~1.25× input) to save only a few
 *   freed tokens — a net loss. `clear_at_least` forces each clear to shed a
 *   LARGE chunk so the re-write pays for itself. Keep it generous.
 *
 * BETA STATUS:
 *   `context_management` is a beta as of the research cutoff and requires the
 *   beta header value in CONTEXT_MANAGEMENT_BETA_HEADER below. The strategy
 *   type string and the beta header are DIFFERENT tokens (the strategy is
 *   dated 20250919; the beta header is dated 2025-06-27) — do not conflate.
 *
 * PURITY CONTRACT:
 *   Zero runtime imports (type-only if ever needed). Safe to import from a Deno
 *   edge function AND to exercise under tsx/esbuild in a smoke test. No throws
 *   on degenerate input — every builder clamps/validates and returns a
 *   well-formed object.
 */

// ── Beta headers ────────────────────────────────────────────────────────────
// The `anthropic-beta` header value that gates the `context_management` field.
// ONE-LINE UPDATE: if Anthropic revises the beta token, change only this const.
// (Strategy type stays `clear_tool_uses_20250919`; this header is separate.)
export const CONTEXT_MANAGEMENT_BETA_HEADER = "context-management-2025-06-27";

// X3 (P49): SERVER-SIDE COMPACTION is a SEPARATE beta from context editing —
// different edit type (`compact_20260112`), different header token. Verified
// against the compaction doc (fetched 2026-07-09). Do not conflate the two.
export const COMPACTION_BETA_HEADER = "compact-2026-01-12";

// The strategy types this builder emits. Exported so the smoke test and
// relay can assert on the exact documented strings without re-typing them.
export const CLEAR_TOOL_USES_STRATEGY_TYPE = "clear_tool_uses_20250919";
export const COMPACTION_STRATEGY_TYPE = "compact_20260112";

// Stop reason emitted when `pause_after_compaction: true` halts the turn
// right after the summary is generated.
export const COMPACTION_STOP_REASON = "compaction";

// ── Bounds (documented rationale on each) ────────────────────────────────────
// trigger: input-token threshold at which a clear fires. Default 100K is
// Anthropic's documented default. Floor 20K keeps clears meaningful (below that
// a tool loop hasn't accumulated enough stale bytes to be worth a cache
// invalidation); ceiling 180K keeps the trigger comfortably under a 200K
// context so a clear happens BEFORE the window is exhausted, not after.
export const TRIGGER_MIN = 20_000;
export const TRIGGER_MAX = 180_000;
export const TRIGGER_DEFAULT = 100_000;

// keep: number of most-recent tool-use/result pairs preserved verbatim. Default
// 3 is Anthropic's documented default — enough recent context for the model to
// continue the loop. 1–10 bounds it: <1 would clear everything (breaks the
// loop); >10 preserves so much that little is ever freed.
export const KEEP_MIN = 1;
export const KEEP_MAX = 10;
export const KEEP_DEFAULT = 3;

// clear_at_least: minimum input tokens each clear must shed. Default 20K makes
// every clear a LARGE chunk so the forced cache re-write (see CACHE ECONOMICS)
// is amortized. Floor 5K is the smallest chunk that can plausibly beat a
// re-write; no ceiling beyond the trigger relationship enforced below.
export const CLEAR_AT_LEAST_MIN = 5_000;
export const CLEAR_AT_LEAST_DEFAULT = 20_000;

export interface ClearToolUsesOptions {
  /** Input-token count that triggers a clear. Clamped to [20K, 180K]. */
  triggerInputTokens?: number;
  /** Most-recent tool-use/result pairs to keep verbatim. Clamped to [1, 10]. */
  keepToolUses?: number;
  /** Minimum input tokens each clear must free. Clamped to >= 5K. */
  clearAtLeastInputTokens?: number;
  /**
   * When true, also clears the tool_use INPUT params (not just the result).
   * Anthropic's optional `clear_tool_inputs`. Default false (results only).
   */
  clearToolInputs?: boolean;
}

// ── Emitted config shape (matches the documented clear_tool_uses schema) ─────
export interface ContextManagementInputTokensSpec {
  type: "input_tokens";
  value: number;
}
export interface ContextManagementToolUsesSpec {
  type: "tool_uses";
  value: number;
}
export interface ClearToolUsesEdit {
  type: typeof CLEAR_TOOL_USES_STRATEGY_TYPE;
  trigger: ContextManagementInputTokensSpec;
  keep: ContextManagementToolUsesSpec;
  clear_at_least: ContextManagementInputTokensSpec;
  clear_tool_inputs?: boolean;
}

// ── Compaction (X3/P49) — bounds with documented rationale ──────────────────
// trigger: input-token threshold at which the API summarizes earlier context.
// 150K is Anthropic's documented default; 50K is the documented API FLOOR
// (values below it are rejected). Ceiling 800K keeps the trigger comfortably
// under the 1M window on supported models so compaction fires BEFORE the
// window is exhausted.
export const COMPACT_TRIGGER_MIN = 50_000;
export const COMPACT_TRIGGER_DEFAULT = 150_000;
export const COMPACT_TRIGGER_MAX = 800_000;
// Custom summarization instructions REPLACE Anthropic's default prompt
// entirely — bound them so a runaway client string can't bloat the request.
export const MAX_COMPACTION_INSTRUCTIONS_CHARS = 4_000;

export interface CompactionOptions {
  /** Input-token count that triggers compaction. Clamped to [50K, 800K]. */
  triggerInputTokens?: number;
  /** Stop after generating the summary (stop_reason: 'compaction'). Default false. */
  pauseAfterCompaction?: boolean;
  /** Custom summarization prompt — REPLACES the default entirely. Bounded. */
  instructions?: string | null;
}

export interface CompactionEdit {
  type: typeof COMPACTION_STRATEGY_TYPE;
  trigger: ContextManagementInputTokensSpec;
  pause_after_compaction?: boolean;
  instructions?: string;
}

export type ContextManagementEdit = ClearToolUsesEdit | CompactionEdit;

export interface ContextManagementConfig {
  edits: ContextManagementEdit[];
}

/**
 * Coerce an arbitrary value to a finite integer, or return `fallback`.
 * Tolerates strings, floats, NaN, Infinity, null, undefined, objects — never
 * throws. Non-integers are floored (token counts are whole numbers).
 */
function toIntOr(value: unknown, fallback: number): number {
  const n = typeof value === "string" ? Number(value) : (value as number);
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function clamp(n: number, lo: number, hi: number): number {
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Build the `context_management` object for the `clear_tool_uses_20250919`
 * strategy. All options are bounded/validated; degenerate input (undefined,
 * NaN, negative, strings, wrong types) is clamped to safe defaults rather than
 * throwing.
 *
 * Invariant enforced beyond the per-field clamps: `clear_at_least` is never
 * allowed to meet or exceed `trigger` (a clear that must free >= the trigger
 * threshold could never satisfy itself and would wedge the loop) — if the
 * caller's values collide, `clear_at_least` is pulled below `trigger`.
 */
export function buildClearToolUsesConfig(
  opts?: ClearToolUsesOptions | null,
): ContextManagementConfig {
  const o = opts && typeof opts === "object" ? opts : {};

  const trigger = clamp(
    toIntOr(o.triggerInputTokens, TRIGGER_DEFAULT),
    TRIGGER_MIN,
    TRIGGER_MAX,
  );

  const keep = clamp(toIntOr(o.keepToolUses, KEEP_DEFAULT), KEEP_MIN, KEEP_MAX);

  let clearAtLeast = Math.max(
    CLEAR_AT_LEAST_MIN,
    toIntOr(o.clearAtLeastInputTokens, CLEAR_AT_LEAST_DEFAULT),
  );
  // Keep clear_at_least strictly below the trigger so a clear is always
  // satisfiable. If they collide, cap it at trigger-minus-floor (but never
  // below the floor itself).
  if (clearAtLeast >= trigger) {
    clearAtLeast = Math.max(CLEAR_AT_LEAST_MIN, trigger - CLEAR_AT_LEAST_MIN);
  }

  const edit: ClearToolUsesEdit = {
    type: CLEAR_TOOL_USES_STRATEGY_TYPE,
    trigger: { type: "input_tokens", value: trigger },
    keep: { type: "tool_uses", value: keep },
    clear_at_least: { type: "input_tokens", value: clearAtLeast },
  };
  if (o.clearToolInputs === true) {
    edit.clear_tool_inputs = true;
  }

  return { edits: [edit] };
}

/**
 * Build the `context_management` object for the `compact_20260112` strategy
 * (X3/P49). Bounded/validated; degenerate input clamps to safe defaults.
 * Compaction summarizes earlier context server-side once input tokens cross
 * the trigger — the response then carries a `compaction` content block the
 * client MUST append back verbatim (our relay loop pushes `data.content`
 * as-is, so the contract holds by construction).
 */
export function buildCompactionConfig(
  opts?: CompactionOptions | null,
): ContextManagementConfig {
  const o = opts && typeof opts === "object" ? opts : {};
  const trigger = clamp(
    toIntOr(o.triggerInputTokens, COMPACT_TRIGGER_DEFAULT),
    COMPACT_TRIGGER_MIN,
    COMPACT_TRIGGER_MAX,
  );
  const edit: CompactionEdit = {
    type: COMPACTION_STRATEGY_TYPE,
    trigger: { type: "input_tokens", value: trigger },
  };
  if (o.pauseAfterCompaction === true) edit.pause_after_compaction = true;
  if (typeof o.instructions === "string" && o.instructions.trim()) {
    edit.instructions = o.instructions.trim().slice(0, MAX_COMPACTION_INSTRUCTIONS_CHARS);
  }
  return { edits: [edit] };
}

// ── Compaction model gate (documented list; unknown → false, fail closed) ──
// Compaction is NOT supported on Haiku 4.5 or Opus 4.5 — attaching it there
// would 400 the relay call, so the relay strips compact edits for
// unsupported models instead of forwarding them.
const COMPACTION_MODEL_PATTERNS: ReadonlyArray<RegExp> = [
  /^claude-fable-5/,
  /^claude-mythos-5/,
  /^claude-mythos-preview/,
  /^claude-opus-4-[6-8]/,
  /^claude-sonnet-4-6/,
  /^claude-sonnet-5/,
];

export function isCompactionSupportedModel(model: string | null | undefined): boolean {
  if (!model || typeof model !== "string") return false;
  return COMPACTION_MODEL_PATTERNS.some((pattern) => pattern.test(model));
}

/**
 * Fail-closed model gate for a resolved config: strips `compact_20260112`
 * edits when the relay model is not on the documented compaction list.
 * Returns null when nothing survives (caller then attaches no
 * context_management at all). Non-mutating.
 */
export function stripUnsupportedCompactionEdits(
  config: ContextManagementConfig | null,
  model: string | null | undefined,
): ContextManagementConfig | null {
  if (!config || !Array.isArray(config.edits) || config.edits.length === 0) return null;
  if (isCompactionSupportedModel(model)) return config;
  const kept = config.edits.filter((edit) => edit.type !== COMPACTION_STRATEGY_TYPE);
  if (kept.length === 0) return null;
  return { edits: kept };
}

/**
 * Structural validator for a client-provided `context_management` object.
 * Returns a NORMALIZED, bounded copy (routing each edit's numbers back through
 * the same clamps as the builder) when the shape is a recognizable
 * clear_tool_uses config; returns null otherwise. Never throws.
 *
 * This lets the relay forward a client-supplied config safely: we re-derive
 * every numeric field so a client can't push an out-of-range or malformed
 * trigger/keep/clear_at_least through to Anthropic.
 */
export function normalizeClientContextManagement(
  value: unknown,
): ContextManagementConfig | null {
  if (!value || typeof value !== "object") return null;
  const edits = (value as { edits?: unknown }).edits;
  if (!Array.isArray(edits) || edits.length === 0) return null;

  const compactionEdits: CompactionEdit[] = [];
  const clearEdits: ClearToolUsesEdit[] = [];
  for (const raw of edits) {
    if (!raw || typeof raw !== "object") continue;
    const type = (raw as { type?: unknown }).type;

    if (type === CLEAR_TOOL_USES_STRATEGY_TYPE) {
      // Accept either the nested spec form ({type,value}) or a bare number, and
      // route through the builder so the result is always bounded.
      const trig = extractSpecValue((raw as any).trigger);
      const keep = extractSpecValue((raw as any).keep);
      const clr = extractSpecValue((raw as any).clear_at_least);
      const clearInputs = (raw as any).clear_tool_inputs === true;

      const built = buildClearToolUsesConfig({
        triggerInputTokens: trig ?? undefined,
        keepToolUses: keep ?? undefined,
        clearAtLeastInputTokens: clr ?? undefined,
        clearToolInputs: clearInputs,
      });
      clearEdits.push(built.edits[0] as ClearToolUsesEdit);
      continue;
    }

    if (type === COMPACTION_STRATEGY_TYPE) {
      // X3 (P49): same clamp-through-the-builder posture for compaction.
      const trig = extractSpecValue((raw as any).trigger);
      const pause = (raw as any).pause_after_compaction === true;
      const instructions = typeof (raw as any).instructions === "string"
        ? (raw as any).instructions
        : null;
      const built = buildCompactionConfig({
        triggerInputTokens: trig ?? undefined,
        pauseAfterCompaction: pause,
        instructions,
      });
      compactionEdits.push(built.edits[0] as CompactionEdit);
      continue;
    }
    // Unknown edit types are dropped (fail closed), never forwarded raw.
  }

  if (compactionEdits.length === 0 && clearEdits.length === 0) return null;
  // Edits apply sequentially; compaction goes FIRST so history is summarized
  // before tool results are pruned (documented ordering guidance).
  return { edits: [...compactionEdits, ...clearEdits] };
}

/** Pull a numeric value from a `{type,value}` spec or a bare number; else null. */
function extractSpecValue(spec: unknown): number | null {
  if (typeof spec === "number" && Number.isFinite(spec)) return spec;
  if (spec && typeof spec === "object") {
    const v = (spec as { value?: unknown }).value;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && Number.isFinite(Number(v))) return Number(v);
  }
  return null;
}

/**
 * Gate: should the relay attach context_management to THIS request?
 *
 * Returns true ONLY when the request explicitly opts in — either:
 *   (a) `body.context_management_mode` is 'clear_tool_uses' or 'compact'
 *       (X3/P49), or
 *   (b) `body.context_management` is already a recognizable config object.
 *
 * Default is FALSE. Anything else (missing, other mode strings, wrong types,
 * null/undefined body) → false. This is the flag-dark switch: with no client
 * wired to opt in, this returns false for every current request and the relay
 * stays byte-identical to today.
 */
export function shouldAttachContextManagement(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const b = body as {
    context_management_mode?: unknown;
    context_management?: unknown;
  };
  if (b.context_management_mode === "clear_tool_uses") return true;
  if (b.context_management_mode === "compact") return true;
  if (normalizeClientContextManagement(b.context_management) !== null) {
    return true;
  }
  return false;
}

/**
 * Resolve the config to attach for an opted-in request: forward the client's
 * (validated/normalized) config if present, else build the default. Callers
 * should only invoke this after shouldAttachContextManagement(body) === true.
 * Falls back to the default config if a claimed client config fails to
 * normalize, so an opted-in request never ends up with no config.
 */
export function resolveContextManagementConfig(
  body: unknown,
  defaults?: ClearToolUsesOptions | null,
): ContextManagementConfig {
  if (body && typeof body === "object") {
    const client = normalizeClientContextManagement(
      (body as { context_management?: unknown }).context_management,
    );
    if (client) return client;
    // X3 (P49): mode 'compact' with no explicit config → documented-default
    // compaction edit (trigger 150K, no pause, default summarizer).
    if ((body as { context_management_mode?: unknown }).context_management_mode === "compact") {
      return buildCompactionConfig();
    }
  }
  return buildClearToolUsesConfig(defaults);
}

// ── Beta-token derivation (X3/P49) ──────────────────────────────────────────
// Context editing and compaction are gated by DIFFERENT beta tokens. Derive
// exactly the tokens the resolved config needs — a compact-only request must
// not carry the context-editing token, and vice versa.

export function requiredContextManagementBetas(
  config: ContextManagementConfig | null | undefined,
): string[] {
  const tokens: string[] = [];
  for (const edit of config?.edits ?? []) {
    if (edit.type === CLEAR_TOOL_USES_STRATEGY_TYPE && !tokens.includes(CONTEXT_MANAGEMENT_BETA_HEADER)) {
      tokens.push(CONTEXT_MANAGEMENT_BETA_HEADER);
    }
    if (edit.type === COMPACTION_STRATEGY_TYPE && !tokens.includes(COMPACTION_BETA_HEADER)) {
      tokens.push(COMPACTION_BETA_HEADER);
    }
  }
  return tokens;
}

/**
 * Merge the beta tokens a config requires into an existing `anthropic-beta`
 * header value (comma-joined, de-duplicated, order-preserving). The
 * config-aware successor to `appendContextManagementBeta` — that older
 * helper stays for clear_tool_uses-only callers.
 */
export function appendContextManagementBetasForConfig(
  existing: string | null | undefined,
  config: ContextManagementConfig | null | undefined,
): string {
  const tokens = (existing ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const required of requiredContextManagementBetas(config)) {
    if (!tokens.includes(required)) tokens.push(required);
  }
  return tokens.join(", ");
}

// ── Response-side helpers (the client preservation contract) ───────────────
// A compaction response carries a `compaction` content block the client MUST
// append back verbatim on the next request (the API drops all blocks prior
// to it and continues from the summary). Our relay loop pushes `data.content`
// as-is, so the contract holds — these helpers let telemetry/assertions SEE
// that a compaction happened without touching the blocks.

export function isCompactionContentBlock(block: unknown): boolean {
  return !!block && typeof block === "object"
    && (block as { type?: unknown }).type === "compaction";
}

export function containsCompactionBlock(content: unknown): boolean {
  return Array.isArray(content) && content.some(isCompactionContentBlock);
}

/**
 * Merge the context-management beta token into an existing `anthropic-beta`
 * header value without clobbering other betas (e.g. prompt-caching). Returns a
 * comma-joined, de-duplicated list. Pass the current header value (or
 * null/undefined if none) and get back the value to set.
 */
export function appendContextManagementBeta(
  existing: string | null | undefined,
): string {
  const tokens = (existing ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (!tokens.includes(CONTEXT_MANAGEMENT_BETA_HEADER)) {
    tokens.push(CONTEXT_MANAGEMENT_BETA_HEADER);
  }
  return tokens.join(", ");
}
