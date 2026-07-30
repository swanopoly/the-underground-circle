/**
 * engineering-fluid-core smoke.
 *
 * Pipe hydraulics pinned against textbook: Reynolds (hand-computed), the exact
 * laminar friction factor 64/Re, the Darcy–Weisbach pressure drop, and continuity
 * Q = V·A. The turbulent Swamee–Jain friction factor has no elementary closed
 * form, so it is CROSS-CHECKED against the independent Blasius correlation
 * 0.316/Re^0.25 for a smooth pipe, where the two must agree within a few percent.
 */

import {
  FLUIDS, reynoldsNumber, flowRegime, frictionFactor, pipeFlow,
} from '../src/lib/engineeringFluidCore';

let passed = 0;
const failures: string[] = [];
function assert(cond: boolean, label: string) {
  if (cond) { passed++; console.log(`pass: ${label}`); }
  else { failures.push(label); console.error(`FAIL: ${label}`); }
}
function near(a: number, b: number, label: string, tol = 1e-3) { assert(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${label} (got ${a}, expected ≈ ${b})`); }
function ok<T>(r: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!r.ok) { failures.push(`${label}: ${r.error}`); console.error(`FAIL: ${label} — ${r.error}`); process.exit(1); }
  return r.value;
}

function main() {
  // ─── Reynolds + regime ───────────────────────────────────────────
  {
    // water ρ=998, μ=1.002e-3, V=2 m/s, D=0.05 m → Re = 998·2·0.05/1.002e-3.
    near(reynoldsNumber(998, 2, 0.05, 1.002e-3), 998 * 2 * 0.05 / 1.002e-3, 'Re = ρ·V·D/μ');
    assert(flowRegime(1000) === 'laminar', 'Re 1000 → laminar');
    assert(flowRegime(3000) === 'transition', 'Re 3000 → transition');
    assert(flowRegime(50000) === 'turbulent', 'Re 50000 → turbulent');
  }

  // ─── Friction factor: exact laminar, Swamee–Jain vs Blasius ──────
  {
    near(frictionFactor(1000), 64 / 1000, 'laminar f = 64/Re exactly');
    near(frictionFactor(2000), 0.032, 'laminar f at Re 2000 = 0.032');
    // smooth-pipe turbulent: Swamee–Jain must track Blasius 0.316/Re^0.25.
    for (const Re of [1e4, 5e4, 1e5]) {
      const sj = frictionFactor(Re, 0);
      const blasius = 0.316 / Math.pow(Re, 0.25);
      assert(Math.abs(sj - blasius) / blasius <= 0.06, `Swamee–Jain ≈ Blasius at Re=${Re} (sj ${sj.toFixed(5)}, blasius ${blasius.toFixed(5)})`);
    }
    // rougher pipe → higher friction.
    assert(frictionFactor(1e5, 0.01) > frictionFactor(1e5, 0), 'roughness raises the friction factor');
  }

  // ─── Darcy–Weisbach pressure drop ────────────────────────────────
  {
    // water, D=50mm, V=2, L=10, smooth. Δp = f·(L/D)·ρV²/2.
    const r = ok(pipeFlow({ diameter: 50, velocity: 2, length: 10, fluid: 'water' }), 'water flow');
    near(r.reynolds, 998 * 2 * 0.05 / 1.002e-3, 'pipeFlow Reynolds matches');
    assert(r.regime === 'turbulent', 'water at 2 m/s in 50mm is turbulent');
    // independent Δp from the reported f: f·(L/D)·ρV²/2.
    const dpExpect = r.frictionFactor * (10 / 0.05) * (998 * 4) / 2;
    near(r.pressureDrop_Pa!, dpExpect, 'Δp = f·(L/D)·ρV²/2');
    near(r.pressureDrop_kPa!, dpExpect / 1000, 'Δp reported in kPa too');
    // head loss and pressure are consistent: Δp = ρ·g·h_f.
    near(r.pressureDrop_Pa!, r.density_kg_m3 * 9.80665 * r.headLoss_m!, 'Δp = ρ·g·h_f');
  }

  // ─── Continuity: flow rate ↔ velocity ────────────────────────────
  {
    const byV = ok(pipeFlow({ diameter: 50, velocity: 2, fluid: 'water' }), 'by velocity');
    near(byV.flowRate_m3_s, 2 * Math.PI * 0.025 ** 2, 'Q = V·A');
    // feeding that flow rate back must recover the velocity.
    const byQ = ok(pipeFlow({ diameter: 50, flowRate_m3s: byV.flowRate_m3_s, fluid: 'water' }), 'by flow rate');
    near(byQ.velocity_m_s, 2, 'velocity recovered from flow rate');
    // L/min form.
    const byLmin = ok(pipeFlow({ diameter: 50, flowRate: byV.flowRate_L_min, fluid: 'water' }), 'by L/min');
    near(byLmin.velocity_m_s, 2, 'velocity from L/min flow rate', 2e-3);
  }

  // ─── A laminar case (viscous oil) ────────────────────────────────
  {
    // SAE30 oil, D=20mm, V=0.5 → Re = 888·0.5·0.02/0.29 ≈ 30.6 (deeply laminar).
    const r = ok(pipeFlow({ diameter: 20, velocity: 0.5, length: 5, fluid: 'oil' }), 'oil flow');
    assert(r.regime === 'laminar', 'viscous oil is laminar');
    near(r.frictionFactor, 64 / r.reynolds, 'laminar f = 64/Re for the oil');
  }

  // ─── Fluids table + validation ───────────────────────────────────
  {
    assert(FLUIDS.water.rho === 998 && FLUIDS.water.mu === 1.002e-3, 'water properties');
    assert(Object.values(FLUIDS).every((f) => f.rho > 0 && f.mu > 0), 'every fluid has positive ρ and μ');
    assert(!pipeFlow({ diameter: 50, velocity: 2 }).ok, 'no fluid + no ρ/μ rejected');
    assert(!pipeFlow({ diameter: 50, fluid: 'water' }).ok, 'no velocity + no flow rate rejected');
    assert(ok(pipeFlow({ diameter: 50, velocity: 2, density: 1000, viscosity: 1e-3 }), 'explicit props').reynolds > 0, 'explicit density/viscosity works');
  }

  console.log(`\n${passed} assertions passed, ${failures.length} failed`);
  if (failures.length) { console.error(`\n${failures.length} engineering-fluid-core smoke failure(s)`); process.exit(1); }
  console.log('All engineering-fluid-core smoke cases passed.');
}

main();
