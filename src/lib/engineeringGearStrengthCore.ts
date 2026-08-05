/**
 * engineeringGearStrengthCore — GEAR TOOTH STRENGTH by the Lewis bending
 * equation: will a gear tooth survive the load it transmits? This is the
 * ANALYSIS partner to the gear GEOMETRY cores (engineeringGearCore draws the
 * involute tooth, engineeringGearTrainCore meshes a pair, and
 * engineeringCalcCore.gearPairTransmission turns torque/speed through the ratio)
 * — it SIZES the tooth those cores draw.
 *
 * THE PHYSICS: A TOOTH IS A CANTILEVER BEAM.
 * Wilfred Lewis (1892) modelled a gear tooth as a cantilever beam built into the
 * gear body and loaded by the transmitted tangential force Ft at its tip. The
 * root fillet is the beam's built-in end, where the bending moment M = Ft·h (h =
 * tooth height) is largest, so that is where the tooth breaks. The root bending
 * stress is the beam formula σ = M·c/I with c = t/2 and I = F·t³/12 for a
 * rectangular section of face width F and root thickness t. Lewis inscribed a
 * parabola of uniform strength inside the tooth and folded all of the tooth's
 * shape (h, t, and the pressure angle) into ONE dimensionless number, the Lewis
 * form factor Y, leaving the compact result
 *
 *     σ = Ft / (F · m · Y)          (module form; m = module in mm)
 *
 * That is the whole equation, and it is exact algebra once Y is known — the only
 * empirical content is Y, which depends on the tooth COUNT (a gear with more
 * teeth has a fatter, stubbier, stronger tooth → larger Y → lower stress) and
 * the pressure angle. Y has no clean closed form (it comes from locating the
 * inscribed-parabola tangent point on the actual involute flank), so — exactly
 * like the ISO tolerance grades — it is a PUBLISHED TABLE: here the standard 20°
 * full-depth values, interpolated between listed tooth counts. The smoke pins
 * the table entries AND the algebra against hand-computed references; the smoke
 * IS the proof (no app, no mesh, no ambiguity), just as for engineeringCalcCore.
 *
 * THE LINK TO POWER. Ft is not a free input — it comes from what the gear
 * transmits. The tooth force is the torque divided by the pitch RADIUS,
 * Ft = T / r with r = d/2 = m·N/2 (the SAME pitch diameter d = m·N that
 * gearGeometry computes), and the torque itself comes from power and speed,
 * T = P/ω with ω = 2π·n/60. So one call turns "this gear carries 15.7 kW at
 * 1500 rpm" into the tooth force, and the pitch-line velocity v = π·d·n falls
 * out for free with the sanity identity P = Ft·v.
 *
 * UNIT SYSTEM. The suite's self-consistent millimetre / newton / megapascal set:
 * Ft in N, F and m in mm, so σ = Ft/(F·m·Y) lands directly in N/mm² = MPa with
 * NO conversion factor — which is exactly why an allowable stress or a material
 * yield (both MPa) composes straight into the face-width sizing.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-gear-strength-core-smoketest.ts):
 * one value import (MATERIALS, for yield → allowable stress), no I/O, no
 * Date.now(), total functions.
 */

import { MATERIALS } from './engineeringCalcCore';

export type CalcResult =
  | {
      ok: true;
      quantity: string;
      value: number;
      unit: string;
      formula: string;
      inputs: Record<string, number | string>;
      /** Extra derived quantities (e.g. the Lewis Y alongside a stress). */
      extra?: Record<string, number>;
      notes?: string[];
    }
  | { ok: false; error: string };

function bad(error: string): CalcResult {
  return { ok: false, error };
}

