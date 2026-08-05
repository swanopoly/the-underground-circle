/**
 * memory-turn-assembly-core-smoketest — the pure "load memory once" planner
 * (src/lib/memoryTurnAssemblyCore.ts) behind IMPROVE #3 of
 * docs/CHAT_ARCHITECTURE_STRATEGIC_PLAN_2026-07-15.md ("collapse the redundant
 * per-turn memory path": the turn embeds + ranks the query TWICE — once inside
 * buildOpenSwanMemoryStores → buildPromptMemoryBundle, then AGAIN in swanbot's
 * standalone loadWisdom/loadRetrieval tasks). Load-bearing assertions:
 *
 *   COLLAPSE: when the caller already pre-resolved the stores bundle
 *   (hasMemoryStores), the standalone retrieval + wisdom passes are SUPPRESSED
 *   (loadTurnRetrieval=false, loadSoulWisdom=false, reuseFromStores=true) so the
 *   query is never embedded+ranked a second time.
 *
 *   COMPLEXITY GATING (no stores): trivial → nothing; simple → startup+retrieval
 *   (no wisdom); moderate/complex → startup+retrieval+wisdom — each pass once.
 *
 *   DEPTH DIAL: 'max' floors any tier to complex (loads everything); 'lean'
 *   drops the wisdom pass; 'standard' is identity. QUERY: retrieval is gated on
 *   a real query; startup/wisdom are not.
 *
 *   ANTI-DUPLICATION INVARIANT: never reuseFromStores AND a standalone pass;
 *   startup-off ⇒ every pass off; reuse ⇒ startup-on. Plus: every export is
 *   total — null/undefined/wrong-type/huge/hostile/cyclic input never throws,
 *   and the plan is deterministic.
 */

import {
  planMemoryTurnLoad,
  type MemoryTurnPlan,
  type MemoryTurnPlanInput,
} from '../src/lib/memoryTurnAssemblyCore';

let passes = 0,
  failures = 0;
