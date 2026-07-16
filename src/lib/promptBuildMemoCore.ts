/**
 * promptBuildMemoCore — OPTIMIZE #2 of
 * docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md: "Build the system prompt
 * once per turn."
 *
 * The problem this exists to solve
 * --------------------------------
 * `getSwanBotResponseImpl` in `swanbot.ts` calls `buildSystemPromptAsync` in
 * Tier 1 (`:3559`), Tier 1.5 (`:3590`), and Tier 3 (`:3830`); on any tier
 * fall-through it rebuilds the WHOLE heavy prompt — including the expensive
 * FROZEN prefix (agent identity + BlackSwan grounding contract + the tool
 * catalog signature) that is STABLE within a single turn. That prefix is also
 * the exact bytes `promptCacheSplitCore` wants to mark as the cacheable prefix
 * (OPTIMIZE #1). Rebuilding it 2-3× per turn burns CPU + DB round-trips for a
 * byte-identical result while only the DYNAMIC tail (chat history, live
 * context, retrieval) actually changes between calls in the same turn.
 *
 * The fix, as testable pure logic
 * -------------------------------
 * Model the memo DECISION as pure data + pure predicates so `swanbot.ts` can
 * build the frozen prefix ONCE per turn and reuse it across tiers, rebuilding
 * only when a genuinely frozen input drifts. This module owns:
 *   1. computePromptMemoKey    — normalize the identifying fields into a stable
 *      key; `frozenInputsHash` is derived from the STABLE inputs only
 *      (agent identity id, model, grounding version, tool-catalog signature) —
 *      never the user message / chat history / live context.
 *   2. promptMemoKeyString     — a compact, collision-resistant Map cache key.
 *   3. shouldReuseFrozenPrefix — true iff the frozen inputs are identical
 *      (same circle/user/turn/tier/hash) → reuse the cached frozen prefix.
 *   4. decidePromptBuild       — the same decision with a telemetry reason.
 *
 * BIAS = fail toward REBUILD. Reusing a STALE prefix (wrong model / identity /
 * tools in the prompt) is a correctness bug; rebuilding when we could have
 * reused is merely a perf miss. So on ANY doubt (missing turn id, missing hash,
 * malformed/absent previous key) the decision is `reuse: false`.
 *
 * Purity / safety contract:
 *   - ZERO runtime imports (tsx/esbuild-loadable; no react-native/supabase).
 *     No Date.now()/Math.random() at module scope.
 *   - Every export is TOTAL: null / undefined / wrong-type / huge / hostile
 *     (throwing getters, cyclic, Proxies) input never throws — it resolves to a
 *     safe neutral. Output is bounded (fixed-shape key / short string / boolean).
 *   - SECRET-SAFE: the four frozen source values are HASHED (never echoed), so
 *     a secret accidentally routed through `model` / `groundingVersion` /
 *     `toolCatalogSignature` never appears in the key or its string. Only the
 *     non-secret identity fields (circle/user/turn/tier) are echoed; unknown
 *     fields are ignored entirely.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

/** Identity of a reusable frozen-prefix build. */
export interface PromptMemoKey {
  circleId: string;
  userId: string;
  turnId: string;
  tier: string;
  /** Hash of the STABLE inputs only (identity/model/grounding/tool-catalog). */
  frozenInputsHash: string;
}

/**
 * The shape a caller passes to `computePromptMemoKey`. Every field is optional
 * and typed `unknown` because the function is total — it normalizes whatever it
 * gets. The four "frozen" fields feed `frozenInputsHash`; the volatile fields a
 * turn also carries (user message, chat history, live context) are DELIBERATELY
 * absent — passing them is a no-op, which is the whole point: the frozen prefix
 * does not depend on them, so it stays reusable when only they change.
 */
export interface PromptMemoKeyInput {
  circleId?: unknown;
  userId?: unknown;
  turnId?: unknown;
  tier?: unknown;
  // Frozen (cacheable-prefix) inputs — hashed into `frozenInputsHash`:
  agentIdentityId?: unknown;
  model?: unknown;
  groundingVersion?: unknown;
  toolCatalogSignature?: unknown;
}

