/**
 * engineeringDesignGearboxCore — ONE-CALL single-reduction GEARBOX design. It
 * packages the PROVEN gearbox-design integration chain
 * (scripts/engineering-gearbox-design-integration-smoketest.ts) into a single
 * `designGearbox(spec)` call: state the duty ("5 kW in at 1500 rpm, 3:1
 * reduction, steel, safety 2") and get back a finished reducer — the sized
 * module/teeth/face width, the output-shaft diameter (combined bending +
 * torsion, static AND fatigue), the key, the required bearing rating for a
 * target L10 life, the realised safety factors, an approximate mass, and a
 * ready-to-compile Blender gear-pair model bored for the sized shaft.
 *
 * The chain is EXACTLY the drill's, seam for seam:
 *
 *   duty ─P/ω→ T1 ─×ratio→ T2 ──┬─ Ft = T2/r2 = T1/r1        (one tooth force)
 *                               │        ├─ Wn = Ft/cosφ ─┬→ M = Wn·L/4 → shaftDiameter + shaftFatigue
 *                               │        │                └→ R = Wn/2    → required bearing C (L10)
 *                               │        └─ Lewis σ = Ft/(F·m·Y)         → sizes the MODULE (pinion is weaker)
 *                               └─ T2 ────────────────────→ keySizing on the stock shaft Ø
 *
 * House style (engineeringDesignCore): every required dimension is rounded UP
 * to a standard/stock size and the realised stress/safety factor is RE-CHECKED
 * at that size, so the returned gearbox meets the duty, not just the raw
 * requirement. Pure + tsx-loadable, no I/O.
 *
 * Import ONLY types from engineeringDesignCore — the design_part dispatcher
 * imports this module, so a runtime import back would be a cycle.
 */

import type { DesignedPart, DesignResult } from './engineeringDesignCore';
import { gearTrain, gearPairTransmission, MATERIALS } from './engineeringCalcCore';
import { lewisBendingStress } from './engineeringGearStrengthCore';
import { shaftDiameter, shaftFatigue } from './engineeringShaftDesignCore';
import { keySizing, standardKeySize } from './engineeringKeyCore';
import { bearingLife } from './engineeringBearingCore';
import { gearPairGeometry, buildGearPairBlenderScript, type GearPairGeometry } from './engineeringGearTrainCore';
import type { SolidModel } from './engineeringSolidModelingCore';

// ─── Standard size series (round UP into these; never down) ──────────────────

/** ISO 54 first-choice module series covered by the designer (mm). */
export const STANDARD_MODULES_MM: ReadonlyArray<number> = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** R20-ish stock shaft diameters (mm) — matches the drill's Ø25 pick. */
export const STOCK_SHAFT_DIAMETERS_MM: ReadonlyArray<number> = [10, 12, 15, 17, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80];

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r3(n: number): number { return Math.round(n * 1e3) / 1e3; }

/** Smallest stock shaft Ø ≥ the requirement, or null when even Ø80 is too small. */
function stockShaft(dRequired: number): number | null {
  for (const s of STOCK_SHAFT_DIAMETERS_MM) if (s >= dRequired - 1e-9) return s;
  return null;
}

export type GearboxSpec = {
  /** Transmitted power — give either kW or W. */
  power_kW?: number;
  power_W?: number;
  /** Input (pinion) shaft speed, rpm. */
  inputSpeed_rpm: number;
  /** Reduction ratio N2/N1, ≥ 1 (1 = a 1:1 coupler stage). */
  ratio: number;
  /** Material for gears, shaft, and key (MATERIALS table). Default 'steel'. */
  material?: string;
  /** Target design safety factor on yield for gears and shaft. Default 2. */
  safetyFactor?: number;
  /** Pressure angle, degrees. Default 20 (the Lewis Y table assumes 20° full depth). */
  pressureAngle_deg?: number;
  /** Bearing span with the gear centred, mm. Default: sized from the shaft, 8·Ø rounded up to 10 mm. */
  bearingSpan_mm?: number;
  /** Target bearing L10 life, hours. Default 20000. */
  targetLifeHours?: number;
  /** Override the module (mm); otherwise sized up the standard series by pinion Lewis stress. */
  module_mm?: number;
  /** Override the pinion tooth count; default 18 (≥ 18 avoids undercut at 20°). */
  pinionTeeth?: number;
  /** Corrected endurance limit Se, MPa. Default 0.5·Su (capped at 700). */
  endurance_MPa?: number;
  /** Ultimate strength Su, MPa. Default 1.76·σ_yield (the mild-steel 440/250 ratio). */
  ultimate_MPa?: number;
  outputPath?: string;
};

