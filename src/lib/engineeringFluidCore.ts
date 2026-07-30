/**
 * engineeringFluidCore — PIPE HYDRAULICS, the fluids arm of the analysis suite
 * and the natural partner to the pipe geometry: model a pipe or elbow, then push
 * a fluid through it and find the Reynolds number, the flow regime, the friction
 * factor, and the Darcy–Weisbach pressure drop. Composes the pipe bore diameter.
 *
 * UNIT DISCIPLINE. Fluid mechanics mixes millimetres, litres, and pascals, which
 * is exactly where sign/scale bugs hide — so this core converts everything to SI
 * BASE units at the boundary (diameter mm → m, roughness mm → m, flow L/min →
 * m³/s) and does all physics in m / kg / s / Pa, then reports both Pa and kPa.
 * Every returned quantity is SI so the formulas are factor-free.
 *
 * THE PHYSICS, TEXTBOOK-EXACT.
 *   Reynolds     Re = ρ·V·D/μ                     (dimensionless)
 *   regime       laminar Re < 2300, turbulent Re > 4000, transition between
 *   friction f   laminar 64/Re; turbulent Swamee–Jain
 *                f = 0.25 / [log₁₀(ε/D/3.7 + 5.74/Re^0.9)]²
 *   head loss    h_f = f·(L/D)·V²/(2g)            (m of fluid)
 *   pressure     Δp  = f·(L/D)·ρV²/2 = ρ·g·h_f    (Pa)
 *   continuity   Q = V·A,  A = π(D/2)²
 * The laminar factor and Reynolds are exact; the turbulent Swamee–Jain is
 * cross-checked in the smoke against the independent Blasius correlation
 * (0.316/Re^0.25) for a smooth pipe, where they must agree within a few percent.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-fluid-core-smoketest.ts):
 * self-contained, no imports, no I/O.
 */

export type FluidResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }

const G = 9.80665; // standard gravity, m/s²

/** Common fluids at ~20 °C: density ρ (kg/m³) and dynamic viscosity μ (Pa·s). */
export type FluidProps = { name: string; rho: number; mu: number };
export const FLUIDS: Record<string, FluidProps> = {
  water: { name: 'Water (20 °C)', rho: 998, mu: 1.002e-3 },
  seawater: { name: 'Seawater (20 °C)', rho: 1025, mu: 1.07e-3 },
  air: { name: 'Air (20 °C, 1 atm)', rho: 1.204, mu: 1.825e-5 },
  oil: { name: 'Engine oil SAE30 (20 °C)', rho: 888, mu: 0.29 },
  glycerin: { name: 'Glycerin (20 °C)', rho: 1261, mu: 1.41 },
  ethanol: { name: 'Ethanol (20 °C)', rho: 789, mu: 1.2e-3 },
};

/** Reynolds number Re = ρ·V·D/μ (SI inputs: V m/s, D m). */
export function reynoldsNumber(rho: number, velocity: number, diameter_m: number, mu: number): number {
  return (rho * velocity * diameter_m) / mu;
}

export function flowRegime(Re: number): 'laminar' | 'transition' | 'turbulent' {
  if (Re < 2300) return 'laminar';
  if (Re > 4000) return 'turbulent';
  return 'transition';
}

/** Darcy friction factor: laminar 64/Re, turbulent Swamee–Jain. `relRoughness` = ε/D. */
export function frictionFactor(Re: number, relRoughness = 0): number {
  if (Re <= 0) return NaN;
  if (Re < 2300) return 64 / Re;
  const denom = Math.log10(relRoughness / 3.7 + 5.74 / Math.pow(Re, 0.9));
  return 0.25 / (denom * denom);
}

export type PipeFlowSpec = {
  diameter: number; // mm (pipe bore)
  velocity?: number; // m/s
  flowRate?: number; // L/min
  flowRate_m3s?: number; // m³/s (alternative)
  length?: number; // m (for pressure drop)
  fluid?: string;
  density?: number; // kg/m³ override
  viscosity?: number; // Pa·s override
  roughness?: number; // mm (absolute pipe roughness ε); default 0 (smooth)
};

