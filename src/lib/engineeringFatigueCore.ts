/**
 * engineeringFatigueCore — FATIGUE: failure under CYCLIC loading. This is the
 * analysis every one of the geometry generators is ultimately serving, because
 * the overwhelming majority of machine parts that break do not break from a
 * single overload — they break from a stress that is comfortably below the
 * static strength, applied over and over until a crack nucleates and grows. A
 * shaft, a spring, a bracket, a gear tooth, a bolted joint: each is sized not by
 * "will it hold once" but "will it survive a million cycles", and that is a
 * different, less intuitive question with its own textbook machinery.
 *
 * THE ENDURANCE LIMIT. For steels there is a stress amplitude below which the
 * part lasts essentially forever — the endurance (or fatigue) limit. The
 * idealised rotating-beam specimen gives Se' = 0.5·Su (capped at ~700 MPa,
 * because the correlation flattens for very hard steels), but a real part is
 * never that specimen. The MARIN factors knock Se' down for the ways reality
 * differs: ka for surface finish (a rough surface is a field of tiny stress
 * risers — ground ≈ 0.9, machined ≈ 0.8, hot-rolled ≈ 0.7, as-forged ≈ 0.6), kb
 * for size (a bigger section has more volume at high stress, so more places for
 * a crack to start — ≈ 1 for small parts), and kc for load type (bending 1,
 * axial 0.85, torsion 0.59). Se = ka·kb·kc·Se'. The multiplicative form is the
 * whole idea: each effect is an independent discount on the ideal limit.
 *
 * MEAN STRESS. A cycle is an ALTERNATING amplitude σa riding on a MEAN σm. A
 * tensile mean is damaging — it holds the crack open — so a part that is fine
 * fully-reversed can fail with the same amplitude added to a mean. Three
 * textbook failure lines connect the pure-alternating limit Se to the pure-mean
 * limit (Su or Sy):
 *   • modified GOODMAN (a straight line to Su):   1/n = σa/Se + σm/Su
 *   • SODERBERG (a straight line to the YIELD Sy): 1/n = σa/Se + σm/Sy
 *   • GERBER (a parabola to Su):  n·σa/Se + (n·σm/Su)² = 1
 * They nest, and that nesting is a verification gift: because Sy < Su and the
 * parabola bows above the Goodman line, for any tensile mean it is ALWAYS true
 * that n_Soderberg < n_Goodman < n_Gerber. Soderberg never predicts yielding,
 * so it is the safe design choice; Gerber best fits test data but is optimistic;
 * Goodman is the common compromise. For σm ≤ 0 (fully reversed, or a compressive
 * mean whose benefit we conservatively refuse to credit) all three collapse to
 * n = Se/σa. Goodman is paired with the first-cycle LANGER yield check
 * n_y = Sy/(σa+σm), because a design can be safe against fatigue yet yield on
 * the very first peak — the part fails by whichever line it reaches first.
 *
 * FINITE LIFE (S-N / BASQUIN). Above the endurance limit the part has a finite
 * life. On a log-log plot the high-cycle line runs between (10³ cycles, f·Su)
 * and (10⁶ cycles, Se) with f ≈ 0.9, i.e. S = a·N^b where a = (f·Su)²/Se and
 * b = −⅓·log₁₀(f·Su/Se). Invert it for N = (σa/a)^(1/b). Below Se → infinite
 * life; above f·Su → low-cycle (this elastic S-N line no longer applies).
 *
 * VERIFICATION PHILOSOPHY. Like the rest of the analysis lane, this core is
 * closed-form, so its correctness is proven DIRECTLY: the smoke asserts every
 * formula against a hand-computed reference (σa=100, σm=50, Su=500, Se=200 gives
 * n_Goodman = 1/(0.5+0.1) = 1.6667, exactly), and — more powerfully — against
 * the internal INVARIANTS that a single point value can hide: the strict nesting
 * n_Soderberg < n_Goodman < n_Gerber catches a swapped criterion, the S-N line
 * anchoring exactly on f·Su at 10³ and on Se at 10⁶ catches a wrong a or b, and
 * the fully-reversed collapse to Se/σa catches a mean-stress sign error. The
 * smoke IS the proof; there is no app, no engine, no ambiguity. The one place we
 * cannot be exact is when only a material is named and no ultimate is given: we
 * estimate Su ≈ 1.7·yield, which is clearly flagged as a rough stand-in, never a
 * measured value.
 *
 * UNITS. Stresses in MPa throughout (Se, Su, Sy, σa, σm); life in dimensionless
 * cycles. Safety factors are ratios.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-fatigue-core-smoketest.ts):
 * the ONLY import is the MATERIALS table from engineeringCalcCore (itself
 * import-free), no I/O, no Date.now()/Math.random(), total functions.
 */

