/**
 * engineeringJournalBearingCore — HYDRODYNAMIC JOURNAL (sleeve) BEARING, the
 * fluid-film complement to the rolling-element life lane in engineeringBearingCore.
 *
 * TWO KINDS OF BEARING, ONE JOB. A rolling-element bearing (engineeringBearingCore)
 * carries the shaft on hardened balls or rollers and is sized by fatigue: the L10
 * life L10=(C/P)^p. A JOURNAL bearing carries the shaft an entirely different way —
 * it floats it on a wedge of pressurised oil, with NO rolling elements and, ideally,
 * no metal-to-metal contact at all. The shaft (the "journal") turns inside a slightly
 * larger sleeve; its rotation drags oil into the converging gap and the resulting
 * hydrodynamic pressure lifts and centres it. So this core is about the OIL FILM, not
 * fatigue — friction, film thickness, and power loss, all governed by viscosity.
 *
 * THE ONE DIMENSIONLESS GROUP — SOMMERFELD. Everything about a journal bearing's
 * performance collapses onto a single dimensionless bearing characteristic number,
 * the Sommerfeld number:
 *
 *     S = (r/c)² · (μ·N / P)
 *
 * where r is the journal radius, c the radial clearance, μ the oil's dynamic
 * viscosity, N the rotational speed in REVOLUTIONS PER SECOND, and P the projected
 * unit load W/(2r·L). Given S (and L/D), the Raimondi–Boyd charts return the friction
 * variable (r/c)·f, the minimum-film ratio h0/c, the eccentricity, the flow, and the
 * peak-pressure position. S is the master variable — a big S means lightly loaded /
 * fast / thick oil (a fat, safe film); a small S means heavily loaded / slow / thin
 * oil (a thin film, closer to contact).
 *
 * PETROFF — THE CLEAN CONCENTRIC ANCHOR. Before the loaded (eccentric) solution,
 * Petroff (1883) solved the lightly-loaded limit where the journal sits essentially
 * CONCENTRIC in the sleeve and simply shears the full film at clearance c. That gives
 * a closed-form friction coefficient with no charts:
 *
 *     f = 2π²·(μ·N / P)·(r/c) = 2π²·S·(c/r)      ⇒      (r/c)·f = 2π²·S
 *
 * so Petroff is exactly the straight "(r/c)f = 2π²S" line the Raimondi–Boyd friction
 * curve merges with at high S. It is the concentric (ε→0), lightly-loaded limit and
 * is a LOWER bound on real friction: a loaded bearing runs eccentric, its film is
 * thin on one side, and the extra shear there makes the true (r/c)f exceed the Petroff
 * line — increasingly so as load rises (S falls). We keep Petroff as the exact analytic
 * anchor and let a caller pass the Raimondi–Boyd chart values (frictionVariable = (r/c)f,
 * minFilmRatio = h0/c) for the loaded case rather than hard-coding the charts.
 *
 * FILM THICKNESS. The minimum oil film thickness is h0 = c·(1 − ε), where ε = e/c is
 * the eccentricity ratio (0 = perfectly concentric, thickest film = c; 1 = journal
 * touching sleeve, h0 = 0 = failure). Keeping h0 safely above the surface roughness is
 * the whole design constraint.
 *
 * UNIT DISCIPLINE. Bearing data arrives in millimetres, rpm, and (in older texts)
 * reyns — the perfect place for a scale bug to hide. This core converts EVERYTHING to
 * SI base units at the boundary (mm → m, rpm → rev/s, reyn → Pa·s) and does all
 * physics in m / kg / s / Pa, where S, f, and the Petroff group are factor-free, then
 * reports back in convenient units (MPa, μm, W). Note the two speeds that must not be
 * confused: N (rev/s) drives S and Petroff; ω = 2πN (rad/s) drives the power loss.
 *   S             = (r/c)²·μN/P              dimensionless  (N in rev/s)
 *   P             = W / (2r·L)               Pa             (projected unit load)
 *   f (Petroff)   = 2π²·(μN/P)·(r/c)         dimensionless  (concentric limit)
 *   Tf            = f·W·r                     N·m            (friction torque)
 *   power         = Tf·ω = Tf·2πN            W
 *   h0            = c·(1 − ε)                 m              (min film thickness)
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-journal-bearing-core-smoketest.ts):
 * self-contained, no imports, no I/O. Reference: Shigley, "Mechanical Engineering
 * Design", ch. 12 (Lubrication and Journal Bearings); Petroff's equation.
 */

