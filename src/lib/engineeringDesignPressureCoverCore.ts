/**
 * engineeringDesignPressureCoverCore — ONE-CALL bolted pressure-cover design.
 *
 * Packages the PROVEN pressure-cover composition chain (see
 * scripts/engineering-pressure-cover-integration-smoketest.ts): one internal
 * pressure p splits THREE ways at a bolted vessel end —
 *
 *   1. WALL  — p tries to split the shell → thin-wall p·r/t sizes the wall,
 *              then the EXACT Lamé thick-cylinder lane re-checks the chosen
 *              stock plate (and grows it when thin-wall was optimistic).
 *   2. COVER — the SAME p bends the flat circular cover over the SAME bore
 *              radius a → Roark platePressure sizes the cover thickness.
 *   3. BOLTS — the SAME p over the SAME cover area is the end load F = p·π·a²
 *              the flange bolts carry in tension → the bolted-joint stiffness
 *              diagram (C = kb/(kb+km)) picks an ISO coarse bolt whose
 *              preload + C·P stress clears the allowable, with a separation
 *              margin (Fi must beat (1−C)·P).
 *
 * House style follows engineeringDesignCore: every required dimension is
 * rounded UP to a stock size and then RE-CHECKED at that size, so the returned
 * part meets the duty, not just the raw requirement. Pure + tsx-loadable; no
 * I/O. Smoke: scripts/engineering-design-pressure-cover-smoketest.ts.
 */

import type { DesignedPart, DesignResult } from './engineeringDesignCore';
import { MATERIALS } from './engineeringCalcCore';
import { thickCylinder } from './engineeringThickCylinderCore';
import { platePressure, POISSON_RATIO, type Edge } from './engineeringPlateBendingCore';
import { coarsePitchFor } from './engineeringThreadCore';
import { jointStiffness, separationLoad, STRESS_AREA_COEFF } from './engineeringBoltedJointCore';
import { buildFlange, writeBlenderSolidScript, type SolidModel } from './engineeringSolidModelingCore';

// ─── House helpers (same conventions as engineeringDesignCore) ───────────────

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r3(n: number): number { return Math.round(n * 1e3) / 1e3; }

/** Common stock plate thicknesses (mm) — walls and covers round UP into this list. */
export const STOCK_PLATE_MM: readonly number[] = [3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 40, 50];

/** ISO coarse bolt candidates the designer iterates through, smallest first. */
export const BOLT_CANDIDATES_MM: readonly number[] = [8, 10, 12, 16, 20, 24, 30];

/** Smallest stock plate ≥ the requirement, or null when even 50 mm is too thin. */
export function ceilToStockPlate(required_mm: number): number | null {
  for (const t of STOCK_PLATE_MM) if (t >= required_mm) return t;
  return null;
}

function roundUpTo5(x: number): number { return Math.ceil(x / 5) * 5; }

function normalizeEdge(raw: unknown): Edge | null {
  const s = String(raw ?? 'simply_supported').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (s === 'simply_supported' || s === 'simple' || s === 'ss' || s === 'supported' || s === 'pinned') return 'simply_supported';
  if (s === 'clamped' || s === 'fixed' || s === 'built_in' || s === 'builtin') return 'clamped';
  return null;
}

// ─── Result shape ────────────────────────────────────────────────────────────

