/**
 * engineeringFinCore — EXTENDED-SURFACE (FIN) heat transfer: the natural
 * extension of the thermal core's two primitives, CONDUCTION (k) and CONVECTION
 * (h). A fin is quite literally both at once. Heat conducts ALONG the fin
 * (governed by the conduction group k·Ac) while, all the way down its length,
 * convection strips heat OFF its surface (governed by h·P). A fin is the tug of
 * war between those two: adding metal in the flow direction that convection can
 * then shed to the fluid. It only pays off when convection — not conduction — is
 * the bottleneck, which is why you see fins on air-cooled surfaces (small h) and
 * almost never inside a boiling passage (huge h).
 *
 * THE UNIFYING IDEA — THE FIN PARAMETER m. Solving the 1-D fin equation
 * d²θ/dx² = m²θ, with θ = T(x) − T∞ the local temperature excess, produces ONE
 * dimensionless group that governs everything:
 *
 *     m = √( h·P / (k·Ac) )      [units 1/m]
 *
 * — big when convection off the surface (h·P) dominates conduction down the core
 * (k·Ac), small the other way. Every fin quantity is a function of the single
 * dimensionless product mL:
 *
 *   • Temperature (insulated/adiabatic tip):   θ(x)/θb = cosh(m(L−x)) / cosh(mL)
 *   • Heat dissipated:   Q = √(h·P·k·Ac)·θb·tanh(mL) = M·tanh(mL),  M = √(hPkAc)·θb
 *   • Fin EFFICIENCY:    η = Q / Q_ideal = tanh(mL) / (mL)
 *   • Fin EFFECTIVENESS: ε = Q / (h·Ac·θb)   (fin heat ÷ bare-base heat)
 *
 * Efficiency η compares the fin to an IDEAL fin held everywhere at the base
 * temperature (Q_ideal = h·P·L·θb). Because tanh(mL)/(mL) → 1 as mL → 0 and → 0
 * as mL → ∞, a short/fat/high-conductivity fin is nearly isothermal and ideal,
 * while a long fin's tip is dead weight — past about mL ≈ 2.3 the extra length
 * barely raises Q at all (tanh has saturated). Effectiveness ε compares the fin
 * to NO fin (bare base area Ac); ε must clear roughly 2 to justify the fin, and
 * — the key physical fact — ε = √(k·P/(h·Ac))·tanh(mL) falls as h rises, so a fin
 * helps precisely when the convection coefficient is small.
 *
 * A convecting (not perfectly insulated) tip is handled with the standard
 * corrected-length simplification Lc = L + Ac/P: pretend the fin is a touch
 * longer and adiabatic, which folds the tip's convecting area into the sides.
 *
 * UNITS. SI internally: k in W/(m·K), h in W/(m²·K), lengths in metres, area in
 * m², temperature excess in K (= °C difference), heat rate in W. Fin geometry
 * (width, thickness, diameter, length) is taken in mm and converted at the
 * boundary — the same convert-at-the-edges discipline the thermal and fluid
 * cores use. It reuses MATERIALS (which now carry thermal conductivity k), so the
 * same aluminium you size structurally conducts heat in a fin here.
 *
 * References: Incropera & DeWitt, Fundamentals of Heat and Mass Transfer, ch. 3
 * (extended surfaces); Cengel, Heat and Mass Transfer, ch. 3 (fins).
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-fin-core-smoketest.ts): one
 * import (MATERIALS for the conductivity lookup), no Date.now(), no I/O.
 */

import { MATERIALS } from './engineeringCalcCore';

export type FinResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 5): number { if (!Number.isFinite(n)) return n; const f = Math.pow(10, dp); return Math.round(n * f) / f; }

/** Conductivity from an explicit k/conductivity, or a MATERIALS lookup. */
function conductivityOf(spec: any): number | null {
  if (spec?.k !== undefined) return pos(spec.k);
  if (spec?.conductivity !== undefined) return pos(spec.conductivity);
  if (spec?.material) { const m = MATERIALS[String(spec.material).trim().toLowerCase()]; if (m) return m.k; }
  return null;
}

// ─── Fin cross-section geometry ──────────────────────────────────────────────

export type FinShape = 'rectangular' | 'pin' | 'custom';

export type FinGeometry = { shape: FinShape; crossSectionArea_m2: number; perimeter_m: number };

