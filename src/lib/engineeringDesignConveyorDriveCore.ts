/**
 * engineeringDesignConveyorDriveCore — ONE-CALL CONVEYOR DRIVE design: packages
 * the PROVEN conveyor-drive composition chain
 * (scripts/engineering-conveyor-drive-integration-smoketest.ts) into a single
 * designer, the way engineeringDesignCore packaged the bracket/shaft/beam chain.
 *
 * State the DUTY — "3 kW at 960 rpm in, 3:1 down to the head shaft" — and get
 * back a finished drive:
 *
 *   1. CHAIN     pick driver teeth ≥ 17 (the chain core's own chordal floor),
 *                driven = round(driver·ratio) → the realised ratio is a ratio of
 *                INTEGERS (positive engagement, exactly zero slip). SIZE the
 *                pitch: walk the standard ANSI pitches upward and take the
 *                smallest whose working tension F = P/V stays under the
 *                allowable (breaking load / chain service factor). chainDrive
 *                then fixes pitch diameters, chain speed, even-pitch chain
 *                length, and the one tension F the chain carries.
 *   2. HEAD SHAFT the SAME tension F both BENDS the shaft (M = F·span/4, chain
 *                pull mid-span between the two bearings) and — through the
 *                driven sprocket radius — TWISTS it (T = F·PD₂/2). shaftDiameter
 *                sizes the combined M+T state (MSST governs), the result is
 *                rounded UP to a stock size, and the realised safety factor is
 *                RE-CHECKED at that stock diameter.
 *   3. KEY       keySizing keys the sprocket hub to that stock shaft for that
 *                same torque T (standard ISO 773 section, length rounded up).
 *   4. BEARINGS  each bearing reacts R = F/2 (2R = F closes the statics); the
 *                required dynamic rating C for the target L10 life at the exact
 *                output speed comes from inverting L10 = (C/P)³, rounded up,
 *                then bearingLife re-checks the realised life.
 *
 * THE CHAIN TABLE IS HARD-CODED, like the suite's ISO-286 IT grades and ISO 773
 * key sections: ANSI B29.1-style roller-chain pitches with their published
 * minimum ultimate (breaking) loads (#35…#160: 9.1, 18.2, 29.5, 41.5, 88.5,
 * 127, 172.4, 226.8, 340.2 kN). Allowable working tension = breaking load /
 * chain service factor (default 8, the usual slow-to-moderate-speed rule).
 *
 * NO SOLID IS INVENTED: the suite has no sprocket solid generator, so — exactly
 * like designBeam when the bpy comes from elsewhere — the returned model is
 * `{ positives: [] }` with `bpy: ''` and a note; the shaft itself can be
 * modeled through the existing shaft lane if a solid is needed.
 *
 * Pure + tsx-loadable (smoke:
 * scripts/engineering-design-conveyor-drive-smoketest.ts): composes the chain /
 * shaft-design / key / bearing / material cores; no I/O. Types only from
 * engineeringDesignCore (a runtime import would cycle through its dispatcher).
 * Refs: Shigley ch. 7 (shaft) & ch. 17 (roller chain), ANSI B29.1 chain table,
 * ISO 773 keys, ISO 281 bearing life.
 */

import type { DesignedPart, DesignResult } from './engineeringDesignCore';
import { chainDrive } from './engineeringChainDriveCore';
import { shaftDiameter } from './engineeringShaftDesignCore';
import { keySizing } from './engineeringKeyCore';
import { bearingLife } from './engineeringBearingCore';
import { MATERIALS } from './engineeringCalcCore';

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r3(n: number): number { return Math.round(n * 1e3) / 1e3; }

/**
 * ANSI B29.1-style single-strand roller chains: pitch (mm) and published minimum
 * ultimate (breaking) load (kN), ascending. Hard-coded like the ISO-286 IT-grade
 * and ISO 773 key tables — a published table, not a formula.
 */
