/**
 * engineering-pressure-cover-integration — proof that the PRESSURE-VESSEL lanes
 * compose. A pressure vessel is the place where ONE number — the internal
 * pressure p — flows through THREE independent cores at once:
 *
 *   1. it splits the wall open           → thickCylinder (Lamé hoop stress)
 *   2. it bends the bolted end cover     → platePressure (clamped circular plate)
 *   3. its end-load over the cover area  → boltedJoint (the flange bolts must
 *      clamp p·π·a² without the joint separating, and survive it if it cycles)
 *
 * Worked example — a bolted end on a Ø400 mm steel vessel at 2 MPa:
 *
 *   duty        Ø400 bore (a = ri = 200 mm), p = 2 MPa internal, steel,
 *               allowable = yield / 2.5.
 *   wall        thickCylinder sizes the 10 mm shell: Lamé bore hoop, and the
 *               cross-check that it degenerates to the pressureVessel p·r/t lane.
 *   cover       the SAME p loads the circular cover as a clamped plate →
 *               platePressure sizes the thickness so its edge stress clears the
 *               allowable.
 *   bolts       the SAME p over the SAME cover area is the end load F = p·π·a²
 *               the bolts hold → jointStiffness / separationLoad / boltFatigue.
 *
 * The seams asserted (output of one core = input of the next):
 *   • p (2 MPa)  → wall hoop  AND  plate pressure  AND  end load          (three lanes, one number)
 *   • a (200 mm) → thickCylinder ri  AND  plate radius  AND  end-load area (one radius, three lanes)
 *   • thickCylinder.thinWallHoopApprox === calcCore pressureVessel p·r/t   (thick→thin degeneration)
 *   • F_total = p·π·a² = p × cover area  → per-bolt load → separation & fatigue
 *   • the joint stiffness constant C is the SAME in jointStiffness, separationLoad, and boltFatigue
 *   • one steel yield sets the allowable for BOTH the wall and the cover
 */

import { thickCylinder } from '../src/lib/engineeringThickCylinderCore';
import { platePressure } from '../src/lib/engineeringPlateBendingCore';
import { jointStiffness, separationLoad, boltFatigue } from '../src/lib/engineeringBoltedJointCore';
import { MATERIALS, materialProps, pressureVessel } from '../src/lib/engineeringCalcCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function need<T extends { ok: boolean }>(r: T, label: string): T { if (!r.ok) { failures.push(label); console.error(`FAIL: ${label} — not ok`); process.exit(1); } return r; }

