/**
 * engineeringToleranceCore — MANUFACTURING TOLERANCES: ISO 286 limits & fits and
 * dimensional stack-up. A drawing dimension is only useful with a tolerance, and
 * a shaft/hole pair only assembles if their fit is right — so this closes the
 * loop from the drafting dimension lane to a manufacturable, checkable part.
 *
 * ISO 286 grades come from the PUBLISHED IT TABLE (IT5–IT11 × the 13 standard
 * size ranges), because the standard rounds the tolerance-unit formula to
 * preferred numbers rather than to whole microns — so a hard-coded table is the
 * unambiguous source of truth (e.g. IT7 is 15 µm at Ø10 but the raw 16·i rounds
 * to 14). The fundamental deviations of the common shaft letters, by contrast,
 * DO have exact closed forms that match the table (h: 0; g: −2.5·D^0.34;
 * f: −5.5·D^0.41; k: +0.6·∛D over the range mean). Together they land on the book
 * values: Ø50 gets IT7 = 25 µm, an H7 hole 0/+25 µm, a g6 shaft −9/−25 µm, and an
 * H7/g6 fit a 9–50 µm clearance; Ø10 g6 is −5/−14. The smoke pins these against
 * the standard table at several sizes.
 *
 * The tolerance stack-up is worst-case (arithmetic sum of tolerances — a
 * guarantee) alongside statistical RSS (√Σtol² — the realistic spread when the
 * contributors are independent and roughly normal). Reporting both, and the
 * largest contributor, is the honest answer: worst-case never fails but is
 * pessimistic; RSS is tighter but is a probability, not a guarantee.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-tolerance-core-smoketest.ts):
 * self-contained, no imports, no I/O.
 */

export type ToleranceResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r4(n: number): number { return Math.round(n * 1e4) / 1e4; }

// ─── ISO 286 size ranges and the standard tolerance unit ─────────────────────

const SIZE_RANGES: Array<[number, number]> = [
  [0, 3], [3, 6], [6, 10], [10, 18], [18, 30], [30, 50], [50, 80], [80, 120],
  [120, 180], [180, 250], [250, 315], [315, 400], [400, 500],
];

/** The geometric mean of the ISO size range containing `D` (mm). */
export function sizeRangeGeoMean(D: number): number | null {
  const d = pos(D);
  if (d === null || d > 500) return null;
  for (const [lo, hi] of SIZE_RANGES) {
    if (d > lo && d <= hi) return Math.sqrt(Math.max(lo, 1) * hi);
  }
  return d <= 3 ? Math.sqrt(1 * 3) : null;
}

/** Standard tolerance unit i (µm): i = 0.45·∛D + 0.001·D over the range mean.
 *  Informational — the published IT table (below) is the source of truth. */
export function standardToleranceUnit(D: number): number | null {
  const Dm = sizeRangeGeoMean(D);
  if (Dm === null) return null;
  return 0.45 * Math.cbrt(Dm) + 0.001 * Dm;
}

/** Published ISO 286-1 IT grade tolerances (µm), rows aligned to SIZE_RANGES,
 *  columns IT5…IT11. The standard's preferred-number rounding, exactly. */
const IT_TABLE: number[][] = [
  //IT5 IT6 IT7 IT8 IT9  IT10 IT11
  [4, 6, 10, 14, 25, 40, 60],       // 0–3
  [5, 8, 12, 18, 30, 48, 75],       // 3–6
  [6, 9, 15, 22, 36, 58, 90],       // 6–10
  [8, 11, 18, 27, 43, 70, 110],     // 10–18
  [9, 13, 21, 33, 52, 84, 130],     // 18–30
  [11, 16, 25, 39, 62, 100, 160],   // 30–50
  [13, 19, 30, 46, 74, 120, 190],   // 50–80
  [15, 22, 35, 54, 87, 140, 220],   // 80–120
  [18, 25, 40, 63, 100, 160, 250],  // 120–180
  [20, 29, 46, 72, 115, 185, 290],  // 180–250
  [23, 32, 52, 81, 130, 210, 320],  // 250–315
  [25, 36, 57, 89, 140, 230, 360],  // 315–400
  [27, 40, 63, 97, 155, 250, 400],  // 400–500
];

