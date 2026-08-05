/**
 * engineeringDesignBrakeCore — ONE-CALL BRAKE DESIGN: packages the PROVEN
 * mechanical → thermal composition chain (the brake-cooling integration smoke)
 * into a single designer. A brake is an energy converter: the friction pair
 * reacts a torque, and torque × slip speed becomes HEAT that must leave through
 * the disc's surface (plus fins) at an acceptable temperature rise, or the
 * linings fade. State the duty — "hold 150 N·m at 1000 rpm, 15% of the time" —
 * and get back a sized disc, the clamp force, the fin array, and the realised
 * steady temperature rise.
 *
 * The chain, exactly as proven in
 * scripts/engineering-brake-cooling-integration-smoketest.ts:
 *
 *   1. DISC (clutch/brake core). Iterate stock outer radii; at each candidate
 *      the UNIFORM-WEAR model T = ½·μ·Fn·(ro+ri) — always the lower of the two
 *      pressure-distribution bounds, so the honest design model — is solved for
 *      the required clamp force Fn. Accept the smallest disc whose Fn is under
 *      the actuation cap AND whose mean pad pressure Fn/(π(ro²−ri²)) is under
 *      the lining allowable (~1 MPa, organic/woven lining, Shigley Table 16-3
 *      quotes 0.69–1.38 MPa). RE-CHECK by feeding the chosen ro/ri/Fn back
 *      through `discClutch`: wear torque ≥ required, and the uniform-pressure
 *      (new) torque ≥ wear torque — the suite's duality, held on the returned
 *      design. One friction surface is assumed (a twin-pad caliper, n = 2,
 *      would halve Fn — documented in the notes, not silently applied).
 *   2. HEAT (the domain-crossing seam). P_peak = T·ω with ω in rad/s; the
 *      continuous-equivalent load is P_cont = dutyCycle · P_peak. The number
 *      that leaves the friction lane IS the number that enters the thermal
 *      lane — asserted unchanged in the smoke.
 *   3. COOLING (thermal + fin cores). The bare disc — two annular faces plus
 *      the outer rim edge, 2π(ro²−ri²) + 2π·ro·t (bore/hub area ignored) —
 *      convects Q = h·A·ΔT_max via `convection`. If that falls short, add
 *      rectangular fins (radial, length beyond the rim, width = disc
 *      thickness) analysed per-fin by `finAnalysis` at ΔT_max with a
 *      convective tip; total capacity = h·(A − n·Ac)·ΔT_max + n·Q_fin. Accept
 *      the first stock fin count that covers P_cont; the realised steady rise
 *      ΔT = P_cont / (capacity/ΔT_max) is then ≤ ΔT_max by construction. If
 *      even the largest fin count cannot cope, fail with the stated shortfall
 *      and advise forced cooling — free air genuinely cannot shed kilowatts
 *      from a small disc at a modest ΔT, and the designer says so instead of
 *      pretending.
 *
 * Material defaults to 'aluminum' for the finned disc/housing — the MATERIALS
 * table carries Aluminum 6061-T6 with k = 167 W/m·K, so the same table entry
 * that gives the fins their conductivity gives the disc its mass. (If a build
 * ever dropped aluminum from the table, the default falls back to steel.)
 *
 * The returned model/bpy is the bare annular disc (cylinder minus bore
 * cylinder) through the proven `writeBlenderSolidScript` CSG lane; fins are
 * sized thermally but not modelled, and the mass is the disc's alone (noted).
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-design-brake-smoketest.ts):
 * composes the clutch/brake, fin, thermal, calc (MATERIALS), and solid-modeling
 * cores; `DesignedPart`/`DesignResult` are imported as TYPES ONLY (a runtime
 * import of engineeringDesignCore would create a cycle via the dispatcher).
 */

