/**
 * engineeringBoltedJointCore — the BOLTED-JOINT DIAGRAM: why a preloaded bolt
 * survives a load that would fatigue a bare bolt to death. engineeringCalcCore
 * already turns a torque into a preload (`bolt_preload`, F = T/Kd) and
 * engineeringFatigueCore already draws the Goodman line; this core is the layer
 * BETWEEN them that explains WHY that preload works — the joint stiffness split
 * and the far milder stress the bolt actually feels.
 *
 * THE JOINT AS TWO SPRINGS IN PARALLEL. Tightening a bolt stretches the bolt
 * (spring kb) and squeezes the members (spring km); they share the same grip, so
 * an external tensile load P is resisted by BOTH in parallel. The bolt is long
 * and slender, the members are a short fat barrel of metal around it, so the
 * members are far stiffer: km ≫ kb. The load divides in proportion to stiffness,
 * and the fraction the BOLT picks up is the stiffness constant
 *   C = kb / (kb + km).
 * Because km ≫ kb, C is SMALL — typically 0.2–0.35 for a steel-on-steel joint.
 * That single number is the whole point of the diagram:
 *   bolt force   Fb = Fi + C·P          (bolt gains only C·P)
 *   member force Fm = Fi − (1 − C)·P    (clamp sheds (1 − C)·P)
 * Of the external load P, the bolt feels only C·P while the members give up the
 * rest, (1 − C)·P — and those two changes add back to exactly P. So a preloaded
 * bolt sees a fraction of the load a bare bolt would: THIS is why preload
 * protects the bolt, and why bolt fatigue is far milder than the raw external
 * load range suggests.
 *
 * BOLT STIFFNESS. kb = Ab·Eb/L (grip length L). A bolt that is part shank, part
 * thread within the grip is two springs in series: 1/kb = ld/(Ad·E) + lt/(At·E)
 * with the shank (major-diameter) area Ad and the thread tensile-stress area At.
 *
 * MEMBER STIFFNESS — the FRUSTUM cone (Shigley). The compression under a bolt
 * head spreads into the members as a pair of truncated cones (frusta) at a 30°
 * half-angle, washer face taken as D = 1.5d. Integrating the varying cone area
 * over the grip gives the closed form
 *   km = π·Em·d·tan30° / (2·ln[ 5·(L·tan30° + 0.5d) / (L·tan30° + 2.5d) ]).
 * (The 0.5d and 2.5d come from D − d = 0.5d and D + d = 2.5d with D = 1.5d; the
 * factor 2 is the two frusta in series.)
 *
 * SEPARATION. The joint holds only while the members stay in compression. The
 * external load that just opens it (Fm = 0) is P0 = Fi/(1 − C); the safety factor
 * against separation is n0 = P0/P. A joint that separates is catastrophic — once
 * open, the bolt takes the FULL load swing (C jumps toward 1) and fatigue life
 * collapses, so separation is checked before fatigue.
 *
 * BOLT FATIGUE. Under a fluctuating external load Pmin..Pmax the bolt force
 * swings between Fi + C·Pmin and Fi + C·Pmax, so on the stress area At:
 *   alternating  σa = C·(Pmax − Pmin) / (2·At)
 *   mean         σm = [Fi + C·(Pmax + Pmin)/2] / At
 * The alternating stress carries only the factor C — the same protection as the
 * force diagram. The modified-Goodman fatigue factor is the standard
 *   1/n = σa/Se + σm/Su   →   nf = 1/(σa/Se + σm/Su),
 * but for a PRELOADED bolt the naive form over-penalises the large preload mean.
 * The load line does not run from the origin: it starts at the preload point
 * σi = Fi/At and climbs at 45°, so the fatigue factor that credits the preload is
 * (Shigley Eq. 8-45)
 *   nf = Se·(Su − σi) / (Su·σa + Se·(σm − σi)).
 * It reduces to the standard Goodman when σi = 0, and for a real preloaded joint
 * it is the higher, correct factor — preload helps, up to the first-cycle yield
 * ceiling ny = Sy/σmax (a bolt safe in fatigue can still yield on the first peak).
 *
 * VERIFICATION (smoke IS proof). Every formula is closed-form and unit-consistent
 * in N / mm / MPa (kb, km in N/mm; C, fractions, and factors dimensionless), so
 * the smoke pins each against a hand-computed Shigley reference AND against the
 * invariants a single value hides: 0 < C < 1 with C = 0.5 exactly when kb = km;
 * the load bookkeeping C·P + (1 − C)·P = P closing; Fm = 0 exactly at P = P0; and
 * the design lever that a stiffer member (higher km → lower C) lowers σa and so
 * raises the fatigue factor. The smoke IS the proof; there is no app.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-bolted-joint-core-smoketest.ts):
 * the ONLY import is the MATERIALS table from engineeringCalcCore (itself
 * import-free) for default/lookup moduli, no I/O, total functions.
 */

