/**
 * engineeringClutchBrakeCore — FRICTION CLUTCH & BRAKE TORQUE CAPACITY. How much
 * torque can a friction pair transmit (a clutch) or absorb (a brake) before it
 * slips? Three device families, and the striking thing is that TWO of them are
 * primitives this suite already owns from the belt-drive lane — the core just
 * recognises its own physics wearing a different hat.
 *
 * 1. AXIAL DISC / PLATE CLUTCH (and the disc brake). An annular friction face
 * from inner radius ri to outer radius ro is squeezed by an axial force F, with n
 * rubbing surfaces (a single dry-plate clutch grips on BOTH faces → n = 2). The
 * torque depends on how the contact pressure is distributed, and there are two
 * bounding models — a genuine DUALITY, like sheet-metal's two developed lengths:
 *   • UNIFORM PRESSURE (brand-new, perfectly flat faces, p = const):
 *       T = (2/3)·μ·F·n·(ro³ − ri³)/(ro² − ri²)
 *     Equivalent to μ·F·n acting at the effective radius Rₚ = (2/3)(ro³−ri³)/(ro²−ri²).
 *   • UNIFORM WEAR (worn-in, the steady state where p·r = const because the
 *     faster-rubbing outer edge wears until pressure redistributes):
 *       T = (1/2)·μ·F·n·(ro + ri)
 *     i.e. μ·F·n acting at the plain mean radius R_w = (ro + ri)/2.
 * Uniform wear is ALWAYS the lower of the two for ri < ro (proof: their ratio is
 * 3(1+x)²/[4(1+x+x²)] = 1 − (1−x)²/[…] ≤ 1 with x = ri/ro), so a clutch that must
 * still work after break-in is DESIGNED on the uniform-wear torque. For a solid
 * disc (ri → 0) the ratio is exactly 3/4; as the friction ring gets thin (ri → ro)
 * both models collapse to T = μ·F·n·R at the common radius R — the two bounds meet.
 *
 * 2. BAND BRAKE = A CAPSTAN. A flexible band wraps a rotating drum through angle θ.
 * On the verge of slipping the tight- and slack-side tensions obey the SAME capstan
 * (Euler/Eytelwein) equation the belt-drive lane uses, T1/T2 = e^(μθ) — exponential
 * in wrap, so a band that laps the drum grips ferociously. The braking torque is the
 * net rim pull times the drum radius, T = (T1 − T2)·rd. (Arranged so the drum's own
 * rotation tightens the band, a differential band brake becomes self-energizing —
 * the friction helps apply the brake — which is why it can grab.)
 *
 * 3. CONE CLUTCH = A V-WEDGE. Wrap the friction face onto a cone of half-angle α
 * instead of a flat plate. The axial force F now presses a surface inclined at α, so
 * the NORMAL force is amplified to N = F/sin(α) — the identical 1/sin(α) wedge factor
 * that makes a V-belt out-grip a flat belt. The uniform-wear torque is therefore the
 * flat disc-clutch value divided by sin(α):
 *       T = (1/2)·μ·F·n·(ro + ri)/sin(α)
 * At α = 90° the cone is a flat plate (sin = 1) and this reduces exactly to the disc
 * clutch; a shallow cone (small α) multiplies the torque several-fold for the same
 * axial force.
 *
 * UNITS. Radii in mm, force in N (the suite's mm/N system). Raw torque is then in
 * N·mm; each result also reports N·m (÷1000), which is the conventional torque unit.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-clutch-brake-core-smoketest.ts):
 * self-contained, no imports, no I/O. The smoke IS the proof — every torque is
 * asserted against a hand-computed textbook value, the wear<pressure duality and its
 * thin-ring limit are pinned, the band brake is cross-checked against the exact
 * capstan law, and the cone reduces to the disc as α → 90°.
 *
 * References: Shigley, "Mechanical Engineering Design" (clutch/brake chapter);
 * Hannah & Stephens, "Mechanics of Machines".
 */

export type ClutchBrakeResult<T> = { ok: true; value: T } | { ok: false; error: string };

