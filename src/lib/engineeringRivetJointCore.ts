/**
 * engineeringRivetJointCore — the RIVETED (and bolted) LAP / BUTT JOINT: the
 * classic boiler and pressure-vessel joint, sized per repeating PITCH length by
 * three competing failure modes. It is the joint-design sibling of the welded /
 * bolted CONNECTION lane, and it adds two ideas that lane did not have: the
 * plate-TEARING mode and the JOINT-EFFICIENCY concept.
 *
 * WHY PER PITCH. A riveted seam repeats: a row of rivets at a uniform spacing p
 * (the pitch). Everything scales with the seam length, so the whole joint is
 * characterised by ONE repeating strip of width p carrying its share of the
 * load through its rivets. Design and rate the strip, and you have the seam.
 *
 * THE THREE COMPETING FAILURE MODES (each a force per pitch p):
 *
 *  1. TEARING of the plate between the holes. The hole removes material, so the
 *     plate can only tear across the NET width (p − d) at thickness t:
 *        Pt = σt·(p − d)·t.
 *     This is what the bolt lane never modelled — a bolt group checks the bolts
 *     and the bearing, but the drilled PLATE is itself weakened, and for a
 *     well-packed seam the net plate is often the weakest link. Note Pt is
 *     independent of how many rivets are in the pitch: only one hole's width is
 *     removed from the tearing section per row, and the seam is rated at the row
 *     that carries the full load.
 *
 *  2. SHEARING of the rivets. Each rivet resists across its shank area π/4·d²,
 *     and a rivet may have one or two shear planes depending on the joint:
 *        Ps = τ·(π/4·d²)·n·(shear planes).
 *     A LAP joint and a SINGLE-cover butt joint put every rivet in SINGLE shear
 *     (1 plane). A DOUBLE-cover (double-strap) butt joint sandwiches the plate
 *     between two straps, so every rivet is in DOUBLE shear (2 planes) and its
 *     shear capacity DOUBLES — the single strongest reason to choose a
 *     double-strap butt over a lap for a boiler seam.
 *
 *  3. CRUSHING (bearing) of the rivet against the plate, on the PROJECTED area
 *     d·t (never the curved hole surface), for all n rivets in the pitch:
 *        Pc = σc·d·t·n.
 *
 * THE STRENGTH is the WEAKEST of the three — the joint fails in whichever mode
 * gives the least force per pitch — and the core reports WHICH mode governs.
 *
 * JOINT EFFICIENCY. A solid, un-drilled plate of the same pitch width would
 * carry σt·p·t. The riveted seam carries min(Pt, Ps, Pc), which is always LESS
 * because the holes weaken it, so
 *        η = min(Pt, Ps, Pc) / (σt·p·t)   is always in (0, 1).
 * η is the headline number for a seam (a single-riveted lap seam runs ~50–60 %,
 * a double / triple-riveted butt seam ~70–85 %). A GOOD design BALANCES the
 * three modes — if one mode is far stronger than the others its extra metal is
 * wasted, so the maximum efficiency for a given rivet arrangement is reached
 * when tearing, shearing and crushing come out nearly equal.
 *
 * Every number is closed-form and unit-consistent in N / mm / MPa (a plate's
 * mm·mm·(N/mm²) = N; a rivet's mm²·(N/mm²) = N) — so the smoke pins each result
 * against a hand-computed textbook value (Khurmi/Shigley boiler-joint method)
 * and the smoke IS the proof. The stresses are supplied by the caller (boiler
 * codes quote allowable σt / τ / σc directly), so this core needs no material
 * table and no imports.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-riveted-joint-core-smoketest.ts):
 * no imports, no Date.now(), no I/O, total functions.
 */

export type RivetJointResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** π/4 — the shank-area coefficient (a rivet shears across π/4·d²). */
export const QUARTER_PI = Math.PI / 4;

export type RivetJointType = 'lap' | 'single-cover-butt' | 'double-cover-butt';

/**
 * Shear planes per rivet by joint type. A lap joint and a single-strap butt
 * joint are SINGLE shear (1 plane); a double-strap butt joint is DOUBLE shear
 * (2 planes), which is why it carries twice the rivet shear of a lap joint with
 * the same rivets.
 */
export const SHEAR_PLANES: Record<RivetJointType, number> = {
  'lap': 1,
  'single-cover-butt': 1,
  'double-cover-butt': 2,
};

export type RivetedJointResult = {
  jointType: RivetJointType;
  plateThickness_mm: number;
  rivetDiameter_mm: number;
  pitch_mm: number;
  /** Rivets per pitch length driving shear and crushing. */
  rivetsPerPitch: number;
  /** Informational number of rivet rows, echoed when supplied. */
  rows: number | null;
  /** Shear planes per rivet (1 lap / single-cover-butt, 2 double-cover-butt). */
  shearPlanes: number;
  tensileStress_MPa: number;
  shearStress_MPa: number;
  crushingStress_MPa: number;
  /** Tearing of the plate between holes, per pitch: σt·(p−d)·t. */
  tearing_N: number;
  /** Shearing of the rivets, per pitch: τ·(π/4·d²)·n·planes. */
  shearing_N: number;
  /** Crushing/bearing on the projected area, per pitch: σc·d·t·n. */
  crushing_N: number;
  /** The mode with the least force — the joint fails here. */
  governingMode: 'tearing' | 'shearing' | 'crushing';
  /** Joint strength per pitch = min(tearing, shearing, crushing). */
  strength_N: number;
  /** Strength of the solid un-drilled plate per pitch = σt·p·t. */
  solidPlate_N: number;
  /** Joint efficiency η = strength / solidPlate, always in (0, 1). */
  efficiency: number;
};

