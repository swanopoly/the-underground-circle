/**
 * engineeringStressConcentrationCore — STRESS CONCENTRATION (Kt) and NOTCH
 * FATIGUE (Kf). Every real part has geometry: a hole for a bolt, a shoulder to
 * seat a bearing, a keyway, a fillet at a step. Wherever the load path is forced
 * to bend around a feature, the stress crowds up at the feature far above the
 * nominal P/A or Mc/I you would compute from the net section. That local peak is
 * what actually starts a crack, so a static or fatigue check on the nominal
 * stress alone is not a check on the part — it is a check on an idealised part
 * with no features, which does not exist. This core answers two questions in
 * sequence: how much does the geometry AMPLIFY the stress (the theoretical, or
 * geometric, factor Kt), and how much of that amplification does the material
 * actually FEEL in fatigue (the fatigue notch factor Kf ≤ Kt).
 *
 * THE Kt = 3 ANCHOR. The whole subject has one exact, closed-form anchor: an
 * infinite flat plate with a small transverse circular hole, pulled in tension,
 * has a peak stress at the edge of the hole exactly THREE times the far-field
 * stress. This is the Kirsch (1898) elasticity solution — Kt = 3.0 exactly, no
 * chart, no fit. Every other case is measured against it. A finite-width plate
 * has slightly less than 3 on the gross section but the widely-used Heywood/Roark
 * net-section fit Kt = 3 − 3.14(d/w) + 3.667(d/w)² − 1.527(d/w)³ returns to
 * exactly 3 as d/w → 0, recovering Kirsch in the limit. An ELLIPTICAL hole gives
 * Inglis's Kt = 1 + 2(a/b) with a the semi-axis PERPENDICULAR to the load and b
 * parallel; set b = a and the ellipse becomes a circle and Kt = 1 + 2 = 3 — the
 * SAME anchor from a completely different formula, which is the cross-check. As
 * b → 0 the ellipse sharpens to a crack and Kt → ∞ (an infinite-stress crack tip,
 * the doorway to fracture mechanics). Inglis can be written with the tip radius
 * ρ = b²/a as Kt = 1 + 2√(a/ρ); it is algebraically the SAME expression, so
 * computing it both ways and demanding agreement is a genuine self-check.
 *
 * STEPPED SHAFTS — WHERE THE FORMULA RUNS OUT. A shoulder fillet on a stepped
 * shaft has no clean closed form; its Kt is read from published charts (Peterson,
 * reproduced as Shigley's Fig. A-15 series) as a function of r/d and D/d. Rather
 * than pretend a memorised power-law fit is exact, this core does what the ISO-fit
 * table does elsewhere in the suite: it HARD-CODES a digitised table of the
 * published chart values at representative nodes and bilinearly interpolates.
 * The verifiable claims are then honest — the interpolation is exact at every
 * tabulated node, monotonic between them (Kt falls as the fillet r/d grows,
 * rises as the step D/d grows), and correctly ordered by load mode
 * (torsion < tension < bending) — not a false claim of sub-percent chart fidelity.
 *
 * NOTCH FATIGUE — Kf ≤ Kt ALWAYS. Under CYCLIC load a part does not feel the full
 * geometric Kt. The peak stress is confined to a tiny volume at the notch root; if
 * that volume is small compared with the material's characteristic flaw size, a
 * fatigue crack is less likely to find a worst-case grain there than the smooth
 * Kt implies. The NOTCH SENSITIVITY q ∈ [0, 1] captures this, and the effective
 * factor is Kf = 1 + q(Kt − 1). Because q ≤ 1, Kf is ALWAYS between 1 and Kt —
 * this is the load-bearing invariant of the whole idea. Peterson's equation
 * q = 1/(1 + a/r) sets it from the notch root radius r and a material constant a
 * (a length): a BLUNT notch (large r, a/r → 0) gives q → 1 and Kf → Kt (the
 * material feels the full concentration), while a very SHARP notch (small r,
 * a/r → ∞) gives q → 0 and Kf → 1 (the concentration is too localised to matter
 * in fatigue — the counter-intuitive "notch-size effect"). For steels a is
 * estimated from the ultimate strength Su; a hard steel has a tiny a (feels sharp
 * notches), a soft steel a large a (forgives them). Kf then DERATES the endurance
 * limit: the notched part's endurance limit is Se_corrected = Se / Kf, i.e. the
 * alternating stress the smooth-part fatigue analysis sees is amplified by Kf.
 *
 * UNITS. Stresses in MPa (= N/mm²), consistent with the mm/N/MPa system of the
 * calc core. Lengths (d, w, r, a, b, ρ) in mm; ratios and factors are
 * dimensionless. The Peterson constant a is in mm.
 *
 * VERIFICATION PHILOSOPHY. This is analysis, not geometry, so the smoke IS the
 * proof — there is no engine to run. Correctness is pinned two ways: (1) the EXACT
 * anchors — Kirsch Kt = 3, the elliptical circle limit Kt = 3, Inglis at hand
 * ratios — asserted to the last digit; and (2) the INVARIANTS a single point value
 * would hide — Kt → 3 as d/w → 0, Inglis computed two ways agreeing, the table
 * interpolation exact at nodes and monotonic between, and above all Kf ≤ Kt with
 * the correct blunt (Kf → Kt) and sharp (Kf → 1) limits, plus Se_corrected < Se.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-stress-concentration-core-smoketest.ts):
 * the ONLY import is the MATERIALS table from engineeringCalcCore (itself
 * import-free) to estimate Su from a named material; no I/O, no Date.now(),
 * no Math.random(), total functions.
 */