import type { DesignedPart, DesignResult } from './engineeringDesignCore';
import { MATERIALS } from './engineeringCalcCore';
import { discClutch } from './engineeringClutchBrakeCore';
import { finAnalysis, type FinAnalysisResult } from './engineeringFinCore';
import { convection } from './engineeringThermalCore';
import { writeBlenderSolidScript, type SolidModel } from './engineeringSolidModelingCore';

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function rr(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** Stock disc outer radii (mm) — sized smallest-first. */
export const BRAKE_STOCK_OUTER_RADII_MM: readonly number[] = [40, 50, 60, 80, 100, 125, 150, 175, 200];
/** Stock fin counts tried smallest-first. */
export const BRAKE_FIN_COUNTS: readonly number[] = [6, 8, 10, 12, 16, 20, 24];
/** Allowable mean pad pressure for an organic/woven lining (Shigley Table 16-3: 0.69–1.38 MPa). */
export const BRAKE_LINING_MAX_PRESSURE_MPA = 1.0;
/** Default actuation (clamp force) cap when the caller does not state one. */
export const BRAKE_DEFAULT_ACTUATION_CAP_N = 10_000;

export type BrakeDesignSpec = {
  /** Required braking torque (N·m). */
  torque_Nm: number;
  /** Shaft speed at engagement (rpm) — sets the slip speed and so the heat power. */
  speed_rpm: number;
  /** Fraction of time braking (0–1]; continuous-equivalent heat = duty · P_peak. Default 0.1. */
  dutyCycle?: number;
  /** MATERIALS name for the finned disc (default 'aluminum'; falls back to 'steel' if absent). */
  material?: string;
  /** Lining friction coefficient μ (default 0.3). */
  frictionCoeff?: number;
  /** Available actuation/clamp force cap (N). Default 10 kN; the disc is sized so its required Fn fits under this. */
  actuationForce_N?: number;
  /** Maximum steady temperature rise over ambient (°C). Default 60. */
  maxTempRise_C?: number;
  /** Convection film coefficient (W/m²·K). Default 25 (free air); override for forced air over the spinning disc. */
  h_W_m2K?: number;
  /** Inner/outer friction radius ratio ri/ro in (0,1). Default 0.6. */
  innerRadiusRatio?: number;
  /** Disc thickness (mm), default 10 — also the default fin width. */
  discThickness_mm?: number;
  /** Radial fin length beyond the rim (mm), default 25. */
  finLength_mm?: number;
  /** Fin thickness (mm), default 3. */
  finThickness_mm?: number;
  /** Fin width (mm), default = disc thickness. */
  finWidth_mm?: number;
  outputPath?: string;
};

/**
 * One-call brake design: size the friction disc (uniform-wear model under an
 * actuation-force cap and a lining pressure allowable), convert the duty into
 * heat (P = T·ω × dutyCycle), and size the convection/fin cooling to hold the
 * temperature rise. Returns a DesignedPart with type 'brake'.
 */
export function designBrake(spec: BrakeDesignSpec): DesignResult<DesignedPart> {
  const T_Nm = pos(spec?.torque_Nm);
  if (T_Nm === null) return { ok: false, error: 'brake needs a positive torque_Nm (required braking torque, N·m)' };
  const rpm = pos(spec?.speed_rpm);
  if (rpm === null) return { ok: false, error: 'brake needs a positive speed_rpm (shaft speed at engagement)' };
  const duty = spec?.dutyCycle === undefined ? 0.1 : Number(spec.dutyCycle);
  if (!Number.isFinite(duty) || duty <= 0 || duty > 1) return { ok: false, error: 'dutyCycle must be in (0, 1] — the fraction of time spent braking' };

  const matName = spec?.material !== undefined
    ? String(spec.material).trim().toLowerCase()
    : (MATERIALS.aluminum ? 'aluminum' : 'steel');
  const mat = MATERIALS[matName];
  if (!mat) return { ok: false, error: `unknown material "${matName}" — ${Object.keys(MATERIALS).join(', ')}` };

  const mu = spec?.frictionCoeff === undefined ? 0.3 : pos(spec.frictionCoeff);
  if (mu === null) return { ok: false, error: 'frictionCoeff μ must be positive' };
  const cap = spec?.actuationForce_N === undefined ? BRAKE_DEFAULT_ACTUATION_CAP_N : pos(spec.actuationForce_N);
  if (cap === null) return { ok: false, error: 'actuationForce_N must be positive (the available clamp force)' };
  const maxRise = spec?.maxTempRise_C === undefined ? 60 : pos(spec.maxTempRise_C);
  if (maxRise === null) return { ok: false, error: 'maxTempRise_C must be positive' };
  const h = spec?.h_W_m2K === undefined ? 25 : pos(spec.h_W_m2K);
  if (h === null) return { ok: false, error: 'h_W_m2K must be a positive convection film coefficient' };
  const ratio = spec?.innerRadiusRatio === undefined ? 0.6 : Number(spec.innerRadiusRatio);
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return { ok: false, error: 'innerRadiusRatio ri/ro must be in (0, 1)' };
  const discT = spec?.discThickness_mm === undefined ? 10 : pos(spec.discThickness_mm);
  if (discT === null) return { ok: false, error: 'discThickness_mm must be positive' };
  const finL = spec?.finLength_mm === undefined ? 25 : pos(spec.finLength_mm);
  if (finL === null) return { ok: false, error: 'finLength_mm must be positive' };
  const finT = spec?.finThickness_mm === undefined ? 3 : pos(spec.finThickness_mm);
  if (finT === null) return { ok: false, error: 'finThickness_mm must be positive' };
  const finW = spec?.finWidth_mm === undefined ? discT : pos(spec.finWidth_mm);
  if (finW === null) return { ok: false, error: 'finWidth_mm must be positive' };

  // ── 1. DISC: smallest stock disc whose uniform-wear clamp force fits ───────
  // T = ½·μ·Fn·(ro+ri)  →  Fn = 2T / (μ·(ro+ri)); ceil to a whole newton so the
  // re-checked wear torque is ≥ the requirement after rounding.
  const T_Nmm = T_Nm * 1000;
  let chosen: { ro: number; ri: number; Fn: number; padPressure: number } | null = null;
  let lastFn = 0; let lastP = 0;
  for (const ro of BRAKE_STOCK_OUTER_RADII_MM) {
    const ri = ratio * ro;
    const Fn = Math.ceil((2 * T_Nmm) / (mu * (ro + ri)));
    const padPressure = Fn / (Math.PI * (ro ** 2 - ri ** 2)); // N/mm² = MPa
    lastFn = Fn; lastP = padPressure;
    if (Fn <= cap && padPressure <= BRAKE_LINING_MAX_PRESSURE_MPA) { chosen = { ro, ri, Fn, padPressure }; break; }
  }
  if (!chosen) {
    return {
      ok: false,
      error: `no stock disc (up to Ø${2 * BRAKE_STOCK_OUTER_RADII_MM[BRAKE_STOCK_OUTER_RADII_MM.length - 1]} mm) can react ${T_Nm} N·m: `
        + `the largest needs ${lastFn} N clamp (cap ${cap} N) at ${rr(lastP, 3)} MPa mean lining pressure `
        + `(allowable ${BRAKE_LINING_MAX_PRESSURE_MPA} MPa) — raise the actuation cap, allow a larger disc, or add friction surfaces`,
    };
  }
  const { ro, ri, Fn, padPressure } = chosen;

  // RE-CHECK through the clutch/brake core: wear torque ≥ required, and the
  // uniform-pressure (new) torque ≥ wear torque (the duality, on THIS design).
  const dc = discClutch({ outerRadius: ro, innerRadius: ri, axialForce: Fn, frictionCoeff: mu });
  if (!dc.ok) return { ok: false, error: `disc re-check failed — ${dc.error}` };
  const wearTorque = dc.value.uniformWearTorque_Nm;
  const pressureTorque = dc.value.uniformPressureTorque_Nm;
  if (wearTorque < T_Nm) return { ok: false, error: `disc re-check failed — uniform-wear capacity ${wearTorque} N·m < required ${T_Nm} N·m` };

  // ── 2. HEAT: the mechanical → thermal seam ────────────────────────────────
  const omega = (2 * Math.PI * rpm) / 60; // rad/s
  const P_peak = T_Nm * omega;            // W — torque × slip speed
  const P_cont = duty * P_peak;           // W — continuous-equivalent heat load

  // ── 3. COOLING: bare disc convection, then fins if needed ─────────────────
  // Area model: both annular faces + the outer rim edge (bore/hub ignored).
  const A_disc_m2 = (2 * Math.PI * (ro ** 2 - ri ** 2) + 2 * Math.PI * ro * discT) / 1e6;
  const bareFull = convection({ h, area: A_disc_m2, deltaT: maxRise });
  if (!bareFull.ok) return { ok: false, error: `bare-disc convection failed — ${bareFull.error}` };
  const Q_bareFull = bareFull.value.heatRate_W;

  let finCount = 0;
  let fin: FinAnalysisResult | null = null;
  let capacity = Q_bareFull; // W at ΔT = maxRise
  if (Q_bareFull < P_cont) {
    const fa = finAnalysis({
      material: matName, h, length: finL,
      shape: 'rectangular', width: finW, thickness: finT,
      baseExcess: maxRise, tip: 'convective',
    });
    if (!fa.ok) return { ok: false, error: `fin analysis failed — ${fa.error}` };
    fin = fa.value;
    const Ac = fin.crossSectionArea_m2; // each fin base displaces this much bare area
    let found = false;
    for (const n of BRAKE_FIN_COUNTS) {
      const unfinned = Math.max(0, A_disc_m2 - n * Ac);
      const capN = h * unfinned * maxRise + n * fin.heatRate_W;
      if (capN >= P_cont) { finCount = n; capacity = capN; found = true; break; }
    }
    if (!found) {
      const nMax = BRAKE_FIN_COUNTS[BRAKE_FIN_COUNTS.length - 1];
      const capMax = h * Math.max(0, A_disc_m2 - nMax * Ac) * maxRise + nMax * fin.heatRate_W;
      const short = P_cont - capMax;
      return {
        ok: false,
        error: `cooling shortfall: even ${nMax} fins dissipate only ${rr(capMax, 1)} W at ΔT = ${maxRise} °C against `
          + `${rr(P_cont, 1)} W of continuous brake heat (shortfall ${rr(short, 1)} W) — use forced cooling `
          + `(raise h; current ${h} W/m²·K), a larger/thicker disc, longer or thicker fins, or a lower duty cycle`,
      };
    }
  }
  // Realised steady rise: ΔT = P_cont / conductance, ≤ maxRise by construction
  // (capacity = conductance · maxRise ≥ P_cont).
  const conductance = capacity / maxRise; // W/K
  const rise = P_cont / conductance;      // °C over ambient

  // ── Model + mass: the bare annular disc (cylinder minus bore) ─────────────
  const model: SolidModel = {
    positives: [{ kind: 'cylinder', r: ro, h: discT, cz: discT / 2, axis: 'z' }],
    negatives: [{ kind: 'cylinder', r: ri, h: discT + 2, cz: discT / 2, axis: 'z' }],
  };
  const volume_mm3 = Math.PI * (ro ** 2 - ri ** 2) * discT;
  const mass = volume_mm3 * mat.density;
  const out = typeof spec.outputPath === 'string' && spec.outputPath.trim() ? spec.outputPath : '<output>.stl';
  const bpy = writeBlenderSolidScript(model, out);

  const notes = [
    `Disc: uniform-wear T = ½·μ·Fn·(ro+ri) over stock radii — Ø${2 * ro}/Ø${2 * ri} mm needs Fn = ${Fn} N (cap ${cap} N), `
      + `mean pad pressure ${rr(padPressure, 4)} MPa ≤ ${BRAKE_LINING_MAX_PRESSURE_MPA} MPa (organic lining, Shigley Table 16-3). `
      + `One friction surface assumed; a twin-pad caliper (n = 2) would halve Fn.`,
    `Re-check: uniform-wear capacity ${rr(wearTorque, 4)} N·m ≥ required ${T_Nm} N·m; uniform-pressure (new) model gives `
      + `${rr(pressureTorque, 4)} N·m ≥ the wear value — the wear model stays the lower/design bound (the duality).`,
    `Heat (mechanical → thermal seam): P_peak = T·ω = ${rr(P_peak, 2)} W at ${rpm} rpm; continuous P_cont = `
      + `${duty} × P_peak = ${rr(P_cont, 2)} W.`,
    `Cooling: bare disc (two annular faces + rim edge, ${rr(A_disc_m2, 6)} m²) sheds ${rr(Q_bareFull, 2)} W at ΔT = ${maxRise} °C`
      + (finCount === 0
        ? ' — sufficient without fins.'
        : `; ${finCount} rectangular fins ${finL}×${finW}×${finT} mm (η = ${rr(fin!.efficiency, 4)}) raise capacity to `
          + `${rr(capacity, 2)} W → steady ΔT = ${rr(rise, 2)} °C ≤ ${maxRise} °C.`),
    `Model/mass are the bare annular disc only; fins are sized thermally but not modelled (hub/bolt hardware also omitted).`,
  ];

  return {
    ok: true,
    value: {
      type: 'brake',
      summary: `Ø${2 * ro}×${discT} mm ${matName} brake disc (${finCount} fins): ${T_Nm} N·m at ${rpm} rpm, `
        + `${Math.round(P_cont)} W continuous heat, steady ΔT ${rr(rise, 1)} °C`,
      dimensions: {
        outerRadius_mm: ro,
        innerRadius_mm: rr(ri, 4),
        discThickness_mm: discT,
        clampForce_N: Fn,
        padPressure_MPa: rr(padPressure, 4),
        torqueCapacity_Nm: wearTorque,
        uniformPressureTorque_Nm: pressureTorque,
        P_peak_W: rr(P_peak, 3),
        P_cont_W: rr(P_cont, 3),
        bareArea_m2: rr(A_disc_m2, 8),
        finCount,
        finLength_mm: finL,
        finThickness_mm: finT,
        finWidth_mm: finW,
        ...(finCount > 0 && fin ? { perFinHeat_W: fin.heatRate_W, finEfficiency: fin.efficiency } : {}),
        dissipation_W: rr(capacity, 3),
        coolingMargin_W: rr(capacity - P_cont, 3),
        realisedTempRise_C: rr(rise, 3),
      },
      safety: {
        allowableStress_MPa: BRAKE_LINING_MAX_PRESSURE_MPA,
        realisedStress_MPa: rr(padPressure, 4),
        realisedSafetyFactor: rr(wearTorque / T_Nm, 6),
        note: `torque margin = uniform-wear capacity / required = ${rr(wearTorque / T_Nm, 4)}×; `
          + `lining pressure ${rr(padPressure, 4)} ≤ ${BRAKE_LINING_MAX_PRESSURE_MPA} MPa allowable`,
      },
      material: matName,
      mass_kg: rr(mass, 4),
      model,
      bpy: bpy.ok ? bpy.value : '',
      notes,
    },
  };
}