/**
 * Resolve the fin's cross-section area Ac (m²) and wetted perimeter P (m) from
 * either a named shape with mm dimensions, or explicit SI Ac + perimeter.
 *   • rectangular fin: Ac = w·t,  P = 2(w+t)   (width w, thickness t, in mm)
 *   • pin / spine fin: Ac = πd²/4, P = πd       (diameter d, in mm)
 *   • custom:          Ac, perimeter supplied directly in SI (m², m)
 */
export function finGeometry(spec: any): FinResult<FinGeometry> {
  const rawShape = spec?.shape ? String(spec.shape).trim().toLowerCase() : '';
  const d = pos(spec?.diameter);
  const w = pos(spec?.width);
  const t = pos(spec?.thickness);
  const AcEx = pos(spec?.crossSectionArea ?? spec?.Ac ?? spec?.area);
  const Pex = pos(spec?.perimeter);

  const wantsPin = rawShape === 'pin' || rawShape === 'pin_fin' || rawShape === 'spine' || rawShape === 'cylindrical';
  const wantsRect = rawShape === 'rectangular' || rawShape === 'rect' || rawShape === 'straight' || rawShape === 'fin';
  const wantsCustom = rawShape === 'custom';

  if (wantsPin || (!rawShape && d !== null && w === null && t === null && AcEx === null)) {
    if (d === null) return { ok: false, error: 'pin fin needs a positive diameter (mm)' };
    const dm = d / 1000;
    return { ok: true, value: { shape: 'pin', crossSectionArea_m2: (Math.PI * dm * dm) / 4, perimeter_m: Math.PI * dm } };
  }
  if (wantsRect || (!rawShape && w !== null && t !== null)) {
    if (w === null || t === null) return { ok: false, error: 'rectangular fin needs positive width and thickness (mm)' };
    const wm = w / 1000, tm = t / 1000;
    return { ok: true, value: { shape: 'rectangular', crossSectionArea_m2: wm * tm, perimeter_m: 2 * (wm + tm) } };
  }
  if (wantsCustom || (AcEx !== null && Pex !== null)) {
    if (AcEx === null || Pex === null) return { ok: false, error: 'custom fin needs crossSectionArea Ac (m²) and perimeter (m)' };
    return { ok: true, value: { shape: 'custom', crossSectionArea_m2: AcEx, perimeter_m: Pex } };
  }
  return { ok: false, error: 'supply a fin shape: rectangular (width,thickness mm), pin (diameter mm), or custom (crossSectionArea m², perimeter m)' };
}

// ─── Fin analysis ────────────────────────────────────────────────────────────

export type FinAnalysisResult = {
  shape: FinShape;
  tip: 'adiabatic' | 'convective';
  conductivity_W_per_mK: number;
  filmCoefficient_W_per_m2K: number;
  crossSectionArea_m2: number;
  perimeter_m: number;
  length_m: number;
  /** Corrected length Lc used in the formulas: L for an adiabatic tip, L+Ac/P for a convecting tip. */
  correctedLength_m: number;
  baseExcess_K: number; // θb = Tb − T∞
  finParameter_per_m: number; // m = √(hP/kAc)
  mL: number; // dimensionless m·Lc — the single group that governs the fin
  M_W: number; // M = √(hPkAc)·θb, the maximum (mL→∞) heat rate
  heatRate_W: number; // Q = M·tanh(mL)
  efficiency: number; // η = tanh(mL)/(mL)
  effectiveness: number; // ε = Q/(h·Ac·θb)
  finSurfaceArea_m2: number; // Af = P·Lc
  tipExcess_K: number; // θ at the physical tip
  tipTemperature_C: number | null; // T∞ + θ_tip, only when ambient is given
  /** θ at x = 0, L/4, L/2, 3L/4, L along the fin (hot base → cooler tip). */
  profileExcess_K: number[];
  /** Absolute temperatures for the same stations, only when ambient is given. */
  profileTemperature_C: number[] | null;
};

/**
 * Analyse a straight fin of uniform cross-section (rectangular or pin/spine).
 *
 * Inputs (all optional unless noted):
 *   conductivity — k (W/m·K) or `conductivity`, or `material` (MATERIALS lookup)
 *   h            — convection coefficient (W/m²·K)   [required]
 *   length       — fin length L (mm)                 [required]
 *   geometry     — shape 'rectangular' {width,thickness mm} | 'pin' {diameter mm}
 *                  | 'custom' {crossSectionArea m², perimeter m}
 *   base excess  — thetaBase / baseExcess (K), OR baseTemp & ambientTemp (°C)
 *   tip          — 'adiabatic' (default) or 'convective' (corrected length Lc)
 *
 * Returns m, mL, M, Q, efficiency η, effectiveness ε, the tip temperature, and a
 * five-station temperature profile.
 */
