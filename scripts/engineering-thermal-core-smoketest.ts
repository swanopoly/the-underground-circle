/**
 * engineering-thermal-core smoke.
 *
 * Heat transfer is Ohm's law with temperature as voltage and Q as current, so
 * this pins the resistances (conduction R = L/kA, convection R = 1/hA) and the
 * heat rate Q = ΔT/R against hand computation, then the composite wall: series
 * resistances add, one heat rate flows through all layers, and each interface
 * temperature drops Q·R. The insulation-dominates behaviour and energy balance
 * (interfaces run hot→cold, ending at the cold face) are the invariants.
 */

import { conduction, convection, compositeWall } from '../src/lib/engineeringThermalCore';

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
  // ─── Conduction ──────────────────────────────────────────────────
  {
    // k=50, A=1 m², L=100mm=0.1m, ΔT=100 → R=0.002, Q=50000 W.
    const c = ok(conduction({ k: 50, area: 1, thickness: 100, deltaT: 100 }), 'conduction');
    near(c.thermalResistance_K_per_W, 0.1 / (50 * 1), 'R = L/(k·A) = 0.002 K/W');
    near(c.heatRate_W, 50000, 'Q = k·A·ΔT/L = 50000 W');
    near(c.fluxDensity_W_per_m2, 50000, 'flux = Q/A = 50000 W/m²');
    // material lookup gives the same as an explicit k.
    const steel = ok(conduction({ material: 'steel', area: 1, thickness: 100, deltaT: 100 }), 'steel wall');
    near(steel.conductivity_W_per_mK, 50, 'steel k = 50 W/m·K from the material table');
    // aluminum conducts far more than ABS for the same wall.
    const al = ok(conduction({ material: 'aluminum', area: 1, thickness: 10, deltaT: 50 }), 'alu');
    const abs = ok(conduction({ material: 'abs', area: 1, thickness: 10, deltaT: 50 }), 'abs');
    assert(al.heatRate_W > 900 * abs.heatRate_W, 'aluminum conducts ~1000× an insulating plastic');
    assert(!conduction({ area: 1, thickness: 100, deltaT: 100 } as any).ok, 'no k / material rejected');
  }

  // ─── Convection ──────────────────────────────────────────────────
  {
    // h=25, A=2, ΔT=40 → Q=2000 W, R=1/(25·2)=0.02.
    const v = ok(convection({ h: 25, area: 2, deltaT: 40 }), 'convection');
    near(v.heatRate_W, 2000, 'Q = h·A·ΔT = 2000 W');
    near(v.thermalResistance_K_per_W, 1 / (25 * 2), 'R = 1/(h·A) = 0.02 K/W');
  }

  // ─── Composite wall (series resistances) ─────────────────────────
  {
    // steel skin (k=50, 10mm) + insulation (k=0.04, 50mm), A=1, 100°C→0°C.
    const w = ok(compositeWall({
      area: 1, hotTemperature: 100, coldTemperature: 0,
      layers: [{ material: 'steel', thickness: 10, label: 'steel' }, { k: 0.04, thickness: 50, label: 'insulation' }],
    }), 'composite');
    const R1 = (10 / 1000) / (50 * 1), R2 = (50 / 1000) / (0.04 * 1);
    near(w.totalResistance_K_per_W, R1 + R2, 'total R = ΣR (series)');
    near(w.heatRate_W, 100 / (R1 + R2), 'Q = ΔT/ΣR');
    // the insulation carries essentially all the resistance.
    assert(w.layers[1].resistance_K_per_W > 1000 * w.layers[0].resistance_K_per_W, 'insulation R ≫ steel R');
    // interface temps: hot face 100, cold face ~0, and steel barely drops any.
    near(w.interfaceTemperatures_C[0], 100, 'hot face = 100 °C');
    near(w.interfaceTemperatures_C[w.interfaceTemperatures_C.length - 1], 0, 'cold face = 0 °C', 2e-3);
    assert(w.interfaceTemperatures_C[1] > 99.9, 'temperature barely drops across the conductive steel skin');
    // monotone hot → cold.
    for (let i = 1; i < w.interfaceTemperatures_C.length; i += 1) assert(w.interfaceTemperatures_C[i] <= w.interfaceTemperatures_C[i - 1] + 1e-6, `interface ${i} not hotter than ${i - 1}`);
  }

  // ─── Composite wall with surface films ───────────────────────────
  {
    const w = ok(compositeWall({
      area: 1, hotTemperature: 20, coldTemperature: -5,
      layers: [{ k: 0.035, thickness: 100, label: 'fibreglass' }],
      insideFilm: 8, outsideFilm: 25,
    }), 'walls + films');
    // total R = 1/(8·1) + (0.1/0.035) + 1/(25·1).
    near(w.totalResistance_K_per_W, 1 / 8 + (0.1 / 0.035) + 1 / 25, 'films add series resistance');
    assert(w.layers.length === 3 && w.layers[0].kind === 'convection' && w.layers[2].kind === 'convection', 'film resistors bracket the conduction layer');
    near(w.uValue_W_per_m2K, 1 / (w.totalResistance_K_per_W * 1), 'U = 1/(R·A)');
    assert(!compositeWall({ area: 1, hotTemperature: 20, coldTemperature: 0, layers: [] }).ok, 'no layers rejected');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-thermal-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-thermal-core smoke cases passed.');
}

main();
