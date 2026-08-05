/**
 * engineeringCylinderCore — HYDRAULIC / PNEUMATIC CYLINDERS, the fluid-power
 * ACTUATOR arm of the analysis suite. The pipe-hydraulics core pushes a fluid
 * through a conduit; this core turns that fluid's PRESSURE and FLOW into
 * mechanical work: the push/pull force a cylinder develops, how fast its rod
 * travels, and whether the extended rod buckles as a column. It is the bridge
 * from a hydraulic power unit's pressure/flow to a machine's motion and load.
 *
 * THE ONE UNIT TRICK THAT MAKES THIS CLEAN. Fluid power is quoted in bar and
 * L/min, which is exactly where the scale bugs live — so, like the rest of the
 * suite, this core works in the self-consistent millimetre / newton / MEGAPASCAL
 * set and converts only at the boundary. The payoff is a single identity:
 *
 *   1 MPa = 1 N/mm²,  so  force = pressure · area = (N/mm²)·mm² = N, factor-free.
 *
 * A 50 mm bore at 10 MPa gives 10·π·25² = 19,635 N with no conversion constant.
 * Pressure arrives as MPa (or `pressure_bar`, since 1 bar = 0.1 MPa → divide by
 * 10); flow arrives as L/min and converts to mm³/s (×1e6/60); speed then comes
 * out in mm/s straight from (mm³/s)/mm².
 *
 * THE PHYSICS, TEXTBOOK-EXACT.
 *   piston area     A_p = π·(bore/2)²                    (full face — extend)
 *   annulus area    A_a = π·(bore² − rod²)/4             (rod side — retract)
 *   extend force    F_ext = p·A_p                        (N)
 *   retract force   F_ret = p·A_a  <  F_ext              (less area ⇒ weaker)
 *   area ratio      φ   = A_p/A_a  (regeneration / speed / force ratio)
 *   extend speed    v_ext = Q/A_p                        (mm/s)
 *   retract speed   v_ret = Q/A_a  >  v_ext              (less area ⇒ faster)
 *   rod buckling    I = π·d⁴/64,  Pcr = π²·E·I/(K·L)²    (Euler, extended rod)
 *
 * WHY RETRACT IS FASTER BUT WEAKER — AND THE INVARIANT THAT PROVES IT. The rod
 * steals area from the piston's rod-side face, so the annulus is smaller than the
 * full piston. Smaller area at the same pressure ⇒ less force (retract is
 * weaker); smaller area at the same flow ⇒ more speed (retract is faster). The
 * SAME ratio φ = A_p/A_a governs both — F_ext/F_ret = v_ret/v_ext = φ — and the
 * product is conserved: F·v = (p·A)·(Q/A) = p·Q on BOTH strokes, i.e. hydraulic
 * power is p·Q regardless of direction. The smoke asserts that power equality as
 * an independent cross-check that links the force lane to the speed lane.
 *
 * ROD BUCKLING. A fully-extended cylinder rod is a slender column in
 * compression, so it is checked with Euler — Pcr = π²·E·I/(K·L)², I = π·d⁴/64,
 * with the exposed rod length as the column length. This mirrors
 * engineering.calc `column_buckling`; it is reimplemented locally in a few lines
 * so this core stays self-contained.
 *
 * Every function returns a structured result — the numbers plus the areas and
 * ratios they came from — so an agent can show its work instead of asserting a
 * bare force.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-cylinder-core-smoketest.ts):
 * self-contained, no imports, no I/O.
 */

export type CylinderResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 4): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** Resolve pressure to MPa: prefer explicit MPa, else `pressure_bar` (1 bar = 0.1 MPa). */
function resolvePressureMPa(spec: { pressure?: number; pressure_bar?: number }): number | null {
  if (spec.pressure !== undefined) return pos(spec.pressure);
  if (spec.pressure_bar !== undefined) { const b = pos(spec.pressure_bar); return b === null ? null : b / 10; }
  return null;
}

// ─── Force (force = pressure · area) ─────────────────────────────────────────

export type CylinderForceSpec = {
  bore: number; // mm
  pressure?: number; // MPa (= bar/10)
  pressure_bar?: number; // bar (alternative to pressure)
  rodDiameter?: number; // mm — enables the retract (annulus) side
};

export type CylinderForceResult = {
  bore_mm: number;
  rodDiameter_mm: number | null;
  pressure_MPa: number;
  pistonArea_mm2: number;
  annulusArea_mm2: number | null;
  rodArea_mm2: number | null;
  extendForce_N: number;
  retractForce_N: number | null;
  /** A_piston / A_annulus — the regeneration ratio; also F_ext/F_ret and v_ret/v_ext. */
  areaRatio: number | null;
};

