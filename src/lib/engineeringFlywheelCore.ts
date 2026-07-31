/**
 * engineeringFlywheelCore — FLYWHEEL energy storage & speed-fluctuation sizing,
 * the ROTATING-INERTIA arm of the analysis suite. A flywheel is a mechanical
 * battery: it stores kinetic energy KE = ½·I·ω² while the driver runs ahead of
 * the load and gives it back when the load runs ahead of the driver, so the
 * shaft speed only wobbles inside a tolerance band instead of surging. This core
 * sizes that wobble — how much rotating inertia you must add to hold the speed
 * within a target coefficient of fluctuation — and checks the rim can survive
 * being spun that fast.
 *
 * THE THREE THINGS IT COMPUTES.
 *   1. flywheelInertia — the mass moment of inertia I of the common flywheel
 *      shapes. A solid disc keeps I = ½·m·r²; a thin rim keeps I = m·r²; a thick
 *      annular ring keeps I = ½·m·(ro² + ri²). Given geometry + a material it
 *      finds the mass first (mass = ρ·volume) and then I; or it accepts a mass
 *      (or I) directly. This is where "put the metal at the rim, not the hub"
 *      is quantified — see the 2× anchor below.
 *   2. flywheelEnergy — the SIZING relation. The energy the flywheel must trade
 *      each cycle to hold the band is ΔE = I·ωavg²·Cs, where the coefficient of
 *      fluctuation Cs = (ωmax − ωmin)/ωavg is the fractional speed swing you
 *      allow. Rearranged, the REQUIRED inertia is I = ΔE/(ωavg²·Cs): a tighter
 *      (smaller) Cs demands a proportionally LARGER flywheel. It also reports the
 *      stored KE = ½·I·ωavg² and the bracketing speeds ωmax, ωmin.
 *   3. flywheelStress — the LIMIT. A spinning rim is a hoop in tension; the
 *      bursting (tangential) stress is σ = ρ·v² = ρ·(ω·r)². Set σ to the
 *      allowable and the burst rim speed is v_burst = √(σ_allow/ρ) — which
 *      depends only on the MATERIAL, not the size (a scale-invariance: a small
 *      steel wheel and a big one burst at the same RIM speed, just different
 *      rpm). This is why flywheels are speed-limited, not size-limited.
 *
 * UNITS — THE ONE PLACE FLYWHEELS BITE. Energy is Joules (kg·m²/s²), so the
 * moment of inertia MUST be in kg·m² and ω in rad/s. The rest of the suite works
 * in millimetres, and the shared MATERIALS density is kg/mm³ (so mass = ρ·V_mm³
 * comes out in kg with no conversion). Radii therefore enter in mm and are
 * converted to metres (÷1000) exactly where they feed an inertia or a rim speed;
 * densities used for hoop stress convert kg/mm³ → kg/m³ (×1e9). Every boundary
 * conversion is explicit and commented so the kg·m² never silently becomes
 * kg·mm².
 *
 *   ωavg = 2π·N/60           (rev/min → rad/s)
 *   I_disc = ½·m·r²          r in metres  ⇒  I in kg·m²
 *   I_rim  = m·r²            (mass all at the rim ⇒ twice a disc's I per mass)
 *   I_annulus = ½·m·(ro²+ri²)
 *   ΔE = I·ωavg²·Cs   ⇔   I = ΔE/(ωavg²·Cs)      (sizing)
 *   KE = ½·I·ωavg²                                (stored energy)
 *   ωmax = ωavg·(1+Cs/2),  ωmin = ωavg·(1−Cs/2)   (Cs = (ωmax−ωmin)/ωavg)
 *   σ_hoop = ρ·v² = ρ·(ω·r)²,   v_burst = √(σ_allow/ρ)   (thin-rim bursting)
 *
 * Sources: Shigley, *Mechanical Engineering Design* (flywheel energy & Cs);
 * Khurmi, *Theory of Machines*, flywheel chapter (ΔE = I·ω²·Cs, rim stress
 * σ = ρ·v²). Every formula in this core is pinned to a hand-computed reference
 * in scripts/engineering-flywheel-core-smoketest.ts.
 *
 * Composes the shared material table for density (mass from geometry) and yield
 * (a default allowable for the burst check). Pure + tsx-loadable: the only
 * import is the dependency-free MATERIALS map; no I/O, no Date.now().
 */

