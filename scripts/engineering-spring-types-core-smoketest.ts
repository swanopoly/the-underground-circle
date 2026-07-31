/**
 * engineering-spring-types-core smoke — the smoke IS the proof.
 *
 * THE DUALITY ANCHOR. The same coil of the same wire has a different stiffness law
 * depending on how the load stresses the wire. A helical COMPRESSION spring twists
 * its wire (torsion) → k = G·d⁴/(8·D³·n), the SHEAR modulus G. A helical TORSION
 * spring bends its wire → k' = E·d⁴/(10.8·D·N), YOUNG'S modulus E. For steel
 * E = 200 000, G = 79 300 (E/G ≈ 2.52), so these are different physics, not a
 * rescale. This file pins that against the SHIPPED compression-spring function
 * (`springRate` in engineeringCalcCore): an extension spring reuses its G-law, a
 * torsion spring uses the E-law, and the two moduli genuinely differ.
 *
 * EXTENSION INITIAL TENSION. A close-wound extension spring carries a preload Fi at
 * ZERO deflection: F(0) = Fi (NOT zero), then F = Fi + k·x, and the travel to a
 * target force subtracts Fi first, x = (F − Fi)/k.
 *
 * BELLEVILLE NONLINEARITY. The Almen–Laszlo coned-disc load is CUBIC in δ, so it is
 * not a constant-rate spring; the h/t ratio shapes the curve — at δ=h the tangent
 * rate ∝ (t² − ½h²), giving a POSITIVE rate for h/t<√2, a ZERO-rate constant-force
 * PLATEAU at h/t=√2, and a NEGATIVE (snap-through) rate for h/t>√2. Stacked discs
 * add load in parallel and deflection in series. All hand-verified below.
 */