import { MATERIALS } from './engineeringCalcCore';

export type StressConcentrationCoreResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Strictly-positive check — geometry lengths, ratios, and strengths are magnitudes. */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
/** Finite check — a nominal stress may be signed (a compressive far-field is valid). */
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
/** Round to `dp` decimals for display parity (leaves non-finite untouched). */
function r(n: number, dp = 4): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

function materialLookup(name: string | undefined) {
  if (!name) return undefined;
  return MATERIALS[String(name).trim().toLowerCase()];
}

// ─── Finite-width plate with a transverse circular hole (Heywood/Roark) ───────
// Kt on the NET section: Kt = 3 − 3.14(d/w) + 3.667(d/w)² − 1.527(d/w)³.
// Source: Heywood, "Designing by Photoelasticity"; reproduced in Roark's Formulas
// for Stress and Strain and Shigley (Fig. A-15-1 fit). As d/w → 0 it returns to
// the exact Kirsch infinite-plate value 3.0.
function holeNetKt(dOverW: number): number {
  const x = dOverW;
  return 3 - 3.14 * x + 3.667 * x * x - 1.527 * x * x * x;
}

// ─── Stepped round shaft / flat bar with a shoulder fillet ────────────────────
// Kt has no clean closed form here; these are digitised representative values of
// the published Peterson charts (reproduced as Shigley's Figs. A-15-7 axial /
// A-15-8 torsion / A-15-9 bending — round shaft with shoulder fillet), tabulated
// at r/d nodes for two D/d ratios and bilinearly interpolated — exactly the
// hard-code-the-chart approach the ISO-286 fit table uses elsewhere in the suite.
// Rows are sorted ascending by D/d; each row's points sorted ascending by r/d and
// sharing the same r/d columns so interpolation is clean. Physical trends the
// table preserves: Kt FALLS as the fillet r/d grows (blunter), RISES as the step
// D/d grows (sharper transition), and orders torsion < tension < bending.
type ShaftRow = { Dd: number; points: [number, number][] }; // [r/d, Kt]
type ShaftMode = 'tension' | 'bending' | 'torsion';
const SHAFT_KT: Record<ShaftMode, ShaftRow[]> = {
  tension: [
    { Dd: 1.5, points: [[0.02, 2.5], [0.05, 2.0], [0.10, 1.7], [0.15, 1.55], [0.20, 1.45], [0.30, 1.30]] },
    { Dd: 2.0, points: [[0.02, 2.7], [0.05, 2.2], [0.10, 1.8], [0.15, 1.60], [0.20, 1.50], [0.30, 1.35]] },
  ],
  bending: [
    { Dd: 1.5, points: [[0.02, 2.7], [0.05, 2.15], [0.10, 1.8], [0.15, 1.60], [0.20, 1.50], [0.30, 1.38]] },
    { Dd: 2.0, points: [[0.02, 2.9], [0.05, 2.30], [0.10, 1.9], [0.15, 1.70], [0.20, 1.60], [0.30, 1.45]] },
  ],
  torsion: [
    { Dd: 1.5, points: [[0.02, 1.8], [0.05, 1.60], [0.10, 1.45], [0.15, 1.35], [0.20, 1.30], [0.30, 1.22]] },
    { Dd: 2.0, points: [[0.02, 1.9], [0.05, 1.70], [0.10, 1.50], [0.15, 1.40], [0.20, 1.35], [0.30, 1.25]] },
  ],
};

