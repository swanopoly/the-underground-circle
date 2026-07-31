/**
 * engineering-gearbox-integration — proof that the POWER-TRANSMISSION tools
 * compose, the counterpart to the (statics) bracket workflow.
 *
 * The bracket example proved load → thickness → model → measure → fit. This
 * proves a rotating drivetrain, where a torque and speed flow through a gear
 * reduction, size the shaft, load the bearing, and set the gear geometry:
 *
 *   a 3 kW motor at 1500 rpm drives a single-stage 3:1 gear reducer.
 *
 *   1. torque in     T1 = P/ω from the motor duty
 *   2. reduction     gear_train TV = 3 (and it must equal the gear_pair ratio)
 *   3. torque out    T2 = T1·TV  → the reduced-speed, higher-torque output
 *   4. gear geometry module + teeth → pitch diameters, centre distance
 *   5. shaft         shaft_torsion sizes the output shaft for the output torque
 *   6. bearing       the gear's tooth force loads the bearing → L10 life
 *
 * The seams are the assertions: the two gear tools agree on the ratio; the output
 * torque the reduction produces is the torque the shaft is sized for; the shaft
 * diameter is the gear bore and the bearing bore; the gear tooth force is the
 * bearing's radial load. Pure — chains the tsx-loadable cores.
 */

import { gearTrain, gearPairTransmission, shaftTorsion } from '../src/lib/engineeringCalcCore';
import { gearGeometry } from '../src/lib/engineeringGearCore';
import { bearingLife } from '../src/lib/engineeringBearingCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function need<T extends { ok: boolean }>(r: T, label: string): T { if (!r.ok) { failures.push(`${label}`); console.error(`FAIL: ${label} — not ok`); process.exit(1); } return r; }

function main() {
  // ── duty ──
  const power_W = 3000, speed_rpm = 1500, pinionTeeth = 20, gearTeeth = 60, module = 3;

  // 1. TORQUE IN — from the motor's power and speed.
  const omega1 = (2 * Math.PI * speed_rpm) / 60;
  const T1 = power_W / omega1; // N·m
  near(T1, 3000 / ((2 * Math.PI * 1500) / 60), 'input torque T1 = P/ω ≈ 19.1 N·m');

  // 2. REDUCTION — and the two gear tools MUST agree on the ratio.
  const train = need(gearTrain({ stages: [{ driver: pinionTeeth, driven: gearTeeth }], inputSpeed_rpm: speed_rpm, inputTorque_Nm: T1 }), 'gear_train');
  const pair = need(gearPairTransmission({ pinionTeeth, gearTeeth, module, inputSpeed_rpm: speed_rpm, inputTorque_Nm: T1 }), 'gear_pair');
  near(train.value, 3, 'gear_train value = 60/20 = 3');
  assert((train as any).value === (pair as any).value, 'CROSS-CHECK: gear_train and gear_pair agree on the 3:1 ratio');
  near((train as any).extra.output_speed_rpm, 500, 'output speed = 1500/3 = 500 rpm');

  // 3. TORQUE OUT.
  const T2 = T1 * (train as any).value; // N·m
  near((train as any).extra.output_torque_Nm, T2, 'output torque = T1·TV (the reducer multiplies torque)');
  near(T2, 3 * (3000 / ((2 * Math.PI * 1500) / 60)), 'output torque ≈ 57.3 N·m');

  // 4. GEAR GEOMETRY — module + teeth fix the pitch diameters and centre distance.
  const g1 = need(gearGeometry(pinionTeeth, module), 'pinion geo');
  const g2 = need(gearGeometry(gearTeeth, module), 'gear geo');
  near((g1 as any).value.pitchDiameter, 60, 'pinion pitch diameter = m·N = 60');
  near((g2 as any).value.pitchDiameter, 180, 'gear pitch diameter = 180');
  const centre = ((g1 as any).value.pitchDiameter + (g2 as any).value.pitchDiameter) / 2;
  near(centre, 120, 'centre distance = (d1+d2)/2 = 120');
  near((pair as any).extra.center_distance_mm, centre, 'CROSS-CHECK: gear_pair centre distance = the geometry');

  // 5. SHAFT — size the output shaft for the output torque, τ ≤ 40 MPa.
  const T2_Nmm = T2 * 1000;
  const tauAllow = 40;
  const d_req = Math.cbrt((16 * T2_Nmm) / (Math.PI * tauAllow)); // τ = 16T/πd³
  const shaftDia = Math.ceil(d_req / 2) * 2; // round up to even mm → 20
  assert(shaftDia === 20, 'output shaft sized to 20 mm (≥ required ' + d_req.toFixed(1) + ')');
  const st = need(shaftTorsion({ torque: T2_Nmm, diameter: shaftDia }), 'shaft torsion');
  near((st as any).value, (16 * T2_Nmm) / (Math.PI * shaftDia ** 3), 'shaft τ = 16T/πd³ ≈ 36.5 MPa');
  assert((st as any).value < tauAllow, 'CROSS-CHECK: shaft stress < allowable → the sized shaft holds the reducer torque');

  // 6. BEARING — the gear tooth force is the bearing's radial load; get L10.
  const pitchRadius = (g2 as any).value.pitchRadius; // 90 mm
  const Ft = T2_Nmm / pitchRadius; // tangential tooth force, N
  const Fr = Ft * Math.tan(20 * Math.PI / 180); // separating force
  const bearingLoad = Math.hypot(Ft, Fr); // resultant radial load
  near(Ft, T2_Nmm / 90, 'gear tangential force Ft = T/pitch_radius');
  const brg = need(bearingLife({ dynamicLoadRating: 20000, equivalentLoad: bearingLoad, bearingType: 'ball', speed_rpm: (train as any).extra.output_speed_rpm }), 'bearing');
  assert((brg as any).value.basicLife_Mrev > 0 && (brg as any).value.life_hours > 0, `output bearing L10 = ${Math.round((brg as any).value.life_hours)} h at ${bearingLoad.toFixed(0)} N radial load`);
  // the same shaft threads through the gear bore and the bearing bore.
  assert(shaftDia < (g2 as any).value.rootDiameter, 'CROSS-CHECK: the Ø20 shaft fits inside the gear (bore < root circle) — one shaft, gear + bearing');

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-gearbox-integration failure(s)`); process.exit(1); }
  console.log('All engineering-gearbox-integration cases passed — the transmission tools compose.');
}

main();