export type JournalBearingResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** 1 reyn = 1 lbf·s/in² = 6894.757 Pa·s (numerically the psi→Pa factor, since reyn = psi·s). */
export const REYN_TO_PA_S = 6894.757293;

const TWO_PI = 2 * Math.PI;
const TWO_PI_SQ = 2 * Math.PI * Math.PI; // 2π², the Petroff constant

/**
 * Representative dynamic viscosities μ (Pa·s) of common lubricating oils at a typical
 * bearing operating film temperature (~60 °C). Viscosity is STRONGLY temperature
 * dependent, so these are order-of-magnitude design values (drawn from the usual
 * SAE ↔ ISO-VG viscosity–temperature charts); for precise work supply μ directly
 * (viscosity in Pa·s, or viscosityReyn). Keys normalise so "SAE 30" → "sae30".
 */
export type OilProps = { name: string; mu: number };
export const OILS: Record<string, OilProps> = {
  sae10: { name: 'SAE 10 oil (~60 °C)', mu: 0.019 },
  sae20: { name: 'SAE 20 oil (~60 °C)', mu: 0.026 },
  sae30: { name: 'SAE 30 oil (~60 °C)', mu: 0.037 },
  sae40: { name: 'SAE 40 oil (~60 °C)', mu: 0.052 },
  sae50: { name: 'SAE 50 oil (~60 °C)', mu: 0.077 },
  sae60: { name: 'SAE 60 oil (~60 °C)', mu: 0.110 },
};

export type JournalBearingSpec = {
  // ── geometry (mm) ──
  radius?: number;            // journal radius r (mm)
  diameter?: number;          // journal diameter d (mm) — alternative to radius
  clearance?: number;         // radial clearance c (mm)
  radialClearance?: number;   // alias for clearance
  diametralClearance?: number;// diametral clearance (mm) = 2c — converted to radial
  length?: number;            // bearing length Lb (mm)
  // ── viscosity (choose one) ──
  viscosity?: number;         // dynamic viscosity μ (Pa·s) — the SI default
  viscosityReyn?: number;     // μ in reyn (lbf·s/in²), converted ×6894.757 → Pa·s
  oil?: string;               // named lubricant / SAE grade lookup (OILS)
  // ── speed (choose one) ──
  speed?: number;             // rotational speed N (rev/s) — the SI default
  speed_rpm?: number;         // alternative: rpm, converted /60 → rev/s
  // ── load ──
  load: number;               // radial load W (N)
  // ── film / eccentricity (optional) ──
  eccentricity?: number;      // ε = e/c in [0,1); default 0.5 (moderate film) if omitted
  minFilmRatio?: number;      // h0/c from the Raimondi–Boyd chart → sets ε = 1 − h0/c
  // ── loaded-case friction (optional Raimondi–Boyd chart override) ──
  frictionVariable?: number;  // (r/c)·f read from the R–B chart at this S; overrides Petroff
};

export type JournalBearingSolution = {
  // resolved geometry
  radius_mm: number;
  diameter_mm: number;
  clearance_mm: number;
  length_mm: number;
  radiusClearanceRatio: number;      // r/c
  lengthDiameterRatio: number;       // L/D
  // resolved operating conditions (SI at the boundary)
  viscosity_Pa_s: number;
  viscositySource: 'pas' | 'reyn' | 'oil';
  speed_rev_s: number;
  speed_rpm: number;
  angularVelocity_rad_s: number;     // ω = 2πN
  load_N: number;
  unitLoad_Pa: number;               // P = W/(2r·Lb)
  unitLoad_MPa: number;
  viscositySpeedLoad: number;        // the μN/P group
  // the governing dimensionless number
  sommerfeld: number;                // S = (r/c)²·μN/P
  // friction (Petroff concentric anchor, or supplied chart value)
  friction: number;                  // f
  frictionVariable: number;          // (r/c)·f  (= 2π²·S for Petroff)
  frictionSource: 'petroff' | 'chart';
  petroffFriction: number;           // the pure Petroff f, always reported for comparison
  frictionTorque_Nm: number;         // Tf = f·W·r
  powerLoss_W: number;               // Tf·ω
  // film
  eccentricity: number;              // ε
  eccentricitySource: 'input' | 'chart' | 'default';
  minFilmThickness_mm: number;       // h0 = c·(1−ε)
  minFilmThickness_um: number;
  notes: string[];
};