function main() {
  // ── duty ──────────────────────────────────────────────────────────────────
  const bore_mm = 400;        // vessel bore
  const a_mm = bore_mm / 2;   // cover radius = vessel inner radius = 200 mm
  const p_MPa = 2;            // internal pressure — THE number that flows through all three lanes
  const wall_mm = 10;         // shell wall thickness → ro = 210 mm, r/t = 20

  // 0. MATERIAL — one steel supplies E (plate stiffness, joint stiffness) AND the
  //    yield that sets the allowable for BOTH the wall and the cover.
  const steel = need(materialProps('steel'), 'material lookup');
  near(steel.value, 200_000, 'steel E = 200 GPa (the modulus the plate + joint share)');
  near(steel.extra!.yield_MPa, 250, 'steel yield = 250 MPa');
  const allow_MPa = steel.extra!.yield_MPa / 2.5; // SF 2.5 on yield
  near(allow_MPa, 100, 'allowable = yield / 2.5 = 100 MPa (used by BOTH wall + cover)');

  // ── LANE 1: the VESSEL WALL splits under p (thick-cylinder Lamé) ────────────
  const shell = need(thickCylinder({ innerRadius: a_mm, outerRadius: a_mm + wall_mm, internalPressure: p_MPa }), 'thick cylinder');
  // Lamé bore hoop for ri=200, ro=210, p=2: A + B/ri² = 19.5122 + 21.5122 = 41.0244 MPa.
  near(shell.value.hoopStressBore, 41.0244, 'wall Lamé bore hoop = 41.02 MPa');
  // SEAM (boundary condition): the radial stress at the bore is exactly −p — the pressure IS the load.
  near(shell.value.radialStressBore, -p_MPa, 'SEAM: σr at the bore = −p (the pressure is the boundary condition)');
  assert(shell.value.hoopStressBore < allow_MPa, `wall hoop ${shell.value.hoopStressBore} MPa < ${allow_MPa} MPa allowable — the 10 mm shell holds`);

  // SEAM (cross-core, thick→thin degeneration): thickCylinder's thin-wall reference
  // is exactly the calcCore pressureVessel p·r/t hoop — same formula, different core.
  const thin = need(pressureVessel({ pressure: p_MPa, innerRadius: a_mm, wallThickness: wall_mm }), 'pressureVessel thin-wall');
  near(thin.value, 40, 'thin-wall p·r/t hoop = 40 MPa (calcCore pressureVessel)');
  near(shell.value.thinWallHoopApprox, thin.value, 'SEAM: thickCylinder.thinWallHoopApprox === calcCore pressureVessel hoop (p·r/t)');
  // the exact Lamé result sits just above the thin estimate; for r/t = 20 that gap is ~2.6%.
  const gap10 = shell.value.hoopStressBore / thin.value - 1;
  assert(gap10 > 0 && gap10 < 0.03, `Lamé bore hoop is ${(gap10 * 100).toFixed(2)}% above the thin-wall estimate at r/t=20 (thick > thin, small gap)`);

  // CONVERGENCE seam: a THINNER wall drives the Lamé result closer to p·r/t (monotone).
  const thinnerWall = 4; // r/t = 50
  const shell2 = need(thickCylinder({ innerRadius: a_mm, outerRadius: a_mm + thinnerWall, internalPressure: p_MPa }), 'thin-wall thick cylinder');
  const gap50 = shell2.value.hoopStressBore / shell2.value.thinWallHoopApprox - 1;
  assert(gap50 < gap10, `thinner wall converges: r/t=50 gap ${(gap50 * 100).toFixed(2)}% < r/t=20 gap ${(gap10 * 100).toFixed(2)}% — Lamé → p·r/t as t→0`);

  // ── LANE 2: the SAME p bends the bolted COVER (clamped circular plate) ───────
  // Size the cover thickness from the clamped-plate edge stress σ = 0.75·q·(a/t)² ≤ allowable.
  const tReq = a_mm * Math.sqrt((0.75 * p_MPa) / allow_MPa); // 24.49 mm
  near(tReq, 24.4949, 'required cover thickness from 0.75·q·(a/t)² ≤ allowable = 24.49 mm');
  const cover_mm = Math.ceil(tReq); // 25 mm — the design output
  assert(cover_mm === 25, 'cover thickness rounds up to 25 mm (the design deliverable)');

  const cover = need(platePressure({ shape: 'circular', radius: a_mm, thickness: cover_mm, pressure: p_MPa, edge: 'clamped', material: 'steel' }), 'plate pressure');
  // SEAM: the pressure fed to the plate IS the vessel pressure.
  near(cover.value.inputs.pressure_MPa, p_MPa, 'SEAM: plate pressure input === vessel p (2 MPa)');
  // SEAM: the plate radius IS the vessel inner radius (the cover closes the bore).
  near(cover.value.characteristicLength_mm, a_mm, 'SEAM: plate radius a === vessel ri = 200 mm');
  // SEAM: the plate resolved the SAME steel modulus as the material lookup.
  near(cover.value.inputs.E_MPa, MATERIALS.steel.E, 'SEAM: plate E === steel E from MATERIALS (one material)');
  // clamped circular: σ_max = 0.75·2·(200/25)² = 96 MPa, at the edge.
  near(cover.value.sigmaMax_MPa, 96, 'cover edge stress = 96 MPa');
  assert(cover.value.sigmaLocation === 'edge', 'clamped cover peaks at the EDGE (bolted-flat boundary)');
  assert(cover.value.sigmaMax_MPa < allow_MPa, `cover stress ${cover.value.sigmaMax_MPa} MPa < ${allow_MPa} MPa allowable — the 25 mm cover holds`);
  near(cover.value.yMax_mm, 0.17472, 'cover centre deflection ≈ 0.175 mm', 2e-3);

  // ── LANE 3: the SAME p over the SAME cover area is the END LOAD the bolts hold
  // THE KEY SEAM: F_total = p·π·a² = p × cover area.
  const coverArea_mm2 = Math.PI * a_mm * a_mm;
  const Ftotal_N = p_MPa * Math.PI * a_mm * a_mm;
  near(Ftotal_N, 251327.4122, 'end load F_total = p·π·a² = 251.3 kN');
  near(Ftotal_N, p_MPa * coverArea_mm2, 'SEAM: end load = p × cover area (the pressure lifting the cover off)');

  const nBolts = 12;
  const Pbolt_N = Ftotal_N / nBolts; // per-bolt external tensile load
  near(Pbolt_N, 20943.9510, 'per-bolt end load = F_total / 12 = 20.94 kN');

  // the flange joint diagram — M16 bolt through a 50 mm steel grip (cover + flange).
  const boltD = 16, grip = 50, preload_N = 50_000; // Fi = 50 kN preload per bolt
  const jd = need(jointStiffness({
    boltDiameter: boltD, grip, boltMaterial: 'steel', memberMaterial: 'steel',
    preload: preload_N, externalLoad: Pbolt_N,
  }), 'joint stiffness');
  const C = jd.value.stiffnessConstant_C;
  assert(C > 0 && C < 1, `joint stiffness constant 0 < C = ${C} < 1`);
  near(C, 0.214365, 'C ≈ 0.214 (stiff steel members shed most of the load — bolt feels little)', 3e-3);

  // SEAM (load bookkeeping): the bolt gains C·P, the members shed (1−C)·P, and they add back to P.
  near(jd.value.boltLoadIncrease_N! + jd.value.memberLoadDecrease_N!, Pbolt_N, 'SEAM: C·P + (1−C)·P = P (the joint splits the end load)');
  assert(jd.value.jointSeparated === false && jd.value.memberForce_N! > 0, `residual clamp Fm = ${jd.value.memberForce_N} N > 0 — the joint stays closed under the end load`);

  // SEAM: separationLoad consumes the SAME C; P0 = Fi/(1−C) must exceed the per-bolt end load.
  const sep = need(separationLoad({ preload: preload_N, stiffnessConstant: C, externalLoad: Pbolt_N }), 'separation load');
  near(sep.value.separationLoad_N, preload_N / (1 - C), 'SEAM: separation load P0 = Fi/(1−C) (same C as the stiffness diagram)');
  assert(sep.value.adequate === true && sep.value.separationLoad_N > Pbolt_N, `P0 = ${sep.value.separationLoad_N} N > per-bolt end load ${Math.round(Pbolt_N)} N — no separation (SF ${sep.value.safetyFactor})`);
  assert(sep.value.safetyFactor! > 3, `separation safety factor ${sep.value.safetyFactor} > 3`);
  // total-preload consistency: N bolts of P0 clear the whole end load.
  assert(nBolts * sep.value.separationLoad_N > Ftotal_N, `SEAM: 12 × P0 = ${Math.round(nBolts * sep.value.separationLoad_N)} N clears the total end load ${Math.round(Ftotal_N)} N`);

  // the bolt's own tension: max bolt force over the stress area must clear proof.
  const STRESS_AREA_COEFF = 0.9382, boltPitch = 2.0; // M16 coarse
  const ds = boltD - STRESS_AREA_COEFF * boltPitch;
  const At_mm2 = (Math.PI / 4) * ds * ds; // 156.65 mm²
  near(At_mm2, 156.6681, 'M16 tensile stress area At = 156.7 mm² (standard As ≈ 157)');
  const sigmaBolt = jd.value.boltForce_N! / At_mm2;
  const proof_MPa = 600; // class 8.8 proof strength
  assert(sigmaBolt < proof_MPa, `max bolt stress Fb/At = ${Math.round(sigmaBolt)} MPa < ${proof_MPa} MPa proof — the bolt itself holds`);

  // ── LANE 3b: the pressure CYCLES 0→2 MPa → bolt fatigue (carries only C) ─────
  const fat = need(boltFatigue({
    stiffnessConstant: C, preload: preload_N, loadMin: 0, loadMax: Pbolt_N,
    boltDiameter: boltD, pitch: boltPitch, ultimate: 830, endurance: 140, proof: proof_MPa,
  }), 'bolt fatigue');
  // SEAM: the fatigue core resolves the SAME stress area, and its max stress === the joint-diagram Fb/At.
  near(fat.value.stressArea_mm2, At_mm2, 'SEAM: fatigue core At === the At the bolt-tension check used');
  near(fat.value.stiffnessConstant_C, C, 'SEAM: fatigue uses the SAME C as the stiffness diagram');
  near(fat.value.maxStress_MPa, sigmaBolt, 'SEAM: fatigue σmax === joint-diagram Fb/At (one bolt force)');
  // the alternating stress carries only the factor C, so it is tiny beside the preload mean.
  near(fat.value.alternating_MPa, (C * Pbolt_N) / (2 * At_mm2), 'SEAM: σa = C·ΔP/(2·At) — the bolt feels only C of the swing');
  assert(fat.value.alternating_MPa < 0.1 * fat.value.mean_MPa, `σa = ${fat.value.alternating_MPa} MPa ≪ σm = ${fat.value.mean_MPa} MPa — preload protects the bolt from the cycle`);
  assert(fat.value.governing_n > 1, `bolt survives the pressure cycle: governing n = ${fat.value.governing_n} (${fat.value.governing}) > 1`);
  assert(fat.value.nf_preload! > 4, `preload-referenced fatigue factor ${fat.value.nf_preload} > 4 — fatigue is not the limit`);
  assert(fat.value.governing === 'first_cycle_yield', 'a heavily-preloaded flange bolt is governed by first-cycle yield, not fatigue (Shigley) — the honest limit state');

  // ── LANE 4: the bolt circle ties cover, flange, and vessel together ──────────
  const boltCircle_mm = 460, coverOD_mm = 500;
  assert(boltCircle_mm > bore_mm, `bolt circle Ø${boltCircle_mm} > bore Ø${bore_mm} — the bolts sit outside the sealed bore`);
  assert(coverOD_mm > boltCircle_mm, `cover OD Ø${coverOD_mm} > bolt circle Ø${boltCircle_mm} — the cover overhangs the bolts`);

  // ── report ──────────────────────────────────────────────────────────────────
  console.log(`\nWorked design: Ø${bore_mm} steel vessel @ ${p_MPa} MPa`);
  console.log(`  wall ${wall_mm} mm  → Lamé bore hoop ${shell.value.hoopStressBore} MPa (thin-wall ${thin.value} MPa) < ${allow_MPa} allow`);
  console.log(`  cover ${cover_mm} mm → clamped edge stress ${cover.value.sigmaMax_MPa} MPa < ${allow_MPa} allow, δ ${cover.value.yMax_mm} mm`);
  console.log(`  end load ${Math.round(Ftotal_N)} N = p·π·a² over ${nBolts} × M16 → ${Math.round(Pbolt_N)} N/bolt`);
  console.log(`  preload ${preload_N} N → C ${C}, P0 ${Math.round(sep.value.separationLoad_N)} N (SF ${sep.value.safetyFactor}), fatigue n ${fat.value.governing_n}`);

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-pressure-cover-integration failure(s)`); process.exit(1); }
  console.log('All engineering-pressure-cover-integration smoke cases passed');
}

main();