export const ANSI_ROLLER_CHAINS: ReadonlyArray<{ number: string; pitch_mm: number; breakingLoad_kN: number }> = [
  { number: '35', pitch_mm: 9.525, breakingLoad_kN: 9.1 },
  { number: '40', pitch_mm: 12.7, breakingLoad_kN: 18.2 },
  { number: '50', pitch_mm: 15.875, breakingLoad_kN: 29.5 },
  { number: '60', pitch_mm: 19.05, breakingLoad_kN: 41.5 },
  { number: '80', pitch_mm: 25.4, breakingLoad_kN: 88.5 },
  { number: '100', pitch_mm: 31.75, breakingLoad_kN: 127 },
  { number: '120', pitch_mm: 38.1, breakingLoad_kN: 172.4 },
  { number: '140', pitch_mm: 44.45, breakingLoad_kN: 226.8 },
  { number: '160', pitch_mm: 50.8, breakingLoad_kN: 340.2 },
];

/** Stock head-shaft diameters (mm) the required diameter is rounded UP to. */
export const STANDARD_SHAFT_MM: ReadonlyArray<number> = [15, 17, 20, 25, 30, 35, 40, 45, 50, 60];

/** Chordal-action floor from the chain core's own doctrine: ripple 1−cos(180°/N) is ~1.7% at 17T. */
export const MIN_DRIVER_TEETH = 17;

/** Default chain service factor: allowable tension = breaking load / 8. */
export const DEFAULT_CHAIN_SERVICE_FACTOR = 8;

export type ConveyorDriveSpec = {
  power_kW?: number;          // transmitted power (kW) …
  power_W?: number;           // … or in watts
  inputSpeed_rpm: number;     // drive (driver-sprocket) speed n1
  outputSpeed_rpm?: number;   // desired head-shaft speed …
  ratio?: number;             // … or the reduction ratio n1/n2 directly (≥ 1)
  material?: string;          // shaft/key material (default 'steel')
  safetyFactor?: number;      // shaft design SF (default 2)
  bearingSpan_mm?: number;    // distance between the two head-shaft bearings (default 200)
  targetLifeHours?: number;   // bearing L10 target (default 20000 h)
  chainPitch_mm?: number;     // optional: force a standard pitch instead of sizing one
  chainServiceFactor?: number;// allowable = breaking / this (default 8)
  driverTeeth?: number;       // optional: integer ≥ 17 (default 17)
  centreDistance_pitches?: number; // sprocket centre distance in pitches (default 40)
};

/**
 * One-call conveyor drive: size the roller chain (smallest standard pitch that
 * carries F = P/V), fix the EXACT integer-tooth ratio, then let that one chain
 * tension bend the head shaft, twist it through the sprocket radius, size the
 * stock shaft + key, and rate the bearings for the target L10 life.
 */
