/**
 * engineering-fin-core smoke — the smoke IS the proof (no app, no network).
 *
 * A fin is conduction ALONG the metal (k·Ac) fighting convection OFF its surface
 * (h·P), and the whole balance collapses to one dimensionless group mL where
 * m = √(hP/kAc). This pins:
 *   • the DEFINING efficiency limits η = tanh(mL)/(mL) → 1 as mL→0 (a short, fat,
 *     high-k fin is nearly isothermal = ideal) and → 0 as mL→∞ (a long fin's tip
 *     is dead weight), plus its monotone decrease with length;
 *   • the heat rate Q = √(hPkAc)·θb·tanh(mL) rising with length but SATURATING
 *     (tanh→1) — the diminishing returns of adding fin;
 *   • the effectiveness ε = Q/(h·Ac·θb), which must clear ~2 to justify a fin and
 *     FALLS as h rises — a fin only helps when convection is the bottleneck;
 *   • a hand-computed Incropera/Cengel textbook case (k,h,geometry → m,η,Q,Ttip);
 *   • composition with MATERIALS (k): a high-k fin beats a low-k fin of identical
 *     geometry, higher η and higher Q.
 */

import { finAnalysis, finGeometry } from '../src/lib/engineeringFinCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function ok<T>(res: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!res.ok) { failures.push(`${label}: ${res.error}`); console.error(`FAIL: ${label} — ${res.error}`); process.exit(1); }
  return res.value;
}