import { MATERIALS } from './engineeringCalcCore';

export type FatigueResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 4): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

// ─── Marin surface-finish factor ka (representative approximations) ──────────
// The rigorous Shigley form is ka = a·Su^b per finish; these constants are the
// commonly-quoted round values the task asks for and are good to ~±0.05. Pass an
// explicit surfaceFactor when a real ka is known.
const SURFACE_FINISH: Record<string, number> = {
  polished: 1.0, mirror: 1.0, mirror_polished: 1.0,
  ground: 0.9,
  machined: 0.8, cold_drawn: 0.8, cold_rolled: 0.8,
  hot_rolled: 0.7,
  as_forged: 0.6, forged: 0.6,
};

// ─── Marin load factor kc ────────────────────────────────────────────────────
const LOAD_KC: Record<string, number> = { bending: 1, axial: 0.85, torsion: 0.59, shear: 0.59 };

/**
 * Marin size factor kb from a section diameter (mm), bending/torsion only —
 * axial loading has no size effect (kb = 1). Shigley's correlation:
 *   2.79 ≤ d ≤ 51 mm : kb = 1.24·d^-0.107
 *   51 < d ≤ 254 mm  : kb = 1.51·d^-0.157
 * Below ~2.8 mm it is taken as 1.
 */
function sizeFactorFromDiameter(d: number, loadType: string): number {
  if (loadType === 'axial') return 1;
  if (d <= 2.79) return 1;
  if (d <= 51) return 1.24 * Math.pow(d, -0.107);
  return 1.51 * Math.pow(d, -0.157);
}

function materialLookup(name: string | undefined) {
  if (!name) return undefined;
  return MATERIALS[String(name).trim().toLowerCase()];
}

// ─── Endurance limit (Marin) ─────────────────────────────────────────────────

export type EnduranceLimitResult = {
  Se_MPa: number;        // corrected endurance limit
  SePrime_MPa: number;   // Se' rotating-beam (0.5·Su, capped 700)
  Su_MPa: number;        // ultimate strength used
  ka_surface: number;
  kb_size: number;
  kc_load: number;
  loadType: 'bending' | 'axial' | 'torsion';
  surfaceFinish: string; // label of the ka source
  capped: boolean;       // Se' hit the 700 MPa cap (Su > 1400)
  suEstimated: boolean;  // Su came from 1.7·yield rather than an input
};

/**
 * Corrected endurance limit Se = ka·kb·kc·Se', with Se' = 0.5·Su (steel,
 * rotating-beam) capped at 700 MPa for Su > 1400. Supply an ultimate `ultimate`
 * (MPa) or a `material` (Su estimated as 1.7·yield). ka comes from an explicit
 * `surfaceFactor` or a `surfaceFinish` name; kb from a `sizeFactor` or a
 * `diameter` (mm); kc from `loadType` (bending | axial | torsion).
 */
export function enduranceLimit(spec: {
  ultimate?: number;
  material?: string;
  surfaceFactor?: number;
  surfaceFinish?: string;
  sizeFactor?: number;
  diameter?: number;
  loadType?: string;
}): FatigueResult<EnduranceLimitResult> {
  const mat = materialLookup(spec.material);
  let Su = spec.ultimate !== undefined ? pos(spec.ultimate) : null;
  let suEstimated = false;
  if (Su === null && mat) { Su = 1.7 * mat.yield; suEstimated = true; }
  if (Su === null) return { ok: false, error: 'endurance limit needs an ultimate strength (ultimate, MPa) or a material to estimate it' };

  const capped = Su > 1400;
  const SePrime = capped ? 700 : 0.5 * Su;

  const loadKey = String(spec.loadType ?? 'bending').trim().toLowerCase();
  const kc = LOAD_KC[loadKey];
  if (kc === undefined) return { ok: false, error: `unknown loadType "${spec.loadType}" — use bending, axial, or torsion` };
  const loadType = (loadKey === 'shear' ? 'torsion' : loadKey) as 'bending' | 'axial' | 'torsion';

  let ka: number; let surfaceLabel: string;
  const sf = spec.surfaceFactor !== undefined ? pos(spec.surfaceFactor) : null;
  if (sf !== null) { ka = sf; surfaceLabel = `factor ${r(sf, 3)}`; }
  else if (spec.surfaceFinish) {
    const key = String(spec.surfaceFinish).trim().toLowerCase().replace(/[\s-]+/g, '_');
    const v = SURFACE_FINISH[key];
    if (v === undefined) return { ok: false, error: `unknown surfaceFinish "${spec.surfaceFinish}" — use ${Object.keys(SURFACE_FINISH).join(', ')} or pass surfaceFactor` };
    ka = v; surfaceLabel = key;
  } else { ka = 1; surfaceLabel = 'polished (assumed)'; }

  let kb: number;
  const kbFactor = spec.sizeFactor !== undefined ? pos(spec.sizeFactor) : null;
  const dia = spec.diameter !== undefined ? pos(spec.diameter) : null;
  if (kbFactor !== null) kb = kbFactor;
  else if (dia !== null) kb = sizeFactorFromDiameter(dia, loadType);
  else kb = 1;

  const Se = ka * kb * kc * SePrime;
  return {
    ok: true,
    value: {
      Se_MPa: r(Se), SePrime_MPa: r(SePrime), Su_MPa: r(Su),
      ka_surface: r(ka, 4), kb_size: r(kb, 4), kc_load: r(kc, 4),
      loadType, surfaceFinish: surfaceLabel, capped, suEstimated,
    },
  };
}