import { MATERIALS } from './engineeringCalcCore';

export type JointResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function nonneg(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 4): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** Half-apex angle of the Shigley member-stiffness pressure cone (30°). */
export const FRUSTUM_HALF_ANGLE_DEG = 30;
/** tan(30°) = 1/√3, the cone slope that fixes the frustum geometry. */
export const TAN_FRUSTUM = Math.tan(Math.PI / 6);
/** Tensile-stress-area diameter coefficient: At = (π/4)(d − 0.9382·p)². Mean of
 *  the ISO pitch- and minor-diameter coefficients, (0.6495 + 1.2269)/2. */
export const STRESS_AREA_COEFF = 0.9382;

function resolveModulus(explicit: number | undefined, material: string | undefined): JointResult<number> {
  if (explicit !== undefined) {
    const e = pos(explicit);
    if (e === null) return { ok: false, error: 'modulus must be a positive number (MPa)' };
    return { ok: true, value: e };
  }
  if (material) {
    const m = MATERIALS[String(material).trim().toLowerCase()];
    if (!m) return { ok: false, error: `unknown material "${material}" — known: ${Object.keys(MATERIALS).join(', ')}` };
    return { ok: true, value: m.E };
  }
  return { ok: true, value: MATERIALS.steel.E }; // default: mild steel, 200 GPa
}

/** Tensile stress area At from an explicit value, or from a diameter (+ optional
 *  pitch → the ISO (π/4)(d−0.9382p)² area, else the (π/4)(0.85d)² approximation). */
function resolveStressArea(spec: { stressArea?: number; boltDiameter?: number; pitch?: number }): JointResult<{ At: number; basis: string }> {
  if (spec.stressArea !== undefined) {
    const a = pos(spec.stressArea);
    if (a === null) return { ok: false, error: 'stressArea must be positive (mm²)' };
    return { ok: true, value: { At: a, basis: 'explicit stressArea' } };
  }
  const d = spec.boltDiameter !== undefined ? pos(spec.boltDiameter) : null;
  if (d === null) return { ok: false, error: 'supply a stressArea (mm²) or a boltDiameter (mm)' };
  const p = spec.pitch !== undefined ? pos(spec.pitch) : null;
  if (p !== null && p < d) {
    const ds = d - STRESS_AREA_COEFF * p;
    return { ok: true, value: { At: (Math.PI / 4) * ds * ds, basis: `tensile stress area (π/4·(d−0.9382·p)², p=${r(p, 3)})` } };
  }
  const ds = 0.85 * d;
  return { ok: true, value: { At: (Math.PI / 4) * ds * ds, basis: 'approx (π/4·(0.85d)²)' } };
}

// ─── Joint stiffness (the diagram: kb, km, C) ────────────────────────────────

export type JointStiffnessResult = {
  boltStiffness_N_per_mm: number;    // kb
  memberStiffness_N_per_mm: number;  // km
  stiffnessConstant_C: number;       // C = kb/(kb+km)
  memberLoadFraction: number;        // 1 − C
  boltStiffnessBasis: string;
  memberStiffnessBasis: string;
  // present only when both a preload Fi and an external load P are supplied:
  preload_N: number | null;          // Fi
  externalLoad_N: number | null;     // P
  boltLoadIncrease_N: number | null; // C·P  (extra tension the bolt picks up)
  memberLoadDecrease_N: number | null; // (1−C)·P  (clamp the members give up)
  boltForce_N: number | null;        // Fb = Fi + C·P
  memberForce_N: number | null;      // Fm = Fi − (1−C)·P (residual clamp)
  jointSeparated: boolean | null;    // Fm ≤ 0
};

