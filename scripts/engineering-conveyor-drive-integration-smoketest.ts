/**
 * engineering-conveyor-drive-integration — proof that the DRIVETRAIN tools compose
 * on a CHAIN-driven conveyor head shaft, and that a chain's positive engagement buys
 * an EXACT speed ratio a slipping belt cannot.
 *
 * The gearbox integration proved a GEAR reduction chains torque → shaft → bearing →
 * gear. This proves the sibling drivetrain a conveyor actually uses — a ROLLER CHAIN
 * — and makes the chain's defining advantage a hard assertion:
 *
 *   a 3 kW motor at 1000 rpm drives a conveyor head shaft through an 18/45-tooth
 *   roller chain (p = 12.7 mm), a 2.5:1 reduction.
 *
 *   1. chain drive   chainDrive — the sprocket TEETH give the EXACT ratio N2/N1, so
 *                    1000 rpm in → 400 rpm out EXACTLY. A belt of the same nominal
 *                    2.5 ratio slips/creeps 1-3% and misses that target. The chain
 *                    TENSION F = P/V is the single pull the chain carries.
 *   2. head shaft    that chain tension bends the overhung head shaft, M = F·span,
 *                    while the drive's output torque T2 = T1·ratio twists it — the
 *                    combined state shaftDiameter sizes the shaft for.
 *   3. key           keySizing keys the sprocket hub to that shaft for that same T2.
 *   4. bearing       the head-shaft bearing reacts that same chain pull F (+ any
 *                    conveyor load) → bearingLife L10.
 *
 * The SEAMS are the assertions and they all turn on ONE force and ONE torque: the
 * chain tension F both bends the shaft AND loads the bearing; the chain's exact
 * output torque T2 both sizes the shaft AND is what the key must carry; one shared
 * steel table feeds shaft and key. Pure — chains the tsx-loadable cores.
 * Refs: Shigley ch. 7 (shaft), ch. 17 (chain & belt); Khurmi (key, sprocket).
 */

import { chainDrive } from '../src/lib/engineeringChainDriveCore';
import { beltDrive } from '../src/lib/engineeringBeltDriveCore';
import { shaftDiameter } from '../src/lib/engineeringShaftDesignCore';
import { keySizing } from '../src/lib/engineeringKeyCore';
import { bearingLife } from '../src/lib/engineeringBearingCore';
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
  if (!r.ok) { failures.push(label); console.error(`FAIL: ${label} — not ok`); process.exit(1); } return r;
}

// Standard metric shaft sizes to round the required diameter UP to.
const STANDARD_SHAFT_MM = [16, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50];
function roundUpStandardShaft(d: number): number {
  for (const s of STANDARD_SHAFT_MM) if (s >= d - 1e-9) return s;
  return Math.ceil(d);
}