/**
 * Design a complete single-reduction spur gearbox from its duty. Sizes the gear
 * pair (module by pinion Lewis bending), the output shaft (combined bending +
 * torsion, static MSST/DE and DE-Goodman fatigue, rounded up to stock), the
 * parallel key (on the stock Ø, for T2), and the required bearing dynamic
 * rating C for the target L10 life — all from ONE tooth force, exactly like the
 * proven integration drill.
 */
export function designGearbox(spec: GearboxSpec): DesignResult<DesignedPart> {
  // ── duty ──
  const P_W = spec.power_W !== undefined ? pos(spec.power_W) : (spec.power_kW !== undefined ? (pos(spec.power_kW) !== null ? (pos(spec.power_kW) as number) * 1000 : null) : null);
  if (P_W === null) return { ok: false, error: 'gearbox needs a positive power (power_kW or power_W)' };
  const n1 = pos(spec.inputSpeed_rpm);
  if (n1 === null) return { ok: false, error: 'gearbox needs a positive inputSpeed_rpm' };
  const ratioReq = Number(spec.ratio);
  if (!Number.isFinite(ratioReq) || ratioReq <= 0) return { ok: false, error: 'gearbox needs a positive ratio (N2/N1)' };
  if (ratioReq < 1) return { ok: false, error: `ratio ${ratioReq} is an overdrive — this designer sizes reductions; use ratio ≥ 1 (swap input/output for a speed-up)` };
  const matName = String(spec.material ?? 'steel').trim().toLowerCase();
  const mat = MATERIALS[matName];
  if (!mat) return { ok: false, error: `unknown material "${spec.material}" — known: ${Object.keys(MATERIALS).join(', ')}` };
  const SF = pos(spec.safetyFactor) ?? 2;
  const phiDeg = pos(spec.pressureAngle_deg) ?? 20;
  const phi = (phiDeg * Math.PI) / 180;
  const targetLifeHours = pos(spec.targetLifeHours) ?? 20000;
  const spanGiven = spec.bearingSpan_mm !== undefined ? pos(spec.bearingSpan_mm) : null;
  if (spec.bearingSpan_mm !== undefined && spanGiven === null) return { ok: false, error: 'bearingSpan_mm must be positive (mm)' };

  const Sy = mat.yield;
  const sigmaAllow = Sy / SF;

  // ── teeth ──
  const N1 = spec.pinionTeeth !== undefined ? Math.trunc(Number(spec.pinionTeeth)) : 18;
  if (!Number.isFinite(N1) || N1 < 4) return { ok: false, error: 'pinionTeeth must be an integer ≥ 4 (default 18 avoids undercut)' };
  const N2 = Math.round(N1 * ratioReq);
  if (N2 < 4) return { ok: false, error: 'gear teeth came out < 4 — raise the ratio or pinionTeeth' };

  // ── T1, T2, n2 through the gear-train lane (the drill's seam 1) ──
  const omega1 = (2 * Math.PI * n1) / 60;
  const T1_Nm = P_W / omega1;
  const train = gearTrain({ stages: [{ driver: N1, driven: N2 }], inputSpeed_rpm: n1, inputTorque_Nm: T1_Nm });
  if (!train.ok) return { ok: false, error: `gearTrain: ${train.error}` };
  const ratio = train.value; // realised N2/N1 (may differ from the request by tooth rounding)
  const T2_Nm = train.extra!.output_torque_Nm as number;
  const n2 = train.extra!.output_speed_rpm as number;
  const T2_Nmm = T2_Nm * 1000;

  // ── module: user override, or iterate the standard series up until the
  //    PINION (fewer teeth → smaller Lewis Y → the weaker gear) passes ──
  const moduleGiven = spec.module_mm !== undefined ? pos(spec.module_mm) : null;
  if (spec.module_mm !== undefined && moduleGiven === null) return { ok: false, error: 'module_mm must be positive (mm)' };
  const candidates = moduleGiven !== null ? [moduleGiven] : [...STANDARD_MODULES_MM];

  let chosen: {
    m: number; fw: number; geo: GearPairGeometry;
    Ft: number; Wr: number; Wn: number;
    span: number; M: number; dStatic: number; dFatigue: number; dStock: number;
    sigmaPinion: number; sigmaGear: number;
    fatigueRealised: number;
  } | null = null;
  let priorModuleStress: { m: number; sigma: number } | null = null;
  let lastFailure = '';

  const Su = pos(spec.ultimate_MPa) ?? 1.76 * Sy;
  const Se = pos(spec.endurance_MPa) ?? Math.min(0.5 * Su, 700);

  for (const m of candidates) {
    const fw = 10 * m; // face width = 10·module, the drill's proportion
    // pinion tooth check first — the module sizer.
    const lp = lewisBendingStress({ module: m, teeth: N1, faceWidth: fw, torque_Nm: T1_Nm });
    if (!lp.ok) return { ok: false, error: `lewisBendingStress (pinion): ${lp.error}` };
    if (lp.value > sigmaAllow) {
      priorModuleStress = { m, sigma: lp.value };
      lastFailure = `pinion Lewis σ = ${r3(lp.value)} MPa > allowable ${r3(sigmaAllow)} MPa at m=${m}`;
      if (moduleGiven !== null) return { ok: false, error: `module ${m} mm is too small: ${lastFailure} — use the next standard module up` };
      continue;
    }
    const lg = lewisBendingStress({ module: m, teeth: N2, faceWidth: fw, torque_Nm: T2_Nm });
    if (!lg.ok) return { ok: false, error: `lewisBendingStress (gear): ${lg.error}` };

    // real geometry at this module (the drill's seam 2).
    const geoR = gearPairGeometry({ module: m, pinionTeeth: N1, gearTeeth: N2, pressureAngleDeg: phiDeg, faceWidth: fw });
    if (!geoR.ok) return { ok: false, error: `gearPairGeometry: ${geoR.error}` };
    const geo = geoR.value;

    // ONE tooth force feeds shaft, bearing, and key (seams 3–5).
    const Ft = T2_Nmm / geo.pitchRadius2; // = T1_Nmm / r1
    const Wr = Ft * Math.tan(phi);
    const Wn = Ft / Math.cos(phi);

    // shaft: span↔Ø fixpoint (span defaults to 8·Ø rounded up to 10 mm).
    let span = spanGiven ?? 80; // 80 = 8 × the smallest stock Ø
    let M = 0, dStatic = 0, dFatigue = 0, dStock = 0, fatigueRealised = 0;
    let sized = false;
    for (let iter = 0; iter < STOCK_SHAFT_DIAMETERS_MM.length + 2; iter += 1) {
      M = (Wn * span) / 4; // gear centred: max moment Wn·L/4
      const st = shaftDiameter({ bendingMoment: M, torque: T2_Nmm, safetyFactor: SF, yield: Sy });
      if (!st.ok) return { ok: false, error: `shaftDiameter: ${st.error}` };
      const ft = shaftFatigue({ alternatingMoment: M, meanTorque: T2_Nmm, endurance: Se, ultimate: Su, safetyFactor: SF });
      if (!ft.ok) return { ok: false, error: `shaftFatigue: ${ft.error}` };
      dStatic = st.value.recommendedDiameter;
      dFatigue = ft.value.requiredDiameter;
      const dReq = Math.max(dStatic, dFatigue);
      const s = stockShaft(dReq);
      if (s === null) return { ok: false, error: `required shaft Ø ${r3(dReq)} mm exceeds the largest stock size Ø${STOCK_SHAFT_DIAMETERS_MM[STOCK_SHAFT_DIAMETERS_MM.length - 1]} — split the reduction or raise the material` };
      dStock = s;
      if (spanGiven !== null) { sized = true; break; }
      const newSpan = Math.ceil((8 * dStock) / 10) * 10;
      if (newSpan === span) { sized = true; break; }
      span = newSpan; // monotone non-decreasing → terminates on the finite stock list
    }
    if (!sized) return { ok: false, error: 'shaft span/diameter iteration did not converge' };
    // fatigue realised at the stock Ø (check mode).
    const ftCheck = shaftFatigue({ alternatingMoment: M, meanTorque: T2_Nmm, endurance: Se, ultimate: Su, safetyFactor: SF, diameter: dStock });
    if (!ftCheck.ok) return { ok: false, error: `shaftFatigue (check): ${ftCheck.error}` };
    fatigueRealised = ftCheck.value.realizedSafetyFactor;

    // bore fit: the pinion must keep a rim between the stock-shaft bore and its root.
    if (geo.pinion.rootDiameter < dStock + 2) {
      lastFailure = `Ø${dStock} shaft bore does not fit the m=${m} pinion (root Ø ${r3(geo.pinion.rootDiameter)} mm)`;
      if (moduleGiven !== null) return { ok: false, error: `module ${m} mm pinion is too small for its own shaft: ${lastFailure} — use a larger module or more pinion teeth` };
      continue; // a larger module grows the pinion faster than the shaft
    }

    chosen = { m, fw, geo, Ft, Wr, Wn, span, M, dStatic, dFatigue, dStock, sigmaPinion: lp.value, sigmaGear: lg.value, fatigueRealised };
    break;
  }
  if (!chosen) return { ok: false, error: `no standard module up to ${STANDARD_MODULES_MM[STANDARD_MODULES_MM.length - 1]} mm works: ${lastFailure || 'sizing failed'}` };

  const { m, fw, geo, Ft, Wr, Wn, span, M, dStatic, dFatigue, dStock, sigmaPinion, sigmaGear, fatigueRealised } = chosen;

  // ── ratio cross-check (both gear cores must agree — the drill's seam 1b) ──
  const pair = gearPairTransmission({ pinionTeeth: N1, gearTeeth: N2, module: m, inputTorque_Nm: T1_Nm, inputSpeed_rpm: n1 });
  if (!pair.ok) return { ok: false, error: `gearPairTransmission: ${pair.error}` };
  if (pair.value !== ratio) return { ok: false, error: 'internal: gearTrain and gearPairTransmission disagree on the ratio' };

  // ── key on the stock shaft Ø, for T2 (seam 5) ──
  const std = standardKeySize(dStock);
  if (!std.ok) return { ok: false, error: `standardKeySize: ${std.error}` };
  const key = keySizing({ shaftDiameter: dStock, torqueNmm: T2_Nmm, material: matName });
  if (!key.ok) return { ok: false, error: `keySizing: ${key.error}` };
  const keyLength = Math.ceil(key.value.requiredLength_mm); // round UP to the next mm → capacity ≥ T2
  if (keyLength > fw) {
    // the hub is only as long as the gear face; a longer key means the module/face is too small.
    return { ok: false, error: `key length ${keyLength} mm exceeds the ${fw} mm gear face — raise the module or use a larger shaft` };
  }

  // ── bearings: reaction R = Wn/2 at the output speed; required C for the life target (seam 4) ──
  const R = Wn / 2;
  const L10_target_Mrev = (targetLifeHours * 60 * n2) / 1e6;
  const C_req = Math.ceil(R * Math.pow(L10_target_Mrev, 1 / 3)); // ceil → life ≥ target
  const brg = bearingLife({ dynamicLoadRating: C_req, equivalentLoad: R, bearingType: 'ball', speed_rpm: n2 });
  if (!brg.ok) return { ok: false, error: `bearingLife: ${brg.error}` };
  const lifeAtC = brg.value.life_hours ?? 0;

  // ── realised safety factors at the ROUNDED sizes (the house-style re-check) ──
  const staticRealised = SF * Math.pow(dStock / dStatic, 3); // n ∝ d³ exactly
  const pinionSF = Sy / sigmaPinion;
  const gearSF = Sy / sigmaGear;
  const lanes: Array<[string, number]> = [
    ['shaft static (MSST)', staticRealised],
    ['shaft fatigue (DE-Goodman)', fatigueRealised],
    ['pinion tooth (Lewis)', pinionSF],
    ['gear tooth (Lewis)', gearSF],
  ];
  let governing = lanes[0];
  for (const l of lanes) if (l[1] < governing[1]) governing = l;

  // ── approximate mass: gears as bored pitch-radius discs + the output shaft ──
  const shaftLength = span + 40; // 20 mm stub past each bearing
  const boreArea = Math.PI * (dStock / 2) ** 2;
  const volPinion = (Math.PI * geo.pitchRadius1 ** 2 - boreArea) * fw;
  const volGear = (Math.PI * geo.pitchRadius2 ** 2 - boreArea) * fw;
  const volShaft = boreArea * shaftLength;
  const mass = (volPinion + volGear + volShaft) * mat.density;

  // ── model: pitch-radius disc pair (matches the mass estimate) + the real involute bpy ──
  const model: SolidModel = {
    positives: [
      { kind: 'cylinder', r: geo.pitchRadius1, h: fw, cx: 0, cy: 0, cz: fw / 2, axis: 'z' },
      { kind: 'cylinder', r: geo.pitchRadius2, h: fw, cx: geo.centerDistance, cy: 0, cz: fw / 2, axis: 'z' },
    ],
    negatives: [
      { kind: 'cylinder', r: dStock / 2, h: fw + 2, cx: 0, cy: 0, cz: fw / 2, axis: 'z' },
      { kind: 'cylinder', r: dStock / 2, h: fw + 2, cx: geo.centerDistance, cy: 0, cz: fw / 2, axis: 'z' },
    ],
  };
  const out = typeof spec.outputPath === 'string' && spec.outputPath.trim() ? spec.outputPath : '<output>.stl';
  const bpy = buildGearPairBlenderScript({ module: m, pinionTeeth: N1, gearTeeth: N2, pressureAngleDeg: phiDeg, faceWidth: fw, pinionBore: dStock, gearBore: dStock }, out);
  if (!bpy.ok) return { ok: false, error: `buildGearPairBlenderScript: ${bpy.error}` };

  const notes: string[] = [
    `Duty: ${r3(P_W / 1000)} kW at ${r3(n1)} rpm → T1 = P/ω = ${r3(T1_Nm)} N·m; ratio ${r3(ratio)}:1 (Z${N1}:Z${N2}) → T2 = ${r3(T2_Nm)} N·m at ${r3(n2)} rpm (gearTrain and gearPairTransmission agree).`,
    moduleGiven !== null
      ? `Module m=${m} mm given; pinion Lewis σ = ${r3(sigmaPinion)} MPa ≤ ${r3(sigmaAllow)} MPa allowable at faceWidth 10·m = ${fw} mm.`
      : `Module sized up the standard series to m=${m} mm: the PINION (fewer teeth → smaller Lewis Y) has σ = ${r3(sigmaPinion)} MPa ≤ ${r3(sigmaAllow)} allowable at faceWidth 10·m = ${fw} mm${priorModuleStress ? `; m=${priorModuleStress.m} gave ${r3(priorModuleStress.sigma)} MPa (over)` : ''}.`,
    `Mesh: pitch Ø ${r3(geo.pitchRadius1 * 2)}/${r3(geo.pitchRadius2 * 2)} mm, centre distance ${r3(geo.centerDistance)} mm; ONE tooth force Ft = T2/r2 = ${r3(Ft)} N, Wr = Ft·tanφ = ${r3(Wr)} N, resultant Wn = Ft/cosφ = ${r3(Wn)} N (φ=${phiDeg}°).`,
    `Output shaft: gear centred on a ${span} mm bearing span${spanGiven === null ? ' (8·Ø rounded up to 10 mm)' : ''} → M = Wn·L/4 = ${r3(M)} N·mm with T2 = ${r3(T2_Nmm)} N·mm; static MSST needs Ø${r3(dStatic)}, DE-Goodman fatigue needs Ø${r3(dFatigue)} → rounded UP to stock Ø${dStock}.`,
    `Fatigue assumption: Su = ${spec.ultimate_MPa !== undefined ? `${r3(Su)} MPa (given)` : `1.76·σy = ${r3(Su)} MPa (mild-steel 440/250 ratio)`}, Se = ${spec.endurance_MPa !== undefined ? `${r3(Se)} MPa (given)` : `0.5·Su capped at 700 = ${r3(Se)} MPa`}; Kf = Kfs = 1.`,
    `Key: standard ${key.value.width_mm}×${key.value.height_mm} mm section for Ø${dStock}; sized for T2 (F = 2T/d = ${r3(key.value.force_N)} N, ${key.value.governingMode} governs) → L = ${keyLength} mm (required ${r3(key.value.requiredLength_mm)}, rounded up) — capacity round-trips to ≥ T2.`,
    `Bearings: each reaction R = Wn/2 = ${r3(R)} N at ${r3(n2)} rpm; required C = R·(60·n·Lh/1e6)^(1/3) = ${C_req} N gives L10 = ${Math.round(lifeAtC)} h ≥ ${targetLifeHours} h target.`,
    `Safety at the rounded sizes — ${lanes.map(([k, v]) => `${k} ${r3(v)}`).join(', ')}; ${governing[0]} governs at ${r3(governing[1])} ≥ target ${SF}.`,
    `Mass ≈ ${r3(mass)} kg — gears as bored pitch-radius discs + output shaft over span+40 mm; APPROXIMATE blank mass (input shaft, housing, bearings excluded).`,
  ];
  if (phiDeg !== 20) notes.push(`NOTE: the Lewis Y table assumes 20° full-depth teeth; φ=${phiDeg}° affects Wr/Wn exactly but the tooth stresses only approximately.`);

  return {
    ok: true,
    value: {
      type: 'gearbox',
      summary: `m${m} Z${N1}:Z${N2} ${r3(ratio)}:1 ${matName} gearbox for ${r3(P_W / 1000)} kW @ ${r3(n1)} rpm — Ø${dStock} output shaft, ${key.value.width_mm}×${key.value.height_mm}×${keyLength} key, C ≥ ${C_req} N, safety ${r3(governing[1])} (${governing[0]}), ${r3(mass)} kg`,
      dimensions: {
        module_mm: m,
        pinionTeeth: N1,
        gearTeeth: N2,
        ratio: r3(ratio),
        faceWidth_mm: fw,
        centerDistance_mm: r3(geo.centerDistance),
        pitchDiameterPinion_mm: r3(geo.pitchRadius1 * 2),
        pitchDiameterGear_mm: r3(geo.pitchRadius2 * 2),
        inputTorque_Nm: r3(T1_Nm),
        outputTorque_Nm: r3(T2_Nm),
        outputSpeed_rpm: r3(n2),
        toothForce_N: r3(Ft),
        radialForce_N: r3(Wr),
        normalForce_N: r3(Wn),
        bearingSpan_mm: span,
        bendingMoment_Nmm: r3(M),
        requiredShaftDiameterStatic_mm: r3(dStatic),
        requiredShaftDiameterFatigue_mm: r3(dFatigue),
        shaftDiameter_mm: dStock,
        keyWidth_mm: key.value.width_mm,
        keyHeight_mm: key.value.height_mm,
        keyLength_mm: keyLength,
        bearingReaction_N: r3(R),
        requiredBearingC_N: C_req,
        targetLifeHours,
      },
      safety: {
        allowableStress_MPa: r3(sigmaAllow),
        realisedSafetyFactor: r3(governing[1]),
        note: `${governing[0]} governs at ${r3(governing[1])} (target ${SF}); lanes: ${lanes.map(([k, v]) => `${k} ${r3(v)}`).join(', ')}`,
      },
      material: matName,
      mass_kg: r3(mass),
      model,
      bpy: bpy.value,
      notes,
    },
  };
}
