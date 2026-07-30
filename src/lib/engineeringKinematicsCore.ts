/**
 * engineeringKinematicsCore — MECHANISM KINEMATICS, the analysis partner to the
 * motion GEOMETRY (cams, racks): given a linkage's dimensions and its input
 * angle, where does the output go? Four-bar linkages and the slider-crank are the
 * two mechanisms most of machinery is built from.
 *
 * GRASHOF — CAN IT ROTATE? Before solving positions you must know whether a link
 * can make a full revolution, which the Grashof criterion settles from the four
 * lengths alone: with s = shortest, l = longest, and p, q the others, a full
 * rotation is possible iff s + l ≤ p + q. Which link rotates then depends on where
 * the shortest one sits — shortest = a side gives a crank-rocker, shortest =
 * ground gives a double-crank (drag link), shortest = coupler gives a
 * double-rocker; s+l = p+q is a change point, and s+l > p+q is a non-Grashof
 * triple-rocker where nothing fully turns.
 *
 * FOUR-BAR POSITION — SOLVE, THEN VERIFY THE LOOP. The output angle comes from
 * the Freudenstein equation (the vector loop projected onto the axes), which is a
 * quadratic with two roots — the OPEN and CROSSED assemblies. Rather than trust
 * the algebra, the solved angle is checked against the geometry directly: the
 * distance between the crank tip and the rocker tip MUST equal the coupler length.
 * That loop-closure residual is the self-check; if the trig were wrong it would
 * not close.
 *
 * SLIDER-CRANK. The in-line piston sits at x = r·cosθ + √(l² − r²·sin²θ) from the
 * crank centre, so top dead centre is r + l, bottom is l − r, and the stroke is
 * exactly 2r — the exact facts the smoke pins.
 *
 * Pure + tsx-loadable (smoke: scripts/engineering-kinematics-core-smoketest.ts):
 * self-contained, no imports, no I/O.
 */

export type KinematicsResult<T> = { ok: true; value: T } | { ok: false; error: string };

function pos(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; }
function fin(v: unknown): number | null { const n = Number(v); return Number.isFinite(n) ? n : null; }
function r(n: number, dp = 5): number { const f = Math.pow(10, dp); return Math.round(n * f) / f; }
const DEG = Math.PI / 180, RAD = 180 / Math.PI;

// ─── Grashof ─────────────────────────────────────────────────────────────────

export type GrashofResult = {
  lengths: { ground: number; input: number; coupler: number; output: number };
  shortestPlusLongest: number;
  otherTwoSum: number;
  grashof: boolean;
  classification: string;
};

/** Grashof classification from the four link lengths (ground, input, coupler, output). */
export function grashof(ground: number, input: number, coupler: number, output: number): KinematicsResult<GrashofResult> {
  const links = [pos(ground), pos(input), pos(coupler), pos(output)];
  if (links.some((v) => v === null)) return { ok: false, error: 'all four link lengths must be positive' };
  const [g, a, b, c] = links as number[];
  const sorted = [...(links as number[])].sort((x, y) => x - y);
  const s = sorted[0], L = sorted[3];
  const sumSL = s + L, sumPQ = sorted[1] + sorted[2];
  const shortest = Math.min(g, a, b, c);
  let classification: string;
  if (sumSL > sumPQ) classification = 'non-Grashof (triple-rocker — no link fully rotates)';
  else if (Math.abs(sumSL - sumPQ) <= 1e-9) classification = 'change-point (folds through a straight line)';
  else if (shortest === a) classification = 'crank-rocker (input crank rotates fully, output rocks)';
  else if (shortest === g) classification = 'double-crank / drag-link (both input and output rotate)';
  else if (shortest === b) classification = 'double-rocker (coupler rotates fully, both pivots rock)';
  else classification = 'crank-rocker (output is the shortest — it rotates fully)';
  return {
    ok: true,
    value: {
      lengths: { ground: g, input: a, coupler: b, output: c },
      shortestPlusLongest: r(sumSL), otherTwoSum: r(sumPQ),
      grashof: sumSL <= sumPQ, classification,
    },
  };
}

// ─── Four-bar position analysis ──────────────────────────────────────────────

export type FourBarResult = {
  inputAngleDeg: number;
  outputAngleDeg: number;
  couplerAngleDeg: number;
  transmissionAngleDeg: number;
  circuit: 'open' | 'crossed';
  loopClosureResidual: number; // |crankTip − rockerTip| − coupler, should be ~0
  crankTip: { x: number; y: number };
  rockerTip: { x: number; y: number };
};

/**
 * Solve a four-bar (ground r1 along +x, input r2 at origin, coupler r3, output r4
 * at (r1,0)) for the output angle at input angle θ2. Returns the requested
 * circuit and the loop-closure residual as a built-in check.
 */