export function designConveyorDrive(spec: ConveyorDriveSpec): DesignResult<DesignedPart> {
  // ── duty ──
  let powerW: number | null = null;
  if (spec.power_kW !== undefined) {
    const p = pos(spec.power_kW);
    if (p === null) return { ok: false, error: 'conveyor drive needs a positive power_kW (kW)' };
    powerW = p * 1000;
  } else if (spec.power_W !== undefined) {
    const p = pos(spec.power_W);
    if (p === null) return { ok: false, error: 'conveyor drive needs a positive power_W (W)' };
    powerW = p;
  }
  if (powerW === null) return { ok: false, error: 'conveyor drive needs the transmitted power — power_kW (or power_W)' };

  const n1 = pos(spec.inputSpeed_rpm);
  if (n1 === null) return { ok: false, error: 'conveyor drive needs a positive inputSpeed_rpm (driver-sprocket rpm)' };

  let ratioReq: number | null = null;
  if (spec.ratio !== undefined) ratioReq = pos(spec.ratio);
  else if (spec.outputSpeed_rpm !== undefined) {
    const n2 = pos(spec.outputSpeed_rpm);
    ratioReq = n2 === null ? null : n1 / n2;
  }
  if (ratioReq === null) return { ok: false, error: 'conveyor drive needs a positive outputSpeed_rpm or ratio (= input/output speed)' };
  if (ratioReq < 1) {
    return { ok: false, error: `ratio ${ratioReq} < 1 is a speed-UP — this designer sizes a reduction to a slower head shaft (ratio ≥ 1); swap driver and driven if you really want an overdrive` };
  }

  const matName = String(spec.material ?? 'steel').trim().toLowerCase();
  const mat = MATERIALS[matName];
  if (!mat) return { ok: false, error: `unknown material "${spec.material}" — known: ${Object.keys(MATERIALS).join(', ')}` };
  const SF = pos(spec.safetyFactor) ?? 2;
  const span = pos(spec.bearingSpan_mm) ?? 200;
  const targetLife = pos(spec.targetLifeHours) ?? 20000;
  const chainSF = pos(spec.chainServiceFactor) ?? DEFAULT_CHAIN_SERVICE_FACTOR;
  const Cp = pos(spec.centreDistance_pitches) ?? 40;

  // ── teeth: driver ≥ 17 (chordal floor), driven rounds the ratio to integers ──
  let N1 = MIN_DRIVER_TEETH;
  if (spec.driverTeeth !== undefined) {
    const dt = Number(spec.driverTeeth);
    if (!Number.isInteger(dt) || dt < MIN_DRIVER_TEETH) {
      return { ok: false, error: `driverTeeth must be an integer ≥ ${MIN_DRIVER_TEETH} — below that the chordal (polygon) speed ripple 1−cos(180°/N) gets rough` };
    }
    N1 = dt;
  }
  const N2 = Math.max(N1, Math.round(N1 * ratioReq));
  const realisedRatio = N2 / N1; // EXACT — a ratio of integers, no slip term

  // ── size the chain pitch: smallest standard pitch whose F = P/V ≤ allowable ──
  let candidates = ANSI_ROLLER_CHAINS;
  if (spec.chainPitch_mm !== undefined) {
    const p = pos(spec.chainPitch_mm);
    const row = p === null ? undefined : ANSI_ROLLER_CHAINS.find((c) => Math.abs(c.pitch_mm - p) < 1e-6);
    if (!row) {
      return { ok: false, error: `chainPitch_mm ${spec.chainPitch_mm} is not a standard ANSI pitch — use one of ${ANSI_ROLLER_CHAINS.map((c) => c.pitch_mm).join(', ')} mm` };
    }
    candidates = [row];
  }
  let chosen: { number: string; pitch_mm: number; breakingLoad_kN: number } | null = null;
  let chosenAllow = 0;
  let lastF = 0;
  let lastAllow = 0;
  for (const row of candidates) {
    const V = (N1 * row.pitch_mm * n1) / 60000; // m/s — polygon perimeter per rev
    const F = powerW / V;                       // the one tension the chain carries
    const allow = (row.breakingLoad_kN * 1000) / chainSF;
    lastF = F; lastAllow = allow;
    if (F <= allow) { chosen = row; chosenAllow = allow; break; }
  }
  if (!chosen) {
    return spec.chainPitch_mm !== undefined
      ? { ok: false, error: `the forced pitch ${spec.chainPitch_mm} mm cannot carry this duty — tension F = P/V = ${r3(lastF)} N exceeds the ${r3(lastAllow)} N allowable (breaking/${chainSF}); drop the override to size the pitch` }
      : { ok: false, error: `no standard ANSI chain pitch carries this duty — even at ${ANSI_ROLLER_CHAINS[ANSI_ROLLER_CHAINS.length - 1].pitch_mm} mm the tension F = ${r3(lastF)} N exceeds the ${r3(lastAllow)} N allowable; use multiple strands or split the reduction` };
  }
  const pitch = chosen.pitch_mm;

  // ── the proven chain-drive geometry: PDs, exact ratio, even-pitch length, F ──
  const cd = chainDrive({
    pitch, driverTeeth: N1, drivenTeeth: N2,
    centreDistance_pitches: Cp, driverSpeed_rpm: n1, power_kW: powerW / 1000,
  });
  if (!cd.ok) return { ok: false, error: `chain geometry: ${cd.error}` };
  const cv = cd.value;
  const F = cv.tangentialForce_N!;   // N — the ONE pull the whole drive turns on
  const V = cv.chainSpeed_m_s!;      // m/s
  const nOut = (n1 * N1) / N2;       // rpm — EXACT (integer teeth, no slip)

  // ── head shaft: the SAME F bends it AND (via the sprocket radius) twists it ──
  const T_Nmm = F * (cv.pitchDiameterDriven / 2); // sprocket torque on the head shaft
  const M_Nmm = (F * span) / 4;                   // chain pull mid-span, simply supported
  const shaft = shaftDiameter({ bendingMoment: M_Nmm, torque: T_Nmm, safetyFactor: SF, material: matName });
  if (!shaft.ok) return { ok: false, error: `shaft sizing: ${shaft.error}` };
  const dReq = shaft.value.recommendedDiameter;
  let stock: number | null = null;
  for (const s of STANDARD_SHAFT_MM) if (s >= dReq - 1e-9) { stock = s; break; }
  if (stock === null) {
    return { ok: false, error: `required shaft Ø${r3(dReq)} mm exceeds the Ø${STANDARD_SHAFT_MM[STANDARD_SHAFT_MM.length - 1]} stock list — split the reduction or shorten the bearing span` };
  }

  // RE-CHECK the realised safety at the stock diameter (round up, then verify).
  const d3 = stock ** 3;
  const sigma = (32 * M_Nmm) / (Math.PI * d3);
  const tau = (16 * T_Nmm) / (Math.PI * d3);
  const tauMax = Math.sqrt((sigma / 2) ** 2 + tau ** 2);
  const sfReal = mat.yield / (2 * tauMax);

  // ── key: the sprocket hub carries that SAME torque through a standard key ──
  const key0 = keySizing({ shaftDiameter: stock, torqueNmm: T_Nmm, material: matName });
  if (!key0.ok) return { ok: false, error: `key sizing: ${key0.error}` };
  const keyLength = Math.max(Math.ceil(key0.value.requiredLength_mm), key0.value.width_mm);
  const key = keySizing({ shaftDiameter: stock, torqueNmm: T_Nmm, material: matName, length: keyLength });
  if (!key.ok) return { ok: false, error: `key check: ${key.error}` };

  // ── bearings: each reacts R = F/2; invert the cube law for the required C ──
  const R = F / 2;
  const L10target_Mrev = (targetLife * 60 * nOut) / 1e6;
  const requiredC = Math.ceil((R * Math.cbrt(L10target_Mrev)) / 10) * 10; // round UP to 10 N
  const brg = bearingLife({ dynamicLoadRating: requiredC, equivalentLoad: R, bearingType: 'ball', speed_rpm: nOut });
  if (!brg.ok) return { ok: false, error: `bearing life: ${brg.error}` };
  const lifeHours = brg.value.life_hours!;

  // ── mass: the head shaft itself (span + 50 mm each side for hub/coupling) ──
  const shaftLength = span + 100;
  const mass = Math.PI * (stock / 2) ** 2 * shaftLength * mat.density;

  const exactRatioTxt = Number.isInteger(realisedRatio) ? `${realisedRatio}` : `${N2}/${N1} ≈ ${r3(realisedRatio)}`;
  const notes = [
    `Chain sized: ANSI #${chosen.number} (p = ${pitch} mm) is the smallest standard pitch whose tension F = P/V = ${r3(F)} N stays under the ${r3(chosenAllow)} N allowable (${chosen.breakingLoad_kN} kN breaking / SF ${chainSF}).`,
    `Positive engagement: ${N1}/${N2} teeth give the EXACT ratio ${exactRatioTxt} (a ratio of integers — no belt slip), so the head shaft turns exactly ${r3(nOut)} rpm.`,
    `ONE tension does everything: F bends the shaft (M = F·span/4 = ${r3(M_Nmm)} N·mm), twists it through the sprocket radius (T = F·PD₂/2 = ${r3(T_Nmm)} N·mm), and loads each bearing R = F/2 = ${r3(R)} N (2R = F closes the statics).`,
    `Head shaft: MSST √(M²+T²) needs Ø${r3(dReq)} mm → Ø${stock} stock; re-checked realised SF ${r3(sfReal)} ≥ ${SF} target.`,
    `Key: standard ${key.value.width_mm}×${key.value.height_mm} section at Ø${stock} (${key.value.governingMode} governs, required ${r3(key0.value.requiredLength_mm)} mm) → ${keyLength} mm key, SF ${r3(key.value.safetyFactor)}.`,
    `Bearings: C ≥ ${requiredC} N gives L10 = ${Math.round(lifeHours)} h ≥ ${targetLife} h at ${r3(nOut)} rpm (cube law L10 = (C/P)³).`,
    `Chain: ${cv.chainLength_pitches} pitches (even — no offset link) riding at C = ${r3(cv.adjustedCentreDistance)} mm; chordal ripple ${cv.chordalSpeedVariationDriver_pct}% at the ${N1}T driver.`,
    `No sprocket solid generator exists in the suite yet, so model.positives is empty and bpy is '' by design — model the shaft itself through the existing shaft lane (engineering.model_3d) if a solid is needed.`,
  ];

  return {
    ok: true,
    value: {
      type: 'conveyor_drive',
      summary: `#${chosen.number} chain (p ${pitch}) ${N1}/${N2}T = exact ${exactRatioTxt}:1, F ${Math.round(F)} N → Ø${stock} ${matName} head shaft (SF ${r3(sfReal)}), ${key.value.width_mm}×${key.value.height_mm}×${keyLength} key, bearing C ≥ ${requiredC} N for ${targetLife} h`,
      dimensions: {
        chainPitch_mm: pitch,
        driverTeeth: N1,
        drivenTeeth: N2,
        ratio: realisedRatio,               // EXACT N2/N1 (unrounded on purpose)
        requestedRatio: ratioReq,
        pitchDiameterDriver_mm: cv.pitchDiameterDriver,
        pitchDiameterDriven_mm: cv.pitchDiameterDriven,
        chainSpeed_m_s: V,
        chainTension_N: F,
        chainAllowableTension_N: r3(chosenAllow),
        chainLength_pitches: cv.chainLength_pitches,
        centreDistance_mm: cv.adjustedCentreDistance,
        outputSpeed_rpm: nOut,
        outputTorque_Nm: T_Nmm / 1000,      // = F·PD₂/2 (seam value, unrounded)
        bendingMoment_Nmm: M_Nmm,           // = F·span/4 (seam value, unrounded)
        bearingSpan_mm: span,
        requiredShaftDiameter_mm: dReq,
        shaftDiameter_mm: stock,
        shaftLength_mm: shaftLength,
        keyWidth_mm: key.value.width_mm,
        keyHeight_mm: key.value.height_mm,
        keyLength_mm: keyLength,
        bearingReaction_N: R,               // = F/2 (seam value, unrounded)
        requiredBearingC_N: requiredC,
        bearingL10_hours: lifeHours,
      },
      safety: {
        allowableStress_MPa: r3(mat.yield / (2 * SF)),
        realisedStress_MPa: r3(tauMax),
        realisedSafetyFactor: r3(sfReal),
        note: `MSST τ_max = 16·√(M²+T²)/πd³ at the Ø${stock} stock shaft vs shear yield Sy/2; chain F ${r3(F)} N ≤ ${r3(chosenAllow)} N allowable`,
      },
      material: matName,
      mass_kg: r3(mass),
      model: { positives: [] },
      bpy: '',
      notes,
    },
  };
}