/**
 * The joint stiffness diagram. Bolt stiffness kb is explicit (`boltStiffness`),
 * a shank+thread series (`shankLength`+`threadLength`, areas from `boltDiameter`
 * and `stressArea`), or the nominal Ab·Eb/L (Ab = `boltArea` or π/4·d²). Member
 * stiffness km is explicit (`memberStiffness`) or the Shigley 30° frustum from
 * `boltDiameter` and `grip`. Returns kb, km, C = kb/(kb+km), and the member load
 * fraction 1 − C; if a `preload` Fi and `externalLoad` P are given it also
 * reports the split Fb = Fi + C·P, Fm = Fi − (1 − C)·P.
 */
export function jointStiffness(spec: {
  boltDiameter?: number;      // d (mm)
  grip?: number;              // L (mm), clamped length
  boltModulus?: number;       // Eb (MPa)
  memberModulus?: number;     // Em (MPa)
  boltMaterial?: string;      // → Eb from MATERIALS
  memberMaterial?: string;    // → Em from MATERIALS
  boltArea?: number;          // Ab (mm²) override for the nominal kb
  boltStiffness?: number;     // kb (N/mm) explicit
  memberStiffness?: number;   // km (N/mm) explicit
  shankLength?: number;       // ld (mm), unthreaded body in the grip
  threadLength?: number;      // lt (mm), threaded length in the grip
  stressArea?: number;        // At (mm²), threaded-portion area for the series
  pitch?: number;             // thread pitch (mm), to derive At
  preload?: number;           // Fi (N)
  externalLoad?: number;      // P (N)
}): JointResult<JointStiffnessResult> {
  const Eb = resolveModulus(spec.boltModulus, spec.boltMaterial);
  if (!Eb.ok) return Eb;
  const Em = resolveModulus(spec.memberModulus, spec.memberMaterial);
  if (!Em.ok) return Em;

  const grip = spec.grip !== undefined ? pos(spec.grip) : null;
  const d = spec.boltDiameter !== undefined ? pos(spec.boltDiameter) : null;

  // ── bolt stiffness kb ──
  let kb: number; let kbBasis: string;
  if (spec.boltStiffness !== undefined) {
    const v = pos(spec.boltStiffness);
    if (v === null) return { ok: false, error: 'boltStiffness must be positive (N/mm)' };
    kb = v; kbBasis = 'explicit boltStiffness';
  } else if (spec.shankLength !== undefined && spec.threadLength !== undefined) {
    // shank + threaded portions in series: 1/kb = ld/(Ad·E) + lt/(At·E)
    const ld = pos(spec.shankLength), lt = pos(spec.threadLength);
    if (ld === null || lt === null) return { ok: false, error: 'series bolt stiffness needs positive shankLength and threadLength (mm)' };
    if (d === null) return { ok: false, error: 'series bolt stiffness needs a boltDiameter (mm) for the shank area' };
    const Ad = (Math.PI / 4) * d * d;
    const at = resolveStressArea({ stressArea: spec.stressArea, boltDiameter: d, pitch: spec.pitch });
    if (!at.ok) return at;
    const kd = (Ad * Eb.value) / ld; // shank spring
    const kt = (at.value.At * Eb.value) / lt; // threaded spring
    kb = (kd * kt) / (kd + kt);
    kbBasis = `series shank+thread (Ad=${r(Ad, 2)}mm², At=${r(at.value.At, 2)}mm²)`;
  } else {
    // nominal kb = Ab·Eb/L
    if (grip === null) return { ok: false, error: 'nominal bolt stiffness needs a positive grip length (mm)' };
    let Ab = spec.boltArea !== undefined ? pos(spec.boltArea) : null;
    if (Ab === null) {
      if (d === null) return { ok: false, error: 'nominal bolt stiffness needs a boltArea (mm²) or a boltDiameter (mm)' };
      Ab = (Math.PI / 4) * d * d;
    }
    kb = (Ab * Eb.value) / grip;
    kbBasis = `nominal Ab·Eb/L (Ab=${r(Ab, 2)}mm²)`;
  }

  // ── member stiffness km ──
  let km: number; let kmBasis: string;
  if (spec.memberStiffness !== undefined) {
    const v = pos(spec.memberStiffness);
    if (v === null) return { ok: false, error: 'memberStiffness must be positive (N/mm)' };
    km = v; kmBasis = 'explicit memberStiffness';
  } else {
    if (d === null || grip === null) return { ok: false, error: 'frustum member stiffness needs a boltDiameter (mm) and grip length (mm), or an explicit memberStiffness' };
    const t = TAN_FRUSTUM;
    const num = Math.PI * Em.value * d * t;
    const arg = 5 * (grip * t + 0.5 * d) / (grip * t + 2.5 * d);
    const ln = Math.log(arg);
    if (!(ln > 0)) return { ok: false, error: 'degenerate frustum geometry (ln term ≤ 0)' };
    km = num / (2 * ln);
    kmBasis = `Shigley 30° frustum (D=1.5d, Em=${r(Em.value)}MPa)`;
  }

  if (!(kb > 0) || !(km > 0)) return { ok: false, error: 'could not resolve positive bolt and member stiffnesses' };

  const C = kb / (kb + km);
  const memberFraction = 1 - C;

  // ── optional load split ──
  let preload: number | null = null, ext: number | null = null;
  let boltInc: number | null = null, memberDec: number | null = null;
  let Fb: number | null = null, Fm: number | null = null, separated: boolean | null = null;
  const Fi = spec.preload !== undefined ? nonneg(spec.preload) : null;
  const P = spec.externalLoad !== undefined ? fin(spec.externalLoad) : null;
  if (Fi !== null && P !== null) {
    preload = Fi; ext = P;
    boltInc = C * P;
    memberDec = memberFraction * P;
    Fb = Fi + boltInc;
    Fm = Fi - memberDec;
    separated = Fm <= 0;
  } else if (spec.preload !== undefined && Fi === null) {
    return { ok: false, error: 'preload must be a non-negative number (N)' };
  } else if (spec.externalLoad !== undefined && P === null) {
    return { ok: false, error: 'externalLoad must be a finite number (N)' };
  }

  return {
    ok: true,
    value: {
      boltStiffness_N_per_mm: r(kb, 2),
      memberStiffness_N_per_mm: r(km, 2),
      stiffnessConstant_C: r(C, 6),
      memberLoadFraction: r(memberFraction, 6),
      boltStiffnessBasis: kbBasis,
      memberStiffnessBasis: kmBasis,
      preload_N: preload === null ? null : r(preload, 2),
      externalLoad_N: ext === null ? null : r(ext, 2),
      boltLoadIncrease_N: boltInc === null ? null : r(boltInc, 2),
      memberLoadDecrease_N: memberDec === null ? null : r(memberDec, 2),
      boltForce_N: Fb === null ? null : r(Fb, 2),
      memberForce_N: Fm === null ? null : r(Fm, 2),
      jointSeparated: separated,
    },
  };
}