/** Resolve the oil viscosity μ (Pa·s) plus which source it came from. */
function resolveViscosity(spec: JournalBearingSpec): { mu: number; source: 'pas' | 'reyn' | 'oil' } | { error: string } {
  if (spec.viscosity !== undefined) {
    const mu = pos(spec.viscosity);
    if (mu === null) return { error: 'viscosity must be a positive number (Pa·s)' };
    return { mu, source: 'pas' };
  }
  if (spec.viscosityReyn !== undefined) {
    const rey = pos(spec.viscosityReyn);
    if (rey === null) return { error: 'viscosityReyn must be a positive number (reyn)' };
    return { mu: rey * REYN_TO_PA_S, source: 'reyn' };
  }
  if (spec.oil !== undefined) {
    const key = String(spec.oil).trim().toLowerCase().replace(/[\s_-]+/g, '');
    const o = OILS[key];
    if (!o) return { error: `unknown oil "${spec.oil}" — use one of ${Object.keys(OILS).join(', ')}, or supply viscosity (Pa·s) / viscosityReyn` };
    return { mu: o.mu, source: 'oil' };
  }
  return { error: 'supply a viscosity (Pa·s), a viscosityReyn, or an oil name (e.g. sae30)' };
}

/**
 * Full hydrodynamic journal-bearing solve. Give geometry (r or d, radial clearance c,
 * length Lb — all mm), an oil viscosity, a speed, and the radial load W (N); get the
 * Sommerfeld number, the Petroff (concentric) friction, torque, power loss, and the
 * minimum film thickness. Pass a Raimondi–Boyd frictionVariable and/or minFilmRatio
 * to override the concentric estimate for a genuinely loaded bearing.
 */