/**
 * Strength and efficiency of a riveted / bolted lap or butt joint, per pitch.
 *
 * Inputs (mm / N / MPa): plate thickness `t`, rivet diameter `d`, pitch `p`
 * (spacing between rivets in a row), allowable stresses `tensileStress` σt,
 * `shearStress` τ and `crushingStress` σc, `jointType`
 * (lap | single-cover-butt | double-cover-butt), `rivetsPerPitch` n (the number
 * of rivets carrying shear/crushing in one pitch; if omitted it falls back to
 * `rows`, else 1), and an optional informational `rows`.
 *
 * Reports the three per-pitch failure forces, the governing (weakest) mode, the
 * joint strength, the solid-plate strength, and the efficiency η. Short aliases
 * (`t`, `d`, `p`, `sigmaT`, `tau`, `sigmaC`, `n`) are accepted too.
 */
export function rivetedJoint(spec: {
  plateThickness?: number; t?: number;
  rivetDiameter?: number; d?: number;
  pitch?: number; p?: number;
  tensileStress?: number; sigmaT?: number;
  shearStress?: number; tau?: number;
  crushingStress?: number; sigmaC?: number;
  jointType?: RivetJointType;
  rivetsPerPitch?: number; n?: number;
  rows?: number;
}): RivetJointResult<RivetedJointResult> {
  const t = pos(spec.plateThickness ?? spec.t);
  if (t === null) return { ok: false, error: 'rivetedJoint needs a positive plate thickness (mm)' };
  const d = pos(spec.rivetDiameter ?? spec.d);
  if (d === null) return { ok: false, error: 'rivetedJoint needs a positive rivet diameter (mm)' };
  const p = pos(spec.pitch ?? spec.p);
  if (p === null) return { ok: false, error: 'rivetedJoint needs a positive pitch (mm)' };
  if (p <= d) return { ok: false, error: `pitch (${r(p)} mm) must exceed the rivet diameter (${r(d)} mm) — the holes would overlap and leave no plate to tear` };

  const sigmaT = pos(spec.tensileStress ?? spec.sigmaT);
  if (sigmaT === null) return { ok: false, error: 'rivetedJoint needs a positive tensile stress σt (MPa)' };
  const tau = pos(spec.shearStress ?? spec.tau);
  if (tau === null) return { ok: false, error: 'rivetedJoint needs a positive shear stress τ (MPa)' };
  const sigmaC = pos(spec.crushingStress ?? spec.sigmaC);
  if (sigmaC === null) return { ok: false, error: 'rivetedJoint needs a positive crushing stress σc (MPa)' };

  const jointType: RivetJointType = spec.jointType ?? 'lap';
  const planes = SHEAR_PLANES[jointType];
  if (planes === undefined) {
    return { ok: false, error: `unknown jointType "${String(spec.jointType)}" — use lap, single-cover-butt, or double-cover-butt` };
  }

  // rivets per pitch (drives shear + crushing); optional informational row count
  let rows: number | null = null;
  if (spec.rows !== undefined) {
    const rw = Number(spec.rows);
    if (!Number.isFinite(rw) || Math.trunc(rw) < 1) return { ok: false, error: 'rows, when supplied, must be an integer ≥ 1' };
    rows = Math.trunc(rw);
  }
  const nSource = spec.rivetsPerPitch ?? spec.n ?? rows ?? 1;
  const nRaw = Number(nSource);
  if (!Number.isFinite(nRaw) || Math.trunc(nRaw) < 1) return { ok: false, error: 'rivetsPerPitch must be an integer ≥ 1' };
  const n = Math.trunc(nRaw);

  // ── the three competing per-pitch failure forces ──
  const tearing = sigmaT * (p - d) * t;              // Pt = σt·(p−d)·t
  const shankArea = QUARTER_PI * d * d;              // π/4·d²
  const shearing = tau * shankArea * n * planes;     // Ps = τ·(π/4·d²)·n·planes
  const crushing = sigmaC * d * t * n;               // Pc = σc·d·t·n

  // weakest mode governs; on an exact tie prefer tearing → shearing → crushing
  let governingMode: 'tearing' | 'shearing' | 'crushing' = 'tearing';
  let strength = tearing;
  if (shearing < strength) { strength = shearing; governingMode = 'shearing'; }
  if (crushing < strength) { strength = crushing; governingMode = 'crushing'; }

  const solidPlate = sigmaT * p * t;                 // un-drilled plate per pitch
  const efficiency = strength / solidPlate;          // η ∈ (0,1)

  return {
    ok: true,
    value: {
      jointType,
      plateThickness_mm: r(t), rivetDiameter_mm: r(d), pitch_mm: r(p),
      rivetsPerPitch: n, rows, shearPlanes: planes,
      tensileStress_MPa: r(sigmaT), shearStress_MPa: r(tau), crushingStress_MPa: r(sigmaC),
      tearing_N: r(tearing, 2), shearing_N: r(shearing, 2), crushing_N: r(crushing, 2),
      governingMode,
      strength_N: r(strength, 2),
      solidPlate_N: r(solidPlate, 2),
      efficiency: r(efficiency, 6),
    },
  };
}