function assert(c: boolean, m: string, e?: string) {
  if (c) passes++;
  else {
    failures++;
    console.error('FAIL: ' + m + (e ? ' :: ' + e : ''));
  }
}
function assertEq(a: unknown, b: unknown, m: string) {
  assert(a === b, m, 'got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));
}

/** A plan whose retrieval/wisdom passes are never simultaneously reused + run. */
function assertNoDoubleEmbed(p: MemoryTurnPlan, label: string) {
  assert(
    !(p.reuseFromStores && (p.loadTurnRetrieval || p.loadSoulWisdom)),
    label + ': reuse must suppress standalone retrieval/wisdom (no double embed+rank)',
    JSON.stringify(p),
  );
}
/** Structural totality: 5 keys, right primitive types. */
function assertWellFormed(p: MemoryTurnPlan, label: string) {
  assert(!!p && typeof p === 'object', label + ': plan is an object');
  assert(typeof p.loadStartupBundle === 'boolean', label + ': loadStartupBundle boolean');
  assert(typeof p.loadTurnRetrieval === 'boolean', label + ': loadTurnRetrieval boolean');
  assert(typeof p.loadSoulWisdom === 'boolean', label + ': loadSoulWisdom boolean');
  assert(typeof p.reuseFromStores === 'boolean', label + ': reuseFromStores boolean');
  assert(typeof p.reason === 'string' && p.reason.length > 0, label + ': reason non-empty string');
  assert(p.reason.length <= 200, label + ': reason bounded');
  // Global invariants that must hold for EVERY plan.
  assertNoDoubleEmbed(p, label);
  if (p.reuseFromStores) assert(p.loadStartupBundle, label + ': reuse implies startup bundle present');
  if (!p.loadStartupBundle) {
    assert(
      !p.loadTurnRetrieval && !p.loadSoulWisdom && !p.reuseFromStores,
      label + ': no startup bundle ⇒ all passes off',
      JSON.stringify(p),
    );
  }
}

function main() {
  // ── Group 1: shape / totality on the canonical happy paths ────────────────
  const canonical: MemoryTurnPlanInput[] = [
    { complexity: 'trivial' },
    { complexity: 'simple', hasQuery: true },
    { complexity: 'moderate', hasQuery: true },
    { complexity: 'complex', hasQuery: true },
    { hasMemoryStores: true },
    { complexity: 'complex', contextDepth: 'lean' },
    { complexity: 'trivial', contextDepth: 'max' },
  ];
  canonical.forEach((inp, i) => assertWellFormed(planMemoryTurnLoad(inp), 'canonical#' + i));

  // ── Group 2: COLLAPSE — pre-resolved stores suppress the standalone passes ─
  // This is the whole point of IMPROVE #3: no second embed+rank.
  {
    const p = planMemoryTurnLoad({ hasMemoryStores: true, complexity: 'moderate', hasQuery: true });
    assertEq(p.reuseFromStores, true, 'stores: reuseFromStores true');
    assertEq(p.loadTurnRetrieval, false, 'stores: standalone retrieval SUPPRESSED');
    assertEq(p.loadSoulWisdom, false, 'stores: standalone wisdom SUPPRESSED');
    assertEq(p.loadStartupBundle, true, 'stores: bundle present');
    assert(p.reason.indexOf('reuse') !== -1, 'stores: reason mentions reuse');
  }
  // Reuse holds across every non-trivial complexity + regardless of hasQuery.
  (['simple', 'moderate', 'complex'] as const).forEach((c) => {
    [true, false, undefined].forEach((q) => {
      const p = planMemoryTurnLoad({ hasMemoryStores: true, complexity: c, hasQuery: q });
      assertEq(p.reuseFromStores, true, `stores/${c}/q=${q}: reuse`);
      assertEq(p.loadTurnRetrieval, false, `stores/${c}/q=${q}: retrieval suppressed`);
      assertEq(p.loadSoulWisdom, false, `stores/${c}/q=${q}: wisdom suppressed`);
      assertEq(p.loadStartupBundle, true, `stores/${c}/q=${q}: bundle present`);
    });
  });
  // Passing the actual stores OBJECT (not just a boolean) still counts as present.
  {
    const p = planMemoryTurnLoad({ hasMemoryStores: { combined: 'x', references: [] }, complexity: 'complex' });
    assertEq(p.reuseFromStores, true, 'stores-object: reuse');
    assertEq(p.loadTurnRetrieval, false, 'stores-object: retrieval suppressed');
  }

  // ── Group 3: trivial → nothing (with and without stores/depth) ────────────
  {
    const p = planMemoryTurnLoad({ complexity: 'trivial' });
    assertEq(p.loadStartupBundle, false, 'trivial: no startup');
    assertEq(p.loadTurnRetrieval, false, 'trivial: no retrieval');
    assertEq(p.loadSoulWisdom, false, 'trivial: no wisdom');
    assertEq(p.reuseFromStores, false, 'trivial: no reuse');
    assert(p.reason.indexOf('trivial') !== -1, 'trivial: reason says trivial');
  }
  // Trivial stays lean even if stores were somehow pre-resolved (lean tier wins).
  {
    const p = planMemoryTurnLoad({ complexity: 'trivial', hasMemoryStores: true });
    assertEq(p.loadStartupBundle, false, 'trivial+stores: still nothing');
    assertEq(p.reuseFromStores, false, 'trivial+stores: no reuse');
    assertEq(p.loadTurnRetrieval, false, 'trivial+stores: no retrieval');
  }
  // Trivial + lean depth → still nothing.
  {
    const p = planMemoryTurnLoad({ complexity: 'trivial', contextDepth: 'lean' });
    assertEq(p.loadStartupBundle, false, 'trivial+lean: nothing');
  }

  // ── Group 4: complex + no stores → all passes once ────────────────────────
  {
    const p = planMemoryTurnLoad({ complexity: 'complex', hasQuery: true });
    assertEq(p.loadStartupBundle, true, 'complex: startup on');
    assertEq(p.loadTurnRetrieval, true, 'complex: retrieval on');
    assertEq(p.loadSoulWisdom, true, 'complex: wisdom on');
    assertEq(p.reuseFromStores, false, 'complex: not reusing (no bundle)');
    assert(p.reason.indexOf('standalone') !== -1, 'complex: reason says standalone');
  }

  // ── Group 5: per-tier standalone gating (no stores), mirrors the live policy
  {
    const simple = planMemoryTurnLoad({ complexity: 'simple', hasQuery: true });
    assertEq(simple.loadStartupBundle, true, 'simple: startup on');
    assertEq(simple.loadTurnRetrieval, true, 'simple: retrieval on');
    assertEq(simple.loadSoulWisdom, false, 'simple: wisdom OFF (moderate+ only)');
    assertEq(simple.reuseFromStores, false, 'simple: no reuse');
  }
  {
    const moderate = planMemoryTurnLoad({ complexity: 'moderate', hasQuery: true });
    assertEq(moderate.loadStartupBundle, true, 'moderate: startup on');
    assertEq(moderate.loadTurnRetrieval, true, 'moderate: retrieval on');
    assertEq(moderate.loadSoulWisdom, true, 'moderate: wisdom on');
  }

  // ── Group 6: depth dial — max floors to complex; lean drops wisdom ────────
  {
    // max lifts even a 'simple' turn to full family loading.
    const p = planMemoryTurnLoad({ complexity: 'simple', contextDepth: 'max', hasQuery: true });
    assertEq(p.loadStartupBundle, true, 'max: startup on');
    assertEq(p.loadTurnRetrieval, true, 'max: retrieval on');
    assertEq(p.loadSoulWisdom, true, 'max: wisdom on (floored to complex)');
  }
  {
    // max even revives a nominally-trivial turn (dial overrides the heuristic).
    const p = planMemoryTurnLoad({ complexity: 'trivial', contextDepth: 'maximum', hasQuery: true });
    assertEq(p.loadStartupBundle, true, 'max+trivial: startup on');
    assertEq(p.loadSoulWisdom, true, 'max+trivial: wisdom on');
  }
  {
    // lean drops the wisdom pass but keeps memory + retrieval.
    const p = planMemoryTurnLoad({ complexity: 'complex', contextDepth: 'lean', hasQuery: true });
    assertEq(p.loadStartupBundle, true, 'lean: startup on');
    assertEq(p.loadTurnRetrieval, true, 'lean: retrieval on');
    assertEq(p.loadSoulWisdom, false, 'lean: wisdom DROPPED');
  }
  {
    // lean on a moderate turn also drops wisdom (which standard would keep).
    const std = planMemoryTurnLoad({ complexity: 'moderate', contextDepth: 'standard', hasQuery: true });
    const lean = planMemoryTurnLoad({ complexity: 'moderate', contextDepth: 'lean', hasQuery: true });
    assertEq(std.loadSoulWisdom, true, 'moderate/standard: wisdom on');
    assertEq(lean.loadSoulWisdom, false, 'moderate/lean: wisdom off');
    // lean keeps retrieval identical to standard.
    assertEq(lean.loadTurnRetrieval, std.loadTurnRetrieval, 'lean keeps retrieval like standard');
  }

  // ── Group 7: query gating — retrieval needs a query; startup/wisdom do not ─
  {
    const noQ = planMemoryTurnLoad({ complexity: 'complex', hasQuery: false });
    assertEq(noQ.loadTurnRetrieval, false, 'no-query: retrieval OFF');
    assertEq(noQ.loadStartupBundle, true, 'no-query: startup still on');
    assertEq(noQ.loadSoulWisdom, true, 'no-query: wisdom still on');
  }
  {
    // Empty / whitespace query string → treated as no query.
    const empty = planMemoryTurnLoad({ complexity: 'moderate', hasQuery: '   ' });
    assertEq(empty.loadTurnRetrieval, false, 'whitespace query: retrieval off');
    const real = planMemoryTurnLoad({ complexity: 'moderate', hasQuery: 'refactor the router' });
    assertEq(real.loadTurnRetrieval, true, 'real query string: retrieval on');
  }
  {
    // Omitted hasQuery → assumed present (common case: there IS a message).
    const p = planMemoryTurnLoad({ complexity: 'moderate' });
    assertEq(p.loadTurnRetrieval, true, 'omitted query: assumed present → retrieval on');
  }

  // ── Group 8: anti-duplication invariant across a full input matrix ────────
  const complexities = ['trivial', 'simple', 'moderate', 'complex', 'bogus', undefined];
  const depths = ['lean', 'standard', 'max', 'weird', undefined];
  const stores = [true, false, undefined, {}, 0, 'yes'];
  const queries = [true, false, undefined, '', 'q'];
  let matrixCount = 0;
  for (const complexity of complexities)
    for (const contextDepth of depths)
      for (const hasMemoryStores of stores)
        for (const hasQuery of queries) {
          const p = planMemoryTurnLoad({
            complexity,
            contextDepth,
            hasMemoryStores,
            hasQuery,
          } as MemoryTurnPlanInput);
          assertWellFormed(p, 'matrix');
          matrixCount++;
        }
  assert(matrixCount === complexities.length * depths.length * stores.length * queries.length, 'matrix fully enumerated');
  // The whole matrix must never throw and must always satisfy invariants; one
  // rollup assertion so the count is visible.
  assert(matrixCount >= 900, 'matrix exercised a large input space', 'count=' + matrixCount);

  // ── Group 9: input normalization (garbage → safe defaults) ────────────────
  {
    // Unknown complexity string → 'moderate' default (loads memory + retrieval).
    const p = planMemoryTurnLoad({ complexity: 'ENORMOUS', hasQuery: true });
    assertEq(p.loadStartupBundle, true, 'bogus complexity → moderate: startup on');
    assertEq(p.loadTurnRetrieval, true, 'bogus complexity → moderate: retrieval on');
    assertEq(p.loadSoulWisdom, true, 'bogus complexity → moderate: wisdom on');
  }
  {
    // Case-insensitive + padded complexity.
    const p = planMemoryTurnLoad({ complexity: '  COMPLEX  ', hasQuery: true });
    assertEq(p.loadSoulWisdom, true, 'padded/upper COMPLEX normalized');
  }
  {
    // Unknown depth → 'standard' (identity: keeps the tier's wisdom).
    const p = planMemoryTurnLoad({ complexity: 'moderate', contextDepth: 'ultra', hasQuery: true });
    assertEq(p.loadSoulWisdom, true, 'bogus depth → standard identity');
  }
  {
    // Depth aliases resolve.
    assertEq(planMemoryTurnLoad({ complexity: 'moderate', contextDepth: 'minimal', hasQuery: true }).loadSoulWisdom, false, 'alias minimal → lean');
    assertEq(planMemoryTurnLoad({ complexity: 'simple', contextDepth: 'full', hasQuery: true }).loadSoulWisdom, true, 'alias full → max');
  }
  {
    // hasMemoryStores falsy variants → NOT present.
    (['0', '', 'false', 'no', 'off', 0, false, null, undefined, NaN] as unknown[]).forEach((v) => {
      const p = planMemoryTurnLoad({ complexity: 'moderate', hasMemoryStores: v, hasQuery: true });
      assertEq(p.reuseFromStores, false, 'falsy stores(' + JSON.stringify(v) + '): no reuse');
    });
    // hasMemoryStores truthy variants → present.
    (['1', 'yes', 'true', 1, 42, true, {}, [], 'anything'] as unknown[]).forEach((v) => {
      const p = planMemoryTurnLoad({ complexity: 'moderate', hasMemoryStores: v, hasQuery: true });
      assertEq(p.reuseFromStores, true, 'truthy stores(' + JSON.stringify(v) + '): reuse');
    });
  }

  // ── Group 10: determinism / purity (same input → deep-equal plan) ─────────
  {
    const inp = { complexity: 'moderate', contextDepth: 'lean', hasQuery: 'x', hasMemoryStores: false } as const;
    const a = JSON.stringify(planMemoryTurnLoad({ ...inp }));
    const b = JSON.stringify(planMemoryTurnLoad({ ...inp }));
    const c = JSON.stringify(planMemoryTurnLoad({ ...inp }));
    assertEq(a, b, 'deterministic run 1==2');
    assertEq(b, c, 'deterministic run 2==3');
  }
  {
    // Calling with the exact same object twice must not mutate it or drift.
    const shared: MemoryTurnPlanInput = { complexity: 'complex', hasMemoryStores: true };
    const before = JSON.stringify(shared);
    planMemoryTurnLoad(shared);
    planMemoryTurnLoad(shared);
    assertEq(JSON.stringify(shared), before, 'input not mutated');
  }

  // ── Group 11: hostile / degenerate inputs never throw ─────────────────────
  const hostile: unknown[] = [
    null,
    undefined,
    0,
    1,
    NaN,
    Infinity,
    -Infinity,
    '',
    'not-an-object',
    true,
    false,
    [],
    [1, 2, 3],
    Symbol('s'),
    BigInt(9),
    () => 'fn',
    { complexity: Symbol('c'), contextDepth: 123, hasMemoryStores: () => true, hasQuery: {} },
    { complexity: { toString() { throw new Error('boom'); } } },
    { complexity: 'x'.repeat(100000), hasQuery: 'y'.repeat(200000) }, // huge
    Object.create(null),
    new Proxy({}, { get() { throw new Error('trap'); } }), // throwing getter
  ];
  // Cyclic input.
  const cyclic: any = { complexity: 'complex' };
  cyclic.self = cyclic;
  hostile.push(cyclic);
  hostile.forEach((h, i) => {
    let threw = false;
    let plan: MemoryTurnPlan | null = null;
    try {
      plan = planMemoryTurnLoad(h as MemoryTurnPlanInput);
    } catch {
      threw = true;
    }
    assert(!threw, 'hostile#' + i + ' did not throw');
    if (plan) assertWellFormed(plan, 'hostile#' + i);
  });
  // The throwing-proxy case specifically must fail closed to the safe plan.
  {
    const p = planMemoryTurnLoad(new Proxy({}, { get() { throw new Error('trap'); } }) as MemoryTurnPlanInput);
    assertEq(p.loadStartupBundle, false, 'throwing-proxy: fail-closed startup off');
    assertEq(p.reuseFromStores, false, 'throwing-proxy: fail-closed no reuse');
    assert(p.reason.indexOf('error') !== -1, 'throwing-proxy: reason flags error');
  }
  // Huge input still yields a bounded reason.
  {
    const p = planMemoryTurnLoad({ complexity: 'z'.repeat(50000), hasQuery: 'q'.repeat(50000) } as MemoryTurnPlanInput);
    assert(p.reason.length <= 200, 'huge input: reason still bounded');
  }

  // ── Group 12: secret-safety — reason echoes only enum values, never content
  {
    const secret = 'sk-live-DEADBEEF-super-secret-token';
    const p = planMemoryTurnLoad({ complexity: secret, hasQuery: secret, contextDepth: secret } as MemoryTurnPlanInput);
    assert(p.reason.indexOf(secret) === -1, 'reason does not leak caller content');
    assert(p.reason.indexOf('DEADBEEF') === -1, 'reason does not leak secret fragment');
  }

  if (failures > 0) {
    console.error('\n' + failures + ' fail');
    process.exit(1);
  }
  console.log('\nAll memory-turn-assembly-core smoke cases passed (' + passes + ' passed).');
}

main();