// ─── Separation load (the members open when Fm = 0) ──────────────────────────

export type SeparationResult = {
  stiffnessConstant_C: number;
  memberLoadFraction: number;   // 1 − C
  preload_N: number;            // Fi
  separationLoad_N: number;     // P0 = Fi/(1−C)
  externalLoad_N: number | null; // P
  safetyFactor: number | null;  // n0 = P0/P
  adequate: boolean | null;     // P0 ≥ P
};

/**
 * The external load that just separates the joint (member force → 0):
 * P0 = Fi/(1 − C). Give the stiffness constant `C` directly, or `boltStiffness`
 * and `memberStiffness` to derive it. A supplied `externalLoad` P adds the
 * separation safety factor n0 = P0/P.
 */
export function separationLoad(spec: {
  preload: number;             // Fi (N)
  stiffnessConstant?: number;  // C
  boltStiffness?: number;      // kb → C
  memberStiffness?: number;    // km → C
  externalLoad?: number;       // P (N)
}): JointResult<SeparationResult> {
  const Fi = pos(spec.preload);
  if (Fi === null) return { ok: false, error: 'separation load needs a positive preload Fi (N)' };

  let C: number;
  if (spec.stiffnessConstant !== undefined) {
    const c = fin(spec.stiffnessConstant);
    if (c === null || !(c > 0 && c < 1)) return { ok: false, error: 'stiffnessConstant C must be strictly between 0 and 1' };
    C = c;
  } else {
    const kb = pos(spec.boltStiffness), km = pos(spec.memberStiffness);
    if (kb === null || km === null) return { ok: false, error: 'supply a stiffnessConstant C, or both boltStiffness and memberStiffness (N/mm)' };
    C = kb / (kb + km);
  }

  const memberFraction = 1 - C;
  const P0 = Fi / memberFraction;

  const P = spec.externalLoad !== undefined ? pos(spec.externalLoad) : null;
  const n0 = P === null ? null : P0 / P;

  return {
    ok: true,
    value: {
      stiffnessConstant_C: r(C, 6),
      memberLoadFraction: r(memberFraction, 6),
      preload_N: r(Fi, 2),
      separationLoad_N: r(P0, 2),
      externalLoad_N: P === null ? null : r(P, 2),
      safetyFactor: n0 === null ? null : r(n0, 4),
      adequate: n0 === null ? null : P0 >= P!,
    },
  };
}

