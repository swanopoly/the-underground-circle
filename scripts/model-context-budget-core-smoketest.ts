/**
 * model-context-budget-core-smoketest — src/lib/modelContextBudgetCore.ts, the
 * window-aware scaler for the chat prompt's extras char budget. Load-bearing
 * assertions:
 *
 *   WINDOW LOOKUP: getModelContextWindow resolves known bare ids, normalizes
 *   provider/vendor-prefixed ids to the same window, falls back by family for
 *   dated snapshots, and returns null for unknown / non-string input.
 *
 *   IDENTITY (no regression): resolveModelContextBudget returns the SAME policy
 *   object when the window is null/unknown, sits in the ~32k–400k default band
 *   the fixed budgets already assume, or when scaling would move nothing —
 *   so today's default models (Claude 200k, GPT-4o 128k) get byte-identical
 *   prompts.
 *
 *   SCALE UP: a 1M-window model gets a strictly larger extras/retrieval budget,
 *   never below the incoming policy, never above the sane cap.
 *
 *   SCALE DOWN: an 8k-window model gets a strictly smaller budget, floored so a
 *   turn is never starved to nothing.
 *
 *   FIT-IN-WINDOW: a huge base prompt bounds how much of the window the extras
 *   may claim (relational — big base yields a smaller budget than small base).
 *
 *   COHERENCE + TOTALITY: boolean policy fields survive verbatim, numeric
 *   fields stay positive integers, and every export is total on hostile input.
 *
 * Pure — loads under tsx (modelContextBudgetCore + chatPromptAssembly are both
 * dependency-light pure modules).
 */