/** 1-D linear interpolation on ascending (x,y) nodes, clamping outside the range. */
function interp1(points: [number, number][], x: number): { y: number; clamped: boolean } {
  const first = points[0], last = points[points.length - 1];
  if (x <= first[0]) return { y: first[1], clamped: x < first[0] };
  if (x >= last[0]) return { y: last[1], clamped: x > last[0] };
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i], [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return { y: y0 + t * (y1 - y0), clamped: false };
    }
  }
  return { y: last[1], clamped: true };
}

/** Bilinear interpolation of the shaft Kt table over (D/d, r/d), clamping edges. */
function shaftKt(mode: ShaftMode, Dd: number, rd: number): { Kt: number; clamped: boolean } {
  const rows = SHAFT_KT[mode];
  const lo = rows[0], hi = rows[rows.length - 1];
  let clamped = false;
  // Bracket by D/d.
  if (Dd <= lo.Dd || Dd >= hi.Dd) {
    const row = Dd <= lo.Dd ? lo : hi;
    if (Dd < lo.Dd || Dd > hi.Dd) clamped = true;
    const a = interp1(row.points, rd);
    return { Kt: a.y, clamped: clamped || a.clamped };
  }
  let r0 = rows[0], r1 = rows[rows.length - 1];
  for (let i = 0; i < rows.length - 1; i++) {
    if (Dd >= rows[i].Dd && Dd <= rows[i + 1].Dd) { r0 = rows[i]; r1 = rows[i + 1]; break; }
  }
  const a0 = interp1(r0.points, rd);
  const a1 = interp1(r1.points, rd);
  const t = (Dd - r0.Dd) / (r1.Dd - r0.Dd);
  return { Kt: a0.y + t * (a1.y - a0.y), clamped: a0.clamped || a1.clamped };
}

// ─── Geometric stress-concentration factor Kt ─────────────────────────────────

export type StressConcentrationResult = {
  geometry: 'hole_in_plate' | 'elliptical_hole' | 'stepped_shaft';
  Kt: number;                 // theoretical (geometric) stress-concentration factor
  nominalBasis: 'net' | 'gross'; // section the nominal stress is referenced to
  ratio: number | null;       // d/w (hole), a/b (ellipse), or r/d (shaft)
  DdRatio: number | null;     // D/d (stepped shaft only)
  loadMode: ShaftMode | null; // stepped shaft only
  tipRadius_mm: number | null;   // elliptical hole: ρ = b²/a
  KtFromRadius: number | null;   // elliptical hole self-check: 1 + 2√(a/ρ) (== Kt)
  nominalStress_MPa: number | null; // echoed if supplied
  peakStress_MPa: number | null;    // σ_max = Kt·σ_nom, if σ_nom supplied
  clampedToTable: boolean;    // stepped shaft: an input fell outside the chart range
  notes: string[];
};

