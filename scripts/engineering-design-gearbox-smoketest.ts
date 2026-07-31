/**
 * engineering-design-gearbox smoke.
 *
 * The one-call gearbox designer packages the PROVEN gearbox-design integration
 * chain (engineering-gearbox-design-integration-smoketest.ts). So this smoke is
 * a verification RECIPE, not an answer key:
 *  - the 5 kW / 1500 rpm / 3:1 drill case must AGREE with the drill's
 *    hand-chained numbers where the inputs coincide (T1, T2, Ft, M, Ø25, 8×7 key);
 *  - every sized output must ROUND-TRIP back through the lane that sized it
 *    (shaft Ø → shaftDiameter/shaftFatigue, key L → keyTorqueCapacity ≥ T2,
 *    C → bearingLife ≥ target hours, module/teeth/face → lewisBendingStress ≤ allow);
 *  - doubling the power must not SHRINK any sized dimension;
 *  - realised safety factors must beat the target because sizes were rounded UP;
 *  - ratio 1 works, bad inputs fail with helpful messages.
 */

import { designGearbox, STANDARD_MODULES_MM, STOCK_SHAFT_DIAMETERS_MM } from '../src/lib/engineeringDesignGearboxCore';
import { lewisBendingStress } from '../src/lib/engineeringGearStrengthCore';
import { shaftDiameter, shaftFatigue } from '../src/lib/engineeringShaftDesignCore';
import { keyTorqueCapacity, standardKeySize } from '../src/lib/engineeringKeyCore';
import { bearingLife } from '../src/lib/engineeringBearingCore';
import { MATERIALS } from '../src/lib/engineeringCalcCore';
import { nominalBoundingBox } from '../src/lib/engineeringSolidModelingCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}
function bad(r: { ok: boolean; error?: string }, pattern: RegExp, label: string) {
  assert(!r.ok && typeof (r as any).error === 'string' && pattern.test((r as any).error), `${label}${r.ok ? ' (unexpectedly ok)' : ` — "${(r as any).error}"`}`);
}