/** IT-grade tolerance WIDTH in microns from the published table (IT5–IT11). */
export function itToleranceMicrons(D: number, grade: number): number | null {
  const d = pos(D);
  const g = Math.trunc(grade);
  if (d === null || d > 500 || g < 5 || g > 11) return null;
  let rowIndex = -1;
  for (let k = 0; k < SIZE_RANGES.length; k += 1) {
    const [lo, hi] = SIZE_RANGES[k];
    if (d > lo && d <= hi) { rowIndex = k; break; }
  }
  if (rowIndex < 0 && d <= 3) rowIndex = 0;
  if (rowIndex < 0) return null;
  return IT_TABLE[rowIndex][g - 5];
}

// ─── Fundamental deviations (µm) for the common hole/shaft letters ───────────

function parseTol(spec: string): { letter: string; grade: number } | null {
  const m = String(spec).trim().match(/^([A-Za-z]+)\s*(\d{1,2})$/);
  if (!m) return null;
  return { letter: m[1], grade: Number(m[2]) };
}

/** Hole deviations {ES upper, EI lower} in µm. Supports the H (basic hole) letter. */
export function holeDeviations(spec: string, D: number): ToleranceResult<{ ES: number; EI: number; grade: number; letter: string }> {
  const p = parseTol(spec);
  if (!p) return { ok: false, error: `hole spec must be like "H7" (got "${spec}")` };
  const it = itToleranceMicrons(D, p.grade);
  if (it === null) return { ok: false, error: `no IT${p.grade} tolerance for Ø${D} (supported: IT5–IT11, D ≤ 500)` };
  if (p.letter === 'H') return { ok: true, value: { ES: it, EI: 0, grade: p.grade, letter: 'H' } };
  return { ok: false, error: `hole letter "${p.letter}" not supported — use H (basic-hole system)` };
}

/** Shaft deviations {es upper, ei lower} in µm. Supports h, g, f (clearance) and k (transition). */
export function shaftDeviations(spec: string, D: number): ToleranceResult<{ es: number; ei: number; grade: number; letter: string }> {
  const p = parseTol(spec);
  if (!p) return { ok: false, error: `shaft spec must be like "g6" (got "${spec}")` };
  const it = itToleranceMicrons(D, p.grade);
  const Dm = sizeRangeGeoMean(D);
  if (it === null || Dm === null) return { ok: false, error: `no IT${p.grade} tolerance for Ø${D}` };
  const L = p.letter;
  if (L === 'h') { const es = 0; return { ok: true, value: { es, ei: es - it, grade: p.grade, letter: L } }; }
  if (L === 'g') { const es = -Math.round(2.5 * Math.pow(Dm, 0.34)); return { ok: true, value: { es, ei: es - it, grade: p.grade, letter: L } }; }
  if (L === 'f') { const es = -Math.round(5.5 * Math.pow(Dm, 0.41)); return { ok: true, value: { es, ei: es - it, grade: p.grade, letter: L } }; }
  if (L === 'k') { const ei = Math.round(0.6 * Math.cbrt(Dm)); return { ok: true, value: { es: ei + it, ei, grade: p.grade, letter: L } }; }
  return { ok: false, error: `shaft letter "${L}" not supported — use h, g, f (clearance) or k (transition)` };
}

// ─── Fits ─────────────────────────────────────────────────────────────────────

export type FitResult = {
  nominal: number;
  hole: { spec: string; upper_mm: number; lower_mm: number; ES_um: number; EI_um: number };
  shaft: { spec: string; upper_mm: number; lower_mm: number; es_um: number; ei_um: number };
  maxClearance_um: number; // negative ⇒ interference
  minClearance_um: number;
  fitType: 'clearance' | 'transition' | 'interference';
};

function classify(minClear: number, maxClear: number): FitResult['fitType'] {
  if (minClear >= 0) return 'clearance';
  if (maxClear <= 0) return 'interference';
  return 'transition';
}

/** Hole-basis fit from letter specs, e.g. isoFit(50, 'H7', 'g6'). */
export function isoFit(nominal: number, holeSpec: string, shaftSpec: string): ToleranceResult<FitResult> {
  const D = pos(nominal);
  if (D === null) return { ok: false, error: 'nominal diameter must be positive (mm)' };
  const h = holeDeviations(holeSpec, D);
  if (!h.ok) return h;
  const s = shaftDeviations(shaftSpec, D);
  if (!s.ok) return s;
  return { ok: true, value: assembleFit(D, holeSpec, h.value, shaftSpec, s.value) };
}