/**
 * Geometric stress-concentration factor Kt for a feature under load. Choose a
 * `geometry`:
 *
 *  • 'hole_in_plate' — transverse circular hole in a plate under tension. Supply
 *    hole `diameter` d and plate `width` w (mm) for the finite-width Heywood/Roark
 *    NET-section fit; omit `width` (or pass d/w = 0) for the exact Kirsch infinite
 *    plate Kt = 3.0. Nominal basis is the NET section.
 *
 *  • 'elliptical_hole' — Inglis Kt = 1 + 2(a/b) with `a` the semi-axis
 *    PERPENDICULAR to the load and `b` parallel (mm). Alternatively give `a` and
 *    the root `tipRadius` ρ (then b = √(a·ρ)). Reports ρ = b²/a and the identical
 *    Kt = 1 + 2√(a/ρ) as a self-check. b = a → circle → Kt = 3.
 *
 *  • 'stepped_shaft' — shoulder fillet on a stepped round shaft (or bar). Give
 *    diameters `D` (large) and `d` (small) and fillet `r` (mm), or the ratios
 *    `DdRatio` = D/d and `rrd` = r/d directly, plus a `mode` (tension | bending |
 *    torsion, default bending). Kt is bilinearly interpolated from the digitised
 *    Peterson chart table; inputs outside the tabulated range are clamped and
 *    flagged. Nominal basis is the NET (small-diameter) section.
 *
 * If a `nominalStress` (MPa, signed) is supplied, also returns the peak local
 * stress σ_max = Kt·σ_nom on the stated nominal basis.
 */
