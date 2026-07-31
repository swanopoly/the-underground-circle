/**
 * engineering-brake-cooling-integration — proof that the CLUTCH/BRAKE, FIN, and
 * THERMAL cores COMPOSE on a real design task: a FINNED BRAKE DRUM. It sits beside
 * the other integration smokes (bracket = statics, gearbox = transmission,
 * cold-plate = heat+flow); this one crosses the MECHANICAL → THERMAL boundary.
 *
 * A brake is an energy converter. It turns mechanical power (torque × speed) into
 * HEAT, and every watt it absorbs must leave through the drum's surface or the
 * drum cooks itself and the linings fade. A bare drum cannot shed a few kW by
 * convection alone, so the drum is FINNED. This smoke chains the three lanes on a
 * continuous-duty band brake (a hoist-lowering / dynamometer brake) wrapping a
 * finned aluminium drum and ASSERTS THE SEAMS where one lane's output feeds the
 * next lane's input:
 *
 *   1. BRAKE → HEAT   bandBrake gives the braking torque T (capstan law); the drum
 *                     turns at ω, so the power dissipated as heat is P_heat = T·ω.
 *                     THIS is the domain-crossing seam: mechanical → thermal.
 *   2. FIN DESIGN     finAnalysis gives Q per fin at the design base excess θb; the
 *                     N-fin array must shed at least P_heat → solve N and the θb
 *                     that balances the energy.
 *   3. BARE vs FINNED convection off the BARE drum (thermal core) cannot cope
 *                     (Q_bare < P_heat) because convection — not conduction — is the
 *                     bottleneck, which is the WHOLE reason to fin (effectiveness ε > 1).
 *   4. TEMPERATURE    at the balance point the drum runs at T∞ + θb, under the fade limit.
 *
 * The seams proven: the clutch/brake torque IS the heat load (P_heat = T·ω); the
 * fin array's total Q must MEET that load at a safe θb; the fin's conductivity IS
 * the material table's aluminium k; the finned/bare heat multiplier IS the fin
 * array's effective area (N·Af·η) over the bare drum area.
 *
 * Style follows scripts/engineering-cooling-integration-smoketest.ts. Pure cores
 * only, no app/network/I/O.
 *
 * Run: npx tsx scripts/engineering-brake-cooling-integration-smoketest.ts
 */

import { bandBrake, discClutch } from '../src/lib/engineeringClutchBrakeCore';
import { finAnalysis, finGeometry } from '../src/lib/engineeringFinCore';
import { conduction, convection } from '../src/lib/engineeringThermalCore';
import { MATERIALS } from '../src/lib/engineeringCalcCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function need<T extends { ok: boolean }>(r: T, label: string): T {
  if (!r.ok) { failures.push(label); console.error(`FAIL: ${label} — not ok`); process.exit(1); }
  return r;
}
const rpmToRad = (rpm: number) => (2 * Math.PI * rpm) / 60;