export function journalBearing(spec: JournalBearingSpec): JournalBearingResult<JournalBearingSolution> {
  // ── geometry (mm) → resolve radius ──
  let r_mm: number | null = spec.radius !== undefined ? pos(spec.radius) : null;
  if (r_mm === null && spec.diameter !== undefined) { const d = pos(spec.diameter); if (d !== null) r_mm = d / 2; }
  if (r_mm === null) return { ok: false, error: 'journal bearing needs a positive radius r (mm) or diameter d (mm)' };

  // radial clearance c (mm): accept clearance / radialClearance, or diametral / 2
  let c_mm: number | null = spec.clearance !== undefined ? pos(spec.clearance)
    : spec.radialClearance !== undefined ? pos(spec.radialClearance) : null;
  if (c_mm === null && spec.diametralClearance !== undefined) { const dc = pos(spec.diametralClearance); if (dc !== null) c_mm = dc / 2; }
  if (c_mm === null) return { ok: false, error: 'journal bearing needs a positive radial clearance c (mm) — or diametralClearance (=2c)' };
  if (c_mm >= r_mm) return { ok: false, error: 'radial clearance c must be far smaller than the journal radius r' };

  const Lb_mm = spec.length !== undefined ? pos(spec.length) : null;
  if (Lb_mm === null) return { ok: false, error: 'journal bearing needs a positive length Lb (mm)' };

  // ── viscosity μ (Pa·s) ──
  const visc = resolveViscosity(spec);
  if ('error' in visc) return { ok: false, error: visc.error };
  const mu = visc.mu;

  // ── speed N (rev/s) — convert rpm at the boundary ──
  let N: number | null = spec.speed !== undefined ? pos(spec.speed) : null;
  if (N === null && spec.speed_rpm !== undefined) { const rpm = pos(spec.speed_rpm); if (rpm !== null) N = rpm / 60; }
  if (N === null) return { ok: false, error: 'journal bearing needs a positive speed N (rev/s) or speed_rpm' };

  // ── load W (N) ──
  const W = pos(spec.load);
  if (W === null) return { ok: false, error: 'journal bearing needs a positive radial load W (N)' };

  // ── eccentricity ε ──
  let eps: number;
  let epsSource: 'input' | 'chart' | 'default';
  if (spec.eccentricity !== undefined) {
    const e = fin(spec.eccentricity);
    if (e === null || e < 0 || e >= 1) return { ok: false, error: 'eccentricity ε must be in [0, 1) (0 concentric, →1 is metal-to-metal failure)' };
    eps = e; epsSource = 'input';
  } else if (spec.minFilmRatio !== undefined) {
    const hr = fin(spec.minFilmRatio);
    if (hr === null || hr <= 0 || hr > 1) return { ok: false, error: 'minFilmRatio h0/c must be in (0, 1]' };
    eps = 1 - hr; epsSource = 'chart';
  } else {
    eps = 0.5; epsSource = 'default';
  }

  // ── all physics in SI base units ──
  const r_m = r_mm / 1000;
  const c_m = c_mm / 1000;
  const Lb_m = Lb_mm / 1000;
  const rc = r_m / c_m;                        // r/c (dimensionless — mm ratio would be identical)
  const P = W / (2 * r_m * Lb_m);              // projected unit load, Pa
  const muN_P = (mu * N) / P;                  // the μN/P group (dimensionless)
  const S = rc * rc * muN_P;                   // Sommerfeld number (dimensionless)

  // Petroff (concentric) friction coefficient — the analytic anchor.
  const petroffF = TWO_PI_SQ * muN_P * rc;     // = 2π²·S·(c/r)

  // Friction: Petroff by default, or the supplied Raimondi–Boyd (r/c)f for the loaded case.
  let frictionVar: number;                     // (r/c)·f
  let fricSource: 'petroff' | 'chart';
  if (spec.frictionVariable !== undefined) {
    const fv = pos(spec.frictionVariable);
    if (fv === null) return { ok: false, error: 'frictionVariable (r/c)·f must be a positive number' };
    frictionVar = fv; fricSource = 'chart';
  } else {
    frictionVar = TWO_PI_SQ * S;               // Petroff line (r/c)f = 2π²S
    fricSource = 'petroff';
  }
  const f = frictionVar / rc;                  // coefficient of friction
  const Tf = f * W * r_m;                       // friction torque, N·m  (r in metres!)
  const omega = TWO_PI * N;                     // rad/s
  const power = Tf * omega;                     // W

  const h0_m = c_m * (1 - eps);                 // minimum film thickness, m

  const notes: string[] = [
    'Sommerfeld S = (r/c)²·μN/P is the single dimensionless group governing the bearing (N in rev/s).',
    fricSource === 'petroff'
      ? 'Friction is the Petroff concentric-limit estimate f = 2π²·(μN/P)·(r/c); a real loaded (eccentric) bearing runs at higher (r/c)f — supply frictionVariable from a Raimondi–Boyd chart for the loaded value.'
      : 'Friction uses the supplied Raimondi–Boyd chart (r/c)f; the pure Petroff concentric value is reported separately for comparison.',
    `Minimum film h0 = c·(1−ε) with ε=${r(eps, 4)} (${epsSource}); ε→1 means h0→0, metal-to-metal contact and failure.`,
  ];

  return {
    ok: true,
    value: {
      radius_mm: r(r_mm, 5),
      diameter_mm: r(2 * r_mm, 5),
      clearance_mm: r(c_mm, 6),
      length_mm: r(Lb_mm, 5),
      radiusClearanceRatio: r(rc, 4),
      lengthDiameterRatio: r(Lb_mm / (2 * r_mm), 4),
      viscosity_Pa_s: r(mu, 8),
      viscositySource: visc.source,
      speed_rev_s: r(N, 5),
      speed_rpm: r(N * 60, 3),
      angularVelocity_rad_s: r(omega, 4),
      load_N: r(W, 3),
      unitLoad_Pa: r(P, 2),
      unitLoad_MPa: r(P / 1e6, 6),
      viscositySpeedLoad: r(muN_P, 10),
      sommerfeld: r(S, 6),
      friction: r(f, 7),
      frictionVariable: r(frictionVar, 5),
      frictionSource: fricSource,
      petroffFriction: r(petroffF, 7),
      frictionTorque_Nm: r(Tf, 5),
      powerLoss_W: r(power, 4),
      eccentricity: r(eps, 5),
      eccentricitySource: epsSource,
      minFilmThickness_mm: r(h0_m * 1000, 6),
      minFilmThickness_um: r(h0_m * 1e6, 4),
      notes,
    },
  };
}
