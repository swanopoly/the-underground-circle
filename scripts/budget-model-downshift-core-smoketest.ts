/**
 * budget-model-downshift-core-smoketest — the PURE budget-guard brain for Auto
 * model routing (src/lib/budgetModelDownshiftCore.ts). Load-bearing assertions:
 *   classifySpendLevel — <0.7 ok / [0.7,0.95) warn / >=0.95 critical, boundaries
 *     exact; missing/invalid/non-positive cap → 'ok' (FAIL-OPEN, guard off);
 *     unreadable/negative spend → treated as 0 (no alarm);
 *   inferDownshiftTier — cheap-first tiering (mini/nano/flash beat family rules);
 *   downshiftForBudget — 'ok' identity; warn = one tier down (opus→sonnet);
 *     critical = cheapest (opus→haiku, sonnet→haiku); unknown/already-cheapest =
 *     strict IDENTITY no-op; reason never echoes the raw model id;
 *   and every export never throws on null/undefined/number/huge/hostile input.
 *
 * Pure — loads under tsx (budgetModelDownshiftCore has zero runtime imports).
 * Run: npx tsx scripts/budget-model-downshift-core-smoketest.ts
 */

import {
  classifySpendLevel,
  downshiftForBudget,
  inferDownshiftTier,
  MODEL_DOWNSHIFT_TIERS,
  SPEND_WARN_RATIO,
  SPEND_CRITICAL_RATIO,
  type SpendAlertLevel,
} from '../src/lib/budgetModelDownshiftCore';

let passes = 0;
let failures = 0;
function assert(cond: unknown, msg: string, extra?: string): void {
  if (cond) passes += 1;
  else {
    failures += 1;
    console.error(`FAIL: ${msg}${extra ? ` :: ${extra}` : ''}`);
  }
}
function assertEq(a: unknown, b: unknown, msg: string): void {
  assert(a === b, msg, `got ${JSON.stringify(a)} want ${JSON.stringify(b)}`);
}