/**
 * Extend force = p·A_piston and (given a rod) retract force = p·A_annulus. In the
 * mm/N/MPa system force comes out directly in newtons. Extend always exceeds
 * retract because the annulus is the piston face minus the rod's cross-section.
 */
export function cylinderForce(spec: CylinderForceSpec): CylinderResult<CylinderForceResult> {
  const bore = pos(spec.bore);
  if (bore === null) return { ok: false, error: 'cylinder force needs a positive bore (mm)' };
  const p = resolvePressureMPa(spec);
  if (p === null) return { ok: false, error: 'cylinder force needs a positive pressure (MPa) or pressure_bar (bar)' };

  const pistonArea = Math.PI * (bore / 2) ** 2;
  const extendForce = p * pistonArea;

  let rod: number | null = null;
  let annulusArea: number | null = null;
  let rodArea: number | null = null;
  let retractForce: number | null = null;
  let areaRatio: number | null = null;
  if (spec.rodDiameter !== undefined) {
    rod = pos(spec.rodDiameter);
    if (rod === null) return { ok: false, error: 'rodDiameter must be positive (mm)' };
    if (rod >= bore) return { ok: false, error: 'rod diameter must be smaller than the bore' };
    rodArea = Math.PI * (rod / 2) ** 2;
    annulusArea = (Math.PI * (bore ** 2 - rod ** 2)) / 4;
    retractForce = p * annulusArea;
    areaRatio = pistonArea / annulusArea;
  }

  return {
    ok: true,
    value: {
      bore_mm: bore,
      rodDiameter_mm: rod,
      pressure_MPa: r(p, 6),
      pistonArea_mm2: r(pistonArea, 4),
      annulusArea_mm2: annulusArea === null ? null : r(annulusArea, 4),
      rodArea_mm2: rodArea === null ? null : r(rodArea, 4),
      extendForce_N: r(extendForce, 3),
      retractForce_N: retractForce === null ? null : r(retractForce, 3),
      areaRatio: areaRatio === null ? null : r(areaRatio, 6),
    },
  };
}

// ─── Speed (speed = flow / area) ─────────────────────────────────────────────

export type CylinderSpeedSpec = {
  bore: number; // mm
  rodDiameter?: number; // mm — enables the retract (annulus) side
  flowRate: number; // L/min
  stroke?: number; // mm — enables stroke times
};

export type CylinderSpeedResult = {
  bore_mm: number;
  rodDiameter_mm: number | null;
  flowRate_L_min: number;
  flowRate_mm3_s: number;
  pistonArea_mm2: number;
  annulusArea_mm2: number | null;
  extendSpeed_mm_s: number;
  retractSpeed_mm_s: number | null;
  stroke_mm: number | null;
  extendTime_s: number | null;
  retractTime_s: number | null;
  /** v_retract / v_extend = A_piston / A_annulus (retract is faster). */
  speedRatio: number | null;
};

/**
 * Rod speed = pump flow / area. Extend fills the full piston (A_piston, slower);
 * retract fills only the annulus (A_annulus, faster) for the same flow. Stroke,
 * if given, yields the extend/retract travel times.
 */
export function cylinderSpeed(spec: CylinderSpeedSpec): CylinderResult<CylinderSpeedResult> {
  const bore = pos(spec.bore);
  if (bore === null) return { ok: false, error: 'cylinder speed needs a positive bore (mm)' };
  const flow = pos(spec.flowRate);
  if (flow === null) return { ok: false, error: 'cylinder speed needs a positive flowRate (L/min)' };

  const Q = (flow * 1e6) / 60; // L/min → mm³/s
  const pistonArea = Math.PI * (bore / 2) ** 2;
  const extendSpeed = Q / pistonArea;

  let rod: number | null = null;
  let annulusArea: number | null = null;
  let retractSpeed: number | null = null;
  let speedRatio: number | null = null;
  if (spec.rodDiameter !== undefined) {
    rod = pos(spec.rodDiameter);
    if (rod === null) return { ok: false, error: 'rodDiameter must be positive (mm)' };
    if (rod >= bore) return { ok: false, error: 'rod diameter must be smaller than the bore' };
    annulusArea = (Math.PI * (bore ** 2 - rod ** 2)) / 4;
    retractSpeed = Q / annulusArea;
    speedRatio = retractSpeed / extendSpeed;
  }

  let stroke: number | null = null;
  let extendTime: number | null = null;
  let retractTime: number | null = null;
  if (spec.stroke !== undefined) {
    stroke = pos(spec.stroke);
    if (stroke === null) return { ok: false, error: 'stroke must be positive (mm)' };
    extendTime = stroke / extendSpeed;
    if (retractSpeed !== null) retractTime = stroke / retractSpeed;
  }

  return {
    ok: true,
    value: {
      bore_mm: bore,
      rodDiameter_mm: rod,
      flowRate_L_min: flow,
      flowRate_mm3_s: r(Q, 4),
      pistonArea_mm2: r(pistonArea, 4),
      annulusArea_mm2: annulusArea === null ? null : r(annulusArea, 4),
      extendSpeed_mm_s: r(extendSpeed, 5),
      retractSpeed_mm_s: retractSpeed === null ? null : r(retractSpeed, 5),
      stroke_mm: stroke,
      extendTime_s: extendTime === null ? null : r(extendTime, 5),
      retractTime_s: retractTime === null ? null : r(retractTime, 5),
      speedRatio: speedRatio === null ? null : r(speedRatio, 6),
    },
  };
}