export function stressConcentration(args: {
  geometry?: string;
  // hole_in_plate
  diameter?: number; width?: number;
  // elliptical_hole
  a?: number; b?: number; tipRadius?: number;
  // stepped_shaft
  D?: number; d?: number; r?: number; DdRatio?: number; rrd?: number; mode?: string;
  // common
  nominalStress?: number;
}): StressConcentrationCoreResult<StressConcentrationResult> {
  const geometry = String(args?.geometry ?? '').trim().toLowerCase();
  const notes: string[] = [];

  // Optional nominal stress (signed).
  let nominalStress: number | null = null;
  if (args?.nominalStress !== undefined) {
    const s = fin(args.nominalStress);
    if (s === null) return { ok: false, error: 'nominalStress must be a finite number (MPa, signed)' };
    nominalStress = s;
  }

  let Kt: number;
  let nominalBasis: 'net' | 'gross' = 'net';
  let ratio: number | null = null;
  let DdRatio: number | null = null;
  let loadMode: ShaftMode | null = null;
  let tipRadius: number | null = null;
  let KtFromRadius: number | null = null;
  let clampedToTable = false;

  if (geometry === 'hole_in_plate' || geometry === 'hole') {
    const d = args?.diameter !== undefined ? pos(args.diameter) : null;
    const w = args?.width !== undefined ? pos(args.width) : null;
    if (args?.diameter !== undefined && d === null) return { ok: false, error: 'hole_in_plate: diameter must be a positive number (mm)' };
    if (args?.width !== undefined && w === null) return { ok: false, error: 'hole_in_plate: width must be a positive number (mm)' };
    if (d !== null && w !== null) {
      if (d >= w) return { ok: false, error: 'hole_in_plate: hole diameter must be smaller than plate width' };
      ratio = d / w;
      Kt = holeNetKt(ratio);
      notes.push('Finite-width Heywood/Roark fit, Kt on the NET section (σ_net = σ_gross·w/(w−d)).');
    } else {
      // Infinite plate — the exact Kirsch anchor.
      ratio = 0;
      Kt = 3;
      nominalBasis = 'gross';
      notes.push('Infinite plate (no width given): exact Kirsch solution Kt = 3.0.');
    }
  } else if (geometry === 'elliptical_hole' || geometry === 'ellipse') {
    const a = args?.a !== undefined ? pos(args.a) : null;
    if (a === null) return { ok: false, error: 'elliptical_hole: semi-axis a (perpendicular to load, mm) must be a positive number' };
    let b: number | null = args?.b !== undefined ? pos(args.b) : null;
    if (args?.b !== undefined && b === null) return { ok: false, error: 'elliptical_hole: semi-axis b (parallel to load, mm) must be a positive number' };
    if (b === null && args?.tipRadius !== undefined) {
      const rho = pos(args.tipRadius);
      if (rho === null) return { ok: false, error: 'elliptical_hole: tipRadius ρ must be a positive number (mm)' };
      b = Math.sqrt(a * rho); // ρ = b²/a  ⇒  b = √(a·ρ)
    }
    if (b === null) return { ok: false, error: 'elliptical_hole needs semi-axis b (parallel to load) or the root tipRadius ρ' };
    ratio = a / b;
    Kt = 1 + 2 * (a / b);            // Inglis
    tipRadius = (b * b) / a;         // ρ = b²/a
    KtFromRadius = 1 + 2 * Math.sqrt(a / tipRadius); // identical form via ρ (self-check)
    nominalBasis = 'gross';
    notes.push('Inglis Kt = 1 + 2(a/b); b = a recovers the circle (Kt = 3). As b → 0 the ellipse sharpens toward a crack (Kt → ∞).');
  } else if (geometry === 'stepped_shaft' || geometry === 'stepped_bar' || geometry === 'shoulder_fillet' || geometry === 'fillet') {
    const modeKey = String(args?.mode ?? 'bending').trim().toLowerCase();
    if (modeKey !== 'tension' && modeKey !== 'bending' && modeKey !== 'torsion') {
      return { ok: false, error: `stepped_shaft: unknown mode "${args?.mode}" — use tension, bending, or torsion` };
    }
    loadMode = modeKey as ShaftMode;
    // Resolve D/d and r/d from either the dimensions or the ratios.
    let Dd: number | null = args?.DdRatio !== undefined ? pos(args.DdRatio) : null;
    let rd: number | null = args?.rrd !== undefined ? pos(args.rrd) : null;
    if (Dd === null) {
      const D = args?.D !== undefined ? pos(args.D) : null;
      const dd = args?.d !== undefined ? pos(args.d) : null;
      if (D !== null && dd !== null) {
        if (D <= dd) return { ok: false, error: 'stepped_shaft: large diameter D must exceed small diameter d' };
        Dd = D / dd;
        if (rd === null && args?.r !== undefined) { const rr = pos(args.r); if (rr === null) return { ok: false, error: 'stepped_shaft: fillet radius r must be positive (mm)' }; rd = rr / dd; }
      }
    }
    if (Dd === null) return { ok: false, error: 'stepped_shaft needs D and d (mm), or DdRatio = D/d' };
    if (rd === null) return { ok: false, error: 'stepped_shaft needs fillet r (mm) with d, or rrd = r/d' };
    if (Dd <= 1) return { ok: false, error: 'stepped_shaft: D/d must be greater than 1' };
    const res = shaftKt(loadMode, Dd, rd);
    Kt = res.Kt;
    DdRatio = Dd;
    ratio = rd;
    clampedToTable = res.clamped;
    if (clampedToTable) notes.push('An input fell outside the tabulated chart range (D/d ∈ [1.5, 2.0], r/d ∈ [0.02, 0.30]) and was clamped to the nearest node — treat Kt as approximate.');
    notes.push(`Peterson/Shigley A-15 ${loadMode} chart, bilinear interpolation; Kt on the NET (small-diameter) section.`);
  } else {
    return { ok: false, error: `unknown geometry "${args?.geometry}" — use hole_in_plate, elliptical_hole, or stepped_shaft` };
  }

  const peakStress = nominalStress !== null ? Kt * nominalStress : null;
  if (peakStress !== null) notes.push(`Peak local stress σ_max = Kt·σ_nom = ${r(peakStress, 3)} MPa (${nominalBasis}-section nominal).`);

  return {
    ok: true,
    value: {
      geometry: (geometry === 'hole' ? 'hole_in_plate' : geometry === 'ellipse' ? 'elliptical_hole' : (geometry.startsWith('stepped') || geometry === 'shoulder_fillet' || geometry === 'fillet') ? 'stepped_shaft' : geometry) as StressConcentrationResult['geometry'],
      Kt: r(Kt, 4),
      nominalBasis,
      ratio: ratio !== null ? r(ratio, 6) : null,
      DdRatio: DdRatio !== null ? r(DdRatio, 6) : null,
      loadMode,
      tipRadius_mm: tipRadius !== null ? r(tipRadius, 6) : null,
      KtFromRadius: KtFromRadius !== null ? r(KtFromRadius, 4) : null,
      nominalStress_MPa: nominalStress !== null ? r(nominalStress, 4) : null,
      peakStress_MPa: peakStress !== null ? r(peakStress, 4) : null,
      clampedToTable,
      notes,
    },
  };
}