import { MATERIALS } from './engineeringCalcCore';

export type FlywheelResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function nonneg(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
function r(n: number, dp = 4): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

const MM_PER_M = 1000; // radius mm → m: divide by this
const MM3_PER_M3 = 1e9; // 1 m³ = 1e9 mm³ (so kg/mm³ × 1e9 = kg/m³)

/** Resolve density to kg/mm³ from an explicit value or the shared material table. */
function resolveDensityKgPerMm3(spec: { density?: number; material?: string }): FlywheelResult<{ rho: number; source: string }> {
  if (spec.density !== undefined) {
    const d = pos(spec.density);
    return d === null ? { ok: false, error: 'density must be a positive number (kg/mm³)' } : { ok: true, value: { rho: d, source: 'explicit' } };
  }
  if (spec.material !== undefined) {
    const key = String(spec.material).trim().toLowerCase();
    const m = MATERIALS[key];
    if (!m) return { ok: false, error: `unknown material "${spec.material}" — use ${Object.keys(MATERIALS).join(', ')} or an explicit density (kg/mm³)` };
    return { ok: true, value: { rho: m.density, source: key } };
  }
  return { ok: false, error: 'need a material (for its density) or an explicit density (kg/mm³)' };
}

/** Mean angular speed in rad/s from an explicit rad/s value or rev/min. */
function resolveOmega(spec: { meanSpeed?: number; speed?: number; meanRpm?: number; rpm?: number }): number | null {
  if (spec.meanSpeed !== undefined) return pos(spec.meanSpeed);
  if (spec.speed !== undefined) return pos(spec.speed);
  const n = spec.meanRpm !== undefined ? spec.meanRpm : spec.rpm;
  if (n !== undefined) { const N = pos(n); return N === null ? null : (2 * Math.PI * N) / 60; }
  return null;
}

// ─── Moment of inertia (I of the flywheel shapes) ─────────────────────────────

export type FlywheelInertiaSpec = {
  /** disc (default) | rim | annulus, plus aliases (ring, thick_ring, rim_with_arms, …). */
  shape?: string;
  /** Accept the inertia directly (kg·m²) — echoed, geometry optional. */
  inertia?: number;
  /** Accept the mass directly (kg) instead of computing it from geometry. */
  mass?: number;
  radius?: number; // mm (disc/rim outer radius)
  diameter?: number; // mm (alt to radius)
  outerRadius?: number; // mm (annulus)
  outerDiameter?: number; // mm
  innerRadius?: number; // mm (annulus bore)
  innerDiameter?: number; // mm
  thickness?: number; // mm (axial) — needed for mass from geometry
  material?: string; // for density (mass from geometry)
  density?: number; // kg/mm³ (overrides material)
};

export type FlywheelShape = 'disc' | 'rim' | 'annulus';

export type FlywheelInertiaResult = {
  shape: FlywheelShape;
  inertia_kg_m2: number;
  mass_kg: number | null;
  outerRadius_mm: number | null;
  innerRadius_mm: number | null;
  thickness_mm: number | null;
  volume_mm3: number | null;
  density_kg_per_mm3: number | null;
  /** k = √(I/m) in metres — the radius of gyration (only when the mass is known). */
  radiusOfGyration_m: number | null;
  formula: string;
};

const SHAPE_ALIAS: Record<string, FlywheelShape> = {
  disc: 'disc', solid_disc: 'disc', solid: 'disc', cylinder: 'disc', flat: 'disc', plate: 'disc',
  rim: 'rim', ring: 'rim', thin_rim: 'rim', thin_ring: 'rim', hoop: 'rim', rim_with_arms: 'rim', armed: 'rim', spoked: 'rim',
  annulus: 'annulus', annular: 'annulus', thick_ring: 'annulus', annular_disc: 'annulus', hollow_disc: 'annulus', hollow: 'annulus',
};

/**
 * Mass moment of inertia of a flywheel about its spin axis. The shape sets the
 * formula — a rim keeps twice the inertia of a disc of the SAME mass and radius,
 * because a rim's mass all sits at r while a disc's is spread from the hub out
 * (that is the whole reason flywheels are rims). Mass is taken directly, or
 * derived from geometry and density (mass = ρ·V); radii convert mm → m so the
 * result is a proper kg·m². An `inertia` value may also be supplied directly.
 */
export function flywheelInertia(spec: FlywheelInertiaSpec): FlywheelResult<FlywheelInertiaResult> {
  const shapeKey = String(spec.shape || 'disc').trim().toLowerCase().replace(/[\s-]+/g, '_');
  const shape = SHAPE_ALIAS[shapeKey];
  if (!shape) return { ok: false, error: `unknown shape "${spec.shape}" — use disc, rim, or annulus` };

  // ── Radii (mm). Outer from outerRadius|outerDiameter|radius|diameter; inner optional. ──
  let ro: number | null = null;
  if (spec.outerRadius !== undefined) ro = pos(spec.outerRadius);
  else if (spec.outerDiameter !== undefined) { const d = pos(spec.outerDiameter); ro = d === null ? null : d / 2; }
  else if (spec.radius !== undefined) ro = pos(spec.radius);
  else if (spec.diameter !== undefined) { const d = pos(spec.diameter); ro = d === null ? null : d / 2; }

  let ri = 0;
  if (spec.innerRadius !== undefined) { const v = nonneg(spec.innerRadius); if (v === null) return { ok: false, error: 'innerRadius must be ≥ 0 (mm)' }; ri = v; }
  else if (spec.innerDiameter !== undefined) { const v = nonneg(spec.innerDiameter); if (v === null) return { ok: false, error: 'innerDiameter must be ≥ 0 (mm)' }; ri = v / 2; }
  if (ro !== null && ri > ro) return { ok: false, error: 'inner radius must not exceed the outer radius' };

  // ── Mass (kg): direct, or from geometry × density. ──
  let mass: number | null = spec.mass !== undefined ? pos(spec.mass) : null;
  if (spec.mass !== undefined && mass === null) return { ok: false, error: 'mass must be a positive number (kg)' };

  let volume: number | null = null;
  let densityUsed: number | null = null;
  if (mass === null && (spec.material !== undefined || spec.density !== undefined)) {
    const dr = resolveDensityKgPerMm3(spec);
    if (!dr.ok) return dr;
    densityUsed = dr.value.rho;
    const t = pos(spec.thickness);
    if (t === null) return { ok: false, error: 'mass from geometry needs a positive thickness (mm, axial)' };
    if (ro === null) return { ok: false, error: 'mass from geometry needs a radius/diameter (mm)' };
    // Disc uses the full outer disc; rim/annulus subtract the bore ring.
    const areaFace = shape === 'disc' ? Math.PI * ro ** 2 : Math.PI * (ro ** 2 - ri ** 2);
    volume = areaFace * t; // mm³
    mass = densityUsed * volume; // kg/mm³ · mm³ = kg
  }

  // ── Inertia (kg·m²). Radii converted mm → m at the formula boundary. ──
  let inertia: number;
  let formula: string;
  if (spec.inertia !== undefined) {
    const I = pos(spec.inertia);
    if (I === null) return { ok: false, error: 'inertia must be a positive number (kg·m²)' };
    inertia = I;
    formula = 'I given directly (kg·m²)';
  } else {
    if (mass === null) return { ok: false, error: 'need a mass (kg) or geometry+material to compute inertia, or an explicit inertia (kg·m²)' };
    if (ro === null) return { ok: false, error: 'inertia needs a radius/diameter (mm)' };
    const ro_m = ro / MM_PER_M;
    const ri_m = ri / MM_PER_M;
    if (shape === 'disc') {
      inertia = 0.5 * mass * ro_m ** 2;
      formula = 'I = ½·m·r²';
    } else if (shape === 'rim') {
      // Thin rim: mass at the (mean) radius. A single radius ⇒ r; a ring ⇒ mean.
      const rMean_m = ri > 0 ? (ro + ri) / 2 / MM_PER_M : ro_m;
      inertia = mass * rMean_m ** 2;
      formula = 'I = m·r²';
    } else {
      inertia = 0.5 * mass * (ro_m ** 2 + ri_m ** 2);
      formula = 'I = ½·m·(ro² + ri²)';
    }
  }

  const k = mass !== null && mass > 0 ? Math.sqrt(inertia / mass) : null; // radius of gyration, m

  return {
    ok: true,
    value: {
      shape,
      inertia_kg_m2: r(inertia, 6),
      mass_kg: mass === null ? null : r(mass, 4),
      outerRadius_mm: ro === null ? null : r(ro, 4),
      innerRadius_mm: ri > 0 ? r(ri, 4) : shape === 'annulus' ? 0 : null,
      thickness_mm: spec.thickness !== undefined ? pos(spec.thickness) : null,
      volume_mm3: volume === null ? null : r(volume, 3),
      density_kg_per_mm3: densityUsed,
      radiusOfGyration_m: k === null ? null : r(k, 6),
      formula,
    },
  };
}

// ─── Energy & sizing (ΔE = I·ωavg²·Cs) ────────────────────────────────────────

export type FlywheelEnergySpec = {
  meanRpm?: number; // rev/min → ωavg
  rpm?: number; // alias
  meanSpeed?: number; // rad/s (alt to meanRpm)
  speed?: number; // alias
  /** Coefficient of fluctuation Cs = (ωmax − ωmin)/ωavg. */
  coefficientOfFluctuation?: number;
  Cs?: number; // alias
  cs?: number; // alias
  /** Required energy fluctuation per cycle ΔE (J) — the sizing input. */
  energyFluctuation?: number;
  deltaE?: number; // alias
  /** Known inertia (kg·m²) — the forward input (compute ΔE / check Cs). */
  inertia?: number;
  I?: number; // alias
};

export type FlywheelEnergyMode = 'sizing' | 'forward' | 'regulation';

export type FlywheelEnergyResult = {
  /** sizing: solved I from ΔE+Cs. forward: solved ΔE from I+Cs. regulation: solved Cs from I+ΔE. */
  mode: FlywheelEnergyMode;
  meanSpeed_rad_s: number;
  meanRpm: number;
  coefficientOfFluctuation: number; // Cs
  maxSpeed_rad_s: number;
  minSpeed_rad_s: number;
  energyFluctuation_J: number; // ΔE
  inertia_kg_m2: number; // I (required, given, or echoed)
  kineticEnergy_J: number; // KE = ½·I·ωavg²
};

/**
 * The flywheel sizing relation ΔE = I·ωavg²·Cs, solved in whichever direction the
 * inputs allow. Given ωavg (from meanRpm or meanSpeed) plus any two of {ΔE, I, Cs}:
 *   • ΔE + Cs  → REQUIRED inertia I = ΔE/(ωavg²·Cs)   (sizing — the headline)
 *   • I  + Cs  → energy traded per cycle ΔE = I·ωavg²·Cs   (forward)
 *   • I  + ΔE  → achieved regulation Cs = ΔE/(I·ωavg²)   (regulation check)
 * Always reports the stored KE = ½·I·ωavg² and the band ωmax = ωavg(1+Cs/2),
 * ωmin = ωavg(1−Cs/2). A smaller Cs (tighter regulation) needs a bigger I.
 */
export function flywheelEnergy(spec: FlywheelEnergySpec): FlywheelResult<FlywheelEnergyResult> {
  const omega = resolveOmega(spec);
  if (omega === null) return { ok: false, error: 'flywheel energy needs a positive mean speed (meanRpm or meanSpeed rad/s)' };

  const csIn = spec.coefficientOfFluctuation ?? spec.Cs ?? spec.cs;
  const Cs = csIn !== undefined ? pos(csIn) : null;
  if (csIn !== undefined && Cs === null) return { ok: false, error: 'coefficientOfFluctuation (Cs) must be a positive number' };
  if (Cs !== null && Cs >= 2) return { ok: false, error: 'coefficientOfFluctuation (Cs) must be < 2 (else ωmin ≤ 0)' };

  const dEIn = spec.energyFluctuation ?? spec.deltaE;
  const dE = dEIn !== undefined ? pos(dEIn) : null;
  if (dEIn !== undefined && dE === null) return { ok: false, error: 'energyFluctuation (ΔE) must be a positive number (J)' };

  const iIn = spec.inertia ?? spec.I;
  const iGiven = iIn !== undefined ? pos(iIn) : null;
  if (iIn !== undefined && iGiven === null) return { ok: false, error: 'inertia (I) must be a positive number (kg·m²)' };

  const omega2 = omega ** 2;
  let mode: FlywheelEnergyMode;
  let inertia: number;
  let energyFluctuation: number;
  let csUsed: number;

  if (dE !== null && Cs !== null) {
    // Sizing: solve required inertia to hold the band.
    mode = 'sizing';
    inertia = dE / (omega2 * Cs);
    energyFluctuation = dE;
    csUsed = Cs;
  } else if (iGiven !== null && Cs !== null) {
    // Forward: how much energy the wheel trades per cycle.
    mode = 'forward';
    inertia = iGiven;
    energyFluctuation = iGiven * omega2 * Cs;
    csUsed = Cs;
  } else if (iGiven !== null && dE !== null) {
    // Regulation: the Cs a known wheel actually achieves.
    mode = 'regulation';
    inertia = iGiven;
    energyFluctuation = dE;
    csUsed = dE / (iGiven * omega2);
  } else {
    return { ok: false, error: 'need mean speed plus TWO of {energyFluctuation ΔE, inertia I, coefficientOfFluctuation Cs}' };
  }

  const kineticEnergy = 0.5 * inertia * omega2;
  const omegaMax = omega * (1 + csUsed / 2);
  const omegaMin = omega * (1 - csUsed / 2);
  const rpm = (omega * 60) / (2 * Math.PI);

  return {
    ok: true,
    value: {
      mode,
      meanSpeed_rad_s: r(omega, 6),
      meanRpm: r(rpm, 4),
      coefficientOfFluctuation: r(csUsed, 8),
      maxSpeed_rad_s: r(omegaMax, 6),
      minSpeed_rad_s: r(omegaMin, 6),
      energyFluctuation_J: r(energyFluctuation, 4),
      inertia_kg_m2: r(inertia, 6),
      kineticEnergy_J: r(kineticEnergy, 4),
    },
  };
}

// ─── Rim bursting stress (σ = ρ·v²) ───────────────────────────────────────────

export type FlywheelStressSpec = {
  radius?: number; // mm (rim radius)
  diameter?: number; // mm
  rpm?: number; // rev/min
  speed?: number; // rad/s (alt)
  /** Rim tangential velocity (m/s) directly, if speed×radius is not convenient. */
  velocity?: number;
  material?: string; // for density (and a default allowable = yield)
  density?: number; // kg/mm³ (overrides material)
  allowableStress?: number; // MPa — enables the burst speed
  yield?: number; // MPa (alt allowable; else material yield)
};

export type FlywheelStressResult = {
  density_kg_m3: number;
  radius_mm: number | null;
  rimVelocity_m_s: number;
  hoopStress_MPa: number;
  allowableStress_MPa: number | null;
  /** √(σ_allow/ρ) — depends only on the material, NOT the size (scale-invariant). */
  burstVelocity_m_s: number | null;
  burstSpeed_rad_s: number | null;
  burstRpm: number | null;
  /** σ_allow / σ_hoop = (v_burst/v)². < 1 predicts burst. */
  safetyFactor: number | null;
};

/**
 * Bursting (hoop) stress of a spinning rim: σ = ρ·v² = ρ·(ω·r)². A rim element is
 * flung outward and the ring resists in pure tension, so the stress rises with
 * the SQUARE of rim speed and does not care about the rim's thickness. Setting σ
 * to an allowable gives the burst rim speed v_burst = √(σ_allow/ρ), which is a
 * pure material property — a big wheel and a small wheel of the same steel burst
 * at the same rim VELOCITY, just at different rpm. Density resolves kg/mm³ → kg/m³
 * (×1e9); radius converts mm → m; stress reports in MPa.
 */
export function flywheelStress(spec: FlywheelStressSpec): FlywheelResult<FlywheelStressResult> {
  const dr = resolveDensityKgPerMm3(spec);
  if (!dr.ok) return dr;
  const rho_kg_m3 = dr.value.rho * MM3_PER_M3; // kg/mm³ → kg/m³

  // ── Rim velocity v (m/s): direct, or ω·r. ──
  let radius_mm: number | null = null;
  if (spec.radius !== undefined) radius_mm = pos(spec.radius);
  else if (spec.diameter !== undefined) { const d = pos(spec.diameter); radius_mm = d === null ? null : d / 2; }
  if ((spec.radius !== undefined || spec.diameter !== undefined) && radius_mm === null) return { ok: false, error: 'radius/diameter must be positive (mm)' };

  let v: number;
  if (spec.velocity !== undefined) {
    const vv = pos(spec.velocity);
    if (vv === null) return { ok: false, error: 'velocity must be a positive number (m/s)' };
    v = vv;
  } else {
    const omega = resolveOmega(spec);
    if (omega === null) return { ok: false, error: 'rim stress needs a velocity (m/s) or a speed (rpm/speed) plus a radius' };
    if (radius_mm === null) return { ok: false, error: 'rim stress from a rotational speed needs a radius/diameter (mm)' };
    v = omega * (radius_mm / MM_PER_M); // rad/s · m = m/s
  }

  const sigma_Pa = rho_kg_m3 * v ** 2;
  const sigma_MPa = sigma_Pa / 1e6;

  // ── Burst check (optional). ──
  const allowIn = spec.allowableStress ?? spec.yield ?? (spec.material ? MATERIALS[String(spec.material).trim().toLowerCase()]?.yield : undefined);
  let allow_MPa: number | null = null;
  let vBurst: number | null = null;
  let omegaBurst: number | null = null;
  let rpmBurst: number | null = null;
  let sf: number | null = null;
  if (allowIn !== undefined) {
    const a = pos(allowIn);
    if (a === null) return { ok: false, error: 'allowableStress must be a positive number (MPa)' };
    allow_MPa = a;
    vBurst = Math.sqrt((a * 1e6) / rho_kg_m3); // √(σ_allow/ρ), m/s — size-independent
    sf = (a * 1e6) / sigma_Pa;
    if (radius_mm !== null) {
      omegaBurst = vBurst / (radius_mm / MM_PER_M);
      rpmBurst = (omegaBurst * 60) / (2 * Math.PI);
    }
  }

  return {
    ok: true,
    value: {
      density_kg_m3: r(rho_kg_m3, 4),
      radius_mm: radius_mm === null ? null : r(radius_mm, 4),
      rimVelocity_m_s: r(v, 5),
      hoopStress_MPa: r(sigma_MPa, 5),
      allowableStress_MPa: allow_MPa,
      burstVelocity_m_s: vBurst === null ? null : r(vBurst, 5),
      burstSpeed_rad_s: omegaBurst === null ? null : r(omegaBurst, 5),
      burstRpm: rpmBurst === null ? null : r(rpmBurst, 3),
      safetyFactor: sf === null ? null : r(sf, 5),
    },
  };
}
