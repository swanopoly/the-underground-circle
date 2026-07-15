/**
 * delegation-sizing-core-smoketest — the PURE delegation-sizing brain
 * (src/lib/delegationSizingCore.ts). Load-bearing behavior asserted here:
 * complexity scoring 0–10 (length / connectors / list-steps / verb breadth /
 * task-plan kind + verification), score→tier→max-specialists mapping, the
 * one-liner "add a spinner" → coder-only (architect demoted) headline, a big
 * multi-part build → up to 4 kept, insertion-order stability, the never-zero /
 * exact-partition invariants, nested `subagent.role` extraction, determinism,
 * and never-throws on degenerate / hostile input.
 *
 * Pure — loads under tsx (delegationSizingCore has zero imports).
 */

import {
  sizeDelegationSpecs,
  scoreDelegationComplexity,
  tierForScore,
  maxSpecialistsForScore,
  extractSpecRole,
  MAX_DELEGATION_SCORE,
  type SizableSpec,
} from '../src/lib/delegationSizingCore';

let passes = 0;
let failures = 0;
function assert(c: unknown, m: string, e?: string): void {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string): void {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}
function assertNoThrow(fn: () => void, m: string): void {
  let threw = false;
  let err = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    err = String(e);
  }
  assert(!threw, m, err);
}

// Real call-site shape: role lives at spec.subagent.role (SubagentTaskSpec).
function nested(role: string, priority: 'high' | 'medium' = 'high') {
  return { subagent: { role }, task: 'do ' + role + ' work', reason: 'r', priority };
}
// Simplified SizableSpec shape: role at top level.
function flat(role: string, priority?: 'high' | 'medium' | 'low'): SizableSpec {
  return { role, priority };
}

const BUILD4 = [nested('architect'), nested('coder'), nested('tester'), nested('reviewer')];
const BUILD5 = [nested('architect'), nested('coder'), nested('tester'), nested('reviewer'), nested('devops')];
const SPINNER = 'add a loading spinner';
const BIG_BUILD =
  'Build a complete multi-tenant billing system: implement subscription plans and metered usage, ' +
  'add Stripe webhooks, then migrate the existing customers, write integration tests for every path, ' +
  'refactor the invoice generator, and configure CI to deploy on merge.';
const buildPlan = (verificationCount: number) => ({
  kind: 'build',
  verification: Array.from({ length: verificationCount }, (_, i) => ({ id: String(i), kind: 'tests' })),
});

function rolesOf(specs: unknown[]): string {
  return specs.map(extractSpecRole).join(',');
}