function main() {
  // ─── 1. Textbook rectangular fin (adiabatic tip) ─────────────────────
  // k=200 W/m·K, h=20 W/m²·K, w=40mm, t=2mm, L=40mm, base 100°C into 20°C air.
  //   Ac = 0.040·0.002 = 8.0e-5 m²,  P = 2(0.040+0.002) = 0.084 m
  //   m  = √(hP/kAc) = √(1.68/0.016) = √105 = 10.24695 /m
  //   mL = 0.409878,  tanh(mL) = 0.38837,  η = 0.94752
  //   M  = √(hPkAc)·θb = √0.02688·80 = 13.1161 W,  Q = M·tanh(mL) = 5.0939 W
  //   ε  = Q/(h·Ac·θb) = 5.0939/0.128 = 39.80,  T_tip = 20 + 80/cosh(mL) = 93.72 °C
  {
    const f = ok(finAnalysis({ material: undefined, k: 200, h: 20, shape: 'rectangular', width: 40, thickness: 2, length: 40, baseTemp: 100, ambientTemp: 20 }), 'rect fin');
    near(f.crossSectionArea_m2, 8.0e-5, 'Ac = w·t = 8.0e-5 m²');
    near(f.perimeter_m, 0.084, 'P = 2(w+t) = 0.084 m');
    near(f.finParameter_per_m, Math.sqrt(105), 'm = √(hP/kAc) = √105 /m');
    near(f.mL, Math.sqrt(105) * 0.04, 'mL = m·L = 0.40988');
    near(f.M_W, Math.sqrt(0.02688) * 80, 'M = √(hPkAc)·θb = 13.1161 W');
    near(f.heatRate_W, 5.0939, 'Q = M·tanh(mL) = 5.0939 W', 2e-3);
    near(f.efficiency, 0.94752, 'η = tanh(mL)/(mL) = 0.94752');
    near(f.effectiveness, 39.796, 'ε = Q/(h·Ac·θb) = 39.80', 2e-3);
    near(f.baseExcess_K, 80, 'θb = Tb − T∞ = 80 K');
    near(f.tipTemperature_C ?? NaN, 93.721, 'T_tip = T∞ + θb/cosh(mL) = 93.72 °C');
    // efficiency identity: ε = η · (Af/Ac).
    near(f.effectiveness, f.efficiency * (f.finSurfaceArea_m2 / f.crossSectionArea_m2), 'ε = η·(Af/Ac) identity');
    // temperature profile: hot base → cooler tip, monotone, base = θb.
    near(f.profileExcess_K[0], 80, 'θ(0) = θb (base)');
    near(f.profileExcess_K[4], f.tipExcess_K, 'θ(L) = tip excess');
    for (let i = 1; i < f.profileExcess_K.length; i += 1) assert(f.profileExcess_K[i] < f.profileExcess_K[i - 1], `profile station ${i} cooler than ${i - 1}`);
    assert(f.effectiveness > 2, 'thin high-k fin in air is worth it (ε > 2)');
    assert(f.shape === 'rectangular' && f.tip === 'adiabatic', 'shape/tip reported');
  }

  // ─── 2. Pin (spine) fin geometry + internal consistency ──────────────
  {
    // d=10mm, L=100mm, k=200, h=20, θb=80.  Ac=πd²/4, P=πd, m=√40.
    const p = ok(finAnalysis({ k: 200, h: 20, shape: 'pin', diameter: 10, length: 100, thetaBase: 80 }), 'pin fin');
    near(p.crossSectionArea_m2, (Math.PI * 0.01 * 0.01) / 4, 'pin Ac = πd²/4');
    near(p.perimeter_m, Math.PI * 0.01, 'pin P = πd');
    near(p.finParameter_per_m, Math.sqrt(40), 'pin m = √40 /m');
    near(p.efficiency, 0.88489, 'pin η = tanh(0.63246)/0.63246');
    near(p.heatRate_W, 4.449, 'pin Q ≈ 4.449 W', 2e-3);
    // effectiveness recomputed from the reported heat rate (self-consistency).
    near(p.effectiveness, p.heatRate_W / (20 * p.crossSectionArea_m2 * 80), 'pin ε = Q/(h·Ac·θb)');
    const geom = ok(finGeometry({ shape: 'pin', diameter: 10 }), 'finGeometry pin');
    assert(geom.shape === 'pin', 'finGeometry classifies a pin');
  }

  // ─── 3. Efficiency limits — the defining anchors ─────────────────────
  {
    // η → 1: short, fat, high-conductivity fin is nearly isothermal (mL → 0).
    const stubby = ok(finAnalysis({ k: 400, h: 5, shape: 'rectangular', width: 100, thickness: 20, length: 2, thetaBase: 60 }), 'stubby fin');
    assert(stubby.mL < 0.01, 'stubby fin has mL → 0');
    assert(stubby.efficiency > 0.999, 'η → 1 for a short/fat/high-k fin (nearly ideal)');

    // η → 0: long, thin, low-conductivity fin — the tip is dead weight (mL → ∞).
    const noodle = ok(finAnalysis({ material: 'abs', h: 100, shape: 'rectangular', width: 50, thickness: 1, length: 200, thetaBase: 60 }), 'noodle fin');
    assert(noodle.mL > 50, 'long thin low-k fin has mL → ∞');
    assert(noodle.efficiency < 0.01, 'η → 0 for a very long fin (tip is dead weight)');
    // at mL → ∞, tanh → 1, so Q → M (the infinite-fin ceiling).
    near(noodle.heatRate_W, noodle.M_W, 'Q → M as tanh(mL) → 1');

    // monotone decrease of η with length (fixed everything else).
    const lengths = [5, 10, 20, 40, 80, 160];
    const etas = lengths.map((L) => ok(finAnalysis({ k: 200, h: 50, shape: 'rectangular', width: 40, thickness: 2, length: L, thetaBase: 80 }), `sweep η L=${L}`).efficiency);
    for (let i = 1; i < etas.length; i += 1) assert(etas[i] < etas[i - 1], `η decreases with length (L=${lengths[i]} < L=${lengths[i - 1]})`);
    assert(etas[0] > 0.99 && etas[etas.length - 1] < 0.5, 'η spans near-1 (short) to low (long)');
  }

  // ─── 4. Heat rate rises but SATURATES with length (diminishing returns) ─
  {
    const lengths = [5, 10, 20, 40, 80, 160];
    const runs = lengths.map((L) => ok(finAnalysis({ k: 200, h: 50, shape: 'rectangular', width: 40, thickness: 2, length: L, thetaBase: 80 }), `sweep Q L=${L}`));
    for (let i = 1; i < runs.length; i += 1) assert(runs[i].heatRate_W > runs[i - 1].heatRate_W, `Q increases with length (L=${lengths[i]})`);
    // diminishing returns: the last doubling (80→160) adds LESS than the previous (40→80).
    const gainLate = runs[5].heatRate_W - runs[4].heatRate_W; // 80 → 160 mm
    const gainMid = runs[4].heatRate_W - runs[3].heatRate_W; // 40 → 80 mm
    assert(gainLate < gainMid, 'diminishing returns: doubling a long fin adds less heat');
    // Q never exceeds the M ceiling, and the long fin is ~saturated (tanh > 0.98).
    for (const run of runs) assert(run.heatRate_W < run.M_W, 'Q < M (tanh < 1) always');
    assert(runs[5].heatRate_W / runs[5].M_W > 0.98, 'the long fin has essentially saturated (Q/M > 0.98)');

    // huge fin: Q → M within float precision.
    const huge = ok(finAnalysis({ k: 200, h: 50, shape: 'rectangular', width: 40, thickness: 2, length: 1000, thetaBase: 80 }), 'huge fin');
    near(huge.heatRate_W, huge.M_W, 'Q = M for an effectively infinite fin');
  }

  // ─── 5. Effectiveness — a fin only helps when h is the bottleneck ────
  {
    // A copper pin fin (very high k) in still AIR (low h) is highly effective.
    const cuAir = ok(finAnalysis({ k: 400, h: 10, shape: 'pin', diameter: 3, length: 30, thetaBase: 50 }), 'copper fin in air');
    assert(cuAir.effectiveness > 2, 'copper fin in low-h air: ε >> 2 (well worth it)');

    // The SAME fin loses effectiveness as h rises — ε strictly decreases in h.
    const hs = [10, 50, 200, 1000];
    const eps = hs.map((h) => ok(finAnalysis({ k: 400, h, shape: 'pin', diameter: 3, length: 30, thetaBase: 50 }), `ε(h=${h})`).effectiveness);
    for (let i = 1; i < eps.length; i += 1) assert(eps[i] < eps[i - 1], `ε falls as h rises (h=${hs[i]} < h=${hs[i - 1]})`);
    assert(eps[3] < eps[0], 'vigorous convection => far lower effectiveness than still air');

    // A poor-conductor fin in a VERY high-h environment is not worth adding (ε < 2):
    // convection is no longer the bottleneck, so the fin barely beats the bare base.
    const badFin = ok(finAnalysis({ material: 'stainless', h: 10000, shape: 'rectangular', width: 50, thickness: 1, length: 20, thetaBase: 40 }), 'stainless fin in boiling');
    assert(badFin.effectiveness < 2, 'low-k fin in high-h flow: ε < 2 (not worth it)');
  }

  // ─── 6. Composition with MATERIALS (k) — high-k fin beats low-k fin ──
  {
    // Copper (explicit high k) vs steel (from MATERIALS) — identical geometry.
    const copper = ok(finAnalysis({ k: 400, h: 50, shape: 'rectangular', width: 40, thickness: 2, length: 100, thetaBase: 80 }), 'copper fin');
    const steel = ok(finAnalysis({ material: 'steel', h: 50, shape: 'rectangular', width: 40, thickness: 2, length: 100, thetaBase: 80 }), 'steel fin');
    near(steel.conductivity_W_per_mK, 50, 'steel k = 50 W/m·K from MATERIALS');
    assert(copper.efficiency > steel.efficiency, 'copper fin has higher efficiency than steel (higher k)');
    assert(copper.heatRate_W > steel.heatRate_W, 'copper fin dissipates more heat than steel (higher k)');

    // Aluminium vs steel — BOTH k values come from MATERIALS.
    const alu = ok(finAnalysis({ material: 'aluminum', h: 50, shape: 'rectangular', width: 40, thickness: 2, length: 100, thetaBase: 80 }), 'aluminum fin');
    near(alu.conductivity_W_per_mK, 167, 'aluminum k = 167 W/m·K from MATERIALS');
    assert(alu.efficiency > steel.efficiency, 'aluminum fin beats steel on efficiency (k from MATERIALS)');
    assert(alu.heatRate_W > steel.heatRate_W, 'aluminum fin beats steel on heat rate (k from MATERIALS)');
  }

  // ─── 7. Convecting-tip correction (corrected length Lc = L + Ac/P) ────
  {
    const base = { k: 200, h: 20, shape: 'rectangular' as const, width: 40, thickness: 2, length: 40, thetaBase: 80 };
    const adiabatic = ok(finAnalysis({ ...base, tip: 'adiabatic' }), 'adiabatic tip');
    const convecting = ok(finAnalysis({ ...base, tip: 'convective' }), 'convecting tip');
    assert(convecting.correctedLength_m > convecting.length_m, 'corrected length Lc > L');
    near(convecting.correctedLength_m, adiabatic.length_m + adiabatic.crossSectionArea_m2 / adiabatic.perimeter_m, 'Lc = L + Ac/P');
    assert(convecting.heatRate_W > adiabatic.heatRate_W, 'convecting tip sheds more heat than an insulated tip');
    assert(convecting.efficiency < adiabatic.efficiency, 'convecting tip lowers efficiency (larger effective mL)');
  }

  // ─── 8. Validation / fail-closed ─────────────────────────────────────
  {
    assert(!finAnalysis({ h: 20, shape: 'pin', diameter: 5, length: 30, thetaBase: 50 } as any).ok, 'no conductivity rejected');
    assert(!finAnalysis({ k: 200, shape: 'pin', diameter: 5, length: 30, thetaBase: 50 } as any).ok, 'no h rejected');
    assert(!finAnalysis({ k: 200, h: 20, length: 30, thetaBase: 50 } as any).ok, 'no shape/geometry rejected');
    assert(!finAnalysis({ k: 200, h: 20, shape: 'pin', diameter: 5, thetaBase: 50 } as any).ok, 'no length rejected');
    assert(!finAnalysis({ k: 200, h: 20, shape: 'pin', diameter: 5, length: 30 } as any).ok, 'no base excess rejected');
    assert(!finAnalysis({ k: 200, h: 20, shape: 'pin', diameter: 5, length: 30, baseTemp: 20, ambientTemp: 100 } as any).ok, 'ambient hotter than base rejected');
    // custom SI geometry is accepted.
    const custom = ok(finAnalysis({ k: 200, h: 20, crossSectionArea: 8e-5, perimeter: 0.084, length: 40, thetaBase: 80 }), 'custom geometry');
    assert(custom.shape === 'custom', 'explicit Ac + perimeter → custom shape');
    near(custom.finParameter_per_m, Math.sqrt(105), 'custom fin m matches the rectangular equivalent');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-fin-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-fin-core smoke cases passed.');
}

main();