// ─── Rod buckling (Euler — mirrors engineering.calc column_buckling) ──────────

/** End-condition effective-length factors K (theoretical), mirroring the calc core. */
const ROD_END_K: Record<string, number> = {
  pinned_pinned: 1.0, pinned: 1.0,
  fixed_free: 2.0, cantilever: 2.0,
  fixed_fixed: 0.5, fixed: 0.5,
  fixed_pinned: 0.699, propped: 0.699,
};

/** A small local Young's-modulus table (MPa) so the core stays self-contained. */
const ROD_MATERIAL_E: Record<string, number> = {
  steel: 200_000, stainless: 193_000, aluminum: 69_000, titanium: 114_000, brass: 97_000,
};

export type RodBucklingSpec = {
  rodDiameter: number; // mm
  strokeLength: number; // mm — the exposed (unsupported) rod length when extended
  load: number; // N — the compressive load the rod carries
  endCondition?: string; // default pinned_pinned
  E?: number; // MPa (overrides material)
  material?: string; // steel (default) | stainless | aluminum | titanium | brass
};

export type RodBucklingResult = {
  rodDiameter_mm: number;
  length_mm: number;
  momentOfInertia_mm4: number;
  endCondition: string;
  K: number;
  effectiveLength_mm: number;
  E_MPa: number;
  criticalLoad_N: number;
  criticalLoad_kN: number;
  load_N: number;
  /** Pcr / load. < 1 means the extended rod is predicted to buckle. */
  safetyFactor: number;
};

/**
 * Euler critical buckling load of the extended rod treated as a slender column:
 * Pcr = π²·E·I/(K·L)², I = π·d⁴/64. Returns Pcr and the safety factor against the
 * applied compressive load. Defaults to a steel rod (E = 200 GPa) and pinned–pinned
 * ends when neither is specified.
 */
export function rodBuckling(spec: RodBucklingSpec): CylinderResult<RodBucklingResult> {
  const d = pos(spec.rodDiameter), L = pos(spec.strokeLength), P = pos(spec.load);
  if (d === null || L === null || P === null) return { ok: false, error: 'rod buckling needs positive rodDiameter (mm), strokeLength (mm), and load (N)' };

  let E: number | null = spec.E !== undefined ? pos(spec.E) : null;
  if (E === null && spec.material !== undefined) {
    const e = ROD_MATERIAL_E[String(spec.material).trim().toLowerCase()];
    if (e === undefined) return { ok: false, error: `unknown material "${spec.material}" — use ${Object.keys(ROD_MATERIAL_E).join(', ')} or an explicit E (MPa)` };
    E = e;
  }
  if (E === null) E = ROD_MATERIAL_E.steel; // a cylinder rod is steel unless told otherwise

  const endKey = String(spec.endCondition || 'pinned_pinned').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const K = ROD_END_K[endKey];
  if (K === undefined) return { ok: false, error: `unknown endCondition — use ${Object.keys(ROD_END_K).join(', ')}` };

  const I = (Math.PI * d ** 4) / 64;
  const Le = K * L;
  const Pcr = (Math.PI ** 2 * E * I) / (Le ** 2);
  const sf = Pcr / P;

  return {
    ok: true,
    value: {
      rodDiameter_mm: d,
      length_mm: L,
      momentOfInertia_mm4: r(I, 4),
      endCondition: endKey,
      K,
      effectiveLength_mm: r(Le, 4),
      E_MPa: E,
      criticalLoad_N: r(Pcr, 3),
      criticalLoad_kN: r(Pcr / 1000, 5),
      load_N: P,
      safetyFactor: r(sf, 4),
    },
  };
}
