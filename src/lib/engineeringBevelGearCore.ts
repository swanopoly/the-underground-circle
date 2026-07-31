/**
 * engineeringBevelGearCore — STRAIGHT BEVEL GEARS: the angular-drive member that
 * transmits power between INTERSECTING shafts (usually at 90°). This COMPLETES
 * the gear family: engineeringGearCore draws the spur tooth, the helical core
 * twists it, the rack core straightens it to infinite radius — all for PARALLEL
 * shafts. A bevel gear rolls two pitch CONES on each other instead of two pitch
 * cylinders, so the shaft axes meet at the common cone apex and turn the drive
 * through a corner.
 *
 * THE PITCH CONES. Each gear is a slice of a cone whose apex sits at the shaft
 * intersection. The half-angle of that cone is the PITCH CONE ANGLE γ. For a
 * shaft angle Σ the two cone angles are set by the tooth ratio:
 *
 *     tan γ_pinion = sin Σ / (N_g/N_p + cos Σ)
 *     tan γ_gear   = sin Σ / (N_p/N_g + cos Σ)      and   γ_pinion + γ_gear = Σ
 *
 * The apex is shared, so the two cones also share one slant (cone) distance
 * A_o = r_pitch / sin γ — computing it from the pinion or the gear gives the
 * SAME number (a self-check the smoke pins). For the common Σ = 90° case the
 * formulas collapse to γ_pinion = atan(N_p/N_g), γ_gear = atan(N_g/N_p), the two
 * angles are complementary, and the ratio N_g/N_p = tan γ_gear.
 *
 * TREDGOLD'S APPROXIMATION — a bevel tooth is a spur tooth in disguise. The tooth
 * cross-section developed on the BACK CONE (the cone tangent to the pitch cone at
 * the large end, unrolled flat) is very nearly the profile of a SPUR gear of a
 * larger, "virtual" tooth count. Tredgold set that equivalent number to
 *
 *     N_e = N / cos γ
 *
 * Because cos γ < 1 for any real cone angle, N_e is ALWAYS greater than the actual
 * tooth count, and it grows as the cone angle grows. This is what lets the whole
 * spur-gear strength apparatus — the Lewis bending equation and its form factor Y,
 * which are keyed on tooth count — be applied to a bevel tooth: look up Y at N_e,
 * not at N. So this core reports N_e for both members and hands the Lewis lane a
 * ready equivalent.
 *
 * TOOTH FORCES — and the pinion/gear force SWAP. The transmitted tangential load
 * acts at the tooth MIDPOINT, whose radius (the mean radius) is
 * r_m = r_pitch − ½·F·sin γ for a face width F (else the large-end pitch radius).
 * From the pinion torque, F_t = T / r_m. That single tangential force is shared by
 * both members (action–reaction at the mesh). Resolving it along each member's own
 * cone gives the separating (radial) and thrust (axial) components:
 *
 *     W_r = F_t · tan φ · cos γ        (radial / separating)
 *     W_a = F_t · tan φ · sin γ        (axial  / thrust)
 *
 * For Σ = 90° the cone angles are complementary (γ_gear = 90° − γ_pinion), so
 * cos γ_gear = sin γ_pinion and sin γ_gear = cos γ_pinion. The consequence is a
 * clean force balance: the PINION's radial force equals the GEAR's axial force,
 * and the pinion's axial force equals the gear's radial force —
 *
 *     W_r(pinion) = W_a(gear)     and     W_a(pinion) = W_r(gear).
 *
 * The thrust each member throws onto its bearings is the other member's separating
 * load; the smoke asserts this identity as a structural proof.
 *
 * UNIT SYSTEM. The suite's mm / N / MPa / degree set: module and radii in mm,
 * torque in N·m (converted to N·mm internally for F_t = T/r_m), forces in N,
 * angles reported in degrees. Sources: Shigley, *Mechanical Engineering Design*,
 * Ch. 13/15 (bevel geometry, Tredgold, bevel-gear force analysis); Khurmi,
 * *Theory of Machines / Machine Design*, bevel-gear chapter.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-bevel-gear-core-smoketest.ts):
 * no imports, no I/O, no Date.now(), total functions. The smoke IS the proof —
 * cone-angle sum, the shared cone distance, N_e > N, the force-swap identity, and
 * a fully hand-computed textbook case are all asserted directly.
 */

export type BevelGearResult<T> = { ok: true; value: T } | { ok: false; error: string };

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;
/** Hard floor on tooth count (a real bevel gear needs several teeth). */
const MIN_TEETH = 4;