/** Positive check — radii, force, μ, drum radius, tensions are magnitudes. */
function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
/** Non-negative check — an inner radius of 0 (a solid disc) is a valid input. */
function nonneg(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; }
function r(n: number, dp = 6): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }
const DEG2RAD = Math.PI / 180;

// ─── 1. Axial disc / plate clutch (and disc brake) ────────────────────────────

export type DiscClutchResult = {
  outerRadius_mm: number;
  innerRadius_mm: number;
  axialForce_N: number;
  frictionCoeff: number;
  surfaces: number; // n rubbing faces (single dry plate → 2)
  // Uniform WEAR (worn-in, p·r = const) — the conservative DESIGN model.
  uniformWearTorque_Nm: number;
  uniformWearTorque_Nmm: number;
  uniformWearMeanRadius_mm: number; // (ro + ri)/2
  // Uniform PRESSURE (brand-new, p = const).
  uniformPressureTorque_Nm: number;
  uniformPressureTorque_Nmm: number;
  uniformPressureMeanRadius_mm: number; // (2/3)(ro³−ri³)/(ro²−ri²)
  // Summary.
  designTorque_Nm: number;        // = uniform wear (the lower value)
  lowerModel: 'uniform_wear';     // uniform wear is always the lower torque for ri<ro
  wearToPressureRatio: number;    // T_wear / T_pressure ≤ 1
};

/**
 * Axial multi-surface disc/plate clutch or disc brake. Computes BOTH the
 * uniform-pressure (new) and uniform-wear (worn-in) torque capacity, flags the
 * uniform-wear value as the lower/design torque, and reports the effective radius
 * of each model. `surfaces` defaults to 1; a single dry-plate clutch grips on two
 * faces so pass n = 2, a multi-plate stack passes more.
 */
export function discClutch(spec: {
  outerRadius: number;   // ro (mm)
  innerRadius: number;   // ri (mm), 0 for a solid disc
  axialForce: number;    // F (N)
  frictionCoeff: number; // μ
  surfaces?: number;     // n rubbing faces (default 1)
}): ClutchBrakeResult<DiscClutchResult> {
  const ro = pos(spec?.outerRadius);
  const ri = nonneg(spec?.innerRadius);
  const F = pos(spec?.axialForce);
  const mu = pos(spec?.frictionCoeff);
  const n = spec?.surfaces === undefined ? 1 : pos(spec.surfaces);
  if (ro === null) return { ok: false, error: 'disc clutch needs a positive outerRadius (mm)' };
  if (ri === null) return { ok: false, error: 'disc clutch needs a finite innerRadius ≥ 0 (mm)' };
  if (F === null) return { ok: false, error: 'disc clutch needs a positive axialForce (N)' };
  if (mu === null) return { ok: false, error: 'disc clutch needs a positive frictionCoeff (μ)' };
  if (n === null) return { ok: false, error: 'disc clutch needs a positive number of surfaces (n)' };
  if (ri >= ro) return { ok: false, error: 'innerRadius must be less than outerRadius' };

  const meanWear = (ro + ri) / 2;
  const meanPressure = (2 / 3) * (ro ** 3 - ri ** 3) / (ro ** 2 - ri ** 2);
  // Both torques are μ·F·n acting at the model's effective radius.
  const tWear = mu * F * n * meanWear;         // = (1/2)μFn(ro+ri)
  const tPressure = mu * F * n * meanPressure; // = (2/3)μFn(ro³−ri³)/(ro²−ri²)

  return {
    ok: true,
    value: {
      outerRadius_mm: ro,
      innerRadius_mm: ri,
      axialForce_N: F,
      frictionCoeff: mu,
      surfaces: n,
      uniformWearTorque_Nm: r(tWear / 1000),
      uniformWearTorque_Nmm: r(tWear),
      uniformWearMeanRadius_mm: r(meanWear),
      uniformPressureTorque_Nm: r(tPressure / 1000),
      uniformPressureTorque_Nmm: r(tPressure),
      uniformPressureMeanRadius_mm: r(meanPressure),
      designTorque_Nm: r(tWear / 1000),
      lowerModel: 'uniform_wear',
      wearToPressureRatio: r(tWear / tPressure),
    },
  };
}

