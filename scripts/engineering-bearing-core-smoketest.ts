/**
 * engineering-bearing-core smoke.
 *
 * Bearing life is a steep power law L10 = (C/P)^p (p=3 ball, 10/3 roller), so this
 * pins the textbook case (C=25.5 kN, P=5 kN, ball → 132.65 Mrev, 1474 h at 1500
 * rpm), the roller exponent, the equivalent-load combination P=X·Fr+Y·Fa, the
 * reliability scaling, and the sensitivity that makes the calc matter: halving the
 * load multiplies ball-bearing life by 8, a 26% overload halves it.
 */

import { bearingLife } from '../src/lib/engineeringBearingCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── The textbook ball bearing ───────────────────────────────────
  {
    // C=25500 N, P=5000 N, ball (p=3) → L10 = 5.1³ = 132.651 Mrev; @1500rpm = 1473.9 h.
    const b = ok(bearingLife({ dynamicLoadRating: 25500, equivalentLoad: 5000, bearingType: 'ball', speed_rpm: 1500 }), 'ball');
    near(b.loadRatio_C_over_P, 5.1, 'C/P = 5.1');
    near(b.exponent, 3, 'ball exponent p = 3');
    near(b.basicLife_Mrev, Math.pow(5.1, 3), 'L10 = (C/P)³ = 132.65 million rev');
    near(b.life_hours!, Math.pow(5.1, 3) * 1e6 / (60 * 1500), 'L10h = L10·1e6/(60·n) = 1473.9 h');
  }

  // ─── Roller exponent ─────────────────────────────────────────────
  {
    const roller = ok(bearingLife({ dynamicLoadRating: 25500, equivalentLoad: 5000, bearingType: 'roller' }), 'roller');
    near(roller.exponent, 10 / 3, 'roller exponent p = 10/3');
    near(roller.basicLife_Mrev, Math.pow(5.1, 10 / 3), 'roller L10 = (C/P)^(10/3)');
    assert(roller.basicLife_Mrev > ok(bearingLife({ dynamicLoadRating: 25500, equivalentLoad: 5000, bearingType: 'ball' }), 'ball2').basicLife_Mrev, 'a roller lives longer than a ball at the same C/P > 1');
  }

  // ─── Equivalent load P = X·Fr + Y·Fa ─────────────────────────────
  {
    // Fr=4000, Fa=2000, X=0.56, Y=1.5 → P = 0.56·4000 + 1.5·2000 = 5240.
    const b = ok(bearingLife({ dynamicLoadRating: 30000, radialLoad: 4000, axialLoad: 2000, X: 0.56, Y: 1.5 }), 'combined load');
    near(b.equivalentLoad_N, 0.56 * 4000 + 1.5 * 2000, 'P = X·Fr + Y·Fa = 5240 N');
    // pure radial default (X=1, Y=0).
    near(ok(bearingLife({ dynamicLoadRating: 30000, radialLoad: 4000 }), 'radial').equivalentLoad_N, 4000, 'default pure radial → P = Fr');
  }

  // ─── Reliability adjustment (ISO 281 a1) ─────────────────────────
  {
    const base = ok(bearingLife({ dynamicLoadRating: 25500, equivalentLoad: 5000 }), 'L10');
    const r99 = ok(bearingLife({ dynamicLoadRating: 25500, equivalentLoad: 5000, reliability: 99 }), 'L1');
    near(r99.a1, 0.25, '99% reliability → a1 = 0.25');
    near(r99.basicLife_Mrev, 0.25 * base.basicLife_Mrev, 'higher reliability shortens the rated life ×a1');
    assert(!bearingLife({ dynamicLoadRating: 25500, equivalentLoad: 5000, reliability: 99.99 }).ok, 'unsupported reliability rejected');
  }

  // ─── The power-law sensitivity that makes the calc matter ────────
  {
    const nominal = ok(bearingLife({ dynamicLoadRating: 20000, equivalentLoad: 4000, bearingType: 'ball' }), 'nominal');
    const halfLoad = ok(bearingLife({ dynamicLoadRating: 20000, equivalentLoad: 2000, bearingType: 'ball' }), 'half load');
    near(halfLoad.basicLife_Mrev, 8 * nominal.basicLife_Mrev, 'halving the load → 8× ball life (cube law)');
    const overload = ok(bearingLife({ dynamicLoadRating: 20000, equivalentLoad: 4000 * Math.cbrt(2), bearingType: 'ball' }), 'overload');
    near(overload.basicLife_Mrev, nominal.basicLife_Mrev / 2, 'a 26% overload (∛2) halves the life');
  }

  // ─── Validation ──────────────────────────────────────────────────
  {
    assert(!bearingLife({ equivalentLoad: 5000 } as any).ok, 'no load rating rejected');
    assert(!bearingLife({ dynamicLoadRating: 25500 } as any).ok, 'no load rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-bearing-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-bearing-core smoke cases passed.');
}

main();
