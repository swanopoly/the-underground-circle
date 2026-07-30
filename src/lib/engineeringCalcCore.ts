/**
 * engineeringCalcCore — a PURE engineering-calculation core: the ANALYSIS half
 * of engineering work, next to the drafting (2D) and solid-modeling (3D)
 * generation cores.
 *
 * WHY THIS EXISTS
 * An engineer sizes a beam, picks an LED resistor, or looks up a tap drill
 * BEFORE (and after) drawing anything. Those are deterministic, closed-form
 * calculations with textbook-exact answers — so unlike the generation cores
 * (whose output is verified by round-trip or by running a real engine), this
 * core's correctness is proven directly: every formula is asserted against a
 * hand-computed reference value in the smoke. The smoke IS the proof; there is
 * no app, no network, no ambiguity.
 *
 * It composes with the generators: calculate the required plate thickness or
 * hole size, THEN generate the DXF/STL. analyze → draw is the real workflow.
 *
 * UNIT SYSTEM. Everything mechanical works in the self-consistent
 * millimetre / newton / megapascal set: length mm, force N, stress MPa (= N/mm²),
 * Young's modulus E in MPa, second moment of area I in mm⁴. In that system a
 * deflection formula like δ = PL³/(48EI) comes out directly in mm with no
 * conversion factors — which is exactly why the references are clean.
 *
 * Every function returns a structured, AUDITABLE result: the quantity, its
 * value and unit, the formula used, and the inputs echoed back, so an agent can
 * show its work instead of asserting a bare number.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-calc-core-smoketest.ts):
 * no imports, no Date.now(), no I/O, total functions.
 */