// ─── Mean-stress safety factor (Goodman / Soderberg / Gerber + yield) ────────

export type GoodmanResult = {
  criterion: 'goodman';
  n_goodman: number;
  n_soderberg: number | null; // needs a yield strength
  n_gerber: number | null;    // parabola, needs Su (σm > 0)
  n_yield: number | null;     // first-cycle Langer check, needs yield
  governing: 'goodman' | 'first_cycle_yield';
  governing_n: number;
  alternating_MPa: number;
  mean_MPa: number;
  Se_MPa: number;
  Su_MPa: number;
  Sy_MPa: number | null;
  fullyReversed: boolean;
  seEstimated: boolean;
  suEstimated: boolean;
  notes: string[];
};

/**
 * Mean-stress safety factors. The headline is modified GOODMAN
 * n = 1/(σa/Se + σm/Su); SODERBERG (uses yield Sy) and GERBER (parabola to Su)
 * come alongside, plus the first-cycle yield check n_y = Sy/(σa+σm). For σm ≤ 0
 * the criteria collapse to the fully-reversed n = Se/σa (a compressive mean's
 * benefit is not credited). Supply σa (`alternating`, MPa) and Se (`endurance`),
 * plus Su (`ultimate`) and optionally Sy (`yield`) — or a `material` to fill Su
 * (≈1.7·yield) and Sy. Se falls back to 0.5·Su (uncorrected) if omitted.
 */
export function goodmanSafetyFactor(spec: {
  alternating: number;
  mean?: number;
  ultimate?: number;
  endurance?: number;
  yield?: number;
  material?: string;
}): FatigueResult<GoodmanResult> {
  const sigA = pos(spec.alternating);
  if (sigA === null) return { ok: false, error: 'fatigue needs a positive alternating stress (alternating, MPa)' };
  const sigM = spec.mean !== undefined ? fin(spec.mean) : 0;
  if (sigM === null) return { ok: false, error: 'mean stress must be a finite number (MPa)' };

  const mat = materialLookup(spec.material);
  let Su = spec.ultimate !== undefined ? pos(spec.ultimate) : null;
  let suEstimated = false;
  if (Su === null && mat) { Su = 1.7 * mat.yield; suEstimated = true; }
  if (Su === null) return { ok: false, error: 'Goodman/Gerber need an ultimate strength (ultimate, MPa) or a material' };

  let Sy = spec.yield !== undefined ? pos(spec.yield) : null;
  if (Sy === null && mat) Sy = mat.yield;

  let Se = spec.endurance !== undefined ? pos(spec.endurance) : null;
  let seEstimated = false;
  if (Se === null) { Se = 0.5 * Su; seEstimated = true; }
  if (Se === null || !(Se > 0)) return { ok: false, error: 'need an endurance limit (endurance, MPa) or an ultimate to estimate it' };

  const notes: string[] = [];
  if (suEstimated) notes.push(`Su estimated as 1.7·yield = ${r(Su)} MPa (rough — supply a measured ultimate for accuracy).`);
  if (seEstimated) notes.push(`Se estimated as 0.5·Su = ${r(Se)} MPa (uncorrected Se'; run endurance_limit with Marin factors for a real value).`);

  let nGood: number; let nSod: number | null; let nGer: number | null;
  const fullyReversed = sigM <= 0;
  if (fullyReversed) {
    nGood = Se / sigA; nSod = Se / sigA; nGer = Se / sigA;
    notes.push(sigM < 0
      ? 'Compressive mean stress — treated as fully reversed (its benefit is not credited; conservative), n = Se/σa.'
      : 'Fully reversed (σm = 0): n = Se/σa for every criterion.');
  } else {
    nGood = 1 / (sigA / Se + sigM / Su);
    nSod = Sy !== null ? 1 / (sigA / Se + sigM / Sy) : null;
    const term = (2 * sigM * Se) / (Su * sigA);
    nGer = 0.5 * Math.pow(Su / sigM, 2) * (sigA / Se) * (-1 + Math.sqrt(1 + term * term));
  }

  const sigMax = sigA + sigM; // tensile peak of the cycle
  const nYield = Sy !== null && sigMax > 0 ? Sy / sigMax : null;

  let governing: GoodmanResult['governing'] = 'goodman';
  let governingN = nGood;
  if (nYield !== null && nYield < governingN) { governing = 'first_cycle_yield'; governingN = nYield; }

  if (nGood < 1) notes.push(`n_Goodman = ${r(nGood, 3)} < 1 — predicted to FAIL by fatigue under this stress cycle.`);
  else if (nYield !== null && nYield < 1) notes.push(`First-cycle yield factor ${r(nYield, 3)} < 1 — yields on the first peak before fatigue matters.`);
  else notes.push(`Governing factor ${r(governingN, 2)} (${governing === 'goodman' ? 'fatigue, Goodman' : 'first-cycle yield'}).`);

  return {
    ok: true,
    value: {
      criterion: 'goodman',
      n_goodman: r(nGood, 4),
      n_soderberg: nSod !== null ? r(nSod, 4) : null,
      n_gerber: nGer !== null ? r(nGer, 4) : null,
      n_yield: nYield !== null ? r(nYield, 4) : null,
      governing, governing_n: r(governingN, 4),
      alternating_MPa: r(sigA), mean_MPa: r(sigM),
      Se_MPa: r(Se), Su_MPa: r(Su), Sy_MPa: Sy !== null ? r(Sy) : null,
      fullyReversed, seEstimated, suEstimated, notes,
    },
  };
}