/** Per-lane numeric receipts so a caller (or the smoke) can round-trip each lane. */
export type PressureCoverLanes = {
  wall: {
    thickness_mm: number;
    thinWallRequired_mm: number;   // t from σ = p·r/t at the allowable
    thinWallHoop_MPa: number;      // p·r/t at the CHOSEN thickness
    lameHoop_MPa: number;          // exact Lamé bore hoop at the chosen thickness
    allowable_MPa: number;
    lameGrewWall: boolean;         // true when Lamé rejected the thin-wall stock size
  };
  cover: {
    thickness_mm: number;
    required_mm: number;           // t from σ = k·q·(a/t)² at the allowable
    sigmaMax_MPa: number;          // realised plate stress at the chosen thickness
    deflection_mm: number;
    allowable_MPa: number;
    edge: Edge;
  };
  bolts: {
    endLoad_N: number;             // F = p·π·a² — THE statics-closure number
    count: number;
    diameter_mm: number;
    pitch_mm: number;
    stressArea_mm2: number;
    stiffnessConstant_C: number;
    preload_N: number;             // Fi per bolt
    perBoltLoad_N: number;         // P = F / n
    boltStress_MPa: number;        // (Fi + C·P) / At
    boltAllowable_MPa: number;     // 0.75 · yield
    separationLoad_N: number;      // P0 = Fi/(1−C)
    separationSafetyFactor: number;
  };
};

export type PressureCoverPart = DesignedPart & { boltSize: string; lanes: PressureCoverLanes };

// ─── The designer ────────────────────────────────────────────────────────────

/**
 * Design a bolted flat cover (blind flange) for a cylindrical pressure vessel:
 * sizes the shell wall (thin-wall → Lamé re-check), the flat circular cover
 * (Roark plate bending), and the flange bolting (joint stiffness + separation),
 * all from ONE pressure and ONE bore. Returns the cover as a ready-to-compile
 * flange model (disc + bolt-circle holes, no centre hole).
 */
