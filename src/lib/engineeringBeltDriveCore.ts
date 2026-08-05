/**
 * engineeringBeltDriveCore — BELT DRIVES, the power-transmission partner to the
 * V-groove pulley the geometry lane already builds: two pulleys and a belt trade
 * speed for torque across a distance, the way a gear pair does but with slip,
 * compliance, and no need for precise centre distances.
 *
 * THE GEOMETRY. The speed ratio is just the pulley diameter ratio, D/d (the belt
 * speed is common to both rims, so ω·r is equal). The belt has to wrap each
 * pulley and cross the gap twice, giving the open-belt length
 *   L = 2C + (π/2)(D + d) + (D − d)² / (4C),
 * and because the belt leaves the small pulley at an angle its WRAP angle there is
 * less than 180°: θ_small = π − 2·asin((D − d)/(2C)). The small pulley's smaller
 * wrap is why it slips first and therefore sets the drive's capacity.
 *
 * THE FRICTION — THE CAPSTAN EQUATION. A belt about to slip has a tension ratio
 * T1/T2 = e^(μθ) between its tight and slack sides (the capstan/Euler equation) —
 * exponential in the wrap angle, which is why even a modest wrap grips
 * enormously. A V-belt wedges into its groove, multiplying the grip: the
 * effective coefficient is μ/sin(β) with β the half-groove angle, so
 * T1/T2 = e^(μθ/sinβ). The power a belt can transmit before slipping is the net
 * pull times the belt speed, P = (T1 − T2)·V.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-belt-drive-core-smoketest.ts):
 * self-contained, no imports, no I/O.
 */

export type BeltResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }
const RAD = 180 / Math.PI;

export type BeltDriveResult = {
  driverDiameter: number;
  drivenDiameter: number;
  centreDistance: number;
  speedRatio: number; // driven speed / driver speed = d/D (driven turns slower if larger)
  beltLength: number;
  wrapAngleSmall_deg: number;
  wrapAngleLarge_deg: number;
  beltSpeed_m_s?: number;
  driverSpeed_rpm?: number;
  drivenSpeed_rpm?: number;
  effectiveFriction?: number;
  tensionRatio?: number; // T1/T2 at impending slip
  maxPower_kW?: number;
  tightSideTension_N?: number;
  slackSideTension_N?: number;
};

/**
 * Open belt drive. Diameters and centre distance give the geometry; add a driver
 * speed for belt/driven speed, and friction + a tight-side tension for the
 * capstan tension ratio and transmissible power.
 */
export function beltDrive(spec: {
  driverDiameter: number; // D1 (mm)
  drivenDiameter: number; // D2 (mm)
  centreDistance: number; // C (mm)
  driverSpeed_rpm?: number;
  frictionCoeff?: number; // μ
  grooveHalfAngle_deg?: number; // β; omit for a flat belt
  tightSideTension_N?: number; // T1 → power
}): BeltResult<BeltDriveResult> {
  const D1 = pos(spec.driverDiameter), D2 = pos(spec.drivenDiameter), C = pos(spec.centreDistance);
  if (D1 === null || D2 === null || C === null) return { ok: false, error: 'belt drive needs positive driver/driven diameters and centre distance (mm)' };
  const D = Math.max(D1, D2), d = Math.min(D1, D2);
  if (C <= (D - d) / 2) return { ok: false, error: 'centre distance too small for these pulleys' };

  const beltLength = 2 * C + (Math.PI / 2) * (D + d) + ((D - d) ** 2) / (4 * C);
  const wrapSmall = Math.PI - 2 * Math.asin((D - d) / (2 * C));
  const wrapLarge = Math.PI + 2 * Math.asin((D - d) / (2 * C));

  const out: BeltDriveResult = {
    driverDiameter: D1, drivenDiameter: D2, centreDistance: C,
    speedRatio: r(D1 / D2), // driven/driver speed ratio = D_driver/D_driven
    beltLength: r(beltLength),
    wrapAngleSmall_deg: r(wrapSmall * RAD),
    wrapAngleLarge_deg: r(wrapLarge * RAD),
  };

  const n1 = spec.driverSpeed_rpm !== undefined ? pos(spec.driverSpeed_rpm) : null;
  let V: number | null = null;
  if (n1 !== null) {
    V = (Math.PI * D1 / 1000) * (n1 / 60); // belt speed m/s (D1 mm → m)
    out.driverSpeed_rpm = n1;
    out.drivenSpeed_rpm = r(n1 * (D1 / D2));
    out.beltSpeed_m_s = r(V);
  }

  const mu = spec.frictionCoeff !== undefined ? pos(spec.frictionCoeff) : null;
  if (mu !== null) {
    const beta = spec.grooveHalfAngle_deg !== undefined ? pos(spec.grooveHalfAngle_deg) : null;
    const f = beta !== null ? mu / Math.sin(beta / RAD) : mu; // V-belt wedge
    const ratio = Math.exp(f * wrapSmall); // slips first on the small (least-wrapped) pulley
    out.effectiveFriction = r(f);
    out.tensionRatio = r(ratio);
    const T1 = spec.tightSideTension_N !== undefined ? pos(spec.tightSideTension_N) : null;
    if (T1 !== null && V !== null) {
      const T2 = T1 / ratio;
      out.tightSideTension_N = T1;
      out.slackSideTension_N = r(T2);
      out.maxPower_kW = r((T1 - T2) * V / 1000);
    }
  }
  return { ok: true, value: out };
}