import {
  MODEL_CONTEXT_WINDOWS,
  getModelContextWindow,
  resolveModelContextBudget,
  LARGE_WINDOW_TOKENS,
  SMALL_WINDOW_TOKENS,
} from '../src/lib/modelContextBudgetCore';
import {
  resolveChatPromptContextPolicy,
  type ChatPromptComplexity,
  type ChatPromptContextPolicy,
} from '../src/lib/chatPromptAssembly';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else { failures += 1; console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`); }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}
function noThrow(fn: () => unknown, msg: string): void {
  try { fn(); passes += 1; }
  catch (e) { failures += 1; console.error(`FAIL: ${msg} :: threw ${String(e)}`); }
}

const TIERS: ChatPromptComplexity[] = ['trivial', 'simple', 'moderate', 'complex'];
const win = (id: unknown): number | null => getModelContextWindow(id);

function main(): void {
  // ─── (1) known exact windows ──────────────────────────────────────────────
  assertEq(win('claude-opus-4-8'), 200_000, '(1) claude-opus-4-8 → 200k');
  assertEq(win('claude-sonnet-4-6'), 200_000, '(1) claude-sonnet-4-6 → 200k');
  assertEq(win('gpt-4o'), 128_000, '(1) gpt-4o → 128k');
  assertEq(win('gpt-4.1'), 1_000_000, '(1) gpt-4.1 → 1M');
  assertEq(win('gemini-2.5-pro'), 1_000_000, '(1) gemini-2.5-pro → 1M');
  assertEq(win('gemini-1.5-pro'), 2_000_000, '(1) gemini-1.5-pro → 2M');
  assertEq(win('deepseek-v3'), 128_000, '(1) deepseek-v3 → 128k');
  assertEq(win('llama-3-8b'), 8_000, '(1) llama-3-8b → 8k');
  assertEq(win('gpt-3.5-turbo'), 16_000, '(1) gpt-3.5-turbo → 16k');
  assertEq(win('mistral-small'), 32_000, '(1) mistral-small → 32k');
  assertEq(win('gpt-5.5-pro'), 400_000, '(1) gpt-5.5-pro → 400k');
  assertEq(win('cswan801/blackswan-v5'), 32_000, '(1) blackswan-v5 → 32k');
  // Every table value is a positive finite number (data-integrity guard).
  for (const [id, w] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    assert(typeof w === 'number' && Number.isFinite(w) && w > 0, `(1) table window sane for ${id}`, String(w));
  }

  // ─── (2) provider/vendor-prefix normalization ─────────────────────────────
  assertEq(win('openrouter/anthropic/claude-sonnet-4-6'), 200_000, '(2) openrouter/anthropic prefix strips');
  assertEq(win('google_ai/gemini-2.5-pro'), 1_000_000, '(2) google_ai prefix strips');
  assertEq(win('huggingface_endpoint/cswan801/BlackSwan-v5'), 32_000, '(2) hf_endpoint + case-insensitive');
  assertEq(win('hugging_face/cswan801/blackswan-v5'), 32_000, '(2) hugging_face alias head');
  assertEq(win('openai/gpt-4o'), 128_000, '(2) openai prefix strips');
  assertEq(win('deepseek/deepseek-r1'), 128_000, '(2) deepseek prefix strips');
  assertEq(win('  GPT-4O  '), 128_000, '(2) trim + lowercase');

  // ─── (3) family fallbacks (dated snapshots / variants) ────────────────────
  assertEq(win('claude-opus-4-9-20990101'), 200_000, '(3) claude family fallback');
  assertEq(win('gemini-2.9-pro'), 1_000_000, '(3) gemini family fallback');
  assertEq(win('gemini-1.5-flash-002'), 2_000_000, '(3) gemini-1.5 family → 2M');
  assertEq(win('gpt-4.1-turbo-2030'), 1_000_000, '(3) gpt-4.1 family fallback');
  assertEq(win('gpt-5-ultra'), 400_000, '(3) gpt-5 family fallback');
  assertEq(win('llama-4-scout-instruct'), 1_000_000, '(3) llama-4 family fallback');
  assertEq(win('llama-2-13b'), 4_000, '(3) llama-2 family → 4k');
  assertEq(win('mixtral-8x7b-instruct'), 32_000, '(3) mixtral family → 32k (before mistral)');
  assertEq(win('qwen-9-max'), 128_000, '(3) qwen family fallback');
  assertEq(win('o3-pro'), 200_000, '(3) o-series family fallback');

  // ─── (4) unknown / non-string → null ──────────────────────────────────────
  assertEq(win('totally-unknown-model-xyz'), null, '(4) unknown id → null');
  assertEq(win(''), null, '(4) empty string → null');
  assertEq(win('   '), null, '(4) whitespace → null');
  assertEq(win(null), null, '(4) null → null');
  assertEq(win(undefined), null, '(4) undefined → null');
  assertEq(win(42 as unknown), null, '(4) number → null');
  assertEq(win({} as unknown), null, '(4) object → null');
  assertEq(win([] as unknown), null, '(4) array → null');
  assertEq(win(true as unknown), null, '(4) boolean → null');

  // ─── (5) unknown window → identity (same object) ──────────────────────────
  for (const tier of TIERS) {
    const p = resolveChatPromptContextPolicy(tier);
    assert(resolveModelContextBudget(p, { modelContextWindow: null }) === p, `(5) null window → same object (${tier})`);
    assert(resolveModelContextBudget(p, { modelContextWindow: win('unknown-model') }) === p, `(5) unknown lookup → same object (${tier})`);
  }
  {
    const p = resolveChatPromptContextPolicy('complex');
    assert(resolveModelContextBudget(p, {}) === p, '(5) missing window key → same object');
    assert(resolveModelContextBudget(p, { modelContextWindow: 0 }) === p, '(5) zero window → same object');
    assert(resolveModelContextBudget(p, { modelContextWindow: -5 }) === p, '(5) negative window → same object');
  }

  // ─── (6) middle "default" band → identity (no regression) ─────────────────
  for (const tier of TIERS) {
    const p = resolveChatPromptContextPolicy(tier);
    assert(resolveModelContextBudget(p, { modelContextWindow: 200_000 }) === p, `(6) 200k (Claude) → same object (${tier})`);
    assert(resolveModelContextBudget(p, { modelContextWindow: 128_000 }) === p, `(6) 128k (GPT-4o) → same object (${tier})`);
  }
  {
    const p = resolveChatPromptContextPolicy('moderate');
    assert(resolveModelContextBudget(p, { modelContextWindow: 150_000 }) === p, '(6) 150k mid-band → same object');
    assert(resolveModelContextBudget(p, { modelContextWindow: win('claude-opus-4-8') }) === p, '(6) fed from lookup, mid-band → identity');
  }

  // ─── (7) large window → strictly larger budget ────────────────────────────
  {
    const p = resolveChatPromptContextPolicy('complex');
    const scaled = resolveModelContextBudget(p, { modelContextWindow: 1_000_000 });
    assert(scaled !== p, '(7) 1M window → NEW object');
    assert(scaled.maxExtrasChars > p.maxExtrasChars, '(7) 1M raises extras budget', `${scaled.maxExtrasChars} vs ${p.maxExtrasChars}`);
    assert(scaled.retrievalBudget > p.retrievalBudget, '(7) 1M raises retrieval budget');
    assert(scaled.retrievalCount > p.retrievalCount, '(7) 1M raises retrieval count');
    assert(scaled.maxExtrasChars <= 48_000, '(7) extras stays under the sane cap');
    assert(scaled.retrievalBudget <= 15_000, '(7) retrieval budget stays under the sane cap');
    assert(scaled.retrievalCount <= 40, '(7) retrieval count stays under the sane cap');
    // 400k (threshold) still scales up, but less than 1M.
    const at400 = resolveModelContextBudget(p, { modelContextWindow: LARGE_WINDOW_TOKENS });
    assert(at400 !== p && at400.maxExtrasChars > p.maxExtrasChars, '(7) 400k threshold scales up');
    assert(at400.maxExtrasChars <= scaled.maxExtrasChars, '(7) 400k boost ≤ 1M boost');
    // Fed straight from the lookup (the wiring shape).
    const geminiScaled = resolveModelContextBudget(p, { modelContextWindow: win('gemini-2.5-pro') });
    assert(geminiScaled.maxExtrasChars > p.maxExtrasChars, '(7) gemini-2.5-pro (lookup) scales up');
  }

  // ─── (8) small window → strictly smaller budget (floored) ─────────────────
  {
    const p = resolveChatPromptContextPolicy('complex');
    const scaled = resolveModelContextBudget(p, { modelContextWindow: 8_000 });
    assert(scaled !== p, '(8) 8k window → NEW object');
    assert(scaled.maxExtrasChars < p.maxExtrasChars, '(8) 8k reduces extras budget', `${scaled.maxExtrasChars} vs ${p.maxExtrasChars}`);
    assert(scaled.retrievalBudget < p.retrievalBudget, '(8) 8k reduces retrieval budget');
    assert(scaled.maxExtrasChars >= 800, '(8) extras floored (never starved)');
    assert(scaled.retrievalBudget >= 400, '(8) retrieval budget floored');
    assert(scaled.retrievalCount >= 1, '(8) retrieval count floored to ≥ 1');
    // 16k reduces less aggressively than 8k; 32k (boundary) reduces least.
    const at16 = resolveModelContextBudget(p, { modelContextWindow: 16_000 });
    const at32 = resolveModelContextBudget(p, { modelContextWindow: SMALL_WINDOW_TOKENS });
    assert(at16.maxExtrasChars < p.maxExtrasChars, '(8) 16k reduces extras');
    assert(at32.maxExtrasChars < p.maxExtrasChars, '(8) 32k boundary reduces extras');
    assert(scaled.maxExtrasChars <= at16.maxExtrasChars, '(8) 8k ≤ 16k budget');
    assert(at16.maxExtrasChars <= at32.maxExtrasChars, '(8) 16k ≤ 32k budget');
  }

  // ─── (9) no-regression + cap identity ─────────────────────────────────────
  {
    // A policy already richer than our up-scale target keeps its larger budget.
    const big: ChatPromptContextPolicy = { ...resolveChatPromptContextPolicy('complex'), maxExtrasChars: 50_000 };
    const scaled = resolveModelContextBudget(big, { modelContextWindow: 1_000_000 });
    assert(scaled.maxExtrasChars >= 50_000, '(9) up-scale never lowers a larger incoming extras', String(scaled.maxExtrasChars));
    // A policy already pinned at every cap → nothing to move → identity.
    const atCaps: ChatPromptContextPolicy = {
      ...resolveChatPromptContextPolicy('complex'),
      maxExtrasChars: 48_000,
      retrievalBudget: 15_000,
      retrievalCount: 40,
    };
    assert(resolveModelContextBudget(atCaps, { modelContextWindow: 1_000_000 }) === atCaps, '(9) already at caps → same object');
    // On the down path, an already-tiny policy that can't shrink further is identity-safe.
    const tiny: ChatPromptContextPolicy = {
      ...resolveChatPromptContextPolicy('trivial'),
      maxExtrasChars: 800,
      retrievalBudget: 400,
      retrievalCount: 1,
    };
    const tinyScaled = resolveModelContextBudget(tiny, { modelContextWindow: 8_000 });
    assert(tinyScaled.maxExtrasChars <= 800 && tinyScaled.maxExtrasChars >= 1, '(9) tiny down-path never raises');
  }

  // ─── (10) fit-in-window: base prompt bounds the extras (relational) ────────
  {
    const p = resolveChatPromptContextPolicy('complex');
    // Same 1M window, tiny vs enormous base prompt.
    const smallBase = resolveModelContextBudget(p, { modelContextWindow: 1_000_000, approxBasePromptChars: 2_000 });
    const hugeBase = resolveModelContextBudget(p, { modelContextWindow: 1_000_000, approxBasePromptChars: 3_965_000 });
    assert(hugeBase.maxExtrasChars <= smallBase.maxExtrasChars, '(10) huge base ≤ small base extras (1M window)', `${hugeBase.maxExtrasChars} vs ${smallBase.maxExtrasChars}`);
    assert(hugeBase.maxExtrasChars >= p.maxExtrasChars, '(10) …but still no regression below incoming');
    // Small window, base nearly fills it → extras driven to the floor.
    const smallWinBigBase = resolveModelContextBudget(p, { modelContextWindow: 8_000, approxBasePromptChars: 30_000 });
    const smallWinNoBase = resolveModelContextBudget(p, { modelContextWindow: 8_000, approxBasePromptChars: 0 });
    assert(smallWinBigBase.maxExtrasChars <= smallWinNoBase.maxExtrasChars, '(10) small window: big base ≤ no base');
    assert(smallWinBigBase.maxExtrasChars >= 800, '(10) small window big base still floored');
  }

  // ─── (11) coherence: booleans preserved, numbers positive integers ────────
  {
    for (const tier of TIERS) {
      const p = resolveChatPromptContextPolicy(tier);
      for (const w of [1_000_000, 8_000, 400_000, 16_000]) {
        const r = resolveModelContextBudget(p, { modelContextWindow: w });
        assertEq(r.loadProfile, p.loadProfile, `(11) loadProfile preserved (${tier}/${w})`);
        assertEq(r.loadMemory, p.loadMemory, `(11) loadMemory preserved (${tier}/${w})`);
        assertEq(r.loadWisdom, p.loadWisdom, `(11) loadWisdom preserved (${tier}/${w})`);
        assertEq(r.loadRetrieval, p.loadRetrieval, `(11) loadRetrieval preserved (${tier}/${w})`);
        assertEq(r.loadMissions, p.loadMissions, `(11) loadMissions preserved (${tier}/${w})`);
        assertEq(r.loadSkills, p.loadSkills, `(11) loadSkills preserved (${tier}/${w})`);
        assert(Number.isInteger(r.maxExtrasChars) && r.maxExtrasChars > 0, `(11) extras positive int (${tier}/${w})`, String(r.maxExtrasChars));
        assert(Number.isInteger(r.retrievalBudget) && r.retrievalBudget > 0, `(11) budget positive int (${tier}/${w})`);
        assert(Number.isInteger(r.retrievalCount) && r.retrievalCount >= 1, `(11) count positive int (${tier}/${w})`);
        assert(r.maxExtrasChars >= r.retrievalBudget, `(11) extras ≥ retrieval budget (${tier}/${w})`, `${r.maxExtrasChars} vs ${r.retrievalBudget}`);
      }
    }
  }

  // ─── (12) degenerate / hostile input — no throw, safe neutral ─────────────
  const p0 = resolveChatPromptContextPolicy('complex');
  // Non-object policies pass straight through (identity), never throw.
  assertEq(resolveModelContextBudget(null as unknown as ChatPromptContextPolicy, { modelContextWindow: 1_000_000 }), null, '(12) null policy passes through');
  assertEq(resolveModelContextBudget(undefined as unknown as ChatPromptContextPolicy, { modelContextWindow: 8_000 }), undefined, '(12) undefined policy passes through');
  assertEq(resolveModelContextBudget(42 as unknown as ChatPromptContextPolicy, { modelContextWindow: 1_000_000 }), 42, '(12) number policy passes through');
  assertEq(resolveModelContextBudget('nope' as unknown as ChatPromptContextPolicy, { modelContextWindow: 1_000_000 }), 'nope', '(12) string policy passes through');
  noThrow(() => resolveModelContextBudget(p0, null as unknown as { modelContextWindow?: number }), '(12) null opts');
  noThrow(() => resolveModelContextBudget(p0, undefined as unknown as { modelContextWindow?: number }), '(12) undefined opts');
  noThrow(() => resolveModelContextBudget(p0, { modelContextWindow: '1000000' as unknown as number }), '(12) string window');
  noThrow(() => resolveModelContextBudget(p0, { modelContextWindow: NaN }), '(12) NaN window');
  noThrow(() => resolveModelContextBudget(p0, { modelContextWindow: Infinity }), '(12) Infinity window');
  noThrow(() => resolveModelContextBudget(p0, { modelContextWindow: -Infinity }), '(12) -Infinity window');
  noThrow(() => resolveModelContextBudget(p0, { modelContextWindow: 1e18 }), '(12) astronomically huge window');
  noThrow(() => resolveModelContextBudget(p0, { modelContextWindow: 1_000_000, approxBasePromptChars: -500 }), '(12) negative base chars');
  noThrow(() => resolveModelContextBudget(p0, { modelContextWindow: 1_000_000, approxBasePromptChars: NaN }), '(12) NaN base chars');
  noThrow(() => resolveModelContextBudget(p0, { modelContextWindow: 8_000, approxBasePromptChars: 1e18 }), '(12) huge base chars');
  noThrow(() => resolveModelContextBudget(p0, { modelContextWindow: {} as unknown as number }), '(12) object window');
  noThrow(() => resolveModelContextBudget({ ...p0, maxExtrasChars: NaN } as ChatPromptContextPolicy, { modelContextWindow: 1_000_000 }), '(12) NaN policy field');
  noThrow(() => resolveModelContextBudget({} as ChatPromptContextPolicy, { modelContextWindow: 1_000_000 }), '(12) empty-object policy');
  noThrow(() => getModelContextWindow(Symbol('x') as unknown), '(12) symbol id');
  noThrow(() => getModelContextWindow(NaN as unknown), '(12) NaN id');
  noThrow(() => getModelContextWindow({ toString() { throw new Error('boom'); } } as unknown), '(12) hostile toString id');
  // Astronomically huge window is treated as large (scale up) and stays capped.
  {
    const r = resolveModelContextBudget(p0, { modelContextWindow: 1e18 });
    assert(r.maxExtrasChars <= 48_000, '(12) huge window still capped');
    assert(Number.isInteger(r.maxExtrasChars), '(12) huge window yields integer extras');
  }
  // A hostile NaN policy field must not crash and must produce a finite number.
  {
    const r = resolveModelContextBudget({ ...p0, maxExtrasChars: NaN } as ChatPromptContextPolicy, { modelContextWindow: 1_000_000 });
    assert(Number.isFinite(r.maxExtrasChars), '(12) NaN field repaired to finite');
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s), ${passes} passed`);
    process.exit(1);
  }
  console.log(`\nAll model-context-budget-core smoke cases passed (${passes} passed).`);
}

main();