// ─── Fully-reversed finite life (S-N / Basquin) ──────────────────────────────

export type FatigueLifeResult = {
  alternating_MPa: number;
  Su_MPa: number;
  Se_MPa: number;
  fraction_f: number;
  sn_a: number; // S = a·N^b
  sn_b: number;
  cycles: number | null; // null ⇒ infinite life
  classification: 'infinite' | 'finite' | 'low_cycle';
};

/**
 * Fully-reversed life from the high-cycle S-N line. The line runs between
 * (10³ cycles, f·Su) and (10⁶ cycles, Se), so S = a·N^b with a = (f·Su)²/Se and
 * b = −⅓·log₁₀(f·Su/Se); life N = (σa/a)^(1/b). σa ≤ Se → infinite life; σa ≥
 * f·Su → low-cycle (this elastic line no longer applies). Supply σa
 * (`alternating`), Su (`ultimate` or `material`), Se (`endurance`, else 0.5·Su),
 * and optional `fraction` f (default 0.9).
 */
export function fullyReversedLife(spec: {
  alternating: number;
  ultimate?: number;
  endurance?: number;
  material?: string;
  fraction?: number;
}): FatigueResult<FatigueLifeResult> {
  const sigA = pos(spec.alternating);
  if (sigA === null) return { ok: false, error: 'life needs a positive alternating stress (alternating, MPa)' };
  const mat = materialLookup(spec.material);
  let Su = spec.ultimate !== undefined ? pos(spec.ultimate) : null;
  if (Su === null && mat) Su = 1.7 * mat.yield;
  if (Su === null) return { ok: false, error: 'life needs an ultimate strength (ultimate, MPa) or a material' };
  const Se = spec.endurance !== undefined ? pos(spec.endurance) : 0.5 * Su;
  if (Se === null || !(Se > 0)) return { ok: false, error: 'life needs a positive endurance limit (endurance, MPa)' };
  const fRaw = spec.fraction !== undefined ? pos(spec.fraction) : null;
  const f = fRaw !== null ? fRaw : 0.9;
  if (!(f > 0 && f < 1)) return { ok: false, error: 'fraction f must be between 0 and 1 (default 0.9)' };
  if (!(Se < f * Su)) return { ok: false, error: `endurance (${r(Se)}) must be below f·Su (${r(f * Su)}) to define an S-N line` };

  const a = Math.pow(f * Su, 2) / Se;
  const b = -(1 / 3) * Math.log10((f * Su) / Se);

  let cycles: number | null; let classification: FatigueLifeResult['classification'];
  if (sigA <= Se) { cycles = null; classification = 'infinite'; }
  else {
    const N = Math.pow(sigA / a, 1 / b);
    cycles = Math.round(N);
    classification = sigA >= f * Su ? 'low_cycle' : 'finite';
  }

  return {
    ok: true,
    value: {
      alternating_MPa: r(sigA), Su_MPa: r(Su), Se_MPa: r(Se), fraction_f: r(f, 3),
      sn_a: r(a, 4), sn_b: r(b, 6),
      cycles, classification,
    },
  };
}