export type CalcResult =
  | {
      ok: true;
      quantity: string;
      value: number;
      unit: string;
      formula: string;
      inputs: Record<string, number | string>;
      /** Extra derived quantities (e.g. reactions alongside a deflection). */
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

function fin(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Round to a sensible number of significant figures for display parity. */
function round(value: number, dp = 6): number {
  if (!Number.isFinite(value)) return value;
  const f = Math.pow(10, dp);
  return Math.round(value * f) / f;
}

// ─── Materials (mm / N / MPa system) ─────────────────────────────────────────

export type MaterialProps = {
  name: string;
  /** Young's modulus, MPa. */
  E: number;
  /** Shear modulus, MPa (for torsion/spring calcs). */
  G: number;
  /** Yield strength, MPa. */
  yield: number;
  /** Density, kg/mm³ (so mass = density · volume_mm3 gives kg). */
  density: number;
  /** Coefficient of thermal expansion, per °C (for thermal calcs). */
  alpha: number;
};

export const MATERIALS: Record<string, MaterialProps> = {
  steel: { name: 'Steel (mild, A36-ish)', E: 200_000, G: 79_300, yield: 250, density: 7.85e-6, alpha: 12.0e-6 },
  stainless: { name: 'Stainless 304', E: 193_000, G: 77_200, yield: 215, density: 8.0e-6, alpha: 17.3e-6 },
  aluminum: { name: 'Aluminum 6061-T6', E: 69_000, G: 26_000, yield: 276, density: 2.70e-6, alpha: 23.6e-6 },
  titanium: { name: 'Titanium Ti-6Al-4V', E: 114_000, G: 44_000, yield: 880, density: 4.43e-6, alpha: 8.6e-6 },
  brass: { name: 'Brass C360', E: 97_000, G: 37_000, yield: 124, density: 8.5e-6, alpha: 20.5e-6 },
  abs: { name: 'ABS plastic', E: 2_300, G: 800, yield: 40, density: 1.05e-6, alpha: 90.0e-6 },
  pla: { name: 'PLA plastic', E: 3_500, G: 1_300, yield: 50, density: 1.24e-6, alpha: 68.0e-6 },
};

export function materialProps(name: string): CalcResult {
  const key = String(name || '').trim().toLowerCase();
  const m = MATERIALS[key];
  if (!m) return bad(`unknown material "${name}" — known: ${Object.keys(MATERIALS).join(', ')}`);
  return {
    ok: true, quantity: `material: ${m.name}`, value: m.E, unit: 'MPa (E)',
    formula: 'lookup', inputs: { material: key },
    extra: { E_MPa: m.E, G_MPa: m.G, yield_MPa: m.yield, density_kg_per_mm3: m.density, alpha_per_C: m.alpha },
    notes: [`E=${m.E} MPa, G=${m.G} MPa, yield=${m.yield} MPa, density=${m.density} kg/mm³, α=${m.alpha}/°C`],
  };
}

// ─── Section properties (I and S drive every beam calc) ──────────────────────

/** Rectangle b (width) × h (height, bending axis) → area, I, section modulus. */
export function sectionRectangle(b: number, h: number): CalcResult {
  const bb = pos(b), hh = pos(h);
  if (bb === null || hh === null) return bad('rectangle needs positive b and h (mm)');
  const A = bb * hh;
  const I = (bb * hh ** 3) / 12;
  const S = I / (hh / 2);
  return {
    ok: true, quantity: 'section: rectangle', value: round(I), unit: 'mm⁴ (I)',
    formula: 'I = b·h³/12, S = I/(h/2), A = b·h', inputs: { b: bb, h: hh },
    extra: { area_mm2: round(A), I_mm4: round(I), S_mm3: round(S) },
  };
}

/** Solid circle of diameter d. */
export function sectionCircle(d: number): CalcResult {
  const dd = pos(d);
  if (dd === null) return bad('circle needs positive diameter (mm)');
  const A = (Math.PI * dd ** 2) / 4;
  const I = (Math.PI * dd ** 4) / 64;
  const S = I / (dd / 2);
  return {
    ok: true, quantity: 'section: circle', value: round(I), unit: 'mm⁴ (I)',
    formula: 'I = π·d⁴/64, S = I/(d/2), A = π·d²/4', inputs: { d: dd },
    extra: { area_mm2: round(A), I_mm4: round(I), S_mm3: round(S) },
  };
}

/** Round tube, outer/inner diameter. */
export function sectionTube(od: number, id: number): CalcResult {
  const o = pos(od), i = fin(id);
  if (o === null || i === null || i < 0 || i >= o) return bad('tube needs 0 ≤ id < od (mm)');
  const A = (Math.PI * (o ** 2 - i ** 2)) / 4;
  const I = (Math.PI * (o ** 4 - i ** 4)) / 64;
  const S = I / (o / 2);
  return {
    ok: true, quantity: 'section: tube', value: round(I), unit: 'mm⁴ (I)',
    formula: 'I = π·(od⁴−id⁴)/64', inputs: { od: o, id: i },
    extra: { area_mm2: round(A), I_mm4: round(I), S_mm3: round(S) },
  };
}

// ─── Beams ───────────────────────────────────────────────────────────────────

export type BeamSupport = 'simply_supported' | 'cantilever';
export type BeamLoad = 'point_center' | 'point_end' | 'udl';

/**
 * Beam bending + deflection for the four canonical cases. Load is a point load
 * P (N) or a uniformly distributed load w (N/mm). Returns max bending moment,
 * max deflection, and max bending stress when a section modulus S is supplied.
 *
 *   simply-supported + central point: Mmax=PL/4,   δmax=PL³/(48EI)
 *   simply-supported + UDL:           Mmax=wL²/8,   δmax=5wL⁴/(384EI)
 *   cantilever       + end point:     Mmax=PL,      δmax=PL³/(3EI)
 *   cantilever       + UDL:           Mmax=wL²/2,   δmax=wL⁴/(8EI)
 */
export function beam(args: {
  support: BeamSupport;
  load: BeamLoad;
  /** Point load P in N (point cases) OR distributed w in N/mm (udl). */
  magnitude: number;
  /** Span/length L in mm. */
  length: number;
  /** Young's modulus E in MPa (or a material name via materialE). */
  E: number;
  /** Second moment of area I in mm⁴. */
  I: number;
  /** Section modulus S in mm³ (optional; enables bending stress). */
  S?: number;
}): CalcResult {
  const L = pos(args.length), E = pos(args.E), I = pos(args.I), mag = pos(args.magnitude);
  if (L === null || E === null || I === null || mag === null) return bad('beam needs positive length, E, I, and load magnitude');

  let Mmax: number; let dmax: number; let formula: string; const extra: Record<string, number> = {};
  const key = `${args.support}:${args.load}`;
  switch (key) {
    case 'simply_supported:point_center':
      Mmax = (mag * L) / 4; dmax = (mag * L ** 3) / (48 * E * I);
      formula = 'Mmax=PL/4, δmax=PL³/(48EI)'; extra.reaction_each_N = round(mag / 2); break;
    case 'simply_supported:udl':
      Mmax = (mag * L ** 2) / 8; dmax = (5 * mag * L ** 4) / (384 * E * I);
      formula = 'Mmax=wL²/8, δmax=5wL⁴/(384EI)'; extra.reaction_each_N = round((mag * L) / 2); break;
    case 'cantilever:point_end':
      Mmax = mag * L; dmax = (mag * L ** 3) / (3 * E * I);
      formula = 'Mmax=PL, δmax=PL³/(3EI)'; extra.reaction_N = round(mag); break;
    case 'cantilever:udl':
      Mmax = (mag * L ** 2) / 2; dmax = (mag * L ** 4) / (8 * E * I);
      formula = 'Mmax=wL²/2, δmax=wL⁴/(8EI)'; extra.reaction_N = round(mag * L); break;
    default:
      return bad(`unsupported beam case "${key}" (support: simply_supported|cantilever, load: point_center|point_end|udl)`);
  }

  extra.max_moment_Nmm = round(Mmax);
  extra.max_deflection_mm = round(dmax);
  const notes: string[] = [];
  if (args.S) {
    const S = pos(args.S);
    if (S !== null) {
      const stress = Mmax / S;
      extra.max_bending_stress_MPa = round(stress);
      notes.push(`bending stress σ = Mmax/S = ${round(stress)} MPa`);
    }
  }
  return {
    ok: true, quantity: `beam ${args.support} ${args.load}: max deflection`, value: round(dmax), unit: 'mm',
    formula, inputs: { support: args.support, load: args.load, magnitude: mag, length_mm: L, E_MPa: E, I_mm4: I },
    extra, notes,
  };
}

// ─── Safety factor ───────────────────────────────────────────────────────────

export function safetyFactor(strength: number, appliedStress: number): CalcResult {
  const S = pos(strength), a = pos(appliedStress);
  if (S === null || a === null) return bad('safety factor needs positive strength and applied stress (same units)');
  const sf = S / a;
  return {
    ok: true, quantity: 'safety factor', value: round(sf, 3), unit: '(ratio)',
    formula: 'SF = strength / applied stress', inputs: { strength_MPa: S, applied_MPa: a },
    notes: [sf < 1 ? 'SF < 1 — the part is predicted to FAIL under this load.' : `SF = ${round(sf, 2)} (typical design targets 1.5–4 depending on code).`],
  };
}

// ─── Bolts & threads ─────────────────────────────────────────────────────────

/** Bolt preload from applied torque: F = T / (K·d). T in N·mm, d in mm → F in N. */
export function boltPreload(args: { torque: number; diameter: number; nutFactor?: number }): CalcResult {
  const T = pos(args.torque), d = pos(args.diameter);
  const K = args.nutFactor && args.nutFactor > 0 ? Number(args.nutFactor) : 0.2;
  if (T === null || d === null) return bad('bolt preload needs positive torque (N·mm) and diameter (mm)');
  const F = T / (K * d);
  return {
    ok: true, quantity: 'bolt preload (clamp force)', value: round(F), unit: 'N',
    formula: 'F = T/(K·d)', inputs: { torque_Nmm: T, diameter_mm: d, nut_factor_K: K },
    notes: [`K=${K} (0.2 dry, ~0.15 lubricated). Torque in N·mm — for N·m multiply by 1000.`],
  };
}

/** Standard metric coarse tap-drill diameters (mm), keyed "M<size>". */
export const METRIC_TAP_DRILL: Record<string, { pitch: number; tapDrill: number; clearance: number }> = {
  M2: { pitch: 0.4, tapDrill: 1.6, clearance: 2.4 },
  M2_5: { pitch: 0.45, tapDrill: 2.05, clearance: 2.9 },
  M3: { pitch: 0.5, tapDrill: 2.5, clearance: 3.4 },
  M4: { pitch: 0.7, tapDrill: 3.3, clearance: 4.5 },
  M5: { pitch: 0.8, tapDrill: 4.2, clearance: 5.5 },
  M6: { pitch: 1.0, tapDrill: 5.0, clearance: 6.6 },
  M8: { pitch: 1.25, tapDrill: 6.8, clearance: 9.0 },
  M10: { pitch: 1.5, tapDrill: 8.5, clearance: 11.0 },
  M12: { pitch: 1.75, tapDrill: 10.2, clearance: 13.5 },
  M16: { pitch: 2.0, tapDrill: 14.0, clearance: 17.5 },
  M20: { pitch: 2.5, tapDrill: 17.5, clearance: 22.0 },
};

/** Tap drill + clearance hole for a standard metric coarse thread ("M8"). */
export function tapDrill(designation: string): CalcResult {
  const key = String(designation || '').trim().toUpperCase().replace('.', '_');
  const e = METRIC_TAP_DRILL[key];
  if (!e) return bad(`unknown thread "${designation}" — known: ${Object.keys(METRIC_TAP_DRILL).join(', ').replace(/_/g, '.')}`);
  return {
    ok: true, quantity: `tap drill for ${key.replace('_', '.')}`, value: e.tapDrill, unit: 'mm',
    formula: 'standard metric coarse (≈ major − pitch)', inputs: { thread: key.replace('_', '.') },
    extra: { pitch_mm: e.pitch, tap_drill_mm: e.tapDrill, clearance_hole_mm: e.clearance },
    notes: [`Tap drill ${e.tapDrill} mm (~75% thread). Clearance hole ${e.clearance} mm. Pitch ${e.pitch} mm.`],
  };
}

// ─── Electrical (pairs with the schematic toolset) ───────────────────────────

/** Ohm's law: supply any two of V, I, R → the rest + power. */
export function ohmsLaw(args: { voltage?: number; current?: number; resistance?: number }): CalcResult {
  const V = args.voltage !== undefined ? fin(args.voltage) : null;
  const I = args.current !== undefined ? fin(args.current) : null;
  const R = args.resistance !== undefined ? fin(args.resistance) : null;
  const known = [V, I, R].filter((x) => x !== null).length;
  if (known < 2) return bad("Ohm's law needs exactly two of voltage (V), current (A), resistance (Ω)");
  let v = V, i = I, r = R;
  if (v === null && i !== null && r !== null) v = i * r;
  else if (i === null && v !== null && r !== null) { if (r === 0) return bad('resistance is zero'); i = v / r; }
  else if (r === null && v !== null && i !== null) { if (i === 0) return bad('current is zero'); r = v / i; }
  if (v === null || i === null || r === null) return bad("could not solve Ohm's law from the given values");
  const p = v * i;
  return {
    ok: true, quantity: "Ohm's law", value: round(r), unit: 'Ω',
    formula: 'V = I·R, P = V·I', inputs: { voltage_V: round(v), current_A: round(i), resistance_ohm: round(r) },
    extra: { voltage_V: round(v), current_A: round(i), resistance_ohm: round(r), power_W: round(p) },
  };
}

/** LED series resistor: (Vsupply − Vf)/If, plus the resistor's power. */
export function ledResistor(args: { supply: number; forwardVoltage: number; current: number }): CalcResult {
  const Vs = pos(args.supply), Vf = fin(args.forwardVoltage), If = pos(args.current);
  if (Vs === null || Vf === null || If === null) return bad('LED resistor needs positive supply, forward voltage, and current (A)');
  if (Vf >= Vs) return bad('forward voltage must be less than supply voltage');
  const R = (Vs - Vf) / If;
  const P = (Vs - Vf) * If;
  return {
    ok: true, quantity: 'LED series resistor', value: round(R), unit: 'Ω',
    formula: 'R = (Vsupply − Vf)/If, P = (Vsupply − Vf)·If', inputs: { supply_V: Vs, Vf_V: Vf, current_A: If },
    extra: { resistance_ohm: round(R), resistor_power_W: round(P) },
    notes: [`Pick the next standard resistor ≥ ${round(R)} Ω rated for ≥ ${round(P * 2)} W (2× margin).`],
  };
}

/** Series (sum) or parallel (reciprocal) resistance of a list. */
export function combineResistors(values: number[], mode: 'series' | 'parallel'): CalcResult {
  const rs = Array.isArray(values) ? values.map(fin).filter((x): x is number => x !== null && x > 0) : [];
  if (!rs.length) return bad('provide at least one positive resistance');
  if (mode === 'series') {
    const total = rs.reduce((a, b) => a + b, 0);
    return { ok: true, quantity: 'series resistance', value: round(total), unit: 'Ω', formula: 'R = ΣRi', inputs: { count: rs.length, mode }, extra: { total_ohm: round(total) } };
  }
  if (mode === 'parallel') {
    const inv = rs.reduce((a, b) => a + 1 / b, 0);
    const total = 1 / inv;
    return { ok: true, quantity: 'parallel resistance', value: round(total), unit: 'Ω', formula: '1/R = Σ(1/Ri)', inputs: { count: rs.length, mode }, extra: { total_ohm: round(total) } };
  }
  return bad('mode must be "series" or "parallel"');
}

/** Voltage divider: Vout = Vin · R2/(R1+R2). */
export function voltageDivider(args: { vin: number; r1: number; r2: number }): CalcResult {
  const Vin = fin(args.vin), R1 = pos(args.r1), R2 = pos(args.r2);
  if (Vin === null || R1 === null || R2 === null) return bad('voltage divider needs Vin and positive R1, R2');
  const Vout = (Vin * R2) / (R1 + R2);
  return {
    ok: true, quantity: 'voltage divider Vout', value: round(Vout), unit: 'V',
    formula: 'Vout = Vin·R2/(R1+R2)', inputs: { vin_V: Vin, r1_ohm: R1, r2_ohm: R2 },
    extra: { vout_V: round(Vout), current_A: round(Vin / (R1 + R2)) },
  };
}

/** RC time constant τ = R·C (R in Ω, C in farads → seconds). */
export function rcTimeConstant(args: { resistance: number; capacitance: number }): CalcResult {
  const R = pos(args.resistance), C = pos(args.capacitance);
  if (R === null || C === null) return bad('RC needs positive resistance (Ω) and capacitance (F)');
  const tau = R * C;
  return {
    ok: true, quantity: 'RC time constant', value: round(tau, 9), unit: 's',
    formula: 'τ = R·C (63.2% at 1τ, ~99% at 5τ)', inputs: { resistance_ohm: R, capacitance_F: C },
    extra: { tau_s: round(tau, 9), settle_5tau_s: round(5 * tau, 9) },
  };
}

// ─── Springs (helical compression — composes materials via shear modulus) ────

/**
 * Helical compression spring rate k = G·d⁴/(8·D³·n), where d = wire diameter,
 * D = mean coil diameter, n = active coils, G = shear modulus. Composes the
 * materials table (each material carries G) so an engineer can size a spring in
 * any material, then generate its geometry with engineering.model_3d 'spring'.
 */
export function springRate(args: {
  wireDiameter: number;
  meanDiameter: number;
  activeCoils: number;
  /** Material name (looks up G) OR an explicit shearModulus in MPa. */
  material?: string;
  shearModulus?: number;
}): CalcResult {
  const d = pos(args.wireDiameter), D = pos(args.meanDiameter), n = pos(args.activeCoils);
  if (d === null || D === null || n === null) return bad('spring needs positive wire diameter, mean diameter, and active coils');
  if (D <= d) return bad('mean diameter must exceed the wire diameter');
  let G: number | null = args.shearModulus !== undefined ? pos(args.shearModulus) : null;
  if (G === null && args.material) { const m = MATERIALS[String(args.material).trim().toLowerCase()]; if (m) G = m.G; }
  if (G === null) return bad('supply a material (for G) or an explicit shearModulus (MPa)');
  const k = (G * d ** 4) / (8 * D ** 3 * n);
  const index = D / d;
  return {
    ok: true, quantity: 'spring rate', value: round(k, 4), unit: 'N/mm',
    formula: 'k = G·d⁴/(8·D³·n)', inputs: { wire_dia_mm: d, mean_dia_mm: D, active_coils: n, G_MPa: G },
    extra: { rate_N_per_mm: round(k, 4), spring_index_D_over_d: round(index, 2), solid_height_est_mm: round((n + 2) * d) },
    notes: [`Spring index D/d = ${round(index, 1)} (4–12 is a practical range). Force at deflection x: F = k·x.`],
  };
}

// ─── Column buckling (composes the structural-section lane) ──────────────────

/** End-condition effective-length factors K (theoretical). */
const COLUMN_END_K: Record<string, number> = {
  pinned_pinned: 1.0, pinned: 1.0,
  fixed_free: 2.0, cantilever: 2.0,
  fixed_fixed: 0.5, fixed: 0.5,
  fixed_pinned: 0.699, propped: 0.699,
};

/**
 * Euler critical buckling load of a slender column: Pcr = π²·E·I / (K·L)². Feed
 * the second moment of area I from engineering.model_3d 'beam' (a section's Iₓ)
 * and the end condition; get the axial load at which it buckles, plus the
 * critical stress and slenderness when the area / radius of gyration are given.
 */
export function columnBuckling(args: {
  momentOfInertia: number; // I, mm⁴ (use the section's smaller I — buckling picks the weak axis)
  length: number; // unbraced length, mm
  endCondition?: string;
  material?: string; E?: number;
  area?: number; // mm² → critical stress
  radiusOfGyration?: number; // mm → slenderness KL/r
}): CalcResult {
  const I = pos(args.momentOfInertia), L = pos(args.length);
  if (I === null || L === null) return bad('column needs positive momentOfInertia (mm⁴) and length (mm)');
  let E: number | null = args.E !== undefined ? pos(args.E) : null;
  if (E === null && args.material) { const m = MATERIALS[String(args.material).trim().toLowerCase()]; if (m) E = m.E; }
  if (E === null) return bad('supply a material (for E) or an explicit E (MPa)');
  const endKey = String(args.endCondition || 'pinned_pinned').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const K = COLUMN_END_K[endKey];
  if (K === undefined) return bad(`unknown endCondition — use ${Object.keys(COLUMN_END_K).join(', ')}`);
  const Le = K * L;
  const Pcr = (Math.PI ** 2 * E * I) / (Le ** 2);
  const extra: Record<string, number> = { Pcr_N: round(Pcr), Pcr_kN: round(Pcr / 1000, 4), effective_length_mm: round(Le), K };
  const notes = [`End condition "${endKey}" → K=${K}. Euler is valid only for slender columns (elastic buckling); check the slenderness against the material's yield.`];
  const A = args.area !== undefined ? pos(args.area) : null;
  if (A !== null) { const sigma = Pcr / A; extra.critical_stress_MPa = round(sigma, 4); }
  const r = args.radiusOfGyration !== undefined ? pos(args.radiusOfGyration) : null;
  if (r !== null) { extra.slenderness_KL_over_r = round(Le / r, 2); }
  return {
    ok: true, quantity: 'column buckling (Euler)', value: round(Pcr), unit: 'N (Pcr)',
    formula: 'Pcr = π²·E·I / (K·L)²', inputs: { I_mm4: I, length_mm: L, K, E_MPa: E },
    extra, notes,
  };
}

// ─── Shaft torsion (composes the materials shear modulus G) ──────────────────

/**
 * Circular shaft in torsion: max shear stress τ = T·r/J and angle of twist
 * θ = T·L/(G·J), with polar moment J = π·d⁴/32 (solid) or π·(D⁴−d⁴)/32 (hollow).
 * Uses the same G as the spring calc, so one material drives both.
 */
export function shaftTorsion(args: {
  torque: number; // N·mm
  diameter: number; // outer, mm
  innerDiameter?: number; // hollow shaft
  length?: number; // mm → angle of twist
  material?: string; shearModulus?: number;
}): CalcResult {
  const T = pos(args.torque), D = pos(args.diameter);
  if (T === null || D === null) return bad('shaft needs positive torque (N·mm) and diameter (mm)');
  const di = args.innerDiameter !== undefined ? fin(args.innerDiameter) : 0;
  if (di === null || di < 0 || di >= D) return bad('innerDiameter must be 0 ≤ id < od');
  const J = (Math.PI * (D ** 4 - di ** 4)) / 32;
  const tau = (T * (D / 2)) / J;
  const extra: Record<string, number> = { max_shear_stress_MPa: round(tau, 4), polar_moment_J_mm4: round(J), outer_radius_mm: round(D / 2) };
  const notes = [`τ_max at the outer surface. Compare with the material's shear yield (~0.577·σ_yield, von Mises).`];
  const L = args.length !== undefined ? pos(args.length) : null;
  if (L !== null) {
    let G: number | null = args.shearModulus !== undefined ? pos(args.shearModulus) : null;
    if (G === null && args.material) { const m = MATERIALS[String(args.material).trim().toLowerCase()]; if (m) G = m.G; }
    if (G !== null) {
      const thetaRad = (T * L) / (G * J);
      extra.angle_of_twist_deg = round((thetaRad * 180) / Math.PI, 4);
      extra.angle_of_twist_rad = round(thetaRad, 6);
    } else {
      notes.push('Provide a material or shearModulus (MPa) for the angle of twist.');
    }
  }
  return {
    ok: true, quantity: 'shaft torsion', value: round(tau, 4), unit: 'MPa (τ_max)',
    formula: 'τ = T·(D/2)/J, θ = T·L/(G·J), J = π·(D⁴−d⁴)/32', inputs: { torque_Nmm: T, od_mm: D, id_mm: di },
    extra, notes,
  };
}

// ─── Thermal expansion (composes the materials α) ────────────────────────────

/**
 * Free thermal growth ΔL = α·L·ΔT, and — if the part is fully restrained — the
 * thermal stress σ = E·α·ΔT it develops (compressive on heating). α and E come
 * from the material table.
 */
export function thermalExpansion(args: {
  length: number; // mm
  deltaT: number; // °C (signed)
  material?: string; alpha?: number; E?: number;
}): CalcResult {
  const L = pos(args.length), dT = fin(args.deltaT);
  if (L === null || dT === null) return bad('thermal needs positive length (mm) and a deltaT (°C)');
  const m = args.material ? MATERIALS[String(args.material).trim().toLowerCase()] : undefined;
  let alpha: number | null = args.alpha !== undefined ? fin(args.alpha) : null;
  if (alpha === null && m) alpha = m.alpha;
  if (alpha === null || !(alpha > 0)) return bad('supply a material (for α) or an explicit alpha (per °C)');
  const dL = alpha * L * dT;
  const extra: Record<string, number> = { delta_length_mm: round(dL, 6), alpha_per_C: alpha, strain: round(alpha * dT, 8) };
  const notes = [`Free expansion (unrestrained). ΔL is signed with ΔT.`];
  let E: number | null = args.E !== undefined ? pos(args.E) : null;
  if (E === null && m) E = m.E;
  if (E !== null) { const sigma = E * alpha * dT; extra.constrained_stress_MPa = round(sigma, 4); notes.push('constrained_stress assumes FULL restraint (no movement); compressive on heating.'); }
  return {
    ok: true, quantity: 'thermal expansion', value: round(dL, 6), unit: 'mm (ΔL)',
    formula: 'ΔL = α·L·ΔT, σ = E·α·ΔT (restrained)', inputs: { length_mm: L, deltaT_C: dT, alpha_per_C: alpha },
    extra, notes,
  };
}

// ─── Thin-wall pressure vessel ───────────────────────────────────────────────

/**
 * Thin-wall cylinder under internal pressure: hoop (circumferential) stress
 * σ_h = p·r/t and longitudinal σ_l = p·r/(2t). Hoop is twice longitudinal, so it
 * governs. Thin-wall theory assumes r/t ≥ 10.
 */
export function pressureVessel(args: {
  pressure: number; // MPa
  innerRadius?: number; // mm
  innerDiameter?: number;
  wallThickness: number; // mm
}): CalcResult {
  const p = pos(args.pressure), t = pos(args.wallThickness);
  let r: number | null = args.innerRadius !== undefined ? pos(args.innerRadius) : null;
  if (r === null && args.innerDiameter !== undefined) { const d = pos(args.innerDiameter); if (d !== null) r = d / 2; }
  if (p === null || t === null || r === null) return bad('pressure vessel needs positive pressure (MPa), wallThickness (mm), and innerRadius or innerDiameter (mm)');
  const hoop = (p * r) / t;
  const long = (p * r) / (2 * t);
  const ratio = r / t;
  const notes = [`Hoop stress governs (2× longitudinal). Thin-wall theory assumes r/t ≥ 10${ratio < 10 ? ` — here r/t = ${round(ratio, 1)}, so treat as APPROXIMATE (a thick-wall/Lamé analysis is more accurate)` : ''}.`];
  return {
    ok: true, quantity: 'thin-wall pressure vessel', value: round(hoop, 4), unit: 'MPa (hoop)',
    formula: 'σ_hoop = p·r/t, σ_long = p·r/(2t)', inputs: { pressure_MPa: p, inner_radius_mm: r, wall_mm: t },
    extra: { hoop_stress_MPa: round(hoop, 4), longitudinal_stress_MPa: round(long, 4), radius_to_thickness: round(ratio, 2) },
    notes,
  };
}

// ─── Gear pair (power transmission — composes the geometry lane) ─────────────

/**
 * Spur gear-pair transmission: ratio, center distance, and how it transforms
 * torque and speed. Torque multiplies by the ratio, speed divides by it (an
 * ideal, loss-free stage). Shares the exact geometry the gear-train generator
 * draws, so an engineer sizes the reduction here then draws/models it.
 */
export function gearPairTransmission(args: {
  pinionTeeth: number;
  gearTeeth: number;
  module: number;
  /** Optional input side for the torque/speed transform. */
  inputTorque_Nm?: number;
  inputSpeed_rpm?: number;
}): CalcResult {
  const N1 = Math.trunc(Number(args.pinionTeeth));
  const N2 = Math.trunc(Number(args.gearTeeth));
  const m = pos(args.module);
  if (!Number.isFinite(N1) || N1 < 4 || !Number.isFinite(N2) || N2 < 4) return bad('gear pair needs both tooth counts ≥ 4');
  if (m === null) return bad('module must be positive (mm)');
  const ratio = N2 / N1;
  const C = (m * (N1 + N2)) / 2;
  const extra: Record<string, number> = { ratio: round(ratio, 4), center_distance_mm: round(C), pinion_pitch_dia_mm: m * N1, gear_pitch_dia_mm: m * N2 };
  const notes: string[] = [`Ratio ${round(ratio, 3)}:1, center distance ${round(C)} mm (pitch circles tangent).`];
  if (args.inputTorque_Nm !== undefined) {
    const t = fin(args.inputTorque_Nm);
    if (t !== null) { extra.output_torque_Nm = round(t * ratio); notes.push(`Output torque = input · ratio = ${round(t * ratio)} N·m.`); }
  }
  if (args.inputSpeed_rpm !== undefined) {
    const rpm = fin(args.inputSpeed_rpm);
    if (rpm !== null) { extra.output_speed_rpm = round(rpm / ratio); notes.push(`Output speed = input / ratio = ${round(rpm / ratio)} rpm.`); }
  }
  return {
    ok: true, quantity: 'gear pair transmission', value: round(ratio, 4), unit: ':1 (ratio)',
    formula: 'i = N₂/N₁, C = m·(N₁+N₂)/2, Tout = Tin·i, ωout = ωin/i',
    inputs: { pinion_teeth: N1, gear_teeth: N2, module_mm: m },
    extra, notes,
  };
}

// ─── Unit conversion ─────────────────────────────────────────────────────────

/** Conversion factors to a canonical base unit per dimension. */
const UNIT_FACTORS: Record<string, { base: string; factor: number }> = {
  // length → mm
  mm: { base: 'mm', factor: 1 }, cm: { base: 'mm', factor: 10 }, m: { base: 'mm', factor: 1000 },
  in: { base: 'mm', factor: 25.4 }, ft: { base: 'mm', factor: 304.8 }, thou: { base: 'mm', factor: 0.0254 },
  // force → N
  N: { base: 'N', factor: 1 }, kN: { base: 'N', factor: 1000 }, lbf: { base: 'N', factor: 4.4482216 }, kgf: { base: 'N', factor: 9.80665 },
  // pressure/stress → MPa
  MPa: { base: 'MPa', factor: 1 }, kPa: { base: 'MPa', factor: 0.001 }, Pa: { base: 'MPa', factor: 1e-6 },
  GPa: { base: 'MPa', factor: 1000 }, psi: { base: 'MPa', factor: 0.00689476 }, ksi: { base: 'MPa', factor: 6.89476 },
  // torque → Nmm
  Nmm: { base: 'Nmm', factor: 1 }, Nm: { base: 'Nmm', factor: 1000 }, 'lbf-in': { base: 'Nmm', factor: 112.9848 }, 'lbf-ft': { base: 'Nmm', factor: 1355.818 },
  // mass → kg
  kg: { base: 'kg', factor: 1 }, g: { base: 'kg', factor: 0.001 }, lb: { base: 'kg', factor: 0.4535924 }, oz: { base: 'kg', factor: 0.02834952 },
};

export function convertUnit(value: number, from: string, to: string): CalcResult {
  const v = fin(value);
  const f = UNIT_FACTORS[String(from || '').trim()];
  const t = UNIT_FACTORS[String(to || '').trim()];
  if (v === null) return bad('value must be finite');
  if (!f || !t) return bad(`unknown unit — known: ${Object.keys(UNIT_FACTORS).join(', ')}`);
  if (f.base !== t.base) return bad(`cannot convert ${from} (${f.base}) to ${to} (${t.base}) — different dimensions`);
  const result = (v * f.factor) / t.factor;
  return {
    ok: true, quantity: `convert ${from}→${to}`, value: round(result, 9), unit: to,
    formula: `${from}→${f.base}→${to}`, inputs: { value: v, from, to },
  };
}
