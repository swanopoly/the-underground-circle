/**
 * memoryTurnAssemblyCore — the pure "assemble the turn's memory ONCE" planner.
 *
 * DE-RISKS: docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md → IMPROVE #3
 * ("Collapse the redundant per-turn memory path"). Today a single chat turn
 * embeds + ranks the query TWICE:
 *
 *   swanbot.ts buildSystemPromptAsync:
 *     • loadMemory task  → buildOpenSwanMemoryStores → buildPromptMemoryBundle,
 *                          which ALREADY runs loadStartupMemory +
 *                          loadSoulWisdomWithFallback + retrieveForTurn
 *                          (memoryService.ts:1139-1196).
 *     • loadWisdom task  → loadSoulWisdomWithFallback  ── AGAIN.
 *     • loadRetrieval    → retrieveForTurn             ── AGAIN (2nd embed+rank).
 *
 * The two standalone passes duplicate work the stores bundle already did — a
 * double embed+rank on every non-trivial turn. This core is the single decision
 * that eliminates the duplication: given the turn's complexity, whether the
 * caller already PRE-RESOLVED the stores bundle, whether there is a query to
 * retrieve for, and the /context depth dial, it decides which memory passes run
 * THIS turn WITHOUT running any pass twice. When the pre-resolved bundle is
 * present it already carries startup + retrieval + wisdom, so the standalone
 * retrieval/wisdom passes are SUPPRESSED (`reuseFromStores`).
 *
 * The pass gating mirrors the live policy so wiring is "consult the plan", not
 * "re-derive the tiers":
 *   - resolveChatPromptContextPolicy (chatPromptAssembly.ts:84): trivial loads
 *     no memory; simple+ load memory+retrieval; moderate/complex add wisdom.
 *   - applyContextDepthToPolicy (contextDepthPolicy.ts:128): 'max' floors to
 *     complex + loads every family; 'lean' drops the wisdom pass; 'standard'
 *     is identity.
 *
 * PURITY: zero imports; no Date.now()/Math.random(); every export TOTAL
 * (null / undefined / wrong-type / huge / hostile / cyclic → safe neutral,
 * never throws); bounded; secret-safe (the reason echoes only normalized enum
 * values, never caller content).
 */

// Mirrors ChatPromptComplexity (src/lib/chatPromptAssembly.ts) — redeclared
// locally so this core stays dependency-light (loadable under tsx). Structurally
// identical; keep in lockstep if the canonical union changes.
export type MemoryTurnComplexity = 'trivial' | 'simple' | 'moderate' | 'complex';
// Mirrors ChatContextDepth (src/lib/contextDepthPolicy.ts).
export type MemoryTurnContextDepth = 'lean' | 'standard' | 'max';

export interface MemoryTurnPlanInput {
  /** 'trivial' | 'simple' | 'moderate' | 'complex'. Unknown/garbage → 'moderate'. */
  complexity?: unknown;
  /**
   * The caller already resolved the OpenSwanMemoryStores bundle
   * (`context.memoryStores`) — that bundle already ran startup + retrieval +
   * wisdom, so the standalone passes must be suppressed.
   */
  hasMemoryStores?: unknown;
  /**
   * Is there a non-empty query to embed+rank this turn? Retrieval needs one;
   * startup/wisdom do not. A raw query string is accepted (empty/whitespace →
   * no query). Omitted → assumed present (the common case is a real message).
   */
  hasQuery?: unknown;
  /** 'lean' | 'standard' | 'max'. 'max' floors complexity to 'complex'; 'lean' drops wisdom. */
  contextDepth?: unknown;
}

export interface MemoryTurnPlan {
  /** The memory-stores bundle is present this turn (built fresh or reused). */
  loadStartupBundle: boolean;
  /** Run retrieveForTurn as a distinct standalone pass (only when NOT reusing). */
  loadTurnRetrieval: boolean;
  /** Run soul-wisdom as a distinct standalone pass (only when NOT reusing). */
  loadSoulWisdom: boolean;
  /**
   * Retrieval + wisdom are satisfied by a pre-resolved bundle, so the standalone
   * passes were suppressed. This is the anti-duplication guarantee: whenever
   * true, loadTurnRetrieval and loadSoulWisdom are both false.
   */
  reuseFromStores: boolean;
  /** Short, bounded, secret-safe explanation of the decision. */
  reason: string;
}

const COMPLEXITIES: readonly MemoryTurnComplexity[] = ['trivial', 'simple', 'moderate', 'complex'];

/** Cap on the reason string — it is built from constants, but stay bounded. */
const MAX_REASON_CHARS = 200;

function normalizeComplexity(value: unknown): MemoryTurnComplexity {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if ((COMPLEXITIES as readonly string[]).indexOf(v) !== -1) {
      return v as MemoryTurnComplexity;
    }
  }
  // Mirrors swanbot's `route?.complexity || 'moderate'` default.
  return 'moderate';
}

function normalizeDepth(value: unknown): MemoryTurnContextDepth {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (v === 'max' || v === 'maximum' || v === 'full' || v === 'high' || v === 'deep' || v === 'all' || v === 'everything') {
      return 'max';
    }
    if (v === 'lean' || v === 'minimal' || v === 'min' || v === 'low' || v === 'light' || v === 'fast') {
      return 'lean';
    }
  }
  return 'standard';
}