// ─── Bolt fatigue (the alternating stress carries only the factor C) ─────────

export type BoltFatigueResult = {
  stiffnessConstant_C: number;
  stressArea_mm2: number;      // At
  stressAreaBasis: string;
  preload_N: number;           // Fi
  loadMin_N: number;           // Pmin
  loadMax_N: number;           // Pmax
  alternatingForce_N: number;  // C·(Pmax−Pmin)/2
  meanForce_N: number;         // Fi + C·(Pmax+Pmin)/2
  alternating_MPa: number;     // σa
  mean_MPa: number;            // σm
  preloadStress_MPa: number;   // σi = Fi/At
  maxStress_MPa: number;       // σmax = σm + σa
  Se_MPa: number;
  Su_MPa: number;
  Sy_MPa: number | null;
  nf_goodman: number;          // standard 1/(σa/Se + σm/Su)
  nf_preload: number | null;   // Shigley Eq. 8-45, preload-referenced
  nf_yield: number | null;     // first-cycle Sy/σmax
  governing: 'fatigue' | 'first_cycle_yield';
  governing_n: number;
  notes: string[];
};

/**
 * Bolt fatigue under a fluctuating external load Pmin..Pmax. The bolt sees only
 * the factor C of the load swing, so σa = C·(Pmax − Pmin)/(2·At) and
 * σm = [Fi + C·(Pmax + Pmin)/2]/At on the tensile stress area At (`stressArea`,
 * or from `boltDiameter`/`pitch`). Reports the standard modified-Goodman factor
 * nf = 1/(σa/Se + σm/Su) AND the preload-referenced Shigley factor
 * nf = Se·(Su − σi)/(Su·σa + Se·(σm − σi)) that credits the preload; a supplied
 * `proof`/`yield` Sy adds the first-cycle check ny = Sy/σmax and governs when it
 * is the lower factor. C is explicit (`stiffnessConstant`) or from
 * `boltStiffness`+`memberStiffness`.
 */