function main() {
  // ── DUTY: a continuous-duty band brake on a finned aluminium drum ──
  const ambient_C = 30;           // T∞
  const fadeLimitExcess_C = 250;  // linings fade above ~this drum excess over ambient
  const drumSpeed_rpm = 150;      // the drum turns steadily (a hoist descent / dyno brake)
  const omega = rpmToRad(drumSpeed_rpm); // rad/s

  // ── 1. BRAKE → HEAT : the band brake's torque BECOMES the heat load ──────────
  const rd_mm = 120;
  const brake = need(bandBrake({
    drumRadius: rd_mm, frictionCoeff: 0.35, wrapAngle_deg: 270, tightSideTension_N: 1500,
  }), 'band brake');
  // the capstan law T1/T2 = e^(μθ) — the SAME exponential the belt-drive lane uses
  near(brake.value.tensionRatio, Math.exp(0.35 * brake.value.wrapAngle_rad), 'SEAM: band tension ratio = e^(μθ) (capstan / Euler)');
  near(brake.value.slackSideTension_N, brake.value.tightSideTension_N / brake.value.tensionRatio, 'band: T2 = T1/ratio (the slack side follows from the wrap)');
  // braking torque = net rim pull × drum radius
  near(brake.value.brakingTorque_Nmm, (brake.value.tightSideTension_N - brake.value.slackSideTension_N) * rd_mm, 'band torque = (T1−T2)·rd');
  const T_Nm = brake.value.brakingTorque_Nm;
  assert(T_Nm > 100 && T_Nm < 200, `braking torque ≈ ${T_Nm.toFixed(1)} N·m`);

  // THE DOMAIN-CROSSING SEAM: mechanical power dissipated as heat, P_heat = T·ω.
  const P_heat = T_Nm * omega; // watts (= N·m/s)
  const P_heat_fromTensions = (brake.value.tightSideTension_N - brake.value.slackSideTension_N) * (rd_mm / 1000) * omega;
  near(P_heat, P_heat_fromTensions, 'SEAM: P_heat = T·ω = (T1−T2)·rd·ω — the capstan tensions carry all the way to a heat POWER');
  assert(P_heat > 2000 && P_heat < 3000, `the brake sheds ${(P_heat / 1000).toFixed(2)} kW of heat at ${drumSpeed_rpm} rpm — a few kW`);

  // ── 2. FIN DESIGN : N aluminium fins must shed at least P_heat at a safe θb ───
  const h = 60;                    // W/m²·K, forced convection over the spinning finned drum
  const finW_mm = 100, finT_mm = 5, finL_mm = 50; // fin spans the drum's 100 mm width, 5 mm thick, stands 50 mm proud
  const thetaB_design = 200;       // K design base excess (drum surface over ambient)

  // fin geometry (independent) → cross-check the fin parameter m
  const geo = need(finGeometry({ shape: 'rectangular', width: finW_mm, thickness: finT_mm }), 'fin geometry');
  const AcManual = (finW_mm / 1000) * (finT_mm / 1000);
  const Pmanual = 2 * ((finW_mm + finT_mm) / 1000);
  near(geo.value.crossSectionArea_m2, AcManual, 'fin Ac = w·t');
  near(geo.value.perimeter_m, Pmanual, 'fin P = 2(w+t)');

  const fin = need(finAnalysis({
    material: 'aluminum', h, length: finL_mm,
    shape: 'rectangular', width: finW_mm, thickness: finT_mm,
    baseExcess: thetaB_design, tip: 'convective',
  }), 'fin analysis');
  // SEAM: the fin's conductivity IS the material table's aluminium k (one aluminium serves both)
  near(fin.value.conductivity_W_per_mK, MATERIALS.aluminum.k, 'SEAM: fin k = MATERIALS.aluminum.k (167 W/m·K)');
  // fin parameter m = √(hP/kAc) — the single group governing the fin
  const mManual = Math.sqrt((h * Pmanual) / (MATERIALS.aluminum.k * AcManual));
  near(fin.value.finParameter_per_m, mManual, 'fin parameter m = √(hP/kAc)');
  // heat rate Q = M·tanh(mL) with M = √(hPkAc)·θb
  near(fin.value.heatRate_W, fin.value.M_W * Math.tanh(fin.value.mL), 'fin Q = M·tanh(mL)');
  const Qfin = fin.value.heatRate_W; // W per fin at θb = 200
  assert(fin.value.effectiveness > 1, `fin effectiveness ε = ${fin.value.effectiveness.toFixed(1)} > 1 — a fin beats its own bare footprint (else why fin it)`);

  // solve N: the DESIGN REQUIREMENT — the fin array must shed ≥ what the brake makes
  const N = Math.ceil(P_heat / Qfin);
  const Qfins = N * Qfin;
  assert(N === 20, `need N = ${N} fins (⌈${P_heat.toFixed(0)} W / ${Qfin.toFixed(1)} W-per-fin⌉)`);
  assert(Qfins >= P_heat, `SEAM (design requirement): ${N} fins shed ${Qfins.toFixed(0)} W ≥ the ${P_heat.toFixed(0)} W the brake makes`);

  // solve the BALANCE θb where the array sheds EXACTLY P_heat (Q is linear in θb)
  const thetaB_balance = thetaB_design * P_heat / Qfins;
  assert(thetaB_balance <= thetaB_design, `balance excess ${thetaB_balance.toFixed(1)} °C ≤ the ${thetaB_design} °C design point (the 20 fins slightly over-cool)`);
  // VERIFY-BY-FEEDING-THE-ANSWER-BACK: re-run the fin core at θb_balance → the array must shed P_heat
  const finBal = need(finAnalysis({
    material: 'aluminum', h, length: finL_mm, shape: 'rectangular', width: finW_mm, thickness: finT_mm,
    baseExcess: thetaB_balance, tip: 'convective',
  }), 'fin at balance θb');
  near(N * finBal.value.heatRate_W, P_heat, 'SEAM: at θb_balance the N-fin array sheds EXACTLY the brake power (the energy balance closes)');

  // ── 3. BARE vs FINNED : convection is the bottleneck → the reason to fin ──────
  const R_out_m = rd_mm / 1000;      // finned drum outer radius (m)
  const L_drum_m = finW_mm / 1000;   // drum axial width = fin width
  const A_drum = 2 * Math.PI * R_out_m * L_drum_m; // bare cylindrical drum surface
  // bare drum convection (thermal core) at the same design θb
  const bare = need(convection({ h, area: A_drum, deltaT: thetaB_design }), 'bare drum convection');
  const Qbare = bare.value.heatRate_W;
  assert(Qbare < P_heat, `SEAM: the BARE drum sheds only ${Qbare.toFixed(0)} W < ${P_heat.toFixed(0)} W — it would overheat, so it MUST be finned`);
  const multiplier = Qfins / Qbare;
  assert(multiplier > 2, `the fins multiply heat rejection ×${multiplier.toFixed(2)} over the bare drum`);
  // the multiplier IS the fin array's effective added area ÷ the bare drum area (Af·η identity)
  const finnedEffectiveArea = N * fin.value.finSurfaceArea_m2 * fin.value.efficiency;
  near(multiplier, finnedEffectiveArea / A_drum, 'SEAM: heat multiplier = (N·Af·η)/A_drum — the fin surface area × its efficiency');

  // conduction is NOT the bottleneck — the drum wall barely resists the heat flow
  const drumWall_mm = 12;
  const cond = need(conduction({ material: 'aluminum', area: A_drum, thickness: drumWall_mm, deltaT: 1 }), 'drum wall conduction');
  const conv1 = need(convection({ h, area: A_drum, deltaT: 1 }), 'drum surface convection');
  assert(conv1.value.thermalResistance_K_per_W > 100 * cond.value.thermalResistance_K_per_W, 'SEAM: convection R ≫ conduction R — convection is the bottleneck (exactly why adding a fin helps)');
  const wallDrop = P_heat * cond.value.thermalResistance_K_per_W;
  assert(wallDrop < 5, `the drum wall drops only ${wallDrop.toFixed(1)} °C carrying ${(P_heat / 1000).toFixed(1)} kW — the wall is not the limit, the surface is`);

  // ── 4. TEMPERATURE : the drum runs UNDER the fade limit ──────────────────────
  const drumTemp_C = ambient_C + thetaB_balance;
  assert(thetaB_balance < fadeLimitExcess_C, `SEAM: drum excess ${thetaB_balance.toFixed(0)} °C < ${fadeLimitExcess_C} °C fade limit`);
  assert(drumTemp_C < ambient_C + fadeLimitExcess_C, `drum runs at ${drumTemp_C.toFixed(0)} °C (ambient ${ambient_C} + excess) — under the fade ceiling`);

  // ── 5. A DISC brake is the SAME STORY : T·ω heat, met by the same fins ────────
  const disc = need(discClutch({ outerRadius: 150, innerRadius: 90, axialForce: 2000, frictionCoeff: 0.35, surfaces: 2 }), 'disc brake');
  near(disc.value.designTorque_Nm, disc.value.frictionCoeff * disc.value.axialForce_N * disc.value.surfaces * disc.value.uniformWearMeanRadius_mm / 1000, 'disc design torque = μ·F·n·R_mean (uniform wear)');
  assert(disc.value.uniformPressureTorque_Nm > disc.value.uniformWearTorque_Nm, 'disc: new (uniform-pressure) torque > worn (uniform-wear) — design the STEADY heat on the lower value');
  const P_heat_disc = disc.value.designTorque_Nm * omega;
  near(P_heat_disc, disc.value.designTorque_Nm * omega, 'SEAM: disc P_heat = T·ω (the same mechanical→thermal seam, a different brake family)');
  assert(P_heat_disc > 2000 && P_heat_disc < 3500, `the disc brake sheds ${(P_heat_disc / 1000).toFixed(2)} kW`);
  const N_disc = Math.ceil(P_heat_disc / Qfin);
  assert(N_disc > N, `the disc is a bigger heat load, so it needs MORE of the same fins (${N_disc} > ${N})`);
  assert(N_disc * Qfin >= P_heat_disc, `SEAM: ${N_disc} of the same fins shed ${(N_disc * Qfin).toFixed(0)} W ≥ the disc's ${P_heat_disc.toFixed(0)} W`);

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-brake-cooling-integration failure(s)`); process.exit(1); }
  console.log('All engineering-brake-cooling-integration smoke cases passed');
}

main();
