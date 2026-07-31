/**
 * engineering-gearbox-DESIGN-integration — the DEEPER drivetrain composition
 * proof. Where engineering-gearbox-integration chained duty → ratio → torque →
 * geometry → shaft-torsion → bearing, this one adds the two lanes that turn a
 * torque flow into a real machine element: the SHAFT-DESIGN capstone (combined
 * bending + torsion, where the GEAR FORCE sizes the shaft) and the KEY that
 * couples the gear to that shaft — and it drives the whole gearbox from ONE
 * statics model so every lane's input is a prior lane's output. The SEAMS are
 * the assertions.
 *
 * Worked single-reduction gearbox: 5 kW in at 1500 rpm, 3:1 reduction
 * (pinion Z20 → gear Z60, module 4 mm, 20° pressure angle), mild-steel shaft.
 * The gear centred between two bearings spaced 160 mm apart:
 *
 *   duty ─P/ω→ T1 ─×ratio→ T2 ──┬─ Ft = T2/r2 = T1/r1        (tooth force, shared)
 *                               │        │
 *                               │        ├─ Wn = Ft/cosφ ─┬→ M = Wn·L/4 → shaftDiameter (CAPSTONE)
 *                               │        │                └→ R = Wn/2    → bearingLife (L10)
 *                               │        └─ Lewis σ = Ft/(F·m·Y)         → tooth-strength check
 *                               └─ T2 ────────────────────→ keySizing (weak link) on the sized shaft
 *
 * The whole point is COMPOSITION AT THE SEAMS, not per-lane correctness (each
 * lane already has its own smoke): the bending moment fed to the shaft IS the
 * gear force × span; the key's torque IS the shaft's torque; the bearing's load
 * IS the gear reaction; the Lewis force IS the same tooth force. One gear force,
 * derived once, sizes three different parts. Pure — chains the tsx-loadable
 * cores, no app, no I/O.
 *
 * Real statics: a transverse load W at the centre of a shaft simply supported
 * over span L gives max bending moment M = W·L/4 and equal bearing reactions
 * R = W/2 (Hibbeler, "Statics"; Shigley "Mechanical Engineering Design" §7 shaft
 * layout). The tangential Ft and radial Wr gear forces act in perpendicular
 * planes, so their bending moments combine as √(M_h²+M_v²) = (L/4)·√(Ft²+Wr²) =
 * Wn·L/4 with Wn = Ft/cosφ the resultant tooth (normal) force.
 */

import {
  gearTrain,
  gearPairTransmission,
  shaftTorsion,
  MATERIALS,
} from '../src/lib/engineeringCalcCore';
import { gearGeometry } from '../src/lib/engineeringGearCore';
import { tangentialLoad, lewisBendingStress } from '../src/lib/engineeringGearStrengthCore';
import { shaftDiameter, shaftFatigue } from '../src/lib/engineeringShaftDesignCore';
import { keySizing, keyTorqueCapacity, standardKeySize } from '../src/lib/engineeringKeyCore';
import { bearingLife } from '../src/lib/engineeringBearingCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function need(r: { ok: boolean; error?: string }, label: string): any {
  if (!r.ok) { failures.push(label); console.error(`FAIL: ${label} — ${(r as any).error ?? 'not ok'}`); process.exit(1); }
  return r;
}
const rnd = (n: number, dp = 2) => Math.round(n * 10 ** dp) / 10 ** dp;