// ─── 2. Band brake (a capstan around a drum) ──────────────────────────────────

export type BandBrakeResult = {
  drumRadius_mm: number;
  frictionCoeff: number;
  wrapAngle_deg: number;
  wrapAngle_rad: number;
  tensionRatio: number;        // T1/T2 = e^(μθ) (capstan / Euler equation)
  tightSideTension_N: number;  // T1
  slackSideTension_N: number;  // T2
  brakingTorque_Nm: number;    // (T1 − T2)·rd
  brakingTorque_Nmm: number;
};

/**
 * Band brake: a band wrapping a drum of radius rd through angle θ. The tight/slack
 * tension ratio is the capstan law T1/T2 = e^(μθ) — the exact same exponential the
 * belt-drive lane uses — and the braking torque is the net rim pull (T1 − T2)·rd.
 * Supply the wrap angle in EITHER degrees (`wrapAngle_deg`) or radians
 * (`wrapAngle_rad`), and exactly one known band tension — the tight side
 * (`tightSideTension_N`, T1) or the slack/actuating side (`slackSideTension_N`, T2);
 * the other is recovered from the ratio.
 */
export function bandBrake(spec: {
  drumRadius: number;    // rd (mm)
  frictionCoeff: number; // μ
  wrapAngle_deg?: number;
  wrapAngle_rad?: number;
  tightSideTension_N?: number; // T1
  slackSideTension_N?: number; // T2
}): ClutchBrakeResult<BandBrakeResult> {
  const rd = pos(spec?.drumRadius);
  const mu = pos(spec?.frictionCoeff);
  if (rd === null) return { ok: false, error: 'band brake needs a positive drumRadius (mm)' };
  if (mu === null) return { ok: false, error: 'band brake needs a positive frictionCoeff (μ)' };

  const hasDeg = spec?.wrapAngle_deg !== undefined;
  const hasRad = spec?.wrapAngle_rad !== undefined;
  if (hasDeg === hasRad) return { ok: false, error: 'band brake needs exactly one of wrapAngle_deg or wrapAngle_rad' };
  const theta = hasDeg ? pos(spec.wrapAngle_deg)! * DEG2RAD : pos(spec.wrapAngle_rad);
  if (theta === null || theta <= 0) return { ok: false, error: 'band brake wrap angle must be positive' };

  const hasT1 = spec?.tightSideTension_N !== undefined;
  const hasT2 = spec?.slackSideTension_N !== undefined;
  if (hasT1 === hasT2) return { ok: false, error: 'band brake needs exactly one of tightSideTension_N or slackSideTension_N' };

  const ratio = Math.exp(mu * theta); // T1/T2, always ≥ 1
  let T1: number; let T2: number;
  if (hasT1) {
    const t1 = pos(spec.tightSideTension_N);
    if (t1 === null) return { ok: false, error: 'tightSideTension_N must be a positive tension (N)' };
    T1 = t1; T2 = t1 / ratio;
  } else {
    const t2 = pos(spec.slackSideTension_N);
    if (t2 === null) return { ok: false, error: 'slackSideTension_N must be a positive tension (N)' };
    T2 = t2; T1 = t2 * ratio;
  }
  const torque = (T1 - T2) * rd; // N·mm

  return {
    ok: true,
    value: {
      drumRadius_mm: rd,
      frictionCoeff: mu,
      wrapAngle_deg: r(theta / DEG2RAD),
      wrapAngle_rad: r(theta),
      tensionRatio: r(ratio),
      tightSideTension_N: r(T1),
      slackSideTension_N: r(T2),
      brakingTorque_Nm: r(torque / 1000),
      brakingTorque_Nmm: r(torque),
    },
  };
}

// ─── 3. Cone clutch (a V-wedge on a cone) ─────────────────────────────────────

