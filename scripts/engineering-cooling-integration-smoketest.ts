/**
 * engineering-cooling-integration — proof that the THERMAL + FLUID tools compose,
 * completing the integration story (bracket = statics, gearbox = transmission,
 * this = heat + flow). A liquid-cooled cold plate carrying a component's heat:
 *
 *   a 50 W component sits on a 100×100×5 aluminium cold plate; heat conducts
 *   through the plate to a water channel that flows it away.
 *
 *   1. thermal path   composite_wall: conduction through the plate + film to the
 *                      coolant → the heat rate the path carries, and the junction temp
 *   2. design check    that heat rate at the temperature budget must exceed 50 W
 *   3. coolant loop    pipe_flow: the water carries the heat → Reynolds, pressure drop
 *   4. growth          thermal_expansion: the plate grows (same aluminium as the k)
 *   5. geometry        model the cold plate; mass composes the material density
 *
 * The seams: the material's k sets the conduction resistance AND its α sets the
 * expansion (one aluminium); the plate area feeds the thermal path AND the solid
 * model; the dissipation the path can shed is the load the design must beat.
 */

import { materialProps, thermalExpansion } from '../src/lib/engineeringCalcCore';
import { compositeWall, conduction, convection } from '../src/lib/engineeringThermalCore';
import { pipeFlow } from '../src/lib/engineeringFluidCore';
import { validateSolidModel, type SolidModel } from '../src/lib/engineeringSolidModelingCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function need<T extends { ok: boolean }>(r: T, label: string): T { if (!r.ok) { failures.push(label); console.error(`FAIL: ${label} — not ok`); process.exit(1); } return r; }

function main() {
  // ── duty ──
  const dissipation_W = 50, junctionLimit_C = 85, coolant_C = 25;
  const plateSide_mm = 100, plateThick_mm = 5, filmH = 100; // W/m²·K to the coolant
  const area_m2 = (plateSide_mm / 1000) ** 2; // 0.01 m²

  // 1. MATERIAL — aluminium provides BOTH k (for conduction) and α (for growth).
  const al = need(materialProps('aluminum'), 'material');
  near(al.extra!.k_W_per_mK, 167, 'aluminium k = 167 W/m·K');
  near(al.extra!.alpha_per_C, 23.6e-6, 'aluminium α = 23.6e-6 /°C');

  // 2. THERMAL PATH — conduction through the plate + a film to the coolant, in series.
  const wall = need(compositeWall({
    area: area_m2, hotTemperature: junctionLimit_C, coldTemperature: coolant_C,
    layers: [{ material: 'aluminum', thickness: plateThick_mm, label: 'cold plate' }],
    outsideFilm: filmH,
  }), 'composite wall');
  // the composite total R is the series sum of the conduction and the film resistances.
  const rCond = need(conduction({ material: 'aluminum', area: area_m2, thickness: plateThick_mm, deltaT: 1 }), 'conduction');
  const rConv = need(convection({ h: filmH, area: area_m2, deltaT: 1 }), 'convection');
  near(wall.value.totalResistance_K_per_W, rCond.value.thermalResistance_K_per_W + rConv.value.thermalResistance_K_per_W, 'CROSS-CHECK: composite R = conduction R + film R (series)');
  assert(rConv.value.thermalResistance_K_per_W > 100 * rCond.value.thermalResistance_K_per_W, 'the film dominates — the thin aluminium barely resists heat');

  // 3. DESIGN CHECK — at the temperature budget the path must shed more than 50 W.
  const Qmax = wall.value.heatRate_W;
  assert(Qmax > dissipation_W, `the path sheds ${Qmax.toFixed(1)} W at ΔT=60 — more than the 50 W dissipation ✓`);
  // at the actual 50 W the junction rises to cold + Q·R, which must stay under the limit.
  const junctionTemp = coolant_C + dissipation_W * wall.value.totalResistance_K_per_W;
  assert(junctionTemp < junctionLimit_C, `CROSS-CHECK: at 50 W the junction runs ${junctionTemp.toFixed(1)} °C < ${junctionLimit_C} °C limit`);

  // 4. COOLANT LOOP — the water that carries the heat away.
  // a 300 mm coolant channel — length_mm keeps units consistent with the mm diameter.
  const flow = need(pipeFlow({ diameter: 8, flowRate: 2, fluid: 'water', length_mm: 300, roughness: 0 }), 'coolant flow');
  assert(flow.value.reynolds > 0 && flow.value.velocity_m_s > 0, `coolant: ${flow.value.flowRate_L_min} L/min → ${flow.value.velocity_m_s} m/s, Re ${flow.value.reynolds}`);
  assert(flow.value.pressureDrop_kPa! > 0 && flow.value.pressureDrop_kPa! < 1, `coolant pressure drop ${flow.value.pressureDrop_kPa} kPa over 300 mm — the pump must overcome it`);
  near(flow.value.length_m!, 0.3, 'length_mm 300 → 0.3 m (units consistent with the mm diameter)');

  // 5. GROWTH — the plate warms and expands; SAME aluminium as the conduction.
  const warmRise = junctionTemp - coolant_C; // ≈ 50 °C
  const grow = need(thermalExpansion({ length: plateSide_mm, deltaT: warmRise, material: 'aluminum' }), 'expansion');
  near(grow.extra!.alpha_per_C, al.extra!.alpha_per_C, 'CROSS-CHECK: the expansion uses the SAME aluminium α as the material lookup');
  assert(grow.value > 0 && grow.value < 0.2, `plate grows ${grow.value} mm across 100 mm — allow for it in the mounting`);

  // 6. GEOMETRY — model the cold plate; mass composes the material density.
  const plate: SolidModel = {
    positives: [{ kind: 'box', w: plateSide_mm, d: plateSide_mm, h: plateThick_mm, cz: plateThick_mm / 2 }],
    negatives: [{ kind: 'cylinder', r: 4, h: plateThick_mm + 2, cx: 0, cy: -40, cz: plateThick_mm / 2, axis: 'z' }], // coolant inlet port
  };
  assert(validateSolidModel(plate).ok, 'the cold-plate model is valid');
  const volume = plateSide_mm * plateSide_mm * plateThick_mm - Math.PI * 4 * 4 * plateThick_mm;
  const mass = volume * al.extra!.density_kg_per_mm3;
  near(mass, volume * 2.70e-6, 'CROSS-CHECK: plate mass = model volume × the SAME aluminium density');
  assert(mass > 0.12 && mass < 0.16, `cold-plate mass ≈ ${Math.round(mass * 1000)} g`);

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-cooling-integration failure(s)`); process.exit(1); }
  console.log('All engineering-cooling-integration cases passed — the thermal + fluid tools compose.');
}

main();