export type PipeFlowResult = {
  diameter_mm: number;
  area_m2: number;
  velocity_m_s: number;
  flowRate_m3_s: number;
  flowRate_L_min: number;
  reynolds: number;
  regime: 'laminar' | 'transition' | 'turbulent';
  frictionFactor: number;
  relRoughness: number;
  length_m: number | null;
  headLoss_m: number | null;
  pressureDrop_Pa: number | null;
  pressureDrop_kPa: number | null;
  fluid: string;
  density_kg_m3: number;
  viscosity_Pa_s: number;
};

/** Full pipe-flow solve: give a velocity OR a flow rate; get Re, regime, f, Δp. */
export function pipeFlow(spec: PipeFlowSpec): FluidResult<PipeFlowResult> {
  const D_mm = pos(spec.diameter);
  if (D_mm === null) return { ok: false, error: 'pipe flow needs a positive diameter (mm)' };
  const D = D_mm / 1000; // m
  const area = Math.PI * (D / 2) ** 2;

  // fluid properties
  let rho: number | null = spec.density !== undefined ? pos(spec.density) : null;
  let mu: number | null = spec.viscosity !== undefined ? pos(spec.viscosity) : null;
  if ((rho === null || mu === null) && spec.fluid) {
    const f = FLUIDS[String(spec.fluid).trim().toLowerCase()];
    if (f) { if (rho === null) rho = f.rho; if (mu === null) mu = f.mu; }
  }
  if (rho === null || mu === null) return { ok: false, error: `supply a fluid (${Object.keys(FLUIDS).join(', ')}) or explicit density + viscosity` };

  // velocity from either V or Q
  let V: number | null = spec.velocity !== undefined ? pos(spec.velocity) : null;
  let Q_m3s: number | null = null;
  if (V === null) {
    if (spec.flowRate_m3s !== undefined) Q_m3s = pos(spec.flowRate_m3s);
    else if (spec.flowRate !== undefined) { const q = pos(spec.flowRate); if (q !== null) Q_m3s = q / 60000; } // L/min → m³/s
    if (Q_m3s === null) return { ok: false, error: 'supply a velocity (m/s) or a flowRate (L/min or flowRate_m3s)' };
    V = Q_m3s / area;
  } else {
    Q_m3s = V * area;
  }

  const eps_mm = spec.roughness !== undefined ? fin(spec.roughness) : 0;
  const eps = (eps_mm !== null && eps_mm >= 0 ? eps_mm : 0) / 1000; // m
  const relRough = eps / D;

  const Re = reynoldsNumber(rho, V, D, mu);
  const regime = flowRegime(Re);
  const f = frictionFactor(Re, relRough);

  const L = spec.length !== undefined ? pos(spec.length) : null;
  let headLoss: number | null = null, dP: number | null = null;
  if (L !== null) {
    headLoss = f * (L / D) * (V * V) / (2 * G);
    dP = f * (L / D) * (rho * V * V) / 2;
  }

  return {
    ok: true,
    value: {
      diameter_mm: D_mm,
      area_m2: r(area, 8),
      velocity_m_s: r(V, 5),
      flowRate_m3_s: r(Q_m3s, 8),
      flowRate_L_min: r(Q_m3s * 60000, 3),
      reynolds: r(Re, 1),
      regime,
      frictionFactor: r(f, 6),
      relRoughness: r(relRough, 8),
      length_m: L,
      headLoss_m: headLoss === null ? null : r(headLoss, 5),
      pressureDrop_Pa: dP === null ? null : r(dP, 3),
      pressureDrop_kPa: dP === null ? null : r(dP / 1000, 5),
      fluid: spec.fluid ? String(spec.fluid).trim().toLowerCase() : 'custom',
      density_kg_m3: rho,
      viscosity_Pa_s: mu,
    },
  };
}
