/**
 * engineeringWormGearCore — WORM-AND-WHEEL drives: the machine element that
 * gets a HUGE speed reduction (10:1 to 100:1) from a SINGLE mesh, in a compact
 * right-angle package — winch drives, rotary tables, tuning pegs, conveyor
 * gearboxes, self-holding hoists.
 *
 * THE IDENTITY (recognise-your-own-primitive, as rack = infinite-radius gear).
 * A worm is not a special gear — it is a POWER SCREW that meshes a wheel. The
 * worm thread is the same helix engineeringPowerScrewCore unwraps into an
 * inclined plane: lead L = Zw·px (starts × axial pitch), lead angle
 * λ = atan(L/(π·dw)). So the worm inherits the screw's mechanics WHOLESALE:
 *   • efficiency    η = tanλ / tan(λ+φ)      — work out / work in per turn,
 *   • self-locking  λ < φ  (⇔ f > tanλ)      — the drive won't back-drive,
 * with φ = atan(f) the friction angle. This is the SAME λ<φ self-locking test
 * the power screw uses (the smoke pins the cross-check: a power screw and a worm
 * at the same λ,f return the identical verdict). A V-form tooth wedges, so the
 * friction is EFFECTIVE, f = μ/cos(φn) with φn the normal pressure angle —
 * exactly the power screw's f = μ/cos(αn) thread-half-angle wedge. With that one
 * substitution the full pressure-angle worm efficiency
 * η = tanλ(cosφn − μtanλ)/(cosφn·tanλ + μ) collapses EXACTLY to tanλ/tan(λ+φ)
 * (the smoke computes it both ways and asserts they agree).
 *
 * THE SIGNATURE. Velocity ratio VR = Zg/Zw: because ONE turn of the worm
 * advances the wheel by only Zw teeth, a single-start worm on a 40-tooth wheel
 * is 40:1 in ONE mesh — a reduction that would take a whole train of spur pairs.
 * The price is efficiency: a self-locking worm has η < 50% — a clean
 * mathematical fact, because at the locking boundary λ=φ the efficiency is
 * exactly (1 − f²)/2 < ½ and below that it only falls. You trade efficiency for
 * ratio and for the brake-free self-holding hold.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-worm-gear-core-smoketest.ts):
 * no imports, no Date.now(), no I/O. The self-locking/efficiency physics is
 * replicated from engineeringPowerScrewCore (which keeps it inline in
 * `powerScrew`, so there is no exported helper to reuse) with this note of the
 * identity; the smoke imports `powerScrew` to pin the cross-check.
 */

export type WormGearResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function nonneg(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }
const RAD = 180 / Math.PI;

export type WormGearResultData = {
  starts: number;                 // Zw — worm threads/starts
  wheelTeeth: number;             // Zg
  velocityRatio: number;          // VR = Zg/Zw (the single-stage signature)
  module_mm: number;              // m — wheel module = worm axial module
  axialPitch_mm: number;          // px = π·m
  lead_mm: number;                // L = Zw·px
  wormPitchDiameter_mm: number;   // dw
  wheelPitchDiameter_mm: number;  // dg = m·Zg
  centerDistance_mm: number;      // (dw + dg)/2
  leadAngle_deg: number;          // λ = atan(L/(π·dw)) — SAME as a power screw
  helixAngle_deg: number;         // 90 − λ (worm helix from the axis; complement of λ)
  pressureAngle_deg: number;      // φn (normal)
  frictionCoeff: number;          // μ
  effectiveFriction: number;      // f = μ/cos(φn) — the V-tooth wedge
  frictionAngle_deg: number;      // φ = atan(f)
  efficiency: number;             // η = tanλ/tan(λ+φ)  (worm driving the wheel)
  reverseEfficiency: number;      // tan(λ−φ)/tanλ (wheel driving worm; ≤0 ⇔ self-locking)
  selfLocking: boolean;           // λ < φ  ⇔  f > tanλ  (the power-screw condition)
  inputTorque_Nm?: number;
  outputTorque_Nm?: number;       // Tin · VR · η
  wormTangentialForce_N?: number; // 2·Tin/dw (= axial force on the wheel)
  wheelTangentialForce_N?: number;// 2·Tout/dg (= axial thrust on the worm)
  separatingForce_N?: number;     // ≈ Wt(wheel)·tan(φn)
};

/**
 * Worm-and-wheel drive. Give the worm (starts Zw, pitch diameter dw, and its
 * size via module OR axialPitch OR lead) and the wheel (teeth Zg); optionally a
 * friction coefficient μ (default 0.05), a normal pressure angle φn (default 0 →
 * square-thread-identical to a power screw), and an input torque for the output
 * torque and mesh forces.
 */
