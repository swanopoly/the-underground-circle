/**
 * engineeringChainDriveCore — ROLLER-CHAIN DRIVES, the positive-engagement sibling
 * of the belt drive and the third member of the transmission family the suite
 * already covers: a GEAR pair meshes tooth-to-tooth at a fixed centre distance, a
 * BELT spans a long gap but SLIPS, and a CHAIN spans the gap like a belt yet meshes
 * like a gear — its rollers seat in the sprocket teeth, so it cannot slip and the
 * speed ratio is EXACT.
 *
 * THE SPROCKET IS A POLYGON, NOT A CIRCLE. A chain of pitch p wrapping a sprocket
 * of N teeth seats one pin per tooth, so the pin centres form a regular N-sided
 * polygon whose side length is exactly p. The pitch circle is the polygon's
 * circumscribed circle, so the pitch diameter is EXACT (no π, no approximation):
 *   PD = p / sin(180°/N).
 * As N → ∞ the polygon becomes a circle and π·PD → N·p, but for a real sprocket the
 * polygon perimeter N·p is slightly less than the circle circumference π·PD.
 *
 * THE RATIO IS EXACT. Because the rollers positively engage the teeth, the driven
 * sprocket turns exactly N1/N2 as fast as the driver — ratio = N2/N1 with no slip
 * term, unlike a belt whose creep makes its ratio slightly load-dependent. This is
 * the defining advantage of a chain: an exact, synchronous ratio over a distance.
 *
 * THE CHAIN LENGTH IS AN EVEN NUMBER OF PITCHES. The wrap-and-span geometry gives,
 * in pitches (C_p = C/p, centre distance in pitches):
 *   L = 2·C_p + (N1 + N2)/2 + ((N2 − N1)/(2π))² / C_p,
 * which is rounded UP to an EVEN integer: a roller chain is made of alternating
 * inner and outer links, so an odd count needs a weak cranked "offset" link — even
 * counts avoid it. Rounding the length up then lets us solve back for the slightly
 * larger centre distance that the even chain actually rides at.
 *
 * CHORDAL ACTION (THE POLYGON EFFECT). As the chain rides the polygon, the radius
 * at which it acts rises and falls between PD/2 and (PD/2)·cos(180°/N) every tooth,
 * so even at constant sprocket speed the chain speed ripples by
 *   Δv/v = 1 − cos(180°/N).
 * This falls as the tooth count rises — which is exactly why a minimum of ~17 teeth
 * is recommended and a tiny sprocket (a 4-tooth is barely more than a square) runs
 * so roughly.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-chain-drive-core-smoketest.ts):
 * self-contained, no imports, no I/O. Refs: Shigley §17-5 (chain length & centre
 * distance), Khurmi "Machine Design" ch. on chain drives.
 */

export type ChainResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function posInt(v: unknown): number | null { const n = Number(v); return Number.isInteger(n) && n >= 3 ? n : null; }
function r(n: number, dp = 4): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }
const RAD = 180 / Math.PI;

/**
 * Sprocket pitch diameter — EXACT polygon geometry, PD = p / sin(180°/N). The N pin
 * centres form a regular N-gon of side p; its circumscribed circle is the pitch
 * circle. Definitional identity: PD·sin(180°/N) = p for every N.
 */
export function sprocketPitchDiameter(pitch: number, teeth: number): number {
  return pitch / Math.sin(Math.PI / teeth);
}

/**
 * Chordal (polygon-effect) speed variation as a FRACTION: 1 − cos(180°/N). The
 * chain's acting radius swings between PD/2 and (PD/2)·cos(180°/N) each tooth, so
 * the linear speed ripples by this fraction. It falls monotonically as N rises.
 */
export function chordalSpeedVariation(teeth: number): number {
  return 1 - Math.cos(Math.PI / teeth);
}

/** Smallest EVEN integer ≥ x (with a tiny fp guard so an exact even value is not bumped up). */
function roundUpEven(x: number): number {
  const c = Math.ceil(x - 1e-9);
  return c % 2 === 0 ? c : c + 1;
}

export type ChainDriveResult = {
  pitch: number;                          // chain pitch p (mm)
  driverTeeth: number;                    // N1
  drivenTeeth: number;                    // N2
  pitchDiameterDriver: number;            // PD1 = p/sin(180°/N1)
  pitchDiameterDriven: number;            // PD2 = p/sin(180°/N2)
  ratio: number;                          // N2/N1 — EXACT, no slip
  centreDistance: number;                 // C (mm)
  centreDistance_pitches: number;         // C_p = C/p
  chainLength_pitches_exact: number;      // the fractional geometric length
  chainLength_pitches: number;            // rounded UP to an even integer
  adjustedCentreDistance: number;         // C (mm) the rounded even chain actually rides at
  adjustedCentreDistance_pitches: number; // that centre distance in pitches
  chordalSpeedVariationDriver_pct: number; // 100·(1−cos(180°/N1)) — worse on the fewer-tooth sprocket
  chordalSpeedVariationDriven_pct: number; // 100·(1−cos(180°/N2))
  driverSpeed_rpm?: number;               // n1
  drivenSpeed_rpm?: number;               // n1·N1/N2 (= n1/ratio)
  chainSpeed_m_s?: number;                // N1·p·n1 — polygon perimeter per rev, EXACT mean speed
  power_kW?: number;
  tangentialForce_N?: number;             // P/V, the pull the chain carries
};