/** Every reason `decidePromptBuild` can report (stable, secret-free constants). */
export type PromptMemoReason =
  | 'frozen-inputs-match'
  | 'no-previous-build'
  | 'invalid-next-key'
  | 'turn-changed'
  | 'identity-changed'
  | 'tier-changed'
  | 'frozen-inputs-changed';

export interface PromptMemoDecision {
  reuse: boolean;
  reason: string;
}

// ─── Bounds ─────────────────────────────────────────────────────────────────

/** Clamp on any echoed identity field (keeps the key string compact). */
const MAX_KEY_FIELD_CHARS = 512;
/** Clamp on any frozen source field before hashing (bounds hostile huge input). */
const MAX_FROZEN_FIELD_CHARS = 8192;
/**
 * Field separator for the joined key string. The ASCII unit separator (0x1f)
 * essentially never appears in a real id/model/tier, and echoed fields have it
 * stripped, so the join is unambiguous → collision-resistant.
 */
const FIELD_SEP = '\x1f';

// ─── Internal helpers ─────────────────────────────────────────────────────

/** Only genuine non-null objects are indexable; everything else → null. */
function asObject(input: unknown): Record<string, unknown> | null {
  if (input === null || typeof input !== 'object') return null;
  return input as Record<string, unknown>;
}

/**
 * Read a named property, tolerating hostile objects whose getters throw
 * (Proxies, `Object.defineProperty` traps). Never throws → returns undefined.
 */
function readField(obj: Record<string, unknown> | null, key: string): unknown {
  if (!obj) return undefined;
  try {
    return (obj as Record<string, unknown>)[key];
  } catch {
    return undefined;
  }
}

/**
 * Coerce a scalar to a bounded string. Only strings / finite numbers / booleans
 * pass through; objects/functions/symbols/null/undefined/NaN → '' (we never call
 * String()/toString() on arbitrary values so a hostile/cyclic input can't throw).
 */
function coerceScalar(value: unknown, maxChars: number): string {
  let out: string;
  if (typeof value === 'string') out = value;
  else if (typeof value === 'number' && Number.isFinite(value)) out = String(value);
  else if (typeof value === 'boolean') out = value ? 'true' : 'false';
  else return '';
  return out.length > maxChars ? out.slice(0, maxChars) : out;
}

/**
 * Echoed key field: strip the separator so the joined key string can never gain
 * a spurious field boundary, then clamp. Real ids never contain 0x1f, so this
 * is a no-op in practice.
 */
function coerceKeyField(value: unknown): string {
  const s = coerceScalar(value, MAX_KEY_FIELD_CHARS);
  return s.indexOf(FIELD_SEP) >= 0 ? s.split(FIELD_SEP).join('') : s;
}

/** Frozen source field: hashed (not echoed), so no stripping — clamp only. */
function coerceFrozenField(value: unknown): string {
  return coerceScalar(value, MAX_FROZEN_FIELD_CHARS);
}

/**
 * cyrb53 — a fast, deterministic, well-mixed 53-bit string hash. Fixed seed
 * (no Math.random) so the hash is stable across processes. Total for any string.
 */