function main() {
  // ── duty ──
  const power_W = 3000, power_kW = 3, n1_rpm = 1000;
  const pitch = 12.7, N1 = 18, N2 = 45, centre = 500; // roller chain 08B, 2.5:1
  const span_mm = 75;      // sprocket overhang → moment arm to the critical shaft section
  const shaftSF = 3;       // conveyor duty (shock)
  const material = 'steel';

  const omega = (rpm: number) => (2 * Math.PI * rpm) / 60;

  // 1. CHAIN DRIVE — teeth fix the EXACT ratio, speed, and the tension the chain pulls.
  const chain = need(chainDrive({
    pitch, driverTeeth: N1, drivenTeeth: N2, centreDistance: centre,
    driverSpeed_rpm: n1_rpm, power_kW,
  }), 'chainDrive');
  const cv = chain.value;

  assert(cv.ratio === N2 / N1, 'chain ratio = N2/N1 = 45/18 (positive engagement, NO slip term)');
  assert(cv.ratio === 2.5, 'chain ratio is EXACTLY 2.5');
  assert(cv.drivenSpeed_rpm === 400, 'output speed = n1/ratio = 400 rpm (EXACT — rollers seat one pin per tooth)');
  assert(cv.drivenSpeed_rpm === n1_rpm / cv.ratio, 'output speed seam: n2 = n1/ratio, no slip');
  const V = N1 * pitch * (n1_rpm / 60) / 1000; // polygon perimeter per rev → m/s
  near(cv.chainSpeed_m_s!, V, 'chain speed V = N1·p·n1 (polygon perimeter), ≈ 3.81 m/s');
  near(cv.chainSpeed_m_s!, 3.81, 'chain speed ≈ 3.81 m/s (hand)');
  const F = cv.tangentialForce_N!;               // the chain tension = the load it carries
  near(F, power_W / V, 'chain tension F = P/V (the one pull the chain carries)');
  near(F, 787.4016, 'chain tension ≈ 787 N (hand)');
  assert(cv.chainLength_pitches % 2 === 0, 'chain length rounds to an EVEN pitch count (no weak offset link)');

  // input & output torque — the EXACT ratio multiplies torque.
  const T1 = power_W / omega(n1_rpm);                 // N·m
  const T2_ratio = T1 * cv.ratio;                     // exact-ratio path
  const T2_power = power_W / omega(cv.drivenSpeed_rpm!); // power/exact-driven-speed path
  near(T1, 28.6479, 'input torque T1 = P/ω1 ≈ 28.65 N·m');
  near(T2_ratio, T2_power, 'SEAM: output torque T2 = T1·ratio equals P/ω2 (exact ratio ⇒ exact torque multiply)');
  near(T2_ratio, 71.6197, 'output torque T2 ≈ 71.62 N·m (hand)');
  const T2 = T2_ratio, T2_Nmm = T2 * 1000;

  // cross-check the torque via the chain FORCE path (F acts at the driven pitch radius);
  // it agrees with the power path to within the polygon/chordal effect (<0.2%).
  const T2_force = (F * (cv.pitchDiameterDriven / 2)) / 1000; // N·m
  near(T2_force, T2_power, 'chain-force torque F·PD2/2 agrees with power torque within the polygon effect', 3e-3);

  // 2. BELT CONTRAST — same nominal 2.5, but a belt SLIPS and misses the exact target.
  const belt = need(beltDrive({
    driverDiameter: 80, drivenDiameter: 200, centreDistance: centre,
    driverSpeed_rpm: n1_rpm, frictionCoeff: 0.3, grooveHalfAngle_deg: 18, tightSideTension_N: 1200,
  }), 'beltDrive');
  const targetOut = n1_rpm / cv.ratio; // 400 rpm design target
  assert(belt.value.drivenSpeed_rpm === 400, 'belt IDEAL (no-slip formula) driven speed also = 400 rpm');
  const slip = 0.02; // real V-belts creep/slip ~1-3% under load
  const beltRealOut = belt.value.drivenSpeed_rpm! * (1 - slip);
  assert(cv.drivenSpeed_rpm === targetOut, 'CHAIN hits the 400 rpm target EXACTLY (positive engagement)');
  assert(Math.abs(cv.drivenSpeed_rpm! - targetOut) === 0, 'chain output speed error is exactly ZERO');
  assert(beltRealOut < targetOut && Math.abs(beltRealOut - targetOut) > 0,
    'a BELT of the same 2.5 ratio slips ~2% and UNDERSHOOTS the target (a chain cannot)');
  near(beltRealOut, 392, 'belt delivers ≈ 392 rpm under 2% creep/slip — 8 rpm short of target');

  // 3. HEAD SHAFT — the chain tension bends it (M = F·span), T2 twists it → size it.
  const M_Nmm = F * span_mm; // overhung sprocket: bending moment at the critical section
  const shaft = need(shaftDiameter({ bendingMoment: M_Nmm, torque: T2_Nmm, safetyFactor: shaftSF, material }), 'shaftDiameter');
  const sv = shaft.value;
  near(sv.bendingMoment, F * span_mm, 'SEAM: bending moment fed to the shaft = chain tension × span');
  near(sv.bendingMoment, 59055.12, 'M = 787.4 N × 75 mm ≈ 59,055 N·mm (hand)');
  near(sv.torque, T2_Nmm, 'SEAM: torque fed to the shaft = the chain drive output torque T2');
  const Me = Math.sqrt(M_Nmm ** 2 + T2_Nmm ** 2);
  near(sv.equivalentMoment, Me, 'shaft equivalent moment Me = √(M²+T²) (combined bending+torsion)');
  const dReq = Math.cbrt((32 * shaftSF / (Math.PI * MATERIALS.steel.yield)) * Me);
  near(sv.recommendedDiameter, dReq, 'shaft recommended dia = MSST √(M²+T²) formula (≈ 22.5 mm)');
  assert(sv.governing === 'MSST', 'MSST governs the conservative shaft design');
  assert(sv.yieldStrength === MATERIALS.steel.yield, 'shaft sized on the shared steel yield (250 MPa)');
  const shaftD = roundUpStandardShaft(sv.recommendedDiameter);
  assert(shaftD === 25, 'chosen shaft = 25 mm (round the ≈22.5 mm minimum UP to a standard size)');
  assert(shaftD >= sv.recommendedDiameter, 'chosen standard shaft ≥ the required minimum');

  // 4. KEY — key the sprocket hub to that shaft for that SAME output torque.
  const hubLength = 35; // available key length ≈ hub width
  const key = need(keySizing({ shaftDiameter: shaftD, torqueNmm: T2_Nmm, material, length: hubLength }), 'keySizing');
  const kv = key.value;
  near(kv.torque_Nmm, T2_Nmm, 'SEAM: key sized for the SAME torque as the shaft (T2)');
  assert(kv.shaftDiameter_mm === shaftD, 'SEAM: key sits on the chosen shaft diameter (25 mm)');
  near(kv.force_N, (2 * T2_Nmm) / shaftD, 'key tangential force F = 2T/d ≈ 5730 N');
  assert(kv.width_mm === 8 && kv.height_mm === 7, 'standard 8×7 rectangular key at Ø25 (ISO 773 table)');
  assert(kv.governingMode === 'bearing', 'a rectangular key (w>h) is governed by BEARING/crushing');
  near(kv.requiredLength_mm, 7.276, 'required key length ≈ 7.28 mm (bearing governs)');
  assert(kv.yield_MPa === MATERIALS.steel.yield, 'SEAM: key uses the SAME shared steel table as the shaft (250 MPa)');
  assert(kv.adequate === true, `the ${hubLength} mm hub key is adequate (SF = ${kv.safetyFactor} at bearing)`);

  // 5. BEARING — the head-shaft bearing reacts that SAME chain pull F → L10 life.
  const C_N = 25500;               // dynamic load rating of a Ø25 ball bearing
  const TARGET_L10H = 25000;       // continuous-conveyor design life
  const brgA = need(bearingLife({ dynamicLoadRating: C_N, equivalentLoad: F, bearingType: 'ball', speed_rpm: cv.drivenSpeed_rpm }), 'bearing (chain load)');
  near(brgA.value.equivalentLoad_N, F, 'SEAM: bearing radial load = the chain tension F (the ONE force that also bent the shaft)');
  assert(brgA.value.life_hours! > TARGET_L10H, `chain-only bearing L10 = ${Math.round(brgA.value.life_hours!)} h > ${TARGET_L10H} h target`);

  // (+ any conveyor load) — the general seam: chain tension PLUS the conveyor belt pull.
  const W_conveyor = 2000;
  const brgB = need(bearingLife({ dynamicLoadRating: C_N, equivalentLoad: F + W_conveyor, bearingType: 'ball', speed_rpm: cv.drivenSpeed_rpm }), 'bearing (chain+conveyor)');
  near(brgB.value.equivalentLoad_N, F + W_conveyor, 'SEAM: full bearing load = chain tension + conveyor pull');
  assert(brgB.value.life_hours! > TARGET_L10H, `chain+conveyor bearing L10 = ${Math.round(brgB.value.life_hours!)} h still > ${TARGET_L10H} h`);
  assert(brgB.value.basicLife_Mrev < brgA.value.basicLife_Mrev, 'adding the conveyor pull SHORTENS bearing life (more load, less life)');

  // cube-law sensitivity: doubling the load cuts L10 by exactly 8× (L10 ∝ 1/P³, ball p=3).
  const brg2F = need(bearingLife({ dynamicLoadRating: C_N, equivalentLoad: 2 * F, bearingType: 'ball' }), 'bearing (2×chain load)');
  near(brgA.value.basicLife_Mrev / brg2F.value.basicLife_Mrev, 8, 'cube law: doubling the chain load ⇒ 1/8 the bearing life');

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-conveyor-drive-integration failure(s)`); process.exit(1); }
  console.log('All engineering-conveyor-drive-integration smoke cases passed');
}

main();