export function fourBarPosition(args: {
  ground: number; input: number; coupler: number; output: number; inputAngleDeg: number; circuit?: 'open' | 'crossed';
}): KinematicsResult<FourBarResult> {
  const r1 = pos(args.ground), r2 = pos(args.input), r3 = pos(args.coupler), r4 = pos(args.output);
  const th2deg = fin(args.inputAngleDeg);
  if (r1 === null || r2 === null || r3 === null || r4 === null || th2deg === null) return { ok: false, error: 'four-bar needs positive ground/input/coupler/output lengths and an input angle' };
  const th2 = th2deg * DEG;
  const K1 = r1 / r2, K2 = r1 / r4, K3 = (r2 * r2 - r3 * r3 + r4 * r4 + r1 * r1) / (2 * r2 * r4);
  const A = Math.cos(th2) - K1 - K2 * Math.cos(th2) + K3;
  const B = -2 * Math.sin(th2);
  const C = K1 - (K2 + 1) * Math.cos(th2) + K3;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return { ok: false, error: 'the linkage cannot be assembled at this input angle (a toggle/dead position)' };
  const root = Math.sqrt(disc);
  const circuit = args.circuit === 'crossed' ? 'crossed' : 'open';
  const th4 = 2 * Math.atan2(-B - (circuit === 'open' ? root : -root), 2 * A);

  const crankTip = { x: r2 * Math.cos(th2), y: r2 * Math.sin(th2) };
  const rockerTip = { x: r1 + r4 * Math.cos(th4), y: r4 * Math.sin(th4) };
  const couplerLen = Math.hypot(rockerTip.x - crankTip.x, rockerTip.y - crankTip.y);
  const th3 = Math.atan2(rockerTip.y - crankTip.y, rockerTip.x - crankTip.x);
  // transmission angle: angle between coupler and output link.
  let mu = Math.abs(th4 - th3) * RAD % 360;
  if (mu > 180) mu = 360 - mu;
  if (mu > 90) mu = 180 - mu;
  return {
    ok: true,
    value: {
      inputAngleDeg: r(th2deg), outputAngleDeg: r(((th4 * RAD) % 360 + 360) % 360),
      couplerAngleDeg: r(((th3 * RAD) % 360 + 360) % 360),
      transmissionAngleDeg: r(mu),
      circuit,
      loopClosureResidual: r(couplerLen - r3, 8),
      crankTip: { x: r(crankTip.x), y: r(crankTip.y) },
      rockerTip: { x: r(rockerTip.x), y: r(rockerTip.y) },
    },
  };
}

// ─── Slider-crank ─────────────────────────────────────────────────────────────

export type CrankSliderResult = {
  crankAngleDeg: number;
  pistonPosition: number; // from the crank centre
  stroke: number;
  topDeadCentre: number;
  bottomDeadCentre: number;
  ratio_r_over_l: number;
  pistonVelocity?: number; // if crankSpeed given (mm/s)
};

/** In-line slider-crank: piston position x = r·cosθ + √(l² − r²·sin²θ). */
export function crankSlider(args: {
  crankRadius: number; conrodLength: number; crankAngleDeg: number; crankSpeed_rad_s?: number;
}): KinematicsResult<CrankSliderResult> {
  const cr = pos(args.crankRadius), l = pos(args.conrodLength), thDeg = fin(args.crankAngleDeg);
  if (cr === null || l === null || thDeg === null) return { ok: false, error: 'slider-crank needs positive crankRadius, conrodLength, and a crank angle' };
  if (l <= cr) return { ok: false, error: 'conrod must be longer than the crank radius' };
  const th = thDeg * DEG;
  const x = cr * Math.cos(th) + Math.sqrt(l * l - cr * cr * Math.sin(th) * Math.sin(th));
  const out: CrankSliderResult = {
    crankAngleDeg: r(thDeg),
    pistonPosition: r(x),
    stroke: r(2 * cr),
    topDeadCentre: r(cr + l),
    bottomDeadCentre: r(l - cr),
    ratio_r_over_l: r(cr / l),
  };
  const omega = args.crankSpeed_rad_s !== undefined ? fin(args.crankSpeed_rad_s) : null;
  if (omega !== null) {
    // dx/dt = −r·ω·[sinθ + (r·sinθ·cosθ)/√(l²−r²sin²θ)]
    const s = Math.sin(th), cth = Math.cos(th);
    const dxdth = -cr * s - (cr * cr * s * cth) / Math.sqrt(l * l - cr * cr * s * s);
    out.pistonVelocity = r(dxdth * omega);
  }
  return { ok: true, value: out };
}