function main(): void {
  // ─── (1) classifySpendLevel — ratio thresholds + exact boundaries ──────────
  assertEq(classifySpendLevel({ spentUsd: 0, capUsd: 100 }), 'ok', '(1) zero spend → ok');
  assertEq(classifySpendLevel({ spentUsd: 50, capUsd: 100 }), 'ok', '(1) 0.50 ratio → ok');
  assertEq(classifySpendLevel({ spentUsd: 69.99, capUsd: 100 }), 'ok', '(1) just under 0.70 → ok');
  assertEq(classifySpendLevel({ spentUsd: 70, capUsd: 100 }), 'warn', '(1) exactly 0.70 → warn');
  assertEq(classifySpendLevel({ spentUsd: 80, capUsd: 100 }), 'warn', '(1) 0.80 ratio → warn');
  assertEq(classifySpendLevel({ spentUsd: 94.99, capUsd: 100 }), 'warn', '(1) just under 0.95 → warn');
  assertEq(classifySpendLevel({ spentUsd: 95, capUsd: 100 }), 'critical', '(1) exactly 0.95 → critical');
  assertEq(classifySpendLevel({ spentUsd: 100, capUsd: 100 }), 'critical', '(1) at cap → critical');
  assertEq(classifySpendLevel({ spentUsd: 250, capUsd: 100 }), 'critical', '(1) over cap → critical');
  // Boundary constants are the ones documented.
  assertEq(SPEND_WARN_RATIO, 0.7, '(1) warn ratio constant');
  assertEq(SPEND_CRITICAL_RATIO, 0.95, '(1) critical ratio constant');
  // Small caps still classify by ratio, not absolute dollars.
  assertEq(classifySpendLevel({ spentUsd: 8, capUsd: 10 }), 'warn', '(1) $8/$10 → warn');
  assertEq(classifySpendLevel({ spentUsd: 9.6, capUsd: 10 }), 'critical', '(1) $9.60/$10 → critical');

  // ─── (2) classifySpendLevel — missing / invalid cap → ok (FAIL-OPEN) ───────
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: undefined }), 'ok', '(2) undefined cap → ok');
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: null }), 'ok', '(2) null cap → ok');
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: 0 }), 'ok', '(2) zero cap → ok (no div-by-zero)');
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: -100 }), 'ok', '(2) negative cap → ok');
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: NaN }), 'ok', '(2) NaN cap → ok');
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: Infinity }), 'ok', '(2) Infinity cap → ok');
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: 'abc' }), 'ok', '(2) non-numeric-string cap → ok');
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: '' }), 'ok', '(2) empty-string cap → ok');
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: {} }), 'ok', '(2) object cap → ok');
  assertEq(classifySpendLevel({ spentUsd: 999, capUsd: true }), 'ok', '(2) boolean cap → ok');

  // ─── (3) classifySpendLevel — spend coercion + numeric strings ─────────────
  assertEq(classifySpendLevel({ spentUsd: undefined, capUsd: 100 }), 'ok', '(3) missing spend → 0 → ok');
  assertEq(classifySpendLevel({ spentUsd: null, capUsd: 100 }), 'ok', '(3) null spend → 0 → ok');
  assertEq(classifySpendLevel({ spentUsd: -50, capUsd: 100 }), 'ok', '(3) negative spend → 0 → ok');
  assertEq(classifySpendLevel({ spentUsd: NaN, capUsd: 100 }), 'ok', '(3) NaN spend → 0 → ok');
  assertEq(classifySpendLevel({ spentUsd: Infinity, capUsd: 100 }), 'ok', '(3) Infinity spend → 0 → ok');
  assertEq(classifySpendLevel({ spentUsd: 'not-a-number', capUsd: 100 }), 'ok', '(3) junk-string spend → 0 → ok');
  // numeric strings accepted (bad JSON courtesy).
  assertEq(classifySpendLevel({ spentUsd: '80', capUsd: '100' }), 'warn', '(3) numeric-string spend+cap → warn');
  assertEq(classifySpendLevel({ spentUsd: '96', capUsd: '100' }), 'critical', '(3) numeric-string → critical');
  assertEq(classifySpendLevel({ spentUsd: ' 60 ', capUsd: 100 }), 'ok', '(3) whitespace-padded numeric string → ok');

  // ─── (4) MODEL_DOWNSHIFT_TIERS shape + inferDownshiftTier (cheap-first) ─────
  assertEq(MODEL_DOWNSHIFT_TIERS.length, 3, '(4) three tiers');
  assertEq(MODEL_DOWNSHIFT_TIERS[0].tier, 'frontier', '(4) index 0 = frontier');
  assertEq(MODEL_DOWNSHIFT_TIERS[1].tier, 'strong', '(4) index 1 = strong');
  assertEq(MODEL_DOWNSHIFT_TIERS[2].tier, 'fast', '(4) index 2 = fast (cheapest)');
  assertEq(MODEL_DOWNSHIFT_TIERS[1].target, 'claude-sonnet-4-6', '(4) strong target = sonnet');
  assertEq(MODEL_DOWNSHIFT_TIERS[2].target, 'claude-haiku-4-5', '(4) fast target = haiku');
  // frontier ids
  assertEq(inferDownshiftTier('claude-opus-4-8'), 0, '(4) opus → frontier');
  assertEq(inferDownshiftTier('claude-fable-5'), 0, '(4) fable → frontier');
  assertEq(inferDownshiftTier('openai/gpt-5.5'), 0, '(4) gpt-5.5 → frontier');
  assertEq(inferDownshiftTier('openrouter/openai/gpt-5.5'), 0, '(4) OR gpt-5.5 → frontier');
  // strong ids
  assertEq(inferDownshiftTier('claude-sonnet-4-6'), 1, '(4) sonnet → strong');
  assertEq(inferDownshiftTier('openrouter/anthropic/claude-sonnet-4-6'), 1, '(4) OR sonnet → strong');
  assertEq(inferDownshiftTier('openai/gpt-5.4'), 1, '(4) gpt-5.4 → strong');
  assertEq(inferDownshiftTier('google_ai/gemini-2.5-pro'), 1, '(4) gemini-2.5-pro → strong');
  assertEq(inferDownshiftTier('deepseek/deepseek-reasoner'), 1, '(4) deepseek-reasoner → strong');
  assertEq(inferDownshiftTier('gpt-4o'), 1, '(4) gpt-4o → strong');
  // fast ids — cheap markers win over broad family markers
  assertEq(inferDownshiftTier('claude-haiku-4-5'), 2, '(4) haiku → fast');
  assertEq(inferDownshiftTier('openai/gpt-5.4-mini'), 2, '(4) gpt-5.4-mini → fast (mini beats gpt-5)');
  assertEq(inferDownshiftTier('openai/gpt-5.4-nano'), 2, '(4) gpt-5.4-nano → fast');
  assertEq(inferDownshiftTier('google_ai/gemini-2.5-flash'), 2, '(4) gemini-2.5-flash → fast');
  assertEq(inferDownshiftTier('google_ai/gemini-3.1-flash-lite'), 2, '(4) flash-lite → fast');
  assertEq(inferDownshiftTier('mistral_ai/mistral-small-latest'), 2, '(4) mistral-small → fast');
  assertEq(inferDownshiftTier('ollama/llama3.2'), 2, '(4) ollama llama3.2 → fast');
  assertEq(inferDownshiftTier('huggingface_endpoint/cswan801/BlackSwan-v5'), 2, '(4) BlackSwan → fast');
  // unknown
  assertEq(inferDownshiftTier('totally-made-up-model'), -1, '(4) unknown id → -1');
  assertEq(inferDownshiftTier(''), -1, '(4) empty → -1');

  // ─── (5) downshiftForBudget — level 'ok' is always identity ────────────────
  for (const m of ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'openai/gpt-5.5']) {
    const r = downshiftForBudget(m, 'ok');
    assertEq(r.downshifted, false, `(5) ok → not downshifted (${m})`);
    assertEq(r.model, m, `(5) ok → identity model (${m})`);
  }
  assert(downshiftForBudget('claude-opus-4-8', 'ok').reason.includes('no downshift'), '(5) ok reason says no downshift');

  // ─── (6) downshiftForBudget — warn = ONE tier cheaper ──────────────────────
  {
    const r = downshiftForBudget('claude-opus-4-8', 'warn');
    assertEq(r.downshifted, true, '(6) opus warn → downshifted');
    assertEq(r.model, 'claude-sonnet-4-6', '(6) opus warn → sonnet (one tier down)');
    assert(r.reason.includes('frontier→strong'), '(6) reason names frontier→strong');
    assert(r.reason.includes('warn'), '(6) reason carries level');
  }
  {
    const r = downshiftForBudget('openai/gpt-5.5', 'warn');
    assertEq(r.model, 'claude-sonnet-4-6', '(6) gpt-5.5 warn → sonnet');
    assertEq(r.downshifted, true, '(6) gpt-5.5 warn downshifted');
  }
  {
    // strong at warn drops one tier → fast (haiku)
    const r = downshiftForBudget('claude-sonnet-4-6', 'warn');
    assertEq(r.model, 'claude-haiku-4-5', '(6) sonnet warn → haiku (one tier down)');
    assertEq(r.downshifted, true, '(6) sonnet warn downshifted');
  }
  {
    // already cheapest → identity even at warn
    const r = downshiftForBudget('claude-haiku-4-5', 'warn');
    assertEq(r.downshifted, false, '(6) haiku warn → not downshifted');
    assertEq(r.model, 'claude-haiku-4-5', '(6) haiku warn → identity');
    assert(r.reason.includes('already cheapest'), '(6) haiku reason = already cheapest');
  }

  // ─── (7) downshiftForBudget — critical = cheapest tier ─────────────────────
  {
    const r = downshiftForBudget('claude-opus-4-8', 'critical');
    assertEq(r.model, 'claude-haiku-4-5', '(7) opus critical → haiku (cheapest, skips sonnet)');
    assertEq(r.downshifted, true, '(7) opus critical downshifted');
    assert(r.reason.includes('frontier→fast'), '(7) reason names frontier→fast');
    assert(r.reason.includes('critical'), '(7) reason carries critical level');
  }
  {
    const r = downshiftForBudget('claude-sonnet-4-6', 'critical');
    assertEq(r.model, 'claude-haiku-4-5', '(7) sonnet critical → haiku');
    assertEq(r.downshifted, true, '(7) sonnet critical downshifted');
  }
  {
    const r = downshiftForBudget('openrouter/openai/gpt-5.5', 'critical');
    assertEq(r.model, 'claude-haiku-4-5', '(7) OR gpt-5.5 critical → haiku');
  }
  {
    const r = downshiftForBudget('claude-haiku-4-5', 'critical');
    assertEq(r.downshifted, false, '(7) haiku critical → identity (already cheapest)');
    assertEq(r.model, 'claude-haiku-4-5', '(7) haiku critical → identity model');
  }
  {
    // an already-fast model at critical never moves
    const r = downshiftForBudget('google_ai/gemini-2.5-flash', 'critical');
    assertEq(r.downshifted, false, '(7) flash critical → identity');
    assertEq(r.model, 'google_ai/gemini-2.5-flash', '(7) flash critical keeps original id');
  }

  // ─── (8) unknown model → identity; reason never echoes raw model ───────────
  {
    const r = downshiftForBudget('some-unknown-vendor/mystery-1', 'critical');
    assertEq(r.downshifted, false, '(8) unknown model → not downshifted');
    assertEq(r.model, 'some-unknown-vendor/mystery-1', '(8) unknown → identity');
    assert(r.reason.includes('tier unknown'), '(8) unknown reason says tier unknown');
  }
  {
    // reason must not leak the (possibly huge/hostile) input id
    const hostileId = 'A'.repeat(5000);
    const r = downshiftForBudget(hostileId, 'critical');
    assert(!r.reason.includes('AAAA'), '(8) reason does not echo raw model id');
    assert(r.reason.length < 120, '(8) reason stays bounded');
    assertEq(r.downshifted, false, '(8) hostile unknown id → identity');
  }

  // ─── (9) downshiftForBudget — degenerate / hostile input never throws ──────
  try {
    const junk: unknown[] = [null, undefined, 42, 0, NaN, Infinity, -1, true, false, {}, [], () => 0, Symbol('x')];
    const levels: unknown[] = ['ok', 'warn', 'critical', '', 'CRITICAL', null, undefined, 7, {}];
    for (const m of junk) {
      for (const lv of levels) {
        const r = downshiftForBudget(m as unknown, lv as SpendAlertLevel);
        assert(typeof r.model === 'string', '(9) result.model is always a string');
        assert(typeof r.downshifted === 'boolean', '(9) result.downshifted is always boolean');
        assert(typeof r.reason === 'string' && r.reason.length > 0, '(9) result.reason is non-empty string');
        // non-string model can never be "downshifted" out of nowhere unless it
        // matched a tier; junk never matches → identity with empty string model.
        if (typeof m !== 'string') {
          assertEq(r.downshifted, false, '(9) non-string model → never downshifted');
          assertEq(r.model, '', '(9) non-string model → empty-string identity');
        }
      }
    }
    // classifySpendLevel on hostile shapes
    assertEq(classifySpendLevel(null as unknown as { spentUsd: unknown; capUsd: unknown }), 'ok', '(9) null input → ok');
    assertEq(classifySpendLevel(undefined as unknown as { spentUsd: unknown; capUsd: unknown }), 'ok', '(9) undefined input → ok');
    assertEq(classifySpendLevel(42 as unknown as { spentUsd: unknown; capUsd: unknown }), 'ok', '(9) number input → ok');
    assertEq(classifySpendLevel('str' as unknown as { spentUsd: unknown; capUsd: unknown }), 'ok', '(9) string input → ok');
    assertEq(classifySpendLevel([] as unknown as { spentUsd: unknown; capUsd: unknown }), 'ok', '(9) array input → ok');
    assertEq(classifySpendLevel({ spentUsd: {}, capUsd: [] } as unknown as { spentUsd: unknown; capUsd: unknown }), 'ok', '(9) object/array fields → ok');
    // inferDownshiftTier on hostile input
    assertEq(inferDownshiftTier(null), -1, '(9) inferDownshiftTier(null) → -1');
    assertEq(inferDownshiftTier(undefined), -1, '(9) inferDownshiftTier(undefined) → -1');
    assertEq(inferDownshiftTier(123), -1, '(9) inferDownshiftTier(number) → -1');
    assertEq(inferDownshiftTier({}), -1, '(9) inferDownshiftTier(object) → -1');
    assertEq(inferDownshiftTier('X'.repeat(100000)), -1, '(9) inferDownshiftTier(huge junk) → -1');
    passes += 1; // reached here → no throw across every degenerate call
  } catch (e) {
    failures += 1;
    console.error(`FAIL: (9) degenerate inputs threw: ${(e as Error)?.message}`);
  }

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll budget-model-downshift-core smoke cases passed (' + passes + ' passed).');
}

main();