// ─── Notch fatigue: sensitivity q, factor Kf, corrected endurance limit ───────

/**
 * Peterson material constant a (mm) for steels, estimated from the ultimate
 * strength Su (MPa). Shigley's published relation is a = 0.001·(300/Su[ksi])^1.8
 * inches; converting (300 ksi ≈ 2070 MPa, 0.001 in ≈ 0.0254 mm ≈ 0.025 mm) gives
 * a[mm] = 0.025·(2070/Su[MPa])^1.8. (NOTE: the power applies to (2070/Su) only —
 * the 0.025 is the leading length constant, not inside the exponent — so a soft
 * steel Su≈400 MPa gives a≈0.48 mm and a hard steel Su≈2070 MPa gives a≈0.025 mm,
 * the physically correct range. A hard steel's tiny a means it feels sharp
 * notches fully.)
 */
function petersonConstantFromSu(Su: number): number {
  return 0.025 * Math.pow(2070 / Su, 1.8);
}

export type NotchFatigueResult = {
  q: number;                    // notch sensitivity ∈ [0, 1]
  Kf: number;                   // fatigue notch factor = 1 + q(Kt − 1), 1 ≤ Kf ≤ Kt
  Kt: number;                   // echoed geometric factor
  notchRadius_mm: number;       // r
  petersonConstant_mm: number;  // a
  aEstimated: boolean;          // a estimated from Su rather than supplied
  Su_MPa: number | null;        // ultimate strength, if used to estimate a
  Se_MPa: number | null;        // input endurance limit
  Se_corrected_MPa: number | null; // Se / Kf (notch-derated endurance limit)
  notes: string[];
};

/**
 * Fatigue notch factor Kf and the notch-derated endurance limit. From the
 * geometric `Kt`, the notch root radius `notchRadius` r (mm), and a material
 * length constant, Peterson's notch sensitivity is q = 1/(1 + a/r) and the
 * fatigue factor Kf = 1 + q(Kt − 1). Because q ∈ [0, 1], Kf is ALWAYS between 1
 * and Kt: a blunt notch (large r) approaches Kf = Kt, a very sharp notch
 * (small r) approaches Kf = 1.
 *
 * Supply the Peterson constant `a` (mm) directly, or an `ultimate` Su (MPa) or a
 * `material` name to ESTIMATE it (a = 0.025·(2070/Su)^1.8 mm; a material's Su is
 * taken as 1.7·yield, matching the fatigue core — both are flagged as estimates).
 * If an endurance limit `endurance` / `Se` (MPa) is supplied, also returns
 * Se_corrected = Se / Kf, the endurance limit of the NOTCHED part.
 */