/** Positive-and-finite guard (a magnitude: module, torque, teeth). */
function pos(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Finite guard (shaft/pressure angle; the valid range is checked separately). */
function fin(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Round to a sensible number of decimals for display parity. */
function r(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return value;
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}

// ─── Pitch cone angles (the defining bevel geometry) ─────────────────────────

/**
 * The two pitch cone half-angles (degrees) for a bevel pair with tooth counts
 * N_p (pinion) and N_g (gear) on shafts meeting at Σ (degrees, default 90).
 *
 *   tan γ_pinion = sin Σ / (N_g/N_p + cos Σ),  tan γ_gear = sin Σ / (N_p/N_g + cos Σ)
 *
 * atan2 keeps the result correct when the denominator goes negative (obtuse Σ
 * with a large ratio). By construction γ_pinion + γ_gear = Σ exactly. Assumes
 * valid positive inputs (the public entry point validates).
 */
export function pitchConeAngles(
  pinionTeeth: number,
  gearTeeth: number,
  shaftAngleDeg = 90,
): { pinion: number; gear: number } {
  const S = shaftAngleDeg * DEG;
  const sinS = Math.sin(S);
  const cosS = Math.cos(S);
  const gammaP = Math.atan2(sinS, gearTeeth / pinionTeeth + cosS);
  const gammaG = Math.atan2(sinS, pinionTeeth / gearTeeth + cosS);
  return { pinion: gammaP * RAD, gear: gammaG * RAD };
}

// ─── Tredgold equivalent (virtual) spur teeth ────────────────────────────────

/**
 * Tredgold's back-cone development: the virtual spur-gear tooth count whose
 * profile matches the bevel tooth at the large end, N_e = N / cos γ. Always
 * greater than N (cos γ < 1) and increasing with the cone angle. Feeding N_e to
 * the Lewis form factor lets the spur strength lane size a bevel tooth.
 */
export function equivalentSpurTeeth(teeth: number, coneAngleDeg: number): number {
  return teeth / Math.cos(coneAngleDeg * DEG);
}

// ─── Torque resolution (pinion side) ─────────────────────────────────────────

type TorqueResolution =
  | { T_Nm: number; source: 'torque' | 'power'; power_W: number | null; speed_rpm: number | null }
  | { error: string };

/** Resolve the PINION torque (N·m) from an explicit torque, or from power and
 *  speed via T = P/ω, ω = 2π·n/60. */
function resolvePinionTorque(spec: {
  torque_Nm?: number;
  power_W?: number;
  speed_rpm?: number;
}): TorqueResolution {
  if (spec.torque_Nm !== undefined) {
    const T = pos(spec.torque_Nm);
    if (T === null) return { error: 'torque_Nm must be positive (N·m)' };
    return { T_Nm: T, source: 'torque', power_W: null, speed_rpm: pos(spec.speed_rpm) };
  }
  const P = pos(spec.power_W);
  if (P === null) return { error: 'power_W must be positive (W)' };
  const rpm = pos(spec.speed_rpm);
  if (rpm === null) return { error: 'power_W input needs a positive speed_rpm' };
  const omega = (2 * Math.PI * rpm) / 60; // rad/s
  return { T_Nm: P / omega, source: 'power', power_W: P, speed_rpm: rpm };
}

// ─── Bevel gear pair ─────────────────────────────────────────────────────────

export type BevelGearPairSpec = {
  /** Module (mm) — shared by both members to mesh. */
  module: number;
  /** Pinion (driving) tooth count. */
  pinionTeeth: number;
  /** Gear (driven) tooth count. */
  gearTeeth: number;
  /** Shaft angle Σ between the axes, degrees. Default 90. */
  shaftAngleDeg?: number;
  /** Pressure angle φ, degrees. Default 20. */
  pressureAngleDeg?: number;
  /** Face width F, mm (optional). Moves the load radius to the tooth midpoint. */
  faceWidth?: number;
  /** Pinion torque, N·m (optional; enables the force analysis). */
  torque_Nm?: number;
  /** Pinion power, W (optional alternative to torque, with speed_rpm). */
  power_W?: number;
  /** Pinion speed, rpm (required with power_W). */
  speed_rpm?: number;
};

export type BevelGearForces = {
  /** Torque resolution source. */
  source: 'torque' | 'power';
  /** Pinion torque used, N·m. */
  pinionTorque_Nm: number;
  /** Shared tangential (tooth) load at the mean radius, N. */
  tangential_N: number;
  /** Pinion radial (separating) force, N = F_t·tanφ·cos γ_p. */
  pinionRadial_N: number;
  /** Pinion axial (thrust) force, N = F_t·tanφ·sin γ_p. */
  pinionAxial_N: number;
  /** Gear radial (separating) force, N = F_t·tanφ·cos γ_g. */
  gearRadial_N: number;
  /** Gear axial (thrust) force, N = F_t·tanφ·sin γ_g. */
  gearAxial_N: number;
};

export type BevelGearPairGeometry = {
  module: number;
  pressureAngleDeg: number;
  shaftAngleDeg: number;
  pinionTeeth: number;
  gearTeeth: number;
  /** Gear ratio N_g/N_p (= tan γ_gear when Σ = 90°). */
  ratio: number;
  /** Pinion pitch cone half-angle, degrees. */
  pinionConeAngleDeg: number;
  /** Gear pitch cone half-angle, degrees (γ_p + γ_g = Σ). */
  gearConeAngleDeg: number;
  /** Large-end pitch radii, mm (r = m·N/2). */
  pinionPitchRadius: number;
  gearPitchRadius: number;
  /** Mean (tooth-midpoint) radii, mm (r_pitch − ½·F·sin γ). */
  pinionMeanRadius: number;
  gearMeanRadius: number;
  /** Shared cone (slant) distance apex→large end, mm (r_pitch/sin γ). */
  coneDistance: number;
  /** Tredgold equivalent spur teeth N_e = N/cos γ (both > actual). */
  equivalentSpurTeethPinion: number;
  equivalentSpurTeethGear: number;
  /** Force analysis, present only when a torque or power is supplied. */
  forces: BevelGearForces | null;
};

/**
 * Analyse a straight bevel gear pair on intersecting shafts. Reports the pitch
 * cone angles (summing to the shaft angle), the shared cone distance, the
 * Tredgold equivalent spur-tooth counts, and — when a pinion torque or power is
 * supplied — the tangential, radial, and axial tooth-force components on both
 * members. The tangential load is shared (action–reaction); for Σ = 90° the
 * pinion's radial force equals the gear's axial force and vice versa.
 */
export function bevelGearPair(spec: BevelGearPairSpec): BevelGearResult<BevelGearPairGeometry> {
  const m = pos(spec?.module);
  if (m === null) return { ok: false, error: 'module must be positive (mm)' };

  const Np = Math.trunc(Number(spec?.pinionTeeth));
  const Ng = Math.trunc(Number(spec?.gearTeeth));
  if (!Number.isFinite(Np) || Np < MIN_TEETH) return { ok: false, error: `pinionTeeth must be an integer ≥ ${MIN_TEETH}` };
  if (!Number.isFinite(Ng) || Ng < MIN_TEETH) return { ok: false, error: `gearTeeth must be an integer ≥ ${MIN_TEETH}` };

  const Sigma = spec?.shaftAngleDeg === undefined ? 90 : fin(spec.shaftAngleDeg);
  if (Sigma === null || Sigma <= 0 || Sigma >= 180) return { ok: false, error: 'shaftAngleDeg must be between 0 and 180 (exclusive)' };

  const phi = spec?.pressureAngleDeg === undefined ? 20 : fin(spec.pressureAngleDeg);
  if (phi === null || phi <= 0 || phi >= 90) return { ok: false, error: 'pressureAngleDeg must be between 0 and 90 (exclusive)' };

  // Face width (optional): must be positive if supplied.
  let F: number | null = null;
  if (spec?.faceWidth !== undefined) {
    F = pos(spec.faceWidth);
    if (F === null) return { ok: false, error: 'faceWidth must be positive (mm)' };
  }

  const angles = pitchConeAngles(Np, Ng, Sigma);
  const gammaP = angles.pinion * DEG; // radians
  const gammaG = angles.gear * DEG;

  const rPitchP = (m * Np) / 2;
  const rPitchG = (m * Ng) / 2;

  const rMeanP = F === null ? rPitchP : rPitchP - 0.5 * F * Math.sin(gammaP);
  const rMeanG = F === null ? rPitchG : rPitchG - 0.5 * F * Math.sin(gammaG);
  if (rMeanP <= 0 || rMeanG <= 0) {
    return { ok: false, error: 'faceWidth too large — mean radius is non-positive (reduce faceWidth)' };
  }

  // Shared cone (slant) distance: r_pitch/sin γ is the same from either member.
  const coneDistance = rPitchP / Math.sin(gammaP);

  const NeP = equivalentSpurTeeth(Np, angles.pinion);
  const NeG = equivalentSpurTeeth(Ng, angles.gear);

  // Force analysis only when a load (torque or power) is supplied.
  let forces: BevelGearForces | null = null;
  if (spec?.torque_Nm !== undefined || spec?.power_W !== undefined) {
    const tq = resolvePinionTorque(spec);
    if ('error' in tq) return { ok: false, error: tq.error };
    const Ft = (tq.T_Nm * 1000) / rMeanP; // N·m → N·mm, / mm → N
    const tanPhi = Math.tan(phi * DEG);
    forces = {
      source: tq.source,
      pinionTorque_Nm: r(tq.T_Nm, 4),
      tangential_N: r(Ft, 4),
      pinionRadial_N: r(Ft * tanPhi * Math.cos(gammaP), 4),
      pinionAxial_N: r(Ft * tanPhi * Math.sin(gammaP), 4),
      gearRadial_N: r(Ft * tanPhi * Math.cos(gammaG), 4),
      gearAxial_N: r(Ft * tanPhi * Math.sin(gammaG), 4),
    };
  }

  return {
    ok: true,
    value: {
      module: m,
      pressureAngleDeg: phi,
      shaftAngleDeg: Sigma,
      pinionTeeth: Np,
      gearTeeth: Ng,
      ratio: r(Ng / Np, 6),
      pinionConeAngleDeg: r(angles.pinion, 6),
      gearConeAngleDeg: r(angles.gear, 6),
      pinionPitchRadius: r(rPitchP, 6),
      gearPitchRadius: r(rPitchG, 6),
      pinionMeanRadius: r(rMeanP, 6),
      gearMeanRadius: r(rMeanG, 6),
      coneDistance: r(coneDistance, 6),
      equivalentSpurTeethPinion: r(NeP, 6),
      equivalentSpurTeethGear: r(NeG, 6),
      forces,
    },
  };
}