import { torsionSpring, extensionSpring, belleville } from '../src/lib/engineeringSpringTypesCore';
import { springRate, MATERIALS } from '../src/lib/engineeringCalcCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) {
  assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`);
}
function ok<T>(rr: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!rr.ok) { failures.push(`${label}: ${rr.error}`); console.error(`FAIL: ${label} — ${rr.error}`); process.exit(1); }
  return rr.value;
}

function main() {
  // ─── Torsion spring: rate, moment, stress (steel, d=2, D=20, N=5) ──────────
  {
    const ts = ok(torsionSpring({ wireDiameter: 2, meanDiameter: 20, activeCoils: 5, material: 'steel', deflectionDeg: 90 }), 'torsion(steel,d2,D20,N5,90°)');
    near(ts.ratePerTurn, (200000 * 2 ** 4) / (10.8 * 20 * 5), "k' = E·d⁴/(10.8·D·N) per turn");
    near(ts.ratePerTurn, 2962.963, 'torsion rate hand value 2962.96 N·mm/turn');
    near(ts.ratePerRad, ts.ratePerTurn / (2 * Math.PI), 'ratePerRad = ratePerTurn / 2π');
    near(ts.ratePerDeg, ts.ratePerTurn / 360, 'ratePerDeg = ratePerTurn / 360');
    near(ts.springIndex, 10, 'spring index C = D/d = 10');
    near(ts.curvatureFactorKi, 389 / 360, 'Ki = (4C²−C−1)/(4C(C−1)) = 389/360 = 1.0806');
    assert(ts.modulusKind === 'E', "torsion spring uses YOUNG'S modulus E (wire in bending)");
    assert(ts.youngsModulus === 200000, 'torsion E = steel E = 200000 MPa');
    near(ts.moment!, ts.ratePerDeg * 90, 'moment at 90° = ratePerDeg·90');
    near(ts.moment!, 740.7407, 'torsion moment hand value 740.74 N·mm');
    // Bending stress, recomputed from first principles (independent of stored fields).
    near(ts.bendingStress!, (389 / 360) * 32 * ((200000 * 2 ** 4) / (10.8 * 20 * 5) * 0.25) / (Math.PI * 2 ** 3), 'σ = Ki·32M/(π·d³) hand value');
    // Definitional cross-check: σ = Ki·M·c/I with c=d/2, I=πd⁴/64 (same number, different form).
    near(ts.bendingStress!, ts.curvatureFactorKi * ts.moment! * (2 / 2) / (Math.PI * 2 ** 4 / 64), 'σ = Ki·M·c/I definitional cross-check');
    near(ts.bendingStress!, 1019.12, 'torsion bending stress ≈ 1019 MPa', 2e-3);
  }

  // ─── Torsion: angle units agree; moment path inverts; explicit E ──────────
  {
    const base = ok(torsionSpring({ wireDiameter: 2, meanDiameter: 20, activeCoils: 5, material: 'steel', deflectionDeg: 90 }), 'torsion 90° base');
    const rev = ok(torsionSpring({ wireDiameter: 2, meanDiameter: 20, activeCoils: 5, material: 'steel', deflectionRev: 0.25 }), 'torsion 0.25 rev');
    const rad = ok(torsionSpring({ wireDiameter: 2, meanDiameter: 20, activeCoils: 5, material: 'steel', deflectionRad: Math.PI / 2 }), 'torsion π/2 rad');
    near(rev.moment!, base.moment!, '0.25 rev ≡ 90° → same moment');
    near(rad.moment!, base.moment!, 'π/2 rad ≡ 90° → same moment');
    const byM = ok(torsionSpring({ wireDiameter: 2, meanDiameter: 20, activeCoils: 5, material: 'steel', appliedMoment: 740.7407 }), 'torsion by moment');
    near(byM.deflectionDeg!, 90, 'appliedMoment 740.74 → 90° (inverse of the rate)');
    const byE = ok(torsionSpring({ wireDiameter: 2, meanDiameter: 20, activeCoils: 5, youngsModulus: 200000 }), 'torsion explicit E');
    near(byE.ratePerTurn, base.ratePerTurn, 'explicit E = 200000 gives the same rate as material steel');
  }

  // ─── THE E-vs-G DUALITY: same wire, torsion=E(bending), extension=G(torsion) ─
  {
    const d = 3, D = 24, n = 8; // one identical coil, tested three ways
    // COMPRESSION spring from the SHIPPED calc core — twists its wire → shear modulus G.
    const comp = springRate({ wireDiameter: d, meanDiameter: D, activeCoils: n, material: 'steel' });
    assert(comp.ok, 'calcCore compression springRate ok');
    const kComp = comp.ok ? comp.value : NaN;
    near(kComp, (79300 * d ** 4) / (8 * D ** 3 * n), 'compression k = G·d⁴/(8D³n) uses the SHEAR modulus G');

    // EXTENSION spring (this core) — also twists its wire → the SAME G-rate.
    const ext = ok(extensionSpring({ wireDiameter: d, meanDiameter: D, activeCoils: n, initialTension: 0, material: 'steel' }), 'extension same wire');
    near(ext.rate, kComp, 'extension rate == compression rate (both use G, identical wire)');
    assert(ext.modulusKind === 'G', 'extension spring uses the SHEAR modulus G');
    assert(ext.shearModulus === 79300, 'extension G = steel G = 79300 MPa');

    // TORSION spring (this core) — bends its wire → the E-rate, a DIFFERENT law.
    const tors = ok(torsionSpring({ wireDiameter: d, meanDiameter: D, activeCoils: n, material: 'steel', deflectionDeg: 30 }), 'torsion same wire');
    near(tors.ratePerTurn, (200000 * d ** 4) / (10.8 * D * n), "torsion k' = E·d⁴/(10.8Dn) uses YOUNG'S modulus E");
    assert(tors.modulusKind === 'E', "torsion spring uses YOUNG'S modulus E");
    assert(tors.youngsModulus === 200000, 'torsion E = steel E = 200000 MPa');

    // The point: SAME coil, DIFFERENT modulus, because the wire is stressed differently.
    assert(tors.youngsModulus !== ext.shearModulus, 'DUALITY: torsion modulus (E) ≠ extension modulus (G) for the SAME wire');
    near(tors.youngsModulus / ext.shearModulus, MATERIALS.steel.E / MATERIALS.steel.G, 'E/G ≈ 2.52 for steel — the moduli genuinely differ');
    assert(MATERIALS.steel.E > 2 * MATERIALS.steel.G, 'steel E ≈ 2.5·G → the two spring laws are different physics, not a rescale');
  }

  // ─── Extension spring: initial tension Fi (F ≠ 0 at zero deflection) ───────
  {
    const es = ok(extensionSpring({ wireDiameter: 2, meanDiameter: 16, activeCoils: 10, initialTension: 20, material: 'steel', deflection: 10, targetForce: 100 }), 'extension(d2,D16,n10,Fi20)');
    near(es.rate, (79300 * 2 ** 4) / (8 * 16 ** 3 * 10), 'k = G·d⁴/(8D³n) hand value');
    near(es.rate, 3.8721, 'extension rate hand value 3.8721 N/mm');
    near(es.initialTension, 20, 'Fi echoed = 20 N');
    near(es.forceAtDeflection!, 20 + es.rate * 10, 'F(10mm) = Fi + k·x');
    near(es.deflectionForForce!, (100 - 20) / es.rate, 'x for 100 N = (F − Fi)/k (Fi subtracted first)');
    assert(es.deflectionClampedAtInitial === false, '100 N > Fi → deflection not clamped');

    // F(0) = Fi, NOT zero — the defining feature of an extension spring.
    const at0 = ok(extensionSpring({ wireDiameter: 2, meanDiameter: 16, activeCoils: 10, initialTension: 20, material: 'steel', deflection: 0 }), 'extension at x=0');
    near(at0.forceAtDeflection!, 20, 'F(0) = Fi = 20 N — force is NON-ZERO at zero deflection');
    assert(at0.forceAtDeflection! > 0, 'extension spring carries force before it moves');

    // Linear beyond Fi: the slope is exactly k.
    const at20 = ok(extensionSpring({ wireDiameter: 2, meanDiameter: 16, activeCoils: 10, initialTension: 20, material: 'steel', deflection: 20 }), 'extension at x=20');
    near(at20.forceAtDeflection! - es.forceAtDeflection!, es.rate * 10, 'F(20)−F(10) = k·10 (linear with slope k beyond Fi)');

    // Target force ≤ Fi → the spring has not begun to extend (clamp to x=0).
    const low = ok(extensionSpring({ wireDiameter: 2, meanDiameter: 16, activeCoils: 10, initialTension: 20, material: 'steel', targetForce: 15 }), 'extension target 15N < Fi');
    assert(low.deflectionForForce === 0 && low.deflectionClampedAtInitial === true, 'target force ≤ Fi → deflection clamps to 0 (coils still closed)');

    // Zero initial tension → a plain helical spring, F(0)=0, F = k·x.
    const noFi = ok(extensionSpring({ wireDiameter: 2, meanDiameter: 16, activeCoils: 10, initialTension: 0, material: 'steel', deflection: 10 }), 'extension Fi=0');
    near(noFi.forceAtDeflection!, es.rate * 10, 'Fi=0 → F = k·x with no offset');
  }

  // ─── Belleville: Almen–Laszlo load, nonlinearity, softening ────────────────
  {
    const K1hand = (6 / (Math.PI * Math.log(2))) * ((2 - 1) / 2) ** 2;
    const Ahand = (4 * 200000) / (K1hand * (1 - 0.3 * 0.3) * 50 * 50);
    const Phand = Ahand * 1 * ((1.5 - 0.5) * (1.5 - 1) * 2 + 2 ** 3); // ≈ 4594.5 N

    const b = ok(belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 1.5, deflection: 1, material: 'steel' }), 'belleville(Do50,Di25,t2,h1.5,δ1)');
    near(b.geometryFactorK1, K1hand, 'K1 = (6/(π·lnR))·((R−1)/R)² = 0.6888');
    near(b.diameterRatio, 2, 'diameter ratio R = Do/Di = 2');
    near(b.heightToThickness, 0.75, 'h/t = 1.5/2 = 0.75');
    near(b.load, Phand, 'Belleville load P ≈ 4594 N (hand-computed Almen–Laszlo)');
    assert(b.youngsModulus === 200000, "belleville uses Young's modulus E = steel 200000");

    // NONLINEAR: P is cubic in δ, so P(1)/P(0.5) ≠ 2.
    const half = ok(belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 1.5, deflection: 0.5, material: 'steel' }), 'belleville δ=0.5');
    near(b.load / half.load, 12 / 7, 'NONLINEAR: P(1)/P(0.5) = 1.714 ≠ 2 (load not proportional to δ)');
    assert(Math.abs(b.load / half.load - 2) > 0.1, 'NONLINEAR: load is not proportional to deflection');

    // SOFTENING: tangent stiffness drops as δ climbs toward the flat.
    const toe = ok(belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 1.5, deflection: 1e-6, material: 'steel' }), 'belleville δ→0');
    assert(toe.tangentStiffness > b.tangentStiffness, 'stiffness softens: dP/dδ at δ→0 exceeds dP/dδ at δ=1');
  }

  // ─── Belleville: h/t controls the curve — the √2 constant-force plateau ────
  {
    // h/t = 0.25 (shallow): POSITIVE rate at full flatten → quasi-linear rising curve.
    const shallow = ok(belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 0.5, deflection: 0.5, material: 'steel' }), 'belleville h/t=0.25 at δ=h');
    assert(shallow.heightToThickness < 0.3, 'shallow disc h/t = 0.25');
    assert(shallow.tangentStiffness > 0, 'h/t < √2: POSITIVE incremental rate at δ=h (rising curve)');
    assert(shallow.flatRegion === false && shallow.negativeRate === false, 'shallow disc is neither flat nor snap-through');

    // h/t = √2: the FLAT (near-constant-force) region — zero tangent rate at δ=h.
    const hFlat = Math.SQRT2 * 2; // t=2 → h = 2√2
    const flat = ok(belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: hFlat, deflection: hFlat, material: 'steel' }), 'belleville h/t=√2 at δ=h');
    assert(flat.flatRegion === true, 'h/t = √2 flagged as the constant-force plateau design point');
    assert(Math.abs(flat.tangentStiffness) < 1e-6, 'h/t = √2: incremental rate at δ=h ≈ 0 → constant-force plateau');

    // h/t = 2 (deep, > √2): NEGATIVE rate at δ=h → snap-through / bistable.
    const deep = ok(belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 4, deflection: 4, material: 'steel' }), 'belleville h/t=2 at δ=h');
    assert(deep.heightToThickness === 2, 'deep disc h/t = 2');
    assert(deep.negativeRate === true && deep.tangentStiffness < 0, 'h/t > √2: NEGATIVE rate at δ=h → snap-through / bistable');
    assert(deep.load > 0, 'snap-through disc still carries positive load where its rate is negative');

    // The three regimes together — the whole design story in one line.
    assert(shallow.tangentStiffness > 0 && Math.abs(flat.tangentStiffness) < 1e-6 && deep.tangentStiffness < 0,
      'h/t controls the curve: shallow→rising, √2→flat plateau, deep→snap-through (all at δ=h)');
  }

  // ─── Belleville: stack arithmetic — parallel adds load, series adds travel ─
  {
    const single = ok(belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 1.5, deflection: 1, material: 'steel' }), 'belleville single disc');
    const stack = ok(belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 1.5, deflection: 1, material: 'steel', parallel: 3, series: 2 }), 'belleville stack 3∥ / 2 series');
    near(stack.load, single.load, 'single-disc load unchanged by stacking arithmetic');
    near(stack.stackLoad, 3 * stack.load, 'PARALLEL stack: total load = n·P (3 nested discs → 3×)');
    near(stack.stackDeflection, 2 * stack.deflection, 'SERIES stack: total deflection = m·δ (2 alternated discs → 2×)');
    assert(stack.stackParallel === 3 && stack.stackSeries === 2, 'stack counts echoed');
    // Defaults: a lone disc is 1∥ / 1 series.
    assert(single.stackParallel === 1 && single.stackSeries === 1, 'a single disc defaults to parallel=1, series=1');
  }

  // ─── Validation: fail-closed on bad inputs, accept the legitimate edges ────
  {
    assert(!torsionSpring({ wireDiameter: 0, meanDiameter: 20, activeCoils: 5, material: 'steel' }).ok, 'torsion rejects non-positive wire diameter');
    assert(!torsionSpring({ wireDiameter: 20, meanDiameter: 20, activeCoils: 5, material: 'steel' }).ok, 'torsion rejects D ≤ d (index must exceed 1)');
    assert(!torsionSpring({ wireDiameter: 2, meanDiameter: 20, activeCoils: 5 }).ok, 'torsion rejects missing modulus (no material, no E)');
    assert(!extensionSpring({ wireDiameter: 2, meanDiameter: 16, activeCoils: 10, initialTension: -5, material: 'steel' }).ok, 'extension rejects NEGATIVE initial tension');
    assert(!extensionSpring({ wireDiameter: 2, meanDiameter: 16, activeCoils: 10, initialTension: 20 }).ok, 'extension rejects missing modulus');
    assert(extensionSpring({ wireDiameter: 2, meanDiameter: 16, activeCoils: 10, initialTension: 0, material: 'steel' }).ok, 'extension ACCEPTS zero initial tension (plain helical spring)');
    assert(!belleville({ outerDiameter: 25, innerDiameter: 50, thickness: 2, coneHeight: 1.5, deflection: 1, material: 'steel' }).ok, 'belleville rejects Di ≥ Do');
    assert(!belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 0, coneHeight: 1.5, deflection: 1, material: 'steel' }).ok, 'belleville rejects non-positive thickness');
    assert(!belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 1.5, deflection: 1 }).ok, 'belleville rejects missing modulus');
    assert(!belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 1.5, deflection: -1, material: 'steel' }).ok, 'belleville rejects non-positive deflection');
    assert(!belleville({ outerDiameter: 50, innerDiameter: 25, thickness: 2, coneHeight: 1.5, deflection: 1, material: 'steel', poisson: 0.7 }).ok, 'belleville rejects an out-of-range Poisson ratio');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-spring-types-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-spring-types-core smoke cases passed.');
}

main();