function pos(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Round to a sensible number of significant figures for display parity. */
function round(value: number, dp = 6): number {
  if (!Number.isFinite(value)) return value;
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
}

// ─── Lewis form factor Y (20° full-depth involute teeth) ─────────────────────

/**
 * Standard Lewis form factors for 20° full-depth teeth, keyed on tooth count.
 * These are the published module-form Y values (used with σ = Ft/(F·m·Y)); the
 * older circular-pitch y = Y/π is a different number for a different formula.
 * Between listed counts Y is linearly interpolated; below/above the table it is
 * clamped (extrapolating a shape factor is not physical).
 */
export const LEWIS_Y: Array<[number, number]> = [
  [12, 0.245], [15, 0.277], [18, 0.293], [20, 0.320],
  [24, 0.337], [30, 0.358], [40, 0.389], [50, 0.408],
  [60, 0.421], [100, 0.446],
];

/** The Lewis form factor Y for a given tooth count (interpolated / clamped). */
export function lewisFormFactor(teeth: number): number {
  const N = Number(teeth);
  const first = LEWIS_Y[0];
  const last = LEWIS_Y[LEWIS_Y.length - 1];
  if (!Number.isFinite(N) || N <= first[0]) return first[1];
  if (N >= last[0]) return last[1];
  for (let i = 0; i < LEWIS_Y.length - 1; i += 1) {
    const [n0, y0] = LEWIS_Y[i];
    const [n1, y1] = LEWIS_Y[i + 1];
    if (N === n0) return y0;
    if (N > n0 && N < n1) return y0 + ((y1 - y0) * (N - n0)) / (n1 - n0);
  }
  return last[1];
}

// ─── Torque / power → tangential (tooth) load ────────────────────────────────

/** Resolve the transmitted torque (N·m) from an explicit torque, or from power
 *  and speed via T = P/ω (ω = 2π·n/60). */
function resolveTorque(args: {
  torque_Nm?: number;
  power_W?: number;
  speed_rpm?: number;
}): { T_Nm: number; source: 'torque' | 'power'; power_W: number | null } | { error: string } {
  if (args.torque_Nm !== undefined) {
    const T = pos(args.torque_Nm);
    if (T === null) return { error: 'torque_Nm must be positive (N·m)' };
    return { T_Nm: T, source: 'torque', power_W: null };
  }
  if (args.power_W !== undefined) {
    const P = pos(args.power_W);
    if (P === null) return { error: 'power_W must be positive (W)' };
    const rpm = pos(args.speed_rpm);
    if (rpm === null) return { error: 'power input needs a positive speed_rpm' };
    const omega = (2 * Math.PI * rpm) / 60; // rad/s
    return { T_Nm: P / omega, source: 'power', power_W: P };
  }
  return { error: 'supply torque_Nm, or power_W with speed_rpm' };
}

/** Shared spec → tangential load. Returns the raw (unrounded) Ft plus geometry,
 *  used by both the stress and the sizing entry points so they stay identical. */
function ftFromSpec(args: {
  module: number;
  teeth: number;
  tangentialLoad?: number;
  torque_Nm?: number;
  power_W?: number;
  speed_rpm?: number;
}): { Ft: number; d: number; r: number; m: number; N: number; T_Nm: number | null } | { error: string } {
  const m = pos(args.module);
  const N = Math.trunc(Number(args.teeth));
  if (m === null) return { error: 'module must be positive (mm)' };
  if (!Number.isFinite(N) || N < 1) return { error: 'teeth must be a positive integer' };
  const d = m * N; // pitch diameter, mm — the SAME d = m·N gearGeometry computes
  const r = d / 2; // pitch radius, mm
  // An explicit tangential load short-circuits the torque/power resolution.
  if (args.tangentialLoad !== undefined) {
    const Ft = pos(args.tangentialLoad);
    if (Ft === null) return { error: 'tangentialLoad must be positive (N)' };
    return { Ft, d, r, m, N, T_Nm: null };
  }
  const tq = resolveTorque(args);
  if ('error' in tq) return { error: tq.error };
  const Ft = (tq.T_Nm * 1000) / r; // T_Nm → N·mm, divided by r (mm) → N
  return { Ft, d, r, m, N, T_Nm: tq.T_Nm };
}

/**
 * The tangential (tooth) load Ft that a gear transmits, from either the torque
 * or the transmitted power and speed. Ft = T/r with r = m·N/2; from power,
 * T = P/ω and ω = 2π·n/60. When a speed is supplied it also returns the
 * pitch-line velocity v = π·d·n and the sanity identity P = Ft·v.
 */
export function tangentialLoad(args: {
  module: number;
  teeth: number;
  torque_Nm?: number;
  power_W?: number;
  speed_rpm?: number;
}): CalcResult {
  const m = pos(args.module);
  const N = Math.trunc(Number(args.teeth));
  if (m === null) return bad('module must be positive (mm)');
  if (!Number.isFinite(N) || N < 1) return bad('teeth must be a positive integer');
  const tq = resolveTorque(args);
  if ('error' in tq) return bad(tq.error);

  const d = m * N;
  const r = d / 2;
  const Ft = (tq.T_Nm * 1000) / r; // N

  const extra: Record<string, number> = {
    tangential_load_N: round(Ft),
    pitch_diameter_mm: round(d),
    pitch_radius_mm: round(r),
    torque_Nm: round(tq.T_Nm, 4),
  };
  const notes: string[] = [`Ft = T/r with T = ${round(tq.T_Nm, 3)} N·m at pitch radius ${round(r)} mm.`];

  const rpm = args.speed_rpm !== undefined ? pos(args.speed_rpm) : null;
  if (rpm !== null) {
    const v_mm_s = Math.PI * d * (rpm / 60); // mm/s
    const v = v_mm_s / 1000; // m/s
    const powerCheck = Ft * v; // W (P = Ft·v)
    extra.pitch_line_velocity_m_s = round(v, 4);
    extra.transmitted_power_W = round(powerCheck);
    notes.push(`Pitch-line velocity v = π·d·n = ${round(v, 3)} m/s; power P = Ft·v = ${round(powerCheck)} W.`);
  }

  const inputs: Record<string, number | string> = { module_mm: m, teeth: N };
  if (tq.source === 'power') { inputs.power_W = round(tq.power_W as number, 4); if (rpm !== null) inputs.speed_rpm = rpm; }
  else { inputs.torque_Nm = round(tq.T_Nm, 4); if (rpm !== null) inputs.speed_rpm = rpm; }

  return {
    ok: true,
    quantity: 'gear tangential (tooth) load',
    value: round(Ft),
    unit: 'N',
    formula: tq.source === 'power' ? 'T = P/ω (ω = 2πn/60), Ft = T/r, r = m·N/2' : 'Ft = T/r, r = m·N/2',
    inputs,
    extra,
    notes,
  };
}

// ─── Lewis bending stress ────────────────────────────────────────────────────

/**
 * Lewis root bending stress σ = Ft/(F·m·Y). The tangential load Ft may be given
 * directly, or derived from torque_Nm (or power_W + speed_rpm) via the same
 * Ft = T/r link. Y is the 20° full-depth Lewis form factor for the tooth count.
 */
export function lewisBendingStress(args: {
  module: number;
  teeth: number;
  faceWidth: number;
  tangentialLoad?: number;
  torque_Nm?: number;
  power_W?: number;
  speed_rpm?: number;
}): CalcResult {
  const F = pos(args.faceWidth);
  if (F === null) return bad('faceWidth must be positive (mm)');
  const ft = ftFromSpec(args);
  if ('error' in ft) return bad(ft.error);

  const Y = lewisFormFactor(ft.N);
  const sigma = ft.Ft / (F * ft.m * Y); // MPa (= N/mm²)

  const extra: Record<string, number> = {
    bending_stress_MPa: round(sigma, 4),
    lewis_Y: Y,
    tangential_load_N: round(ft.Ft),
    face_width_mm: F,
    module_mm: ft.m,
    pitch_diameter_mm: round(ft.d),
  };
  if (ft.T_Nm !== null) extra.torque_Nm = round(ft.T_Nm, 4);

  return {
    ok: true,
    quantity: 'gear tooth bending stress (Lewis)',
    value: round(sigma, 4),
    unit: 'MPa',
    formula: 'σ = Ft/(F·m·Y)  [Y = 20° full-depth Lewis form factor]',
    inputs: { module_mm: ft.m, teeth: ft.N, face_width_mm: F, tangential_load_N: round(ft.Ft, 4) },
    extra,
    notes: [`Lewis form factor Y = ${Y} for ${ft.N} teeth. σ scales with load, inversely with face·module; compare with the allowable = yield/SF.`],
  };
}

// ─── Face-width sizing (invert Lewis) ────────────────────────────────────────

/**
 * Size the face width by inverting Lewis: F = Ft/(σ_allow·m·Y), then round UP to
 * a standard value (next whole mm by default, or the next multiple of the module
 * when roundToModule is set). The allowable stress is supplied directly, or
 * derived from a material's yield and a safety factor (allowable = yield/SF).
 * Returns the required and chosen face widths and the realised stress at the
 * chosen width (which is ≤ the allowable because the width was rounded up).
 */
export function sizeFaceWidth(args: {
  module: number;
  teeth: number;
  tangentialLoad?: number;
  torque_Nm?: number;
  power_W?: number;
  speed_rpm?: number;
  /** Allowable bending stress, MPa. */
  allowableStress?: number;
  /** OR a material name (yield from the table) with a safety factor. */
  material?: string;
  safetyFactor?: number;
  /** Round the required face width UP to this granularity (mm). Default 1 mm. */
  roundStep?: number;
  /** Round UP to the next whole multiple of the module instead of roundStep. */
  roundToModule?: boolean;
}): CalcResult {
  const ft = ftFromSpec(args);
  if ('error' in ft) return bad(ft.error);
  const Y = lewisFormFactor(ft.N);

  // Allowable stress: explicit, or yield/SF from the material table.
  let allow: number | null = args.allowableStress !== undefined ? pos(args.allowableStress) : null;
  let allowNote = '';
  if (allow === null) {
    if (args.allowableStress !== undefined) return bad('allowableStress must be positive (MPa)');
    if (!args.material) return bad('supply allowableStress (MPa), or material + safetyFactor');
    const mat = MATERIALS[String(args.material).trim().toLowerCase()];
    if (!mat) return bad(`unknown material "${args.material}" — known: ${Object.keys(MATERIALS).join(', ')}`);
    const SF = pos(args.safetyFactor);
    if (SF === null) return bad('material sizing needs a positive safetyFactor');
    allow = mat.yield / SF;
    allowNote = `allowable = ${mat.name} yield ${mat.yield} MPa / SF ${SF} = ${round(allow, 3)} MPa`;
  }
  if (allow === null || !(allow > 0)) return bad('allowable stress must be positive (MPa)');

  const required = ft.Ft / (allow * ft.m * Y); // mm
  // Round UP to a standard face width (the −1e-9 keeps an exact hit from bumping).
  let chosen: number;
  if (args.roundToModule) {
    chosen = Math.ceil(required / ft.m - 1e-9) * ft.m;
  } else {
    const step = pos(args.roundStep) ?? 1;
    chosen = Math.ceil(required / step - 1e-9) * step;
  }
  const realized = ft.Ft / (chosen * ft.m * Y); // MPa at the chosen width

  const extra: Record<string, number> = {
    required_face_width_mm: round(required, 4),
    chosen_face_width_mm: round(chosen, 4),
    realized_stress_MPa: round(realized, 4),
    allowable_stress_MPa: round(allow, 4),
    lewis_Y: Y,
    tangential_load_N: round(ft.Ft),
    module_mm: ft.m,
  };
  const notes: string[] = [
    `Required F = Ft/(σ_allow·m·Y) = ${round(required, 3)} mm → chosen ${round(chosen, 3)} mm (rounded up). Realised σ = ${round(realized, 2)} MPa ≤ allowable ${round(allow, 2)} MPa.`,
  ];
  if (allowNote) notes.push(allowNote);

  return {
    ok: true,
    quantity: 'gear face width (Lewis sizing)',
    value: round(chosen, 4),
    unit: 'mm',
    formula: 'F = Ft/(σ_allow·m·Y), rounded up; σ_realized = Ft/(F·m·Y)',
    inputs: { module_mm: ft.m, teeth: ft.N, tangential_load_N: round(ft.Ft, 4), allowable_MPa: round(allow, 4) },
    extra,
    notes,
  };
}
