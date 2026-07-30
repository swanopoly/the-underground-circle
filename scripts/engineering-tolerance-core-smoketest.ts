/**
 * engineering-tolerance-core smoke.
 *
 * ISO 286 limits/fits are pinned against the STANDARD TABLE at several sizes: the
 * IT grade widths (from the published table), the hole/shaft fundamental
 * deviations (from the exact letter formulas), and the resulting fits. Ø50 H7/g6
 * is the textbook 9–50 µm clearance; Ø10 g6 is −5/−14. The stack-up is pinned on
 * worst-case (arithmetic Σ) and statistical RSS (√Σtol²), including a subtractive
 * chain (a gap = outer − inner).
 */

import {
  itToleranceMicrons, holeDeviations, shaftDeviations, isoFit, fitClearanceExplicit, toleranceStackup,
} from '../src/lib/engineeringToleranceCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-4) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── IT grade widths vs the published table ──────────────────────
  {
    assert(itToleranceMicrons(50, 7) === 25, 'IT7 @ Ø50 = 25 µm');
    assert(itToleranceMicrons(50, 6) === 16, 'IT6 @ Ø50 = 16 µm');
    assert(itToleranceMicrons(10, 7) === 15, 'IT7 @ Ø10 = 15 µm (table, not round(16i)=14)');
    assert(itToleranceMicrons(30, 7) === 21, 'IT7 @ Ø30 = 21 µm');
    assert(itToleranceMicrons(100, 6) === 22, 'IT6 @ Ø100 = 22 µm');
    assert(itToleranceMicrons(50, 4) === null, 'IT4 unsupported (table is IT5–IT11)');
    assert(itToleranceMicrons(600, 7) === null, 'Ø600 beyond the 500mm table');
  }

  // ─── Hole / shaft fundamental deviations ─────────────────────────
  {
    const H7 = ok(holeDeviations('H7', 50), 'H7@50');
    assert(H7.ES === 25 && H7.EI === 0, 'H7 hole @ Ø50 = 0 / +25 µm');
    const g6 = ok(shaftDeviations('g6', 50), 'g6@50');
    assert(g6.es === -9 && g6.ei === -25, 'g6 shaft @ Ø50 = −9 / −25 µm');
    const g6b = ok(shaftDeviations('g6', 10), 'g6@10');
    assert(g6b.es === -5 && g6b.ei === -14, 'g6 shaft @ Ø10 = −5 / −14 µm');
    const h6 = ok(shaftDeviations('h6', 50), 'h6@50');
    assert(h6.es === 0 && h6.ei === -16, 'h6 shaft @ Ø50 = 0 / −16 µm');
    const f7 = ok(shaftDeviations('f7', 50), 'f7@50');
    assert(f7.es === -25 && f7.ei === -50, 'f7 shaft @ Ø50 = −25 / −50 µm');
    const k6 = ok(shaftDeviations('k6', 50), 'k6@50');
    assert(k6.ei === 2 && k6.es === 18, 'k6 shaft @ Ø50 = +2 / +18 µm');
    assert(!holeDeviations('G7', 50).ok, 'non-H hole letter rejected (basic-hole system)');
    assert(!shaftDeviations('z6', 50).ok, 'unsupported shaft letter rejected');
  }

  // ─── Fits ────────────────────────────────────────────────────────
  {
    const clr = ok(isoFit(50, 'H7', 'g6'), 'H7/g6');
    assert(clr.fitType === 'clearance', 'H7/g6 is a clearance fit');
    assert(clr.minClearance_um === 9 && clr.maxClearance_um === 50, 'H7/g6 @ Ø50 clearance 9…50 µm (textbook)');
    near(clr.hole.upper_mm, 50.025, 'H7 hole upper = 50.025 mm');
    near(clr.shaft.lower_mm, 49.975, 'g6 shaft lower = 49.975 mm');

    const slide = ok(isoFit(50, 'H7', 'h6'), 'H7/h6');
    assert(slide.minClearance_um === 0 && slide.maxClearance_um === 41, 'H7/h6 @ Ø50 clearance 0…41 µm');

    const trans = ok(isoFit(50, 'H7', 'k6'), 'H7/k6');
    assert(trans.fitType === 'transition', 'H7/k6 is a transition fit (may clear or interfere)');
    assert(trans.minClearance_um === -18 && trans.maxClearance_um === 23, 'H7/k6 @ Ø50 spans −18…+23 µm');

    // explicit deviations reproduce the letter-based fit
    const exp = ok(fitClearanceExplicit(50, { ES: 25, EI: 0 }, { es: -9, ei: -25 }), 'explicit H7/g6');
    assert(exp.minClearance_um === 9 && exp.maxClearance_um === 50, 'explicit deviations match H7/g6');
    assert(!fitClearanceExplicit(50, { ES: 0, EI: 25 } as any, { es: -9, ei: -25 }).ok, 'inverted hole deviations rejected');
  }

  // ─── Tolerance stack-up ──────────────────────────────────────────
  {
    // additive chain 10±0.1 + 20±0.2 + 5±0.05.
    const s = ok(toleranceStackup([
      { nominal: 10, tol: 0.1, label: 'a' }, { nominal: 20, tol: 0.2, label: 'b' }, { nominal: 5, tol: 0.05, label: 'c' },
    ]), 'additive stack');
    near(s.nominal, 35, 'stack nominal = 35');
    near(s.worstCaseTolerance, 0.35, 'worst-case = Σ tolerances = ±0.35');
    near(s.rssTolerance, Math.sqrt(0.1 ** 2 + 0.2 ** 2 + 0.05 ** 2), 'RSS = √Σtol² ≈ ±0.229');
    assert(s.largestContributor!.label === 'b', 'largest contributor is the ±0.2 dimension');
    assert(s.rssTolerance < s.worstCaseTolerance, 'RSS is tighter than worst-case');

    // a gap = 50 − 30 − 15 with subtractive members.
    const gap = ok(toleranceStackup([
      { nominal: 50, tol: 0.1 }, { nominal: 30, tol: 0.05, direction: -1 }, { nominal: 15, tol: 0.05, direction: -1 },
    ]), 'gap stack');
    near(gap.nominal, 5, 'gap nominal = 50 − 30 − 15 = 5');
    near(gap.worstCaseTolerance, 0.2, 'gap worst-case = ±(0.1+0.05+0.05) = ±0.2');
    near(gap.rssTolerance, Math.sqrt(0.1 ** 2 + 0.05 ** 2 + 0.05 ** 2), 'gap RSS = ±0.1225');

    // asymmetric tolerance.
    const asym = ok(toleranceStackup([{ nominal: 10, plus: 0.2, minus: 0.1 }]), 'asymmetric');
    near(asym.max, 10.2, 'asymmetric max = 10.2');
    near(asym.min, 9.9, 'asymmetric min = 9.9');

    assert(!toleranceStackup([]).ok, 'empty stack rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-tolerance-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-tolerance-core smoke cases passed.');
}

main();