export function finAnalysis(spec: {
  k?: number;
  conductivity?: number;
  material?: string;
  h?: number;
  length?: number;
  shape?: string;
  width?: number;
  thickness?: number;
  diameter?: number;
  crossSectionArea?: number;
  Ac?: number;
  area?: number;
  perimeter?: number;
  thetaBase?: number;
  baseExcess?: number;
  baseTemp?: number;
  ambientTemp?: number;
  tip?: string;
}): FinResult<FinAnalysisResult> {
  const k = conductivityOf(spec);
  if (k === null) return { ok: false, error: `supply a conductivity k (W/m·K) or a material (${Object.keys(MATERIALS).join(', ')})` };
  const h = pos(spec.h);
  if (h === null) return { ok: false, error: 'fin needs a positive convection coefficient h (W/m²·K)' };
  const L_mm = pos(spec.length);
  if (L_mm === null) return { ok: false, error: 'fin needs a positive length (mm)' };
  const L = L_mm / 1000;

  // Base temperature excess θb = Tb − T∞.
  let thetaB: number | null = null;
  if (spec.thetaBase !== undefined) thetaB = pos(spec.thetaBase);
  else if (spec.baseExcess !== undefined) thetaB = pos(spec.baseExcess);
  else if (spec.baseTemp !== undefined && spec.ambientTemp !== undefined) {
    const tb = fin(spec.baseTemp), ta = fin(spec.ambientTemp);
    if (tb !== null && ta !== null && tb - ta > 0) thetaB = tb - ta;
  }
  if (thetaB === null) return { ok: false, error: 'fin needs a positive base excess: thetaBase (K), or baseTemp > ambientTemp (°C)' };

  const g = finGeometry(spec);
  if (!g.ok) return g;
  const { shape, crossSectionArea_m2: Ac, perimeter_m: P } = g.value;

  // Fin parameter m and the tip model.
  const m = Math.sqrt((h * P) / (k * Ac));
  const tipRaw = String(spec.tip ?? 'adiabatic').trim().toLowerCase();
  const tipMode: 'adiabatic' | 'convective' =
    (tipRaw === 'convective' || tipRaw === 'convecting' || tipRaw === 'corrected') ? 'convective' : 'adiabatic';
  const Lc = tipMode === 'convective' ? L + Ac / P : L;
  const mLc = m * Lc;

  const tanhMLc = Math.tanh(mLc);
  const coshMLc = Math.cosh(mLc);
  const M = Math.sqrt(h * P * k * Ac) * thetaB;
  const Q = M * tanhMLc;
  const efficiency = mLc === 0 ? 1 : tanhMLc / mLc;
  const effectiveness = Q / (h * Ac * thetaB);
  const Af = P * Lc;

  // Temperature excess along the physical fin x ∈ [0, L], adiabatic-at-Lc model:
  // θ(x)/θb = cosh(m(Lc − x)) / cosh(mLc). x=0 → θb; x=L → tip.
  const excessAt = (x: number): number => thetaB! * Math.cosh(m * (Lc - x)) / coshMLc;
  const tipExcess = excessAt(L);
  const ambient = spec.ambientTemp !== undefined ? fin(spec.ambientTemp) : null;
  const stations = [0, 0.25, 0.5, 0.75, 1].map((f) => f * L);
  const profileExcess = stations.map((x) => excessAt(x));

  return {
    ok: true,
    value: {
      shape,
      tip: tipMode,
      conductivity_W_per_mK: k,
      filmCoefficient_W_per_m2K: h,
      crossSectionArea_m2: Ac,
      perimeter_m: P,
      length_m: r(L, 6),
      correctedLength_m: r(Lc, 6),
      baseExcess_K: r(thetaB, 5),
      finParameter_per_m: r(m, 5),
      mL: r(mLc, 6),
      M_W: r(M, 5),
      heatRate_W: r(Q, 5),
      efficiency: r(efficiency, 6),
      effectiveness: r(effectiveness, 5),
      finSurfaceArea_m2: r(Af, 8),
      tipExcess_K: r(tipExcess, 5),
      tipTemperature_C: ambient !== null ? r(ambient + tipExcess, 3) : null,
      profileExcess_K: profileExcess.map((e) => r(e, 4)),
      profileTemperature_C: ambient !== null ? profileExcess.map((e) => r(ambient + e, 3)) : null,
    },
  };
}