function main(): void {
  // ─── (1) scoreDelegationComplexity — bounds + monotonic headlines ───────────
  assertEq(scoreDelegationComplexity({ message: '' }), 0, '(1) empty message → score 0');
  assertEq(scoreDelegationComplexity(), 0, '(1) no input → score 0');
  const spinnerScore = scoreDelegationComplexity({ message: SPINNER, taskPlan: buildPlan(1) });
  assert(spinnerScore >= 0 && spinnerScore <= 2, '(1) one-liner spinner scores very-low band', 'got ' + spinnerScore);
  const bigScore = scoreDelegationComplexity({ message: BIG_BUILD, taskPlan: buildPlan(4) });
  assert(bigScore >= 7, '(1) big multi-part build scores high band', 'got ' + bigScore);
  assert(bigScore > spinnerScore, '(1) big build strictly more complex than a one-liner');
  assert(scoreDelegationComplexity({ message: BIG_BUILD }) <= MAX_DELEGATION_SCORE, '(1) score never exceeds ceiling');
  // task plan adds signal beyond the raw message.
  const noPlan = scoreDelegationComplexity({ message: 'implement the feature' });
  const withPlan = scoreDelegationComplexity({ message: 'implement the feature', taskPlan: buildPlan(4) });
  assert(withPlan > noPlan, '(1) build plan + verification breadth raises score');
  // verification breadth raises score.
  const v1 = scoreDelegationComplexity({ message: 'x', taskPlan: buildPlan(1) });
  const v4 = scoreDelegationComplexity({ message: 'x', taskPlan: buildPlan(4) });
  assert(v4 > v1, '(1) more required verification checks → higher score');
  // multi-part connectors raise score.
  assert(
    scoreDelegationComplexity({ message: 'do this and then that and also the other thing' }) >
      scoreDelegationComplexity({ message: 'do this' }),
    '(1) conjunctions/multi-part connectors raise score',
  );

  // ─── (2) score → tier + max-specialists mapping (exhaustive 0..10) ──────────
  const expectMax = [1, 1, 1, 2, 2, 3, 3, 4, 4, 4, 4];
  const expectTier = ['very-low', 'very-low', 'very-low', 'low', 'low', 'medium', 'medium', 'high', 'high', 'high', 'high'];
  for (let s = 0; s <= 10; s++) {
    assertEq(maxSpecialistsForScore(s), expectMax[s], '(2) maxSpecialistsForScore(' + s + ')');
    assertEq(tierForScore(s), expectTier[s], '(2) tierForScore(' + s + ')');
  }
  // out-of-range clamps
  assertEq(maxSpecialistsForScore(-5), 1, '(2) negative score clamps to 1 specialist');
  assertEq(maxSpecialistsForScore(999), 4, '(2) huge score clamps to 4 specialists');
  assertEq(tierForScore(-1), 'very-low', '(2) negative score → very-low tier');
  assertEq(tierForScore(50), 'high', '(2) huge score → high tier');

  // ─── (3) HEADLINE: one-liner "add a spinner" → coder-only (architect demoted)
  const spinner = sizeDelegationSpecs({ message: SPINNER, taskPlan: buildPlan(1), specs: BUILD4 });
  assertEq(spinner.kept.length, 1, '(3) spinner → exactly one specialist kept');
  assertEq(extractSpecRole(spinner.kept[0]), 'coder', '(3) spinner keeper is the coder, not the architect');
  assertEq(spinner.dropped.length, 3, '(3) the other three specs are dropped');
  assert(spinner.dropped.some((s) => extractSpecRole(s) === 'architect'), '(3) architect was demoted/dropped');
  assert(spinner.score <= 2, '(3) spinner scored very-low');
  assert(typeof spinner.reason === 'string' && spinner.reason.length > 0, '(3) reason is a non-empty string');
  assert(spinner.reason.length <= 200, '(3) reason is bounded');

  // ─── (4) architect / thinking-role demotion specifics ──────────────────────
  const trivialMsg = 'tweak it'; // very-low, no plan
  assertEq(extractSpecRole(sizeDelegationSpecs({ message: trivialMsg, specs: [nested('architect'), nested('coder')] }).kept[0]), 'coder', '(4) [architect,coder] very-low → keep coder');
  assertEq(extractSpecRole(sizeDelegationSpecs({ message: trivialMsg, specs: [nested('planner'), nested('coder'), nested('reviewer')] }).kept[0]), 'coder', '(4) [planner,coder,reviewer] very-low → keep coder (planner demoted)');
  assertEq(extractSpecRole(sizeDelegationSpecs({ message: trivialMsg, specs: [nested('architect'), nested('planner')] }).kept[0]), 'architect', '(4) no builder present → keep first (architect)');
  assertEq(extractSpecRole(sizeDelegationSpecs({ message: trivialMsg, specs: [nested('coder'), nested('architect')] }).kept[0]), 'coder', '(4) first is already a builder → keep first');
  assertEq(extractSpecRole(sizeDelegationSpecs({ message: trivialMsg, specs: [nested('reviewer'), nested('tester')] }).kept[0]), 'reviewer', '(4) reviewer is not thinking-only → keep first (reviewer)');
  assertEq(extractSpecRole(sizeDelegationSpecs({ message: trivialMsg, specs: [nested('debugger'), nested('tester')] }).kept[0]), 'debugger', '(4) debugger is a builder → keep first (debugger)');
  assertEq(extractSpecRole(sizeDelegationSpecs({ message: trivialMsg, specs: [nested('researcher'), nested('planner')] }).kept[0]), 'researcher', '(4) researcher is not thinking-only → keep first');

  // ─── (5) HEADLINE: big multi-part build → up to 4 kept ──────────────────────
  const big5 = sizeDelegationSpecs({ message: BIG_BUILD, taskPlan: buildPlan(4), specs: BUILD5 });
  assertEq(big5.kept.length, 4, '(5) big build with 5 specs → 4 kept (capped)');
  assertEq(big5.dropped.length, 1, '(5) exactly one spec dropped');
  assertEq(rolesOf(big5.kept), 'architect,coder,tester,reviewer', '(5) kept preserves the first-four insertion order');
  assertEq(extractSpecRole(big5.dropped[0]), 'devops', '(5) the fifth spec is the one dropped');
  const big4 = sizeDelegationSpecs({ message: BIG_BUILD, taskPlan: buildPlan(4), specs: BUILD4 });
  assertEq(big4.kept.length, 4, '(5) big build with 4 specs → all 4 kept');
  assertEq(big4.dropped.length, 0, '(5) nothing dropped when list already fits');

  // ─── (6) count invariant: kept === min(maxSpecialists(score), specs.length) ──
  const battery: Array<{ message: string; taskPlan?: unknown; specs: unknown[] }> = [
    { message: SPINNER, taskPlan: buildPlan(1), specs: BUILD4 },
    { message: 'tweak the label', specs: BUILD5 },
    { message: 'Add a dark mode toggle to the header, persist the chosen preference, and update the settings screen accordingly.', taskPlan: buildPlan(1), specs: BUILD5 },
    { message: 'Implement a new account settings page, add client-side form validation for each field, and update the top navigation menu so users can reach it.', taskPlan: buildPlan(2), specs: BUILD5 },
    { message: BIG_BUILD, taskPlan: buildPlan(4), specs: BUILD5 },
    { message: BIG_BUILD, taskPlan: buildPlan(4), specs: [nested('coder')] },
  ];
  for (const c of battery) {
    const res = sizeDelegationSpecs(c);
    const expectKeep = Math.min(maxSpecialistsForScore(res.score), c.specs.length);
    assertEq(res.kept.length, expectKeep, '(6) kept === min(max-for-score, specs.length) for "' + c.message.slice(0, 24) + '"');
  }

  // ─── (7) empty / missing specs → empty kept, no throw ───────────────────────
  const empty = sizeDelegationSpecs({ message: BIG_BUILD, taskPlan: buildPlan(4), specs: [] });
  assertEq(empty.kept.length, 0, '(7) empty specs → kept []');
  assertEq(empty.dropped.length, 0, '(7) empty specs → dropped []');
  assert(typeof empty.reason === 'string', '(7) empty specs still yields a reason string');
  assert(typeof empty.score === 'number', '(7) empty specs still yields a numeric score');
  assertEq(sizeDelegationSpecs({ message: SPINNER }).kept.length, 0, '(7) missing specs field → kept []');

  // ─── (8) never-zero: non-empty specs always keep ≥ 1 (across many scores) ────
  const messages = ['', 'x', SPINNER, 'do this and that and more', BIG_BUILD, '1. a\n2. b\n3. c\n4. d'];
  for (const message of messages) {
    for (let n = 1; n <= 3; n++) {
      const specs = Array.from({ length: n }, (_, i) => nested(['coder', 'architect', 'tester'][i % 3]));
      const res = sizeDelegationSpecs({ message, specs });
      assert(res.kept.length >= 1, '(8) non-empty specs never sized to zero (msg="' + message.slice(0, 12) + '", n=' + n + ')');
      assert(res.kept.length <= n, '(8) kept never exceeds input length');
      assert(res.kept.length <= 4, '(8) kept never exceeds the 4-specialist ceiling');
    }
  }

  // ─── (9) exact partition: kept ∪ dropped == input (refs preserved, no dupes) ─
  for (const c of battery) {
    const res = sizeDelegationSpecs(c);
    assertEq(res.kept.length + res.dropped.length, c.specs.length, '(9) kept+dropped === input length');
    const all = [...res.kept, ...res.dropped];
    assert(all.every((s) => c.specs.includes(s as any)), '(9) every returned spec is an original input reference');
    assert(res.kept.every((s) => !res.dropped.includes(s)), '(9) no spec appears in both kept and dropped');
  }
  // dropped preserves input order for a multi-keep tier.
  assertEq(rolesOf(big5.dropped), 'devops', '(9) dropped preserves input order');

  // ─── (10) nested subagent.role vs flat role — both extraction paths work ─────
  assertEq(extractSpecRole(nested('coder')), 'coder', '(10) extract role from spec.subagent.role');
  assertEq(extractSpecRole(flat('coder')), 'coder', '(10) extract role from spec.role');
  assertEq(extractSpecRole({ role: 'CoDeR' }), 'coder', '(10) role extraction lowercases');
  const flatSpinner = sizeDelegationSpecs({ message: SPINNER, taskPlan: buildPlan(1), specs: [flat('architect'), flat('coder'), flat('reviewer')] });
  assertEq(extractSpecRole(flatSpinner.kept[0]), 'coder', '(10) demotion works on flat SizableSpec shape too');

  // ─── (11) kept holds the ORIGINAL object references, untouched ───────────────
  const identSpecs = [nested('architect'), nested('coder')];
  const ident = sizeDelegationSpecs({ message: 'x', specs: identSpecs });
  assert(ident.kept[0] === identSpecs[1], '(11) kept element is the very same object reference (coder)');
  assert(ident.dropped[0] === identSpecs[0], '(11) dropped element is the same object reference (architect)');
  assertEq((identSpecs[1] as any).priority, 'high', '(11) original spec fields left intact');

  // ─── (12) determinism: identical inputs → identical result ──────────────────
  const norm = (r: ReturnType<typeof sizeDelegationSpecs>) =>
    JSON.stringify({ score: r.score, reason: r.reason, kept: r.kept.map(extractSpecRole), dropped: r.dropped.map(extractSpecRole) });
  assertEq(
    norm(sizeDelegationSpecs({ message: BIG_BUILD, taskPlan: buildPlan(4), specs: BUILD5 })),
    norm(sizeDelegationSpecs({ message: BIG_BUILD, taskPlan: buildPlan(4), specs: BUILD5 })),
    '(12) sizeDelegationSpecs is deterministic',
  );

  // ─── (13) degenerate / hostile input — never throws, always bounded ─────────
  const hostile: any[] = [
    undefined,
    null,
    {},
    { message: SPINNER },
    { specs: null },
    { message: 123, taskPlan: 456, specs: 789 },
    { message: {}, taskPlan: [], specs: 'not-an-array' },
    { message: ['a', 'b'], specs: {} },
    { message: true, taskPlan: { kind: 5, verification: 'nope' }, specs: BUILD4 },
    { message: SPINNER, taskPlan: { kind: 'build', verification: [1, 2, 3] }, specs: [null, undefined, 5, 'x', {}, { subagent: null }, { subagent: { role: 5 } }, nested('coder')] },
    { message: 'x'.repeat(100_000), taskPlan: buildPlan(9999), specs: Array.from({ length: 5000 }, () => nested('coder')) },
    { message: SPINNER, specs: [{ role: null }, { role: '' }, {}] },
  ];
  for (const input of hostile) {
    assertNoThrow(() => {
      const res = sizeDelegationSpecs(input);
      const specsLen = Array.isArray(input?.specs) ? input.specs.length : 0;
      assert(res && Array.isArray(res.kept) && Array.isArray(res.dropped), '(13) hostile → arrays');
      assert(typeof res.score === 'number' && res.score >= 0 && res.score <= MAX_DELEGATION_SCORE, '(13) hostile → score in [0,10]');
      assert(typeof res.reason === 'string' && res.reason.length <= 200, '(13) hostile → reason bounded');
      assertEq(res.kept.length + res.dropped.length, specsLen, '(13) hostile → exact partition');
      if (specsLen > 0) assert(res.kept.length >= 1 && res.kept.length <= 4, '(13) hostile non-empty → 1..4 kept');
      else assertEq(res.kept.length, 0, '(13) hostile empty/junk specs → kept []');
    }, '(13) sizeDelegationSpecs never throws on hostile input ' + String(JSON.stringify(input)).slice(0, 40));
  }
  // hostile scalars for the helper exports
  assertNoThrow(() => scoreDelegationComplexity(null as any), '(13) scoreDelegationComplexity(null) no throw');
  assertNoThrow(() => scoreDelegationComplexity({ message: {}, taskPlan: NaN } as any), '(13) scoreDelegationComplexity junk no throw');
  for (const bad of [null, undefined, NaN, Infinity, -Infinity, 'x', {}, []]) {
    assertNoThrow(() => maxSpecialistsForScore(bad as any), '(13) maxSpecialistsForScore(' + JSON.stringify(bad) + ') no throw');
    assertNoThrow(() => tierForScore(bad as any), '(13) tierForScore(' + JSON.stringify(bad) + ') no throw');
    const mx = maxSpecialistsForScore(bad as any);
    assert(mx >= 1 && mx <= 4, '(13) maxSpecialists stays 1..4 for junk');
  }
  for (const bad of [null, undefined, 5, 'x', {}, { subagent: {} }, { role: 42 }]) {
    assertNoThrow(() => extractSpecRole(bad as any), '(13) extractSpecRole no throw for ' + JSON.stringify(bad));
    assertEq(typeof extractSpecRole(bad as any), 'string', '(13) extractSpecRole always returns a string');
  }
  assertEq(extractSpecRole(null), '', '(13) extractSpecRole(null) → empty string');

  if (failures > 0) {
    console.error('\n' + failures + ' failure(s), ' + passes + ' passed');
    process.exit(1);
  }
  console.log('\nAll delegation-sizing-core smoke cases passed (' + passes + ' passed).');
}

main();