export function wormGear(spec: {
  starts?: number;            // Zw (default 1)
  wheelTeeth: number;         // Zg
  module?: number;            // m (mm)  — wheel module = worm axial module
  axialPitch?: number;        // px (mm) — = π·m
  lead?: number;              // L (mm)  — = Zw·px (override)
  wormPitchDiameter: number;  // dw (mm)
  frictionCoeff?: number;     // μ (default 0.05)
  pressureAngle?: number;     // φn, normal pressure angle in degrees (default 0)
  inputTorque?: number;       // Tin (N·m) → torque out + mesh forces (optional)
}): WormGearResult<WormGearResultData> {
  const Zg = pos(spec.wheelTeeth);
  if (Zg === null || !Number.isInteger(Zg)) return { ok: false, error: 'worm gear needs a positive integer wheelTeeth (Zg)' };
  const Zw = spec.starts !== undefined && Number(spec.starts) >= 1 ? Math.trunc(Number(spec.starts)) : 1;
  const dw = pos(spec.wormPitchDiameter);
  if (dw === null) return { ok: false, error: 'worm gear needs a positive wormPitchDiameter (dw, mm)' };

  // module ↔ axial pitch ↔ lead are one fact: px = π·m, L = Zw·px.
  let m = spec.module !== undefined ? pos(spec.module) : null;
  let px = spec.axialPitch !== undefined ? pos(spec.axialPitch) : null;
  let lead = spec.lead !== undefined ? pos(spec.lead) : null;
  if (px === null && m !== null) px = Math.PI * m;
  if (px === null && lead !== null) px = lead / Zw;
  if (px === null) return { ok: false, error: 'supply a module (mm), an axialPitch (mm), or a lead (mm)' };
  if (m === null) m = px / Math.PI;
  if (lead === null) lead = Zw * px;
  if (lead >= Math.PI * dw) return { ok: false, error: 'lead too large for this worm diameter (lead angle ≥ 45°)' };

  const dg = m * Zg;                  // wheel pitch diameter
  const centerDistance = (dw + dg) / 2;
  const VR = Zg / Zw;                 // velocity ratio — huge, from ONE mesh

  const lambda = Math.atan(lead / (Math.PI * dw));   // lead angle — identical to a power screw's
  const phin = (nonneg(spec.pressureAngle) ?? 0) / RAD;
  const mu = pos(spec.frictionCoeff) ?? 0.05;
  const f = mu / Math.cos(phin);     // effective friction (V-tooth wedge) — SAME as power screw f=μ/cos(αn)
  const phi = Math.atan(f);          // friction angle

  // Efficiency and self-locking are STRUCTURALLY IDENTICAL to
  // engineeringPowerScrewCore (which computes `selfLocking = f > Math.tan(lambda)`
  // inline): η = tanλ/tan(λ+φ), self-locking ⇔ f > tanλ ⇔ λ < φ.
  const efficiency = Math.tan(lambda) / Math.tan(lambda + phi);         // worm driving the wheel
  const reverseEfficiency = Math.tan(lambda - phi) / Math.tan(lambda);  // wheel driving the worm (≤0 ⇔ self-locking)
  const selfLocking = f > Math.tan(lambda);

  const out: WormGearResultData = {
    starts: Zw,
    wheelTeeth: Zg,
    velocityRatio: r(VR),
    module_mm: r(m),
    axialPitch_mm: r(px),
    lead_mm: r(lead),
    wormPitchDiameter_mm: r(dw),
    wheelPitchDiameter_mm: r(dg),
    centerDistance_mm: r(centerDistance),
    leadAngle_deg: r(lambda * RAD),
    helixAngle_deg: r(90 - lambda * RAD),
    pressureAngle_deg: r(phin * RAD),
    frictionCoeff: r(mu),
    effectiveFriction: r(f),
    frictionAngle_deg: r(phi * RAD),
    efficiency: r(efficiency, 5),
    reverseEfficiency: r(reverseEfficiency, 5),
    selfLocking,
  };

  const Tin = spec.inputTorque !== undefined ? pos(spec.inputTorque) : null;
  if (Tin !== null) {
    const Tout = Tin * VR * efficiency;                 // torque multiplied by ratio, docked by efficiency
    out.inputTorque_Nm = r(Tin);
    out.outputTorque_Nm = r(Tout);
    // Force pair on the mesh (Tin, Tout in N·m → ×1000 to N·mm against a mm radius):
    const wormTangential = (Tin * 1000) / (dw / 2);     // drives the worm; = axial force on the wheel
    const wheelTangential = (Tout * 1000) / (dg / 2);   // drives the wheel; = axial thrust on the worm
    out.wormTangentialForce_N = r(wormTangential);
    out.wheelTangentialForce_N = r(wheelTangential);
    out.separatingForce_N = r(wheelTangential * Math.tan(phin));  // radial separation ≈ Wt(wheel)·tanφn
  }

  return { ok: true, value: out };
}