function main() {
  // ── duty + design choices ──
  const P_W = 5000, n1_rpm = 1500;
  const N1 = 20, N2 = 60, module = 4, phiDeg = 20;   // Z20→Z60 m4, 3:1
  const SF_shaft = 3, span_mm = 160;                 // bearing span, gear centred
  const SF_gear = 3, faceWidth_mm = 40;              // gear face = 10·m
  const Se_MPa = 200, Sut_MPa = 440;                 // steel endurance / ultimate
  const bearingC_N = 11200;                          // 6005 deep-groove ball, 25 mm bore
  const Sy = MATERIALS.steel.yield;                  // 250 MPa
  const phi = (phiDeg * Math.PI) / 180;

  console.log('\n=== 1. GEAR PAIR: duty → torque → tooth force ===');
  // 1a. Input torque from the motor duty: T1 = P/ω.
  const omega1 = (2 * Math.PI * n1_rpm) / 60;
  const T1_Nm = P_W / omega1, T1_Nmm = T1_Nm * 1000;
  near(T1_Nm, P_W / ((2 * Math.PI * n1_rpm) / 60), 'input torque T1 = P/ω1 ≈ 31.83 N·m');

  // 1b. The reduction — and the two independent gear tools MUST agree on the ratio + output torque.
  const train = need(gearTrain({ stages: [{ driver: N1, driven: N2 }], inputSpeed_rpm: n1_rpm, inputTorque_Nm: T1_Nm }), 'gearTrain');
  const pair = need(gearPairTransmission({ pinionTeeth: N1, gearTeeth: N2, module, inputSpeed_rpm: n1_rpm, inputTorque_Nm: T1_Nm }), 'gearPairTransmission');
  near(train.value, 3, 'train value = 60/20 = 3');
  assert(train.value === pair.value, 'SEAM: gearTrain and gearPairTransmission agree on the 3:1 ratio');
  const ratio = train.value;

  // 1c. Output torque — the reducer multiplies torque by the ratio (loss-free stage).
  const T2_Nm = T1_Nm * ratio, T2_Nmm = T2_Nm * 1000;
  near(train.extra.output_torque_Nm, T2_Nm, 'SEAM: T2 = T1·TV (the reducer multiplies torque)');
  assert(train.extra.output_torque_Nm === pair.extra.output_torque_Nm, 'SEAM: both gear cores produce the identical output torque T2');
  near(T2_Nm, 3 * (P_W / ((2 * Math.PI * n1_rpm) / 60)), 'output torque T2 ≈ 95.49 N·m');
  const n2_rpm = train.extra.output_speed_rpm;
  near(n2_rpm, 500, 'output speed = 1500/3 = 500 rpm');

  // 1d. Gear geometry fixes the pitch radii; the tooth force is torque / pitch radius.
  const g1 = need(gearGeometry(N1, module), 'pinion geometry');
  const g2 = need(gearGeometry(N2, module), 'gear geometry');
  const r1 = g1.value.pitchRadius, r2 = g2.value.pitchRadius;
  near(r1, 40, 'pinion pitch radius r1 = m·N1/2 = 40 mm');
  near(r2, 120, 'gear pitch radius r2 = m·N2/2 = 120 mm');
  const Ft = T2_Nmm / r2; // tangential tooth force at the gear pitch circle
  near(Ft, T1_Nmm / r1, 'SEAM: Ft = T2/r2 = T1/r1 — one equal-and-opposite tooth force on pinion & gear');
  near(Ft, 795.7747, 'tooth force Ft ≈ 795.8 N');
  const Wr = Ft * Math.tan(phi);   // separating (radial) force
  const Wn = Ft / Math.cos(phi);   // resultant tooth (normal) force — the transverse load on the shaft
  near(Wn, Math.hypot(Ft, Wr), 'SEAM: resultant tooth force Wn = Ft/cosφ = hypot(Ft, Wr) (two ways agree)');

  console.log('\n=== 2. OUTPUT SHAFT: the gear force sizes the shaft (capstone) ===');
  // 2a. ONE statics model: the resultant gear force, centred on span L, makes M = Wn·L/4;
  //     the same force reacts as R = Wn/2 at each bearing, and M = R·(L/2). Both come from Wn.
  const R = Wn / 2;                    // each bearing reaction
  const M_Nmm = (Wn * span_mm) / 4;    // max bending moment at the centred gear
  near(M_Nmm, R * (span_mm / 2), 'SEAM: M = Wn·L/4 = R·(L/2) — ONE statics model feeds BOTH the shaft moment and the bearing load');
  near(M_Nmm, 33873.77, 'bending moment M ≈ 33874 N·mm');

  // 2b. Size the shaft for the SIMULTANEOUS bending M and torque T2 (MSST/DE).
  const shaft = need(shaftDiameter({ bendingMoment: M_Nmm, torque: T2_Nmm, safetyFactor: SF_shaft, material: 'steel' }), 'shaftDiameter');
  const Me_ref = Math.sqrt(M_Nmm ** 2 + T2_Nmm ** 2);
  near(shaft.value.equivalentMoment, Me_ref, 'SEAM: shaft Me = √(M²+T²) consumes BOTH the gear bending moment AND the transmitted torque');
  const dMSST_ref = Math.cbrt(((32 * SF_shaft) / (Math.PI * Sy)) * Me_ref);
  near(shaft.value.recommendedDiameter, dMSST_ref, 'shaft Ø matches the closed form d³ = (32n/πSy)·√(M²+T²)');
  assert(shaft.value.governing === 'MSST', 'MSST governs (conservative) over DE');
  assert(shaft.value.diameterDE <= shaft.value.diameterMSST, 'DE diameter ≤ MSST diameter (property: √(M²+¾T²) ≤ √(M²+T²))');
  near(shaft.value.realizedSafetyFactorMSST, SF_shaft, 'realized MSST safety factor ≈ target 3 at the recommended Ø');

  // 2c. Round UP to a standard shaft; it must clear the requirement.
  const d_shaft = 25;
  assert(d_shaft >= shaft.value.recommendedDiameter, `chosen shaft Ø${d_shaft} ≥ required Ø${shaft.value.recommendedDiameter} (round up to stock)`);

  // 2d. LIMITING CASE — remove the transmitted torque (T=0) and the capstone must
  //     collapse to the pure-bending lane: smaller Ø, τ=0, σ = Sy/n exactly.
  const shaftPure = need(shaftDiameter({ bendingMoment: M_Nmm, torque: 0, safetyFactor: SF_shaft, material: 'steel' }), 'shaftDiameter (T=0)');
  assert(shaftPure.value.recommendedDiameter < shaft.value.recommendedDiameter, 'SEAM: dropping the torque (T=0) shrinks the shaft — it reduces to the pure-bending lane');
  near(shaftPure.value.torsionalShear, 0, 'T=0 → torsional shear τ = 0');
  near(shaftPure.value.bendingStress, Sy / SF_shaft, 'T=0 → bending stress = Sy/n exactly (pure-bending closed form)');

  // 2e. FATIGUE capstone — a rotating shaft: the steady side load is a fully-reversed
  //     bending moment Ma = M, the transmitted torque a steady mean Tm = T2 (Shigley Eq. 7-8).
  const fat = need(shaftFatigue({ alternatingMoment: M_Nmm, meanTorque: T2_Nmm, endurance: Se_MPa, ultimate: Sut_MPa, safetyFactor: 2 }), 'shaftFatigue');
  near(fat.value.alternatingMoment, M_Nmm, 'SEAM: fatigue Ma = the static gear-load bending moment M (rotating → fully-reversed bending)');
  near(fat.value.meanTorque, T2_Nmm, 'SEAM: fatigue Tm = the transmitted torque T2 (steady mean torque)');
  const dFat_ref = Math.cbrt(((16 * 2) / Math.PI) * ((2 * M_Nmm) / Se_MPa + (Math.sqrt(3) * T2_Nmm) / Sut_MPa));
  near(fat.value.requiredDiameter, dFat_ref, 'fatigue Ø matches Shigley DE-Goodman closed form (roots 2·Ma, √3·Tm)');
  const fatNoT = need(shaftFatigue({ alternatingMoment: M_Nmm, meanTorque: 0, endurance: Se_MPa, ultimate: Sut_MPa, safetyFactor: 2 }), 'shaftFatigue (Tm=0)');
  assert(fatNoT.value.requiredDiameter < fat.value.requiredDiameter, 'SEAM: removing the mean torque shrinks the fatigue Ø (Goodman mean-stress term drops out)');
  assert(d_shaft >= fat.value.requiredDiameter, `chosen shaft Ø${d_shaft} ≥ fatigue-required Ø${fat.value.requiredDiameter}`);

  console.log('\n=== 3. KEY: the shaft torque sizes the key (the weak link) ===');
  // 3a. The standard key section for the sized shaft.
  const std = need(standardKeySize(d_shaft), 'standardKeySize');
  assert(std.value.width_mm === 8 && std.value.height_mm === 7, `standard key for Ø25 = 8×7 mm (${std.value.range})`);

  // 3b. Size the key for the SAME torque T2, on the SAME shaft Ø from step 2.
  const key = need(keySizing({ shaftDiameter: d_shaft, torqueNmm: T2_Nmm, material: 'steel' }), 'keySizing');
  near(key.value.torque_Nmm, T2_Nmm, 'SEAM: key torque = the gear/shaft torque T2 (same power path)');
  assert(key.value.shaftDiameter_mm === d_shaft, 'SEAM: the key sits on the exact sized shaft Ø25');
  near(key.value.force_N, (2 * T2_Nmm) / d_shaft, 'SEAM: key surface force F = 2·T2/d (at the SHAFT radius, not the gear radius)');
  assert(key.value.force_N > Ft, 'key surface force > tooth force Ft (shaft radius 12.5 mm < gear pitch radius 120 mm)');
  assert(key.value.governingMode === 'bearing', 'crushing (bearing) governs this rectangular key (w > h)');

  // 3c. WEAK-LINK seam: the key at its required length carries EXACTLY T2, while the
  //     shaft at the same shear allowable carries ~3× more torque before it yields → key fails first.
  const keyCap = need(keyTorqueCapacity({ shaftDiameter: d_shaft, width: key.value.width_mm, height: key.value.height_mm, length: key.value.requiredLength_mm, material: 'steel' }), 'keyTorqueCapacity');
  near(keyCap.value.torqueCapacity_Nmm, T2_Nmm, 'SEAM: keyTorqueCapacity(requiredLength) round-trips to the design torque T2 (inverse of sizing)');
  const tauAllow = 0.4 * Sy; // 100 MPa — the key's own shear allowable, applied to the shaft for a fair compare
  const T_shaftCap_Nmm = (tauAllow * Math.PI * d_shaft ** 3) / 16; // pure-torsion capacity of the round shaft
  const shaftTau = need(shaftTorsion({ torque: T_shaftCap_Nmm, diameter: d_shaft }), 'shaftTorsion capacity check');
  near(shaftTau.value, tauAllow, 'shaft capacity round-trips: τ(T_cap, Ø25) = 100 MPa (cross-checks the closed form)');
  assert(keyCap.value.torqueCapacity_Nmm < T_shaftCap_Nmm, `SEAM: key is the weak link — key cap ${rnd(keyCap.value.torqueCapacity_Nmm)} < shaft torsional cap ${rnd(T_shaftCap_Nmm)} N·mm (~${rnd(T_shaftCap_Nmm / keyCap.value.torqueCapacity_Nmm)}×)`);

  console.log('\n=== 4. BEARING: the gear reaction sizes the bearing (L10) ===');
  // 4a. The bearing load IS the gear reaction from the same statics; the two reactions sum to Wn.
  const brg = need(bearingLife({ dynamicLoadRating: bearingC_N, equivalentLoad: R, bearingType: 'ball', speed_rpm: n2_rpm }), 'bearingLife');
  near(brg.value.equivalentLoad_N, R, 'SEAM: bearing load P = the gear reaction R = Wn/2');
  near(2 * R, Wn, 'SEAM: the two bearing reactions sum to the full gear force Wn (statics closure)');
  near(brg.value.speed_rpm, n2_rpm, 'SEAM: the bearing turns at the reduced output speed 500 rpm');
  assert(brg.value.life_hours > 10000, `bearing L10 = ${Math.round(brg.value.life_hours)} h > 10000 h target`);

  // 4b. The required rating C for a 25 000 h target is derived from the SAME reaction load,
  //     and round-trips to that life — showing the gear reaction is what sizes the bearing.
  const Lh_target = 25000;
  const C_req = R * Math.pow((Lh_target * 60 * n2_rpm) / 1e6, 1 / 3);
  const brgReq = need(bearingLife({ dynamicLoadRating: C_req, equivalentLoad: R, bearingType: 'ball', speed_rpm: n2_rpm }), 'bearingLife (C_req)');
  near(brgReq.value.life_hours, Lh_target, 'SEAM: a C sized from the gear reaction round-trips to the 25000 h target (L10 = (C/P)³)');
  assert(bearingC_N > C_req, `selected 6005 (C=${bearingC_N} N) exceeds the load-required C=${Math.round(C_req)} N → life is non-limiting`);

  console.log('\n=== 5. GEAR TOOTH: the same tooth force sets the Lewis stress ===');
  // 5a. The gear-strength core recomputes Ft from torque+geometry; it must equal our mesh Ft.
  const tl = need(tangentialLoad({ module, teeth: N2, torque_Nm: T2_Nm }), 'tangentialLoad');
  near(tl.extra.tangential_load_N, Ft, 'SEAM: gear-strength core Ft = our mesh tooth force T2/r2');

  // 5b. Lewis bending stress from the SAME force, on both gears — under the allowable.
  const allowGear = Sy / SF_gear; // 83.3 MPa
  const lewGear = need(lewisBendingStress({ module, teeth: N2, faceWidth: faceWidth_mm, torque_Nm: T2_Nm }), 'lewisBendingStress (gear)');
  near(lewGear.extra.tangential_load_N, Ft, 'SEAM: Lewis uses the same tooth force Ft');
  assert(lewGear.value < allowGear, `gear tooth σ = ${lewGear.value} MPa < allowable ${rnd(allowGear)} MPa`);
  const lewPinion = need(lewisBendingStress({ module, teeth: N1, faceWidth: faceWidth_mm, torque_Nm: T1_Nm }), 'lewisBendingStress (pinion)');
  assert(lewPinion.value > lewGear.value, 'pinion tooth is the weaker one (fewer teeth → smaller Lewis Y → higher σ)');
  assert(lewPinion.value < allowGear, `pinion tooth σ = ${lewPinion.value} MPa < allowable ${rnd(allowGear)} MPa`);

  // ── worked-numbers summary ──
  console.log('\n=== WORKED GEARBOX (the chained numbers) ===');
  console.log(`  input        : ${P_W} W @ ${n1_rpm} rpm → T1 = ${rnd(T1_Nm)} N·m`);
  console.log(`  reduction    : Z${N1}→Z${N2} m${module}  ratio ${ratio}:1  → ${n2_rpm} rpm, T2 = ${rnd(T2_Nm)} N·m`);
  console.log(`  tooth force  : Ft = ${rnd(Ft)} N, Wr = ${rnd(Wr)} N, Wn = ${rnd(Wn)} N (resultant)`);
  console.log(`  output shaft : M = ${rnd(M_Nmm)} N·mm over ${span_mm} mm span, T = ${rnd(T2_Nmm)} N·mm`);
  console.log(`                 required Ø ${rnd(shaft.value.recommendedDiameter)} mm (MSST) / fatigue Ø ${rnd(fat.value.requiredDiameter)} mm → chosen Ø${d_shaft} mm`);
  console.log(`  key          : ${key.value.width_mm}×${key.value.height_mm} mm, L = ${rnd(key.value.requiredLength_mm)} mm (${key.value.governingMode} governs), F = ${rnd(key.value.force_N)} N`);
  console.log(`  bearing      : P = ${rnd(R)} N @ ${n2_rpm} rpm, C = ${bearingC_N} N → L10 = ${Math.round(brg.value.life_hours)} h`);
  console.log(`  gear tooth   : pinion σ ${rnd(lewPinion.value)} MPa, gear σ ${rnd(lewGear.value)} MPa (allow ${rnd(allowGear)} MPa)`);

  console.log(`\n${passed} cross-core seam assertions passed, ${failures.length} failed`);
  if (failures.length) {
    console.error(`\n${failures.length} engineering-gearbox-design-integration failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('All engineering-gearbox-design-integration smoke cases passed');
}

main();