export type ConeClutchResult = {
  outerRadius_mm: number;
  innerRadius_mm: number;
  axialForce_N: number;
  frictionCoeff: number;
  surfaces: number;
  halfAngle_deg: number;
  amplificationFactor: number;    // 1/sin(α), the wedge gain over a flat clutch
  meanRadius_mm: number;          // (ro + ri)/2
  normalForce_N: number;          // F/sin(α), the amplified face-normal force
  faceWidth_mm: number;           // (ro − ri)/sin(α), the cone contact width
  // Torque (uniform wear = design) and the equivalent flat clutch for comparison.
  uniformWearTorque_Nm: number;
  uniformWearTorque_Nmm: number;
  uniformPressureTorque_Nm: number;
  uniformPressureTorque_Nmm: number;
  flatClutchTorque_Nm: number;    // = uniformWearTorque · sin(α); the α=90° disc value
};

/**
 * Cone clutch of half-angle α. The axial force F wedges onto the inclined cone
 * face, amplifying the normal force to F/sin(α) and hence the torque by the same
 * factor: the uniform-wear torque is the flat disc-clutch value divided by sin(α),
 * T = (1/2)·μ·F·n·(ro + ri)/sin(α). Reports the amplification 1/sin(α) versus a flat
 * clutch; at α = 90° the cone IS a flat plate and the result reduces exactly to
 * `discClutch`. `surfaces` defaults to 1 (a cone clutch has a single friction face).
 */
export function coneClutch(spec: {
  outerRadius: number;   // ro (mm), the cone's large radius (⊥ to axis)
  innerRadius: number;   // ri (mm), the cone's small radius
  axialForce: number;    // F (N)
  frictionCoeff: number; // μ
  halfAngle_deg: number; // α (0 < α ≤ 90); 90° = a flat plate
  surfaces?: number;     // n (default 1)
}): ClutchBrakeResult<ConeClutchResult> {
  const ro = pos(spec?.outerRadius);
  const ri = nonneg(spec?.innerRadius);
  const F = pos(spec?.axialForce);
  const mu = pos(spec?.frictionCoeff);
  const alpha = pos(spec?.halfAngle_deg);
  const n = spec?.surfaces === undefined ? 1 : pos(spec.surfaces);
  if (ro === null) return { ok: false, error: 'cone clutch needs a positive outerRadius (mm)' };
  if (ri === null) return { ok: false, error: 'cone clutch needs a finite innerRadius ≥ 0 (mm)' };
  if (F === null) return { ok: false, error: 'cone clutch needs a positive axialForce (N)' };
  if (mu === null) return { ok: false, error: 'cone clutch needs a positive frictionCoeff (μ)' };
  if (n === null) return { ok: false, error: 'cone clutch needs a positive number of surfaces (n)' };
  if (alpha === null || alpha > 90) return { ok: false, error: 'cone clutch half-angle must be in (0, 90] degrees' };
  if (ri >= ro) return { ok: false, error: 'innerRadius must be less than outerRadius' };

  const sinA = Math.sin(alpha * DEG2RAD);
  const amp = 1 / sinA;
  const meanWear = (ro + ri) / 2;
  const meanPressure = (2 / 3) * (ro ** 3 - ri ** 3) / (ro ** 2 - ri ** 2);
  const tFlatWear = mu * F * n * meanWear;              // flat (α=90°) disc-clutch uniform-wear torque
  const tWear = tFlatWear * amp;                        // (1/2)μFn(ro+ri)/sinα
  const tPressure = mu * F * n * meanPressure * amp;    // (2/3)μFn(ro³−ri³)/((ro²−ri²)·sinα)

  return {
    ok: true,
    value: {
      outerRadius_mm: ro,
      innerRadius_mm: ri,
      axialForce_N: F,
      frictionCoeff: mu,
      surfaces: n,
      halfAngle_deg: alpha,
      amplificationFactor: r(amp),
      meanRadius_mm: r(meanWear),
      normalForce_N: r(F / sinA),
      faceWidth_mm: r((ro - ri) / sinA),
      uniformWearTorque_Nm: r(tWear / 1000),
      uniformWearTorque_Nmm: r(tWear),
      uniformPressureTorque_Nm: r(tPressure / 1000),
      uniformPressureTorque_Nmm: r(tPressure),
      flatClutchTorque_Nm: r(tFlatWear / 1000),
    },
  };
}