export function designPressureCover(spec: {
  pressure_MPa: number;
  /** Vessel inner diameter = the flat cover's span 2a (mm). */
  boreDiameter_mm: number;
  material?: string;
  /** Safety factor on yield for wall + cover (default 3 — pressure equipment). */
  safetyFactor?: number;
  /** Number of flange bolts. Default: sized from the end load, a multiple of 4. */
  boltCount?: number;
  /** Seated preload Fi = preloadFactor × per-bolt external load (default 1.5). */
  preloadFactor?: number;
  /** Cover edge condition: 'simply_supported' (default, conservative for a gasketed cover) or 'clamped'. */
  edgeCondition?: string;
  outputPath?: string;
}): DesignResult<PressureCoverPart> {
  const p = pos(spec.pressure_MPa);
  if (p === null) return { ok: false, error: 'pressure cover needs a positive pressure_MPa (internal pressure, MPa)' };
  const bore = pos(spec.boreDiameter_mm);
  if (bore === null) return { ok: false, error: 'pressure cover needs a positive boreDiameter_mm (vessel inner Ø, mm)' };
  const matName = String(spec.material ?? 'steel').trim().toLowerCase();
  const m = MATERIALS[matName];
  if (!m) return { ok: false, error: `unknown material "${spec.material}" — known: ${Object.keys(MATERIALS).join(', ')}` };
  const SF = pos(spec.safetyFactor) ?? 3;
  const preloadFactor = pos(spec.preloadFactor) ?? 1.5;
  const edge = normalizeEdge(spec.edgeCondition);
  if (!edge) return { ok: false, error: `edgeCondition must be "simply_supported" or "clamped" (got "${spec.edgeCondition}")` };
  let nBolts: number | null = null;
  if (spec.boltCount !== undefined) {
    const n = Number(spec.boltCount);
    if (!Number.isInteger(n) || n < 4) return { ok: false, error: 'boltCount must be an integer ≥ 4 (or omit it to size the bolting)' };
    nBolts = n;
  }

  const a = bore / 2;               // cover radius = vessel inner radius
  const allow = m.yield / SF;       // one allowable serves BOTH wall and cover
  const notes: string[] = [];

  // ── LANE 1: WALL — thin-wall sizes it, Lamé re-checks it ────────────────────
  const tWallReq = (p * a) / allow;                       // σ = p·r/t → t = p·r/σ_allow
  const tWallThinStock = ceilToStockPlate(tWallReq);
  if (tWallThinStock === null) {
    return { ok: false, error: `wall needs t ≥ ${r3(tWallReq)} mm — beyond the thickest stock plate (${STOCK_PLATE_MM[STOCK_PLATE_MM.length - 1]} mm); reduce pressure/bore or raise the material` };
  }
  let wallT = tWallThinStock;
  let lame = thickCylinder({ innerRadius: a, outerRadius: a + wallT, internalPressure: p });
  // RE-CHECK with the EXACT Lamé lane: grow through the stock list while the bore hoop exceeds the allowable.
  let wallIdx = STOCK_PLATE_MM.indexOf(wallT);
  while (lame.ok && lame.value.hoopStressBore > allow && wallIdx + 1 < STOCK_PLATE_MM.length) {
    wallIdx += 1;
    wallT = STOCK_PLATE_MM[wallIdx];
    lame = thickCylinder({ innerRadius: a, outerRadius: a + wallT, internalPressure: p });
  }
  if (!lame.ok) return { ok: false, error: `wall check failed: ${lame.error}` };
  if (lame.value.hoopStressBore > allow) {
    return { ok: false, error: `even a ${wallT} mm wall leaves Lamé bore hoop ${r3(lame.value.hoopStressBore)} MPa > ${r3(allow)} MPa allowable — reduce pressure/bore or raise the material` };
  }
  const lameGrewWall = wallT > tWallThinStock;
  const thinHoopAtChosen = (p * a) / wallT;
  notes.push(
    `WALL: thin-wall σ=p·r/t needs t ≥ ${r3(tWallReq)} mm → stock ${tWallThinStock} mm; Lamé re-check at ${wallT} mm: bore hoop ${r3(lame.value.hoopStressBore)} MPa vs thin-wall ${r3(thinHoopAtChosen)} MPa (Lamé is exact and higher), ≤ ${r3(allow)} MPa allowable${lameGrewWall ? ` — Lamé GREW the wall from the thin-wall ${tWallThinStock} mm answer` : ''}.`,
  );

  // ── LANE 2: COVER — the SAME p bends the flat circular cover over the SAME a ─
  const nu = POISSON_RATIO[matName] ?? 0.3;
  const kSigma = edge === 'clamped' ? 0.75 : (3 / 8) * (3 + nu); // Roark Table 11.2 max-stress coefficients
  const tCoverReq = a * Math.sqrt((kSigma * p) / allow);         // σ = k·q·(a/t)² → t
  let coverT = ceilToStockPlate(tCoverReq);
  if (coverT === null) {
    return { ok: false, error: `cover needs t ≥ ${r3(tCoverReq)} mm — beyond the thickest stock plate (${STOCK_PLATE_MM[STOCK_PLATE_MM.length - 1]} mm); use a clamped/dished cover or a stronger material` };
  }
  // RE-CHECK through the real plate lane (it owns the coefficients + deflection).
  let plate = platePressure({ shape: 'circular', radius: a, thickness: coverT, pressure: p, edge, material: matName });
  let coverIdx = STOCK_PLATE_MM.indexOf(coverT);
  while (plate.ok && plate.value.sigmaMax_MPa > allow && coverIdx + 1 < STOCK_PLATE_MM.length) {
    coverIdx += 1;
    coverT = STOCK_PLATE_MM[coverIdx];
    plate = platePressure({ shape: 'circular', radius: a, thickness: coverT, pressure: p, edge, material: matName });
  }
  if (!plate.ok) return { ok: false, error: `cover check failed: ${plate.error}` };
  if (plate.value.sigmaMax_MPa > allow) {
    return { ok: false, error: `even a ${coverT} mm cover sees ${r3(plate.value.sigmaMax_MPa)} MPa > ${r3(allow)} MPa allowable` };
  }
  notes.push(
    `COVER: ${edge} circular plate over the same a = ${r3(a)} mm needs t ≥ ${r3(tCoverReq)} mm (σ = ${r3(kSigma)}·q·(a/t)²) → stock ${coverT} mm; realised σ ${r3(plate.value.sigmaMax_MPa)} MPa (${plate.value.sigmaLocation}) ≤ ${r3(allow)} MPa, centre deflection ${r3(plate.value.yMax_mm)} mm.`,
  );

  // ── LANE 3: BOLTS — the SAME p over the SAME cover area is the end load ──────
  const F = p * Math.PI * a * a; // N — the statics closure: bolt load = plate load = p·π·a²
  // Default bolt count: a multiple of 4 keeping the per-bolt end load near ≤ 20 kN.
  const PER_BOLT_TARGET_N = 20_000;
  const boltAllow = 0.75 * m.yield; // preload+service stress limit — ~75% of yield (proof-load convention)
  // ASSUMPTION: the mating flange ring is as thick as the cover, so grip = 2 × cover t.
  const grip = 2 * coverT;

  type BoltPick = {
    n: number; d: number; pitch: number; At: number; C: number;
    Fi: number; Pb: number; sigmaBolt: number; sepLoad: number; sepSF: number;
  };
  const tryBolting = (n: number): BoltPick | null => {
    const Pb = F / n;
    const Fi = preloadFactor * Pb;
    for (const d of BOLT_CANDIDATES_MM) {
      const pitch = coarsePitchFor(d);
      if (pitch === null) continue;
      const js = jointStiffness({ boltDiameter: d, grip, boltMaterial: matName, memberMaterial: matName, pitch, preload: Fi, externalLoad: Pb });
      const C = js.ok ? js.value.stiffnessConstant_C : 0.3; // conservative documented fallback
      const ds = d - STRESS_AREA_COEFF * pitch;
      const At = (Math.PI / 4) * ds * ds;
      const sigmaBolt = (Fi + C * Pb) / At;
      if (sigmaBolt > boltAllow) continue; // bolt too small — next size up
      const sep = separationLoad({ preload: Fi, stiffnessConstant: C, externalLoad: Pb });
      if (!sep.ok || sep.value.adequate !== true || (sep.value.safetyFactor ?? 0) < 1.1) continue;
      return { n, d, pitch, At, C, Fi, Pb, sigmaBolt, sepLoad: sep.value.separationLoad_N, sepSF: sep.value.safetyFactor! };
    }
    return null;
  };

  let pick: BoltPick | null = null;
  if (nBolts !== null) {
    pick = tryBolting(nBolts);
    if (!pick) return { ok: false, error: `no ISO coarse bolt up to M${BOLT_CANDIDATES_MM[BOLT_CANDIDATES_MM.length - 1]} carries the ${r3(F / nBolts)} N per-bolt load with ${nBolts} bolts — use more bolts` };
  } else {
    let n = Math.max(4, Math.ceil(F / PER_BOLT_TARGET_N / 4) * 4);
    for (; n <= 64 && !pick; n += 4) pick = tryBolting(n);
    if (!pick) return { ok: false, error: `could not size the bolting: even 64 × M${BOLT_CANDIDATES_MM[BOLT_CANDIDATES_MM.length - 1]} cannot carry the ${r3(F)} N end load` };
  }
  const boltSize = `M${pick.d}`;
  notes.push(
    `BOLTS: end load F = p·π·a² = ${r3(F)} N over ${pick.n} bolts → ${r3(pick.Pb)} N/bolt; preload Fi = ${preloadFactor}×P = ${r3(pick.Fi)} N (assumed seating). ${boltSize} (At ${r3(pick.At)} mm², grip ${grip} mm → C ${r3(pick.C)}): max bolt stress (Fi + C·P)/At = ${r3(pick.sigmaBolt)} MPa ≤ ${r3(boltAllow)} MPa (0.75·yield); separation at P0 = Fi/(1−C) = ${r3(pick.sepLoad)} N (SF ${r3(pick.sepSF)}).`,
  );

  // ── Geometry: bolt circle + cover OD + the flange model ─────────────────────
  const boltCircleD = roundUpTo5(bore + 2.5 * pick.d);   // bolts sit outside the sealed bore
  const coverOD = roundUpTo5(boltCircleD + 2.5 * pick.d); // cover overhangs the bolt circle
  const holeD = pick.d + 2; // clearance holes
  const flange = buildFlange({
    outerDiameter: coverOD, thickness: coverT,
    boltCircle: { count: pick.n, pcd: boltCircleD, holeDiameter: holeD },
  });
  if (!flange.ok) return { ok: false, error: `cover model failed: ${flange.error}` };
  const model: SolidModel = flange.value;
  const out = typeof spec.outputPath === 'string' && spec.outputPath.trim() ? spec.outputPath : '<output>.stl';
  const bpy = writeBlenderSolidScript(model, out);
  const volume = Math.PI * (coverOD / 2) ** 2 * coverT - pick.n * Math.PI * (holeD / 2) ** 2 * coverT;
  const mass = volume * m.density;
  notes.push(`GEOMETRY: bolt circle Ø${boltCircleD} > bore Ø${bore}; cover Ø${coverOD} × ${coverT} mm with ${pick.n} × Ø${holeD} holes, ${r3(mass)} kg.`);

  // ── Governing lane: highest utilisation of its own allowable ────────────────
  const lanesU = [
    { lane: 'wall', sigma: lame.value.hoopStressBore, allowable: allow, u: lame.value.hoopStressBore / allow },
    { lane: 'cover', sigma: plate.value.sigmaMax_MPa, allowable: allow, u: plate.value.sigmaMax_MPa / allow },
    { lane: 'bolts', sigma: pick.sigmaBolt, allowable: boltAllow, u: pick.sigmaBolt / boltAllow },
  ];
  const gov = lanesU.reduce((worst, l) => (l.u > worst.u ? l : worst));

  const lanes: PressureCoverLanes = {
    wall: {
      thickness_mm: wallT, thinWallRequired_mm: r3(tWallReq),
      thinWallHoop_MPa: r3(thinHoopAtChosen), lameHoop_MPa: lame.value.hoopStressBore,
      allowable_MPa: r3(allow), lameGrewWall,
    },
    cover: {
      thickness_mm: coverT, required_mm: r3(tCoverReq),
      sigmaMax_MPa: plate.value.sigmaMax_MPa, deflection_mm: plate.value.yMax_mm,
      allowable_MPa: r3(allow), edge,
    },
    bolts: {
      endLoad_N: r3(F), count: pick.n, diameter_mm: pick.d, pitch_mm: pick.pitch,
      stressArea_mm2: r3(pick.At), stiffnessConstant_C: r3(pick.C),
      preload_N: r3(pick.Fi), perBoltLoad_N: r3(pick.Pb), boltStress_MPa: r3(pick.sigmaBolt),
      boltAllowable_MPa: r3(boltAllow), separationLoad_N: r3(pick.sepLoad), separationSafetyFactor: r3(pick.sepSF),
    },
  };

  return {
    ok: true,
    value: {
      type: 'pressure_cover',
      summary: `Ø${bore} bore @ ${p} MPa: ${wallT} mm wall, Ø${coverOD}×${coverT} mm ${matName} cover, ${pick.n} × ${boltSize} on Ø${boltCircleD} (governed by ${gov.lane}, ${r3(mass)} kg)`,
      dimensions: {
        boreDiameter: bore, wallThickness: wallT, coverThickness: coverT,
        coverOuterDiameter: coverOD, boltCircleDiameter: boltCircleD,
        boltCount: pick.n, boltDiameter: pick.d, boltHoleDiameter: holeD,
        preload_N: r3(pick.Fi),
      },
      safety: {
        allowableStress_MPa: r3(gov.allowable),
        realisedStress_MPa: r3(gov.sigma),
        realisedSafetyFactor: r3(m.yield / gov.sigma),
        note: `governing lane: ${gov.lane} — σ ${r3(gov.sigma)} MPa vs its ${r3(gov.allowable)} MPa allowable (utilisation ${r3(gov.u * 100)}%)`,
      },
      material: matName,
      mass_kg: r3(mass),
      model,
      bpy: bpy.ok ? bpy.value : '',
      notes,
      boltSize,
      lanes,
    },
  };
}