export function boltFatigue(spec: {
  stiffnessConstant?: number;  // C
  boltStiffness?: number;      // kb → C
  memberStiffness?: number;    // km → C
  preload: number;             // Fi (N)  (≥ 0; 0 recovers the un-preloaded Goodman)
  loadMin?: number;            // Pmin (N), default 0
  loadMax: number;             // Pmax (N)
  stressArea?: number;         // At (mm²)
  boltDiameter?: number;       // d (mm) → At
  pitch?: number;              // thread pitch (mm) → At
  ultimate: number;            // Su (MPa)
  endurance: number;           // Se (MPa)
  proof?: number;              // Sp / Sy (MPa), first-cycle yield ceiling
  yield?: number;              // alias for proof
}): JointResult<BoltFatigueResult> {
  // stiffness constant C
  let C: number;
  if (spec.stiffnessConstant !== undefined) {
    const c = fin(spec.stiffnessConstant);
    if (c === null || !(c > 0 && c < 1)) return { ok: false, error: 'stiffnessConstant C must be strictly between 0 and 1' };
    C = c;
  } else {
    const kb = pos(spec.boltStiffness), km = pos(spec.memberStiffness);
    if (kb === null || km === null) return { ok: false, error: 'supply a stiffnessConstant C, or both boltStiffness and memberStiffness (N/mm)' };
    C = kb / (kb + km);
  }

  const Fi = spec.preload !== undefined ? nonneg(spec.preload) : null;
  if (Fi === null) return { ok: false, error: 'bolt fatigue needs a non-negative preload Fi (N)' };

  const Pmin = spec.loadMin !== undefined ? fin(spec.loadMin) : 0;
  if (Pmin === null) return { ok: false, error: 'loadMin must be a finite number (N)' };
  const Pmax = fin(spec.loadMax);
  if (Pmax === null) return { ok: false, error: 'bolt fatigue needs a finite loadMax (N)' };
  if (!(Pmax > Pmin)) return { ok: false, error: 'loadMax must exceed loadMin (a non-zero load range)' };

  const at = resolveStressArea({ stressArea: spec.stressArea, boltDiameter: spec.boltDiameter, pitch: spec.pitch });
  if (!at.ok) return at;
  const At = at.value.At;

  const Su = pos(spec.ultimate);
  if (Su === null) return { ok: false, error: 'bolt fatigue needs a positive ultimate strength Su (MPa)' };
  const Se = pos(spec.endurance);
  if (Se === null) return { ok: false, error: 'bolt fatigue needs a positive endurance limit Se (MPa)' };
  const SyRaw = spec.proof !== undefined ? spec.proof : spec.yield;
  const Sy = SyRaw !== undefined ? pos(SyRaw) : null;

  const altForce = (C * (Pmax - Pmin)) / 2;
  const meanForce = Fi + (C * (Pmax + Pmin)) / 2;
  const sigA = altForce / At;
  const sigM = meanForce / At;
  const sigI = Fi / At;
  const sigMax = sigM + sigA;

  if (sigI >= Su) return { ok: false, error: `preload stress σi = ${r(sigI)} MPa reaches the ultimate Su = ${r(Su)} MPa — the bolt is overloaded by preload alone` };

  // standard modified Goodman (penalises the whole mean, preload included)
  const goodDen = sigA / Se + sigM / Su;
  const nfGoodman = goodDen > 0 ? 1 / goodDen : Infinity;

  // preload-referenced Goodman (Shigley Eq. 8-45): load line starts at σi
  const preDen = Su * sigA + Se * (sigM - sigI);
  const nfPreload = preDen > 0 ? (Se * (Su - sigI)) / preDen : null;

  // first-cycle yield (Langer)
  const nfYield = Sy !== null && sigMax > 0 ? Sy / sigMax : null;

  const notes: string[] = [];
  notes.push(`The bolt carries only C = ${r(C, 4)} of the external load range, so σa = ${r(sigA, 3)} MPa is small; the preload dominates the mean (σi = ${r(sigI, 2)} of σm = ${r(sigM, 2)} MPa).`);
  notes.push(`nf_goodman = ${r(nfGoodman, 3)} is the naive form (penalises the preload mean); nf_preload = ${nfPreload === null ? 'n/a' : r(nfPreload, 3)} credits the preload as the load-line origin (Shigley Eq. 8-45) and is the correct, higher factor.`);

  const fatigueN = nfPreload !== null ? nfPreload : nfGoodman;
  let governing: BoltFatigueResult['governing'] = 'fatigue';
  let governingN = fatigueN;
  if (nfYield !== null && nfYield < governingN) { governing = 'first_cycle_yield'; governingN = nfYield; }

  if (governing === 'first_cycle_yield') notes.push(`First-cycle yield governs (ny = ${r(nfYield!, 3)}): preload helps fatigue only up to the yield ceiling σmax = ${r(sigMax, 2)} ≤ Sy.`);
  if (fatigueN < 1) notes.push(`Fatigue factor ${r(fatigueN, 3)} < 1 — predicted to fail in fatigue under this load cycle.`);

  return {
    ok: true,
    value: {
      stiffnessConstant_C: r(C, 6),
      stressArea_mm2: r(At, 3),
      stressAreaBasis: at.value.basis,
      preload_N: r(Fi, 2),
      loadMin_N: r(Pmin, 2),
      loadMax_N: r(Pmax, 2),
      alternatingForce_N: r(altForce, 2),
      meanForce_N: r(meanForce, 2),
      alternating_MPa: r(sigA, 4),
      mean_MPa: r(sigM, 4),
      preloadStress_MPa: r(sigI, 4),
      maxStress_MPa: r(sigMax, 4),
      Se_MPa: r(Se, 4),
      Su_MPa: r(Su, 4),
      Sy_MPa: Sy === null ? null : r(Sy, 4),
      nf_goodman: r(nfGoodman, 4),
      nf_preload: nfPreload === null ? null : r(nfPreload, 4),
      nf_yield: nfYield === null ? null : r(nfYield, 4),
      governing,
      governing_n: r(governingN, 4),
      notes,
    },
  };
}