function cyrb53(str: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Hash the frozen inputs into a compact hex signature. Each field is
 * LENGTH-PREFIXED into the canonical form so no field content can shift a
 * boundary (e.g. model `"a"` + grounding `"bc"` never collides with model
 * `"ab"` + grounding `"c"`), and the raw values never survive into output — only
 * the hex digest does (secret-safe).
 */
function hashFrozenInputs(fields: string[]): string {
  let canonical = 'v1';
  for (const f of fields) canonical += FIELD_SEP + f.length + ':' + f;
  return cyrb53(canonical).toString(16);
}

/**
 * Read the FIVE key fields directly, WITHOUT recomputing the hash — the input
 * here is an already-built `PromptMemoKey`, so its `frozenInputsHash` is honored
 * as-is (re-hashing would clobber it with a hash-of-nothing). Total.
 */
function normalizeKeyFields(input: unknown): PromptMemoKey {
  const obj = asObject(input);
  return {
    circleId: coerceKeyField(readField(obj, 'circleId')),
    userId: coerceKeyField(readField(obj, 'userId')),
    turnId: coerceKeyField(readField(obj, 'turnId')),
    tier: coerceKeyField(readField(obj, 'tier')),
    frozenInputsHash: coerceKeyField(readField(obj, 'frozenInputsHash')),
  };
}

/**
 * A key can only justify REUSE when it pins BOTH the turn and the frozen inputs.
 * Missing either → we can't prove same-turn / same-inputs → fail safe to
 * REBUILD. (Identity fields circle/user may legitimately be '' — e.g. a personal
 * chat with no circle — so they are not part of the validity gate.)
 */
function isReusableValid(key: PromptMemoKey): boolean {
  return key.turnId.length > 0 && key.frozenInputsHash.length > 0;
}

/** Small typed constructor so only known reasons can be emitted. */
function decision(reuse: boolean, reason: PromptMemoReason): PromptMemoDecision {
  return { reuse, reason };
}

// ─── Exports ────────────────────────────────────────────────────────────────

/**
 * Normalize the identifying fields of a turn into a stable, secret-free
 * `PromptMemoKey`. `frozenInputsHash` is derived ONLY from the stable inputs
 * (agent identity id, model, grounding version, tool-catalog signature); the
 * user message / chat history / live context are never read, so a key is
 * invariant to them. Deterministic and total.
 */
export function computePromptMemoKey(input: unknown): PromptMemoKey {
  const obj = asObject(input);
  const frozenInputsHash = hashFrozenInputs([
    coerceFrozenField(readField(obj, 'agentIdentityId')),
    coerceFrozenField(readField(obj, 'model')),
    coerceFrozenField(readField(obj, 'groundingVersion')),
    coerceFrozenField(readField(obj, 'toolCatalogSignature')),
  ]);
  return {
    circleId: coerceKeyField(readField(obj, 'circleId')),
    userId: coerceKeyField(readField(obj, 'userId')),
    turnId: coerceKeyField(readField(obj, 'turnId')),
    tier: coerceKeyField(readField(obj, 'tier')),
    frozenInputsHash,
  };
}

/**
 * A compact, stable, collision-resistant string form of a key — suitable as a
 * Map cache key. Distinct keys map to distinct strings (echoed fields have the
 * separator stripped, so field boundaries are unambiguous). Secret-free: it
 * only echoes the non-secret identity fields plus the hex hash. Total.
 */
export function promptMemoKeyString(key: unknown): string {
  const k = normalizeKeyFields(key);
  return [k.circleId, k.userId, k.turnId, k.tier, k.frozenInputsHash].join(FIELD_SEP);
}

/**
 * Decide whether the frozen prefix from `prevKey` may be reused for `nextKey`,
 * with a telemetry reason. Fail-safe to REBUILD when the next key can't pin the
 * turn+inputs, when there is no valid previous build, or when any identifying
 * field drifted. Total.
 */
export function decidePromptBuild(prevKey: unknown, nextKey: unknown): PromptMemoDecision {
  const next = normalizeKeyFields(nextKey);
  if (!isReusableValid(next)) return decision(false, 'invalid-next-key');
  const prev = normalizeKeyFields(prevKey);
  if (!isReusableValid(prev)) return decision(false, 'no-previous-build');
  if (prev.turnId !== next.turnId) return decision(false, 'turn-changed');
  if (prev.circleId !== next.circleId || prev.userId !== next.userId) {
    return decision(false, 'identity-changed');
  }
  if (prev.tier !== next.tier) return decision(false, 'tier-changed');
  if (prev.frozenInputsHash !== next.frozenInputsHash) {
    return decision(false, 'frozen-inputs-changed');
  }
  return decision(true, 'frozen-inputs-match');
}

/**
 * True iff the frozen inputs are identical (same circle/user/turn/tier/hash) →
 * the cached frozen prefix may be reused; any drift → rebuild. Delegates to
 * `decidePromptBuild` so the boolean and the reason can never disagree. Total.
 */
export function shouldReuseFrozenPrefix(prevKey: unknown, nextKey: unknown): boolean {
  return decidePromptBuild(prevKey, nextKey).reuse;
}
