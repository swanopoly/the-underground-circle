/**
 * engineering-design-conveyor-drive smoke.
 *
 * The one-call conveyor-drive designer packages the PROVEN chain → shaft → key →
 * bearing composition (engineering-conveyor-drive-integration), so this pins the
 * worked 3 kW / 960 rpm / 3:1 case by ROUND-TRIP, not by re-running the designer's
 * own arithmetic: the returned teeth fed back into chainDrive reproduce the PDs and
 * the EXACT integer ratio; F·V = P closes; the stock shaft Ø fed back through the
 * shaftDiameter stress forms beats the target SF; the key round-trips through
 * keyTorqueCapacity ≥ T; the required C round-trips through bearingLife ≥ the
 * target life. The SEAM is one force: F both bends the shaft (M = F·span/4) and
 * loads the bearings (R = F/2, with 2R = F closing the statics).
 */

import {
  designConveyorDrive, ANSI_ROLLER_CHAINS, STANDARD_SHAFT_MM, MIN_DRIVER_TEETH,
} from '../src/lib/engineeringDesignConveyorDriveCore';
import { chainDrive, chordalSpeedVariation } from '../src/lib/engineeringChainDriveCore';
import { shaftDiameter } from '../src/lib/engineeringShaftDesignCore';
import { keyTorqueCapacity } from '../src/lib/engineeringKeyCore';
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
function need<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── The worked case: 3 kW, 960 rpm in, 3:1 down to the conveyor head shaft ───
  const base = need(designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 960, ratio: 3 }), 'base design');
  const dim = base.dimensions;

  assert(base.type === 'conveyor_drive', "type is 'conveyor_drive'");
  assert(base.summary.length > 0 && base.summary.includes('chain'), 'summary is populated and mentions the chain');

  // chain sizing: #35 (9.525) would see F ≈ 1158 N > its 1137.5 N allowable → #40.
  assert(dim.chainPitch_mm === 12.7, 'sized pitch = 12.7 mm (#40 — the smallest pitch that carries F = P/V)');
  assert(dim.driverTeeth === 17 && dim.drivenTeeth === 51, 'teeth 17/51 (driver at the chordal floor, driven = round(17·3))');
  assert(dim.chainTension_N <= dim.chainAllowableTension_N, 'working tension ≤ the table allowable (breaking/SF 8)');
  near(dim.chainAllowableTension_N, 18200 / 8, 'allowable = 18.2 kN breaking / 8 = 2275 N (ANSI #40 row)');

  // EXACT ratio — positive engagement means a ratio of INTEGERS, asserted exactly.
  assert(dim.ratio === 3, 'realised ratio is EXACTLY 3 (51/17 — integer teeth, no slip term)');
  assert(dim.ratio * 17 === 51, 'ratio × N1 = N2 exactly (it IS the integer ratio)');
  assert(dim.outputSpeed_rpm === 320, 'output speed EXACTLY 320 rpm (960·17/51 — no belt creep)');

  // ROUND-TRIP: the returned teeth/pitch into chainDrive reproduce the drive EXACTLY.
  const rt = need(chainDrive({
    pitch: dim.chainPitch_mm, driverTeeth: dim.driverTeeth, drivenTeeth: dim.drivenTeeth,
    centreDistance_pitches: 40, driverSpeed_rpm: 960, power_kW: 3,
  }), 'chainDrive round-trip');
  assert(rt.pitchDiameterDriver === dim.pitchDiameterDriver_mm, 'round-trip PD driver matches EXACTLY');
  assert(rt.pitchDiameterDriven === dim.pitchDiameterDriven_mm, 'round-trip PD driven matches EXACTLY');
  assert(rt.ratio === dim.ratio, 'round-trip ratio matches EXACTLY');
  assert(rt.tangentialForce_N === dim.chainTension_N, 'round-trip chain tension matches EXACTLY');
  assert(rt.chainLength_pitches === dim.chainLength_pitches, 'round-trip chain length matches');
  assert(dim.chainLength_pitches % 2 === 0, 'chain length is an EVEN pitch count (no weak offset link)');
  assert(rt.adjustedCentreDistance === dim.centreDistance_mm, 'round-trip adjusted centre distance matches');

  // POWER INVARIANT: F·V = P closes (the suite's F·v = p·Q trick, chain edition).
  near(dim.chainTension_N * dim.chainSpeed_m_s, 3000, 'F·V = P closes: tension × chain speed = 3000 W', 1e-5);
  near(dim.chainSpeed_m_s, (17 * 12.7 * 960) / 60000, 'chain speed V = N1·p·n1 (polygon perimeter) ≈ 3.454 m/s', 1e-9);
  near(dim.chainTension_N, 3000 / 3.4544, 'chain tension F = P/V ≈ 868.5 N (hand)', 1e-4);

  // SEAM: ONE tension F feeds both the bending moment AND the bearing reactions.
  const F = dim.chainTension_N;
  near(dim.bendingMoment_Nmm, (F * 200) / 4, 'SEAM: M = F·span/4 uses the SAME chain tension (default 200 mm span)', 1e-12);
  near(dim.bearingReaction_N, F / 2, 'SEAM: each bearing reaction R = F/2 — the SAME tension again', 1e-12);
  assert(2 * dim.bearingReaction_N === F, '2R = F — the statics close exactly');
  const T_Nmm = dim.outputTorque_Nm * 1000;
  near(T_Nmm, F * (dim.pitchDiameterDriven_mm / 2), 'SEAM: head-shaft torque T = F·PD₂/2 (the tension at the sprocket radius)', 1e-12);

  // SHAFT ROUND-TRIP: same M and T through shaftDiameter → the designer's numbers.
  const sd = need(shaftDiameter({ bendingMoment: dim.bendingMoment_Nmm, torque: T_Nmm, safetyFactor: 2, material: 'steel' }), 'shaftDiameter round-trip');
  assert(sd.recommendedDiameter === dim.requiredShaftDiameter_mm, 'round-trip required shaft Ø matches EXACTLY');
  assert(sd.governing === 'MSST', 'MSST governs the conservative shaft size');
  assert(dim.shaftDiameter_mm === 25, 'stock shaft Ø25 (required ≈ 20.1 mm rounded UP to stock)');
  assert(STANDARD_SHAFT_MM.includes(dim.shaftDiameter_mm), 'stock Ø is from the standard list');
  assert(dim.shaftDiameter_mm >= dim.requiredShaftDiameter_mm, 'stock Ø ≥ the required minimum');
  // stress forms at the stock Ø give the realised SF ≥ the target (round up + re-check).
  const Me = Math.sqrt(dim.bendingMoment_Nmm ** 2 + T_Nmm ** 2);
  const tauMax = (16 * Me) / (Math.PI * 25 ** 3);
  near(base.safety.realisedStress_MPa!, tauMax, 'realised τ_max = 16·√(M²+T²)/πd³ at the stock Ø25');
  near(base.safety.realisedSafetyFactor!, 250 / (2 * tauMax), 'realised SF = Sy/(2·τ_max) at the stock Ø');
  assert(base.safety.realisedSafetyFactor! >= 2, 'the rounded-up stock shaft beats the 2× target');
  near(base.safety.realisedSafetyFactor!, 2 * (25 / sd.recommendedDiameter) ** 3, 'realised SF = target·(stock/required)³ (the cube of the round-up)');

  // KEY ROUND-TRIP: the returned key carries the design torque.
  assert(dim.keyWidth_mm === 8 && dim.keyHeight_mm === 7, 'standard 8×7 key at Ø25 (ISO 773 table)');
  const ktc = need(keyTorqueCapacity({
    shaftDiameter: dim.shaftDiameter_mm, width: dim.keyWidth_mm, height: dim.keyHeight_mm,
    length: dim.keyLength_mm, material: 'steel',
  }), 'keyTorqueCapacity round-trip');
  assert(ktc.torqueCapacity_Nmm >= T_Nmm, `key ${dim.keyWidth_mm}×${dim.keyHeight_mm}×${dim.keyLength_mm} capacity ${Math.round(ktc.torqueCapacity_Nmm)} N·mm ≥ the design torque`);
  assert(ktc.governingMode === 'bearing', 'rectangular key (w>h) is governed by bearing/crushing');

  // BEARING ROUND-TRIP: the required C gives ≥ the target life at the exact output rpm.
  assert(dim.requiredBearingC_N === 3160, 'required C = 3160 N (cube-law inversion, rounded UP to 10 N)');
  const brt = need(bearingLife({
    dynamicLoadRating: dim.requiredBearingC_N, equivalentLoad: dim.bearingReaction_N,
    bearingType: 'ball', speed_rpm: dim.outputSpeed_rpm,
  }), 'bearingLife round-trip');
  assert(brt.life_hours! >= 20000, `required C round-trips to L10 = ${Math.round(brt.life_hours!)} h ≥ the 20000 h target`);
  near(brt.life_hours!, dim.bearingL10_hours, 'reported realised L10 matches the round-trip', 1e-9);

  // CHORDAL: the driver honours the chain core's own chordal doctrine.
  assert(dim.driverTeeth >= MIN_DRIVER_TEETH, 'driver has ≥ 17 teeth (the chordal floor)');
  assert(chordalSpeedVariation(dim.driverTeeth) < chordalSpeedVariation(11), 'chordal ripple at the chosen teeth < the 11-tooth ripple');
  near(rt.chordalSpeedVariationDriver_pct, chordalSpeedVariation(17) * 100, 'round-trip chordal % = the core’s 1−cos(180°/17)', 1e-4);

  // MASS + MODEL: honest empty model (no sprocket generator exists to invent).
  near(base.mass_kg, Math.PI * 12.5 ** 2 * 300 * 7.85e-6, 'shaft mass = π·r²·(span+100)·ρ ≈ 1.156 kg');
  assert(base.model.positives.length === 0 && base.bpy === '', 'model.positives = [] and bpy empty — no sprocket solid generator is faked');
  assert(base.notes.some((n) => n.includes('sprocket')), 'a note explains why the model is empty');
  assert(base.material === 'steel', 'material echoed');

  // ─── Monotonicity ────────────────────────────────────────────────────────────
  const twice = need(designConveyorDrive({ power_kW: 6, inputSpeed_rpm: 960, ratio: 3 }), '2× power design');
  assert(twice.dimensions.chainTension_N > dim.chainTension_N, 'doubling power → larger chain tension');
  assert(twice.dimensions.chainPitch_mm >= dim.chainPitch_mm, 'doubling power → same-or-larger pitch');
  assert(twice.dimensions.shaftDiameter_mm >= dim.shaftDiameter_mm, 'doubling power → same-or-larger stock shaft');
  assert(twice.dimensions.requiredBearingC_N > dim.requiredBearingC_N, 'doubling power → larger required bearing C');

  const slow = need(designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 480, ratio: 3 }), 'half-speed design');
  assert(slow.dimensions.chainTension_N > dim.chainTension_N, 'halving speed at the same power → larger tension (F = P/V)');

  const big = need(designConveyorDrive({ power_kW: 30, inputSpeed_rpm: 960, ratio: 3 }), '30 kW design');
  assert(big.dimensions.chainPitch_mm === 25.4, '30 kW steps the sized pitch up to 25.4 mm (#80)');
  assert(big.dimensions.chainPitch_mm > dim.chainPitch_mm, 'ten× the power → a larger pitch');

  // ─── Non-integer requested ratio: realised = honest integer-tooth ratio ──────
  const odd = need(designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 960, ratio: 2.9 }), 'ratio 2.9 design');
  assert(odd.dimensions.drivenTeeth === 49, 'requested 2.9 → driven = round(17·2.9) = 49 teeth');
  assert(odd.dimensions.ratio === 49 / 17, 'realised ratio is EXACTLY 49/17 (reported honestly, ≠ the 2.9 request)');
  assert(odd.dimensions.requestedRatio === 2.9 && odd.dimensions.ratio !== 2.9, 'both requested and realised ratios are reported');

  // ─── Input-form equivalence ──────────────────────────────────────────────────
  const watts = need(designConveyorDrive({ power_W: 3000, inputSpeed_rpm: 960, ratio: 3 }), 'power_W form');
  assert(watts.dimensions.chainTension_N === dim.chainTension_N, 'power_W: 3000 ≡ power_kW: 3 (same tension)');
  const byOut = need(designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 960, outputSpeed_rpm: 320 }), 'outputSpeed form');
  assert(byOut.dimensions.drivenTeeth === 51 && byOut.dimensions.ratio === 3, 'outputSpeed_rpm 320 ≡ ratio 3 (same teeth)');

  // ─── Guards: helpful DesignResult errors ─────────────────────────────────────
  const noPower = designConveyorDrive({ inputSpeed_rpm: 960, ratio: 3 });
  assert(!noPower.ok && /power/.test(noPower.ok ? '' : noPower.error), 'missing power → helpful error');
  const zeroPower = designConveyorDrive({ power_kW: 0, inputSpeed_rpm: 960, ratio: 3 });
  assert(!zeroPower.ok, 'zero power rejected');
  const noSpeed = designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 0, ratio: 3 });
  assert(!noSpeed.ok && /inputSpeed/.test(noSpeed.ok ? '' : noSpeed.error), 'zero input speed → helpful error');
  const noRatio = designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 960 });
  assert(!noRatio.ok && /ratio|outputSpeed/.test(noRatio.ok ? '' : noRatio.error), 'missing ratio/output speed → helpful error');
  const speedUp = designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 960, ratio: 0.5 });
  assert(!speedUp.ok && /speed-UP|ratio ≥ 1|swap/i.test(speedUp.ok ? '' : speedUp.error), 'ratio < 1 refused with a speed-up explanation');
  const badMat = designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 960, ratio: 3, material: 'unobtanium' });
  assert(!badMat.ok && /unknown material/.test(badMat.ok ? '' : badMat.error), 'unknown material → helpful error listing options');
  const fewTeeth = designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 960, ratio: 3, driverTeeth: 12 });
  assert(!fewTeeth.ok && /chordal/.test(fewTeeth.ok ? '' : fewTeeth.error), 'driver < 17 teeth refused, citing the chordal doctrine');
  const oddPitch = designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 960, ratio: 3, chainPitch_mm: 13 });
  assert(!oddPitch.ok && /standard ANSI/.test(oddPitch.ok ? '' : oddPitch.error), 'non-standard pitch override refused, listing the table');
  const weakPitch = designConveyorDrive({ power_kW: 3, inputSpeed_rpm: 960, ratio: 3, chainPitch_mm: 9.525 });
  assert(!weakPitch.ok && /allowable/.test(weakPitch.ok ? '' : weakPitch.error), 'forced 9.525 pitch cannot carry 3 kW/960 → refused with F vs allowable');
  const monster = designConveyorDrive({ power_kW: 10000, inputSpeed_rpm: 960, ratio: 3 });
  assert(!monster.ok && /no standard/.test(monster.ok ? '' : monster.error), '10 MW exceeds every standard pitch → honest refusal');

  // The table itself is sane: pitches and breaking loads both strictly ascend.
  assert(ANSI_ROLLER_CHAINS.every((c, i) => i === 0 || c.pitch_mm > ANSI_ROLLER_CHAINS[i - 1].pitch_mm), 'chain table pitches strictly ascend');
  assert(ANSI_ROLLER_CHAINS.every((c, i) => i === 0 || c.breakingLoad_kN > ANSI_ROLLER_CHAINS[i - 1].breakingLoad_kN), 'chain table breaking loads strictly ascend');

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-design-conveyor-drive smoke failure(s)`); process.exit(1); }
  console.log('All engineering-design-conveyor-drive smoke cases passed — one call sizes the chain, head shaft, key, and bearings, and every seam round-trips.');
}

main();
