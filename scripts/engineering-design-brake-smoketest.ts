/**
 * engineering-design-brake smoke.
 *
 * designBrake packages the PROVEN mechanical → thermal composition chain
 * (brake torque × slip speed = heat; that heat leaves through convection +
 * fins) into one call. So this smoke ROUND-TRIPS the returned design back
 * through the composed cores — discClutch, finAnalysis, convection — and pins
 * the seams: the heat lane's input power IS the friction lane's T·ω, the
 * returned fin array really covers the continuous heat, the realised rise is
 * the energy balance P_cont/conductance, and the uniform-wear < uniform-
 * pressure duality holds on the returned disc. Plus fin doctrine (η ∈ (0,1),
 * more fins → lower ΔT, high h → fewer fins), monotonicities, and fail-closed
 * guards including the honest "free air cannot shed kilowatts" shortfall.
 */

import { designBrake, BRAKE_LINING_MAX_PRESSURE_MPA } from '../src/lib/engineeringDesignBrakeCore';
import { discClutch } from '../src/lib/engineeringClutchBrakeCore';
import { finAnalysis } from '../src/lib/engineeringFinCore';
import { convection } from '../src/lib/engineeringThermalCore';
import { nominalBoundingBox } from '../src/lib/engineeringSolidModelingCore';

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
  // ─── Worked case: 150 N·m at 1000 rpm, duty 0.15 ─────────────────────────
  // 2.36 kW of continuous heat is a serious brake: it needs forced air over the
  // spinning disc (h = 100), a hot-running fade allowance (ΔT ≤ 250 °C), a
  // 20 mm disc, and long/thick fins. The defaults (free air, ΔT 60) honestly
  // CANNOT cool this — asserted in the guards section below.
  const workedSpec = {
    torque_Nm: 150, speed_rpm: 1000, dutyCycle: 0.15,
    h_W_m2K: 100, maxTempRise_C: 250, discThickness_mm: 20, finLength_mm: 100, finThickness_mm: 5,
  };
  const d = ok(designBrake(workedSpec), 'worked brake');
  assert(d.type === 'brake', "type is 'brake'");
  assert(d.material === 'aluminum', 'defaults to aluminum (present in MATERIALS) for the finned disc');
  assert(d.dimensions.outerRadius_mm === 80, 'sized ro = 80 mm (smallest stock disc under the 10 kN cap)');
  assert(d.dimensions.innerRadius_mm === 48, 'ri = 0.6·ro = 48 mm');
  assert(d.dimensions.clampForce_N === 7813, 'clamp Fn = ⌈2·150000/(0.3·128)⌉ = 7813 N');

  // ROUND-TRIP: the returned ro/ri/Fn back through discClutch uniform-wear.
  const dc = ok(discClutch({ outerRadius: 80, innerRadius: 48, axialForce: d.dimensions.clampForce_N, frictionCoeff: 0.3 }), 'disc round-trip');
  assert(dc.uniformWearTorque_Nm >= 150, `ROUND-TRIP: uniform-wear torque ${dc.uniformWearTorque_Nm} N·m ≥ required 150 N·m`);
  near(d.dimensions.torqueCapacity_Nm, dc.uniformWearTorque_Nm, 'returned torque capacity = discClutch wear torque', 1e-9);
  assert(dc.uniformPressureTorque_Nm >= dc.uniformWearTorque_Nm, 'DUALITY holds on the returned design: uniform-pressure (new) ≥ uniform-wear (worn-in)');
  near(d.dimensions.uniformPressureTorque_Nm, dc.uniformPressureTorque_Nm, 'returned uniform-pressure torque matches the core', 1e-9);
  near(d.dimensions.padPressure_MPa, 7813 / (Math.PI * (80 ** 2 - 48 ** 2)), 'pad pressure = Fn/(π(ro²−ri²)) ≈ 0.607 MPa');
  assert(d.dimensions.padPressure_MPa <= BRAKE_LINING_MAX_PRESSURE_MPA, 'pad pressure under the 1 MPa organic-lining allowable');
  assert(d.safety.realisedSafetyFactor! >= 1, 'torque margin ≥ 1 (ceil-rounded clamp force re-checked)');

  // HEAT by hand: P_peak = T·2πn/60.
  const omega = (2 * Math.PI * 1000) / 60;
  near(d.dimensions.P_peak_W, 150 * omega, 'P_peak = T·2πn/60 = 15 708 W', 1e-6);
  near(d.dimensions.P_cont_W, 0.15 * 150 * omega, 'P_cont = duty·P_peak = 2 356 W', 1e-6);

  // SEAM: the heat lane's input IS the friction lane's T·ω — the exact number
  // crosses the mechanical → thermal boundary unchanged (energy balance closes).
  const P_cont = 0.15 * 150 * omega;
  assert(d.dimensions.finCount === 24, 'needs the full 24-fin array (2.36 kW is a lot of heat)');
  const fin = ok(finAnalysis({
    material: 'aluminum', h: 100, length: 100, shape: 'rectangular', width: 20, thickness: 5,
    baseExcess: 250, tip: 'convective',
  }), 'fin round-trip');
  near(d.dimensions.perFinHeat_W, fin.heatRate_W, 'returned per-fin heat = finAnalysis Q', 1e-6);
  assert(fin.efficiency > 0 && fin.efficiency < 1, `FIN DOCTRINE: per-fin efficiency η = ${fin.efficiency} ∈ (0,1)`);
  near(d.dimensions.finEfficiency, fin.efficiency, 'returned fin efficiency matches the core', 1e-6);
  const A_disc = (2 * Math.PI * (80 ** 2 - 48 ** 2) + 2 * Math.PI * 80 * 20) / 1e6;
  near(d.dimensions.bareArea_m2, A_disc, 'bare area = two annular faces + rim edge', 1e-6);
  const bare = ok(convection({ h: 100, area: A_disc - 24 * fin.crossSectionArea_m2, deltaT: 250 }), 'unfinned convection round-trip');
  const totalCapacity = bare.heatRate_W + 24 * fin.heatRate_W;
  assert(totalCapacity >= P_cont, `ROUND-TRIP: 24·Q_fin + bare = ${totalCapacity.toFixed(1)} W ≥ P_cont = ${P_cont.toFixed(1)} W`);
  near(d.dimensions.dissipation_W, totalCapacity, 'returned dissipation = the rebuilt fin + bare capacity', 1e-5);
  const conductance = totalCapacity / 250;
  near(d.dimensions.realisedTempRise_C, P_cont / conductance, 'SEAM: realised ΔT = P_cont/conductance — T·ω crossed into the thermal lane unchanged', 1e-4);
  assert(d.dimensions.realisedTempRise_C <= 250, `realised ΔT ${d.dimensions.realisedTempRise_C} °C ≤ the 250 °C limit`);
  assert(d.dimensions.coolingMargin_W >= 0, 'cooling margin ≥ 0 (capacity covers the load)');

  // Mass + model self-check: the bare annular disc.
  near(d.mass_kg, Math.PI * (80 ** 2 - 48 ** 2) * 20 * 2.70e-6, 'mass = π(ro²−ri²)·t × aluminum density ≈ 695 g');
  const bb = nominalBoundingBox(d.model)!;
  assert(bb !== null && Math.abs(bb.maxX - bb.minX - 160) < 1e-9 && Math.abs(bb.maxZ - bb.minZ - 20) < 1e-9, 'model bounding box = Ø160 × 20 mm disc');
  assert(d.bpy.includes('stl_export') && d.bpy.length > 100, 'a ready-to-compile Blender script is returned');
  assert(d.notes.some((n) => n.includes('not modelled')), 'notes state that fins are sized thermally but not modelled');

  // ─── Small brake straight from the defaults (free air, ΔT 60) ────────────
  const d2 = ok(designBrake({ torque_Nm: 20, speed_rpm: 150, dutyCycle: 0.08 }), 'default small brake');
  assert(d2.dimensions.outerRadius_mm === 40 && d2.dimensions.innerRadius_mm === 24, 'defaults size the smallest stock disc Ø80/Ø48');
  assert(d2.dimensions.clampForce_N === 2084, 'Fn = ⌈2·20000/(0.3·64)⌉ = 2084 N');
  assert(ok(discClutch({ outerRadius: 40, innerRadius: 24, axialForce: 2084, frictionCoeff: 0.3 }), 'small disc round-trip').uniformWearTorque_Nm >= 20, 'ROUND-TRIP: small disc wear torque ≥ 20 N·m');
  assert(d2.dimensions.finCount === 16, '25.1 W continuous needs 16 default fins over the 13.4 W bare disc');
  near(d2.dimensions.realisedTempRise_C, 52.809, 'realised ΔT ≈ 52.8 °C ≤ 60', 1e-3);
  assert(d2.dimensions.realisedTempRise_C <= 60, 'default ΔT limit held');
  const fin2 = ok(finAnalysis({ material: 'aluminum', h: 25, length: 25, shape: 'rectangular', width: 10, thickness: 3, baseExcess: 60, tip: 'convective' }), 'default fin round-trip');
  assert(fin2.efficiency > 0 && fin2.efficiency < 1, 'default fin η ∈ (0,1)');
  assert(fin2.effectiveness > 1, 'fin effectiveness ε > 1 — each fin beats its own bare footprint');
  const A2 = d2.dimensions.bareArea_m2;
  const P2 = d2.dimensions.P_cont_W;
  const cap16 = 25 * (A2 - 16 * fin2.crossSectionArea_m2) * 60 + 16 * fin2.heatRate_W;
  assert(cap16 >= P2, `ROUND-TRIP: 16·Q_fin + bare = ${cap16.toFixed(2)} W ≥ P_cont = ${P2.toFixed(2)} W`);
  const cap12 = 25 * (A2 - 12 * fin2.crossSectionArea_m2) * 60 + 12 * fin2.heatRate_W;
  assert(cap12 < P2, '12 fins would NOT cover the load — 16 is genuinely the first sufficient stock count');

  // ─── Fin doctrine ────────────────────────────────────────────────────────
  // More fins → lower realised ΔT (monotone conductance).
  const cap20 = 25 * (A2 - 20 * fin2.crossSectionArea_m2) * 60 + 20 * fin2.heatRate_W;
  assert(P2 / (cap20 / 60) < P2 / (cap16 / 60), 'more fins → lower realised ΔT (monotone)');
  near(P2 / (cap16 / 60), d2.dimensions.realisedTempRise_C, 'returned ΔT matches the hand conductance at 16 fins', 1e-3);
  // High h → fewer-or-equal fins: fins matter most when convection is the bottleneck.
  const dH = ok(designBrake({ torque_Nm: 20, speed_rpm: 150, dutyCycle: 0.08, h_W_m2K: 100 }), 'high-h brake');
  assert(dH.dimensions.finCount <= d2.dimensions.finCount, `FIN DOCTRINE: h=100 needs ${dH.dimensions.finCount} fins ≤ ${d2.dimensions.finCount} at h=25`);
  assert(dH.dimensions.finCount === 0, 'at h=100 the bare disc alone copes — no fins at all');
  near(dH.dimensions.realisedTempRise_C, P2 / (100 * A2), 'bare-disc ΔT = P_cont/(h·A) ≈ 28.1 °C', 1e-3);

  // ─── Monotonicity ────────────────────────────────────────────────────────
  // Doubling duty → more-or-equal fins, and at FIXED fins the ΔT doubles.
  const dLow = ok(designBrake({ torque_Nm: 20, speed_rpm: 150, dutyCycle: 0.04 }), 'low-duty brake');
  assert(dLow.dimensions.finCount === 0, 'duty 0.04 → 12.6 W, under the 13.4 W bare disc — no fins');
  assert(d2.dimensions.finCount >= dLow.dimensions.finCount, 'doubling duty → more-or-equal fins');
  near(P2, 2 * dLow.dimensions.P_cont_W, 'doubling duty exactly doubles P_cont', 1e-4);
  const G_bare = 25 * A2; // fixed (0-fin) conductance
  near(P2 / G_bare, 2 * dLow.dimensions.realisedTempRise_C, 'at FIXED fins ΔT = P/G doubles with duty', 1e-3);
  assert(P2 / G_bare > 60, 'the doubled duty would overshoot the 60 °C limit at the old fin count — exactly why fins were added');
  // Doubling torque → larger-or-equal disc or clamp force.
  const dT2 = ok(designBrake({ torque_Nm: 40, speed_rpm: 150, dutyCycle: 0.04 }), 'double-torque brake');
  assert(dT2.dimensions.outerRadius_mm >= dLow.dimensions.outerRadius_mm, 'doubling torque → larger-or-equal disc');
  assert(dT2.dimensions.outerRadius_mm === 50, '40 N·m busts the Ø80 disc lining pressure → next stock Ø100');
  assert(dT2.dimensions.outerRadius_mm > dLow.dimensions.outerRadius_mm || dT2.dimensions.clampForce_N > dLow.dimensions.clampForce_N, '…and/or a larger clamp force');
  assert(dT2.dimensions.padPressure_MPa <= BRAKE_LINING_MAX_PRESSURE_MPA, 'the grown disc restores lining pressure under the allowable');
  // Tighter actuation cap → bigger disc (which then needs fewer fins: more bare area).
  const dCap = ok(designBrake({ ...workedSpec, actuationForce_N: 5000 }), 'capped-actuation brake');
  assert(dCap.dimensions.outerRadius_mm === 125, 'a 5 kN actuation cap forces the disc out to Ø250');
  assert(dCap.dimensions.clampForce_N <= 5000, 'clamp force honours the stated cap');
  assert(dCap.dimensions.finCount < d.dimensions.finCount, `bigger disc sheds more bare heat → fewer fins (${dCap.dimensions.finCount} < ${d.dimensions.finCount})`);

  // ─── Guards ──────────────────────────────────────────────────────────────
  // The honest failure: free air at ΔT 60 CANNOT shed 2.36 kW from a Ø160 disc.
  const impossible = designBrake({ torque_Nm: 150, speed_rpm: 1000, dutyCycle: 0.15 });
  assert(!impossible.ok, 'defaults cannot cool 2.36 kW — returns ok:false instead of pretending');
  assert(!impossible.ok && /shortfall/i.test(impossible.error), 'the error states the shortfall');
  assert(!impossible.ok && /forced cooling/i.test(impossible.error), 'the error advises forced cooling');
  const unsizable = designBrake({ torque_Nm: 5000, speed_rpm: 100 });
  assert(!unsizable.ok && /stock disc/i.test(unsizable.error), '5 kN·m exceeds every stock disc under cap+lining — sizing fails closed');
  assert(!designBrake({} as any).ok, 'missing torque rejected');
  assert(!designBrake({ torque_Nm: 100, speed_rpm: 0 } as any).ok, 'zero speed rejected');
  assert(!designBrake({ torque_Nm: 100, speed_rpm: 500, dutyCycle: 1.5 }).ok, 'duty > 1 rejected');
  assert(!designBrake({ torque_Nm: 100, speed_rpm: 500, material: 'unobtainium' }).ok, 'unknown material rejected');
  assert(!designBrake({ torque_Nm: 100, speed_rpm: 500, innerRadiusRatio: 1.2 }).ok, 'ri/ro ≥ 1 rejected');
  assert(!designBrake({ torque_Nm: 100, speed_rpm: 500, frictionCoeff: 0 }).ok, 'μ = 0 rejected');

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-design-brake smoke failure(s)`); process.exit(1); }
  console.log('All engineering-design-brake smoke cases passed — one call sizes the disc, converts the duty to heat, and fins the cooling.');
}

main();