function main() {
  const Sy = MATERIALS.steel.yield; // 250

  // ─── 1. The drill's 5 kW / 1500 rpm / 3:1 steel case (designer defaults) ───
  const g = ok(designGearbox({ power_kW: 5, inputSpeed_rpm: 1500, ratio: 3 }), 'default 5 kW gearbox');
  const d = g.dimensions;
  assert(g.type === 'gearbox', 'type is gearbox');
  near(d.inputTorque_Nm, 31.831, 'T1 = P/ω ≈ 31.83 N·m (drill agreement)');
  near(d.outputTorque_Nm, 95.493, 'T2 = T1·ratio ≈ 95.49 N·m (drill agreement)');
  near(d.outputSpeed_rpm, 500, 'output speed = 1500/3 = 500 rpm');
  near(d.ratio, 3, 'realised ratio 3:1');
  assert(d.gearTeeth === 3 * d.pinionTeeth, 'gearTeeth = pinionTeeth·ratio exactly');
  assert(d.pinionTeeth >= 18, 'pinion ≥ 18 teeth (undercut avoided)');
  assert(STANDARD_MODULES_MM.includes(d.module_mm), `module ${d.module_mm} is in the standard series`);
  near(d.faceWidth_mm, 10 * d.module_mm, 'face width = 10·module');
  near(d.centerDistance_mm, (d.module_mm * (d.pinionTeeth + d.gearTeeth)) / 2, 'centre distance C = m·(N1+N2)/2');

  // the tooth-force invariant Ft = T2/r2 = T1/r1 at whatever module it picked
  const r1 = (d.module_mm * d.pinionTeeth) / 2, r2 = (d.module_mm * d.gearTeeth) / 2;
  near(d.toothForce_N, (d.outputTorque_Nm * 1000) / r2, 'INVARIANT: Ft = T2/r2');
  near(d.toothForce_N, (d.inputTorque_Nm * 1000) / r1, 'INVARIANT: Ft = T1/r1 (equal and opposite on both gears)');
  const phi = (20 * Math.PI) / 180;
  near(d.radialForce_N, d.toothForce_N * Math.tan(phi), 'Wr = Ft·tanφ');
  near(d.normalForce_N, Math.hypot(d.toothForce_N, d.radialForce_N), 'Wn = Ft/cosφ = hypot(Ft, Wr) — two ways agree');
  if (d.module_mm === 4 && d.pinionTeeth === 20) near(d.toothForce_N, 795.7747, 'Ft ≈ 795.77 N at m4/Z20');

  // module MINIMALITY: the returned module passes Lewis, the previous standard one does not
  const allow = Sy / 2;
  const lewAt = (m: number) => ok(lewisBendingStress({ module: m, teeth: d.pinionTeeth, faceWidth: 10 * m, torque_Nm: d.inputTorque_Nm }), `lewis at m${m}`);
  assert((lewAt(d.module_mm) as any) <= allow + 1e-9, `ROUND-TRIP: pinion Lewis σ at chosen m=${d.module_mm} ≤ allowable ${allow} MPa`);
  const mi = STANDARD_MODULES_MM.indexOf(d.module_mm);
  assert(mi > 0 && (lewAt(STANDARD_MODULES_MM[mi - 1]) as any) > allow, `MINIMALITY: previous standard module m=${STANDARD_MODULES_MM[mi - 1]} fails Lewis (over ${allow} MPa)`);

  // statics seam: M = Wn·L/4 and R = Wn/2 from the same force
  near(d.bendingMoment_Nmm, (d.normalForce_N * d.bearingSpan_mm) / 4, 'SEAM: M = Wn·span/4');
  near(d.bearingReaction_N, d.normalForce_N / 2, 'SEAM: bearing reaction R = Wn/2 (two reactions close the statics)');
  near(d.bearingSpan_mm, Math.ceil((8 * d.shaftDiameter_mm) / 10) * 10, 'default span = 8·Ø rounded up to 10 mm (fixpoint closed)');

  // ─── 2. ROUND-TRIPS: every sized output back through its sizing lane ───────
  assert(STOCK_SHAFT_DIAMETERS_MM.includes(d.shaftDiameter_mm), `shaft Ø${d.shaftDiameter_mm} is a stock size`);
  const st = ok(shaftDiameter({ bendingMoment: d.bendingMoment_Nmm, torque: d.outputTorque_Nm * 1000, safetyFactor: 2, material: 'steel' }), 'shaftDiameter round-trip');
  near(st.recommendedDiameter, d.requiredShaftDiameterStatic_mm, 'ROUND-TRIP: static required Ø reproduces shaftDiameter (MSST capstone)');
  assert(d.shaftDiameter_mm >= d.requiredShaftDiameterStatic_mm, 'stock Ø ≥ static requirement (rounded UP)');
  const Su = 1.76 * Sy, Se = Math.min(0.5 * Su, 700);
  const ft = ok(shaftFatigue({ alternatingMoment: d.bendingMoment_Nmm, meanTorque: d.outputTorque_Nm * 1000, endurance: Se, ultimate: Su, safetyFactor: 2 }), 'shaftFatigue round-trip');
  near(ft.requiredDiameter, d.requiredShaftDiameterFatigue_mm, 'ROUND-TRIP: fatigue required Ø reproduces shaftFatigue (DE-Goodman, stated Se/Su assumption)');
  assert(d.shaftDiameter_mm >= d.requiredShaftDiameterFatigue_mm, 'stock Ø ≥ fatigue requirement');

  const std = ok(standardKeySize(d.shaftDiameter_mm), 'standardKeySize round-trip');
  assert(std.width_mm === d.keyWidth_mm && std.height_mm === d.keyHeight_mm, `key section ${d.keyWidth_mm}×${d.keyHeight_mm} = the standard table's for Ø${d.shaftDiameter_mm}`);
  const cap = ok(keyTorqueCapacity({ shaftDiameter: d.shaftDiameter_mm, width: d.keyWidth_mm, height: d.keyHeight_mm, length: d.keyLength_mm, material: 'steel' }), 'keyTorqueCapacity round-trip');
  assert(cap.torqueCapacity_Nmm >= d.outputTorque_Nm * 1000 - 1e-6, `ROUND-TRIP: key ${d.keyWidth_mm}×${d.keyHeight_mm}×${d.keyLength_mm} capacity ${cap.torqueCapacity_Nmm} N·mm ≥ T2`);
  assert(d.keyLength_mm <= d.faceWidth_mm, 'key fits inside the gear face (hub length)');

  const brg = ok(bearingLife({ dynamicLoadRating: d.requiredBearingC_N, equivalentLoad: d.bearingReaction_N, bearingType: 'ball', speed_rpm: d.outputSpeed_rpm }), 'bearingLife round-trip');
  assert((brg.life_hours ?? 0) >= d.targetLifeHours - 1, `ROUND-TRIP: C=${d.requiredBearingC_N} N gives L10 = ${Math.round(brg.life_hours ?? 0)} h ≥ ${d.targetLifeHours} h target`);
  near(brg.life_hours ?? 0, d.targetLifeHours, 'required C is TIGHT — life lands near the target (ceil to the next newton, not padded)', 0.01);

  const lewGear = ok(lewisBendingStress({ module: d.module_mm, teeth: d.gearTeeth, faceWidth: d.faceWidth_mm, torque_Nm: d.outputTorque_Nm }), 'gear Lewis round-trip');
  assert((lewGear as any) <= allow, 'ROUND-TRIP: gear tooth σ ≤ allowable too (more teeth → bigger Y → lower σ than pinion)');
  assert((lewGear as any) < (lewAt(d.module_mm) as any), 'the pinion is the weaker gear (higher Lewis stress)');

  // ─── 3. Safety, mass, model, narration ─────────────────────────────────────
  assert(g.safety.realisedSafetyFactor! >= 2, `governing realised safety factor ${g.safety.realisedSafetyFactor} ≥ the 2× target`);
  near(g.safety.allowableStress_MPa!, 125, 'allowable = yield/SF = 125 MPa');
  assert(/governs/.test(g.safety.note), 'safety note names the governing lane');
  // mass recomputed from the stated formula: bored pitch-radius discs + shaft over span+40
  const boreA = Math.PI * (d.shaftDiameter_mm / 2) ** 2;
  const massRef = ((Math.PI * r1 ** 2 - boreA) * d.faceWidth_mm + (Math.PI * r2 ** 2 - boreA) * d.faceWidth_mm + boreA * (d.bearingSpan_mm + 40)) * MATERIALS.steel.density;
  near(g.mass_kg, massRef, 'mass = (bored pitch discs + shaft) × steel density, as the note states');
  assert(g.mass_kg > 0.5 && g.mass_kg < 50, `mass ${g.mass_kg} kg is physically plausible for a 5 kW reducer`);
  // model: two bored discs at the centre distance; bbox spans r1 + C + r2 wide
  const bb = nominalBoundingBox(g.model)!;
  near(bb.maxX - bb.minX, r1 + d.centerDistance_mm + r2, 'model bbox width = r1 + C + r2 (both discs in mesh position)');
  near(bb.maxZ - bb.minZ, d.faceWidth_mm, 'model bbox height = the face width');
  assert(g.model.positives.length === 2 && (g.model.negatives ?? []).length === 2, 'model = 2 gear discs − 2 shaft bores');
  assert(g.bpy.includes('stl_export') && g.bpy.length > 500, 'a ready-to-compile Blender gear-pair script is returned');
  assert(g.bpy.includes('bore'), 'the bpy actually cuts the shaft bore (bore fit was verified, so it was not silently dropped)');
  assert(g.notes.length >= 7, 'notes narrate the whole chain');
  assert(g.notes.some((n) => n.includes(`${d.shaftDiameter_mm}`)) && g.notes.some((n) => /Lewis/.test(n)) && g.notes.some((n) => /L10|bearing/i.test(n)), 'notes carry the actual numbers (shaft Ø, Lewis, bearing)');
  assert(/gearbox/.test(g.summary) && g.summary.includes(`Ø${d.shaftDiameter_mm}`), 'summary names the part and the shaft Ø');

  // ─── 4. Drill agreement with the drill's OWN choices (m4/Z20, SF3, 160 span) ─
  const gd = ok(designGearbox({ power_kW: 5, inputSpeed_rpm: 1500, ratio: 3, module_mm: 4, pinionTeeth: 20, safetyFactor: 3, bearingSpan_mm: 160 }), 'drill-configured gearbox');
  const dd = gd.dimensions;
  near(dd.toothForce_N, 795.7747, 'DRILL: Ft ≈ 795.77 N at m4/Z20');
  near(dd.bendingMoment_Nmm, 33873.77, 'DRILL: M = Wn·160/4 ≈ 33874 N·mm', 2e-3);
  assert(dd.shaftDiameter_mm === 25, 'DRILL: the designer lands on the drill\'s Ø25 stock shaft');
  assert(dd.keyWidth_mm === 8 && dd.keyHeight_mm === 7, 'DRILL: 8×7 standard key for Ø25');
  near(dd.centerDistance_mm, 160, 'DRILL: centre distance = 4·(20+60)/2 = 160 mm');
  assert(gd.safety.realisedSafetyFactor! >= 3, `SF-3 run: governing realised SF ${gd.safety.realisedSafetyFactor} ≥ 3`);

  // ─── 5. MONOTONICITY: doubling the power shrinks nothing ───────────────────
  const g10 = ok(designGearbox({ power_kW: 10, inputSpeed_rpm: 1500, ratio: 3 }), '10 kW gearbox');
  const d10 = g10.dimensions;
  assert(d10.module_mm >= d.module_mm, `2× power: module ${d.module_mm} → ${d10.module_mm} (no shrink)`);
  assert(d10.shaftDiameter_mm >= d.shaftDiameter_mm, `2× power: shaft Ø${d.shaftDiameter_mm} → Ø${d10.shaftDiameter_mm} (no shrink)`);
  assert(d10.keyLength_mm >= d.keyLength_mm, `2× power: key L ${d.keyLength_mm} → ${d10.keyLength_mm} (no shrink)`);
  assert(d10.requiredBearingC_N > d.requiredBearingC_N, `2× power: required C ${d.requiredBearingC_N} → ${d10.requiredBearingC_N} N (grows)`);
  assert(d10.faceWidth_mm >= d.faceWidth_mm && g10.mass_kg > g.mass_kg, '2× power: face width and mass grow');
  assert(g10.safety.realisedSafetyFactor! >= 2, '10 kW run still beats the 2× target');

  // ─── 6. LIMITING CASE: ratio 1 (a 1:1 coupler stage) ───────────────────────
  const g1 = ok(designGearbox({ power_kW: 5, inputSpeed_rpm: 1500, ratio: 1 }), '1:1 gearbox');
  assert(g1.dimensions.gearTeeth === g1.dimensions.pinionTeeth, '1:1 → equal tooth counts');
  near(g1.dimensions.outputTorque_Nm, g1.dimensions.inputTorque_Nm, '1:1 → T2 = T1 (no multiplication)');
  near(g1.dimensions.outputSpeed_rpm, 1500, '1:1 → output speed = input speed');
  assert(g1.dimensions.shaftDiameter_mm <= d.shaftDiameter_mm, '1:1 shaft ≤ the 3:1 shaft (T2 is 3× smaller)');
  assert(g1.safety.realisedSafetyFactor! >= 2, '1:1 run beats the target too');

  // ─── 7. GUARDS: bad inputs fail closed with helpful messages ───────────────
  bad(designGearbox({ power_kW: 0, inputSpeed_rpm: 1500, ratio: 3 }), /power/i, 'zero power rejected');
  bad(designGearbox({ inputSpeed_rpm: 1500, ratio: 3 }), /power/i, 'missing power rejected');
  bad(designGearbox({ power_kW: 5, inputSpeed_rpm: -100, ratio: 3 }), /speed/i, 'negative speed rejected');
  bad(designGearbox({ power_kW: 5, inputSpeed_rpm: 1500, ratio: 0 }), /ratio/i, 'zero ratio rejected');
  bad(designGearbox({ power_kW: 5, inputSpeed_rpm: 1500, ratio: 0.5 }), /ratio.*1|overdrive/i, 'ratio < 1 rejected with guidance (overdrive)');
  bad(designGearbox({ power_kW: 5, inputSpeed_rpm: 1500, ratio: 3, material: 'unobtainium' }), /unknown material.*steel/i, 'unknown material rejected, listing the known ones');
  bad(designGearbox({ power_kW: 5, inputSpeed_rpm: 1500, ratio: 3, module_mm: 1 }), /module.*(small|Lewis)/i, 'a forced too-small module is rejected (Lewis over allowable), not silently under-designed');
  bad(designGearbox({ power_kW: 5, inputSpeed_rpm: 1500, ratio: 3, bearingSpan_mm: -50 }), /span/i, 'negative bearing span rejected');
  bad(designGearbox({ power_kW: 5000, inputSpeed_rpm: 100, ratio: 6 }), /stock|module/i, 'an absurd duty fails with a stock/module limit message instead of fabricating a part');

  // power_W and power_kW agree
  const gw = ok(designGearbox({ power_W: 5000, inputSpeed_rpm: 1500, ratio: 3 }), 'power_W form');
  assert(gw.dimensions.module_mm === d.module_mm && gw.dimensions.shaftDiameter_mm === d.shaftDiameter_mm, 'power_W: 5000 ≡ power_kW: 5 (same design)');

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) {
    console.error(`\n${failures.length} engineering-design-gearbox failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('All engineering-design-gearbox smoke cases passed');
}

main();