/** Present-ish coercion for `hasMemoryStores` — the actual stores object, a
 *  boolean flag, or a truthy scalar all count as "present". */
function coercePresent(value: unknown): boolean {
  if (value === true) return true;
  if (value === false || value === null || value === undefined) return false;
  const t = typeof value;
  if (t === 'number') return Number.isFinite(value as number) && (value as number) !== 0;
  if (t === 'bigint') return (value as bigint) !== BigInt(0);
  if (t === 'string') {
    const v = (value as string).trim().toLowerCase();
    if (v === '' || v === 'false' || v === '0' || v === 'no' || v === 'off' || v === 'null' || v === 'undefined' || v === 'nan') {
      return false;
    }
    return true;
  }
  // Non-null object / array / function / symbol → treat as present.
  return true;
}

/** Query presence — omitted defaults to present; empty/whitespace strings are
 *  explicitly "no query". */
function coerceHasQuery(value: unknown): boolean {
  if (value === undefined) return true;
  if (typeof value === 'string') return value.trim().length > 0;
  return coercePresent(value);
}

function clampReason(reason: string): string {
  if (typeof reason !== 'string') return '';
  return reason.length > MAX_REASON_CHARS ? reason.slice(0, MAX_REASON_CHARS) : reason;
}

/**
 * Decide which memory passes run THIS turn, with no pass running twice.
 *
 * Contract:
 *   - trivial (or a turn floored to nothing) → no memory passes at all.
 *   - a pre-resolved stores bundle → reuse it; SUPPRESS the standalone
 *     retrieval/wisdom passes (they already ran inside the bundle).
 *   - otherwise → run each applicable pass standalone, once, gated by
 *     complexity + the depth dial.
 *
 * Always returns a fully-populated plan; never throws.
 */
export function planMemoryTurnLoad(input: MemoryTurnPlanInput): MemoryTurnPlan {
  let complexity: MemoryTurnComplexity = 'moderate';
  let depth: MemoryTurnContextDepth = 'standard';
  let hasStores = false;
  let hasQuery = true;

  try {
    const src: MemoryTurnPlanInput =
      input && typeof input === 'object' ? input : ({} as MemoryTurnPlanInput);
    complexity = normalizeComplexity(src.complexity);
    depth = normalizeDepth(src.contextDepth);
    hasStores = coercePresent(src.hasMemoryStores);
    hasQuery = coerceHasQuery(src.hasQuery);
  } catch {
    // Hostile getter / proxy that throws on property access → fail closed to a
    // lean, safe plan rather than propagating.
    return {
      loadStartupBundle: false,
      loadTurnRetrieval: false,
      loadSoulWisdom: false,
      reuseFromStores: false,
      reason: 'error: input inspection failed — no memory passes',
    };
  }

  // Context-depth 'max' floors the turn to 'complex' (load every family) —
  // mirrors resolveContextDepthComplexityFloor. 'lean'/'standard' do not raise
  // the tier (lean only caps budgets + drops wisdom, handled below).
  if (depth === 'max') complexity = 'complex';

  // Trivial turns are deliberately lean (greeting / ack / yes-no): no memory
  // work at all, even if a bundle happens to be pre-resolved.
  if (complexity === 'trivial') {
    return {
      loadStartupBundle: false,
      loadTurnRetrieval: false,
      loadSoulWisdom: false,
      reuseFromStores: false,
      reason: 'trivial: no memory passes this turn',
    };
  }

  // COLLAPSE (the fix): a pre-resolved stores bundle already ran startup +
  // soul-wisdom + retrieveForTurn (buildPromptMemoryBundle). Reuse it and
  // SUPPRESS the standalone retrieval/wisdom passes so the query is not
  // embedded + ranked a second time.
  if (hasStores) {
    return {
      loadStartupBundle: true,
      loadTurnRetrieval: false,
      loadSoulWisdom: false,
      reuseFromStores: true,
      reason: clampReason(
        'reuse-stores: pre-resolved bundle carries startup+retrieval+wisdom; standalone retrieval/wisdom suppressed (no double embed+rank)',
      ),
    };
  }

  // No pre-resolved bundle — run each applicable pass STANDALONE, once, gated by
  // complexity (resolveChatPromptContextPolicy) then transformed by the depth
  // dial (applyContextDepthToPolicy). complexity is guaranteed non-trivial here,
  // so loadMemory + loadRetrieval are on; wisdom is moderate/complex only.
  let wantWisdom = complexity === 'moderate' || complexity === 'complex';
  // 'lean' drops the wisdom pass (keeps memory + retrieval); 'max' already
  // floored to complex so wisdom is on; 'standard' is identity.
  if (depth === 'lean') wantWisdom = false;

  const loadTurnRetrieval = hasQuery;
  const loadSoulWisdom = wantWisdom;

  return {
    loadStartupBundle: true,
    loadTurnRetrieval,
    loadSoulWisdom,
    reuseFromStores: false,
    reason: clampReason(
      `standalone: complexity=${complexity} depth=${depth} → startup=true retrieval=${loadTurnRetrieval} wisdom=${loadSoulWisdom} (each once)`,
    ),
  };
}