export function notchFatigue(args: {
  Kt?: number;
  notchRadius?: number; r?: number;
  a?: number;
  ultimate?: number; material?: string;
  endurance?: number; Se?: number; endurance_limit_MPa?: number;
}): StressConcentrationCoreResult<NotchFatigueResult> {
  const Kt = args?.Kt !== undefined ? pos(args.Kt) : null;
  if (Kt === null) return { ok: false, error: 'notchFatigue needs a positive geometric factor Kt' };
  if (Kt < 1) return { ok: false, error: 'Kt must be ≥ 1 (a concentration factor cannot reduce stress below nominal)' };

  const rad = args?.notchRadius !== undefined ? pos(args.notchRadius) : (args?.r !== undefined ? pos(args.r) : null);
  if (rad === null) return { ok: false, error: 'notchFatigue needs a positive notch root radius (notchRadius, mm)' };

  const notes: string[] = [];

  // Peterson constant a: explicit, else estimated from Su (input or material).
  let a: number | null = args?.a !== undefined ? pos(args.a) : null;
  if (args?.a !== undefined && a === null) return { ok: false, error: 'notchFatigue: Peterson constant a must be a positive number (mm)' };
  let Su: number | null = null;
  let aEstimated = false;
  if (a === null) {
    Su = args?.ultimate !== undefined ? pos(args.ultimate) : null;
    if (args?.ultimate !== undefined && Su === null) return { ok: false, error: 'notchFatigue: ultimate strength Su must be a positive number (MPa)' };
    if (Su === null) {
      const mat = materialLookup(args?.material);
      if (mat) { Su = 1.7 * mat.yield; notes.push(`Su estimated as 1.7·yield = ${r(Su)} MPa for ${mat.name} (rough — supply a measured ultimate for accuracy).`); }
    }
    if (Su === null) return { ok: false, error: 'notchFatigue needs a Peterson constant a (mm), an ultimate Su (MPa), or a material to estimate it' };
    a = petersonConstantFromSu(Su);
    aEstimated = true;
    notes.push(`Peterson constant a estimated as 0.025·(2070/Su)^1.8 = ${r(a, 4)} mm from Su = ${r(Su)} MPa (steel correlation).`);
  }

  const q = 1 / (1 + a / rad);          // Peterson notch sensitivity
  const Kf = 1 + q * (Kt - 1);          // fatigue notch factor

  // Optional endurance limit → notch-derated Se.
  const SeRaw = args?.endurance ?? args?.Se ?? args?.endurance_limit_MPa;
  let Se: number | null = null;
  let SeCorrected: number | null = null;
  if (SeRaw !== undefined) {
    Se = pos(SeRaw);
    if (Se === null) return { ok: false, error: 'notchFatigue: endurance limit Se must be a positive number (MPa)' };
    SeCorrected = Se / Kf;
    notes.push(`Notched endurance limit Se_corrected = Se/Kf = ${r(SeCorrected, 3)} MPa (< Se = ${r(Se)} MPa).`);
  }

  notes.push(`q = 1/(1 + a/r) = ${r(q, 4)}; Kf = 1 + q(Kt−1) = ${r(Kf, 4)} (bounded 1 ≤ Kf ≤ Kt = ${r(Kt, 4)}).`);

  return {
    ok: true,
    value: {
      q: r(q, 4),
      Kf: r(Kf, 4),
      Kt: r(Kt, 4),
      notchRadius_mm: r(rad, 4),
      petersonConstant_mm: r(a, 4),
      aEstimated,
      Su_MPa: Su !== null ? r(Su, 4) : null,
      Se_MPa: Se !== null ? r(Se, 4) : null,
      Se_corrected_MPa: SeCorrected !== null ? r(SeCorrected, 4) : null,
      notes,
    },
  };
}