/** Fit from explicit deviations (µm), for letters/systems not built in. */
export function fitClearanceExplicit(nominal: number, hole: { ES: number; EI: number }, shaft: { es: number; ei: number }): ToleranceResult<FitResult> {
  const D = pos(nominal);
  const ES = fin(hole?.ES), EI = fin(hole?.EI), es = fin(shaft?.es), ei = fin(shaft?.ei);
  if (D === null || ES === null || EI === null || es === null || ei === null) return { ok: false, error: 'need nominal + hole {ES,EI} + shaft {es,ei} in µm' };
  if (ES < EI || es < ei) return { ok: false, error: 'upper deviation must be ≥ lower deviation' };
  return { ok: true, value: assembleFit(D, 'explicit', { ES, EI }, 'explicit', { es, ei }) };
}

function assembleFit(D: number, holeSpec: string, hd: { ES: number; EI: number }, shaftSpec: string, sd: { es: number; ei: number }): FitResult {
  const maxClearance = hd.ES - sd.ei; // largest hole − smallest shaft
  const minClearance = hd.EI - sd.es; // smallest hole − largest shaft
  return {
    nominal: D,
    hole: { spec: holeSpec, upper_mm: r4(D + hd.ES / 1000), lower_mm: r4(D + hd.EI / 1000), ES_um: hd.ES, EI_um: hd.EI },
    shaft: { spec: shaftSpec, upper_mm: r4(D + sd.es / 1000), lower_mm: r4(D + sd.ei / 1000), es_um: sd.es, ei_um: sd.ei },
    maxClearance_um: maxClearance,
    minClearance_um: minClearance,
    fitType: classify(minClearance, maxClearance),
  };
}

// ─── Tolerance stack-up ──────────────────────────────────────────────────────

export type StackDim = {
  nominal: number;
  /** Symmetric tolerance ±tol, OR asymmetric plus/minus. */
  tol?: number;
  plus?: number;
  minus?: number;
  /** +1 adds to the chain, −1 subtracts (e.g. a gap = outer − inner). Default +1. */
  direction?: number;
  label?: string;
};

export type StackResult = {
  nominal: number;
  min: number;
  max: number;
  worstCaseTolerance: number; // ± half the total spread
  rssTolerance: number; // ± statistical
  contributorCount: number;
  largestContributor: { label: string; halfTol: number } | null;
};

/** Worst-case + statistical (RSS) stack of a dimension chain. */
export function toleranceStackup(dims: StackDim[]): ToleranceResult<StackResult> {
  if (!Array.isArray(dims) || dims.length === 0) return { ok: false, error: 'stack-up needs at least one dimension' };
  let nominal = 0, sumPlus = 0, sumMinus = 0, sumSqHalf = 0;
  let largest: { label: string; halfTol: number } | null = null;
  for (let idx = 0; idx < dims.length; idx += 1) {
    const dim = dims[idx];
    const nom = fin(dim.nominal);
    if (nom === null) return { ok: false, error: `dimension ${idx} needs a numeric nominal` };
    const dir = dim.direction === -1 ? -1 : 1;
    let plus = dim.plus !== undefined ? fin(dim.plus) : (dim.tol !== undefined ? fin(dim.tol) : null);
    let minus = dim.minus !== undefined ? fin(dim.minus) : (dim.tol !== undefined ? fin(dim.tol) : null);
    if (plus === null || minus === null || plus < 0 || minus < 0) return { ok: false, error: `dimension ${idx} needs a non-negative tol (or plus/minus)` };
    nominal += dir * nom;
    // worst case: for a +dir dim the max uses +plus, min uses −minus; a −dir dim flips them.
    sumPlus += dir > 0 ? plus : minus;
    sumMinus += dir > 0 ? minus : plus;
    const half = (plus + minus) / 2;
    sumSqHalf += half * half;
    if (!largest || half > largest.halfTol) largest = { label: dim.label ?? `dim ${idx}`, halfTol: r4(half) };
  }
  const max = nominal + sumPlus, min = nominal - sumMinus;
  return {
    ok: true,
    value: {
      nominal: r4(nominal), min: r4(min), max: r4(max),
      worstCaseTolerance: r4((max - min) / 2),
      rssTolerance: r4(Math.sqrt(sumSqHalf)),
      contributorCount: dims.length,
      largestContributor: largest,
    },
  };
}