/**
 * Roller-chain drive. Pitch, the two sprocket tooth counts, and a centre distance
 * (mm, or given in pitches) fix the geometry — exact pitch diameters, the exact
 * speed ratio, the even-pitch chain length and the centre distance it rides at, and
 * the chordal speed variation. Add a driver speed for chain/driven speed, and a
 * transmitted power for the tangential chain force.
 */
export function chainDrive(spec: {
  pitch: number;                   // chain pitch p (mm)
  driverTeeth: number;             // N1
  drivenTeeth: number;             // N2
  centreDistance?: number;         // C (mm)
  centreDistance_pitches?: number; // OR C given directly in pitches
  driverSpeed_rpm?: number;        // n1
  power_kW?: number;               // optional transmitted power
}): ChainResult<ChainDriveResult> {
  const p = pos(spec.pitch);
  if (p === null) return { ok: false, error: 'chain drive needs a positive chain pitch (mm)' };
  const N1 = posInt(spec.driverTeeth), N2 = posInt(spec.drivenTeeth);
  if (N1 === null || N2 === null) return { ok: false, error: 'chain drive needs integer sprocket tooth counts ≥ 3' };

  // Centre distance: accept mm or pitches, normalise to both.
  let C: number | null = null;
  if (spec.centreDistance !== undefined) C = pos(spec.centreDistance);
  else if (spec.centreDistance_pitches !== undefined) { const cp = pos(spec.centreDistance_pitches); C = cp === null ? null : cp * p; }
  if (C === null) return { ok: false, error: 'chain drive needs a positive centre distance (mm or in pitches)' };

  const PD1 = sprocketPitchDiameter(p, N1);
  const PD2 = sprocketPitchDiameter(p, N2);
  if (C <= (PD1 + PD2) / 2) return { ok: false, error: 'centre distance too small — the sprockets would overlap' };

  const Cp = C / p;                       // centre distance in pitches
  const A = (N1 + N2) / 2;
  const K = ((N2 - N1) / (2 * Math.PI)) ** 2;
  const Lexact = 2 * Cp + A + K / Cp;      // chain length in pitches
  const Leven = roundUpEven(Lexact);       // even-pitch chain

  // Solve the quadratic 2·Cp² − (L−A)·Cp + K = 0 back for the centre distance the
  // even chain rides at (Shigley §17-5): Cp = [(L−A) + √((L−A)² − 8K)] / 4.
  const b = Leven - A;
  const disc = b * b - 8 * K;
  if (disc < 0) return { ok: false, error: 'degenerate chain geometry (no real centre distance)' };
  const CpAdj = (b + Math.sqrt(disc)) / 4;
  const Cadj = CpAdj * p;

  const out: ChainDriveResult = {
    pitch: p,
    driverTeeth: N1,
    drivenTeeth: N2,
    pitchDiameterDriver: r(PD1),
    pitchDiameterDriven: r(PD2),
    ratio: N2 / N1,                        // EXACT — no slip term
    centreDistance: r(C),
    centreDistance_pitches: r(Cp),
    chainLength_pitches_exact: r(Lexact),
    chainLength_pitches: Leven,
    adjustedCentreDistance: r(Cadj),
    adjustedCentreDistance_pitches: r(CpAdj),
    chordalSpeedVariationDriver_pct: r(chordalSpeedVariation(N1) * 100),
    chordalSpeedVariationDriven_pct: r(chordalSpeedVariation(N2) * 100),
  };

  const n1 = spec.driverSpeed_rpm !== undefined ? pos(spec.driverSpeed_rpm) : null;
  let V: number | null = null;
  if (n1 !== null) {
    out.driverSpeed_rpm = n1;
    out.drivenSpeed_rpm = r(n1 * N1 / N2);           // = n1 / ratio
    V = N1 * p * (n1 / 60) / 1000;                    // m/s: N1 pitches advance per rev (polygon perimeter), p mm → m
    out.chainSpeed_m_s = r(V);
  }

  const power = spec.power_kW !== undefined ? pos(spec.power_kW) : null;
  if (power !== null && V !== null) {
    out.power_kW = power;
    out.tangentialForce_N = r(power * 1000 / V);       // P = F·V
  }

  return { ok: true, value: out };
}
